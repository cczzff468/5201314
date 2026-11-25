'use client';

/**
 * AI 浏览器悬浮球（屏幕右侧入口，PhoneShell 壳层 z-57）。
 *
 * 第三十轮（机主需求）：
 * - 出现时机：AI 浏览器【用过之后】才出现（有上次的页面/搜索记录）或窗口正开着——
 *   首次未使用时球隐藏（不占屏幕）；AI 一搜索/打开网页，球即出现常驻；
 * - 点击恢复：点球打开小窗即显示【上次搜索/看的页面】（store localStorage 持久化恢复）；
 * - 美化：品牌蓝渐变玻璃球 + 外圈光环 + Compass 罗盘图标 + 微呼吸动效；窗口开着时
 *   变半透明指示态（点球即收起）；
 * - 拖动：沿右侧上下拖动换位置（localStorage 记忆）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import { useAIBrowser, loadBallPos, saveBallPos, isBrowserUsed, type BallPos } from '@/lib/ios/ai-browser-store';

const BALL_SIZE = 46;
const EDGE_RIGHT = 3;

export default function AIBrowserBall() {
  const { open, used, openPanel, closePanel } = useAIBrowser();
  const [pos, setPos] = useState<BallPos>({ y: 0.42 }); // 归一化 y（0=顶 1=底），默认偏上便于够到
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; ballY: number } | null>(null);
  const moved = useRef(false);

  // 位置持久化恢复（localStorage；损坏/缺省回 0.42）
  useEffect(() => {
    const saved = loadBallPos();
    if (saved) setPos(saved);
  }, []);

  // 用过标记冷启动恢复（模块 init 时 store.used 已从 localStorage 读出；这里兜底重读一次
  // ——store 模块可能在球挂载前就被首次 openPanel 之外的路径初始化过）
  const [everUsed, setEverUsed] = useState(used || isBrowserUsed());
  useEffect(() => {
    if (used) setEverUsed(true);
  }, [used]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, ballY: pos.y };
    moved.current = false;
    setDragging(true);
  }, [pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dy) > 4) moved.current = true; // 超过 4px 视为拖动（点击不误判）
    if (!moved.current) return;
    const shell = (e.currentTarget.closest('[data-phone-shell]') as HTMLElement | null) ?? document.body;
    const maxY = shell.clientHeight - BALL_SIZE - 60; // 底部 Home 指示条上方
    const nextY = Math.min(Math.max(dragStart.current.ballY * shell.clientHeight + dy, 60), maxY) / shell.clientHeight;
    setPos({ y: nextY });
  }, []);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    const wasDrag = moved.current;
    dragStart.current = null;
    if (wasDrag) {
      saveBallPos(pos);
      return;
    }
    // 点击：开/关小窗（打开即显示上次看的页面——store 持久化恢复）
    if (open) closePanel();
    else openPanel({ origin: 'ball' });
  }, [open, openPanel, closePanel, pos]);

  // 出现时机：用过或窗口开着才渲染（首次未用不显示）
  if (!everUsed && !open) return null;

  return (
    <button
      type="button"
      data-testid="ai-browser-ball"
      aria-label={open ? '收起 AI 浏览器小窗' : '打开 AI 浏览器（继续上次看的网页）'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDragging(false);
        dragStart.current = null;
      }}
      className={`pointer-events-auto absolute z-[57] grid select-none place-items-center rounded-full ring-1 ring-white/25 transition-[opacity,transform,box-shadow] duration-200 active:scale-90 ${
        dragging ? 'scale-110' : 'animate-[aiBallBreath_5s_ease-in-out_infinite]'
      } ${
        open
          ? 'bg-black/70 ring-black/20 backdrop-blur-md dark:bg-black/80'
          : 'bg-gradient-to-br from-[#5AC8FA] via-[#0A84FF] to-[#0040DD] shadow-[0_6px_22px_rgba(10,132,255,0.55)]'
      }`}
      style={{
        right: EDGE_RIGHT,
        top: `calc(${pos.y * 100}% - ${BALL_SIZE / 2}px)`,
        width: BALL_SIZE,
        height: BALL_SIZE,
        opacity: open ? 0.55 : 1,
      }}
    >
      {/* 外圈光环（未打开时的玻璃质感装饰） */}
      {!open ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[3px] rounded-full border border-white/30 opacity-70"
          style={{ boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.4)' }}
        />
      ) : null}
      {open ? (
        <X className="h-[20px] w-[20px] text-white" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Compass className="h-[22px] w-[22px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]" strokeWidth={2} aria-hidden="true" />
      )}
      <style>{`@keyframes aiBallBreath { 0%,100% { box-shadow: 0 6px 22px rgba(10,132,255,0.55); } 50% { box-shadow: 0 6px 30px rgba(10,132,255,0.85); } }`}</style>
    </button>
  );
}
