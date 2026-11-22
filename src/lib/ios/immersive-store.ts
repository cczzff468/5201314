'use client';

import { useSyncExternalStore } from 'react';

/**
 * 沉浸式全屏标志（微型模块，仿 music-island-flag）：
 * 阅读 App 的阅读器打开时置 true —— PhoneShell 依此隐藏顶部状态栏与静态灵动岛，
 * 实现真机阅读 App 的沉浸式阅读体验（退回时自动恢复）。
 * 只挂一个布尔，避免把阅读 App 的任何大模块拖进首屏 bundle。
 */

let immersive = false;
const subs = new Set<() => void>();

/** 写入沉浸模式（阅读器挂载/卸载时调用） */
export function setImmersive(v: boolean): void {
  if (v === immersive) return;
  immersive = v;
  subs.forEach((fn) => {
    try {
      fn();
    } catch {
      // 订阅者异常不影响其他订阅者
    }
  });
}

function getSnapshot(): boolean {
  return immersive;
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** React 订阅钩子（SSR 快照恒 false） */
export function useImmersive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
