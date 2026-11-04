'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 聊天错误提示行（Task 40「错误提示优化」）：居中灰色小字，不进气泡、不写入聊天记录。
 *
 * - 渲染在失败消息的位置（消息流内的独立一行，样式对齐「消息已撤回」类系统行）；
 * - 单击整行 = 重试；长按 480ms = 菜单（重试 / 复制错误详情 / 隐藏这条提示）；
 * - 冷却中：点击给出冷却提示（不重复发请求）；
 * - 原始报错只在「复制错误详情」里离开系统（剪贴板），界面永不直接展示；
 * - 隐藏 = 本会话内存态（重挂载/刷新后恢复显示，语义是「知道了」）。
 */

export interface ChatErrorLineProps {
  /** 分类后的友好文案（如「网络不稳定，请稍后重试」） */
  text: string;
  /** 原始错误（仅「复制错误详情」用，不显示；缺省复制 text） */
  detail?: string;
  /** 重试回调（点击整行 / 菜单重试；空 = 不显示重试项） */
  onRetry?: () => void;
  /** 冷却中提示文案（非空 = 重试被拦截，行尾展示） */
  cooldownText?: string;
  /** 隐藏回调（菜单「隐藏这条提示」） */
  onHide?: () => void;
  testId?: string;
}

/** 长按触发时长（与气泡菜单 useBubbleLongPress 同规格） */
const LONG_PRESS_MS = 480;

export function ChatErrorLine({ text, detail, onRetry, cooldownText, onHide, testId }: ChatErrorLineProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const menuOpenedAt = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
    };
  }, []);

  const clearPress = useCallback(() => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    longPressed.current = false;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setCopied(false);
      menuOpenedAt.current = Date.now();
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }, [clearPress]);

  /** 菜单打开后短时间内忽略遮罩点击：长按释放（pointerup）会合成一次 click，
   *  此刻菜单刚弹出、透明遮罩已铺满全屏，这次 click 会落遮罩上立刻把菜单关掉（打开即闪退） */
  const onScrimClick = useCallback(() => {
    if (Date.now() - menuOpenedAt.current < 400) return;
    setMenuOpen(false);
  }, []);

  const onPointerUp = useCallback(() => {
    clearPress();
    if (longPressed.current) {
      // 长按已弹菜单：吞掉本次 click（不再触发整行重试）
      longPressed.current = false;
    }
  }, [clearPress]);

  const onClick = useCallback(() => {
    if (!onRetry || cooldownText) return;
    onRetry();
  }, [onRetry, cooldownText]);

  const doRetry = useCallback(() => {
    setMenuOpen(false);
    if (!onRetry || cooldownText) return;
    onRetry();
  }, [onRetry, cooldownText]);

  const doCopy = useCallback(() => {
    try {
      const raw = (detail || '').trim();
      const payload = raw && raw !== text ? `${text}\n----\n原始错误：${raw}` : text;
      void navigator.clipboard?.writeText(payload);
      setCopied(true);
      window.setTimeout(() => {
        if (mounted.current) setMenuOpen(false);
      }, 600);
    } catch {
      // 剪贴板不可用：仅收起菜单
      setMenuOpen(false);
    }
  }, [detail, text]);

  const clickable = !!onRetry && !cooldownText;

  return (
    <div className="relative flex justify-center py-1.5" data-testid={testId ? `${testId}-wrap` : undefined}>
      <button
        type="button"
        data-testid={testId}
        aria-label={`发送失败：${text}${clickable ? '，点击重试' : ''}`}
        className={`max-w-[86%] rounded-md px-2 py-0.5 text-center text-[12px] leading-[17px] text-black/40 select-none dark:text-white/40 ${
          clickable ? 'cursor-pointer active:opacity-60' : 'cursor-default'
        }`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {text}
        {cooldownText ? `（${cooldownText}）` : ''}
      </button>
      {menuOpen && (
        <>
          {/* 全屏透明层：点击任意处收起菜单（长按释放的合成 click 由 openedAt 守卫忽略） */}
          <div className="fixed inset-0 z-40" onClick={onScrimClick} aria-hidden />
          <div
            className="absolute -top-2 left-1/2 z-50 w-[150px] -translate-x-1/2 overflow-hidden rounded-[10px] bg-white shadow-lg ring-1 ring-black/10 dark:bg-[#2C2C2E] dark:ring-white/10"
            role="menu"
            data-testid={testId ? `${testId}-menu` : undefined}
          >
            {onRetry && (
              <button
                type="button"
                role="menuitem"
                disabled={!!cooldownText}
                onClick={doRetry}
                className={`block w-full px-3 py-2 text-center text-[14px] text-black dark:text-white ${
                  cooldownText ? 'opacity-40' : 'active:bg-black/5 dark:active:bg-white/10'
                }`}
              >
                {cooldownText ? '冷却中…' : '重新发送'}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={doCopy}
              className="block w-full px-3 py-2 text-center text-[14px] text-black active:bg-black/5 dark:text-white dark:active:bg-white/10"
            >
              {copied ? '已复制' : '复制错误详情'}
            </button>
            {onHide && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onHide();
                }}
                className="block w-full px-3 py-2 text-center text-[14px] text-black active:bg-black/5 dark:text-white dark:active:bg-white/10"
              >
                隐藏这条提示
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
