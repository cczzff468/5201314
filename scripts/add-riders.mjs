/**
 * 新增骑手形象 r18-r22：上传的卡通 JPG → 去底透明 PNG（复用 proc-riders 思路）
 * - 先按手调矩形预裁（剔除画面内标语/水印/气泡等无关元素）
 * - 边缘泛洪（BFS）：只清除与画布边缘连通的浅色低饱和背景（保留角色内部白色）
 * - 最大连通域 + 中央区大块保留，孤立漂浮杂物（气泡尾巴/碎云/水印）按尺寸阈值丢弃
 * - alpha 3x3 羽化去白边，裁内容包围盒，输出 256x256 PNG
 * 产出校验拼图 /tmp/riders2-check.png 供目检。
 */
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import path from 'path';

const SRC = '/home/z/my-project/upload';
const OUT = '/home/z/my-project/public/mt/riders';
mkdirSync(OUT, { recursive: true });

// [源文件, 输出名, 预裁 {left,top,width,height}]
const FILES = [
  // 棕熊+蓝绿头盔骑黄摩托（右侧「配送中···」竖排标语、左下碎云剔除）
  ['Camera_XHS_17913799073771040g2sg312ni9uihio705pd7mbh20mtt6hjgr0o.jpg', 'r18', { left: 220, top: 110, width: 910, height: 1200 }],
  // 白兔+黄头盔+美团外卖箱（全身完整）
  ['Camera_XHS_179137995267603029r01kmcbimb0bku010hdcxr0kl5j5s.jpg', 'r19', { left: 380, top: 260, width: 870, height: 990 }],
  // 粉色哭哭熊骑手（肖像裁切，底部 9% 水印带剔除）
  ['Camera_XHS_17913760518291040g008316i08lfp0s3g5oscbr891ed79983mm0.jpg', 'r20', { left: 0, top: 0, width: 960, height: 868 }],
  // 蓝色猫咪骑手（肖像裁切，底部 9% 水印带剔除）
  ['Camera_XHS_17913760494161040g008316i08lfp0s5g5oscbr891ed7vtshorg.jpg', 'r21', { left: 0, top: 0, width: 960, height: 868 }],
  // 绵羊骑手坐在路边吃汉堡（地图底+对话气泡剔除，只留角色一群）
  ['Camera_XHS_1791380017832spectrum_1040g34o31ksmmrv72a605pttj3njlhd7tmn36vo.jpg', 'r22', { left: 300, top: 500, width: 850, height: 730 }],
];

const W = 360;
// 用户需求：咻咻r19/哭哭r20/咪咪r21 朝左 → 水平镜像成朝右
const FLIP_TO_RIGHT = new Set(['r19', 'r20', 'r21']);
const isLight = (r, g, b) => Math.min(r, g, b) >= 198 && Math.max(r, g, b) - Math.min(r, g, b) <= 46;
// r20/r21 奶油黄底（#F7EDCB 类，饱和度略高）：放宽阈值才能认成背景；角色白脸有黑描边包围，不受影响
const LOOSE = new Set(['r20', 'r21']);
const isLightLoose = (r, g, b) => Math.min(r, g, b) >= 178 && Math.max(r, g, b) - Math.min(r, g, b) <= 70;

async function processOne(file, name, crop) {
  const light = LOOSE.has(name) ? isLightLoose : isLight;
  const { data, info } = await sharp(path.join(SRC, file))
    .extract(crop)
    .resize(W, W, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = new Uint8ClampedArray(data);
  const idx = (x, y) => (y * w + x) * 4;

  // 1) 边缘泛洪清除浅色背景
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
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
  // 2) 连通域（不透明区域）
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
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
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
  // 3) 保留主连通域 + 中央区且足够大的块（阈值提高到 800，滤掉气泡尾/碎云/水印残渣）
  const keep = new Set();
  let mainId = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;
  keep.add(mainId);
  for (let i = 0; i < sizes.length; i++) {
    const [minX, minY, maxX, maxY] = boxes[i];
    const cx0 = w * 0.14, cy0 = h * 0.05, cx1 = w * 0.9, cy1 = h * 0.95;
    const inter = minX <= cx1 && maxX >= cx0 && minY <= cy1 && maxY >= cy0;
    if (inter && sizes[i] >= 800) keep.add(i);
  }
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (bg[p] || !keep.has(comp[p])) px[i + 3] = 0;
  }
  // 4) alpha 3x3 羽化
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
  // 5) 内容包围盒裁剪（4px 边距）→ 256x256
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[idx(x, y) + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (minX > maxX || minY > maxY) throw new Error(`${name}: 全空`);
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .flop(FLIP_TO_RIGHT.has(name))
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, `${name}.png`));
  console.log('done', name);
}

const sheets = [];
for (const [file, name, crop] of FILES) {
  await processOne(file, name, crop);
  sheets.push(path.join(OUT, `${name}.png`));
}

// 校验拼图：地图绿底 + 角落黄块（模拟地图黄路线），检查白边与破洞
const cell = 256, gap = 12;
const compW = cell * 3 + gap * 4, compH = cell * 2 + gap * 3;
const base = sharp({ create: { width: compW, height: compH, channels: 4, background: { r: 0xea, g: 0xf0, b: 0xe3, alpha: 1 } } });
const overlays = sheets.map((s, i) => ({ input: s, left: gap + (i % 3) * (cell + gap), top: gap + Math.floor(i / 3) * (cell + gap) }));
// 第六格（右下角）垫黄块，检视骑手压在黄路线上的观感
overlays.push({ input: await sharp({ create: { width: cell, height: cell, channels: 4, background: { r: 0xff, g: 0xd8, b: 0x66, alpha: 1 } } }).png().toBuffer(), left: gap + 2 * (cell + gap), top: gap + cell + gap });
await base.composite(overlays).png().toFile('/tmp/riders2-check.png');
console.log('check -> /tmp/riders2-check.png');
