'use client';

// 设置 App 共享层：Page 路由类型、IOS_RED 色板、通用小组件（GroupCard / RowIcon / LineIcon / MainRow / DetailShell / FieldLabel / SectionLabel / GrayCard）与 useOwnerAvatar。只依赖 React 与项目 lib，不 import 其他设置子模块。

import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import type { ReactNode } from 'react';

import { ChevronRight } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import {
  IOSBackButton,
  IOSNavBar,
} from '@/components/ios/IOSNavBar';

import { mainOwnerContact } from '@/lib/ios/contacts-store';


// ---------------- 常量与类型 ----------------

export type Page = 'root' | 'account' | 'profile' | 'theme' | 'notification' | 'wallpaper' | 'font' | 'api' | 'vision' | 'imggen' | 'voice' | 'about' | 'lock' | 'prompts' | 'autonomy' | 'voiceagent' | 'appupdate' | 'pwa' | 'cloud';

export const IOS_RED = '#FF453A';

// ---------------- 通用小组件 ----------------

/** iOS 分组卡片（子页用）：GrayCard 同款毛玻璃配方但无内边距（divide-y 行列表用，分隔线贴边）。
 *  SETTINGS-THEME：恒浅色玻璃白（bg-white/80 + 黑色低透明描边/分隔线），不随深色主题变黑 */
export function GroupCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-2xl">{children}</div>
  );
}

/** iOS 系统设置图标色板（参照用户截图：纯色圆角方块 + 白色图标） */
export const TONE_ORANGE = '#FF9500';
export const TONE_BLUE = '#007AFF';
export const TONE_GREEN = '#34C759';
export const TONE_RED = '#FF3B30';
export const TONE_GRAY = '#8E8E93';
export const TONE_CYAN = '#32ADE6';
export const TONE_PURPLE = '#AF52FF';
export const TONE_PINK = '#FF2D55';

/** 主列表行图标：纯色圆角方块 + 白色线性图标（iOS 设置风） */
export function RowIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
      style={{ backgroundColor: tone }}
    >
      <Icon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
    </span>
  );
}

/**
 * 黑白线条行图标（v1.9.14：默认预设 / AI 动手 / 语音唤起智能体页专用）：
 * 裸图标——外框方形圆角已按机主要求删除（v1.9.13 的细描边中性框不要了），
 * 只留前景色细线条黑白图标，对齐用不可见槽位保行高一致
 */
export function LineIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-[30px] w-[24px] shrink-0 items-center justify-center">
      <Icon className="h-[20px] w-[20px] text-zinc-800/85" strokeWidth={1.8} />
    </span>
  );
}

/** 主列表行：左彩色方块图标 + 标签，右侧可选值 / ChevronRight（testId：需要 E2E 定位的行传入） */
export function MainRow({
  icon,
  tone,
  label,
  value,
  onClick,
  chevron,
  badge,
  testId,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value?: string;
  onClick?: () => void;
  chevron?: boolean;
  /** 红点提醒（如 APP 更新有新版）：label 右侧小圆点 */
  badge?: boolean;
  testId?: string;
}) {
  const showChevron = chevron ?? onClick !== undefined;
  const inner = (
    <>
      <RowIcon icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-[16px]">{label}</span>
        {badge ? (
          <span className="h-[8px] w-[8px] shrink-0 rounded-full bg-[#FF3B30]" aria-hidden="true" />
        ) : null}
      </span>
      {value !== undefined && (
        <span className="max-w-[50%] shrink-0 truncate text-[15px] text-zinc-500">{value}</span>
      )}
      {showChevron && <ChevronRight className="h-5 w-5 shrink-0 text-zinc-500/60" />}
    </>
  );

  if (onClick === undefined) {
    return <div className="flex min-h-[52px] items-center gap-3 px-4 py-2 text-zinc-900">{inner}</div>;
  }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left text-zinc-900 transition-colors active:bg-black/[0.05]"
    >
      {inner}
    </button>
  );
}

/** 详情页外壳：居中标题导航 + 返回按钮 + 右滑进入动画；
 *  SETTINGS-THEME：子页恒浅色（绿/白/灰/蓝清爽风）——整页底色固定 #F3F6F3（带一点绿意的
 *  浅灰白），文字恒深色 text-zinc-900，不随深色主题变黑；gray 参数语义保留（true 时导航栏
 *  透明无毛玻璃），两个分支底色同为浅色。
 *  历史沿革：v68 曾加过 4 枚彩色氛围光晕（蓝/紫/橙/粉，给玻璃卡的 backdrop-blur 提供折射光），
 *  本轮起按用户要求全部删除（先删珊瑚色橙/粉两枚，再删蓝/紫两枚）——
 *  子页背景回归纯浅灰，无任何彩色光斑特效 */
export function DetailShell({
  title,
  onBack,
  children,
  gray = false,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
  gray?: boolean;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-[#F3F6F3] text-zinc-900">
      <IOSNavBar
        title={title}
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className={gray ? 'bg-transparent! backdrop-blur-none!' : ''}
      />
      <div className="no-scrollbar relative flex-1 overflow-y-auto">
        <div
          key={title}
          className="animate-in slide-in-from-right-6 fade-in duration-300 px-4 pb-[40px] pt-2"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[13px] font-medium text-zinc-500">{children}</div>;
}

/** 配置页分组标题：小色块图标 + 灰字标签（iOS 设置风），右侧可选自定义内容 */
export function SectionLabel({
  icon: Icon,
  tone,
  children,
  right,
}: {
  icon: LucideIcon;
  tone: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-500">
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]"
          style={{ backgroundColor: `${tone}1F` }}
        >
          <Icon className="h-[11px] w-[11px]" style={{ color: tone }} strokeWidth={2.6} />
        </span>
        {children}
      </div>
      {right}
    </div>
  );
}

/** 毛玻璃分组卡片（glassmorphism）：半透明白 + backdrop-blur + 高光描边 + 柔和投影。
 *  SETTINGS-THEME：恒浅色玻璃白（与 GroupCard 同配方），不随深色主题变黑 */
export function GrayCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[22px] bg-white/80 p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-2xl ${className}`}
    >
      {children}
    </div>
  );
}

/** 全局头像（联系人 App 机主）：设置侧头像为空时跟随它；contact-updated 实时刷新 */
export function useOwnerAvatar(): string | null {
  const [ownerAvatar, setOwnerAvatar] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void mainOwnerContact()
        .then((o) => {
          if (alive) setOwnerAvatar(o?.avatar ?? null);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener('contact-updated', load);
    window.addEventListener('contact-avatar-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('contact-updated', load);
      window.removeEventListener('contact-avatar-changed', load);
    };
  }, []);
  return ownerAvatar;
}

// ---------------- 拉取模型面板（api/vision/imggen/voice 四页共用） ----------------

/** 触屏设备探测（模块级一次性）：模型面板搜索框 autoFocus 仅桌面保留——
 *  触屏上面板一开就拉起软键盘会盖住大半个面板（v2.4.27 机主反馈「拉取弹窗
 *  上面那里还在遮挡模型」的直接诱因之一）；桌面保留 autoFocus 键盘直达搜索 */
export const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);

/**
 * 模型下拉面板的「自动补滚露出」hook（v2.4.27 第四十六轮统一四页实现）：
 * - ① 可见底边以滚动容器为准（桌面预览壳内才是真实可视区），并与窗口取小——
 *   旧版用 window.innerHeight，桌面预览时手机壳 844px 外的窗口很高，面板尾部
 *   被壳裁剪也不触发补滚（APK 全屏时两者相等，行为不变）；
 * - ② 补滚上限收紧：除最大可滚量外，还不得超过「锚点行顶部到容器顶部」的余量——
 *   面板再长也优先保「模型标签/输入行」在屏内（被压出容器顶部即机主反馈的
 *   「上面那里遮挡模型」），面板尾部超出时由列表内部滚动兜底；
 * - ③ 键盘弹起/窗口尺寸变化（搜索框拉起软键盘、旋转、拖动预览窗口）时重算补滚：
 *   visualViewport resize + window resize 双监听，键盘收起后同样回到正确位置。
 * 用法：const ref = useRef<HTMLDivElement>(null); useModelPanelReveal(ref, open, models, query);
 */
export function useModelPanelReveal(
  modelSectionRef: RefObject<HTMLDivElement | null>,
  modelPanelOpen: boolean,
  models: string[],
  modelQuery: string,
): void {
  useEffect(() => {
    if (!modelPanelOpen) return;
    const reveal = () => {
      const sec = modelSectionRef.current;
      if (!sec) return;
      const sc = sec.closest('.overflow-y-auto') as HTMLElement | null;
      const panel = sec.querySelector('[data-model-panel]') as HTMLElement | null;
      if (!sc || !panel) {
        sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const pr = panel.getBoundingClientRect();
      const sr = sec.getBoundingClientRect();
      const scr = sc.getBoundingClientRect();
      const visibleBottom = Math.min(scr.bottom, window.innerHeight);
      if (pr.bottom > visibleBottom - 12) {
        // 面板尾部出屏：补滚（夹在最大可滚量内；页面不够长时列表内部滚兑底）
        const over = pr.bottom - (visibleBottom - 12);
        const max = sc.scrollHeight - sc.clientHeight;
        // 锚点行（模型标签/输入行）不破屏：最多滚到锚点行顶部刚到容器顶部为止
        const anchorBudget = Math.max(0, sr.top - scr.top - 4);
        sc.scrollTop = Math.min(max, sc.scrollTop + Math.max(0, Math.min(over, anchorBudget)));
      }
    };
    const t = window.setTimeout(reveal, 120);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const onVvResize = () => reveal();
    vv?.addEventListener('resize', onVvResize);
    window.addEventListener('resize', onVvResize);
    return () => {
      window.clearTimeout(t);
      vv?.removeEventListener('resize', onVvResize);
      window.removeEventListener('resize', onVvResize);
    };
  }, [modelSectionRef, modelPanelOpen, models, modelQuery]);
}
