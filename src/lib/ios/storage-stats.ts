'use client';

/**
 * 本机数据统计与清理工具（自设置›储存空间页抽出，供文件 App「数据管理」复用）：
 * - statStore / statKv：IndexedDB 真实字节实测（Blob 取 size、字符串取 UTF-8）
 * - DATA_MODULES：数据管理页的模块总表（展示 / 导出 / 清理三处共用同一份映射）
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

// ---------------- 数据管理模块总表（展示 / 导出 / 清理三处共用） ----------------

export interface DataModule {
  id: string;
  label: string;
  /** 环形图与图例色点 */
  color: string;
  stores: IOSStoreName[];
  kvBuckets: KvBucketName[];
}

/** 八大模块：聊天 / 角色卡与联系人 / 记忆 / 世界书 / 社交 / 媒体库 / 备忘日程 / 设置与系统 */
export const DATA_MODULES: DataModule[] = [
  { id: 'chat', label: '聊天数据', color: '#0A84FF', stores: ['chat-sessions', 'chat-messages', 'call-logs', 'voicemails'], kvBuckets: ['chat'] },
  { id: 'chars', label: '角色卡与联系人', color: '#FF2D78', stores: ['contacts', 'visionDecisions'], kvBuckets: [] },
  { id: 'memory', label: '记忆', color: '#5E5CE6', stores: [], kvBuckets: ['memory'] },
  { id: 'worldbook', label: '世界书', color: '#BF5AF2', stores: [], kvBuckets: ['worldbook'] },
  { id: 'social', label: '社交内容', color: '#FF9F0A', stores: [], kvBuckets: ['wx', 'qq'] },
  { id: 'media', label: '媒体库', color: '#FFD60A', stores: ['photos', 'albums', 'recordings', 'music', 'ringtones'], kvBuckets: [] },
  { id: 'agenda', label: '备忘与日程', color: '#32D74B', stores: ['notes', 'events', 'reminders'], kvBuckets: [] },
  { id: 'sys', label: '设置与系统', color: '#64D2FF', stores: ['settings', 'alarms', 'cities'], kvBuckets: ['music', 'system'] },
];

export interface ModuleStat extends DataModule {
  stat: StoreStat;
}

/** 并发实测全部模块占用（模块占用分析环形图数据源） */
export async function computeModuleStats(): Promise<ModuleStat[]> {
  const kv = await statKv();
  const moduleStats = await Promise.all(
    DATA_MODULES.map(async (m) => {
      const storeStats = await Promise.all(m.stores.map((s) => statStore(s)));
      const kvStats = m.kvBuckets.map((b) => kv[b]);
      return { ...m, stat: mergeStats(...storeStats, ...kvStats) };
    }),
  );
  return moduleStats;
}

// ---------------- 模块清理（危险操作） ----------------

/** 清空所选模块：store 整仓 clear + kv 按桶前缀逐键删除；返回清理的 kv 键数 */
export async function clearModules(moduleIds: string[]): Promise<number> {
  const targets = DATA_MODULES.filter((m) => moduleIds.includes(m.id));
  let kvDeleted = 0;
  for (const m of targets) {
    for (const s of m.stores) {
      await localDB.clear(s);
    }
    if (m.kvBuckets.length > 0) {
      const rows = await localDB.getAll('kv');
      for (const r of rows) {
        if (m.kvBuckets.includes(kvBucketOf(r.key))) {
          await localDB.delete('kv', r.key);
          kvDeleted++;
        }
      }
    }
  }
  return kvDeleted;
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
