'use client';

/**
 * 微信「发现 / 我 / 钱包」页彩色线稿图标（对齐微信 8.x 官方截图）：
 * 无底色色块，直接用彩色描边 SVG —— 朋友圈彩色光圈、视频号橙色丝带、
 * 扫一扫双弧手势、听一听音符、看一看六角星结、搜一搜红星、游戏宝石、
 * 小程序 S 环、服务绿色气泡勾、收藏立方体、作品双方块、小店门面、表情笑脸、设置齿轮，
 * 以及钱包页：零钱 ¥ 币、零钱通钻石、银行卡、亲属卡双卡。
 *
 * 发现/我页图标自带 38×38 槽位（与原 WxTileIcon 同尺寸，WxMenuRow 分隔线对齐不变）；
 * 钱包页图标自带 34×34 槽位（与钱包 row 原 34px 圆标同尺寸，分隔线 left-[62px] 对齐不变）。
 */

import type { ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

/** 38×38 图标槽位 + 48 viewBox 画布（发现 / 我页用）；svgClass 可覆盖内部画布尺寸 */
function Slot({ children, svgClass = 'h-[31px] w-[31px]' }: { children: ReactNode; svgClass?: string }) {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className={svgClass} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** 34×34 图标槽位 + 48 viewBox 画布（钱包页用，分隔线 left-[62px] 对齐） */
function Slot34({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="h-[32px] w-[32px]" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** 朋友圈：六叶彩色光圈（绿/蓝/橙/红/黄/紫 环形扇叶，扇叶宽 50° 缝 10°） */
const MOMENT_BLADE = 'M27.47 4.30 A20 20 0 0 1 41.32 14 L32.23 19.25 A9.5 9.5 0 0 0 25.65 14.64 Z';
const MOMENT_COLORS = ['#07C160', '#1B7AF5', '#FA9D3B', '#FA5151', '#FFC300', '#6467F0'];

export function WxIcMoments({ small = false }: { small?: boolean }) {
  return (
    <Slot svgClass={small ? 'h-[27px] w-[27px]' : undefined}>
      {MOMENT_COLORS.map((color, i) => (
        <path key={color} d={MOMENT_BLADE} fill={color} transform={`rotate(${i * 60} 24 24)`} />
      ))}
    </Slot>
  );
}

/** 视频号：橙色双角丝带（W 形，两支由底部中心向外上卷的号角） */
export function WxIcChannels() {
  return (
    <Slot>
      <g stroke="#FA9D3B" strokeWidth={3.2}>
        <path d="M23.5 33 C16 32, 8 26, 8.5 17.5 C8.8 13, 13 11.5, 16 14.5 C20 18.5, 22.5 25, 23.5 33" />
        <path d="M25 33 C33 32.5, 41.5 25, 41 14.5 C40.8 9.8, 35.8 8.6, 32.6 12 C28 17, 25.8 24, 25 33" />
      </g>
    </Slot>
  );
}

/** 扫一扫：蓝色双「指认手势」手形剪影（拳 + 食指 + 腕尖，180° 点对称互嵌，白色填充实现前后遮挡，对齐官方造型） */
const SCAN_HAND =
  'M9.3 28.1 C7.3 25.6, 5.6 22.3, 5.8 18.3 C6 13.9, 8.5 11.1, 12.5 11.1 C15.7 11.1, 18.1 12.1, 19.3 13.7 L27.9 14.3 C29.7 14.5, 30.8 15.7, 30.7 17 C30.6 18.3, 29.3 19, 27.6 18.8 L22.9 18.4 C21.7 20.3, 19.7 22.5, 17.1 24.5 C14.7 26.3, 11.9 27.4, 9.3 28.1 Z';

export function WxIcScan() {
  return (
    <Slot>
      <g stroke="#4D9CF8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d={SCAN_HAND} transform="rotate(180 24 24)" className="fill-white dark:fill-[#1A1A1A]" />
        <path d={SCAN_HAND} className="fill-white dark:fill-[#1A1A1A]" />
      </g>
    </Slot>
  );
}

/** 听一听：红橙八分音符 */
export function WxIcListen() {
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={3.2}>
        <path d="M22.1 32.5 L22.1 11.5" />
        <path d="M22.1 11.5 C28 13.5, 30.5 18.5, 27.8 24" />
      </g>
      <ellipse cx="17.5" cy="33.5" rx="4.8" ry="3.7" fill="#FA5151" transform="rotate(-18 17.5 33.5)" />
    </Slot>
  );
}

/** 看一看：金黄六角星花结（无外框，对齐官方造型 —— 外圆框已按需求删除） */
export function WxIcStories() {
  return (
    <Slot>
      <path
        d="M24 7 L28.91 15.5 L38.72 15.5 L33.82 24 L38.72 32.5 L28.91 32.5 L24 41 L19.09 32.5 L9.28 32.5 L14.18 24 L9.28 15.5 L19.09 15.5 Z"
        stroke="#FFC300"
        strokeWidth={3}
      />
    </Slot>
  );
}

/** 搜一搜：红色五瓣星芒（长短参差 + 旋涡弧度） */
const SEARCH_RAYS: Array<[number, number]> = [
  [-88, 12],
  [-160, 14.5],
  [-16, 15.5],
  [118, 13.5],
  [52, 15],
];

export function WxIcSearch() {
  const rays = SEARCH_RAYS.map(([deg, len]) => {
    const t = (deg * Math.PI) / 180;
    const pt = (r: number, off: number) =>
      `${(24 + r * Math.cos(t + off)).toFixed(2)} ${(24 + r * Math.sin(t + off)).toFixed(2)}`;
    return `M${pt(4.2, -0.5)} Q${pt(len * 0.55, 0)} ${pt(len, 0.42)}`;
  });
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={3.4}>
        {rays.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </Slot>
  );
}

/** 游戏：六面彩色宝石（红/橙/蓝/绿/黄/青 切面线稿，宽腰带钻石） */
export function WxIcGames() {
  const facets: Array<[string, string]> = [
    ['#FA5151', 'M5 19 L15 10 L19 19 Z'],
    ['#FA9D3B', 'M15 10 L33 10 L29 19 L19 19 Z'],
    ['#1B7AF5', 'M33 10 L43 19 L29 19 Z'],
    ['#07C160', 'M5 19 L19 19 L24 40 Z'],
    ['#FFC300', 'M19 19 L29 19 L24 40 Z'],
    ['#10AEB5', 'M29 19 L43 19 L24 40 Z'],
  ];
  return (
    <Slot>
      {facets.map(([color, d]) => (
        <path key={color} d={d} stroke={color} strokeWidth={2.4} />
      ))}
    </Slot>
  );
}

/** 小程序：蓝紫圆环 + 手写 S */
export function WxIcMiniProgram() {
  return (
    <Slot>
      <g stroke="#6467F0" strokeWidth={3}>
        <circle cx="24" cy="24" r="17" />
        <path d="M29.5 17 C29.5 14.6, 26.6 13.6, 24 14.6 C21.2 15.7, 20.6 18.6, 22.8 20.1 L25.6 22 C28.2 23.8, 27.9 27.2, 25.2 28.5 C22.6 29.8, 19.3 28.9, 18.6 26.4" />
      </g>
    </Slot>
  );
}

/** 服务：绿色对话气泡 + 对勾 */
export function WxIcServices() {
  return (
    <Slot>
      <path
        d="M24 6.5 C33.7 6.5 41 13.3 41 21.8 C41 30.3 33.7 37 24 37 C21.4 37 18.9 36.5 16.7 35.5 L9 38 L11.3 30.9 C8.9 28.3 7 25.3 7 21.8 C7 13.3 14.3 6.5 24 6.5 Z"
        stroke="#07C160"
        strokeWidth={3}
      />
      <path d="M17.5 22 L22.3 26.8 L30.8 17.5" stroke="#07C160" strokeWidth={3.2} />
    </Slot>
  );
}

/** 收藏：蓝顶 / 橙左 / 红右 的立体立方体线稿 */
export function WxIcFavorites() {
  return (
    <Slot>
      <path d="M24 6 L39 13.5 L24 21 L9 13.5 Z" stroke="#1B7AF5" strokeWidth={2.6} />
      <path d="M9 13.5 L9 29.5 L24 37 L24 21 Z" stroke="#FA9D3B" strokeWidth={2.6} />
      <path d="M24 21 L24 37 L39 29.5 L39 13.5 Z" stroke="#FA5151" strokeWidth={2.6} />
    </Slot>
  );
}

/** 作品：前后两枚圆角方块（前蓝遮后浅蓝） */
export function WxIcWorks() {
  return (
    <Slot>
      <rect x="15" y="7" width="21" height="21" rx="5" stroke="#B9D6FA" strokeWidth={2.8} />
      <rect x="9" y="13" width="21" height="21" rx="5" stroke="#3D7FF5" strokeWidth={2.8} className="fill-white dark:fill-[#1A1A1A]" />
    </Slot>
  );
}

/** 小店与卡包：红色门面（波浪雨棚 + 拱形门） */
export function WxIcShop() {
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={2.9}>
        <path d="M8 12 Q8 8.5 11.5 8.5 L36.5 8.5 Q40 8.5 40 12 L40 15 A5.33 5.33 0 0 1 29.33 15 A5.33 5.33 0 0 1 18.67 15 A5.33 5.33 0 0 1 8 15 Z" />
        <path d="M11 18.8 L11 35.5 Q11 39 14.5 39 L33.5 39 Q37 39 37 35.5 L37 18.8" />
        <path d="M19.5 39 L19.5 28.5 Q19.5 25 24 25 Q28.5 25 28.5 28.5 L28.5 39" />
      </g>
    </Slot>
  );
}

/** 表情：金黄笑脸（圆脸 + 咧嘴笑） */
export function WxIcSticker() {
  return (
    <Slot>
      <circle cx="24" cy="24" r="17.5" stroke="#FFC300" strokeWidth={3} />
      <circle cx="17.5" cy="19.5" r="2.3" fill="#FFC300" />
      <circle cx="30.5" cy="19.5" r="2.3" fill="#FFC300" />
      <path d="M15.5 27 C17.5 33.5, 30.5 33.5, 32.5 27" stroke="#FFC300" strokeWidth={3} />
    </Slot>
  );
}

/** 主题：四段彩色弧环（绿/蓝/橙/紫，调色盘色环）+ 中心色点（「发现」页 › 主题 入口） */
export function WxIcTheme() {
  return (
    <Slot>
      <g fill="none" strokeWidth={3}>
        <path d="M26.95 7.26 A17 17 0 0 1 40.74 21.05" stroke="#07C160" />
        <path d="M40.74 26.95 A17 17 0 0 1 26.95 40.74" stroke="#1B7AF5" />
        <path d="M21.05 40.74 A17 17 0 0 1 7.26 26.95" stroke="#FA9D3B" />
        <path d="M7.26 21.05 A17 17 0 0 1 21.05 7.26" stroke="#AF52DE" />
      </g>
      <circle cx="24" cy="24" r="4.6" fill="#07C160" />
    </Slot>
  );
}

/** 设置：蓝色齿轮（lucide 自带 viewBox，独立于 48 画布） */
export function WxIcSettings() {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center" aria-hidden="true">
      <SettingsIcon className="h-[30px] w-[30px] text-[#4D9CF8]" strokeWidth={2} />
    </span>
  );
}

// ---------------- 钱包页（34×34 槽位） ----------------

/** 零钱：金黄 ¥ 圆币（线圈 + ¥） */
export function WxIcChange() {
  return (
    <Slot34>
      <g stroke="#FFC300">
        <circle cx="24" cy="24" r="16" strokeWidth={3} />
        <path d="M18.5 14.5 L24 22 L29.5 14.5" strokeWidth={2.8} />
        <path d="M24 22 L24 32" strokeWidth={2.8} />
        <path d="M18.5 25.5 L29.5 25.5" strokeWidth={2.8} />
        <path d="M18.5 29.5 L29.5 29.5" strokeWidth={2.8} />
      </g>
    </Slot34>
  );
}

/** 零钱通：金黄钻石（冠部 V 面 + 腰线 + 亭部 V 面） */
export function WxIcFund() {
  return (
    <Slot34>
      <g stroke="#F7B500">
        <path d="M15 9.5 L33 9.5 L41 19.5 L24 39 L7 19.5 Z" strokeWidth={2.8} />
        <path d="M15 9.5 L19.5 19.5 L7 19.5" strokeWidth={2.4} />
        <path d="M33 9.5 L28.5 19.5 L41 19.5" strokeWidth={2.4} />
        <path d="M19.5 19.5 L24 39 L28.5 19.5" strokeWidth={2.4} />
      </g>
    </Slot34>
  );
}

/** 银行卡：蓝色卡片（圆角卡体 + 磁条线） */
export function WxIcBankCard() {
  return (
    <Slot34>
      <g stroke="#4D9CF8">
        <rect x="6.5" y="13.5" width="35" height="21.5" rx="4.5" strokeWidth={3} />
        <path d="M12.5 20.5 L26.5 20.5" strokeWidth={3.2} />
      </g>
    </Slot34>
  );
}

/** 亲属卡：橙金双卡斜叠（后卡橙、前卡金带底色遮挡） */
export function WxIcFamilyCard() {
  return (
    <Slot34>
      <rect x="21.5" y="5" width="17" height="24" rx="4.5" stroke="#F7A500" strokeWidth={2.8} transform="rotate(38 30 17)" />
      <rect
        x="9.5"
        y="19"
        width="17"
        height="24"
        rx="4.5"
        stroke="#F7B500"
        strokeWidth={2.8}
        transform="rotate(38 18 31)"
        className="fill-white dark:fill-[#1A1A1A]"
      />
    </Slot34>
  );
}

/* ---------------------------------------------------------------------------
 * TabBar「发现」指南针（第四十九轮修复）
 * ---------------------------------------------------------------------------
 * 问题：lucide Compass 是「外圆 + 指针」两个独立图形，TabBar 选中态给 svg 上
 * fill-current 后整圆被填成实心绿圆、指针被吞（用户截图：发现 tab 变纯绿圆点）。
 * 方案：单路径 evenodd 自制版——外圆与指针菱形合为一个 path：
 *  - 未选中（fill=none）：与 lucide 同形（圆环 + 指针线稿描边）；
 *  - 选中（fill-current）：外圆实心、指针成为镂空（透出灰色胶囊底色），
 *    指针依旧可辨识，与微信/通讯录/我三个 tab 的「填充态」语言一致。
 * 指针较 lucide 放大约 1.2×（填充镂空后才够醒目）。
 * ------------------------------------------------------------------------- */
export function WxTabCompassIcon({ className, strokeWidth = 1.8 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 0 1 0 20a10 10 0 0 1 0-20Zm5.1 4.9-2.55 7.65-7.65 2.55 2.55-7.65Z"
      />
    </svg>
  );
}
