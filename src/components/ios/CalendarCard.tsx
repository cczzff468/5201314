'use client';

/**
 * 日历小组件（主屏 2×2 方格 ≈159×168，iOS 原生日历小组件样式）：
 * - 上半：周几（珊瑚红，与日历 App 主色同源）+ 「X月X日」大字（数字大、月/日小）；
 * - 下半：最近的下一条日程——彩色竖条（日程颜色，colorHex 口径）+ 标题 + 相对时间
 *   （今天/明天/周X + HH:mm 或「全天」）；无日程时优雅空态「近期没有安排」；
 * - 数据源：localDB 'events'（日历 App 同一份本地 IndexedDB），读取后经日历 App 的
 *   normalizeEvent/occursOn/sortEvents 归一化与重复展开（与 App 内完全同一套口径）；
 *   挂载读一次 + 每 30s 与时钟同频对账（App 里改完日程回到主屏自动跟上）；
 * - 纯展示（主屏点击打开日历 App，WIDGET_META 通道）；SSR/首帧不渲染日期避免水合不一致，
 *   挂载后立即填充；now 与 events 收敛在同一个快照 state 里原子更新（不闪空态）。
 */
import { useEffect, useState } from 'react';
import { localDB, type CalendarEventRecord } from '@/lib/ios/db';
import {
  colorHex,
  dateToKey,
  normalizeEvent,
  occursOn,
  pad2,
  sortEvents,
  weekdayCN,
  type NormalizedEvent,
} from '@/components/apps/calendar/shared';

/** 向后查找最近日程的天数窗口（30 天：日程排在 7 天外也能找到，修「添加了日程仍显示近期没有安排」） */
const LOOKAHEAD_DAYS = 30;

/** 最近一条日程（dayOff = 距今天几天：0=今天、1=明天……） */
interface NextEvent {
  ev: NormalizedEvent;
  dayOff: number;
}

/**
 * 最近的下一条日程：今天起向后 LOOKAHEAD_DAYS 天逐日展开（occursOn 含重复/跨天），
 * 当日按 sortEvents 排序（全天在前、其余按开始时间）；今天的日程只取尚未开始
 * （HH:mm ≥ 当前时刻；全天事件整日有效），取不到再顺延到明天及以后。
 */
function nextEventOf(events: CalendarEventRecord[], now: Date): NextEvent | null {
  const list = events.map(normalizeEvent);
  const nowHM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  for (let off = 0; off <= LOOKAHEAD_DAYS; off++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
    const key = dateToKey(d);
    const day = sortEvents(list.filter((ev) => occursOn(ev, key)));
    for (const ev of day) {
      if (off === 0 && ev.startTime && ev.startTime < nowHM) continue; // 今日已开始的跳过
      return { ev, dayOff: off };
    }
  }
  return null;
}

/** 日程时间文案：今天/明天/周X + HH:mm（全天日程标「全天」） */
function timeTextOf(n: NextEvent, now: Date): string {
  const day =
    n.dayOff === 0 ? '今天' : n.dayOff === 1 ? '明天' : weekdayCN(dateToKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n.dayOff)));
  return `${day} ${n.ev.startTime || '全天'}`;
}

export function CalendarCardWidget({ testId }: { testId?: string }) {
  /** now + events 原子快照：null = SSR/首帧（日期留空不闪空态文案） */
  const [snap, setSnap] = useState<{ now: Date; events: CalendarEventRecord[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      const now = new Date();
      localDB
        .getAll('events')
        .then((events) => {
          if (alive) setSnap({ now, events });
        })
        .catch(() => {
          /* IndexedDB 不可用时按空日程处理（优雅空态，不报错不白块） */
          if (alive) setSnap({ now, events: [] });
        });
    };
    tick();
    const iv = window.setInterval(tick, 30_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);

  const now = snap?.now ?? null;
  const next = snap ? nextEventOf(snap.events, snap.now) : null;
  const weekText = now ? `星期${'日一二三四五六'[now.getDay()]}` : '';
  const monthText = now ? String(now.getMonth() + 1) : '';
  const dateText = now ? String(now.getDate()) : '';
  return (
    <div
      {...(testId ? { 'data-testid': testId } : { 'data-testid': 'calendar-widget' })}
      className="flex h-[168px] w-full select-none flex-col overflow-hidden rounded-[24px] bg-white/95 px-[13px] pb-[12px] pt-[13px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      {/* 周几（珊瑚红，与日历 App 主色同源） */}
      <p className="text-[15px] font-bold leading-[15px] text-[#E5493C] dark:text-[#FF6B5E]">{weekText}</p>
      {/* X月X日大字（数字大、月/日小字骑基线） */}
      <p className="mt-[5px] flex items-baseline gap-[2px] leading-none text-[#161618] dark:text-white">
        <span className="text-[30px] font-bold leading-[1.05] tracking-tight tabular-nums">{monthText}</span>
        <span className="text-[13px] font-medium leading-none text-black/45 dark:text-white/50">月</span>
        <span className="text-[30px] font-bold leading-[1.05] tracking-tight tabular-nums">{dateText}</span>
        <span className="text-[13px] font-medium leading-none text-black/45 dark:text-white/50">日</span>
      </p>
      {/* 分隔细线 */}
      <span aria-hidden="true" className="mt-[10px] block h-px w-full bg-black/[0.08] dark:bg-white/[0.10]" />
      {/* 最近的下一条日程（无日程 = 优雅空态；snap 非空才会出现） */}
      {next && snap ? (
        <div className="mt-auto flex min-w-0 items-start gap-[7px]">
          <span
            aria-hidden="true"
            className="mt-[2px] h-[34px] w-[3.5px] shrink-0 rounded-full"
            style={{ backgroundColor: colorHex(next.ev.nColor) }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-[15px] text-[#161618] dark:text-white">
              {next.ev.title || '（无标题）'}
            </p>
            <p className="mt-[2px] truncate text-[11.5px] font-medium leading-[13px] text-black/40 dark:text-white/45">
              {timeTextOf(next, snap.now)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-auto truncate text-[12px] font-medium leading-[13px] text-black/30 dark:text-white/35">
          {now ? '近期没有安排' : ''}
        </p>
      )}
    </div>
  );
}
