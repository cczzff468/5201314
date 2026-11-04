/**
 * 淘宝/美团本地卡通商品图生成器（Task 59 修复）：
 *
 * 背景：Task 58 代码层已把全站图源切到 public/goods/*.webp，但图片文件从未真正落盘，
 *       导致淘宝全站「图片加载失败」灰块（美团因 FoodImg 有 emoji 兜底而侥幸正常）。
 * 方案：纯本地手绘 SVG 矢量插画（kawaii 风格：暖棕描边 + 腮红 + 粉彩底 + 星星点缀），
 *       sharp 栅格化转 webp —— 零外部 API 依赖、风格全局统一、文件极小（约 15-40KB/张）。
 * 用法：bun scripts/gen-goods-svg.ts（支持断点续跑：已存在且非空的文件自动跳过）
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUT = '/home/z/my-project/public/goods';
const OL = '#5C4A3D'; // 主描边（暖棕）
const EYE = '#46362B'; // 五官色

// ---------------- 公共部件 ----------------

/** kawaii 脸：双眼 + 高光 + 嘴 + 腮红。dx=眼距；mouth='none' 不画嘴（供自带嘴型的形象用） */
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

/** 四角星闪光 */
function sparkle(x: number, y: number, s: number, fill: string, op = 0.55): string {
  return `<path d="M ${x} ${y - 11 * s} Q ${x + 2.6 * s} ${y - 2.6 * s} ${x + 11 * s} ${y} Q ${x + 2.6 * s} ${y + 2.6 * s} ${x} ${y + 11 * s} Q ${x - 2.6 * s} ${y + 2.6 * s} ${x - 11 * s} ${y} Q ${x - 2.6 * s} ${y - 2.6 * s} ${x} ${y - 11 * s} Z" fill="${fill}" opacity="${op}"/>`;
}

/** 小爱心 */
function heart(cx: number, cy: number, s: number, fill: string): string {
  return `<path d="M ${cx} ${cy + 14 * s} Q ${cx - 18 * s} ${cy} ${cx - 18 * s} ${cy - 9 * s} Q ${cx - 18 * s} ${cy - 18 * s} ${cx - 9 * s} ${cy - 18 * s} Q ${cx - 3 * s} ${cy - 18 * s} ${cx} ${cy - 11 * s} Q ${cx + 3 * s} ${cy - 18 * s} ${cx + 9 * s} ${cy - 18 * s} Q ${cx + 18 * s} ${cy - 18 * s} ${cx + 18 * s} ${cy - 9 * s} Q ${cx + 18 * s} ${cy} ${cx} ${cy + 14 * s} Z" fill="${fill}"/>`;
}

/** 场景底：满幅粉彩底 + 散点 + 闪光 + 落地椭圆阴影 */
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

/** 热气/蒸汽卷 */
function steam(x: number, y: number, s = 1, stroke = '#FFFFFF'): string {
  return `<path d="M ${x} ${y} q ${-8 * s} ${-14 * s} 0 ${-26 * s} q ${8 * s} ${-12 * s} 0 ${-24 * s}" fill="none" stroke="${stroke}" stroke-width="${6 * s}" stroke-linecap="round" opacity="0.75"/>`;
}

const S = `stroke="${OL}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;

// ---------------- 美团菜品（28） ----------------

const mtMilkTea = `
  <rect x="248" y="66" width="26" height="128" rx="13" transform="rotate(16 261 130)" fill="#FF8FAB" ${S}/>
  <rect x="176" y="142" width="160" height="34" rx="17" fill="#FFF6EA" ${S}/>
  <path d="M190 176 L322 176 L306 428 Q304 442 288 442 L224 442 Q208 442 206 428 Z" fill="#FFF9F0" ${S}/>
  <path d="M204 210 L308 210 L297 420 Q296 430 286 430 L226 430 Q216 430 215 420 Z" fill="#E7B37A" stroke="none"/>
  <circle cx="226" cy="404" r="11" fill="#7A4E33"/><circle cx="254" cy="412" r="11" fill="#7A4E33"/>
  <circle cx="282" cy="402" r="11" fill="#7A4E33"/><circle cx="240" cy="382" r="10" fill="#7A4E33"/>
  <circle cx="270" cy="384" r="10" fill="#7A4E33"/>
  <rect x="216" y="196" width="13" height="140" rx="6.5" fill="#FFFFFF" opacity="0.5"/>
  ${face(256, 296, 1, 26)}`;

const mtTea = `
  <circle cx="330" cy="188" r="36" fill="#FFB44D" ${S}/>
  <circle cx="330" cy="188" r="25" fill="#FFD08A" stroke="none"/>
  <path d="M330 168 L330 208 M310 188 L350 188 M316 174 L344 202 M344 174 L316 202" stroke="#FFF6E0" stroke-width="4"/>
  <rect x="230" y="88" width="18" height="98" rx="9" transform="rotate(-14 239 137)" fill="#FF8FAB" ${S}/>
  <rect x="190" y="182" width="132" height="248" rx="20" fill="#FFF9F0" ${S}/>
  <rect x="202" y="234" width="108" height="184" rx="16" fill="#F2C060" stroke="none"/>
  <circle cx="224" cy="272" r="6" fill="#FFF6E0" opacity="0.8"/>
  <circle cx="286" cy="282" r="5" fill="#FFF6E0" opacity="0.8"/>
  <rect x="210" y="214" width="12" height="130" rx="6" fill="#FFFFFF" opacity="0.55"/>
  ${face(256, 318, 0.95, 24)}`;

const mtBurger = `
  <path d="M136 252 Q136 142 256 142 Q376 142 376 252 L376 262 L136 262 Z" fill="#F5C36B" ${S}/>
  <ellipse cx="204" cy="192" rx="11" ry="7" fill="#FFF6E0" opacity="0.9" transform="rotate(-18 204 192)"/>
  <ellipse cx="258" cy="174" rx="11" ry="7" fill="#FFF6E0" opacity="0.9"/>
  <ellipse cx="310" cy="194" rx="11" ry="7" fill="#FFF6E0" opacity="0.9" transform="rotate(18 310 194)"/>
  ${face(256, 220, 0.95, 30)}
  <circle cx="152" cy="288" r="21" fill="#93C460" ${S}/><circle cx="196" cy="292" r="21" fill="#93C460" ${S}/>
  <circle cx="240" cy="294" r="21" fill="#93C460" ${S}/><circle cx="284" cy="292" r="21" fill="#93C460" ${S}/>
  <circle cx="326" cy="288" r="21" fill="#93C460" ${S}/><circle cx="362" cy="284" r="20" fill="#93C460" ${S}/>
  <rect x="142" y="298" width="228" height="28" rx="14" fill="#8D5A3A" ${S}/>
  <rect x="146" y="330" width="220" height="36" rx="18" fill="#F5C36B" ${S}/>`;

const mtFriedChicken = `
  <circle cx="170" cy="282" r="18" fill="#FFF3E2" ${S}/><circle cx="190" cy="260" r="18" fill="#FFF3E2" ${S}/>
  <rect x="168" y="266" width="132" height="32" rx="16" transform="rotate(45 168 266)" fill="#FFF3E2" ${S}/>
  <circle cx="296" cy="252" r="98" fill="#E8A25E" ${S}/>
  <path d="M240 186 Q282 158 330 186" fill="none" stroke="#FFF3E2" stroke-width="9" stroke-linecap="round" opacity="0.7"/>
  ${face(292, 248, 1, 30)}
  <circle cx="150" cy="170" r="6" fill="#E8A25E" opacity="0.7"/><circle cx="420" cy="180" r="7" fill="#E8A25E" opacity="0.6"/>
  <circle cx="404" cy="356" r="5" fill="#E8A25E" opacity="0.7"/>`;

const mtPizza = `
  <g transform="rotate(-14 256 280)">
    <path d="M126 212 Q256 138 386 212 L386 240 Q336 212 256 212 Q176 212 126 240 Z" fill="#F2C069" ${S}/>
    <path d="M132 228 L256 428 L380 228 Q256 172 132 228 Z" fill="#FFD98E" ${S}/>
    <circle cx="212" cy="252" r="16" fill="#E2695E" ${S}/>
    <circle cx="302" cy="258" r="16" fill="#E2695E" ${S}/>
    ${face(256, 284, 0.8, 22)}
  </g>`;

const mtHotpot = `
  ${steam(216, 168, 1)} ${steam(262, 158, 1.15)} ${steam(306, 170, 0.9)}
  <circle cx="108" cy="256" r="21" fill="#E2574C" ${S}/><circle cx="404" cy="256" r="21" fill="#E2574C" ${S}/>
  <path d="M126 238 L386 238 Q386 372 256 372 Q126 372 126 238 Z" fill="#E2574C" ${S}/>
  <ellipse cx="256" cy="238" rx="130" ry="26" fill="#FF8A5C" ${S}/>
  <circle cx="212" cy="238" r="8" fill="#FFF6E0" opacity="0.85"/><circle cx="292" cy="232" r="7" fill="#FFF6E0" opacity="0.85"/>
  ${face(256, 314, 1, 28)}`;

const mtNoodles = `
  <rect x="322" y="96" width="14" height="170" rx="7" transform="rotate(24 329 181)" fill="#C9A06B" ${S}/>
  <rect x="352" y="100" width="14" height="164" rx="7" transform="rotate(34 359 182)" fill="#C9A06B" ${S}/>
  <path d="M344 240 Q364 292 354 336" fill="none" stroke="#F5CE84" stroke-width="10" stroke-linecap="round"/>
  <path d="M314 242 Q332 296 320 344" fill="none" stroke="#F5CE84" stroke-width="10" stroke-linecap="round"/>
  <path d="M126 240 L386 240 Q386 368 256 368 Q126 368 126 240 Z" fill="#F2764F" ${S}/>
  <ellipse cx="256" cy="240" rx="130" ry="26" fill="#FFF1DC" ${S}/>
  <path d="M160 236 Q200 216 240 236 Q280 252 320 234" fill="none" stroke="#F5CE84" stroke-width="9" stroke-linecap="round"/>
  ${face(256, 310, 1, 28)}`;

const mtRice = `
  <path d="M152 240 Q158 172 256 168 Q354 172 360 240 Z" fill="#FFFDF6" ${S}/>
  <path d="M126 246 L386 246 Q386 366 256 366 Q126 366 126 246 Z" fill="#58A79C" ${S}/>
  <path d="M126 252 Q256 300 386 252" fill="none" stroke="#FFFDF6" stroke-width="10" opacity="0.8"/>
  ${face(256, 306, 1, 28)}`;

const mtDessert = `
  <circle cx="256" cy="192" r="17" fill="#E85D5D" ${S}/>
  <path d="M256 176 Q262 160 278 158" fill="none" stroke="#8CC152" stroke-width="6" stroke-linecap="round"/>
  <path d="M150 246 Q150 214 180 214 L332 214 Q362 214 362 246 Z" fill="#FFD1DF" ${S}/>
  <circle cx="176" cy="248" r="14" fill="#FFD1DF" ${S}/><circle cx="216" cy="254" r="14" fill="#FFD1DF" ${S}/>
  <circle cx="256" cy="256" r="14" fill="#FFD1DF" ${S}/><circle cx="296" cy="254" r="14" fill="#FFD1DF" ${S}/>
  <circle cx="336" cy="248" r="14" fill="#FFD1DF" ${S}/>
  <path d="M152 252 L360 252 L360 380 Q360 396 344 396 L168 396 Q152 396 152 380 Z" fill="#FFE3EE" ${S}/>
  <rect x="152" y="292" width="208" height="13" fill="#FF8FAB" stroke="none"/>
  <rect x="152" y="330" width="208" height="13" fill="#FF8FAB" stroke="none"/>
  ${face(256, 364, 0.9, 24)}`;

const mtIceCream = `
  <circle cx="284" cy="104" r="13" fill="#E85D5D" ${S}/>
  <path d="M284 92 Q290 78 304 76" fill="none" stroke="#8CC152" stroke-width="5" stroke-linecap="round"/>
  <circle cx="256" cy="158" r="54" fill="#FFB7C9" ${S}/>
  <circle cx="256" cy="240" r="62" fill="#FFF6E8" ${S}/>
  <path d="M196 262 L316 262 L268 432 Q258 448 248 432 Z" fill="#F0BC74" ${S}/>
  <path d="M212 300 L296 288 M224 340 L286 330" stroke="#C98F4C" stroke-width="4" opacity="0.6"/>
  ${face(256, 244, 0.95, 26)}`;

const mtCoffee = `
  ${steam(226, 132, 0.9)} ${steam(286, 132, 0.9)}
  <rect x="186" y="150" width="140" height="36" rx="18" fill="#B98A66" ${S}/>
  <path d="M196 186 L316 186 L300 408 Q299 424 283 424 L229 424 Q213 424 212 408 Z" fill="#FFF6EA" ${S}/>
  <path d="M192 262 L320 262 L313 350 Q312 364 299 364 L213 364 Q200 364 199 350 Z" fill="#E8B287" ${S}/>
  ${face(256, 306, 0.9, 24, 'cat')}
  ${heart(256, 376, 0.8, '#E8B287')}`;

const mtJuice = `
  <circle cx="322" cy="192" r="35" fill="#FFB44D" ${S}/>
  <circle cx="322" cy="192" r="24" fill="#FFD08A" stroke="none"/>
  <path d="M322 174 L322 210 M304 192 L340 192 M310 180 L334 204 M334 180 L310 204" stroke="#FFF6E0" stroke-width="4"/>
  <rect x="196" y="128" width="17" height="120" rx="8.5" transform="rotate(10 204 188)" fill="#FF8FAB" ${S}/>
  <rect x="190" y="186" width="132" height="240" rx="20" fill="#FFF9F0" ${S}/>
  <rect x="202" y="238" width="108" height="176" rx="16" fill="#FFAB4D" stroke="none"/>
  <circle cx="224" cy="270" r="6" fill="#FFF6E0" opacity="0.85"/><circle cx="288" cy="280" r="5" fill="#FFF6E0" opacity="0.85"/>
  <rect x="210" y="216" width="12" height="128" rx="6" fill="#FFFFFF" opacity="0.5"/>
  ${face(256, 320, 0.9, 24)}`;

const mtFruit = `
  <path d="M112 334 A144 144 0 0 1 400 334 Z" fill="#FF7A6B" ${S}/>
  <path d="M124 334 A132 132 0 0 0 388 334" fill="none" stroke="#FFF6E0" stroke-width="12"/>
  <path d="M134 334 A122 122 0 0 0 378 334" fill="none" stroke="#7CC96B" stroke-width="18"/>
  <ellipse cx="188" cy="298" rx="7" ry="11" fill="#4A3B32" transform="rotate(-14 188 298)"/>
  <ellipse cx="324" cy="290" rx="7" ry="11" fill="#4A3B32" transform="rotate(12 324 290)"/>
  <ellipse cx="250" cy="318" rx="7" ry="11" fill="#4A3B32"/>
  ${face(256, 258, 0.95, 28)}`;

const mtBreakfast = `
  <rect x="286" y="196" width="30" height="220" rx="15" transform="rotate(26 301 306)" fill="#F0BC74" ${S}/>
  <rect x="196" y="188" width="30" height="230" rx="15" transform="rotate(-18 211 303)" fill="#F5CD8A" ${S}/>
  <rect x="150" y="222" width="120" height="196" rx="24" fill="#FFF9F0" ${S}/>
  <rect x="166" y="266" width="88" height="108" rx="14" fill="#7FC8BD" stroke="none"/>
  <path d="M176 312 Q210 298 244 312" fill="none" stroke="#FFFFFF" stroke-width="8" opacity="0.7"/>
  ${face(210, 346, 0.85, 20)}
  <circle cx="366" cy="140" r="7" fill="#F2C069" opacity="0.8"/>`;

const mtDumplings = `
  <g transform="rotate(-16 190 320)"><path d="M136 340 Q136 268 190 268 Q244 268 244 340 Z" fill="#FFF3DC" ${S}/>
  <path d="M154 288 Q162 276 172 286 M176 278 Q184 266 194 276 M198 286 Q206 274 216 284" fill="none" stroke="${OL}" stroke-width="4" opacity="0.45"/></g>
  <g transform="rotate(16 322 320)"><path d="M268 340 Q268 268 322 268 Q376 268 376 340 Z" fill="#FFF3DC" ${S}/>
  <path d="M286 288 Q294 276 304 286 M308 278 Q316 266 326 276 M330 286 Q338 274 348 284" fill="none" stroke="${OL}" stroke-width="4" opacity="0.45"/></g>
  <path d="M190 352 Q190 276 256 276 Q322 276 322 352 Z" fill="#FFF9EC" ${S}/>
  <path d="M210 300 Q218 286 228 298 M234 290 Q242 276 252 288 M258 290 Q266 276 276 288 M282 298 Q290 286 300 298" fill="none" stroke="${OL}" stroke-width="4.5" opacity="0.5"/>
  ${face(256, 322, 0.85, 24)}
  <ellipse cx="256" cy="392" rx="150" ry="24" fill="#FFFDF6" ${S}/>`;

const mtSushi = `
  <path d="M170 296 Q170 276 256 276 Q342 276 342 296 L342 342 Q342 372 256 372 Q170 372 170 342 Z" fill="#FFFDF6" ${S}/>
  <rect x="166" y="226" width="180" height="76" rx="30" fill="#FF9E7A" ${S}/>
  <path d="M244 250 Q286 242 320 252 M248 272 Q288 264 318 274" fill="none" stroke="#FFFFFF" stroke-width="5" opacity="0.55"/>
  <rect x="236" y="212" width="40" height="168" rx="6" fill="#3A4A40" ${S}/>
  ${face(202, 264, 0.68, 13)}
  <path d="M186 330 Q202 342 218 330" fill="none" stroke="${EYE}" stroke-width="4.5" stroke-linecap="round"/>`;

const mtBarbecue = `
  <g transform="rotate(12 256 330)">
    <rect x="116" y="324" width="280" height="11" rx="5.5" fill="#C9A06B" ${S}/>
    <rect x="152" y="306" width="50" height="44" rx="12" fill="#F2A65A" ${S}/>
    <rect x="232" y="306" width="50" height="44" rx="12" fill="#E2695E" ${S}/>
    <rect x="312" y="306" width="50" height="44" rx="12" fill="#F2A65A" ${S}/>
  </g>
  <g transform="rotate(-14 256 256)">
    <rect x="106" y="250" width="300" height="11" rx="5.5" fill="#C9A06B" ${S}/>
    <rect x="146" y="232" width="52" height="46" rx="12" fill="#E2695E" ${S}/>
    <rect x="230" y="232" width="52" height="46" rx="12" fill="#F2A65A" ${S}/>
    <rect x="314" y="232" width="52" height="46" rx="12" fill="#E2695E" ${S}/>
    ${face(256, 252, 0.55, 13)}
  </g>`;

const mtChineseFood = `
  ${steam(206, 226, 0.9)} ${steam(256, 216, 1.1)} ${steam(306, 228, 0.85)}
  <ellipse cx="256" cy="348" rx="168" ry="34" fill="#FFFDF6" ${S}/>
  <circle cx="216" cy="286" r="24" fill="#8CC152" ${S}/>
  <circle cx="256" cy="268" r="22" fill="#7FB069" ${S}/>
  <circle cx="296" cy="288" r="23" fill="#8CC152" ${S}/>
  <circle cx="238" cy="312" r="14" fill="#FF9E5E" ${S}/><circle cx="280" cy="314" r="14" fill="#FF9E5E" ${S}/>
  <rect x="196" y="306" width="52" height="18" rx="9" transform="rotate(-16 222 315)" fill="#C16B50" ${S}/>
  <rect x="268" y="308" width="52" height="18" rx="9" transform="rotate(12 294 317)" fill="#C16B50" ${S}/>
  ${face(256, 356, 0.8, 24)}`;

const mtSeafood = `
  <path d="M170 262 Q140 220 166 196 M342 262 Q372 220 346 196" fill="none" stroke="${OL}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="152" cy="182" r="26" fill="#F06552" ${S}/><circle cx="360" cy="182" r="26" fill="#F06552" ${S}/>
  <path d="M140 168 L152 190 L166 172 M334 172 L360 190 L372 168" fill="none" stroke="${OL}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M180 320 Q148 330 134 356 M204 342 Q186 360 184 382 M308 342 Q326 360 328 382 M332 320 Q364 330 378 356" fill="none" stroke="${OL}" stroke-width="12" stroke-linecap="round"/>
  <path d="M206 236 L198 200 M306 236 L314 200" stroke="${OL}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="196" cy="192" r="13" fill="#FFFDF6" ${S}/><circle cx="316" cy="192" r="13" fill="#FFFDF6" ${S}/>
  <circle cx="196" cy="194" r="5.5" fill="${EYE}"/><circle cx="316" cy="194" r="5.5" fill="${EYE}"/>
  <ellipse cx="256" cy="304" rx="94" ry="72" fill="#F06552" ${S}/>
  <path d="M240 318 Q256 332 272 318" fill="none" stroke="${EYE}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="204" cy="312" rx="9" ry="5.5" fill="#FFD1CF" opacity="0.9"/>
  <ellipse cx="308" cy="312" rx="9" ry="5.5" fill="#FFD1CF" opacity="0.9"/>`;

const mtBeef = `
  <path d="M152 244 Q152 182 224 178 L318 178 Q388 182 384 244 Q396 300 340 322 Q298 344 238 330 Q158 320 152 244 Z" fill="#C16B50" ${S}/>
  <path d="M196 222 Q232 208 262 224 Q292 238 322 224" fill="none" stroke="#FFF" stroke-width="6" stroke-linecap="round" opacity="0.5"/>
  <path d="M192 296 Q226 308 258 298 Q292 288 322 302" fill="none" stroke="#FFF" stroke-width="5" stroke-linecap="round" opacity="0.4"/>
  <ellipse cx="360" cy="162" rx="14" ry="7" fill="#8CC152" transform="rotate(-24 360 162)"/>
  <ellipse cx="384" cy="180" rx="12" ry="6" fill="#8CC152" transform="rotate(18 384 180)"/>
  ${face(256, 250, 0.95, 28)}`;

const mtSalad = `
  <circle cx="196" cy="242" r="24" fill="#8CC152" ${S}/><circle cx="252" cy="226" r="23" fill="#7FB069" ${S}/>
  <circle cx="308" cy="244" r="24" fill="#8CC152" ${S}/>
  <circle cx="226" cy="262" r="13" fill="#E85D5D" ${S}/><circle cx="288" cy="266" r="13" fill="#E85D5D" ${S}/>
  <circle cx="256" cy="248" r="7" fill="#FFD166"/><circle cx="206" cy="266" r="6" fill="#FFD166"/><circle cx="308" cy="268" r="6" fill="#FFD166"/>
  <path d="M136 258 L376 258 Q376 366 256 366 Q136 366 136 258 Z" fill="#FFFDF6" ${S}/>
  <path d="M136 264 Q256 306 376 264" fill="none" stroke="#E3D7C2" stroke-width="6" opacity="0.8"/>
  ${face(256, 312, 1, 28)}`;

const mtSoup = `
  ${steam(210, 200, 0.9)} ${steam(258, 188, 1.1)} ${steam(302, 202, 0.85)}
  <path d="M136 244 L376 244 Q376 364 256 364 Q136 364 136 244 Z" fill="#E8835E" ${S}/>
  <ellipse cx="256" cy="244" rx="120" ry="24" fill="#FFD98E" ${S}/>
  <circle cx="222" cy="240" r="9" fill="#FFF6E0" opacity="0.9"/><circle cx="286" cy="248" r="7" fill="#FFF6E0" opacity="0.9"/>
  <path d="M256 232 Q268 220 280 232" fill="none" stroke="#FFF6E0" stroke-width="6"/>
  ${face(256, 306, 1, 28)}`;

const mtCola = `
  <path d="M226 96 Q216 112 228 126" fill="none" stroke="#FF8FAB" stroke-width="8" stroke-linecap="round"/>
  <rect x="248" y="92" width="17" height="110" rx="8.5" transform="rotate(8 256 147)" fill="#FF8FAB" ${S}/>
  <path d="M186 168 Q256 150 326 168 L318 196 L194 196 Z" fill="#FFF6EA" ${S}/>
  <path d="M192 196 L320 196 L302 414 Q301 430 285 430 L227 430 Q211 430 210 414 Z" fill="#FFF6EA" ${S}/>
  <path d="M199 268 L313 268 L308 330 Q307 340 296 340 L216 340 Q205 340 204 330 Z" fill="#E2574C" stroke="none"/>
  <circle cx="232" cy="298" r="8" fill="#FFFFFF" opacity="0.85"/><circle cx="272" cy="308" r="10" fill="#FFFFFF" opacity="0.7"/><circle cx="296" cy="286" r="6" fill="#FFFFFF" opacity="0.85"/>
  ${face(256, 378, 0.9, 24)}`;

const mtEgg = `
  <path d="M144 268 Q158 208 224 214 Q246 172 304 190 Q356 178 368 232 Q410 254 390 306 Q402 358 348 366 Q326 402 272 386 Q216 408 188 366 Q136 350 144 268 Z" fill="#FFFDF6" ${S}/>
  <circle cx="256" cy="290" r="58" fill="#FFC24B" ${S}/>
  ${face(256, 288, 0.9, 22)}`;

const mtMilk = `
  <path d="M196 214 L228 148 L284 148 L316 214 Z" fill="#FFFDF6" ${S}/>
  <path d="M228 148 L284 148 L272 132 L240 132 Z" fill="#F1E9DA" ${S}/>
  <rect x="196" y="214" width="120" height="196" rx="14" fill="#FFFDF6" ${S}/>
  <path d="M196 288 Q216 274 236 288 Q256 302 276 288 Q296 274 316 288 L316 320 Q296 334 276 320 Q256 306 236 320 Q216 334 196 320 Z" fill="#7FC8BD" stroke="none"/>
  ${face(256, 366, 0.85, 24)}`;

const mtMedicine = `
  <circle cx="352" cy="180" r="7" fill="#FF9E5E" opacity="0.7"/>
  <rect x="198" y="158" width="116" height="48" rx="12" fill="#FFFDF6" ${S}/>
  <rect x="206" y="206" width="100" height="188" rx="18" fill="#FF9E5E" ${S}/>
  <path d="M242 236 L270 236 M256 222 L256 250" stroke="#FFFDF6" stroke-width="9" stroke-linecap="round"/>
  <rect x="206" y="258" width="100" height="90" fill="#FFF6EA" stroke="none"/>
  ${face(256, 306, 0.85, 22)}
  <rect x="330" y="352" width="66" height="26" rx="13" transform="rotate(-18 363 365)" fill="#FF8FAB" ${S}/>
  <path d="M352 356 L352 376" stroke="#FFFDF6" stroke-width="8"/>
  <rect x="140" y="366" width="62" height="25" rx="12.5" transform="rotate(12 171 378)" fill="#FFD166" ${S}/>`;

const mtFlower = `
  <path d="M226 240 L240 258 M256 228 L256 258 M286 240 L272 258" stroke="#8CC152" stroke-width="6" stroke-linecap="round"/>
  <circle cx="190" cy="212" r="30" fill="#FF9EBB" ${S}/>
  <circle cx="322" cy="212" r="30" fill="#FFD166" ${S}/>
  <circle cx="222" cy="152" r="28" fill="#FFE08A" ${S}/>
  <circle cx="290" cy="152" r="28" fill="#F6A6C1" ${S}/>
  <circle cx="256" cy="196" r="34" fill="#FF8FAB" ${S}/>
  ${face(256, 194, 0.55, 14)}
  <ellipse cx="212" cy="248" rx="16" ry="9" fill="#8CC152" transform="rotate(-30 212 248)"/>
  <ellipse cx="300" cy="248" rx="16" ry="9" fill="#8CC152" transform="rotate(30 300 248)"/>
  <path d="M170 254 L342 254 L298 428 Q292 442 276 442 L236 442 Q220 442 214 428 Z" fill="#F0D9B0" ${S}/>
  <path d="M206 254 L246 428" stroke="${OL}" stroke-width="5" opacity="0.35"/>
  <path d="M306 254 L266 428" stroke="${OL}" stroke-width="5" opacity="0.35"/>`;

const mtStore = `
  <path d="M198 214 Q202 156 258 150 Q306 156 314 210" fill="none" stroke="${OL}" stroke-width="12" stroke-linecap="round"/>
  <rect x="216" y="96" width="56" height="24" rx="12" transform="rotate(-38 244 108)" fill="#F0BC74" ${S}/>
  <ellipse cx="310" cy="120" rx="20" ry="26" fill="#8CC152" ${S}/>
  <rect x="176" y="212" width="160" height="196" rx="16" fill="#FFB35C" ${S}/>
  <path d="M206 240 L306 240" stroke="${OL}" stroke-width="5" opacity="0.4"/>
  ${sparkle(214, 286, 0.9, '#FFF6E0', 0.9)}
  ${face(256, 330, 0.95, 26)}`;

// ---------------- 店面（6） ----------------

function shopBase(wall: string, roof: string, awA: string, awB: string): string {
  let scallops = '';
  for (let i = 0; i < 7; i++) {
    const cx = 136 + i * 40;
    scallops += `<circle cx="${cx}" cy="226" r="20" fill="${i % 2 === 0 ? awA : awB}" ${S}/>`;
  }
  return `<rect x="96" y="150" width="320" height="252" fill="${wall}" ${S}/>
  <rect x="76" y="118" width="360" height="46" rx="14" fill="${roof}" ${S}/>
  <rect x="116" y="196" width="280" height="26" rx="6" fill="${awA}" stroke="${OL}" stroke-width="6"/>
  ${scallops}
  <rect x="216" y="300" width="110" height="102" rx="6" fill="#F6EBD8" ${S}/>
  <circle cx="308" cy="352" r="7" fill="${OL}"/>
  <rect x="130" y="288" width="62" height="72" rx="10" fill="#FFF6E8" ${S}/>
  <rect x="350" y="288" width="62" height="72" rx="10" fill="#FFF6E8" ${S}/>
  <rect x="186" y="92" width="140" height="58" rx="16" fill="#FFFDF6" ${S}/>
  <ellipse cx="256" cy="416" rx="180" ry="22" fill="${OL}" opacity="0.10"/>`;
}

const shopPharmacy = `
  ${shopBase('#FFFDF6', '#7FC8BD', '#7FC8BD', '#E9F5F2')}
  <rect x="240" y="106" width="32" height="10" rx="5" fill="#7CC96B"/>
  <rect x="251" y="95" width="10" height="32" rx="5" fill="#7CC96B"/>
  <rect x="142" y="312" width="38" height="14" rx="7" transform="rotate(-20 161 319)" fill="#FF8FAB" ${S}/>
  <circle cx="381" cy="318" r="13" fill="#FFD166" ${S}/>`;

const shopBreakfast = `
  ${shopBase('#FFE8C8', '#F2764F', '#F2A65A', '#FFE8C8')}
  <circle cx="256" cy="114" r="15" fill="#FFF9F0" ${S}/>
  <path d="M248 104 Q252 98 256 104 M256 102 Q260 96 264 102" fill="none" stroke="${OL}" stroke-width="3"/>
  <ellipse cx="150" cy="384" rx="34" ry="12" fill="#E8C99A" ${S}/>
  <ellipse cx="150" cy="360" rx="34" ry="12" fill="#F2DDB8" ${S}/>
  <ellipse cx="150" cy="336" rx="34" ry="12" fill="#E8C99A" ${S}/>
  ${steam(150, 318, 0.8, '#FFFFFF')}
  <ellipse cx="382" cy="380" rx="24" ry="9" fill="#E8C99A" ${S}/>
  <ellipse cx="382" cy="362" rx="24" ry="9" fill="#F2DDB8" ${S}/>`;

const shopCoffee = `
  ${shopBase('#F3E5D3', '#8D5A3A', '#8D5A3A', '#F3E5D3')}
  <path d="M242 132 L242 112 Q242 104 250 104 L262 104 Q270 104 270 112 L270 132 Z" fill="#8D5A3A" ${S}/>
  <path d="M270 116 Q282 116 282 124 Q282 132 270 132" fill="none" stroke="#8D5A3A" stroke-width="6"/>
  ${steam(246, 94, 0.7, '#C9A06B')} ${steam(266, 94, 0.7, '#C9A06B')}
  <circle cx="381" cy="322" r="24" fill="#FFF6E8" ${S}/>
  <path d="M362 322 Q381 306 400 322" fill="none" stroke="#C9A06B" stroke-width="5" opacity="0.7"/>`;

const shopMilktea = `
  ${shopBase('#FFE3EC', '#E86A92', '#FF9EBB', '#FFE3EC')}
  <path d="M244 134 L244 106 Q244 98 252 98 L260 98 Q268 98 268 106 L268 134 Z" fill="#FFF6EA" ${S}/>
  <rect x="249" y="86" width="12" height="18" rx="6" transform="rotate(14 255 95)" fill="#E86A92"/>
  <circle cx="256" cy="144" r="4" fill="#7A4E33"/><circle cx="248" cy="140" r="3.4" fill="#7A4E33"/><circle cx="264" cy="140" r="3.4" fill="#7A4E33"/>
  <path d="M381 344 Q381 316 381 308 M381 344 Q368 344 368 356" stroke="#E86A92" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.6"/>`;

const shopFun = `
  ${shopBase('#FFF1DC', '#E2574C', '#FFD166', '#E2574C')}
  <circle cx="106" cy="141" r="6" fill="#FFD166"/><circle cx="146" cy="141" r="6" fill="#FFD166"/>
  <circle cx="366" cy="141" r="6" fill="#FFD166"/><circle cx="406" cy="141" r="6" fill="#FFD166"/>
  ${sparkle(256, 120, 0.8, '#FFF6E0', 0.95)}
  <path d="M238 112 L274 112 L266 140 L246 140 Z" fill="#FF8FAB" ${S}/>
  <circle cx="248" cy="106" r="9" fill="#FFF6E0" ${S}/><circle cx="262" cy="102" r="10" fill="#FFD166" ${S}/><circle cx="272" cy="112" r="8" fill="#FFF6E0" ${S}/>
  ${sparkle(150, 322, 0.9, '#E2574C', 0.35)}`;

const shopFood = `
  ${shopBase('#FFF6E8', '#E8835E', '#E8835E', '#FFF6E8')}
  <path d="M234 112 Q256 132 278 112 Q266 142 256 142 Q246 142 234 112 Z" fill="#E8835E" ${S}/>
  <path d="M244 118 L286 96 M252 126 L292 108" stroke="#C9A06B" stroke-width="5" stroke-linecap="round"/>
  <circle cx="150" cy="330" r="18" fill="#E2574C" ${S}/>
  <path d="M150 348 L150 372" stroke="#C9A06B" stroke-width="5"/>
  <circle cx="381" cy="322" r="16" fill="#FFD166" ${S}/>`;

// ---------------- 淘宝商品（33） ----------------

const tbPhone = `
  <rect x="186" y="118" width="140" height="262" rx="30" fill="#4E4A52" ${S}/>
  <rect x="198" y="136" width="116" height="212" rx="18" fill="#F2F7F3" stroke="none"/>
  <rect x="236" y="124" width="40" height="9" rx="4.5" fill="#2E2C31"/>
  ${heart(246, 218, 0.9, '#FF8FAB')}
  ${face(256, 282, 0.9, 22)}
  <rect x="240" y="360" width="32" height="5" rx="2.5" fill="#B9B4BD"/>`;

const tbEarbuds = `
  <circle cx="226" cy="168" r="25" fill="#FFFDF6" ${S}/>
  <circle cx="286" cy="168" r="25" fill="#FFFDF6" ${S}/>
  <circle cx="222" cy="162" r="10" fill="#FFD1DF" stroke="none"/>
  <circle cx="282" cy="162" r="10" fill="#FFD1DF" stroke="none"/>
  <rect x="218" y="188" width="17" height="58" rx="8.5" fill="#FFFDF6" ${S}/>
  <rect x="278" y="188" width="17" height="58" rx="8.5" fill="#FFFDF6" ${S}/>
  <rect x="192" y="252" width="128" height="112" rx="28" fill="#FFF9F0" ${S}/>
  <path d="M192 296 L320 296" stroke="${OL}" stroke-width="5" opacity="0.5"/>
  <circle cx="256" cy="282" r="5" fill="#FF8FAB"/>
  ${face(256, 336, 0.8, 22)}`;

const tbLaptop = `
  <rect x="156" y="138" width="200" height="134" rx="14" fill="#4E4A52" ${S}/>
  <rect x="168" y="150" width="176" height="110" rx="8" fill="#F2F7F3" stroke="none"/>
  ${face(256, 202, 0.8, 20)}
  <path d="M136 272 L376 272 L394 318 Q397 332 382 332 L130 332 Q115 332 118 318 Z" fill="#E8E2D6" ${S}/>
  <rect x="222" y="286" width="68" height="9" rx="4.5" fill="#C9C2B4"/>`;

const tbTablet = `
  <rect x="330" y="150" width="20" height="180" rx="10" transform="rotate(12 340 240)" fill="#FFB35C" ${S}/>
  <rect x="166" y="146" width="164" height="216" rx="24" fill="#4E4A52" ${S}/>
  <rect x="178" y="160" width="140" height="180" rx="14" fill="#F2F7F3" stroke="none"/>
  ${face(248, 244, 0.85, 20)}
  <circle cx="248" cy="352" r="5" fill="#8F8A96"/>`;

const tbWatch = `
  <rect x="228" y="112" width="56" height="112" rx="18" fill="#FF9EBB" ${S}/>
  <rect x="228" y="286" width="56" height="112" rx="18" fill="#FF9EBB" ${S}/>
  <rect x="194" y="206" width="124" height="102" rx="26" fill="#4E4A52" ${S}/>
  <rect x="206" y="218" width="100" height="78" rx="16" fill="#F2F7F3" stroke="none"/>
  ${heart(288, 232, 0.55, '#FF8FAB')}
  ${face(252, 258, 0.62, 16)}
  <circle cx="318" cy="257" r="8" fill="#FFD166" ${S}/>`;

const tbKeyboard = `
  <rect x="118" y="212" width="262" height="130" rx="18" fill="#FFFDF6" ${S}/>
  ${(() => {
    let keys = '';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++)
      keys += `<rect x="${136 + c * 26}" y="${228 + r * 26}" width="20" height="18" rx="4" fill="#F2ECE1"/>`;
    return keys;
  })()}
  <rect x="188" y="308" width="122" height="18" rx="5" fill="#F2ECE1"/>
  <rect x="392" y="252" width="52" height="84" rx="26" fill="#FFB35C" ${S}/>
  <path d="M418 268 L418 282" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>
  ${face(418, 312, 0.5, 9, 'smile')}`;

const tbSpeaker = `
  <path d="M216 168 Q216 116 256 116 Q296 116 296 168" fill="none" stroke="${OL}" stroke-width="13" stroke-linecap="round"/>
  <rect x="192" y="164" width="128" height="232" rx="42" fill="#FF9E5E" ${S}/>
  ${(() => {
    let dots = '';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++)
      dots += `<circle cx="${224 + c * 22}" cy="${206 + r * 20}" r="4.2" fill="#FFF6E0" opacity="0.55"/>`;
    return dots;
  })()}
  ${face(256, 330, 0.85, 22)}
  <rect x="212" y="372" width="88" height="8" rx="4" fill="#FFF6E0" opacity="0.6"/>`;

const tbPowerbank = `
  <rect x="186" y="160" width="140" height="204" rx="26" fill="#FFD166" ${S}/>
  <circle cx="212" cy="188" r="5" fill="#FFFDF6"/><circle cx="232" cy="188" r="5" fill="#FFFDF6"/>
  <circle cx="252" cy="188" r="5" fill="#FFFDF6"/><circle cx="272" cy="188" r="5" fill="#FFFDF6"/>
  <path d="M268 206 L226 282 L252 282 L242 330 L290 258 L262 258 Z" fill="#FFFDF6" stroke="${OL}" stroke-width="6" stroke-linejoin="round"/>
  ${face(256, 348, 0.6, 14)}
  <rect x="196" y="330" width="18" height="14" rx="4" fill="#4E4A52" stroke="none"/>
  <rect x="298" y="330" width="18" height="14" rx="4" fill="#4E4A52" stroke="none"/>`;

const tbTshirt = `
  <path d="M186 162 L148 202 L170 248 L194 232 L194 372 Q194 386 208 386 L304 386 Q318 386 318 372 L318 232 L342 248 L364 202 L326 162 Q298 150 256 150 Q214 150 186 162 Z" fill="#FF8FAB" ${S}/>
  <path d="M226 162 Q256 184 286 162" fill="none" stroke="${OL}" stroke-width="6"/>
  ${heart(256, 262, 1.1, '#FFF6E0')}
  ${face(256, 336, 0.85, 22)}`;

const tbJeans = `
  <rect x="186" y="148" width="140" height="36" rx="10" fill="#5E7FB8" ${S}/>
  <path d="M186 184 L326 184 L338 394 Q339 408 325 408 L287 408 Q277 408 276 396 L262 268 L249 396 Q248 408 238 408 L199 408 Q186 408 187 394 Z" fill="#5E7FB8" ${S}/>
  <path d="M204 196 Q216 218 234 196 M278 196 Q296 218 308 196" fill="none" stroke="#F2C069" stroke-width="5"/>
  <circle cx="256" cy="166" r="6" fill="#F2C069" ${S}/>
  <path d="M196 196 L194 260 M318 196 L322 260" stroke="#F2C069" stroke-width="4" stroke-dasharray="8 7"/>
  ${face(224, 330, 0.75, 13)}`;

const tbDress = `
  <path d="M222 150 L226 196 M290 150 L286 196" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>
  <path d="M212 190 L300 190 L316 246 L196 246 Z" fill="#FF9EBB" ${S}/>
  <path d="M196 246 L316 246 L358 400 Q360 414 345 414 L167 414 Q152 414 154 400 Z" fill="#FF9EBB" ${S}/>
  <rect x="192" y="240" width="132" height="22" rx="11" fill="#FFD166" ${S}/>
  ${heart(256, 152, 0.8, '#FFF6E0')}
  ${face(256, 216, 0.8, 20)}
  <circle cx="206" cy="300" r="6" fill="#FFF6E0"/><circle cx="306" cy="300" r="6" fill="#FFF6E0"/>
  <circle cx="256" cy="330" r="6" fill="#FFF6E0"/><circle cx="180" cy="372" r="6" fill="#FFF6E0"/>
  <circle cx="332" cy="372" r="6" fill="#FFF6E0"/><circle cx="256" cy="396" r="6" fill="#FFF6E0"/>`;

const tbJacket = `
  <rect x="228" y="180" width="56" height="200" rx="10" fill="#FFF6E8" ${S}/>
  ${face(256, 268, 0.62, 14)}
  <path d="M186 172 Q186 160 200 160 L228 160 L228 380 Q228 390 218 390 L196 390 Q186 390 186 380 Z" fill="#6FAE6A" ${S}/>
  <path d="M326 172 Q326 160 312 160 L284 160 L284 380 Q284 390 294 390 L316 390 Q326 390 326 380 Z" fill="#6FAE6A" ${S}/>
  <path d="M228 160 L256 186 L284 160" fill="none" stroke="${OL}" stroke-width="6"/>
  <rect x="146" y="184" width="46" height="130" rx="20" transform="rotate(-10 169 249)" fill="#6FAE6A" ${S}/>
  <rect x="320" y="184" width="46" height="130" rx="20" transform="rotate(10 343 249)" fill="#6FAE6A" ${S}/>
  <path d="M230 190 L230 372 M282 190 L282 372" stroke="${OL}" stroke-width="4" stroke-dasharray="7 6" opacity="0.6"/>
  <path d="M204 340 Q216 356 232 340 M280 340 Q296 356 308 340" fill="none" stroke="${OL}" stroke-width="5" opacity="0.6"/>`;

const tbHoodie = `
  <path d="M198 198 Q186 136 256 128 Q326 136 314 198 Q286 176 256 178 Q226 176 198 198 Z" fill="#E8A34C" ${S}/>
  <rect x="174" y="192" width="164" height="192" rx="24" fill="#F5B759" ${S}/>
  <path d="M238 198 L234 232 M274 198 L278 232" stroke="${OL}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="234" cy="238" r="5" fill="${OL}"/><circle cx="278" cy="238" r="5" fill="${OL}"/>
  ${face(256, 272, 0.85, 22)}
  <rect x="216" y="304" width="80" height="56" rx="14" fill="none" stroke="${OL}" stroke-width="6" opacity="0.7"/>`;

const tbSneakers = `
  <path d="M128 340 Q122 372 158 376 L366 376 Q394 374 392 348 Q390 332 370 330 L142 322 Q130 326 128 340 Z" fill="#FFFDF6" ${S}/>
  <path d="M150 322 Q148 242 210 234 Q262 230 284 268 Q302 296 342 306 L370 330 L142 322 Z" fill="#FF8FAB" ${S}/>
  <path d="M210 236 Q252 240 268 272" fill="none" stroke="#FFF6E0" stroke-width="7" opacity="0.8"/>
  <path d="M232 258 L258 278 M222 276 L248 296 M244 246 L270 266" stroke="#FFFDF6" stroke-width="9" stroke-linecap="round"/>
  ${face(330, 308, 0.6, 13)}
  <path d="M128 348 Q256 362 392 348" fill="none" stroke="#E3D7C2" stroke-width="5" opacity="0.8"/>`;

const tbBackpack = `
  <path d="M216 168 Q216 132 256 132 Q296 132 296 168" fill="none" stroke="${OL}" stroke-width="12" stroke-linecap="round"/>
  <rect x="176" y="164" width="160" height="224" rx="32" fill="#FFB35C" ${S}/>
  <path d="M176 224 Q176 164 230 164 L282 164 Q336 164 336 224 L336 250 L176 250 Z" fill="#EF9E4B" ${S}/>
  <rect x="240" y="238" width="32" height="24" rx="8" fill="#FFF6E0" ${S}/>
  <rect x="204" y="284" width="104" height="88" rx="20" fill="#FFD166" ${S}/>
  ${face(256, 328, 0.82, 20)}
  <path d="M186 286 Q176 286 176 300 M326 286 Q336 286 336 300" stroke="${OL}" stroke-width="6" opacity="0.5"/>`;

const tbLipstick = `
  <path d="M240 238 L272 238 L272 174 Q272 158 257 156 L240 198 Z" fill="#E85D5D" ${S}/>
  <rect x="226" y="238" width="60" height="162" rx="12" fill="#F2C069" ${S}/>
  <rect x="226" y="238" width="60" height="18" fill="#B98A66" stroke="none"/>
  ${face(256, 322, 0.62, 13)}
  <rect x="304" y="330" width="66" height="36" rx="14" transform="rotate(-16 337 348)" fill="#F2C069" ${S}/>
  ${sparkle(344, 200, 0.9, '#FF8FAB')}
  ${sparkle(180, 170, 0.7, '#FFD166')}`;

const tbPerfume = `
  <circle cx="368" cy="178" r="22" fill="#FF9EBB" ${S}/>
  <path d="M286 174 L348 178" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>
  ${sparkle(424, 150, 0.8, '#FFD166')}
  <circle cx="432" cy="200" r="5" fill="#FF9EBB" opacity="0.7"/>
  <rect x="236" y="196" width="40" height="36" fill="#F2C069" ${S}/>
  <rect x="226" y="158" width="60" height="42" rx="12" fill="#F2C069" ${S}/>
  <rect x="196" y="232" width="120" height="152" rx="26" fill="#FFD9E8" ${S}/>
  <path d="M196 300 L316 300 L316 358 Q316 384 290 384 L222 384 Q196 384 196 358 Z" fill="#FF9EBB" stroke="none" opacity="0.75"/>
  <rect x="196" y="232" width="120" height="152" rx="26" fill="none" stroke="${OL}" stroke-width="7"/>
  ${face(256, 306, 0.8, 20)}`;

const tbSkincare = `
  <rect x="256" y="216" width="34" height="30" fill="#FFFDF6" ${S}/>
  <rect x="238" y="202" width="52" height="18" rx="9" fill="#FFFDF6" ${S}/>
  <rect x="186" y="246" width="82" height="146" rx="20" fill="#FFFDF6" ${S}/>
  <rect x="200" y="292" width="54" height="8" rx="4" fill="#BEE3DD"/>
  ${face(227, 330, 0.62, 14)}
  <rect x="282" y="278" width="98" height="30" rx="12" fill="#FFFDF6" ${S}/>
  <rect x="288" y="308" width="86" height="84" rx="18" fill="#FFD9E8" ${S}/>
  <circle cx="331" cy="344" r="7" fill="#FF9EBB"/>`;

const tbMakeup = `
  <rect x="146" y="188" width="206" height="182" rx="22" fill="#FFFDF6" ${S}/>
  <circle cx="204" cy="250" r="27" fill="#FF9EBB" ${S}/>
  <circle cx="296" cy="250" r="27" fill="#F2A65A" ${S}/>
  <circle cx="204" cy="324" r="27" fill="#FFD166" ${S}/>
  <circle cx="296" cy="324" r="27" fill="#E8A0B8" ${S}/>
  ${face(250, 287, 0.5, 12, 'cat')}
  <rect x="366" y="170" width="22" height="150" rx="11" transform="rotate(18 377 245)" fill="#F2C069" ${S}/>
  <ellipse cx="352" cy="356" rx="17" ry="26" transform="rotate(18 352 356)" fill="#FFB35C" ${S}/>`;

const tbSofa = `
  <rect x="138" y="182" width="236" height="112" rx="26" fill="#FF9E7A" ${S}/>
  ${face(256, 216, 0.72, 18, 'cat')}
  <rect x="114" y="232" width="42" height="142" rx="18" fill="#F2885E" ${S}/>
  <rect x="356" y="232" width="42" height="142" rx="18" fill="#F2885E" ${S}/>
  <rect x="152" y="238" width="98" height="90" rx="16" fill="#FFB99A" ${S}/>
  <rect x="262" y="238" width="98" height="90" rx="16" fill="#FFB99A" ${S}/>
  <rect x="138" y="322" width="236" height="52" rx="16" fill="#FF9E7A" ${S}/>
  <rect x="152" y="374" width="18" height="22" fill="#B98A66" ${S}/>
  <rect x="342" y="374" width="18" height="22" fill="#B98A66" ${S}/>`;

const tbBedding = `
  <rect x="136" y="176" width="240" height="94" rx="18" fill="#B98A66" ${S}/>
  <rect x="136" y="248" width="240" height="72" rx="14" fill="#FFFDF6" ${S}/>
  <rect x="164" y="228" width="104" height="46" rx="18" fill="#FFE9D6" ${S}/>
  <rect x="136" y="290" width="240" height="66" rx="16" fill="#FF9EBB" ${S}/>
  <path d="M136 306 L376 306" stroke="#FFF6E0" stroke-width="6" opacity="0.7"/>
  ${face(256, 326, 0.8, 20)}
  <rect x="150" y="356" width="16" height="26" fill="#8D6E52" ${S}/>
  <rect x="346" y="356" width="16" height="26" fill="#8D6E52" ${S}/>
  ${sparkle(110, 160, 0.8, '#FFD166')}`;

const tbLamp = `
  <path d="M256 96 L256 118 M186 112 L198 130 M326 112 L314 130" stroke="#FFD166" stroke-width="7" stroke-linecap="round" opacity="0.8"/>
  <path d="M198 192 L314 192 L340 282 L172 282 Z" fill="#FFD166" ${S}/>
  ${face(256, 240, 0.85, 22)}
  <rect x="248" y="282" width="16" height="66" fill="#B98A66" ${S}/>
  <ellipse cx="256" cy="356" rx="58" ry="18" fill="#B98A66" ${S}/>
  <ellipse cx="256" cy="352" rx="58" ry="16" fill="#C9A06B" stroke="none"/>`;

const tbMug = `
  ${steam(226, 178, 0.9)} ${steam(272, 170, 1)}
  <path d="M314 254 Q374 254 374 296 Q374 338 314 338" fill="none" stroke="${OL}" stroke-width="26"/>
  <path d="M314 254 Q374 254 374 296 Q374 338 314 338" fill="none" stroke="#FF9EBB" stroke-width="13"/>
  <rect x="184" y="206" width="132" height="156" rx="28" fill="#FF9EBB" ${S}/>
  ${heart(250, 262, 1, '#FFF6E0')}
  ${face(250, 326, 0.8, 20)}`;

const tbVase = `
  <path d="M226 236 L216 160 M256 232 L256 140 M286 236 L296 160" stroke="${OL}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="214" cy="142" r="26" fill="#FF9EBB" ${S}/>
  <circle cx="256" cy="118" r="28" fill="#FFD166" ${S}/>
  <circle cx="298" cy="142" r="26" fill="#F6A6C1" ${S}/>
  <ellipse cx="196" cy="196" rx="15" ry="8" fill="#8CC152" transform="rotate(-32 196 196)"/>
  <ellipse cx="316" cy="196" rx="15" ry="8" fill="#8CC152" transform="rotate(32 316 196)"/>
  <rect x="236" y="224" width="40" height="36" fill="#BFD9C8" ${S}/>
  <path d="M226 258 Q196 300 206 350 Q214 400 256 400 Q298 400 306 350 Q316 300 286 258 Z" fill="#BFD9C8" ${S}/>
  ${face(256, 326, 0.85, 20)}`;

const tbPillow = `
  <path d="M150 210 Q256 158 362 210 Q404 258 362 322 Q256 370 150 322 Q108 258 150 210 Z" fill="#FFE9D6" ${S}/>
  <path d="M150 212 L136 196 M362 212 L376 196 M150 320 L136 336 M362 320 L376 336" stroke="${OL}" stroke-width="6" stroke-linecap="round" opacity="0.6"/>
  ${face(256, 264, 1, 28)}`;

const tbDesk = `
  <rect x="126" y="218" width="260" height="28" rx="10" fill="#D9B98C" ${S}/>
  <rect x="146" y="246" width="20" height="116" fill="#C9A06B" ${S}/>
  <rect x="296" y="246" width="92" height="116" rx="12" fill="#FFE9D6" ${S}/>
  <path d="M296 304 L388 304" stroke="${OL}" stroke-width="5" opacity="0.6"/>
  <circle cx="312" cy="276" r="6" fill="${OL}"/><circle cx="312" cy="332" r="6" fill="${OL}"/>
  ${face(352, 300, 0.58, 12)}
  <rect x="160" y="238" width="26" height="10" rx="5" fill="#E2574C" ${S}/>
  <path d="M173 238 Q166 222 173 214 M173 238 Q180 224 186 220" stroke="#8CC152" stroke-width="8" fill="none" stroke-linecap="round"/>
  <ellipse cx="256" cy="380" rx="180" ry="20" fill="${OL}" opacity="0.08"/>`;

const tbToy = `
  <circle cx="210" cy="152" r="21" fill="#E8B287" ${S}/><circle cx="302" cy="152" r="21" fill="#E8B287" ${S}/>
  <circle cx="210" cy="152" r="9" fill="#FFD9C4" stroke="none"/><circle cx="302" cy="152" r="9" fill="#FFD9C4" stroke="none"/>
  <ellipse cx="256" cy="330" rx="56" ry="64" fill="#E8B287" ${S}/>
  <ellipse cx="256" cy="342" rx="30" ry="38" fill="#FFD9C4" stroke="none"/>
  <circle cx="196" cy="308" r="21" fill="#E8B287" ${S}/><circle cx="316" cy="308" r="21" fill="#E8B287" ${S}/>
  <circle cx="224" cy="390" r="23" fill="#E8B287" ${S}/><circle cx="288" cy="390" r="23" fill="#E8B287" ${S}/>
  <ellipse cx="224" cy="394" rx="11" ry="13" fill="#FFD9C4" stroke="none"/><ellipse cx="288" cy="394" rx="11" ry="13" fill="#FFD9C4" stroke="none"/>
  <circle cx="256" cy="200" r="62" fill="#E8B287" ${S}/>
  <ellipse cx="256" cy="224" rx="25" ry="19" fill="#FFF3E2" stroke="none"/>
  ${face(256, 196, 0.9, 26, 'none')}
  <ellipse cx="256" cy="216" rx="7" ry="5.5" fill="${EYE}"/>
  <path d="M256 222 L256 230 M256 230 Q250 236 245 231 M256 230 Q262 236 267 231" fill="none" stroke="${EYE}" stroke-width="4" stroke-linecap="round"/>`;

const tbUmbrella = `
  <path d="M256 128 L256 116" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>
  <circle cx="256" cy="112" r="9" fill="#FFD166" ${S}/>
  <path d="M116 282 Q126 148 256 142 Q386 148 396 282 Q366 258 336 284 Q306 258 276 284 Q256 268 236 284 Q206 258 176 284 Q146 258 116 282 Z" fill="#FF8FAB" ${S}/>
  <path d="M256 146 Q236 200 236 278 M256 146 Q276 200 276 278 M256 146 Q186 190 146 268 M256 146 Q326 190 366 268" fill="none" stroke="${OL}" stroke-width="4" opacity="0.35"/>
  ${face(256, 218, 0.9, 26)}
  <path d="M256 282 L256 372 Q256 396 234 396 Q216 396 216 380" fill="none" stroke="#8D5A3A" stroke-width="11" stroke-linecap="round"/>`;

const tbWaterBottle = `
  <circle cx="256" cy="132" r="16" fill="none" stroke="${OL}" stroke-width="9"/>
  <rect x="226" y="142" width="60" height="42" rx="12" fill="#F2A65A" ${S}/>
  <rect x="204" y="182" width="104" height="222" rx="30" fill="#BEE3DD" ${S}/>
  <circle cx="230" cy="240" r="6" fill="#FFFFFF" opacity="0.7"/>
  <circle cx="282" cy="268" r="5" fill="#FFFFFF" opacity="0.7"/>
  <circle cx="238" cy="256" r="4" fill="#FFFFFF" opacity="0.6"/>
  <rect x="204" y="288" width="104" height="44" fill="#FFF6EA" stroke="none"/>
  ${face(256, 312, 0.72, 18)}
  <rect x="204" y="182" width="104" height="222" rx="30" fill="none" stroke="${OL}" stroke-width="7"/>`;

const tbSnacks = `
  <path d="M170 196 L342 196 L334 176 L178 176 Z" fill="#F2C069" ${S}/>
  <path d="M166 204 Q256 178 346 204 Q366 296 346 384 Q256 410 166 384 Q146 296 166 204 Z" fill="#FFD166" ${S}/>
  <circle cx="256" cy="294" r="66" fill="#FFF6E8" ${S}/>
  ${sparkle(256, 258, 1.1, '#F2A65A', 0.9)}
  ${face(256, 316, 0.85, 20)}
  <path d="M186 226 L196 214 M236 212 L242 198 M296 210 L304 224 M322 240 L336 232" stroke="${OL}" stroke-width="5" stroke-linecap="round" opacity="0.4"/>`;

const tbCookies = `
  <circle cx="222" cy="288" r="88" fill="#E8B287" ${S}/>
  <circle cx="296" cy="224" r="28" fill="#FFF8EA" stroke="none"/>
  <ellipse cx="186" cy="246" rx="12" ry="9" fill="#6B4A3A"/><ellipse cx="264" cy="266" rx="12" ry="9" fill="#6B4A3A"/>
  <ellipse cx="246" cy="334" rx="12" ry="9" fill="#6B4A3A"/><ellipse cx="168" cy="298" rx="10" ry="8" fill="#6B4A3A"/>
  <ellipse cx="226" cy="360" rx="10" ry="8" fill="#6B4A3A"/>
  ${face(214, 290, 0.9, 22)}
  <circle cx="330" cy="352" r="36" fill="#E8B287" ${S}/>
  <ellipse cx="324" cy="344" rx="6" ry="5" fill="#6B4A3A"/><ellipse cx="342" cy="360" rx="6" ry="5" fill="#6B4A3A"/>`;

const tbTea = `
  <rect x="186" y="178" width="140" height="42" rx="14" fill="#FFFDF6" ${S}/>
  <rect x="232" y="162" width="48" height="18" rx="9" fill="#FFFDF6" ${S}/>
  <rect x="196" y="220" width="120" height="172" rx="18" fill="#7FB069" ${S}/>
  <ellipse cx="238" cy="272" rx="17" ry="9" fill="#FFF6E0" transform="rotate(-32 238 272)"/>
  <ellipse cx="276" cy="286" rx="17" ry="9" fill="#FFF6E0" transform="rotate(28 276 286)"/>
  ${face(256, 330, 0.85, 22)}
  <path d="M186 199 L326 199" stroke="#E3D7C2" stroke-width="4" opacity="0.7"/>`;

const tbBooks = `
  <rect x="156" y="318" width="200" height="48" rx="10" fill="#E85D5D" ${S}/>
  <rect x="176" y="272" width="160" height="48" rx="10" fill="#FFD166" ${S}/>
  <rect x="166" y="226" width="180" height="48" rx="10" fill="#FF9EBB" ${S}/>
  <rect x="316" y="234" width="14" height="32" rx="4" fill="#FFF6E0" stroke="none"/>
  <rect x="326" y="280" width="14" height="32" rx="4" fill="#FFF6E0" stroke="none"/>
  <rect x="316" y="326" width="14" height="32" rx="4" fill="#FFF6E0" stroke="none"/>
  ${face(250, 250, 0.72, 18)}
  ${sparkle(112, 200, 0.85, '#FFD166')}`;

// ---------------- Task 60 补齐品类（帽子/相机/大衣/衬衫/门锁/冰箱/洗衣机/礼盒/终端机/古建） ----------------

const tbHat = `
  <path d="M150 300 Q150 176 256 176 Q362 176 362 300 L356 318 L156 318 Z" fill="#FF8FAB" ${S}/>
  <path d="M150 300 Q256 316 362 300 L382 330 Q388 348 366 352 Q256 368 146 352 Q124 348 130 330 Z" fill="#FFA5BC" ${S}/>
  <path d="M256 176 Q262 220 258 258 M206 190 Q216 226 212 262 M306 190 Q296 226 300 262" fill="none" stroke="${OL}" stroke-width="4.5" opacity="0.3"/>
  ${face(256, 264, 0.78, 20)}
  <circle cx="256" cy="182" r="13" fill="#FFD166" ${S}/>
  ${heart(338, 226, 0.55, '#FFFFFF')}`;

const tbCamera = `
  <rect x="214" y="150" width="84" height="40" rx="12" fill="#8FA6C4" ${S}/>
  <rect x="136" y="182" width="240" height="180" rx="34" fill="#A9BFD9" ${S}/>
  <circle cx="256" cy="274" r="62" fill="#E9EFF6" ${S}/>
  <circle cx="256" cy="274" r="40" fill="#5C6B7E" stroke="none"/>
  <circle cx="256" cy="274" r="40" fill="none" stroke="${OL}" stroke-width="7"/>
  <circle cx="242" cy="260" r="10" fill="#FFFFFF" opacity="0.85"/>
  ${face(256, 296, 0.42, 12, 'cat')}
  <rect x="318" y="200" width="34" height="22" rx="8" fill="#FFD166" ${S}/>
  <circle cx="176" cy="212" r="9" fill="#FF8FAB" ${S}/>
  ${sparkle(150, 320, 0.8, '#FFD166')}`;

const tbCoat = `
  <path d="M256 132 L196 150 L160 196 L196 224 L200 388 L312 388 L316 224 L352 196 L316 150 Z" fill="#D9A05B" ${S}/>
  <path d="M256 132 L226 176 L256 226 L286 176 Z" fill="#E8B374" ${S}/>
  <path d="M256 226 L256 380" stroke="${OL}" stroke-width="5" opacity="0.5"/>
  <circle cx="224" cy="330" r="6" fill="#8D5A3A"/><circle cx="288" cy="330" r="6" fill="#8D5A3A"/>
  <path d="M196 224 L200 388 M316 224 L312 388" stroke="${OL}" stroke-width="5" opacity="0.35"/>
  ${face(256, 296, 0.72, 19)}
  <path d="M232 160 L226 196 M280 160 L286 196" stroke="${OL}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
  ${sparkle(188, 270, 0.7, '#FFF6E0', 0.9)}`;

const tbShirt = `
  <path d="M256 138 L208 152 L150 190 L172 250 L198 234 L198 384 L314 384 L314 234 L340 250 L362 190 L304 152 Z" fill="#BFD9EE" ${S}/>
  <path d="M256 138 L224 178 L256 216 L288 178 Z" fill="#E6F1FA" ${S}/>
  <path d="M256 216 L256 380" stroke="${OL}" stroke-width="5" opacity="0.5"/>
  ${face(256, 296, 0.72, 19)}
  <rect x="286" y="252" width="44" height="52" rx="8" fill="none" stroke="${OL}" stroke-width="5" opacity="0.55"/>
  <path d="M224 178 L232 196 M288 178 L280 196" stroke="${OL}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
  ${sparkle(320, 330, 0.7, '#FFFFFF', 0.9)}`;

const tbLock = `
  <rect x="196" y="112" width="120" height="288" rx="30" fill="#8FA6C4" ${S}/>
  <rect x="214" y="140" width="84" height="96" rx="16" fill="#E9EFF6" ${S}/>
  ${face(256, 186, 0.6, 16, 'cat')}
  <circle cx="236" cy="266" r="6" fill="#E9EFF6"/><circle cx="256" cy="266" r="6" fill="#E9EFF6"/><circle cx="276" cy="266" r="6" fill="#E9EFF6"/>
  <circle cx="236" cy="288" r="6" fill="#E9EFF6"/><circle cx="256" cy="288" r="6" fill="#FFD166"/><circle cx="276" cy="288" r="6" fill="#E9EFF6"/>
  <circle cx="236" cy="310" r="6" fill="#E9EFF6"/><circle cx="256" cy="310" r="6" fill="#E9EFF6"/><circle cx="276" cy="310" r="6" fill="#E9EFF6"/>
  <circle cx="256" cy="352" r="17" fill="#FFD166" ${S}/>
  ${sparkle(150, 200, 0.9, '#FFD166')}`;

const tbFridge = `
  <rect x="172" y="104" width="168" height="304" rx="26" fill="#BEE3DD" ${S}/>
  <path d="M172 232 L340 232" stroke="${OL}" stroke-width="7"/>
  <rect x="196" y="136" width="52" height="12" rx="6" fill="${OL}" opacity="0.8"/>
  <rect x="196" y="256" width="52" height="12" rx="6" fill="${OL}" opacity="0.8"/>
  ${face(286, 318, 0.72, 18)}
  <path d="M212 344 L226 356 M240 344 L226 356" stroke="${OL}" stroke-width="5" stroke-linecap="round" opacity="0.5"/>
  ${sparkle(140, 170, 0.85, '#FFFFFF', 0.9)}
  ${heart(370, 300, 0.5, '#FF8FAB')}`;

const tbWasher = `
  <rect x="156" y="120" width="200" height="288" rx="26" fill="#D9E5F2" ${S}/>
  <rect x="156" y="120" width="200" height="66" rx="26" fill="#A9BFD9" ${S}/>
  <circle cx="206" cy="153" r="13" fill="#FFD166" ${S}/>
  <rect x="240" y="144" width="76" height="18" rx="9" fill="#E9EFF6" ${S}/>
  <circle cx="256" cy="304" r="66" fill="#8FA6C4" ${S}/>
  <circle cx="256" cy="304" r="46" fill="#E9F2FA" stroke="none"/>
  <circle cx="256" cy="304" r="46" fill="none" stroke="${OL}" stroke-width="6" opacity="0.55"/>
  <path d="M226 296 Q256 278 286 296 M224 316 Q256 334 288 314" fill="none" stroke="#8FB6D9" stroke-width="7" stroke-linecap="round"/>
  ${sparkle(376, 220, 0.8, '#FFD166')}`;

const tbGift = `
  <path d="M182 136 L330 136 L330 200 L182 200 Z" fill="#FF8FAB" ${S}/>
  <rect x="160" y="200" width="192" height="196" rx="18" fill="#FFA5BC" ${S}/>
  <path d="M232 200 L232 396 M280 200 L280 396" stroke="#FFF6E0" stroke-width="18"/>
  <path d="M232 200 L232 396 M280 200 L280 396" stroke="${OL}" stroke-width="4" opacity="0.25"/>
  <path d="M256 136 Q216 84 188 108 Q166 128 200 140 M256 136 Q296 84 324 108 Q346 128 312 140" fill="#FFF6E0" ${S}/>
  ${face(256, 314, 0.72, 42)}
  ${sparkle(140, 260, 0.85, '#FFD166')}
  ${sparkle(376, 330, 0.7, '#FFFFFF', 0.9)}`;

const tbKiosk = `
  <rect x="236" y="356" width="40" height="52" fill="#8FA6C4" ${S}/>
  <ellipse cx="256" cy="410" rx="66" ry="14" fill="#8FA6C4" ${S}/>
  <rect x="164" y="120" width="184" height="240" rx="24" fill="#A9BFD9" ${S}/>
  <rect x="184" y="144" width="144" height="118" rx="14" fill="#E9EFF6" ${S}/>
  ${face(256, 202, 0.62, 16)}
  <rect x="196" y="282" width="34" height="26" rx="7" fill="#FFD166" ${S}/>
  <rect x="239" y="282" width="34" height="26" rx="7" fill="#E9EFF6" ${S}/>
  <rect x="282" y="282" width="34" height="26" rx="7" fill="#E9EFF6" ${S}/>
  ${sparkle(140, 176, 0.85, '#FFD166')}
  ${sparkle(376, 300, 0.7, '#FFFFFF', 0.9)}`;

const tbTemple = `
  <path d="M96 216 Q166 168 256 164 Q346 168 416 216 Q396 234 372 228 Q346 244 318 232 Q286 248 256 236 Q226 248 194 232 Q166 244 140 228 Q116 234 96 216 Z" fill="#E8695A" ${S}/>
  <path d="M236 130 L276 130 L268 164 L244 164 Z" fill="#FFD166" ${S}/>
  <path d="M256 96 L256 130 M238 108 L274 108" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>
  <rect x="150" y="248" width="212" height="152" rx="10" fill="#FFF1DC" ${S}/>
  <rect x="172" y="272" width="40" height="128" rx="8" fill="#C9705E" ${S}/>
  <rect x="300" y="272" width="40" height="128" rx="8" fill="#C9705E" ${S}/>
  ${face(256, 330, 0.72, 18)}
  ${sparkle(120, 320, 0.8, '#FFD166')}
  ${sparkle(396, 180, 0.7, '#FFFFFF', 0.9)}`;

// ---------------- Task 61 全品类扩展（手机支架/鼠标/显示器/电视/家电/服饰配饰/运动文具…42 张） ----------------

const tbPhoneStand = `
  <g transform="rotate(-9 266 250)">
    <rect x="206" y="140" width="120" height="216" rx="18" fill="#8FA6C4" ${S}/>
    <rect x="222" y="164" width="88" height="152" rx="10" fill="#E9EFF6" stroke="none"/>
    ${face(266, 240, 0.58, 14)}
  </g>
  <path d="M170 356 L342 356 Q360 356 360 338 L360 330 Q360 318 344 318 L168 318 Q152 318 152 330 L152 356 Z" fill="#FFD166" ${S}/>
  <path d="M186 318 L186 356 M326 318 L326 356" stroke="${OL}" stroke-width="5" opacity="0.35"/>
  ${sparkle(146, 170, 0.85, '#FFD166')}`;

const tbMouse = `
  <path d="M256 138 Q348 138 356 246 Q362 336 300 364 Q256 380 212 364 Q150 336 156 246 Q164 138 256 138 Z" fill="#A9BFD9" ${S}/>
  <path d="M256 138 L256 240" stroke="${OL}" stroke-width="6" opacity="0.5"/>
  <path d="M166 252 Q256 232 346 252" fill="none" stroke="${OL}" stroke-width="6" opacity="0.35"/>
  <rect x="242" y="160" width="28" height="48" rx="14" fill="#E9EFF6" ${S}/>
  ${face(256, 302, 0.78, 20)}
  ${sparkle(146, 186, 0.8, '#FFD166')}`;

const tbMonitor = `
  <rect x="236" y="356" width="40" height="34" fill="#8FA6C4" ${S}/>
  <rect x="178" y="384" width="156" height="20" rx="10" fill="#8FA6C4" ${S}/>
  <rect x="124" y="136" width="264" height="222" rx="20" fill="#A9BFD9" ${S}/>
  <rect x="144" y="156" width="224" height="166" rx="10" fill="#E9EFF6" stroke="none"/>
  ${face(256, 240, 0.72, 18)}
  <circle cx="344" cy="336" r="8" fill="#FFD166" ${S}/>
  ${sparkle(104, 180, 0.8, '#FFD166')}`;

const tbTv = `
  <path d="M216 110 L254 148 M296 110 L258 148" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="212" cy="106" r="9" fill="#FFD166" ${S}/><circle cx="300" cy="106" r="9" fill="#FFD166" ${S}/>
  <rect x="118" y="148" width="276" height="182" rx="18" fill="#D9A05B" ${S}/>
  <rect x="138" y="166" width="236" height="132" rx="10" fill="#FFF1DC" stroke="none"/>
  ${face(256, 232, 0.68, 17)}
  <rect x="186" y="330" width="20" height="26" fill="#B98A66" ${S}/><rect x="306" y="330" width="20" height="26" fill="#B98A66" ${S}/>
  ${sparkle(96, 200, 0.8, '#FFD166')}`;

const tbDrone = `
  <path d="M208 234 L154 192 M304 234 L358 192 M208 292 L154 334 M304 292 L358 334" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>
  <ellipse cx="150" cy="186" rx="52" ry="12" fill="#E9EFF6" ${S}/>
  <ellipse cx="362" cy="186" rx="52" ry="12" fill="#E9EFF6" ${S}/>
  <ellipse cx="150" cy="340" rx="52" ry="12" fill="#E9EFF6" ${S}/>
  <ellipse cx="362" cy="340" rx="52" ry="12" fill="#E9EFF6" ${S}/>
  <ellipse cx="256" cy="264" rx="62" ry="44" fill="#8FA6C4" ${S}/>
  ${face(256, 262, 0.52, 14, 'cat')}
  <circle cx="256" cy="312" r="12" fill="#FFD166" ${S}/>
  ${sparkle(112, 268, 0.75, '#FFD166')}`;

const tbGamepad = `
  <path d="M156 190 Q256 168 356 190 Q394 198 400 240 L410 300 Q414 344 376 348 Q344 350 322 324 L306 308 L206 308 L190 324 Q168 350 136 348 Q98 344 102 300 L112 240 Q118 198 156 190 Z" fill="#A9BFD9" ${S}/>
  <path d="M188 226 L188 264 M169 245 L207 245" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>
  <circle cx="338" cy="242" r="24" fill="#E9EFF6" ${S}/>
  <circle cx="338" cy="230" r="7" fill="#FFD166"/><circle cx="338" cy="254" r="7" fill="#5C6B7E"/>
  <circle cx="326" cy="242" r="7" fill="#8CC152"/><circle cx="350" cy="242" r="7" fill="#E8695A"/>
  ${face(256, 250, 0.5, 11)}
  ${sparkle(128, 174, 0.75, '#FFD166')}`;

const tbFan = `
  <rect x="244" y="306" width="24" height="82" fill="#8FA6C4" ${S}/>
  <ellipse cx="256" cy="392" rx="66" ry="16" fill="#8FA6C4" ${S}/>
  <circle cx="256" cy="216" r="104" fill="#E9F2FA" ${S}/>
  <circle cx="256" cy="216" r="104" fill="none" stroke="${OL}" stroke-width="4" opacity="0.3"/>
  <path d="M256 118 L256 314 M164 168 L348 264 M348 168 L164 264" stroke="${OL}" stroke-width="3" opacity="0.3"/>
  <circle cx="256" cy="216" r="34" fill="#FFD166" ${S}/>
  ${face(256, 218, 0.42, 10, 'cat')}
  <path d="M232 186 Q256 176 280 186" fill="none" stroke="#A9BFD9" stroke-width="10" stroke-linecap="round" opacity="0.9"/>`;

const tbMicrowave = `
  <rect x="108" y="168" width="296" height="184" rx="20" fill="#D9E5F2" ${S}/>
  <rect x="134" y="194" width="152" height="132" rx="10" fill="#8FA6C4" ${S}/>
  <rect x="148" y="208" width="124" height="104" rx="6" fill="#E9EFF6" stroke="none"/>
  ${face(210, 258, 0.5, 12)}
  <rect x="326" y="194" width="26" height="94" rx="12" fill="#FFD166" ${S}/>
  <circle cx="366" cy="230" r="16" fill="#E9EFF6" ${S}/><circle cx="366" cy="276" r="16" fill="#E9EFF6" ${S}/>
  ${sparkle(86, 220, 0.75, '#FFD166')}`;

const tbRiceCooker = `
  ${steam(238, 116, 0.7)} ${steam(278, 110, 0.85)}
  <rect x="234" y="122" width="44" height="18" rx="9" fill="#FFD166" ${S}/>
  <path d="M182 140 L330 140 Q346 140 346 156 L346 178 Q346 192 330 192 L182 192 Q166 192 166 178 L166 156 Q166 140 182 140 Z" fill="#E9EFF6" ${S}/>
  <path d="M188 192 L324 192 L312 350 Q310 376 284 376 L228 376 Q202 376 200 350 Z" fill="#D9A05B" ${S}/>
  <rect x="214" y="230" width="84" height="16" rx="8" fill="#FFF6E0" opacity="0.75"/>
  ${face(256, 302, 0.64, 15)}
  ${heart(352, 250, 0.5, '#FF8FAB')}`;

const tbVacuum = `
  <rect x="242" y="112" width="20" height="140" rx="10" fill="#8FA6C4" ${S}/>
  <rect x="226" y="92" width="52" height="30" rx="14" fill="#E9EFF6" ${S}/>
  <circle cx="256" cy="278" r="46" fill="#FFD166" ${S}/>
  ${face(256, 276, 0.52, 11, 'cat')}
  <path d="M224 324 L288 324 L280 358 Q278 370 264 370 L248 370 Q234 370 232 358 Z" fill="#8FA6C4" ${S}/>
  <rect x="218" y="362" width="76" height="14" rx="7" fill="#5C6B7E" stroke="none"/>
  ${sparkle(158, 200, 0.8, '#FFD166')}`;

const tbKettle = `
  <circle cx="245" cy="168" r="10" fill="#FFD166" ${S}/>
  <rect x="186" y="176" width="118" height="30" rx="12" fill="#E9EFF6" ${S}/>
  <rect x="170" y="200" width="150" height="176" rx="24" fill="#BEE3DD" ${S}/>
  <path d="M320 238 L364 214 L364 246 L320 274 Z" fill="#BEE3DD" ${S}/>
  <path d="M170 238 Q114 252 128 298 Q138 330 172 332" fill="none" stroke="${OL}" stroke-width="24"/>
  <path d="M170 238 Q114 252 128 298 Q138 330 172 332" fill="none" stroke="#BEE3DD" stroke-width="12"/>
  ${face(245, 300, 0.6, 14)}
  ${steam(356, 196, 0.6, '#FFFFFF')}`;

const tbAirFryer = `
  <path d="M164 190 L164 164 Q164 132 196 132 L316 132 Q348 132 348 164 L348 190 Z" fill="#E9B374" ${S}/>
  <circle cx="208" cy="161" r="12" fill="#FFD166" ${S}/>
  <rect x="248" y="151" width="72" height="20" rx="10" fill="#E9EFF6" ${S}/>
  <path d="M164 186 L348 186 L348 306 Q348 368 256 368 Q164 368 164 306 Z" fill="#D9A05B" ${S}/>
  <rect x="196" y="214" width="120" height="84" rx="14" fill="#8D5A3A" stroke="none"/>
  ${face(256, 256, 0.55, 13)}
  <rect x="212" y="316" width="88" height="18" rx="9" fill="#FFD166" ${S}/>`;

const tbCoffeeMachine = `
  <rect x="150" y="118" width="200" height="60" rx="16" fill="#8D5A3A" ${S}/>
  <rect x="150" y="178" width="200" height="42" rx="10" fill="#A56428" ${S}/>
  <rect x="166" y="220" width="168" height="148" rx="16" fill="#8D5A3A" ${S}/>
  <rect x="228" y="178" width="44" height="34" fill="#5C4A3D" stroke="none"/>
  ${steam(250, 240, 0.65)}
  <rect x="224" y="252" width="64" height="52" rx="10" fill="#FFF6E0" ${S}/>
  ${face(198, 296, 0.55, 12)}
  <rect x="304" y="208" width="22" height="16" rx="7" fill="#FFD166" ${S}/>
  <circle cx="315" cy="252" r="11" fill="#FF8FAB" ${S}/>`;

const tbHumidifier = `
  ${steam(234, 152, 0.9)} ${steam(278, 144, 1.05)}
  <path d="M216 200 Q186 244 192 302 Q198 372 256 372 Q314 372 320 302 Q326 244 296 200 Z" fill="#BEE3DD" ${S}/>
  <rect x="234" y="168" width="44" height="32" rx="11" fill="#8FA6C4" ${S}/>
  ${face(256, 296, 0.7, 16)}
  <circle cx="222" cy="250" r="5" fill="#FFFFFF" opacity="0.75"/><circle cx="292" cy="268" r="4" fill="#FFFFFF" opacity="0.7"/>`;

const tbShaver = `
  <circle cx="226" cy="150" r="17" fill="#FFD166" ${S}/><circle cx="256" cy="146" r="17" fill="#FFD166" ${S}/><circle cx="286" cy="150" r="17" fill="#FFD166" ${S}/>
  <path d="M212 150 L300 150 L300 202 L212 202 Z" fill="#E9EFF6" ${S}/>
  <rect x="228" y="198" width="56" height="178" rx="24" fill="#8FA6C4" ${S}/>
  ${face(256, 288, 0.5, 11)}
  <rect x="240" y="240" width="32" height="12" rx="6" fill="#FFD166" stroke="none"/>`;

const tbToothbrush = `
  <path d="M244 140 L244 122 M256 140 L256 118 M268 140 L268 122" stroke="#8CC152" stroke-width="8" stroke-linecap="round"/>
  <path d="M236 200 L276 200 L276 150 Q276 138 264 138 L248 138 Q236 138 236 150 Z" fill="#FFF6E0" ${S}/>
  <rect x="232" y="196" width="48" height="180" rx="22" fill="#FF9EBB" ${S}/>
  ${face(256, 296, 0.5, 11)}
  <rect x="244" y="238" width="24" height="10" rx="5" fill="#FFD166" stroke="none"/>
  ${sparkle(320, 160, 0.75, '#8CC152', 0.8)}`;

const tbHairdryer = `
  <circle cx="296" cy="222" r="78" fill="#FF8FAB" ${S}/>
  <rect x="352" y="198" width="72" height="48" rx="12" fill="#FFA5BC" ${S}/>
  <path d="M366 198 L366 246 M386 198 L386 246 M406 198 L406 246" stroke="${OL}" stroke-width="4" opacity="0.35"/>
  <rect x="222" y="196" width="42" height="92" rx="18" fill="#FFA5BC" ${S}/>
  <rect x="232" y="288" width="32" height="94" rx="16" fill="#FF8FAB" ${S}/>
  ${face(296, 220, 0.5, 12, 'cat')}
  <circle cx="252" cy="166" r="12" fill="#FFD166" ${S}/>`;

const tbBelt = `
  <circle cx="256" cy="272" r="96" fill="none" stroke="#8D5A3A" stroke-width="36"/>
  <circle cx="256" cy="272" r="96" fill="none" stroke="${OL}" stroke-width="6"/>
  <circle cx="256" cy="272" r="78" fill="none" stroke="${OL}" stroke-width="6" opacity="0.4"/>
  <rect x="238" y="158" width="36" height="54" rx="10" fill="#FFD166" ${S}/>
  <circle cx="256" cy="186" r="7" fill="${OL}"/>
  ${face(256, 300, 0.6, 14)}
  ${sparkle(146, 178, 0.8, '#FFD166')}`;

const tbScarf = `
  <path d="M170 140 Q256 108 342 140 L342 168 Q256 142 170 168 Z" fill="#FF9EBB" ${S}/>
  <path d="M198 162 Q188 244 196 302 L246 302 Q238 244 246 178 Z" fill="#FFB7C9" ${S}/>
  <path d="M266 178 Q274 244 266 302 L316 302 Q306 244 316 162 Z" fill="#FFB7C9" ${S}/>
  <path d="M202 302 L202 324 M218 302 L218 324 M234 302 L234 324 M272 302 L272 324 M288 302 L288 324 M304 302 L304 324" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>
  <path d="M200 216 L244 212 M270 230 L314 226" stroke="${OL}" stroke-width="5" opacity="0.3"/>
  ${face(291, 262, 0.5, 11)}`;

const tbSocks = `
  <g transform="rotate(-10 202 240)">
    <path d="M180 156 L244 156 L244 266 Q244 310 200 310 Q160 310 160 272 Q160 244 180 236 Z" fill="#FFF6E0" ${S}/>
    <rect x="174" y="140" width="76" height="32" rx="13" fill="#FF9EBB" ${S}/>
    ${face(212, 244, 0.5, 11)}
  </g>
  <g transform="rotate(8 314 258)">
    <path d="M292 174 L356 174 L356 284 Q356 328 312 328 Q272 328 272 290 Q272 262 292 254 Z" fill="#FFD166" ${S}/>
    <rect x="286" y="158" width="76" height="32" rx="13" fill="#8CC152" ${S}/>
    ${heart(316, 258, 0.5, '#FF8FAB')}
  </g>`;

const tbShorts = `
  <path d="M162 168 L350 168 L368 324 L276 332 L258 248 L254 248 L236 332 L144 324 Z" fill="#5C6B7E" ${S}/>
  <rect x="158" y="150" width="196" height="30" rx="10" fill="#8FA6C4" ${S}/>
  <path d="M246 182 Q256 198 266 182" fill="none" stroke="#FFF6E0" stroke-width="6" stroke-linecap="round"/>
  ${face(216, 288, 0.5, 11)}
  ${heart(300, 296, 0.5, '#FFB7C9')}`;

const tbSuitcase = `
  <path d="M220 140 L220 112 L292 112 L292 140" fill="none" stroke="${OL}" stroke-width="10" stroke-linecap="round"/>
  <rect x="170" y="140" width="172" height="240" rx="26" fill="#FFD166" ${S}/>
  <rect x="170" y="140" width="172" height="72" rx="26" fill="#FFE3A9" ${S}/>
  <path d="M170 226 L342 226" stroke="${OL}" stroke-width="5" opacity="0.35"/>
  <rect x="194" y="244" width="44" height="54" rx="10" fill="#E9EFF6" ${S}/>
  ${face(288, 262, 0.55, 12)}
  <rect x="196" y="352" width="22" height="18" fill="#5C4A3D" ${S}/><rect x="294" y="352" width="22" height="18" fill="#5C4A3D" ${S}/>
  <circle cx="207" cy="378" r="12" fill="#8FA6C4" ${S}/><circle cx="305" cy="378" r="12" fill="#8FA6C4" ${S}/>`;

const tbWallet = `
  <rect x="146" y="180" width="220" height="162" rx="22" fill="#8D5A3A" ${S}/>
  <rect x="146" y="180" width="220" height="54" rx="22" fill="#A56428" ${S}/>
  <rect x="270" y="242" width="72" height="74" rx="16" fill="#FFD166" ${S}/>
  <circle cx="306" cy="279" r="10" fill="#FFF6E0" ${S}/>
  ${face(206, 278, 0.55, 12)}
  <path d="M146 302 L264 302" stroke="${OL}" stroke-width="5" opacity="0.3"/>`;

const tbSunglasses = `
  <path d="M134 242 L108 226 M378 242 L404 226" stroke="${OL}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="186" cy="254" r="52" fill="#5C6B7E" ${S}/>
  <circle cx="326" cy="254" r="52" fill="#5C6B7E" ${S}/>
  <circle cx="186" cy="254" r="40" fill="#8FA6C4" stroke="none"/>
  <circle cx="326" cy="254" r="40" fill="#8FA6C4" stroke="none"/>
  <circle cx="172" cy="240" r="9" fill="#FFFFFF" opacity="0.85"/><circle cx="312" cy="240" r="9" fill="#FFFFFF" opacity="0.85"/>
  <path d="M238 246 Q256 234 274 246" fill="none" stroke="${OL}" stroke-width="8" stroke-linecap="round"/>
  ${face(256, 330, 0.45, 10, 'cat')}
  ${sparkle(122, 322, 0.75, '#FFD166')}`;

const tbBrush = `
  <g transform="rotate(-13 226 200)">
    <rect x="214" y="118" width="22" height="152" rx="11" fill="#E8B287" ${S}/>
    <ellipse cx="225" cy="112" rx="18" ry="26" fill="#FFF6E0" ${S}/>
  </g>
  <rect x="246" y="104" width="22" height="166" rx="11" fill="#E8B287" ${S}/>
  <ellipse cx="257" cy="98" rx="18" ry="26" fill="#FFF6E0" ${S}/>
  <g transform="rotate(13 286 200)">
    <rect x="276" y="118" width="22" height="152" rx="11" fill="#E8B287" ${S}/>
    <ellipse cx="287" cy="112" rx="18" ry="26" fill="#FFF6E0" ${S}/>
  </g>
  <rect x="196" y="268" width="120" height="118" rx="20" fill="#FF9EBB" ${S}/>
  ${face(256, 330, 0.55, 12)}`;

const tbFaceMask = `
  <path d="M156 176 Q256 130 356 176 Q388 258 356 342 Q256 388 156 342 Q124 258 156 176 Z" fill="#FFF9F0" ${S}/>
  <path d="M256 176 L256 342" stroke="${OL}" stroke-width="4" opacity="0.18"/>
  ${face(256, 258, 0.72, 17)}
  ${heart(340, 320, 0.5, '#FF9EBB')}
  ${sparkle(130, 210, 0.75, '#FFD166')}`;

const tbCurtain = `
  <rect x="196" y="150" width="120" height="182" fill="#BEE3DD" ${S}/>
  <path d="M196 242 L316 242 M256 150 L256 332" stroke="${OL}" stroke-width="5" opacity="0.5"/>
  <rect x="180" y="130" width="152" height="22" rx="11" fill="#FFD166" ${S}/>
  <path d="M164 152 Q150 252 168 354 L216 354 Q200 252 212 152 Z" fill="#FF9EBB" ${S}/>
  <path d="M348 152 Q362 252 344 354 L296 354 Q312 252 300 152 Z" fill="#FF9EBB" ${S}/>
  ${face(256, 288, 0.5, 11)}`;

const tbTowel = `
  <rect x="150" y="198" width="212" height="60" rx="14" fill="#BEE3DD" ${S}/>
  <path d="M150 226 L362 226" stroke="#FFFFFF" stroke-width="5" opacity="0.55"/>
  <rect x="162" y="258" width="188" height="56" rx="14" fill="#FFD166" ${S}/>
  <rect x="150" y="314" width="212" height="58" rx="14" fill="#FF9EBB" ${S}/>
  ${face(256, 342, 0.5, 11)}
  ${sparkle(120, 180, 0.8, '#FFD166')}`;

const tbStorage = `
  <rect x="238" y="148" width="36" height="24" rx="8" fill="#FFD166" ${S}/>
  <rect x="130" y="164" width="252" height="44" rx="14" fill="#8FA6C4" ${S}/>
  <rect x="146" y="208" width="220" height="168" rx="18" fill="#BEE3DD" ${S}/>
  ${face(256, 296, 0.62, 15)}
  <path d="M146 332 L366 332" stroke="${OL}" stroke-width="5" opacity="0.3"/>
  ${sparkle(112, 240, 0.8, '#FFD166')}`;

const tbCarpet = `
  <rect x="112" y="214" width="150" height="108" rx="8" fill="#FF9EBB" ${S}/>
  <path d="M112 246 L262 246 M112 288 L262 288" stroke="#FFF6E0" stroke-width="5" opacity="0.5"/>
  <circle cx="300" cy="268" r="62" fill="#FFB7C9" ${S}/>
  <circle cx="300" cy="268" r="27" fill="#FFE3A9" ${S}/>
  <path d="M300 241 Q327 268 300 295" fill="none" stroke="${OL}" stroke-width="5"/>
  ${face(300, 268, 0.38, 9)}
  ${sparkle(110, 170, 0.8, '#FFD166')}`;

const tbSlippers = `
  <ellipse cx="196" cy="256" rx="64" ry="112" fill="#FFB7C9" ${S}/>
  <rect x="164" y="194" width="64" height="28" rx="14" fill="#FF8FAB" ${S}/>
  ${face(196, 296, 0.5, 11)}
  <ellipse cx="316" cy="256" rx="64" ry="112" fill="#FFE3A9" ${S}/>
  <rect x="284" y="194" width="64" height="28" rx="14" fill="#FFD166" ${S}/>
  ${heart(316, 300, 0.5, '#FF8FAB')}
  ${sparkle(106, 160, 0.75, '#FFD166')}`;

const tbBlocks = `
  <rect x="166" y="292" width="180" height="64" rx="10" fill="#FF9EBB" ${S}/>
  <circle cx="200" cy="292" r="9" fill="#FFB7C9" ${S}/><circle cx="256" cy="292" r="9" fill="#FFB7C9" ${S}/><circle cx="312" cy="292" r="9" fill="#FFB7C9" ${S}/>
  <rect x="186" y="228" width="120" height="64" rx="10" fill="#8CC152" ${S}/>
  <circle cx="222" cy="228" r="9" fill="#A8D878" ${S}/><circle cx="270" cy="228" r="9" fill="#A8D878" ${S}/>
  <rect x="216" y="164" width="80" height="64" rx="10" fill="#FFD166" ${S}/>
  ${face(256, 196, 0.42, 10)}
  ${sparkle(136, 200, 0.8, '#FFD166')}`;

const tbToyCar = `
  <path d="M140 292 Q140 258 176 252 L212 208 Q220 196 238 196 L296 196 Q314 196 322 210 L344 254 Q376 260 376 292 L376 312 Q376 324 364 324 L152 324 Q140 324 140 312 Z" fill="#E8695A" ${S}/>
  <path d="M226 212 L292 212 Q300 212 304 220 L318 250 L222 250 Z" fill="#BEE3DD" stroke="none"/>
  ${face(186, 288, 0.48, 11)}
  <rect x="326" y="222" width="26" height="15" rx="7" fill="#FFD166" stroke="none"/>
  <circle cx="196" cy="326" r="26" fill="#5C6B7E" ${S}/><circle cx="196" cy="326" r="10" fill="#8FA6C4" stroke="none"/>
  <circle cx="322" cy="326" r="26" fill="#5C6B7E" ${S}/><circle cx="322" cy="326" r="10" fill="#8FA6C4" stroke="none"/>`;

const tbPuzzle = `
  <path d="M150 220 L246 220 L246 202 Q246 180 268 180 Q290 180 290 202 L290 220 L382 220 L382 332 L284 332 L284 350 Q284 372 262 372 Q240 372 240 350 L240 332 L150 332 Z" fill="#FFD166" ${S}/>
  <circle cx="196" cy="258" r="15" fill="#FFF6E0" ${S}/>
  ${face(292, 276, 0.55, 12)}
  ${sparkle(122, 182, 0.8, '#FF9EBB')}`;

const tbPen = `
  <g transform="rotate(34 256 256)">
    <rect x="234" y="92" width="44" height="210" rx="16" fill="#5C6B7E" ${S}/>
    ${face(256, 196, 0.52, 11)}
    <rect x="234" y="296" width="44" height="58" rx="8" fill="#FFD166" ${S}/>
    <path d="M244 354 L268 354 L262 396 L256 408 L250 396 Z" fill="#8FA6C4" ${S}/>
    <path d="M256 360 L256 392" stroke="${OL}" stroke-width="4"/>
  </g>
  ${sparkle(140, 160, 0.85, '#FFD166')}
  ${sparkle(390, 340, 0.7, '#FFD166', 0.9)}`;

const tbNotebook = `
  <rect x="166" y="140" width="180" height="232" rx="18" fill="#FFD166" ${S}/>
  <rect x="188" y="160" width="138" height="192" rx="8" fill="#FFF9F0" stroke="none"/>
  <path d="M204 202 L310 202 M204 232 L310 232 M204 262 L310 262" stroke="${OL}" stroke-width="4" opacity="0.22"/>
  <rect x="298" y="140" width="20" height="232" fill="#E8695A" ${S}/>
  ${face(242, 292, 0.55, 12)}
  ${sparkle(130, 170, 0.8, '#FFD166')}`;

const tbGuitar = `
  <rect x="206" y="70" width="58" height="32" rx="9" fill="#5C6B7E" ${S}/>
  <rect x="217" y="98" width="36" height="140" rx="8" fill="#8D5A3A" ${S}/>
  <path d="M226 72 L226 60 M240 72 L240 58 M254 72 L254 60" stroke="${OL}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="234" cy="308" r="90" fill="#E8B287" ${S}/>
  <circle cx="234" cy="308" r="57" fill="#D9A05B" stroke="none"/>
  <circle cx="234" cy="308" r="27" fill="#FFF6E0" ${S}/>
  <path d="M226 104 L226 288 M244 104 L244 288" stroke="#FFF6E0" stroke-width="3" opacity="0.85"/>
  <rect x="212" y="336" width="46" height="13" rx="6" fill="#5C6B7E" ${S}/>
  ${face(234, 372, 0.42, 9, 'cat')}
  ${sparkle(340, 220, 0.8, '#FFD166')}`;

const tbBasketball = `
  <circle cx="256" cy="262" r="112" fill="#F2A65A" ${S}/>
  <path d="M144 262 L368 262 M256 150 L256 374" stroke="#8D5A3A" stroke-width="7" stroke-linecap="round"/>
  <path d="M172 186 Q256 262 172 338 M340 186 Q256 262 340 338" fill="none" stroke="#8D5A3A" stroke-width="7" stroke-linecap="round"/>
  ${face(256, 262, 0.62, 15)}
  ${sparkle(118, 168, 0.8, '#FFD166')}`;

const tbYogaMat = `
  <circle cx="300" cy="264" r="68" fill="#8CC152" ${S}/>
  <circle cx="300" cy="264" r="35" fill="#BFE3C0" ${S}/>
  <path d="M300 238 Q328 264 300 290" fill="none" stroke="${OL}" stroke-width="5"/>
  <rect x="138" y="212" width="162" height="104" rx="10" fill="#A3CC7A" ${S}/>
  <rect x="206" y="198" width="26" height="132" rx="12" fill="#FF8FAB" ${S}/>
  ${face(178, 264, 0.5, 11)}
  ${sparkle(122, 180, 0.8, '#FFD166')}`;

const tbDumbbell = `
  <rect x="216" y="248" width="80" height="28" rx="14" fill="#8FA6C4" ${S}/>
  <rect x="160" y="196" width="56" height="132" rx="18" fill="#5C6B7E" ${S}/>
  <rect x="296" y="196" width="56" height="132" rx="18" fill="#5C6B7E" ${S}/>
  <rect x="134" y="216" width="30" height="92" rx="12" fill="#8FA6C4" ${S}/>
  <rect x="348" y="216" width="30" height="92" rx="12" fill="#8FA6C4" ${S}/>
  ${face(188, 262, 0.45, 10)}
  ${sparkle(340, 170, 0.8, '#FFD166')}`;

const tbLunchbox = `
  ${steam(226, 170, 0.6)} ${steam(288, 166, 0.72)}
  <path d="M212 196 Q256 166 300 196" fill="none" stroke="${OL}" stroke-width="9" stroke-linecap="round"/>
  <rect x="166" y="194" width="180" height="72" rx="14" fill="#FF9EBB" ${S}/>
  <rect x="146" y="220" width="24" height="20" rx="7" fill="#FFD166" ${S}/>
  <rect x="342" y="220" width="24" height="20" rx="7" fill="#FFD166" ${S}/>
  <rect x="166" y="266" width="180" height="72" rx="14" fill="#FFB7C9" ${S}/>
  ${face(256, 236, 0.55, 12)}
  ${sparkle(120, 176, 0.75, '#FFD166')}`;

const tbPet = `
  <ellipse cx="256" cy="296" rx="132" ry="72" fill="#FF8FAB" ${S}/>
  <ellipse cx="256" cy="280" rx="98" ry="46" fill="#FFE3A9" ${S}/>
  <circle cx="214" cy="272" r="11" fill="#8D5A3A"/><circle cx="256" cy="284" r="12" fill="#8D5A3A"/><circle cx="298" cy="270" r="11" fill="#8D5A3A"/>
  <circle cx="236" cy="262" r="9" fill="#A56428"/><circle cx="278" cy="264" r="9" fill="#A56428"/>
  ${face(256, 330, 0.55, 12)}
  ${heart(374, 232, 0.55, '#FFD166')}
  ${sparkle(120, 210, 0.75, '#FFD166')}`;

// ---------------- 任务表 ----------------

interface Job {
  name: string;
  fill: string;
  accent: string;
  body: string;
  ground?: [number, number];
}

const JOBS: Job[] = [
  // 美团菜品
  { name: 'mt-milk-tea', fill: '#FFF4E0', accent: '#FFD98E', body: mtMilkTea },
  { name: 'mt-tea', fill: '#FFF8EA', accent: '#FFE3A9', body: mtTea },
  { name: 'mt-burger', fill: '#FFF8EA', accent: '#FFE3A9', body: mtBurger },
  { name: 'mt-fried-chicken', fill: '#FFF4E0', accent: '#FFD98E', body: mtFriedChicken },
  { name: 'mt-pizza', fill: '#FFF8EA', accent: '#FFE3A9', body: mtPizza },
  { name: 'mt-hotpot', fill: '#FDEBE0', accent: '#FFC9B0', body: mtHotpot },
  { name: 'mt-noodles', fill: '#FFF8EA', accent: '#FFE3A9', body: mtNoodles },
  { name: 'mt-rice', fill: '#EFF6E9', accent: '#BFE3C0', body: mtRice },
  { name: 'mt-dessert', fill: '#FDEFF4', accent: '#FFC9D6', body: mtDessert },
  { name: 'mt-ice-cream', fill: '#FDEFF4', accent: '#FFC9D6', body: mtIceCream },
  { name: 'mt-coffee', fill: '#F4EFE6', accent: '#E3D0B8', body: mtCoffee },
  { name: 'mt-juice', fill: '#FFF4E0', accent: '#FFD98E', body: mtJuice },
  { name: 'mt-fruit', fill: '#EFF6E9', accent: '#BFE3C0', body: mtFruit },
  { name: 'mt-breakfast', fill: '#FFF8EA', accent: '#FFE3A9', body: mtBreakfast },
  { name: 'mt-dumplings', fill: '#FFF8EA', accent: '#FFE3A9', body: mtDumplings },
  { name: 'mt-sushi', fill: '#FDEBE0', accent: '#FFC9B0', body: mtSushi },
  { name: 'mt-barbecue', fill: '#FFF4E0', accent: '#FFD98E', body: mtBarbecue },
  { name: 'mt-chinese-food', fill: '#FFF8EA', accent: '#FFE3A9', body: mtChineseFood },
  { name: 'mt-seafood', fill: '#FDEBE0', accent: '#FFC9B0', body: mtSeafood },
  { name: 'mt-beef', fill: '#FFF4E0', accent: '#FFD98E', body: mtBeef },
  { name: 'mt-salad', fill: '#EFF6E9', accent: '#BFE3C0', body: mtSalad },
  { name: 'mt-soup', fill: '#FFF8EA', accent: '#FFE3A9', body: mtSoup },
  { name: 'mt-cola', fill: '#FDEBE0', accent: '#FFC9B0', body: mtCola },
  { name: 'mt-egg', fill: '#FFF8EA', accent: '#FFE3A9', body: mtEgg },
  { name: 'mt-milk', fill: '#EFF6E9', accent: '#BFE3C0', body: mtMilk },
  { name: 'mt-medicine', fill: '#EFF6E9', accent: '#BFE3C0', body: mtMedicine },
  { name: 'mt-flower', fill: '#FDEFF4', accent: '#FFC9D6', body: mtFlower },
  { name: 'mt-store', fill: '#FFF4E0', accent: '#FFD98E', body: mtStore },
  // 店面
  { name: 'shop-pharmacy', fill: '#FFF4E0', accent: '#FFD98E', body: shopPharmacy, ground: [416, 180] },
  { name: 'shop-breakfast', fill: '#FFF4E0', accent: '#FFD98E', body: shopBreakfast, ground: [416, 180] },
  { name: 'shop-coffee', fill: '#FFF4E0', accent: '#FFD98E', body: shopCoffee, ground: [416, 180] },
  { name: 'shop-milktea', fill: '#FDEFF4', accent: '#FFC9D6', body: shopMilktea, ground: [416, 180] },
  { name: 'shop-fun', fill: '#FFF4E0', accent: '#FFD98E', body: shopFun, ground: [416, 180] },
  { name: 'shop-food', fill: '#FFF4E0', accent: '#FFD98E', body: shopFood, ground: [416, 180] },
  // 淘宝商品
  { name: 'tb-phone', fill: '#F1EEE8', accent: '#D8D2C4', body: tbPhone },
  { name: 'tb-earbuds', fill: '#F1EEE8', accent: '#D8D2C4', body: tbEarbuds },
  { name: 'tb-laptop', fill: '#F1EEE8', accent: '#D8D2C4', body: tbLaptop },
  { name: 'tb-tablet', fill: '#F1EEE8', accent: '#D8D2C4', body: tbTablet },
  { name: 'tb-watch', fill: '#F1EEE8', accent: '#D8D2C4', body: tbWatch },
  { name: 'tb-keyboard', fill: '#F1EEE8', accent: '#D8D2C4', body: tbKeyboard },
  { name: 'tb-speaker', fill: '#FFF4E0', accent: '#FFD98E', body: tbSpeaker },
  { name: 'tb-powerbank', fill: '#FFF4E0', accent: '#FFD98E', body: tbPowerbank },
  { name: 'tb-tshirt', fill: '#FDEFF2', accent: '#FFC9D6', body: tbTshirt },
  { name: 'tb-jeans', fill: '#FDEFF2', accent: '#FFC9D6', body: tbJeans },
  { name: 'tb-dress', fill: '#FDEFF2', accent: '#FFC9D6', body: tbDress },
  { name: 'tb-jacket', fill: '#EFF6E9', accent: '#BFE3C0', body: tbJacket },
  { name: 'tb-hoodie', fill: '#FFF4E0', accent: '#FFD98E', body: tbHoodie },
  { name: 'tb-sneakers', fill: '#FDEFF2', accent: '#FFC9D6', body: tbSneakers },
  { name: 'tb-backpack', fill: '#FFF4E0', accent: '#FFD98E', body: tbBackpack },
  { name: 'tb-lipstick', fill: '#FAEDF3', accent: '#F3C4DC', body: tbLipstick },
  { name: 'tb-perfume', fill: '#FAEDF3', accent: '#F3C4DC', body: tbPerfume },
  { name: 'tb-skincare', fill: '#FAEDF3', accent: '#F3C4DC', body: tbSkincare },
  { name: 'tb-makeup', fill: '#FAEDF3', accent: '#F3C4DC', body: tbMakeup },
  { name: 'tb-sofa', fill: '#F4EFE6', accent: '#E3D7C2', body: tbSofa },
  { name: 'tb-bedding', fill: '#F4EFE6', accent: '#E3D7C2', body: tbBedding },
  { name: 'tb-lamp', fill: '#FFF4E0', accent: '#FFD98E', body: tbLamp },
  { name: 'tb-mug', fill: '#F4EFE6', accent: '#E3D7C2', body: tbMug },
  { name: 'tb-vase', fill: '#EFF6E9', accent: '#BFE3C0', body: tbVase },
  { name: 'tb-pillow', fill: '#F4EFE6', accent: '#E3D7C2', body: tbPillow },
  { name: 'tb-desk', fill: '#F4EFE6', accent: '#E3D7C2', body: tbDesk },
  { name: 'tb-toy', fill: '#FDF3E7', accent: '#F2D3AE', body: tbToy },
  { name: 'tb-umbrella', fill: '#FDEFF4', accent: '#FFC9D6', body: tbUmbrella },
  { name: 'tb-water-bottle', fill: '#EFF6E9', accent: '#BFE3C0', body: tbWaterBottle },
  { name: 'tb-snacks', fill: '#FFF8EA', accent: '#FFE3A9', body: tbSnacks },
  { name: 'tb-cookies', fill: '#FFF8EA', accent: '#FFE3A9', body: tbCookies },
  { name: 'tb-tea', fill: '#EFF6E9', accent: '#BFE3C0', body: tbTea },
  { name: 'tb-books', fill: '#FFF8EA', accent: '#FFE3A9', body: tbBooks },
  // Task 60 补齐品类
  { name: 'tb-hat', fill: '#FDEFF4', accent: '#FFC9D6', body: tbHat },
  { name: 'tb-camera', fill: '#F1EEE8', accent: '#D8D2C4', body: tbCamera },
  { name: 'tb-coat', fill: '#FFF4E0', accent: '#FFD98E', body: tbCoat },
  { name: 'tb-shirt', fill: '#F1EEE8', accent: '#D8D2C4', body: tbShirt },
  { name: 'tb-lock', fill: '#F1EEE8', accent: '#D8D2C4', body: tbLock },
  { name: 'tb-fridge', fill: '#EFF6E9', accent: '#BFE3C0', body: tbFridge },
  { name: 'tb-washer', fill: '#F1EEE8', accent: '#D8D2C4', body: tbWasher },
  { name: 'tb-gift', fill: '#FDEFF4', accent: '#FFC9D6', body: tbGift },
  { name: 'tb-kiosk', fill: '#F1EEE8', accent: '#D8D2C4', body: tbKiosk },
  { name: 'tb-temple', fill: '#FFF4E0', accent: '#FFD98E', body: tbTemple, ground: [420, 190] },
  // Task 61 全品类扩展
  { name: 'tb-phone-stand', fill: '#F1EEE8', accent: '#D8D2C4', body: tbPhoneStand },
  { name: 'tb-mouse', fill: '#F1EEE8', accent: '#D8D2C4', body: tbMouse },
  { name: 'tb-monitor', fill: '#F1EEE8', accent: '#D8D2C4', body: tbMonitor },
  { name: 'tb-tv', fill: '#F1EEE8', accent: '#D8D2C4', body: tbTv },
  { name: 'tb-drone', fill: '#F1EEE8', accent: '#D8D2C4', body: tbDrone },
  { name: 'tb-gamepad', fill: '#F1EEE8', accent: '#D8D2C4', body: tbGamepad },
  { name: 'tb-fan', fill: '#EFF6E9', accent: '#BFE3C0', body: tbFan },
  { name: 'tb-microwave', fill: '#F1EEE8', accent: '#D8D2C4', body: tbMicrowave },
  { name: 'tb-rice-cooker', fill: '#FFF4E0', accent: '#FFD98E', body: tbRiceCooker },
  { name: 'tb-vacuum', fill: '#EFF6E9', accent: '#BFE3C0', body: tbVacuum },
  { name: 'tb-kettle', fill: '#EFF6E9', accent: '#BFE3C0', body: tbKettle },
  { name: 'tb-air-fryer', fill: '#FFF4E0', accent: '#FFD98E', body: tbAirFryer },
  { name: 'tb-coffee-machine', fill: '#F4EFE6', accent: '#E3D7C2', body: tbCoffeeMachine },
  { name: 'tb-humidifier', fill: '#EFF6E9', accent: '#BFE3C0', body: tbHumidifier },
  { name: 'tb-shaver', fill: '#F1EEE8', accent: '#D8D2C4', body: tbShaver },
  { name: 'tb-toothbrush', fill: '#EFF6E9', accent: '#BFE3C0', body: tbToothbrush },
  { name: 'tb-hairdryer', fill: '#FDEFF4', accent: '#FFC9D6', body: tbHairdryer },
  { name: 'tb-belt', fill: '#F4EFE6', accent: '#E3D7C2', body: tbBelt },
  { name: 'tb-scarf', fill: '#FDEFF4', accent: '#FFC9D6', body: tbScarf },
  { name: 'tb-socks', fill: '#FDEFF4', accent: '#FFC9D6', body: tbSocks },
  { name: 'tb-shorts', fill: '#F1EEE8', accent: '#D8D2C4', body: tbShorts },
  { name: 'tb-suitcase', fill: '#FFF4E0', accent: '#FFD98E', body: tbSuitcase },
  { name: 'tb-wallet', fill: '#F4EFE6', accent: '#E3D7C2', body: tbWallet },
  { name: 'tb-sunglasses', fill: '#F1EEE8', accent: '#D8D2C4', body: tbSunglasses },
  { name: 'tb-brush', fill: '#FAEDF3', accent: '#F3C4DC', body: tbBrush },
  { name: 'tb-face-mask', fill: '#FAEDF3', accent: '#F3C4DC', body: tbFaceMask },
  { name: 'tb-curtain', fill: '#F4EFE6', accent: '#E3D7C2', body: tbCurtain },
  { name: 'tb-towel', fill: '#EFF6E9', accent: '#BFE3C0', body: tbTowel },
  { name: 'tb-storage', fill: '#EFF6E9', accent: '#BFE3C0', body: tbStorage },
  { name: 'tb-carpet', fill: '#F4EFE6', accent: '#E3D7C2', body: tbCarpet },
  { name: 'tb-slippers', fill: '#FDEFF4', accent: '#FFC9D6', body: tbSlippers },
  { name: 'tb-blocks', fill: '#FDF3E7', accent: '#F2D3AE', body: tbBlocks },
  { name: 'tb-toy-car', fill: '#FDF3E7', accent: '#F2D3AE', body: tbToyCar },
  { name: 'tb-puzzle', fill: '#FDF3E7', accent: '#F2D3AE', body: tbPuzzle },
  { name: 'tb-pen', fill: '#FFF8EA', accent: '#FFE3A9', body: tbPen },
  { name: 'tb-notebook', fill: '#FFF8EA', accent: '#FFE3A9', body: tbNotebook },
  { name: 'tb-guitar', fill: '#F4EFE6', accent: '#E3D7C2', body: tbGuitar },
  { name: 'tb-basketball', fill: '#FFF4E0', accent: '#FFD98E', body: tbBasketball },
  { name: 'tb-yoga-mat', fill: '#EFF6E9', accent: '#BFE3C0', body: tbYogaMat },
  { name: 'tb-dumbbell', fill: '#F1EEE8', accent: '#D8D2C4', body: tbDumbbell },
  { name: 'tb-lunchbox', fill: '#FDEFF4', accent: '#FFC9D6', body: tbLunchbox },
  { name: 'tb-pet', fill: '#FDEFF4', accent: '#FFC9D6', body: tbPet },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    const out = path.join(OUT, `${job.name}.webp`);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      skipped++;
      continue;
    }
    try {
      const ground = job.ground ?? [420, 180];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${scene(job.fill, job.accent, ground[0], ground[1])}${job.body}</svg>`;
      await sharp(Buffer.from(svg)).webp({ quality: 82, effort: 4 }).toFile(out);
      done++;
      if (process.env.VERBOSE) console.log(`[${i + 1}/${JOBS.length}] ${job.name}.webp`);
    } catch (e) {
      failed.push(job.name);
      console.error(`FAIL ${job.name}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`done=${done} skipped=${skipped} failed=${failed.length}${failed.length ? ' -> ' + failed.join(',') : ''}`);
  if (failed.length) process.exit(1);
}

main();
