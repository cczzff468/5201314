'use client';

/**
 * X论坛 · 共享 UI 基础件（X/Twitter 视觉 1:1）。
 *
 * - 色板严格取自 X 官方设计系统：品牌蓝 #1d9bf0、点赞粉 #f91880、转推绿 #00ba7c；
 *   浅色 白底/#0f1419 正文/#536471 次要/#eff3f4 分隔线；深色 纯黑底/#e7e9ea 正文/
 *   #71767b 次要/#2f3336 分隔线（X 深色即纯黑，与手机深色主题天然契合）。
 * - 图标 lucide 线条（strokeWidth 1.9），选中态实心填充（X 底栏行为：选中黑、未选灰）。
 * - 头像：dataURL 直出；头像库图片（avatar-library）随机分配；加载失败/偶然无头像的网友
 *   用 flat 纯色系池轮换兑底（用户上传：默认灰人形/灰圆/纯黑/纯白/灰渐变）；
 *   机主未设头像用固定默认剪影（public/default-profile.png）。
 * - 认证徽章：蓝圆白勾（X 2023 版认证样式）。
 */

import { useSystemDark, selectResolvedTheme, useSettings } from '@/lib/ios/store';
import { resolveAuthor, flatAvatarFor, type AuthorKey } from '@/lib/forum/core';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bookmark,
  Citrus,
  Compass,
  Heart,
  House,
  Laugh,
  Mail,
  MessageCircle,
  MessageCircleHeart,
  Mic,
  MoreHorizontal,
  PenLine,
  Plus,
  Repeat2,
  Search,
  Settings,
  Share2,
  Users,
  UserPlus,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

// ---------------- 主题 token ----------------

export interface XTheme {
  dark: boolean;
  /** 页面底色 */
  bg: string;
  /** 正文 */
  text: string;
  /** 次要文字/图标未激活 */
  secondary: string;
  /** 分隔线/描边 */
  border: string;
  /** hover 底色 */
  hover: string;
  /** 品牌蓝 */
  blue: string;
  /** 点赞粉 */
  pink: string;
  /** 转推绿 */
  green: string;
}

export function useXTheme(): XTheme {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  return {
    dark,
    bg: dark ? '#000000' : '#ffffff',
    text: dark ? '#e7e9ea' : '#0f1419',
    secondary: dark ? '#71767b' : '#536471',
    border: dark ? '#2f3336' : '#eff3f4',
    hover: dark ? '#16181a' : '#f7f9f9',
    blue: '#1d9bf0',
    pink: '#f91880',
    green: '#00ba7c',
  };
}

/** 常用 className 组合（主题类无法用 CSS 变量时直接拼 style） */
export function xFont(t: XTheme): React.CSSProperties {
  return { color: t.text };
}

// ---------------- 图标（统一 X 线条风） ----------------

const SW = 1.9;

export const XIcons = {
  home: (filled: boolean, size = 25) => (
    <House width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
  search: (size = 25) => <Search width={size} height={size} strokeWidth={SW} />,
  communities: (filled: boolean, size = 25) => (
    <Users width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
  /** X 空间（Spaces，官方底栏第 3 位：圆环 + 闪电；选中实心圆 + 底色闪电镂空） */
  spaces: (filled: boolean, size = 25, bg = '#ffffff') => (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={SW} />
      <path
        d="M13.2 6.4 8.9 12.9h2.9l-1 4.7 4.4-6.9h-2.9l.9-4.3z"
        fill={filled ? bg : 'currentColor'}
        stroke="none"
      />
    </svg>
  ),
  bell: (filled: boolean, size = 25) => (
    <Bell width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
  mail: (filled: boolean, size = 25) => (
    <Mail width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
  reply: (size = 19) => <MessageCircle width={size} height={size} strokeWidth={SW} />,
  repost: (size = 19) => <Repeat2 width={size} height={size} strokeWidth={SW} />,
  like: (filled: boolean, size = 19) => (
    <Heart width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
  views: (size = 19) => <BarChart3 width={size} height={size} strokeWidth={SW} />,
  /** 分享：X 官方三节点网络样式（三个圆点连线，非弯曲箭头） */
  share: (size = 19) => <Share2 width={size} height={size} strokeWidth={SW} />,
  more: (size = 19) => <MoreHorizontal width={size} height={size} strokeWidth={SW} />,
  back: (size = 20) => <ArrowLeft width={size} height={size} strokeWidth={SW} />,
  settings: (size = 22) => <Settings width={size} height={size} strokeWidth={SW} />,
  plus: (size = 20) => <Plus width={size} height={size} strokeWidth={2.2} />,
  compass: (size = 22) => <Compass width={size} height={size} strokeWidth={SW} />,
  compose: (size = 26) => <PenLine width={size} height={size} strokeWidth={2.1} />,
  follow: (size = 15) => <UserPlus width={size} height={size} strokeWidth={SW} />,
  following: (size = 15) => <UserCheck width={size} height={size} strokeWidth={SW} />,
  bookmark: (filled: boolean, size = 19) => (
    <Bookmark width={size} height={size} strokeWidth={SW} fill={filled ? 'currentColor' : 'none'} />
  ),
};

/** X 官方 wordmark 𝕏（app 内展示用；主屏图标在 public/icons/forum.svg 同款） */
export function XLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

// ---------------- 认证徽章（蓝圆白勾） ----------------

export function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-label="认证账号" role="img">
      <circle cx="12" cy="12" r="11" fill="#1d9bf0" />
      <path
        d="M6.5 12.4l3.3 3.3c.3.3.8.3 1.1 0l6.6-6.6c.3-.3.3-.8 0-1.1l-.9-.9c-.3-.3-.8-.3-1.1 0l-4.6 4.6c-.3.3-.8.3-1.1 0l-2.1-2.1c-.3-.3-.8-.3-1.1 0l-.9.9c-.3.3-.3.7 0 1z"
        fill="#fff"
      />
    </svg>
  );
}

// ---------------- 头像 ----------------

/** X 风格头像：图片直出 / flat 纯色系轮换兑底 / 官方蓝底「助」字 / 灰底剪影（机主）。
 *  可点击时渲染 <button>；纯展示时渲染 <span>（避免嵌入父级 button 造成非法嵌套）。 */
export function XAvatar({
  authorKey,
  size = 40,
  onClick,
}: {
  authorKey: AuthorKey;
  size?: number;
  onClick?: () => void;
}) {
  const a = resolveAuthor(authorKey);
  // 头像图加载失败（CDN 不可达等）→ flat 纯色系池轮换兑底（用户上传的 5 张：
  // 默认灰人形/灰圆/纯黑/纯白/灰渐变），不再回退彩底首字；flat 也挂了才用灰人形
  const [imgBroken, setImgBroken] = useState(false);
  const [flatBroken, setFlatBroken] = useState(false);
  let inner: ReactNode;
  if (a.avatar && !imgBroken) {
    // dataURL / 头像库 CDN URL 直出（IndexedDB 与朋友圈/聊天头像同口径，不经 next/image 优化端点）
    inner = (
      <img
        src={a.avatar}
        alt={a.name}
        draggable={false}
        onError={() => setImgBroken(true)}
        className="h-full w-full select-none object-cover"
      />
    );
  } else if (a.npcAvatar) {
    // 仅官方账号保留品牌徽章式头像（蓝底「助」字）
    inner = (
      <span
        style={{ background: a.npcAvatar.bg, fontSize: size * 0.42, fontWeight: 700 }}
        className="flex h-full w-full select-none items-center justify-center text-white"
      >
        {a.npcAvatar.ch}
      </span>
    );
  } else if (authorKey === 'user') {
    // 机主未设头像：固定默认剪影（自己的头像不参与轮换）
    inner = (
      <img
        src="/default-profile.png"
        alt={a.name}
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    );
  } else if (!flatBroken) {
    // NPC 头像缺失/加载失败：默认+纯色系头像轮换（按 key 稳定分配，
    // 不同人拿到不同的——像真实平台里不设头像的那批用户）
    inner = (
      <img
        src={flatAvatarFor(authorKey)}
        alt={a.name}
        draggable={false}
        onError={() => setFlatBroken(true)}
        className="h-full w-full select-none object-cover"
      />
    );
  } else {
    inner = (
      <img
        src="/default-profile.png"
        alt={a.name}
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    );
  }
  // inline-block 必须显式声明：span 默认 inline 无法设置宽高，
  // 会导致头像在无点击场景（个人主页 80px 大头像等）被内容撑破变形。
  // overflow-hidden 需要 display 非 inline 才能裁切生效。
  const cls = 'inline-block shrink-0 select-none overflow-hidden rounded-full bg-black/[0.03] dark:bg-white/[0.06]';
  const style: React.CSSProperties = { width: size, height: size, padding: 0, border: 0 };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={`查看${a.name}的主页`} className={cls} style={{ ...style, cursor: 'pointer' }}>
        {inner}
      </button>
    );
  }
  return (
    <span aria-hidden="true" className={cls} style={style}>
      {inner}
    </span>
  );
}

// ---------------- 世界观图标（纯色平涂徽章 + 矢量 glyph） ----------------

/** 内置 5 套世界观的签名色（平涂单色，中等饱和，全部避开蓝/靛）：
 *  韩娱嫂站＝嫂子粉；内娱八卦＝瓜橙；校园暗恋墙＝樱花玫红；
 *  硬核追星现场＝舞台紫；抽象乐子人＝乐子金。 */
const WV_BUILTIN_COLORS: Record<string, string> = {
  'builtin:hyul': '#f06292',
  'builtin:neiyu': '#f4773b',
  'builtin:campus': '#ef6a7f',
  'builtin:concert': '#b45bd4',
  'builtin:abstract': '#e8a13c',
};

/** 内置世界观的签名 glyph（白色描线矢量图标——不用 emoji）：
 *  韩娱嫂站＝心（追星的爱）；内娱八卦＝柑橘切片（「瓜」）；校园暗恋墙＝带心的消息气泡
 *  （匿名投稿）；硬核追星现场＝麦克风（演唱会）；抽象乐子人＝笑脸（纯乐子）。 */
const WV_BUILTIN_ICONS: Record<string, LucideIcon> = {
  'builtin:hyul': Heart,
  'builtin:neiyu': Citrus,
  'builtin:campus': MessageCircleHeart,
  'builtin:concert': Mic,
  'builtin:abstract': Laugh,
};

/** 自建世界观平涂色池（按名字哈希稳定取一个——改名配色跟着换，名字回看即知） */
const WV_CUSTOM_PALETTE: string[] = [
  '#e05a9a',
  '#e8683c',
  '#e46a80',
  '#a55ad0',
  '#d9a238',
  '#3fa38a',
  '#d95850',
  '#c05fd0',
];

/** 世界观徽章平涂色（内置签名配色；自建按名字哈希稳定落池） */
export function worldviewColor(id: string, name?: string): string {
  const sig = WV_BUILTIN_COLORS[id];
  if (sig) return sig;
  const seed = (name ?? '').trim() || id;
  let h = 0;
  for (const ch of seed) h = (h * 131 + ch.codePointAt(0)!) >>> 0;
  return WV_CUSTOM_PALETTE[h % WV_CUSTOM_PALETTE.length];
}

/** 世界观图标：纯色平涂方圆徽章（app 图标式 31% 圆角）+ 白色矢量 glyph
 *  （内置＝签名描线图标，自建＝名字首字白粗体）——平涂无渐变/无高光/
 *  无内描边/无彩色投影（用户要求 v38），不用 emoji。 */
export function WorldviewIcon({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const bg = worldviewColor(id, name);
  const r = Math.round(size * 0.31);
  const Icon = WV_BUILTIN_ICONS[id];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 select-none items-center justify-center"
      style={{ width: size, height: size, borderRadius: r, background: bg }}
    >
      {Icon ? (
        <Icon size={Math.round(size * 0.52)} strokeWidth={Math.max(1.8, size * 0.055)} color="#ffffff" />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.44), fontWeight: 700, color: '#fff', lineHeight: 1 }}>
          {name.trim().slice(0, 1) || '世'}
        </span>
      )}
    </span>
  );
}

// ---------------- 通用小组件 ----------------

/** X 按钮（实心蓝 / 描边 / 黑），供 关注/发布/加入 等复用 */
export function XButton({
  children,
  onClick,
  variant = 'solid',
  disabled,
  size = 'sm',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'solid' | 'outline' | 'dark' | 'darkOutline';
  disabled?: boolean;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const t = useXTheme();
  const base =
    'inline-flex items-center justify-center gap-1 rounded-full font-bold transition-opacity active:opacity-70 disabled:opacity-50';
  const pad = size === 'lg' ? 'px-6 h-[44px] text-[17px]' : 'px-4 h-[32px] text-[14px]';
  const style: React.CSSProperties =
    variant === 'solid'
      ? { background: t.blue, color: '#fff' }
      : variant === 'outline'
        ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
        : variant === 'dark'
          ? { background: t.text, color: t.bg }
          : { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${pad} ${className}`} style={style}>
      {children}
    </button>
  );
}

/** 版块小胶囊（帖子卡片右上/详情页用） */
export function CommunityTag({ name, onClick }: { name: string; onClick?: () => void }) {
  const t = useXTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full px-2 py-[2px] text-[11px] leading-[14px] font-medium transition-opacity active:opacity-60"
      style={{ background: t.dark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.12)', color: t.blue }}
    >
      {name}
    </button>
  );
}
