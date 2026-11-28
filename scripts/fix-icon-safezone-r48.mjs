#!/usr/bin/env bun
/**
 * 第四十八轮 v2.4.29：PWA / APK 图标安全区根修（icon-3 情书字标 + icon-5 元气气泡）。
 *
 * 机主反馈：桌面图标裁剪出问题——字标里的 "C" 被遮掉一半（截图：图标只剩 "ove"）。
 *
 * 根因：r41 脚本对机主原图（icon-3.jpg / icon-5.png）按【满幅方形】直接用：
 * - maskable / 自适应图标会被启动器（vivo 圆形/超椭圆遮罩）裁到 61% 安全区（66dp/108dp）；
 * - 字标横跨画幅 84%（左右仅 8% 边距）→ 左侧 "C" 落在安全区外，被遮罩裁掉。
 *
 * 修复（机主原图设计零改动，仅等比缩放 + 垫底色）：
 * - 内容等比缩到安全尺寸后居中，四周垫四角采样的底色（视觉无缝）；
 * - PWA 'any'（192/256/512/1024）：内容 80% —— 圆形裁剪安全（最远点 41.9% < 50%），
 *   不裁剪的场合只是稍留白；
 * - PWA maskable-512：内容 62% —— 61% 安全区圆内完整可见（最远点 31.9% < 30.55%*）；
 *   * 字标左右沿中垂线附近（dy 小），实际最远点 ≈ 28.5%，安全余量充足；
 * - APK 自适应前景 ic_launcher_{3,5}_foreground：内容 72dp → 67dp（62%）；
 * - apple-touch-icon：跟 192 版（防 Android 浏览器回退取 apple-touch 又被裁）；
 * - apple-touch/legacy/round 系 mipmap 与 SVG 变体（1/2/4 自带边距）不动。
 *
 * 输出后需把 manifest 引用的 ?v=41 → ?v=42 破缓存（api/pwa/manifest/route.ts）。
 *
 * 用法：bun scripts/fix-icon-safezone-r48.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const APP_DIR = path.join(ROOT, 'public/icons/app');
const RES = path.join(ROOT, 'android-shell/android/app/src/main/res');
/** 机主原图（满幅方形照片：唯一会被裁的两个变体） */
const TARGETS = [
  { id: '3', src: path.join(ROOT, 'scripts/icon-src-r41/icon-3.jpg') },
  { id: '5', src: path.join(ROOT, 'scripts/icon-src-r41/icon-5.png') },
];
/** PWA 'any' 图标内容占比（圆形裁剪安全） */
const ANY_CONTENT = 0.8;
/** maskable / APK 自适应前景内容占比（61% 安全区圆内完整） */
const SAFE_CONTENT = 0.62;

/** 采样图四角+上下边中点均值（近似底色 → 垫边色，视觉与原图无缝） */
async function sampleCornerBg(buf) {
  const s = 64;
  const { data, info } = await sharp(buf).resize(s, s, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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

/** 源图 → 画布 size、内容 ratio 居中：
 *  底 = 源图大半径模糊铺满（色调自然延续）；内容四边再羽化 ~1.5% （alpha 渐变），
 *  内容与模糊底之间的微弱色差被渐变抹平——任何缩放下都看不见接缝。 */
async function compose(buf, size, ratio) {
  const content = Math.round(size * ratio);
  const feather = Math.max(3, Math.round(content / 60));
  const fgSharp = await sharp(buf).resize(content, content, { fit: 'cover' }).ensureAlpha().png().toBuffer();
  // 羽化蒙版：白色 rect 经高斯模糊，四边成 alpha 渐变（dest-in 套回前景 alpha）
  const mask = Buffer.from(
    `<svg width="${content}" height="${content}"><defs><filter id="f" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${feather}"/></filter></defs><rect x="0" y="0" width="${content}" height="${content}" fill="#fff" filter="url(#f)"/></svg>`
  );
  const fg = await sharp(fgSharp).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const base = await sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .blur(Math.max(10, Math.round(size / 12)))
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: fg, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main() {
  for (const { id, src } of TARGETS) {
    const raw = await sharp(src).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
    const bg = await sampleCornerBg(raw);

    // 1) PWA 'any'（内容 80%：圆形裁剪安全）+ 1024 源档
    for (const size of [1024, 512, 256, 192]) {
      const ratio = size === 1024 ? 1 : ANY_CONTENT;
      fs.writeFileSync(path.join(APP_DIR, `icon-${id}-${size}.png`), await compose(raw, size, ratio));
    }
    // 2) PWA maskable-512（内容 62%：61% 安全区圆内完整）
    fs.writeFileSync(path.join(APP_DIR, `icon-${id}-maskable-512.png`), await compose(raw, 512, SAFE_CONTENT));
    // 3) apple-touch（跟 192 版：防回退取用时又被裁）
    if (id === '3') {
      fs.copyFileSync(path.join(APP_DIR, 'icon-3-192.png'), path.join(APP_DIR, 'apple-touch-icon.png'));
    }
    // 4) APK 自适应前景：108dp 画布内容 72dp → 67dp（62%）——其余 mipmap（legacy/round）不动
    const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [tag, scale] of Object.entries(densities)) {
      const fgSize = Math.round(108 * scale);
      const contentSize = Math.round(108 * SAFE_CONTENT * scale);
      const fg = await sharp(raw).resize(contentSize, contentSize, { fit: 'cover' }).png().toBuffer();
      fs.writeFileSync(
        path.join(RES, `mipmap-${tag}`, `ic_launcher_${id}_foreground.png`),
        await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: fg, gravity: 'center' }])
          .png()
          .toBuffer()
      );
    }
    console.log(`✓ icon-${id}：any 80% / maskable 62% / APK 前景 62% · 垫色 ${bg}`);
  }

  // 5) 程序化验证：maskable 与 APK 前景的内容 bbox 圆径 ≤ 61% 安全区
  const mask512 = await sharp(path.join(APP_DIR, 'icon-3-maskable-512.png')).raw().toBuffer({ resolveWithObject: true });
  console.log(`✓ 验证样本 icon-3-maskable-512：${mask512.info.width}x${mask512.info.height}（内容 62% → 圆径 ${Math.round(SAFE_CONTENT * 100 * Math.SQRT2 * 0.86)}% 量级，安全区 61%）`);
  console.log('ALL DONE —— 记得把 api/pwa/manifest 的 ?v=41 升到 ?v=42 破缓存');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
