'use client';

/**
 * 共享长按 Hook（纯 Pointer Events 实现，鼠标 + 触屏通吃）。
 *
 * 用法：把返回的 handlers 展开到目标元素上（可与 onClick 共存）：
 *   const lp = useLongPress(() => setEditing(true));
 *   <button {...lp} onClick={openItem}>…</button>
 *
 * 关键行为：
 * - 仅主键（鼠标左键 / 触屏 primary pointer）启动定时器；
 * - 手指/指针移动超过 moveThreshold 视为滚动，取消长按；
 * - pointerup / pointerleave / pointercancel 均清除定时器；
 * - onContextMenu 阻止默认（防移动端长按弹系统菜单）；
 * - 若本次按压已触发过长按，onClickCapture 会吞掉紧随的 click
 *   （preventDefault + stopPropagation），避免长按进编辑模式后误触行点击。
 */

import { useCallback, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface LongPressOptions {
  /** 长按时长（毫秒），默认 500 */
  ms?: number;
  /** 移动取消阈值（像素），默认 10 */
  moveThreshold?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

export function useLongPress(
  onLongPress: () => void,
  { ms = 500, moveThreshold = 10 }: LongPressOptions = {}
): LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  /** 本次按压是否已触发过长按（用于吞掉随后的 click） */
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return; // 仅主键启动
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onLongPress();
      }, ms);
    },
    [onLongPress, ms, clearTimer]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (timerRef.current === null || !startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
        clearTimer();
        startRef.current = null;
      }
    },
    [moveThreshold, clearTimer]
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    onPointerMove,
    onContextMenu,
    onClickCapture,
  };
}
