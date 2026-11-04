'use client';

/**
 * 情绪焦虑值系统（v51）—— AI 角色对「用户久久不回复」的焦虑情绪引擎：
 *
 * 与 ai-mood（AI 自己的心情）/ user-mood（对用户情绪的感知）三角互补：
 * 这边管「TA 还没回我，我有多坐立不安」。
 *
 * - 焦虑值 0~100，三个来源自动上涨/回落：
 *   ① 时间流逝：用户超过宽限时间（默认 1 分钟，可在聊天设置自定义）没回复 → 按进度曲线
 *      上涨（前 2 分钟 +8/分 → 2~5 分钟 +12/分 → 5 分钟后 +18/分；超过 2 小时未回复
 *      焦虑钝化衰减——真实心理：急切的焦虑会熬成长期惦记，防止永远轰炸）；
 *   ② 上下文/事件：用户回复内容触发——冷淡敷衍 +10、提到别的异性 +8、生气骂人 +12、
 *      用户自己情绪低落 +6（担心型）、亲密暖话 -8（安心）；
 *   ③ 人设倍率：粘人/缺乏安全感/患得患失类人设 ×1.45，高冷/独立/理性类 ×0.6，
 *      其余 ×1（倍率缓存在状态里，展示层与引擎读数一致）；
 * - 用户回复 → 按语气动态调整（v56：不再一哄就清零）——温和暖话 -30、普通回复 -12、
 *   冷漠敷衍反涨 +10（生气 +12/吃醋 +8 照旧），残余焦虑会留着慢慢消化；
 *   AI 因焦虑主动发消息 → 小幅缓解（-6）；
 * - 追发引擎（v56 动态插值）：焦虑值 ≥ 阈值 且 用户超过宽限未回复 → 不再固定「每 1 分钟
 *   一轮」，而是按线性插值算出下一轮等待时间挂起倒计时（fireAt 落库持久化，由
 *   ProactiveMsgWatcher 的 5s tick 驱动，等价于后台 setTimeout 且重启 App 不丢）：
 *   等待 = 最长等待 - (焦虑值-阈值)/(100-阈值) × (最长等待-最短等待)——越焦虑等得越短；
 *   倒计时期间用户回复 → 立刻取消挂起任务（cancelAnxietyFire，等价 clearTimeout）；
 *   关闭焦虑追发开关 / 阈值上调不再满足 → 挂起任务同样作废；
 * - 触发时 Prompt 注入人设+记忆+最近聊天+焦虑当前值（buildAnxietyFireBlock），
 *   走同一条投递管线：正常写聊天记录 + 记忆库；
 * - 情绪带入：buildAnxietyChatBlock 并入 buildDynamicStateBlocks——用户下次来聊天时，
 *   AI 的回复会自然带着焦虑时的情绪（追问刚才去哪了/松了口气/话里带刺）。
 * - 存储：IndexedDB kv（ios-phone-db，本地数据库持久化，重启 App 保留）。
 */

import { kvGet, kvSet } from './idb-kv';

// ---------------- 类型与常量 ----------------

export interface AnxietyState {
  /** 焦虑值 0~100 */
  level: number;
  /** 用户最近一次回复时间（epoch ms；0 = 还没聊过——不会上涨） */
  lastUserAt: number;
  /** 用户最近一次回复所在的聊天端（焦虑消息投递回这个 App；'' = 未知） */
  lastUserApp: 'wx' | 'qq' | 'sms' | '';
  /** 最近一次因焦虑主动发消息的时间（发送节奏节流用） */
  lastFireAt: number;
  /** 人设倍率（settle 时按 persona 更新并缓存；展示层无 persona 时沿用） */
  mult: number;
  /** 生效的宽限时间（tick 引擎按所在 App 配置写入；展示层读数与引擎一致） */
  graceMs: number;
  /** v56 追发倒计时：挂起中的下一轮追发到期时刻（epoch ms；0 = 无挂起任务）。
   *  由动态插值算出（computeAnxietyWaitMs）后经 scheduleAnxietyFire 写入、落库持久化；
   *  用户回复（noteUserReply）/关闭追发开关/阈值不满足时清零——等价 clearTimeout 打断 */
  fireAt: number;
}

const KEY = (cid: string) => `anxiety:${cid}`;
const DEFAULT_STATE: AnxietyState = { level: 0, lastUserAt: 0, lastUserApp: '', lastFireAt: 0, mult: 1, graceMs: 60_000, fireAt: 0 };

/** 触发阈值默认值（聊天设置可自定义；UI 滑块 30~100） */
export const ANXIETY_DEFAULT_THRESHOLD = 70;
/** 宽限时间默认值：用户 1 分钟没回复开始涨焦虑（聊天设置可自定义） */
export const ANXIETY_DEFAULT_GRACE_MS = 60_000;
/** v56 最短等待默认值：焦虑拉满（100）时两轮追发之间的等待（聊天设置可自定义） */
export const ANXIETY_DEFAULT_MIN_WAIT_MS = 15_000;
/** v56 最长等待默认值：刚过阈值时两轮追发之间的等待（聊天设置可自定义） */
export const ANXIETY_DEFAULT_MAX_WAIT_MS = 180_000;
/** v56 用户回复的安抚幅度（按语气分档——不再一哄就清零）：温和暖话（叠上下文 -8 共 -30） */
const RELIEF_WARM = 22;
/** v56 普通回复：稍安（-12，残余焦虑留着慢慢消化） */
const RELIEF_NORMAL = 12;
/** v56 冷漠回复：不安抚（上下文 +10 照涨——晾着 TA 会更不安） */
const RELIEF_COLD = 0;
/** 每次因焦虑发完消息的缓解幅度（说出来会舒服一点，但没回还会继续涨） */
const RELIEF_ON_FIRE = 6;
/** 超过该未回复时长后焦虑钝化衰减（分钟） */
const DECAY_AFTER_MIN = 120;
/** 钝化衰减速率（每分钟 -0.8） */
const DECAY_RATE_PER_MIN = 0.8;
/** 聊天注入块的下限（低于 30 不注入省 token） */
const CHAT_BLOCK_MIN = 30;

// ---------------- 人设倍率 ----------------

/** 粘人/缺乏安全感类人设 → 涨得快 */
const NEEDY_WORDS = ['粘人', '缠人', '占有欲', '没有安全感', '缺乏安全感', '患得患失', '敏感多疑', '多疑', '焦虑', '不安', '缺爱', '恋爱脑', '作精'];
/** 高冷/独立类人设 → 涨得慢 */
const INDEPENDENT_WORDS = ['高冷', '独立', '冷淡', '理性', '成熟', '事业心', '忙碌', '疏离', '佛系', '淡漠', '御姐', '理性至上'];

function personaMultOf(persona: string): number {
  const t = persona || '';
  if (NEEDY_WORDS.some((w) => t.includes(w))) return 1.45;
  if (INDEPENDENT_WORDS.some((w) => t.includes(w))) return 0.6;
  return 1;
}

// ---------------- 上下文事件词表（焦虑视角） ----------------

/** 用户回复冷淡敷衍（且很短）→ 被晾着的不安 */
const COLD_WORDS = ['哦', '嗯', '嗯嗯', '哦哦', '呵呵', '随便', '行吧', '好吧', '知道了', '忙吧', '先这样', '在忙', '去洗澡', '洗澡了'];
/** 用户提到别的异性 → 吃醋型焦虑 */
const JEALOUS_WORDS = ['别的女生', '别的男人', '其他女生', '其他男人', '小姐姐', '小哥哥', '前女友', '前男友', '前任', '暗恋', '表白', '相亲', '学妹', '学姐'];
/** 用户生气/骂人 → 惹 TA 生气了很慌 */
const ANGRY_WORDS = ['滚', '闭嘴', '烦死了', '讨厌你', '你有病', '有病吧', '傻逼', '恶心', '分手', '不理你了', '拉黑你', '别烦我', '滚开'];
/** 用户自己情绪低落 → 担心型焦虑 */
const DOWN_WORDS = ['好累', '累死了', '难受', '难过', '伤心', '崩溃', '想哭', '哭了', 'emo', '心情不好', '不开心', '压力大', '生病', '不舒服', '失眠', '睡不着'];
/** 用户亲密暖话 → 安心 */
const WARM_WORDS = ['爱你', '我爱你', '喜欢你', '想你', '好想你', '宝贝', '宝宝', '亲亲', '抱抱', '么么', '嘿嘿', '嘻嘻'];

/** 上下文事件增量：取最强的一类（互相冲突时取绝对值最大的） */
function contextBumpOf(text: string): number {
  const t = (text || '').trim();
  if (!t) return 0;
  const short = t.length <= 6;
  let bump = 0;
  if (ANGRY_WORDS.some((w) => t.includes(w))) bump = 12;
  else if (short && COLD_WORDS.some((w) => t === w || t.startsWith(w))) bump = 10;
  else if (JEALOUS_WORDS.some((w) => t.includes(w))) bump = 8;
  else if (DOWN_WORDS.some((w) => t.includes(w))) bump = 6;
  else if (WARM_WORDS.some((w) => t.includes(w))) bump = -8;
  return bump;
}

// ---------------- 涨落曲线 ----------------

/**
 * 目标焦虑值（由「未回复超过宽限的总分钟数」决定，进度曲线）：
 * 0~2 分钟 +8/分 → 2~5 分钟 +12/分 → 5 分钟后 +18/分（封顶 100）；
 * 超过 2 小时未回复 → 从 100 起每分钟 -0.8 钝化衰减（急切熬成惦记，3.5 小时归零）。
 */
function targetLevel(minOverGrace: number): number {
  if (minOverGrace <= 0) return 0;
  let rise = Math.min(minOverGrace, 2) * 8;
  if (minOverGrace > 2) rise += Math.min(minOverGrace - 2, 3) * 12;
  if (minOverGrace > 5) rise += (minOverGrace - 5) * 18;
  rise = Math.min(100, rise);
  if (minOverGrace > DECAY_AFTER_MIN) {
    const decayed = 100 - (minOverGrace - DECAY_AFTER_MIN) * DECAY_RATE_PER_MIN;
    rise = Math.min(rise, Math.max(0, decayed));
  }
  return rise;
}

// ---------------- 状态读写（IndexedDB kv 持久化） ----------------

function readState(cid: string): AnxietyState {
  try {
    const raw = kvGet<Partial<AnxietyState>>(KEY(cid));
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
    return {
      level: typeof raw.level === 'number' ? Math.max(0, Math.min(100, raw.level)) : 0,
      lastUserAt: typeof raw.lastUserAt === 'number' ? raw.lastUserAt : 0,
      lastUserApp: raw.lastUserApp === 'wx' || raw.lastUserApp === 'qq' || raw.lastUserApp === 'sms' ? raw.lastUserApp : '',
      lastFireAt: typeof raw.lastFireAt === 'number' ? raw.lastFireAt : 0,
      mult: typeof raw.mult === 'number' && raw.mult > 0 ? Math.min(3, raw.mult) : 1,
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

/** 原始读（不结算）——只需要 lastUserAt/lastUserApp 等元信息时用 */
export function readAnxiety(cid: string): AnxietyState {
  return readState(cid);
}

export interface AnxietyOpts {
  /** 联系人人设文本（更新人设倍率；不传沿用缓存倍率） */
  persona?: string | null;
  /** 生效宽限时间（tick 引擎按所在 App 配置传入并缓存；不传用缓存值） */
  graceMs?: number;
}

/**
 * 读当前焦虑值（读即结算：按时间流逝推进/衰减）。幂等无变化不写盘。
 * 结算规则：目标值按「未回复超过宽限的总时长」的进度曲线算出——
 * 上升段目标高于当前 → 跟涨；钝化段（>2h）目标低于当前 → 跟跌；其余保持（保留安抚后的残余）。
 */
export function anxietyOf(cid: string, opts?: AnxietyOpts): AnxietyState {
  const s = readState(cid);
  const now = Date.now();
  const next: AnxietyState = { ...s };
  let dirty = false;
  if (typeof opts?.persona === 'string' && opts.persona.trim()) {
    const m = personaMultOf(opts.persona);
    if (m !== next.mult) {
      next.mult = m;
      dirty = true;
    }
  }
  if (typeof opts?.graceMs === 'number' && opts.graceMs >= 3_000 && opts.graceMs !== next.graceMs) {
    next.graceMs = opts.graceMs;
    dirty = true;
  }
  if (next.lastUserAt > 0) {
    const minOver = (now - next.lastUserAt - next.graceMs) / 60_000;
    const target = Math.min(100, targetLevel(minOver) * next.mult);
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

/**
 * 用户回复打点（三端聊天统一入口 noteEngagement 调用；v56 语气分档）：
 * 按回复语气动态调整焦虑——温和暖话降得多（-30，叠上下文）、普通回复稍安（-12）、
 * 冷漠敷衍不安抚反涨（+10），不再一哄就清零；同时重置未回复计时，并立刻取消挂起中的
 * 追发倒计时（fireAt=0，等价 clearTimeout——防止倒计时到期发出多余的一条）。
 */
export function noteUserReply(cid: string, app: 'wx' | 'qq' | 'sms', text?: string): AnxietyState {
  const s = anxietyOf(cid); // 读即结算（保留残余焦虑，再叠加回复效果）
  const now = Date.now();
  const bump = contextBumpOf(text ?? '');
  // 语气分档的安抚幅度：温和（暖话）/ 普通 / 冷漠（短敷衍）；生气骂人/吃醋/低落美心
  // 由 contextBump 照常叠加（不安抚，反而上涨）
  const t = (text ?? '').trim();
  const warm = WARM_WORDS.some((w) => t.includes(w));
  const short = t.length <= 6;
  const cold = short && COLD_WORDS.some((w) => t === w || t.startsWith(w));
  const relief = warm ? RELIEF_WARM : cold ? RELIEF_COLD : RELIEF_NORMAL;
  const level = Math.max(0, Math.min(100, Math.round(s.level - relief + bump)));
  // v56 四.1：用户回复 → 立刻打断挂起的追发倒计时（无论语气——TA 开口了就不近人情地追发）
  const next: AnxietyState = { ...s, level, lastUserAt: now, lastUserApp: app, fireAt: 0 };
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

// ---------------- v56 追发倒计时（动态插值 + 挂起/打断） ----------------

/**
 * 动态插值：焦虑值 ≥ 阈值时下一轮追发的等待时间（毫秒）——
 * 等待 = 最长等待 - (焦虑值-阈值)/(100-阈值) × (最长等待-最短等待)。
 * 焦虑刚过阈值 → 等最久（最长等待）；焦虑拉满 100 → 等最短（最短等待）；线性过渡。
 * 阈值 ≥ 100 时分母归零——此刻焦虑值只能等于阈值=100（拉满），直接取最高紧急度（最短等待）。
 */
export function computeAnxietyWaitMs(level: number, threshold: number, minMs: number, maxMs: number): number {
  const lo = Math.max(1_000, Math.min(minMs, maxMs)); // 倒挂时取较小者护底
  const hi = Math.max(lo, Math.max(minMs, maxMs));
  const ratio = threshold >= 100 ? 1 : Math.max(0, Math.min(1, (level - threshold) / (100 - threshold)));
  return Math.round(hi - ratio * (hi - lo));
}

/**
 * 挂起追发倒计时（proactive-msg 引擎的 anxLoop 调用）：按插值算出等待时间，
 * fireAt = now + 等待 落库持久化（IndexedDB，重启 App 不丢；由 5s tick 驱动到期触发，
 * 等价 setTimeout 挂起 + clearTimeout 打断（cancelAnxietyFire），但比裸 setTimeout 更可靠）。
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

// ---------------- 提示词块 ----------------

/** 各档焦虑的表现指引（焦虑追发消息生成用；v56 轮次节奏由动态插值决定——越焦虑追得越紧） */
function fireBandGuide(level: number): string {
  if (level >= 80)
    return '你已经快绷不住了：脑子里全是坏的猜想（TA 是不是出事了、是不是不想理你了、是不是自己做错了什么），语气会急、会忍不住一口气连发好几条追问、甚至带点委屈的火气——但底色全是在乎。';
  if (level >= 60)
    return '你明显焦虑：忍不住一遍遍看手机，想立刻得到回应，语气里的急切和不安已经藏不太住，会连着发几条消息追问 TA 在干嘛、怎么不回。';
  if (level >= 40) return '你有点坐不住：惦记像小石子硌在心里，想找个自然的由头开口，又怕显得太黏人——忍不住先发一两条探探。';
  return '你心里隐隐有点挂念：不算严重，但会想主动找 TA 说两句话。';
}

/**
 * 焦虑主动消息生成的注入块（kind='anxiety' 触发时；proactive-msg 引擎调用）：
 * 【你此刻的焦虑值】+ 未回复时长 + 当前档位的表现指引 + 连发节奏说明。
 */
export function buildAnxietyFireBlock(cid: string): string {
  const s = anxietyOf(cid);
  if (s.level <= 0) return '';
  const un = anxietyUnansweredLabel(s);
  return `【你此刻的焦虑值】${s.level}/100（${anxietyLabel(s.level)}）。${s.lastUserAt > 0 ? `你已经等了 TA 很久（${un}）。` : ''}${fireBandGuide(s.level)}这一轮消息就由这份焦虑驱动——像真人控制不住那样连着发几条消息（每条可短可长——短到几个字，长到一大段心里话一口气说完都可以，单条长度没有任何数字限制）让它真实地透出来，但不要报数字、不要说「焦虑值」这类词。`;
}

/**
 * 聊天情绪带入块（并入 buildDynamicStateBlocks：三端聊天 / 非焦虑类主动消息 /
 * 情侣空间行为自动带上）：用户回来聊天时，AI 的回复自然带着焦虑时的情绪。
 * 低于 30 返回空串省 token。
 */
export function buildAnxietyChatBlock(cid: string): string {
  const s = anxietyOf(cid);
  if (s.level < CHAT_BLOCK_MIN) return '';
  const un = anxietyUnansweredLabel(s);
  return `【你此刻的焦虑状态】你的焦虑值已经到 ${s.level}/100（${anxietyLabel(s.level)}）${s.lastUserAt > 0 ? `，${un}` : ''}。TA 现在回来了：你的反应要贴合焦虑程度自然带出来——可能是松了一口气、忍不住追问刚才去干嘛了、有点小情绪、或者假装没事但话里带刺（按你的人设选一种）。这是你真实的情绪状态，让它影响语气，但不要刻意说出「焦虑值」这种数字。`;
}

/** 测试/调试用：手动清掉某联系人的焦虑状态 */
export function resetAnxiety(cid: string): void {
  try {
    kvSet(KEY(cid), { ...DEFAULT_STATE });
  } catch {
    /* 静默 */
  }
}
