import fs from 'fs';
const PNG = await import('pngjs').default ?? await import('pngjs');
const { PNG: P } = PNG;
const img = P.sync.read(fs.readFileSync('/home/z/my-project/tmp-analysis/e2e49/16-wx-rainbow-pixel.png'));
const px = (x, y) => { const i = (img.width * y + x) << 2; return [img.data[i], img.data[i+1], img.data[i+2]]; };
const close = (a, b, tol) => Math.abs(a[0]-b[0]) <= tol && Math.abs(a[1]-b[1]) <= tol && Math.abs(a[2]-b[2]) <= tol;

// bubble-f2 (peer, 58,233,79,42): 对方气泡内容靠左，右侧空白取参考色
const el = { x: 58, y: 233, w: 79, h: 42 };
const ref = px(el.x + el.w - 10, el.y + Math.floor(el.h / 2));
console.log('ref(右侧空白):', ref.join(','));
const scanRow = (y) => {
  let insetL = -1, insetR = -1;
  for (let x = el.x; x < el.x + el.w; x++) { if (close(px(x, y), ref, 26)) { insetL = x - el.x; break; } }
  for (let x = el.x + el.w - 1; x >= el.x; x--) { if (close(px(x, y), ref, 26)) { insetR = el.x + el.w - 1 - x; break; } }
  return { insetL, insetR };
};
for (const d of [1, 2, 3, 4, 5, 6]) {
  const t = scanRow(el.y + d);
  const b = scanRow(el.y + el.h - 1 - d);
  console.log(`depth+${d}: top L=${t.insetL} R=${t.insetR} | bottom L=${b.insetL} R=${b.insetR}`);
}
