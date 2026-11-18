'use client';

/**
 * 日历 App 公共部件（Task 16-d 小米化）：
 * - IconBtn：顶部圆形图标按钮
 * - DayGrid：月历日期网格（周日开头；今天红圆角方块 + 底部红条、选中浅红方块、
 *   法定休/班角标、节日/节气/初一月名红字、日程色点），月历页/选择日期页共用
 * - Card / CardDivider：白卡片容器与分割线
 * - buildDotMap / gridKeys：月网格日程色点辅助
 */

import { useMemo } from 'react';
import {
  ACCENT,
  ACCENT_SOFT,
  CARD,
  DIVIDER,
  TEXT,
  TEXT_2,
  TEXT_3,
  WEEKDAY_HEADER,
  addMonths,
  colorHex,
  dateKey,
  daysInMonth,
  holidayOf,
  lunarBadge,
  todayKey,
} from './shared';

/** 顶部圆形图标按钮（右上动作图标等） */
export function IconBtn({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity active:opacity-50"
      style={{ color: TEXT }}
    >
      {children}
    </button>
  );
}

interface DayCell {
  key: string;
  day: number;
  inMonth: boolean;
  badge: { text: string; festival: boolean };
  /** 法定假日标记：休 / 班 */
  hol?: '休' | '班';
  /** 该日首个日程的颜色（无日程为空） */
  dot?: string;
}

/**
 * 月历网格（固定 6 周 42 格，周日开始；小米日历样式）。
 * - 今天：红色圆角方块白字 + 农历红字 + 格底红色横条下划线
 * - 选中（非今天）：浅红圆角方块
 * - 法定休日：数字红色 + 右上角「休」小角标；班日：灰「班」角标
 * - 节日/节气/初一月名：农历红字；非本月整格淡化
 * - dotFor：返回某日期的日程点颜色（undefined = 无日程）
 */
export function DayGrid({
  y,
  m,
  selectedKey,
  dotFor,
  onSelect,
  showLunar = true,
  cellH = 52,
}: {
  y: number;
  m: number;
  selectedKey: string;
  /** dateKey → 日程颜色 hex（有日程的日期底部小圆点） */
  dotFor?: (key: string) => string | undefined;
  onSelect: (key: string) => void;
  showLunar?: boolean;
  cellH?: number;
}) {
  const cells = useMemo<DayCell[]>(() => {
    const first = new Date(y, m, 1);
    const lead = first.getDay(); // 周日为一周开始
    const total = daysInMonth(y, m);
    const prev = addMonths(y, m, -1);
    const prevTotal = daysInMonth(prev.y, prev.m);
    const next = addMonths(y, m, 1);
    const out: DayCell[] = [];
    const push = (yy: number, mm: number, dd: number, inMonth: boolean) => {
      const date = new Date(yy, mm, dd);
      const key = dateKey(yy, mm, dd);
      out.push({
        key,
        day: dd,
        inMonth,
        badge: lunarBadge(date),
        hol: holidayOf(date),
        dot: dotFor?.(key),
      });
    };
    for (let i = lead - 1; i >= 0; i--) push(prev.y, prev.m, prevTotal - i, false);
    for (let d = 1; d <= total; d++) push(y, m, d, true);
    let nd = 1;
    while (out.length < 42) push(next.y, next.m, nd++, false);
    return out;
  }, [y, m, dotFor]);

  const today = todayKey();

  return (
    <div>
      {/* 星期行 */}
      <div className="grid grid-cols-7 pb-1">
        {WEEKDAY_HEADER.map((w) => (
          <div key={w} className="text-center text-[11px] font-medium leading-5" style={{ color: TEXT_2 }}>
            {w}
          </div>
        ))}
      </div>
      {/* 日期网格 */}
      <div className="grid grid-cols-7">
        {cells.map((c) => {
          const isToday = c.key === today;
          const isSelected = c.key === selectedKey;
          const dim = !c.inMonth;
          const numColor = isToday
            ? '#FFFFFF'
            : dim
              ? TEXT_3
              : c.hol === '休'
                ? ACCENT
                : isSelected
                  ? TEXT
                  : TEXT;
          const lunarColor = dim
            ? TEXT_3
            : isToday || c.badge.festival
              ? ACCENT
              : TEXT_2;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(c.key)}
              aria-label={c.key}
              aria-pressed={isSelected}
              className="relative flex w-full flex-col items-center justify-center gap-[1px] transition-opacity active:opacity-60"
              style={{ height: cellH }}
            >
              <span className="relative">
                <span
                  className="flex items-center justify-center text-[17px] tabular-nums leading-none"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    backgroundColor: isToday ? ACCENT : isSelected ? ACCENT_SOFT : 'transparent',
                    color: numColor,
                    fontWeight: isToday || isSelected ? 600 : 400,
                  }}
                >
                  {c.day}
                </span>
                {c.hol && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-[7px] top-[-1px] text-[8px] leading-none"
                    style={{ color: c.hol === '休' ? ACCENT : TEXT_2 }}
                  >
                    {c.hol}
                  </span>
                )}
              </span>
              {showLunar && (
                <span className="text-[9px] leading-[11px]" style={{ color: lunarColor }}>
                  {c.badge.text}
                </span>
              )}
              {/* 日程色点（位于农历下方 = 日期格底部） */}
              <span className="flex h-[5px] items-center">
                {c.dot && <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: c.dot }} />}
              </span>
              {/* 今天：底部红色下划线标记 */}
              {isToday && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-[2px] left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full"
                  style={{ backgroundColor: ACCENT }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 由年月生成 42 格 key 列表（事件展开统计用），周日开始 */
export function gridKeys(y: number, m: number): string[] {
  const first = new Date(y, m, 1);
  const lead = first.getDay();
  const total = daysInMonth(y, m);
  const prev = addMonths(y, m, -1);
  const prevTotal = daysInMonth(prev.y, prev.m);
  const next = addMonths(y, m, 1);
  const keys: string[] = [];
  for (let i = lead - 1; i >= 0; i--) keys.push(dateKey(prev.y, prev.m, prevTotal - i));
  for (let d = 1; d <= total; d++) keys.push(dateKey(y, m, d));
  let nd = 1;
  while (keys.length < 42) keys.push(dateKey(next.y, next.m, nd++));
  return keys;
}

/** 预计算月网格每天的日程点颜色（每天取当日首个日程的颜色） */
export function buildDotMap<T extends { nColor: string }>(
  events: T[],
  keys: string[],
  occursOn: (ev: T, key: string) => boolean
): Map<string, string> {
  const map = new Map<string, string>();
  for (const k of keys) {
    for (const ev of events) {
      if (occursOn(ev, k)) {
        map.set(k, colorHex(ev.nColor));
        break;
      }
    }
  }
  return map;
}

/** 白卡片容器（极浅阴影，设计稿卡片风格） */
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] ${className}`}
      style={{ backgroundColor: CARD, boxShadow: '0 1px 4px rgba(41,36,31,0.04)' }}
    >
      {children}
    </div>
  );
}

/** 卡片内分割线 */
export function CardDivider() {
  return <div className="ml-4 h-px" style={{ backgroundColor: DIVIDER }} />;
}
