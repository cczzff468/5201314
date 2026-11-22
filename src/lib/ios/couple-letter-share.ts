'use client';

/**
 * 情书信封卡片分享（第十八轮）——情书 ⇄ 微信/QQ 聊天卡片流。
 *
 * 用户规格（第七批）：
 * - 未来情书改为「情书」，写完可以分享给 AI（AI 知道信里的内容）；
 * - AI 会根据人设记忆+上下文在信下面写留言，也可以给我回信；
 * - AI 也会主动给我写信，分享过来是一张信封卡片，点击卡片直接进入信件页面（不进情侣空间主页）；
 * - 分享时可以选择 QQ/微信，然后再选择联系人（通用分享选择器，调用方负责）。
 *
 * 实现模式（复用 couple-pact-share / couple-exam-share 的成熟管线）：
 * - 卡片注入：直写 `${app}-chat-msgs:${cid}`（kvGetScoped/kvSetScoped）+ 恢复隐藏会话 +
 *   广播 COUPLE_CARD_EVENT（聊天页实时合并上屏）+ 灵动岛通知 + 未读角标；
 * - 点击卡片 → 写 pendingLetterOpen + 切进情侣空间 App → LettersPage 消费后直达信件详情页；
 * - 我分享给 AI → AI 延时读信：在信下留言 + 写一封回信（回信也发信封卡片）——scheduleAiLetterFeedback。
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

/** 本地截断（避免引入 couple-ai 内部依赖） */
function cut(s: string | undefined | null, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 情书信封卡片数据（挂在消息 lettercard 字段；微信/QQ 聊天共用） */
export interface CoupleLetterCardData {
  letterId: string; // 情侣空间里的信 id（我的信在 letters / TA 的信在 aiLetters）
  envelope: string; // 信封样式 key（点击卡片进详情按此渲染）
  envText?: string; // 信封收信字样（第二十九轮可自定义；缺省 = 默认「致 最爱的你」）
  snippet: string; // 信开头摘要（卡片展示前几行）
  from: 'me' | 'ta'; // 谁寄的（我寄给 TA / TA 寄给我）
  fromName: string;
  toName: string;
  app: CoupleChannel;
  contactId: string;
  replyToId?: string; // 回信指向的原信 id（TA 回我的信时携带）
  msgId?: string;
  at: number;
}

/** 点击卡片后的待打开信件（LettersPage 消费） */
interface PendingLetterOpen {
  letterId: string;
  from: 'me' | 'ta';
  envelope?: string;
  snippet?: string;
  replyToId?: string;
  channel?: CoupleChannel;
  contactId?: string;
  at: number;
}

let pendingLetterOpen: PendingLetterOpen | null = null;

/** 聊天信封卡片点击 → 写待打开目标（切换 App 时带上；同 200ms 内重复点击去重） */
export function setPendingLetterOpen(p: { letterId: string; from: 'me' | 'ta'; envelope?: string; snippet?: string; replyToId?: string; channel?: CoupleChannel; contactId?: string }): void {
  pendingLetterOpen = { ...p, at: Date.now() };
}

/** LettersPage 挂载时消费待打开目标（读后即清；60 秒内有效） */
export function consumePendingLetterOpen(): PendingLetterOpen | null {
  const p = pendingLetterOpen && Date.now() - pendingLetterOpen.at < 60_000 ? pendingLetterOpen : null;
  pendingLetterOpen = null;
  return p;
}

/** 供测试/兜底：读当前待打开信件（不清除） */
export function peekPendingLetterOpen(): PendingLetterOpen | null {
  return pendingLetterOpen;
}

// ---------------- 消息落库（与 couple-pact-share 同款管线） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行 */
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

/** 灵动岛通知 + 未读角标 */
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
 * 把一封情书以信封卡片形式发进微信/QQ 会话。
 * dir='me'：我把信分享给 TA（消息 role='me'，随后 AI 延时读信留言+回信）；
 * dir='ta'：TA（AI）寄给我的信（消息 role='peer'，点卡片直达信件页面）。
 * 返回卡片消息 id（失败返回 null）。
 */
export async function sendLetterCard(opts: {
  channel: CoupleChannel;
  contactId: string;
  letterId: string;
  envelope?: string;
  envText?: string; // 信封收信字样（第二十九轮：我的信可自定义）
  snippet: string;
  dir: 'me' | 'ta';
  replyToId?: string;
  preview?: string; // 通知文案（缺省按方向生成）
}): Promise<string | null> {
  const { channel, contactId, letterId, snippet, dir } = opts;
  if (!contactId || !letterId) return null;
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
    if (dir === 'me' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
  } catch {
    /* 静默 */
  }
  const data: CoupleLetterCardData = {
    letterId,
    envelope: opts.envelope ?? 'pinkbunny',
    envText: opts.envText?.trim() || undefined,
    snippet: cut(snippet, 46),
    from: dir,
    fromName: dir === 'me' ? meName : taName,
    toName: dir === 'me' ? taName : meName,
    app: channel,
    contactId,
    replyToId: opts.replyToId,
    at: Date.now(),
  };
  const msg = {
    id: genId(),
    role: dir === 'me' ? 'me' : 'peer',
    content: '',
    time: Date.now(),
    kind: 'lettercard',
    lettercard: data,
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
    opts.preview ??
    (dir === 'me'
      ? `我写了一封情书寄给你，记得拆信看哦`
      : opts.replyToId
        ? `读了你的信，给你回了一封，拆开看看`
        : `给你写了一封信，拆开看看吧`);
  void notifyCard(channel, contactId, preview);
  return msg.id;
}

/** 聊天信封卡片点击后的导航事件名（CoupleSpaceApp 监听 → openSub('letters')） */
export const COUPLE_LETTER_NAV_EVENT = 'couple-letter-nav';

/**
 * 聊天里的信封卡片被点击：记下待打开目标 + 切进情侣空间 + 广播导航事件。
 * （LettersPage 挂载后 consumePendingLetterOpen 直达对应信件详情页，不进情侣空间主页）
 */
export function navToLetter(p: { letterId: string; from: 'me' | 'ta'; envelope?: string; snippet?: string; replyToId?: string; channel?: CoupleChannel; contactId?: string }): void {
  setPendingLetterOpen(p);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_LETTER_NAV_EVENT, { detail: p }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/**
 * 我把一封情书分享给 AI 后：AI 延时认真读信 →
 * ① 根据人设记忆+上下文在信下面写留言；② 给我回一封信（写进 aiLetters + 信封卡片发回会话）。
 * 全程写进 AI 记忆；只对绑定的恋人联系人生效。
 */
export function scheduleAiLetterFeedback(opts: { channel: CoupleChannel; contactId: string; letterId: string; text: string; envelope?: string }): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { kvSet } = await import('./idb-kv');
        const ai = await import('./couple-ai');
        const r = await ai.aiReadLetter(opts.letterId, opts.text); // { comment, reply }
        const { dispatchStateEvent } = await import('./couple-invite');
        // ① 信下留言（AI 的话，进通用留言线程；couple-space:state 无渠道作用域，用普通 kvSet）
        const comment = (r.comment ?? '').trim();
        if (comment) {
          try {
            const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
            const list = Array.isArray(snap.comments) ? [...(snap.comments as unknown[])] : [];
            list.push({ id: genId(), key: `letter:${opts.letterId}`, from: 'ta', text: comment, at: Date.now() });
            kvSet('couple-space:state', { ...snap, comments: list });
          } catch {
            /* 静默 */
          }
          dispatchStateEvent();
        }
        // ② 回信：写进 aiLetters + 信封卡片发回来
        const reply = (r.reply ?? '').trim();
        if (reply && reply.length >= 10) {
          const letterId = genId();
          try {
            const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
            const aiLetters = Array.isArray(snap.aiLetters) ? [...(snap.aiLetters as unknown[])] : [];
            aiLetters.unshift({ id: letterId, text: reply, envelope: opts.envelope ?? 'pinkbunny', replyToId: opts.letterId, at: Date.now() });
            kvSet('couple-space:state', { ...snap, aiLetters });
          } catch {
            /* 静默 */
          }
          dispatchStateEvent();
          await sendLetterCard({
            channel: opts.channel,
            contactId: opts.contactId,
            letterId,
            envelope: opts.envelope,
            snippet: reply,
            dir: 'ta',
            replyToId: opts.letterId,
          });
          const { coupleRemember } = await import('./couple-ai');
          const snap = kvGet<Record<string, string>>('couple-space:state') ?? {};
          // 第十九轮需求46：TA 的信（回信）写进记忆时带上更多正文，之后的对话能想起信里说了什么
          coupleRemember(opts.contactId, opts.channel, `TA读了${snap.meName || '她'}的情书并回了一封信（回信内容：${cut(reply, 90)}）`);
        } else if (comment) {
          const { coupleRemember } = await import('./couple-ai');
          coupleRemember(opts.contactId, opts.channel, `TA读了${snapName()}的情书，在信下留言：${cut(comment, 40)}`);
        }
      } catch {
        /* 读信失败静默（不影响分享主流程） */
      }
    })();
  }, 6000 + Math.random() * 7000);
}

function snapName(): string {
  try {
    const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    return typeof snap.meName === 'string' && snap.meName.trim() ? snap.meName.trim() : '她';
  } catch {
    return '她';
  }
}
