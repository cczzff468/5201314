'use client';

/**
 * 主页：月历 + 当日安排（Task 16-d 小米化）。
 * 公共头部（返回/图标/标题「2026/10」/默认视图下拉/搜索/更多）+ 五视图切换胶囊（选中「月」）；
 * 星期表头（周日开头）+ 小米风格月格（今天红方块+底红条、休/班角标、节日红字、日程色点）；
 * 网格下方「选中日期 + 农历 + 当日日程列表」；横滑切月、**纵向下滑进下月 / 上滑进上月**
 * （第 20 轮修复：此前只要日程列表可滚动，任意区域的纵向手势都会被误拦——现在只有手势起点
 * 落在日程列表内才让位原生滚动，月格/当日行/空白区上下滑始终直接切月，列表内边界时接管）；
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  ACCENT,
  ACCENT_SOFT,
  EventRow,
  TEXT,
  TEXT_3,
  formatDayShort,
  keyToDate,
  lunarBadge,
  sortEvents,
  todayKey,
  type NormalizedEvent,
} from './shared';
import { Card, DayGrid, buildDotMap, gridKeys } from './widgets';
import { CalChrome, type MainView } from './chrome';

export function MonthView({
  events,
  viewYM,
  selectedKey,
  onSelectKey,
  onShiftMonth,
  onSwitchView,
  onOpenSearch,
  onToday,
  onNew,
  onOpenEvent,
}: {
  events: NormalizedEvent[];
  viewYM: { y: number; m: number };
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onShiftMonth: (delta: number) => void;
  onSwitchView: (v: MainView) => void;
  onOpenSearch: () => void;
  onToday: () => void;
  onNew: () => void;
  onOpenEvent: (ev: NormalizedEvent) => void;
}) {
  const today = todayKey();
  const touchStart = useRef<{ x: number; y: number; inList: boolean } | null>(null);
  /** 日程列表滚动容器（纵向手势让位原生滚动的判定依据） */
  const listRef = useRef<HTMLDivElement | null>(null);
  const listScrollAtStart = useRef(0);
  /** 切月动画方向（axis x = 横滑左右入场；axis y = 纵向上/下入场） */
  const [slide, setSlide] = useState<{ axis: 'x' | 'y'; dir: number }>({ axis: 'x', dir: 1 });

  // 月网格日程色点：仅统计本日开始的事件，避免重复展开开销过大
  const dotFor = useMemo(() => {
    const keys = gridKeys(viewYM.y, viewYM.m);
    const map = buildDotMap(events, keys, (ev, key) => {
      if (key < ev.date) return false;
      if (ev.repeatRule === 'daily') return true;
      if (ev.nEndDate >= key && key >= ev.date) return true;
      const d = keyToDate(key);
      const s = keyToDate(ev.date);
      if (ev.repeatRule === 'weekly') return d.getDay() === s.getDay();
      if (ev.repeatRule === 'monthly') return d.getDate() === s.getDate();
      if (ev.repeatRule === 'yearly') return d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
      // 旧数据 repeat 数组兼容（工作日/自定义 weekday）
      if (!ev.repeatRule && (ev.repeat?.length ?? 0) > 0) return (ev.repeat ?? []).includes(d.getDay());
      return false;
    });
    return (key: string) => map.get(key);
  }, [events, viewYM]);

  const selectedEvents = useMemo(
    () => sortEvents(events.filter((ev) => occursSimple(ev, selectedKey))),
    [events, selectedKey]
  );

  const shift = useCallback(
    (delta: number, axis: 'x' | 'y' = 'x') => {
      setSlide({ axis, dir: delta });
      onShiftMonth(delta);
    },
    [onShiftMonth]
  );

  return (
    <div className="flex h-full flex-col pt-[54px]">
      <CalChrome
        view="month"
        y={viewYM.y}
        m={viewYM.m}
        onSwitchView={onSwitchView}
        onOpenSearch={onOpenSearch}
        onToday={onToday}
        onNew={onNew}
      />

      {/* 月格 + 当日行 + 日程列表整片为滑动区：横滑切月；下滑进下月（如 10 月→11 月）/
          上滑进上月；只有手势起点落在日程列表内才让位原生滚动（列表可滚动且发生滚动/未到边界时），
          月格与当日行区域的纵向手势始终直接切月（用户反馈：有日程时月格滑动被误拦） */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onTouchStart={(e) => {
          const t = e.touches[0];
          const el = listRef.current;
          touchStart.current = t
            ? { x: t.clientX, y: t.clientY, inList: !!(el && t.target instanceof Node && el.contains(t.target)) }
            : null;
          listScrollAtStart.current = el?.scrollTop ?? 0;
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          const t = e.changedTouches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          const el = listRef.current;
          // 仅「起点在日程列表内」的手势才参与原生滚动让位判定；月格/当日行始终直接切月
          const scrolled = start.inList && el ? Math.abs(el.scrollTop - listScrollAtStart.current) > 4 : false;
          const canScroll = start.inList && el ? el.scrollHeight - el.clientHeight > 4 : false;
          const atTop = el ? el.scrollTop <= 2 : true;
          const atBottom = el ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2 : true;
          // 主轴判定：横向位移占优 → 切月（左=下月）；纵向占优 → 下滑=下月、上滑=上月
          if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) shift(dx < 0 ? 1 : -1, 'x');
          else if (Math.abs(dy) >= 48 && Math.abs(dy) > Math.abs(dx) && !scrolled) {
            if (dy > 0) {
              // 下滑 = 下月：列表内手势仅在无可滚动余量或已滚到顶时接管（不与原生滚动冲突）
              if (!canScroll || atTop) shift(1, 'y');
            } else if (!canScroll || atBottom) {
              shift(-1, 'y');
            }
          }
        }}
      >
      {/* 月网格（动画容器保留在滑动区内） */}
      <div
        key={`${viewYM.y}-${viewYM.m}`}
        className={`shrink-0 px-2 pt-1.5 animate-in fade-in duration-200 ${
          slide.axis === 'x'
            ? slide.dir >= 0
              ? 'slide-in-from-right-3'
              : 'slide-in-from-left-3'
            : slide.dir >= 0
              ? 'slide-in-from-top-3'
              : 'slide-in-from-bottom-3'
        }`}
      >
        <DayGrid
          y={viewYM.y}
          m={viewYM.m}
          selectedKey={selectedKey}
          dotFor={dotFor}
          onSelect={onSelectKey}
          cellH={48}
        />
      </div>

      {/* 当日行：日期 + 今天徽章 + 农历 + 快捷新建 */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold leading-tight" style={{ color: TEXT }}>
              {formatDayShort(selectedKey)}
            </span>
            {selectedKey === today && (
              <span
                className="rounded-full px-2 py-[1px] text-[11px] font-medium leading-[16px]"
                style={{ backgroundColor: ACCENT, color: '#FFFFFF' }}
              >
                今天
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-tight" style={{ color: TEXT_3 }}>
            {lunarBadge(keyToDate(selectedKey)).full}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label={`在${formatDayShort(selectedKey)}新建日程`}
            onClick={onNew}
            data-testid="cal-day-new"
            className="flex h-7 w-7 items-center justify-center rounded-full transition active:scale-95"
            style={{ backgroundColor: ACCENT_SOFT, color: ACCENT }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {/* 当日日程列表（在滑动区内；可滚动时纵向手势让位原生滚动） */}
      <div ref={listRef} className="thin-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
        {selectedEvents.length === 0 ? (
          <div className="flex h-20 flex-col items-center justify-center gap-1" style={{ color: TEXT_3 }}>
            <span className="text-[13px]">这一天还没有日程</span>
            <span className="text-[11px]">点右上 ⋮ 或下面的 ＋ 添加</span>
          </div>
        ) : (
          <Card>
            <div className="divide-y" style={{ borderColor: 'rgba(41,36,31,0.05)' }}>
              {selectedEvents.map((ev) => (
                <EventRow key={ev.id} ev={ev} onClick={() => onOpenEvent(ev)} />
              ))}
            </div>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}

/** 与 shared.occursOn 相同口径的轻量展开判断（避免本文件再引一层循环依赖） */
function occursSimple(ev: NormalizedEvent, key: string): boolean {
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
