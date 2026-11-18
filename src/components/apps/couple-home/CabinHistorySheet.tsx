'use client';

/**
 * 拾光小屋 —— 聊天记录回看面板（E1）
 *
 * 底部抽屉弹层（毛玻璃胶囊风，质感对齐 Wardrobe / 宠物状态面板）：
 * 回看小屋里和 TA 的头顶气泡聊天记录（localStorage `cabin-chat-<charId>` 的 turns 存档），
 * 按时间正序展示、打开自动滚到底部；支持一键清空（confirm 确认后移除存档）。
 * CoupleHome 接线：<CabinHistorySheet open onClose charId={companion.id} charName={companion.name} />
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { sfx } from './sfx';

export interface CabinHistorySheetProps {
  open: boolean;
  onClose: () => void;
  charId: string;
  charName: string;
}

/** 小屋聊天存档结构（与 CoupleHome 的 loadCabinConvo / saveCabinConvo 读写同 key） */
interface CabinChatSave {
  convo?: unknown;
  turns?: unknown;
  ts?: unknown;
}

/** 展示用的一轮对话（me=用户说的话，peer=TA 的回复） */
interface CabinTurn {
  role: 'me' | 'peer';
  text: string;
}

/** 读档：try/catch 兜底空数组（隐私模式/坏 JSON 都不炸） */
function loadCabinTurns(id: string): { turns: CabinTurn[]; ts: number } {
  try {
    const raw = window.localStorage.getItem(`cabin-chat-${id}`);
    if (!raw) return { turns: [], ts: 0 };
    const j = JSON.parse(raw) as Partial<CabinChatSave> | null;
    const turns = Array.isArray(j?.turns)
      ? (j.turns as unknown[]).filter(
          (t): t is CabinTurn =>
            !!t &&
            typeof t === 'object' &&
            ((t as CabinTurn).role === 'me' || (t as CabinTurn).role === 'peer') &&
            typeof (t as CabinTurn).text === 'string',
        )
      : [];
    const ts = typeof j?.ts === 'number' ? j.ts : 0;
    return { turns, ts };
  } catch {
    return { turns: [], ts: 0 };
  }
}

/** 外壳：open=false 直接不渲染；每次打开都全新挂载内层面板（自动重读最新存档） */
export default function CabinHistorySheet({ open, onClose, charId, charName }: CabinHistorySheetProps) {
  if (!open) return null;
  return <HistorySheetInner onClose={onClose} charId={charId} charName={charName} />;
}

function HistorySheetInner({ onClose, charId, charName }: Omit<CabinHistorySheetProps, 'open'>) {
  // 惰性初始化：挂载时读一次档（存档正序，最新在末尾）
  const [saved] = useState<{ turns: CabinTurn[]; ts: number }>(() => loadCabinTurns(charId));
  const [turns, setTurns] = useState<CabinTurn[]>(saved.turns);
  const [ts, setTs] = useState<number>(saved.ts);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开轻点音（每次打开全新挂载，只响一次）
  useEffect(() => {
    sfx.tap();
  }, []);

  // 消息变化后自动滚到底部（时间正序，最新在最下）
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  /** 清空聊天记录：confirm 确认 → 移除 localStorage 存档 → 清空列表 */
  const handleClear = () => {
    sfx.tap();
    if (!window.confirm(`确定清空和${charName}的全部聊天记忆吗？此操作不可恢复。`)) return;
    try {
      window.localStorage.removeItem(`cabin-chat-${charId}`);
    } catch {
      /* 移除失败就算了（隐私模式），列表照常清空 */
    }
    setTurns([]);
    setTs(0);
  };

  const timeText = ts > 0 ? ` · 最近聊天 ${new Date(ts).toLocaleString('zh-CN')}` : '';

  return (
    <>
      {/* 背景遮罩：点击关闭（v10.3 补 pointer-events-auto：面板挂在 pointer-events-none 的
          HUD 层里，不显式开启点击会全部穿透 —— 叉号/遮罩点了没反应的原因） */}
      <button aria-label="关闭聊天记忆" className="pointer-events-auto fixed inset-0 z-[65] cursor-default bg-black/25" onClick={onClose} />

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
            <div className="text-[15px] font-semibold text-[#6b545c]">和{charName}的聊天记忆</div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-[#9c838c] shadow-sm ring-1 ring-white/70 transition active:scale-95"
            >
              <X size={16} />
            </button>
          </div>

          {/* 信息行：共 N 条 · 最近聊天时间 */}
          <div className="px-4 pb-2 text-[11px] text-[#a38d95]">
            共 {turns.length} 条{timeText}
          </div>

          {/* 消息列表（细滚动条） */}
          <div
            ref={listRef}
            className="max-h-[52vh] overflow-y-auto pt-1 [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#e3c8d1] [&::-webkit-scrollbar-track]:bg-transparent"
          >
            {turns.length === 0 ? (
              <div className="flex h-28 items-center justify-center px-6 text-center text-[13px] text-[#b7a3ab]">
                还没有聊天记忆，去和 TA 说说话吧～
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 px-4 pb-3">
                {turns.map((t, i) => {
                  const isMe = t.role === 'me';
                  return (
                    <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${
                          isMe
                            ? 'rounded-br-md bg-[#fbdce6]/90 text-[#7c4a58] ring-1 ring-white/50'
                            : 'rounded-bl-md bg-white/75 text-[#5c4a52] ring-1 ring-white/60'
                        }`}
                      >
                        {t.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部：清空聊天记录 */}
          <div className="flex items-center justify-center px-4 pb-3 pt-2">
            <button type="button" onClick={handleClear} className="text-xs text-[#c98a9a] transition active:scale-95">
              清空聊天记录
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
