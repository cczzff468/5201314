'use client';

/**
 * 全套日历/提醒小组件（机主提供的 iOS 日历小组件合集设计稿）：
 * - CalendarBigDateWidget 大日期卡（白卡 2×2）：红色大日期数字 + 农历 + 最近日程倒计时；
 * - CalendarMonthWidget 日历月览（白卡 4×3）：整月网格，今天红圆底白字、有日程日期彩色点；
 * - CalendarMonthDarkWidget 黑色月历（黑卡 4×3）：同月览但深黑底（不随系统深色切换）；
 * - CalendarWeekWidget 周日历（黑卡 2×3）：红色月份大字 + 本周日~六一行 + 今年剩余天数；
 * - CalendarProgressWidget 日历进度（白卡 2×2）：今日剩余/今年已过双进度条；
 * - RemindersWidget 提醒事项（白卡 2×2）：最近 3 条未完成提醒（过期标红）+ 空态。
 *
 * 设计口径：红色强调 #E5493C、深黑 #1A1A1E、白卡 bg-white/95 ring-black/10、
 * 农历小字灰 #B0B0B0、大数字粗体 tabular-nums。
 *
 * 数据源：日历 = localDB 'events'（经日历 App 的 normalizeEvent/occursOn/sortEvents
 * 归一化与重复展开，与 App 内同一套口径）；提醒 = localDB 'reminders'。
 * 纯展示（点击行为走主屏 WIDGET_META 通道打开对应 App）；SSR/首帧不渲染日期
 * （挂载后填充，参考 CalendarCard 的 snap 模式避免水合不一致）；每 60s 对账一次。
 */

import { useEffect, useMemo, useState } from 'react';
import { localDB, type CalendarEventRecord, type ReminderRecord } from '@/lib/ios/db';
import { solarToLunar } from '@/lib/ios/lunar';
import {
  WEEKDAY_HEADER,
  addMonths,
  colorHex,
  dateKey,
  dateToKey,
  daysInMonth,
  normalizeEvent,
  occursOn,
  pad2,
  sortEvents,
  type NormalizedEvent,
} from '@/components/apps/calendar/shared';

/** 最近日程查找窗口（天）：与日历小组件同口径（覆盖「添加日程后仍显示没有安排」的修法） */
const LOOKAHEAD_DAYS = 30;

// ---------------- 数据快照（SSR 安全：挂载后填充 + 定时对账） ----------------

/** 日历快照：now 与 events 收敛在同一个 state 里原子更新（不闪空态） */
function useCalendarSnap(): { now: Date; events: CalendarEventRecord[] } | null {
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
          /* IndexedDB 不可用时按空数据处理（优雅空态，不报错不白块） */
          if (alive) setSnap({ now, events: [] });
        });
    };
    tick();
    const iv = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);
  return snap;
}

/** 提醒快照（提醒事项 App 同一张 IndexedDB 表） */
function useRemindersSnap(): { now: Date; reminders: ReminderRecord[] } | null {
  const [snap, setSnap] = useState<{ now: Date; reminders: ReminderRecord[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      const now = new Date();
      localDB
        .getAll('reminders')
        .then((reminders) => {
          if (alive) setSnap({ now, reminders });
        })
        .catch(() => {
          if (alive) setSnap({ now, reminders: [] });
        });
    };
    tick();
    const iv = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, []);
  return snap;
}

// ---------------- 展示工具 ----------------

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS: string[] = (() => {
  const n = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const arr: string[] = [];
  for (let i = 1; i <= 10; i++) arr.push(`初${n[i - 1]}`);
  for (let i = 11; i <= 19; i++) arr.push(`十${n[i - 11]}`);
  arr.push('二十');
  for (let i = 21; i <= 29; i++) arr.push(`廿${n[i - 21]}`);
  arr.push('三十');
  return arr;
})();

/** 农历月日文案，如「农历二月廿八」（不含干支年，设计稿小字口径） */
function lunarMD(d: Date): string {
  const l = solarToLunar(d);
  return `农历${l.leap ? '闰' : ''}${LUNAR_MONTHS[l.month - 1] ?? ''}月${LUNAR_DAYS[l.day - 1] ?? ''}`;
}

/** 最近日程（dayOff = 距今天几天：0=今天、1=明天……；今天只取尚未开始的） */
interface NextEvent {
  ev: NormalizedEvent;
  dayOff: number;
}

/** 最近的下一条日程：今天起向后 LOOKAHEAD_DAYS 天逐日展开（与 CalendarCard 同一套口径） */
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

/** 月历网格单元格（固定 6 周 42 格，周日起；含前后月补位） */
interface MonthCell {
  key: string;
  day: number;
  inMonth: boolean;
}

/** 整月 42 格（周日起头，非本月灰淡补位） */
function monthCells(y: number, m: number): MonthCell[] {
  const first = new Date(y, m, 1);
  const lead = first.getDay();
  const total = daysInMonth(y, m);
  const prev = addMonths(y, m, -1);
  const prevTotal = daysInMonth(prev.y, prev.m);
  const next = addMonths(y, m, 1);
  const out: MonthCell[] = [];
  const push = (yy: number, mm: number, dd: number, inMonth: boolean) => {
    out.push({ key: dateKey(yy, mm, dd), day: dd, inMonth });
  };
  for (let i = lead - 1; i >= 0; i--) push(prev.y, prev.m, prevTotal - i, false);
  for (let d = 1; d <= total; d++) push(y, m, d, true);
  let nd = 1;
  while (out.length < 42) push(next.y, next.m, nd++, false);
  return out;
}

/** 月网格每天的日程点颜色（每日取首个日程颜色；无日程无点） */
function dotMapOf(events: CalendarEventRecord[], keys: string[]): Map<string, string> {
  const list = events.map(normalizeEvent);
  const map = new Map<string, string>();
  for (const k of keys) {
    for (const ev of list) {
      if (occursOn(ev, k)) {
        map.set(k, colorHex(ev.nColor));
        break;
      }
    }
  }
  return map;
}

/** 今年剩余天数（含今天） */
function yearDaysLeft(now: Date): number {
  const y = now.getFullYear();
  return Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, now.getMonth(), now.getDate())) / 86_400_000);
}

/** 今年已过比例 0~1（含当日时刻） */
function yearElapsed(now: Date): number {
  const y = now.getFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  const cur = Date.UTC(y, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  return Math.max(0, Math.min(1, (cur - start) / (end - start)));
}

/** 今日剩余比例 0~1（当前时刻占全天的剩余） */
function dayRemaining(now: Date): number {
  const secs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return Math.max(0, 1 - secs / 86_400);
}

/** 明天的 'YYYY-MM-DD' */
function tomorrowKey(today: string): string {
  const [y, m, d] = today.split('-').map((v) => parseInt(v, 10));
  const t = new Date(y || 2026, (m || 1) - 1, (d || 1) + 1);
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

/** 提醒到期文案：今天(红)/明天/X月X日（过期红）；无日期无时间返回 null */
function reminderDue(r: ReminderRecord, today: string): { text: string; red: boolean } | null {
  const t = r.dueTime ? ` ${r.dueTime}` : '';
  if (!r.dueDate) return r.dueTime ? { text: `今天${t}`, red: false } : null;
  if (r.dueDate === today) return { text: `今天${t}`, red: true };
  const parts = r.dueDate.split('-').map((v) => parseInt(v, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const red = r.dueDate < today;
  if (r.dueDate === tomorrowKey(today)) return { text: `明天${t}`, red };
  return { text: `${parts[1]}月${parts[2]}日${t}`, red };
}

/** 未完成提醒排序：有日期在前按 dueDate+dueTime 升序，无日期沉底按创建时间 */
function sortOpenReminders(list: ReminderRecord[]): ReminderRecord[] {
  return [...list]
    .filter((r) => !r.completed)
    .sort((a, b) => {
      const ka = a.dueDate || '9999-12-31';
      const kb = b.dueDate || '9999-12-31';
      if (ka !== kb) return ka < kb ? -1 : 1;
      const ta = a.dueTime || '99:99';
      const tb = b.dueTime || '99:99';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
}

// ---------------- 小组件 ----------------

/** 大日期卡（白）：居中「2026年3月」红小字 → 超大红日期数字 → 农历灰字 → 最近日程倒计时 */
export function CalendarBigDateWidget({ testId }: { testId?: string }) {
  const snap = useCalendarSnap();
  const now = snap?.now ?? null;
  const next = snap ? nextEventOf(snap.events, snap.now) : null;
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[168px] w-full select-none flex-col items-center overflow-hidden rounded-[22px] bg-white/95 px-[12px] pb-[11px] pt-[13px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      <p className="text-[12px] font-semibold leading-[13px] text-[#E5493C] dark:text-[#FF6B5E]">
        {now ? `${now.getFullYear()}年${now.getMonth() + 1}月` : ''}
      </p>
      <p className="mt-[4px] text-[56px] font-bold leading-[58px] tracking-tight tabular-nums text-[#E5493C] dark:text-[#FF6B5E]">
        {now ? now.getDate() : ''}
      </p>
      <p className="mt-[2px] text-[11.5px] font-medium leading-[13px] text-[#B0B0B0] dark:text-white/40">
        {now ? lunarMD(now) : ''}
      </p>
      {/* 最近日程倒计时（无日程 = 优雅空态灰字） */}
      {next && now ? (
        <p className="mt-auto w-full truncate text-center text-[11px] font-medium leading-[13px] text-black/50 dark:text-white/50">
          {next.dayOff === 0 ? `今天 · ${next.ev.title || '（无标题）'}` : next.dayOff === 1 ? `明天 · ${next.ev.title || '（无标题）'}` : `距离「${next.ev.title || '无标题'}」还有 ${next.dayOff} 天`}
        </p>
      ) : (
        <p className="mt-auto w-full truncate text-center text-[11px] font-medium leading-[13px] text-black/30 dark:text-white/35">
          {now ? '近期没有安排' : ''}
        </p>
      )}
    </div>
  );
}

/** 整月网格主体（月览白卡/黑卡共用）：今天红圆底白字、有日程日期彩色点、非本月灰淡 */
function MonthGrid({ now, events, dark }: { now: Date; events: CalendarEventRecord[]; dark: boolean }) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const cells = useMemo(() => monthCells(y, m), [y, m]);
  const dots = useMemo(() => dotMapOf(events, cells.map((c) => c.key)), [events, cells]);
  const todayK = dateToKey(now);
  return (
    <>
      {/* 星期表头 */}
      <div className="mt-[7px] grid grid-cols-7">
        {WEEKDAY_HEADER.map((w) => (
          <p key={w} className={`text-center text-[10px] font-medium leading-[13px] ${dark ? 'text-white/40' : 'text-black/35 dark:text-white/40'}`}>
            {w}
          </p>
        ))}
      </div>
      {/* 日期网格（固定 6 行） */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {cells.map((c) => {
          const isToday = c.key === todayK;
          const dot = dots.get(c.key);
          return (
            <div key={c.key} className="flex flex-col items-center justify-center gap-[2px]">
              <span
                className={`flex h-[24px] w-[24px] items-center justify-center rounded-full text-[13px] font-semibold leading-none tabular-nums ${
                  isToday
                    ? 'bg-[#E5493C] text-white'
                    : c.inMonth
                      ? dark
                        ? 'text-white'
                        : 'text-[#1A1A1A] dark:text-white'
                      : dark
                        ? 'text-white/25'
                        : 'text-black/25 dark:text-white/25'
                }`}
              >
                {c.day}
              </span>
              <span className="flex h-[4px] items-center" aria-hidden="true">
                {dot && <span className="h-[4px] w-[4px] rounded-full" style={{ backgroundColor: dot }} />}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 日历月览（白底全月历 4×3）：年黑粗体 + 红色月份 + 右上星期/农历灰字 */
export function CalendarMonthWidget({ testId }: { testId?: string }) {
  const snap = useCalendarSnap();
  const now = snap?.now ?? null;
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[260px] w-full select-none flex-col overflow-hidden rounded-[22px] bg-white/95 px-[12px] pb-[8px] pt-[11px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      <div className="flex items-start justify-between">
        <p className="flex items-baseline gap-[3px] text-[17px] font-bold leading-[20px] text-[#1A1A1A] dark:text-white">
          {now ? now.getFullYear() : ''}
          <span>年</span>
          <span className="text-[#E5493C] dark:text-[#FF6B5E]">{now ? `${now.getMonth() + 1}月` : ''}</span>
        </p>
        <div className="pt-[1px] text-right">
          <p className="text-[10px] font-medium leading-[13px] text-[#B0B0B0] dark:text-white/40">
            {now ? `星期${'日一二三四五六'[now.getDay()]}` : ''}
          </p>
          <p className="text-[10px] leading-[13px] text-[#B0B0B0] dark:text-white/40">{now ? lunarMD(now) : ''}</p>
        </div>
      </div>
      {now && <MonthGrid now={now} events={snap?.events ?? []} dark={false} />}
    </div>
  );
}

/** 黑色月历（黑底全月历 4×3）：不随系统深色切换，恒黑卡白字 */
export function CalendarMonthDarkWidget({ testId }: { testId?: string }) {
  const snap = useCalendarSnap();
  const now = snap?.now ?? null;
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[260px] w-full select-none flex-col overflow-hidden rounded-[22px] bg-[#1A1A1E] px-[12px] pb-[8px] pt-[11px] ring-1 ring-black/25"
    >
      <div className="flex items-start justify-between">
        <p className="flex items-baseline gap-[3px] text-[17px] font-bold leading-[20px] text-white">
          {now ? now.getFullYear() : ''}
          <span>年</span>
          <span className="text-[#E5493C]">{now ? `${now.getMonth() + 1}月` : ''}</span>
        </p>
        <div className="pt-[1px] text-right">
          <p className="text-[10px] font-medium leading-[13px] text-white/45">
            {now ? `星期${'日一二三四五六'[now.getDay()]}` : ''}
          </p>
          <p className="text-[10px] leading-[13px] text-white/45">{now ? lunarMD(now) : ''}</p>
        </div>
      </div>
      {now && <MonthGrid now={now} events={snap?.events ?? []} dark={true} />}
    </div>
  );
}

/** 周日历（黑底周视图 2×3）：红色月份大字 + 本周日~六（今天红圆）+ 今年剩余天数 */
export function CalendarWeekWidget({ testId }: { testId?: string }) {
  const snap = useCalendarSnap();
  const now = snap?.now ?? null;
  /** 本周日~六（今天红圆底白字，其余白字） */
  const week = useMemo(() => {
    if (!now) return [];
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { d, isToday: dateToKey(d) === dateToKey(now) };
    });
  }, [now]);
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[260px] w-full select-none flex-col overflow-hidden rounded-[22px] bg-[#1A1A1E] px-[11px] pb-[13px] pt-[14px] ring-1 ring-black/25"
    >
      <div className="flex items-start justify-between">
        <p className="text-[30px] font-bold leading-[30px] tracking-tight text-[#E5493C]">{now ? `${now.getMonth() + 1}月` : ''}</p>
        <div className="pt-[3px] text-right">
          <p className="text-[10px] font-medium leading-[14px] text-white/45">{now ? lunarMD(now) : ''}</p>
          <p className="text-[10px] leading-[14px] text-white/45">{now ? `今年剩余 ${yearDaysLeft(now)} 天` : ''}</p>
        </div>
      </div>
      {/* 本周七日：今天红色圆底白字 + 底部红点标记 */}
      <div className="mt-auto flex items-start justify-between px-[1px]">
        {week.map(({ d, isToday }) => (
          <div key={dateToKey(d)} className="flex w-[19px] flex-col items-center gap-[4px]">
            <span
              className={`flex h-[23px] w-[23px] items-center justify-center rounded-full text-[12.5px] font-semibold leading-none tabular-nums ${
                isToday ? 'bg-[#E5493C] text-white' : 'text-white'
              }`}
            >
              {d.getDate()}
            </span>
            <span className="flex h-[3px] items-center" aria-hidden="true">
              {isToday && <span className="h-[3px] w-[3px] rounded-full bg-[#E5493C]" />}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-[9px] text-center text-[10px] font-medium leading-none text-white/35">周日～周六</p>
    </div>
  );
}

/** 日历进度卡（白 2×2）：红色大日期 + 今日剩余/今年已过双进度条 */
export function CalendarProgressWidget({ testId }: { testId?: string }) {
  const snap = useCalendarSnap();
  const now = snap?.now ?? null;
  const dayLeft = now ? dayRemaining(now) : 0;
  const yearPast = now ? yearElapsed(now) : 0;
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[168px] w-full select-none flex-col overflow-hidden rounded-[22px] bg-white/95 px-[13px] pb-[12px] pt-[13px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      <div className="flex items-start gap-[8px]">
        <span className="text-[34px] font-bold leading-[34px] tracking-tight tabular-nums text-[#E5493C] dark:text-[#FF6B5E]">
          {now ? now.getDate() : ''}
        </span>
        <div className="pt-[1px]">
          <p className="text-[11px] font-semibold leading-[14px] text-[#1A1A1A] dark:text-white">
            {now ? `${now.getFullYear()}年${now.getMonth() + 1}月 星期${'日一二三四五六'[now.getDay()]}` : ''}
          </p>
          <p className="mt-[2px] text-[10px] font-medium leading-[12px] text-[#B0B0B0] dark:text-white/40">
            {now ? lunarMD(now) : ''}
          </p>
        </div>
      </div>
      {/* 双进度条（细条 + 小字百分比） */}
      <div className="mt-auto flex flex-col gap-[9px]">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold leading-[13px] text-black/55 dark:text-white/55">
              {now ? '今日剩余' : ''}
            </span>
            <span className="text-[10.5px] font-bold leading-[13px] tabular-nums text-[#E5493C] dark:text-[#FF6B5E]">
              {now ? `${Math.round(dayLeft * 100)}%` : ''}
            </span>
          </div>
          <div className="mt-[4px] h-[4px] w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.12]">
            <div
              className="h-full rounded-full bg-[#E5493C] dark:bg-[#FF6B5E]"
              style={{ width: `${Math.round(dayLeft * 100)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold leading-[13px] text-black/55 dark:text-white/55">
              {now ? '今年已过' : ''}
            </span>
            <span className="text-[10.5px] font-bold leading-[13px] tabular-nums text-[#1A1A1A] dark:text-white">
              {now ? `${Math.round(yearPast * 100)}%` : ''}
            </span>
          </div>
          <div className="mt-[4px] h-[4px] w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.12]">
            <div
              className="h-full rounded-full bg-[#1A1A1A]/70 dark:bg-white/70"
              style={{ width: `${Math.round(yearPast * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 提醒事项小组件（白 2×2）：标题 + 未完成数角标 + 最近 3 条未完成提醒（过期标红） */
export function RemindersWidget({ testId }: { testId?: string }) {
  const snap = useRemindersSnap();
  const now = snap?.now ?? null;
  const open = snap ? sortOpenReminders(snap.reminders) : [];
  const top3 = open.slice(0, 3);
  const todayK = now ? dateToKey(now) : '';
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[168px] w-full select-none flex-col overflow-hidden rounded-[22px] bg-white/95 px-[13px] pb-[9px] pt-[12px] ring-1 ring-black/10 dark:bg-[#1c1c1e]/95 dark:ring-white/10"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold leading-[15px] text-[#1A1A1A] dark:text-white">提醒事项</p>
        {open.length > 0 && (
          <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#E5493C] px-[4px] text-[10px] font-bold leading-none text-white">
            {open.length > 99 ? '99+' : open.length}
          </span>
        )}
      </div>
      {/* 最近 3 条未完成提醒（空态 = 灰字提示） */}
      {top3.length > 0 ? (
        <div className="mt-[7px] flex flex-col gap-[7px]">
          {top3.map((r) => {
            const due = now ? reminderDue(r, todayK) : null;
            return (
              <div key={r.id} className="flex min-w-0 items-center gap-[7px]">
                <span
                  aria-hidden="true"
                  className="h-[14px] w-[14px] shrink-0 rounded-full border-[1.5px] border-black/25 dark:border-white/30"
                />
                <p className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[14px] text-[#1A1A1A] dark:text-white">
                  {r.title || '（无标题）'}
                </p>
                {due && (
                  <p
                    className={`shrink-0 text-[10px] font-medium leading-[12px] tabular-nums ${
                      due.red ? 'text-[#E5493C] dark:text-[#FF6B5E]' : 'text-black/40 dark:text-white/45'
                    }`}
                  >
                    {due.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-auto text-[11.5px] font-medium leading-[13px] text-black/30 dark:text-white/35">
          {now ? '暂无提醒' : ''}
        </p>
      )}
      <p className="mt-auto text-center text-[9.5px] font-medium leading-[11px] text-black/30 dark:text-white/35">
        {now ? '点击打开提醒事项' : ''}
      </p>
    </div>
  );
}
