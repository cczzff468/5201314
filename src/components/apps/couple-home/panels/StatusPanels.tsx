'use client';

/**
 * 右上角三块毛玻璃状态面板（从 CoupleHome.tsx 原样搬移，行为零变化）
 * - PetPanel：宠物状态面板（v7.0 头像唤出：状态条 / 改名 / 装扮 / 成长进度 / 互动按钮）
 * - HeartPanel：TA 的心面板（v10.3 甜度 / 情绪 / 需求一览）
 * - StatsPanel：我们的里程碑面板（v11 I2 大数字卡片）
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Check,
  Circle,
  Droplet,
  Hand,
  Heart,
  HeartHandshake,
  Lock,
  LucideIcon,
  MessageCircle,
  Paintbrush,
  PawPrint,
  Pencil,
  Sparkles,
  UtensilsCrossed,
  X,
  Zap,
} from 'lucide-react';
import { affinityLevelOf } from '../cabin-mind';
import { CatFaceIcon, DogFaceIcon, PetActionButton, PET_ACTIONS, RabbitFaceIcon, PET_TRICK_DEFS } from '../lib/home-core';
import type { CabinStats } from '../lib/cabin-storage';
import type { CabinMind } from '../cabin-mind';
import type { HomeMode, PetCareKind, PetState } from '../types';

type PetLevelGap = { days: number; lvl: number; inLvl: number; need: number };

// ==================================================================
// 宠物状态面板（v7.0：右上角头像唤出 · 毛玻璃胶囊风）
// ==================================================================

export interface PetPanelProps {
  mode: HomeMode;
  open: boolean;
  activePetName: string;
  activePetIdx: number;
  activePetObj: PetState;
  actLv: number;
  actGap: PetLevelGap;
  carrying: boolean;
  petCare: PetCareKind | null;
  renaming: boolean;
  nameDraft: string;
  onNameDraft: (v: string) => void;
  onCommitName: () => void;
  onCancelRename: () => void;
  onClose: () => void;
  onDressUp: () => void;
  onStartRename: () => void;
  onOpenAdopt: () => void;
  onOpenDiary: () => void;
  onCare: (kind: PetCareKind) => void;
}

export function PetPanel({
  mode,
  open,
  activePetName,
  activePetIdx,
  activePetObj,
  actLv,
  actGap,
  carrying,
  petCare,
  renaming,
  nameDraft,
  onNameDraft,
  onCommitName,
  onCancelRename,
  onClose,
  onDressUp,
  onStartRename,
  onOpenAdopt,
  onOpenDiary,
  onCare,
}: PetPanelProps) {
  return (
    <AnimatePresence>
      {open && mode === 'live' && (
        <motion.div
          key="pet-panel"
          initial={{ opacity: 0, y: -14, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-auto absolute right-3 top-[104px] z-40 w-[min(78%,270px)] origin-top-right rounded-[26px] border border-white/60 dark:border-white/15 bg-white/55 dark:bg-zinc-900/75 p-3.5 shadow-[0_16px_40px_rgba(90,60,50,0.18)] backdrop-blur-2xl"
          role="dialog"
          aria-label={`${activePetName}状态面板`}
        >
          {/* 头部：头像（v7.1 SVG 猫头）+ 名字（可改） + 关闭 */}
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec] shadow-inner ring-1 ring-[#eadbc4]/60">
              {activePetIdx < 0 ? (
                <CatFaceIcon className="h-8 w-8" />
              ) : activePetObj.kind === 'dog' ? (
                <DogFaceIcon className="h-8 w-8" />
              ) : (
                <RabbitFaceIcon className="h-8 w-8" />
              )}
            </div>
            {renaming ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => onNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitName();
                    if (e.key === 'Escape') onCancelRename();
                  }}
                  maxLength={8}
                  placeholder="给它起个名字"
                  aria-label="宠物名字"
                  className="h-8 min-w-0 flex-1 rounded-full border border-white/70 dark:border-white/15 bg-white/75 dark:bg-zinc-800/80 px-3 text-[13px] font-semibold text-[#4a4a4e] dark:text-zinc-100 outline-none placeholder:text-[#c9c2ba] dark:placeholder:text-zinc-500 focus:border-[#f4b3c2]"
                />
                <button
                  onClick={onCommitName}
                  aria-label="确认名字"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4b3c2]/90 text-white shadow-sm transition active:scale-90"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14.5px] font-bold leading-tight text-[#4a4a4e] dark:text-zinc-100">{activePetName}</span>
                    {/* v8.3 成长徽章：Lv + 陪伴天数 */}
                    <span className="shrink-0 rounded-full bg-[#f7e8c8] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#a8762a] ring-1 ring-[#ecd9a8]">
                      Lv.{actLv}
                    </span>
                  </div>
                  <div className="text-[10.5px] leading-tight text-[#9a938a] dark:text-zinc-400">
                    陪伴第 {actGap.days + 1} 天
                  </div>
                </div>
                {/* v8.3 装扮（衣柜宠物栏） */}
                <button
                  onClick={onDressUp}
                  aria-label="给宠物装扮"
                  title="毛色/围巾/蝴蝶结"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-zinc-800/70 text-[#c99a5b] shadow-sm ring-1 ring-white/70 dark:ring-white/15 transition hover:bg-white/85 dark:hover:bg-zinc-700/70 active:scale-90"
                >
                  <Paintbrush className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onStartRename}
                  aria-label="给宠物改名"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-zinc-800/70 text-[#a8927c] shadow-sm ring-1 ring-white/70 dark:ring-white/15 transition hover:bg-white/85 dark:hover:bg-zinc-700/70 active:scale-90"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={onClose}
                  aria-label="关闭面板"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-zinc-800/70 text-[#8a837a] dark:text-zinc-300 shadow-sm ring-1 ring-white/70 dark:ring-white/15 transition hover:bg-white/85 dark:hover:bg-zinc-700/70 active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {/* 三条状态胶囊：体力（蓝）/ 清洁（绿）/ 心情（橙） */}
          <div className="flex flex-col gap-1.5">
            {(
              [
                { icon: Zap, label: '体力', val: activePetObj.st, bar: '#4da3ff' },
                { icon: Droplet, label: '清洁', val: activePetObj.cl, bar: '#5ec269' },
                { icon: Heart, label: '心情', val: activePetObj.mo, bar: '#ff9f43' },
              ] as { icon: LucideIcon; label: string; val: number; bar: string }[]
            ).map(({ icon: Icon, label, val, bar }) => (
              <div key={label} className="flex items-center gap-2 rounded-full bg-white/60 dark:bg-zinc-800/70 px-2.5 py-1.5 ring-1 ring-white/70 dark:ring-white/15">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${bar}1f` }}>
                  <Icon className="h-3.5 w-3.5" style={{ color: bar }} />
                </div>
                <span className="w-7 shrink-0 text-[12px] font-semibold text-[#5a554e] dark:text-zinc-300">{label}</span>
                <span className="w-6 shrink-0 text-right text-[13px] font-bold tabular-nums text-[#4a4a4e] dark:text-zinc-100">{val}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eceae4] dark:bg-zinc-700/60">
                  <motion.div
                    className="h-full rounded-full"
                    initial={false}
                    animate={{ width: `${val}%` }}
                    transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                    style={{ backgroundColor: bar }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* v8.3 成长进度（当前宠物）+ v9 领伙伴（永远可领，无数只） */}
          <div className="mt-2 flex items-center gap-2 rounded-full bg-white/60 dark:bg-zinc-800/70 px-2.5 py-1.5 ring-1 ring-white/70 dark:ring-white/15">
            <span className="shrink-0 text-[10.5px] font-semibold text-[#a8762a]">成长</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eceae4] dark:bg-zinc-700/60">
              <motion.div
                className="h-full rounded-full bg-[#e8b06a]"
                initial={false}
                animate={{ width: `${Math.round(actGap.inLvl * 100)}%` }}
                transition={{ type: 'spring', damping: 30, stiffness: 200 }}
              />
            </div>
            <span className="shrink-0 text-[9.5px] text-[#b0a8a0] dark:text-zinc-500">再照顾 {actGap.need} 次升级</span>
            <button
              onClick={onOpenAdopt}
              aria-label="领养新伙伴"
              className="flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-[#f4b3c2]/90 px-2 text-[9.5px] font-bold text-white shadow-sm transition active:scale-90"
            >
              <Heart className="h-2.5 w-2.5" />
              领伙伴
            </button>
            <button
              onClick={onOpenDiary}
              aria-label="翻翻宠物日记"
              className="flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-[#e8b06a]/90 px-2 text-[9.5px] font-bold text-white shadow-sm transition active:scale-90"
            >
              <BookOpen className="h-2.5 w-2.5" />
              日记
            </button>
          </div>

          {/* v7.2 互动按钮（面板下方）：六种照顾动作 + v8.3 扔球/成长把戏，抱抱抱着时变「放下」 */}
          <div className="mt-2.5 h-px bg-white/60 dark:bg-white/15" aria-hidden="true" />
          <div
            className="mt-2 grid grid-cols-3 justify-items-center gap-1"
            role="toolbar"
            aria-label={`${activePetName}互动按钮`}
          >
            <PetActionButton kind="ball" icon={Circle} label="扔球" fg="#4a90c9" carrying={carrying} disabled={!!petCare} onClick={() => onCare('ball')} />
            {PET_ACTIONS.map(({ kind, icon: Icon, label, fg }) => (
              <PetActionButton
                key={kind}
                kind={kind}
                icon={Icon}
                label={label}
                fg={fg}
                carrying={carrying}
                disabled={!!petCare}
                onClick={() => onCare(kind)}
              />
            ))}
            {PET_TRICK_DEFS.map(({ kind, icon: Icon, label, lvl }) =>
              actLv >= lvl ? (
                <PetActionButton key={kind} kind={kind} icon={Icon} label={label} fg="#8a7ab0" carrying={carrying} disabled={!!petCare} onClick={() => onCare(kind)} />
              ) : (
                <button
                  key={kind}
                  disabled
                  aria-label={`${label}（Lv.${lvl} 解锁）`}
                  className="flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-full bg-white/35 dark:bg-zinc-800/50 opacity-60 ring-1 ring-white/60 dark:ring-white/15"
                >
                  <Lock className="h-4 w-4 text-[#b0a8a0] dark:text-zinc-500" />
                  <span className="text-[8.5px] leading-none text-[#b0a8a0] dark:text-zinc-500">Lv.{lvl}</span>
                </button>
              ),
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ==================================================================
// v10.3 TA 的心面板（顶栏爱心按钮唤出 · 毛玻璃胶囊风 · 与宠物面板同槽互斥）
// ==================================================================

export interface HeartPanelProps {
  mode: HomeMode;
  open: boolean;
  mind: CabinMind | null;
  onClose: () => void;
  onOpenDiary: () => void;
}

export function HeartPanel({ mode, open, mind, onClose, onOpenDiary }: HeartPanelProps) {
  return (
    <AnimatePresence>
      {open && mode === 'live' && (
        <motion.div
          key="heart-panel"
          initial={{ opacity: 0, y: -14, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-auto absolute right-3 top-[104px] z-40 w-[min(78%,270px)] origin-top-right rounded-[26px] border border-white/60 dark:border-white/15 bg-white/55 dark:bg-zinc-900/75 p-4 shadow-[0_16px_40px_rgba(90,60,50,0.18)] backdrop-blur-2xl"
          role="dialog"
          aria-label="TA 的心面板"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Heart className="h-4 w-4 shrink-0 text-[#e88a9a]" />
            <p className="text-[14px] font-bold text-[#3a3a3e] dark:text-zinc-100">TA 的心</p>
            <button
              onClick={onClose}
              aria-label="关闭 TA 的心"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/80 text-[#8a837a] dark:text-zinc-300 ring-1 ring-white/70 dark:ring-white/15 transition active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {(() => {
            if (!mind) return <p className="py-5 text-center text-[12px] text-[#b0a8a0] dark:text-zinc-400">多和身边的 TA 相处一阵子，这里就会亮起来～</p>;
            const lv = affinityLevelOf(mind.affinity);
            const MOOD: Record<string, string> = { happy: '开心', content: '平静', low: '有点蔫', missing: '想你', sulking: '闹脾气' };
            const NEEDS = [
              { k: '饱腹', v: mind.needs.food, c: '#e8a06a' },
              { k: '精力', v: mind.needs.energy, c: '#7fa8c9' },
              { k: '心情', v: mind.needs.mood, c: '#e4a0a8' },
              { k: '想你', v: 100 - mind.needs.social, c: '#b89ad4' },
            ];
            return (
              <div>
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#3a3a3e] dark:text-zinc-100">
                  <span>Lv.{lv.lv} {lv.title}</span>
                  <span className="ml-auto text-[10.5px] font-normal text-[#c98a9a] dark:text-rose-300/80">甜度 {Math.round(mind.affinity)} · {MOOD[mind.mood]}</span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {NEEDS.map((n) => (
                    <div key={n.k} className="rounded-lg bg-white/70 dark:bg-zinc-800/70 px-1.5 py-1 text-center ring-1 ring-white/80 dark:ring-white/15">
                      <div className="text-[9.5px] text-[#a09a94] dark:text-zinc-400">{n.k}</div>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-[#f0e8e2] dark:bg-zinc-700/60">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(n.v)}%`, background: n.c }} />
                      </div>
                      <div className="mt-0.5 text-[9px] font-semibold" style={{ color: n.c }}>{Math.round(n.v)}</div>
                    </div>
                  ))}
                </div>
                {mind.sulk.on && (
                  <div className="mt-2 text-center text-[10.5px] text-[#c97a8a]">TA 正在闹小脾气，说句好听的哄哄 TA 吧～</div>
                )}
                {/* v11 F2 日记入口：TA 每天悄悄写一篇 */}
                <button
                  onClick={onOpenDiary}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/75 dark:bg-zinc-800/75 py-2 text-[11.5px] font-semibold text-[#a8768a] dark:text-rose-300 ring-1 ring-white/80 dark:ring-white/15 transition active:scale-95"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  TA 的日记
                </button>
              </div>
            );
          })()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ==================================================================
// v11 I2 我们的里程碑面板（⋮ 菜单唤出 · 毛玻璃胶囊风 · 与心面板同款）
// ==================================================================

export interface StatsPanelProps {
  mode: HomeMode;
  open: boolean;
  stats: CabinStats | null;
  onClose: () => void;
}

export function StatsPanel({ mode, open, stats, onClose }: StatsPanelProps) {
  return (
    <AnimatePresence>
      {open && mode === 'live' && (
        <motion.div
          key="stats-panel"
          initial={{ opacity: 0, y: -14, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 26, stiffness: 340 }}
          className="pointer-events-auto absolute right-3 top-[104px] z-40 w-[min(84%,290px)] origin-top-right rounded-[26px] border border-white/60 dark:border-white/15 bg-white/55 dark:bg-zinc-900/75 p-4 shadow-[0_16px_40px_rgba(90,60,50,0.18)] backdrop-blur-2xl"
          role="dialog"
          aria-label="我们的里程碑面板"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 shrink-0 text-[#b89ad4]" />
            <p className="text-[14px] font-bold text-[#3a3a3e] dark:text-zinc-100">我们的里程碑</p>
            <button
              onClick={onClose}
              aria-label="关闭我们的里程碑"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/80 text-[#8a837a] dark:text-zinc-300 ring-1 ring-white/70 dark:ring-white/15 transition active:scale-90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {(() => {
            if (!stats) return <p className="py-5 text-center text-[12px] text-[#b0a8a0] dark:text-zinc-400">选定陪伴的 TA 之后，这里就会开始记账啦～</p>;
            const days = Math.max(1, Math.floor((Date.now() - stats.since) / 86_400_000) + 1);
            const CARDS: { k: string; v: number; unit: string; c: string; Icon: LucideIcon }[] = [
              { k: '在一起', v: days, unit: '天', c: '#e88a9a', Icon: Heart },
              { k: '聊了', v: stats.chatLines, unit: '句', c: '#7fa8c9', Icon: MessageCircle },
              { k: '做了', v: stats.meals, unit: '顿饭', c: '#e8a06a', Icon: UtensilsCrossed },
              { k: '拥抱', v: stats.hugs, unit: '次', c: '#e4a0a8', Icon: HeartHandshake },
              { k: '牵手', v: stats.holds, unit: '次', c: '#b89ad4', Icon: Hand },
              { k: '照顾宠物', v: stats.petCares, unit: '次', c: '#8fce9e', Icon: PawPrint },
            ];
            return (
              <div className="grid grid-cols-2 gap-2">
                {CARDS.map(({ k, v, unit, c, Icon }) => (
                  <div key={k} className="rounded-2xl bg-white/70 dark:bg-zinc-800/70 px-2.5 py-2 ring-1 ring-white/80 dark:ring-white/15">
                    <div className="flex items-center gap-1 text-[10px] text-[#a09a94] dark:text-zinc-400">
                      <Icon className="h-3 w-3 shrink-0" style={{ color: c }} />
                      {k}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-0.5">
                      <span className="text-[20px] font-bold leading-none" style={{ color: c }}>
                        {v}
                      </span>
                      <span className="text-[10px] text-[#a09a94] dark:text-zinc-400">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
