'use client';

/**
 * 生活模式的三条随动快捷条（从 CoupleHome.tsx 原样搬移，行为零变化）
 * - FurnActionBar：家具互动确认（坐下/睡觉/泡澡 → 站起来/起床/出来；浴缸放水）
 * - TvBar：电视开着随时换台
 * - CupBar：端着饮料随时放下
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Armchair,
  Bath,
  BedDouble,
  BookOpen,
  Coffee,
  CupSoda,
  Droplet,
  Gamepad2,
  Laptop,
  Music,
  Shirt,
  ShowerHead,
  Sparkles,
  Tv,
  Utensils,
  UtensilsCrossed,
} from 'lucide-react';
import { ACT_LABELS } from '../lib/home-core';
import type { CharAction } from '../types';

type CharActionLite = { type: CharAction['type']; itemId: string; active: boolean };

// ---------------- 家具互动按钮（生活模式）：衣柜弹窗打开时隐藏避免压住抽屉 ----------------

export function FurnActionBar({
  mode,
  charAction,
  wardrobeOpen,
  instOpen,
  onPrimary,
  onToggleWater,
}: {
  mode: string;
  charAction: CharActionLite | null;
  wardrobeOpen: boolean;
  instOpen: boolean;
  onPrimary: () => void;
  onToggleWater: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'live' && charAction && !wardrobeOpen && !(charAction.type === 'play' && instOpen) && (
        <motion.div
          key="action-bar"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="absolute bottom-[272px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
        >
          {charAction.active && charAction.type === 'bath' && (
            <button
              onClick={onToggleWater}
              aria-label="浴缸放水/关水"
              className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
            >
              <Droplet className="h-[18px] w-[18px]" />
              放水
            </button>
          )}
          <motion.button
            key={`${charAction.itemId}-${charAction.active}`}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', damping: 24, stiffness: 340 }}
            onClick={onPrimary}
            className={
              charAction.active
                ? 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#3a3a3e]/85 px-6 text-[14px] font-semibold text-white shadow-xl backdrop-blur transition active:scale-95'
                : 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-6 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95'
            }
          >
            {charAction.type === 'sit' ? (
              <Armchair className="h-[18px] w-[18px]" />
            ) : charAction.type === 'lie' ? (
              <BedDouble className="h-[18px] w-[18px]" />
            ) : charAction.type === 'bath' ? (
              <Bath className="h-[18px] w-[18px]" />
            ) : charAction.type === 'shower' ? (
              <ShowerHead className="h-[18px] w-[18px]" />
            ) : charAction.type === 'watch' ? (
              <Tv className="h-[18px] w-[18px]" />
            ) : charAction.type === 'cook' ? (
              <UtensilsCrossed className="h-[18px] w-[18px]" />
            ) : charAction.type === 'eat' ? (
              <Utensils className="h-[18px] w-[18px]" />
            ) : charAction.type === 'drink' ? (
              <CupSoda className="h-[18px] w-[18px]" />
            ) : charAction.type === 'coffee' ? (
              <Coffee className="h-[18px] w-[18px]" />
            ) : charAction.type === 'read' ? (
              <BookOpen className="h-[18px] w-[18px]" />
            ) : charAction.type === 'dress' ? (
              <Shirt className="h-[18px] w-[18px]" />
            ) : charAction.type === 'play' ? (
              <Music className="h-[18px] w-[18px]" />
            ) : charAction.type === 'makeup' || charAction.type === 'mirror' ? (
              <Sparkles className="h-[18px] w-[18px]" />
            ) : charAction.type === 'game' ? (
              <Gamepad2 className="h-[18px] w-[18px]" />
            ) : charAction.type === 'hotpot' ? (
              <UtensilsCrossed className="h-[18px] w-[18px]" />
            ) : (
              <Laptop className="h-[18px] w-[18px]" />
            )}
            {ACT_LABELS[charAction.type][charAction.active ? 1 : 0]}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- 电视开着：随时换台（看电视不再是动作，小人自由走动） ----------------

export function TvBar({
  mode,
  tvOn,
  instOpen,
  tvBarCls,
  onCycle,
}: {
  mode: string;
  tvOn: boolean;
  instOpen: boolean;
  tvBarCls: string;
  onCycle: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'live' && tvOn && !instOpen && (
        <motion.div
          key="tv-bar"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className={`absolute left-1/2 z-20 -translate-x-1/2 ${tvBarCls}`}
        >
          <button
            onClick={onCycle}
            aria-label="电视换台"
            className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#f4b3c2] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
          >
            <Tv className="h-[18px] w-[18px]" />
            换台
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------- 端着饮料：随时放下（拿饮料不再锁人，杯子握在手里到处逛） ----------------

export function CupBar({
  mode,
  carryCup,
  cupBarCls,
  onDrop,
}: {
  mode: string;
  carryCup: boolean;
  cupBarCls: string;
  onDrop: () => void;
}) {
  return (
    <AnimatePresence>
      {mode === 'live' && carryCup && (
        <motion.div
          key="cup-bar"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className={`absolute left-1/2 z-20 -translate-x-1/2 ${cupBarCls}`}
        >
          <button
            onClick={onDrop}
            aria-label="放下杯子"
            className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
          >
            <CupSoda className="h-[18px] w-[18px]" />
            放下杯子
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
