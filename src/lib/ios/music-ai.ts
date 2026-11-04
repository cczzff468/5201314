'use client';

/**
 * 音乐 App AI 互动层：
 *
 * 1. 一起听（邀 AI 角色一起听歌）：
 *    - 活跃会话持久化 kv music-together-active:{uid}（重启恢复）；
 *    - 消息持久化 kv music-together:{uid}:{cid}（按网易云账号 + 角色隔离）；
 *    - AI 回复走两级 LLM（用户上游 → 内置 SDK），system = 角色人设 + 记忆 + 音乐情境块
 *      （正在听的歌/进度/歌词/最近听歌历史/一起听消息）；
 *    - 第二十一轮反馈：删除「AI 主动点评歌曲」（空闲定时唠嗑/切歌点评/暂停搭话全部移除），
 *      AI 只在用户发消息、用户点推荐、睡前提醒（F）时说话；
 *    - 第二十三轮反馈：修复「AI 回复被音乐带偏，不回应用户的话」——
 *      用户消息永远最高优先（先接住再聊别的），音乐只是背景不能压过用户的话；
 *      一起听与单独播放（所有聊天 App 的音乐动态注入）共用同一套优先级逻辑。
 *    - 第三十五轮反馈：修复「AI 一直在发信息」——暂停久置轻问每段暂停至多一次
 *      （原实现暂停期间反复重排定时器）+ 主动消息全局 15 分钟冷却；
 *      主动消息提示词改为人设/记忆/上下文驱动，明确不点评歌曲。
 *    - Task 20（修复聊天人设/上下文/复读）：回复链改「真多轮 messages」——
 *      system（人设/记忆/跨App/音乐情境/规则）+ 最近 12 轮真实历史（机主=user、AI=assistant，旧→新）
 *      + 当前消息作最后一条 user 轮；不再把聊天记录压平进 system（同一条消息不再出现两次）；
 *      上游与 SDK 兜底都带 temperature（未配置时默认 0.9）驱动多样性；防复读升级：最多 3 次尝试、
 *      被拒草稿回灌最后一条 user 轮、草稿开头 4 字与最近 5 轮 AI 回复查重；
 *      生成中来新消息不再静默丢弃（1 槽排队，只留最新一条，当前回复结束后接着回）；
 *      联系人库读取失败时回退最小内联人设，不再裸奔音乐块。
 * 2. AI 推荐歌曲：LLM 返回 JSON 歌单 → /search 匹配真实曲库 → 消息内歌曲卡（点击播放）；
 * 3. 多条消息连发（Task 21）：回复拆成 3~10 条短消息逐条投递（内容多多发/少少发），
 *    每条间隔 650~1200ms 模拟真人连发；浮窗气泡与聊天流均按多气泡呈现；
 * 4. 听歌记忆：【39 聚合制】一起听的歌/结束不再逐条写记忆——会话内攒批（歌名去重保序），
 *    攒满 5 首、退出一起听或切后台时合并写一条（memAddEventFragment, sourceTag='music-play'），
 *    自动参与后续所有聊天 App 的记忆召回——无需改任何聊天代码；
 *    solo 听歌同理（24h/8 首阈值合并一条，sourceTag='music-solo'）。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from './persona';
import { memAddEventFragment, memChatRecallBlock, getMemSettings } from '../memory';
import { listContacts, getContact, ownerRealName } from './contacts-store';
import { avatarFor, type ContactRecord } from '../contacts';
import { kvGet, kvSet, kvDel } from './idb-kv';
import { readInviteMeta, COUPLE_STATE_EVENT } from './couple-invite';
import { useSettings } from './store';
import { useEffect, useState } from 'react';
import { useMusic, setSongPlayedHook } from './music-store';
import { search, songArtistText, musicUid, type NcmSong } from './music-api';
import { buildCrossContextBlocks } from './cross-app-context';
// 【100-d】播控教学收敛单一来源：指令教学行从 music-remote 的共享生成器取（与本模块
// extractTgControls 的解析正则一一对应）。循环依赖是有意为之且安全：两侧都只在运行时函数内
// 使用对方导出（本文件用 playControlCommonLines，music-remote 用 searchSongMatched），无模块级求值。
import { playControlCommonLines } from './music-remote';

// ---------------- 类型 ----------------

export interface TgRecSong {
  id: number;
  name: string;
  artist: string;
  picUrl?: string;
}

export interface TgMsg {
  id: string;
  /** 'me' | 'peer' | 'recs'（推荐歌曲卡） */
  role: 'me' | 'peer' | 'recs';
  text: string;
  time: number;
  /** role=recs 时携带 */
  songs?: TgRecSong[];
  /** 消息生成失败标记（旧数据兼容字段；新失败改打在触发消息的 replyFail 上，不再落占位气泡） */
  error?: boolean;
  /** 这条「我」的消息触发的一轮 AI 回复失败：气泡旁红色 ! 徽标，点击重新生成 */
  replyFail?: boolean;
  /** 重试类型：chat=重新生成回复 / recs=重新推荐歌曲（缺省 chat） */
  retryKind?: 'chat' | 'recs';
}

export interface TogetherSession {
  contactId: string;
  name: string;
  avatar: string;
  /** 虚构距离（公里，按角色稳定） */
  distanceKm: number;
  /** 展示锚点 = 累计起点（现在 - 历史累计时长）：退出后重进，时长接着上次累计 */
  since: number;
  /** 本次段落真实开始时间（退出时把这段累加进总数） */
  segStart?: number;
}

const ACTIVE_KEY_PREFIX = 'music-together-active:';
const MSGS_KEY_PREFIX = 'music-together:';
/** 每个角色的累计一起听时长（毫秒，永久保存：退出累加，重进接着算） */
const DUR_KEY_PREFIX = 'music-tg-dur:';
/** 用户自定义距离（第三十八轮）：按角色记，重新邀请同一角色时继续沿用 */
const DIST_CUST_KEY_PREFIX = 'music-tg-dist-cust:';

function activeKey(): string {
  return `${ACTIVE_KEY_PREFIX}${musicUid()}`;
}
function msgsKey(cid: string): string {
  return `${MSGS_KEY_PREFIX}${musicUid()}:${cid}`;
}
function durKey(cid: string): string {
  return `${DUR_KEY_PREFIX}${musicUid()}:${cid}`;
}
function distCustKey(cid: string): string {
  return `${DIST_CUST_KEY_PREFIX}${musicUid()}:${cid}`;
}

const SONGPLAY_KEY_PREFIX = 'music-tg-songplay:';
function songPlayKey(cid: string, songId: number): string {
  return `${SONGPLAY_KEY_PREFIX}${musicUid()}:${cid}:${songId}`;
}

/** B（第二十轮）：同一首歌「一起听过几遍」真实计数（一起听中每放一首新歌 +1），
 *  供 AI 说「这是我们一起听的第三遍了」这类基于事实的话 */
function bumpTogetherSongPlay(cid: string, songId: number): void {
  try {
    kvSet(songPlayKey(cid, songId), (kvGet<number>(songPlayKey(cid, songId)) ?? 0) + 1);
  } catch {
    /* 静默 */
  }
}

function togetherSongPlayCount(cid: string, songId: number): number {
  return kvGet<number>(songPlayKey(cid, songId)) ?? 0;
}

/** 读取与某角色的累计一起听时长（毫秒） */
export function togetherTotalMs(cid: string): number {
  return kvGet<number>(durKey(cid)) ?? 0;
}

/** 把当前活跃会话的这一段时长累加进总数（退出/换人前调用） */
function accumulateSegment(s: TogetherSession | null): void {
  if (!s) return;
  const seg = s.segStart ? Math.max(0, Date.now() - s.segStart) : 0;
  if (seg <= 0) return;
  kvSet(durKey(s.contactId), togetherTotalMs(s.contactId) + seg);
}

/** 格式化累计时长（X小时Y分钟 / Y分钟） */
export function fmtTogetherDur(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分钟` : `${mins}分钟`;
}

// ---------------- 会话管理 ----------------

export function loadActiveTogether(): TogetherSession | null {
  return kvGet<TogetherSession>(activeKey());
}

/** 自定义一起听距离（第三十八轮）：用户点击「相距 N 公里」的数字后手动填写。
 *  写活跃会话快照 + store 立即生效 + 按角色持久化（重新邀请同一角色时沿用）；无活跃会话时静默。 */
export function setTogetherDistance(km: number): void {
  const s = loadActiveTogether();
  if (!s || !Number.isFinite(km) || km <= 0) return;
  const next: TogetherSession = { ...s, distanceKm: Math.min(9_999_999, Math.round(km)) };
  kvSet(activeKey(), next);
  kvSet(distCustKey(s.contactId), next.distanceKm);
  useMusic.setState({ together: next });
}

export function startTogether(contact: ContactRecord): TogetherSession {
  // 若已有活跃会话，先把那段时长累加进对应角色（不丢失）
  accumulateSegment(loadActiveTogether());
  // 距离：按角色 id+region 稳定虚构（50~1800 km）
  const seedStr = `${contact.id}:${contact.region ?? ''}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  const distanceKm = kvGet<number>(distCustKey(contact.id)) ?? 50 + (h % 1750);
  const now = Date.now();
  // 时长永久累计：since 锚点 = 现在 - 历史累计（下次邀请从上次的时长继续）
  const carriedMs = togetherTotalMs(contact.id);
  const session: TogetherSession = {
    contactId: contact.id,
    name: contact.nickname || contact.name,
    avatar: contact.avatar || '',
    distanceKm,
    since: now - carriedMs,
    segStart: now,
  };
  kvSet(activeKey(), session);
  useMusic.setState({ together: session, togetherMsgs: loadTogetherMsgs(contact.id) });
  // 【39 聚合制】邀请时正在放的那首歌进聚合缓冲（它不会触发 setSongPlayedHook 的新歌事件，
  // 不主动记的话聚合记忆会漏掉一起听的第一首）
  const cur = useMusic.getState().current;
  if (cur) noteTogetherListen(contact.id, { name: cur.name, artist: songArtistText(cur) });
  return session;
}

export async function stopTogether(): Promise<void> {
  const s = loadActiveTogether();
  if (s) {
    accumulateSegment(s); // 本段时长写入累计总数
    flushTgChatLog(s.contactId); // 一起听聊天内容落记忆（第二十四轮）
    kvDel(activeKey());
    useMusic.setState({ together: null });
    // 【39 聚合制】结束时把本次会话听过的歌 + 累计时长合并写一条记忆
    //（不再单独写「结束了这次一起听」——与歌曲聚合合并，一次一起听一条）
    await flushTogetherMemory(s.contactId, Date.now() - s.since);
  } else {
    kvDel(activeKey());
    useMusic.setState({ together: null });
  }
}

export function loadTogetherMsgs(cid: string): TgMsg[] {
  return kvGet<TgMsg[]>(msgsKey(cid)) ?? [];
}

/** 聊天记录不封顶（用户反馈：以前只留最近 100 条，聊多了旧的一起听聊天记录被挤丢；kv 已在 IndexedDB，容量够用） */
function saveTogetherMsgs(cid: string, msgs: TgMsg[]): void {
  kvSet(msgsKey(cid), msgs);
}

function appendMsg(cid: string, m: TgMsg): void {
  const cur = useMusic.getState();
  const list = cur.together?.contactId === cid ? cur.togetherMsgs : loadTogetherMsgs(cid);
  const next = [...list, m];
  saveTogetherMsgs(cid, next);
  if (cur.together?.contactId === cid) {
    useMusic.setState({ togetherMsgs: next });
  }
  // 一起听聊天记忆（第二十四轮）：双方消息都记入会话日志，攒够一批写进角色记忆
  if (m.role === 'me' || m.role === 'peer') logTgChatLine(cid, m.role, m.text);
}

/** 单条消息 patch（读→改→写，setState 同步）：replyFail 徽标打标/清标用 */
function patchTgMsg(cid: string, msgId: string, patch: Partial<TgMsg>): void {
  const cur = useMusic.getState();
  const list = cur.together?.contactId === cid ? cur.togetherMsgs : loadTogetherMsgs(cid);
  const next = list.map((m) => (m.id === msgId ? { ...m, ...patch } : m));
  saveTogetherMsgs(cid, next);
  if (cur.together?.contactId === cid) {
    useMusic.setState({ togetherMsgs: next });
  }
}

// ---------------- 一起听聊天记忆（第二十四轮：听的什么歌、聊的什么都记在记忆里） ----------------

/** 歌曲记忆已有（installMusicAiHook 每次换歌写一笔）；这里补聊天内容：
 *  会话日志内存缓冲，每满 6 条（或退出一起听时）合并写成一条记忆碎片，
 *  避免每句话一条碎片刷爆记忆库；sourceTag='music-chat' 参与后续聊天召回。 */
const TG_LOG_FLUSH_EVERY = 6;
interface TgLogItem {
  who: 'me' | 'peer';
  text: string;
}
const tgLogBufs = new Map<string, TgLogItem[]>();

function logTgChatLine(cid: string, role: 'me' | 'peer', text: string): void {
  const t = (text ?? '').trim();
  if (!t) return;
  let buf = tgLogBufs.get(cid) ?? [];
  buf.push({ who: role, text: t.slice(0, 80) });
  if (buf.length > 24) buf = buf.slice(-24);
  tgLogBufs.set(cid, buf);
  if (buf.length >= TG_LOG_FLUSH_EVERY) flushTgChatLog(cid);
}

/** 把缓冲的聊天记录合并写成一条角色记忆（异步，失败静默） */
function flushTgChatLog(cid: string): void {
  const buf = tgLogBufs.get(cid);
  if (!buf || buf.length === 0) return;
  tgLogBufs.set(cid, []);
  void (async () => {
    try {
      const who = await ownerName();
      const c = await getContact(cid);
      const charName = c?.nickname || c?.name || '对方';
      const lines = buf.slice(-12).map((x) => `${x.who === 'me' ? who : charName}：${x.text}`);
      memAddEventFragment(cid, 'wx', `一起听时聊了这些：${lines.join('；')}`, {
        eventTime: Date.now(),
        sourceTag: 'music-chat',
      });
    } catch {
      // 记忆失败静默
    }
  })();
}

let tgFlushBound = false;
/** 切后台/关页兑底 flush（第二十六轮）：缓冲不足 6 条时原本只靠手动退出一起听落记忆，
 *  直接杀页面会丢最后几条——pagehide / visibilitychange(hidden) 时立即 flush 全部缓冲
 *  （flush 同步清缓冲再异步落库，重复触发不会写重）。
 *  【39 聚合制】一起听歌曲聚合缓冲与 solo 听歌缓冲同场兜底：切后台/关页时把已攒的歌
 *  合并落一条（结束时的最终 flush 由 stopTogether 负责，此处覆盖「没退出直接关页面」） */
function bindTgLogFlush(): void {
  if (tgFlushBound || typeof window === 'undefined') return;
  tgFlushBound = true;
  const flushAll = () => {
    for (const cid of Array.from(tgLogBufs.keys())) flushTgChatLog(cid);
    // 歌曲聚合缓冲：每个有缓冲的角色各落一条（一起听中的会话）
    const bufs = loadTgMemBufs();
    for (const cid of Object.keys(bufs)) void flushTogetherMemory(cid);
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

// ---------------- 记忆写入（【39 聚合制】：攒批合并，不再一条事件一条记忆） ----------------

async function ownerName(): Promise<string> {
  try {
    return (await ownerRealName()) || '机主';
  } catch {
    return '机主';
  }
}

/** 歌名列表 → 「《A》（歌手1）、《B》（歌手2）…」，最多列 5 首，多余的「等 N 首」（聚合记忆用） */
function songListText(songs: { name: string; artist: string }[]): string {
  const head = songs.slice(0, 5).map((s) => `《${s.name}》${s.artist ? `（${s.artist}）` : ''}`);
  const rest = songs.length - head.length;
  return head.join('') + (rest > 0 ? `等${songs.length}首` : '');
}

/** 【39 聚合制】一起听记忆缓冲：一次一起听会话攒一批歌（同名同歌手去重、保序），
 *  攒满 TG_MEM_FLUSH_EVERY 首 / 退出一起听 / 切后台兜底时合并写一条记忆。
 *  kv 持久化（music-tg-mem-buf:{uid}）——刷新/杀页面后缓冲不丢，回来接着攒。 */
interface TgMemSong {
  name: string;
  artist: string;
}
interface TgMemBuf {
  /** 会话内听过的歌（保序去重） */
  songs: TgMemSong[];
  /** 缓冲起点（首批歌入缓冲的时间，聚合记忆的 eventTime 用） */
  since: number;
}
const TG_MEM_FLUSH_EVERY = 5;
const TG_MEM_BUF_KEY_PREFIX = 'music-tg-mem-buf:';

function tgMemBufKey(): string {
  return `${TG_MEM_BUF_KEY_PREFIX}${musicUid()}`;
}

function loadTgMemBufs(): Record<string, TgMemBuf> {
  return kvGet<Record<string, TgMemBuf>>(tgMemBufKey()) ?? {};
}

function saveTgMemBufs(map: Record<string, TgMemBuf>): void {
  kvSet(tgMemBufKey(), map);
}

/** 一起听中放了一首歌 → 进缓冲（去重保序）；攒满阈值时中途落一条（超长会话分段沉淀，防只靠结束写） */
export function noteTogetherListen(cid: string, song: { name: string; artist: string }): void {
  try {
    const map = loadTgMemBufs();
    const buf = map[cid] ?? { songs: [], since: Date.now() };
    const key = `${song.name}|${song.artist}`;
    if (!buf.songs.some((s) => `${s.name}|${s.artist}` === key)) {
      buf.songs = [...buf.songs, { name: song.name, artist: song.artist }];
    }
    map[cid] = buf;
    saveTgMemBufs(map);
    if (buf.songs.length >= TG_MEM_FLUSH_EVERY) void flushTogetherMemory(cid);
  } catch {
    // 聚合失败静默（记忆是增强能力）
  }
}

/**
 * 【39 聚合制】把缓冲的歌曲合并写一条一起听记忆：
 * 「X和Y一起听了《A》（歌手）、《B》（歌手）…（累计一起听了 N 分钟）」——
 * endedMs 传累计时长时附带（退出一起听时），不传（攒满/切后台兜底）只写歌单。
 * 缓冲为空且非结束时不动（无内容不写）；结束时缓冲为空也写一条轻量记录
 * （一起听本身是关系事件：「一起听了一会儿歌」）。写完清缓冲。
 */
export async function flushTogetherMemory(cid: string, endedMs?: number): Promise<void> {
  try {
    const map = loadTgMemBufs();
    const buf = map[cid];
    if (!buf && endedMs == null) return;
    const songs = buf?.songs ?? [];
    if (songs.length === 0 && endedMs == null) return;
    if (buf) {
      delete map[cid];
      saveTgMemBufs(map);
    }
    const c = await getContact(cid);
    if (!c || c.kind !== 'char') return;
    const who = await ownerName();
    const parts: string[] = [];
    if (songs.length > 0) parts.push(`一起听了${songListText(songs)}`);
    else parts.push('一起听了一会儿歌');
    if (endedMs != null) parts.push(`累计一起听了 ${fmtTogetherDur(endedMs)}`);
    memAddEventFragment(cid, 'wx', `${who}和${c.nickname || c.name}${parts.join('，')}`, {
      eventTime: buf?.since ?? Date.now(),
      sourceTag: 'music-play',
    });
  } catch {
    // 记忆失败静默
  }
}

/** 【39 聚合制】solo 听歌记忆缓冲：不再每 30 分钟一条，按 24h / 8 首阈值攒批，
 *  合并写「X听了《A》《B》《C》」给最近聊过的角色（sourceTag='music-solo'）。
 *  kv 持久化（music-solo-mem-buf:{uid}）——听歌痕迹低价值，一天一条足够。 */
const SOLO_MEM_FLUSH_EVERY = 8;
const SOLO_MEM_FLUSH_MS = 24 * 3_600_000;
const SOLO_MEM_BUF_KEY_PREFIX = 'music-solo-mem-buf:';

interface SoloMemBuf {
  songs: TgMemSong[];
  /** 本批最早一首入缓冲的时间（eventTime + 24h 判定用） */
  since: number;
}

function soloMemBufKey(): string {
  return `${SOLO_MEM_BUF_KEY_PREFIX}${musicUid()}`;
}

/** solo 听歌 → 进缓冲（去重保序）；满 8 首或本批已跨 24h 时合并落一条 */
function noteSoloListen(song: { name: string; artist: string }): void {
  try {
    const buf = kvGet<SoloMemBuf>(soloMemBufKey()) ?? { songs: [], since: Date.now() };
    const key = `${song.name}|${song.artist}`;
    if (!buf.songs.some((s) => `${s.name}|${s.artist}` === key)) {
      buf.songs = [...buf.songs, { name: song.name, artist: song.artist }];
    }
    kvSet(soloMemBufKey(), buf);
    const spanOk = Date.now() - buf.since >= SOLO_MEM_FLUSH_MS;
    if (buf.songs.length >= SOLO_MEM_FLUSH_EVERY || spanOk) void flushSoloMemory();
  } catch {
    // 静默
  }
}

/** 把 solo 缓冲合并写一条听歌记忆（给最近聊过的角色各写一条；写完清缓冲） */
async function flushSoloMemory(): Promise<void> {
  try {
    const buf = kvGet<SoloMemBuf>(soloMemBufKey());
    if (!buf || buf.songs.length === 0) return;
    kvSet(soloMemBufKey(), { songs: [], since: Date.now() });
    const cids = await recentChatCharIds(3);
    if (cids.length === 0) return;
    const who = await ownerName();
    const text = `${who}听了${songListText(buf.songs)}`;
    for (const cid of cids) {
      memAddEventFragment(cid, 'wx', text, {
        eventTime: buf.since,
        sourceTag: 'music-solo',
      });
    }
  } catch {
    // 静默
  }
}

/** 播放钩子：一起听中每次放新歌 → 进聚合缓冲（攒批写记忆）+ 同歌计数（B）；
 *  solo 听歌 → 进 solo 聚合缓冲（24h/8 首阈值合并写）。
 *  第二十一轮反馈：切歌不再触发 AI 点评（点评歌曲功能已删除） */
export function installMusicAiHook(): void {
  let lastSongId = 0;
  setSongPlayedHook((song: NcmSong) => {
    void (async () => {
      const t = loadActiveTogether();
      const artist = songArtistText(song);
      if (t) {
        const c = await getContact(t.contactId);
        if (!c) return;
        if (song.id !== lastSongId) {
          lastSongId = song.id;
          // 【39 聚合制】进缓冲（同名同歌手去重），攒满/退出/切后台时合并写一条
          noteTogetherListen(t.contactId, { name: song.name, artist });
          bumpTogetherSongPlay(t.contactId, song.id); // B：同歌「一起听过几遍」计数
        }
        return;
      }
      // solo 听歌记忆（需求一.4）：非一起听时也给最近聊过的角色留一笔听歌痕迹，
      // 【39 聚合制】24h / 8 首阈值攒批合并一条（原 30 分钟节流逐条写入太密）；实时近况另有 cross-app 音乐块注入
      noteSoloListen({ name: song.name, artist });
    })();
  });
}

/** 最近聊过天的 char 角色 id（读三个聊天 App 当前账号会话的最后消息时间，倒序前 n） */
async function recentChatCharIds(n: number): Promise<string[]> {
  try {
    const { listContacts } = await import('./contacts-store');
    const { kvGetScoped } = await import('./idb-kv');
    const all = await listContacts();
    const chars = all.filter((c) => c.kind === 'char');
    const scored: { id: string; ts: number }[] = [];
    for (const c of chars) {
      let ts = 0;
      for (const [app, key] of [
        ['wx', `wx-chat-msgs:${c.id}`],
        ['qq', `qq-chat-msgs:${c.id}`],
        ['sms', `ios-chat-msgs:c:${c.id}`],
      ] as const) {
        try {
          const msgs = kvGetScoped<{ time?: number }[]>(key, app);
          if (Array.isArray(msgs) && msgs.length > 0) {
            const t = Number(msgs[msgs.length - 1]?.time ?? 0);
            if (Number.isFinite(t) && t > ts) ts = t;
          }
        } catch {
          // 单端失败跳过
        }
      }
      if (ts > 0) scored.push({ id: c.id, ts });
    }
    return scored
      .sort((a, b) => b.ts - a.ts)
      .slice(0, n)
      .map((x) => x.id);
  } catch {
    return [];
  }
}

// ---------------- LLM（两级兜底，与 proactive-msg 同款） ----------------

/** 与 /api/chat 的 messages 结构一致的多轮消息（system + 真实历史 user/assistant 轮次） */
type LlmTurn = { role: 'system' | 'user' | 'assistant'; content: string };

/** 回复温度（Task 20）：配置里没有有效温度时默认 0.9——温度是输出多样性的关键，
 *  低温度下同输入会得到近乎相同的回复，是「复读机」体验的根因之一 */
const DEFAULT_REPLY_TEMPERATURE = 0.9;

function replyTemperature(): number {
  const t = useSettings.getState().apiConfig?.temperature;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 2
    ? t
    : DEFAULT_REPLY_TEMPERATURE;
}

/** 两级 LLM：先走用户上游（config 必带 temperature），失败/空回复再用内置 SDK 兜底。
 *  Task 20：改为接收完整多轮 messages（system + 真实历史轮次 + 当前消息），
 *  两级请求传同一套 messages，SDK 兜底同样带温度（内置模型也需要多样性）。 */
async function callLlmTwoTier(messages: LlmTurn[]): Promise<string> {
  const temperature = replyTemperature();
  const cfg = { ...useSettings.getState().apiConfig, temperature };
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: cfg });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true, temperature });
    } catch {
      raw = '';
    }
  }
  return raw.trim();
}

/** 从原文抠 JSON 数组（推荐歌曲用） */
function extractJsonArray(raw: string): Record<string, unknown>[] | null {
  const t = (raw ?? '').replace(/```(json)?/gi, '').trim();
  const m = t.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]) as unknown;
    return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

// ---------------- 音乐情境块 ----------------

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

function historyBlock(): string {
  const st = useMusic.getState();
  const recent = st.history.slice(0, 8).map((h) => `《${h.song.name}》${songArtistText(h.song)}`);
  if (!recent.length) return '';
  return `【${'机主'}最近在听的歌】\n${recent.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
}

/** A（第二十轮）：当前歌词上下文块（含翻译）——
 *  之前 AI 只知道歌名/进度，看不到歌词，聊不了「这句词好戳」这种细节。
 *  第二十二轮审计⑦：从「上一句+当前+下一句」扩到最近 4~6 句（前 3 句+当前+后 2 句），「刚才那句词」也接得住 */
function lyricNowBlock(): string {
  const st = useMusic.getState();
  if (!st.current || st.lyricFor !== st.current.id || st.lyricLines.length === 0) return '';
  const lines = st.lyricLines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= st.position + 0.2) idx = i;
    else break;
  }
  if (idx < 0) return '';
  const at = (i: number): string => {
    const l = lines[i];
    if (!l) return '';
    return l.tr ? `${l.text}（${l.tr}）` : l.text;
  };
  // 第二十二轮审计⑦：窗口 = 前 3 句 + 当前 + 后 2 句（共最多 6 句）
  const parts: string[] = [];
  const from = Math.max(0, idx - 3);
  const to = Math.min(lines.length - 1, idx + 2);
  for (let i = from; i <= to; i++) {
    const tag = i === idx ? '▶ 正在唱' : i < idx ? `前 ${idx - i} 句` : `后 ${i - idx} 句`;
    parts.push(`${tag}：${at(i)}`);
  }
  return `【正在唱到的歌词】\n${parts.join('\n')}`;
}

function playingBlock(extra: string, who: string, cid: string, multi = true): string {
  const st = useMusic.getState();
  const cur = st.current;
  const lines: string[] = ['【一起听 · 音乐情境（真实数据）】'];
  if (cur) {
    lines.push(`正在一起听：《${cur.name}》 ${songArtistText(cur)}`);
    if (st.duration > 0) {
      lines.push(
        `播放进度：${fmtClock(st.position)} / ${fmtClock(st.duration)}（${st.playing ? '正在播放' : '已暂停'}）`,
      );
    }
    if (st.freeTrial) lines.push('（这是 VIP 歌曲，当前只播放试听片段）');
  } else {
    lines.push('当前没有在放歌。');
  }
  if (extra) lines.push(extra);
  const hb = historyBlock();
  if (hb) lines.push('', hb);
  // A：当前歌词上下文
  const lb = lyricNowBlock();
  if (lb) lines.push('', lb);
  // B：真实的一起听统计（累计时长 + 同一首歌听过几遍）
  if (cid) {
    const totalMs = togetherTotalMs(cid);
    if (totalMs > 60_000) lines.push(`你们累计一起听了 ${fmtTogetherDur(totalMs)}。`);
    if (cur) {
      const played = togetherSongPlayCount(cid, cur.id);
      if (played >= 2) lines.push(`《${cur.name}》你们已经一起听过 ${played} 遍了。`);
    }
  }
  lines.push(
    '',
    // 【100-d】「最高规则」自封降级：多个块都自称最高会互相打架——改为情境说明，规则内容不变
    '【一起听 · 当前情境】现在是聊天回合：先像平常一样自然回应用户这句话，再考虑一起听的互动（下面的规则都服务于这个前提）',
    '- 对方刚发来的消息永远是最重要的：必须先直接接住对方说的话（回应内容/情绪/问题），像正常聊天那样回；',
    '- 绝对禁止无视对方的话、自顾自聊歌：哪怕对方只发两个字，也要先回应这句话本身；',
    '- 音乐只是背景：你们正在一起听歌，但聊天跟平时一样，对方没提歌、没问歌时就不要主动聊歌；',
    '- 只有对方主动聊到音乐/歌词，或当前话题自然连到歌上时，才顺着聊几句这首歌（先接话，再带歌）；',
    '',
    '【一起听聊天规则】',
    '- 你正在和对方一起实时听歌，像坐在同一间屋子里各戴一只耳机那样自然聊天；',
    // Task 21 多条消息：multi=true 时要求一行一条拆 3~10 条连发；主动消息（aiSayOnce）传 multi=false 只发一条
    ...(multi
      ? [
          '- 每次回复拆成 3~10 条短消息连发，一行一条（行与行之间不要空行、不要编号/序号/项目符号）：想说内容越丰富条数越多（上限 10 条），简单回应也至少 3 条；',
          '- 每条消息就像单独发出的一条：口语化、1~2 句以内、符合你的人设语气，条与条之间接着说但各有侧重点；',
        ]
      : ['- 只发一条消息：口语化、1~2 句、符合你的人设语气；']),
    '- 对方聊到歌时，可以引用「正在唱到的歌词」里的一两句聊感受，但不要整段抄歌词；',
    '- 绝对禁止复读：聊天记录里（不管是你还是对方说过的）已有的句子、句式和意思都不许再重复，每次都要换一个全新的角度（旋律/歌手音色/歌词/回忆/当下氛围/联想画面……任选一个没聊过的切入口）；',
    '- 不要输出 markdown、不要伪装成系统；直接输出消息正文。',
    '',
    '【播放控制】你在陪对方听歌，可以控制播放：',
    '- 指令由系统在你发完消息后异步执行：正文用意图式说法（如"我切一下歌""放首X听听"），不要用完成时说"已经切好了/已经放出来了"——万一没放成也不显得说谎；',
    // 【100-d】指令教学行收敛到 music-remote.playControlCommonLines（单一来源）；
    // [红心] 只有本链路（extractTgControls）解析执行，redHeart 仅此处传 true
    ...playControlCommonLines({ who, redHeart: true }),
  );
  return lines.join('\n');
}

/** 联系人库不可用时的最小内联人设（Task 20）：之前直接丢弃人设只留音乐块，
 *  AI 立刻变得机械重复——兜底人设保证口语化/多样性/短回复的行为约束仍然生效 */
const FALLBACK_PERSONA = [
  '【人设（联系人库暂不可用，使用兜底人设）】你是机主的亲密聊天伙伴，此刻正陪机主一起听歌：',
  '- 说话温柔自然、口语化，像真实的亲密朋友，不用书面腔；',
  '- 每次回复都换着说法，绝不重复之前用过的句式和开场白；',
  '- 回复拆成几条短消息连发（一行一条），每条 1~2 句，短而自然；',
  '- 不承认自己是模板、程序或助手，不讨论人设本身。',
].join('\n');

async function personaSystemFor(cid: string, musicBlock: string): Promise<string> {
  const c = await getContact(cid);
  if (!c) {
    // Task 20：不再静默丢人设——回退最小内联人设（拼在音乐块前面）
    return [FALLBACK_PERSONA, musicBlock].filter(Boolean).join('\n\n');
  }
  const userName = await ownerName();
  let memory = '';
  try {
    memory = memChatRecallBlock(cid, 'wx', c.persona || '音乐', {});
  } catch {
    memory = '';
  }
  // 跨 App 感知（需求二）：以 'music' 身份拉【当前环境】+ 其他 App 最近消息 + 共同群近况——
  // AI 带着微信/QQ/信息/电话的记忆进音乐 App，也知道「现在是在音乐 App 聊天」
  let crossBlock = '';
  try {
    const blocks = await buildCrossContextBlocks(cid, 'music', userName);
    crossBlock = [blocks.crossAppBlock, blocks.groupBlock].filter(Boolean).join('\n\n');
  } catch {
    crossBlock = '';
  }
  let share = true;
  try {
    share = getMemSettings(cid).share;
  } catch {
    share = true;
  }
  const persona = buildPersonaSystemPrompt(c as unknown as PersonaSource, {
    channel: '一起听（音乐 App）',
    userName,
    ownerName: userName,
    multiApp: share,
    accountId: 'main',
    extraRules: [
      '当前场景是音乐 App 的「一起听」聊天：歌在背景里播着，但聊天跟平时一样——对方说什么就接什么，语气随意自然，消息很短（一两句话）；不要把每个话题都往歌上带。',
    ],
  });
  return [persona, memory, crossBlock, musicBlock].filter(Boolean).join('\n\n');
}

// ---------------- AI 播放控制（需求五：一起听 AI 自动播放/关闭/选歌/切歌） ----------------

interface TgControl {
  type: 'next' | 'prev' | 'pause' | 'resume' | 'play' | 'like' | 'seek';
  name?: string;
  artist?: string;
  /** type='seek' 时：快进/快退秒数（正=快进，负=快退，绝对值最多 600） */
  delta?: number;
}

/** 从 AI 原文里抽出播放控制指令并从正文剔除：[切歌]/[上一首]/[暂停]/[继续]/[放歌:歌名:歌手] */
function extractTgControls(raw: string): { text: string; controls: TgControl[] } {
  const controls: TgControl[] = [];
  let text = raw ?? '';
  text = text.replace(/\[(?:放歌|播放|来一首|来首)[:：]([^:：\][]*)(?:[:：]([^:：\][]*))?\]/g, (_m, name, artist) => {
    const n = String(name ?? '').trim();
    if (n) controls.push({ type: 'play', name: n, artist: String(artist ?? '').trim() });
    return '';
  });
  text = text.replace(/\[(切歌|下一首|上一首|暂停|继续|停下|关音乐)\]/g, (_m, k) => {
    const key = String(k);
    if (key === '切歌' || key === '下一首') controls.push({ type: 'next' });
    else if (key === '上一首') controls.push({ type: 'prev' });
    else if (key === '暂停' || key === '停下' || key === '关音乐') controls.push({ type: 'pause' });
    else controls.push({ type: 'resume' });
    return '';
  });
  // C（第二十轮）：[红心] 指令——帮对方把当前歌加入红心
  text = text.replace(/\[(?:红心|点赞|收藏)\]/g, () => {
    controls.push({ type: 'like' });
    return '';
  });
  // D（第二十轮）：[快进:秒数]/[快退:秒数] 指令——真实拖进度（第二十二轮：加快退，上限放宽到 600）
  text = text.replace(/\[(快进|快退)[:：]\s*(\d{1,3})\s*(?:秒|s)?\]/g, (_m, kind, sec) => {
    const n = parseInt(String(sec), 10);
    if (Number.isFinite(n) && n > 0) {
      controls.push({ type: 'seek', delta: (String(kind) === '快退' ? -1 : 1) * Math.min(n, 600) });
    }
    return '';
  });
  return { text: text.replace(/[ \t]+$/gm, '').trim(), controls };
}

/** 带歌手一致性校验的曲库搜索（第二十二轮审计⑤：防止 AI 编的歌名匹配到完全无关的翻唱/remix/伴奏版）：
 *  取前 5 条结果，优先返回歌手名与要求吻合的第一条；歌名带「原唱: 歌手」标注的翻唱视为可用版本；
 *  全都不吻合时兜底放「歌名对得上」的第一首（第三十八轮：静默失败比放翻唱更伤体验）。
 *  第三十七轮导出：微信/QQ 聊天端的「一起听遥控」（music-remote.ts）复用同一套选歌校验 */
export async function searchSongMatched(title: string, artist: string): Promise<NcmSong | undefined> {
  let hits: NcmSong[] = [];
  try {
    const r = await search(`${title} ${artist}`.trim(), 1, 5);
    hits = r.songs;
  } catch {
    return undefined;
  }
  if (!hits.length) return undefined;
  const want = artist.toLowerCase().replace(/\s+/g, '');
  if (!want) return hits[0];
  const gotOf = (s: NcmSong): string => songArtistText(s).toLowerCase().replace(/\s+/g, '');
  const tokens = want.split(/[/、,，]/).map((t) => t.trim()).filter(Boolean);
  const ok = (s: NcmSong): boolean => {
    const got = gotOf(s);
    if (got) {
      if (got.includes(want) || want.includes(got)) return true;
      if (tokens.some((t) => t.length >= 2 && (got.includes(t) || t.includes(got)))) return true;
    }
    // 翻唱标注兜底（第三十八轮）：原版常因版权搜不到，结果里是「晴天 (原唱 周杰伦)」「七里香 (钢琴版)
    // [原唱: 周杰伦]」这类翻唱——歌名里带的原唱标注与请求歌手一致时视为该歌手的可用版本
    const nameLc = (s.name || '').toLowerCase().replace(/\s+/g, '');
    if (nameLc.includes(`原唱:${want}`) || nameLc.includes(`原唱${want}`)) return true;
    return false;
  };
  const matched = hits.find(ok);
  if (matched) return matched;
  // 最终兜底（第三十八轮）：全都不匹配时放「歌名对得上」的第一首——
  // AI 已用意图式说法说了「放一首」，一个都放不出（静默）比放翻唱尴尬得多
  const t = title.toLowerCase().replace(/\s+/g, '');
  return hits.find((s) => (s.name || '').toLowerCase().replace(/\s+/g, '').includes(t)) ?? hits[0];
}

/** 执行一起听 AI 的播放控制（直接调 useMusic action；用户随时可手动覆盖，store 层天然以最后操作为准）。
 *  aiText = 本次回复的正文（第二十二轮审计②：正文已经说过"没有/找不到"时，搜不到的兑底消息不再重复发） */
async function runTgControls(cid: string, controls: TgControl[], aiText = ''): Promise<void> {
  if (controls.length === 0) return;
  const st = useMusic.getState();
  for (const c of controls.slice(0, 3)) {
    try {
      if (c.type === 'next') await st.next(false);
      else if (c.type === 'prev') await st.prev();
      else if (c.type === 'pause') {
        if (st.playing) st.toggle();
      } else if (c.type === 'resume') {
        if (!st.playing && st.current) st.toggle();
      } else if (c.type === 'like') {
        // C：帮对方把当前歌加入红心（已红心则跳过，不会取消）
        if (st.current && !st.isLiked(st.current.id)) await st.toggleLike(st.current);
      } else if (c.type === 'seek') {
        // D：真实拖进度（钳制在歌曲时长内）
        if (st.current && st.duration > 0 && c.delta) {
          st.seek(Math.min(st.duration - 1, Math.max(0, st.position + c.delta)));
        }
      } else if (c.type === 'play' && c.name) {
        // P2：AI 点歌搜不到时不再静默——自动补一条兑底消息（正文已道歉时跳过，审计②）；
        // 搜索走歌手一致性校验（审计⑤）
        const hit = await searchSongMatched(c.name, c.artist ?? '');
        if (hit) await st.playSong(hit, [hit]);
        else if (!/(没有|找不到|搜不到|听不了|放不了)/.test(aiText)) {
          appendMsg(cid, {
            id: genMsgId(),
            role: 'peer',
            text: `《${c.name}》这首歌曲库里没有诶，换一首听听？`,
            time: Date.now(),
          });
        }
      }
    } catch {
      // 单条指令失败不影响其余
    }
  }
}

// ---------------- AI 回复 ----------------

let replying = false;

/** 1 槽排队（Task 20）：回复生成期间用户又发来的消息不再静默丢弃——
 *  只记最新一条（旧 pending 直接覆盖），当前回复结束后接着处理 */
interface PendingReply {
  cid: string;
  userText: string;
  /** 触发本轮的用户消息 id（失败时在其气泡旁打 replyFail 徽标） */
  triggerMsgId?: string;
}
let pendingReply: PendingReply | null = null;

/** 一起听回复的历史轮次上限（真实多轮 messages，不再压平进 system） */
const TG_HISTORY_TURNS = 12;

/** 一起听聊天记录 → LLM 多轮轮次（Task 20）：机主的消息=user、AI 自己的回复=assistant（
 *  推荐卡按 AI 发言处理，正文前带「（推荐了歌）」），旧→新，最多 limit 条。
 *  who 参数保留旧调用签名便于对照；recentTurns 输出的多轮消息靠 role 区分身份，无需名字前缀。 */
function recentTurns(cid: string, limit: number, who: string): LlmTurn[] {
  void who;
  return loadTogetherMsgs(cid)
    .slice(-Math.max(1, limit))
    .filter((m) => m.role === 'me' || m.role === 'peer' || m.role === 'recs')
    .map((m) => ({
      role: (m.role === 'me' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.role === 'recs' ? `（推荐了歌）${m.text}` : m.text,
    }))
    .filter((t) => t.content.trim().length > 0);
}

/** 从历史轮次里剔除刚收到的那条当前消息（Task 20 防重复）：sendTogetherText 先把消息写入
 *  聊天记录再触发回复，记录尾条就是当前消息——它只应出现在 messages 的最后一条 user 轮，
 *  绝不能同时在 system 压平历史里再出现一次（旧实现的复读诱因之一） */
function withoutCurrentTurn(turns: LlmTurn[], userText: string): LlmTurn[] {
  if (!userText) return turns;
  const last = turns[turns.length - 1];
  if (last && last.role === 'user' && last.content === userText) return turns.slice(0, -1);
  return turns;
}

/** 用户发消息 → AI 回复（生成中有新消息进来时进 1 槽排队，不再丢消息） */
export async function togetherReply(cid: string, userText: string, triggerMsgId?: string): Promise<void> {
  if (replying) {
    // 生成中：只记住最新一条待回复输入（覆盖旧的），当前回复结束后在同一把锁内接着处理
    pendingReply = { cid, userText, triggerMsgId };
    return;
  }
  replying = true;
  useMusic.setState({ tgAiBusy: true }); // 聊天视图显示三个跳动点
  try {
    // 串行排水：先回当前这条，再取排队中的最新一条继续（循环而非递归，race-free）
    let current: PendingReply = { cid, userText, triggerMsgId };
    for (;;) {
      await runTogetherReplyOnce(current.cid, current.userText, current.triggerMsgId);
      const next = pendingReply;
      pendingReply = null;
      // 只接同会话的排队输入：一起听已退出/已换角色时丢弃（旧角色的挂起输入对新情境无意义）
      const active = loadActiveTogether();
      if (!next || !active || active.contactId !== next.cid) break;
      current = next;
    }
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
  }
}

/** Task 21 排队缺口修补：aiSayOnce/togetherRecommend 与 togetherReply 共用同一把 replying 锁，
 *  但此前结束时只清锁不排水——主动消息/推荐生成期间用户发来的消息会滞留 pendingReply。
 *  此处按 togetherReply 的串行排水同款逻辑补答：仅在排队的 cid 仍是当前活跃会话时执行，
 *  单次补答独立 try/finally 保证 replying 一定复位；不递归进 aiSayOnce/togetherRecommend。 */
async function drainPendingAfterProactive(): Promise<void> {
  for (;;) {
    const next = pendingReply;
    pendingReply = null;
    // 只接同会话的排队输入：一起听已退出/已换角色时丢弃（与 togetherReply 同口径）
    const active = loadActiveTogether();
    if (!next || !active || active.contactId !== next.cid) return;
    replying = true;
    useMusic.setState({ tgAiBusy: true });
    try {
      await runTogetherReplyOnce(next.cid, next.userText, next.triggerMsgId);
    } finally {
      replying = false;
      useMusic.setState({ tgAiBusy: false });
    }
  }
}

/** 单次回复执行（不含排队/互斥）：system（人设+记忆+跨App+音乐情境+规则）+ 最近真实历史轮次
 *  + 当前消息做最后一条 user 轮；聊天记录不再压平进 system。
 *  Task 21：回复拆成 3~10 条短消息，锁内逐条错峰投递（650~1200ms/条），
 *  生成下一条排队输入继续回复时投递已全部落盘，不会交错乱序。
 *  失败表达（用户需求）：不落任何占位文字，改为触发消息（triggerMsgId）旁红色 ! 徽标，点击重试；
 *  无触发消息的主动场景失败静默 */
async function runTogetherReplyOnce(cid: string, userText: string, triggerMsgId?: string): Promise<void> {
  try {
    const who = await ownerName();
    // 情境说明只描述「刚来了一条新消息」，不引用消息原文（原文只出现在最后一条 user 轮，避免出现两次）
    const situation = userText
      ? `对方（${who}）刚发来新消息，请以人设自然回应：先直接接住对方说的话（内容/情绪/问题），不要转移话题。`
      : '现在轮到你说话。';
    const system = await personaSystemFor(cid, playingBlock(situation, who, cid));
    const priorTurns = withoutCurrentTurn(
      recentTurns(cid, TG_HISTORY_TURNS + 1, who),
      userText,
    ).slice(-TG_HISTORY_TURNS);
    const messages: LlmTurn[] = [
      { role: 'system', content: system },
      ...priorTurns,
      { role: 'user', content: userText || '（对方点了推荐按钮，想让你推荐几首歌）' },
    ];
    const { segments, controls } = await genUniqueReply(cid, messages, { minSegments: TG_SEGMENTS_MIN });
    if (segments.length) {
      await deliverPeerSegments(cid, segments);
      if (triggerMsgId) patchTgMsg(cid, triggerMsgId, { replyFail: false }); // 成功清标（重试成功场景）
    } else if (triggerMsgId) {
      patchTgMsg(cid, triggerMsgId, { replyFail: true, retryKind: 'chat' });
    }
    // AI 的播放控制指令（切歌/暂停/选歌/红心/快进快退）异步真实执行（不阻塞回复 flag；用户随时可手动覆盖）
    void runTgControls(cid, controls, segments.join(' '));
  } catch {
    // 生成链路异常：无占位文字——触发消息打红徽标（点击重试），无触发消息则静默
    if (triggerMsgId) {
      try {
        patchTgMsg(cid, triggerMsgId, { replyFail: true, retryKind: 'chat' });
      } catch {
        // 静默
      }
    }
  }
}

function cleanAiText(raw: string): string {
  let t = (raw ?? '').trim();
  t = t.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  return t.slice(0, 300);
}

// ---------------- 多条消息连发（Task 21：3~10 条，内容多多发/少少发） ----------------

/** 单条气泡长度上限：多消息模式下每条都要短，超长截断 */
const TG_SEGMENT_MAX_LEN = 120;
/** 分条数上下限（用户需求：3~10 条） */
const TG_SEGMENTS_MIN = 3;
const TG_SEGMENTS_MAX = 10;
/** 连发节奏：每条间隔 650~1200ms，模拟真人连发 */
const TG_SEGMENT_GAP_BASE = 650;
const TG_SEGMENT_GAP_JITTER = 550;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 剥掉行首序号/项目符号（模型偶尔不听话会输出 1. xxx / - xxx / ① xxx） */
function stripListMarker(line: string): string {
  return line
    .replace(/^\s*(?:[0-9]{1,2}[.、)．]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•·])\s*/, '')
    .trim();
}

/** 单条清洗：去首尾引号 + 截断 */
function cleanSegment(s: string): string {
  let t = (s ?? '').trim();
  t = t.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  return t.slice(0, TG_SEGMENT_MAX_LEN);
}

/** 按句读拆分（。！？!?～；…后断开），过碎的短句并入前段避免碎片化 */
function splitBySentence(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？!?～～；;…])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (last.length < 6 || p.length < 6)) out[out.length - 1] = last + p;
    else out.push(p);
  }
  return out.length ? out : [text];
}

/** AI 多条回复解析：期望一行一条；
 *  - 模型没分行（一整段且较长）→ 按句读拆；
 *  - 不足 3 条且内容够长 → 继续按句读拆到 3 条（拆不动就按实际条数发，自然优先）；
 *  - 超过 10 条 → 尾部合并；
 *  - 每条剥序号、去首尾引号、截断 120 字 */
function splitReplySegments(raw: string): string[] {
  let lines = (raw ?? '')
    .split(/\n+/)
    .map((l) => cleanSegment(stripListMarker(l)))
    .filter(Boolean);
  if (!lines.length) return [];
  if (lines.length === 1 && lines[0].length > 40) {
    lines = splitBySentence(lines[0]).map(cleanSegment).filter(Boolean);
  }
  if (lines.length < TG_SEGMENTS_MIN) {
    const expanded: string[] = [];
    for (const l of lines) {
      if (lines.length + expanded.length >= TG_SEGMENTS_MIN) {
        expanded.push(l);
        continue;
      }
      expanded.push(...splitBySentence(l));
    }
    lines = expanded.map(cleanSegment).filter(Boolean);
  }
  if (lines.length > TG_SEGMENTS_MAX) {
    const head = lines.slice(0, TG_SEGMENTS_MAX - 1);
    const tail = lines.slice(TG_SEGMENTS_MAX - 1).join(' '); // 已是清洗过的文本，合并不再二次截断
    lines = tail ? [...head, tail.slice(0, TG_SEGMENT_MAX_LEN)] : head;
  }
  return lines.slice(0, TG_SEGMENTS_MAX);
}

/** 锁内逐条投递（调用方持有 replying 锁）：每条间隔 650~1200ms，
 *  浮窗气泡与聊天流各自按新消息渲染，逐条出现天然错峰 */
async function deliverPeerSegments(cid: string, segs: string[]): Promise<void> {
  for (let i = 0; i < segs.length; i++) {
    appendMsg(cid, { id: genMsgId(), role: 'peer', text: segs[i], time: Date.now() });
    if (i < segs.length - 1) await sleep(TG_SEGMENT_GAP_BASE + Math.random() * TG_SEGMENT_GAP_JITTER);
  }
}

function genMsgId(): string {
  return `tg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- 防复读（第十五轮反馈：为什么老是发一模一样的话） ----------------

/** 多样性种子：让每次请求的 prompt 都不同（绕开同输入→同输出），同时提醒模型换角度 */
function varietySeed(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

/** 归一化（去标点/空白/大小写）后比较，避免只换标点的假变化 */
function normDup(s: string): string {
  return (s ?? '').replace(/[\s，。！？、,.!?:：;；'"“”「」『』()（）…·\-~～]/g, '').toLowerCase();
}

/** 2-gram 集合（相似复读判定用） */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 相似复读判定（第二十二轮审计④）：完全相同 / 长句包含（双方 ≥6 字）/ 2-gram 重合度 ≥0.6——
 *  只换标点、只换一两个字的复读也算重复，但「今天好累」vs「今天好开心」这类不同意思不误伤 */
function similarEnough(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6;
}

/** 是否与最近几条消息重复（P4：窗口 12 条，双方消息都查——AI 复读机主原话同样算重复；
 *  第二十二轮审计④：从「完全相同」升级为相似判定 */
function isDupOfRecent(cid: string, text: string): boolean {
  const n = normDup(text);
  if (!n) return false;
  return loadTogetherMsgs(cid)
    .slice(-12)
    .some((m) => similarEnough(n, normDup(m.text)));
}

/** 开头复读快查（Task 20）：草稿前 4 个字（去标点归一化）若与最近 5 轮聊天里 AI 自己说过的
 *  某句开头相同 → 判定复读。「同一个模板只换几个词」的句子 2-gram 重合度可能压不到阈值，
 *  但开头一致这个特征先拦一道。 */
function startsLikeRecentAiReply(cid: string, text: string): boolean {
  const head = normDup(text).slice(0, 4);
  if (head.length < 4) return false;
  return loadTogetherMsgs(cid)
    .slice(-5)
    .some((m) => m.role === 'peer' && normDup(m.text).slice(0, 4) === head);
}

/**
 * 生成一批不与近期消息重复的对方回复（Task 20 加强 + Task 21 多条）：
 * - 输入是完整多轮 messages（system + 历史轮次 + 最后一条 user 轮 = 当前消息）；
 * - 输出拆成 3~10 条短消息（splitReplySegments）；
 * - 最多 3 次尝试：任一条与最近 12 条消息相似、或开头 4 字与最近 5 轮 AI 回复相同都算复读，整批重试；
 * - 重试不换 system、不加新 system：把被拒草稿回灌进最后一条 user 消息末尾，
 *   明确告诉模型「这些表达已经说过，换完全不同的说法」；
 * - 每次尝试带多样性种子，绕开同输入→同输出；
 * - opts.minSegments>1：条数不足时最多补试一次（要求拆成至少 N 条，Task 21 连发下限）。
 */
async function genUniqueReply(
  cid: string,
  baseMessages: LlmTurn[],
  opts: { minSegments?: number } = {},
): Promise<{ segments: string[]; controls: TgControl[] }> {
  const minSegments = opts.minSegments ?? 0;
  const run = async (messages: LlmTurn[]) => {
    const raw = await callLlmTwoTier(messages);
    const { text: ctrlText, controls } = extractTgControls(raw);
    return { segments: splitReplySegments(ctrlText), controls };
  };
  /** 把附加说明拼进最后一条 user 消息末尾（不新增 system、不动历史轮次） */
  const withLastUserNote = (messages: LlmTurn[], note: string): LlmTurn[] => {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (!last || last.role !== 'user') return messages;
    return [...messages.slice(0, lastIdx), { role: 'user' as const, content: `${last.content}${note}` }];
  };
  const isRepeat = (t: string): boolean => !!t && (isDupOfRecent(cid, t) || startsLikeRecentAiReply(cid, t));
  const isRepeatBatch = (segs: string[]): boolean => segs.some(isRepeat);
  const rejected: string[] = [];
  let messages = withLastUserNote(baseMessages, `（回复多样性种子：${varietySeed()}）`);
  let out = await run(messages);
  for (let attempt = 1; attempt < 3 && out.segments.length && isRepeatBatch(out.segments); attempt++) {
    rejected.push(out.segments.join(' / '));
    // 被拒草稿截到 40 字：足够指认表达，又不把 prompt 撑爆
    const quoted = rejected.map((d) => `"${d.slice(0, 40)}"`).join(' ');
    messages = withLastUserNote(
      baseMessages,
      `（注意：不要重复类似这些之前说过的表达：${quoted}，换一种完全不同的说法。多样性种子：${varietySeed()}）`,
    );
    out = await run(messages);
  }
  // Task 21：条数下限补发重试——模型偶尔对短回应只给一行（用户要求 3~10 条连发），
  // 最多补试一次；重试仍不足就按实际条数发（自然优先，不为凑数硬拆）
  if (minSegments > 1 && out.segments.length > 0 && out.segments.length < minSegments) {
    const note = `（刚才那样只是一条消息，请把你想说的拆成至少 ${minSegments} 条短消息连发：一行一条、不要编号/序号，像真人连发那样把话按语气自然断开，每条 1~2 句。多样性种子：${varietySeed()}）`;
    try {
      const retry = await run(withLastUserNote(baseMessages, note));
      if (retry.segments.length > out.segments.length) out = retry;
    } catch {
      // 补发失败就用已有条数
    }
  }
  return out;
}


/** 用户发消息入口 */
export function sendTogetherText(text: string): void {
  const t = loadActiveTogether();
  if (!t || !text.trim()) return;
  const msg: TgMsg = { id: genMsgId(), role: 'me', text: text.trim(), time: Date.now() };
  appendMsg(t.contactId, msg);
  void togetherReply(t.contactId, text.trim(), msg.id);
}

/** 红色 ! 徽标重试入口：按 retryKind 分流——recs 重新推荐歌曲 / chat 重新生成回复
 *  （成功后由 runTogetherReplyOnce/togetherRecommend 清标）。返回 false=忙（正在生成）或消息不可重试 */
export function retryTogetherReply(cid: string, msgId: string): boolean {
  if (replying) return false;
  const m = loadTogetherMsgs(cid).find((x) => x.id === msgId);
  if (!m || m.role !== 'me') return false;
  patchTgMsg(cid, msgId, { replyFail: false });
  if (m.retryKind === 'recs') void togetherRecommend(cid, m.text);
  else void togetherReply(cid, m.text, msgId);
  return true;
}

// ---------------- AI 主动说话（F 睡前提醒 + 暂停久置轻问） ----------------

/** AI 主动消息全局冷却（第三十五轮反馈「AI 一直在发信息」）：任意两条主动消息之间至少隔 15 分钟，
 *  暂停轻问/睡前提醒共用一把闸；用户自己发的消息不受影响 */
const PROACTIVE_COOLDOWN_MS = 15 * 60_000;
let lastProactiveAt = 0;

/** AI 主动说一句话（仅供 F 睡前提醒/暂停久置轻问使用）。
 *  第三十五轮反馈重写：①全局 15 分钟冷却（不再连续发）；②提示词改为人设/记忆/上下文驱动，
 *  明确不点评正在听的歌（之前「聊聊这首歌的感受」导致 AI 每次都发歌曲评价）；
 *  Task 20：历史改为真实多轮轮次（不再压平进 system），末尾用一条中性「该你主动开口」的 nudge user 轮 */
async function aiSayOnce(cid: string, hint: string): Promise<void> {
  if (replying) return;
  if (Date.now() - lastProactiveAt < PROACTIVE_COOLDOWN_MS) return; // 冷却期内不再主动开口
  replying = true;
  useMusic.setState({ tgAiBusy: true });
  try {
    const who = await ownerName();
    const situation = `${hint ? `【情境】${hint}\n` : ''}现在轮到你主动开口：请根据你的人设、性格、心情、你们的关系、共同记忆和最近聊过的内容，主动发一条像平时聊天一样的消息（内容由你按人设和当下情境自然决定，一两句话就好）。`;
    // 主动消息保持单条（第三十五轮「AI 一直在发信息」的约束仍在）：multi=false 关掉分条规则
    const system = await personaSystemFor(cid, playingBlock(situation, who, cid, false));
    const nudge =
      '（主动发一条消息）。注意：不要点评/评价/感想正在听的这首歌，不要以「这首歌」开头，不要提「这首歌」；就按你的人设和你们平时聊的天，想说什么说什么；不要重复聊天记录里已有的句子。';
    const messages: LlmTurn[] = [
      { role: 'system', content: system },
      ...recentTurns(cid, TG_HISTORY_TURNS, who),
      { role: 'user', content: nudge },
    ];
    const { segments, controls } = await genUniqueReply(cid, messages);
    if (segments.length) {
      lastProactiveAt = Date.now();
      appendMsg(cid, { id: genMsgId(), role: 'peer', text: segments.join(' '), time: Date.now() });
    }
    void runTgControls(cid, controls, segments.join(' '));
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
    // Task 21：生成期间用户发来的消息在此补答（与 togetherReply 同款排水），不再滞留丢答
    await drainPendingAfterProactive();
  }
}

// ---------------- AI 推荐歌曲 ----------------

/** 让 AI 推荐 2~4 首歌（P5：数量由 AI 按语境定）：LLM 出 JSON → 搜索匹配真实曲库 → recs 消息 */
export async function togetherRecommend(cid: string, wish: string): Promise<void> {
  const t = loadActiveTogether();
  if (!t) return;
  if (replying) return; // P1：回复/点评进行中不接受推荐（全局互斥锁），避免两条 AI 消息并发交错
  replying = true;
  useMusic.setState({ tgAiBusy: true });
  try {
    const reqMsg: TgMsg = {
      id: genMsgId(),
      role: 'me',
      text: wish.trim() || '给我推荐几首歌吧',
      time: Date.now(),
    };
    appendMsg(cid, reqMsg);
  const who = await ownerName();
  // Task 20：历史改为真实多轮轮次（不再压平进 system）；推荐请求本体已在上面 appendMsg 写入聊天记录
  const situation = `对方（${who}）想让你推荐歌曲。结合你们正在听的歌、${who}的听歌历史和你们的聊天，推荐 2~4 首真实存在的歌曲（几首由你按语境定）。`;
  const system = await personaSystemFor(cid, playingBlock(situation, who, cid));
  // 第二十二轮审计⑥（换一批）：最近推荐过的歌不再重复推荐
  const recentNames = [
    ...new Set(
      loadTogetherMsgs(cid)
        .slice(-12)
        .flatMap((m) => (m.role === 'recs' && m.songs ? m.songs.map((s) => `《${s.name}》`) : []))
        .slice(-8),
    ),
  ];
  const avoid = recentNames.length ? `最近推荐过的这些歌不要再推：${recentNames.join('')}。` : '';
  const user = `对方（${who}）刚说：「${wish.trim() || '给我推荐几首歌吧'}」。
请严格只输出 JSON 数组（不要解释、不要 markdown 代码块），格式：
[{"title":"歌名","artist":"歌手","reason":"一句话推荐理由（20字内，用你的口吻）"}]
共 2~4 项（几首由你定）。理由不要和聊天记录里已说过的句子重复。${avoid}多样性种子：${varietySeed()}`;
  // 刚写入的那条推荐请求是记录尾条：从历史轮次剔除，只保留在末尾这条 user 轮里
  const priorTurns = withoutCurrentTurn(
    recentTurns(cid, TG_HISTORY_TURNS + 1, who),
    wish.trim() || '给我推荐几首歌吧',
  ).slice(-TG_HISTORY_TURNS);
  const raw = await callLlmTwoTier([
    { role: 'system', content: system },
    ...priorTurns,
    { role: 'user', content: user },
  ]);
  const arr = extractJsonArray(raw);
  if (!arr || !arr.length) {
    // 生成失败：不落模板占位，改为推荐请求消息打红色 ! 徽标（点击重试，retryKind=recs）
    patchTgMsg(cid, reqMsg.id, { replyFail: true, retryKind: 'recs' });
    return;
  }
  const songs: TgRecSong[] = [];
  for (const item of arr.slice(0, 4)) {
    const title = String(item.title ?? '').trim();
    const artist = String(item.artist ?? '').trim();
    if (!title) continue;
    // 第二十二轮审计⑤：歌手一致性校验——不吻合的版本（翻唱/remix/伴奏）不推
    const hit = await searchSongMatched(title, artist);
    if (hit) {
      songs.push({ id: hit.id, name: hit.name, artist: songArtistText(hit), picUrl: hit.album?.picUrl });
    }
  }
  if (!songs.length) {
    appendMsg(cid, {
      id: genMsgId(),
      role: 'peer',
      text: '唔，这几首歌库里好像没有，你放你的歌单听听？',
      time: Date.now(),
    });
    return;
  }
  // P6：推荐理由也过防复读——依次挑第一条与近期消息不重复的理由做开头
  const reasons = arr
    .slice(0, 4)
    .map((it) => cleanAiText(String(it.reason ?? '')))
    .filter(Boolean);
  const lead = reasons.find((r) => !isDupOfRecent(cid, r)) ?? '';
  appendMsg(cid, {
    id: genMsgId(),
    role: 'recs',
    text: lead || '给你挑了几首，戳卡片直接听：',
    time: Date.now(),
    songs,
  });
  // 推荐卡也进聊天记忆（第二十六轮）：appendMsg 只记 me/peer 文本，recs 卡在此补一笔
  // 「TA推荐了《x》《y》」，后续聊天能接得住「你刚才推荐过什么」
  void (async () => {
    try {
      const c = await getContact(cid);
      if (!c || c.kind !== 'char') return;
      memAddEventFragment(
        cid,
        'wx',
        `${c.nickname || c.name}推荐了${songs.map((s) => `《${s.name}》`).join('')}`,
        { eventTime: Date.now(), sourceTag: 'music-recs' },
      );
    } catch {
      // 静默
    }
  })();
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
    // Task 21：推荐生成期间用户发来的消息在此补答（与 togetherReply 同款排水），不再滞留丢答
    await drainPendingAfterProactive();
  }
}

// ---------------- 启动恢复 ----------------

let pauseNudgeBound = false;
let pauseNudgeTimer: ReturnType<typeof setTimeout> | null = null;
let nudgedThisPause = false;
/** 第二十二轮审计③：暂停久置轻问。第三十五轮反馈修复「AI 一直在发信息」：
 *  原实现暂停期间任何 store 变更都会重排 3 分钟定时器（40% 概率）→ 暂停越久消息越多；
 *  现改为每一段连续暂停至多轻问一次（恢复播放才重置），加上 aiSayOnce 全局冷却双保险 */
function bindPauseNudge(): void {
  if (pauseNudgeBound || typeof window === 'undefined') return;
  pauseNudgeBound = true;
  useMusic.subscribe((s) => {
    if (s.playing) {
      // 恢复播放：作废本轮定时器，重置「本轮暂停已轻问」标记
      nudgedThisPause = false;
      if (pauseNudgeTimer) {
        clearTimeout(pauseNudgeTimer);
        pauseNudgeTimer = null;
      }
      return;
    }
    if (pauseNudgeTimer || nudgedThisPause) return; // 已排程或本轮暂停已问过：不再排
    pauseNudgeTimer = setTimeout(() => {
      pauseNudgeTimer = null;
      const st = useMusic.getState();
      if (st.playing || !st.current) return;
      const t = loadActiveTogether();
      if (!t) return;
      nudgedThisPause = true; // 无论是否命中概率，本轮暂停只尝试这一次
      if (Math.random() < 0.4) void aiSayOnce(t.contactId, '音乐暂停了一会儿，对方还没按播放');
    }, 180_000);
  });
}

let sleepWarnBound = false;
/** F（第二十轮）：睡前提醒——定时关闭剩 1 分钟时（music-store 广播 music-sleep-warning 事件），
 *  一起听中的角色自然说一句「要睡着了？音乐快停了哦」。
 *  第二十一轮：点评功能删除；第二十二轮审计③加回「暂停久置轻问」；
 *  第三十五轮：轻问每段暂停至多一次 + 全局 15 分钟冷却 + 提示词不再引导点评歌曲 */
function bindSleepWarning(): void {
  if (sleepWarnBound || typeof window === 'undefined') return;
  sleepWarnBound = true;
  window.addEventListener('music-sleep-warning', () => {
    const t = loadActiveTogether();
    if (!t) return;
    void aiSayOnce(t.contactId, '定时关闭快到了，音乐还有一分钟就要停');
  });
}

/** 音乐 App 打开时调用：恢复一起听会话 + 装 AI 钩子（播放记忆/同歌计数/睡前提醒/暂停久置轻问/切后台兑底 flush） */
export async function bootMusicAi(): Promise<void> {
  installMusicAiHook();
  bindSleepWarning();
  bindPauseNudge();
  bindTgLogFlush();
  const t = loadActiveTogether();
  if (t) {
    const c = await getContact(t.contactId);
    if (c && c.kind === 'char') {
      useMusic.setState({ together: t, togetherMsgs: loadTogetherMsgs(t.contactId) });
    } else {
      await stopTogether();
    }
  }
}

/** 可一起听的角色列表（AI 角色） */
export async function listTogetherCandidates(): Promise<ContactRecord[]> {
  const all = await listContacts();
  return all.filter((c) => c.kind === 'char');
}

/**
 * 一起听对方信息「跟随全局」：头像/昵称始终读联系人库里的最新值，
 * （在微信/QQ里改了头像、昵称后一起听界面立即同步），联系人被删时回退会话快照。
 */
export function useTogetherLive(): TogetherSession | null {
  const session = useMusic((s) => s.together);
  // 只缓存联系人的覆盖值（不在 effect 里同步 setState，避免级联渲染）
  const [override, setOverride] = useState<{ cid: string; name?: string; avatar?: string } | null>(null);
  // 版本号：联系人头像/资料变更事件触达时 +1，强制重读联系人库
  const [rev, setRev] = useState(0);
  const cid = session?.contactId ?? '';
  useEffect(() => {
    if (!cid) return;
    // contact-avatar-changed + contact-updated：头像或任意资料字段（昵称/名字）变更都强制重读
    const reread = () => setRev((n) => n + 1);
    window.addEventListener('contact-avatar-changed', reread);
    window.addEventListener('contact-updated', reread);
    // 恋人关系状态变更（接受邀请/解除关系）：渠道头像来源可能切换，也重读（第五十五轮）
    window.addEventListener(COUPLE_STATE_EVENT, reread);
    return () => {
      window.removeEventListener('contact-avatar-changed', reread);
      window.removeEventListener('contact-updated', reread);
      window.removeEventListener(COUPLE_STATE_EVENT, reread);
    };
  }, [cid]);
  useEffect(() => {
    if (!cid) return;
    let on = true;
    void getContact(cid)
      .then((c) => {
        if (!on) return;
        // 渠道头像（第五十五轮，用户要求：QQ 邀请的关系→TA 用 QQ 头像，微信邀请的→微信头像）：
        // 一起听对象就是绑定恋人时，头像取关系渠道的分 App 头像槽位（与情侣空间同源），
        // 未绑定关系/渠道不匹配时保持联系人全局头像
        const meta = readInviteMeta();
        const chAv =
          meta.partnerApp && meta.partnerContactId === cid ? avatarFor(c, meta.partnerApp) : null;
        setOverride(
          c
            ? { cid, name: c.nickname || c.name || '', avatar: chAv || c.avatar || '' }
            : null,
        );
      })
      .catch(() => {
        /* 联系人库不可用时保持快照 */
      });
    return () => {
      on = false;
    };
  }, [cid, rev]);
  if (!session) return null;
  if (override && override.cid === cid) {
    return {
      ...session,
      name: override.name || session.name,
      avatar: override.avatar || session.avatar,
    };
  }
  return session;
}
