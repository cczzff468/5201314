'use client';

/**
 * 全局预设管理器 · 客户端注入层（v63）。
 *
 * 职责：
 * 1. 注册同步读取源（kvGet 内存缓存 → prompt-entries.ts 的 clientStateSource）——
 *    注册后所有底层链路（persona / extraRules / 服务端桥接…）同步读到用户设置；
 * 2. 状态读写与变更函数（开关/编辑/深度/新增/删除/重置）——每次变更：
 *    kv 写穿（本会话即时生效）+ fire-and-forget 同步到服务端内存缓存
 *    （/api/settings/prompt-state，phone / memory / moments / forum 等
 *    服务端组装提示词的路由下一次请求即读到新值——「实时生效」）；
 * 3. PhoneShell 开机注册一次 + 周期性重同步（服务端重启/热更后自动补齐）。
 *
 * 存储：ios-phone-db kv store，键 prompt-entries:state（与论坛 gen-settings 同款方案：
 * kvGet 同步读内存缓存、kvSet 写穿 IndexedDB，开机门控前完成注水）。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  EMPTY_PROMPT_STATE,
  BUILTIN_PROMPT_ENTRIES,
  setPromptEntryClientSource,
  sanitizePromptEntryState,
  type PromptAppId,
  type PromptCategory,
  type PromptEntry,
  type PromptEntryState,
  type PromptRole,
} from '@/lib/prompt-entries';

const STATE_KEY = 'prompt-entries:state';

// ---------------- 读取源注册 ----------------

let registered = false;

/** 读取当前状态（未初始化/损坏 → 全默认空状态） */
export function readPromptEntryState(): PromptEntryState {
  try {
    const raw = kvGet(STATE_KEY);
    return sanitizePromptEntryState(raw) ?? { ...EMPTY_PROMPT_STATE };
  } catch {
    return { ...EMPTY_PROMPT_STATE };
  }
}

function writePromptEntryState(next: PromptEntryState): PromptEntryState {
  kvSet(STATE_KEY, next);
  return next;
}

/**
 * 注册同步读取源（幂等；PhoneShell 开机调用一次即可，设置页挂载也会兜底注册）。
 * 注册后 + 首次同步服务端，返回清理函数（测试用；生产周期重同步不主动停）。
 */
export function ensurePromptEntriesClientReady(): void {
  if (registered) return;
  registered = true;
  setPromptEntryClientSource(readPromptEntryState);
  // 首次同步 + 周期重同步（服务端 dev 热更/重启后内存缓存会丢，45s 内自动补齐）
  void syncPromptStateToServer();
  if (typeof window !== 'undefined') {
    window.setInterval(() => void syncPromptStateToServer(), 45_000);
  }
}

// ---------------- 服务端同步（fire-and-forget） ----------------

let syncInFlight = false;

/** 把当前状态同步到服务端内存缓存（尽力而为；失败不影响本地聊天——服务端回落默认） */
export async function syncPromptStateToServer(): Promise<void> {
  if (typeof window === 'undefined' || syncInFlight) return;
  syncInFlight = true;
  try {
    const st = readPromptEntryState();
    await fetch('/api/settings/prompt-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(st),
    });
  } catch {
    // 网络失败：周期重同步会补
  } finally {
    syncInFlight = false;
  }
}

// ---------------- 变更函数（设置页调用；返回新状态供 UI 刷新） ----------------

function bump(st: PromptEntryState): PromptEntryState {
  const next = { ...st, rev: (st.rev ?? 0) + 1 };
  writePromptEntryState(next);
  void syncPromptStateToServer();
  return next;
}

/** 全局启用/禁用某条（禁用 = 下一次请求起不再注入该段） */
export function setPromptEntryEnabled(id: string, enabled: boolean): PromptEntryState {
  const st = readPromptEntryState();
  const disabled = new Set(st.disabled);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  return bump({ ...st, disabled: [...disabled] });
}

/** 批量启用/禁用（多选操作） */
export function setPromptEntriesEnabled(ids: string[], enabled: boolean): PromptEntryState {
  const st = readPromptEntryState();
  const disabled = new Set(st.disabled);
  for (const id of ids) {
    if (enabled) disabled.delete(id);
    else disabled.add(id);
  }
  return bump({ ...st, disabled: [...disabled] });
}

/** 编辑某条文本（空串 = 恢复默认模板） */
export function setPromptEntryText(id: string, text: string): PromptEntryState {
  const st = readPromptEntryState();
  const edits = { ...st.edits };
  const builtin = BUILTIN_PROMPT_ENTRIES.find((e) => e.id === id);
  const t = text.slice(0, 40_000);
  if (!t.trim() || (builtin && t === builtin.content)) delete edits[id];
  else edits[id] = t;
  return bump({ ...st, edits });
}

/** 调整注入深度（数值越小越靠 Context 前部） */
export function setPromptEntryDepth(id: string, depth: number): PromptEntryState {
  const st = readPromptEntryState();
  const d = { ...st.depth };
  const n = Math.max(0, Math.min(999, Math.floor(Number(depth))));
  if (!Number.isFinite(n)) return st;
  const builtin = BUILTIN_PROMPT_ENTRIES.find((e) => e.id === id);
  if (builtin && n === builtin.depth) delete d[id];
  else d[id] = n;
  return bump({ ...st, depth: d });
}

/** 新增自定义条目（选择注入到哪个 App / 哪个 Role） */
export function addPromptEntry(input: {
  appId: PromptAppId;
  role: PromptRole;
  depth: number;
  title: string;
  desc?: string;
  content: string;
}): PromptEntryState & { created: PromptEntry | null } {
  const st = readPromptEntryState();
  const title = input.title.trim().slice(0, 60);
  const content = input.content.slice(0, 40_000);
  if (!title || !content.trim()) return { ...st, created: null };
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: PromptEntry = {
    id,
    appId: input.appId,
    role: input.role,
    depth: Math.max(0, Math.min(999, Math.floor(Number(input.depth)) || 50)),
    order: 0,
    title,
    desc: (input.desc ?? '').trim().slice(0, 120) || '自定义预设',
    category: (['persona', 'immersion', 'behavior', 'memory'] as PromptCategory[]).includes(
      // 自定义条目归入对应 App 的常见分类：这里统一放 immersion（用户可自行按深度控制位置）
      'immersion' as PromptCategory,
    )
      ? 'immersion'
      : 'immersion',
    content,
    builtin: false,
  };
  return { ...bump({ ...st, custom: [...st.custom, entry] }), created: entry };
}

/** 删除条目：自定义条目物理删除；内置条目 = 关闭 + 清掉编辑（可随时再开） */
export function deletePromptEntry(id: string): PromptEntryState {
  const st = readPromptEntryState();
  const isCustom = st.custom.some((c) => c.id === id);
  if (isCustom) {
    return bump({
      ...st,
      custom: st.custom.filter((c) => c.id !== id),
      deleted: [...st.deleted, id],
    });
  }
  const disabled = new Set(st.disabled);
  disabled.add(id);
  const edits = { ...st.edits };
  delete edits[id];
  return bump({ ...st, disabled: [...disabled], edits });
}

/** 恢复某条为内置默认（清编辑/清深度覆盖/开启） */
export function resetPromptEntry(id: string): PromptEntryState {
  const st = readPromptEntryState();
  const edits = { ...st.edits };
  const depth = { ...st.depth };
  const disabled = new Set(st.disabled);
  delete edits[id];
  delete depth[id];
  disabled.delete(id);
  return bump({ ...st, edits, depth, disabled: [...disabled] });
}

/** 全部恢复默认 */
export function resetAllPromptEntries(): PromptEntryState {
  return bump({ ...EMPTY_PROMPT_STATE, rev: (readPromptEntryState().rev ?? 0) + 1 });
}
