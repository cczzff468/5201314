// 修复机主上传的 3 张 App 图标：去豆包水印 + 四周去留白（squircle 满幅）
// 用法：bun scripts/fix-app-icons.mjs          （AI 修图 + sharp 蒙版后处理）
//      bun scripts/fix-app-icons.mjs --crop   （仅确定性裁剪兜底路径）
import ZAI from 'z-ai-web-dev-sdk';
import sharp from 'sharp';
import fs from 'fs';

const OUT_DIR = 'public/icons/app';
const SRC = [
  { id: 1, file: 'upload/share_1795587374556.png', name: '纯白压印 cove' },
  { id: 2, file: 'upload/1795587529093.png', name: 'C 对话气泡' },
  { id: 3, file: 'upload/1795587535609.png', name: '星光气泡 cove' },
];

const EDIT_PROMPT =
  'App icon cleanup. Remove the small watermark text in the bottom right corner completely, ' +
  'as if it never existed. Crop the image tight so the rounded-square squircle app icon plate ' +
  'fills the ENTIRE canvas edge to edge — no surrounding background, no margins, no padding of any kind. ' +
  'Keep the icon design itself exactly the same: same embossed graphics, same lettering, same colors, ' +
  'same soft neumorphism style, same rounded corners. Only remove the outer background and the watermark.';

/** iOS 超椭圆蒙版（SVG 圆角矩形，半径 23%——与三张图标的圆角比例一致） */
function squircleMask(size) {
  const r = Math.round(size * 0.23);
  const svg = `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`;
  return Buffer.from(svg);
}

/** 确定性兜底裁剪：质量阈值 bbox（含阴影）→ 中心对称方形 → 蒙版 */
async function deterministicCrop(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const bg = [data[0], data[1], data[2]];
  const colMass = new Array(W).fill(0);
  const rowMass = new Array(H).fill(0);
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * C;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (d > 30) { colMass[x] += 2; rowMass[y] += 2; }
    }
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let x = 0; x < W; x++) if (colMass[x] > H * 0.15) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  for (let y = 0; y < H; y++) if (rowMass[y] > W * 0.15) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // 方形边长：min(w,h)×0.96，保证四边都落在盘面内（宁裁进盘面也不留背景环）
  const side = Math.floor(Math.min(maxX - minX, maxY - minY) * 0.96);
  const left = Math.round(cx - side / 2), top = Math.round(cy - side / 2);
  return { left: Math.max(0, left), top: Math.max(0, top), width: side, height: side };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cropOnly = process.argv.includes('--crop');
  const zai = cropOnly ? null : await ZAI.create().catch(() => null);

  for (const { id, file } of SRC) {
    const out1024 = `${OUT_DIR}/icon-${id}-1024.png`;
    let ok = false;

    // 路径 A：AI 修图（去水印 + 满幅）
    if (zai) {
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const b64 = fs.readFileSync(file).toString('base64');
          const res = await zai.images.generations.edit({
            prompt: EDIT_PROMPT,
            images: [{ url: `data:image/png;base64,${b64}` }],
            size: '1024x1024',
          });
          const buf = Buffer.from(res.data[0].base64, 'base64');
          // sharp 后处理：蒙版圆角 + 规范化（RGBA PNG）
          await sharp(buf)
            .resize(1024, 1024, { fit: 'cover' })
            .composite([{ input: squircleMask(1024), blend: 'dest-in' }])
            .png()
            .toFile(out1024);
          ok = true;
          console.log(`[icon-${id}] AI 修图完成`);
        } catch (e) {
          console.log(`[icon-${id}] AI 尝试 ${attempt + 1} 失败: ${String(e).slice(0, 120)}`);
        }
      }
    }

    // 路径 B：确定性裁剪（AI 不可用 / 失败兜底）
    if (!ok) {
      const rect = await deterministicCrop(file);
      await sharp(file)
        .extract(rect)
        .resize(1024, 1024)
        .composite([{ input: squircleMask(1024), blend: 'dest-in' }])
        .png()
        .toFile(out1024);
      console.log(`[icon-${id}] 确定性裁剪完成`, JSON.stringify(rect));
    }
  }

  // 统一派生尺寸（预览 256 + PWA 512/192 + maskable）
  for (const { id } of SRC) {
    const src = `${OUT_DIR}/icon-${id}-1024.png`;
    await sharp(src).resize(512, 512).png().toFile(`${OUT_DIR}/icon-${id}-512.png`);
    await sharp(src).resize(192, 192).png().toFile(`${OUT_DIR}/icon-${id}-192.png`);
    await sharp(src).resize(256, 256).png().toFile(`${OUT_DIR}/icon-${id}-256.png`);
    // maskable：内容缩到 78% 安全区 + 底色铺满（浅珍珠白，与图标底板同族）
    await sharp(src)
      .resize(798, 798)
      .extend({ top: 113, bottom: 113, left: 113, right: 113, background: '#EDEDEF' })
      .resize(512, 512)
      .png()
      .toFile(`${OUT_DIR}/icon-${id}-maskable-512.png`);
  }
  console.log('派生尺寸完成');
}
main();
