/**
 * 出血条带共享状态（v2.4.8）：
 * SafeAreaBleedBands 每次采样后把「顶部条带的停点颜色」发布到这里；
 * StatusBarToneProbe（状态栏图标明暗）此前自己在 APK 里用 elementFromPoint
 * 于 y=27 采样——但 APK 内容层从 --app-sat（≈27~40px）才开始，y=27 命中的是
 * 出血根（恒白），黑底页采出「黑图标配黑条带」——「有的融合不进去」的另一半根因。
 * 现改读这里的条带停点（与条带同源同色），明暗永远与所见条带一致。
 * 网页端（sat=0 无条带）不发布，探针回落旧路径。
 */

export type BleedStop = { ratio: number; color: string };

let topStops: BleedStop[] = [];
const listeners = new Set<() => void>();

/** 条带组件采样完成后发布（浅拷贝隔离，防外部改动） */
export function publishBleedTopStops(stops: BleedStop[]): void {
  topStops = stops.slice();
  for (const l of listeners) l();
}

/** 当前顶部条带停点（无 = 网页端/尚未采样） */
export function getBleedTopStops(): BleedStop[] {
  return topStops;
}

/** 订阅条带更新（每次发布触发；探针借此即时重算基调） */
export function subscribeBleedTop(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
