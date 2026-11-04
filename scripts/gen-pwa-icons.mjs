/**
 * 从用户上传的小熊图生成 PWA 图标全套：
 * - 192/512 标准 icon + maskable（内容缩到 80% 留安全区，白底）
 * - 180 apple-touch-icon
 * 源图近白底，与 iOS 风格一致；输出到 public/icons/pwa/
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = '/home/z/my-project/upload/1792971687602.png';
const OUT = '/home/z/my-project/public/icons/pwa';
mkdirSync(OUT, { recursive: true });

async function make(size, name, opts = {}) {
  const { pad = 0 } = opts;
  const inner = Math.round(size * (1 - pad * 2));
  const img = sharp(SRC).resize(inner, inner, { fit: 'cover' });
  const buf = await img.png().toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: buf, left: Math.round(size * pad), top: Math.round(size * pad) }])
    .png()
    .toFile(`${OUT}/${name}`);
  console.log(`ok ${name} ${size}x${size}`);
}

await make(192, 'icon-192.png');
await make(512, 'icon-512.png');
await make(512, 'maskable-512.png', { pad: 0.1 });
await make(180, 'apple-touch-icon.png');
console.log('ALL DONE');
