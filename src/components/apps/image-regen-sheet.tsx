'use client';

import { Loader2, RefreshCw } from 'lucide-react';

/**
 * 「重新生成图片」弹层（信息/微信/QQ 长按 AI 图片弹出，三端共用）：
 * 可编辑生成描述（预填原图描述）→ 用 设置 › 图像生成 的配置 + 角色形象锁脸重新生成，
 * 成功后原地替换该张图片（消息记录里更新，不新增消息）。
 * 视觉与「文字图片」操作面板（TextCardActionSheet）同款底部弹层。
 */
export function ImageRegenSheet({
  desc,
  busy,
  error,
  accent,
  onDescChange,
  onSubmit,
  onClose,
}: {
  /** 生成描述（受控输入，预填原图描述；提交时需非空） */
  desc: string;
  /** 正在重新生成（提交按钮转圈、输入与关闭禁用） */
  busy: boolean;
  /** 上次提交的错误信息（空串 = 无错误） */
  error: string;
  /** 各端主题色（信息 #007AFF / 微信 #07C160 / QQ #0099FF） */
  accent: string;
  onDescChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-3 pb-[max(14px,env(safe-area-inset-bottom))]"
      data-testid="imgregen-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="重新生成图片"
    >
      <div className="w-full max-w-[340px]">
        <div className="overflow-hidden rounded-[14px] bg-white/95 pb-1 backdrop-blur-xl dark:bg-[#252528]/95">
          <div className="px-4 pb-1 pt-3">
            <p className="text-[15px] font-semibold text-black/85 dark:text-white/85">重新生成图片</p>
            <p className="mt-0.5 text-[11.5px] leading-[1.5] text-black/45 dark:text-white/45">
              修改描述后重新生成，将原地替换这张图片（使用 设置 › 图像生成 配置，自动锁定角色形象）
            </p>
            <textarea
              data-testid="imgregen-input"
              value={desc}
              onChange={(e) => onDescChange(e.target.value)}
              rows={3}
              maxLength={200}
              disabled={busy}
              placeholder="描述想要的画面（场景/动作/表情/氛围）"
              className="mt-2.5 w-full resize-none rounded-[10px] border border-black/[0.10] bg-black/[0.03] px-3 py-2 text-[13.5px] leading-[1.6] text-black/80 outline-none placeholder:text-black/30 focus:border-black/25 disabled:opacity-60 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white/85 dark:placeholder:text-white/30 dark:focus:border-white/30"
            />
            {error ? <p className="mt-1.5 text-[12px] text-red-500">{error}</p> : null}
          </div>
          <button
            type="button"
            data-testid="imgregen-submit"
            onClick={onSubmit}
            disabled={busy || !desc.trim()}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 text-[15.5px] font-medium active:bg-black/[0.05] disabled:opacity-60 dark:active:bg-white/[0.06]"
            style={{ color: accent }}
          >
            {busy ? (
              <>
                <Loader2 className="h-[16px] w-[16px] animate-spin" strokeWidth={2.4} aria-hidden="true" />
                正在重新生成…
              </>
            ) : (
              <>
                <RefreshCw className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
                重新生成图片
              </>
            )}
          </button>
        </div>
        <button
          type="button"
          data-testid="imgregen-cancel"
          onClick={onClose}
          disabled={busy}
          className="mt-2 flex min-h-[50px] w-full items-center justify-center rounded-[14px] bg-white/95 text-[16px] font-semibold text-black/80 backdrop-blur-xl active:bg-black/[0.05] disabled:opacity-60 dark:bg-[#252528]/95 dark:text-white/80 dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}
