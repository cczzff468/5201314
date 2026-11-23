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
 * - 设置里的密文信封（API Key 等）与 kv 里的 secret-box 密文记录（music-api-cfg / music-login）
 *   导出时解密为明文——否则换设备后无法解密（新设备密钥不同），
 *   导入后加载流程会把明文自动重新加密回写（secure-store/secret-box 静默升级语义，跨设备闭环）；
 * - 恢复语义 = 整库快照覆盖：每个 store 先 clear 再写入；localStorage 先 clear 再全量还原。
 *   恢复后需刷新页面（内存缓存/kv 注水层全部重建）。
 *
 * W2-E4 增补（schema 2）：
 * - 字体独立库 ios-phone-fonts（自定义字体 blob）一并入备份（fonts 段）；
 * - 服务端用户数据（Prisma：情侣小家快照等）经 GET/POST /api/backup 纳入 server 段，
 *   接口不可达时仅缺该段、本地全量照常导出（manifest.serverSkipped 标记）；
 * - 导出进度回调（逐 store / 字体 / 服务端计数）；文件名 aiphone-backup-YYYYMMDD-HHmm.json；
 *   手动导出成功把时间记入 localStorage（设置卡片展示「最近备份」）；
 * - 恢复前调用方先 inspectBackupFile 展示各段条数摘要，确认后先自动导出安全备份
 *   （exportBackupToDownload({ safety: true })，独立文件名）再写回。
 */

import { DB_NAME } from './db';
import { decryptValue } from './secure-store';
import { decryptSecret, isEncrypted } from './secret-box';

export const BACKUP_APP = 'ai-phone';
export const BACKUP_SCHEMA = 2;

/** 字体独立库（与 fonts.ts 同名同库；此处自开原始连接，避免把设置 store 依赖链拉进本模块） */
const FONT_DB_NAME = 'ios-phone-fonts';
const FONT_STORE_NAME = 'fonts';
/** 「最近一次备份时间」localStorage 键（手动导出成功时写入；小数据同步读，不入 idb-kv 迁移清单） */
export const BACKUP_LAST_KEY = 'backup-last-export-at';
/** 服务端备份接口（GET 导出 / POST 恢复；不可达时导出仅含本地数据并标记 serverSkipped） */
const SERVER_BACKUP_API = '/api/backup';
/** 服务端备份接口超时（毫秒） */
const SERVER_BACKUP_TIMEOUT_MS = 10_000;

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
  /** 服务端各表行数（server 段存在时） */
  serverCounts?: Record<string, number>;
  /** 服务端数据未能纳入（GET /api/backup 不可达；本地全量照常导出） */
  serverSkipped?: boolean;
}

export interface BackupFile {
  manifest: BackupManifest;
  /** store 名 → 记录数组（Blob 已转包装、settings 密文已解密为明文） */
  data: Record<string, Record<string, unknown>[]>;
  /** localStorage 全量快照（原样字符串） */
  localStorage: Record<string, string>;
  /** 自定义字体独立库（ios-phone-fonts）记录（Blob 已转包装）；schema 2 起恒存在（可为空数组），schema 1 老备份缺省 */
  fonts?: Record<string, unknown>[];
  /** 服务端用户数据（GET /api/backup 原样快照）；接口不可达或老备份时缺省 */
  server?: ServerBackupSection;
}

/** 服务端备份段（/api/backup 的 tables 原样结构） */
export interface ServerBackupTables {
  coupleHome?: unknown[];
  contacts?: unknown[];
  wxBackgrounds?: unknown[];
}

export interface ServerBackupSection {
  tables: ServerBackupTables;
  exportedAt?: string;
}

function openRawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

// ---------------- 字体独立库（ios-phone-fonts） ----------------

/** 打开字体库；forRestore=true 时带 v1 升级回调（全新设备可直接建库建 store，与 fonts.ts 建库逻辑一致） */
function openFontDb(forRestore: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = forRestore ? indexedDB.open(FONT_DB_NAME, 1) : indexedDB.open(FONT_DB_NAME);
    if (forRestore) {
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(FONT_STORE_NAME)) {
          req.result.createObjectStore(FONT_STORE_NAME, { keyPath: 'id' });
        }
      };
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('字体库打开失败'));
  });
}

/** 字体库是否存在：优先 databases() 枚举（避免对不存在的库空开建库）；API 不可用退化为尝试打开 */
async function fontDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === FONT_DB_NAME);
    } catch {
      // 枚举失败 → 退化为尝试打开
    }
  }
  return true;
}

/** 读取字体库全部记录（Blob 深度转包装）；库不存在/读取失败返回空数组，不阻塞主备份 */
async function collectFontRecords(): Promise<Record<string, unknown>[]> {
  if (!(await fontDbExists())) return [];
  try {
    const db = await openFontDb(false);
    try {
      if (!db.objectStoreNames.contains(FONT_STORE_NAME)) return [];
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction(FONT_STORE_NAME, 'readonly');
        const req = tx.objectStore(FONT_STORE_NAME).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as unknown[]);
        req.onerror = () => reject(req.error);
      });
      const out: Record<string, unknown>[] = [];
      for (const raw of rows) {
        try {
          out.push((await deepBlobToTag(raw, 0)) as Record<string, unknown>);
        } catch (err) {
          if (!(err instanceof SkipRecordError)) throw err; // 不可序列化记录跳过
        }
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** 字体库整库快照写回（clear + put，Blob 包装对称还原）；返回写入条数 */
async function restoreFontRecords(rows: Record<string, unknown>[]): Promise<number> {
  const db = await openFontDb(true);
  try {
    let n = 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE_NAME, 'readwrite');
      const os = tx.objectStore(FONT_STORE_NAME);
      os.clear();
      for (const raw of rows) {
        if (raw == null || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).id !== 'string') continue;
        os.put(deepTagToBlob(raw, 0) as unknown);
        n++;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('字体写入被中断'));
      tx.onerror = () => reject(tx.error ?? new Error('字体写入失败'));
    });
    return n;
  } finally {
    db.close();
  }
}

// ---------------- 服务端数据段（/api/backup） ----------------

/** 拉取服务端用户数据（情侣小家等）；失败/超时/结构异常返回 null（导出继续，仅缺该段） */
async function fetchServerBackup(): Promise<ServerBackupSection | null> {
  if (typeof window === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), SERVER_BACKUP_TIMEOUT_MS);
    try {
      const res = await window.fetch(SERVER_BACKUP_API, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as { ok?: boolean; exportedAt?: string; tables?: ServerBackupTables };
      if (!json || json.ok !== true || !json.tables || typeof json.tables !== 'object') return null;
      return { tables: json.tables, exportedAt: json.exportedAt };
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** 服务端段回写（键冲突以备份为准覆盖）；失败返回错误信息（不回滚已完成的本地恢复） */
async function postServerRestore(server: ServerBackupSection): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: '浏览器环境不可用' };
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), SERVER_BACKUP_TIMEOUT_MS);
    try {
      const res = await window.fetch(SERVER_BACKUP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: server.tables }),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!json || json.ok !== true) return { ok: false, error: '服务端写入失败' };
      return { ok: true };
    } finally {
      window.clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络错误' };
  }
}

/** 服务端各表行数（manifest.serverCounts 用） */
function serverTableCounts(server: ServerBackupSection): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, rows] of Object.entries(server.tables)) {
    if (Array.isArray(rows)) out[name] = rows.length;
  }
  return out;
}

/**
 * 收集全量备份内容（原始 keyPath：kv/settings 用 key，其余用 id——写入时记录自带 keyPath 字段）：
 * 主库逐 store 分库读取（不整库一把抓，控内存）→ 字体独立库 → 服务端表 → localStorage 快照。
 * onProgress 逐段回报（done/total，total = 主库 store 数 + 字体 + 服务端共 2 段）。
 */
export async function collectBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<BackupFile> {
  const db = await openRawDb();
  try {
    const storeNames = [...db.objectStoreNames];
    const total = storeNames.length + 2;
    const data: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    onProgress?.(0, total);

    for (let si = 0; si < storeNames.length; si++) {
      const store = storeNames[si];
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
          // kv 密文记录（music-api-cfg / music-login 等 secret-box `enc:v1:` 串）→ 同样解密为明文导出：
          // 密文绑设备种子（localStorage ios-kv-seed），换设备后种子不一致即成解不开的死数据；
          // 与上方 settings 信封先例同一考量——导出明文，导入落明文，各模块加载读到明文后
          // 自愈回写加密（secret-box 静默升级语义，跨设备闭环）。
          // 识别方式：按密文形态探测（enc:v1: 前缀 + 两段结构）而非硬编码键名清单——
          // secret-box 是全库唯一密文生产者，今后新增的加密 kv 键自动被覆盖，本文件零维护。
          // 解密失败（密文损坏）原样退回密文串，导入侧按「无配置」兜底，行为与旧版一致。
          if (store === 'kv' && rec && typeof rec.value === 'string' && isEncrypted(rec.value)) {
            rec = { ...rec, value: await decryptSecret(rec.value) };
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
      onProgress?.(si + 1, total);
    }

    // 字体独立库（ios-phone-fonts）：存在才读，读失败不阻塞主备份
    const fonts = await collectFontRecords();
    counts.fonts = fonts.length;
    onProgress?.(storeNames.length + 1, total);

    // 服务端用户数据（情侣小家等 Prisma 表）：接口不可达时跳过该段，本地全量照常导出
    const server = await fetchServerBackup();
    onProgress?.(storeNames.length + 2, total);

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
        serverCounts: server ? serverTableCounts(server) : undefined,
        serverSkipped: server ? undefined : true,
      },
      data,
      localStorage: ls,
      fonts,
      ...(server ? { server } : {}),
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
  /** 服务端数据未能纳入（GET /api/backup 不可达；本地全量照常导出） */
  serverSkipped: boolean;
}

/**
 * 收集全量数据 → 下载 JSON 文件（aiphone-backup-YYYYMMDD-HHmm.json），返回摘要：
 * - onProgress：导出进度回调（done/total 段计数）；
 * - safety：恢复前的安全备份调用（独立文件名 aiphone-backup-safety-YYYYMMDD-HHmmss.json，
 *   不计入「最近备份时间」——那是用户手动导出的语义）。
 */
export async function exportBackupToDownload(opts?: {
  safety?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<BackupDownloadResult> {
  const backup = await collectBackup(opts?.onProgress);
  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const filename = opts?.safety
    ? `aiphone-backup-safety-${stamp}${pad(d.getSeconds())}.json`
    : `aiphone-backup-${stamp}.json`;

  // v2.4.3 APP 内下载根修（机主实测「导出备份无法下载」）：Android WebView 里
  // blob: URL 的 <a download> 点击静默失败（不触发 DownloadListener）——原生壳里
  // 改走原生 saveBase64Download（MediaStore 写入公共下载目录 + Toast 告知位置），
  // 失败再回退浏览器下载链路。
  let nativeSaved = false;
  try {
    const { isNativePerception, nativeSaveBase64Download } = await import('./native-perception');
    if (isNativePerception()) {
      // Blob → base64（分块读取，几 MB 备份也安全）
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          try {
            resolve(String(fr.result ?? ''));
          } catch (e) {
            reject(e);
          }
        };
        fr.onerror = () => reject(fr.error ?? new Error('Blob 读取失败'));
        fr.readAsDataURL(blob);
      });
      const r = await nativeSaveBase64Download(filename, b64, 'application/json');
      nativeSaved = r.ok;
    }
  } catch {
    /* 原生通道失败：回退浏览器下载 */
  }

  if (!nativeSaved) {
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
  }
  if (!opts?.safety) {
    // 手动导出成功 → 记录「最近一次备份时间」（localStorage；随备份文件一起迁移）
    try {
      window.localStorage.setItem(BACKUP_LAST_KEY, backup.manifest.exportedAt);
    } catch {
      // localStorage 不可用（隐私模式）忽略
    }
  }
  const records = Object.values(backup.manifest.counts).reduce((s, n) => s + n, 0);
  return {
    bytes: blob.size,
    records,
    stores: Object.keys(backup.data).length,
    filename,
    serverSkipped: backup.manifest.serverSkipped === true,
  };
}

/** 读取「最近一次备份时间」的展示文案（YYYY-MM-DD HH:mm）；从未备份/不可读返回 null */
export function readLastBackupTime(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BACKUP_LAST_KEY);
    if (!raw) return null;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return null;
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return null;
  }
}

export interface RestoreResult {
  stores: number;
  records: number;
  lsKeys: number;
  /** 备份里存在但当前数据库没有的 store（版本较新的备份），已跳过 */
  skippedStores: string[];
  /** 恢复的自定义字体条数（schema 1 老备份无字体段 = 0） */
  fonts: number;
  /** 服务端数据段恢复结果（备份无该段时 attempted=false；失败不阻塞本地恢复） */
  server: { attempted: boolean; ok: boolean; error?: string };
}

/** 解析并校验备份文件（JSON → manifest/结构合法性）；坏文件抛出带明确文案的错误 */
async function parseBackupFile(file: File): Promise<BackupFile> {
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
  if (backup.localStorage != null && typeof backup.localStorage !== 'object') {
    throw new Error('备份文件结构损坏（localStorage 段无效）');
  }
  if (backup.fonts != null && !Array.isArray(backup.fonts)) {
    throw new Error('备份文件结构损坏（fonts 段无效）');
  }
  return backup as BackupFile;
}

export interface BackupInspect {
  /** 备份导出时间（ISO 字符串） */
  exportedAt: string;
  schema: number;
  /** IDB 记录总数（主库各 store + 字体库） */
  records: number;
  lsKeys: number;
  /** 是否含服务端数据段 */
  server: boolean;
  /** 确认条用一行摘要（各段条数） */
  summary: string;
}

/** 各段友好名（确认摘要用；未列出的 store 原样显示库名） */
const STORE_LABELS: Record<string, string> = {
  kv: '聊天/记忆等',
  contacts: '联系人',
  photos: '照片',
  recordings: '录音',
  music: '音乐',
  notes: '备忘录',
  events: '日程',
  alarms: '闹钟',
  reminders: '提醒事项',
  cities: '世界时钟',
  'chat-sessions': 'AI 会话',
  'chat-messages': 'AI 消息',
  'call-logs': '通话记录',
  voicemails: '语音留言',
  albums: '相册',
  visionDecisions: '视觉决策',
  settings: '系统设置',
  ringtones: '自定义铃声',
  fonts: '自定义字体',
};

/** 备份摘要一行文案（各段条数；空段跳过） */
function buildBackupSummary(backup: BackupFile): string {
  const parts: string[] = [];
  const counts = (backup.manifest.counts ?? {}) as Record<string, number>;
  const entries = Object.entries(counts).filter(([, n]) => typeof n === 'number' && n > 0);
  if (entries.length > 0) {
    parts.push(entries.map(([store, n]) => `${STORE_LABELS[store] ?? store} ${n}`).join(' · '));
  }
  const lsKeys = backup.manifest.lsKeys ?? 0;
  if (lsKeys > 0) parts.push(`本地设置 ${lsKeys} 项`);
  if (backup.server && backup.server.tables && typeof backup.server.tables === 'object') {
    const tableNames = Object.entries(backup.server.tables)
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .map(([name]) => name);
    if (tableNames.length > 0) parts.push(`服务端数据 ${tableNames.length} 张表`);
  }
  return parts.length > 0 ? parts.join('；') : '（空备份）';
}

/** 预检备份文件：校验合法性并生成各段条数摘要（恢复前「将恢复什么」展示用）；坏文件抛出明确错误 */
export async function inspectBackupFile(file: File): Promise<BackupInspect> {
  const backup = await parseBackupFile(file);
  const counts = (backup.manifest.counts ?? {}) as Record<string, number>;
  const records = Object.values(counts).reduce((s, n) => (typeof n === 'number' ? s + n : s), 0);
  return {
    exportedAt: backup.manifest.exportedAt,
    schema: backup.manifest.schema ?? 1,
    records,
    lsKeys: backup.manifest.lsKeys ?? 0,
    server: backup.server != null && backup.server.tables != null,
    summary: buildBackupSummary(backup),
  };
}

/**
 * 从备份文件整库恢复（快照覆盖）：
 * - 每个 store：clear → 分块写入（Blob 包装还原）
 * - 字体独立库（fonts 段存在时）：clear → 全量写回
 * - localStorage：clear → 全量还原
 * - 服务端段（存在时）：POST /api/backup 以备份为准 upsert 回写，失败仅带警告
 * 完成后由调用方刷新页面。
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const backup = await parseBackupFile(file);

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
      // 恢复后把「最近备份」对齐到该备份的导出时间（备份文件即用户手里最新的备份，
      // 早于备份时间落盘的 backup-last-export-at 不在快照里，不补会误显示「尚未备份」）
      try {
        window.localStorage.setItem(BACKUP_LAST_KEY, backup.manifest.exportedAt);
      } catch {
        // localStorage 不可用（隐私模式）忽略
      }
    } catch {
      // localStorage 不可用（隐私模式）：IndexedDB 已恢复
    }
  } finally {
    db.close();
  }

  // 字体独立库：fonts 段存在（schema 2+）才整库快照覆盖；schema 1 老备份不动字体
  let fonts = 0;
  if (Array.isArray(backup.fonts)) {
    fonts = await restoreFontRecords(backup.fonts);
  }

  // 服务端数据段：存在才回写；失败不回滚本地恢复，仅作为警告带回
  let server: RestoreResult['server'] = { attempted: false, ok: false };
  if (backup.server && backup.server.tables && typeof backup.server.tables === 'object') {
    const r = await postServerRestore(backup.server);
    server = { attempted: true, ok: r.ok, error: r.error };
  }

  return {
    stores: storeCount(backup.data) - skippedStores.length,
    records,
    lsKeys: backup.manifest.lsKeys ?? 0,
    skippedStores,
    fonts,
    server,
  };
}

function storeCount(data: Record<string, unknown[]>): number {
  return Object.keys(data).length;
}
