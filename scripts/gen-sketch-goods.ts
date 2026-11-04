/**
 * 简笔画样式商品图生成（第六十四轮）：
 *
 * 把 public/goods/*.webp（kawaii 彩色插画）批量转成「简笔画」风格线稿：
 *   灰度 → 亮度阈值二值化（深色描边/深色填充→黑线黑块，浅底→白）→ 黑像素膨胀加粗
 * 输出 public/goods-sketch/*.webp（同名文件一一对应，TbImg/FoodImg 按用户样式设置切换目录）。
 *
 * 风格对标用户参考图（黑白粗线稿简笔画：白底黑线 + 局部黑填充）。
 * 参数：thr=118（描边棕 ~90 / 珍珠深棕 ~60 判黑；奶茶液 ~185 / 粉彩底 ~243 判白，分离干净）
 *      dilate=1（线条加粗 1px，手绘粗线稿质感）
 *
 * 用法：node scripts/gen-sketch-goods.ts（增量：输出已存在且新于源图时跳过）
 */
import { readdir, stat, mkdir } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

const SRC_DIR = 'public/goods';
const OUT_DIR = 'public/goods-sketch';
const THR = 118;
const DILATE = 1;

async function sketchOf(inp: string, out: string): Promise<void> {
  const { data, info } = await sharp(inp).grayscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let cur = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cur[i] = data[i] < THR ? 0 : 255; // 暗→黑线/黑块，亮→白底
  for (let d = 0; d < DILATE; d++) {
    const nx = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i] === 0) continue; // 已是黑像素不处理
        // 白像素相邻黑 → 膨胀成黑（线条加粗 1px/轮）
        if (
          (x > 0 && cur[i - 1] === 0) ||
          (x < w - 1 && cur[i + 1] === 0) ||
          (y > 0 && cur[i - w] === 0) ||
          (y < h - 1 && cur[i + w] === 0)
        )
          nx[i] = 0;
      }
    }
    cur = nx;
  }
  await sharp(Buffer.from(cur), { raw: { width: w, height: h, channels: 1 } })
    .webp({ quality: 90 })
    .toFile(out);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.webp')).sort();
  let done = 0;
  let skip = 0;
  for (const f of files) {
    const src = join(SRC_DIR, f);
    const out = join(OUT_DIR, f);
    try {
      const [ss, os] = await Promise.all([stat(src), stat(out).catch(() => null)]);
      if (os && os.mtimeMs >= ss.mtimeMs) {
        skip++;
        continue;
      }
    } catch {
      // stat 失败按需重生成
    }
    await sketchOf(src, out);
    done++;
  }
  console.log(`[gen-sketch-goods] 共 ${files.length} 张：新生成 ${done}，跳过 ${skip}`);
}

void main();
