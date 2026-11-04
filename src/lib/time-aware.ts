'use client';

/**
 * 时间感知（聊天 AI 感知当前时间 / 季节 / 节日 / 事件时长 / 上次聊天间隔）：
 *
 * - 开关按会话键独立保存（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey> /
 *   phone:<contactId>），localStorage 单键 JSON map（chat-time-aware）持久化，默认关闭；
 *   各 App 在发送现场读取 —— 打开/关闭后立刻影响下一次请求，无需重启 App；
 * - buildTimeAwareBlock：拼装注入 system 的完整时间感知块 —— 当前时间（北京时间 UTC+8）+
 *   月份天数参照表 + 日期运算规则 + 事件时长感知规则 + 场所营业状态 + 常见事件时长参照 +
 *   时间内化协议 + 节日对照表 + 距离上次聊天；全部规则只在内部生效，
 *   AI 被明确禁止把任何时间戳/日期格式的文本写进回复正文（【100-c】去方括号模板：
 *   内部时间概念用自然语言内化，不再要求构建任何会被外泄、且会被 persona 禁止的括号格式）；
 * - 「距离上次聊天」由调用方传入该会话最后一条消息的时间戳（lastMsgTime）现场计算，
 *   按角色/会话天然隔离不串台；只读取系统时钟换算北京时间，不修改系统时间；
 * - 开关关闭时调用方不注入本块，恢复普通聊天。
 */

import { solarToLunar } from './ios/lunar';
import { promptTextOf } from '@/lib/prompt-entries';
import { scopedConvKey } from './ios/accounts';

const STORE_KEY = 'chat-time-aware';

function loadMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的时间感知开关（未设置时默认关闭；会话键按账号作用域——多账号各自独立） */
export function getTimeAware(sessionKey: string): boolean {
  return loadMap()[scopedConvKey(sessionKey)] ?? false;
}

/** 保存某会话的时间感知开关（持久化到 localStorage，按会话键+账号隔离；立即影响下一次请求） */
export function setTimeAware(sessionKey: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  const map = loadMap();
  map[scopedConvKey(sessionKey)] = on;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

// ---------------- 时间计算（北京时间 UTC+8，只读系统时钟） ----------------

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 北京时间下的年月日时分秒（用 UTC+8 偏移换算，与设备时区无关） */
export interface BjTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 星期中文单字（日/一/二/三/四/五/六） */
  week: string;
}

export function toBjTime(ms: number): BjTime {
  const d = new Date(ms + 8 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    week: WEEK_CN[d.getUTCDay()] ?? '日',
  };
}

/** 季节（气候季节：3-5月春 / 6-8月夏 / 9-11月秋 / 12-2月冬） */
export function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return '春季';
  if (month >= 6 && month <= 8) return '夏季';
  if (month >= 9 && month <= 11) return '秋季';
  return '冬季';
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 当年每月天数（1-12 月；2月按闰年规则） */
function monthDaysOf(year: number): number[] {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}

// ---------------- 节日 ----------------

/**
 * 公历固定节日对照表（每年日期不变；键 = "M-D"）。
 * 农历节日（春节/元宵/端午/七夕/中元/中秋/重阳/腊八/小年/除夕）不在此表——
 * 由 lunar.ts 的农历换算逐年动态计算（getFestivals），任意年份都不会错位；
 * 清明是节气（4月4-6日浮动）用寿星公式推算；母亲节/父亲节/感恩节按星期规则动态计算。
 */
const SOLAR_FESTIVAL_MAP: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '5-20': '520',
  '5-21': '521',
  '6-1': '儿童节',
  '9-10': '教师节',
  '10-31': '万圣节',
  '11-11': '双十一',
  '12-12': '双十二',
  '12-25': '圣诞节',
  '12-31': '跨年夜',
};

/** 农历节日对照表（键 = 农历"月-日"；闰月日不匹配——闰月出现的节日不重复庆祝） */
const LUNAR_FESTIVAL_MAP: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '5-5': '端午节',
  '7-7': '七夕节',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年（北方）',
  '12-24': '小年（南方）',
};

/**
 * 清明节（节气，4月4-6日之间浮动）：寿星公式推算（21世纪：floor(Y%100×0.2422+4.81)-floor((Y%100)/4)）。
 * lunar.ts 只做农历月日换算，算不了节气；该公式 2000-2099 年与官方历表一致，比写死任何一年落点都稳。
 */
function qingmingDay(year: number): number {
  const y = year % 100;
  return Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4);
}

/** 公历（北京时间）年月日 → 农历。用本地正午构造 Date：solarToLunar 内部读本地年月日，
 *  这样无论设备处于哪个时区，读到的年月日都与传入值一致（与北京时间组件对齐） */
function lunarOf(year: number, month: number, day: number): ReturnType<typeof solarToLunar> {
  return solarToLunar(new Date(year, month - 1, day, 12));
}

/**
 * 农历节日（含除夕）：先判「明天是正月初一 → 今天是除夕」（腊月有 29/30 之差，次日判定最稳，
 * 闰腊月等极端历法也覆盖）；再按当日农历月日查表（闰月日不匹配）。
 */
function lunarFestivalsOf(year: number, month: number, day: number): string[] {
  const tomorrow = lunarOf(year, month, day + 1);
  if (!tomorrow.leap && tomorrow.month === 1 && tomorrow.day === 1) return ['除夕'];
  const today = lunarOf(year, month, day);
  if (today.leap) return [];
  const hit = LUNAR_FESTIVAL_MAP[`${today.month}-${today.day}`];
  return hit ? [hit] : [];
}

/** 某公历年的农历节日落点（扫当年日历；键 = "M-D" → 节日名），供注入表生成用 */
function lunarFestivalDatesOfYear(year: number): Map<string, string> {
  const days = monthDaysOf(year);
  const out = new Map<string, string>();
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= days[m - 1]; d++) {
      const names = lunarFestivalsOf(year, m, d);
      if (names.length === 0) continue;
      const key = `${m}-${d}`;
      if (!out.has(key)) out.set(key, names.join('、'));
    }
  }
  return out;
}

/** 某月第 N 个星期 W 的日期（W: 0=周日 … 6=周六） */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

/** 计算某公历日期命中的节日（公历固定表 + 清明 + 农历动态换算 + 周规则浮动节日 + 国庆假期 + 暑期），命中多个时全部返回 */
export function getFestivals(year: number, month: number, day: number): string[] {
  const out: string[] = [];
  const hit = SOLAR_FESTIVAL_MAP[`${month}-${day}`];
  if (hit) out.push(hit);
  if (month === 4 && day === qingmingDay(year)) out.push('清明节');
  out.push(...lunarFestivalsOf(year, month, day));
  if (month === 5 && day === nthWeekdayOfMonth(year, 5, 0, 2)) out.push('母亲节');
  if (month === 6 && day === nthWeekdayOfMonth(year, 6, 0, 3)) out.push('父亲节');
  if (month === 11 && day === nthWeekdayOfMonth(year, 11, 4, 4)) out.push('感恩节');
  if (month === 10 && day >= 1 && day <= 7) out.push('国庆节');
  if (month === 7 || month === 8) out.push('暑期');
  return out;
}

/**
 * 注入用节日对照表全文（按年动态生成）：公历固定项直接列；清明/农历节日/除夕给出当年实际落点
 * （农历经 lunar.ts 换算，扫全年日历得出）；周节日保留规则描述并标注当年日期。
 * 结果按年缓存（每次会话期只算一次；换年自动重算）。
 */
const festivalTableCache = new Map<number, string>();
function festivalTableTextOfYear(year: number): string {
  const cached = festivalTableCache.get(year);
  if (cached) return cached;
  const entries: { month: number; day: number; text: string }[] = [];
  const put = (month: number, day: number, label: string) =>
    entries.push({ month, day, text: `${month}月${day}日${label}` });
  put(1, 1, '元旦');
  put(2, 14, '情人节');
  put(3, 8, '妇女节');
  put(4, qingmingDay(year), '清明节');
  put(5, 1, '劳动节');
  put(5, 4, '青年节');
  // 周规则浮动节日：保留规则描述并标注当年落点（与既有注入格式一致）
  const mother = nthWeekdayOfMonth(year, 5, 0, 2);
  entries.push({ month: 5, day: mother, text: `5月第二个周日母亲节（${year}年为5月${mother}日）` });
  put(5, 20, '520');
  put(5, 21, '521');
  put(6, 1, '儿童节');
  const father = nthWeekdayOfMonth(year, 6, 0, 3);
  entries.push({ month: 6, day: father, text: `6月第三个周日父亲节（${year}年为6月${father}日）` });
  put(9, 10, '教师节');
  put(10, 31, '万圣节');
  const thanks = nthWeekdayOfMonth(year, 11, 4, 4);
  entries.push({ month: 11, day: thanks, text: `11月第4个周四感恩节（${year}年为11月${thanks}日）` });
  put(11, 11, '双十一');
  put(12, 12, '双十二');
  put(12, 25, '圣诞节');
  put(12, 31, '跨年夜');
  for (const [key, name] of lunarFestivalDatesOfYear(year)) {
    const [m, d] = key.split('-').map(Number);
    if (m != null && d != null) put(m, d, name);
  }
  entries.sort((a, b) => a.month - b.month || a.day - b.day);
  const lines = [
    `${entries.map((e) => e.text).join('；')}；10月1日-7日国庆节；7月-8月暑期。`,
    '其中 520、521、双十一、双十二为网络节日，也要能识别。',
  ].join('\n');
  festivalTableCache.set(year, lines);
  return lines;
}

// ---------------- 距离上次聊天 ----------------

/** 把毫秒间隔格式成「X 天 Y 小时 Z 分钟」（不足 1 分钟 → 「不足 1 分钟」） */
export function formatChatGap(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '不足 1 分钟';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (mins > 0) parts.push(`${mins} 分钟`);
  return parts.length > 0 ? parts.join(' ') : '不足 1 分钟';
}

// ---------------- 注入块 ----------------

export interface TimeAwareOptions {
  /** 该会话最后一条消息的时间戳（epoch ms）；缺省 / 0 = 第一次聊天 */
  lastMsgTime?: number | null;
  /** 角色所在地区（人设 grounding，可空 —— 内化协议中「城市·具体地点」的参考） */
  regionHint?: string | null;
  /** 当前时间（epoch ms），默认读取系统时钟 */
  now?: number;
}

/**
 * 构建注入 system 消息的时间感知块（开关由调用方判断 —— 关闭时不调用/不注入）。
 * 全部内容为内部参考协议：AI 需内化时间概念并自然体现，禁止输出时间戳卡片或机械复述。
 */
export function buildTimeAwareBlock(opts: TimeAwareOptions = {}): string {
  const now = opts.now ?? Date.now();
  const t = toBjTime(now);
  const festivals = getFestivals(t.year, t.month, t.day);
  const todayLine = festivals.length > 0 ? `今天是：${festivals.join('、')}。` : '今天是：无特殊节日。';
  const gap =
    opts.lastMsgTime && opts.lastMsgTime > 0
      ? // 【100-c】消息时间超前设备时间（时钟回拨/导入旧数据）时按 0 间隔处理——
        // 现兜底成「第一次聊天」是错误事实；formatChatGap 对 <1 分钟统一回「不足 1 分钟」
        `距离上次聊天：${formatChatGap(Math.max(0, now - opts.lastMsgTime))}`
      : '距离上次聊天：这是第一次聊天';
  const regionLine = opts.regionHint
    ? `（角色所在地区参考：${opts.regionHint}；具体地点按人设与当前时间合理生成）`
    : '';
  const hh = `${t.hour}`.padStart(2, '0');
  const mm = `${t.minute}`.padStart(2, '0');
  const ss = `${t.second}`.padStart(2, '0');

  // 性能（token 精简）：月份天数表/日期运算规则段删除——月份天数是模型常识，
  // 当前日期已注入后 LLM 可自行推算，原先每轮固定多带 ~300 字符

  // v63 全局预设管理器：时间感知块接入注册表（time-aware-block，可开关/可编辑；原文零破坏）
  const nowLine = `当前时间：${t.year}年${t.month}月${t.day}日 星期${t.week} ${hh}:${mm}:${ss}（北京时间，UTC+8）。${todayLine}${gap}。当前季节是${getSeason(t.month)}。`;
  return (
    promptTextOf(
      'time-aware-block',
      { nowLine, region: regionLine, festivalTable: festivalTableTextOfYear(t.year) },
      [
    '【时间感知】（内部参考：以下时间信息只用于你内部辅助判断，绝对禁止把时间戳卡片作为消息输出，不要机械复述时间，也不要在每条回复里硬提时间）',
    nowLine,
    '（若你的人设住在国外，按TA所在时区理解日期与作息：问候、节日、饭点按当地时间。）',
    '【事件时长感知规则】',
    '角色在提及正在进行某项活动时，必须意识到该活动需要消耗真实时间。对照上下文里「距离上次聊天」显示的跨度，按常识判断该事件是否已完成：隔了一夜、过了饭点、隔了工作日这类跨度，很多事已经自然完成并可以往下聊；只隔了片刻则可能仍在进行中。跨度只需按常识大致把握（一夜/一顿饭/一个工作日的量级），不要凭空精确计算过去了多少分钟；角色在说出任何事件耗时之前，必须先自行验证该时长是否符合现实常识。',
    '【场所营业状态】',
    '角色提及任何场所的营业状态时，应基于中国大陆常见营业时间判断，不得随意编造。若当前日期命中节日，角色应意识到部分场所可能放假或缩短营业时间，并自然体现。',
    '【常见事件时长参照】',
    '常见事件时长按日常常识把握（做饭半小时级、通勤半小时级、看剧 40-60 分钟等），禁止凭空夸大或缩短；涉及距离或路程时按实际距离估算，无法确定时取偏短的常见值。',
    '【时间内化（组织每条回复前在心里过一遍，不要在回复里输出任何形式的时间标注）】',
    `回复前先确认：今天的年月日、星期、大致时刻、季节，以及你们此刻可能所处的场所；让回复与这个时间点自洽——深夜别道早安、工作日白天别问周末玩得怎样、跨了年要意识到又长了一岁；也绝不把任何时间戳、日期格式的文本写进回复正文。${regionLine}`,
    `【节日对照表（${t.year}年，公历）】`,
    festivalTableTextOfYear(t.year),
    '请结合以上时间信息自然回复，让回复与真实的时间流逝、事件时长相符。',
  ].join('\n'),
    ) ?? ''
  );
}
