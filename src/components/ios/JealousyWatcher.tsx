'use client';

/**
 * 吃醋锁全局守望者（v1.9.19）：驱动 jealousy-lock 的主 tick。
 *
 * - 首跳 12s（避开开机高峰），前台 30s 一轮；
 * - 页面退后台时浏览器把 setTimeout 节流到 ~1 分钟——依然满足需求
 *   「实时（或每隔 5 分钟）获取前台应用」的粒度，无需额外通道；
 * - tick 内部：倒计时到点自动解锁（timeout）→ Shizuku 断连补解锁 → 前台探测 →
 *   三类触发判定（连续娱乐/说去看剧后消失/焦虑阈值）→ AI 决策（LLM）→ 锁定剧情。
 *
 * 挂载：PhoneShell watchersReady 区（解锁后空闲挂载，与其他 Watcher 同款生命周期）。
 */

import { useEffect } from 'react';
import { runJealousyTick } from '@/lib/ios/jealousy-lock';

/** tick 间隔（前台 30s；后台被节流到 ~1min 也够用） */
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

    const loop = async () => {
      if (stopped) return;
      await runJealousyTick();
      if (stopped) return;
      timer = setTimeout(() => void loop(), JEALOUSY_TICK_MS);
    };

    timer = setTimeout(() => void loop(), FIRST_TICK_MS);

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
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return null;
}
