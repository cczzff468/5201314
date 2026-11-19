'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'plain' | 'danger';

/**
 * iOS 简约毛玻璃按钮：半透明底 + 背景模糊 + 发丝描边（浅色/深色自适应）。
 * 用于「信息」「联系人」App 的操作按钮，替代此前的虚线边框风格。
 * - plain：中性玻璃（卡片半透底）
 * - danger：红色语义玻璃（删除/确认删除）
 */
export function GlassButton({
  variant = 'plain',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  const skin =
    variant === 'danger'
      ? 'border-[#FF453A]/30 bg-[#FF453A]/[0.10] text-[#FF453A] dark:border-[#FF453A]/35 dark:bg-[#FF453A]/[0.16]'
      : 'border-border/60 bg-card/60 text-foreground dark:border-white/[0.14] dark:bg-white/[0.10]';
  return (
    <button
      type="button"
      className={`backdrop-blur-xl shadow-[0_1px_6px_rgba(0,0,0,0.05)] transition-all active:scale-95 disabled:opacity-40 ${skin} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
