'use client';

import { useEffect, useState } from 'react';

/**
 * iOS 风格底部动作表（对照用户截图）：
 * - 半透明黑色遮罩（点击 = 取消）；
 * - 底部滑入一组白色圆角动作行（居中 20px 蓝字，行间细分隔线），破坏性动作为红色；
 * - 动作组下方一个独立的白色圆角「取消」按钮；
 * - 深色模式自动切换为深灰卡片 + 亮蓝文字；
 * - 关闭时播放 200ms 滑出动画后再真正卸载。
 *
 * 用法（渲染在 App 自己的 relative 容器内，绝对定位铺满该 App）：
 *   <IOSActionSheet
 *     open={!!target}
 *     actions={[
 *       { label: '置顶', onSelect: () => {} },
 *       { label: '删除', destructive: true, onSelect: () => {} },
 *     ]}
 *     onCancel={() => setTarget(null)}
 *   />
 */

export interface ActionSheetAction {
  label: string;
  /** 破坏性动作（红色，如删除） */
  destructive?: boolean;
  onSelect: () => void;
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function IOSActionSheet({
  open,
  actions,
  onCancel,
}: {
  open: boolean;
  actions: ActionSheetAction[];
  onCancel: () => void;
}) {
  /** 挂载开关（退出动画期间仍挂载） */
  const [mounted, setMounted] = useState(open);
  /** 进场/退场动画状态 */
  const [shown, setShown] = useState(false);

  // open 切换时驱动进/退场动画（setState 全部在 rAF/timeout 回调内，遵守 React Compiler lint）
  useEffect(() => {
    let raf = 0;
    let inner = 0;
    let timer = 0;
    if (open) {
      raf = requestAnimationFrame(() => {
        setMounted(true);
        inner = requestAnimationFrame(() => setShown(true));
      });
    } else {
      raf = requestAnimationFrame(() => {
        setShown(false);
        // 退场动画播完后再真正卸载
        timer = window.setTimeout(() => setMounted(false), 210);
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label="操作菜单" aria-modal="true">
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="取消"
        onClick={onCancel}
        className={`absolute inset-0 cursor-default bg-black/45 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 动作区 */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-2 pb-[calc(14px+env(safe-area-inset-bottom))] transition-transform duration-[260ms] ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ transitionTimingFunction: EASE }}
      >
        {/* 动作组 */}
        <div className="overflow-hidden rounded-[14px] bg-[#f4f4f6]/95 backdrop-blur-2xl dark:bg-[#2a2a2c]/95">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                onCancel();
                a.onSelect();
              }}
              className={`flex h-[57px] w-full items-center justify-center text-[20px] leading-none transition-colors active:bg-black/5 dark:active:bg-white/10 ${
                i > 0 ? 'border-t border-black/10 dark:border-white/10' : ''
              } ${a.destructive ? 'text-[#FF3B30] dark:text-[#FF453A]' : 'text-[#007AFF] dark:text-[#0A84FF]'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
        {/* 独立取消按钮 */}
        <button
          type="button"
          onClick={onCancel}
          className="flex h-[57px] w-full items-center justify-center rounded-[14px] bg-white/95 text-[20px] font-semibold leading-none text-[#007AFF] backdrop-blur-2xl transition-colors active:bg-black/5 dark:bg-[#2a2a2c]/95 dark:text-[#0A84FF] dark:active:bg-white/10"
        >
          取消
        </button>
      </div>
    </div>
  );
}
