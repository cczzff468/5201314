'use client';

import { splitActionDescParts } from './action-desc';
import { promptTextOf } from '@/lib/prompt-entries';
import { scopedConvKey } from './ios/accounts';

/**
 * 回复条数（AI 像真人一样一句一句连发多条消息）：
 *
 * - 每个会话独立保存自己的回复条数（sessionKey = wx:<contactId> / qq:<contactId> /
 *   sms:<storageKey>，天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 *   切换角色时各 App 在发送现场读取该角色自己的值，互不影响；
 * - buildReplyCountPrompt：追加在角色人设 system 消息之后，约定「min~N 条」的连发区间语义
 *   （v1.9.33 曾把下限抬到 max(4, floor(N×0.6))；v75b 又收紧过一轮硬性下限；v79 按机主最新定调回摆：
 *   连发目标照旧往 N 靠，但删掉「就算对方只回「嗯」也要拆到下限收尾」「绝不许只发一条结束本轮」
 *   这类硬凑话术，换成「没话说可以少发」的定性豁免——话少自然少发、不硬凑条数，也不再钉死 1~2 条）。
 *   说什么内容完全交给角色人设自由发挥；
 * - replyMinTarget：最低条数目标（v73：max(2, ceil(N×0.6))，夹在 [2, N]——机主定断：
 *   选 3 → 发 2~3 条、选 5 → 发 3~5 条、选 8 → 5~8 条、选 15 → 9~15 条、选 30 → 18~30 条；
 *   有话可超 N 多发、没话可低于下限少发（v79 恢复「没话说可以少发」的定性豁免），
 *   正常回复要落在区间内、目标靠 N。
 *   v74：配套的总线侧「条数不足自动续发」兑底已按机主要求删除（补发内容容易重复/接不上），
 *   条数完全由提示词驱动——生成端不听时按实际产出收尾，客户端不再补齐。
 * - 消息边界 = 「&&&」标记 或 换行 或 句末标点（。！？!? ～〜，不含省略号/半角~）：AI 守「一句一行」
 *   约定时按行切；把多句话写在同一行里时按句子切开（句末标点保留在气泡文本里）——
 *   一句就是一条消息，逐条连发。省略号/逗号这类句中停顿不是边界：切分稳定，不会把
 *   「我……好吧。」撕成两半，也不会按逗号把一句话碎成短句（连发节奏由 AI 生成端按
 *   人设掌握，客户端只按完整句子切）；
 * - v2.4.30（机主反馈）：部分模型会把内部的「response」分隔标记泄漏进正文（气泡里出现
 *   字面 response 单词，如「缺了一块呀[发呆] response 不对不对」）——独立成词的 response
 *   （大小写不敏感）并入边界集合当【分隔符】处理：切分时丢弃、绝不落进气泡文本；
 *   单条模式（不切分）预剥成空格后再输出。
 * - 动作描写（*...*）独立成条：正文里成对星号包裹的描写拆成单独一段（渲染为居中灰字行、
 *   不与正文挤同一气泡，也不会被语音升级吞掉），与五端 action-desc 渲染同口径；
 * - splitReplySegments：把完整回复按边界切成多条消息文本（单条模式 multi=false 只按标记
 *   切分；多条模式按「标记 + 换行 + 句末标点 + 动作描写」稳定切分，不设硬上限——内容多
 *   就多切几条、内容少就少发，绝不把多句话挤回同一个气泡）；v55 全员碎片合并：切出来的段
 *   全是 ≤4 字的碎句时并成一条完整消息（「话少不要拆开说」，含标记/动作/结构字符的段不参与）；
 *   切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案）；
 * - createReplySegmentScanner：流式分段器（聊天流总线使用，「边接收边逐条显示」的核心）——
 *   增量接收原文，每凑齐一条【完整】消息（边界出现、标记闭合）立刻回调 onSegment，由各 App
 *   解析成真实消息排队投递上屏；不设条数上限（回复几条由 AI 生成端决定，切分端每句必切、
 *   绝不把溢出内容堆进最后一条）；连续重复的段直接丢弃；末尾停在未闭合标记里的片段
 *   （祝福语「！」切碎标记）不提前放出，等标记闭合后再扫。
 *   v55 碎片扣住合并：凑齐的 ≤4 字碎句先扣住不投，下一段也碎则并成一条，到不碎的段/收尾时
 *   再放行（下游 splitReplySegments 的全员碎片合并同口径接收，流式与整段两路行为一致）。
 *   全程不阻塞读取上游，退出页面后继续接收的逻辑不受影响。
 */

/** 可选回复条数（v1.9.15：默认 8 条——机主「每次回复 3~8 个消息」；7 与 8 档位几乎无感，替换） */
export const REPLY_COUNT_OPTIONS: readonly number[] = [1, 3, 5, 8, 15, 20, 25, 30];
/** 默认回复条数（v82：8 → 30——机主定调「让他多发点，3~30，多的可以多发，没话了可以少发，
 *  尽量多发」；回复条数选择器仍可逐会话调低（1/3/5/8/15/20/25 档位不变），条数
 *  完全由提示词驱动，客户端不兑底——见 chat-stream-store v74） */
export const DEFAULT_REPLY_COUNT = 30;

const STORE_KEY = 'chat-reply-counts';

/** 多条消息分隔标记：连续 3 个以上「&」（历史约定，兼容仍输出该标记的模型） */
const MARKER_RE = /&{3,}/;

/**
 * 消息边界（正则源）：「&&&」标记 / 换行 / 句末标点 / response 分隔标记。
 * 句末标点取「连续的句终符（。！？!? ～ 〜）+ 紧随的收尾引号/括号」，把「他说“走吧！”」这类
 * 引号收尾整体留在前一条消息末尾；连续标点（！！！/？！/～～）算一个边界，不会切碎。
 * 全角波浪号（～/〜）是口语化句终（「好～」「找到啦～」），与。！？同级算边界；半角「~」
 * 不是（数字范围「3~5」不能被撕开）。
 * 省略号（……）不算边界：它是句中停顿不是句终，「我……好吧。」必须留在同一个气泡里
 * （行尾的省略号由换行边界自然切开，无需单独处理）。
 * v2.4.30（机主反馈）：独立成词的「response」（前后带空白、大小写不敏感）是模型泄漏的
 * 内部分隔标记——算边界分隔符（切分时丢弃，不并进气泡），编译处统一加 i 标志。
 */
const RESPONSE_SEP_SRC = '\\s*\\bresponse\\b\\s*';
const BOUNDARY_SRC = `&{3,}|\\n|[。！？!?～〜]+[”’"』」）)\\]]*|(?:${RESPONSE_SEP_SRC})`;

/** 非 global 版本（加 i 标志：response 分隔标记大小写不敏感）：exec 无 lastIndex 副作用，可复用 */
const BOUNDARY_ONE_RE = new RegExp(BOUNDARY_SRC, 'i');

/** 末尾 1-2 个「&」：可能被拆进下个增量的半截分隔标记 */
const HALF_MARKER_RE = /&{1,2}$/;

/** 看不见的占位字符（与 chat-rich 的 BLANK_CHARS 同集合）：零宽/双向控制/词连接符/盲文空格/韩文填充符等。
 *  String.trim() 不认识它们——只含这些字符的段会穿透「空白过滤」，落成一条完全空白的气泡/语音 */
const BLANK_CHARS = '\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0';

/** 首尾空白 + 不可见占位字符一并剥掉（空白段判定与段内容清洗统一用） */
function trimBlank(s: string): string {
  const head = new RegExp(`^[\\s${BLANK_CHARS}]+`);
  const tail = new RegExp(`[\\s${BLANK_CHARS}]+$`);
  return s.replace(head, '').replace(tail, '');
}

/** 把任意值收窄为合法的回复条数（非法/未提供时回退 fallback） */
export function normalizeReplyCount(v: unknown, fallback: number = DEFAULT_REPLY_COUNT): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN;
  return REPLY_COUNT_OPTIONS.includes(n) ? n : fallback;
}

function loadMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && REPLY_COUNT_OPTIONS.includes(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的回复条数（fallback：该 App 未设置时的默认值；会话键按账号作用域） */
export function getReplyCount(sessionKey: string, fallback: number = DEFAULT_REPLY_COUNT): number {
  const v = loadMap()[scopedConvKey(sessionKey)];
  return typeof v === 'number' ? normalizeReplyCount(v, fallback) : normalizeReplyCount(fallback, fallback);
}

/**
 * 某会话是否【设置过】回复条数（loadMap 已滤掉非法值，true 即存在合法存值）。
 * 预留：跨键探测「用户是否真的选过」的场景用（当前各端均只读本会话自己的键）。
 */
export function hasReplyCount(sessionKey: string): boolean {
  return loadMap()[scopedConvKey(sessionKey)] !== undefined;
}

/** 保存某会话的回复条数（持久化到 localStorage，按会话键+账号隔离） */
export function saveReplyCount(sessionKey: string, n: number): void {
  if (typeof window === 'undefined') return;
  const map = loadMap();
  map[scopedConvKey(sessionKey)] = normalizeReplyCount(n);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

/**
 * 最低条数目标（v82：N ≥ 3 时下限钉 3——机主定调「3~30 尽量多发」，不再按 60% 折算；
 *  N ≤ 2 维持原值（1=单条模式、2 没有多条概念）。选 5 → 3~5 条、选 8 → 3~8 条、选 30 → 3~30 条。
 *  有话可超 N 多发、没话可低于下限少发（v79 的「没话说可以少发」定性豁免仍然成立），
 *  正常回复要落在区间内、目标靠 N。
 *  v74：总线侧「条数不足自动续发」已删（补发内容容易重复/接不上），
 *  该函数只用于拼提示词区间文案，客户端不再用它做补发判定。
 */
export function replyMinTarget(n: number): number {
  const cap = Math.max(1, Math.floor(n) || 1);
  if (cap <= 2) return cap;
  return 3;
}

/**
 * 追加在人设 system 消息之后的「回复条数」指令块。
 * 只约定连发的条数与格式（方便客户端按边界切成多个气泡），说什么内容完全
 * 由角色人设决定；条数语义 = 「min~N 区间：能自然拆就往多拆、不强凑，自然优先」，
 * 条与条之间要有递进，不重复、不空消息凑数。
 * 【100-c】「不要加序号/项目符号/分隔标记」句尾补方括号系统标记豁免——
 * 防这条泛化压制红包/转账/切歌等方括号功能指令的输出。
 */
export function buildReplyCountPrompt(n: number, opts?: { groupMode?: boolean }): string {
  const min = replyMinTarget(n);
  // v63 全局预设管理器：条数指令块接入注册表（reply-count / reply-count-group 可开关、可编辑）；
  // 被关闭时返回空串（调用方拼进 system 的多余空行对模型无影响）
  if (opts?.groupMode) {
    // 群聊模式：单成员发言要给其他成员留空间——上限收敛到 min(N,5)（客户端 GROUP_REPLY_CAP 同口径），
    // 「按群聊节奏」防刷屏保留；v1.9.34 机主反馈「第二次只发一条」：撤掉「实在没话合并成一条」的许可，
    // 下限钉在 2 条（话再少也拆成回应+补充各一句；客户端 chat-stream-store 对只发 1 条的群聊
    // 回复也会自动补一轮「再补 1~2 条」兑底，提示词与兑底同向）
    const cap = Math.max(1, Math.min(Math.floor(n) || 1, 5));
    return promptTextOf('reply-count-group', { cap }, [
      `【连发短消息·群聊节奏】这是群聊，把你这次想说的话拆成一条一条的短消息，一句一条、连续发出来。`,
      `本次发 2~${cap} 条：2 条是下限、${cap} 条是硬上限；话再少也至少拆成 2 条短消息（先回应一句、再补充或追问一句），不要只发一条长消息，也不要发几个字的碎片；其他群成员也要说话，按群聊节奏来，别一个人连发刷屏。`,
      `多条消息之间要有递进：回应 → 补充 → 追问或顺着话题补充，不要原地重复、不要车轱辘话；不允许发空消息凑数。`,
      `每条消息只写一句简短、口语化的话，单独占一行；消息内部不要换行，不要加序号、项目符号或任何分隔标记（方括号系统标记是操作指令，按对应功能块的说明输出，不受这条限制）。`,
    ].join('\n')) ?? '';
  }
  const range = min >= n ? `${n} 条` : `${min}~${n} 条`;
  // v82 连发指令改写（机主定调「让他多发点，3~30，多的可以多发，没话了可以少发，尽量多发」）：
  // 恢复下限压力——「正常至少 3 条起步、只发一两条就停是不合格的」（弱模型需要硬下限才能拆条）；
  // v79 的「没话说可以少发」定性豁免保留（话少时自然少发、不硬凑条数）。
  return promptTextOf('reply-count', { range, n, min }, [
    `【连发短消息】本次回复模仿真人在手机上聊天：像真人抱着手机那样，把想说的话拆成一条一条的短消息连发出来，一句一条、话题往前滚。本次目标发 ${range}——能自然展开就往 ${n} 条靠拢，尽量多发。`,
    `正常至少发 3 条起步：先回应对方刚说的话 → 再补充你的想法或近况 → 再追问或抛个新话题，像真人聊天那样话题往前滚；只发一两条就停是不合格的，除非这轮真的没话说了。`,
    `【连发示例·格式参考】对方说「今天好累」时，真人会这样连发（每条一行，单独占一行）：\n又加班了？\n那个项目还没忙完吗\n别太拼了注意身体\n要不要我陪你聊会天放松下\n——像这样一句一条、话题往前滚，不要只发一条「辛苦了」就结束。内容按你当下情况自由发挥，不要照抄示例的话题。`,
    `话多就放开连发：聊得热闹、情绪上来、想说的多时尽管多发，超过 ${n} 条也没问题，像真人抱着手机聊上头一样。`,
    `没话说可以少发：这轮真的没话说了（话题聊尽、只剩简单回应）时，可以少发几条、自然收尾，不要硬凑条数——宁可自然少发，也不为凑数发空话、废话、重复的话或「嗯/哦/在」这类敷衍短句。`,
    `每条消息只写一句简短、口语化的话，单独占一行；消息内部不要换行，不要加序号、项目符号或任何分隔标记（方括号系统标记是操作指令，按对应功能块的说明输出，不受这条限制）。`,
    `多条消息之间要有递进：像真人连发那样把话题往前推，不要原地重复、不要车轱辘话。`,
    `不允许重复：不要把同一句话或同一个意思换个说法再发一遍；不允许发完全空的消息凑数。`,
  ].join('\n')) ?? '';
}

/**
 * 真机通道（微信/QQ 接入）专用连发指令块（v24 机主定调：「最少发三条，最多没有上限，
 * 实在没话可说了可以少发」）——与站内按会话档位的 buildReplyCountPrompt 不同：
 * - 下限钉 3 条起步（真机上是 TA 在给真人发消息，一条就停不像抱着手机聊天）；
 * - 上限彻底放开——条数没有硬顶，话多尽管连发（发送侧不再有 8/30 条并入末条的截断）；
 * - 保留「实在没话说可以少发」的定性豁免（不硬凑空话凑条数）。
 * 独立于全局预设管理器（真机通道固定生效，不逐会话取档位——站内回复条数选 1 也不该
 * 让真机只回一条：运行包 multi 恒为 true）。
 */
export function buildDeviceBurstPrompt(): string {
  return [
    `【连发短消息】本次回复模仿真人抱着手机聊天：把想说的话拆成一条一条的短消息连发出来，一句一条、话题往前滚。`,
    `本次至少发 3 条起步：先回应TA刚说的话 → 再补充你的想法或近况 → 再追问或抛个新话题；只发一两条就停是不合格的（除非这轮真的没话说了）。`,
    `条数没有上限：聊得热闹、情绪上来、想说的多时尽管一条接一条刷下去，多多益善，像真人聊上头了一样。`,
    `实在没话说了（话题聊尽、只剩简单回应）可以少发几条自然收尾，不要硬凑——宁可自然少发，也不为凑数发空话、废话、重复的话或「嗯/哦/在」这类敷衍短句。`,
    `每条消息只写一句简短、口语化的话，单独占一行；消息内部不要换行，不要加序号、项目符号或任何分隔标记（方括号系统标记是操作指令，按对应功能块的说明输出，不受这条限制）。`,
    `多条消息之间要有递进：像真人连发那样把话题往前推，不要原地重复、不要车轱辘话；不允许把同一句话换个说法再发一遍。`,
  ].join('\n');
}

/**
 * 按消息边界把文本切成原始段（不 trim 不过滤）：
 * 「&&&」标记与换行本身丢弃；句末标点保留在前一条消息末尾（气泡里要看到「！」）。
 */
function splitByBoundaryRaw(text: string): string[] {
  const re = new RegExp(BOUNDARY_SRC, 'gi');
  const out: string[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const end = m.index + m[0].length;
    // 句末标点（。！？!?～〜开头）并入前一条消息；标记/换行/response 分隔符本身丢弃不进气泡
    const isSentence = /^[。！？!?～〜]/.test(m[0]);
    out.push(text.slice(last, isSentence ? end : m.index));
    last = end;
  }
  out.push(text.slice(last));
  return out;
}

/** 去掉首尾空白与不可见占位字符并滤掉空段（切不出任何可见内容时整段丢弃，不生成空白气泡） */
function trimSegs(parts: string[]): string[] {
  return parts.map(trimBlank).filter((s) => s.length > 0);
}

/** 连续重复段去重（不重复：模型卡顿/重试时偶尔原样复读上一句，重复气泡没有信息量） */
function dedupConsecutive(segs: string[]): string[] {
  return segs.filter((s, i) => i === 0 || s !== segs[i - 1]);
}

// ---------------- v55「话少不要拆开说」：碎片段合并 ----------------

/** 碎片段判定上限（可见字符数，Array.from 计数兼容 emoji）：≤4 字的短句算碎片 */
const TINY_MAX_CHARS = 4;
/** 含标记/动作/引号等结构字符的段不参与合并（防把 [红包]、*动作* 与正文黏连破坏解析） */
const TINY_EXCLUDE_RE = /[\[\]{}()（）【】*「」『』“”"'`]/;

function isTinySegment(s: string): boolean {
  return s.length > 0 && !TINY_EXCLUDE_RE.test(s) && Array.from(s).length <= TINY_MAX_CHARS;
}

/** 两个碎片段合并：前段已带句末标点直接拼（「好。」+「嗯。」→「好。嗯。」），否则补一个逗号（「嗯」+「好」→「嗯，好」） */
function joinTinySegments(a: string, b: string): string {
  return /[。！？!?～〜]$/.test(a) ? a + b : `${a}，${b}`;
}

/** 全员碎片 → 合并成一条完整消息：整条回复切出来全是 ≤4 字碎句时并成一个气泡（话少不拆）；
 *  任一段不是碎片（有长句/动作/标记）则原样返回，不影响正常连发节奏 */
function mergeTinySegments(segs: string[]): string[] {
  if (segs.length < 2 || !segs.every(isTinySegment)) return segs;
  return [segs.reduce((acc, s) => joinTinySegments(acc, s))];
}

/** 动作与正文贴合处残留的句中停顿逗号（“*想了想*，好吧”的「，」）：从段首/段尾剥掉，省略号保留 */
const LEADING_PAUSE_RE = /^[，,、；;：:]+/;
const TRAILING_PAUSE_RE = /[，,、；;：:]+$/;

/**
 * 多条模式切分：动作描写独立成条 + 稳定句界切分。
 *
 * 先把成对星号包裹的动作描写整段摘出来（动作段不参与句子切分——描写内部的「。」「！」
 * 不该把一个动作撕成两半），再对剩下的正文段按「&&& 标记 + 换行 + 句末标点」切句；
 * 动作描写单独成一条（渲染为居中灰字行，语音合成读不到它，符合「动作归动作、正文归正文」）。
 */
function splitMultiSegments(content: string): string[] {
  const parts = splitActionDescParts(content);
  if (!parts) return trimSegs(splitByBoundaryRaw(content));
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === 'action') {
      const piece = trimBlank(`*${p.text}*`);
      if (piece.length > 2) out.push(piece); // 剥后只剩星号对的空描写不成条
    } else {
      for (const seg of trimSegs(splitByBoundaryRaw(p.text))) {
        const cleaned = trimBlank(seg.replace(LEADING_PAUSE_RE, '').replace(TRAILING_PAUSE_RE, ''));
        out.push(cleaned.length > 0 ? cleaned : seg);
      }
    }
  }
  return out;
}

// ---------------- v2.4.35 无边界「空格墙/逗号墙」兜底切分（机主截图实测根修） ----------------

/**
 * 弱模型常见的两种「墙」输出（v2.4.35 机主截图实测：AI 把 12 句话用空格连成一行塞进
 * 同一个气泡——整段无换行、无句末标点、无 &&&，BOUNDARY_SRC 一个边界都匹配不到，
 * 流式扫描器全程零产出、收尾整段交出 → 一条巨型气泡 + 只在回复结束时弹一次通知）：
 * - 空格墙：多句话用空格分隔连成一行（「我也想你呀宝宝 修代码累不累呀 要不要先歇会儿…」）；
 * - 逗号墙：多句话只用逗号/顿号相连（无任何句终符），极长时同样按逗号拆回多条。
 *
 * 兜底规则（只在【整段无任何强边界】时启用，正常输出零影响）：
 * - 空格墙：按空白切开后每段都 ≥2 字且含 CJK（英文单词句绝不误拆：任何一个纯 ASCII
 *   词段直接放弃兜底）→ 逐条连发；
 * - 逗号墙：整段 ≥16 字且含 ≥2 个逗号/顿号 → 按逗号拆（「嘿嘿，你认真起来的样子真好看」
 *   这类单逗号短句照旧一条；只有彻底没有句终符的长墙才拆）。
 * 返回 null = 不适用（有强边界/拆不出多段），调用方走正常切分。
 */
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/;
const STRONG_BOUNDARY_RE = /&{3,}|\n|[。！？!?～〜]/;

function splitPunctuationWall(content: string): string[] | null {
  const s = content.trim();
  if (!s || STRONG_BOUNDARY_RE.test(s)) return null; // 有强边界：走正常切分，绝不插手
  // ① 空格墙：按空白拆，每段 ≥2 字且含 CJK（防拆英文/纯数字句）
  if (/\s/.test(s)) {
    const phrases = s.split(/\s+/).map(trimBlank).filter((x) => x.length > 0);
    if (phrases.length >= 2 && phrases.every((p) => Array.from(p).length >= 2 && CJK_RE.test(p))) {
      return dedupConsecutive(phrases);
    }
    // 混了空格但不是纯 CJK 短语墙（如英文句）：继续看逗号墙
  }
  // ② 逗号墙：无任何句终符的长串逗号句（≥16 字且 ≥2 个逗/顿号）按逗号拆回多条
  const commas = (s.match(/[，、]/g) ?? []).length;
  if (Array.from(s).length >= 16 && commas >= 2) {
    const parts = s
      .split(/[，、]/)
      .map((x) => trimBlank(x))
      .filter((x) => x.length > 0);
    if (parts.length >= 2) return dedupConsecutive(parts);
  }
  return null;
}

/**
 * 流结束后把完整回复切成多条消息文本（每条独立入库/渲染）。
 * multi（回复条数 > 1）时按「标记 + 换行 + 句末标点 + 动作描写」稳定切分：一句就是一条消息、
 * 一个动作描写单独成条 —— AI 在一条消息里写了多句、多行也会被拆开，不会把几句话挤进
 * 同一个气泡；不设硬上限（内容多就多切几条、内容少就少发，绝不把溢出句子堆进最后一条）。
 * 单条模式（回复条数 = 1，用户明确要一整条）沿用旧行为只按 &&& 标记切分。
 * 切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案）。
 * v2.4.35：多条模式切完只剩 1 段时再试「空格墙/逗号墙」兜底（见 splitPunctuationWall）——
 * 弱模型无换行无标点的整段输出也能拆回逐条连发，通知跟着逐条即时弹（不再堆到最后一条）。
 */
export function splitReplySegments(content: string, multi = false): string[] {
  if (!multi) {
    // v2.4.30：单条模式不按换行/句界切——泄漏的 response 分隔标记预剥成空格（不产生额外气泡）
    const cleaned = content.replace(/\s*\bresponse\b\s*/gi, ' ');
    const segs = trimSegs(cleaned.split(MARKER_RE));
    return segs.length > 0 ? segs : [''];
  }
  // v55：切分后全员碎片合并（「嗯」「好」「在」这种碎句不再各自成条，并成一条完整消息）
  const segs = mergeTinySegments(dedupConsecutive(splitMultiSegments(content)));
  if (segs.length > 1) return segs;
  // v2.4.35 空格墙/逗号墙兜底：正常边界一根都切不动、整段挤成 1 条时按弱边界拆回多条。
  // 空格拆出的段是模型显式分段（不做碎片合并——「嗯嗯 好的 在的」就是想连发三条短的）
  const wall = splitPunctuationWall(content);
  if (wall && wall.length > 1) return wall;
  return segs.length > 0 ? segs : [''];
}

/**
 * 流式分段器（「边接收边逐条显示」的核心，聊天流总线使用）：
 * 增量接收上游原文，每凑齐一条【完整】消息（边界出现、标记闭合）立刻回调 onSegment，
 * 由各 App 解析成真实消息排队投递上屏 —— 用户看到的是逐条冒出来，不存在先全文后消失。
 *
 * - 不设条数上限：回复几条由 AI 生成端按人设与条数指令决定，切分端每凑齐一条完整句子
 *   就放出一条，绝不把溢出的句子堆进最后一条（最后一条也是完整的一句，气泡长短均匀）；
 * - 空段跳过、连续重复段丢弃（不硬凑、不重复、不空消息）；
 * - 片段末尾停在未闭合标记里（祝福语「生日快乐！」的「！」切碎标记）不提前放出，
 *   游标先越过标记内边界等标记闭合后再重扫；
 * - v55 碎片扣住：≤4 字碎句先扣住不投，与后续碎句并成一条；碰到不碎的段或流结束时
 *   才放行（防「嗯」「好」这种碎句逐条刷屏——话少不拆，与 splitReplySegments 同口径）；
 * - finish()：返回剩余未放出的最后一段（通常是收尾一句没带句末标点的裸行；标记换成
 *   换行、去掉末尾半截「&&」后 trim；无剩余或与上一条重复时返回空串，调用方跳过投递）。
 *   各 App 拿到段后还会过一遍 splitReplySegments(..., true) 稳定再切（动作描写独立成条、
 *   半截标记合并），这里不需要重复那些工作。
 */
export interface ReplySegmentScanner {
  /** 喂入上游增量（纯文本累计，与展示状态无关） */
  push: (delta: string) => void;
  /** 流接收结束：返回剩余的最后一段（可为空串，调用方跳过投递） */
  finish: () => string;
  /**
   * 只读预览：finish() 即将交付的最后一段（不动任何状态，可反复调用）。
   * 通用调试/预览用途；v74 删除总线侧补发循环后聊天总线已不再使用（保留接口兼容）。
   */
  peek: () => string;
}

/** 段内是否有未闭合的「[」（标记被边界切碎时先不放出，等闭合后再扫）。
 *  C11：全角【】同样保护——此前只认半角，【图片：…】被句末标点/流结束切开时半截文本直接上屏 */
function hasOpenBracket(s: string): boolean {
  const half = s.lastIndexOf('[') > s.lastIndexOf(']');
  const full = s.lastIndexOf('\u3010') > s.lastIndexOf('\u3011');
  return half || full;
}

export function createReplySegmentScanner(onSegment: (segment: string) => void): ReplySegmentScanner {
  let full = ''; // 累计收到的原始内容
  let segStart = 0; // 当前未放出片段的起点
  let scanFrom = 0; // 边界搜索游标（≥ segStart；标记未闭合时先越过标记内边界等待闭合）
  let lastEmitted = ''; // 上一条放出的内容（连续重复去重）
  // v55「话少不要拆开说」：凑齐的 ≤4 字碎句先扣住不投——下一段也碎就并成一条继续扣，
  // 碰到不碎的段/流结束时才放行。下游各 App 拿到段后还会过一遍 splitReplySegments(..., true)
  // 稳定再切（把「好。嗯。」切回两句、再被全员碎片合并并回一条），流式与整段两路口径一致。
  let held = ''; // 扣住待合并的碎片段（空串 = 没有扣住的）
  // v75 幂等修复：finish() 只允许真正交出尾段一次。此前 finish() 可重复调用且每次都从
  // segStart 重新切同一段尾文——聊天总线收尾管线会连调三次（①收尾放出 / ②finalize 前放出 /
  // ③finalize.tail 取尾），回复末段没带句末标点时同一条消息被投递三遍（E2E 实测贴纸回合
  // 连出三条一模一样的气泡）。置 finished 后后续 finish 一律返回空串——held 被消费、
  // 尾段已交给首个调用方，后续收尾自然拿空串，不重不漏。
  let finished = false;

  return {
    push(delta) {
      if (!delta) return;
      full += delta;
      for (;;) {
        const m = BOUNDARY_ONE_RE.exec(full.slice(scanFrom));
        if (!m) break;
        const end = scanFrom + m.index + m[0].length;
        // 句末标点（。！？!?～〜开头）并入本条（「你好！」完整弹出）；标记/换行/response 分隔符本身丢弃
        const isSentence = /^[。！？!?～〜]/.test(m[0]);
        const candidate = full.slice(segStart, isSentence ? end : end - m[0].length);
        if (hasOpenBracket(candidate)) {
          // 停在未闭合的标记里：越过标记内边界，等标记闭合后重扫（祝福语带「！」的红包/转账标记）
          scanFrom = end;
          continue;
        }
        // 首尾空白 + 不可见占位字符一并剥掉：只含空白/零宽字符的段按空段处理（不投不占条数），
        // 放出的段内容也不再携带不可见字符（下游各 App 不会再落出空白气泡）
        const trimmed = trimBlank(candidate);
        segStart = end;
        scanFrom = end;
        if (trimmed.length === 0) continue; // 空段（连续换行/标记/不可见字符）：跳过不投
        if (trimmed === lastEmitted) continue; // 与上一条放出的重复：丢弃（不重复）
        if (held) {
          if (trimmed === held) continue; // 与扣住的碎片重复：丢弃（不重复）
          if (isTinySegment(trimmed)) {
            // 下一段也是碎片：并进扣住的段继续等（「嗯」+「好。」→「嗯，好。」）
            held = joinTinySegments(held, trimmed);
            continue;
          }
          // 碰到不碎的段：放行扣住的合并段，再正常处理本段
          onSegment(held);
          lastEmitted = held;
          held = '';
        }
        if (isTinySegment(trimmed)) {
          held = trimmed; // 碎片段先扣住：等下一段决定合并还是放行
          continue;
        }
        onSegment(trimmed);
        lastEmitted = trimmed;
      }
    },
    finish() {
      // 剩余未放出的一段（收尾没带句末标点的裸行 / 溢出内容）：标记换成换行，
      // 半截「&&」与首尾不可见字符不进气泡；各 App 侧会再按稳定边界细切，这里整段交出。
      // v75 幂等：只有第一次调用真正交出尾段（收尾管线会连调多次，重复交出 = 同一条消息投递多遍）
      if (finished) return '';
      finished = true;
      let tail = trimBlank(full.slice(segStart).replace(MARKER_RE, '\n'));
      tail = trimBlank(tail.replace(HALF_MARKER_RE, ''));
      if (held) {
        // 有扣住的碎片：与收尾合并——都碎并成一条完整短消息；收尾不碎用换行隔开整段交出
        //（下游 splitReplySegments 稳定再切按行分开，全员碎片时又会并回，口径一致）
        const h = held;
        held = '';
        if (!tail) return h;
        if (tail === h || tail === lastEmitted) return h;
        if (isTinySegment(tail)) return joinTinySegments(h, tail);
        return `${h}\n${tail}`;
      }
      if (!tail || tail === lastEmitted) return '';
      return tail;
    },
    peek() {
      // finish() 的只读镜像：不消费 held、不推进任何游标——补发判定只读预览，
      // 后续 push 的新增内容仍从原游标继续扫（尾段会与新内容自然拼接成完整段，不重复）。
      // v75：finish 已交出过的尾段，peek 也拿空串（已交给调用方，不再是「即将交付」状态）
      if (finished) return '';
      let tail = trimBlank(full.slice(segStart).replace(MARKER_RE, '\n'));
      tail = trimBlank(tail.replace(HALF_MARKER_RE, ''));
      if (held) {
        if (!tail) return held;
        if (tail === held || tail === lastEmitted) return held;
        if (isTinySegment(tail)) return joinTinySegments(held, tail);
        return `${held}\n${tail}`;
      }
      if (!tail || tail === lastEmitted) return '';
      return tail;
    },
  };
}
