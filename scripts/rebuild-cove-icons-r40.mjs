#!/usr/bin/env bun
/**
 * 第四十轮：Cove App 图标全链重建·四变体（机主新增两款图标、第 4 号设为默认）。
 *
 * 变体清单（设置 › 外观 图标网格四选一；APK 端 = activity-alias 桌面图标）：
 *   1 云朵 C（原版） / 2 弧 C 微笑 / 3 情书字标（暖纸底幽灵水印 Cove 字标+海浪线）
 *   4 小词灵（白底灰线 cove 小生物+对话气泡）——【默认】
 *
 * 输入：scripts/svg-r35/icon-{1,2}.svg + scripts/svg-r40/icon-{3,4}.svg（1024 矢量源）
 * 输出：
 *  - public/icons/app/icon-{N}-{192,256,512,1024}.png + icon-{N}-maskable-512.png
 *    （PWA 动态 manifest / 设置图标网格 / favicon 即时换新）
 *  - public/icons/app/apple-touch-icon.png（默认 = 4 号·小词灵）
 *  - android-shell mipmap-*：每变体 ic_launcher_N（squircle 传统）/ ic_launcher_N_round
 *    （圆形）/ ic_launcher_N_foreground（自适应前景：透明 108dp + 完整图标居中 72dp）
 *    + 默认 ic_launcher / ic_launcher_round / ic_launcher_foreground（= 4 号内容·新默认，
    存量 application android:icon 引用名不变——图标内容随默认变体切换为小词灵）
 *  - mipmap-anydpi-v26/ic_launcher_N.xml（每变体自适应图标定义）+ values/cove_icon_bgs.xml
 *    （每变体背景色——被 72dp 前景全遮，仅兜底格式要求）
 *
 * 用法：bun scripts/rebuild-cove-icons-r38.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'public/icons/app');
const RES = path.join(ROOT, 'android-shell/android/app/src/main/res');
const SRC = [
  path.join(ROOT, 'scripts/svg-r35/icon-1.svg'),
  path.join(ROOT, 'scripts/svg-r35/icon-2.svg'),
  path.join(ROOT, 'scripts/svg-r40/icon-3.svg'),
  path.join(ROOT, 'scripts/svg-r40/icon-4.svg'),
];

/** 每变体自适应背景层色（被前景 72dp 全遮，格式兜底；取图标底边近似色） */
const VARIANT_BG = { 1: '#FDFDFD', 2: '#F4F4F2', 3: '#EFEDEA', 4: '#FFFFFF' };

const squircleMask = (size, ratio = 0.22) =>
  Buffer.from(`<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * ratio)}" ry="${Math.round(size * ratio)}" fill="#fff"/></svg>`);
const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

/** hex → r/g/b（adaptive-icon 背景色 XML 用） */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

async function main() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  const png1024 = [];

  /* ---------- 1) Web 图标四套（路径不变纯替换内容；v=36 破缓存由引用侧同步） ---------- */
  for (let i = 0; i < 4; i++) {
    const id = String(i + 1);
    const buf = await sharp(SRC[i]).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
    png1024.push(buf);
    fs.writeFileSync(path.join(APP_DIR, `icon-${id}-1024.png`), buf);
    for (const size of [512, 256, 192]) {
      fs.writeFileSync(
        path.join(APP_DIR, `icon-${id}-${size}.png`),
        await sharp(buf).resize(size, size, { fit: 'cover' }).png({ quality: 90 }).toBuffer()
      );
    }
    // maskable：中央 86% 安全区 + 自体模糊铺底边缘
    const fg = await sharp(buf).resize(Math.round(512 * 0.86), Math.round(512 * 0.86), { fit: 'cover' }).png().toBuffer();
    const base = await sharp(buf).resize(512, 512, { fit: 'cover' }).blur(16).modulate({ brightness: 1.03 }).png().toBuffer();
    fs.writeFileSync(
      path.join(APP_DIR, `icon-${id}-maskable-512.png`),
      await sharp(base).composite([{ input: fg, gravity: 'center' }]).png().toBuffer()
    );
    console.log(`✓ web icon-${id} (192/256/512/1024/maskable)`);
  }
  // apple-touch（默认 4 号·小词灵——第四十轮起）
  fs.copyFileSync(path.join(APP_DIR, 'icon-4-192.png'), path.join(APP_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png (= icon-4)');

  /* ---------- 2) APK mipmap：每变体三件（squircle 传统 / 圆形 / 自适应前景） ----------
   * 自适应前景沿用第三十六轮根修口径：透明 108dp 画布 + 完整图标居中缩 72dp
   * （系统遮罩中心视区=安全区，字标全入；背景层色被前景全遮仅兜底）。 */
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [tag, scale] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    const legacy = Math.round(48 * scale);
    const fgSize = Math.round(108 * scale);
    const contentSize = Math.round(72 * scale);
    for (let i = 0; i < 4; i++) {
      const id = String(i + 1);
      const buf = png1024[i];
      // 自适应前景
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}_foreground.png`),
        await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: await sharp(buf).resize(contentSize, contentSize, { fit: 'cover' }).png().toBuffer(), gravity: 'center' }])
          .png()
          .toBuffer()
      );
      // 传统 squircle
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}.png`),
        await sharp(buf).resize(legacy, legacy, { fit: 'cover' }).composite([{ input: squircleMask(legacy), blend: 'dest-in' }]).png().toBuffer()
      );
      // 圆形
      fs.writeFileSync(
        path.join(dir, `ic_launcher_${id}_round.png`),
        await sharp(buf).resize(legacy, legacy, { fit: 'cover' }).composite([{ input: circleMask(legacy), blend: 'dest-in' }]).png().toBuffer()
      );
    }
    // 默认名（存量 manifest android:icon 引用）= 4 号内容（第四十轮：默认图标=小词灵）
    fs.copyFileSync(path.join(dir, 'ic_launcher_4_foreground.png'), path.join(dir, 'ic_launcher_foreground.png'));
    fs.copyFileSync(path.join(dir, 'ic_launcher_4.png'), path.join(dir, 'ic_launcher.png'));
    fs.copyFileSync(path.join(dir, 'ic_launcher_4_round.png'), path.join(dir, 'ic_launcher_round.png'));
    console.log(`✓ mipmap-${tag}: 4 variants × (legacy/round/foreground) + default(=4)`);
  }

  /* ---------- 3) 自适应图标 XML（anydpi-v26：每变体一条）+ 背景色资源 ---------- */
  const anyDir = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anyDir, { recursive: true });
  for (let i = 0; i < 4; i++) {
    const id = String(i + 1);
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/cove_icon_bg_${id}"/>\n    <foreground android:drawable="@mipmap/ic_launcher_${id}_foreground"/>\n</adaptive-icon>\n`;
    fs.writeFileSync(path.join(anyDir, `ic_launcher_${id}.xml`), xml);
  }
  // 每变体圆形自适应（round 引用同前景）
  for (let i = 0; i < 4; i++) {
    const id = String(i + 1);
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/cove_icon_bg_${id}"/>\n    <foreground android:drawable="@mipmap/ic_launcher_${id}_foreground"/>\n</adaptive-icon>\n`;
    fs.writeFileSync(path.join(anyDir, `ic_launcher_${id}_round.xml`), xml);
  }
  const bgColors = Object.entries(VARIANT_BG)
    .map(([id, hex]) => {
      const { r, g, b } = hexToRgb(hex);
      return `    <color name="cove_icon_bg_${id}">#${hex.replace('#', '').toUpperCase()}</color><!-- r${r} g${g} b${b} -->`;
    })
    .join('\n');
  fs.writeFileSync(
    path.join(RES, 'values/cove_icon_bgs.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- 第四十轮：四变体图标自适应背景层色（被前景 72dp 全遮，格式兜底） -->\n${bgColors}\n</resources>\n`
  );
  console.log('✓ anydpi-v26 adaptive xmls + cove_icon_bgs.xml');

  /* ---------- 4) 程序化验证：每变体前景 alpha bbox 居中（72dp 视区全含） ---------- */
  for (let i = 0; i < 4; i++) {
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
