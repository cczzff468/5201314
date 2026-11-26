#!/usr/bin/env bun
/**
 * 第四十轮：启动闪屏 drawable 重生成（仅 splash，不动 mipmap——mipmap 由
 * rebuild-cove-icons-r40.mjs 全权负责）。默认图标换 4 号「小词灵」后，冷启动
 * 闪屏的居中图标本体同步换新（原 gen-android-branding.mjs 用 icon-1）。
 * 布局/奶油底/wordmark 与 gen-android-branding.mjs 完全一致，仅换 ICON 源。
 * 用法：bun scripts/gen-splash-r40.mjs
 */
import sharp from 'sharp';
import fs from 'fs';

const RES = 'android-shell/android/app/src/main/res';
const ICON = 'public/icons/app/icon-3-1024.png'; // 第四十二轮默认图标：情书字标（机主原图）
const CREAM = '#FAF8F3';

const splashSizes = {
  drawable: [480, 320],
  'drawable-port-mdpi': [240, 400],
  'drawable-port-hdpi': [360, 600],
  'drawable-port-xhdpi': [480, 800],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1440, 2400],
  'drawable-land-mdpi': [400, 240],
  'drawable-land-hdpi': [600, 360],
  'drawable-land-xhdpi': [800, 480],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [2400, 1440],
};

/** 韩系奶油底 + Cove wordmark（与 gen-android-branding.mjs 同款） */
function wordmark(w, h, iconSize) {
  const fs1 = Math.round(iconSize * 0.34);
  const cx = w / 2;
  const iconY = h / 2 - iconSize * 0.72;
  const wordY = iconY + iconSize + Math.round(iconSize * 0.3);
  const letters = ['C', 'o', 'v', 'e'];
  const spacing = fs1 * 0.46;
  const totalW = letters.length * fs1 * 0.62 + (letters.length - 1) * spacing;
  let x = cx - totalW / 2;
  const tspans = letters
    .map((ch) => {
      const t = `<text x="${x.toFixed(1)}" y="${wordY}" font-family="Helvetica, Arial, sans-serif" font-size="${fs1}" font-weight="500" fill="#3E3A35">${ch}</text>`;
      x += fs1 * 0.62 + spacing;
      return t;
    })
    .join('');
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="orbA" cx="22%" cy="18%" r="55%">
          <stop offset="0%" stop-color="#F6D9D2" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#F6D9D2" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="orbB" cx="82%" cy="86%" r="55%">
          <stop offset="0%" stop-color="#DDE8DC" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#DDE8DC" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="${CREAM}"/>
      <rect width="${w}" height="${h}" fill="url(#orbA)"/>
      <rect width="${w}" height="${h}" fill="url(#orbB)"/>
      ${tspans}
    </svg>`;
}

async function main() {
  for (const [dir, [w, h]] of Object.entries(splashSizes)) {
    fs.mkdirSync(`${RES}/${dir}`, { recursive: true });
    const iconSize = Math.round(Math.min(w, h) * 0.24);
    const iconB64 = (await sharp(ICON).resize(iconSize, iconSize).png().toBuffer()).toString('base64');
    const svg = wordmark(w, h, iconSize)
      .replace('</svg>', `<image x="${Math.round(w / 2 - iconSize / 2)}" y="${Math.round(h / 2 - iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" href="data:image/png;base64,${iconB64}"/></svg>`);
    await sharp(Buffer.from(svg)).png().toFile(`${RES}/${dir}/splash.png`);
  }
  console.log('✓ splash drawables regenerated with icon-3 (情书字标·机主原图)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
