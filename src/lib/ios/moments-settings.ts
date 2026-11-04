import { kvGet, kvSet } from './idb-kv';

/**
 * 朋友圈/空间动态互动设置 —— 按平台独立（feat-64：微信朋友圈与 QQ 空间各存一份，互不影响）。
 * 旧版本 wx+qq 共享一份（键 moments-settings）；首次读取时作为两个平台各自的初始值一次性拆分迁移。
 */
export interface MomentsSettings {
  // 一、发布节奏
  /** 最短发帖间隔（分钟，15-1440）；自动发帖调度时强制等待 ≥ 此值 */
  minPostInterval: number;        // 默认 30（活跃节奏）
  /** 最长发帖间隔（分钟，15-1440）；超过后强制触发一次，保证好友一直主动发动态 */
  maxPostInterval: number;        // 默认 120（活跃节奏）
  /** 自动发帖总开关；关闭后所有角色不再自动发帖 */
  autoPostEnabled: boolean;       // 默认 true

  // 二、评论与点赞
  /** 首条评论延迟（秒，1-3600） */
  firstCommentDelay: number;      // 默认 30
  /** 后续评论间隔（秒，1-3600） */
  followCommentDelay: number;     // 默认 30
  /** 评论概率（0-1） */
  commentProbability: number;     // 默认 0.5
  /** 点赞概率（0-1） */
  likeProbability: number;        // 默认 0.5
  /** NPC 转发概率（0-100 百分比，#42）：好友刷到用户动态后转发到 TA 空间的概率
   *  （引擎只在 QQ 空间读；微信侧同构保留，两平台独立存储互不影响） */
  repostProbability: number;      // 默认 22

  // 三、NPC 互动
  /** NPC 互动延迟（秒，1-3600） */
  npcInteractDelay: number;       // 默认 30
  /** 角色回复 NPC 评论延迟（秒，1-3600） */
  replyNpcCommentDelay: number;   // 默认 3

  // 四、双语翻译
  /** 朋友圈双语翻译开关 */
  bilingualEnabled: boolean;      // 默认 true
  /** 折叠中文译文（关闭后默认展开） */
  foldChineseTranslation: boolean;// 默认 true
  /** 朋友圈双语提示词（空串 = 用 DEFAULT_BILINGUAL_PROMPT） */
  bilingualPrompt: string;        // 默认 ''
}

export const DEFAULT_MOMENTS_SETTINGS: MomentsSettings = {
  minPostInterval: 30,
  maxPostInterval: 120,
  autoPostEnabled: true,
  firstCommentDelay: 30,
  followCommentDelay: 30,
  commentProbability: 0.5,
  likeProbability: 0.5,
  repostProbability: 22,
  npcInteractDelay: 30,
  replyNpcCommentDelay: 3,
  bilingualEnabled: true,
  foldChineseTranslation: true,
  bilingualPrompt: '',
};

export const DEFAULT_BILINGUAL_PROMPT = `【朋友圈双语规则（仅非中文角色使用，中文角色忽略此规则）】
- **不改变协议头和结构标签**：只对你实际输出的正文内容使用双语格式，不要翻译或改动协议头和结构标签，不要改动 [回复 昵称]、[不回复]、[NPC点赞]、[NPC评论]、昵称、以及"昵称 回复 被回复者昵称:"这类结构。
- **中文正常输出无需译文**：如果正文是中文，直接正常输出，不要添加译文
- **非中文语言译文输出格式**：非中文语言，正文必须使用"原文|对应的简体中文译文"的格式输出，必须有|分割符号。
- **朋友圈正文双语补充**：如果朋友圈正文、评论正文或回复正文使用非中文，必须在同一段正文里写成"完整外文原文|完整简体中文译文"。
- **照片双语规则**：如果输出 [照片:使用参考图:描述] 或 [照片:不使用参考图:描述]，只允许描述部分使用双语格式，不要改动照片标签外层结构。`;

// ---------------- 平台标识 ----------------

/** 平台（wx=微信朋友圈 / qq=QQ空间动态）。本地定义避免与 moments.ts 循环 import */
export type MomentsApp = 'wx' | 'qq';

export function isMomentsApp(x: unknown): x is MomentsApp {
  return x === 'wx' || x === 'qq';
}

/** 每平台独立存储键（feat-64 起微信/QQ 各一份） */
const settingsKeyOf = (app: MomentsApp) => `moments-settings:${app}`;
/** 旧共享键（feat-64 之前 wx+qq 一份）：仅作首次拆分迁移的初始值来源，之后不再读取 */
const LEGACY_SHARED_SETTINGS_KEY = 'moments-settings';

/** 设置结构版本：v3 = 间隔改用「分钟」存储（v1/v2 为小时，读取时自动迁移） */
const SETTINGS_SCHEMA_VERSION = 3;

/** 间隔允许的分钟范围 */
export const MIN_POST_INTERVAL_MIN = 15;
export const MAX_POST_INTERVAL_MIN = 1440;

/** 发布节奏预设（一键切换 min/max 间隔，单位分钟；活跃 = 新默认） */
export const MOMENT_RHYTHM_PRESETS: { key: string; label: string; desc: string; min: number; max: number }[] = [
  { key: 'active', label: '活跃', desc: '常常发，像刷屏达人', min: 30, max: 120 },
  { key: 'natural', label: '自然', desc: '一天几条，真实感强', min: 120, max: 240 },
  { key: 'calm', label: '安静', desc: '偶尔发一条', min: 360, max: 720 },
];

/** 当前 min/max 对应的节奏名（无匹配 = 自定义） */
export function rhythmLabelOf(min: number, max: number): string {
  const hit = MOMENT_RHYTHM_PRESETS.find((p) => p.min === min && p.max === max);
  return hit ? hit.label : '自定义';
}

/** 分钟 → 紧凑文案：30 →「30分钟」；120 →「2小时」；90 →「1.5小时」 */
export function formatIntervalMin(min: number): string {
  if (min < 60) return `${Math.round(min)}分钟`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, '')}小时`;
}

/** 区间 → 紧凑文案：30/120 →「30分钟-2小时」；120/240 →「2-4小时」 */
export function formatIntervalRange(min: number, max: number): string {
  if (min < 60 && max < 60) return `${min}-${max}分钟`;
  if (min < 60) return `${formatIntervalMin(min)}-${formatIntervalMin(max)}`;
  return `${min / 60}-${formatIntervalMin(max)}`;
}

/** 容错解析一份原始存储值（每字段容错；v1/v2 小时值自动迁移为分钟） */
function parseSettings(v: unknown): MomentsSettings {
  if (!v || typeof v !== 'object') return { ...DEFAULT_MOMENTS_SETTINGS };
  const raw = v as { [K in keyof MomentsSettings]?: unknown } & { schemaVersion?: unknown };
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
  let minPostInterval = DEFAULT_MOMENTS_SETTINGS.minPostInterval;
  let maxPostInterval = DEFAULT_MOMENTS_SETTINGS.maxPostInterval;
  if (raw.schemaVersion === SETTINGS_SCHEMA_VERSION) {
    // v3：分钟存储
    const mn = num(raw.minPostInterval);
    const mx = num(raw.maxPostInterval);
    if (mn !== null && inRange(mn, MIN_POST_INTERVAL_MIN, MAX_POST_INTERVAL_MIN)) minPostInterval = Math.round(mn);
    if (mx !== null && inRange(mx, MIN_POST_INTERVAL_MIN, MAX_POST_INTERVAL_MIN)) maxPostInterval = Math.round(mx);
  } else {
    // v1/v2：小时存储 → 迁移为分钟；旧默认（v1 12/24、v2 2/6）直接落新默认
    const hMin = num(raw.minPostInterval);
    const hMax = num(raw.maxPostInterval);
    if (hMin !== null && hMax !== null && inRange(hMin, 1, 24) && inRange(hMax, 1, 24)) {
      const isOldDefault = (hMin === 12 && hMax === 24) || (hMin === 2 && hMax === 6);
      minPostInterval = isOldDefault ? DEFAULT_MOMENTS_SETTINGS.minPostInterval : Math.round(hMin * 60);
      maxPostInterval = isOldDefault ? DEFAULT_MOMENTS_SETTINGS.maxPostInterval : Math.round(hMax * 60);
    }
  }
  return {
    minPostInterval,
    maxPostInterval,
    autoPostEnabled: typeof raw.autoPostEnabled === 'boolean' ? raw.autoPostEnabled : DEFAULT_MOMENTS_SETTINGS.autoPostEnabled,
    firstCommentDelay: typeof raw.firstCommentDelay === 'number' && raw.firstCommentDelay >= 1 && raw.firstCommentDelay <= 3600 ? raw.firstCommentDelay : DEFAULT_MOMENTS_SETTINGS.firstCommentDelay,
    followCommentDelay: typeof raw.followCommentDelay === 'number' && raw.followCommentDelay >= 1 && raw.followCommentDelay <= 3600 ? raw.followCommentDelay : DEFAULT_MOMENTS_SETTINGS.followCommentDelay,
    commentProbability: typeof raw.commentProbability === 'number' && raw.commentProbability >= 0 && raw.commentProbability <= 1 ? raw.commentProbability : DEFAULT_MOMENTS_SETTINGS.commentProbability,
    likeProbability: typeof raw.likeProbability === 'number' && raw.likeProbability >= 0 && raw.likeProbability <= 1 ? raw.likeProbability : DEFAULT_MOMENTS_SETTINGS.likeProbability,
    // #42：转发概率 0-100 百分比，双重钳制（非有限数字回默认；越界拉回 0-100 边界）
    repostProbability:
      typeof raw.repostProbability === 'number' && Number.isFinite(raw.repostProbability)
        ? Math.min(100, Math.max(0, Math.round(raw.repostProbability)))
        : DEFAULT_MOMENTS_SETTINGS.repostProbability,
    npcInteractDelay: typeof raw.npcInteractDelay === 'number' && raw.npcInteractDelay >= 1 && raw.npcInteractDelay <= 3600 ? raw.npcInteractDelay : DEFAULT_MOMENTS_SETTINGS.npcInteractDelay,
    replyNpcCommentDelay: typeof raw.replyNpcCommentDelay === 'number' && raw.replyNpcCommentDelay >= 1 && raw.replyNpcCommentDelay <= 3600 ? raw.replyNpcCommentDelay : DEFAULT_MOMENTS_SETTINGS.replyNpcCommentDelay,
    bilingualEnabled: typeof raw.bilingualEnabled === 'boolean' ? raw.bilingualEnabled : DEFAULT_MOMENTS_SETTINGS.bilingualEnabled,
    foldChineseTranslation: typeof raw.foldChineseTranslation === 'boolean' ? raw.foldChineseTranslation : DEFAULT_MOMENTS_SETTINGS.foldChineseTranslation,
    bilingualPrompt: typeof raw.bilingualPrompt === 'string' ? raw.bilingualPrompt : DEFAULT_MOMENTS_SETTINGS.bilingualPrompt,
  };
}

/**
 * 同步读取某平台的设置（合并默认值，每字段容错）。
 * 首次读取（平台键不存在）时若发现旧共享键 moments-settings，将其作为该平台的初始值
 * 一次性拆分迁移 —— 两个平台各自拿到拆分前的同一份起点，此后互不影响。
 */
export function getMomentsSettings(app: MomentsApp): MomentsSettings {
  const key = settingsKeyOf(app);
  const raw = kvGet(key);
  if (raw != null) return parseSettings(raw);
  const legacy = kvGet(LEGACY_SHARED_SETTINGS_KEY);
  if (legacy != null) {
    const parsed = parseSettings(legacy);
    kvSet(key, { ...parsed, schemaVersion: SETTINGS_SCHEMA_VERSION });
    return parsed;
  }
  return { ...DEFAULT_MOMENTS_SETTINGS };
}

/** 同步写入某平台的设置（patch 部分字段，合并后写 kv；同时落 schemaVersion 标记，避免旧默认值被反复迁移） */
export function saveMomentsSettings(app: MomentsApp, patch: Partial<MomentsSettings>): MomentsSettings {
  const cur = getMomentsSettings(app);
  const next = { ...cur, ...patch };
  kvSet(settingsKeyOf(app), { ...next, schemaVersion: SETTINGS_SCHEMA_VERSION });
  return next;
}

/** 恢复某平台的默认设置（不影响另一平台） */
export function resetMomentsSettings(app: MomentsApp): MomentsSettings {
  kvSet(settingsKeyOf(app), { ...DEFAULT_MOMENTS_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION });
  return { ...DEFAULT_MOMENTS_SETTINGS };
}

// ---------------- UI 选择项常量（已废弃） ----------------
// Task 49-a：UI 改为可输入任意数值的输入框，不再使用固定选项 ActionSheet。
// 以下常量与格式化函数保留导出以防外部引用（grep 确认当前仅本模块定义、UI 不再使用），
// 不再被推荐使用。

/**
 * 最小/最长发帖间隔选项（小时）
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const MIN_POST_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 18, 24];

/**
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const MAX_POST_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 18, 24];

/**
 * 延迟选项（秒）：3s / 10s / 30s / 1min / 3min / 10min / 30min / 60min
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const DELAY_OPTIONS_SEC = [3, 10, 30, 60, 180, 600, 1800, 3600];

/**
 * 概率选项
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const PROBABILITY_OPTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];

/**
 * 延迟秒数 → 显示文案
 * @deprecated Task 49-a：UI 改为输入框直接显示数字，不再格式化显示。
 */
export function formatDelaySec(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  return `${Math.round(sec / 3600)} 小时`;
}

/**
 * 概率 → 百分比文案
 * @deprecated Task 49-a：UI 改为输入框直接显示百分比数字。
 */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}
