'use client';

/**
 * 网易云音乐 API 客户端（音乐 App 专用）
 *
 * 双模式：
 * - 内置默认（baseUrl 为空）：同源 Next 代理 /api/music/ncm/*，代理内置多通道自动切换——
 *   本机 mini service（mini-services/netease-api，端口 3010，api-enhanced v4.41.1 vendor 部署）
 *   优先，失联时自动降级到用户部署在 Vercel 的云端实例（api-enhanced-ochre-rho.vercel.app），
 *   凭证不出本机，本机实例挂掉也不中断服务；
 * - 自定义（baseUrl 非空）：直连用户自部署的 NeteaseCloudMusicApi 服务（其 server.js 默认
 *   带 CORS: *），可选 apiKey（header X-API-Key + query apikey 双通道兼容不同部署）。
 *
 * 登录凭证（MUSIC_U cookie）由本模块持有（IndexedDB kv 持久化），请求时 ?cookie= 回传；
 * 音乐数据按网易云账号（uid）隔离：历史/红心/一起听等本地数据键都带 uid 前缀。
 */

// ---------------- 类型 ----------------

export interface MusicApiCfg {
  /** 空 = 内置默认（本机 mini service）；非空 = 自定义完整基地址（http(s)://host[:port]） */
  baseUrl: string;
  /** 自定义 API 的鉴权 Key（选填，仅自定义地址时生效） */
  apiKey: string;
}

export const DEFAULT_MUSIC_API_CFG: MusicApiCfg = { baseUrl: '', apiKey: '' };

export interface NcmArtist {
  id: number;
  name: string;
  picUrl?: string;
  img1v1Url?: string;
}

export interface NcmAlbum {
  id: number;
  name: string;
  picUrl?: string;
  artist?: NcmArtist;
}

export interface NcmSong {
  id: number;
  name: string;
  artists?: NcmArtist[];
  /** song/detail 新格式为单个对象，cloudsearch 新格式为数组 */
  ar?: NcmArtist | NcmArtist[];
  album?: NcmAlbum;
  al?: NcmAlbum; // 新格式
  duration?: number; // 毫秒
  dt?: number;
  fee: number; // 0免费 1VIP 4购买专辑 8低音质免费/非会员可播低音质
  freeTrialInfo?: { start: number; end: number } | null;
}

export interface NcmPlaylist {
  id: number;
  name: string;
  coverImgUrl: string;
  picUrl?: string;
  trackCount: number;
  playCount?: number;
  copywriter?: string;
  description?: string;
  creator?: { userId?: number; nickname?: string; avatarUrl?: string };
  userId?: number;
  subscribed?: boolean;
  specialType?: number; // 5 = 我喜欢的音乐
}

export interface NcmUser {
  userId: number;
  nickname: string;
  avatarUrl: string;
  signature?: string;
  vipType?: number;
  follows?: number; // 关注数（/user/detail profile 内返回）
  followeds?: number; // 粉丝数
}

export interface NcmToplist {
  id: number;
  name: string;
  coverImgUrl?: string;
  updateFrequency?: string;
  tracks?: { first: string; second: string }[];
}

export interface NcmComment {
  commentId: number;
  content: string;
  time: number;
  /** 接口直接返回的日期串（如 2024-12-05），优先于 time 格式化 */
  timeStr?: string;
  likedCount: number;
  liked?: boolean;
  user: {
    userId: number;
    nickname: string;
    avatarUrl: string;
    /** >0 为 VIP（11 = SVIP），用于评论页黑胶徽章 */
    vipType?: number;
    /** 红心会员等级（redVipLevel），徽章「VIP·柒」的等级数字 */
    vipRights?: { redVipLevel?: number } | null;
  };
  /** 评论 IP 属地（location 如「广东」，老评论可能为空串） */
  ipLocation?: { location?: string } | null;
  /** 楼层回复信息（replyCount>0 显示「展开 N 条回复」） */
  showFloorComment?: { replyCount?: number; showReplyCount?: boolean } | null;
  beRepliedComment?: { content: string; user: { nickname: string } } | null;
}

export interface NcmLyric {
  lrc: string;
  tlyric: string;
  hasTranslation: boolean;
}

// ---------------- 配置持久化 ----------------

const CFG_KEY = 'music-api-cfg';
const LOGIN_KEY = 'music-login';

import { kvGet, kvSet, kvDel } from './idb-kv';

export function getMusicApiCfg(): MusicApiCfg {
  const v = kvGet<MusicApiCfg>(CFG_KEY);
  if (!v || typeof v.baseUrl !== 'string') return { ...DEFAULT_MUSIC_API_CFG };
  return { baseUrl: v.baseUrl.trim(), apiKey: typeof v.apiKey === 'string' ? v.apiKey.trim() : '' };
}

export function setMusicApiCfg(cfg: MusicApiCfg): void {
  kvSet(CFG_KEY, { baseUrl: (cfg.baseUrl || '').trim(), apiKey: (cfg.apiKey || '').trim() });
}

export interface MusicLogin {
  cookie: string;
  profile: NcmUser;
  savedAt: number;
}

export function getMusicLogin(): MusicLogin | null {
  const v = kvGet<MusicLogin>(LOGIN_KEY);
  if (!v || !v.cookie || !v.profile?.userId) return null;
  return v;
}

export function setMusicLogin(l: MusicLogin): void {
  kvSet(LOGIN_KEY, l);
}

export function clearMusicLogin(): void {
  kvDel(LOGIN_KEY);
}

/** 当前账号 uid（本地数据隔离前缀；未登录 = guest） */
export function musicUid(): string {
  const l = getMusicLogin();
  return l ? String(l.profile.userId) : 'guest';
}

// ---------------- 请求核心 ----------------

export class NcmError extends Error {
  code: number;
  constructor(message: string, code = -1) {
    super(message);
    this.code = code;
  }
}

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const cfg = getMusicApiCfg();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}` !== '') q.set(k, `${v}`);
  }
  q.set('timestamp', `${Date.now()}`); // 防缓存
  const qs = q.toString();
  if (cfg.baseUrl) {
    const base = cfg.baseUrl.replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}?${qs}`;
  }
  // 内置默认：同源 Next 代理（/api/music/ncm/* → 多上游切换链：本机 3010 优先，
  // 失联自动切云端兜底，详见 route.ts 头注释）；Caddy(:81) 与直连(:3000) 两条通道行为一致。
  return `/api/music/ncm/${path}?${qs}`;
}

export interface NcmReqOpts {
  cookie?: string;
  method?: 'GET' | 'POST';
}

async function ncmRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: NcmReqOpts = {},
): Promise<T> {
  const cfg = getMusicApiCfg();
  const url = buildUrl(path, params);
  const headers: Record<string, string> = {};
  if (cfg.baseUrl && cfg.apiKey) {
    headers['X-API-Key'] = cfg.apiKey;
  }
  const res = await fetch(url, { method: opts.method ?? 'GET', headers });
  if (!res.ok) throw new NcmError(`网络错误 ${res.status}`, res.status);
  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new NcmError('接口返回格式异常');
  }
  // v58 修复：api-enhanced 的部分模块（playlist/tracks 等）把网易原响应包在 {status, body, cookie}
  // 包装层里——顶层没有 code，旧代码会把成功当「接口错误(-1)」抛出（用户实测加入歌单必失败）。
  // 归一化：顶层缺 code 且 body 是带数字 code 的对象 → 解包 body 作为真实载荷（含错误分支：
  // body.code=512 重复添加等照常走下面的抛错逻辑）
  if (
    (j.code === undefined || j.code === null) &&
    typeof j.status === 'number' &&
    j.body &&
    typeof j.body === 'object' &&
    typeof (j.body as Record<string, unknown>).code === 'number'
  ) {
    j = j.body as Record<string, unknown>;
  }
  const code = (j.code as number) ?? -1;
  // 3012 = 登录已过期（网易云）
  if (code !== 200 && code !== 801 && code !== 802 && code !== 803) {
    const msg = (j.message as string) || (j.msg as string) || `接口错误 (${code})`;
    throw new NcmError(msg, code);
  }
  return j as T;
}

/** 带 cookie 的认证请求（登录态接口统一走这里） */
async function authRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const l = getMusicLogin();
  return ncmRequest<T>(path, { ...params, ...(l ? { cookie: l.cookie } : {}) });
}

// ---------------- 登录 ----------------

export interface QrState {
  key: string;
  qrimg: string; // data:image/png;base64,...
  qrurl: string;
}

/** 第一步：取 unikey + 生成二维码 */
export async function qrLoginCreate(): Promise<QrState> {
  const k = await ncmRequest<{ data: { unikey: string } }>('login/qr/key');
  const key = k.data.unikey;
  const c = await ncmRequest<{ data: { qrurl: string; qrimg: string } }>('login/qr/create', {
    key,
    qrimg: 1,
  });
  return { key, qrimg: c.data.qrimg, qrurl: c.data.qrurl };
}

export type QrPollResult =
  | { st: 'waiting' }
  | { st: 'scanned' }
  | { st: 'expired' }
  | { st: 'ok'; cookie: string };

/** 第二步：轮询扫码状态（801 等待 / 802 已扫 / 803 成功 / 800 过期） */
export async function qrLoginCheck(key: string): Promise<QrPollResult> {
  const cfg = getMusicApiCfg();
  const url = buildUrl('login/qr/check', { key });
  const headers: Record<string, string> = {};
  if (cfg.baseUrl && cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;
  const res = await fetch(url, { headers });
  const j = (await res.json()) as { code: number; cookie?: string; message?: string };
  if (j.code === 803 && j.cookie) return { st: 'ok', cookie: j.cookie };
  if (j.code === 802) return { st: 'scanned' };
  if (j.code === 800) return { st: 'expired' };
  return { st: 'waiting' };
}

/** 扫码成功后凭 cookie 完成登录（取用户信息并持久化）——必须在 803 后立即调用 */
export async function completeQrLogin(cookie: string): Promise<MusicLogin> {
  return persistLogin(cookie);
}

/** 发送手机验证码（会发真实短信） */
export async function sendCaptcha(phone: string, countrycode = '86'): Promise<void> {
  await ncmRequest('captcha/sent', { phone, ctcode: countrycode });
}

/** 手机号 + 验证码登录 */
export async function loginByCaptcha(
  phone: string,
  captcha: string,
  countrycode = '86',
): Promise<MusicLogin> {
  const j = await ncmRequest<{ cookie: string; profile?: NcmUser }>('login/cellphone', {
    phone,
    captcha,
    countrycode,
  });
  return persistLogin(j.cookie, j.profile);
}

/** 手机号 + 密码登录 */
export async function loginByPassword(
  phone: string,
  password: string,
  countrycode = '86',
): Promise<MusicLogin> {
  const j = await ncmRequest<{ cookie: string; profile?: NcmUser }>('login/cellphone', {
    phone,
    password,
    countrycode,
  });
  return persistLogin(j.cookie, j.profile);
}

async function persistLogin(cookie: string, profile?: NcmUser): Promise<MusicLogin> {
  if (!cookie) throw new NcmError('登录失败：未取得凭证');
  // 拿完整用户信息（/login/status 或 /user/account）
  let prof = profile;
  if (!prof?.userId) {
    const acc = await ncmRequest<{ profile?: NcmUser }>('user/account', { cookie });
    prof = acc.profile;
  }
  if (!prof?.userId) throw new NcmError('登录失败：未获取到用户信息');
  const login: MusicLogin = { cookie, profile: prof, savedAt: Date.now() };
  setMusicLogin(login);
  return login;
}

/** 退出登录（销毁云端 session + 本地凭证） */
export async function logout(): Promise<void> {
  const l = getMusicLogin();
  if (l) {
    try {
      await ncmRequest('logout', { cookie: l.cookie });
    } catch {
      // 云端登出失败也继续清本地
    }
  }
  clearMusicLogin();
}

/** 校验当前 cookie 是否仍有效（重启恢复时调用；失效自动清除） */
export async function refreshLoginStatus(): Promise<MusicLogin | null> {
  const l = getMusicLogin();
  if (!l) return null;
  try {
    const acc = await authRequest<{ data?: { code?: number }; profile?: NcmUser }>('login/status');
    const code = acc.data?.code;
    if (code === 200 && acc.profile?.userId) {
      const updated = { ...l, profile: acc.profile };
      setMusicLogin(updated);
      return updated;
    }
    clearMusicLogin();
    return null;
  } catch {
    // 网络异常时保守起见保留本地登录态
    return l;
  }
}

// ---------------- 用户/歌单 ----------------

export async function userPlaylists(uid: number): Promise<NcmPlaylist[]> {
  const j = await authRequest<{ playlist: NcmPlaylist[] }>('user/playlist', { uid, limit: 100 });
  return j.playlist ?? [];
}

export interface PlaylistDetail {
  playlist: NcmPlaylist & { trackIds?: { id: number }[]; tracks?: NcmSong[] };
}

export async function playlistDetail(id: number): Promise<PlaylistDetail['playlist']> {
  const j = await authRequest<PlaylistDetail>('playlist/detail', { id, n: 0 });
  return j.playlist;
}

export async function playlistSubscribe(id: number, t: 1 | 2): Promise<void> {
  await authRequest('playlist/subscribe', { id, t }); // t=1 订阅 t=2 取消
}

export async function playlistCreate(name: string, privacy: 0 | 10 = 0): Promise<number> {
  // v58 修复：/playlist/create 的响应是 {code:200, playlist:{id,...}}——新建歌单 id 在
  // playlist.id（旧代码读 j.id 恒 undefined，添加到歌单弹窗的「新建并加入」因此整条链路断掉）；
  // 兼容旧形状 j.id（自部署其它实现可能直接返回）
  const j = await authRequest<{ id?: number; playlist?: { id?: number } }>('playlist/create', { name, privacy });
  const id = j.playlist?.id ?? j.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    throw new NcmError('创建歌单失败：接口未返回歌单 id');
  }
  return id;
}

export async function playlistDelete(id: number): Promise<void> {
  await authRequest('playlist/delete', { id });
}

export async function playlistAddTracks(pid: number, ids: number[]): Promise<void> {
  await authRequest('playlist/tracks', { op: 'add', pid, tracks: ids.join(',') });
}

export async function playlistRemoveTracks(pid: number, ids: number[]): Promise<void> {
  await authRequest('playlist/tracks', { op: 'del', pid, tracks: ids.join(',') });
}

// ---------------- 发现页 ----------------

export async function personalizedPlaylists(limit = 10): Promise<NcmPlaylist[]> {
  const j = await ncmRequest<{ result: NcmPlaylist[] }>('personalized', { limit });
  return j.result ?? [];
}

export async function personalizedNewSongs(limit = 6): Promise<NcmSong[]> {
  // 两种返回结构兼容：新版 result 为数组（每项含 song 字段），旧版 result: { song: NcmSong[] }
  const j = await ncmRequest<{ result: ({ song?: NcmSong } & Partial<NcmSong>)[] | { song: NcmSong[] } }>(
    'personalized/newsong',
    { limit },
  );
  const r = j.result;
  const list: NcmSong[] = Array.isArray(r)
    ? r.map((x) => (x && typeof x === 'object' && 'song' in x && x.song ? x.song : (x as NcmSong)))
    : (r?.song ?? []);
  return list.filter(Boolean).map(normalizeSong);
}

/** 每日推荐歌曲（需登录） */
export async function dailyRecommendSongs(): Promise<NcmSong[]> {
  const j = await authRequest<{ data: { dailySongs?: NcmSong[] } }>('recommend/songs');
  return (j.data?.dailySongs ?? []).map(normalizeSong);
}

export async function toplist(): Promise<NcmToplist[]> {
  const j = await ncmRequest<{ list: NcmToplist[] }>('toplist');
  return j.list ?? [];
}

/**
 * 榜单曲目（搜索页热歌榜等）。
 * /toplist 返回的 tracks 字段已被网易置空（恒为 null）→ 用 playlist/detail 拿 trackIds
 * 再 song/detail 补全歌名/歌手，仿原 tracks 的 { first, second } 形状。
 */
export async function toplistTracks(id: number, limit = 8): Promise<{ first: string; second: string }[]> {
  const p = await playlistDetail(id);
  const ids = (p.trackIds ?? []).slice(0, limit).map((t) => t.id);
  if (!ids.length) return [];
  const songs = await songsDetail(ids);
  return songs.map((s) => ({ first: s.name, second: songArtistText(s) }));
}

export interface NcmDjRadio {
  id: number;
  name: string;
  picUrl?: string;
  programCount?: number;
  subCount?: number;
  rcmdtext?: string;
  dj?: { nickname?: string; avatarUrl?: string };
}

/** 热门播客（电台）——「我」页播客 Tab 展示 */
export async function djHot(limit = 20): Promise<NcmDjRadio[]> {
  const j = await ncmRequest<{ djRadios: NcmDjRadio[] }>('dj/hot', { limit });
  return j.djRadios ?? [];
}

// ---------------- 搜索 ----------------

export type SearchType = 1 | 10 | 100 | 1000; // 单曲/歌手/歌单/专辑

export interface SearchResults {
  songs: NcmSong[];
  artists: NcmArtist[];
  playlists: NcmPlaylist[];
  albums: NcmAlbum[];
}

export async function search(keywords: string, type: SearchType = 1, limit = 30, offset = 0): Promise<SearchResults> {
  // 用 cloudsearch（旧 /search 的专辑 picUrl 为空、歌手字段缺失 → 封面灰块 +「未知歌手」）
  const j = await ncmRequest<{
    result: {
      songs?: NcmSong[];
      artists?: NcmArtist[];
      playlists?: NcmPlaylist[];
      albums?: NcmAlbum[];
    };
  }>('cloudsearch', { keywords, type, limit, offset });
  const r = j.result ?? {};
  return {
    songs: (r.songs ?? []).map(normalizeSong),
    artists: r.artists ?? [],
    playlists: r.playlists ?? [],
    albums: r.albums ?? [],
  };
}

export interface HotSearchItem {
  searchWord: string;
  score: number;
  iconUrl?: string;
}

export async function hotSearch(): Promise<HotSearchItem[]> {
  const j = await ncmRequest<{ data: HotSearchItem[] }>('search/hot/detail');
  return j.data ?? [];
}

/** 相似歌曲（首页「根据你喜爱的歌曲推荐」/ 播放页「开始相似歌曲漫游」） */
export async function simiSong(id: number, limit = 6): Promise<NcmSong[]> {
  const j = await ncmRequest<{ songs?: NcmSong[] }>('simi/song', { id, limit });
  return (j.songs ?? []).map(normalizeSong);
}

/** 歌手热门歌曲 */
export async function artistSongs(id: number, limit = 30): Promise<{ artist: NcmArtist; songs: NcmSong[] }> {
  const j = await ncmRequest<{ artist: NcmArtist; hotSongs: NcmSong[] }>('artists', { id, limit });
  return { artist: j.artist, songs: (j.hotSongs ?? []).map(normalizeSong) };
}

export async function artistSub(id: number, t: 1 | 2): Promise<void> {
  await authRequest('artist/sub', { id, t });
}

/** 专辑详情 + 曲目 */
export async function albumDetail(id: number): Promise<{ album: NcmAlbum; songs: NcmSong[] }> {
  const j = await ncmRequest<{ album: NcmAlbum; songs: NcmSong[] }>('album', { id });
  return { album: j.album, songs: (j.songs ?? []).map(normalizeSong) };
}

export async function albumSub(id: number, t: 1 | 2): Promise<void> {
  await authRequest('album/sub', { id, t });
}

// ---------------- 歌曲/播放 ----------------

/** song/detail 新旧格式统一 */
export function normalizeSong(s: NcmSong): NcmSong {
  // ar：song/detail 新格式为单个对象，cloudsearch 为数组 —— 统一成 artists 数组
  const ar = s.ar;
  return {
    ...s,
    name: s.name,
    artists: s.artists ?? (Array.isArray(ar) ? ar : ar ? [ar] : []),
    album: s.album ?? s.al,
    duration: s.duration ?? s.dt ?? 0,
  };
}

export function songArtistText(s: NcmSong): string {
  return (s.artists ?? []).map((a) => a.name).join('/') || '未知歌手';
}

export function songAlbumText(s: NcmSong): string {
  return s.album?.name || '';
}

export function songCover(s: NcmSong): string {
  return s.album?.picUrl || '';
}

export function songDurationMs(s: NcmSong): number {
  return s.duration ?? 0;
}

/** 批量歌曲详情（ids 逗号分隔，≤1000） */
export async function songsDetail(ids: number[]): Promise<NcmSong[]> {
  if (!ids.length) return [];
  const j = await authRequest<{ songs: NcmSong[] }>('song/detail', { ids: ids.join(',') });
  return (j.songs ?? []).map(normalizeSong);
}

export interface SongUrlResult {
  url: string | null;
  fee: number;
  freeTrial: boolean;
  br: number;
  type: string;
}

/** 播放直链（level: standard/exhigher/higher 等）。
 * realIP：伪造国内客户端 IP —— 本沙箱/服务器出口 IP 常为海外，网易对匿名请求直接拒发直链
 * （游客连免费歌都 404）；带 realIP 后游客可拿免费歌完整直链 + VIP 歌试听片段
 * （freeTrialInfo {start,end}），登录用户不受影响。 */
export async function songUrl(id: number, level = 'standard'): Promise<SongUrlResult> {
  const j = await authRequest<{
    data: {
      url: string | null;
      fee: number;
      br: number;
      type: string;
      freeTrialInfo?: { start: number; end: number } | null;
    }[];
  }>('song/url/v1', { id, level, realIP: '116.25.146.177' });
  const d = j.data?.[0];
  if (!d) return { url: null, fee: 0, freeTrial: false, br: 0, type: '' };
  return {
    url: d.url,
    fee: d.fee ?? 0,
    freeTrial: !!d.freeTrialInfo,
    br: d.br ?? 0,
    type: d.type ?? 'mp3',
  };
}

/** 红心/取消红心（需登录）；返回 true=已红心 */
export async function likeSong(id: number, like: boolean): Promise<boolean> {
  await authRequest('like', { id, like: like ? 'true' : 'false' });
  return like;
}

export async function likeList(uid: number): Promise<number[]> {
  const j = await authRequest<{ ids: number[] }>('likelist', { uid });
  return j.ids ?? [];
}

// ---------------- 歌词 ----------------

function parseLrcLines(raw: string): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\](.*)$/);
    if (!m) continue;
    const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0);
    const text = (m[4] ?? '').trim();
    if (text) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 歌词缓存（按歌曲 ID；含「无歌词」的空结果也缓存——切回听过的歌不重复请求） */
const lyricCache = new Map<number, NcmLyric>();
const LYRIC_CACHE_MAX = 120;

export async function lyricOf(id: number): Promise<NcmLyric> {
  const hit = lyricCache.get(id);
  if (hit) return hit;
  const j = await ncmRequest<{
    lrc?: { lyric?: string };
    tlyric?: { lyric?: string };
  }>('lyric', { id, tv: -1, rv: -1, lv: -1, kv: -1 });
  const lrc = j.lrc?.lyric ?? '';
  const tl = j.tlyric?.lyric ?? '';
  const ly: NcmLyric = { lrc, tlyric: tl, hasTranslation: tl.trim().length > 0 };
  // 简单 FIFO 上限，防长会话内存膨胀
  if (lyricCache.size >= LYRIC_CACHE_MAX) {
    const oldest = lyricCache.keys().next().value;
    if (oldest !== undefined) lyricCache.delete(oldest);
  }
  lyricCache.set(id, ly);
  return ly;
}

/** 解析歌词 + 翻译对齐（按时间戳就近匹配 ≤0.5s） */
export function buildLyricLines(ly: NcmLyric): { t: number; text: string; tr: string }[] {
  const lines = parseLrcLines(ly.lrc);
  const trs = parseLrcLines(ly.tlyric);
  return lines.map((l) => {
    let tr = '';
    let best = Infinity;
    for (const t2 of trs) {
      const d = Math.abs(t2.t - l.t);
      if (d < best) {
        best = d;
        tr = t2.text;
      }
      if (d > 2) break;
    }
    return { t: l.t, text: l.text, tr: best <= 0.6 ? tr : '' };
  });
}

// ---------------- 评论 ----------------

export interface CommentPage {
  total: number;
  hot: NcmComment[];
  comments: NcmComment[];
  offset: number;
  hasMore: boolean;
}

export async function commentsOf(songId: number, limit = 20, offset = 0): Promise<CommentPage> {
  const j = await authRequest<{
    total: number;
    hotComments?: NcmComment[];
    comments: NcmComment[];
    more?: boolean;
  }>('comment/music', { id: songId, limit, offset });
  return {
    total: j.total ?? 0,
    hot: j.hotComments ?? [],
    comments: j.comments ?? [],
    offset,
    hasMore: !!j.more,
  };
}

export async function commentLike(songId: number, commentId: number, t: 1 | 2): Promise<void> {
  await authRequest('comment/like', { id: songId, commentId, t }); // t=1 赞 t=2 取消
}

/** 新版评论列表排序：1 推荐 / 2 最热 / 3 最新（/comment/new，按截图评论页三档 tab） */
export type CommentSortType = 1 | 2 | 3;

export interface CommentNewPage {
  total: number;
  comments: NcmComment[];
  hasMore: boolean;
  /** 翻页游标（下一页原样带回；sortType=3 为时间戳、1/2 为 hot#N 形式） */
  cursor: string;
}

/** 新版评论列表（独立评论页数据源；cursor 翻页） */
export async function commentsNew(
  songId: number,
  sortType: CommentSortType,
  pageSize = 20,
  cursor = '',
): Promise<CommentNewPage> {
  const j = await authRequest<{
    data?: { comments?: NcmComment[]; totalCount?: number; hasMore?: boolean; cursor?: string };
  }>('comment/new', {
    id: songId,
    type: 0,
    pageNo: 1,
    pageSize,
    sortType,
    ...(cursor ? { cursor } : {}),
  });
  const d = j.data ?? {};
  return {
    total: d.totalCount ?? 0,
    comments: d.comments ?? [],
    hasMore: !!d.hasMore,
    cursor: d.cursor ?? '',
  };
}

/** 楼层回复（评论页「展开 N 条回复」） */
export async function commentFloor(
  songId: number,
  parentCommentId: number,
  limit = 20,
): Promise<{ total: number; comments: NcmComment[]; hasMore: boolean }> {
  const j = await authRequest<{
    data?: { comments?: NcmComment[]; totalCount?: number; hasMore?: boolean };
  }>('comment/floor', { id: songId, parentCommentId, type: 0, limit });
  const d = j.data ?? {};
  return { total: d.totalCount ?? 0, comments: d.comments ?? [], hasMore: !!d.hasMore };
}

/** 发表评论（t=1）/ 回复评论（t=2 + commentId） */
export async function postComment(songId: number, content: string, replyTo?: number): Promise<void> {
  await authRequest('comment', { t: replyTo ? 2 : 1, type: 0, id: songId, content, commentId: replyTo });
}

// ---------------- 用户数据 ----------------

export interface RecordSong {
  song: NcmSong;
  playCount: number;
  score: number;
}

/** 听歌排行 type=1 周 / 0 所有 */
export async function userRecord(uid: number, type: 0 | 1): Promise<RecordSong[]> {
  const j = await authRequest<{ weekData?: { song: NcmSong; playCount: number; score: number }[]; allData?: { song: NcmSong; playCount: number; score: number }[] }>(
    'user/record',
    { uid, type },
  );
  const arr = type === 1 ? j.weekData : j.allData;
  return (arr ?? []).map((x) => ({ song: normalizeSong(x.song), playCount: x.playCount ?? 0, score: x.score ?? 0 }));
}

export interface NcmUserDetail {
  profile: NcmUser;
  level: number;
  listenSongs: number;
  createTime?: number;
}

export async function userDetail(uid: number): Promise<NcmUserDetail | null> {
  try {
    const j = await authRequest<{
      profile: NcmUser;
      level: number;
      listenSongs: number;
      createTime: number;
    }>('user/detail', { uid });
    return { profile: j.profile, level: j.level, listenSongs: j.listenSongs, createTime: j.createTime };
  } catch {
    return null;
  }
}

// ---------------- VIP 信息 ----------------

export interface VipInfo {
  /** 是否有效会员（黑胶VIP / 黑胶SVIP 任一在期） */
  isVip: boolean;
  type: 'vip' | 'svip';
  /** VIP 等级（1-7+，0 = 非会员） */
  level: number;
}

interface VipBlockLike {
  vipCode?: number;
  expireTime?: number;
  vipLevel?: number;
}

/** 黑胶块是否在期（vipLevel>0 且未过期；expireTime=0 视为无会员） */
function vipBlockActive(b: VipBlockLike | undefined, now: number): boolean {
  if (!b || !b.vipLevel || b.vipLevel <= 0) return false;
  return !b.expireTime || b.expireTime > now;
}

/**
 * 当前登录账号的真实 VIP 信息（「我的」页 VIP 是几显示几）：
 * - associator = 黑胶VIP，redplus = 黑胶SVIP；等级取对应块的 vipLevel
 * - 非会员/接口失败 → { isVip:false, level:0 }（展示无数字的 VIP 胶囊）
 */
export async function vipInfo(): Promise<VipInfo> {
  const now = Date.now();
  try {
    const j = await authRequest<{ data?: { associator?: VipBlockLike; redplus?: VipBlockLike } }>('vip/info');
    const rp = j.data?.redplus;
    const aso = j.data?.associator;
    if (vipBlockActive(rp, now)) {
      return { isVip: true, type: 'svip', level: Math.floor(rp!.vipLevel as number) };
    }
    if (vipBlockActive(aso, now)) {
      return { isVip: true, type: 'vip', level: Math.floor(aso!.vipLevel as number) };
    }
  } catch {
    // 接口失败走 profile 兜底
  }
  // 兜底：profile.vipType（11=黑胶VIP 100=黑胶SVIP），等级未知按 1 展示
  const vt = getMusicLogin()?.profile.vipType ?? 0;
  if (vt === 11 || vt === 100) return { isVip: true, type: vt === 100 ? 'svip' : 'vip', level: 1 };
  return { isVip: false, type: 'vip', level: 0 };
}

// ---------------- 收藏歌手/专辑列表 ----------------

export async function artistSublist(): Promise<NcmArtist[]> {
  const j = await authRequest<{ data: NcmArtist[] }>('artist/sublist', { limit: 50 });
  return j.data ?? [];
}

export async function albumSublist(): Promise<NcmAlbum[]> {
  const j = await authRequest<{ data: NcmAlbum[] }>('album/sublist', { limit: 50 });
  return j.data ?? [];
}
