'use client';

/**
 * 美团骑手形象（「我的-骑手」可选；配送地图巡航 + 灵动岛小窗共用）：
 * public/mt/riders 已去白边透明 PNG，选中 id 持久化在 localStorage。
 * 朝向按用户需求统一：懒懒r11/一二r15/布布r16/兔兔r17/咻咻r19/哭哭r20/咪咪r21 原 PNG 朝左
 * 已水平镜像成朝右；其余骑手原生朝向未动。
 * 独立成模块供 meituan.tsx（App 内）与 MeituanIsland.tsx（全局灵动岛）双端引用，
 * 避免灵动岛反向依赖整个 App 组件。
 */

export interface MtRider {
  id: string;
  name: string;
  src: string;
}

/** 内置可选骑手形象（默认圆圆；r18-r22 为本轮新增） */
export const MT_RIDERS: MtRider[] = [
  { id: 'r4', name: '圆圆', src: '/mt/riders/r4.png' },
  { id: 'r7', name: '蹦蹦', src: '/mt/riders/r7.png' },
  { id: 'r1', name: '呜呜', src: '/mt/riders/r1.png' },
  { id: 'r2', name: '惬惬', src: '/mt/riders/r2.png' },
  { id: 'r3', name: '蓝蓝', src: '/mt/riders/r3.png' },
  { id: 'r5', name: '帽帽', src: '/mt/riders/r5.png' },
  { id: 'r6', name: '萝卜', src: '/mt/riders/r6.png' },
  { id: 'r8', name: '瘫瘫', src: '/mt/riders/r8.png' },
  { id: 'r9', name: '屁屁', src: '/mt/riders/r9.png' },
  { id: 'r10', name: '钱钱', src: '/mt/riders/r10.png' },
  { id: 'r11', name: '懒懒', src: '/mt/riders/r11.png' },
  { id: 'r12', name: '笑笑', src: '/mt/riders/r12.png' },
  { id: 'r13', name: '馋馋', src: '/mt/riders/r13.png' },
  { id: 'r14', name: '嗨嗨', src: '/mt/riders/r14.png' },
  { id: 'r15', name: '一二', src: '/mt/riders/r15.png' },
  { id: 'r16', name: '布布', src: '/mt/riders/r16.png' },
  { id: 'r17', name: '兔兔', src: '/mt/riders/r17.png' },
  { id: 'r18', name: '笨笨', src: '/mt/riders/r18.png' },
  { id: 'r19', name: '咻咻', src: '/mt/riders/r19.png' },
  { id: 'r20', name: '哭哭', src: '/mt/riders/r20.png' },
  { id: 'r21', name: '咪咪', src: '/mt/riders/r21.png' },
  { id: 'r22', name: '咩咩', src: '/mt/riders/r22.png' },
];

const MT_RIDER_KEY = 'mt-rider-avatar';

export function mtGetRiderId(): string {
  try {
    return localStorage.getItem(MT_RIDER_KEY) ?? MT_RIDERS[0].id;
  } catch {
    return MT_RIDERS[0].id;
  }
}

export function mtSetRiderId(id: string): void {
  try {
    localStorage.setItem(MT_RIDER_KEY, id);
  } catch {
    /* 隐私模式忽略 */
  }
}

export function mtRiderSrcOf(id: string): string {
  return (MT_RIDERS.find((r) => r.id === id) ?? MT_RIDERS[0]).src;
}

/** 当前选中骑手形象（快捷取整个对象） */
export function mtCurrentRider(): MtRider {
  return MT_RIDERS.find((r) => r.id === mtGetRiderId()) ?? MT_RIDERS[0];
}
