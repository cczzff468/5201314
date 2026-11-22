'use client';

/**
 * 音乐 App 多平台统一客户端层（网易云 / QQ音乐 / 酷狗）
 *
 * 职责：
 * 1. 三平台 API 配置（Base URL）—— 网易云部分沿用 music-api.ts 的 cfg（单一数据源），
 *    QQ/酷狗的 Base URL 存本模块（IndexedDB kv，AES-GCM 密文落盘，同 music-api 模式）；
 *    留空 = 内置默认（同源 Next 代理 /api/music/qq/*、/api/music/kugou/*，本机优先云端兜底）。
 * 2. QQ/酷狗登录凭证持久化（cookie/token，密文 kv：music-login-qq / music-login-kugou）——
 *    与 music-api.ts 的 MUSIC_U 同模式：内存明文缓存 + 异步注水（music-store.boot 时 await），
 *    同步 getter 供 UI 即读。
 * 3. 统一数据访问：推荐歌单/歌单详情/用户歌单/我喜欢/搜索/播放直链/歌词/用户资料，
 *    全部归一为 NcmSong/NcmPlaylist/NcmLyric 形状（NcmSong 扩展 platform 专属字段），
 *    上层 UI（首页/我的/搜索/播放器/歌单页）几乎零改动。
 * 4. 游客解灰（UNM）：unmMatchUrl(id) → 网易云拿不到直链时到其它平台找免费可播链接。
 */

import { normalizeSong, getMusicLogin, type NcmSong, type NcmPlaylist, type NcmLyric, type NcmComment } from './music-api';
import { ensureKvReady, kvGet, kvSet, kvDel } from './idb-kv';
import { decryptSecret, encryptSecret, isEncrypted } from './secret-box';

// ---------------- 平台 ----------------

export type MusicPlatform = 'netease' | 'qq' | 'kugou';

export const PLATFORM_LABELS: Record<MusicPlatform, string> = {
  netease: '网易云',
  qq: 'QQ音乐',
  kugou: '酷狗',
};

export const PLATFORM_FULL: Record<MusicPlatform, string> = {
  netease: '网易云音乐',
  qq: 'QQ音乐',
  kugou: '酷狗音乐',
};

/** 平台品牌色（小圆点/徽标用） */
export const PLATFORM_DOTS: Record<MusicPlatform, string> = {
  netease: '#C20C0C',
  qq: '#31c27c',
  kugou: '#00b0f0',
};

export const MUSIC_PLATFORMS: MusicPlatform[] = ['netease', 'qq', 'kugou'];

export function isMusicPlatform(v: unknown): v is MusicPlatform {
  return v === 'netease' || v === 'qq' || v === 'kugou';
}

// ---------------- 统一歌曲模型 ----------------

/**
 * NcmSong 扩展：跨平台歌曲统一形状。
 * - id：平台内数字 id（网易: song id；QQ: songid；酷狗: mixsongid/audio_id）——队列去重/红心键
 * - platform：播放时按此分支取直链
 * - qqMid：QQ songmid（播放/歌词/详情用）
 * - kgHash：酷狗 32 位文件 hash（播放/歌词用）
 */
export interface UnifiedSong extends NcmSong {
  platform?: MusicPlatform;
  /** QQ songmid（播放/歌词/详情用） */
  qqMid?: string;
  /** QQ media_mid（songmid 与 media_mid 不同时，播放直链的文件名必须用它拼——
   *  缺失时上游默认用 songmid 兜底，部分歌曲会拿不到直链） */
  qqMediaMid?: string;
  kgHash?: string;
  kgEmixId?: number;
}

export function songPlatform(s: UnifiedSong | NcmSong | null | undefined): MusicPlatform {
  return (s && (s as UnifiedSong).platform) || 'netease';
}

export function withPlatform(s: NcmSong, p: MusicPlatform, extra: Partial<UnifiedSong> = {}): UnifiedSong {
  const n = normalizeSong(s);
  return { ...n, platform: p, ...extra };
}

// ---------------- 配置持久化（qq/kugou Base URL） ----------------

export interface PlatformApiCfg {
  baseUrl: string;
}

export interface MultiMusicCfg {
  qq: PlatformApiCfg;
  kugou: PlatformApiCfg;
}

const CFG_KEY = 'music-multi-cfg';
export const DEFAULT_MULTI_CFG: MultiMusicCfg = { qq: { baseUrl: '' }, kugou: { baseUrl: '' } };

let memCfg: MultiMusicCfg | null = null;
let cfgDirty = false;

export function getMultiCfg(): MultiMusicCfg {
  return memCfg ? { qq: { ...memCfg.qq }, kugou: { ...memCfg.kugou } } : { qq: { baseUrl: '' }, kugou: { baseUrl: '' } };
}

export function setMultiCfg(next: Partial<MultiMusicCfg>): void {
  const cur = getMultiCfg();
  memCfg = {
    qq: { baseUrl: (next.qq?.baseUrl ?? cur.qq.baseUrl).trim() },
    kugou: { baseUrl: (next.kugou?.baseUrl ?? cur.kugou.baseUrl).trim() },
  };
  cfgDirty = true;
  void encryptSecret(JSON.stringify(memCfg)).then((enc) => kvSet(CFG_KEY, enc));
}

// ---------------- 登录凭证持久化（三平台隔离存储，互不覆盖） ----------------

/**
 * 三平台账号快照（AuthStore 统一读取口径）：
 * `accounts = { netease: {...}, qq: {...}, kugou: {...} }` —— 三个平台的鉴权信息
 * （Cookie/Token）各自独立持久化（网易云：music-api 的 MUSIC_U；QQ：music-login-qq；
 * 酷狗：music-login-kugou，均 AES-GCM 密文 kv），可同时处于「已登录」状态，互不覆盖。
 */
export interface PlatformAccount {
  uid: string;
  nickname: string;
  avatar: string;
}
export interface AccountsSnapshot {
  netease: PlatformAccount | null;
  qq: PlatformAccount | null;
  kugou: PlatformAccount | null;
}

/** 读取三平台账号快照（内存缓存即时值；UI 判断登录态/头像昵称统一走这里或 useMusic） */
export function accountsSnapshot(): AccountsSnapshot {
  let netease: PlatformAccount | null = null;
  try {
    const l = getMusicLogin();
    if (l?.profile?.userId) {
      netease = {
        uid: String(l.profile.userId),
        nickname: l.profile.nickname || '',
        avatar: l.profile.avatarUrl || '',
      };
    }
  } catch {
    /* music-api 未注水时按未登录处理 */
  }
  const qq = getQqLogin();
  const kg = getKgLogin();
  return {
    netease,
    qq: qq ? { uid: qq.uin, nickname: qq.nickname, avatar: qq.avatar } : null,
    kugou: kg ? { uid: kg.userid, nickname: kg.nickname, avatar: kg.avatar } : null,
  };
}

export interface QqMusicLogin {
  cookie: string;
  uin: string;
  musickey: string;
  /** encryptUin（我喜欢的歌曲接口 enc_host_uin 必需；缺失会拿到空/其它账号数据） */
  euin: string;
  nickname: string;
  avatar: string;
  /** 粉丝/关注（v2/user/profile 真实数据；0 = 未知） */
  fans: number;
  follows: number;
  savedAt: number;
}

export interface KugouLogin {
  cookie: string;
  userid: string;
  token: string;
  nickname: string;
  avatar: string;
  /** 粉丝/关注（user/detail 真实数据；0 = 未知） */
  fans: number;
  follows: number;
  savedAt: number;
}

const QQ_LOGIN_KEY = 'music-login-qq';
const KG_LOGIN_KEY = 'music-login-kugou';

let memQq: QqMusicLogin | null = null;
let memKg: KugouLogin | null = null;
let qqDirty = false;
let kgDirty = false;
let multiReady = false;
let multiPromise: Promise<void> | null = null;

export function getQqLogin(): QqMusicLogin | null {
  return memQq;
}
export function setQqLogin(l: QqMusicLogin): void {
  memQq = l;
  qqDirty = true;
  void encryptSecret(JSON.stringify(l)).then((enc) => kvSet(QQ_LOGIN_KEY, enc));
}
export function clearQqLogin(): void {
  memQq = null;
  qqDirty = true;
  kvDel(QQ_LOGIN_KEY);
}

/** 酷狗 cookie 串规范化：键值对分隔符 `;` 后不得留空格。
 *  根因（「登录后昵称/歌单/排行不是本人」）：上游 server.js 的 cookieToJson 按 `;` 切分，
 *  `"token=xx; userid=yy"` 会产生带前导空格的键 `' userid'` → 模块读 `cookie.userid`
 *  恒 undefined → userid=0 发给酷狗 → 返回空/公共数据。旧存档的 cookie 统一在本函数自愈。 */
function normKgCookie(c: string): string {
  return c.replace(/;\s+/g, ';');
}

export function getKgLogin(): KugouLogin | null {
  // 旧存档（`; ` 带空格分隔）读出时统一自愈为无空格格式，下游所有请求即拿到正确 userid
  return memKg ? { ...memKg, cookie: normKgCookie(memKg.cookie) } : null;
}
export function setKgLogin(l: KugouLogin): void {
  memKg = { ...l, cookie: normKgCookie(l.cookie) };
  kgDirty = true;
  void encryptSecret(JSON.stringify(memKg)).then((enc) => kvSet(KG_LOGIN_KEY, enc));
}
export function clearKgLogin(): void {
  memKg = null;
  kgDirty = true;
  kvDel(KG_LOGIN_KEY);
}

async function readKvJson(key: string): Promise<{ value: unknown; legacy: boolean }> {
  const raw = kvGet<unknown>(key);
  if (typeof raw === 'string') {
    if (!isEncrypted(raw)) return { value: null, legacy: false };
    try {
      return { value: JSON.parse(await decryptSecret(raw)), legacy: false };
    } catch {
      return { value: null, legacy: false };
    }
  }
  return { value: raw, legacy: raw != null };
}

/** 注水（music-store.boot 开头 await；模块加载时 fire-and-forget） */
export function ensureMultiLoaded(): Promise<void> {
  if (multiPromise) return multiPromise;
  multiPromise = (async () => {
    try {
      await ensureKvReady();
      const [cfgRec, qqRec, kgRec] = await Promise.all([
        readKvJson(CFG_KEY),
        readKvJson(QQ_LOGIN_KEY),
        readKvJson(KG_LOGIN_KEY),
      ]);
      if (!cfgDirty && cfgRec.value && typeof cfgRec.value === 'object') {
        const v = cfgRec.value as Partial<MultiMusicCfg>;
        memCfg = {
          qq: { baseUrl: typeof v.qq?.baseUrl === 'string' ? v.qq.baseUrl : '' },
          kugou: { baseUrl: typeof v.kugou?.baseUrl === 'string' ? v.kugou.baseUrl : '' },
        };
        if (cfgRec.legacy && (memCfg.qq.baseUrl || memCfg.kugou.baseUrl)) {
          void encryptSecret(JSON.stringify(memCfg)).then((enc) => kvSet(CFG_KEY, enc));
        }
      }
      if (!qqDirty && qqRec.value && typeof qqRec.value === 'object') {
        const v = qqRec.value as Partial<QqMusicLogin>;
        if (v.cookie && v.uin) {
          memQq = { ...v, euin: v.euin || '', nickname: v.nickname || '', avatar: v.avatar || '', fans: v.fans || 0, follows: v.follows || 0, savedAt: v.savedAt || Date.now() } as QqMusicLogin;
          if (qqRec.legacy) void encryptSecret(JSON.stringify(memQq)).then((enc) => kvSet(QQ_LOGIN_KEY, enc));
        }
      }
      if (!kgDirty && kgRec.value && typeof kgRec.value === 'object') {
        const v = kgRec.value as Partial<KugouLogin>;
        if (v.cookie && v.userid) {
          memKg = { ...v, token: v.token || '', nickname: v.nickname || '', avatar: v.avatar || '', fans: v.fans || 0, follows: v.follows || 0, savedAt: v.savedAt || Date.now() } as KugouLogin;
          if (kgRec.legacy) void encryptSecret(JSON.stringify(memKg)).then((enc) => kvSet(KG_LOGIN_KEY, enc));
        }
      }
    } catch {
      /* 降级：按无配置处理 */
    } finally {
      multiReady = true;
    }
  })();
  return multiPromise;
}

if (typeof window !== 'undefined') void ensureMultiLoaded();
void multiReady; //（保留标志位供后续同步读判断）

/** 平台身份键（本地数据隔离前缀；netease 保持 music-api.musicUid() 旧口径不破坏既有存档） */
export function platformUid(p: MusicPlatform): string {
  if (p === 'netease') {
    // 延迟 require 防止循环依赖（music-api ← 本模块）
    const l = kvGet<{ profile?: { userId?: number } }>('music-login'); // 不可靠路径，兜底在 music-store 内处理
    void l;
    return neteaseUidForKeys();
  }
  if (p === 'qq') {
    const q = getQqLogin();
    return q ? `qq:${q.uin}` : 'guest';
  }
  const g = getKgLogin();
  return g ? `kg:${g.userid}` : 'guest';
}

/** 网易云 uid 键（与 music-api.musicUid 同口径；通过动态 import 避免循环依赖） */
let neteaseUidCache: string | null = null;
function neteaseUidForKeys(): string {
  if (neteaseUidCache) return neteaseUidCache;
  // music-api 的内存缓存在同页内即时更新；dynamic import 同步兜底困难，
  // 采用事件无关方案：由 music-store 在登录态变化时调 setNeteaseUidKey 同步。
  return neteaseUidCache ?? 'guest';
}
export function setNeteaseUidKey(uid: string): void {
  neteaseUidCache = uid;
}

// ---------------- 请求核心 ----------------

export class MusicApiError extends Error {
  code: number;
  constructor(message: string, code = -1) {
    super(message);
    this.code = code;
  }
}

function buildPlatformUrl(p: 'qq' | 'kugou', path: string, params: Record<string, string | number | undefined | boolean>): string {
  const cfg = getMultiCfg();
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}` !== '') q.set(k, `${v}`);
  }
  q.set('timestamp', `${Date.now()}`);
  const base = p === 'qq' ? cfg.qq.baseUrl : cfg.kugou.baseUrl;
  if (base) return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}?${q.toString()}`;
  return `/api/music/${p}/${path}?${q.toString()}`;
}

async function qqRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined | boolean> = {},
): Promise<T> {
  const url = buildPlatformUrl('qq', path, params);
  const res = await fetch(url);
  if (!res.ok) throw new MusicApiError(`网络错误 ${res.status}`, res.status);
  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new MusicApiError('接口返回格式异常');
  }
  // jsososo 形状：{result:100, data} 成功 / {result:!=100, errMsg}
  // v2 形状：{code:200, data} / {code:301 未登陆}
  // 老 fcg 透传形状（user/detail 实测）：{code:0, subcode:0, result:100, data:{...}} ——
  //  code:0 是 fcg 自身的成功码（≠v2 的非 200 错误码），必须先看 result 再判 code，
  //  否则 code:0 会被当成 v2 错误直接抛掉（QQ 登录后昵称/头像恒空的根因）
  const result = j.result as number | undefined;
  if (typeof result === 'number') {
    if (result === 100 || result === 0) return (j.data ?? (j as unknown)) as T;
    throw new MusicApiError((j.errMsg as string) || `接口错误 (${result})`, result);
  }
  const code = j.code as number | undefined;
  if (typeof code === 'number') {
    if (code === 200 || code === 0) return (j.data ?? (j as unknown)) as T;
    throw new MusicApiError((j.errMsg as string) || `接口错误 (${code})`, code);
  }
  throw new MusicApiError('接口返回格式异常');
}

/** QQ 带 cookie 请求（统一 ownCookie=1 + ?cookie= 透传） */
async function qqAuthRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined | boolean> = {},
): Promise<T> {
  const l = getQqLogin();
  if (!l) throw new MusicApiError('未登录 QQ 音乐', 301);
  return qqRequest<T>(path, { ...params, ownCookie: 1, cookie: l.cookie });
}

async function kgRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined | boolean> = {},
): Promise<T> {
  const url = buildPlatformUrl('kugou', path, params);
  const res = await fetch(url);
  if (!res.ok) throw new MusicApiError(`网络错误 ${res.status}`, res.status);
  const text = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new MusicApiError('接口返回格式异常');
  }
  // 酷狗形状：{status:1, data, error_code:0} 成功 / {status:0, error_code, errmsg}
  const st = j.status as number | undefined;
  if (st === 1) return (j.data ?? (j as unknown)) as T;
  const ec = j.error_code as number | undefined;
  const msg = (j.errmsg as string) || (j.error_msg as string) || `接口错误 (${ec ?? st})`;
  throw new MusicApiError(msg, ec ?? st ?? -1);
}

/** 酷狗带 cookie 请求（?cookie=token=xx; userid=yy） */
async function kgAuthRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined | boolean> = {},
): Promise<T> {
  const l = getKgLogin();
  if (!l) throw new MusicApiError('未登录酷狗音乐', 301);
  return kgRequest<T>(path, { ...params, cookie: l.cookie });
}

// ---------------- QQ 音乐：登录 ----------------

export interface QrImage {
  id: string;
  qrimg: string;
}

export type QrPollStatus = 'waiting' | 'scanned' | 'expired' | 'ok' | 'error';

export interface QrPollResult {
  st: QrPollStatus;
  msg?: string;
}

/** QQ 扫码：取二维码 */
export async function qqQrCreate(): Promise<QrImage> {
  const d = await qqRequest<{ id: string; qrimg: string }>('login/qq/qr/create');
  if (!d?.id || !d?.qrimg) throw new MusicApiError('获取 QQ 登录二维码失败');
  return { id: d.id, qrimg: d.qrimg };
}

/** QQ 扫码：轮询（ok 时自动完成登录持久化） */
export async function qqQrCheck(id: string): Promise<QrPollResult> {
  const d = await qqRequest<{ status: string; msg?: string; uin?: string; musickey?: string; cookie?: string; extra?: Record<string, unknown> }>(
    'login/qq/qr/check',
    { id },
  );
  if (d.status === 'ok') {
    if (!d.cookie) return { st: 'error', msg: '登录成功但未取得凭证' };
    await completeQqLogin(d.cookie, String(d.uin || ''), String(d.musickey || ''), d.extra);
    return { st: 'ok' };
  }
  if (d.status === 'waiting' || d.status === 'scanned' || d.status === 'expired') return { st: d.status };
  return { st: 'error', msg: d.msg || '登录失败' };
}

/** 微信扫码：取二维码 */
export async function wxQrCreate(): Promise<QrImage> {
  const d = await qqRequest<{ id: string; qrimg: string }>('login/wx/qr/create');
  if (!d?.id || !d?.qrimg) throw new MusicApiError('获取微信登录二维码失败');
  return { id: d.id, qrimg: d.qrimg };
}

/** 微信扫码：轮询（ok 时自动完成登录持久化） */
export async function wxQrCheck(id: string): Promise<QrPollResult> {
  const d = await qqRequest<{ status: string; msg?: string; uin?: string; musickey?: string; cookie?: string; extra?: Record<string, unknown> }>(
    'login/wx/qr/check',
    { id },
  );
  if (d.status === 'ok') {
    if (!d.cookie) return { st: 'error', msg: '登录成功但未取得凭证' };
    await completeQqLogin(d.cookie, String(d.uin || ''), String(d.musickey || ''), d.extra);
    return { st: 'ok' };
  }
  if (d.status === 'waiting' || d.status === 'scanned' || d.status === 'expired') return { st: d.status };
  return { st: 'error', msg: d.msg || '登录失败' };
}

async function completeQqLogin(cookie: string, uin: string, musickey: string, extra?: Record<string, unknown>): Promise<QqMusicLogin> {
  let nickname = '';
  let avatar = '';
  let euin = '';
  let fans = 0;
  let follows = 0;
  if (extra && typeof extra === 'object') {
    euin = String((extra as { encryptUin?: unknown }).encryptUin || '');
  }
  try {
    const prof = await qqProfileWithCookie(cookie, uin);
    nickname = prof.nickname;
    avatar = prof.avatar;
    euin = euin || prof.euin || '';
    fans = prof.fans;
    follows = prof.follows;
  } catch {
    /* 资料拉取失败不阻塞登录 */
  }
  const login: QqMusicLogin = { cookie, uin, musickey, euin, nickname, avatar, fans, follows, savedAt: Date.now() };
  setQqLogin(login);
  return login;
}

async function qqProfileWithCookie(
  cookie: string,
  uin: string,
): Promise<{ nickname: string; avatar: string; euin: string; fans: number; follows: number }> {
  // v2 现代接口优先（已修复为映射上游真实形状 Info.BaseInfo：昵称/头像/EncryptedUin/粉丝/关注）。
  // 4.5s 超时保护：v2 上游偶发 25s+ 挂起（实测曾在登录时阻塞资料拉取导致昵称/头像恒空），
  // 超时立即回退老接口，不再让登录流程干等。
  try {
    const d = await Promise.race([
      qqRequest<{ nickname?: string; avatar?: string; euin?: string; fans?: number; follows?: number }>('v2/user/profile', {
        uin,
        ownCookie: 1,
        cookie,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);
    if (d && (d.nickname || d.avatar || d.euin)) {
      return { nickname: d.nickname || '', avatar: d.avatar || '', euin: d.euin || '', fans: d.fans || 0, follows: d.follows || 0 };
    }
  } catch {
    /* 回退老接口 */
  }
  const d2 = await qqRequest<{
    creator?: {
      nick?: string;
      headpic?: string;
      head?: string;
      encrypt_uin?: string;
      encryptUin?: string;
      nums?: { fansnum?: number; follownum?: number; frdnum?: number; visitornum?: number };
    };
    nick?: string;
    headpic?: string;
    head?: string;
  }>('user/detail', {
    id: uin,
    ownCookie: 1,
    cookie,
  });
  const t = d2 as unknown as {
    creator?: {
      nick?: string;
      headpic?: string;
      head?: string;
      encrypt_uin?: string;
      encryptUin?: string;
      nums?: { fansnum?: number; follownum?: number; frdnum?: number; visitornum?: number };
    };
    nick?: string;
    headpic?: string;
    head?: string;
  };
  // 实测形状（2026-11）：fcg_get_profile_homepage 返回 data.creator.{nick,headpic,encrypt_uin}；
  // 微信注册的虚拟 uin 走不通 v2 GetHomepageHeader（musicu code 10000），
  // 这个老接口反而是 QQ/微信账号都能拿到真实昵称+头像的稳定通道。
  // creator.nums = {visitornum, fansnum, follownum, followusernum, followsingernum, frdnum}
  // —— 「关注/粉丝跟随账号」的真实数据源（v2 走不通的账号此前恒 0 的根因）
  return {
    nickname: t?.creator?.nick || t?.nick || '',
    avatar: t?.creator?.headpic || t?.creator?.head || t?.headpic || t?.head || '',
    euin: t?.creator?.encrypt_uin || t?.creator?.encryptUin || '',
    fans: Number(t?.creator?.nums?.fansnum ?? 0) || 0,
    follows: Number(t?.creator?.nums?.follownum ?? 0) || 0,
  };
}

/** 校验 QQ 登录态（boot 恢复时）；失效自动清除，网络异常保留。
 *  校验通过时顺带刷新资料（昵称/头像/euin/粉丝/关注）并回写持久化 ——
 *  修复「登录后头像/昵称/我喜欢不是本人」：旧存档缺 euin 时在此回填。*/
export async function refreshQqLogin(): Promise<QqMusicLogin | null> {
  const l = getQqLogin();
  if (!l) return null;
  try {
    const d = await Promise.race([
      qqAuthRequest<{ nickname?: string; avatar?: string; euin?: string; fans?: number; follows?: number }>('v2/user/profile', { uin: l.uin }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);
    if (d && (d.nickname || d.avatar || d.euin)) {
      const next: QqMusicLogin = {
        ...l,
        nickname: d.nickname || l.nickname,
        avatar: d.avatar || l.avatar,
        euin: d.euin || l.euin,
        fans: d.fans ?? l.fans,
        follows: d.follows ?? l.follows,
      };
      const changed =
        next.nickname !== l.nickname || next.avatar !== l.avatar || next.euin !== l.euin ||
        next.fans !== l.fans || next.follows !== l.follows;
      if (changed) setQqLogin(next);
      return next;
    }
    // 走到这里 = v2 超时（race 出 null）或返回空资料（微信虚拟 uin 实测 code 10000 / 空壳）：
    // 不能确认登录态 → 老接口 user/detail 校验+拉资料（不再等 v2）
    throw new MusicApiError('v2 empty/timeout', -1);
  } catch (e) {
    if (e instanceof MusicApiError && e.code === 301) {
      clearQqLogin();
      return null;
    }
    // v2 对微信注册的虚拟 uin 会失败（musicu code 10000，实测）→
    // 退老接口 user/detail：既校验登录态（301/1000 自动清除）又拉真实昵称/头像/euin
    try {
      const prof = await qqProfileWithCookie(l.cookie, l.uin);
      if (prof.nickname || prof.avatar || prof.euin) {
        const next: QqMusicLogin = {
          ...l,
          nickname: prof.nickname || l.nickname,
          avatar: prof.avatar || l.avatar,
          euin: prof.euin || l.euin,
          fans: prof.fans || l.fans,
          follows: prof.follows || l.follows,
        };
        const changed =
          next.nickname !== l.nickname || next.avatar !== l.avatar || next.euin !== l.euin ||
          next.fans !== l.fans || next.follows !== l.follows;
        if (changed) setQqLogin(next);
        return next;
      }
      return l; // 资料字段全空 = 登录态正常但接口没给资料，保留旧快照
    } catch (e2) {
      if (e2 instanceof MusicApiError && (e2.code === 301 || e2.code === 1000)) {
        clearQqLogin();
        return null;
      }
      return l; // 网络异常保守保留
    }
  }
}

// ---------------- QQ 音乐：数据 ----------------

/** QQ 专辑封面：albumPmid/albummid → y.gtimg.cn 标准封面（pmid 优先）
 *  （搜索与 v2 接口都不直接给封面 URL，必须用 mid 拼；已实测 200） */
export function qqAlbumCoverUrl(mid?: string): string {
  if (!mid) return '';
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg?max_age=2592000`;
}

interface QqSearchSong {
  songid?: number;
  songmid?: string;
  /** jsososo /search 实际返回的歌名字段（name 恒 null —— 「首页只显示歌手不显示歌名」的根因） */
  songname?: string;
  name?: string;
  singer?: { name?: string }[];
  albumname?: string;
  albummid?: string;
  albumid?: number;
  interval?: number;
  media_mid?: string;
  pay?: { pay_play?: number };
  filename?: string;
}

function mapQqSong(s: QqSearchSong): UnifiedSong {
  const artists = (s.singer || []).map((x) => ({ id: 0, name: x.name || '' }));
  const song: UnifiedSong = withPlatform(
    {
      id: Number(s.songid || 0),
      name: s.name || s.songname || (s.filename || '').replace(/\.mp3$/i, ''),
      artists,
      album: { id: Number(s.albumid || 0), name: s.albumname || '', picUrl: qqAlbumCoverUrl(s.albummid) },
      duration: (s.interval || 0) * 1000,
      fee: s.pay?.pay_play === 1 ? 1 : 0,
    },
    'qq',
    { qqMid: s.songmid || '', qqMediaMid: s.media_mid || s.songmid || '' },
  );
  return song;
}

export async function qqSearchSongs(keywords: string, limit = 30, offset = 0): Promise<UnifiedSong[]> {
  const pageNo = Math.floor(offset / Math.max(limit, 1)) + 1;
  const d = await qqRequest<{ list?: QqSearchSong[] }>('search', {
    key: keywords,
    pageNo,
    pageSize: limit,
    type: 'song',
  });
  return (d.list || []).map(mapQqSong).filter((s) => s.id && s.qqMid);
}

interface QqV2Song {
  id?: number;
  mid?: string;
  name?: string;
  singers?: { id?: number; name?: string }[];
  albumMid?: string;
  albumPmid?: string;
  albumName?: string;
  mediaMid?: string;
  intervalSec?: number;
  vip?: boolean;
}

function mapQqV2Song(s: QqV2Song): UnifiedSong {
  return withPlatform(
    {
      id: Number(s.id || 0),
      name: s.name || '',
      artists: (s.singers || []).map((x) => ({ id: x.id || 0, name: x.name || '' })),
      album: { id: 0, name: s.albumName || '', picUrl: qqAlbumCoverUrl(s.albumPmid || s.albumMid) },
      duration: (s.intervalSec || 0) * 1000,
      fee: s.vip ? 1 : 0,
    },
    'qq',
    { qqMid: s.mid || '', qqMediaMid: s.mediaMid || s.mid || '' },
  );
}

/** QQ 推荐歌单（游客可用） */
export async function qqRecommendPlaylists(limit = 10): Promise<NcmPlaylist[]> {
  const d = await qqRequest<{
    list?: { tid?: number; title?: string; cover_url_medium?: string; cover_url_big?: string; access_num?: number; creator_info?: { nick?: string; uin?: number }; song_ids?: unknown[] }[];
  }>('recommend/playlist');
  return (d.list || []).slice(0, limit).map((p) => ({
    id: Number(p.tid || 0),
    name: p.title || '',
    coverImgUrl: p.cover_url_medium || p.cover_url_big || '',
    trackCount: (p.song_ids || []).length,
    playCount: p.access_num,
    creator: { userId: Number(p.creator_info?.uin || 0), nickname: p.creator_info?.nick || '' },
    specialType: 0,
  }));
}

/** QQ 用户创建的歌单（需登录；显式传 uin —— 只查本人歌单） */
export async function qqUserPlaylists(): Promise<NcmPlaylist[]> {
  const l = getQqLogin();
  const d = await qqAuthRequest<{ playlists?: { tid?: number; dirid?: number; name?: string; cover?: string; picurl?: string; headurl?: string; total?: number; isFav?: boolean }[] }>(
    'v2/user/created-playlists',
    { uin: l?.uin },
  );
  return (d.playlists || []).map((p) => ({
    id: Number(p.tid || 0),
    name: p.name || '',
    coverImgUrl: p.cover || p.picurl || p.headurl || '',
    trackCount: p.total || 0,
    creator: { userId: Number(l?.uin || 0), nickname: l?.nickname || '' },
    specialType: p.isFav ? 5 : 0,
    // 加歌接口（fcg_music_add2songdir）要 dirid：自建歌单 dirid 与 tid 同号空间，
    // dirid 缺失时退 tid；存进 description（与酷狗 gid 同款错位存法）供「添加到歌单」弹窗取用
    description: String(p.dirid || p.tid || 0),
  }));
}

/** QQ：把歌曲加入自建歌单（fcg_music_add2songdir，需登录；dirid = 歌单 dir id）
 *  路由 /songlist/add?mid=&dirid=：mid 支持逗号多首，成功 result:100（无 data） */
export async function qqAddSongToPlaylist(dirid: number, song: UnifiedSong): Promise<void> {
  const mid = song.qqMid || '';
  if (!mid) throw new MusicApiError('缺少歌曲 mid，无法加入歌单');
  await qqAuthRequest('songlist/add', { mid, dirid });
}

/** QQ：新建自建歌单（create_playlist.fcg，需登录）→ 返回新歌单 dirid */
export async function qqCreatePlaylist(name: string): Promise<number> {
  const d = await qqAuthRequest<{ dirid?: number }>('songlist/create', { name });
  const dirid = Number(d?.dirid || 0);
  if (!dirid) throw new MusicApiError('创建歌单失败：接口未返回歌单 id');
  return dirid;
}

/** QQ 我喜欢的歌曲（需登录，dirid=201） */
export async function qqLikedSongs(page = 1, num = 100): Promise<UnifiedSong[]> {
  const l = getQqLogin();
  if (!l) throw new MusicApiError('未登录 QQ 音乐', 301);
  const d = await qqAuthRequest<{ songs?: QqV2Song[]; hasMore?: boolean }>('v2/user/fav-songs', {
    euin: l.euin,
    page,
    num,
  });
  return (d.songs || []).map(mapQqV2Song);
}

/** QQ 歌单详情（游客可用） */
export interface UnifiedPlaylistDetail {
  id: number;
  name: string;
  cover: string;
  total: number;
  creator: string;
  songs: UnifiedSong[];
}

export async function qqSonglistDetail(tid: number, page = 1, num = 100): Promise<UnifiedPlaylistDetail> {
  const d = await qqRequest<{ id?: number; name?: string; cover?: string; total?: number; creator?: string; songs?: QqV2Song[] }>(
    'v2/songlist/detail',
    { id: tid, page, num },
  );
  return {
    id: Number(d.id || tid),
    name: d.name || '',
    cover: d.cover || '',
    total: d.total || 0,
    creator: d.creator || '',
    songs: (d.songs || []).map(mapQqV2Song),
  };
}

/** QQ 播放直链（需登录；游客返回 null 由上层提示）。
 *  mediaId：播放文件名 = M500<songmid><media_mid>.mp3 —— songmid 与 media_mid 不同时必须
 *  各自传对（旧版只传 songmid，media_mid 不同的歌直链拿不到）。
 *  码型回退：128 失败再试 m4a（C400 移动端码型，部分歌曲 mp3 无权限但 m4a 可播）。 */
export async function qqSongUrl(song: UnifiedSong, level: 'standard' | 'higher' | 'exhigh' = 'standard'): Promise<string | null> {
  const type = level === 'standard' ? '128' : '320';
  const id = song.qqMid || song.id;
  const mediaId = song.qqMediaMid || song.qqMid || song.id;
  const tryTypes = type === '128' ? ['128', 'm4a'] : ['320', '128', 'm4a'];
  for (const t of tryTypes) {
    try {
      const d = await qqAuthRequest<string>('song/url', {
        id,
        mediaId,
        type: t,
      });
      if (typeof d === 'string' && d.startsWith('http')) return d;
    } catch {
      // 未登录（301）直接结束，不再重试码型
      break;
    }
  }
  return null;
}

/** QQ 歌词（游客可用） */
export async function qqLyric(song: UnifiedSong): Promise<NcmLyric> {
  const d = await qqRequest<{ lrc?: string; trans?: string; hasTranslation?: boolean }>('v2/lyric', {
    songmid: song.qqMid,
  });
  const lrc = d.lrc || '';
  const tl = d.trans || '';
  return { lrc, tlyric: tl, hasTranslation: !!tl.trim() };
}

/** QQ 每日推荐（歌单广场按日轮换的官方精选歌单，登录后展示；
 *  QQ 无公开的个人日推接口——避免拉到公共测试账号数据，只取公开广场真实歌单） */
export async function qqDailySongs(): Promise<UnifiedSong[]> {
  const pls = await qqRecommendPlaylists(30);
  if (!pls.length) return [];
  const dayIdx = Math.floor(Date.now() / 86_400_000) % pls.length;
  const pick = pls[dayIdx];
  const d = await qqSonglistDetail(pick.id, 1, 100);
  return d.songs;
}

// ---------------- 酷狗：登录 ----------------

/** 酷狗扫码：取二维码（login/qr/key 已带 qrcode_img，一次到位） */
export async function kgQrCreate(): Promise<QrImage> {
  const d = await kgRequest<{ qrcode?: string; qrcode_img?: string }>('login/qr/key');
  const key = d?.qrcode;
  const img = d?.qrcode_img;
  if (!key) throw new MusicApiError('获取酷狗登录二维码失败');
  if (img) return { id: key, qrimg: img };
  // 兜底：create 接口生成
  const c = await kgRequest<{ url?: string; base64?: string }>('login/qr/create', { key, qrimg: 1 });
  if (!c?.base64) throw new MusicApiError('生成酷狗登录二维码失败');
  return { id: key, qrimg: c.base64 };
}

/** 酷狗扫码：轮询（status 1=待扫码 2=已扫待确认 4=成功；成功自动持久化登录） */
export async function kgQrCheck(key: string): Promise<QrPollResult> {
  const d = await kgRequest<{ status?: number; token?: string; userid?: number | string }>('login/qr/check', { key });
  const st = Number(d?.status || 0);
  if (st === 4) {
    const token = String(d?.token || '');
    const userid = String(d?.userid || '');
    if (!token || !userid) return { st: 'error', msg: '登录成功但未取得凭证' };
    // 注意：`;` 后不加空格（cookieToJson 按 `;` 切分会把带空格的键切成 ' userid'）
    await completeKgLogin(`token=${token};userid=${userid}`, userid, token);
    return { st: 'ok' };
  }
  if (st === 1) return { st: 'waiting' };
  if (st === 2) return { st: 'scanned' };
  if (st === 0) return { st: 'expired' };
  return { st: 'waiting' };
}

/** 酷狗账号密码登录 */
export async function kgLoginByPassword(username: string, password: string): Promise<KugouLogin> {
  const j = await kgRequestRaw('login', { username, password });
  const body = j as { status?: number; data?: { token?: string; userid?: number; nickname?: string } };
  if (body?.status !== 1) {
    throw new MusicApiError('酷狗账号或密码错误');
  }
  const token = String(body.data?.token || '');
  const userid = String(body.data?.userid || '');
  if (!token || !userid) throw new MusicApiError('登录失败：未取得凭证');
  // 注意：`;` 后不加空格（cookieToJson 按 `;` 切分会把带空格的键切成 ' userid'）
  return completeKgLogin(`token=${token};userid=${userid}`, userid, token);
}

async function kgRequestRaw(path: string, params: Record<string, string | number | undefined | boolean>): Promise<unknown> {
  const url = buildPlatformUrl('kugou', path, params);
  const res = await fetch(url);
  if (!res.ok) throw new MusicApiError(`网络错误 ${res.status}`, res.status);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new MusicApiError('接口返回格式异常');
  }
}

async function completeKgLogin(cookie: string, userid: string, token: string): Promise<KugouLogin> {
  let nickname = '';
  let avatar = '';
  let fans = 0;
  let follows = 0;
  const prev = getKgLogin();
  try {
    const d = await kgRequest<{
      nick_name?: string;
      /** 实测（2026-11）get_my_info 真实字段名就是 nickname（非 nick_name） */
      nickname?: string;
      nick?: string;
      pic?: string;
      avatar?: string;
      head_img?: string;
      fans?: number;
      follow?: number;
      follows?: number;
      /** 兼容个别版本把资料再包一层 data */
      data?: { nick_name?: string; nickname?: string; pic?: string; fans?: number; follow?: number };
    }>('user/detail', {
      userid,
      cookie,
    });
    const n = d ?? {};
    const nest = n.data ?? {};
    nickname = n.nick_name || n.nickname || n.nick || nest.nick_name || nest.nickname || prev?.nickname || '';
    avatar = n.pic || n.avatar || n.head_img || nest.pic || prev?.avatar || '';
    fans = Number(n.fans ?? nest.fans ?? prev?.fans ?? 0) || 0;
    follows = Number(n.follow ?? n.follows ?? nest.follow ?? prev?.follows ?? 0) || 0;
  } catch {
    nickname = prev?.nickname || '';
    avatar = prev?.avatar || '';
    fans = prev?.fans || 0;
    follows = prev?.follows || 0;
  }
  const login: KugouLogin = { cookie, userid, token, nickname, avatar, fans, follows, savedAt: Date.now() };
  setKgLogin(login);
  return login;
}

/** 校验酷狗登录态（boot 恢复时）；失效自动清除，网络异常保留。
 *  校验通过时顺带刷新资料（昵称/头像/粉丝/关注）并回写持久化。*/
export async function refreshKgLogin(): Promise<KugouLogin | null> {
  const l = getKgLogin();
  if (!l) return null;
  try {
    // user/playlist 严格校验 token（user/detail 是公开接口校验不了；user/playlist
    // 带 userid 查询参数会走公开歌单通道也校验不了）——只传 cookie，token 过期
    // （20017/20018/20028）自动清除回登录页重新扫码
    await kgAuthRequest('user/playlist', { pagesize: 1 });
    // 校验通过：顺带刷新资料（昵称/头像/粉丝/关注；兼容再包一层 data 的返回形状；
    // 实测 2026-11：昵称字段名是 nickname 而非 nick_name）
    try {
      const d = await kgAuthRequest<{
        nick_name?: string;
        nickname?: string;
        nick?: string;
        pic?: string;
        avatar?: string;
        head_img?: string;
        fans?: number;
        follow?: number;
        follows?: number;
        data?: { nick_name?: string; nickname?: string; pic?: string; fans?: number; follow?: number };
      }>('user/detail', {});
      const n = d ?? {};
      const nest = n.data ?? {};
      const next: KugouLogin = {
        ...l,
        nickname: n.nick_name || n.nickname || n.nick || nest.nick_name || nest.nickname || l.nickname,
        avatar: n.pic || n.avatar || n.head_img || nest.pic || l.avatar,
        fans: Number(n.fans ?? nest.fans ?? l.fans ?? 0) || 0,
        follows: Number(n.follow ?? n.follows ?? nest.follow ?? l.follows ?? 0) || 0,
      };
      if (next.nickname !== l.nickname || next.avatar !== l.avatar || next.fans !== l.fans || next.follows !== l.follows) {
        setKgLogin(next);
        return next;
      }
    } catch {
      /* 资料刷新失败保留旧资料 */
    }
    return l;
  } catch (e) {
    if (e instanceof MusicApiError && (e.code === 20017 || e.code === 20018 || e.code === 20028 || e.code === 301)) {
      clearKgLogin();
      return null;
    }
    return l; // 网络异常保守保留
  }
}

// ---------------- 酷狗：数据 ----------------

interface KgSearchSong {
  FileHash?: string;
  hash?: string;
  FileName?: string;
  SongName?: string;
  Audioid?: number;
  audio_id?: number;
  MixSongID?: number;
  mixsongid?: number;
  AlbumID?: string;
  AlbumName?: string;
  Duration?: number;
  duration?: number;
  Image?: string;
  album_img?: string;
  SingerName?: string;
  singername?: string;
  HQDuration?: number;
  EMixSongID?: number;
  /** playlist/track/all 归一化注入的字段（小写形状） */
  songname?: string;
  name?: string;
  albumname?: string;
}

function splitKgName(raw: string): { name: string; artist: string } {
  // 酷狗 FileName 常见 "歌手 - 歌名"
  const m = raw.split(' - ');
  if (m.length >= 2) {
    return { artist: m[0].trim(), name: m.slice(1).join(' - ').trim() };
  }
  return { name: raw.trim(), artist: '' };
}

function kgCoverUrl(raw?: string): string {
  if (!raw) return '';
  return raw.replace('{size}', '240');
}

function mapKgSong(s: KgSearchSong): UnifiedSong {
  const rawName = s.SongName || s.FileName || s.songname || s.name || '';
  const { name, artist } = splitKgName(rawName);
  const artists = (s.SingerName || s.singername || artist || '')
    .split(/[,/、]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((n) => ({ id: 0, name: n }));
  const hash = s.FileHash || s.hash || '';
  const emix = Number(s.MixSongID || s.mixsongid || s.EMixSongID || 0);
  return withPlatform(
    {
      id: Number(s.Audioid || s.audio_id || emix || 0),
      name,
      artists: artists.length ? artists : [{ id: 0, name: s.SingerName || s.singername || '' }],
      album: { id: 0, name: s.AlbumName || s.albumname || '', picUrl: kgCoverUrl(s.Image || s.album_img) },
      duration: Number(s.Duration || s.duration || 0) * 1000,
      fee: 0,
    },
    'kugou',
    { kgHash: hash, kgEmixId: emix },
  );
}

export async function kgSearchSongs(keywords: string, limit = 30, offset = 0): Promise<UnifiedSong[]> {
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const d = await kgRequest<{ lists?: KgSearchSong[] }>('search', { keywords, pagesize: limit, page });
  return (d.lists || []).map(mapKgSong).filter((s) => s.kgHash);
}

/** 酷狗歌单搜索条目（special） */
interface KgSpecial {
  specialid?: number;
  specialname?: string;
  img?: string;
  play_count?: number;
  song_count?: number;
  nickname?: string;
  gid?: string;
}

/** 酷狗推荐歌单（special 搜索：热门/推荐主题歌单，游客可用） */
export async function kgRecommendPlaylists(limit = 10): Promise<NcmPlaylist[]> {
  const d = await kgRequest<{ lists?: KgSpecial[] }>('search', {
    keywords: '热门推荐',
    type: 'special',
    pagesize: limit,
  });
  return (d.lists || []).slice(0, limit).map((p) => ({
    id: Number(p.specialid || 0),
    name: p.specialname || '',
    coverImgUrl: kgCoverUrl(p.img),
    trackCount: p.song_count || 0,
    playCount: p.play_count,
    creator: { userId: 0, nickname: p.nickname || '' },
    specialType: 0,
    // gid 供歌单页取曲（酷狗 playlist/track/all 需要 global_collection_id）
    description: String(p.gid || ''),
  } as NcmPlaylist & { description: string }));
}

interface KgUserList {
  name?: string;
  listname?: string;
  title?: string;
  pic?: string;
  img?: string;
  picurl?: string;
  cover?: string;
  specialid?: number;
  listid?: number;
  gid?: string;
  global_collection_id?: string;
  total?: number;
  count?: number;
  type?: number;
  /** 1=默认收藏系统歌单 2=我喜欢（实测 /v7/get_all_list 返回） */
  is_def?: number;
}

function kgListId(p: KgUserList): { id: number; gid: string } {
  const gid = String(p.global_collection_id || p.gid || '');
  const sid = Number(p.specialid || p.listid || 0);
  return { id: sid, gid: gid.startsWith('collection_') ? gid : gid || String(sid || '') };
}

/** 酷狗用户歌单（需登录；含「我喜欢」）。
 *  实测 /user/playlist（/v7/get_all_list）响应形状：{data:{info:[{name,pic,count,listid,
 *  global_collection_id,is_def,type…}]}} —— info 是数组（此前误读 d.lists / d.info?.list
 *  导致酷狗歌单永远为空）。is_def=2 是「我喜欢」，is_def=1 是「默认收藏」。 */
export async function kgUserPlaylists(): Promise<NcmPlaylist[]> {
  const d = await kgAuthRequest<{ lists?: KgUserList[]; info?: KgUserList[] | { list?: KgUserList[] } }>('user/playlist', { pagesize: 30 });
  const raw = Array.isArray(d.info) ? d.info : d.info?.list || d.lists || [];
  return raw.map((p) => {
    const { id, gid } = kgListId(p);
    return {
      id,
      name: p.name || p.listname || p.title || '我喜欢的音乐',
      coverImgUrl: kgCoverUrl(p.pic || p.img || p.picurl || p.cover),
      trackCount: p.count ?? p.total ?? 0,
      creator: { userId: 0, nickname: getKgLogin()?.nickname || '' },
      // is_def=2 是酷狗「我喜欢」（不是第一个列表；默认收藏 is_def=1 排第一）
      specialType: p.is_def === 2 || (p.name || p.listname || '') === '我喜欢' ? 5 : 0,
      // gid 供歌单页取曲（酷狗 playlist/track/all 需要 global_collection_id）
      description: gid,
    } as NcmPlaylist & { description: string };
  });
}

/** 酷狗：把歌曲加入自建歌单（cloudlist v6/add_song，需登录；listid = specialid）。
 *  data 格式：歌名|hash|album_id|mixsongid（多首逗号分隔）；userid/token 从登录 cookie 取 */
export async function kgAddSongToPlaylist(listid: number, song: UnifiedSong): Promise<void> {
  const hash = song.kgHash || '';
  if (!hash) throw new MusicApiError('缺少歌曲 hash，无法加入歌单');
  const data = `${song.name || ''}|${hash}|${song.album?.id || 0}|${song.kgEmixId || 0}`;
  await kgAuthRequest('playlist/tracks/add', { listid, data });
}

/** 酷狗：新建自建歌单（cloudlist v5/add_list type=0，需登录）→ 返回新歌单 listid。
 *  响应形状未定（v5/add_list 不同版本返回 listid/id/info.listid），逐层兆底取 */
export async function kgCreatePlaylist(name: string): Promise<number> {
  const d = await kgAuthRequest<{
    listid?: number;
    id?: number;
    specialid?: number;
    info?: { listid?: number; specialid?: number; id?: number };
    list?: { listid?: number; specialid?: number; id?: number };
  }>('playlist/add', { name, type: 0, source: 0, is_pri: 0 });
  const id = Number(d?.listid || d?.specialid || d?.id || d?.info?.listid || d?.info?.specialid || d?.info?.id || d?.list?.listid || d?.list?.specialid || d?.list?.id || 0);
  if (!id) throw new MusicApiError('创建歌单失败：接口未返回歌单 id');
  return id;
}

/** 酷狗歌单曲目（global_collection_id 或 specialid） */
export async function kgPlaylistSongs(gid: string, pagesize = 100): Promise<UnifiedSong[]> {
  const d = await kgRequest<{ songs?: (KgSearchSong & { name?: string; singerinfo?: { name?: string }[]; albuminfo?: { name?: string }; cover?: string; mixsongid?: number })[] }>(
    'playlist/track/all',
    { id: gid, pagesize },
  );
  const songs = (d.songs || []).map((s) => {
    const u = mapKgSong({
      ...s,
      FileName: s.FileName || s.name,
      SongName: s.name,
      Image: s.Image || s.cover,
      AlbumName: s.AlbumName || s.albuminfo?.name,
      SingerName: (s.singerinfo || []).map((x) => x.name).join('、'),
    });
    if (!u.kgHash && (s.hash || s.FileHash)) u.kgHash = String(s.hash || s.FileHash);
    return u;
  });
  return songs.filter((s) => s.kgHash);
}

/** 酷狗播放直链（游客通常无权限 20028，需登录 token） */
export async function kgSongUrl(song: UnifiedSong, level: 'standard' | 'higher' | 'exhigh' = 'standard'): Promise<string | null> {
  const quality = level === 'standard' ? 128 : 320;
  const req = async () => {
    const l = getKgLogin();
    const params: Record<string, string | number | undefined | boolean> = {
      hash: song.kgHash || '',
      quality,
      album_audio_id: song.kgEmixId || song.id || 0,
    };
    if (l) params.cookie = l.cookie;
    return kgRequest<{ url?: string[] | string; urls?: string[] }>('song/url', params);
  };
  try {
    const d = await req();
    const url = Array.isArray(d.url) ? d.url[0] : d.url || (Array.isArray(d.urls) ? d.urls[0] : undefined);
    if (typeof url === 'string' && url.startsWith('http')) return url;
    return null;
  } catch {
    return null;
  }
}

/** 酷狗歌词专用请求：歌词域名（lyrics.kugou.com）接口返回 {status:200, ...字段在顶层}
 *  的形状，与 kg.kugou.com 网关的 {status:1, data} 完全不同，不能用通用 kgRequest 解包。 */
async function kgLyricRequest<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined | boolean>,
): Promise<T> {
  const url = buildPlatformUrl('kugou', path, params);
  const res = await fetch(url);
  if (!res.ok) throw new MusicApiError(`网络错误 ${res.status}`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new MusicApiError('接口返回格式异常');
  }
}

/** base64 → UTF-8 文本（歌词 content 兼容解码） */
function b64ToText(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/** 酷狗歌词（search/lyric → lyric 两步）。
 *  根因修复（「酷狗歌词不显示」）：① 路由名是下划线文件名映射 → /search/lyric（旧代码
 *  调 search_lyric 直接 404）；② 响应为顶层 {status:200, candidates}（旧 kgRequest 按
 *  status===1 解包恒抛错）；③ 歌词文本在顶层 decodeContent/content（非 data 内）。 */
export async function kgLyric(song: UnifiedSong): Promise<NcmLyric> {
  try {
    const s = await kgLyricRequest<{ status?: number; candidates?: { id?: string; accesskey?: string }[] }>('search/lyric', {
      hash: song.kgHash,
      duration: Math.round((song.duration || 0) / 1000),
    });
    const c = (s.candidates || [])[0];
    if (!c?.id) return { lrc: '', tlyric: '', hasTranslation: false };
    const d = await kgLyricRequest<{ decodeContent?: string; content?: string; contenttype?: number }>('lyric', {
      id: c.id,
      accesskey: c.accesskey,
      decode: 1,
      fmt: 'lrc',
    });
    // decode=1+fmt=lrc 时上游已 base64 解码到 decodeContent；兼容未解码的 content
    const lrc = d.decodeContent || (d.content ? b64ToText(d.content) : '');
    return { lrc, tlyric: '', hasTranslation: false };
  } catch {
    return { lrc: '', tlyric: '', hasTranslation: false };
  }
}

// ---------------- 酷狗：每日推荐 / 听歌排行 ----------------

/** 酷狗每日推荐（everyday/recommend：登录后为个性化「每日30首」；返回字段小写下划线形状） */
export async function kgDailySongs(): Promise<UnifiedSong[]> {
  const l = getKgLogin();
  const params: Record<string, string | number | undefined | boolean> = { platform: 'ios' };
  if (l) params.cookie = l.cookie;
  const d = await kgRequest<{
    song_list?: {
      songname?: string;
      filename?: string;
      hash?: string;
      mixsongid?: number;
      album_audio_id?: number;
      sizable_cover?: string;
      singerinfo?: { name?: string }[];
      author_name?: string;
      time_length?: number;
    }[];
  }>('everyday/recommend', params);
  return (d.song_list || [])
    .map((s) =>
      mapKgSong({
        FileName: s.filename,
        SongName: s.songname,
        FileHash: s.hash,
        MixSongID: s.mixsongid || s.album_audio_id,
        Image: s.sizable_cover,
        SingerName: (s.singerinfo || []).map((x) => x.name).join('、') || s.author_name || '',
        Duration: s.time_length,
      }),
    )
    .filter((s) => s.kgHash && s.name);
}

/** 酷狗听歌排行（user/history：登录后真实播放排行；返回空数组时上层回退本地历史） */
export async function kgPlayRecords(): Promise<{ song: UnifiedSong; playCount: number }[]> {
  const d = await kgAuthRequest<{
    list?: { song?: string; name?: string; filename?: string; hash?: string; play_count?: number; count?: number; mixsongid?: number; album_audio_id?: number; cover?: string; image?: string; sizable_cover?: string; time_length?: number; singerinfo?: { name?: string }[] }[];
    songs?: { song?: string; name?: string; filename?: string; hash?: string; play_count?: number; count?: number; mixsongid?: number; album_audio_id?: number; cover?: string; image?: string; sizable_cover?: string; time_length?: number; singerinfo?: { name?: string }[] }[];
  }>('user/history', {});
  const arr = d?.list || d?.songs || [];
  return arr
    .map((it) => {
      const raw = it.song || it.name || it.filename || '';
      const u = mapKgSong({
        FileName: raw,
        FileHash: it.hash,
        MixSongID: it.mixsongid || it.album_audio_id,
        Image: it.cover || it.image || it.sizable_cover,
        SingerName: (it.singerinfo || []).map((x) => x.name).join('、'),
        Duration: it.time_length,
      });
      return { song: u, playCount: Math.max(1, Number(it.play_count ?? it.count ?? 1) || 1) };
    })
    .filter((r) => r.song.name);
}

// ---------------- 游客解灰（UNM） ----------------

/** UNM 音源中文名（跨平台兜底提示用） */
export const UNM_SOURCE_LABELS: Record<string, string> = {
  kuwo: '酷我',
  bodian: '波点音乐',
  pyncmd: 'pyncmd',
  kugou: '酷狗',
  migu: '咪咕',
  qq: 'QQ音乐',
};

/** UNM 解灰（带源信息）：返回 { url, source }，供 UI 提示「已切换至 XX 平台播放」 */
export async function unmMatchUrlFull(neteaseId: number): Promise<{ url: string; source: string } | null> {
  try {
    const res = await fetch(`/api/music/ncm/song/url/match?id=${neteaseId}&source=kuwo,bodian,pyncmd,kugou,migu,qq&timestamp=${Date.now()}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: number; data?: { url?: string; source?: string } };
    if (j.code === 200 && j.data?.url) return { url: j.data.url, source: j.data.source || '' };
    return null;
  } catch {
    return null;
  }
}

/** UNM 解灰（旧口径：仅返回直链） */
export async function unmMatchUrl(neteaseId: number): Promise<string | null> {
  const r = await unmMatchUrlFull(neteaseId);
  return r?.url ?? null;
}

// ---------------- 跨平台兜底（自动切其它平台音源播放） ----------------

/**
 * 跨平台兜底：当前平台拿不到播放直链（版权缺失/未登录）时，
 * 到其它平台按「歌名 + 歌手」搜索同名歌曲并取可播直链。
 * 返回 { url, viaLabel }（viaLabel = 实际命中的平台中文名，供 toast 提示）。
 * 顺序：酷狗（免登录可用性最高）→ QQ（已登录才试）→ 网易云（免费歌 + UNM 解灰）。
 */
export async function crossFallbackUrl(song: UnifiedSong): Promise<{ url: string; viaLabel: string } | null> {
  const cur = songPlatform(song);
  const name = (song.name || '').trim();
  if (!name) return null;
  const artist = (song.artists || []).map((a) => a?.name).filter(Boolean).slice(0, 2).join(' ');
  const q = artist ? `${name} ${artist}` : name;
  const alts: MusicPlatform[] = [];
  if (cur !== 'kugou') alts.push('kugou');
  if (cur !== 'qq' && getQqLogin()) alts.push('qq');
  if (cur !== 'netease') alts.push('netease');
  for (const p of alts) {
    try {
      const found = await multiSearchSongs(p, q, 8);
      if (!found.length) continue;
      const key = name.slice(0, 4);
      const hit = found.find((s) => s.name && s.name.includes(key)) ?? found[0];
      if (!hit) continue;
      const r = await multiSongUrl(p, hit, 'standard');
      if (r.url) return { url: r.url, viaLabel: PLATFORM_LABELS[p] };
      // 网易云命中 VIP 歌 → 再走 UNM 解灰（酷我/咪咕等免费源）
      if (r.needUnm && p === 'netease') {
        const unm = await unmMatchUrlFull(hit.id);
        if (unm?.url) return { url: unm.url, viaLabel: UNM_SOURCE_LABELS[unm.source] || '其它平台' };
      }
    } catch {
      /* 该平台没找到/取链失败 → 试下一个平台 */
    }
  }
  return null;
}

// ---------------- 统一数据门面（UI 层按平台调用） ----------------

export interface PlatformProfile {
  nickname: string;
  avatar: string;
  uid: string;
  /** 粉丝/关注（QQ v2/user/profile、酷狗 user/detail 真实数据；0 = 未知） */
  fans: number;
  follows: number;
}

export async function multiProfile(p: MusicPlatform): Promise<PlatformProfile | null> {
  if (p === 'qq') {
    const l = getQqLogin();
    if (!l) return null;
    // 校验通过时顺带拿最新资料（昵称/头像/粉丝/关注都来自本人主页；4.5s 超时保护防 v2 挂起）
    try {
      const d = await Promise.race([
        qqAuthRequest<{ nickname?: string; avatar?: string; euin?: string; fans?: number; follows?: number }>('v2/user/profile', { uin: l.uin }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);
      if (d && (d.nickname || d.avatar)) {
        const next: QqMusicLogin = {
          ...l,
          nickname: d.nickname || l.nickname,
          avatar: d.avatar || l.avatar,
          euin: d.euin || l.euin,
          fans: d.fans ?? l.fans,
          follows: d.follows ?? l.follows,
        };
        setQqLogin(next);
        return { nickname: next.nickname || 'QQ音乐用户', avatar: next.avatar, uid: next.uin, fans: next.fans, follows: next.follows };
      }
    } catch {
      /* v2 失败（微信虚拟 uin 走不通 GetHomepageHeader / 超时）→ 下方退老接口 */
    }
    // 老接口 user/detail（fcg_get_profile_homepage）：QQ/微信账号都能拿真实昵称+头像+euin
    // + creator.nums（fansnum/follownum —— 关注/粉丝跟随账号）
    try {
      const prof = await qqProfileWithCookie(l.cookie, l.uin);
      if (prof.nickname || prof.avatar || prof.euin) {
        const next: QqMusicLogin = {
          ...l,
          nickname: prof.nickname || l.nickname,
          avatar: prof.avatar || l.avatar,
          euin: prof.euin || l.euin,
          fans: prof.fans || l.fans,
          follows: prof.follows || l.follows,
        };
        setQqLogin(next);
        return { nickname: next.nickname || 'QQ音乐用户', avatar: next.avatar, uid: next.uin, fans: next.fans, follows: next.follows };
      }
    } catch {
      /* 资料拉取失败退回本地快照 */
    }
    return { nickname: l.nickname || 'QQ音乐用户', avatar: l.avatar, uid: l.uin, fans: l.fans, follows: l.follows };
  }
  if (p === 'kugou') {
    const l = getKgLogin();
    if (!l) return null;
    // 校验通过时顺带拉最新资料（昵称/头像/粉丝/关注都来自本人主页；兼容再包一层 data；
    // 实测 2026-11：昵称字段名是 nickname 而非 nick_name）
    try {
      const d = await kgAuthRequest<{
        nick_name?: string;
        nickname?: string;
        nick?: string;
        pic?: string;
        avatar?: string;
        head_img?: string;
        fans?: number;
        follow?: number;
        follows?: number;
        data?: { nick_name?: string; nickname?: string; pic?: string; fans?: number; follow?: number };
      }>('user/detail', {});
      const n = d ?? {};
      const nest = n.data ?? {};
      if (n.nick_name || n.nickname || n.pic || nest.nick_name || nest.nickname || nest.pic) {
        const next: KugouLogin = {
          ...l,
          nickname: n.nick_name || n.nickname || n.nick || nest.nick_name || nest.nickname || l.nickname,
          avatar: n.pic || n.avatar || n.head_img || nest.pic || l.avatar,
          fans: Number(n.fans ?? nest.fans ?? l.fans ?? 0) || 0,
          follows: Number(n.follow ?? n.follows ?? nest.follow ?? l.follows ?? 0) || 0,
        };
        setKgLogin(next);
        return { nickname: next.nickname || '酷狗用户', avatar: next.avatar, uid: next.userid, fans: next.fans, follows: next.follows };
      }
    } catch {
      /* 资料拉取失败退回本地快照 */
    }
    return { nickname: l.nickname || '酷狗用户', avatar: l.avatar, uid: l.userid, fans: l.fans, follows: l.follows };
  }
  return null;
}

/** 每日推荐（平台感知）：网易云 = 个性化日推；酷狗 = 每日30首（登录后个性化）；
 *  QQ = 歌单广场按日轮换的官方精选（无公开个人日推接口，不用公共账号数据） */
export async function multiDailySongs(p: MusicPlatform): Promise<UnifiedSong[]> {
  if (p === 'qq') return qqDailySongs();
  if (p === 'kugou') return kgDailySongs();
  const { dailyRecommendSongs } = await import('./music-api');
  return dailyRecommendSongs();
}

/** 听歌排行（平台感知）：酷狗 = 云端真实排行；QQ 无公开接口返回 null（上层回退本地历史） */
export async function multiPlayRecords(p: MusicPlatform): Promise<{ song: UnifiedSong; playCount: number }[] | null> {
  if (p === 'kugou') {
    try {
      const r = await kgPlayRecords();
      return r.length ? r : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function multiRecommendPlaylists(p: MusicPlatform, limit = 10): Promise<NcmPlaylist[]> {
  if (p === 'qq') return qqRecommendPlaylists(limit);
  if (p === 'kugou') return kgRecommendPlaylists(limit);
  const { personalizedPlaylists } = await import('./music-api');
  return personalizedPlaylists(limit);
}

export async function multiUserPlaylists(p: MusicPlatform): Promise<NcmPlaylist[]> {
  if (p === 'qq') return qqUserPlaylists();
  if (p === 'kugou') return kgUserPlaylists();
  const { userPlaylists, getMusicLogin } = await import('./music-api');
  const l = getMusicLogin();
  if (!l?.profile.userId) return [];
  return userPlaylists(l.profile.userId);
}

export async function multiLikedSongs(p: MusicPlatform): Promise<UnifiedSong[]> {
  if (p === 'qq') return qqLikedSongs(1, 300);
  if (p === 'kugou') {
    const pls = await kgUserPlaylists();
    // 「我喜欢」是 is_def=2 的那个列表（第一个是「默认收藏」is_def=1，不能拿它当红心歌单）
    const fav = pls.find((x) => x.specialType === 5) ?? pls[0];
    if (!fav) return [];
    const gid = (fav as NcmPlaylist & { description?: string }).description || String(fav.id);
    return kgPlaylistSongs(gid, 300);
  }
  const { likeList, songsDetail, getMusicLogin } = await import('./music-api');
  const l = getMusicLogin();
  if (!l?.profile.userId) return [];
  const ids = await likeList(l.profile.userId);
  const songs = await songsDetail(ids.slice(0, 300));
  return songs.map((s) => withPlatform(s, 'netease'));
}

export async function multiSearchSongs(p: MusicPlatform, keywords: string, limit = 30, offset = 0): Promise<UnifiedSong[]> {
  if (p === 'qq') return qqSearchSongs(keywords, limit, offset);
  if (p === 'kugou') return kgSearchSongs(keywords, limit, offset);
  const { search } = await import('./music-api');
  const r = await search(keywords, 1, limit, offset);
  return r.songs.map((s) => withPlatform(s, 'netease'));
}

export async function multiSongUrl(
  p: MusicPlatform,
  song: UnifiedSong,
  level: 'standard' | 'higher' | 'exhigh' = 'standard',
): Promise<{ url: string | null; needUnm: boolean; trialUrl?: string }> {
  if (p === 'qq' || (song as UnifiedSong).platform === 'qq') {
    if (p !== 'qq') return { url: null, needUnm: false };
    const url = await qqSongUrl(song, level);
    return { url, needUnm: false };
  }
  if (p === 'kugou' || (song as UnifiedSong).platform === 'kugou') {
    if (p !== 'kugou') return { url: null, needUnm: false };
    const url = await kgSongUrl(song, level);
    return { url, needUnm: false };
  }
  const { songUrl } = await import('./music-api');
  try {
    const r = await songUrl(song.id, level);
    if (r.url && !r.freeTrial) return { url: r.url, needUnm: false };
    // VIP 试听片段 / 无直链：needUnm 交给上层（music-store 统一走 UNM 解灰 + 跨平台兜底，
    // 以便弹出「已为你切换至 XX 平台播放」提示；trialUrl 兜底回退 30 秒试听）
    if (r.url && r.freeTrial) return { url: null, needUnm: true, trialUrl: r.url };
    return { url: null, needUnm: true };
  } catch {
    return { url: null, needUnm: true };
  }
}

export async function multiLyric(p: MusicPlatform, song: UnifiedSong): Promise<NcmLyric> {
  const sp = songPlatform(song);
  if (sp === 'qq') return qqLyric(song);
  if (sp === 'kugou') return kgLyric(song);
  const { lyricOf } = await import('./music-api');
  return lyricOf(song.id);
}

// ---------------- 评论（平台感知：网易云 / QQ / 酷狗） ----------------

/** QQ 评论条目（fcg_global_comment_h5 原始形状） → NcmComment */
interface QqCommentItem {
  commentid?: string;
  nick?: string;
  avatarurl?: string;
  time?: number;
  rootcommentcontent?: string;
  content?: string;
  praisenum?: number;
  middlecommentcontent?: { subcommentcontent?: string } | null;
}

/** 酷狗评论条目（/comment/music 原始形状） → NcmComment */
interface KgCommentItem {
  id?: number;
  user_name?: string;
  user_pic?: string;
  content?: string;
  addtime?: string;
  like?: { count?: number; likenum?: number };
  pcontent?: string;
  puser_id?: number;
}

/** 字符串 → 稳定数字 id（QQ commentid 形如 "1!nfno6LB..."，NcmComment.commentId 是 number） */
function strId(s: string | undefined): number {
  if (!s) return 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export interface MultiCommentPage {
  total: number;
  comments: NcmComment[];
  hasMore: boolean;
  /** 网易云 = comment/new 游标（hot#N / 时间戳）；QQ/酷狗 = 下一页页码（数字字符串） */
  cursor: string;
}

/** 评论列表（平台感知）。
 *  - 网易云：comment/new（sortType 1 推荐 / 2 最热 / 3 最新，cursor 翻页）
 *  - QQ：/comment（fcg_global_comment_h5；首页合并热门评论，页码翻页）
 *  - 酷狗：/comment/music（mixsongid 必需；页码翻页） */
export async function multiComments(
  p: MusicPlatform,
  song: UnifiedSong,
  sortType: 1 | 2 | 3,
  pageSize = 20,
  cursor = '',
): Promise<MultiCommentPage> {
  const sp = songPlatform(song);
  if (sp === 'qq') {
    const page = Math.max(1, Number(cursor) || 1);
    const d = await qqRequest<{
      comment?: { commentlist?: QqCommentItem[]; commenttotal?: number };
      hotComment?: { commentlist?: QqCommentItem[] };
    }>('comment', {
      id: song.id,
      biztype: 1,
      pageNo: page,
      pageSize,
      type: 0,
    });
    const total = Number(d.comment?.commenttotal ?? 0);
    const mapQq = (c: QqCommentItem): NcmComment => {
      // 老评论 time 可能为 0/-1（时代不明）→ 按 0 处理不显示日期（避免 1970 年代的鬼日期）
      const ts = Number(c.time ?? 0);
      return {
        commentId: strId(c.commentid),
        content: c.rootcommentcontent || c.content || '',
        time: ts > 0 ? ts * 1000 : 0,
        likedCount: c.praisenum ?? 0,
        user: { userId: 0, nickname: c.nick || 'QQ音乐用户', avatarUrl: c.avatarurl || '' },
      };
    };
    // 排序映射：推荐/最热 = 首页热门在前再接最新；最新 = 仅最新列表
    const hot = page === 1 && sortType !== 3 ? (d.hotComment?.commentlist || []).map(mapQq) : [];
    const list = (d.comment?.commentlist || []).map(mapQq);
    const merged = sortType !== 3 ? [...hot, ...list] : list;
    // 去重（热门与最新列表可能重复）
    const seen = new Set<number>();
    const comments = merged.filter((c) => (seen.has(c.commentId) ? false : (seen.add(c.commentId), true)));
    const hasMore = page * pageSize < total;
    return { total, comments, hasMore, cursor: hasMore ? String(page + 1) : '' };
  }
  if (sp === 'kugou') {
    const mixsongid = song.kgEmixId || 0;
    if (!mixsongid) return { total: 0, comments: [], hasMore: false, cursor: '' };
    const page = Math.max(1, Number(cursor) || 1);
    // 注意：/comment/music 响应的 count/list 在顶层（kgRequest 对无 data 的响应原样返回）
    const d = await kgRequest<{ count?: number; list?: KgCommentItem[] }>('comment/music', {
      mixsongid,
      p: page,
      pagesize: pageSize,
    });
    const total = Number(d.count ?? 0);
    const comments = (d.list || []).map((c): NcmComment => ({
      commentId: Number(c.id ?? 0) || strId(String(c.id ?? '')),
      content: c.content || '',
      // addtime 形如 "2026-11-16 01:36:19" → 只取日期部分（与网易云评论日期同口径）
      timeStr: (c.addtime || '').split(' ')[0] || '',
      time: c.addtime ? Date.parse(c.addtime.replace(' ', 'T')) || 0 : 0,
      likedCount: c.like?.count ?? c.like?.likenum ?? 0,
      user: { userId: 0, nickname: c.user_name || '酷狗用户', avatarUrl: c.user_pic || '' },
      beRepliedComment: c.pcontent
        ? { content: c.pcontent, user: { nickname: '楼主' } }
        : null,
    }));
    const hasMore = page * pageSize < total;
    return { total, comments, hasMore, cursor: hasMore ? String(page + 1) : '' };
  }
  const { commentsNew } = await import('./music-api');
  return commentsNew(song.id, sortType, pageSize, cursor);
}

/** 评论总数（播放页评论按钮数字；平台感知，失败返回 null 不展示） */
export async function multiCommentCount(p: MusicPlatform, song: UnifiedSong): Promise<number | null> {
  const sp = songPlatform(song);
  try {
    if (sp === 'qq') {
      const d = await qqRequest<{ comment?: { commenttotal?: number } }>('comment', {
        id: song.id,
        biztype: 1,
        pageNo: 1,
        pageSize: 1,
        type: 0,
      });
      return Number(d.comment?.commenttotal ?? 0);
    }
    if (sp === 'kugou') {
      const mixsongid = song.kgEmixId || 0;
      if (!mixsongid) return null;
      const d = await kgRequest<{ count?: number }>('comment/music', { mixsongid, p: 1, pagesize: 1 });
      return Number(d.count ?? 0);
    }
    const { commentsOf } = await import('./music-api');
    const r = await commentsOf(song.id, 1, 0);
    return r.total;
  } catch {
    return null;
  }
}

export async function multiSonglistDetail(
  p: MusicPlatform,
  ref: { id: number; gid?: string },
): Promise<UnifiedPlaylistDetail> {
  if (p === 'qq') {
    const d = await qqSonglistDetail(ref.id, 1, 300);
    return d;
  }
  if (p === 'kugou') {
    const songs = await kgPlaylistSongs(ref.gid || String(ref.id), 300);
    return { id: ref.id, name: '', cover: '', total: songs.length, creator: '', songs };
  }
  const { playlistDetail } = await import('./music-api');
  const pd = await playlistDetail(ref.id);
  return {
    id: pd.id,
    name: pd.name,
    cover: pd.coverImgUrl || '',
    total: pd.trackCount,
    creator: pd.creator?.nickname || '',
    songs: (pd.tracks || []).map((s) => withPlatform(s, 'netease')),
  };
}
