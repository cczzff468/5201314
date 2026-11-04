/**
 * 线下模式（约会）—— 共享逻辑层（QQ / 微信两端共用）。
 *
 * 功能结构（「线下模式」需求）：
 * 1. 入口：QQ 输入栏五角星按钮 / 微信加号面板「线下」（原收藏位）；
 * 2. 点击进入线下场景，承接最近 N 条线上聊天（10/20/30/40/50/自定义；超长时保留最新内容）；
 * 3. 场景生成：地点 / 时间 / 环境 / 角色状态 / 对白，基于角色人设 + 世界书 + 最近聊天 + 记忆；
 * 4. 现场设置：回复字数（±20%，硬夹进字数区间）/ 承接条数 / 用户·角色叙述人称 / 回复预设 / 现场文风 /
 *    基础设置（字数区间·人称·导演模式·自主推进强度·修辞密度·描写占比·节奏）；
 *    自主推进口径随导演模式开关自动换算，两行指令不打架；
 * 5. 变量系统：{{char_name}} 等 12 个变量在发送前由 renderTemplate 替换（含 {{last_reply}} 上一条角色回复）；
 *    生成时代码侧注入「续写要求」（显式传上一条回复 + 接续规则 + 追问定向回答），
 *    并带防复读检测：新回复与上一条高度相似/整段包含时，自动带强指令重试一次；
 * 6. 操作：让角色继续 / 重 Roll（可恢复上一版）/ 编辑·删除任意条目 / 保存这次见面 / 自由输入（说话或描述动作）；
 *    线下历史注入每条时间戳（[M月D日 HH:mm]），让 AI 感知现场时间流；已保存的见面可在开始页回看；
 *    存档系统（右上角入口）：新建（保存当前进度）/ 覆盖 / 读档（恢复到存档时刻）/ 删除 / 重命名 /
 *    导出为 JSON 文件 / 从文件导入，快照含整场见面（entries·场景·设置·世界背景）；
 * 7. 保存后写入记忆库（memAddEventFragment，sourceTag 'offline-meet'），
 *    线上聊天召回记忆时自然带上线下发生的事；进行中的见面按角色 ID 隔离。
 *
 * 存储：全部走 idb-kv（内存写穿 IndexedDB），键按联系人隔离：
 * - offline-meet:<contactId>            进行中的见面（单条）
 * - offline-meet-history:<contactId>    已保存的见面（列表，最新在前）
 * - offline-meet-settings:<contactId>   该角色下一次见面的默认设置
 * - offline-meet-archives:<contactId>   存档列表（完整进度快照，最新在前，上限 50）
 * - offline-meet-tpl:<contactId>        该角色的当前模板覆盖（设置页编辑后未存为预设时生效）
 * - offline-wb-bg:<contactId>           世界书分析出的世界背景缓存
 * - offline-meet-presets / offline-meet-styles  回复预设 / 文风库（全局）
 */

import { kvDel, kvGet, kvSet } from '@/lib/ios/idb-kv';
import { promptTextOf } from '@/lib/prompt-entries';
import { memTimeLabel } from '@/lib/memory-core';

// ---------------- 类型 ----------------

export type OfflineApp = 'wx' | 'qq' | 'sms';

/** 用户叙述人称（识别用户动作时使用） */
export type OfflineUserPerson = '你' | '我';
/** 角色叙述人称（角色描述自己时使用） */
export type OfflineCharPerson = '他' | '她' | '我';

/** 三档强度 */
export type OfflineTriLevel = 'low' | 'medium' | 'high';
/** 基础设置人称 */
export type OfflinePersonMode = 'auto' | 'first' | 'second' | 'third';
/** 节奏 */
export type OfflinePaceMode = 'slow' | 'medium' | 'fast';

export interface OfflineMeetSettings {
  /** 角色回复目标字数（每次回复 ±20% 浮动） */
  replyLength: number;
  /** 从聊天继续承接最近 N 条 */
  carryCount: number;
  userPerson: OfflineUserPerson;
  charPerson: OfflineCharPerson;
  /** 当前回复预设 id */
  presetId: string;
  /** 当前文风 id */
  styleId: string;
  /** 字数区间（基础设置） */
  lenMin: number;
  lenMax: number;
  /** 人称（自动 / 一人称 / 二人称 / 三人称） */
  person: OfflinePersonMode;
  /** 导演模式 */
  director: boolean;
  /** 自主推进强度 */
  autonomy: OfflineTriLevel;
  /** 修辞密度 */
  rhetoric: OfflineTriLevel;
  /** 描写占比 */
  description: OfflineTriLevel;
  /** 节奏快慢 */
  pace: OfflinePaceMode;
}

export interface OfflinePreset {
  id: string;
  name: string;
  template: string;
  builtin?: boolean;
  createdAt: number;
}

export interface OfflineStyle {
  id: string;
  name: string;
  /** 文风内容（注入 {{writing_style}} 变量） */
  content: string;
  builtin?: boolean;
  createdAt: number;
}

/** 场景元信息（开场生成后解析记录） */
export interface OfflineScene {
  location: string;
  time: string;
  reason: string;
  charState: string;
}

/** 线下叙事流条目 */
export interface OfflineEntry {
  id: string;
  role: 'char' | 'user';
  text: string;
  at: number;
  /** 生成这条角色回复时的用户输入（重 Roll 复现用；'' = 「继续」；'__open__' = 开场） */
  fromInput?: string;
}

export interface OfflineMeet {
  id: string;
  contactId: string;
  appId: OfflineApp;
  startedAt: number;
  carryN: number;
  /** 承接的线上聊天文本（见面开始时定格） */
  onlineExcerpt: string;
  /** 承接的最后一条线上消息时间（时间感知用） */
  lastOnlineTime: number | null;
  scene: OfflineScene;
  entries: OfflineEntry[];
  settings: OfflineMeetSettings;
  /** 世界背景（世界书分析结果或角色资料推断，开场前定格） */
  worldBg: string;
  /** 本次见面使用的模板（现场设置保存时定格；缺省回落角色模板覆盖/预设） */
  template?: string;
}

export interface OfflineSavedMeet extends OfflineMeet {
  savedAt: number;
}

export interface OfflineOnlineMsg {
  role: 'me' | 'peer';
  text: string;
  time: number;
}

/** 存档：一次见面进度的完整快照（读档可回到存档那一刻） */
export interface OfflineArchive {
  id: string;
  name: string;
  /** 新建 / 最近一次覆盖的时间 */
  savedAt: number;
  meet: OfflineMeet;
}

// ---------------- 存储键 ----------------

export const offlineMeetKey = (contactId: string): string => `offline-meet:${contactId}`;
export const offlineMeetHistoryKey = (contactId: string): string => `offline-meet-history:${contactId}`;
export const offlineSettingsKey = (contactId: string): string => `offline-meet-settings:${contactId}`;
export const offlineTplKey = (contactId: string): string => `offline-meet-tpl:${contactId}`;
export const offlineWbBgKey = (contactId: string): string => `offline-wb-bg:${contactId}`;
export const OFFLINE_PRESETS_KEY = 'offline-meet-presets';
export const OFFLINE_STYLES_KEY = 'offline-meet-styles';

export const OFFLINE_CARRY_OPTIONS = [10, 20, 30, 40, 50] as const;
export const OFFLINE_BUILTIN_PRESET_ID = 'preset-default';
export const OFFLINE_BUILTIN_STYLE_ID = 'style-natural';

/** 变量清单（设置页「变量说明」渲染用） */
export const OFFLINE_VARIABLES: Array<{ name: string; desc: string }> = [
  { name: '{{char_name}}', desc: '当前角色名' },
  { name: '{{user_name}}', desc: '用户称呼' },
  { name: '{{reply_length}}', desc: '本次目标字数' },
  { name: '{{user_person}}', desc: '用户叙述人称' },
  { name: '{{char_person}}', desc: '角色叙述人称' },
  { name: '{{world_background}}', desc: '世界书分析背景' },
  { name: '{{writing_style}}', desc: '当前文风' },
  { name: '{{scene}}', desc: '地点、原因和角色状态' },
  { name: '{{user_message}}', desc: '用户本轮输入' },
  { name: '{{last_reply}}', desc: '上一条角色回复（续写用，代码侧也会注入）' },
  { name: '{{online_chat}}', desc: '线下开始前的线上聊天' },
  { name: '{{offline_history}}', desc: '已发生的线下内容' },
];

// ---------------- 默认模板与内置文风 ----------------

export const OFFLINE_DEFAULT_TEMPLATE = `【线下角色回复总规则】
你正在与{{user_name}}进行线下见面——从线上聊天延续到面对面的真实相处。你写下的内容不是聊天消息，而是此时此刻真实发生的故事：环境、动作、神态、对白交织的现场叙事。

【本次见面信息】
现场：{{scene}}
世界背景：{{world_background}}
文风：{{writing_style}}
目标字数：正文约 {{reply_length}} 字（可在上下 20% 内浮动），内容写足再自然收束，不要草草结束。
人称要求：叙述{{user_name}}的言行时用「{{user_person}}」；{{char_name}}相关叙述用「{{char_person}}」作主语；全文人称保持统一。

【线上聊天承接】（见面之前的线上聊天，情绪与话题要自然延续，不要当没发生过）
{{online_chat}}

【线下已经发生的内容】（按时间顺序；刚开始见面时此段为空）
{{offline_history}}

【写作要求】
1. 环境描写：地点、天气、光线、气味、声音等细节营造画面感；
2. 角色呈现：{{char_name}}的情绪、动作、神态、穿着贴合人设与当前状态；
3. 对白：贴合角色的说话风格与口头禅，自然穿插在叙述中；
4. 承接：接住{{user_name}}最近的言行与情绪，不重启话题、不忽略对方；
5. 本轮输入里{{user_name}}说的话和做的动作要被自然接住并回应。

【本轮输入】
{{user_message}}

【输出要求】
直接输出叙事正文；不要任何标题、序号、markdown、括号舞台提示或角色名前缀；不跳出角色，不提及设定、模板、变量或任何幕后概念；不替{{user_name}}说话、做决定或代答，把回应的主动权留给{{user_name}}。`;

export const BUILTIN_STYLES: OfflineStyle[] = [
  {
    id: OFFLINE_BUILTIN_STYLE_ID,
    name: '自然细腻',
    builtin: true,
    createdAt: 0,
    content:
      '[CRAFT REFERENCES] 自然细腻文风：\n用贴近生活的白描与细节捕捉情绪——视线、指尖、呼吸、温度的变化比形容词更重要。\n- 动作拆小：一个情绪用两三个连贯的小动作呈现（把糖捏皱、把杯沿转半圈），不直接下结论；\n- 感官落地：每个场景至少落在两种感官上（声音/气味/触感/光线）；\n- 对白留口语毛边：允许停顿、抢话、没说完的话，语气词自然出现；\n- 修辞克制：比喻最多一两处，且要具体可感，不用华丽空洞的排比；\n- 情绪藏在细节里：写「发生了什么」，让读者自己感到「是什么情绪」。',
  },
  {
    id: 'style-minimal',
    name: '简约留白',
    builtin: true,
    createdAt: 0,
    content:
      '[CRAFT REFERENCES] 简约留白文风：\n句子短，节奏干净，多用句号。能一句话说清的不写两句。\n- 少形容词，多动词；环境只写改变氛围的那一两笔；\n- 大量留白：对话之间的沉默、没有说出口的话也是内容；\n- 情绪不点破，用动作与空档呈现；\n- 适合冷静、克制、疏离感强的角色与场景。',
  },
  {
    id: 'style-vivid',
    name: '画面浓烈',
    builtin: true,
    createdAt: 0,
    content:
      '[CRAFT REFERENCES] 画面浓烈文风：\n高密度的感官描写与通感，色彩、光线、气味互相渗透，句子有镜头感。\n- 开场先给一个定格镜头（特写或全景），再进入动作；\n- 修辞大胆：比喻、通感、拟人都可以用，但要新鲜不套话；\n- 情绪外化成环境：心跳、耳鸣、路灯的晕、空气的黏度；\n- 对白短促有力，与浓密叙述形成反差；\n- 适合强情绪、戏剧性张力强的场景。',
  },
];

// ---------------- 默认设置 ----------------

export const DEFAULT_OFFLINE_SETTINGS: OfflineMeetSettings = {
  replyLength: 1500,
  carryCount: 20,
  userPerson: '你',
  charPerson: '他',
  presetId: OFFLINE_BUILTIN_PRESET_ID,
  styleId: OFFLINE_BUILTIN_STYLE_ID,
  // 字数区间默认要能容纳回复字数 1500 ± 20%（1200~1800）：旧默认 450~800 会把 1500 静默夹到 800
  lenMin: 300,
  lenMax: 3000,
  person: 'auto',
  director: false,
  autonomy: 'medium',
  rhetoric: 'medium',
  description: 'medium',
  pace: 'medium',
};

export const OFFLINE_TRI_LABEL: Record<OfflineTriLevel, string> = { low: '低', medium: '中', high: '高' };
export const OFFLINE_PACE_LABEL: Record<OfflinePaceMode, string> = { slow: '慢', medium: '中', fast: '快' };
export const OFFLINE_PERSON_LABEL: Record<OfflinePersonMode, string> = {
  auto: '自动',
  first: '一人称',
  second: '二人称',
  third: '三人称',
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** 归一化设置（历史/脏数据兜底） */
export function normalizeOfflineSettings(raw: unknown): OfflineMeetSettings {
  const d = DEFAULT_OFFLINE_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  const settings: OfflineMeetSettings = {
    replyLength: clampInt(r.replyLength, 100, 8000, d.replyLength),
    carryCount: clampInt(r.carryCount, 5, 200, d.carryCount),
    userPerson: pick(r.userPerson, ['你', '我'] as const, d.userPerson),
    charPerson: pick(r.charPerson, ['他', '她', '我'] as const, d.charPerson),
    presetId: typeof r.presetId === 'string' && r.presetId ? r.presetId : d.presetId,
    styleId: typeof r.styleId === 'string' && r.styleId ? r.styleId : d.styleId,
    lenMin: clampInt(r.lenMin, 50, 8000, d.lenMin),
    lenMax: clampInt(r.lenMax, 50, 8000, d.lenMax),
    person: pick(r.person, ['auto', 'first', 'second', 'third'] as const, d.person),
    director: typeof r.director === 'boolean' ? r.director : d.director,
    autonomy: pick(r.autonomy, ['low', 'medium', 'high'] as const, d.autonomy),
    rhetoric: pick(r.rhetoric, ['low', 'medium', 'high'] as const, d.rhetoric),
    description: pick(r.description, ['low', 'medium', 'high'] as const, d.description),
    pace: pick(r.pace, ['slow', 'medium', 'fast'] as const, d.pace),
  };
  if (settings.lenMin > settings.lenMax) [settings.lenMin, settings.lenMax] = [settings.lenMax, settings.lenMin];
  // 旧默认迁移：存档/设置里未自定义的旧默认组合（回复字数 1500 + 区间 450~800）会把 1500 静默夹到 800，
  // 检测到该组合时升级到新默认区间；用户改过任一项则不动
  if (r.replyLength === 1500 && r.lenMin === 450 && r.lenMax === 800) {
    settings.lenMin = d.lenMin;
    settings.lenMax = d.lenMax;
  }
  return settings;
}

// ---------------- 预设 / 文风 ----------------

export function loadPresets(): OfflinePreset[] {
  const builtin: OfflinePreset = {
    id: OFFLINE_BUILTIN_PRESET_ID,
    name: '内置默认预设',
    template: OFFLINE_DEFAULT_TEMPLATE,
    builtin: true,
    createdAt: 0,
  };
  try {
    const saved = kvGet<OfflinePreset[]>(OFFLINE_PRESETS_KEY);
    const list = Array.isArray(saved) ? saved.filter((p) => p && typeof p.id === 'string') : [];
    return [builtin, ...list];
  } catch {
    return [builtin];
  }
}

export function saveCustomPresets(list: OfflinePreset[]): void {
  kvSet(OFFLINE_PRESETS_KEY, list.filter((p) => !p.builtin));
}

export function loadStyles(): OfflineStyle[] {
  try {
    const saved = kvGet<OfflineStyle[]>(OFFLINE_STYLES_KEY);
    const custom = Array.isArray(saved) ? saved.filter((s) => s && typeof s.id === 'string') : [];
    return [...BUILTIN_STYLES, ...custom];
  } catch {
    return [...BUILTIN_STYLES];
  }
}

export function saveCustomStyles(list: OfflineStyle[]): void {
  kvSet(OFFLINE_STYLES_KEY, list.filter((s) => !s.builtin));
}

// ---------------- 见面存取 ----------------

export function loadMeet(contactId: string): OfflineMeet | null {
  try {
    const m = kvGet<OfflineMeet>(offlineMeetKey(contactId));
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.entries)) return null;
    m.settings = normalizeOfflineSettings(m.settings);
    return m;
  } catch {
    return null;
  }
}

export function saveMeet(meet: OfflineMeet): void {
  kvSet(offlineMeetKey(meet.contactId), meet);
}

export function clearMeet(contactId: string): void {
  kvDel(offlineMeetKey(contactId));
}

export function loadMeetHistory(contactId: string): OfflineSavedMeet[] {
  try {
    const list = kvGet<OfflineSavedMeet[]>(offlineMeetHistoryKey(contactId));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addMeetToHistory(contactId: string, meet: OfflineMeet): void {
  const entry: OfflineSavedMeet = { ...meet, savedAt: Date.now() };
  const list = [entry, ...loadMeetHistory(contactId)].slice(0, 30);
  kvSet(offlineMeetHistoryKey(contactId), list);
}

// ---------------- 存档（新建 / 覆盖 / 读档 / 删除 / 重命名 / 导出 / 导入） ----------------

export const offlineArchivesKey = (contactId: string): string => `offline-meet-archives:${contactId}`;

export function loadArchives(contactId: string): OfflineArchive[] {
  try {
    const list = kvGet<OfflineArchive[]>(offlineArchivesKey(contactId));
    if (!Array.isArray(list)) return [];
    return list.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string' && a.meet && Array.isArray(a.meet.entries));
  } catch {
    return [];
  }
}

/** 存档写回（最新在前，上限 50 份） */
export function saveArchives(contactId: string, list: OfflineArchive[]): void {
  kvSet(offlineArchivesKey(contactId), list.slice(0, 50));
}

/** 导入存档的结构校验与归一化：非法数据返回 null；meet.contactId 强制改写为当前角色 */
export function sanitizeArchive(raw: unknown, fallbackContactId: string): OfflineArchive | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const meetRaw = r.meet;
  if (!meetRaw || typeof meetRaw !== 'object') return null;
  const mr = meetRaw as Record<string, unknown>;
  if (!Array.isArray(mr.entries)) return null;
  const entries: OfflineEntry[] = [];
  for (const item of mr.entries) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const text = typeof e.text === 'string' ? e.text : '';
    if (!text.trim()) continue;
    entries.push({
      id: typeof e.id === 'string' && e.id ? e.id : offlineUid(),
      role: e.role === 'user' ? 'user' : 'char',
      text,
      at: typeof e.at === 'number' && e.at > 0 ? e.at : Date.now(),
      ...(typeof e.fromInput === 'string' ? { fromInput: e.fromInput } : {}),
    });
  }
  const sceneRaw = (mr.scene && typeof mr.scene === 'object' ? mr.scene : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const meet: OfflineMeet = {
    id: typeof mr.id === 'string' && mr.id ? mr.id : offlineUid(),
    contactId: fallbackContactId,
    appId: mr.appId === 'qq' || mr.appId === 'sms' ? mr.appId : 'wx',
    startedAt: typeof mr.startedAt === 'number' && mr.startedAt > 0 ? mr.startedAt : Date.now(),
    carryN: typeof mr.carryN === 'number' && Number.isFinite(mr.carryN) ? Math.max(0, Math.floor(mr.carryN)) : 0,
    onlineExcerpt: str(mr.onlineExcerpt),
    lastOnlineTime: typeof mr.lastOnlineTime === 'number' && mr.lastOnlineTime > 0 ? mr.lastOnlineTime : null,
    scene: { location: str(sceneRaw.location), time: str(sceneRaw.time), reason: str(sceneRaw.reason), charState: str(sceneRaw.charState) },
    entries,
    settings: normalizeOfflineSettings(mr.settings),
    worldBg: str(mr.worldBg),
    ...(str(mr.template).trim() ? { template: str(mr.template) } : {}),
  };
  const name = str(r.name).trim().slice(0, 30) || `导入存档 ${offlineMdhm(meet.startedAt)}`;
  return { id: offlineUid(), name, savedAt: Date.now(), meet };
}

export function loadMeetSettings(contactId: string): OfflineMeetSettings {
  return normalizeOfflineSettings(kvGet<unknown>(offlineSettingsKey(contactId)));
}

export function saveMeetSettings(contactId: string, settings: OfflineMeetSettings): void {
  kvSet(offlineSettingsKey(contactId), settings);
}

export function loadTplOverride(contactId: string): string | null {
  const t = kvGet<string>(offlineTplKey(contactId));
  return typeof t === 'string' && t.trim() ? t : null;
}

export function saveTplOverride(contactId: string, template: string): void {
  kvSet(offlineTplKey(contactId), template);
}

export function loadWbBgCache(contactId: string): string | null {
  const t = kvGet<string>(offlineWbBgKey(contactId));
  return typeof t === 'string' && t.trim() ? t : null;
}

export function saveWbBgCache(contactId: string, bg: string): void {
  kvSet(offlineWbBgKey(contactId), bg);
}

/** 删除联系人时级联清理（contacts-store.deleteContact 调用） */
export function purgeOfflineMeetForContact(contactId: string): void {
  if (!contactId) return;
  kvDel(offlineMeetKey(contactId));
  kvDel(offlineMeetHistoryKey(contactId));
  kvDel(offlineSettingsKey(contactId));
  kvDel(offlineTplKey(contactId));
  kvDel(offlineWbBgKey(contactId));
  kvDel(offlineArchivesKey(contactId));
}

// ---------------- 变量替换 ----------------

/** 发送前自动替换 {{var}}；未提供的变量替换为空串（不残留花括号） */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (raw, key: string) => {
    const v = vars[key];
    return typeof v === 'string' ? v : '';
  });
}

/** 本次回复目标字数：设定字数 ±20% 浮动，再夹进字数区间 */
export function effectiveReplyTarget(settings: OfflineMeetSettings): number {
  const jitter = 0.8 + Math.random() * 0.4;
  const target = Math.round(settings.replyLength * jitter);
  const { lenMin, lenMax } = settings;
  if (lenMin <= lenMax) return Math.min(Math.max(target, lenMin), lenMax);
  return target;
}

/** 基础设置人称 → 实际角色叙述人称（auto 沿用现场设置的 charPerson；二人称 = 叙述以「你」称呼角色） */
export function effectiveCharPerson(settings: OfflineMeetSettings, gender?: string | null): string {
  switch (settings.person) {
    case 'first':
      return '我';
    case 'second':
      return '你';
    case 'third':
      return (gender ?? '').includes('女') ? '她' : '他';
    default:
      return settings.charPerson;
  }
}

/** 开场后从回复中解析【场景】头（地点/时间/缘由/状态），返回场景与正文 */
export function extractSceneHeader(text: string): { scene: OfflineScene | null; body: string } {
  const idx = text.indexOf('【场景】');
  if (idx < 0) return { scene: null, body: text };
  const lineEnd = text.indexOf('\n', idx);
  const line = (lineEnd < 0 ? text.slice(idx) : text.slice(idx, lineEnd)).replace('【场景】', '').trim();
  const rest = (lineEnd < 0 ? '' : text.slice(lineEnd + 1)).trim();
  const scene: OfflineScene = { location: '', time: '', reason: '', charState: '' };
  for (const part of line.split(/[｜|]/)) {
    const m = part.match(/^\s*(地点|时间|缘由|原因|状态|角色状态)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    if (m[1] === '地点') scene.location = val;
    else if (m[1] === '时间') scene.time = val;
    else if (m[1] === '缘由' || m[1] === '原因') scene.reason = val;
    else scene.charState = val;
  }
  const filled = scene.location || scene.reason || scene.charState;
  return { scene: filled ? scene : null, body: rest || text };
}

/** M月D日 HH:mm（线下叙事时间戳：正文消息头 + 线下历史上下文共用） */
export function offlineMdhm(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 线下叙事流的上下文文本（注入 {{offline_history}}；每条带时间戳让 AI 感知现场时间流；超出 9000 字从最旧开始截） */
export function buildOfflineHistoryText(meet: OfflineMeet, userName: string, charName: string, excludeLastChar = false): string {
  const entries = excludeLastChar && meet.entries.length > 0 && meet.entries[meet.entries.length - 1].role === 'char' ? meet.entries.slice(0, -1) : meet.entries;
  const parts = entries.map((e) => `[${offlineMdhm(e.at)}] ${e.role === 'char' ? charName : userName}：${e.text.trim()}`);
  let out = parts.join('\n\n');
  while (out.length > 9000 && parts.length > 1) {
    parts.shift();
    out = parts.join('\n\n');
  }
  return out;
}

/** 开场生成指令（拼在渲染后的模板尾部） */
export function buildOpenInstruction(charName: string, userName: string): string {
  return [
    '【开场生成】',
    '这是这次见面的开场。请先用一行按下面的格式输出场景信息（这一行是系统记录用，之后的正文里不要再出现这一行的内容）：',
    '【场景】地点：xxx｜时间：xxx｜缘由：xxx｜状态：xxx',
    `（地点：具体见面的位置；时间：现在几月、大概几点、季节氛围；缘由：结合最近的线上聊天说明两人为什么会在这里见面；状态：${charName}此刻的情绪与状态，延续线上聊天结束时的情绪）`,
    '然后空一行输出开场正文：从环境与氛围切入（天气、光线、声音、气味），写出' +
      charName +
      '的出场（动作、穿着、情绪），自然承接线上聊天的话题与情绪，结尾落在' +
      charName +
      '一个具体的言行上，把回应权交给' +
      userName +
      '。',
  ].join('\n');
}

/**
 * 续写指令（代码侧拼接，不依赖模板）：显式传上一条回复，要求接着写、不复读、追问定向回答。
 * 每次生成（非开场）都会追加在渲染后的模板尾部，保证即使用户改了模板也生效。
 */
export function buildContinueInstruction(opts: { lastReply: string; fromInput: string; charName: string; userName: string }): string {
  const { lastReply, fromInput, charName, userName } = opts;
  const lines: string[] = ['【续写要求（最高优先级，必须遵守）】'];
  if (lastReply.trim()) {
    lines.push(
      '你的上一条回复是：',
      `"""${lastReply.trim().slice(-800)}"""`,
      '现在从这段话的最后一刻紧接着往下写：只输出新的内容；严禁重复、复述或改写上一条回复里的任何句子（对方已经读过这些内容）；不允许出现任何连续与上一条相同的句子或段落，哪怕一小段原句照搬也不行。',
    );
  } else {
    lines.push('接着当前场景自然往下写：只输出新内容，不要把已经发生过的事情再写一遍。');
  }
  if (fromInput.trim()) {
    lines.push(
      `${userName}这轮说的是：「${fromInput.trim().slice(0, 200)}」——这是最新的追问/输入，你的回复必须直接针对这句话回应；如果之前已经说过类似内容，换一个新的角度回答或推进，不要重发之前的整段。`,
    );
  } else {
    lines.push(`让${charName}自然推进当前场景一点点，把回应权交给${userName}。`);
  }
  return lines.join('\n');
}

// ---------------- 防复读检测 ----------------

/** 归一化：去空白与标点，转小写（中文 bigram 判重用） */
function normalizeForRepeat(t: string): string {
  return t
    .replace(/[\s，。！？；：、’‘“”「」『』（）()《》〈〉【】〔〕\.!\?;:'"“,~～—…·•\-]/g, '')
    .toLowerCase();
}

/** 字符 bigram Jaccard 相似度（0~1） */
export function textSimilarity(a: string, b: string): number {
  const A = normalizeForRepeat(a);
  const B = normalizeForRepeat(b);
  if (A.length < 8 || B.length < 8) return 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(A);
  const gb = grams(B);
  let inter = 0;
  ga.forEach((g) => {
    if (gb.has(g)) inter++;
  });
  const union = ga.size + gb.size - inter;
  return union ? inter / union : 0;
}

/** 最长公共连续子串长度（防复读：整段照搬检测；O(n·m)，中文正文长度下毫秒级） */
function longestCommonRun(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1);
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      if (ca === b.charCodeAt(j - 1)) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * 复读判定（任一命中即视为复读，触发自动重试）：
 * 1. 新回复与上一条整段互相包含（原样重发/只接一小截）；
 * 2. bigram 相似度 ≥ 0.45（大面积改写重发）；
 * 3. 存在 ≥ 80 字的连续相同段落（整段照搬；实测部分复读场景 Jaccard 只有约 0.35，必须靠这条抓出）。
 */
export function looksLikeRepeat(next: string, prev: string): boolean {
  const A = normalizeForRepeat(prev);
  const B = normalizeForRepeat(next);
  if (A.length < 12 || B.length < 12) return false;
  if (B.includes(A) || A.includes(B)) return true;
  if (longestCommonRun(A, B) >= 80) return true;
  return textSimilarity(A, B) >= 0.45;
}

/** 系统侧「线下叙事总纲 + 现场参数」块（追加在 system prompt 末尾，优先级高于线上聊天规则） */
export function buildOfflineDirective(opts: {
  settings: OfflineMeetSettings;
  /** 实际角色叙述人称（基础设置人称解析后的结果，二人称时为「你」） */
  charPersonEff: string;
  charName: string;
  userName: string;
  channel: string;
  target: number;
}): string {
  const { settings: s, charPersonEff, charName, userName, channel, target } = opts;
  const tri = <T extends string>(v: T, lines: Record<T, string>) => lines[v];
  // 自主推进强度按「导演模式开/关」分别给口径，避免两行指令互相打架：
  // 导演关 + 高强度 ≠ 「推动剧情转换场景」，而是「同场景内大步推进」；导演开 + 低强度 ≠ 「只推进一小步不引入事件」，而是「可轻推但克制」
  const autonomyLine = (() => {
    if (s.director) {
      return tri(s.autonomy, {
        low: `整体克制：可以引入小事件轻轻推动，但每次只推进一小步，大量留白等待${userName}回应`,
        medium: '按当前场景的自然速度推进，张弛有度；可以引入小事件、转换场景、让时间自然流动，但重大转折留给对方决定',
        high: `积极推动剧情发展与场景转换：小事件、场景切换、时间流动都放开用，但重大转折和关系决定仍留给${userName}`,
      });
    }
    return tri(s.autonomy, {
      low: `每次只推进一小步，大量留白等待${userName}回应，不抢节奏`,
      medium: '在当前场景内按自然速度推进，不引入新事件、不跳跃时间',
      high: `在当前场景内做出实质性的大步推进（大段动作/对话/情绪进展），但保持在同一场景内：不引入新事件、不转换场景、不跳跃时间`,
    });
  })();
  const rhetoricLine = tri(s.rhetoric, {
    low: '白描直叙，少用比喻修辞，语言干净直白',
    medium: '适度使用修辞，自然不刻意',
    high: '修辞丰富，比喻通感大胆，语言有文学性',
  });
  const descLine = tri(s.description, {
    low: '以对白和动作为主，环境与心理描写从简',
    medium: '描写与叙事均衡',
    high: '环境、感官与心理描写占比高，画面感浓',
  });
  const paceLine = tri(s.pace, {
    slow: '节奏舒缓，细致铺陈，允许大量静止与沉默的瞬间',
    medium: '节奏中等，张弛有度',
    fast: '节奏明快，事件推进迅速，场景切换利落',
  });
  const personLine =
    s.person === 'auto'
      ? `按现场设置：叙述${userName}用「${s.userPerson}」，${charName}相关叙述用「${charPersonEff}」`
      : `强制${'「' + charPersonEff + '」'}（基础设置指定）；叙述${userName}用「${s.userPerson}」`;
  // v63 全局预设管理器：线下总纲接入注册表（offline-directive；关闭=不注入总纲；原文零破坏）
  return (
    promptTextOf(
      'offline-directive',
      { charName, userName, channel, target },
      [
    '【线下叙事模式总纲（最高优先级，覆盖线上聊天规则）】',
    `现在从${channel}线上聊天切换到「线下见面」叙事模式：你和${userName}已经在现实中见面。你写的内容不是聊天消息，而是线下场景的实时叙事（环境 + ${charName}的动作神态 + 对白）。线上聊天的「简短回复」「像随手打字」等规则在本模式下全部不适用，以本节为准。`,
    `- 叙事直接面向${userName}展开；对白贴合人设语气，穿插在叙述中；动作与心理直接写进叙述；`,
    '- 不输出 markdown、序号、括号舞台提示或角色名前缀；不跳出角色，不提及任何设定或幕后概念；',
    `- 不替${userName}说话、做决定或代答；${userName}输入里描述的言行要被自然接住并回应；`,
    '- 接续规则：每次回复都紧接着上一条回复的最后一刻往下写新的内容；严禁重复、复述或改写自己之前任何一条回复（包括更早的回复）里已有的句子或段落；',
    `- ${userName}重复追问时，把它当作催促或新的追问，直接给出新的回应或推进剧情，不要把之前发过的整段回复再发一遍；`,
    '',
    '【现场参数】',
    `- 导演模式：${s.director ? `开启——你可以推进小事件、转换场景、让时间自然流动，制造推动关系的契机` : '关闭——只在当前场景内反应，不主动跳跃时间、不引入新事件'}`,
    `- 自主推进强度：${autonomyLine}`,
    `- 修辞密度：${rhetoricLine}`,
    `- 描写占比：${descLine}`,
    `- 节奏：${paceLine}`,
    `- 人称：${personLine}`,
    `- 长度：每次回复正文约 ${target} 字，写足再自然收束`,
  ].join('\n'),
    ) ?? ''
  );
}

/** 保存见面时生成记忆摘要（写入 memAddEventFragment） */
export function buildMeetDigest(meet: OfflineMeet, userName: string, charName: string): string {
  const head = `【线下见面】${memTimeLabel(meet.startedAt)}，${userName}和${charName}在${meet.scene.location || '（未记录地点）'}见面（${meet.scene.reason || '延续线上聊天'}）。`;
  const parts: string[] = [head];
  let total = head.length;
  for (const e of meet.entries) {
    const budget = e.role === 'char' ? 150 : 60;
    const text = e.text.replace(/\s+/g, ' ').trim().slice(0, budget) + (e.text.length > budget ? '…' : '');
    const line = `${e.role === 'char' ? charName : userName}：${text}`;
    if (total + line.length > 620) break;
    parts.push(line);
    total += line.length;
  }
  return parts.join('\n');
}

/** 通用短 id */
export function offlineUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
