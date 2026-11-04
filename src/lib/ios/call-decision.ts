'use client';

/**
 * AI 接听决策（前端封装，三端共用）：
 * 机主打给 AI 联系人时，响铃期间调 /api/phone/answer——AI 基于
 * 人设 / 关系 / 当前时间状态 / 最近聊天决定 接听(answer) / 拒绝(reject) / 不接(miss)。
 *
 * 时序契约：
 * - 请求在响铃开始时立即发出（不阻塞响铃 UI）；
 * - 超时 ANSWER_DECISION_TIMEOUT_MS 内未返回 → 兜底 answer（宁可多接，不让用户白等）；
 * - 任何网络/解析错误 → 兜底 answer。
 * 返回 Promise 只 settle 一次，宿主可安全 await。
 */

export type AnswerDecision = 'answer' | 'reject' | 'miss';

export interface AnswerDecisionResult {
  decision: AnswerDecision;
  /** 拒绝/不接后 AI 稍后发的解释文字（宿主：微信/QQ 插聊天消息；电话 App 落语音留言） */
  afterText?: string;
}

/**
 * 决策等待上限（#20 通话请求超时看门狗）：到点必失败（AbortSignal.timeout → DOMException
 * TimeoutError），catch 统一兜底 answer——上游卡死时绝不无限等待。
 * 取值 15s：原 9s 是「有超时」的既有调优（决策是快请求，不能拖响铃体验），本轮只把它收进
 * 统一常量并放宽到 15s 兼顾慢上游；这是响铃期间的交互决策，刻意短于 turn 的 45s。
 */
export const ANSWER_DECISION_TIMEOUT_MS = 15000;

export interface AnswerDecisionArgs {
  number: string;
  /** 对端联系人资料（与 /api/phone/turn 的 contact 同构，前端直传） */
  contact: Record<string, unknown> | null;
  /** 最近聊天上下文（user=机主 / assistant=对端；电话 App 无聊天流传 []） */
  recentChat: { role: 'user' | 'assistant'; content: string }[];
  /** 时间感知块（有开关时传；决策需要知道现在几点） */
  timeBlock?: string;
  /** 机主称呼（真实名字；用户规则：AI 永远不知道机主昵称，userNickname 不再下传） */
  userRealName?: string;
  /** 跨 App 身份感知（人设【多端身份与记忆】段；undefined=不注入） */
  multiApp?: boolean;
  /** 多账号关系感知：当前账号 id（小号来电读分账号关系；不传 = 大号口径） */
  accountId?: string;
  /** 陌生来电（多账号）：匿名号/未登记分账号关系的小号拨出——AI 不知道来电人是谁，按陌生来电决策 */
  callerUnknown?: boolean;
  config: unknown;
}

export function requestAnswerDecision(args: AnswerDecisionArgs): Promise<AnswerDecisionResult> {
  const fallback: AnswerDecisionResult = { decision: 'answer' };
  return fetch('/api/phone/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(ANSWER_DECISION_TIMEOUT_MS),
  })
    .then(async (res): Promise<AnswerDecisionResult> => {
      if (!res.ok) return fallback;
      const data = (await res.json()) as { decision?: string; afterText?: string };
      if (data.decision !== 'reject' && data.decision !== 'miss') return fallback;
      return {
        decision: data.decision,
        ...(data.afterText ? { afterText: data.afterText } : {}),
      };
    })
    .catch(() => fallback);
}
