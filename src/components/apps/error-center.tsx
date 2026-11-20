'use client';

import { useEffect, useRef, useState } from 'react';
import { useErrorCenter, type ErrorRec } from '@/lib/error-center';

/** 通用内联错误指示器（v18 机主定调「界面不铺错误长文」）：极简「label · 点击查看详情」
 *  小胶囊——挂载时把错误上报进中心，点击直达该条的详情弹窗（标题+详细+复制）。
 *  用法：原「红/琥珀横幅铺全文」的失败态换成本组件（成功态照旧短句展示）。
 *  v19 渲染期 setState 修复：上报改在 effect 里做（旧版 useMemo 里调 report——渲染另一
 *  组件（ErrorCenter）期间 set store，React 报「Cannot update a component while
 *  rendering a different component」）。errId 只存 ref（点击时读，effect 早于用户点击；
 *  尚未上报的窗口期兜底打开错误列表）。 */
export function InlineErrorChip({
  label,
  msg,
  scope,
  className = '',
}: {
  label: string;
  msg: string;
  scope: string;
  className?: string;
}) {
  const openError = useErrorCenter((s) => s.openError);
  const openList = useErrorCenter((s) => s.openList);
  const errIdRef = useRef<string | null>(null);
  useEffect(() => {
    errIdRef.current = useErrorCenter.getState().report(label, msg, scope);
  }, [label, msg, scope]);
  return (
    <button
      type="button"
      aria-label={`${label}，点击查看错误详情`}
      onClick={() => {
        const id = errIdRef.current;
        if (id) openError(id);
        else openList();
      }}
      className={`flex w-full items-center gap-1.5 rounded-[10px] bg-[#FF453A]/[0.08] px-3.5 py-2 text-left text-[12px] leading-[1.5] text-[#FF453A] active:opacity-70 dark:bg-[#FF453A]/[0.14] ${className}`}
    >
      <span className="mt-[1px] inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-[#FF453A]" aria-hidden />
      <span className="min-w-0 shrink">{label} · 点击查看详情</span>
    </button>
  );
}

function fmtTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 全局错误中心 UI（v18 机主定调「全部错误提示弹窗化」）：界面上不铺错误长文——只有右上角
 *  极简「错误」指示器（有错才出现）；点击 → 弹窗：标题（错误分类）+ 详细（原始错误全文，
 *  可滚动/复制）；多条错误时弹窗为列表模式逐条点开。挂载于 PhoneShell（z-[90]，错误不盖来电）。 */

function CopyButton({ rec }: { rec: ErrorRec }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const payload = `【${rec.title}】\n${fmtTime(rec.at)}\n${rec.detail}`;
        try {
          void navigator.clipboard?.writeText(payload);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* 剪贴板不可用忽略 */
        }
      }}
      className="rounded-full px-3 py-1 text-[13px] text-blue-500 active:bg-black/5"
    >
      {copied ? '已复制' : '复制详情'}
    </button>
  );
}

export default function ErrorCenter() {
  const { errors, open, openId, listMode, openList, openError, close, dismiss, clearAll } = useErrorCenter();

  // 全局兜底监听（挂载一次）：window 未捕获错误 / unhandledrejection 统一进中心
  useEffect(() => {
    const mod = (window as unknown as { __errorCenterInstalled?: boolean });
    if (mod.__errorCenterInstalled) return;
    mod.__errorCenterInstalled = true;
    // 动态引入避免 SSR 时碰 window
    void import('@/lib/error-center').then((m) => {
      m.installGlobalErrorListeners();
    });
  }, []);

  const current = openId ? errors.find((e) => e.id === openId) || null : null;
  const badgeCount = errors.length;

  // 弹窗正文（iOS 弹窗风：标题 + 滚动详情 + 操作行）
  return (
    <>
      {/* 极简指示器：有错才出现（机主要求「界面上不要显示错误提示了，只显示一个错误/异常」） */}
      {badgeCount > 0 && !open && (
        <button
          type="button"
          aria-label={`错误：${badgeCount} 条，点击查看详情`}
          data-testid="error-center-badge"
          onClick={openList}
          className="absolute right-2 top-[52px] z-[90] flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md active:scale-95 dark:bg-white/60 dark:text-black"
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-red-500" aria-hidden />
          错误{badgeCount > 1 ? ` ${badgeCount}` : ''}
        </button>
      )}

      {/* 详情/列表弹窗（z-[97]：打开时盖住来电层以外的全部内容；错误弹窗优先级仅次于熄屏） */}
      {open && (
        <div className="absolute inset-0 z-[97] flex items-center justify-center bg-black/35 backdrop-blur-[2px]" role="dialog" aria-modal="true" data-testid="error-center-dialog">
          <div className="mx-5 flex max-h-[72%] w-full max-w-[300px] flex-col overflow-hidden rounded-[16px] bg-white shadow-xl dark:bg-[#2C2C2E]">
            {/* 标题区（弹窗上半：错误标题/分类名） */}
            <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 pb-2 pt-4 dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-block h-[8px] w-[8px] shrink-0 rounded-full bg-red-500" aria-hidden />
                <span className="truncate text-[16px] font-semibold leading-snug text-black dark:text-white">
                  {current ? current.title : `错误 · ${errors.length} 条`}
                </span>
              </div>
              <button type="button" aria-label="关闭错误详情" onClick={close} className="shrink-0 rounded-full p-1.5 text-black/40 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {current ? (
              /* 单条详情模式：下半是错误详细（滚动 + 可选中复制）+ 可选动作（如「重试」） */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <div className="mb-1 text-[11px] text-black/35 dark:text-white/35">{fmtTime(current.at)}{current.scope ? ` · ${current.scope}` : ''}</div>
                  <div className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.55] text-black/80 selection:bg-black/15 dark:text-white/80 dark:selection:bg-white/25" data-testid="error-center-detail">
                    {current.detail || '（无详细错误信息）'}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-black/[0.06] px-3 py-2 dark:border-white/10">
                  <div className="flex items-center gap-1">
                    {current.actionLabel && (
                      <button
                        type="button"
                        data-testid="error-center-action"
                        onClick={() => {
                          try { current.actionRun?.(); } catch { /* 动作失败：错误会另行上报 */ }
                        }}
                        className="rounded-full px-3 py-1 text-[13px] font-medium text-blue-500 active:bg-blue-500/10"
                      >
                        {current.actionLabel}
                      </button>
                    )}
                    <CopyButton rec={current} />
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => dismiss(current.id)} className="rounded-full px-3 py-1 text-[13px] text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
                      知道了
                    </button>
                    <button type="button" onClick={clearAll} className="rounded-full px-3 py-1 text-[13px] text-red-500 active:bg-red-500/10">
                      清除全部
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* 列表模式：逐条点开详情 */
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                  {errors.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => openError(e.id)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/10"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-black dark:text-white">{e.title}</span>
                        <span className="block truncate text-[11px] text-black/35 dark:text-white/35">
                          {fmtTime(e.at)} · {String(e.detail || '').slice(0, 60) || '（无详情）'}
                        </span>
                      </span>
                      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-black/25 dark:text-white/30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M6 3.5 10.5 8 6 12.5" />
                      </svg>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1 border-t border-black/[0.06] px-3 py-2 dark:border-white/10">
                  <button type="button" onClick={clearAll} className="rounded-full px-3 py-1 text-[13px] text-red-500 active:bg-red-500/10">
                    清除全部（{errors.length}）
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
