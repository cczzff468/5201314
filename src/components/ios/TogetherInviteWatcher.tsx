'use client';

/**
 * AI 邀请一起听全局调度器（Task 68）——PhoneShell 挂载，App 不打开也生效：
 * 递归 setTimeout 每 60s 调 runTogetherInviteTick()（互斥守卫 → 选角色 → 挑歌 → 弹全局卡）。
 * 模式与 ProactiveMsgWatcher 同款：模块级单例 flag 防重复挂载，异常静默（后台增强能力）。
 */

import { useEffect } from 'react';
import { runTogetherInviteTick } from '@/lib/ios/together-invite';

let owned = false;

export default function TogetherInviteWatcher() {
  useEffect(() => {
    if (owned) return;
    owned = true;
    let timer: number | null = null;
    const schedule = (delay: number): void => {
      timer = window.setTimeout(() => {
        void runTogetherInviteTick();
        schedule(60_000);
      }, delay);
    };
    // 首跳 25s：等 IndexedDB kv 预热 + 联系人库就绪
    schedule(25_000);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      owned = false;
    };
  }, []);
  return null;
}
