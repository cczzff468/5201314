'use client';

/**
 * 淘宝快递灵动岛可见性共享状态（极简 zustand，与 mt-island-store 同款）：
 * TaobaoIsland 写入，MusicIsland / StatusBar 只读——
 * - MusicIsland：任一配送灵动岛（美团/淘宝）可见时隐身（同一灵动岛锚位只容一个常驻弹窗）；
 * - StatusBar：任一灵动岛弹窗可见时隐藏「移动数据」信号图标（真机 iOS 同语义）。
 */
import { create } from 'zustand';

interface TbIslandState {
  /** 淘宝快递灵动岛（小窗/大窗任一形态）当前是否可见 */
  visible: boolean;
  setVisible: (v: boolean) => void;
}

export const useTbIsland = create<TbIslandState>((set) => ({
  visible: false,
  setVisible: (v) => set((s) => (s.visible === v ? s : { visible: v })),
}));
