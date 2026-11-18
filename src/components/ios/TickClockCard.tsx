'use client';

/**
 * 表盘时钟小组件（col-span-2 方格 ≈159×168）：半透明深灰圆角卡片，四周一圈
 * 60 格刻度（每 5 格加长加粗，表圈质感——用户参考图），中央大号数字时间。
 * 纯展示（主屏点击打开时钟 App）；SSR/首帧不渲染时间避免水合不一致，挂载后
 * 立即填充、每 10s 对齐刷新。深色半透明实体底不随主题/壁纸翻转。
 */
import { useEffect, useState } from 'react';

/** 表盘几何（viewBox 159×168 与卡片同比例；刻度圈留出圆角边距） */
const CX = 79.5;
const CY = 84;
const R_OUT = 66;
const MINOR_LEN = 5;
const MAJOR_LEN = 9.5;

interface Tick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
}

const TICKS: Tick[] = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const a = (i * 6 * Math.PI) / 180;
  const len = major ? MAJOR_LEN : MINOR_LEN;
  return {
    x1: CX + R_OUT * Math.sin(a),
    y1: CY - R_OUT * Math.cos(a),
    x2: CX + (R_OUT - len) * Math.sin(a),
    y2: CY - (R_OUT - len) * Math.cos(a),
    major,
  };
});

export function TickClockCardWidget({ testId }: { testId?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const iv = window.setInterval(tick, 10_000);
    return () => window.clearInterval(iv);
  }, []);
  const hh = now ? String(now.getHours()).padStart(2, '0') : '';
  const mm = now ? String(now.getMinutes()).padStart(2, '0') : '';
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="relative h-[168px] w-full select-none overflow-hidden rounded-[22px] bg-[#58585c]/70 ring-1 ring-white/15 backdrop-blur-xl"
    >
      {/* 表圈刻度：60 根径向短线，12 个整点刻度加长加粗 */}
      <svg viewBox="0 0 159 168" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="white"
            strokeWidth={t.major ? 2.4 : 1.4}
            strokeLinecap="round"
            opacity={t.major ? 0.85 : 0.45}
          />
        ))}
      </svg>
      {/* 中央大号数字时间 */}
      <div className="absolute inset-0 grid place-items-center">
        <time className="text-[42px] font-bold leading-none tracking-tight text-white/85 tabular-nums">
          {now ? `${hh}:${mm}` : ''}
        </time>
      </div>
    </div>
  );
}
