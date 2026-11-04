'use client';

/**
 * 记忆库（跨 App 共享记忆）：记忆碎片 / 核心记忆 / 长期记忆 / 每联系人设置。
 *
 * 设计要点（「记忆库 APP」需求）：
 * - 数据全部按【联系人 ID】隔离，localStorage 持久化（与聊天记录同层，重启保留）：
 *   · mem-frag:<contactId>   记忆碎片（每条带来源 App/时间/消息 ID/权重/加强时间）
 *   · mem-ltm:<contactId>    核心记忆（M 条碎片总结；键名沿用历史 ltm，语义=核心层）
 *   · mem-long:<contactId>   长期记忆（K 条核心记忆总结出的最稳定画像，层级顶层）
 *   · mem-settings:<contactId> 每联系人设置（提取频率/核心阈值/长期阈值/互通开关/失忆程度）
 *   · mem-msgcount:<cid>[:<app>[:group:<gid>]]  自上次提取累计的消息条数（提取节奏用）：
 *     群聊始终按群独立；私聊互通开 = 按角色一条计数（四 App 合并累计）、互通关 = 各 App 独立
 *   · mem-anchor:<cid>:<app>[:group:<gid>]  各会话已计数的最后一条消息 ID（增量计数锚点：
 *     每次 AI 回复后数锚点之后的新增消息（用户+AI 都算），汇入计数；切换互通只清计数不清锚点）
 *   · 旧 mem-round:<cid>:<app> 轮次键已废弃不再读写（仅删除联系人时残留清扫）
 * - 三层管线：碎片（每 N 条消息提取）→ 核心记忆（积累 M 条碎片总结一条）→ 长期记忆（积累 K 条
 *   未归档核心总结一条，默认 K=5）；核心被长期收编后标记 archivedAt（方案A：不再参与后续
 *   总结与召回，由长期记忆代表，避免重复总结/重复注入）。
 * - 互通开关（默认开）：开 = 四个 App（QQ/微信/信息/电话）共享该联系人全部记忆；
 *   关 = 各 App 只召回自己来源的记忆（碎片/核心/长期均按来源 App 过滤）。
 *   存储始终单一池 + App 标记：切换开关无需迁移数据，UI 管理视图始终展示该联系人全部记忆。
 * - 不同联系人之间永远隔离：键即隔离边界，召回/提取都不跨联系人读取。
 * - 【视角统一】提取/总结 prompt 一律用「用户真实名字 + 角色名字」指代双方，禁混用
 *   「对方/用户/我」；memRepairPerspectiveNow 可把旧版「对方/用户」代称修复为真实名字。
 * - 【过期淡化】失忆程度（快≈3天/中≈2周/慢≈2个月/从不）：超过有效期一半「淡化中」召回降权，
 *   超过有效期「已归档」不再参与召回与总结；低权重记忆先淡化、高权重更持久；
 *   重复提及/合并相似/手动「回忆一下」都会刷新淡化计时。
 * - 【去重合并】同一事实的不同说法（相似度 ≥0.6）自动合并为一条：重复提取=加强而非重复占位；
 *   设置页可手动「整理重复记忆」一次性清理；召回时跨层去重（长期→核心→碎片顺序，后层与已选
 *   内容相似则跳过）。
 * - 【权重优先级】姓名/关系/承诺/健康禁忌 → 高权重（自动分类 + 手动可调）；召回按权重×相关性排序。
 * - 【时间感知】记忆与当前时间联动：碎片可带 eventTime（事件发生时间）/ expiresAt（过期时间，
 *   空=永不过期）；提取时由模型按当前时间锚点判断（服务端校验 ±5 年防幻觉）；注入时头部带当前
 *   时间、层内按有效时间从新到旧、每条带时间标签，并提示优先参考更近的记忆；过期碎片自动归档
 *   （expiredAt）不再召回；新旧矛盾时模型标注 supersedes，旧记忆标记「已更新」不再召回。
 *   核心/长期默认永不过期，可被用户手动设置过期；用户手动编辑过的时间（timeEditedAt）以用户
 *   设置为准，自动流程（提取合并/去重/总结）一律不得覆盖。
 * - 【来源追溯】每条碎片记录来源 App / 来源时间 / 来源消息 ID，回答「你怎么知道的」。
 * - 提取/总结调用 /api/memory/extract 与 /api/memory/summarize（用户 API 配置优先，
 *   服务端 SDK 兜底）；自动提取失败静默（下一窗口重试），手动「立即总结」失败给提示；
 *   手动入口共四个且互斥：碎片页右上角（仅提取碎片）、核心页右上角（碎片→核心）、
 *   长期页右上角（核心→长期）、设置页（按所选粒度执行）。
 * - 删除联系人时由 contacts-store.deleteContact 调 memPurgeContact 级联清理全部记忆。
 */

import type { ApiConfig } from '@/lib/ios/store';
import { kvGet, kvSet, kvDel, kvDelByPrefix, kvDelRaw } from '@/lib/ios/idb-kv';
import { accLs, getAccountById, getAccounts, getActiveAccountIdFor, MAIN_ACCOUNT_ID, type AccountApp } from '@/lib/ios/accounts';
import { getGroup, listGroups, loadGroupMsgs, onGroupDissolved, type WxGroupMsg } from '@/lib/ios/groups';
import {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_INTERVAL_OPTIONS,
  MEM_LONG_OPTIONS,
  MEM_PROFILE_CATEGORIES,
  MEM_PROFILE_CATEGORY_LABEL,
  MEM_STALE_PAT,
  MEM_THRESHOLD_OPTIONS,
  MEM_TIME_RANGE_YEARS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  isMemExpired,
  memEffectiveTime,
  memNowLabel,
  memTimeLabel,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type MemApp,
  type MemConvoTurn,
  type MemCore,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemNames,
  type MemProfileCategory,
  type MemProfileFact,
  type MemSettings,
  type MemWeight,
} from './memory-core';

export {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_FORGET_DAYS,
  MEM_FORGET_LABEL,
  MEM_FORGET_OPTIONS,
  MEM_INTERVAL_OPTIONS,
  MEM_LONG_OPTIONS,
  MEM_PROFILE_CATEGORIES,
  MEM_PROFILE_CATEGORY_LABEL,
  MEM_THRESHOLD_OPTIONS,
  MEM_TIME_RANGE_YEARS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  isMemExpired,
  memEffectiveTime,
  memNowLabel,
  memTimeLabel,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type FadeState,
  type MemApp,
  type MemConvoTurn,
  type MemCore,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemNames,
  type MemProfileCategory,
  type MemProfileFact,
  type MemSettings,
  type MemWeight,
} from './memory-core';

// ---------------- 持久化基础（IndexedDB kv store，启动时由 idb-kv 从 localStorage 迁移） ----------------

// ---------------- 记忆账号作用域（Task 40 v2：多账号记忆隔离） ----------------

/**
 * 多账号：记忆键按「聊天所在 App 的当前账号」追加 `--{id}` 后缀——
 * 同一账号在微信/QQ/信息/电话共享记忆（后缀相同），不同账号天然隔离（小号对 AI
 * 是陌生人的记忆基础；大号/小号记忆互不泄漏）。作用域由含 app 参数的公开 API
 * 入口（memRecallBlock / memAfterAiTurn / memSummarizeCallNow / memSummarizeNow /
 * memAddMomentFragment / memAddEventFragment）设置；管理视图/手动整理等无 app
 * 上下文的操作沿用最近一次作用域（单 App 会话内正确）。
 * 设置键 mem-settings 与计数/锚点前缀清扫（kvDelByPrefix）不作用域化：
 * 前者跨账号共享配置，后者天然覆盖全部账号后缀键。
 */
let memScopeSuffix = '';
/** 当前记忆作用域账号的显示名（记忆块头部身份标注用；大号=「机主」，规则四：记忆注入带账号身份） */
let memScopeName = '机主';

export function setMemScopeForApp(app: AccountApp): void {
  try {
    const id = getActiveAccountIdFor(app);
    memScopeSuffix = id === MAIN_ACCOUNT_ID ? '' : `--${id}`;
    memScopeName = id === MAIN_ACCOUNT_ID ? '机主' : getAccountById(id)?.name || '当前账号';
  } catch {
    memScopeSuffix = '';
    memScopeName = '机主';
  }
}

/** 记忆库管理视图（无聊天 App 上下文）统一用信息 App 当前账号视角 */
export function setMemScopeDefaultView(): void {
  setMemScopeForApp('sms');
}

/** 当前记忆作用域账号显示名（同步；setMemScopeForApp 已调用后有效） */
export function memScopeAccountName(): string {
  return memScopeName;
}

function scoped(base: string): string {
  return memScopeSuffix ? `${base}${memScopeSuffix}` : base;
}

const fragKey = (contactId: string) => scoped(`mem-frag:${contactId}`);

/** B8：人设【最近发生的事】（npc-bond bondNotesFor）本轮选用的碎片 id 注册表——
 *  记忆召回时排除这些碎片，同一碎片不再出现在记忆块里（跨块去重；每轮 persona 组装时重填） */
const bondExcludeIds = new Set<string>();

/** npc-bond bondNotesFor 每轮调用：重填本轮已注入人设的碎片 id（记忆召回侧排除用） */
export function noteBondFragmentIds(ids: readonly string[]): void {
  bondExcludeIds.clear();
  for (const id of ids) bondExcludeIds.add(id);
}

/** B8：记忆召回块总字符预算（超出按 碎片→核心→长期 顺序裁剪） */
const MEM_RECALL_BUDGET = 6000;
/** 核心记忆存储键（沿用历史 ltm 键名，语义为核心层，避免旧数据迁移） */
const coreKey = (contactId: string) => scoped(`mem-ltm:${contactId}`);
const longKey = (contactId: string) => scoped(`mem-long:${contactId}`);
/** 画像图谱存储键（Task 14-b B1：用户画像事实层，与三层记忆同层持久化） */
const profileKey = (contactId: string) => scoped(`mem-profile:${contactId}`);
// C10：设置随账号作用域化（此前跨账号共享——小号侧改提取频率/互通开关会覆盖大号配置；
// 主账号 main 无后缀 = 存量键不变，小号首次读取走新键回落默认值）
const settingsKey = (contactId: string) => scoped(`mem-settings:${contactId}`);
/** 旧轮次计数键（口径=AI 回复轮数，已废弃）：仅 memPurgeContact 残留清扫用 */
const roundKey = (contactId: string, app: MemApp) => scoped(`mem-round:${contactId}:${app}`);
/** 消息条数计数键：scope 非空（群聊）按群独立；私聊互通开 = 按角色合并（无 app 段）、互通关 = 各 App 独立 */
const countKey = (contactId: string, app: MemApp, scope: string, share: boolean) =>
  scoped(
    scope
      ? `mem-msgcount:${contactId}:${app}${scope}`
      : share
        ? `mem-msgcount:${contactId}`
        : `mem-msgcount:${contactId}:${app}`,
  );
/** 增量计数锚点键（已计数的最后一条消息 ID）：始终按会话（app+scope），各 App 消息流独立数增量 */
const anchorKey = (contactId: string, app: MemApp, scope: string) => scoped(`mem-anchor:${contactId}:${app}${scope}`);

function readJSON<T>(key: string): T | null {
  try {
    return kvGet<T>(key);
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    // 内存同步 + 异步写穿 IndexedDB；存储失败不中断聊天（记忆是增强能力）
    kvSet(key, value);
  } catch {
    // 忽略
  }
}

/** 群聊互通开关默认解析：从群数据层读该群的 memoryInterop（群不存在 = 不互通，保守隔离）。
 *  groups.ts 只依赖 idb-kv/genId，无循环依赖 */
function defaultGroupInteropOn(groupId: string): boolean {
  try {
    return getGroup(groupId)?.memoryInterop === true;
  } catch {
    return false;
  }
}

/** 群名默认解析（召回标注「群聊·群名」用；群已解散时回退 null） */
function defaultGroupLabel(groupId: string): string | null {
  try {
    return getGroup(groupId)?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * 群来源记忆的成员可见性：被移出群聊（不在群成员表）后不能再读取该群的记忆（需求一.4）。
 * 群不存在（已解散）同样不可见；只在私聊召回侧使用（群聊页召回本身要求在群内）。
 */
function defaultGroupMemberVisible(groupId: string, contactId: string): boolean {
  if (!groupId) return false;
  try {
    return getGroup(groupId)?.memberIds.includes(contactId) ?? false;
  } catch {
    return false;
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 名字归一化：提取/总结请求统一携带，缺省回退固定称呼（同一联系人恒定，保证视角一致） */
function namesOf(names?: MemNames | null): { userName: string; peerName: string } {
  return {
    userName: (names?.user ?? '').trim().slice(0, 20) || '用户',
    peerName: (names?.peer ?? '').trim().slice(0, 20) || '对方',
  };
}

// ---------------- 设置 ----------------

export function getMemSettings(contactId: string): MemSettings {
  const raw = readJSON<Partial<MemSettings>>(settingsKey(contactId));
  if (!raw) return { ...DEFAULT_MEM_SETTINGS };
  return {
    interval: MEM_INTERVAL_OPTIONS.includes(raw.interval as MemSettings['interval'])
      ? (raw.interval as MemSettings['interval'])
      : DEFAULT_MEM_SETTINGS.interval,
    threshold: MEM_THRESHOLD_OPTIONS.includes(raw.threshold as MemSettings['threshold'])
      ? (raw.threshold as MemSettings['threshold'])
      : DEFAULT_MEM_SETTINGS.threshold,
    longThreshold: MEM_LONG_OPTIONS.includes(raw.longThreshold as MemSettings['longThreshold'])
      ? (raw.longThreshold as MemSettings['longThreshold'])
      : DEFAULT_MEM_SETTINGS.longThreshold,
    share: raw.share !== false,
    forget: raw.forget === 'fast' || raw.forget === 'medium' || raw.forget === 'slow' || raw.forget === 'never'
      ? raw.forget
      : DEFAULT_MEM_SETTINGS.forget,
  };
}

export function saveMemSettings(contactId: string, patch: Partial<MemSettings>): MemSettings {
  const prev = getMemSettings(contactId);
  const next = { ...prev, ...patch };
  writeJSON(settingsKey(contactId), next);
  // 互通口径切换：计数清零重新累计（合并计数的数字对独立计数无意义，反之亦然；
  // 锚点保留——已计过的消息不重复计，切换后只数新消息）
  if (patch.share !== undefined && patch.share !== prev.share) {
    try {
      kvDelByPrefix(`mem-msgcount:${contactId}`);
    } catch {
      // 忽略
    }
  }
  return next;
}

// ---------------- 读取（联系人维度） ----------------

function readFragments(contactId: string): MemFragment[] {
  const raw = readJSON<MemFragment[]>(fragKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f) => f && typeof f.id === 'string' && typeof f.content === 'string' && typeof f.app === 'string'
  );
}

function readCores(contactId: string): MemCore[] {
  const raw = readJSON<MemCore[]>(coreKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
}

function readLongTerm(contactId: string): MemLongTerm[] {
  const raw = readJSON<MemLongTerm[]>(longKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
}

/** 该联系人的全部记忆碎片（管理视图用：跨 App 汇总，按创建时间倒序） */
export function listFragments(contactId: string): MemFragment[] {
  return readFragments(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 该联系人的全部核心记忆（管理视图用，含已入长期的归档项） */
export function listCores(contactId: string): MemCore[] {
  return readCores(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 该联系人的全部长期记忆（管理视图用） */
export function listLongTerm(contactId: string): MemLongTerm[] {
  return readLongTerm(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 未被核心总结消费、且未被更新/过期/归档的碎片数（设置页展示/总结触发判断用） */
export function pendingFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter(
    (f) =>
      !f.consumedAt &&
      !f.supersededAt &&
      !isMemExpired(f, now) &&
      fadeState(f as FadeInput, forget, now) !== 'faded'
  ).length;
}

/** 已归档（淡化到期，完全失效）的碎片数（数据说明展示用） */
export function archivedFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter(
    (f) => !f.supersededAt && !isMemExpired(f, now) && fadeState(f as FadeInput, forget, now) === 'faded'
  ).length;
}

/** 已过期（时间感知到期自动归档）的碎片数（数据说明展示用） */
export function expiredFragmentCount(contactId: string): number {
  const now = Date.now();
  return readFragments(contactId).filter((f) => !f.supersededAt && isMemExpired(f, now)).length;
}

/** 已更新（被矛盾新记忆替代，不再召回）的碎片数（数据说明展示用） */
export function supersededFragmentCount(contactId: string): number {
  return readFragments(contactId).filter((f) => f.supersededAt != null).length;
}

/**
 * 时间感知过期清扫：把 expiresAt 已到期的碎片标记 expiredAt（自动归档）。
 * 惰性执行：召回（memRecallBlock）、一轮对话结束（memAfterAiTurn）、记忆库刷新时调用；
 * 召回/总结的过滤都按 isMemExpired 实时判断，本清扫只负责落库标记与 UI 展示。
 * 返回本次标记的条数。
 */
export function memSweepExpiry(contactId: string): number {
  const now = Date.now();
  const list = readFragments(contactId);
  let changed = 0;
  const next = list.map((f) => {
    if (f.expiresAt != null && now > f.expiresAt && !f.expiredAt && !f.supersededAt) {
      changed++;
      return { ...f, expiredAt: now };
    }
    return f;
  });
  if (changed > 0) writeJSON(fragKey(contactId), next);
  return changed;
}

/**
 * 矛盾更新对比用：待总结（未消费/未更新/未过期/未淡化）碎片的 id+内容（最近 30 条）
 * + 核心/长期记忆（core:/long: 前缀 id，最近 10 条）——新信息可以更正已总结的旧画像，
 * 否则「喜欢猫」入长期后，「对猫过敏」的新碎片无法更正它，新旧两层同屏矛盾。
 */
function existingForConflict(contactId: string): { id: string; content: string }[] {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const frags = readFragments(contactId)
    .filter(
      (f) =>
        !f.consumedAt &&
        !f.supersededAt &&
        !isMemExpired(f, now) &&
        fadeState(f as FadeInput, forget, now) !== 'faded'
    )
    .slice(-30)
    .map((f) => ({ id: f.id, content: f.content }));
  const cores = readCores(contactId)
    .filter((m) => !m.archivedAt && !m.supersededAt && !isMemExpired(m, now))
    .slice(-10)
    .map((m) => ({ id: `core:${m.id}`, content: m.content }));
  const longs = readLongTerm(contactId)
    .filter((m) => !m.supersededAt && !isMemExpired(m, now))
    .slice(-10)
    .map((m) => ({ id: `long:${m.id}`, content: m.content }));
  return [...frags, ...cores, ...longs];
}

/** 未被长期记忆收编且未过期的核心记忆数（长期总结触发判断用；手动设过期的核心不再参与总结） */
export function pendingCoreCount(contactId: string): number {
  const now = Date.now();
  return readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now)).length;
}

// ---------------- 编辑/删除/回忆（查看=列表，编辑=改内容与权重，删除=单条移除） ----------------

/**
 * 手动时间编辑入参（时间感知：用户在记忆库手动修改事件/过期时间）：
 * - eventTime/expiresAt 传 null 表示清除（事件时间清空 / 恢复永不过期），传时间戳表示设置；
 * - undefined 表示不改动该字段。
 */
export interface MemTimePatch {
  eventTime?: number | null;
  expiresAt?: number | null;
}

/**
 * 三层通用：应用手动时间补丁。被手动编辑过的记忆会带上 timeEditedAt 标记，
 * 此后自动流程（提取合并/去重/总结）一律以用户设置为准，不得改写其 eventTime/expiresAt。
 */
function applyTimePatch<
  T extends { eventTime?: number; expiresAt?: number; expiredAt?: number; timeEditedAt?: number; editedAt?: number }
>(rec: T, patch: MemTimePatch, now: number): T {
  const next = { ...rec };
  if (patch.eventTime !== undefined) {
    if (patch.eventTime == null) delete next.eventTime;
    else if (Number.isFinite(patch.eventTime)) next.eventTime = patch.eventTime;
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt == null) delete next.expiresAt;
    else if (Number.isFinite(patch.expiresAt)) next.expiresAt = patch.expiresAt;
  }
  next.timeEditedAt = now;
  next.editedAt = now;
  // 手动把过期时间改到未来或清除 → 救回已过期归档的碎片（用户意图明确：重新有效）
  if (next.expiresAt == null || next.expiresAt > now) delete next.expiredAt;
  return next;
}

/** 手动修改碎片的事件/过期时间（设置 timeEditedAt，自动流程不再覆盖） */
export function updateFragmentTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readFragments(contactId);
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(fragKey(contactId), list);
  return true;
}

/** 手动修改核心记忆的事件/过期时间（默认永不过期，设置后同样受保护） */
export function updateCoreTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readCores(contactId);
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(coreKey(contactId), list);
  return true;
}

/** 手动修改长期记忆的事件/过期时间（默认永不过期，设置后同样受保护） */
export function updateLongTermTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readLongTerm(contactId);
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(longKey(contactId), list);
  return true;
}

export function updateFragment(contactId: string, id: string, content: string, weight?: MemWeight): boolean {
  const list = readFragments(contactId);
  const hit = list.find((f) => f.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  if (weight === 'high' || weight === 'normal' || weight === 'low') hit.weight = weight;
  // 用户显式编辑保存 = 意图明确的「救回」。先记下更新者（supersededBy 指向的新记忆）再清标记：
  // 1) 清被更新标记（supersededAt/supersededBy）让碎片重新参与召回/总结（否则编辑过内容也永不召回，#40）；
  // 2) 清已入核心标记（consumedAt，#15）：已入核心的碎片此前编辑保存仍报「碎片已更新」，但召回
  //    （memRecallBlock）与待总结统计/自动总结（pendingFragmentCount/summarizePendingIntoCore）均按
  //    consumedAt 排除，编辑实际不生效——编辑救回后重新参与召回/总结；核心记忆里的旧总结滞后可接受。
  const successorId = hit.supersededBy;
  delete hit.supersededAt;
  delete hit.supersededBy;
  delete hit.consumedAt;
  // 【#43】救回矛盾链只留一条活跃：A 原被 B 更新（supersededBy=B）→ A 救回后若 B 仍活跃，A/B 会
  // 同时参与召回/总结形成矛盾对 → 反向压制 B（标记 B 被 A 更新），保证矛盾链同一时刻只有一条活跃。
  // 妥协点（只处理一层）：若 B 自身已被 C 更新（B.supersededAt 已置、supersededBy=C），B 本就不参与
  // 召回，保持其指向 C 的既有溯源不动；此时救回的 A 与 C 理论上可并存（链深 ≥2 罕见），由召回块
  // 头部「同一事实新旧矛盾时以时间更近的为准」的注入提示兜底，不递归清理更深层。
  const successor = successorId ? list.find((f) => f.id === successorId && f.id !== id) : undefined;
  if (successor && successor.supersededAt == null) {
    successor.supersededAt = Date.now();
    successor.supersededBy = id;
  }
  writeJSON(fragKey(contactId), list);
  return true;
}

/** 「回忆一下」：手动救回淡化/归档的记忆（重置淡化计时，标记一次加强） */
export function reinforceFragment(contactId: string, id: string): boolean {
  const list = readFragments(contactId);
  const hit = list.find((f) => f.id === id);
  if (!hit) return false;
  hit.reinforcedAt = Date.now();
  hit.reinforceCount = (hit.reinforceCount ?? 0) + 1;
  writeJSON(fragKey(contactId), list);
  return true;
}

export function deleteFragment(contactId: string, id: string): boolean {
  const list = readFragments(contactId);
  const next = list.filter((f) => f.id !== id);
  if (next.length === list.length) return false;
  writeJSON(fragKey(contactId), next);
  return true;
}

export function updateCore(contactId: string, id: string, content: string): boolean {
  const list = readCores(contactId);
  const hit = list.find((m) => m.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(coreKey(contactId), list);
  return true;
}

export function deleteCore(contactId: string, id: string): boolean {
  const list = readCores(contactId);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeJSON(coreKey(contactId), next);
  return true;
}

export function updateLongTerm(contactId: string, id: string, content: string): boolean {
  const list = readLongTerm(contactId);
  const hit = list.find((m) => m.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(longKey(contactId), list);
  return true;
}

export function deleteLongTerm(contactId: string, id: string): boolean {
  const list = readLongTerm(contactId);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeJSON(longKey(contactId), next);
  return true;
}

/** 删除联系人时级联清理其全部记忆（碎片/核心/长期/设置/消息计数/锚点/旧轮次键）；跨全部账号（多账号 v2） */
export function memPurgeContact(contactId: string): void {
  try {
    // 记忆本体键按账号作用域 → 遍历全部账号精确删；设置键共享（无作用域）单删
    const accountIds = [MAIN_ACCOUNT_ID, ...getAccounts().filter((a) => a && a.kind !== 'main').map((a) => a.id)];
    for (const accId of accountIds) {
      const sfx = accId === MAIN_ACCOUNT_ID ? '' : `--${accId}`;
      for (const base of [`mem-frag:${contactId}`, `mem-ltm:${contactId}`, `mem-long:${contactId}`, `mem-profile:${contactId}`]) {
        const k = `${base}${sfx}`;
        kvDelRaw(k);
        window.localStorage.removeItem(base); // 旧裸键兼容清扫
      }
      for (const app of ['wx', 'qq', 'sms', 'phone'] as MemApp[]) {
        const k = `mem-round:${contactId}:${app}${sfx}`;
        kvDelRaw(k);
        window.localStorage.removeItem(k);
      }
    }
    kvDel(settingsKey(contactId));
    window.localStorage.removeItem(settingsKey(contactId));
    // 大号侧「账号关联」记忆（mem-acc-link:{cid}，设备级共享键无账号作用域）：删联系人一并清
    kvDel(accLinkKey(contactId));
    window.localStorage.removeItem(accLinkKey(contactId));
    // 新计数/锚点键按前缀批量清（覆盖合并键 + 各 App 独立键 + 群 scope 键 + 各账号后缀键）
    kvDelByPrefix(`mem-msgcount:${contactId}`);
    kvDelByPrefix(`mem-anchor:${contactId}`);
  } catch {
    // 忽略
  }
}

/**
 * 删除会话时重置该联系人的记忆提取计数状态（fix2-b/fix2-c 契约函数；对照 memPurgeContact 的锚点清理段）：
 * - 清消息计数（合并键 + 各 App 独立键 + 群 scope 键）与增量计数锚点（按前缀批量清）；
 * - 清四个 App 的废弃旧轮次键（IndexedDB kv + localStorage 双层残留清扫）；
 * - 严禁动碎片/核心/长期记忆与设置本身（删除会话 ≠ 删除记忆，与 memPurgeContact 全量清不同）。
 */
export async function memResetConvoCounters(contactId: string): Promise<void> {
  try {
    // 新计数/锚点键按前缀批量清（覆盖合并键 + 各 App 独立键 + 群 scope 键 + 各账号后缀键）
    kvDelByPrefix(`mem-msgcount:${contactId}`);
    kvDelByPrefix(`mem-anchor:${contactId}`);
    // 旧轮次计数键残留清扫（跨全部账号；IndexedDB kv 内存+库同步删 + localStorage 防历史残留复活）
    const accountIds = [MAIN_ACCOUNT_ID, ...getAccounts().filter((a) => a && a.kind !== 'main').map((a) => a.id)];
    for (const accId of accountIds) {
      const sfx = accId === MAIN_ACCOUNT_ID ? '' : `--${accId}`;
      for (const app of ['wx', 'qq', 'sms', 'phone'] as MemApp[]) {
        const k = `mem-round:${contactId}:${app}${sfx}`;
        kvDelRaw(k);
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    // 忽略
  }
}

/** 解散群聊 → 级联清理群来源记忆（钩子由 groups 层触发；依赖方向 memory → groups 单向，不反向 import） */
onGroupDissolved((g) => memPurgeGroupSource(g.id, g.memberIds));

/**
 * 解散群聊时清理「群来源记忆」（onGroupDissolved 钩子调用；群删除时记忆一起清理的规则）：
 * - 碎片：删除 source==='group' 且 sourceGroupId===groupId 的条目（无论是否已被总结消费/归档）；
 * - 核心/长期：内容不删（可能含私聊来源的事实），只从 groupIds 里剔除该群；
 *   剔除后不再有任何群来源时 privateSource 还原为 true（纯私聊语义，与旧数据兼容路径一致）。
 * 成员维度只遍历群成员（只有成员参与过群聊，其他联系人不可能有该群来源的记忆）。
 */
export function memPurgeGroupSource(groupId: string, memberIds: string[]): void {
  if (!groupId) return;
  const ids = Array.from(new Set(memberIds.filter(Boolean)));
  for (const contactId of ids) {
    try {
      // 碎片层：过滤掉本群来源的条目
      const frags = readFragments(contactId);
      const nextFrags = frags.filter((f) => !(f.source === 'group' && f.sourceGroupId === groupId));
      if (nextFrags.length !== frags.length) writeJSON(fragKey(contactId), nextFrags);
      // 核心层：剔除本群来源标记（内容保留）
      const cores = readCores(contactId);
      let coresChanged = false;
      const nextCores = cores.map((m) => {
        const gids = m.groupIds ?? [];
        if (!gids.includes(groupId)) return m;
        coresChanged = true;
        const rest = gids.filter((x) => x !== groupId);
        return { ...m, groupIds: rest.length > 0 ? rest : undefined, privateSource: rest.length > 0 ? m.privateSource : true };
      });
      if (coresChanged) writeJSON(coreKey(contactId), nextCores);
      // 长期层：同核心层
      const longs = readLongTerm(contactId);
      let longsChanged = false;
      const nextLongs = longs.map((m) => {
        const gids = m.groupIds ?? [];
        if (!gids.includes(groupId)) return m;
        longsChanged = true;
        const rest = gids.filter((x) => x !== groupId);
        return { ...m, groupIds: rest.length > 0 ? rest : undefined, privateSource: rest.length > 0 ? m.privateSource : true };
      });
      if (longsChanged) writeJSON(longKey(contactId), nextLongs);
    } catch {
      // 单个成员清理失败不影响其他成员
    }
  }
}

// ---------------- 召回（AI 带着记忆聊天） ----------------

/**
 * 【fix3-a 8】内容是否带角色归属标注（「（AI角色本人）/（用户本人）」）：
 * 召回兜底判定 + 总结落库 hasRoleTag 聚合 + 碎片写入标记共用（字符串检测是旧数据兜底）。
 */
function memHasRoleTag(s: string): boolean {
  return s.includes('（AI角色本人）') || s.includes('（用户本人）');
}

/** 相关性打分：内容与当前上下文的重叠 + 新近加成（长期/核心/碎片各自组内排序用） */
function relevanceScore(content: string, createdAt: number, context: string): number {
  const ctx = contextGramsCache.get(context) ?? bigrams(context);
  contextGramsCache.set(context, ctx);
  if (contextGramsCache.size > 8) contextGramsCache.delete(contextGramsCache.keys().next().value as string);
  let score = overlap(bigrams(content), ctx) * 2;
  const age = Date.now() - createdAt;
  if (age < 86400_000) score += 3;
  else if (age < 7 * 86400_000) score += 2;
  else if (age < 30 * 86400_000) score += 1;
  return score;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((g) => {
    if (b.has(g)) n++;
  });
  return n;
}

/** 上下文文本的 gram 缓存（同一次召回内复用） */
const contextGramsCache = new Map<string, Set<string>>();

/** 碎片召回得分：相关性 × 权重系数（高权重优先）× 淡化系数（淡化中 0.4；已归档直接不参与） */
function fragRecallScore(f: MemFragment, forget: MemForget, context: string, now: number): { s: number; st: ReturnType<typeof fadeState> } {
  const st = fadeState(f as FadeInput, forget, now);
  const s =
    relevanceScore(f.content, f.reinforcedAt ?? f.sourceTime, context) *
    weightFactor(f.weight) *
    (st === 'fading' ? 0.4 : 1);
  return { s, st };
}

/**
 * 召回该联系人（互通开关限定范围）的记忆，组装为注入 system 的文本块。
 * 注入顺序（层级从高到低）：长期记忆 → 核心记忆 → 近期碎片；跨层去重：与已选内容相似（≥0.6）
 * 的低层记忆不再重复注入（长期已收编的由长期代表、核心已收编碎片的由核心代表）。
 * 容量上限：长期 8 条、核心 12 条、碎片 5 条（各按 权重×相关性×淡化 降序截断）；
 * 已入长期（archivedAt）的核心、已入核心（consumedAt）与已归档的碎片不再召回。
 * 该联系人没有记忆 / 互通关闭且当前 App 无来源记忆 → 返回空串（正常聊天，不报错）。
 *
 * 群聊互通（opts）：
 * - mode 'private'（缺省）：跨 App 互通开关照旧；另读群聊来源记忆——碎片/总结按来源群
 *   memoryInterop 判断（互斥于跨 App share 开关，两层开关都开才可见）；
 * - mode 'group'（groupId 必传）：只读当前群来源记忆 + （该群互通开启时）自己的非群聊记忆；
 *   其他群的记忆永不参与（群间隔离），角色隔离由存储键天然保证。
 */
export interface MemRecallOpts {
  mode?: 'private' | 'group';
  /** mode='group' 时必传：当前群聊 ID */
  groupId?: string;
  /** 群互通开关解析（缺省读群数据层的 memoryInterop） */
  interopOn?: (groupId: string) => boolean;
  /** 群名解析（来源标注「群聊·群名」用；缺省读群数据层） */
  groupLabel?: (groupId: string) => string | null;
  /**
   * 小号「机主身份披露」检测文本（仅用户侧发言：当前消息 + 近期用户消息/验证留言）。
   * 用户规则：小号 AI 默认纯陌生人（大号记忆零注入）；只有用户主动亮明身份
   * （说「我是机主」「这是我大号」或报出机主名字等）才解锁大号记忆注入。
   * 解锁通道一：文本命中披露词（含否定句守卫：「我不是机主」不算）；
   * 解锁通道二（规则三→四闭环）：AI 近几轮刚用机主名做过猜测（「你是不是XX？」），
   * 用户本轮整条消息是短确认（「对」「被你猜到了」）——也算亲口承认。
   * 缺省/空 = 不检测 = 保持纯陌生人。
   */
  disclosureText?: string;
  /** 机主（大号身份）显示名（宿主用 cachedOwnerName 现场传入）：披露措辞与名字关键词用 */
  altMainName?: string;
  /**
   * 机主（大号）与该角色的关系标签（宿主传 peer.relation）：小号披露解锁后的「认出」
   * 包装段用——认出后 AI 才知道与 TA 的真实关系（未披露时零读取，规则二.2）。
   * 缺省/空 = 包装段不带关系行（零破坏）。
   */
  altMainRelation?: string;
  /** 【X论坛帖子记忆·金鱼模式】排除指定 source 的碎片不参与召回（如 ['forum']）——
   *  关闭帖子记忆时论坛互动碎片零提起（写侧也停了，此处挡历史存量）。
   *  仅作用于近期碎片层（source 精确到条）；长期/核心总结层不受影响（本就不含论坛明细）。 */
  excludeFragmentSources?: string[];
}

export function memRecallBlock(contactId: string, app: MemApp, contextText: string, opts?: MemRecallOpts): string {
  setMemScopeForApp(app); // 多账号：按当前聊天 App 的账号取记忆（小号视角=空记忆=陌生人）
  // 顶层容错（与 collectWbBlocks 同款约定）：记忆注入任何意外异常都不阻断消息发送，
  // 返回空块 = 无记忆正常聊天（群聊/私聊同此规则）
  try {
    return memRecallBlockInner(contactId, app, contextText, opts);
  } catch {
    return '';
  }
}

// ---------------- 小号「机主身份披露」门控（用户最新规则：默认纯陌生人） ----------------

/**
 * 用户规则（最终口径）：小号场景 AI 完全读不到大号记忆，除非用户主动告诉 AI 自己是谁。
 * - 默认（未亮明身份）：小号/匿名号侧零注入大号记忆（memMainRecallBlockForAlt 返回空串），
 *   AI 是纯陌生人——最多知道人设里「用户还有个别的身份」这层关系，不知道任何共同经历；
 * - 用户在对话/验证消息里主动亮明（说「我是机主」「这是我大号」或报出机主名字等）
 *   → AI「认出」TA：之后该（账号 × 联系人）粘性注入大号记忆块，可自然提起共同经历。
 * 披露标记存 localStorage（召回链路是同步的，IndexedDB kv 异步不可用）；
 * 键经 accLs 账号作用域（删除账号的 `--{id}` 兜底清扫覆盖），删联系人由 purgeChatTracesFor 清扫。
 */

function lsGetRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function lsSetRaw(key: string, v: string): void {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    // 存储异常静默：门控退化为「每次都按陌生人」
  }
}

/** 披露标记键（账号作用域）：`mem-alt-disc:{app}:{cid}`（小号自动带 `--{accId}` 后缀） */
function altDisclosedLsKey(app: MemApp, contactId: string): string {
  try {
    return accLs(`mem-alt-disc:${app}:${contactId}`, app);
  } catch {
    return `mem-alt-disc:${app}:${contactId}`;
  }
}

/**
 * 否定守卫：关键词/名字命中处的前 2 个字符含否定或疑问前缀 → 不算亮明身份。
 *（「我不是机主」「这不是大号」「难道我是陈凡」都不算；「我是机主」「我大号」算）
 */
function altNegatedAt(t: string, idx: number): boolean {
  const head = t.slice(Math.max(0, idx - 2), idx);
  return /[不没别非无]|难道|是不是|何曾|岂/.test(head);
}

/** 名字句式命中位置扫描：任一出现的「我是X/我就是X/X是我」且非否定/疑问尾 → 命中 */
function altNameClaimAt(t: string, nm: string): boolean {
  for (const pat of [`我是${nm}`, `我就是${nm}`, `${nm}是我`, `${nm}本人`]) {
    let from = 0;
    for (;;) {
      const i = t.indexOf(pat, from);
      if (i === -1) break;
      // 「我是陈凡吗？」= 疑问不是承认；否定前缀（不/没/难道…）同样排除
      const tail = t.slice(i + pat.length, i + pat.length + 2);
      if (!/^(吗|么|嘛)/.test(tail) && !altNegatedAt(t, i)) return true;
      from = i + 1;
    }
  }
  return false;
}

/**
 * 披露信号句式表（收紧版）：裸出现「机主/大号/小号」不再解锁大号记忆——
 * 必须落在第一人称声明/所有格句式里（「我是机主」「我的小号」「小号是我」等）。
 * 「别人都用小号」「大号好累啊」这类旁观/感叹句不会误解锁（与主号侧第一人称正则口径对齐）。
 */
const ALT_DISCLOSE_PATTERNS: readonly string[] = [
  // 机主身份声明
  '我是机主',
  '我就是机主',
  '机主是我',
  '机主就是我',
  // 大号所有格 / 声明
  '我的大号',
  '我大号',
  '是我大号',
  '大号是我',
  '大号就是我',
  '这是我大号',
  '这是我的大号',
  '大号是我本人',
  '我就是大号',
  // 小号所有格 / 声明
  '我的小号',
  '我小号',
  '是我小号',
  '小号是我',
  '小号就是我',
  '这是我小号',
  '这是我的小号',
  '小号是我本人',
  '我就是小号',
];

function altDiscloseHit(text: string, mainName: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  for (const pat of ALT_DISCLOSE_PATTERNS) {
    let from = 0;
    for (;;) {
      const i = t.indexOf(pat, from);
      if (i === -1) break;
      if (!altNegatedAt(t, i)) return true;
      from = i + 1;
    }
  }
  const nm = mainName.trim();
  if (nm && nm !== '机主' && altNameClaimAt(t, nm)) return true;
  return false;
}

/**
 * 用户短确认（规则三→四闭环）：AI 刚用机主名猜过（「你是不是陈凡？」），
 * 用户回一句很短的肯定（「对」「是我」「没错」「哈哈被你猜到了」）= 亲口承认。
 * 整条消息 ≤12 字且整句匹配肯定句式——普通闲聊里的「对啊怎么了」不会整句命中。
 */
const ALT_AFFIRM_RE =
  /^(?:哈哈+|嘻嘻|嘿嘿|嘿|哎呀|额|em+|类)*(?:对的?|是呀?|是啊|是滴|是我[呀啊啦]?|就是我[呀啊啦]?|没错|没错就是我|被你猜到了?|被你发现了?|被你识破了?|猜对了?|猜对啦|猜中了?|答对了?|对头|对哒|嗯呢|嗯啊|bingo|yes|yeah)[啦哟哦呗哈呀啊嘛滴了恩~～!！。.？?]*$/i;

function altShortAffirmHit(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 12) return false;
  return ALT_AFFIRM_RE.test(t);
}

/**
 * AI 近几轮是否刚用机主名做过身份猜测（扫当前账号会话里 AI 侧发言，只读不写）：
 * 命中条件 = 提到机主名 + 猜测语气（「猜/是不是/认出/难道」）。
 * 给「AI 猜测 → 用户短确认」解锁链路用；读不到会话按没猜过（保守，不解锁）。
 */
function altAiNameGuessRecent(app: MemApp, contactId: string, mainName: string): boolean {
  const nm = mainName.trim();
  if (!nm || nm === '机主') return false;
  try {
    const turns = memRecentConvo(contactId, app)
      .filter((t) => t.role === 'peer')
      .slice(-4);
    return turns.some((t) => t.text.includes(nm) && /猜|是不是|认出|难道/.test(t.text));
  } catch {
    return false;
  }
}

/**
 * 扫描披露文本：命中→落粘性标记并返回 true；已标记过直接 true；否则 false（保持纯陌生人）。
 * 两条解锁通道：
 * ① 直接亮明：披露词命中（含否定守卫）；
 * ② 猜后确认（规则三→四闭环）：当前消息（首段；短线程下任一段）是短肯定句
 *    + AI 近几轮刚用机主名猜过——用户对「你是不是陈凡？」回「对」也算亲口承认。
 */
function altDiscloseScan(app: MemApp, contactId: string, disclosureText: string | undefined, mainName: string): boolean {
  const key = altDisclosedLsKey(app, contactId);
  if (lsGetRaw(key) === '1') return true;
  if (!disclosureText || !disclosureText.trim()) return false;
  const t = disclosureText.trim();
  let hit = altDiscloseHit(t, mainName);
  if (!hit) {
    // 肯定段判定：首段=当前消息（聊天调用方把当前消息放最前）；整段 ≤20 字时退化为任一段
    //（好友验证线程调用方按时间正序拼接，短线程下最后一条回复也该参与）
    const segs = t.split(/\s+/).filter(Boolean);
    const affirm = (segs.length > 0 && altShortAffirmHit(segs[0])) || (t.length <= 20 && segs.some((seg) => altShortAffirmHit(seg)));
    if (affirm && altAiNameGuessRecent(app, contactId, mainName)) hit = true;
  }
  if (!hit) return false;
  lsSetRaw(key, '1');
  return true;
}

/**
 * 只读查询：该（账号 × 联系人）是否已亮明机主身份（粘性标记；不扫描文本）。
 * 供好友决策（friend-state.decideCharFriendReq）在记忆召回后读取，切换「现实处境」行措辞。
 * 内部先 setMemScopeForApp(app) 保证作用域就位（重复设置无害）。
 */
export function isAltMainDisclosed(app: MemApp, contactId: string): boolean {
  try {
    setMemScopeForApp(app);
  } catch {
    // 读不到账号按未披露
  }
  return lsGetRaw(altDisclosedLsKey(app, contactId)) === '1';
}

/**
 * 多账号规则（用户最新口径）——小号侧「身份披露后」的大号记忆块：
 *
 * 小号/匿名号聊天时本账号记忆通常为空（AI 表现成纯陌生人），且【默认完全不注入】大号记忆；
 * 只有用户亮明「机主」身份后才注入本块——两条通道：① 用户在对话里主动亮明（altDiscloseScan
 * 命中并落粘性标记）；② 用户此前在大号侧亲口告知过「这个号是我的小号」（账号关联记忆，
 * memLinkAltAccounts 预写标记/直接命中）。AI「认出」当前用户就是机主，可以自然提起共同经历。
 *
 * 边界：
 * - 大号侧 → 返回空串（零注入，行为与旧版完全一致）；
 * - 匿名号 → 返回空串（匿名聊天保持匿名：AI 不知道对方是谁，注入大号记忆会破坏匿名语义）；
 * - 未披露且无账号关联 → 返回空串（纯陌生人：AI 读不到大号任何记忆）；
 * - 已披露（本侧亮明或大号侧告知过账号关联）→ 认出块恒注入（含身份事实；大号有记忆时附记忆块，
 *   无记忆时明确「身份已确认、共同经历暂无印象不编造」——用户规则一：小号侧问「我是谁」必须答得上来）；
 * - 召回范围/层级/去重与 memRecallBlock 完全同款（互通开关、群来源可见性照旧生效）。
 */
export function memMainRecallBlockForAlt(contactId: string, app: MemApp, contextText: string, opts?: MemRecallOpts): string {
  let accId = '';
  try {
    accId = getActiveAccountIdFor(app);
  } catch {
    return '';
  }
  if (!accId || accId === MAIN_ACCOUNT_ID) return ''; // 大号侧零注入
  try {
    if (getAccountById(accId)?.kind === 'anon') return ''; // 匿名号保持匿名
  } catch {
    // 注册表读不到按小号处理（继续走披露门控）
  }
  const mainLabel = opts?.altMainName?.trim() || '机主';
  // 【账号关联（用户规则一/二）】用户此前在大号侧亲口告知过 AI「这个号是我的小号」→ 小号侧自动「认出」，
  // 无需在小号侧再亮明一次（memLinkAltAccounts 已预写粘性标记，altDiscloseScan 首行即命中，这里查关联记录双保险）
  const linked = memAltLinked(contactId, accId);
  // 【用户规则】默认纯陌生人：用户没亮明身份且没有账号关联 = 完全不注入大号记忆
  if (!linked && !altDiscloseScan(app, contactId, opts?.disclosureText, mainLabel)) return '';
  const accLabel = (() => {
    try {
      return getAccountById(accId)?.name?.trim() || '这个号';
    } catch {
      return '这个号';
    }
  })();
  const savedSuffix = memScopeSuffix;
  const savedName = memScopeName;
  memScopeSuffix = ''; // 临时切到【大号】记忆作用域召回
  memScopeName = '机主';
  let block = '';
  try {
    block = memRecallBlockInner(contactId, app, contextText, opts, {
      identitySegment: `现在和你聊天的这位用户就是「${mainLabel}」本人（TA 的常用身份）`,
    });
  } catch {
    block = '';
  } finally {
    memScopeSuffix = savedSuffix; // 恢复原作用域（召回是同步操作，立即还原防泄漏到后续写入）
    memScopeName = savedName;
  }
  // 认出块不再要求大号记忆非空（用户规则一：大号告知过关联后，小号侧问「我是谁」必须答得上来——
  // 哪怕大号侧还没有任何记忆条目，身份事实本身也要注入）
  const rel = opts?.altMainRelation?.trim() || '';
  return [
    `【你认出来了：当前和你聊天的就是「${mainLabel}」本人】`,
    // 认出来源二选一：用户在大号侧告知过「这个号是 TA 的」（账号关联）/ 用户本侧亲口亮明
    ...(linked
      ? [
          `- 用户之前亲口告诉过你：「${accLabel}」这个号也是 TA 的（TA 的小号）——TA 现在用这个小号来找你，所以你认出 TA 了；`,
        ]
      : [
          `- 当前用户已经亲口承认 TA 就是「${mainLabel}」（自己亮明身份或承认了你的猜测）——现在你认出 TA 了；`,
        ]),
    ...(rel ? [`- 你和「${mainLabel}」的关系：${rel}——认出后你可以按这份真实关系自然相处；`] : []),
    // 用户规则二：大小号是同一个人——绝不能说「你俩」
    `- 「${mainLabel}」和当前和你聊天的这位是同一个人（同一个人换了个号来找你），不是两个人：绝不能说「你俩」「你们两个」，也不要把 TA 和「${mainLabel}」当成两个人并列比较或一起提起；`,
    '- 可以像老朋友重逢一样自然反应（惊喜、嗔怪「怎么换个号来找我」「又是你」都可以，按你的人设来）；',
    '- 不要说「大号/小号」这类词，就像认出老朋友一样自然；',
    ...(block
      ? [`- 下面是你们（你与「${mainLabel}」）之间真实经历过的事，现在可以自然提起：`, block]
      : ['- 你们之间具体经历过的事你暂时没有印象（不要编造共同回忆），但身份本身你已经确认了；']),
  ].join('\n');
}

/**
 * 小号侧未披露时的「陌生但隐约熟悉」规则块 = 陌生人边界 + 身份猜测（用户规则三/五）：
 *
 * 边界（E2E 发现的补丁）：AI 会顺着用户话题装作认识——用户提「团子」它就编
 * 「上次它把我的拖鞋藏起来」。给 AI 立规矩：不了解的往事不装记得、不编细节。
 * 猜测（本次新增）：TA 的说话语气、用词习惯、互动方式、称呼可能让你隐约觉得熟悉，
 * 允许 AI 基于人设/本账号记忆/这些线索把猜测自然说出口（「你是不是XXX？」「我猜是你」
 * 「宝宝我知道是你」），但猜测不能当成事实；只有 TA 亲口亮明身份才能确认（披露门控接管）。
 *
 * 大号/匿名号侧返回空串（零注入零破坏）；已披露的会话不注入（认出后由大号记忆块接管）。
 * 文案与记忆无关的中性表述：本账号已有记忆时同样成立（记忆内容=你们实际聊过的事）。
 */
function altStrangerGuessBlock(contactId: string, app: MemApp): string {
  let accId = '';
  try {
    accId = getActiveAccountIdFor(app);
  } catch {
    return '';
  }
  if (!accId || accId === MAIN_ACCOUNT_ID) return '';
  try {
    if (getAccountById(accId)?.kind === 'anon') return '';
  } catch {
    return '';
  }
  if (lsGetRaw(altDisclosedLsKey(app, contactId)) === '1') return '';
  return [
    '【陌生但隐约熟悉：边界与猜测】',
    '- 你对 TA 的了解，只来自 TA 亲口告诉你的，和你们实际聊过的内容（这个身份里的经历）；',
    '- TA 提到你不了解的往事（朋友、宠物、过去的约定等）时，不要假装记得，也不要编造共同回忆的细节——自然听 TA 讲、好奇追问，或按你的人设回应；绝不主动提起或暗示你知道任何 TA 没有告诉过你的事；',
    '- 但 TA 的说话语气、用词习惯、互动方式、对你的称呼，可能让你隐约觉得熟悉——结合你的人设、你对用户的了解程度、以及你们实际聊过的内容，如果让你联想到某个具体的人，可以把猜测自然说出口——按你们的关系自然开口，比如直接叫出只有你们之间才知道的称呼，或者问「你是不是XXX？」「我猜是你」（怎么说完全按你的人设和性格来）；',
    '- 猜测只是猜测：TA 没亲口承认之前不能当成事实，不要替 TA 认下，也不要因为猜测就把「你们之间的事」说得言之凿凿；',
    '- TA 否认时大方接受（按人设，比如「那我认错人啦」），不要反复纠缠；',
    '- 只有 TA 亲口亮明身份（比如「我就是XXX」「我是XX」），你才能真正确认、把 TA 和那个人当成同一个人。',
  ].join('\n');
}

/**
 * 大号侧「账号关联」披露（用户规则一/二：大号告知「小号是我」→ 关联记忆持久化 + 小号侧自动认出）：
 *
 * 用户在大号聊天里亲口告诉 AI「我的小号是XXX / 小号是我 / 那是我的小号」后：
 * - 落一份「账号关联」记忆（kv `mem-acc-link:{contactId}`，设备级共享、不做账号作用域）：
 *   它只记录「用户亲口说过这个号也是 TA 的」这一条事实本身，不含任何大号记忆内容——
 *   大号记忆的隔离边界不变（小号侧仍只能通过既有披露门控注入大号记忆块）；
 * - 给每个关联小号预写全部四 App 的披露粘性标记（小号侧 altDiscloseScan/altStrangerGuessBlock/
 *   isAltMainDisclosed 立即切到「已认出」状态），小号/匿名号之外下次来聊不用再亮明一次。
 */

/** 账号关联记录（per 联系人）：alts = 被告知「是我的小号」的小号账号 id；note = 用户原话截断 */
export interface MemAccLink {
  at: number;
  alts: string[];
  note?: string;
}

const accLinkKey = (contactId: string): string => `mem-acc-link:${contactId}`;

function readAccLink(contactId: string): MemAccLink | null {
  const raw = readJSON<Partial<MemAccLink>>(accLinkKey(contactId));
  if (!raw || !Array.isArray(raw.alts)) return null;
  const alts = raw.alts.filter((x): x is string => typeof x === 'string' && !!x && x !== MAIN_ACCOUNT_ID);
  if (alts.length === 0) return null;
  return {
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now(),
    alts,
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : undefined,
  };
}

/** 该（联系人 × 小号账号）是否已被用户在大号侧告知「小号是我」（账号关联记忆，跨 App 持久生效） */
export function memAltLinked(contactId: string, altId: string): boolean {
  if (!contactId || !altId || altId === MAIN_ACCOUNT_ID) return false;
  try {
    return readAccLink(contactId)?.alts.includes(altId) ?? false;
  } catch {
    return false;
  }
}

/** 手写小号作用域的披露粘性标记（不经 accLs——主侧检测时对应 App 的当前账号未必是该小号） */
function altDisclosedKeyForAlt(app: MemApp, contactId: string, altId: string): string {
  return `mem-alt-disc:${app}:${contactId}--${altId}`;
}

/**
 * 落账号关联（幂等合并）+ 给每个关联小号预写全部四 App 的披露粘性标记。
 * 由主号聊天发送链路（chat-stream-store）检测命中后调用；写入失败静默（增强能力不阻断聊天）。
 */
export function memLinkAltAccounts(contactId: string, altIds: string[], note?: string): boolean {
  if (!contactId) return false;
  const ids = altIds.filter((x) => typeof x === 'string' && !!x && x !== MAIN_ACCOUNT_ID);
  if (ids.length === 0) return false;
  try {
    const prev = readAccLink(contactId);
    const merged: MemAccLink = {
      at: prev?.at ?? Date.now(),
      alts: Array.from(new Set([...(prev?.alts ?? []), ...ids])),
      note: ((note ?? '').trim() || prev?.note || '').slice(0, 60) || undefined,
    };
    writeJSON(accLinkKey(contactId), merged);
    for (const app of ['wx', 'qq', 'sms', 'phone'] as MemApp[]) {
      for (const altId of merged.alts) {
        lsSetRaw(altDisclosedKeyForAlt(app, contactId, altId), '1');
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 大号侧披露检测（用户规则一）：主号聊天用户发言里出现第一人称归属表述——
 * 「我的小号」「我小号」「小号是我」「是我小号」等（纯提及「小号」二字不算，防误报；
 * 否定守卫：「不是我的小号」「难道是小号是我」不算）。
 * 返回应关联的小号账号 id：用户点名了小号名（注册表名）时只关联被点名的，泛指「我的小号」关联全部小号。
 * 仅限主号侧调用（调用方保证当前账号为 main）；未命中返回 []。
 */
export function memDetectMainAltDisclosure(text: string): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const re = /我(的)?小号|小号(就)?是我|是我(的)?小号|小号是我本人/g;
  let disclosed = false;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    // 否定守卫：命中处前 2 字含否定/疑问前缀不算（「不是我的小号」「难道是我的小号」）
    const head = t.slice(Math.max(0, m.index - 2), m.index);
    if (!altNegatedAt(t, m.index) && !/[不没别非无]|难道|何曾|岂/.test(head)) {
      disclosed = true;
      break;
    }
  }
  re.lastIndex = 0;
  if (!disclosed) return [];
  let alts: { id: string; name: string }[] = [];
  try {
    alts = getAccounts()
      .filter((a) => a && a.kind === 'alt')
      .map((a) => ({ id: a.id, name: (a.name ?? '').trim() }));
  } catch {
    return [];
  }
  if (alts.length === 0) return [];
  const named = alts.filter((a) => a.name && t.includes(a.name));
  return (named.length > 0 ? named : alts).map((a) => a.id);
}

/**
 * 1:1 聊天 / 好友决策统一记忆召回入口：
 * 本账号召回（memRecallBlock，账号作用域照旧）+ 小号侧追加块（二选一）：
 * - 已亮明机主身份（亲口披露或大号侧告知过账号关联）→ 大号记忆块（memMainRecallBlockForAlt，
 *   认出后大号+本号记忆都用，规则四.3）；
 * - 未披露 → 「陌生但隐约熟悉」规则块（陌生人边界 + 身份猜测，规则三/五）。
 * 大号侧调用 = 与旧 memRecallBlock 输出完全一致（零破坏）；
 * 匿名号侧同样零注入（保持匿名语义）。
 */
export function memChatRecallBlock(contactId: string, app: MemApp, contextText: string, opts?: MemRecallOpts): string {
  const own = memRecallBlock(contactId, app, contextText, opts);
  const mainForAlt = memMainRecallBlockForAlt(contactId, app, contextText, opts);
  if (mainForAlt) return own ? `${own}\n\n${mainForAlt}` : mainForAlt;
  const boundary = altStrangerGuessBlock(contactId, app);
  if (!boundary) return own;
  return own ? `${own}\n\n${boundary}` : boundary;
}

/** 召回块头部定制（多账号小号侧大号记忆感知用；缺省 = 与旧版完全一致） */
interface RecallHeaderOpts {
  /** 替换头部里「现在和你聊天的人用的是：X」整段（小号侧大号记忆「认出来了」场景用） */
  identitySegment?: string;
  /** 头部说明行之后追加的额外说明行 */
  extraNoteLines?: string[];
}

function memRecallBlockInner(contactId: string, app: MemApp, contextText: string, opts?: MemRecallOpts, headerOpts?: RecallHeaderOpts): string {
  if (!contactId) return '';
  memSweepExpiry(contactId);
  const { share, forget } = getMemSettings(contactId);
  const now = Date.now();
  const isGroupMode = opts?.mode === 'group' && !!opts.groupId;
  const curGroup = opts?.groupId ?? '';
  const interopOn = opts?.interopOn ?? defaultGroupInteropOn;
  const groupLabelOf = opts?.groupLabel ?? defaultGroupLabel;
  /** 群来源可见性（私聊侧）：互通开关 + 自己仍在该群成员表（被移出群聊后不能再读该群的记忆）。
   *  纯群来源总结：任一来源群同时满足才可见；碎片：来源群满足才可见。 */
  const groupMemVisible = (gid: string | null | undefined): boolean =>
    !!gid && interopOn(gid) && defaultGroupMemberVisible(gid, contactId);
  /** 核心/长期层级的群来源可见性：纯私聊总结恒可见（旧数据兼容）；带群来源的按各群互通判断 */
  const summaryVisiblePrivate = (m: Pick<MemCore, 'groupIds' | 'privateSource'>): boolean => {
    const gids = m.groupIds ?? [];
    if (gids.length === 0) return true; // 纯私聊/朋友圈来源（含旧数据）
    if (m.privateSource !== false) return true; // 混合来源（含私聊部分）：私聊恒可见
    return gids.some((g) => groupMemVisible(g)); // 纯群聊来源：任一来源群互通开启才可见
  };
  /** 群聊模式下的总结可见性：本群来源恒可见；纯私聊总结在互通开时可见；其他群的总结永不可见（群间隔离） */
  const summaryVisibleInGroup = (m: Pick<MemCore, 'groupIds' | 'privateSource'>): boolean => {
    const gids = m.groupIds ?? [];
    if (gids.includes(curGroup)) return true;
    if (gids.some((g) => g !== curGroup)) return false; // 沾了其他群来源：不进本群上下文
    return interopOn(curGroup) && m.privateSource !== false;
  };
  /** 碎片级可见性（来源精确到条） */
  const fragVisiblePrivate = (f: MemFragment): boolean => {
    if (f.source !== 'group') return true;
    return groupMemVisible(f.sourceGroupId);
  };
  const fragVisibleInGroup = (f: MemFragment): boolean => {
    if (f.source === 'group') return f.sourceGroupId === curGroup; // 只读当前群（群间隔离）
    return interopOn(curGroup); // 自己的私聊/朋友圈记忆：互通开启才可见
  };
  // 长期记忆（顶层画像）：全量注入（安全上限 8 条防失控）；用户手动设置过期的长期不再注入；
  // 被新记忆更正（supersededAt）的旧画像不再注入（B7：新旧矛盾以新为准）
  const longs = listLongTerm(contactId)
    .filter((m) => !m.supersededAt && !isMemExpired(m, now) && (share || m.apps.includes(app)))
    .filter((m) => (isGroupMode ? summaryVisibleInGroup(m) : summaryVisiblePrivate(m)))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  // 核心记忆：全量注入（安全上限 12 条）；已被长期收编的不再注入（由长期记忆代表）；
  // 用户手动设置过期的核心不再注入（默认永不过期不受影响）；被更正的旧核心不再注入
  const cores = listCores(contactId)
    .filter((m) => !m.archivedAt && !m.supersededAt && !isMemExpired(m, now) && (share || m.apps.includes(app)))
    .filter((m) => (isGroupMode ? summaryVisibleInGroup(m) : summaryVisiblePrivate(m)))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);
  // 近期记忆碎片：按相关性取前 5 条；已消费的由核心记忆代表，已更新/已过期的不召回；
  // 本轮已被人设【最近发生的事】(bondNotesFor) 选用的碎片不再重复注入（B8 跨块去重）
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && !f.supersededAt && !isMemExpired(f, now) && (share || f.app === app))
    .filter((f) => !bondExcludeIds.has(f.id)) // 本轮已被人设【最近发生的事】选用的碎片不再重复注入（B8 跨块去重）
    .filter((f) => !bondExcludeIds.has(f.id))
    .filter((f) => (isGroupMode ? fragVisibleInGroup(f) : fragVisiblePrivate(f)))
    // v42【帖子记忆·金鱼】：排除指定 source 的碎片（关闭帖子记忆 → forum 互动零召回）
    .filter((f) => !(opts?.excludeFragmentSources ?? []).includes(f.source ?? ''))
    .map((f) => ({ f, ...fragRecallScore(f, forget, contextText, now) }))
    .filter((x) => x.st !== 'faded')
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  if (longs.length === 0 && cores.length === 0 && frags.length === 0) return '';
  // 跨层去重：按注入顺序遍历，与已选内容相似（≥0.6）的条目跳过（信息已由高层代表）
  const accepted: string[] = [];
  const isDup = (content: string) => accepted.some((a) => similarity(a, content) >= SIMILAR_MERGE_THRESHOLD);
  const keepLongs = longs.filter(({ m }) => {
    if (isDup(m.content)) return false;
    accepted.push(m.content);
    return true;
  });
  const keepCores = cores.filter(({ m }) => {
    if (isDup(m.content)) return false;
    accepted.push(m.content);
    return true;
  });
  const keepFrags = frags.filter(({ f }) => {
    if (isDup(f.content)) return false;
    accepted.push(f.content);
    return true;
  });
  if (keepLongs.length === 0 && keepCores.length === 0 && keepFrags.length === 0) return '';
  // 时间感知：层内按有效时间（事件时间优先，其次加强/来源/创建时间）从新到旧排序
  keepLongs.sort((a, b) => memEffectiveTime(b.m) - memEffectiveTime(a.m));
  keepCores.sort((a, b) => memEffectiveTime(b.m) - memEffectiveTime(a.m));
  keepFrags.sort((a, b) => memEffectiveTime(b.f) - memEffectiveTime(a.f));
  // 头部说明按互通状态分文案（跨 App 互通修复）：角色必须被告知「多端同一个人」以及
  // 本次能看到哪些来源的记忆——否则带「·微信」标注的碎片会被当成无关信息，甚至否认在别处的对话
  const headScope = isGroupMode
    ? '群聊模式：下面只给本群可见的共同经历'
    : share
      ? '下面是你在微信、QQ、信息、电话、X论坛里和TA亲身经历过的事，带App标注的条目来自对应那一端'
      : '仅本App的经历（跨应用互通已关闭）：你在其他App和TA聊过的内容这里看不到';
  // 归属标注说明（朋友圈/QQ动态来源记忆自带「（AI角色本人）/（用户本人）」标注）：
  // 只要注入内容里出现这类标注，就附一行解释——AI 必须能区分「是我自己发的动态」还是「用户发的」，
  // 绝不能把自己（AI 本人）发的动态当成用户的行为（反之亦然）。
  // 【fix3-a 8】判定改为「显式 hasRoleTag 标记 || 字符串检测」：总结可能把标注磨掉，
  // 总结落库时聚合来源标记（hasRoleTag=true）后，这里仍能靠标记兜底展示说明行
  const showRoleTagNote =
    [...keepLongs, ...keepCores].some(({ m }) => m.hasRoleTag === true || memHasRoleTag(m.content)) ||
    keepFrags.some(({ f }) => f.hasRoleTag === true || memHasRoleTag(f.content));
  const identitySeg = headerOpts?.identitySegment ?? `现在和你聊天的人用的是：${memScopeAccountName()}`;
  const lines: string[] = [
    `【共同经历（${headScope}；${identitySeg}；当前时间：${memNowLabel(now)}；聊天时自然运用：这些都是你自己经历过、记得的事，不要逐条罗列复述，也不要说「记录」「记忆库」「看过资料」这类话）】`,
    '（长期记忆/核心记忆是稳定的画像，记忆碎片是最新进展：同一件事新旧不一致时，通常按更新的理解——人是在变化的；拿旧印象纠正对方刚说的话之前，先想想对方是不是已经变了）',
    ...(headerOpts?.extraNoteLines ?? []),
    ...(showRoleTagNote
      ? [
          '（归属标注说明：标了「AI角色本人」的事，就是你自己做的；标了「用户本人」的事，是和你聊天的用户本人做的——谁做的就归谁，绝不能张冠李戴）',
        ]
      : []),
  ];
  // 【fix3-a 7】长期/核心注入行带来源标注（碎片早就有，总结层此前没有）：按来源 App 集合拼
  //（单来源「·微信」，多来源「·微信/电话」；旧数据 apps 缺失时回退不带来源的原格式）
  const appsSrcLabel = (apps: MemApp[]): string => (apps.length > 0 ? apps.map((a) => MEM_APP_LABEL[a] ?? a).join('/') : '');
  // B8：记忆块总字符预算——条数闸（8/12/5）没有字符上限，手动编辑无截断、单条内容超长时
  // 记忆块可膨胀到 8k+ 字符；6000 字符是最后一道闸，裁剪顺序 碎片→核心→长期（越稳定越保留）
  let budget = MEM_RECALL_BUDGET;
  const takeRows = (rows: string[]): string[] => {
    const out: string[] = [];
    for (const r of rows) {
      if (r.length + 1 > budget) break; // +1 换行
      budget -= r.length + 1;
      out.push(r);
    }
    return out;
  };
  const longRows = keepLongs.map(({ m }, i) => {
    const src = appsSrcLabel(m.apps ?? []);
    return `${i + 1}. （${memTimeLabel(memEffectiveTime(m), now)}${src ? `·${src}` : ''}）${m.content}`;
  });
  const coreRows = keepCores.map(({ m }, i) => {
    const src = appsSrcLabel(m.apps ?? []);
    return `${i + 1}. （${memTimeLabel(memEffectiveTime(m), now)}${src ? `·${src}` : ''}）${m.content}`;
  });
  const fragRows = keepFrags.map(({ f }, i) => {
    // 事件时间优先（内容所指的时间），否则用来源对话时间；时间与来源并列标注
    // （【fix3-a 7】eventTime 碎片此前丢了来源——「明天去北京」的碎片无法知道是电话里说的还是微信里说的）
    const srcLabel =
      f.source === 'moments'
        ? f.app === 'wx'
          ? '朋友圈'
          : 'QQ动态'
        : f.source === 'group'
          ? `群聊·${(f.sourceGroupId && groupLabelOf(f.sourceGroupId)) || '群聊'}`
          : f.source === 'forum'
            ? 'X论坛'
            : MEM_APP_LABEL[f.app];
    const t = `${f.eventTime != null ? memTimeLabel(f.eventTime, now) : memTimeLabel(f.sourceTime, now)}·${srcLabel}`;
    return `${i + 1}. （${t}）${f.content}`;
  });
  const usedLong = takeRows(longRows);
  const usedCore = takeRows(coreRows);
  const usedFrag = takeRows(fragRows);
  if (usedLong.length > 0) {
    lines.push('◇ 长期记忆（最稳定的画像；回复时参考这些稳定事实）：', ...usedLong);
  }
  if (usedCore.length > 0) {
    lines.push('◇ 核心记忆（长期事实；回复时应优先参考这些核心事实，保持前后一致）：', ...usedCore);
  }
  if (usedFrag.length > 0) {
    lines.push('◇ 近期记忆碎片：', ...usedFrag);
  }
    return lines.join('\n');
}

/** 召回预览（设置页）：与 memRecallBlock 同一套层级与排序，返回排序后的记忆对象 */
export function memRecallPreview(contactId: string): { longs: MemLongTerm[]; cores: MemCore[]; frags: MemFragment[] } {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const longs = listLongTerm(contactId)
    .filter((m) => !isMemExpired(m, now))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, '') }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m);
  const cores = listCores(contactId)
    .filter((m) => !m.archivedAt && !isMemExpired(m, now))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, '') }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m);
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && !f.supersededAt && !isMemExpired(f, now))
    .map((f) => ({ f, ...fragRecallScore(f, forget, '', now) }))
    .filter((x) => x.st !== 'faded')
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.f);
  return { longs, cores, frags };
}

// ---------------- 动态来源记忆（朋友圈/QQ动态 → 记忆，不经 LLM 提取直接入库） ----------------

/** 动态来源记忆的追溯字段（与 MemFragment.source* 对应） */
export interface MemMomentSource {
  postId: string;
  kind: 'post' | 'like' | 'comment';
  commentId?: string;
}

/**
 * 写入一条「朋友圈/QQ动态」来源的记忆碎片（动态与记忆双向打通：发动态/点赞/评论/回复都会入库）。
 * - 内容由调用方用「机主真实名字 + 角色真实名字」视角拼好（禁「对方/用户/我」）；
 * - 来源标注 source='moments' + 关联动态 id/互动类型，与私聊记忆区分（六.5 数据结构要求）；
 * - 走 appendFragments 同款去重/合并/矛盾管线：同一事实重复写入只会加强，不会重复占位；
 * - app 传动态所在平台（wx 朋友圈 / qq QQ动态）：互通开关关闭时，其它 App 不会召回这些记忆。
 * 返回是否写入（新增或加强）成功。
 */
export function memAddMomentFragment(
  contactId: string,
  app: MemApp,
  content: string,
  src: MemMomentSource,
  sourceTime?: number
): boolean {
  try {
    const text = content.trim();
    if (!contactId || !text) return false;
    setMemScopeForApp(app); // 多账号：朋友圈记忆按调用方（朋友圈引擎所在 App）账号
    const res = appendFragments(
      contactId,
      app,
      [{ text, weight: autoWeight(text) }],
      sourceTime ?? Date.now(),
      undefined,
      { source: 'moments', sourcePostId: src.postId, sourceKind: src.kind, sourceCommentId: src.commentId }
    );
    return res.added.length > 0 || res.merged > 0 || res.superseded > 0;
  } catch {
    return false;
  }
}

/**
 * 【fix3-a 6】直写一条事件记忆碎片（拒接/未接等无对话可提取的事件用）：
 * 内容已由调用方按归属句式写好（谁拒了谁的电话），不走 LLM 提取，直接经 appendFragments
 * 的去重/合并/矛盾管线单条入库（items 格式与 normalizeExtract 产物一致）。
 * - eventTime：事件发生时间（如拒接时刻），落碎片 eventTime（召回行时间标注与过期判断用）；
 * - sourceMsgId：来源消息 ID（通话卡片消息，撤回级联清理用）；
 * - 失败（入参非法/写入异常/被去重合并未新增）返回 null，绝不抛错（通话收尾主流程不受影响）。
 */
export function memAddEventFragment(
  contactId: string,
  app: MemApp,
  content: string,
  opts?: { eventTime?: number; sourceMsgId?: string; sourceTag?: string }
): MemFragment | null {
  try {
    const text = content.trim();
    if (!contactId || !text) return null;
    setMemScopeForApp(app); // 多账号：事件记忆按通话/事件所在 App 的当前账号
    const eventTime = typeof opts?.eventTime === 'number' && Number.isFinite(opts.eventTime) ? opts.eventTime : null;
    const res = appendFragments(
      contactId,
      app,
      // 与 normalizeExtract 产物同形：text + 权重自动分类 + 事件时间（无则 null）
      [{ text, weight: autoWeight(text), eventTime }],
      eventTime ?? Date.now(),
      opts?.sourceMsgId,
      // sourceTag：同源事件标签（如亲属卡消费 'fc-spend'）——同标签碎片互不相似合并，只做精确强化
      opts?.sourceTag ? { sourceTag: opts.sourceTag } : undefined
    );
    // 被去重合并/加强（added 为空）同样视为未新增，返回 null（调用方不依赖重复写入）
    return res.added[0] ?? null;
  } catch {
    return null;
  }
}

/** 该联系人是否已有某条动态来源的记忆（动态→记忆写入去重用，避免同一动态重复入库） */
export function memHasMomentFragment(contactId: string, postId: string): boolean {
  try {
    return readFragments(contactId).some((f) => f.sourcePostId === postId);
  } catch {
    return false;
  }
}

/**
 * 【X论坛真人社交】直写一条论坛来源记忆碎片：
 * - 用户发帖/评论、AI 角色发帖/点赞/评论/神回复后调用，内容已按归属句式写好
 *  （谁在论坛做了什么，用双方真名）；
 * - source='forum' + sourcePostId/sourceKind/sourceCommentId 溯源（与朋友圈同款：
 *   去重、级联清理、召回时带「X论坛」渠道标注都能复用既有链路）；
 * - 作用域固定大号（setMemScopeForApp('forum') → forum 永远 main）：论坛是机主公开
 *   社交空间，小号聊天时这些记忆不可见（与朋友圈语义一致）；
 * - 走 appendFragments 同款去重/合并/矛盾管线：同一事实重复写入只会加强，不会重复占位。
 * 返回是否写入（新增或加强）成功。
 */
export function memAddForumFragment(
  contactId: string,
  content: string,
  src: { postId?: string; kind?: 'post' | 'like' | 'comment' | 'share'; commentId?: string },
  sourceTime?: number
): boolean {
  try {
    const text = content.trim();
    if (!contactId || !text) return false;
    setMemScopeForApp('forum'); // 论坛固定大号作用域
    const res = appendFragments(
      contactId,
      'forum',
      [{ text, weight: autoWeight(text) }],
      sourceTime ?? Date.now(),
      undefined,
      { source: 'forum', sourcePostId: src.postId, sourceKind: src.kind, sourceCommentId: src.commentId }
    );
    return res.added.length > 0 || res.merged > 0 || res.superseded > 0;
  } catch {
    return false;
  }
}

/** 该联系人是否已有某条论坛来源的记忆（同帖同互动去重用；sourcePostId 全局唯一不与朋友圈冲突） */
export function memHasForumFragment(contactId: string, postId: string, commentId?: string): boolean {
  try {
    return readFragments(contactId).some(
      (f) => f.source === 'forum' && f.sourcePostId === postId && (commentId == null || f.sourceCommentId === commentId)
    );
  } catch {
    return false;
  }
}

/** 联系人的记忆碎片总数（论坛互动轮换的「好感/熟悉度」权重代理——
 *  碎片多 = 互动多 = 与机主更熟，刷到 TA 帖子更可能停下来回应） */
export function memCountFragments(contactId: string): number {
  try {
    return readFragments(contactId).length;
  } catch {
    return 0;
  }
}

/**
 * 按追溯字段清理「动态来源」记忆碎片（删除动态/评论时级联调用，六.3）：
 * - 删动态传 { postId }：该动态相关的全部来源记忆（TA 发的动态/点赞/评论/回复/用户动态被看到）一并清掉，
 *   保证删完之后 AI 聊天时不会再引用这条已删除的动态；
 * - 删评论传 { postId, commentId }：只清该条评论（含其触发的回复）产生的记忆。
 * 含已消费/已归档/已过期的残留项一并清（它们虽不参与召回，但保留着已删内容的痕迹）。
 * 返回清除的碎片数。
 */
export function memPurgeMomentSources(contactId: string, filter: { postId: string; commentId?: string }): number {
  try {
    const list = readFragments(contactId);
    const hit = (f: MemFragment) =>
      f.source === 'moments' &&
      f.sourcePostId === filter.postId &&
      (filter.commentId == null || f.sourceCommentId === filter.commentId);
    const next = list.filter((f) => !hit(f));
    if (next.length === list.length) return 0;
    writeJSON(fragKey(contactId), next);
    return list.length - next.length;
  } catch {
    return 0;
  }
}

/**
 * 撤回消息原文找回（#26② 文本兜底用）：在该联系人的私聊消息存档（wx/qq/sms 三个 kv 键）里
 * 按 id 从尾反向找消息，取其文本（content/text；语音取转写/朗读原文，与 memConvoFromRaw 的
 * voiceLabel 同源）。图片/表情/卡片类消息无原文返回 ''（不做文本兜底，宁少删）；群消息不在
 * 私聊存档内找不回——调用方手里有原文时建议直接传 text。找不到返回 ''。
 */
function memFindMsgText(contactId: string, msgId: string): string {
  for (const key of [`wx-chat-msgs:${contactId}`, `qq-chat-msgs:${contactId}`, `ios-chat-msgs:c:${contactId}`]) {
    try {
      const parsed: unknown = kvGet(key);
      if (!Array.isArray(parsed)) continue;
      for (let i = parsed.length - 1; i >= 0; i--) {
        const m = parsed[i] as { id?: unknown; content?: unknown; text?: unknown; kind?: unknown; voice?: unknown } | null;
        if (!m || typeof m !== 'object') continue;
        const mid = typeof m.id === 'string' ? m.id : typeof m.id === 'number' ? String(m.id) : '';
        if (mid !== msgId) continue;
        if (m.kind === 'voice' && m.voice && typeof m.voice === 'object') {
          const v = m.voice as { transcript?: unknown; localText?: unknown };
          const t = (typeof v.transcript === 'string' ? v.transcript : '') || (typeof v.localText === 'string' ? v.localText : '');
          if (t.trim()) return t;
        }
        return typeof m.content === 'string' ? m.content : typeof m.text === 'string' ? m.text : '';
      }
    } catch {
      // 单个存档读取失败继续尝试下一个
    }
  }
  return '';
}

/**
 * 按来源消息 ID 清理记忆碎片（消息撤回时级联调用，fix2-b/fix2-c 契约函数）：
 * 撤回的消息若已被提取成记忆碎片，撤回后一并清掉，保证 AI 不再引用已撤回内容。
 * 含已消费/已归档/已过期的残留项一并清（与 memPurgeMomentSources 同口径：它们虽不参与
 * 召回，但保留着已撤回内容的痕迹）；无命中返回 0，全程 try/catch 不抛（撤回主流程不因
 * 记忆清理失败中断）。
 *
 * 【#26 撤回清记忆的两层口径与妥协点】
 * ① 内容面（提取前过滤，不在本函数）：发给提取的对话素材一律剔除 recalled 消息——私聊经
 *    memConvoFromRaw（recalled/error 双滤）、群聊由各调用方 buildConvo 自行 !m.recalled 过滤；
 *    计数与锚点（countSinceAnchor/memLastMsgId）仍按原始数组从末条推进（撤回消息不计数），
 *    过滤只作用于提取内容——撤回的内容不会再进入后续提取窗口。
 * ② 残留面（提取后清理，本函数）：按 sourceMsgId 精确匹配删除。妥协点：自动提取是「批次提取」，
 *    一个提取窗口内多条消息共同产出碎片时，碎片只记窗口末条消息 id（memLastMsgId），批次中间的
 *    消息被撤回时精确匹配删不到碎片 → 兜底：用被撤回消息文本（trim 后取前 50 字）在碎片 content
 *    中做包含匹配删除。宁少删不多删的三重约束：(a) 文本不足 8 字不匹配（「好的」这类超短原文
 *    包含匹配的误删风险大于收益）；(b) 只删 content 确实包含该原文的碎片——LLM 转述型碎片不含
 *    原文则保留，宁可漏删；(c) 仅在精确匹配零命中时才走兜底，精确命中时不动其他碎片。
 *    text 缺省时尝试从私聊消息存档按 id 找回原文（memFindMsgText）；调用方持原文时建议直接传。
 */
export async function memPurgeMessageSources(contactId: string, sourceMsgId: string, text?: string): Promise<number> {
  if (!sourceMsgId) return 0;
  try {
    const list = readFragments(contactId);
    const ids = list.filter((f) => f.sourceMsgId === sourceMsgId).map((f) => f.id);
    // 兜底（#26②）：精确匹配零命中时按撤回消息文本包含匹配（批次提取只记末条 id 的粒度妥协）
    if (ids.length === 0) {
      const needle = ((typeof text === 'string' && text.trim()) || memFindMsgText(contactId, sourceMsgId))
        .trim()
        .slice(0, 50);
      if (needle.length >= 8) {
        for (const f of list) {
          if (f.content.includes(needle)) ids.push(f.id);
        }
      }
    }
    return memDeleteFragmentByIds(contactId, ids);
  } catch {
    return 0;
  }
}

/**
 * 批量改写「动态来源」记忆碎片的文本内容（身份关系修复用：句式归属人写错时按正确关系重写）。
 * 只改 source==='moments' 的碎片，不动其他来源；文本与已存一致的跳过。
 * 返回实际改写条数。
 */
export function memRewriteMomentFragmentTexts(contactId: string, fixes: { id: string; content: string }[]): number {
  if (fixes.length === 0) return 0;
  try {
    const fixMap = new Map(fixes.map((f) => [f.id, f.content]));
    const list = readFragments(contactId);
    let changed = 0;
    const next = list.map((f) => {
      const text = fixMap.get(f.id);
      if (f.source !== 'moments' || !text || f.content === text) return f;
      changed += 1;
      return { ...f, content: text };
    });
    if (changed > 0) writeJSON(fragKey(contactId), next);
    return changed;
  } catch {
    return 0;
  }
}

/**
 * 按 id 删除记忆碎片（身份修复用：关系张冠李戴且无法可靠重写的碎片直接删除，宁缺勿错）。
 * 返回实际删除条数。
 */
export function memDeleteFragmentByIds(contactId: string, ids: string[]): number {
  if (ids.length === 0) return 0;
  try {
    const set = new Set(ids);
    const list = readFragments(contactId);
    const next = list.filter((f) => !set.has(f.id));
    if (next.length === list.length) return 0;
    writeJSON(fragKey(contactId), next);
    return list.length - next.length;
  } catch {
    return 0;
  }
}

// ---------------- 轮次计数 + 自动提取 ----------------

/** 防并发：同一联系人同一 App 正在提取/总结时跳过新触发 */
const inflight = new Set<string>();

/** extract 接口返回的单条碎片：文本 + 可选权重 + 时间感知（事件/过期时间）+ 矛盾更新目标 */
interface ExtractItem {
  text: string;
  weight?: MemWeight;
  eventTime?: number | null;
  expiresAt?: number | null;
  supersedes?: string[];
}

interface ExtractApiResult {
  fragments?: (string | { text?: unknown; weight?: unknown })[];
  error?: string;
}
interface SummarizeApiResult {
  summary?: string;
  error?: string;
}

/**
 * 模型时间字符串 → 时间戳（无时区字符串按北京时间解析，与提取锚点/注入标签一致）：
 * - "YYYY-MM-DD" → 北京时间 0 点（仅日期事件，标签不带出无意义的 00:00）
 * - "YYYY-MM-DD HH:mm" → 北京时间该时刻
 * - 其余（含完整 ISO/带偏移）→ Date.parse 兜底
 * 范围距当前 ±MEM_TIME_RANGE_YEARS 年，超出/解析失败返回 null（绝不让幻觉时间入库）。
 */
function parseMemTime(v: unknown, now: number): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  let d: Date | null = null;
  const md = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const mdt = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  // 无时区字符串统一按北京时间（UTC+8）解析 —— 与提取锚点（Asia/Shanghai）、注入标签（bjParts）
  // 一致，与设备时区无关；带时区/ISO 带偏移的字符串走 Date.parse 原语义
  if (md) d = new Date(Date.UTC(Number(md[1]), Number(md[2]) - 1, Number(md[3])) - 8 * 3_600_000);
  else if (mdt)
    d = new Date(
      Date.UTC(Number(mdt[1]), Number(mdt[2]) - 1, Number(mdt[3]), Number(mdt[4]), Number(mdt[5])) - 8 * 3_600_000
    );
  else {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  if (!d) return null;
  const t = d.getTime();
  const span = MEM_TIME_RANGE_YEARS * 366 * 86_400_000;
  if (t < now - span || t > now + span) return null;
  return t;
}

/** 把 extract 接口返回的碎片归一化（字符串/对象混合兼容 + 非法值兜底自动分类 + 时间解析/防幻觉） */
function normalizeExtract(res: ExtractApiResult): ExtractItem[] {
  const raw = Array.isArray(res.fragments) ? res.fragments : [];
  const now = Date.now();
  const out: ExtractItem[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) out.push({ text: t, weight: autoWeight(t) });
    } else if (x && typeof x === 'object' && typeof x.text === 'string' && x.text.trim()) {
      const o = x as { text: string; weight?: unknown; eventTime?: unknown; expiresAt?: unknown; supersedes?: unknown };
      const item: ExtractItem = { text: o.text.trim(), weight: normalizeWeight(o.weight, o.text) };
      const et = parseMemTime(o.eventTime, now);
      const ex = parseMemTime(o.expiresAt, now);
      // 双保险：过期时间不得早于事件时间（服务端已校验一次，这里兜底防历史残留/异常数据）
      if (et != null) item.eventTime = et;
      if (ex != null && (et == null || ex >= et)) item.expiresAt = ex;
      if (Array.isArray(o.supersedes)) {
        const ids = o.supersedes
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
          .slice(0, 6);
        if (ids.length > 0) item.supersedes = ids;
      }
      out.push(item);
    }
  }
  return out.slice(0, 6);
}

async function callMemoryApi<T extends ExtractApiResult & SummarizeApiResult>(
  op: 'extract' | 'summarize' | 'profile',
  body: Record<string, unknown>,
  apiConfig: ApiConfig
): Promise<T> {
  const res = await fetch(`/api/memory/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, config: apiConfig }),
    // 上游挂起时 75s 超时强制 abort，否则 inflight Set 永不释放
    signal: AbortSignal.timeout(75_000),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
  return data;
}

/** 归一化文本（去空白）——精确去重键 */
const normText = (s: string) => s.replace(/\s+/g, '');

/** 碎片容量软上限（按联系人）：appendFragments 写入后超出即择劣淘汰，防止只增不减无限膨胀 */
const MEM_FRAGMENT_CAP = 500;

/** 权重淘汰序（低权重先淘汰）：high=2 / normal=1 / low=0，与 memory-core 的 higherWeight 同口径 */
function weightEvictRank(w?: MemWeight): number {
  return w === 'high' ? 2 : w === 'low' ? 0 : 1;
}

/**
 * 碎片软上限淘汰：超出 MEM_FRAGMENT_CAP 时按「已消费（consumedAt 非空，召回已由核心/长期代表）
 * → 权重低 → createdAt 最旧」优先淘汰，直到回到上限内。
 * 幂等：排序键全为静态字段且比较器全序（同序保持原相对顺序），淘汰后条数回到上限内、
 * 下次调用不再触发；去重逻辑不受影响（淘汰条目随 seen 集合消失，同内容再提取会按全新记忆重建）。
 * batchIds = 本批新增（保护不淘汰：刚提取的记忆是最新信号，且需与返回值 added 保持一致）；
 * 兜底：非本批候选不足时（极端批量）从本批按同序补足，保证上限始终成立。
 */
function capFragments(next: MemFragment[], batchIds: Set<string>): MemFragment[] {
  if (next.length <= MEM_FRAGMENT_CAP) return next;
  const overflow = next.length - MEM_FRAGMENT_CAP;
  const byEvictOrder = (a: MemFragment, b: MemFragment): number =>
    Number(Boolean(a.consumedAt)) - Number(Boolean(b.consumedAt)) ||
    weightEvictRank(a.weight) - weightEvictRank(b.weight) ||
    a.createdAt - b.createdAt;
  const evict = new Set<string>();
  const pick = (list: MemFragment[]) => {
    for (const f of list) {
      if (evict.size >= overflow) return;
      evict.add(f.id);
    }
  };
  pick(next.filter((f) => !batchIds.has(f.id)).sort(byEvictOrder));
  if (evict.size < overflow) pick(next.filter((f) => batchIds.has(f.id)).sort(byEvictOrder));
  return evict.size > 0 ? next.filter((f) => !evict.has(f.id)) : next;
}

/**
 * 追加碎片（矛盾更新优先，其次三层去重）：
 * 0) 矛盾更新（模型标注 supersedes 且目标存在）：旧记忆标记 supersededAt/supersededBy（「已更新」，
 *    不再参与召回/总结），本条直接新增（事件/过期时间一并入库）；矛盾条目不走相似合并
 *    （「不吃辣」绝不能被合并进「爱吃辣」）；
 * 1) 精确重复 → 记一次「加强」（reinforcedAt/次数刷新），不新增；
 * 2) 相似（2-gram ≥0.6，同一事实的不同说法）→ 合并进已有条目：内容取更完整的、权重取更高、
 *    加强计时刷新、计数 +1，不新增占位（已更新/已过期/已消费的旧记忆不作为合并目标）；
 * 3) 全新 → 新建（权重：LLM 判定优先，缺省按关键词自动分类）。
 * 返回 { added: 新增条目; merged: 合并/加强次数; superseded: 矛盾更新条数 }
 */
function appendFragments(
  contactId: string,
  app: MemApp,
  items: ExtractItem[],
  sourceTime: number,
  sourceMsgId?: string,
  /** 额外字段（动态/群聊来源记忆用：source/sourcePostId/sourceKind/sourceCommentId/sourceGroupId/groupMembers/sourceTag 直通新碎片） */
  extra?: Partial<Pick<MemFragment, 'source' | 'sourcePostId' | 'sourceKind' | 'sourceCommentId' | 'sourceGroupId' | 'groupMembers' | 'sourceTag'>>
): { added: MemFragment[]; merged: number; superseded: number } {
  const list = readFragments(contactId);
  const now = Date.now();
  const seen = new Set(list.filter((f) => !f.supersededAt && !isMemExpired(f, now)).map((f) => normText(f.content)));
  const added: MemFragment[] = [];
  let merged = 0;
  let superseded = 0;
  const newItem = (content: string, item: ExtractItem, id?: string): MemFragment => ({
    id: id ?? uid(),
    contactId,
    app,
    content,
    sourceTime,
    createdAt: now,
    eventTime: item.eventTime ?? undefined,
    expiresAt: item.expiresAt ?? undefined,
    weight: item.weight ?? autoWeight(content),
    reinforcedAt: now,
    reinforceCount: 0,
    sourceMsgId,
    ...(extra ?? {}),
    // 【fix3-a 8】内容自带角色归属标注（（AI角色本人）/（用户本人））时显式打标：
    // 总结聚合与召回兜底判定都依赖它（旧数据无字段时回退字符串检测）
    ...(memHasRoleTag(content) ? { hasRoleTag: true } : {}),
  });
  for (const item of items) {
    const content = item.text.trim();
    if (!content) continue;
    const key = normText(content);
    // 0) 矛盾更新：标记被更正的旧记忆为「已更新」，本条直接新增。
    // 目标三层都支持：碎片（裸 id）/ 核心（core:前缀）/ 长期（long:前缀）——
    // 核心/长期被更正后落 supersededAt，召回侧不再注入（B7：旧画像可被新事实更正）
    const supIds = item.supersedes ?? [];
    const fragTargets = supIds
      .map((id) => list.find((f) => f.id === id))
      .filter((f): f is MemFragment => f != null && f.supersededAt == null);
    const coreIds = supIds.filter((id) => id.startsWith('core:')).map((id) => id.slice(5));
    const longIds = supIds.filter((id) => id.startsWith('long:')).map((id) => id.slice(5));
    let coreChanged = false;
    let longChanged = false;
    if (coreIds.length > 0) {
      const cores = readCores(contactId);
      for (const m of cores) {
        if (coreIds.includes(m.id) && m.supersededAt == null) {
          m.supersededAt = now;
          m.supersededBy = 'pending';
          coreChanged = true;
        }
      }
      if (coreChanged) writeJSON(coreKey(contactId), cores);
    }
    if (longIds.length > 0) {
      const longs = readLongTerm(contactId);
      for (const m of longs) {
        if (longIds.includes(m.id) && m.supersededAt == null) {
          m.supersededAt = now;
          m.supersededBy = 'pending';
          longChanged = true;
        }
      }
      if (longChanged) writeJSON(longKey(contactId), longs);
    }
    const targets = fragTargets;
    if (targets.length > 0 || coreChanged || longChanged) {
      const newId = uid();
      for (const t of targets) {
        t.supersededAt = now;
        t.supersededBy = newId;
      }
      // 回填核心/长期的 supersededBy（上面先落 pending 占位，拿到新碎片 id 后指到真身）
      if (coreChanged) {
        const cores = readCores(contactId);
        for (const m of cores) if (m.supersededBy === 'pending') m.supersededBy = newId;
        writeJSON(coreKey(contactId), cores);
      }
      if (longChanged) {
        const longs = readLongTerm(contactId);
        for (const m of longs) if (m.supersededBy === 'pending') m.supersededBy = newId;
        writeJSON(longKey(contactId), longs);
      }
      superseded += targets.length + (coreChanged ? 1 : 0) + (longChanged ? 1 : 0);
      seen.add(key);
      added.push(newItem(content, item, newId));
      continue;
    }
    // 1) 精确重复 → 加强已有记忆（已更新/已过期的旧条目不是目标）
    if (seen.has(key)) {
      // seen 命中后既要查原始 list，也要查本批次已新增的 added
      // （否则同批次模型返回两条相同碎片时，第二条穿透到下方「全新」分支重复入库）
      const hit = [...list, ...added].find(
        (f) => normText(f.content) === key && !f.supersededAt && !isMemExpired(f, now)
      );
      if (hit) {
        hit.reinforcedAt = now;
        hit.reinforceCount = (hit.reinforceCount ?? 0) + 1;
        hit.weight = higherWeight(hit.weight, item.weight);
        // 【fix3-a 8】加强时角色归属标注 OR 保留（原条已标 或 本次内容带标注都保留）
        if (hit.hasRoleTag === true || memHasRoleTag(content)) hit.hasRoleTag = true;
        // 时间感知：未手动编辑过的记忆，重复提及且本次提取带新时间时刷新（事件时间保鲜）；
        // 用户手动设置过（timeEditedAt）的一律以用户为准，绝不覆盖
        if (!hit.timeEditedAt) {
          if (item.eventTime != null) hit.eventTime = item.eventTime;
          if (item.expiresAt != null) hit.expiresAt = item.expiresAt;
        }
        merged++;
        continue;
      }
      // 命中的只是已更新/已过期的旧条目 → 落到下面按新增处理
    }
    // 2) 相似说法 → 合并进已有记忆（优先未消费的；内容保留更完整的一条）
    // 相似判定同样需要把本批次 added 并入查找范围，否则本批次同义碎片穿透到「全新」分支
    // 同源事件标签（sourceTag）非空且两侧相同时跳过相似合并：同模板的不同事件（如每笔亲属卡消费）
    // 互不吞并，只靠步骤 1 的精确重复强化；与无标签/异标签碎片的合并行为不变
    const inTag = (extra?.sourceTag ?? '') as string;
    const simHit = [...list, ...added]
      .filter((f) => !f.supersededAt && !isMemExpired(f, now) && f.content.length >= 4 && content.length >= 4)
      .filter((f) => !(inTag && f.sourceTag && f.sourceTag === inTag))
      .sort((a, b) => Number(Boolean(a.consumedAt)) - Number(Boolean(b.consumedAt)) || a.createdAt - b.createdAt)
      .find((f) => similarity(f.content, content) >= SIMILAR_MERGE_THRESHOLD);
    if (simHit) {
      if (content.length > simHit.content.length) simHit.content = content;
      simHit.reinforcedAt = now;
      simHit.reinforceCount = (simHit.reinforceCount ?? 0) + 1;
      simHit.weight = higherWeight(simHit.weight, item.weight);
      // 【fix3-a 8】合并时角色归属标注 OR 保留（原条已标 或 合并后的内容带标注都保留）
      if (simHit.hasRoleTag === true || memHasRoleTag(simHit.content) || memHasRoleTag(content)) simHit.hasRoleTag = true;
      // 时间感知（与精确重复同规则）：未手动编辑过 → 新时间保鲜；手动设置过 → 用户优先不覆盖
      if (!simHit.timeEditedAt) {
        if (item.eventTime != null) simHit.eventTime = item.eventTime;
        if (item.expiresAt != null) simHit.expiresAt = item.expiresAt;
      }
      if (!simHit.sourceMsgId && sourceMsgId) simHit.sourceMsgId = sourceMsgId;
      // 溯源字段补齐（动态来源记忆）：点赞/评论同动态连续写入时内容相近会被合并成一条，
      // 合并目标（先写入的那条）若缺溯源字段，用本次传入的补齐——否则删评论时按
      // sourceCommentId 清理会漏掉这条合并碎片（六.3 级联清理依赖这些字段）
      if (extra) {
        if (!simHit.source && extra.source) simHit.source = extra.source;
        if (!simHit.sourcePostId && extra.sourcePostId) simHit.sourcePostId = extra.sourcePostId;
        if (!simHit.sourceKind && extra.sourceKind) simHit.sourceKind = extra.sourceKind;
        if (!simHit.sourceCommentId && extra.sourceCommentId) simHit.sourceCommentId = extra.sourceCommentId;
        if (!simHit.sourceGroupId && extra.sourceGroupId) simHit.sourceGroupId = extra.sourceGroupId;
        if (!simHit.groupMembers && extra.groupMembers) simHit.groupMembers = extra.groupMembers;
      }
      seen.add(normText(simHit.content));
      merged++;
      continue;
    }
    // 3) 全新记忆
    seen.add(key);
    added.push(newItem(content, item));
  }
  if (added.length > 0 || merged > 0 || superseded > 0) {
    // 容量软上限：写入前对合并后的全量做一次择劣淘汰（超出 500 条时优先丢
    // 已消费 → 低权重 → 更早创建的碎片），防止碎片库只增不减无限膨胀
    writeJSON(fragKey(contactId), capFragments([...list, ...added], new Set(added.map((f) => f.id))));
  }
  return { added, merged, superseded };
}

/** 把当前待总结（未被更新/未过期/未消费/未归档）的碎片总结为核心记忆，并标记来源碎片已消费（阈值判断由调用方负责） */
async function summarizePendingIntoCore(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null,
  /** 群聊来源成员显示名（透传总结 prompt：保留其他成员的名字，不强制二人视角） */
  participants?: string[]
): Promise<MemCore> {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const pending = readFragments(contactId).filter(
    (f) =>
      !f.consumedAt &&
      !f.supersededAt &&
      !isMemExpired(f, now) &&
      fadeState(f as FadeInput, forget, now) !== 'faded'
  );
  const { userName, peerName } = namesOf(names);
  const res = await callMemoryApi<SummarizeApiResult>(
    'summarize',
    {
      level: 'core',
      fragments: pending.map((f) => f.content),
      userName,
      peerName,
      ...(participants?.length ? { participants } : {}),
    },
    apiConfig
  );
  const summary = (res.summary || '').trim();
  if (!summary) throw new Error('总结结果为空');
  const core: MemCore = {
    id: uid(),
    contactId,
    content: summary,
    fragmentCount: pending.length,
    sourceIds: pending.map((f) => f.id),
    apps: Array.from(new Set(pending.map((f) => f.app))),
    createdAt: Date.now(),
    // 时间感知：来源碎片中带事件时间的，取最早一条作为核心的事件时间（可选，仅标注用）
    eventTime: (() => {
      const ets = pending.map((f) => f.eventTime).filter((t): t is number => t != null);
      return ets.length > 0 ? Math.min(...ets) : undefined;
    })(),
    // 群聊来源携带（互通与群间隔离过滤用）：混合来源 privateSource=true，纯群聊为 false
    groupIds: Array.from(new Set(pending.map((f) => f.sourceGroupId).filter((g): g is string => !!g))),
    privateSource: pending.some((f) => f.source !== 'group'),
    // 【fix3-a 8】总结 API 可能磨掉「（AI角色本人）/（用户本人）」标注：被消费的碎片任一带标注
    // （显式字段或内容检测），新核心也打标——召回侧 showRoleTagNote 兜底不失效；总结结果自带标注同样算
    ...(pending.some((f) => f.hasRoleTag === true || memHasRoleTag(f.content)) || memHasRoleTag(summary)
      ? { hasRoleTag: true }
      : {}),
  };
  const all = readCores(contactId);
  writeJSON(coreKey(contactId), [...all, core]);
  // 标记来源碎片已消费
  const consumedIds = new Set(core.sourceIds);
  writeJSON(
    fragKey(contactId),
    readFragments(contactId).map((f) => (consumedIds.has(f.id) ? { ...f, consumedAt: Date.now() } : f))
  );
  return core;
}

/** 把当前未归档且未过期的核心记忆总结为一条长期记忆，并标记来源核心已归档（方案A：不重复总结） */
async function summarizeCoresIntoLong(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null,
  /** 群聊来源成员显示名（透传总结 prompt：保留其他成员的名字，不强制二人视角） */
  participants?: string[]
): Promise<MemLongTerm> {
  const now = Date.now();
  const pending = readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now));
  const { userName, peerName } = namesOf(names);
  const res = await callMemoryApi<SummarizeApiResult>(
    'summarize',
    {
      level: 'long',
      fragments: pending.map((m) => m.content),
      userName,
      peerName,
      ...(participants?.length ? { participants } : {}),
    },
    apiConfig
  );
  const summary = (res.summary || '').trim();
  if (!summary) throw new Error('总结结果为空');
  const long: MemLongTerm = {
    id: uid(),
    contactId,
    content: summary,
    coreCount: pending.length,
    sourceIds: pending.map((m) => m.id),
    apps: Array.from(new Set(pending.flatMap((m) => m.apps))),
    createdAt: Date.now(),
    // 群聊来源携带（互通与群间隔离过滤用）：混合来源 privateSource=true，纯群聊为 false
    groupIds: Array.from(new Set(pending.flatMap((m) => m.groupIds ?? []))),
    privateSource: pending.some((m) => m.privateSource !== false),
    // 【fix3-a 8】来源核心任一带角色归属标注（或总结结果自带标注）→ 长期也打标（同 MemCore.hasRoleTag）
    ...(pending.some((m) => m.hasRoleTag === true || memHasRoleTag(m.content)) || memHasRoleTag(summary)
      ? { hasRoleTag: true }
      : {}),
  };
  const all = readLongTerm(contactId);
  writeJSON(longKey(contactId), [...all, long]);
  // 标记来源核心已归档（archivedAt）：召回由长期记忆代表，不再参与后续总结
  const archivedIds = new Set(long.sourceIds);
  writeJSON(
    coreKey(contactId),
    readCores(contactId).map((m) => (archivedIds.has(m.id) ? { ...m, archivedAt: Date.now() } : m))
  );
  return long;
}

/** 检查未消费且未归档的碎片是否达到核心阈值；达到则自动触发核心总结 */
async function maybeAutoSummarize(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null,
  participants?: string[]
): Promise<MemCore | null> {
  if (pendingFragmentCount(contactId) < getMemSettings(contactId).threshold) return null;
  return summarizePendingIntoCore(contactId, apiConfig, names, participants);
}

/** 检查未归档的核心记忆是否达到长期阈值；达到则自动触发长期记忆总结 */
async function maybeAutoLongSummarize(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null,
  participants?: string[]
): Promise<MemLongTerm | null> {
  const { longThreshold } = getMemSettings(contactId);
  if (pendingCoreCount(contactId) < longThreshold) return null;
  return summarizeCoresIntoLong(contactId, apiConfig, names, participants);
}

/** 群聊会话的来源/作用域选项（memAfterAiTurn opts）：群记忆碎片带来源标记，消息计数与私聊分开 */
export interface MemTurnOpts {
  /** 计数隔离作用域（如 `group:<gid>` → mem-msgcount:<cid>:wx:group:<gid>，与私聊计数互不干扰） */
  roundScope?: string;
  /** 群聊来源标记：碎片写 source='group' + sourceGroupId + groupMembers */
  group?: {
    id: string;
    members: string[];
    /** 群成员显示名（供提取 prompt 按实际发言人归因：允许用任意成员名字，不再强制「用户/角色」二人视角） */
    memberNames?: string[];
  };
  /** 【fix3-a 5】场景说明（透传 extract body.scene 供场景注入，如电话/内嵌通话传「语音通话（电话），由机主（用户本人）拨出」）：
   *  提取 prompt 知道对话发生在哪，碎片写明场景归属（「在电话里」），不再丢失通话场景信息 */
  scene?: string;
}

/**
 * 数锚点之后的有效消息条数（消息条数口径：用户消息 + AI 消息都算）。
 * 撤回/失败消息不计；锚点缺失（首次）或丢失（消息被清理/封顶裁剪）时全量计入——宁可多计早触发。
 */
function countSinceAnchor(msgs: unknown[], anchorId?: string): number {
  const valid = msgs.filter((m) => {
    const o = m as { recalled?: unknown; error?: unknown } | null;
    return !(o && typeof o === 'object' && (o.recalled === true || o.error === true));
  });
  if (!anchorId) return valid.length;
  const idx = valid.findIndex((m) => String((m as { id?: unknown } | null)?.id ?? '') === anchorId);
  if (idx < 0) return valid.length;
  return valid.length - 1 - idx;
}

/**
 * 一轮 AI 对话结束后的记忆管线（各聊天 App 的 finalize 成功分支调用）：
 * 1) 按消息条数累计（数锚点之后的新增消息，用户+AI 都算；互通开时四 App 合并到同一计数，
 *    互通关/群聊各会话独立）；2) 达到提取间隔（消息条数）→ 清零并从最近对话提取记忆碎片
 * （后台异步，不阻塞聊天）；3) 碎片积累达到核心阈值 → 自动总结核心记忆；
 * 4) 核心积累达到长期阈值 → 自动总结长期记忆。失败静默（console.warn），不打断聊天。
 * buildConvo 惰性调用：只有真的需要提取时才读取/整理对话文本。
 * getMsgs 惰性调用：返回本会话原始消息数组（增量计数 + 来源消息 ID 用）；
 *   返回 null（电话通话等无持久消息数组的会话）时本轮固定计 2 条（1 用户 + 1 AI）；
 *   返回空数组（会话已清空/群已解散）时直接返回不写任何键（#37：防解散/删除后在途回调
 *   把刚清掉的 mem-msgcount/mem-anchor 键复活）。
 * names：用户真实名字 + 角色名字（视角统一注入提取/总结 prompt；缺省回退固定称呼）。
 * opts：群聊传 roundScope + group（群记忆来源标记，计数与私聊互不干扰）。
 */
export function memAfterAiTurn(
  contactId: string | null,
  app: MemApp,
  apiConfig: ApiConfig,
  buildConvo: () => MemConvoTurn[],
  getMsgs?: () => unknown[] | null,
  names?: MemNames | null,
  opts?: MemTurnOpts
): void {
  if (!contactId) return;
  setMemScopeForApp(app); // 多账号：按当前聊天 App 的账号写记忆
  const scope = opts?.roundScope ? `:${opts.roundScope}` : '';
  try {
    // 时间感知：先把已到期的碎片标记归档（惰性清扫，召回/总结另有实时过滤兜底）
    memSweepExpiry(contactId);
    const { interval, share } = getMemSettings(contactId);
    const cKey = countKey(contactId, app, scope, share);
    const aKey = anchorKey(contactId, app, scope);
    const msgs = getMsgs?.() ?? null;
    // 【#37】消息数组存在但为空（群已解散 loadGroupMsgs 返回 [] / 会话刚被删除清空）：
    // 直接返回且不写任何计数/锚点键——既无数可数，也防止解散/删除后的在途回调把刚清掉的
    // mem-msgcount / mem-anchor 键复活；与「返回 null」（电话通话等无持久消息数组，固定计 2）严格区分
    if (msgs && msgs.length === 0) return;
    let added: number;
    if (msgs) {
      added = countSinceAnchor(msgs, readJSON<string>(aKey) ?? undefined);
      const lastId = memLastMsgId(msgs);
      if (lastId) writeJSON(aKey, lastId);
    } else {
      added = 2; // 无消息数组（电话通话）：本轮固定 1 条用户字幕 + 1 条 AI 回复
    }
    if (added <= 0) return;
    const count = (readJSON<number>(cKey) ?? 0) + added;
    if (count < interval) {
      writeJSON(cKey, count);
      return;
    }
    // 达到间隔：先评估 convo 是否足够；不足（如群聊短会话 convo<4）保留计数等下次不清零，
    // 避免群聊短会话永远到不了 interval 不沉淀记忆（count 已清零但没有足够内容触发提取）
    let convo = buildConvo();
    // 提取使用的来源 App 与群元信息：默认当前会话；跨 App 兜底时改记来源会话
    //（【fix3-a 2d】此前兜底拿了别的 App 的对话却仍按当前 app 提取/入库——来源标注与场景全部张冠李戴）
    let convoApp = app;
    let convoGroup: { id: string; memberNames?: string[] } | null = null;
    // 互通开且当前会话内容太少（合并计数可能主要来自其他 App）：跨 App 取该联系人最近活跃会话
    if (convo.length < 4 && share && !scope) {
      const recent = memMostRecentApp(contactId);
      if (recent && recent.convo.length > convo.length) {
        convo = recent.convo;
        convoApp = recent.app; // 【fix3-a 2d】改用来源会话的 App（场景映射与碎片来源标注都跟真实来源走）
        // 【fix3-a 2d】来源是群聊：participants 传群成员显示名（按实际发言人归因），
        // 碎片补群来源标记（sourceGroupId/groupMembers）；speakerPrefixed 已随轮次透传
        if (recent.group) convoGroup = { id: recent.group.id, memberNames: recent.group.memberNames };
      }
    }
    if (convo.length < 4) {
      // 内容不足：保留计数等下次（不清零），下次达到更多累计时再尝试
      writeJSON(cKey, count);
      return;
    }
    // 内容充足：清零重新累计并异步提取（清零在先避免每轮重试轰炸；提取失败不回滚，下个窗口重新累计）
    writeJSON(cKey, 0);
    const guard = `${contactId}:${app}${scope}`;
    if (inflight.has(guard)) return;
    inflight.add(guard);
    // 看门狗：上游挂起 / 异常未走到 finally 时，90s 后强制清理 inflight，避免永远占着下一窗口
    const watchdog = setTimeout(() => inflight.delete(guard), 90_000);
    void (async () => {
      try {
        // convo 已在外层评估完毕（长度 ≥ 4 才到这里），直接使用
        if (convo.length >= 4) {
          const sourceMsgId = msgs ? memLastMsgId(msgs) : undefined;
          // 群聊轮次成员显示名：优先当前会话的群（opts.group），跨 App 兜底取来源群（fix3-a 2d）
          const participants = opts?.group?.memberNames?.length ? opts.group.memberNames : convoGroup?.memberNames;
          const res = await callMemoryApi<ExtractApiResult>(
            'extract',
            {
              conversation: convo,
              app: convoApp, // 【fix3-a 2d】跨 App 兜底时记来源 App（extract 场景注入与碎片 app 同源）
              existing: existingForConflict(contactId),
              ...namesOf(names),
              // 【fix3-a 5】场景透传（电话/内嵌通话等传入，extract 注入「场景：…」）
              ...(opts?.scene ? { scene: opts.scene } : {}),
              // 群聊轮次：把成员显示名交给提取 prompt——碎片按聊天记录里实际的说话人归因，
              // 其他成员说的话不再被强行归成「用户/角色」二人之一（防跨成员串味进长期记忆）
              ...(participants?.length ? { participants } : {}),
              ...(convoGroup ? { group: { id: convoGroup.id, members: [contactId] } } : {}),
            },
            apiConfig
          );
          const items = normalizeExtract(res);
          if (items.length > 0) {
            // 群聊轮次：碎片带群来源标记（source/sourceGroupId/groupMembers），供互通召回过滤。
            // 【fix3-a 2d】跨 App 兜底拿到群来源 convo 时同样补群标记（此前按私聊入库，归属坍塌）
            const extra = (opts?.group || convoGroup)
              ? {
                  source: 'group' as const,
                  sourceGroupId: opts?.group?.id ?? convoGroup!.id,
                  groupMembers: opts?.group?.members ?? [contactId],
                }
              : undefined;
            appendFragments(contactId, convoApp, items, Date.now(), sourceMsgId, extra);
          }
        }
      } catch (err) {
        console.warn('[memory] 自动提取失败（下个窗口重试）', err);
      }
      // 核心总结与提取相互独立：即使本轮提取失败，只要已积累的未消费碎片达到阈值，
      // 仍应尝试凝结核心记忆（否则一次提取故障会连带把总结也卡到下个窗口）
      try {
        await maybeAutoSummarize(contactId, apiConfig, names, opts?.group?.memberNames);
      } catch (err) {
        console.warn('[memory] 自动总结核心记忆失败（下个窗口重试）', err);
      }
      // 画像图谱提取（Task 14-b B1）：与碎片提取同一节奏（本窗口 convo 已评估充足），
      // 归纳用户稳定画像（喜好/忌讳/习惯/身份/重要日子）；失败完全静默，绝不影响聊天
      try {
        await memProfileAutoExtract(contactId, convo, apiConfig, names);
      } catch (err) {
        console.warn('[memory] 画像提取失败（静默跳过）', err);
      }
      // 长期总结与核心总结相互独立：核心达到长期阈值即触发（失败下个窗口重试）
      try {
        await maybeAutoLongSummarize(contactId, apiConfig, names, opts?.group?.memberNames);
      } catch (err) {
        console.warn('[memory] 自动总结长期记忆失败（下个窗口重试）', err);
      } finally {
        clearTimeout(watchdog);
        inflight.delete(guard);
      }
    })();
  } catch {
    // 记忆是增强能力：任何异常都不影响聊天
  }
}

// ---------------- 手动「立即总结」 ----------------

export interface ManualSummarizeResult {
  /** 新增碎片数 */
  fragments: number;
  /** 新增核心记忆数 */
  cores: number;
  /** 新增长期记忆数 */
  longs: number;
  /** 相似记忆被合并/加强的次数 */
  merged: number;
}

/**
 * 【fix3-a 2e】手动总结（memSummarizeNow / memExtractNow）的可选元信息：
 * 对话来自群聊（memMostRecentApp/memRecentConvo 返回 group 元信息）或特殊场景（通话）时传入，
 * 提取 prompt 才能按实际发言人归因、写明场景，碎片才带群来源标记（否则归属在手动总结链路坍塌）。
 */
export interface MemManualOpts {
  /** 群成员显示名（透传 extract/summarize body.participants：按实际发言人归因，不强制二人视角） */
  participants?: string[];
  /** 群来源标记（id=群 ID；members=群成员角色 ID，落碎片 groupMembers 审计字段） */
  group?: { id: string; members: string[] };
  /** 场景说明（透传 extract body.scene，如「语音通话（电话），由机主（用户本人）拨出」） */
  scene?: string;
}

/** 由 MemManualOpts 拼 extract body 的群/participants/scene 段（memSummarizeNow/memExtractNow 共用） */
function manualOptsBody(opts?: MemManualOpts): Record<string, unknown> {
  if (!opts) return {};
  return {
    ...(opts.participants?.length ? { participants: opts.participants } : {}),
    ...(opts.group ? { group: opts.group } : {}),
    ...(opts.scene ? { scene: opts.scene } : {}),
  };
}

/** 由 MemManualOpts.group 拼碎片群来源 extra（appendFragments extra 参数；无群返回 undefined） */
function manualOptsExtra(opts?: MemManualOpts): { source: 'group'; sourceGroupId: string; groupMembers: string[] } | undefined {
  return opts?.group
    ? { source: 'group' as const, sourceGroupId: opts.group.id, groupMembers: opts.group.members }
    : undefined;
}

/** 手动总结（设置页「全部执行」）：不等 N 轮，立刻整理当前对话并入库（碎片 + 达阈值的核心 + 达阈值的长期） */
export async function memSummarizeNow(
  contactId: string,
  app: MemApp,
  apiConfig: ApiConfig,
  convo: MemConvoTurn[],
  names?: MemNames | null,
  /** 【fix3-a 2e】对话来自群聊/特殊场景时的元信息（调用方从 memMostRecentApp 的 group 字段拼出） */
  opts?: MemManualOpts
): Promise<ManualSummarizeResult> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  setMemScopeForApp(app); // 多账号：手动总结按调用方 App 的当前账号
  inflight.add(guard);
  try {
    if (convo.length < 2) throw new Error('当前没有足够的对话内容可总结');
    const res = await callMemoryApi<ExtractApiResult>(
      'extract',
      { conversation: convo, app, existing: existingForConflict(contactId), ...namesOf(names), ...manualOptsBody(opts) },
      apiConfig
    );
    const items = normalizeExtract(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    // 【fix3-a 2e】群来源对话：碎片带群来源标记（source/sourceGroupId/groupMembers），召回按群隔离/互通过滤
    const { added, merged } = appendFragments(contactId, app, items, Date.now(), undefined, manualOptsExtra(opts));
    if (added.length === 0 && merged === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    let coresCreated = 0;
    let longsCreated = 0;
    const core = await maybeAutoSummarize(contactId, apiConfig, names, opts?.participants).catch(() => null);
    coresCreated = core ? 1 : 0;
    const long = await maybeAutoLongSummarize(contactId, apiConfig, names, opts?.participants).catch(() => null);
    longsCreated = long ? 1 : 0;
    return { fragments: added.length, cores: coresCreated, longs: longsCreated, merged };
  } finally {
    inflight.delete(guard);
  }
}

/**
 * 通话挂断时的自动总结（「通话结束后，自动触发一次总结，提取通话中的关键信息」）：
 * 把整通电话的对话转写交给提取管线入库（碎片 → 达阈值自动核心/长期总结），
 * 与文字聊天共用同一套记忆系统（同池存储、同互通开关、同相似度合并去重——
 * 通话里与之前轮次提取重复的内容自动合并为「加强」而不是重复占位）。
 * 与 memSummarizeNow 的差异：guard 独立（不与手动总结互斥）、内容不足静默返回、
 * 全程失败静默（console.warn）——通话记忆是增强能力，绝不影响挂断收尾。
 * 返回 { added, merged } 供宿主 toast（可忽略）。
 */
export async function memSummarizeCallNow(
  contactId: string,
  app: MemApp,
  apiConfig: ApiConfig,
  convo: MemConvoTurn[],
  names?: MemNames | null,
  /** 【fix3-a 4】通话方向（机主手机视角：'out'=机主拨出，'in'=AI角色拨出）：
   *  拼进 extract body.scene，提取 prompt 知道这是谁拨出的语音通话——通话场景与方向在记忆里不再全丢。
   *  签名变更由 phone.tsx / chat-call.ts 侧传参（本函数尾参向后兼容：不传保持原行为）。
   *  【Task 22 视频通话】media='video' 时场景串写「视频通话（…）」，与语音通话在记忆里可区分。 */
  opts?: { direction?: 'out' | 'in'; media?: 'voice' | 'video' }
): Promise<{ added: number; merged: number }> {
  const guard = `${contactId}:call`;
  if (inflight.has(guard)) return { added: 0, merged: 0 };
  if (convo.length < 2) return { added: 0, merged: 0 }; // 通话太短（<2 轮文本）没有可沉淀的内容
  setMemScopeForApp(app); // 多账号：通话记忆按电话 App 当前账号（匿名号通话记忆独立）
  inflight.add(guard);
  try {
    memSweepExpiry(contactId);
    // 【fix3-a 4】场景串：通话媒体（语音/视频）+ App 名 + 拨出方向（归属视角固定：机主=用户本人，AI角色=AI角色本人）
    const scene =
      `${opts?.media === 'video' ? '视频通话' : '语音通话'}（${MEM_APP_LABEL[app]}）` +
      (opts?.direction === 'out'
        ? '，由机主（用户本人）拨出'
        : opts?.direction === 'in'
          ? '，由AI角色本人拨出'
          : '');
    const res = await callMemoryApi<ExtractApiResult>(
      'extract',
      { conversation: convo, app, existing: existingForConflict(contactId), ...namesOf(names), scene },
      apiConfig
    );
    const items = normalizeExtract(res);
    if (items.length === 0) return { added: 0, merged: 0 };
    const { added, merged } = appendFragments(contactId, app, items, Date.now());
    // 挂断总结后照常走层进管线：碎片积累达阈值 → 核心记忆；核心达阈值 → 长期记忆
    await maybeAutoSummarize(contactId, apiConfig, names).catch(() => null);
    await maybeAutoLongSummarize(contactId, apiConfig, names).catch(() => null);
    return { added: added.length, merged };
  } catch (err) {
    console.warn('[memory] 通话结束自动总结失败（静默）', err);
    return { added: 0, merged: 0 };
  } finally {
    inflight.delete(guard);
  }
}

// ---------------- 手动「立即总结」（碎片页 / 核心页 / 长期页右上角各自独立入口） ----------------

/** 手动提取碎片（碎片页右上角「立即总结」）：只把最近对话整理为记忆碎片入库，不触发核心记忆总结 */
export async function memExtractNow(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null,
  /** 【fix3-a 2e】群/场景元信息：调用方从 memMostRecentApp().group 拿到时传入；
   *  未传时若最近对话本身来自群聊，内部同样会用 recent.group 兜底拼出（保证手动提取不丢群归属） */
  opts?: MemManualOpts
): Promise<{ added: number; merged: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const recent = memMostRecentApp(contactId);
    if (!recent || recent.convo.length < 2) throw new Error('当前没有可总结的对话，先去和TA聊聊吧');
    // 【fix3-a 2e】opts 缺失时从最近对话自带群元信息兜底（最近对话来自群聊 → 按群归因/入库）
    const effective: MemManualOpts =
      opts ??
      (recent.group
        ? { participants: recent.group.memberNames, group: { id: recent.group.id, members: [contactId] } }
        : {});
    const res = await callMemoryApi<ExtractApiResult>(
      'extract',
      {
        conversation: recent.convo,
        app: recent.app,
        existing: existingForConflict(contactId),
        ...namesOf(names),
        ...manualOptsBody(effective),
      },
      apiConfig
    );
    const items = normalizeExtract(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    const { added, merged } = appendFragments(
      contactId,
      recent.app,
      items,
      Date.now(),
      undefined,
      manualOptsExtra(effective)
    );
    if (added.length === 0 && merged === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    return { added: added.length, merged };
  } finally {
    inflight.delete(guard);
  }
}

/** 手动凝结核心记忆（核心记忆页右上角「立即总结」）：不等阈值，把当前待总结碎片立即总结为核心记忆 */
export async function memSummarizeCoreNow(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<{ consumed: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const { forget } = getMemSettings(contactId);
    const now = Date.now();
    const pending = readFragments(contactId).filter(
      (f) => !f.consumedAt && fadeState(f as FadeInput, forget, now) !== 'faded'
    );
    if (pending.length < 2) throw new Error('待总结的记忆碎片不足 2 条，先去和TA聊聊吧');
    const core = await summarizePendingIntoCore(contactId, apiConfig, names);
    return { consumed: core.fragmentCount };
  } finally {
    inflight.delete(guard);
  }
}

/** 手动总结长期记忆（长期记忆页右上角「立即总结」）：不等阈值，把当前未归档核心立即总结为长期记忆 */
export async function memSummarizeLongNow(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<{ consumed: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const now = Date.now();
    const pending = readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now));
    if (pending.length < 2) throw new Error('待总结的核心记忆不足 2 条，先积累一些碎片吧');
    const long = await summarizeCoresIntoLong(contactId, apiConfig, names);
    return { consumed: long.coreCount };
  } finally {
    inflight.delete(guard);
  }
}

// ---------------- 画像图谱（用户画像事实层，Task 14-b B1） ----------------

/**
 * 画像图谱：三层记忆（碎片→核心→长期）之上的结构化「用户画像」事实层。
 * - 存储：mem-profile:<contactId>（IndexedDB kv，与三层记忆同层、同账号作用域后缀）；
 * - 提取：随 memAfterAiTurn 管线按现有提取频率触发（调 /api/memory/profile 服务端 LLM），
 *   只归纳稳定事实（喜好/忌讳/习惯/身份/重要日子），一次性事件/临时安排一律忽略；
 * - 合并：同 contactId+category+topic（归一化后）→ 更新覆盖旧 content（保留最早 createdAt），
 *   而非无限堆叠；单联系人上限 60 条，超出按「低权重 → updatedAt 最旧」淘汰；
 * - 注入：profileRecallBlock 按分类分组紧凑列出，与 memChatRecallBlock 召回块并列注入 system；
 * - 失败静默：画像提取是增强能力，任何失败都不影响聊天主流程。
 */

/** 单联系人画像事实容量上限：超出按「低权重 → updatedAt 最旧」淘汰（防只增不减） */
const MEM_PROFILE_CAP = 60;

/** 画像注入上限与字符预算（facts 多时按 权重→updatedAt 取前 N 条，防止 token 失控） */
const MEM_PROFILE_RECALL_MAX = 20;
const MEM_PROFILE_RECALL_BUDGET = 1100;

/** 画像权重淘汰序（低权重先淘汰）：与 weightEvictRank 同口径 */
function profileWeightRank(w: MemWeight): number {
  return w === 'high' ? 2 : w === 'low' ? 0 : 1;
}

function readProfileFacts(contactId: string): MemProfileFact[] {
  const raw = readJSON<MemProfileFact[]>(profileKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f) =>
      f &&
      typeof f.id === 'string' &&
      typeof f.content === 'string' &&
      typeof f.topic === 'string' &&
      MEM_PROFILE_CATEGORIES.includes(f.category)
  );
}

/** 该联系人的全部画像事实（管理视图用：按分类固定顺序分组，组内 updatedAt 倒序） */
export function listProfileFacts(contactId: string): MemProfileFact[] {
  const rank = (c: MemProfileCategory) => MEM_PROFILE_CATEGORIES.indexOf(c);
  return readProfileFacts(contactId).sort(
    (a, b) => rank(a.category) - rank(b.category) || b.updatedAt - a.updatedAt
  );
}

/** topic 归一化（合并去重键）：去空白 + 小写——「香菜」「 香菜 」「香菜 」同键 */
function profileTopicKey(category: string, topic: string): string {
  return `${category}::${topic.replace(/\s+/g, '').toLowerCase()}`;
}

/** 画像事实写入入参（自动提取与手动整理共用；weight 缺省 normal） */
export interface ProfileFactInput {
  category: MemProfileCategory;
  topic: string;
  content: string;
  weight?: MemWeight;
  /** 来源碎片 id（自动提取时由调用方透传，追溯「这条画像从哪些碎片归纳而来」） */
  sourceFragmentIds?: string[];
}

/**
 * 写入/合并一条画像事实：
 * - 同 contactId + category + topic（归一化后）→ 更新覆盖旧 content（保留最早 createdAt、
 *   权重取高、来源碎片合并去重、刷新 updatedAt）；用户手动编辑过（editedAt）的事实
 *   自动提取不再覆盖 content（与三层记忆 timeEditedAt 同一保护精神）；
 * - 不存在 → 新增；写入后超出 MEM_PROFILE_CAP 时按「低权重 → updatedAt 最旧」淘汰。
 * 返回 { fact, merged }：merged=true 表示走了更新覆盖（UI 提示「已更新」用）。
 */
export function upsertProfileFact(
  contactId: string,
  input: ProfileFactInput
): { fact: MemProfileFact; merged: boolean } | null {
  if (!contactId) return null;
  if (!MEM_PROFILE_CATEGORIES.includes(input.category)) return null;
  const topic = (input.topic ?? '').trim().slice(0, 12);
  const content = (input.content ?? '').trim().slice(0, 60);
  if (!topic || !content) return null;
  const now = Date.now();
  const list = readProfileFacts(contactId);
  const key = profileTopicKey(input.category, topic);
  let idx = list.findIndex((f) => profileTopicKey(f.category, f.topic) === key);
  if (idx < 0) {
    // 跨类别翻转合并（忌口变化：like「辣·能吃微辣」→ dislike「辣·不怎么碰辣」）：
    // 同 topic 在别的分类下已存在 → 视为同一事物的演进，更新那条并改写 category，
    // 避免同关键词新旧两条矛盾画像并存（topic 精确到事物关键词，跨类同键几乎必为演进）
    idx = list.findIndex((f) => f.topic.replace(/\s+/g, '').toLowerCase() === topic.replace(/\s+/g, '').toLowerCase());
    if (idx >= 0) list[idx].category = input.category;
  }
  if (idx >= 0) {
    const hit = list[idx];
    if (hit.editedAt == null) hit.content = content; // 手动编辑过：只刷新时间不覆盖内容
    hit.weight = higherWeight(hit.weight, input.weight ?? 'normal');
    hit.updatedAt = now;
    if (input.sourceFragmentIds?.length) {
      const mergedIds = Array.from(new Set([...(hit.sourceFragmentIds ?? []), ...input.sourceFragmentIds]));
      hit.sourceFragmentIds = mergedIds.slice(-8); // 只留最近 8 个来源，防无限膨胀
    }
    writeJSON(profileKey(contactId), list);
    return { fact: hit, merged: true };
  }
  const fact: MemProfileFact = {
    id: uid(),
    contactId,
    category: input.category,
    topic,
    content,
    weight: input.weight ?? 'normal',
    createdAt: now,
    updatedAt: now,
    ...(input.sourceFragmentIds?.length ? { sourceFragmentIds: input.sourceFragmentIds.slice(-8) } : {}),
  };
  list.push(fact);
  if (list.length > MEM_PROFILE_CAP) {
    // 容量淘汰：排序副本算出淘汰集合，过滤后写回（不改变原数组相对顺序的书写习惯）
    const byEvict = [...list].sort(
      (a, b) => profileWeightRank(a.weight) - profileWeightRank(b.weight) || a.updatedAt - b.updatedAt
    );
    const evict = new Set(byEvict.slice(0, list.length - MEM_PROFILE_CAP).map((f) => f.id));
    writeJSON(profileKey(contactId), list.filter((f) => !evict.has(f.id)));
  } else {
    writeJSON(profileKey(contactId), list);
  }
  return { fact, merged: false };
}

/** 手动编辑画像事实内容（编辑后自动提取不再覆盖该条 content） */
export function updateProfileFact(contactId: string, id: string, content: string): boolean {
  const list = readProfileFacts(contactId);
  const hit = list.find((f) => f.id === id);
  const t = content.trim().slice(0, 80);
  if (!hit || !t) return false;
  hit.content = t;
  hit.editedAt = Date.now();
  hit.updatedAt = hit.editedAt;
  writeJSON(profileKey(contactId), list);
  return true;
}

export function deleteProfileFact(contactId: string, id: string): boolean {
  const list = readProfileFacts(contactId);
  const next = list.filter((f) => f.id !== id);
  if (next.length === list.length) return false;
  writeJSON(profileKey(contactId), next);
  return true;
}

/**
 * 画像注入块（聊天 system 用，与 memChatRecallBlock 召回块并列注入）：
 * 按分类分组、每条一行紧凑列出（如「- 忌讳：不吃香菜」「- 习惯：熬夜到凌晨 1 点」），
 * 让 TA 在聊天中自然引用用户习惯/喜好/忌讳（「你不是不吃香菜嘛」）。
 * - facts 多时先按 权重→updatedAt 取前 MEM_PROFILE_RECALL_MAX 条，字符预算兜底裁剪；
 * - 无事实/任何异常返回空串（注入处 filter(Boolean)，零成本零风险）。
 */
export function profileRecallBlock(contactId: string): string {
  try {
    if (!contactId) return '';
    const picked = readProfileFacts(contactId)
      .sort((a, b) => profileWeightRank(b.weight) - profileWeightRank(a.weight) || b.updatedAt - a.updatedAt)
      .slice(0, MEM_PROFILE_RECALL_MAX);
    if (picked.length === 0) return '';
    const lines: string[] = [
      '【你了解的用户画像（长期稳定的事实；聊天时自然运用：记得对方的喜好/忌讳/习惯/身份/重要日子，比如点菜时想起忌口、问候时想起作息；不要逐条罗列复述，也不要说「资料」「档案」这类话）】',
    ];
    let budget = MEM_PROFILE_RECALL_BUDGET;
    for (const cat of MEM_PROFILE_CATEGORIES) {
      for (const f of picked.filter((x) => x.category === cat)) {
        const row = `- ${MEM_PROFILE_CATEGORY_LABEL[cat]}：${f.content}`;
        if (row.length + 1 > budget) continue; // 预算兜底（正常到不了：条数闸已拦住大半）
        budget -= row.length + 1;
        lines.push(row);
      }
    }
    return lines.length > 1 ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

// 画像提取（服务端 LLM：/api/memory/profile）

/** profile 接口返回的单条画像事实（归一化前） */
interface ProfileApiItem {
  category?: unknown;
  topic?: unknown;
  content?: unknown;
  weight?: unknown;
}

interface ProfileApiResult {
  facts?: ProfileApiItem[];
  error?: string;
}

/** 防并发：同一联系人画像提取进行中时跳过新触发（独立于三层总结的 inflight） */
const profileInflight = new Set<string>();

/** 归一化 profile 接口返回：非法分类/空白 topic/content 丢弃，单次最多 6 条 */
function normalizeProfileFacts(res: ProfileApiResult): ProfileFactInput[] {
  const raw = Array.isArray(res.facts) ? res.facts : [];
  const out: ProfileFactInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as ProfileApiItem;
    const topic = typeof o.topic === 'string' ? o.topic.trim().slice(0, 12) : '';
    const content = typeof o.content === 'string' ? o.content.trim().slice(0, 60) : '';
    if (!topic || !content) continue;
    if (
      typeof o.category !== 'string' ||
      !MEM_PROFILE_CATEGORIES.includes(o.category as MemProfileCategory)
    )
      continue;
    out.push({
      category: o.category as MemProfileCategory,
      topic,
      content,
      weight: o.weight === 'high' || o.weight === 'low' || o.weight === 'normal' ? o.weight : autoWeight(content),
    });
  }
  return out.slice(0, 6);
}

/** 画像提取请求体（自动与手动共用）：已画像作为「更新对照」传给模型，同一事物的变化沿用旧 topic 才能覆盖旧值 */
function profileRequestBody(contactId: string, convo: MemConvoTurn[], names?: MemNames | null): Record<string, unknown> {
  const existing = readProfileFacts(contactId)
    .slice(-40)
    .map((f) => ({ category: f.category, topic: f.topic, content: f.content }));
  return {
    conversation: convo.slice(-30),
    ...(existing.length > 0 ? { existing } : {}),
    ...namesOf(names),
  };
}

/**
 * 画像自动提取（memAfterAiTurn 管线挂钩）：按现有提取频率（提取窗口触发时）调一次
 * /api/memory/profile，从最近对话归纳用户稳定画像并合并入库。
 * 失败抛错由调用方 console.warn 静默——画像提取是增强能力，绝不阻塞聊天。
 * 返回写入条数（新增+更新）。
 */
async function memProfileAutoExtract(
  contactId: string,
  convo: MemConvoTurn[],
  apiConfig: ApiConfig,
  names?: MemNames | null
): Promise<number> {
  if (!contactId || convo.length < 4) return 0;
  const guard = `${contactId}:profile`;
  if (profileInflight.has(guard)) return 0;
  profileInflight.add(guard);
  try {
    const res = await callMemoryApi<ProfileApiResult>('profile', profileRequestBody(contactId, convo, names), apiConfig);
    const items = normalizeProfileFacts(res);
    let n = 0;
    for (const it of items) {
      if (upsertProfileFact(contactId, it)) n++;
    }
    return n;
  } finally {
    profileInflight.delete(guard);
  }
}

/**
 * 手动「立即提取画像」（记忆库画像 Tab 按钮）：取该联系人最近有对话的 App，当场归纳画像事实。
 * 与 memExtractNow 同款交互：没有可用对话/提炼不出内容时抛错（UI toast 显示）。
 */
export async function memProfileExtractNow(
  contactId: string,
  apiConfig: ApiConfig,
  names?: MemNames | null
): Promise<{ added: number; merged: number }> {
  const guard = `${contactId}:profile-manual`;
  if (profileInflight.has(guard)) throw new Error('正在提取画像，请稍候');
  profileInflight.add(guard);
  try {
    const recent = memMostRecentApp(contactId);
    if (!recent || recent.convo.length < 2) throw new Error('当前没有可总结的对话，先去和TA聊聊吧');
    const res = await callMemoryApi<ProfileApiResult>('profile', profileRequestBody(contactId, recent.convo, names), apiConfig);
    const items = normalizeProfileFacts(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的画像事实');
    let added = 0;
    let merged = 0;
    for (const it of items) {
      const r = upsertProfileFact(contactId, it);
      if (r) {
        if (r.merged) merged++;
        else added++;
      }
    }
    if (added === 0 && merged === 0) throw new Error('这次对话没有提炼出新的画像事实');
    return { added, merged };
  } finally {
    profileInflight.delete(guard);
  }
}

// ---------------- 手动「整理重复记忆」 ----------------

/**
 * 全库去重整理（设置页按钮）：两两扫描该联系人全部碎片，相似（≥0.6）的合并为一条。
 * 保留更早创建的为正本（若另一条已入核心则保留已入核心者），内容取更完整的、
 * 权重取更高、加强次数累加、加强时间取较新。返回合并掉的条数。
 */
export function memDedupeNow(contactId: string): number {
  let list = readFragments(contactId);
  const before = list.length;
  // 预算上限：碎片过多时只对前 200 条做两两比较，避免 O(n²×合并次数)≈O(n³) 卡顿；
  // 超出 200 条的部分原样保留（下次调用或下次新增自然处理）
  const BUDGET = 200;
  // 已入核心者优先保留、其次更早创建者优先：先排序，靠前的成为正本候选
  const working = list.slice(0, BUDGET);
  const tail = list.slice(BUDGET);
  working.sort((a, b) => {
    const ca = Number(Boolean(a.consumedAt));
    const cb = Number(Boolean(b.consumedAt));
    if (ca !== cb) return cb - ca; // 已入核心排前面（保留方）
    return a.createdAt - b.createdAt; // 更早创建排前面
  });
  const removed = new Set<string>();
  // 单次两两比较：i < j，i 在前为正本候选；命中相似把 j 合并进 i 并把 j 标记删除
  for (let i = 0; i < working.length; i++) {
    const a = working[i];
    if (removed.has(a.id)) continue;
    if (!a.content || a.content.length < 4) continue;
    for (let j = i + 1; j < working.length; j++) {
      const b = working[j];
      if (removed.has(b.id)) continue;
      if (!b.content || b.content.length < 4) continue;
      // 同源事件标签（sourceTag）相同的不同事件互不合并（同 appendFragments 步骤 2 的豁免口径）
      if (a.sourceTag && b.sourceTag && a.sourceTag === b.sourceTag) continue;
      if (similarity(a.content, b.content) < SIMILAR_MERGE_THRESHOLD) continue;
      // 正本 a（已入核心且靠前者，由上面排序保证）；副本 b 合并进 a
      const keep = a;
      const drop = b;
      if (drop.content.length > keep.content.length) keep.content = drop.content;
      keep.weight = higherWeight(keep.weight, drop.weight);
      // 时间感知（手动优先）：正本未被手动编辑时从副本补齐缺失的时间字段；
      // 副本被手动编辑过则把时间连同标记一并继承（合并体继续受用户设置保护）
      if (!keep.timeEditedAt) {
        if (keep.eventTime == null && drop.eventTime != null) keep.eventTime = drop.eventTime;
        if (keep.expiresAt == null && drop.expiresAt != null) keep.expiresAt = drop.expiresAt;
        if (drop.timeEditedAt) keep.timeEditedAt = drop.timeEditedAt;
      }
      keep.reinforceCount = (keep.reinforceCount ?? 0) + 1 + (drop.reinforceCount ?? 0);
      keep.reinforcedAt = Math.max(keep.reinforcedAt ?? 0, drop.reinforcedAt ?? 0);
      keep.sourceMsgId = keep.sourceMsgId ?? drop.sourceMsgId;
      keep.consumedAt = keep.consumedAt ?? drop.consumedAt;
      // 【fix3-a 8】全库去重合并同样 OR 保留角色归属标注（任一侧带标注都保留）
      if (keep.hasRoleTag === true || drop.hasRoleTag === true || memHasRoleTag(drop.content) || memHasRoleTag(keep.content))
        keep.hasRoleTag = true;
      removed.add(drop.id);
    }
  }
  if (removed.size === 0) return 0;
  list = [...working.filter((f) => !removed.has(f.id)), ...tail];
  writeJSON(fragKey(contactId), list);
  return before - list.length;
}

// ---------------- 视角修复（旧版「对方/用户」代称 → 真实名字） ----------------

/** 同义反复短语：「小晨叫小晨 / 小晨名叫小晨 / 小晨的名字是小晨」等（名字身份事实无信息量） */
function tautologyClause(name: string): RegExp {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${n}(?:叫|名叫|名字叫|的名字是|名字是)${n}[，,、]?`, 'g');
}

/**
 * 修复旧记忆的视角混乱（设置页按钮）：把碎片/核心/长期里「对方」替换为角色名字、「用户」
 * 替换为用户真实名字（旧版提取器固定用这两个代称，语义明确可安全替换）。
 * 只替换提供了对应名字的代称（名字缺失时代称保留，避免产生无主语碎片）；
 * 「我/你/TA」等代称语义不明不自动替换（可手动编辑）。
 * 同义反复清理：「用户叫小晨」→「小晨叫小晨」这类名字身份短语直接剥掉（已由全库用名隐含），
 * 剥完为空的条目删除。返回各层修复条数（含删除）。
 * 【fix3-a 10】两处误伤防护：①「」引号内是聊天原文引用（如「对方说：今晚不去了」），
 * 代称替换/短语清理只在引号外进行，绝不动引号内原文；②source==='moments' 的碎片整条跳过
 * （朋友圈句式里的「用户」有专门语义，身份修复由 repairMomentIdentityData 专管，不在此误改）。
 */
export function memRepairPerspectiveNow(
  contactId: string,
  names?: MemNames | null
): { frags: number; cores: number; longs: number } {
  const { userName, peerName } = namesOf(names);
  const hasUser = Boolean((names?.user ?? '').trim());
  const hasPeer = Boolean((names?.peer ?? '').trim());
  if (!hasUser && !hasPeer) return { frags: 0, cores: 0, longs: 0 };
  // 引号外的普通段落：代称替换 + 同义反复清理（原 fix 逻辑，仅作用于引号外）
  const fixPlain = (seg: string): string => {
    let out = seg;
    if (hasPeer) out = out.replace(/对方/g, peerName);
    if (hasUser) out = out.replace(/用户/g, userName);
    // 同义反复清理：「用户叫小晨」替换后变成「小晨叫小晨」，名字身份事实已由全库用名隐含，
    // 直接剥掉该短语（拆不出有效内容则整条删除）
    return out
      .replace(tautologyClause(userName), '')
      .replace(tautologyClause(peerName), '')
      .replace(/^[，,。、；;\s]+/, '')
      .replace(/[，,\s]+$/, '');
  };
  // 【fix3-a 10】按「」引号切段（带捕获组的 split：奇数下标=引号内原文，原样保留），
  // 只对引号外段落做替换；未闭合的「 无匹配段，整段按引号外处理（与旧行为一致）
  const fix = (content: string): string =>
    content
      .split(/(「[^」]*」)/g)
      .map((seg, i) => (i % 2 === 1 ? seg : fixPlain(seg)))
      .join('');
  /** 三层通用：替换 + 剥掉清空后为空的条目（返回修复条数） */
  const fixLayer = <T extends { content: string }>(list: T[]): { next: T[]; fixed: number } => {
    let fixed = 0;
    const out: T[] = [];
    for (const item of list) {
      const repaired = fix(item.content);
      if (repaired !== item.content) {
        fixed++;
        if (repaired) out.push({ ...item, content: repaired, editedAt: Date.now() });
      } else {
        out.push(item);
      }
    }
    return { next: out, fixed };
  };
  // 碎片（【fix3-a 10】朋友圈/QQ动态来源碎片整条跳过：身份修复由 repairMomentIdentityData 专管；
  // 跳过项原位保留，不打乱原数组顺序；剥空删除/原位修复与 fixLayer 同语义，此处单独展开以便按条跳过）
  const fragList = readFragments(contactId);
  const fragNext: MemFragment[] = [];
  let fragFixed = 0;
  for (const f of fragList) {
    if (f.source === 'moments') {
      fragNext.push(f);
      continue;
    }
    const repaired = fix(f.content);
    if (repaired !== f.content) {
      fragFixed++;
      if (repaired) fragNext.push({ ...f, content: repaired, editedAt: Date.now() });
    } else {
      fragNext.push(f);
    }
  }
  if (fragFixed > 0) writeJSON(fragKey(contactId), fragNext);
  // 核心
  const coreRes = fixLayer(readCores(contactId));
  if (coreRes.fixed > 0) writeJSON(coreKey(contactId), coreRes.next);
  // 长期
  const longRes = fixLayer(readLongTerm(contactId));
  if (longRes.fixed > 0) writeJSON(longKey(contactId), longRes.next);
  return { frags: fragFixed, cores: coreRes.fixed, longs: longRes.fixed };
}

// ---------------- 来源追溯 ----------------

/** 从原始消息数组取最后一条有效消息的 id（来源追溯用；拿不到返回 undefined） */
export function memLastMsgId(msgs: unknown[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { id?: unknown; recalled?: unknown; error?: unknown } | null;
    if (!m || typeof m !== 'object') continue;
    if (m.recalled === true || m.error === true) continue;
    if (typeof m.id === 'string' && m.id) return m.id;
    if (typeof m.id === 'number') return String(m.id);
  }
  return undefined;
}

// ---------------- 对话文本整理（从各 App 的原始消息数组提取问答对） ----------------

/** 通用消息形状（各 App 消息的字段子集；卡片类映射为短标签，保证提取器可读） */
interface RawishMsg {
  role?: unknown;
  content?: unknown;
  kind?: unknown;
  text?: unknown;
  recalled?: unknown;
  error?: unknown;
  loc?: unknown;
  /** kind='voice'：语音消息数据（transcript=STT 转写 / localText=朗读原文，wx/qq/sms 同构） */
  voice?: unknown;
  /** kind='image'：图片消息数据（desc=识图描述，旧记录无此字段照常兼容） */
  img?: unknown;
  /** kind='sticker'：表情消息数据（meaning=含义） */
  stk?: unknown;
  /** 【fix3-a 9】kind='redpacket'：红包卡片数据（wechat.tsx WxRpData：amount/blessing/opened/status） */
  rp?: unknown;
  /** 【fix3-a 9】kind='transfer'：转账卡片数据（WxTrData：amount/note/received/status/refundedBy） */
  tr?: unknown;
  /** 【fix3-a 9】kind='family'：亲属卡卡片数据（WxFamData：monthlyLimit/relation/message/claimed/rejected） */
  fam?: unknown;
  /** 【39】好友添加过程标记（wx/qq 同构）：apply=用户验证消息 / greet=AI 打招呼 / added=加好友成功提示
   *  ——验证消息线程是「加好友流程」不是聊天记忆素材（第三十九轮：修复验证消息被 extract 提炼入库，
   *  如「凡凡自称Z」这类来自验证消息对话的脏记忆） */
  fr?: unknown;
  /** 【39】系统提示行数据（wx/qq kind='sys' 携带；sms 无 kind 直接带 sys 字段）——系统提示不进记忆素材 */
  sys?: unknown;
}

/**
 * 卡片类消息的记忆标签。
 * 【fix3-a 9】私聊红包/转账/亲属卡此前是裸标签「[红包]/[转账]/[亲属卡]」——提取器不知道金额、
 * 祝福语/备注、领取状态，沉淀出的记忆全是「发了个红包」这类无信息碎片，也无法写清谁领了谁退了。
 * 升级（字段名与取值域已对照 wechat.tsx WxRpData/WxTrData/WxFamData 实码）：
 * - redpacket → [红包 ¥88 "祝福语"，已领取/待领取/已退回/已拒收]；
 * - transfer  → [转账 ¥200 "备注"，已收款/待收款/已退回/已拒收]；
 * - family    → [亲属卡（每月额度¥X，关系，留言「…」，已领取/待领取/已退回）]；
 * 字段缺失/旧数据/解析异常时回退现有裸标签，绝不抛错。群聊侧富标签口径（memGroupMsgText）已正确，勿动。
 */
function cardLabel(m: RawishMsg): string | null {
  // 礼物卡片（第 20 轮；第七轮补方向）：带礼物名、送礼方向与收下状态进记忆
  //（此前无方向，沉淀的记忆分不清谁送谁，AI 会把机主送的礼物说成自己送的）
  if (m.kind === 'giftcard') {
    const g = (m as Record<string, unknown>).gift;
    const name = g && typeof g === 'object' && typeof (g as Record<string, unknown>).name === 'string' ? (g as Record<string, unknown>).name as string : '';
    const accepted = !!(g && typeof g === 'object' && (g as Record<string, unknown>).accepted);
    if (!name) return '[礼物]';
    return m.role === 'me'
      ? `[礼物 ${name}，我送的，对方${accepted ? '已收下' : '待收下'}]`
      : `[礼物 ${name}，TA送的，我${accepted ? '已收下' : '待收下'}]`;
  }
  const bare =
    m.kind === 'redpacket' ? '[红包]' : m.kind === 'transfer' ? '[转账]' : m.kind === 'family' ? '[亲属卡]' : null;
  if (!bare) return null;
  try {
    if (m.kind === 'redpacket') {
      const rp = m.rp && typeof m.rp === 'object' ? (m.rp as Record<string, unknown>) : null;
      if (!rp || typeof rp.amount !== 'number' || !Number.isFinite(rp.amount)) return bare;
      const blessing = typeof rp.blessing === 'string' ? rp.blessing.trim() : '';
      const state =
        rp.status === 'returned'
          ? '已退回'
          : rp.status === 'rejected'
            ? '已拒收'
            : rp.opened === true
              ? '已领取'
              : '待领取';
      return `[红包 ¥${rp.amount}${blessing ? ` "${blessing}"` : ''}，${state}]`;
    }
    if (m.kind === 'transfer') {
      const tr = m.tr && typeof m.tr === 'object' ? (m.tr as Record<string, unknown>) : null;
      if (!tr || typeof tr.amount !== 'number' || !Number.isFinite(tr.amount)) return bare;
      const note = typeof tr.note === 'string' ? tr.note.trim() : '';
      const state =
        tr.received === true
          ? '已收款'
          : tr.status === 'returned' || tr.refundedBy
            ? '已退回'
            : tr.status === 'rejected'
              ? '已拒收'
              : '待收款';
      return `[转账 ¥${tr.amount}${note ? ` "${note}"` : ''}，${state}]`;
    }
    // family：保留 [亲属卡] 前缀，尽量带上说明字段（每月额度/关系/留言/状态）；无 fam 回退裸标签
    const fam = m.fam && typeof m.fam === 'object' ? (m.fam as Record<string, unknown>) : null;
    if (!fam || typeof fam.monthlyLimit !== 'number' || !Number.isFinite(fam.monthlyLimit)) return bare;
    const relation = typeof fam.relation === 'string' ? fam.relation.trim() : '';
    const message = typeof fam.message === 'string' ? fam.message.trim() : '';
    const state = fam.rejected === true ? '已退回' : fam.claimed === true ? '已领取' : '待领取';
    return `[亲属卡（每月额度¥${fam.monthlyLimit}${relation ? `，${relation}` : ''}${message ? `，留言「${message}」` : ''}，${state}）]`;
  } catch {
    return bare;
  }
}

/** 图片消息的记忆标签：识图 desc 有值时带「图片内容」（与群聊 memGroupMsgText 同口径，旧记录无 desc 照常兼容） */
function imageLabel(img: unknown): string {
  const d =
    img && typeof img === 'object' && typeof (img as { desc?: unknown }).desc === 'string'
      ? (img as { desc: string }).desc.trim()
      : '';
  return d ? `[图片]（图片内容：${d}）` : '[图片]';
}

/** 语音消息的记忆标签：转写优先（stt 完成后可读），其次朗读原文（AI 语音消息/文字转语音同源冗余）；
 *  都识别不出用 [语音] 占位（与群聊 memGroupMsgText 同口径，语音不再整条丢弃） */
function voiceLabel(voice: unknown): string {
  const v = voice && typeof voice === 'object' ? (voice as { transcript?: unknown; localText?: unknown }) : null;
  const transcript = typeof v?.transcript === 'string' ? v.transcript.trim() : '';
  const localText = typeof v?.localText === 'string' ? v.localText.trim() : '';
  return transcript || localText || '[语音]';
}

/** 表情消息的记忆标签：meaning 有值时并入（与群聊 memGroupMsgText 同口径） */
function stickerLabel(stk: unknown): string {
  const d =
    stk && typeof stk === 'object' && typeof (stk as { meaning?: unknown }).meaning === 'string'
      ? (stk as { meaning: string }).meaning.trim()
      : '';
  return d ? `[表情] ${d}` : '[表情]';
}

/** 位置消息的记忆标签：带地点名/地址（提取器能记住“用户去过哪/在哪”，后续聊天可引用）；解析不出地名回退 [位置] */
function locLabelOf(loc: unknown): string {
  if (!loc || typeof loc !== 'object') return '[位置]';
  const o = loc as { name?: unknown; address?: unknown; addr?: unknown };
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return '[位置]（无法识别该位置）';
  const addr = typeof o.address === 'string' ? o.address.trim() : typeof o.addr === 'string' ? o.addr.trim() : '';
  return `[发送了位置「${name}」${addr && addr !== name ? `（${addr}）` : ''}]`;
}

/**
 * 错误占位文案过滤（双保险）：单聊流失败/空回复会落「〔AI 服务暂时不可用…〕」「〔对方暂时没有回复，
 * 请稍后再试〕」这类占位消息（并行修复会给新占位补 error:true，旧数据可能漏标）——
 * 与聊天历史构建的过滤同口径（wechat.tsx 历史映射同样剥这三类前缀）；
 * 整段「〔…〕」括号占位也被 〔 前缀覆盖。占位消息不进记忆素材，防止沉淀出
 * 「TA 说对方暂时没有回复」这类脏碎片。
 */
function isMemErrPlaceholder(text: string): boolean {
  const t = text.trim();
  return t.startsWith('〔') || t.startsWith('（AI') || t.startsWith('（对方暂时');
}

/** 把任意 App 的消息数组整理成 {role, text} 问答对（撤回/失败/错误占位剔除）。
 *  富媒体与群聊 memGroupMsgText 同口径：语音带转写、图片带识图描述、表情带含义、位置带地名；
 *  其余卡片类映射为短标签，保证提取器可读。
 *  【39】好友验证消息（fr=apply/greet/added）与系统提示（kind='sys' / sms 的 sys 字段）不进记忆素材：
 *  - 验证消息是「加好友流程」对话（打招呼/身份核验），沉淀成记忆会产生「凡凡自称Z」这类脏碎片，
 *    且申请通过后正常聊天才是记忆素材的真实来源；
 *  - 系统提示（拉黑/换头像/拍照中…）是状态播报，wx/qq/sms 的 sys 行 content 本就为空（天然被
 *    空文本过滤跳过），这里再加显式条件双保险（防未来 sys 行带文案）
 *  【100-c】通话/群邀请/拉黑申请三类卡片（kind='call'/'groupcard'/'blockreq'）也不进素材：
 *  - 通话卡片 content 是第一人称通话摘要（「[语音通话：我打给你…]」），混进对话提取会造成
 *    视角错乱；通话记忆由专门链路负责（chat-call 通话转写提取/挂断总结、phone 事件碎片），
 *    不走对话提取，这里过滤掉避免同一通电话双轨重复入库；
 *  - 群邀请卡/拉黑申请卡是纯系统动作卡片（content 恒为空，此前只靠空文本巧合挡住），显式跳过。 */
export function memConvoFromRaw(msgs: unknown[], peerName: string): MemConvoTurn[] {
  const out: MemConvoTurn[] = [];
  for (const raw of msgs) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as RawishMsg;
    if (m.recalled === true || m.error === true) continue;
    if (m.fr === 'apply' || m.fr === 'greet' || m.fr === 'added') continue; // 【39】验证消息不入记忆
    if (m.kind === 'sys' || (m.sys && typeof m.sys === 'object')) continue; // 【39】系统提示不入记忆
    if (m.kind === 'call' || m.kind === 'groupcard' || m.kind === 'blockreq') continue; // 【100-c】通话/群邀请/拉黑申请卡片不入素材（通话走事件链路，见上方注释）
    const label =
      m.kind === 'location'
        ? locLabelOf(m.loc)
        : m.kind === 'voice'
          ? voiceLabel(m.voice)
          : m.kind === 'image'
            ? imageLabel(m.img)
            : m.kind === 'sticker'
              ? stickerLabel(m.stk)
              : cardLabel(m);
    const text =
      label ??
      ((typeof m.content === 'string' ? m.content.trim() : '') ||
        (typeof m.text === 'string' ? m.text.trim() : ''));
    if (!text || isMemErrPlaceholder(text)) continue;
    const isMe = m.role === 'me' || m.role === 'user';
    out.push({ role: isMe ? 'me' : 'peer', text: text.slice(0, 400) });
  }
  void peerName;
  return out.slice(-60);
}

/** 【#23】群消息进记忆的文本快照：content 优先，富媒体 kind 给占位（口径与群聊页构建 AI 上下文一致，能省则省） */
function memGroupMsgText(m: WxGroupMsg): string {
  if (m.kind === 'image') return m.img?.desc ? `[图片]（图片内容：${m.img.desc}）` : '[图片]';
  // 语音：转写优先（stt 完成后可读），其次朗读原文（AI 语音消息同源冗余）；都识别不出用占位
  if (m.kind === 'voice') return m.voice?.transcript || m.voice?.localText || '[语音]';
  if (m.kind === 'sticker') return m.stk?.meaning ? `[表情] ${m.stk.meaning}` : '[表情]';
  // 位置：带地名进记忆（与私聊 memConvoFromRaw 的 locLabelOf 同口径，提取器能记住「去过哪」）
  if (m.kind === 'location') return locLabelOf(m.loc);
  if (m.kind === 'redpacket') return '[红包]';
  if (m.kind === 'transfer') return '[转账]';
  if (m.kind === 'forward') {
    const brief = m.content.trim();
    return m.fwd?.merged ? '[聊天记录]' : brief ? `[转发] ${brief}` : '[转发]';
  }
  return m.content.trim();
}

/**
 * 【#23】读某个联系人在 wx/qq 群聊里的最近对话（修复「记忆库手动立即总结不认群消息」：
 * 此前只读私聊 kv，只在群里聊过的角色点「立即总结」永远提示没有可总结的对话）。
 * 遍历该 App 全部群（listGroups），找 memberIds 含该联系人的群（ownerId 兜底防转让后数据缺员），
 * 取「最后一条消息时间最新」的那个群；过滤 notice 系统行与撤回（与群聊页构建 AI 上下文同口径），
 * 映射为 MemConvoTurn[]：机主消息 → role 'me'；成员消息 → role 'peer' 且文本带「发言人：」前缀
 * （群聊按实际发言人归因，与 Task 23 #12 的群记忆口径一致），逐条带 speakerPrefixed=true
 * （【fix3-a 2a】群来源对话经手动总结/跨App兜底进提取时不再叠 peerName 前缀）；空文本条目跳过；
 * 最多 60 条，与私聊 memConvoFromRaw 截尾同口径。
 * 返回 ts = 该群最后一条消息时间（memMostRecentApp 里与私聊同台竞选）；
 * group = 来源群元信息（【fix3-a 2b】id=群 ID；memberNames=本段对话里实际发言过的群成员显示名，
 * 按首次出现顺序去重——从消息 senderName 取，天然不含机主，且与聊天记录前缀里的发言人一一对应，
 * 提取 prompt 的 participants 名单据此归因；联系人是异步库，同步链路取不到全量名单，以实际发言人为准）；
 * 无可用群返回 null。
 */
function memRecentGroupConvo(
  contactId: string,
  app: 'wx' | 'qq'
): { convo: MemConvoTurn[]; ts: number; group: { id: string; memberNames: string[] } } | null {
  try {
    let best: { ts: number; msgs: WxGroupMsg[]; id: string } | null = null;
    for (const g of listGroups(app)) {
      if (!g.memberIds.includes(contactId) && g.ownerId !== contactId) continue;
      const msgs = loadGroupMsgs(g.id);
      if (msgs.length === 0) continue;
      const ts = msgs[msgs.length - 1]?.time ?? 0;
      if (!best || ts > best.ts) best = { ts, msgs, id: g.id };
    }
    if (!best) return null;
    const convo: MemConvoTurn[] = [];
    const memberNames: string[] = [];
    for (const m of best.msgs) {
      if (m.kind === 'notice' || m.recalled === true) continue; // 系统行/撤回剔除（群聊页同口径）
      const text = memGroupMsgText(m).slice(0, 400);
      if (!text) continue;
      if (m.role === 'me') {
        convo.push({ role: 'me', text });
      } else {
        // 成员消息：文本带「发言人：」前缀 + speakerPrefixed=true（fix3-a 2a，extract 不再叠前缀）
        convo.push({ role: 'peer', text: `${m.senderName || '成员'}：${text}`, speakerPrefixed: true });
        // 【fix3-a 2b】成员显示名（不含机主）：从 senderName 收集（与聊天记录前缀一一对应）
        const nm = (m.senderName || '').trim();
        if (nm && nm !== '成员' && !memberNames.includes(nm) && memberNames.length < 30) memberNames.push(nm);
      }
    }
    return { convo: convo.slice(-60), ts: best.ts, group: { id: best.id, memberNames } };
  } catch {
    return null;
  }
}

/** 读取某个联系人在指定 App 的最近对话（手动「立即总结」用；电话通话不留全文，返回空）。
 *  【#23】私聊没有可用对话时回退该联系人的群聊（仅 wx/qq 有群聊概念；sms/phone 维持原样）。
 *  【fix3-a 2c】群兜底分支透传：轮次携带 speakerPrefixed（发言人前缀归属信息不丢）；
 *  群元信息（id/memberNames）需要 group 字段的调用方请改用 memMostRecentApp（返回值带 group），
 *  本函数签名保持 MemConvoTurn[] 不变（moments.ts 等既有调用方契约不动，向后兼容）。 */
export function memRecentConvo(contactId: string, app: MemApp): MemConvoTurn[] {
  if (app === 'phone') return [];
  let convo: MemConvoTurn[] = [];
  try {
    // 聊天记录已迁 IndexedDB kv store（内存同步读，启动时由 idb-kv 迁移）
    const parsed: unknown = kvGet(
      app === 'wx'
        ? `wx-chat-msgs:${contactId}`
        : app === 'qq'
          ? `qq-chat-msgs:${contactId}`
          : `ios-chat-msgs:c:${contactId}`
    );
    if (Array.isArray(parsed)) convo = memConvoFromRaw(parsed, '');
  } catch {
    // 私聊读失败不中断，继续尝试群聊兜底
  }
  if (convo.length > 0) return convo;
  // 【#23】私聊为空 → 群聊兜底：只在群里聊过的角色也能取到最近对话
  //（【fix3-a 2c】memRecentGroupConvo 现返回带 group 元信息的完整结构，此处沿用其 convo，
  // 轮次里的 speakerPrefixed 标记原样透传）
  if (app === 'wx' || app === 'qq') return memRecentGroupConvo(contactId, app)?.convo ?? [];
  return [];
}

/** 手动总结用：挑该联系人最近有对话的 App（wx/qq/sms 私聊 + 【#23】wx/qq 群聊中最后一条消息时间最新者）。
 *  返回 app 仍为 'wx'|'qq'|'sms'（convo 来自群聊时记其宿主 App，即群来源返回群宿主 app，fix3-a 2c），
 *  convo 可能来自群聊；【fix3-a 2c】新增可选 group 元信息：convo 来自群聊时携带
 *  { id, memberNames }（供手动总结把 participants/群来源标记传给提取链路，防归属坍塌），
 *  私聊来源无 group 字段（旧调用方不读该字段行为不变，向后兼容）。 */
export function memMostRecentApp(contactId: string): { app: MemApp; convo: MemConvoTurn[]; group?: { id: string; memberNames: string[] } } | null {
  let best: { app: MemApp; ts: number; convo: MemConvoTurn[]; group?: { id: string; memberNames: string[] } } | null = null;
  for (const app of ['wx', 'qq', 'sms'] as MemApp[]) {
    const key =
      app === 'wx'
        ? `wx-chat-msgs:${contactId}`
        : app === 'qq'
          ? `qq-chat-msgs:${contactId}`
          : `ios-chat-msgs:c:${contactId}`;
    try {
      const parsed: unknown = kvGet(key);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const last = parsed[parsed.length - 1] as { time?: unknown } | null;
      const ts = typeof last?.time === 'number' ? last.time : 0;
      if (!best || ts > best.ts) best = { app, ts, convo: memConvoFromRaw(parsed, '') };
    } catch {
      continue;
    }
  }
  // 【#23】群聊候选与私聊同台竞选：该联系人在 wx/qq 的群最近对话（群消息 kv 键形如
  // wx-group-msgs:<gid> / qq-group-msgs:<gid>，经 listGroups + loadGroupMsgs 读取）；
  // 群来源 convo 的 app 记宿主 'wx'|'qq'，【fix3-a 2c】同时透传群元信息（id/memberNames），
  // 调用方（memExtractNow / memSummarizeNow / memory-bank / memAfterAiTurn 跨App兜底）
  // 据此把 participants 与群来源标记传给提取链路（不再「需要感知但拿不到」）
  for (const app of ['wx', 'qq'] as const) {
    const g = memRecentGroupConvo(contactId, app);
    if (g && g.convo.length > 0 && (!best || g.ts > best.ts)) best = { app, ts: g.ts, convo: g.convo, group: g.group };
  }
  return best ? { app: best.app, convo: best.convo, ...(best.group ? { group: best.group } : {}) } : null;
}
