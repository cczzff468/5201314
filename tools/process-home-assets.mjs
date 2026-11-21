/**
 * 情侣小家素材后处理 v3：蓝幕键控（洪泛 + 边框簇双约束）
 *
 * v2 教训：只用「局部连续性」洪泛，物体内平滑渐变被穿透（ghost 化）。
 * v3 双约束：邻像素并入背景需同时满足——
 *   ① 与来源像素色距 < T_LOCAL（16，跟随背景渐变漂移）
 *   ② 与「边框簇中心」色距 < T_GLOBAL（64，蓝幕正交性兜底：奶油/木色/粉色/绿植
 *      距蓝都很远，即使物体边缘再软也不可能被吞）
 * 边缘羽化 + 对背景色去预乘，消除蓝晕；裁切 → lanczos → WebP(alpha)。
 *
 * 用法：bun tools/process-home-assets.mjs
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('tools/assets-raw');
const OUT_F = path.resolve('public/home/furniture');
const OUT_C = path.resolve('public/home/chars');
const DIMS_FILE = path.resolve('tools/assets-dims.json');

const T_LOCAL = 16;
const T_GLOBAL = 64;
const A_ZERO = 22;
const A_FULL = 55;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

async function keyBackground(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;

  // ---- 边框簇中心（四边采样均值；背景基本单色族） ----
  let br = 0, bg = 0, bb = 0, bn = 0;
  const ring = (x, y) => { const i = (y * w + x) * 4; br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++; };
  for (let x = 0; x < w; x += 3) { ring(x, 0); ring(x, 1); ring(x, h - 1); ring(x, h - 2); }
  for (let y = 0; y < h; y += 3) { ring(0, y); ring(1, y); ring(w - 1, y); ring(w - 2, y); }
  br /= bn; bg /= bn; bb /= bn;

  const dist2bg = (r, g, b) => Math.sqrt((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2);

  // ---- 洪泛（双约束） ----
  const inBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const push = (x, y) => { const p = y * w + x; if (!inBg[p]) { inBg[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { push(0, y); push(w - 1, y); }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w, y = (p / w) | 0;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const tryN = (nx, ny) => {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return;
      const np = ny * w + nx;
      if (inBg[np]) return;
      const ni = np * 4;
      const nr = data[ni], ng = data[ni + 1], nb = data[ni + 2];
      const localOk = Math.sqrt((nr - r) ** 2 + (ng - g) ** 2 + (nb - b) ** 2) < T_LOCAL;
      const globalOk = dist2bg(nr, ng, nb) < T_GLOBAL;
      if (localOk && globalOk) { inBg[np] = 1; queue[qt++] = np; }
    };
    tryN(x - 1, y); tryN(x + 1, y); tryN(x, y - 1); tryN(x, y + 1);
  }

  let bgCount = 0;
  for (let p = 0; p < w * h; p++) if (inBg[p]) bgCount++;
  const bgRatio = bgCount / (w * h);

  // ---- 边缘羽化 + 去预乘 ----
  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) {
    if (inBg[p]) { out[p * 4 + 3] = 0; out[p * 4] = 0; out[p * 4 + 1] = 0; out[p * 4 + 2] = 0; continue; }
    const x = p % w, y = (p / w) | 0;
    let nearBg = false, brn = 0, bgn = 0, bbn = 0, bc = 0;
    for (let dy = -2; dy <= 2 && !nearBg; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const np = ny * w + nx;
        if (inBg[np]) {
          const ni = np * 4;
          brn += data[ni]; bgn += data[ni + 1]; bbn += data[ni + 2]; bc++;
          nearBg = true;
        }
      }
    }
    if (!nearBg || !bc) continue;
    brn /= bc; bgn /= bc; bbn /= bc;
    const i = p * 4;
    const d = Math.sqrt((data[i] - brn) ** 2 + (data[i + 1] - bgn) ** 2 + (data[i + 2] - bbn) ** 2);
    const a = smoothstep(A_ZERO, A_FULL, d);
    if (a <= 0) { out[i + 3] = 0; out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; }
    else if (a < 1) {
      out[i] = Math.max(0, Math.min(255, Math.round((data[i] - (1 - a) * brn) / a)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - (1 - a) * bgn) / a)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - (1 - a) * bbn) / a)));
      out[i + 3] = Math.round(a * 255);
    }
  }

  let transCount = 0;
  for (let p = 0; p < w * h; p++) if (out[p * 4 + 3] < 128) transCount++;
  const transRatio = transCount / (w * h);

  // ---- 裁切框 ----
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (out[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 4;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const cw = Math.min(w - left, maxX - minX + pad * 2);
  const chh = Math.min(h - top, maxY - minY + pad * 2);

  return { data: out, width: w, height: h, left, top, w: cw, h: chh, bgRatio, transRatio };
}

async function processOne(file, isChar) {
  const dir = isChar ? 'chars' : 'furniture';
  const input = path.join(RAW, dir, file);
  if (!fs.existsSync(input)) return null;
  const keyed = await keyBackground(input);
  if (!keyed) return { file, status: 'empty' };

  let status = 'ok';
  if (keyed.bgRatio > 0.9) status = 'leak';
  else if (keyed.transRatio < 0.05) status = 'nokey';

  const outName = file.replace('.png', '.webp');
  const outDir = isChar ? OUT_C : OUT_F;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);
  await sharp(keyed.data, { raw: { width: keyed.width, height: keyed.height, channels: 4 } })
    .extract({ left: keyed.left, top: keyed.top, width: keyed.w, height: keyed.h })
    .resize({ width: isChar ? undefined : 640, height: isChar ? 620 : 560, fit: 'inside', kernel: 'lanczos3' })
    .webp({ quality: 92, effort: 5, alphaQuality: 100 })
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  return {
    file, status,
    bgRatio: +keyed.bgRatio.toFixed(3),
    transRatio: +keyed.transRatio.toFixed(3),
    w: meta.width, h: meta.height, hasAlpha: meta.hasAlpha,
    kb: +(fs.statSync(outPath).size / 1024).toFixed(1),
  };
}

async function main() {
  const results = [];
  const files = [];
  for (const f of fs.readdirSync(path.join(RAW, 'furniture'))) if (f.endsWith('.png')) files.push([f, false]);
  for (const f of fs.readdirSync(path.join(RAW, 'chars'))) if (f.endsWith('.png')) files.push([f, true]);

  for (const d of [OUT_F, OUT_C]) {
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.png')) fs.unlinkSync(path.join(d, f));
  }

  for (const [file, isChar] of files) {
    const r = await processOne(file, isChar);
    if (r && r.status !== 'empty') {
      results.push(r);
      console.log(
        `${r.status.padEnd(5)} ${file.padEnd(20)} ${r.w}x${r.h} alpha=${r.hasAlpha ? 'Y' : 'N!'} ${r.kb}KB bg=${r.bgRatio} trans=${r.transRatio}`,
      );
    }
  }
  const dims = {};
  for (const r of results) dims[r.file.replace('.png', '.webp')] = { w: r.w, h: r.h };
  fs.writeFileSync(DIMS_FILE, JSON.stringify(dims, null, 2));

  const bad = results.filter((r) => r.status !== 'ok' || !r.hasAlpha);
  const totalKb = results.reduce((s, r) => s + r.kb, 0);
  console.log(`\nDONE ${results.length} 张 共 ${(totalKb / 1024).toFixed(1)}MB；异常 ${bad.length}${bad.length ? '：' + bad.map((b) => `${b.file}(${b.status})`).join(', ') : ''}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
