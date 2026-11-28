'use client';

/**
 * 按 App 维度的本机数据统计 / 清理 / 备份过滤层（文件 App「数据管理」Terminal 版数据源）。
 *
 * 设计动机：旧「模块占用」按数据类型分桶（聊天数据/社交内容/媒体库…），与用户心智里的
 * 「一个个 App」对不上。本层改为 App 行粒度——每一行 = 一个真实 App（信息 / 微信 / QQ /
 * X论坛 / 音乐 / 阅读 / 拾光小屋 / 记忆库 / 世界书 / 照片与媒体 / 备忘与日程 / 联系人 /
 * 设置与系统），行数据 = 该 App 名下的 IndexedDB 对象仓 + kv 前缀键 + localStorage 前缀键
 * 三者字节之和。
 *
 * - kv / ls 归属：按各 App 前缀先后匹配（specific 在前），全部不中 → 「设置与系统」（rest）；
 * - 备份过滤：App 前缀 → CollectBackupFilter（include / exclude / unmatched 三段语义），
 *   「仅备份此 App」导出的文件只含该 App 名下数据；
 * - 清理：kv 走 kvDelByPrefix / kvDelRaw（内存 + IndexedDB 同步清，含各账号后缀键），
 *   localStorage 逐键 removeItem，对象仓整仓 clear。
 */

import { localDB, type IOSStoreName } from '@/lib/ios/db';
import { flushKvWrites, kvDelByPrefix, kvDelRaw, kvKeysByPrefix } from '@/lib/ios/idb-kv';
import { strBytes, valueBytes, type StoreStat } from '@/lib/ios/storage-stats';
import { readBackupPrefs, cloudBackupCreds } from '@/lib/ios/cloud-backup';
import { readLastBackupAt, type CollectBackupFilter } from '@/lib/ios/backup';

// ---------------- App 总表（行粒度） ----------------

export interface AppModuleDef {
  id: string;
  label: string;
  /** 行图标（public 下真实 App 图标路径，行内灰度渲染） */
  icon: string;
  /** 终端风路径标识（行副标题） */
  path: string;
  /** 该 App 独占的 IndexedDB 对象仓 */
  stores: IOSStoreName[];
  /** 该 App 名下 kv 键前缀（跨账号后缀键一并命中） */
  kvPrefixes: string[];
  /** 该 App 名下 localStorage 键前缀 */
  lsPrefixes: string[];
  /** 兜底 App：kv / ls 中未被任何前缀命中的键都归它（排在最后） */
  kvRest?: boolean;
  lsRest?: boolean;
  /** 危险标记：清理该 App 会影响全局体验（设置与系统） */
  danger?: boolean;
}

/** 十三行 App：覆盖本机全部可测量数据（并集 = 完整 kv + 全部对象仓 + 全部 localStorage） */
export const APP_MODULES: AppModuleDef[] = [
  {
    id: 'chat',
    label: '信息',
    icon: '/icons/chat.png',
    path: '/apps/chat',
    stores: ['chat-sessions', 'chat-messages', 'call-logs', 'voicemails'],
    kvPrefixes: ['ios-chat', 'sms-chat', 'chat-translate'],
    lsPrefixes: [],
  },
  {
    id: 'wechat',
    label: '微信',
    icon: '/icons/wechat.png',
    path: '/apps/wechat',
    stores: [],
    kvPrefixes: ['wx'],
    lsPrefixes: [],
  },
  {
    id: 'qq',
    label: 'QQ',
    icon: '/icons/qq.png',
    path: '/apps/qq',
    stores: [],
    kvPrefixes: ['qq'],
    lsPrefixes: [],
  },
  {
    id: 'forum',
    label: 'X论坛',
    icon: '/icons/forum.png',
    path: '/apps/forum',
    stores: [],
    kvPrefixes: ['forum'],
    lsPrefixes: [],
  },
  {
    id: 'music',
    label: '音乐',
    icon: '/icons/music.png',
    path: '/apps/music',
    stores: ['music'],
    kvPrefixes: ['music'],
    lsPrefixes: [],
  },
  {
    id: 'reading',
    label: '阅读',
    icon: '/icons/reading.png?v=46',
    path: '/apps/reading',
    stores: [],
    kvPrefixes: [],
    lsPrefixes: ['rd-'],
  },
  {
    id: 'cottage',
    label: '拾光小屋',
    icon: '/icons/cottage.png',
    path: '/apps/cottage',
    stores: [],
    kvPrefixes: [],
    lsPrefixes: ['cabin-'],
  },
  {
    id: 'memory',
    label: '记忆库',
    icon: '/icons/memory-helper.png',
    path: '/apps/memory',
    stores: [],
    kvPrefixes: ['mem-'],
    lsPrefixes: [],
  },
  {
    id: 'worldbook',
    label: '世界书',
    icon: '/icons/worldbook.png',
    path: '/apps/worldbook',
    stores: [],
    kvPrefixes: ['worldbook', 'wb-bind'],
    lsPrefixes: [],
  },
  {
    id: 'photos',
    label: '照片与媒体',
    icon: '/icons/photos.png',
    path: '/apps/photos',
    stores: ['photos', 'albums', 'recordings', 'ringtones'],
    kvPrefixes: [],
    lsPrefixes: [],
  },
  {
    id: 'agenda',
    label: '备忘与日程',
    icon: '/icons/notes.png',
    path: '/apps/agenda',
    stores: ['notes', 'events', 'reminders'],
    kvPrefixes: [],
    lsPrefixes: [],
  },
  {
    id: 'contacts',
    label: '联系人',
    icon: '/icons/contacts.png',
    path: '/apps/contacts',
    stores: ['contacts', 'visionDecisions'],
    kvPrefixes: [],
    lsPrefixes: [],
  },
  {
    id: 'system',
    label: '设置与系统',
    icon: '/icons/settings.png',
    path: '/etc/system',
    stores: ['settings', 'alarms', 'cities'],
    kvPrefixes: [],
    lsPrefixes: [],
    kvRest: true,
    lsRest: true,
    danger: true,
  },
];

export function appOf(id: string): AppModuleDef | undefined {
  return APP_MODULES.find((a) => a.id === id);
}

/** 一个键归属哪个 App：按表序前缀匹配，全不中 → rest App（无 rest = null） */
function ownerOf(key: string, by: 'kv' | 'ls'): AppModuleDef | null {
  for (const app of APP_MODULES) {
    const prefixes = by === 'kv' ? app.kvPrefixes : app.lsPrefixes;
    if (prefixes.some((p) => key.startsWith(p))) return app;
  }
  return APP_MODULES.find((a) => (by === 'kv' ? a.kvRest : a.lsRest)) ?? null;
}

// ---------------- 统计 ----------------

export interface AppStat {
  id: string;
  bytes: number;
  /** 数据条数（对象仓行数 + kv 键数 + localStorage 键数） */
  records: number;
  /** 最新一条数据时间戳（对象仓行内 createdAt/updatedAt；无时间字段 = null） */
  lastAt: number | null;
  storeBytes: number;
  kvBytes: number;
  lsBytes: number;
}

/** 单对象仓实测：字节数 + 行数 + 最新时间戳（createdAt / updatedAt 双字段兜底） */
async function scanStore(store: IOSStoreName): Promise<StoreStat & { rows: number }> {
  try {
    const rows = (await localDB.getAll(store)) as unknown as Record<string, unknown>[];
    let bytes = 0;
    let lastAt: number | null = null;
    for (const r of rows) {
      bytes += valueBytes(r);
      for (const f of ['createdAt', 'updatedAt'] as const) {
        const ts = r[f];
        if (typeof ts === 'number' && ts > (lastAt ?? 0)) lastAt = ts;
      }
    }
    return { bytes, lastAt, rows: rows.length };
  } catch {
    return { bytes: 0, lastAt: null, rows: 0 };
  }
}

/** localStorage 实测：按键前缀归属，值为 UTF-8 字节 */
function scanLs(): { bytes: Map<string, { bytes: number; keys: number }>; totalKeys: number } {
  const bytes = new Map<string, { bytes: number; keys: number }>();
  let totalKeys = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k == null) continue;
      totalKeys++;
      const owner = ownerOf(k, 'ls');
      if (!owner) continue;
      const v = window.localStorage.getItem(k) ?? '';
      const b = strBytes(k) + strBytes(v);
      const cur = bytes.get(owner.id) ?? { bytes: 0, keys: 0 };
      cur.bytes += b;
      cur.keys++;
      bytes.set(owner.id, cur);
    }
  } catch {
    // 隐私模式等读不到：全 0
  }
  return { bytes, totalKeys };
}

/** 并发实测全部 App 行占用（列表页数据源；先冲刷 kv 防抖写入，确保读到最新值） */
export async function computeAppStats(): Promise<AppStat[]> {
  flushKvWrites();
  const ls = scanLs();

  // kv 单次扫描：真实存储键（含各账号后缀键）按前缀归属
  const kvBytes = new Map<string, { bytes: number; keys: number }>();
  try {
    const rows = await localDB.getAll('kv');
    for (const r of rows) {
      const owner = ownerOf(r.key, 'kv');
      if (!owner) continue;
      const b = valueBytes(r.value) + strBytes(r.key);
      const cur = kvBytes.get(owner.id) ?? { bytes: 0, keys: 0 };
      cur.bytes += b;
      cur.keys++;
      kvBytes.set(owner.id, cur);
    }
  } catch {
    // IndexedDB 不可用时 kv 全 0
  }

  // 对象仓并发扫描
  const storeStats = new Map<string, { bytes: number; rows: number; lastAt: number | null }>();
  await Promise.all(
    [...new Set(APP_MODULES.flatMap((a) => a.stores))].map(async (store) => {
      const s = await scanStore(store);
      for (const app of APP_MODULES) {
        if (!app.stores.includes(store)) continue;
        const cur = storeStats.get(app.id) ?? { bytes: 0, rows: 0, lastAt: null };
        cur.bytes += s.bytes;
        cur.rows += s.rows;
        if (s.lastAt != null && (cur.lastAt == null || s.lastAt > cur.lastAt)) cur.lastAt = s.lastAt;
        storeStats.set(app.id, cur);
      }
    }),
  );

  return APP_MODULES.map((app) => {
    const st = storeStats.get(app.id) ?? { bytes: 0, rows: 0, lastAt: null };
    const kv = kvBytes.get(app.id) ?? { bytes: 0, keys: 0 };
    const l = ls.bytes.get(app.id) ?? { bytes: 0, keys: 0 };
    return {
      id: app.id,
      bytes: st.bytes + kv.bytes + l.bytes,
      records: st.rows + kv.keys + l.keys,
      lastAt: st.lastAt,
      storeBytes: st.bytes,
      kvBytes: kv.bytes,
      lsBytes: l.bytes,
    };
  });
}

// ---------------- 清理 ----------------

export interface ClearResult {
  bytes: number;
  records: number;
}

/** 清空所选 App 的本机数据：对象仓整仓 clear + kv 按前缀删（含账号后缀键）+ ls 逐键删 */
export async function clearAppData(appIds: string[]): Promise<ClearResult> {
  const targets = APP_MODULES.filter((a) => appIds.includes(a.id));
  if (targets.length === 0) return { bytes: 0, records: 0 };
  flushKvWrites();

  // 先实测待释放量（清完再测就没了）
  const stats = await computeAppStats();
  const freedBytes = stats
    .filter((s) => appIds.includes(s.id))
    .reduce((sum, s) => sum + s.bytes, 0);
  let records = 0;

  for (const app of targets) {
    for (const store of app.stores) {
      try {
        records += await localDB.count(store);
        await localDB.clear(store);
      } catch {
        /* 单仓失败不阻塞其余清理 */
      }
    }
    for (const p of app.kvPrefixes) {
      const keys = kvKeysByPrefix(p);
      records += keys.length;
      kvDelByPrefix(p);
    }
    // 兜底 App：删掉「不属于任何其它 App」的全部键
    if (app.kvRest) {
      for (const k of kvKeysByPrefix('')) {
        const owner = ownerOf(k, 'kv');
        if (owner && owner.id === app.id) {
          records++;
          kvDelRaw(k);
        }
      }
    }
    if (app.lsPrefixes.length > 0 || app.lsRest) {
      try {
        const doomed: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k == null) continue;
          const owner = ownerOf(k, 'ls');
          if (owner && owner.id === app.id) doomed.push(k);
        }
        for (const k of doomed) {
          window.localStorage.removeItem(k);
          records++;
        }
      } catch {
        /* localStorage 不可用时跳过 */
      }
    }
  }
  return { bytes: freedBytes, records };
}

// ---------------- 备份过滤 ----------------

/**
 * App 行 → 备份范围过滤（「仅备份此 App」/「备份选中项」共用）：
 * - 白名单 = 所选 App 的 kv / ls 前缀并集；
 * - 黑名单 = 未选 App 的前缀并集（仅当兜底 App 入选时需要——它的数据 = 未被别人认领的键）；
 * - includeUnmatched = 兜底 App 是否入选（未匹配任何前缀的键随之入备份）。
 */
export function appBackupFilter(appIds: string[]): CollectBackupFilter {
  const selected = APP_MODULES.filter((a) => appIds.includes(a.id));
  const unselected = APP_MODULES.filter((a) => !appIds.includes(a.id));
  const kvRest = selected.some((a) => a.kvRest);
  const lsRest = selected.some((a) => a.lsRest);

  const stores = new Set<string>(selected.flatMap((a) => a.stores));
  if (selected.some((a) => a.kvPrefixes.length > 0 || a.kvRest)) stores.add('kv');

  return {
    includeStores: [...stores],
    includeKvPrefixes: [...new Set(selected.flatMap((a) => a.kvPrefixes))],
    excludeKvPrefixes: kvRest
      ? [...new Set(unselected.filter((a) => !a.kvRest).flatMap((a) => a.kvPrefixes))]
      : [],
    includeUnmatchedKv: kvRest,
    includeLsPrefixes: [...new Set(selected.flatMap((a) => a.lsPrefixes))],
    excludeLsPrefixes: lsRest
      ? [...new Set(unselected.filter((a) => !a.lsRest).flatMap((a) => a.lsPrefixes))]
      : [],
    includeUnmatchedLs: lsRest,
  };
}

// ---------------- 备份基线（绿 / 灰判定） ----------------

export interface BackupState {
  /** 最近一次备份时间（云端 / 本地导出取较新；从未备份 = 0） */
  lastAt: number;
  lastCloudAt: number;
  lastLocalAt: number;
  /** Supabase 云端助手是否已部署 */
  cloudReady: boolean;
  lastCloudSize?: number;
}

export async function readBackupState(): Promise<BackupState> {
  const [prefs, localAt] = await Promise.all([readBackupPrefs(), Promise.resolve(readLastBackupAt())]);
  const cloudAt = prefs.lastAt;
  return {
    lastAt: Math.max(cloudAt, localAt),
    lastCloudAt: cloudAt,
    lastLocalAt: localAt,
    cloudReady: !!cloudBackupCreds(),
    lastCloudSize: prefs.lastSize,
  };
}

/**
 * 行级备份状态：基线之后没有新数据（或本就无时间字段的 kv 型 App）= 已备份（绿）。
 */
export function isAppSafe(stat: AppStat, state: BackupState): boolean {
  if (state.lastAt <= 0) return false;
  if (stat.lastAt == null) return true;
  return stat.lastAt <= state.lastAt;
}

// ---------------- 容量文案（ASCII 单位，Terminal 风） ----------------

export function formatBytesAscii(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  if (b < 1024) return `${Math.round(b)} B`;
  const kb = b / 1024;
  if (kb < 1024) return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
