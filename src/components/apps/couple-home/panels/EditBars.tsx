'use client';

/**
 * 编辑模式操作条全家桶（从 CoupleHome.tsx 原样搬移，行为零变化）
 * - EditZoomButtons：右缘缩放按钮
 * - WallSelBar：门窗选中操作条（沿墙微调/换色/收起窗户）
 * - BedColorPop：猫窝换色 12 精选色小色板（v11 H3）
 * - FurnSelBar：家具选中操作条（移动/升降/旋转/调色/换窝色/收起）
 * - EditToolDock：底部编辑工具（撤销/重做/地板墙色/商店）
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Droplet,
  Heart,
  Move,
  Paintbrush,
  Redo2,
  RotateCcw,
  RotateCw,
  Store,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { EDIT_GLASS, editDirBtn, editDirBtnAmber, editDirBtnBlue, PET_BED_COLORS, toolBtn } from '../lib/home-core';
import type { FurnitureItem, HomeMode } from '../types';

// ---------------- 编辑模式：缩放按钮（右缘中部） ----------------

export function EditZoomButtons({ mode, onZoom }: { mode: HomeMode; onZoom: (dir: 1 | -1) => void }) {
  if (mode !== 'edit') return null;
  return (
    <div className="pointer-events-auto absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
      <button
        onClick={() => onZoom(1)}
        aria-label="放大画面"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/70 dark:text-zinc-100 shadow-md backdrop-blur transition active:scale-95"
      >
        <ZoomIn className="h-5 w-5" />
      </button>
      <button
        onClick={() => onZoom(-1)}
        aria-label="缩小画面"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 dark:bg-zinc-900/70 dark:text-zinc-100 shadow-md backdrop-blur transition active:scale-95"
      >
        <ZoomOut className="h-5 w-5" />
      </button>
    </div>
  );
}

// ---------------- 选中操作条（编辑模式·门窗：毛玻璃胶囊 · 移动/换色/收起窗户，门不可收起） ----------------

export function WallSelBar({
  mode,
  isWallSel,
  shopOpen,
  paletteOpen,
  selId,
  selWallName,
  onMove,
  onOpenPalette,
  onRemoveWin,
  onCancel,
}: {
  mode: HomeMode;
  isWallSel: boolean;
  shopOpen: boolean;
  paletteOpen: boolean;
  selId: string | null;
  selWallName: string;
  onMove: (dir: 'up' | 'down' | 'left' | 'right') => void;
  onOpenPalette: () => void;
  onRemoveWin: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'edit' && isWallSel && !shopOpen && !paletteOpen && (
        <motion.div
          key={selId}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="pointer-events-auto mx-auto mb-3 w-fit"
        >
          {/* 名字小签（毛玻璃胶囊） */}
          <div className="mx-auto mb-2 w-fit rounded-full border border-white/40 bg-black/25 px-3.5 py-1 text-[11px] font-medium text-white/95 shadow-sm backdrop-blur-md">
            {selWallName} · 拖动或方向键沿墙移动
          </div>
          <div className={`flex items-center gap-1.5 rounded-full p-2 ${EDIT_GLASS}`}>
            {/* 四向微调（沿墙滑行）：毛玻璃圆形方向盘 */}
            <div className="grid shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-full bg-white/40 dark:bg-zinc-900/50 p-1.5 ring-1 ring-white/70 dark:ring-white/15">
              <span />
              <button onClick={() => onMove('up')} aria-label="上移" className={editDirBtn}>
                <ChevronUp className="h-4 w-4" />
              </button>
              <span />
              <button onClick={() => onMove('left')} aria-label="左移" className={editDirBtn}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="flex h-9 w-9 items-center justify-center text-[9px] font-medium text-[#b8b5ac] dark:text-zinc-400">沿墙</span>
              <button onClick={() => onMove('right')} aria-label="右移" className={editDirBtn}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <span />
              <button onClick={() => onMove('down')} aria-label="下移" className={editDirBtn}>
                <ChevronDown className="h-4 w-4" />
              </button>
              <span />
            </div>
            {/* 分隔点 */}
            <span className="mx-0.5 h-1.5 w-1.5 rounded-full bg-[#d8cfc4]/80 dark:bg-zinc-600" />
            {/* 换色 */}
            <button
              onClick={onOpenPalette}
              aria-label="给门窗换色"
              title="换颜色"
              className={`${toolBtn} h-11 w-11 bg-[#f7e8f2]/85 dark:bg-[#b07193]/25 text-[#b07193] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 hover:bg-[#f3dcea]/90 dark:hover:bg-[#b07193]/40`}
            >
              <Droplet className="h-[18px] w-[18px]" />
            </button>
            {/* 收起窗户（窗户可像家具一样删除；门不可） */}
            {selId?.startsWith('win-') && (
              <button
                onClick={onRemoveWin}
                aria-label="收起窗户"
                title="收起这扇窗（商店「窗户」可装回）"
                className={`${toolBtn} h-11 w-11 bg-[#f9e3e8]/90 dark:bg-[#d4717f]/25 text-[#d4717f] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 hover:bg-[#f5d5dc]/95 dark:hover:bg-[#d4717f]/40`}
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </button>
            )}
            {/* 取消选中 */}
            <button
              onClick={onCancel}
              aria-label="取消选中"
              className={`${toolBtn} h-11 w-11 bg-[#efeef0]/85 dark:bg-zinc-700/60 text-[#8a8a90] dark:text-zinc-300 ring-1 ring-white/80 dark:ring-white/15`}
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- v11 H3 猫窝换色小色板（12 精选色横排 · 选中猫窝时弹出） ----------------

export function BedColorPop({
  mode,
  open,
  isBed,
  shopOpen,
  paletteOpen,
  currentColor,
  onPick,
}: {
  mode: HomeMode;
  open: boolean;
  isBed: boolean;
  shopOpen: boolean;
  paletteOpen: boolean;
  currentColor?: string;
  onPick: (hex: string) => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'edit' && open && isBed && !shopOpen && !paletteOpen && (
        <motion.div
          key="bed-color-pop"
          initial={{ opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: 'spring', damping: 26, stiffness: 360 }}
          className="pointer-events-auto mx-auto mb-2 w-fit"
        >
          <div className="flex max-w-[95vw] items-center gap-2 overflow-x-auto rounded-full border border-white/60 bg-white/85 p-2.5 shadow-[0_12px_30px_rgba(90,70,60,0.24)] backdrop-blur-xl">
            {PET_BED_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => onPick(c.hex)}
                aria-label={`窝换成${c.name}`}
                title={c.name}
                className={`h-6 w-6 shrink-0 rounded-full transition active:scale-90 ${
                  currentColor === c.hex ? 'ring-2 ring-[#e8b06a] ring-offset-1 dark:ring-offset-zinc-900' : 'ring-1 ring-black/10 dark:ring-white/15'
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- 选中操作条（编辑模式·家具：毛玻璃胶囊 · 移动/升降/旋转/调色/收起；猫窝额外有「换窝色」小色板） ----------------

export function FurnSelBar({
  mode,
  selItem,
  selName,
  shopOpen,
  paletteOpen,
  moveOn,
  onMove,
  onToggleMove,
  onLift,
  onRotate,
  onTilt,
  onOpenPalette,
  onToggleBedColor,
  onRemove,
  onCancel,
}: {
  mode: HomeMode;
  selItem: FurnitureItem | null;
  selName: string;
  shopOpen: boolean;
  paletteOpen: boolean;
  moveOn: boolean;
  onMove: (dir: 'up' | 'down' | 'left' | 'right') => void;
  onToggleMove: () => void;
  onLift: (dir: 1 | -1) => void;
  onRotate: (dir: 1 | -1) => void;
  onTilt: (dir: 1 | -1) => void;
  onOpenPalette: () => void;
  onToggleBedColor: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'edit' && selItem && selName && !shopOpen && !paletteOpen && (
        <motion.div
          key={selItem.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="pointer-events-auto mx-auto mb-3 w-fit"
        >
          {/* 家具名小签（毛玻璃胶囊） */}
          <div className="mx-auto mb-2 w-fit rounded-full border border-white/40 bg-black/25 px-3.5 py-1 text-[11px] font-medium text-white/95 shadow-sm backdrop-blur-md">
            {selName}
          </div>
          {/* 双排布局（单排超出屏宽会被挤压重叠）：上排 = 移动/升降/旋转，下排 = 调色/收起/取消 */}
          <div className="flex flex-col items-center gap-1.5">
            <div className={`flex items-center gap-2 rounded-full p-2 ${EDIT_GLASS}`}>
              {/* 移动：四向方向盘 + 中央「移动模式」开关
                 （两种搬运方式：① 点上下左右逐步微调 ② 开移动模式后按住画面拖动） */}
              <div className="grid shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-full bg-white/40 dark:bg-zinc-900/50 p-1.5 ring-1 ring-white/70 dark:ring-white/15">
                <span />
                <button
                  onClick={() => onMove('up')}
                  aria-label="上移一格"
                  title="上移一格"
                  className={editDirBtn}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <span />
                <button
                  onClick={() => onMove('left')}
                  aria-label="左移一格"
                  title="左移一格"
                  className={editDirBtn}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={onToggleMove}
                  aria-label="移动模式（按住画面拖动搬运）"
                  title="移动模式（按住画面拖动搬运）"
                  className={
                    moveOn
                      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-[#cdeacd] text-[#2f7d4d] shadow-inner ring-1 ring-[#9ed4ae]'
                      : 'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-800/70 text-[#77766e] dark:text-zinc-300 shadow-sm ring-1 ring-white/60 dark:ring-white/15 transition active:scale-90'
                  }
                >
                  <Move className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onMove('right')}
                  aria-label="右移一格"
                  title="右移一格"
                  className={editDirBtn}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span />
                <button
                  onClick={() => onMove('down')}
                  aria-label="下移一格"
                  title="下移一格"
                  className={editDirBtn}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <span />
              </div>

              {/* 升降：抬上桌 / 放回地（相框、小盆栽…） */}
              <div className="grid shrink-0 grid-rows-2 gap-0.5 rounded-full bg-white/40 dark:bg-zinc-900/50 p-1.5 ring-1 ring-white/70 dark:ring-white/15">
                <button
                  onClick={() => onLift(1)}
                  aria-label="抬高一层（可放上桌面）"
                  title="抬高一层"
                  className={editDirBtnBlue}
                >
                  <ChevronsUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onLift(-1)}
                  aria-label="放低一层（放回地面）"
                  title="放低一层"
                  className={editDirBtnBlue}
                >
                  <ChevronsDown className="h-4 w-4" />
                </button>
              </div>

              {/* 旋转：四宫格（上排 左转/右转，下排 下俯/上仰） */}
              <div className="grid shrink-0 grid-cols-2 grid-rows-2 gap-0.5 rounded-full bg-white/40 dark:bg-zinc-900/50 p-1.5 ring-1 ring-white/70 dark:ring-white/15">
                <button
                  onClick={() => onRotate(-1)}
                  aria-label="向左旋转 45°"
                  title="向左旋转"
                  className={editDirBtnAmber}
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onRotate(1)}
                  aria-label="向右旋转 45°"
                  title="向右旋转"
                  className={editDirBtnAmber}
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onTilt(-1)}
                  aria-label="向下旋转 15°"
                  title="向下旋转"
                  className={editDirBtnAmber}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onTilt(1)}
                  aria-label="向上旋转 15°"
                  title="向上旋转"
                  className={editDirBtnAmber}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 下排：调色 / 换窝色（仅猫窝）/ 收起 / 取消 */}
            <div className={`flex items-center gap-1.5 rounded-full p-1.5 ${EDIT_GLASS}`}>
              {/* 调色 */}
              <button
                onClick={onOpenPalette}
                aria-label="调色盘"
                title="调色盘"
                className={`${toolBtn} h-10 w-10 bg-[#f7e8f2]/85 dark:bg-[#b07193]/25 text-[#b07193] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 hover:bg-[#f3dcea]/90 dark:hover:bg-[#b07193]/40`}
              >
                <Droplet className="h-[17px] w-[17px]" />
              </button>
              {/* v11 H3 换窝色（仅猫窝显示）：弹出 12 精选色小色板 */}
              {selItem.kind === 'petBed' && (
                <button
                  onClick={onToggleBedColor}
                  aria-label="换窝的颜色"
                  title="换窝的颜色"
                  className={`${toolBtn} h-10 w-10 bg-[#fdeef3]/90 dark:bg-[#c98ba9]/25 text-[#c98ba9] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 hover:bg-[#f9e2ea]/95 dark:hover:bg-[#c98ba9]/40`}
                >
                  <Heart className="h-[17px] w-[17px]" />
                </button>
              )}
              {/* 收起 */}
              <button
                onClick={onRemove}
                aria-label="收起家具"
                title="收起"
                className={`${toolBtn} h-10 w-10 bg-[#f9e3e8]/90 dark:bg-[#d4717f]/25 text-[#d4717f] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 hover:bg-[#f5d5dc]/95 dark:hover:bg-[#d4717f]/40`}
              >
                <Trash2 className="h-[17px] w-[17px]" />
              </button>
              {/* 取消选中 */}
              <button
                onClick={onCancel}
                aria-label="取消选中"
                className={`${toolBtn} h-10 w-10 bg-[#efeef0]/85 dark:bg-zinc-700/60 text-[#8a8a90] dark:text-zinc-300 ring-1 ring-white/80 dark:ring-white/15`}
              >
                <X className="h-[17px] w-[17px]" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- 编辑工具（装修模式）：撤销 / 重做 / 地板墙色 / 商店（音效/视角已收进右上角 ⋮ 菜单） ----------------

export function EditToolDock({
  mode,
  histLen,
  roomStyleOpen,
  shopOpen,
  onUndo,
  onRedo,
  onToggleRoomStyle,
  onToggleShop,
}: {
  mode: HomeMode;
  histLen: { u: number; r: number };
  roomStyleOpen: boolean;
  shopOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleRoomStyle: () => void;
  onToggleShop: () => void;
}) {
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      {mode === 'edit' && (
        <div className={`flex items-center gap-2 rounded-full p-1.5 ${EDIT_GLASS}`}>
          {/* 撤销上一步装修操作（Ctrl+Z）：放置/收起/移动/旋转/升降/换色/门窗均可撤销 */}
          <button
            onClick={onUndo}
            disabled={histLen.u === 0}
            aria-label="撤销"
            title="撤销上一步（Ctrl+Z）"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-800/70 text-[#6a7a8a] dark:text-zinc-300 shadow-sm ring-1 ring-white/70 dark:ring-white/15 transition active:scale-95 disabled:opacity-40"
          >
            <Undo2 className="h-[18px] w-[18px]" />
          </button>
          {/* 重做（取消上一次撤销）：Ctrl+Shift+Z / Ctrl+Y */}
          <button
            onClick={onRedo}
            disabled={histLen.r === 0}
            aria-label="重做"
            title="重做（Ctrl+Shift+Z / Ctrl+Y）"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-800/70 text-[#6a7a8a] dark:text-zinc-300 shadow-sm ring-1 ring-white/70 dark:ring-white/15 transition active:scale-95 disabled:opacity-40"
          >
            <Redo2 className="h-[18px] w-[18px]" />
          </button>
          <span className="h-1.5 w-1.5 rounded-full bg-[#d8cfc4]/80 dark:bg-zinc-600" />
          <button
            onClick={onToggleRoomStyle}
            className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition active:scale-95 ${
              roomStyleOpen
                ? 'bg-[#e8f2f7] dark:bg-[#4a7a95]/30 text-[#4a7a95] dark:text-sky-200 shadow-inner ring-1 ring-[#bcdcea] dark:ring-[#4a7a95]/50'
                : 'bg-white/70 dark:bg-zinc-800/70 text-[#4a4a4e] dark:text-zinc-100 shadow-sm ring-1 ring-white/70 dark:ring-white/15'
            }`}
          >
            <Paintbrush className="h-4 w-4 text-[#7fa8c9]" />
            地板墙色
          </button>
          <button
            onClick={onToggleShop}
            className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition active:scale-95 ${
              shopOpen
                ? 'bg-[#fdeef3] dark:bg-[#c96a8c]/30 text-[#c96a8c] dark:text-rose-300 shadow-inner ring-1 ring-[#f3c2d3] dark:ring-[#c96a8c]/50'
                : 'bg-white/70 dark:bg-zinc-800/70 text-[#4a4a4e] dark:text-zinc-100 shadow-sm ring-1 ring-white/70 dark:ring-white/15'
            }`}
          >
            <Store className="h-4 w-4 text-[#c99a5b]" />
            商店
          </button>
        </div>
      )}
    </div>
  );
}
