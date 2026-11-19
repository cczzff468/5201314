'use client';

import { ChevronLeft } from 'lucide-react';
import { useUI } from '@/lib/ios/store';

/**
 * 共享「返回主屏幕」按钮（App 根界面用）。
 *
 * 默认浮动在屏幕左上（状态栏下方 44px 触控区），点击调用 useUI.closeApp() 回主屏幕；
 * 需要内嵌进现有 header/顶栏时传 className="static!"（覆盖 absolute 定位，改为文档流内元素）；
 * 深色全屏界面（相机等）传 light 使用白色箭头。无圆形背景（用户要求去掉返回键外面的圆形）。
 * 传入 onClick 时优先调用（如锁屏直达相机的「回锁屏」）。
 */
export function BackToHome({
  className = '',
  light = false,
  onClick,
}: {
  className?: string;
  light?: boolean;
  onClick?: () => void;
}) {
  const closeApp = useUI((s) => s.closeApp);
  const handleClick = onClick ?? closeApp;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="返回主屏幕"
      className={`absolute left-[10px] top-[60px] z-[45] flex h-11 w-11 items-center justify-center transition-opacity active:opacity-50 ${
        light ? 'text-white' : 'text-foreground'
      } ${className}`}
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
    </button>
  );
}
