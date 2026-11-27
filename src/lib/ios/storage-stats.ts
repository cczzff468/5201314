'use client';

/**
 * 本机数据统计与清理工具（自设置›储存空间页抽出，供文件 App「数据管理」复用）：
 * - statStore / statKv：IndexedDB 真实字节实测（Blob 取 size、字符串取 UTF-8）
 * - APP_DATA_SPECS：数据管理页的 App 级总表（列表 / 备份 / 清理共用同一份映射）
 * - autoCleanMedia：老照片自动压缩（4 天以上压图、7 天以上清理超大原图）
 * - cleanRegenerableAssets：可再生缓存键清理（主题激活素材绝不触碰）
 */

import { localDB, type IOSStoreName } from '@/lib/ios/db';
import { compressImageSrc } from '@/lib/imggen';

// ---------------- 字节估算 ----------------

let _te: TextEncoder | null = null;
export function strBytes(s: string): number {
  if (!_te) _te = new TextEncoder();
  return _te.encode(s).length;
}

/** 递归估算任意记录的真实字节：Blob 取 size、字符串取 UTF-8 字节数、对象/数组逐字段累加 */
export function valueBytes(v: unknown, depth = 0): number {
  if (v == null) return 4;
  if (typeof v === 'string') return strBytes(v);
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 4;
  if (v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (depth >= 5) return 0;
  if (Array.isArray(v)) {
    let s = 0;
    for (const item of v) s += valueBytes(item, depth + 1);
    return s;
  }
  if (typeof v === 'object') {
    let s = 0;
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      s += k.length + valueBytes(item, depth + 1);
    }
    return s;
  }
  return 0;
}

export interface StoreStat {
  bytes: number;
  /** 组内最新一条数据的时间戳（无时间字段 = null） */
  lastAt: number | null;
}

export const EMPTY_STAT: StoreStat = { bytes: 0, lastAt: null };

export function mergeStats(...stats: StoreStat[]): StoreStat {
  let bytes = 0;
  let lastAt: number | null = null;
  for (const s of stats) {
    bytes += s.bytes;
    if (s.lastAt != null && (lastAt == null || s.lastAt > lastAt)) lastAt = s.lastAt;
  }
  return { bytes, lastAt };
}

/** 扫描一个对象 store：累加真实字节 + 取最新时间戳 */
export async function statStore<K extends IOSStoreName>(
  store: K,
  tsField: 'createdAt' | 'updatedAt' = 'createdAt',
): Promise<StoreStat> {
  try {
    const rows = (await localDB.getAll(store)) as unknown as Record<string, unknown>[];
    let bytes = 0;
    let lastAt: number | null = null;
    for (const r of rows) {
      bytes += valueBytes(r);
      const ts = r[tsField];
      if (typeof ts === 'number' && ts > (lastAt ?? 0)) lastAt = ts;
    }
    return { bytes, lastAt };
  } catch {
    return { bytes: 0, lastAt: null };
  }
}

/** kv 键 → 所属桶（键名前缀规则，与 idb-kv 迁移清单一致） */
export function kvBucketOf(key: string): KvBucketName {
  if (key.startsWith('wx')) return 'wx';
  if (key.startsWith('qq')) return 'qq';
  if (key.startsWith('ios-chat') || key.startsWith('sms-chat') || key.startsWith('chat-translate')) return 'chat';
  if (key.startsWith('mem-')) return 'memory';
  if (key.startsWith('worldbook') || key.startsWith('wb-bind')) return 'worldbook';
  if (key.startsWith('music')) return 'music';
  return 'system';
}

export type KvBucketName = 'wx' | 'qq' | 'chat' | 'memory' | 'worldbook' | 'music' | 'system';

export type KvBuckets = Record<KvBucketName, StoreStat>;

/** 扫描 kv store：按键前缀分组归属（wx-*→微信、qq-*→QQ、mem-*→记忆库…） */
export async function statKv(): Promise<KvBuckets> {
  const buckets: KvBuckets = {
    wx: { ...EMPTY_STAT },
    qq: { ...EMPTY_STAT },
    chat: { ...EMPTY_STAT },
    memory: { ...EMPTY_STAT },
    worldbook: { ...EMPTY_STAT },
    music: { ...EMPTY_STAT },
    system: { ...EMPTY_STAT },
  };
  try {
    const rows = await localDB.getAll('kv');
    for (const r of rows) {
      const b = buckets[kvBucketOf(r.key)];
      b.bytes += valueBytes(r.value) + strBytes(r.key);
    }
  } catch {
    // IndexedDB 不可用时全 0
  }
  return buckets;
}

// ---------------- 容量与时间文案 ----------------

/** iOS 风容量格式：字节 / KB / MB / GB 自适应 */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 字节';
  if (b < 1024) return `${Math.round(b)} 字节`;
  const kb = b / 1024;
  if (kb < 1024) return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 相对时间文案：今天 / 昨天 / N 天前 / YYYY/M/D */
export function lastUsedFromTs(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export async function readStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    }
  } catch {
    // 忽略，返回 0
  }
  return { usage: 0, quota: 0 };
}

// ---------------- App 级数据总表（列表 / 备份 / 清理共用同一份映射） ----------------

export interface AppDataSpec {
  id: string;
  label: string;
  /** 主屏图标路径（列表中灰度渲染） */
  image: string;
  /** IndexedDB 记录仓 */
  stores: IOSStoreName[];
  /** kv 键前缀（精确键或前缀；空 = 该 App 不使用 kv） */
  kvPrefixes: string[];
  /** localStorage 键前缀（阅读排版 / 小屋存档等小体量数据） */
  lsPrefixes: string[];
}

/**
 * 按 App 独立管理：每一行对应一个真实 App，
 * 数据来源 = IndexedDB 记录仓 + kv 前缀 + localStorage 前缀。
 */
export const APP_DATA_SPECS: AppDataSpec[] = [
  {
    id: 'chat',
    label: '聊天 · 信息',
    image: '/icons/chat.png',
    stores: ['chat-sessions', 'chat-messages', 'call-logs', 'voicemails'],
    kvPrefixes: ['ios-chat', 'sms-chat', 'chat-translate'],
    lsPrefixes: [],
  },
  { id: 'wechat', label: '微信', image: '/icons/wechat.png', stores: [], kvPrefixes: ['wx'], lsPrefixes: [] },
  { id: 'qq', label: 'QQ', image: '/icons/qq.png', stores: [], kvPrefixes: ['qq'], lsPrefixes: [] },
  { id: 'forum', label: 'X 论坛', image: '/icons/forum.png', stores: [], kvPrefixes: ['forum'], lsPrefixes: [] },
  { id: 'music', label: '音乐', image: '/icons/music.png', stores: ['music'], kvPrefixes: ['music'], lsPrefixes: [] },
  { id: 'reading', label: '阅读', image: '/icons/reading.png', stores: [], kvPrefixes: ['rd-'], lsPrefixes: ['rd-'] },
  { id: 'cottage', label: '拾光小屋 · 3D', image: '/icons/cottage.png', stores: [], kvPrefixes: ['cabin', 'cottage'], lsPrefixes: ['cabin-'] },
  { id: 'photos', label: '照片与相册', image: '/icons/photos.png', stores: ['photos', 'albums', 'visionDecisions'], kvPrefixes: [], lsPrefixes: [] },
  { id: 'notes', label: '备忘录 · 日程', image: '/icons/notes.png', stores: ['notes', 'events', 'reminders'], kvPrefixes: [], lsPrefixes: [] },
  { id: 'memory', label: '记忆 · 世界书', image: '/icons/memory-helper.png', stores: [], kvPrefixes: ['mem-', 'worldbook', 'wb-'], lsPrefixes: [] },
];

export interface AppDataStat extends AppDataSpec {
  bytes: number;
  lastAt: number | null;
}

function matchesPrefix(key: string, prefixes: string[]): boolean {
  return prefixes.some((p) => key === p || key.startsWith(p));
}

function readLsEntries(): [string, string][] {
  const out: [string, string][] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k == null) continue;
      out.push([k, window.localStorage.getItem(k) ?? '']);
    }
  } catch {
    // 隐私模式等读不到：仅统计 IndexedDB
  }
  return out;
}

/** 并发实测各 App 占用（列表数据源） */
export async function computeAppStats(): Promise<AppDataStat[]> {
  const kvRows = await localDB.getAll('kv').catch(() => [] as { key: string; value: unknown }[]);
  const ls = readLsEntries();
  const storeStats = await Promise.all(
    APP_DATA_SPECS.map((spec) => Promise.all(spec.stores.map((s) => statStore(s)))),
  );
  return APP_DATA_SPECS.map((spec, i) => {
    let bytes = 0;
    let lastAt: number | null = null;
    for (const s of storeStats[i]) {
      bytes += s.bytes;
      if (s.lastAt != null && (lastAt == null || s.lastAt > lastAt)) lastAt = s.lastAt;
    }
    if (spec.kvPrefixes.length > 0) {
      for (const r of kvRows) {
        if (matchesPrefix(r.key, spec.kvPrefixes)) bytes += valueBytes(r.value) + strBytes(r.key);
      }
    }
    if (spec.lsPrefixes.length > 0) {
      for (const [k, v] of ls) {
        if (matchesPrefix(k, spec.lsPrefixes)) bytes += strBytes(k) + strBytes(v);
      }
    }
    return { ...spec, bytes, lastAt };
  });
}

// ---------------- App 级清理（红色危险操作） ----------------

/** 清空所选 App：store 整仓 clear + kv 前缀逐键删除 + localStorage 前缀逐键删除 */
export async function clearAppData(appIds: string[]): Promise<void> {
  const specs = APP_DATA_SPECS.filter((s) => appIds.includes(s.id));
  if (specs.length === 0) return;
  for (const spec of specs) {
    for (const s of spec.stores) await localDB.clear(s);
  }
  const kvPrefixes = specs.flatMap((s) => s.kvPrefixes);
  if (kvPrefixes.length > 0) {
    const rows = await localDB.getAll('kv');
    for (const r of rows) {
      if (matchesPrefix(r.key, kvPrefixes)) await localDB.delete('kv', r.key);
    }
  }
  const lsPrefixes = specs.flatMap((s) => s.lsPrefixes);
  if (lsPrefixes.length > 0) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k != null && matchesPrefix(k, lsPrefixes)) doomed.push(k);
      }
      for (const k of doomed) window.localStorage.removeItem(k);
    } catch {
      // 隐私模式等读不到：只清 IndexedDB
    }
  }
}

// ---------------- 备份标记（已备份 / 未备份全局汇总） ----------------

const APP_BACKUP_MARKS_KEY = 'app-backup-marks-v1';

export interface AppBackupMark {
  at: number;
  bytes: number;
}
export type AppBackupMarks = Record<string, AppBackupMark>;

export async function readAppBackupMarks(): Promise<AppBackupMarks> {
  try {
    const v = (await localDB.get('settings', APP_BACKUP_MARKS_KEY))?.value;
    return v && typeof v === 'object' ? (v as AppBackupMarks) : {};
  } catch {
    return {};
  }
}

export async function markAppsBackedUp(entries: { id: string; bytes: number }[]): Promise<AppBackupMarks> {
  const marks = await readAppBackupMarks();
  const at = Date.now();
  for (const e of entries) marks[e.id] = { at, bytes: e.bytes };
  await localDB.put('settings', { key: APP_BACKUP_MARKS_KEY, value: marks });
  return marks;
}

export async function clearAppBackupMarks(appIds?: string[]): Promise<AppBackupMarks> {
  if (!appIds) {
    await localDB.put('settings', { key: APP_BACKUP_MARKS_KEY, value: {} });
    return {};
  }
  const marks = await readAppBackupMarks();
  for (const id of appIds) delete marks[id];
  await localDB.put('settings', { key: APP_BACKUP_MARKS_KEY, value: marks });
  return marks;
}

// ---------------- 浏览器持久化保护 ----------------

/** 浏览器持久化：防磁盘压力下 IndexedDB 被整库清除（eviction）；已持久化后无法程序化撤销 */
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return false;
    if (await navigator.storage.persisted?.()) return true;
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ---------------- 媒体自动压缩与清理 ----------------

const AUTO_CLEAN_KEY = 'media-auto-clean';
const AUTO_CLEAN_LAST_KEY = 'media-auto-clean-last';

export async function readMediaAutoClean(): Promise<boolean> {
  try {
    return (await localDB.get('settings', AUTO_CLEAN_KEY))?.value === true;
  } catch {
    return false;
  }
}

export async function writeMediaAutoClean(on: boolean): Promise<void> {
  await localDB.put('settings', { key: AUTO_CLEAN_KEY, value: on });
}

/** 上次自动/手动执行时间（毫秒；从未执行 = 0） */
export async function readMediaCleanLast(): Promise<number> {
  try {
    const v = (await localDB.get('settings', AUTO_CLEAN_LAST_KEY))?.value;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

async function writeMediaCleanLast(at: number): Promise<void> {
  await localDB.put('settings', { key: AUTO_CLEAN_LAST_KEY, value: at });
}

/** dataURL → Blob（JPEG） */
function dataUrlToBlob(dataUrl: string): Blob {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

async function compressPhotoBlob(blob: Blob, maxPx: number, quality: number): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const dataUrl = await compressImageSrc(url, maxPx, quality);
    const out = dataUrlToBlob(dataUrl);
    return out.size < blob.size ? out : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface MediaCleanResult {
  compressed: number;
  savedBytes: number;
  /** 是否跳过（距上次执行不足一天，仅自动模式生效） */
  skipped?: boolean;
}

/**
 * 一轮媒体压缩清理（手动「立即执行」与自动开关共用同一实现）：
 * - 4 天以上照片：压到 1280px / q0.72（压缩有效才替换，绝不放大）
 * - 7 天以上且仍超过 800 KB 的原图：再压到 960px / q0.6（「清理无用原图」）
 * 壁纸 / 图标 / 字体等常驻素材不在照片库，天然不纳入。
 */
export async function cleanMedia(opts: { auto?: boolean } = {}): Promise<MediaCleanResult> {
  if (opts.auto) {
    const last = await readMediaCleanLast();
    if (Date.now() - last < 24 * 3600_000) return { compressed: 0, savedBytes: 0, skipped: true };
  }
  const photos = await localDB.getAll('photos');
  let compressed = 0;
  let savedBytes = 0;
  const DAY = 86400_000;
  for (const p of photos) {
    const age = Date.now() - p.createdAt;
    if (age < 4 * DAY || !(p.blob instanceof Blob) || p.blob.size < 150 * 1024) continue;
    const big = age >= 7 * DAY && p.blob.size > 800 * 1024;
    const out = await compressPhotoBlob(p.blob, big ? 960 : 1280, big ? 0.6 : 0.72);
    if (out) {
      savedBytes += p.blob.size - out.size;
      await localDB.put('photos', { ...p, blob: out });
      compressed++;
    }
  }
  await writeMediaCleanLast(Date.now());
  return { compressed, savedBytes };
}

// ---------------- 可再生缓存清理（「清理未引用主题素材」按钮） ----------------

/**
 * 清理可再生缓存键：kv 中临时缓存 / 快照类记录（表情包缓存、状态快照等可重建数据）。
 * 主题素材（壁纸 / 锁屏 / 自定义图标）在 settings 里为覆盖式写入、不存在孤儿文件，绝不触碰；
 * 聊天 / 记忆 / 世界书等业务键不匹配缓存命名，不受影响。
 */
export async function cleanRegenerableAssets(): Promise<{ keys: number; bytes: number }> {
  const CACHE_KEY_RE = /-cache$|Cache$|-snapshot$|_snapshot$|^sticker-cache-/;
  let keys = 0;
  let bytes = 0;
  const rows = await localDB.getAll('kv');
  for (const r of rows) {
    if (CACHE_KEY_RE.test(r.key)) {
      bytes += valueBytes(r.value) + strBytes(r.key);
      await localDB.delete('kv', r.key);
      keys++;
    }
  }
  return { keys, bytes };
}
