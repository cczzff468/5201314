'use client';

/**
 * X论坛 · 生成设置（客户端存取）。
 *
 * 抽屉「生成设置」面板的数据层：
 * 1. 数量范围：每次生成帖子条数（主页上拉/下拉一批）、每次生成评论条数
 *    （「显示更多评论」一批一级评论）——用户可设 X~Y 条，每次生成在其中
 *    均匀抽一个数（旧版固定 7~15）；
 * 2. 提示词覆盖：11 条生成提示词的用户自定义版本（抽屉提示词面板编辑），
 *    保存即生效——engine.callApi 每次请求都把覆盖随 payload 送给服务端，
 *    服务端 sysPrompt() 覆盖优先、默认模板兜底。
 *
 * 存储：idb-kv（key = forum-gen-settings-v1）——与论坛数据同仓，
 * kvGet 同步读内存缓存，改完下一次生成立刻用新值，零延迟。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { FORUM_PROMPT_DEFAULTS, PROMPT_OVERRIDE_MAX_LEN, type PromptKey } from './prompt-defs';

/** 帖子条数范围硬边界（服务端 posts 批量上限 24） */
export const POST_COUNT_BOUNDS = { min: 1, max: 24 } as const;
/** 评论条数范围硬边界（服务端 personas 上限 30） */
export const COMMENT_COUNT_BOUNDS = { min: 1, max: 30 } as const;

export interface ForumGenSettings {
  /** 每次生成帖子条数：下限 */
  postCountMin: number;
  /** 每次生成帖子条数：上限 */
  postCountMax: number;
  /** 每次生成评论条数：下限 */
  commentCountMin: number;
  /** 每次生成评论条数：上限 */
  commentCountMax: number;
  /** 提示词覆盖（key → 用户版模板；空串/与默认一致视为未覆盖，不进 record） */
  prompts: Partial<Record<PromptKey, string>>;
}

const SETTINGS_KEY = 'forum-gen-settings-v1';

/** 旧版行为：一次 7~15 条 */
const DEFAULT_SETTINGS: ForumGenSettings = {
  postCountMin: 7,
  postCountMax: 15,
  commentCountMin: 7,
  commentCountMax: 15,
  prompts: {},
};

function clampRange(
  min: number,
  max: number,
  bounds: { min: number; max: number },
): { min: number; max: number } {
  let lo = Math.round(Number.isFinite(min) ? min : bounds.min);
  let hi = Math.round(Number.isFinite(max) ? max : bounds.max);
  lo = Math.min(Math.max(lo, bounds.min), bounds.max);
  hi = Math.min(Math.max(hi, bounds.min), bounds.max);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { min: lo, max: hi };
}

/** 读取生成设置（缺省字段回落默认；范围越界自动钳制） */
export function getForumGenSettings(): ForumGenSettings {
  try {
    const raw = kvGet<Partial<ForumGenSettings>>(SETTINGS_KEY);
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    const posts = clampRange(
      raw.postCountMin ?? DEFAULT_SETTINGS.postCountMin,
      raw.postCountMax ?? DEFAULT_SETTINGS.postCountMax,
      POST_COUNT_BOUNDS,
    );
    const comments = clampRange(
      raw.commentCountMin ?? DEFAULT_SETTINGS.commentCountMin,
      raw.commentCountMax ?? DEFAULT_SETTINGS.commentCountMax,
      COMMENT_COUNT_BOUNDS,
    );
    const prompts: Partial<Record<PromptKey, string>> = {};
    if (raw.prompts && typeof raw.prompts === 'object' && !Array.isArray(raw.prompts)) {
      for (const [k, v] of Object.entries(raw.prompts)) {
        if (!(k in FORUM_PROMPT_DEFAULTS)) continue;
        if (typeof v !== 'string' || !v.trim()) continue;
        // 与默认一致的覆盖不算覆盖（面板据此显示「已自定义」角标）
        if (v === FORUM_PROMPT_DEFAULTS[k as PromptKey]) continue;
        prompts[k as PromptKey] = v.slice(0, PROMPT_OVERRIDE_MAX_LEN);
      }
    }
    return {
      postCountMin: posts.min,
      postCountMax: posts.max,
      commentCountMin: comments.min,
      commentCountMax: comments.max,
      prompts,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function save(next: ForumGenSettings): void {
  try {
    kvSet(SETTINGS_KEY, next);
  } catch {
    /* 存储异常静默（下轮读取回落默认） */
  }
}

/** 设置帖子生成条数范围（X~Y 条；钳制 + 自动交换大小） */
export function setPostCountRange(min: number, max: number): ForumGenSettings {
  const cur = getForumGenSettings();
  const r = clampRange(min, max, POST_COUNT_BOUNDS);
  const next = { ...cur, postCountMin: r.min, postCountMax: r.max };
  save(next);
  return next;
}

/** 设置评论生成条数范围（X~Y 条） */
export function setCommentCountRange(min: number, max: number): ForumGenSettings {
  const cur = getForumGenSettings();
  const r = clampRange(min, max, COMMENT_COUNT_BOUNDS);
  const next = { ...cur, commentCountMin: r.min, commentCountMax: r.max };
  save(next);
  return next;
}

/** 写入一条提示词覆盖（text 为空 = 恢复默认）。保存即生效——下一次生成立刻用新提示词。 */
export function setPromptOverride(key: PromptKey, text: string): ForumGenSettings {
  const cur = getForumGenSettings();
  const prompts = { ...cur.prompts };
  const t = text.slice(0, PROMPT_OVERRIDE_MAX_LEN);
  if (!t.trim() || t === FORUM_PROMPT_DEFAULTS[key]) delete prompts[key];
  else prompts[key] = t;
  const next = { ...cur, prompts };
  save(next);
  return next;
}

/** 恢复单条提示词为默认 */
export function resetPrompt(key: PromptKey): ForumGenSettings {
  return setPromptOverride(key, '');
}

/** 恢复全部提示词为默认 */
export function resetAllPrompts(): ForumGenSettings {
  const next = { ...getForumGenSettings(), prompts: {} };
  save(next);
  return next;
}

/** 本次生成帖子条数：在用户设置的 [min, max] 内均匀抽一个 */
export function rollPostCount(): number {
  const s = getForumGenSettings();
  return s.postCountMin + Math.floor(Math.random() * (s.postCountMax - s.postCountMin + 1));
}

/** 本次生成评论条数：在用户设置的 [min, max] 内均匀抽一个 */
export function rollCommentCount(): number {
  const s = getForumGenSettings();
  return s.commentCountMin + Math.floor(Math.random() * (s.commentCountMax - s.commentCountMin + 1));
}

/** 随请求送给服务端的提示词覆盖载荷（空对象 = 全默认，不额外占请求体） */
export function promptOverridesPayload(): Partial<Record<PromptKey, string>> {
  return getForumGenSettings().prompts;
}

/** 某条提示词当前生效的模板（覆盖优先，默认兜底）——面板展示用 */
export function activePromptOf(key: PromptKey): string {
  return getForumGenSettings().prompts[key] ?? FORUM_PROMPT_DEFAULTS[key];
}

/** 已自定义的提示词条数（抽屉入口角标/摘要用） */
export function countPromptOverrides(): number {
  return Object.keys(getForumGenSettings().prompts).length;
}
