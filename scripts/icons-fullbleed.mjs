// 第二遍：把已去水印的图标「满幅化」——盘面放大到铺满画布（iOS App 图标文件规格）
import ZAI from 'z-ai-web-dev-sdk';
import sharp from 'sharp';
import fs from 'fs';

const PROMPT =
  'Produce a finished iOS app icon file. Scale UP the light rounded-square squircle plate so it ' +
  'completely fills the entire 1024x1024 canvas edge-to-edge on all four sides: the plate outer ' +
  'boundary must touch and run along all four canvas edges (top, bottom, left, right), corners may ' +
  'be cropped by the canvas. Absolutely NO background margin, NO border, NO white frame, NO padding ' +
  'around the plate. Keep the embossed design, lettering, colors and soft style on the plate unchanged. ' +
  'The result looks like a close-up screenshot of just the app icon itself.';

function squircleMask(size) {
  const r = Math.round(size * 0.23);
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
}

async function main() {
  const zai = await ZAI.create();
  for (const id of [1, 2, 3]) {
    const src = `public/icons/app/icon-${id}-1024.png`;
    const out = `/tmp/icon-${id}-full.png`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const b64 = fs.readFileSync(src).toString('base64');
        const res = await zai.images.generations.edit({
          prompt: PROMPT,
          images: [{ url: `data:image/png;base64,${b64}` }],
          size: '1024x1024',
        });
        const buf = Buffer.from(res.data[0].base64, 'base64');
        // 蒙版规范化：dest-in 圆角（AI 输出的四角被画布裁掉是预期）
        await sharp(buf)
          .resize(1024, 1024, { fit: 'cover' })
          .composite([{ input: squircleMask(1024), blend: 'dest-in' }])
          .png()
          .toFile(out);
        ok = true;
        console.log(`[icon-${id}] 满幅化完成`);
      } catch (e) {
        console.log(`[icon-${id}] 尝试 ${attempt + 1} 失败: ${String(e).slice(0, 100)}`);
      }
    }
    if (ok) fs.copyFileSync(out, src);
  }
  // 重派生
  for (const id of [1, 2, 3]) {
    const src = `public/icons/app/icon-${id}-1024.png`;
    await sharp(src).resize(512, 512).png().toFile(`public/icons/app/icon-${id}-512.png`);
    await sharp(src).resize(192, 192).png().toFile(`public/icons/app/icon-${id}-192.png`);
    await sharp(src).resize(256, 256).png().toFile(`public/icons/app/icon-${id}-256.png`);
    await sharp(src)
      .resize(798, 798)
      .extend({ top: 113, bottom: 113, left: 113, right: 113, background: '#EDEDEF' })
      .resize(512, 512)
      .png()
      .toFile(`public/icons/app/icon-${id}-maskable-512.png`);
  }
  console.log('派生完成');
}
main();
