'use client';

/**
 * 聊天错误分类（Task 40「错误提示优化」）：
 *
 * - classifyChatError：把任意请求错误（错误文案/状态码/网络异常）归一为友好分类文案，
 *   绝不把原始报错（500、JSON、栈信息）直接展示给用户；
 *   分类：网络不稳定 / API Key 无效 / 请求太频繁 / 服务暂时不可用 / 请求超时 / 回复解析失败 / 默认未送达；
 * - v2.1：连续失败重试冷却已删除（原 2 次 10s / 3 次+ 30s）——机主重试不受冷却拦截，
 *   想什么时候重试就什么时候重试；retryCooldownMs 恒返 0、cooldownRemainText 恒返空串；
 *   函数签名保留以防调用方 import 报错；
 * - 错误原文（detail）仅保存在内存供「复制错误详情」菜单使用，不落库、不进上下文/记忆。
 */

export type ChatErrorKind = 'network' | 'auth' | 'rate' | 'server' | 'timeout' | 'parse' | 'unknown';

export interface ChatErrorInfo {
  kind: ChatErrorKind;
  /** 展示文案（居中灰字提示行用；不含原始报错细节） */
  text: string;
}

/** 空回复/解析失败的默认文案（finalize 空分支与解析类共用） */
export const CHAT_PARSE_FAIL_TEXT = '回复解析失败，请重试';
/** 兜底文案（未知错误） */
export const CHAT_UNKNOWN_FAIL_TEXT = '消息没有送达，请重试';

/**
 * 错误分类：从错误 message / 状态码推断类型。
 * chat-stream-store 非 200 时 message 形如「服务端文案」或「请求失败（401）」；
 * 网络断开时为 Failed to fetch / NetworkError / Load failed 等。
 */
export function classifyChatError(rawMessage: string): ChatErrorInfo {
  const msg = String(rawMessage || '');
  const lower = msg.toLowerCase();
  // 项目内建的引导文案（更具体、本身已友好）直接透传，不套分类模板：
  // 「还没有配置 AI 接口/API Key…」≠「Key 无效」——是没配置，不是配错（v82：匹配新的「还没有配置 AI 接口」文案）
  if (/还没有配置|未配置.*api|内置模型也不可用/.test(lower)) {
    return { kind: 'auth', text: msg.length <= 60 ? msg : 'API 未配置，请到「设置 › API 配置」填写后重试' };
  }
  // 状态码提取：「请求失败（401）」/「请求失败(429)」
  const m = lower.match(/请求失败[（(]\s*(\d{3})\s*[)）]/);
  const status = m ? Number(m[1]) : 0;
  if (status === 401 || status === 403) return { kind: 'auth', text: 'API Key 无效，请检查设置' };
  if (status === 429) return { kind: 'rate', text: '请求太频繁，请稍后再试' };
  if (status >= 500) return { kind: 'server', text: '服务暂时不可用，请稍后重试' };
  // 超时（AbortError / 看门狗文案）
  if (/timeout|timed?\s*-?\s*out|abort|超时/.test(lower)) return { kind: 'timeout', text: '请求超时，请重试' };
  // 网络类
  if (/failed to fetch|networkerror|network error|fetch failed|load failed|网络|offline|internet/.test(lower)) {
    return { kind: 'network', text: '网络不稳定，请稍后重试' };
  }
  // 服务端文案兜底匹配（无状态码但有语义）
  if (/频率|频繁|rate limit|too many requests/.test(lower)) return { kind: 'rate', text: '请求太频繁，请稍后再试' };
  if (/api ?key|apikey|密钥|unauthorized|鉴权|无效的 api/.test(lower)) return { kind: 'auth', text: 'API Key 无效，请检查设置' };
  // 解析类（JSON 断流 / 空回复 / 结构异常）
  if (/json|解析|parse|unexpected|格式异常|空回复|没有回应|空白/.test(lower)) return { kind: 'parse', text: CHAT_PARSE_FAIL_TEXT };
  // 裸三位状态码（语义关键词之后兜底，防「请求失败（NNN）」之外的文案形态）
  const bare = lower.match(/\b(401|403|429|500|502|503|504)\b/);
  if (bare) {
    const code = Number(bare[1]);
    if (code === 401 || code === 403) return { kind: 'auth', text: 'API Key 无效，请检查设置' };
    if (code === 429) return { kind: 'rate', text: '请求太频繁，请稍后再试' };
    return { kind: 'server', text: '服务暂时不可用，请稍后重试' };
  }
  if (status >= 400) return { kind: 'server', text: '服务暂时不可用，请稍后重试' };
  return { kind: 'unknown', text: CHAT_UNKNOWN_FAIL_TEXT };
}

// ---------------- 错误原文（内存级，「复制错误详情」用；不落库不进上下文） ----------------

/** 记录一次失败（finalize error/空回复分支调用；原始错误同时记为「复制详情」素材）。
 *  v2.1：重试冷却已删除，这里只保留错误原文供「复制错误详情」使用。 */
export function recordChatFail(sessionKey: string, rawDetail?: string, nowMs: number = Date.now()): void {
  if (!sessionKey) return;
  if (rawDetail) lastRawDetail.set(sessionKey, String(rawDetail).slice(0, 500));
}

/** 记录一次成功（finalize 成功分支调用）——清空错误原文 */
export function recordChatSuccess(sessionKey: string): void {
  if (!sessionKey) return;
  lastRawDetail.delete(sessionKey);
}

/** v2.1：重试冷却已删除，恒返 0（可立即重试）。函数签名保留防调用方 import 报错。 */
export function retryCooldownMs(sessionKey: string, nowMs: number = Date.now()): number {
  return 0;
}

/** v2.1：重试冷却已删除，恒返空串。函数签名保留防调用方 import 报错。 */
export function clearAllChatCooldowns(): void {
  lastRawDetail.clear();
}

/** v2.1：重试冷却已删除，恒返空串（无冷却提示）。函数签名保留防调用方 import 报错。 */
export function cooldownRemainText(sessionKey: string, nowMs: number = Date.now()): string {
  return '';
}

const lastRawDetail = new Map<string, string>();

/** 读会话最近一次失败的原始错误（无则返回空串） */
export function lastChatErrorDetail(sessionKey: string): string {
  return lastRawDetail.get(sessionKey) ?? '';
}
