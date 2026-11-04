'use client';

/**
 * AI 主动来电调度（Task 40-d）——让 AI 真正「自主决定 + 定时拨打」语音电话：
 *
 * ProactiveCallWatcher（PhoneShell 挂载）定期调 runProactiveCallTick()：
 * ① 总开关（设置 › 通知「AI 主动来电」，kv 'proactive-call-enabled'，默认开）关闭 → 返回；
 * ② 深夜硬闸（本地时间 0~8 点不打；23 点后的晚间分寸交给决策 API 按人设判断）；
 * ③ 已有来电响铃（useIncomingCall.call）或全局通话进行中（useGlobalCall.session）→ 返回；
 *    页面切后台（document.hidden）不拦——真实手机来电不看屏幕（本模块不做可见性检查）；
 * ④ 候选筛选：AI 联系人（USER/无名排除）中，取 48h 内有互动且
 *    距上次互动 ≥2h（刚聊完不马上打）、且不在冷却期（call/wait 冷却 6h、skip 冷却 24h）
 *    的联系人里「最久没聊」的一位；
 * ⑤ 组三端最近聊天摘要（微信/QQ/信息各取最近 4 条文本/转写，单条截 60 字）POST
 *    /api/phone/proactive 决策 → 落冷却 kv → action='call' 时经 triggerIncomingCall
 *    真正发起 iOS 全屏来电（接听/拒绝/超时回调与信息 App AI 来电同一套链路）。
 *
 * 接听 → setPendingPhoneAnswer(含 proactiveContext=决策 reason 作为开场情境) + 切电话 App
 * （照抄 chat.tsx onAnswer 做法）；拒绝/超时 → recordMissedPhoneCall 落未接记录 + AI 语音留言
 * （照抄 chat.tsx 同名函数的落库模式）。通话内容/挂断收尾/记忆沉淀由电话 App 既有引擎承担。
 */

import { localDB, genId, type CallLogRecord } from './db';
import { kvGet, kvSet } from './idb-kv';
// 多账号（Task 40-2d v2）：电话记录归属/读取按电话 App 当前账号；机主身份也按电话账号取
import { getActiveAccountIdFor } from './accounts';
import { listContacts, ownerProfileFor } from './contacts-store';
import { avatarFor } from '@/lib/contacts';
import { requestCallFollowup } from './call-followup';
import { setPendingPhoneAnswer, triggerIncomingCall, useIncomingCall } from './incoming-call';
import { useGlobalCall } from './global-call';
import { useSettings, useUI } from './store';
import { buildNpcPromptExtra } from './npc-bond';
import { BLOCK_CHANNEL, loadBlock } from './block-state';
import { isDndWindowActive } from './notify-sound';
import { markAiCall, recentAiCallWithin } from './ai-call-guard';
import { getMemSettings, memRecallBlock } from '@/lib/memory';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { getReplyCount } from '@/lib/reply-count';
import { isBranchBirthSilent } from './branch-meta';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 常量与档位（调参集中在这里） ----------------

/** 总开关 kv 键（与设置 › 通知「AI 主动来电」开关共用；值 { value: boolean }，缺省=开） */
const ENABLED_KEY = 'proactive-call-enabled';
/** 频率档位 kv 键（值 { level: ProactiveLevel }，缺省='standard'）；设置页可切换 4 档 */
const LEVEL_KEY = 'proactive-call-level';
/** 单联系人冷却 kv 键前缀（值 { at: number, action: string, window?: number }） */
const COOLDOWN_PREFIX = 'proactive-call:';

/** 频率档位（设置页「主动来电频率」4 档）：
 *  - conservative 保守：冷却长，几乎不主动打（6h/24h，最小间隔 2h，tick 120s）
 *  - standard 标准（缺省，体验优先）：30min 最小间隔、1h 冷却、tick 60s——AI 主动但不暴走
 *  - eager 积极：10min 最小间隔、15min 冷却、tick 45s——AI 非常主动
 *  - off 无冷却：仅留 10min per-contact 自然冷却 + 60s tick 全局节流（防 90s 内连拨同一人）
 */
export type ProactiveLevel = 'conservative' | 'standard' | 'eager' | 'off';

interface ProactiveLevelPreset {
  /** 资格窗口：48h 内有互动才考虑（各档一致，不动） */
  activeWindowMs: number;
  /** 最小间隔：距上次互动不足此时长不打（per-contact 自然冷却底线，去冷却方案唯一保护） */
  minGapMs: number;
  /** 决策为 call / wait 后的冷却 */
  cooldownActiveMs: number;
  /** 决策为 skip 后的冷却 */
  cooldownSkipMs: number;
  /** 深夜硬闸终点小时（0~N 点不打） */
  nightEndHour: number;
  /** Watcher 首次 tick 延迟 */
  firstTickDelayMs: number;
  /** Watcher 基础轮询间隔 */
  tickIntervalMs: number;
  /** 每次 tick 的随机抖动上限 */
  tickJitterMs: number;
  /** 决策为 call 但触发前已有通话/闹钟时的短冷却 */
  shortCooldownMs: number;
}

const LEVEL_PRESETS: Record<ProactiveLevel, ProactiveLevelPreset> = {
  conservative: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 2 * 60 * 60_000, // 2h
    cooldownActiveMs: 6 * 60 * 60_000, // 6h
    cooldownSkipMs: 24 * 60 * 60_000, // 24h
    nightEndHour: 8,
    firstTickDelayMs: 60_000,
    tickIntervalMs: 120_000,
    tickJitterMs: 30_000,
    shortCooldownMs: 5 * 60 * 1000,
  },
  standard: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 30 * 60_000, // 30min（刚聊完 30min 内不打）
    cooldownActiveMs: 60 * 60_000, // 1h
    cooldownSkipMs: 60 * 60_000, // 1h
    nightEndHour: 8,
    firstTickDelayMs: 20_000, // 20s
    tickIntervalMs: 60_000, // 60s
    tickJitterMs: 30_000,
    shortCooldownMs: 120_000, // 2min
  },
  eager: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 10 * 60_000, // 10min
    cooldownActiveMs: 15 * 60_000, // 15min
    cooldownSkipMs: 15 * 60_000, // 15min
    nightEndHour: 8,
    firstTickDelayMs: 15_000, // 15s
    tickIntervalMs: 45_000, // 45s
    tickJitterMs: 15_000,
    shortCooldownMs: 60_000, // 1min
  },
  off: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 10 * 60_000, // 10min（per-contact 自然冷却底线——防 90s 内连拨同一人）
    cooldownActiveMs: 0, // 无冷却
    cooldownSkipMs: 0, // 无冷却
    nightEndHour: 8, // 深夜硬闸仍保留（防吵醒）
    firstTickDelayMs: 15_000,
    tickIntervalMs: 60_000, // 60s（全局节流）
    tickJitterMs: 15_000,
    shortCooldownMs: 120_000, // #101 2min（> tickInterval 60s，防触发被阻后 60s 后又选同候选重击决策 API）
  },
};

/** 读取当前档位（kv 'proactive-call-level'，缺省='standard' 体验优先） */
export function getProactiveLevel(): ProactiveLevel {
  const v = kvGet<{ level?: unknown }>(LEVEL_KEY);
  const lv = v?.level;
  if (lv === 'conservative' || lv === 'standard' || lv === 'eager' || lv === 'off') return lv;
  return 'standard';
}

/** 写入当前档位（设置页切换时调用） */
export function setProactiveLevel(level: ProactiveLevel): void {
  kvSet(LEVEL_KEY, { level });
}

/** 取当前档位预设（运行时所有常量从这里读，切档即时生效——下次 tick 即用新值） */
function preset(): ProactiveLevelPreset {
  return LEVEL_PRESETS[getProactiveLevel()];
}

/** 动态读取档位的 tick 调度参数（切档后下次 tick 即用新值）——ProactiveCallWatcher 用 */
export function getProactiveTickParams(): { firstDelay: number; interval: number; jitter: number } {
  const p = preset();
  return { firstDelay: p.firstTickDelayMs, interval: p.tickIntervalMs, jitter: p.tickJitterMs };
}

/** 决策 API 返回（与 /api/phone/proactive 契约一致） */
interface ProactiveDecision {
  action: 'call' | 'wait' | 'skip';
  reason: string;
  /** C14 主动来电媒体：决策端可选 video（仅当关系亲密/常视频时）；缺省 voice */
  media?: 'voice' | 'video';
}
// ---------------- 开关（settings.tsx 共用） ----------------

/** AI 主动来电总开关（kv 'proactive-call-enabled'，无记录/非法值=默认开） */
/** C3：主动来电档位是否 off（聊天标记来电入口用：用户关闭「AI 主动来电」时，
 *  [语音通话]/[视频通话] 标记也不再真的拨出——off = 关闭 AI 自发的全部来电通道） */
export function isProactiveCallOff(): boolean {
  return getProactiveLevel() === 'off';
}

export function isProactiveCallEnabled(): boolean {
  const v = kvGet<{ value?: unknown }>(ENABLED_KEY);
  return typeof v?.value === 'boolean' ? v.value : true;
}

/** 写入 AI 主动来电总开关（设置页切换时调用） */
export function setProactiveCallEnabled(value: boolean): void {
  kvSet(ENABLED_KEY, { value });
}

// ---------------- 消息读取（wx / qq / 信息三端 kv 键；数组按时间升序，末条=最新） ----------------

const WX_MSGS_KEY = (id: string): string => `wx-chat-msgs:${id}`;
const QQ_MSGS_KEY = (id: string): string => `qq-chat-msgs:${id}`;
/** 信息 App 会话键：storageKey = `c:<contactId>`（AI 助手会话不在候选范围，无需处理） */
const SMS_MSGS_KEY = (id: string): string => `ios-chat-msgs:c:${id}`;

/** 三端消息归一化后的最小形状 */
interface NormMsg {
  role: 'user' | 'assistant';
  text: string;
  time: number;
}

function readKvMsgs(key: string): unknown[] {
  const raw = kvGet<unknown>(key);
  return Array.isArray(raw) ? raw : [];
}

/** 末条时间戳（数组按时间升序持久化，末条=最新；空会话返回 0） */
function lastTimeOf(list: unknown[]): number {
  const last = list[list.length - 1] as { time?: unknown } | undefined;
  return last && typeof last.time === 'number' ? last.time : 0;
}

/** 单条消息 → 可读文本（转写/描述优先；撤回/系统行/卡片类返回空串 = 不进摘要） */
function extractMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.error === true) return '';
  if (r.sys || r.blkreq || r.notice) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  // 卡片类（红包/转账/通话卡/转发/群邀请）不产生可聊文本
  if (
    kind === 'call' ||
    kind === 'redpacket' ||
    kind === 'transfer' ||
    kind === 'family' ||
    kind === 'forward' ||
    kind === 'groupcard' ||
    kind === 'blockreq' ||
    kind === 'sys'
  ) {
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
      if (d) return `[图片] ${d}`;
      return content && !content.startsWith('data:') ? `[图片] ${content}` : '[图片]';
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
      return content.startsWith('data:') ? '[图片]' : content; // 旧图片消息 content 直接存 dataURL
  }
}

function toNormMsg(m: unknown): NormMsg | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  // 微信/QQ 用 me/peer，信息用 user/assistant
  const role =
    r.role === 'user' || r.role === 'me'
      ? ('user' as const)
      : r.role === 'assistant' || r.role === 'peer'
        ? ('assistant' as const)
        : null;
  if (!role || typeof r.time !== 'number') return null;
  const text = extractMsgText(r);
  if (!text.trim()) return null;
  return { role, text, time: r.time };
}

function readNormMsgs(key: string): NormMsg[] {
  return readKvMsgs(key)
    .map(toNormMsg)
    .filter((m): m is NormMsg => m !== null)
    .sort((a, b) => a.time - b.time); // 防御性排序（投递尾巴可能轻微乱序），slice(-N) 才是真正的「最近」
}

// ---------------- 展示格式化 ----------------

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 摘要条目时间：今天 HH:MM，跨天 M月D日 HH:MM */
function fmtChatTime(t: number, nowMs: number): string {
  const d = new Date(t);
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return new Date(nowMs).toDateString() === d.toDateString() ? hhmm : `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** 距上次互动的人类口径（「约 N 小时」，决策 prompt 用） */
function gapLabel(gapMs: number): string {
  const mins = Math.max(1, Math.round(gapMs / 60000));
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 当前时间完整表述（决策 prompt 用：年月日+星期+时刻） */
function fmtNow(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK_CN[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 联系人无手机号时的稳定占位号（与 chat.tsx derivePlaceholderNumber 同算法：同一联系人恒定同号） */
function derivePlaceholderNumber(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `1${String(h % 10000000000).padStart(10, '0')}`;
}

// ---------------- 冷却 kv ----------------

function cooldownKey(contactId: string): string {
  return `${COOLDOWN_PREFIX}${contactId}`;
}

function isCoolingDown(contactId: string, nowMs: number): boolean {
  const c = kvGet<{ at?: unknown; action?: unknown; window?: unknown }>(cooldownKey(contactId));
  if (!c || typeof c.at !== 'number') return false;
  // #103 优先用 record 内固化的 window（setCooldown/setShortCooldown 写入），跨档切换语义清晰：
  //   conservative 设的 6h 冷却不会被切到 standard 后缩短为 1h；off 档设的 0 不会被切到 conservative 后变长
  if (typeof c.window === 'number' && c.window > 0) return nowMs - c.at < c.window;
  if (typeof c.window === 'number' && c.window === 0) return false; // off 档固化 0=无冷却
  // 兜底：旧 record 无 window 字段，按当前档位 action 推导（向后兼容）
  const p = preset();
  const window = c.action === 'skip' ? p.cooldownSkipMs : p.cooldownActiveMs;
  return nowMs - c.at < window;
}

/** #103 setCooldown 固化当前档位的冷却时长到 record.window，跨档切换不改变已有冷却的剩余时长 */
function setCooldown(contactId: string, at: number, action: ProactiveDecision['action']): void {
  const p = preset();
  const window = action === 'skip' ? p.cooldownSkipMs : p.cooldownActiveMs;
  kvSet(cooldownKey(contactId), { at, action, window });
}

/** #52 短冷却（5min）：决策为 call 但触发前发现已有通话/闹钟时使用——
 *  联系人未被真拨打不应被记 6h 冷却，但完全无冷却会 90s 后又选到同一联系人再次决策浪费一次 API 调用。 */
function setShortCooldown(contactId: string, at: number): void {
  kvSet(cooldownKey(contactId), { at, action: 'wait', window: preset().shortCooldownMs });
}

// ---------------- B5 拒接负反馈冷却（此前拒接/未接不累计惩罚，反复拒接 N 次行为不变） ----------------

const REJECT_STREAK_KEY = (contactId: string) => `proactive-call-reject:${contactId}`;
/** 单次惩罚倍率：连续拒接 0/1/2/≥3 次时，下次 call 冷却 ×1/×2/×4/×6，封顶 24h */
const REJECT_FACTOR_MAX = 6;
const REJECT_PENALTY_CAP_MS = 24 * 60 * 60_000;
/** 计数时效：超过 48h 无新的拒接则从零计（旧账不无限累积） */
const REJECT_STREAK_TTL_MS = 48 * 60 * 60_000;

function rejectStreakOf(contactId: string, nowMs: number): number {
  const r = kvGet<{ count?: unknown; at?: unknown }>(REJECT_STREAK_KEY(contactId));
  if (!r || typeof r.count !== 'number' || r.count <= 0) return 0;
  if (typeof r.at !== 'number' || nowMs - r.at > REJECT_STREAK_TTL_MS) return 0;
  return r.count;
}

/** 拒接/未接一通 AI 主动来电：计数 +1（recordMissedPhoneCall 调用） */
function bumpRejectStreak(contactId: string, nowMs: number): void {
  const prev = rejectStreakOf(contactId, nowMs);
  kvSet(REJECT_STREAK_KEY(contactId), { count: prev + 1, at: nowMs });
}

/** 用户接听了 AI 来电：负反馈清零（关系正常，冷却回基准档） */
function clearRejectStreak(contactId: string): void {
  kvSet(REJECT_STREAK_KEY(contactId), { count: 0, at: Date.now() });
}

/** 真拨出 AI 主动来电时落冷却：按连续拒接次数乘惩罚倍率（B5），封顶 24h */
function setCallCooldownWithPenalty(contactId: string, at: number): void {
  const streak = rejectStreakOf(contactId, at);
  const factor = Math.min(1 + streak, REJECT_FACTOR_MAX);
  const window = Math.min(preset().cooldownActiveMs * factor, REJECT_PENALTY_CAP_MS);
  kvSet(cooldownKey(contactId), { at, action: 'call', window });
}

// ---------------- 决策请求 ----------------

/** 决策失败（网络/超时/非 200）返回 null，由调用方按 wait 口径落冷却 */
async function requestProactiveDecision(args: {
  contact: Record<string, unknown>;
  // fix3-1 摘要条目带 role：决策端渲染「机主：/你：」前缀，防把机主说的话当成 AI 自己说的
  recentChats: { app: string; text: string; time: string; role: 'user' | 'assistant' }[];
  lastChatAt: number;
  lastInteractionLabel: string;
  now: string;
  // G-2 跨 App 拉黑情境：wx/qq 被用户拉黑（来电路径不受影响）→ 决策端要知道
  //「这次来电可能是被拉黑后来电话找机主」，call 时 reason 会带上这层动机作为接通开场
  crossBlockedIn?: string;
  // 机主称呼（真实名字；用户规则：AI 永远不知道机主昵称，userNickname 不再下传）；缺省回退「用户」占位词
  userRealName?: string;
  // 多账号关系感知：当前电话账号 id（小号读分账号关系；不传 = 大号口径）
  accountId?: string;
}): Promise<ProactiveDecision | null> {
  try {
    const res = await fetch('/api/phone/proactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, config: useSettings.getState().apiConfig }),
      // 看门狗：决策卡死 75s 必失败（覆盖上游 30s + 内置模型 60s 的最坏组合不再拖住调度）
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { action?: unknown; reason?: unknown; media?: unknown };
    const action =
      data.action === 'call' || data.action === 'wait' || data.action === 'skip' ? data.action : 'skip';
    const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 120) : '';
    return { action, reason };
  } catch {
    return null;
  }
}

// ---------------- 未接留言（照抄 chat.tsx recordMissedPhoneCall 的落库模式） ----------------

/** AI 主动打来的电话被拒接 / 响铃超时未接：落「未接来电」记录 + AI 语音留言（失败静默） */
async function recordMissedPhoneCall(
  contact: ContactRecord,
  number: string,
  fallbackName: string,
  reason: 'declined' | 'timeout'
): Promise<void> {
  const contactId = contact.id;
  const displayName = contact.name || fallbackName;
  // #17 拉黑守卫：用户在「信息」App 拉黑了该角色 → 仍落 call-logs 留历史记录，但 voicemails（AI 留言）不写
  // （避免「我已把你拉黑，你却还在给我语音留言」的体验断裂；call-logs 保留以便用户回看未接来电历史）
  const blockedByUser = loadBlock('sms', contactId).byUser === true;
  // B5 拒接负反馈：被拒/超时计数 +1（下次主动来电冷却乘惩罚倍率；接通时清零）
  bumpRejectStreak(contactId, Date.now());
  try {
    await localDB.put('call-logs', {
      id: genId(),
      number,
      contactId,
      displayName,
      peerKind: (contact.kind as CallLogRecord['peerKind']) ?? 'unknown',
      avatar: avatarFor(contact, 'phone'),
      direction: 'missed',
      duration: 0,
      // 多账号（Task 40-2d）：记录归属电话 App 当前账号（旧记录无此字段视为大号）
      account: getActiveAccountIdFor('phone'),
      createdAt: Date.now(),
    });
  } catch {
    // 记录落盘失败静默
  }
  if (blockedByUser) return; // 用户拉黑了角色：不写语音留言（call-logs 已留历史记录）
  try {
    const [owner, recent] = await Promise.all([
      // 多账号（Task 40-2d）：机主身份按电话 App 当前账号取（留言落在该账号名下，
      // AI 称呼也要用该账号的「我」：大号=机主，小号/匿名号=档案/注册表名）
      ownerProfileFor('phone').catch(() => null),
      Promise.resolve(readNormMsgs(SMS_MSGS_KEY(contact.id))),
    ]);
    const recentChat = recent.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    const texts = await requestCallFollowup({
      contact: {
        name: contact.name,
        kind: contact.kind,
        gender: contact.gender || null,
        age: contact.age || null,
        height: contact.height || null,
        weight: contact.weight || null,
        occupation: contact.occupation || null,
        company: contact.company || null,
        region: contact.region || null,
        relation: contact.relation || null,
        relationByAcc: contact.relationByAcc ?? null,
        relationToUser: contact.relationToUser || null,
        birthday: contact.birthday || null,
        persona: contact.persona || null,
        background: contact.background || null,
        expressStyle: contact.expressStyle || null,
        customRules: contact.customRules ?? null,
        nickname: contact.nickname || null,
        // 真实姓名用 realName 字段（name 在展示层可能已被昵称/备注替换，注入人设必须是真名）
        realName: contact.realName ?? null,
      },
      // AI 是主叫（direction='out'）；被拒接 = reject、响铃超时 = missed-in（与现有场景文案语义一致）
      direction: 'out',
      endReason: reason === 'declined' ? 'reject' : 'missed-in',
      connected: false,
      duration: 0,
      transcript: [],
      recentChat,
      // #78 电话通话的 missed 留言记忆召回 app 应是 'phone'（与 phone.tsx:1089 挂断续聊一致），原 'sms' 误写
      memoryBlock: memRecallBlock(contact.id, 'phone', recentChat.map((m) => m.content).join(' ')) || undefined,
      timeBlock: buildTimeAwareBlock({
        lastMsgTime: recent.length > 0 ? recent[recent.length - 1].time : null,
        regionHint: contact.region || null,
      }),
      multiApp: getMemSettings(contact.id).share,
      // 留言条数 = 该联系人在信息聊天设置页选定的回复条数（与信息 App 来电留言同口径）
      replyCount: getReplyCount(`sms:c:${contact.id}`),
      // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
      userRealName: owner?.realName || undefined,
      // 多账号关系感知：留言归属当前电话账号，分账号关系同口径（与 call-logs/owner 同一账号）
      accountId: getActiveAccountIdFor('phone'),
    });
    for (const text of texts) {
      await localDB.put('voicemails', {
        id: genId(),
        number,
        contactId,
        displayName,
        peerKind: (contact.kind as CallLogRecord['peerKind']) ?? 'unknown',
        avatar: avatarFor(contact, 'phone'),
        text,
        kind: 'voicemail',
        read: false,
        duration: Math.max(1, Math.ceil(text.length / 4)),
        // 多账号（Task 40-2d）：留言归属电话 App 当前账号（与上方 call-logs 同一账号）
        account: getActiveAccountIdFor('phone'),
        createdAt: Date.now(),
      });
    }
  } catch {
    // 留言失败静默（记录已落，留言缺失可接受）
  }
}

// ---------------- 决策 prompt 的联系人资料（与 chat.tsx 同字段口径） ----------------

/** #79 NPC 配角圈/归属者资料卡（与 phone.tsx:847 同款 `...(npcExtra ?? {})` 模式）。
 *  npcExtra 由调用方现场构建（需要全部联系人列表，调用方在 tickInner 已加载） */
function contactPayloadOf(
  c: ContactRecord,
  npcExtra: ReturnType<typeof buildNpcPromptExtra> = null,
): Record<string, unknown> {
  return {
    name: c.name,
    kind: c.kind,
    gender: c.gender || null,
    age: c.age || null,
    height: c.height || null,
    weight: c.weight || null,
    occupation: c.occupation || null,
    company: c.company || null,
    region: c.region || null,
    relation: c.relation || null,
    relationByAcc: c.relationByAcc ?? null,
    relationToUser: c.relationToUser || null,
    birthday: c.birthday || null,
    persona: c.persona || null,
    background: c.background || null,
    expressStyle: c.expressStyle || null,
    customRules: c.customRules ?? null,
    nickname: c.nickname || null,
    realName: c.realName ?? null,
    // NPC 字段（ownerLabel/npcCircle/ownerCard/backgroundNotes）：NPC 角色的归属者/配角圈上下文
    // 在主动来电决策里与电话 App 通话 turn 同款注入（与 phone.tsx:847 `...(npcExtra ?? {})` 同模式）
    ...(npcExtra ?? {}),
  };
}

// ---------------- tick 主流程 ----------------

/** 模块级防重入：tick 进行中（含决策请求期间）再次调用直接返回 */
let tickRunning = false;

/** 测试/调试辅助：tick 是否正在执行 */
export function isProactiveCallTickRunning(): boolean {
  return tickRunning;
}

/**
 * 调度 tick（ProactiveCallWatcher 定期调用；决策到 call 才真正响铃，全链路失败静默）。
 * 时序：守卫 → 选人 → 决策 → 落冷却 → 发起来电（接听/未接回调与既有链路对接）。
 */
export async function runProactiveCallTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await tickInner();
  } catch {
    // 后台增强能力：任何异常静默（IndexedDB/网络故障不影响正常使用）
  } finally {
    tickRunning = false;
  }
}

async function tickInner(): Promise<void> {
  const nowMs = Date.now();

  // ① 总开关
  if (!isProactiveCallEnabled()) return;

  // ①-b 档位闸（性能+行为修复）：off = 关闭主动来电——原先 off 档只是冷却参数归零，
  // tick 仍每 60s 空转并对合格候选发决策 API（烧 token），决策为 call 时还会真的拨出。
  // 现在直接短路：不轮询、不决策、不拨出
  if (getProactiveLevel() === 'off') return;

  // ② 深夜硬闸：本地时间 [23, 8) 不打（B1 统一口径——与主动消息自主档静默窗口和决策 prompt
  // 「23 点到早 8 点不打」一致；此前 [0,8) 让 23-24 点全靠 LLM 自觉、无硬闸兜底）
  const hourNow = new Date(nowMs).getHours();
  if (hourNow >= 23 || hourNow < preset().nightEndHour) return;
  // ②-b 系统免打扰时段（设置›通知的全局 DND）不打：用户配置「22:00-08:00 免打扰」后，
  // AI 不得在该时段主动来电叫醒（B1：此前 DND 只静音提示音，拦不住全屏来电+响铃）
  if (isDndWindowActive(new Date(nowMs))) return;

  // ③ 交互中守卫：已有来电响铃或通话进行中不发起（页面后台 document.hidden 照常——真实手机行为）
  if (useIncomingCall.getState().call) return;
  if (useGlobalCall.getState().session) return;
  // #8 电话 App 通话全屏层进行中（CallScreen 拨出/接听中）同样不打：来电叠加会双音频抢麦克风
  if (useUI.getState().callActive) return;
  // #34 闹钟响铃中不主动拨出：闹钟铃声与通话音频重叠体验差，等闹钟被处理后再考虑
  if (useUI.getState().alarmRinging) return;

  // ④ 候选：AI 联系人（USER/无名排除；人设非空不再要求——与主动消息/普通聊天同口径，
  // persona.ts 对空人设有自然兑底；用户反馈「设置了定时到点不发」同源静默跳过问题）；
  // G-2 口径修正——来电走电话通道，
  // 电话只受「信息」App 拉黑影响（与 phone.tsx 通话守卫同款读 sms 键）：微信/QQ 被拉黑
  // 不再排除主动来电——那正是「被拉黑后去别的 App 找用户」的来电路径（G-1 的电话版）；
  // sms byUser 仍排除：来电会被 #17 守卫拦留言+通话静默成死寂；sms byChar 同款排除
  //（fix4 L16 理由不变：角色已拉黑用户还主动打来只会撞上电话引擎 #40 守卫变成
  //「来电即被拦+静默挂断」的怪链路。requestOnly 仅由 byUser 派生，来电无该放行需求）
  const allContacts = await listContacts();
  const contacts = allContacts.filter(
    (c) =>
      c.kind !== 'user' &&
      !!c.name?.trim() &&
      !loadBlock('sms', c.id).byUser &&
      !loadBlock('sms', c.id).byChar &&
      // Task 38（1A）：出生静默期的分支角色不主动来电——复制的历史聊天会让它刚出生就带着
      // 「48h 内有互动」的资格且无冷却保护，时间线停在分支点的角色突然打来电话叙事穿帮
      !isBranchBirthSilent(c.id)
  );
  if (contacts.length === 0) return;

  // 各联系人最近一通电话时间（IndexedDB 一次 getAll，按联系人取 max createdAt；只统计电话 App 当前账号的记录）
  const lastCallAtByContact = new Map<string, number>();
  try {
    const phoneAccId = getActiveAccountIdFor('phone');
    for (const log of await localDB.getAll('call-logs')) {
      if (!log || typeof log.contactId !== 'string' || typeof log.createdAt !== 'number') continue;
      // 多账号（Task 40-2d）：其他电话账号的通话记录不算互动（旧记录无 account 字段视为大号）
      if ((log.account ?? 'main') !== phoneAccId) continue;
      const prev = lastCallAtByContact.get(log.contactId) ?? 0;
      if (log.createdAt > prev) lastCallAtByContact.set(log.contactId, log.createdAt);
    }
  } catch {
    // 通话记录读不到时仅按三端消息判互动
  }

  // 资格筛选（#53 满足条件的联系人为候选；按「最久没聊」加权随机选取，
  // 避免同一最久者每 90s 被反复占用直到进入冷却，其余合格者饿死）
  // #104 preset() hoist 到循环外（避免每个候选调一次；isCoolingDown 内部仍会调但属必要读取）
  const p = preset();
  const candidates: { contact: ContactRecord; lastInteractionAt: number; weight: number }[] = [];
  for (const c of contacts) {
    const lastInteractionAt = Math.max(
      lastTimeOf(readKvMsgs(WX_MSGS_KEY(c.id))),
      lastTimeOf(readKvMsgs(QQ_MSGS_KEY(c.id))),
      lastTimeOf(readKvMsgs(SMS_MSGS_KEY(c.id))),
      lastCallAtByContact.get(c.id) ?? 0
    );
    if (lastInteractionAt <= 0) continue; // 从未互动（新联系人先聊过天再说）
    const gap = nowMs - lastInteractionAt;
    if (gap > p.activeWindowMs) continue; // 48h 内无互动
    if (gap < p.minGapMs) continue; // 刚聊完不久
    if (isCoolingDown(c.id, nowMs)) continue; // 冷却中
    // 权重 = sqrt(gap)（#94 收敛偏度）：最久者与次久者权重差距从线性 24:1 缩到 √24:1 ≈ 5:1，让次久没聊者也有合理机会
    candidates.push({ contact: c, lastInteractionAt, weight: Math.sqrt(gap) });
  }
  if (candidates.length === 0) return;
  // 加权随机：累计权重 + 随机落点（权重越大越可能命中，最久者最可能但不独占）
  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  let best = candidates[0];
  if (totalWeight > 0) {
    let r = Math.random() * totalWeight;
    for (const cand of candidates) {
      r -= cand.weight;
      if (r <= 0) {
        best = cand;
        break;
      }
    }
  }

  const contact = best.contact;

  // ⑤ 三端最近聊天摘要（各取最近 4 条，单条截 60 字，带 App 标签与时间）
  const recentChats = (
    [
      { key: WX_MSGS_KEY(contact.id), app: '微信' },
      { key: QQ_MSGS_KEY(contact.id), app: 'QQ' },
      { key: SMS_MSGS_KEY(contact.id), app: '信息' },
    ] as const
  ).flatMap(({ key, app }) =>
    readNormMsgs(key)
      .slice(-4)
      // fix3-1 归属修复：NormMsg 已解析出 role（wx/qq 的 me/peer 与信息的 user/assistant 已归一），
      // 随摘要一起传给决策 API——「谁说的」不能在拼装摘要时丢掉
      .map((m) => ({ app, text: m.text.slice(0, 60), time: fmtChatTime(m.time, nowMs), role: m.role }))
  );

  // G-2：跨 App 拉黑情境（wx/qq 被用户拉黑 → 这次来电可能是「被拉黑后来电话找机主」，
  // 与 G-1 消息版同语义；sms 拉黑已在上游候选阶段排除，不需要传）
  const crossBlockedIn = (['wx', 'qq'] as const)
    .filter((a) => loadBlock(a, contact.id).byUser === true)
    .map((a) => BLOCK_CHANNEL[a])
    .join('、');

  const decision = await requestProactiveDecision({
    contact: contactPayloadOf(contact, buildNpcPromptExtra(contact, allContacts)),
    recentChats,
    lastChatAt: best.lastInteractionAt,
    lastInteractionLabel: gapLabel(nowMs - best.lastInteractionAt),
    now: fmtNow(nowMs),
    ...(crossBlockedIn ? { crossBlockedIn } : {}),
    // 机主称呼 + 多账号关系感知：只传真名（用户规则：AI 永远不知道机主昵称）
    ...(await ownerProfileFor('phone')
      .then((o) => ({
        userRealName: o?.realName || undefined,
      }))
      .catch(() => ({}))),
    accountId: getActiveAccountIdFor('phone'),
  });

  // 决策失败（null）：不再按 wait 落 6h 冷却——API 挂了 ≠ AI 决定不打，6h 冷却会让 AI 在
  // API 不稳的时段「从不主动打来」（与主动消息到点不发的静默失败同源，用户反馈排查项）；
  // 落 5min 短冷却（防 90s 连续重试浪费决策 API，API 恢复后能尽快打来）
  if (!decision) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // wait/skip：落对应冷却（6h/24h），不发起来电
  if (decision.action !== 'call') {
    setCooldown(contact.id, nowMs, decision.action);
    return;
  }

  // ⑥ 发起真来电（决策期间可能刚出现通话/来电，触发前再守卫一次）
  // 档位再拦截：决策等待窗口内用户切到 off → 不再拨出（决策已花掉的 token 无法追回，但不拨出）
  if (getProactiveLevel() === 'off') {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // #52 修复：决策为 call 但触发前发现已有通话/闹钟 → 联系人未被真拨打，不应被记 6h 冷却。
  //   落 5min 短冷却（避免 90s 重试又命中同一联系人浪费一次决策 API；足够下一 tick 选到其他候选）。
  //   真拨打才落 6h call 冷却。
  // C3 统一来电守卫：距上次任意通道 AI 来电不足 3 分钟不再拨（防「标记来电刚打完主动来电又来」贴脸）
  if (recentAiCallWithin(contact.id, undefined, nowMs)) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  if (useIncomingCall.getState().call) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  if (useGlobalCall.getState().session) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // 闹钟响铃中也不拨出（与③守卫同款，#34；决策期间可能刚响起来）
  if (useUI.getState().alarmRinging) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // #8 电话 App 通话中也不拨出（与③守卫同款；决策期间可能刚开始通话）
  if (useUI.getState().callActive) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // 真拨打：落 call 冷却（B5：按连续拒接次数乘惩罚倍率，封顶 24h；接通清零回基准档）
  setCallCooldownWithPenalty(contact.id, nowMs);
  const number = contact.phone || derivePlaceholderNumber(contact.id);
  const name = contact.name;
  // C3 统一来电守卫：登记本次 AI 来电（聊天标记来电通道拨出前会互查，防贴脸连打）
  markAiCall(contact.id, nowMs);
  const callMedia = decision.media === 'video' ? ('video' as const) : ('voice' as const);
  triggerIncomingCall({
    source: 'phone',
    bannerStage: 'pill',
    name,
    avatar: avatarFor(contact, 'phone'),
    number,
    contact,
    // C14：决策选 video 时来电快照带 media（来电 UI 显示视频标签）；接听后电话 App 进视频通话
    ...(callMedia === 'video' ? { media: callMedia } : {}),
    // 接听：写 pending（带 proactiveContext=决策 reason 作为开场情境，电话 App 消费端透传通话引擎）
    // + 切到电话 App 进「来电方向」通话界面（照抄 chat.tsx onAnswer；接听交接兜底由 IncomingCallLayer 承担）
    onAnswer: () => {
      // 接听了 AI 的电话：拒接负反馈清零（B5）
      clearRejectStreak(contact.id);
      setPendingPhoneAnswer({ contact, number, name, proactiveContext: decision.reason, ...(callMedia === 'video' ? { media: callMedia } : {}) });
      useUI.getState().switchToApp('phone');
    },
    // 拒绝 / 响铃 25 秒超时：落未接记录 + AI 语音留言（人设化解释，照抄 chat.tsx 同款链路）
    onMissed: (reason) => {
      void recordMissedPhoneCall(contact, number, name, reason);
    },
  });
}

// ---------------- 拉黑事件直拨（G-1 电话版入口，cross-app-reach 延时调用） ----------------

/**
 * 拉黑后 AI「立刻打来」的一次性直拨（用户验收点：被拉黑后 AI 会打电话来找我）：
 * 复用主动来电的整套链路（iOS 全屏来电 UI / 接听交接电话 App / 拒接超时落未接+AI 语音留言），
 * 但绕过 tick 候选筛选与决策 API——拉黑跃迁是明确预期来电的时刻，proactiveContext 由调用方给
 * （含「谁拉黑了谁」的情境，接听后通话引擎按人设自然开场）。
 * 全链路容错：任何守卫不满足/异常都静默放弃（消息版 cross-app-reach 已保证「一定看得到」）。
 * @returns 是否真正发起来电
 */
export function triggerBlockCall(contact: ContactRecord, contextHint: string): boolean {
  try {
    // 守卫：已有来电响铃/通话进行中/闹钟响铃时不叠加（与 runProactiveCallTick ③ 同口径）
    if (useIncomingCall.getState().call) return false;
    if (useGlobalCall.getState().session) return false;
    if (useUI.getState().callActive) return false;
    if (useUI.getState().alarmRinging) return false;
    // 「信息」App 双向拉黑都不打：用户拉黑 → 来电会被 #17 守卫拦成死寂；
    // 角色拉黑用户 → 撞上电话引擎 #40 守变「来电即被拦+静默挂断」的怪链路（与 tick 候选口径一致）
    const blk = loadBlock('sms', contact.id);
    if (blk.byUser || blk.byChar) return false;
    // 落 call 冷却：防直拨后 tick 又在短窗口内把同一人选出来重复拨打
    setCooldown(contact.id, Date.now(), 'call');
    // C3 统一来电守卫：叙事直拨同样登记（防与聊天标记来电贴脸连打）
    markAiCall(contact.id);
    const number = contact.phone || derivePlaceholderNumber(contact.id);
    const name = contact.name;
    triggerIncomingCall({
      source: 'phone',
      bannerStage: 'pill',
      name,
      avatar: avatarFor(contact, 'phone'),
      number,
      contact,
      onAnswer: () => {
        setPendingPhoneAnswer({ contact, number, name, proactiveContext: contextHint });
        useUI.getState().switchToApp('phone');
      },
      onMissed: (reason) => {
        void recordMissedPhoneCall(contact, number, name, reason);
      },
    });
    return true;
  } catch {
    return false;
  }
}
