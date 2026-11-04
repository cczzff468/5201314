/**
 * 立绘抠图 v4：raw/pet-chibi/*.png → public/pets/chibi/<id>-<g>.png
 * ① 取图像边界 2px 环的中位色 MC；
 * ② 从边界严格洪泛（dist<55）= 背景核心（不发散，防止渗入白色绒毛）；
 * ③ 非背景像素做连通域分析，只保留最大连通域（宠物本体）——
 *    边角渐变暗角/碎片阴影是独立小块，直接丢弃；
 * ④ 按 dist 羽化 alpha（软边）+ 去色溢（despill），bbox 裁剪 + 缩放 512。
 * 运行：bun scripts/chroma-pet-chibi.ts
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const IN = path.join(process.cwd(), 'raw', 'pet-chibi');
const OUT = path.join(process.cwd(), 'public', 'pets', 'chibi');
fs.mkdirSync(OUT, { recursive: true });

const dist = (
  r: number,
  g: number,
  b: number,
  mc: [number, number, number],
) => Math.sqrt((r - mc[0]) ** 2 + (g - mc[1]) ** 2 + (b - mc[2]) ** 2);

async function key(file: string) {
  const base = path.basename(file, '.png');
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const px = data;
  const N = w * h;

  // ① 边界 2px 环中位色 + 中位饱和度
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const ss: number[] = [];
  const push = (x: number, y: number) => {
    const o = (y * w + x) * channels;
    const r = px[o],
      g = px[o + 1],
      b = px[o + 2];
    rs.push(r);
    gs.push(g);
    bs.push(b);
    const mx = Math.max(r, g, b);
    ss.push(mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx);
  };
  for (let x = 0; x < w; x++) for (let y = 0; y < 2; y++) push(x, y);
  for (let x = 0; x < w; x++) for (let y = h - 2; y < h; y++) push(x, y);
  for (let y = 0; y < h; y++) for (let x = 0; x < 2; x++) push(x, y);
  for (let y = 0; y < h; y++) for (let x = w - 2; x < w; x++) push(x, y);
  const med = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  };
  const MC: [number, number, number] = [med(rs), med(gs), med(bs)];
  // 饱和度门槛 = 背景中位饱和度 × 0.75（背景饱和纯色；毛发上的环境反光不饱和）
  const SAT_T = Math.max(0.1, med(ss) * 0.75);

  // ② 从边界严格洪泛（dist<55 且饱和度达标：背景是饱和纯色；
  //    白毛上的绿色环境反光颜色近但饱和度低 → 不误吞）
  const bg = new Uint8Array(N);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  const isBgColor = (o: number) => {
    const r = px[o],
      g = px[o + 1],
      b = px[o + 2];
    if (dist(r, g, b, MC) >= 55) return false;
    const mx = Math.max(r, g, b);
    if (mx === 0) return false;
    return (mx - Math.min(r, g, b)) / mx > SAT_T;
  };
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i]) continue;
    if (!isBgColor(i * channels)) continue;
    bg[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < N - w) stack.push(i + w);
  }

  // ③ 最大连通域：非背景像素中只留宠物本体（含贴脚接触阴影）
  const comp = new Int32Array(N).fill(-1);
  let best = -1;
  let bestSize = 0;
  let ci = 0;
  for (let s = 0; s < N; s++) {
    if (bg[s] || comp[s] >= 0) continue;
    const q = [s];
    comp[s] = ci;
    let size = 0;
    while (q.length) {
      const i = q.pop()!;
      size++;
      const x = i % w;
      const nbs: number[] = [];
      if (x > 0) nbs.push(i - 1);
      if (x < w - 1) nbs.push(i + 1);
      if (i >= w) nbs.push(i - w);
      if (i < N - w) nbs.push(i + w);
      for (const j of nbs) {
        if (!bg[j] && comp[j] < 0) {
          comp[j] = ci;
          q.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = ci;
    }
    ci++;
  }

  // ④ 轮廓层深：从 bg 出发对宠物像素 BFS 分层——只有贴近轮廓的 3 层内才参与羽化，
  //    内部阴影区颜色即使接近背景色也保持不透明（修复脸部半透明发虚）
  const depth = new Uint8Array(N); // 0=bg/其他组件，1..n=层深
  const q: number[] = [];
  for (let i = 0; i < N; i++) {
    if (bg[i]) continue;
    if (comp[i] !== best) continue;
    const x = i % w;
    const nbs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
    if (nbs.some((j) => j >= 0 && bg[j])) {
      depth[i] = 1;
      q.push(i);
    }
  }
  while (q.length) {
    const i = q.shift()!;
    if (depth[i] >= 3) continue;
    const x = i % w;
    const nbs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1];
    for (const j of nbs) {
      if (j < 0 || depth[j]) continue;
      if (bg[j] || comp[j] !== best) continue;
      depth[j] = depth[i] + 1;
      q.push(j);
    }
  }

  // ⑤ 羽化 + 去色溢（只保留最大连通域；另全局剔除绿色地面及其阴影残留）
  //    绿地面系：dist<140 + 饱和 + 色相绿区[75,178]——亮背景与阴影中的深绿地板都覆盖；
  //    项圈青蓝(hue≈190+)/金铃铛/粉蝴蝶结/橙毛/低饱和绿反光毛均不受影响
  const isGreenFloor = (o: number) => {
    const r = px[o],
      g = px[o + 1],
      b = px[o + 2];
    if (dist(r, g, b, MC) >= 140) return false;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx === 0 || (mx - mn) / mx <= SAT_T) return false;
    let hue: number;
    if (mx === g) hue = 60 * (2 + (b - r) / (mx - mn));
    else if (mx === r) hue = 60 * (((g - b) / (mx - mn) + 6) % 6);
    else hue = 60 * (4 + (r - g) / (mx - mn));
    return hue >= 75 && hue <= 178;
  };
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  for (let i = 0; i < N; i++) {
    const o = i * channels;
    if (bg[i] || comp[i] !== best || isGreenFloor(o)) {
      px[o + 3] = 0;
      continue;
    }
    const r = px[o],
      g = px[o + 1],
      b = px[o + 2];
    const d = dist(r, g, b, MC);
    let a = Math.max(0, Math.min(1, (d - 26) / 30));
    // 内部像素（离轮廓 ≥3 层）强制不透明；1-2 层按层深保底
    const dep = depth[i];
    if (dep === 0 || dep >= 3) a = 1;
    else if (dep === 2) a = Math.max(a, 0.6);
    px[o + 3] = Math.round(px[o + 3] * a);
    if (px[o + 3] < 20) px[o + 3] = 0;
    // 去色溢：半透明边缘像素绿/青占优时压回
    if (px[o + 3] > 0 && px[o + 3] < 250) {
      const cap = Math.max(r, b);
      if (g > cap) px[o + 1] = cap;
    }
    if (px[o + 3] > 24) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY || bestSize < N * 0.02) {
    console.error('EMPTY/TINY', base, bestSize);
    return;
  }
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .resize(512, 512, { fit: 'inside' })
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toFile(path.join(OUT, `${base}.png`));
  console.log('KEYED', base, `${cw}x${ch}`);
}

const files = fs
  .readdirSync(IN)
  .filter((f) => f.endsWith('.png') && fs.statSync(path.join(IN, f)).size > 20000);
console.log('files:', files.length);
for (const f of files) await key(path.join(IN, f));
console.log('DONE');
