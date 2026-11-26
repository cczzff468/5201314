'use client';

/**
 * 云备份与恢复（第四十二轮机主规格）：设置 › 云端助手（ClawBox 页签上方）区块。
 * - 【立即手动备份】：本地全库打包（聊天/记忆/联系人/世界书/论坛等，Blob 入
 *   avatar_bucket/image_bucket）→ JSON 入 image_bucket/backups/ → backups 表记录行
 * - 【从云端恢复】：二次确认（AlertDialog 防误触）→ 下载 → Blob 取回 → 覆盖本地
 * - 【自动备份】开关 + 频率（每天一次/每周一次）：visibilitychange（App 退后台）+
 *   30 分钟兜底轮询超期静默执行（cloud-backup.startAutoBackupWatcher，PhoneShell 挂载）
 * - 备份列表：最近记录（时间/类型/大小/内容摘要/单条删除）
 * 依赖：云端助手已按 Supabase 部署（凭证在 wx-cloud store，密文本机留存）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Database,
  Loader2,
  RefreshCw,
  Trash2,
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

import { SectionLabel, GrayCard, FieldLabel, IOS_RED, TONE_CYAN } from './shared';
import {
  cloudBackupCreds,
  ensureCloudBackupSetup,
  runBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  readBackupPrefs,
  writeBackupPrefs,
  type BackupRow,
  type CloudBackupPrefs,
} from '@/lib/ios/cloud-backup';

function fmtTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function rowTime(row: BackupRow): number {
  const t = Date.parse(row.created_at ?? '');
  return Number.isFinite(t) ? t : 0;
}

export function BackupSection() {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<CloudBackupPrefs | null>(null);
  const [rows, setRows] = useState<BackupRow[] | null>(null);
  const [busy, setBusy] = useState<'' | 'backup' | 'restore' | 'delete' | 'setup'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 恢复二次确认：null=关；row=待确认的备份（机主规格「需二次确认防误触」） */
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

  const doBackup = async () => {
    setBusy('backup');
    setMsg(null);
    try {
      const creds = cloudBackupCreds();
      if (!creds) {
        setMsg({ ok: false, text: '还没部署云端助手：先在上方完成 Supabase 一键部署' });
        return;
      }
      // 首次使用先幂等初始化（建表/桶/Realtime；已就绪秒回）
      const setup = await ensureCloudBackupSetup(creds);
      if (!setup.ok) {
        setMsg({ ok: false, text: setup.message ?? '云端初始化失败，请稍后重试' });
        return;
      }
      const r = await runBackup('manual');
      if (r.ok) {
        setMsg({ ok: true, text: `备份完成（${fmtSize(r.size ?? 0)}${r.sections ? ` · ${r.sections}` : ''}）` });
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
      const r = await restoreBackup(row);
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

  const doDelete = async (row: BackupRow) => {
    setBusy('delete');
    try {
      await deleteBackup(row);
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const latest = rows && rows.length > 0 ? rows[0] : null;

  return (
    <section>
      <SectionLabel icon={CloudUpload} tone={TONE_CYAN}>云备份与恢复</SectionLabel>
      <GrayCard>
        {!ready ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            部署云端助手（上方 Supabase 一键部署）后即可使用云备份：聊天记录 / 记忆库 / 联系人 / 世界书 / 论坛数据打包进你自己的 Supabase。
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {/* 状态行 */}
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {prefs && prefs.lastAt
                ? `上次备份：${fmtTime(prefs.lastAt)}${prefs.lastSize ? ` · ${fmtSize(prefs.lastSize)}` : ''}${prefs.lastKind === 'auto' ? '（自动）' : '（手动）'}`
                : '从未备份过——数据目前只在本机。'}
              <span className="block text-[11px] text-muted-foreground/70">
                备份内容：聊天记录 · 记忆库 · 联系人 · 世界书 · 论坛 · 朋友圈 · 备忘/日程等（API 密钥等本机密文不入备份；照片/录音/音乐体积大不入）
              </span>
            </p>

            {/* 手动备份 / 恢复 */}
            <div className="flex gap-2.5">
              <button
                type="button"
                data-testid="cloud-backup-run-btn"
                onClick={() => void doBackup()}
                disabled={busy !== ''}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#007AFF] py-2.5 text-[13px] font-medium text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition active:scale-[0.98] disabled:opacity-50"
              >
                {busy === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                {busy === 'backup' ? '正在备份…' : '立即手动备份'}
              </button>
              <button
                type="button"
                data-testid="cloud-restore-btn"
                onClick={() => {
                  if (!latest) {
                    setMsg({ ok: false, text: '云端还没有备份——先点「立即手动备份」创建一份' });
                    return;
                  }
                  setConfirmRow(latest); // 二次确认（防误触）
                }}
                disabled={busy !== '' || !latest}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-black/10 py-2.5 text-[13px] font-medium text-foreground/75 transition active:scale-[0.98] disabled:opacity-50 dark:border-white/15"
              >
                {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {busy === 'restore' ? '正在恢复…' : '从云端恢复'}
              </button>
            </div>

            {/* 自动备份 */}
            <div className="flex items-center justify-between gap-3 rounded-[12px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.05]">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground/85">自动备份</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {prefs?.auto
                    ? `已开启 · ${prefs.freq === 'weekly' ? '每周' : '每天'}一次，App 退后台时静默执行`
                    : '关闭中（数据只在本机）'}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                {prefs?.auto && (
                  <div
                    role="radiogroup"
                    aria-label="自动备份频率"
                    className="flex rounded-full bg-white/70 p-[2px] ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10"
                  >
                    {(
                      [
                        { id: 'daily', label: '每天' },
                        { id: 'weekly', label: '每周' },
                      ] as const
                    ).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={prefs.freq === o.id}
                        onClick={() => {
                          const next = { ...prefs, freq: o.id };
                          setPrefs(next);
                          void writeBackupPrefs({ freq: o.id });
                        }}
                        className={`rounded-full px-2.5 py-1 text-[11.5px] transition ${
                          prefs.freq === o.id ? 'bg-[#007AFF] text-white' : 'text-muted-foreground'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                <Switch
                  checked={!!prefs?.auto}
                  onCheckedChange={(v) => {
                    setPrefs((p) => (p ? { ...p, auto: v } : p));
                    void writeBackupPrefs({ auto: v });
                  }}
                  aria-label="自动备份开关"
                />
              </div>
            </div>

            {/* 备份记录列表 */}
            {rows && rows.length > 0 && (
              <div>
                <FieldLabel>云端备份记录</FieldLabel>
                <div className="max-h-52 overflow-y-auto rounded-[12px] bg-black/[0.03] dark:bg-white/[0.05]">
                  {rows.slice(0, 10).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-2 text-[12px] last:border-b-0 dark:border-white/[0.06]"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {fmtTime(rowTime(row))} · {row.kind === 'auto' ? '自动' : '手动'}
                          {row.size_bytes ? ` · ${fmtSize(row.size_bytes)}` : ''}
                        </span>
                        {row.sections && (
                          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground/70">{row.sections}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={`删除 ${fmtTime(rowTime(row))} 的备份`}
                        onClick={() => void doDelete(row)}
                        disabled={busy !== ''}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground/60 transition active:bg-[#FF3B30]/10 active:text-[#FF3B30] disabled:opacity-40"
                      >
                        {busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 结果反馈 */}
            {msg && (
              <p
                role="status"
                data-testid={msg.ok ? 'cloud-backup-ok' : 'cloud-backup-err'}
                className={`text-[12px] leading-relaxed ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
                style={msg.ok ? undefined : { color: IOS_RED }}
              >
                {msg.text}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              <Database className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
              备份存在你自己的 Supabase（backups 表 + avatar/image 两 Storage 桶），本站不留任何数据；离线推送（messages 表 Realtime）同库。
            </p>
          </div>
        )}
      </GrayCard>

      {/* 恢复二次确认（机主规格「需二次确认防误触」） */}
      <AlertDialog open={!!confirmRow} onOpenChange={(o) => !o && setConfirmRow(null)}>
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              从云端恢复？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug">
              {confirmRow
                ? `将用 ${fmtTime(rowTime(confirmRow))} 的备份${confirmRow.size_bytes ? `（${fmtSize(confirmRow.size_bytes)}）` : ''}覆盖本机的聊天/记忆/联系人/世界书/论坛等数据。此操作不可撤销，确认继续？`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
              再想想
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
            <AlertDialogAction
              data-testid="cloud-restore-confirm-btn"
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              style={{ color: IOS_RED }}
              onClick={() => confirmRow && void doRestore(confirmRow)}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
