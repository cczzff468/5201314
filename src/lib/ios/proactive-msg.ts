'use client';

/**
 * AI 主动发消息调度（Task 49）——让 AI 在用户没说话时也能主动开口：
 *
 * 四种触发（每个角色独立设置，微信/QQ/信息三端 1:1 会话）：
 * ① 定时触发：用户为角色设置「主动发消息间隔」（30s~24h+自定义），到点 AI 按人设/记忆/上下文生成一条消息；
 * ② 事件触发：用户自定义事件（名称 + 可选时间 HH:mm + 星期几），到条件时间 AI 结合事件生成消息；
 * ③ 自主触发：不给时间不给事件，AI 按人设/记忆/上下文/当前时间自行决定 发不发/什么时候发/发什么；
 * ④ 定时提醒：用户在聊天里说「几分钟后给我发消息」「每天 8 点给我发消息」「每隔 1 小时发一次」，
 *    AI 解析成定时任务（reminder），到点执行（生成消息时以任务内容为指令上下文）。
 *
 * 调度引擎：ProactiveMsgWatcher（PhoneShell 挂载）每 5s 调 runProactiveMsgTick()：
 * 守卫（来电/通话/闹钟互斥）→ 枚举索引（配置过的 app×联系人）→ 逐条判定四类触发 → 生成 → 投递。
 *
 * 投递：复用 ai-delivery 管线（scheduleAiDelivery 逐条节奏）+ pushChatNotification（灵动岛/横幅/系统通知）
 * + 未读角标（wx/qq；用户正在该会话内不计数）+ memAfterAiTurn（主动消息同样写入记忆管线）。
 *
 * 多账号（Task 40-47 架构延续）：设置/执行记录/提醒任务全部经 scopedKvKey 按「对应 App 当前账号」隔离；
 * 引擎只对当前活跃账号的配置生效（切号后另一账号的主动消息自然停发）。
 */

import { genId } from './db';
import { kvGet, kvSet, kvDel, kvGetRaw, kvSetRaw } from './idb-kv';
import { getActiveAccountIdFor, scopedKvKey, type AccountApp } from './accounts';
import { listContacts, ownerProfileFor, cachedOwnerName } from './contacts-store';
import { avatarFor, type ContactAvatarApp, type ContactRecord } from '@/lib/contacts';
import { buildPersonaSystemPrompt } from './persona';
// 第十六轮：AI 动态状态（情绪+作息）——主动消息也带着当前心情、按作息拿撑时机
import { buildDynamicStateBlocks } from './ai-mood';
// v51 焦虑值系统：阈值触发（焦虑值 ≥ 阈值且用户超时未回复 → 带着焦虑主动发消息）
import {
  anxietyOf,
  readAnxiety,
  noteAnxietyFire,
  buildAnxietyFireBlock,
  ANXIETY_DEFAULT_THRESHOLD,
  ANXIETY_DEFAULT_GRACE_MS,
  ANXIETY_DEFAULT_SEND_MS,
} from './anxiety';
import { buildNpcPromptExtra } from './npc-bond';
import { loadBlock } from './block-state';
import { isDndWindowActive } from './notify-sound';
import { getMemSettings, memChatRecallBlock, memAfterAiTurn, memConvoFromRaw } from '@/lib/memory';
import { buildMomentsChatBlock } from '../moments';
import { buildCrossAppBlock } from './cross-app-context';
import { buildTimeAwareBlock, getTimeAware } from '@/lib/time-aware';
import { extractThinkBlocks } from '@/lib/think-filter';
import { scheduleAiDelivery } from './ai-delivery';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { useSettings, useUI } from './store';
import { useIncomingCall } from './incoming-call';
import { useGlobalCall } from './global-call';
import type { ApiConfig } from './store';

// ---------------- 类型与常量 ----------------

/** 主动发消息作用的聊天端（1:1 会话；群聊走各自管线不在本模块范围） */
export type ProactiveApp = 'wx' | 'qq' | 'sms';

/** 单条触发事件：名称 + 可选时间（HH:mm）+ 星期几（0=周日；空数组=每天） */
export interface ProactiveEvent {
  id: string;
  /** 事件描述（如「下班路上」「午休结束」），生成消息时作为情境注入 */
  name: string;
  /** 触发时间 'HH:mm'；空串 = 不按时间触发（仅展示，不自动发） */
  time: string;
  /** 生效星期（0~6）；空数组 = 每天 */
  days: number[];
  enabled: boolean;
}

/** 单个角色的主动发消息配置（三模式独立开关 + v51 焦虑关怀） */
export interface ProactiveMsgConfig {
  /** 定时触发 */
  timerOn: boolean;
  /** 定时模式：按间隔（默认）| 每天定时（对齐钟表时刻；Task 51 B3） */
  timerMode?: 'interval' | 'daily';
  /** 定时间隔（毫秒；最小 3s——用户自定义秒级要真实生效（用户反馈：写 5 秒不能被改成 15 秒），UI 档位 30s~24h+自定义） */
  timerMs: number;
  /** timerMode=daily 时的每天发送时刻 'HH:mm' */
  timerDailyTime?: string;
  /** 事件清单 */
  events: ProactiveEvent[];
  /** 自主触发（AI 自己决定发不发/何时发/发什么） */
  autoOn: boolean;
  /** 自主决策节奏（分钟；Task 51 B4 可调，默认 5） */
  autoFreqMin?: number;
  /** v51 焦虑关怀：焦虑值 ≥ 阈值且用户超时未回复 → 带着焦虑主动发消息（默认开启） */
  anxietyOn?: boolean;
  /** 焦虑触发阈值（0~100，默认 70） */
  anxietyThreshold?: number;
  /** 未回复宽限时间（毫秒，默认 60s = 1 分钟；超过后开始涨焦虑/可触发） */
  anxietyGraceMs?: number;
  /** 焦虑消息发送节奏（毫秒，默认 60s = 1 分钟一条；规格约定不开放 UI 自定义） */
  anxietySendMs?: number;
}

/** 定时提醒任务（自然语言解析产物） */
export interface ProactiveReminder {
  id: string;
  app: ProactiveApp;
  /** 目标联系人 id */
  cid: string;
  kind: 'once' | 'daily' | 'interval';
  /** once：绝对触发时间（epoch ms） */
  at?: number;
  /** daily：每天触发时刻 'HH:mm' */
  dailyTime?: string;
  /** interval：循环间隔毫秒 */
  intervalMs?: number;
  /** 用户原话（生成消息时的指令上下文，如「提醒我喝水」） */
  note: string;
  createdAt: number;
  /** 上次执行时间（daily/interval 防重；once 触发后任务删除） */
  lastFiredAt?: number;
  firedCount?: number;
}

const CFG_KEY_PREFIX = 'proactive-msg-cfg:';
const LAST_KEY_PREFIX = 'proactive-msg-last:';
const REMINDERS_KEY = 'proactive-msg-reminders';
/** 索引（设备级）：配置过的 {app, cid} 全集；引擎按当前账号读 scoped 配置，无配置自然跳过 */
const INDEX_KEY = 'proactive-msg-index';
/** 最近主动消息历史（按联系人，Task 51 C2） */
const HIST_KEY_PREFIX = 'proactive-msg-hist:';
/** 全局总开关（设备级，Task 51 B2）：true = 所有角色暂停主动发消息（一键全停） */
const MASTER_OFF_KEY = 'proactive-msg-master-off';

/** tick 周期：自定义间隔已放开到秒级（最短 3s），5s 轮询保证 5s 级短间隔真实生效（误差 ≤5s；
 *  索引内联系人逐个读 kv 内存缓存 + 消息数组解析，开销可控） */
export const PROACTIVE_MSG_TICK_MS = 5_000;
/** 到期触发宽限：定时/事件错过 tick（浏览器休眠等）在宽限窗口内仍补发一次 */
const FIRE_GRACE_MS = 90_000;
/** 每日类触发（事件/daily 提醒/每天定时刻）宽限：错过精确分钟（页面没开/休眠）在 N 分钟内仍补发一次（Task 51 A1） */
const SCHEDULED_GRACE_MIN = 5;
/** 对话活跃守卫（Task 51 B1）：最近有消息往来时跳过定时/自主触发，避免打断正在进行的聊天 */
const CONVO_ACTIVE_MS = 120_000;
/** 自主决策间隔基准：每个开启自主模式的角色约每 5 分钟做一次「要不要主动发」决策（可经 autoFreqMin 调整） */
const AUTO_DECIDE_BASE_MS = 5 * 60_000;
/** 自主模式夜间静默：本地时间 23:00–次日 8:00 不自主发起（B1 统一口径——与主动来电硬闸
 *  [23,8) 和来电决策 prompt「23 点到早 8 点不打」完全一致；定时/事件/提醒是用户明确意图，不受此限；
 *  系统免打扰时段（设置›通知的 DND）另行拦住自主触发，见 tickInner ④） */
const AUTO_QUIET_START_HOUR = 23;
const AUTO_QUIET_END_HOUR = 8;
/** A3：同角色任意主动消息最小发送间隔——此前 sentAt 落库但零读取，「定时30s+提醒+事件+自主」
 *  各通道独立到期可在相邻 tick（5s）背靠背连发；45s 是防轰炸下限（用户配 30s 定时实际约 45-50s 一条） */
const MIN_SEND_GAP_MS = 45_000;
/** C7：once 提醒迟到补发上限——页面长时间没开后，超过该时长的过期提醒静默丢弃（「3 天后的喝水提醒」是噪声） */
const REMINDER_LATE_MAX_MS = 24 * 60 * 60_000;
/** 自主 wait 建议的下次决策延迟上下限（分钟） */
const AUTO_WAIT_MIN_MINUTES = 5;
const AUTO_WAIT_MAX_MINUTES = 120;
/** 生成消息的最大长度（超出截断；主动消息就该短） */
const MAX_PROACTIVE_LEN = 220;

const DEFAULT_CFG: ProactiveMsgConfig = { timerOn: false, timerMode: 'interval', timerMs: 5 * 60_000, timerDailyTime: '', events: [], autoOn: false, autoFreqMin: 5 };

// ---------------- 全局总开关（Task 51 B2：设备级，一键全停所有角色） ----------------

/** 主动消息是否被全局暂停（设置页里的总开关；设备级，不分账号） */
export function isProactiveMasterOff(): boolean {
  try {
    return kvGetRaw(MASTER_OFF_KEY) === true;
  } catch {
    return false;
  }
}

/** 设置全局总开关（true=暂停全部主动发消息） */
export function setProactiveMasterOff(v: boolean): void {
  try {
    kvSetRaw(MASTER_OFF_KEY, v === true);
  } catch {
    /* 静默 */
  }
}

// ---------------- 配置存储（按 App 当前账号作用域） ----------------

function cfgKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${CFG_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function sanitizeCfg(raw: unknown): ProactiveMsgConfig {
  const r = (raw ?? {}) as Partial<ProactiveMsgConfig>;
  const events = Array.isArray(r.events)
    ? r.events
        .filter((e): e is ProactiveEvent => Boolean(e) && typeof (e as ProactiveEvent).id === 'string')
        .map((e) => ({
          id: e.id,
          name: typeof e.name === 'string' ? e.name.slice(0, 120) : '',
          time: typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) ? e.time : '',
          days: Array.isArray(e.days) ? e.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7) : [],
          enabled: e.enabled === true,
        }))
        .slice(0, 20)
    : [];
  // 用户反馈：自定义 5 秒被强顶成 15 秒——下限降到 3s（低于 3s 的极端值才收敛），写多少就是多少
  const timerMs = typeof r.timerMs === 'number' && Number.isFinite(r.timerMs) ? Math.max(3_000, Math.min(r.timerMs, 7 * 24 * 3600_000)) : DEFAULT_CFG.timerMs;
  const autoFreqMin = typeof r.autoFreqMin === 'number' && Number.isFinite(r.autoFreqMin) ? Math.max(2, Math.min(Math.round(r.autoFreqMin), 120)) : 5;
  // v51 焦虑关怀：缺省 = 开启（用户需求：焦虑值驱动主动发消息开箱即用）；阈值默认 70%
  const anxietyThreshold =
    typeof r.anxietyThreshold === 'number' && Number.isFinite(r.anxietyThreshold)
      ? Math.max(30, Math.min(Math.round(r.anxietyThreshold), 100))
      : ANXIETY_DEFAULT_THRESHOLD;
  const anxietyGraceMs =
    typeof r.anxietyGraceMs === 'number' && Number.isFinite(r.anxietyGraceMs)
      ? Math.max(15_000, Math.min(r.anxietyGraceMs, 24 * 3600_000))
      : ANXIETY_DEFAULT_GRACE_MS;
  const anxietySendMs =
    typeof r.anxietySendMs === 'number' && Number.isFinite(r.anxietySendMs)
      ? Math.max(30_000, Math.min(r.anxietySendMs, 24 * 3600_000))
      : ANXIETY_DEFAULT_SEND_MS;
  return {
    timerOn: r.timerOn === true,
    timerMode: r.timerMode === 'daily' ? 'daily' : 'interval',
    timerMs,
    timerDailyTime: typeof r.timerDailyTime === 'string' && /^\d{2}:\d{2}$/.test(r.timerDailyTime) ? r.timerDailyTime : '',
    events,
    autoOn: r.autoOn === true,
    autoFreqMin,
    anxietyOn: r.anxietyOn !== false,
    anxietyThreshold,
    anxietyGraceMs,
    anxietySendMs,
  };
}

/** 读某角色当前账号下的主动发消息配置（无记录 = 全关默认值） */
export function getProactiveCfg(app: ProactiveApp, cid: string): ProactiveMsgConfig {
  return sanitizeCfg(kvGet<unknown>(cfgKeyOf(app, cid)));
}

/** 写配置（同时维护索引） */
export function setProactiveCfg(app: ProactiveApp, cid: string, cfg: ProactiveMsgConfig): void {
  kvSet(cfgKeyOf(app, cid), sanitizeCfg(cfg));
  upsertIndex(app, cid);
}

/** 配置是否有任何生效中的触发（v51：焦虑关怀默认开启也算生效——呼吸灯亮） */
export function cfgHasActiveTrigger(cfg: ProactiveMsgConfig): boolean {
  return cfg.timerOn || cfg.autoOn || cfg.anxietyOn !== false || cfg.events.some((e) => e.enabled);
}

/** 设置页入口行摘要（如「定时 5 分钟 · 焦虑 70」；全关 = 「未开启」） */
export function proactiveCfgSummary(app: ProactiveApp, cid: string): string {
  let cfg: ProactiveMsgConfig;
  try {
    cfg = getProactiveCfg(app, cid);
  } catch {
    return '未开启';
  }
  const parts: string[] = [];
  if (cfg.timerOn) parts.push(cfg.timerMode === 'daily' && cfg.timerDailyTime ? `每天 ${cfg.timerDailyTime}` : `定时${intervalLabel(cfg.timerMs)}`);
  const evtOn = cfg.events.filter((e) => e.enabled).length;
  if (evtOn > 0) parts.push(`事件 ${evtOn}`);
  if (cfg.autoOn) parts.push('自主');
  // v51 焦虑关怀摘要（开启才显示；默认开 → 入口行可见「焦虑 70」）
  if (cfg.anxietyOn !== false) parts.push(`焦虑 ${cfg.anxietyThreshold ?? ANXIETY_DEFAULT_THRESHOLD}`);
  return parts.length > 0 ? parts.join(' · ') : '未开启';
}

/** 间隔毫秒 → 中文短标签（设置页/摘要共用） */
export function intervalLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分钟`;
  const h = m / 60;
  if (h < 24 && Number.isInteger(h)) return `${h}小时`;
  if (h < 24) return `${(s / 3600).toFixed(1)}小时`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d}天` : `${(h / 24).toFixed(1)}天`;
}

// ---------------- 索引（设备级 {app,cid} 全集） ----------------

interface IndexEntry {
  app: ProactiveApp;
  cid: string;
}

function readIndex(): IndexEntry[] {
  const raw = kvGet<IndexEntry[]>(INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!e || (e.app !== 'wx' && e.app !== 'qq' && e.app !== 'sms') || typeof e.cid !== 'string' || !e.cid) continue;
    const k = `${e.app}:${e.cid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ app: e.app, cid: e.cid });
  }
  return out;
}

function upsertIndex(app: ProactiveApp, cid: string): void {
  const list = readIndex();
  if (list.some((e) => e.app === app && e.cid === cid)) return;
  list.push({ app, cid });
  kvSet(INDEX_KEY, list.slice(-200));
}

function removeFromIndex(app: ProactiveApp, cid: string): void {
  kvSet(INDEX_KEY, readIndex().filter((e) => !(e.app === app && e.cid === cid)));
}

// ---------------- 执行记录（防重复触发；按账号作用域） ----------------

interface LastFireRecord {
  /** 定时模式上次触发时间 */
  timerAt?: number;
  /** 事件模式上次触发（key=事件 id，value=触发的分钟戳 Math.floor(now/60000)） */
  evtAt?: Record<string, number>;
  /** 自主模式上次决策时间 */
  autoAt?: number;
  /** 最近一次主动消息正文（生成时防重复） */
  lastSentText?: string;
  /** 最近一次主动消息时间 */
  sentAt?: number;
}

function lastKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${LAST_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function getLast(app: ProactiveApp, cid: string): LastFireRecord {
  const raw = kvGet<LastFireRecord>(lastKeyOf(app, cid));
  return raw && typeof raw === 'object' ? raw : {};
}

function setLast(app: ProactiveApp, cid: string, patch: LastFireRecord): void {
  kvSet(lastKeyOf(app, cid), { ...getLast(app, cid), ...patch });
}

// ---------------- 提醒任务（按 App 账号作用域存数组） ----------------

function remindersKeyOf(app: ProactiveApp): string {
  return scopedKvKey(REMINDERS_KEY, app as AccountApp);
}

function readReminders(app: ProactiveApp): ProactiveReminder[] {
  const raw = kvGet<ProactiveReminder[]>(remindersKeyOf(app));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ProactiveReminder =>
      Boolean(r) &&
      typeof (r as ProactiveReminder).id === 'string' &&
      typeof (r as ProactiveReminder).cid === 'string' &&
      ((r as ProactiveReminder).kind === 'once' || (r as ProactiveReminder).kind === 'daily' || (r as ProactiveReminder).kind === 'interval'),
  );
}

function writeReminders(app: ProactiveApp, list: ProactiveReminder[]): void {
  kvSet(remindersKeyOf(app), list.slice(-50));
}

/** 某角色的提醒任务清单（设置页展示/管理用） */
export function remindersFor(app: ProactiveApp, cid: string): ProactiveReminder[] {
  try {
    return readReminders(app)
      .filter((r) => r.cid === cid)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function addReminder(app: ProactiveApp, r: ProactiveReminder): void {
  const list = readReminders(app).filter((x) => x.id !== r.id);
  list.push(r);
  writeReminders(app, list);
  upsertIndex(app, r.cid);
}

export function removeReminder(app: ProactiveApp, id: string): void {
  writeReminders(
    app,
    readReminders(app).filter((r) => r.id !== id),
  );
}

/** 提醒任务摘要（设置页/系统行共用） */
export function reminderLabel(r: ProactiveReminder): string {
  if (r.kind === 'once' && typeof r.at === 'number') {
    const d = new Date(r.at);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`} ${hm}`;
  }
  if (r.kind === 'daily' && r.dailyTime) return `每天 ${r.dailyTime}`;
  if (r.kind === 'interval' && r.intervalMs) return `每隔${intervalLabel(r.intervalMs)}`;
  return '定时任务';
}

// ---------------- 自然语言 → 提醒任务（四、定时提醒） ----------------

/** 快速正则闸：命中才走 LLM 解析（其他消息零开销） */
const REMINDER_HINT_RE = /(分钟后|小时后|分之后|小时之后|每天|每日|每隔|每天几点|提醒我|叫我|喊我|给我发|发消息给我|发个消息|发条消息)/;
const REMINDER_ACTION_RE = /(发消息|发个消息|发条消息|消息|提醒|叫我|喊我|问候|说句话|聊天)/;

/** 用户这句话像不像「让 AI 定时发消息」的指令（≤60 字短句 + 提醒/发消息 + 时间词） */
export function reminderHintHit(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 60) return false;
  return REMINDER_HINT_RE.test(t) && REMINDER_ACTION_RE.test(t);
}

interface ReminderParseResult {
  match: boolean;
  kind?: 'once' | 'daily' | 'interval';
  /** once：多少分钟后 */
  minutesLater?: number | null;
  /** daily：每天几点 'HH:mm' */
  dailyTime?: string | null;
  /** interval：每隔多少分钟 */
  intervalMinutes?: number | null;
  /** 任务内容摘要（如「提醒我喝水」；空 = 仅闲聊式问候） */
  note?: string | null;
}

const REMINDER_PARSE_SYSTEM = `你是一个定时任务解析器。用户正在和一个 AI 角色聊天，用户的话可能是「让 AI 在指定时间主动给我发消息」的指令。把它解析成结构化任务。

只输出一个 JSON 对象，格式：
{"match": true或false, "kind": "once"或"daily"或"interval", "minutesLater": 数字或null, "dailyTime": "HH:mm"或null, "intervalMinutes": 数字或null, "note": "任务内容摘要"}

判定规则：
1. match=false：不是定时发消息指令（普通聊天、问句、没有明确的时间意图）。
2. kind=once：一次性的（"3分钟后给我发消息"、"晚上8点提醒我……"、"20分钟以后叫我"）。minutesLater=从当前时间算起的分钟数：能精确到今天某时刻就换算成分钟差；如果那个时刻今天已经过了（如现在 21 点说"晚上8点提醒我"），按明天同一时刻换算（加 1440 分钟）；必须为正数，不允许负数或零。
3. kind=daily：每天重复（"以后每天早上8点给我发消息"、"每天晚上10点说晚安"）。dailyTime="HH:mm"（24小时制，"早上8点"="08:00"，"晚上10点"="22:00"，"中午12点半"="12:30"）。
4. kind=interval：按间隔循环（"每隔1小时给我发个消息"、"每30分钟发一次消息"、"每隔30秒发一句"）。intervalMinutes=分钟数（可以是小数：30 秒=0.5、90 秒=1.5；最小约 0.08，即 5 秒）。
5. note=用户想让消息带的内容/目的摘要（如"提醒我喝水""说晚安"）；没有具体目的就写"主动找我聊聊"。
6. 只依据对话里给到的时间信息换算，不要编造；表达含糊缺时间信息时 match=false。
7. 严禁输出 JSON 以外的任何文字。`;

/**
 * 解析用户消息里的定时提醒指令；成功则落任务并返回确认摘要（失败/不像指令返回 null）。
 * 三端聊天发送链路调用：命中正则闸 → LLM 解析 → 落任务 + sys 系统行反馈 + AI 本轮自然确认。
 */
export async function parseReminderInstruction(app: ProactiveApp, cid: string, text: string): Promise<string | null> {
  const t = (text ?? '').trim();
  if (!reminderHintHit(t)) return null;
  try {
    const nowStr = formatNowForPrompt();
    const raw = await callLlmTwoTier(
      REMINDER_PARSE_SYSTEM,
      `当前时间：${nowStr}\n用户对角色说：「${t}」\n请输出 JSON。`,
      useSettings.getState().apiConfig,
    );
    const parsed = extractJsonObjectSafely(raw) as ReminderParseResult | null;
    if (!parsed || parsed.match !== true) return null;
    const kind = parsed.kind;
    if (kind !== 'once' && kind !== 'daily' && kind !== 'interval') return null;

    const now = Date.now();
    let task: ProactiveReminder | null = null;
    if (kind === 'once') {
      const mins = Number(parsed.minutesLater);
      if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 30) return null;
      task = { id: genId(), app, cid, kind: 'once', at: now + Math.round(mins * 60_000), note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    } else if (kind === 'daily') {
      const hm = typeof parsed.dailyTime === 'string' ? parsed.dailyTime.trim() : '';
      if (!/^\d{2}:\d{2}$/.test(hm) || Number(hm.slice(0, 2)) > 23 || Number(hm.slice(3)) > 59) return null;
      task = { id: genId(), app, cid, kind: 'daily', dailyTime: hm, note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    } else {
      const mins = Number(parsed.intervalMinutes);
      // 秒级短间隔放行（与设置页自定义口径一致，用户写 5 秒就是 5 秒）：下限 5 秒，落库按毫秒存
      if (!Number.isFinite(mins) || mins < 5 / 60 || mins > 60 * 24 * 7) return null;
      task = { id: genId(), app, cid, kind: 'interval', intervalMs: Math.max(5_000, Math.round(mins * 60_000)), note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    }
    addReminder(app, task);
    // C13：拉黑期间引擎对该联系人全停（tickInner byUser 守卫），创建成功的提醒不会送达——
    // 系统行当场说明，避免 UI 承诺与实际行为脱节（解除拉黑后照常恢复）
    const blockedNow = (() => {
      try {
        return loadBlock(app, cid).byUser;
      } catch {
        return false;
      }
    })();
    return `${reminderLabel(task)}｜${task.note}${blockedNow ? '（拉黑期间提醒不会送达）' : ''}`;
  } catch {
    return null;
  }
}

// ---------------- 最近主动消息历史（Task 51 C2：设置页回看） ----------------

export interface ProactiveHistEntry {
  text: string;
  at: number;
  kind: 'timer' | 'event' | 'auto' | 'reminder' | 'anxiety';
  /** 迟到补发的提醒（Task 51 A2） */
  late?: boolean;
}

function histKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${HIST_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function pushHist(app: ProactiveApp, cid: string, entry: ProactiveHistEntry): void {
  try {
    const list = kvGet<ProactiveHistEntry[]>(histKeyOf(app, cid));
    const next = Array.isArray(list) ? list : [];
    next.push(entry);
    kvSet(histKeyOf(app, cid), next.slice(-20));
  } catch {
    /* 静默 */
  }
}

/** 某角色最近主动消息（新的在前；设置页展示用） */
export function proactiveHistory(app: ProactiveApp, cid: string): ProactiveHistEntry[] {
  try {
    const list = kvGet<ProactiveHistEntry[]>(histKeyOf(app, cid));
    return Array.isArray(list) ? [...list].reverse().filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

/** 历史时间短标签：今天 HH:MM / 昨天 HH:MM / M月D日 */
export function histTimeLabel(at: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const dayOf = (x: Date): number => Math.floor(x.getTime() / 86_400_000);
  const diff = dayOf(now) - dayOf(d);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// ---------------- 消息读取（三端 kv 键归一化；与 proactive-call 同口径） ----------------

const WX_MSGS_KEY = (id: string): string => `wx-chat-msgs:${id}`;
const QQ_MSGS_KEY = (id: string): string => `qq-chat-msgs:${id}`;
const SMS_MSGS_KEY = (id: string): string => `ios-chat-msgs:c:${id}`;

function msgsKeyOf(app: ProactiveApp, cid: string): string {
  return app === 'wx' ? WX_MSGS_KEY(cid) : app === 'qq' ? QQ_MSGS_KEY(cid) : SMS_MSGS_KEY(cid);
}

interface NormMsg {
  role: 'user' | 'assistant';
  text: string;
  time: number;
}

function extractMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.error === true) return '';
  if (r.sys || r.blkreq || r.notice) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  if (kind === 'call' || kind === 'redpacket' || kind === 'transfer' || kind === 'family' || kind === 'forward' || kind === 'groupcard' || kind === 'blockreq' || kind === 'sys' || kind === 'textcard') {
    return '';
  }
  const content = typeof r.content === 'string' ? r.content.trim() : '';
  const voice = r.voice as { transcript?: unknown; localText?: unknown } | undefined;
  const voiceText = (): string => {
    const t = typeof voice?.transcript === 'string' ? voice.transcript.trim() : '';
    if (t) return t;
    const l = typeof voice?.localText === 'string' ? voice.localText.trim() : '';
    if (l) return l;
    return content && !content.startsWith('data:') ? content : '[语音]';
  };
  switch (kind) {
    case 'voice':
      return voiceText();
    case 'image': {
      const img = r.img as { desc?: unknown } | undefined;
      const d = typeof img?.desc === 'string' ? img.desc.trim() : '';
      return d ? `[图片] ${d}` : '[图片]';
    }
    case 'sticker': {
      const stk = r.stk as { meaning?: unknown } | undefined;
      const d = typeof stk?.meaning === 'string' ? stk.meaning.trim() : '';
      return d ? `[表情包] ${d}` : '[表情]';
    }
    case 'location': {
      const loc = r.loc as { name?: unknown } | undefined;
      const d = typeof loc?.name === 'string' ? loc.name.trim() : '';
      return d ? `[位置] ${d}` : '[位置]';
    }
    default:
      if (!content) return '';
      return content.startsWith('data:') ? '[图片]' : content;
  }
}

function readNormMsgs(app: ProactiveApp, cid: string): NormMsg[] {
  const raw = kvGet<unknown>(msgsKeyOf(app, cid));
  if (!Array.isArray(raw)) return [];
  const out: NormMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const role = r.role === 'user' || r.role === 'me' ? ('user' as const) : r.role === 'assistant' || r.role === 'peer' ? ('assistant' as const) : null;
    if (!role || typeof r.time !== 'number') continue;
    const text = extractMsgText(r);
    if (!text.trim()) continue;
    out.push({ role, text, time: r.time });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------- 当前正在查看的会话登记（角标守卫） ----------------

const activeChats = new Map<string, true>();

/** 聊天页挂载/卸载时登记：用户正看着的会话收主动消息不涨角标（消息实时可见） */
export function setActiveProactiveChat(app: ProactiveApp, cid: string | null): void {
  const k = `${app}:${cid}`;
  for (const key of Array.from(activeChats.keys())) if (key.startsWith(`${app}:`)) activeChats.delete(key);
  if (cid) activeChats.set(k, true);
}

function isActiveChat(app: ProactiveApp, cid: string): boolean {
  return activeChats.has(`${app}:${cid}`);
}

/** 跨模块查询：某会话是否正被用户查看（美团 AI 决策投递角标守卫用） */
export function isProactiveChatActive(app: ProactiveApp, cid: string): boolean {
  return activeChats.has(`${app}:${cid}`);
}

// ---------------- LLM 调用（两级兜底：用户配置 → 内置模型；与 friend-state 同款） ----------------

async function callLlmTwoTier(system: string, userContent: string, apiConfig: ApiConfig): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

/** 从 LLM 原文抠 JSON 对象（三级：整段 parse → 首个 {...} 块 → null） */
function extractJsonObjectSafely(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

// ---------------- 消息生成（五、消息内容生成） ----------------

function formatNowForPrompt(): string {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week} ${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 触发原因 → 人类可读说明（进 prompt） */
function triggerDesc(trigger: FireTrigger): string {
  switch (trigger.kind) {
    case 'timer':
      return '定时触发：你之前和对方约好保持联系，现在到了你该主动发消息的时间（对方没有先说话，是你在主动开口）。';
    case 'event':
      return `事件触发：现在正是「${trigger.eventName ?? ''}」的时候，你因为这个事件想给对方发条消息。`;
    case 'reminder':
      return `定时提醒：对方之前请你「${trigger.note ?? '到点给 TA 发条消息'}」，现在到时间了，你要兑现这个约定${trigger.late ? '（这次提醒比约定时间晚到了——设备可能没开着，你要自然地带一句歉意，比如开头说「来晚了」，然后把该说的说完）' : ''}。`;
    case 'anxiety':
      return `焦虑触发：你已经等了很久都没有等到 TA 的回复（你当下的焦虑值 ${trigger.anxietyLevel ?? '??'}/100），控制不住要主动找 TA——这是情绪驱动，不是约定也不是提醒。`;
    case 'auto':
      return '自主触发：你自己决定此刻主动发一条消息（系统判断当前时机合适，你按自己的性格和心情自由发挥）。';
  }
}

/** 生成规则（人设 extraRules 追加） */
function genRules(trigger: FireTrigger, timeAware: boolean): string[] {
  const rules = [
    '【主动发消息场景】你现在要主动给对方发一条消息——不是回复，对方没有在等你说话，是你主动开口。',
    '像平时聊天一样自然口语化，一到两句就好（一般不超过 50 字），禁止标题、解释、括号说明、JSON、markdown，禁止用引号把整条消息包起来。',
    `触发情境：${triggerDesc(trigger)}`,
    '结合你们的关系、人设和最近聊过的内容：可以延续上次话题、分享你「刚发生/刚想到」的近况、问候、调侃、吐槽，像真人想到什么发什么。',
    '下面注入的记忆、跨 App 近况、社交动态都是你亲身经历的事：可以自然接着聊，但内容必须有来处——绝不能编造记录里没有的细节（没发生的约会、没看过的动态都不算数）。',
    '【社交动态归属红线】朋友圈/QQ空间动态都带归属标注：标「用户本人」的才是对方发的动态，标「AI角色本人，就是你自己」的是你自己发的——绝不能把自己发的动态说成对方发的（反之亦然）；归属看不清就不要提动态。',
    '绝对不要重复你最近已经说过的话（尤其是你上一条主动消息和最近聊天里的内容），也不要复述对方的话。',
    '不要每次都用同一种开头（「在吗」「在干什么」不要连着用），也不要连续几条都围着同一个由头（比如连着三条都提喝茶），内容要有新信息量。',
  ];
  if (timeAware) rules.push('内容必须符合当前真实时间（深夜别元气满满问吃了吗、早上适合问早、饭点可以聊吃的；节日节气可以自然提到）。');
  if (trigger.kind === 'reminder' && trigger.note) rules.push(`消息要贴合对方的请求「${trigger.note}」（该提醒就提醒、该说晚安就说晚安），用你自己的口吻说。`);
  // v51 焦虑触发：情绪驱动型消息的专属规则（与【你此刻的焦虑值】块配合）
  if (trigger.kind === 'anxiety') {
    rules.push('这条消息由你的焦虑驱动：对方已经很久没回你了，你控制不住想主动开口。让这份焦急真实地透出来——会追问、会不安、想确认 TA 还在乎你；但不要卑微地连环道歉，也不要发火骂人（除非你的人设本来就暴躁）。');
    rules.push('连续的焦虑消息之间内容要有变化（担心 → 自我怀疑 → 想起你们的约定 → 撒娇式质问……换着角度来），禁止连续两条几乎一样，也不要每条都以「在吗」开头。');
  }
  return rules;
}

/** 近期对话 → prompt 文本（末尾若干条；含角色标签） */
function convoLines(norm: NormMsg[], count: number, peerName: string, userName: string): string {
  const lines: string[] = [];
  for (const m of norm.slice(-count)) {
    lines.push(`${m.role === 'user' ? userName : peerName}：${m.text}`);
  }
  return lines.join('\n');
}

interface FireTrigger {
  kind: 'timer' | 'event' | 'auto' | 'reminder' | 'anxiety';
  eventName?: string;
  note?: string;
  /** 提醒迟到补发（Task 51 A2）：生成时带歉意 */
  late?: boolean;
  /** v51 焦虑触发：当下的焦虑值（0~100，进触发情境描述） */
  anxietyLevel?: number;
}

/**
 * 生成一条主动消息正文（失败返回空串）。
 * system = 人设（含生成规则）+ 记忆召回 + 时间感知；user = 触发情境 + 近期对话 + 防重复提示。
 */
async function generateProactiveText(app: ProactiveApp, contact: ContactRecord, trigger: FireTrigger, npcExtra: Record<string, unknown> | null): Promise<string> {
  const sessionKey = app === 'wx' ? `wx:${contact.id}` : app === 'qq' ? `qq:${contact.id}` : `sms:c:${contact.id}`;
  const norm = readNormMsgs(app, contact.id);
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const userName = owner?.realName || '用户';
  const last = getLast(app, contact.id);

  // 时间感知开关（会话级设置；自主触发永远注入——AI 要靠时间做决策）
  const timeAwareOn = trigger.kind === 'auto' ? true : getTimeAware(sessionKey);
  const timeBlock = timeAwareOn
    ? buildTimeAwareBlock({ lastMsgTime: norm.length > 0 ? norm[norm.length - 1].time : null, regionHint: contact.region || null })
    : '';

  // 人设（小号场景账号解析 + 大号记忆披露门控与三端聊天完全同源）
  const disclosureText = norm
    .filter((m) => m.role === 'user')
    .slice(-6)
    .map((m) => m.text)
    .join(' ');
  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(contact.id).share,
    accountId: getActiveAccountIdFor(app as AccountApp),
    extraRules: genRules(trigger, timeAwareOn),
    ...(npcExtra ?? {}),
  });
  const memoryBlock = memChatRecallBlock(contact.id, app, [trigger.note ?? '', trigger.eventName ?? '', disclosureText].filter(Boolean).join(' '), {
    disclosureText: disclosureText || undefined,
    altMainName: cachedOwnerName(),
    altMainRelation: contact.relation?.trim() || '',
  });

  // 社交动态感知（与三端聊天同口径）：最近的朋友圈/QQ空间动态（每条带归属标注）——
  // 主动消息也能自然提起动态话题；userName 传展示名（与动态存储/作者匹配口径一致），
  // userRealName 传真实名字（标签与归属说明用真名称呼用户）
  // 用户规则：机主昵称已废除（AI 不知道、展示层也不再用）——动态匹配/称呼恒用真名
  const ownerDisplay = owner?.realName || '用户';
  const momentsBlock = buildMomentsChatBlock({
    contactId: contact.id,
    app,
    userName: ownerDisplay,
    userRealName: owner?.realName || undefined,
    peer: contact,
  });
  // 跨 App 近况（与三端聊天同口径）：其他 App 最近聊过什么/用户在听什么——主动消息能接上别处的话题
  const crossAppBlock = await buildCrossAppBlock(contact.id, app, userName);

  const system = [persona, memoryBlock, crossAppBlock, momentsBlock, timeBlock, buildDynamicStateBlocks(contact.id), trigger.kind === 'anxiety' ? buildAnxietyFireBlock(contact.id) : ''].filter(Boolean).join('\n\n');

  // user prompt：情境 + 最近对话 + 防重复
  const recent = convoLines(norm, 12, contact.name, userName);
  const parts: string[] = [];
  if (recent.trim()) parts.push(`【最近聊天】\n${recent}`);
  else parts.push('【最近聊天】\n（最近没有聊天记录，你们有一阵子没说话了）');
  // 近期主动消息历史（最近 3 条，新的在前）：短间隔连续发时让模型看见「刚发过什么」，压住换皮重发
  const histLines = proactiveHistory(app, contact.id)
    .slice(0, 3)
    .map((h) => `- ${h.text}`)
    .join('\n');
  if (histLines) parts.push(`【你最近主动发过的消息（严禁重复或换汤不换药地重发类似内容）】\n${histLines}`);
  else if (last.lastSentText) parts.push(`【你最近一次主动发的消息（严禁重复类似内容）】\n${last.lastSentText}`);
  parts.push('【现在】\n请直接输出你要发给对方的消息正文（只有正文，一行，不要任何前后缀）。');
  const user = parts.join('\n\n');

  const raw = await callLlmTwoTier(system, user, useSettings.getState().apiConfig);
  // 清洗：[思考]块兜底剥离（模型跨链路模仿单聊习惯偶发输出思考块，主动消息链路未注入思考指令，
  // 但会话历史可能带偏——不过一遍会原样泄漏进微信/QQ聊天气泡）→ 去引号包裹/前缀说明；主动消息必须短
  let text = extractThinkBlocks(raw ?? '').text.trim();
  text = text.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  text = text.replace(/^(好的[，,]?|以下是?我(要发|给对方)的?消息[：:]?)\s*/i, '').trim();
  const firstLine = text.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  text = (firstLine || text).slice(0, MAX_PROACTIVE_LEN).trim();
  return text;
}

// ---------------- 自主决策（三、自主触发） ----------------

interface AutoDecision {
  action: 'send' | 'wait' | 'fail';
  message?: string;
  delayMinutes?: number;
}

function isAutoQuietHour(now: number): boolean {
  const h = new Date(now).getHours();
  // 起止跨夜（23→8）用或逻辑；普通区间用与逻辑
  return AUTO_QUIET_START_HOUR > AUTO_QUIET_END_HOUR
    ? h >= AUTO_QUIET_START_HOUR || h < AUTO_QUIET_END_HOUR
    : h >= AUTO_QUIET_START_HOUR && h < AUTO_QUIET_END_HOUR;
}

/** 自主模式决策 prompt 规则 */
function autoRules(): string[] {
  return [
    '【自主发消息决策】你正在决定要不要此刻主动给对方发一条消息。这不是必须发的任务——发不发完全由你根据人设、心情、你们的关系和当前时间自然决定。',
    '考虑因素：人设性格（高冷/慢热的人主动频率低）、你们的记忆和最近聊过什么、当前时间（深夜/清晨/工作时间的分寸）、距上次聊天过了多久（刚聊完没必要马上又发）。',
    '一般来说：有好玩的想分享、惦记对方、有正当由头（饭点/天气/对方提过的事）→ 可以发；刚聊完没多久、深夜、没什么想说的、对方可能不方便 → 选 wait。',
    '下面注入的记忆、跨 App 近况、社交动态都是你亲身经历的事：send 的内容要有来处，绝不能编造记录里没有的细节。',
    '【社交动态归属红线】朋友圈/QQ空间动态带归属标注：标「AI角色本人，就是你自己」的是你自己发的动态，绝不能当成对方发的；标「用户本人」的才是对方发的。',
    '输出 JSON：{"action":"send"或"wait","message":"action=send 时要发的消息正文（一行，像平时聊天，1~2 句）","delayMinutes":数字（action=wait 时建议多久后再考虑，5~120）,"reason":"一句话理由"}',
    '严禁输出 JSON 以外的文字。send 的消息必须是有内容量的（不要空洞的「在吗」）。',
  ];
}

/** 自主决策（send=直接拿到消息正文，一次调用同时决策+生成） */
async function decideAutonomous(app: ProactiveApp, contact: ContactRecord, npcExtra: Record<string, unknown> | null): Promise<AutoDecision> {
  const norm = readNormMsgs(app, contact.id);
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const userName = owner?.realName || '用户';
  const last = getLast(app, contact.id);

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(contact.id).share,
    accountId: getActiveAccountIdFor(app as AccountApp),
    extraRules: autoRules(),
    ...(npcExtra ?? {}),
  });
  const disclosureText = norm.filter((m) => m.role === 'user').slice(-6).map((m) => m.text).join(' ');
  const memoryBlock = memChatRecallBlock(contact.id, app, disclosureText, {
    disclosureText: disclosureText || undefined,
    altMainName: cachedOwnerName(),
    altMainRelation: contact.relation?.trim() || '',
  });
  // 社交动态 + 跨 App 近况（与三端聊天同口径）：自主决策同样要基于人设/记忆/动态/跨 App 上下文
  // 用户规则：机主昵称已废除（AI 不知道、展示层也不再用）——动态匹配/称呼恒用真名
  const ownerDisplay = owner?.realName || '用户';
  const momentsBlock = buildMomentsChatBlock({
    contactId: contact.id,
    app,
    userName: ownerDisplay,
    userRealName: owner?.realName || undefined,
    peer: contact,
  });
  const crossAppBlock = await buildCrossAppBlock(contact.id, app, userName);
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: norm.length > 0 ? norm[norm.length - 1].time : null, regionHint: contact.region || null });
  // Task 51 C1：启用中的事件（含未设时间的纯情境事件）作为自主决策的情境参考
  let eventsBlock = '';
  try {
    const evts = getProactiveCfg(app, contact.id).events.filter((e) => e.enabled);
    if (evts.length > 0) {
      eventsBlock = `【你生活中的事件安排（可作为自然的开场由头）】\n${evts.map((e) => `- ${e.name}${e.time ? `（${dayLabel(e.days)} ${e.time}）` : ''}`).join('\n')}`;
    }
  } catch {
    /* 忽略 */
  }
  const system = [persona, memoryBlock, crossAppBlock, momentsBlock, timeBlock, eventsBlock].filter(Boolean).join('\n\n');

  const recent = convoLines(norm, 10, contact.name, userName);
  const gapDesc = (() => {
    const lastAt = norm.length > 0 ? norm[norm.length - 1].time : 0;
    if (!lastAt) return '从来没有聊过天（你们可能只是刚加上好友）';
    const gapMin = Math.round((Date.now() - lastAt) / 60_000);
    if (gapMin < 5) return '刚刚还在聊';
    if (gapMin < 120) return `距上一条消息约 ${gapMin} 分钟`;
    if (gapMin < 60 * 48) return `距上次聊天约 ${(gapMin / 60).toFixed(1)} 小时`;
    return `距上次聊天超过 ${(gapMin / 60 / 24).toFixed(1)} 天`;
  })();
  const parts = [`【当前时间】${formatNowForPrompt()}`, `【聊天状态】${gapDesc}`];
  if (recent.trim()) parts.push(`【最近聊天】\n${recent}`);
  if (last.lastSentText) parts.push(`【你最近一次主动发的消息（若决定 send，不要再发类似内容）】\n${last.lastSentText}`);
  parts.push('【任务】输出决策 JSON。');

  const raw = await callLlmTwoTier(system, parts.join('\n\n'), useSettings.getState().apiConfig).catch(() => '');
  // [思考]块兜底剥离（同上：模型模仿单聊习惯在 JSON 前后裹思考块会令 JSON 提取失败/正文泄漏，先剥再解析）
  const stripped = extractThinkBlocks(raw).text;
  // API/生成失败（空回复）：与「AI 决策 wait」区分开——fail 会让上层用本地兑底消息保底发送
  //（用户反馈：设置了自动发消息到点却收不到——之前 API 挂了会静默 wait，看起来像「到点没发」）
  if (!stripped.trim()) return { action: 'fail' };
  const parsed = extractJsonObjectSafely(stripped) as Partial<AutoDecision> & { reason?: unknown } | null;
  if (!parsed) return { action: 'wait', delayMinutes: AUTO_WAIT_MIN_MINUTES };
  if (parsed.action === 'send' && typeof parsed.message === 'string' && parsed.message.trim()) {
    // message 字段本身也可能裹着思考块/引号（模型偶发把思考写进 JSON 字段），同口径剥一道
    let msg = extractThinkBlocks(parsed.message).text.trim().replace(/^[「"'『]+|[」"'』]+$/g, '');
    msg = msg.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
    if (!msg) return { action: 'wait', delayMinutes: AUTO_WAIT_MIN_MINUTES };
    return { action: 'send', message: msg.slice(0, MAX_PROACTIVE_LEN) };
  }
  const d = Number(parsed.delayMinutes);
  const delay = Number.isFinite(d) ? Math.max(AUTO_WAIT_MIN_MINUTES, Math.min(Math.round(d), AUTO_WAIT_MAX_MINUTES)) : AUTO_WAIT_MIN_MINUTES;
  return { action: 'wait', delayMinutes: delay };
}

// ---------------- 投递（落库 + 通知 + 角标 + 记忆） ----------------

/** 主动消息投递：写三端消息记录 + pushChatNotification + wx/qq 未读角标（正在看不计数） */
async function deliverProactiveMsg(app: ProactiveApp, contact: ContactRecord, text: string, trigger: FireTrigger): Promise<void> {
  const cid = contact.id;
  const sessionKey = app === 'wx' ? `wx:${cid}` : app === 'qq' ? `qq:${cid}` : `sms:c:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : app === 'qq' ? ('qq' as const) : ('chat' as const);
  const avatarApp = app as AccountApp;
  const now = Date.now();
  const msg =
    app === 'sms'
      ? { id: genId(), role: 'assistant' as const, content: text, time: now, kind: 'text' as const }
      : { id: genId(), role: 'peer' as const, content: text, time: now, kind: 'text' as const };

  const saveOne = (m: typeof msg): void => {
    try {
      const key = msgsKeyOf(app, cid);
      const raw = kvGet<unknown[]>(key);
      const list = Array.isArray(raw) ? raw : [];
      kvSet(key, [...list, m].slice(-(app === 'sms' ? 100 : 200)));
    } catch {
      /* 落库失败静默 */
    }
  };

  await scheduleAiDelivery<typeof msg>(
    sessionKey,
    [msg],
    (m) => {
      saveOne(m);
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, avatarApp as ContactAvatarApp),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isActiveChat(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else if (app === 'qq') qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );

  // B4：实际发出一条主动消息后同步刷新 autoAt（把自主决策点推迟一个节奏周期）——
  // 此前用户通道（定时/事件/提醒）发完后 autoAt 不动，自主在 2 分钟无发言时会紧跟再发一条
  setLast(app, cid, { lastSentText: text, sentAt: now, autoAt: now });
  // 最近主动消息历史（Task 51 C2：设置页回看，每角色最近 20 条）
  pushHist(app, cid, { text, at: now, kind: trigger.kind, late: trigger.late });

  // v51 焦虑触发：投递成功后打点——小幅缓解（-6）+ 记录发送节奏（lastFireAt）。
  // 焦虑消息本身已正常写入聊天记录（上方 kvSet）与记忆库（下方 memAfterAiTurn）。
  if (trigger.kind === 'anxiety') {
    try {
      noteAnxietyFire(cid);
    } catch {
      /* 打点失败不影响投递 */
    }
  }

  // 写记忆：主动消息同样进记忆管线（七.2）——与三端聊天 memAfterAiTurn 同口径
  try {
    const apiCfg = useSettings.getState().apiConfig;
    const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
    const getRaw = (): unknown[] => {
      const r = kvGet<unknown>(msgsKeyOf(app, cid));
      return Array.isArray(r) ? r : [];
    };
    memAfterAiTurn(
      cid,
      app as AccountApp,
      apiCfg,
      () => memConvoFromRaw(getRaw(), contact.name),
      getRaw,
      { user: owner?.realName || null, peer: contact.name },
      { scene: app === 'wx' ? '微信主动发消息' : app === 'qq' ? 'QQ主动发消息' : '短信主动发消息' },
    );
  } catch {
    /* 记忆失败不影响投递 */
  }
}

// ---------------- tick 主流程 ----------------

let tickRunning = false;

/** 测试/调试：tick 是否正在执行 */
export function isProactiveMsgTickRunning(): boolean {
  return tickRunning;
}

/** Watcher 取 tick 参数（预留：未来可加全局频率档） */
export function getProactiveMsgTickParams(): { interval: number } {
  return { interval: PROACTIVE_MSG_TICK_MS };
}

/**
 * 调度 tick（ProactiveMsgWatcher 每 5s 调用；任何失败静默——后台增强能力）。
 * 优先级：定时 > 事件 > 提醒 > 自主（同一角色一个 tick 最多发一条）。
 */
export async function runProactiveMsgTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await tickInner();
  } catch {
    /* 静默 */
  } finally {
    tickRunning = false;
  }
}

/** 同一自然日判定（daily 类触发的按天去重） */
function sameDay(a: number | undefined, b: number): boolean {
  if (typeof a !== 'number') return false;
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** 分钟数（自当日零点）→ 当日该时刻的分钟戳 */
function schedMinuteStamp(now: number, minutesOfDay: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() + minutesOfDay * 60_000) / 60_000);
}

/**
 * 事件此刻是否到期（Task 51 A1：宽限窗口 SCHEDULED_GRACE_MIN 分钟内错过仍补发；
 * 返回值 = 计划时刻的分钟戳（防重发去重键），null = 未到期）。
 */
function dueEventOf(e: ProactiveEvent, now: number, firedEvtAt: Record<string, number> | undefined): number | null {
  if (!e.enabled || !e.time) return null;
  const d = new Date(now);
  const [hh, mm] = e.time.split(':').map(Number);
  const dm = hh * 60 + mm;
  const cm = d.getHours() * 60 + d.getMinutes();
  if (cm < dm || cm - dm > SCHEDULED_GRACE_MIN) return null;
  if (e.days.length > 0 && !e.days.includes(d.getDay())) return null;
  const stamp = schedMinuteStamp(now, dm);
  return (firedEvtAt?.[e.id] ?? -1) !== stamp ? stamp : null;
}

/**
 * 到期的提醒任务（Task 51 A1/A2）：
 * once — 到点就发，不再静默丢弃：迟到也补发（late=超过宽限），任务触发后照常删除；
 * daily — 按天去重 + SCHEDULED_GRACE_MIN 分钟宽限（错过精确分钟仍补发）；
 * interval — 间隔到了就发（天然带宽限）。
 */
function dueReminderOf(app: ProactiveApp, cid: string, now: number): { r: ProactiveReminder; late: boolean } | null {
  const list = readReminders(app).filter((r) => r.cid === cid);
  const d = new Date(now);
  const cm = d.getHours() * 60 + d.getMinutes();
  for (const r of list) {
    if (r.kind === 'once' && typeof r.at === 'number' && !r.lastFiredAt) {
      if (r.at <= now) {
        // C7：迟到超过 24h 的过期提醒静默丢弃（页面长期没开后回来不再收到荒谬时差的提醒）
        if (now - r.at > REMINDER_LATE_MAX_MS) {
          removeReminder(app, r.id);
          continue;
        }
        return { r, late: now - r.at > FIRE_GRACE_MS };
      }
      continue;
    }
    if (r.kind === 'daily' && r.dailyTime) {
      const [hh, mm] = r.dailyTime.split(':').map(Number);
      const dm = hh * 60 + mm;
      if (cm >= dm && cm - dm <= SCHEDULED_GRACE_MIN && !sameDay(r.lastFiredAt, now)) return { r, late: cm - dm > 1 };
      continue;
    }
    if (r.kind === 'interval' && r.intervalMs) {
      if (now - (r.lastFiredAt ?? r.createdAt) >= r.intervalMs) return { r, late: false };
      continue;
    }
  }
  return null;
}

async function tickInner(): Promise<void> {
  const nowMs = Date.now();

  // 全局总开关（Task 51 B2）：一键暂停所有角色的主动发消息
  if (isProactiveMasterOff()) return;

  // 交互中守卫（与主动来电同口径）：来电响铃/通话进行中不主动发消息（真实手机语义：通话里不来新消息提示音轰炸）
  if (useIncomingCall.getState().call) return;
  if (useGlobalCall.getState().session) return;
  if (useUI.getState().callActive) return;
  if (useUI.getState().alarmRinging) return;

  const index = readIndex();
  if (index.length === 0) return;

  const allContacts = await listContacts().catch(() => [] as ContactRecord[]);
  if (allContacts.length === 0) return;

  for (const entry of index) {
    const { app, cid } = entry;
    // 账号隔离：配置/执行记录/提醒都按对应 App 当前账号读；其他账号的配置自然不可见
    const cfg = getProactiveCfg(app, cid);
    const contact = allContacts.find((c) => c.id === cid);
    // 人设非空不再要求（用户反馈「设置了定时发消息到点不发」）：普通聊天对空人设照常回复
    //（persona.ts 对空人设有自然兑底），主动消息同口径；USER/无名仍排除
    if (!contact || contact.kind === 'user' || !contact.name?.trim()) continue;
    // 拉黑守卫：用户拉黑角色（byUser）→ 该 App 主动消息全停（含定时/事件/提醒）；
    // 角色拉黑用户（byChar）不再拦截主动消息（C8：与 block prompt「你拉黑 TA 后你仍然可以给
    // TA 发消息」承诺对齐——AI 拉黑后主动找人是被认可的叙事语义，cross-app-reach byChar 同款）
    const blk = loadBlock(app, cid);
    if (blk.byUser) continue;

    // 对话活跃守卫（Task 51 B1）：最近 2 分钟内**用户**发过消息时跳过定时/自主触发（不打断正在进行的聊天；
    // 事件/提醒是用户明确约定，不受此限）。10s tick 稍后再试。
    // 修复（用户反馈 30s 间隔实际 ≥2.5 分钟才来一条）：旧口径取「最后一条消息」——AI 自己的主动
    // 消息也算活跃，每发一条就把后续定时压住 2 分钟；改只看用户侧最后一条消息。
    let convActive = false;
    try {
      const norm = readNormMsgs(app, cid);
      const lastUserAt = (() => {
        for (let i = norm.length - 1; i >= 0; i--) if (norm[i].role === 'user') return norm[i].time;
        return 0;
      })();
      convActive = lastUserAt > 0 && nowMs - lastUserAt < CONVO_ACTIVE_MS;
    } catch {
      convActive = false;
    }

    const last = getLast(app, cid);
    // A3 发送间隔闸：距上条主动消息不足 45s 时全部通道本轮延后（到点触发保留，下轮 tick 重试——
    // daily/事件有 5 分钟宽限、interval 按累计判定、once 保留任务，均不会因延后而丢失）
    const sendGapBlocked = nowMs - (last.sentAt ?? 0) < MIN_SEND_GAP_MS;
    // 配角圈注入不再限 NPC：CHAR 同样产出认识的配角 + 背景近况（buildNpcPromptExtra 按类型分叉），
    // 与四端聊天主链路的 npcExtra 口径对齐；全空返回 null 不注入，旧行为不变
    const npcExtra = buildNpcPromptExtra(contact, allContacts) as unknown as Record<string, unknown> | null;

    // ① 定时触发（interval=按间隔累计；daily=对齐钟表时刻，按天去重+宽限；发送间隔闸内延后）
    if (cfg.timerOn && !convActive && !sendGapBlocked) {
      if (cfg.timerMode === 'daily' && cfg.timerDailyTime) {
        const [hh, mm] = cfg.timerDailyTime.split(':').map(Number);
        const dm = hh * 60 + mm;
        const d = new Date(nowMs);
        const cm = d.getHours() * 60 + d.getMinutes();
        if (cm >= dm && cm - dm <= SCHEDULED_GRACE_MIN && !sameDay(last.timerAt, nowMs)) {
          setLast(app, cid, { timerAt: nowMs });
          await fireProactive(app, contact, { kind: 'timer' }, npcExtra);
          continue;
        }
      } else if (nowMs - (last.timerAt ?? 0) >= cfg.timerMs) {
        setLast(app, cid, { timerAt: nowMs });
        await fireProactive(app, contact, { kind: 'timer' }, npcExtra);
        continue;
      }
    }

    // ② 事件触发（宽限窗口内错过仍补发；按计划时刻分钟戳去重；发送间隔闸内延后）
    const firedEvt = last.evtAt ?? {};
    let evtFired = false;
    for (const e of sendGapBlocked ? [] : cfg.events) {
      const stamp = dueEventOf(e, nowMs, firedEvt);
      if (stamp !== null) {
        setLast(app, cid, { evtAt: { ...firedEvt, [e.id]: stamp } });
        await fireProactive(app, contact, { kind: 'event', eventName: e.name }, npcExtra);
        evtFired = true;
        break;
      }
    }
    if (evtFired) continue;

    // ③ 定时提醒（自然语言任务；once 迟到补发并标注 late；发送间隔闸内延后——任务保留，下轮再试）
    const due = sendGapBlocked ? null : dueReminderOf(app, cid, nowMs);
    if (due) {
      const rem = due.r;
      if (rem.kind === 'once') removeReminder(app, rem.id);
      else writeReminders(app, readReminders(app).map((r) => (r.id === rem.id ? { ...r, lastFiredAt: nowMs, firedCount: (r.firedCount ?? 0) + 1 } : r)));
      await fireProactive(app, contact, { kind: 'reminder', note: rem.note, late: due.late }, npcExtra);
      continue;
    }

    // ④ 自主触发（夜间静默 23-8 + 系统免打扰时段 B1；决策节奏可调 autoFreqMin，wait 决策会推迟下次决策点）
    if (cfg.autoOn && !convActive && !isAutoQuietHour(nowMs) && !isDndWindowActive() && !sendGapBlocked) {
      const baseMs = Math.max(2, cfg.autoFreqMin ?? 5) * 60_000;
      if (nowMs - (last.autoAt ?? 0) >= baseMs) {
        setLast(app, cid, { autoAt: nowMs });
        await fireProactive(app, contact, { kind: 'auto' }, npcExtra);
      }
    }
  }

  // ⑤ 焦虑触发（v51 情绪焦虑值系统）：焦虑值 ≥ 阈值 且 用户超过宽限时间未回复 → 带着焦虑主动发消息。
  // 全联系人扫描（不依赖上方主动消息索引——焦虑是角色本体的情绪，默认开启，无需先配置过其它触发）；
  // 投递回「用户最近聊天所在的 App」（anxiety.lastUserApp）；生成 Prompt 注入人设+记忆+最近聊天+
  // 焦虑当前值（generateProactiveText 内 buildAnxietyFireBlock）；发送节奏由 lastFireAt 节流
  // （默认 1 分钟一条）；用户回复即安抚（noteUserReply 大幅缓解）。焦虑消息同样走 deliverProactiveMsg
  // 管线：正常写聊天记录 + 记忆库。守卫：拉黑（byUser）不穿透；系统勿扰时段不穿透；
  // 全局防轰炸闸（MIN_SEND_GAP）同四类触发共用；通话/闹钟互斥在 tick 入口已拦。
  anxLoop: for (const contact of allContacts) {
    if (contact.kind === 'user' || !contact.name?.trim()) continue;
    const cid = contact.id;
    const meta = readAnxiety(cid);
    const anxApp = meta.lastUserApp;
    if (meta.lastUserAt <= 0 || (anxApp !== 'wx' && anxApp !== 'qq' && anxApp !== 'sms')) continue;
    const anxAppTyped = anxApp as ProactiveApp;
    const anx = anxietyOf(cid, { persona: contact.persona || null });
    const anxHeightCfg = getProactiveCfg(anxAppTyped, cid);
    if (anxHeightCfg.anxietyOn === false) continue;
    const blkAnx = loadBlock(anxAppTyped, cid);
    if (blkAnx.byUser) continue; // 拉黑期间不穿透（同四类触发口径）
    const threshold = anxHeightCfg.anxietyThreshold ?? ANXIETY_DEFAULT_THRESHOLD;
    const graceMs = anxHeightCfg.anxietyGraceMs ?? ANXIETY_DEFAULT_GRACE_MS;
    const sendMs = anxHeightCfg.anxietySendMs ?? ANXIETY_DEFAULT_SEND_MS;
    const unansweredMs = nowMs - anx.lastUserAt;
    if (anx.level < threshold || unansweredMs < graceMs || nowMs - anx.lastFireAt < sendMs) continue;
    if (nowMs - (getLast(anxAppTyped, cid).sentAt ?? 0) < MIN_SEND_GAP_MS) continue; // 防轰炸闸
    if (isDndWindowActive()) continue; // 系统勿扰：焦虑再急也不穿透用户设置的勿扰时段
    const npcExtraAnx = buildNpcPromptExtra(contact, allContacts) as unknown as Record<string, unknown> | null;
    await fireProactive(anxAppTyped, contact, { kind: 'anxiety', anxietyLevel: Math.round(anx.level) }, npcExtraAnx);
  }
}

// ---------------- 统一触发入口（生成锁 + 去重 + 投递） ----------------

/** 联系人级生成锁：同一角色正在生成/投递时其他 tick 跳过（防短间隔下重叠生成重复消息） */
const generating = new Set<string>();

/**
 * 生成失败本地兑底文案（用户验收点：设置了自动发消息，到点一定能收到一条）——
 * timer/event/reminder 是用户明确约定的「必须发」，LLM 挂了也不能沉默；
 * 文案像真人随手发的（不暴露「系统兜底」痕迹）；带用户真名（短间隔高频下上游限流时
 * 兑底消息占比上升，无称呼的通用句会显得假——统一用真实名字称呼，与主链路口径一致）。
 * userName 传空时保持原句（跨端兼容）。 */
function fallbackProactiveText(trigger: FireTrigger, userName?: string | null): string {
  const me = (userName ?? '').trim();
  const pick = (arr: string[]): string => {
    const base = arr[Math.floor(Math.random() * arr.length)];
    return me ? `${me}，${base}` : base;
  };
  if (trigger.kind === 'reminder') {
    const note = (trigger.note ?? '').trim();
    if (note) return `你之前让我到点提醒你「${note}」——时间到啦！`;
    return '叮咚——你交代的提醒时间到啦！';
  }
  if (trigger.kind === 'event') {
    const name = (trigger.eventName ?? '').trim();
    if (name) return `「${name}」的时间到了，特地来跟你说一声~`;
    return '到点了，来跟你说一声~';
  }
  if (trigger.kind === 'anxiety') {
    // v51：焦虑触发兑底——等不到回复的坐立不安（像真人随手发的，不暴露系统兑底痕迹）
    return pick([
      '你怎么一直不回我……是不是出什么事了？',
      '盯着手机好久了，你就回我一个字也好啊',
      '越等越心慌……你倒是说句话呀',
      '我有点坐不住了，你是不是不想理我了……',
      '跟你说句话嘛，别晾着我好不好',
    ]);
  }
  return pick([
    '在干嘛呢？突然想起你了',
    '忙完了没？来跟你聊两句',
    '咻——冒个泡，今天过得怎么样？',
    '刚看到个东西第一反应是想发给你，你最近咋样？',
    '好一阵没说话了，有点想你了',
  ]);
}

/**
 * 生成并投递一条主动消息（auto 触发先走决策；任何失败静默）。
 * 生成后与最近 AI 发言去重（完全相同 → 丢弃），避免「间隔 < 生成耗时」时的重复消息。
 * 加固（用户反馈「到时间没收到主动消息」）：LLM 生成失败不再静默——先退避重试一轮，
 * 仍失败才用本地兑底文案保底投递；auto 决策 API 失败同样兑底（wait 才是 AI 真决定不发）。
 */
async function fireProactive(app: ProactiveApp, contact: ContactRecord, trigger: FireTrigger, npcExtra: Record<string, unknown> | null): Promise<void> {
  const key = `${app}:${contact.id}`;
  if (generating.has(key)) return;
  generating.add(key);
  let usedFallback = false;
  // 兑底文案用的真名（LLM 失败时本地文案也用真实名字称呼用户）；取不到回退 null
  const ownerForFallback = await ownerProfileFor(app as AccountApp).catch(() => null);
  const fallbackName = ownerForFallback?.realName || null;
  try {
    let text: string;
    if (trigger.kind === 'auto') {
      let decision: AutoDecision;
      try {
        decision = await decideAutonomous(app, contact, npcExtra);
      } catch {
        decision = { action: 'fail' };
      }
      if (decision.action === 'fail') {
        // API/生成失败 ≠ AI 决定不发：本地兑底一条保底消息（到点一定收得到）
        text = fallbackProactiveText(trigger, fallbackName);
        usedFallback = true;
      } else if (decision.action !== 'send' || !decision.message) {
        // wait：把下次决策推迟到建议时间（autoAt 后移，min 5min；基准用当前配置的决策节奏）
        const delayMs = (decision.delayMinutes ?? AUTO_WAIT_MIN_MINUTES) * 60_000;
        const baseMs = Math.max(2, getProactiveCfg(app, contact.id).autoFreqMin ?? AUTO_DECIDE_BASE_MS / 60_000) * 60_000;
        setLast(app, contact.id, { autoAt: Date.now() + Math.max(0, delayMs - baseMs) });
        return;
      } else {
        text = decision.message;
      }
    } else {
      try {
        text = await generateProactiveText(app, contact, trigger, npcExtra);
      } catch {
        text = '';
      }
      // 第一轮全失败（用户配置+内置模型都没出字）：退避 6s 再重试一轮——LLM 抖动很常见，
      // 多一次重试能大幅减少落到兑底文案的概率（兑底仅作为最后保底，保证到点必有产出）
      if (!text) {
        await new Promise<void>((r) => window.setTimeout(r, 6_000));
        try {
          text = await generateProactiveText(app, contact, trigger, npcExtra);
        } catch {
          text = '';
        }
      }
      if (!text) {
        text = fallbackProactiveText(trigger, fallbackName); // 两轮都失败：本地兑底（到点一定发）
        usedFallback = true;
      }
    }
    if (!text) return;
    // 去重：与最近 6 条 AI 发言/上次主动消息完全相同 → 不投（LLM 在上下文未变时可能复述同一条）；
    // 兑底文案跳过 lastSentText 对比（兑底池有限，连续命中同一句时也要保底发出）
    const recent = readNormMsgs(app, contact.id).slice(-6).filter((m) => m.role === 'assistant').map((m) => m.text.trim());
    if (!usedFallback) {
      const lastSent = getLast(app, contact.id).lastSentText?.trim();
      if (lastSent) recent.push(lastSent);
    }
    if (recent.includes(text)) {
      // 兑底也撞上重复（罕见）：换一条再试一次，仍重复才放弃
      if (!usedFallback) return;
      text = fallbackProactiveText(trigger, fallbackName);
      if (recent.includes(text)) return;
    }
    await deliverProactiveMsg(app, contact, text, trigger);
  } catch {
    /* 静默 */
  } finally {
    generating.delete(key);
  }
}

// ---------------- 聊天发送链路：提醒指令接线辅助 ----------------

/** AI 本轮回复的确认提示（宿主在提醒任务创建成功后作为 sysEvent 注入本轮上下文，AI 自然确认） */
export function reminderSysHint(label: string): string {
  return `【定时提醒已生效】系统已根据用户刚才的话创建定时任务（${label}），到点你会自动给用户发消息。你可以在这次回复里自然地向用户确认这件事（不要提"系统""JSON"或"任务"这类字眼）。`;
}

/**
 * 在聊天里落一条「任务已创建」系统行（居中灰字胶囊；三端 sys 消息形状对齐各自管线）。
 * 返回构造好的 sys 消息对象（宿主自行 setMsgs + saveMsgs）。
 */
export function buildReminderSysMsg(app: ProactiveApp, label: string): Record<string, unknown> {
  const now = Date.now();
  const text = `已设置定时提醒：${label}`;
  return app === 'sms'
    ? { id: genId(), role: 'assistant' as const, content: '', time: now, kind: 'sys' as const, sys: { text } }
    : { id: genId(), role: 'peer' as const, content: '', time: now, kind: 'sys' as const, sys: { text } };
}

// ---------------- 联系人删除清理 ----------------

/** 删除联系人时清扫主动发消息的全部痕迹（配置/执行记录/提醒任务/历史/索引） */
export function purgeProactiveForContact(cid: string): void {
  try {
    for (const app of ['wx', 'qq', 'sms'] as ProactiveApp[]) {
      kvDel(scopedKvKey(`${CFG_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      kvDel(scopedKvKey(`${LAST_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      kvDel(scopedKvKey(`${HIST_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      writeReminders(
        app,
        readReminders(app).filter((r) => r.cid !== cid),
      );
    }
    removeFromIndex('wx', cid);
    removeFromIndex('qq', cid);
    removeFromIndex('sms', cid);
  } catch {
    /* 清理失败静默 */
  }
}

// ---------------- 手动触发（Task 51 C1：事件行「立即发一条」） ----------------

/**
 * 立即按指定事件生成并发送一条主动消息（设置页手动触发；不走定时判定，不影响 evtAt 记录）。
 * 返回是否成功进入生成/投递（去重/锁/拉黑等与自动触发同口径）。
 */
export async function manuallyFireEvent(app: ProactiveApp, cid: string, eventId: string): Promise<boolean> {
  try {
    const cfg = getProactiveCfg(app, cid);
    const evt = cfg.events.find((e) => e.id === eventId);
    if (!evt) return false;
    const all = await listContacts().catch(() => [] as ContactRecord[]);
    const contact = all.find((c) => c.id === cid);
    // 人设非空不再要求（与 tickInner 同口径）
    if (!contact || contact.kind === 'user' || !contact.name?.trim()) return false;
    const blk = loadBlock(app, cid);
    if (blk.byUser) return false; // 与 tickInner 同口径：仅用户拉黑拦截（C8）
    // 配角圈注入不再限 NPC（与上方 generateProactiveText 同口径；CHAR 也有配角圈/背景近况）
    const npcExtra = buildNpcPromptExtra(contact, all) as unknown as Record<string, unknown> | null;
    await fireProactive(app, contact, { kind: 'event', eventName: evt.name }, npcExtra);
    return true;
  } catch {
    return false;
  }
}

// ---------------- 导出：给设置页的小工具 ----------------

/** 星期数字 → 中文短标签 */
export function dayLabel(days: number[]): string {
  if (!days || days.length === 0 || days.length === 7) return '每天';
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const sorted = [...days].sort((a, b) => a - b);
  // 工作日/周末快捷判定
  if (sorted.join(',') === '1,2,3,4,5') return '工作日';
  if (sorted.join(',') === '0,6') return '周末';
  return sorted.map((d) => names[d]).join(' ');
}

/** 事件摘要（设置页行） */
export function eventLabel(e: ProactiveEvent): string {
  const when = e.time ? `${dayLabel(e.days)} ${e.time}` : dayLabel(e.days);
  return `${e.name || '未命名事件'}（${when}）`;
}

// ---------------- 第十六轮：情境主动消息（跨 App 联动 / 作息提醒） ----------------

/**
 * 按给定的「情境描述」立即生成并发送一条主动消息（第十六轮）：
 * - 跨 App 联动：美团外卖送达 / 淘宝快递签收 → AI 在微信/QQ 里自然地聊起这事；
 * - 作息提醒：早安（起床后）/ 晚安（睡前）/ 饭点关心（couple-ai 的 routine tick 调用）。
 * 与用户配置的四类触发完全同管线（生成 → 去重 → 投递 → 通知 → 未读 → 记忆 → 历史），
 * 区别是无需任何预先配置；额外带两层节制：
 * - 幂等（dedupeKey 24h 内同键只发一次——订单号/提醒日即键）；
 * - 每日上限（默认 3 条/天，防事件风暴骚扰）。
 * 返回 true = 已实际投递。
 */
export async function fireProactiveNudge(
  app: ProactiveApp,
  cid: string,
  opts: { dedupeKey: string; context: string; dailyCap?: number },
): Promise<boolean> {
  try {
    if (isProactiveMasterOff()) return false;
    // 幂等：24h 内同键只发一次
    const firedKey = `proactive-nudge-fired:${opts.dedupeKey}`;
    try {
      if (kvGetRaw<{ at: number }>(firedKey) && Date.now() - (kvGetRaw<{ at: number }>(firedKey)?.at ?? 0) < 24 * 3600_000) return false;
    } catch {
      /* 读失败放行（多发一次可接受，绝不因存储问题漏发） */
    }
    // 每日上限：默认 3
    const dayKey = `proactive-nudge-day:${new Date().toISOString().slice(0, 10)}`;
    const cnt = kvGetRaw<number>(dayKey) ?? 0;
    if (cnt >= (opts.dailyCap ?? 3)) return false;
    // 目标联系人：必须是真实 AI 角色（与 manuallyFireEvent 同口径）
    const all = await listContacts().catch(() => [] as ContactRecord[]);
    const contact = all.find((c) => c.id === cid);
    if (!contact || contact.kind === 'user' || !contact.name?.trim()) return false;
    const blk = loadBlock(app, cid);
    if (blk.byUser) return false; // 用户拉黑时不打扰
    // 正在通话中不打扰（与 tickInner 守卫同思路；主动消息调度已有互斥，这里轻量跳过）
    if (useIncomingCall.getState().call || useGlobalCall.getState().session) return false;
    // 生成 + 投递（fireProactive 自带去重/重试/兜底）
    const npcExtra = buildNpcPromptExtra(contact, all) as unknown as Record<string, unknown> | null;
    await fireProactive(app, contact, { kind: 'event', eventName: opts.context }, npcExtra);
    // 记录幂等与计数（无论生成成败都记——避免失败重试风暴；情境类消息错过就错过）
    kvSetRaw(firedKey, { at: Date.now() });
    kvSetRaw(dayKey, cnt + 1);
    return true;
  } catch {
    return false;
  }
}
