'use client';

/**
 * 原生感知桥（APP 壳内自动激活，浏览器里全部静默降级）：
 *
 * 运行环境判定：Capacitor 壳（android-shell/ 编译出的 APK）里的 WebView 通过
 * WebMessageListener / addJavascriptInterface 全局注入 window.androidBridge，
 * 跨域页面（沙箱预览地址）同样可见 —— 网页侧据此判定原生环境。
 *
 * 关键补丁（修复「当前环境不支持原生屏幕感知」）：Capacitor 8 的注入脚本
 * （native-bridge.js + 插件代理）只覆盖壳自身的源，跨域页面拿不到
 * window.Capacitor.Plugins —— 因此这里自建一份 Capacitor 消息协议客户端，
 * 直接经 androidBridge.postMessage 调原生插件，回传双通道兼容：
 * ① WebMessageListener（现代 WebView）：androidBridge.onmessage(event.data)
 * ② legacy addJavascriptInterface：evaluateJavascript 调 window.Capacitor.fromNative
 *
 * 能力（对应 NativePerceptionPlugin.java）：
 * - UsageStats 真机感知：getUsageSnapshot（免装 ActivityWatch，替代其 502 链路）；
 * - 屏幕抓帧：requestScreenCapture（MediaProjection 授权，每会话一次）+
 *   grabScreenFrame（抓一帧 dataURL 喂 VLM，替代手机端不可用的 getDisplayMedia）。
 */

import type { AwSnapshot } from './activitywatch';

type CapPlugin = {
  hasUsagePermission(): Promise<{ granted: boolean }>;
  openUsagePermissionSettings(): Promise<void>;
  getUsageSnapshot(): Promise<{
    ok: boolean;
    needPermission?: boolean;
    current?: { app: string; name: string; ongoingMs: number; at?: number; closed?: boolean };
    todayApps?: { app: string; name: string; ms: number; opens?: number; lastOpenTs?: number }[];
    todayTotalMs?: number;
    switchCount?: number;
    longest?: { app: string; ms: number };
    history?: { hhmm: string; app: string; name: string }[];
    recentApps?: { app: string; name: string; hhmm: string; opens: number; ms: number }[];
  }>;
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

/** 经自建协议调用原生插件方法（与 native-bridge 的 toNative 同构；10s 超时防永久挂起） */
function bridgeCall<T>(methodName: string, options: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
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
      reject(new Error(`原生调用超时（${methodName}，桥无响应）`));
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
        JSON.stringify({ callbackId, pluginId: 'NativePerception', methodName, options })
      );
    } catch (e) {
      window.clearTimeout(timer);
      pendingCalls.delete(callbackId);
      reject(e);
    }
  });
}

type UsageSnapshotResult = Awaited<ReturnType<CapPlugin['getUsageSnapshot']>>;
type NowPlayingResult = Awaited<ReturnType<CapPlugin['getNowPlaying']>>;

// ---------------- 媒体桥新旧壳探测 ----------------
// 旧 APK（v1.0）没有 hasMediaPermission/getNowPlaying 方法，且 Capacitor 对未知方法
// 只记日志不回包 —— 直接调用会挂到 10s 超时。这里用短超时探测一次并缓存：
// 新壳 → 立即响应；旧壳 → 超时后未页面会话内不再尝试（零后续成本）。
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
    hasUsagePermission: () => bridgeCall<{ granted: boolean }>('hasUsagePermission'),
    openUsagePermissionSettings: () => bridgeCall<void>('openUsagePermissionSettings'),
    getUsageSnapshot: () => bridgeCall<UsageSnapshotResult>('getUsageSnapshot'),
    hasMediaPermission: () => bridgeCall<{ granted: boolean }>('hasMediaPermission'),
    openMediaPermissionSettings: () => bridgeCall<void>('openMediaPermissionSettings'),
    getNowPlaying: () => bridgeCall<NowPlayingResult>('getNowPlaying'),
    requestScreenCapture: () => bridgeCall<{ ok: boolean; canceled?: boolean }>('requestScreenCapture'),
    grabScreenFrame: () => bridgeCall<{ ok: boolean; needSession?: boolean; frame?: string }>('grabScreenFrame'),
    stopScreenCapture: () => bridgeCall<void>('stopScreenCapture'),
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

/** 原生正在播放的媒体（无权限/暂无播放/非原生/旧壳返回 null） */
export async function nativeNowPlaying(): Promise<NowPlayingResult['playing'] | null> {
  const p = await nativePlugin();
  if (!p) return null;
  if (!(await mediaBridgeAlive())) return null;
  try {
    const r = await p.getNowPlaying();
    if (!r || !r.ok) return null;
    return r.playing ?? null;
  } catch {
    return null;
  }
}

/** 原生 UsageStats 快照 → AwSnapshot 形状（下游感知块/设置页零改动兼容）
 *
 * v1.1：同步携带媒体会话（歌名/歌手，需「通知使用权」）与最近打开的 App 列表；
 * 时长已由原生侧按 RESUMED→PAUSED 配对精确计算（息屏不计入）。 */
export async function nativeUsageSnapshot(): Promise<AwSnapshot | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    const r = await p.getUsageSnapshot();
    if (!r || !r.ok) return null;
    const now = Date.now();
    // 媒体感知一并取（同一快照里下行；旧壳探测失败/无权限/未播放时静默省略）
    let media: AwSnapshot['media'] | undefined;
    if (await mediaBridgeAlive()) {
      try {
        const np = await p.getNowPlaying();
        if (np && np.ok && np.playing && (np.playing.title || np.playing.state === 'playing')) {
          media = {
            app: np.playing.app || np.playing.pkg,
            title: np.playing.title || '',
            artist: np.playing.artist || '',
            state: np.playing.state === 'playing' ? 'playing' : 'paused',
          };
        }
      } catch {
        /* 媒体不可用不影响其余数据 */
      }
    }
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
      longest: r.longest,
      history: (r.history ?? []).map((x) => ({ hhmm: x.hhmm, app: x.name || x.app })),
      recentApps: (r.recentApps ?? []).map((x) => ({
        app: x.name || x.app,
        hhmm: x.hhmm,
        opens: x.opens,
        ms: x.ms,
      })),
      // UsageStats 拿不到解锁/网页事件：省略（AwSnapshot 全字段可选）
      unlocks: undefined,
      media,
      web: undefined,
    } satisfies AwSnapshot;
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
