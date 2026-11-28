'use client';

/**
 * 文件 App · 数据管理（Terminal 重构版）：
 *
 * 彻底废弃旧「分段环形图 + 彩色圆点」设计，改为系统底层诊断终端风格：
 * - 视觉：净浅灰底（#F8F9FA / 深灰暗色）+ 毛玻璃胶囊面板，数据全部等宽字体；
 *   灰 = 普通文本与边框，蓝 = 选中与备份，绿 = 已备份/安全，红 = 仅用于危险操作；
 * - 列表：按 App 独立管理——一行一个 App（信息 / 微信 / X论坛 / 音乐 / 阅读 / 拾光小屋…），
 *   左侧灰度图标 + 名称，中部等宽占用大小，右侧极简菜单（仅备份此 App / 清理此 App）；
 * - 多选：顶部全选 / 反选，勾选后底部滑出毛玻璃悬浮操作栏（备份选中项 / 清理选中项）；
 * - 全局汇总：细线分隔后显示已备份数据大小（绿）与未备份/可清理数据（灰），
 *   提供一键云备份（Supabase）与强制全局清理；
 * - 操作日志：终端式输出区（> 命令 → OK/FAIL），所有操作结果都在这里回显。
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Archive,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Loader2,
  MoreVertical,
  RefreshCw,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  appBackupFilter,
  appOf,
  APP_MODULES,
  clearAppData,
  computeAppStats,
  formatBytesAscii,
  isAppSafe,
  readBackupState,
  type AppModuleDef,
  type AppStat,
  type BackupState,
} from '@/lib/ios/app-storage';

import {
  cleanMedia,
  cleanRegenerableAssets,
  ensurePersistentStorage,
  lastUsedFromTs,
  readMediaAutoClean,
  writeMediaAutoClean,
} from '@/lib/ios/storage-stats';

import {
  exportBackupToDownload,
  inspectBackupFile,
  restoreBackup as restoreLocalBackup,
} from '@/lib/ios/backup';

import {
  deleteBackup,
  listBackups,
  pruneBackups,
  readBackupPrefs,
  restoreBackup as restoreCloudBackup,
  runBackup,
  writeBackupPrefs,
  type BackupRow,
  type CloudBackupPrefs,
} from '@/lib/ios/cloud-backup';

import { useUI } from '@/lib/ios/store';

// ---------------- 局部样式基元（Terminal / 毛玻璃） ----------------

/** 净灰底：浅色 #F8F9FA，深色深灰（整页唯一背景，无渐变） */
const PAGE_BG = 'bg-[#F8F9FA] dark:bg-[#16171C]';
/** 毛玻璃胶囊面板 */
const GLASS =
  'rounded-2xl bg-white/75 shadow-[0_2px_16px_rgba(17,24,39,0.05)] ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.055] dark:ring-white/[0.09]';
/** 细分隔线颜色 */
const LINE = 'border-black/[0.07] dark:border-white/[0.08]';
/** 细线（非 border 场景的背景色） */
const RULE = 'bg-black/[0.07] dark:bg-white/[0.08]';

/** 细线 + 等宽大写小字分隔（EN 展示 / 中文屏读） */
function TermSep({ en, cn }: { en: string; cn: string }) {
  return (
    <div className="mx-4 mb-2.5 mt-6 flex items-center gap-2.5 px-1" aria-label={cn}>
      <span aria-hidden className={`h-px flex-1 ${RULE}`} />
      <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-400 select-none dark:text-zinc-500">{en}</span>
      <span aria-hidden className={`h-px flex-1 ${RULE}`} />
      <span className="sr-only">{cn}</span>
    </div>
  );
}

/** 相对时间（终端态）：刚刚 / N分钟前 / 今天 / 昨天 / N天前 / 日期 */
function fmtAgo(ts: number): string {
  if (!ts) return '--';
  return lastUsedFromTs(ts);
}

function fmtCloudTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 云端备份间隔 / 保留份数选项（自动备份行内小下拉） */
const FREQ_OPTIONS = [
  { value: '6h', label: '每 6 小时' },
  { value: '12h', label: '每 12 小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];
const KEEP_OPTIONS = [
  { value: '3', label: '3 份' },
  { value: '5', label: '5 份' },
  { value: '10', label: '10 份' },
];

function MiniSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label
      className={`relative inline-flex items-center gap-1 rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10.5px] ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]`}
    >
      <span className="text-zinc-400">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-3.5 font-medium text-zinc-700 outline-none dark:text-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-1 h-3 w-3 text-zinc-400" />
    </label>
  );
}

/** 终端方块勾选框（选中 = 蓝底白勾） */
function TermCheck({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border transition-all duration-100 active:scale-[0.85] ${
        checked
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-zinc-400/90 bg-transparent hover:border-zinc-500 dark:border-zinc-500'
      }`}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3.2} aria-hidden />}
    </button>
  );
}

// ---------------- 操作日志（终端输出区） ----------------

interface LogLine {
  id: number;
  kind: 'ok' | 'err' | 'info';
  text: string;
}

let logSeq = 0;

// ---------------- 根组件 ----------------

export interface LibEntry {
  key: string;
  name: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  statText: string;
}

export default function DataManager({ libs, onOpenLib }: { libs: LibEntry[]; onOpenLib: (key: string) => void }) {
  // ---- 数据状态 ----
  const [stats, setStats] = useState<AppStat[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [backup, setBackup] = useState<BackupState | null>(null);
  const [cloudRows, setCloudRows] = useState<BackupRow[]>([]);
  const [showRecords, setShowRecords] = useState(false);
  const [prefs, setPrefs] = useState<CloudBackupPrefs | null>(null);
  const [mediaAuto, setMediaAuto] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  // ---- 交互状态 ----
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'' | 'backup' | 'clean' | 'cloud' | 'restore' | 'import' | 'media' | 'assets'>('');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [confirmClean, setConfirmClean] = useState<string[] | null>(null);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [confirmRestoreRow, setConfirmRestoreRow] = useState<BackupRow | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; file: File; summary: string } | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const openSettings = useUI((s) => s.switchToApp);

  const log = useCallback((kind: LogLine['kind'], text: string) => {
    setLogs((l) => [{ id: ++logSeq, kind, text }, ...l].slice(0, 24));
  }, []);

  // ---- 刷新：实测各行占用 + 备份基线 + 云端记录 ----
  const refresh = useCallback(
    async (withCloud = true) => {
      setScanning(true);
      try {
        const [s, b] = await Promise.all([computeAppStats(), readBackupState()]);
        setStats(s);
        setBackup(b);
        if (withCloud) {
          const p = await readBackupPrefs();
          setPrefs(p);
          if (b.cloudReady) {
            const r = await listBackups();
            setCloudRows(r.ok ? (r.rows ?? []) : []);
          } else {
            setCloudRows([]);
          }
        }
      } catch {
        /* IndexedDB 不可用时保持空表 */
      } finally {
        setScanning(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
    void (async () => {
      setMediaAuto(await readMediaAutoClean());
      try {
        setPersisted((await navigator.storage?.persisted?.()) ?? false);
      } catch {
        setPersisted(false);
      }
    })();
  }, [refresh]);

  // 媒体自动清理开启后：每天最多静默执行一次（cleanMedia 内部 24h 节流）
  useEffect(() => {
    if (mediaAuto) void cleanMedia({ auto: true }).catch(() => undefined);
  }, [mediaAuto]);

  // ---- 派生数据 ----
  const sorted = [...(stats ?? [])].sort((a, b) => b.bytes - a.bytes);
  const statOf = (id: string) => (stats ?? []).find((s) => s.id === id);
  const totalBytes = (stats ?? []).reduce((s, x) => s + x.bytes, 0);
  const safeBytes = (stats ?? []).filter((s) => backup && isAppSafe(s, backup)).reduce((s, x) => s + x.bytes, 0);
  const dirtyBytes = Math.max(0, totalBytes - safeBytes);
  const selStats = [...sel].map((id) => statOf(id)).filter((s): s is AppStat => !!s);
  const selBytes = selStats.reduce((s, x) => s + x.bytes, 0);
  const allSelected = sel.size === APP_MODULES.length;

  // ---- 选择操作（勾选状态与操作严格对应） ----
  const toggleSel = (id: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSel(allSelected ? new Set() : new Set(APP_MODULES.map((a) => a.id)));
  const invertSel = () =>
    setSel(new Set(APP_MODULES.filter((a) => !sel.has(a.id)).map((a) => a.id)));

  // ---- 备份（本地导出，按 App 过滤） ----
  const backupApps = async (ids: string[]) => {
    if (busy || ids.length === 0) return;
    const apps = ids.map((id) => appOf(id)).filter((a): a is AppModuleDef => !!a);
    const names = apps.map((a) => a.label).join('、');
    setBusy('backup');
    log('info', `backup --app=${ids.join(',')} → 导出中…`);
    try {
      const r = await exportBackupToDownload({ filter: appBackupFilter(ids) });
      const note = r.serverSkipped ? '（服务端数据未包含）' : '';
      if (r.savedVia === 'native') {
        log('ok', `backup → OK · ${names} · ${r.records} 条 · ${formatBytesAscii(r.bytes)} · 已存 Download/${r.filename}${note}`);
      } else if (r.savedVia === 'browser') {
        log('ok', `backup → OK · ${names} · ${r.records} 条 · ${formatBytesAscii(r.bytes)} · 已开始下载${note}`);
      } else {
        log('err', `backup → 文件已生成，但当前 APP 版本不支持应用内保存——请用手机浏览器打开本页面重试`);
      }
      await refresh(false);
    } catch (err) {
      log('err', `backup → FAIL · ${err instanceof Error ? err.message : '导出失败，请重试'}`);
    } finally {
      setBusy('');
    }
  };

  // ---- 清理（危险操作，调用前必须经过确认弹窗） ----
  const runClean = async (ids: string[]) => {
    if (busy || ids.length === 0) return;
    setBusy('clean');
    const names = ids.map((id) => appOf(id)?.label ?? id).join('、');
    log('info', `clean --app=${ids.join(',')} → 执行中…`);
    try {
      const r = await clearAppData(ids);
      log('ok', `clean → DONE · ${names} · 释放 ${formatBytesAscii(r.bytes)} · ${r.records} 项（建议重启应用使界面状态同步）`);
      setSel(new Set());
      await refresh(false);
    } catch {
      log('err', `clean → FAIL · 清理失败，请重试`);
    } finally {
      setBusy('');
    }
  };

  // ---- 一键云备份（Supabase 全量） ----
  const doCloudBackup = async () => {
    if (busy) return;
    setBusy('cloud');
    log('info', 'cloud-push → 上传中…');
    try {
      const creds = backup?.cloudReady;
      if (!creds) {
        log('err', 'cloud-push → FAIL · 还没部署云端助手——先到 设置 › 云端助手 完成 Supabase 部署');
        return;
      }
      const r = await runBackup('manual');
      if (r.ok) {
        log('ok', `cloud-push → OK · ${formatBytesAscii(r.size ?? 0)}${r.sections ? ` · ${r.sections}` : ''}`);
        const p = await readBackupPrefs();
        await pruneBackups(p.keep);
      } else {
        log('err', `cloud-push → FAIL · ${r.message ?? '备份失败，请稍后重试'}`);
      }
      await refresh();
    } finally {
      setBusy('');
    }
  };

  // ---- 云端恢复 / 删除 ----
  const doCloudRestore = async (row: BackupRow) => {
    if (busy) return;
    setBusy('restore');
    log('info', 'cloud-pull → 恢复中…');
    try {
      const r = await restoreCloudBackup(row);
      if (r.ok) {
        log('ok', `cloud-pull → OK · ${r.sections ?? ''} —— 部分页面数据需重进 App 刷新`);
        await refresh(false);
      } else {
        log('err', `cloud-pull → FAIL · ${r.message ?? '恢复失败，请稍后重试'}`);
      }
    } finally {
      setBusy('');
      setConfirmRestoreRow(null);
    }
  };

  const doDeleteCloudRow = async (row: BackupRow) => {
    if (busy) return;
    setBusy('restore');
    try {
      await deleteBackup(row);
      log('info', `cloud-rm → 已删除云端备份 ${fmtCloudTime(Date.parse(row.created_at ?? '') || 0)}`);
      await refresh();
    } finally {
      setBusy('');
    }
  };

  // ---- 本地备份文件导入 ----
  const doImportFile = async (file: File) => {
    if (busy) return;
    setBusy('import');
    log('info', 'restore → 正在导出恢复前的安全备份…');
    try {
      try {
        await exportBackupToDownload({ safety: true });
      } catch (err) {
        throw new Error(`恢复前安全备份失败（已中止恢复）：${err instanceof Error ? err.message : '未知错误'}`);
      }
      const r = await restoreLocalBackup(file);
      const skip = r.skippedStores.length > 0 ? `（跳过 ${r.skippedStores.length} 个未知模块）` : '';
      log('ok', `restore → OK · ${r.records} 条 · ${r.stores} 个模块 · ${r.lsKeys} 项本地设置${skip} —— 正在重启…`);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      log('err', `restore → FAIL · ${err instanceof Error ? err.message : '恢复失败，请重试'}`);
      setBusy('');
    } finally {
      setPendingImport(null);
    }
  };

  // ---- 媒体压缩 / 可再生缓存清理 ----
  const doMediaCompress = async () => {
    if (busy) return;
    setBusy('media');
    log('info', 'media --compress → 执行中…');
    try {
      const r = await cleanMedia();
      log(
        'ok',
        r.compressed > 0
          ? `media --compress → OK · 压缩 ${r.compressed} 张照片 · 释放 ${formatBytesAscii(r.savedBytes)}`
          : 'media --compress → OK · 没有需要压缩的照片',
      );
      await refresh(false);
    } catch {
      log('err', 'media --compress → FAIL · 清理失败，请重试');
    } finally {
      setBusy('');
    }
  };

  const doAssetsClean = async () => {
    if (busy) return;
    setBusy('assets');
    log('info', 'cache-clean → 执行中…');
    try {
      const r = await cleanRegenerableAssets();
      log(
        'ok',
        r.keys > 0
          ? `cache-clean → OK · 清理 ${r.keys} 项可再生缓存 · ${formatBytesAscii(r.bytes)}`
          : 'cache-clean → OK · 没有可清理的未引用素材',
      );
      await refresh(false);
    } catch {
      log('err', 'cache-clean → FAIL · 清理失败，请重试');
    } finally {
      setBusy('');
    }
  };

  // ---- 危险确认弹窗文案 ----
  const confirmTarget = confirmClean ?? (confirmGlobal ? APP_MODULES.map((a) => a.id) : []);
  const confirmNames = confirmTarget.map((id) => appOf(id)?.label ?? id);
  const confirmBytes = confirmTarget.reduce((s, id) => s + (statOf(id)?.bytes ?? 0), 0);
  const confirmRecords = confirmTarget.reduce((s, id) => s + (statOf(id)?.records ?? 0), 0);

  const lastBackupText = (() => {
    if (!backup || backup.lastAt <= 0) return '从未备份';
    const via = backup.lastCloudAt >= backup.lastLocalAt && backup.lastCloudAt > 0 ? '云端' : '本地导出';
    return `${fmtCloudTime(backup.lastAt)} · ${via}`;
  })();

  const latestCloud = cloudRows.length > 0 ? cloudRows[0] : null;

  return (
    <div className={`${PAGE_BG} min-h-full pb-10 font-mono text-zinc-800 antialiased dark:text-zinc-100`}>
      {/* ============ 终端头 ============ */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className="font-semibold text-zinc-400 select-none">$</span>
          <span className="font-medium text-zinc-600 dark:text-zinc-300">storage&nbsp;--analyze</span>
          <span aria-hidden className="h-3.5 w-[7px] animate-pulse bg-blue-600/80" />
          <span className="flex-1" />
          <button
            type="button"
            aria-label="重新扫描"
            onClick={() => void refresh()}
            disabled={scanning}
            className="grid h-7 w-7 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 active:scale-90 disabled:opacity-40 dark:hover:bg-white/[0.07] dark:hover:text-zinc-300"
          >
            <RefreshCw className={`h-[14px] w-[14px] ${scanning ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          {scanning
            ? '> scanning 13 apps ...'
            : stats
              ? `> ${APP_MODULES.length} apps · Σ ${formatBytesAscii(totalBytes)} · 备份基线 ${lastBackupText}`
              : '> booting indexeddb ...'}
        </p>
      </div>

      {/* ============ 区块一：按 App 独立管理列表 ============ */}
      <TermSep en="MODULES" cn="按 App 管理" />
      <div className="px-4">
        <div className={`${GLASS} overflow-hidden`}>
          {/* 工具行：全选 / 反选 + 总量 */}
          <div className={`flex items-center gap-2 border-b ${LINE} px-3.5 py-2.5`}>
            <TermCheck
              checked={allSelected}
              onToggle={selectAll}
              label={allSelected ? '取消全选' : '全选'}
            />
            <button
              type="button"
              onClick={selectAll}
              className="text-[11.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-800 active:scale-95 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {allSelected ? '全不选' : '全选'}
            </button>
            <span aria-hidden className={`mx-0.5 h-3 w-px ${RULE}`} />
            <button
              type="button"
              onClick={invertSel}
              className="text-[11.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-800 active:scale-95 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              反选
            </button>
            <span className="flex-1" />
            <span className="text-[11px] tabular-nums text-zinc-400">
              {sel.size > 0 ? `已选 ${sel.size}` : `Σ ${formatBytesAscii(totalBytes)}`}
            </span>
          </div>

          {/* App 行列表 */}
          {sorted.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> SCANNING ...
            </div>
          )}
          {sorted.map((stat) => {
            const app = appOf(stat.id);
            if (!app) return null;
            const selected = sel.has(app.id);
            const safe = backup ? isAppSafe(stat, backup) : false;
            return (
              <div
                key={app.id}
                className={`flex items-center gap-2.5 border-b px-3 py-2.5 transition-colors last:border-b-0 ${LINE} ${
                  selected ? 'bg-blue-500/[0.06]' : ''
                }`}
              >
                <TermCheck checked={selected} onToggle={() => toggleSel(app.id)} label={`选择${app.label}`} />

                {/* 灰度 App 图标 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={app.icon}
                  alt={`${app.label}图标`}
                  className="h-[34px] w-[34px] shrink-0 rounded-[8px] object-cover grayscale contrast-[0.92] opacity-90"
                />

                {/* 名称 + 终端路径 */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">
                    {app.label}
                  </p>
                  <p className="mt-[3px] truncate text-[10px] leading-none text-zinc-400 dark:text-zinc-500">
                    {app.path} · {stat.records} 项 · {fmtAgo(stat.lastAt)}
                  </p>
                </div>

                {/* 占用大小 + 备份状态 */}
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold tabular-nums leading-tight text-zinc-800 dark:text-zinc-100">
                    {formatBytesAscii(stat.bytes)}
                  </p>
                  <p
                    className={`mt-[3px] text-[10px] leading-none ${
                      safe ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    {safe ? '● 已备份' : '○ 未备份'}
                  </p>
                </div>

                {/* 行级极简菜单 */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy !== ''}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 active:scale-90 disabled:opacity-40 data-[state=open]:bg-black/[0.06] data-[state=open]:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
                    aria-label={`${app.label}操作菜单`}
                  >
                    <MoreVertical className="h-[15px] w-[15px]" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-[168px] rounded-xl border-black/[0.07] bg-white/95 font-mono text-zinc-700 backdrop-blur-2xl dark:border-white/[0.1] dark:bg-zinc-900/95 dark:text-zinc-200"
                  >
                    <DropdownMenuItem
                      disabled={busy !== ''}
                      onClick={() => void backupApps([app.id])}
                      className="gap-2 text-[12.5px] text-blue-600 focus:text-blue-700 dark:text-blue-400 dark:focus:text-blue-300"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden /> 仅备份此 App
                    </DropdownMenuItem>
                    {app.id === 'photos' && (
                      <>
                        <DropdownMenuItem
                          disabled={busy !== ''}
                          onClick={() => void doMediaCompress()}
                          className="gap-2 text-[12.5px]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 压缩旧照片
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy !== ''}
                          onClick={() => {
                            const next = !mediaAuto;
                            setMediaAuto(next);
                            void writeMediaAutoClean(next);
                            log('info', `media --auto ${next ? 'on' : 'off'} · 4 天以上照片自动压缩 / 7 天以上清原图`);
                          }}
                          className="gap-2 text-[12.5px]"
                        >
                          <span
                            aria-hidden
                            className={`h-2 w-2 rounded-full ${mediaAuto ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                          />
                          自动压缩清理 {mediaAuto ? '已开' : '已关'}
                        </DropdownMenuItem>
                      </>
                    )}
                    {app.id === 'system' && (
                      <DropdownMenuItem
                        disabled={busy !== ''}
                        onClick={() => void doAssetsClean()}
                        className="gap-2 text-[12.5px]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 清理可再生缓存
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator className="bg-black/[0.06] dark:bg-white/[0.08]" />
                    <DropdownMenuItem
                      disabled={busy !== ''}
                      onClick={() => setConfirmClean([app.id])}
                      className="gap-2 text-[12.5px] text-red-600 focus:text-red-700 dark:text-red-400 dark:focus:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> 清理此 App
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ 悬浮操作栏（勾选后滑出） ============ */}
      <div
        aria-hidden={sel.size === 0}
        className={`sticky bottom-3 z-30 mt-4 px-4 transition-all duration-300 ${
          sel.size > 0 ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-10 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-black/[0.07] bg-white/85 px-3 py-2.5 shadow-[0_10px_36px_rgba(17,24,39,0.18)] backdrop-blur-2xl dark:border-white/[0.12] dark:bg-zinc-900/85">
          <span className="min-w-0 shrink-0 text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
            已选 <b className="font-semibold text-blue-600 dark:text-blue-400">{sel.size}</b>
            <br />
            <span className="tabular-nums">{formatBytesAscii(selBytes)}</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void backupApps([...sel])}
            disabled={busy !== ''}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-[12.5px] font-medium text-white shadow-[0_3px_12px_rgba(37,99,235,0.35)] transition-all active:scale-[0.96] disabled:opacity-45"
          >
            {busy === 'backup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
            备份选中项
          </button>
          <button
            type="button"
            onClick={() => setConfirmClean([...sel])}
            disabled={busy !== ''}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/50 px-3.5 text-[12.5px] font-medium text-red-600 transition-all active:scale-[0.96] disabled:opacity-45 dark:text-red-400"
          >
            {busy === 'clean' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            清理选中项
          </button>
          <button
            type="button"
            aria-label="取消选择"
            onClick={() => setSel(new Set())}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-black/[0.05] hover:text-zinc-600 active:scale-90 dark:hover:bg-white/[0.08]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* ============ 区块二：全局汇总 ============ */}
      <TermSep en="GLOBAL" cn="全局汇总" />
      <div className="px-4">
        <div className={`${GLASS} p-4`}>
          {/* 已备份 / 未备份（细点导线 + 等宽数字） */}
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-[12.5px] text-zinc-600 dark:text-zinc-300">已备份数据大小</span>
            <span aria-hidden className="mb-[3px] flex-1 border-b border-dotted border-zinc-300 dark:border-zinc-600" />
            <span className="shrink-0 text-[14px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatBytesAscii(safeBytes)}
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="shrink-0 text-[12.5px] text-zinc-500 dark:text-zinc-400">未备份 / 可清理数据</span>
            <span aria-hidden className="mb-[3px] flex-1 border-b border-dotted border-zinc-300 dark:border-zinc-600" />
            <span className="shrink-0 text-[14px] font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatBytesAscii(dirtyBytes)}
            </span>
          </div>

          {/* 备份基线 + 云端连接状态 */}
          <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-zinc-400 dark:text-zinc-500">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                backup?.cloudReady ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            />
            <span className="truncate">
              LAST BACKUP {lastBackupText}
              {backup?.lastCloudSize ? ` · ${formatBytesAscii(backup.lastCloudSize)}` : ''}
            </span>
          </div>

          {/* 全局操作 */}
          <div className="mt-3.5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void doCloudBackup()}
              disabled={busy !== ''}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13.5px] font-semibold text-white shadow-[0_4px_16px_rgba(37,99,235,0.3)] transition-all active:scale-[0.98] disabled:opacity-45"
            >
              {busy === 'cloud' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
              {busy === 'cloud' ? '正在备份…' : '一键云备份（Supabase）'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmGlobal(true)}
              disabled={busy !== ''}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-500/50 text-[13.5px] font-medium text-red-600 transition-all active:scale-[0.98] disabled:opacity-45 dark:text-red-400"
            >
              {busy === 'clean' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              强制全局清理
            </button>
          </div>

          {/* 次级操作行（云端恢复 / 备份记录 / 导入） */}
          <div className="mt-2.5 flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => (latestCloud ? setConfirmRestoreRow(latestCloud) : log('err', 'cloud-pull → 云端还没有备份——先点「一键云备份」创建一份'))}
              disabled={busy !== '' || !latestCloud}
              className="text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-800 hover:underline active:scale-95 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ⟲ 云端恢复
            </button>
            <span aria-hidden className="h-3 w-px bg-zinc-300 dark:bg-zinc-600" />
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              disabled={busy !== ''}
              className="text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-800 hover:underline active:scale-95 disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ⇩ 导入备份文件
            </button>
            <span aria-hidden className="h-3 w-px bg-zinc-300 dark:bg-zinc-600" />
            <button
              type="button"
              onClick={() => setShowRecords((v) => !v)}
              className="inline-flex items-center gap-0.5 text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-800 hover:underline active:scale-95 dark:text-zinc-400 dark:hover:text-zinc-200"
              aria-expanded={showRecords}
            >
              备份记录{cloudRows.length > 0 ? ` (${cloudRows.length})` : ''}
              <ChevronDown className={`h-3 w-3 transition-transform ${showRecords ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          </div>

          {/* 云端备份记录（终端列表） */}
          {showRecords && (
            <div className={`mt-2.5 max-h-44 overflow-y-auto rounded-xl bg-black/[0.03] ring-1 ring-black/[0.04] dark:bg-white/[0.04] dark:ring-white/[0.06]`}>
              {cloudRows.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11px] text-zinc-400">
                  {backup?.cloudReady ? 'cloud://backups — 空' : 'cloud://backups — 未部署云端助手'}
                </p>
              ) : (
                cloudRows.slice(0, 20).map((row) => (
                  <div
                    key={row.id}
                    className={`flex items-center gap-2 border-b px-2.5 py-2 text-[10.5px] last:border-b-0 ${LINE}`}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">
                      {fmtCloudTime(Date.parse(row.created_at ?? '') || 0)} · {row.kind === 'auto' ? '自动' : '手动'}
                      {row.size_bytes ? ` · ${formatBytesAscii(row.size_bytes)}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmRestoreRow(row)}
                      disabled={busy !== ''}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-blue-600 transition-colors hover:bg-blue-500/10 active:scale-95 disabled:opacity-40 dark:text-blue-400"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      aria-label="删除这条备份"
                      onClick={() => void doDeleteCloudRow(row)}
                      disabled={busy !== ''}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-600 active:scale-95 disabled:opacity-40 dark:hover:text-red-400"
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 自动备份 + 持久化保护（紧凑开关行） */}
          <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 ${LINE}`}>
            <span className="flex items-center gap-1.5 text-[10.5px] text-zinc-500 dark:text-zinc-400">
              自动备份
              <Switch
                checked={!!prefs?.auto}
                onCheckedChange={(v) => {
                  setPrefs((p) => (p ? { ...p, auto: v } : p));
                  void writeBackupPrefs({ auto: v });
                  log('info', `cloud-auto ${v ? 'on' : 'off'} · 退后台时按间隔静默备份`);
                }}
                aria-label="自动备份开关"
                className="scale-[0.8]"
              />
            </span>
            {prefs?.auto && (
              <MiniSelect
                label="间隔"
                value={prefs.freq}
                options={FREQ_OPTIONS}
                onChange={(v) => {
                  setPrefs({ ...prefs, freq: v as CloudBackupPrefs['freq'] });
                  void writeBackupPrefs({ freq: v as CloudBackupPrefs['freq'] });
                }}
              />
            )}
            {prefs?.auto && (
              <MiniSelect
                label="保留"
                value={String(prefs.keep ?? 3)}
                options={KEEP_OPTIONS}
                onChange={(v) => {
                  setPrefs({ ...prefs, keep: Number(v) });
                  void writeBackupPrefs({ keep: Number(v) });
                }}
              />
            )}
            <span className="flex-1" />
            {persisted === null ? (
              <span className="text-[10.5px] text-zinc-400">PERSIST ·· 检测中</span>
            ) : persisted ? (
              <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">PERSIST ● 已开启</span>
            ) : (
              <button
                type="button"
                onClick={() => void ensurePersistentStorage().then((ok) => setPersisted(ok))}
                className="text-[10.5px] text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
              >
                PERSIST ○ 点此开启持久化
              </button>
            )}
          </div>

          {/* 未部署云端助手时的引导 */}
          {backup && !backup.cloudReady && (
            <button
              type="button"
              onClick={() => openSettings('settings')}
              className="mt-2.5 w-full text-left text-[10.5px] leading-relaxed text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
            >
              ↳ 云端助手未部署：前往 设置 › 云端助手 完成 Supabase 一键部署后即可云备份
            </button>
          )}
        </div>
      </div>

      {/* ============ 区块三：操作日志（终端输出） ============ */}
      <TermSep en="OPERATIONS" cn="操作日志" />
      <div className="px-4">
        <div className={`${GLASS} p-3.5`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.25em] text-zinc-400 dark:text-zinc-500">CONSOLE</span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLogs([])}
                className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.07] dark:hover:text-zinc-300"
              >
                clear
              </button>
              <button
                type="button"
                aria-label="重启应用"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.07] dark:hover:text-zinc-300"
              >
                <RotateCw className="h-2.5 w-2.5" aria-hidden /> reboot
              </button>
            </span>
          </div>
          {logs.length === 0 ? (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">$ awaiting command_</p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {logs.map((l) => (
                <p
                  key={l.id}
                  className={`break-all text-[11px] leading-relaxed ${
                    l.kind === 'ok'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : l.kind === 'err'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  <span aria-hidden className="mr-1 text-zinc-400">&gt;</span>
                  {l.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ 区块四：资料库入口 ============ */}
      <TermSep en="LIBRARY" cn="资料库" />
      <div className="px-4">
        <div className={`${GLASS} overflow-hidden`}>
          {libs.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => onOpenLib(l.key)}
              className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 active:bg-black/[0.03] dark:active:bg-white/[0.04] ${LINE}`}
            >
              <l.icon className="h-[18px] w-[18px] shrink-0 text-zinc-400" strokeWidth={1.8} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
                {l.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{l.statText}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" strokeWidth={2} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* ============ 危险操作确认弹窗（毛玻璃） ============ */}
      <AlertDialog open={confirmClean !== null || confirmGlobal} onOpenChange={(o) => !o && (setConfirmClean(null), setConfirmGlobal(false))}>
        <AlertDialogContent className="w-[290px] gap-0 rounded-2xl border-0 bg-white/95 p-0 font-mono shadow-2xl backdrop-blur-2xl dark:bg-zinc-900/95 sm:max-w-[290px]">
          <AlertDialogHeader className="gap-2 px-5 pb-4 pt-5 sm:text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-[16px] font-bold text-red-600 dark:text-red-400">
              <Trash2 className="h-4 w-4" aria-hidden />
              {confirmGlobal ? 'rm -rf /all' : `rm ${confirmTarget.length} app${confirmTarget.length > 1 ? 's' : ''}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              将清空{confirmGlobal ? '全部' : ''}「{confirmNames.join('、')}」的本机数据：
              <br />
              共 <b className="tabular-nums text-zinc-700 dark:text-zinc-200">{formatBytesAscii(confirmBytes)}</b> ·{' '}
              {confirmRecords} 项。
              {confirmGlobal && (
                <>
                  <br />
                  <span className="text-red-600 dark:text-red-400">包括设置、账号绑定与 API Key——建议先完成云端备份。</span>
                </>
              )}
              <br />
              此操作不可撤销，确认继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={`flex-row gap-0 border-t ${LINE} sm:flex-row`}>
            <AlertDialogCancel className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-normal text-zinc-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.04] dark:text-zinc-300 dark:active:bg-white/[0.06] sm:mt-0">
              再想想
            </AlertDialogCancel>
            <span aria-hidden className={`w-px shrink-0 self-stretch bg-zinc-200 dark:bg-zinc-700`} />
            <AlertDialogAction
              className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-bold text-red-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-red-500/[0.08] dark:text-red-400 sm:mt-0"
              onClick={() => {
                const ids = confirmTarget;
                setConfirmClean(null);
                setConfirmGlobal(false);
                void runClean(ids);
              }}
            >
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 云端恢复确认 */}
      <AlertDialog open={!!confirmRestoreRow} onOpenChange={(o) => !o && setConfirmRestoreRow(null)}>
        <AlertDialogContent className="w-[290px] gap-0 rounded-2xl border-0 bg-white/95 p-0 font-mono shadow-2xl backdrop-blur-2xl dark:bg-zinc-900/95 sm:max-w-[290px]">
          <AlertDialogHeader className="gap-2 px-5 pb-4 pt-5 sm:text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-left text-[16px] font-bold">
              <ArrowDownToLine className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden />
              从云端恢复？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {confirmRestoreRow
                ? `将用 ${fmtCloudTime(Date.parse(confirmRestoreRow.created_at ?? '') || 0)} 的云端备份覆盖本机的聊天 / 记忆 / 联系人 / 世界书 / 论坛等数据。此操作不可撤销，确认继续？`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={`flex-row gap-0 border-t ${LINE} sm:flex-row`}>
            <AlertDialogCancel className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-normal text-zinc-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.04] dark:text-zinc-300 dark:active:bg-white/[0.06] sm:mt-0">
              再想想
            </AlertDialogCancel>
            <span aria-hidden className="w-px shrink-0 self-stretch bg-zinc-200 dark:bg-zinc-700" />
            <AlertDialogAction
              className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-bold text-blue-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-blue-500/[0.08] dark:text-blue-400 sm:mt-0"
              onClick={() => confirmRestoreRow && void doCloudRestore(confirmRestoreRow)}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 本地备份文件导入确认 */}
      <AlertDialog open={!!pendingImport} onOpenChange={(o) => !o && setPendingImport(null)}>
        <AlertDialogContent className="w-[290px] gap-0 rounded-2xl border-0 bg-white/95 p-0 font-mono shadow-2xl backdrop-blur-2xl dark:bg-zinc-900/95 sm:max-w-[290px]">
          <AlertDialogHeader className="gap-2 px-5 pb-4 pt-5 sm:text-left">
            <AlertDialogTitle className="flex items-center gap-2 text-left text-[16px] font-bold">
              <ArrowDownToLine className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden />
              恢复备份文件？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {pendingImport
                ? `将用「${pendingImport.name}」覆盖文件内模块的当前数据（先清空再恢复），其它 App 不受影响。备份内容：${pendingImport.summary}。确认后先自动导出当前数据为安全备份，再执行恢复。`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={`flex-row gap-0 border-t ${LINE} sm:flex-row`}>
            <AlertDialogCancel className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-normal text-zinc-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.04] dark:text-zinc-300 dark:active:bg-white/[0.06] sm:mt-0">
              再想想
            </AlertDialogCancel>
            <span aria-hidden className="w-px shrink-0 self-stretch bg-zinc-200 dark:bg-zinc-700" />
            <AlertDialogAction
              className="h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-bold text-blue-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-blue-500/[0.08] dark:text-blue-400 sm:mt-0"
              onClick={() => pendingImport && void doImportFile(pendingImport.file)}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 隐藏文件选择器（导入备份） */}
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          void (async () => {
            try {
              const info = await inspectBackupFile(f);
              setPendingImport({ name: f.name, file: f, summary: info.summary });
            } catch (err) {
              log('err', `restore → FAIL · ${err instanceof Error ? err.message : '备份文件无效'}`);
            }
          })();
        }}
      />
    </div>
  );
}
