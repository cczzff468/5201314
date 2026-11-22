'use client';

/**
 * 上下文记忆模式（Token 瘦身系统）：
 *
 * 用户可按会话切换「极简省流」/「全量记忆」两档。运行期 chat 组件按模式动态裁剪
 * 「可裁剪区」（聊天历史 + 长期记忆召回），「永不裁剪区」（人设 / 世界书 / 自定义规则 /
 * 感知状态 / 系统基础规则）一律全量注入。
 *
 * ⚠️ 豁免规则（绝对不能裁剪的内容，瘦身逻辑必须绕开）：
 *   1. 系统基础规则与底层限制（prompt-entries 注册表的 system 块）
 *   2. 用户自定义的所有提示词（customRules / 全局 prompt 条目）
 *   3. 所有已激活的世界书条目（worldbook blocks —— beforeSystem/afterSystem/beforeChar/afterChar 全保留）
 *   4. 核心角色人设（buildPersonaSystemPrompt 完整输出）
 *   5. 当前感知状态（时间感知 / 实时感知 / 拉黑关系 / 朋友圈动态 / X 论坛近况）
 *   6. 使用工具（buildShizukuAutonomyRules / buildVisionRules / photo rule）
 *
 * ⚠️ 允许动态裁剪的内容（瘦身区）：
 *   - 聊天历史记录：minimal 模式取最近 10 条；full 模式取最近 30 条
 *   - 长期记忆召回：minimal 模式只取最相关 5 条；full 模式取全部（受 MEM_RECALL_BUDGET 字符上限兜底）
 *
 * 存储位置：localStorage `chat-context-mode`（JSON map by scopedConvKey(sessionKey)，
 *   与 lib/time-aware.ts 同款模式，多账号隔离由 scopedConvKey 自动加后缀）
 */

import { scopedConvKey } from './ios/accounts';

export type ContextMode = 'minimal' | 'full';

const LS_KEY = 'chat-context-mode';
const DEFAULT_MODE: ContextMode = 'full';

type ModeMap = Record<string, ContextMode>;

function readMap(): ModeMap {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ModeMap = {};
    const src = parsed as Record<string, unknown>;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v === 'minimal' || v === 'full') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: ModeMap): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // 忽略配额错误
  }
}

/** 读取某会话的上下文模式（默认 'full'） */
export function getContextMode(sessionKey: string): ContextMode {
  const map = readMap();
  return map[scopedConvKey(sessionKey)] ?? DEFAULT_MODE;
}

/** 设置某会话的上下文模式 */
export function setContextMode(sessionKey: string, mode: ContextMode): void {
  const map = readMap();
  map[scopedConvKey(sessionKey)] = mode;
  writeMap(map);
}

/** 极简模式：聊天历史条数上限（最近 10 条） */
export const HISTORY_LIMIT_MINIMAL = 10;
/** 全量模式：聊天历史条数上限（最近 30 条） */
export const HISTORY_LIMIT_FULL = 30;

/** 按模式返回聊天历史条数上限 */
export function historyLimitFor(mode: ContextMode): number {
  return mode === 'minimal' ? HISTORY_LIMIT_MINIMAL : HISTORY_LIMIT_FULL;
}

/** 极简模式：长期记忆召回条数上限（最相关 5 条） */
export const MEMORY_LIMIT_MINIMAL = 5;

/**
 * 按模式返回长期记忆召回条数上限：
 * - minimal → 5（只取最相关的 5 条，跨长期/核心/碎片三层统一裁剪）
 * - full → undefined（不限，由各层内部安全上限 8/12/5 与 MEM_RECALL_BUDGET 字符预算兜底）
 */
export function memoryMaxRowsFor(mode: ContextMode): number | undefined {
  return mode === 'minimal' ? MEMORY_LIMIT_MINIMAL : undefined;
}

/** 记忆块始终注入（极简模式限 5 条，全量模式不限）；世界书/人设/感知/工具规则永不裁剪 */
export function shouldInjectMemoryBlock(_mode: ContextMode): boolean {
  return true;
}

/** 极简模式是否跳过用户画像召回块（profileRecallBlock） */
export function shouldInjectProfileBlock(mode: ContextMode): boolean {
  return mode === 'full';
}

/** 极简模式是否跳过跨 App 近况块（crossAppBlock） */
export function shouldInjectCrossAppBlock(mode: ContextMode): boolean {
  return mode === 'full';
}

/** 极简模式是否跳过朋友圈动态感知块（momentsBlock） */
export function shouldInjectMomentsBlock(mode: ContextMode): boolean {
  return mode === 'full';
}

/** 极简模式是否跳过 X 论坛近况块（forumBlock） */
export function shouldInjectForumBlock(mode: ContextMode): boolean {
  return mode === 'full';
}

/**
 * 优先级声明块（注入到 system 末尾，明确层级防止 AI 精分）：
 *
 * 当前用户指令 > 世界书硬设定 > 核心人设 > 长期记忆
 * - 若记忆与世界书冲突，以世界书为准；
 * - 用户当场指令永远最高；
 * - 后台自动触发的消息（习惯感知 / 焦虑 / 查岗）不得打断当前聊天话题。
 */
export const PRIORITY_DECLARATION = [
  '【信息优先级铁律（防精分）】',
  '本系统信息按以下优先级裁定，冲突时高层覆盖低层：',
  '1. 用户当场指令（最高，不可被任何后台任务覆盖）',
  '2. 世界书硬设定（不可被记忆推翻；记忆与世界书冲突时以世界书为准）',
  '3. 核心人设（名字 / 性格 / 背景 / 关系，永久稳定）',
  '4. 长期记忆（最底层，仅作参考；若与上述任一冲突，作废以最近层为准）',
  '注意：后台自动触发的消息（习惯感知 / 焦虑连发 / 查岗）不得打断用户当前正在聊的话题，',
  '若用户近 5 分钟内有互动，必须延续当前话题，不可突兀切换。',
].join('\n');
