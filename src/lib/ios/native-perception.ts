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
 * 直接经 androidBridge.postMessage 调原生插件。
 *
 * 【v2.0.0 去 Shizuku 化大重构】真机能力全部改由安卓原生系统 API + 无障碍服务
 * （AiAccessibilityService）实现，本文件同步替换桥契约：
 *  - 移除：shizukuStatus / requestShizukuPermission / shizukuExec / shizukuScreencap /
 *    executeShell / getScreenResolution(wm) / dumpUi(uiautomator) / inputChinese(ime)
 *  - 新增：无障碍组（accessibilityPermission / a11yScreenshot / a11yTap / a11ySwipe /
 *    a11yKey / a11yInput / getScreenSize / getForegroundApp）、锁定组（lockApp /
 *    unlockApp，jealousyGuard* 三方法保留为同内核别名）、拉起组（bringToFront /
 *    openApp / listInstalledApps）、消息组（getRecentSMS / getRecentNotifications）、
 *    原生信息组（getBatteryStatus / getVolume / setVolume）、权限中心 11 项
 *    （无障碍/使用情况/悬浮窗/通知使用/短信/通讯录/日历/闹钟/位置/媒体文件/电池优化）
 */

import type { AwSnapshot } from './activitywatch';

type UsageSnapshotResult = {
  ok: boolean;
  needPermission?: boolean;
  /** 本轮数据实际由哪个引擎产出（native=原生 UsageStats；旧壳无此字段 → native） */
  engine?: string;
  current?: { app: string; name: string; ongoingMs: number; at?: number; closed?: boolean };
  todayApps?: { app: string; name: string; ms: number; opens?: number; lastOpenTs?: number }[];
  todayTotalMs?: number;
  switchCount?: number;
  longest?: { app: string; ms: string } | { app: string; ms: number };
  history?: { hhmm: string; app: string; name: string }[];
  recentApps?: { app: string; name: string; hhmm: string; opens: number; ms: number }[];
};
/** 麦克风 / 系统通知运行时权限查询与申请结果 */
type RuntimePermResult = { granted?: boolean; canAsk?: boolean };

/** 无障碍服务权限状态 */
export interface A11yPermResult {
  granted?: boolean;
  /** 服务实例是否已连接（开启即连，个别 ROM 有延迟） */
  connected?: boolean;
  canAsk?: boolean;
}

/** 无障碍截屏结果（frame 为 dataURL；reason: no-a11y/not-supported/empty/failed） */
export interface A11yShotResult {
  ok?: boolean;
  frame?: string;
  reason?: string;
}

/** 前台应用查询结果 */
export interface ForegroundAppResult {
  ok?: boolean;
  /** 前台应用包名 */
  app?: string;
  /** 应用中文名 */
  name?: string;
  /** 采集通道：a11y=无障碍事件流（实时） / usage=UsageStats 兜底（~3s 粒度） */
  via?: 'a11y' | 'usage';
  at?: number;
  reason?: string;
}

/** 最近短信（getRecentSMS） */
export interface RecentSmsItem {
  ts: number;
  address: string;
  body: string;
}

/** 最近通知（getRecentNotifications） */
export interface RecentNotificationItem {
  ts: number;
  pkg: string;
  app: string;
  title: string;
  text: string;
}

/** 原生动作通用结果（点按/滑动/按键/输入/打开应用等）；v2.2.0 bringToFront 带 via 通道标记 */
export interface NativeActionResult {
  ok?: boolean;
  reason?: string;
  /** v2.2.0 拉回通道：foreground=前台直拉 / overlay-exempt=悬浮窗豁免后台拉 / notification=通知兜底 */
  via?: string;
}

/** v2.3.0 原生系统级工具结果 */
export interface NativeAlarmResult {
  ok?: boolean;
  hour?: number;
  minute?: number;
  seconds?: number;
  reason?: string;
}

export interface NativeCalendarResult {
  ok?: boolean;
  via?: 'insert' | 'intent';
  calendar?: string;
  eventTitle?: string;
  reason?: string;
}

/** v2.4.3 真机系统日历某天日程（getRealCalendarEvents） */
export interface NativeRealCalendarResult {
  ok?: boolean;
  events?: Array<{
    title: string;
    begin: number;
    end: number;
    allDay?: boolean;
    location?: string;
  }>;
  reason?: string;
}

export interface NativeCallSmsResult {
  ok?: boolean;
  /** direct-call=直接拨 / dialer=拉拨号盘 / silent=静默发送 / compose=拉短信应用预填 */
  via?: string;
  phoneNumber?: string;
  reason?: string;
}

export interface RealContactItem {
  name: string;
  phone: string;
  type: string;
}

export interface NativeContactResult {
  ok?: boolean;
  contacts?: RealContactItem[];
  count?: number;
  reason?: string;
}

export interface NativeLocationResult {
  ok?: boolean;
  lat?: number;
  lng?: number;
  accuracy?: number;
  city?: string;
  address?: string;
  reason?: string;
}

// ---------------- v2.4.2 健康运动 / 文件 / 下载 / 网络工具结果 ----------------

/** v2.4.2 今日步数（TYPE_STEP_COUNTER 硬件计步 + 今日零点基线折算） */
export interface NativeStepResult {
  ok?: boolean;
  reason?: string;
  steps?: number;
  totalSinceReboot?: number;
  estimated?: boolean;
}

/** v2.4.2 当前运动状态（加速度计启发式：静止/步行/跑步/可能乘车/活动中） */
export interface NativeActivityResult {
  ok?: boolean;
  reason?: string;
  activity?: string;
  detail?: string;
}

/** v2.4.2 昨晚睡眠估算（UsageStats 亮屏间隔推算） */
export interface NativeSleepResult {
  ok?: boolean;
  reason?: string;
  found?: boolean;
  sleepMinutes?: number;
  from?: string;
  to?: string;
  estimated?: boolean;
  note?: string;
}

/** v2.4.2 公共目录文件清单 */
export interface NativeFileItem {
  name: string;
  dir?: boolean;
  size?: number;
  mime?: string;
}

export interface NativeFileListResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  path?: string;
  items?: NativeFileItem[];
  note?: string;
}

/** v2.4.2 文本文件内容 */
export interface NativeFileReadResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  path?: string;
  size?: number;
  content?: string;
  truncated?: boolean;
}

/** v2.4.2 保存文本文件结果 */
export interface NativeFileSaveResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  path?: string;
  size?: number;
}

/** v2.4.2 系统下载器结果 */
export interface NativeDownloadResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  id?: number;
  path?: string;
  note?: string;
}

/** v2.4.2 网络状态 */
export interface NativeNetworkResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  type?: 'wifi' | 'cellular' | 'offline' | 'other' | 'unknown';
  wifiLevel?: number;
  ssid?: string;
  cellGen?: string;
  cellLevel?: number;
}

type CapPlugin = {
  hasUsagePermission(): Promise<{ granted: boolean }>;
  openUsagePermissionSettings(): Promise<void>;
  getUsageSnapshot(options?: { source?: string }): Promise<UsageSnapshotResult>;
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
  /** v2.4.3 媒体传输控制（切歌/暂停/继续） */
  controlMedia(options: { action: string }): Promise<{ ok?: boolean; action?: string; reason?: string }>;
  /** v2.4.3 读真机系统日历某天日程 */
  getRealCalendarEvents(options: { date?: string }): Promise<NativeRealCalendarResult>;
  /** v2.4.3 APP 内保存 base64 到下载目录（备份导出） */
  saveBase64Download(options: { filename: string; mime?: string; base64: string }): Promise<{ ok?: boolean; path?: string; bytes?: number; reason?: string }>;
  /** v2.4.3 APP 内下载 APK 并调起安装 */
  downloadAndInstallApk(options: { url: string }): Promise<{ ok?: boolean; downloading?: boolean; needPermission?: boolean; reason?: string }>;
  grabScreenFrame(): Promise<{ ok: boolean; needSession?: boolean; frame?: string }>;
  stopScreenCapture(): Promise<void>;
  /** v2.0.0 无障碍组 */
  accessibilityPermission(): Promise<A11yPermResult>;
  openAccessibilitySettings(): Promise<void>;
  a11yScreenshot(): Promise<A11yShotResult>;
  a11yTap(options: { x: number; y: number }): Promise<NativeActionResult>;
  a11ySwipe(options: { x1: number; y1: number; x2: number; y2: number; duration?: number }): Promise<NativeActionResult>;
  a11yKey(options: { key: string }): Promise<NativeActionResult>;
  a11yInput(options: { text: string }): Promise<NativeActionResult>;
  getScreenSize(): Promise<{ ok?: boolean; width?: number; height?: number; reason?: string }>;
  getForegroundApp(): Promise<ForegroundAppResult>;
  /** v2.0.0 拉起组 */
  bringToFront(): Promise<NativeActionResult>;
  openApp(options: { pkg: string }): Promise<NativeActionResult>;
  listInstalledApps(options?: { limit?: number }): Promise<{ ok?: boolean; apps?: { pkg: string; name: string }[] }>;
  /** v2.0.0 锁定组（LockOverlayService：UsageStats 轮询 + 全屏遮罩） */
  lockApp(options: { pkg?: string; unlockAt?: number; charName?: string; message?: string }): Promise<{ ok?: boolean; reason?: string }>;
  unlockApp(): Promise<{ ok?: boolean; reason?: string }>;
  jealousyGuardSyncLock(options: { pkg?: string; unlockAt?: number; charName?: string; message?: string }): Promise<{ ok?: boolean; reason?: string }>;
  jealousyGuardStatus(): Promise<JealousyGuardStatusResult>;
  jealousyGuardDrainEvents(): Promise<{ events?: JealousyGuardEvent[] }>;
  /** v2.4.4 锁定期热更新留言（AI 按人设/记忆/尝试次数改拦截窗文案） */
  updateLockMessage(options: { message: string }): Promise<{ ok?: boolean; reason?: string }>;
  /** v2.4.4 桥能力探测（旧 APK 调不存在方法会挂到超时——先探测再调用，秒级回退） */
  bridgeCapabilities(): Promise<{ ok?: boolean; methods?: string[] }>;
  /** v2.4.4 APP 内 APK 下载进度查询（进度弹窗轮询） */
  queryLastApkDownload(): Promise<{ status?: string; bytesSoFar?: number; totalBytes?: number }>; 
  /** v2.0.0 消息读取组 */
  getRecentSMS(options?: { limit?: number }): Promise<{ ok?: boolean; items?: RecentSmsItem[]; reason?: string; connecting?: boolean }>;
  getRecentNotifications(options?: { limit?: number }): Promise<{ ok?: boolean; items?: RecentNotificationItem[]; reason?: string; connecting?: boolean }>;
  /** v2.0.0 原生信息组 */
  getBatteryStatus(): Promise<{ ok?: boolean; level?: number; charging?: boolean; reason?: string }>;
  getVolume(): Promise<{ ok?: boolean; volume?: number; max?: number; reason?: string }>;
  setVolume(options: { volume: number }): Promise<{ ok?: boolean; volume?: number; reason?: string }>;
  /** v2.0.0 权限中心组 */
  smsPermission(): Promise<RuntimePermResult>;
  requestSmsPermission(): Promise<RuntimePermResult>;
  contactsPermission(): Promise<RuntimePermResult>;
  requestContactsPermission(): Promise<RuntimePermResult>;
  calendarPermission(): Promise<RuntimePermResult>;
  requestCalendarPermission(): Promise<RuntimePermResult>;
  alarmPermission(): Promise<RuntimePermResult>;
  requestAlarmPermission(): Promise<{ ok?: boolean; reason?: string }>;
  mediaFilesPermission(): Promise<RuntimePermResult>;
  requestMediaFilesPermission(): Promise<RuntimePermResult>;
  openAppDetailSettings(): Promise<void>;
  /** 应用名解析 */
  getAppLabel(options?: { pkg?: string }): Promise<{ ok?: boolean; label?: string; reason?: string }>;
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
  /** v2.1.0 修改系统设置组（WRITE_SETTINGS：亮度/铃声） */
  writeSettingsPermission(): Promise<RuntimePermResult>;
  openWriteSettings(): Promise<void>;
  getBrightness(): Promise<{ ok?: boolean; percent?: number; auto?: boolean; reason?: string }>;
  setBrightness(options: { percent: number }): Promise<{ ok?: boolean; percent?: number; reason?: string }>;
  setRingerMode(options: { mode: string }): Promise<{ ok?: boolean; mode?: string; via?: string; reason?: string }>;
  /** v2.1.0 常驻守护（前台服务）+ 开机自启动组 */
  keepAliveStatus(): Promise<{ running?: boolean; enabled?: boolean; bootPerm?: boolean }>;
  keepAliveStart(): Promise<{ ok?: boolean; reason?: string }>;
  keepAliveStop(): Promise<{ ok?: boolean }>;
  bootAutoStartStatus(): Promise<RuntimePermResult & { enabled?: boolean }>;
  /** v2.3.0 原生系统级工具组 */
  setRealAlarm(options: { hour: number; minute: number; label?: string }): Promise<NativeAlarmResult>;
  startCountdown(options: { seconds: number; label?: string }): Promise<NativeAlarmResult>;
  createCalendarEvent(options: { title: string; beginTs?: number; endTs?: number; location?: string; allDay?: boolean }): Promise<NativeCalendarResult>;
  makePhoneCall(options: { phoneNumber: string }): Promise<NativeCallSmsResult>;
  sendSMS(options: { phoneNumber: string; message: string }): Promise<NativeCallSmsResult>;
  searchRealContact(options: { name: string }): Promise<NativeContactResult>;
  toggleFlashlight(options: { on: boolean }): Promise<{ ok?: boolean; on?: boolean; reason?: string }>;
  getRealLocation(): Promise<NativeLocationResult>;
  openSystemApp(options: { name: string }): Promise<NativeActionResult>;
  sendSmsPermission(): Promise<RuntimePermResult>;
  requestSendSmsPermission(): Promise<RuntimePermResult>;
  callPhonePermission(): Promise<RuntimePermResult>;
  requestCallPhonePermission(): Promise<RuntimePermResult>;
  /** v2.4.2 健康运动/文件/下载/设置/网络工具组 */
  getStepCount(): Promise<NativeStepResult>;
  getCurrentActivity(): Promise<NativeActivityResult>;
  getSleepData(): Promise<NativeSleepResult>;
  listFiles(options: { path?: string }): Promise<NativeFileListResult>;
  readFileContent(options: { path: string }): Promise<NativeFileReadResult>;
  saveTextToFile(options: { content: string; filename?: string }): Promise<NativeFileSaveResult>;
  downloadFile(options: { url: string; filename?: string }): Promise<NativeDownloadResult>;
  openSystemSetting(options: { settingName: string }): Promise<NativeActionResult>;
  getNetworkInfo(): Promise<NativeNetworkResult>;
  activityRecognitionPermission(): Promise<RuntimePermResult>;
  requestActivityRecognitionPermission(): Promise<RuntimePermResult>;
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
let mediaBridgeState: boolean | null = null; // null = 未探测

async function mediaBridgeAlive(): Promise<boolean> {
  if (mediaBridgeState !== null) return mediaBridgeState;
  const p = await nativePlugin();
  if (!p) {
    mediaBridgeState = false;
    return false;
  }
  try {
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
    controlMedia: (options) => nativeCall<{ ok?: boolean; action?: string; reason?: string }>('controlMedia', options ?? {}, 8000),
    getRealCalendarEvents: (options) => nativeCall<NativeRealCalendarResult>('getRealCalendarEvents', options ?? {}, 12_000),
    saveBase64Download: (options) => nativeCall<{ ok?: boolean; path?: string; bytes?: number; reason?: string }>('saveBase64Download', options ?? {}, 60_000),
    downloadAndInstallApk: (options) => nativeCall<{ ok?: boolean; downloading?: boolean; needPermission?: boolean; reason?: string }>('downloadAndInstallApk', options ?? {}, 15_000),
    requestScreenCapture: () => nativeCall<{ ok: boolean; canceled?: boolean }>('requestScreenCapture'),
    grabScreenFrame: () => nativeCall<{ ok: boolean; needSession?: boolean; frame?: string }>('grabScreenFrame'),
    stopScreenCapture: () => nativeCall<void>('stopScreenCapture'),
    // v2.0.0 无障碍组
    accessibilityPermission: () => nativeCall<A11yPermResult>('accessibilityPermission'),
    openAccessibilitySettings: () => nativeCall<void>('openAccessibilitySettings'),
    a11yScreenshot: () => nativeCall<A11yShotResult>('a11yScreenshot', {}, 16_000),
    a11yTap: (options) => nativeCall<NativeActionResult>('a11yTap', options ?? {}),
    a11ySwipe: (options) => nativeCall<NativeActionResult>('a11ySwipe', options ?? {}),
    a11yKey: (options) => nativeCall<NativeActionResult>('a11yKey', options ?? {}),
    a11yInput: (options) => nativeCall<NativeActionResult>('a11yInput', options ?? {}, 12_000),
    getScreenSize: () => nativeCall<{ ok?: boolean; width?: number; height?: number; reason?: string }>('getScreenSize'),
    getForegroundApp: () => nativeCall<ForegroundAppResult>('getForegroundApp'),
    // v2.0.0 拉起组
    bringToFront: () => nativeCall<NativeActionResult>('bringToFront'),
    openApp: (options) => nativeCall<NativeActionResult>('openApp', options ?? {}),
    listInstalledApps: (options) => nativeCall<{ ok?: boolean; apps?: { pkg: string; name: string }[] }>('listInstalledApps', options ?? {}, 15_000),
    // v2.0.0 锁定组
    lockApp: (options) => nativeCall<{ ok?: boolean; reason?: string }>('lockApp', options ?? {}, 10_000),
    unlockApp: () => nativeCall<{ ok?: boolean; reason?: string }>('unlockApp', {}, 10_000),
    jealousyGuardSyncLock: (options) => nativeCall<{ ok?: boolean; reason?: string }>('jealousyGuardSyncLock', options ?? {}, 10_000),
    updateLockMessage: (options) => nativeCall<{ ok?: boolean; reason?: string }>('updateLockMessage', options ?? {}, 8000),
    bridgeCapabilities: () => nativeCall<{ ok?: boolean; methods?: string[] }>('bridgeCapabilities', {}, 4000),
    queryLastApkDownload: () => nativeCall<{ status?: string; bytesSoFar?: number; totalBytes?: number }>('queryLastApkDownload', {}, 5000),
    jealousyGuardStatus: () => nativeCall<JealousyGuardStatusResult>('jealousyGuardStatus'),
    jealousyGuardDrainEvents: () => nativeCall<{ events?: JealousyGuardEvent[] }>('jealousyGuardDrainEvents'),
    // v2.0.0 消息读取组
    getRecentSMS: (options) => nativeCall<{ ok?: boolean; items?: RecentSmsItem[]; reason?: string }>('getRecentSMS', options ?? {}),
    getRecentNotifications: (options) => nativeCall<{ ok?: boolean; items?: RecentNotificationItem[]; reason?: string }>('getRecentNotifications', options ?? {}),
    // v2.0.0 原生信息组
    getBatteryStatus: () => nativeCall<{ ok?: boolean; level?: number; charging?: boolean; reason?: string }>('getBatteryStatus'),
    getVolume: () => nativeCall<{ ok?: boolean; volume?: number; max?: number; reason?: string }>('getVolume'),
    setVolume: (options) => nativeCall<{ ok?: boolean; volume?: number; reason?: string }>('setVolume', options ?? {}),
    // v2.0.0 权限中心组
    smsPermission: () => nativeCall<RuntimePermResult>('smsPermission'),
    requestSmsPermission: () => nativeCall<RuntimePermResult>('requestSmsPermission', {}, 60_000),
    contactsPermission: () => nativeCall<RuntimePermResult>('contactsPermission'),
    requestContactsPermission: () => nativeCall<RuntimePermResult>('requestContactsPermission', {}, 60_000),
    calendarPermission: () => nativeCall<RuntimePermResult>('calendarPermission'),
    requestCalendarPermission: () => nativeCall<RuntimePermResult>('requestCalendarPermission', {}, 60_000),
    alarmPermission: () => nativeCall<RuntimePermResult>('alarmPermission'),
    requestAlarmPermission: () => nativeCall<{ ok?: boolean; reason?: string }>('requestAlarmPermission'),
    mediaFilesPermission: () => nativeCall<RuntimePermResult>('mediaFilesPermission'),
    requestMediaFilesPermission: () => nativeCall<RuntimePermResult>('requestMediaFilesPermission', {}, 60_000),
    openAppDetailSettings: () => nativeCall<void>('openAppDetailSettings'),
    getAppLabel: (options) => nativeCall<{ ok?: boolean; label?: string; reason?: string }>('getAppLabel', options ?? {}, 8000),
    micPermission: () => nativeCall<RuntimePermResult>('micPermission'),
    requestMicPermission: () => nativeCall<RuntimePermResult>('requestMicPermission', {}, 60_000),
    notificationPermission: () => nativeCall<RuntimePermResult & { sdk?: number }>('notificationPermission'),
    requestNotificationPermission: () => nativeCall<RuntimePermResult>('requestNotificationPermission', {}, 60_000),
    overlayPermission: () => nativeCall<RuntimePermResult>('overlayPermission'),
    requestOverlayPermission: () => nativeCall<{ ok?: boolean; reason?: string }>('requestOverlayPermission'),
    batteryPermission: () => nativeCall<RuntimePermResult>('batteryPermission'),
    requestBatteryPermission: () => nativeCall<{ ok?: boolean; reason?: string }>('requestBatteryPermission'),
    locationPermission: () => nativeCall<RuntimePermResult & { fine?: boolean; coarse?: boolean }>('locationPermission'),
    requestLocationPermission: () => nativeCall<RuntimePermResult & { fine?: boolean; coarse?: boolean }>('requestLocationPermission', {}, 60_000),
    // v2.1.0 修改系统设置组（WRITE_SETTINGS：亮度/铃声）
    writeSettingsPermission: () => nativeCall<RuntimePermResult>('writeSettingsPermission'),
    openWriteSettings: () => nativeCall<void>('openWriteSettings'),
    getBrightness: () => nativeCall<{ ok?: boolean; percent?: number; auto?: boolean; reason?: string }>('getBrightness'),
    setBrightness: (options) => nativeCall<{ ok?: boolean; percent?: number; reason?: string }>('setBrightness', options ?? {}, 8000),
    setRingerMode: (options) => nativeCall<{ ok?: boolean; mode?: string; via?: string; reason?: string }>('setRingerMode', options ?? {}, 8000),
    // v2.1.0 常驻守护（前台服务）+ 开机自启组
    keepAliveStatus: () => nativeCall<{ running?: boolean; enabled?: boolean; bootPerm?: boolean }>('keepAliveStatus'),
    keepAliveStart: () => nativeCall<{ ok?: boolean; reason?: string }>('keepAliveStart', {}, 8000),
    keepAliveStop: () => nativeCall<{ ok?: boolean }>('keepAliveStop', {}, 8000),
    bootAutoStartStatus: () => nativeCall<RuntimePermResult & { enabled?: boolean }>('bootAutoStartStatus'),
    // v2.3.0 原生系统级工具组
    setRealAlarm: (options) => nativeCall<NativeAlarmResult>('setRealAlarm', options ?? {}, 8000),
    startCountdown: (options) => nativeCall<NativeAlarmResult>('startCountdown', options ?? {}, 8000),
    createCalendarEvent: (options) => nativeCall<NativeCalendarResult>('createCalendarEvent', options ?? {}, 12_000),
    makePhoneCall: (options) => nativeCall<NativeCallSmsResult>('makePhoneCall', options ?? {}, 8000),
    sendSMS: (options) => nativeCall<NativeCallSmsResult>('sendSMS', options ?? {}, 10_000),
    searchRealContact: (options) => nativeCall<NativeContactResult>('searchRealContact', options ?? {}, 10_000),
    toggleFlashlight: (options) => nativeCall<{ ok?: boolean; on?: boolean; reason?: string }>('toggleFlashlight', options ?? {}, 6000),
    getRealLocation: () => nativeCall<NativeLocationResult>('getRealLocation', {}, 15_000),
    openSystemApp: (options) => nativeCall<NativeActionResult>('openSystemApp', options ?? {}, 8000),
    sendSmsPermission: () => nativeCall<RuntimePermResult>('sendSmsPermission'),
    requestSendSmsPermission: () => nativeCall<RuntimePermResult>('requestSendSmsPermission', {}, 60_000),
    callPhonePermission: () => nativeCall<RuntimePermResult>('callPhonePermission'),
    requestCallPhonePermission: () => nativeCall<RuntimePermResult>('requestCallPhonePermission', {}, 60_000),
    // v2.4.2 健康运动/文件/下载/设置/网络工具组
    getStepCount: () => nativeCall<NativeStepResult>('getStepCount', {}, 8000),
    getCurrentActivity: () => nativeCall<NativeActivityResult>('getCurrentActivity', {}, 8000),
    getSleepData: () => nativeCall<NativeSleepResult>('getSleepData', {}, 10_000),
    listFiles: (options) => nativeCall<NativeFileListResult>('listFiles', options ?? {}, 10_000),
    readFileContent: (options) => nativeCall<NativeFileReadResult>('readFileContent', options ?? {}, 12_000),
    saveTextToFile: (options) => nativeCall<NativeFileSaveResult>('saveTextToFile', options ?? {}, 10_000),
    downloadFile: (options) => nativeCall<NativeDownloadResult>('downloadFile', options ?? {}, 10_000),
    openSystemSetting: (options) => nativeCall<NativeActionResult>('openSystemSetting', options ?? {}, 8000),
    getNetworkInfo: () => nativeCall<NativeNetworkResult>('getNetworkInfo', {}, 6000),
    activityRecognitionPermission: () => nativeCall<RuntimePermResult>('activityRecognitionPermission'),
    requestActivityRecognitionPermission: () => nativeCall<RuntimePermResult>('requestActivityRecognitionPermission', {}, 60_000),
  };
}

/** 同步判定：是否运行在原生壳里（androidBridge 由 WebView 注入，无需加载 SDK） */
export function isNativePerception(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as { androidBridge?: unknown }).androidBridge;
  return !!bridge && typeof (bridge as AndroidBridgeLike).postMessage === 'function';
}

// ---------------- 麦克风 / 通知运行时权限（含浏览器 Web 权限面回退） ----------------

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

/** 查询麦克风权限（原生壳读 Android 运行时权限；浏览器读 Web 权限面） */
export async function micPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) return p.micPermission();
  const s = await webPermState('microphone');
  if (s === 'granted') return { granted: true };
  if (s === 'denied') return { granted: false, canAsk: false };
  return { granted: false, canAsk: true };
}

/** 申请麦克风权限（原生壳弹系统授权框；浏览器经 getUserMedia 弹浏览器授权框） */
export async function requestMicPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (p) return p.requestMicPermission();
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return { granted: true };
  } catch (e) {
    const refused = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    if (refused) {
      const s = await webPermState('microphone');
      return { granted: false, canAsk: s !== 'denied' };
    }
    return { granted: false, canAsk: true };
  }
}

/** 查询系统通知权限真实状态（areNotificationsEnabled；非原生壳返回 null） */
export async function notificationPermission(): Promise<(RuntimePermResult & { sdk?: number }) | null> {
  const p = await nativePlugin();
  return p ? p.notificationPermission() : null;
}

/** 申请系统通知权限（Android 13+ 弹 POST_NOTIFICATIONS 系统框；非原生壳返回 null） */
export async function requestNotificationPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  return p ? p.requestNotificationPermission() : null;
}

// ---------------- v2.0.0 权限中心：无障碍 / 悬浮窗 / 电池 / 位置 / 短信 / 通讯录 / 日历 / 闹钟 / 媒体文件 ----------------
// 级联策略（原生方法短超时探测，旧 APK 对未知方法不回包 → 3s 判定足够）：
//  ① 新 APK（v2.0.0+ 原生方法）：nativeCall 直查/直跳系统授权页（毫秒级）；
//  ② 旧 APK / 浏览器 → null（设置页展示「需真机/升级 APP」）。

/** 原生方法短超时探测（旧 APK 对未知方法不回包，卡满超时才回落；3s 判定足够） */
async function nativeOrTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), ms))]);
}

/** 无障碍服务权限状态（原生壳真实状态；浏览器 null） */
export async function accessibilityPermission(): Promise<A11yPermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.accessibilityPermission());
  } catch {
    return null; // 旧 APK 无此方法
  }
}

/** 跳系统「无障碍」设置页（找到 Cove 开启服务，一次开启终身有效） */
export async function openNativeAccessibilitySettings(): Promise<boolean> {
  const p = await nativePlugin();
  if (!p) return false;
  try {
    await nativeOrTimeout(p.openAccessibilitySettings(), 5000);
    return true;
  } catch {
    return false;
  }
}

/** 悬浮窗权限状态（Settings.canDrawOverlays；浏览器 null） */
export async function overlayPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.overlayPermission());
  } catch {
    return null;
  }
}

/** 申请悬浮窗权限：跳系统「在其他应用上层显示」开关页（本 APP 条目深链直达） */
export async function requestOverlayPermission(): Promise<{ ok: boolean; via: 'native' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestOverlayPermission(), 5000);
      if (r?.ok) return { ok: true, via: 'native' };
    } catch {
      /* 旧 APK → 不可用 */
    }
  }
  return { ok: false, via: 'unavailable' };
}

/** 电池优化豁免状态（是否在 Doze 白名单里；浏览器 null） */
export async function batteryPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.batteryPermission());
  } catch {
    return null;
  }
}

/** 申请电池优化豁免：系统确认弹窗（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS） */
export async function requestBatteryPermission(): Promise<{ ok: boolean; via: 'native' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestBatteryPermission(), 5000);
      if (r?.ok) return { ok: true, via: 'native' };
    } catch {
      /* 旧 APK → 不可用 */
    }
  }
  return { ok: false, via: 'unavailable' };
}

/** 位置权限状态（精确/粗略任一授予即 granted；浏览器读 Web 权限面） */
export async function locationPermission(): Promise<(RuntimePermResult & { fine?: boolean; coarse?: boolean }) | null> {
  const p = await nativePlugin();
  if (p) {
    try {
      return await nativeOrTimeout(p.locationPermission());
    } catch {
      /* 旧 APK → 浏览器回退 */
    }
  }
  // 浏览器：Geolocation 授权状态
  if (!isNativePerception()) {
    const s = await webPermState('geolocation');
    if (s === 'granted') return { granted: true, fine: true, coarse: true };
    if (s === 'denied') return { granted: false, canAsk: false };
    return { granted: false, canAsk: true };
  }
  return null;
}

/** 申请位置权限（原生弹系统授权框；浏览器经 Geolocation 弹浏览器授权框） */
export async function requestLocationPermission(): Promise<{ ok: boolean; via: 'native' | 'web' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestLocationPermission(), 60_000);
      if (r?.granted) return { ok: true, via: 'native' };
      if (r && !r.granted && r.canAsk === false) return { ok: false, via: 'native' };
    } catch {
      /* 旧 APK → 浏览器回退 */
    }
  }
  if (!isNativePerception() && typeof navigator !== 'undefined' && navigator.geolocation) {
    const r = await new Promise<GeolocationPosition | number | null>((res) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => res(pos),
        (err) => res(err.code),
        { timeout: 8_000, maximumAge: 600_000 },
      );
    });
    return { ok: Boolean(r && typeof r !== 'number'), via: 'web' };
  }
  return { ok: false, via: 'unavailable' };
}

/** 短信权限状态（READ_SMS 运行时权限；浏览器 null） */
export async function smsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.smsPermission());
  } catch {
    return null;
  }
}

/** 申请短信权限（弹系统授权框；被持久拒绝时 canAsk=false 由设置页引导应用详情页） */
export async function requestSmsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestSmsPermission(), 62_000);
  } catch {
    return null;
  }
}

/** 通讯录读写权限状态 */
export async function contactsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.contactsPermission());
  } catch {
    return null;
  }
}

/** 申请通讯录权限（弹系统授权框） */
export async function requestContactsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestContactsPermission(), 62_000);
  } catch {
    return null;
  }
}

/** 日历读写权限状态 */
export async function calendarPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.calendarPermission());
  } catch {
    return null;
  }
}

/** 申请日历权限（弹系统授权框） */
export async function requestCalendarPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestCalendarPermission(), 62_000);
  } catch {
    return null;
  }
}

/** 闹钟与计时器权限状态（API 31+ canScheduleExactAlarms；31 以下恒 granted） */
export async function alarmPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.alarmPermission());
  } catch {
    return null;
  }
}

/** 申请闹钟权限（API 31+ 跳系统「闹钟和提醒」授权页） */
export async function requestAlarmPermission(): Promise<{ ok: boolean; via: 'native' | 'unavailable' }> {
  const p = await nativePlugin();
  if (p) {
    try {
      const r = await nativeOrTimeout(p.requestAlarmPermission(), 5000);
      if (r?.ok) return { ok: true, via: 'native' };
    } catch {
      /* 旧 APK → 不可用 */
    }
  }
  return { ok: false, via: 'unavailable' };
}

/** 文件读写与媒体访问权限状态（33+ 细分媒体权限组；≤32 旧存储权限） */
export async function mediaFilesPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.mediaFilesPermission());
  } catch {
    return null;
  }
}

/** 申请媒体文件权限（33+ 弹细分媒体权限框；≤32 弹旧存储权限框） */
export async function requestMediaFilesPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestMediaFilesPermission(), 62_000);
  } catch {
    return null;
  }
}

/** 跳本应用系统详情页（运行时权限被持久拒绝后的手动开启兜底） */
export async function openNativeAppDetailSettings(): Promise<boolean> {
  const p = await nativePlugin();
  if (!p) return false;
  try {
    await nativeOrTimeout(p.openAppDetailSettings(), 5000);
    return true;
  } catch {
    return false;
  }
}

// ---------------- v2.1.0 修改系统设置（WRITE_SETTINGS：亮度/铃声）/ 常驻守护 / 开机自启 ----------------

/** 修改系统设置权限状态（Settings.System.canWrite；浏览器 null） */
export async function writeSettingsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.writeSettingsPermission());
  } catch {
    return null;
  }
}

/** 跳系统「可修改系统设置」开关页（本 APP 条目深链直达） */
export async function openNativeWriteSettings(): Promise<boolean> {
  const p = await nativePlugin();
  if (!p) return false;
  try {
    await nativeOrTimeout(p.openWriteSettings(), 5000);
    return true;
  } catch {
    return false;
  }
}

/** 读当前屏幕亮度（percent 1-100 + auto 自动亮度；未授权 reason='no-write-settings'） */
export async function nativeGetBrightness(): Promise<{ ok?: boolean; percent?: number; auto?: boolean; reason?: string } | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.getBrightness(), 6000);
  } catch {
    return null;
  }
}

/** 调屏幕亮度（percent 1-100；原生先切手动亮度模式再写 SCREEN_BRIGHTNESS） */
export async function nativeSetBrightness(percent: number): Promise<{ ok?: boolean; percent?: number; reason?: string } | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.setBrightness({ percent }), 8000);
  } catch {
    return null;
  }
}

/** 设置铃声模式（silent/vibrate/normal；ringerMode 优先、静音降级零铃声量） */
export async function nativeSetRingerMode(mode: 'silent' | 'vibrate' | 'normal'): Promise<{ ok?: boolean; mode?: string; via?: string; reason?: string } | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.setRingerMode({ mode }), 8000);
  } catch {
    return null;
  }
}

// ---------------- v2.3.0 原生系统级工具组 ----------------

/** 定系统闹钟（AlarmClock.ACTION_SET_ALARM 标准协议，直接进系统时钟） */
export async function nativeSetRealAlarm(
  hour: number,
  minute: number,
  label?: string,
): Promise<{ ok: boolean; reason?: string; hour?: number; minute?: number }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeAlarmResult>('setRealAlarm', { hour, minute, label }, 8000);
    return { ok: r?.ok === true, reason: r?.reason, hour: r?.hour, minute: r?.minute };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 系统倒计时/计时器（AlarmClock.ACTION_SET_TIMER 标准协议） */
export async function nativeStartCountdown(
  seconds: number,
  label?: string,
): Promise<{ ok: boolean; reason?: string; seconds?: number }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeAlarmResult>('startCountdown', { seconds, label }, 8000);
    return { ok: r?.ok === true, reason: r?.reason, seconds: r?.seconds };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 写系统日历（CalendarContract 直写，失败降级日历应用预填） */
export async function nativeCreateCalendarEvent(opts: {
  title: string;
  beginTs?: number;
  endTs?: number;
  location?: string;
  allDay?: boolean;
}): Promise<{ ok: boolean; via?: string; calendar?: string; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  // v2.4.5 能力探测：新 APK 明确没有此方法时秒级回 old-apk（不再挂 12s 超时后报「桥无响应」）
  if ((await nativeMethodState('createCalendarEvent')) === 'no') return { ok: false, reason: 'old-apk' };
  try {
    const r = await nativeCall<NativeCalendarResult>('createCalendarEvent', opts, 12_000);
    return { ok: r?.ok === true, via: r?.via, calendar: r?.calendar, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

// ---------------- v2.4.3 媒体控制 / 真机日历读取 / APP 内下载 ----------------

/** 现在正在听什么歌（原生快照；needPermission=true 需引导开「通知使用权」） */
export async function nativeGetNowPlaying(): Promise<{
  ok: boolean;
  needPermission?: boolean;
  connecting?: boolean;
  reason?: 'old-apk';
  playing?: { app: string; pkg: string; title: string; artist: string; album: string; state: string } | null;
}> {
  if (!isNativePerception()) return { ok: false, playing: null };
  // v2.4.5 能力探测：旧 APK 没有此方法时秒级回 old-apk（不再挂 8s）
  if ((await nativeMethodState('getNowPlaying')) === 'no') return { ok: false, playing: null, reason: 'old-apk' } as { ok: boolean; playing: null };
  try {
    const r = await nativeCall<{
      ok?: boolean;
      needPermission?: boolean;
      connecting?: boolean;
      playing?: { app: string; pkg: string; title: string; artist: string; album: string; state: string } | null;
    }>('getNowPlaying', {}, 8000);
    return {
      ok: r?.ok === true,
      needPermission: r?.needPermission,
      connecting: r?.connecting,
      playing: r?.playing ?? null,
    };
  } catch {
    return { ok: false, playing: null, reason: '桥无响应' } as { ok: boolean; playing: null };
  }
}

/** 媒体传输控制（next/prev/play/pause/toggle——帮机主切歌/暂停/继续） */
export async function nativeControlMedia(
  action: 'next' | 'prev' | 'play' | 'pause' | 'toggle',
): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  // v2.4.5 能力探测：旧 APK 没有此方法时秒级回 old-apk
  if ((await nativeMethodState('controlMedia')) === 'no') return { ok: false, reason: 'old-apk' };
  try {
    const r = await nativeCall<{ ok?: boolean; reason?: string }>('controlMedia', { action }, 8000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 读真机系统日历某天日程（date="YYYY-MM-DD" 或空=今天；需 READ_CALENDAR） */
export async function nativeGetRealCalendarEvents(date?: string): Promise<NativeRealCalendarResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  // v2.4.5 能力探测：旧 APK 没有此方法时秒级回 old-apk
  if ((await nativeMethodState('getRealCalendarEvents')) === 'no') return { ok: false, reason: 'old-apk' };
  try {
    return await nativeCall<NativeRealCalendarResult>('getRealCalendarEvents', { date: date ?? '' }, 12_000);
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** APP 内保存 base64 到公共下载目录（Android WebView 里 blob 下载静默失败的根修）。
 *  v2.4.4 根修「导出一直正在导出」：旧 APK 没有此方法时 Capacitor 只记日志不回包，
 *  JS 会挂到 60s 超时——先经能力探测（秒级）确认方法存在才真调，不存在立即回退。 */
export async function nativeSaveBase64Download(filename: string, base64: string, mime = 'application/json'): Promise<{
  ok: boolean;
  path?: string;
  bytes?: number;
  reason?: string;
}> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  if (!(await nativeHasMethod('saveBase64Download'))) return { ok: false, reason: 'not-supported' };
  try {
    const r = await nativeCall<{ ok?: boolean; path?: string; bytes?: number; reason?: string }>(
      'saveBase64Download',
      { filename, base64, mime },
      60_000,
    );
    return { ok: r?.ok === true, path: r?.path, bytes: r?.bytes, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** APP 内下载 APK 并调起安装（未授「安装未知应用」时回 needPermission 并已跳授权页）。
 *  v2.4.4 同样先能力探测：旧 APK 无此方法时秒级回退（不再挂 15s）。 */
export async function nativeDownloadAndInstallApk(url: string): Promise<{
  ok: boolean;
  downloading?: boolean;
  needPermission?: boolean;
  dlId?: number;
  reason?: string;
}> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  if (!(await nativeHasMethod('downloadAndInstallApk'))) return { ok: false, reason: 'not-supported' };
  try {
    const r = await nativeCall<{ ok?: boolean; downloading?: boolean; needPermission?: boolean; dlId?: number; reason?: string }>(
      'downloadAndInstallApk',
      { url },
      15_000,
    );
    return { ok: r?.ok === true, downloading: r?.downloading, needPermission: r?.needPermission, dlId: r?.dlId, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

// ---------------- v2.4.4 桥能力探测（旧 APK 方法缺失秒级回退） ----------------

/** 能力探测结果缓存（会话级；旧 APK 探测超时 4s 后永不重试，后续全部秒回） */
let capMethodsPromise: Promise<Set<string>> | null = null;

/** 探测原生桥支持的方法集（非原生/旧 APK/超时 → 空集） */
function nativeBridgeMethods(): Promise<Set<string>> {
  if (capMethodsPromise) return capMethodsPromise;
  capMethodsPromise = (async () => {
    if (typeof window === 'undefined' || !isNativePerception()) return new Set<string>();
    try {
      const r = await nativeCall<{ ok?: boolean; methods?: string[] }>('bridgeCapabilities', {}, 4000);
      return new Set(Array.isArray(r?.methods) ? r.methods.filter((m): m is string => typeof m === 'string') : []);
    } catch {
      // 旧 APK 无此方法（挂到超时）或桥异常：一律视为无新方法
      return new Set<string>();
    }
  })();
  return capMethodsPromise;
}

/** 指定原生方法是否存在（能力探测；不存在时调用方秒级回退，不再长等超时） */
export async function nativeHasMethod(method: string): Promise<boolean> {
  try {
    return (await nativeBridgeMethods()).has(method);
  } catch {
    return false;
  }
}

/** v2.4.5 三态能力探测：'yes'=新 APK 确认有 / 'no'=新 APK 确认没有（秒级回退） /
 *  'unknown'=旧 APK 没有 bridgeCapabilities 通道（探测不出，调用方按原超时逻辑走）。
 *  区别于 nativeHasMethod 的布尔语义：旧 APK 上空集≠没有，不能误杀。 */
/** 三态探测结果缓存（yes/no 确定性结论缓存；unknown 不缓存，下次调用重探） */
const methodStateCache = new Map<string, 'yes' | 'no'>();

export async function nativeMethodState(method: string): Promise<'yes' | 'no' | 'unknown'> {
  if (typeof window === 'undefined' || !isNativePerception()) return 'unknown';
  const hit = methodStateCache.get(method);
  if (hit) return hit;
  try {
    const r = await nativeCall<{ ok?: boolean; methods?: string[] }>('bridgeCapabilities', {}, 4000);
    if (r?.ok === true && Array.isArray(r.methods)) {
      const st: 'yes' | 'no' = r.methods.includes(method) ? 'yes' : 'no';
      methodStateCache.set(method, st);
      return st;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 锁定期热更新拦截窗留言（AI 按人设/记忆/尝试次数改写；旧 APK 无此方法时静默失败不影响发消息） */
export async function nativeUpdateLockMessage(message: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<{ ok?: boolean; reason?: string }>('updateLockMessage', { message }, 8000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 查询 APP 内 APK 下载进度（进度弹窗轮询；旧 APK 无此方法 → status:'none'） */
export async function nativeQueryLastApkDownload(): Promise<{
  status: 'running' | 'succeeded' | 'failed' | 'none';
  bytesSoFar: number;
  totalBytes: number;
}> {
  if (!isNativePerception()) return { status: 'none', bytesSoFar: 0, totalBytes: 0 };
  if (!(await nativeHasMethod('queryLastApkDownload'))) {
    return { status: 'none', bytesSoFar: 0, totalBytes: 0 };
  }
  try {
    const r = await nativeCall<{ status?: string; bytesSoFar?: number; totalBytes?: number }>(
      'queryLastApkDownload',
      {},
      5000,
    );
    const st = r?.status === 'running' || r?.status === 'succeeded' || r?.status === 'failed' ? r.status : 'none';
    return {
      status: st,
      bytesSoFar: typeof r?.bytesSoFar === 'number' ? r.bytesSoFar : 0,
      totalBytes: typeof r?.totalBytes === 'number' ? r.totalBytes : 0,
    };
  } catch {
    return { status: 'none', bytesSoFar: 0, totalBytes: 0 };
  }
}

/** 拨打电话（有 CALL_PHONE 权限直接拨，否则拉拨号盘预填） */
export async function nativeMakePhoneCall(
  phoneNumber: string,
): Promise<{ ok: boolean; via?: string; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeCallSmsResult>('makePhoneCall', { phoneNumber }, 8000);
    return { ok: r?.ok === true, via: r?.via, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 发短信（有 SEND_SMS 权限 SmsManager 静默发，否则拉短信应用预填） */
export async function nativeSendSMS(
  phoneNumber: string,
  message: string,
): Promise<{ ok: boolean; via?: string; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeCallSmsResult>('sendSMS', { phoneNumber, message }, 10_000);
    return { ok: r?.ok === true, via: r?.via, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 查真机通讯录（按名字模糊匹配，需 READ_CONTACTS） */
export async function nativeSearchRealContact(
  name: string,
): Promise<{ ok: boolean; contacts?: RealContactItem[]; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeContactResult>('searchRealContact', { name }, 10_000);
    return { ok: r?.ok === true, contacts: r?.contacts ?? [], reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 手电筒开关（CameraManager.setTorchMode） */
export async function nativeToggleFlashlight(on: boolean): Promise<{ ok: boolean; on?: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<{ ok?: boolean; on?: boolean; reason?: string }>('toggleFlashlight', { on }, 6000);
    return { ok: r?.ok === true, on: r?.on, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 真实 GPS 定位（lastKnown + 8s 单次刷新；Geocoder 反解城市） */
export async function nativeGetRealLocation(): Promise<NativeLocationResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeLocationResult>('getRealLocation', {}, 15_000);
  } catch {
    return null;
  }
}

/** 系统应用直达（时钟/闹钟/日历/计算器…标准 Intent，不找包名） */
export async function nativeOpenSystemApp(name: string): Promise<{ ok: boolean; reason?: string; via?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeActionResult>('openSystemApp', { name }, 8000);
    return { ok: r?.ok === true, reason: r?.reason, via: r?.via };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 指定音量流设音量（media/alarm/ring/call；percentMode=0-100 百分比，原生按流实际最大档换算） */
export async function nativeSetVolumeStream(
  volume: number,
  stream: 'media' | 'alarm' | 'ring' | 'call',
): Promise<{ ok: boolean; volume?: number; max?: number; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<{ ok?: boolean; volume?: number; max?: number; reason?: string }>(
      'setVolume',
      { volume, stream, percentMode: true },
      6000,
    );
    return { ok: r?.ok === true, volume: r?.volume, max: r?.max, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 发送短信权限查询（权限中心；null=旧 APK 无此方法） */
export async function sendSmsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.sendSmsPermission());
  } catch {
    return null;
  }
}

/** 发送短信权限申请 */
export async function requestSendSmsPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestSendSmsPermission(), 60_000);
  } catch {
    return null;
  }
}

/** 拨打电话权限查询（权限中心；null=旧 APK 无此方法） */
export async function callPhonePermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.callPhonePermission());
  } catch {
    return null;
  }
}

/** 拨打电话权限申请 */
export async function requestCallPhonePermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestCallPhonePermission(), 60_000);
  } catch {
    return null;
  }
}

// ---------------- v2.4.2 健康运动 / 文件 / 下载 / 网络工具组 ----------------

/** 身体活动权限查询（ACTIVITY_RECOGNITION；29- 恒真；null=旧 APK） */
export async function activityRecognitionPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.activityRecognitionPermission());
  } catch {
    return null;
  }
}

/** 身体活动权限申请（系统运行时弹框） */
export async function requestActivityRecognitionPermission(): Promise<RuntimePermResult | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.requestActivityRecognitionPermission(), 60_000);
  } catch {
    return null;
  }
}

/** 今日步数（TYPE_STEP_COUNTER 硬件计步 + 今日零点基线折算） */
export async function nativeGetStepCount(): Promise<NativeStepResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeStepResult>('getStepCount', {}, 8000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 当前运动状态（加速度计：静止/步行/跑步/可能乘车/活动中） */
export async function nativeGetCurrentActivity(): Promise<NativeActivityResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeActivityResult>('getCurrentActivity', {}, 8000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 昨晚睡眠估算（UsageStats 亮屏间隔推算；需使用情况访问） */
export async function nativeGetSleepData(): Promise<NativeSleepResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeSleepResult>('getSleepData', {}, 10_000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 列公共目录文件（Download/DCIM/Pictures/Music/Movies/Documents） */
export async function nativeListFiles(path: string): Promise<NativeFileListResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeFileListResult>('listFiles', { path }, 10_000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 读文本文件内容（≤256KB；二进制拒读） */
export async function nativeReadFileContent(path: string): Promise<NativeFileReadResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeFileReadResult>('readFileContent', { path }, 12_000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 存文本文件到「Download/Cove/」 */
export async function nativeSaveTextToFile(content: string, filename?: string): Promise<NativeFileSaveResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeFileSaveResult>('saveTextToFile', { content, filename }, 10_000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 系统下载器（DownloadManager 下载到 Download/） */
export async function nativeDownloadFile(url: string, filename?: string): Promise<NativeDownloadResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeDownloadResult>('downloadFile', { url, filename }, 10_000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 打开系统设置页（wifi/蓝牙/应用管理/通知/电池…标准 Intent 直跳） */
export async function nativeOpenSystemSetting(
  settingName: string,
): Promise<NativeActionResult & { setting?: string; detail?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeActionResult & { setting?: string; detail?: string }>(
      'openSystemSetting',
      { settingName },
      8000,
    );
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 网络状态（Wi-Fi/移动网络/断网 + 信号强度） */
export async function nativeGetNetworkInfo(): Promise<NativeNetworkResult> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeCall<NativeNetworkResult>('getNetworkInfo', {}, 6000);
    return r ?? { ok: false, reason: '桥无响应' };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 常驻守护状态（running 服务存活 / enabled 开机自启开关 / bootPerm 自启权限） */
export async function keepAliveStatus(): Promise<{ running?: boolean; enabled?: boolean; bootPerm?: boolean } | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.keepAliveStatus());
  } catch {
    return null;
  }
}

/** 开启常驻守护（前台服务「Cove 正在守候」+ 记开机自启开关） */
export async function keepAliveStart(): Promise<{ ok: boolean; reason?: string }> {
  const p = await nativePlugin();
  if (!p) return { ok: false, reason: 'not-native' };
  try {
    const r = await nativeOrTimeout(p.keepAliveStart(), 8000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 关闭常驻守护（停服务 + 清自启开关，BootReceiver 不再自启） */
export async function keepAliveStop(): Promise<{ ok: boolean }> {
  const p = await nativePlugin();
  if (!p) return { ok: false };
  try {
    const r = await nativeOrTimeout(p.keepAliveStop(), 8000);
    return { ok: r?.ok !== false };
  } catch {
    return { ok: false };
  }
}

/** 开机自启动状态（granted=RECEIVE_BOOT_COMPLETED 已授予；enabled=守护开关开着开机才会拉起） */
export async function bootAutoStartStatus(): Promise<{ granted?: boolean; enabled?: boolean } | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    return await nativeOrTimeout(p.bootAutoStartStatus());
  } catch {
    return null;
  }
}

// ---------------- v2.0.0 无障碍能力组 ----------------

/**
 * 无障碍静默截屏（API 30+）：AiAccessibilityService.takeScreenshot，免授权弹窗。
 * 返回 dataURL；非原生/未开无障碍/失败 → {ok:false, reason}。
 */
export async function nativeA11yScreenshot(): Promise<A11yShotResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<A11yShotResult>('a11yScreenshot', {}, 16_000);
  } catch {
    return null;
  }
}

/** 无障碍模拟点击（绝对像素坐标） */
export async function nativeA11yTap(x: number, y: number): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('a11yTap', { x: Math.round(x), y: Math.round(y) });
  } catch {
    return null;
  }
}

/** 无障碍模拟滑动（绝对像素坐标 + 时长 ms） */
export async function nativeA11ySwipe(x1: number, y1: number, x2: number, y2: number, duration?: number): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('a11ySwipe', {
      x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), duration,
    });
  } catch {
    return null;
  }
}

/** 无障碍全局按键（back/home/recents/notifications/lock） */
export async function nativeA11yKey(key: string): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('a11yKey', { key });
  } catch {
    return null;
  }
}

/** 无障碍文本注入（向当前焦点输入框整体 SET_TEXT；无需切输入法） */
export async function nativeA11yInput(text: string): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('a11yInput', { text }, 12_000);
  } catch {
    return null;
  }
}

/** 屏幕像素尺寸（滑动坐标换算用） */
export async function nativeGetScreenSize(): Promise<{ ok?: boolean; width?: number; height?: number; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; width?: number; height?: number; reason?: string }>('getScreenSize', {}, 8000);
  } catch {
    return null;
  }
}

/**
 * 当前前台应用（无障碍事件流优先（实时）；未开无障碍 → UsageStats 近 20s 兜底）。
 * 非原生环境返回 null。
 */
export async function nativeGetForegroundApp(): Promise<ForegroundAppResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<ForegroundAppResult>('getForegroundApp', {}, 8000);
  } catch {
    return null;
  }
}

// ---------------- v2.0.0 拉起组 ----------------

/** 把本 App 强行拉到前台（吃醋拉回/切回聊天；FLAG_ACTIVITY_NEW_TASK） */
export async function nativeBringToFront(): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('bringToFront', {}, 8000);
  } catch {
    return null;
  }
}

/** 打开任意应用（包名 → LaunchIntent；未安装 not-found） */
export async function nativeOpenApp(pkg: string): Promise<NativeActionResult | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<NativeActionResult>('openApp', { pkg }, 8000);
  } catch {
    return null;
  }
}

/** 已安装第三方应用清单（pkg+中文名；搜索/锁定名单解析用） */
export async function nativeListInstalledApps(): Promise<{ pkg: string; name: string }[] | null> {
  if (!isNativePerception()) return null;
  try {
    const r = await nativeCall<{ ok?: boolean; apps?: { pkg: string; name: string }[] }>('listInstalledApps', {}, 15_000);
    return Array.isArray(r?.apps) ? r.apps : null;
  } catch {
    return null;
  }
}

// ---------------- v2.0.0 消息读取组 ----------------

/** 最近短信（需 READ_SMS；收件箱新→旧） */
export async function nativeGetRecentSMS(limit = 20): Promise<RecentSmsItem[] | { error: string } | null> {
  if (!isNativePerception()) return null;
  try {
    const r = await nativeCall<{ ok?: boolean; items?: RecentSmsItem[]; reason?: string }>('getRecentSMS', { limit }, 10_000);
    if (r?.ok) return r.items ?? [];
    return { error: r?.reason ?? 'failed' };
  } catch {
    return null;
  }
}

/** 最近通知（需「通知使用权」；通知环形缓冲） */
export async function nativeGetRecentNotifications(
  limit = 20,
): Promise<RecentNotificationItem[] | { error: string } | { connecting: true } | null> {
  if (!isNativePerception()) return null;
  try {
    const r = await nativeCall<{
      ok?: boolean;
      items?: RecentNotificationItem[];
      reason?: string;
      connecting?: boolean;
    }>('getRecentNotifications', { limit }, 10_000);
    if (r?.ok) {
      // v2.4.5 服务还在重连（刚授权/刚重启）：透传 connecting，不再伪装成「没有可见通知」
      if (r.connecting) return { connecting: true };
      return r.items ?? [];
    }
    return { error: r?.reason ?? 'failed' };
  } catch {
    return null;
  }
}

// ---------------- v2.0.0 原生信息组 ----------------

/** 电量状态（BatteryManager；level 0-100） */
export async function nativeGetBatteryStatus(): Promise<{ ok?: boolean; level?: number; charging?: boolean; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; level?: number; charging?: boolean; reason?: string }>('getBatteryStatus', {}, 6000);
  } catch {
    return null;
  }
}

/** 媒体音量（AudioManager STREAM_MUSIC） */
export async function nativeGetVolume(): Promise<{ ok?: boolean; volume?: number; max?: number; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; volume?: number; max?: number; reason?: string }>('getVolume', {}, 6000);
  } catch {
    return null;
  }
}

/** 设置媒体音量（0~max 自动钳制） */
export async function nativeSetVolume(volume: number): Promise<{ ok?: boolean; volume?: number; reason?: string } | null> {
  if (!isNativePerception()) return null;
  try {
    return await nativeCall<{ ok?: boolean; volume?: number; reason?: string }>('setVolume', { volume }, 6000);
  } catch {
    return null;
  }
}

/**
 * 弹一条 Android 系统通知栏通知（localNotify 原生通道）：
 * 非原生壳 → null；旧壳无该方法 → false。
 */
export async function localNotify(opts: {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
  target?: unknown;
  /** 横幅优先级（默认 true：IMPORTANCE_HIGH 渠道弹横幅+响铃+震动；false 退回静默渠道） */
  headsUp?: boolean;
}): Promise<boolean | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    await nativeCall('localNotify', { title: opts.title, body: opts.body, tag: opts.tag, url: opts.url, target: opts.target, headsUp: opts.headsUp ?? true }, 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * v2.2.0 按前缀批量撤销已弹的系统通知（localNotifyCancelByTagPrefix 原生通道）：
 * 进聊天界面后清掉所有未读的聊天消息通知（等价 LocalNotifications.removeAll，
 * 但只清本 App 发的带 tag 通知——常驻守护通知不受影响）。非原生壳静默 no-op。
 */
export async function localNotifyCancelByTagPrefix(prefix: string): Promise<void> {
  if (!isNativePerception() || !prefix) return;
  try {
    await nativeCall('localNotifyCancelByTagPrefix', { prefix }, 4000);
  } catch {
    // 旧壳无该方法/桥异常：静默（通知本身点开也会 autoCancel）
  }
}

/** 原生感知插件：优先官方注入的代理（同源页面），否则自建协议直连（跨域页面） */
async function nativePlugin(): Promise<CapPlugin | null> {
  if (!isNativePerception()) return null;
  const cap = await loadCapacitor();
  const plugin = cap?.Plugins?.['NativePerception'];
  if (plugin) return plugin;
  if (ensureBridgeHook()) return bridgePlugin();
  return null;
}

// ---------------- 时长数据源（v2.0.0 仅原生引擎；键保留兼容旧值） ----------------

const ENGINE_KEY = 'aiphone-usage-engine-v1';

/** 兼容读取：旧 'shizuku' 值一律按 'standard' 处理（原生 UsageStats 引擎） */
export function getUsageEngine(): 'standard' {
  return 'standard';
}

/** 兼容写入：v2.0.0 起恒为 standard（保留函数签名防调用方报错） */
export function setUsageEngine(_engine: 'standard'): void {
  try {
    window.localStorage.setItem(ENGINE_KEY, 'standard');
  } catch {
    /* 忽略 */
  }
}

// ---------------- Cap-go 引擎（标准模式 · 事件级 JS 聚合） ----------------

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
    capgoState = false;
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

  type Ev = { ts: number; type: number; pkg: string | null };
  type RawEv = { packageName?: string; timeStamp?: number; eventType?: number };
  const evs: Ev[] = (evRes?.events ?? [])
    .filter((e): e is RawEv & { timeStamp: number } => {
      if (typeof e.timeStamp !== 'number') return false;
      const t = e.eventType;
      if (t === 1 || t === 2 || t === 23) return true;
      if (t === 15 || t === 16 || t === 17 || t === 18 || t === 26 || t === 27) return true;
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
  let autoResumePkg: string | null = null;
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
    if (ev.ts > now + 60_000) continue;
    if (ev.type === 1) {
      autoResumePkg = null;
      if (openApp && ev.ts > openStart) {
        const dur = settle(openApp, openStart, ev.ts);
        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
        lastClosedPkg = openApp;
        lastClosedTs = ev.ts;
      }
      if (ev.pkg == null || isLauncher(ev.pkg)) {
        openApp = null;
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
      keyguardArmed = false;
      autoResume(ev.ts);
    } else if (ev.type === 4) {
      if (!keyguardArmed) autoResume(ev.ts);
    } else {
      openApp = null;
      autoResumePkg = null;
      keyguardArmed = false;
    }
  }

  const sortedApps = [...durationByApp.entries()].sort((a, b) => b[1] - a[1]);
  const totalMs = sortedApps.reduce((s, [, ms]) => s + ms, 0);

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

// ---------------- 应用中文名解析 ----------------

/** 应用名缓存（pkg → 中文名；命中后零桥开销） */
const appLabelCache = new Map<string, string>();

/**
 * 原生 PackageManager 取应用中文名（com.android.notes → 备忘录）。
 * 返回中文名；非原生环境 / 未安装 / 解析失败 / 旧 APK 无此方法（超时）→ null。
 */
export async function nativeGetAppLabel(pkg: string): Promise<string | null> {
  const p = (pkg ?? '').trim();
  if (!p) return null;
  const hit = appLabelCache.get(p);
  if (hit) return hit;
  if (!isNativePerception()) return null;
  try {
    const r = await Promise.race([
      nativeCall<{ ok?: boolean; label?: string }>('getAppLabel', { pkg: p }, 6000),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('label-timeout')), 6500)),
    ]);
    if (r && r.ok === true && typeof r.label === 'string' && r.label.trim()) {
      appLabelCache.set(p, r.label.trim());
      return r.label.trim();
    }
  } catch {
    /* 旧 APK 无此方法 → 超时兜底 null */
  }
  return null;
}

// ---------------- 应用锁定遮罩服务（v2.0.0：LockOverlayService） ----------------
// 原生 LockOverlayService（specialUse 前台服务）独立于 WebView 存活：
// - UsageStats 3s 轮询前台应用，检测到锁定名单应用 → SYSTEM_ALERT_WINDOW 全屏遮罩拦截；
// - 锁到期自动解锁（WebView 被杀/冻结也到点解锁）；
// - lock-shown / lock-attempt 事件落盘（用户想开锁定 App 的每次尝试），AI 醒来取走。
// 事件经 jealousyGuardDrainEvents 取走（取后即清）；旧 APK（无此三方法）超时探测 → false。

/** 原生守护事件（WebView 醒来后 drain 进吃醋决策链） */
export interface JealousyGuardEvent {
  /** 事件时间戳（epoch ms） */
  ts: number;
  /**
   * 事件类型：
   * - 'native-unlock'：锁到期由原生服务解开
   * - 'lock-shown'：用户打开了锁定名单应用，全屏遮罩已弹出（AI 可据此发消息质问）
   * - 'lock-attempt'：遮罩期间用户仍停留/反复想打开锁定应用
   * - 'force-unlock'：v2.2.5 用户在拦截窗点了【强制解锁】（没哄、直接强解——AI 立刻知道）
   * - 'breach'：旧协议兼容（锁被强行打破）
   * - 'degrade'：原生守护遇到容错降级（权限丢失等）
   */
  type: 'native-unlock' | 'lock-shown' | 'lock-attempt' | 'force-unlock' | 'breach' | 'degrade';
  /** 涉事应用包名 */
  pkg: string;
  /** 人话说明（进 AI 决策与通知链路） */
  text: string;
}

/** 原生守护服务状态 */
export interface JealousyGuardStatusResult {
  /** 守护服务是否在运行 */
  running: boolean;
  /** 正在守护（锁定）的应用包名（null=无锁） */
  pkg?: string | null;
  /** 锁定到期时间（epoch ms；-1=无锁） */
  unlockAt?: number;
  /** 未取走的事件条数 */
  eventCount?: number;
  /** 全屏遮罩当前是否盖着（用户正停留在锁定应用上） */
  overlayShown?: boolean;
  /** 「使用情况访问」权限实时状态 */
  usageAccess?: boolean;
  /** 悬浮窗权限实时状态 */
  overlayPerm?: boolean;
}

let guardBridgeState: boolean | null = null; // null=未探测；false=旧 APK

/** 守护桥能力探测（新 APK 立即响应；旧 APK 对未知方法不回包 → 超时即 false） */
export async function nativeJealousyGuardSupported(): Promise<boolean> {
  if (!isNativePerception()) return false;
  if (guardBridgeState !== null) return guardBridgeState;
  try {
    const r = await Promise.race([
      nativeCall<JealousyGuardStatusResult>('jealousyGuardStatus', {}, 2500),
      new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error('probe-timeout')), 2600)),
    ]);
    guardBridgeState = typeof r?.running === 'boolean';
  } catch {
    guardBridgeState = false;
  }
  return guardBridgeState;
}

/**
 * 锁定应用（v2.0.0 lockApp：无障碍实时钩子 + UsageStats 兑底 → 检测到立即回桌面 +
 * 全屏拦截窗，无需 Shizuku）：
 * - pkg + unlockAt（0=直到哄好）+ charName + message（拦截窗上的 AI 质问文案）；
 * - v2.2.0 新增 contactId/app：拦截窗【去哄哄 TA】按钮拉起本 App 后直达对应聊天；
 * - 不传 pkg → 解锁（停拦截窗停守护）。
 * 返回 ok（false=旧 APK/桥断/无悬浮窗权限等，reason 给人话）。
 */
export async function nativeLockApp(opts: {
  pkg?: string;
  unlockAt?: number;
  charName?: string;
  message?: string;
  contactId?: string;
  app?: string;
  avatar?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  if (!(await nativeJealousyGuardSupported())) return { ok: false, reason: 'old-apk' };
  try {
    const r = await nativeCall<{ ok?: boolean; reason?: string }>('lockApp', opts, 10_000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 解锁应用（停遮罩停守护；哄好/手动解锁共用） */
export async function nativeUnlockApp(): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  if (!(await nativeJealousyGuardSupported())) return { ok: false, reason: 'old-apk' };
  try {
    const r = await nativeCall<{ ok?: boolean; reason?: string }>('unlockApp', {}, 10_000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/**
 * 同步锁状态给原生守护服务（jealousy-lock 锁定/解锁/更新时调用；与 lockApp 同内核，
 * 方法名保留：旧调用方零改动兼容）。v2.2.0 新增 contactId/app 透传（去哄哄直达聊天）。
 */
export async function nativeJealousyGuardSyncLock(opts: {
  pkg?: string;
  unlockAt?: number;
  charName?: string;
  message?: string;
  contactId?: string;
  app?: string;
  avatar?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isNativePerception()) return { ok: false, reason: 'not-native' };
  if (!(await nativeJealousyGuardSupported())) return { ok: false, reason: 'old-apk' };
  try {
    const r = await nativeCall<{ ok?: boolean; reason?: string }>('jealousyGuardSyncLock', opts, 10_000);
    return { ok: r?.ok === true, reason: r?.reason };
  } catch {
    return { ok: false, reason: '桥无响应' };
  }
}

/** 查询守护服务运行状态（null=旧 APK/非原生环境） */
export async function nativeJealousyGuardStatus(): Promise<JealousyGuardStatusResult | null> {
  if (!isNativePerception()) return null;
  if (!(await nativeJealousyGuardSupported())) return null;
  try {
    return await nativeCall<JealousyGuardStatusResult>('jealousyGuardStatus', {}, 5000);
  } catch {
    return null;
  }
}

/** 取走守护服务积累的全部事件（取后即清；null=旧 APK/非原生环境） */
export async function nativeJealousyGuardDrainEvents(): Promise<JealousyGuardEvent[] | null> {
  if (!isNativePerception()) return null;
  if (!(await nativeJealousyGuardSupported())) return null;
  try {
    const r = await nativeCall<{ events?: JealousyGuardEvent[] }>('jealousyGuardDrainEvents', {}, 5000);
    return Array.isArray(r?.events) ? r.events : [];
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

/** 原生「通知使用权」状态（读歌名/歌手/最近通知需要；null = 非原生环境或旧版 APP） */
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

/** 跳系统设置「通知使用权」（找到 Cove 开启，一次授权终身有效） */
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

/** 原生快照 → AwSnapshot（下游感知块/设置页零改动兼容） */
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
    unlocks: undefined,
    media: undefined,
    web: undefined,
    engine: 'native',
  } satisfies AwSnapshot;
}

/** 原生 UsageStats 快照 → AwSnapshot（Cap-go 优先，内置原生兜底；媒体会话附带） */
export async function nativeUsageSnapshot(): Promise<AwSnapshot | null> {
  const p = await nativePlugin();
  if (!p) return null;
  // Cap-go 引擎优先（新 APK；事件级聚合口径与原生一致）
  if (await capgoBridgeAlive()) {
    try {
      const snap = await capgoUsageSnapshot();
      if (snap) return { ...snap, engine: 'capgo' } satisfies AwSnapshot;
    } catch {
      /* 回落内置原生 */
    }
  }
  // 内置原生引擎（UsageStatsManager 事件流配对聚合）
  try {
    const r = await p.getUsageSnapshot({});
    if (!r || !r.ok) return null;
    const snap = mapNativeSnapshot(r);
    snap.media = await attachMedia();
    return snap;
  } catch {
    return null;
  }
}

// ---------------- 屏幕抓帧（MediaProjection 备选通道） ----------------

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

// ---------------- v2.0.0 Agent 底座（急停 / 常驻通知；与 Shizuku 无关，保留） ----------------
// 全部防御模式：非原生环境/null、调用异常/null —— 调用方拿到 null 就按「桥无响应」处理，
// 绝不打断 Agent 主循环。

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
