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
/** 麦克风 / 系统通知运行时权限查询与申请结果（v1.6.1 真机语音三问题修复） */
type RuntimePermResult = { granted?: boolean; canAsk?: boolean };

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
  micPermission(): Promise<RuntimePermResult>;
  requestMicPermission(): Promise<RuntimePermResult>;
  notificationPermission(): Promise<RuntimePermResult & { sdk?: number }>;
  requestNotificationPermission(): Promise<RuntimePermResult>;
  overlayPermission(): Promise<RuntimePermResult>;
  requestOverlayPermission(): Promise<{ ok?: boolean; reason?: string }>;
  batteryPermission(): Promise<RuntimePermResult>;
  requestBatteryPermission(): Promise<{ ok?: boolean; reason?: string }>;
  locationPermission(): Promise<RuntimePermResult & { fine?: boolean; coarse?: boolean }>;
  requestLocationPermission(): Promise<RuntimePermResult & { fine?: boolean; coarse?: boolean }>;
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
    micPermission: () => nativeCall<RuntimePermResult>('micPermission'),
    // 首次弹系统授权框：用户可能犹豫许久，看门狗放宽到 60s（已授予时毫秒级直通）
    requestMicPermission: () => nativeCall<RuntimePermResult>('requestMicPermission', {}, 60_000),
    notificationPermission: () => nativeCall<RuntimePermResult & { sdk?: number }>('notificationPermission'),
    requestNotificationPermission: () => nativeCall<RuntimePermResult>('requestNotificationPermission', {}, 60_000),
    overlayPermission: () => nativeCall<RuntimePermResult>('overlayPermission'),
    requestOverlayPermission: () => nativeCall<{ ok?: boolean; reason?: string }>('requestOverlayPermission'),
    batteryPermission: () => nativeCall<RuntimePermResult>('batteryPermission'),
    requestBatteryPermission: () => nativeCall<{ ok?: boolean; reason?: string }>('requestBatteryPermission'),
    locationPermission: () => nativeCall<RuntimePermResult & { fine?: boolean; coarse?: boolean }>('locationPermission'),
    requestLocationPermission: () =>
      nativeCall<RuntimePermResult & { fine?: boolean; coarse?: boolean }>('requestLocationPermission', {}, 60_000),
  };
}

/** 同步判定：是否运行在原生壳里（androidBridge 由 WebView 注入，无需加载 SDK） */
export function isNativePerception(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as { androidBridge?: unknown }).androidBridge;
  return !!bridge && typeof (bridge as AndroidBridgeLike).postMessage === 'function';
}

// ---------------- v1.6.1 麦克风 / 通知运行时权限（真机语音三问题修复） ----------------
// 背景：WebView 里 Web API 的权限面与 Android 运行时权限不互通 ——
// ① getUserMedia 录音：Manifest 未声明 RECORD_AUDIO 时被系统静默拒绝（永不弹框）；
// ② Notification.permission：WebView 恒为 'denied'（Web API 不映射 Android 权限），
//    设置页读它必然误报「已在设置中关闭系统通知」。
// 因此原生壳内一律经本插件查询/申请（弹系统授权框）。
//
// v1.9.37 浏览器授权回退：麦克风/位置在浏览器里也有对应的 Web 权限面
// （getUserMedia / Geolocation，点「允许」弹浏览器授权框）——非原生壳不再返回
// null（不再标「需真机」），而是真实查询/申请浏览器授权状态。

/** 浏览器 Permissions API 查询（权限名不支持/无此 API 时回 undefined） */
async function webPermState(name: 'microphone' | 'geolocation'): Promise<PermissionState | undefined> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined;
  try {
    const st = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
    return st.state;
  } catch {
    return undefined;
  }
}

/** 查询麦克风权限（原生壳读 Android 运行时权限；浏览器读 Web 权限面，非真机也能授权） */
export async function micPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) return p.micPermission();
  const s = await webPermState('microphone');
  if (s === 'granted') return { granted: true };
  if (s === 'denied') return { granted: false, canAsk: false }; // 浏览器站点设置里已阻止
  return { granted: false, canAsk: true }; // prompt / 查不到（Safari 等）：未授权但可申请
}

/**
 * 申请麦克风权限（原生壳弹系统授权框；浏览器经 getUserMedia 弹浏览器授权框，
 * 拿到结果立即释放录音流不占麦克风）。
 */
export async function requestMicPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) return p.requestMicPermission();
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null; // 非安全上下文等：浏览器确实申请不了
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return { granted: true };
  } catch (e) {
    const refused = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    if (refused) {
      const s = await webPermState('microphone');
      return { granted: false, canAsk: s !== 'denied' }; // 站点被阻止 → 需去浏览器设置
    }
    return { granted: false, canAsk: true }; // 无麦克风设备等：不算被系统关闭
  }
}

/** 查询系统通知权限真实状态（areNotificationsEnabled，含 13+ 运行时权限与应用内总闸；非原生壳返回 null） */
export async function notificationPermission(): Promise<(RuntimePermResult & { sdk?: number }) | null> {
  const p = await nativePlugin();
  return p ? p.notificationPermission() : null;
}

/** 申请系统通知权限（Android 13+ 弹 POST_NOTIFICATIONS 系统框；非原生壳返回 null） */
export async function requestNotificationPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  return p ? p.requestNotificationPermission() : null;
}

// ---------------- v1.9.36 权限给予页：悬浮窗 / 电池优化豁免 / 位置（三通道级联） ----------------
// 级联策略（每个权限状态查询/申请都一样）：
//  ① 新 APK（v1.9.36+ 原生方法）：nativeCall 直查/直弹系统框（毫秒级）；
//  ② 旧 APK + Shizuku 已授权：经 shizukuExec（shell 权限）查 appops/dumpsys/pm
//     真实状态，或直接 appops set / dumpsys deviceidle whitelist / pm grant 授予；
//  ③ 都不可用 → null / 'unavailable'（设置页展示「需真机/旧 APK 提示升级」）。

/** 本 APP 包名（Shizuku shell 命令的权限主体） */
const APP_PKG = 'com.z.aiphone';

/** 原生方法短超时探测（旧 APK 对未知方法不回包，卡满超时才回落；3s 判定足够） */
async function nativeOrTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), ms))]);
}

/** Shizuku 是否已连接且授权（沿能力实验室探测口径） */
async function shizukuReady(): Promise<boolean> {
  const st = await nativeShizukuStatus();
  return Boolean(st?.running && st?.granted);
}

/** 悬浮窗权限状态（①新 APK 原生 ②Shizuku appops 查询；都不可用 null） */
export async function overlayPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) {
    try {
      return await nativeOrTimeout(p.overlayPermission());
    } catch {
      /* 旧 APK 无此方法 → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(['cmd', 'appops', 'get', APP_PKG, 'SYSTEM_ALERT_WINDOW'], { maxLines: 4, timeoutMs: 4000 });
    if (r?.ok && r.out) {
      const granted = /allow/i.test(r.out);
      return { granted, canAsk: true };
    }
  }
  return null;
}

/** 申请悬浮窗权限（①新 APK 跳系统开关页 ②Shizuku appops set 直授；返回执行通道说明） */
export async function requestOverlayPermission(): Promise<{ ok: boolean; via: 'native' | 'shizuku' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestOverlayPermission());
      if (r?.ok) return { ok: true, via: 'native' };
    } catch {
      /* 旧 APK → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(['cmd', 'appops', 'set', APP_PKG, 'SYSTEM_ALERT_WINDOW', 'allow'], { maxLines: 4, timeoutMs: 5000 });
    if (r?.ok) return { ok: true, via: 'shizuku' };
  }
  return { ok: false, via: 'unavailable' };
}

/** 电池优化豁免状态（①新 APK 原生 ②Shizuku dumpsys deviceidle 白名单查询） */
export async function batteryPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) {
    try {
      return await nativeOrTimeout(p.batteryPermission());
    } catch {
      /* 旧 APK → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(['dumpsys', 'deviceidle', 'whitelist'], { maxLines: 80, timeoutMs: 4000 });
    if (r?.ok && r.out) {
      const granted = r.out.split('\n').some((l) => l.includes(APP_PKG));
      return { granted, canAsk: true };
    }
  }
  return null;
}

/** 申请电池优化豁免（①新 APK 弹系统确认框 ②Shizuku dumpsys 白名单直加） */
export async function requestBatteryPermission(): Promise<{ ok: boolean; via: 'native' | 'shizuku' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestBatteryPermission());
      if (r?.ok) return { ok: true, via: 'native' };
    } catch {
      /* 旧 APK → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(['dumpsys', 'deviceidle', 'whitelist', `+${APP_PKG}`], { maxLines: 4, timeoutMs: 5000 });
    if (r?.ok) return { ok: true, via: 'shizuku' };
  }
  return { ok: false, via: 'unavailable' };
}

/** 位置权限状态（①新 APK 原生 ②Shizuku pm check-permission ③浏览器 Geolocation 权限面） */
export async function locationPermission(): Promise<(RuntimePermResult & { fine?: boolean; coarse?: boolean }) | null> {
  const p = await nativePlugin();
  if (p) {
    try {
      return await nativeOrTimeout(p.locationPermission());
    } catch {
      /* 旧 APK → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(
      ['pm', 'check-permission', 'android.permission.ACCESS_FINE_LOCATION', APP_PKG],
      { maxLines: 4, timeoutMs: 4000 },
    );
    if (r?.ok && r.out) {
      const granted = /granted\s*=\s*true/i.test(r.out);
      return { granted, fine: granted, coarse: granted, canAsk: !granted };
    }
  }
  // 浏览器：Geolocation 授权状态（v1.9.37 非真机也能授权，不再标「需真机」）
  if (!isNativePerception()) {
    const s = await webPermState('geolocation');
    if (s === 'granted') return { granted: true, fine: true, coarse: true };
    if (s === 'denied') return { granted: false, canAsk: false }; // 浏览器站点设置里已阻止
    return { granted: false, canAsk: true };
  }
  return null;
}

/**
 * 申请位置权限（①新 APK 弹系统授权框 ②Shizuku pm grant 直授——需 Manifest 已声明
 * ③浏览器经 Geolocation 弹浏览器授权框，拿到一次定位即视为已授权）。
 */
export async function requestLocationPermission(): Promise<{ ok: boolean; via: 'native' | 'shizuku' | 'web' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestLocationPermission(), 60_000);
      if (r?.granted) return { ok: true, via: 'native' };
      if (r && !r.granted && r.canAsk === false) return { ok: false, via: 'native' }; // 用户拒绝：如实回传
    } catch {
      /* 旧 APK → Shizuku 回退 */
    }
  }
  if (await shizukuReady()) {
    const r = await nativeShizukuExec(
      ['pm', 'grant', APP_PKG, 'android.permission.ACCESS_FINE_LOCATION'],
      { maxLines: 4, timeoutMs: 5000 },
    );
    if (r?.ok) return { ok: true, via: 'shizuku' };
  }
  // 浏览器：弹浏览器定位授权框（用户点了「允许」拿到一次定位 = 已授权）
  if (!isNativePerception() && typeof navigator !== 'undefined' && navigator.geolocation) {
    const r = await new Promise<GeolocationPosition | number | null>((res) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => res(pos),
        (err) => res(err.code), // 1=用户拒绝/站点被阻止 2=位置不可用 3=超时
        { timeout: 15_000, maximumAge: 600_000 },
      );
    });
    return { ok: Boolean(r && typeof r !== 'number'), via: 'web' };
  }
  return { ok: false, via: 'unavailable' };
}

/**
 * 弹一条 Android 系统通知栏通知（v1.9.1，设置 › 通知「发送测试通知」及 showSystemNotification 原生通道共用）：
 *
 * - 非原生壳 → null（调用方回落 Web 通道）；
 * - v1.5.0+ 壳有 localNotify @PluginMethod → nativeCall 拿真实回执，返回 true=已交给系统通知栏
 *   （Android 13+ 通知未授权时原生侧静默忽略并回 ok——语义与真实通知一致，权限状态由
 *   notificationPermission/querySystemNotifyPermission 单独反映）；
 * - 旧壳（< v1.5.0）无该方法 → 原生 Bridge 报错或超时 → false（调用方给「升级 APP」引导，
 *   不再误报浏览器策略问题）。
 */
export async function localNotify(opts: {
  title: string;
  body?: string;
  tag?: string;
  /** 点击通知落地的站内路径（原生 contentIntent 打开 APP 后经 'local-notify-open' 事件回传） */
  url?: string;
  /** 点击直达目标（island-notify NotifyTarget 同构纯对象，随事件回传给导航总线） */
  target?: unknown;
}): Promise<boolean | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    await nativeCall('localNotify', { title: opts.title, body: opts.body, tag: opts.tag, url: opts.url, target: opts.target }, 5000);
    return true;
  } catch {
    return false; // 旧壳无该方法 / 桥异常
  }
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
  type RawEv = { packageName?: string; timeStamp?: number; eventType?: number };
  const evs: Ev[] = (evRes?.events ?? [])
    .filter((e): e is RawEv & { timeStamp: number } => {
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
// 全部具体能力（已随 v1.9.35 真机操控退役下线）原在 @/lib/ios/shizuku-lab
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

// ---------------- v1.5 Mobile Agent：智能体专用桥方法 ----------------
// 全部照抄 nativeShizukuExec 的防御模式：非原生环境/null、调用异常/null ——
// 调用方拿到 null 就按「桥无响应（非原生环境或原生调用超时）」处理，绝不抛错
// 打断 Agent 主循环（runAgentTask 里任何异常都会终止任务，这里必须兜死）。

export interface AgentShellResult {
  ok?: boolean;
  /** 命令标准输出+标准错误混合文本 */
  out?: string;
  reason?: string;
}

/** 通用 shell 执行（Agent 用：resolve-activity/am start 等；白名单见原生侧 executeShell） */
export async function nativeAgentExecuteShell(cmd: string[], timeoutMs = 15000): Promise<AgentShellResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<AgentShellResult>('executeShell', { cmd, timeoutMs }, timeoutMs + 16000);
  } catch {
    return null;
  }
}

/** 屏幕分辨率（Agent 滑动坐标换算用；width/height 或 raw 原始输出） */
export async function nativeGetScreenResolution(): Promise<{
  ok?: boolean;
  width?: number;
  height?: number;
  raw?: string;
  reason?: string;
} | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; width?: number; height?: number; raw?: string; reason?: string }>(
      'getScreenResolution',
      {},
      12000,
    );
  } catch {
    return null;
  }
}

/** uiautomator dump UI 树（Agent 看屏核心；游戏/视频全屏等场景可能失败） */
export async function nativeDumpUi(): Promise<{ ok?: boolean; xml?: string; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; xml?: string; reason?: string }>('dumpUi', {}, 30000);
  } catch {
    return null;
  }
}

export interface ChineseInputResult {
  ok?: boolean;
  /** 实际输入通道：ascii = input text 直输；ime = 原生输入法通道（必要时临时切中文 IME） */
  via?: 'ascii' | 'ime';
  /** 是否发生了 IME 临时切换（true 时 currentIme 带切换前的原输入法，任务结束要还原） */
  switched?: boolean;
  /** 切换前的原输入法 id（restoreIme 用） */
  currentIme?: string;
  reason?: string;
}

/** 中文/非 ASCII 输入（input text 只支持 ASCII；原生侧经输入法通道注入） */
export async function nativeInputChinese(text: string): Promise<ChineseInputResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<ChineseInputResult>('inputChinese', { text }, 25000);
  } catch {
    return null;
  }
}

/** 还原机主原输入法（Agent 中文输入临时切换后的收尾） */
export async function nativeRestoreIme(imeId: string): Promise<{ ok?: boolean; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; reason?: string }>('restoreIme', { imeId }, 10000);
  } catch {
    return null;
  }
}

/** 原生急停旗标查询（通知栏「急停」按钮置位；Agent 主循环每步前轮询） */
export async function nativeAgentShouldStop(): Promise<{ stop?: boolean } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ stop?: boolean }>('agentShouldStop', {}, 5000);
  } catch {
    return null;
  }
}

/** 复位原生急停旗标（任务开始/结束时调用，保证下次任务干净） */
export async function nativeAgentResetStop(): Promise<{ ok?: boolean } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean }>('agentResetStop', {}, 5000);
  } catch {
    return null;
  }
}

/** 常驻通知「AI 智能体运行中」（任务开始时发布，带急停按钮的原生侧实现） */
export async function nativeAgentNotify(title: string, text?: string): Promise<{ ok?: boolean; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; reason?: string }>('agentNotify', { title, text: text ?? '' }, 10000);
  } catch {
    return null;
  }
}

/** 撤掉常驻通知（任务结束/急停/异常的收尾） */
export async function nativeAgentNotifyEnd(): Promise<{ ok?: boolean } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean }>('agentNotifyEnd', {}, 5000);
  } catch {
    return null;
  }
}
