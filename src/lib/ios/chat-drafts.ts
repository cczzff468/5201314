'use client';

/**
 * 聊天草稿箱（Task 40）：输入框文本按「App + 会话 + 账号」隔离持久化。
 *
 * - 键名复用 idb-kv 的账号作用域机制：`wx-`/`qq-`/`ios-chat-` 前缀的键自动追加
 *   `--{accountId}` 后缀（大号无后缀）——大号/小号的草稿天然隔离，无需自行拼账号；
 * - 写入走 kvSetDebounced（400ms 同键合并 + pagehide 冲刷）：每键击只合并落库一次，
 *   刷新/重启/切 App 回来草稿仍在；内存同步生效，切换会话（keyed 重挂载）即时可读；
 * - 超长截断：草稿上限 CHAT_DRAFT_MAX 字符，超出部分截断丢弃（返回 true 供调用方提示一次），
 *   输入框本身不限长（打字不受干扰）；
 * - 草稿不写入聊天记录、不进 AI 上下文/记忆（独立键，与消息管线零交集）；
 * - 发送成功后调用方 clearChatDraft 清空（发送失败保留草稿，重进不丢）。
 */

import { kvDelRaw, kvGet, kvSetDebounced } from '@/lib/ios/idb-kv';

export type ChatDraftApp = 'wx' | 'wx-group' | 'qq' | 'qq-group' | 'sms';

/** 草稿上限（字符）：超出截断保存并提示 */
export const CHAT_DRAFT_MAX = 2000;

/** 各端草稿键：前缀命中 idb-kv 账号作用域映射 → 自动按当前账号隔离 */
const DRAFT_KEY_OF: Record<ChatDraftApp, (id: string) => string> = {
  wx: (id) => `wx-draft:${id}`, // 微信单聊（wx- 前缀 → --{accId}）
  'wx-group': (id) => `wx-group-draft:${id}`, // 微信群聊
  qq: (id) => `qq-draft:${id}`, // QQ 单聊
  'qq-group': (id) => `qq-group-draft:${id}`, // QQ 群聊
  sms: (id) => `ios-chat-draft:${id}`, // 信息 App（联系人 c:<id> / 小助手 assistant）
};

export function getChatDraft(app: ChatDraftApp, id: string): string {
  if (!id) return '';
  try {
    const v = kvGet<unknown>(DRAFT_KEY_OF[app](id));
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/**
 * 保存草稿（防抖落库）。返回是否发生截断（调用方可提示一次）。
 * 空文本 = 清空草稿（与 clearChatDraft 等效）。
 */
export function saveChatDraft(app: ChatDraftApp, id: string, text: string): boolean {
  if (!id) return false;
  const key = DRAFT_KEY_OF[app](id);
  try {
    if (!text) {
      kvDelRaw(key);
      return false;
    }
    if (text.length > CHAT_DRAFT_MAX) {
      kvSetDebounced(key, text.slice(0, CHAT_DRAFT_MAX));
      return true;
    }
    kvSetDebounced(key, text);
    return false;
  } catch {
    return false;
  }
}

/** 清空草稿（发送成功后调用；同时取消同键防抖写，防旧值写回） */
export function clearChatDraft(app: ChatDraftApp, id: string): void {
  if (!id) return;
  try {
    kvDelRaw(DRAFT_KEY_OF[app](id));
  } catch {
    // 忽略
  }
}
