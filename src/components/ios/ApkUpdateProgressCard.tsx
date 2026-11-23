'use client';

/**
 * v2.4.4 APK 更新进度卡（机主需求：「立即更新」点了要有进度弹窗）：
 * 与 startApkUpdate 的 ApkUpdateState 一一对应——准备中/下载中（真实百分比进度条）/
 * 等安装授权/完成/旧版回退指引。设置 › APP 更新页（全屏弹窗）与开机更新弹窗共用。
 */

import { CheckCircle2, Loader2, ShieldAlert, Download, AlertTriangle } from 'lucide-react';
import type { ApkUpdateState } from '@/lib/ios/apk-download';
import { copyApkLink } from '@/lib/ios/apk-download';
import { useState } from 'react';

export function ApkUpdateProgressCard({
  state,
  onRetry,
  onClose,
}: {
  state: ApkUpdateState;
  /** need-permission / error 态的「重试」回调 */
  onRetry?: () => void;
  /** 终态（done/fallback）的「关闭」回调；不传则不显示关闭钮 */
  onClose?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const indeterminate = state.percent < 0;

  return (
    <div className="w-full space-y-3 text-left" role="status" aria-live="polite">
      {/* 标题行：阶段图标 + 主文案 */}
      <div className="flex items-center gap-2.5">
        {state.phase === 'preparing' || state.phase === 'downloading' ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#34C759]" aria-hidden="true" />
        ) : state.phase === 'done' ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34C759]" aria-hidden="true" />
        ) : state.phase === 'need-permission' ? (
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
        )}
        <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug">
          {state.phase === 'preparing' && '正在发起下载…'}
          {state.phase === 'downloading' && (indeterminate ? '正在下载更新包…' : `正在下载 ${state.percent}%`)}
          {state.phase === 'need-permission' && '等待「安装未知应用」授权'}
          {state.phase === 'done' && '下载完成'}
          {state.phase === 'fallback' && '已转系统下载通道'}
          {state.phase === 'error' && '下载失败'}
        </p>
        {state.phase === 'downloading' ? (
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {indeterminate ? '' : `${state.percent}%`}
          </span>
        ) : null}
      </div>

      {/* 进度条（downloading 且有百分比时） */}
      {state.phase === 'downloading' && !indeterminate ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={state.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[#34C759] transition-[width] duration-300"
            style={{ width: `${Math.max(2, state.percent)}%` }}
          />
        </div>
      ) : null}

      {/* 副文案（通道说明 / MB 数字 / 指引） */}
      <p className="text-[12px] leading-relaxed text-muted-foreground">{state.note}</p>

      {/* 操作行 */}
      <div className="flex items-center gap-2">
        {state.phase === 'need-permission' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-9 flex-1 rounded-full bg-[#34C759] text-[13.5px] font-medium text-white transition-opacity active:opacity-70"
          >
            已允许，重试下载
          </button>
        ) : null}
        {state.phase === 'error' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-9 flex-1 rounded-full bg-[#34C759] text-[13.5px] font-medium text-white transition-opacity active:opacity-70"
          >
            重试
          </button>
        ) : null}
        {state.phase === 'fallback' ? (
          <button
            type="button"
            onClick={() => void copyApkLink(setCopied, 8000)}
            className="h-9 flex-1 rounded-full border border-black/10 text-[13px] font-medium text-foreground/75 transition-colors active:bg-muted/50 dark:border-white/15"
          >
            {copied ? '✓ 直链已复制' : '复制下载直链'}
          </button>
        ) : null}
        {state.phase === 'fallback' ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-9 flex-1 rounded-full border border-black/10 text-[13px] font-medium text-foreground/75 transition-colors active:bg-muted/50 dark:border-white/15"
          >
            <span className="inline-flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              再试一次
            </span>
          </button>
        ) : null}
        {state.phase === 'done' && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-full rounded-full border border-black/10 text-[13px] font-medium text-foreground/75 transition-colors active:bg-muted/50 dark:border-white/15"
          >
            好
          </button>
        ) : null}
        {/* downloading 中途允许先收起（下载在后台继续，通知栏有进度） */}
        {state.phase === 'downloading' && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-full text-[12.5px] text-muted-foreground active:opacity-60"
          >
            先在后台下着，稍后再装
          </button>
        ) : null}
      </div>
    </div>
  );
}
