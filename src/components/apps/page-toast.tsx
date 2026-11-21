'use client';

/**
 * 页内 Toast（微信/QQ 聊天页与收藏页专用）：
 * App 根部的 toast 在这些页面里不渲染——微信「chatPeer 有值 / page=favorites」分支会提前
 * return，根本走不到根部的 {toast && ...}，导致聊天页里所有操作提示（已复制/收藏成功/
 * 取消收藏/已转发给 xx…）一直不可见。这里给每个独立页面提供自带的 toast：
 * useLocalToast() 返回 [文案, 显示函数]，页面根部渲染 <LocalToast msg={...} />。
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
    timer.current = setTimeout(() => setToast(''), 1600);
  }, []);
  return [toast, show];
}

/** toast 浮层（absolute 居中，挂载页面的根元素需为定位祖先；zClass 盖过页面内弹层） */
export function LocalToast({ msg, zClass = 'z-[80]' }: { msg: string; zClass?: string }) {
  if (!msg) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white ${zClass}`}
    >
      {msg}
    </div>
  );
}
