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
  void pushToAllSubscribers(
    { title: title || meta?.title || appDefaultName(sessionKey), ...(meta?.avatar ? { icon: meta.avatar } : {}) },
    texts,
  );
  return item;
}

/* ---------------- Web Push ----------------
 * 发送实现已抽到 /lib/server/push-send（全订阅广播 + 404/410 失效清理），
 * 供本路由与未来其他「服务端产生对方消息」的路径共用；存储在 /lib/server/push-store。 */

/* ---------------- 服务端生成（复用 /api/chat 全链路：上游代理 + SDK 兜底） ---------------- */

interface BgPayload {
  messages?: unknown;
  config?: unknown;
}

async function generateAndEnqueue(sessionKey: string, payload: BgPayload, title: string): Promise<void> {
  // 生成开始时刻：cancel 只丢弃「取消前已开始的生成」（用户回页发新消息接管，迟到的旧接力回复作废）；
  // 取消之后新开始的生成（用户接管后又关页）不受影响。deliver 模式永不取消（丢现成消息比多一条更糟）。
  const startedAt = Date.now();
  const isCancelled = (): boolean => {
    const at = cancelled.get(sessionKey);
    if (at === undefined) return false;
    cancelled.delete(sessionKey);
    return at > startedAt;
  };
  try {
    const messages = Array.isArray(payload.messages) ? payload.messages : null;
    if (!messages) {
      if (!isCancelled()) enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
      return;
    }
    const port = process.env.PORT || '3000';
    const call = async (extra: Record<string, unknown>): Promise<string> => {
      const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, ...extra }),
      });
      return res.ok ? (await res.text()).trim() : '';
    };
    // 先按用户配置的原链路生成（上游代理 / 内置模型）；失败（含局域网地址 directOnly 502、
    // 上游断网、空回复）再用内置模型兜底一次 —— 用户关页前的最后一句话必须有人接，
    // 否则重开网页前回复永远不出现（日志实测：上游为内网地址时第一路必然 502）
    let text = await call(payload.config && typeof payload.config === 'object' ? { config: payload.config } : {});
    if (!text) {
      try {
        text = await call({ forceSdk: true });
      } catch {
        // 兜底也失败 → 占位文案
      }
    }
    if (!isCancelled()) enqueue(sessionKey, [text || '〔对方暂时没有回复，请稍后再试〕'], true, title);
  } catch {
    if (!isCancelled()) enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
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
  if (sp.get('peekAll')) {
    const counts: Record<string, number> = {};
    pending.forEach((arr, key) => {
      const n = arr.reduce((s, it) => s + it.texts.length, 0);
      if (n > 0) counts[key] = n;
    });
    return NextResponse.json({ counts });
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
