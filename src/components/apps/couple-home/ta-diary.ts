'use client';

/**
 * 拾光小屋 · TA 的日记（v11 F2）
 *
 * 每天由 CoupleHome 的 30s 心跳触发一次 `ensureTodayDiary`：
 * 当天（自然日）还没写过 → 用当天截至此刻的素材（做过的事 / 天气 / 心情 / 聊天句数）
 * 以 TA 的第一人称视角写一篇日记，存 localStorage `cabin-ta-diary-<charId>`（上限 60 条）。
 * TaDiarySheet 面板负责倒序翻阅；纯逻辑模块，不依赖 React / three。
 */

// ---------------- 类型 ----------------

export interface TaDiaryEntry {
  /** 自然日 YYYY-MM-DD */
  date: string;
  /** 日记正文（TA 第一人称） */
  text: string;
  /** 写日记时的心情标签（happy / content / low / missing / sulking） */
  mood: string;
}

/** 写日记时由心跳现场收集的素材 */
export interface TaDiaryCtx {
  /** TA 的名字 */
  name: string;
  /** 今天做过的事（短句数组，如「弹了一首曲子」；可为空 = 截至此刻还没做什么） */
  actions: string[];
  /** 天气文案（下雨/下雪/阴天/多云/晴） */
  weather: string;
  /** 心情标签（同 TaDiaryEntry.mood） */
  mood: string;
  /** 今天和主人聊了多少句 */
  chatLines: number;
}

const KEY = (id: string) => `cabin-ta-diary-${id}`;
const MAX_ENTRIES = 60;

// ---------------- 模板（做了什么 + 心情收尾句） ----------------

/** 开头句：自我介绍式的起笔 */
const OPENINGS: ((name: string, weather: string) => string)[] = [
  (_n, w) => `今天窗外${w}，屋里安安静静的。`,
  (n, w) => `${w}的日子，${n}的小屋也过得慢悠悠的。`,
  (_n, w) => `窗外${w}，又是被小屋收留的一天。`,
  (_n, w) => `今天${w}，心情也跟着天气一点点晃。`,
  (_n, w) => `早晨醒来先看了看窗外——${w}。`,
];

/** 没做什么时的兜底句 */
const IDLE_LINES: string[] = [
  '今天大多时候就在屋里待着，晒晒太阳、发发呆。',
  '今天过得平平淡淡，把自己收拾得干干净净的。',
  '今天没什么特别的事，倒是把屋子好好看了看——哪里都舒服。',
];

/** 心情收尾句（按 cabin-mind 的情绪标签） */
const MOOD_CLOSINGS: Record<string, string[]> = {
  happy: ['总之今天心里甜甜的，连梦都应该是彩色的。', '今天满意极了，想把这个日子悄悄折起来收好。'],
  content: ['平平静稳的一天，这样就很好。', '心里不慌不忙的，像晒过太阳的被子。'],
  low: ['有点蔫蔫的，希望明天胃口和心情都好一点。', '今天有点没力气，早点睡，明天再元气满满吧。'],
  missing: ['其实…今天很想很想主人，希望 TA 明天多陪陪我。', '数着时针想主人，一天就这么过去了。'],
  sulking: ['哼，今天有点小情绪，不过…要是主人来哄我，我立刻就好。', '记一笔小脾气，但不许主人看这一行！'],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 素材 → 日记正文（TA 第一人称） */
export function buildTaDiaryText(ctx: TaDiaryCtx): string {
  const parts: string[] = [pick(OPENINGS)(ctx.name, ctx.weather)];
  const acts = ctx.actions.filter((a) => !!a.trim()).slice(0, 6);
  if (acts.length > 0) {
    parts.push(`今天我${acts.join('，')}。`);
  } else {
    parts.push(pick(IDLE_LINES));
  }
  if (ctx.chatLines > 0) {
    parts.push(`和主人聊了 ${ctx.chatLines} 句话，每一句都想好好回。`);
  }
  parts.push(pick(MOOD_CLOSINGS[ctx.mood] ?? MOOD_CLOSINGS.content));
  return parts.join('');
}

// ---------------- 存取 ----------------

/** 读全部日记（时间正序，最多 60 条；坏档兜底空数组） */
export function loadTaDiary(charId: string): TaDiaryEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY(charId));
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j)
      ? j
          .filter(
            (e): e is TaDiaryEntry =>
              !!e && typeof e === 'object' && typeof (e as TaDiaryEntry).date === 'string' && typeof (e as TaDiaryEntry).text === 'string',
          )
          .map((e) => ({ date: e.date, text: e.text, mood: typeof e.mood === 'string' ? e.mood : 'content' }))
          .slice(-MAX_ENTRIES)
      : [];
  } catch {
    return [];
  }
}

/** 清空日记（面板「清空」按钮用） */
export function clearTaDiary(charId: string): void {
  try {
    window.localStorage.removeItem(KEY(charId));
  } catch {
    /* 隐私模式移除失败就算了 */
  }
}

/**
 * 确保今天有日记：当天还没写才写，写过返回 false。
 * 由心跳每天首次触发调用（当天 actions 可以只含截至当前的事）。
 */
export function ensureTodayDiary(charId: string, ctx: TaDiaryCtx): boolean {
  const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const list = loadTaDiary(charId);
  if (list.some((e) => e.date === today)) return false;
  const entry: TaDiaryEntry = { date: today, text: buildTaDiaryText(ctx).slice(0, 160), mood: ctx.mood || 'content' };
  try {
    window.localStorage.setItem(KEY(charId), JSON.stringify([...list, entry].slice(-MAX_ENTRIES)));
  } catch {
    return false; // 隐私模式写不进：视作没写成
  }
  return true;
}
