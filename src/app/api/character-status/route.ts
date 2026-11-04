import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 角色状态卡生成（点击聊天对方头像时前端按需调用）：
 *
 * 前端组装上下文（联系人资料 + 最近聊天 + 记忆召回块 + 当前时间 + App 场景 + QQ 密友值提示），
 * 服务端让模型完全代入角色本人，生成一张「此刻状态卡」JSON：
 * 心情（颜文字）/ 好感度（0-100 + 关系阶段短语）/ 心声（第一人称内心独白）/ 动作 / 穿着 / 位置（可选）。
 *
 * - 每次点击实时生成（前端每次携带新的随机种子），内容随人设 / 近况 / 时间变化，但不脱离人设与记忆事实；
 * - 状态卡内容不落任何持久化（是否存入记忆由用户在卡片上主动操作，走前端 memAddEventFragment）；
 * - 与 /api/phone/proactive 同构：用户上游优先 → 内置 SDK 兜底；解析失败/上游故障返回 { error }，
 *   前端展示重试入口（点击触发的增强能力，不静默返回假数据）。
 */

import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { parseInlineContact } from '@/lib/ios/call-upstream';
import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

/** 状态卡数据（与前端展示组件共用形状） */
export interface CharacterStatusCard {
  /** 心情颜文字（kaomoji，禁 emoji） */
  mood: string;
  /** 心情文字短评 */
  moodText: string;
  /** 好感度 0-100 */
  affection: number;
  /** 关系阶段短语（角色化，如「暧昧升温」「老友如初」） */
  affectionLabel: string;
  /** 第一人称内心独白（角色专属口吻） */
  innerVoice: string;
  /** 此刻正在做的事 */
  action: string;
  /** 此刻穿着 */
  outfit: string;
  /** 此刻所在地点（可空，空则前端隐藏该行） */
  location: string;
}

const APP_CHANNEL: Record<string, string> = { wx: '微信', qq: 'QQ', sms: '短信' };

/** 最近聊天条目（前端组装；user/me=机主、assistant/peer=角色本人，与主动来电决策同口径） */
interface RecentChatItem {
  role: 'user' | 'assistant';
  text: string;
}

/** 最近聊天宽松解析（非法条目丢弃、单条截断、总量封顶） */
function parseRecentChats(raw: unknown): RecentChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentChatItem[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim().slice(0, 120) : '';
    if (!text) continue;
    out.push({
      role: r.role === 'user' || r.role === 'me' ? 'user' : 'assistant',
      text,
    });
  }
  return out;
}

/** 字符串清洗：剥 markdown 装饰符、去首尾引号、截断 */
function cleanStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[*_`#>~[\]]/g, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim()
    .slice(0, max);
}

/** 好感度宽松解析：数字直接用；数字字符串 parseInt；越界钳制；非法回退 null（由归一化兜底） */
function parseAffection(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.round(v);
  else if (typeof v === 'string') {
    const m = v.match(/-?\d+/);
    if (!m) return null;
    n = parseInt(m[0], 10);
  } else return null;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** 状态卡归一化：字段逐个清洗兜底；内容全空视为生成失败（返回 null 让前端重试） */
function normalizeStatus(raw: unknown): CharacterStatusCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mood = cleanStr(r.mood, 16);
  const innerVoice = cleanStr(r.innerVoice, 90);
  const action = cleanStr(r.action, 70);
  const moodText = cleanStr(r.moodText, 24);
  // 至少要有 mood / 心声 / 动作 之一，否则视为模型没按格式输出
  if (!mood && !innerVoice && !action) return null;
  const affection = parseAffection(r.affection);
  return {
    mood: mood || '(´・ω・`)',
    moodText: moodText || '心情有些微妙',
    affection: affection ?? 50,
    affectionLabel: cleanStr(r.affectionLabel, 20) || '普通朋友',
    innerVoice: innerVoice || '……',
    action: action || '在自顾自发呆',
    outfit: cleanStr(r.outfit, 70),
    location: cleanStr(r.location, 50),
  };
}

/** 状态卡 system prompt：复用全 App 共用的七要素人设组装，追加状态卡专属输出规则。
 *  npcExtra：配角圈/归属者资料/背景近况（客户端已随 contact 发送，此前被服务端丢弃；现接入与聊天同口径）
 *  accountId：多账号关系感知（小号读 relationByAcc 分账号关系；不传 = 大号口径） */
function buildStatusSystemPrompt(
  peer: Parameters<typeof buildPersonaSystemPrompt>[0],
  user?: { name: string | null },
  channel = '微信',
  multiApp?: boolean,
  npcExtra?: { ownerLabel?: string; npcCircle?: Parameters<typeof buildPersonaSystemPrompt>[1]['npcCircle']; ownerCard?: string[]; backgroundNotes?: string[] },
  accountId?: string | null
): string {
  return buildPersonaSystemPrompt(peer, {
    channel,
    userName: user?.name ?? null,
    multiApp,
    accountId: accountId ?? undefined,
    ...npcExtra,
    extraRules: [
      '现在的任务：机主刚点开了你的头像，想看看你此刻的状态——你要生成一张「你此刻的状态卡」（像真人此刻的实时快照），不是回复消息，也不是自我介绍。',
      '严格输出一个 JSON 对象，不要输出任何其他文字或代码块围栏：',
      '{"mood":"颜文字","moodText":"心情短评","affection":0到100的整数,"affectionLabel":"关系阶段短语","innerVoice":"第一人称内心独白","action":"此刻正在做的事","outfit":"此刻穿着","location":"此刻所在地点"}',
      'mood 必须是颜文字（kaomoji，用普通字符拼出的表情，例如 (´▽`)、(｡•́︿•̀｡)、(¬_¬ )、(＃°Д°)、(￣▽￣)ノ），严禁使用 emoji 表情符号；moodText 是给这个颜文字的中文短评（如「有点小雀跃」「累瘫了」）。',
      'affectionLabel 用贴合你们关系、近期互动与人设的短语描述当前关系阶段（如「暧昧升温」「老友如初」「吵完架还没和好」「单方面在吃醋」），禁止通用套话，要能看出是你们俩独有的关系。',
      'innerVoice 用这个角色独有的语气、用词习惯和口头禅写第一人称内心独白（15~50 字）：必须是「只有这个人会这么想」的内容，结合最近聊天与你此刻正在做的事，禁止写成任何人都能套用的通用小作文。',
      'action 结合当前时间段、你的职业/生活习惯与最近聊天内容，写你此刻正在做的具体事情（一句话，具体到动作或场景）。',
      'outfit 按当前季节、时间段与你的穿衣风格写此刻穿着（一句话）。',
      'location 按人设、职业与时间段写你此刻最可能在的地点（如「学校天台」「公司工位」「出租屋沙发」）；实在写不出就输出空字符串，不要硬编。',
      'affection 的判断依据：你们资料里的关系 + 记忆库里的互动历史 + 最近聊天的氛围，给出此刻合理的值（0=陌生/疏远，50=普通朋友，70=关系很好的朋友，85+=非常亲密/恋人级别）；要贴合互动历史水平自然浮动，不要突然跳变，也不要每次一模一样。',
      '每次请求都带一个新的随机种子：围绕「此刻」自由发挥细节，同样的输入两次生成的内容也应当不同（心情、独白、动作、地点都可以随种子自然变化），但人设、关系与记忆里的事实绝不能变，也不能脱离当前时间段的合理性（深夜不会在操场做操）。',
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  // 对端身份：前端直传联系人（联系人存浏览器本地 IndexedDB，服务端不查库）；USER/非法联系人拒绝
  const inline = parseInlineContact(body.contact);
  if (!inline || inline.kind === 'user') {
    return NextResponse.json({ error: 'bad-contact' }, { status: 400 });
  }
  const peer = {
    name: inline.name,
    kind: inline.kind,
    gender: inline.gender,
    age: inline.age,
    height: inline.height,
    weight: inline.weight,
    occupation: inline.occupation,
    company: inline.company,
    region: inline.region,
    persona: inline.persona,
    background: inline.background,
    expressStyle: inline.expressStyle,
    customRules: inline.customRules,
    relation: inline.relation,
    relationByAcc: inline.relationByAcc ?? null,
    relationToUser: inline.relationToUser,
    birthday: inline.birthday,
    nickname: inline.nickname ?? null,
    realName: inline.realName ?? null,
  };

  const app = typeof body.app === 'string' && APP_CHANNEL[body.app] ? body.app : 'wx';
  // 多账号关系感知：前端按当前 App 账号传入；不传 = 大号口径（零破坏）
  const accountId = typeof body.accountId === 'string' && body.accountId.trim() ? body.accountId.trim().slice(0, 40) : undefined;
  const recentChats = parseRecentChats(body.recentChats);
  const memoryBlock = typeof body.memoryBlock === 'string' ? body.memoryBlock.trim().slice(0, 4000) : '';
  const now = typeof body.now === 'string' ? body.now.trim().slice(0, 60) : '';
  const bondHint = typeof body.bondHint === 'string' ? body.bondHint.trim().slice(0, 60) : '';
  const seed = typeof body.seed === 'string' || typeof body.seed === 'number' ? String(body.seed).slice(0, 24) : '';
  const multiApp = typeof body.multiApp === 'boolean' ? body.multiApp : undefined;

  // 机主称呼：前端直传真名（用户规则：AI 永远不知道机主昵称——body 里的 userNickname 直接忽略）
  const userName = typeof body.userName === 'string' ? body.userName.trim().slice(0, 30) : '';
  const userRealName = typeof body.userRealName === 'string' ? body.userRealName.trim().slice(0, 30) : '';

  const system = buildStatusSystemPrompt(
    peer,
    userName || userRealName ? { name: userName || userRealName } : undefined,
    APP_CHANNEL[app],
    multiApp,
    // 配角圈/归属者资料/背景近况：客户端已随 contact 发送（此前在服务端被丢弃），现接入
    {
      ownerLabel: inline.ownerLabel,
      npcCircle: inline.npcCircle,
      ownerCard: inline.ownerCard,
      backgroundNotes: inline.backgroundNotes,
    },
    accountId
  );

  // user 消息：场景 + 最近聊天（带机主/你 主语锚点，防归属混淆）+ 记忆块 + 当前时间 + 种子
  const chatLines = recentChats.map((c) => `${c.role === 'user' ? '机主' : '你'}：${c.text}`);
  const contextLines = [
    `【场景】机主（${userName || '用户'}）此刻在${APP_CHANNEL[app]}里点开了你的头像，正在查看你的状态卡。`,
    ...(chatLines.length > 0
      ? ['【最近聊天】', '（机主=用户本人，「你」=角色本人，别把机主说的话当成自己说的）', ...chatLines]
      : []),
    ...(memoryBlock ? [memoryBlock] : []),
    ...(now ? [`【当前时间】${now}`] : []),
    ...(bondHint ? [`【你们的互动数据】${bondHint}`] : []),
    ...(seed ? [`【随机种子】${seed}`] : []),
  ];
  const messages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: `${contextLines.join('\n')}\n\n（请以「${inline.nickname || inline.name}」的身份，输出你此刻的状态卡 JSON，只输出 JSON 本身）`,
    },
  ];

  // 与 proactive 同款策略：未配置 → 内置 SDK；已配置 → 用户上游，失败再 SDK 兜底。
  // 每次请求叠加随机温度扰动（0.8~1.05）：状态卡追求「每次点开都有新细节」，避免
  // 部分上游对相同/相似 prompt 返回确定性缓存导致两次生成完全一样（记忆/事实约束
  // 由 system 规则承担，扰动只影响措辞与细节的自由度，不会破坏人设）。
  const cfg = extractUpstreamConfig(body.config);
  const jittered = cfg ? { ...cfg, temperature: 0.8 + Math.random() * 0.25 } : null;
  try {
    const { text } = await completeWithFallback(jittered, messages);
    const parsed = parseLooseJSON<unknown>(text);
    const card = normalizeStatus(parsed);
    if (!card) return NextResponse.json({ error: 'generate-failed' }, { status: 502 });
    return NextResponse.json(card satisfies CharacterStatusCard);
  } catch {
    return NextResponse.json({ error: 'generate-failed' }, { status: 502 });
  }
}
