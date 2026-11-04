'use client';

/**
 * 情侣小家 —— 软木留言板（G8 共享留言板）
 *
 * - 小人点击墙上的软木留言板弹出：便签墙（我 = 粉签 / TA = 黄签，微微歪斜）+ 写便签；
 * - 留言保存在小屋档案（HomeState.notes），TA 进门时若未读会弹提醒；
 * - 每条最长 120 字，最多保留 50 条（新的在上）。
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pin, Send, Trash2, X } from 'lucide-react';
import type { NoteEntry } from './types';

const MAX_TEXT = 120;

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 便签颜色：我 = 粉 / TA = 奶黄，各两档深浅交替 */
const NOTE_BG = {
  me: ['bg-[#fbdde6]', 'bg-[#f7cfdd]'],
  partner: ['bg-[#fbeed0]', 'bg-[#f8e6b8]'],
};

export default function NotesOverlay({
  notes,
  onClose,
  onPost,
  onDelete,
}: {
  notes: NoteEntry[];
  onClose: () => void;
  onPost: (text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(t);
  }, []);

  const post = () => {
    const t = text.trim();
    if (!t) return;
    onPost(t.slice(0, MAX_TEXT));
    setText('');
  };

  // 新的在上
  const ordered = notes.slice().reverse();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/25 p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 14 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="pointer-events-auto flex w-full max-w-[320px] flex-col overflow-hidden rounded-3xl bg-white/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-1.5">
            <Pin className="h-4 w-4 text-[#e8a3b3]" />
            <span className="text-[15px] font-semibold text-[#3a3a3e]">软木留言板</span>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭留言板"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-5 pt-0.5 text-[11px] text-[#9a9a96]">写给 TA 的便签，进门就会看到～</p>

        {/* 便签墙 */}
        <div className="scrollbar-none mt-3 max-h-[46vh] min-h-[120px] overflow-y-auto px-4 pb-2">
          {ordered.length === 0 ? (
            <div className="flex h-[120px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#f6e7d8] text-center">
              <Pin className="h-5 w-5 text-[#c9a98a]" />
              <p className="text-[12px] text-[#a08a72]">软木板还空空的</p>
              <p className="text-[11px] text-[#b8a48e]">写第一条便签钉上去吧</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <AnimatePresence initial={false}>
                {ordered.map((n, i) => (
                  <motion.div
                    key={n.id}
                    layout
                    initial={{ opacity: 0, scale: 0.85, rotate: -6 }}
                    animate={{ opacity: 1, scale: 1, rotate: (i % 2 === 0 ? 1 : -1) * (1.2 + (i % 3) * 0.7) }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                    className={`relative rounded-lg p-2.5 shadow-sm ${NOTE_BG[n.by][i % 2]}`}
                  >
                    {/* 图钉 */}
                    <span className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-[#d96a6a] shadow" />
                    <p className="break-all pt-1.5 text-[11.5px] leading-snug text-[#5a5248]">{n.text}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[9.5px] text-[#a89880]">
                        {n.by === 'me' ? '我' : 'TA'} · {fmtTs(n.ts)}
                      </span>
                      <button
                        onClick={() => onDelete(n.id)}
                        aria-label="撕下这张便签"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[#b8a48e] transition hover:bg-black/5 active:scale-90"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* 输入行 */}
        <div className="border-t border-[#f0eeea] p-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              maxLength={MAX_TEXT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') post();
              }}
              placeholder="写点想对 TA 说的…"
              className="h-9 min-w-0 flex-1 rounded-full bg-[#f4f2ee] px-3.5 text-[12.5px] text-[#4a4a4e] outline-none placeholder:text-[#b8b4ae]"
            />
            <button
              onClick={post}
              disabled={!text.trim()}
              aria-label="贴上便签"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition active:scale-90 ${
                text.trim() ? 'bg-[#f4b3c2]' : 'bg-[#e5dede]'
              }`}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {text.length > MAX_TEXT - 20 && (
            <p className="mt-1 text-right text-[9.5px] text-[#b8b4ae]">
              {text.length}/{MAX_TEXT}
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
