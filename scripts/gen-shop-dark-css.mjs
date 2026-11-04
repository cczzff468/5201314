/**
 * 淘宝/美团深色模式覆盖层生成器（第六十七轮）：
 * 扫描两个购物 App 及其（传递）本地子组件源码里的颜色类，
 * 生成 src/app/shop-dark.css —— 仅在 .shop-dark 作用域（AppWindow 深色时挂给淘宝/美团）生效。
 *
 * 映射规则（Plan C，上下文安全优先）：
 * 1. 纯白面 bg-white → #1d1d1f 卡片色；bg-white/80+ → 深色毛玻璃（TabBar/吸顶条）；
 *    bg-white/40-75 → 深色磨砂贴片；bg-white/30- 保持（图片压字遮罩）。
 * 2. 中性浅灰（s≤0.14, l≥0.72）：近白（l≥0.88 页面色）→ #141416；中灰 → #232327。
 * 3. 粉彩浅色贴片（s>0.14, l≥0.72）→ 同色相深色贴片 hsl(h, s*0.42, 0.16)
 *    （金色券/粉色标/绿色提示条在深色页里变成深金/深粉/深绿，深褐文字同步提亮）。
 * 4. text-black/N → rgba(255,255,255, N/100*1.05+0.02)（主文字翻转）。
 * 5. 品牌亮色（饱和 mid-tone：美团黄 CTA/淘宝橙/红/绿/蓝紫）保持原样 ——
 *    真实 App 深色模式同样保留亮色 CTA；其上的 text-black/N 与深褐 text-[#hex]
 *    用「保护规则」恢复原色（祖先/同元素两级选择器，优先级高于翻转规则）。
 * 6. border/ring/divide-black/N → 白色同级；bg-black/≤0.15 浅色芯片 → 白色芯片。
 * 7. 渐变 stops：白/中性 → 深色；粉彩 → 深色同调；品牌亮色保持。
 * 8. 深褐文字 text-[#hex]（l<0.45）→ 同色相提亮 l=0.75（深色贴片上可读）。
 *
 * 运行：bun scripts/gen-shop-dark-css.mjs（改颜色类后重跑再重启 dev 即可）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = resolve(__dirname, '../src/components/apps');
const OUT = resolve(__dirname, '../src/app/shop-dark.css');
const ROOT_FILES = ['taobao.tsx', 'meituan.tsx'];

/** 递归收集 from './x' 本地依赖（渲染进淘宝/美团子树的全部组件） */
function collectFiles() {
  const seen = new Set();
  const queue = [...ROOT_FILES];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    let src = '';
    try {
      src = readFileSync(resolve(APPS_DIR, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(/from '\.\/([\w-]+)'/g)) queue.push(`${m[1]}.tsx`);
  }
  return [...seen];
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hslCss(h, s, l) {
  return `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}%)`;
}
/** CSS 类名转义：bg-[#F5F6F7] → .bg-\[\#F5F6F7\]，bg-black/5 → .bg-black\/5 */
const esc = (cls) => cls.replace(/([#:[\]/%.])/g, '\\$1');

const files = collectFiles();
const src = files.map((f) => { try { return readFileSync(resolve(APPS_DIR, f), 'utf8'); } catch { return ''; } }).join('\n');

// ---------- 收集类目 ----------
const solidBgs = new Set();          // bg-[#hex]
const stops = new Map();             // from/via/to → Set(hex)
for (const m of src.matchAll(/\bbg-\[([#][0-9a-fA-F]{3,8})\]/g)) solidBgs.add(m[1]);
for (const side of ['from', 'via', 'to']) {
  const set = new Set();
  for (const m of src.matchAll(new RegExp(`\\b${side}-\\[([#][0-9a-fA-F]{3,8})\\]`, 'g'))) set.add(m[1]);
  stops.set(side, set);
}
const bgWhiteSteps = new Set();      // bg-white/NN
for (const m of src.matchAll(/\bbg-white\/(\d{1,3})\b/g)) bgWhiteSteps.add(Number(m[1]));
const textBlackSteps = new Set();
for (const m of src.matchAll(/\btext-black\/(\d{1,3})\b/g)) textBlackSteps.add(Number(m[1]));
const hasPureTextBlack = /(?<![-\w])text-black(?![-/\w])/.test(src);
const borderBlackSteps = new Set();
for (const m of src.matchAll(/\bborder-black\/(\d{1,3})\b/g)) borderBlackSteps.add(Number(m[1]));
// bg-black / divide-black 浅芯片：按源码原样收（[0.05] 与 /5 是两个不同的类）
const bgBlackCls = new Set();
for (const m of src.matchAll(/\bbg-black\/\[(0\.\d{1,3})\]/g)) if (Number(m[1]) <= 0.15) bgBlackCls.add(`bg-black/[${m[1]}]`);
for (const m of src.matchAll(/\bbg-black\/(\d{1,2})\b/g)) if (Number(m[1]) / 100 <= 0.15) bgBlackCls.add(`bg-black/${m[1]}`);
const divideBlackCls = new Set();
for (const m of src.matchAll(/\bdivide-black\/\[(0\.\d{1,3})\]/g)) divideBlackCls.add(`divide-black/[${m[1]}]`);
for (const m of src.matchAll(/\bdivide-black\/(\d{1,2})\b/g)) if (Number(m[1]) / 100 <= 0.15) divideBlackCls.add(`divide-black/${m[1]}`);
const ringBlackSteps = new Set();
for (const m of src.matchAll(/\bring-black\/(\d{1,3})\b/g)) ringBlackSteps.add(Number(m[1]));
const solidTexts = new Set();        // text-[#hex]
for (const m of src.matchAll(/\btext-\[([#][0-9a-fA-F]{3,8})\]/g)) solidTexts.add(m[1]);
const solidBorders = new Set();      // border-[#hex]
for (const m of src.matchAll(/\bborder-\[([#][0-9a-fA-F]{3,8})\]/g)) solidBorders.add(m[1]);

// ---------- 分类与映射 ----------
const NEUTRAL_PAGE = '#141416';
const NEUTRAL_MID = '#232327';
const CARD = '#1d1d1f';
const WHITE_CHIP = 'rgba(255,255,255,0.10)';

const flip = new Map();              // css 类名 → { prop, value }
const keptBright = new Set();        // 保持的亮色表面（品牌 CTA/彩色贴片底）
const liftedTexts = new Map();       // 提亮的深褐文字类 → { dark, light }

// 1) 实色 bg-[#hex]
for (const hex of solidBgs) {
  const rgb = hexToRgb(hex);
  const [, s, l] = rgbToHsl(...rgb);
  const cls = `bg-[${hex}]`;
  if (s <= 0.14 && l >= 0.72) {
    flip.set(cls, { prop: 'background-color', value: l >= 0.88 ? NEUTRAL_PAGE : l >= 0.8 ? NEUTRAL_MID : '#2a2a2e' });
  } else if (s > 0.14 && l >= 0.72) {
    flip.set(cls, { prop: 'background-color', value: hslCss(rgbToHsl(...rgb)[0], s * 0.42, 0.16) });
  } else if (lum(rgb) >= 0.16) {
    // 保持的亮色（品牌 CTA/彩色贴片底）：黑字保护候选
    keptBright.add(cls);
  }
}
// 2) 渐变 stops
const stopDark = (hex) => {
  const rgb = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(...rgb);
  if (s <= 0.14 && l >= 0.72) return l >= 0.98 ? CARD : l >= 0.88 ? NEUTRAL_PAGE : NEUTRAL_MID;
  if (s > 0.14 && l >= 0.72) return hslCss(h, s * 0.42, 0.16);
  return null; // 品牌色/深色保持
};
for (const [side, set] of stops) {
  for (const hex of set) {
    const dark = stopDark(hex);
    if (dark) {
      // Tailwind v4 渐变变量：from→--tw-gradient-from、via→--tw-gradient-via、to→--tw-gradient-to
      // （stops 变量动态引用这些变量，覆盖即可生效）
      const prop = side === 'from' ? '--tw-gradient-from' : side === 'via' ? '--tw-gradient-via' : '--tw-gradient-to';
      flip.set(`${side}-[${hex}]`, { prop, value: dark });
    } else if (lum(hexToRgb(hex)) >= 0.16) {
      keptBright.add(`${side}-[${hex}]`);
    }
  }
}
// 白色 stops（from-white/to-white/via-white）
for (const side of ['from', 'via', 'to']) {
  if (new RegExp(`\\b${side}-white\\b`).test(src)) {
    flip.set(`${side}-white`, { prop: `--tw-gradient-${side}`, value: CARD });
  }
}
// 3) bg-white 系列
flip.set('bg-white', { prop: 'background-color', value: CARD });
for (const n of bgWhiteSteps) {
  const cls = `bg-white/${n}`;
  if (n >= 80) flip.set(cls, { prop: 'background-color', value: `rgba(24,24,27,${Math.min(0.96, n / 100)})` });
  else if (n >= 40) flip.set(cls, { prop: 'background-color', value: WHITE_CHIP });
}
// 4) text-black/N → 白（保护规则在 CSS 里生成）
// 5) border/ring/divide
for (const n of borderBlackSteps) flip.set(`border-black/${n}`, { prop: 'border-color', value: `rgba(255,255,255,${Math.max(0.1, (n / 100) * 0.85).toFixed(2)})` });
for (const n of ringBlackSteps) flip.set(`ring-black/${n}`, { prop: '--tw-ring-color', value: `rgba(255,255,255,${Math.max(0.14, (n / 100) * 0.9).toFixed(2)})` });
for (const cls of divideBlackCls) {
  const a = Number(cls.includes('[') ? cls.slice(cls.indexOf('[') + 1, -1) : cls.split('/')[1]) / 100;
  flip.set(cls, { prop: 'border-color', value: `rgba(255,255,255,${Math.min(0.16, a + 0.055).toFixed(3)})` });
}
// 6) bg-black 浅芯片 → 白芯片
for (const cls of bgBlackCls) {
  const a = Number(cls.includes('[') ? cls.slice(cls.indexOf('[') + 1, -1) : cls.split('/')[1]) / 100;
  flip.set(cls, { prop: 'background-color', value: `rgba(255,255,255,${Math.min(0.16, a + 0.06).toFixed(3)})` });
}
// 7) 深褐/深色文字提亮（粉彩贴片翻深后保持可读）；品牌彩字（含橙红黄绿）不动
for (const hex of solidTexts) {
  const rgb = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(...rgb);
  if (l < 0.45 && lum(rgb) < 0.16) {
    const lifted = hslCss(h, Math.min(s, 0.85), 0.75);
    liftedTexts.set(`text-[${hex}]`, { dark: hex, light: lifted });
  }
}
// 8) 浅色边框：美团「我的页」等用 border-t-[7px] border-[#F5F6F7/#F7F8FA] 做粗分隔条——
//    深色下必须翻成页面底色 #141416（第六十八轮修复：旧版翻成 white/10 会渲染成白色空隙）；
//    判定用亮度阈值（#F7F8FA 饱和度 0.235 属浅粉彩，中性 s≤0.14 口径会漏），
//    品牌色边框（#FFD100/#FF6000 等 l<0.72 或高饱和中亮色）保持
for (const hex of solidBorders) {
  const rgb = hexToRgb(hex);
  const [, , l] = rgbToHsl(...rgb);
  if (l >= 0.72) flip.set(`border-[${hex}]`, { prop: 'border-color', value: NEUTRAL_PAGE });
}
// 9) 保护名单：只在「保持亮色 + 源码实测带黑字」的表面上恢复黑字/深褐字
//    （同元素 200 字符内出现 text-black → 该表面需要保护；避免保护名单膨胀撑爆 CSS）
const protSurfaces = new Set();
for (const cls of keptBright) {
  const needle = cls.replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('#', '\\#');
  const re = new RegExp(`${needle}[^\`"]{0,200}?text-black`);
  if (re.test(src)) protSurfaces.add(cls);
}

// ---------- 生成 CSS ----------
const protList = [...protSurfaces].map((c) => `.${esc(c)}`).join(',');
const lines = [];
lines.push(`/* 由 scripts/gen-shop-dark-css.mjs 自动生成 —— 淘宝/美团深色模式覆盖层（第六十七轮）。
 * 作用域：.shop-dark（AppWindow 在全局深色主题下挂给淘宝/美团两个 App）。
 * 规则：中性白/灰面与黑字翻转成深色/白字；粉彩贴片翻深同调；品牌亮色 CTA（美团黄/淘宝橙等）
 * 保持原样，其上的黑字/深褐字用保护规则恢复；改动两个 App 的颜色类后重跑生成器即可。
 * 覆盖文件：${files.join(' ')} */`);
lines.push('');
lines.push('.shop-dark { color-scheme: dark; }');
lines.push('');

// 常规翻转（未分层规则优先级高于 @layer utilities，双保险）
for (const [cls, { prop, value }] of [...flip].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`.shop-dark .${esc(cls)} { ${prop}: ${value}; }`);
}
lines.push('');
// 纯 text-black（无透明度）
if (hasPureTextBlack) lines.push(`.shop-dark .${esc('text-black')} { color: #f2f2f4; }`);
// text-black/N → 白
for (const n of [...textBlackSteps].sort((a, b) => a - b)) {
  const white = Math.min(0.95, (n / 100) * 1.05 + 0.02).toFixed(2);
  lines.push(`.shop-dark .${esc(`text-black/${n}`)} { color: rgba(255,255,255,${white}); }`);
}
lines.push('');
// 深褐文字提亮
for (const [cls, { light }] of liftedTexts) lines.push(`.shop-dark .${esc(cls)} { color: ${light}; }`);
if (liftedTexts.size) lines.push('');
// 保护规则：保持亮色的表面（同元素 + 后代两级）里，黑字/深褐字恢复原色。
// 后代级排除带 bg-* 类的中间层（黄 CTA 内嵌白卡时，白卡上的黑字应随白卡翻白）
const NO_BG = ":not([class*='bg-'])";
if (protList) {
  for (const n of [...textBlackSteps].sort((a, b) => a - b)) {
    const orig = `rgba(0,0,0,${(n / 100).toFixed(2)})`;
    lines.push(`.shop-dark :is(${protList}) ${NO_BG} .${esc(`text-black/${n}`)},`);
    lines.push(`.shop-dark :is(${protList}).${esc(`text-black/${n}`)} { color: ${orig}; }`);
  }
  if (hasPureTextBlack) {
    lines.push(`.shop-dark :is(${protList}) ${NO_BG} .${esc('text-black')},`);
    lines.push(`.shop-dark :is(${protList}).${esc('text-black')} { color: #000; }`);
  }
  for (const [cls, { dark }] of liftedTexts) {
    lines.push(`.shop-dark :is(${protList}) ${NO_BG} .${esc(cls)},`);
    lines.push(`.shop-dark :is(${protList}).${esc(cls)} { color: ${dark}; }`);
  }
}
lines.push('');

writeFileSync(OUT, lines.join('\n'));
console.log(`shop-dark.css 生成完成：${flip.size} 条翻转规则、${textBlackSteps.size} 档黑字翻转、保护表面 ${protSurfaces.size} 个、提亮深褐字 ${liftedTexts.size} 个（扫描 ${files.length} 个文件）`);
