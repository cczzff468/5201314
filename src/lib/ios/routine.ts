'use client';

/**
 * 作息记忆（第十六轮）—— 记住机主的作息规律，让 AI 在合适的时间说合适的话：
 *
 * - 打点：noteActive()（beginChatStream 三端聊天统一入口 + 语音通话 runTurn 调用），
 *   每天记 { first: 当日首条消息时刻, last: 当日末条消息时刻 }，滚动保留 14 天；
 * - 推断：routineProfile() 用近 7 天中位数估算起床/入睡时刻（样本 ≥3 天才算 ready）；
 * - 注入：buildRoutineBlock()（persona.ts 内调用）——「TA 通常 07:40 左右起床、23:50 左右睡觉；
 *   现在 08:10（TA 平时这个点刚起来没多久）」——AI 自然会在合适时间说早安/晚安/催睡觉，
 *   深夜该劝睡、清早该道早安；
 * - 早安/晚安/吃饭提醒的主动消息由 couple-ai.ts 的 routine 触发（不占自主额度，每项每天最多 1 次）。
 * 存储：localStorage routine-hist（全局单份——作息是「机主」的属性，与聊天对象无关）。
 */

interface DayRecord {
  /** 当日首条消息的分钟数（0:00 起） */
  first: number;
  /** 当日末条消息的分钟数（跨午夜按 24h+ 记录，如次日 0:40 = 1480） */
  last: number;
}

const HIST_KEY = 'routine-hist';
const KEEP_DAYS = 14;
const PROFILE_SAMPLE_DAYS = 7;

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readHist(): Record<string, DayRecord> {
  try {
    const raw = window.localStorage.getItem(HIST_KEY);
    const j = raw ? (JSON.parse(raw) as Record<string, DayRecord>) : {};
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeHist(h: Record<string, DayRecord>): void {
  try {
    const keys = Object.keys(h).sort();
    const trimmed: Record<string, DayRecord> = {};
    for (const k of keys.slice(-KEEP_DAYS)) trimmed[k] = h[k];
    window.localStorage.setItem(HIST_KEY, JSON.stringify(trimmed));
  } catch {
    /* 落盘失败静默 */
  }
}

/** 当前时刻的分钟数（含跨午夜修正：0~4 点算「前一天深夜」→ +1440，作息连续性好算） */
function minuteNow(d = new Date()): number {
  const m = d.getHours() * 60 + d.getMinutes();
  return d.getHours() < 4 ? m + 1440 : m;
}

/** 用户发消息打点（记当日 first/last） */
export function noteActive(): void {
  try {
    const now = new Date();
    const key = dayKeyOf(now);
    const m = minuteNow(now);
    const h = readHist();
    const cur = h[key];
    if (!cur) {
      h[key] = { first: m, last: m };
    } else {
      h[key] = { first: Math.min(cur.first, m), last: Math.max(cur.last, m) };
    }
    writeHist(h);
  } catch {
    /* 静默 */
  }
}

export interface RoutineProfile {
  ready: boolean;
  /** 估算起床时刻（分钟，0:00 起） */
  wake: number;
  /** 估算入睡时刻（分钟；>1440 表示次日） */
  sleep: number;
  /** 样本天数 */
  sample: number;
}

function median(list: number[]): number {
  const a = [...list].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

/** 推断作息（近 7 天中位数；样本 ≥3 天才 ready） */
export function routineProfile(): RoutineProfile {
  const h = readHist();
  const keys = Object.keys(h).sort().slice(-PROFILE_SAMPLE_DAYS);
  if (keys.length < 3) return { ready: false, wake: 7 * 60, sleep: 23 * 60, sample: keys.length };
  // 起床：取「first 中合理的一段」——只统计 4:00~12:00 之间的首条（排除熬夜到 5 点的噪声，
  // 也把 >12:00 的（起来很晚）按 12:00 封顶参与中位数）
  const wakes = keys.map((k) => h[k].first % 1440).filter((m) => m >= 4 * 60 && m <= 12 * 60);
  // 入睡：last 直接中位数（跨午夜已 +1440，范围 21:00~次日 3:00 都正常）
  const sleeps = keys.map((k) => h[k].last).filter((m) => m >= 20 * 60 && m <= 24 * 60 + 180);
  if (wakes.length < 2 || sleeps.length < 2) return { ready: false, wake: 7 * 60, sleep: 23 * 60, sample: keys.length };
  const wake = Math.max(5 * 60, Math.min(12 * 60, median(wakes)));
  const sleep = Math.max(20 * 60, Math.min(24 * 60 + 170, median(sleeps)));
  return { ready: true, wake, sleep, sample: keys.length };
}

function fmtMin(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

/**
 * 作息 → 提示词块（persona 注入；无样本返回空串不浪费 token）。
 * 内容：TA 的作息画像 + 当前时刻的状态对照（还醒着/已睡/刚起/快睡了）。
 */
export function buildRoutineBlock(): string {
  const p = routineProfile();
  if (!p.ready) return '';
  const nowM = minuteNow();
  const nowLabel = fmtMin(nowM);
  let state = '';
  if (nowM >= p.wake - 40 && nowM < p.wake + 90) state = 'TA 平时这个点刚起来没多久（或还没起）';
  else if (nowM >= p.wake + 90 && nowM < 12 * 60 + 30) state = 'TA 平时这个点是上午活跃时段';
  else if (nowM >= 12 * 60 + 30 && nowM < 14 * 60) state = 'TA 平时这个点大概在吃午饭/午休';
  else if (nowM >= 14 * 60 && nowM < 18 * 60) state = 'TA 平时这个点是下午活跃时段';
  else if (nowM >= 18 * 60 && nowM < p.sleep - 60) state = 'TA 平时这个点是晚上活跃时段';
  else if (nowM >= p.sleep - 60 && nowM <= p.sleep + 30) state = 'TA 平时这个点快睡了（今晚可能准备休息了）';
  else if (nowM > p.sleep + 30 || nowM < p.wake - 40) state = 'TA 平时这个点已经在睡觉了（别指望秒回，消息语气也要考虑别吵醒 TA）';
  return `【TA 的作息规律（你记住了的）】TA 通常 ${fmtMin(p.wake)} 左右起床、${fmtMin(p.sleep)} 左右睡觉。现在是 ${nowLabel}，${state}。你按这个作息拿捏说话时机和分寸：清早可以说早安、深夜该催 TA 睡觉、饭点可以关心一句吃饭——但都自然一点，不要每次都说。`;
}

// ---------------- 早安/晚安/吃饭提醒（每日轻触发，couple-ai 调用） ----------------

export type RoutineNudgeKind = 'morning' | 'night' | 'meal';

const NUDGE_KEY = 'routine-nudge-day';

function nudgeState(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(NUDGE_KEY);
    const j = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

/**
 * 判定此刻该不该发某类作息提醒（每天最多 1 次；返回 false = 今天发过了/条件不满足）：
 * - morning：now ≥ 起床+20min 且 < 11:00（TA 该起来了，道早安）；
 * - night：now ≥ 入睡-50min（该催睡了，道晚安）且 < 入睡+60；
 * - meal：11:30~12:40 或 17:40~19:00（饭点关心，午晚二选一，每天 1 次）。
 */
export function routineNudgeDue(kind: RoutineNudgeKind, now = new Date()): boolean {
  const p = routineProfile();
  if (!p.ready) return false;
  const st = nudgeState();
  const today = dayKeyOf(now);
  if (st[`${kind}:${today}`]) return false;
  const m = minuteNow(now);
  if (kind === 'morning') return m >= p.wake + 20 && m < 11 * 60;
  if (kind === 'night') return m >= p.sleep - 50 && m <= p.sleep + 60;
  return (m >= 11 * 60 + 30 && m <= 12 * 60 + 40) || (m >= 17 * 60 + 40 && m <= 19 * 60);
}

/** 标记某类提醒今天已发（发出后调用） */
export function routineNudgeMark(kind: RoutineNudgeKind, now = new Date()): void {
  try {
    const st = nudgeState();
    const today = dayKeyOf(now);
    st[`${kind}:${today}`] = '1';
    // 只保留最近 8 个键
    const keys = Object.keys(st).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 8))) delete st[k];
    window.localStorage.setItem(NUDGE_KEY, JSON.stringify(st));
  } catch {
    /* 静默 */
  }
}
