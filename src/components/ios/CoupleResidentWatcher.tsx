'use client';

/**
 * 情侣空间 AI 常驻调度器（第十四轮用户反馈：自主决策链刷新即断 → 手机开机就常驻调度）：
 * - PhoneShell 挂载，App 不打开也生效；每 60s 自检一次（首跳 10s 等 IndexedDB kv 预热）；
 * - 已建立恋人关系时调 runCoupleAiTick（内部按「联系人+日期」幂等：同一天重复调用只会
 *   补挂想你/浇树的无害定时器——tick 内部有当日去重；跨天 schedKey 变化自动起新链）；
 * - 页面刷新/重开手机后调度器随壳重建 → 决策链自动续上，不再依赖先打开情侣空间。
 * 模式与 ProactiveMsgWatcher 同款：模块级单例 flag 防重复挂载，异常静默（后台增强能力）。
 */

import { useEffect } from 'react';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import { runCoupleAiTick, runRoutineNudgeTick } from '@/lib/ios/couple-ai';

let owned = false;

export default function CoupleResidentWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let disposed = false;
    const kick = (): void => {
      try {
        const meta = readInviteMeta();
        if (meta.partnerContactId) runCoupleAiTick(meta.partnerApp ?? 'wx', meta.partnerContactId);
      } catch {
        /* 后台增强能力：任何异常静默 */
      }
      // 第十六轮：作息提醒（早安/晚安/饭点；有恋人绑定才发，画像未成型自然不发）
      try {
        runRoutineNudgeTick();
      } catch {
        /* 静默 */
      }
    };
    const first = window.setTimeout(() => {
      if (!disposed) kick();
    }, 10_000);
    const timer = window.setInterval(() => {
      if (!disposed) kick();
    }, 60_000);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      owned = false;
    };
  }, []);
  return null;
}
