'use client';

/**
 * 聊天翻译（微信 / QQ / 信息三端共用）：
 *
 * - 每个会话独立保存翻译配置（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey>，
 *   天然按角色/App 隔离），localStorage 单键 JSON map 持久化；配置为「一对语言」（左 ⇄ 右，
 *   两侧都可自由选择），开启后每条文字消息按检测到的语言翻译成另一侧：
 *   左侧是中文、右侧是英语时，中文消息气泡下方显示英文译文，英文消息则显示中文译文；
 * - 语言检测 detectMessageLang：按文字体系（假名/谚文/西里尔/阿拉伯/泰文/汉字简繁/拉丁字母
 *   停用词打分）判断消息属于哪一侧；检测不出时默认按「消息是左侧语言」处理（左侧通常为用户母语）；
 * - 译文缓存：IndexedDB kv 单键（容量上限 FIFO，启动时由 idb-kv 迁移），key = `<语言>|<原文>`（与具体会话无关，
 *   同样的原文+目标语言全局复用），组件内存里另有一份运行时 Map 避免反复读盘；
 * - requestTranslation：带并发闸（最多 3 个同时在途）+ 在途去重（同 key 复用同一 Promise）；
 *   优先走 /api/translate 服务器代理，服务器不可达 / 直连标记 / 内网地址时回退
 *   浏览器直连（directChatStream 兼容非流式 JSON 解析），与聊天链路的兜底策略一致。
 */
import type { ApiConfig } from '@/lib/ios/store';
import { kvGet, kvSet } from './ios/idb-kv';
import { directChatStream, isPrivateApiUrl } from '@/lib/ios/direct-api';

// ---------------- 语言清单 ----------------

export interface TranslateLang {
  /** 语言代码（持久化用） */
  code: string;
  /** 中文名（设置页与译文行前缀显示） */
  label: string;
  /** 原文名 */
  native: string;
}

/** 常用语言（翻译语言页第一组） */
export const COMMON_TRANSLATE_LANGS: readonly TranslateLang[] = [
  { code: 'zh-Hans', label: '中文简体', native: '简体中文' },
  { code: 'en', label: '英语', native: 'English' },
  { code: 'ja', label: '日语', native: '日本語' },
  { code: 'ko', label: '韩语', native: '한국어' },
  { code: 'fr', label: '法语', native: 'Français' },
  { code: 'ru', label: '俄语', native: 'Русский' },
  { code: 'es', label: '西班牙语', native: 'Español' },
  { code: 'ar', label: '阿拉伯语', native: 'العربية' },
  { code: 'de', label: '德语', native: 'Deutsch' },
];

/** 更多语言（翻译语言页第二组） */
export const MORE_TRANSLATE_LANGS: readonly TranslateLang[] = [
  { code: 'zh-Hant', label: '繁体中文', native: '繁體中文' },
  { code: 'it', label: '意大利语', native: 'Italiano' },
  { code: 'pt', label: '葡萄牙语', native: 'Português' },
  { code: 'th', label: '泰语', native: 'ไทย' },
  { code: 'vi', label: '越南语', native: 'Tiếng Việt' },
];

/** 全部可选翻译语言（两侧均可从中任选） */
export const TRANSLATE_LANGS: readonly TranslateLang[] = [...COMMON_TRANSLATE_LANGS, ...MORE_TRANSLATE_LANGS];

const LANG_CODES = new Set(TRANSLATE_LANGS.map((l) => l.code));

/** 语言代码 → 中文名（未知代码原样返回） */
export function translateLangLabel(code: string): string {
  return TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code;
}

// ---------------- 配置持久化（按会话隔离） ----------------

export interface ChatTranslateCfg {
  /** 是否开启翻译 */
  on: boolean;
  /** 左侧语言代码（通常为用户母语；消息是左侧语言时译成右侧） */
  left: string;
  /** 右侧语言代码（消息是右侧语言时译成左侧） */
  right: string;
}

export const DEFAULT_TRANSLATE_CFG: ChatTranslateCfg = { on: false, left: 'zh-Hans', right: 'en' };

const CFG_KEY = 'chat-translate-cfg';

/** 左右两侧兜底：优先英语，左侧已是英语时回退中文简体 */
function fallbackOther(code: string): string {
  return code === 'en' ? 'zh-Hans' : 'en';
}

/** 把任意值收窄为合法配置（非法字段丢弃/回退默认；兼容旧版 { on, langs[] } 多选结构 → 取第一个目标语言） */
export function normalizeTranslateCfg(raw: unknown): ChatTranslateCfg {
  const valid = (v: unknown): string | null => (typeof v === 'string' && LANG_CODES.has(v) ? v : null);
  const def = { ...DEFAULT_TRANSLATE_CFG };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const rec = raw as { on?: unknown; left?: unknown; right?: unknown; langs?: unknown };
  // 旧版多选结构迁移：左=中文简体，右=旧目标语言列表的第一个
  if (rec.left === undefined && rec.right === undefined && Array.isArray(rec.langs)) {
    const first = rec.langs.map(valid).find((c): c is string => c !== null);
    const right = first ?? def.right;
    return { on: rec.on === true, left: def.left, right: right === def.left ? fallbackOther(def.left) : right };
  }
  const left = valid(rec.left) ?? def.left;
  let right = valid(rec.right) ?? def.right;
  if (right === left) right = fallbackOther(left);
  return { on: rec.on === true, left, right };
}

function loadCfgMap(): Record<string, ChatTranslateCfg> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CFG_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ChatTranslateCfg> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const cfg = normalizeTranslateCfg(v);
      const untouched = cfg.left === DEFAULT_TRANSLATE_CFG.left && cfg.right === DEFAULT_TRANSLATE_CFG.right;
      if (cfg.on || !untouched) out[k] = cfg;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的翻译配置（未设置时返回默认关闭） */
export function getTranslateCfg(sessionKey: string): ChatTranslateCfg {
  return normalizeTranslateCfg(loadCfgMap()[sessionKey]);
}

/** 保存某会话的翻译配置（持久化到 localStorage，按 sessionKey 隔离） */
export function saveTranslateCfg(sessionKey: string, cfg: ChatTranslateCfg): void {
  if (typeof window === 'undefined') return;
  const map = loadCfgMap();
  const next = normalizeTranslateCfg(cfg);
  const untouched = !next.on && next.left === DEFAULT_TRANSLATE_CFG.left && next.right === DEFAULT_TRANSLATE_CFG.right;
  if (untouched) delete map[sessionKey];
  else map[sessionKey] = next;
  try {
    window.localStorage.setItem(CFG_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

// ---------------- 消息语言检测（双向翻译的方向判断） ----------------

/** 仅繁体使用的汉字抽样（简体文本不会出现）：命中即判为繁体中文 */
const TRADITIONAL_ONLY_RE =
  /[們個來對時說話學會體國門東車馬鳥語書長開關問間陽雲電氣飛萬與專業務動區醫廠歷聽寫讀賣買錢銀園圍圖遠運這讓認識誰隨難頭餓無發愛覺親兒兩頁風樂點還計網路機碼]/;

/** 拉丁字母语言的停用词打分表（同属拉丁字母的语言之间粗分方向用） */
const LATIN_STOPWORDS: ReadonlyArray<readonly [string, string[]]> = [
  ['en', ['the', 'and', "i'm", "don't", "it's", 'you', 'is', 'are', 'what', 'this', 'that', 'not', 'have', 'just', 'like', 'okay', 'hey', 'hello', 'yeah', 'sorry', 'please', 'thanks']],
  ['fr', ['je', 'tu', 'il', 'elle', 'nous', 'vous', 'et', 'pas', 'les', 'une', 'des', 'oui', 'ça', "c'est", 'bonjour', 'merci', 'pourquoi', 'quoi', 'avec', 'être']],
  ['de', ['ich', 'du', 'nicht', 'ist', 'und', 'das', 'die', 'der', 'ein', 'eine', 'hallo', 'danke', 'warum', 'nicht', 'auch', 'aber', 'gut']],
  ['es', ['los', 'las', 'una', 'que', 'yo', 'tú', 'hola', 'gracias', 'por', 'qué', 'cómo', 'sí', 'pero', 'muy', 'está', 'bueno', 'día']],
  ['it', ['gli', 'che', 'non', 'sono', 'ciao', 'grazie', 'perché', 'come', 'molto', 'ma', 'anche', 'per', 'sono', 'buongiorno', 'cosa']],
  ['pt', ['os', 'as', 'um', 'uma', 'não', 'você', 'olá', 'obrigado', 'porque', 'como', 'muito', 'mas', 'para', 'tudo', 'bom', 'oi']],
];

/**
 * 检测一段文本的语言（返回 TRANSLATE_LANGS 中的代码；检测不出返回空串）：
 * 优先按文字体系判断（假名→日语、谚文→韩语、西里尔→俄语、阿拉伯字母→阿拉伯语、泰文→泰语、
 * 越南语声调字母、汉字→简/繁），拉丁字母之间按停用词与特征字母打分。
 */
export function detectMessageLang(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/[\u3040-\u30FF]/.test(t)) return 'ja'; // 平假名/片假名
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(t)) return 'ko'; // 谚文
  if (/[\u0400-\u04FF]/.test(t)) return 'ru'; // 西里尔字母
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) return 'ar'; // 阿拉伯字母
  if (/[\u0E00-\u0E7F]/.test(t)) return 'th'; // 泰文
  if (/[ăâđêôơư]|[ằắẳẵặầấẩẫậềếểễệờớởỡợừứửữự]/i.test(t) && /[A-Za-z]/.test(t)) return 'vi'; // 越南语声调字母
  if (/[\u4E00-\u9FFF]/.test(t)) return TRADITIONAL_ONLY_RE.test(t) ? 'zh-Hant' : 'zh-Hans'; // 汉字（简/繁）
  // 拉丁字母：停用词打分 + 特征字母加权
  const padded = ` ${t.toLowerCase()} `;
  const countWord = (w: string): number => {
    const pat = ` ${w}`;
    let i = 0;
    let n = 0;
    while ((i = padded.indexOf(pat, i)) !== -1) {
      n += 1;
      i += pat.length;
    }
    return n;
  };
  const scores: Record<string, number> = {};
  for (const [code, words] of LATIN_STOPWORDS) scores[code] = words.reduce((n, w) => n + countWord(w), 0);
  const bonus = (re: RegExp): number => (t.match(re) ?? []).length;
  scores.fr += bonus(/[éèêàçùûôîï]/g);
  scores.de += bonus(/[äöüß]/g) * 1.5;
  scores.es += bonus(/[ñ¿¡]/g) * 2;
  scores.pt += bonus(/[ãõ]/g) * 2;
  scores.it += bonus(/[àèìòù]/g) * 0.5;
  let best = '';
  let bestScore = 0;
  for (const [code, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : '';
}

/**
 * 计算一条消息的翻译目标语言（双向翻译的方向判断）：
 * - 消息语言 = 左侧 → 译成右侧；消息语言 = 右侧 → 译成左侧（「中文翻译成英文，也可以英文翻译成中文」）；
 * - 检测不出或两侧都不是（如第三种语言）：默认译成左侧（左侧通常为用户母语，看译文更有用）。
 */
export function detectTranslateTarget(text: string, left: string, right: string): string {
  const det = detectMessageLang(text);
  if (!det) return left;
  if (det === left) return right;
  if (det === right) return left;
  return left;
}

// ---------------- 译文缓存 ----------------

const CACHE_KEY = 'chat-translate-cache';
const CACHE_MAX = 300;

const memCache = new Map<string, string>();
let cacheLoaded = false;

function ensureCache(): void {
  if (cacheLoaded || typeof window === 'undefined') return;
  cacheLoaded = true;
  try {
    const parsed: unknown = kvGet<unknown>(CACHE_KEY);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
        memCache.set(item[0], item[1]);
      }
    }
  } catch {
    // 缓存损坏：忽略（内存缓存仍然有效）
  }
}

function persistCache(): void {
  if (typeof window === 'undefined') return;
  // FIFO 淘汰最旧的
  while (memCache.size > CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
  try {
    kvSet(CACHE_KEY, [...memCache.entries()]);
  } catch {
    // 持久化失败忽略（内存缓存仍然有效）
  }
}

function cacheKey(lang: string, text: string): string {
  return `${lang}|${text}`;
}

// ---------------- 翻译请求（并发闸 + 在途去重） ----------------

const MAX_ACTIVE = 3;
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

/** 翻译 system 提示（三端共用）：只输出译文，保留语气与表情 */
function buildTranslateMessages(text: string, langLabel: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        `你是一个翻译引擎。把用户发来的内容准确、自然地翻译成${langLabel}。` +
        `只输出译文本身：不要解释、不要加引号、不要输出原文或任何多余内容；` +
        `保留原文的语气、标点和表情符号；如果内容本身已经是${langLabel}，原样输出。`,
    },
    { role: 'user', content: text },
  ];
}

/** 服务器代理翻译：POST /api/translate（非流式，返回 { translation }）。
 *  错误带上服务端标记（directOnly / rateLimited）供调用方分支处理。 */
async function translateViaServer(apiConfig: ApiConfig, text: string, langLabel: string): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: langLabel, config: apiConfig }),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 忽略解析失败
  }
  const rec = (data && typeof data === 'object' ? data : {}) as { translation?: unknown; error?: unknown; directOnly?: unknown; rateLimited?: unknown };
  if (res.ok && typeof rec.translation === 'string' && rec.translation.trim()) {
    return rec.translation.trim();
  }
  const detail = typeof rec.error === 'string' ? rec.error : `请求失败（${res.status}）`;
  const err = new Error(detail) as Error & { directOnly?: boolean; rateLimited?: boolean };
  err.directOnly = rec.directOnly === true;
  err.rateLimited = rec.rateLimited === true;
  throw err;
}

/** 内置模型兜底翻译：POST /api/translate { forceSdk: true }（代理 + 直连都失败后的最终手段）。
 *  服务端限流失败时返回 rateLimited 标记（高优会话锁重试 ~2 分钟后仍 429）——
 *  调用方据此自动再试一轮，而不是直接报「翻译失败」。 */
async function translateViaSdk(text: string, langLabel: string): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: langLabel, forceSdk: true }),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 忽略解析失败
  }
  const rec = (data && typeof data === 'object' ? data : {}) as { translation?: unknown; error?: unknown; rateLimited?: unknown };
  if (res.ok && typeof rec.translation === 'string' && rec.translation.trim()) {
    return rec.translation.trim();
  }
  const detail = typeof rec.error === 'string' ? rec.error : `请求失败（${res.status}）`;
  const err = new Error(detail) as Error & { rateLimited?: boolean };
  err.rateLimited = rec.rateLimited === true;
  throw err;
}

/** 是否「从未配置」上游（与服务端 extractConfig 同口径：默认 OpenAI 地址 + 空 Key）。
 *  未配置时跳过代理轮次直走内置模型——否则服务端会先跑一整轮 ~2 分钟的
 *  限流重试再报「未配置」，客户端再 forceSdk 又跑一轮，同一翻译白白双倍等待。 */
function isUnconfiguredApi(cfg: ApiConfig): boolean {
  if (!cfg?.baseUrl) return true;
  if (cfg.apiKey) return false;
  try {
    return /(^|\.)api\.openai\.com$/i.test(new URL(cfg.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** 译文是否是未解析的原始 SSE / 流式分块（用户反馈：点翻译满屏 data: {"id":...}）。
 *  真实译文不会出现以 data: 开头的行、[DONE] 标记或 chatcmpl 分块特征——
 *  这类结果一律视为失败（reject），绝不渲染到 UI。 */
function looksLikeRawStream(text: string): boolean {
  return /^\s*data:/m.test(text) || text.includes('[DONE]') || /"id"\s*:\s*"chatcmpl-/.test(text);
}

async function runTranslate(apiConfig: ApiConfig, text: string, langLabel: string): Promise<string> {
  // 未配置上游：直走服务端内置模型（省掉必失败的代理轮次——那会先白跑一整轮限流重试）
  if (!isUnconfiguredApi(apiConfig)) {
    try {
      const out = await translateViaServer(apiConfig, text, langLabel);
      const trimmed = out.trim();
      if (trimmed && !looksLikeRawStream(trimmed)) return trimmed;
      // 命中原始流特征：视为失败，继续兜底（不带脏数据进 UI）
      if (trimmed) throw new Error('上游返回了未解析的流式数据');
    } catch (err) {
      const directOnly = err instanceof Error && (err as Error & { directOnly?: boolean }).directOnly === true;
      // 内网地址 / 服务器建议直连：浏览器直连兜底（directChatStream 兼容非流式 JSON 解析）
      if (directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
        try {
          const out = await directChatStream(apiConfig, buildTranslateMessages(text, langLabel), () => undefined);
          const trimmed = out.trim();
          if (trimmed && !looksLikeRawStream(trimmed)) return trimmed;
          // 直连成功但结果是原始流：不带脏数据，落到内置模型兜底
        } catch {
          // 直连也失败：落到内置模型兜底
        }
      }
      // 代理/直连都失败或返回脏数据：落到内置模型兜底
    }
  }
  // 最终兜底：服务端内置模型（用户上游 403/401/不可达时翻译体验不中断）
  const out = await translateViaSdk(text, langLabel);
  const trimmed = out.trim();
  if (trimmed && !looksLikeRawStream(trimmed)) return trimmed;
  throw new Error('翻译失败：返回了无法解析的流式数据');
}

const inflight = new Map<string, Promise<string>>();

/** 失败冷却：同一 key 失败后短时间内不再重试（避免上游不可用时反复轰炸）。
 *  60s 太长——用户点「翻译」重试时会被这个窗口直接拒绝，体验成「一直翻译失败」；
 *  缩到 8s：点重试基本立刻放行，由服务端串行队列 + 退避兜底防轰炸。 */
const FAILED_TTL = 8_000;
const failedAt = new Map<string, number>();

/**
 * 请求一条译文（带缓存 / 并发闸 / 在途去重；失败会 reject，由调用方决定兜底展示）。
 * lang 用语言代码（TRANSLATE_LANGS 的 code），内部换算中文名进提示词。
 */
export function requestTranslation(opts: { text: string; lang: string; apiConfig: ApiConfig }): Promise<string> {
  const text = opts.text.trim();
  const key = cacheKey(opts.lang, text);
  ensureCache();
  const cached = memCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < FAILED_TTL) {
    return Promise.reject(new Error('翻译刚才失败过，冷却中'));
  }
  const existing = inflight.get(key);
  if (existing) return existing;
  const langLabel = translateLangLabel(opts.lang);
  const p = withSlot(() => runTranslate(opts.apiConfig, text, langLabel))
    .then((t) => {
      memCache.set(key, t);
      persistCache();
      failedAt.delete(key);
      return t;
    })
    .catch((err) => {
      failedAt.set(key, Date.now());
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
