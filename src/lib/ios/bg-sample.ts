'use client';

/**
 * 视觉背景采样共享库（v2.4.7 从 StatusBarToneProbe 抽出）：
 * 「某一行/列像素身后合成出的有效背景色」是两处能力共用的底层——
 * ① StatusBarToneProbe：状态栏前景明暗（深底白字/浅底黑字）；
 * ② SafeAreaBleedBands：APK 安全区出血条带的颜色（App 页面底色延伸到系统
 *    状态栏/侧挖孔避让区后面，替代旧版固定 bg-background 白底在深色页上
 *    露出的「白条带 + 右缘白竖条」，即机主反馈的「其他界面状态栏没融入」）。
 *
 * 采样方式（不引入截图/光栅化，纯 DOM 命中）：
 * - elementFromPoint 命中该坐标的最上层元素；
 * - 从命中元素向上走祖先链，按标准 alpha compositing 合成有效背景色
 *   （半透明层逐层叠加），直到链路终点（terminal）为止——AppWindow 场景
 *   传出血根（bg-background 恒不透明）作终点，保证结果必不透明；
 * - backgroundColor 全透明但带 background-image 渐变时取渐变第一个颜色
 *   停靠点（天气蓝天/美团黄头等渐变实现）；
 * - 任意 CSS 颜色（rgb/rgba/hex/oklch/color()…）经 1×1 离屏画布规范化成 sRGB 字节。
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/** 主题变量是 oklch（getComputedStyle 原样返回 oklch(1 0 0)），手写解析器覆盖不全，
 *  用 1×1 离屏画布让浏览器把任意 CSS 颜色规范化成 sRGB 字节 */
let colorCtx: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, Rgba | null>();

export function parseCssColor(raw: string): Rgba | null {
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
      ctx.fillRect(0, 0, 1, 1); // 必须真正绘制：fillStyle 只改状态不上像素
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const hitSentinel = d[0] === 254 && d[1] === 255 && d[2] === 1 && d[3] === 255;
      if (!hitSentinel) out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    }
  }
  colorCache.set(v, out);
  return out;
}

/** 渐变兜底：全屏渐变（天气蓝天等）靠 background-image 实现、backgroundColor 透明，
 *  提取渐变里第一个颜色停靠点——180deg 顶→底渐变的首端即顶部区域的颜色 */
export function firstGradientStop(bgImage: string): string | null {
  if (!bgImage || !bgImage.includes('gradient')) return null;
  const m = bgImage.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|color\([^)]+\))/);
  return m ? m[0] : null;
}

/** 从命中元素向上合成有效背景色（前→后标准 alpha compositing）；
 *  terminal = 链路终点（含）：AppWindow 出血根 bg-background 不透明，天然兜底；
 *  理论走完仍不完全透明按白底补全（返回值恒 a=1，方便直接当条带颜色用） */
export function compositeBg(el: Element, terminal: Element): Rgba | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0; // 预乘累积
  let node: Element | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    let layer = parseCssColor(style.backgroundColor);
    // 全透明 backgroundColor（rgba(0,0,0,0)）视同「无背景」：回落渐变首停
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
    if (node === terminal) break;
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
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * srgbLin(c.r) + 0.7152 * srgbLin(c.g) + 0.0722 * srgbLin(c.b);
}

export function rgbaCss(c: Rgba): string {
  // 每通道 clamp 0-255：任何异常合成值都不允许产出非法 CSS 颜色
  //（Chrome 对负值通道会夹 0——rgb(255,255,-x) 变纯黄，历史上真出现过）
  const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${cl(c.r)}, ${cl(c.g)}, ${cl(c.b)})`;
}
