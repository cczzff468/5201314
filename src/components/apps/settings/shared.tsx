'use client';

// 设置 App 共享层：Page 路由类型、IOS_RED 色板、通用小组件（GroupCard / RowIcon / LineIcon / MainRow / DetailShell / FieldLabel / SectionLabel / GrayCard）与 useOwnerAvatar。只依赖 React 与项目 lib，不 import 其他设置子模块。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import type { ReactNode } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import { mainOwnerContact } from '@/lib/ios/contacts-store';


// ---------------- 常量与类型 ----------------

export type Page = 'root' | 'account' | 'profile' | 'theme' | 'notification' | 'wallpaper' | 'font' | 'api' | 'vision' | 'imggen' | 'voice' | 'about' | 'lock' | 'prompts' | 'autonomy' | 'voiceagent' | 'appupdate' | 'pwa' | 'cloud';

export const IOS_RED = '#FF453A';

// ---------------- 通用小组件 ----------------

/** iOS 分组卡片（子页用）：v2.4.37 液体玻璃配方——半透明白（bg-white/[0.66]）+
 *  blur(30px) saturate(180%)（backdrop-blur-2xl 由全局统一）+ 1px 极细白半透明描边
 *  （rgba(255,255,255,0.4) 玻璃边缘反光）+ 极浅弥散柔影（悬浮感）+ 顶部高光反射。
 *  SETTINGS-THEME：恒浅色玻璃白，不随深色主题变黑；无内边距（divide-y 行列表用）。 */
export function GroupCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[24px] bg-white/[0.66] shadow-[0_2px_8px_rgba(24,24,27,0.03),0_14px_44px_rgba(24,24,27,0.07),inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-white/40 backdrop-blur-2xl">{children}</div>
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

/** 详情页外壳 v2.4.37「独立整页跳转」：机主令——设置、API 配置、识图模型、图像生成等
 *  全部子页面不再用底部滑出的毛玻璃弹层，改为【独立界面整页】呈现（iOS push 导航感）：
 *  fixed inset-0 铺满机身（PhoneShell 的 transform 使 fixed 相对机身定位，只覆盖手机
 *  屏），右滑入场 300ms ease-out / 右滑退场 260ms，退场播完才回调 onBack（真实卸载由
 *  父级路由状态机控制）；顶部为「返回键 + 居中标题」导航栏（pt-[54px] 避让状态栏，
 *  与根页同款）；页面底为液态玻璃（bg-[#F2F2F7]/[0.9] + backdrop-blur-2xl→30px，
 *  常驻挂载的根列表隐约透出；SETTINGS-THEME 恒浅色——不挂 dark 变体，深色主题下
 *  与根页一致整体浅色，子页内容（玻璃白卡片/zinc-900 文字）均为浅色设计）。
 *  关闭途径：左上角返回键 / Esc；
 *  子页内 Radix AlertDialog portal 到 body 仍压在页面上方，Esc 先让那些更上层的弹窗
 *  吃掉，不连坐关页面。内容区保留字面 overflow-y-auto（useModelPanelReveal 靠
 *  closest('.overflow-y-auto') 找滚动容器）；页面 z-[201]：App 窗口（z-40）内部自成
 *  一层的层级。gray 参数保留入参但视觉忽略（历史兼容）。
 *  历史沿革：v2.4.36 曾改为底部滑出弹层（DetailShell 面板化），v2.4.37 按机主要求
 *  回归整页跳转并全面液态玻璃化；v68 曾加过 4 枚彩色氛围光晕，后按用户要求删除。 */
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
  // v2.4.37 整页化：gray 不再参与视觉（保留入参兼容全部子页调用点）
  void gray;
  const [phase, setPhase] = useState<'open' | 'closing'>('open');
  const closeTimer = useRef<number | null>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  /** 统一关闭入口：先播右滑退场动画 260ms，播完再回调 onBack */
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return; // 已在关闭流程中
    setPhase('closing');
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onBackRef.current();
    }, 260);
  }, []);

  // Esc 关闭；子页内还有更上层的弹层开着（Radix AlertDialog/Dialog portal 到 body、
  // 通知页 ToneSheet 等挂 aria-modal 的内嵌面板）时，这次 Esc 只关那层，不连坐关本页
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
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

  const closing = phase === 'closing';
  return (
    <div
      aria-label={title}
      data-detail-page=""
      className={`fixed inset-0 z-[201] flex flex-col bg-[#F2F2F7]/[0.85] backdrop-blur-2xl ${
        closing
          ? 'animate-out slide-out-to-right duration-260 ease-in'
          : 'animate-in slide-in-from-right duration-300 ease-out'
      }`}
    >
      {/* 顶部导航栏：返回键 + 居中标题（pt-[54px] 避让状态栏，与根页同款；恒浅色） */}
      <div className="relative shrink-0 pt-[54px]">
        <div className="relative flex h-11 shrink-0 items-center justify-center px-14">
          <button
            type="button"
            aria-label="返回"
            onClick={requestClose}
            className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-zinc-900 transition active:bg-black/[0.06]"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <span className="max-w-full truncate text-[17px] font-semibold text-zinc-900">{title}</span>
        </div>
      </div>
      {/* 内容滚动区：保留字面 overflow-y-auto——useModelPanelReveal 靠它找滚动容器 */}
      <div className="no-scrollbar relative flex-1 overflow-y-auto">
        <div className="px-4 pb-[44px] pt-1">{children}</div>
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

/** 液体玻璃分组卡片（v2.4.37）：半透明白 + blur(30px) saturate(180%) + 1px 白半透明
 *  描边（玻璃边缘反光）+ 极浅弥散柔影 + 顶部高光反射。
 *  SETTINGS-THEME：恒浅色玻璃白（与 GroupCard 同配方），不随深色主题变黑 */
export function GrayCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[24px] bg-white/[0.66] p-4 shadow-[0_2px_8px_rgba(24,24,27,0.03),0_14px_44px_rgba(24,24,27,0.07),inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-white/40 backdrop-blur-2xl ${className}`}
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
