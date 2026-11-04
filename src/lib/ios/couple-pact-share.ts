'use client';

/**
 * 恋爱协议分享（第十二轮）——协议 ⇄ 微信/QQ 聊天卡片流。
 *
 * 用户规格：
 * - 协议可以分享给 AI（我拟的协议发到微信/QQ 会话，AI 决定签不签）；
 * - AI 也可以分享协议给我（AI 拟协议时自动发卡片，点卡片进情侣空间签署界面）；
 * - 分享协议在聊天界面是一张卡片，点击卡片进入签署协议界面。
 *
 * 实现模式（复用 couple-invite 的成熟管线）：
 * - 卡片注入：直写 `${app}-chat-msgs:${cid}`（按目标 App 账号作用域 kvGetScoped/kvSetScoped）
 *   + 恢复被隐藏会话 + 广播 COUPLE_CARD_EVENT（聊天页在场时实时合并上屏）+ 灵动岛通知 + 未读角标；
 * - 点击卡片 → 写 pendingPactOpen + 切进情侣空间 App → PactPage 消费后跳对应界面；
 * - 我分享给 AI → AI 延时决定签/不签（couple-ai.aiDecidePact），结果写回协议记录 + 记忆 + 通知。
 */

import { kvGet, kvGetScoped, kvSetScoped } from './idb-kv';
import { genId } from './db';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { COUPLE_CARD_EVENT, readInviteMeta, type CoupleChannel } from './couple-invite';

// ---------------- 类型 ----------------

/** 本地截断（避免为一个小工具引入 couple-ai 的内部依赖） */
function cut(s: string | undefined | null, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 恋爱协议卡片数据（挂在消息 pactcard 字段；微信/QQ 聊天共用） */
export interface CouplePactCardData {
  title: string; // 协议名
  preamble: string; // 协议声明（可空）
  clauses: string[]; // 条款（卡片展示前 2 条 + 共 N 条）
  from: 'me' | 'ta'; // 谁分享的（我发给 TA / TA 发给我）
  status: 'pending' | 'signed' | 'declined'; // pending=待对方签署 signed=已签署 declined=已婉拒
  fromName: string;
  toName: string;
  app: CoupleChannel; // 卡片所在渠道
  contactId: string; // 卡片所在会话的联系人 id
  pactId?: string; // 关联情侣空间里的协议记录 id（pacts 里）或 'ai'（TA 拟的草稿）
  reason?: string; // declined 时的理由（TA 说的）
  declinedBy?: 'me' | 'ta'; // 第二十三轮：谁拒绝的（我拒 TA 的协议 / TA 拒我的协议，卡片文案不同）
  taSigned?: boolean; // 第十六轮：TA 分享前已先签上自己的名字（等对方签）
  msgId?: string; // 卡片所在消息 id（签署完成后回写卡片状态用）
  at: number; // 分享时间
}

/** 点击卡片后的待打开协议（PactPage 消费）；第十五轮起携带卡片正文——TA 分享的 pending 卡无论 aiPact 是否存在都能直达签署界面；
 *  第十六轮起携带 taSigned（TA 已先签名）与卡片消息定位（签署完成后回写卡片「已签署」）；
 *  第十七轮起携带 signed（卡片/情侣空间存档已是已签署 → 点卡片直达已签署页面） */
interface PendingPactOpen {
  pactId?: string; // pacts 记录 id
  from: 'me' | 'ta'; // 卡片来源
  title?: string; // 卡片里的协议名
  preamble?: string; // 卡片里的协议声明
  clauses?: string[]; // 卡片里的条款
  taSigned?: boolean; // TA 是否已先签名
  signed?: boolean; // 第十七轮：卡片已是已签署状态（点开直达已签署页）
  msgId?: string; // 卡片消息 id
  channel?: CoupleChannel; // 卡片所在渠道
  contactId?: string; // 卡片所在会话
  at: number;
}

let pendingPactOpen: PendingPactOpen | null = null;

/** 聊天协议卡片点击 → 写待打开目标（切换 App 时带上；同 200ms 内重复点击去重） */
export function setPendingPactOpen(p: { pactId?: string; from: 'me' | 'ta'; title?: string; preamble?: string; clauses?: string[]; taSigned?: boolean; signed?: boolean; msgId?: string; channel?: CoupleChannel; contactId?: string }): void {
  pendingPactOpen = { ...p, at: Date.now() };
}

/** PactPage 挂载时消费待打开目标（读后即清） */
export function consumePendingPactOpen(): PendingPactOpen | null {
  const p = pendingPactOpen && Date.now() - pendingPactOpen.at < 60_000 ? pendingPactOpen : null;
  pendingPactOpen = null;
  return p;
}

// ---------------- 消息落库（微信/QQ 会话注入；与 couple-invite 同款管线） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行（与各端 saveMsgs 的真微信行为一致） */
function restoreHiddenChat(channel: CoupleChannel, contactId: string): void {
  try {
    const key = channel === 'wx' ? 'wx-chat-hidden' : 'qq-chat-hidden';
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x !== contactId);
    if (next.length === arr.length) return;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 隐藏列表读不到/写不进都不影响消息落库 */
  }
}

/** 灵动岛通知 + 未读角标（正在查看的会话不 bump，与主动消息口径一致） */
async function notifyCard(channel: CoupleChannel, contactId: string, body: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c) return;
    const notifyApp = channel === 'wx' ? ('wechat' as const) : ('qq' as const);
    pushChatNotification({
      sessionKey: `${channel}:${contactId}`,
      app: notifyApp,
      title: displayNameOf(c),
      avatar: avatarFor(c, channel),
      body,
      target: { app: notifyApp, contactId },
    });
    if (!isProactiveChatActive(channel, contactId)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contactId, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

/**
 * 把一份恋爱协议以卡片形式发进微信/QQ 会话。
 * dir='me'：我把协议分享给 TA（消息 role='me'，随后 AI 延时决定签/不签并回话）；
 * dir='ta'：TA（AI）把协议分享给我（消息 role='peer'，点卡片进签署界面；taSigned=true 表示 TA 已先签名）。
 * 返回卡片消息 id（签署完成后回写状态用；失败返回 null）。
 */
export async function sendPactCard(opts: {
  channel: CoupleChannel;
  contactId: string;
  title: string;
  preamble: string;
  clauses: string[];
  dir: 'me' | 'ta';
  pactId?: string;
  status?: 'pending' | 'signed' | 'declined';
  reason?: string;
  declinedBy?: 'me' | 'ta';
  taSigned?: boolean;
}): Promise<string | null> {
  const { channel, contactId, title, clauses, dir } = opts;
  if (!contactId || !title) return null;
  // 双方名字（渠道身份）：我 = 渠道账号社交名；TA = 联系人展示名
  let meName = '我';
  let taName = 'TA';
  try {
    const c = await getContact(contactId);
    if (c) taName = displayNameOf(c) || c.name || 'TA';
  } catch {
    /* 静默 */
  }
  try {
    const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    if (dir === 'me' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
    if (dir === 'ta' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'me' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
  } catch {
    /* 静默 */
  }
  const data: CouplePactCardData = {
    title,
    preamble: opts.preamble ?? '',
    clauses: (clauses ?? []).slice(0, 8),
    from: dir,
    status: opts.status ?? 'pending',
    fromName: dir === 'me' ? meName : taName,
    toName: dir === 'me' ? taName : meName,
    app: channel,
    contactId,
    pactId: opts.pactId,
    reason: opts.reason,
    declinedBy: opts.declinedBy,
    taSigned: opts.taSigned ?? false,
    at: Date.now(),
  };
  const msg = {
    id: genId(),
    role: dir === 'me' ? 'me' : 'peer',
    content: '',
    time: Date.now(),
    kind: 'pactcard',
    pactcard: data,
  };
  data.msgId = msg.id;
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
    list.push(msg);
    kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  restoreHiddenChat(channel, contactId);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响落库 */
  }
  const preview =
    dir === 'ta'
      ? opts.taSigned
        ? `我签好名的恋爱协议《${title}》发给你了，就等你签啦`
        : `给你分享了一份恋爱协议《${title}》，点击看看`
      : `我给你发了一份恋爱协议《${title}》，等你签名哦`;
  void notifyCard(channel, contactId, preview);
  return msg.id;
}

/** 更新某条协议卡片的状态（AI 签/拒后；直写落库，广播让聊天页刷新同 id 消息） */
export function patchPactCardInMsgs(channel: CoupleChannel, contactId: string, msgId: string, patch: Partial<CouplePactCardData>): void {
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    if (!Array.isArray(raw)) return;
    const list = raw.map((m) => {
      const x = m as { id?: unknown; pactcard?: unknown };
      if (x && x.id === msgId && x.pactcard && typeof x.pactcard === 'object') {
        return { ...x, pactcard: { ...(x.pactcard as Record<string, unknown>), ...patch } };
      }
      return x;
    });
    kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响 */
  }
}

/**
 * 按条件批量更新会话里的协议卡片状态（第十六轮：双方签完 → 卡片回写「已签署」）。
 * 返回命中的条数；有命中才落库 + 广播刷新。
 */
export function patchPactCardsWhere(channel: CoupleChannel, contactId: string, match: (d: CouplePactCardData) => boolean, patch: Partial<CouplePactCardData>): number {
  const key = msgsKey(channel, contactId);
  let hit = 0;
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    if (!Array.isArray(raw)) return 0;
    const list = raw.map((m) => {
      const x = m as { pactcard?: unknown };
      if (x && x.pactcard && typeof x.pactcard === 'object') {
        const d = x.pactcard as CouplePactCardData;
        if (match(d)) {
          hit++;
          return { ...x, pactcard: { ...d, ...patch } };
        }
      }
      return m;
    });
    if (hit > 0) kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  if (hit > 0) {
    try {
      window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
    } catch {
      /* 广播失败不影响 */
    }
  }
  return hit;
}

/**
 * 我把协议分享给 AI 后：AI 延时决定签/不签/改其中一条（第十五轮：他可以不同意或改某一条）。
 * 结果 = { agree, reason, say, changeIdx?, changeTo? }，由调用方写回协议记录；聊天回复用 AI 自己生成的 say（第十六轮：不再用模板），
 * say 失败才回退到最简兜底语。AI 调用失败也兜底回调（agree=true），保证调用方 loading 态一定解除。
 */
export function scheduleAiPactDecision(opts: {
  channel: CoupleChannel;
  contactId: string;
  title: string;
  clauses: string[];
  onDone: (r: { agree: boolean; reason: string; say?: string; changeIdx?: number; changeTo?: string }) => void;
}): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { aiDecidePact } = await import('./couple-ai');
        const r = await aiDecidePact(opts.title, opts.clauses);
        // 第二十四轮：TA 的回复只发 AI 自己说的话（人设/记忆/聊天上下文生成）；生成失败就不发文字消息（只回写卡片状态），不再落模板话术
        const reply = r.say && r.say.trim().length >= 4 ? r.say.trim() : '';
        if (reply) {
          const key = msgsKey(opts.channel, opts.contactId);
          try {
            const raw = kvGetScoped<unknown[]>(key, opts.channel);
            const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
            list.push({
              id: genId(),
              role: 'peer',
              content: reply,
              time: Date.now(),
            });
            kvSetScoped(key, list, opts.channel);
          } catch {
            /* 静默 */
          }
          try {
            window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: opts.contactId, app: opts.channel } }));
          } catch {
            /* 静默 */
          }
        }
        void notifyCard(opts.channel, opts.contactId, r.agree ? `你的协议我签好啦` : `关于那份协议，我想跟你商量一条`);
        opts.onDone(r);
      } catch {
        opts.onDone({ agree: true, reason: '条款我都喜欢' }); // 兑底：不让调用方永远转圈
      }
    })();
  }, 5000 + Math.random() * 6000);
}

/** 供测试/兜底：读当前待打开协议（不清除） */
export function peekPendingPactOpen(): PendingPactOpen | null {
  return pendingPactOpen;
}

/** 聊天协议卡片点击后的导航事件名（CoupleSpaceApp 监听 → openSub('pact')） */
export const COUPLE_PACT_NAV_EVENT = 'couple-pact-nav';

/**
 * 聊天里的协议卡片被点击：记下待打开目标（含卡片正文/TA 是否已先签名/卡片消息定位）+ 切进情侣空间 + 广播导航事件。
 * （气泡组件调用；CoupleSpaceApp 收到事件后 openSub('pact')，PactPage 挂载后 consumePendingPactOpen 直达签署界面）
 */
export function navToPact(p: { pactId?: string; from: 'me' | 'ta'; title?: string; preamble?: string; clauses?: string[]; taSigned?: boolean; signed?: boolean; msgId?: string; channel?: CoupleChannel; contactId?: string }): void {
  setPendingPactOpen(p);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_PACT_NAV_EVENT, { detail: p }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}
