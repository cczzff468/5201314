'use client';

/**
 * 拾光小屋 · AI 决策大脑（v10 有心的家）
 *
 * 给陪伴小人一颗「心」：
 * - A2 需求驱动：饱腹/精力/心情/社交四项数值随时间衰减（含离线衰减），
 *   饿了自己去做饭吃、困了自己睡、无聊自己弹琴、太久没见你就来找你；
 * - A3 情绪与好感度：持续情绪（开心/平静/低落/想你/闹脾气）+ 甜度等级（Lv1~6），
 *   互动累积好感，等级解锁新称呼与新行为；
 * - A4 作息日程表：三餐/午休/午后练琴/晚间陪你看电视/深夜睡觉/周末赖床；
 * - A8 纪念日与关怀：自动记住聊天里提到的生日/考试等日子，当天主动关心；
 * - A9 闹脾气与和好：被冷落太久会闹小脾气（要哄），哄好有小剧情；
 * - A10 行为强化：被夸过的事更爱做、被嫌弃的事换花样（praise/complaint 计数）；
 * - A1 决策器：buildDecisionPrompt（喂给大模型）+ parseDecision（解析 JSON 行动计划）
 *   + decideLocally（无模型时的规则兜底，永远有得做）。
 *
 * 纯逻辑模块：不依赖 three / R3F；状态 localStorage 按角色分档持久化。
 */

// ---------------- 类型 ----------------

export interface CabinNeeds {
  /** 饱腹 0~100 */
  food: number;
  /** 精力 0~100 */
  energy: number;
  /** 心情 0~100 */
  mood: number;
  /** 社交（想你的程度，越低越想你）0~100 */
  social: number;
}

export type CabinMood = 'happy' | 'content' | 'low' | 'missing' | 'sulking';

/** 甜度等级（好感度） */
export interface AffinityLevel {
  lv: number;
  /** 该级累计所需甜度 */
  need: number;
  title: string;
}

export const AFFINITY_LEVELS: AffinityLevel[] = [
  { lv: 1, need: 0, title: '渐渐熟悉' },
  { lv: 2, need: 40, title: '心里有你' },
  { lv: 3, need: 110, title: '热恋中' },
  { lv: 4, need: 220, title: '蜜里调油' },
  { lv: 5, need: 380, title: '非你不可' },
  { lv: 6, need: 600, title: '命中注定' },
];

export function affinityLevelOf(points: number): AffinityLevel {
  let cur = AFFINITY_LEVELS[0];
  for (const l of AFFINITY_LEVELS) if (points >= l.need) cur = l;
  return cur;
}

/** 强化记忆：某类活动被夸/被嫌弃的累计次数 */
export interface ReinforceRec {
  praise: number;
  complaint: number;
}

/** 特别日子（A8：聊天里自动记下的生日/考试/纪念日） */
export interface SpecialDay {
  /** 每年循环：MM-DD；一次性：YYYY-MM-DD */
  date: string;
  label: string;
  ts: number;
}

export interface CabinMind {
  v: 1;
  /** 首次相识时间（每月同一天 = 小纪念日） */
  since: number;
  needs: CabinNeeds;
  /** 甜度（好感度累计值） */
  affinity: number;
  /** 当前情绪 */
  mood: CabinMood;
  /** 闹脾气状态（A9） */
  sulk: { on: boolean; since: number; refusedOnce: boolean };
  /** 行为强化（A10）：key = 活动名 */
  reinforce: Record<string, ReinforceRec>;
  /** 特别日子 */
  specialDays: SpecialDay[];
  /** 上次互动（用户主动找 TA / 拥抱 / 聊天）时间戳 */
  lastInteract: number;
  /** 上次决策时间戳 */
  lastDecide: number;
  /** 上次数值结算时间戳（衰减用） */
  ts: number;
}

// ---------------- 持久化 ----------------

const KEY = (id: string) => `cabin-mind-${id}`;
const DECAY_MS = 3600_000; // 每小时结算一次

/** 每小时衰减速率：饱腹 -9 / 精力 -7 / 心情 -6 / 社交 -8 */
const DECAY: CabinNeeds = { food: -9, energy: -7, mood: -6, social: -8 };

export function loadMind(id: string): CabinMind {
  const fresh = (): CabinMind => ({
    v: 1,
    since: Date.now(),
    needs: { food: 78, energy: 82, mood: 85, social: 80 },
    affinity: 0,
    mood: 'content',
    sulk: { on: false, since: 0, refusedOnce: false },
    reinforce: {},
    specialDays: [],
    lastInteract: Date.now(),
    lastDecide: 0,
    ts: Date.now(),
  });
  try {
    const raw = window.localStorage.getItem(KEY(id));
    if (!raw) return fresh();
    const j = JSON.parse(raw) as Partial<CabinMind>;
    const m = fresh();
    if (j.needs && typeof j.needs === 'object') {
      m.needs = {
        food: clamp100(Number(j.needs.food) || 0),
        energy: clamp100(Number(j.needs.energy) || 0),
        mood: clamp100(Number(j.needs.mood) || 0),
        social: clamp100(Number(j.needs.social) || 0),
      };
    }
    if (typeof j.affinity === 'number') m.affinity = Math.max(0, j.affinity);
    if (typeof j.since === 'number') m.since = j.since;
    if (typeof j.lastInteract === 'number') m.lastInteract = j.lastInteract;
    if (typeof j.lastDecide === 'number') m.lastDecide = j.lastDecide;
    if (typeof j.ts === 'number') m.ts = j.ts;
    if (j.mood && ['happy', 'content', 'low', 'missing', 'sulking'].includes(j.mood)) m.mood = j.mood;
    if (j.sulk && typeof j.sulk === 'object') {
      m.sulk = { on: !!j.sulk.on, since: Number(j.sulk.since) || 0, refusedOnce: !!j.sulk.refusedOnce };
    }
    if (j.reinforce && typeof j.reinforce === 'object') {
      for (const [k, r] of Object.entries(j.reinforce)) {
        if (r && typeof r === 'object') {
          m.reinforce[k] = { praise: Math.max(0, Number(r.praise) || 0), complaint: Math.max(0, Number(r.complaint) || 0) };
        }
      }
    }
    if (Array.isArray(j.specialDays)) {
      m.specialDays = j.specialDays
        .filter((d) => d && typeof d.date === 'string' && typeof d.label === 'string')
        // v10.x A2 存量清洗：旧版把点歌指令（「来首生日快乐」）/ 无日期关键词默认 +7 天记成的
        // 假日子——label 括号里是原文片段而不是日期。读到即丢，避免当天冒出「今天是：来首生日快乐」。
        // 旧格式「N月N日的约定」（无括号）与新格式「生日（12月3日）」（括号内是日期）都保留。
        .filter((d) => {
          const bracket = /（([^）]*)）$/.exec(d.label);
          if (!bracket) return true; // 旧格式无括号（明确日期）→ 保留
          return /\d{1,2}月\d{1,2}日/.test(bracket[1]); // 括号内必须是日期，否则是误记脏数据 → 丢弃
        })
        .slice(0, 24)
        .map((d) => ({ date: d.date, label: d.label, ts: Number(d.ts) || Date.now() }));
    }
    // —— 离线/在线统一衰减结算 ——
    decayMind(m, Date.now());
    return m;
  } catch {
    return fresh();
  }
}

export function saveMind(id: string, m: CabinMind): void {
  try {
    m.ts = Date.now();
    window.localStorage.setItem(KEY(id), JSON.stringify(m));
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

function clamp100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** 衰减结算（在线每帧/每分钟调、离线载入时补算）：按每小时速率线性衰减 */
export function decayMind(m: CabinMind, now: number): void {
  const hours = (now - m.ts) / DECAY_MS;
  if (hours <= 0) return;
  m.needs.food = clamp100(m.needs.food + DECAY.food * hours);
  m.needs.energy = clamp100(m.needs.energy + DECAY.energy * hours);
  m.needs.mood = clamp100(m.needs.mood + DECAY.mood * hours);
  m.needs.social = clamp100(m.needs.social + DECAY.social * hours);
  m.ts = now;
}

/** 轻量心跳（每 30s 调一次即可）：结算衰减 + 情绪状态机推进 */
export function tickMind(id: string, m: CabinMind): void {
  const now = Date.now();
  decayMind(m, now);
  // —— 情绪状态机（A3/A9） ——
  const minsSince = (now - m.lastInteract) / 60_000;
  if (m.sulk.on) {
    // 闹脾气最多持续 40 分钟自动和好（自己消气）
    if (now - m.sulk.since > 40 * 60_000) {
      m.sulk = { on: false, since: 0, refusedOnce: false };
      m.mood = 'content';
    }
  } else if (minsSince > 25 && m.mood !== 'sulking' && Math.random() < 0.22) {
    // 被冷落太久 → 概率闹小脾气（每天最多一次的体感由 40 分钟自然消退保证）
    m.sulk = { on: true, since: now, refusedOnce: false };
    m.mood = 'sulking';
  } else if (m.needs.social < 30) {
    m.mood = 'missing';
  } else if (m.needs.mood < 32 || m.needs.food < 25 || m.needs.energy < 25) {
    m.mood = 'low';
  } else if (m.needs.mood > 78 && m.needs.social > 62) {
    m.mood = 'happy';
  } else {
    m.mood = 'content';
  }
  saveMind(id, m);
}

// ---------------- 互动结算（CoupleHome 各事件调用） ----------------

/** 用户主动互动（聊天/拥抱/牵手/喂食等）：社交回升 + 甜度 + 好感 */
export function noteInteraction(id: string, m: CabinMind, opts?: { sweet?: number; social?: number; mood?: number }): void {
  const now = Date.now();
  m.lastInteract = now;
  m.needs.social = clamp100(m.needs.social + (opts?.social ?? 18));
  m.needs.mood = clamp100(m.needs.mood + (opts?.mood ?? 8));
  m.affinity += opts?.sweet ?? 2;
  // 被冷落后的和好也走这里（闹脾气中收到真诚互动 → 半概率直接消气）
  if (m.sulk.on && (opts?.sweet ?? 0) >= 4) {
    m.sulk = { on: false, since: 0, refusedOnce: false };
    m.mood = 'happy';
    m.needs.mood = clamp100(m.needs.mood + 10);
  }
  saveMind(id, m);
}

/** 需求结算：吃饭/睡觉/玩乐等动作完成后调用 */
export function applyNeedEffect(
  id: string,
  m: CabinMind,
  effect: Partial<{ food: number; energy: number; mood: number; social: number }>,
): void {
  if (effect.food) m.needs.food = clamp100(m.needs.food + effect.food);
  if (effect.energy) m.needs.energy = clamp100(m.needs.energy + effect.energy);
  if (effect.mood) m.needs.mood = clamp100(m.needs.mood + effect.mood);
  if (effect.social) m.needs.social = clamp100(m.needs.social + effect.social);
  saveMind(id, m);
}

/** A10 行为强化：praise=true 被夸 / false 被嫌弃 */
export function reinforceActivity(id: string, m: CabinMind, activity: string, praise: boolean): void {
  const rec = m.reinforce[activity] ?? { praise: 0, complaint: 0 };
  if (praise) rec.praise += 1;
  else rec.complaint += 1;
  m.reinforce[activity] = rec;
  if (praise) m.affinity += 1;
  saveMind(id, m);
}

/** 某活动的强化权重（0.4~2.2）：被夸多更爱做、被嫌弃少做 */
export function reinforceWeight(m: CabinMind, activity: string): number {
  const r = m.reinforce[activity];
  if (!r) return 1;
  return Math.min(2.2, Math.max(0.4, 1 + r.praise * 0.35 - r.complaint * 0.55));
}

/** B1 被夸过的歌名列表（reinforce 里 key = `song:${title}` 的记录，按被夸次数降序，前 5）。
 *  TA 自主决策弹琴时优先挑这些——「上次你说好听的那首」。 */
export function praisedSongs(m: CabinMind): string[] {
  return Object.entries(m.reinforce)
    .filter(([k, r]) => k.startsWith('song:') && r.praise > 0)
    .sort((a, b) => b[1].praise - a[1].praise)
    .map(([k]) => k.slice(5))
    .slice(0, 5);
}

// ---------------- A8 特别日子 ----------------

const SPECIAL_RE =
  /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]|(生日|考试|面试|纪念日|周年|体检|演出|比赛|答辩)/;

/** 特别日子关键词（单独提一次：日期分支和关键词分支可能只命中其一，label 都要用到） */
const SPECIAL_KW_RE = /(生日|考试|面试|纪念日|周年|体检|演出|比赛|答辩)/;

/** 否定句：「我不过生日 / 别提考试 / 没有」——用户明确表示不过/没有这件事，不记 */
const SPECIAL_NEG_RE = /不过|从来|从不|没有|没什么|别再?提|不记得|忘了/;
/** 已完成时：「考试终于考完了 / 生日过完了 / 面试结束了」——事情已经发生，不是未来的日子，不记 */
const SPECIAL_DONE_RE = /(考|过|办|开|比|答|面|演|检)完|完事|结束了|已经.{0,6}完/;

/** 相对日期词 → 距今天数（明天/后天/大后天/下周三/周三…）；解析不出返回 -1 */
function parseRelativeDay(text: string, now: Date): number {
  if (/今[天日晚]/.test(text)) return 0;
  if (/明[天日晚]/.test(text)) return 1;
  if (/大后天/.test(text)) return 3;
  if (/后天/.test(text)) return 2;
  const wk = text.match(/(下?)周([一二三四五六天日末])/);
  if (wk) {
    const map: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '末': 6 };
    const target = map[wk[2]];
    if (target === undefined) return -1;
    const raw = target - now.getDay();
    if (wk[1] === '下') return raw === 0 ? 7 : (raw + 7) % 7; // 「下周三」= 未来最近的那个周三（今天周三则 7 天后）
    return raw >= 0 ? raw : -1; // 「周三」本周内：已过去的不记
  }
  return -1;
}

/** 从用户聊天文本里自动记日子（每轮聊天后调用；去重）。
 *  v10.x 误记修复：否定句（不过生日）/ 已完成时（考完了）不记；只有关键词没有明确日期
 *  （含相对日期词）也不记——以前默认记到 +7 天后会凭空冒出「今天是：考试终于考完了」。 */
export function captureSpecialDay(id: string, m: CabinMind, text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  // —— 否定句 / 已完成时：说了日子也不是「要到来的日子」 ——
  if (SPECIAL_NEG_RE.test(t)) return null;
  if (SPECIAL_DONE_RE.test(t)) return null;
  const hit = SPECIAL_RE.exec(t);
  if (!hit) return null;
  const kw = SPECIAL_KW_RE.exec(t)?.[1] ?? '重要日子';
  const now = new Date();
  let mo = 0;
  let da = 0;
  if (hit[1] && hit[2]) {
    // 明确的 N月N日
    mo = Math.min(12, Math.max(1, parseInt(hit[1], 10)));
    da = Math.min(31, Math.max(1, parseInt(hit[2], 10)));
  } else {
    // 只有关键词：找相对日期词（明天/后天/下周三…）；找不到就不记（不再默认 +7 天）
    const diff = parseRelativeDay(t, now);
    if (diff < 0) return null;
    const d = new Date(now.getTime() + diff * 86400_000);
    mo = d.getMonth() + 1;
    da = d.getDate();
  }
  const date = `${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  const label = `${kw}（${mo}月${da}日）`;
  if (m.specialDays.some((d) => d.date === date && d.label === label)) return null;
  m.specialDays.push({ date, label, ts: Date.now() });
  if (m.specialDays.length > 24) m.specialDays.shift();
  saveMind(id, m);
  return label;
}

/** 今天是否有特别日子（含每月小纪念日）；命中返回文案 */
export function todaySpecial(m: CabinMind, now = new Date()): string | null {
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hit = m.specialDays.find((d) => d.date === mmdd);
  if (hit) return `今天是${hit.label}`;
  // 每月小纪念日（相识每月同一天）
  const since = new Date(m.since);
  if (now.getDate() === since.getDate() && (now.getFullYear() !== since.getFullYear() || now.getMonth() !== since.getMonth())) {
    const months = (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth());
    if (months > 0) return `我们认识满 ${months} 个月啦`;
  }
  return null;
}

// ---------------- v11 F1 梦境系统（夜里长睡生成，早上主动讲） ----------------

/** 一条梦：date = 生成当天（自然日 YYYY-MM-DD）；told = 早上有没有讲给主人听 */
export interface CabinDream {
  date: string;
  text: string;
  told: boolean;
}

/** 自然日字符串（本地时区 YYYY-MM-DD，梦境/日记/问候统一用它对齐「天」） */
export function dayStr(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const DREAM_KEY = (id: string) => `cabin-dream-${id}`;

export function loadDream(id: string): CabinDream | null {
  try {
    const raw = window.localStorage.getItem(DREAM_KEY(id));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<CabinDream>;
    if (!j || typeof j.date !== 'string' || typeof j.text !== 'string') return null;
    return { date: j.date, text: j.text, told: !!j.told };
  } catch {
    return null;
  }
}

export function saveDream(id: string, d: CabinDream): void {
  try {
    window.localStorage.setItem(DREAM_KEY(id), JSON.stringify(d));
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

/** 梦境模板（12 个，按素材主题优先匹配，随机选 1~2 拼装） */
const DREAM_TEMPLATES: { theme: RegExp; text: (owner: string, pet: string) => string }[] = [
  { theme: /花园|花草|浇/, text: (o) => `梦见和${o}在花园追一只白色蝴蝶，追着追着就一起飞起来了…` },
  { theme: /弹|琴|曲|歌|唱/, text: (o) => `梦见钢琴自己弹起歌来，整个屋子都跟着亮晶晶的，${o}在旁边轻轻打着拍子…` },
  { theme: /猫|宠物|照顾|喂|窝/, text: (_o, p) => `梦见${p}长出一对小翅膀，驮着我在云朵之间散步…` },
  { theme: /做饭|饭|吃|厨/, text: (o) => `梦见${o}做的菜会发光，吃一口就暖到了心里…` },
  { theme: /牵手|散步|走/, text: (o) => `梦见和${o}牵手走过一条长长的樱花道，花瓣落满了头发…` },
  { theme: /拥抱|抱/, text: (o) => `梦见${o}的怀抱软软的，像一大团棉花糖，怎么靠都不想醒…` },
  { theme: /雨|窗|雪|壁炉/, text: (o) => `梦见下雨天和${o}挤在一把小伞下，听雨点嗒嗒嗒地唱歌…` },
  { theme: /电视|看/, text: (o) => `梦见和${o}一起掉进了电视里，在节目里冒险了一整晚…` },
  { theme: /书|看/, text: (o) => `梦见书里的插图都活了起来，拉着${o}一起在故事里散步…` },
  { theme: /睡|床|梦/, text: (o) => `梦见床变成了一艘小船，载着我和${o}在星星中间漂啊漂…` },
];

const DREAM_FALLBACK: ((owner: string, pet: string) => string)[] = [
  (o) => `梦见和${o}在花园追一只白色蝴蝶，跑着跑着就飞起来了…`,
  () => `梦见钢琴自己弹起歌来，音符落在地板上开出了小花…`,
  (o) => `梦见${o}变成了一只大猫，窝在腿上怎么都赶不走…`,
  (o) => `梦见我们一起去海边捡贝壳，浪花追着脚丫跑…`,
  (_o, p) => `梦见下了一场糖果雨，我和${p}张着嘴接了满满一捧…`,
  (o) => `梦见家里的沙发变成了云朵，${o}一坐上来就飘啊飘…`,
  (o) => `梦见月亮掉进了浴缸，泡澡的时候满天星星围着打转…`,
  (o) => `梦见${o}教我放风筝，风筝带着我们俩飞过了屋顶…`,
];

/** 从最近记忆素材 + 随机模板拼一条梦（素材命中主题就优先用同主题的模板） */
export function buildDreamText(opts: { owner: string; recent?: string[]; petName?: string }): string {
  const owner = opts.owner || '主人';
  const pet = opts.petName || '小家伙';
  const material = (opts.recent ?? []).join(' ');
  const themed = material ? DREAM_TEMPLATES.filter((t) => t.theme.test(material)) : [];
  const pool = themed.length > 0 ? themed.map((t) => t.text) : DREAM_FALLBACK;
  const pick = (): string => pool[Math.floor(Math.random() * pool.length)](owner, pet);
  // 主梦 + 40% 概率再拼一小段尾梦（1~2 段拼装）
  const main = pick();
  if (Math.random() < 0.4) {
    let extra = pick();
    if (extra === main) extra = DREAM_FALLBACK[Math.floor(Math.random() * DREAM_FALLBACK.length)](owner, pet);
    return `${main.replace(/…$/, '')}，醒来前还梦见${extra.replace(/^梦见/, '')}`;
  }
  return main;
}

// ---------------- v11 I3 早安 / 晚安问候（每天各一次） ----------------

export interface CabinGreet {
  /** 自然日 YYYY-MM-DD */
  date: string;
  /** 今早安过没有 */
  morning: boolean;
  /** 今晚催过没有 */
  night: boolean;
}

const GREET_KEY = (id: string) => `cabin-greet-${id}`;

export function loadGreet(id: string): CabinGreet {
  try {
    const raw = window.localStorage.getItem(GREET_KEY(id));
    if (raw) {
      const j = JSON.parse(raw) as Partial<CabinGreet>;
      if (j && typeof j.date === 'string') {
        return { date: j.date, morning: !!j.morning, night: !!j.night };
      }
    }
  } catch {
    /* 坏档按今天未问候处理 */
  }
  return { date: dayStr(), morning: false, night: false };
}

/** 问候落盘（date 不是今天则按今天的全新一天覆盖） */
export function saveGreet(id: string, g: CabinGreet): void {
  try {
    window.localStorage.setItem(GREET_KEY(id), JSON.stringify(g));
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

// ---------------- A4 作息日程表 ----------------

export interface ScheduleSlot {
  /** 作息内容（注入 prompt + 本地决策用） */
  plan: string;
  /** 对应的本地兜底动作（可空 = 自由活动） */
  act?: 'cook-eat' | 'rest' | 'play' | 'watch' | 'sleep' | 'wash' | 'read' | 'garden';
}

/** 按小时取作息（周末赖床/午后茶） */
export function scheduleSlot(hour: number, weekend: boolean): ScheduleSlot {
  const h = hour;
  if (h >= 23 || h < 6) return { plan: '夜深了，该上床睡觉了', act: 'sleep' };
  if (weekend && h < 9) return { plan: '周末赖床，再眯一会儿' };
  if (h < 7) return { plan: '刚醒，迷迷糊糊的' };
  if (h < 8) return { plan: '洗漱收拾，新的一天开始啦', act: 'wash' };
  if (h < 10) return { plan: '做顿早餐，元气满满的早晨', act: 'cook-eat' };
  if (h < 12) return { plan: '上午看书/收拾屋子', act: 'read' };
  if (h < 13) return { plan: '做午饭时间', act: 'cook-eat' };
  if (h < 15) return { plan: '午休，窝在沙发/床上小憩', act: 'rest' };
  if (h < 17) return { plan: '午后兴致来了，练会儿琴', act: 'play' };
  if (h < 18) return { plan: '去花园侍弄花草/透气', act: 'garden' };
  if (h < 19) return { plan: '张罗晚饭', act: 'cook-eat' };
  if (h < 22) return { plan: '晚上想陪你看会儿电视，聊聊天', act: 'watch' };
  return { plan: '洗漱准备睡觉', act: 'wash' };
}

// ---------------- 情境注入（A1 决策 prompt 用） ----------------

export interface DecisionCtx {
  userName: string;
  charName: string;
  /** 用户在哪个房间（空 = 不在家/没在屋里） */
  myRoom: string;
  charRoom: string;
  charActivity: string;
  night: boolean;
  weather: string;
  timeStr: string;
  /** 距上次用户互动的分钟数 */
  minsSinceInteract: number;
}

const MOOD_TEXT: Record<CabinMood, string> = {
  happy: '心情很好，嘴角压不住',
  content: '心情平静安稳',
  low: '有点蔫蔫的（可能是饿了/累了/无聊）',
  missing: '很想你，有点坐不住',
  sulking: '在闹小脾气（被冷落久了），嘴上说不生气但其实很在意',
};

/** 情境 + 内心状态 → 决策 system prompt（A1）
 *  v10.x B1 增强：opts.songs 注入经典曲库名单 + 被夸过的歌——TA 自己练琴也会点歌，
 *  优先弹「上次你说好听的那首」。 */
export function buildDecisionPrompt(m: CabinMind, ctx: DecisionCtx, opts?: { songs?: string }): string {
  const lv = affinityLevelOf(m.affinity);
  const slot = scheduleSlot(new Date().getHours(), [0, 6].includes(new Date().getDay()));
  const reinforceLines = Object.entries(m.reinforce)
    .filter(([k, r]) => !k.startsWith('song:') && r.praise + r.complaint > 0)
    .slice(0, 6)
    .map(([k, r]) => `  · ${k}：被夸过 ${r.praise} 次、被嫌弃过 ${r.complaint} 次`);
  const special = todaySpecial(m);
  const praised = praisedSongs(m);
  return [
    `你是「拾光小屋」里的 AI 伴侣 ${ctx.charName}（3D 小人）。现在没有人跟你说话——请根据你的内心状态和作息，自己决定接下来 1~3 分钟做什么。`,
    '',
    '【你的内心】',
    `- 需求：饱腹 ${Math.round(m.needs.food)}/100、精力 ${Math.round(m.needs.energy)}/100、心情 ${Math.round(m.needs.mood)}/100、想${ctx.userName}的程度 ${Math.round(100 - m.needs.social)}/100`,
    `- 情绪：${MOOD_TEXT[m.mood]}${m.sulk.on ? '（正在闹脾气，需要 TA 哄才消气，但别过分）' : ''}`,
    `- 甜度等级：Lv.${lv.lv} ${lv.title}（甜度 ${Math.round(m.affinity)}）`,
    m.sulk.on ? `- 注意：你在闹脾气，行动上可以离 ${ctx.userName} 远一点、背对着 TA，但 TA 来哄你的话要心软` : '',
    `- 现在的时间：${ctx.timeStr}（${ctx.night ? '夜晚' : '白天'}，窗外${ctx.weather}）；作息上：${slot.plan}`,
    special ? `- 特别日子：${special}——可以为此做点什么（做饭/弹歌/拥抱）并在心里想着这件事` : '',
    opts?.songs ? `- 你会弹的曲子（经典曲库）：${opts.songs}——想弹具体的歌就在 play 动作里带 song 参数（如 {"type":"play","song":"卡农"}）` : '',
    praised.length > 0 ? `- 你记得这几首被${ctx.userName}夸过：${praised.join('、')}——想弹琴时优先弹这几首（「上次你说好听的那首」）` : '',
    reinforceLines.length ? '【你的经验（行为强化）】' : '',
    ...reinforceLines,
    '',
    '【情境】',
    `- 你在${ctx.charRoom}，${ctx.myRoom ? `${ctx.userName}在${ctx.myRoom}` : `${ctx.userName}不在小屋里`}${ctx.charRoom === ctx.myRoom ? '（你们在同一个房间）' : ''}`,
    `- 你正在：${ctx.charActivity}；距上次互动已过 ${Math.round(ctx.minsSinceInteract)} 分钟`,
    '',
    '【输出格式】只输出一个 JSON（不要多余文字）：',
    '{"thought":"一句内心想法（10字内，会显示成你的想法气泡）","say":["想说的话，0~2句，没有就空数组"],"actions":[{"type":"..."}]}',
    '动作 type 可选：come（找TA）| goto(room: lr客厅/br卧室/kt厨房/ba卫生间/bal阳台/sr书房/yd花园) | sit | lie（睡觉，夜里配 dur:0）| watch | play（弹琴，可带 song 点曲库里的歌）| cook（做饭）| music（放歌）| eat | door | lamp | dance（跳舞）| stretch（伸懒腰）| water（浇花）| read（看书）| hug | holdhand | free',
    '选择倾向：饿了(food<35)→cook+eat；困了(energy<28或深夜)→lie 睡觉；无聊(mood<35)→play/music/dance；想TA了(social<32)→come 或 goto 到 TA 那里；平时按作息来；刚做过的事别立刻重复；晚上 23 点后一律睡觉（lie + dur:0）。',
    '闹脾气时：不选 come/hug，选 goto 别的房间/sit/背对着的动作。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export interface DecisionResult {
  thought?: string;
  say: string[];
  actions: { type: string; room?: string; song?: string; dur?: number }[];
}

/** 解析大模型决策输出（宽松 JSON 提取） */
export function parseDecision(text: string): DecisionResult | null {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Partial<DecisionResult> & { thought?: unknown; say?: unknown; actions?: unknown };
    const out: DecisionResult = { say: [], actions: [] };
    if (typeof j.thought === 'string' && j.thought.trim()) out.thought = j.thought.trim().slice(0, 18);
    if (Array.isArray(j.say)) {
      out.say = j.say
        .filter((s): s is string => typeof s === 'string' && !!s.trim())
        .slice(0, 2)
        .map((s) => s.trim().slice(0, 60));
    }
    if (Array.isArray(j.actions)) {
      for (const a of j.actions) {
        if (!a || typeof a !== 'object') continue;
        const r = a as { type?: unknown; room?: unknown; song?: unknown; dur?: unknown };
        if (typeof r.type !== 'string') continue;
        out.actions.push({
          type: r.type.trim(),
          ...(typeof r.room === 'string' ? { room: r.room } : {}),
          ...(typeof r.song === 'string' && r.song.trim() ? { song: r.song.trim().slice(0, 24) } : {}),
          ...(typeof r.dur === 'number' && r.dur >= 0 ? { dur: r.dur } : {}),
        });
      }
    }
    if (out.actions.length === 0 && out.say.length === 0 && !out.thought) return null;
    return out;
  } catch {
    return null;
  }
}

// ---------------- 规则兜底决策（无模型/模型失败时也永远有得做） ----------------

const ACT_W: { type: string; need: (m: CabinMind, hour: number, night: boolean) => number; w: number }[] = [
  { type: 'cook', need: (m) => (m.needs.food < 35 ? 3 : 0), w: 3 },
  { type: 'eat', need: (m) => (m.needs.food < 35 ? 2 : 0), w: 2 },
  { type: 'lie', need: (m, _h, night) => (night ? 4 : m.needs.energy < 25 ? 2 : 0), w: 3 },
  { type: 'play', need: (m) => (m.needs.mood < 40 ? 2 : 0), w: 1.6 },
  { type: 'music', need: (m) => (m.needs.mood < 45 ? 1.6 : 0), w: 1.4 },
  { type: 'dance', need: (m) => (m.needs.mood < 50 ? 1 : 0), w: 0.8 },
  { type: 'read', need: () => 0.8, w: 1 },
  { type: 'water', need: () => 0.6, w: 0.8 },
  { type: 'sit', need: () => 0.7, w: 1.2 },
  { type: 'watch', need: () => 0.8, w: 1.2 },
  { type: 'come', need: (m) => (m.needs.social < 32 ? 3 : 0), w: 2 },
];

/** 无模型时的本地决策：作息 + 需求 + 行为强化加权随机 */
export function decideLocally(m: CabinMind, night: boolean): DecisionResult {
  const now = new Date();
  const hour = now.getHours();
  const slot = scheduleSlot(hour, [0, 6].includes(now.getDay()));
  if (night || slot.act === 'sleep') {
    return { thought: '困了…去睡吧', say: [], actions: [{ type: 'lie', dur: 0 }] };
  }
  if (m.sulk.on) {
    const away = (['br', 'sr', 'bal', 'yd'] as const)[Math.floor(Math.random() * 4)];
    return { thought: '哼，不想理你', say: [], actions: [{ type: 'goto', room: away }, { type: 'sit' }] };
  }
  // B1：被夸过的歌优先——练琴时弹「上次你说好听的那首」
  const praised = praisedSongs(m);
  // 作息优先
  if (slot.act === 'cook-eat') return { thought: '到饭点啦', say: [], actions: [{ type: 'cook' }, { type: 'eat' }] };
  if (slot.act === 'play')
    return praised[0]
      ? { thought: `弹${praised[0]}吧，TA 爱听`, say: [], actions: [{ type: 'play', song: praised[0] }] }
      : { thought: '练会儿琴吧', say: [], actions: [{ type: 'play' }] };
  if (slot.act === 'read') return { thought: '看会儿书', say: [], actions: [{ type: 'read' }] };
  if (slot.act === 'garden') return { thought: '去花园转转', say: [], actions: [{ type: 'goto', room: 'yd' }, { type: 'water' }] };
  if (slot.act === 'wash') return { thought: '收拾一下', say: [], actions: [{ type: 'goto', room: 'ba' }, { type: 'stretch' }] };
  if (slot.act === 'watch') return { thought: '陪你看电视', say: [], actions: [{ type: 'watch' }] };
  // 需求 + 强化加权
  const pool = ACT_W.map((a) => ({ type: a.type, w: (a.need(m, hour, night) + a.w) * reinforceWeight(m, a.type) * (0.6 + Math.random() * 0.8) }));
  pool.sort((x, y) => y.w - x.w);
  const pick = pool[0]?.type ?? 'sit';
  const extra: Record<string, { type: string }[]> = { cook: [{ type: 'eat' }] };
  const playSong = pick === 'play' ? praised[0] : undefined;
  const thoughtMap: Record<string, string> = {
    cook: '肚子有点饿…做点吃的',
    eat: '吃饭啦',
    lie: '好困…',
    play: playSong ? `弹${playSong}吧` : '弹会儿琴',
    music: '放首歌听',
    dance: '想动一动',
    read: '翻翻书',
    water: '浇浇花',
    sit: '坐会儿',
    watch: '看看电视',
    come: '想去 TA 身边',
  };
  return {
    thought: thoughtMap[pick] ?? '随便转转',
    say: [],
    actions: [
      { type: pick, ...(playSong ? { song: playSong } : {}) },
      ...(extra[pick] ?? []),
    ],
  };
}
