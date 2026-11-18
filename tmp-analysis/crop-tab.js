// 裁剪 wx-main-48.png 顶部分类标签栏区域放大
import fs from 'fs';
const PNG = await import('pngjs').default ?? await import('pngjs');
const { PNG: P } = PNG;
const buf = fs.readFileSync('/home/z/my-project/tmp-analysis/e2e47/wx-main-48.png');
const img = P.sync.read(buf);
// 截图 500x844（视口 500）；标签栏 y≈156-194 → 取 y 140-210 全宽
const y0 = 140, y1 = 215, x0 = 0, x1 = img.width;
const h = y1 - y0;
const out = new P({ width: x1 - x0, height: h });
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const idx = (img.width * y + x) << 2;
  const oidx = ((x - x0) + (y - y0) * (x1 - x0)) << 2;
  out.data[oidx] = img.data[idx]; out.data[oidx+1] = img.data[idx+1]; out.data[oidx+2] = img.data[idx+2]; out.data[oidx+3] = img.data[idx+3];
}
fs.writeFileSync('/home/z/my-project/upload/wx-tabbar-crop.png', P.sync.write(out));
console.log('cropped', out.width, 'x', out.height, 'from', img.width, 'x', img.height);
