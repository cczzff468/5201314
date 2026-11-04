'use client';

/**
 * 拾光小屋 —— TA 的日记面板（v11 F2）
 *
 * 底部抽屉毛玻璃胶囊回看面板（结构/质感抄 CabinHistorySheet.tsx）：
 * 倒序翻阅 TA 每天自动写的日记（localStorage `cabin-ta-diary-<charId>`，由 ta-diary.ts 读写），
 * 支持一键清空（confirm 确认后移除存档）。
 * CoupleHome 接线：<TaDiarySheet open onClose charId={companion.id} charName={companion.name} />
 *
 * ⚠ v10.3 教训：抽屉挂在 pointer-events-none 的 HUD 层里，遮罩与抽屉都必须显式
 *   pointer-events-auto，否则点击全部穿透（叉号/遮罩点了没反应）。
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, X } from 'lucide-react';
import { sfx } from './sfx';
import { clearTaDiary, loadTaDiary, type TaDiaryEntry } from './ta-diary';

export interface TaDiarySheetProps {
  open: boolean;
  onClose: () => void;
  charId: string;
  charName: string;
}

/** 心情标签 → 中文徽章 */
const MOOD_LABEL: Record<string, string> = {
  happy: '开心',
  content: '平静',
  low: '有点蔫',
  missing: '想你',
  sulking: '闹脾气',
};

/** 外壳：open=false 直接不渲染；每次打开都全新挂载内层面板（自动重读最新存档） */
export default function TaDiarySheet({ open, onClose, charId, charName }: TaDiarySheetProps) {
  if (!open) return null;
  return <TaDiarySheetInner onClose={onClose} charId={charId} charName={charName} />;
}

function TaDiarySheetInner({ onClose, charId, charName }: Omit<TaDiarySheetProps, 'open'>) {
  // 惰性初始化：挂载时读一次档（倒序展示，最新在最上）
  const [entries, setEntries] = useState<TaDiaryEntry[]>(() => loadTaDiary(charId).slice().reverse());

  // 打开轻点音（每次打开全新挂载，只响一次）
  useEffect(() => {
    sfx.tap();
  }, []);

  /** 清空日记：confirm 确认 → 移除 localStorage 存档 → 清空列表 */
  const handleClear = () => {
    sfx.tap();
    if (!window.confirm(`确定清空${charName}写过的全部日记吗？此操作不可恢复。`)) return;
    clearTaDiary(charId);
    setEntries([]);
  };

  return (
    <>
      {/* 背景遮罩：点击关闭（pointer-events-auto 必加 —— v10.3 穿透教训） */}
      <button aria-label="关闭 TA 的日记" className="pointer-events-auto fixed inset-0 z-[65] cursor-default bg-black/25" onClick={onClose} />

      {/* 底部抽屉（translate-y 滑入） */}
      <motion.div
        className="pointer-events-auto fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-[430px]"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        <div className="flex flex-col overflow-hidden rounded-t-[26px] border border-white/60 bg-white/55 shadow-[0_-8px_40px_rgba(120,70,80,0.22)] backdrop-blur-2xl">
          {/* 把手 */}
          <div className="flex items-center justify-center pt-2.5">
            <div className="h-1.5 w-10 rounded-full bg-[#e8d5cd]" />
          </div>

          {/* 头部：标题 + 圆形关闭钮 */}
          <div className="flex items-center justify-between px-4 pb-1 pt-1.5">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[#6b545c]">
              <BookOpen className="h-4 w-4 text-[#c9a58a]" />
              {charName}的日记
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[#9c838c] shadow-sm ring-1 ring-white/70 transition active:scale-95"
            >
              <X size={16} />
            </button>
          </div>

          {/* 信息行 */}
          <div className="px-4 pb-2 text-[11px] text-[#a38d95]">
            共 {entries.length} 篇 · {charName}每天会悄悄写上一篇
          </div>

          {/* 日记列表（倒序 · 细滚动条） */}
          <div className="max-h-[52vh] overflow-y-auto pt-1 [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#e3c8d1] [&::-webkit-scrollbar-track]:bg-transparent">
            {entries.length === 0 ? (
              <div className="flex h-28 items-center justify-center px-6 text-center text-[13px] text-[#b7a3ab]">
                日记还是空的，陪 TA 过完今天，就会写满第一篇啦～
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 px-4 pb-3">
                {entries.map((e) => (
                  <div key={e.date} className="rounded-2xl bg-white/75 px-3.5 py-2.5 shadow-sm ring-1 ring-white/60">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-[#8a6f7a]">{e.date}</span>
                      <span className="rounded-full bg-[#f7e8ef] px-1.5 py-0.5 text-[9.5px] font-medium text-[#c07a90]">
                        {MOOD_LABEL[e.mood] ?? '平静'}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#5c4a52]">{e.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部：清空日记 */}
          <div className="flex items-center justify-center px-4 pb-3 pt-2">
            <button type="button" onClick={handleClear} className="text-xs text-[#c98a9a] transition active:scale-95">
              清空全部日记
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
