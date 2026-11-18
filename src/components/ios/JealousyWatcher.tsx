'use client';

/**
 * 吃醋锁全局守望者（v1.9.19，v1.9.43 双通道调度）：驱动 jealousy-lock 的主 tick。
 *
 * - 首跳 12s（避开开机高峰），前台 30s 一轮；
 * - v1.9.43 节拍器升级为 Web Worker（jealousy-scheduler.worker）：主线程定时器退后台
 *   会被浏览器节流，Worker 的 interval 不受普通节流影响——页面在后台时依然准点
 *   敲钟唤醒主线程跑 tick（倒计时到点解锁/暗中观察/强解检测第一时间执行）；
 * - 主线程 setTimeout 循环保留为兜底（Worker 初始化失败/被 CSP 拦的极端环境照常跑，
 *   tickBusy 重入闸保证双通道不会双倍执行）；
 * - 页面回前台立即补一轮；tick 内部：原生守护事件回收 → 倒计时到点自动解锁（timeout）
 *   → Shizuku 断连补解锁 → 前台探测 → 三类触发判定 → AI 决策（LLM）→ 锁定剧情。
 *
 * 挂载：PhoneShell watchersReady 区（解锁后空闲挂载，与其他 Watcher 同款生命周期）。
 */

import { useEffect } from 'react';
import { runJealousyTick } from '@/lib/ios/jealousy-lock';
import { initWebUsageLedger } from '@/lib/ios/web-usage-ledger';
import { initAnxietyEvents } from '@/lib/ios/anxiety-events';

/** tick 间隔（前台 30s；Worker 与主线程兜底同节拍） */
const JEALOUSY_TICK_MS = 30_000;
/** 首跳延迟（避开开机高峰，与 ProactiveMsgWatcher 8s 错开） */
const FIRST_TICK_MS = 12_000;

/** 模块级单例守卫（React 严格模式/重复挂载防重入，ProactiveMsgWatcher 同款） */
let owned = false;

export default function JealousyWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // v1.9.28：网页虚拟使用时长账本（吃醋锁巡检的网页降级数据源；内部自带单例守卫）
    initWebUsageLedger();
    // v1.9.29：焦虑非时间事件引擎（论坛吃醋/朋友圈破防/刷App孤独；内部自带单例守卫）
    initAnxietyEvents();

    const loop = async () => {
      if (stopped) return;
      await runJealousyTick();
      if (stopped) return;
      timer = setTimeout(() => void loop(), JEALOUSY_TICK_MS);
    };

    timer = setTimeout(() => void loop(), FIRST_TICK_MS);

    // v1.9.43 Web Worker 准点调度（后台不被节流；失败静默走主线程兜底循环）
    let worker: Worker | null = null;
    let workerActive = false;
    try {
      worker = new Worker(new URL('@/lib/ios/jealousy-scheduler.worker.ts', import.meta.url));
      worker.onmessage = (ev: MessageEvent<string>) => {
        if (!workerActive) return;
        // 后台也照常跑（Worker 敲钟的意义所在）；tickBusy 重入闸防与主线程循环重入
        void runJealousyTick();
      };
      worker.onerror = () => {
        workerActive = false; // Worker 异常：退回纯主线程循环
      };
      worker.postMessage('ping'); // 冷启动探活（Worker 起来后收到 tick 才置活跃）
      workerActive = true;
    } catch {
      workerActive = false; // CSP/旧环境不支持 → 主线程循环兜底
    }

    // 页面回前台立即补一轮（倒计时到期第一时间解锁；探测即时恢复）
    const onVis = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        void runJealousyTick();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopped = true;
      owned = false;
      if (timer) clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return null;
}
