'use client';

/**
 * 淘宝运输快递员形象（我的淘宝-快递员可选；物流地图巡航用，独立于美团骑手体系）：
 * public/couriers 已去白边/浅蓝底透明 PNG（scripts/process-couriers.py 处理），
 * 并按用户需求水平翻转统一朝右（bunny/polarbear/duck/redcat/pinkcat/bluebear/rabbit
 * 原 PNG 朝左已镜像；truck/rainbear 原生朝右未动）——物流地图巡航方向左→右，朝右更自然。
 * 立体感由展示侧 drop-shadow + 颠簸动画提供。默认「运输车」。
 */

export interface TbCourier {
  id: string;
  name: string;
  src: string;
}

export const TB_COURIERS: TbCourier[] = [
  { id: 'truck', name: '运输车', src: '/couriers/truck.png' },
  { id: 'bunny', name: '橙兔摩托', src: '/couriers/bunny.png' },
  { id: 'rainbear', name: '雨天熊熊', src: '/couriers/rainbear.png' },
  { id: 'polarbear', name: '白熊小哥', src: '/couriers/polarbear.png' },
  { id: 'duck', name: '鸭鸭三轮', src: '/couriers/duck.png' },
  { id: 'redcat', name: '红帽咪咪', src: '/couriers/redcat.png' },
  { id: 'pinkcat', name: '粉车咪咪', src: '/couriers/pinkcat.png' },
  { id: 'bluebear', name: '蓝车熊熊', src: '/couriers/bluebear.png' },
  { id: 'rabbit', name: '帽帽兔', src: '/couriers/rabbit.png' },
];

export const TB_COURIER_CHANGED = 'tb-courier-changed';

const TB_COURIER_KEY = 'tb-courier-id';

export function tbGetCourierId(): string {
  try {
    return localStorage.getItem(TB_COURIER_KEY) ?? TB_COURIERS[0].id;
  } catch {
    return TB_COURIERS[0].id;
  }
}

export function tbSetCourierId(id: string): void {
  try {
    localStorage.setItem(TB_COURIER_KEY, id);
  } catch {
    /* 隐私模式忽略 */
  }
  try {
    window.dispatchEvent(new CustomEvent(TB_COURIER_CHANGED, { detail: { id } }));
  } catch {
    /* 忽略 */
  }
}

export function tbCourierSrcOf(id: string): string {
  return (TB_COURIERS.find((c) => c.id === id) ?? TB_COURIERS[0]).src;
}

export function tbCourierNameOf(id: string): string {
  return (TB_COURIERS.find((c) => c.id === id) ?? TB_COURIERS[0]).name;
}

/** 当前选中的运输快递员（快捷取整个对象） */
export function tbCurrentCourier(): TbCourier {
  return TB_COURIERS.find((c) => c.id === tbGetCourierId()) ?? TB_COURIERS[0];
}
