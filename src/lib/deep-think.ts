'use client';

/**
 * 深度思考（微信 / QQ / 信息三端单聊共用，按联系人隔离）：
 *
 * - 开关持久化在 IndexedDB kv store（ios-phone-db 的 kv，键 = deep-think:<contactId>，
 *   天然按联系人隔离——不同联系人各自记忆自己的开关；经 @/lib/ios/idb-kv 的内存写穿层
 *   同步读写，开机门控后组件层 kvGetRaw 一定命中，IndexedDB 异步落盘不丢）；
 * - 无论开关开还是关，每次发消息都在 system 里注入【深度思考】指令：AI 必须先用
 *   [思考]…[/思考] 包裹思考过程放在回复最开头，再写正文——开关只控制「前端要不要
 *   把思考过程渲染出来」（关闭 = 解析后直接丢弃，用户只看到最终正文），不改变模型行为；
 * - 流式剥离：chat-stream-store 的 onDelta 统一过 createThinkFilter 状态机，
 *   [思考]块不进正文累计（raw）也不进分段器（createReplySegmentScanner），思考内容
 *   单独收集、finalize 时经 ChatStreamResult.thinking 交给各端挂到本轮第一条 AI 消息；
 * - 非流式兜底：各端 buildReplyMsgs 入口再过一遍 extractThinkBlocks（bg 关页接力等
 *   绕过流总线的路径拿到的整段文本里若带 [思考] 块，就地剥掉防泄漏进气泡）；
 * - 标签跨增量分片安全：开始/结束标记被网络分片拆开（如「[思」「考]」分两个 delta）时
 *   状态机保留可能的半截前缀不输出，等下个增量拼齐后再判定；流结束时停在思考里
 *   （未闭合）的残量全部归入思考、不进正文。
 */

import { useSyncExternalStore } from 'react';
/** 思考块过滤/解析核心：抽到纯模块 @/lib/think-filter（客户端/服务端同构可导入），此处再导出保持三端既有 import 路径不变 */
import { kvGetRaw, kvSetRaw } from './ios/idb-kv';

export { createThinkFilter, extractThinkBlocks } from './think-filter';
export type { ThinkDelta, ThinkFilter } from './think-filter';

// ---------------- 开关持久化（IndexedDB kv，按联系人隔离） ----------------

/** kv 键前缀（+ contactId；不以 wx-/qq-/sms- 开头，不会被多账号作用域映射，按联系人全局生效） */
const KV_PREFIX = 'deep-think:';
/** 开关变更事件（本标签页即时刷新；订阅方 useSyncExternalStore 重读快照） */
const EVT = 'deep-think-change';

/** 读取某联系人的深度思考开关（未设置时默认关闭：思考过程解析后直接丢弃，只显示正文） */
export function getDeepThinkOn(contactId: string): boolean {
  if (!contactId) return false;
  return kvGetRaw<boolean>(`${KV_PREFIX}${contactId}`) === true;
}

/** 保存某联系人的深度思考开关（IndexedDB kv 写穿 + 派发变更事件，订阅方即时刷新渲染） */
export function setDeepThinkOn(contactId: string, on: boolean): void {
  if (!contactId) return;
  kvSetRaw(`${KV_PREFIX}${contactId}`, on);
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { contactId, on } }));
  } catch {
    // 事件派发失败忽略（下一次渲染仍会读到最新值）
  }
}

/** 订阅开关变化：本会话设置切换（EVT）触发重读快照 */
function subscribeDeepThink(notify: () => void): () => void {
  window.addEventListener(EVT, notify);
  return () => {
    window.removeEventListener(EVT, notify);
  };
}

/**
 * 联系人级深度思考开关（渲染订阅版）：useSyncExternalStore 订阅 kv 快照，
 * 设置页切换开关后历史消息的思维链卡片同步显隐（关闭 = 全部丢弃不渲染）。
 */
export function useDeepThinkOn(contactId: string): boolean {
  return useSyncExternalStore(
    subscribeDeepThink,
    () => getDeepThinkOn(contactId),
    // SSR 阶段无 kv：与默认态（关闭）保持一致
    () => false,
  );
}

// ---------------- 提示词规则（始终注入，与开关状态无关） ----------------

/**
 * 注入聊天 system 的深度思考指令：无论开关开还是关都注入（用户要求模型后台始终深度思考），
 * 强制 AI 先输出 [思考]…[/思考] 包裹的思考过程（回复最开头），再输出正文。
 * 放在 system 末尾（最新指令更受模型关注），并强调「无论回复长短都必须思考」——
 * 短回复场景（“在吗”→“在的”）模型最容易跳过思考块，必须显式钉死。
 */
export const DEEP_THINK_RULE =
  '【深度思考（每条回复必做）】每次回复前，请先进行深度思考：认真理解对方这句话的意思与情绪，结合你们的关系、过往记忆和当前情境，想清楚怎么回应最自然、最符合你的性格，然后再组织语言。' +
  '输出格式（严格遵守）：每条回复的第一个内容必须是 [思考] 标记，把你的思考过程（分析、回忆、斟酌语气）写在 [思考] 和 [/思考] 之间，[/思考] 之后紧接着写你真正要发送的聊天正文。' +
  '无论回复长短、哪怕只回一个字，都要先写思考块；思考要真实自然，不要在思考里把正文预先写一遍；正文里不要出现任何思考痕迹或这两个标记；' +
  '这两个标记只是给你理清思路用的，系统会在展示前自动摘除，对方看不到它们，请放心使用。' +
  '除思考块之外，正文照常遵守其他所有消息规则。';

/** 开关说明文案（设置页行下的小字，三端共用同一句式） */
export function deepThinkCaption(on: boolean): string {
  return on
    ? '开启后，对方每条回复都会先深度思考，气泡上方可展开查看思考过程。'
    : '已关闭：对方仍会在后台深度思考，但思考过程不显示，你只看到最终回复。';
}

// ---------------- 思考块标签与流式剥离状态机（实现见 @/lib/think-filter，此处仅保留文档） ----------------

// createThinkFilter / extractThinkBlocks / ThinkDelta / ThinkFilter 已迁移至纯模块 @/lib/think-filter
// （服务端 route 也能导入；deep-think.ts 顶部再导出，三端 @/lib/deep-think 旧导入路径零改动）
