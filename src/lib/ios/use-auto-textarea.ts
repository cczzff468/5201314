import { useEffect, useRef } from 'react';

/**
 * 重算 textarea 高度 = 内容高度（封顶 maxPx，超出后内部滚动）。
 * 配合 rows=1 + min-h 使用：单行时与原单行输入框等高，多行自动增高，清空自动回落。
 */
export function autoResizeTextarea(el: HTMLTextAreaElement | null, maxPx = 132) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
}

/**
 * 聊天输入框多行自适应：value 变化（键入/粘贴/清空/发送后重置）自动增高。
 * 132px ≈ 微信/输入法同款的 5~6 行封顶，再多在框内滚动。
 */
export function useAutoTextareaRef(value: string, maxPx = 132) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    autoResizeTextarea(ref.current, maxPx);
  }, [value, maxPx]);
  return ref;
}
