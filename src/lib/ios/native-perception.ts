'use client';

/**
 * 原生感知桥（APP 壳内自动激活，浏览器里全部静默降级）：
 *
 * 运行环境判定：Capacitor 壳（android-shell/ 编译出的 APK）里的 WebView 通过
 * WebMessageListener / addJavascriptInterface 全局注入 window.androidBridge，
 * 跨域页面（沙箱预览地址）同样可见 —— 网页侧据此判定原生环境。
 *
 * 关键补丁：Capacitor 8 的注入脚本只覆盖壳自身的源，跨域页面拿不到
 * window.Capacitor.Plugins —— 因此这里自建一份 Capacitor 消息协议客户端，
 * 直接经 androidBridge.postMessage 调原生插件（pluginId 可路由到任意已注册
 * 插件：NativePerception / CapacitorUsageStatsManager）。
 *
 * v1.2 时长数据源双引擎（用户在感知设置自选，localStorage 全局键）：
 *  - standard（默认）：Cap-go 插件（CapacitorUsageStatsManager）queryEvents
 *    事件级 JS 聚合（回看+今日裁剪+桌面排除）；Cap-go 不可用（旧 APK/失败）
 *    自动回落内置原生 getUsageSnapshot（v1.2 同口径）；
 *  - shizuku：原生侧经 Shizuku 以 shell 权限 dumpsys usagestats 读系统账本；
 *    Shizuku 未运行/未授权由原生内部自动降级标准（engineNote 标注）。
 */

import type { AwSnapshot } from './activitywatch';

type UsageSnapshotResult = {
  ok: boolean;
  needPermission?: boolean;
  /** 本轮数据实际由哪个引擎产出（standard/shizuku；旧壳无此字段 → native） */
  engine?: string;
  /** 降级原因（如 shizuku-not-running / shizuku-no-permission / shizuku-empty） */
  engineNote?: string;
  current?: { app: string; name: string; ongoingMs: number; at?: number; closed?: boolean };
  todayApps?: { app: string; name: string; ms: number; opens?: number; lastOpenTs?: number }[];
  todayTotalMs?: number;
  switchCount?: number;
  longest?: { app: string; ms: string } | { app: string; ms: number };
  history?: { hhmm: string; app: string; name: string }[];
  recentApps?: { app: string; name: string; hhmm: string; opens: number; ms: number }[];
};

type ShizukuStatusResult = { supported?: boolean; running?: boolean; granted?: boolean; version?: number };
type ShizukuPermissionResult = { ok?: boolean; granted?: boolean; reason?: string };
type ShizukuExecOptions = {
  /** 行过滤 token（全部命中的行才保留；控制回传体积） */
  mustContain?: string[];
  /** 回传行数上限（默认 1000，硬顶 20000） */
  maxLines?: number;
  /** 看门狗超时毫秒（默认 8000，硬顶 30000） */
  timeoutMs?: number;
};
type ShizukuExecResult = { ok?: boolean; out?: string; reason?: string };

type CapPlugin = {
  hasUsagePermission(): Promise<{ granted: boolean }>;
  openUsagePermissionSettings(): Promise<void>;
  getUsageSnapshot(options?: { source?: 'standard' | 'shizuku' }): Promise<UsageSnapshotResult>;
  hasMediaPermission(): Promise<{ granted: boolean }>;
  openMediaPermissionSettings(): Promise<void>;
  getNowPlaying(): Promise<{
    ok: boolean;
    needPermission?: boolean;
    connecting?: boolean;
    playing?: {
      app: string;
      pkg: string;
      title: string;
      artist: string;
      album: string;
      state: string;
      updatedAt: number;
    } | null;
  }>;
  requestScreenCapture(): Promise<{ ok: boolean; canceled?: boolean }>;
  grabScreenFrame(): Promise<{ ok: boolean; needSession?: boolean; frame?: string }>;
  stopScreenCapture(): Promise<void>;
  shizukuStatus(): Promise<ShizukuStatusResult>;
  requestShizukuPermission(): Promise<ShizukuPermissionResult>;
  shizukuExec(options?: { cmd?: string[] } & ShizukuExecOptions): Promise<ShizukuExecResult>;
  shizukuScreencap(): Promise<{ ok?: boolean; frame?: string; reason?: string }>;
};

type CapacitorCore = {
  isNativePlatform(): boolean;
  getPlatform(): string;
  Plugins: Record<string, CapPlugin | undefined>;
};

let capCore: CapacitorCore | null = null;
let capTried = false;

/** 拿 @capacitor/core 运行时（失败/非原生返回 null；结果缓存） */
async function loadCapacitor(): Promise<CapacitorCore | null> {
  if (capCore) return capCore;
  if (capTried) return null;
  capTried = true;
  try {
    const m = await import('@capacitor/core');
    const cap = (m.Capacitor as unknown as CapacitorCore) ?? null;
    if (cap && typeof cap.isNativePlatform === 'function') {
      capCore = cap;
      return cap;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------- 自建 Capacitor 消息协议（跨域页面补丁） ----------------
// 原生注入脚本只覆盖壳源；沙箱预览页上 Plugins['NativePerception'] 不存在，
// 这里按同一协议直连 androidBridge：postMessage({callbackId, pluginId, methodName, options})
// 回传见 MessageHandler.sendResponseMessage：replyProxy.postMessage → onmessage 事件，
// 或 legacy evaluateJavascript("window.Capacitor.fromNative(...)")。

type NativeResult = {
  callbackId?: string;
  success?: boolean;
  data?: unknown;
  error?: { message?: string } & Record<string, unknown>;
  save?: boolean;
};

type AndroidBridgeLike = {
  postMessage(data: string): void;
  onmessage?: ((event: { data: string }) => void) | null;
};

const pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e?: unknown) => void }>();
let bridgeCallbackId = Math.floor(Math.random() * 1_000_000);
let bridgeHookInstalled = false;

/** 处理原生回传结果（onmessage 与 fromNative 两通道同构） */
function handleNativeResult(result: NativeResult | null | undefined): void {
  if (!result || typeof result.callbackId !== 'string') return;
  const stored = pendingCalls.get(result.callbackId);
  if (!stored) return;
  pendingCalls.delete(result.callbackId);
  if (result.success) {
    stored.resolve(result.data ?? {});
  } else {
    stored.reject(result.error ?? new Error('原生调用失败'));
  }
}

/**
 * 安装回传钩子（幂等；绝不覆盖原生注入已有的 onmessage / fromNative，
 * 同源页面上 native-bridge.js 先于页面 JS 执行，此处检测到已存在即跳过）
 */
function ensureBridgeHook(): boolean {
  if (bridgeHookInstalled) return true;
  if (typeof window === 'undefined') return false;
  const w = window as typeof window & { androidBridge?: AndroidBridgeLike; Capacitor?: { fromNative?: (r: NativeResult) => void } };
  const bridge = w.androidBridge;
  if (!bridge || typeof bridge.postMessage !== 'function') return false;
  try {
    // ① WebMessageListener 模式（现代 WebView）：原生经 replyProxy 触发 onmessage 事件
    if (typeof bridge.onmessage !== 'function') {
      bridge.onmessage = (event: { data: string }) => {
        try {
          handleNativeResult(JSON.parse(event?.data));
        } catch {
          /* 非法载荷忽略 */
        }
      };
    }
    // ② legacy addJavascriptInterface 模式（老 WebView）：原生 evaluateJavascript 调 fromNative
    w.Capacitor = w.Capacitor ?? {};
    if (typeof w.Capacitor.fromNative !== 'function') {
      w.Capacitor.fromNative = (r: NativeResult) => handleNativeResult(r);
    }
    bridgeHookInstalled = true;
    return true;
  } catch {
    return false;
  }
}

/** 经自建协议调用任意已注册原生插件方法（超时防永久挂起） */
function bridgeCall<T>(
  pluginId: string,
  methodName: string,
  options: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!ensureBridgeHook()) {
      reject(new Error('androidBridge 不可用'));
      return;
    }
    const callbackId = String(++bridgeCallbackId);
    // 原生侧异常（插件未注册/回传路由失效）时 promise 会永远挂起且无任何报错——
    // 数据静默消失比报错更难排查，这里加超时兜底
    const timer = window.setTimeout(() => {
      pendingCalls.delete(callbackId);
      reject(new Error(`原生调用超时（${pluginId}.${methodName}，桥无响应）`));
    }, timeoutMs);
    pendingCalls.set(callbackId, {
      resolve: (v) => {
        window.clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        window.clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    });
    try {
      (window as { androidBridge?: AndroidBridgeLike }).androidBridge?.postMessage(
        JSON.stringify({ callbackId, pluginId, methodName, options })
      );
    } catch (e) {
      window.clearTimeout(timer);
      pendingCalls.delete(callbackId);
      reject(e);
    }
  });
}

/** 调本 APP 自研感知插件（NativePerception） */
function nativeCall<T>(methodName: string, options: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  return bridgeCall<T>('NativePerception', methodName, options, timeoutMs);
}

type NowPlayingResult = Awaited<ReturnType<CapPlugin['getNowPlaying']>>;

// ---------------- 媒体桥新旧壳探测 ----------------
// 旧 APK（v1.0）没有 hasMediaPermission/getNowPlaying 方法，且 Capacitor 对未知方法
// 只记日志不回包 —— 直接调用会挂到超时。这里用短超时探测一次并缓存：
// 新壳 → 立即响应；旧壳 → 超时后本页面会话内不再尝试（零后续成本）。
let mediaBridgeState: boolean | null = null; // null = 未探测

async function mediaBridgeAlive(): Promise<boolean> {
  if (mediaBridgeState !== null) return mediaBridgeState;
  const p = await nativePlugin();
  if (!p) {
    mediaBridgeState = false;
    return false;
  }
  try {
    // 2s 探测超时（正常响应在几十毫秒内；旧壳永不回包）
    const r = await Promise.race([
      p.hasMediaPermission(),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), 2000)),
    ]);
    mediaBridgeState = !!r && typeof r.granted === 'boolean';
  } catch {
    mediaBridgeState = false; // 桥无响应 = 旧壳无此方法
  }
  return mediaBridgeState;
}

/** 自建协议插件代理（方法集与 NativePerceptionPlugin.java 一致） */
function bridgePlugin(): CapPlugin {
  return {
    hasUsagePermission: () => nativeCall<{ granted: boolean }>('hasUsagePermission'),
    openUsagePermissionSettings: () => nativeCall<void>('openUsagePermissionSettings'),
    getUsageSnapshot: (options) => nativeCall<UsageSnapshotResult>('getUsageSnapshot', options ?? {}),
    hasMediaPermission: () => nativeCall<{ granted: boolean }>('hasMediaPermission'),
    openMediaPermissionSettings: () => nativeCall<void>('openMediaPermissionSettings'),
    getNowPlaying: () => nativeCall<NowPlayingResult>('getNowPlaying'),
    requestScreenCapture: () => nativeCall<{ ok: boolean; canceled?: boolean }>('requestScreenCapture'),
    grabScreenFrame: () => nativeCall<{ ok: boolean; needSession?: boolean; frame?: string }>('grabScreenFrame'),
    stopScreenCapture: () => nativeCall<void>('stopScreenCapture'),
    shizukuStatus: () => nativeCall<ShizukuStatusResult>('shizukuStatus'),
    requestShizukuPermission: () => nativeCall<ShizukuPermissionResult>('requestShizukuPermission', {}, 35_000),
    shizukuExec: (options) => nativeCall<ShizukuExecResult>('shizukuExec', options ?? {}, (options?.timeoutMs ?? 8000) + 16_000),
    shizukuScreencap: () => nativeCall<{ ok?: boolean; frame?: string; reason?: string }>('shizukuScreencap', {}, 30_000),
  };
}

/** 同步判定：是否运行在原生壳里（androidBridge 由 WebView 注入，无需加载 SDK） */
export function isNativePerception(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as { androidBridge?: unknown }).androidBridge;
  return !!bridge && typeof (bridge as AndroidBridgeLike).postMessage === 'function';
}

/** 原生感知插件：优先官方注入的代理（同源页面），否则自建协议直连（跨域页面） */
async function nativePlugin(): Promise<CapPlugin | null> {
  if (!isNativePerception()) return null;
  // 路径 A：Capacitor 注入脚本覆盖的页面（壳本地源）——Plugins 上已有插件代理
  const cap = await loadCapacitor();
  const plugin = cap?.Plugins?.['NativePerception'];
  if (plugin) return plugin;
  // 路径 B：跨域页面（注入脚本不覆盖外域）——自建消息协议直连 androidBridge
  if (ensureBridgeHook()) return bridgePlugin();
  return null;
}

// ---------------- 时长数据源（v1.2 双引擎，全局设置） ----------------

export type UsageEngine = 'standard' | 'shizuku';

const ENGINE_KEY = 'aiphone-usage-engine-v1';

/** 当前选中的时长数据源（默认 standard；全局键，对全部会话生效） */
export function getUsageEngine(): UsageEngine {
  try {
    return window.localStorage.getItem(ENGINE_KEY) === 'shizuku' ? 'shizuku' : 'standard';
  } catch {
    return 'standard';
  }
}

/** 切换时长数据源（立即生效；下一次取样现场读取） */
export function setUsageEngine(engine: UsageEngine): void {
  try {
    window.localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* 持久化失败忽略（本会话内存态仍由调用方维护） */
  }
}

// ---------------- Cap-go 引擎（标准模式 · 事件级 JS 聚合） ----------------

// v1.2 新壳才装了 @capgo/capacitor-android-usagestatsmanager（插件注册名
// CapacitorUsageStatsManager）；旧壳不响应 → 短超时探测一次并缓存。
let capgoState: boolean | null = null;

async function capgoBridgeAlive(): Promise<boolean> {
  if (capgoState !== null) return capgoState;
  if (!isNativePerception()) {
    capgoState = false;
    return false;
  }
  try {
    const r = await Promise.race([
      bridgeCall<{ granted: boolean }>('CapacitorUsageStatsManager', 'isUsageStatsPermissionGranted', {}, 2500),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), 2600)),
    ]);
    capgoState = !!r && typeof r.granted === 'boolean';
  } catch {
    capgoState = false; // 旧壳无此插件
  }
  return capgoState;
}

/** 应用名标签缓存（queryAllPackages 较重：内存 + localStorage 双层，24h） */
const APP_LABEL_KEY = 'aiphone-app-labels-v1';
const APP_LABEL_TTL = 24 * 3600_000;
let labelMem: { map: Record<string, string>; ts: number } | null = null;

async function capgoAppLabels(): Promise<Record<string, string>> {
  if (labelMem && Date.now() - labelMem.ts < APP_LABEL_TTL) return labelMem.map;
  try {
    const raw = window.localStorage.getItem(APP_LABEL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { ts?: number; map?: Record<string, string> };
      if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts < APP_LABEL_TTL && parsed.map) {
        labelMem = { map: parsed.map, ts: parsed.ts };
        return parsed.map;
      }
    }
  } catch {
    /* 缓存损坏忽略，走在线拉取 */
  }
  const r = await bridgeCall<{ packages?: { packageName?: string; appName?: string }[] }>(
    'CapacitorUsageStatsManager',
    'queryAllPackages',
    {},
    20_000,
  );
  const map: Record<string, string> = {};
  for (const p of r?.packages ?? []) {
    if (p?.packageName && p?.appName && p.appName.trim() && p.appName !== p.packageName) {
      map[p.packageName] = p.appName.trim();
    }
  }
  labelMem = { map, ts: Date.now() };
  try {
    window.localStorage.setItem(APP_LABEL_KEY, JSON.stringify(labelMem));
  } catch {
    /* 存储满等异常忽略 */
  }
  return map;
}

/** 常见桌面 Launcher 包名（标准引擎 JS 侧排除；与原生侧 PackageManager 解析互补） */
const KNOWN_LAUNCHERS = new Set([
  'com.miui.home',
  'com.android.launcher',
  'com.android.launcher2',
  'com.android.launcher3',
  'com.huawei.android.launcher',
  'com.sec.android.app.launcher',
  'com.google.android.apps.nexuslauncher',
  'com.coloros.launcher',
  'com.oppo.launcher',
  'com.vivo.launcher',
  'com.hihonor.launcher',
  'com.lg.launcher2',
  'com.sonymobile.home',
  'com.teslacoilsw.launcher',
]);

function hhmmOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Cap-go 引擎取样：queryEvents（带回看）→ 与原生 v1.2 同口径的 JS 聚合 */
async function capgoUsageSnapshot(): Promise<AwSnapshot | null> {
  const now = Date.now();
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const startOfDay = d.getTime();
  const lookback = 2 * 3600_000;
  const [evRes, labels] = await Promise.all([
    bridgeCall<{ events?: { packageName?: string; timeStamp?: number; eventType?: number }[] }>(
      'CapacitorUsageStatsManager',
      'queryEvents',
      { beginTime: startOfDay - lookback, endTime: now },
      12_000,
    ),
    capgoAppLabels().catch(() => ({}) as Record<string, string>),
  ]);
  const labelOf = (pkg: string): string => {
    const l = labels[pkg];
    return l && l.trim() ? l.trim() : (pkg.split('.').pop() ?? pkg);
  };
  const isLauncher = (pkg: string): boolean => {
    if (KNOWN_LAUNCHERS.has(pkg)) return true;
    const l = labels[pkg]?.toLowerCase();
    return !!l && (l.includes('launcher') || l.includes('桌面'));
  };

  /* 事件类型归一（与原生 v1.2.1 同口径）：
   *   1 前台 / 2 失焦 / 3 息屏(16) / 4 亮屏(15) / 5 锁屏(17) / 6 解锁(18) / 7 关机(26) / 8 开机(27)
   * 门控事件（3~8）无归属包，packageName 可能为空。 */
  type Ev = { ts: number; type: number; pkg: string | null };
  const evs: Ev[] = (evRes?.events ?? [])
    .filter((e): e is { packageName?: string | null; timeStamp: number; eventType: number } => {
      if (typeof e.timeStamp !== 'number') return false;
      const t = e.eventType;
      if (t === 1 || t === 2 || t === 23) return true;
      if (t === 15 || t === 16 || t === 17 || t === 18 || t === 26 || t === 27) return true; // 门控事件可无包名
      return false;
    })
    .map((e) => {
      const t = e.eventType;
      let type: number;
      if (t === 1) type = 1;
      else if (t === 2 || t === 23) type = 2;
      else if (t === 16) type = 3;
      else if (t === 15) type = 4;
      else if (t === 17) type = 5;
      else if (t === 18) type = 6;
      else if (t === 26) type = 7;
      else type = 8;
      return { ts: e.timeStamp, type, pkg: e.packageName ?? null };
    })
    .sort((a, b) => a.ts - b.ts);

  // 与原生 buildSnapshot 同口径（v1.2.1）：RESUMED→PAUSED 配对 + 今日裁剪 + 桌面排除
  // + 3s 内同 App 页面切换不重复计打开 + 息屏/锁屏/关机即停 + 解锁后自动续计原 App
  // （安卓账本里前台 App 息屏后一直「挂着 RESUMED」且解锁不补发 RESUMED，不处理会把
  //   整段睡眠时间算成使用时长）
  const durationByApp = new Map<string, number>();
  const opensByApp = new Map<string, number>();
  const lastOpenByApp = new Map<string, number>();
  const history: { hhmm: string; app: string }[] = [];
  let openApp: string | null = null;
  let openStart = 0;
  let lastApp: string | null = null;
  let lastAppStart = 0;
  let lastClosedPkg: string | null = null;
  let lastClosedTs = 0;
  let autoResumePkg: string | null = null; // 锁屏前在用的 App（解锁后续计）
  let keyguardArmed = false;
  let longestApp: string | null = null;
  let longestMs = 0;
  let switchCount = 0;

  const settle = (pkg: string, s: number, e: number): number => {
    const cs = Math.max(s, startOfDay);
    const ce = Math.min(e, now);
    if (ce <= cs) return 0;
    const dur = ce - cs;
    durationByApp.set(pkg, (durationByApp.get(pkg) ?? 0) + dur);
    return dur;
  };

  const autoResume = (ts: number): void => {
    if (openApp == null && autoResumePkg != null && !isLauncher(autoResumePkg)) {
      openApp = autoResumePkg;
      openStart = ts;
    }
    autoResumePkg = null;
  };

  for (const ev of evs) {
    if (ev.ts > now + 60_000) continue; // 时钟跳变产生的未来事件
    if (ev.type === 1) {
      autoResumePkg = null; // 显式前台事件接管自动续计
      if (openApp && ev.ts > openStart) {
        const dur = settle(openApp, openStart, ev.ts);
        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
        lastClosedPkg = openApp;
        lastClosedTs = ev.ts;
      }
      if (ev.pkg == null || isLauncher(ev.pkg)) {
        openApp = null; // 桌面停留不计入任何 App
        continue;
      }
      const inToday = ev.ts >= startOfDay;
      const intraAppSwitch = openApp == null && ev.pkg === lastClosedPkg && ev.ts - lastClosedTs <= 3000;
      openApp = ev.pkg;
      openStart = ev.ts;
      if (inToday) {
        if (!intraAppSwitch) {
          opensByApp.set(ev.pkg, (opensByApp.get(ev.pkg) ?? 0) + 1);
          switchCount++;
          lastOpenByApp.set(ev.pkg, ev.ts);
        }
        lastApp = ev.pkg;
        lastAppStart = ev.ts;
        history.push({ hhmm: hhmmOf(ev.ts), app: labelOf(ev.pkg) });
      }
    } else if (ev.type === 2) {
      if (openApp && openApp === ev.pkg) {
        const dur = settle(openApp, openStart, ev.ts);
        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
        lastClosedPkg = openApp;
        lastClosedTs = ev.ts;
        openApp = null;
      }
    } else if (ev.type === 3 || ev.type === 5 || ev.type === 7) {
      // 息屏/锁屏/关机：立即结算当前会话
      if (ev.type === 5) keyguardArmed = true;
      if (openApp && ev.ts > openStart) {
        const dur = settle(openApp, openStart, ev.ts);
        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
        lastClosedPkg = openApp;
        lastClosedTs = ev.ts;
        autoResumePkg = openApp;
        openApp = null;
      }
      if (ev.type === 7) { autoResumePkg = null; keyguardArmed = false; }
    } else if (ev.type === 6) {
      // 解锁：自动续计锁屏前的 App（系统不会为同一 Activity 补发 RESUMED）
      keyguardArmed = false;
      autoResume(ev.ts);
    } else if (ev.type === 4) {
      // 亮屏：无锁屏（未拉起 keyguard）才续计；有锁屏等解锁事件
      if (!keyguardArmed) autoResume(ev.ts);
    } else {
      // 开机：状态清零
      openApp = null;
      autoResumePkg = null;
      keyguardArmed = false;
    }
  }

  const sortedApps = [...durationByApp.entries()].sort((a, b) => b[1] - a[1]);
  const totalMs = sortedApps.reduce((s, [, ms]) => s + ms, 0);

  // 媒体会话一并取（与内置路径同源）
  const media = await attachMedia();

  return {
    fetchedAt: now,
    current: openApp
      ? { app: labelOf(openApp), ongoingMs: Math.max(0, now - openStart), at: openStart }
      : lastApp
        ? { app: labelOf(lastApp), ongoingMs: 0, at: lastAppStart }
        : undefined,
    todayApps: sortedApps.slice(0, 30).map(([pkg, ms]) => ({
      app: labelOf(pkg),
      ms,
      opens: opensByApp.get(pkg) ?? 0,
    })),
    todayTotalMs: totalMs,
    switchCount,
    longest: longestApp ? { app: labelOf(longestApp), ms: longestMs } : undefined,
    history: history.slice(-24),
    recentApps: [...lastOpenByApp.entries()]
      .filter(([, ts]) => now - ts <= 3 * 3600_000)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pkg, ts]) => ({
        app: labelOf(pkg),
        hhmm: hhmmOf(ts),
        opens: opensByApp.get(pkg) ?? 0,
        ms: durationByApp.get(pkg) ?? 0,
      })),
    unlocks: undefined,
    media,
    web: undefined,
  } satisfies AwSnapshot;
}

// ---------------- Shizuku 状态/授权 ----------------

// v1.2 新壳才有 shizukuStatus；旧壳不回包 → 短超时探测缓存（同 mediaBridgeAlive 范式）
let shizukuBridgeState: boolean | null = null;

async function shizukuBridgeAlive(): Promise<boolean> {
  if (shizukuBridgeState !== null) return shizukuBridgeState;
  if (!isNativePerception()) {
    shizukuBridgeState = false;
    return false;
  }
  try {
    const r = await Promise.race([
      nativeCall<ShizukuStatusResult>('shizukuStatus', {}, 2500),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), 2600)),
    ]);
    shizukuBridgeState = !!r && typeof r.running === 'boolean';
  } catch {
    shizukuBridgeState = false;
  }
  return shizukuBridgeState;
}

/** Shizuku 状态（null = 非原生环境或旧版 APP 不支持双引擎） */
export async function nativeShizukuStatus(): Promise<ShizukuStatusResult | null> {
  if (!isNativePerception()) return null;
  if (!(await shizukuBridgeAlive())) return null;
  try {
    return await nativeCall<ShizukuStatusResult>('shizukuStatus');
  } catch {
    return null;
  }
}

/** 拉起 Shizuku 授权（会打开 Shizuku APP 的授权弹窗；结果回传或 30s 超时） */
export async function nativeRequestShizukuPermission(): Promise<ShizukuPermissionResult | null> {
  if (!isNativePerception()) return null;
  if (!(await shizukuBridgeAlive())) return null;
  try {
    return await nativeCall<ShizukuPermissionResult>('requestShizukuPermission', {}, 35_000);
  } catch {
    return null;
  }
}

// ---------------- Shizuku 能力实验室（v1.3：通用 shell 执行 + 静默截屏） ----------------
// 原生侧只提供带白名单的 shizukuExec / shizukuScreencap 两个底座方法，
// 全部具体能力（点按/滑动/输入/按键/打开App/强杀/冻结/安装/媒体/网络开关/
// 通知快照/前台App/电量/剪贴板/短信/通话/logcat/自授权）在 @/lib/ios/shizuku-lab
// 里拼 argv + 解析 —— 加能力只改网页、不用重新打包 APK。

export type { ShizukuExecOptions, ShizukuExecResult };

let shizukuLabState: boolean | null = null; // null = 未探测；false = 旧版 APP（v1.2.1 及更早）

/** 能力实验室桥能力探测（新 APK 立即响应；旧 APK 对未知方法不回包 → 超时即 false） */
export async function nativeShizukuLabSupported(): Promise<boolean | null> {
  if (!isNativePerception()) return null;
  if (shizukuLabState !== null) return shizukuLabState;
  try {
    // 用最轻的只读命令探测：旧壳无 shizukuExec 方法 → 3s 无响应判 false
    const r = await Promise.race([
      nativeCall<ShizukuExecResult>('shizukuExec', { cmd: ['wm', 'size'], maxLines: 8 }, 2500),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), 2600)),
    ]);
    shizukuLabState = typeof r?.ok === 'boolean' || typeof r?.reason === 'string';
  } catch {
    shizukuLabState = false;
  }
  return shizukuLabState;
}

/** 通用 Shizuku shell 执行（白名单见原生 SHIZUKU_ALLOWED_BINARIES；null = 非原生环境/桥断） */
export async function nativeShizukuExec(
  cmd: string[],
  opts: ShizukuExecOptions = {},
): Promise<ShizukuExecResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<ShizukuExecResult>('shizukuExec', { cmd, ...opts }, (opts.timeoutMs ?? 8000) + 16_000);
  } catch {
    return null;
  }
}

/** 静默截屏（免 MediaProjection 授权弹窗；dataURL 或 null） */
export async function nativeShizukuScreencap(): Promise<{ ok?: boolean; frame?: string; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; frame?: string; reason?: string }>('shizukuScreencap', {}, 30_000);
  } catch {
    return null;
  }
}

// ---------------- UsageStats（真机感知） ----------------

/** 原生 UsageStats 权限状态（浏览器里返回 null 表示「非原生环境」） */
export async function nativeUsagePermission(): Promise<boolean | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    const r = await p.hasUsagePermission();
    return !!r.granted;
  } catch {
    return false;
  }
}

/** 跳系统设置「有权查看使用情况」（一次授权终身有效） */
export async function openNativeUsageSettings(): Promise<boolean> {
  const p = await nativePlugin();
  if (!p) return false;
  try {
    await p.openUsagePermissionSettings();
    return true;
  } catch {
    return false;
  }
}

// ---------------- 媒体感知（正在听什么歌） ----------------

/** 媒体桥能力（新 APK true；旧 APK false；浏览器 null）。2s 探测一次并缓存 */
export async function nativeMediaSupported(): Promise<boolean | null> {
  if (!isNativePerception()) return null;
  return mediaBridgeAlive();
}

/** 原生「通知使用权」状态（读歌名/歌手需要；null = 非原生环境或旧版 APP 不支持） */
export async function nativeMediaPermission(): Promise<boolean | null> {
  const p = await nativePlugin();
  if (!p) return null;
  if (!(await mediaBridgeAlive())) return null;
  try {
    const r = await p.hasMediaPermission();
    return !!r.granted;
  } catch {
    return false;
  }
}

/** 跳系统设置「通知使用权」（找到 AI Phone 开启，一次授权终身有效） */
export async function openNativeMediaSettings(): Promise<boolean> {
  const p = await nativePlugin();
  if (!p) return false;
  if (!(await mediaBridgeAlive())) return false;
  try {
    await p.openMediaPermissionSettings();
    return true;
  } catch {
    return false;
  }
}

/** 取正在播放的媒体（静默失败 null；供快照聚合复用） */
async function attachMedia(): Promise<AwSnapshot['media']> {
  if (!(await mediaBridgeAlive())) return undefined;
  const p = await nativePlugin();
  if (!p) return undefined;
  try {
    const np = await p.getNowPlaying();
    if (np && np.ok && np.playing && (np.playing.title || np.playing.state === 'playing')) {
      return {
        app: np.playing.app || np.playing.pkg,
        title: np.playing.title || '',
        artist: np.playing.artist || '',
        state: np.playing.state === 'playing' ? 'playing' : 'paused',
      };
    }
  } catch {
    /* 媒体不可用不影响其余数据 */
  }
  return undefined;
}

/** 原生快照 → AwSnapshot（下游感知块/设置页零改动兼容；engine 字段供设置页展示） */
function mapNativeSnapshot(r: UsageSnapshotResult): AwSnapshot {
  const now = Date.now();
  return {
    fetchedAt: now,
    current: r.current
      ? {
          app: r.current.name || r.current.app,
          ongoingMs: r.current.ongoingMs || 0,
          at: r.current.at && r.current.at > 0 ? r.current.at : now - (r.current.ongoingMs || 0),
        }
      : undefined,
    todayApps: (r.todayApps ?? []).map((x) => ({ app: x.name || x.app, ms: x.ms, opens: x.opens })),
    todayTotalMs: r.todayTotalMs ?? 0,
    switchCount: r.switchCount ?? 0,
    longest: r.longest
      ? { app: r.longest.app, ms: typeof r.longest.ms === 'string' ? Number(r.longest.ms) || 0 : r.longest.ms }
      : undefined,
    history: (r.history ?? []).map((x) => ({ hhmm: x.hhmm, app: x.name || x.app })),
    recentApps: (r.recentApps ?? []).map((x) => ({
      app: x.name || x.app,
      hhmm: x.hhmm,
      opens: x.opens,
      ms: x.ms,
    })),
    // UsageStats 拿不到解锁/网页事件：省略（AwSnapshot 全字段可选）
    unlocks: undefined,
    media: undefined,
    web: undefined,
    engine: r.engine === 'shizuku' ? 'shizuku' : r.engine === 'standard' ? 'native' : r.engine,
    engineNote: r.engineNote,
  } satisfies AwSnapshot;
}

/** 原生 UsageStats 快照 → AwSnapshot（v1.2 双引擎路由 + 自动降级）
 *
 *  - shizuku 模式：原生内部读 dumpsys（未激活/未授权自动降级标准并带 engineNote）；
 *  - standard 模式：Cap-go 插件（新 APK）事件级 JS 聚合优先，旧壳/失败回落内置原生；
 *  - 媒体会话（歌名/歌手，需「通知使用权」）所有路径一并附带。 */
export async function nativeUsageSnapshot(): Promise<AwSnapshot | null> {
  const p = await nativePlugin();
  if (!p) return null;
  const engine = getUsageEngine();

  if (engine === 'shizuku') {
    try {
      const r = await p.getUsageSnapshot({ source: 'shizuku' });
      if (r && r.ok) {
        const snap = mapNativeSnapshot(r);
        snap.media = await attachMedia();
        return snap;
      }
      if (r && r.needPermission) {
        // Shizuku 失效降级 + 「使用情况」也没授权：确实无数据
        return null;
      }
    } catch {
      /* 桥异常 → 走内置兜底 */
    }
  } else {
    // 标准引擎：Cap-go 优先（v1.2 新壳；事件级聚合口径与原生一致）
    if (await capgoBridgeAlive()) {
      try {
        const snap = await capgoUsageSnapshot();
        if (snap) return { ...snap, engine: 'capgo' } satisfies AwSnapshot;
      } catch {
        /* 回落内置原生 */
      }
    }
  }

  // 内置原生兜底（v1.2 口径；shizuku 模式桥异常时也走这里）
  try {
    const r = await p.getUsageSnapshot(engine === 'shizuku' ? { source: 'shizuku' } : {});
    if (!r || !r.ok) return null;
    const snap = mapNativeSnapshot(r);
    snap.media = await attachMedia();
    return snap;
  } catch {
    return null;
  }
}

// ---------------- 屏幕抓帧（TA 看到我的屏幕） ----------------

/** 发起 MediaProjection 授权并启动捕获会话（系统弹窗一次；成功 true） */
export async function requestNativeScreenCapture(): Promise<'ok' | 'canceled' | 'unavailable'> {
  const p = await nativePlugin();
  if (!p) return 'unavailable';
  try {
    const r = await p.requestScreenCapture();
    if (r && r.ok) return 'ok';
    return 'canceled';
  } catch {
    return 'canceled';
  }
}

/** 停止原生屏幕捕获会话 */
export async function stopNativeScreenCapture(): Promise<void> {
  const p = await nativePlugin();
  if (!p) return;
  try {
    await p.stopScreenCapture();
  } catch {
    /* 静默 */
  }
}

/** 原生抓一帧屏幕（dataURL；无会话/非原生返回 null） */
export async function nativeGrabScreenFrame(): Promise<string | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    const r = await p.grabScreenFrame();
    if (r && r.ok && r.frame) return r.frame;
    return null;
  } catch {
    return null;
  }
}
