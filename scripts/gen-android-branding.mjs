// 生成 Android 壳资源：Cove 启动器图标（mipmap 全密度 + 自适应前景）+ 启动闪屏 drawable
// 用法：bun scripts/gen-android-branding.mjs
import sharp from 'sharp';
import fs from 'fs';

const RES = 'android-shell/android/app/src/main/res';
const ICON = 'public/icons/app/icon-1-1024.png'; // 默认图标（纯白压印 cove）
const CREAM = '#FAF8F3';

const MIPMAPS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** 圆形蒙版（round 图标用） */
function circleMask(size) {
  return Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
}
/** squircle 蒙版（23% 圆角） */
function squircleMask(size, ratio = 0.23) {
  const r = Math.round(size * ratio);
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
}

async function main() {
  // ---------- 1) 启动器图标：ic_launcher / ic_launcher_round（squircle 造型即图标本体） ----------
  for (const [dpi, mult] of Object.entries(MIPMAPS)) {
    const size = Math.round(48 * mult); // 基准 48dp
    const dir = `${RES}/mipmap-${dpi}`;
    fs.mkdirSync(dir, { recursive: true });
    // 48dp 图标直接用方形图 + 系统遮罩（自适应圆桌面 launcher 之外的传统形态）
    await sharp(ICON).resize(size, size).png().toFile(`${dir}/ic_launcher.png`);
    // round：圆形蒙版（背景透明处已由 squircle 透明角天然兼容）
    await sharp(ICON)
      .resize(size, size)
      .composite([{ input: circleMask(size), blend: 'dest-in' }])
      .png()
      .toFile(`${dir}/ic_launcher_round.png`);
    // 自适应前景：108dp 画布、图标居中缩到 62%（外圈安全区留给系统遮罩）
    const fg = Math.round(108 * mult);
    const inner = Math.round(fg * 0.62);
    const inset = Math.round((fg - inner) / 2);
    await sharp(ICON)
      .resize(inner, inner)
      .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(`${dir}/ic_launcher_foreground.png`);
    console.log(`mipmap-${dpi}: launcher ${size} / foreground ${fg}`);
  }

  // ---------- 2) 启动闪屏 drawable（韩系奶油底 + 图标 + Cove wordmark） ----------
  const wordmark = (w, h, iconSize) => {
    const fs1 = Math.round(iconSize * 0.34);
    const cx = w / 2;
    const iconY = h / 2 - iconSize * 0.72;
    const wordY = iconY + iconSize + Math.round(iconSize * 0.30);
    // wordmark：细字距 Cove（文字描 SVG，letter-spacing 用逐字偏移实现）
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
    // 顶部到图标间一道极细的呼吸光带（韩系氛围点缀）
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
  };

  const splashSizes = {
    'drawable': [480, 320],
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

  for (const [dir, [w, h]] of Object.entries(splashSizes)) {
    fs.mkdirSync(`${RES}/${dir}`, { recursive: true });
    const iconSize = Math.round(Math.min(w, h) * 0.24);
    // 先把图标本体转 base64 嵌入 SVG（避免 sharp composite 两步）
    const iconB64 = (await sharp(ICON).resize(iconSize, iconSize).png().toBuffer()).toString('base64');
    const svg = wordmark(w, h, iconSize)
      .replace('</svg>', `<image x="${Math.round(w / 2 - iconSize / 2)}" y="${Math.round(h / 2 - iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" href="data:image/png;base64,${iconB64}"/></svg>`);
    await sharp(Buffer.from(svg)).png().toFile(`${RES}/${dir}/splash.png`);
  }
  console.log('splash drawables done');

  // ---------- 3) 自适应背景色（奶油白与图标底板同族） ----------
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${CREAM}</color>\n</resources>\n`;
  fs.writeFileSync(`${RES}/values/ic_launcher_background.xml`, bgXml);
  console.log('adaptive bg color:', CREAM);
}
main();
