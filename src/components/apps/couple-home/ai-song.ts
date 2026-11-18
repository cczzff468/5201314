'use client';

/**
 * 拾光小屋 · AI 弹奏曲库 + 任意歌实时记谱（v10）
 *
 * 用户对 AI 说「弹一首小星星 / 来首晴天」→ 大模型在 ACT 动作块里带 song 参数 → 前端三层取谱：
 * 1. 经典曲库（AI_SONGS，内置 10 首精准记谱，命中即弹，零延迟）；
 * 2. 记谱缓存（IndexedDB settings 库）：LLM 记过一次的歌永久缓存，第二次点秒出；
 * 3. 实时记谱兜底（POST /api/ai-song）：模型现写主旋律（C3–C6 音名序列）→ 播放 + 入缓存。
 * 全失败 → 即兴五声音阶小曲。
 *
 * 播放引擎（Web Audio 可听）：
 * - 钢琴：pianoNote 谐波合成（grand）；吉他：pluckString Karplus-Strong 拨弦；
 * - 放歌（音箱/唱片机/八音盒）：pianoNote musicbox 音色轻声循环；
 * - 每个音符广播 emitNote（3D 小人手势 + 琴键/弦位灯光联动）；
 * - onSongState 曲目事件总线：InstrumentOverlay 订阅后显示曲名字幕（v10 C2）。
 */

import { emitNote, pianoNote, pluckString, PIANO_BLACK, PIANO_WHITE } from './instrument';
import { localDB } from '@/lib/ios/db';
import { useSettings } from '@/lib/ios/store';

/** 一首曲子：音名 + 拍数 */
interface SongNote {
  name: string;
  beats: number;
}

export interface SongDef {
  /** 标准曲名 */
  title: string;
  /** 别名（用户口语叫法） */
  aliases: string[];
  /** 每拍毫秒（四分音符时值） */
  tempoMs: number;
  notes: SongNote[];
  /** 记谱来源：library 内置 / llm 实时记谱（缓存与内置同形，来源标记仅用于文案） */
  via?: 'library' | 'llm' | 'cache';
}

/** 曲库（10 首经典曲；v10 新增四首：铃儿响叮当/玛丽的小羊/致爱丽丝/卡农，含黑键） */
export const AI_SONGS: SongDef[] = [
  {
    title: '小星星',
    aliases: ['一闪一闪亮晶晶', '闪亮晶晶'],
    tempoMs: 420,
    notes: [
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'A4', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'A4', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '两只老虎',
    aliases: ['两只小老虎', '跑得快'],
    tempoMs: 380,
    notes: [
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'F4', beats: 0.5 },
      { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'F4', beats: 0.5 },
      { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'G3', beats: 1 }, { name: 'C4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'G3', beats: 1 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '生日快乐',
    aliases: ['生日歌', '祝你生日快乐', 'happy birthday'],
    tempoMs: 460,
    notes: [
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'B4', beats: 2 },
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'D5', beats: 1 }, { name: 'C5', beats: 2 },
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'G5', beats: 1 }, { name: 'E5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'B4', beats: 1 }, { name: 'A4', beats: 2 },
      { name: 'F5', beats: 0.75 }, { name: 'F5', beats: 0.25 }, { name: 'E5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'D5', beats: 1 }, { name: 'C5', beats: 2 },
    ],
  },
  {
    title: '欢乐颂',
    aliases: ['贝多芬第九交响曲', '快乐颂'],
    tempoMs: 400,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'E4', beats: 1.5 }, { name: 'D4', beats: 0.5 }, { name: 'D4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1.5 }, { name: 'C4', beats: 0.5 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '小蜜蜂',
    aliases: ['嗡嗡嗡'],
    tempoMs: 380,
    notes: [
      { name: 'G4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'C4', beats: 2 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '茉莉花',
    aliases: ['好一朵美丽的茉莉花'],
    tempoMs: 460,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'A4', beats: 1 },
      { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
    ],
  },
  {
    title: '铃儿响叮当',
    aliases: ['叮叮当', 'jingle bells', '圣诞节歌'],
    tempoMs: 330,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'E4', beats: 4 },
      { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'F4', beats: 1.5 }, { name: 'F4', beats: 0.5 },
      { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 0.5 }, { name: 'E4', beats: 0.5 },
      { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 2 }, { name: 'G4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'E4', beats: 4 },
    ],
  },
  {
    title: '玛丽的小羊',
    aliases: ['玛丽有只小羊羔', '小羊羔', 'mary had a little lamb'],
    tempoMs: 360,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'C4', beats: 4 },
    ],
  },
  {
    title: '致爱丽丝',
    aliases: ['献给爱丽丝', 'fur elise', 'Für Elise', '爱丽丝'],
    tempoMs: 300,
    notes: [
      { name: 'E5', beats: 0.5 }, { name: 'D#5', beats: 0.5 }, { name: 'E5', beats: 0.5 }, { name: 'D#5', beats: 0.5 },
      { name: 'E5', beats: 0.5 }, { name: 'B4', beats: 0.5 }, { name: 'D5', beats: 0.5 }, { name: 'C5', beats: 0.5 },
      { name: 'A4', beats: 1 },
      { name: 'C4', beats: 0.5 }, { name: 'E4', beats: 0.5 }, { name: 'A4', beats: 0.5 },
      { name: 'B4', beats: 1 },
      { name: 'E4', beats: 0.5 }, { name: 'G#4', beats: 0.5 }, { name: 'B4', beats: 0.5 },
      { name: 'C5', beats: 1 },
      { name: 'E4', beats: 0.5 }, { name: 'E5', beats: 0.5 }, { name: 'D#5', beats: 0.5 },
      { name: 'E5', beats: 0.5 }, { name: 'D#5', beats: 0.5 }, { name: 'E5', beats: 0.5 }, { name: 'B4', beats: 0.5 },
      { name: 'D5', beats: 0.5 }, { name: 'C5', beats: 0.5 }, { name: 'A4', beats: 1 },
      { name: 'C4', beats: 0.5 }, { name: 'E4', beats: 0.5 }, { name: 'A4', beats: 0.5 },
      { name: 'B4', beats: 1 },
      { name: 'E4', beats: 0.5 }, { name: 'C5', beats: 0.5 }, { name: 'B4', beats: 0.5 },
      { name: 'A4', beats: 2 },
    ],
  },
  {
    title: '卡农',
    aliases: ['卡农钢琴曲', 'canon', 'D大调卡农', '帕赫贝尔卡农'],
    tempoMs: 400,
    notes: [
      { name: 'F5', beats: 2 }, { name: 'E5', beats: 2 }, { name: 'D5', beats: 2 }, { name: 'C5', beats: 2 },
      { name: 'B4', beats: 2 }, { name: 'A4', beats: 2 }, { name: 'B4', beats: 2 }, { name: 'C5', beats: 2 },
      { name: 'D5', beats: 2 }, { name: 'C5', beats: 2 }, { name: 'B4', beats: 2 }, { name: 'A4', beats: 2 },
      { name: 'G4', beats: 2 }, { name: 'F4', beats: 2 }, { name: 'G4', beats: 2 }, { name: 'A4', beats: 2 },
      { name: 'B4', beats: 2 }, { name: 'G4', beats: 2 }, { name: 'A4', beats: 2 }, { name: 'B4', beats: 2 },
      { name: 'C5', beats: 2 }, { name: 'A4', beats: 2 }, { name: 'B4', beats: 2 }, { name: 'C5', beats: 2 },
      { name: 'D5', beats: 2 }, { name: 'E5', beats: 2 }, { name: 'F5', beats: 2 }, { name: 'E5', beats: 2 },
      { name: 'D5', beats: 2 }, { name: 'C5', beats: 2 }, { name: 'B4', beats: 2 }, { name: 'C5', beats: 2 },
      { name: 'C4', beats: 4 },
    ],
  },
];

/** 音名 → 频率表（白键 + 黑键，合成器同源） */
const NOTE_FREQ = new Map<string, number>([...PIANO_WHITE, ...PIANO_BLACK].map((n) => [n.name, n.freq]));

/** 合法音名集合（API 记谱结果清洗用） */
const VALID_NOTE_NAMES = new Set(NOTE_FREQ.keys());

/** 曲库曲名清单（给提示词用） */
export const AI_SONG_NAMES = AI_SONGS.map((s) => s.title).join('、');

/** 用户话/AI 参数 → 曲库匹配（曲名/别名包含即命中；如「弹个生日歌呀」命中「生日快乐」） */
export function matchSong(input?: string): SongDef | null {
  const q = (input ?? '').replace(/\s|《|》|["'「」]/g, '').trim();
  if (!q) return null;
  for (const s of AI_SONGS) {
    if (q.includes(s.title) || s.title.includes(q)) return s;
    for (const a of s.aliases) if (q.includes(a) || a.includes(q)) return s;
  }
  return null;
}

// ---------------- v10 任意歌记谱（缓存 + /api/ai-song 兜底） ----------------

/** 记谱缓存键（settings 库；值 = 归一曲名 → SongDef） */
const CACHE_KEY = 'ai-song-cache:v1';
/** 缓存上限（超了丢最旧 —— Map 插入序即最旧） */
const CACHE_MAX = 40;

interface SongCacheMap {
  [title: string]: { title: string; tempoMs: number; notes: SongNote[] };
}

/** 内存镜像（一次会话内不重复读 IDB） */
let cacheMem: SongCacheMap | null = null;
/** 进行中的记谱请求（同曲去重） */
const inflight = new Map<string, Promise<SongDef | null>>();

/** 曲名归一（去书名号/空白/大小写 → 缓存键） */
function normKey(t: string): string {
  return t.replace(/\s|《|》|["'「」]/g, '').toLowerCase();
}

/** 读缓存（库 + IDB 两层） */
async function cachedSong(input: string): Promise<SongDef | null> {
  const key = normKey(input);
  if (!key) return null;
  try {
    if (!cacheMem) {
      const rec = await localDB.get('settings', CACHE_KEY);
      cacheMem = (rec?.value as SongCacheMap | undefined) ?? {};
    }
    const hit = cacheMem[key];
    if (!hit || !Array.isArray(hit.notes) || hit.notes.length < 8) return null;
    return { ...hit, aliases: [], via: 'cache' };
  } catch {
    return null;
  }
}

/** 写缓存（失败静默：只是下次要重新记谱） */
async function saveCachedSong(def: SongDef): Promise<void> {
  try {
    if (!cacheMem) cacheMem = {};
    cacheMem[normKey(def.title)] = { title: def.title, tempoMs: def.tempoMs, notes: def.notes };
    const keys = Object.keys(cacheMem);
    if (keys.length > CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cacheMem[k];
    }
    await localDB.put('settings', { key: CACHE_KEY, value: cacheMem });
  } catch {
    /* 隐私模式写不进就算了 */
  }
}

/** 接口记谱结果 → SongDef（清洗：非法音符丢弃 / 拍数钳制 / 长度封顶） */
function sanitizeRemoteSong(raw: unknown, fallbackTitle: string): SongDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { title?: unknown; tempoMs?: unknown; notes?: unknown };
  const notesIn = Array.isArray(r.notes) ? r.notes : [];
  const notes: SongNote[] = [];
  for (const n of notesIn) {
    if (!n || typeof n !== 'object') continue;
    const rec = n as { name?: unknown; beats?: unknown };
    let name = typeof rec.name === 'string' ? rec.name.trim().replace('♯', '#') : '';
    if (!VALID_NOTE_NAMES.has(name)) continue;
    let beats = typeof rec.beats === 'number' && Number.isFinite(rec.beats) ? rec.beats : 1;
    beats = Math.min(4, Math.max(0.25, Math.round(beats * 4) / 4));
    notes.push({ name, beats });
    if (notes.length >= 96) break;
  }
  if (notes.length < 8) return null;
  let tempoMs = typeof r.tempoMs === 'number' && Number.isFinite(r.tempoMs) ? r.tempoMs : 380;
  tempoMs = Math.min(600, Math.max(250, Math.round(tempoMs)));
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 24) : fallbackTitle.slice(0, 24);
  return { title, aliases: [], tempoMs, notes, via: 'llm' };
}

/**
 * 取一首歌的谱子（三层）：
 * 1. 内置曲库（精准）→ 2. 记谱缓存（秒回）→ 3. /api/ai-song 实时记谱（模型现写，成功后入缓存）。
 * 全失败返回 null（调用方回落即兴小曲）。
 */
export async function resolveSong(input?: string): Promise<SongDef | null> {
  const lib = matchSong(input);
  if (lib) return lib;
  const q = (input ?? '').trim();
  if (!q) return null;
  const cached = await cachedSong(q);
  if (cached) return cached;
  const key = normKey(q);
  const running = inflight.get(key);
  if (running) return running;
  const p = (async (): Promise<SongDef | null> => {
    try {
      const res = await fetch('/api/ai-song', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: q, config: useSettings.getState().apiConfig }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { ok?: boolean; song?: unknown };
      if (!j?.ok) return null;
      const def = sanitizeRemoteSong(j.song, q);
      if (!def) return null;
      void saveCachedSong(def);
      return def;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** 预取（TA 还在走向乐器的路上就开始记谱，到位即弹）：曲库已命中/正在记的直接跳过 */
export function prefetchSong(input?: string): void {
  if (!input?.trim() || matchSong(input)) return;
  const key = normKey(input);
  if (inflight.has(key)) return;
  void resolveSong(input).catch(() => {});
}

// ---------------- 播放调度（可随时打断） ----------------

type PlayKind = 'piano' | 'guitar' | 'musicbox';

let songTimers: ReturnType<typeof setTimeout>[] = [];
/** 当前正在播的曲名（重复触发同曲忽略） */
let currentKey = '';

/** 停止当前弹奏（新指令/动作结束时调用） */
export function stopAiSong(): void {
  songTimers.forEach(clearTimeout);
  songTimers = [];
  currentKey = '';
  emitSongState({ playing: false });
}

/**
 * 播一份现成谱（核心调度；def 可为 null = 即兴）：
 * - piano → pianoNote grand；guitar → pluckString；musicbox → pianoNote musicbox（轻声，放歌用）；
 * - loop=true 时循环播放（放歌场景）；每个音符广播 emitNote（可视化联动：琴键/弦位灯光）；
 * - 曲目开始/结束广播 onSongState（v10 C2 曲名字幕）。
 */
function playSongDef(
  kind: PlayKind,
  def: SongDef | null,
  _songInput: string | undefined,
  opts?: { loop?: boolean; vol?: number },
): string {
  songTimers.forEach(clearTimeout);
  songTimers = [];
  const loop = opts?.loop ?? false;
  const vol = opts?.vol ?? (kind === 'musicbox' ? 0.4 : 0.55);

  // 没谱子 → 即兴小曲：C 五声音阶上下行 + 随机跳音，听感温柔不刺耳
  const notes: SongNote[] = def?.notes ?? (() => {
    const scale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'A4', 'G4', 'E4', 'D4', 'C4'];
    const pick = [...scale, ...scale.slice(1, -1).reverse()];
    return pick.map((name, i) => ({ name, beats: i === pick.length - 1 ? 2 : 1 }));
  })();
  const title = def?.title ?? '即兴';
  currentKey = `${kind}:${title}`;

  const tempo = def?.tempoMs ?? 400;
  let t = 320; // 起手留一点「坐定」时间
  const schedule = (list: SongNote[]) => {
    for (const n of list) {
      const at = t;
      const freq = NOTE_FREQ.get(n.name) ?? 440;
      songTimers.push(
        setTimeout(() => {
          if (kind === 'guitar') pluckString(freq, vol, 'acoustic');
          else pianoNote(freq, vol, kind === 'musicbox' ? 'musicbox' : 'grand');
          emitNote({ kind: kind === 'guitar' ? 'guitar' : 'piano', freq, name: n.name });
        }, at),
      );
      t += n.beats * tempo;
    }
  };
  schedule(notes);
  // 曲目状态广播（v10 C2：InstrumentOverlay 显示曲名字幕）
  emitSongState({ playing: true, title, kind });
  if (loop) {
    // 放歌：循环到被停止（每次续排 90s，避免无限定时器堆积；停止/新指令即清空）
    const scheduleLoop = () => {
      if (!currentKey) return;
      schedule(notes);
      songTimers.push(setTimeout(scheduleLoop, t + 600));
    };
    songTimers.push(setTimeout(scheduleLoop, t + 600));
  } else {
    // 单次弹奏：最后一个音结束后广播结束（字幕收起）
    songTimers.push(
      setTimeout(() => {
        if (currentKey === `${kind}:${title}`) {
          currentKey = '';
          emitSongState({ playing: false });
        }
      }, t + 900),
    );
  }
  return title;
}

/**
 * v10 点歌播放（A1+A2 主入口）：曲库 → 缓存 → LLM 实时记谱，取到什么弹什么。
 * - 同曲正在播直接跳过（防重）；
 * - 返回 { title, via }：via = library（曲库秒弹）/ llm（现记的谱）/ improv（没谱即兴），
 *   调用方按 via 决定文案（「弹起了《X》」vs「现记了《X》的谱子弹给你听」）。
 */
export async function playRequestedSong(
  kind: PlayKind,
  songInput?: string,
  opts?: { loop?: boolean; vol?: number },
): Promise<{ title: string; via: 'library' | 'llm' | 'cache' | 'improv' }> {
  const def = await resolveSong(songInput);
  if (!def && !songInput?.trim()) {
    // 没点名歌 → 直接即兴
    const title = playSongDef(kind, null, songInput, opts);
    return { title, via: 'improv' };
  }
  if (def) {
    const key = `${kind}:${def.title}`;
    if (key === currentKey && songTimers.length > 0) {
      return { title: def.title, via: def.via ?? 'library' };
    }
    const title = playSongDef(kind, def, songInput, opts);
    return { title, via: def.via ?? 'library' };
  }
  // 点了歌但三层都取不到谱（网络断/模型不认识）→ 即兴兜底
  const title = playSongDef(kind, null, songInput, opts);
  return { title, via: 'improv' };
}

// ---------------- v10 C2 曲目状态事件总线（曲名字幕） ----------------

export interface SongState {
  playing: boolean;
  title?: string;
  kind?: PlayKind;
}

type SongStateCb = (s: SongState) => void;
const songStateSubs = new Set<SongStateCb>();

/** 订阅曲目状态（开始弹/弹完）；返回退订函数 */
export function onSongState(cb: SongStateCb): () => void {
  songStateSubs.add(cb);
  return () => {
    songStateSubs.delete(cb);
  };
}

function emitSongState(s: SongState): void {
  songStateSubs.forEach((cb) => {
    try {
      cb(s);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  });
}
