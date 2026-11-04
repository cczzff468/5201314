'use client';

/**
 * 朋友圈/QQ动态 全局调度器：挂在 PhoneShell（App 不打开也照常结算），每 5s 调一次 runMomentsTick：
 * - 结算延迟队列：用户动态的 AI 互动（1-2 位好友点赞/评论）+ 用户回复 AI 评论后的多轮再回复（重启不丢）；
 * - 自动发布：每角色×平台的三种触发（定时 / 频率 / 聊天灵感），内容由 AI 按人设生成，失败退避重试。
 *
 * 机主展示名从各平台登录态推导（localStorage 会话 id → 联系人 → displayNameOf），
 * 与朋友圈/QQ 发动态时写入的 authorName 同源，保证调度器写入的数据和 App 内一致；
 * 联系人列表每分钟刷新一次（新加好友自动纳入调度）。
 */

import { useEffect } from 'react';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { accLs } from '@/lib/ios/accounts';
import { listContacts } from '@/lib/ios/contacts-store';
import { useSettings } from '@/lib/ios/store';
import { repairLegacyMomentData, repairMomentIdentityData, runMomentsTick, stripMomentAvatarSnapshots, type MomentTickDeps } from '@/lib/moments';

const TICK_MS = 5000;
const CONTACTS_REFRESH_MS = 60_000;

/** 登录会话 → 机主展示名（与微信/QQ App 内 me.name 同源；未登录返回空串跳过该平台）。
 *  A2 账号盲区修复：会话键经 accLs 账号作用域读取（此前裸键 wx-session-user-id 恒存最后一次
 *  大号会话——小号激活时调度器拿大号名/空：AI 自动评论用大号身份称呼小号用户、小号朋友圈
 *  自动互动全停；accLs 大号返回原键，存量行为无缝兼容） */
function sessionName(contacts: ContactRecord[], app: 'wx' | 'qq'): string {
  try {
    const lsKey = accLs(`${app}-session-user-id`, app);
    const id = window.localStorage.getItem(lsKey);
    if (!id) return '';
    const hit = contacts.find((c) => c.id === id && c.kind === 'user');
    return hit ? displayNameOf(hit) : '';
  } catch {
    return '';
  }
}

export default function MomentsScheduler() {
  useEffect(() => {
    let alive = true;
    let busy = false;
    let contacts: ContactRecord[] = [];
    let contactsAt = 0;

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        const now = Date.now();
        if (contacts.length === 0 || now - contactsAt > CONTACTS_REFRESH_MS) {
          contacts = await listContacts().catch(() => contacts);
          contactsAt = now;
        }
        const deps: MomentTickDeps = {
          apiConfig: useSettings.getState().apiConfig,
          contacts,
          wxUserName: sessionName(contacts, 'wx'),
          qqUserName: sessionName(contacts, 'qq'),
        };
        await runMomentsTick(deps);
      } catch {
        // 动态是增强能力，任何异常静默（内部已有重试/退避）
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void tick(), TICK_MS);
    // 旧版遗留数据修复（AI「回复自己」的错误指向）：一次性执行，幂等
    repairLegacyMomentData();
    // 身份关系修复（「AI 自己给自己评论」历史数据清理 + 记忆里错误关系纠错）：一次性执行，幂等
    void repairMomentIdentityData();
    // 存量头像快照瘦身（引用式架构：头像只在联系人资料存一份，渲染实时解析；
    // 历史快照对在册联系人是纯冗余，一次性清掉省空间；幂等）
    void stripMomentAvatarSnapshots();
    void tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
