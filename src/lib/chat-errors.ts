'use client';

/**
 * 聊天错误分类 + 连续失败冷却（Task 40「错误提示优化」）：
 *
 * - classifyChatError：把任意请求错误（错误文案/状态码/网络异常）归一为友好分类文案，
 *   绝不把原始报错（500、JSON、栈信息）直接展示给用户；
 *   分类：网络不稳定 / API Key 无效 / 请求太频繁 / 服务暂时不可用 / 请求超时 / 回复解析失败 / 默认未送达；
 * - 连续失败冷却：同一会话连续失败 1 次可立即重试，2 次起进入冷却（10s），3 次及以上 30s；
 *   成功一次立即清零。冷却只拦截「重试」动作——用户发新消息永远放行（用户意图明确）；
 *   auth 类失败（API Key 未配置/无效）例外：不计冷却、反而清零——文案引导用户去
 *   「设置 › API 配置」填写，照做后回来重试必须立即放行；保存 API 配置时也会全局清空冷却；
 * - 状态仅存内存（Map）：刷新后计数自然归零，可重新尝试——冷却防的是「疯狂连环重试」，
 *   不需要跨刷新持久化；
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
  // 「还没有配置 API Key，内置模型也不可用；请到设置…」≠「Key 无效」——是没配置，不是配错
  if (/还没有配置 ?api ?key|未配置.*api|内置模型也不可用/.test(lower)) {
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

// ---------------- 连续失败冷却（会话级，内存态） ----------------

const failState = new Map<string, { count: number; lastAt: number }>();
/** 连续失败 1/2/3+ 次后的重试冷却（毫秒）；第 1 次失败允许立即重试 */
const COOLDOWN_STEPS_MS = [0, 0, 10_000, 30_000];

function cooldownForCount(count: number): number {
  if (count <= 0) return 0;
  const idx = Math.min(count, COOLDOWN_STEPS_MS.length) - 1;
  return COOLDOWN_STEPS_MS[idx] ?? 0;
}

/** 记录一次失败（finalize error/空回复分支调用；原始错误同时记为「复制详情」素材）。
 *  auth 类失败（API Key 未配置/无效——文案引导用户去「设置 › API 配置」）不计冷却、
 *  反而清零既有冷却：用户照提示填好 Key 回来重试必须立即放行，不能被「失败次数较多」拦住。
 *  冷却只针对瞬时类错误（网络/限频/服务端/超时/解析），防的是疯狂连环重试。 */
export function recordChatFail(sessionKey: string, rawDetail?: string, nowMs: number = Date.now()): void {
  if (!sessionKey) return;
  if (rawDetail) lastRawDetail.set(sessionKey, String(rawDetail).slice(0, 500));
  if (rawDetail && classifyChatError(rawDetail).kind === 'auth') {
    failState.delete(sessionKey);
    return;
  }
  const prev = failState.get(sessionKey);
  const count = Math.min((prev?.count ?? 0) + 1, 99);
  failState.set(sessionKey, { count, lastAt: nowMs });
}

/** 记录一次成功（finalize 成功分支调用）——清零失败计数与冷却 */
export function recordChatSuccess(sessionKey: string): void {
  if (!sessionKey) return;
  failState.delete(sessionKey);
  lastRawDetail.delete(sessionKey);
}

/** 当前重试是否处于冷却中（>0 = 剩余冷却毫秒；0 = 可立即重试） */
export function retryCooldownMs(sessionKey: string, nowMs: number = Date.now()): number {
  const st = failState.get(sessionKey);
  if (!st || st.count <= 0) return 0;
  const cd = cooldownForCount(st.count);
  if (cd <= 0) return 0;
  const remain = cd - (nowMs - st.lastAt);
  return remain > 0 ? remain : 0;
}

/** 清空全部会话的失败计数与冷却（「设置 › API 配置」保存后调用：配置已变，旧失败不再拦重试） */
export function clearAllChatCooldowns(): void {
  failState.clear();
}

/** 冷却提示文案（「请 N 秒后再试」；无冷却返回空串） */
export function cooldownRemainText(sessionKey: string, nowMs: number = Date.now()): string {
  const ms = retryCooldownMs(sessionKey, nowMs);
  if (ms <= 0) return '';
  const sec = Math.ceil(ms / 1000);
  return `失败次数较多，请 ${sec} 秒后再试`;
}

// ---------------- 错误原文（内存级，「复制错误详情」用；不落库不进上下文） ----------------

const lastRawDetail = new Map<string, string>();

/** 读会话最近一次失败的原始错误（无则返回空串） */
export function lastChatErrorDetail(sessionKey: string): string {
  return lastRawDetail.get(sessionKey) ?? '';
}
