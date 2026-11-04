/**
 * v6.1 蝴蝶结锚点自动校准 —— 按各品种立绘的头部位置生成 BOW_ANCHOR 表
 * 头部估计：最上排不透明像素行起，向下取 22% 高度带，带内不透明像素质心 x；
 * 输出 [x, y]（平面局部坐标，单位 = 世界高度 h；x 右正 / y 上正）
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'public', 'pets');
const ids = fs.readdirSync(DIR).filter((f) => f.startsWith('sprite-')).map((f) => f.replace('sprite-', '').replace('.png', ''));

for (const id of ids) {
  const { data, info } = await sharp(path.join(DIR, `sprite-${id}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (x: number, y: number) => (y * W + x) * 4;
  let topY = -1;
  for (let y = 0; y < H && topY < 0; y++)
    for (let x = 0; x < W; x++)
      if (data[at(x, y) + 3] > 120) { topY = y; break; }
  const bandH = Math.round(H * 0.22);
  let sx = 0, n = 0;
  for (let y = topY; y < Math.min(H, topY + bandH); y++)
    for (let x = 0; x < W; x++)
      if (data[at(x, y) + 3] > 120) { sx += x; n++; }
  const cx = sx / Math.max(1, n) / W - 0.5;
  const cy = 0.5 - (topY + H * 0.1) / H;
  console.log(`  ${id}: [${cx.toFixed(2)}, ${cy.toFixed(2)}],`);
}
