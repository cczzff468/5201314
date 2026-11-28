'use client';

// 设置 App 共享层：Page 路由类型、IOS_RED 色板、通用小组件（GroupCard / RowIcon / LineIcon / MainRow / DetailShell / FieldLabel / SectionLabel / GrayCard）与 useOwnerAvatar。只依赖 React 与项目 lib，不 import 其他设置子模块。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import type { ReactNode } from 'react';

import { ChevronRight, X } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

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

/** 详情页外壳 v2.4.36「液态玻璃底部弹层」：设置 App 全域从整页跳转改为 bottom sheet——
 *  遮罩 bg-black/25 极淡黑（背后常驻的主列表 RootPage 隐约可见，点遮罩关闭），面板为
 *  rounded-t-[28px] 玻璃白（bg-white/[0.94] + backdrop-blur-2xl + 白高光描边 + 上抛柔影，
 *  深色模式换 zinc-900 玻璃）。入场：遮罩淡入 200ms + 面板底部滑入 300ms ease-out；
 *  关闭：遮罩淡出 200ms / 面板下滑 260ms，动画播完才回调 onBack（真实卸载由父级路由
 *  状态机控制）。关闭途径：点遮罩 / 右上角 X / Esc / 按住顶部（grabber + 标题行）
 *  下拉超 90px 松手。内容区保留字面 overflow-y-auto（useModelPanelReveal 靠
 *  closest('.overflow-y-auto') 找滚动容器）；子页内 Radix AlertDialog portal 到 body
 *  （z-50 壳外层）仍压在面板上方，Esc 先让这些更上层的弹窗吃掉，不连坐关面板。
 *  gray 参数保留入参但视觉忽略（v2.4.36 前用于子页导航栏透明分支，面板化后无导航栏）。
 *  面板 z-[200]/z-[201]：App 窗口（z-40）内部自成一层的层级；PhoneShell 的 transform
 *  使 fixed 相对机身定位（与通知页 ToneSheet 同机制），天然只覆盖手机屏。
 *  历史沿革：v68 曾加过 4 枚彩色氛围光晕（蓝/紫/橙/粉），后按用户要求全部删除；
 *  v2.4.36 前为整页浅灰底（#F2F2F7）+ 居中标题导航栏 + 返回键 + 右滑入场。 */
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
  // v2.4.36 面板化：gray 不再参与视觉（保留入参兼容全部子页调用点）
  void gray;
  const [phase, setPhase] = useState<'open' | 'closing'>('open');
  const closeTimer = useRef<number | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);

  /** 统一关闭入口：先播退场动画（遮罩淡出 / 面板下滑 260ms），播完再回调 onBack */
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return; // 已在关闭流程中
    setPhase('closing');
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onBackRef.current();
    }, 260);
  }, []);

  // Esc 关闭；子页内还有更上层的弹层开着（Radix AlertDialog/Dialog portal 到 body、
  // 通知页 ToneSheet 等挂 aria-modal 的内嵌面板）时，这次 Esc 只关那层，不连坐关本面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]:not([data-detail-sheet])')) return;
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 卸载兑底：父级强卸载（切 App / 直接回主屏）时清掉未走完的关闭计时器
  useEffect(
    () => () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    },
    [],
  );

  // ---- 顶部标题区（grabber + 标题行）下拉关闭；内容滚动区不参与 ----
  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (closeTimer.current !== null || dragStartY.current !== null) return;
    // X 关闭按钮上的按下不进拖拽：pointer capture 会改写后续 click 目标，破坏按钮
    if ((e.target as HTMLElement).closest('button')) return;
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transition = 'none'; // 拖拽跟手：临时关过渡
  };
  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartY.current === null) return;
    const dy = Math.max(0, e.clientY - dragStartY.current);
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transform = `translateY(${dy}px)`;
  };
  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartY.current === null) return;
    const dy = Math.max(0, e.clientY - dragStartY.current);
    dragStartY.current = null;
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (dy > 90) {
      // 下拉超阈值：保留当前位移作退场起点（exit 关键帧的隐式 from），动画连续不跳变
      requestClose();
      return;
    }
    sheet.style.transition = 'transform 200ms ease-out'; // 未超阈值：回弹复位
    sheet.style.transform = '';
  };
  const onHeaderPointerCancel = (): void => {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = 'transform 200ms ease-out';
      sheet.style.transform = '';
    }
  };

  const closing = phase === 'closing';
  return (
    <>
      {/* 极淡黑遮罩：背后常驻的主列表隐约可见；点击关闭 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={requestClose}
        className={`fixed inset-0 z-[200] cursor-default bg-black/25 ${
          closing ? 'animate-out fade-out duration-200' : 'animate-in fade-in duration-200'
        }`}
      />
      {/* 液态玻璃面板（PhoneShell transform 使 fixed 相对机身定位，只覆盖手机屏） */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-detail-sheet=""
        className={`fixed inset-x-0 bottom-0 z-[201] flex max-h-[86%] flex-col rounded-t-[28px] border-x border-t border-white/60 bg-white/[0.94] shadow-[0_-8px_40px_rgba(24,24,27,0.14),inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/[0.94] ${
          closing
            ? 'animate-out slide-out-to-bottom duration-260'
            : 'animate-in slide-in-from-bottom duration-300 ease-out'
        }`}
      >
        {/* 顶部拖拽关闭区（grabber + 标题行；touch-none 防浏览器拖动劫持，不影响内容滚动） */}
        <div
          className="relative shrink-0 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerCancel}
        >
          <div className="flex justify-center">
            <span className="mt-2.5 h-[5px] w-9 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
          </div>
          <div className="relative flex h-[52px] shrink-0 items-center justify-center px-14">
            <span className="max-w-full truncate text-[17px] font-semibold text-zinc-900 dark:text-zinc-50">{title}</span>
            <button
              type="button"
              aria-label="关闭"
              onClick={requestClose}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/[0.05] transition active:scale-90 dark:bg-white/10"
            >
              <X className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
            </button>
          </div>
        </div>
        {/* 内容滚动区：保留字面 overflow-y-auto——useModelPanelReveal 靠它找滚动容器 */}
        <div className="no-scrollbar relative flex-1 overflow-y-auto">
          <div className="px-4 pb-[44px] pt-1">{children}</div>
        </div>
      </div>
    </>
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
