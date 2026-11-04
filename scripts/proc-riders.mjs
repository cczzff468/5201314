/**
 * 骑手形象图处理：上传的卡通 JPG（白/浅色底）→ 去底透明 PNG
 * - 边缘泛洪（BFS）：只清除与画布边缘连通的浅色低饱和像素（保留角色内部白色/浅色）
 * - 最大连通域保留：丢弃角落水印残留与孤立小杂质
 * - alpha 3x3 羽化，消除硬边/白边
 * - 裁剪到内容包围盒，输出 256x256 PNG
 * 最后拼一张地图色底校验图 /tmp/riders-check.png 供目检。
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import path from 'path';

const SRC = '/home/z/my-project/upload';
const OUT = '/home/z/my-project/public/mt/riders';
mkdirSync(OUT, { recursive: true });

const FILES = [
  ['Camera_XHS_1791370017588notes_pre_post_1040g3k8323p83iddn0ag5otmf1oq37jk2dga77g.jpg', 'r1'],
  ['Camera_XHS_1791370021086notes_pre_post_1040g3k8323p83iddn0bg5otmf1oq37jk7m9fqu8.jpg', 'r2'],
  ['Camera_XHS_1791370082176notes_pre_post_1040g3k031s85ds6dm2105pskoj1ji6cl8s7l9k8.jpg', 'r3'],
  ['Camera_XHS_1791370084523notes_pre_post_1040g3k031s85ds6dm2405pskoj1ji6cl568is78.jpg', 'r4'],
  ['Camera_XHS_1791370095468notes_pre_post_1040g3k031v3h8ka61u605q0uttf3liga1vnbho8.jpg', 'r5'],
  ['Camera_XHS_1791370174280notes_pre_post_1040g3k8321d3e6qamucg5p8rira8sh6nf87rerg.jpg', 'r6'],
  ['Camera_XHS_17913707381361040g2sg319phjasv7a3049fvo1t2e9sv1dg2qf0.jpg', 'r7'],
  ['Camera_XHS_17913707438971040g2sg319phjasv7a5049fvo1t2e9svee9vacg.jpg', 'r8'],
  ['Camera_XHS_17913707489711040g2sg319phjasv7a6g49fvo1t2e9svm6fgdu8.jpg', 'r9'],
];

const W = 360; // 工作分辨率
const isLight = (r, g, b) => Math.min(r, g, b) >= 198 && Math.max(r, g, b) - Math.min(r, g, b) <= 46;
// r4：纯白底但角色也是浅粉（软描边），需收紧阈值只清近白；r7：额外清除中灰阴影
const TIGHT = new Set(['r4']);
const isLightTight = (r, g, b) => Math.min(r, g, b) >= 243 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
const DROP_GRAY = new Set(['r7']);

async function processOne(file, name) {
  const light = TIGHT.has(name) ? isLightTight : isLight;
  const { data, info } = await sharp(path.join(SRC, file))
    .resize(W, W, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = new Uint8ClampedArray(data); // RGBA

  const idx = (x, y) => (y * w + x) * 4;
  // 1) 边缘泛洪清除浅色背景
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push([x, 0], [x, h - 1]);
  }
  for (let y = 0; y < h; y++) {
    stack.push([0, y], [w - 1, y]);
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (bg[p]) continue;
    const i = idx(x, y);
    if (px[i + 3] === 0 || light(px[i], px[i + 1], px[i + 2])) {
      bg[p] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  // 2) 连通域标记（不透明区域）
  const comp = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const boxes = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (bg[p] || comp[p] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      const q = [[x, y]];
      comp[p] = id;
      while (q.length) {
        const [cx, cy] = q.pop();
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (bg[np] || comp[np] >= 0) continue;
          comp[np] = id;
          q.push([nx, ny]);
        }
      }
      sizes.push(size);
      boxes.push([minX, minY, maxX, maxY]);
    }
  }
  // 3) 保留：最大连通域 + 与中央区相交的较大块（手边速度线等）；丢角落水印
  const keep = new Set();
  let mainId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;
  keep.add(mainId);
  for (let i = 0; i < sizes.length; i++) {
    const [minX, minY, maxX, maxY] = boxes[i];
    const cx0 = w * 0.12, cy0 = h * 0.08, cx1 = w * 0.9, cy1 = h * 0.92;
    const inter = minX <= cx1 && maxX >= cx0 && minY <= cy1 && maxY >= cy0;
    if ((inter && sizes[i] >= 60) || sizes[i] >= 500) keep.add(i);
  }
  for (let p = 0; p < w * h; p++) {
    if (!bg[p] && !keep.has(comp[p])) {
      px[idx(p % w, Math.floor(p / w)) + 3] = 0;
    } else if (bg[p]) {
      px[idx(p % w, Math.floor(p / w)) + 3] = 0;
    }
  }
  // 3.5) r7 等残留的中灰椭圆阴影（低饱和中亮灰）直接清除
  if (DROP_GRAY.has(name)) {
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (px[i + 3] === 0) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 14 && Math.min(r, g, b) >= 150 && Math.min(r, g, b) <= 246) px[i + 3] = 0;
    }
  }
  // 4) alpha 羽化（3x3 均值，仅半透明过渡）
  const alphaCopy = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alphaCopy[p] = px[p * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (alphaCopy[p] === 0) continue;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          sum += alphaCopy[(y + dy) * w + (x + dx)];
          n++;
        }
      const avg = sum / n;
      if (avg < 250) px[p * 4 + 3] = Math.min(alphaCopy[p], Math.round(avg));
    }
  }
  // 5) 内容包围盒裁剪（含 4px 边距）
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[idx(x, y) + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, `${name}.png`));
  return out;
}

const sheets = [];
for (const [file, name] of FILES) {
  await processOne(file, name);
  sheets.push(path.join(OUT, `${name}.png`));
  console.log('done', name);
}

// 校验图：3x3 拼贴，地图绿底 + 一格黄色（模拟地图），检查白边/破洞
const cell = 256, gap = 12;
const compW = cell * 3 + gap * 4, compH = cell * 3 + gap * 4;
const base = sharp({
  create: {
    width: compW,
    height: compH,
    channels: 4,
    background: { r: 0xea, g: 0xf0, b: 0xe3, alpha: 1 },
  },
});
const overlays = [];
for (let i = 0; i < 9; i++) {
  const col = i % 3, row = Math.floor(i / 3);
  overlays.push({
    input: sheets[i],
    left: gap + col * (cell + gap),
    top: gap + row * (cell + gap),
  });
}
await base.composite(overlays).png().toFile('/tmp/riders-check.png');
console.log('check sheet -> /tmp/riders-check.png');
