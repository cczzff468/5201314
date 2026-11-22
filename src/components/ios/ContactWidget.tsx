'use client';

/**
 * 快捷联系人小组件（主屏 2×2 方格 ≈159×168，iOS「联系人/信息」小组件样式）：
 * - TA = 主联系人/恋人角色：情侣空间绑定（couple-space:state 的 partnerContactId）优先，
 *   没有绑定回退第一个 CHAR 角色（恋人 AI 主联系人）；完全没有时给优雅空态（默认头像 +
 *   「还没有联系人」，点击经 HomeScreen 外层回退打开联系人 App 去创建）；
 * - 头像走现有联系人头像体系（信息 App sms 槽位优先、回退全局默认，avatarFor 口径——
 *   listContactsFor('sms') 已做投影）；无头像用 DefaultAvatar 现成方案；
 * - 名字用信息 App 展示名（昵称优先，displayNameOf(c,'sms')），副行展示关系标签（relation）；
 * - 「发消息」快捷胶囊：整卡点击由 HomeScreen 的 WIDGET_META 通道接管——
 *   setPendingChatContact(TA) + 打开信息 App，直达与 TA 的会话（与电话 App 详情页
 *   「信息」按钮完全同一条跳转链路，不新建通道）；
 * - 数据经 contacts-store 读取（localDB 'contacts'，与联系人/信息/电话四 App 同一份本地数据）；
 *   模块级共享快照（useTaContact）：主屏点击句柄与组件展示共用一份数据，订阅期间每 60s
 *   静默对账一次（联系人 App 里改了头像/关系，回到主屏最多一分钟内自动跟上）。
 */

import { useSyncExternalStore } from 'react';
import { MessageCircle } from 'lucide-react';
import { listContactsFor } from '@/lib/ios/contacts-store';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { DefaultAvatar } from '@/components/apps/default-avatar';

/** TA 快照：state=loading 时首帧不闪空态（首次联系人读取中） */
export interface TaSnapshot {
  state: 'loading' | 'ready';
  contact: ContactRecord | null;
}

/** SSR/水合期常量快照（getServerSnapshot 必须返回稳定引用） */
const TA_SERVER_SNAPSHOT: TaSnapshot = { state: 'loading', contact: null };

let taSnap: TaSnapshot = TA_SERVER_SNAPSHOT;
let taRequested = false;
let taTimer: number | null = null;
const taListeners = new Set<() => void>();

function emitTa(): void {
  for (const l of taListeners) l();
}

/** 解析 TA（主联系人/恋人角色）：情侣空间绑定优先 → 第一个 CHAR 角色 → null */
async function resolveTa(): Promise<ContactRecord | null> {
  try {
    // 信息 App 投影：头像已按 sms 槽位替换（无槽位回退全局默认）
    const list = await listContactsFor('sms');
    const partnerId = readInviteMeta().partnerContactId;
    if (partnerId) {
      const byId = list.find((c) => c.id === partnerId && c.kind !== 'user');
      if (byId) return byId;
    }
    return list.find((c) => c.kind === 'char') ?? null;
  } catch {
    return null;
  }
}

/** 轻量对账：仅在 TA 身份/头像/名字/关系实际变化时广播（避免无谓重渲染） */
async function refreshTa(): Promise<void> {
  const next = await resolveTa();
  const prev = taSnap.contact;
  const same =
    prev === next ||
    (prev && next
      ? prev.id === next.id &&
        prev.avatar === next.avatar &&
        prev.nickname === next.nickname &&
        prev.name === next.name &&
        (prev.relation ?? '') === (next.relation ?? '')
      : false);
  if (!same) {
    taSnap = { state: 'ready', contact: next };
    emitTa();
  }
}

function ensureTaLoaded(): void {
  if (taRequested) return;
  taRequested = true;
  void (async () => {
    const contact = await resolveTa();
    taSnap = { state: 'ready', contact };
    emitTa();
  })();
}

function subscribeTa(onChange: () => void): () => void {
  taListeners.add(onChange);
  ensureTaLoaded();
  // 首个订阅者挂 60s 对账计时器（换头像/改关系后主屏自动跟上），最后一个退订时摘掉
  if (taTimer === null) {
    taTimer = window.setInterval(() => void refreshTa(), 60_000);
  }
  return () => {
    taListeners.delete(onChange);
    if (taListeners.size === 0 && taTimer !== null) {
      window.clearInterval(taTimer);
      taTimer = null;
    }
  };
}

/** TA 快照订阅（主屏点击句柄与小组件展示共用同一份数据） */
export function useTaContact(): TaSnapshot {
  return useSyncExternalStore(
    subscribeTa,
    () => taSnap,
    () => TA_SERVER_SNAPSHOT
  );
}

/** TA 展示名（信息 App 口径：昵称优先，回退真名；无 TA 返回空串） */
export function taNameOf(c: ContactRecord | null): string {
  return c ? displayNameOf(c, 'sms') || c.name : '';
}

/**
 * 可视内容（159×168 白卡/深色黑卡）：居中圆头像 + 名字 + 关系副行 + 底部绿色
 * 「发消息」胶囊（视觉引导，整卡点击由 HomeScreen 外层 WIDGET_META 通道接管）。
 * 空态：默认头像 + 「还没有联系人」+ 引导文案（点击回退打开联系人 App）。
 */
export function ContactWidget({ testId }: { testId?: string }) {
  const ta = useTaContact();
  const contact = ta.contact;
  const name = taNameOf(contact);
  const relation = contact?.relation?.trim() || '';

  return (
    <div
      {...(testId ? { 'data-testid': testId } : { 'data-testid': 'contact-widget' })}
      className="flex h-[168px] w-full select-none flex-col items-center overflow-hidden rounded-[24px] bg-white/95 px-3 pb-[14px] pt-[16px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      {/* 头像：联系人头像体系（sms 槽位优先）；无头像走默认剪影 */}
      {contact?.avatar ? (
        <img
          src={contact.avatar}
          alt={`${name}的头像`}
          draggable={false}
          className="h-[58px] w-[58px] shrink-0 select-none rounded-full object-cover ring-1 ring-black/10 dark:ring-white/15"
        />
      ) : (
        <DefaultAvatar size={58} className="ring-1 ring-black/10 dark:ring-white/15" />
      )}
      {/* 名字 + 关系副行（首帧 loading 时不闪空态文案） */}
      <p className="mt-[9px] max-w-full truncate text-[14px] font-bold leading-[16px] text-[#161618] dark:text-white">
        {ta.state === 'loading' ? '' : contact ? name : '还没有联系人'}
      </p>
      <p className="mt-[3px] max-w-full truncate text-[11px] font-medium leading-[12px] text-black/40 dark:text-white/45">
        {ta.state === 'loading'
          ? ''
          : contact
            ? relation || contact.phone || '快捷聊天'
            : '去联系人 App 添加 TA'}
      </p>
      {/* 底部「发消息」胶囊（绿色引导，非独立按钮——整卡即触控目标） */}
      {contact && (
        <span
          aria-hidden="true"
          className="mt-auto flex h-[32px] shrink-0 items-center gap-[6px] rounded-full bg-[#34C759] px-[14px] text-[13px] font-semibold text-white shadow-[0_2px_10px_rgba(52,199,89,0.4)]"
        >
          <MessageCircle className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
          发消息
        </span>
      )}
    </div>
  );
}
