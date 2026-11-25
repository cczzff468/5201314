'use client';

/**
 * Android WebView 渲染降级判定（第三十四轮）。
 *
 * 背景（机主真机反馈）：切换「毛玻璃/液态透明」图标样式后打开多任务切换器，
 * 出现 ①切换器背景整块纯黑（应为毛玻璃壁纸）②卡片里 App 内容全灰块无文字
 * （机主截图逐像素比对确认）。根因是 Android WebView（旧 Chromium）对
 * backdrop-filter 的光栅化缺陷：切换器 46px 超大 backdrop-filter 的采样源
 * （主屏）在毛玻璃/液态模式下含 24 枚各带 backdrop-blur 的图标（backdrop root
 * 嵌套 + 合成层数量激增），超出 WebView 的 GPU 光栅预算 → 整帧所有
 * backdrop-filter 元素塌缩成不透明灰/黑块（盖住文字与内容）。
 *
 * 修法：APK/WebView 环境下切换器背景改「静态缩图模糊」（无 backdrop-filter），
 * 玻璃质感用小尺寸图层 + transform 放大 + 轻模糊实现（光栅成本趋近于零，
 * 且不采样任何 backdrop，从根本上免疫该缺陷）。浏览器端（桌面 Chrome 等）
 * 不受影响，保留原 backdrop-filter 实时毛玻璃。
 *
 * 判定（任一命中即 WebView）：
 * ① window.androidBridge / AIPhoneNative / Capacitor（原生壳注入的桥）；
 * ② html[data-app-native]（layout 内联脚本在 APK 内同步标记）；
 * ③ UA 含 "wv)"（Android WebView 标准标记）。
 */

import { useSyncExternalStore } from 'react';

let cached: boolean | null = null;
const listeners = new Set<() => void>();
let started = false;

function compute(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const w = window as unknown as {
      androidBridge?: unknown;
      AIPhoneNative?: unknown;
      Capacitor?: unknown;
    };
    if (w.androidBridge || w.AIPhoneNative || w.Capacitor) return true;
    if (document.documentElement.hasAttribute('data-app-native')) return true;
    if (/wv\)/i.test(navigator.userAgent)) return true;
  } catch {
    /* 异常环境按浏览器处理（保留 backdrop-filter 路径） */
  }
  return false;
}

function ensureStarted(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  cached = compute();
  // data-app-native 由 layout 内联脚本同步注入（正常首帧前）；但桥/标记晚到的
  // 场景（注入时序慢/热重载）用 MutationObserver 监听 html 属性变化重判——
  // 值翻转时广播重渲染，值不变零通知
  const recompute = () => {
    const v = compute();
    if (v !== cached) {
      cached = v;
      listeners.forEach((l) => l());
    }
  };
  requestAnimationFrame(recompute);
  try {
    const mo = new MutationObserver(recompute);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-app-native', 'data-shell-fullscreen'] });
  } catch {
    /* 无 MO 环境静默（rAF 复核已兜底） */
  }
}

/** 同步判定（组件外/一次性场景）：Android WebView → true */
export function isAndroidWebView(): boolean {
  if (cached !== null) return cached;
  return compute();
}

function subscribe(cb: () => void): () => void {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return cached ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * React hook：Android WebView 判定（SSR/水合首帧恒 false —— 与服务端快照一致，
 * 无 hydration mismatch；水合后如为 WebView 则翻转并重渲染）。
 */
export function useAndroidWebView(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
