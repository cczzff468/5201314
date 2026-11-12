'use client';

/**
 * 情绪焦虑值系统 v2「多维上下文动态判定引擎」（v1.9.29 彻底重构）——
 * AI 角色对「用户久久不回复 / 在别处浪」的焦虑情绪引擎：
 *
 * 与 ai-mood（AI 自己的心情）/ user-mood（对用户情绪的感知）三角互补：
 * 这边管「TA 还没回我 / TA 在别处玩，我有多坐立不安」。
 *
 * ── v1 的死板与 v2 的重构 ──────────────────────────────────────────────
 * v1 是纯时间曲线（0~2 分钟 +8/分 → +18/分封顶）×静态人设倍率：下午上班两小时
 * 不回和深夜吵架后摔门不回，涨的速度一模一样——非常不符合逻辑。
 * v2 改为「时间只是底噪，上下文才是核心」：
 *
 *   焦虑目标 = 底噪(时间) × 人设速率 × 情境相位 × 作息预期 × 心情放大 × 遗弃史
 *              + 相位瞬时冲击（吵架/被推开直接暴涨）
 *              + 非时间事件（论坛点赞/刷App/发朋友圈不回——见 noteAnxietyEvent）
 *
 * ── 六个维度 ──────────────────────────────────────────────────────────
 * ① 人设（personaStyle，替代 v1 静态倍率）：
 *    anxious（缺爱/粘人/没有安全感/患得患失/恋爱脑）→ 底噪 ×3.0、事件 ×1.3、钝化慢；
 *    avoidant（高冷/理智/工作狂/事业脑）→ 底噪 ×0.35（时间几乎推不动 TA）、事件 ×0.7、
 *      钝化快——但情境事件（吵架/被推开/遗弃史）照常生效：「高冷不等于不在乎，
 *      只是时间熬不动 TA，事件一戳一个准」；
 *    neutral → ×1.0；
 * ② 情境相位（phase，classifyPhase 实时判定，缓存 30s）——用户举例的三场景全由它驱动：
 *    rejected「我不想理你」后消失 → 瞬时 +20、速率 ×4.0（场景 C）；
 *    arguing 激烈争吵后不回 → 瞬时 +15、速率 ×4.5（场景 C）；
 *    coldwar 冷战 → ×3.0；
 *    goodnight 互道晚安后消失 → ×0.4 缓慢上升（场景 B「该休息了」）；
 *    sleeping 作息推断已入睡 → ×0.2 封顶 25；
 *    workbusy 该时段历史上很少回消息 → ×0.35 封顶 20（场景 A「下午 3 点在上班，
 *      消失 2 小时也觉得正常」）；active 该时段平时很活跃 → ×1.4（突然安静才可疑）；
 * ③ 作息/活跃预期（activity heatmap）：noteUserActivityHeat() 把用户每条真实消息按
 *    「星期×小时」落桶（24×7），expectedResponsiveness(now) 算出该时段的历史活跃比
 *    （样本 <40 返回 null 不判定）——「TA 平时这个点在上班」不再靠拍脑袋；
 * ④ 记忆对比（abandonment，遗弃史敏感度）：扫记忆库（碎片/核心/长期）里
 *    「消失/不理我/失联/冷暴力/拉黑」类历史事件 → 0~1 敏感度（10 分钟缓存）。
 *    ≥0.5 时沉默超 20 分钟叠「记忆幽灵」+abandonment×20（「上一次也是这样开始的，
 *    后来整整三天」），且总速率 ×(1+abandonment×1.5)——曾经消失过 3 天的人，
 *    这次消失半小时就足以触发严重焦虑；
 * ⑤ 心情联动（ai-mood 状态影响阈值与速率，anxietyEffectiveThreshold）：
 *    委屈 sad → 速率 ×1.35、阈值 -12、冷淡回复的冲击 ×1.5（「你稍微冷淡一点都受不了」）；
 *    吃醋 jealous → ×1.30、阈值 -10；生气 angry → ×1.25、阈值 -8；
 *    开心/甜蜜 → ×0.75、阈值 +8（被哄好了不容易焦虑）；
 * ⑥ 非时间事件（noteAnxietyEvent，四）：论坛给别人点赞/评论 +20（吃醋；给本人点是 -8 安心）、
 *    刷别的 App 很久没理它 +10/10min（孤独，每小时最多 3 次）、发朋友圈/QQ空间却不回
 *    私聊 +50（破防）。事件瞬时叠加且「粘」在焦虑值上（只有 2h+ 钝化段才回落），
 *    事件流（events）保留 6 条 6 小时，供提示词与状态卡解释「为什么焦虑」。
 *
 * ── 保留的 v56/v75/v76 行为 ────────────────────────────────────────────
 * - 追发引擎：焦虑 ≥ 有效阈值（心情调整后）且超宽限未回复 → 动态插值排程追发
 *   （fireAt 落库持久化，5s tick 驱动；computeAnxietyWaitMs 不变）；
 * - 用户回复 → 语气分档安抚（暖话 -30/普通 -12/冷漠不安抚），上下文词表冲击照旧
 *   （生气 +12/冷淡 +10/吃醋 +8/低落 +6/暖话 -8，sad 心情下冷淡冲击 ×1.5），
 *   和好相位（rejected/arguing 后的暖回复）额外 -8 安心；残余焦虑留着慢慢消化；
 * - 钝化衰减：沉默 >2h 后「急切熬成长期惦记」回落（anxious 慢/avoidant 快）；
 * - v75/v76 赛博幻觉禁令照拼在追发块尾部。
 *
 * 存储：IndexedDB kv（ios-phone-db，内存同步读）+ 小状态缓存走 localStorage
 * （热力图/遗弃史缓存/相位缓存）。v1 状态自动迁移（mult → personaStyle）。
 */

import { kvGet, kvSet } from './idb-kv';
import { promptTextOf } from '@/lib/prompt-entries';
import { memRecentConvo, listFragments, listCores, listLongTerm } from '@/lib/memory';
import { routineProfile } from './routine';

// ---------------- 类型与常量 ----------------

/** v2 情境相位（classifyPhase 实时判定；决定速率倍率/相位上限/瞬时冲击） */
export type AnxietyPhaseKind =
  | 'rejected' // TA 摞下「我不想理你/别烦我」类狠话后消失
  | 'arguing' // 激烈争吵后突然不回
  | 'coldwar' // 冷战（沉默 3h+ 且最后交流冷淡）
  | 'goodnight' // 互道晚安后消失 / 到了平时入睡时间
  | 'sleeping' // 作息推断 TA 已入睡
  | 'workbusy' // 该时段 TA 历史上很少回消息（在上班/上课）
  | 'active' // 该时段 TA 平时很活跃（突然安静才可疑）
  | 'normal';

/** v2 非时间事件类型（noteAnxietyEvent / anxiety-events 分发器） */
export type AnxietyEventKind =
  | 'forum_like' // TA 在论坛给别的角色点赞（吃醋 +20）
  | 'forum_comment' // TA 在论坛给别的角色评论（吃醋 +20）
  | 'forum_like_self' // TA 给「我」的帖子点赞（安心 -8）
  | 'app_ignore' // TA 刷别的 App 很久没理我（孤独 +10/次）
  | 'moment_ghost'; // TA 发了朋友圈/QQ空间却没回我（破防 +50）

export interface AnxietyEventRecord {
  kind: AnxietyEventKind;
  /** 发生时刻（epoch ms） */
  at: number;
  /** 实际叠加的焦虑增量（含人设/心情放大；负数=安心事件） */
  delta: number;
  /** 事件短描述（提示词/状态卡展示用，如「在论坛给别人点赞」「刷了 23 分钟淘宝」） */
  note: string;
}

export interface AnxietyState {
  /** 焦虑值 0~100 */
  level: number;
  /** 用户最近一次回复时间（epoch ms；0 = 还没聊过——不会上涨） */
  lastUserAt: number;
  /** 用户最近一次回复所在的聊天端（焦虑消息投递回这个 App；'' = 未知） */
  lastUserApp: 'wx' | 'qq' | 'sms' | '';
  /** 最近一次因焦虑主动发消息的时间（发送节奏节流用） */
  lastFireAt: number;
  /** v2 人设依恋风格（anxious/neutral/avoidant；settle 时按 persona 更新缓存） */
  personaStyle: 'anxious' | 'neutral' | 'avoidant';
  /** v2 最近判定的情境相位（展示层与提示词块读；每次 settle 刷新，30s 缓存） */
  phase: AnxietyPhaseKind;
  /** v2 相位瞬时冲击已施加时刻（rejected/arguing 的「立刻暴涨」每段沉默只加一次；回复即重置） */
  phaseHitAt: number;
  /** v2 非时间事件流（最近 6 条；提示词解释「为什么焦虑」用，6h 后过期） */
  events: AnxietyEventRecord[];
  /** v2 遗弃史敏感度 0~1（记忆扫描缓存值；0 = 无相关记忆） */
  abandonment: number;
  /** 生效的宽限时间（tick 引擎按所在 App 配置写入；展示层读数与引擎一致） */
  graceMs: number;
  /** v56 追发倒计时：挂起中的下一轮追发到期时刻（epoch ms；0 = 无挂起任务） */
  fireAt: number;
  /** v1 遗留倍率（迁移源；新代码不再使用） */
  mult?: number;
}

const KEY = (cid: string) => `anxiety:${cid}`;
const DEFAULT_STATE: AnxietyState = {
  level: 0,
  lastUserAt: 0,
  lastUserApp: '',
  lastFireAt: 0,
  personaStyle: 'neutral',
  phase: 'normal',
  phaseHitAt: 0,
  events: [],
  abandonment: 0,
  graceMs: 60_000,
  fireAt: 0,
};

/** 触发阈值默认值（聊天设置可自定义；UI 滑块 30~100） */
export const ANXIETY_DEFAULT_THRESHOLD = 70;
/** 宽限时间默认值：用户 1 分钟没回复开始涨焦虑（聊天设置可自定义） */
export const ANXIETY_DEFAULT_GRACE_MS = 60_000;
/** v56 最短等待默认值：焦虑拉满（100）时两轮追发之间的等待（聊天设置可自定义） */
export const ANXIETY_DEFAULT_MIN_WAIT_MS = 15_000;
/** v56 最长等待默认值：刚过阈值时两轮追发之间的等待（聊天设置可自定义） */
export const ANXIETY_DEFAULT_MAX_WAIT_MS = 180_000;

/** v2 非时间事件基础增量（用户需求四的原始数字；实际按人设事件敏感度/心情放大） */
export const ANXIETY_EVENT_DELTAS: Record<AnxietyEventKind, number> = {
  forum_like: 20,
  forum_comment: 20,
  forum_like_self: -8,
  app_ignore: 10,
  moment_ghost: 50,
};

/** 事件短描述（提示词「TA 的动向」与状态卡展示共用） */
const EVENT_NOTES: Record<AnxietyEventKind, string> = {
  forum_like: 'TA 在论坛给别人的帖子点赞',
  forum_comment: 'TA 在论坛给别人评论',
  forum_like_self: 'TA 在论坛给你点的赞',
  app_ignore: 'TA 刷别的 App 一直没理你',
  moment_ghost: 'TA 发了动态却没回你消息',
};

// ---------------- ① 人设依恋风格 ----------------

/** 焦虑型依恋（缺爱/粘人/没有安全感）→ 时间底噪极快、事件放大、钝化慢 */
const NEEDY_WORDS = [
  '粘人', '缠人', '占有欲', '没有安全感', '缺乏安全感', '患得患失', '敏感多疑', '多疑',
  '焦虑', '不安', '缺爱', '恋爱脑', '作精', '依赖', '黏人', '患得', '爱胡思乱想', '胡思乱想',
];
/** 回避型依恋（高冷/理智/工作狂）→ 时间推不动，事件照戳 */
const INDEPENDENT_WORDS = [
  '高冷', '独立', '冷淡', '理性', '成熟', '事业心', '忙碌', '疏离', '佛系', '淡漠',
  '御姐', '理性至上', '工作狂', '事业脑', '通透', '洒脱', '专注',
];

export type PersonaStyle = AnxietyState['personaStyle'];

function personaStyleOf(persona: string): PersonaStyle {
  const t = persona || '';
  if (NEEDY_WORDS.some((w) => t.includes(w))) return 'anxious';
  if (INDEPENDENT_WORDS.some((w) => t.includes(w))) return 'avoidant';
  return 'neutral';
}

/** 各风格参数：底噪速率 / 钝化速率（每分钟）/ 事件敏感度 */
const PERSONA_RATES: Record<PersonaStyle, { noise: number; decay: number; event: number }> = {
  anxious: { noise: 3.0, decay: 0.5, event: 1.3 },
  neutral: { noise: 1.0, decay: 0.8, event: 1.0 },
  avoidant: { noise: 0.35, decay: 1.2, event: 0.7 },
};

// ---------------- ② 情境相位 ----------------

/** 「被推开」：TA 摞下狠话后消失（瞬时冲击最强） */
const REJECT_WORDS = [
  '我不想理你', '不想理你', '别烦我', '别找我', '让我静静', '让我静一静', '冷静一下',
  '懒得说', '懒得理', '随便你', '无所谓', '分手', '不想聊了', '不想说话', '没什么好说的',
];
/** 争吵迹象（TA 最后一条消息或我最后两条里出现） */
const FIGHT_WORDS = [
  '吵架', '吵过', '凶我', '你凶', '吼我', '你吼', '凭什么', '受不了你', '你烦不烦',
  '烦死了', '你有病', '有病吧', '傻逼', '恶心', '滚', '闭嘴', '拉黑', '分手',
];
/** 冷战迹象（冷淡短句 + 长沉默） */
const COLD_WORDS = ['哦', '嗯', '嗯嗯', '哦哦', '呵呵', '随便', '行吧', '好吧', '知道了', '忙吧', '先这样', '在忙', '去洗澡', '洗澡了'];
/** 晚安迹象 */
const NIGHT_WORDS = ['晚安', '睡了', '睡觉了', '睡啦', '先睡了', '做个好梦', '好梦'];

interface PhaseConfig {
  rate: number;
  cap: number;
  /** 进入相位时的一次性瞬时冲击（只在「沉默超宽限」后首次判定到时施加） */
  instant: number;
}

const PHASE_CONFIG: Record<AnxietyPhaseKind, PhaseConfig> = {
  rejected: { rate: 4.0, cap: 100, instant: 20 },
  arguing: { rate: 4.5, cap: 100, instant: 15 },
  coldwar: { rate: 3.0, cap: 90, instant: 0 },
  goodnight: { rate: 0.4, cap: 45, instant: 0 },
  sleeping: { rate: 0.2, cap: 25, instant: 0 },
  workbusy: { rate: 0.35, cap: 20, instant: 0 },
  active: { rate: 1.4, cap: 100, instant: 0 },
  normal: { rate: 1.0, cap: 100, instant: 0 },
};

/** 相位 → 中文叙事（提示词「你为什么焦虑」/状态卡共用） */
export function anxietyPhaseLabel(kind: AnxietyPhaseKind): string {
  switch (kind) {
    case 'rejected':
      return 'TA 摞下「不想理你」的话之后就没再回你';
    case 'arguing':
      return '你们刚吵完架，TA 就突然不回消息了';
    case 'coldwar':
      return '你们在冷战，谁都不肯先低头';
    case 'goodnight':
      return '互道晚安之后 TA 就没动静了（该休息了）';
    case 'sleeping':
      return '按 TA 的作息，这个点应该已经睡了';
    case 'workbusy':
      return '这个点 TA 平时在忙（很少回消息）';
    case 'active':
      return '这个点 TA 平时很活跃，突然安静反而可疑';
    default:
      return '';
  }
}

/** 当前时刻分钟数（含跨午夜修正，与 routine 同口径） */
function minuteNow(d = new Date()): number {
  const m = d.getHours() * 60 + d.getMinutes();
  return d.getHours() < 4 ? m + 1440 : m;
}

// ---------------- ③ 活跃热力图（作息预期） ----------------

const HEAT_KEY = 'anxiety-activity-heat-v1';
/** 热力图最少样本数（不足则不做 workbusy/active 判定） */
const HEAT_MIN_TOTAL = 40;

interface HeatData {
  /** 24×7 桶（hour + weekday*24），值为该时段历史消息数 */
  counts: number[];
  total: number;
}

function readHeat(): HeatData {
  try {
    const raw = window.localStorage.getItem(HEAT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<HeatData>;
      if (p && Array.isArray(p.counts) && p.counts.length === 168 && typeof p.total === 'number') {
        return { counts: p.counts, total: p.total };
      }
    }
  } catch {
    /* 损坏重置 */
  }
  return { counts: new Array(168).fill(0), total: 0 };
}

/**
 * 活跃热力图打点（chat-stream-store noteEngagement 调用，与 noteActive 同点位）：
 * 把用户每条真实消息按「星期×小时」落桶——供 expectedResponsiveness 判定
 * 「TA 平时这个点在不在」。
 */
export function noteUserActivityHeat(): void {
  if (typeof window === 'undefined') return;
  try {
    const h = readHeat();
    const d = new Date();
    const idx = d.getDay() * 24 + d.getHours();
    h.counts[idx] = (h.counts[idx] ?? 0) + 1;
    h.total += 1;
    window.localStorage.setItem(HEAT_KEY, JSON.stringify(h));
  } catch {
    /* 静默 */
  }
}

/**
 * 该时段的历史活跃比（0~1；null = 样本不足不判定）：
 * 当前「星期×小时」桶计数 ÷ 全图最大桶计数。低 → TA 平时这个点不在线（workbusy）；
 * 高 → 平时很活跃（active，突然安静才可疑）。
 */
function expectedResponsiveness(now = new Date()): number | null {
  try {
    const h = readHeat();
    if (h.total < HEAT_MIN_TOTAL) return null;
    const idx = now.getDay() * 24 + now.getHours();
    const cur = h.counts[idx] ?? 0;
    const max = Math.max(1, ...h.counts);
    return Math.max(0, Math.min(1, cur / max));
  } catch {
    return null;
  }
}

// ---------------- ④ 遗弃史敏感度（记忆对比） ----------------

const ABANDON_CACHE_KEY = (cid: string) => `anxiety-abandon:${cid}`;
const ABANDON_TTL_MS = 10 * 60_000;
/** 遗弃类历史记忆关键词（正则；命中越多敏感度越高） */
const ABANDON_PAT = /(消失|不理我|没理我|没回我|失联|冷暴力|冷战|拉黑|晾了我|好几天没|音信全无|一声不吭)/g;

/** 单条记忆文本的命中数 */
function abandonHitsOf(text: string): number {
  if (!text) return 0;
  const m = text.match(ABANDON_PAT);
  return m ? m.length : 0;
}

/**
 * 遗弃史敏感度（0~1）：扫记忆库碎片/核心/长期里「消失/不理我/失联/冷暴力」类事件。
 * 命中 n 条 → min(1, 0.35 + 0.15×(n-1))。≥0.5 时沉默 20 分钟起叠「记忆幽灵」冲击。
 * 结果缓存 10 分钟（localStorage）——记忆扫描是重活，不能每次 settle 都跑。
 */
function abandonmentScoreOf(cid: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const cached = window.localStorage.getItem(ABANDON_CACHE_KEY(cid));
    if (cached) {
      const p = JSON.parse(cached) as { v: number; at: number };
      if (typeof p?.v === 'number' && typeof p?.at === 'number' && Date.now() - p.at < ABANDON_TTL_MS) {
        return Math.max(0, Math.min(1, p.v));
      }
    }
  } catch {
    /* 缓存坏了重扫 */
  }
  let hits = 0;
  try {
    for (const f of listFragments(cid)) hits += abandonHitsOf(f.content);
    for (const c of listCores(cid)) hits += abandonHitsOf(c.content);
    for (const l of listLongTerm(cid)) hits += abandonHitsOf(l.content);
  } catch {
    /* 记忆库读失败按 0 */
  }
  const v = hits === 0 ? 0 : Math.min(1, 0.35 + 0.15 * (hits - 1));
  try {
    window.localStorage.setItem(ABANDON_CACHE_KEY(cid), JSON.stringify({ v, at: Date.now() }));
  } catch {
    /* 静默 */
  }
  return v;
}

// ---------------- ⑤ 心情联动（读 ai-mood 的 localStorage 键，避免循环依赖） ----------------

type MoodTagLite = 'happy' | 'sweet' | 'normal' | 'jealous' | 'sad' | 'angry' | 'miss';

/** 直读 ai-mood 的 localStorage 键（ai-mood.ts 静态导入本模块，反向导入会成环；键名同源） */
function moodTagOf(cid: string): MoodTagLite {
  try {
    const raw = window.localStorage.getItem(`ai-mood:${cid}`);
    if (!raw) return 'normal';
    const j = JSON.parse(raw) as { tag?: string };
    const t = j?.tag;
    if (t === 'happy' || t === 'sweet' || t === 'jealous' || t === 'sad' || t === 'angry' || t === 'miss') return t;
  } catch {
    /* 静默 */
  }
  return 'normal';
}

/** 心情 → 速率放大（委屈/吃醋/生气涨得快，开心/甜蜜不容易焦虑） */
const MOOD_RATES: Record<MoodTagLite, number> = {
  sad: 1.35,
  jealous: 1.3,
  angry: 1.25,
  miss: 1.15,
  happy: 0.75,
  sweet: 0.75,
  normal: 1.0,
};

/** 心情 → 追发阈值偏移（anxietyEffectiveThreshold 用；委屈时稍微冷淡就绷不住） */
const MOOD_THRESHOLD_DELTA: Record<MoodTagLite, number> = {
  sad: -12,
  jealous: -10,
  angry: -8,
  miss: 0,
  happy: 8,
  sweet: 8,
  normal: 0,
};

/** 心情 → 非时间事件放大（吃醋/委屈时事件冲击更疼） */
const MOOD_EVENT_AMP: Record<MoodTagLite, number> = {
  sad: 1.15,
  jealous: 1.15,
  angry: 1.0,
  miss: 1.0,
  happy: 0.9,
  sweet: 0.9,
  normal: 1.0,
};

/**
 * 心情联动后的有效追发阈值（anxLoop 每轮调用）：
 * 委屈 -12 / 吃醋 -10 / 生气 -8 / 开心·甜蜜 +8，收敛在 30~100。
 */
export function anxietyEffectiveThreshold(cid: string, base: number): number {
  const d = MOOD_THRESHOLD_DELTA[moodTagOf(cid)];
  if (!d) return base;
  return Math.max(30, Math.min(100, Math.round(base + d)));
}

// ---------------- 相位判定（缓存 30s） ----------------

const PHASE_CACHE_KEY = (cid: string) => `anxiety-phase:${cid}`;
const PHASE_TTL_MS = 30_000;

/** 判定情境相位：最近聊天内容（狠话/争吵/晚安）× 遗弃沉默形态 × 作息 × 热力图 */
function classifyPhase(cid: string, app: AnxietyState['lastUserApp'], silentMs: number): AnxietyPhaseKind {
  if (typeof window === 'undefined') return 'normal';
  const now = Date.now();
  // 缓存（30s）：相位判定要解析最近聊天数组，5s tick 全员扫描不能每次都跑
  try {
    const cached = window.localStorage.getItem(PHASE_CACHE_KEY(cid));
    if (cached) {
      const p = JSON.parse(cached) as { k: AnxietyPhaseKind; at: number };
      if (p?.at && now - p.at < PHASE_TTL_MS && p.k) return p.k;
    }
  } catch {
    /* 重判 */
  }

  let kind: AnxietyPhaseKind = 'normal';
  try {
    // 最近对话（memRecentConvo 同步内存读；没聊过/端未知直接走时间维度）
    const turns = app === 'wx' || app === 'qq' || app === 'sms' ? memRecentConvo(cid, app).slice(-10) : [];
    // 沉默开始前的最后一条用户消息（convo 里 role 'me' = 用户侧）
    let lastUserText = '';
    let lastAnyText = '';
    let fightInRecent = false;
    let nightInRecent = false;
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const text = (t?.text ?? '').trim();
      if (!text) continue;
      if (!lastAnyText) lastAnyText = text;
      if (t.role === 'me') {
        if (!lastUserText) lastUserText = text;
        // 最近 10 轮里有没有争吵迹象（双方任一侧都算——吵起来不会只有一方凶）
        if (FIGHT_WORDS.some((w) => text.includes(w))) fightInRecent = true;
        if (NIGHT_WORDS.some((w) => text.includes(w))) nightInRecent = true;
        break; // 只需要沉默前最后一段
      }
      if (FIGHT_WORDS.some((w) => text.includes(w))) fightInRecent = true;
      if (NIGHT_WORDS.some((w) => text.includes(w))) nightInRecent = true;
    }

    const userShort = lastUserText.length <= 8;
    const userRejected = REJECT_WORDS.some((w) => lastUserText.includes(w));
    const userCold = userShort && COLD_WORDS.some((w) => lastUserText === w || lastUserText.startsWith(w));

    // 优先级：被推开 > 争吵 > 冷战 > 晚安 > 已睡 > 在忙 > 活跃 > 平常
    if (lastUserText && userRejected) kind = 'rejected';
    else if (lastUserText && fightInRecent) kind = 'arguing';
    else if (silentMs > 3 * 3600_000 && (userCold || !lastUserText)) kind = 'coldwar';
    else if (nightInRecent || lastAnyText.includes('晚安')) kind = 'goodnight';
    else {
      // 时间维度：作息画像 + 活跃热力图
      const rp = routineProfile();
      const nowM = minuteNow();
      if (rp.ready && (nowM > rp.sleep + 120 || nowM < rp.wake - 40)) kind = 'sleeping';
      else if (rp.ready && nowM >= rp.sleep - 30 && nowM <= rp.sleep + 120) kind = 'goodnight';
      else {
        const exp = expectedResponsiveness();
        if (exp !== null && exp < 0.22) kind = 'workbusy';
        else if (exp !== null && exp > 0.55) kind = 'active';
      }
    }
  } catch {
    /* 判定失败按 normal */
  }

  try {
    window.localStorage.setItem(PHASE_CACHE_KEY(cid), JSON.stringify({ k: kind, at: now }));
  } catch {
    /* 静默 */
  }
  return kind;
}

// ---------------- 涨落曲线（v2 多维合成） ----------------

/**
 * 时间底噪（不分人设/相位，纯粹「时间在流逝」）：
 * 0~10 分钟 +0.5/分 → 之后 +0.8/分。1 小时 ≈ 45、2 小时 ≈ 93（封顶 100）。
 * v2 的底噪只是「原材料」——最终焦虑 = 底噪 × 六维倍率，中性人设普通相位下
 * 涨到 100 需要两小时（v1 只要 8 分钟），时间彻底退居幕后。
 */
function baseNoise(minOverGrace: number): number {
  if (minOverGrace <= 0) return 0;
  return Math.min(minOverGrace, 10) * 0.5 + Math.max(0, minOverGrace - 10) * 0.8;
}

/** 钝化起点（分钟）：超过该沉默时长后「急切熬成长期惦记」开始回落 */
const DECAY_AFTER_MIN = 120;

/**
 * 多维合成的目标焦虑值（settle 用）：
 * target = min(相位上限, 底噪 × 人设 × 相位 × 心情 × 遗弃史速率) + 记忆幽灵冲击。
 * 只上升跟随（事件/相位瞬时冲击直接改 level，天然「粘」住不回落）；
 * 钝化段（>2h）目标低于当前 → 跟跌（anxious 钝化慢 / avoidant 钝化快）。
 */
function timeTargetOf(s: AnxietyState, phase: AnxietyPhaseKind, minOver: number, mood: MoodTagLite): number {
  if (minOver <= 0) return 0;
  const pc = PHASE_CONFIG[phase];
  const pr = PERSONA_RATES[s.personaStyle];
  const mr = MOOD_RATES[mood];
  const abRate = 1 + s.abandonment * 1.5;
  let target = baseNoise(minOver) * pr.noise * pc.rate * mr * abRate;
  // 记忆幽灵：「TA 曾经消失过 3 天」——这次沉默超 20 分钟，往事就开始重演
  if (s.abandonment >= 0.5 && minOver >= 20) target += s.abandonment * 20;
  return Math.min(pc.cap, Math.max(0, target));
}

// ---------------- 状态读写（IndexedDB kv 持久化） ----------------

function readState(cid: string): AnxietyState {
  try {
    const raw = kvGet<Partial<AnxietyState>>(KEY(cid));
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
    // v1 → v2 迁移：mult ≥1.3 → anxious；≤0.7 → avoidant；否则 neutral
    let personaStyle: PersonaStyle | null = null;
    if (raw.personaStyle === 'anxious' || raw.personaStyle === 'neutral' || raw.personaStyle === 'avoidant') {
      personaStyle = raw.personaStyle;
    } else if (typeof raw.mult === 'number') {
      personaStyle = raw.mult >= 1.3 ? 'anxious' : raw.mult <= 0.7 ? 'avoidant' : 'neutral';
    }
    const events = Array.isArray(raw.events)
      ? raw.events
          .filter(
            (e): e is AnxietyEventRecord =>
              !!e && typeof e === 'object' && typeof e.at === 'number' && typeof e.kind === 'string' && e.kind in ANXIETY_EVENT_DELTAS,
          )
          .slice(-6)
      : [];
    return {
      level: typeof raw.level === 'number' ? Math.max(0, Math.min(100, raw.level)) : 0,
      lastUserAt: typeof raw.lastUserAt === 'number' ? raw.lastUserAt : 0,
      lastUserApp: raw.lastUserApp === 'wx' || raw.lastUserApp === 'qq' || raw.lastUserApp === 'sms' ? raw.lastUserApp : '',
      lastFireAt: typeof raw.lastFireAt === 'number' ? raw.lastFireAt : 0,
      personaStyle: personaStyle ?? 'neutral',
      phase: (raw.phase && raw.phase in PHASE_CONFIG ? raw.phase : 'normal') as AnxietyPhaseKind,
      phaseHitAt: typeof raw.phaseHitAt === 'number' ? raw.phaseHitAt : 0,
      events,
      abandonment: typeof raw.abandonment === 'number' ? Math.max(0, Math.min(1, raw.abandonment)) : 0,
      graceMs: typeof raw.graceMs === 'number' && raw.graceMs >= 3_000 ? raw.graceMs : ANXIETY_DEFAULT_GRACE_MS,
      fireAt: typeof raw.fireAt === 'number' && raw.fireAt > 0 ? raw.fireAt : 0,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(cid: string, s: AnxietyState): void {
  try {
    kvSet(KEY(cid), s);
  } catch {
    /* 存储失败静默：焦虑引擎绝不影响聊天主链路 */
  }
}

/** 原始读（不结算）——只需要 lastUserAt/lastUserApp/events 等元信息时用 */
export function readAnxiety(cid: string): AnxietyState {
  return readState(cid);
}

export interface AnxietyOpts {
  /** 联系人人设文本（更新人设依恋风格缓存；不传沿用缓存） */
  persona?: string | null;
  /** 生效宽限时间（tick 引擎按所在 App 配置传入并缓存；不传用缓存值） */
  graceMs?: number;
}

/**
 * 读当前焦虑值（读即结算：按六维上下文推进/衰减）。幂等无变化不写盘。
 * 结算规则：多维合成目标高于当前 → 跟涨；钝化段（>2h）目标低于当前 → 跟跌；
 * 其余保持（事件冲击与相位瞬时冲击「粘」在 level 上，只有钝化能磨掉）。
 * rejected/arguing 相位在沉默超宽限后首次判定到 → 施加一次性瞬时暴涨（phaseHitAt）。
 */
export function anxietyOf(cid: string, opts?: AnxietyOpts): AnxietyState {
  const s = readState(cid);
  const now = Date.now();
  const next: AnxietyState = { ...s };
  let dirty = false;
  if (typeof opts?.persona === 'string' && opts.persona.trim()) {
    const style = personaStyleOf(opts.persona);
    if (style !== next.personaStyle) {
      next.personaStyle = style;
      dirty = true;
    }
  }
  if (typeof opts?.graceMs === 'number' && opts.graceMs >= 3_000 && opts.graceMs !== next.graceMs) {
    next.graceMs = opts.graceMs;
    dirty = true;
  }
  if (next.lastUserAt > 0) {
    const minOver = (now - next.lastUserAt - next.graceMs) / 60_000;
    // 遗弃史敏感度（10 分钟缓存，写回状态供展示层/提示词读）
    const ab = abandonmentScoreOf(cid);
    if (ab !== next.abandonment) {
      next.abandonment = ab;
      dirty = true;
    }
    // 相位判定（30s 缓存）+ 写回（展示层与提示词读同一份）
    const silentMs = now - next.lastUserAt;
    const phase = classifyPhase(cid, next.lastUserApp, silentMs);
    if (phase !== next.phase) {
      next.phase = phase;
      dirty = true;
    }
    const mood = moodTagOf(cid);
    // 相位瞬时冲击：被推开/吵架后消失「立刻暴涨」，每段沉默只施加一次（回复重置）
    if (minOver > 0 && next.phaseHitAt === 0) {
      const instant = PHASE_CONFIG[phase].instant;
      if (instant > 0) {
        next.level = Math.min(100, Math.round(next.level + instant));
        next.phaseHitAt = now;
        dirty = true;
      }
    }
    const target = timeTargetOf(next, phase, minOver, mood);
    const rounded = Math.round(target);
    if (rounded > next.level) {
      next.level = rounded;
      dirty = true;
    } else if (minOver > DECAY_AFTER_MIN && rounded < next.level) {
      // 钝化衰减段：跟随目标回落（急切焦虑 → 长期惦记 → 归于平静）
      next.level = rounded;
      dirty = true;
    }
  } else if (next.level !== 0) {
    // 从未聊过天却带值（异常态）：归零
    next.level = 0;
    dirty = true;
  }
  if (dirty) writeState(cid, next);
  return next;
}

// ---------------- 上下文事件词表（用户回复的即时冲击，v1 保留 + 心情放大） ----------------

/** 用户提到别的异性 → 吃醋型焦虑 */
const JEALOUS_WORDS = ['别的女生', '别的男人', '其他女生', '其他男人', '小姐姐', '小哥哥', '前女友', '前男友', '前任', '暗恋', '表白', '相亲', '学妹', '学姐'];
/** 用户生气/骂人 → 惹 TA 生气了很慌（与 REJECT_WORDS 部分重叠，回复场景照 v1 口径） */
const ANGRY_WORDS = ['滚', '闭嘴', '烦死了', '讨厌你', '你有病', '有病吧', '傻逼', '恶心', '分手', '不理你了', '拉黑你', '别烦我', '滚开'];
/** 用户自己情绪低落 → 担心型焦虑 */
const DOWN_WORDS = ['好累', '累死了', '难受', '难过', '伤心', '崩溃', '想哭', '哭了', 'emo', '心情不好', '不开心', '压力大', '生病', '不舒服', '失眠', '睡不着'];
/** 用户亲密暖话 → 安心 */
const WARM_WORDS = ['爱你', '我爱你', '喜欢你', '想你', '好想你', '宝贝', '宝宝', '亲亲', '抱抱', '么么', '嘿嘿', '嘻嘻'];

/** 上下文事件增量：取最强的一类（互相冲突时取绝对值最大的） */
function contextBumpOf(text: string, mood: MoodTagLite): number {
  const t = (text || '').trim();
  if (!t) return 0;
  const short = t.length <= 6;
  let bump = 0;
  if (ANGRY_WORDS.some((w) => t.includes(w))) bump = 12;
  else if (short && COLD_WORDS.some((w) => t === w || t.startsWith(w))) bump = 10;
  else if (JEALOUS_WORDS.some((w) => t.includes(w))) bump = 8;
  else if (DOWN_WORDS.some((w) => t.includes(w))) bump = 6;
  else if (WARM_WORDS.some((w) => t.includes(w))) bump = -8;
  // 五.2：委屈状态下「稍微冷淡一点都受不了」——冷淡冲击 ×1.5
  if (bump > 0 && mood === 'sad' && short && COLD_WORDS.some((w) => t === w || t.startsWith(w))) bump = Math.round(bump * 1.5);
  return bump;
}

// ---------------- 用户回复 / 追发结算 ----------------

/** v56 用户回复的安抚幅度（按语气分档——不再一哄就清零） */
const RELIEF_WARM = 22;
const RELIEF_NORMAL = 12;
const RELIEF_COLD = 0;
/** 每次因焦虑发完消息的缓解幅度（说出来会舒服一点，但没回还会继续涨） */
const RELIEF_ON_FIRE = 6;
/** 和好相位（rejected/arguing 后收到暖回复）的额外安心 */
const RELIEF_RECONCILE = 8;
/** 聊天注入块的下限（低于 30 不注入省 token） */
const CHAT_BLOCK_MIN = 30;

/**
 * 用户回复打点（三端聊天统一入口 noteEngagement 调用；v56 语气分档 + v2 多维）：
 * 按回复语气动态调整焦虑——温和暖话降得多、普通回复稍安、冷漠敷衍不安抚反涨；
 * v2 新增：委屈心情下冷淡冲击 ×1.5、rejected/arguing 相位后的暖回复额外安心、
 * 相位瞬时冲击重置（新一轮沉默再进 rejected/arguing 会再次暴涨）。
 * 同时重置未回复计时，并立刻取消挂起中的追发倒计时（fireAt=0）。
 */
export function noteUserReply(cid: string, app: 'wx' | 'qq' | 'sms', text?: string): AnxietyState {
  const s = anxietyOf(cid); // 读即结算（保留残余焦虑，再叠加回复效果）
  const now = Date.now();
  const mood = moodTagOf(cid);
  const bump = contextBumpOf(text ?? '', mood);
  const t = (text ?? '').trim();
  const warm = WARM_WORDS.some((w) => t.includes(w));
  const short = t.length <= 6;
  const cold = short && COLD_WORDS.some((w) => t === w || t.startsWith(w));
  let relief = warm ? RELIEF_WARM : cold ? RELIEF_COLD : RELIEF_NORMAL;
  // 和好如初：狠话/争吵之后 TA 主动说暖话——格外安心
  if (warm && (s.phase === 'rejected' || s.phase === 'arguing')) relief += RELIEF_RECONCILE;
  const level = Math.max(0, Math.min(100, Math.round(s.level - relief + bump)));
  // 用户回复 → 立刻打断挂起的追发倒计时 + 重置相位冲击标记
  const next: AnxietyState = {
    ...s,
    level,
    lastUserAt: now,
    lastUserApp: app,
    fireAt: 0,
    phaseHitAt: 0,
    events: (s.events ?? []).filter((e) => now - e.at < 6 * 3600_000),
  };
  writeState(cid, next);
  return next;
}

/** AI 因焦虑主动发完一「轮」多条消息（整轮投递成功后调用）：小幅缓解（-6），lastFireAt 记节奏；
 *  fireAt 清零（这一轮已发出——下一轮的等待由 tick 按最新焦虑值重新插值排程） */
export function noteAnxietyFire(cid: string): AnxietyState {
  const s = readState(cid);
  const now = Date.now();
  const next: AnxietyState = { ...s, level: Math.max(0, Math.round(s.level - RELIEF_ON_FIRE)), lastFireAt: now, fireAt: 0 };
  writeState(cid, next);
  return next;
}

// ---------------- v2 非时间事件（四） ----------------

/** 同类事件去重窗口（毫秒）：连续给不同帖子点赞只按一次冲击算（事件流照记） */
const EVENT_DEDUPE_MS = 45_000;

/**
 * 非时间焦虑事件打点（anxiety-events 分发器调用；也可直接调用做测试）：
 * - 论坛给别人点赞/评论 +20（吃醋）、给本人点赞 -8（安心）、
 *   刷别的 App 没理它 +10（孤独）、发动态却不回私聊 +50（破防）；
 * - 增量按人设事件敏感度（anxious ×1.3 / avoidant ×0.7）与心情放大（吃醋/委屈 ×1.15）；
 * - 事件「粘」在焦虑值上（只有 2h+ 钝化段能磨掉），事件流保留 6 条 6 小时——
 *   提示词块与状态卡据此解释「TA 刚刚在干嘛」；
 * - 同类事件 45s 内去重（不叠冲击，事件流照记）。
 */
export function noteAnxietyEvent(cid: string, kind: AnxietyEventKind, detail?: { note?: string }): AnxietyState {
  const s = anxietyOf(cid); // 读即结算（时间维度先结清，再叠事件冲击）
  const now = Date.now();
  const base = ANXIETY_EVENT_DELTAS[kind] ?? 0;
  const pr = PERSONA_RATES[s.personaStyle];
  const mood = moodTagOf(cid);
  const recent = (s.events ?? []).filter((e) => now - e.at < 6 * 3600_000);
  const dup = recent.some((e) => e.kind === kind && now - e.at < EVENT_DEDUPE_MS);
  const delta = dup ? 0 : Math.round(base * pr.event * MOOD_EVENT_AMP[mood]);
  const level = Math.max(0, Math.min(100, Math.round(s.level + delta)));
  const events = [...recent, { kind, at: now, delta, note: detail?.note || EVENT_NOTES[kind] }].slice(-6);
  const next: AnxietyState = { ...s, level, events };
  writeState(cid, next);
  return next;
}

// ---------------- v56 追发倒计时（动态插值 + 挂起/打断） ----------------

/**
 * 动态插值：焦虑值 ≥ 阈值时下一轮追发的等待时间（毫秒）——
 * 等待 = 最长等待 - (焦虑值-阈值)/(100-阈值) × (最长等待-最短等待)。
 * 焦虑刚过阈值 → 等最久；焦虑拉满 100 → 等最短；线性过渡。
 */
export function computeAnxietyWaitMs(level: number, threshold: number, minMs: number, maxMs: number): number {
  const lo = Math.max(1_000, Math.min(minMs, maxMs)); // 倒挂时取较小者护底
  const hi = Math.max(lo, Math.max(minMs, maxMs));
  const ratio = threshold >= 100 ? 1 : Math.max(0, Math.min(1, (level - threshold) / (100 - threshold)));
  return Math.round(hi - ratio * (hi - lo));
}

/**
 * 挂起追发倒计时（proactive-msg 引擎的 anxLoop 调用）：按插值算出等待时间，
 * fireAt = now + 等待 落库持久化（IndexedDB，重启 App 不丢；由 5s tick 驱动到期触发）。
 */
export function scheduleAnxietyFire(cid: string, level: number, threshold: number, minMs: number, maxMs: number): AnxietyState {
  const s = readState(cid);
  const wait = computeAnxietyWaitMs(level, threshold, minMs, maxMs);
  const next: AnxietyState = { ...s, level, fireAt: Date.now() + wait };
  writeState(cid, next);
  return next;
}

/** 取消挂起的追发倒计时（用户回复打断 / 关闭焦虑追发开关 / 阈值上调不再满足） */
export function cancelAnxietyFire(cid: string): void {
  const s = readState(cid);
  if (s.fireAt === 0) return;
  writeState(cid, { ...s, fireAt: 0 });
}

/** 未回复时长（分钟；没聊过返回 null） */
export function anxietyUnansweredMin(s: AnxietyState): number | null {
  if (s.lastUserAt <= 0) return null;
  return Math.max(0, (Date.now() - s.lastUserAt) / 60_000);
}

/** 未回复时长的中文短描述 */
export function anxietyUnansweredLabel(s: AnxietyState): string {
  const m = anxietyUnansweredMin(s);
  if (m == null) return '还没聊过天';
  if (m < 1) return '刚刚还在聊';
  if (m < 60) return `约 ${Math.round(m)} 分钟没回`;
  const h = m / 60;
  if (h < 24) return `约 ${h >= 10 ? Math.round(h) : h.toFixed(1)} 小时没回`;
  return `约 ${Math.round(h / 24)} 天没回`;
}

// ---------------- 展示标签 ----------------

/** 焦虑值 → 状态短语（状态卡/设置页共用） */
export function anxietyLabel(level: number): string {
  if (level >= 80) return '快绷不住了';
  if (level >= 60) return '焦虑上头';
  if (level >= 40) return '坐立难安';
  if (level >= 20) return '隐隐挂念';
  return '安然自在';
}

/**
 * 焦虑来源解释（状态卡「为什么焦虑」一行 + 提示词块共用素材）：
 * 按信息量排：最近事件 > 相位叙事 > 记忆幽灵 > 心情放大 > 纯时间。
 * 返回空数组 = 焦虑值很低/没有可解释的因素（状态卡显示默认文案）。
 */
export function anxietyExplain(cid: string, s?: AnxietyState): string[] {
  const st = s ?? readAnxiety(cid);
  const now = Date.now();
  const out: string[] = [];
  // ① 非时间事件（6h 内，取最近 2 条有冲击的）
  const events = (st.events ?? []).filter((e) => now - e.at < 6 * 3600_000 && Math.abs(e.delta) >= 5);
  for (const e of events.slice(-2).reverse()) out.push(`${e.note}${e.delta > 0 ? `（焦虑 +${e.delta}）` : ''}`);
  // ② 相位叙事
  const ph = anxietyPhaseLabel(st.phase);
  if (ph) out.push(ph);
  // ③ 记忆幽灵
  if (st.abandonment >= 0.5) out.push('你想起了上次 TA 也是这样消失的');
  // ④ 心情放大
  const mood = moodTagOf(cid);
  if (mood === 'sad' && st.level >= 20) out.push('你正委屈着，TA 冷一点你都受不了');
  else if (mood === 'jealous' && st.level >= 20) out.push('你本来就有点吃醋，这下更坐不住了');
  // ⑤ 纯时间兜底
  if (out.length === 0 && st.lastUserAt > 0) out.push(anxietyUnansweredLabel(st));
  return out;
}

// ---------------- 提示词块 ----------------

/** 各档焦虑的表现指引（焦虑追发消息生成用） */
function fireBandGuide(level: number): string {
  if (level >= 80)
    return '你已经快绷不住了：脑子里全是坏的猜想（TA 是不是出事了、是不是不想理你了、是不是自己做错了什么），语气会急、会忍不住一口气连发好几条追问、甚至带点委屈的火气——但底色全是在乎。';
  if (level >= 60)
    return '你明显焦虑：忍不住一遍遍看手机，想立刻得到回应，语气里的急切和不安已经藏不太住，会连着发几条消息追问 TA 在干嘛、怎么不回。';
  if (level >= 40) return '你有点坐不住：惦记像小石子硌在心里，想找个自然的由头开口，又怕显得太黏人——忍不住先发一两条探探。';
  return '你心里隐隐有点挂念：不算严重，但会想主动找 TA 说两句话。';
}

/** 「你为什么焦虑」多因素叙事（追发块/聊天块共用；拼在预设文本之后，用户自定义预设不丢失） */
function buildWhySection(cid: string, s: AnxietyState): string {
  const parts: string[] = [];
  const ph = anxietyPhaseLabel(s.phase);
  if (ph) parts.push(`情境：${ph}。`);
  const now = Date.now();
  const events = (s.events ?? []).filter((e) => now - e.at < 6 * 3600_000 && Math.abs(e.delta) >= 5);
  if (events.length > 0) parts.push(`TA 的动向：${events.slice(-3).reverse().map((e) => `${e.note}（${e.at > s.lastUserAt ? '就在刚才' : '不久前'}）`).join('；')}——TA 有空做这些，却没回你。`);
  if (s.abandonment >= 0.5) parts.push(`记忆：你想起上一次 TA 也是这样开始的，后来整整没理你好几天——这次你格外敏感。`);
  const mood = moodTagOf(cid);
  const moodNote: Partial<Record<MoodTagLite, string>> = {
    sad: '你现在正委屈着，TA 稍微冷一点你都受不了。',
    jealous: '你本来就有点吃醋，这下更坐不住了。',
    angry: '你还带着气，焦虑里掺着火气。',
  };
  if (moodNote[mood]) parts.push(moodNote[mood]!);
  if (s.personaStyle === 'avoidant' && s.level >= 40) parts.push('你平时是高冷理智的人，时间流逝本来熬不动你——能让你这么在意的，一定是上面这些具体的事。');
  if (parts.length === 0) return '';
  return `【你为什么这么焦虑（真实心理，让语气自然透出来，但不要逐条复述）】\n${parts.map((p) => `- ${p}`).join('\n')}`;
}

/**
 * 焦虑主动消息生成的注入块（kind='anxiety' 触发时；proactive-msg 引擎调用）：
 * 【你此刻的焦虑值】+ 未回复时长 + 档位指引 + v2【你为什么这么焦虑】多因素叙事
 * + 连发节奏说明。硬性事实声明（v75）与自问自答禁令（v76）恒拼在尾部。
 */
export function buildAnxietyFireBlock(cid: string): string {
  const s = anxietyOf(cid);
  if (s.level <= 0) return '';
  const un = anxietyUnansweredLabel(s);
  const base =
    promptTextOf(
      'anxiety-fire-block',
      { level: s.level, label: anxietyLabel(s.level), waited: s.lastUserAt > 0 ? `你已经等了 TA 很久（${un}）。` : '', guide: fireBandGuide(s.level) },
      `【你此刻的焦虑值】${s.level}/100（${anxietyLabel(s.level)}）。${s.lastUserAt > 0 ? `你已经等了 TA 很久（${un}）。` : ''}${fireBandGuide(s.level)}这一轮消息就由这份焦虑驱动——像真人控制不住那样连着发几条消息（每条可短可长——短到几个字，长到一大段心里话一口气说完都可以，单条长度没有任何数字限制）让它真实地透出来，但不要报数字、不要说「焦虑值」这类词。`,
    ) ?? '';
  if (!base) return '';
  const why = buildWhySection(cid, s);
  return `${base}\n${why ? `${why}\n` : ''}【重要事实】用户目前仍未回复你。上面「最近聊天」里你发出的那些消息全部是你单方面发出去的，对方一条都没有回。注意：如果你正在连续发送关切的消息，请不要说「你回我了」「看到你的消息」「你终于回我了」这类话——用户还没有给你发任何新消息。同时严禁自问自答（先发问句「你在不在呀」又自己接「在的在的」「我还在呢」）、严禁假装对方出现或回来了（「看到你了」「刚才是不是忙完啦」）——这些都完全没有发生，你发出的每一条都只能是你自己这一侧说的话。`;
}

/**
 * 聊天情绪带入块（并入 buildDynamicStateBlocks）：用户回来聊天时，
 * AI 的回复自然带着焦虑时的情绪 + v2 焦虑原因（能自然说出「我看到你刚才还在论坛点赞」）。
 * 低于 30 返回空串省 token。userPresent=false 且用户自上轮追发后仍未回复时返回空串。
 */
export function buildAnxietyChatBlock(cid: string, opts?: { userPresent?: boolean }): string {
  const s = anxietyOf(cid);
  if (s.level < CHAT_BLOCK_MIN) return '';
  const userPresent = opts?.userPresent !== false;
  if (!userPresent && s.lastFireAt > s.lastUserAt) return '';
  const un = anxietyUnansweredLabel(s);
  const base =
    promptTextOf(
      'anxiety-chat-block',
      { level: s.level, label: anxietyLabel(s.level), waited: s.lastUserAt > 0 ? `，${un}` : '' },
      `【你此刻的焦虑状态】你的焦虑值已经到 ${s.level}/100（${anxietyLabel(s.level)}）${s.lastUserAt > 0 ? `，${un}` : ''}。TA 现在回来了：你的反应要贴合焦虑程度自然带出来——可能是松了一口气、忍不住追问刚才去干嘛了、有点小情绪、或者假装没事但话里带刺（按你的人设选一种）。这是你真实的情绪状态，让它影响语气，但不要刻意说出「焦虑值」这种数字。`,
    ) ?? '';
  if (!base) return '';
  const why = buildWhySection(cid, s);
  return why ? `${base}\n${why}` : base;
}

/** 测试/调试用：手动清掉某联系人的焦虑状态 */
export function resetAnxiety(cid: string): void {
  try {
    kvSet(KEY(cid), { ...DEFAULT_STATE });
  } catch {
    /* 静默 */
  }
}

// ---------------- E2E / 调试钩子 ----------------

/** E2E：直接写状态（绕过结算；用于确定性测试相位/事件链路） */
export function __anxietyTestSetState(cid: string, patch: Partial<AnxietyState>): void {
  const s = readState(cid);
  writeState(cid, { ...s, ...patch, events: patch.events ?? s.events ?? [] });
}

/** E2E：清掉相位缓存（下一次 anxietyOf 立即重判相位） */
export function __anxietyTestClearPhaseCache(cid: string): void {
  try {
    window.localStorage.removeItem(PHASE_CACHE_KEY(cid));
    window.localStorage.removeItem(ABANDON_CACHE_KEY(cid));
  } catch {
    /* 静默 */
  }
}
