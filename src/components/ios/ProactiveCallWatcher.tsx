'use client';

/**
 * AI 主动来电全局调度器（PhoneShell 挂载，仿 ReminderWatcher / QuitFlowScheduler 的
 * 「懒加载挂载即后台运行」模式；本组件无 UI，只负责定时驱动 tick）：
 *
 * - 首次延迟 60s（避开开机风暴：等 IndexedDB 注水与各模块就绪），之后每 90s + 0~30s 随机抖动
 *   调一次 runProactiveCallTick()（抖动防多端/整点齐刷刷；后台标签页被浏览器节流到 1/min
 *   仍在量级内，tick 内部自带开关/深夜/冷却多道闸，多跑无害）；
 * - 页面可见性不做特殊处理：tick 内自查（后台照常尝试——真实手机来电不看屏幕）；
 * - 模块级单例 flag 防双实例（重复挂载只保留一份定时器链），卸载清定时器并释放
 *   （StrictMode 双挂载：卸载时释放后重挂可正常接管）。
 */

import { useEffect } from 'react';
import {
  getProactiveTickParams,
  runProactiveCallTick,
} from '@/lib/ios/proactive-call';

/** 模块级单例：true = 已有实例持有定时器链 */
let owned = false;

/** AI 主动来电定时调度（无 UI） */
export default function ProactiveCallWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;

    let timer: number | null = null;
    /** 递归 setTimeout（而非固定 setInterval）：每次 tick 后按档位当前值 + 抖动 重新排程。
     *  动态读取参数：用户在设置页切换「主动来电频率」档位后，下次 tick 即用新间隔（切档即时生效）。 */
    const schedule = (delay: number): void => {
      timer = window.setTimeout(() => {
        void runProactiveCallTick();
        const { interval, jitter } = getProactiveTickParams();
        schedule(interval + Math.floor(Math.random() * jitter));
      }, delay);
    };
    schedule(getProactiveTickParams().firstDelay);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      owned = false; // 释放给下一个挂载实例（StrictMode 双挂载也能正常续上）
    };
  }, []);

  return null;
}
