'use client';

/**
 * 情侣小家 —— 虚拟摇杆
 *
 * - 固定底座 + 摇杆头（半透明玻璃风，贴 iOS 手机壳审美）
 * - pointer 事件计算归一化方向向量（-1 ~ 1），通过回调实时上报
 * - ⚠️ 手机壳整体缩放（桌面 ~0.57）：pointer 的 client 坐标是屏幕物理像素，
 *   而本组件内部布局是 CSS 像素 —— 必须先除以 scale 换算回 CSS 系再算偏移。
 * - 松手自动回正（framer-motion 弹簧），输出归零；knob 拖出范围按圆形边界 clamp
 */

import { memo, useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export interface JoystickProps {
  /** 输出（归一化向量，-1~1；每次 move 上报） */
  onVec: (dx: number, dy: number) => void;
  size?: number;
}

function JoystickInner({ onVec, size = 128 }: JoystickProps) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const centerRef = useRef<{ cx: number; cy: number; scale: number } | null>(null);
  const R = size / 2 - 22; // knob 最大半径（CSS px）

  const down = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation(); // 不触发场景 pan
      try {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* 非活跃指针（合成事件）安全忽略 */
      }
      const r = e.currentTarget.getBoundingClientRect();
      // 手机壳缩放：屏幕物理 px → 组件 CSS px 的换算因子
      const scale = r.width > 0 ? r.width / size : 1;
      centerRef.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, scale };
      setActive(true);
    },
    [size],
  );

  const move = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const c = centerRef.current;
      if (!c) return;
      // 屏幕 px → CSS px（除以手机壳 scale），再计算与中心的偏移
      let dx = (e.clientX - c.cx) / c.scale;
      let dy = (e.clientY - c.cy) / c.scale;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      setKnob({ x: dx, y: dy });
      onVec(dx / R, dy / R);
    },
    [R, onVec],
  );

  const up = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* 非活跃指针（合成事件）安全忽略 */
      }
      centerRef.current = null;
      setActive(false);
      setKnob({ x: 0, y: 0 });
      onVec(0, 0);
    },
    [onVec],
  );

  return (
    <div
      role="application"
      aria-label="移动摇杆"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="relative touch-none select-none rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 50% 40%, rgba(255,255,255,0.35), rgba(255,255,255,0.12) 60%, rgba(255,255,255,0.05))',
        border: '1.5px solid rgba(255,255,255,0.5)',
        boxShadow: active
          ? '0 8px 24px rgba(0,0,0,0.25), inset 0 0 18px rgba(255,255,255,0.25)'
          : '0 6px 18px rgba(0,0,0,0.18), inset 0 0 14px rgba(255,255,255,0.18)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {/* 方向刻度点 */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <span
          key={deg}
          className="absolute left-1/2 top-1/2 h-[5px] w-[5px] rounded-full bg-white/45"
          style={{
            transform: `translate(-50%,-50%) rotate(${deg}deg) translateY(-${R - 4}px)`,
          }}
        />
      ))}
      {/* 摇杆头（中心浅刻环，无图标） */}
      <motion.div
        className="absolute left-1/2 top-1/2 rounded-full"
        animate={{ x: knob.x - 30, y: knob.y - 30 }}
        transition={active ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 26 }}
        style={{
          width: 60,
          height: 60,
          background:
            'radial-gradient(circle at 42% 36%, #ffffff, #f3f0ea 55%, #d9d4c8 100%)',
          border: '1px solid rgba(255,255,255,0.9)',
          boxShadow: '0 5px 14px rgba(0,0,0,0.28), inset 0 -3px 6px rgba(0,0,0,0.08)',
        }}
      >
        <div className="absolute inset-0 m-auto h-7 w-7 rounded-full border border-[#c9c3b5]/60" />
      </motion.div>
    </div>
  );
}

export default memo(JoystickInner);
