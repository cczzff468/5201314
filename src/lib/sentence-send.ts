'use client';

/**
 * 分句发送（微信 / QQ / 信息三端共用）：
 *
 * - 每个会话独立保存开关（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey>，
 *   天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 * - 开启后：用户连续发送的多条消息 AI 都不会回复；等用户把想说的话发完、输入框为空时
 *   再点一次「发送」，才触发 AI 对这一整批消息统一回复（像真人把几句话拆开发完）；
 * - 批次待回复标记单独持久化（chat-sentence-pending）：中途退出聊天页再进来，
 *   「空输入点击发送 = 触发回复」的状态不丢（消息本身早已落盘）。
 */

const SENT_KEY = 'chat-sentence-send';
const PEND_KEY = 'chat-sentence-pending';

function loadBoolMap(key: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
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

function saveBoolMap(key: string, map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

/** 读取某会话的分句发送开关（未设置时默认关闭） */
export function getSentenceSend(sessionKey: string): boolean {
  return loadBoolMap(SENT_KEY)[sessionKey] === true;
}

/** 保存某会话的分句发送开关（持久化到 localStorage，按 sessionKey 隔离） */
export function saveSentenceSend(sessionKey: string, on: boolean): void {
  const map = loadBoolMap(SENT_KEY);
  if (on) map[sessionKey] = true;
  else delete map[sessionKey];
  saveBoolMap(SENT_KEY, map);
}

/** 该会话是否有「已发完等回复」的待处理批次（跨页面切换持久） */
export function hasPendingBatch(sessionKey: string): boolean {
  return loadBoolMap(PEND_KEY)[sessionKey] === true;
}

/** 标记/清除「待 AI 回复」批次（触发回复或关闭开关时清除） */
export function markPendingBatch(sessionKey: string, pending: boolean): void {
  const map = loadBoolMap(PEND_KEY);
  if (pending) map[sessionKey] = true;
  else delete map[sessionKey];
  saveBoolMap(PEND_KEY, map);
}
