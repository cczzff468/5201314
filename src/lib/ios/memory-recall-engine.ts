'use client';

/**
 * 全局回忆触发引擎（情感封神）：
 *
 * 设计目标：
 * - 每次用户发送消息时，先去本地长期记忆库做语义匹配（关键词 + 标签打分，bigram overlap）；
 * - 提取最相关的 1~5 条记忆，作为 `[回忆提示]` 块注入到 System Prompt；
 * - Prompt 规则强制 AI：如果用户当前消息与回忆提示相关，自然地提及那件事，让用户觉得 AI 一直记得；
 * - 跨模块联动：淘宝购买事件 → 触发回忆引擎（AI 记得用户下周要去徒步 → 主动提及冲锋衣）；
 *   论坛发帖时 NPC 评论可匹配记忆（用户抱怨过公司 → NPC 评论「又是那个破公司？」）。
 *
 * 与 memRecallBlock 的区别：
 * - memRecallBlock：完整记忆召回块（长期+核心+碎片三层 + 互通过滤 + 群可见性 + 角色归属标注），
 *   按预算裁剪，注入到 system 中段，是「AI 记得的所有事」；
 * - recallHintBlock（本引擎）：轻量级「回忆触发」块，只取最相关的 1~5 条，注入到 system 末段，
 *   明确告诉 AI「这几件事与用户当前消息相关，可以自然提起」。两者互补，不冲突。
 *
 * 算法（关键词 + 标签打分）：
 * - bigram overlap（与 memRecallBlock 同款 bigrams 工具）：用户消息与记忆内容的 2-gram 重叠数；
 * - 时间新鲜度加成：近 1 天 +3，近 7 天 +2，近 30 天 +1（与 relevanceScore 同口径）；
 * - 层级权重：长期记忆 ×1.5（最稳定），核心 ×1.2，碎片 ×1.0；
 * - 跨层去重：与已选条目相似度 ≥0.6 跳过（避免重复注入）；
 * - 取 top N（默认 5）。
 */

import { listLongTerm, listCores, listFragments, setMemScopeForApp } from '../memory';
import { bigrams, similarity, isMemExpired, type MemLongTerm, type MemCore, type MemFragment } from '../memory-core';
import type { AccountApp } from './accounts';

/** 回忆提示条目：记忆内容 + 来源层级 + 相关度分数 */
export interface RecallHintItem {
  /** 记忆内容原文 */
  content: string;
  /** 来源层级：long=长期 / core=核心 / frag=碎片 */
  layer: 'long' | 'core' | 'frag';
  /** 相关度分数（bigram overlap × 层级权重 + 时间加成） */
  score: number;
}

/** 回忆触发引擎：检索最相关的 1~5 条记忆 */
export function recallRelevantMemories(
  contactId: string,
  userText: string,
  opts?: {
    /** 当前聊天 App（用于多账号作用域隔离；缺省 = sms） */
    app?: AccountApp;
    /** 最大返回条数（默认 5） */
    maxRows?: number;
    /** 最低相关度阈值（默认 1，即至少 1 个 bigram 重叠） */
    minScore?: number;
    /** 排除指定 source 的碎片（如关闭帖子记忆时排除 'forum'） */
    excludeFragmentSources?: string[];
  },
): RecallHintItem[] {
  if (!contactId || !userText.trim()) return [];
  const app = opts?.app ?? 'sms';
  const maxRows = opts?.maxRows ?? 5;
  const minScore = opts?.minScore ?? 1;
  const excludeSources = opts?.excludeFragmentSources ?? [];

  // 多账号作用域隔离（与 memRecallBlock 同口径）
  setMemScopeForApp(app);

  const now = Date.now();
  const ctxGrams = bigrams(userText);
  if (ctxGrams.size === 0) return [];

  const candidates: RecallHintItem[] = [];

  // 长期记忆（最稳定，权重 ×1.5）
  for (const m of listLongTerm(contactId)) {
    if (m.supersededAt || isMemExpired(m, now)) continue;
    const score = scoreMemory(m.content, m.createdAt, ctxGrams) * 1.5;
    if (score >= minScore) candidates.push({ content: m.content, layer: 'long', score });
  }

  // 核心记忆（权重 ×1.2）
  for (const m of listCores(contactId)) {
    if (m.archivedAt || m.supersededAt || isMemExpired(m, now)) continue;
    const score = scoreMemory(m.content, m.createdAt, ctxGrams) * 1.2;
    if (score >= minScore) candidates.push({ content: m.content, layer: 'core', score });
  }

  // 记忆碎片（权重 ×1.0）
  for (const f of listFragments(contactId)) {
    if (f.consumedAt || f.supersededAt || f.expiredAt || isMemExpired(f, now)) continue;
    if (excludeSources.length > 0 && f.source && excludeSources.includes(f.source)) continue;
    const score = scoreMemory(f.content, f.createdAt, ctxGrams) * 1.0;
    if (score >= minScore) candidates.push({ content: f.content, layer: 'frag', score });
  }

  if (candidates.length === 0) return [];

  // 按分数降序排序
  candidates.sort((a, b) => b.score - a.score);

  // 跨层去重：与已选条目相似度 ≥0.6 跳过
  const selected: RecallHintItem[] = [];
  for (const c of candidates) {
    if (selected.length >= maxRows) break;
    const isDup = selected.some((s) => similarity(s.content, c.content) >= 0.6);
    if (!isDup) selected.push(c);
  }

  return selected;
}

/** 单条记忆打分：bigram overlap × 2 + 时间新鲜度加成（与 memory.ts relevanceScore 同口径） */
function scoreMemory(content: string, createdAt: number, ctxGrams: Set<string>): number {
  const contentGrams = bigrams(content);
  let overlapCount = 0;
  contentGrams.forEach((g) => {
    if (ctxGrams.has(g)) overlapCount++;
  });
  let score = overlapCount * 2;
  const age = Date.now() - createdAt;
  if (age < 86400_000) score += 3;
  else if (age < 7 * 86400_000) score += 2;
  else if (age < 30 * 86400_000) score += 1;
  return score;
}

/** 构建 [回忆提示] 块：注入到 System Prompt 末尾，强制 AI 自然提及相关记忆 */
export function buildRecallHintBlock(hints: RecallHintItem[]): string {
  if (hints.length === 0) return '';
  const lines = hints.map((h, i) => {
    const layerLabel = h.layer === 'long' ? '长期记忆' : h.layer === 'core' ? '核心记忆' : '近期记忆';
    return `${i + 1}. （${layerLabel}）${h.content}`;
  });
  return [
    '【回忆提示】以下是用户当前消息可能相关的你亲身经历过的事（从你的记忆库语义匹配召回，不是资料查询）。',
    '如果用户的当前消息确实与其中某条相关，请自然地提及那件事——像真人一样顺口说起，让用户觉得你一直记得。',
    '注意：不要生硬地罗列这些记忆，不要说「根据我的记忆」「记忆库里写着」这类话；只在话题自然衔接时提起。',
    '如果用户当前消息与这些记忆无关，就完全不要提起，正常回复即可。',
    '',
    ...lines,
  ].join('\n');
}

/**
 * 回忆触发引擎主入口：检索 + 构建回忆提示块。
 * 返回空串表示无相关记忆（不注入）。
 */
export function recallHintBlock(
  contactId: string,
  userText: string,
  opts?: {
    app?: AccountApp;
    maxRows?: number;
    excludeFragmentSources?: string[];
  },
): string {
  const hints = recallRelevantMemories(contactId, userText, opts);
  return buildRecallHintBlock(hints);
}

// ---------------- 跨模块联动：淘宝购买事件 → 触发回忆 ----------------

/**
 * 淘宝购买事件触发回忆：用户在淘宝买了某商品时，检测是否有相关记忆可以下次聊天时提起。
 * 例如：用户买了冲锋衣 → AI 记得用户下周要去徒步 → 下次聊天自然提及。
 *
 * 实现：把购买商品标题加入「待回忆关键词队列」，下次 runAiTurn 时 recallHintBlock 会检测到
 * bigram 重叠并注入回忆提示。这里只做轻量级「关键词标记」，不立即触发 LLM（避免额外开销）。
 */
const pendingPurchaseKeywords = new Map<string, string[]>(); // contactId → 商品标题关键词

/** 记录一次淘宝购买事件（供下次聊天回忆触发用） */
export function notePurchaseEvent(contactId: string, productTitle: string): void {
  if (!contactId || !productTitle.trim()) return;
  const existing = pendingPurchaseKeywords.get(contactId) ?? [];
  // 提取商品标题的关键词（去品牌/型号，取前 12 字符的 bigram 代表）
  const keyword = productTitle.trim().slice(0, 12);
  if (!existing.includes(keyword)) {
    existing.push(keyword);
    // 只保留最近 5 个购买关键词
    if (existing.length > 5) existing.shift();
    pendingPurchaseKeywords.set(contactId, existing);
  }
}

/** 消费购买关键词并拼成扩展上下文（供 recallHintBlock 检测召回） */
export function consumePurchaseKeywords(contactId: string): string {
  const kws = pendingPurchaseKeywords.get(contactId);
  if (!kws || kws.length === 0) return '';
  pendingPurchaseKeywords.delete(contactId);
  return kws.join(' ');
}

/** 检查是否有待消费的购买关键词（供调用方决定是否扩展上下文） */
export function hasPendingPurchaseKeywords(contactId: string): boolean {
  const kws = pendingPurchaseKeywords.get(contactId);
  return !!kws && kws.length > 0;
}

// ---------------- 跨模块联动：论坛 NPC 评论匹配记忆 ----------------

/**
 * 论坛 NPC 评论匹配记忆：用户发了帖子，NPC 生成评论时可参考用户的历史记忆。
 * 例如：用户之前抱怨过公司 → NPC 评论「又是那个破公司？楼主你要不换个工作吧。」
 *
 * 实现：给论坛 NPC 评论生成提供「用户画像摘要」，让 NPC 自然地引用。
 * 返回空串表示无可用记忆。
 */
export function userMemorySummaryForForum(contactId: string): string {
  if (!contactId) return '';
  setMemScopeForApp('sms');
  const now = Date.now();
  const longs = listLongTerm(contactId).filter((m) => !m.supersededAt && !isMemExpired(m, now)).slice(0, 3);
  if (longs.length === 0) return '';
  return longs.map((m) => `- ${m.content}`).join('\n');
}
