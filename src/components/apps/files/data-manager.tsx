'use client';

/**
 * 文件 App · 存储管理（v2.4.31 第五十轮改版）
 *
 * 彻底推翻 Terminal 终端风，改为「极简毛玻璃 + 胶囊」高级设计：
 * - 视觉：页面底色浅色 #F5F5F7 / 深色 #0E0E12；所有卡片为微投影毛玻璃
 *   （rounded-[28px] + 极弱 ring + 0.035 投影），一切操作按钮 / 选中标记 /
 *   状态 chip / 悬浮栏一律 rounded-full 胶囊；
 * - 配色写死 iOS 系统色：主操作蓝 #007AFF（备份/选中态）、健康绿 #34C759
 *   （已备份）、危险红 #FF3B30（清理/清除数据），文本 zinc 系，全 dark: 变体；
 * - 结构（自上而下）：毛玻璃 hero 总览（总占用大数字 + 已备份/可清理胶囊 + 刷新）→
 *   应用占用双列宫格胶囊（图标 + 名称 + 已备份绿点；长按 480ms 进多选，
 *   多选时 hero 收起 + 底部滑出毛玻璃悬浮操作栏；v2.4.31 起短按不再进详情页）→
 *   快捷操作（一键云端备份整行 + 备份 / 清除数据 / 导入备份三胶囊；
 *   v2.4.31 起健康检查已删除）→ 云端与恢复安静收纳区（恢复 / 记录 / 导入 /
 *   自动备份 / 持久化）；
 * - 操作反馈全部用 sonner 轻提示，危险操作走毛玻璃 AlertDialog；
 * - 数据层（app-storage / storage-stats / backup / cloud-backup）原样复用，零改动。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check, ChevronDown, CloudUpload, Download, Loader2, RefreshCw, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  appBackupFilter, appOf, APP_MODULES, clearAppData, computeAppStats,
  formatBytesAscii, isAppSafe, readBackupState,
  type AppModuleDef, type AppStat, type BackupState,
} from '@/lib/ios/app-storage';
import {
  cleanMedia, ensurePersistentStorage,
  readMediaAutoClean,
} from '@/lib/ios/storage-stats';
import {
  exportBackupToDownload, inspectBackupFile, restoreBackup as restoreLocalBackup,
} from '@/lib/ios/backup';
import {
  deleteBackup, listBackups, pruneBackups, readBackupPrefs,
  restoreBackup as restoreCloudBackup, runBackup, writeBackupPrefs,
  type BackupRow, type CloudBackupPrefs,
} from '@/lib/ios/cloud-backup';
import { useUI } from '@/lib/ios/store';

// ---------------- 局部样式基元（毛玻璃 / 胶囊） ----------------

/** 页面底色：浅色 #F5F5F7，深色 #0E0E12 */
const PAGE_BG = 'bg-[#F5F5F7] dark:bg-[#0E0E12]';
/** 毛玻璃卡基底（圆角各处不同：hero 32 / 卡 28 / 小胶囊 22） */
const GLASS_BASE =
  'bg-white/70 dark:bg-white/[0.06] backdrop-blur-2xl ring-1 ring-black/[0.05] dark:ring-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.035)]';
/** 标准毛玻璃卡（28px 圆角） */
const GLASS = `rounded-[28px] ${GLASS_BASE}`;
/** 收纳区小胶囊 chip（云端恢复 / 记录 / 导入） */
const CHIPO =
  'rounded-full bg-black/[0.04] dark:bg-white/[0.07] px-3.5 py-2 text-[12.5px] font-medium text-zinc-600 dark:text-zinc-300 transition active:scale-95 disabled:opacity-40';

/** 毛玻璃 AlertDialog 内容壳 + iOS 上下分区按钮样式 */
const DLG = 'w-[300px] gap-0 rounded-[28px] border-0 bg-white/95 dark:bg-zinc-900/95 p-0 backdrop-blur-2xl sm:max-w-[300px]';
const DLG_CANCEL =
  'h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-normal text-zinc-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.04] dark:text-zinc-300 dark:active:bg-white/[0.06] sm:mt-0';
const DLG_DIVIDER = 'w-px shrink-0 self-stretch bg-zinc-200/80 dark:bg-zinc-700';
const DLG_RED =
  'h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-bold text-red-600 shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-red-500/[0.08] dark:text-red-400 sm:mt-0';
const DLG_BLUE =
  'h-11 flex-1 rounded-none border-0 bg-transparent text-[14px] font-bold text-[#007AFF] shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-[#007AFF]/[0.08] dark:text-[#0A84FF] sm:mt-0';

/** 云端备份时间文案：刚刚 / N 分钟前 / N 小时前 / M月D日 HH:mm */
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

/** 自动备份间隔 / 云端保留份数选项 */
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

/** 胶囊样式小下拉（自动备份开启后的间隔 / 保留） */
function MiniSelect({
  value, onChange, options, label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label className="relative inline-flex items-center gap-1 rounded-full bg-black/[0.04] px-3 py-1.5 text-[11px] ring-1 ring-black/[0.04] dark:bg-white/[0.07] dark:ring-white/[0.08]">
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
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 h-3 w-3 text-zinc-400" />
    </label>
  );
}

/** 毛玻璃危险确认弹窗（清理红字 / 恢复蓝字共用壳） */
function GlassConfirm({
  open, onOpenChange, icon, title, desc, actionLabel, actionCls, onAction, busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  icon: ReactNode;
  title: string;
  desc: ReactNode;
  actionLabel: string;
  actionCls: string;
  onAction: () => void;
  busy: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={DLG}>
        <AlertDialogHeader className="gap-2 px-5 pb-4 pt-5 sm:text-left">
          <AlertDialogTitle className="flex items-center gap-2 text-left text-[16px] font-bold">
            {icon}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {desc}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-0 border-t border-black/[0.06] sm:flex-row dark:border-white/[0.08]">
          <AlertDialogCancel className={DLG_CANCEL}>再想想</AlertDialogCancel>
          <span aria-hidden className={DLG_DIVIDER} />
          <AlertDialogAction disabled={busy} className={actionCls} onClick={onAction}>
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------- 应用占用宫格胶囊（短按 / 长按手势） ----------------

/**
 * 紧凑宫格胶囊（双列网格单元）：图标 + 名称 + 已备份绿点，不显示占用大小。
 * 短按（<500ms 且无移动）进详情页 / 多选下切换勾选；
 * 长按（按住 >=480ms，移动超 10px 取消）进入多选并勾选当前卡。
 * pointer events 自实现（触摸隐式捕获保证抬手事件必达），键盘 Enter/Space 等价短按。
 */
function AppCell({
  app, safe, selected, multiMode, disabled, onTap, onLongPress,
}: {
  app: AppModuleDef;
  safe: boolean;
  selected: boolean;
  multiMode: boolean;
  disabled: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const movedRef = useRef(false);
  const firedRef = useRef(false); // 长按已触发（抬手不再当短按）

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    firedRef.current = false;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (movedRef.current) return;
      firedRef.current = true;
      onLongPress();
      try {
        navigator.vibrate?.(10); // 轻触感反馈（支持的设备上）
      } catch {
        /* 忽略 */
      }
    }, 480);
  };

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (timerRef.current === null && !firedRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (dx * dx + dy * dy > 100) {
      movedRef.current = true; // 移动超过 10px：视为滚动，取消长按
      clearTimer();
    }
  };

  const handleUp = () => {
    clearTimer();
    if (firedRef.current) {
      firedRef.current = false; // 长按刚触发，本次抬手不当作短按
      return;
    }
    if (movedRef.current) return;
    if (Date.now() - startRef.current.t >= 500) return;
    onTap();
  };

  const cancel = () => {
    clearTimer();
    if (timerRef.current === null) movedRef.current = true;
    firedRef.current = false;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${app.label}，${safe ? '已备份，' : ''}长按多选`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!disabled) onTap();
        }
      }}
      className={`flex h-14 w-full cursor-pointer select-none items-center gap-2 px-3 transition-all duration-200 [-webkit-touch-callout:none] ${
        selected && multiMode
          ? 'scale-[1.03] rounded-full bg-[#007AFF]/[0.06] ring-1 ring-[#007AFF]/40 backdrop-blur-2xl shadow-[0_2px_12px_rgba(0,0,0,0.035)] dark:bg-[#007AFF]/[0.10]'
          : `rounded-full ${GLASS_BASE}`
      } ${disabled ? 'opacity-60' : 'active:scale-[0.98]'}`}
    >
      {/* 彩色原样 App 图标 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={app.icon} alt={`${app.label}图标`} className="h-9 w-9 shrink-0 rounded-[11px] object-cover" draggable={false} />

      {/* 名称（已备份加绿点），不显示占用大小 */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1">
          <span className="truncate text-[14px] font-semibold leading-tight text-zinc-800 dark:text-zinc-100">{app.label}</span>
          {safe && <span aria-label="已备份" title="已备份" className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#34C759]" />}
        </p>
      </div>
      <span className="sr-only">长按进入多选</span>

      {/* 多选模式：右侧圆形勾选框 */}
      {multiMode && (
        <span
          aria-hidden
          className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 transition-all duration-200 ${
            selected ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-zinc-300 dark:border-zinc-600'
          }`}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3.2} />}
        </span>
      )}
    </div>
  );
}

/** 数据未加载时的骨架宫格胶囊 */
function SkeletonCell() {
  return (
    <div aria-hidden className="flex h-14 w-full animate-pulse items-center gap-2 rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
      <div className="h-9 w-9 shrink-0 rounded-[11px] bg-black/[0.06] dark:bg-white/[0.08]" />
      <div className="h-3 w-3/4 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
    </div>
  );
}

// ---------------- 根组件 ----------------

export default function DataManager() {
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
  const [multiMode, setMultiMode] = useState(false);
  const [busy, setBusy] = useState<'' | 'backup' | 'clean' | 'cloud' | 'restore' | 'import'>('');

  // 危险确认弹窗
  const [confirmClean, setConfirmClean] = useState<string[] | null>(null);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [confirmRestoreRow, setConfirmRestoreRow] = useState<BackupRow | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; file: File; summary: string } | null>(null);

  const importRef = useRef<HTMLInputElement | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const openSettings = useUI((s) => s.switchToApp);

  // ---- 刷新：实测各 App 占用 + 备份基线 + 云端记录 ----
  const refresh = useCallback(async (withCloud = true) => {
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
  }, []);

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

  // 媒体自动清理开启后静默执行一次（cleanMedia 内部 24h 节流）
  useEffect(() => {
    if (mediaAuto) void cleanMedia({ auto: true }).catch(() => undefined);
  }, [mediaAuto]);

  // 计时器卸载清理
  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  // ---- 派生数据 ----
  const sorted = [...(stats ?? [])].sort((a, b) => b.bytes - a.bytes);
  const statOf = (id: string) => (stats ?? []).find((s) => s.id === id);
  const totalBytes = (stats ?? []).reduce((s, x) => s + x.bytes, 0);
  const totalRecords = (stats ?? []).reduce((s, x) => s + x.records, 0);
  const safeBytes = (stats ?? []).filter((s) => backup && isAppSafe(s, backup)).reduce((s, x) => s + x.bytes, 0);
  const dirtyBytes = Math.max(0, totalBytes - safeBytes);
  const allSelected = sel.size === APP_MODULES.length;

  const lastBackupText = (() => {
    if (!backup || backup.lastAt <= 0) return '从未备份';
    const via = backup.lastCloudAt >= backup.lastLocalAt && backup.lastCloudAt > 0 ? '云端' : '本地导出';
    return `${fmtCloudTime(backup.lastAt)} · ${via}`;
  })();

  const latestCloud = cloudRows.length > 0 ? cloudRows[0] : null;

  // ---- 多选 ----
  const toggleSel = (id: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 延迟收起多选态（先清空选择让悬浮栏滑出）；期间再进入多选则取消 */
  const scheduleExitMulti = () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setMultiMode(false);
    }, 300);
  };

  const enterMulti = (id: string) => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (multiMode) {
      toggleSel(id);
      return;
    }
    setMultiMode(true);
    setSel(new Set([id]));
  };

  const exitMulti = () => {
    setSel(new Set());
    scheduleExitMulti();
  };

  const selectAll = () => setSel(allSelected ? new Set() : new Set(APP_MODULES.map((a) => a.id)));

  // ---- 备份（本地导出，按 App 过滤） ----
  const backupApps = async (ids: string[]) => {
    if (busy || ids.length === 0) return;
    const apps = ids.map((id) => appOf(id)).filter((a): a is AppModuleDef => !!a);
    const names = apps.length > 2 ? `${apps.length} 个应用` : apps.map((a) => a.label).join('、');
    setBusy('backup');
    try {
      const r = await exportBackupToDownload({ filter: appBackupFilter(ids) });
      if (r.savedVia === 'native') {
        toast.success(`已备份 ${names} · ${formatBytesAscii(r.bytes)} · 已存 Download/${r.filename}`);
      } else if (r.savedVia === 'browser') {
        toast.success(`已备份 ${names} · ${formatBytesAscii(r.bytes)}`);
      } else {
        toast.error('文件已生成，但当前 APP 版本不支持应用内保存，请用浏览器打开重试');
      }
      await refresh(false);
    } catch (err) {
      toast.error(err instanceof Error ? `备份失败：${err.message}` : '导出失败，请重试');
    } finally {
      setBusy('');
    }
  };

  // ---- 清理（危险操作，必须先过确认弹窗；成功后可带收尾回调） ----
  const runClean = async (ids: string[], after?: () => void) => {
    if (busy || ids.length === 0) return;
    setBusy('clean');
    try {
      const r = await clearAppData(ids);
      toast.success(`已清理 · 释放 ${formatBytesAscii(r.bytes)}`);
      setSel(new Set());
      scheduleExitMulti();
      after?.();
      await refresh(false);
    } catch {
      toast.error('清理失败，请重试');
    } finally {
      setBusy('');
    }
  };

  // ---- 一键云备份（Supabase 全量） ----
  const doCloudBackup = async () => {
    if (busy) return;
    if (!backup?.cloudReady) {
      toast.error('请先在 设置 › 云端助手 部署 Supabase');
      return;
    }
    setBusy('cloud');
    try {
      const r = await runBackup('manual');
      if (r.ok) {
        toast.success(`云端备份完成 · ${formatBytesAscii(r.size ?? 0)}`);
        const p = await readBackupPrefs();
        await pruneBackups(p.keep);
      } else {
        toast.error(r.message ?? '备份失败，请稍后重试');
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
    try {
      const r = await restoreCloudBackup(row);
      if (r.ok) {
        toast.success('云端恢复完成，部分页面需重进 App 刷新');
        await refresh(false);
      } else {
        toast.error(r.message ?? '恢复失败，请稍后重试');
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
      toast.success('已删除云端备份');
      await refresh();
    } finally {
      setBusy('');
    }
  };

  // ---- 本地备份文件导入（先导出安全备份，再恢复，成功后 1.4s 刷新） ----
  const doImportFile = async (file: File) => {
    if (busy) return;
    setBusy('import');
    try {
      try {
        await exportBackupToDownload({ safety: true });
      } catch (err) {
        throw new Error(`恢复前安全备份失败（已中止恢复）：${err instanceof Error ? err.message : '未知错误'}`);
      }
      const r = await restoreLocalBackup(file);
      toast.success(`恢复成功 · ${r.records} 条数据 · 即将刷新`);
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败，请重试');
      setBusy('');
    } finally {
      setPendingImport(null);
    }
  };

  // ---- 健康检查已删（v2.4.31）：快捷操作区改为 备份 / 清除数据 / 导入备份 三胶囊 ----

  // ---- 清理确认弹窗文案 ----
  const confirmTarget = confirmClean ?? (confirmGlobal ? APP_MODULES.map((a) => a.id) : []);
  const confirmName =
    confirmGlobal || confirmTarget.length > 2
      ? `${confirmTarget.length} 个应用`
      : confirmTarget.map((id) => appOf(id)?.label ?? id).join('、');
  const confirmBytes = confirmTarget.reduce((s, id) => s + (statOf(id)?.bytes ?? 0), 0);
  const confirmRecords = confirmTarget.reduce((s, id) => s + (statOf(id)?.records ?? 0), 0);

  return (
    <div className={`${PAGE_BG} min-h-full pb-12 text-zinc-800 antialiased dark:text-zinc-100`}>
      {/* ============ 1) Hero 毛玻璃总览（多选时收起） ============ */}
      <div
        className={`overflow-hidden px-4 pt-3 transition-all duration-300 ${
          multiMode ? 'max-h-0 -translate-y-2 pt-0 opacity-0' : 'max-h-[220px] opacity-100'
        }`}
      >
        <div className={`${GLASS_BASE} relative rounded-[32px] p-5`}>
          <div className="flex items-start justify-between gap-3">
            {/* 左：总占用大数字 + 概览小字 */}
            <div className="min-w-0 pt-1">
              <p className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-zinc-900 dark:text-white">
                {stats ? formatBytesAscii(totalBytes) : '…'}
              </p>
              <p className="mt-2.5 text-[12px] text-zinc-400">
                {stats ? `${stats.length} 个应用 · ${totalRecords} 项数据` : '正在扫描…'}
              </p>
            </div>
            {/* 右：刷新胶囊 + 已备份 / 可清理状态胶囊 */}
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <button
                type="button"
                aria-label="重新扫描"
                onClick={() => void refresh()}
                disabled={scanning}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 ring-1 ring-black/[0.05] backdrop-blur-xl transition active:scale-90 disabled:opacity-50 dark:bg-white/[0.08] dark:ring-white/[0.1]"
              >
                <RefreshCw className={`h-4 w-4 text-zinc-500 dark:text-zinc-300 ${scanning ? 'animate-spin' : ''}`} aria-hidden />
              </button>
              <span className="flex items-center gap-1.5 rounded-full bg-[#34C759]/[0.10] px-2.5 py-1 text-[11px] font-medium text-[#248A3D] dark:text-[#30D158]">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#34C759]" />
                已备份 {formatBytesAscii(safeBytes)}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-white/[0.08] dark:text-zinc-400">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                可清理 {formatBytesAscii(dirtyBytes)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ============ 2) 应用占用列表（多选时标题行切换为选择栏） ============ */}
      {multiMode ? (
        <div className="flex items-center gap-2 px-5 pb-2.5 pt-1">
          <h2 className="text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">已选 {sel.size} 项</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={selectAll}
            className="rounded-full bg-black/[0.05] px-3.5 py-1.5 text-[12px] font-medium text-zinc-600 transition active:scale-95 dark:bg-white/[0.1] dark:text-zinc-300"
          >
            {allSelected ? '全不选' : '全选'}
          </button>
          <button
            type="button"
            onClick={exitMulti}
            className="rounded-full bg-[#007AFF]/10 px-3.5 py-1.5 text-[12px] font-semibold text-[#007AFF] transition active:scale-95 dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]"
          >
            完成
          </button>
        </div>
      ) : (
        <div className="flex items-baseline justify-between px-5 pb-2.5 pt-6">
          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">应用占用</h2>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">按大小排序</span>
        </div>
      )}

      <section aria-label="应用占用列表" className="px-4">
        <div className="grid grid-cols-2 gap-2.5">
          {stats === null
            ? [0, 1, 2, 3, 4, 5].map((i) => <SkeletonCell key={i} />)
            : sorted.map((stat) => {
                const app = appOf(stat.id);
                if (!app) return null;
                return (
                  <AppCell
                    key={app.id}
                    app={app}
                    safe={backup ? isAppSafe(stat, backup) : false}
                    selected={sel.has(app.id)}
                    multiMode={multiMode}
                    disabled={busy !== ''}
                    onTap={() => {
                      if (multiMode) toggleSel(app.id); // v2.4.31：非多选短按不再进详情页（长按进入多选）
                    }}
                    onLongPress={() => enterMulti(app.id)}
                  />
                );
              })}
        </div>
      </section>

      {/* ============ 3) 悬浮毛玻璃操作栏（多选 > 0 时滑出） ============ */}
      {multiMode && (
        <div
          aria-hidden={sel.size === 0}
          className={`sticky bottom-4 z-30 mt-4 px-4 transition-all duration-300 ease-out ${
            sel.size > 0 ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-16 opacity-0'
          }`}
        >
          <div className="flex items-center gap-2 rounded-full bg-white/85 px-3 py-2.5 ring-1 ring-black/[0.06] shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-2xl dark:bg-zinc-900/85 dark:ring-white/[0.1]">
            <button
              type="button"
              onClick={() => void backupApps([...sel])}
              disabled={busy !== ''}
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#007AFF] px-2 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
            >
              {busy === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
              备份选中 ({sel.size})
            </button>
            <button
              type="button"
              onClick={() => setConfirmClean([...sel])}
              disabled={busy !== ''}
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#FF3B30] px-2 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
            >
              {busy === 'clean' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              清理选中 ({sel.size})
            </button>
            <button
              type="button"
              aria-label="取消多选"
              onClick={exitMulti}
              className="flex h-10 shrink-0 items-center rounded-full bg-black/[0.05] px-3.5 text-[12.5px] font-medium text-zinc-500 transition active:scale-95 dark:bg-white/[0.1] dark:text-zinc-400"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ============ 5) 快捷操作（一键云端备份 + 备份/清除数据/导入备份） ============ */}
      <h2 className="px-5 pb-2.5 pt-7 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">快捷操作</h2>
      <section aria-label="快捷操作" className="px-4">
        <button
          type="button"
          onClick={() => void doCloudBackup()}
          disabled={busy !== ''}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#007AFF] text-[14px] font-semibold text-white shadow-[0_6px_20px_rgba(0,122,255,0.35)] transition active:scale-[0.97] disabled:opacity-50"
        >
          {busy === 'cloud' ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <CloudUpload className="h-[18px] w-[18px]" aria-hidden />
          )}
          {busy === 'cloud' ? '备份中…' : '一键云端备份'}
        </button>

        {/* v2.4.31 三胶囊：备份（本地全量导出）/ 清除数据（危险，过全局确认弹窗）/ 导入备份（文件选择器） */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => void backupApps(APP_MODULES.map((a) => a.id))}
            disabled={busy !== ''}
            className="flex h-[52px] items-center justify-center gap-1.5 rounded-full bg-white/70 text-[13.5px] font-semibold text-zinc-700 ring-1 ring-black/[0.05] backdrop-blur-2xl transition active:scale-[0.97] disabled:opacity-50 dark:bg-white/[0.06] dark:text-zinc-200 dark:ring-white/[0.08]"
          >
            {busy === 'backup' ? (
              <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
            ) : (
              <CloudUpload className="h-[17px] w-[17px] text-[#007AFF]" aria-hidden />
            )}
            {busy === 'backup' ? '备份中…' : '备份'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmGlobal(true)}
            disabled={busy !== ''}
            className="flex h-[52px] items-center justify-center gap-1.5 rounded-full bg-[#FF3B30]/[0.08] text-[13.5px] font-semibold text-[#D70015] ring-1 ring-[#FF3B30]/25 backdrop-blur-2xl transition active:scale-[0.97] disabled:opacity-50 dark:text-[#FF453A]"
          >
            {busy === 'clean' ? (
              <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-[17px] w-[17px] text-[#FF3B30]" aria-hidden />
            )}
            {busy === 'clean' ? '清理中…' : '清除数据'}
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={busy !== ''}
            className="flex h-[52px] items-center justify-center gap-1.5 rounded-full bg-white/70 text-[13.5px] font-semibold text-zinc-700 ring-1 ring-black/[0.05] backdrop-blur-2xl transition active:scale-[0.97] disabled:opacity-50 dark:bg-white/[0.06] dark:text-zinc-200 dark:ring-white/[0.08]"
          >
            {busy === 'import' ? (
              <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
            ) : (
              <Download className="h-[17px] w-[17px] text-[#34C759]" aria-hidden />
            )}
            {busy === 'import' ? '导入中…' : '导入备份'}
          </button>
        </div>
      </section>

      {/* ============ 7) 云端与恢复（安静收纳区） ============ */}
      <h2 className="px-5 pb-2.5 pt-7 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">云端与恢复</h2>
      <section aria-label="云端与恢复" className="px-4">
        <div className={`${GLASS} p-4`}>
          {/* 首行：上次备份 + 云端状态点 */}
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${backup?.cloudReady ? 'bg-[#34C759]' : 'bg-zinc-300 dark:bg-zinc-600'}`}
            />
            <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">上次备份</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-400">{lastBackupText}</span>
          </div>

          {/* 一行小胶囊 chips */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => latestCloud && setConfirmRestoreRow(latestCloud)}
              disabled={busy !== '' || !latestCloud}
              className={CHIPO}
            >
              云端恢复
            </button>
            <button
              type="button"
              onClick={() => setShowRecords((v) => !v)}
              disabled={busy !== ''}
              aria-expanded={showRecords}
              className={`flex items-center gap-1 ${CHIPO}`}
            >
              备份记录{cloudRows.length > 0 ? ` (${cloudRows.length})` : ''}
              <ChevronDown className={`h-3 w-3 text-zinc-400 transition-transform ${showRecords ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={busy !== ''} className={CHIPO}>
              导入备份文件
            </button>
            <span className="flex items-center gap-2 rounded-full bg-black/[0.04] px-3.5 py-2 text-[12.5px] font-medium text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300">
              自动备份
              <Switch
                checked={!!prefs?.auto}
                onCheckedChange={(v) => {
                  setPrefs((p) => (p ? { ...p, auto: v } : p));
                  void writeBackupPrefs({ auto: v });
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
          </div>

          {/* 云端备份记录列表（自定义细滚动条） */}
          {showRecords && (
            <div className="mt-3 max-h-64 overflow-y-auto overscroll-contain rounded-[22px] bg-black/[0.03] ring-1 ring-black/[0.04] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/10 dark:bg-white/[0.04] dark:ring-white/[0.06] dark:[&::-webkit-scrollbar-thumb]:bg-white/15">
              {cloudRows.length === 0 ? (
                <p className="px-3 py-5 text-center text-[12px] text-zinc-400">
                  {backup?.cloudReady ? '云端还没有备份' : '未部署云端助手'}
                </p>
              ) : (
                cloudRows.slice(0, 20).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2.5 text-[12px] last:border-b-0 dark:border-white/[0.06]"
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        row.kind === 'auto' ? 'bg-zinc-300 dark:bg-zinc-600' : 'bg-[#34C759]'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">
                      {fmtCloudTime(Date.parse(row.created_at ?? '') || 0)} · {row.kind === 'auto' ? '自动' : '手动'}
                      {row.size_bytes ? ` · ${formatBytesAscii(row.size_bytes)}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmRestoreRow(row)}
                      disabled={busy !== ''}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium text-[#007AFF] transition active:scale-95 disabled:opacity-40 dark:text-[#0A84FF]"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      aria-label="删除这条云端备份"
                      onClick={() => void doDeleteCloudRow(row)}
                      disabled={busy !== ''}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-zinc-400 transition hover:text-[#FF3B30] active:scale-95 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 持久化状态行 */}
          <div className="mt-3 flex items-center gap-2 text-[11.5px]">
            {persisted === null ? (
              <span className="text-zinc-400">持久化存储 · 检测中…</span>
            ) : persisted ? (
              <span className="font-medium text-[#248A3D] dark:text-[#30D158]">持久化存储 已开启</span>
            ) : (
              <button
                type="button"
                onClick={() => void ensurePersistentStorage().then((ok) => setPersisted(ok))}
                className="text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
              >
                点此开启持久化
              </button>
            )}
          </div>

          {/* 云端未部署引导 */}
          {backup && !backup.cloudReady && (
            <button
              type="button"
              onClick={() => openSettings('settings')}
              className="mt-2 w-full text-left text-[11.5px] leading-relaxed text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
            >
              ↳ 前往 设置 › 云端助手 完成 Supabase 部署
            </button>
          )}
        </div>
      </section>

      {/* ============ 8) 危险确认弹窗（毛玻璃 iOS 分区按钮） ============ */}
      <GlassConfirm
        open={confirmClean !== null || confirmGlobal}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmClean(null);
            setConfirmGlobal(false);
          }
        }}
        busy={busy !== ''}
        icon={<Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />}
        title={`清理「${confirmName}」`}
        actionLabel="确认清理"
        actionCls={DLG_RED}
        onAction={() => {
          const ids = confirmTarget;
          setConfirmClean(null);
          setConfirmGlobal(false);
          void runClean(ids);
        }}
        desc={
          <>
            将清空{confirmGlobal ? '全部' : ''}「{confirmName}」的本机数据：
            <br />
            共 <b className="tabular-nums text-zinc-700 dark:text-zinc-200">{formatBytesAscii(confirmBytes)}</b> · {confirmRecords} 项。
            {confirmGlobal && (
              <>
                <br />
                <span className="text-red-600 dark:text-red-400">包括设置、账号绑定与 API Key——建议先完成云端备份。</span>
              </>
            )}
            <br />
            此操作不可撤销，确认继续？
          </>
        }
      />

      {/* 云端恢复确认 */}
      <GlassConfirm
        open={!!confirmRestoreRow}
        onOpenChange={(o) => !o && setConfirmRestoreRow(null)}
        busy={busy !== ''}
        icon={<CloudUpload className="h-4 w-4 text-[#007AFF] dark:text-[#0A84FF]" aria-hidden />}
        title="从云端恢复？"
        actionLabel="确认恢复"
        actionCls={DLG_BLUE}
        onAction={() => confirmRestoreRow && void doCloudRestore(confirmRestoreRow)}
        desc={
          confirmRestoreRow
            ? `将用 ${fmtCloudTime(Date.parse(confirmRestoreRow.created_at ?? '') || 0)} 的云端备份覆盖本机的聊天 / 记忆 / 联系人 / 世界书 / 论坛等数据。此操作不可撤销，确认继续？`
            : ''
        }
      />

      {/* 本地备份文件导入确认 */}
      <GlassConfirm
        open={!!pendingImport}
        onOpenChange={(o) => !o && setPendingImport(null)}
        busy={busy !== ''}
        icon={<CloudUpload className="h-4 w-4 text-[#007AFF] dark:text-[#0A84FF]" aria-hidden />}
        title="恢复备份文件？"
        actionLabel="确认恢复"
        actionCls={DLG_BLUE}
        onAction={() => pendingImport && void doImportFile(pendingImport.file)}
        desc={
          pendingImport
            ? `将用「${pendingImport.name}」覆盖文件内模块的当前数据（先清空再恢复），其它 App 不受影响。备份内容：${pendingImport.summary}。确认后先自动导出当前数据为安全备份，再执行恢复。`
            : ''
        }
      />

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
              toast.error(err instanceof Error ? err.message : '备份文件无效');
            }
          })();
        }}
      />

    </div>
  );
}
