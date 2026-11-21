'use client';

/**
 * 主页：周视图 / 日视图（Task 16-d 小米化，一个组件两种模式）。
 * 公共头部 + 胶囊（选中「周」/「日」）；周条 7 格（周日起，点选切日，‹ › 箭头/横滑切周）；
 * 0-23 时时间网格（行高 52px 可滚，进入自动滚到当前时间上方 1 小时；左 44px 刻度 + 淡灰横线 +
 * 列间竖线）；红色当前时间线；日程块按起止时间绝对定位（全天 = 列顶通栏细条，重叠左右均分）；
 * 点空白格按落点小时新建日程；右下角红色 FAB 新建。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ACCENT,
  ACCENT_SOFT,
  DIVIDER,
  TEXT,
  TEXT_2,
  TEXT_3,
  colorHex,
  dateToKey,
  holidayOf,
  keyToDate,
  lunarBadge,
  pad2,
  sortEvents,
  todayKey,
  type NormalizedEvent,
} from './shared';
import { CalChrome, CalFab, type MainView } from './chrome';

const HOUR_H = 52;
const BLOCK_H = 18; // 全天通栏细条高

function minutesOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function currentMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

/** 重叠日程左右均分：同一时间簇内按序均分宽度 */
interface TmpBlock {
  ev: NormalizedEvent;
  top: number;
  height: number;
}
interface LaidBlock extends TmpBlock {
  leftPct: number;
  widthPct: number;
}

function layoutBlocks(blocks: TmpBlock[]): LaidBlock[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || a.height - b.height);
  const out: LaidBlock[] = [];
  let cluster: TmpBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = cluster.length;
    cluster.forEach((b, i) => out.push({ ...b, leftPct: (i / n) * 100, widthPct: 100 / n }));
    cluster = [];
    clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length > 0 && b.top >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.top + b.height);
  }
  if (cluster.length > 0) flush();
  return out;
}

/** 周条一格：数字 16px + 农历 9px（今天红方块、休日红字+角标、选中浅红方块、节日红字） */
function WeekNum({
  date,
  selected,
  onSelect,
}: {
  date: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const key = dateToKey(date);
  const isToday = key === todayKey();
  const hol = holidayOf(date);
  const badge = lunarBadge(date);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={key}
      aria-pressed={selected}
      className="relative flex min-w-0 flex-1 flex-col items-center gap-[2px] py-1 transition-opacity active:opacity-60"
    >
      <span className="relative">
        <span
          className="flex items-center justify-center text-[16px] tabular-nums leading-none"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            backgroundColor: isToday ? ACCENT : selected ? ACCENT_SOFT : 'transparent',
            color: isToday ? '#FFFFFF' : hol === '休' ? ACCENT : TEXT,
            fontWeight: isToday || selected ? 600 : 400,
          }}
        >
          {date.getDate()}
        </span>
        {hol && (
          <span
            aria-hidden="true"
            className="absolute -right-[7px] top-[-1px] text-[8px] leading-none"
            style={{ color: hol === '休' ? ACCENT : TEXT_2 }}
          >
            {hol}
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[9px] leading-[11px]" style={{ color: badge.festival ? ACCENT : TEXT_2 }}>
        {badge.text}
      </span>
    </button>
  );
}

/** 单日时间列：全天通栏条 + 定时日程块 + 空白点击新建 */
function DayColumn({
  date,
  events,
  showDivider,
  onOpenEvent,
  onNew,
}: {
  date: Date;
  events: NormalizedEvent[];
  showDivider: boolean;
  onOpenEvent: (ev: NormalizedEvent) => void;
  onNew: (dateKey: string, startHour?: number) => void;
}) {
  const key = dateToKey(date);
  const allDay = useMemo(
    () => sortEvents(events.filter((ev) => occursOnOf(ev, key) && ev.startTime === '')),
    [events, key]
  );
  const timed = useMemo(
    () => sortEvents(events.filter((ev) => occursOnOf(ev, key) && ev.startTime !== '')),
    [events, key]
  );

  const blocks = useMemo<TmpBlock[]>(
    () =>
      timed.map((ev) => {
        const startMin = Math.min(Math.max(minutesOf(ev.startTime), 0), 1440);
        let endMin = minutesOf(ev.endTime);
        if (endMin <= startMin) endMin = startMin + 60;
        endMin = Math.min(Math.max(endMin, 0), 1440);
        return {
          ev,
          top: (startMin / 60) * HOUR_H,
          height: Math.max(18, ((endMin - startMin) / 60) * HOUR_H),
        };
      }),
    [timed]
  );
  const laid = useMemo(() => layoutBlocks(blocks), [blocks]);

  return (
    <div
      className="relative h-full"
      style={showDivider ? { borderLeft: `1px solid ${DIVIDER}` } : undefined}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const hour = Math.max(0, Math.min(23, Math.floor(y / HOUR_H)));
        onNew(key, hour);
      }}
    >
      {/* 全天日程：列顶通栏细条 */}
      {allDay.map((ev, i) => (
        <button
          key={ev.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenEvent(ev);
          }}
          className="absolute left-[2px] right-[2px] z-10 flex items-center overflow-hidden rounded-[4px] px-1 text-left"
          style={{ top: i * (BLOCK_H + 2) + 1, height: BLOCK_H, backgroundColor: colorHex(ev.nColor) }}
        >
          <span className="truncate text-[10px] leading-[12px] text-white">{ev.title}</span>
        </button>
      ))}
      {/* 定时日程块（重叠左右均分） */}
      {laid.map(({ ev, top, height, leftPct, widthPct }) => (
        <button
          key={ev.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenEvent(ev);
          }}
          className="absolute z-10 flex items-start overflow-hidden rounded-[4px] px-1 py-[2px] text-left"
          style={{
            top,
            height,
            left: `calc(${leftPct}% + 2px)`,
            width: `calc(${widthPct}% - 4px)`,
            backgroundColor: colorHex(ev.nColor),
          }}
        >
          <span className="w-full truncate text-[10px] leading-[14px] text-white">{ev.title}</span>
        </button>
      ))}
    </div>
  );
}

/** occursOn 本文件轻量版（与 shared.occursOn 同口径，避免逐格函数 prop 传递） */
function occursOnOf(ev: NormalizedEvent, key: string): boolean {
  if (key >= ev.date && key <= ev.nEndDate) return true;
  if (key < ev.date) return false;
  const d = keyToDate(key);
  const s = keyToDate(ev.date);
  if (ev.repeatRule === 'daily') return true;
  if (ev.repeatRule === 'weekly') return d.getDay() === s.getDay();
  if (ev.repeatRule === 'monthly') return d.getDate() === s.getDate();
  if (ev.repeatRule === 'yearly') return d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
  if (!ev.repeatRule && (ev.repeat?.length ?? 0) > 0) return (ev.repeat ?? []).includes(d.getDay());
  return false;
}

export function WeekDayView({
  mode,
  events,
  viewYM,
  selectedKey,
  onSelectKey,
  onShiftDays,
  onSwitchView,
  onOpenSearch,
  onToday,
  onNew,
  onOpenEvent,
}: {
  mode: 'week' | 'day';
  events: NormalizedEvent[];
  viewYM: { y: number; m: number };
  selectedKey: string;
  onSelectKey: (key: string) => void;
  /** 平移 N 天（周视图 ±7 / 日视图 ±1 由组件内部决定） */
  onShiftDays: (delta: number) => void;
  onSwitchView: (v: MainView) => void;
  onOpenSearch: () => void;
  onToday: () => void;
  onNew: (dateKey?: string, startHour?: number) => void;
  onOpenEvent: (ev: NormalizedEvent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [nowMin, setNowMin] = useState(() => currentMinutes());

  const sel = keyToDate(selectedKey);
  const step = mode === 'week' ? 7 : 1;
  const shift = useCallback((delta: number) => onShiftDays(delta * step), [onShiftDays, step]);

  // 当前显示的日期列：周视图 = 所选日所在周（周日起）；日视图 = 单列
  const days = useMemo<Date[]>(() => {
    if (mode === 'day') return [keyToDate(selectedKey)];
    const start = new Date(sel);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [mode, selectedKey, sel]);

  const today = todayKey();
  const showNow = days.some((d) => dateToKey(d) === today);
  const nowTop = (nowMin / 60) * HOUR_H;

  // 每分钟刷新当前时间线
  useEffect(() => {
    const t = window.setInterval(() => setNowMin(currentMinutes()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // 进入时自动滚到当前时间上方 1 小时
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (currentMinutes() / 60) * HOUR_H - HOUR_H);
  }, []);

  const swipeProps = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      touch.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = touch.current;
      touch.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
    },
  };

  const nowLabel = (() => {
    const n = new Date();
    return `${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
  })();

  return (
    <div className="relative flex h-full flex-col pt-[54px]">
      <CalChrome
        view={mode}
        y={viewYM.y}
        m={viewYM.m}
        onSwitchView={onSwitchView}
        onOpenSearch={onOpenSearch}
        onToday={onToday}
        onNew={() => onNew()}
      />

      {/* 周条：‹ 7 格 ›（横滑/箭头切周或切日） */}
      <div className="flex shrink-0 items-center px-1 pt-1.5" {...swipeProps}>
        <button
          type="button"
          aria-label={mode === 'week' ? '上一周' : '上一天'}
          onClick={() => shift(-1)}
          className="flex h-7 w-6 shrink-0 items-center justify-center transition-opacity active:opacity-50"
          style={{ color: TEXT_2 }}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
        </button>
        <div className="flex flex-1 items-stretch px-0.5">
          {days.map((d) => (
            <WeekNum key={dateToKey(d)} date={d} selected={dateToKey(d) === selectedKey} onSelect={() => onSelectKey(dateToKey(d))} />
          ))}
        </div>
        <button
          type="button"
          aria-label={mode === 'week' ? '下一周' : '下一天'}
          onClick={() => shift(1)}
          className="flex h-7 w-6 shrink-0 items-center justify-center transition-opacity active:opacity-50"
          style={{ color: TEXT_2 }}
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      {/* 时间网格 */}
      <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" {...swipeProps}>
        <div className="relative" style={{ height: 24 * HOUR_H }}>
          {/* 每小时：左刻度 + 淡灰横线 */}
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} aria-hidden="true" className="absolute left-0 right-0 flex items-center" style={{ top: h * HOUR_H }}>
              <div
                className="w-11 shrink-0 pr-1.5 text-right text-[9px] tabular-nums"
                style={{ color: TEXT_3, transform: 'translateY(-50%)' }}
              >
                {pad2(h)}:00
              </div>
              <div className="h-px flex-1" style={{ backgroundColor: DIVIDER }} />
            </div>
          ))}
          {/* 日程列 */}
          <div
            className="absolute bottom-0 left-11 right-0 top-0 grid"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((d, i) => (
              <DayColumn
                key={dateToKey(d)}
                date={d}
                events={events}
                showDivider={i > 0}
                onOpenEvent={onOpenEvent}
                onNew={(k, h) => onNew(k, h)}
              />
            ))}
          </div>
          {/* 当前时间红线 */}
          {showNow && (
            <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0 z-20 flex items-center" style={{ top: nowTop }}>
              <div className="w-11 shrink-0 pr-1.5 text-right text-[9px] font-medium tabular-nums" style={{ color: ACCENT }}>
                {nowLabel}
              </div>
              <div className="h-[1.5px] flex-1" style={{ backgroundColor: ACCENT }} />
            </div>
          )}
        </div>
      </div>

      <CalFab onClick={() => onNew()} />
    </div>
  );
}
