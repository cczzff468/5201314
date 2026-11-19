/**
 * 美团出行/文旅订单插画（本轮补齐「订单图片没做」的缺口）：
 * - 机票 / 火车票 / 酒店 / 电影演出四类订单此前 mtImg(kind) 无对应图，兜底成了一盘菜；
 * - 新增 4 张 kawaii 卡通插画（与 gen-goods-svg.ts 同风格：暖棕描边 + 腮红 + 粉彩底 + 闪光），
 *   sharp 栅格化落盘 public/goods/*.webp，goods-img.ts 注册映射后全链生效。
 * 用法：bun scripts/gen-travel-goods.ts
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUT = '/home/z/my-project/public/goods';
const OL = '#5C4A3D';
const EYE = '#46362B';

function face(cx: number, cy: number, s = 1, dx = 26, mouth: 'smile' | 'open' | 'cat' | 'none' = 'smile'): string {
  const er = 9.5 * s;
  let m = '';
  if (mouth === 'smile')
    m = `<path d="M ${cx - 8 * s} ${cy + 14 * s} Q ${cx} ${cy + 23 * s} ${cx + 8 * s} ${cy + 14 * s}" fill="none" stroke="${EYE}" stroke-width="${4.6 * s}" stroke-linecap="round"/>`;
  else if (mouth === 'open') m = `<ellipse cx="${cx}" cy="${cy + 17 * s}" rx="${7 * s}" ry="${9 * s}" fill="${EYE}"/>`;
  else if (mouth === 'cat')
    m = `<path d="M ${cx - 7 * s} ${cy + 13 * s} L ${cx} ${cy + 19 * s} L ${cx + 7 * s} ${cy + 13 * s}" fill="none" stroke="${EYE}" stroke-width="${4.6 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const bx = dx + 12 * s;
  return `
    <circle cx="${cx - dx}" cy="${cy}" r="${er}" fill="${EYE}"/>
    <circle cx="${cx + dx}" cy="${cy}" r="${er}" fill="${EYE}"/>
    <circle cx="${cx - dx + 3 * s}" cy="${cy - 3 * s}" r="${2.8 * s}" fill="#FFFFFF" opacity="0.92"/>
    <circle cx="${cx + dx + 3 * s}" cy="${cy - 3 * s}" r="${2.8 * s}" fill="#FFFFFF" opacity="0.92"/>
    ${m}
    <ellipse cx="${cx - bx}" cy="${cy + 9 * s}" rx="${8.5 * s}" ry="${5 * s}" fill="#FFAE9B" opacity="0.72"/>
    <ellipse cx="${cx + bx}" cy="${cy + 9 * s}" rx="${8.5 * s}" ry="${5 * s}" fill="#FFAE9B" opacity="0.72"/>`;
}

function sparkle(x: number, y: number, s: number, fill: string, op = 0.55): string {
  return `<path d="M ${x} ${y - 11 * s} Q ${x + 2.6 * s} ${y - 2.6 * s} ${x + 11 * s} ${y} Q ${x + 2.6 * s} ${y + 2.6 * s} ${x} ${y + 11 * s} Q ${x - 2.6 * s} ${y + 2.6 * s} ${x - 11 * s} ${y} Q ${x - 2.6 * s} ${y - 2.6 * s} ${x} ${y - 11 * s} Z" fill="${fill}" opacity="${op}"/>`;
}

function heart(cx: number, cy: number, s: number, fill: string): string {
  return `<path d="M ${cx} ${cy + 14 * s} Q ${cx - 18 * s} ${cy} ${cx - 18 * s} ${cy - 9 * s} Q ${cx - 18 * s} ${cy - 18 * s} ${cx - 9 * s} ${cy - 18 * s} Q ${cx - 3 * s} ${cy - 18 * s} ${cx} ${cy - 11 * s} Q ${cx + 3 * s} ${cy - 18 * s} ${cx + 9 * s} ${cy - 18 * s} Q ${cx + 18 * s} ${cy - 18 * s} ${cx + 18 * s} ${cy - 9 * s} Q ${cx + 18 * s} ${cy} ${cx} ${cy + 14 * s} Z" fill="${fill}"/>`;
}

function scene(fill: string, accent: string, groundY = 420, groundW = 180): string {
  return `<rect width="512" height="512" fill="${fill}"/>
  <circle cx="72" cy="86" r="9" fill="${accent}" opacity="0.7"/>
  <circle cx="442" cy="66" r="6" fill="${accent}" opacity="0.7"/>
  <circle cx="454" cy="382" r="8" fill="${accent}" opacity="0.55"/>
  <circle cx="56" cy="332" r="6" fill="${accent}" opacity="0.55"/>
  ${sparkle(98, 148, 1.05, accent)}
  ${sparkle(424, 196, 0.85, accent)}
  <ellipse cx="256" cy="${groundY}" rx="${groundW}" ry="24" fill="${OL}" opacity="0.10"/>`;
}

const S = `stroke="${OL}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;

// ---------------- 机票：kawaii 小客机（圆胖机身 + 云朵舷窗 + 侧翼） ----------------

const mtFlight = `
  <ellipse cx="256" cy="252" rx="150" ry="86" fill="#FFF9F0" ${S}/>
  <path d="M116 232 Q150 168 256 168 Q362 168 396 232 Z" fill="#7EC8F0" ${S}/>
  <path d="M136 226 Q168 182 256 182 Q344 182 376 226 Z" fill="#A8DCF7" stroke="none"/>
  <ellipse cx="206" cy="252" rx="24" ry="18" fill="#BFE6F8" ${S}/>
  <ellipse cx="272" cy="252" rx="24" ry="18" fill="#BFE6F8" ${S}/>
  <ellipse cx="330" cy="252" rx="20" ry="15" fill="#BFE6F8" ${S}/>
  ${face(268, 300, 1.0, 34)}
  <path d="M150 306 L64 366 L128 368 Z" fill="#FF8FAB" ${S}/>
  <path d="M362 306 L448 366 L384 368 Z" fill="#FF8FAB" ${S}/>
  <path d="M236 162 Q256 128 286 140 Q270 158 252 164 Z" fill="#FFD100" ${S}/>
  <ellipse cx="256" cy="342" rx="10" ry="6" fill="#FF8FAB" opacity="0.85"/>
  ${heart(112, 148, 0.85, '#FF9FB8')}
  ${sparkle(408, 128, 1.0, '#FFD100')}
  <ellipse cx="180" cy="416" rx="26" ry="13" fill="#FFFFFF" opacity="0.85" ${S}/>
  <ellipse cx="238" cy="430" rx="34" ry="15" fill="#FFFFFF" opacity="0.9" ${S}/>
  <ellipse cx="310" cy="420" rx="26" ry="13" fill="#FFFFFF" opacity="0.85" ${S}/>`;

// ---------------- 火车票：高铁车头（子弹头 + 车窗 + 轨道） ----------------

const mtTrain = `
  <path d="M76 332 Q76 236 196 200 Q330 162 420 232 Q440 250 434 280 L426 332 Z" fill="#FFF9F0" ${S}/>
  <path d="M108 332 Q112 252 208 220 Q316 188 396 244 L396 280 Q330 268 240 276 Q152 284 136 332 Z" fill="#7EC8F0" stroke="none"/>
  <path d="M136 288 Q168 252 232 238 L236 272 Q176 280 152 302 Z" fill="#A8DCF7" stroke="none" opacity="0.85"/>
  <ellipse cx="352" cy="270" rx="24" ry="22" fill="#BFE6F8" ${S}/>
  ${face(300, 300, 0.85, 24)}
  <rect x="76" y="332" width="352" height="26" rx="13" fill="#FF8FAB" ${S}/>
  <rect x="112" y="300" width="46" height="13" rx="6.5" fill="#FFD100" ${S}/>
  <rect x="346" y="300" width="46" height="13" rx="6.5" fill="#FFD100" ${S}/>
  <rect x="56" y="392" width="400" height="14" rx="7" fill="#D8D2C4" ${S}/>
  <rect x="100" y="416" width="22" height="30" rx="6" fill="#C9C2B4" ${S}/>
  <rect x="192" y="416" width="22" height="30" rx="6" fill="#C9C2B4" ${S}/>
  <rect x="284" y="416" width="22" height="30" rx="6" fill="#C9C2B4" ${S}/>
  <rect x="376" y="416" width="22" height="30" rx="6" fill="#C9C2B4" ${S}/>
  ${sparkle(96, 148, 1.0, '#FFD100')}
  ${heart(420, 170, 0.8, '#FF9FB8')}`;

// ---------------- 酒店：小楼酒店（遮阳篷 + 星级旗 + 月亮） ----------------

const mtHotel = `
  <rect x="136" y="150" width="240" height="264" rx="18" fill="#FFF9F0" ${S}/>
  <rect x="136" y="196" width="240" height="34" fill="#FF8FAB" stroke="none"/>
  <path d="M136 196 L376 196 L376 214 L136 214 Z" fill="#F7749B" stroke="none" opacity="0.6"/>
  <path d="M148 196 L148 232 M192 196 L192 232 M236 196 L236 232 M280 196 L280 232 M324 196 L324 232 M368 196 L368 232" stroke="${OL}" stroke-width="4" opacity="0.35"/>
  <rect x="164" y="246" width="42" height="42" rx="8" fill="#BFE6F8" ${S}/>
  <rect x="236" y="246" width="42" height="42" rx="8" fill="#BFE6F8" ${S}/>
  <rect x="308" y="246" width="42" height="42" rx="8" fill="#FFD9A0" ${S}/>
  <rect x="164" y="312" width="42" height="42" rx="8" fill="#BFE6F8" ${S}/>
  <rect x="308" y="312" width="42" height="42" rx="8" fill="#FFD9A0" ${S}/>
  <rect x="222" y="322" width="70" height="92" rx="12" fill="#C98850" ${S}/>
  <circle cx="278" cy="370" r="5" fill="#FFD100" ${S}/>
  <path d="M222 322 L292 322 L292 330 Q256 342 222 330 Z" fill="#A96F3F" stroke="none"/>
  <circle cx="256" cy="112" r="10" fill="#FFD100" ${S}/>
  <path d="M256 122 L256 150" stroke="${OL}" stroke-width="5"/>
  <path d="M256 124 L318 136 L256 150 Z" fill="#FF8FAB" ${S}/>
  <path d="M226 150 L286 150" stroke="${OL}" stroke-width="8" stroke-linecap="round"/>
  ${face(286, 380, 0.62, 15, 'smile')}
  ${heart(96, 208, 0.85, '#FF9FB8')}
  ${sparkle(428, 128, 0.95, '#FFD100')}`;

// ---------------- 电影演出：电影票根 + 爆米花桶 ----------------

const mtMovie = `
  <g transform="rotate(-8 210 300)">
    <rect x="96" y="212" width="232" height="152" rx="18" fill="#FF8FAB" ${S}/>
    <rect x="96" y="212" width="232" height="152" rx="18" fill="none" ${S}/>
    <path d="M96 262 L328 262" stroke="#FFF9F0" stroke-width="6" stroke-dasharray="14 12"/>
    <circle cx="130" cy="262" r="7" fill="#FFF9F0" stroke="none"/>
    <circle cx="294" cy="262" r="7" fill="#FFF9F0" stroke="none"/>
    <rect x="120" y="288" width="96" height="14" rx="7" fill="#FFF9F0" opacity="0.9"/>
    <rect x="120" y="314" width="132" height="12" rx="6" fill="#FFF9F0" opacity="0.65"/>
    <rect x="120" y="336" width="76" height="12" rx="6" fill="#FFF9F0" opacity="0.65"/>
    ${sparkle(300, 300, 0.8, '#FFF9F0')}
  </g>
  <g transform="rotate(7 360 250)">
    <path d="M310 218 L410 218 L392 356 Q390 372 374 372 L346 372 Q330 372 328 356 Z" fill="#FFF9F0" ${S}/>
    <path d="M316 252 L404 252" stroke="#F2C060" stroke-width="8"/>
    <path d="M316 252 L322 350 M360 254 L360 352 M404 252 L398 350" stroke="#E8A94F" stroke-width="5" opacity="0.6"/>
    <circle cx="330" cy="204" r="22" fill="#FFF0C8" ${S}/>
    <circle cx="360" cy="188" r="24" fill="#FFF6E0" ${S}/>
    <circle cx="390" cy="204" r="22" fill="#FFF0C8" ${S}/>
    <circle cx="344" cy="190" r="16" fill="#FFF9F0" stroke="none"/>
    ${face(360, 320, 0.72, 17)}
  </g>
  ${heart(112, 152, 0.9, '#FF9FB8')}
  ${sparkle(430, 140, 1.0, '#FFD100')}
  ${sparkle(80, 330, 0.8, '#FFC9D6')}`;

const JOBS: { name: string; fill: string; accent: string; body: string }[] = [
  { name: 'mt-flight', fill: '#E3F2FD', accent: '#A8DCF7', body: mtFlight },
  { name: 'mt-train', fill: '#EAF6FF', accent: '#A8DCF7', body: mtTrain },
  { name: 'mt-hotel', fill: '#FDF3E7', accent: '#F2D3AE', body: mtHotel },
  { name: 'mt-movie', fill: '#FDEFF4', accent: '#FFC9D6', body: mtMovie },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let done = 0;
  const failed: string[] = [];
  for (const job of JOBS) {
    const out = path.join(OUT, `${job.name}.webp`);
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${scene(job.fill, job.accent)}${job.body}</svg>`;
      await sharp(Buffer.from(svg)).webp({ quality: 82, effort: 4 }).toFile(out);
      done++;
      console.log(`OK ${job.name}.webp`);
    } catch (e) {
      failed.push(job.name);
      console.error(`FAIL ${job.name}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`done=${done} failed=${failed.length}`);
  if (failed.length) process.exit(1);
}

main();
