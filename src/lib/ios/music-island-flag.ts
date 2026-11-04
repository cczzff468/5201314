'use client';

import { useSyncExternalStore } from 'react';

/**
 * 音乐灵动岛可见性标志（微型模块）：
 * StatusBar（首屏静态组件）只需要一个「音乐灵动岛是否可见」的布尔来隐藏信号图标，
 * 原先直接订阅 music-store（千行级 + music-api 网络层）把这个大模块静态拖进了首屏 bundle。
 * 抽出独立微 store：MusicIsland 写入时同步广播，StatusBar/任意轻量组件只订阅这里。
 * music-store.islandVisible 仍保留（MeituanIsland/TaobaoIsland 等懒加载 chunk 继续用），双写同步。
 */

let visible = false;
const subs = new Set<() => void>();

/** 写入可见性（MusicIsland 挂载/消失时调用；与 music-store.islandVisible 双写同步） */
export function setMusicIslandVisible(v: boolean): void {
  if (v === visible) return;
  visible = v;
  subs.forEach((fn) => {
    try {
      fn();
    } catch {
      // 订阅者异常不影响其他订阅者
    }
  });
}

function getSnapshot(): boolean {
  return visible;
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** React 订阅钩子（SSR 快照恒 false，与 music-store 初始值一致） */
export function useMusicIslandVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
