/**
 * 角色分支注册表核心（Task 38 从 branch.ts 拆出）：
 *
 * 为什么独立成模块：branch.ts 依赖 moments.ts（复制朋友圈副本），而朋友圈引擎（moments.ts）、
 * 主动来电（proactive-call.ts）、跨App找人（cross-app-reach.ts）都需要判定「这个联系人是不是分支」
 * ——若它们直接 import branch.ts 会形成 moments ↔ branch 循环依赖。本模块只依赖 idb-kv
 * （同步内存读），任何一方可安全引用；branch.ts 从这里 re-export 保持既有 import 路径兼容。
 *
 * 注册表（设备级键，不随账号作用域——分支关系属于联系人本体）：
 * - `char-branch-meta:<分支id>` 记录父/根/分支点；
 * - `char-branch-index` 记录 父id → 分支id[]。
 */

import { kvGet } from '@/lib/ios/idb-kv';

export const META_PREFIX = 'char-branch-meta:';
export const INDEX_KEY = 'char-branch-index';

export interface CharBranchMeta {
  /** 直接父角色（分支来源；嵌套分支的父辈也可能是分支） */
  parentId: string;
  /** 分支链头（本分支若再被分支，其子分支 rootId 仍指向这里记录的源头） */
  rootId: string;
  /** 分支点消息 id（复制聊天记录到该条为止，含该条） */
  pointMsgId: string;
  /** 分支点时间（消息 time；记忆/朋友圈按它过滤） */
  pointTime: number;
  /** 分支点消息内容摘要（详情页/提示参考） */
  pointPreview: string;
  /** 分支创建时间 */
  createdAt: number;
  /** 分支时为专属世界书生成的克隆书 id（删除分支时一并清理，原书不动） */
  clonedBookIds?: string[];
}

/** 读某联系人的分支元数据（非分支角色返回 null；同步读——kv 层内存写穿） */
export function getBranchMeta(contactId: string): CharBranchMeta | null {
  try {
    const raw = kvGet<CharBranchMeta>(`${META_PREFIX}${contactId}`);
    if (raw && typeof raw === 'object' && typeof raw.parentId === 'string' && raw.parentId) return raw;
    return null;
  } catch {
    return null;
  }
}

/** 读某角色的直接子分支 id 列表（无分支返回空数组） */
export function childBranchIds(parentId: string): string[] {
  try {
    const index = kvGet<Record<string, string[]>>(INDEX_KEY);
    const list = index?.[parentId];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 分支链头（rootId）：非分支角色即自身。同源互斥（Task 38-3A）按链头分组 */
export function branchRootIdOf(contactId: string): string {
  return getBranchMeta(contactId)?.rootId ?? contactId;
}

// ---------------- 出生静默期（Task 38-1A） ----------------

/** 静默时长：创建后 24h 内不参与主动来电/朋友圈自动发帖/自动互动 */
export const BIRTH_SILENCE_MS = 24 * 3_600_000;

/**
 * 分支角色是否处于「出生静默期」：
 * - 非分支角色恒 false；
 * - 创建超过 24h 自动解除；
 * - 用户主动和分支聊过天（分支会话里存在晚于创建时间的「我」的消息）提前解除——
 *   分支时间线停在分支点，由用户主动开启分支后的新生活，之后它才重新成为后台引擎的活跃角色；
 * - 消息数组读取失败按静默期处理（宁静勿扰）。
 * 同步实现（kvGet 内存读），可安全用于调度 tick 的热路径。
 */
export function isBranchBirthSilent(contactId: string, nowMs: number = Date.now()): boolean {
  const meta = getBranchMeta(contactId);
  if (!meta) return false;
  if (nowMs - meta.createdAt >= BIRTH_SILENCE_MS) return false;
  try {
    const msgs = kvGet<Array<{ role?: unknown; time?: unknown }>>(`wx-chat-msgs:${contactId}`) ?? [];
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue;
      if (m.role !== 'me') continue;
      const t = typeof m.time === 'number' && Number.isFinite(m.time) ? m.time : 0;
      // 只认分支创建之后用户发的新消息（复制过来的历史消息 time ≤ 分支点 ≤ 创建时间）
      if (t > meta.createdAt) return false;
    }
  } catch {
    // 读不到按静默期处理
  }
  return true;
}
