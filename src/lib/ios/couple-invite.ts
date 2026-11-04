'use client';

/**
 * 情侣空间邀请（亲密关系卡片流）——情侣空间第六轮改造核心模块。
 *
 * 用户规格：
 * - 情侣空间（原情侣空间）邀请页按钮：有人邀请我 → 「接受邀请」；没人邀请我 → 「立即邀请我的另一半」（可邀请 AI）。
 * - 卡片流仿 QQ 亲密关系卡片（对称双向）：
 *   · AI 邀请我 → AI 在微信/QQ 会话发「邀请卡」→ 我接受 → 我回「成功卡」；
 *   · 我邀请 AI → 我在会话发「邀请卡」→ AI 延时接受 → AI 回「成功卡」。
 * - 情侣空间所有信息按全局存储（couple-space:state 不带 wx-/qq- 前缀，天然全局，
 *   不随微信/QQ 账号切换；用户要求「按照全局来」）。
 * - 每个联系人只能邀请一次（invitedOnce 全局记录，发出或收到都算）。
 * - 用户邀请 AI 时可以选择微信还是 QQ（渠道选择 → 选该渠道 AI 好友）。
 *
 * 实现模式（复用既有成熟管线）：
 * - 卡片注入：仿 mt-proxy-pay.ts insertProxyCard —— 直写 `${app}-chat-msgs:${cid}`（按目标
 *   App 账号作用域 kvGetScoped/kvSetScoped）+ 恢复被隐藏会话 + 广播 COUPLE_CARD_EVENT
 *   （聊天页在场时实时合并上屏）+ 灵动岛通知 + 未读角标。
 * - AI 延时接受：仿 mt-ai-engage scheduleMtProxyAiDecision —— setTimeout 随机延时后落库，
 *   无需打开聊天页。
 */

import { useCallback, useSyncExternalStore } from 'react';
import { kvGet, kvSet, kvGetScoped, kvSetScoped } from './idb-kv';
import { genId } from './db';
import { getContact, listContacts, ownerProfileFor } from './contacts-store';
import { getActiveAccountFor } from './accounts';
import { avatarFor, displayNameOf, socialNameOf, type ContactRecord } from '@/lib/contacts';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';

// ---------------- 类型 ----------------

/** 邀请渠道：微信 / QQ */
export type CoupleChannel = 'wx' | 'qq';

/** 亲密关系卡片数据（挂在消息 relcard 字段；仿 QQ 亲密关系卡） */
export interface CoupleRelCardData {
  stage: 'invite' | 'accept'; // 邀请卡 / 成功卡
  status: 'pending' | 'accepted' | 'declined'; // 邀请卡状态；成功卡恒 accepted
  fromName: string; // 邀请方（邀请卡）/ 回卡方（成功卡）名字
  toName: string; // 接收方名字
  app: CoupleChannel; // 渠道（副文案「让微信帮我们记录每日点滴」）
  contactId: string; // 卡片所在会话的联系人 id
}

/** 渠道身份：指定渠道（微信/QQ）下的「我」与「TA」的名字/头像 */
export interface CoupleChannelIdentity {
  meName: string;
  meAvatar: string | null;
  taName: string;
  taAvatar: string | null;
}

/** 指定渠道当前账号对应的「我」的联系人档案（main=机主；小号/匿名号=档案联系人；与 contacts-store.pickOwnerContact 同规则） */
async function channelOwnerContact(channel: CoupleChannel): Promise<ContactRecord | undefined> {
  try {
    const acc = getActiveAccountFor(channel);
    const list = await listContacts();
    if (acc.kind === 'main') return list.find((c) => c.kind === 'user' && !c.altOf);
    const byAlt = list.find((c) => c.altOf === acc.id);
    if (byAlt) return byAlt;
    if (acc.ownerContactId) return list.find((c) => c.id === acc.ownerContactId);
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 渠道身份（用户要求：用微信邀请 → 双方名字头像跟随微信；QQ 邀请 → 跟随 QQ）：
 * 我 = 该渠道当前账号档案的社交名（昵称??真名）+ 分 App 头像槽位；TA = 展示名 + 分 App 头像槽位。
 */
export async function channelIdentityOf(channel: CoupleChannel, partnerContactId: string | null): Promise<CoupleChannelIdentity> {
  const out: CoupleChannelIdentity = { meName: '', meAvatar: null, taName: '', taAvatar: null };
  const me = await channelOwnerContact(channel);
  if (me) {
    out.meName = socialNameOf(me);
    out.meAvatar = avatarFor(me, channel);
  }
  if (partnerContactId) {
    try {
      const ta = await getContact(partnerContactId);
      if (ta) {
        out.taName = displayNameOf(ta);
        out.taAvatar = avatarFor(ta, channel);
      }
    } catch {
      /* 联系人读取失败静默，保留空值 */
    }
  }
  return out;
}

/** 待处理邀请（全局唯一：同一时间最多一个） */
export interface CouplePendingInvite {
  contactId: string;
  app: CoupleChannel;
  dir: 'send' | 'recv'; // send=我邀请TA recv=TA邀请我
  msgId: string; // 邀请卡消息 id（接受/拒绝时定位卡片）
  at: number;
  fromName: string; // dir='recv' 时邀请人（AI）名字；dir='send' 时空串
  fromAvatar: string | null; // dir='recv' 时邀请人头像（邀请页直接展示，免查联系人）
  toName: string; // dir='send' 时被邀请人名字；dir='recv' 时我的名字
}

/** 邀请历史（每联系人限一次） */
export interface CoupleInviteHistory {
  contactId: string;
  app: CoupleChannel;
  at: number;
}

/** 情侣空间全局状态里的邀请元数据（存 couple-space:state.invite） */
export interface CoupleInviteMeta {
  partnerContactId: string | null; // 已建立关系绑定的联系人
  partnerApp: CoupleChannel | null; // 关系建立渠道
  pendingInvite: CouplePendingInvite | null;
  invitedOnce: CoupleInviteHistory[];
}

export const emptyInviteMeta = (): CoupleInviteMeta => ({
  partnerContactId: null,
  partnerApp: null,
  pendingInvite: null,
  invitedOnce: [],
});

/** 事件：卡片落库（聊天页在场时实时合并上屏） */
export const COUPLE_CARD_EVENT = 'couple-card-inserted';
/** 事件：全局邀请状态变化（情侣空间邀请页刷新按钮状态） */
export const COUPLE_STATE_EVENT = 'couple-state-changed';

const STATE_KEY = 'couple-space:state'; // 无 wx-/qq- 前缀 → 全局作用域（不随账号切换）
const CHAT_HIDDEN_KEY: Record<CoupleChannel, string> = { wx: 'wx-chat-hidden', qq: 'qq-chat-hidden' };

// ---------------- 全局邀请元数据读写 ----------------

/** 读全局邀请元数据（缺失/损坏字段逐项兜底，兼容旧数据） */
export function readInviteMeta(): CoupleInviteMeta {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    const inv = (s.invite ?? null) as Partial<CoupleInviteMeta> | null;
    const pending = inv?.pendingInvite;
    const okPending =
      pending && typeof pending === 'object' &&
      typeof (pending as CouplePendingInvite).contactId === 'string' &&
      typeof (pending as CouplePendingInvite).msgId === 'string' &&
      ((pending as CouplePendingInvite).dir === 'send' || (pending as CouplePendingInvite).dir === 'recv')
        ? (pending as CouplePendingInvite)
        : null;
    return {
      partnerContactId: typeof inv?.partnerContactId === 'string' && inv.partnerContactId ? inv.partnerContactId : null,
      partnerApp: inv?.partnerApp === 'wx' || inv?.partnerApp === 'qq' ? inv.partnerApp : null,
      pendingInvite: okPending,
      invitedOnce: Array.isArray(inv?.invitedOnce)
        ? (inv?.invitedOnce as CoupleInviteHistory[]).filter(
            (x) => x && typeof x.contactId === 'string' && (x.app === 'wx' || x.app === 'qq'),
          )
        : [],
    };
  } catch {
    return emptyInviteMeta();
  }
}

/** 写全局邀请元数据（读-改-写整 state；内存同步权威 + 防抖写穿，广播状态事件） */
export function writeInviteMeta(meta: CoupleInviteMeta): void {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    kvSet(STATE_KEY, { ...s, invite: meta });
  } catch {
    /* 落盘失败静默（内存态已够本次会话用） */
  }
  dispatchStateEvent();
}

/** 广播全局状态变化（情侣空间邀请页监听刷新） */
export function dispatchStateEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_STATE_EVENT));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

// ---------------- 消息落库（微信/QQ 会话注入） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行（与各端 saveMsgs 的真微信行为一致） */
function restoreHiddenChat(channel: CoupleChannel, contactId: string): void {
  try {
    const key = CHAT_HIDDEN_KEY[channel];
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

/** 向指定会话注入一条消息（按目标渠道账号作用域；广播卡片事件给在场聊天页） */
function pushMsg(channel: CoupleChannel, contactId: string, msg: Record<string, unknown>): void {
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
    list.push(msg);
    kvSetScoped(key, list, channel); // 聊天记录不封顶（与各端口径一致）
  } catch {
    /* 落库失败静默 */
  }
  restoreHiddenChat(channel, contactId);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

/** 更新某条卡片消息的 relcard 状态（接受/拒绝后；直写落库，广播让聊天页刷新同 id 消息） */
function patchCardInMsgs(channel: CoupleChannel, contactId: string, msgId: string, patch: Partial<CoupleRelCardData>): void {
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    if (!Array.isArray(raw)) return;
    const list = raw.map((m) => {
      const x = m as { id?: unknown; relcard?: unknown };
      if (x && x.id === msgId && x.relcard && typeof x.relcard === 'object') {
        return { ...x, relcard: { ...(x.relcard as Record<string, unknown>), ...patch } };
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
    /* 广播失败不影响落库 */
  }
}

/** 灵动岛通知 + 未读角标（正在查看的会话不 bump，与主动消息口径一致） */
function notifyCard(channel: CoupleChannel, contact: ContactRecord, body: string): void {
  try {
    const notifyApp = channel === 'wx' ? ('wechat' as const) : ('qq' as const);
    pushChatNotification({
      sessionKey: `${channel}:${contact.id}`,
      app: notifyApp,
      title: displayNameOf(contact),
      avatar: avatarFor(contact, channel),
      body,
      target: { app: notifyApp, contactId: contact.id },
    });
    if (!isProactiveChatActive(channel, contact.id)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contact.id, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

function sysRow(text: string): Record<string, unknown> {
  return { id: genId(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text } };
}

function channelName(channel: CoupleChannel): string {
  return channel === 'wx' ? '微信' : 'QQ';
}

async function myNameOf(channel: CoupleChannel): Promise<string> {
  try {
    const owner = await ownerProfileFor(channel);
    if (owner?.realName?.trim()) return owner.realName.trim();
  } catch {
    /* 回退 */
  }
  return '我';
}

// ---------------- 关系建立（全局状态） ----------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 建立关系：写全局 couple-space:state（accepted/partner/纪念日/恋人资料/双方渠道身份）+ 清 pendingInvite */
async function establishRelation(channel: CoupleChannel, contactId: string): Promise<void> {
  // 双方名字/头像跟随邀请渠道（微信邀请→微信身份；QQ 邀请→QQ 身份，含多账号与分 App 头像槽位）
  const idn = await channelIdentityOf(channel, contactId);
  const taName = idn.taName;
  const taAvatar = idn.taAvatar;
  const meName = idn.meName;
  const meAvatar = idn.meAvatar;
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    kvSet(STATE_KEY, {
      ...s,
      accepted: true,
      // 纪念日：已有则保留（解除关系再绑定不重置），否则记今天
      anniversary: typeof s.anniversary === 'string' && s.anniversary ? s.anniversary : todayKey(),
      taName: taName || (typeof s.taName === 'string' ? s.taName : ''),
      taAvatar: taAvatar ?? (s.taAvatar ?? null),
      meName: meName || (typeof s.meName === 'string' ? s.meName : ''),
      meAvatar: meAvatar ?? (s.meAvatar ?? null),
      invite: { ...readInviteMeta(), partnerContactId: contactId, partnerApp: channel, pendingInvite: null },
    });
  } catch {
    /* 落盘失败静默 */
  }
  dispatchStateEvent();
}

// ---------------- AI 延时接受（我邀请 AI 场景） ----------------

const AI_ACCEPT_DELAY_MIN = 4200;
const AI_ACCEPT_DELAY_JITTER = 6800;

function scheduleAiAccept(channel: CoupleChannel, contactId: string, inviteMsgId: string, inviterName: string, aiName: string): void {
  const delay = AI_ACCEPT_DELAY_MIN + Math.random() * AI_ACCEPT_DELAY_JITTER;
  window.setTimeout(() => {
    void aiAcceptInvite(channel, contactId, inviteMsgId, inviterName, aiName);
  }, delay);
}

/** AI 接受我的邀请：邀请卡转 accepted → AI 回成功卡 → sys 提示行 → 建立关系 → 通知 */
async function aiAcceptInvite(channel: CoupleChannel, contactId: string, inviteMsgId: string, inviterName: string, aiName: string): Promise<void> {
  patchCardInMsgs(channel, contactId, inviteMsgId, { status: 'accepted' });
  pushMsg(channel, contactId, {
    id: genId(),
    role: 'peer',
    content: '',
    time: Date.now(),
    kind: 'relcard',
    relcard: { stage: 'accept', status: 'accepted', fromName: aiName, toName: inviterName, app: channel, contactId } satisfies CoupleRelCardData,
  });
  pushMsg(channel, contactId, sysRow('你们已成为情侣并获得情侣标识，去情侣空间看看吧'));
  await establishRelation(channel, contactId);
  try {
    const c = await getContact(contactId);
    if (c) notifyCard(channel, c, '我们已经成功建立情侣关系，现在我们是情侣啦');
  } catch {
    /* 通知失败静默 */
  }
}

// ---------------- 对外动作 ----------------

export type CoupleInviteResult = { ok: true } | { ok: false; error: string };

/**
 * 我邀请 AI（情侣空间「立即邀请我的另一半」）：选渠道 → 选联系人 → 邀请卡进会话（role=me）
 * → AI 延时接受 → AI 回成功卡 → 建立关系。
 * 校验：已有关系 / 已有 pending / 该联系人已邀请过（每联系人限一次）均拒绝。
 */
export async function sendMyInvite(channel: CoupleChannel, contactId: string): Promise<CoupleInviteResult> {
  const meta = readInviteMeta();
  if (hasPartner()) return { ok: false, error: '已经有恋人啦，先在设置里解除当前关系' };
  if (meta.pendingInvite) return { ok: false, error: '已有一个待处理的邀请，先等它完成' };
  if (meta.invitedOnce.some((x) => x.contactId === contactId)) return { ok: false, error: '这位联系人已经被邀请过啦，每个人只能邀请一次' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact) return { ok: false, error: '联系人不存在' };
  const myName = await myNameOf(channel);
  const taName = displayNameOf(contact);
  const inviteMsgId = genId();
  writeInviteMeta({
    ...meta,
    pendingInvite: { contactId, app: channel, dir: 'send', msgId: inviteMsgId, at: Date.now(), fromName: '', fromAvatar: null, toName: taName },
    invitedOnce: [...meta.invitedOnce, { contactId, app: channel, at: Date.now() }],
  });
  pushMsg(channel, contactId, {
    id: inviteMsgId,
    role: 'me',
    content: '',
    time: Date.now(),
    kind: 'relcard',
    relcard: { stage: 'invite', status: 'pending', fromName: myName, toName: taName, app: channel, contactId } satisfies CoupleRelCardData,
  });
  scheduleAiAccept(channel, contactId, inviteMsgId, myName, taName);
  return { ok: true };
}

/**
 * AI 邀请我（情侣空间「让 TA 来邀请你」）：先占全局 pendingInvite（邀请页马上变「接受邀请」），
 * AI 延时数秒发邀请卡（role=peer，带接受/拒绝按钮）+ 灵动岛通知。
 */
export async function aiInvitesMe(channel: CoupleChannel, contactId: string): Promise<CoupleInviteResult> {
  const meta = readInviteMeta();
  if (hasPartner()) return { ok: false, error: '已经有恋人啦，先在设置里解除当前关系' };
  if (meta.pendingInvite) return { ok: false, error: '已有一个待处理的邀请，先等它完成' };
  if (meta.invitedOnce.some((x) => x.contactId === contactId)) return { ok: false, error: '这位联系人已经邀请过你啦，每个人只能邀请一次' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact) return { ok: false, error: '联系人不存在' };
  const myName = await myNameOf(channel);
  const taName = displayNameOf(contact);
  const inviteMsgId = genId();
  writeInviteMeta({
    ...meta,
    pendingInvite: { contactId, app: channel, dir: 'recv', msgId: inviteMsgId, at: Date.now(), fromName: taName, fromAvatar: contact.avatar ?? null, toName: myName },
    invitedOnce: [...meta.invitedOnce, { contactId, app: channel, at: Date.now() }],
  });
  const delay = 2600 + Math.random() * 5400;
  const c = contact;
  window.setTimeout(() => {
    pushMsg(channel, contactId, {
      id: inviteMsgId,
      role: 'peer',
      content: '',
      time: Date.now(),
      kind: 'relcard',
      relcard: { stage: 'invite', status: 'pending', fromName: taName, toName: myName, app: channel, contactId } satisfies CoupleRelCardData,
    });
    notifyCard(channel, c, `${taName}想和你建立情侣关系，和我成为情侣，让${channelName(channel)}帮我们记录每日点滴`);
    dispatchStateEvent();
  }, delay);
  return { ok: true };
}

/**
 * 我接受 AI 的邀请（聊天卡片「接受邀请」按钮 或 情侣空间「接受邀请」大按钮共用）：
 * AI 的邀请卡转 accepted → 我回成功卡（role=me）→ sys 提示行 → 建立关系。
 */
export async function acceptIncomingInvite(contactId: string): Promise<CoupleInviteResult> {
  const meta = readInviteMeta();
  const inv = meta.pendingInvite;
  if (!inv || inv.contactId !== contactId) return { ok: false, error: '该邀请已失效或已处理' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact) return { ok: false, error: '联系人不存在' };
  const myName = await myNameOf(inv.app);
  const taName = displayNameOf(contact);
  patchCardInMsgs(inv.app, contactId, inv.msgId, { status: 'accepted' });
  pushMsg(inv.app, contactId, {
    id: genId(),
    role: 'me',
    content: '',
    time: Date.now(),
    kind: 'relcard',
    relcard: { stage: 'accept', status: 'accepted', fromName: myName, toName: taName, app: inv.app, contactId } satisfies CoupleRelCardData,
  });
  pushMsg(inv.app, contactId, sysRow('你们已成为情侣并获得情侣标识，去情侣空间看看吧'));
  await establishRelation(inv.app, contactId);
  return { ok: true };
}

/** 我拒绝 AI 的邀请：卡片转 declined + 清 pendingInvite（关系不建立；该联系人已消耗邀请机会） */
export function declineIncomingInvite(contactId: string): CoupleInviteResult {
  const meta = readInviteMeta();
  const inv = meta.pendingInvite;
  if (!inv || inv.contactId !== contactId) return { ok: false, error: '该邀请已失效或已处理' };
  patchCardInMsgs(inv.app, contactId, inv.msgId, { status: 'declined' });
  writeInviteMeta({ ...meta, pendingInvite: null });
  return { ok: true };
}

/**
 * 聊天页卡片按钮统一入口：按消息 id 匹配当前 pendingInvite 才生效（防重复处理/旧卡误点）。
 * 返回 error 供聊天页 toast。
 */
export async function decideCoupleCard(contactId: string, msgId: string, accept: boolean): Promise<CoupleInviteResult> {
  const meta = readInviteMeta();
  const inv = meta.pendingInvite;
  if (!inv || inv.contactId !== contactId || inv.msgId !== msgId) return { ok: false, error: '该邀请已失效或已处理' };
  return accept ? acceptIncomingInvite(contactId) : declineIncomingInvite(contactId);
}

/** 某联系人是否已被邀请过（每联系人限一次；选人列表置灰用） */
export function isContactInvitedOnce(contactId: string): boolean {
  return readInviteMeta().invitedOnce.some((x) => x.contactId === contactId);
}

/** 是否已建立关系（state 顶层 accepted + 绑定联系人，couple-invite 只读不写顶层其它字段） */
function hasPartner(): boolean {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    return s.accepted === true && !!readInviteMeta().partnerContactId;
  } catch {
    return false;
  }
}

/**
 * 恋人标识（第九轮）：与该联系人的情侣空间关系是否处于「已建立」状态。
 * QQ 聊天页标题/会话列表名字后的恋人图标（徽章+钥匙）显隐共用这一个判定——
 * 解除情侣空间（resetAll）后 readInviteMeta 的 partnerContactId 清空 → 图标即时消失。
 */
export function isCoupleActiveWith(contactId: string): boolean {
  if (!contactId) return false;
  try {
    const meta = readInviteMeta();
    if (!meta.partnerContactId || meta.partnerContactId !== contactId) return false;
    return hasPartner();
  } catch {
    return false;
  }
}

/**
 * 恋人标识显隐 hook（第九轮）：useSyncExternalStore 订阅 COUPLE_STATE_EVENT——开通情侣空间
 * 图标即时出现、解除后即时消失（跨组件同步，无需刷新页面；快照为原始布尔值，天然稳定）。
 */
export function useCoupleBadgeOn(contactId: string | null | undefined): boolean {
  const id = contactId ?? '';
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener(COUPLE_STATE_EVENT, onStoreChange);
    return () => window.removeEventListener(COUPLE_STATE_EVENT, onStoreChange);
  }, []);
  const getSnapshot = useCallback(() => (id ? isCoupleActiveWith(id) : false), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
