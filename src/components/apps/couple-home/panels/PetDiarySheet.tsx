'use client';

/**
 * v10 C4 宠物日记面板（毛玻璃抽屉，读 cabin-pet-diary；v10.3 补 pointer-events-auto：
 * 抽屉挂在 pointer-events-none 的 HUD 层里，不显式开启点击会全部穿透 —— 叉号/遮罩点了没反应的原因）
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { loadPetDiary } from '../lib/cabin-storage';

export interface PetDiarySheetProps {
  open: boolean;
  activePetName: string;
  onClose: () => void;
}

export default function PetDiarySheet({ open, activePetName, onClose }: PetDiarySheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="pet-diary-mask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 z-[64] bg-black/25"
            onClick={onClose}
          />
          <motion.div
            key="pet-diary"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-[66] mx-auto max-w-[430px] rounded-t-[26px] border border-white/60 dark:border-white/15 bg-white/60 dark:bg-zinc-900/80 p-4 shadow-[0_-8px_40px_rgba(120,70,80,0.22)] backdrop-blur-2xl"
            role="dialog"
            aria-label="宠物日记"
          >
            <div className="mb-2 flex items-center">
              <p className="text-[14px] font-bold text-[#3a3a3e] dark:text-zinc-100">{activePetName}的日记</p>
              <button
                onClick={onClose}
                aria-label="关闭日记"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/80 text-[#8a837a] dark:text-zinc-300 ring-1 ring-white/70 dark:ring-white/15 transition active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[38vh] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#e3c8d1] dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600">
              {(() => {
                const list = loadPetDiary();
                if (list.length === 0) {
                  return <p className="py-6 text-center text-[12px] text-[#b0a8a0] dark:text-zinc-400">日记还是空的，多陪陪它、照顾它，就会一篇篇写满啦～</p>;
                }
                return (
                  <div className="flex flex-col gap-1.5">
                    {list
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <div key={`${e.ts}-${i}`} className="rounded-2xl bg-white/75 dark:bg-zinc-800/75 px-3 py-2 text-[12px] leading-relaxed text-[#5a5a5e] dark:text-zinc-200 ring-1 ring-white/70 dark:ring-white/15">
                          {e.text}
                        </div>
                      ))}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
