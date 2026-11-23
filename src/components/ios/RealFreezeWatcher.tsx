'use client';

/**
 * 真机 App 冻结到期守护（v2.2 需求四：AI 自定义锁定时长；v2.2.0 拦截信号 drain）。
 *
 * freezeRealApp 冻结真机应用时落 real-app-freeze 记录（unlockAt = AI 给的时长）；
 * 本守望者每 30s 两件事：
 * ① 到期检查：到点自动解锁真机应用 + 清记录 + 清同包名的 AI 网页冻结态；
 *   解锁失败（桥断连）下一轮重试，绝不丢。
 * ② 拦截事件 drain（v2.2.0 需求三：AI 感知强行突破）：TA 反复手贱点被锁 App →
 *   原生守护每次拦截都落盘 lock-attempt → 这里取走并驱动 AI 按人设发质问消息。
 *
 * 挂载：PhoneShell watchersReady 区（解锁后空闲挂载，与其他 Watcher 同款生命周期）。
 */

import { useEffect } from 'react';
import { checkRealFreezeExpiry, drainRealFreezeGuardEvents } from '@/lib/ios/real-app-freeze';

/** tick 间隔（与吃醋锁守望者同节拍） */
const TICK_MS = 30_000;
/** 首跳延迟（避开开机高峰） */
const FIRST_TICK_MS = 18_000;

/** 模块级单例守卫（React 严格模式/重复挂载防重入） */
let owned = false;

export default function RealFreezeWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (stopped) return;
      // ① 到期解锁；② 拦截事件 drain → AI 反应（两件都静默容错）
      await Promise.allSettled([checkRealFreezeExpiry(), drainRealFreezeGuardEvents()]);
      if (stopped) return;
      timer = setTimeout(() => void loop(), TICK_MS);
    };

    timer = setTimeout(() => void loop(), FIRST_TICK_MS);

    // 页面回前台立即补一轮（后台定时器可能被节流漏掉）
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkRealFreezeExpiry();
        void drainRealFreezeGuardEvents();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      owned = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
