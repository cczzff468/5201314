// 像素级分析：找标签栏文字的水平分布（深色像素列）
import fs from 'fs';
const PNG = await import('pngjs');
const { PNG: P } = PNG;
const buf = fs.readFileSync('/home/z/my-project/tmp-analysis/e2e47/wx-main-48.png');
const img = P.sync.read(buf);
// 标签栏 y≈156-194（容器），文字在其中部 y≈162-188
const y0 = 160, y1 = 190;
// 玻璃容器底是白色（亮度高），文字深绿/深灰（亮度低）
// 按列统计最小亮度 < 120 的像素数
const darkCols = [];
for (let x = 0; x < img.width; x++) {
  let dark = 0;
  for (let y = y0; y < y1; y++) {
    const idx = (img.width * y + x) << 2;
    const lum = 0.299 * img.data[idx] + 0.587 * img.data[idx+1] + 0.114 * img.data[idx+2];
    if (lum < 120) dark++;
  }
  darkCols.push(dark);
}
// 找文字簇：连续 dark>0 的列段
const runs = [];
let start = -1;
for (let x = 0; x < darkCols.length; x++) {
  if (darkCols[x] > 0 && start === -1) start = x;
  if ((darkCols[x] === 0 || x === darkCols.length - 1) && start !== -1) {
    const end = darkCols[x] === 0 ? x - 1 : x;
    if (end - start >= 3) runs.push({ from: start, to: end, w: end - start + 1 });
    start = -1;
  }
}
console.log('文字簇（x-from ~ x-to 宽度）:');
console.log(JSON.stringify(runs));
// 计算簇间距
const gaps = [];
for (let i = 1; i < runs.length; i++) gaps.push(runs[i].from - runs[i-1].to);
console.log('簇间空白宽度:', JSON.stringify(gaps));
