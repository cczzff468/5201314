'use client';

/**
 * 真机 App 冻结到期守护（v2.2 需求四：AI 自定义锁定时长）。
 *
 * freezeRealApp 冻结真机应用时落 real-app-freeze 记录（unlockAt = AI 给的时长）；
 * 本守望者每 30s 检查一次到期情况：到点自动 pm unsuspend 解冻 + 清记录 +
 * 清同包名的 AI 网页冻结态。解冻失败（Shizuku 断连）下一轮重试，绝不丢。
 *
 * 挂载：PhoneShell watchersReady 区（解锁后空闲挂载，与其他 Watcher 同款生命周期）。
 */

import { useEffect } from 'react';
import { checkRealFreezeExpiry } from '@/lib/ios/real-app-freeze';

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
      await checkRealFreezeExpiry();
      if (stopped) return;
      timer = setTimeout(() => void loop(), TICK_MS);
    };

    timer = setTimeout(() => void loop(), FIRST_TICK_MS);

    // 页面回前台立即补一轮（后台定时器可能被节流漏掉）
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkRealFreezeExpiry();
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
