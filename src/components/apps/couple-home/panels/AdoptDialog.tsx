'use client';

/**
 * 领养新伙伴弹窗（v9：小狗 / 小兔子；可以领养无数只，领完弹窗不关接着挑）
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Dog, Rabbit } from 'lucide-react';
import type { Pet2State } from '../types';

export interface AdoptDialogProps {
  open: boolean;
  pets2: Pet2State[];
  onClose: () => void;
  /** 点已领养的伙伴切换互动目标（父组件负责 setActivePet + 开状态面板 + sfx） */
  onPickExisting: (i: number) => void;
  onAdopt: (kind: 'dog' | 'rabbit') => void;
}

export default function AdoptDialog({ open, pets2, onClose, onPickExisting, onAdopt }: AdoptDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="pet2-adopt"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
          role="dialog"
          aria-label="领养新伙伴"
        >
          <motion.div
            initial={{ scale: 0.9, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-[290px] rounded-3xl border border-white/60 dark:border-white/15 bg-white/90 dark:bg-zinc-900/90 p-5 text-center shadow-2xl backdrop-blur-xl"
          >
            <p className="text-[15px] font-semibold text-[#3a3a3e] dark:text-zinc-100">带一只新伙伴回家？</p>
            <p className="mb-3 mt-1 text-[11.5px] text-[#9a9a96] dark:text-zinc-400">
              想领几只都可以，它们会一起追着玩～
              {pets2.length > 0 && <span className="ml-1 text-[#c98a9a]">（家里已有 {pets2.length} 只小伙伴）</span>}
            </p>
            {pets2.length > 0 && (
              <div className="scrollbar-none mb-3 flex max-h-16 flex-wrap justify-center gap-1 overflow-y-auto">
                {pets2.map((b, i) => (
                  <button
                    key={i}
                    onClick={() => onPickExisting(i)}
                    className="flex items-center gap-1 rounded-full bg-white/80 dark:bg-zinc-800/80 px-2 py-1 text-[10px] font-semibold text-[#7a756e] dark:text-zinc-300 ring-1 ring-[#f0e2dc] dark:ring-white/10 transition active:scale-95"
                  >
                    {b.kind === 'dog' ? <Dog className="h-3 w-3 text-[#c99a5b]" /> : <Rabbit className="h-3 w-3 text-[#e8a3b3]" />}
                    {b.name ?? (b.kind === 'dog' ? '旺财' : '雪球')}
                  </button>
                ))}
              </div>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => onAdopt('dog')}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/70 dark:bg-zinc-800/70 px-3 py-3.5 ring-1 ring-[#f0e2dc] dark:ring-white/10 transition active:scale-95"
              >
                <Dog className="h-7 w-7 text-[#c99a5b]" />
                <span className="text-[12.5px] font-semibold text-[#5a554e] dark:text-zinc-200">小狗</span>
                <span className="text-[10px] text-[#b0a8a0] dark:text-zinc-400">摇尾巴·爱追球</span>
              </button>
              <button
                onClick={() => onAdopt('rabbit')}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/70 dark:bg-zinc-800/70 px-3 py-3.5 ring-1 ring-[#f0e2dc] dark:ring-white/10 transition active:scale-95"
              >
                <Rabbit className="h-7 w-7 text-[#e8a3b3]" />
                <span className="text-[12.5px] font-semibold text-[#5a554e] dark:text-zinc-200">小兔子</span>
                <span className="text-[10px] text-[#b0a8a0] dark:text-zinc-400">蹦蹦跳·软软的</span>
              </button>
            </div>
            <button
              onClick={onClose}
              className="h-10 w-full rounded-full bg-[#f1efe9] dark:bg-zinc-800 text-[13px] font-semibold text-[#8a8a86] dark:text-zinc-400 transition active:scale-95"
            >
              再想想
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
