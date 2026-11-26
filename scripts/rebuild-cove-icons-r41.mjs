#!/usr/bin/env bun
/**
 * 第四十一轮：Cove App 图标全链重建·五变体（机主：3 号情书字标换成其提供的原图，
 * 新增 5 号气泡图标，3 号设为默认；「你自己不用改」= 用户图仅等比缩放、零设计改动）。
 *
 * 变体清单（设置 › 外观 图标五选一；APK 端 = activity-alias 桌面图标）：
 *   1 云朵 C（原版 SVG）/ 2 弧 C 微笑（SVG）
 *   3 情书字标（机主原图 scripts/icon-src-r41/icon-3.jpg·Cove 字标设计稿）——【默认】
 *   4 小词灵（SVG）
 *   5 元气气泡（机主原图 scripts/icon-src-r41/icon-5.png·萌系对话气泡·新增）
 *
 * 输出：
 *  - public/icons/app/icon-{N}-{192,256,512,1024}.png + icon-{N}-maskable-512.png
 *  - public/icons/app/apple-touch-icon.png（默认 = 3 号·情书字标）
 *  - android-shell mipmap-*：每变体 ic_launcher_N / _round / _foreground（72dp 居中）
 *    + 默认 ic_launcher / _round / _foreground（= 3 号内容·新默认）
 *  - mipmap-anydpi-v26/ic_launcher_N{,_round}.xml + values/cove_icon_bgs.xml（背景色
 *    按每变体 1024 渲染图四角均值程序化取样）
 *
 * 用法：bun scripts/rebuild-cove-icons-r41.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'public/icons/app');
const RES = path.join(ROOT, 'android-shell/android/app/src/main/res');
// 5 变体源：1/2/4 矢量 SVG（既有设计不动）；3/5 机主原图（等比缩放仅此一步）
const SRC = [
  path.join(ROOT, 'scripts/svg-r35/icon-1.svg'),
  path.join(ROOT, 'scripts/svg-r35/icon-2.svg'),
  path.join(ROOT, 'scripts/icon-src-r41/icon-3.jpg'),
  path.join(ROOT, 'scripts/svg-r40/icon-4.svg'),
  path.join(ROOT, 'scripts/icon-src-r41/icon-5.png'),
];
const N = 5;
/** 每变体自适应背景层色兜底初值（3/5 由程序化取样覆盖；被前景 72dp 全遮仅格式兜底） */
const VARIANT_BG = { 1: '#FDFDFD', 2: '#F4F4F2', 3: '#F5F1EA', 4: '#FFFFFF', 5: '#FFFFFF' };

const squircleMask = (size, ratio = 0.22) =>
  Buffer.from(`<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * ratio)}" ry="${Math.round(size * ratio)}" fill="#fff"/></svg>`);
const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

/** 采样 1024 渲染图四角 12px 均值（近似底色 → 自适应图标背景层兜底色） */
async function sampleCornerBg(buf) {
  const s = 64;
  const img = sharp(buf).resize(s, s, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = await img;
  const c = info.channels;
  const pts = [
    [2, 2], [s - 3, 2], [2, s - 3], [s - 3, s - 3],
    [Math.floor(s / 2), 2], [Math.floor(s / 2), s - 3],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) {
    r += data[(y * info.width + x) * c];
    g += data[(y * info.width + x) * c + 1];
    b += data[(y * info.width + x) * c + 2];
  }
  const hex = (n) => Math.round(n / pts.length).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function main() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  const png1024 = [];

  /* ---------- 1) Web 图标五套（v=41 破缓存由引用侧同步） ---------- */
  for (let i = 0; i < N; i++) {
    const id = String(i + 1);
    // 机主原图是方形照片（1536²/1079²）：cover 等比缩放为纯降采样——内容零改动（「你自己不用改」）
    const buf = await sharp(SRC[i]).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
    png1024.push(buf);
    fs.writeFileSync(path.join(APP_DIR, `icon-${id}-1024.png`), buf);
    for (const size of [512, 256, 192]) {
      fs.writeFileSync(
        path.join(APP_DIR, `icon-${id}-${size}.png`),
        await sharp(buf).resize(size, size, { fit: 'cover' }).png({ quality: 90 }).toBuffer()
      );
    }
    // maskable：机主原图满幅方形——直接满幅 512（内容原样；安全区内即完整图）；
    // SVG 变体沿用既有 86% 居中 + 模糊铺底口径
    if (i === 2 || i === 4) {
      fs.writeFileSync(path.join(APP_DIR, `icon-${id}-maskable-512.png`), await sharp(buf).resize(512, 512, { fit: 'cover' }).png().toBuffer());
    } else {
      const fg = await sharp(buf).resize(Math.round(512 * 0.86), Math.round(512 * 0.86), { fit: 'cover' }).png().toBuffer();
      const base = await sharp(buf).resize(512, 512, { fit: 'cover' }).blur(16).modulate({ brightness: 1.03 }).png().toBuffer();
      fs.writeFileSync(path.join(APP_DIR, `icon-${id}-maskable-512.png`), await sharp(base).composite([{ input: fg, gravity: 'center' }]).png().toBuffer());
    }
    VARIANT_BG[i + 1] = await sampleCornerBg(buf);
    console.log(`✓ web icon-${id} (192/256/512/1024/maskable) bg=${VARIANT_BG[i + 1]}`);
  }
  // apple-touch（默认 3 号·情书字标——第四十一轮起）
  fs.copyFileSync(path.join(APP_DIR, 'icon-3-192.png'), path.join(APP_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png (= icon-3)');

  /* ---------- 2) APK mipmap：每变体三件（squircle / 圆形 / 自适应前景 72dp 居中） ---------- */
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [tag, scale] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    const fgSize = Math.round(108 * scale);
    const contentSize = Math.round(72 * scale);
    for (let i = 0; i < N; i++) {
      const id = String(i + 1);
      const buf = png1024[i];
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}_foreground.png`),
        await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: await sharp(buf).resize(contentSize, contentSize, { fit: 'cover' }).png().toBuffer(), gravity: 'center' }])
          .png()
          .toBuffer()
      );
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}.png`),
        await sharp(buf).resize(legacy, legacy, { fit: 'cover' }).composite([{ input: squircleMask(legacy), blend: 'dest-in' }]).png().toBuffer()
      );
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}_round.png`),
        await sharp(buf).resize(legacy, legacy, { fit: 'cover' }).composite([{ input: circleMask(legacy), blend: 'dest-in' }]).png().toBuffer()
      );
    }
    // 默认名（存量 manifest android:icon 引用）= 3 号内容（第四十一轮：默认图标=情书字标）
    fs.copyFileSync(path.join(dir, 'ic_launcher_3_foreground.png'), path.join(dir, 'ic_launcher_foreground.png'));
    fs.copyFileSync(path.join(dir, 'ic_launcher_3.png'), path.join(dir, 'ic_launcher.png'));
    fs.copyFileSync(path.join(dir, 'ic_launcher_3_round.png'), path.join(dir, 'ic_launcher_round.png'));
    console.log(`✓ mipmap-${tag}: 5 variants × (legacy/round/foreground) + default(=3)`);
  }

  /* ---------- 3) 自适应图标 XML + 背景色资源 ---------- */
  const anyDir = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anyDir, { recursive: true });
  for (let i = 0; i < N; i++) {
    const id = String(i + 1);
    for (const suffix of ['', '_round']) {
      const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/cove_icon_bg_${id}"/>\n    <foreground android:drawable="@mipmap/ic_launcher_${id}_foreground"/>\n</adaptive-icon>\n`;
      fs.writeFileSync(path.join(anyDir, `ic_launcher_${id}${suffix}.xml`), xml);
    }
  }
  const bgColors = Object.entries(VARIANT_BG)
    .map(([id, hex]) => `    <color name="cove_icon_bg_${id}">${hex.toUpperCase()}</color>`)
    .join('\n');
  fs.writeFileSync(
    path.join(RES, 'values/cove_icon_bgs.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- 第四十一轮：五变体图标自适应背景层色（被前景 72dp 全遮，格式兜底；3/5 为机主原图四角采样） -->\n${bgColors}\n</resources>\n`
  );
  console.log('✓ anydpi-v26 adaptive xmls + cove_icon_bgs.xml');

  /* ---------- 4) 程序化验证：每变体前景 alpha bbox 居中 ---------- */
  for (let i = 0; i < N; i++) {
    const id = String(i + 1);
    const { data, info } = await sharp(path.join(RES, 'mipmap-xxxhdpi', `ic_launcher_${id}_foreground.png`))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const pad = { l: minX, r: info.width - 1 - maxX, t: minY, b: info.height - 1 - maxY };
    const ok = Math.abs(pad.l - pad.r) <= 2 && Math.abs(pad.t - pad.b) <= 2;
    console.log(`✓ icon-${id} fg bbox: l${pad.l} r${pad.r} t${pad.t} b${pad.b} (${ok ? '居中 OK' : '!! 偏移'})`);
  }
  console.log('ALL DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
