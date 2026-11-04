'use client';

/**
 * AI 主动发消息全局调度器（Task 49）——PhoneShell 挂载，App 不打开也生效：
 * 递归 setTimeout 每 10s 调 runProactiveMsgTick()（定时/事件/提醒/自主四类触发判定+投递）。
 * 模式与 ProactiveCallWatcher 同款：模块级单例 flag 防重复挂载，异常静默（后台增强能力）。
 */

import { useEffect } from 'react';
import { runProactiveMsgTick, getProactiveMsgTickParams } from '@/lib/ios/proactive-msg';

let owned = false;

export default function ProactiveMsgWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let timer: number | null = null;
    const schedule = (delay: number): void => {
      timer = window.setTimeout(() => {
        void runProactiveMsgTick();
        schedule(getProactiveMsgTickParams().interval);
      }, delay);
    };
    // 首跳 8s：等 IndexedDB kv 预热（idb-kv 启动装载）后进入常规节奏
    schedule(8_000);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      owned = false;
    };
  }, []);
  return null;
}
