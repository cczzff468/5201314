'use client';

/**
 * 日历 App 共享层（Task 16-b 珊瑚红暖色重构）：
 * - 设计常量（暖白底 / 珊瑚红主色 / 卡片 / 文字灰阶 / 金色操作色）
 * - 日期与农历（含节气、公历/农历节日）小字工具
 * - CalendarEventRecord 归一化与重复展开（旧数据向后兼容）
 * - 页面导航条、日程列表行等公共小组件
 *
 * 设计稿：upload/cal-crop/*.png（11 页，主色珊瑚红 #E5493C、浅红胶囊 #FBEAE7、暖白底 #FAF9F7）。
 */

import type { ReactNode } from 'react';
import { solarToLunar } from '@/lib/ios/lunar';
import type { CalendarEventRecord, NoteRecord } from '@/lib/ios/db';

// ---------------- 设计常量 ----------------
// 深色模式（Task 31-a）：颜色常量改为 CSS 变量引用，浅色回退值 = 原浅色 hex（视觉零变化）；
// CalendarApp 根节点（index.tsx）挂 dark:[--cal-*:…] 变体类，html.dark 时整棵树自动换深色配色。

/** 主色：珊瑚红/朱红（深浅色通用，不变量） */
export const ACCENT = '#E5493C';
/** 主色浅底（时间胶囊/选中行/删除按钮底） */
export const ACCENT_SOFT = 'var(--cal-accent-soft, #FBEAE7)';
/** 暖白页面底色 */
export const BG = 'var(--cal-bg, #FAF9F7)';
/** 卡片白 */
export const CARD = 'var(--cal-card, #FFFFFF)';
/** 文字主色（暖黑） */
export const TEXT = 'var(--cal-text, #29241F)';
/** 辅助文字 */
export const TEXT_2 = 'var(--cal-text-2, #8F8A82)';
/** 弱化文字（农历/说明） */
export const TEXT_3 = 'var(--cal-text-3, #B8B2AA)';
/** 分割线 */
export const DIVIDER = 'var(--cal-divider, #F1EDE7)';
/** 金色操作文字（备忘录相关动作，与备忘录 App 金色主题呼应；深浅色通用） */
export const GOLD = '#C79A3B';
/** 金色浅底 */
export const GOLD_SOFT = 'var(--cal-gold-soft, #FBF3E1)';
/** 小米蓝（日程表单 取消/完成 与分类胶囊「个人」；深色提亮一档保对比度） */
export const MI_BLUE = 'var(--cal-mi-blue, #3478F6)';
/** 浅灰填充（搜索框底等）；深色 → 白色低透明度 */
export const FILL_SOFT = 'var(--cal-fill-soft, rgba(41,36,31,0.05))';
/** 中灰填充（清除按钮底/开关断电底等）；深色 → 白色中透明度 */
export const FILL_MED = 'var(--cal-fill-med, rgba(41,36,31,0.14))';

/** 日程颜色卡（11 色，顺序同设计稿；key 存入 CalendarEventRecord.color） */
export const EVENT_COLORS: { key: string; label: string; hex: string }[] = [
  { key: 'purple', label: '紫色', hex: '#9B5DE5' },
  { key: 'blue', label: '蓝色', hex: '#4C8DF6' },
  { key: 'yellow', label: '黄色', hex: '#F2B917' },
  { key: 'orange', label: '橙色', hex: '#FF9F0A' },
  { key: 'teal', label: '青绿色', hex: '#24C6BE' },
  { key: 'green', label: '绿色', hex: '#35C759' },
  { key: 'red', label: '红色', hex: '#FF453A' },
  { key: 'lime', label: '青柠', hex: '#B8D926' },
  { key: 'olive', label: '黄绿色', hex: '#CCB605' },
  { key: 'brown', label: '棕色', hex: '#AC8E68' },
  { key: 'pink', label: '蛋糕粉', hex: '#F98CA5' },
];

export function colorHex(key?: string): string {
  return EVENT_COLORS.find((c) => c.key === key)?.hex ?? EVENT_COLORS[0].hex;
}

export function colorLabel(key?: string): string {
  return EVENT_COLORS.find((c) => c.key === key)?.label ?? EVENT_COLORS[0].label;
}

// ---------------- 重复 / 提醒选项 ----------------

export type RepeatKey = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type AlertKey = 'none' | 'atStart' | 'm5' | 'm15' | 'm30' | 'h1' | 'd1';

export const REPEAT_OPTIONS: { key: RepeatKey; label: string }[] = [
  { key: 'none', label: '不重复' },
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'yearly', label: '每年' },
];

export const ALERT_OPTIONS: { key: AlertKey; label: string }[] = [
  { key: 'none', label: '不提醒' },
  { key: 'atStart', label: '开始时' },
  { key: 'm5', label: '提前 5 分钟' },
  { key: 'm15', label: '提前 15 分钟' },
  { key: 'm30', label: '提前 30 分钟' },
  { key: 'h1', label: '提前 1 小时' },
  { key: 'd1', label: '提前 1 天' },
];

export function alertLabel(key?: AlertKey): string {
  return ALERT_OPTIONS.find((a) => a.key === key)?.label ?? '提前 15 分钟';
}

/** 重复规则展示文案（含旧数据 repeat 数组推导：每天/工作日/每周/自定义） */
export function repeatLabel(ev: Pick<CalendarEventRecord, 'repeat' | 'repeatRule'>): string {
  if (ev.repeatRule) return REPEAT_OPTIONS.find((r) => r.key === ev.repeatRule)?.label ?? '不重复';
  const arr = ev.repeat ?? [];
  if (arr.length === 7) return '每天';
  if (arr.length === 5 && [1, 2, 3, 4, 5].every((d) => arr.includes(d))) return '工作日';
  if (arr.length === 1) return '每周';
  if (arr.length > 1) return '自定义';
  return '不重复';
}

// ---------------- 日期工具 ----------------

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 'YYYY-MM-DD' */
export function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

export function keyToParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map((v) => parseInt(v, 10));
  return { y: y || 2026, m: (m || 1) - 1, d: d || 1 };
}

export function keyToDate(key: string): Date {
  const { y, m, d } = keyToParts(key);
  return new Date(y, m, d);
}

export function dateToKey(d: Date): string {
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** 周日头开始的星期表头（小米日历风格） */
export const WEEKDAY_HEADER = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_CN_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** '星期一'（日程视图日期头用） */
export function weekdayCNFull(key: string): string {
  return WEEKDAY_CN_FULL[keyToDate(key).getDay()] ?? '';
}

/** '周五' */
export function weekdayCN(key: string): string {
  return WEEKDAY_CN[keyToDate(key).getDay()] ?? '';
}

/** '10月23日 周五' */
export function formatDayShort(key: string): string {
  const { m, d } = keyToParts(key);
  return `${m + 1}月${d}日 ${weekdayCN(key)}`;
}

/** '2026年10月23日 周五' */
export function formatDayLong(key: string): string {
  const { y, m, d } = keyToParts(key);
  return `${y}年${m + 1}月${d}日 ${weekdayCN(key)}`;
}

/** 今天 'YYYY-MM-DD' */
export function todayKey(): string {
  return dateToKey(new Date());
}

// ---------------- 农历 / 节气 / 节日 ----------------

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS: string[] = (() => {
  const n = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const arr: string[] = [];
  for (let i = 1; i <= 10; i++) arr.push('初' + n[i - 1]);
  for (let i = 11; i <= 19; i++) arr.push('十' + n[i - 11]);
  arr.push('二十');
  for (let i = 21; i <= 29; i++) arr.push('廿' + n[i - 21]);
  arr.push('三十');
  return arr;
})();

/** 公历节日 'M-D' → 名称 */
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '12-24': '平安夜',
  '12-25': '圣诞节',
};

/** 农历节日 '月-日' → 名称 */
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
};

/** 二十四节气（21 世纪寿星公式 C 值，按公历月两两排列） */
const SOLAR_TERMS: [string, number][][] = [
  [['小寒', 5.4055], ['大寒', 20.12]],
  [['立春', 3.87], ['雨水', 18.73]],
  [['惊蛰', 5.63], ['春分', 20.646]],
  [['清明', 4.81], ['谷雨', 20.1]],
  [['立夏', 5.52], ['小满', 21.04]],
  [['芒种', 5.678], ['夏至', 21.37]],
  [['小暑', 7.108], ['大暑', 22.83]],
  [['立秋', 7.5], ['处暑', 23.13]],
  [['白露', 7.646], ['秋分', 23.042]],
  [['寒露', 8.318], ['霜降', 23.438]],
  [['立冬', 7.438], ['小雪', 22.36]],
  [['大雪', 7.18], ['冬至', 21.94]],
];

/** 某公历日的节气名（无则 ''）；经典寿星公式近似，个别年份可能偏差一天 */
function solarTermName(y: number, m: number, d: number): string {
  const terms = SOLAR_TERMS[m];
  if (!terms) return '';
  const yy = y % 100;
  for (const [name, c] of terms) {
    const day = Math.floor(yy * 0.2422 + c) - Math.floor(yy / 4);
    if (day === d) return name;
  }
  return '';
}

export interface LunarBadge {
  /** 月历日期下方的小字（节日/节气红字，常规农历灰字） */
  text: string;
  /** 是否节日/节气（红色显示） */
  festival: boolean;
  /** 完整农历描述，如「农历丙午年九月十四 霜降」（当日行/详情页用） */
  full: string;
}

const GAN = '甲乙丙丁戊己庚辛壬癸';
const ZHI = '子丑寅卯辰巳午未申酉戌亥';
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
function lunarYearName(y: number): string {
  return `${GAN[(y - 4) % 10]}${ZHI[(y - 4) % 12]}`;
}

/** 公历年的干支（如 2026 → 「丙午」，年视图顶部横幅用） */
export function yearGanZhi(y: number): string {
  return `${GAN[(y - 4) % 10]}${ZHI[(y - 4) % 12]}`;
}

/** 公历年的生肖（如 2026 → 「马」） */
export function yearZodiac(y: number): string {
  return ZODIAC[(y - 4) % 12] ?? '';
}

// ---------------- 法定节假日（休/班，小米日历角标） ----------------

const HOLIDAY_RANGES: [string, string, '休' | '班'][] = [
  // 2025
  ['2025-01-01', '2025-01-01', '休'],
  ['2025-01-26', '2025-01-26', '班'],
  ['2025-01-28', '2025-02-04', '休'],
  ['2025-02-08', '2025-02-08', '班'],
  ['2025-04-04', '2025-04-06', '休'],
  ['2025-05-01', '2025-05-05', '休'],
  ['2025-04-27', '2025-04-27', '班'],
  ['2025-05-31', '2025-06-02', '休'],
  ['2025-09-28', '2025-09-28', '班'],
  ['2025-10-01', '2025-10-08', '休'],
  // 2026
  ['2026-01-01', '2026-01-03', '休'],
  ['2026-02-07', '2026-02-07', '班'],
  ['2026-02-15', '2026-02-22', '休'],
  ['2026-02-28', '2026-02-28', '班'],
  ['2026-04-04', '2026-04-06', '休'],
  ['2026-04-26', '2026-04-26', '班'],
  ['2026-05-01', '2026-05-05', '休'],
  ['2026-05-09', '2026-05-09', '班'],
  ['2026-06-19', '2026-06-21', '休'],
  ['2026-09-25', '2026-09-27', '休'],
  ['2026-10-01', '2026-10-07', '休'],
  // 2027
  ['2027-01-01', '2027-01-03', '休'],
];

/** 法定节假日表：'YYYY-MM-DD' → '休' | '班'（覆盖 2025/2026/2027 主要安排） */
export const HOLIDAYS: Record<string, '休' | '班'> = (() => {
  const map: Record<string, '休' | '班'> = {};
  for (const [from, to, tag] of HOLIDAY_RANGES) {
    const a = keyToDate(from);
    const b = keyToDate(to);
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      map[dateToKey(d)] = tag;
    }
  }
  return map;
})();

/** 某公历日的法定假日标记（'休' | '班' | undefined） */
export function holidayOf(d: Date): '休' | '班' | undefined {
  return HOLIDAYS[dateToKey(d)];
}

/** 公历日期 → 月历小字 + 完整农历描述（节日 > 节气 > 农历日；初一显示月名） */
export function lunarBadge(d: Date): LunarBadge {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const solar = SOLAR_FESTIVALS[`${m + 1}-${day}`] ?? '';
  const l = solarToLunar(d);
  // 除夕：明天是正月初一
  const tomorrow = solarToLunar(new Date(y, m, day + 1));
  const isLunarNewYearEve = tomorrow.month === 1 && tomorrow.day === 1 && !tomorrow.leap;
  const lunar = LUNAR_FESTIVALS[`${l.month}-${l.day}`] ?? (isLunarNewYearEve ? '除夕' : '');
  const term = solarTermName(y, m, day);

  const dayText =
    l.day === 1 ? `${l.leap ? '闰' : ''}${LUNAR_MONTHS[l.month - 1] ?? ''}月` : (LUNAR_DAYS[l.day - 1] ?? '');
  const text = solar || lunar || term || dayText;
  const full = `农历${lunarYearName(l.year)}年${l.leap ? '闰' : ''}${LUNAR_MONTHS[l.month - 1] ?? ''}月${
    LUNAR_DAYS[l.day - 1] ?? ''
  }${term ? ` ${term}` : ''}`;
  // 初一月名（如「九月」）与节日/节气一样标红
  return { text, festival: Boolean(solar || lunar || term) || l.day === 1, full };
}

// ---------------- 事件归一化与展开 ----------------

export type NormalizedEvent = CalendarEventRecord & {
  /** 归一化后的字段（读取时补默认值，写回时原样保留） */
  nColor: string;
  nLocation: string;
  nRepeatRule: RepeatKey;
  nAlert: AlertKey;
  nEndDate: string;
};

/** 旧数据补默认值（purple/m15/单日/按 repeat 数组推导重复） */
export function normalizeEvent(ev: CalendarEventRecord): NormalizedEvent {
  let rule: RepeatKey;
  if (ev.repeatRule) {
    rule = ev.repeatRule;
  } else {
    const arr = ev.repeat ?? [];
    if (arr.length === 7) rule = 'daily';
    else if (arr.length === 1) rule = 'weekly';
    else rule = 'none'; // 多 weekday 的旧数据在 occursOn 走 legacy 展开分支
  }
  return {
    ...ev,
    nColor: ev.color ?? 'purple',
    nLocation: ev.location ?? '',
    nRepeatRule: rule,
    nAlert: ev.alert ?? 'm15',
    nEndDate: ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date,
  };
}

/** 事件是否落在某天（含重复展开；legacy repeat 数组按 weekday 匹配） */
export function occursOn(ev: NormalizedEvent, key: string): boolean {
  // 单日/跨天区间
  const inRange = key >= ev.date && key <= ev.nEndDate;
  const rule = ev.repeatRule ?? 'none';
  const legacy = ev.repeat ?? [];
  const legacyActive = !ev.repeatRule && legacy.length > 0;

  if (rule === 'none' && !legacyActive) return inRange;
  // 重复事件：从开始日起向后展开（每日/每周/每月/每年，锚点为开始日）
  if (key < ev.date) return false;
  if (rule === 'daily') return true;
  const d = keyToDate(key);
  const start = keyToDate(ev.date);
  if (rule === 'weekly') return d.getDay() === start.getDay();
  if (rule === 'monthly') return d.getDate() === start.getDate();
  if (rule === 'yearly') return d.getMonth() === start.getMonth() && d.getDate() === start.getDate();
  if (legacyActive) return legacy.includes(d.getDay());
  return inRange;
}

/** 当日列表排序：全天在前，其余按开始时间，再按创建时间 */
export function sortEvents(list: NormalizedEvent[]): NormalizedEvent[] {
  return [...list].sort((a, b) => {
    if (a.startTime === '' && b.startTime !== '') return -1;
    if (b.startTime === '' && a.startTime !== '') return 1;
    if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

// ---------------- 表单草稿 ----------------

export interface EventDraft {
  id: string | null;
  createdAt: number;
  title: string;
  location: string;
  allDay: boolean;
  /** 开始日期 YYYY-MM-DD */
  date: string;
  /** 结束日期（跨天）YYYY-MM-DD */
  endDate: string;
  start: string;
  end: string;
  note: string;
  color: string;
  repeatRule: RepeatKey;
  alert: AlertKey;
}

export function draftFromEvent(ev: NormalizedEvent): EventDraft {
  return {
    id: ev.id,
    createdAt: ev.createdAt,
    title: ev.title,
    location: ev.nLocation,
    allDay: ev.startTime === '',
    date: ev.date,
    endDate: ev.nEndDate,
    start: ev.startTime || '09:00',
    end: ev.endTime || '10:00',
    note: ev.note,
    color: ev.nColor,
    repeatRule: ev.nRepeatRule,
    alert: ev.nAlert,
  };
}

export function blankDraft(date: string): EventDraft {
  return {
    id: null,
    createdAt: Date.now(),
    title: '',
    location: '',
    allDay: false,
    date,
    endDate: date,
    start: '09:00',
    end: '10:00',
    note: '',
    color: 'purple',
    repeatRule: 'none',
    alert: 'm15',
  };
}

/** 草稿 → 存储记录（repeat 数组按规则派生，保持旧字段语义兼容） */
export function draftToRecord(d: EventDraft, id: string): CalendarEventRecord {
  const wd = keyToDate(d.date).getDay();
  const repeat: number[] =
    d.repeatRule === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : d.repeatRule === 'weekly' ? [wd] : [];
  return {
    id,
    title: d.title.trim(),
    date: d.date,
    endDate: d.endDate > d.date ? d.endDate : undefined,
    startTime: d.allDay ? '' : d.start,
    endTime: d.allDay ? '' : d.end,
    note: d.note.trim(),
    createdAt: d.createdAt,
    repeat,
    repeatRule: d.repeatRule,
    location: d.location.trim(),
    color: d.color,
    alert: d.alert,
  };
}

// ---------------- 备忘录联动（16-a 约定字段：linkedEventId / linkDate） ----------------

/** 备忘录是否与该日程/日期相关（当日备忘录口径：强关联或同日） */
export function noteRelatesToEvent(n: NoteRecord, ev: NormalizedEvent): boolean {
  if (n.linkedEventId === ev.id) return true;
  if (n.linkDate === ev.date) return true;
  return dateToKey(new Date(n.createdAt)) === ev.date;
}

/** 备忘录是否强关联该日程（关联列表的选中态） */
export function noteLinkedToEvent(n: NoteRecord, ev: NormalizedEvent): boolean {
  return n.linkedEventId === ev.id;
}

/** 备忘录 HTML 摘要 → 纯文本（日历侧只做展示级 strip，不解析富文本） */
export function htmlToPlain(html: string): string {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------- 公共小组件 ----------------

/** 顶部导航条（三段式：返回/标题/右侧动作；固定高度，标题居中） */
export function NavBar({
  left,
  title,
  right,
}: {
  left: ReactNode;
  title: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="relative flex h-11 shrink-0 items-center justify-between px-4">
      <div className="flex min-w-[64px] items-center gap-1">{left}</div>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold"
        style={{ color: TEXT }}
      >
        {title}
      </div>
      <div className="flex min-w-[64px] items-center justify-end gap-3">{right}</div>
    </div>
  );
}

/** 红字导航按钮（返回/取消/完成等） */
export function NavTextButton({
  label,
  onClick,
  disabled = false,
  bold = false,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  bold?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="text-[16px] transition-opacity active:opacity-50"
      style={{ color: disabled ? TEXT_3 : ACCENT, fontWeight: bold ? 600 : 400 }}
    >
      {label}
    </button>
  );
}

/** 日程列表行：左侧 3px 竖色条 + 标题/地点 + 右对齐时间 */
export function EventRow({
  ev,
  onClick,
  showDate,
}: {
  ev: NormalizedEvent;
  onClick: () => void;
  /** 搜索页：在地点行补日期 */
  showDate?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.03]"
    >
      <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: colorHex(ev.nColor) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight" style={{ color: TEXT }}>
          {ev.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight" style={{ color: TEXT_2 }}>
          {ev.nLocation || (ev.startTime === '' ? '全天' : '　')}
          {showDate ? ` · ${formatDayShort(ev.date)}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {ev.startTime === '' ? (
          <span className="text-[13px]" style={{ color: TEXT_2 }}>
            全天
          </span>
        ) : (
          <>
            <span className="block text-[15px] leading-tight" style={{ color: TEXT }}>
              {ev.startTime}
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight" style={{ color: TEXT_3 }}>
              {ev.endTime}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

/** 色点（颜色行/详情标题左侧） */
export function ColorDot({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: colorHex(color) }}
    />
  );
}
