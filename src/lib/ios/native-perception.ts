'use client';

/**
 * 原生感知桥（APP 壳内自动激活，浏览器里全部静默降级）：
 *
 * 运行环境判定：Capacitor 壳（android-shell/ 编译出的 APK）里的 WebView 通过
 * addJavascriptInterface 全局注入 window.androidBridge —— 网页只要引了
 * @capacitor/core，Capacitor.isNativePlatform() 即为 true（跨域页面不受影响），
 * 浏览器/桌面里恒为 false，走原有 ActivityWatch / 屏幕分享逻辑。
 *
 * 能力（对应 NativePerceptionPlugin.java）：
 * - UsageStats 真机感知：getUsageSnapshot（免装 ActivityWatch，替代其 502 链路）；
 * - 屏幕抓帧：requestScreenCapture（MediaProjection 授权，每会话一次）+
 *   grabScreenFrame（抓一帧 dataURL 喂 VLM，替代手机端不可用的 getDisplayMedia）。
 *
 * @capacitor/core 动态 import：浏览器首屏不打包，仅原生环境按需加载。
 */

import type { AwSnapshot } from './activitywatch';

type CapPlugin = {
  hasUsagePermission(): Promise<{ granted: boolean }>;
  openUsagePermissionSettings(): Promise<void>;
  getUsageSnapshot(): Promise<{
    ok: boolean;
    needPermission?: boolean;
    current?: { app: string; name: string; ongoingMs: number };
    todayApps?: { app: string; name: string; ms: number }[];
    todayTotalMs?: number;
    switchCount?: number;
    history?: { hhmm: string; app: string; name: string }[];
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

/** 同步判定：是否运行在原生壳里（androidBridge 由 WebView 注入，无需加载 SDK） */
export function isNativePerception(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as { androidBridge?: unknown }).androidBridge;
}

/** 原生感知插件（原生环境才有；拿不到返回 null） */
async function nativePlugin(): Promise<CapPlugin | null> {
  if (!isNativePerception()) return null;
  const cap = await loadCapacitor();
  if (!cap || !cap.isNativePlatform()) return null;
  const plugin = cap.Plugins?.['NativePerception'];
  return plugin ?? null;
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

/** 原生 UsageStats 快照 → AwSnapshot 形状（下游感知块/设置页零改动兼容） */
export async function nativeUsageSnapshot(): Promise<AwSnapshot | null> {
  const p = await nativePlugin();
  if (!p) return null;
  try {
    const r = await p.getUsageSnapshot();
    if (!r || !r.ok) return null;
    const now = Date.now();
    return {
      fetchedAt: now,
      current: r.current
        ? { app: r.current.name || r.current.app, ongoingMs: r.current.ongoingMs, at: now - (r.current.ongoingMs || 0) }
        : undefined,
      todayApps: (r.todayApps ?? []).map((x) => ({ app: x.name || x.app, ms: x.ms })),
      todayTotalMs: r.todayTotalMs ?? 0,
      switchCount: r.switchCount ?? 0,
      history: (r.history ?? []).map((x) => ({ hhmm: x.hhmm, app: x.name || x.app })),
      // UsageStats 拿不到解锁/媒体/网页事件：省略（AwSnapshot 全字段可选）
      unlocks: undefined,
      media: undefined,
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
    return r?.canceled ? 'canceled' : 'canceled';
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
