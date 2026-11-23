'use client';

// 储存空间页：真实用量实测（statStore / statKv）+ 备份与恢复卡片（E4）。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ChevronRight,
  ChevronsUpDown,
  Download,
  Loader2,
  Smartphone,
  Upload,
} from 'lucide-react';

import {
  APPS,
  AppIconTile,
} from '../registry';

import { useUI } from '@/lib/ios/store';

import {
  localDB,
  type IOSStoreName,
} from '@/lib/ios/db';

import { type AppId } from '@/lib/ios/store';

import {
  exportBackupToDownload,
  inspectBackupFile,
  readLastBackupTime,
  restoreBackup,
} from '@/lib/ios/backup';

import {
  IOS_RED,
  GroupCard,
  TONE_ORANGE,
  TONE_BLUE,
  TONE_GREEN,
  DetailShell,
} from './shared';



// ---------------- 模块级工具 ----------------

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
// ---------------- 存储空间（真实用量实测 + 毛玻璃胶囊风） ----------------

/** 分类配色（红=应用程序 / 橙=照片 / 浅灰=系统数据） */
export const CAT_APPS_COLOR = '#FF3B30';
export const CAT_PHOTOS_COLOR = '#FF9500';

/** 图例胶囊：圆点 + 标签的毛玻璃小药丸 */
export function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/55 px-3 py-1 text-[12px] ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.07] dark:ring-white/[0.1]">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export let _te: TextEncoder | null = null;
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

/** kv 键 → 所属 App 桶（键名前缀规则，与 idb-kv 迁移清单一致） */
export function kvBucketOf(key: string): 'wx' | 'qq' | 'chat' | 'memory' | 'worldbook' | 'music' | 'system' {
  if (key.startsWith('wx')) return 'wx';
  if (key.startsWith('qq')) return 'qq';
  if (key.startsWith('ios-chat') || key.startsWith('sms-chat') || key.startsWith('chat-translate')) return 'chat';
  if (key.startsWith('mem-')) return 'memory';
  if (key.startsWith('worldbook') || key.startsWith('wb-bind')) return 'worldbook';
  if (key.startsWith('music')) return 'music';
  return 'system';
}

export type KvBuckets = Record<ReturnType<typeof kvBucketOf>, StoreStat>;

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

/** 相对时间文案：今天 / 昨天 / N 天前 / YYYY/M/D（iOS「上次使用」同款） */
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

export interface AppUsage {
  id: AppId;
  name: string;
  stat: StoreStat;
}

export function StoragePage({ onBack }: { onBack: () => void }) {
  const recentApps = useUI((s) => s.recentApps);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [appUsage, setAppUsage] = useState<AppUsage[] | null>(null);
  const [systemStat, setSystemStat] = useState<StoreStat>({ ...EMPTY_STAT });
  const [sortDesc, setSortDesc] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState('');
  // 备份与恢复（Task 14：全量下载/整库恢复；W2-E4 补进度/安全备份/恢复摘要/最近备份时间）
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupMsgOk, setBackupMsgOk] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; file: File; summary: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const loadStats = useCallback(async () => {
    const est = await readStorageEstimate();
    setEstimate(est);
    try {
      const [photos, albums, recordings, music, notes, events, reminders, sessions, messages, callLogs, voicemails, contacts, alarms, cities, settingsRows, kv] =
        await Promise.all([
          statStore('photos'),
          statStore('albums'),
          statStore('recordings'),
          statStore('music'),
          statStore('notes', 'updatedAt'),
          statStore('events'),
          statStore('reminders'),
          statStore('chat-sessions'),
          statStore('chat-messages'),
          statStore('call-logs'),
          statStore('voicemails'),
          statStore('contacts'),
          statStore('alarms'),
          statStore('cities'),
          statStore('settings'),
          statKv(),
        ]);
      const byId: Partial<Record<AppId, StoreStat>> = {
        photos: mergeStats(photos, albums),
        recorder: recordings,
        music: mergeStats(music, kv.music),
        chat: mergeStats(sessions, messages, kv.chat),
        phone: mergeStats(callLogs, voicemails),
        contacts,
        notes,
        calendar: events,
        reminders,
        clock: alarms,
        weather: cities,
        settings: settingsRows,
        wechat: kv.wx,
        qq: kv.qq,
        memory: kv.memory,
        worldbook: kv.worldbook,
      };
      setAppUsage(APPS.map((a) => ({ id: a.id, name: a.name, stat: byId[a.id] ?? { ...EMPTY_STAT } })));
      setSystemStat(kv.system);
    } catch {
      setAppUsage(APPS.map((a) => ({ id: a.id, name: a.name, stat: { ...EMPTY_STAT } })));
      setSystemStat({ ...EMPTY_STAT });
    }
  }, []);

  useEffect(() => {
    // 客户端能力检测（SSR 无 window，只能挂载后测）：一次性回填，非级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStats();
    // 最近备份时间回填（localStorage 挂载后才可读；一次性，非渲染期派生）
    setLastBackupAt(readLastBackupTime());
  }, [loadStats]);

  const handleExportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    setBackupMsg('');
    setBackupProgress('');
    try {
      const r = await exportBackupToDownload({
        onProgress: (done, total) => setBackupProgress(`${done}/${total}`),
      });
      const serverNote = r.serverSkipped ? '；服务端数据未包含（接口不可达）' : '';
      const base = `已导出 ${r.records} 条记录（${r.stores} 个模块 · ${(r.bytes / 1024 / 1024).toFixed(2)} MB）`;
      // v2.4.4 如实按落盘通道提示（旧 APK 不再假装「已开始下载」）
      if (r.savedVia === 'native') {
        setBackupMsgOk(true);
        setBackupMsg(`${base} —「${r.filename}」已存进手机 Download 目录（通知栏/文件管理器可见）${serverNote}`);
      } else if (r.savedVia === 'browser') {
        setBackupMsgOk(true);
        setBackupMsg(`${base} —「${r.filename}」已开始下载${serverNote}`);
      } else {
        setBackupMsgOk(false);
        setBackupMsg(
          `${base}，但当前 APP 版本不支持在 APP 内保存文件——请检查系统通知栏有没有「${r.filename}」的下载；没有的话，用手机浏览器打开本页面再导出一次即可（或先到 设置 › APP 更新 安装新版本，之后就能直接存进 Download 目录）`,
        );
      }
      setLastBackupAt(readLastBackupTime());
    } catch (err) {
      setBackupMsgOk(false);
      setBackupMsg(err instanceof Error ? `导出失败：${err.message}` : '导出失败，请稍后重试');
    } finally {
      setBackupBusy(null);
      setBackupProgress('');
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (backupBusy) return;
    setBackupBusy('import');
    setBackupMsg('');
    try {
      // 恢复前自动导出当前状态作安全备份（防误覆盖；失败即中止恢复，绝不裸恢复）
      setBackupMsg('正在导出恢复前的安全备份…');
      try {
        await exportBackupToDownload({
          safety: true,
          onProgress: (done, total) => setBackupProgress(`${done}/${total}`),
        });
      } catch (err) {
        throw new Error(
          `恢复前安全备份失败（已中止恢复）：${err instanceof Error ? err.message : '未知错误'}`,
        );
      }
      setBackupMsg('安全备份已下载，正在写入恢复数据…');
      const r = await restoreBackup(file);
      setBackupMsgOk(true);
      const skip = r.skippedStores.length > 0 ? `（跳过 ${r.skippedStores.length} 个未知模块）` : '';
      const fonts = r.fonts > 0 ? ` · 自定义字体 ${r.fonts} 款` : '';
      const server = r.server.attempted
        ? r.server.ok
          ? ' · 服务端数据已恢复'
          : ` · 服务端数据恢复失败（${r.server.error ?? '未知错误'}）`
        : '';
      setBackupMsg(
        `恢复完成：${r.records} 条记录 · ${r.stores} 个模块 · ${r.lsKeys} 项本地设置${fonts}${server}${skip} — 正在重启…`,
      );
      setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      setBackupMsgOk(false);
      setBackupMsg(err instanceof Error ? err.message : '恢复失败，请重试');
    } finally {
      setBackupBusy(null);
      setBackupProgress('');
      setPendingRestore(null);
    }
  };

  const handleClean = async () => {
    if (cleaning) return;
    if (!window.confirm('确定清理全部媒体缓存吗？照片、录音和音乐将被删除。')) return;
    setCleaning(true);
    setCleanMsg('');
    try {
      await Promise.all([localDB.clear('photos'), localDB.clear('recordings'), localDB.clear('music')]);
      await loadStats();
      setCleanMsg('已清理媒体缓存，空间已释放');
      window.setTimeout(() => setCleanMsg(''), 3000);
    } catch {
      setCleanMsg('清理失败，请重试');
    } finally {
      setCleaning(false);
    }
  };

  const appsTotal = (appUsage ?? []).reduce((acc, r) => acc + r.stat.bytes, 0);
  const photosBytes = appUsage?.find((r) => r.id === 'photos')?.stat.bytes ?? 0;
  const appsBytes = appsTotal - photosBytes;
  /** 系统数据 = 浏览器总用量 − 已归属 App 的部分（杂项 kv / 缓存等真实余量）；
   *  estimate 不可用时退回 kv 未归属桶 */
  const systemBytes =
    estimate && estimate.usage > 0 ? Math.max(0, estimate.usage - appsTotal) : Math.max(systemStat.bytes, 0);
  const usedBytes = estimate && estimate.usage > 0 ? estimate.usage : appsTotal + systemBytes;
  const quotaBytes = estimate?.quota ?? 0;
  const freeBytes = quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) : 0;
  const segPct = (b: number) => `${((b / Math.max(usedBytes, 1)) * 100).toFixed(3)}%`;

  const sortedRows = useMemo(() => {
    const rows = [...(appUsage ?? [])];
    rows.sort((a, b) => (sortDesc ? b.stat.bytes - a.stat.bytes : a.stat.bytes - b.stat.bytes));
    return rows;
  }, [appUsage, sortDesc]);

  /** 「上次使用」：多任务里还留着的 = 今天；有数据取真实最新时间；只有无时间戳的存量数据 = 早前；否则从未使用 */
  const lastUsedText = (id: AppId, stat: StoreStat): string => {
    if (recentApps.includes(id)) return '今天';
    if (stat.lastAt != null) return lastUsedFromTs(stat.lastAt);
    if (stat.bytes > 0) return '早前';
    return '从未使用';
  };

  return (
    <DetailShell title="储存空间" onBack={onBack} gray>
      <GroupCard>
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1.5 text-[14px] font-semibold ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.12]">
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              iPhone
            </span>
            <span className="max-w-[62%] truncate rounded-full bg-white/60 px-3 py-1.5 text-[12.5px] tabular-nums text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.12]">
              {estimate === null
                ? '统计中…'
                : quotaBytes > 0
                  ? `已使用 ${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`
                  : `已使用 ${formatBytes(usedBytes)}`}
            </span>
          </div>

          <div className="mt-3.5 flex h-[18px] gap-[3px] overflow-hidden rounded-full bg-white/50 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.1]">
            <div className="h-full" style={{ width: segPct(appsBytes), background: CAT_APPS_COLOR }} />
            <div className="h-full" style={{ width: segPct(photosBytes), background: CAT_PHOTOS_COLOR }} />
            <div className="h-full bg-[#C7C7CC] dark:bg-[#636366]" style={{ width: segPct(systemBytes) }} />
            {quotaBytes > 0 && (
              <div className="flex h-full min-w-0 flex-1 items-center justify-end pr-3 text-[11px] tabular-nums text-muted-foreground">
                可用 {formatBytes(freeBytes)}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LegendChip color={CAT_APPS_COLOR} label="应用程序" />
            <LegendChip color={CAT_PHOTOS_COLOR} label="照片" />
            <LegendChip color="#C7C7CC" label="系统数据" />
          </div>
        </div>
      </GroupCard>

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setSortDesc((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3.5 py-1.5 text-[13px] ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.12]"
          style={{ color: TONE_BLUE }}
        >
          大小
          <ChevronsUpDown
            className={`h-3.5 w-3.5 transition-transform ${sortDesc ? '' : 'rotate-180'}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="mt-2.5">
        <GroupCard>
          {appUsage === null ? (
            <div className="flex h-[64px] items-center justify-center gap-2 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              正在统计各 App 真实占用…
            </div>
          ) : (
            sortedRows.map((r) => (
              <div key={r.id} className="flex h-[64px] items-center gap-3 px-4">
                <div className="relative h-[46px] w-[46px] shrink-0 overflow-hidden rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] dark:ring-white/[0.1]">
                  <AppIconTile id={r.id} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] leading-tight">{r.name}</div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    上次使用：{lastUsedText(r.id, r.stat)}
                  </div>
                </div>
                <span className="shrink-0 text-[14.5px] font-medium tabular-nums text-foreground/80">
                  {formatBytes(r.stat.bytes)}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              </div>
            ))
          )}
        </GroupCard>
      </div>

      {/* 备份与恢复（全量下载 / 整库恢复） */}
      <div className="mt-4">
        <GroupCard>
          <button
            type="button"
            data-testid="settings-backup-export"
            onClick={() => void handleExportBackup()}
            disabled={backupBusy !== null}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50 disabled:opacity-50"
          >
            {backupBusy === 'export' ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-5 w-5 shrink-0" style={{ color: TONE_GREEN }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-tight">
                {backupBusy === 'export'
                  ? `正在导出${backupProgress ? ` ${backupProgress}` : ''}…`
                  : '导出全部数据'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                聊天 · 联系人 · 记忆 · 照片录音 · 设置 → 下载一个 JSON 备份文件
              </span>
            </span>
          </button>
          <button
            type="button"
            data-testid="settings-backup-import"
            onClick={() => restoreInputRef.current?.click()}
            disabled={backupBusy !== null}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50 disabled:opacity-50"
          >
            {backupBusy === 'import' ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 shrink-0" style={{ color: TONE_ORANGE }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-tight">
                {backupBusy === 'import'
                  ? `正在恢复${backupProgress ? ` ${backupProgress}` : ''}…`
                  : '导入备份'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                用备份文件整库恢复（覆盖当前数据），可跨设备 / 浏览器搬家
              </span>
            </span>
          </button>
        </GroupCard>
        <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-muted-foreground">
          最近备份：{lastBackupAt ?? '尚未备份'}
        </p>
        <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-muted-foreground">
          备份含全部数据（API Key 会解密写入备份文件，请妥善保管）。清除浏览器数据、换浏览器或换设备前，先导出备份即可原样搬回。
        </p>

        {pendingRestore && (
          <div
            data-testid="settings-backup-confirm"
            className="mt-2.5 rounded-[16px] border px-4 py-3"
            style={{ borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.1)' }}
          >
            <p className="text-[13px] leading-relaxed" style={{ color: '#B45309' }}>
              将用「{pendingRestore.name}」覆盖当前全部数据（聊天/照片/设置等先清空再恢复），确定吗？
            </p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'rgba(180,83,9,0.85)' }}>
              备份内容：{pendingRestore.summary}。确认后先自动导出当前数据为安全备份，再执行恢复。
            </p>
            <div className="mt-2.5 flex gap-2.5">
              <button
                type="button"
                onClick={() => void handleRestoreFile(pendingRestore.file)}
                disabled={backupBusy !== null}
                className="h-9 flex-1 rounded-full text-[14px] font-medium text-white transition-all active:scale-[0.97] disabled:opacity-50"
                style={{ backgroundColor: IOS_RED }}
              >
                确认恢复
              </button>
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                disabled={backupBusy !== null}
                className="h-9 flex-1 rounded-full bg-white/70 text-[14px] font-medium ring-1 ring-white/80 backdrop-blur-xl transition-all active:scale-[0.97] disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12]"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {backupMsg && (
          <p
            data-testid="settings-backup-msg"
            className={`mt-2.5 px-1 text-[13px] leading-relaxed ${
              backupMsgOk ? 'text-emerald-600 dark:text-emerald-400' : ''
            }`}
            style={backupMsgOk ? undefined : { color: IOS_RED }}
          >
            {backupMsgOk ? '✅ ' : '❌ '}
            {backupMsg}
          </p>
        )}

        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            // 先解析校验并生成各段摘要：坏文件当场报错，好文件带摘要进确认条
            void (async () => {
              try {
                const info = await inspectBackupFile(f);
                setBackupMsg('');
                setPendingRestore({ name: f.name, file: f, summary: info.summary });
              } catch (err) {
                setBackupMsgOk(false);
                setBackupMsg(err instanceof Error ? err.message : '备份文件无效');
              }
            })();
          }}
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void handleClean()}
          disabled={cleaning}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/60 text-[15px] font-medium ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:ring-white/[0.12]"
          style={{ color: IOS_RED }}
        >
          {cleaning && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          清理媒体缓存
        </button>
      </div>

      {cleanMsg && (
        <p
          className={`mt-3 px-1 text-[13px] leading-relaxed ${
            cleanMsg.startsWith('已清理') ? 'text-emerald-600 dark:text-emerald-400' : ''
          }`}
          style={cleanMsg.startsWith('已清理') ? undefined : { color: IOS_RED }}
        >
          {cleanMsg}
        </p>
      )}
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        以上为各 App 在本机的真实数据占用（IndexedDB 实测）。清理将删除全部照片、录音与音乐文件，备忘录和日程不受影响。
      </p>
    </DetailShell>
  );
}
