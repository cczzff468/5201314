'use client';

/**
 * X论坛 · 共享 UI 基础件（X/Twitter 视觉 1:1）。
 *
 * - 色板严格取自 X 官方设计系统：品牌蓝 #1d9bf0、点赞粉 #f91880、转推绿 #00ba7c；
 *   浅色 白底/#0f1419 正文/#536471 次要/#eff3f4 分隔线；深色 纯黑底/#e7e9ea 正文/
 *   #71767b 次要/#2f3336 分隔线（X 深色即纯黑，与手机深色主题天然契合）。
 * - 图标 lucide 线条（strokeWidth 1.9），选中态实心填充（X 底栏行为：选中黑、未选灰）。
 * - 头像：dataURL 直出；NPC 彩底首字圆；缺省用用户指定的默认头像图
 *   （public/default-profile.png，用户上传的灰蓝人形剪影风）。
 * - 认证徽章：蓝圆白勾（X 2023 版认证样式）。
 */

import { useSystemDark, selectResolvedTheme, useSettings } from '@/lib/ios/store';
import { resolveAuthor, type AuthorKey } from '@/lib/forum/core';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bookmark,
  Compass,
  Heart,
  House,
  Mail,
  MessageCircle,
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

/** X 风格头像：图片直出 / NPC 彩底首字 / 灰底剪影（无头像时）。
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
  // 头像图加载失败（CDN 不可达等）→ 回退 NPC 彩底首字，避免裂图
  const [imgBroken, setImgBroken] = useState(false);
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
    inner = (
      <span
        style={{ background: a.npcAvatar.bg, fontSize: size * 0.42, fontWeight: 700 }}
        className="flex h-full w-full select-none items-center justify-center text-white"
      >
        {a.npcAvatar.ch}
      </span>
    );
  } else {
    // 默认头像：用户上传的灰蓝人形剪影（无自定义/全局头像时使用）
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
