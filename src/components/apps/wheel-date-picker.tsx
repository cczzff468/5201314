'use client';

/**
 * iOS 风格「上下滑滚轮」日期选择弹窗（第二十轮需求：所有选择日期的弹窗变成上下滑式）。
 *
 * - 年 / 月 / 日 三列滚轮（withTime 时追加 时 / 分 两列），触摸上下滑动 + scroll-snap 吸附；
 * - 中间选中行高亮框，选项随距离淡化（接近 iOS 原生 picker 视觉）；
 * - 天数随年月自动修正（1月31 → 改2月自动跳 28）；
 * - 底部弹出 / 点遮罩取消 / 确定回调输出 'YYYY-MM-DD'（withTime 时 'YYYY-MM-DDTHH:mm'）。
 */

import { useEffect, useRef, useState } from 'react';

const ITEM_H = 40; // 每个选项行高
const COL_H = 200; // 列可视高度
const PAD = (COL_H - ITEM_H) / 2; // 上下留白（保证首尾选项能滚到正中）

/** 单列滚轮 */
function WheelCol({ items, idx, onChange, label }: { items: string[]; idx: number; onChange: (i: number) => void; label?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);

  // 外部 idx 变化（初始化/联动修正）→ 程序滚动；滚动自身触发的 onChange 与当前位置差 <1px，不会打断惯性
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [idx]);

  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
      if (i !== idx) onChange(i);
    });
  };

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  return (
    <div className="relative w-[72px] shrink-0">
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        onScroll={onScroll}
        className="wheel-col no-scrollbar overscroll-contain"
        style={{
          height: COL_H,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          paddingTop: PAD,
          paddingBottom: PAD,
        }}
      >
        {items.map((it, i) => {
          const dist = Math.abs(i - idx);
          const active = dist === 0;
          return (
            <div
              key={`${it}-${i}`}
              role="option"
              aria-selected={active}
              onClick={() => onChange(i)}
              className="flex select-none items-center justify-center"
              style={{
                height: ITEM_H,
                scrollSnapAlign: 'center',
                fontSize: active ? 19 : 16,
                fontWeight: active ? 700 : 400,
                color: active ? '#2c2c30' : dist === 1 ? 'rgba(60,60,68,0.42)' : 'rgba(60,60,68,0.22)',
                transform: `scale(${active ? 1 : Math.max(0.82, 1 - dist * 0.06)})`,
                transition: 'color .12s, transform .12s, font-size .12s',
                cursor: 'pointer',
              }}
            >
              {it}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 通用滚轮日期（可选时间）选择弹窗 */
export default function WheelDatePicker({
  open,
  value,
  onConfirm,
  onCancel,
  title = '选择日期',
  minYear,
  maxYear,
  withTime = false,
}: {
  open: boolean;
  /** 'YYYY-MM-DD' 或 withTime 时 'YYYY-MM-DDTHH:mm'；空串=今天 */
  value: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
  title?: string;
  minYear?: number;
  maxYear?: number;
  withTime?: boolean;
}) {
  const now0 = new Date();
  const yMin = minYear ?? now0.getFullYear() - 60;
  const yMax = maxYear ?? now0.getFullYear() + 5;

  const parse = (v: string) => {
    const t = (v || '').trim();
    const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{1,2}))?/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: Number(m[4] ?? 12), mm: Number(m[5] ?? 0) };
    return { y: now0.getFullYear(), m: now0.getMonth() + 1, d: now0.getDate(), hh: 12, mm: 0 };
  };

  const init = parse(value);
  const [y, setY] = useState(init.y);
  const [m, setM] = useState(init.m);
  const [d, setD] = useState(init.d);
  const [hh, setHh] = useState(init.hh);
  const [mm, setMm] = useState(init.mm);

  // 每次打开重置为 value（React「渲染期调整 state」模式：仅在上一次 open=false→true 的瞬间同步一次）
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const p = parse(value);
      setY(Math.max(yMin, Math.min(yMax, p.y)));
      setM(p.m);
      setD(p.d);
      setHh(p.hh);
      setMm(p.mm);
    }
  }

  // 日溢出无需 effect：显示与输出都用 clamp（1月31 → 切到2月自动按 28 处理，切回1月仍是31）
  const daysIn = new Date(y, m, 0).getDate();
  const dSafe = Math.min(d, daysIn);

  const years = Array.from({ length: yMax - yMin + 1 }, (_, i) => `${yMin + i}年`);
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
  const days = Array.from({ length: daysIn }, (_, i) => `${i + 1}日`);
  const hours = Array.from({ length: 24 }, (_, i) => `${pad2(i)}时`);
  const mins = Array.from({ length: 60 }, (_, i) => `${pad2(i)}分`);

  const confirm = () => {
    const ds = `${y}-${pad2(m)}-${pad2(dSafe)}`;
    onConfirm(withTime ? `${ds}T${pad2(hh)}:${pad2(mm)}` : ds);
  };

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/45" onClick={onCancel} data-testid="wheel-date-picker">
      <div className="rounded-t-2xl bg-white px-5 pb-9 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
        {/* 标题行：取消 / 标题 / 确定 */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={onCancel} className="text-[15px] text-[#8e8e96]">
            取消
          </button>
          <span className="text-[15.5px] font-semibold text-[#2c2c30]">{title}</span>
          <button type="button" onClick={confirm} className="text-[15.5px] font-bold text-[#21b357]">
            确定
          </button>
        </div>
        {/* 滚轮区 */}
        <div className="relative mt-3 flex justify-center gap-1">
          {/* 中间选中高亮框 */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 top-[80px] z-10 h-10 rounded-lg border-y border-black/[0.07] bg-black/[0.045]" />
          <WheelCol label="年" items={years} idx={Math.max(0, Math.min(years.length - 1, y - yMin))} onChange={(i) => setY(yMin + i)} />
          <WheelCol label="月" items={months} idx={m - 1} onChange={(i) => setM(i + 1)} />
          <WheelCol label="日" items={days} idx={Math.max(0, Math.min(days.length - 1, dSafe - 1))} onChange={(i) => setD(i + 1)} />
          {withTime && (
            <>
              <WheelCol label="时" items={hours} idx={hh} onChange={setHh} />
              <WheelCol label="分" items={mins} idx={mm} onChange={setMm} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
