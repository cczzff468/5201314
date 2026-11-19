'use client';

/**
 * 编辑模式两块颜色面板（从 CoupleHome.tsx 原样搬移，行为零变化）
 * - PalettePanel：调色盘面板（家具 / 门窗上色 + E7 灯光颜色）
 * - RoomStylePanel：装修面板（地板/墙壁/门/窗 自定义颜色 + 纹理 + G1 装修方案 A/B/C）
 */

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { ColorRow, LIGHT_SWATCHES, SWATCHES } from '../lib/home-core';
import type { HomeMode, LayoutSnap } from '../types';

// ---------------- 调色盘面板（编辑模式：家具 / 门窗） ----------------

export function PalettePanel({
  mode,
  open,
  isWallSel,
  selWallName,
  selName,
  paletteVal,
  selLc,
  selIsLight,
  onClose,
  onPick,
  onPickLight,
}: {
  mode: HomeMode;
  open: boolean;
  isWallSel: boolean;
  selWallName: string;
  selName: string;
  paletteVal?: string;
  selLc?: string;
  selIsLight: boolean;
  onClose: () => void;
  onPick: (hex: string | null) => void;
  onPickLight: (hex: string | null) => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'edit' && open && (isWallSel || !!selName) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="pointer-events-auto w-full max-w-[320px] rounded-3xl bg-white/95 dark:bg-zinc-900/95 p-5 shadow-2xl backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[#3a3a3e] dark:text-zinc-100">
                {isWallSel ? `给「${selWallName}」换色` : `给「${selName}」上色`}
              </span>
              <button
                onClick={onClose}
                aria-label="关闭调色盘"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] dark:bg-zinc-800 text-[#8a8a90] dark:text-zinc-400 transition active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-[11.5px] text-[#9a9a96] dark:text-zinc-400">
              {isWallSel ? '全屋门窗一起换色' : '白色为主，点缀色随心混搭'}
            </p>

            {/* 色卡网格 */}
            <div className="grid grid-cols-5 gap-2.5">
              {SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  onClick={() => onPick(s.hex)}
                  title={s.name}
                  aria-label={`选色 ${s.name}`}
                  className="group flex flex-col items-center gap-1"
                >
                  <span
                    className={
                      paletteVal === s.hex
                        ? 'h-10 w-10 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                        : 'h-10 w-10 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
                    }
                    style={{ background: s.hex }}
                  />
                  <span className="text-[10px] text-[#8a8a86] dark:text-zinc-400">{s.name}</span>
                </button>
              ))}
            </div>

            {/* 自定义 + 恢复默认 */}
            <div className="mt-4 flex items-center gap-2.5">
              <label className="relative flex h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] dark:bg-zinc-800/70 px-3 ring-1 ring-[#eae7df] dark:ring-white/10">
                <span
                  className="h-7 w-7 rounded-lg shadow-inner ring-1 ring-black/10"
                  style={{
                    background: /^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '')
                      ? paletteVal
                      : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
                  }}
                />
                <span className="text-[12px] font-medium text-[#4a4a4e] dark:text-zinc-100">自定义颜色</span>
                <input
                  type="color"
                  aria-label="自定义颜色"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={/^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '') ? paletteVal : '#ffffff'}
                  onChange={(e) => onPick(e.target.value)}
                />
              </label>
              <button
                onClick={() => onPick(null)}
                className="flex h-11 items-center rounded-2xl bg-[#f1efe9] dark:bg-zinc-800 px-4 text-[12px] font-medium text-[#8a8a86] dark:text-zinc-400 transition active:scale-95"
              >
                原色
              </button>
            </div>

            {/* E7 灯光颜色（灯具专属：换的是灯光本身的颜色，非外观；选中 lc 高亮对应圆片） */}
            {selIsLight && (
              <div className="mt-4 border-t border-[#f0ede5] dark:border-white/10 pt-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-[#6a6a6e] dark:text-zinc-300">灯光颜色</span>
                  <span className="text-[10.5px] text-[#a8a8a4] dark:text-zinc-500">开灯后才看得到哦</span>
                </div>
                <div className="flex items-center gap-2">
                  {LIGHT_SWATCHES.map((s) => (
                    <button
                      key={s.hex}
                      onClick={() => onPickLight(s.hex)}
                      title={s.name}
                      aria-label={`灯光颜色 ${s.name}`}
                      className="group flex flex-col items-center"
                    >
                      <span
                        className={
                          selLc === s.hex
                            ? 'h-8 w-8 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                            : 'h-8 w-8 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
                        }
                        style={{ background: s.hex }}
                      />
                    </button>
                  ))}
                  <button
                    onClick={() => onPickLight(null)}
                    aria-label="恢复默认灯光颜色"
                    className={
                      selLc
                        ? 'ml-auto rounded-full bg-[#f1efe9] dark:bg-zinc-800 px-3 py-1.5 text-[11.5px] font-medium text-[#8a8a86] dark:text-zinc-400 transition active:scale-95'
                        : 'ml-auto rounded-full bg-[#f2b3c2] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition active:scale-95'
                    }
                  >
                    默认
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- 装修面板：地板 / 墙壁 / 门 / 窗 自定义颜色 ----------------

export interface RoomStylePanelProps {
  mode: HomeMode;
  open: boolean;
  floorCol?: string;
  wallCol?: string;
  ceilCol?: string;
  floorColBed?: string;
  wallColBed?: string;
  ceilColBed?: string;
  floorColK?: string;
  wallColK?: string;
  ceilColK?: string;
  floorColB?: string;
  wallColB?: string;
  ceilColB?: string;
  floorColBal?: string;
  wallColBal?: string;
  doorCol?: string;
  winCol?: string;
  floorTex: 'plain' | 'wood' | 'check';
  wallTex: 'plain' | 'dot' | 'stripe';
  layouts: LayoutSnap[];
  onClose: () => void;
  applyFloorCol: (hex: string | null) => void;
  applyWallCol: (hex: string | null) => void;
  applyCeilCol: (hex: string | null) => void;
  applyFloorColBed: (hex: string | null) => void;
  applyWallColBed: (hex: string | null) => void;
  applyCeilColBed: (hex: string | null) => void;
  applyFloorColK: (hex: string | null) => void;
  applyWallColK: (hex: string | null) => void;
  applyCeilColK: (hex: string | null) => void;
  applyFloorColB: (hex: string | null) => void;
  applyWallColB: (hex: string | null) => void;
  applyCeilColB: (hex: string | null) => void;
  applyFloorColBal: (hex: string | null) => void;
  applyWallColBal: (hex: string | null) => void;
  applyDoorCol: (hex: string | null) => void;
  applyWinCol: (hex: string | null) => void;
  onFloorTex: (v: 'plain' | 'wood' | 'check') => void;
  onWallTex: (v: 'plain' | 'dot' | 'stripe') => void;
  onApplyLayout: (slot: number) => void;
  onSaveLayout: (slot: number) => void;
}

export function RoomStylePanel({
  mode,
  open,
  floorCol,
  wallCol,
  ceilCol,
  floorColBed,
  wallColBed,
  ceilColBed,
  floorColK,
  wallColK,
  ceilColK,
  floorColB,
  wallColB,
  ceilColB,
  floorColBal,
  wallColBal,
  doorCol,
  winCol,
  floorTex,
  wallTex,
  layouts,
  onClose,
  applyFloorCol,
  applyWallCol,
  applyCeilCol,
  applyFloorColBed,
  applyWallColBed,
  applyCeilColBed,
  applyFloorColK,
  applyWallColK,
  applyCeilColK,
  applyFloorColB,
  applyWallColB,
  applyCeilColB,
  applyFloorColBal,
  applyWallColBal,
  applyDoorCol,
  applyWinCol,
  onFloorTex,
  onWallTex,
  onApplyLayout,
  onSaveLayout,
}: RoomStylePanelProps) {
  return (
    <AnimatePresence>
      {mode === 'edit' && open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="pointer-events-auto w-full max-w-[320px] rounded-3xl bg-white/95 dark:bg-zinc-900/95 p-5 shadow-2xl backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[#3a3a3e] dark:text-zinc-100">装修 · 换颜色</span>
              <button
                onClick={onClose}
                aria-label="关闭装修面板"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] dark:bg-zinc-800 text-[#8a8a90] dark:text-zinc-400 transition active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-[11.5px] text-[#9a9a96] dark:text-zinc-400">四房间 + 天花板分开换色，门窗也能换</p>

            <div className="scrollbar-none max-h-[54vh] overflow-y-auto pr-0.5">
              {/* —— 客厅 —— */}
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#f2b3c2]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">客厅</span>
              </div>
              <ColorRow label="地板" value={floorCol} onPick={applyFloorCol} fallback="#f5f2ec" />
              <ColorRow label="墙壁" value={wallCol} onPick={applyWallCol} fallback="#f7f3ec" />
              <ColorRow label="天花板" value={ceilCol} onPick={applyCeilCol} fallback="#fbf9f3" />

              {/* —— 卧室 —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#c9a8dc]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">卧室</span>
              </div>
              <ColorRow label="地板" value={floorColBed} onPick={applyFloorColBed} fallback="#f5f2ec" />
              <ColorRow label="墙壁" value={wallColBed} onPick={applyWallColBed} fallback="#f7f3ec" />
              <ColorRow label="天花板" value={ceilColBed} onPick={applyCeilColBed} fallback="#fbf9f3" />

              {/* —— 厨房 —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#e8c9a0]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">厨房</span>
              </div>
              <ColorRow label="地板" value={floorColK} onPick={applyFloorColK} fallback="#f5f2ec" />
              <ColorRow label="墙壁" value={wallColK} onPick={applyWallColK} fallback="#f7f3ec" />
              <ColorRow label="天花板" value={ceilColK} onPick={applyCeilColK} fallback="#fbf9f3" />

              {/* —— 卫生间 —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#a8d8cf]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">卫生间</span>
              </div>
              <ColorRow label="地板" value={floorColB} onPick={applyFloorColB} fallback="#f5f2ec" />
              <ColorRow label="墙壁" value={wallColB} onPick={applyWallColB} fallback="#f7f3ec" />
              <ColorRow label="天花板" value={ceilColB} onPick={applyCeilColB} fallback="#fbf9f3" />

              {/* —— 阳台（v5.7） —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d9c7a4]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">阳台</span>
              </div>
              <ColorRow label="地板" value={floorColBal} onPick={applyFloorColBal} fallback="#e2d2b4" />
              <ColorRow label="墙壁" value={wallColBal} onPick={applyWallColBal} fallback="#f7f3ec" />

              {/* —— 门窗（全屋通用） —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#a8c5e0]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">门 · 窗</span>
              </div>
              <ColorRow label="门" value={doorCol} onPick={applyDoorCol} fallback="#f3efe6" />
              <ColorRow label="窗" value={winCol} onPick={applyWinCol} fallback="#f0e7d4" />

              {/* —— 纹理（全屋通用，颜色仍分房间） —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d9c7ae]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">纹理</span>
              </div>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[12.5px] text-[#6a6a6e] dark:text-zinc-300">地板花纹</span>
                <div className="flex gap-1">
                  {(
                    [
                      ['wood', '木纹'],
                      ['plain', '素色'],
                      ['check', '瓷砖'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => onFloorTex(v)}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition active:scale-95 ${
                        floorTex === v
                          ? 'bg-[#f2b3c2] text-white shadow-sm'
                          : 'bg-[#f0eff1] dark:bg-zinc-800 text-[#8a8a90] dark:text-zinc-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-[12.5px] text-[#6a6a6e] dark:text-zinc-300">墙纸花纹</span>
                <div className="flex gap-1">
                  {(
                    [
                      ['plain', '素色'],
                      ['dot', '碎花'],
                      ['stripe', '条纹'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => onWallTex(v)}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition active:scale-95 ${
                        wallTex === v
                          ? 'bg-[#f2b3c2] text-white shadow-sm'
                          : 'bg-[#f0eff1] dark:bg-zinc-800 text-[#8a8a90] dark:text-zinc-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* —— G1 装修方案（整屋快照 A/B/C，应用一步可撤销） —— */}
              <div className="mb-2 mt-4 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#f2a9bc]" />
                <span className="text-[12px] font-semibold text-[#8a8a90] dark:text-zinc-400">装修方案</span>
              </div>
              <p className="mb-2 text-[10.5px] leading-snug text-[#a8a8a4] dark:text-zinc-500">
                整屋快照（家具+各房间地板墙色，不含照片），换季搬家一键切换，应用后可撤销
              </p>
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => {
                  const snap = layouts[i];
                  const tag = ['A', 'B', 'C'][i];
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-2xl bg-[#faf8f3] dark:bg-zinc-800/70 p-2.5 ring-1 ring-[#efece2] dark:ring-white/10">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[12px] font-bold text-white">
                        {tag}
                      </span>
                      {snap ? (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-semibold text-[#3a3a3e] dark:text-zinc-100">
                              方案{tag} · {snap.furniture.length} 件
                            </div>
                            <div className="text-[10px] text-[#a8a8a4] dark:text-zinc-500">
                              {new Date(snap.ts).toLocaleDateString('zh-CN')} 保存
                            </div>
                          </div>
                          <button
                            onClick={() => onApplyLayout(i)}
                            className="shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition active:scale-95"
                          >
                            应用
                          </button>
                          <button
                            onClick={() => onSaveLayout(i)}
                            className="shrink-0 rounded-full bg-[#f0eff1] dark:bg-zinc-800 px-3 py-1.5 text-[11px] font-medium text-[#8a8a90] dark:text-zinc-400 transition active:scale-95"
                          >
                            覆盖
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1 text-[12px] text-[#a8a8a4] dark:text-zinc-500">方案{tag} · 空</div>
                          <button
                            onClick={() => onSaveLayout(i)}
                            className="shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition active:scale-95"
                          >
                            存入当前布置
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

