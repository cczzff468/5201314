'use client';

/**
 * AI 浏览器悬浮球（屏幕侧边常驻入口，PhoneShell 壳层 z-57）。
 *
 * 「AI 专属分屏浏览器」需求：屏幕侧边常驻一个极简的浏览器悬浮球，点击随时唤起半屏分屏面板。
 *
 * - 形态：右侧边缘 44×44 圆球（Safari 风格罗盘图标 + 品牌蓝底白面），面板开着时变为关闭态样式；
 * - 交互：点击 → 开/关分屏面板（openPanel({origin:'ball'})）；沿右侧上下拖动换位置（localStorage 记忆，
 *   与聊天悬浮窗同款持久化范式）；
 * - 可见性：与其它全局浮层同门控（layersReady 后挂载）；面板展开时球下沉为半透明指示，
 *   点球即收起面板（一次点击不遮挡内容）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import { useAIBrowser, loadBallPos, saveBallPos, type BallPos } from '@/lib/ios/ai-browser-store';

const BALL_SIZE = 44;
const EDGE_RIGHT = 2;

export default function AIBrowserBall() {
  const { open, openPanel, closePanel } = useAIBrowser();
  const [pos, setPos] = useState<BallPos>({ y: 0.42 }); // 归一化 y（0=顶 1=底），默认偏上便于够到
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; ballY: number } | null>(null);
  const moved = useRef(false);

  // 位置持久化恢复（localStorage；损坏/缺省回 0.42）
  useEffect(() => {
    const saved = loadBallPos();
    if (saved) setPos(saved);
  }, []);

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
    // 点击：开/关分屏面板
    if (open) closePanel();
    else openPanel({ origin: 'ball' });
  }, [open, openPanel, closePanel, pos]);

  return (
    <button
      type="button"
      data-testid="ai-browser-ball"
      aria-label={open ? '关闭 AI 分屏浏览器' : '打开 AI 分屏浏览器'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDragging(false);
        dragStart.current = null;
      }}
      className={`pointer-events-auto absolute z-[57] grid select-none place-items-center rounded-full shadow-[0_6px_20px_rgba(0,0,0,0.30)] ring-1 ring-black/10 transition-[opacity,transform,background-color] duration-200 active:scale-90 ${
        dragging ? 'scale-110' : ''
      } ${
        open
          ? 'bg-black/70 backdrop-blur-md dark:bg-black/80'
          : 'bg-gradient-to-br from-[#0A84FF] to-[#007AFF] text-white'
      }`}
      style={{
        right: EDGE_RIGHT,
        top: `calc(${pos.y * 100}% - ${BALL_SIZE / 2}px)`,
        width: BALL_SIZE,
        height: BALL_SIZE,
        opacity: open ? 0.55 : 1,
      }}
    >
      {open ? (
        <X className="h-[19px] w-[19px] text-white" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Compass className="h-[21px] w-[21px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]" strokeWidth={2.1} aria-hidden="true" />
      )}
    </button>
  );
}
