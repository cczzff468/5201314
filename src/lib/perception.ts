'use client';

/**
 * 感知设置：让 AI 感知真实世界的一组开关 + 上下文块构建 —— v1.9.35 真机感知（ActivityWatch/
 * APP 原生 UsageStats）随真机操控一起退役，只保留网页内可用的感知项。
 *
 * 数据源（用户在「聊天设置 › 感知设置」按会话开关，localStorage 单键 JSON map
 * chat-perception-v1 持久化，经 scopedConvKey 按账号隔离，默认全关）：
 *  - 打字思考感知：用户回复前「思考+打字」耗时（AI 上一条回复落地 → 本次发送；
 *    其中「纯打字」时段从输入框首次键入起算）；
 *  - 电量感知：真实设备电量/充电状态（Battery Status API，@/lib/ios/battery）；
 *  - 日历/节假日感知：公历+农历日期、星期、节假日、最近节日倒计时（复用 time-aware 的节日算法）；
 *  - 天气感知：用户所在地 + 角色所在地两处天气（Open-Meteo 代理 + 城市搜索，30 分钟缓存）；
 *  - 看屏幕（VLM）：串流地址或浏览器屏幕分享抓帧 → 识图描述（@/lib/ios/screen-share）。
 *
 * 采集范式（与 crossCtxRef 同款）：runAiTurn 是同步函数不能 await ——
 * 聊天页挂载时与每轮发送后 fire-and-forget 预热（prewarmPerception），
 * 构建 prompt 块时同步读缓存（buildPerceptionBlock，发送瞬间现场读取，开关即时生效）。
 *
 * 块文案协议：内部参考、禁止播报式罗列；AI 按人设与记忆在自然时机克制地使用。
 */

import { toBjTime, getFestivals } from './time-aware';
import { solarToLunar } from './ios/lunar';
import { getBatterySnapshot } from './ios/battery';
import { getCachedScreenDescription, refreshScreenDescription } from './ios/screen-share';
import { promptTextOf } from '@/lib/prompt-entries';
import { scopedConvKey } from './ios/accounts';
import { searchCity, fetchWeather, weatherCodeInfo } from '@/components/apps/weather-core';

// ---------------- 配置存取 ----------------

export interface PerceptionConfig {
  /** 打字思考感知：AI 感知用户回复前思考+打字了多久 */
  typing: boolean;
  /** 电量感知：AI 知道用户当前设备电量与充电状态 */
  battery: boolean;
  /** 日历/节假日感知：日期星期农历节假日 + 最近节日倒计时 */
  calendar: boolean;
  /** 天气感知开关 */
  weather: boolean;
  /** 用户所在地（天气查询用，自由文本城市名） */
  userLoc: string;
  /** 角色（TA）所在地（天气查询用，自由文本城市名） */
  aiLoc: string;
  /** 看屏幕（VLM）：发送时抓一帧让 AI「看到」屏幕 */
  vlmScreen: boolean;
  /** 屏幕串流地址（串流工具的 MJPEG/单帧 JPEG 地址；空 = 用浏览器屏幕分享） */
  streamUrl: string;
}

const STORE_KEY = 'chat-perception-v1';

const DEFAULT_CFG: PerceptionConfig = {
  typing: false,
  battery: false,
  calendar: false,
  weather: false,
  userLoc: '',
  aiLoc: '',
  vlmScreen: false,
  streamUrl: '',
};

// 布尔/字符串键分桶派生：out[k] 以联合键写入时 TS 会把写入类型算成各属性类型交集（boolean & string = never），
// 按值类型分桶后每桶写入类型才是 boolean / string
type BoolCfgKey = { [K in keyof PerceptionConfig]: PerceptionConfig[K] extends boolean ? K : never }[keyof PerceptionConfig];
type StrCfgKey = { [K in keyof PerceptionConfig]: PerceptionConfig[K] extends string ? K : never }[keyof PerceptionConfig];

const BOOL_KEYS: BoolCfgKey[] = ['typing', 'battery', 'calendar', 'weather', 'vlmScreen'];
const STR_KEYS: StrCfgKey[] = ['userLoc', 'aiLoc', 'streamUrl'];

function sanitize(v: unknown): PerceptionConfig {
  const out = { ...DEFAULT_CFG };
  if (typeof v !== 'object' || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const k of BOOL_KEYS) {
    const val = o[k];
    if (typeof val === 'boolean') out[k] = val;
  }
  for (const k of STR_KEYS) {
    const val = o[k];
    if (typeof val === 'string') out[k] = val.slice(0, 300);
  }
  return out;
}

function loadMap(): Record<string, PerceptionConfig> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, PerceptionConfig> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = sanitize(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的感知配置（未设置 = 全关；会话键按账号作用域隔离） */
export function getPerception(sessionKey: string): PerceptionConfig {
  return loadMap()[scopedConvKey(sessionKey)] ?? { ...DEFAULT_CFG };
}

/** 保存某会话的感知配置（合并写入；立即生效，下一次请求现场读取） */
export function setPerception(sessionKey: string, patch: Partial<PerceptionConfig>): void {
  if (typeof window === 'undefined') return;
  const key = scopedConvKey(sessionKey);
  const map = loadMap();
  map[key] = { ...map[key], ...patch };
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* 持久化失败忽略 */
  }
}

/** 任一感知项开启 */
export function perceptionAnyOn(cfg: PerceptionConfig): boolean {
  return cfg.typing || cfg.battery || cfg.calendar || cfg.weather || cfg.vlmScreen;
}

/** 已开启项数（设置入口行摘要用） */
export function perceptionOnCount(cfg: PerceptionConfig): number {
  return (BOOL_KEYS as (keyof PerceptionConfig)[]).filter((k) => cfg[k] === true).length;
}

/** 设置入口行摘要文案 */
export function perceptionSummary(sessionKey: string): string {
  const cfg = getPerception(sessionKey);
  const n = perceptionOnCount(cfg);
  return n === 0 ? '未开启' : `已开启 ${n} 项`;
}

// ---------------- 打字思考计时（模块级，页会话内有效） ----------------

const typingStartAt = new Map<string, number>();
const aiReplyEndAt = new Map<string, number>();

/** 输入框首次键入（onChange 调用；已有记录跳过 —— 记「纯打字」起点） */
export function markTypingStart(sessionKey: string): void {
  const key = scopedConvKey(sessionKey);
  if (!typingStartAt.has(key)) typingStartAt.set(key, Date.now());
}

/** AI 回复落地（finalize 调用；作为用户「思考+打字」计时的基线） */
export function markAiReplyEnd(sessionKey: string): void {
  aiReplyEndAt.set(scopedConvKey(sessionKey), Date.now());
}

/** 取走本回合的打字耗时（构建感知块时调用；读后清零防重复消费） */
function consumeTypingInfo(sessionKey: string, fallbackLastMsgTime: number | null): { totalMs: number; typingMs: number | null } | null {
  const key = scopedConvKey(sessionKey);
  const start = typingStartAt.get(key);
  typingStartAt.delete(key);
  const base = aiReplyEndAt.get(key) ?? (fallbackLastMsgTime && fallbackLastMsgTime > 0 ? fallbackLastMsgTime : 0);
  if (!base) return null;
  const now = Date.now();
  const total = Math.max(0, now - base);
  if (total < 1500) return null; // 1.5 秒内无感知意义
  const typingMs = start ? Math.max(0, now - start) : null;
  return { totalMs: total, typingMs: typingMs !== null && typingMs > 800 ? typingMs : null };
}

// ---------------- 天气（30 分钟缓存 + 失败退避 + 并发去重） ----------------

interface WeatherCacheEntry {
  pick?: { lat: number; lon: number; name: string };
  line?: string;
  ts?: number;
  failTs?: number;
}

const WEATHER_KEY = 'perception-weather-v1';
const WEATHER_TTL = 30 * 60_000;
const WEATHER_FAIL_BACKOFF = 2 * 60_000;
const weatherInflight = new Map<string, Promise<string | null>>();

function loadWeatherCache(): Record<string, WeatherCacheEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WEATHER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, WeatherCacheEntry>;
  } catch {
    return {};
  }
}

function saveWeatherCacheEntry(loc: string, entry: WeatherCacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const map = loadWeatherCache();
    map[loc] = entry;
    window.localStorage.setItem(WEATHER_KEY, JSON.stringify(map));
  } catch {
    /* 忽略 */
  }
}

/** 取某地的天气行（缓存新鲜直接回；否则 geocode → Open-Meteo → 「城市：天气 X°C（…）」） */
export async function weatherLineFor(locRaw: string): Promise<string | null> {
  const loc = locRaw.trim();
  if (!loc) return null;
  const running = weatherInflight.get(loc);
  if (running) return running;
  const job = (async (): Promise<string | null> => {
    const cache = loadWeatherCache()[loc];
    if (cache?.line && cache.ts && Date.now() - cache.ts < WEATHER_TTL) return cache.line;
    if (cache?.failTs && Date.now() - cache.failTs < WEATHER_FAIL_BACKOFF) return cache.line ?? null;
    try {
      let pick = cache?.pick;
      if (!pick) {
        const results = await searchCity(loc);
        if (!results || results.length === 0) {
          saveWeatherCacheEntry(loc, { ...cache, failTs: Date.now() });
          return cache?.line ?? null;
        }
        const r = results[0];
        pick = { lat: r.latitude, lon: r.longitude, name: r.name || loc };
      }
      const data = await fetchWeather(pick.lat, pick.lon, pick.name);
      const cur = data.current;
      const day = Array.isArray(data.daily) ? data.daily[0] : undefined;
      const label = weatherCodeInfo(cur.code).label;
      const line =
        `${pick.name} ${label} ${Math.round(cur.temperature)}°C` +
        `（体感 ${Math.round(cur.apparent)}°C${day ? `，今日 ${Math.round(day.min)}~${Math.round(day.max)}°C` : ''}，湿度 ${Math.round(cur.humidity)}%）`;
      saveWeatherCacheEntry(loc, { pick, line, ts: Date.now() });
      return line;
    } catch {
      saveWeatherCacheEntry(loc, { ...cache, failTs: Date.now() });
      return cache?.line ?? null;
    }
  })().finally(() => {
    weatherInflight.delete(loc);
  });
  weatherInflight.set(loc, job);
  return job;
}

// ---------------- 预热（挂载时 + 每轮发送后 fire-and-forget） ----------------

/** 预热感知数据（聊天页挂载 / 设置保存 / 每轮 runAiTurn 开头调用；失败静默） */
export async function prewarmPerception(sessionKey: string): Promise<void> {
  const cfg = getPerception(sessionKey);
  if (!perceptionAnyOn(cfg)) return;
  const jobs: Promise<unknown>[] = [];
  if (cfg.weather) {
    if (cfg.userLoc.trim()) jobs.push(weatherLineFor(cfg.userLoc).catch(() => null));
    if (cfg.aiLoc.trim()) jobs.push(weatherLineFor(cfg.aiLoc).catch(() => null));
  }
  if (cfg.vlmScreen) jobs.push(refreshScreenDescription(cfg.streamUrl).catch(() => null));
  if (jobs.length === 0) return;
  await Promise.allSettled(jobs);
}

// ---------------- 格式化 ----------------

/** 时长（毫秒 → 「X秒 / X分钟 / X小时Y分」） */
function fmtDur(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} 小时${m % 60 > 0 ? ` ${m % 60} 分` : ''}` : `${m} 分钟`;
}

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

function lunarDayStr(day: number): string {
  if (day <= 10) return `初${'一二三四五六七八九十'[day - 1]}`;
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  if (day < 20) return `十${'一二三四五六七八九'[day - 11]}`;
  return `廿${'一二三四五六七八九'[day - 21]}`;
}

/** 日历/节假日行：公历日期星期 + 农历 + 今天节日 + 最近节日倒计时 */
function calendarLines(): string {
  const now = Date.now();
  const t = toBjTime(now);
  const fests = getFestivals(t.year, t.month, t.day).filter((f) => f !== '暑期');
  const lunar = solarToLunar(new Date(t.year, t.month - 1, t.day, 12));
  const lunarStr = `${lunar.leap ? '闰' : ''}${LUNAR_MONTHS[lunar.month - 1] ?? '?'}月${lunarDayStr(lunar.day)}`;
  const parts = [`今天是 ${t.year} 年 ${t.month} 月 ${t.day} 日 星期${t.week}（农历${lunarStr}）`];
  parts.push(fests.length > 0 ? `今天是${fests.join('、')}` : '今天不是节假日');
  // 最近节日（北京时间坐标向后扫 45 天）
  const bjBase = now + 8 * 3600 * 1000;
  for (let i = 1; i <= 45; i++) {
    const d = new Date(bjBase + i * 86_400_000);
    const fs = getFestivals(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).filter((f) => f !== '暑期');
    if (fs.length > 0) {
      parts.push(`最近的节日是${fs[0]}（${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日，还有 ${i} 天）`);
      break;
    }
  }
  return parts.join('；');
}

// ---------------- 感知块构建（发送瞬间现场读取，同步） ----------------

export interface PerceptionBlockOptions {
  /** 会话最后一条消息时间戳（打字计时兜底基线；AI 回复落地时间优先） */
  lastMsgTime?: number | null;
}

/**
 * 构建注入 system 的实时感知块（开关由数据决定：全关/无可用数据返回空串零成本）。
 * 读取的全是「发送瞬间」的现场值与预热缓存 —— 开关与数据即时生效。
 */
export function buildPerceptionBlock(sessionKey: string, opts: PerceptionBlockOptions = {}): string {
  const cfg = getPerception(sessionKey);
  // 打字计时读后清零（无论开关如何都消费，防止跨天陈旧值）
  const typing = consumeTypingInfo(sessionKey, opts.lastMsgTime ?? null);
  if (!perceptionAnyOn(cfg)) return '';
  const lines: string[] = [];

  if (cfg.calendar) lines.push(calendarLines());

  if (cfg.battery) {
    const b = getBatterySnapshot();
    if (b) lines.push(`用户当前设备电量：${Math.round(b.level)}%，${b.charging ? '正在充电' : '未接电源'}`);
  }

  if (cfg.typing && typing) {
    // ≥24h 的间隔交给时间感知块的「距上次聊天」，这里只报「思考+打字」量级
    if (typing.totalMs < 24 * 3600_000) {
      let s = `用户这条回复前思考+打字共用了 ${fmtDur(typing.totalMs)}`;
      if (typing.typingMs && typing.typingMs < typing.totalMs - 2000) {
        s += `（其中打字约 ${fmtDur(typing.typingMs)}，其余是在想怎么回）`;
      }
      lines.push(s);
    }
  }

  if (cfg.weather) {
    const cache = loadWeatherCache();
    const userLine = cfg.userLoc.trim() ? cache[cfg.userLoc.trim()]?.line : undefined;
    const aiLine = cfg.aiLoc.trim() ? cache[cfg.aiLoc.trim()]?.line : undefined;
    if (userLine) lines.push(`用户所在地天气：${userLine}`);
    if (aiLine) lines.push(`你（角色）所在地天气：${aiLine}`);
  }

  if (cfg.vlmScreen) {
    const desc = getCachedScreenDescription(cfg.streamUrl);
    if (desc) lines.push(`用户此刻的屏幕画面（系统实时截取）：${desc}`);
  }

  if (lines.length === 0) return '';
  const linesText = lines.join('\n');
  return (
    promptTextOf(
      'perception-block',
      { lines: linesText },
      [
        '【实时感知】（内部参考：以下是系统在用户发送本条消息的瞬间现场采集的真实数据，只作你内部的判断依据，绝对禁止把下面任何一条当作数据播报或机械罗列。请结合你的人设、记忆和当前对话语境，像真正在意对方的人一样，只在自然合适的时机用上一两条——例如TA在真机上玩游戏很久没回消息时可以自然地在意一下，天气冷了提醒穿衣，深夜还亮着屏幕时催TA睡觉，电量低了提醒充电，TA回得慢时体谅TA刚才可能在忙。宁可不提也不要硬提，更不要一次性全说。唯一例外：用户直接问起某项情况（如「你知道我在玩什么吗」「我屏幕用了多久」）时，若上面有对应数据，必须如实、自然地回答，不许说不知道；没有的数据才按未知处理。）',
        linesText,
        '（以上数据是采样快照，可能缺失或滞后；没有提到的项按未知处理，禁止编造。）',
      ].join('\n'),
    ) ?? ''
  );
}
