import { NextResponse, NextRequest } from 'next/server';
import { promptTextOf } from '@/lib/prompt-entries';

export const runtime = 'nodejs';

/**
 * 记忆库 · 从对话提取记忆碎片
 * POST { conversation: { role: 'me'|'peer', text: string, speakerPrefixed?: boolean }[], app?: string,
 *        scene?: string, userName?: string, peerName?: string, speakerPrefixed?: boolean,
 *        existing?: { id: string, content: string }[], config?: UpstreamConfig }
 * 返回 { fragments: { text, weight, eventTime?, expiresAt?, supersedes? }[] }（0-6 条；
 *       模型未给权重 / 旧格式字符串时由关键词自动分类兜底，见 memory-core.autoWeight）
 * 视角统一：对话两侧用真实名字渲染，碎片必须用同一对名字指代（禁「对方/用户/我」混用）。
 * 前缀去重（#9）：群聊轮次客户端已把「发言人：」前缀拼进 peer 侧 text（多成员归因需要），
 *       载荷 speakerPrefixed（顶层或逐条）为 true 时服务端不再叠 peerName 前缀，
 *       避免「陈默：陈默：火锅！」；向后兼容：不传走老逻辑（无条件加前缀）。
 *       【fix3-a 2a】isConvoTurn 过滤只校验 role/text，原始对象原样保留——群来源轮次
 *       （手动总结/跨 App 兜底）携带的逐条 speakerPrefixed 标记不会在此丢失。
 * 场景说明（【fix3-a 3】extract 不知道场景）：body.app（wx/qq/sms/phone → 微信/QQ/手机短信/电话）
 *       与可选 body.scene（如「语音通话（电话），由机主（用户本人）拨出」）注入 system，
 *       让模型知道对话发生在哪、碎片写明场景归属（「在电话里」「在微信群里」）。
 * 时间感知：prompt 注入当前时间锚点；模型为含时间信息的碎片给出 eventTime/expiresAt（ISO 字符串，
 *       服务端校验范围 ±5 年、过期不得早于事件时间，非法一律置空——绝不让幻觉时间入库）；
 *       矛盾更新：模型对比 existing（已有记忆）给出 supersedes（被更正的旧记忆 id）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';
import { autoWeight, normalizeWeight, MEM_TIME_RANGE_YEARS } from '@/lib/memory-core';

interface ConvoTurn {
  role: 'me' | 'peer';
  text: string;
  /** 逐条前缀标记（#9）：true = 客户端已把「发言人：」拼进 text，服务端不再叠 peerName 前缀 */
  speakerPrefixed?: boolean;
}

function isConvoTurn(v: unknown): v is ConvoTurn {
  if (!v || typeof v !== 'object') return false;
  const r = v as { role?: unknown; text?: unknown };
  return (r.role === 'me' || r.role === 'peer') && typeof r.text === 'string' && r.text.trim().length > 0;
}

/** 名字归一化：去空白、限长（prompt 注入保持紧凑）；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

/** 当前时间锚点（北京时间）：2026年9月16日 星期三 14:32 */
function nowAnchor(now: Date): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const raw = fmt.format(now); // 形如 2026年9月16日星期三 14:32
  return raw.replace('星期', ' 星期');
}

/**
 * 按北京时间（UTC+8）解析时间字符串，与客户端 parseMemTime 同口径；
 * 支持两种格式：
 *   - "YYYY-MM-DD" → 补 T00:00:00+08:00
 *   - "YYYY-MM-DD HH:mm" → 空格替换为 T，附 +08:00
 * 已带时区标识（Z / ±HH:mm）的原样解析，避免重复偏移导致时间错位
 */
function parseBeijingTime(s: string): number {
  const trimmed = s.trim();
  // 已带时区标识：原样解析（Date.parse 能识别 ISO 8601 带时区）
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return Date.parse(trimmed);
  }
  // "YYYY-MM-DD" → 补 T00:00:00+08:00
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}T00:00:00+08:00`);
  }
  // "YYYY-MM-DD HH:mm" → 替换空格为 T，附 +08:00
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed)) {
    return Date.parse(trimmed.replace(' ', 'T') + '+08:00');
  }
  // 其余格式尽力解析（仍按服务器本地时区，作为兜底）
  return Date.parse(trimmed);
}

/** 时间字符串合法性与范围校验（±MEM_TIME_RANGE_YEARS 年），非法返回 null */
function saneTimeStr(v: unknown, nowMs: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  // 按北京时间解析（与客户端 parseMemTime 同口径），避免服务器本地时区导致偏移
  const t = parseBeijingTime(s);
  if (Number.isNaN(t)) return null;
  const span = MEM_TIME_RANGE_YEARS * 366 * 86_400_000;
  if (t < nowMs - span || t > nowMs + span) return null;
  return s;
}

function buildSystem(
  userName: string,
  peerName: string,
  nowLabel: string,
  participants: string[] = [],
  /** 【fix3-a 3】场景说明一行（app 映射 + 群聊标注 + body.scene）；空串 = 无场景可注入 */
  sceneNote = ''
): string {
  // 视角规则：群聊轮次（传了成员名单）允许按实际发言人归因，不再强制「用户/角色」二人视角；
  // 私聊轮次维持两人视角不变
  const perspective = participants.length
    ? [
        '【视角规则（最高优先级，违反即无效）】',
        // 【fix3-a 3】名单展示上限 12→30、解析上限 20→30，并补授权说明：
        // 名单与聊天记录前缀一一对应，前缀里出现的任何成员名都允许使用，绝不能归给机主/AI角色
        `- 这段聊天记录来自群聊，发言者可能不止两个人：除了「${userName}」（用户本人）和「${peerName}」（AI角色），发言者还可能是这些群成员：${participants.slice(0, 30).join('、')}。名单里的名字与聊天记录前缀里的发言人一一对应；聊天记录前缀里出现的任何其他成员名字也都允许使用，绝不能把他们的言行归给机主或AI角色。`,
        '- 每条碎片必须写明说的是谁：主语用聊天记录里实际说话人/被提及者的名字（上面列出的成员名或「' + userName + '」「' + peerName + '」均可）。',
        '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称，严禁混用不同称呼。',
        `- 严禁把其他成员说的话强行归因给「${userName}」或「${peerName}」：群里 C 说的事就写 C，绝不能写成${userName}或${peerName}的事。`,
        `- 例：${userName}明天不上班、${peerName}喜欢打球、${participants[0] ?? '群成员小张'}约了周末爬山。`,
      ]
    : [
        '【视角规则（最高优先级，违反即无效）】',
        `- 这段对话发生在两个人之间：「${userName}」（用户本人）和「${peerName}」（AI角色）。`,
        `- 每条碎片必须写明说的是谁：只允许用「${userName}」和「${peerName}」这两个名字指代两人。`,
        '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称，严禁混用不同称呼。',
        `- 落笔前先判断这条信息是关于谁的（${userName} 还是 ${peerName}），再把名字写进碎片主语。`,
        `- 例：${userName}明天不上班、${peerName}喜欢打球、${peerName}称${userName}为唯一交心的朋友。`,
      ];
  // v63 全局预设管理器：记忆提取提示词接入注册表（mem-extract-perspective / mem-extract-main，
  // 服务端读 /api/settings/prompt-state 同步的内存缓存；原文作 dynamicDefault 零破坏）
  const perspectiveBlock = promptTextOf(
    'mem-extract-perspective',
    { user: userName, peer: peerName },
    perspective.join('\n'),
  );
  const perspectiveLines = perspectiveBlock == null ? [] : perspectiveBlock.split('\n');
  return promptTextOf(
    'mem-extract-main',
    {
      perspective: perspectiveLines.join('\n'),
      sceneNote: sceneNote
        ? `【场景说明】${sceneNote}。\n- 涉及场景的碎片应写明在哪发生的（如『在电话里』『在微信群里』）。`
        : '',
      now: nowLabel,
    },
    [
    '你是聊天记忆整理助手。从一段聊天记录中提取值得长期记住的关键信息，形成「记忆碎片」。',
    ...perspectiveLines,
    // 【fix3-a 3】场景说明：对话发生在哪个 App（wx→微信/qq→QQ/sms→手机短信/phone→电话）、
    // 是否群聊、以及调用方自带场景（如通话方向）；并要求碎片写明场景归属
    ...(sceneNote
      ? [
          `【场景说明】${sceneNote}。`,
          '- 涉及场景的碎片应写明在哪发生的（如『在电话里』『在微信群里』）。',
        ]
      : []),
    '【时间规则（时间感知：记忆要与当前时间联动）】',
    `- 现在是：${nowLabel}（北京时间）。对话里的相对时间（明天/今晚/下周一/3天后/月底）必须按当前时间换算成绝对时间。`,
    '- eventTime：这条信息所指事件的发生时间。有明确或相对时间信息的都填（含日期即可）。',
    '- expiresAt：这条信息预计失效的时间。只有「一次性的安排/状态/临时偏好」才填（例：明天开会→会后失效；最近在减肥→1-2周后失效）；',
    '  身份、性格、长期事实、周期性习惯（每周三打球）一律 null（永不过期）。',
    '- 格式："YYYY-MM-DD"（仅日期）或 "YYYY-MM-DD HH:mm"（精确到时分）；判断不了就留 null，禁止编造。',
    '- supersedes：仅当本条与「已有记忆」中的某条矛盾（更正/状态变化，如旧记「爱吃辣」现在「不吃辣」）时，填被更正的旧记忆 id 数组；单纯重复提及不算矛盾。',
    '提取范围（只提取这三类）：',
    '- 事实：身份、职业、居住地、重要经历、确定的计划安排',
    '- 偏好：喜好、厌恶、习惯、口味、作息',
    '- 承诺：约定好的事、答应要做的事、欠的人情',
    '规则：',
    '- 每条一句话、30 字以内、具体明确（人名/数字/时间尽量保留）',
    '- 只提取对话中明确出现的信息，禁止推测和编造',
    '- 寒暄客套、当下情绪、不产生长期价值的内容不要',
    '- 每条标注 weight（重要程度）：',
    '  · high = 身份/姓名/亲缘关系、承诺约定、过敏忌口等健康禁忌、重大事实（长期稳定不变）',
    '  · low  = 临时安排（明天/下周去哪）、近期状态（最近在做什么）、可能很快过时的偏好',
    '  · normal = 其余一般事实与稳定偏好',
    '- 最多 6 条，没有值得记的就给空数组',
    '只输出 JSON：{"fragments": [{"text": "...", "weight": "high"|"normal"|"low", "eventTime": null|"YYYY-MM-DD HH:mm", "expiresAt": null|"YYYY-MM-DD HH:mm", "supersedes": []}, ...]}',
  ].join('\n'),
  ) ?? '';
}

interface OutItem {
  text: string;
  weight: 'high' | 'normal' | 'low';
  eventTime?: string;
  expiresAt?: string;
  supersedes?: string[];
}

function collect(parsedFragments: unknown[], nowMs: number, validIds: Set<string>): OutItem[] {
  const out: OutItem[] = [];
  for (const x of parsedFragments) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) out.push({ text: t, weight: autoWeight(t) });
    } else if (x && typeof x === 'object') {
      const o = x as { text?: unknown; weight?: unknown; eventTime?: unknown; expiresAt?: unknown; supersedes?: unknown };
      if (typeof o.text === 'string' && o.text.trim()) {
        const item: OutItem = { text: o.text.trim(), weight: normalizeWeight(o.weight, o.text) };
        const et = saneTimeStr(o.eventTime, nowMs);
        const ex = saneTimeStr(o.expiresAt, nowMs);
        // 过期时间不得早于事件时间（荒谬组合防幻觉）：两者都有效且 ex < et 时丢弃 expiresAt；
        // 同样按北京时间解析（与 saneTimeStr 同口径）
        const etMs = et != null ? parseBeijingTime(et) : null;
        const exMs = ex != null ? parseBeijingTime(ex) : null;
        if (et) item.eventTime = et;
        if (ex && (etMs == null || exMs == null || exMs >= etMs)) item.expiresAt = ex;
        if (Array.isArray(o.supersedes)) {
          const ids = o.supersedes
            .filter((id): id is string => typeof id === 'string' && validIds.has(id))
            .slice(0, 6);
          if (ids.length > 0) item.supersedes = ids;
        }
        out.push(item);
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const convo = Array.isArray(body.conversation) ? body.conversation.filter(isConvoTurn) : [];
  if (convo.length < 2) return NextResponse.json({ error: '对话内容太少，无法提取记忆' }, { status: 400 });

  // 视角统一：me=用户本人（真实名字优先），peer=AI 角色；缺省回退固定称呼且全批一致
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');
  // 群聊轮次：发言者名单（成员显示名）——有名单时按实际发言人归因，不再强制二人视角；
  // 【fix3-a 3】解析上限 20→30（与 prompt 内展示上限一致，大群名单不再被截断）
  const participants = Array.isArray(body.participants)
    ? body.participants
        .map((v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 20) : ''))
        .filter((v: string) => v.length > 0)
        .slice(0, 30)
    : [];

  // 【fix3-a 3】场景说明（此前 body.app 从未被使用）：app 映射 + 群聊标注 + 调用方自带 scene，
  // 拼成一行注入 system，让模型知道对话发生在哪、把「在电话里/在微信群里」写进碎片
  const MEM_APP_SCENE: Record<string, string> = { wx: '微信', qq: 'QQ', sms: '手机短信', phone: '电话' };
  const appLabel = typeof body.app === 'string' ? MEM_APP_SCENE[body.app] ?? null : null;
  const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, 120) : '';
  const sceneParts: string[] = [];
  if (appLabel) sceneParts.push(`这段对话发生在${appLabel}里`);
  if (participants.length > 0) sceneParts.push('这段对话来自群聊');
  if (scene) sceneParts.push(`场景：${scene}`);
  const sceneNote = sceneParts.join('；');

  const nowMs = Date.now();
  const now = new Date();

  // 已有记忆（矛盾更新对比用）：只收 id+content，id 必须在列表内 supersedes 才会被采纳
  const existingRaw = Array.isArray(body.existing) ? body.existing : [];
  const existing = existingRaw
    .map((e: unknown) => {
      const o = e as { id?: unknown; content?: unknown };
      return o && typeof o.id === 'string' && typeof o.content === 'string'
        ? { id: o.id.slice(0, 40), content: o.content.slice(0, 80) }
        : null;
    })
    .filter((e: { id: string; content: string } | null): e is { id: string; content: string } => e !== null)
    .slice(0, 30);
  const validIds = new Set(existing.map((e: { id: string }) => e.id));

  // #9 前缀去重：顶层 speakerPrefixed=true → peer 侧全部跳过 peerName 前缀；逐条标记优先于顶层。
  // 兜底识别（客户端暂未传标记的群聊轮次）：participants 非空（群聊提取）且 peer 文本已以任一已知
  // 发言者名开头时同样跳过——群聊客户端本来就逐条拼好「发言人：」前缀，再加一层必然叠成双前缀；
  // 识别不出（发言者改名漂移等）时保持老逻辑补 peerName 前缀，不会比修复前更差
  const topSpeakerPrefixed = body.speakerPrefixed === true;
  const knownSpeakers = [peerName, userName, ...participants]
    .filter((n: string) => n.length > 0)
    .sort((a: string, b: string) => b.length - a.length); // 长名优先（互为前缀的名字短名不误命中）
  const startsWithSpeakerLabel = (text: string): boolean =>
    knownSpeakers.some((n: string) => text.startsWith(`${n}：`) || text.startsWith(`${n}:`));

  const convoText = convo
    // token 精简：提取窗口 60 轮 → 30 轮（每 10 条消息触发一次提取，30 轮已覆盖两次提取间
    // 的全部新对话；原 60 轮×400 字单次 prompt 可达 24k 字符，减半后峰值 12k）
    .slice(-30)
    .map((t) => {
      // 超长截断在返回前统一做，两条路径口径一致
      const clip = t.text.slice(0, 400);
      if (t.role === 'peer' && (t.speakerPrefixed === true || topSpeakerPrefixed)) return clip;
      if (t.role === 'peer' && participants.length > 0 && startsWithSpeakerLabel(clip)) return clip;
      return `${t.role === 'me' ? userName : peerName}：${clip}`;
    })
    .join('\n');

  const existingText =
    existing.length > 0
      ? `\n\n已有记忆（id：内容；仅当本条与其矛盾时才在 supersedes 里填对应 id）：\n${existing
          .map((e: { id: string; content: string }) => `${e.id}：${e.content}`)
          .join('\n')}`
      : '';

  const messages = [
    { role: 'system' as const, content: buildSystem(userName, peerName, nowAnchor(now), participants, sceneNote) },
    { role: 'user' as const, content: `聊天记录：\n${convoText}${existingText}` },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ fragments?: unknown }>(text);
    let items: OutItem[] = [];
    const parsedOk = Boolean(parsed) && Array.isArray(parsed?.fragments);
    if (parsedOk) {
      items = collect(parsed?.fragments as unknown[], nowMs, validIds);
    }
    // JSON 解析失败才按行兜底（解析成功但为空 = 没有值得记的，如实返回空）
    if (items.length === 0 && !parsedOk) {
      items = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((l) => l.length >= 4 && l.length <= 80 && !l.includes('"fragments"'))
        .slice(0, 6)
        .map((t) => ({ text: t, weight: autoWeight(t) }));
    }
    return NextResponse.json({
      fragments: items
        .slice(0, 6)
        .map((it) => ({
          text: it.text.slice(0, 120),
          weight: it.weight,
          eventTime: it.eventTime ?? null,
          expiresAt: it.expiresAt ?? null,
          supersedes: it.supersedes ?? [],
        })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '提取失败' }, { status: 502 });
  }
}
