'use client';

/**
 * 全量备份 / 恢复（设置 › 存储 › 备份与恢复）：
 *
 * 数据全景：
 * - IndexedDB `ios-phone-db`（18 个 store）：聊天/联系人/记忆/朋友圈/钱包/表情包（kv）、
 *   照片/录音/音乐/铃声（Blob 媒体）、相册/视觉决策（dataURL 字符串）、设置等 —— 本体；
 * - localStorage 残量：会话标记、未读角标、各类小开关/计数（小数据同步首帧读，保留项）。
 *
 * 导出形态：单 JSON 文件（manifest + data + localStorage），浏览器直接下载。
 *
 * 关键处理：
 * - Blob 深度转换：照片/录音/音乐/铃声本体、语音消息 blob、自定义锁屏壁纸（settings.value.customBlob）
 *   都是 Blob（含嵌在 kv 数组里的深层字段）——Blob 无法 JSON 序列化，导出时全深度递归转
 *   { __aiPhoneBlob, dataUrl } 包装，导入时对称还原 Blob；
 * - cryptoKey（AES-GCM 非可提取密钥）无法导出且绑设备：导出时跳过该记录；
 * - 设置里的密文信封（API Key 等）导出时解密为明文——否则换设备后无法解密（新设备密钥不同），
 *   导入后加载流程会把含 apiKey 的明文自动重新加密回写（secure-store 静默升级语义，跨设备闭环）；
 * - 恢复语义 = 整库快照覆盖：每个 store 先 clear 再写入；localStorage 先 clear 再全量还原。
 *   恢复后需刷新页面（内存缓存/kv 注水层全部重建）。
 */

import { DB_NAME } from './db';
import { decryptValue } from './secure-store';

export const BACKUP_APP = 'ai-phone';
export const BACKUP_SCHEMA = 1;

/** Blob 深度转换包装（导入按此还原，避免把合法的 dataURL 字符串误转成 Blob） */
interface BlobTag {
  __aiPhoneBlob: true;
  dataUrl: string;
}

function isBlobTag(v: unknown): v is BlobTag {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as BlobTag).__aiPhoneBlob === true &&
    typeof (v as BlobTag).dataUrl === 'string'
  );
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('Blob 读取失败'));
    fr.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) throw new Error('非 dataURL');
  const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const WALK_DEPTH_CAP = 12;

/**
 * 深度递归把 Blob 转成 BlobTag 包装（JSON 可序列化）。
 * 遇到 CryptoKey 抛出（调用方跳过整条记录——密钥既无法序列化也不该离开设备）。
 */
async function deepBlobToTag(v: unknown, depth: number): Promise<unknown> {
  if (depth > WALK_DEPTH_CAP) return null;
  if (v == null) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Blob) return { __aiPhoneBlob: true, dataUrl: await blobToDataURL(v) };
  if (typeof CryptoKey !== 'undefined' && v instanceof CryptoKey) {
    throw new SkipRecordError();
  }
  if (Array.isArray(v)) {
    const out: unknown[] = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = await deepBlobToTag(v[i], depth + 1);
    return out;
  }
  if (typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      out[k] = await deepBlobToTag(src[k], depth + 1);
    }
    return out;
  }
  return null; // 函数等不可序列化值 → null
}

/** 深度递归把 BlobTag 包装还原为 Blob（对称） */
function deepTagToBlob(v: unknown, depth: number): unknown {
  if (depth > WALK_DEPTH_CAP || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => deepTagToBlob(x, depth + 1));
  if (typeof v === 'object') {
    if (isBlobTag(v)) return dataURLToBlob(v.dataUrl);
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) out[k] = deepTagToBlob(src[k], depth + 1);
    return out;
  }
  return v;
}

class SkipRecordError extends Error {
  constructor() {
    super('skip');
  }
}

export interface BackupManifest {
  app: string;
  schema: number;
  exportedAt: string;
  dbVersion: number;
  counts: Record<string, number>;
  skipped: Record<string, number>;
  lsKeys: number;
}

export interface BackupFile {
  manifest: BackupManifest;
  /** store 名 → 记录数组（Blob 已转包装、settings 密文已解密为明文） */
  data: Record<string, Record<string, unknown>[]>;
  /** localStorage 全量快照（原样字符串） */
  localStorage: Record<string, string>;
}

function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

/** 原始 keyPath（kv/settings 用 key，其余用 id）——写入时记录自带 keyPath 字段，无需额外处理 */
export async function collectBackup(): Promise<BackupFile> {
  const db = await openRawDb();
  try {
    const storeNames = [...db.objectStoreNames];
    const data: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    const skipped: Record<string, number> = {};

    for (const store of storeNames) {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const allReq = os.getAll();
      await new Promise<void>((resolve, reject) => {
        allReq.onsuccess = () => resolve();
        allReq.onerror = () => reject(allReq.error);
      });
      const rows = (allReq.result ?? []) as unknown[];
      const exported: Record<string, unknown>[] = [];
      let skip = 0;
      for (const raw of rows) {
        try {
          let rec = raw as Record<string, unknown>;
          // settings 密文信封 → 解密为明文（跨设备可恢复；导入后加载流程自动重新加密）
          if (store === 'settings' && rec && typeof rec.value === 'object' && rec.value !== null) {
            const dec = await decryptValue(rec.value);
            if (dec !== null) rec = { ...rec, value: dec as unknown };
          }
          exported.push((await deepBlobToTag(rec, 0)) as Record<string, unknown>);
        } catch (err) {
          if (err instanceof SkipRecordError) {
            skip++;
            continue;
          }
          throw err;
        }
      }
      if (store === 'settings') {
        // cryptoKey 已在上方被 SkipRecordError 跳过，防御性再滤一道
        data[store] = exported.filter((r) => r && r.key !== 'cryptoKey');
      } else {
        data[store] = exported;
      }
      counts[store] = data[store].length;
      if (skip > 0) skipped[store] = skip;
    }

    const ls: Record<string, string> = {};
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k == null) continue;
        ls[k] = window.localStorage.getItem(k) ?? '';
      }
    } catch {
      // 隐私模式等读不到：备份仅含 IndexedDB
    }

    return {
      manifest: {
        app: BACKUP_APP,
        schema: BACKUP_SCHEMA,
        exportedAt: new Date().toISOString(),
        dbVersion: db.version,
        counts,
        skipped,
        lsKeys: Object.keys(ls).length,
      },
      data,
      localStorage: ls,
    };
  } finally {
    db.close();
  }
}

export interface BackupDownloadResult {
  bytes: number;
  records: number;
  stores: number;
  filename: string;
}

/** 收集全量数据 → 下载 JSON 文件，返回摘要 */
export async function exportBackupToDownload(): Promise<BackupDownloadResult> {
  const backup = await collectBackup();
  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `AI手机备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 延迟回收：Safari 在 click 同帧回收会导致下载取消
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  const records = Object.values(backup.manifest.counts).reduce((s, n) => s + n, 0);
  return {
    bytes: blob.size,
    records,
    stores: Object.keys(backup.data).length,
    filename,
  };
}

export interface RestoreResult {
  stores: number;
  records: number;
  lsKeys: number;
  /** 备份里存在但当前数据库没有的 store（版本较新的备份），已跳过 */
  skippedStores: string[];
}

/**
 * 从备份文件整库恢复（快照覆盖）：
 * - 每个 store：clear → 分块写入（Blob 包装还原）
 * - localStorage：clear → 全量还原
 * 完成后由调用方刷新页面。
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON 备份');
  }
  const backup = parsed as Partial<BackupFile> | null;
  if (!backup || !backup.manifest || backup.manifest.app !== BACKUP_APP || typeof backup.data !== 'object' || backup.data === null) {
    throw new Error('这不是本应用的备份文件（manifest 校验失败）');
  }
  if ((backup.manifest.schema ?? 0) > BACKUP_SCHEMA) {
    throw new Error('备份文件来自更新版本的应用，请先更新网站再恢复');
  }

  const db = await openRawDb();
  const skippedStores: string[] = [];
  let records = 0;
  try {
    const storeNames = Object.keys(backup.data);
    for (const store of storeNames) {
      const rows = backup.data[store];
      if (!Array.isArray(rows)) continue;
      if (![...db.objectStoreNames].includes(store)) {
        skippedStores.push(store);
        continue;
      }
      // 分块事务：整库大事务可能超内存/自动提交边界，150 条一块稳
      const CHUNK = 150;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        if (i === 0) os.clear();
        for (const raw of chunk) {
          if (raw == null || typeof raw !== 'object') continue;
          if (store === 'settings' && (raw as Record<string, unknown>).key === 'cryptoKey') continue;
          os.put(deepTagToBlob(raw, 0) as unknown);
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error('写入中断'));
          tx.onerror = () => reject(tx.error ?? new Error('写入失败'));
        });
        records += chunk.length;
      }
    }

    try {
      window.localStorage.clear();
      const ls = backup.localStorage;
      if (ls && typeof ls === 'object') {
        for (const [k, v] of Object.entries(ls)) {
          try {
            window.localStorage.setItem(k, String(v));
          } catch {
            // 单键失败不阻塞
          }
        }
      }
    } catch {
      // localStorage 不可用（隐私模式）：IndexedDB 已恢复
    }
  } finally {
    db.close();
  }

  return {
    stores: storeCount(backup.data) - skippedStores.length,
    records,
    lsKeys: backup.manifest.lsKeys ?? 0,
    skippedStores,
  };
}

function storeCount(data: Record<string, unknown[]>): number {
  return Object.keys(data).length;
}
