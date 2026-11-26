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

/* ================= v2.4.8 媒体像素采样（出血条带「图片顶边像素延伸」） =================
 * 机主需求「其他界面状态栏融入」的最后一环：纯 CSS 背景采样（compositeBg）覆盖不到
 * 图片顶边的页面——命中 <img> 时条带色此前只能回落祖先 CSS 背景（白），黑底照片/插画
 * 顶上就露白条（「有的融合不进去」的真根因）。本节把「媒体元素在某视口坐标处的像素」
 * 变成可同步读取：图片缩绘进 48px 宽的离屏画布（按 URL 缓存），按 object-fit /
 * background-size + position 的真实映射换算视口坐标 → 源坐标 → 缩绘图素。
 * 跨域图片 getImageData 抛 SecurityError → 缓存记 null（本 URL 永久回落 CSS 采样，
 * 不每轮重试）。CSS background-image: url(...) 场景需先解码 → 异步回调后重画条带。
 */

/** 缩绘条带画布缓存（URL → {画布}；null = 跨域/解码失败，不再重试） */
type Strip = { w: number; h: number; ctx: CanvasRenderingContext2D } | null;
const stripCache = new Map<string, Strip>();
const STRIP_W = 48;
const STRIP_CACHE_MAX = 40;

function rememberStrip(url: string, s: Strip): Strip {
  if (stripCache.size >= STRIP_CACHE_MAX) {
    // 简单淘汰：清一半最旧（Map 保持插入序）
    let drop = STRIP_CACHE_MAX / 2;
    for (const k of stripCache.keys()) {
      stripCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  stripCache.set(url, s);
  return s;
}

/** 把已加载的图片缩绘进离屏画布并缓存（保持纵横比，宽 48px） */
function buildStrip(src: string, img: HTMLImageElement): Strip {
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const w = STRIP_W;
  const h = Math.max(1, Math.round((STRIP_W * nh) / nw));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    // 预热读取一次：跨域污染在这一步就暴露（而不是留到采样时每点抛错）
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    return null;
  }
  return { w, h, ctx };
}

/** 解析 object-position / background-position（"50% 50%" / "center" / "10px 0"）→ 比例 0..1 */
function parsePosFraction(raw: string | undefined, fallback = 0.5): number {
  if (!raw) return fallback;
  const m = raw.match(/^(-?[\d.]+)%/);
  if (m) return Math.max(0, Math.min(1, parseFloat(m[1]) / 100));
  if (/^(center|50%)\b/.test(raw.trim())) return 0.5;
  const pxm = raw.match(/^(-?[\d.]+)px/);
  if (pxm) return NaN; // px 定位换算依赖渲染尺寸——罕见场景，走默认 0.5 由调用方兜底
  if (/^left/.test(raw.trim())) return 0;
  if (/^right/.test(raw.trim())) return 1;
  if (/^top/.test(raw.trim())) return 0;
  if (/^bottom/.test(raw.trim())) return 1;
  return fallback;
}

/** 从缩绘条带读一个源坐标像素（sx/sy 为源图坐标） */
function readPixel(strip: NonNullable<Strip>, nw: number, nh: number, sx: number, sy: number): Rgba | null {
  const col = Math.min(strip.w - 1, Math.max(0, Math.round((sx / nw) * strip.w)));
  const row = Math.min(strip.h - 1, Math.max(0, Math.round((sy / nh) * strip.h)));
  try {
    const d = strip.ctx.getImageData(col, row, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch {
    return null; // 跨域污染（理论上 buildStrip 已提前拦截，双保险）
  }
}

/** object-fit 映射：视口坐标 → 源图坐标；letterbox 区（源图未覆盖该点）返回 null */
function objectFitMap(
  img: HTMLImageElement,
): ((vx: number, vy: number, rect: DOMRect) => { sx: number; sy: number } | null) | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const cs = getComputedStyle(img);
  const fit = cs.objectFit;
  const pxf = parsePosFraction(cs.objectPosition.split(/\s+/)[0]);
  const pyf = parsePosFraction(cs.objectPosition.split(/\s+/)[1] ?? cs.objectPosition.split(/\s+/)[0]);
  return (vx, vy, rect) => {
    const rw = rect.width || 1;
    const rh = rect.height || 1;
    if (fit === 'fill') {
      return { sx: ((vx - rect.left) / rw) * nw, sy: ((vy - rect.top) / rh) * nh };
    }
    let scale = 1;
    if (fit === 'cover') scale = Math.max(rw / nw, rh / nh);
    else if (fit === 'contain') scale = Math.min(rw / nw, rh / nh);
    else if (fit === 'scale-down') scale = Math.min(1, Math.min(rw / nw, rh / nh));
    // none / 其他：scale = 1（原尺寸居中）
    const dw = nw * scale;
    const dh = nh * scale;
    const dx = (rw - dw) * (Number.isNaN(pxf) ? 0.5 : pxf);
    const dy = (rh - dh) * (Number.isNaN(pyf) ? 0.5 : pyf);
    const sx = (vx - rect.left - dx) / scale;
    const sy = (vy - rect.top - dy) / scale;
    if (sx < 0 || sx >= nw || sy < 0 || sy >= nh) return null;
    return { sx, sy };
  };
}

/** <img> 在视口坐标 (vx,vy) 处的像素（同步：要求 img 已解码完成） */
export function imgPixelAt(img: HTMLImageElement, vx: number, vy: number): Rgba | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  const map = objectFitMap(img);
  if (!map) return null;
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const pt = map(vx, vy, rect);
  if (!pt) return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  let strip = stripCache.get(src) ?? undefined;
  if (strip === undefined) strip = rememberStrip(src, buildStrip(src, img));
  if (!strip) return null;
  return readPixel(strip, img.naturalWidth, img.naturalHeight, pt.sx, pt.sy);
}

/* ================= 第四十轮 <canvas>/<video> 像素采样（拾光小屋断层根修） =================
 * 机主截图实锤：拾光小屋全窗 R3F WebGL Canvas（天空色随昼夜/天气变）——
 * compositeBg 只认 CSS 背景，命中 <canvas> 时恒透明 → 回落页面根米白底 →
 * 出血条带永远画米白，与昼夜天空（浅蓝/深灰绿）形成「灰白色断层」。本函数把
 * canvas / video 在某视口坐标处的像素变成可同步读取：drawImage 源矩形 1×1
 * 缩绘到离屏 1×1 画布再 getImageData（WebGL 需 preserveDrawingBuffer——
 * HomeScene 已开 gl={{preserveDrawingBuffer:true}}；未开/未渲染时画布透明
 * 返回 null，调用方沿栈回落 CSS 采样，行为与从前一致）。
 * video（相机 App 全屏 <video>）同一路径：readyState≥2 有帧可读。 */
let mediaCtx: CanvasRenderingContext2D | null = null;

/** <canvas>/<video> 在视口坐标 (vx,vy) 处的像素（同步；透明像素返回 null 走 CSS 回落） */
export function canvasPixelAt(el: HTMLCanvasElement | HTMLVideoElement, vx: number, vy: number): Rgba | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (el instanceof HTMLVideoElement) {
    if (el.readyState < 2 || !el.videoWidth || !el.videoHeight) return null;
  } else {
    if (el.width <= 0 || el.height <= 0) return null;
  }
  const natW = el instanceof HTMLVideoElement ? el.videoWidth : el.width;
  const natH = el instanceof HTMLVideoElement ? el.videoHeight : el.height;
  // 视口坐标 → 媒体像素坐标（canvas/video 以 fill 方式铺满自身盒）
  const sx = ((vx - rect.left) / rect.width) * natW;
  const sy = ((vy - rect.top) / rect.height) * natH;
  if (sx < 0 || sx >= natW || sy < 0 || sy >= natH) return null;
  if (!mediaCtx) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    mediaCtx = c.getContext('2d', { willReadFrequently: true });
  }
  const ctx = mediaCtx;
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(el, Math.floor(sx), Math.floor(sy), 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    // 透明（未渲染/加载中/black frame 前）→ null 沿栈回落 CSS 采样
    if (d[3] <= 8) return null;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch {
    return null; // 跨域污染/安全上下文异常：静默回落
  }
}

/** CSS background-image: url(...) 的首层 URL（无 url 或纯渐变返回 null） */
export function bgImageUrlOf(el: Element): string | null {
  const raw = getComputedStyle(el).backgroundImage;
  if (!raw || raw === 'none') return null;
  const m = raw.match(/url\((['"]?)([^'")]+)\1\)/);
  return m ? m[2] : null;
}

/** background-size/position 映射 → 视口坐标 (vx,vy) 处该背景图层的像素（同步版，图未缓存时返回 null） */
export function bgImagePixelAt(el: Element, vx: number, vy: number): Rgba | null {
  const src = bgImageUrlOf(el);
  if (!src) return null;
  const strip = stripCache.get(src);
  if (!strip) return null; // 未解码（异步路径由 ensureBgImageStrip 负责）
  return bgPixelWithSize(el, vx, vy, strip, naturalSizeCache.get(src) ?? { w: strip.w, h: strip.h });
}

/** 自然尺寸缓存（bg-image 解码时记录，供映射换算用） */
const naturalSizeCache = new Map<string, { w: number; h: number }>();

function bgPixelWithSize(
  el: Element,
  vx: number,
  vy: number,
  strip: NonNullable<Strip>,
  nat: { w: number; h: number },
): Rgba | null {
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const rw = rect.width || 1;
  const rh = rect.height || 1;
  const size = cs.backgroundSize; // cover / contain / "Xpx Ypx" / "X% Y%" / auto
  if (size && size !== 'auto' && size !== 'cover' && size !== 'contain') {
    // 显式尺寸（px/%）：线性映射 rect → 显示尺寸
    const parts = size.split(/\s+/);
    const pw = parts[0];
    const ph = parts[1] ?? parts[0];
    const wPx = pw.endsWith('px') ? parseFloat(pw) : pw.endsWith('%') ? (parseFloat(pw) / 100) * rw : nat.w;
    const hPx = ph.endsWith('px') ? parseFloat(ph) : ph.endsWith('%') ? (parseFloat(ph) / 100) * rh : nat.h;
    if (wPx > 0 && hPx > 0) {
      return readPixel(strip, wPx, hPx, ((vx - rect.left) / rw) * wPx, ((vy - rect.top) / rh) * hPx);
    }
  }
  let scale = 1;
  if (size === 'cover') scale = Math.max(rw / nat.w, rh / nat.h);
  else if (size === 'contain') scale = Math.min(rw / nat.w, rh / nat.h);
  // cover/contain/auto：与 object-fit 同款映射（background-position 默认 0% 0%，与 object-position 的 50% 不同！）
  const px = parsePosFraction(cs.backgroundPositionX, 0);
  const py = parsePosFraction(cs.backgroundPositionY, 0);
  const dw = nat.w * scale;
  const dh = nat.h * scale;
  const dx = (rw - dw) * px;
  const dy = (rh - dh) * py;
  const sx = (vx - rect.left - dx) / scale;
  const sy = (vy - rect.top - dy) / scale;
  if (sx < 0 || sx >= nat.w || sy < 0 || sy >= nat.h) return null;
  return readPixel(strip, nat.w, nat.h, sx, sy);
}

/** 异步解码 background-image 的 URL 并入条带缓存（ onload 后调用方应触发一次重采样重画） */
export function ensureBgImageStrip(el: Element, onReady: () => void): void {
  const src = bgImageUrlOf(el);
  if (!src || stripCache.has(src)) return;
  const probe = new Image();
  probe.onload = () => {
    if (stripCache.has(src)) return; // 已有（竞态双保险）
    const s = rememberStrip(src, buildStrip(src, probe));
    if (s) naturalSizeCache.set(src, { w: probe.naturalWidth, h: probe.naturalHeight });
    onReady();
  };
  probe.onerror = () => rememberStrip(src, null);
  probe.src = src;
}
