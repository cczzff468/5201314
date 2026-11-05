import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * AI 点歌记谱（拾光小屋乐器升级）：
 *
 * 用户对 AI 说「弹一首《晴天》」→ 前端经典曲库（ai-song.ts）没命中时调本接口，
 * 服务端让模型把这首歌【主旋律】记成 C3–C6 玩具钢琴可演奏的音名序列：
 * - 前端只传曲名（+ 可选用户上游配置，与 /api/character-status 同策略）；
 * - 返回 { ok, song: { title, tempoMs, notes:[{name,beats}] }, via }；
 * - 音名/拍数/速度服务端全量校验清洗（非法音符丢弃、拍数钳制、长度封顶），
 *   模型不认识这首歌时返回 { ok:false, error:'unknown' }（前端回落即兴）；
 * - 前端拿到谱子后写入 IndexedDB 缓存（settings 库），下次点同款秒出。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

/** 单音：音名（白键 C3…C6 / 黑键 C#4 等）+ 拍数 */
interface SongNoteOut {
  name: string;
  beats: number;
}

/** 记谱结果（前端 ai-song.ts SongDef 同形） */
interface SongOut {
  title: string;
  tempoMs: number;
  notes: SongNoteOut[];
}

/** 合法音名全集（与前端 instrument.ts 的 PIANO_WHITE/PIANO_BLACK 同源硬编码） */
const VALID_NOTES = new Set([
  'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6',
  'C#3', 'D#3', 'F#3', 'G#3', 'A#3',
  'C#4', 'D#4', 'F#4', 'G#4', 'A#4',
  'C#5', 'D#5', 'F#5', 'G#5', 'A#5',
]);

/** 黑键等价写法归一（模型可能写 Db4 / E♭5 之类） */
const FLAT_ALIASES: Record<string, string> = {
  Db3: 'C#3', Eb3: 'D#3', Gb3: 'F#3', Ab3: 'G#3', Bb3: 'A#3',
  Db4: 'C#4', Eb4: 'D#4', Gb4: 'F#4', Ab4: 'G#4', Bb4: 'A#4',
  Db5: 'C#5', Eb5: 'D#5', Gb5: 'F#5', Ab5: 'G#5', Bb5: 'A#5',
  'D♭4': 'C#4', 'E♭4': 'D#4', 'G♭4': 'F#4', 'A♭4': 'G#4', 'B♭4': 'A#4',
  'D♭5': 'C#5', 'E♭5': 'D#5', 'G♭5': 'F#5', 'A♭5': 'G#5', 'B♭5': 'A#5',
};

/** 模型输出 → 安全谱面：非法音符丢弃、拍数钳 0.25~4、总量封顶 96、速度钳 250~600 */
function sanitizeSong(raw: unknown, fallbackTitle: string): SongOut | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { title?: unknown; tempoMs?: unknown; notes?: unknown };
  const notesIn = Array.isArray(r.notes) ? r.notes : [];
  const notes: SongNoteOut[] = [];
  for (const n of notesIn) {
    if (!n || typeof n !== 'object') continue;
    const rec = n as { name?: unknown; beats?: unknown };
    let name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) continue;
    name = name.replace('♯', '#');
    if (FLAT_ALIASES[name]) name = FLAT_ALIASES[name];
    if (!VALID_NOTES.has(name)) continue;
    let beats = typeof rec.beats === 'number' && Number.isFinite(rec.beats) ? rec.beats : 1;
    beats = Math.min(4, Math.max(0.25, Math.round(beats * 4) / 4));
    notes.push({ name, beats });
    if (notes.length >= 96) break;
  }
  // 太短不成曲（比如模型只回了几个音）→ 视为失败
  if (notes.length < 8) return null;
  let tempoMs = typeof r.tempoMs === 'number' && Number.isFinite(r.tempoMs) ? r.tempoMs : 380;
  tempoMs = Math.min(600, Math.max(250, Math.round(tempoMs)));
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 24) : fallbackTitle.slice(0, 24);
  return { title, tempoMs, notes };
}

const SYSTEM_PROMPT = [
  '你是一位资深音乐记谱师，为一台只有 C3 到 C6 键（37 键，含黑键）的小钢琴写自动演奏谱。',
  '用户给出歌名，你写出这首歌【最有辨识度的主旋律】的单音谱（只写旋律，不写伴奏/和弦）。',
  '输出要求（必须严格遵守，只输出一个 JSON，不要任何多余文字）：',
  '{"title":"歌名","tempoMs":380,"notes":[{"name":"C4","beats":1},{"name":"D4","beats":0.5},...]}',
  '规则：',
  '1. name 用音名：白键 C3 D3 E3 F3 G3 A3 B3 C4 … C6；黑键用 #（C#3 F#4 G#5 等）；所有音必须在 C3–C6 范围内；',
  '2. beats 是拍数（1 = 四分音符），允许 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4；附点节奏用 0.75+0.25 或 1.5；',
  '3. tempoMs = 四分音符毫秒数（快歌 280–340，中速 350–430，抒情慢歌 440–560）；',
  '4. notes 共 16–64 个音，覆盖这首歌最出名的一段（副歌或主题乐句），听完要能认出是这首歌；',
  '5. 旋律忠实原曲（可移调到顺手音域）；个别音不确定时按你最熟悉的版本写，别整段乱编；',
  '6. 结尾落在 2–4 拍长音上，最后一个音尽量是主音 C；',
  '7. 如果你完全不知道这首歌（可能是生造/自创名字），只输出 {"error":"unknown"}。',
].join('\n');

// ---------------- B2 服务端记谱缓存（内存 LRU，200 首） ----------------
// 同一首歌换角色 / 清前端缓存 / 多设备不再重复烧 LLM 记谱调用（限流期尤其重要）。
// 模块级 Map：Node 进程存活期间跨角色、跨会话命中；插入序即 LRU 序。

const songCache = new Map<string, SongOut>();
const SONG_CACHE_MAX = 200;

/** 曲名归一缓存键（去空白/书名号/引号 + 小写，与前端 normKey 同策略） */
function normTitle(t: string): string {
  return t.replace(/\s|《|》|["'「」]/g, '').toLowerCase();
}

/** LRU 读：命中则移到队尾（最近使用） */
function songCacheGet(key: string): SongOut | null {
  const v = songCache.get(key);
  if (!v) return null;
  songCache.delete(key);
  songCache.set(key, v);
  return v;
}

/** LRU 写：超上限丢队首（最久未用） */
function songCachePut(key: string, v: SongOut): void {
  songCache.delete(key);
  songCache.set(key, v);
  if (songCache.size > SONG_CACHE_MAX) {
    const oldest = songCache.keys().next().value;
    if (oldest !== undefined) songCache.delete(oldest);
  }
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 40) : '';
  if (!title) return NextResponse.json({ ok: false, error: 'bad-title' }, { status: 400 });

  // B2：先查服务端缓存（跨角色/跨会话命中，秒回不烧调用）
  const cacheKey = normTitle(title);
  const cached = songCacheGet(cacheKey);
  if (cached) return NextResponse.json({ ok: true, song: cached, via: 'cache' });

  const cfg = extractUpstreamConfig(body.config);
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: `歌名：《${title}》。请记谱。` },
  ];
  try {
    // A3 修复：仅限流（429/频率超限）先退避 1.5s 重试一次——限流窗口内立即重打必然又败，
    // 还会加剧限流（聊天+决策+记谱互相踩）；其它错误直接失败，前端回落即兴
    let text = '';
    let via = 'upstream';
    try {
      ({ text, via } = await completeWithFallback(cfg, messages));
    } catch (first) {
      const msg = first instanceof Error ? first.message : String(first);
      if (!/429|频率|限流|rate ?limit|too many/i.test(msg)) throw first;
      await new Promise((r) => setTimeout(r, 1500));
      ({ text, via } = await completeWithFallback(cfg, messages));
    }
    const parsed = parseLooseJSON<Record<string, unknown>>(text);
    if (!parsed || parsed.error === 'unknown' || parsed.error) {
      return NextResponse.json({ ok: false, error: 'unknown' });
    }
    const song = sanitizeSong(parsed, title);
    if (!song) return NextResponse.json({ ok: false, error: 'bad-melody' });
    songCachePut(cacheKey, song); // B2：成功记谱入缓存
    return NextResponse.json({ ok: true, song, via });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '记谱失败';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
