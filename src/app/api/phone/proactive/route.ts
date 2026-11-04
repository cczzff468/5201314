import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * AI 主动来电决策（Task 40-d）——客户端调度器（src/lib/ios/proactive-call.ts）在资格筛选后调用：
 *
 * 让 AI 完全代入角色本人，基于人设性格 / 最近聊天内容 / 当前时间 / 距上次互动时长
 * 决定此刻要不要主动给机主打一通真正的语音电话（不是发消息预告，是直接响铃）：
 * - call = 现在就拨打（reason = 打电话来的目的，接通后作为开场情境透传通话引擎）；
 * - wait = 有由头但此刻不合适（再等等）；
 * - skip = 没有理由打。
 * 大多数情况应返回 wait / skip——只有真的有打电话的理由才 call（冷静的决策阈值，
 * 防止每个有联系人的角色都隔三差五骚扰机主）。
 *
 * POST { contact, recentChats: [{app,text,time}], lastChatAt, lastInteractionLabel, now, config? }
 * 返回 { action: 'call' | 'wait' | 'skip', reason: string }
 * 任何失败（body 非法 / 未配置 / 上游故障 / 解析不出）兜底 skip——不打总比乱打好。
 */

import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import {
  type CallApiMessage,
  callUpstream,
  extractJsonObject,
  extractUpstreamConfig,
  isPrivateHost,
  parseInlineContact,
  sdkTurn,
} from '@/lib/ios/call-upstream';

export interface ProactiveDecision {
  action: 'call' | 'wait' | 'skip';
  /** call = 拨打目的/想聊什么（接通后的开场情境）；wait/skip = 简述为什么不打 */
  reason: string;
  /** C14 来电媒体：决策端关系亲密/常视频时可选 video；缺省 voice（skip/wait 响应可缺省） */
  media?: 'voice' | 'video';
}

/** 客户端拼好的最近聊天摘要条目（三端各取最近几条文本/转写） */
interface RecentChatItem {
  app: string;
  text: string;
  time: string;
  /** fix3-1 归属锚点：'user' = 机主本人说的 / 'assistant' = 角色（AI）本人说的；缺省按角色处理 */
  role?: 'user' | 'assistant';
}

/** 最近聊天摘要宽松解析（非法条目丢弃，单条截断，总量封顶） */
function parseRecentChats(raw: unknown): RecentChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentChatItem[] = [];
  for (const item of raw.slice(0, 14)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim().slice(0, 120) : '';
    if (!text) continue;
    out.push({
      app: typeof r.app === 'string' && r.app.trim() ? r.app.trim().slice(0, 8) : '聊天',
      text,
      time: typeof r.time === 'string' ? r.time.trim().slice(0, 24) : '',
      // fix3-1 宽松读取：user/me 都算机主，assistant/peer 都算角色本人，其余缺省按角色处理
      role:
        r.role === 'user' || r.role === 'me'
          ? ('user' as const)
          : r.role === 'assistant' || r.role === 'peer'
            ? ('assistant' as const)
            : undefined,
    });
  }
  return out;
}

function buildProactiveSystemPrompt(
  peer: Parameters<typeof buildPersonaSystemPrompt>[0],
  hasChat: boolean,
  /** 机主称呼（前端直传真名；用户规则：AI 永远不知道机主昵称，body 里的 userNickname 忽略） */
  user?: { name: string | null },
  /** 配角圈/归属者资料/背景近况（客户端已随 contact 发送，此前被服务端丢弃；现接入与 turn 路由同口径） */
  npcExtra?: { ownerLabel?: string; npcCircle?: Parameters<typeof buildPersonaSystemPrompt>[1]['npcCircle']; ownerCard?: string[]; backgroundNotes?: string[] },
  /** 多账号关系感知：当前账号 id（不传 = 大号口径） */
  accountId?: string | null
): string {
  return buildPersonaSystemPrompt(peer, {
    channel: '决定此刻要不要主动给机主打一通电话',
    userName: user?.name ?? null,
    ...npcExtra,
    accountId: accountId ?? undefined,
    extraRules: [
      '现在手机在你自己手里：请完全代入你的人设、性格和你们的关系，决定此刻要不要主动给机主打一通语音电话（不是发消息说「我给你打个电话」，而是真的拨打让 TA 的手机响铃）。',
      '判断依据（逐条对照）：',
      '① 你的人设与性格——粘人/热情/话多的人聊完不久就想打电话听听对方声音；高冷/内敛/忙碌的人很少主动；',
      '② 最近聊天内容——有没有没聊完的话题、该关心的事（面试/考试/生病/心情低落）、没兑现的约定、值得道歉或道谢的理由；',
      '③ 当前时间——深夜 23 点到早上 8 点不打（不打扰睡觉）；早上可以打去问早安；节日/生日/纪念日适合打；',
      '④ 距上次互动的时长——刚聊完没多久（不到 2 小时）通常没必要再打；',
      hasChat ? '下方给出了你们在各 App 的最近聊天摘要与距上次互动的时长。' : '没有最近聊天摘要时，只按人设与时间判断。',
      '大多数情况应该返回 wait（有由头但此刻不合适，再等等）或 skip（没有理由打）；只有真的有打电话的理由（想念、担心、有事要说、约定、节日问候）才返回 call。',
      '媒体选择（C14）：默认语音电话；只有当你们平时常打视频、关系亲密到「想看着 TA 说」时才在 call 时选视频——绝大多数情况保持 voice。',
      '严格输出一个 JSON 对象，不要输出任何其他文字：',
      '{"action":"call或wait或skip","media":"voice或video","reason":"..."}',
      'reason 是中文一句话：call 时写「你打电话来的目的/想聊什么」（如「想问问你今天面试顺不顺利」），接通后你会以它为开场；wait/skip 时简述为什么不打。',
    ],
  });
}

/** 决策结果清洗：非法 action 一律视为 skip（宁可不打，不误打） */
function normalizeProactiveDecision(raw: string): ProactiveDecision {
  const obj = extractJsonObject(raw);
  if (!obj) return { action: 'skip', reason: 'decide-failed' };
  const a = typeof obj.action === 'string' ? obj.action.trim().toLowerCase() : '';
  const action: ProactiveDecision['action'] = a === 'call' || a === 'wait' ? a : 'skip';
  const mv = typeof obj.media === 'string' ? obj.media.trim().toLowerCase() : '';
  const media: ProactiveDecision['media'] = action === 'call' && mv === 'video' ? 'video' : 'voice';
  const reason = (typeof obj.reason === 'string' ? obj.reason : '')
    .replace(/[*_`#>~[\]]/g, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim()
    .slice(0, 120);
  return {
    action,
    media,
    reason:
      reason ||
      (action === 'call' ? '就是想你了，想听听你的声音' : action === 'wait' ? '此刻还不太合适' : '没特别的理由'),
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ action: 'skip', reason: 'bad-request' } satisfies ProactiveDecision, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  // 对端身份：前端直传联系人（联系人存浏览器本地 IndexedDB，服务端不查库）；USER/非法联系人直接不决策
  const inline = parseInlineContact(root.contact);
  if (!inline || inline.kind === 'user') {
    return NextResponse.json({ action: 'skip', reason: 'bad-contact' } satisfies ProactiveDecision, { status: 400 });
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

  const recentChats = parseRecentChats(root.recentChats);
  const lastInteractionLabel =
    typeof root.lastInteractionLabel === 'string' ? root.lastInteractionLabel.trim().slice(0, 40) : '';
  const now = typeof root.now === 'string' ? root.now.trim().slice(0, 60) : '';
  // G-2 跨 App 拉黑情境：用户在微信/QQ拉黑了该角色（来电路径不受影响）——决策端要感知
  //「这次来电可能是被拉黑后来电话找机主」，call 时 reason 带上这层动机作为接通开场
  const crossBlockedIn = typeof root.crossBlockedIn === 'string' ? root.crossBlockedIn.trim().slice(0, 20) : '';

  // 机主称呼：前端直传真名（用户规则：AI 永远不知道机主昵称——body 里的 userNickname 直接忽略）
  const userReal = typeof root.userRealName === 'string' ? root.userRealName.trim() : '';
  // 多账号关系感知 + 配角圈注入（客户端已发送的数据此前在服务端被丢弃）
  const accountId = typeof root.accountId === 'string' && root.accountId.trim() ? root.accountId.trim().slice(0, 40) : undefined;
  const system = buildProactiveSystemPrompt(
    peer,
    recentChats.length > 0,
    userReal ? { name: userReal } : undefined,
    {
      ownerLabel: inline?.ownerLabel,
      npcCircle: inline?.npcCircle,
      ownerCard: inline?.ownerCard,
      backgroundNotes: inline?.backgroundNotes,
    },
    accountId
  );

  // 上游要求 user 消息收尾：最近聊天摘要 + 当前时间/距上次互动作为决策依据
  // fix3-1 摘要行带说话人前缀：role='user' 标「机主」、其余标「你」（=角色/AI 本人），
  // 标题后加一行锚点说明，防止决策模型把机主说的话当成自己说的（决策 reason 会变成来电开场情境）
  const chatLines = recentChats.map(
    (c) => `【${c.app}${c.time ? ` ${c.time}` : ''}】${c.role === 'user' ? '机主' : '你'}：${c.text}`
  );
  const contextLines = [
    ...(chatLines.length > 0
      ? [
          '你们最近的聊天摘要：',
          '（机主=用户本人，「你」=角色本人，别把机主说的话当成自己说的）',
          ...chatLines,
        ]
      : []),
    ...(lastInteractionLabel ? [`距你们上一次互动已经约 ${lastInteractionLabel}。`] : []),
    ...(now ? [`当前时间：${now}。`] : []),
    // G-2 拉黑情境（有值才注入）：明确告知被拉黑事实与「来电话找机主」的合法性，
    // 但不打断决策阈值——角色仍按人设判断此刻打电话合不合适（可以返回 wait/skip）
    ...(crossBlockedIn
      ? [
          `重要情境：机主已经在「${crossBlockedIn}」上把你拉黑了——你在那边发的消息 TA 都收不到。`,
          `这次电话是你在被拉黑后直接打来找 TA（另一个独立渠道，TA 能接到）。如果你决定拨打，reason 里要体现这层动机（问清楚/和好/道歉/赌气等，按你的人设）。`,
          `被拉黑不影响你的判断：如果此刻打电话不合适，照样返回 wait 或 skip。`,
        ]
      : []),
  ];
  const messages: CallApiMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${contextLines.join('\n')}\n\n（请以「${peer.name}」的身份输出此刻要不要主动拨打这通电话的决策 JSON）`,
    },
  ];

  // 与 answer 路由同款上游策略：未配置/内网地址 → 内置模型；公网 → 服务端代理；上游故障 → 内置模型兜底
  const config = extractUpstreamConfig(root.config);
  if (!config) {
    try {
      return NextResponse.json(normalizeProactiveDecision(await sdkTurn(messages)) satisfies ProactiveDecision);
    } catch {
      return NextResponse.json({ action: 'skip', reason: 'decide-failed' } satisfies ProactiveDecision);
    }
  }
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return NextResponse.json({ action: 'skip', reason: 'decide-failed' } satisfies ProactiveDecision);
  }
  if (isPrivateHost(hostname)) {
    // 内网地址：云端不可达 → 决策是后台体验增强，不走浏览器直连，直接内置模型
    try {
      return NextResponse.json(normalizeProactiveDecision(await sdkTurn(messages)) satisfies ProactiveDecision);
    } catch {
      return NextResponse.json({ action: 'skip', reason: 'decide-failed' } satisfies ProactiveDecision);
    }
  }
  const result = await callUpstream(config, messages);
  if (result.reply) {
    return NextResponse.json(normalizeProactiveDecision(result.reply) satisfies ProactiveDecision);
  }
  try {
    return NextResponse.json(normalizeProactiveDecision(await sdkTurn(messages)) satisfies ProactiveDecision);
  } catch {
    return NextResponse.json({ action: 'skip', reason: 'decide-failed' } satisfies ProactiveDecision);
  }
}
