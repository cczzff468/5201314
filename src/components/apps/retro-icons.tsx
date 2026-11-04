'use client';

/**
 * 古早主题（retro）图标套件（第五十六轮重制）
 * ---------------------------------------------------------------------------
 *  2012-2014 年代拟物复古图标（微信 / QQ 古早主题专用）：
 *  - Tab 图标：粗线条（2.2）方角线稿（iOS 6 时代 App 通用语言），
 *    颜色随 currentColor（宿主用 .rt-tab-on 复古蓝选中态）；
 *  - RetroIc：iOS 6 拟物圆角方块底座（上高光渐变 + 1px 硬边），
 *    里面放「白色 glyph」图标（RtW* 系列，微信发现/我页 + QQ 动态页共用）——
 *    旧微信的彩色瓷贴语言：饱和渐变底 + 白色剪影（第五十六轮替换掉做旧滤镜套现代线稿的旧方案）；
 *  - RtPlus*：微信加号面板实心复古图标（参考图同款：深灰 #6E7474 实心剪影 +
 *    白色镂空细节，无瓷贴直接坐在浅灰面板上）。
 */

/** 复古 Tab 图标通用外壳：粗线条方角线稿（尺寸由 className 控制） */
function RtIconBase({ children, className = 'h-[22px] w-[22px]' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 微信 Tab：老式方角对话气泡（左上直角 + 内三点） */
export function RtChatIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M4 5 H20 V17 H9 L5.5 20.5 V17 H4 Z" />
      <circle cx="9" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </RtIconBase>
  );
}

/** 通讯录 Tab：老式名片本（方框 + 人形 + 右侧装订线） */
export function RtContactsIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M7.5 16 C7.5 13.8 9.2 12.8 12 12.8 C14.8 12.8 16.5 13.8 16.5 16" />
      <circle cx="12" cy="9.4" r="2.3" />
    </RtIconBase>
  );
}

/** 发现 Tab：老式指南针罗盘（方圆结合 + 指针） */
export function RtDiscoverIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M15.2 8.8 L13.4 13.4 L8.8 15.2 L10.6 10.6 Z" fill="currentColor" stroke="none" />
    </RtIconBase>
  );
}

/** 我 Tab：老式人像卡（方框 + 半身像） */
export function RtMeIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="12" cy="8.6" r="3.1" />
      <path d="M5.8 19 C5.8 15.2 8.6 13.6 12 13.6 C15.4 13.6 18.2 15.2 18.2 19" />
    </RtIconBase>
  );
}

/** QQ 消息 Tab：老式方角铃铛 */
export function RtBellIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M6 17 V11 C6 7.8 8.4 5.6 12 5.6 C15.6 5.6 18 7.8 18 11 V17" />
      <path d="M4.4 17 H19.6" />
      <path d="M10.2 19.4 C10.2 20.4 11 21 12 21 C13 21 13.8 20.4 13.8 19.4" />
    </RtIconBase>
  );
}

/** QQ 联系人 Tab：老式双人名片 */
export function RtUsersIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="9.4" cy="9" r="2.8" />
      <path d="M4 18.6 C4 15.4 6.4 13.8 9.4 13.8 C12.4 13.8 14.8 15.4 14.8 18.6" />
      <path d="M15.4 7.2 C17.2 7.6 18.4 9.2 18.4 11 C18.4 12.6 17.6 13.8 16.4 14.4" />
      <path d="M16.6 18.6 C16.6 16.6 16 15.2 15 14.2" />
    </RtIconBase>
  );
}

/** QQ 动态 Tab：老式五角星（方角化） */
export function RtStarIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M12 4 L14.4 9.2 L20 10 L16 14 L17 19.6 L12 17 L7 19.6 L8 14 L4 10 L9.6 9.2 Z" />
    </RtIconBase>
  );
}

/** iOS 6 拟物圆角方块底座：套住任意 SVG 图标（.rt-ic 材质：上高光渐变 + 1px 硬边）。
 *  tone = 可选复古渐变底色（css background 值）；缺省 = 银灰底座。 */
export function RetroIc({
  children,
  tone,
  size = 30,
  radius = 7,
}: {
  children: React.ReactNode;
  /** 复古渐变底（如 'linear-gradient(180deg,#A8D8CF 0%,#7FB8AE 100%)'）；缺省银灰 */
  tone?: string;
  size?: number;
  radius?: number;
}) {
  return (
    <span className="rt-ic" style={{ width: size, height: size, borderRadius: radius, ...(tone ? { background: tone } : {}) }}>
      {children}
    </span>
  );
}

/** 古早主题发现/我/动态页图标配色（第五十六轮：iOS 6 经典饱和渐变——上浅下深同色系，
 *  对照旧微信彩色瓷贴：朋友圈蓝 / 扫一扫绿 / 听一听红 / 搜一搜蓝 / 收藏橙 / 设置灰） */
export const RETRO_ICON_TONES = {
  moments: 'linear-gradient(180deg, #7AB3EC 0%, #3E7CC4 100%)', // 朋友圈 复古蓝（旧微信相机磁贴）
  channels: 'linear-gradient(180deg, #F5A349 0%, #D67F1D 100%)', // 视频号 复古橙
  scan: 'linear-gradient(180deg, #86C983 0%, #4E9E4B 100%)', // 扫一扫 复古绿
  listen: 'linear-gradient(180deg, #F0806F 0%, #CF4B39 100%)', // 听一听 复古红
  stories: 'linear-gradient(180deg, #F7C74C 0%, #D9A115 100%)', // 看一看 复古黄
  search: 'linear-gradient(180deg, #7AB3EC 0%, #3E7CC4 100%)', // 搜一搜 复古蓝
  games: 'linear-gradient(180deg, #A88BD9 0%, #6F52AD 100%)', // 游戏 复古紫
  theme: 'linear-gradient(180deg, #E793BC 0%, #BF5E93 100%)', // 主题 复古粉
  wallet: 'linear-gradient(180deg, #93C85C 0%, #5E9E30 100%)', // 钱包/服务 复旧绿
  favorites: 'linear-gradient(180deg, #F2A854 0%, #CE7C22 100%)', // 收藏 复古橘
  works: 'linear-gradient(180deg, #74BCBB 0%, #3E8C8B 100%)', // 相册/作品 复古青
  sticker: 'linear-gradient(180deg, #F6C963 0%, #D8A01F 100%)', // 表情 复古黄
  settings: 'linear-gradient(180deg, #A6ACB8 0%, #6C7280 100%)', // 设置 复古灰
  shop: 'linear-gradient(180deg, #EE7B6C 0%, #C44734 100%)', // 小店/卡包 复古红
  zone: 'linear-gradient(180deg, #7AB3EC 0%, #3E7CC4 100%)', // QQ 空间 复古蓝
  farm: 'linear-gradient(180deg, #93C85C 0%, #5E9E30 100%)', // 农场 复古绿
} as const;

/* ---------------------------------------------------------------------------
 * 白色 glyph 剪影（第五十六轮：发现/我页磁贴内符号，iOS 6「彩底白影」语言）
 * 统一 24 viewBox、fill/stroke 白色，尺寸由宿主 className 控制（默认 18px）。
 * ------------------------------------------------------------------------- */

function WBase({ children, className = 'h-[18px] w-[18px]' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** 朋友圈：老相机（旧微信朋友圈就是相机磁贴） */
export function RtWMoments({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M4 8.5 L6.5 8.5 L8 6 L16 6 L17.5 8.5 L20 8.5 C20.8 8.5 21.4 9.1 21.4 9.9 L21.4 17.6 C21.4 18.4 20.8 19 20 19 L4 19 C3.2 19 2.6 18.4 2.6 17.6 L2.6 9.9 C2.6 9.1 3.2 8.5 4 8.5 Z" fill="#FFFFFF" stroke="none" />
      <circle cx="12" cy="13.6" r="3.4" fill="none" stroke="#7AB3EC" strokeWidth={2} />
    </WBase>
  );
}

/** 视频号：圆角屏 + 白三角 */
export function RtWChannels({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="#FFFFFF" stroke="none" />
      <path d="M10 9.2 L15.4 12 L10 14.8 Z" fill="#F5A349" stroke="none" />
    </WBase>
  );
}

/** 扫一扫：方框扫描线 + 中线 */
export function RtWScan({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M3.5 8.5 V5.5 C3.5 4.4 4.4 3.5 5.5 3.5 H8.5" />
      <path d="M15.5 3.5 H18.5 C19.6 3.5 20.5 4.4 20.5 5.5 V8.5" />
      <path d="M20.5 15.5 V18.5 C20.5 19.6 19.6 20.5 18.5 20.5 H15.5" />
      <path d="M8.5 20.5 H5.5 C4.4 20.5 3.5 19.6 3.5 18.5 V15.5" />
      <path d="M6.5 12 H17.5" strokeWidth={2.4} />
    </WBase>
  );
}

/** 听一听：白八分音符 */
export function RtWListen({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M9.5 18.2 V6.2 L18.5 4 V15.6" />
      <ellipse cx="7" cy="18.4" rx="2.9" ry="2.4" fill="#FFFFFF" stroke="none" />
      <ellipse cx="16" cy="15.8" rx="2.9" ry="2.4" fill="#FFFFFF" stroke="none" />
    </WBase>
  );
}

/** 看一看：眼睛 */
export function RtWStories({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M2.5 12 C5 7.5 8.5 5.2 12 5.2 C15.5 5.2 19 7.5 21.5 12 C19 16.5 15.5 18.8 12 18.8 C8.5 18.8 5 16.5 2.5 12 Z" fill="#FFFFFF" stroke="none" />
      <circle cx="12" cy="12" r="3.2" fill="#F7C74C" stroke="none" />
    </WBase>
  );
}

/** 搜一搜：放大镜 */
export function RtWSearch({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <circle cx="10.5" cy="10.5" r="6.2" strokeWidth={2.4} />
      <path d="M15.2 15.2 L20.5 20.5" strokeWidth={2.6} />
    </WBase>
  );
}

/** 游戏：老式摇杆（底座 + 杆 + 球） */
export function RtWGames({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M8.2 13.5 H15.8 L18 19.5 H6 Z" fill="#FFFFFF" stroke="none" />
      <path d="M12 13.5 V8.6" strokeWidth={2.4} />
      <circle cx="12" cy="6.2" r="2.6" fill="#FFFFFF" stroke="none" />
    </WBase>
  );
}

/** 主题：调色画笔 */
export function RtWTheme({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M19.8 4.6 C17 6.4 13.2 9.4 10.8 12.4 L11.9 15.3 C15.4 14.4 18.6 11.4 20.4 8.6 C21.3 7.2 20.9 5.4 19.8 4.6 Z" fill="#FFFFFF" stroke="none" />
      <path d="M10.8 12.4 C8.6 13 6.6 14.4 6 16.2 C5.5 17.7 6.6 18.9 8 18.7 C9.6 18.5 11.2 17.2 11.9 15.3" strokeWidth={2} />
      <path d="M6 16.2 C5 17 4.2 18.6 4 20.4 C5.8 20.2 7.2 19.6 8 18.7" strokeWidth={2} />
    </WBase>
  );
}

/** 钱包/服务：白 ¥ 圆币 */
export function RtWWallet({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <circle cx="12" cy="12" r="9" fill="#FFFFFF" stroke="none" />
      <path d="M8.6 7.6 L12 11.6 L15.4 7.6 M10 12.6 H14 M12 11.6 V16.6 M9.8 14 H14.2" stroke="#5E9E30" strokeWidth={1.9} strokeLinecap="round" />
    </WBase>
  );
}

/** 收藏：五角星 */
export function RtWFavorites({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path d="M12 3.4 L14.7 8.9 L20.7 9.8 L16.3 14 L17.4 20 L12 17.1 L6.6 20 L7.7 14 L3.3 9.8 L9.3 8.9 Z" fill="#FFFFFF" stroke="none" />
    </WBase>
  );
}

/** 相册/作品：叠放照片 */
export function RtWWorks({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <rect x="7.2" y="3.6" width="13.2" height="10.4" rx="1.8" fill="#FFFFFF" stroke="none" />
      <rect x="3.6" y="9.8" width="13.2" height="10.6" rx="1.8" fill="#74BCBB" stroke="#FFFFFF" strokeWidth={1.8} />
    </WBase>
  );
}

/** 表情：笑脸 */
export function RtWSticker({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <circle cx="12" cy="12" r="8.8" fill="#FFFFFF" stroke="none" />
      <circle cx="9" cy="10" r="1.3" fill="#D8A01F" stroke="none" />
      <circle cx="15" cy="10" r="1.3" fill="#D8A01F" stroke="none" />
      <path d="M8.2 13.8 C9.4 16.4 14.6 16.4 15.8 13.8" stroke="#D8A01F" strokeWidth={1.9} />
    </WBase>
  );
}

/** 设置：齿轮 */
export function RtWSettings({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <path
        d="M12 8.4 C14 8.4 15.6 10 15.6 12 C15.6 14 14 15.6 12 15.6 C10 15.6 8.4 14 8.4 12 C8.4 10 10 8.4 12 8.4 Z M12 3.2 L13.2 5.6 C13.9 5.75 14.6 6 15.2 6.4 L17.8 5.6 L19.6 7.4 L18.8 10 C19.2 10.6 19.45 11.3 19.6 12 L22 13.2 V15.8 L19.6 17 C19.45 17.7 19.2 18.4 18.8 19 L19.6 21.6 L17.8 23.4 L15.2 22.6 C14.6 23 13.9 23.25 13.2 23.4 L12 25.8 L9.2 25.8 L8 23.4 C7.3 23.25 6.6 23 6 22.6 L3.4 23.4 L1.6 21.6 L2.4 19 C2 18.4 1.75 17.7 1.6 17 L-0.8 15.8 V13.2 L1.6 12 C1.75 11.3 2 10.6 2.4 10 L1.6 7.4 L3.4 5.6 L6 6.4 C6.6 6 7.3 5.75 8 5.6 L9.2 3.2 Z"
        fill="#FFFFFF"
        stroke="none"
        transform="scale(0.82) translate(2.6 2.6)"
      />
    </WBase>
  );
}

/** 小店/卡包：白卡片 */
export function RtWShop({ className }: { className?: string }) {
  return (
    <WBase className={className}>
      <rect x="3.4" y="6.4" width="17.2" height="12.4" rx="2.2" fill="#FFFFFF" stroke="none" />
      <path d="M3.4 10.2 H20.6" stroke="#C44734" strokeWidth={1.8} />
      <path d="M7 14 H12" stroke="#C44734" strokeWidth={1.8} strokeLinecap="round" />
    </WBase>
  );
}

/* ---------------------------------------------------------------------------
 * 微信加号面板实心复古图标（第五十六轮参考图2 同款：深灰 #6E7474 实心剪影 +
 * 白色镂空细节，无瓷贴直接坐在浅灰面板上；参考图实测图标色 ≈ #6E7474）。
 * 第五十八轮：颜色改走 CSS 变量（--rt-ic-body / --rt-ic-detail，深色模式成对切换）
 * ——快捷条 14px 小图标在深色输入栏上也能看清；统一 24 viewBox，默认 30px。
 * ------------------------------------------------------------------------- */

const PLUS_ICON_COLOR = 'var(--rt-ic-body)';
const PLUS_ICON_DETAIL = 'var(--rt-ic-detail)';

function PBase({ children, className = 'h-[30px] w-[30px]' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

/** 相机：实心机身 + 白镜头 + 顶取景器（参考图第2行同款） */
export function RtPlusCamera({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M8.6 4.6 L9.8 3 H14.2 L15.4 4.6 H18.4 C19.8 4.6 21 5.8 21 7.2 V17.4 C21 18.8 19.8 20 18.4 20 H5.6 C4.2 20 3 18.8 3 17.4 V7.2 C3 5.8 4.2 4.6 5.6 4.6 Z" fill={PLUS_ICON_COLOR} />
      <circle cx="12" cy="12.4" r="4" fill="none" stroke={PLUS_ICON_DETAIL} strokeWidth={2.2} />
      <circle cx="18.2" cy="8.4" r="1.1" fill={PLUS_ICON_DETAIL} />
    </PBase>
  );
}

/** 图片：实心圆角方块 + 白色山形与太阳（参考图第1行第1个同款） */
export function RtPlusImage({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M5 3.6 H19 C20.2 3.6 21.2 4.6 21.2 5.8 V18.2 C21.2 19.4 20.2 20.4 19 20.4 H5 C3.8 20.4 2.8 19.4 2.8 18.2 V5.8 C2.8 4.6 3.8 3.6 5 3.6 Z" fill="none" stroke={PLUS_ICON_COLOR} strokeWidth={2.4} />
      <path d="M5.8 17.2 L10 11.2 L13 15 L15.6 12 L18.6 17.2 Z" fill={PLUS_ICON_COLOR} />
      <circle cx="16.2" cy="8.2" r="1.9" fill={PLUS_ICON_COLOR} />
    </PBase>
  );
}

/** 语音通话：老式听筒（实心弯把手 + 话筒两颗） */
export function RtPlusVoice({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M4.4 9.2 C4.4 6 6.4 3.6 9.2 3.6 C10.4 3.6 11.2 4.4 11.4 5.6 L11.9 8 C12.1 9.1 11.5 10 10.5 10.4 L9.3 10.9 C10.1 12.6 11.4 14 13.1 14.8 L13.6 13.6 C14 12.6 15 12 16.1 12.2 L18.5 12.7 C19.6 12.9 20.4 13.8 20.4 15 C20.4 17.8 18 19.8 14.8 19.8 C9 19.8 4.4 15.1 4.4 9.2 Z" fill={PLUS_ICON_COLOR} />
    </PBase>
  );
}

/** 红包：实心红包 + 白封盖 + 白圆印 */
export function RtPlusRedPacket({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M5.4 3.4 H18.6 C19.4 3.4 20 4 20 4.8 V19.2 C20 20 19.4 20.6 18.6 20.6 H5.4 C4.6 20.6 4 20 4 19.2 V4.8 C4 4 4.6 3.4 5.4 3.4 Z" fill={PLUS_ICON_COLOR} />
      <path d="M4 3.4 C6 6.4 8.8 8 12 8 C15.2 8 18 6.4 20 3.4 L20 6.6 C17.8 9 15.1 10.2 12 10.2 C8.9 10.2 6.2 9 4 6.6 Z" fill={PLUS_ICON_DETAIL} />
      <circle cx="12" cy="14.2" r="2.6" fill="none" stroke={PLUS_ICON_DETAIL} strokeWidth={1.8} />
    </PBase>
  );
}

/** 转账：实心圆 + 白 ¥ */
export function RtPlusTransfer({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <circle cx="12" cy="12" r="9.2" fill={PLUS_ICON_COLOR} />
      <path d="M8.4 7.4 L11.6 11.3 L14.8 7.4 M9.7 12 H14.3 M11.6 11.3 V16.8 M9.4 14.3 H13.8" stroke={PLUS_ICON_DETAIL} strokeWidth={1.9} fill="none" strokeLinecap="round" />
    </PBase>
  );
}

/** 位置：实心地图针 + 白圆环（参考图第1行第4个同款） */
export function RtPlusLocation({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M12 2.6 C16.4 2.6 20 6.2 20 10.6 C20 15.9 14.4 20 12 21.6 C9.6 20 4 15.9 4 10.6 C4 6.2 7.6 2.6 12 2.6 Z" fill={PLUS_ICON_COLOR} />
      <circle cx="12" cy="10.4" r="3.2" fill="none" stroke={PLUS_ICON_DETAIL} strokeWidth={2.2} />
    </PBase>
  );
}

/** 线下：实心五角星（线下见面约定） */
export function RtPlusOffline({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M12 2.8 L14.8 8.5 L21 9.4 L16.5 13.8 L17.6 20 L12 17 L6.4 20 L7.5 13.8 L3 9.4 L9.2 8.5 Z" fill={PLUS_ICON_COLOR} />
    </PBase>
  );
}

/** 文字图片：实心卡片 + 白 T 字与线条 */
export function RtPlusTextCard({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2.4" fill={PLUS_ICON_COLOR} />
      <path d="M8 7.6 H16 M12 7.6 V16.4 M9.6 16.4 H14.4" stroke={PLUS_ICON_DETAIL} strokeWidth={1.9} fill="none" strokeLinecap="round" />
    </PBase>
  );
}

/** 一起听：实心耳机 */
export function RtPlusTogether({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M12 3.4 C6.9 3.4 3.6 7 3.6 11.4 V17 C3.6 18.4 4.8 19.6 6.2 19.6 H7.8 C8.4 19.6 8.8 19.2 8.8 18.6 V13.8 C8.8 13.2 8.4 12.8 7.8 12.8 H6 V11.4 C6 8.4 8.2 5.8 12 5.8 C15.8 5.8 18 8.4 18 11.4 V12.8 H16.2 C15.6 12.8 15.2 13.2 15.2 13.8 V18.6 C15.2 19.2 15.6 19.6 16.2 19.6 H17.8 C19.2 19.6 20.4 18.4 20.4 17 V11.4 C20.4 7 17.1 3.4 12 3.4 Z" fill={PLUS_ICON_COLOR} />
    </PBase>
  );
}

/** 礼物：实心礼盒 + 白丝带 */
export function RtPlusGift({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M4 8.4 H20 V11 H4 Z M5.2 12.4 H18.8 V19.4 C18.8 20 18.4 20.4 17.8 20.4 H6.2 C5.6 20.4 5.2 20 5.2 19.4 Z" fill={PLUS_ICON_COLOR} />
      <path d="M10.9 8.4 V20.4 H13.1 V8.4 Z" fill={PLUS_ICON_DETAIL} />
      <path d="M12 8.4 C9.2 8.4 7 7.4 7 5.7 C7 4.4 8 3.6 9.1 3.6 C10.8 3.6 11.7 5.4 12 8.4 C12.3 5.4 13.2 3.6 14.9 3.6 C16 3.6 17 4.4 17 5.7 C17 7.4 14.8 8.4 12 8.4 Z" fill="none" stroke={PLUS_ICON_COLOR} strokeWidth={1.9} />
    </PBase>
  );
}

/** 视频通话：实心摄相机机身 + 实心梯形镜头盖 + 白色播放三角（第五十八轮：
 *  视频通话从底部深色宽按钮移回宫格，与其他项同一语言） */
export function RtPlusVideo({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <rect x="2.8" y="6" width="13" height="12" rx="2.6" fill={PLUS_ICON_COLOR} />
      <path d="M16.6 10.4 L21.2 7.6 V16.4 L16.6 13.6 Z" fill={PLUS_ICON_COLOR} />
      <path d="M7 9.6 L12 12 L7 14.4 Z" fill={PLUS_ICON_DETAIL} />
    </PBase>
  );
}

/** 快递：实心包裹箱 + 白色箱盖接缝与垂直胶带（QQ 加号面板「快递」项） */
export function RtPlusExpress({ className }: { className?: string }) {
  return (
    <PBase className={className}>
      <path d="M12 2.8 L20.2 6.6 V17.4 L12 21.2 L3.8 17.4 V6.6 Z" fill={PLUS_ICON_COLOR} />
      <path d="M3.8 6.6 L12 10.4 L20.2 6.6" stroke={PLUS_ICON_DETAIL} strokeWidth={1.9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10.4 V21.2" stroke={PLUS_ICON_DETAIL} strokeWidth={1.9} fill="none" strokeLinecap="round" />
    </PBase>
  );
}
