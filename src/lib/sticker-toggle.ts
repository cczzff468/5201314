'use client';

/**
 * 表情包开关（微信 / QQ / 信息三端共用，按会话独立）：
 *
 * - 每个会话独立保存开关（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey>，
 *   天然按角色/App 隔离），localStorage 单键 JSON map 持久化（与 @/lib/sentence-send 同款）；
 * - 开启（默认，保持既有行为）：AI 可按收藏表情包规则发表情包（[表情包:ID] 标记），也可按人设使用 emoji；
 * - 关闭：AI 不发表情包也不发 emoji——三层保障：
 *   ① 提示词层：不下发表情包标记规则/清单，并注入 STICKER_OFF_RULE 显式禁令；
 *   ② 落盘层：AI 回复里的表情包卡片直接丢弃（红包/转账/亲属卡/位置卡片不受影响），
 *      文字里的 emoji 用 @/lib/emoji 的 stripEmojiText 硬性剥除；
 *   ③ 流式层：流式渲染期间同样剥除，避免「流式时看到 emoji、落盘后消失」的体验不一致；
 * - 开关只约束 AI 侧：用户自己发表情包/emoji 完全不受影响；用户发表情包仍以
 *   「[发送了表情：XX]」进入上下文，AI（关闭时用纯文字）依旧能理解含义并回应。
 */

import { scopedConvKey } from './ios/accounts';

const KEY = 'chat-sticker-on';

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

/** 读取某会话的表情包开关（未设置时默认开启，保持既有行为；会话键按账号作用域） */
export function getStickersOn(sessionKey: string): boolean {
  return loadBoolMap()[scopedConvKey(sessionKey)] !== false;
}

/** 保存某会话的表情包开关（持久化到 localStorage，按会话键+账号隔离） */
export function saveStickersOn(sessionKey: string, on: boolean): void {
  const k = scopedConvKey(sessionKey);
  const map = loadBoolMap();
  if (on) delete map[k];
  else map[k] = false;
  saveBoolMap(map);
}

/**
 * 关闭表情包开关后注入聊天 system 的禁用规则（微信 / QQ / 信息三端共用）：
 * 微信/QQ 同时会撤掉表情包标记规则与清单（buildRichRules 传空清单），这里只放「禁令」本身。
 */
export const STICKER_OFF_RULE =
  '【表情与 emoji 禁用（对方已关闭表情包）】你不发表情包：禁止输出 [表情包:ID]、[表情:XX]、[发送了表情：XX] 等任何形式或变体的表情标记；' +
  '你也不发任何 emoji 表情符号（如 😀😂🤣😍🎉✨🔥👍❤☀ 等一律禁止）。对方发来的表情你照常理解含义，但你的回复一律纯文字。';

/** 开关说明文案（设置页行下的小字，三端共用同一句式） */
export function stickerToggleCaption(on: boolean): string {
  return on
    ? '开启后，对方可以发送你收藏的表情包，也会按人设使用 emoji 表情。'
    : '已关闭：对方不再发表情包，也不再发任何 emoji 表情，回复一律纯文字；你自己发表情不受影响。';
}
