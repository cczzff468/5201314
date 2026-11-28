'use client';

/**
 * 接力消息快照落库（v2.4.31 · 「通知与聊天界面实时同步」根修·第一环：数据写入前置）。
 *
 * 机主痛点：AI 在后台发消息时，系统通知弹了、但消息本体还躺在服务端 pending 队列——
 * 只有点进对应聊天页（挂载拉取 pullBgPending）才落库上屏，「通知弹完点进去消息才显示」。
 *
 * 修复后的数据流（bg-relay-watcher.peekOnce 驱动）：
 *   服务端 pending → 【先落库快照（本模块）】→ 再弹系统通知 →（用户点进任意入口时
 *   消息已在本地库/内存，挂载即渲染）→ 聊天页挂载拉取原批 items → 正式投递管线
 *   （buildReplyMsgs 完整解析动作标记/生图/卡片）接管：入口先清掉本会话全部快照
 *   （clearRelaySnaps），再按原管线逐条落盘——快照只是「先让数据躺在库里」的占位，
 *   正式投递是唯一权威版本，两者绝不共存（同 id 去重 + 前缀整批清除双保险）。
 *
 * 快照消息：
 * - id = `bgsnap-<服务端消息id>`（服务端 item.id#序号，稳定）；正式投递的消息是新 uid，
 *   与快照天然不冲突；落库前按 id 去重（peek 重复触发时幂等，零重复落库）。
 * - 文本 = 服务端净化后的逐条消息（与通知正文同源同口径——通知显示什么，快照就是什么）。
 * - 结构对齐各端 loadMsgs 的校验（content string + role 白名单），纯文本气泡，
 *   不带任何动作标记（服务端 relayPreviewText 已剥）。
 * - 落库同时：wx/qq 端 bump 未读角标（快照落库时聊天页必然未挂载——挂载即拉走 pending，
 *   不存在「正看着还 bump」的双计）；信息端未读由挂载投递路径按既有水位逻辑处理。
 *
 * 全部同步 kv 操作（idb-kv 内存同步读 + 防抖落盘，pagehide 冲刷），零组件依赖——
 * 三个 App 的消息存储键约定（wx-chat-msgs:/qq-chat-msgs:/ios-chat-msgs:）由本模块
 * 独立读写，聊天页挂载 init/loadMsgs 自然读到快照，无需额外广播。
 */

import { kvGet, kvSetDebounced } from './idb-kv';
import { qqUnreads, wxUnreads } from '../unread-store';

/** 快照消息 id 前缀（聊天页正式投递接管时按前缀整批清除） */
export const SNAP_ID_PREFIX = 'bgsnap-';

/** 守望者 peek 拿到的逐条消息（服务端 buildRelayMessages 产出，id 稳定 `${item.id}#${i}`） */
export interface SnapMsg {
  id: string;
  text: string;
}

/** 各端消息存储键（与 wx-app/core.tsx lsMsgsKey、qq-app/core.tsx lsMsgsKey、chat.tsx lsMsgsKey 同构） */
function storeKeyOf(sessionKey: string): string | null {
  if (sessionKey.startsWith('wx:')) return `wx-chat-msgs:${sessionKey.slice(3)}`;
  if (sessionKey.startsWith('qq:')) return `qq-chat-msgs:${sessionKey.slice(3)}`;
  if (sessionKey.startsWith('sms:')) {
    const storageKey = sessionKey.slice(4);
    return storageKey === 'assistant' ? 'ios-chat-assistant-msgs' : `ios-chat-msgs:${storageKey}`;
  }
  return null;
}

/** 群聊会话不走接力（bg-turn isGroupSession 同口径）：快照同样跳过，防幻影落库 */
function isGroupSession(sessionKey: string): boolean {
  return sessionKey.startsWith('wx:group:') || sessionKey.startsWith('qq:group:');
}

/** 极简消息形状（仅落库所需字段；role 各端白名单内） */
interface SnapRecord {
  id: string;
  role: string;
  content: string;
  time: number;
  unread?: boolean;
}

/** 读某会话存储键下的消息列表（非数组/损坏返回空数组；不经过各端 loadMsgs 的规范化——快照本身是标准结构） */
function readList(key: string): SnapRecord[] {
  try {
    const parsed: unknown = kvGet<unknown>(key);
    return Array.isArray(parsed) ? (parsed.filter((m) => m && typeof m === 'object') as SnapRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * 落库快照（幂等）：按 id 去重后追加到会话存储尾部，wx/qq 端顺带 bump 未读角标。
 * 返回真实新落库的条数（0 = 全部已存在或会话不适用——调用方无需任何后续动作）。
 *
 * busy 防护由调用方（bg-relay-watcher.peekOnce）负责：会话正在流式/投递中时不会调到这里
 * （原管线会正常落库+弹通知，快照抢写反而会与投递队列交错）。
 */
export function snapRelayMessages(sessionKey: string, msgs: SnapMsg[]): number {
  if (typeof window === 'undefined') return 0;
  if (msgs.length === 0) return 0;
  if (isGroupSession(sessionKey)) return 0;
  const key = storeKeyOf(sessionKey);
  if (!key) return 0;
  try {
    const list = readList(key);
    const existing = new Set(list.map((m) => (typeof m.id === 'string' ? m.id : '')));
    const role: SnapRecord['role'] = sessionKey.startsWith('sms:') ? 'assistant' : 'peer';
    // 微信端已读回执口径（deliverAiMsg 同款）：AI 消息 unread:true，用户回话时转已读
    const withUnread = sessionKey.startsWith('wx:');
    let t = Date.now();
    let added = 0;
    for (const m of msgs) {
      if (!m || typeof m.id !== 'string' || typeof m.text !== 'string') continue;
      const text = m.text.trim();
      if (!text) continue;
      const id = `${SNAP_ID_PREFIX}${m.id}`;
      if (existing.has(id)) continue; // 已落过（重复 peek / 原生弹过的批次回前台补落库）
      existing.add(id);
      const rec: SnapRecord = withUnread
        ? { id, role, content: text, time: t, unread: true }
        : { id, role, content: text, time: t };
      list.push(rec);
      t += 1; // 同批逐条 +1ms，保持稳定时序（buildReplyMsgs 的 t += 1 同款）
      added += 1;
    }
    if (added === 0) return 0;
    kvSetDebounced(key, list);
    // 未读角标：落库时聊天页必然未挂载（挂载即拉走 pending），不会与投递路径双计
    if (added > 0) {
      if (sessionKey.startsWith('wx:')) wxUnreads.bump(sessionKey.slice(3), added);
      else if (sessionKey.startsWith('qq:')) qqUnreads.bump(sessionKey.slice(3), added);
      // 信息端未读：chat.tsx 挂载时按既有水位（lastAssistantMarkOf）重算，快照天然计入
    }
    return added;
  } catch {
    return 0; // 存储异常：静默（正式投递路径不受影响，消息本体还在服务端 pending）
  }
}

/**
 * 清除本会话全部快照（聊天页 deliverBgItems 入口调用：正式投递接管前，把占位快照
 * 整批移除——清完再走 buildReplyMsgs/loadMsgs，正式消息是唯一权威版本）。
 * 同步 kv 操作（idb-kv 内存同步）：清完立刻 loadMsgs 即为无快照的干净列表。
 */
export function clearRelaySnaps(sessionKey: string): void {
  if (typeof window === 'undefined') return;
  if (isGroupSession(sessionKey)) return;
  const key = storeKeyOf(sessionKey);
  if (!key) return;
  try {
    const list = readList(key);
    const hasSnap = list.some((m) => typeof m.id === 'string' && m.id.startsWith(SNAP_ID_PREFIX));
    if (!hasSnap) return;
    kvSetDebounced(key, list.filter((m) => !(typeof m.id === 'string' && m.id.startsWith(SNAP_ID_PREFIX))));
  } catch {
    // 清理失败静默：快照残留最多让正式投递与快照短暂并存（id 不同不会互相覆盖），下次投递再清
  }
}
