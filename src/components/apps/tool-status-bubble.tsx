'use client';

/**
 * 工具调用状态气泡（毛玻璃椭圆胶囊）：v2.4.3 统一样式，v2.4.5 补长按操作。
 *
 * v2.4.5（机主需求「所有工具类的提示都统一一下，简约，长按可以复制，删除，重新操作」）：
 * - 气泡本体保持极简（图标徽章 + 主文案 + 截断副文案）；
 * - 长按（480ms，与聊天消息长按同手感）弹小操作卡：复制 / 删除 / 重新操作；
 *   · 复制 = 主文案+副文案写入剪贴板；
 *   · 删除 = 从会话 kv 移除本条气泡（removeToolStatusMsg + 事件刷新）；
 *   · 重新操作 = 仅对标记路径气泡（tool.op 存了原始 [手机操作:…] 参数）提供，
 *     点击后重新入串行队列执行，新气泡照常弹出（FC 工具路径没有参数快照，不提供）；
 * - 只有传了 msgId + sessionKey（即真正落库的气泡）才启用长按菜单——
 *   历史遗留无 id 的气泡纯展示。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { ToolStatusPayload } from '@/lib/ios/tool-status-bubble';
import { removeToolStatusMsg } from '@/lib/ios/tool-status-bubble';

interface Props {
  tool: ToolStatusPayload;
  /** 落库消息 id（传入才启用长按菜单） */
  msgId?: string;
  /** 所属会话键（删除/重试落库用） */
  sessionKey?: string;
}

/** 具名导出（既有 import { ToolStatusBubble } 兼容）+ 默认导出 */
export function ToolStatusBubble({ tool, msgId, sessionKey }: Props) {
  return <ToolStatusBubbleInner tool={tool} msgId={msgId} sessionKey={sessionKey} />;
}

export default ToolStatusBubble;

function ToolStatusBubbleInner({ tool, msgId, sessionKey }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const moved = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const interactive = Boolean(msgId && sessionKey);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('touchstart', close, { passive: true } as AddEventListenerOptions);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('touchstart', close);
    };
  }, [menuOpen]);

  const openMenu = useCallback(() => {
    if (!interactive) return;
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 无震动能力忽略 */
    }
    setMenuOpen(true);
  }, [interactive]);

  const startPress = useCallback(() => {
    if (!interactive) return;
    moved.current = false;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(openMenu, 480);
  }, [interactive, openMenu]);

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onMove = useCallback(() => {
    moved.current = true;
    cancelPress();
  }, [cancelPress]);

  useEffect(() => cancelPress, [cancelPress]);

  const handleCopy = useCallback(() => {
    const text = `${tool.title}${tool.body ? `\n${tool.body}` : ''}`;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    setMenuOpen(false);
    window.setTimeout(() => setCopied(false), 1400);
  }, [tool.title, tool.body]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    if (msgId && sessionKey) removeToolStatusMsg(sessionKey, msgId);
  }, [msgId, sessionKey]);

  const handleRetry = useCallback(() => {
    setMenuOpen(false);
    const arg = tool.op?.trim();
    if (!arg || retrying) return;
    setRetrying(true);
    void (async () => {
      try {
        const { enqueuePhoneOp } = await import('@/lib/ios/device-autonomy');
        await enqueuePhoneOp(arg);
      } catch {
        /* 执行器异常静默（气泡已回 fail 态即有反馈） */
      } finally {
        setRetrying(false);
      }
    })();
  }, [tool.op, retrying]);

  return (
    <div
      ref={rootRef}
      className="relative my-1.5 flex w-full justify-center px-2"
      data-testid="tool-status-bubble"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={onMove}
      onContextMenu={(e) => {
        if (interactive) e.preventDefault();
      }}
    >
      <div
        className="inline-flex max-w-[86%] cursor-default items-center gap-2 rounded-full bg-black/[0.045] px-3.5 py-[7px] text-[12.5px] text-black/60 backdrop-blur-xl dark:bg-white/[0.09] dark:text-white/70"
        style={{ minHeight: 30, boxSizing: 'border-box' }}
      >
        {copied ? (
          <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500/15">
            <Check className="h-[11px] w-[11px] text-emerald-400" strokeWidth={3} />
          </span>
        ) : tool.status === 'pending' ? (
          <Loader2 className="h-[15px] w-[15px] shrink-0 animate-spin text-black/40 dark:text-white/50" aria-hidden="true" />
        ) : tool.status === 'done' ? (
          null // v2.4.29 机主要求：done 态不显示图标（绿色对号删除），只留文案
        ) : (
          <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#FF453A]/15">
            <X className="h-[11px] w-[11px] text-[#FF6961]" strokeWidth={2.6} />
          </span>
        )}
        <span className="min-w-0 truncate font-medium">{tool.title}</span>
        {tool.body && <span className="min-w-0 max-w-[13rem] truncate text-black/40 dark:text-white/45">{tool.body}</span>}
        {retrying && <Loader2 className="h-[13px] w-[13px] shrink-0 animate-spin text-black/40 dark:text-white/50" aria-hidden="true" />}
      </div>

      {menuOpen && (
        <div
          className="absolute left-1/2 top-full z-[80] mt-1 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-black/80 px-2 py-1.5 shadow-xl ring-1 ring-white/15 backdrop-blur-xl"
          role="menu"
          data-testid="tool-status-menu"
        >
          <button
            type="button"
            className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10.5px] text-white/85 transition-colors active:bg-white/10"
            onClick={handleCopy}
          >
            <Copy className="h-[16px] w-[16px]" strokeWidth={1.9} aria-hidden="true" />
            复制
          </button>
          <button
            type="button"
            className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10.5px] text-white/85 transition-colors active:bg-white/10"
            onClick={handleDelete}
          >
            <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.9} aria-hidden="true" />
            删除
          </button>
          {tool.op ? (
            <button
              type="button"
              className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10.5px] text-white/85 transition-colors active:bg-white/10"
              onClick={handleRetry}
              disabled={retrying}
            >
              <RotateCcw className="h-[16px] w-[16px]" strokeWidth={1.9} aria-hidden="true" />
              重新操作
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
