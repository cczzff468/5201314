'use client';

/**
 * 角色分支弹层（Task 37，微信专用）：
 * - BranchDialog：长按聊天气泡 →「分支」→ 以该消息为分支点创建平行联系人
 *   （展示分支点摘要、分支名称输入、复制范围说明；确认后调 createCharacterBranch 全量复制）；
 * - BranchDeleteConfirmDialog：分支角色删除二次确认（真实删除：聊天/记忆/朋友圈一并清空，
 *   与「删除联系人」的隐藏式删好友不同，文案明确区分）。
 */

import { useState } from 'react';
import { createCharacterBranch, defaultBranchName } from '@/lib/ios/branch';
import type { ContactRecord } from '@/lib/contacts';

function fmtPointTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function BranchDialog({
  sourceId,
  sourceName,
  point,
  onCancel,
  onCreated,
}: {
  sourceId: string;
  sourceName: string;
  /** 分支点消息（长按的那条）：发送方 + 内容摘要 + 时间 */
  point: { id: string; role: 'me' | 'peer'; preview: string; time: number };
  onCancel: () => void;
  /** 创建成功回调（宿主切换进分支聊天） */
  onCreated: (c: ContactRecord) => void;
}) {
  const [name, setName] = useState(() => defaultBranchName(sourceName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { contact } = await createCharacterBranch({ sourceId, pointMsgId: point.id, name });
      onCreated(contact);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-8"
      data-testid="wx-branch-dialog"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-[320px] rounded-[14px] bg-white p-5 dark:bg-[#232529]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`为${sourceName}创建分支角色`}
      >
        <p className="text-[16px] font-medium">创建分支角色</p>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-black/45 dark:text-white/45">
          从这条消息把「{sourceName}」分出一个平行版本：两边从此独立发展，互不打扰。
        </p>

        {/* 分支点摘要 */}
        <div className="mt-3 rounded-[10px] bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.06]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-black/60 dark:text-white/60">
              分支点 · {point.role === 'me' ? '我' : sourceName}
            </span>
            <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">{fmtPointTime(point.time)}</span>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-[1.5] text-black/75 dark:text-white/75">
            {point.preview || '[消息]'}
          </p>
        </div>

        {/* 分支名称 */}
        <label className="mt-3 block">
          <span className="text-[12.5px] text-black/55 dark:text-white/55">分支名称（需与原角色不同名）</span>
          <input
            data-testid="wx-branch-name"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-[8px] bg-black/[0.04] px-3 text-[14px] outline-none focus:bg-black/[0.06] dark:bg-white/[0.08] dark:focus:bg-white/[0.12]"
            placeholder={defaultBranchName(sourceName)}
          />
        </label>

        <p className="mt-2.5 text-[12px] leading-[1.7] text-black/45 dark:text-white/45">
          将复制到分支点：人设 · 聊天记录 · 记忆 · 关系状态 · 朋友圈 · 世界书。
          <br />
          分支角色出现在联系人列表，可单独编辑人设、头像、音色；之后两边的新聊天、新记忆、新动态互不同步。
        </p>

        {error && <p className="mt-2 text-[12.5px] text-red-500">{error}</p>}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            data-testid="wx-branch-cancel"
            onClick={onCancel}
            disabled={busy}
            className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 disabled:opacity-50 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-branch-confirm"
            onClick={() => void submit()}
            disabled={busy}
            className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80 disabled:opacity-60"
          >
            {busy ? '创建中…' : '创建分支'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BranchDeleteConfirmDialog({
  branchName,
  onCancel,
  onConfirm,
}: {
  branchName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-8"
      data-testid="wx-delbranch-dialog"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[320px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`删除分支角色${branchName}`}
      >
        <p className="text-[16px] font-medium">删除分支角色</p>
        <p className="mt-2.5 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
          将彻底删除分支「{branchName}」：TA 会从联系人列表消失，且以下数据一并清空、无法恢复：
          <br />· 聊天记录
          <br />· 记忆
          <br />· 朋友圈动态与互动
          <br />· 世界书（分支克隆本）
        </p>
        <p className="mt-2 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
          原角色及其它分支不受任何影响。
        </p>
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            data-testid="wx-delbranch-cancel"
            onClick={onCancel}
            className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-delbranch-confirm"
            onClick={onConfirm}
            className="h-10 flex-1 rounded-[8px] bg-[#FA5151] text-[14px] font-medium text-white active:opacity-80"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
