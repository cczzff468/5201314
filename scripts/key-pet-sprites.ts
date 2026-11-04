/**
 * v6.1 宠物立绘抠图 —— raw/<id>.png → public/pets/sprite-<id>.png（透明底）
 *
 * 流程：四角自动取底色 → 加权色距软阈值抠底 → 连通域只留最大主体（去阴影孤岛）
 *       → 同色系暗部剔除（贴地软阴影）→ 3×3 alpha 羽化 → 内容 bbox 裁切 + 4% 留白 → 384² palette PNG
 * 另出 raw/preview-<id>.jpg（绿底合成）供人工目检。
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW = path.join(process.cwd(), 'raw');
const OUT = path.join(process.cwd(), 'public', 'pets');
const ids = fs
  .readdirSync(RAW)
  .filter((f) => f.endsWith('.png') && !f.startsWith('preview'))
  .map((f) => f.replace('.png', ''));

const S = 1024;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

for (const id of ids) {
  const { data, info } = await sharp(path.join(RAW, `${id}.png`)).resize(S, S).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = data;
  const at = (x: number, y: number) => (y * S + x) * 4;

  // 1) 上角取天色 + 下角取地面色（模型常给底部画地面/台面，颜色与背景不同，需双底色抠）
  const corner = (cx: number, cy: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy; y < cy + 24; y++)
      for (let x = cx; x < cx + 24; x++) {
        const i = at(x, y);
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
    return [r / n, g / n, b / n] as [number, number, number];
  };
  const tl = corner(0, 0), tr = corner(S - 24, 0);
  const bl = corner(0, S - 24), brc = corner(S - 24, S - 24);
  const br = (tl[0] + tr[0]) / 2, bg = (tl[1] + tr[1]) / 2, bb = (tl[2] + tr[2]) / 2;
  const gr = (bl[0] + brc[0]) / 2, gg = (bl[1] + brc[1]) / 2, gb = (bl[2] + brc[2]) / 2;
  const hasGround = dist0(gr, gg, gb, br, bg, bb) > 0.045;
  const bgY = 0.299 * br + 0.587 * bg + 0.114 * bb; // 天色亮度
  function dist0(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 765;
  }

  // 2) 加权色距软阈值
  const dist = (i: number, r: number, g: number, b: number) => {
    const dr = px[i] - r, dg = px[i + 1] - g, db = px[i + 2] - b;
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 765;
  };
  const alpha = new Float32Array(S * S);
  for (let p = 0; p < S * S; p++) {
    const i = p * 4;
    let d = dist(i, br, bg, bb);
    if (hasGround) d = Math.min(d, dist(i, gr, gg, gb));
    alpha[p] = smooth(0.075, 0.17, d);
  }

  // 3) 连通域（4 邻接，alpha>0.3 保住半透明接缝）：保留所有 ≥1.5% 面积的主体块
  //    （毛色接近底色时身体中部会变半透明把主体断成几块，只留最大块会丢后半身）
  const label = new Int32Array(S * S).fill(-1);
  const stack: number[] = [];
  let cur = 0;
  const size: number[] = [];
  for (let p0 = 0; p0 < S * S; p0++) {
    if (alpha[p0] <= 0.3 || label[p0] >= 0) continue;
    let sz = 0;
    stack.push(p0);
    label[p0] = cur;
    while (stack.length) {
      const p = stack.pop()!;
      sz++;
      const x = p % S, y = (p / S) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const q = ny * S + nx;
        if (alpha[q] > 0.3 && label[q] < 0) {
          label[q] = cur;
          stack.push(q);
        }
      }
    }
    size.push(sz);
    cur++;
  }
  const minKeep = S * S * 0.015;
  let kept = 0;
  for (let p = 0; p < S * S; p++) {
    const l = label[p];
    if (l >= 0 && size[l] < minKeep) alpha[p] = 0;
    else if (l >= 0) kept++;
  }

  // 4) 贴地阴影剔除：只作用在底部 28% 区域（防误吃身体上部冷调白毛），色距阈值收紧
  const rowLimit = Math.floor(S * 0.72);
  for (let p = rowLimit * S; p < S * S; p++) {
    if (alpha[p] === 0) continue;
    const i = p * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const bgMx = Math.max(br, bg, bb), bgMn = Math.min(br, bg, bb);
    const bgSat = bgMx === 0 ? 0 : (bgMx - bgMn) / bgMx;
    if (y < bgY * 0.9 && sat < Math.max(0.5, bgSat + 0.12) && dist(i, br * 0.78, bg * 0.78, bb * 0.78) < 0.1)
      alpha[p] = 0;
  }

  // 4.5) 孔洞填充：从边界 BFS 透明侧；未被波及的透明区 = 毛里误抠的封闭孔洞 → 填回不透明
  const reach = new Uint8Array(S * S);
  const st2: number[] = [];
  const pushT = (p: number) => {
    if (alpha[p] < 0.3 && !reach[p]) {
      reach[p] = 1;
      st2.push(p);
    }
  };
  for (let x = 0; x < S; x++) {
    pushT(x);
    pushT((S - 1) * S + x);
  }
  for (let y = 0; y < S; y++) {
    pushT(y * S);
    pushT(y * S + S - 1);
  }
  while (st2.length) {
    const p = st2.pop()!;
    const x = p % S, y = (p / S) | 0;
    if (x > 0) pushT(p - 1);
    if (x < S - 1) pushT(p + 1);
    if (y > 0) pushT(p - S);
    if (y < S - 1) pushT(p + S);
  }
  let filled = 0;
  for (let p = 0; p < S * S; p++)
    if (alpha[p] < 0.3 && !reach[p]) {
      alpha[p] = 1;
      filled++;
    }

  // 4.6) 内部实心化：保留下来的主体内部半透明雾（白毛里渗进的底色）拉回不透明，边缘交给羽化
  for (let p = 0; p < S * S; p++) if (alpha[p] > 0.3) alpha[p] = Math.max(alpha[p], 0.96);

  // 5) 3×3 alpha 羽化
  const a2 = new Float32Array(alpha);
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const p = y * S + x;
      a2[p] = (alpha[p] * 4 + alpha[p - 1] + alpha[p + 1] + alpha[p - S] + alpha[p + S]) / 8;
    }

  // 5.5) 去绿边（despill）：边缘半透明像素里渗入的背景绿压回 max(R,B)
  for (let p = 0; p < S * S; p++) {
    const a = a2[p];
    if (a <= 0.04 || a >= 0.92) continue;
    const i = p * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, b);
    if (g > mx) px[i + 1] = Math.round((g + mx) / 2);
  }

  // 6) 内容 bbox（alpha>0.12）+ 4% 留白裁切
  let minX = S, minY = S, maxX = 0, maxY = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (a2[y * S + x] > 0.12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  const pad = Math.round(((maxX - minX + 1) * 0.04 + (maxY - minY + 1) * 0.04) / 2);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(S - 1, maxX + pad); maxY = Math.min(S - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  // 全透明兜底（万一全被误抠）
  if (maxX <= minX || maxY <= minY) {
    console.error(`${id}: EMPTY! 跳过`);
    continue;
  }

  // 写回 RGBA（预乘关：直接原色 + alpha）
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sp = (y + minY) * S + (x + minX);
      const di = (y * cw + x) * 4, si = sp * 4;
      out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2];
      out[di + 3] = Math.round(a2[sp] * 255);
    }

  const side = 384;
  await sharp(out, { raw: { width: cw, height: ch, channels: 4 } })
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, compressionLevel: 9, quality: 100 })
    .toFile(path.join(OUT, `sprite-${id}.png`));

  // 绿底预览
  await sharp(out, { raw: { width: cw, height: ch, channels: 4 } })
    .resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: { r: 70, g: 160, b: 110 } })
    .jpeg({ quality: 88 })
    .toFile(path.join(RAW, `preview-${id}.jpg`));

  console.log(`${id}: crop ${cw}x${ch} keep ${((kept / (S * S)) * 100).toFixed(0)}% holes=${(filled / 1000).toFixed(0)}k comps=${size.filter((s) => s >= minKeep).length} → sprite-${id}.png`);
}
console.log('all done');
