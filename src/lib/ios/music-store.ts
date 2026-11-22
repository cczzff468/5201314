'use client';

/**
 * 音乐 App 全局 store + 播放引擎（网易云在线版）
 *
 * - 模块级 zustand `useMusic` + 惰性单例 HTMLAudioElement：App 组件卸载后音乐继续播。
 * - 媒体统一走同源代理 /api/music/stream?url=...（规避 http 直链混合内容拦截 + 补 Referer）。
 * - 持久化（IndexedDB kv，经 idb-kv）：
 *   · music-player:{uid}        播放器快照（队列/当前歌/模式/音量），按网易云账号隔离
 *   · music-history:{uid} 最近播放（按网易云账号隔离，未登录 guest）
 *   · music-liked:{uid}   本地红心（登录态以云端 likelist 为准，此键为游客与镜像）
 *   · music-listen-sec:{uid}    累计听歌时长（按网易云账号隔离）
 *   · music-now           当前正在听的歌（供一起听/AI 上下文读取）
 *   登录网易云账号后所有本地数据都跟随账号（旧版无 uid 后缀的键作为首次迁移回退）。
 * - 音频焦点：注册 'music'，开播前停掉语音/TTS 等其他音频。
 */

import { create } from 'zustand';
import {
  likeSong,
  likeList,
  songsDetail,
  lyricOf,
  buildLyricLines,
  musicUid,
  normalizeSong,
  ensureMusicSecretsLoaded,
  type NcmSong,
  type NcmLyric,
} from './music-api';
import {
  ensureMultiLoaded,
  getQqLogin,
  getKgLogin,
  refreshQqLogin,
  refreshKgLogin,
  multiSongUrl,
  multiLyric,
  multiLikedSongs,
  unmMatchUrlFull,
  UNM_SOURCE_LABELS,
  crossFallbackUrl,
  setNeteaseUidKey,
  songPlatform,
  type MusicPlatform,
  type UnifiedSong,
} from './music-multi';
import { kvGet, kvSet, kvDel } from './idb-kv';
import { registerAudioSource, stopOtherAudio } from './audio-focus';
import { useSettings } from './store';

export type RepeatMode = 'order' | 'repeat' | 'one' | 'shuffle';

export interface HistoryItem {
  song: NcmSong;
  playedAt: number;
}

export interface LyricLine {
  t: number;
  text: string;
  tr: string;
}

/** 播放器快照（持久化） */
interface PlayerSnapshot {
  queue: NcmSong[];
  qIndex: number;
  mode: RepeatMode;
  volume: number;
  /** 音质（真实传给 songUrl level，第十五轮反馈） */
  quality?: QualityLevel;
}

export type QualityLevel = 'standard' | 'higher' | 'exhigh';
export const QUALITY_LABELS: Record<QualityLevel, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
};
export const QUALITY_ORDER: QualityLevel[] = ['standard', 'higher', 'exhigh'];

/** 播放器自定义背景（手机上传，第十五轮反馈）：按网易云账号隔离 */
const PLAYER_BG_PREFIX = 'music-player-bg:';
function playerBgKey(): string {
  return `${PLAYER_BG_PREFIX}${musicUid()}`;
}
function readPlayerBg(): string {
  return kvGet<string>(playerBgKey()) ?? '';
}

/** 播放器版式（第三十四轮反馈）：vinyl=经典黑胶 / coverFull=全屏封面 / discCover=唱片封面（整张封面作旋转唱片面）；按网易云账号隔离 */
export type PlayerStyle = 'vinyl' | 'coverFull' | 'discCover';
const PLAYER_STYLE_PREFIX = 'music-player-style:';
function playerStyleKey(): string {
  return `${PLAYER_STYLE_PREFIX}${musicUid()}`;
}
function readPlayerStyle(): PlayerStyle {
  const v = kvGet<string>(playerStyleKey());
  return v === 'coverFull' || v === 'discCover' ? v : 'vinyl';
}

const HISTORY_PREFIX = 'music-history:';
const LIKED_PREFIX = 'music-liked:';
const NOW_KEY = 'music-now';

/** 播放器快照键：按音源平台账号隔离（登录 uid / guest），各自存档互不共享 */
function playerKey(): string {
  return `music-player:${dataUid()}`;
}

// ---------------- 多平台：本地数据键隔离 ----------------

/** 当前音源平台（持久化 kv：music-platform；默认 netease） */
const PLATFORM_KEY = 'music-platform';
function readPlatform(): MusicPlatform {
  const v = kvGet<string>(PLATFORM_KEY);
  return v === 'qq' || v === 'kugou' ? v : 'netease';
}
function persistPlatform(p: MusicPlatform): void {
  if (p === 'netease') kvDel(PLATFORM_KEY);
  else kvSet(PLATFORM_KEY, p);
}

/** 平台账号身份键（本地数据隔离前缀）。
 * - netease：沿用 musicUid() 旧口径（uid / guest）——不破坏既有存档；
 * - qq：qq:{uin}；kugou：kg:{userid}；未登录一律 guest（跨平台共享游客数据）。 */
function platformDataUid(p: MusicPlatform): string {
  if (p === 'netease') return musicUid();
  if (p === 'qq') {
    const l = getQqLogin();
    return l ? `qq:${l.uin}` : 'guest';
  }
  const g = getKgLogin();
  return g ? `kg:${g.userid}` : 'guest';
}
function dataUid(): string {
  return platformDataUid(useMusic.getState().platform);
}
function syncNeteaseUidKey(): void {
  setNeteaseUidKey(musicUid());
}
function readPlayerSnapshot(): PlayerSnapshot | null {
  return kvGet<PlayerSnapshot>(playerKey());
}

/** 听歌时长键：按网易云账号隔离，各自存档互不共享 */
function listenKey(): string {
  return `music-listen-sec:${musicUid()}`;
}

/** 自动跨平台兜底开关（持久化：music-cross-fallback；缺省 = 开） */
const CROSS_FALLBACK_KEY = 'music-cross-fallback';
function readCrossFallback(): boolean {
  return kvGet<boolean>(CROSS_FALLBACK_KEY) !== false;
}

/** 全局轻提示自动消失计时器（跨平台兜底切换提示等） */
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function readListenSec(): number {
  return Number(kvGet<number>(listenKey())) || 0;
}

/**
 * 一次性迁移：旧版无 uid 后缀的全局键 → 当前网易云账号名下（目标键缺失时才写入，随后删旧键）。
 * 旧实现对缺失的账号键回退读全局键，导致切到任何账号都看到同一份旧时长/队列
 * （「我页时长不跟随网易云账号」的根因）；改为开机一次性归属当前账号，其余账号从 0 开始。
 */
function migrateLegacyAccountKeys(): void {
  const legacyListen = kvGet<number>('music-listen-sec');
  if (typeof legacyListen === 'number') {
    if (kvGet<number>(listenKey()) == null) kvSet(listenKey(), legacyListen);
    kvDel('music-listen-sec');
  }
  const legacySnap = kvGet<PlayerSnapshot>('music-player');
  if (legacySnap) {
    if (!kvGet<PlayerSnapshot>(playerKey())) kvSet(playerKey(), legacySnap);
    kvDel('music-player');
  }
}

/** 歌曲播放成功钩子（music-ai 注入：写一起听记忆等） */
type SongPlayedHook = (song: NcmSong) => void;
let songPlayedHook: SongPlayedHook | null = null;
export function setSongPlayedHook(fn: SongPlayedHook | null): void {
  songPlayedHook = fn;
}

// ---------------- audio 单例 ----------------

let audio: HTMLAudioElement | null = null;
let engineBound = false;

/** 听歌时长累计（秒）：timeupdate 增量累加，节流写 kv（“我”页统计行显示） */
let listenTick = 0;
function accumulateListen(): void {
  const cur = audio?.currentTime ?? 0;
  const dt = cur - listenTick;
  listenTick = cur;
  if (!(dt > 0 && dt < 3)) return; // 跳转/重播不累计
  const next = useMusic.getState().listenSec + dt;
  useMusic.setState({ listenSec: next });
  // 每 30 秒落盘一次（listenSec 内存值已完整，直接写）
  if (Math.round(next) % 30 === 0) kvSet(listenKey(), Math.round(next));
}
function flushListen(): void {
  const sec = useMusic.getState().listenSec;
  if (sec > 0) kvSet(listenKey(), Math.round(sec));
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  if (!engineBound) {
    engineBound = true;
    audio.addEventListener('timeupdate', () => {
      accumulateListen();
      useMusic.setState({ position: audio?.currentTime ?? 0 });
    });
    audio.addEventListener('durationchange', () => {
      const d = audio?.duration;
      if (d && Number.isFinite(d)) useMusic.setState({ duration: d });
    });
    audio.addEventListener('play', () => useMusic.setState({ playing: true }));
    audio.addEventListener('pause', () => {
      flushListen();
      useMusic.setState({ playing: false });
    });
    audio.addEventListener('waiting', () => useMusic.setState({ buffering: true }));
    audio.addEventListener('playing', () => useMusic.setState({ buffering: false }));
    audio.addEventListener('ended', () => {
      useMusic.getState().next(true);
    });
    audio.addEventListener('error', () => {
      const s = useMusic.getState();
      if (s.current) s.failCurrent('播放失败：音频加载出错');
    });
  }
  return audio;
}

// 引擎停止回调（音频焦点：语音通话/语音消息/TTS 开播时停音乐）
function stopEngine(): void {
  if (audio) {
    audio.pause();
  }
}
registerAudioSource('music', stopEngine);

export function mediaProxyUrl(raw: string): string {
  return `/api/music/stream?url=${encodeURIComponent(raw)}`;
}

// ---------------- store ----------------

export interface MusicNav {
  view: 'tabs' | 'player' | 'playlist';
  /** heart = 心动模式（根据红心/收藏/常听推荐，第六十三轮） */
  tab: 'home' | 'heart' | 'search' | 'mine';
  /** 歌单详情参数 */
  playlistId: number | null;
  /** 酷狗歌单需要 global_collection_id（字符串）作为曲目标识 */
  playlistGid: string | null;
  /** 特殊歌单：daily=每日推荐 liked=我的红心（云端） guestLocal=游客本地歌单（id 在 guestPlId） */
  playlistKind: 'normal' | 'daily' | 'liked' | 'guestLocal';
  /** 游客本地歌单 id */
  guestPlId: string | null;
}

/** 一起听会话/消息类型（具体逻辑在 music-ai.ts，状态放这里驱动 UI） */
export interface TogetherSessionLike {
  contactId: string;
  name: string;
  avatar: string;
  distanceKm: number;
  /** 展示锚点 = 累计起点（现在 - 历史累计时长），时长跨会话永久累计 */
  since: number;
  /** 本次段落真实开始时间（用于「这次听过的歌」过滤与退出时累加） */
  segStart?: number;
}
export interface TogetherMsgLike {
  id: string;
  role: 'me' | 'peer' | 'recs';
  text: string;
  time: number;
  songs?: { id: number; name: string; artist: string; picUrl?: string }[];
  error?: boolean;
  /** 这条「我」的消息触发的一轮 AI 回复失败：气泡旁红色 ! 徽标，点击重新生成 */
  replyFail?: boolean;
  /** 重试类型：chat=重新生成回复 / recs=重新推荐歌曲（缺省 chat） */
  retryKind?: 'chat' | 'recs';
}

interface MusicState {
  booted: boolean;
  // 当前音源平台（网易云/QQ/酷狗；推荐、我喜欢、搜索、播放直链都跟随它）
  platform: MusicPlatform;
  // 三平台登录态快照（驱动「我的」页账号卡/登录门；fans/follows 供「我的」页统计行）
  qqLogin: { uin: string; nickname: string; avatar: string; fans: number; follows: number } | null;
  kgLogin: { userid: string; nickname: string; avatar: string; fans: number; follows: number } | null;
  // 登录（music-api 持久层快照，驱动 UI 刷新；网易云口径）
  loginUid: number | null;
  loginNickname: string;
  loginAvatar: string;
  // 播放
  queue: NcmSong[];
  qIndex: number;
  current: NcmSong | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  mode: RepeatMode;
  volume: number;
  playError: string;
  freeTrial: boolean;
  // 播放器外观/音质（设置弹窗，第十五轮反馈）
  /** 自定义背景图（dataURL；空 = 默认封面模糊） */
  playerBg: string;
  /** 播放器版式（经典黑胶/全屏封面/唱片封面，第三十四轮） */
  playerStyle: PlayerStyle;
  /** 音质（真实作用于 songUrl 的 level） */
  quality: QualityLevel;
  /** 定时关闭截止时间戳（毫秒；null = 未定时；会话级不持久化） */
  sleepAt: number | null;
  // 歌词
  lyricLines: LyricLine[];
  lyricLoading: boolean;
  lyricFor: number | null;
  lyricShowTr: boolean;
  // 红心
  likedIds: Set<number>;
  likedSongs: Record<number, NcmSong>;
  // 历史
  history: HistoryItem[];
  /** 累计听歌秒数（本地统计，timeupdate 增量累加；「我」页统计行显示时长） */
  listenSec: number;
  // 导航
  nav: MusicNav;
  // 游客模式（未登录时「先逛逛」进入）
  guestMode: boolean;
  // 三平台同时登录：任一平台登录成功后先留在登录页（可继续登录其它平台），
  // 点「进入音乐」后置 false 进主界面；会话级不持久化
  loginHold: boolean;
  setLoginHold: (v: boolean) => void;
  // 全局轻提示（跨平台兜底「已切换至 XX 平台播放」等；自动消失）
  notice: string;
  notify: (msg: string) => void;
  // 自动跨平台兜底：当前平台无版权时自动切其它平台音源播放（持久化，默认开）
  crossFallback: boolean;
  setCrossFallback: (v: boolean) => void;
  // 评论面板
  commentSong: NcmSong | null;
  // 一起听（活跃会话，由 music-ai 维护；状态放这里驱动播放页/聊天 UI）
  together: TogetherSessionLike | null;
  togetherMsgs: TogetherMsgLike[];
  // AI 正在组织回复（聊天视图显示三个跳动点打字动画）
  tgAiBusy: boolean;
  // 歌手关注状态（内存缓存；设置弹窗打开时用 artistSublist 与服务端对齐，关注/取关即时写入，
  // 供设置弹窗/一起听聊天胶囊同步显示「关注/已关注」）
  followedArtists: Record<number, boolean>;
  // 灵动岛音乐弹窗可见性（第二十三轮反馈：弹窗可见时状态栏隐藏「移动数据」图标，
  // 弹窗消失后恢复；由 MusicIsland 同步写入，StatusBar 只读）
  islandVisible: boolean;
  // 拾光小屋家具播放中（v5.9）：音箱/黑胶点歌后 true —— 灵动岛不弹音乐弹窗，
  // 进音乐 App 或在 App 内点歌后自动回 false；会话级不持久化
  ambient: boolean;

  boot: () => Promise<void>;
  openAppNow: () => void;
  setTab: (t: MusicNav['tab']) => void;
  openPlayer: () => void;
  closePlayer: () => void;
  openPlaylist: (id: number, kind?: MusicNav['playlistKind'], gid?: string) => void;
  openGuestPlaylistNav: (gid: string) => void;
  closePlaylist: () => void;
  openComments: (s: NcmSong) => void;
  closeComments: () => void;

  playSong: (song: NcmSong, queue?: NcmSong[], opts?: { ambient?: boolean }) => Promise<void>;
  playQueueAt: (index: number) => Promise<void>;
  toggle: () => void;
  next: (auto?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setMode: (m: RepeatMode) => void;
  setPlayerBg: (v: string) => void;
  /** 切换播放器版式（第三十四轮；按网易云账号持久化） */
  setPlayerStyle: (v: PlayerStyle) => void;
  /** 写入歌手关注状态（内存缓存，服务端为准） */
  setArtistFollowed: (id: number, on: boolean) => void;
  setQuality: (q: QualityLevel) => void;
  /** 定时关闭：传分钟数（null = 取消） */
  setSleepAt: (min: number | null) => void;
  addToQueue: (songs: NcmSong[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  failCurrent: (msg: string) => void;

  loadLyric: (songId: number) => Promise<void>;
  setLyricShowTr: (v: boolean) => void;

  initLiked: () => Promise<void>;
  toggleLike: (song: NcmSong) => Promise<void>;
  isLiked: (id: number) => boolean;

  refreshLoginUi: () => Promise<void>;
  /** 一键切换音源平台（播放不打断；首页/我喜欢/我的等数据源立即切换刷新） */
  switchPlatform: (p: MusicPlatform) => void;
  /** 退出游客模式并进入登录页（设置页「登录」入口用） */
  goLoginFromSettings: () => void;
}

function saveSnapshot(s: MusicState): void {
  const snap: PlayerSnapshot = {
    queue: s.queue.slice(0, 200),
    qIndex: s.qIndex,
    mode: s.mode,
    volume: s.volume,
    quality: s.quality,
  };
  kvSet(playerKey(), snap);
}

// ---------------- 定时关闭（会话级：到点自动暂停） ----------------

let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let sleepWarnTimer: ReturnType<typeof setTimeout> | null = null;
function clearSleepTimers(): void {
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (sleepWarnTimer) {
    clearTimeout(sleepWarnTimer);
    sleepWarnTimer = null;
  }
}
function armSleepTimer(min: number): void {
  clearSleepTimers();
  // F（第二十轮）：到点前 1 分钟广播提醒事件（music-ai 监听 → 一起听角色自然说一句睡前提醒）
  if (min > 1) {
    sleepWarnTimer = setTimeout(() => {
      sleepWarnTimer = null;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('music-sleep-warning'));
    }, (min - 1) * 60_000);
  }
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    useMusic.setState({ sleepAt: null });
    const st = useMusic.getState();
    if (st.playing) st.toggle(); // 到点暂停（不打断当前歌进度）
  }, min * 60_000);
}

/** 按当前账号重载播放快照 + 听歌时长 + 播放器外观（登录/退出后「所有数据跟随账号」；正在播放时不打断） */
function reloadForAccount(): void {
  const st = useMusic.getState();
  useMusic.setState({ listenSec: readListenSec(), playerBg: readPlayerBg(), playerStyle: readPlayerStyle() });
  if (st.playing) return; // 正在播放不打断（退出登录时切歌前先停）
  const snap = readPlayerSnapshot();
  if (snap && Array.isArray(snap.queue) && snap.queue.length) {
    const queue = snap.queue.map(normalizeSong);
    const idx = Math.min(Math.max(0, snap.qIndex ?? 0), queue.length - 1);
    useMusic.setState({
      queue,
      qIndex: idx,
      current: queue[idx] ?? null,
      mode: snap.mode ?? 'order',
      volume: typeof snap.volume === 'number' ? snap.volume : 1,
      quality: snap.quality ?? 'standard',
    });
    if (audio) audio.volume = typeof snap.volume === 'number' ? snap.volume : 1;
  }
}

export const useMusic = create<MusicState>((set, get) => ({
  booted: false,
  platform: 'netease',
  qqLogin: null,
  kgLogin: null,
  loginUid: null,
  loginNickname: '',
  loginAvatar: '',
  queue: [],
  qIndex: -1,
  current: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  mode: 'order',
  volume: 1,
  playError: '',
  freeTrial: false,
  playerBg: '',
  playerStyle: 'vinyl',
  quality: 'standard',
  sleepAt: null,
  lyricLines: [],
  lyricLoading: false,
  lyricFor: null,
  lyricShowTr: true,
  likedIds: new Set<number>(),
  likedSongs: {},
  history: [],
  listenSec: 0,
  nav: { view: 'tabs', tab: 'home', playlistId: null, playlistGid: null, playlistKind: 'normal', guestPlId: null },
  guestMode: false,
  loginHold: false,
  notice: '',
  crossFallback: true,
  commentSong: null,
  together: null,
  togetherMsgs: [],
  tgAiBusy: false,
  followedArtists: {},
  islandVisible: false,
  ambient: false,

  boot: async () => {
    if (get().booted) return;
    set({ booted: true });
    // B1 收尾：登录凭证（MUSIC_U cookie）/ API 配置已 AES-GCM 密文落 kv，先解密注水内存缓存
    // 再恢复本地数据——快照/历史/时长等键都带 musicUid 前缀（依赖登录态），且随后的
    // refreshLoginUi 校验 login/status 也要带上 cookie。幂等：music-api 模块加载时已
    // fire-and-forget 注水，通常此处瞬时完成，await 只是保证时序的硬闸。
    await ensureMusicSecretsLoaded();
    // 多平台层（QQ/酷狗登录凭证 + Base URL 配置）同模式先注水，再读平台选择与各平台存档
    await ensureMultiLoaded();
    ensureAudio();
    set({ platform: readPlatform() });
    syncNeteaseUidKey();
    // 旧全局键一次性归属当前网易云账号（时长/快照真正按账号隔离）
    migrateLegacyAccountKeys();
    // 恢复快照（旧版本存的歌可能缺歌手/封面字段，统一 normalize；缺歌手的再由 playQueueAt 异步补全）
    const snap = readPlayerSnapshot();
    if (snap && Array.isArray(snap.queue) && snap.queue.length) {
      const queue = snap.queue.map(normalizeSong);
      const idx = Math.min(Math.max(0, snap.qIndex ?? 0), queue.length - 1);
      set({
        queue,
        qIndex: idx,
        current: queue[idx] ?? null,
        mode: snap.mode ?? 'order',
        volume: typeof snap.volume === 'number' ? snap.volume : 1,
        quality: snap.quality ?? 'standard',
      });
      if (audio) audio.volume = typeof snap.volume === 'number' ? snap.volume : 1;
      // 歌词预载（第三十七轮）：快照恢复的歌把歌词也拉好——页面刷新后没开过音乐 App、
      // 直接去微信/QQ 聊天时，一起听遥控（music-remote.ts）也能带上「正在唱到的歌词」
      if (queue[idx]) void get().loadLyric(queue[idx].id);
    }
    // 恢复历史
    loadHistoryFor();
    // 恢复累计听歌时长（按账号隔离）
    useMusic.setState({ listenSec: readListenSec() });
    // 恢复播放器自定义背景与版式（按账号隔离）
    useMusic.setState({ playerBg: readPlayerBg(), playerStyle: readPlayerStyle() });
    // 游客模式持久化：上次选过「游客模式」，刷新后直接进入游客态（不再弹登录页）。
    // （原先写在模块加载即执行的恢复块里——但本模块曾被 StatusBar 静态引入时该块在 kv
    // 注水前执行恒为空转；性能优化解耦后本模块只在 boot 时动态加载，恢复统一收拢到这里）
    if (kvGet<boolean>(GUEST_MODE_KEY)) set({ guestMode: true });
    // 自动跨平台兜底开关（持久化，默认开）
    if (!readCrossFallback()) set({ crossFallback: false });
    // 登录态（异步校验）
    void get().refreshLoginUi();
  },

  openAppNow: () => {
    void get().boot();
  },

  setTab: (t) => set((s) => ({ nav: { ...s.nav, view: 'tabs', tab: t } })),

  setLoginHold: (v) => set({ loginHold: v }),

  notify: (msg) => {
    set({ notice: msg });
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      useMusic.setState({ notice: '' });
    }, 2600);
  },

  setCrossFallback: (v) => {
    if (v) kvDel(CROSS_FALLBACK_KEY);
    else kvSet(CROSS_FALLBACK_KEY, false);
    set({ crossFallback: v });
  },
  openPlayer: () => set((s) => ({ nav: { ...s.nav, view: 'player' } })),
  closePlayer: () => set((s) => ({ nav: { ...s.nav, view: 'tabs' } })),
  openPlaylist: (id, kind = 'normal', gid) =>
    set((s) => ({
      nav: { ...s.nav, view: 'playlist', playlistId: id, playlistGid: gid ?? null, playlistKind: kind, guestPlId: null },
    })),
  openGuestPlaylistNav: (gid: string) =>
    set((s) => ({
      nav: { ...s.nav, view: 'playlist', playlistId: null, playlistKind: 'guestLocal', guestPlId: gid },
    })),
  closePlaylist: () => set((s) => ({ nav: { ...s.nav, view: 'tabs' } })),
  openComments: (song) => set({ commentSong: song }),
  closeComments: () => set({ commentSong: null }),

  playSong: async (song, queue, opts) => {
    const s = get();
    // 播放来源：拾光小屋家具传 { ambient: true }（灵动岛不弹窗）；App 内点歌默认 false
    set({ ambient: !!opts?.ambient });
    const base = queue && queue.length ? queue.slice() : s.queue.slice();
    const idx = base.findIndex((x) => x.id === song.id);
    if (idx >= 0) {
      set({ queue: base, qIndex: idx, current: base[idx], playError: '', freeTrial: false });
      saveSnapshot(get());
      await get().playQueueAt(idx);
      return;
    }
    // 队列中没有这首歌 → 插入到当前播放位置之后（不清空原有队列），立即播放
    const insertAt = Math.max(0, s.qIndex) + 1;
    const nextQueue = [...base.slice(0, insertAt), song, ...base.slice(insertAt)];
    set({ queue: nextQueue, qIndex: insertAt, current: song, playError: '', freeTrial: false });
    saveSnapshot(get());
    await get().playQueueAt(insertAt);
  },

  playQueueAt: async (index) => {
    const s = get();
    const song = s.queue[index];
    if (!song) return;
    const a = ensureAudio();
    stopOtherAudio('music'); // 音频焦点：停语音/TTS
    set({ qIndex: index, current: song, position: 0, duration: songDurationSec(song), playError: '', buffering: true });
    saveSnapshot(get());
    // 歌手/封面字段缺失（如旧快照、推荐卡简化对象）→ 异步拉详情补全，根治「未知歌手」
    // （仅网易云歌曲；QQ/酷狗歌曲字段在客户端归一化时已补齐）
    if (!song.artists?.length && songPlatform(song) === 'netease') {
      void (async () => {
        try {
          const full = (await songsDetail([song.id]))[0];
          if (!full?.artists?.length) return;
          const st = get();
          if (st.queue[index]?.id !== song.id) return; // 队列已变，不补
          const queue = st.queue.map((x) => (x.id === song.id ? { ...x, ...full, name: x.name || full.name } : x));
          const patch: Partial<MusicState> = { queue };
          if (st.current?.id === song.id) patch.current = queue[index];
          set(patch);
          saveSnapshot(get());
        } catch {
          // 补全失败不影响播放
        }
      })();
    }
    // 直链：按歌曲所属平台分支（网易云/QQ/酷狗）；无直链时 UNM 解灰 → 跨平台兜底 → 试听回退
    const platform = songPlatform(song);
    const r = await multiSongUrl(platform, song as UnifiedSong, get().quality);
    let url: string | null = r.url;
    let viaLabel = '';
    if (!url && r.needUnm) {
      // 游客解灰（UNM）：网易云拿不到直链（VIP/下架）→ 到酷我/酷狗/咪咕等其它平台找免费可播链接
      const unm = await unmMatchUrlFull(song.id);
      if (unm?.url) {
        url = unm.url;
        viaLabel = UNM_SOURCE_LABELS[unm.source] || '其它平台';
      }
    }
    if (!url && get().crossFallback) {
      // 自动跨平台兜底：当前平台无版权（拿不到直链）→ 按歌名到其它平台找可播音源
      const fb = await crossFallbackUrl(song as UnifiedSong);
      if (fb?.url) {
        url = fb.url;
        viaLabel = fb.viaLabel;
      }
    }
    if (!url && r.trialUrl) url = r.trialUrl; // 兜底回退：VIP 30 秒试听片段
    if (url && viaLabel) get().notify(`当前平台无版权，已为你切换至${viaLabel}播放`);
    if (!url) {
      set({ buffering: false });
      // 错误文案登录态感知：已登录该平台时不再误导「请先登录」，改为版权/下架口径
      const platLogged =
        platform === 'qq' ? !!getQqLogin() : platform === 'kugou' ? !!getKgLogin() : !!get().loginUid;
      const platName = platform === 'qq' ? 'QQ 音乐' : platform === 'kugou' ? '酷狗' : '';
      const hint =
        platform !== 'netease' && !platLogged
          ? `暂无播放链接：请先在「设置」页登录${platName}账号（或开启自动跨平台兜底）`
          : '暂无播放链接：该歌曲可能需要完整 VIP 或已下架（已尝试其它音源均未命中）';
      get().failCurrent(hint);
      return;
    }
    a.src = mediaProxyUrl(url);
    a.volume = get().volume;
    try {
      await a.play();
      set({ playing: true, buffering: false, freeTrial: false });
      void onSongStarted(song);
    } catch {
      // 浏览器自动播放策略拦截：等待用户点击播放按钮
      set({ playing: false, buffering: false, freeTrial: false });
    }
  },

  toggle: () => {
    const a = ensureAudio();
    const s = get();
    if (!s.current) {
      if (s.queue.length) void s.playQueueAt(Math.max(0, s.qIndex));
      return;
    }
    if (s.playing) {
      a.pause();
    } else if (a.src) {
      stopOtherAudio('music');
      void a.play().catch(() => set({ playError: '播放失败，请重试' }));
    } else {
      void s.playQueueAt(Math.max(0, s.qIndex));
    }
  },

  next: async (auto = false) => {
    const s = get();
    if (!s.queue.length) return;
    if (s.mode === 'one' && auto) {
      const a = ensureAudio();
      a.currentTime = 0;
      void a.play().catch(() => {});
      return;
    }
    let idx: number;
    if (s.mode === 'shuffle') {
      idx = s.queue.length > 1 ? Math.floor(Math.random() * s.queue.length) : 0;
      if (s.queue.length > 1 && idx === s.qIndex) idx = (idx + 1) % s.queue.length;
    } else {
      idx = s.qIndex + 1;
      if (idx >= s.queue.length) {
        if (s.mode === 'repeat') idx = 0;
        else {
          // order 播完列表：停止（保留队列）
          set({ playing: false, position: 0 });
          if (auto) return;
          idx = 0;
        }
      }
    }
    await s.playQueueAt(idx);
  },

  prev: async () => {
    const s = get();
    if (!s.queue.length) return;
    const a = ensureAudio();
    if (a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    const idx = s.qIndex - 1 < 0 ? s.queue.length - 1 : s.qIndex - 1;
    await s.playQueueAt(idx);
  },

  seek: (sec) => {
    const a = ensureAudio();
    if (Number.isFinite(sec)) {
      a.currentTime = sec;
      set({ position: sec });
    }
  },

  setVolume: (v) => {
    const a = ensureAudio();
    const vol = Math.min(1, Math.max(0, v));
    a.volume = vol;
    set({ volume: vol });
    saveSnapshot(get());
  },

  setMode: (m) => {
    set({ mode: m });
    saveSnapshot(get());
  },

  // 播放器自定义背景（第十五轮反馈）：按网易云账号持久化
  setPlayerBg: (v) => {
    if (v) kvSet(playerBgKey(), v);
    else kvDel(playerBgKey());
    set({ playerBg: v });
  },

  // 播放器版式（第三十四轮反馈）：按网易云账号持久化
  setPlayerStyle: (v) => {
    if (v === 'vinyl') kvDel(playerStyleKey());
    else kvSet(playerStyleKey(), v);
    set({ playerStyle: v });
  },

  // 歌手关注状态（内存缓存，服务端为准；关注/取关后各界面即时同步）
  setArtistFollowed: (id, on) => {
    set((s) => ({ followedArtists: { ...s.followedArtists, [id]: on } }));
  },

  // 音质切换（真实作用于下一次起播的 songUrl level）
  setQuality: (q) => {
    set({ quality: q });
    saveSnapshot(get());
  },

  // 定时关闭：到点自动暂停（会话级，重启后需重设）
  setSleepAt: (min) => {
    clearSleepTimers();
    if (!min) {
      set({ sleepAt: null });
      return;
    }
    set({ sleepAt: Date.now() + min * 60_000 });
    armSleepTimer(min);
  },

  addToQueue: (songs) => {
    const s = get();
    const ids = new Set(s.queue.map((x) => x.id));
    const add = songs.filter((x) => !ids.has(x.id));
    const queue = [...s.queue, ...add];
    set({ queue });
    saveSnapshot(get());
  },

  removeFromQueue: (index) => {
    const s = get();
    const queue = s.queue.filter((_, i) => i !== index);
    let qIndex = s.qIndex;
    if (index < s.qIndex) qIndex -= 1;
    else if (index === s.qIndex) qIndex = Math.min(qIndex, queue.length - 1);
    set({ queue, qIndex });
    saveSnapshot(get());
  },

  clearQueue: () => {
    const a = ensureAudio();
    a.pause();
    a.removeAttribute('src');
    set({ queue: [], qIndex: -1, current: null, playing: false, position: 0, duration: 0 });
    saveSnapshot(get());
  },

  failCurrent: (msg) => {
    set({ playError: msg, playing: false, buffering: false });
    // 播放失败的全局可见性修复：playError 只在全屏播放页渲染，从首页/歌单页点歌失败时
    // 轻提示闪一下就没了、毫无反馈（用户报告「说完就没了」）→ 非播放页同步弹全局轻提示
    const st = get();
    if (st.nav.view !== 'player' && st.notice !== msg) st.notify(msg);
  },

  loadLyric: async (songId) => {
    // 多平台：按当前歌曲所属平台分支取歌词（songId 仅为网易云 id 键）
    const cur = get().current as UnifiedSong | null;
    const sp = cur && cur.id === songId ? songPlatform(cur) : get().platform;
    if (get().lyricFor === songId && get().lyricLines.length) return;
    set({ lyricLoading: true, lyricFor: songId });
    try {
      const ly: NcmLyric =
        sp !== 'netease' && cur && cur.id === songId
          ? await multiLyric(sp, cur)
          : await lyricOf(songId);
      const lines = buildLyricLines(ly);
      set({ lyricLines: lines, lyricLoading: false });
    } catch {
      set({ lyricLines: [], lyricLoading: false });
    }
  },

  setLyricShowTr: (v) => set({ lyricShowTr: v }),

  initLiked: async () => {
    const s = get();
    // 多平台：QQ/酷狗登录后拉各自平台真实「我喜欢」（只读镜像）；网易云保持原有云端逻辑
    if (s.platform === 'qq' && s.qqLogin) {
      try {
        const songs = await multiLikedSongs('qq');
        const ids = new Set<number>();
        const m: Record<number, NcmSong> = {};
        for (const sg of songs) {
          ids.add(sg.id);
          m[sg.id] = sg;
        }
        set({ likedIds: ids, likedSongs: m });
      } catch {
        /* 平台拉取失败保留现状 */
      }
      return;
    }
    if (s.platform === 'kugou' && s.kgLogin) {
      try {
        const songs = await multiLikedSongs('kugou');
        const ids = new Set<number>();
        const m: Record<number, NcmSong> = {};
        for (const sg of songs) {
          ids.add(sg.id);
          m[sg.id] = sg;
        }
        set({ likedIds: ids, likedSongs: m });
      } catch {
        /* 平台拉取失败保留现状 */
      }
      return;
    }
    if (s.platform !== 'netease') {
      // QQ/酷狗未登录：读本地红心（按平台账号隔离）
      const local = kvGet<{ song: NcmSong; at: number }[]>(`${LIKED_PREFIX}${dataUid()}`);
      const ids = new Set<number>();
      const m: Record<number, NcmSong> = {};
      for (const it of local ?? []) {
        ids.add(it.song.id);
        m[it.song.id] = it.song;
      }
      set({ likedIds: ids, likedSongs: m });
      return;
    }
    if (s.loginUid) {
      try {
        const ids = await likeList(s.loginUid);
        set({ likedIds: new Set(ids) });
        // 拉详情补 likedSongs（分批 ≤500）
        const missing = ids.filter((id) => !s.likedSongs[id]).slice(0, 500);
        if (missing.length) {
          const songs = await songsDetail(missing);
          set((st) => {
            const m = { ...st.likedSongs };
            for (const sg of songs) m[sg.id] = sg;
            return { likedSongs: m };
          });
        }
      } catch {
        // 云端拉取失败保留现状
      }
    } else {
      const local = kvGet<{ song: NcmSong; at: number }[]>(`${LIKED_PREFIX}guest`);
      const ids = new Set<number>();
      const m: Record<number, NcmSong> = {};
      for (const it of local ?? []) {
        ids.add(it.song.id);
        m[it.song.id] = it.song;
      }
      set({ likedIds: ids, likedSongs: m });
    }
  },

  toggleLike: async (song) => {
    const s = get();
    const liked = s.likedIds.has(song.id);
    const nextLiked = new Set(s.likedIds);
    const nextSongs = { ...s.likedSongs };
    if (liked) {
      nextLiked.delete(song.id);
      delete nextSongs[song.id];
    } else {
      nextLiked.add(song.id);
      nextSongs[song.id] = song;
    }
    set({ likedIds: nextLiked, likedSongs: nextSongs });
    try {
      const sp = songPlatform(song);
      if (sp === 'netease' && s.loginUid) {
        await likeSong(song.id, !liked);
      } else {
        // QQ/酷狗（或未登录网易云）：本地红心（按平台账号隔离；qq/kg 的云端喜欢列表为只读镜像）
        const arr = [...nextLiked]
          .map((id) => nextSongs[id])
          .filter(Boolean)
          .map((sg) => ({ song: sg, at: Date.now() }));
        kvSet(`${LIKED_PREFIX}${dataUid()}`, arr.slice(0, 500));
      }
    } catch {
      // 失败回滚
      const back = new Set(s.likedIds);
      set({ likedIds: back, likedSongs: s.likedSongs });
    }
  },

  isLiked: (id) => get().likedIds.has(id),

  refreshLoginUi: async () => {
    const { refreshLoginStatus } = await import('./music-api');
    // 三平台各自独立校验、独立即时刷新（互不阻塞）：任一平台登录成功立即更新对应登录态，
    // 不再被其它平台的慢校验卡住（修复「QQ/酷狗登录后一直停在『正在进入』」）。
    void refreshQqLogin()
      .then((qq) => {
        set({ qqLogin: qq ? { uin: qq.uin, nickname: qq.nickname, avatar: qq.avatar, fans: qq.fans, follows: qq.follows } : null });
        // 当前音源平台就是 QQ 时，本地数据（历史/快照/红心）跟随该账号
        if (useMusic.getState().platform === 'qq') {
          loadHistoryFor();
          reloadForAccount();
          void get().initLiked();
        }
      })
      .catch(() => {
        /* 网络异常保留现状 */
      });
    void refreshKgLogin()
      .then((kg) => {
        set({ kgLogin: kg ? { userid: kg.userid, nickname: kg.nickname, avatar: kg.avatar, fans: kg.fans, follows: kg.follows } : null });
        if (useMusic.getState().platform === 'kugou') {
          loadHistoryFor();
          reloadForAccount();
          void get().initLiked();
        }
      })
      .catch(() => {
        /* 网络异常保留现状 */
      });
    const l = await refreshLoginStatus();
    syncNeteaseUidKey();
    if (l) {
      // 登录成功：退出游客态并清除游客标记（下次刷新不再回到游客）
      kvDel(GUEST_MODE_KEY);
      set({ loginUid: l.profile.userId, loginNickname: l.profile.nickname, loginAvatar: l.profile.avatarUrl, guestMode: false });
      if (useMusic.getState().platform === 'netease') {
        void get().initLiked();
        loadHistoryFor();
        reloadForAccount(); // 播放快照/听歌时长切到该网易云账号的存档
      }
    } else {
      // 未登录：保留 guestMode（游客标记持久化，刷新后仍是游客模式）
      set({ loginUid: null, loginNickname: '', loginAvatar: '' });
      if (useMusic.getState().platform === 'netease') {
        void get().initLiked(); // 游客红心从本地 kv 恢复（首页根据喜爱推荐依赖）
        loadHistoryFor();
        reloadForAccount();
      }
    }
  },

  // 一键切换音源平台：播放不打断（当前歌曲继续放）；首页/我喜欢/我的/搜索等数据源
  // 立即切换到目标平台（各自真实数据），本地快照/历史/红心切到该平台账号的存档。
  switchPlatform: (p) => {
    const s = get();
    if (s.platform === p) return;
    persistPlatform(p);
    set({ platform: p, playError: '' });
    // 各平台本地数据重载（不打断正在播放的歌）
    loadHistoryFor();
    reloadForAccount();
    void get().initLiked();
    // 未登录且非游客模式 → 回登录页让用户登录该平台；游客/已登录留在当前界面
    const loggedIn =
      p === 'netease' ? !!s.loginUid : p === 'qq' ? !!getQqLogin() : !!getKgLogin();
    if (!loggedIn && !s.guestMode) {
      useMusic.setState((st) => ({ nav: { ...st.nav, view: 'tabs', tab: st.nav.tab }, loginHold: false }));
    }
  },

  // 设置页「登录」入口：退出游客模式回登录页（若当前平台已登录则直接登录页可选其它平台）
  goLoginFromSettings: () => {
    exitGuestMode();
    set({ loginHold: false });
  },
}));

// ---------------- 内部辅助 ----------------

function songDurationSec(s: NcmSong): number {
  const ms = s.duration ?? s.dt ?? 0;
  return ms > 0 ? ms / 1000 : 0;
}

function loadHistoryFor(): void {
  const uid = dataUid();
  const arr = kvGet<HistoryItem[]>(`${HISTORY_PREFIX}${uid}`);
  setHistory(arr ?? []);
}

function setHistory(arr: HistoryItem[]): void {
  useMusic.setState({ history: arr.slice(0, 100) });
}

async function onSongStarted(song: NcmSong): Promise<void> {
  // 最近播放（按当前音源平台账号隔离）
  const uid = dataUid();
  const key = `${HISTORY_PREFIX}${uid}`;
  const arr = (kvGet<HistoryItem[]>(key) ?? []).filter((x) => x.song.id !== song.id);
  arr.unshift({ song, playedAt: Date.now() });
  kvSet(key, arr.slice(0, 100));
  setHistory(arr.slice(0, 100));
  // 当前在听（跨模块可见）
  kvSet(NOW_KEY, { song, at: Date.now(), uid });
  // AI 钩子（一起听记忆等）
  if (songPlayedHook) {
    try {
      songPlayedHook(song);
    } catch {
      // 钩子失败不影响播放
    }
  }
}

/** 读取"当前在听"（一起听/AI 上下文用） */
export function nowPlayingSnapshot(): { song: NcmSong; at: number } | null {
  return kvGet<{ song: NcmSong; at: number }>(NOW_KEY);
}

export function musicEngineAudio(): HTMLAudioElement | null {
  return audio;
}

// ---------------- 游客本地资料与歌单（不登录也可用的"我的"） ----------------

export interface GuestProfile {
  /** 空 = 跟随全局头像（设置里的机主头像），可从手机上传/预设覆盖 */
  avatar: string;
  nickname: string;
  /** 个性签名（「我的」页展示，可编辑） */
  signature: string;
  /** 关注数（游客本地可编辑） */
  follows: number;
  /** 粉丝数（游客本地可编辑） */
  fans: number;
  /** 等级（v59：游客「我的」页统计行 Lv.X 展示，编辑资料可自定义；替代旧「歌单」计数） */
  level: number;
  /** VIP 徽章类型（游客可自定义） */
  vipType: 'vip' | 'svip';
  /** VIP 等级（展示为中文数字，如 VIP·柒） */
  vipLevel: number;
  /** Task 21：隐藏 VIP 徽章（默认 true = 游客「我的」页不显示 VIP 图标；编辑资料里可重新打开） */
  vipHidden: boolean;
}

const GUEST_PROFILE_KEY = 'music-guest-profile';
const GUEST_PLAYLISTS_KEY = 'music-guest-playlists';
const GUEST_MODE_KEY = 'music-guest-mode';

/** 游客模式开关（持久化：选一次，刷新后仍为游客模式；登录成功后自动清除） */
export function enterGuestMode(): void {
  kvSet(GUEST_MODE_KEY, true);
  useMusic.setState({ guestMode: true, loginHold: false });
}

/** 退出游客模式（回登录页；不清理游客本地资料） */
export function exitGuestMode(): void {
  kvDel(GUEST_MODE_KEY);
  useMusic.setState({ guestMode: false });
}

/** 本地渐变头像（dataURI SVG，零外部依赖）：dicebear 外链在部分网络环境不可达，一进去就是破图（第五十五轮） */
function localAvatar(from: string, to: string, glyph: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs><rect width="96" height="96" fill="url(#g)"/>` +
    `<circle cx="48" cy="40" r="15" fill="rgba(255,255,255,0.35)"/>` +
    `<path d="M 20 96 Q 48 62 76 96 Z" fill="rgba(255,255,255,0.35)"/>` +
    `<text x="70" y="34" font-size="26" text-anchor="middle">${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const GUEST_DEFAULT_AVATAR = localAvatar('#8ab4f8', '#c7a6f2', '🎵');

/** 游客预设头像（本地歌单/资料编辑用；全部本地生成，第五十五轮去 dicebear 依赖） */
export const GUEST_AVATAR_PRESETS: string[] = [
  GUEST_DEFAULT_AVATAR,
  localAvatar('#f7a8c4', '#fbc68f', '🌙'),
  localAvatar('#ffb88a', '#ff9a8b', '☀️'),
  localAvatar('#7fd8c8', '#5fb8e8', '🎧'),
  localAvatar('#c0aede', '#f2a6c8', '🎈'),
  localAvatar('#a8e6a1', '#7fd8c8', '🌈'),
];

export function getGuestProfile(): GuestProfile {
  const v = kvGet<Partial<GuestProfile>>(GUEST_PROFILE_KEY);
  return {
    avatar: typeof v?.avatar === 'string' ? v.avatar : '',
    nickname: v?.nickname || '游客',
    signature: v?.signature ?? '这个人很懒，什么都没留下',
    follows: typeof v?.follows === 'number' ? v.follows : 0,
    fans: typeof v?.fans === 'number' ? v.fans : 0,
    // v59：等级默认 8（可编辑 0~99；老存档无此字段时用默认值）
    level: typeof v?.level === 'number' && v.level >= 0 ? Math.min(99, Math.floor(v.level)) : 8,
    vipType: v?.vipType === 'svip' ? 'svip' : 'vip',
    vipLevel: typeof v?.vipLevel === 'number' && v.vipLevel >= 1 ? Math.min(99, Math.floor(v.vipLevel)) : 7,
    // Task 21：默认隐藏（用户要求游客「我的」页不显示 VIP 图标）；老存档里没有该字段时同样隐藏
    vipHidden: v?.vipHidden !== false,
  };
}

/**
 * 游客实际展示头像：自定义 > 全局头像（设置里的机主头像）> 默认预设。
 * 「一开始跟随全局」：没自定义过就用机主在设置里传的那张。
 */
export function getGuestAvatar(): string {
  const custom = getGuestProfile().avatar;
  if (custom) return custom;
  try {
    const global = useSettings.getState().profile.avatar;
    if (global) return global;
  } catch {
    // store 未就绪时忽略
  }
  return GUEST_DEFAULT_AVATAR;
}

export function setGuestProfile(p: Partial<GuestProfile>): GuestProfile {
  const next = { ...getGuestProfile(), ...p };
  kvSet(GUEST_PROFILE_KEY, next);
  return next;
}

// ---------------- 登录账号头像来源（Task 21：跟随网易云账号 / 从手机上传） ----------------

const LOGIN_AVATAR_PREF_KEY = 'music-login-avatar-pref';

export interface LoginAvatarPref {
  /** ncm = 跟随网易云账号头像（真实账号换头像后同步）；local = 手机上传的本机头像 */
  mode: 'ncm' | 'local';
  /** mode='local' 时的本机头像（dataURL） */
  local: string;
}

export function getLoginAvatarPref(): LoginAvatarPref {
  const v = kvGet<Partial<LoginAvatarPref>>(LOGIN_AVATAR_PREF_KEY);
  return {
    mode: v?.mode === 'local' && typeof v?.local === 'string' && !!v.local ? 'local' : 'ncm',
    local: typeof v?.local === 'string' ? v.local : '',
  };
}

/** 从手机上传登录头像（存本机 dataURL，并切到 local 模式） */
export function setLoginAvatarLocal(dataUrl: string): void {
  kvSet(LOGIN_AVATAR_PREF_KEY, { mode: 'local', local: dataUrl } satisfies LoginAvatarPref);
}

/** 切回跟随网易云账号头像（保留本机上传的那张，方便再切回 local） */
export function setLoginAvatarFollowNcm(): void {
  const cur = getLoginAvatarPref();
  kvSet(LOGIN_AVATAR_PREF_KEY, { mode: 'ncm', local: cur.local } satisfies LoginAvatarPref);
}

export interface GuestPlaylist {
  id: string;
  name: string;
  songs: NcmSong[];
  createdAt: number;
}

export function getGuestPlaylists(): GuestPlaylist[] {
  return kvGet<GuestPlaylist[]>(GUEST_PLAYLISTS_KEY) ?? [];
}

function saveGuestPlaylists(list: GuestPlaylist[]): void {
  kvSet(GUEST_PLAYLISTS_KEY, list.slice(0, 50));
}

export function guestPlaylistCreate(name: string): GuestPlaylist {
  const pl: GuestPlaylist = { id: `gp-${Date.now().toString(36)}`, name: name.trim(), songs: [], createdAt: Date.now() };
  saveGuestPlaylists([...getGuestPlaylists(), pl]);
  return pl;
}

export function guestPlaylistDelete(id: string): void {
  saveGuestPlaylists(getGuestPlaylists().filter((p) => p.id !== id));
}

export function guestPlaylistAddSong(pid: string, song: NcmSong): boolean {
  const list = getGuestPlaylists();
  const pl = list.find((p) => p.id === pid);
  if (!pl || pl.songs.some((s) => s.id === song.id)) return false;
  pl.songs.push(song);
  saveGuestPlaylists(list);
  return true;
}

export function guestPlaylistRemoveSong(pid: string, songId: number): void {
  const list = getGuestPlaylists();
  const pl = list.find((p) => p.id === pid);
  if (!pl) return;
  pl.songs = pl.songs.filter((s) => s.id !== songId);
  saveGuestPlaylists(list);
}

export function guestPlaylistRename(pid: string, name: string): void {
  const list = getGuestPlaylists();
  const pl = list.find((p) => p.id === pid);
  if (!pl || !name.trim()) return;
  pl.name = name.trim();
  saveGuestPlaylists(list);
}

