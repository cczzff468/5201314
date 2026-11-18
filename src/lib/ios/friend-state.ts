'use client';

/**
 * 删好友状态机 + AI 主动申请加回（微信 / QQ 两端共用一套逻辑）：
 *
 * 【删好友 ≠ 删联系人】
 * - 旧的 deleteContact（contacts-store）是「从联系人 App 里删人」：聊天记录/记忆/朋友圈/互动痕迹
 *   全部清除。本模块是社交 App 内的「删除好友」（删除好友关系）：
 *   联系人本体保留，聊天记录、记忆、朋友圈动态与互动、通话记录一律保留，只是不可见；
 *   重新加回好友（手动搜索添加 / 同意对方的加回申请）后全部恢复可见。
 *
 * 【存储】
 * - 删除状态：IndexedDB kv `friend-del:<app>:<contactId>` = FriendDelState
 *   （at=删除时间，rejected=用户拒绝过 AI 申请——拒绝后停止申请，
 *   重新加回好友清空整个状态，再次删除才重新开始）。
 *   kvGet 同步读（内存缓存）+ 异步写穿，重启保留；与 block-state 同款模式。
 * - 好友申请列表：localStorage `wx-friend-reqs`（沿用微信既有键，旧数据天然兼容——
 *   旧条目无 status 归一化为 accepted）/ `qq-friend-reqs`。
 *
 * 【可见性门控（删好友后数据不可见）】
 * - 微信/QQ 会话列表：isFriendIn(app) 已排除非好友（删除即 friendWx/friendQq=false，天然生效）；
 * - 朋友圈/空间动态、互动消息：渲染前按 isFriendDeleted 过滤被删好友的动态/互动；
 * - 通话记录（电话 App）、记忆库（全局面）：isPersonGoneEverywhere —— 删过好友且微信/QQ 两端
 *   都不是好友才隐藏（只删了微信、QQ 还是好友时记忆/通话照旧可见）；重新加回自动恢复。
 * - 记忆数据本体从不删除：AI（主动来电/加回申请生成）仍可引用（TA 还记得你们的事，只是被你删了）。
 *
 * 【AI 主动申请加回】
 * - 确认删除后立刻，AI 以「好友申请」形式出现在 新的朋友/好友通知 列表（status='pending'；
 *   无冷却——同一联系人同时只保留一条待处理申请，同意/拒绝后不再重复发）。
 * - 留言按人设 + 记忆生成（如「怎么把我删了」），两级生成兜底与跨 App 找同款（/api/chat → forceSdk）；
 * - 用户拒绝（rejected=true）后彻底停止；重新加回好友清空状态，再次删除才重新开始；
 * - 用户同意：恢复好友关系 + 清除删除状态（历史数据恢复可见）。
 * - 刷新页面丢失的定时器由 runFriendReqCatchUp（微信/QQ 挂载时调用）立刻补跑。
 */

import { kvGet, kvSet, kvDel } from './idb-kv';
import { genId } from './db';
import { getContact, ownerProfileFor, setAppFriendFlag, mainOwnerContact } from './contacts-store';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { getAccountById, getActiveAccountIdFor, MAIN_ACCOUNT_ID } from './accounts';
import { useSettings } from './store';
import { BLOCK_CHANNEL, loadBlock } from './block-state';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings, isAltMainDisclosed, memAltLinked, memChatRecallBlock } from '@/lib/memory';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { cleanBubbleText } from '@/lib/chat-rich';

/** 拥有「删除好友」能力的 App（微信 / QQ；信息 App 无好友概念） */
export type FriendDelApp = 'wx' | 'qq';

/** 删除状态（有键 = 已删除好友；字段全部可选向后兼容） */
export interface FriendDelState {
  /** 删除时间 */
  at: number;
  /** @deprecated AI 最近一次申请加回的时间（冷却已按用户要求移除，仅兼容旧存量数据，不再读写） */
  lastReqAt?: number;
  /** 用户拒绝过 AI 的申请（拒绝后停止申请；重新加回好友清空） */
  rejected?: boolean;
}

/**
 * 删除状态键（多账号 Task 42）：改为 `<app>-friend-del:<contactId>`——`wx-`/`qq-` 前缀命中
 * idb-kv 的账号作用域映射，键自动带 `--{accountId}` 后缀：大号删了好友不影响小号的关系
 * （每个账号与角色的关系独立维护；旧裸键 `friend-del:*` 不再读写，存量状态自然失效，重新删除即重建）。
 */
const delKey = (app: FriendDelApp, contactId: string) => `${app}-friend-del:${contactId}`;

/** 该联系人是否已被我在此 App 删除好友（同步读，渲染/门控随时可调） */
export function isFriendDeleted(app: FriendDelApp, contactId: string): boolean {
  if (!contactId) return false;
  return kvGet<FriendDelState>(delKey(app, contactId)) != null;
}

/** 删除状态详情（无 = 未删除） */
export function friendDelStateOf(app: FriendDelApp, contactId: string): FriendDelState | null {
  if (!contactId) return null;
  const v = kvGet<FriendDelState>(delKey(app, contactId));
  return v && typeof v === 'object' && typeof v.at === 'number' ? v : null;
}

/** 删除状态索引（idb-kv 不提供键枚举；这里维护一份按 App 分组的 id 索引，扫描/补跑用） */
const DEL_INDEX_KEY = 'friend-del-index';

function readDelIndex(): Record<FriendDelApp, string[]> {
  const raw = kvGet<Partial<Record<FriendDelApp, string[]>>>(DEL_INDEX_KEY);
  return {
    wx: Array.isArray(raw?.wx) ? raw.wx.filter((x) => typeof x === 'string') : [],
    qq: Array.isArray(raw?.qq) ? raw.qq.filter((x) => typeof x === 'string') : [],
  };
}

function writeDelIndex(app: FriendDelApp, contactId: string, present: boolean): void {
  const idx = readDelIndex();
  const list = idx[app];
  const has = list.includes(contactId);
  if (present && !has) idx[app] = [...list, contactId];
  else if (!present && has) idx[app] = list.filter((x) => x !== contactId);
  else return;
  kvSet(DEL_INDEX_KEY, idx);
}

/** 此 App 内处于「已删除好友」状态的联系人 id 列表 */
export function deletedFriendIds(app: FriendDelApp): string[] {
  return readDelIndex()[app].filter((id) => friendDelStateOf(app, id) != null);
}

/**
 * 删除好友（由 UI 二次确认后调用）：
 * - 写入删除状态（at=删除时间）；
 * - 关闭好友关系（friendWx/friendQq=false；会话列表/通讯录即时消失）；
 * - 立刻调度 AI 主动申请加回（无冷却；留言生成完成即出现在 新的朋友/好友通知）。
 * 不清理任何数据（聊天记录/记忆/朋友圈/通话记录全部保留）。
 */
export async function removeFriendByUser(app: FriendDelApp, contactId: string): Promise<boolean> {
  const c = await getContact(contactId).catch(() => null);
  if (!c || c.kind === 'user') return false;
  kvSet(delKey(app, contactId), { at: Date.now() } satisfies FriendDelState);
  writeDelIndex(app, contactId, true);
  try {
    // 多账号 Task 41：删除标记落当前账号作用域（大号同步旧标记），不影响其他账号的好友关系
    await setAppFriendFlag(app, contactId, false);
  } catch {
    // 联系人更新失败不阻塞状态标记（下次删除重写）
  }
  scheduleCharReAddReq(app, contactId);
  return true;
}

/** 重新加回好友（手动搜索添加 / 同意 AI 申请共用）：清除删除状态 → 历史数据恢复可见 */
export async function restoreFriendship(app: FriendDelApp, contactId: string): Promise<void> {
  kvDel(delKey(app, contactId));
  writeDelIndex(app, contactId, false);
  try {
    // 多账号 Task 41：好友标记落当前账号作用域（大号同步旧标记）
    await setAppFriendFlag(app, contactId, true);
  } catch {
    // 联系人可能已被从联系人 App 彻底删除：申请状态仍流转，UI 层提示
  }
}

/**
 * 删过好友且微信/QQ 两端都不再是好友 = 该联系人对用户「整体不可见」：
 * 电话通话记录 / 记忆库等全局面用这个口径隐藏；重新加回任一端即恢复。
 * 从未删过好友的联系人恒为 false（不打扰既有效果）。
 */
export async function isPersonGoneEverywhere(contactId: string): Promise<boolean> {
  if (!contactId) return false;
  const wx = friendDelStateOf('wx', contactId);
  const qq = friendDelStateOf('qq', contactId);
  if (!wx && !qq) return false;
  const c = await getContact(contactId).catch(() => null);
  if (!c || c.kind === 'user') return false;
  const friendWx = c.friendWx === true || (c.friendWx === undefined && c.isFriend === true);
  const friendQq = c.friendQq === true || (c.friendQq === undefined && c.isFriend === true);
  return !friendWx && !friendQq;
}

// ---------------- 好友申请列表（新的朋友 / 好友通知共用数据源） ----------------

/** 申请条目（wx-friend-reqs / qq-friend-reqs；旧微信条目无 status/contactId 归一化兼容） */
export interface FriendReqEntry {
  /** 申请 id（新条目 genId；微信旧数据沿用联系人 id 作条目 id，避免破坏既有 testid） */
  id: string;
  /** 联系人 id（旧微信条目缺省 = 同 id 字段） */
  contactId?: string;
  /** 展示名快照（申请时刻的备注/昵称/名字） */
  name: string;
  /** 头像快照（渲染端可再实时解析） */
  avatar: string | null;
  /** 验证消息 / 对方留言 */
  message: string;
  /** 申请时间 */
  time: number;
  /** 状态：pending=待处理 accepted=已同意 rejected=已拒绝；旧数据无此字段 = accepted */
  status?: 'pending' | 'accepted' | 'rejected';
  /** 来源：朋友验证消息 / 搜索账号添加 / 手机联系人 / QQ号查找 等 */
  source?: string;
  /** true = AI（对方）主动发起的加回申请 */
  fromChar?: boolean;
  /** 申请附加信息（申请添加朋友页收集：图片/标签/备忘/照片/朋友权限/朋友圈可见性） */
  extras?: FriendReqExtras;
  /** 验证消息多轮对话（我/对方 交替；详情页展示与「回复」续写；旧数据无此字段 = 单条 message） */
  thread?: FriendReqThreadMsg[];
}

/** 验证消息线程里的一条发言（who=me 用户发 / who=peer 对方发） */
export interface FriendReqThreadMsg {
  who: 'me' | 'peer';
  text: string;
  time: number;
}

export interface FriendReqExtras {
  /** 打招呼附图（data URL，压缩后 ≤200KB） */
  image?: string | null;
  /** 申请时设置的对方备注 */
  remark?: string | null;
  /** 标签 */
  tags?: string[];
  /** 备忘 */
  memo?: string | null;
  /** 照片（对方资料照片，data URL，≤4 张） */
  photos?: string[];
  /** 朋友权限：聊天 */
  permChat?: boolean;
  /** 朋友权限：朋友圈 */
  permMoments?: boolean;
  /** 朋友权限：微信运动 */
  permExercise?: boolean;
  /** 不让他看我的朋友圈和状态 */
  hideMine?: boolean;
  /** 不看他(她)的朋友圈和状态 */
  hideTheirs?: boolean;
}

const REQ_LS_KEY: Record<FriendDelApp, string> = { wx: 'wx-friend-reqs', qq: 'qq-friend-reqs' };
export const SOURCE_CHAR_REQ = '朋友验证消息';
export const SOURCE_SEARCH_WX = '搜索账号添加';
export const SOURCE_SEARCH_QQ = 'QQ号查找';

function normalizeReq(r: Partial<FriendReqEntry>): FriendReqEntry | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.time !== 'number' || !isFinite(r.time)) return null;
  const status = r.status === 'pending' || r.status === 'rejected' ? r.status : 'accepted';
  const contactId = typeof r.contactId === 'string' && r.contactId ? r.contactId : r.id;
  return {
    id: r.id,
    contactId,
    name: typeof r.name === 'string' ? r.name : '对方',
    avatar: typeof r.avatar === 'string' ? r.avatar : null,
    message: typeof r.message === 'string' ? r.message : '',
    time: r.time,
    status,
    source: typeof r.source === 'string' && r.source ? r.source : status === 'accepted' ? undefined : SOURCE_CHAR_REQ,
    fromChar: r.fromChar === true,
    extras:
      r.extras && typeof r.extras === 'object'
        ? {
            image: typeof r.extras.image === 'string' ? r.extras.image : null,
            remark: typeof r.extras.remark === 'string' ? r.extras.remark : null,
            tags: Array.isArray(r.extras.tags) ? r.extras.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
            memo: typeof r.extras.memo === 'string' ? r.extras.memo : null,
            photos: Array.isArray(r.extras.photos) ? r.extras.photos.filter((t) => typeof t === 'string').slice(0, 4) : [],
            permChat: r.extras.permChat !== false,
            permMoments: r.extras.permMoments !== false,
            permExercise: r.extras.permExercise !== false,
            hideMine: r.extras.hideMine === true,
            hideTheirs: r.extras.hideTheirs === true,
          }
        : undefined,
    thread: normalizeThread(r.thread),
  };
}

function normalizeThread(raw: unknown): FriendReqThreadMsg[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list: FriendReqThreadMsg[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const m = x as Partial<FriendReqThreadMsg>;
    if (typeof m.text !== 'string' || !m.text.trim()) continue;
    list.push({
      who: m.who === 'me' ? 'me' : 'peer',
      text: m.text,
      time: typeof m.time === 'number' && isFinite(m.time) ? m.time : Date.now(),
    });
  }
  return list.length > 0 ? list.slice(-30) : undefined;
}

export function loadFriendReqs(app: FriendDelApp): FriendReqEntry[] {
  // 存储层与微信既有 loadReqs 同源：IndexedDB kv（wx-friend-reqs 原本就在 idb-kv 迁移清单里，
  // 写 localStorage 会在下次启动被迁移器搬进 kv 并清键——必须直接走 kvGet/kvSet）
  const raw = kvGet<unknown>(REQ_LS_KEY[app]);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => normalizeReq(x as Partial<FriendReqEntry>))
    .filter((x): x is FriendReqEntry => x !== null)
    .sort((a, b) => b.time - a.time)
    .slice(0, 100);
}

export function saveFriendReqs(app: FriendDelApp, list: FriendReqEntry[]): void {
  kvSet(REQ_LS_KEY[app], list.slice(0, 100));
  try {
    window.dispatchEvent(new CustomEvent(FRIEND_REQS_EVENT, { detail: { app } }));
  } catch {
    // 忽略
  }
}

/** 追加一条申请（去重：同一联系人同一时刻只留一条 pending 的 AI 申请） */
export function addFriendReq(app: FriendDelApp, entry: FriendReqEntry): void {
  const list = loadFriendReqs(app);
  if (entry.fromChar) {
    const dup = list.find((r) => r.contactId === entry.contactId && r.status === 'pending');
    if (dup) return;
  }
  saveFriendReqs(app, [entry, ...list.filter((r) => !(entry.fromChar && r.id === entry.id))]);
}

/** 按条目 id 局部更新申请（thread 回复/欢迎回复等；变更广播给订阅方） */
export function updateFriendReq(app: FriendDelApp, reqId: string, patch: Partial<FriendReqEntry>): void {
  const list = loadFriendReqs(app);
  if (!list.some((r) => r.id === reqId)) return;
  saveFriendReqs(
    app,
    list.map((r) => (r.id === reqId ? { ...r, ...patch } : r)),
  );
}

/** 往验证消息线程追加一条发言（thread 不存在时自动以 message 起始建线程） */
export function appendReqThread(app: FriendDelApp, reqId: string, msg: FriendReqThreadMsg): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit) return;
  const base: FriendReqThreadMsg[] =
    hit.thread && hit.thread.length > 0
      ? hit.thread
      : hit.message.trim()
        ? [{ who: hit.fromChar ? 'peer' : 'me', text: hit.message, time: hit.time }]
        : [];
  updateFriendReq(app, reqId, { thread: [...base, msg].slice(-30) });
}

/** 更新申请状态 */
export function setFriendReqStatus(app: FriendDelApp, reqId: string, status: 'pending' | 'accepted' | 'rejected'): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit || hit.status === status) return;
  saveFriendReqs(
    app,
    list.map((r) => (r.id === reqId ? { ...r, status } : r)),
  );
}

/** 拒绝 AI 的加回申请：条目置 rejected + 删除状态标记 rejected（AI 彻底停止申请，
 *  重新加回好友时状态被 restoreFriendship 清除才会重新开始） */
export function rejectFriendReq(app: FriendDelApp, reqId: string): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  setFriendReqStatus(app, reqId, 'rejected');
  if (!hit) return;
  const cid = hit.contactId ?? hit.id;
  const st = friendDelStateOf(app, cid);
  if (st && !st.rejected) kvSet(delKey(app, cid), { ...st, rejected: true } satisfies FriendDelState);
}

/** 同联系人是否存在待处理的申请 */
export function hasPendingReqFor(app: FriendDelApp, contactId: string): boolean {
  return loadFriendReqs(app).some((r) => r.contactId === contactId && r.status === 'pending');
}

/** 申请列表变更事件（微信/QQ 页面订阅后重读列表） */
export const FRIEND_REQS_EVENT = 'friend-reqs-changed';

export function subscribeFriendReqs(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(FRIEND_REQS_EVENT, handler);
  return () => window.removeEventListener(FRIEND_REQS_EVENT, handler);
}

// ---------------- AI 主动申请加回 ----------------

/** 删除后第一次申请的延迟：0 = 确认删除后立刻发起（无冷却；留言生成完成即出现在列表） */
export const FIRST_REQ_DELAY_MS = 0;

const reqTimers = new Map<string, number>();

/** 调度一次 AI 申请检查（删除后调用；刷新后由 runFriendReqCatchUp 补跑） */
export function scheduleCharReAddReq(app: FriendDelApp, contactId: string, delayMs = FIRST_REQ_DELAY_MS): void {
  if (typeof window === 'undefined') return;
  const key = `${app}:${contactId}`;
  const prev = reqTimers.get(key);
  if (prev) window.clearTimeout(prev);
  const timer = window.setTimeout(() => {
    reqTimers.delete(key);
    void maybeCharReAddReq(app, contactId);
  }, Math.max(0, delayMs));
  reqTimers.set(key, timer);
}

/** 启动补跑：微信/QQ 挂载时调用——扫描全部删除状态，无待处理申请的立刻补跑（定时器不跨刷新） */
export function runFriendReqCatchUp(): void {
  for (const app of ['wx', 'qq'] as FriendDelApp[]) {
    for (const id of deletedFriendIds(app)) {
      const st = friendDelStateOf(app, id);
      if (!st || st.rejected) continue; // 用户拒绝过：彻底不再申请
      // 无冷却：已删除好友且无待处理申请就立刻补发（maybeCharReAddReq 内有 pending 去重守卫）
      scheduleCharReAddReq(app, id, 0);
    }
  }
}

/** 按状态检查并生成一条 AI 加回申请（全部守卫通过才生成；无冷却，pending 去重防重复） */
export async function maybeCharReAddReq(app: FriendDelApp, contactId: string): Promise<void> {
  const st = friendDelStateOf(app, contactId);
  if (!st) return; // 已重新加回（状态清空）
  if (st.rejected) return; // 用户拒绝过：停止申请
  if (hasPendingReqFor(app, contactId)) return; // 已有待处理申请（同一联系人同时只一条）
  // B2 拉黑守卫：双向拉黑期间都不发加回申请——用户拉黑（byUser）时申请卡+验证留言直写
  // 被拉黑会话会绕过「拉黑后 AI 不能发消息」的语义；角色拉黑用户（byChar）时 AI 也不该发申请
  try {
    const blk = loadBlock(app, contactId);
    if (blk.byUser || blk.byChar) return;
  } catch {
    /* 读不到按无拉黑 */
  }
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  if (!(contact.persona ?? '').trim()) return; // 没人设的角色不生成（与主动来电候选同口径）

  const message = await genCharReqMessage(app, contact);
  if (!message) return;

  // 生成期间用户可能已重新加回（状态被清）→ 复核
  if (!friendDelStateOf(app, contactId)) return;
  addFriendReq(app, {
    id: genId(),
    contactId,
    name: displayNameOf(contact),
    avatar: contact.avatar,
    message,
    time: Date.now(),
    status: 'pending',
    source: SOURCE_CHAR_REQ,
    fromChar: true,
  });

  // AI 验证消息同步落聊天记录（kind=text + fr='greet'）：聊天界面渲染「以上是打招呼的内容」标注，
  // 用户同意后进入聊天可见（验证消息持久保留，重启不丢）；写入失败不影响申请本身
  try {
    const chatKey = `${app === 'wx' ? 'wx-chat-msgs:' : 'qq-chat-msgs:'}${contactId}`;
    const existing = kvGet<unknown[]>(chatKey);
    const list = Array.isArray(existing) ? [...existing] : [];
    list.push({ id: genId(), role: 'peer', content: message, time: Date.now(), kind: 'text', fr: 'greet' });
    kvSet(chatKey, list); // 聊天记录不封顶（此前截 100/200 条会把该会话旧记录整体挤丢）
  } catch {
    // 忽略：聊天记录不可写时申请仍有效
  }
}

/** 组 system prompt：人设 + 记忆 + 时间感知（与聊天/跨 App 找同源模块）；scene = 场景附加规则 */
async function buildReqSystem(
  app: FriendDelApp,
  contact: ContactRecord,
  userName: string,
  scene: 'apply' | 'reply' | 'welcome' = 'apply',
): Promise<string> {
  const sceneRules: Record<'apply' | 'reply' | 'welcome', string[]> = {
    apply: ['你要输出一条好友申请的验证留言，不是聊天消息。'],
    reply: ['你们正在「好友申请的验证消息」里对话（还不是好友/刚恢复好友），你要回复对方刚发的验证消息，不是聊天消息。'],
    welcome: ['对方刚通过了你的好友申请并打了一句招呼，你在「好友申请的验证消息」里回一句，不是聊天消息。'],
  };
  const persona = buildPersonaSystemPrompt(contact, {
    channel: BLOCK_CHANNEL[app],
    userName: userName || null,
    multiApp: getMemSettings(contact.id).share,
    // 多账号关系感知：小号侧申请/回复/欢迎读 relationByAcc 分账号关系，不再恒用大号全局 relation
    // （本模块的删除/申请状态本就按账号作用域，同口径）
    accountId: getActiveAccountIdFor(app),
    extraRules: sceneRules[scene],
  });
  // 多账号：小号侧追加大号记忆感知（规则三/四）；大号侧 = 纯本账号召回，输出与旧版一致
  const memoryBlock = memChatRecallBlock(contact.id, app, '');
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null });
  return [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');
}

/** 生成申请留言清洗：剥标记/动作/多行，验证留言要短（≤60 字） */
function cleanReqMessage(raw: string): string {
  let t = (raw ?? '').replace(/\[[^\][]*\]/g, ' ');
  t = cleanBubbleText(t).trim();
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  return t.slice(0, 60);
}

/** 两级兜底 LLM 调用（用户配置链路 → 内置模型；与跨 App 找同款） */
async function callLlmTwoTier(system: string, userContent: string): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: useSettings.getState().apiConfig });
    if (!raw.trim()) {
      try {
        raw = await call({ forceSdk: true });
      } catch {
        raw = '';
      }
    }
  } catch {
    return '';
  }
  return raw;
}

/** 按人设 + 记忆生成一条「被删好友想加回来」的验证留言 */
async function genCharReqMessage(app: FriendDelApp, contact: ContactRecord): Promise<string | null> {
  // 多账号 v2：机主资料按删除事件所属 App（wx/qq）的当前账号取
  // 用户规则：AI（好友申请决策）永远不知道机主昵称——机主身份只取真名
  const owner = await ownerProfileFor(app).catch(() => null);
  const userName = owner?.realName?.trim() || '用户';
  const channel = BLOCK_CHANNEL[app];

  const system = await buildReqSystem(app, contact, userName);
  const userContent = [
    `【重要情境】你发现你被「${userName}」删除了好友（${channel}上你们已经不是好友了）。`,
    `- 你很难过/意外/生气（按你的人设和你们的关系来），你决定发一条好友申请把 TA 加回来。`,
    `- 写这条申请的验证留言：一句话，30 字以内，符合你的人设和说话风格（质问「怎么把我删了」、委屈、赌气、装作若无其事、撒娇都可以）。`,
    `- 可以结合你们之间真实发生过的事（记忆），让这句话有来处。`,
    `只输出这条留言本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
  ].join('\n');

  const text = cleanReqMessage(await callLlmTwoTier(system, userContent));
  return text || null;
}

/** 取机主称呼名（线程回复生成共用；v2 多账号：按所属 App 当前账号取「我」的资料）。
 *  用户规则：AI（好友申请决策）永远不知道机主昵称——恒返回真名 */
async function ownerTriplet(app: FriendDelApp): Promise<{ userName: string }> {
  const owner = await ownerProfileFor(app).catch(() => null);
  const userName = owner?.realName?.trim() || '用户';
  return { userName };
}

/**
 * 验证消息线程里生成对方的回复（人设 + 记忆 + 时间感知）：
 * - 场景 reply：用户在待处理申请的验证消息里回复了 AI（如「你谁？」）；
 * - 场景 welcome：用户申请加好友被通过后（本应用即通），AI 在验证消息里回一句欢迎/回应。
 * 返回清洗后的回复文本（失败返回 null，调用方静默跳过——用户消息已在线程里，不丢）。
 */
export async function genCharThreadReply(
  app: FriendDelApp,
  contact: ContactRecord,
  thread: FriendReqThreadMsg[],
  scene: 'reply' | 'welcome',
): Promise<string | null> {
  if (!(contact.persona ?? '').trim()) return null;
  const { userName } = await ownerTriplet(app);
  const system = await buildReqSystem(app, contact, userName, scene);
  const lines = thread.slice(-8).map((m) => `${m.who === 'me' ? userName : contactRealNameSafe(contact)}：${m.text}`);
  const ask =
    scene === 'reply'
      ? [
        `【重要情境】你向「${userName}」发了一条好友申请，你们现在还不是好友，正在申请的验证消息里对话。`,
        `以下是目前的对话记录：`,
        ...lines,
        ``,
        `请以你的身份回复最后一条「${userName}」的话：一句话，30 字以内，符合你的人设和说话风格。`,
        `只输出这句回复本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
      ].join('\n')
      : [
        `【重要情境】「${userName}」刚刚加你为好友（${BLOCK_CHANNEL[app]}），验证消息是：`,
        ...lines,
        ``,
        `请以你的身份回一句（像通过好友后第一句打招呼）：一句话，30 字以内，符合你的人设和说话风格。`,
        `只输出这句回复本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
      ].join('\n');
  const text = cleanReqMessage(await callLlmTwoTier(system, ask));
  return text || null;
}

/** 线程展示用对方名字（备注/昵称优先，联系人在册才用真实名字；此函数不落记忆，无污染面） */
function contactRealNameSafe(contact: ContactRecord): string {
  return displayNameOf(contact) || contact.name || '对方';
}

/**
 * 用户申请加为好友（发送即通过）后，AI 在验证消息线程里回一句欢迎（一次性）：
 * 线程里已有对方发言则跳过；无人设/生成失败静默；由 UI fire-and-forget 调用。
 */
export async function charWelcomeReplyToApply(app: FriendDelApp, reqId: string, contactId: string, greeting: string): Promise<void> {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit) return;
  const base: FriendReqThreadMsg[] =
    hit.thread && hit.thread.length > 0
      ? hit.thread
      : [{ who: 'me', text: greeting, time: hit.time }];
  if (base.some((m) => m.who === 'peer')) return; // 已回过（一次性）
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  const reply = await genCharThreadReply(app, contact, base, 'welcome');
  if (!reply) return;
  // 生成期间条目可能已被替换/删除 → 复核仍在且仍无对方发言
  const fresh = loadFriendReqs(app).find((r) => r.id === reqId);
  if (!fresh) return;
  const cur: FriendReqThreadMsg[] = fresh.thread && fresh.thread.length > 0 ? fresh.thread : base;
  if (cur.some((m) => m.who === 'peer')) return;
  updateFriendReq(app, reqId, { thread: [...cur, { who: 'peer' as const, text: reply, time: Date.now() }].slice(-30) });
}

// ---------------- 小号加好友：AI 决策（同意 / 拒绝 / 先回复） ----------------

/**
 * 小号（alt 账号）加好友不再「发送即通过」，改由 AI 按人设决定：
 *
 * 【流程】小号发出好友申请（验证消息）→ 条目 status='pending'（好友标记不置位，
 * 联系人界面/会话列表不可见）→ AI 综合人设、与大号的关系、记忆、验证消息内容决策：
 * - accept：通过好友申请（置好友标记 + 条目 accepted + 线程里回一句）；
 * - reject：拒绝申请（条目 rejected + 线程里按人设回一句拒绝的话）；
 * - reply：暂不决定，先回一句（继续了解）。
 * 用户可以在验证消息线程里继续回复（详情页「回复」框），每条回复都会再次触发 AI 决策
 * ——按人设「随时可以同意」：第一句就同意、聊几句再同意、坚决拒绝都符合预期。
 * 【披露门控（用户最新规则）】默认纯陌生人：AI 不知道申请人和大号是同一个人，也读不到大号记忆、
 * 大号关系状态（规则二：零读取）；申请人可能在验证消息里被猜出/亮明身份：
 * - AI 可根据消息内容、语气、用词隐约联想并把猜测说出口（规则三），但猜测不能当成事实；
 * - 申请人在验证消息里主动亮明身份（「我是机主」/报出机主名字/承认猜测等）→ AI「认出 TA」：
 *   现实处境行换成认出口径 + 大号记忆解锁（除非条款：告诉他他是谁他才会知道）。
 */

/** AI 决策结果 */
export interface FriendDecision {
  decision: 'accept' | 'reject' | 'reply';
  /** 随决策回复的验证消息（通过后的第一句 / 拒绝的话 / 继续了解的追问） */
  message: string;
}

/** AI 决策落盘（同意 = 好友标记变化）后广播：宿主刷新联系人列表（联系人界面即时出现/保持隐藏） */
export const FRIEND_STATE_APPLIED_EVENT = 'friend-state-applied';

function emitFriendStateApplied(): void {
  try {
    window.dispatchEvent(new CustomEvent(FRIEND_STATE_APPLIED_EVENT));
  } catch {
    // 忽略
  }
}

/** 当前登录身份是否小号（alt 账号）：小号加好友走 AI 决策，大号保持「发送即通过」 */
export function isAltAccountActiveFor(app: FriendDelApp): boolean {
  return getActiveAccountIdFor(app) !== MAIN_ACCOUNT_ID;
}

/**
 * 该条申请是否走「AI 决策」链路：当前账号是小号 + 用户主动发起（非 AI 加回申请）。
 * 命中时：发送后保持 pending；线程回复触发 processAltFriendReq 重新决策。
 */
export function shouldUseAltDecisionFlow(app: FriendDelApp, req: Pick<FriendReqEntry, 'fromChar'>): boolean {
  return isAltAccountActiveFor(app) && req.fromChar !== true;
}

/**
 * 清除「删除好友」状态（不置好友标记）：小号重新发起申请时调用——
 * 避免删除状态残留在 runFriendReqCatchUp 里再触发一条 AI 加回申请（和用户的申请打架）。
 */
export function clearFriendDelState(app: FriendDelApp, contactId: string): void {
  if (!contactId) return;
  kvDel(delKey(app, contactId));
  writeDelIndex(app, contactId, false);
}

/** 大号（main 账号）是否添加过该角色（legacy 全局标记 + main 分账号标记同口径） */
function mainAccountKnowsChar(contact: ContactRecord, app: FriendDelApp): boolean {
  const byAcc = app === 'wx' ? contact.friendWxByAcc : contact.friendQqByAcc;
  if (byAcc && typeof byAcc[MAIN_ACCOUNT_ID] === 'boolean') return byAcc[MAIN_ACCOUNT_ID];
  const legacy = app === 'wx' ? contact.friendWx : contact.friendQq;
  return typeof legacy === 'boolean' ? legacy : !!contact.isFriend;
}

/** 解析 AI 决策输出：优先 JSON（容错代码块围栏/多余文本），失败按关键词兜底 */
function parseFriendDecision(raw: string): FriendDecision | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const jsonMatch = t.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { decision?: unknown; message?: unknown };
      const d = typeof obj.decision === 'string' ? obj.decision.trim().toLowerCase() : '';
      const msg = cleanReqMessage(typeof obj.message === 'string' ? obj.message : '');
      if ((d === 'accept' || d === 'reject' || d === 'reply') && msg) return { decision: d, message: msg };
    } catch {
      // JSON 解析失败走兜底
    }
  }
  const dm = t.match(/"decision"\s*:\s*"(accept|reject|reply)"/i);
  const mm = t.match(/"message"\s*:\s*"([^"]*)"/);
  if (dm) {
    const msg = cleanReqMessage(mm?.[1] ?? t.replace(jsonMatch?.[0] ?? '', ' '));
    if (msg) return { decision: dm[1].toLowerCase() as FriendDecision['decision'], message: msg };
  }
  // 关键词兜底：整段文本按首个命中关键词定性，全文清洗后截断作回复
  // 否定表述优先（「不同意/不通过」含「同意/通过」子串，先查否定防「我不同意」误判成 accept）
  const low = t.toLowerCase();
  const decision: FriendDecision['decision'] | null = /\breject\b/.test(low) || t.includes('拒绝') || t.includes('不同意') || t.includes('不通过') || t.includes('不予通过') || t.includes('不能通过') || t.includes('无法通过')
    ? 'reject'
    : /\baccept\b/.test(low) || t.includes('同意') || t.includes('通过')
      ? 'accept'
      : /\breply\b/.test(low) || t.includes('回复')
        ? 'reply'
        : null;
  if (!decision) return null;
  const msg = cleanReqMessage(t);
  return msg ? { decision, message: msg } : null;
}

/**
 * AI 决策一条小号发来的好友申请：人设 + 大号关系 + 记忆 + 验证消息线程。
 * 返回 null = 无法决策（无人设/生成失败），申请保持原状（用户可再回复触发重试）。
 */
export async function decideCharFriendReq(
  app: FriendDelApp,
  contact: ContactRecord,
  thread: FriendReqThreadMsg[],
): Promise<FriendDecision | null> {
  if (!(contact.persona ?? '').trim()) return null;
  const { userName } = await ownerTriplet(app);
  const channel = BLOCK_CHANNEL[app];
  // 【披露门控（用户最新规则）】默认纯陌生人（零大号记忆/零大号关系读取）；
  // 申请人在验证消息里亮明身份（或承认猜测）→ AI「认出 TA」，切认出口径 + 解锁大号记忆
  const altActive = isAltAccountActiveFor(app);
  const knowsChar = altActive && mainAccountKnowsChar(contact, app);
  let mainName = '机主';
  if (knowsChar) {
    const owner = await mainOwnerContact().catch(() => null);
    mainName = owner?.name?.trim() || '机主';
  }
  // B2 拉黑情境进决策（此前两套状态机互不感知：AI 拉黑了 TA 却像陌生人一样决策好友申请）
  const blockedCtxLine = (() => {
    try {
      const blk = loadBlock(app, contact.id);
      if (blk.byChar)
        return `- 注意：你之前在${channel}把 TA 拉黑了（还没解除），TA 现在发来好友申请——按你的人设决定是「气消了趁机和解」（同意=重新加好友）还是继续不想理（拒绝/reply 维持拉黑）；`;
      if (blk.byUser)
        return `- 注意：TA 之前在${channel}把你拉黑过，现在又主动发来好友申请——按你的人设想想怎么面对（可以惊讶/得意/赌气/心软，也可以借机聊开）；`;
    } catch {
      /* 读不到按无拉黑 */
    }
    return '';
  })();
  // 用户侧发言（验证留言 + 线程回复）作为披露检测文本；召回先执行（内部完成扫描+标记落盘）
  const threadMeText = thread.filter((m) => m.who === 'me').map((m) => m.text).join(' ');
  const memoryBlock = memChatRecallBlock(contact.id, app, '', { disclosureText: threadMeText, altMainName: mainName });
  const disclosed = altActive && isAltMainDisclosed(app, contact.id);
  // 认出来源区分（用户规则一）：账号关联（用户在大号侧亲口告知过「这个小号是 TA 的」）/ 申请人本侧亮明
  const linkedByMain = altActive && memAltLinked(contact.id, getActiveAccountIdFor(app));
  let mainIdentityLine = '';
  if (knowsChar) {
    const mainRelation = contact.relation?.trim() || '普通朋友';
    mainIdentityLine = disclosed
      ? linkedByMain
        ? [
            `- 用户之前在大号聊天里亲口告诉过你：这个申请人的号（${getAccountById(getActiveAccountIdFor(app))?.name?.trim() || '小号'}）也是 TA 的——所以你现在认出 TA 了：申请人就是「${mainName}」本人（你的${mainRelation}）；`,
            `  可以像老朋友/恋人重逢一样自然反应（比如惊喜「怎么换个号找我」），按你们的真实关系处理这条申请。`,
          ].join('\n')
        : [
            `- 申请人已经在验证消息里表明自己就是「${mainName}」（你的${mainRelation}）——你认出 TA 了；`,
            `  可以像老朋友/恋人重逢一样自然反应（比如惊喜「怎么换个号找我」），按你们的真实关系处理这条申请。`,
          ].join('\n')
      : [
          // 用户规则二.2/三：不再注入大号关系「现实处境」（小号场景零读取大号关系状态）；
          // 改为验证消息场景的猜测口径：可凭语气/用词/内容隐约联想并自然猜一句，但不能当真
          '- 但 TA 的验证消息内容、语气、用词可能让你隐约觉得熟悉——结合你的人设和你对用户的了解，如果让你联想到某个你认识的人，可以在回复里自然地猜一句（比如「你是不是XX？」），怎么猜按你的人设来；',
          '- 猜测只是猜测：TA 没亲口承认之前不能当成事实，也不要因为猜测就直接通过申请、或把你们「共同经历」说得言之凿凿；TA 否认就大方接受；',
          '- 只有 TA 在验证消息里亲口亮明身份（如「我就是XX」「我是你XX」）时，你才能真正确认。',
        ].join('\n');
  }

  const sceneRules = [
    '你不是在聊天，而是在处理一条「好友申请的验证消息」。申请人还不是你的好友。',
    '申请不等于必须通过：决定权完全在你手里，你不欠对方一个同意，也不需要讨好申请人。',
    '你要根据四个因素判断：你的人设性格、验证消息内容、你们是否认识、你们当前的关系状态。',
    '你的决策必须体现你自己的性格差异：高冷/警惕/慢热/社恐的人对陌生申请应倾向追问或拒绝；热情外向的人可以快一点同意，但也要看验证消息质量。绝对不要每个申请都无脑同意。',
    '你有三种处理方式：',
    '- decision=accept 直接同意：回一句通过后的反应/招呼（热情、冷淡、警惕都可以，按人设来）；',
    '- decision=reply 先回复验证消息、暂不决定：回一句追问（问问是谁、怎么知道我账号的、有什么事），等对方回答后你再决定同不同意；',
    '- decision=reject 拒绝：不喜欢加陌生人/性格警惕/有对象了/验证消息让你反感等，按人设来，拒绝也回一句话。',
    '判断依据（结合你的人设权衡）：',
    '- 验证消息是「我是XXX」：先回想你的记忆和经历里有没有「XXX」这个人——你的记忆里对 TA 毫无印象时，不要假装认识，追问一句「你是哪位？我们认识吗」或拒绝；只有你确实认识/有印象时才同意；',
    '- 验证消息是空白的、或只打了句「你好」：多数性格都会先追问一句（reply），警惕或高冷的人设可以直接拒绝；',
    '- 验证消息可疑（像广告、推销、诈骗、加好友卖东西）：拒绝，按人设回一句；',
    '- 验证消息提到你们的共同回忆/经历：和你记忆对得上时，更容易同意；',
    '- 语气无礼、冒犯：按人设怼回去并拒绝。',
    '同意的时机完全由你决定：第一句验证消息就同意、或追问聊几句再同意，都随你，只要符合你的性格。',
  ];
  // 多账号陌生语义（用户规则：小号/匿名号加 AI，AI 应该不认识）：发起申请的账号不是主号，
  // 且与角色没有任何已建立关系（分账号关系/本账号好友标记）→ 陌生身份模式：
  // 人设不再继承大号全局关系（旧逻辑回退成「朋友」，AI 看到「朋友」就直接认识申请人了）
  const reqAccId = getActiveAccountIdFor(app);
  const reqAcc = getAccountById(reqAccId);
  const strangerReq =
    !!reqAcc &&
    reqAcc.kind !== 'main' &&
    !(contact.relationByAcc?.[reqAccId] ?? '').trim() &&
    ![contact.friendWxByAcc?.[reqAccId], contact.friendQqByAcc?.[reqAccId], contact.friendSmsByAcc?.[reqAccId]].some(
      (m) => typeof m === 'boolean'
    );
  const persona = buildPersonaSystemPrompt(contact, {
    channel,
    userName: userName || null,
    multiApp: getMemSettings(contact.id).share,
    // 多账号关系感知（与上方披露门控配套）：有分账号关系记录时按 relationByAcc[当前小号] 解析，
    // 不再恒用大号全局 relation——小号处出来的独立关系不再被大号关系覆盖
    accountId: getActiveAccountIdFor(app),
    // 陌生身份模式：AI 按「一个不认识的人发来好友申请」决策（结合人设/验证消息/披露门控猜测规则）
    ...(strangerReq ? { strangerMode: 'text' as const } : {}),
    extraRules: sceneRules,
  });
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null });
  const system = [persona, memoryBlock, timeBlock, mainIdentityLine, blockedCtxLine].filter(Boolean).join('\n\n');

  const lines = thread.slice(-8).map((m) => {
    const who = m.who === 'me' ? userName : contactRealNameSafe(contact);
    const text = m.text.trim();
    return `${who}：${text || (m.who === 'me' ? '（没有填写验证消息，是空白申请）' : '（未发言）')}`;
  });
  const ask = [
    `【重要情境】「${userName}」通过${channel}找到你的账号，发来一条好友申请（你们现在还不是好友）。验证消息对话如下：`,
    ...lines,
    ``,
    `请以你的身份决策这条申请。先结合你的人设性格、你们是否认识、验证消息内容想一想这条申请放在你面前你会怎么处理，然后输出一行 JSON（不要输出任何其他内容）：`,
    `{"decision":"accept","message":"..."} 同意好友申请；`,
    `{"decision":"reject","message":"..."} 拒绝好友申请；`,
    `{"decision":"reply","message":"..."} 暂不决定，先回复一句追问。`,
    `message 是你回在验证消息里的一句话，30 字以内，符合你的人设和说话语气。`,
  ].join('\n');

  const raw = await callLlmTwoTier(system, ask);
  return parseFriendDecision(raw);
}

/**
 * 处理一条小号发起的好友申请（发送时 + 用户每次在线程里回复后调用）：
 * 读取申请 → AI 决策 → 落盘结果（状态/好友标记/线程回复/聊天记录成功提示）。
 * 全程静默失败：决策不可用时申请保持原状，等待用户下一次回复再触发。
 */
export async function processAltFriendReq(app: FriendDelApp, reqId: string, contactId: string): Promise<void> {
  const entry = loadFriendReqs(app).find((r) => r.id === reqId);
  if (!entry || entry.fromChar) return;
  if (entry.status !== 'pending' && entry.status !== 'rejected') return; // 已终态（accepted）不再处理
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  const thread: FriendReqThreadMsg[] =
    entry.thread && entry.thread.length > 0
      ? entry.thread
      : entry.message.trim()
        ? [{ who: 'me', text: entry.message, time: entry.time }]
        : [];
  if (!thread.some((m) => m.who === 'me')) return; // 没有用户发言，无从决策

  const decision = await decideCharFriendReq(app, contact, thread);
  if (!decision) return;

  // 生成期间状态可能已变化（用户撤回/又回复/条目被清）→ 复核仍是同一条可处理的申请
  const fresh = loadFriendReqs(app).find((r) => r.id === reqId);
  if (!fresh || fresh.fromChar) return;
  if (fresh.status !== 'pending' && fresh.status !== 'rejected') return;
  const curThread: FriendReqThreadMsg[] =
    fresh.thread && fresh.thread.length > 0
      ? fresh.thread
      : fresh.message.trim()
        ? [{ who: 'me', text: fresh.message, time: fresh.time }]
        : [];
  if (curThread.length !== thread.length) return; // 期间有新发言：本次决策作废，等下一轮

  if (decision.decision === 'accept') {
    // 通过：置好友标记（当前账号作用域）+ 清删除状态（历史数据恢复可见）+ 条目置 accepted
    try {
      await restoreFriendship(app, contactId);
    } catch {
      // 联系人更新失败时仍流转状态（下次重新添加可恢复）
    }
    setFriendReqStatus(app, reqId, 'accepted');
    updateFriendReq(app, reqId, {
      thread: [...curThread, { who: 'peer' as const, text: decision.message, time: Date.now() }].slice(-30),
    });
    // 聊天记录落「已添加成功」提示 + AI 的同意回复同步落一条进聊天记录：
    // 同意回复不只留在验证消息线程里——打开聊天就能看到对方通过后说的第一句话
    //（sys 提示在前，AI 回复紧随其后；写入失败不影响好友状态）
    try {
      const chatKey = `${app === 'wx' ? 'wx-chat-msgs:' : 'qq-chat-msgs:'}${contactId}`;
      const existing = kvGet<unknown[]>(chatKey);
      const list = Array.isArray(existing) ? [...existing] : [];
      const now = Date.now();
      list.push({
        id: genId(),
        role: 'peer',
        content: '',
        time: now,
        kind: 'sys',
        sys: { text: '我们已成功添加为好友，现在可以开始聊天啦～' },
        fr: 'added',
      });
      if (decision.message.trim()) {
        list.push({ id: genId(), role: 'peer', content: decision.message, time: now + 1, kind: 'text' });
      }
      kvSet(chatKey, list); // 聊天记录不封顶（同上）
    } catch {
      // 聊天记录写入失败不影响好友状态
    }
    emitFriendStateApplied();
    return;
  }

  if (decision.decision === 'reject') {
    // 拒绝：条目置 rejected（用户仍可在验证消息线程里回复 → 再次触发决策，按人设「随时可以同意」）
    setFriendReqStatus(app, reqId, 'rejected');
    updateFriendReq(app, reqId, {
      thread: [...curThread, { who: 'peer' as const, text: decision.message, time: Date.now() }].slice(-30),
    });
    emitFriendStateApplied();
    return;
  }

  // reply：暂不决定，先回一句（保持 pending）
  updateFriendReq(app, reqId, {
    thread: [...curThread, { who: 'peer' as const, text: decision.message, time: Date.now() }].slice(-30),
  });
}
