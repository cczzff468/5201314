'use client';

/**
 * 退群挽留全局调度器：挂在 PhoneShell（App 不打开也照常结算），每 5s 调一次 runQuitFlowTick：
 * - 退群快照（用户退出群聊时由 groups.ts 退群钩子写入）到点后，让群里最合适的一员按人设
 *   在 1 分钟窗口内主动私信机主（落入对应 App 的私聊，未读/预览自动刷新）；
 * - 私信后机主回复 → 私聊管线注入退群背景，AI 可按人设把人拉回群（quit-flow 模块执行）。
 * 联系人列表每分钟刷新一次（新好友自动纳入候选）。
 */

import { useEffect } from 'react';
import { listContacts } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { ensureQuitHook, runQuitFlowTick } from '@/lib/ios/quit-flow';
import { ensureGroupSocialHooks } from '@/lib/ios/group-social';

const TICK_MS = 5000;
const CONTACTS_REFRESH_MS = 60_000;

export default function QuitFlowScheduler() {
  useEffect(() => {
    let alive = true;
    let busy = false;
    let contacts: ContactRecord[] = [];
    let contactsAt = 0;

    // 退群钩子（幂等）：必须先于任何退群操作注册
    ensureQuitHook();
    // 群社交钩子（幂等）：AI 成员被踢 → 被踢通知；重新拉进群 → 回群感知
    ensureGroupSocialHooks();

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        const now = Date.now();
        if (contacts.length === 0 || now - contactsAt > CONTACTS_REFRESH_MS) {
          contacts = await listContacts().catch(() => contacts);
          contactsAt = now;
        }
        await runQuitFlowTick(contacts);
      } catch {
        // 挽留是增强能力，任何异常静默
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void tick(), TICK_MS);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
