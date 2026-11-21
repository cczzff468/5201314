'use client';

/**
 * 聊天显示设置（微信 / QQ）：头像样式 · 已读未读回执 · 时间显示 —— 按联系人隔离
 * ---------------------------------------------------------------------------
 * 本轮（用户指定）改造：
 *  - 入口从「我」页 / QQ 设置页移到**聊天设置界面**（聊天页右上角 ··· 打开）；
 *  - 配置**按联系人隔离**（每个角色一份，localStorage 持久化，键 wx-chat-display /
 *    qq-chat-display，值为 { [contactId]: ChatDisplayConfig }）；
 *  - 已读未读支持**自定义文字**（readLabel / unreadLabel，空 = 默认「已读」/「未读」，
 *    **不限字数**，长短句随意）；
 *  - 未读颜色不再用品牌色，改**深灰**（比已读的浅灰深一档，双色阶都是灰色系）；
 *  - 时间为**自定义模板**：token 替换引擎（fmtMsgTime）——
 *    yyyy 年 / MM 月 / dd 日 / HH 时(24) / hh 时(12) / mm 分 / ss 秒 / A AM·PM，
 *    其余任意文字·符号原样输出（「yyyy年M月d日」随想随写）。
 *
 * 三个维度：
 *  - avatarShape：rounded = 圆角方形（微信原生），circle = 圆形（QQ 原生）；
 *  - read：开关 + 位置（avatar = 头像下面 / bubble = 气泡下面）+ 自定义文字（不限字数）；
 *  - time：开关 + 位置（同上）+ 自定义模板（历史枚举 hhmm/hhmmss 自动迁移）。
 *  位置为「气泡下面」时元信息靠气泡末尾（远离头像的一侧）；位置为「头像下面」时
 *  负 margin 往屏幕边缘方向偏移（用户指定：往边缘靠一点点）；已读与时间同显时
 *  **上下堆叠两行**（已读未读在上、时间在下）。
 *
 * 已读语义（双向回执，上轮建立）：我发的消息在 AI 回复落地时转已读；
 * AI 发的消息在我发消息时转已读；消息字段 unread?: boolean（undefined = 视为已读）。
 *
 * 订阅模式：对照 chat-flags 的外部存储总线 —— 模块级缓存 + listeners 广播，
 * useChatDisplay(app, contactId) 用 useSyncExternalStore 订阅，聊天页实时跟随。
 */

import { useSyncExternalStore } from 'react';

/** 宿主 App（显示设置只覆盖微信 / QQ；信息 App 不参与） */
export type ChatDisplayAppId = 'wx' | 'qq';

/** 头像形状：rounded = 圆角方形（微信原生）；circle = 圆形（QQ 原生） */
export type AvatarShape = 'rounded' | 'circle';

/** 元信息（已读/时间）显示位置：avatar = 头像下面；bubble = 气泡下面 */
export type MetaPosition = 'avatar' | 'bubble';

/** 时间显示模板（自定义字符串）：token 替换 + 任意文字；字母要原样显示用 [方括号] 转义。
 *  历史枚举值 'hhmm' / 'hhmmss' 在 normalize 时自动迁移为 'HH:mm' / 'HH:mm:ss'。 */
export type TimeFormat = string;

/** 单联系人的显示配置（全部字段必有值，存取时经 normalize 兜底） */
export interface ChatDisplayConfig {
  avatarShape: AvatarShape;
  /** 已读未读回执：默认关 */
  readEnabled: boolean;
  readPosition: MetaPosition;
  /** 已读自定义文字（空串 = 默认「已读」） */
  readLabel: string;
  /** 未读自定义文字（空串 = 默认「未读」） */
  unreadLabel: string;
  /** 时间显示：默认关（保持原生「5 分钟间隔居中时间条」） */
  timeEnabled: boolean;
  /** 时间模板（token + 任意文字/颜文字，不限长度；空 = 默认 HH:mm） */
  timeFormat: TimeFormat;
  timePosition: MetaPosition;
}

/** 各 App 默认配置：微信 = 圆角方形头像（原生）；QQ = 圆形头像（原生）；回执与时间默认关闭 */
export const DEFAULT_CHAT_DISPLAY: Record<ChatDisplayAppId, ChatDisplayConfig> = {
  wx: {
    avatarShape: 'rounded',
    readEnabled: false,
    readPosition: 'bubble',
    readLabel: '',
    unreadLabel: '',
    timeEnabled: false,
    timeFormat: 'HH:mm',
    timePosition: 'bubble',
  },
  qq: {
    avatarShape: 'circle',
    readEnabled: false,
    readPosition: 'bubble',
    readLabel: '',
    unreadLabel: '',
    timeEnabled: false,
    timeFormat: 'HH:mm',
    timePosition: 'bubble',
  },
};

const SHAPES: AvatarShape[] = ['rounded', 'circle'];
const POSITIONS: MetaPosition[] = ['avatar', 'bubble'];

/** 时间模板读回兑底：历史枚举 'hhmm'/'hhmmss' 迁移为 'HH:mm'/'HH:mm:ss'；
 *  非空字符串 = 自定义模板原样保留（不限长度）；空/非法 = 默认 HH:mm */
function normTimeFormat(v: unknown, app: ChatDisplayAppId): string {
  if (v === 'hhmm') return 'HH:mm';
  if (v === 'hhmmss') return 'HH:mm:ss';
  if (typeof v === 'string' && v.trim()) return v;
  return DEFAULT_CHAT_DISPLAY[app].timeFormat;
}

/** 单份配置兜底：字段缺失/非法时回默认（解析 localStorage 与 patch 双入口共用） */
export function normalizeChatDisplay(raw: unknown, app: ChatDisplayAppId): ChatDisplayConfig {
  const def = DEFAULT_CHAT_DISPLAY[app];
  if (!raw || typeof raw !== 'object') return { ...def };
  const r = raw as Partial<Record<keyof ChatDisplayConfig, unknown>>;
  return {
    avatarShape: SHAPES.includes(r.avatarShape as AvatarShape) ? (r.avatarShape as AvatarShape) : def.avatarShape,
    readEnabled: typeof r.readEnabled === 'boolean' ? r.readEnabled : def.readEnabled,
    readPosition: POSITIONS.includes(r.readPosition as MetaPosition) ? (r.readPosition as MetaPosition) : def.readPosition,
    readLabel: typeof r.readLabel === 'string' ? r.readLabel : def.readLabel,
    unreadLabel: typeof r.unreadLabel === 'string' ? r.unreadLabel : def.unreadLabel,
    timeEnabled: typeof r.timeEnabled === 'boolean' ? r.timeEnabled : def.timeEnabled,
    timeFormat: normTimeFormat(r.timeFormat, app),
    timePosition: POSITIONS.includes(r.timePosition as MetaPosition) ? (r.timePosition as MetaPosition) : def.timePosition,
  };
}

/** 已读/未读的显示文字（空标签回退默认） */
export function readTextOf(cfg: ChatDisplayConfig, unread: boolean): string {
  return unread ? cfg.unreadLabel || '未读' : cfg.readLabel || '已读';
}

// ---------------- per-contact 存储总线（对照 chat-flags 模式） ----------------

/** localStorage 键（值 = { [contactId]: ChatDisplayConfig }；显示设置为视觉偏好，不按账号作用域） */
const STORAGE_KEY: Record<ChatDisplayAppId, string> = { wx: 'wx-chat-display', qq: 'qq-chat-display' };

type DisplayMap = Record<string, ChatDisplayConfig>;

const caches: Record<ChatDisplayAppId, DisplayMap> = { wx: {}, qq: {} };
const listeners = new Set<() => void>();
let loaded = false;

function persist(app: ChatDisplayAppId) {
  try {
    window.localStorage.setItem(STORAGE_KEY[app], JSON.stringify(caches[app]));
  } catch {
    /* 存储满/隐私模式：仅内存态 */
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  for (const app of ['wx', 'qq'] as const) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY[app]);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const out: DisplayMap = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        const cfg = normalizeChatDisplay(v, app);
        // 与默认完全一致不占存储（也避免「存了一堆默认值」）
        if (JSON.stringify(cfg) !== JSON.stringify(DEFAULT_CHAT_DISPLAY[app])) out[id] = cfg;
      }
      caches[app] = out;
    } catch {
      /* 脏数据：该 App 回空表 */
    }
  }
}

function broadcast() {
  for (const fn of listeners) fn();
}

/** 读取某联系人的显示配置（无记录 = App 默认；引用稳定，可作 getSnapshot） */
export function getChatDisplay(app: ChatDisplayAppId, contactId: string): ChatDisplayConfig {
  ensureLoaded();
  return caches[app][contactId] ?? DEFAULT_CHAT_DISPLAY[app];
}

/** 浅合并更新某联系人的显示配置（立即持久化 + 广播，聊天页实时跟随） */
export function patchChatDisplay(app: ChatDisplayAppId, contactId: string, patch: Partial<ChatDisplayConfig>): void {
  ensureLoaded();
  const next = normalizeChatDisplay({ ...getChatDisplay(app, contactId), ...patch }, app);
  caches[app] = { ...caches[app], [contactId]: next };
  persist(app);
  broadcast();
}

/** 恢复某联系人的默认显示配置（删除记录 + 广播） */
export function resetChatDisplay(app: ChatDisplayAppId, contactId: string): void {
  ensureLoaded();
  if (!(contactId in caches[app])) return;
  const next = { ...caches[app] };
  delete next[contactId];
  caches[app] = next;
  persist(app);
  broadcast();
}

/** 订阅变更（useSyncExternalStore 用），返回退订函数 */
export function subscribeChatDisplay(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React 订阅 hook：聊天页 / 设置区实时跟随（getSnapshot 引用稳定） */
export function useChatDisplay(app: ChatDisplayAppId, contactId: string): ChatDisplayConfig {
  return useSyncExternalStore(
    subscribeChatDisplay,
    () => getChatDisplay(app, contactId),
    () => DEFAULT_CHAT_DISPLAY[app],
  );
}

// ---------------- 时间模板引擎（token 替换 + 颜文字 + 转义） ----------------

/** token 匹配顺序（最长优先；小写 m 单字符放最后避免吃掉 mm） */
const TOKEN_ORDER = ['yyyy', 'yy', 'MM', 'dd', 'HH', 'hh', 'mm', 'ss', 'M', 'd', 'H', 'h', 's', 'A', 'a', 'm'] as const;

/** 时间 token 速查（设置页「符号」快捷键渲染用；label = tooltip 说明） */
export const TIME_TOKENS: readonly { token: string; label: string }[] = [
  { token: 'yyyy', label: '年（2025）' },
  { token: 'yy', label: '两位年（25）' },
  { token: 'MM', label: '月（12）' },
  { token: 'dd', label: '日（25）' },
  { token: 'HH', label: '时·24 制（14）' },
  { token: 'hh', label: '时·12 制（02）' },
  { token: 'mm', label: '分钟（跟在小写小时后；日期位置 = 月份）' },
  { token: 'ss', label: '秒（45）' },
  { token: 'A', label: 'AM / PM' },
  { token: 'a', label: 'am / pm' },
];

/**
 * 时间模板格式化（本地时区）——token 最长匹配 + 智能小写 mm + [方括号] 转义。
 *  - token：yyyy/yy 年 · MM/M 月 · dd/d 日 · HH/H 时(24) · hh/h 时(12) · ss/s 秒 · A/a 上午下午
 *  - 小写 mm/m 智能区分：模板里出现小时（H/h）之前 = 月份；之后 = 分钟
 *    （用户示例「mm/dd/yyyy hh:mm AM/PM」= 12/25/2025 02:30 PM；「yyyymmdd」= 20251225）
 *  - 连写「AM/PM」「am/pm」视作单个 A/a token（用户示例格式直接可用）
 *  - 其余任意文字 / 符号原样输出；字母要原样显示请用 [方括号] 括起（moment 同款转义）
 */
export function fmtMsgTime(ts: number, template: string): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const out: string[] = [];
  let hourSeen = false; // 模板中已出现过小时 token（其后的小写 mm/m 按分钟）
  let i = 0;
  const s = template ?? '';
  while (i < s.length) {
    // [字面] 转义（未闭合则余下全部原样）
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      if (end === -1) {
        out.push(s.slice(i + 1));
        break;
      }
      out.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    // 连写 AM/PM / am/pm → 单个 A/a token
    if (s.startsWith('AM/PM', i)) {
      out.push(h24 < 12 ? 'AM' : 'PM');
      i += 5;
      continue;
    }
    if (s.startsWith('am/pm', i)) {
      out.push(h24 < 12 ? 'am' : 'pm');
      i += 5;
      continue;
    }
    // token 最长优先匹配
    const t = TOKEN_ORDER.find((x) => s.startsWith(x, i));
    if (t) {
      switch (t) {
        case 'yyyy': out.push(String(d.getFullYear())); break;
        case 'yy': out.push(p2(d.getFullYear() % 100)); break;
        case 'MM': out.push(p2(month)); break;
        case 'M': out.push(String(month)); break;
        case 'dd': out.push(p2(date)); break;
        case 'd': out.push(String(date)); break;
        case 'HH': out.push(p2(h24)); break;
        case 'H': out.push(String(h24)); break;
        case 'hh': out.push(p2(h12)); break;
        case 'h': out.push(String(h12)); break;
        case 'ss': out.push(p2(d.getSeconds())); break;
        case 's': out.push(String(d.getSeconds())); break;
        case 'A': out.push(h24 < 12 ? 'AM' : 'PM'); break;
        case 'a': out.push(h24 < 12 ? 'am' : 'pm'); break;
        default: {
          // 小写 mm/m：小时 token 之前 = 月份；之后 = 分钟（用户示例 mm/dd/yyyy hh:mm 直接可用）
          const asMinute = hourSeen;
          out.push(t === 'mm' ? p2(asMinute ? d.getMinutes() : month) : String(asMinute ? d.getMinutes() : month));
          break;
        }
      }
      if (t === 'HH' || t === 'H' || t === 'hh' || t === 'h') hourSeen = true;
      i += t.length;
      continue;
    }
    // 其余字符（文字/符号）原样输出
    out.push(s[i]);
    i += 1;
  }
  return out.join('');
}

/** 配置摘要（聊天设置页折叠标题右侧的一行小字）：默认 / 圆形头像 / 已读 · 时间 … */
export function chatDisplaySummary(cfg: ChatDisplayConfig): string {
  const parts: string[] = [];
  if (cfg.readEnabled) parts.push(cfg.readLabel || '已读');
  if (cfg.timeEnabled) parts.push('时间');
  if (parts.length === 0) parts.push(cfg.avatarShape === 'circle' ? '圆形头像' : '默认');
  return parts.join(' · ');
}
