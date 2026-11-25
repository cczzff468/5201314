#!/usr/bin/env bun
/**
 * 第三十二轮：Cove App 图标全链重建（韩系灰白 AI 生成稿 → 全尺寸 Web 图标 + APK 原生素材）。
 *
 * 输入：/tmp/newicons/gen-{1b,2b,3b}.png（1024×1024 AI 生成）
 * 输出：
 *  - public/icons/app/icon-{N}-{192,256,512,1024}.png + icon-{N}-maskable-512.png（PWA/设置三选一/开屏）
 *  - public/icons/app/apple-touch-icon.png（默认 = 1 号）
 *  - android-shell mipmap-*（自适应前景/传统方/圆）+ values/ic_launcher_background.xml 背景色
 *  - android-shell 各 drawable 目录 splash.png（冷启动灰白 Cove 闪屏：图标 + wordmark）
 *
 * 用法：bun scripts/rebuild-cove-icons.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'public/icons/app');
const RES = path.join(ROOT, 'android-shell/android/app/src/main/res');
const SRC = ['/tmp/newicons/gen-1b.png', '/tmp/newicons/gen-2b.png', '/tmp/newicons/gen-3b.png'];

/** 冷灰白底（与自适应背景一致，冷调非奶油） */
const BG = '#EFEFED';
/** wordmark 灰 */
const INK = '#4A4A48';

const SVG_SQUIRCLE = (size, radiusRatio = 0.22) =>
  Buffer.from(`<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * radiusRatio)}" ry="${Math.round(size * radiusRatio)}" fill="#fff"/></svg>`);

async function main() {
  fs.mkdirSync(APP_DIR, { recursive: true });

  /* ---------- 1) Web 图标（三选一路径不变，纯替换内容） ---------- */
  for (let i = 0; i < 3; i++) {
    const id = String(i + 1);
    const src = SRC[i];
    const buf = await sharp(src).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(path.join(APP_DIR, `icon-${id}-1024.png`), buf);
    for (const size of [512, 256, 192]) {
      fs.writeFileSync(
        path.join(APP_DIR, `icon-${id}-${size}.png`),
        await sharp(buf).resize(size, size, { fit: 'cover' }).png({ quality: 90 }).toBuffer()
      );
    }
    // maskable：模糊放大自体铺底 + 中央 82% 安全区（任意遮罩裁切不丢主体）
    const base = await sharp(buf).resize(512, 512, { fit: 'cover' }).blur(18).modulate({ brightness: 1.02 }).png().toBuffer();
    const fg = await sharp(buf).resize(Math.round(512 * 0.82), Math.round(512 * 0.82), { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(
      path.join(APP_DIR, `icon-${id}-maskable-512.png`),
      await sharp(base).composite([{ input: fg, gravity: 'center' }]).png().toBuffer()
    );
    console.log(`✓ web icon-${id} (192/256/512/1024/maskable)`);
  }
  // apple-touch（默认 1 号）
  fs.copyFileSync(path.join(APP_DIR, 'icon-1-192.png'), path.join(APP_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  /* ---------- 2) APK 自适应图标（默认 = 1 号：灰白字标） ---------- */
  const mainBuf = await sharp(SRC[0]).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [tag, scale] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    // 自适应前景：108dp 画布，整图铺满（视区中心 66% 含 wordmark；视差露边由背景色兜底）
    const fgSize = Math.round(108 * scale);
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      await sharp(mainBuf).resize(fgSize, fgSize, { fit: 'cover' }).png().toBuffer()
    );
    // 传统方图标：squircle 圆角（半径 22%）+ 透明角
    const legacy = Math.round(48 * scale);
    const legacyRadius = Math.round(legacy * 0.22);
    fs.writeFileSync(
      path.join(dir, 'ic_launcher.png'),
      await sharp(mainBuf)
        .resize(legacy, legacy, { fit: 'cover' })
        .composite([{ input: SVG_SQUIRCLE(legacy, 0.22), blend: 'dest-in' }])
        .png()
        .toBuffer()
    );
    // 圆形图标
    const circleMask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`);
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_round.png'),
      await sharp(mainBuf)
        .resize(legacy, legacy, { fit: 'cover' })
        .composite([{ input: circleMask, blend: 'dest-in' }])
        .png()
        .toBuffer()
    );
    console.log(`✓ mipmap-${tag} (foreground ${fgSize} / launcher ${legacy})`);
  }
  // 自适应背景色（冷灰白，与前景边缘同域）
  fs.writeFileSync(
    path.join(RES, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  );
  console.log(`✓ ic_launcher_background = ${BG}`);

  /* ---------- 3) APK 冷启动 splash（灰白 · 图标 + Cove wordmark，呼应新网页开屏） ---------- */
  const splashSpec = [
    // [目录, 宽, 高]
    ['drawable', 480, 320],
    ['drawable-port-mdpi', 480, 800], ['drawable-port-hdpi', 720, 1280], ['drawable-port-xhdpi', 960, 1600],
    ['drawable-port-xxhdpi', 1440, 2400], ['drawable-port-xxxhdpi', 1920, 3200],
    ['drawable-land-mdpi', 800, 480], ['drawable-land-hdpi', 1280, 720], ['drawable-land-xhdpi', 1600, 960],
    ['drawable-land-xxhdpi', 2400, 1440], ['drawable-land-xxxhdpi', 3200, 1920],
  ];
  for (const [dir, w, h] of splashSpec) {
    const min = Math.min(w, h);
    const iconSize = Math.round(min * 0.24);
    const wordFs = Math.round(min * 0.052);
    const gap = Math.round(iconSize * 0.22);
    // 居中块：icon + gap + word；块顶 = (h - 块高)/2
    const blockH = iconSize + gap + wordFs;
    const blockTop = Math.round((h - blockH) / 2);
    const textBaseline = blockTop + iconSize + gap + wordFs;
    const svg = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <text x="${w / 2}" y="${textBaseline}" font-family="DejaVu Serif, Noto Serif SC, serif" font-size="${wordFs}" letter-spacing="${Math.round(wordFs * 0.35)}" fill="${INK}" text-anchor="middle">Cove</text>
</svg>`);
    const icon = await sharp(mainBuf)
      .resize(iconSize, iconSize, { fit: 'cover' })
      .composite([{ input: SVG_SQUIRCLE(iconSize, 0.22), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const out = await sharp(svg)
      .composite([{ input: icon, left: Math.round((w - iconSize) / 2), top: blockTop }])
      .png({ quality: 90 })
      .toBuffer();
    const full = path.join(RES, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, 'splash.png'), out);
    console.log(`✓ ${dir}/splash.png (${w}x${h})`);
  }
  console.log('ALL DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
