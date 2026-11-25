#!/usr/bin/env bun
/**
 * 第三十五轮：Cove App 图标全链重建（机主两张参考图 SVG 矢量重绘版）。
 *
 * 输入：scripts/svg-r35/icon-{1,2}.svg（1024 矢量源，机主参考图逐元素重绘）
 *   - icon-1 云朵 C：白底 + 灰胖月牙 C 环抱云朵笑脸 + 对话气泡 + cove 单线字标
 *   - icon-2 弧 C 微笑：米白底 + 石板蓝 C 弧（端点钮+眼点）+ 微笑弧 + 宽字距字标
 * 输出：
 *  - public/icons/app/icon-{N}-{192,256,512,1024}.png + icon-{N}-maskable-512.png（PWA/设置两选一/favicon）
 *  - icon-3 全套 = icon-1 内容覆写（三号位历史遗留引用兜底，store 侧已归一 '3'→'1'）
 *  - public/icons/app/apple-touch-icon.png（默认 = 1 号）
 *  - android-shell mipmap-*（自适应前景/传统方/圆）+ values/ic_launcher_background.xml
 *  - android-shell 各 drawable 目录 splash.png（冷启动：1 号云朵 C + Cove 衬线字，白底 #FDFDFD）
 *
 * 用法：bun scripts/rebuild-cove-icons-r35.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'public/icons/app');
const RES = path.join(ROOT, 'android-shell/android/app/src/main/res');
const SVG_DIR = path.join(ROOT, 'scripts/svg-r35');
const SRC = [path.join(SVG_DIR, 'icon-1.svg'), path.join(SVG_DIR, 'icon-2.svg')];

/** 1 号云朵 C 的纸白底（自适应图标背景 + native splash 同域） */
const BG = '#FDFDFD';
/** splash wordmark 暖灰 */
const INK = '#7A7F85';

const SVG_SQUIRCLE = (size, radiusRatio = 0.22) =>
  Buffer.from(`<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * radiusRatio)}" ry="${Math.round(size * radiusRatio)}" fill="#fff"/></svg>`);

async function main() {
  fs.mkdirSync(APP_DIR, { recursive: true });

  /* ---------- 1) Web 图标（两选一路径不变，纯替换内容；3 号 = 1 号覆写兜底） ---------- */
  const png1024 = [];
  for (let i = 0; i < 2; i++) {
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
    // maskable：中央 82% 安全区（矢量图主体居中，不需要模糊铺底——直接放大自体兜底边缘）
    const fg = await sharp(buf).resize(Math.round(512 * 0.86), Math.round(512 * 0.86), { fit: 'cover' }).png().toBuffer();
    const base = await sharp(buf).resize(512, 512, { fit: 'cover' }).blur(16).modulate({ brightness: 1.03 }).png().toBuffer();
    fs.writeFileSync(
      path.join(APP_DIR, `icon-${id}-maskable-512.png`),
      await sharp(base).composite([{ input: fg, gravity: 'center' }]).png().toBuffer()
    );
    console.log(`✓ web icon-${id} (192/256/512/1024/maskable)`);
  }
  // 3 号位覆写为 1 号内容（历史 IndexedDB/服务器 AppConfig 残留 '3' 引用的兜底；
  // store 本轮已把加载归一 '3'→'1'、设置弹窗只展示两选一，此处仅防直链 404/旧图）
  for (const size of [1024, 512, 256, 192]) {
    fs.writeFileSync(
      path.join(APP_DIR, `icon-3-${size}.png`),
      await sharp(png1024[0]).resize(size, size, { fit: 'cover' }).png({ quality: 90 }).toBuffer()
    );
  }
  fs.writeFileSync(
    path.join(APP_DIR, 'icon-3-maskable-512.png'),
    fs.readFileSync(path.join(APP_DIR, 'icon-1-maskable-512.png'))
  );
  console.log('✓ web icon-3 (legacy fallback = icon-1)');
  // apple-touch（默认 1 号）
  fs.copyFileSync(path.join(APP_DIR, 'icon-1-192.png'), path.join(APP_DIR, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  /* ---------- 2) APK 自适应图标（默认 = 1 号云朵 C） ---------- */
  const mainBuf = png1024[0];
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [tag, scale] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    // 自适应前景：108dp 画布整图铺满（视区中心 66% 完整含云朵 C 与字标）
    const fgSize = Math.round(108 * scale);
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      await sharp(mainBuf).resize(fgSize, fgSize, { fit: 'cover' }).png().toBuffer()
    );
    // 传统方图标：squircle 圆角（半径 22%）+ 透明角
    const legacy = Math.round(48 * scale);
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
  // 自适应背景色（1 号纸白底同域）
  fs.writeFileSync(
    path.join(RES, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  );
  console.log(`✓ ic_launcher_background = ${BG}`);

  /* ---------- 3) APK 冷启动 splash（云朵 C + Cove 衬线字，纸白底呼应图标一） ---------- */
  const splashSpec = [
    ['drawable', 480, 320],
    ['drawable-port-mdpi', 480, 800], ['drawable-port-hdpi', 720, 1280], ['drawable-port-xhdpi', 960, 1600],
    ['drawable-port-xxhdpi', 1440, 2400], ['drawable-port-xxxhdpi', 1920, 3200],
    ['drawable-land-mdpi', 800, 480], ['drawable-land-hdpi', 1280, 720], ['drawable-land-xhdpi', 1600, 960],
    ['drawable-land-xxhdpi', 2400, 1440], ['drawable-land-xxxhdpi', 3200, 1920],
  ];
  for (const [dir, w, h] of splashSpec) {
    const min = Math.min(w, h);
    const iconSize = Math.round(min * 0.26);
    const wordFs = Math.round(min * 0.052);
    const gap = Math.round(iconSize * 0.2);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
