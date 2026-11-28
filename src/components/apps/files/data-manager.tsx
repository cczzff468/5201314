'use client';

/**
 * 文件 App · 存储管理（v2.4.36 · iPhone 储存空间截图复刻）
 *
 * 机主规格（对照 iOS「iPhone 储存空间」设置页逐项复刻）：
 * - 页面纯色化：浅色 #F2F2F4 / 深色 #0E0E12；所有卡片改为不透明白（深色 #1C1C1E），
 *   rounded-[26px] + 极弱弥散投影，去掉毛玻璃模糊与 ring 描边，操作按钮一律胶囊；
 * - Hero：Cove 大标题 + 「已使用 X / Y」+「可用 Z」+ iOS 四段色进度条
 *   （红 #FF3B30 / 橙 #FF9500 / 黄 #FFCC00 / 浅灰 #C7C7CC）+ 图例行；
 * - 新增「推荐」区：自动清理媒体缓存 / 云端自动备份 两张开关卡（分别沿用
 *   mediaAuto→writeMediaAutoClean 与 prefs.auto→writeBackupPrefs 既有持久化逻辑）；
 * - 应用占用：单张白卡列表行（46px 图标 + 名称 + 「上次备份」副行 + 大小 + chevron），
 *   分隔线从文本列起笔；新增「大小/名称」排序胶囊 + 底部悬浮搜索胶囊（实时过滤，
 *   搜索时收起推荐 / 快捷操作 / 云端与恢复）；
 * - 快捷操作（备份 / 导入备份 / 清除数据）与云端与恢复区功能全量保留，仅换白卡皮肤；
 * - 长按多选 / 确认弹窗 / 导入免刷新 / 持久化检测等数据层逻辑零改动。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpDown, Check, ChevronDown, CloudUpload, Download, HardDrive, Loader2,
  Mic, RefreshCw, Search, Sparkles, Trash2, X,
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
  cleanMedia, ensurePersistentStorage, readMediaAutoClean, writeMediaAutoClean,
} from '@/lib/ios/storage-stats';
import {
  exportBackupToDownload, inspectBackupFile, restoreBackup as restoreLocalBackup,
} from '@/lib/ios/backup';
import {
  deleteBackup, listBackups, pruneBackups, readBackupPrefs,
  restoreBackup as restoreCloudBackup, runBackup, writeBackupPrefs,
  type BackupRow, type CloudBackupPrefs,
} from '@/lib/ios/cloud-backup';
import { rehydrateKvFromIdb } from '@/lib/ios/idb-kv';
import { useSettings, useUI } from '@/lib/ios/store';

// ---------------- 局部样式基元（v2.4.36 纯色卡片 / 胶囊） ----------------

/** 页面底色：浅色 #F2F2F4，深色 #0E0E12（对照 iPhone 储存空间设置页） */
const PAGE_BG = 'bg-[#F2F2F4] dark:bg-[#0E0E12]';
/** 不透明白卡（26px 圆角 + 极弱弥散投影，无毛玻璃无描边） */
const CARD = 'rounded-[26px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:bg-[#1C1C1E]';
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

// ---------------- 应用占用列表行（短按 / 长按手势） ----------------

/**
 * v2.4.36 iOS 储存空间风列表行：46px 图标列 + 文本列（分隔线从文本列起笔，
 * 不穿过图标），名称 15.5px + 「上次备份」副行，右侧占用大小 + chevron。
 * 短按（<500ms 且无移动）多选下切换勾选；长按（按住 >=480ms，移动超 10px 取消）
 * 进入多选并勾选当前行。pointer events 自实现（触摸隐式捕获保证抬手事件必达），
 * 键盘 Enter/Space 等价短按。
 */
function AppCell({
  app, backupText, size, selected, multiMode, disabled, divider, onTap, onLongPress,
}: {
  app: AppModuleDef;
  /** 第二行副文案（上次备份：X / 未备份，由父级按 isAppSafe 派生） */
  backupText: string;
  /** 占用字节数（右侧主数值 + aria-label） */
  size: number;
  selected: boolean;
  multiMode: boolean;
  disabled: boolean;
  /** 是否绘制文本列顶部分隔线（列表首行 false） */
  divider: boolean;
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
      aria-label={`${app.label}，占用 ${formatBytesAscii(size)}，长按多选`}
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
      className={`relative flex min-h-[68px] w-full cursor-pointer select-none items-stretch [-webkit-touch-callout:none] ${
        selected && multiMode
          ? 'bg-[#007AFF]/[0.06] dark:bg-[#007AFF]/[0.12]'
          : ''
      } ${disabled ? 'opacity-60' : 'active:bg-black/[0.03] dark:active:bg-white/[0.05]'}`}
    >
      {/* 图标列（分隔线不进入此列，对照 iOS 储存空间列表） */}
      <div className="flex w-[62px] shrink-0 items-center self-stretch pl-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={app.icon}
          alt={`${app.label}图标`}
          className="h-[46px] w-[46px] shrink-0 rounded-[12px] object-cover shadow-[0_2px_8px_rgba(0,0,0,0.10)]"
          draggable={false}
        />
      </div>
      {/* 文本列（顶部分隔线从本列起笔） */}
      <div
        className={`flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 ${
          divider ? 'border-t border-black/[0.06] dark:border-white/[0.08]' : ''
        }`}
      >
        {/* 名称 + 「上次备份」副行 */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            {app.label}
          </p>
          <p className="mt-[3px] truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">
            {backupText}
          </p>
        </div>
        <span className="sr-only">长按进入多选</span>

        {/* 右侧：多选 = 勾选圈；普通 = 占用大小 + chevron 引导 */}
        {multiMode ? (
          <span
            aria-hidden
            className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 transition-all duration-200 ${
              selected ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-zinc-300 bg-white/60 dark:border-zinc-600 dark:bg-transparent'
            }`}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-[14px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
              {formatBytesAscii(size)}
            </span>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 -rotate-90 text-black/20 dark:text-white/25"
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** 数据未加载时的骨架行（iOS 列表行样式） */
function SkeletonCell() {
  return (
    <div aria-hidden className="flex min-h-[68px] w-full animate-pulse items-center gap-3 px-4">
      <div className="h-[46px] w-[46px] shrink-0 rounded-[12px] bg-black/[0.06] dark:bg-white/[0.08]" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-2/5 rounded-full bg-black/[0.06] dark:bg-white/[0.08]" />
        <div className="h-2.5 w-1/4 rounded-full bg-black/[0.05] dark:bg-white/[0.06]" />
      </div>
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
  /** 浏览器存储配额（quota/usage，navigator.storage.estimate） */
  const [quota, setQuota] = useState<number | null>(null);

  // ---- 交互状态 ----
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [multiMode, setMultiMode] = useState(false);
  const [busy, setBusy] = useState<'' | 'backup' | 'clean' | 'cloud' | 'pull' | 'restore' | 'import'>('');
  /** v2.4.36 应用占用排序：按大小（默认）/ 按名称 a-z */
  const [sortMode, setSortMode] = useState<'size' | 'name'>('size');
  /** v2.4.36 底部搜索胶囊：按应用名实时过滤 */
  const [query, setQuery] = useState('');

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
      try {
        const est = await navigator.storage?.estimate?.();
        if (est && typeof est.quota === 'number' && est.quota > 0) setQuota(est.quota);
      } catch {
        /* 配额不可用：hero 用总占用+固定盈余做分母 */
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
  /** 按占用大小降序（hero 分段与应用占用默认序共用基准，不受排序切换影响） */
  const bySize = [...(stats ?? [])].sort((a, b) => b.bytes - a.bytes);
  /** 展示序列：按大小（默认）或按名称 a-z（中文按拼音序） */
  const sorted =
    sortMode === 'size'
      ? bySize
      : [...(stats ?? [])].sort((a, b) =>
          (appOf(a.id)?.label ?? a.id).localeCompare(appOf(b.id)?.label ?? b.id, 'zh'),
        );
  const totalBytes = (stats ?? []).reduce((s, x) => s + x.bytes, 0);
  const statOf = (id: string) => (stats ?? []).find((s) => s.id === id);
  const allSelected = sel.size === APP_MODULES.length;

  /** 搜索过滤（按应用名，忽略大小写；空查询 = 全量） */
  const q = query.trim().toLowerCase();
  const searching = q !== '';
  const visibleStats = searching
    ? sorted.filter((s) => (appOf(s.id)?.label ?? s.id).toLowerCase().includes(q))
    : sorted;

  const lastBackupText = (() => {
    if (!backup || backup.lastAt <= 0) return '从未备份';
    const via = backup.lastCloudAt >= backup.lastLocalAt && backup.lastCloudAt > 0 ? '云端' : '本地导出';
    return `${fmtCloudTime(backup.lastAt)} · ${via}`;
  })();

  const latestCloud = cloudRows.length > 0 ? cloudRows[0] : null;

  // ---- hero 派生：配额分母 + 前 4 大应用分段 ----
  /** iOS 系统色分段（红/橙/黄/浅灰——机主截图配色） */
  const SEG_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#C7C7CC'];
  /** hero 分母：优先真实配额（取「已用×2.5」与 1GB 的较大者做下限，防配额≈已用时条顶满）；无配额时已用+512MB */
  const heroDenominator = quota
    ? Math.max(quota, totalBytes * 2.5, 1024 * 1024 * 1024)
    : Math.max(totalBytes + 512 * 1024 * 1024, 1024 * 1024 * 1024);
  /** 前 4 大应用（占用 >0 才上榜）+ 占配额百分比 */
  const segStats = bySize
    .filter((s) => s.bytes > 0)
    .slice(0, 4)
    .map((s) => ({
      app: appOf(s.id),
      pct: (s.bytes / heroDenominator) * 100,
    }))
    .filter((s): s is { app: AppModuleDef; pct: number } => !!s.app);

  // ---- 推荐 · 开关（v2.4.36，沿用既有持久化） ----
  /** 自动清理媒体缓存：写 settings 表；开启后由上方 effect 静默执行一次（24h 节流） */
  const toggleMediaAuto = () => {
    const next = !mediaAuto;
    setMediaAuto(next);
    void writeMediaAutoClean(next).catch(() => undefined);
  };
  /** 云端自动备份：与「云端与恢复」区的自动备份开关同一份数据 */
  const toggleCloudAuto = () => {
    const next = !prefs?.auto;
    setPrefs((p) => (p ? { ...p, auto: next } : p));
    void writeBackupPrefs({ auto: next });
  };

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

  // ---- 拉取备份（从云端拉取最新一份备份 → 确认后恢复） ----
  const doPullBackup = async () => {
    if (busy) return;
    if (!backup?.cloudReady) {
      toast.error('请先在 设置 › 云端助手 部署 Supabase');
      return;
    }
    setBusy('pull');
    try {
      const r = await listBackups();
      if (!r.ok) {
        toast.error(r.message ?? '拉取失败，请稍后重试');
        return;
      }
      const rows = r.rows ?? [];
      setCloudRows(rows);
      const latest = rows[0] ?? null;
      if (!latest) {
        toast.info('云端还没有备份，先点「一键云端备份」存一份吧');
        return;
      }
      // 与「云端恢复」同款确认弹窗（拉到最新一份 → 确认后覆盖恢复）
      setConfirmRestoreRow(latest);
    } catch {
      toast.error('拉取失败，请稍后重试');
    } finally {
      setBusy('');
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

  // ---- 本地备份文件导入（免刷新生效，不再自动下载安全备份） ----
  const doImportFile = async (file: File) => {
    if (busy) return;
    setBusy('import');
    try {
      const r = await restoreLocalBackup(file);
      // 免刷新生效（机主令「导入备份以后不要更新网页」）：
      // ① kv 内存层从 IndexedDB 重新注水（restoreBackup 直写 IDB，内存是旧值）
      // ② 设置 store 重载（settings 表已被备份覆盖）
      // ③ 退回主屏强制重挂载各 App（下次进任何 App 读到的都是新数据）
      // ④ 广播 cove-data-restored：主屏小组件等监听方自行刷新
      try {
        await rehydrateKvFromIdb();
        useSettings.setState({ loaded: false });
        await useSettings.getState().load();
      } catch {
        /* 重注水失败：退回刷新页面兜底 */
        window.location.reload();
        return;
      }
      try {
        useUI.getState().exitForegroundApp();
      } catch {
        /* 不阻塞 */
      }
      window.dispatchEvent(new CustomEvent('cove-data-restored', { detail: { source: 'import', records: r.records } }));
      toast.success(`恢复成功 · ${r.records} 条数据 · 已生效（重进各 App 即可看到）`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败，请重试');
    } finally {
      setBusy('');
      setPendingImport(null);
    }
  };

  // ---- 清理确认弹窗文案 ----
  const confirmTarget = confirmClean ?? (confirmGlobal ? APP_MODULES.map((a) => a.id) : []);
  const confirmName =
    confirmGlobal || confirmTarget.length > 2
      ? `${confirmTarget.length} 个应用`
      : confirmTarget.map((id) => appOf(id)?.label ?? id).join('、');
  const confirmBytes = confirmTarget.reduce((s, id) => s + (statOf(id)?.bytes ?? 0), 0);
  const confirmRecords = confirmTarget.reduce((s, id) => s + (statOf(id)?.records ?? 0), 0);

  return (
    <div className={`${PAGE_BG} flex min-h-full flex-col text-zinc-800 antialiased dark:text-zinc-100`}>
      {/* ============ 1) Hero（iOS 储存空间风：Cove 标题 + 已使用 X/Y + 可用 Z + 分段进度条 + 图例） ============ */}
      <div
        className={`overflow-hidden px-4 pt-4 transition-all duration-300 ${
          multiMode ? 'max-h-0 -translate-y-2 pt-0 opacity-0' : 'max-h-[360px] opacity-100'
        }`}
      >
        <div className={`${CARD} relative p-5`}>
          {/* 第一行：Cove 大标题 + 右侧刷新按钮 + 已使用 / 可用 */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[24px] font-bold leading-tight tracking-tight text-zinc-900 dark:text-white">Cove</p>
              {stats ? (
                <>
                  <p className="mt-1.5 text-[12px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                    已使用 {formatBytesAscii(totalBytes)} / {formatBytesAscii(heroDenominator)}
                  </p>
                  <p className="mt-[2px] text-[12px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                    可用 {formatBytesAscii(Math.max(0, heroDenominator - totalBytes))}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">正在扫描…</p>
              )}
            </div>
            <button
              type="button"
              aria-label="重新扫描"
              onClick={() => void refresh()}
              disabled={scanning}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] transition active:scale-90 disabled:opacity-50 dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              <RefreshCw className={`h-4 w-4 text-zinc-500 dark:text-zinc-300 ${scanning ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>

          {/* 第二行：iOS 分段储存进度条（前 4 大应用分段着色，其余为可用空间） */}
          <div
            aria-label="储存占用构成"
            className="mt-4 flex h-[14px] w-full gap-[2px] overflow-hidden rounded-full bg-black/[0.05] p-0 dark:bg-white/[0.08]"
          >
            {segStats.map((s, i) => (
              <span
                key={s.app.id}
                aria-hidden
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ backgroundColor: SEG_COLORS[i % SEG_COLORS.length], width: `${Math.max(1.5, Math.min(100, s.pct))}%` }}
              />
            ))}
          </div>

          {/* 第三行：图例（前 4 大应用 + 可用空间） */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {segStats.map((s, i) => (
              <span key={s.app.id} className="flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-600 dark:text-zinc-300">
                <span
                  aria-hidden
                  className="h-[9px] w-[9px] rounded-full"
                  style={{ backgroundColor: SEG_COLORS[i % SEG_COLORS.length] }}
                />
                {s.app.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-600 dark:text-zinc-300">
              <span aria-hidden className="h-[9px] w-[9px] rounded-full bg-black/[0.08] dark:bg-white/[0.14]" />
              可用空间
            </span>
          </div>
        </div>
      </div>

      {/* ============ 2) 推荐（v2.4.36 新增，对照「卸载未使用的 App」推荐卡；搜索时隐藏） ============ */}
      {!searching && (
        <>
          <h2 className="px-5 pb-2.5 pt-7 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">推荐</h2>
          <section aria-label="推荐" className="px-4">
            <div className="flex flex-col gap-3">
              {/* 自动清理媒体缓存（沿用 mediaAuto 持久化） */}
              <div className={`${CARD} p-4`}>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[8px] bg-[#007AFF] dark:bg-[#0A84FF]"
                  >
                    <Sparkles className="h-[19px] w-[19px] text-white" />
                  </span>
                  <p className="min-w-0 flex-1 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">自动清理媒体缓存</p>
                  <button
                    type="button"
                    onClick={toggleMediaAuto}
                    aria-pressed={mediaAuto}
                    aria-label="切换自动清理媒体缓存"
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-semibold transition active:scale-95 ${
                      mediaAuto
                        ? 'text-[#248A3D] dark:text-[#30D158]'
                        : 'text-[#007AFF] active:bg-[#007AFF]/[0.08] dark:text-[#0A84FF] dark:active:bg-[#0A84FF]/[0.15]'
                    }`}
                  >
                    {mediaAuto ? (
                      <>
                        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        已开启
                      </>
                    ) : (
                      '启用'
                    )}
                  </button>
                </div>
                <p className="mt-2.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  开启后自动释放媒体缓存空间。储存空间不足时自动清理已备份的临时媒体，你的聊天记录与文稿数据将会保存。
                </p>
              </div>

              {/* 云端自动备份（沿用 prefs.auto 持久化，与云端与恢复区同源） */}
              <div className={`${CARD} p-4`}>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[8px] bg-[#007AFF] dark:bg-[#0A84FF]"
                  >
                    <HardDrive className="h-[19px] w-[19px] text-white" />
                  </span>
                  <p className="min-w-0 flex-1 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">云端自动备份</p>
                  <button
                    type="button"
                    onClick={toggleCloudAuto}
                    aria-pressed={!!prefs?.auto}
                    aria-label="切换云端自动备份"
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] font-semibold transition active:scale-95 ${
                      prefs?.auto
                        ? 'text-[#248A3D] dark:text-[#30D158]'
                        : 'text-[#007AFF] active:bg-[#007AFF]/[0.08] dark:text-[#0A84FF] dark:active:bg-[#0A84FF]/[0.15]'
                    }`}
                  >
                    {prefs?.auto ? (
                      <>
                        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                        已开启
                      </>
                    ) : (
                      '启用'
                    )}
                  </button>
                </div>
                <p className="mt-2.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  定期自动备份全部应用数据到云端，换机或清数据后可一键恢复。
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ============ 3) 应用占用列表（多选时标题行切换为选择栏；标题行含排序胶囊） ============ */}
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
        <div className="flex items-center justify-between px-5 pb-2.5 pt-7">
          <h2 className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">应用占用</h2>
          {/* 排序胶囊：大小（默认）/ 名称 a-z，点击切换 */}
          <button
            type="button"
            onClick={() => setSortMode((m) => (m === 'size' ? 'name' : 'size'))}
            aria-label={sortMode === 'size' ? '当前按大小排序，点击改为按名称排序' : '当前按名称排序，点击改为按大小排序'}
            className="flex items-center gap-1 rounded-full bg-[#007AFF]/[0.10] px-3 py-[5px] text-[13px] font-medium text-[#007AFF] transition active:scale-95 dark:bg-[#0A84FF]/[0.18] dark:text-[#0A84FF]"
          >
            {sortMode === 'size' ? '大小' : '名称'}
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <section aria-label="应用占用列表" className="px-4">
        {/* 单张不透明白卡 + 列表行（分隔线从文本列起笔，不穿过图标） */}
        <div className={`${CARD} overflow-hidden`}>
          {stats === null ? (
            [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <SkeletonCell key={i} />)
          ) : visibleStats.length === 0 ? (
            <p className="px-4 py-12 text-center text-[13px] text-zinc-400 dark:text-zinc-500">无匹配应用</p>
          ) : (
            visibleStats.map((stat, idx) => {
              const app = appOf(stat.id);
              if (!app) return null;
              const safe = backup ? isAppSafe(stat, backup) : false;
              return (
                <AppCell
                  key={app.id}
                  app={app}
                  backupText={safe && backup ? `上次备份：${fmtCloudTime(backup.lastAt)}` : '未备份'}
                  size={stat.bytes}
                  divider={idx > 0}
                  selected={sel.has(app.id)}
                  multiMode={multiMode}
                  disabled={busy !== ''}
                  onTap={() => {
                    if (multiMode) toggleSel(app.id); // 非多选短按无操作（长按进入多选）
                  }}
                  onLongPress={() => enterMulti(app.id)}
                />
              );
            })
          )}
        </div>
      </section>

      {/* ============ 4) 悬浮毛玻璃操作栏（多选 > 0 时滑出；浮动元素允许毛玻璃） ============ */}
      {multiMode && (
        <div
          aria-hidden={sel.size === 0}
          className={`sticky bottom-4 z-30 mt-4 px-4 transition-all duration-300 ease-out ${
            sel.size > 0 ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-16 opacity-0'
          }`}
        >
          <div className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-2.5 ring-1 ring-black/[0.05] shadow-[0_8px_28px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:bg-[#1C1C1E]/90 dark:ring-white/[0.08]">
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

      {/* ============ 5) 快捷操作（备份 / 导入备份 / 清除数据——清除数据放最后；搜索时隐藏） ============ */}
      {!searching && (
        <>
          <h2 className="px-5 pb-2.5 pt-7 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">快捷操作</h2>
          <section aria-label="快捷操作" className="px-4">
            {/* 三胶囊：不透明白底 + 彩色图标（备份蓝 / 导入绿 / 清除数据红底浅染放最后） */}
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => void backupApps(APP_MODULES.map((a) => a.id))}
                disabled={busy !== ''}
                className="flex h-[50px] items-center justify-center gap-1.5 rounded-full bg-white text-[13px] font-semibold text-zinc-700 shadow-[0_1px_3px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.04] transition active:scale-[0.97] disabled:opacity-50 dark:bg-[#1C1C1E] dark:text-zinc-200 dark:ring-white/[0.06]"
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
                onClick={() => importRef.current?.click()}
                disabled={busy !== ''}
                className="flex h-[50px] items-center justify-center gap-1.5 rounded-full bg-white text-[13px] font-semibold text-zinc-700 shadow-[0_1px_3px_rgba(0,0,0,0.03)] ring-1 ring-black/[0.04] transition active:scale-[0.97] disabled:opacity-50 dark:bg-[#1C1C1E] dark:text-zinc-200 dark:ring-white/[0.06]"
              >
                {busy === 'import' ? (
                  <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
                ) : (
                  <Download className="h-[17px] w-[17px] text-[#34C759]" aria-hidden />
                )}
                {busy === 'import' ? '导入中…' : '导入备份'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmGlobal(true)}
                disabled={busy !== ''}
                className="flex h-[50px] items-center justify-center gap-1.5 rounded-full bg-[#FF3B30]/[0.06] text-[13px] font-semibold text-[#D70015] ring-1 ring-[#FF3B30]/[0.12] transition active:scale-[0.97] disabled:opacity-50 dark:bg-[#FF3B30]/[0.12] dark:text-[#FF453A] dark:ring-[#FF3B30]/[0.25]"
              >
                {busy === 'clean' ? (
                  <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-[17px] w-[17px] text-[#FF3B30]" aria-hidden />
                )}
                {busy === 'clean' ? '清理中…' : '清除数据'}
              </button>
            </div>
          </section>
        </>
      )}

      {/* ============ 6) 云端与恢复（一键云端备份 + 拉取备份 + 记录 / 自动备份 / 持久化；搜索时隐藏） ============ */}
      {!searching && (
        <>
          <h2 className="px-5 pb-2.5 pt-7 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">云端与恢复</h2>
          <section aria-label="云端与恢复" className="px-4">
            <div className={`${CARD} p-4`}>
              {/* 顶部双按钮：一键云端备份（主操作蓝实底） + 拉取备份（蓝描边） */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void doCloudBackup()}
                  disabled={busy !== ''}
                  className="flex h-[50px] items-center justify-center gap-2 rounded-full bg-[#007AFF] text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.25)] transition active:scale-[0.97] disabled:opacity-50 dark:bg-[#0A84FF]"
                >
                  {busy === 'cloud' ? (
                    <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
                  ) : (
                    <CloudUpload className="h-[17px] w-[17px]" aria-hidden />
                  )}
                  {busy === 'cloud' ? '备份中…' : '一键云端备份'}
                </button>
                <button
                  type="button"
                  onClick={() => void doPullBackup()}
                  disabled={busy !== ''}
                  aria-label="从云端拉取最新备份"
                  className="flex h-[50px] items-center justify-center gap-2 rounded-full bg-[#007AFF]/[0.08] text-[13px] font-semibold text-[#007AFF] ring-1 ring-[#007AFF]/25 transition active:scale-[0.97] disabled:opacity-50 dark:bg-[#0A84FF]/[0.14] dark:text-[#0A84FF] dark:ring-[#0A84FF]/30"
                >
                  {busy === 'pull' ? (
                    <Loader2 className="h-[17px] w-[17px] animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-[17px] w-[17px]" aria-hidden />
                  )}
                  {busy === 'pull' ? '拉取中…' : '拉取备份'}
                </button>
              </div>

              {/* 首行：上次备份 + 云端状态点 */}
              <div className="mt-4 flex items-center gap-2">
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
        </>
      )}

      {/* ============ 7) 底部悬浮搜索胶囊（多选时让位给操作栏；mt-auto 保证短内容也贴底） ============ */}
      {!multiMode && (
        <div className="sticky bottom-4 z-30 mt-auto px-4 pb-4 pt-2">
          <div className="flex h-[50px] items-center gap-2.5 rounded-full bg-white/75 px-4 ring-1 ring-black/[0.05] shadow-[0_8px_28px_rgba(0,0,0,0.10)] backdrop-blur-2xl dark:bg-[#1C1C1E]/75 dark:ring-white/[0.08]">
            <Search className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="应用程序"
              aria-label="搜索应用"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-500"
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="清除搜索内容"
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-black/[0.08] text-zinc-500 transition active:scale-90 dark:bg-white/[0.12] dark:text-zinc-400"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            <Mic className="h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
          </div>
        </div>
      )}

      {/* ============ 8) 危险确认弹窗（毛玻璃 iOS 分区按钮，保持原样） ============ */}
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
            ? `将用「${pendingImport.name}」覆盖文件内模块的当前数据（先清空再恢复），其它 App 不受影响。备份内容：${pendingImport.summary}。恢复后立即生效，无需刷新网页。此操作不可撤销，确认继续？`
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
