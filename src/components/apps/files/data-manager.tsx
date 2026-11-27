'use client';

/**
 * 文件 App · 数据管理（终端诊断风重构）：
 * 废弃「环形图 + 彩色圆点」存储界面，改为按 App 独立的垂直列表。
 * 视觉：浅灰底 / 等宽字体 / 灰白蓝绿红五色（蓝=选中与备份，绿=已备份，红=危险）。
 * 逻辑：勾选 ↔ 批量操作严格对应；底部全局汇总（已备份 / 未备份）+ 云备份 / 全局清理。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CloudUpload,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from 'lucide-react';

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
  clearAppBackupMarks,
  clearAppData,
  computeAppStats,
  markAppsBackedUp,
  readAppBackupMarks,
  type AppBackupMarks,
  type AppDataSpec,
  type AppDataStat,
} from '@/lib/ios/storage-stats';

import { exportBackupToDownload, type CollectBackupFilter } from '@/lib/ios/backup';

import { cloudBackupCreds, ensureCloudBackupSetup, runBackup } from '@/lib/ios/cloud-backup';

// ---------------- 终端配色（灰 / 白 / 蓝 / 绿 / 红） ----------------

const BORDER = 'border-[#D0D7DE] dark:border-[#30363D]';
const PANEL = 'bg-white dark:bg-[#161B22]';
const MUTED = 'text-[#6E7781] dark:text-[#8B949E]';
const BLUE = 'text-[#0969DA] dark:text-[#58A6FF]';
const GREEN = 'text-[#1A7F37] dark:text-[#3FB950]';
const RED = 'text-[#CF222E] dark:text-[#F85149]';

/** 紧凑容量文案：12.4 MB / 856 KB / 0 B */
function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** 单 / 多 App 备份的导出过滤（严格只带所选 App 的仓库、kv 前缀与本地存档前缀） */
function filterForSpecs(specs: AppDataSpec[]): CollectBackupFilter {
  const stores = [...new Set(specs.flatMap((s) => s.stores))];
  if (specs.some((s) => s.kvPrefixes.length > 0)) stores.push('kv');
  return {
    includeStores: stores,
    includeKvPrefixes: [...new Set(specs.flatMap((s) => s.kvPrefixes))],
    includeLocalStoragePrefixes: [...new Set(specs.flatMap((s) => s.lsPrefixes))],
  };
}

type Msg = { tone: 'ok' | 'err' | 'info'; text: string } | null;
type Busy = '' | 'backup' | 'cloud' | 'clean';

interface ConfirmState {
  ids: string[];
  scope: 'app' | 'batch' | 'all';
}

// ---------------- 勾选框 ----------------

function CheckBox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[3px] border transition-colors ${
        checked
          ? 'border-[#0969DA] bg-[#0969DA] text-white dark:border-[#58A6FF] dark:bg-[#1F6FEB]'
          : 'border-[#8B949E]/70 bg-transparent dark:border-[#6E7681]'
      }`}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
    </button>
  );
}

// ---------------- App 行 ----------------

function AppRow({
  app,
  selected,
  backed,
  onToggle,
  onOpenMenu,
  disabled,
}: {
  app: AppDataStat;
  selected: boolean;
  backed: boolean;
  onToggle: () => void;
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      className={`flex items-center gap-3 border-b px-3.5 py-3 transition-colors last:border-b-0 ${BORDER} ${
        selected ? 'bg-[#0969DA]/[0.055] dark:bg-[#58A6FF]/[0.08]' : ''
      } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <CheckBox checked={selected} onToggle={onToggle} label={`选择 ${app.label}`} />

      <img
        src={app.image}
        alt=""
        draggable={false}
        className="h-8 w-8 shrink-0 rounded-[7px] opacity-75 grayscale"
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] leading-tight">{app.label}</div>
        <div
          className={`mt-1 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.14em] ${
            backed ? GREEN : MUTED
          }`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {backed ? 'BACKED UP' : 'NOT BACKED'}
        </div>
      </div>

      <span className="shrink-0 text-right text-[13px] tabular-nums text-[#1F2328] dark:text-[#C9D1D9]">
        {fmtBytes(app.bytes)}
      </span>

      <button
        type="button"
        aria-label={`${app.label} 操作菜单`}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu(e);
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] text-[#6E7781] transition-colors active:bg-black/[0.06] disabled:opacity-40 dark:text-[#8B949E] dark:active:bg-white/[0.08]"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

// ---------------- 根组件 ----------------

export interface LibEntry {
  key: string;
  name: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  statText: string;
}

export default function DataManager({ libs, onOpenLib }: { libs: LibEntry[]; onOpenLib: (key: string) => void }) {
  const [stats, setStats] = useState<AppDataStat[] | null>(null);
  const [marks, setMarks] = useState<AppBackupMarks>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [msg, setMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextStats, nextMarks] = await Promise.all([computeAppStats(), readAppBackupMarks()]);
      setStats(nextStats);
      setMarks(nextMarks);
    } catch {
      /* IndexedDB 不可用时保持空表 */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apps = stats ?? [];
  const totalBytes = useMemo(() => apps.reduce((s, a) => s + a.bytes, 0), [apps]);
  const backedBytes = useMemo(
    () =>
      apps.reduce((s, a) => {
        const mark = marks[a.id];
        return s + (mark ? Math.min(a.bytes, Math.max(0, mark.bytes)) : 0);
      }, 0),
    [apps, marks],
  );
  const unbackedBytes = Math.max(0, totalBytes - backedBytes);
  const allSelected = apps.length > 0 && apps.every((a) => selected.has(a.id));
  const selectedApps = apps.filter((a) => selected.has(a.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(apps.map((a) => a.id)));
  const invert = () => setSelected(new Set(apps.filter((a) => !selected.has(a.id)).map((a) => a.id)));

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      id,
      top: Math.min(rect.bottom + 6, window.innerHeight - 112),
      right: Math.max(12, window.innerWidth - rect.right),
    });
  };

  const markBacked = async (specs: AppDataSpec[]) => {
    const entries = specs.map((s) => ({ id: s.id, bytes: apps.find((a) => a.id === s.id)?.bytes ?? 0 }));
    setMarks(await markAppsBackedUp(entries));
  };

  // 单 App / 批量备份：本地 JSON 导出（严格只包含所选 App 的数据）
  const backupApps = async (specs: AppDataSpec[]) => {
    if (busy || specs.length === 0) return;
    setBusy('backup');
    setMsg({ tone: 'info', text: `> exporting ${specs.length} app(s)...` });
    try {
      const r = await exportBackupToDownload({ filter: filterForSpecs(specs) });
      await markBacked(specs);
      const labels = specs.map((s) => s.label).join(' / ');
      setMsg({ tone: 'ok', text: `[OK] ${labels} → ${r.filename} · ${r.records} records` });
    } catch (err) {
      setMsg({ tone: 'err', text: `[ERR] 备份失败：${err instanceof Error ? err.message : '请重试'}` });
    } finally {
      setBusy('');
    }
  };

  // 一键云备份（Supabase）：成功后把全部 App 标记为已备份
  const cloudBackupAll = async () => {
    if (busy) return;
    const creds = cloudBackupCreds();
    if (!creds) {
      setMsg({ tone: 'err', text: '[ERR] 未配置 Supabase：请先到 设置 › 云端助手 完成部署' });
      return;
    }
    setBusy('cloud');
    setMsg({ tone: 'info', text: '> uploading snapshot to supabase...' });
    try {
      const setup = await ensureCloudBackupSetup(creds);
      if (!setup.ok) {
        setMsg({ tone: 'err', text: `[ERR] ${setup.message ?? '云端初始化失败'}` });
        return;
      }
      const r = await runBackup('manual');
      if (!r.ok) {
        setMsg({ tone: 'err', text: `[ERR] ${r.message ?? '云备份失败'}` });
        return;
      }
      await markBacked(apps);
      setMsg({ tone: 'ok', text: `[OK] 云备份完成 · ${fmtBytes(r.size ?? 0)}${r.sections ? ` · ${r.sections}` : ''}` });
    } catch (err) {
      setMsg({ tone: 'err', text: `[ERR] ${err instanceof Error ? err.message : '云备份失败'}` });
    } finally {
      setBusy('');
    }
  };

  const performClean = async (ids: string[]) => {
    const labels = apps.filter((a) => ids.includes(a.id)).map((a) => a.label).join(' / ');
    setBusy('clean');
    setMsg({ tone: 'info', text: '> purging local data...' });
    try {
      await clearAppData(ids);
      setMarks(await clearAppBackupMarks(ids));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setMsg({ tone: 'ok', text: `[OK] 已清理：${labels}` });
      await refresh();
    } catch {
      setMsg({ tone: 'err', text: '[ERR] 清理失败，请重试' });
    } finally {
      setBusy('');
      setConfirm(null);
    }
  };

  const menuApp = menu ? apps.find((a) => a.id === menu.id) : null;

  return (
    <div className="min-h-full bg-[#F8F9FA] pb-28 font-mono text-[#1B1F23] dark:bg-[#0D1117] dark:text-[#C9D1D9]">
      {/* 终端标题条 */}
      <div className="px-4 pt-4">
        <div className={`overflow-hidden rounded-[6px] border ${BORDER} ${PANEL}`}>
          <div className={`flex items-center gap-2 border-b px-3 py-2 ${BORDER}`}>
            <span aria-hidden className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#D0D7DE] dark:bg-[#30363D]" />
              <span className="h-2 w-2 rounded-full bg-[#D0D7DE] dark:bg-[#30363D]" />
              <span className="h-2 w-2 rounded-full bg-[#D0D7DE] dark:bg-[#30363D]" />
            </span>
            <span className={`min-w-0 flex-1 truncate text-[10.5px] tracking-[0.08em] ${MUTED}`}>
              storage.daemon — /var/appdata
            </span>
            <button
              type="button"
              aria-label="重新扫描"
              onClick={() => void refresh()}
              disabled={refreshing}
              className={`grid h-6 w-6 place-items-center rounded-[3px] transition-colors active:bg-black/[0.06] disabled:opacity-40 dark:active:bg-white/[0.08] ${MUTED}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>
          <div className="px-3 py-3 text-[11.5px] leading-relaxed">
            <div>
              <span className={BLUE}>$</span> du -sh apps/* <span className={MUTED}>— scan local storage</span>
            </div>
            <div className={`mt-1.5 flex items-center justify-between ${MUTED}`}>
              <span>
                TOTAL <span className="text-[#1F2328] dark:text-[#C9D1D9]">{stats ? fmtBytes(totalBytes) : '…'}</span>
              </span>
              <span>
                {apps.length} APPS / {selected.size} SELECTED
              </span>
            </div>
          </div>
        </div>

        {/* 全选 / 反选 */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={apps.length === 0 || busy !== ''}
              className={`rounded-[4px] border px-2.5 py-1 text-[11px] transition-colors active:bg-black/[0.05] disabled:opacity-40 dark:active:bg-white/[0.06] ${BORDER} ${BLUE}`}
            >
              全选
            </button>
            <button
              type="button"
              onClick={invert}
              disabled={apps.length === 0 || busy !== ''}
              className={`rounded-[4px] border px-2.5 py-1 text-[11px] transition-colors active:bg-black/[0.05] disabled:opacity-40 dark:active:bg-white/[0.06] ${BORDER} ${MUTED}`}
            >
              反选
            </button>
          </div>
          <span className={`text-[10px] uppercase tracking-[0.16em] ${MUTED}`}>
            {allSelected ? 'ALL SELECTED' : 'SELECT APPS'}
          </span>
        </div>

        {/* App 列表 */}
        <div className={`mt-2.5 overflow-hidden rounded-[6px] border ${BORDER} ${PANEL}`}>
          {apps.length === 0 ? (
            <div className={`flex items-center justify-center gap-2 py-10 text-[12px] ${MUTED}`}>
              {stats ? 'NO DATA' : <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> SCANNING…</>}
            </div>
          ) : (
            apps.map((app) => {
              const mark = marks[app.id];
              return (
                <AppRow
                  key={app.id}
                  app={app}
                  selected={selected.has(app.id)}
                  backed={!!mark && mark.bytes > 0}
                  onToggle={() => toggle(app.id)}
                  onOpenMenu={(e) => openMenu(e, app.id)}
                  disabled={busy !== ''}
                />
              );
            })
          )}
        </div>

        {/* 全局汇总（细线分隔） */}
        <div className={`mt-6 border-t pt-4 ${BORDER}`}>
          <div className={`text-[9.5px] uppercase tracking-[0.22em] ${MUTED}`}>GLOBAL STATUS</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className={`text-[10px] uppercase tracking-[0.12em] ${MUTED}`}>已备份数据</div>
              <div className={`mt-1 text-[17px] tabular-nums leading-none ${GREEN}`}>{fmtBytes(backedBytes)}</div>
            </div>
            <div>
              <div className={`text-[10px] uppercase tracking-[0.12em] ${MUTED}`}>未备份 / 可清理</div>
              <div className={`mt-1 text-[17px] tabular-nums leading-none ${MUTED}`}>{fmtBytes(unbackedBytes)}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void cloudBackupAll()}
              disabled={busy !== '' || !stats}
              className="flex h-10 items-center justify-center gap-2 rounded-[4px] bg-[#0969DA] text-[12.5px] font-medium text-white transition-opacity active:opacity-85 disabled:opacity-45 dark:bg-[#1F6FEB]"
            >
              {busy === 'cloud' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
              {busy === 'cloud' ? '正在云备份…' : '一键云备份（Supabase）'}
            </button>
            <button
              type="button"
              onClick={() => setConfirm({ ids: apps.map((a) => a.id), scope: 'all' })}
              disabled={busy !== '' || apps.length === 0}
              className={`flex h-10 items-center justify-center gap-2 rounded-[4px] border text-[12.5px] font-medium transition-colors active:bg-[#CF222E]/[0.06] disabled:opacity-40 ${RED} border-[#CF222E]/45 dark:border-[#F85149]/45`}
            >
              {busy === 'clean' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
              强制全局清理
            </button>
          </div>

          {msg && (
            <p
              role="status"
              className={`mt-3 break-all text-[11px] leading-relaxed ${
                msg.tone === 'ok' ? GREEN : msg.tone === 'err' ? RED : BLUE
              }`}
            >
              {msg.text}
            </p>
          )}
        </div>

        {/* 资料库入口（保持原文件 App 二级页可达） */}
        <div className={`mt-6 border-t pt-4 ${BORDER}`}>
          <div className={`mb-2.5 text-[9.5px] uppercase tracking-[0.22em] ${MUTED}`}>LIBRARY / 资料库</div>
          <div className={`overflow-hidden rounded-[6px] border ${BORDER} ${PANEL}`}>
            {libs.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => onOpenLib(l.key)}
                className={`flex w-full items-center gap-3 border-b px-3.5 py-2.5 text-left transition-colors last:border-b-0 active:bg-black/[0.04] dark:active:bg-white/[0.05] ${BORDER}`}
              >
                <l.icon className={`h-4 w-4 shrink-0 ${MUTED}`} strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{l.name}</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${MUTED}`}>{l.statText}</span>
                <span className={`text-[10px] ${MUTED}`}>›</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 单 App 操作菜单 */}
      {menu && menuApp && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} aria-hidden />
          <div
            role="menu"
            className={`fixed z-50 w-[172px] overflow-hidden rounded-[5px] border shadow-[0_12px_32px_rgba(0,0,0,0.18)] ${BORDER} ${PANEL}`}
            style={{ top: menu.top, right: menu.right }}
          >
            <div className={`border-b px-3 py-1.5 text-[9.5px] uppercase tracking-[0.14em] ${BORDER} ${MUTED}`}>
              {menuApp.label}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void backupApps([menuApp]);
              }}
              className={`flex w-full items-center px-3 py-2.5 text-left text-[12px] transition-colors active:bg-[#0969DA]/[0.08] ${BLUE}`}
            >
              仅备份此 App
            </button>
            <div className={`h-px ${BORDER} border-t`} />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                setConfirm({ ids: [menuApp.id], scope: 'app' });
              }}
              className={`flex w-full items-center px-3 py-2.5 text-left text-[12px] transition-colors active:bg-[#CF222E]/[0.08] ${RED}`}
            >
              清理此 App
            </button>
          </div>
        </>
      )}

      {/* 底部悬浮操作栏：勾选后滑出 */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-30 mx-auto max-w-[430px] px-4 transition-all duration-300 ${
          selected.size > 0 ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
        }`}
      >
        <div
          className={`flex items-center gap-2 rounded-[6px] border border-[#30363D] bg-[#161B22] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)] ${
            selected.size > 0 ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <span className="shrink-0 pl-1.5 text-[10px] uppercase tracking-[0.12em] text-[#8B949E]">
            {selected.size} SEL
          </span>
          <button
            type="button"
            onClick={() => void backupApps(selectedApps)}
            disabled={busy !== ''}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-[#1F6FEB] text-[12px] font-medium text-white transition-opacity active:opacity-85 disabled:opacity-45"
          >
            {busy === 'backup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CloudUpload className="h-3.5 w-3.5" aria-hidden />}
            备份选中项
          </button>
          <button
            type="button"
            onClick={() => setConfirm({ ids: selectedApps.map((a) => a.id), scope: 'batch' })}
            disabled={busy !== ''}
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-[#F85149]/50 text-[12px] font-medium text-[#F85149] transition-colors active:bg-[#F85149]/10 disabled:opacity-45"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            清理选中项
          </button>
        </div>
      </div>

      {/* 清理二次确认 */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className={`w-[304px] gap-0 rounded-[6px] border p-0 font-mono sm:w-[304px] sm:max-w-[304px] ${BORDER} ${PANEL}`}>
          <AlertDialogHeader className="gap-1.5 px-4 pb-3 pt-4 text-left sm:text-left">
            <AlertDialogTitle className={`flex items-center gap-1.5 text-[13px] font-medium ${RED}`}>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {confirm?.scope === 'all' ? '强制全局清理' : confirm?.scope === 'batch' ? '清理选中项' : '清理此 App'}
            </AlertDialogTitle>
            <AlertDialogDescription className={`text-[11.5px] leading-relaxed ${MUTED}`}>
              {confirm
                ? `将永久删除「${
                    apps.filter((a) => confirm.ids.includes(a.id)).map((a) => a.label).join(' / ')
                  }」的本地数据（IndexedDB / 缓存 / 本地存档），不可撤销。`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={`flex-row gap-0 border-t p-0 sm:flex-row ${BORDER}`}>
            <AlertDialogCancel
              className={`m-0 h-11 flex-1 rounded-none border-0 bg-transparent text-[12.5px] font-normal shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-black/[0.04] dark:active:bg-white/[0.06] ${MUTED}`}
            >
              取消
            </AlertDialogCancel>
            <span aria-hidden className={`w-px shrink-0 self-stretch border-l ${BORDER}`} />
            <AlertDialogAction
              className={`m-0 h-11 flex-1 rounded-none border-0 bg-transparent text-[12.5px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-[#CF222E]/[0.08] ${RED}`}
              onClick={() => confirm && void performClean(confirm.ids)}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
