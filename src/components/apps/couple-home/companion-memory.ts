/**
 * 拾光小屋 · 陪伴交互记忆接线（v8.0 模块六）
 *
 * 所有陪伴行为提炼成事件，实时写入该角色的「记忆库」（与现有全局记忆系统互通）：
 * - 对话记忆：每轮对话经 memAfterAiTurn 走标准提取管线（碎片 → 核心 → 长期），
 *   scene 标注「拾光小屋」，重要信息（明天考试等）由提取器自动入长期记忆；
 * - 物理动作记忆：拥抱/牵手/指令执行成功后，memAddEventFragment 直写事件碎片；
 * - 自主行为记忆：同类行为一天只记一次（显式查重，防记忆刷屏）；
 * - 空间记忆：牵着手走进新房间 → 「用户牵着我的手，带我去了××」；
 * - 注入与唤醒：每轮对话 memChatRecallBlock 召回 + 最近物理互动摘要注入 system。
 *
 * 碎片 sourceTag 前缀 `cabin-`（物理/空间/自主），供本模块查询与 UI 展示。
 */

import type { ApiConfig } from '@/lib/ios/store';
import {
  listFragments,
  memAddEventFragment,
  memAfterAiTurn,
  memChatRecallBlock,
  profileRecallBlock,
  setMemScopeForApp,
  type MemConvoTurn,
  type MemNames,
} from '@/lib/memory';

export { setMemScopeForApp };

/** 记忆来源 App：拾光小屋（互通开关开启时微信/QQ/信息/电话都能召回小屋里的事） */
export const CABIN_APP = 'cabin' as const;

/** 碎片来源标签前缀（cabin 专属事件） */
const TAG_PREFIX = 'cabin-';

/**
 * 直写一条小屋事件记忆（拥抱/牵手/指令执行/主动请求…）。
 * 视角句式由调用方拼好（[角色名]第一人称口吻，「用户」用真实名字）。
 */
export function cabinEventMemory(
  contactId: string,
  text: string,
  tag: string,
  opts?: { dedupeSeconds?: number },
): void {
  try {
    if (!contactId || !text.trim()) return;
    // 同标签短时间去重（防手抖连点刷屏；默认 90s 内同文案只记一次）
    const dedupe = opts?.dedupeSeconds ?? 90;
    const dup = listFragments(contactId).some(
      (f) => f.sourceTag === tag && Date.now() - f.createdAt < dedupe * 1000,
    );
    if (dup) return;
    memAddEventFragment(contactId, CABIN_APP, text.trim(), {
      sourceTag: tag,
      eventTime: Date.now(),
    });
  } catch {
    // 记忆失败不影响主流程
  }
}

/**
 * 自主行为记忆（同类一天一次）：kind 如 'sit' / 'watch-tv' / 'goto-br'。
 * 当天（自然日）已有同 kind 碎片 → 跳过，绝不刷屏。
 */
export function cabinBehaviorMemoryOncePerDay(
  contactId: string,
  kind: string,
  text: string,
): void {
  try {
    if (!contactId || !text.trim()) return;
    const tag = `${TAG_PREFIX}auto:${kind}`;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const exists = listFragments(contactId).some(
      (f) => f.sourceTag === tag && f.createdAt >= dayStart.getTime(),
    );
    if (exists) return;
    memAddEventFragment(contactId, CABIN_APP, text.trim(), { sourceTag: tag, eventTime: Date.now() });
  } catch {
    // 记忆失败不影响主流程
  }
}

/**
 * 最近的小屋互动记忆摘要（注入 system 的「最近我们在小屋里发生的事」节）：
 * 取 sourceTag 前缀 cabin- 的碎片按时间倒序前 limit 条。
 */
export function cabinRecentInteractions(contactId: string, limit = 6): string[] {
  try {
    return listFragments(contactId)
      .filter((f) => (f.sourceTag ?? '').startsWith(TAG_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((f) => f.content);
  } catch {
    return [];
  }
}

/**
 * 组装小屋记忆注入块（每轮对话 system 用）：
 * ① memChatRecallBlock 标准召回（长期/核心/碎片三层 + 互通开关）；
 * ② 画像图谱注入（Task 14-b B1）：用户画像事实层（喜好/忌讳/习惯/身份/重要日子），
 *    TA 在小屋聊天也知道这些（「你不是不吃香菜嘛」）；
 * ③ 最近物理互动摘要（拥抱/牵手/指令/自主行为，让 AI 记得刚才发生的事）。
 */
export function cabinMemoryBlock(contactId: string, contextText: string, names?: MemNames | null): string {
  try {
    const recall = memChatRecallBlock(contactId, CABIN_APP, contextText);
    const profile = profileRecallBlock(contactId);
    const recent = cabinRecentInteractions(contactId, 6);
    if (!recall.trim() && !profile.trim() && recent.length === 0) return '';
    const lines: string[] = [];
    if (recall.trim()) lines.push(recall.trim());
    if (profile.trim()) lines.push(profile.trim());
    if (recent.length > 0) {
      lines.push(
        '【最近你们在拾光小屋里亲身发生的事（好好记得，可以自然提起）】',
        ...recent.map((t) => `- ${t}`),
      );
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * 一轮小屋对话结束后的标准记忆管线（对话文本 → 短期记忆碎片 → 重要信息入长期）：
 * 与微信/QQ/信息聊天同源同逻辑（memAfterAiTurn），scene 标注「拾光小屋」。
 * convo：本轮会话的问答轮次（调用方维护会话累计，≥4 轮才会触发一次提取）。
 */
export function cabinAfterChatTurn(
  contactId: string,
  apiConfig: ApiConfig,
  convo: MemConvoTurn[],
  names: MemNames | null,
): void {
  try {
    memAfterAiTurn(
      contactId,
      CABIN_APP,
      apiConfig,
      () => convo,
      undefined, // 小屋会话无持久消息数组：每轮固定计 1 用户 + 1 AI
      names,
      { scene: '拾光小屋（3D 小屋里面对面相处、对话与互动）' },
    );
  } catch {
    // 记忆失败不影响聊天
  }
}
