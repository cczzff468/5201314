'use client';

/**
 * D3 全局语音助手——指令路由层（本地意图解析 + 执行，纯客户端零新增后端）：
 *
 * agent-voice-ball 的 routeUtterance 在「天气直查 / 纯打开 App / LLM 兜底」之外，
 * 前置接上本层这批直达指令（全部复用项目既有存储/跳转通道）：
 *
 * - 「给TA发消息 / 给<联系人>发消息[:内容]」→ resolveTa（情侣空间绑定优先 → 第一个
 *   CHAR 角色，与 ContactWidget 同口径）或按名字找联系人 → saveChatDraft 预填草稿
 *   （信息 App Task 40 草稿箱，内存同步生效）→ setPendingChatContact 挂起直达会话
 *   （W1-D1 快捷联系人小组件同一条跳转通道）→ 会话层收起后打开信息 App；
 *   指令没内容就只开聊天页不预填。
 * - 「放首歌 / 播放音乐」→ 打开音乐 App + useMusic.toggle()（复用音乐 store 现有
 *   播放通道：有快照队列就接着放/恢复，没有歌就 TTS 说明）。
 * - 「提醒我<时间/内容>」→ 解析时间（今天/明天/后天 + X点X分/半小时后等，尽力而为）
 *   → localDB 'reminders' 落一条 ReminderRecord（提醒事项 App 同一张表，
 *   ReminderWatcher 全局到期监听照常生效）；没听清时间就只记内容并 TTS 说明。
 * - 「定个闹钟[时间]」→ localDB 'alarms' 落一条 AlarmRecord（时钟 App 同一张表，
 *   AlarmWatcher 全局响铃照常生效）；没听到时间就 TTS 说明怎么补。
 * - 「几点了 / 今天几号」→ 报时（含星期与农历，复用 lunar.ts），不切页面。
 *
 * 解析全部是关键词/正则层（零 LLM 延迟零 token）；匹配不上的自由话语照旧走
 * agent-chat.voiceTurn 的 LLM 兜底。所有 runner 永不抛错：失败也返回带人话的
 * CommandOutcome，调用方直接进对话流 + TTS。
 */

import { formatLunarDate, formatSolarShort } from './lunar';
import { localDB, genId, type AlarmRecord, type ReminderRecord } from './db';
import { listContactsFor } from './contacts-store';
import { readInviteMeta } from './couple-invite';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { saveChatDraft } from './chat-drafts';
import { useUI, type AppId } from './store';

// ============================================================
// A. 公共类型
// ============================================================

/** 指令结果卡片（浮层里淡入展示，如「已打开 天气」） */
export interface CommandCard {
  title: string;
  detail?: string;
}

export interface CommandOutcome {
  ok: boolean;
  /** 口语回复（进会话流 + TTS 播报，1~2 句） */
  reply: string;
  /** 结果卡片（可选：动作成功/有可汇报信息时给） */
  card?: CommandCard;
  /** 动作落地后要切到的 App（调用方收会话后 openAppPage；null = 停留在会话） */
  nav: AppId | null;
}

// ============================================================
// B. 时间解析（提醒/闹钟共用，尽力而为）
// ============================================================

/** 解析结果：绝对时刻（今天 0 / 明天 1 / 后天 2 / 大后天 3 + 24h 时分）或相对分钟 */
interface ClockParse {
  hour: number;
  minute: number;
  /** 相对天数（0=今天；无显式日期词时由调用方按「已过点 +1 天」修正） */
  dayOffset: number;
  /** 是否出现了显式日期词（今天/明天/今晚/明早…） */
  explicitDay: boolean;
}

const DAY_WORDS: [RegExp, number][] = [
  [/大后天/, 3],
  [/后天/, 2],
  [/明天|明早|明晨|明晚|明午/, 1],
  [/今天|今晚|今早|今晨|今午|现在|当下|此刻/, 0],
];

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/** 从自然语言里抽 X点X分（支持 X点半/X点一刻/X:XX/X时X分；返回 null = 没听到钟点） */
function parseClock(text: string): { hour: number; minute: number } | null {
  // ① X点半 / X点一刻 / X点20（分） / X点
  let m = text.match(/(\d{1,2})\s*[点时]\s*(半|一刻|\d{1,2})?\s*分?/);
  if (m) {
    const hour = Number(m[1]);
    if (!Number.isFinite(hour) || hour > 24) return null;
    let minute = 0;
    if (m[2] === '半') minute = 30;
    else if (m[2] === '一刻') minute = 15;
    else if (m[2]) minute = Number(m[2]);
    if (!Number.isFinite(minute) || minute > 59) minute = 0;
    return { hour, minute };
  }
  // ② 8:30 / 08：30 形态
  m = text.match(/(\d{1,2})[:：](\d{2})/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour <= 24 && minute <= 59) return { hour, minute };
  }
  return null;
}

/** 解析「<日期词>?<时段词>?<钟点>」为 0~23 的 24h 时刻 + 天数偏移（尽力而为） */
function parseClockTime(text: string): ClockParse | null {
  const clock = parseClock(text);
  if (!clock) return null;
  let hour = clock.hour === 24 ? 0 : clock.hour;
  const minute = clock.minute;
  // 时段词：下午/傍晚/晚上/夜里 → +12（不超过 23）；中午/凌晨/早上口语按原值
  if (/下午|傍晚|晚上|夜里|今夜|夜晚/.test(text) && hour < 12) hour += 12;
  hour = Math.max(0, Math.min(23, hour));
  let dayOffset = 0;
  let explicitDay = false;
  for (const [re, off] of DAY_WORDS) {
    if (re.test(text)) {
      dayOffset = off;
      explicitDay = true;
      break;
    }
  }
  return { hour, minute, dayOffset, explicitDay };
}

/** 相对时长：「10分钟后」「半小时后」「一小时后」（返回分钟数；null = 没有） */
function parseRelativeMin(text: string): number | null {
  let m = text.match(/(\d{1,3})\s*分[钟鐘]?[之以]?[后後]/);
  if (m) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > 0 && v <= 24 * 60) return v;
  }
  if (/半\s*[小]?\s*[时時計][之以]?[后後]/.test(text)) return 30;
  m = text.match(/([一两二三四五六七八九十\d]{1,2})\s*[个]?\s*[小]?\s*时[之以]?[后後]/);
  if (m) {
    const raw = m[1];
    const cn: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const v = /^\d+$/.test(raw) ? Number(raw) : cn[raw];
    if (v && v > 0 && v <= 24) return v * 60;
  }
  return null;
}

// ============================================================
// C. 意图匹配（纯函数，routeUtterance 按序前置调用）
// ============================================================

// ---------------- C1. 发消息 ----------------

export interface SendMessageIntent {
  /** 目标联系人名（null = TA 主联系人） */
  contactName: string | null;
  /** 消息内容（空串 = 只开聊天页不预填草稿） */
  content: string;
}

/** 句尾纯语气词（内容只剩这些字 → 视为没说内容；不剩这些字的末尾字不动，如「你在干嘛」的嘛） */
const PURE_FILLER_RE = /^[吧呗呢哦呀啊哈嘛~～，,。！!\s]+$/;

/** 内容前导清理：剥「说/：/，」等引导字；句尾仅剩纯语气词时视为空内容 */
function stripLead(raw: string): string {
  const t = raw
    .replace(/^[：:，,\s]*/, '')
    .replace(/^说[：:]?/, '')
    .trim();
  return PURE_FILLER_RE.test(t) ? '' : t;
}

/**
 * 识别「给TA发消息[:内容] / 给<联系人>发消息[:内容] / 发消息给<联系人>[:内容]」。
 * 「给TA发消息 你在干嘛」→ { contactName: null, content: '你在干嘛' }；
 * 「给妈妈发消息：记得吃药」→ { contactName: '妈妈', content: '记得吃药' }；
 * 「给TA发消息」→ { contactName: null, content: '' }（只开聊天页）。
 * 非 MessageIntent 返回 null（交给后续意图/LLM）。
 */
export function matchSendMessageIntent(text: string): SendMessageIntent | null {
  const raw = text.trim();
  if (!raw || raw.length > 90) return null;
  const low = raw.toLowerCase();
  // ① TA 直达（ta 大小写都认）：给ta发[条个](消息|信息|短信)[:：,，]内容
  let m = low.match(/^给ta发?[条个]?(?:消息|信息|短信)([：:，,\s]?)(.*)$/);
  if (m) return { contactName: null, content: stripLead(m[2]) };
  m = low.match(/^发(?:消息|信息|短信)给ta[：:，,\s]?(.*)$/);
  if (m) return { contactName: null, content: stripLead(m[1]) };
  // ② 指定联系人：给XX发[条个]消息[:：,，]内容（联系人名 ≤8 字，防整句误吞）
  m = raw.match(/^给(.{1,8}?)发?[条个]?(?:消息|信息|短信)[：:，,\s]?(.*)$/);
  if (m) return { contactName: m[1].trim(), content: stripLead(m[2]) };
  m = raw.match(/^发(?:消息|信息|短信)给(.{1,8}?)[：:，,\s]?(.*)$/);
  if (m) return { contactName: m[1].trim(), content: stripLead(m[2]) };
  return null;
}

// ---------------- C2. 闹钟 / 提醒 / 音乐 / 报时 ----------------

/** 闹钟触发词（先于报时意图判定：「闹钟几点响」归闹钟） */
const ALARM_TRIG_RE = /闹钟|叫[我一]?[起醒]|叫我起[床]?|设[个置一]?[个]?闹钟/;

/** 提醒触发词 */
const REMINDER_TRIG_RE = /提醒我|提醒一下|帮我提醒|^提醒|^记一?[条笔下]行?|^帮我记一?[条下]|定[个条]提醒|设[个条]提醒/;

/** 音乐播放触发词（「打开音乐」是纯打开意图，不在这里，由 agent-app-nav 处理） */
const MUSIC_TRIG_RE =
  /^(?:帮我|给我|麻烦)?(?:随便)?(?:放|播|来|听)(?:一?[首点个些段]|点)?(?:首?[歌曲目]|音乐|歌)$|^(?:帮我|给我)?播放(?:一?[首点个]?)?(?:音乐|歌|曲)$|^来[点首]?(?:音乐|歌)$|^随便来?(?:点|首|些)?歌$/;

/** 报时触发词（几点了 / 今天几号 / 星期几…） */
const TIME_TRIG_RE =
  /几点了|现在几点|几点钟|现在时间|什么时间|时间是多少|几号了|今天几号|今天日期|几月几号|今天?是?几月|几号星期|星期几|礼拜几|周几|今天周几|^报个?时|^现在日期/;

export interface AlarmIntent {
  /** HH:mm（空串 = 没听到时间，调用方 TTS 说明） */
  time: string;
  /** 标签（指令剩余文字；空 = 用默认） */
  label: string;
}

/** 识别「定个闹钟 / 闹钟8点 / 明早7点叫我起床」→ 时刻 + 标签 */
export function matchAlarmIntent(text: string): AlarmIntent | null {
  const raw = text.trim();
  if (!raw || raw.length > 40 || !ALARM_TRIG_RE.test(raw)) return null;
  const ck = parseClockTime(raw);
  if (!ck) return { time: '', label: raw.replace(/(定|设|置)[个条一]?|闹钟|叫我|起床|叫醒/g, '').trim() };
  return { time: `${pad2(ck.hour)}:${pad2(ck.minute)}`, label: buildAlarmLabel(raw) };
}

/** 闹钟标签：剥触发词/日期词/时段词/时间词后的剩余（空 = 「语音助手」） */
function buildAlarmLabel(raw: string): string {
  const rest = raw
    .replace(/(定|设|置)[个条一]?/g, '')
    .replace(/闹钟/g, '')
    .replace(/(大后天|后天|明天|明早|明晚|明午|今晚|今早|今天|现在)/g, '')
    .replace(/(下午|傍晚|晚上|夜里|上午|早上|凌晨|中午)/g, '')
    .replace(/(\d{1,2})\s*[点时:：]\s*(半|一刻|\d{1,2})?\s*分?/g, '')
    .replace(/(叫我|叫醒我|起床|吧|呗|呢|啊|哦|了|呀)/g, '')
    .replace(/[，,。：:\s]/g, '')
    .trim();
  return rest || '语音助手';
}

export interface ReminderIntent {
  /** 提醒内容（空 = 「语音助手提醒」） */
  title: string;
  /** YYYY-MM-DD（空串 = 没解析出日期） */
  dueDate: string;
  /** HH:mm（空串 = 没解析出时间） */
  dueTime: string;
  /** 口语时间标签（回复/卡片里展示，如「明天 15:00」「10分钟后」） */
  whenLabel: string;
}

/** 识别「提醒我<时间/内容>」→ 内容 + 尽力解析的到期日期时间 */
export function matchReminderIntent(text: string): ReminderIntent | null {
  const raw = text.trim();
  if (!raw || raw.length > 60 || !REMINDER_TRIG_RE.test(raw)) return null;
  // 剥触发动词，剩下的找时间 + 内容
  const body = raw
    .replace(/^(?:帮我|麻烦你?|麻烦|请)?(?:提醒一下|提醒我|提醒|记一下|记一[条笔]行?|记一[条笔]|定[个条]提醒|设[个条]提醒)/, '')
    .trim();
  // ① 相对时长：「提醒我10分钟后吃药」
  const relMin = parseRelativeMin(body);
  if (relMin !== null) {
    const due = new Date(Date.now() + relMin * 60_000);
    const title = body
      .replace(/(\d{1,3})\s*分[钟鐘]?[之以]?[后後]/, '')
      .replace(/半\s*[小]?\s*[时時計][之以]?[后後]/, '')
      .replace(/([一两二三四五六七八九十\d]{1,2})\s*[个]?\s*[小]?\s*时[之以]?[后後]/, '')
      .replace(/[，,。:：\s]/g, '')
      .trim();
    return {
      title: title || '语音助手提醒',
      dueDate: `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`,
      dueTime: `${pad2(due.getHours())}:${pad2(due.getMinutes())}`,
      whenLabel: relMin >= 60 ? `${Math.round(relMin / 60)}小时后` : `${relMin}分钟后`,
    };
  }
  // ② 绝对时刻
  const ck = parseClockTime(body);
  if (!ck) {
    // 没有钟点：只有日期词（「提醒我明天带伞」）→ 按当天 09:00 默认时刻记提醒；
    // 连日期词也没有（「提醒我吃药」）→ 只记内容，回复里 TTS 说明要自己补时间
    const day = DAY_WORDS.find(([re]) => re.test(body));
    const title = body.replace(/[，,。:：\s]/g, '').trim();
    if (day) {
      const now = new Date();
      const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day[1], 0, 0);
      const cleanTitle = title
        .replace(/(大后天|后天|明天|明早|明晚|明午|今晚|今早|今天|现在)/g, '')
        .replace(/(下午|傍晚|晚上|夜里|上午|早上|凌晨|中午)/g, '')
        .replace(/[，,。:：\s]/g, '')
        .trim();
      return {
        title: cleanTitle || '语音助手提醒',
        dueDate: `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`,
        dueTime: '',
        whenLabel: `${['今天', '明天', '后天', '大后天'][Math.min(3, day[1])]}白天`,
      };
    }
    return { title: title || '语音助手提醒', dueDate: '', dueTime: '', whenLabel: '' };
  }
  // 没说「今天/今晚…」且时刻已过（含 2 分钟宽限）→ 视为下一个该时刻（+1 天）
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ck.dayOffset, ck.hour, ck.minute);
  let dayOffset = ck.dayOffset;
  if (!ck.explicitDay && candidate.getTime() <= now.getTime() + 2 * 60_000) dayOffset += 1;
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, ck.hour, ck.minute);
  const title = body
    .replace(/(大后天|后天|明天|明早|明晚|明午|今晚|今早|今天|现在)/g, '')
    .replace(/(下午|傍晚|晚上|夜里|上午|早上|凌晨|中午)/g, '')
    .replace(/(\d{1,2})\s*[点时:：]\s*(半|一刻|\d{1,2})?\s*分?/g, '')
    .replace(/[，,。:：\s]/g, '')
    .trim();
  return {
    title: title || '语音助手提醒',
    dueDate: `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`,
    dueTime: `${pad2(due.getHours())}:${pad2(due.getMinutes())}`,
    whenLabel: `${['今天', '明天', '后天', '大后天'][Math.min(3, dayOffset)]} ${pad2(ck.hour)}:${pad2(ck.minute)}`,
  };
}

/** 「放首歌 / 播放音乐 / 来点音乐」→ true（纯打开「打开音乐」不在此列） */
export function matchMusicIntent(text: string): boolean {
  const raw = text.trim().replace(/[吧呗呢哦呀啊哈嘛~～]+$/, '').trim();
  if (!raw || raw.length > 24) return false;
  return MUSIC_TRIG_RE.test(raw);
}

/** 「几点了 / 今天几号 / 星期几」→ true */
export function matchTimeIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > 24) return false;
  return TIME_TRIG_RE.test(raw);
}

// ============================================================
// D. 执行器（全部复用既有存储/跳转通道；永不抛错）
// ============================================================

// ---------------- D1. TA / 联系人解析 ----------------

/** 解析 TA（主联系人/恋人角色）：情侣空间绑定优先 → 第一个 CHAR（与 ContactWidget 同口径） */
async function resolveTa(): Promise<ContactRecord | null> {
  try {
    const list = await listContactsFor('sms');
    const partnerId = readInviteMeta().partnerContactId;
    if (partnerId) {
      const byId = list.find((c) => c.id === partnerId && c.kind !== 'user');
      if (byId) return byId;
    }
    return list.find((c) => c.kind === 'char') ?? null;
  } catch {
    return null;
  }
}

/** 按名字找聊天对象（信息 App 口径展示名/真名/昵称/备注包含匹配；找不到 null） */
async function resolveByName(name: string): Promise<ContactRecord | null> {
  try {
    const list = await listContactsFor('sms');
    const q = name.trim().toLowerCase();
    const candidates = list.filter((c) => c.kind !== 'user');
    return (
      candidates.find((c) => displayNameOf(c, 'sms').toLowerCase() === q) ??
      candidates.find((c) => (c.name ?? '').toLowerCase() === q) ??
      candidates.find(
        (c) =>
          displayNameOf(c, 'sms').toLowerCase().includes(q) ||
          (c.nickname ?? '').toLowerCase().includes(q) ||
          (c.remark ?? '').toLowerCase().includes(q) ||
          (c.realName ?? '').toLowerCase().includes(q),
      ) ??
      null
    );
  } catch {
    return null;
  }
}

// ---------------- D2. 发消息 ----------------

/**
 * 发消息直达：解析目标 → 预填草稿（信息 App 草稿箱，内存同步生效）→ 挂起
 * pendingChatContact 直达会话（与快捷联系人小组件同一条通道）。
 * 实际打开信息 App 由调用方在收起会话后执行（out.nav === 'chat'）。
 */
export async function runSendMessage(intent: SendMessageIntent): Promise<CommandOutcome> {
  const content = intent.content.trim().slice(0, 500);
  let contact: ContactRecord | null = null;
  let notFoundName = '';
  if (intent.contactName === null) {
    contact = await resolveTa();
    if (!contact) {
      return {
        ok: false,
        reply: '还没找到能发消息的 TA，先去联系人 App 添加一个角色，或者直接告诉我名字，比如「给某某发消息」。',
        nav: null,
      };
    }
  } else {
    contact = await resolveByName(intent.contactName);
    if (!contact) notFoundName = intent.contactName;
    if (!contact) {
      return {
        ok: false,
        reply: `通讯录里没找到叫「${intent.contactName}」的人，确认下名字，或去联系人 App 先添加 TA。`,
        nav: null,
      };
    }
  }
  const name = displayNameOf(contact, 'sms') || contact.name;
  // ① 跨 App 直达通道：挂起目标联系人（信息 App 打开后自动进入与 TA 的会话）
  useUI.getState().setPendingChatContact(contact.id);
  // ② 草稿预填（有内容才填；没内容只开聊天页）
  if (content) saveChatDraft('sms', `c:${contact.id}`, content);
  return {
    ok: true,
    reply: content
      ? `好嘞，和${name}的聊天打开啦，「${content.slice(0, 18)}」已经帮你填好了~`
      : `好嘞，和${name}的聊天打开啦，你想说什么直接发~`,
    card: {
      title: `直达聊天 · ${name}`,
      detail: content ? `草稿已填好：${content.slice(0, 24)}` : '已进入与 TA 的会话',
    },
    nav: 'chat',
  };
}

// ---------------- D3. 播放音乐 ----------------

/** 放首歌/播放音乐：打开音乐 App + 复用音乐 store 的播放通道（接着放/恢复） */
export async function runMusic(): Promise<CommandOutcome> {
  try {
    const { useMusic } = await import('./music-store');
    await useMusic.getState().boot().catch(() => undefined);
    const st = useMusic.getState();
    if (st.playing && st.current) {
      return {
        ok: true,
        reply: `音乐已经在放啦，正在听《${st.current.name}》~`,
        card: { title: '正在播放', detail: `${st.current.name} · ${st.current.artists?.join('/') ?? ''}` },
        nav: 'music',
      };
    }
    if (!st.queue.length) {
      return {
        ok: true,
        reply: '音乐里还没有可播的歌，打开后挑一首喜欢的吧~',
        card: { title: '已打开 音乐', detail: '播放队列为空，去挑一首歌' },
        nav: 'music',
      };
    }
    st.toggle(); // 复用现有播放通道：无 current → 从队列当前位接着放；暂停 → 恢复
    const cur = useMusic.getState().current;
    return {
      ok: true,
      reply: cur ? `好嘞，《${cur.name}》放起来了~` : '好嘞，音乐放起来了~',
      card: { title: '开始播放', detail: cur ? `${cur.name} · ${cur.artists?.join('/') ?? ''}` : '从上次听的位置继续' },
      nav: 'music',
    };
  } catch {
    return { ok: false, reply: '音乐这会儿打不开，稍后再试试？', nav: null };
  }
}

// ---------------- D4. 提醒 / 闹钟 ----------------

/** 建提醒：localDB 'reminders'（提醒事项 App 同一张表，ReminderWatcher 全局到期照常响） */
export async function runReminder(intent: ReminderIntent): Promise<CommandOutcome> {
  const rec: ReminderRecord = {
    id: genId(),
    title: intent.title.slice(0, 60),
    notes: '语音助手创建',
    completed: false,
    flagged: false,
    dueDate: intent.dueDate,
    dueTime: intent.dueTime,
    createdAt: Date.now(),
    completedAt: null,
  };
  try {
    await localDB.put('reminders', rec);
  } catch {
    return { ok: false, reply: '提醒没存上（本地存储不可用），稍后再试一次？', nav: null };
  }
  if (!intent.dueDate || !intent.dueTime) {
    return {
      ok: true,
      reply: `「${intent.title}」记到提醒事项啦，不过没听到具体时间，记得进去补一下什么时候提醒你~`,
      card: { title: '已建提醒', detail: intent.title },
      nav: 'reminders',
    };
  }
  return {
    ok: true,
    reply: `好嘞，${intent.whenLabel}提醒你「${intent.title}」~`,
    card: { title: '已建提醒', detail: `${intent.title} · ${intent.whenLabel}` },
    nav: 'reminders',
  };
}

/** 设闹钟：localDB 'alarms'（时钟 App 同一张表，AlarmWatcher 全局响铃照常生效） */
export async function runAlarm(intent: AlarmIntent): Promise<CommandOutcome> {
  if (!intent.time) {
    return {
      ok: false,
      reply: '闹钟要定几点？可以说「定个闹钟 8 点」或者「明早 7 点叫我起床」告诉我时间。',
      nav: null,
    };
  }
  const rec: AlarmRecord = {
    id: genId(),
    time: intent.time,
    label: intent.label.slice(0, 30) || '语音助手',
    enabled: true,
    repeat: [],
    createdAt: Date.now(),
  };
  try {
    await localDB.put('alarms', rec);
  } catch {
    return { ok: false, reply: '闹钟没存上（本地存储不可用），稍后再试一次？', nav: null };
  }
  return {
    ok: true,
    reply: `好嘞，${intent.time} 的闹钟定好了${intent.label && intent.label !== '语音助手' ? `，备注「${intent.label}」` : ''}~`,
    card: { title: '已设闹钟', detail: `${intent.time} · ${intent.label || '语音助手'}（仅一次）` },
    nav: 'clock',
  };
}

// ---------------- D5. 报时 ----------------

/** 「几点了/今天几号」：本地报时（含星期与农历，复用 lunar.ts），不切页面 */
export function runTimeReport(): CommandOutcome {
  const now = new Date();
  const hh = now.getHours();
  const clockText = `${pad2(hh)}:${pad2(now.getMinutes())}`;
  const partLabel = hh < 6 ? '凌晨' : hh < 12 ? '上午' : hh < 13 ? '中午' : hh < 18 ? '下午' : '晚上';
  const solar = formatSolarShort(now);
  let lunar = '';
  try {
    lunar = formatLunarDate(now);
  } catch {
    /* 农历计算失败不影响报时 */
  }
  const minuteWord = now.getMinutes() === 0 ? '' : `${now.getMinutes()}分`;
  const hourWord = `${partLabel}${hh % 12 === 0 ? 12 : hh % 12}点${minuteWord}`;
  const reply = lunar
    ? `现在是${hourWord}，${solar}，农历${lunar.slice(lunar.indexOf('年') + 1)}。`
    : `现在是${hourWord}，${solar}。`;
  return {
    ok: true,
    reply,
    card: { title: '现在时间', detail: `${solar} ${clockText}` },
    nav: null,
  };
}
