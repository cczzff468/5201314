'use client';

/**
 * 家具商店抽屉（编辑模式）+ 商城缩略图接线（从 CoupleHome.tsx 原样搬移，行为零变化）
 * 含商店色卡 CAT_COLORS / catColor / shade（原主文件尾部的模块级私有件，仅此处使用）。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Armchair, Check, X } from 'lucide-react';
import { FURN_SETS, SHOP_TABS, WIN_NAMES, WINS } from '../catalog';
import { SET_FALLBACK } from '../lib/home-core';
import { getCachedThumb } from '../scene/ShopThumbs';
import type { CatalogEntry, FurnitureItem, FurnitureKind, HomeMode } from '../types';

// ---------------- 商店色卡 ----------------

const CAT_COLORS: Record<string, [string, string]> = {
  sofa: ['#f6cdd6', '#f0b3c2'],
  table: ['#efdbb2', '#e5c894'],
  bed: ['#f9e4ea', '#f2ccd8'],
  lamp: ['#ffefc0', '#ffe49a'],
  plant: ['#c3e5cf', '#a8d8bb'],
  appliance: ['#e8e9e6', '#dcdcd8'],
  bathroom: ['#e3e9e6', '#d5e0da'],
  kitchen: ['#fdeccd', '#f8dfae'],
  decor: ['#e6cfae', '#dbaf87'],
};

function catColor(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[0];
}
function shade(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[1];
}

export interface ShopDrawerProps {
  mode: HomeMode;
  open: boolean;
  shopTab: string;
  thumbMap: Record<string, string>;
  items: FurnitureItem[];
  winCol?: string;
  winExist: boolean[];
  shopItems: CatalogEntry[];
  thumbQueue: string[];
  onClose: () => void;
  onTab: (t: string) => void;
  onReset: () => void;
  onInstallWin: (i: number) => void;
  onPlaceSet: (id: string) => void;
  onBuy: (kind: FurnitureKind) => void;
  onThumb: (kind: string, url: string) => void;
}

export default function ShopDrawer({
  mode,
  open,
  shopTab,
  thumbMap,
  items,
  winCol,
  winExist,
  shopItems,
  thumbQueue,
  onClose,
  onTab,
  onReset,
  onInstallWin,
  onPlaceSet,
  onBuy,
  onThumb,
}: ShopDrawerProps) {
  return (
    <>
      <AnimatePresence>
        {mode === 'edit' && open && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-10 flex max-h-[52%] flex-col rounded-t-3xl bg-white/95 dark:bg-zinc-900/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[15px] font-semibold text-[#3a3a3e] dark:text-zinc-100">家具商店</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onReset}
                  className="rounded-full bg-[#f6eded] dark:bg-[#c26a6a]/20 px-3 py-1 text-[11px] font-medium text-[#c26a6a] transition active:scale-95"
                >
                  重置
                </button>
                <button
                  onClick={onClose}
                  aria-label="关闭商店"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] dark:bg-zinc-800 text-[#8a8a90] dark:text-zinc-400 transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 分类 tab（纯文字；首个 = 窗户专项 tab，收起的窗在这里装回） */}
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
              <button
                onClick={() => onTab('win')}
                className={
                  shopTab === 'win'
                    ? 'shrink-0 rounded-full bg-[#8fbfa8] px-3 py-1 text-[12px] font-medium text-white'
                    : 'shrink-0 rounded-full bg-[#f1efe9] dark:bg-zinc-800 px-3 py-1 text-[12px] text-[#8a8a86] dark:text-zinc-400 transition active:scale-95'
                }
              >
                窗户
              </button>
              {SHOP_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onTab(t.key)}
                  className={
                    shopTab === t.key
                      ? 'shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1 text-[12px] font-medium text-white'
                      : 'shrink-0 rounded-full bg-[#f1efe9] dark:bg-zinc-800 px-3 py-1 text-[12px] text-[#8a8a86] dark:text-zinc-400 transition active:scale-95'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 窗户 tab：九扇窗安装位（收起的窗可装回；编辑模式点窗也能收起） */}
            {shopTab === 'win' && (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {WINS.map((w, i) => {
                  const here = winExist[i] !== false;
                  return (
                    <div
                      key={i}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] dark:bg-zinc-800/70 p-2 text-left shadow-sm ring-1 ring-[#efece2] dark:ring-white/10"
                    >
                      {here && (
                        <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-[#dff0e2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#3f9a58]">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          已装
                        </span>
                      )}
                      {/* 窗户示意图标 */}
                      <div
                        className="flex h-16 w-full items-center justify-center rounded-xl"
                        style={{ background: 'linear-gradient(180deg,#dff0f4 0%,#f2f7f4 100%)' }}
                      >
                        <svg viewBox="0 0 48 40" className="h-12 w-12" aria-hidden>
                          <rect x="4" y="4" width="40" height="32" rx="2.5" fill="none" stroke={winCol ?? '#f0e7d4'} strokeWidth="4" />
                          <rect x="8" y="8" width="32" height="24" rx="1.5" fill="#cde8f0" opacity={here ? 0.9 : 0.35} />
                          <line x1="24" y1="8" x2="24" y2="32" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                          <line x1="8" y1="20" x2="40" y2="20" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                        </svg>
                      </div>
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e] dark:text-zinc-100">
                        {WIN_NAMES[i] ?? `窗户 ${i + 1}`}
                      </span>
                      {here ? (
                        <span className="w-full rounded-full bg-[#f1efe9] dark:bg-zinc-800 py-1 text-center text-[11px] text-[#a8a8a4] dark:text-zinc-400">
                          安装中
                        </span>
                      ) : (
                        <button
                          onClick={() => onInstallWin(i)}
                          className="w-full rounded-full bg-[#8fbfa8] py-1 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                        >
                          + 安装
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 套装 tab（F3 成套举放） / 商品网格（1:1 实物缩略图 + 已有数量角标；无限购买） */}
            {shopTab === 'set' ? (
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {FURN_SETS.map((s) => {
                  const setThumb = thumbMap[`set:${s.id}`] ?? getCachedThumb(`set:${s.id}`);
                  const Fallback = SET_FALLBACK[s.id] ?? Armchair;
                  return (
                    <div
                      key={s.id}
                      className="flex flex-col rounded-2xl bg-[#faf8f3] dark:bg-zinc-800/70 p-2.5 text-left shadow-sm ring-1 ring-[#efece2] dark:ring-white/10"
                    >
                      {setThumb ? (
                        <img
                          src={setThumb}
                          alt={s.name}
                          draggable={false}
                          className="h-20 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span className="flex h-20 w-full animate-pulse items-center justify-center rounded-xl bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec]">
                          <Fallback className="h-7 w-7 text-white/90" strokeWidth={1.75} aria-hidden />
                        </span>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#3a3a3e] dark:text-zinc-100">
                          {s.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-[#f1efe9] dark:bg-zinc-800 px-1.5 py-0.5 text-[9.5px] leading-none text-[#8a8a86] dark:text-zinc-400">
                          {s.items.length} 件
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-[#8a8a86] dark:text-zinc-400">{s.desc}</p>
                      <p className="mt-0.5 text-[10px] text-[#a8a8a4] dark:text-zinc-500">整组一步撤销</p>
                      <button
                        onClick={() => onPlaceSet(s.id)}
                        className="mt-2 rounded-full bg-[#f4b3c2] py-1.5 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                      >
                        一键举放
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {shopItems.map((e) => {
                  const owned = items.filter((it) => it.kind === e.kind).length;
                  const thumb = thumbMap[e.kind] || getCachedThumb(e.kind);
                  return (
                    <button
                      key={e.kind}
                      onClick={() => onBuy(e.kind)}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] dark:bg-zinc-800/70 p-2 text-left shadow-sm ring-1 ring-[#efece2] dark:ring-white/10 transition active:scale-95"
                    >
                      {owned > 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-[#f4b3c2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
                          ×{owned}
                        </span>
                      )}
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={e.name}
                          draggable={false}
                          className="h-16 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span
                          className="h-16 w-full animate-pulse rounded-xl shadow-inner"
                          style={{ background: `linear-gradient(135deg, ${catColor(e.cat)}, ${shade(e.cat)})` }}
                        />
                      )}
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e] dark:text-zinc-100">
                        {e.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 商城 1:1 缩略图工作室（隐藏离屏画布，逐件快照）—— 动态组件由父级传入 */}
      {open && thumbQueue[0] && ThumbStudio && (
        <ThumbStudio
          kind={thumbQueue[0]}
          onThumb={onThumb}
        />
      )}
    </>
  );
}

/** 缩略图工作室动态组件（由主文件注入，避免本文件重复 next/dynamic 配置） */
let ThumbStudio: React.ComponentType<{ kind: string; onThumb: (kind: string, url: string) => void }> | null = null;
export function setShopThumbStudio(C: React.ComponentType<{ kind: string; onThumb: (kind: string, url: string) => void }> | null) {
  ThumbStudio = C;
}
