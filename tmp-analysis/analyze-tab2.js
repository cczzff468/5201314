import fs from 'fs';
const PNG = await import('pngjs');
const { PNG: P } = PNG;
const buf = fs.readFileSync('/home/z/my-project/tmp-analysis/e2e47/wx-main-48.png');
const img = P.sync.read(buf);
// 先确定容器 y 范围：扫描每行找「非背景」的水平跨度（容器是白玻璃，比 lg-root 背景亮）
// 打印 y=150..200 每行的首尾非背景像素（背景 #ECECF1~#F4F4F8 亮度 ~236-243）
for (let y = 148; y <= 200; y += 4) {
  let first = -1, last = -1;
  for (let x = 0; x < img.width; x++) {
    const idx = (img.width * y + x) << 2;
    const lum = 0.299*img.data[idx] + 0.587*img.data[idx+1] + 0.114*img.data[idx+2];
    if (lum > 248 || lum < 200) { if (first === -1) first = x; last = x; }
  }
  console.log('y=' + y, 'first=' + first, 'last=' + last);
}
