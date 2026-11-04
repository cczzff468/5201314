'use client';

/**
 * 退出网页后续复（服务端接力）的客户端接线：
 *
 * 一、上报（页面关闭时）：
 *   pagehide 时遍历「还在流式接收」的会话（chat-stream-store 活跃 payload）与「还在逐条投递」
 *   的会话（ai-delivery 未落盘尾部），用 sendBeacon 上报 /api/chat/bg：
 *   - 流没跑完（mode=generate）→ 服务端用同一套生成链路把回复生成出来；
 *   - 投递没落盘完（mode=deliver）→ 现成消息文本直接入服务端 pending 队列。
 *   beacon meta 携带 会话显示名 + 压缩后的角色头像（registerBgSession 时预压缩缓存，
 *   pagehide 同步读取）——服务端 Web Push 通知用它展示「谁发来的」。
 *   服务端完成后：① 尽力发 Web Push（每条消息一条系统通知，含头像）；
 *   ② 向 SSE 长连接广播 bg-pending 事件。
 *
 * 二、拉取（页面打开后）：
 *   - 聊天页挂载 / 回前台：pullBgPending(sessionKey) 拉取本会话待达消息（服务端即清除），
 *     由各 App 走原有投递管线（buildReplyMsgs → enqueueBatch → 逐条落盘+灵动岛弹窗+未读角标）；
 *   - 会话列表页挂载：peekBgBadgeCounts() 拉各会话待达条数 → 未读角标（同一批条目只提示一次，
 *     localStorage 去重；拉取投递后自动解除）；
 *   - 接力窗口内：旧实现是 2.5s 轮询，已废除 —— 改为常驻 SSE 长连接（/api/events），
 *     服务端 enqueue 时广播 bg-pending 事件，pullBgPending 收到事件立即拉取（零轮询、零延迟）；
 *     SSE 断线/多实例部署收不到广播时靠挂载/回前台首拉与 Web Push 保底，不丢消息。
 *
 * 会话显示名/头像由聊天页挂载时 registerBgSession 注册（beacon 携带，Web Push 标题/头像用；
 * 未注册时服务端回退为 App 名、无头像）。
 */

import { getActiveStreamPayloads } from '../chat-stream-store';
import { getDeliveringSessionKeys, peekPendingMsgs } from './ai-delivery';

export interface BgSessionMeta {
  title: string;
  app: 'wechat' | 'qq' | 'chat';
  /** 角色头像（路径或 dataURL，原样传入）：挂载时预压缩成 ≤96px 圆形 JPEG 存缓存，pagehide 同步取用 */
  avatar?: string | null;
}

interface SessionMetaEntry {
  title: string;
  app: 'wechat' | 'qq' | 'chat';
  /** 压缩后的头像 dataURL（异步就绪后回填；pagehide 直接同步读） */
  avatarSmall?: string;
  /** 压缩时用的原头像（回填时校验会话没被重新注册） */
  avatarRaw?: string;
}

/** 待拉取的接力消息（服务端 pending 项） */
export interface BgPendingItem {
  id: string;
  /** 消息文本数组：single=true 时 texts[0] 是一次完整回复原文（可能含 &&& 分段/动作标记）；
   *  single=false 时每项就是一条独立消息文本 */
  texts: string[];
  single: boolean;
  createdAt: number;
}

// ---------------- 会话元数据（beacon 携带显示名+头像，Web Push 标题/通知头像用） ----------------

const sessionMetas = new Map<string, SessionMetaEntry>();

export function registerBgSession(sessionKey: string, meta: BgSessionMeta): void {
  sessionMetas.set(sessionKey, { title: meta.title, app: meta.app, avatarRaw: meta.avatar ?? undefined });
  // 头像预压缩（异步）：pagehide 是同步瞬间取不到异步结果，这里挂载时就压好缓存
  const raw = meta.avatar;
  if (raw) {
    void compressAvatarForPush(raw).then((small) => {
      const cur = sessionMetas.get(sessionKey);
      // 会话期间头像没被重新注册/没被清掉才回填
      if (cur && cur.avatarRaw === raw && small) cur.avatarSmall = small;
    });
  }
}

export function unregisterBgSession(sessionKey: string): void {
  sessionMetas.delete(sessionKey);
}

// ---------------- 头像压缩（Web Push 通知 icon 用；≤2600 字符，超出放弃） ----------------

/** Web Push payload 上限 4096 字节：头像 dataURL 预算 2600 字符（留余量给标题/正文/tag） */
const AVATAR_PUSH_MAX = 2600;

const avatarCompCache = new Map<string, string | null>();
const AVATAR_CACHE_MAX = 64;

/** 把任意头像（路径/dataURL）压成 96px 圆形 JPEG dataURL；失败/超限返回 null（通知不带头像） */
async function compressAvatarForPush(src: string): Promise<string | null> {
  const cached = avatarCompCache.get(src);
  if (cached !== undefined) return cached;
  const out = await new Promise<string | null>((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = window.setTimeout(() => resolve(null), 4000);
      img.onload = () => {
        window.clearTimeout(timer);
        try {
          const S = 96;
          const canvas = document.createElement('canvas');
          canvas.width = S;
          canvas.height = S;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          // 圆形裁切铺满（系统通知里头像以圆形呈现）
          ctx.beginPath();
          ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          const side = Math.min(img.width, img.height) || S;
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          resolve(null); // 跨域污染画布等
        }
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    } catch {
      resolve(null);
    }
  });
  const final = out && out.length <= AVATAR_PUSH_MAX ? out : null;
  avatarCompCache.set(src, final);
  if (avatarCompCache.size > AVATAR_CACHE_MAX) {
    const oldest = avatarCompCache.keys().next().value;
    if (oldest !== undefined) avatarCompCache.delete(oldest);
  }
  return final;
}

// ---------------- pagehide 上报（页面关闭瞬间的接力请求） ----------------

/** 未投递消息的文本（从 ai-delivery 的已调度未落盘队列里取正文） */
function undeliveredTexts(sessionKey: string): string[] {
  return peekPendingMsgs<{ content?: unknown }>(sessionKey)
    .map((m) => (m && typeof m === 'object' && typeof m.content === 'string' ? m.content : ''))
    .filter((t) => t.trim().length > 0);
}

// ---------------- 接力窗口登记（重开网页后知道服务端还有一批回复在路上） ----------------

/**
 * sendBeacon 发出后的短暂窗口内，服务端还在生成/入队接力回复；若用户比服务端先回到网页，
 * 首次拉取会是空 —— 不登记窗口的话用户得再切一次标签页才能收到。窗口存 sessionStorage：
 * pagehide 时写入、重开网页后读出，拉取时在窗口内轮询（见 pullBgPending）。
 */
const RELAY_KEY = 'bg-relay-until';
const RELAY_WINDOW_MS = 90_000;

function loadRelayWindows(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = window.sessionStorage.getItem(RELAY_KEY);
    const obj: unknown = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'number' && v > Date.now()) out.set(k, v);
      }
    }
  } catch {
    // sessionStorage 不可用/损坏：无窗口登记（回页后首次拉不到就等下次回前台，行为同旧版）
  }
  return out;
}

function saveRelayWindows(windows: Map<string, number>): void {
  try {
    const obj: Record<string, number> = {};
    windows.forEach((v, k) => {
      obj[k] = v;
    });
    window.sessionStorage.setItem(RELAY_KEY, JSON.stringify(obj));
  } catch {
    // 写入失败不阻断接力
  }
}

/** pagehide 上报成功后登记窗口（本页 + sessionStorage 各记一份） */
function noteRelaySent(sessionKey: string): void {
  const windows = loadRelayWindows();
  windows.set(sessionKey, Date.now() + RELAY_WINDOW_MS);
  saveRelayWindows(windows);
}

/**
 * sendBeacon 单体上限 64KB：超出会静默丢弃，接力直接失效（长对话必然触发）。
 * 超限时裁剪上下文：保留首条（人设 system）+ 从尾部往前保留尽量多的消息，控制体在预算内。
 */
function fitBeaconPayload(body: Record<string, unknown>): string {
  const BUDGET = 55_000;
  const full = JSON.stringify(body);
  if (full.length <= BUDGET) return full;
  const payload = body.payload as { messages?: unknown[]; config?: unknown } | undefined;
  if (Array.isArray(payload?.messages) && payload.messages.length > 2) {
    const messages = payload.messages;
    const head = messages[0];
    const tail: unknown[] = [];
    let size = JSON.stringify({ ...body, payload: { ...payload, messages: [head] } }).length;
    for (let i = messages.length - 1; i > 0; i--) {
      const s = JSON.stringify(messages[i]).length;
      if (size + s > BUDGET - 256 || tail.length >= 30) break;
      tail.unshift(messages[i]);
      size += s;
    }
    return JSON.stringify({ ...body, payload: { ...payload, messages: [head, ...tail] } });
  }
  // 无法安全裁剪（只有一两条但单条巨大）：硬截字符串，保住接力能发出
  return full.slice(0, BUDGET);
}

function sendBgBeacon(body: Record<string, unknown>, sessionKey: string): void {
  try {
    const blob = new Blob([fitBeaconPayload(body)], { type: 'application/json' });
    if (navigator.sendBeacon('/api/chat/bg', blob)) noteRelaySent(sessionKey);
  } catch {
    // sendBeacon 不可用/被拦截 → 放弃接力（与旧行为一致：关页即丢）
  }
}

/** beacon meta：显示名 + 压缩头像（同步读取预压缩缓存，未就绪则不带头像） */
function beaconMeta(sessionKey: string): BgSessionMeta {
  const m = sessionMetas.get(sessionKey);
  return {
    title: m?.title ?? '',
    app: m?.app ?? 'chat',
    ...(m?.avatarSmall ? { avatar: m.avatarSmall } : {}),
  };
}

/**
 * 群聊会话（wx:group: / qq:group:）暂不接力：群页还没有拉取投递管线（说话人/动作标记
 * 依赖回合闭包），接力进服务端 pending 后永远没人拉，反而变成永远消不掉的幻影角标 ——
 * 群聊关页即丢（与旧版一致），单聊（wx: / qq: / sms:）全量接力。
 */
function isGroupSession(sessionKey: string): boolean {
  return sessionKey.startsWith('wx:group:') || sessionKey.startsWith('qq:group:');
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try {
      const streams = getActiveStreamPayloads();
      // ① 流没跑完：上报 payload 让服务端接管生成（现成消息不重复上报，由新回复整体替代）
      for (const s of streams) {
        if (isGroupSession(s.sessionKey)) continue;
        sendBgBeacon(
          {
            mode: 'generate',
            sessionKey: s.sessionKey,
            payload: { messages: s.messages, config: s.config },
            meta: beaconMeta(s.sessionKey),
          },
          s.sessionKey,
        );
      }
      // ② 流已结束但逐条投递没落盘完：现成消息文本直接入队（重开后原样送达）
      for (const key of getDeliveringSessionKeys()) {
        if (isGroupSession(key)) continue;
        if (streams.some((s) => s.sessionKey === key)) continue;
        const texts = undeliveredTexts(key);
        if (texts.length === 0) continue;
        sendBgBeacon({ mode: 'deliver', sessionKey: key, texts, meta: beaconMeta(key) }, key);
      }
    } catch {
      // pagehide 里任何异常都吞掉（不影响卸载）
    }
  });
}

// ---------------- SSE 长连接（/api/events；废除接力窗口轮询） ----------------

/**
 * 常驻 EventSource 单例：服务端 enqueue 接力回复时广播 bg-pending { sessionKey }，
 * 这里分发给等待中的 pullBgPending。断线由 EventSource 原生自动重连；
 * 事件只承载「哪个会话有新消息」，不承载消息本体 —— 丢事件不丢消息
 * （挂载/回前台首拉 + Web Push 保底）。
 */
type BgSseWaiter = (sessionKey: string) => void;
const sseWaiters = new Set<BgSseWaiter>();
let sseStarted = false;

function ensureBgSse(): void {
  if (sseStarted || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  sseStarted = true;
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('bg-pending', (ev) => {
      let key = '';
      try {
        const d = JSON.parse((ev as MessageEvent).data) as { sessionKey?: unknown };
        if (typeof d.sessionKey === 'string') key = d.sessionKey;
      } catch {
        return;
      }
      if (!key) return;
      for (const w of [...sseWaiters]) {
        try {
          w(key);
        } catch {
          // 单个 waiter 异常不影响其它
        }
      }
    });
    es.onerror = () => {
      // 浏览器自动重连；不手动 close（close 后接力窗口只能靠超时兜底）
    };
  } catch {
    sseStarted = false; // 构造失败（如 CSP）：下次再试
  }
}

/**
 * 等待指定会话的 bg-pending 事件（或超时）。
 * 返回 true = 收到该会话的事件（调用方应立即拉取）；false = 截止时间到仍未收到。
 */
function waitForBgSseEvent(sessionKey: string, deadline: number): Promise<boolean> {
  ensureBgSse();
  return new Promise((resolve) => {
    if (Date.now() >= deadline) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      sseWaiters.delete(waiter);
      window.clearTimeout(timer);
      resolve(v);
    };
    const waiter: BgSseWaiter = (key) => {
      if (key === sessionKey) finish(true);
    };
    sseWaiters.add(waiter);
    const timer = window.setTimeout(() => finish(false), Math.max(250, deadline - Date.now()));
  });
}

// ---------------- 拉取 ----------------

/** 同一会话进行中的拉取（挂载 + 回前台可能同时触发；共用同一 Promise 防重复轮询） */
const inflightPulls = new Map<string, Promise<BgPendingItem[]>>();

/** 单次拉取（不清除）：GET 服务端 pending 并解析 */
async function fetchPendingOnce(sessionKey: string): Promise<BgPendingItem[]> {
  const res = await fetch(`/api/chat/bg?sessionKey=${encodeURIComponent(sessionKey)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown };
  if (!Array.isArray(data.items)) return [];
  const items: BgPendingItem[] = [];
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as { id?: unknown; texts?: unknown; single?: unknown; createdAt?: unknown };
    const texts = Array.isArray(rec.texts)
      ? rec.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [];
    if (texts.length === 0) continue;
    items.push({
      id: typeof rec.id === 'string' ? rec.id : `bg-${Math.random().toString(36).slice(2)}`,
      texts,
      single: rec.single === true,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
    });
  }
  markPeekedConsumed(sessionKey);
  return items;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 拉取本会话的接力消息（只读，不清除；调用方确认接手投递后需调 consumeBgPending 清除服务端队列）。
 * 聊天页挂载与回前台时调用；会话正有活跃流/投递时跳过（等下一轮回前台再拉，避免与新回复交错）。
 *
 * 关页接力窗口内（pagehide 上报后服务端还在生成，见 noteRelaySent）：首次拉空后挂起等待
 * SSE bg-pending 事件（旧版 2.5s 轮询已废除）—— 服务端 enqueue 时广播，这里收到立即拉取；
 * SSE 不可用（多实例部署/连接断开）时事件等不到 → 窗口过期后自然返回，回前台首拉与
 * Web Push 保底，消息不丢。用户在等待期间自己发了新消息（出现活跃流）→ 停止等待：
 * 流开始时已上报 cancel，服务端会丢弃接力回复。
 *
 * 读拉/写清分离：拉到不消费，避免 StrictMode 双挂载/快速切会话时「先拉到的实例被卸载丢弃、
 * pending 已清空」的竞态丢消息（调用方 alive 校验通过后再 consume）。
 */
export async function pullBgPending(sessionKey: string): Promise<BgPendingItem[]> {
  const existing = inflightPulls.get(sessionKey);
  if (existing) return existing;
  const task = (async (): Promise<BgPendingItem[]> => {
    try {
      const { isChatStreaming } = await import('../chat-stream-store');
      const { isAiDelivering } = await import('./ai-delivery');
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return [];
      const first = await fetchPendingOnce(sessionKey);
      if (first.length > 0) {
        clearRelayWindow(sessionKey);
        return first;
      }
      // 接力窗口内等待 SSE 事件（窗口来自本页上报或重开网页前上一页的 sessionStorage 登记）
      const deadline = loadRelayWindows().get(sessionKey);
      if (!deadline) return [];
      while (Date.now() < deadline) {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return [];
        const got = await waitForBgSseEvent(sessionKey, deadline);
        if (!got) break; // 窗口过期（SSE 不可用或服务端一直没入队）
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return [];
        const items = await fetchPendingOnce(sessionKey);
        if (items.length > 0) {
          clearRelayWindow(sessionKey);
          return items;
        }
        // 极小概率：事件比 enqueue 早到/事件被另一实例处理 → 继续等下一条事件直到窗口结束
        await sleep(150);
      }
      clearRelayWindow(sessionKey);
      return [];
    } catch {
      return [];
    } finally {
      inflightPulls.delete(sessionKey);
    }
  })();
  inflightPulls.set(sessionKey, task);
  return task;
}

/** 拉到接力消息（或窗口过期）后解除登记 */
function clearRelayWindow(sessionKey: string): void {
  const windows = loadRelayWindows();
  if (!windows.has(sessionKey)) return;
  windows.delete(sessionKey);
  saveRelayWindows(windows);
}

/**
 * 确认消费：调用方已通过 alive/挂载校验并把接力消息交给投递管线后调用，
 * 服务端清除该会话待拉取队列（未消费前重复拉取返回同一批，由投递幂等兜底）。
 */
export function consumeBgPending(sessionKey: string): void {
  try {
    void fetch('/api/chat/bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'consume', sessionKey }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // 尽力而为：消费失败最多让消息被重复投递一次（拉取幂等），不会丢
  }
}

/** 回前台/重新聚焦时回调（聊天页用它再次 pullBgPending） */
export function onBgPageVisible(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('focus', handler);
  };
}

// ---------------- 会话列表角标（peek + localStorage 去重，同一批条目只提示一次） ----------------

const PEEKED_KEY = 'bg-peeked-ids';

function loadPeeked(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PEEKED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePeeked(set: Set<string>): void {
  try {
    const arr = [...set].slice(-200);
    window.localStorage.setItem(PEEKED_KEY, JSON.stringify(arr));
  } catch {
    // 持久化失败忽略（内存态去重仍生效）
  }
}

function markPeeked(ids: string[]): void {
  const set = loadPeeked();
  for (const id of ids) set.add(id);
  savePeeked(set);
}

/** 拉取后解除该会话的「已提示」标记（已正式送达，之后新的接力到达才会再次提示） */
function markPeekedConsumed(sessionKey: string): void {
  const set = loadPeeked();
  const prefix = `${sessionKey}#`;
  const next = [...set].filter((k) => !k.startsWith(prefix));
  if (next.length === set.size) return;
  savePeeked(new Set(next));
}

/**
 * 各会话「接力消息待达条数」（仅返回新出现的：同一批条目只在第一次查询时返回，
 * 正式拉取投递后解除标记；会话列表挂载时调用 → 未读角标）。
 * 返回 { sessionKey: 条数 }，只含有待达消息的会话。
 */
export async function peekBgBadgeCounts(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/chat/bg?peekAll=1');
    if (!res.ok) return {};
    const data = (await res.json()) as { counts?: Record<string, unknown> };
    if (!data.counts || typeof data.counts !== 'object') return {};
    const peeked = loadPeeked();
    const out: Record<string, number> = {};
    const newIds: string[] = [];
    for (const [key, n] of Object.entries(data.counts)) {
      const count = typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
      if (count <= 0) continue;
      // 服务端 pending 里没有逐条 id（peekAll 不清除），以「会话+数量」作为提示批次键去重：
      // 数量变化（新接力到达）才会再次提示
      const batchKey = `${key}#${count}`;
      if (peeked.has(batchKey)) continue;
      peeked.add(batchKey);
      newIds.push(batchKey);
      out[key] = count;
    }
    if (newIds.length > 0) savePeeked(peeked);
    return out;
  } catch {
    return {};
  }
}
