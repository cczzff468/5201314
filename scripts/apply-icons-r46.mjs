// 第四十六轮：机主上传图标落位——阅读（山丘阅读蓝底书本）+ 审核（灰底盾形对勾）
import sharp from 'sharp';
import fs from 'fs';

const SRC_READING = '/home/z/my-project/upload/山丘阅读－本地离线电子书阅读器-iOS-1024x1024.png';
const SRC_REVIEW = '/home/z/my-project/upload/IMG_20261127_145106.png';

async function makeIcon(src, dst, size = 256) {
  const buf = await sharp(src).resize(size, size, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  fs.writeFileSync(dst, buf);
  console.log(dst, (buf.length / 1024).toFixed(1) + 'KB');
}

await makeIcon(SRC_READING, '/home/z/my-project/public/icons/reading.png');
await makeIcon(SRC_REVIEW, '/home/z/my-project/public/icons/review.png');
