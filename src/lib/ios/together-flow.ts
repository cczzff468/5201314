'use client';

/**
 * 一起听邀请/同意卡片链路（第二十四轮）：
 *
 * - 我邀请 AI 一起听时，我也要在聊天里发一张「邀请你一起听」歌曲卡片（kind='song' + inviteDone）；
 * - 同意卡只有「接受方」发一张（第二十五轮反馈）：我邀请 → TA 接受 → 只有 TA 发「已同意一起听」；
 *   AI 邀请被接受（全局邀请卡 ✓）→ 我是接受方 → 只有我发「已同意一起听」，TA（邀请方）不再补发；
 * - 卡片落库与音乐 App 分享同款（kv 直写 wx/qq-chat-msgs）；聊天页在场时由调用方传 insert
 *   实时插入（setMsgs + saveMsgs），不在场时 kv 直写（回到聊天页 loadMsgs 恢复）；
 * - 【39 聚合制】邀请/接受不再各自写角色记忆——一起听听过的歌由 music-ai 的聚合缓冲攒批
 *   （sourceTag='music-play'），一次一起听合并一条。
 */

import { kvGet, kvSet } from './idb-kv';
import { loadActiveTogether, startTogether } from './music-ai';
import type { ContactRecord } from '../contacts';

// ---------------- 卡片消息构造 ----------------

export interface TgCardSong {
  id?: number;
  name: string;
  artist: string;
  cover?: string;
}

/** 一起听卡片消息（微信/QQ 的 kind:'song' 消息同构，调用方按需 cast） */
export interface TgCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'song';
  song: {
    name: string;
    artist: string;
    cover?: string;
    songId?: number;
    inviteDone?: boolean;
    agree?: boolean;
  };
}

function genCardId(): string {
  return `tgc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 构造一起听卡片：kind='invite' 邀请卡（我发）/ kind='agree' 同意卡（接受方发一张） */
export function buildTgCardMsg(role: 'me' | 'peer', kind: 'invite' | 'agree', song: TgCardSong): TgCardMsg {
  const label = song.artist ? `《${song.name}》（${song.artist}）` : `《${song.name}》`;
  return {
    id: genCardId(),
    role,
    content: kind === 'invite' ? `[邀请一起听]${label}` : `[一起听]${label}`,
    time: Date.now(),
    kind: 'song',
    song: {
      name: song.name,
      artist: song.artist,
      cover: song.cover || undefined,
      songId: song.id || undefined,
      inviteDone: kind === 'invite' || undefined,
      agree: kind === 'agree' || undefined,
    },
  };
}

/** kv 直插一张卡片（聊天页不在场时用；在场走 insert 回调实时刷新）；
 *  插入后广播 TG_CARD_INSERTED_EVENT —— 聊天页在场时监听实时合并（第二十六轮：
 *  修复「开着聊天页点 ✓ 接受 AI 邀请，同意卡落库后要重开聊天才显示」） */
export const TG_CARD_INSERTED_EVENT = 'music-tg-card-inserted';

function kvInsertCard(cid: string, app: 'wx' | 'qq', msg: TgCardMsg): void {
  const key = app === 'wx' ? `wx-chat-msgs:${cid}` : `qq-chat-msgs:${cid}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg]); // 聊天记录不封顶（此前截 100 条会把旧记录挤丢）
    try {
      window.dispatchEvent(new CustomEvent(TG_CARD_INSERTED_EVENT, { detail: { cid, app } }));
    } catch {
      // 广播失败不影响落库
    }
  } catch {
    // 落库失败静默（会话仍会建立）
  }
}

/** 联系人最近聊天的 App（wx/qq 最后一条消息时间较晚者；都没有则 wx） */
export async function lastChatAppOf(cid: string): Promise<'wx' | 'qq'> {
  try {
    const wx = kvGet<{ time?: number }[]>(`wx-chat-msgs:${cid}`);
    const qq = kvGet<{ time?: number }[]>(`qq-chat-msgs:${cid}`);
    const wxT = Number(wx?.[wx.length - 1]?.time ?? 0);
    const qqT = Number(qq?.[qq.length - 1]?.time ?? 0);
    return qqT > wxT ? 'qq' : 'wx';
  } catch {
    return 'wx';
  }
}

// ---------------- 我邀请 AI 一起听（播放器邀请面板 / 聊天加号面板） ----------------

export interface UserInviteOptions {
  contact: ContactRecord;
  /** 卡片发到哪个 App 的聊天 */
  app: 'wx' | 'qq';
  song: TgCardSong;
  /** 聊天页在场时的实时插入（setMsgs + saveMsgs）；缺省 = kv 直写 */
  insert?: (msg: TgCardMsg) => void;
}

/**
 * 我邀请 TA 一起听：
 * 1. 立即发「邀请你一起听」卡片（我方）；
 * 2. 1.3~2.6s 后 AI「接受」→ 只有 TA（接受方）发同意卡 → 建一起听会话；
 * 3. 【39 聚合制】邀请/接受不再单独写记忆（原「发了邀请卡片」「接受了邀请正在一起听《X》」
 *    每次邀请各一条刷爆记忆库）——一起听听过的歌由 music-ai 聚合缓冲攒批，
 *    攒满/退出/切后台时合并写一条（startTogether 会把邀请时正在放的歌记进缓冲）。
 */
export function sendUserTogetherInvite(opts: UserInviteOptions): void {
  const { contact, app, song, insert } = opts;
  const put = (msg: TgCardMsg) => {
    if (insert) {
      try {
        insert(msg);
      } catch {
        kvInsertCard(contact.id, app, msg);
      }
    } else {
      kvInsertCard(contact.id, app, msg);
    }
  };
  // 已在和 TA 一起听：不重发卡片，直接确保会话在
  try {
    const act = loadActiveTogether();
    if (act?.contactId === contact.id) {
      startTogether(contact);
      return;
    }
  } catch {
    // 忽略
  }
  // 1. 我方邀请卡
  put(buildTgCardMsg('me', 'invite', song));
  if (contact.kind !== 'char') return; // 只有 AI 角色会接受
  // 2. AI 接受（延迟拟真）
  window.setTimeout(
    () => {
      put(buildTgCardMsg('peer', 'agree', song)); // 只有接受方（TA）发同意卡（第二十五轮反馈，我方不再补发）
      try {
        startTogether(contact);
      } catch {
        // 会话失败卡片保留
      }
    },
    1300 + Math.floor(Math.random() * 1300),
  );
}

// ---------------- AI 邀请被接受（全局邀请卡 ✓） ----------------

/**
 * AI 一起听邀请被接受后，只有接受方（我）发一张「已同意一起听」卡片
 * （第二十五轮反馈：邀请方 TA 不再补发同意卡）。聊天页多半不在场（全局弹卡），走 kv 直写。
 */
export function sendAgreeCardForAccept(cid: string, song: TgCardSong): void {
  void (async () => {
    const app = await lastChatAppOf(cid);
    kvInsertCard(cid, app, buildTgCardMsg('me', 'agree', song));
  })();
}
