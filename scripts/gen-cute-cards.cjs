// 生成三张可爱便签卡纸（SVG 手绘 → JPEG 全出血无边）
// A 奶油小熊 810x1080 竖版 | B 薄荷兔兔 810x1080 竖版 | C 薰衣草猫猫 1080x675 横幅
const sharp = require('sharp');

const heart = (x, y, s, fill, rot = 0, op = 1) =>
  `<path transform="translate(${x},${y}) scale(${s}) rotate(${rot})" d="M 12 21 C 5 14 0 9 0 5.5 C 0 2.5 2.5 0 5.5 0 C 8 0 10 1.5 12 4 C 14 1.5 16 0 18.5 0 C 21.5 0 24 2.5 24 5.5 C 24 9 19 14 12 21 Z" fill="${fill}" opacity="${op}"/>`;

const sparkle = (x, y, s, fill, op = 1) =>
  `<path transform="translate(${x},${y}) scale(${s})" d="M0,-16 C2,-5 5,-2 16,0 C5,2 2,5 0,16 C-2,5 -5,2 -16,0 C-5,-2 -2,-5 0,-16 Z" fill="${fill}" opacity="${op}"/>`;

const dot = (x, y, r, fill, op = 1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${op}"/>`;

// ============ A 奶油小熊（竖版 810x1080） ============
const bear = `
<svg xmlns="http://www.w3.org/2000/svg" width="810" height="1080" viewBox="0 0 810 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdf7ee"/><stop offset="1" stop-color="#f5e7d5"/>
    </linearGradient>
  </defs>
  <rect width="810" height="1080" fill="url(#bg)"/>
  <!-- 右上角小爱心 -->
  ${heart(650, 105, 1.5, '#f2b7c6', -18)}
  ${heart(735, 180, 1.1, '#f6cbd6', 14)}
  ${heart(612, 195, 0.9, '#eec3cf', -8, 0.9)}
  ${dot(560, 88, 4.5, '#e8cfae', 0.8)}
  ${dot(762, 255, 3.5, '#e8cfae', 0.7)}
  ${dot(585, 250, 3, '#e8cfae', 0.6)}
  <!-- 左下小爱心 -->
  ${heart(92, 952, 1.0, '#f4c9d4', 12, 0.9)}
  ${heart(152, 1012, 0.75, '#f4c9d4', -15, 0.8)}
  ${dot(210, 962, 3.5, '#e8cfae', 0.7)}
  <!-- 小熊（右下角） -->
  <g transform="translate(615,880) scale(1.26) translate(-615,-880)">
    <circle cx="508" cy="775" r="54" fill="#d9b48f"/>
    <circle cx="722" cy="775" r="54" fill="#d9b48f"/>
    <circle cx="508" cy="775" r="30" fill="#f2ddc4"/>
    <circle cx="722" cy="775" r="30" fill="#f2ddc4"/>
    <circle cx="615" cy="880" r="152" fill="#dcb992"/>
    <ellipse cx="615" cy="928" rx="62" ry="48" fill="#f7e9d6"/>
    <ellipse cx="615" cy="906" rx="16" ry="12" fill="#6e5643"/>
    <path d="M615 918 L615 930 M615 930 q -13 11 -24 2 M615 930 q 13 11 24 2" fill="none" stroke="#6e5643" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="557" cy="868" r="13" fill="#4a3a30"/>
    <circle cx="673" cy="868" r="13" fill="#4a3a30"/>
    <ellipse cx="523" cy="902" rx="21" ry="12" fill="#f0b6a4" opacity="0.7"/>
    <ellipse cx="707" cy="902" rx="21" ry="12" fill="#f0b6a4" opacity="0.7"/>
  </g>
</svg>`;

// ============ B 薄荷兔兔（竖版 810x1080） ============
const bunny = `
<svg xmlns="http://www.w3.org/2000/svg" width="810" height="1080" viewBox="0 0 810 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0f8f0"/><stop offset="1" stop-color="#def0e3"/>
    </linearGradient>
  </defs>
  <rect width="810" height="1080" fill="url(#bg)"/>
  <!-- 右上角星星 -->
  ${sparkle(648, 118, 1.0, '#f4d98e')}
  ${sparkle(735, 192, 0.72, '#f4d98e', 0.9)}
  ${sparkle(578, 208, 0.5, '#f4d98e', 0.8)}
  ${dot(703, 88, 4.5, '#cfe5d3', 0.9)}
  ${dot(560, 148, 3.5, '#cfe5d3', 0.8)}
  ${dot(768, 258, 3, '#cfe5d3', 0.7)}
  ${heart(668, 262, 0.8, '#f4c9d4', 10, 0.85)}
  <!-- 右下小爱心 -->
  ${heart(628, 985, 0.95, '#f4c9d4', -12, 0.9)}
  ${heart(700, 945, 0.7, '#f4c9d4', 16, 0.8)}
  ${sparkle(560, 930, 0.5, '#f4d98e', 0.75)}
  <!-- 兔兔（左下角） -->
  <g transform="translate(185,895) scale(1.3) translate(-185,-895)">
    <ellipse cx="138" cy="765" rx="27" ry="80" fill="#fcfaf5" stroke="#e0e8df" stroke-width="3" transform="rotate(-9 138 765)"/>
    <ellipse cx="138" cy="768" rx="14" ry="54" fill="#f6ccd8" transform="rotate(-9 138 768)"/>
    <ellipse cx="232" cy="762" rx="27" ry="80" fill="#fcfaf5" stroke="#e0e8df" stroke-width="3" transform="rotate(9 232 762)"/>
    <ellipse cx="232" cy="765" rx="14" ry="54" fill="#f6ccd8" transform="rotate(9 232 765)"/>
    <circle cx="185" cy="895" r="137" fill="#fcfaf5" stroke="#e4eae2" stroke-width="3"/>
    <ellipse cx="185" cy="894" rx="8" ry="6" fill="#e8a8b4"/>
    <path d="M185 900 L185 910 M185 910 q -9 9 -16 2 M185 910 q 9 9 16 2" fill="none" stroke="#6e5f55" stroke-width="4" stroke-linecap="round"/>
    <circle cx="135" cy="884" r="12" fill="#454038"/>
    <circle cx="235" cy="884" r="12" fill="#454038"/>
    <ellipse cx="105" cy="915" rx="18" ry="11" fill="#f4b8c4" opacity="0.75"/>
    <ellipse cx="265" cy="915" rx="18" ry="11" fill="#f4b8c4" opacity="0.75"/>
  </g>
</svg>`;

// ============ C 薰衣草猫猫（横幅 1080x675） ============
const cat = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="675" viewBox="0 0 1080 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5f2fb"/><stop offset="1" stop-color="#e7e2f5"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="675" fill="url(#bg)"/>
  <!-- 右上角云朵+星星 -->
  <g opacity="0.9">
    <circle cx="855" cy="92" r="19" fill="#ffffff"/>
    <circle cx="892" cy="80" r="25" fill="#ffffff"/>
    <circle cx="930" cy="94" r="19" fill="#ffffff"/>
    <rect x="855" y="92" width="75" height="20" fill="#ffffff"/>
  </g>
  ${sparkle(990, 150, 0.8, '#f0e0ae')}
  ${sparkle(800, 185, 0.55, '#f0e0ae', 0.85)}
  ${dot(940, 60, 4, '#d9c8ec', 0.9)}
  ${dot(760, 120, 3.5, '#d9c8ec', 0.7)}
  <!-- 左侧小爱心 -->
  ${heart(85, 162, 0.9, '#d9c8ec', 12, 0.9)}
  ${heart(146, 224, 0.65, '#d9c8ec', -14, 0.8)}
  ${dot(200, 172, 3.5, '#d9c8ec', 0.7)}
  ${sparkle(70, 300, 0.5, '#f0e0ae', 0.8)}
  <!-- 猫猫（右下角·睡觉） -->
  <g transform="translate(890,460) scale(1.15) translate(-890,-460)">
    <path d="M 1000 505 q 40 -10 33 -47 q -5 -24 -30 -20" fill="none" stroke="#c9bde4" stroke-width="22" stroke-linecap="round"/>
    <ellipse cx="888" cy="505" rx="152" ry="106" fill="#d6cdea"/>
    <path d="M 762 356 L 742 298 L 806 320 Z" fill="#dfd7ef" stroke="#dfd7ef" stroke-width="10" stroke-linejoin="round"/>
    <path d="M 766 350 L 754 314 L 792 326 Z" fill="#eccfd9"/>
    <path d="M 938 352 L 978 302 L 988 366 Z" fill="#dfd7ef" stroke="#dfd7ef" stroke-width="10" stroke-linejoin="round"/>
    <path d="M 942 352 L 968 320 L 974 358 Z" fill="#eccfd9"/>
    <circle cx="858" cy="428" r="120" fill="#dfd7ef"/>
    <path d="M 812 432 q 14 13 28 0 M 876 432 q 14 13 28 0" fill="none" stroke="#6a5f88" stroke-width="5.5" stroke-linecap="round"/>
    <ellipse cx="858" cy="446" rx="7" ry="5" fill="#b09ac9"/>
    <path d="M 858 451 q -8 9 -14 1 M 858 451 q 8 9 14 1" fill="none" stroke="#6a5f88" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="796" cy="456" rx="17" ry="10" fill="#f0c4d4" opacity="0.75"/>
    <ellipse cx="920" cy="456" rx="17" ry="10" fill="#f0c4d4" opacity="0.75"/>
    ${sparkle(950, 300, 0.5, '#d9c8ec', 0.9)}
    ${sparkle(990, 252, 0.36, '#d9c8ec', 0.8)}
    ${sparkle(1022, 215, 0.26, '#d9c8ec', 0.7)}
  </g>
</svg>`;

(async () => {
  await sharp(Buffer.from(bear)).jpeg({ quality: 90 }).toFile('public/board-cards/card-9.jpg');
  await sharp(Buffer.from(bunny)).jpeg({ quality: 90 }).toFile('public/board-cards/card-10.jpg');
  await sharp(Buffer.from(cat)).jpeg({ quality: 90 }).toFile('public/board-cards/card-11.jpg');
  for (const f of ['card-9.jpg', 'card-10.jpg', 'card-11.jpg']) {
    const m = await sharp('public/board-cards/' + f).metadata();
    const { data } = await sharp('public/board-cards/' + f).resize(12, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const px = (r, c) => { const i = (r * 12 + c) * 3; return data[i] + ',' + data[i + 1] + ',' + data[i + 2]; };
    console.log(f, m.width + 'x' + m.height, 'ar=' + (m.width / m.height).toFixed(3), '| 顶中' + px(0, 6), '中' + px(8, 6), '左中' + px(8, 0), '右中' + px(8, 11));
  }
})();
