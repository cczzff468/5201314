// 裁剪主屏截图中 X论坛 图标区域并放大 2x 供 VLM 审查
import fs from 'fs';
const { PNG } = (await import('pngjs')).default ?? await import('pngjs');
const src = '/home/z/my-project/tmp-analysis/v49-24-x-forum-icon.png';
const img = PNG.sync.read(fs.readFileSync(src));
console.log('src dims:', img.width, 'x', img.height);
// X论坛 tile CSS rect: x=289 y=530 w=82 h=76 ; DPR=2 → device: x 578..742 y 1060..1212
const x0 = 560, x1 = 770, y0 = 1040, y1 = 1230;
const h = y1 - y0, w = x1 - x0, S = 2;
const out = new PNG({ width: w * S, height: h * S });
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const idx = (img.width * y + x) << 2;
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
    const oidx = ((x - x0 + dx) + (y - y0 + dy) * w * S) << 2;
    out.data[oidx] = img.data[idx]; out.data[oidx+1] = img.data[idx+1]; out.data[oidx+2] = img.data[idx+2]; out.data[oidx+3] = img.data[idx+3];
  }
}
fs.writeFileSync('/home/z/my-project/tmp-analysis/v49-26-x-forum-icon-crop.png', PNG.sync.write(out));
console.log('cropped to', out.width, 'x', out.height);
