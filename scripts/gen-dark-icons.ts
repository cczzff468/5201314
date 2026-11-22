/**
 * 深色模式真实图标变体生成（第六十六轮「真实图标适配深色模式」）：
 * 用户参考 iPhone 真机深色观感（第二张截图）——原本白/浅底的图标变成「深色瓷砖底 +
 * 原色字形保留」，而非旧版整图 invert+hue-rotate（彩色发闷、白色字形被反成深色）。
 *
 * 每枚图标按内容手工定档（ICON_CONFIG）：
 * - mode 'bg'   ：浅底（白/浅灰）→ 边缘采样取底色，距底色近的像素平滑混入深色瓷砖
 *                 #1A1A1F，字形（彩色/深色）保持原样；flipDark=true 的再把"接近纯黑的
 *                 无彩色字形"翻成浅白（时钟刻度/日历数字在深底上不可见的问题）；
 * - mode 'sky'  ：天气专属——只把"蓝天"色域（蓝主导+饱和）压成深夜蓝，白云/太阳保留；
 * - 不配置的    ：彩色品牌底（微信绿/信息绿/电话绿/音乐红/美团黄/淘宝橙/主题蓝/世界书蓝/
 *                 录音深灰）在深色壁纸上本来就协调，保持原图不动（与参考图里微信保留
 *                 绿底一致）。
 *
 * 输出 public/icons-dark/<同名>.png（仅被转换的 15 枚；registry.tsx 深色时按路径切换）。
 * 增量：输出已存在且比源新时跳过（--force 全量重生成）。
 */
import sharp from 'sharp';
import { existsSync, statSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.join(process.cwd(), 'public', 'icons');
const OUT_DIR = path.join(process.cwd(), 'public', 'icons-dark');

/** 深色瓷砖底色（iOS 深色模式图标底 #1C1C1E 系，略偏冷） */
const TILE = { r: 25, g: 25, b: 30 };

type Mode = 'bg' | 'sky';

const ICON_CONFIG: Record<string, { mode: Mode; threshold?: number; flipDark?: boolean; flood?: boolean }> = {
  // —— 浅底 → 深瓷砖（字形原色保留）——
  'clock.png': { mode: 'bg', flipDark: true }, // 白底黑刻度橙秒针：刻度/数字翻白，秒针橙色保留
  'calendar.png': { mode: 'bg', flipDark: true }, // 白底：黑色「1」翻白，红色 Tue 保留
  'photos.png': { mode: 'bg' }, // 白底彩色花
  'settings.png': { mode: 'bg', threshold: 52 }, // 灰渐变底银齿轮（中性色高阈值覆盖渐变，齿轮远离底色不受影响）
  'camera.png': { mode: 'bg' }, // 浅灰底深色镜头（镜头深色保留=参考图同款）
  'calculator.png': { mode: 'bg' }, // 浅灰底深色机身
  'appstore.png': { mode: 'bg' }, // 白底蓝色 A
  'files.png': { mode: 'bg' }, // 白底蓝色文件夹
  'reminders.png': { mode: 'bg' }, // 白底彩色圆点灰线
  'browser.png': { mode: 'bg' }, // 白底蓝色指南针
  'memory-helper.png': { mode: 'bg' }, // 白底蓝色时钟箭头
  // flood：只把「从边缘连通的近底色区域」换成瓷砖（洪泛填充）——用于白底上还有
  // 封闭白/浅色区域的图标（QQ 企鹅的白脸白肚、联系人白色人形剪影），避免连内腔一起被换掝
  'contacts.png': { mode: 'bg', threshold: 46, flood: true }, // 米灰底白色人形剪影+彩色索引条（洪泛从外围吃进，白剪影 d 大被挡住保留）
  'notes.png': { mode: 'bg' }, // 白底黄头条灰线（黄条保留=iOS 深色备忘录同款）
  'qq.png': { mode: 'bg', flood: true }, // 白底黑企鹅：只换外围白底，企鹅白脸/白肚保留（参考图同款）
  'weather.png': { mode: 'sky' }, // 蓝天→深夜蓝，白云太阳保留
};

// 彩色品牌底 / 已是深底：深色模式直接同图复制（registry 深色时统一走 /icons-dark/ 路径）
// （参考图里微信保留绿底同逻辑：绿/红/黄/橙品牌底在深色壁纸上本来协调）
const KEEP_ICONS = [
  'wechat.png',
  'chat.png',
  'phone.png',
  'music.png',
  'meituan-app.png',
  'taobao.png',
  'themes.png',
  'worldbook.png',
  'recorder.png',
];

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 采样边缘 8px 内不透明像素的平均色 = 图标底色 */
function sampleBg(data: Buffer, w: number, h: number): RGBA {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const M = 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= M && x < w - M && y >= M && y < h - M) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 200) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (n === 0) return { ...TILE, a: 255 };
  return { r: r / n, g: g / n, b: b / n, a: 255 };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * 洪泛标记背景：从四边不透明边缘像素出发，4-连通扩散到所有「距底色 < T2」的像素。
 * 返回 mask（1=背景）。封闭在字形内腔里的近底色像素（如企鹅白肚）不连通 → 保留。
 * floodW：混合权重——内部 1.0 全量换瓷砖（渐变底不再残留半透明灰），
 * 距字形边界 1/2 像素环 0.45/0.78 渐隐（保边缘抗锯齿平滑）。
 */
function floodBg(data: Buffer, w: number, h: number, bg: RGBA, T2: number): { mask: Uint8Array; floodW: Float32Array } {
  const mask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const dist = (i: number): number => {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    return Math.sqrt(0.9 * (r - bg.r) ** 2 + 1.2 * (g - bg.g) ** 2 + 0.7 * (b - bg.b) ** 2);
  };
  const opaque = (p: number): boolean => data[p * 4 + 3] >= 200;
  const push = (x: number, y: number): void => {
    const p = y * w + x;
    if (mask[p] || !opaque(p) || dist(p) >= T2) return;
    mask[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // 边界权重（w2 = 原像素保留率）：内部 0 → 完全变瓷砖；贴字形 1px 环 0.55、
  // 再外 1px 环 0.25 → 抗锯齿边缘平滑过渡；注意 Float32 存 0.45 后读回 ≠ 0.45，
  // 环判定用「>0.01 且 <0.99」而非精确比较
  const floodW = new Float32Array(w * h);
  const ring1: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const x = p % w;
    const y = (p / w) | 0;
    const edge =
      (x > 0 && !mask[p - 1]) ||
      (x < w - 1 && !mask[p + 1]) ||
      (y > 0 && !mask[p - w]) ||
      (y < h - 1 && !mask[p + w]);
    if (edge) {
      floodW[p] = 0.55;
      ring1.push(p);
    }
  }
  for (const p of ring1) {
    const x = p % w;
    const y = (p / w) | 0;
    const nb = [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ];
    for (const q of nb) {
      if (q >= 0 && floodW[q] === 0) floodW[q] = 0.25; // 再外一圈：轻混一点原底色防硬边
    }
  }
  return { mask, floodW };
}

async function convert(name: string): Promise<void> {
  const src = path.join(SRC_DIR, name);
  const out = path.join(OUT_DIR, name);
  if (!existsSync(src)) {
    console.warn(`[skip] 源不存在 ${name}`);
    return;
  }
  if (!process.argv.includes('--force') && existsSync(out) && statSync(out).mtimeMs > statSync(src).mtimeMs) {
    console.log(`[skip] 已是最新 ${name}`);
    return;
  }
  const cfg = ICON_CONFIG[name];
  const img = sharp(src).ensureAlpha();
  const meta = await img.metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 1024;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  if (cfg.mode === 'bg') {
    const bg = sampleBg(data, info.width, info.height);
    const T = cfg.threshold ?? 64;
    // 中性色（灰阶/阴影/白）用更高阈值：白底上的柔和投影也要一并混进瓷砖，
    // 否则深底上残留一圈亮晕；彩色字形（花瓣/黄条）用基准阈值防误伤
    const HI = T * 1.8;
    const flood = cfg.flood ? floodBg(data, info.width, info.height, bg, HI) : null;
    const floodMask = flood?.mask ?? null;
    const floodW: Float32Array | null = flood?.floodW ?? null;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      // 与底色的距离（欧氏，RGB 加权观感）
      const d = Math.sqrt(0.9 * (r - bg.r) ** 2 + 1.2 * (g - bg.g) ** 2 + 0.7 * (b - bg.b) ** 2);
      const neutral = mx - mn < 26; // 无彩色（灰阶/白/阴影；含字形边缘与白混合的抗锯齿像素）
      const T2 = neutral ? HI : T;
      let w2 = 0; // 原像素保留权重（0=完全变瓷砖，1=保留原样）
      let force = false; // 洪泛区内部：即使 w2=0 也要写入（全瓷砖）
      if (floodMask && floodW) {
        const p = i >> 2;
        if (floodMask[p]) {
          // 连通背景：内部完全换瓷砖，仅贴字形 2px 环保留部分原色（保抗锯齿平滑）
          w2 = floodW[p];
          force = true;
        }
      } else if (floodMask === null && d < T2) {
        w2 = smooth(d / T2);
        force = true;
      }
      if (force) {
        // 距底越近越像瓷砖，字形边缘（半距）平滑过渡，深底上无光晕
        data[i] = clamp(TILE.r + (r - TILE.r) * w2, 0, 255);
        data[i + 1] = clamp(TILE.g + (g - TILE.g) * w2, 0, 255);
        data[i + 2] = clamp(TILE.b + (b - TILE.b) * w2, 0, 255);
        continue;
      }
      if (cfg.flipDark) {
        // 接近纯黑的无彩色字形 → 翻成浅白（带一点原明暗层次，保留高光/立体感）
        const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (y < 0.18 && mx - mn < 70) {
          const lift = 205 + (1 - y / 0.18) * 50;
          data[i] = clamp(lift, 0, 255);
          data[i + 1] = clamp(lift - 2, 0, 255);
          data[i + 2] = clamp(lift + 3, 0, 255);
        }
      }
    }
  } else {
    // sky：按饱和度渐变压暗——纯蓝天完全变深夜蓝，云朵蓝灰阴影仅轻微加深（自然云底），
    // 白云主体与黄太阳不动；避免二值切换在云内留硬边暗带
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      if (b === mx && b - r > 34 && sat > 0.34) {
        const w = smooth(clamp((sat - 0.34) / 0.28, 0, 1));
        const tr = r * 0.2;
        const tg = g * 0.24;
        const tb = b * 0.3 + 10;
        data[i] = clamp(r + (tr - r) * w, 0, 255);
        data[i + 1] = clamp(g + (tg - g) * w, 0, 255);
        data[i + 2] = clamp(b + (tb - b) * w, 0, 255);
      }
    }
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(out);
  console.log(`[ok] ${name} → icons-dark/`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const names = Object.keys(ICON_CONFIG);
  for (const n of names) await convert(n);
  // 保留原样的图标：同图落到 icons-dark（深色路径统一可寻）
  for (const n of KEEP_ICONS) {
    const src = path.join(SRC_DIR, n);
    const out = path.join(OUT_DIR, n);
    if (!existsSync(src)) continue;
    if (!process.argv.includes('--force') && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    await sharp(src).png().toFile(out);
    console.log(`[copy] ${n} → icons-dark/（原样）`);
  }
  console.log(`完成：${names.length} 枚转换 + ${KEEP_ICONS.length} 枚原样 → public/icons-dark/`);
}

void main();
