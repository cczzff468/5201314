'use client';

/**
 * AI 主动发消息全局调度器（Task 49）——PhoneShell 挂载，App 不打开也生效：
 * 递归 setTimeout 每 10s 调 runProactiveMsgTick()（定时/事件/提醒/自主四类触发判定+投递）。
 * 模式与 ProactiveCallWatcher 同款：模块级单例 flag 防重复挂载，异常静默（后台增强能力）。
 *
 * v80 后台保活双通道：设置开了「后台保活」时，keepalive 的 Worker 心跳（3s 敲钟，
 * 不受后台定时器节流）驱动第二通道跑同一份 maybeRun——页面切后台/锁屏后主动消息
 * 照常 5s 级判定投递；两通道共用 lastRun 节奏闸（距上次运行 ≥ interval 才跑），不会双发。
 */

import { useEffect } from 'react';
import { runProactiveMsgTick, getProactiveMsgTickParams } from '@/lib/ios/proactive-msg';
import { onKeepAliveTick } from '@/lib/ios/keepalive';

let owned = false;

export default function ProactiveMsgWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let timer: number | null = null;
    let lastRun = Date.now();
    /** 节奏闸（双通道共用）：距上次运行 ≥ tick 间隔才跑——Worker 心跳与 setTimeout 链不会双发 */
    const maybeRun = (): void => {
      if (Date.now() - lastRun < getProactiveMsgTickParams().interval) return;
      lastRun = Date.now();
      void runProactiveMsgTick();
    };
    const schedule = (delay: number): void => {
      timer = window.setTimeout(() => {
        maybeRun();
        schedule(getProactiveMsgTickParams().interval);
      }, delay);
    };
    // 首跳 8s：等 IndexedDB kv 预热（idb-kv 启动装载）后进入常规节奏
    schedule(8_000);
    // v80 后台保活第二通道：保活开启时 Worker 每 3s 敲钟唤醒（后台不被节流）；未开启时不触发
    const offKeepAliveTick = onKeepAliveTick(maybeRun);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      offKeepAliveTick();
      owned = false;
    };
  }, []);
  return null;
}
