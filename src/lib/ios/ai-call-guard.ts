/**
 * 统一 AI 来电守卫（C3）：主动来电（proactive-call 档位冷却体系）与聊天标记来电
 * （[语音通话]/[视频通话] 标记的 5min localStorage 冷却）此前互不感知——
 * AI 15:00 主动来电被拒（1h 冷却），15:06 仍可通过微信 [语音通话] 标记再打。
 * 本模块记录「任意通道最近一次 AI 来电时刻」，各通道拨出前互查：
 * 距上次任意 AI 来电不足 GUARD_MS 时新来电让路（不发起来电）。
 */
import { kvGet, kvSet } from './idb-kv';

/** 最近 AI 来电记录键（设备级：AI 来电本身跨 App 语义，与拉黑键不同无需账号隔离；
 * 通话记录 call-logs 同为设备级口径） */
const KEY = (contactId: string) => `ai-call-recent:${contactId}`;

/** 互查窗口：距上一次任意通道 AI 来电不足该时长时，新来电不发起 */
const GUARD_MS = 3 * 60_000;

/** 记录一次 AI 来电拨出（任意通道拨出时调用；接通与否都算——目的是拉开连续来电间隔） */
export function markAiCall(contactId: string, at = Date.now()): void {
  try {
    if (!contactId) return;
    kvSet(KEY(contactId), at);
  } catch {
    // 存储异常静默：守卫退化为不生效（不阻塞来电）
  }
}

/** 距该联系人最近一次任意通道 AI 来电是否不足 guardMs（默认 3 分钟） */
export function recentAiCallWithin(contactId: string, guardMs = GUARD_MS, now = Date.now()): boolean {
  try {
    const at = kvGet<number>(KEY(contactId));
    return typeof at === 'number' && at > 0 && now - at < guardMs;
  } catch {
    return false;
  }
}
