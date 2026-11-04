'use client';

/**
 * 拾光小屋 —— 本地存储帮手（从 CoupleHome.tsx 原样搬移，逻辑零变化）
 *
 * - v10 C4 宠物日记（localStorage `cabin-pet-diary`）
 * - v11 G2 环境白噪音的 sfx 防御式包装（sfx.ambient 未落地时静默 no-op）
 * - v11 I2 里程碑统计（localStorage `cabin-stats-<charId>`）
 * - v8.2 优化A 小屋会话存档（localStorage `cabin-chat-<charId>`）
 */

import { sfx } from '../sfx';

// ---------------- v10 C4 宠物日记（每天它干了啥，面板里翻阅） ----------------

export interface PetDiaryEntry {
  ts: number;
  text: string;
}

export function loadPetDiary(): PetDiaryEntry[] {
  try {
    const raw = window.localStorage.getItem('cabin-pet-diary');
    const j = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(j)
      ? j.filter((e): e is PetDiaryEntry => !!e && typeof e === 'object' && typeof (e as PetDiaryEntry).ts === 'number' && typeof (e as PetDiaryEntry).text === 'string').slice(-60)
      : [];
  } catch {
    return [];
  }
}

export function addPetDiary(text: string): void {
  try {
    const list = loadPetDiary();
    const day = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    list.push({ ts: Date.now(), text: `[${day}] ${text}`.slice(0, 80) });
    window.localStorage.setItem('cabin-pet-diary', JSON.stringify(list.slice(-60)));
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

// ---------------- v11 G2 环境白噪音（sfx 环境音 API 防御式包装：12-b 未落地时静默 no-op） ----------------

export const sfxAmbient = sfx as unknown as {
  ambient?: (k: 'rain' | 'fire' | 'wind' | null) => void;
  ambientCurrent?: () => 'rain' | 'fire' | 'wind' | null;
};

// ---------------- v11 I2 里程碑统计（在一起天数/聊天/做饭/拥抱/牵手/照顾宠物） ----------------

export interface CabinStats {
  /** 开始记录（≈在一起）的时间戳；缺省 = 首次写入时间 */
  since: number;
  chatLines: number;
  meals: number;
  hugs: number;
  holds: number;
  petCares: number;
}

export const STATS_KEY = (id: string) => `cabin-stats-${id}`;

export function loadCabinStats(id: string): CabinStats {
  try {
    const raw = window.localStorage.getItem(STATS_KEY(id));
    if (raw) {
      const j = JSON.parse(raw) as Partial<CabinStats>;
      const since = typeof j.since === 'number' && j.since > 0 ? j.since : Date.now();
      const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0);
      return {
        since,
        chatLines: num(j.chatLines),
        meals: num(j.meals),
        hugs: num(j.hugs),
        holds: num(j.holds),
        petCares: num(j.petCares),
      };
    }
  } catch {
    /* 坏档按新档处理 */
  }
  return { since: Date.now(), chatLines: 0, meals: 0, hugs: 0, holds: 0, petCares: 0 };
}

/** 里程碑累加（delta 传正数增量），返回落盘后的最新档（调用方同步进 statsRef） */
export function bumpCabinStats(
  id: string,
  delta: Partial<Record<'chatLines' | 'meals' | 'hugs' | 'holds' | 'petCares', number>>,
): CabinStats {
  const cur = loadCabinStats(id);
  const next: CabinStats = {
    since: cur.since,
    chatLines: cur.chatLines + (delta.chatLines ?? 0),
    meals: cur.meals + (delta.meals ?? 0),
    hugs: cur.hugs + (delta.hugs ?? 0),
    holds: cur.holds + (delta.holds ?? 0),
    petCares: cur.petCares + (delta.petCares ?? 0),
  };
  try {
    window.localStorage.setItem(STATS_KEY(id), JSON.stringify(next));
  } catch {
    /* 隐私模式写不进就算了 */
  }
  return next;
}

/** 每个角色一份会话存档（LLM 上下文 + 记忆提取轮次） */
export interface CabinConvoSave {
  convo: { role: 'user' | 'assistant'; content: string }[];
  turns: { role: 'me' | 'peer'; text: string }[];
  ts: number;
}

export const CONVO_SAVE_LIMIT = 40;

export function loadCabinConvo(id: string): CabinConvoSave {
  try {
    const raw = window.localStorage.getItem(`cabin-chat-${id}`);
    if (!raw) return { convo: [], turns: [], ts: 0 };
    const j = JSON.parse(raw) as Partial<CabinConvoSave>;
    const convo = Array.isArray(j.convo)
      ? j.convo
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-CONVO_SAVE_LIMIT)
      : [];
    const turns = Array.isArray(j.turns)
      ? j.turns.filter((m) => m && (m.role === 'me' || m.role === 'peer') && typeof m.text === 'string').slice(-CONVO_SAVE_LIMIT)
      : [];
    return { convo, turns, ts: typeof j.ts === 'number' ? j.ts : 0 };
  } catch {
    return { convo: [], turns: [], ts: 0 };
  }
}

export function saveCabinConvo(
  id: string,
  convo: { role: 'user' | 'assistant'; content: string }[],
  turns: { role: 'me' | 'peer'; text: string }[],
): void {
  try {
    const data: CabinConvoSave = { convo: convo.slice(-CONVO_SAVE_LIMIT), turns: turns.slice(-CONVO_SAVE_LIMIT), ts: Date.now() };
    window.localStorage.setItem(`cabin-chat-${id}`, JSON.stringify(data));
  } catch {
    /* 写不进就算了（隐私模式） */
  }
}
