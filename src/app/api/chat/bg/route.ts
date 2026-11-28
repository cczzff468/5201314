import { NextResponse } from 'next/server';
import { pushToAllSubscribers } from '@/lib/server/push-send';
import { broadcastEvent } from '@/lib/server/event-bus';

/**
 * 退出网页后续复（服务端接力）：
 *
 * 用户关闭网页（pagehide）时，客户端用 sendBeacon 把「还没跑完的会话」上报到本端点：
 * - mode='generate'：该会话的流式请求还没 finalize（AI 回复没拿到/没拿全）→ 服务端用同一套
 *   生成链路（内部自调 /api/chat，含上游代理 + 内置模型兜底）把回复生成出来；
 * - mode='deliver'：流已 finalize 但逐条投递（打字节奏）还没落盘完 → 上报现成的消息文本。
 * - mode='cancel'：用户回到网页后自己发了新消息接管了会话 → 丢弃还在生成中的接力回复（防双回复）。
 *
 * 两种方式最终都写入本会话的 pending 队列（内存态），并：
 * ① 尽力给已订阅的浏览器发 Web Push（每条消息一条系统通知，含角色头像 icon——页面已关、
 *    浏览器还开着时也能弹带头像的通知）；
 * ② 向所有 SSE 长连接客户端（/api/events）广播 bg-pending 事件 —— 客户端收到后立即拉取，
 *    替代旧的 2.5s 轮询（多实例部署下广播可能跨不了实例，客户端首拉/回前台拉取保底）。
 * 用户重新打开网页后：聊天页挂载/回前台时 GET ?sessionKey=… 拉取并走各 App 原有投递管线
 * （逐条落盘 + 灵动岛弹窗 + 未读角标）；会话列表页 GET ?peekAll=1 拉各会话条数点亮未读。
 *
 * pending 队列与订阅都存内存/本地文件（.data/），服务重启清空 —— 接力是尽力而为的增强能力。
 *
 * 鉴权（#16，可选共享 token，与 api/push 同款口径）：配置了环境变量 PUSH_SHARED_TOKEN 时，
 * GET/POST 均校验请求头 x-shared-token 必须等于该值，否则 401（防公网部署上被第三方任意
 * 读写接力队列：GET ?sessionKey 读消息体、POST deliver 注入、cancel 清态、peekAll 枚举会话）；
 * 未配置（本地沙箱默认）行为完全不变。前端链路（bg-turn.ts / chat-stream-store.ts）为同源
 * fetch / sendBeacon、不带 token——配置 token 的公网部署上 sendBeacon（无法设自定义头）与
 * 轮询链路会被 401 拒绝，需部署方同步把 token 暴露给前端（与 push 订阅链路 push-client.ts
 * 的既有妥协同一口径）。
 */

export const runtime = 'nodejs';

/** 可选共享 token（#16；环境变量未配置 = 不启用鉴权，历史行为不变；与 api/push 的 PUSH_SHARED_TOKEN 同一变量） */
const TOKEN = process.env.PUSH_SHARED_TOKEN;

/** 共享 token 校验：未配置恒通过；已配置时请求头 x-shared-token 必须精确匹配（同 api/push tokenOk 写法） */
function tokenOk(req: Request): boolean {
  if (!TOKEN) return true;
  try {
    return req.headers.get('x-shared-token') === TOKEN;
  } catch {
    return false;
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

interface PendingItem {
  id: string;
  /** 消息文本数组（generate 模式 = [完整回复原文]；deliver 模式 = 逐条未投递消息文本） */
  texts: string[];
  /** true = texts[0] 是一次完整回复原文（可能含 &&& 分段/动作标记，客户端按单条管线解析） */
  single: boolean;
  /** 会话显示名（客户端 beacon 上报的联系人名；空则推送标题用 App 名） */
  title: string;
  createdAt: number;
}

/** 会话元数据（beacon 上报：显示名 + 压缩后的角色头像 dataURL）→ Web Push 通知 icon 用 */
interface SessionMeta {
  title: string;
  /** 压缩到 ~96px 的头像 dataURL（客户端压缩，服务端只做长度上限）；空 = 无头像 */
  avatar?: string;
}

/** 会话键 → 最近一次 beacon 上报的元数据（内存态；Web Push 通知头像/标题用） */
const sessionMetas = new Map<string, SessionMeta>();
const MAX_METAS = 200;
/** 头像 dataURL 硬上限（客户端已压缩到 ~96px JPEG；超限截断丢弃，宁可不带头像也不能超 Web Push 4KB payload） */
const AVATAR_MAX_CHARS = 2600;

/** 会话键 → 待拉取消息（内存态；服务重启清空） */
const pending = new Map<string, PendingItem[]>();
/** 同一会话同时只跑一次服务端生成（防重复 beacon 叠加重複回复） */
const generating = new Set<string>();
/** 接力取消标记（会话键 → 取消时刻）：用户回到网页自己发消息接管后，仍在生成中的旧接力回复直接丢弃 */
const cancelled = new Map<string, number>();

const MAX_SESSIONS = 200;
// 单会话 pending 上限 50：客户端 Web Push 通知已发出但 pending 队列被裁掉时会出现「通知有但重开网页看不到对应消息」
// 的不一致——拉高上限让短时多轮接力不再丢最早条
const MAX_ITEMS_PER_SESSION = 50;
const MAX_CANCELLED = 50; // cancelled Map 上限：超过淘汰最旧条目（旧 cancel 标记对应的 generate 早已完成）
const MAX_TEXTS = 20;
const TEXT_MAX = 4000;

/* ---------------- generate 限流（#13/#16：防随机/轮换 sessionKey 绕过 generating 去重烧内置模型） ---------------- */

/** 每 sessionKey 每分钟最多发起的真实接力生成次数 */
const GENERATE_RATE_LIMIT = 5;
/** 限流滑动窗口 */
const GENERATE_WINDOW_MS = 60_000;
/** sessionKey → 窗口内最近请求时刻（内存态，服务重启清空） */
const generateHits = new Map<string, number[]>();
/** 限流 Map 上限（只增不减的会话键淘汰最旧，与 cancelled 同款策略） */
const MAX_GENERATE_TRACKED = 500;

/** 全局每分钟最多真实接力生成次数（#16：换 sessionKey 绕过 per-session 限流的总闸） */
const GLOBAL_GENERATE_RATE_LIMIT = 30;
/** 全局滑动窗口内最近请求时刻（模块级数组，内存态，服务重启清空；单线程事件循环内读写） */
const globalGenerateHits: number[] = [];

/** 全局滑动窗口限流：语义与 generateRateLimited 一致——未超限记一笔并返回 false；超限返回 true（本次不记，不刷新窗口） */
function globalGenerateRateLimited(): boolean {
  const now = Date.now();
  while (globalGenerateHits.length > 0 && now - globalGenerateHits[0] >= GENERATE_WINDOW_MS) {
    globalGenerateHits.shift();
  }
  if (globalGenerateHits.length >= GLOBAL_GENERATE_RATE_LIMIT) return true;
  globalGenerateHits.push(now);
  return false;
}

/** 滑动窗口限流：未超限记一笔并返回 false；超限返回 true（本次不记，不刷新窗口） */
function generateRateLimited(sessionKey: string): boolean {
  const now = Date.now();
  const hits = (generateHits.get(sessionKey) ?? []).filter((t) => now - t < GENERATE_WINDOW_MS);
  if (hits.length >= GENERATE_RATE_LIMIT) {
    generateHits.set(sessionKey, hits);
    return true;
  }
  hits.push(now);
  generateHits.set(sessionKey, hits);
  if (generateHits.size > MAX_GENERATE_TRACKED) {
    const first = generateHits.keys().next().value;
    if (first) generateHits.delete(first);
  }
  return false;
}

function appDefaultName(sessionKey: string): string {
  if (sessionKey.startsWith('wx:group:')) return '微信群聊';
  if (sessionKey.startsWith('wx:')) return '微信';
  if (sessionKey.startsWith('qq:group:')) return 'QQ群聊';
  if (sessionKey.startsWith('qq:')) return 'QQ';
  return '信息';
}

/**
 * v1.9.8 接力横幅预览净化：完整回复原文（可能含 &&& 分段、[拍照:…] / [语音] 等动作标记）
 * → 横幅一条预览文本。只用于守望者横幅展示，不参与投递（投递仍由聊天页 buildReplyMsgs
 * 按各端语义完整解析）。净化不出可读文本时回退 [新消息]。
 * v2.4.29（第四十八轮）：max 参数化——横幅预览沿用 100 字；系统通知的大文本展开需要
 * 更长的原文（BigTextStyle 展示完整最新一条，上限 600 字）。
 */
function relayPreviewText(raw: string, max = 100): string {
  let t = (raw || '').split('&&&')[0] ?? '';
  // v2.4.33（机主截图实测：通知正文裸露「[手机操作:锁定:com.tencent.mobileqq:10]」）：
  // [手机操作:…] 兜底标记整条剥除——标记可能带长包名（>30 字），旧版「≤30 字短标记」
  // 限长剥不干净；标记是给聊天页执行的指令，绝不进通知正文。任意长度、优先剥。
  t = t.replace(/\[手机操作:[^\[\]]*\]/g, ' ');
  // 剥方括号动作/媒体标记（[拍照:xxx] [语音] [图片] 等；只剥 ≤30 字的短标记，防误伤长正文）
  t = t.replace(/\[[^\[\]]{1,30}\]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || '[新消息]';
}

/** v2.4.27（第四十六轮·后台通知原生轮询）：与客户端 bg-relay-watcher 完全一致的
 *  djb2 短哈希——服务端直接产出 batchKey（`${key}#${count}#${hash}`），Java 侧
 *  原样转存，客户端回前台时据此把「原生已弹过横幅/通知的批次」并入 seen 集合，
 *  两端去重口径一字不差。 */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * v2.4.29（第四十八轮·通知排版根修）：完整回复原文 → 逐条消息文本。
 *
 * 机主反馈：AI 连发多条时系统通知把全部文本揉成一大段（「mua收到啦嘿嘿 你今天怎么这么会呀…」）。
 * 根因：旧版 single 模式只按 &&& 拆分——而多句回复（无 &&&、以换行分段）整段留在同一条
 * 「消息」里，relayPreviewText 又把换行折叠成空格 → 一条通知正文 = 全部消息无缝拼接。
 *
 * v2.4.31（「通知与聊天界面实时同步」根修·切句口径对齐）：与客户端 reply-count.ts 的
 * BOUNDARY_SRC 切句边界完全同构——
 * · 「&&&」标记 / 换行 / response 分隔标记 = 边界（本身丢弃）；
 * · 句末标点（。！？!?～〜 + 紧随收尾引号〃’"』」））也 = 边界，但标点与引号【并入前一条末尾】
 *   （「他说“走吧！”」引号收尾整体留在前一条，与客户端一致）；
 * · 未闭合 [ / 【 的段先扣住等闭合（祝福语「！」切碎标记的场景）；
 * · 空段跳过、连续重复去重、全员 ≤4 字碎句并成一条（mergeTinySegments 同口径）。
 * 修复：旧版只按 &&&+换行拆——模型单行长文（无换行）时通知侧 1 条、聊天页落库 N 条
 * （机主反馈「悬浮弹窗弄成一条」「AI 偶尔只发一条」的来源之一）；对齐后
 * 「通知弹几条 = 快照落几条 = 聊天页正式投递几条」三口径一致。
 */
function splitSingleReply(raw: string): string[] {
  const full = raw || '';
  // 与客户端 reply-count.ts 同構的边界（非 global：exec 无 lastIndex 副作用，游标手动推进）
  const BOUNDARY_ONE_RE = /&{3,}|\n|[。！？!?～〜]+[”’"』」）)\]]*|\s*\bresponse\b\s*/i;
  const SENTENCE_HEAD_RE = /^[。！？!?～〜]/;
  const BLANK_CHARS = '\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0';
  const trimBlank = (s: string): string =>
    s.replace(new RegExp(`^[\\s${BLANK_CHARS}]+`), '').replace(new RegExp(`[\\s${BLANK_CHARS}]+$`), '');
  const hasOpenBracket = (s: string): boolean =>
    s.lastIndexOf('[') > s.lastIndexOf(']') || s.lastIndexOf('\u3010') > s.lastIndexOf('\u3011');
  // 碎句判定与合并（同口径：≤4 字、无结构字符；前段带句末标点直接拼，否则补逗号）
  const TINY_EXCLUDE_RE = /[\[\]{}()（）【】*「」『』“”"'`]/;
  const isTiny = (s: string): boolean =>
    s.length > 0 && !TINY_EXCLUDE_RE.test(s) && Array.from(s).length <= 4;
  const joinTiny = (a: string, b: string): string =>
    (/[。！？!?～〜]$/.test(a) ? a + b : `${a}，${b}`);

  const out: string[] = [];
  let lastEmitted = '';
  let held = '';
  const emit = (seg: string): void => {
    if (!held) {
      if (isTiny(seg)) {
        held = seg; // 碎句先扣住：等下一段决定合并还是放行
        return;
      }
      out.push(seg);
      lastEmitted = seg;
      return;
    }
    if (seg === held) return; // 与扣住的碎片重复：丢弃
    if (isTiny(seg)) {
      held = joinTiny(held, seg); // 下一段也碎：并进扣住的段继续等
      return;
    }
    out.push(held); // 碰到不碎的段：放行扣住的合并段，再正常处理本段
    lastEmitted = held;
    held = '';
    out.push(seg);
    lastEmitted = seg;
  };

  let segStart = 0;
  let scanFrom = 0;
  for (;;) {
    const m = BOUNDARY_ONE_RE.exec(full.slice(scanFrom));
    if (!m) break;
    const end = scanFrom + m.index + m[0].length;
    // 句末标点（。！？!?～〜开头）并入本条（「你好！」完整弹出）；标记/换行/response 分隔符本身丢弃
    const isSentence = SENTENCE_HEAD_RE.test(m[0]);
    const candidate = full.slice(segStart, isSentence ? end : end - m[0].length);
    if (hasOpenBracket(candidate)) {
      // 停在未闭合的标记里：越过标记内边界，等标记闭合后重扫（祝福语带「！」的红包/照片标记）
      scanFrom = end;
      continue;
    }
    const trimmed = trimBlank(candidate);
    segStart = end;
    scanFrom = end;
    if (trimmed.length === 0) continue; // 空段（连续换行/标记/不可见字符）：跳过
    if (trimmed === lastEmitted) continue; // 与上一条重复：丢弃
    emit(trimmed);
  }
  // 收尾尾段（没带句末标点的裸行）；有扣住的碎片时一併处理（都碎并成一条，不碎用空格隔开交出）
  let tail = trimBlank(full.slice(segStart).replace(/&{3,}/g, '\n').replace(/&{1,2}$/, ''));
  if (held) {
    if (!tail) out.push(held);
    else if (isTiny(tail)) out.push(joinTiny(held, tail));
    else if (tail === held || tail === lastEmitted) out.push(held);
    else {
      out.push(held);
      out.push(tail);
    }
  } else if (tail && tail !== lastEmitted) {
    out.push(tail);
  }
  return out;
}

/** v2.4.28（第四十七轮）：pollNative / peekAll(preview) 共用的逐条消息构建：
 *  single 模式按 &&& + 换行拆分（v2.4.29 补齐，见 splitSingleReply），deliver 模式每条
 *  text 即一条消息；文本走 relayPreviewText 净化（通知预览/大文本展开共用，600 字上限）；
 *  id 稳定（`${item.id}#${i}`）。
 *  createdAt = 所属 PendingItem 的入队时刻（v2.4.28 新增）——原生 BgNotifyPoller 用它
 *  区分「退后台前就躺在队列里的旧消息」与「退后台瞬间/之后到达的新消息」，
 *  修 deliver 接力与边界轮询的竞态（旧实现把刚入队的新消息标记已见导致永不弹通知）。 */
function buildRelayMessages(
  arr: PendingItem[],
): { id: string; text: string; createdAt: number }[] {
  const messages: { id: string; text: string; createdAt: number }[] = [];
  arr.forEach((item) => {
    if (item.single) {
      splitSingleReply(item.texts.join('')).forEach((line, i) => {
        const txt = relayPreviewText(line, 600);
        if (txt && txt !== '[新消息]') messages.push({ id: `${item.id}#${i}`, text: txt, createdAt: item.createdAt });
      });
    } else {
      item.texts.forEach((t, i) => {
        const txt = relayPreviewText(t, 600);
        if (txt && txt !== '[新消息]') messages.push({ id: `${item.id}#${i}`, text: txt, createdAt: item.createdAt });
      });
    }
  });
  return messages;
}

function enqueue(sessionKey: string, texts: string[], single: boolean, title: string): PendingItem {
  const item: PendingItem = {
    id: `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    texts,
    single,
    title,
    createdAt: Date.now(),
  };
  const arr = pending.get(sessionKey) ?? [];
  arr.push(item);
  if (arr.length > MAX_ITEMS_PER_SESSION) arr.splice(0, arr.length - MAX_ITEMS_PER_SESSION);
  pending.set(sessionKey, arr);
  if (pending.size > MAX_SESSIONS) {
    const first = pending.keys().next().value;
    if (first) pending.delete(first);
  }
  const meta = sessionMetas.get(sessionKey);
  // ① SSE 广播：在线客户端收到后立即拉取（废除轮询的核心通道）
  broadcastEvent('bg-pending', {
    sessionKey,
    count: item.texts.length,
    title: title || meta?.title || '',
    at: item.createdAt,
  });
  // ② Web Push：页面已关/已冻结时的系统通知（带角色头像；发送/失效清理在 push-send 内）
  // target（sessionKey 反解的点击跳转目标）随载荷下发 —— 用户点开关页期间的
  // 推送通知，页面重开后直达对应会话，不再裸开首页。
  // v2.4.29（第四十八轮）：messages 传拆分后的逐条消息（旧版传原始 texts——single 模式
  // 整段原文会被拼成一条大段落通知）；push-send 内部按新口径合并成「角色名：发来了 N 条新消息」
  const relayTarget = relayTargetOf(sessionKey);
  void pushToAllSubscribers(
    {
      title: title || meta?.title || appDefaultName(sessionKey),
      ...(meta?.avatar ? { icon: meta.avatar } : {}),
      ...(relayTarget ? { target: relayTarget } : {}),
    },
    item.single ? splitSingleReply(texts.join('')) : texts,
  );
  return item;
}

/** v1.9.9：sessionKey → NotifyTarget 同构纯对象（与客户端 parseSessionTarget 同规则；解析不出返回 undefined） */
function relayTargetOf(sessionKey: string): { app: 'wechat' | 'qq' | 'chat'; contactId?: string; groupId?: string } | undefined {
  let m = /^wx:group:(.+)$/.exec(sessionKey);
  if (m) return { app: 'wechat', groupId: m[1] };
  m = /^wx:(.+)$/.exec(sessionKey);
  if (m) return { app: 'wechat', contactId: m[1] };
  m = /^qq:group:(.+)$/.exec(sessionKey);
  if (m) return { app: 'qq', groupId: m[1] };
  m = /^qq:(.+)$/.exec(sessionKey);
  if (m) return { app: 'qq', contactId: m[1] };
  m = /^sms:c:(.+)$/.exec(sessionKey);
  if (m) return { app: 'chat', contactId: m[1] };
  if (sessionKey.startsWith('sms:')) return { app: 'chat' };
  return undefined;
}

/* ---------------- Web Push ----------------
 * 发送实现已抽到 /lib/server/push-send（全订阅广播 + 404/410 失效清理），
 * 供本路由与未来其他「服务端产生对方消息」的路径共用；存储在 /lib/server/push-store。 */

/* ---------------- 服务端生成（复用 /api/chat 全链路：上游代理 + SDK 兜底） ---------------- */

interface BgPayload {
  messages?: unknown;
  config?: unknown;
}

/**
 * v2.4.32（机主规格「AI 发出来信息立马就弹通知，不等他回复完」）：
 * 流式增量入队——服务端接力不再「等整段回复生成完才一次性入队」（那是后台通知
 * 全部堆在回复结束才弹 + 铃声连响一串的根因），改为边生成边入队：
 * - /api/chat 的响应本身就是流式 text/plain（上游 SSE → 文本流）：逐块读取，
 *   凑齐一条完整消息（换行 / &&& 硬边界闭合）立刻 enqueue 成独立 PendingItem
 *   （single=false，一条 text）——原生轮询器（4s 快节奏）/ Web Push / SSE 广播
 *   马上就能看到它：AI 每发一条，系统通知 + 铃声立即弹一次；
 * - 收尾剩余尾段（无换行的最后一句）流结束时入队；整段回复一个硬边界都没有
 *   （单行长文）时维持旧口径整段入队（single=true，客户端按完整回复解析）；
 * - 每次入队前检查接力取消标记（用户回页发新消息接管）——标记一次性消费，
 *   用本地 latched 旗标保证取消后后续分段绝不入队。
 */
async function generateAndEnqueue(sessionKey: string, payload: BgPayload, title: string): Promise<void> {
  // 生成开始时刻：cancel 只丢弃「取消前已开始的生成」（用户回页发新消息接管，迟到的旧接力回复作废）；
  // 取消之后新开始的生成（用户接管后又关页）不受影响。deliver 模式永不取消（丢现成消息比多一条更糟）。
  const startedAt = Date.now();
  let cancelledFlag = false;
  const checkCancel = (): boolean => {
    if (cancelledFlag) return true;
    const at = cancelled.get(sessionKey);
    if (at === undefined) return false;
    cancelled.delete(sessionKey);
    if (at > startedAt) cancelledFlag = true;
    return cancelledFlag;
  };
  try {
    const messages = Array.isArray(payload.messages) ? payload.messages : null;
    if (!messages) {
      if (!checkCancel()) enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
      return;
    }
    const port = process.env.PORT || '3000';
    /**
     * 流式生成 + 增量入队：返回是否成功启动读取（true = 已按流处理，包括「整段无硬边界」
     * 的收尾整段入队；false = 请求失败，调用方走 forceSdk 兜底/占位文案）。
     */
    const streamOnce = async (extra: Record<string, unknown>): Promise<boolean> => {
      // v2.4.33（机主反馈「系统通知有时候不通知」根修之一）：fetch 挂死防线——上游/
      // /api/chat 网络栈偶发挂起（TCP 半开、上游代理无响应）时旧版 fetch 永不 resolve，
      // generateAndEnqueue 的 finally 永不执行 → generating 集合永久残留该会话 →
      // 该会话后续所有接力 beacon 全部 scheduled:false 被去重吞掉 → 后台回复一条都不
      // 生成、一条通知都不弹（直到服务重启）。5 分钟硬超时兜底：超时按失败收场走
      // forceSdk/占位文案，finally 正常清 generating，会话接力链路绝不死锁。
      const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, ...extra }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok || !res.body) return false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let emittedAny = false;
      // [思考]…[/思考] 深度思考块跨多行：增量分段必须整块丢弃（客户端流式管线同款语义——
      // 思考内容绝不进气泡/通知；旧口径 single=true 时靠客户端 buildReplyMsgs 兜底剥，
      // 但通知侧 splitSingleReply 没剥——思考文本曾有机会漏进系统通知，这里一并根修）
      let inThink = false;
      // 未闭合 [ / 【 的段先扣住等闭合（与 splitSingleReply 的 hasOpenBracket 同口径：
      // 祝福语「！」切碎红包/照片标记的场景；跨段的标记在此拼回原样）
      let held = '';
      /** 段处理：思考块丢弃 + 未闭合标记扣留 + 净化后入队 */
      const emitSegment = (segRaw: string): void => {
        let piece = held + segRaw;
        held = '';
        if (inThink) {
          const closeIdx = piece.indexOf('[/思考]');
          if (closeIdx < 0) return; // 还在思考块里：整段丢弃
          inThink = false;
          piece = piece.slice(closeIdx + '[/思考]'.length);
        }
        const openIdx = piece.indexOf('[思考]');
        if (openIdx >= 0) {
          const before = piece.slice(0, openIdx);
          const rest = piece.slice(openIdx + '[思考]'.length);
          const closeIdx = rest.indexOf('[/思考]');
          if (closeIdx >= 0) piece = before + rest.slice(closeIdx + '[/思考]'.length);
          else {
            inThink = true;
            piece = before;
          }
        }
        const t = piece.trim().slice(0, TEXT_MAX);
        if (!t) return;
        if (checkCancel()) return;
        enqueue(sessionKey, [t], false, title);
        emittedAny = true;
      };
      const scanBoundaries = (): void => {
        // 非全局正则（无 lastIndex 副作用）；从 buf 头部逐个找硬边界，闭合即出段
        const BOUNDARY = /&{3,}|\n/;
        for (;;) {
          const m = BOUNDARY.exec(buf);
          if (!m) break;
          const seg = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          // 未闭合半角 [ / 全角【（splitSingleReply 同款）：扣住拼下一段（照片/红包标记
          // 内部的换行/句末标点不是消息边界）；思考块期间不扣（整块本来就丢弃）
          const hasOpenBracket =
            !inThink && (seg.lastIndexOf('[') > seg.lastIndexOf(']') || seg.lastIndexOf('\u3010') > seg.lastIndexOf('\u3011'));
          if (hasOpenBracket) {
            held += seg;
            continue;
          }
          emitSegment(seg);
        }
      };
      // 读取循环内部容错：中途断流时已入队过分段绝不外抛（外层会 forceSdk 重试 →
      // 重复弹通知/落库），按「部分完成」收场；一段都没入队过才返回 false 允许重试
      let readErr = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            buf += decoder.decode(value, { stream: true });
            scanBoundaries();
          }
        }
        buf += decoder.decode();
      } catch {
        readErr = true;
      }
      if (readErr) return emittedAny;
      // 尾段：扣住的未闭合标记残余 + 最后一句一起收尾（未闭合标记原样交客户端，
      // stripUnfinishedPhotoTag 兜底剥除防半截上屏）
      const tail = held + buf;
      held = '';
      if (tail.trim()) emitSegment(tail);
      // 整段一个硬边界都没有（单行长文）：维持旧口径整段入队（single=true，
      // 客户端按完整回复解析 + 通知侧 splitSingleReply 切句逐条弹；思考块先剥净）
      if (!emittedAny && !cancelledFlag) {
        const full = buf
          .replace(/\[思考\][\s\S]*?\[\/思考\]/g, '')
          .replace(/\[思考\][\s\S]*$/g, '')
          .trim();
        if (full) enqueue(sessionKey, [full.slice(0, TEXT_MAX)], true, title);
        else return false; // 空回复：让调用方走兜底
      }
      return true;
    };
    // 先按用户配置的原链路生成（上游代理 / 内置模型）；失败（含局域网地址 directOnly 502、
    // 上游断网、空回复）再用内置模型兜底一次 —— 用户关页前的最后一句话必须有人接，
    // 否则重开网页前回复永远不出现（日志实测：上游为内网地址时第一路必然 502）
    const okStream = await streamOnce(payload.config && typeof payload.config === 'object' ? { config: payload.config } : {}).catch(() => false);
    if (!okStream) {
      try {
        const okSdk = await streamOnce({ forceSdk: true });
        if (!okSdk && !checkCancel()) {
          enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
        }
      } catch {
        // 兜底也失败 → 占位文案
        if (!checkCancel()) enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
      }
    }
  } catch {
    if (!checkCancel()) enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
  } finally {
    generating.delete(sessionKey);
  }
}

/* ---------------- 路由 ---------------- */

export async function POST(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as
    | {
        mode?: unknown;
        sessionKey?: unknown;
        payload?: BgPayload;
        texts?: unknown;
        single?: unknown;
        meta?: { title?: unknown; avatar?: unknown; app?: unknown };
      }
    | null;
  if (!body || typeof body.sessionKey !== 'string' || !body.sessionKey.trim() || body.sessionKey.length > 160) {
    return NextResponse.json({ error: 'sessionKey 无效' }, { status: 400 });
  }
  const sessionKey = body.sessionKey;
  const title = typeof body.meta?.title === 'string' ? body.meta.title.slice(0, 60) : '';
  // 会话元数据（标题 + 压缩头像）登记：Web Push 通知 icon 与标题兜底用。
  // generate/deliver 都带 meta；头像必须以 data:image/ 开头且不超上限（超限丢弃，宁缺勿炸 payload）。
  if (title || (typeof body.meta?.avatar === 'string' && body.meta.avatar.startsWith('data:image/'))) {
    const rawAvatar = typeof body.meta?.avatar === 'string' ? body.meta.avatar : undefined;
    sessionMetas.set(sessionKey, {
      title,
      ...(rawAvatar && rawAvatar.length <= AVATAR_MAX_CHARS ? { avatar: rawAvatar } : {}),
    });
    if (sessionMetas.size > MAX_METAS) {
      const first = sessionMetas.keys().next().value;
      if (first) sessionMetas.delete(first);
    }
  }

  if (body.mode === 'generate') {
    // 流式没跑完就关页：服务端接管生成。同一会话进行中不重复接（防双回复）
    if (generating.has(sessionKey)) return NextResponse.json({ ok: true, scheduled: false });
    // 内存限流（#13）：每 sessionKey 每分钟 ≤5 次真实接力生成，超限 429
    // （放在 generating 去重之后：去重命中的空 beacon 不占限流额度）
    if (generateRateLimited(sessionKey)) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 });
    }
    // 全局限流（#16）：全部会话合计每分钟 ≤30 次真实接力生成，防轮换 sessionKey 绕过
    // per-session 限流烧内置模型；同样放在去重之后（空 beacon 不占全局额度），且 per-session
    // 限流命中时在这之前已 429 返回，不消耗全局额度
    if (globalGenerateRateLimited()) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 });
    }
    const messages = Array.isArray(body.payload?.messages) ? body.payload?.messages : null;
    if (!messages || messages.length === 0) return NextResponse.json({ error: 'payload 无效' }, { status: 400 });
    // 新接力开始：清掉旧取消标记（上一轮的取消不应影响本轮）
    cancelled.delete(sessionKey);
    generating.add(sessionKey);
    void generateAndEnqueue(sessionKey, { messages, config: body.payload?.config }, title);
    return NextResponse.json({ ok: true, scheduled: true });
  }

  if (body.mode === 'cancel') {
    // 用户回页后自己发了新消息：正在生成中的接力回复作废（生成完成时发现标记即丢弃，防双回复）
    cancelled.set(sessionKey, Date.now());
    // 上限淘汰最旧条目：cancelled Map 按 sessionKey 累积永不释放，超过 MAX_CANCELLED 时
    // 丢掉最早写入的（旧 cancel 标记对应的 generate 早已完成，淘汰无副作用）
    if (cancelled.size > MAX_CANCELLED) {
      const firstKey = cancelled.keys().next().value;
      if (firstKey) cancelled.delete(firstKey);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.mode === 'consume') {
    // 客户端已接手投递：清除该会话待拉取队列（读拉/写清分离，修复 StrictMode 双挂载竞态丢消息）
    consumePending(sessionKey);
    return NextResponse.json({ ok: true });
  }

  if (body.mode === 'deliver') {
    // 投递没落盘完就关页：现成消息文本直接入队（客户端拉取后按普通消息逐条投递）
    const texts = Array.isArray(body.texts)
      ? body.texts
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .slice(0, MAX_TEXTS)
          .map((t) => t.slice(0, TEXT_MAX))
      : [];
    if (texts.length === 0) return NextResponse.json({ ok: true, queued: 0 });
    const item = enqueue(sessionKey, texts, body.single === true, title);
    return NextResponse.json({ ok: true, queued: item.texts.length });
  }

  return NextResponse.json({ error: 'mode 无效' }, { status: 400 });
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const sp = new URL(req.url).searchParams;

  // 会话列表角标查询：各会话待拉取消息条数（不清除；客户端对已提示过的条目去重）
  // v1.9.8 preview=1：附带每会话 { count, title, avatar?, preview } —— 全局接力守望者
  //（bg-relay-watcher）用它不进 APP 直接弹灵动岛横幅：标题/头像用 beacon 上报的会话元数据，
  // preview 用第一批第一条文本的净化预览（剥分段/动作标记，只做横幅预览不参与投递）
  if (sp.get('peekAll')) {
    const counts: Record<string, number> = {};
    const previews: Record<
      string,
      {
        count: number;
        title: string;
        avatar?: string;
        preview: string;
        /** v2.4.28（第四十七轮）：逐条消息（id/文本）——网页守望者据它逐条弹通知，
         *  不再把一批消息合并成一条横幅（机主规格「AI 发几条消息就弹几次」） */
        messages?: { id: string; text: string }[];
      }
    > = {};
    const wantPreview = sp.get('preview') === '1';
    pending.forEach((arr, key) => {
      const n = arr.reduce((s, it) => s + it.texts.length, 0);
      if (n <= 0) return;
      counts[key] = n;
      if (!wantPreview) return;
      const first = arr[0];
      const meta = sessionMetas.get(key);
      const msgs = buildRelayMessages(arr);
      previews[key] = {
        count: n,
        title: meta?.title || first?.title || appDefaultName(key),
        ...(meta?.avatar ? { avatar: meta.avatar } : {}),
        preview: relayPreviewText(first?.texts?.[0] ?? ''),
        ...(msgs.length > 0 ? { messages: msgs.map(({ id, text }) => ({ id, text })) } : {}),
      };
    });
    return wantPreview
      ? NextResponse.json({ counts, previews })
      : NextResponse.json({ counts });
  }

  // v2.4.27（第四十六轮·后台通知根修）：APK 原生轮询专用视图 pollNative=1。
  // 背景：WebView 退后台 JS 被冻结——bg-relay-watcher/系统通知只在回前台才跑，
  // 机主反馈「点进去 APP 通知和悬浮通知才出现」。原生壳（BgNotifyPoller）改为
  // 每 10s 直接 GET 本视图：每会话返回【逐条消息】（id 稳定 = `${item.id}#${i}`，
  // 原生按 id 去重后每条弹一条 heads-up 通知——「AI 发几条就弹几次」）+ batchKey
  // （与客户端守望者去重键完全同构：`${key}#${count}#${hash(preview)}`）。
  // v2.4.28（第四十七轮）：每条消息附带 createdAt（入队时刻）——原生边界轮询用它
  // 区分「退后台前的旧存货」与「退后台后到达的新消息」，修 deliver 接力竞态
  // （旧实现竞态下把刚入队的新消息标已见 → 永不弹通知 → 点回 APP 才看到）。
  // 只读不消费：正式投递/落盘仍由聊天页拉取（GET ?sessionKey= + consume）完成，
  // 客户端回前台时用 consumeBgNotified 把原生已弹过的 batchKey 并入 seen 集合防双弹。
  if (sp.get('pollNative')) {
    const sessions: Record<
      string,
      {
        batchKey: string;
        count: number;
        title: string;
        avatar?: string;
        target?: { app: string; contactId?: string; groupId?: string };
        messages: { id: string; text: string; createdAt: number }[];
      }
    > = {};
    pending.forEach((arr, key) => {
      const rawCount = arr.reduce((s, it) => s + it.texts.length, 0);
      if (rawCount <= 0) return;
      const first = arr[0];
      const meta = sessionMetas.get(key);
      const preview = relayPreviewText(first?.texts?.[0] ?? '');
      // 逐条消息：single 模式按 &&& 拆分（客户端 buildReplyMsgs 同款分段口径），
      // deliver 模式每条 text 即一条消息；文本走 relayPreviewText 净化（通知预览用）
      const messages = buildRelayMessages(arr);
      if (messages.length === 0) return;
      const relayTarget = relayTargetOf(key);
      sessions[key] = {
        // 去重键与守望者 peekAll 视图口径一字不差（count 用原始 texts 总数）
        batchKey: `${key}#${rawCount}#${hashStr(preview)}`,
        count: rawCount,
        title: meta?.title || first?.title || appDefaultName(key),
        ...(meta?.avatar ? { avatar: meta.avatar } : {}),
        ...(relayTarget ? { target: relayTarget } : {}),
        messages,
      };
    });
    return NextResponse.json({ sessions });
  }

  const sessionKey = sp.get('sessionKey');
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey 必填' }, { status: 400 });
  const items = pending.get(sessionKey) ?? [];
  // 只读拉取：确认投递（consume）后才清除 —— 拉取与消费之间存在卸载/StrictMode 双挂载竞态，
  // 「取走即清」会让先拿到的客户端丢弃消息后 pending 已空（接力消息被吞）
  return NextResponse.json({ items });
}

/** 确认消费：客户端已把接力消息交给投递管线（alive 校验通过）后调用，服务端清除该会话队列 */
function consumePending(sessionKey: string): void {
  pending.delete(sessionKey);
}
