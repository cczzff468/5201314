'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Delete } from 'lucide-react';

const KEY_LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

/**
 * iOS 风格数字密码输入（锁屏解锁与设置 App 共用）。
 * - 圆点 + 3x4 玻璃质感键盘，输满 length 位自动回调 onComplete（回调后自动清空供下一次输入）；
 * - 圆点填入带弹簧弹入动画，errorSignal 每递增一次播放一次左右抖动（密码错误反馈）；
 * - light=true 用于锁屏深色毛玻璃背景（白色配色），默认跟随主题前景色（设置 App 用）；
 * - 支持物理键盘数字键与退格。
 */
export default function PasscodePad({
  length,
  onComplete,
  errorSignal = 0,
  light = false,
  disabled = false,
  className = '',
}: {
  length: 4 | 6;
  onComplete: (code: string) => void;
  /** 每递增一次播放一次错误抖动 */
  errorSignal?: number;
  /** 白色配色（锁屏深色背景用） */
  light?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [code, setCode] = useState('');
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  const press = (d: string) => {
    if (disabled) return;
    setCode((c) => (c.length >= length ? c : c + d));
  };

  const back = () => {
    if (disabled) return;
    setCode((c) => c.slice(0, -1));
  };

  // 输满后延时回调（effect 驱动：StrictMode 双调度/重渲染都只触发一次；回调后清空供下一轮输入）
  useEffect(() => {
    if (code.length !== length) return;
    const t = window.setTimeout(() => {
      completeRef.current(code);
      setCode('');
    }, 180);
    return () => window.clearTimeout(t);
  }, [code, length]);

  // 物理键盘支持（数字 + 退格）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        press(e.key);
      } else if (e.key === 'Backspace') {
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, length]);

  const keyClass = `flex h-[76px] w-[76px] select-none flex-col items-center justify-center rounded-full transition-[transform,background-color,box-shadow] duration-150 ease-out active:scale-90 ${
    light
      ? 'bg-white/[0.13] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)] ring-1 ring-inset ring-white/[0.12] backdrop-blur-sm active:bg-white/[0.32]'
      : 'bg-foreground/[0.06] text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-inset ring-foreground/[0.08] active:bg-foreground/[0.13]'
  }`;

  return (
    <motion.div
      key={errorSignal}
      animate={errorSignal > 0 ? { x: [0, -12, 12, -8, 8, -4, 0] } : { x: 0 }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      className={`flex flex-col items-center gap-[46px] ${className}`}
    >
      {/* 密码圆点（填入时弹簧弹入；锁屏用纯白，设置页用前景色） */}
      <div className="flex items-center gap-[24px]" aria-label={`已输入 ${code.length} / ${length} 位`} role="img">
        {Array.from({ length }).map((_, i) => {
          const filled = i < code.length;
          return (
            <motion.span
              key={`${i}-${filled ? 'f' : 'e'}`}
              initial={filled ? { scale: 0.35, opacity: 0.5 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              className={`h-[14px] w-[14px] rounded-full border-2 border-current transition-colors duration-100 ${
                light ? 'text-white' : 'text-foreground'
              } ${filled ? 'bg-current' : ''}`}
            />
          );
        })}
      </div>

      {/* 数字键盘 */}
      <div className="grid grid-cols-3 gap-x-[24px] gap-y-[16px]" role="group" aria-label="密码键盘">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className={keyClass} onClick={() => press(d)} aria-label={d}>
            <span className="text-[32px] font-light leading-none tracking-[-0.01em]">{d}</span>
            {KEY_LETTERS[d] && (
              <span className="mt-[4px] text-[10px] font-semibold leading-none tracking-[0.22em] opacity-55">
                {KEY_LETTERS[d]}
              </span>
            )}
          </button>
        ))}
        {/* 空位 */}
        <span aria-hidden="true" />
        <button type="button" className={keyClass} onClick={() => press('0')} aria-label="0">
          <span className="text-[32px] font-light leading-none tracking-[-0.01em]">0</span>
        </button>
        {/* 删除键 */}
        <button
          type="button"
          className={`flex h-[76px] w-[76px] items-center justify-center rounded-full transition-[transform,background-color] duration-150 active:scale-90 ${
            light
              ? 'text-white/75 active:bg-white/[0.14]'
              : 'text-muted-foreground active:bg-foreground/[0.08]'
          } ${code.length === 0 ? 'pointer-events-none opacity-0' : ''}`}
          onClick={back}
          aria-label="删除"
        >
          <Delete className="h-[26px] w-[26px]" strokeWidth={1.7} />
        </button>
      </div>
    </motion.div>
  );
}
