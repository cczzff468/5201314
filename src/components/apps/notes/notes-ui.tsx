'use client';

/**
 * 备忘录 App（金色重构版）共享 UI 原语：
 * 金色导航按钮 / 底部抽屉壳 / 搜索框 / 底部工具栏（文件夹+金色新建方块）/ 勾选圆 /
 * 备忘录卡片（普通/勾选/回收站三种形态）/ 分组标头 / 空态。
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCheck,
  Check,
  ChevronRight,
  FolderInput,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Pin,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { NoteRecord } from '@/lib/ios/db';
import {
  CARD_CLS,
  MUTED_META_CLS,
  MUTED_TEXT_CLS,
  SEARCH_BG,
  WARM_RED,
  displayPreview,
  displayTitle,
  deletedTimeText,
  folderNameOf,
  noteDate,
  type FolderInfo,
} from './notes-shared';
import { useLongPress } from '@/hooks/use-long-press';

/** 抽屉/遮罩动画缓动（与 ActionSheet 同款） */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// ---------------- 导航按钮 / 标题 ----------------

/** 右上金圈⋯按钮（设计稿：细金圆环包三点，iOS 备忘录同款） */
export function GoldMoreButton({ onClick, label = '更多操作' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] transition-opacity active:opacity-50"
      style={{ borderColor: 'var(--notes-gold)', color: 'var(--notes-gold)' }}
    >
      <MoreHorizontal className="h-[17px] w-[17px]" strokeWidth={2.6} />
    </button>
  );
}

/** 顶部导航金色文字按钮（设计稿：三段式导航，文字按钮取金色） */
export function GoldNavButton({
  label,
  icon,
  onClick,
  disabled,
  destructive,
  ariaLabel,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={`-ml-1 flex items-center gap-0.5 text-[17px] leading-none transition-opacity ${
        disabled ? 'opacity-35' : 'active:opacity-50'
      }`}
      style={{ color: destructive ? WARM_RED : 'var(--notes-gold)' }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------------- 底部抽屉壳 ----------------

/**
 * 金色主题底部抽屉壳（备忘录操作/移动/新建文件夹/回收站操作共用）：
 * 半透明遮罩（点击关闭）+ 底部滑入白色圆角面板；退出 200ms 动画后卸载。
 * 注意：遮罩与面板都要显式可点（v10.3 抽屉穿透教训）。
 */
export function SheetShell({
  open,
  onClose,
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let raf = 0;
    let inner = 0;
    let timer = 0;
    if (open) {
      raf = requestAnimationFrame(() => {
        setMounted(true);
        inner = requestAnimationFrame(() => setShown(true));
      });
    } else {
      raf = requestAnimationFrame(() => {
        setShown(false);
        timer = window.setTimeout(() => setMounted(false), 210);
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label={ariaLabel} aria-modal="true">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/35 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`pointer-events-auto absolute inset-x-0 bottom-0 z-10 transition-transform duration-[260ms] ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transitionTimingFunction: EASE }}
      >
        {children}
      </div>
    </div>
  );
}

/** 抽屉内白卡容器（圆角 14 顶部、安全区留底） */
export function SheetCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2 pb-[calc(14px+env(safe-area-inset-bottom))]">{children}</div>
  );
}

/** 抽屉三段式导航行（左文字 / 中标题 / 右文字） */
export function SheetNav({
  left,
  title,
  right,
  gold,
}: {
  left?: ReactNode;
  title: string;
  right?: ReactNode;
  gold?: string;
}) {
  return (
    <div className="flex h-12 items-center justify-between px-4">
      <div className="flex min-w-[64px] items-center text-[16px]" style={gold ? { color: gold } : undefined}>
        {left}
      </div>
      <div className="text-[16px] font-semibold text-foreground">{title}</div>
      <div
        className="flex min-w-[64px] items-center justify-end text-[16px] font-medium"
        style={gold ? { color: gold } : undefined}
      >
        {right}
      </div>
    </div>
  );
}

// ---------------- 搜索框 ----------------

/** 圆角灰底搜索框：tappable = 点击整框跳搜索页；否则为受控输入 */
export function SearchBox({
  value,
  onChange,
  onClear,
  tappable,
  onTap,
  autoFocus,
  placeholder = '搜索',
}: {
  value?: string;
  onChange?: (v: string) => void;
  onClear?: () => void;
  tappable?: boolean;
  onTap?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const inner = (
    <>
      <Search className="h-4 w-4 shrink-0 text-[#b8b2aa]" strokeWidth={2.2} />
      {tappable ? (
        <span className="w-full select-none text-[15px] text-[#b8b2aa]">{placeholder}</span>
      ) : (
        <>
          <input
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            aria-label="搜索"
            autoFocus={autoFocus}
            className="h-full w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-[#b8b2aa]"
          />
          {(value ?? '').length > 0 && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={onClear}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c9c4bd] text-white active:opacity-60"
            >
              <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 1l8 8M9 1l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </>
      )}
    </>
  );
  const cls =
    'flex h-9 items-center gap-2 rounded-[10px] px-3';
  const bgStyle = { backgroundColor: SEARCH_BG };
  if (tappable) {
    return (
      <button type="button" aria-label="打开搜索" onClick={onTap} className={`${cls} w-full text-left dark:bg-white/[0.09]`} style={bgStyle}>
        {inner}
      </button>
    );
  }
  return <div className={cls} style={bgStyle}>{inner}</div>;
}

// ---------------- 勾选圆（金色） ----------------

/** 金色勾选圆：未勾 = 金色描边空心，已勾 = 金底白勾（清单/批量选择共用） */
export function CheckCircle({
  checked,
  size = 22,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  size?: number;
  onToggle?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? (checked ? '已选择' : '未选择')}
      onClick={
        onToggle
          ? (e) => {
              e.stopPropagation();
              onToggle();
            }
          : undefined
      }
      className="flex shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
      style={
        checked
          ? { width: size, height: size, backgroundColor: 'var(--notes-gold)', border: 'none' }
          : { width: size, height: size, border: '1.5px solid rgba(204,174,84,0.6)', backgroundColor: 'transparent' }
      }
    >
      {checked && <Check className="text-white" style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={3} />}
    </button>
  );
}

// ---------------- 底部工具栏 ----------------

/** 页面底部玻璃工具栏：左 = 新建文件夹、右 = 金色描边新建笔记（设计稿：两枚金色线性图标） */
export function BottomToolbar({
  onNewFolder,
  onCompose,
}: {
  onNewFolder: () => void;
  onCompose: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-30">
      <div className="pointer-events-auto flex h-[58px] items-center justify-between rounded-[18px] bg-white/75 px-3 shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.08] dark:ring-white/[0.09]">
        <button
          type="button"
          onClick={onNewFolder}
          aria-label="新建文件夹"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ color: 'var(--notes-gold)' }}
        >
          <FolderPlus className="h-[22px] w-[22px]" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={onCompose}
          aria-label="新建备忘录"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ color: 'var(--notes-gold)' }}
        >
          <SquarePen className="h-[22px] w-[22px]" strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

/** 批量选择底部操作栏：全选 / 移动 / 删除（或回收站：全选 / 恢复 / 永久删除） */
export function SelectToolbar({
  gold,
  allSelected,
  hasSelection,
  variant = 'list',
  onToggleAll,
  onMoveOrRestore,
  onDelete,
}: {
  gold: string;
  allSelected: boolean;
  hasSelection: boolean;
  /** 'list' = 移动+删除；'trash' = 恢复+永久删除 */
  variant?: 'list' | 'trash';
  onToggleAll: () => void;
  onMoveOrRestore: () => void;
  onDelete: () => void;
}) {
  const items =
    variant === 'list'
      ? [
          {
            key: 'all',
            label: allSelected ? '取消全选' : '全选',
            icon: <CheckCheck className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: gold,
            disabled: false,
            onClick: onToggleAll,
          },
          {
            key: 'move',
            label: '移动',
            icon: <FolderInput className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: gold,
            disabled: !hasSelection,
            onClick: onMoveOrRestore,
          },
          {
            key: 'delete',
            label: '删除',
            icon: <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: WARM_RED,
            disabled: !hasSelection,
            onClick: onDelete,
          },
        ]
      : [
          {
            key: 'all',
            label: allSelected ? '取消全选' : '全选',
            icon: <CheckCheck className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: gold,
            disabled: false,
            onClick: onToggleAll,
          },
          {
            key: 'restore',
            label: '恢复',
            icon: <FolderInput className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: gold,
            disabled: !hasSelection,
            onClick: onMoveOrRestore,
          },
          {
            key: 'purge',
            label: '永久删除',
            icon: <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />,
            color: WARM_RED,
            disabled: !hasSelection,
            onClick: onDelete,
          },
        ];
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-30">
      <div className="pointer-events-auto flex h-[58px] items-center justify-around rounded-[18px] bg-white/75 px-3 shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.08] dark:ring-white/[0.09]">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={it.onClick}
            disabled={it.disabled}
            aria-label={it.label}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-transform active:scale-95 ${
              it.disabled ? 'opacity-35' : ''
            }`}
            style={{ color: it.color }}
          >
            {it.icon}
            <span className="text-[11px] leading-none">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 分组标头 / 空态 ----------------

/** 列表分组标头（置顶分组带金色图钉，对照设计稿 📌） */
export function GroupHeader({ label, pinned }: { label: string; pinned?: boolean }) {
  return (
    <div className={`mb-1.5 flex items-center gap-1 px-1 text-[13px] font-medium ${MUTED_META_CLS}`}>
      {pinned && <Pin className="h-3.5 w-3.5" strokeWidth={2.2} style={{ color: 'var(--notes-gold)' }} />}
      <span>{label}</span>
    </div>
  );
}

/** 空态提示 */
export function EmptyHint({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 pt-24 text-center">
      <div className="opacity-35" style={{ color: 'var(--notes-gold)' }}>
        {icon}
      </div>
      <div className="text-[16px] font-medium text-foreground/70">{title}</div>
      {hint && <div className={`text-[13px] ${MUTED_META_CLS}`}>{hint}</div>}
    </div>
  );
}

// ---------------- 备忘录卡片 ----------------

/**
 * 列表卡片：白底圆角，标题粗体 + 锁🔒/图钉，摘要灰字 1 行，「时间 · 文件夹名」。
 * 形态：normal（独立白卡，搜索结果/收藏夹用）、row（分组合并容器内的裸行，由外层白卡提供
 * 底色圆角、行间用内缩分隔线，设计稿 iOS 内嵌分组样式）、check（批量选择圆）、
 * trash（回收站灰卡：文件夹 · 删除时间）。
 */
export function NoteCard({
  note,
  folders,
  variant = 'normal',
  query = '',
  checked = false,
  onOpen,
  onLongPress,
  onToggleCheck,
}: {
  note: NoteRecord;
  folders: FolderInfo[];
  variant?: 'normal' | 'row' | 'check' | 'trash';
  /** 搜索关键词（命中处高亮，空 = 不高亮） */
  query?: string;
  checked?: boolean;
  onOpen?: () => void;
  onLongPress?: () => void;
  onToggleCheck?: () => void;
}) {
  const lp = useLongPress(() => onLongPress?.());
  const title = displayTitle(note);
  const locked = note.locked === true;
  const preview = locked ? '' : displayPreview(note);
  const folderLabel = folderNameOf(note.folder ?? 'default', folders);
  const meta =
    variant === 'trash'
      ? `${folderLabel} · ${deletedTimeText(note.deletedAt ?? note.updatedAt)}`
      : `${noteDate(note.updatedAt)} · ${folderLabel}`;

  if (variant === 'check') {
    return (
      <button
        type="button"
        onClick={onToggleCheck}
        aria-label={`${checked ? '取消选择' : '选择'}：${title}`}
        className={`${CARD_CLS} flex w-full select-none items-center gap-3 p-3.5 text-left transition-opacity active:opacity-70`}
      >
        <CheckCircle checked={checked} ariaLabel={checked ? '已选择' : '未选择'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold leading-snug text-foreground">
              {title}
            </span>
            {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-[#b8b2aa]" strokeWidth={2.2} aria-label="已锁定" />}
          </div>
          <div className={`mt-0.5 truncate text-[12px] ${MUTED_META_CLS}`}>{meta}</div>
        </div>
      </button>
    );
  }

  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[15.5px] font-semibold leading-snug text-foreground">
          {title}
        </span>
        {note.pinned === true && variant !== 'trash' && (
          <Pin
            className="h-3.5 w-3.5 shrink-0"
            strokeWidth={2.2}
            style={{ color: 'var(--notes-gold)', fill: 'currentColor' }}
            aria-label="已置顶"
          />
        )}
        {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-[#b8b2aa]" strokeWidth={2.2} aria-label="已锁定" />}
      </div>
      {preview ? (
        <div className={`mt-0.5 truncate text-[13px] leading-snug ${MUTED_TEXT_CLS}`}>
          {preview}
        </div>
      ) : locked ? (
        <div className={`mt-0.5 text-[13px] ${MUTED_META_CLS}`}>已锁定</div>
      ) : null}
      <div className={`mt-1 truncate text-[12px] ${MUTED_META_CLS}`}>{meta}</div>
    </div>
  );

  if (variant === 'trash') {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full select-none rounded-[12px] bg-[#ECEBEF] p-3.5 text-left shadow-[0_1px_3px_rgba(80,65,40,0.05)] ring-1 ring-black/[0.03] transition-opacity active:opacity-70 dark:bg-white/[0.04] dark:ring-white/[0.06]"
      >
        {body}
      </button>
    );
  }

  if (variant === 'row') {
    return (
      <button
        type="button"
        {...lp}
        onClick={onOpen}
        className="flex w-full select-none px-4 py-[11px] text-left transition-colors active:bg-black/[0.035] dark:active:bg-white/[0.05]"
      >
        {body}
      </button>
    );
  }

  return (
    <button
      type="button"
      {...lp}
      onClick={onOpen}
      className={`${CARD_CLS} flex w-full select-none px-4 py-[11px] text-left transition-opacity active:opacity-70`}
    >
      {body}
    </button>
  );
}
