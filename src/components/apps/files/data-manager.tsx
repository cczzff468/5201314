'use client';

/**
 * 文件 App · 数据管理（机主规格重构）：
 * 设置里所有「存储 / 缓存 / 备份 / 导入导出」能力统一收拢到这里，App 名与图标仍叫「文件」。
 * 视觉自成一派（贯穿式字母分隔线 + 分段环形图 + 反色胶囊选择器），与常规设置列表区分。
 * 区块：模块占用分析 → 浏览器持久化 → 媒体清理 → 云端备份 → 导出与导入 → 模块清理（危险）→ 资料库。
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
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
  cleanMedia,
  cleanRegenerableAssets,
  computeModuleStats,
  DATA_MODULES,
  ensurePersistentStorage,
  clearModules,
  formatBytes,
  readMediaAutoClean,
  readMediaCleanLast,
  writeMediaAutoClean,
  type ModuleStat,
} from '@/lib/ios/storage-stats';

import {
  exportBackupToDownload,
  inspectBackupFile,
  readLastBackupTime,
  restoreBackup as restoreLocalBackup,
  type CollectBackupFilter,
} from '@/lib/ios/backup';

import {
  cloudBackupCreds,
  ensureCloudBackupSetup,
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

// ---------------- 局部样式基元 ----------------

const CARD_CLS =
  'rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]';

/** 贯穿式区块分隔线：细线 + 字母小字（与常规左对齐灰字区分开） */
function SectionSep({ en, cn }: { en: string; cn: string }) {
  return (
    <div className="mt-7 mb-3 flex items-center gap-3 px-5" aria-label={`${cn}（${en}）`}>
      <span className="h-px flex-1 bg-foreground/[0.12]" />
      <span className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground/80 select-none">{en}</span>
      <span className="h-px flex-1 bg-foreground/[0.12]" />
      <span className="sr-only">{cn}</span>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`${CARD_CLS} ${className}`}>{children}</div>;
}

/** 主 / 次按钮（深色填充主操作 + 描边次操作，随主题自适应） */
function BigButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  danger,
  testid,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  danger?: boolean;
  testid?: string;
}) {
  const base =
    'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-medium transition-all active:scale-[0.97] disabled:opacity-45';
  const style = danger
    ? variant === 'primary'
      ? 'bg-[#FF3B30] text-white shadow-[0_4px_14px_rgba(255,59,48,0.3)]'
      : 'border border-[#FF3B30]/35 text-[#FF3B30]'
    : variant === 'primary'
      ? 'bg-foreground text-background shadow-[0_4px_14px_rgba(0,0,0,0.18)] dark:bg-white dark:text-black'
      : 'border border-black/10 text-foreground/80 dark:border-white/15';
  return (
    <button type="button" data-testid={testid} onClick={onClick} disabled={disabled} className={`${base} ${style}`}>
      {children}
    </button>
  );
}

/** 胶囊多选标签（导出模块 / 清理模块共用） */
function Chip({
  label,
  color,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  color?: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] transition-all active:scale-[0.95] disabled:opacity-40 ${
        selected
          ? 'bg-foreground text-background shadow-[0_2px_10px_rgba(0,0,0,0.2)] dark:bg-white dark:text-black'
          : 'bg-black/[0.045] text-foreground/75 ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:text-white/75 dark:ring-white/[0.08]'
      }`}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

/** 原生下拉（样式化 select：备份间隔 / 保留份数） */
function MiniSelect({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`relative inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-3 py-1.5 text-[12.5px] ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08] ${
        disabled ? 'opacity-45' : ''
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pr-4 font-medium outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </label>
  );
}

// ---------------- 区块一：模块占用分析 ----------------

const R = 54;
const CIRC = 2 * Math.PI * R;

/** 分段环形图：每模块一段独立彩色弧（2px 缝隙），中心显示总量 */
function Donut({ parts, total }: { parts: { color: string; bytes: number }[]; total: number }) {
  let acc = 0;
  const segs = parts
    .filter((p) => p.bytes > 0 && total > 0)
    .map((p) => {
      const len = Math.max((p.bytes / total) * CIRC - 2, 0.6);
      const seg = { color: p.color, dash: `${len} ${CIRC - len}`, offset: -acc + 1 };
      acc += (p.bytes / total) * CIRC;
      return seg;
    });
  return (
    <svg viewBox="0 0 128 128" className="h-[128px] w-[128px]" role="img" aria-label="数据占用环形图">
      <circle cx="64" cy="64" r={R} fill="none" stroke="currentColor" className="text-black/[0.06] dark:text-white/[0.09]" strokeWidth="13" />
      <g transform="rotate(-90 64 64)">
        {segs.map((s, i) => (
          <circle
            key={i}
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="13"
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
          />
        ))}
      </g>
    </svg>
  );
}

function BreakdownCard({ stats, refreshing, onRefresh }: { stats: ModuleStat[] | null; refreshing: boolean; onRefresh: () => void }) {
  const total = (stats ?? []).reduce((s, m) => s + m.stat.bytes, 0);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold">
          <HardDrive className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} aria-hidden />
          模块占用分析
        </span>
        <button
          type="button"
          aria-label="重新统计"
          onClick={onRefresh}
          className="grid h-8 w-8 place-items-center rounded-full text-black/55 transition active:bg-black/[0.06] dark:text-white/55 dark:active:bg-white/[0.08]"
        >
          <RefreshCw className={`h-[15px] w-[15px] ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-3 flex flex-col items-center">
        <div className="relative">
          <Donut parts={(stats ?? []).map((m) => ({ color: m.color, bytes: m.stat.bytes }))} total={total} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[19px] font-bold tabular-nums leading-none">{stats ? formatBytes(total) : '…'}</span>
            <span className="mt-1 text-[11px] text-muted-foreground">总占用</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {(stats ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{m.label}</span>
            <span className="shrink-0 text-right">
              <span className="block text-[12.5px] font-semibold tabular-nums leading-tight">
                {total > 0 ? `${Math.max(1, Math.round((m.stat.bytes / total) * 100))}%` : '0%'}
              </span>
              <span className="block text-[10.5px] tabular-nums leading-tight text-muted-foreground">
                {formatBytes(m.stat.bytes)}
              </span>
            </span>
          </div>
        ))}
        {!stats && (
          <div className="col-span-2 flex items-center justify-center gap-2 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 正在实测各模块占用…
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------- 区块二：浏览器持久化保护 ----------------

function ProtectionCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setPersisted((await navigator.storage?.persisted?.()) ?? false);
      } catch {
        setPersisted(false);
      }
    })();
  }, []);
  const on = persisted === true;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.9} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-tight">浏览器持久化保护</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
          {persisted === null
            ? '检测中…'
            : on
              ? '已开启：防止系统清理缓存导致数据丢失。关闭需到浏览器网站设置中撤销'
              : '开启后防止系统清理缓存导致数据丢失'}
        </span>
      </span>
      <Switch
        checked={on}
        disabled={persisted === null}
        onCheckedChange={(v) => {
          if (!v) return; // 已持久化无法程序化撤销，开关只进不退（副标题已说明）
          void ensurePersistentStorage().then((ok) => setPersisted(ok));
        }}
        aria-label="浏览器持久化保护开关"
      />
    </Card>
  );
}

// ---------------- 区块三：媒体清理 ----------------

function MediaCleanupCard({ onChanged }: { onChanged: () => void }) {
  const [auto, setAuto] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastAt, setLastAt] = useState(0);

  useEffect(() => {
    void (async () => {
      setAuto(await readMediaAutoClean());
      setLastAt(await readMediaCleanLast());
    })();
  }, []);

  // 自动开关开启后：每天最多静默执行一次（cleanMedia 内部 24h 节流）
  useEffect(() => {
    if (auto) void cleanMedia({ auto: true }).catch(() => undefined);
  }, [auto]);

  const run = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const r = await cleanMedia();
      setMsg(
        r.compressed > 0
          ? { ok: true, text: `已压缩 ${r.compressed} 张照片，释放 ${formatBytes(r.savedBytes)}` }
          : { ok: true, text: '没有需要压缩的照片——空间状态良好' },
      );
      setLastAt(await readMediaCleanLast());
      onChanged();
    } catch {
      setMsg({ ok: false, text: '清理失败，请重试' });
    } finally {
      setRunning(false);
    }
  };

  const cleanAssets = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const r = await cleanRegenerableAssets();
      setMsg(
        r.keys > 0
          ? { ok: true, text: `已清理 ${r.keys} 项可再生缓存素材（${formatBytes(r.bytes)}）` }
          : { ok: true, text: '没有可清理的未引用素材——壁纸、图标等激活素材不受影响' },
      );
      onChanged();
    } catch {
      setMsg({ ok: false, text: '清理失败，请重试' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-500/12 text-sky-600 dark:text-sky-400">
          <Database className="h-5 w-5" strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-tight">图片 / 多媒体文件自动压缩及清理</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
            4 天以上自动压缩照片；7 天以上清理超大原图。壁纸、图标、字体等常驻素材不纳入自动清理
          </span>
        </span>
        <Switch
          checked={auto}
          onCheckedChange={(v) => {
            setAuto(v);
            void writeMediaAutoClean(v);
          }}
          aria-label="图片多媒体自动压缩清理开关"
        />
      </div>

      <p className="text-[12px] text-muted-foreground">
        清理状态：{lastAt > 0 ? `上次执行 ${new Date(lastAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '尚未执行'}
      </p>

      <div className="flex flex-col gap-2.5">
        <BigButton onClick={() => void run()} disabled={running} testid="files-media-run">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          {running ? '正在清理…' : '立即执行'}
        </BigButton>
        <BigButton variant="ghost" onClick={() => void cleanAssets()} disabled={running}>
          清理未引用主题素材
        </BigButton>
      </div>

      {msg && (
        <p role="status" className={`text-[12.5px] leading-relaxed ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#FF3B30]'}`}>
          {msg.text}
        </p>
      )}
    </Card>
  );
}

// ---------------- 区块四：Supabase 云端备份 ----------------

function fmtTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

function CloudBackupCard() {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<CloudBackupPrefs | null>(null);
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [busy, setBusy] = useState<'' | 'backup' | 'restore' | 'delete' | 'setup'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRow, setConfirmRow] = useState<BackupRow | null>(null);

  const refresh = useCallback(async () => {
    const creds = cloudBackupCreds();
    setReady(!!creds);
    setPrefs(await readBackupPrefs());
    if (creds) {
      const r = await listBackups();
      setRows(r.ok ? (r.rows ?? []) : []);
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doSetup = async () => {
    setBusy('setup');
    setMsg(null);
    try {
      const creds = cloudBackupCreds();
      if (!creds) {
        // 凭证由云端助手页录入：本页只做状态展示与重部署
        setMsg({ ok: false, text: '还没有云端配置——先到 设置 › 云端助手 完成 Supabase 一键部署' });
        return;
      }
      const setup = await ensureCloudBackupSetup(creds);
      setMsg(setup.ok ? { ok: true, text: '云端已重新部署（表 / 桶 / 定时任务已就绪）' } : { ok: false, text: setup.message ?? '重新部署失败，请稍后重试' });
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const doBackup = async () => {
    setBusy('backup');
    setMsg(null);
    try {
      const creds = cloudBackupCreds();
      if (!creds) {
        setMsg({ ok: false, text: '还没部署云端——先在 设置 › 云端助手 完成 Supabase 部署' });
        return;
      }
      const setup = await ensureCloudBackupSetup(creds);
      if (!setup.ok) {
        setMsg({ ok: false, text: setup.message ?? '云端初始化失败，请稍后重试' });
        return;
      }
      const r = await runBackup('manual');
      if (r.ok) {
        setMsg({ ok: true, text: `备份完成（${fmtSize(r.size ?? 0)}${r.sections ? ` · ${r.sections}` : ''}）` });
        const p = await readBackupPrefs();
        await pruneBackups(p.keep);
      } else {
        setMsg({ ok: false, text: r.message ?? '备份失败，请稍后重试' });
      }
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const doRestore = async (row: BackupRow) => {
    setBusy('restore');
    setMsg(null);
    try {
      const r = await restoreCloudBackup(row);
      setMsg(
        r.ok
          ? { ok: true, text: `恢复完成（${r.sections ?? ''}）——部分页面数据需重进 App 刷新` }
          : { ok: false, text: r.message ?? '恢复失败，请稍后重试' },
      );
    } finally {
      setBusy('');
      setConfirmRow(null);
    }
  };

  const latest = rows.length > 0 ? rows[0] : null;

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      {/* 连接状态行 */}
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${ready ? 'bg-emerald-500 shadow-[0_0_6px_rgba(52,199,89,0.6)]' : 'bg-black/25 dark:bg-white/30'}`} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {ready ? '已部署 · 连接正常' : '未部署 · 云备份不可用'}
          {prefs?.lastAt ? (
            <span className="ml-1.5 font-normal text-muted-foreground">上次 {fmtTime(prefs.lastAt)}{prefs.lastSize ? ` · ${fmtSize(prefs.lastSize)}` : ''}</span>
          ) : (
            <span className="ml-1.5 font-normal text-muted-foreground">从未备份</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void doSetup()}
          disabled={busy !== ''}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-3 py-1.5 text-[12px] font-medium transition active:scale-[0.95] disabled:opacity-45 dark:bg-white/[0.08]"
        >
          {busy === 'setup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          重新部署
        </button>
      </div>

      {/* 核心操作：备份 / 恢复 */}
      <div className="flex gap-2.5">
        <BigButton onClick={() => void doBackup()} disabled={busy !== ''} testid="files-cloud-backup">
          {busy === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
          {busy === 'backup' ? '正在备份…' : '立即备份'}
        </BigButton>
        <BigButton
          variant="ghost"
          disabled={busy !== '' || !latest}
          testid="files-cloud-restore"
          onClick={() => (latest ? setConfirmRow(latest) : setMsg({ ok: false, text: '云端还没有备份——先点「立即备份」创建一份' }))}
        >
          {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="h-4 w-4" aria-hidden />}
          {busy === 'restore' ? '正在恢复…' : '云端恢复'}
        </BigButton>
      </div>

      {/* 自动备份 */}
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-black/[0.03] px-3.5 py-3 dark:bg-white/[0.05]">
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium leading-tight">自动备份</span>
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            开启后按间隔静默备份（App 退后台时检查）
          </span>
        </span>
        <Switch
          checked={!!prefs?.auto}
          onCheckedChange={(v) => {
            setPrefs((p) => (p ? { ...p, auto: v } : p));
            void writeBackupPrefs({ auto: v });
          }}
          aria-label="自动备份开关"
        />
      </div>
      {prefs?.auto && (
        <div className="flex flex-wrap items-center gap-2">
          <MiniSelect
            label="间隔"
            value={prefs.freq}
            options={FREQ_OPTIONS}
            onChange={(v) => {
              setPrefs({ ...prefs, freq: v as CloudBackupPrefs['freq'] });
              void writeBackupPrefs({ freq: v as CloudBackupPrefs['freq'] });
            }}
          />
          <MiniSelect
            label="保留"
            value={String(prefs.keep ?? 3)}
            options={KEEP_OPTIONS}
            onChange={(v) => {
              setPrefs({ ...prefs, keep: Number(v) });
              void writeBackupPrefs({ keep: Number(v) });
            }}
          />
        </div>
      )}

      {/* 云端备份记录 */}
      {rows.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-[14px] bg-black/[0.03] dark:bg-white/[0.05]">
          {rows.slice(0, 10).map((row) => (
            <div key={row.id} className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2 text-[12px] last:border-b-0 dark:border-white/[0.06]">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {fmtTime(Date.parse(row.created_at ?? '') || 0)} · {row.kind === 'auto' ? '自动' : '手动'}
                {row.size_bytes ? ` · ${fmtSize(row.size_bytes)}` : ''}
              </span>
              <button
                type="button"
                aria-label="删除这条备份"
                onClick={() => {
                  setBusy('delete');
                  void deleteBackup(row).finally(async () => {
                    setBusy('');
                    await refresh();
                  });
                }}
                disabled={busy !== ''}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition active:bg-[#FF3B30]/10 active:text-[#FF3B30] disabled:opacity-40"
              >
                {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <p role="status" data-testid={msg.ok ? 'files-cloud-ok' : 'files-cloud-err'} className={`text-[12.5px] leading-relaxed ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#FF3B30]'}`}>
          {msg.text}
        </p>
      )}

      {/* 恢复二次确认 */}
      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">从云端恢复？</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug">
              {confirmRow
                ? `将用 ${fmtTime(Date.parse(confirmRow.created_at ?? '') || 0)} 的备份覆盖本机的聊天 / 记忆 / 联系人 / 世界书 / 论坛等数据。此操作不可撤销，确认继续？`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
              再想想
            </AlertDialogCancel>
            <span aria-hidden className="w-px shrink-0 self-stretch bg-border" />
            <AlertDialogAction
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              style={{ color: '#FF3B30' }}
              onClick={() => confirmRow && void doRestore(confirmRow)}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------- 区块五：导出与导入 ----------------

const MEDIA_STORES = ['photos', 'albums', 'recordings', 'music', 'ringtones'];

function ExportImportCard({ onChanged }: { onChanged: () => void }) {
  const [excludeMedia, setExcludeMedia] = useState(false);
  const [selected, setSelected] = useState<string[]>(DATA_MODULES.map((m) => m.id));
  const [busy, setBusy] = useState<'' | 'export' | 'import'>('');
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; file: File; summary: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLastBackupAt(readLastBackupTime());
  }, []);

  const modOf = (id: string) => DATA_MODULES.find((m) => m.id === id);
  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const currentFilter = (): CollectBackupFilter => {
    const mods = DATA_MODULES.filter((m) => selected.includes(m.id));
    let stores = [...new Set(mods.flatMap((m) => m.stores))];
    if (excludeMedia) stores = stores.filter((s) => !MEDIA_STORES.includes(s));
    return { includeStores: stores, includeKvBuckets: [...new Set(mods.flatMap((m) => m.kvBuckets))] };
  };

  const doExport = async () => {
    if (busy || selected.length === 0) return;
    setBusy('export');
    setMsg(null);
    setProgress('');
    try {
      const r = await exportBackupToDownload({
        filter: currentFilter(),
        onProgress: (done, total) => setProgress(`${done}/${total}`),
      });
      const note = r.serverSkipped ? '；服务端数据未包含（接口不可达）' : '';
      if (r.savedVia === 'native') {
        setMsg({ ok: true, text: `已导出 ${r.records} 条记录（${r.stores} 个模块）—「${r.filename}」已存进手机 Download 目录${note}` });
      } else if (r.savedVia === 'browser') {
        setMsg({ ok: true, text: `已导出 ${r.records} 条记录（${r.stores} 个模块）—「${r.filename}」已开始下载${note}` });
      } else {
        setMsg({ ok: false, text: `已生成「${r.filename}」，但当前 APP 版本不支持在 APP 内保存文件——请检查系统通知栏，或用手机浏览器打开本页面再导出一次` });
      }
      setLastBackupAt(readLastBackupTime());
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? `导出失败：${err.message}` : '导出失败，请稍后重试' });
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const doRestoreFile = async (file: File) => {
    setBusy('import');
    setMsg(null);
    try {
      setMsg({ ok: true, text: '正在导出恢复前的安全备份…' });
      try {
        await exportBackupToDownload({ safety: true });
      } catch (err) {
        throw new Error(`恢复前安全备份失败（已中止恢复）：${err instanceof Error ? err.message : '未知错误'}`);
      }
      setMsg({ ok: true, text: '安全备份已下载，正在写入恢复数据…' });
      const r = await restoreLocalBackup(file);
      const skip = r.skippedStores.length > 0 ? `（跳过 ${r.skippedStores.length} 个未知模块）` : '';
      setMsg({ ok: true, text: `恢复完成：${r.records} 条记录 · ${r.stores} 个模块 · ${r.lsKeys} 项本地设置${skip} — 正在重启…` });
      setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '恢复失败，请重试' });
    } finally {
      setBusy('');
      setPendingRestore(null);
      onChanged();
    }
  };

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      {/* 轻量导出开关 */}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium leading-tight">本地导出 · 不含图片 / 多媒体</span>
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">开启后备份文件更小，省本地空间（照片 / 录音 / 音乐不入文件）</span>
        </span>
        <Switch
          checked={excludeMedia}
          onCheckedChange={(v) => setExcludeMedia(v)}
          aria-label="本地导出不含图片多媒体开关"
        />
      </div>

      {/* 导出模块选择器 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted-foreground">导出模块</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelected(DATA_MODULES.map((m) => m.id));
                setExcludeMedia(false);
              }}
              className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[11.5px] font-medium transition active:scale-[0.95] dark:bg-white/[0.08]"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(['chat', 'memory', 'worldbook', 'sys']);
                setExcludeMedia(true);
              }}
              className="rounded-full bg-black/[0.045] px-2.5 py-1 text-[11.5px] font-medium transition active:scale-[0.95] dark:bg-white/[0.08]"
            >
              轻量
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DATA_MODULES.map((m) => (
            <Chip key={m.id} label={m.label} color={m.color} selected={selected.includes(m.id)} onToggle={() => toggle(m.id)} disabled={busy !== ''} />
          ))}
        </div>
        {excludeMedia && selected.includes('media') && (
          <p className="mt-2 text-[11.5px] text-muted-foreground">已开启「不含图片 / 多媒体」：媒体库模块将跳过照片、录音与音乐文件</p>
        )}
      </div>

      {/* 导出 / 导入 */}
      <div className="flex flex-col gap-2.5">
        <BigButton onClick={() => void doExport()} disabled={busy !== '' || selected.length === 0} testid="files-export">
          {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {busy === 'export' ? `正在导出${progress ? ` ${progress}` : ''}…` : `导出所选模块（${selected.length}/${DATA_MODULES.length}）`}
        </BigButton>
        <BigButton variant="ghost" disabled={busy !== ''} onClick={() => restoreInputRef.current?.click()} testid="files-import">
          {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowDownToLine className="h-4 w-4" aria-hidden />}
          {busy === 'import' ? '正在恢复…' : '导入备份文件'}
        </BigButton>
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        最近导出：{lastBackupAt ?? '尚未导出'}。备份含所选模块全部数据（API Key 会解密写入备份文件，请妥善保管）。
      </p>

      {/* 恢复确认条 */}
      {pendingRestore && (
        <div data-testid="files-restore-confirm" className="rounded-[16px] border px-4 py-3" style={{ borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.1)' }}>
          <p className="text-[13px] leading-relaxed" style={{ color: '#B45309' }}>
            将用「{pendingRestore.name}」覆盖当前全部数据（文件里有的模块先清空再恢复），确定吗？
          </p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'rgba(180,83,9,0.85)' }}>
            备份内容：{pendingRestore.summary}。确认后先自动导出当前数据为安全备份，再执行恢复。
          </p>
          <div className="mt-2.5 flex gap-2.5">
            <BigButton danger variant="primary" onClick={() => void doRestoreFile(pendingRestore.file)} disabled={busy !== ''}>
              确认恢复
            </BigButton>
            <BigButton variant="ghost" onClick={() => setPendingRestore(null)} disabled={busy !== ''}>
              取消
            </BigButton>
          </div>
        </div>
      )}

      {msg && (
        <p role="status" data-testid={msg.ok ? 'files-export-ok' : 'files-export-err'} className={`text-[12.5px] leading-relaxed ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#FF3B30]'}`}>
          {msg.text}
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
          void (async () => {
            try {
              const info = await inspectBackupFile(f);
              setMsg(null);
              setPendingRestore({ name: f.name, file: f, summary: info.summary });
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : '备份文件无效' });
            }
          })();
        }}
      />
    </Card>
  );
}

// ---------------- 区块六：模块清理（危险操作） ----------------

function DangerCleanupCard({ onChanged }: { onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const openSettings = useUI((s) => s.switchToApp);

  const doClean = async () => {
    if (running || selected.length === 0) return;
    const labels = DATA_MODULES.filter((m) => selected.includes(m.id)).map((m) => m.label).join('、');
    if (!window.confirm(`将清空「${labels}」的全部本地数据，此操作不可撤销。确定继续吗？`)) return;
    setRunning(true);
    try {
      await clearModules(selected);
      window.alert(`已清空：${labels}。建议先到云端备份 / 导出一份再日常使用。`);
      setSelected([]);
      onChanged();
    } catch {
      window.alert('清理失败，请重试');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-[#FF3B30]/30 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#FF3B30]" aria-hidden />
        <p className="text-[13px] font-medium leading-relaxed text-[#FF3B30]">清理会删除本地数据，请先备份</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {DATA_MODULES.map((m) => (
          <Chip
            key={m.id}
            label={m.label}
            color={m.color}
            selected={selected.includes(m.id)}
            onToggle={() => setSelected((sel) => (sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id]))}
            disabled={running}
          />
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => openSettings('settings')}
          className="text-[12.5px] text-muted-foreground underline-offset-2 transition active:opacity-60 hover:underline"
        >
          云端备份后再来
        </button>
        <span className="flex-1" />
        <BigButton danger variant="ghost" onClick={() => void doClean()} disabled={running || selected.length === 0} testid="files-danger-clean">
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          清空
        </BigButton>
      </div>
    </Card>
  );
}

// ---------------- 根组件 ----------------

export interface LibEntry {
  key: string;
  name: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  statText: string;
}

export default function DataManager({ libs, onOpenLib }: { libs: LibEntry[]; onOpenLib: (key: string) => void }) {
  const [stats, setStats] = useState<ModuleStat[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setStats(await computeModuleStats());
    } catch {
      /* IndexedDB 不可用时保持空 */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="pb-8">
      <SectionSep en="MODULE BREAKDOWN" cn="模块占用分析" />
      <div className="px-4">
        <BreakdownCard stats={stats} refreshing={refreshing} onRefresh={() => void refresh()} />
      </div>

      <SectionSep en="LOCAL PROTECTION" cn="浏览器持久化" />
      <div className="px-4">
        <ProtectionCard />
      </div>

      <SectionSep en="MEDIA CLEANUP" cn="媒体清理" />
      <div className="px-4">
        <MediaCleanupCard onChanged={() => void refresh()} />
      </div>

      <SectionSep en="CLOUD BACKUP" cn="云端备份" />
      <div className="px-4">
        <CloudBackupCard />
      </div>

      <SectionSep en="EXPORT & IMPORT" cn="导出与导入" />
      <div className="px-4">
        <ExportImportCard onChanged={() => void refresh()} />
      </div>

      <SectionSep en="DANGER ZONE" cn="模块清理" />
      <div className="px-4">
        <DangerCleanupCard onChanged={() => void refresh()} />
      </div>

      <SectionSep en="LIBRARY" cn="资料库" />
      <div className="px-4">
        <Card className="overflow-hidden">
          {libs.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => onOpenLib(l.key)}
              className="flex w-full items-center gap-3 border-b border-black/[0.05] px-4 py-3 text-left transition-colors last:border-b-0 active:bg-muted/50 dark:border-white/[0.06]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-b from-[#C8C8CD] to-[#8E8E93] dark:from-[#5A5A5F] dark:to-[#3A3A3E]">
                <l.icon className="h-5 w-5 text-white" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15.5px]">{l.name}</span>
              <span className="shrink-0 text-[13px] text-muted-foreground">{l.statText}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}
