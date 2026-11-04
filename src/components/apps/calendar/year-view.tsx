'use client';

/**
 * 主页：年历（Task 16-d 小米化）。
 * 公共头部（标题「2026」）+ 胶囊（选中「年」）；胶囊下方居中红色干支行「－ 丙午马年 － 农历九月初二」；
 * 12 个月 3 列网格：每月大数字「01」（22px 粗体近黑）+ 微型星期行（日一二三四五六）+
 * 9px 日期（今天红圆底白字、周末列浅红）；点月份进月视图；横滑切年、
 * **下滑进下一年 / 上滑进上一年**（Task 18-c：内容可滚时不抢手势，滚到顶/底才接管）。
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  ACCENT,
  TEXT,
  TEXT_2,
  WEEKDAY_HEADER,
  daysInMonth,
  lunarBadge,
  todayKey,
  yearGanZhi,
  yearZodiac,
} from './shared';
import { CalChrome, type MainView } from './chrome';

export function YearView({
  y,
  onShiftYear,
  onGotoMonth,
  onSwitchView,
  onOpenSearch,
  onToday,
  onNew,
}: {
  y: number;
  onShiftYear: (delta: number) => void;
  onGotoMonth: (y: number, m: number) => void;
  onSwitchView: (v: MainView) => void;
  onOpenSearch: () => void;
  onToday: () => void;
  onNew: () => void;
}) {
  const today = todayKey();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 换年时回到顶部，避免残留在上一年网格的滚动位置
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [y]);

  // 顶部红色一行右侧：今天的农历日（从 lunarBadge().full 拆出「农历九月十四」）
  const lunarToday = useMemo(() => {
    const full = lunarBadge(new Date()).full;
    const m = /^农历.+?年(.+)$/.exec(full);
    const body = m?.[1]?.split(' ')[0] ?? '';
    return body ? `农历${body}` : full;
  }, []);

  return (
    <div className="flex h-full flex-col pt-[54px]">
      <CalChrome
        view="year"
        y={y}
        onSwitchView={onSwitchView}
        onOpenSearch={onOpenSearch}
        onToday={onToday}
        onNew={onNew}
      />

      {/* 干支行：－ 丙午马年 － 农历九月初二 */}
      <div className="shrink-0 pt-2 text-center text-[12px] font-medium" style={{ color: ACCENT }}>
        － {yearGanZhi(y)}{yearZodiac(y)}年 － {lunarToday}
      </div>

      {/* 12 个月平铺（横滑切年；下滑进下一年 / 上滑进上一年，可滚动时让位原生滚动） */}
      <div
        ref={scrollRef}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          const t = e.changedTouches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          const el = scrollRef.current;
          const canScroll = el ? el.scrollHeight - el.clientHeight > 4 : false;
          const atTop = el ? el.scrollTop <= 2 : true;
          const atBottom = el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : true;
          if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy)) {
            onShiftYear(dx < 0 ? 1 : -1);
          } else if (Math.abs(dy) >= 56 && Math.abs(dy) > Math.abs(dx)) {
            // 下滑 = 下一年：仅在无可滚动余量或已滚到顶时接管（不与原生滚动冲突）
            if (dy > 0) {
              if (!canScroll || atTop) onShiftYear(1);
            } else if (!canScroll || atBottom) {
              onShiftYear(-1);
            }
          }
        }}
      >
        <div className="grid grid-cols-3 gap-x-2 gap-y-4">
          {Array.from({ length: 12 }, (_, m) => (
            <button
              key={m}
              type="button"
              onClick={() => onGotoMonth(y, m)}
              aria-label={`${y}年${m + 1}月`}
              className="rounded-[12px] px-1 pt-1 pb-2 text-left transition-colors active:bg-black/[0.03]"
            >
              <div className="mb-0.5 text-center text-[22px] font-bold leading-7 tabular-nums tracking-tight" style={{ color: TEXT }}>
                {String(m + 1).padStart(2, '0')}
              </div>
              <div className="grid grid-cols-7">
                {WEEKDAY_HEADER.map((w) => (
                  <div key={w} className="text-center text-[8px] leading-[13px]" style={{ color: TEXT_2 }}>
                    {w}
                  </div>
                ))}
              </div>
              <MiniMonth y={y} m={m} today={today} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 单月迷你网格（无农历；今天红圆底白字；周末列浅红） */
function MiniMonth({ y, m, today }: { y: number; m: number; today: string }) {
  const lead = new Date(y, m, 1).getDay(); // 周日开头
  const total = daysInMonth(y, m);
  return (
    <div className="grid grid-cols-7">
      {Array.from({ length: lead }, (_, i) => (
        <div key={`b${i}`} className="h-[15px]" />
      ))}
      {Array.from({ length: total }, (_, i) => {
        const d = i + 1;
        const dow = new Date(y, m, d).getDay();
        const weekend = dow === 0 || dow === 6;
        const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = key === today;
        return (
          <div key={key} className="flex h-[15px] items-center justify-center">
            <span
              className="flex items-center justify-center rounded-full text-[9px] leading-none tabular-nums"
              style={{
                width: isToday ? 13 : 'auto',
                height: isToday ? 13 : 'auto',
                backgroundColor: isToday ? ACCENT : 'transparent',
                color: isToday ? '#FFFFFF' : weekend ? 'rgba(229,73,60,0.55)' : TEXT,
                fontWeight: isToday ? 600 : 400,
              }}
            >
              {d}
            </span>
          </div>
        );
      })}
    </div>
  );
}
