'use client';

/**
 * 情侣小家 3D —— 棋盘桌五子棋（v5.7 J7「可下棋」）
 *
 * - 15×15 标准五子棋盘，玩家执黑先行，AI 执白；
 * - AI：启发式评分（活四/冲四/活三/眠三…双向打分取最优，带 5% 随机扰动避免每局一样）；
 * - 胜负判定：五连即胜（含横竖斜），结束弹结算条（再来一局 / 收起）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';

const N = 15;
type Cell = 0 | 1 | 2; // 0 空 / 1 黑(玩家) / 2 白(AI)
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 在 (x,y) 沿四方向数连子 + 两端开合，返回形状分 */
function lineScore(b: Cell[], x: number, y: number, who: Cell, dx: number, dy: number): number {
  let cnt = 1;
  let openA = false;
  let openB = false;
  const at = (i: number, j: number) => (i < 0 || i >= N || j < 0 || j >= N ? -1 : b[j * N + i]);
  let i = x + dx;
  let j = y + dy;
  while (at(i, j) === who) {
    cnt++;
    i += dx;
    j += dy;
  }
  openA = at(i, j) === 0;
  i = x - dx;
  j = y - dy;
  while (at(i, j) === who) {
    cnt++;
    i -= dx;
    j -= dy;
  }
  openB = at(i, j) === 0;
  const open = (openA ? 1 : 0) + (openB ? 1 : 0);
  if (cnt >= 5) return 1000000;
  if (cnt === 4) return open === 2 ? 50000 : open === 1 ? 8000 : 0;
  if (cnt === 3) return open === 2 ? 6000 : open === 1 ? 700 : 0;
  if (cnt === 2) return open === 2 ? 650 : open === 1 ? 120 : 0;
  return open === 2 ? 40 : 8;
}

function pointScore(b: Cell[], x: number, y: number, who: Cell): number {
  let s = 0;
  for (const [dx, dy] of DIRS) s += lineScore(b, x, y, who, dx, dy);
  return s;
}

function checkWin(b: Cell[], who: Cell): boolean {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (b[y * N + x] !== who) continue;
      for (const [dx, dy] of DIRS) {
        let cnt = 0;
        for (let k = 0; k < 5; k++) {
          const i = x + dx * k;
          const j = y + dy * k;
          if (i < 0 || i >= N || j < 0 || j >= N || b[j * N + i] !== who) break;
          cnt++;
        }
        if (cnt >= 5) return true;
      }
    }
  }
  return false;
}

export default function ChessOverlay({ onClose }: { onClose: () => void }) {
  const [board, setBoard] = useState<Cell[]>(() => Array<Cell>(N * N).fill(0));
  const [turn, setTurn] = useState<Cell>(1);
  const [winner, setWinner] = useState<Cell | 0>(0);
  const busy = useRef(false);

  const reset = () => {
    setBoard(Array<Cell>(N * N).fill(0));
    setTurn(1);
    setWinner(0);
    busy.current = false;
  };

  const place = (x: number, y: number) => {
    if (winner || turn !== 1 || busy.current) return;
    if (board[y * N + x] !== 0) return;
    const nb = board.slice();
    nb[y * N + x] = 1;
    setBoard(nb);
    if (checkWin(nb, 1)) {
      setWinner(1);
      return;
    }
    setTurn(2);
    busy.current = true;
  };

  // —— AI 回合（延迟一点下，像在思考） ——
  useEffect(() => {
    if (turn !== 2 || winner) return;
    const timer = setTimeout(() => {
      const b = board.slice();
      const empty: [number, number][] = [];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (b[y * N + x] === 0) {
            // 只考虑已有棋子附近的点（开局的中心点兜底）
            let near = false;
            for (let dy = -2; dy <= 2 && !near; dy++) {
              for (let dx = -2; dx <= 2 && !near; dx++) {
                const i = x + dx;
                const j = y + dy;
                if (i >= 0 && i < N && j >= 0 && j < N && b[j * N + i] !== 0) near = true;
              }
            }
            if (near || b.every((c) => c === 0)) empty.push([x, y]);
          }
        }
      }
      if (empty.length === 0) {
        busy.current = false;
        return;
      }
      let best: [number, number] = empty[0];
      let bestScore = -1;
      for (const [x, y] of empty) {
        // 我方进攻分 + 对方防守分（防重于攻：对方分 ×1.1）
        const s = pointScore(b, x, y, 2) + pointScore(b, x, y, 1) * 1.1 + Math.random() * 30;
        if (s > bestScore) {
          bestScore = s;
          best = [x, y];
        }
      }
      b[best[1] * N + best[0]] = 2;
      setBoard(b);
      busy.current = false;
      if (checkWin(b, 2)) {
        setWinner(2);
        return;
      }
      setTurn(1);
    }, 560);
    return () => clearTimeout(timer);
  }, [turn, winner, board]);

  const statusText = winner === 1 ? '🏆 你赢啦！棋艺高超' : winner === 2 ? '惜败一局，再战？' : turn === 1 ? '轮到你落子（黑）' : 'AI 思考中…';

  const close = useCallback(() => onClose(), [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ scale: 0.92, y: 14 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="w-full max-w-[340px] rounded-3xl bg-white/96 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[15px] font-semibold text-[#3a3a3e]">五子棋对弈</div>
            <div className="text-[11.5px] text-[#9a9a96]">{statusText}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={reset}
              aria-label="再来一局"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={close}
              aria-label="收起棋盘"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 棋盘（CSS grid，线用背景渐变画） */}
        <div className="relative mx-auto aspect-square w-full rounded-xl bg-[#f0dfb8] p-[3%] shadow-inner">
          <div
            className="relative h-full w-full"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(138,106,72,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(138,106,72,0.55) 1px, transparent 1px)',
              backgroundSize: `${100 / (N - 1)}% ${100 / (N - 1)}%`,
            }}
          >
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N}, 1fr)`, gridTemplateRows: `repeat(${N}, 1fr)`, transform: `translate(-${100 / (N - 1) / 2}%, -${100 / (N - 1) / 2}%)`, width: `${100 + 100 / (N - 1)}%`, height: `${100 + 100 / (N - 1)}%` }}>
              {board.map((c, i) => {
                const x = i % N;
                const y = Math.floor(i / N);
                return (
                  <button
                    key={i}
                    aria-label={`落子 ${x + 1},${y + 1}`}
                    onClick={() => place(x, y)}
                    className="flex items-center justify-center"
                  >
                    {c !== 0 && (
                      <motion.span
                        initial={{ scale: 0.4 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 18, stiffness: 400 }}
                        className={`block h-[72%] w-[72%] rounded-full shadow ${
                          c === 1
                            ? 'bg-gradient-to-br from-[#4a4a52] to-[#1e1e24]'
                            : 'bg-gradient-to-br from-white to-[#dcdcd6]'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {winner !== 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-center justify-center gap-2"
            >
              <button
                onClick={reset}
                className="flex h-10 items-center gap-2 rounded-full bg-[#f2b3c2] px-5 text-[13px] font-semibold text-white shadow transition active:scale-95"
              >
                <RotateCcw className="h-4 w-4" />
                再来一局
              </button>
              <button
                onClick={close}
                className="flex h-10 items-center rounded-full bg-[#f1efe9] px-5 text-[13px] font-medium text-[#8a8a86] transition active:scale-95"
              >
                收起棋盘
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
