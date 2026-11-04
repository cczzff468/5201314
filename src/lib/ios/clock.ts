'use client';

import { useSyncExternalStore } from 'react';

/** 每秒广播的时钟源（useSyncExternalStore，SSR 安全；与秒边界对齐，翻分立即刷新不滞后） */
function subscribeClock(onChange: () => void): () => void {
  let timer: number | undefined;
  // 先对齐到下一个整秒再开始每秒触发，避免轮询相位滞后最多 1 秒
  const timeout = window.setTimeout(() => {
    onChange();
    timer = window.setInterval(onChange, 1000);
  }, 1000 - (Date.now() % 1000));
  return () => {
    window.clearTimeout(timeout);
    if (timer !== undefined) window.clearInterval(timer);
  };
}

function getClockSecond(): number {
  return Math.floor(Date.now() / 1000);
}

function getServerClockSecond(): number {
  return 0;
}

/** 当前时间（每秒刷新）；SSR 阶段返回 null */
export function useNow(): Date | null {
  const second = useSyncExternalStore(subscribeClock, getClockSecond, getServerClockSecond);
  return second > 0 ? new Date(second * 1000) : null;
}

/** HH:mm formatter（模块级缓存：每秒/每组件重复 new Intl.DateTimeFormat 开销可观） */
let timeFormatter: Intl.DateTimeFormat | null = null;
function getTimeFormatter(): Intl.DateTimeFormat {
  if (!timeFormatter) {
    timeFormatter = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return timeFormatter;
}

/** HH:mm 24 小时制（状态栏/锁屏共用） */
export function formatIOSTime(date: Date): string {
  return getTimeFormatter().format(date);
}
