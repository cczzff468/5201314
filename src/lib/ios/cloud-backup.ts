'use client';

/**
 * 云备份与恢复（第四十二轮机主规格全链落地）：
 * 数据结构 —— Supabase `backups` 表存备份记录 + `avatar_bucket` / `image_bucket` 两
 * Storage 桶存二进制（头像 / 自定义壁纸与图标）；备份 JSON 本体走 image_bucket/
 * backups/。全部经 /api/cloud-deploy/supabase 同源代理（浏览器 CORS + 密钥不落服务器）。
 *
 * 备份内容：聊天记录（chat-sessions/chat-messages）、记忆库、联系人配置、世界书、
 * 论坛数据等 —— 统一按「IndexedDB 全库 dump（照片/录音/音乐/铃声四个大二进制仓除外）」
 * 采集：settings / kv / contacts / notes / events / reminders / call-logs / voicemails /
 * alarms / cities / albums / visionDecisions。Blob 值（自定义壁纸/图标/联系人头像）上传
 * Storage 桶后在 JSON 里留引用（__coveBlob），恢复时取回重建。
 *
 * 安全口径：设备本地加密的密文（enc:v1 前缀：API key / 云端凭证）与已知密钥记录
 * （apiConfig / wx-cloud-state 等）不入备份 —— 跨设备密文解不开且避免密钥外送；
 * 恢复后需重填 API 配置。
 *
 * 自动备份：maybeAutoBackup()（设置页开关 + 频率）由 startAutoBackupWatcher() 驱动 ——
 * ① visibilitychange（App 退后台时机，机主规格原文）② 30 分钟兜底轮询；超期静默执行。
 *
 * 恢复：downloadBackup → 解析 → Blob 引用取回 → 写回 IndexedDB（数据仓先清后放；
 * settings/kv 逐键 upsert 不清仓，本地独有键保留）。二次确认在设置 UI 层（防误触）。
 */

import { localDB, type IOSStoreName } from './db';
import { wxCloudSnapshot } from './wx-cloud/store';
import { APP_VERSION } from '@/lib/app-version';

// ---------------- 凭证 ----------------

export interface CloudBackupCreds {
  ref: string;
  token: string;
  serviceKey: string;
  projectUrl: string;
}

/** 云备份可用性：已按 Supabase 平台部署（含项目 ref / Access Token / service key） */
export function cloudBackupCreds(): CloudBackupCreds | null {
  const st = wxCloudSnapshot();
  const supa = st.platform === 'supabase' ? st.supabase : null;
  if (!supa || !supa.deployedAt) return null;
  if (!supa.ref || !supa.token || !supa.serviceKey) return null;
  return { ref: supa.ref, token: supa.token, serviceKey: supa.serviceKey, projectUrl: supa.projectUrl };
}

/** 同源代理调用（密钥每次请求透传，服务端不留存） */
async function callBackupApi(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; message?: string; [k: string]: unknown }> {
  try {
    const r = await fetch('/api/cloud-deploy/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string; [k: string]: unknown } | null;
    if (!r.ok || !j || j.ok !== true) {
      return { ok: false, error: j?.error ?? `HTTP ${r.status}`, message: j?.message ?? '' };
    }
    return j as { ok: boolean; [k: string]: unknown };
  } catch (e) {
    return { ok: false, error: 'network', message: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

// ---------------- 备份范围与安全口径 ----------------

/** 入备份的 IndexedDB 仓（照片/录音/音乐/铃声四个大二进制仓不入——体积失控； kv 内含记忆/世界书/论坛/朋友圈） */
const BACKUP_STORES: IOSStoreName[] = [
  'chat-sessions',
  'chat-messages',
  'contacts',
  'kv',
  'settings',
  'notes',
  'events',
  'reminders',
  'call-logs',
  'voicemails',
  'alarms',
  'cities',
  'albums',
  'visionDecisions',
];

/** settings 仓不外送的键（API 配置/云端凭证——密文跨设备解不开且避免密钥外送） */
const SETTINGS_KEY_DENY = new Set([
  'apiConfig',
  'apiFallbacks',
  'visionConfig',
  'visionPresets',
  'ttsConfig',
  'sttConfig',
  'imgGenConfig',
  'imgGenPresets',
]);
/** kv 仓不外送的键（wx-cloud-state 含 service key / 管理 token） */
const KV_KEY_DENY = new Set(['wx-cloud-state']);

/** 密文值判定（enc:v1 前缀 = 设备本地种子加密，跨设备不可解） */
function isEncryptedValue(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('enc:v1:');
}

// ---------------- 采集（Blob 引用化） ----------------

/** JSON 里的 Blob 引用标记（恢复时取回重建二进制） */
interface BlobRef {
  __coveBlob: string; // storage 全路径 bucket/rest
}

interface PendingBlob {
  path: string; // bucket 内路径
  bucket: 'avatar_bucket' | 'image_bucket';
  contentType: string;
  blob: Blob;
}

/** 联系人头像 → avatar_bucket；其余（壁纸/自定义图标等）→ image_bucket（机主规格语义） */
function bucketOf(store: string): 'avatar_bucket' | 'image_bucket' {
  return store === 'contacts' ? 'avatar_bucket' : 'image_bucket';
}

function recordKeyOf(store: string, rec: Record<string, unknown>): string {
  const k = store === 'settings' || store === 'kv' ? rec['key'] : rec['id'];
  return String(k ?? 'unknown').replace(/[^a-z0-9_.\-]/gi, '_').slice(0, 60);
}

/** 深度遍历：克隆值（Blob → 引用标记；密文值 → 剔除标记），收集待上传 Blob 列表 */
function walkValue(
  v: unknown,
  store: string,
  key: string,
  ts: number,
  blobs: PendingBlob[],
): unknown {
  if (typeof v === 'string' && isEncryptedValue(v)) return { __coveSkip: 'encrypted' };
  if (typeof Blob !== 'undefined' && v instanceof Blob) {
    const bucket = bucketOf(store);
    const ext = (v.type.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8);
    const path = `assets/${ts}/${store}/${key}-${blobs.length}.${ext}`;
    blobs.push({ path, bucket, contentType: v.type || 'application/octet-stream', blob: v });
    const ref: BlobRef = { __coveBlob: `${bucket}/${path}` };
    return ref;
  }
  if (Array.isArray(v)) return v.map((x, i) => walkValue(x, store, `${key}-${i}`, ts, blobs));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walkValue(val, store, `${key}.${k}`, ts, blobs);
    }
    return out;
  }
  return v;
}

/** 采集全库 → { json, blobs, sections } */
async function collectBackup(): Promise<{ json: string; blobs: PendingBlob[]; sections: string }> {
  const ts = Date.now();
  const blobs: PendingBlob[] = [];
  const data: Record<string, unknown[]> = {};
  const stats: string[] = [];
  for (const store of BACKUP_STORES) {
    let records: Record<string, unknown>[] = [];
    try {
      records = (await localDB.getAll(store as never)) as unknown as Record<string, unknown>[];
    } catch {
      records = [];
    }
    const kept: unknown[] = [];
    for (const rec of records ?? []) {
      if (store === 'settings' && SETTINGS_KEY_DENY.has(String(rec['key']))) continue;
      if (store === 'kv' && KV_KEY_DENY.has(String(rec['key']))) continue;
      kept.push(walkValue(rec, store, recordKeyOf(store, rec), ts, blobs));
    }
    data[store] = kept;
    if (kept.length > 0) {
      stats.push(
        store === 'kv'
          ? `记忆/世界书/论坛等 ${kept.length} 键`
          : store === 'chat-messages'
            ? `聊天 ${kept.length} 条`
            : `${store} ${kept.length}`,
      );
    }
  }
  const json = JSON.stringify({ __coveBackup: 1, version: 1, createdAt: new Date(ts).toISOString(), stores: data });
  return { json, blobs, sections: stats.slice(0, 6).join(' · ') };
}

// ---------------- Blob base64 ----------------

async function blobToB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// ---------------- 备份 / 恢复 / 列表 ----------------

export interface BackupRow {
  id: string;
  created_at: string;
  kind: 'manual' | 'auto' | string;
  size_bytes: number;
  storage_path: string | null;
  device: string | null;
  app_version: string | null;
  sections: string | null;
}

export interface BackupResult {
  ok: boolean;
  error?: string;
  message?: string;
  at?: number;
  size?: number;
  kind?: 'manual' | 'auto';
  sections?: string;
}

/** 云端初始化（幂等）：backups/messages 表 + 两桶 + Realtime 发布 */
export async function ensureCloudBackupSetup(creds: CloudBackupCreds): Promise<{ ok: boolean; message?: string }> {
  const r = await callBackupApi({ op: 'backup-setup', token: creds.token, ref: creds.ref });
  return { ok: r.ok, message: r.message };
}

/** 立即备份（手动/自动共用；kind 进备份记录分类） */
export async function runBackup(kind: 'manual' | 'auto' = 'manual'): Promise<BackupResult> {
  const creds = cloudBackupCreds();
  if (!creds) return { ok: false, error: 'not_configured', message: '还没部署云端助手：先在本页完成 Supabase 一键部署' };
  try {
    // ① 采集
    const { json, blobs, sections } = await collectBackup();
    // ② Blob 上传（头像 → avatar_bucket / 背景图等 → image_bucket）
    for (const b of blobs) {
      const b64 = await blobToB64(b.blob);
      const r = await callBackupApi({
        op: 'backup-blob',
        token: creds.token,
        ref: creds.ref,
        serviceKey: creds.serviceKey,
        bucket: b.bucket,
        path: b.path,
        contentType: b.contentType,
        content: b64,
      });
      if (!r.ok) return { ok: false, error: 'blob_failed', message: `文件上传失败：${r.message ?? r.error}` };
    }
    // ③ JSON 本体 + 记录行
    const r = await callBackupApi({
      op: 'backup-save',
      token: creds.token,
      ref: creds.ref,
      serviceKey: creds.serviceKey,
      payload: json,
      backupKind: kind,
      device: deviceLabel(),
      appVersion: APP_VERSION,
      sections,
    });
    if (!r.ok) return { ok: false, error: 'save_failed', message: r.message ?? r.error };
    const at = Date.now();
    const size = typeof r['size'] === 'number' ? (r['size'] as number) : json.length;
    const storagePath = typeof r['storage_path'] === 'string' ? (r['storage_path'] as string) : '';
    await localDB.put('settings', { key: 'cloudBackupLast', value: { at, size, kind, storagePath, sections } });
    return { ok: true, at, size, kind, sections };
  } catch (e) {
    return { ok: false, error: 'exception', message: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

function deviceLabel(): string {
  try {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return '安卓真机';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    return '浏览器';
  } catch {
    return '';
  }
}

/** 云端备份列表（最近 20 条） */
export async function listBackups(): Promise<{ ok: boolean; rows?: BackupRow[]; message?: string }> {
  const creds = cloudBackupCreds();
  if (!creds) return { ok: false, message: '还没部署云端助手' };
  const r = await callBackupApi({
    op: 'backup-list',
    token: creds.token,
    ref: creds.ref,
    serviceKey: creds.serviceKey,
  });
  if (!r.ok) return { ok: false, message: r.message ?? r.error };
  return { ok: true, rows: (r['rows'] as BackupRow[]) ?? [] };
}

/** 下载备份 JSON 并解析 */
async function downloadBackup(creds: CloudBackupCreds, storagePath: string): Promise<{ stores: Record<string, unknown[]> } | null> {
  try {
    const r = await fetch('/api/cloud-deploy/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'backup-download', token: creds.token, ref: creds.ref, serviceKey: creds.serviceKey, storagePath }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return null;
    const parsed = (await r.json().catch(() => null)) as { stores?: Record<string, unknown[]> } | null;
    if (!parsed || !parsed.stores) return null;
    return parsed as { stores: Record<string, unknown[]> };
  } catch {
    return null;
  }
}

/** 取回 Blob 引用的二进制（恢复期重建） */
async function fetchBlobRef(creds: CloudBackupCreds, ref: string): Promise<Blob | null> {
  try {
    const r = await fetch('/api/cloud-deploy/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'backup-download', token: creds.token, ref: creds.ref, serviceKey: creds.serviceKey, storagePath: ref }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

/** 恢复到本地（覆盖）：数据仓先清后放；settings/kv 逐键 upsert（本地独有键保留） */
export async function restoreBackup(row: BackupRow): Promise<BackupResult> {
  const creds = cloudBackupCreds();
  if (!creds) return { ok: false, message: '还没部署云端助手' };
  if (!row.storage_path) return { ok: false, message: '这条备份没有云端文件' };
  try {
    const parsed = await downloadBackup(creds, row.storage_path);
    if (!parsed) return { ok: false, message: '备份下载失败：文件不存在或密钥无读取权限' };
    // Blob 引用表收集 + 预取
    const blobCache = new Map<string, Blob>();
    const collectRefs = (v: unknown): void => {
      if (v && typeof v === 'object') {
        const rec = v as Record<string, unknown>;
        if (typeof rec['__coveBlob'] === 'string') {
          const p = rec['__coveBlob'] as string;
          if (!blobCache.has(p)) blobCache.set(p, null as unknown as Blob);
        }
        for (const val of Object.values(rec)) collectRefs(val);
      } else if (Array.isArray(v)) {
        v.forEach(collectRefs);
      }
    };
    for (const recs of Object.values(parsed.stores)) (recs ?? []).forEach(collectRefs);
    const paths = [...blobCache.keys()];
    for (const p of paths) {
      const blob = await fetchBlobRef(creds, p);
      if (blob) blobCache.set(p, blob);
    }
    // 重建值（__coveBlob → Blob；__coveSkip 密文 → 原样占位 null）
    const rebuild = (v: unknown): unknown => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        if (typeof rec['__coveBlob'] === 'string') {
          return blobCache.get(rec['__coveBlob'] as string) ?? null;
        }
        if (rec['__coveSkip'] === 'encrypted') return null;
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(rec)) out[k] = rebuild(val);
        return out;
      }
      if (Array.isArray(v)) return v.map(rebuild);
      return v;
    };
    // 写回
    let restored = 0;
    for (const [store, recs] of Object.entries(parsed.stores)) {
      if (!BACKUP_STORES.includes(store as IOSStoreName)) continue;
      const list = (recs ?? []).map((x) => rebuild(x) as Record<string, unknown>);
      if (store === 'settings' || store === 'kv') {
        for (const rec of list) {
          if (rec == null) continue;
          await localDB.put(store as never, rec as never);
          restored += 1;
        }
      } else {
        await localDB.clear(store as never);
        for (const rec of list) {
          if (rec == null) continue;
          await localDB.put(store as never, rec as never);
          restored += 1;
        }
      }
    }
    return { ok: true, size: row.size_bytes, sections: `已恢复 ${restored} 条记录` };
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

/** 删除一条云端备份（记录行 + Storage 文件，幂等） */
export async function deleteBackup(row: BackupRow): Promise<{ ok: boolean; message?: string }> {
  const creds = cloudBackupCreds();
  if (!creds) return { ok: false, message: '还没部署云端助手' };
  const r = await callBackupApi({
    op: 'backup-delete',
    token: creds.token,
    ref: creds.ref,
    serviceKey: creds.serviceKey,
    backupId: row.id,
    storagePath: row.storage_path ?? '',
  });
  return { ok: r.ok, message: r.message };
}

// ---------------- 自动备份（机主规格：进后台/定时检查 + 超期静默执行） ----------------

export interface CloudBackupPrefs {
  auto: boolean;
  /** 备份间隔：6h/12h（机主要求的小时级）/daily/weekly */
  freq: '6h' | '12h' | 'daily' | 'weekly';
  /** 云端保留份数：超出后最旧的自动删除（runBackup 后 pruneBackups 执行） */
  keep: number;
  lastAt: number;
  lastSize?: number;
  lastKind?: string;
}

const FREQ_INTERVALS: Record<CloudBackupPrefs['freq'], number> = {
  '6h': 6 * 3600_000,
  '12h': 12 * 3600_000,
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
};

const FREQ_LEGACY = new Set<string>(['6h', '12h', 'daily', 'weekly']);

export async function readBackupPrefs(): Promise<CloudBackupPrefs> {
  try {
    const [autoRec, freqRec, keepRec, lastRec] = await Promise.all([
      localDB.get('settings', 'cloudBackupAuto'),
      localDB.get('settings', 'cloudBackupFreq'),
      localDB.get('settings', 'cloudBackupKeep'),
      localDB.get('settings', 'cloudBackupLast'),
    ]);
    const last = (lastRec?.value ?? null) as { at?: unknown; size?: unknown; kind?: unknown } | null;
    const freqRaw = String(freqRec?.value ?? '');
    return {
      auto: autoRec?.value === true,
      freq: FREQ_LEGACY.has(freqRaw) ? (freqRaw as CloudBackupPrefs['freq']) : 'daily',
      keep: typeof keepRec?.value === 'number' && keepRec.value >= 1 ? keepRec.value : 3,
      lastAt: typeof last?.at === 'number' ? last.at : 0,
      lastSize: typeof last?.size === 'number' ? last.size : undefined,
      lastKind: typeof last?.kind === 'string' ? last.kind : undefined,
    };
  } catch {
    return { auto: false, freq: 'daily', keep: 3, lastAt: 0 };
  }
}

export async function writeBackupPrefs(patch: Partial<Omit<CloudBackupPrefs, 'lastAt' | 'lastSize' | 'lastKind'>>): Promise<void> {
  if (patch.auto !== undefined) await localDB.put('settings', { key: 'cloudBackupAuto', value: patch.auto });
  if (patch.freq !== undefined) await localDB.put('settings', { key: 'cloudBackupFreq', value: patch.freq });
  if (patch.keep !== undefined) await localDB.put('settings', { key: 'cloudBackupKeep', value: patch.keep });
}

/** 超期判定：距离上次备份超过频率窗口（留 10 分钟提前量防边界空转） */
export function isOverdue(prefs: CloudBackupPrefs): boolean {
  if (!prefs.auto) return false;
  return Date.now() - prefs.lastAt >= (FREQ_INTERVALS[prefs.freq] ?? FREQ_INTERVALS.daily) - 600_000;
}

let autoRunning = false;

/** 按保留份数清理最旧的云端备份（keep <= 0 = 不限制） */
export async function pruneBackups(keep: number): Promise<void> {
  if (!Number.isFinite(keep) || keep < 1) return;
  try {
    const r = await listBackups();
    if (!r.ok || !r.rows) return;
    const rows = [...r.rows].sort(
      (a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''),
    );
    for (const row of rows.slice(keep)) {
      await deleteBackup(row);
    }
  } catch {
    /* 静默：清理失败不阻塞主流程 */
  }
}

/** 静默自动备份（绝不打扰用户：所有失败吞掉只进 console） */
export async function maybeAutoBackup(): Promise<void> {
  if (autoRunning) return;
  try {
    const prefs = await readBackupPrefs();
    if (!isOverdue(prefs)) return;
    autoRunning = true;
    const r = await runBackup('auto');
    if (!r.ok) console.warn('[cloud-backup] 自动备份失败（静默）:', r.message ?? r.error);
    else await pruneBackups(prefs.keep);
  } catch {
    /* 静默 */
  } finally {
    autoRunning = false;
  }
}

let watcherStarted = false;

/** 自动备份监听：① App 退后台（visibilitychange hidden，机主规格原文）② 30 分钟兜底轮询 */
export function startAutoBackupWatcher(): void {
  if (watcherStarted || typeof window === 'undefined') return;
  watcherStarted = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void maybeAutoBackup();
  });
  window.setInterval(() => void maybeAutoBackup(), 30 * 60_000);
}
