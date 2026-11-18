'use client';

/**
 * 陪伴角色选择弹窗（v8.0：进入小屋弹联系人列表；⋮ 菜单「换个TA」再弹）
 * 从 CoupleHome.tsx 原样搬移，行为零变化。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';

export interface CompanionPickerProps {
  open: boolean;
  contacts: ContactRecord[];
  companion: ContactRecord | null;
  onChoose: (c: ContactRecord) => void;
  onClose: () => void;
}

export default function CompanionPicker({ open, contacts, companion, onChoose, onClose }: CompanionPickerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="companion-picker"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[80] flex items-center justify-center bg-black/35 p-6"
        >
          <motion.div
            initial={{ scale: 0.92, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-[320px] rounded-3xl bg-white/95 dark:bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-1 text-center text-[15.5px] font-semibold text-[#3a3a3e] dark:text-zinc-100">谁陪你住进拾光小屋？</div>
            <p className="mb-3 text-center text-[11px] leading-snug text-[#9a9a96] dark:text-zinc-400">
              TA 会成为小家里的 3D 小人：陪你聊天散步、听你指挥、求抱抱，
              <br />
              还会用 TA 在设置里绑定的聊天 / 识图 / 语音模型
            </p>
            <div className="scrollbar-none flex max-h-[44vh] flex-col gap-2 overflow-y-auto">
              {contacts.filter((c) => c.kind === 'char').length === 0 && (
                <p className="py-7 text-center text-[12px] leading-relaxed text-[#a8a8a4] dark:text-zinc-500">
                  还没有 AI 角色联系人
                  <br />
                  先去「联系人」App 创建一个吧
                </p>
              )}
              {contacts
                .filter((c) => c.kind === 'char')
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onChoose(c)}
                    className="flex items-center gap-3 rounded-2xl bg-[#faf8f3] dark:bg-zinc-800/70 p-2.5 text-left ring-1 ring-[#efece2] dark:ring-white/10 transition active:scale-[0.98]"
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt={c.name} className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[15px] font-bold text-white">
                        {c.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-[#3a3a3e] dark:text-zinc-100">{c.name}</span>
                      <span className="block truncate text-[10.5px] text-[#a8a8a4] dark:text-zinc-500">{c.relation || 'AI 角色'}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#d8cfc4] dark:text-zinc-500" />
                  </button>
                ))}
            </div>
            {companion && (
              <button
                onClick={onClose}
                className="mt-3 w-full rounded-full bg-[#f1efe9] dark:bg-zinc-800 py-2 text-[12.5px] font-medium text-[#8a8a86] dark:text-zinc-400 transition active:scale-95"
              >
                取消（继续和{companion.name}在一起）
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
