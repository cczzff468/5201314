'use client';

/**
 * （功能已下线）原全局 API 熔断机制：失败计数 → 触发熔断 → 暂停智能生成 → 聊天页顶部红色横幅
 * 「系统累了，暂停智能生成」。用户要求移除该功能（2026-11 用户反馈：不要这个功能了）。
 *
 * 保留 safeLlmFetch 作为统一 fetch 入口（历史调用方遍布聊天/论坛/淘宝/美团/记忆等 14 处），
 * 现在它只是 fetch 的直通封装：不再短路、不再计数、不再有任何全局暂停行为。
 * API 失败时由各调用方原有的逐条错误处理自然呈现。
 */

export async function safeLlmFetch(
  input: string,
  init: RequestInit,
  _opts?: { kind?: 'chat' | 'forum' | 'tb' | 'mt' | 'memory' | 'jealousy' | 'proactive' | 'phone' | 'couple' },
): Promise<Response> {
  return fetch(input, init);
}
