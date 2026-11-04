'use client';

/**
 * 聊天气泡长按弹窗菜单（微信 / QQ / 信息 三端共用）：
 * - 默认（原生微信/QQ 同款）：深色横向卡片（图标 + 文字竖排），选项多时卡片内部横向滚动（适配屏幕宽度）
 * - 液态玻璃主题（第四十四轮，用户指定）：横向 2 列网格菜单（图标左 + 文字右）——乳白强模糊玻璃浮层、
 *   大圆角、黑图标黑字、无分割线、按下态浅绿荧光；无指向箭头（参考图同款洁净浮层）
 * - 位置由 computeBubbleMenuPos / computeBubbleMenuPosLiquid 计算（容器内坐标）：默认气泡下方居中并钳制在容器内，
 *   下方空间不足时翻转到气泡上方（不遮挡气泡内容），小箭头指向气泡（液态无箭头）
 * - 全屏透明遮罩：点击菜单外区域关闭、不执行任何动作
 * - useBubbleLongPress：480ms 长按触发（移动超 12px 取消，防误触滚动），触发后拦截后续 click
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  CheckSquare,
  Copy,
  Download,
  FileText,
  Forward,
  GitBranch,
  Pencil,
  RefreshCw,
  Reply,
  Sticker,
  Star,
  Trash2,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

export interface BubbleMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** 危险动作（删除）红色显示 */
  danger?: boolean;
  /** 图标填色（收藏：已收藏后五角星填满） */
  filled?: boolean;
}

/** 三端统一的动作图标（菜单项从这里取，避免各 App 重复引图标） */
export const BUBBLE_MENU_ICONS = {
  copy: Copy,
  del: Trash2,
  edit: Pencil,
  quote: Reply,
  multi: CheckSquare,
  recall: Undo2,
  forward: Forward,
  fav: Star,
  regen: RefreshCw,
  save: Download,
  regenimg: Wand2,
  stt: FileText,
  /** 表情包消息长按「添加到表情」（Task 32；已添加显示已添加置灰态 filled） */
  addsticker: Sticker,
  /** 角色分支（Task 37）：以该消息为分支点克隆出独立平行联系人 */
  branch: GitBranch,
} as const;

export interface BubbleMenuPos {
  /** 菜单卡片顶部（容器内坐标） */
  top: number;
  /** 菜单卡片左缘（容器内坐标，已钳制） */
  left: number;
  /** 指向箭头的横坐标（相对菜单卡片左缘） */
  arrowX: number;
  /** 菜单在气泡上方（箭头朝下） */
  flip: boolean;
  /** 卡片最大宽度（容器宽减边距；选项多时卡片内部横向滚动） */
  maxW: number;
}

const ITEM_W = 54; // 每项宽度（图标+文字竖排）
const MENU_H = 62; // 单行菜单高度估算
const MENU_H2 = 116; // 两行菜单高度估算
const PAD_X = 10; // 卡片左右内边距

/** 菜单行拆分：超过 5 项 → 两行（上下两行均分，如 8 项 4+4、9 项 5+4、6 项 3+3），否则单行 */
export function splitMenuRows(items: BubbleMenuItem[]): BubbleMenuItem[][] {
  if (items.length <= 5) return [items];
  const first = Math.ceil(items.length / 2);
  return [items.slice(0, first), items.slice(first)];
}

/** 依据气泡矩形与聊天页容器矩形计算弹窗位置（容器内坐标；itemCount 用于估算宽高做钳制） */
export function computeBubbleMenuPos(bubble: DOMRect, container: DOMRect | null, itemCount: number): BubbleMenuPos {
  const cw = container?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 393);
  const ch = container?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 852);
  const maxW = Math.max(180, cw - 16);
  // 两行时每行项目数减半，卡片更窄更接近原生微信/QQ；仍超宽则横向滚动兜底
  const twoRows = itemCount > 5;
  const perRow = twoRows ? Math.ceil(itemCount / 2) : itemCount;
  const menuH = twoRows ? MENU_H2 : MENU_H;
  const width = Math.min(perRow * ITEM_W + PAD_X * 2, maxW);
  const relTop = container ? bubble.top - container.top : bubble.top;
  const centerX = bubble.left + bubble.width / 2 - (container?.left ?? 0);
  const below = relTop + bubble.height + menuH + 16 <= ch;
  const top = below ? relTop + bubble.height + 9 : relTop - menuH - 9;
  let left = centerX - width / 2;
  left = Math.max(8, Math.min(left, cw - width - 8));
  const arrowX = Math.max(10, Math.min(centerX - left - 6, width - 22));
  return { top, left, arrowX, flip: !below, maxW };
}

/** 液态玻璃横向 2 列网格菜单的尺寸常量（第四十五轮用户指定：菜单变小）：行高 44px、固定宽 260px */
const LIQ_MENU_W = 260;
const LIQ_ROW_H = 44;

/** 液态主题 2 列网格菜单定位：气泡下方居中（下方放不下翻到上方），左右钳制在容器内；无箭头 */
export function computeBubbleMenuPosLiquid(bubble: DOMRect, container: DOMRect | null, itemCount: number): BubbleMenuPos {
  const cw = container?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 393);
  const ch = container?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 852);
  const width = Math.min(LIQ_MENU_W, cw - 24);
  const rows = Math.ceil(Math.max(itemCount, 1) / 2);
  const menuH = rows * LIQ_ROW_H + 8;
  const relTop = container ? bubble.top - container.top : bubble.top;
  const centerX = bubble.left + bubble.width / 2 - (container?.left ?? 0);
  const below = relTop + bubble.height + menuH + 16 <= ch;
  const top = below ? relTop + bubble.height + 10 : Math.max(10, relTop - menuH - 10);
  let left = centerX - width / 2;
  left = Math.max(12, Math.min(left, cw - width - 12));
  return { top, left, arrowX: width / 2 - 6, flip: !below, maxW: width };
}

export function BubbleActionMenu({
  pos,
  items,
  onSelect,
  onClose,
  testPrefix = 'bubble-menu',
  liquid = false,
}: {
  pos: BubbleMenuPos;
  items: BubbleMenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
  testPrefix?: string;
  /** 液态玻璃主题（第四十四轮，用户指定）：横向 2 列网格菜单（图标左 + 文字右）乳白强模糊玻璃浮层 */
  liquid?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="消息操作菜单"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 透明遮罩：点击菜单外区域关闭，不执行任何操作 */}
      <button type="button" aria-label="关闭菜单" data-testid={`${testPrefix}-overlay`} onClick={onClose} className="absolute inset-0 cursor-default" />
      <motion.div
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="absolute"
        style={{ top: pos.top, left: pos.left, transformOrigin: `${pos.arrowX + 6}px ${pos.flip ? '100%' : '0'}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {liquid ? (
          /* 液态玻璃横向 2 列网格菜单（第四十五轮用户指定：变小——宽 260、行高 44、图标 18、字 14）：
             乳白强模糊 + 大圆角 + 图标左文字右 + 无分割线，按下浅绿荧光 */
          <div
            role="menu"
            data-testid={`${testPrefix}-card`}
            className="lg-sheet grid grid-cols-2 overflow-hidden rounded-[20px] py-[4px]"
            style={{ width: pos.maxW < LIQ_MENU_W ? pos.maxW : LIQ_MENU_W }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-testid={`${testPrefix}-${item.key}`}
                onClick={() => onSelect(item.key)}
                className={`lg-menu-row flex h-[44px] w-full items-center gap-2.5 px-4 text-left ${
                  item.danger ? 'text-[#E5484D]' : 'text-[#1C1C1E] dark:text-white/90'
                }`}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} fill={item.filled ? 'currentColor' : 'none'} aria-hidden="true" />
                <span className="truncate text-[14px] font-semibold leading-none">{item.label}</span>
              </button>
            ))}
          </div>
        ) : (
        <div className="relative">
          {/* 指向气泡的小箭头（与菜单同色；菜单在下方时朝上，在上方时朝下） */}
          <span
            aria-hidden="true"
            className={`absolute z-0 h-[11px] w-[11px] rotate-45 rounded-[2px] ${pos.flip ? '-bottom-[4.5px]' : '-top-[4.5px]'}`}
            style={{ left: pos.arrowX, backgroundColor: 'rgba(44,44,46,0.97)' }}
          />
          {/* 选项多时拆两行（原生微信/QQ 同款）；仍超宽横向滚动兜底（隐藏滚动条） */}
          <div
            role="menu"
            data-testid={`${testPrefix}-card`}
            className="relative flex max-w-full flex-col items-stretch overflow-x-auto overflow-y-hidden rounded-[10px] shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ backgroundColor: 'rgba(44,44,46,0.97)', backdropFilter: 'blur(20px)', maxWidth: pos.maxW }}
          >
            {splitMenuRows(items).map((row, r) => (
              <div key={r} role="group" className={`flex items-stretch ${r > 0 ? 'border-t border-white/10' : ''}`}>
                {row.map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    data-testid={`${testPrefix}-${item.key}`}
                    onClick={() => onSelect(item.key)}
                    className={`flex w-[54px] shrink-0 flex-col items-center justify-center gap-[5px] pb-2 pt-[9px] text-white transition-colors active:bg-white/15 ${
                      i > 0 ? 'border-l border-white/10' : ''
                    } ${item.danger ? 'text-[#FF8B78]' : ''}`}
                  >
                    <item.icon className="h-[19px] w-[19px]" strokeWidth={1.7} fill={item.filled ? 'currentColor' : 'none'} aria-hidden="true" />
                    <span className="whitespace-nowrap text-[10.5px] leading-none">{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * 气泡长按手势（480ms 触发；移动超 12px 视为滚动取消；触发后拦截后续 click 防误触）。
 * 同一组 handler 可复用到多条消息的气泡上（fire 里用 e.currentTarget / data-mid 反查消息）。
 */
export function useBubbleLongPress(fire: (el: HTMLElement) => void, enabled = true) {
  const timer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = e.currentTarget; // 同步捕获（timeout 回调里 synthetic 事件字段已失效）
      start.current = { x: e.clientX, y: e.clientY };
      fired.current = false;
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          // 不支持震动忽略
        }
        fire(el);
      }, 480);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (timer.current === null) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (dx * dx + dy * dy > 144) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
