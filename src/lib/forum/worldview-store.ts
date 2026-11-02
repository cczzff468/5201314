'use client';

/**
 * X论坛 · 世界观 / NPC 矩阵 / AI 规则的客户端存取。
 *
 * 存储（idb-kv，与论坛数据同仓——kvGet 同步读内存缓存，改完下一次生成立刻生效）：
 * - `forum-worldview-v1`：WorldviewState——激活的世界观 id + 全部世界观
 *   （内置 5 套展开成可编辑副本 + 用户自建）+ AI 规则三条；
 * - `forum-mnpc-index-v1`：矩阵 NPC 作者索引（id → 展示与生成所需字段快照），
 *   core.resolveAuthor('mnpc:<id>') 直读它解析作者；每次矩阵增删改/切换世界观时重建。
 *
 * 订阅：rev 计数 + window CustomEvent('forum-worldview-changed')，
 * 组件用 useSyncExternalStore(subscribeWorldview, worldviewSnapshot) 取快照。
 *
 * 世界观切换的「内容重置 + 重新播种」不在本层（会与 engine 循环依赖）——
 * UI 调 engine.switchWorldview(id)，它内部调本层 setActiveWorldview + 重建索引
 * + 复位论坛数据 + bootForum()。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  AI_RULES_MAX_LEN,
  BUILTIN_WORLDVIEWS,
  DEFAULT_WORLDVIEW_ID,
  builtinMatrixOf,
  cloneBuiltinWorldviews,
  matrixNpcPersona,
  type ForumAiRules,
  type MatrixNpc,
  type NpcRoleId,
  type WorldviewDef,
  type WorldviewPayload,
} from './worldview';

const STATE_KEY = 'forum-worldview-v1';
/** 矩阵 NPC 作者索引（core.resolveAuthor 直读） */
export const MNPC_INDEX_KEY = 'forum-mnpc-index-v1';

export interface WorldviewState {
  /** 激活的世界观 id */
  activeId: string;
  /** 全部世界观（内置副本 + 自建） */
  worldviews: WorldviewDef[];
  /** 论坛底层 AI 规则 */
  rules: ForumAiRules;
}

/** 自建世界观 / 自建 NPC 的 id 生成 */
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 矩阵 NPC 的 IP 属地（按 id 稳定取一个） */
const MNPC_IPS = ['北京', '上海', '广东', '浙江', '江苏', '四川', '湖南', '福建', '山东', '湖北', '陕西', '重庆'];
function stableIp(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)!) % 9973;
  return MNPC_IPS[h % MNPC_IPS.length];
}

// ---------------- 读取与初始化 ----------------

function initState(): WorldviewState {
  return {
    activeId: DEFAULT_WORLDVIEW_ID,
    worldviews: cloneBuiltinWorldviews(),
    rules: { postRules: '', commentRules: '', filterRules: '' },
  };
}

function sanitizeState(raw: unknown): WorldviewState {
  const def = initState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const rec = raw as Record<string, unknown>;
  const worldviews = Array.isArray(rec.worldviews)
    ? (rec.worldviews as unknown[]).filter((w): w is WorldviewDef => !!w && typeof w === 'object' && typeof (w as WorldviewDef).id === 'string' && typeof (w as WorldviewDef).name === 'string')
    : [];
  // 内置世界观必须齐全（版本升级补齐新增内置）；用户编辑过的副本（矩阵已改）保留
  const merged = [...worldviews];
  for (const b of BUILTIN_WORLDVIEWS) {
    if (!merged.some((w) => w.id === b.id)) merged.push({ ...b, tags: [...b.tags], seedPool: [...b.seedPool], matrix: b.matrix.map((n) => ({ ...n })) });
  }
  const known = new Set(merged.map((w) => w.id));
  let activeId = typeof rec.activeId === 'string' && known.has(rec.activeId) ? rec.activeId : DEFAULT_WORLDVIEW_ID;
  const rules = rec.rules && typeof rec.rules === 'object' && !Array.isArray(rec.rules)
    ? {
        postRules: String((rec.rules as Record<string, unknown>).postRules ?? '').slice(0, AI_RULES_MAX_LEN),
        commentRules: String((rec.rules as Record<string, unknown>).commentRules ?? '').slice(0, AI_RULES_MAX_LEN),
        filterRules: String((rec.rules as Record<string, unknown>).filterRules ?? '').slice(0, AI_RULES_MAX_LEN),
      }
    : def.rules;
  return { activeId, worldviews: merged, rules };
}

let cache: WorldviewState | null = null;

/** 读取世界观状态（首次调用初始化并落盘；后续同步读缓存） */
export function getWorldviewState(): WorldviewState {
  if (cache) return cache;
  const raw = kvGet(STATE_KEY);
  const state = sanitizeState(raw);
  cache = state;
  // SSR 防护：初始化写盘只在浏览器执行（kvGet 内存层服务端安全返回 null）
  if (!raw && typeof window !== 'undefined') kvSet(STATE_KEY, state);
  return state;
}

function save(next: WorldviewState): void {
  cache = next;
  try {
    kvSet(STATE_KEY, next);
  } catch {
    /* 存储异常静默（下次读取回落默认） */
  }
  bump();
}

// ---------------- 订阅（useSyncExternalStore） ----------------

let rev = 0;
const EVENT = 'forum-worldview-changed';
/** 快照缓存（referential stability：两次 bump 之间返回同一对象） */
let snap: WorldviewState | null = null;

function bump(): void {
  rev += 1;
  snap = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeWorldview(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function worldviewSnapshot(): WorldviewState {
  if (!snap) snap = getWorldviewState();
  return snap;
}

// ---------------- 查询 ----------------

export function activeWorldview(): WorldviewDef | null {
  const s = getWorldviewState();
  return s.worldviews.find((w) => w.id === s.activeId) ?? null;
}

/** 当前世界观的话题方向（v37：只作生成素材混进内容，不再作首页 tab 标签；空 = 无） */
export function worldviewTags(): string[] {
  const wv = activeWorldview();
  return wv && wv.tags.length ? wv.tags.filter((t) => t.trim()).slice(0, 8) : [];
}

/** 当前世界观的核心 NPC 阵容 */
export function activeMatrixNpcs(): MatrixNpc[] {
  const wv = activeWorldview();
  if (!wv) return [];
  return wv.matrix.filter((n) => n.name.trim());
}

/** 某个世界观的 NPC 数量（面板角标） */
export function matrixNpcCount(wvId: string): number {
  const s = getWorldviewState();
  return s.worldviews.find((w) => w.id === wvId)?.matrix.length ?? 0;
}

/** AI 规则里非空的条数（抽屉角标） */
export function countCustomRules(): number {
  const r = getWorldviewState().rules;
  return [r.postRules, r.commentRules, r.filterRules].filter((x) => x.trim()).length;
}

// ---------------- 世界观 CRUD ----------------

/** 激活某个世界观（不触发内容重置——那是 engine.switchWorldview 的事）。校验存在性。 */
export function setActiveWorldviewId(id: string): boolean {
  const s = getWorldviewState();
  if (!s.worldviews.some((w) => w.id === id)) return false;
  if (s.activeId === id) return true;
  save({ ...s, activeId: id });
  return true;
}

export interface WorldviewDraft {
  name: string;
  desc?: string;
  background: string;
  tags: string[];
  matrix?: MatrixNpc[];
}

/** 新建自定义世界观（返回新 id；校验失败返回 null） */
export function addWorldview(draft: WorldviewDraft): string | null {
  const name = draft.name.trim().slice(0, 24);
  const background = draft.background.trim().slice(0, 1200);
  if (!name || !background) return null;
  const s = getWorldviewState();
  const id = uid('custom');
  const wv: WorldviewDef = {
    id,
    name,
    desc: (draft.desc?.trim() || '自定义世界观').slice(0, 60),
    background,
    tags: draft.tags.map((t) => t.trim().slice(0, 16)).filter(Boolean).slice(0, 8),
    matrix: (draft.matrix ?? []).map((n) => ({ ...n })),
    seedPool: [],
  };
  save({ ...s, worldviews: [...s.worldviews, wv] });
  return id;
}

/** 编辑世界观基础字段（名称/背景/话题方向/简介；内置的也可以改，矩阵另走矩阵接口） */
export function updateWorldview(id: string, patch: Partial<Pick<WorldviewDef, 'name' | 'desc' | 'background' | 'tags'>>): boolean {
  const s = getWorldviewState();
  const idx = s.worldviews.findIndex((w) => w.id === id);
  if (idx < 0) return false;
  const cur = s.worldviews[idx];
  const next: WorldviewDef = {
    ...cur,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 24) || cur.name : cur.name,
    desc: patch.desc !== undefined ? patch.desc.trim().slice(0, 60) || cur.desc : cur.desc,
    background: patch.background !== undefined ? patch.background.trim().slice(0, 1200) || cur.background : cur.background,
    tags: patch.tags !== undefined ? patch.tags.map((t) => t.trim().slice(0, 16)).filter(Boolean).slice(0, 8) : cur.tags,
  };
  const worldviews = [...s.worldviews];
  worldviews[idx] = next;
  save({ ...s, worldviews });
  return true;
}

/** 删除自定义世界观（内置不可删；删除的是激活项则回落默认）。返回是否成功。 */
export function deleteWorldview(id: string): boolean {
  const s = getWorldviewState();
  const wv = s.worldviews.find((w) => w.id === id);
  if (!wv || wv.builtin) return false;
  const worldviews = s.worldviews.filter((w) => w.id !== id);
  const activeId = s.activeId === id ? DEFAULT_WORLDVIEW_ID : s.activeId;
  save({ ...s, worldviews, activeId });
  return true;
}

// ---------------- 矩阵 NPC CRUD ----------------

export interface MatrixNpcDraft {
  name: string;
  roleId: NpcRoleId;
  roleLabel?: string;
  personaText: string;
  catchphrase?: string;
  postFreq?: number;
  avatar?: string | null;
}

function normalizeNpcDraft(d: MatrixNpcDraft, existing?: MatrixNpc): MatrixNpc | null {
  const name = d.name.trim().slice(0, 16);
  if (!name) return null;
  const postFreq = Math.min(Math.max(Math.round(d.postFreq ?? 5), 1), 10);
  return {
    id: existing?.id ?? uid('mnpc'),
    name,
    roleId: d.roleId,
    roleLabel: d.roleLabel?.trim().slice(0, 16),
    personaText: d.personaText.trim().slice(0, 400),
    catchphrase: d.catchphrase?.trim().slice(0, 60),
    postFreq,
    avatar: d.avatar ?? null,
    followers: existing?.followers ?? Math.floor(500 + Math.random() * 90000),
    verified: existing?.verified ?? false,
    bio: existing?.bio ?? '',
    builtin: existing?.builtin,
  };
}

/** 新增 / 编辑矩阵 NPC（id 为空 = 新增）。改动立即重建作者索引并生效。 */
export function upsertMatrixNpc(wvId: string, draft: MatrixNpcDraft, npcId?: string): boolean {
  const s = getWorldviewState();
  const idx = s.worldviews.findIndex((w) => w.id === wvId);
  if (idx < 0) return false;
  const wv = s.worldviews[idx];
  const existIdx = npcId ? wv.matrix.findIndex((n) => n.id === npcId) : -1;
  const merged = normalizeNpcDraft(draft, existIdx >= 0 ? wv.matrix[existIdx] : undefined);
  if (!merged) return false;
  const matrix = [...wv.matrix];
  if (existIdx >= 0) matrix[existIdx] = merged;
  else matrix.push(merged);
  const worldviews = [...s.worldviews];
  worldviews[idx] = { ...wv, matrix };
  save({ ...s, worldviews });
  // 改的是当前世界观 → 立即重建索引（发帖/评论/头像立即用新身份）
  if (s.activeId === wvId) rebuildMatrixIndex();
  return true;
}

/** 删除矩阵 NPC */
export function removeMatrixNpc(wvId: string, npcId: string): boolean {
  const s = getWorldviewState();
  const idx = s.worldviews.findIndex((w) => w.id === wvId);
  if (idx < 0) return false;
  const wv = s.worldviews[idx];
  const matrix = wv.matrix.filter((n) => n.id !== npcId);
  if (matrix.length === wv.matrix.length) return false;
  const worldviews = [...s.worldviews];
  worldviews[idx] = { ...wv, matrix };
  save({ ...s, worldviews });
  if (s.activeId === wvId) rebuildMatrixIndex();
  return true;
}

/** 内置世界观的矩阵恢复出厂（自建世界观无出厂阵容，返回 false） */
export function resetMatrix(wvId: string): boolean {
  const s = getWorldviewState();
  const idx = s.worldviews.findIndex((w) => w.id === wvId);
  if (idx < 0) return false;
  const wv = s.worldviews[idx];
  if (!wv.builtin) return false;
  const stock = builtinMatrixOf(wvId);
  if (!stock) return false;
  const worldviews = [...s.worldviews];
  worldviews[idx] = { ...wv, matrix: stock.map((n) => ({ ...n })) };
  save({ ...s, worldviews });
  if (s.activeId === wvId) rebuildMatrixIndex();
  return true;
}

// ---------------- AI 规则 ----------------

export function setAiRules(rules: Partial<ForumAiRules>): void {
  const s = getWorldviewState();
  save({
    ...s,
    rules: {
      postRules: (rules.postRules ?? s.rules.postRules).slice(0, AI_RULES_MAX_LEN),
      commentRules: (rules.commentRules ?? s.rules.commentRules).slice(0, AI_RULES_MAX_LEN),
      filterRules: (rules.filterRules ?? s.rules.filterRules).slice(0, AI_RULES_MAX_LEN),
    },
  });
}

export function resetAiRules(): void {
  const s = getWorldviewState();
  save({ ...s, rules: { postRules: '', commentRules: '', filterRules: '' } });
}

// ---------------- 矩阵作者索引（resolveAuthor 用） ----------------

export interface MatrixAuthorRec {
  name: string;
  handle?: string;
  avatar: string | null;
  bio: string;
  followers: number;
  verified?: boolean;
  /** 生成用合并人设（身份+性格+口头禅） */
  persona: string;
  ip: string;
}

/** 把当前世界观矩阵写入作者索引（切换世界观 / 矩阵增删改后调用） */
export function rebuildMatrixIndex(): void {
  const npcs = activeMatrixNpcs();
  const idx: Record<string, MatrixAuthorRec> = {};
  for (const n of npcs) {
    idx[n.id] = {
      name: n.name,
      avatar: n.avatar ?? null,
      bio: n.bio ?? '',
      followers: n.followers ?? Math.floor(500 + Math.random() * 90000),
      verified: n.verified,
      persona: matrixNpcPersona(n),
      ip: stableIp(n.id),
    };
  }
  try {
    kvSet(MNPC_INDEX_KEY, idx);
  } catch {
    /* 静默 */
  }
}

// ---------------- 生成请求载荷（engine.callApi 附带） ----------------

/** 随生成请求送给服务端的世界观 + 规则（保存即生效：每次调用都重读） */
export function worldviewApiPayload(): { worldview: WorldviewPayload; rules: ForumAiRules } {
  const s = getWorldviewState();
  const wv = s.worldviews.find((w) => w.id === s.activeId) ?? null;
  return {
    worldview: wv
      ? { name: wv.name, background: wv.background, tags: wv.tags.filter((t) => t.trim()).slice(0, 8) }
      : { name: '论坛', background: '', tags: [] },
    rules: s.rules,
  };
}
