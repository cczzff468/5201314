'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

/**
 * iOS 风格导航栏。
 * - 自带 pt-[54px] 预留状态栏高度
 * - large=true 且非 inline 时显示 34px 大标题，false 时显示居中 19px 标题
 * - inline=true 时标题紧随左侧返回键同行显示（「← 标题」，用户要求返回键都在标签左面）
 */
export function IOSNavBar({
  title,
  left,
  right,
  large = true,
  inline = false,
  className = '',
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  large?: boolean;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div className={`sticky top-0 z-20 shrink-0 bg-background/80 backdrop-blur-xl pt-[54px] ${className}`}>
      <div className="relative flex h-11 items-center justify-between px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {left}
          {inline && <span className="truncate text-[19px] font-bold leading-none tracking-tight">{title}</span>}
        </div>
        {!inline && !large && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[19px] font-bold tracking-tight">
            {title}
          </div>
        )}
        <div className="flex min-w-[64px] shrink-0 items-center justify-end gap-4">{right}</div>
      </div>
      {large && !inline && (
        <div className="px-5 pb-2 pt-0.5 text-[34px] font-bold leading-tight tracking-tight">{title}</div>
      )}
    </div>
  );
}

/** iOS 返回按钮（黑白灰单色，随主题自适应；label 传空字符串则只显示箭头） */
export function IOSBackButton({ onClick, label = '返回' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label || '返回'}
      className="-ml-1 flex items-center text-[17px] text-foreground transition-opacity active:opacity-50"
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
      {label && <span>{label}</span>}
    </button>
  );
}

/** iOS 文字按钮（黑白灰单色，随主题自适应） */
export function IOSTextButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[17px] text-foreground transition-opacity active:opacity-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** App 内容容器：填满屏幕、纵向布局 */
export function IOSScreen({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full w-full flex-col overflow-hidden bg-background text-foreground ${className}`}>
      {children}
    </div>
  );
}
