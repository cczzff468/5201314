'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettings, useSystemDark, useUI } from '@/lib/ios/store';
import {
  popStatusBarTone,
  pushStatusBarTone,
  type StatusBarTone,
} from '@/lib/ios/status-bar-tone';

/**
 * 状态栏自动基调探针（Task 100-f）：
 * 用户要求「App 内所有界面（不只音乐）状态栏前景实时跟随实际背景明暗——深底白字、浅底黑字」。
 * 音乐 App 已自管基调（按页面 push/pop），其余 App 没有页面级声明，靠静态表/主题兜底覆盖不到
 * App 内部界面差异（如天气管理页白底、聊天进入深色会话等）。
 *
 * 本组件渲染一个 hidden 占位 div（纯逻辑、零 UI），挂在 AppWindow 容器内 <App/> 之后；
 * 用 parentElement 拿到 App 容器，周期性对「状态栏身后那一行像素」做命中采样：
 * - 状态栏中线 y=+27px，左右 x=18% / 82% 两个采样点（避开顶部中央灵动岛/时间文字；
 *   全局状态栏层是 pointer-events-none，elementFromPoint 天然穿透）；
 * - 命中元素必须被容器包含，否则本轮弃用该点（防采样到灵动岛通知/来电层等全局浮层）；
 * - 从命中元素向上走祖先按标准 alpha compositing 合成有效背景色（半透明层逐层叠加），
 *   走出链路仍未不透明由容器 bg-background 兜底（跟随主题、恒不透明）；
 *   backgroundColor 透明且带 background-image 渐变时取渐变第一个颜色停靠点
 *   （天气全屏蓝天是 backgroundImage 实现，180deg 渐变首端即状态栏区域色）；
 * - 相对亮度（sRGB 线性化）L < 0.5 → 背景深 → tone='light'（白前景），否则 'dark'；
 *   两点各算一个亮度，取更接近中间值 0.5 的那点裁决（越临界越由它定对比最稳）。
 *
 * 基调经 pushStatusBarTone/popStatusBarTone 走既有屏幕级基调栈（foreground.ts 的
 * toneOverride 通道，仅 !locked 时生效），只在基调变化时推/弹（栈内 emit 不风暴）；
 * 暂停条件（锁屏 / 多任务切换器 / 无前台 App / 容器不可见）时弹栈回落壁纸逻辑，
 * 恢复后自动重新采样。weather/camera 的静态声明保留作首帧兜底（探针给出一致值）。
 */

/** 采样周期：App 内页面切换最迟半秒跟上（实时性主要由依赖变化立即采样兜住） */
const SAMPLE_INTERVAL_MS = 500;
/** 状态栏中线（状态栏高 54px 的一半）：采样「状态栏身后」那一行 */
const BAR_MIDLINE_Y = 27;
/** 左右采样点 x 比例：避开顶部中央灵动岛/时间文字 */
const SAMPLE_X_RATIOS = [0.18, 0.82] as const;

type Rgba = { r: number; g: number; b: number; a: number };

/** 主题变量是 oklch（getComputedStyle 原样返回 oklch(1 0 0)），手写解析器覆盖不全，
 *  用 1×1 离屏画布让浏览器把任意 CSS 颜色（rgb/rgba/hex/oklch/color()…）规范化成 sRGB 字节 */
let colorCtx: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, Rgba | null>();

function parseCssColor(raw: string): Rgba | null {
  const v = raw.trim();
  if (!v || v === 'none' || v === 'transparent') return null;
  const cached = colorCache.get(v);
  if (cached !== undefined) return cached;
  let out: Rgba | null = null;
  if (typeof document !== 'undefined') {
    if (!colorCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      colorCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = colorCtx;
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#feff01'; // 哨兵色（采样源是 getComputedStyle 输出，不会出现）
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, 1, 1); // 必须真正绘制：fillStyle 只改状态不上像素（修复前像素恒为 clearRect 的透明色 → 一切颜色解析成 a=0）
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const hitSentinel = d[0] === 254 && d[1] === 255 && d[2] === 1 && d[3] === 255;
      if (!hitSentinel) out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    }
  }
  colorCache.set(v, out);
  return out;
}

/** 渐变兜底：全屏渐变（天气蓝天等）靠 background-image 实现、backgroundColor 透明，
 *  提取渐变里第一个颜色停靠点——180deg 顶→底渐变的首端即状态栏区域的颜色 */
function firstGradientStop(bgImage: string): string | null {
  if (!bgImage || !bgImage.includes('gradient')) return null;
  const m = bgImage.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|color\([^)]+\))/);
  return m ? m[0] : null;
}

/** 从命中元素向上合成有效背景色（前→后标准 alpha compositing）；
 *  容器自身（含）也在链上：bg-background 不透明，天然兜底；理论走完仍透明按白底补全 */
function compositeBg(el: Element, container: HTMLElement): Rgba | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0; // 预乘累积
  let node: Element | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    let layer = parseCssColor(style.backgroundColor);
    // 全透明 backgroundColor（rgba(0,0,0,0)）视同「无背景」：回落渐变首停（天气蓝天等
    // backgroundImage 渐变场景，修复前被 a=0 对象挡住永远走不到渐变分支）
    if (!layer || layer.a <= 0) {
      const stop = firstGradientStop(style.backgroundImage);
      if (stop) layer = parseCssColor(stop);
    }
    if (layer && layer.a > 0) {
      r = layer.r * layer.a + r * (1 - layer.a);
      g = layer.g * layer.a + g * (1 - layer.a);
      b = layer.b * layer.a + b * (1 - layer.a);
      a = layer.a + a * (1 - layer.a);
      if (a >= 0.999) break;
    }
    if (node === container) break;
    node = node.parentElement;
  }
  if (a <= 0) return null;
  const w = 1 - Math.min(a, 1);
  return {
    r: Math.min(255, r + 255 * w),
    g: Math.min(255, g + 255 * w),
    b: Math.min(255, b + 255 * w),
    a: 1,
  };
}

/** 相对亮度（sRGB 线性化后 L = 0.2126R + 0.7152G + 0.0722B） */
function srgbLin(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLuminance(c: Rgba): number {
  return 0.2126 * srgbLin(c.r) + 0.7152 * srgbLin(c.g) + 0.0722 * srgbLin(c.b);
}

export default function StatusBarToneProbe() {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const pushedIdRef = useRef<number | null>(null);
  const pushedToneRef = useRef<StatusBarTone | null>(null);

  const activeApp = useUI((s) => s.activeApp);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const locked = useUI((s) => s.locked);
  // 主题深浅变化会翻转容器 bg-background，立即重采一次（hooks 必须无条件调用）
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();

  /** 暂停采样：锁屏 / 多任务切换器 / 无前台 App（状态栏在壁纸上，基调不越界） */
  const paused = locked || switcherOpen || !activeApp;

  const release = useCallback(() => {
    if (pushedIdRef.current !== null) {
      popStatusBarTone(pushedIdRef.current);
      pushedIdRef.current = null;
    }
    pushedToneRef.current = null;
  }, []);

  useEffect(() => {
    if (paused) release();
  }, [paused, release]);

  const sample = useCallback(() => {
    const container = holderRef.current?.parentElement;
    if (!container || typeof window === 'undefined' || typeof document === 'undefined') return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // 容器不可见（关闭动画末尾等）

    const y = rect.top + BAR_MIDLINE_Y;
    let chosen: number | null = null;
    for (const ratio of SAMPLE_X_RATIOS) {
      const x = rect.left + rect.width * ratio;
      const hit = document.elementFromPoint(x, y);
      // 命中容器之外（灵动岛通知/来电层等全局浮层）→ 弃用该点，保持现基调防误采样
      if (!hit || !container.contains(hit)) continue;
      const bg = compositeBg(hit, container);
      if (!bg) continue;
      const l = relativeLuminance(bg);
      // 两点各得一个亮度，取更接近中间值 0.5 的那点裁决
      if (chosen === null || Math.abs(l - 0.5) < Math.abs(chosen - 0.5)) chosen = l;
    }
    if (chosen === null) return;

    const tone: StatusBarTone = chosen < 0.5 ? 'light' : 'dark';
    if (pushedIdRef.current !== null && pushedToneRef.current === tone) return; // 无变化不 emit
    if (pushedIdRef.current !== null) popStatusBarTone(pushedIdRef.current);
    pushedIdRef.current = pushStatusBarTone(tone);
    pushedToneRef.current = tone;
  }, []);

  // 采样循环：暂停时不跑；恢复 / 锁屏、切换器、前台 App、主题深浅变化后立即一次
  useEffect(() => {
    if (paused) return;
    sample();
    const timer = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, sample, theme, systemDark]);

  useEffect(() => release, [release]); // 卸载弹栈（push/pop 幂等，strict mode 双挂载安全）

  // hidden 占位：只为拿 parentElement（AppWindow 容器），零布局影响
  return <div ref={holderRef} hidden aria-hidden="true" data-status-bar-tone-probe="" />;
}
