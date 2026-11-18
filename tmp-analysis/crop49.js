// 裁剪 e2e49 截图的语音气泡+转写面板区域并放大 2x 供 VLM 审查
import fs from 'fs';
const PNG = await import('pngjs').default ?? await import('pngjs');
const { PNG: P } = PNG;

const [file, y0, y1, tag] = process.argv.slice(2);
const buf = fs.readFileSync(`/home/z/my-project/tmp-analysis/e2e49/${file}`);
const img = P.sync.read(buf);
const x0 = 0, x1 = img.width;
const h = y1 - y0, w = x1 - x0;
const S = 2;
const out = new P({ width: w * S, height: h * S });
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const idx = (img.width * y + x) << 2;
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
    const oidx = ((x - x0 + dx) + (y - y0 + dy) * w * S) << 2;
    out.data[oidx] = img.data[idx]; out.data[oidx+1] = img.data[idx+1]; out.data[oidx+2] = img.data[idx+2]; out.data[oidx+3] = img.data[idx+3];
  }
}
fs.writeFileSync(`/home/z/my-project/upload/${tag}.png`, P.sync.write(out));
console.log('cropped', out.width, 'x', out.height, 'from', file);
