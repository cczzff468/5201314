'use client';

/**
 * 灵动岛堆叠协调（用户需求：播放音乐时淘宝/美团灵动岛出现 → 音乐岛在左侧加歌曲封面小圆圈，
 * 右侧显示当前配送小窗；点小圆圈展开音乐大窗；大窗可堆叠——多个大窗同时显示，点大窗进对应界面；
 * 二轮修订：①堆叠时音乐大窗永远在最上（按 TOP_PRIORITY 排序而非展开先后）；
 * ②点左侧圆圈只出音乐大窗（配送岛整体隐身，不在下方显示）；
 * ③点配送小窗所有大窗一起出现（音乐大窗同时展开、圆圈消失）；
 * ④组合形态整体收窄（237→195px）不挡状态栏时间/电量；
 * 三轮修订：⑤淘宝/美团/音乐三大窗同显——大窗不互斥（互斥只作用小窗：小窗仍只显示最新事件一方）；
 * ⑥淘宝/美团大窗按「出现时刻」依次排序，早出现的沉底（早的在下面），音乐大窗恒在最上）：
 * - order：当前展开的大窗 id（按展开先后排序）；heights：各大窗实测高度（ResizeObserver 回写）；
 * - appearedAt：各岛当前活动（进行中订单）的出现时刻（淘宝/美团岛组件回写下单时刻），
 *   仅用于大窗堆叠排序——时刻新的排在上（紧贴音乐大窗），早的沉底；
 * - expand/collapse/collapseAll：三个岛组件（音乐/淘宝/美团）共同读写；
 * - islandTopOf(id)：某大窗的垂直锚位 = 顶部锚位 + 排在它前面的大窗高度之和 + 间隔；
 *   排序=音乐永远第一 + 其余按 appearedAt 新→旧（早的在下面）；
 * - islandNextSlotTop()：下一个空闲槽位顶部——对方大窗展开时，小圆圈/配送小窗让位到这。
 * 音乐岛在组合模式只渲染左侧封面圆圈（配送小窗由淘宝/美团岛渲染在右侧），
 * 各自按本 store 计算的锚位绝对定位，互不重叠、随高度实测值平滑跟随。
 */

import { create } from 'zustand';

export type IslandId = 'music' | 'tb' | 'mt';

/** 堆叠顶部锚位（与三个岛组件的 PILL_TOP 同值：灵动岛胶囊原位） */
export const ISLAND_TOP = 11;
/** 堆叠项之间的间隔 */
export const ISLAND_GAP = 8;

/**
 * 堆叠展示顺序：音乐永远最上；淘宝/美团按出现时刻（appearedAt）新→旧排列——
 * 时刻新的紧贴音乐大窗之下，早出现的沉底（用户要求「依次排序，早的在下面」）。
 * appearedAt 缺失/相同（平局）时按展开先后（order 序，稳定排序）兜底。
 */
export function islandStackSorted(
  order: IslandId[],
  appearedAt: Partial<Record<IslandId, number>> = {},
): IslandId[] {
  const music = order.filter((id) => id === 'music');
  const rest = order.filter((id) => id !== 'music');
  rest.sort((a, b) => (appearedAt[b] ?? 0) - (appearedAt[a] ?? 0));
  return [...music, ...rest];
}

interface IslandStackState {
  /** 当前展开的大窗（展开先后序）；空 = 都收着（小窗/圆圈形态） */
  order: IslandId[];
  /** 各大窗实测内容高度（px）；展开中的岛用 ResizeObserver 回写 */
  heights: Partial<Record<IslandId, number>>;
  /** 各岛当前活动（进行中订单）的出现时刻（ms 时间戳）；大窗堆叠排序用（早的在下面） */
  appearedAt: Partial<Record<IslandId, number>>;
  /** 回写某岛的出现时刻（同值幂等，不触发订阅） */
  markAppeared: (id: IslandId, at: number) => void;
  expand: (id: IslandId) => void;
  collapse: (id: IslandId) => void;
  collapseAll: () => void;
  setHeight: (id: IslandId, h: number) => void;
}

export const useIslandStack = create<IslandStackState>((set) => ({
  order: [],
  heights: {},
  appearedAt: {},
  markAppeared: (id, at) =>
    set((s) => (s.appearedAt[id] === at ? s : { appearedAt: { ...s.appearedAt, [id]: at } })),
  expand: (id) => set((s) => (s.order.includes(id) ? s : { order: [...s.order, id] })),
  collapse: (id) =>
    set((s) => {
      if (!s.order.includes(id) && s.heights[id] === undefined) return s;
      const heights = { ...s.heights };
      delete heights[id];
      return { order: s.order.filter((x) => x !== id), heights };
    }),
  collapseAll: () => set({ order: [], heights: {} }),
  setHeight: (id, h) =>
    set((s) => (s.heights[id] === h ? s : { heights: { ...s.heights, [id]: h } })),
}));

/** 某大窗的垂直锚位：顶部锚位 + 排在它前面的展开大窗高度 + 间隔
 *  （音乐永远最上；淘宝/美团按出现时刻新→旧，早的在下面） */
export function islandTopOf(
  order: IslandId[],
  heights: Partial<Record<IslandId, number>>,
  id: IslandId,
  appearedAt: Partial<Record<IslandId, number>> = {},
): number {
  let top = ISLAND_TOP;
  for (const x of islandStackSorted(order, appearedAt)) {
    if (x === id) break;
    top += (heights[x] ?? 0) + ISLAND_GAP;
  }
  return top;
}

/** 下一个空闲槽位顶部：所有已展开大窗之下（小圆圈/配送小窗让位用；只求和与顺序无关） */
export function islandNextSlotTop(
  order: IslandId[],
  heights: Partial<Record<IslandId, number>>,
): number {
  let top = ISLAND_TOP;
  for (const x of order) top += (heights[x] ?? 0) + ISLAND_GAP;
  return top;
}
