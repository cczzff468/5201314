'use client';

/**
 * 动作描写开关（微信 / QQ / 信息 / 微信群聊 / QQ群聊 五端共用，按会话独立）：
 *
 * - 每个会话独立保存开关（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey> /
 *   wx:group:<groupId> / qq:group:<groupId>），localStorage 单键 JSON map 持久化
 *   （与 @/lib/sticker-toggle 同款），开关变化派发 window 事件供订阅方即时刷新；
 * - 默认关闭：AI 回复里的动作描写自动过滤（提示词禁令 + 渲染层硬剥离双保险），不残留半截描写与星号符号；
 * - 开启（设置页手动打开）：AI 可按【动作描写格式】规则用一对星号 *...* 包裹动作/表情/情景描写，
 *   前端解析后把描写从气泡文字里剥离出来，以灰色小字独立成行居中显示（正文仍在气泡里）；
 * - 解析失败（星号不成对、**加粗** 等 markdown 片段）时按普通文字原样显示，不丢失内容；
 * - 开关只作用于「对方（AI）发来的纯文本消息」的显示层：用户自己的消息、语音转写、引用、
 *   转发、收藏、翻译、记忆与上下文均保持原文（带星号），不影响任何既有链路。
 */

import { useSyncExternalStore } from 'react';

const KEY = 'chat-action-desc-on';
const EVT = 'action-desc-change';

function loadBoolMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
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

function saveBoolMap(map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

/** 读取某会话的动作描写开关（未设置时默认关闭：动作描写自动过滤） */
export function getActionDescOn(sessionKey: string): boolean {
  return loadBoolMap()[sessionKey] === true;
}

/** 保存某会话的动作描写开关（持久化到 localStorage + 派发变更事件，订阅方即时刷新渲染） */
export function saveActionDescOn(sessionKey: string, on: boolean): void {
  const map = loadBoolMap();
  if (on) map[sessionKey] = true;
  else delete map[sessionKey];
  saveBoolMap(map);
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { sessionKey, on } }));
  } catch {
    /* 事件派发失败忽略（下一次渲染仍会读到最新值） */
  }
}

/** 订阅开关变化：本会话设置切换（EVT）与跨标签页 storage 变化都触发重读快照 */
function subscribeActionDesc(notify: () => void): () => void {
  window.addEventListener(EVT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(EVT, notify);
    window.removeEventListener('storage', notify);
  };
}

/**
 * 会话级动作描写开关（渲染订阅版）：useSyncExternalStore 订阅 localStorage 快照，
 * 本会话开关变化（设置页切换派发 EVT）或跨标签页修改时即时刷新，切换后历史消息的显示同步生效。
 */
export function useActionDescOn(sessionKey: string): boolean {
  return useSyncExternalStore(
    subscribeActionDesc,
    () => getActionDescOn(sessionKey),
    // SSR 阶段无 localStorage：与默认态（关闭）保持一致
    () => false,
  );
}

// ==================== 提示词规则（开启下发格式约定 / 关闭下发显式禁令） ====================

/** 开启时注入聊天 system 的格式约定（教 AI 用星号包裹动作描写，星号不做他用） */
export const ACTION_DESC_RULE =
  '【动作描写格式】你可以在回复里用一对星号包裹动作、神态与情景描写（只包裹描写本身，例如 *笑了笑*、*她端起茶杯抿了一口*、*窗外雨声渐起*），' +
  '描写会以灰色小字独立显示在聊天中间，正文照常写在星号外面。动作描写尽量单独占一行，写在它相邻正文的前面或后面，不要把描写和正文挤在同一句里；' +
  '星号只用来包裹动作描写，不要用在普通文字的强调或标题上；' +
  '每条回复里的动作描写要简短自然（一两处即可），不要整条回复全是描写，也不要每条消息都加描写。';

/** 关闭时注入聊天 system 的显式禁令（渲染层另有硬剥离兜底） */
export const ACTION_DESC_OFF_RULE =
  '【动作描写禁用（对方已关闭动作描写）】禁止输出任何动作、神态、情景描写：不要写「*...*」这类被星号包裹的内容，也不要用括号单独补充动作或场景；' +
  '回复一律只写你嘴里说出来的话，像真人打字一样。';

/** 开关说明文案（设置页行下的小字，五端共用同一句式） */
export function actionDescCaption(on: boolean): string {
  return on
    ? '开启后，对方回复中的动作与情景描写会以灰色小字居中显示在聊天界面中间，正文仍在气泡里。'
    : '已关闭：对方回复中的动作与情景描写会被自动过滤，不再显示；你自己发的消息不受影响。';
}

// ==================== 解析与剥离（五端渲染共用） ====================

export interface ActionDescPart {
  type: 'action' | 'text';
  text: string;
}

export interface ActionDescView {
  /** 气泡之前的动作行（去星号后的描写文本，保持出现顺序） */
  before: string[];
  /** 气泡之后的动作行 */
  after: string[];
  /** 气泡正文（剥离动作并整理空白；空串 = 整条消息只有动作描写） */
  text: string;
}

/** 星号成对匹配：描写内部不跨行、不再含星号 */
const ACTION_DESC_RE = /\*([^*\n]+)\*/g;

/** 行首尾空白与零宽字符清理（动作剥离后残留的空隙） */
function tidyDescText(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/^[ \t\u00A0\u200B\u3000]+|[ \t\u00A0\u200B\u3000]+$/g, ''));
  const out: string[] = [];
  let blanks = 0;
  for (const l of lines) {
    if (l === '') {
      blanks += 1;
      if (blanks > 1) continue; // 连续空行折叠为一行（描写剥离后留下的空档）
    } else {
      blanks = 0;
    }
    out.push(l);
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/** 剥离成对动作后清理残留符号：空括号对、紧贴 CJK 或位于行首尾的散落星号（数学式 5*3 中的星号不动） */
function tidyDescResidue(text: string): string {
  let out = text.replace(/\([ \t\u00A0]*\)|（[ \t\u00A0\u3000]*）/g, '');
  const cjk = (s: string) => /[\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
  out = out
    .split('\n')
    .map((line) => {
      const chars = Array.from(line);
      const keep: string[] = [];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch !== '*') {
          keep.push(ch);
          continue;
        }
        const prev = chars[i - 1] ?? '';
        const next = chars[i + 1] ?? '';
        // 行首/行尾、或紧贴汉字的散落星号 → 视为破损动作标记清除；夹在数字/字母间的星号（如 5*3）保留
        if (i === 0 || i === chars.length - 1 || cjk(prev) || cjk(next)) continue;
        keep.push(ch);
      }
      return keep.join('');
    })
    .join('\n');
  return out;
}

/**
 * 把文本按 *...* 成对拆分为动作/文字片段（解析失败返回 null → 调用方按普通文字原样显示，不丢失内容）：
 * - 星号必须成对且同一行内闭合，描写内部为非空非星内容；
 * - **加粗** 这类 markdown 片段（星号前后紧贴星号）跳过不解析，避免误伤；
 * - 不成对的散落星号留在文字里（解析失败语义）。
 */
export function splitActionDescParts(text: string): ActionDescPart[] | null {
  if (!text || !text.includes('*')) return null;
  const parts: ActionDescPart[] = [];
  let last = 0;
  let found = false;
  ACTION_DESC_RE.lastIndex = 0;
  for (let m = ACTION_DESC_RE.exec(text); m !== null; m = ACTION_DESC_RE.exec(text)) {
    const inner = m[1].trim();
    if (!inner) continue;
    const prevCh = m.index > 0 ? text[m.index - 1] : '';
    const nextCh = text[m.index + m[0].length] ?? '';
    if (prevCh === '*' || nextCh === '*') continue; // **加粗** 片段：跳过防误伤
    const between = text.slice(last, m.index);
    if (between) parts.push({ type: 'text', text: between });
    parts.push({ type: 'action', text: inner });
    last = m.index + m[0].length;
    found = true;
  }
  if (!found) return null;
  const tail = text.slice(last);
  if (tail) parts.push({ type: 'text', text: tail });
  return parts;
}

/**
 * 消息文本的显示视图（五端渲染共用入口）：
 *
 * - 返回 null：无任何动作片段（或剥离前后内容完全不变）→ 调用方按原路径渲染，零改动；
 * - 开启（on=true）：动作描写按出现顺序拆到 before/after（正文前的动作在 before、首个可见正文之后的动作在 after），
 *   正文合并整理进 text（可为空串 = 整条消息只有动作）；
 * - 关闭（on=false）：成对动作整段过滤 + 残留符号清理（不出现半截描写与星号残留），
 *   过滤后无正文时 text 为空串 → 调用方整条消息不渲染；
 * - 只处理「对方（AI）发来的纯文本消息」：调用方负责 role/kind 门控，本函数不管发送方。
 */
export function actionDescViewOf(content: string, on: boolean): ActionDescView | null {
  if (!content || !content.includes('*')) return null;
  const parts = splitActionDescParts(content);
  if (!on) {
    if (!parts) {
      // 无成对动作：仅清理破损标记残留（内容无变化时维持 null，渲染零改动）
      const cleaned = tidyDescResidue(content);
      if (cleaned === content) return null;
      return { before: [], after: [], text: tidyDescText(cleaned) };
    }
    const text = tidyDescText(parts.filter((p) => p.type === 'text').map((p) => p.text).join(''));
    return { before: [], after: [], text: tidyDescResidue(text) };
  }
  if (!parts) return null;
  const before: string[] = [];
  const after: string[] = [];
  let textBuf = '';
  let seenText = false;
  for (const p of parts) {
    if (p.type === 'action') {
      (seenText ? after : before).push(p.text);
    } else {
      textBuf += p.text;
      if (p.text.trim()) seenText = true; // 纯空白/换行的片段不切断 before 归属
    }
  }
  return { before, after, text: tidyDescText(textBuf) };
}
