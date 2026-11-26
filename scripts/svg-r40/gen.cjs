#!/usr/bin/env node
/**
 * 第四十轮：icon-3 / icon-4 SVG 源生成（含数值螺旋路径——c 内圈纹理与 e 卷尾）。
 * VLM 首轮评审修正版：
 *   icon-3：v/e 粘连畸形重排（字标整体缩 5%、v 收窄左移、e 右移拉开 ≥24px 间隙、
 *           o 尾巴加长、颜色加深一档、构图下移居中）
 *   icon-4：气泡改单圈细描边+短粗尾（删同心感）、脸下移贴近波浪身体、e 卷尾加大
 *           减圈、统一笔画粗细
 */
const fs = require('fs');
const path = require('path');

/** 数值螺旋 → polyline path（round join 视觉平滑）；startAngle 弧度制 */
function spiralPath(cx, cy, rStart, rEnd, turns, dirSign, startAngle = 0, steps = 110) {
  const pts = [];
  const total = turns * 2 * Math.PI;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const r = rStart + ((rEnd - rStart) * t) / total;
    const th = startAngle + dirSign * t;
    pts.push(`${(cx + r * Math.cos(th)).toFixed(1)} ${(cy + r * Math.sin(th)).toFixed(1)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
}

/* ============ icon-3 情书字标（幽灵水印 wordmark·VLM 三版：字标收紧重排） ============ */
const icon3 = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- Cove 图标三「情书字标」：暖白纸底 + 幽灵水印 Cove 字标（超粗圆润 C 环抱 ove、
       o 对话气泡、v 折、e 圆环横杠）+ 海浪下划线 + 散点 + 右下小花（VLM 三版：
       字标收紧 880 宽、o-v-e 各留 ≥10px 间隙、v 视觉顶对齐 x 高、颜色再深一档） -->
  <rect width="1024" height="1024" fill="#EFEDEA"/>

  <g transform="translate(8 24)">
  <!-- ===== Cove 字标（基线 ~600，C 高 288 / x 高 150；总宽 121..888 居中） ===== -->
  <!-- C：环 r108 描边 72 圆头，开口朝右 ±50° -->
  <path d="M 334.4 527.7 A 108 108 0 1 1 334.4 362.3" fill="none" stroke="#99A5B8" stroke-width="72" stroke-linecap="round"/>

  <!-- o：对话气泡——空心浅描边圆 + 贴边紧凑三角尾（VLM 四版：长柄读作放大镜，改贴边小尾） -->
  <circle cx="455" cy="512" r="62" fill="#EFEDEA" stroke="#ABB5C3" stroke-width="26"/>
  <path d="M 431 566 L 398 599 L 404 541 Z" fill="#ABB5C3"/>

  <!-- v：超粗折线圆头（视觉顶 437=x 高顶，左缘 542 与 o 间隙 12） -->
  <path d="M 570 465 L 622 575 L 674 465" fill="none" stroke="#99A5B8" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- e：圆环（右下开口 -60°..+5°）+ 中横杠（左缘 714 与 v 间隙 12） -->
  <path d="M 865.8 515.5 A 66 66 0 1 1 849 467.9" fill="none" stroke="#99A5B8" stroke-width="44" stroke-linecap="round"/>
  <path d="M 736 512 L 866 512" fill="none" stroke="#99A5B8" stroke-width="44" stroke-linecap="round"/>

  <!-- ===== 海浪下划线（字标下方两浪 + 末端微扬；距 e 底 45px） ===== -->
  <path d="M 160 690 C 250 656, 340 656, 430 690 C 520 724, 610 724, 700 690 C 742 676, 792 670, 845 676"
        fill="none" stroke="#B2BCC9" stroke-width="22" stroke-linecap="round"/>

  <!-- ===== 散点装饰（浅粉/浅灰/淡黄） ===== -->
  <circle cx="150" cy="230" r="11" fill="#F1CBD6"/>
  <circle cx="860" cy="200" r="8.5" fill="#DCDFE4"/>
  <circle cx="160" cy="860" r="9" fill="#EEE0BC"/>
  <circle cx="450" cy="888" r="7" fill="#F1CBD6" opacity="0.75"/>
  <circle cx="628" cy="908" r="5.5" fill="#DCDFE4" opacity="0.8"/>

  <!-- 右下小花：五瓣 + 暖心 -->
  <g transform="translate(840 848)">
    <g fill="#F1CBD6">
      <ellipse cx="0" cy="-22" rx="12" ry="20"/>
      <ellipse cx="0" cy="-22" rx="12" ry="20" transform="rotate(72)"/>
      <ellipse cx="0" cy="-22" rx="12" ry="20" transform="rotate(144)"/>
      <ellipse cx="0" cy="-22" rx="12" ry="20" transform="rotate(216)"/>
      <ellipse cx="0" cy="-22" rx="12" ry="20" transform="rotate(288)"/>
    </g>
    <circle cx="0" cy="0" r="8.5" fill="#EEE0BC"/>
  </g>
  </g>
</svg>
`;

/* ============ icon-4 小词灵（线条小生物·VLM 三版） ============ */
// c 内螺旋（顺时针向外，r 14→100，1.45 圈——填充云身防「@」感）
const cSpiral = spiralPath(285, 480, 14, 100, 1.45, 1);
// e 卷尾（起点=波浪末端 (690,480)，θ=π 顺时针向内，r 95→22，1.2 圈——衔接顺滑无结节）
const eCoil = spiralPath(785, 480, 95, 22, 1.2, 1, Math.PI);

const icon4 = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- Cove 图标四「小词灵」：cove 单词化作小生物——c 云朵身体（内螺旋）、o+v 波浪
       中段、e 卷尾（波浪顺滑卷入）；脸锚定在 o 鼓包上方（微笑贴上鼓包=安家）；
       右上独立对话气泡（与身体断开留白 + 内小圆点 + V 形短尾指向主体）；
       底部 cove 单线字标（VLM 三版：气泡断开放大、脸下移锚定、衔接去结节、螺旋填充） -->
  <rect width="1024" height="1024" fill="#FFFFFF"/>

  <!-- ===== cove 小生物（统一描边 28，圆润灰 #6F7480） ===== -->
  <!-- c 身体：环 r150 开口朝右 ±40°（y 下移 10 重心居中） -->
  <path d="M 399.9 576.4 A 150 150 0 1 1 399.9 383.6" fill="none" stroke="#6F7480" stroke-width="28" stroke-linecap="round"/>
  <!-- c 内圈螺旋纹理（r 14→100 填满云身） -->
  <path d="${cSpiral}" fill="none" stroke="#6F7480" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>

  <!-- o+v 波浪中段：起点搭在 c 口内缘、上鼓（o）下凹（v）、末端 (690,480) 顺滑接 e 卷尾 -->
  <path d="M 425 480 C 460 404, 505 404, 545 480 C 585 556, 640 556, 690 480"
        fill="none" stroke="#6F7480" stroke-width="28" stroke-linecap="round"/>

  <!-- e 卷尾：自波浪末端连续卷入（r 95→22） -->
  <path d="${eCoil}" fill="none" stroke="#6F7480" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- ===== 脸（锚定 o 鼓包上方：微笑弧底贴上鼓包=安家） ===== -->
  <circle cx="445" cy="372" r="19" fill="#2A2D33"/>
  <circle cx="555" cy="372" r="19" fill="#2A2D33"/>
  <path d="M 478 409 Q 507 437 536 409" fill="none" stroke="#2A2D33" stroke-width="14" stroke-linecap="round"/>

  <!-- ===== 对话气泡（独立·右上：单圈描边 + 内小点 + V 形短尾指向主体，与身体断开 ~80px） ===== -->
  <circle cx="790" cy="250" r="68" fill="#FFFFFF" stroke="#6F7480" stroke-width="16"/>
  <circle cx="790" cy="250" r="9" fill="#2A2D33"/>
  <path d="M 748 296 L 736 330 L 762 304" fill="none" stroke="#6F7480" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- ===== cove 单线字标（底部，与图标 1/2 家族同款） ===== -->
  <g fill="none" stroke="#6E7480" stroke-width="11" stroke-linecap="round">
    <path d="M 357 805.8 A 42 42 0 1 0 357 870.2"/>
    <circle cx="448" cy="838" r="42"/>
    <path d="M 528 796 L 570 880 L 612 796"/>
    <path d="M 728.4 859 A 42 42 0 1 0 713 874.4"/>
    <path d="M 650 838 L 734 838"/>
  </g>
</svg>
`;

fs.writeFileSync(path.join(__dirname, 'icon-3.svg'), icon3);
fs.writeFileSync(path.join(__dirname, 'icon-4.svg'), icon4);
console.log('✓ icon-3.svg icon-4.svg written (v2)');
