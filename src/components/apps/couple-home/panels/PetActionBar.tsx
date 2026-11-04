'use client';

/**
 * 宠物互动竖条（v7.1：点宠物才出现 · 点别处消失 · 右侧竖排 · 白玻璃圆钮无彩色底）
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Circle } from 'lucide-react';
import { PetActionButton, PET_ACTIONS, PET_TRICK_DEFS } from '../lib/home-core';
import type { HomeMode, PetCareKind } from '../types';

export interface PetActionBarProps {
  mode: HomeMode;
  /** 衣柜弹窗打开时隐藏（避免压住抽屉） */
  wardrobeOpen: boolean;
  open: boolean;
  activePetName: string;
  actLv: number;
  carrying: boolean;
  petCare: PetCareKind | null;
  onCare: (kind: PetCareKind) => void;
}

export default function PetActionBar({ mode, wardrobeOpen, open, activePetName, actLv, carrying, petCare, onCare }: PetActionBarProps) {
  return (
    <AnimatePresence>
      {mode === 'live' && !wardrobeOpen && open && (
        <div key="pet-bar-wrap" className="absolute right-3 top-1/2 z-30 -translate-y-1/2">
          <motion.div
            initial={{ opacity: 0, x: 24, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.92 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          >
            <div
              className="pointer-events-auto flex flex-col items-center gap-2"
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
              {PET_TRICK_DEFS.filter((t) => actLv >= t.lvl).map(({ kind, icon: Icon, label }) => (
                <PetActionButton key={kind} kind={kind} icon={Icon} label={label} fg="#8a7ab0" carrying={carrying} disabled={!!petCare} onClick={() => onCare(kind)} />
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
