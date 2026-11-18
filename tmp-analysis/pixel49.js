// 像素级圆角测量：扫描元素顶行/底行首个填充像素的横向内缩量（≈圆角半径在顶行的投影）
import fs from 'fs';
const PNG = await import('pngjs').default ?? await import('pngjs');
const { PNG: P } = PNG;
const img = P.sync.read(fs.readFileSync('/home/z/my-project/tmp-analysis/e2e49/16-wx-rainbow-pixel.png'));

const els = [
  { name: 'bubble-f2-peer', x: 58, y: 233, w: 79, h: 42 },
  { name: 'panel-f2', x: 58, y: 280, w: 384, h: 113 },
  { name: 'bubble-f3-mine', x: 368, y: 445, w: 74, h: 42 },
  { name: 'panel-f3', x: 58, y: 492, w: 384, h: 67 },
];

const px = (x, y) => { const i = (img.width * y + x) << 2; return [img.data[i], img.data[i+1], img.data[i+2]]; };
const close = (a, b, tol) => Math.abs(a[0]-b[0]) <= tol && Math.abs(a[1]-b[1]) <= tol && Math.abs(a[2]-b[2]) <= tol;

for (const el of els) {
  // 参考填充色：元素中心行中点
  const ref = px(el.x + Math.floor(el.w / 2), el.y + Math.floor(el.h / 2));
  const tol = 26;
  const scanRow = (y) => {
    let insetL = -1;
    for (let x = el.x; x < el.x + el.w; x++) { if (close(px(x, y), ref, tol)) { insetL = x - el.x; break; } }
    let insetR = -1;
    for (let x = el.x + el.w - 1; x >= el.x; x--) { if (close(px(x, y), ref, tol)) { insetR = el.x + el.w - 1 - x; break; } }
    return { insetL, insetR };
  };
  const top = scanRow(el.y + 1);      // 顶缘内 1px
  const top2 = scanRow(el.y + 3);     // 顶缘内 3px
  const bot = scanRow(el.y + el.h - 2); // 底缘内 1px
  const bot2 = scanRow(el.y + el.h - 4);
  console.log(`${el.name}: ref=rgb(${ref}) topRow+1 L=${top.insetL} R=${top.insetR} | topRow+3 L=${top2.insetL} R=${top2.insetR} | botRow-1 L=${bot.insetL} R=${bot.insetR} | botRow-3 L=${bot2.insetL} R=${bot2.insetR}`);
}
