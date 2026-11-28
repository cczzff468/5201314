'use client';

/**
 * 页内 Toast（微信/QQ 聊天页与收藏页专用）：
 * App 根部的 toast 在这些页面里不渲染——微信「chatPeer 有值 / page=favorites」分支会提前
 * return，根本走不到根部的 {toast && ...}，导致聊天页里所有操作提示（已复制/收藏成功/
 * 取消收藏/已转发给 xx…）一直不可见。这里给每个独立页面提供自带的 toast：
 * useLocalToast() 返回 [文案, 显示函数]，页面根部渲染 <LocalToast msg={...} />。
 *
 * v2.4.36 液态玻璃大清洗：黑底圆角块 → 屏幕中央「液态玻璃胶囊」——
 * 半透明白 + blur(20px) + 极细白描边 + 弥散柔光晕阴影，2 秒自动消失，
 * 与全局 sonner 中央胶囊同款语言（globals.css 液态玻璃段）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useLocalToast(): [string, (m: string) => void] {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const show = useCallback((m: string) => {
    setToast(m);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2000);
  }, []);
  return [toast, show];
}

/** 中央液态玻璃胶囊 toast 浮层（absolute 居中，挂载页面的根元素需为定位祖先；
 *  z-[400] 全局最顶；淡入 200ms；v2.4.36 液态玻璃胶囊化 + 2s 自动消失 */
export function LocalToast({ msg, zClass = 'z-[400]' }: { msg: string; zClass?: string }) {
  if (!msg) return null;
  return (
    <div
      key={msg}
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 top-1/2 z-[400] max-w-[86vw] -translate-x-1/2 -translate-y-1/2 animate-in fade-in zoom-in-95 duration-200 whitespace-nowrap rounded-full border border-white/55 bg-white/66 px-5 py-[11px] text-[13.5px] font-medium leading-none text-zinc-900/94 shadow-[0_4px_12px_rgba(24,24,27,0.06),0_16px_48px_rgba(24,24,27,0.14),inset_0_1px_0_rgba(255,255,255,0.6)] [backdrop-filter:blur(20px)_saturate(1.7)] [-webkit-backdrop-filter:blur(20px)_saturate(1.7)] dark:border-white/10 dark:bg-zinc-900/62 dark:text-zinc-100 ${zClass}`}
    >
      {msg}
    </div>
  );
}
