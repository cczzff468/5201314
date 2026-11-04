'use client';

/**
 * 美团外卖灵动岛可见性共享状态（极简 zustand）：
 * MeituanIsland 写入，MusicIsland / StatusBar 只读——
 * - MusicIsland：美团灵动岛可见时隐身（同一灵动岛锚位只容一个常驻弹窗，美团配送优先）；
 * - StatusBar：任一灵动岛弹窗可见时隐藏「移动数据」信号图标（真机 iOS 同语义）。
 */
import { create } from 'zustand';

interface MtIslandState {
  /** 美团灵动岛（小窗/大窗任一形态）当前是否可见 */
  visible: boolean;
  setVisible: (v: boolean) => void;
}

export const useMtIsland = create<MtIslandState>((set) => ({
  visible: false,
  setVisible: (v) => set((s) => (s.visible === v ? s : { visible: v })),
}));
