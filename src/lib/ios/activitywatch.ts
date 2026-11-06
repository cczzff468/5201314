'use client';

import { isNativePerception, nativeUsageSnapshot } from './native-perception';

/**
 * ActivityWatch 客户端（感知设置 · 真机感知数据源）：
 *
 * 从用户真实手机的 ActivityWatch（aw-android，本地 REST API 端口 5600）拉取
 * 前台 App / 屏幕使用时间 / 解锁事件 / 媒体播放 / 浏览器 URL 数据。
 *
 * 网络策略（两级回退，全部 GET 请求避免 CORS 预检）：
 *  ① 浏览器直连 —— 手机本机浏览器访问时（http://localhost:5600）有机会成功；
 *    aw-server 的 CORS 默认只放行 localhost origin 与浏览器扩展，同机访问才命中；
 *  ② 服务端代理 /api/perception/fetch?url= —— 云端服务器代取并加 CORS 头放行，
 *    适用于「内网穿透/公网可达」的地址（手机与服务器网络互通的场景）；
 *  两者都失败 = 数据源不可达，静默省略（不阻塞聊天）。
 *
 * 缓存与并发：模块级 45 秒缓存 + 同地址并发去重（聊天页挂载预热 + 每轮发送后台刷新，
 * 构建 prompt 块时同步读缓存 —— runAiTurn 是同步函数不能 await，沿用 crossCtxRef 预热范式）。
 */

/** ActivityWatch 事件（各 bucket 通用；data 字段按 bucket 类型不同） */
export interface AwEvent {
  timestamp: string;
  duration: number;
  data: {
    app?: string;
    package?: string;
    classname?: string;
    title?: string;
    artist?: string;
    album?: string;
    state?: string;
    url?: string;
  };
}

/** 一次采集得到的真机感知快照（全部字段可选 —— 对应 bucket 缺失/拉取失败时省略） */
export interface AwSnapshot {
  /** 前台 App（正在玩什么）：最后一次前台会话 + 已持续时长 */
  current?: { app: string; ongoingMs: number; at: number };
  /** 今日分 App 使用时长（毫秒，按 app 名聚合，降序） */
  todayApps?: { app: string; ms: number }[];
  /** 今日总使用时长（毫秒） */
  todayTotalMs?: number;
  /** 今日前台会话切换次数 */
  switchCount?: number;
  /** 今日最长单次前台使用 */
  longest?: { app: string; ms: number };
  /** 近期 App 切换记录（时间 + App，最新在后，最多 6 条） */
  history?: { hhmm: string; app: string }[];
  /** 今日解锁事件 */
  unlocks?: { count: number; lastHhmm?: string; nightCount: number };
  /** 正在播放的媒体（歌/视频） */
  media?: { app: string; title: string; artist: string; state: string } | null;
  /** 正在浏览的网页 */
  web?: { url: string; title?: string } | null;
  fetchedAt: number;
}

const AW_CACHE_TTL = 45_000;
const DIRECT_TIMEOUT = 2800;
const PROXY_TIMEOUT = 3600;

/** 地址规范化：去尾部斜杠；空串/明显非法返回 null */
export function normalizeAwUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) return null;
  return u.replace(/\/+$/, '');
}

/** GET 某个 ActivityWatch 接口（直连 → 代理回退；返回解析后的 JSON，失败 null） */
async function awGetJson(base: string, path: string): Promise<unknown | null> {
  const full = `${base}/api/0/${path}`;
  // ① 浏览器直连（同机 localhost 场景 aw-server 的 CORS 放行）
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT);
    const res = await fetch(full, { signal: ctrl.signal, cache: 'no-store' });
    window.clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch {
    /* 直连失败（CORS/网络）→ 走代理 */
  }
  // ② 服务端代理（公网可达地址场景；代理加 CORS 头放行）
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), PROXY_TIMEOUT);
    const res = await fetch(`/api/perception/fetch?url=${encodeURIComponent(full)}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    window.clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch {
    /* 代理也失败：数据源不可达 */
  }
  return null;
}

function asEvents(v: unknown): AwEvent[] {
  if (!Array.isArray(v)) return [];
  const out: AwEvent[] = [];
  for (const e of v) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.timestamp !== 'string') continue;
    out.push({
      timestamp: o.timestamp,
      duration: typeof o.duration === 'number' ? o.duration : 0,
      data: (typeof o.data === 'object' && o.data !== null ? o.data : {}) as AwEvent['data'],
    });
  }
  return out;
}

/** 本地时区的「今日 00:00」ISO 串（ActivityWatch start/end 参数用） */
function todayStartIso(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

function hhmmOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 聚合今日前台事件 → 分 App 时长 / 总时长 / 切换次数 / 最长单次 / 近期切换 / 当前前台 */
function aggregateSessions(events: AwEvent[]): Pick<AwSnapshot, 'current' | 'todayApps' | 'todayTotalMs' | 'switchCount' | 'longest' | 'history'> {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byApp = new Map<string, number>();
  let total = 0;
  let longestApp = '';
  let longestMs = 0;
  for (const e of sorted) {
    const app = (e.data.app || e.data.package || '').trim();
    if (!app) continue;
    const ms = Math.max(0, e.duration) * 1000;
    byApp.set(app, (byApp.get(app) ?? 0) + ms);
    total += ms;
    if (ms > longestMs) {
      longestMs = ms;
      longestApp = app;
    }
  }
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const currentApp = last ? (last.data.app || last.data.package || '').trim() : '';
  const lastAt = last ? new Date(last.timestamp).getTime() : 0;
  let current: AwSnapshot['current'] | undefined;
  if (currentApp && lastAt > 0) {
    current = { app: currentApp, ongoingMs: Math.max(0, Date.now() - lastAt), at: lastAt };
  }
  const history = sorted
    .slice(-6)
    .map((e) => ({ hhmm: hhmmOf(e.timestamp), app: (e.data.app || e.data.package || '').trim() }))
    .filter((x) => x.app);
  return {
    current,
    todayApps: [...byApp.entries()].map(([app, ms]) => ({ app, ms })).sort((a, b) => b.ms - a.ms),
    todayTotalMs: total,
    switchCount: sorted.filter((e) => (e.data.app || e.data.package || '').trim()).length,
    longest: longestApp ? { app: longestApp, ms: longestMs } : undefined,
    history,
  };
}

/** 解锁事件聚合：今日次数 + 最近一次 + 凌晨（0-6 点）次数 */
function aggregateUnlocks(events: AwEvent[]): AwSnapshot['unlocks'] {
  let night = 0;
  let lastHhmm: string | undefined;
  for (const e of events) {
    const d = new Date(e.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getHours() < 6) night++;
    lastHhmm = hhmmOf(e.timestamp);
  }
  return { count: events.length, lastHhmm, nightCount: night };
}

/** 媒体事件 → 正在播放（取最后一条有 title 的） */
function aggregateMedia(events: AwEvent[]): AwSnapshot['media'] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    if (d.title || d.app) {
      return { app: (d.app || '').trim(), title: (d.title || '').trim(), artist: (d.artist || '').trim(), state: (d.state || '').trim() };
    }
  }
  return null;
}

/** 网页事件 → 正在浏览（取最后一条有 url 的） */
function aggregateWeb(events: AwEvent[]): AwSnapshot['web'] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    if (d.url) return { url: d.url, title: (d.title || '').trim() || undefined };
  }
  return null;
}

// ---------------- 缓存 + 并发去重 ----------------

const awCache = new Map<string, { snap: AwSnapshot | null; ts: number }>();
const awInflight = new Map<string, Promise<AwSnapshot | null>>();

/** 拉取并聚合 ActivityWatch 数据（45 秒缓存 + 同地址并发去重；不可达返回 null）
 *
 * v77.4：APP 壳内优先走原生桥（UsageStats，免装 ActivityWatch/免穿透/免 502）——
 * 原生无权限/失败时回落远程地址（浏览器/无桥时行为不变）。 */
export async function fetchAwSnapshot(rawUrl: string, force = false): Promise<AwSnapshot | null> {
  const urlBase = normalizeAwUrl(rawUrl);
  // 原生模式无远程地址也拉（虚拟键）；纯浏览器无地址直接 null（原行为）
  const base = urlBase ?? (isNativePerception() ? NATIVE_KEY : null);
  if (!base) return null;
  const cached = awCache.get(base);
  if (!force && cached && Date.now() - cached.ts < AW_CACHE_TTL) return cached.snap;
  const running = awInflight.get(base);
  if (running) return running;

  const job = (async (): Promise<AwSnapshot | null> => {
    // APP 壳内：原生 UsageStats 优先（无权限/失败静默回落远程地址）
    if (isNativePerception()) {
      const native = await nativeUsageSnapshot();
      if (native) {
        awCache.set(base, { snap: native, ts: Date.now() });
        return native;
      }
      if (!urlBase) {
        // 原生也没拿到（未授权等）：记空缓存防止高频重试
        awCache.set(base, { snap: null, ts: Date.now() });
        return null;
      }
    }
    const startIso = todayStartIso();
    const endIso = new Date().toISOString();
    const q = (bucket: string, extra: string) =>
      `buckets/${bucket}/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&${extra}`;
    const [winRaw, unlockRaw, mediaRaw, webRaw] = await Promise.allSettled([
      awGetJson(base, q('aw-watcher-android', 'limit=600')),
      awGetJson(base, q('aw-watcher-android-unlock', 'limit=400')),
      awGetJson(base, `buckets/aw-watcher-android-media/events?limit=4`),
      awGetJson(base, `buckets/aw-watcher-android-web/events?limit=4`),
    ]);
    const winEvents = winRaw.status === 'fulfilled' ? asEvents(winRaw.value) : [];
    const unlockEvents = unlockRaw.status === 'fulfilled' ? asEvents(unlockRaw.value) : [];
    const mediaEvents = mediaRaw.status === 'fulfilled' ? asEvents(mediaRaw.value) : [];
    const webEvents = webRaw.status === 'fulfilled' ? asEvents(webRaw.value) : [];
    // 四路全空 = 数据源不可达（连不上或没有任何 bucket）
    if (winEvents.length + unlockEvents.length + mediaEvents.length + webEvents.length === 0) {
      awCache.set(base, { snap: null, ts: Date.now() });
      return null;
    }
    const snap: AwSnapshot = {
      fetchedAt: Date.now(),
      ...aggregateSessions(winEvents),
      unlocks: unlockEvents.length > 0 ? aggregateUnlocks(unlockEvents) : undefined,
      media: mediaEvents.length > 0 ? aggregateMedia(mediaEvents) : undefined,
      web: webEvents.length > 0 ? aggregateWeb(webEvents) : undefined,
    };
    awCache.set(base, { snap, ts: Date.now() });
    return snap;
  })().finally(() => {
    awInflight.delete(base);
  });

  awInflight.set(base, job);
  return job;
}

/** 原生模式下无远程地址时的虚拟缓存键（与真实 URL 隔离） */
const NATIVE_KEY = '__native__';

/** 同步读取 45 秒内的缓存快照（构建感知块时用；无缓存/过期返回 null）
 *  原生模式无远程地址时读虚拟键缓存 */
export function getCachedAw(rawUrl: string): AwSnapshot | null {
  const urlBase = normalizeAwUrl(rawUrl);
  const base = urlBase ?? (isNativePerception() ? NATIVE_KEY : null);
  if (!base) return null;
  const cached = awCache.get(base);
  if (!cached || Date.now() - cached.ts > AW_CACHE_TTL) return null;
  return cached.snap;
}

/** 设置页「测试连接」：返回可达性与路径（直连/代理）细节 */
export async function testAwConnection(rawUrl: string): Promise<{ ok: boolean; detail: string }> {
  const base = normalizeAwUrl(rawUrl);
  if (!base) return { ok: false, detail: '地址无效：需以 http:// 或 https:// 开头' };
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT);
    const res = await fetch(`${base}/api/0/buckets`, { signal: ctrl.signal, cache: 'no-store' });
    window.clearTimeout(timer);
    if (res.ok) return { ok: true, detail: '连接成功（浏览器直连）' };
  } catch {
    /* 落到代理 */
  }
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), PROXY_TIMEOUT);
    const res = await fetch(`/api/perception/fetch?url=${encodeURIComponent(`${base}/api/0/buckets`)}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    window.clearTimeout(timer);
    if (res.ok) return { ok: true, detail: '连接成功（服务器代理）' };
    return { ok: false, detail: `服务器代理返回 HTTP ${res.status}` };
  } catch {
    return { ok: false, detail: '无法连接：请确认手机 ActivityWatch 已开启、地址正确且网络可达（内网需穿透成公网地址）' };
  }
}
