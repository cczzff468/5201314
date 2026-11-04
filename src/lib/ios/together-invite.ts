'use client';

/**
 * AI 邀请一起听 —— 全局邀请中心（Task 68 音乐 App × AI 深度互动）：
 *
 * - zustand store 持有当前待处理的邀请快照（角色名/头像/歌名），TogetherInviteLayer
 *   （PhoneShell 常驻挂载）订阅渲染：不管在哪个 App、甚至主屏幕，卡片都会弹出；
 * - 触发源①：聊天里 AI 输出 [邀请一起听:歌名:歌手] 标记（wechat/qq 解析富标记时调用 trigger）；
 * - 触发源②：TogetherInviteWatcher 全局调度（App 不打开也生效）——按人设/听歌数据概率性
 *   主动邀约：守卫（锁屏/来电/通话/已有邀请/已在听/冷却）→ 选最近聊过的 AI 角色 → 从
 *   最近播放里挑一首「TA 想和你一起听」的歌；
 * - 接受：startTogether 建会话 → switchToApp('music') → 进播放页（一起听模式）；
 * - 【39 聚合制】邀约/接受不再写记忆（邀约→接受→一起听是同一件事，一次最多一条）——
 *   接受后听听过的歌由 music-ai 聚合缓冲攒批写（startTogether 已把正在放的歌记进缓冲）；
 *   只有「拒绝」单独写一条（独立社交信号，角色下次聊天接得住「刚才不想听」）；
 * - 冷却持久化（全局 12 分钟 / 每角色 8 小时），按网易云账号隔离（键带 uid）。
 */

import { create } from 'zustand';
import { kvGet, kvSet, kvGetScoped } from './idb-kv';
import { musicUid } from './music-api';
import { useUI } from './store';
import { useIncomingCall } from './incoming-call';
import { useGlobalCall } from './global-call';
import { useMusic } from './music-store';
import { getContact, listContacts } from './contacts-store';
import { userBlockedAnywhere } from './block-state';
import { loadActiveTogether, startTogether } from './music-ai';
import { sendAgreeCardForAccept } from './together-flow';
import { memAddEventFragment } from '../memory';
import type { ContactRecord } from '../contacts';

// ---------------- 类型与 store ----------------

export interface TogetherInvite {
  id: string;
  contactId: string;
  /** 角色名（邀请人） */
  name: string;
  /** 角色头像 */
  avatar: string;
  /** 邀请一起听的歌 */
  songName: string;
  artist: string;
}

interface TogetherInviteState {
  invite: TogetherInvite | null;
  trigger: (inv: TogetherInvite) => void;
  clear: () => void;
}

export const useTogetherInvite = create<TogetherInviteState>((set, get) => ({
  invite: null,
  trigger: (inv) => {
    // 已有待处理邀请：后来的忽略（不叠加打扰）
    if (get().invite) return;
    set({ invite: { ...inv, id: inv.id || genInviteId() } });
  },
  clear: () => set({ invite: null }),
}));

function genInviteId(): string {
  return `tinv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 触发方统一入口（补 id） */
export function triggerTogetherInvite(inv: Omit<TogetherInvite, 'id'>): void {
  useTogetherInvite.getState().trigger({ ...inv, id: genInviteId() });
}

// ---------------- 冷却（按网易云账号隔离） ----------------

/** 全局冷却：两次主动邀约最少间隔（聊天里 AI 标记触发不受此限） */
const GLOBAL_COOLDOWN_MS = 12 * 60_000;
/** 每角色冷却 */
const PER_CONTACT_COOLDOWN_MS = 8 * 60 * 60_000;

function globalLastKey(): string {
  return `music-invite-last:${musicUid()}`;
}
function contactLastKey(cid: string): string {
  return `music-invite-cid:${musicUid()}:${cid}`;
}

function inCooldown(cid: string): boolean {
  const now = Date.now();
  if (now - (kvGet<number>(globalLastKey()) ?? 0) < GLOBAL_COOLDOWN_MS) return true;
  if (now - (kvGet<number>(contactLastKey(cid)) ?? 0) < PER_CONTACT_COOLDOWN_MS) return true;
  return false;
}

function markInvited(cid: string): void {
  kvSet(globalLastKey(), Date.now());
  kvSet(contactLastKey(cid), Date.now());
}

// ---------------- 接受 / 拒绝 ----------------

async function ownerName(): Promise<string> {
  try {
    const { ownerRealName } = await import('./contacts-store');
    return (await ownerRealName()) || '机主';
  } catch {
    return '机主';
  }
}

/** 写角色记忆（一起听邀约相关事件） */
export async function writeInviteMemory(contactId: string, what: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c || c.kind !== 'char') return;
    const who = await ownerName();
    memAddEventFragment(contactId, 'wx', `${who}和${c.nickname || c.name}${what}`, {
      eventTime: Date.now(),
      sourceTag: 'music-invite',
    });
  } catch {
    // 记忆失败静默
  }
}

/**
 * 接受邀请：清卡片 → 建一起听会话 → 切到音乐 App → 进播放页。
 * （音乐 App 未打开时 switchToApp 会挂载 MusicApp，bootMusicAi 恢复会话；openPlayer 延迟到挂载完成）
 * 【39 聚合制】接受不再单独写记忆（原「接受了XX的一起听邀请」逐条刷记忆库）——
 * 一起听听过的歌由 music-ai 聚合缓冲攒批合并写一条（startTogether 已把正在放的歌记进缓冲）。
 */
export async function acceptTogetherInvite(): Promise<void> {
  const inv = useTogetherInvite.getState().invite;
  useTogetherInvite.getState().clear();
  if (!inv) return;
  try {
    const contact = await getContact(inv.contactId);
    if (contact && contact.kind === 'char') {
      startTogether(contact);
      // 同意卡只有接受方（我）发一张（第二十五轮反馈，TA 邀请方不再补发）
      sendAgreeCardForAccept(inv.contactId, { name: inv.songName, artist: inv.artist });
      const ui = useUI.getState();
      if (ui.activeApp !== 'music') ui.switchToApp('music');
      else useMusic.getState().openPlayer();
      // App 挂载动画 ~380ms，延后进播放页保证 nav 已就绪
      window.setTimeout(() => useMusic.getState().openPlayer(), 450);
    }
  } catch {
    // 接受失败静默（卡片已清，不残留）
  }
}

/** 拒绝邀请：清卡片 + 记忆（角色下次聊天能接得住「刚才不想听」） */
export async function declineTogetherInvite(): Promise<void> {
  const inv = useTogetherInvite.getState().invite;
  useTogetherInvite.getState().clear();
  if (!inv) return;
  markInvited(inv.contactId); // 拒绝后也进入冷却，别马上又来
  await writeInviteMemory(inv.contactId, `拒绝了${inv.name}的一起听邀请（《${inv.songName}》），没有说明原因`);
}

// ---------------- 全局调度（TogetherInviteWatcher 每 60s 一跳） ----------------

/** 单次决策概率 */
const TICK_PROBABILITY = 0.1;
/** 听歌数据里挑歌的范围（跳过最上面正在听/刚听的几首，从 1~12 里随机） */
const PICK_FROM_HISTORY = 12;

/** 挑一个邀约对象：最近聊过天的 AI 角色 → 最近一起听过的 → 任意 char（都按最近活跃排序） */
async function pickContact(): Promise<ContactRecord | null> {
  try {
    const all = await listContacts();
    const chars = all.filter((c) => c.kind === 'char');
    if (chars.length === 0) return null;
    const now = Date.now();
    const scored = chars
      .map((c) => {
        let lastTs = 0;
        // 三个聊天 App 各自的当前账号会话最后一条消息时间（wx/qq/sms）
        for (const [app, prefix] of [
          ['wx', 'wx-chat-msgs:'],
          ['qq', 'qq-chat-msgs:'],
          ['sms', 'ios-chat-msgs:'],
        ] as const) {
          try {
            const key = app === 'sms' ? `${prefix}c:${c.id}` : `${prefix}${c.id}`;
            const msgs = kvGetScoped<{ time?: number }[]>(key, app);
            if (Array.isArray(msgs) && msgs.length > 0) {
              const t = Number(msgs[msgs.length - 1]?.time ?? 0);
              if (Number.isFinite(t) && t > lastTs) lastTs = t;
            }
          } catch {
            // 单 App 读取失败跳过
          }
        }
        return { c, lastTs, fresh: now - lastTs < 7 * 24 * 3600_000 };
      })
      .filter((x) => x.lastTs > 0 && x.fresh)
      .sort((a, b) => b.lastTs - a.lastTs);
    const pool = scored.length > 0 ? scored : [];
    if (pool.length === 0) return null;
    // 70% 找最近聊得最多的，30% 随机换换口味
    if (Math.random() < 0.7) return pool[0].c;
    return pool[Math.floor(Math.random() * pool.length)].c;
  } catch {
    return null;
  }
}

/** 从听歌数据挑一首「TA 想邀你听」的歌名（网易云账号最近播放；空则 null） */
function pickSong(): { name: string; artist: string } | null {
  try {
    const uid = musicUid();
    const hist = kvGet<{ song?: { name?: unknown; artists?: unknown[] } }[]>(`music-history:${uid}`);
    const list = Array.isArray(hist) ? hist : [];
    if (list.length < 1) return null;
    const from = Math.min(1, list.length - 1);
    const to = Math.min(PICK_FROM_HISTORY, list.length);
    const idx = from + Math.floor(Math.random() * Math.max(1, to - from));
    const song = list[Math.min(idx, list.length - 1)]?.song;
    const name = typeof song?.name === 'string' ? song.name.trim() : '';
    if (!name) return null;
    let artist = '';
    const arts = Array.isArray(song?.artists) ? song.artists : [];
    const first = arts[0] as { name?: unknown } | undefined;
    if (first && typeof first.name === 'string') artist = first.name;
    return { name, artist };
  } catch {
    return null;
  }
}

/** 互斥守卫：锁屏/熄屏/来电/通话/已在听/已有邀请/冷却/概率 → true = 本跳跳过 */
function tickGuarded(cid: string): boolean {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return true;
  if (useIncomingCall.getState().call) return true;
  if (useGlobalCall.getState().session) return true;
  if (useTogetherInvite.getState().invite) return true;
  if (loadActiveTogether()) return true;
  if (inCooldown(cid)) return true;
  if (Math.random() >= TICK_PROBABILITY) return true;
  return false;
}

/** 调度器单跳（TogetherInviteWatcher 调用；音乐 App 打不开/没数据时全部静默跳过） */
export async function runTogetherInviteTick(): Promise<void> {
  try {
    if (useTogetherInvite.getState().invite) return;
    // 没有任何听歌数据时 AI 无从邀约（也避免游客刚装就弹）
    const c = await pickContact();
    if (!c) return;
    // B2：用户拉黑了该联系人（任一文字 App）→ AI 不再自发邀约一起听（拉黑期间的全域自发静默）
    if (userBlockedAnywhere(c.id)) return;
    if (tickGuarded(c.id)) return;
    const song = pickSong();
    if (!song) return;
    markInvited(c.id);
    triggerTogetherInvite({
      contactId: c.id,
      name: c.nickname || c.name,
      avatar: c.avatar || '',
      songName: song.name,
      artist: song.artist,
    });
    // 【39 聚合制】邀约本身不写记忆：接受 → 聚合记忆一条；拒绝 → 拒绝记忆一条；忽略 → 零条
    //（原「向你发起了一起听邀请…等你接受」与后续接受/拒绝记忆重复记录同一件事）
  } catch {
    // 后台增强能力：任何异常静默
  }
}

/** 聊天富标记触发入口（wechat/qq 解析 [邀请一起听:歌名:歌手] 时调用） */
export function triggerInviteFromChat(contact: { id: string; name: string; avatar?: string | null }, songName: string, artist: string): void {
  try {
    triggerTogetherInvite({
      contactId: contact.id,
      name: contact.name,
      avatar: contact.avatar || '',
      songName,
      artist,
    });
  } catch {
    // 静默
  }
}
