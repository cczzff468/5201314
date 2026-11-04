'use client';

/**
 * 页面 10/11：选择日期 / 选择时间（表单胶囊二级页）。
 * - 选择日期：返回/开始日期|结束日期/完成；年月大标题 + 月历网格（同主页风格，选中红圆）+ 完成确认
 * - 选择时间：返回/开始时间|结束时间/完成；顶部大号「09 : 30」实时预览 + 小时/分钟两列滚轮
 *   （iOS 风格 scroll-snap，中间选中行浅红底圆角）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ACCENT,
  ACCENT_SOFT,
  NavBar,
  NavTextButton,
  TEXT,
  TEXT_2,
  TEXT_3,
  addMonths,
  formatDayLong,
  keyToParts,
  lunarBadge,
  pad2,
} from './shared';
import { DayGrid } from './widgets';

/** 页面 10：选择日期 */
export function DatePickerPage({
  value,
  title,
  onDone,
  onBack,
}: {
  /** 'YYYY-MM-DD' 初始值 */
  value: string;
  title: string;
  onDone: (key: string) => void;
  onBack: () => void;
}) {
  const init = keyToParts(value);
  const [sel, setSel] = useState(value);
  const [view, setView] = useState({ y: init.y, m: init.m });

  const selDate = keyToParts(sel);
  return (
    <div className="flex h-full flex-col pt-[54px]">
      <NavBar
        left={<NavTextButton label="返回" onClick={onBack} />}
        title={title}
        right={<NavTextButton label="完成" bold onClick={() => onDone(sel)} testId="cal-date-done" />}
      />

      {/* 当前选择预览 */}
      <div className="px-5 pb-1 pt-2">
        <div className="text-[20px] font-bold leading-tight" style={{ color: TEXT }}>
          {formatDayLong(sel)}
        </div>
        <div className="mt-0.5 text-[13px]" style={{ color: TEXT_3 }}>
          {lunarBadge(new Date(selDate.y, selDate.m, selDate.d)).full}
        </div>
      </div>

      {/* 年月导航 */}
      <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-2">
        <span className="text-[16px] font-semibold" style={{ color: TEXT }}>
          {view.y}年{view.m + 1}月
        </span>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setView((v) => addMonths(v.y, v.m, -1))}
            className="flex h-8 w-8 items-center justify-center transition-opacity active:opacity-50"
            style={{ color: ACCENT }}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.1} />
          </button>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setView((v) => addMonths(v.y, v.m, 1))}
            className="flex h-8 w-8 items-center justify-center transition-opacity active:opacity-50"
            style={{ color: ACCENT }}
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <div className="px-2">
        <DayGrid y={view.y} m={view.m} selectedKey={sel} onSelect={setSel} cellH={50} />
      </div>

      <div className="mt-auto px-8 pb-8 text-center text-[12px]" style={{ color: TEXT_3 }}>
        只修改当前日期，确认后返回日程表单。
      </div>
    </div>
  );
}

// ---------------- 时间滚轮 ----------------

const ITEM_H = 42;
const VISIBLE = 5;
const COL_H = ITEM_H * VISIBLE;
const PAD = (COL_H - ITEM_H) / 2;

/** 单列滚轮（小时/分钟共用） */
function WheelCol({
  count,
  value,
  onChange,
}: {
  count: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const raf = useRef(0);
  const refCb = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef(value);

  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = refCb.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / ITEM_H)));
      if (idx !== lastRef.current) {
        lastRef.current = idx;
        onChange(idx);
      }
    });
  };
  useEffect(() => {
    const el = refCb.current;
    if (el && Math.abs(el.scrollTop - value * ITEM_H) > 1) el.scrollTop = value * ITEM_H;
    // 仅挂载时定位（此后滚动即自身位置，无需回写）
  }, []);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  return (
    <div
      ref={refCb}
      role="listbox"
      aria-label="滚轮"
      onScroll={onScroll}
      className="no-scrollbar overscroll-contain"
      style={{
        width: 86,
        height: COL_H,
        overflowY: 'auto',
        scrollSnapType: 'y mandatory',
        paddingTop: PAD,
        paddingBottom: PAD,
      }}
    >
      {Array.from({ length: count }, (_, i) => {
        const dist = Math.abs(i - value);
        const active = dist === 0;
        return (
          <div
            key={i}
            role="option"
            aria-selected={active}
            onClick={() => onChange(i)}
            className="flex select-none items-center justify-center tabular-nums"
            style={{
              height: ITEM_H,
              scrollSnapAlign: 'center',
              fontSize: active ? 20 : 17,
              fontWeight: active ? 600 : 400,
              color: active ? ACCENT : dist === 1 ? 'var(--cal-wheel-near, rgba(41,36,31,0.4))' : 'var(--cal-wheel-far, rgba(41,36,31,0.18))',
              cursor: 'pointer',
              transition: 'color .12s, font-size .12s',
            }}
          >
            {pad2(i)}
          </div>
        );
      })}
    </div>
  );
}

/** 页面 11：选择时间 */
export function TimePickerPage({
  value,
  title,
  dateLabel,
  onDone,
  onBack,
}: {
  /** 'HH:mm' 初始值 */
  value: string;
  title: string;
  /** 预览上方的小字（日程日期） */
  dateLabel: string;
  onDone: (v: string) => void;
  onBack: () => void;
}) {
  const init = useMemo(() => {
    const m = value.match(/^(\d{1,2}):(\d{1,2})$/);
    return m ? { h: Number(m[1]), mm: Number(m[2]) } : { h: 9, mm: 30 };
  }, [value]);
  const [h, setH] = useState(init.h);
  const [mm, setMm] = useState(init.mm);

  return (
    <div className="flex h-full flex-col pt-[54px]">
      <NavBar
        left={<NavTextButton label="返回" onClick={onBack} />}
        title={title}
        right={
          <NavTextButton
            label="完成"
            bold
            onClick={() => onDone(`${pad2(h)}:${pad2(mm)}`)}
            testId="cal-time-done"
          />
        }
      />

      {/* 大号实时预览 */}
      <div className="flex shrink-0 flex-col items-center pt-4">
        <div className="text-[12px]" style={{ color: TEXT_2 }}>
          {dateLabel} · 24 小时制
        </div>
        <div className="mt-1 text-[52px] font-light leading-none tabular-nums tracking-wide" style={{ color: TEXT }}>
          {pad2(h)} : {pad2(mm)}
        </div>
      </div>

      {/* 两列滚轮（中间选中行浅红底圆角） */}
      <div className="mt-3 flex flex-col items-center">
        {/* 列标签 */}
        <div className="flex">
          <div className="w-[86px] pb-1 text-center text-[12px]" style={{ color: TEXT_2 }}>
            小时
          </div>
          <div className="w-[86px] pb-1 text-center text-[12px]" style={{ color: TEXT_2 }}>
            分钟
          </div>
        </div>
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute left-2 right-2 rounded-[12px]"
            style={{ top: PAD + ITEM_H * 2, height: ITEM_H, backgroundColor: ACCENT_SOFT }}
          />
          <div className="relative flex">
            <WheelCol count={24} value={h} onChange={setH} />
            <WheelCol count={60} value={mm} onChange={setMm} />
          </div>
        </div>
      </div>

      <div className="mt-auto px-8 pb-8 text-center text-[12px]" style={{ color: TEXT_3 }}>
        上下滚动选择小时和分钟，点击完成确认。
      </div>
    </div>
  );
}
