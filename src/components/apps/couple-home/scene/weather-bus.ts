/**
 * 拾光小屋 · 天气总线（v10 / v11 季节）
 *
 * 极简模块级可变单例：HomeScene 每帧/每变更写入，TV3D 天气台、花园等
 * 深层组件直接读取，避免 props 逐层穿透与跨文件接线冲突。
 * 纯内存（不持久化）—— 天气本身就是实时计算的。
 */

import type { HomeWeather } from '../types';

const state: { weather: HomeWeather; night: boolean } = { weather: 'sunny', night: false };

/** 写入当前室外天气（HomeScene 调用） */
export function weatherBusSet(weather: HomeWeather, night: boolean): void {
  state.weather = weather;
  state.night = night;
}

/** 读取当前室外天气（TV 天气台 / 花园 / AI 决策等调用） */
export function weatherBusGet(): { weather: HomeWeather; night: boolean } {
  return state;
}

// ---------------- v11 G3 四季 ----------------

/** 季节（按真实日期月份划分；驱动草地/窗景/季节粒子/积雪） */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * 当前季节：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬。
 * 可传 date 便于测试与回放（缺省取系统当前时间）。
 */
export function seasonNow(date?: Date): Season {
  const m = (date ?? new Date()).getMonth() + 1; // 1~12
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
