'use client';

import { scopedConvKey } from './accounts';

/**
 * AI 语音消息（AI 回复按频率用语音发送）+ AI 语音发送频率设置：
 *
 * 一、频率设置（按会话独立，localStorage 持久化；群聊按群保存）：
 *   未设置任何档位时默认 = often 经常——未配置语音 API 也照发语音条（静音展示），用户显式选过「关闭」才不发
 *   off      关闭        —— AI 不发语音，只发文字
 *   always   每条都发语音 —— AI 的每一条消息都是语音
 *   often    经常        —— 文字消息每 3 条出 1 条语音
 *   sometimes 偶尔       —— 文字消息每 7 条出 1 条语音
 *   rarely   不经常      —— 文字消息每 12 条出 1 条语音
 *
 * 计数口径（B6 披露）：只数「可升级语音的纯文本消息」——红包/转账/表情包/图片等卡片与系统行
 * 不计入周期；TTS 清洗后为空的纯动作行（*...*）不判定不消耗计数；合成失败自动回滚计数（周期顺延到下一条）
 *
 * 二、计数规则（每个角色独立计数；每个会话独立计数；每条消息独立判定）：
 *   - 计数器按 counterKey 隔离（单聊 = 会话键；群聊 = 「群会话键#角色 id」，群成员互不影响）；
 *   - 每条 AI 消息落盘前调用 decideAiVoiceMessage 判定一次：n = 本周期已发消息数（语音也算 1 条），
 *     n % N === 0 → 本条发语音且计数器重置为 1（语音本身即新周期第 1 条）；否则文字、n+1。
 *     于是第 1、N+1、2N+1…条是语音：经常=第 1/4/7 条，偶尔=第 1/8/15 条，不经常=第 1/13/25 条；
 *   - 一轮生成多条消息时逐条判定（不能只判第一条）；决策只在消息真正落盘时推进，
 *     流被拒绝/出错没有消息落盘就不消耗计数，因此无需回滚；
 *   - 切换角色/会话天然按 key 分别维护，无需手动重置。
 *
 * 三、语音合成 synthesizeAiVoice（用当前角色的音色）：
 *   - 文本清洗（剥离舞台动作/表情标记等不可朗读内容）后为空 → null（保持文字）；
 *   - 内置引擎 / 未配置语音 API → 静音语音条：不出音频文件、点击由 voice-player 按 contactId
 *     用角色音色实时朗读（Task 33：配置了声音——内置语音恒可用——点击播放即出声），
 *     长按「转文字」仍可看原文；新版内置通道不再产出 synth 标记（synth='builtin' 仅历史存量）；
 *   - MiniMax / OpenAI 兼容 → 调 /api/tts 合成真实音频 → dataURL 存进消息（synth='api'，
 *     重启后仍可播放）；时长读音频元数据，读不到按字数估算；
 *   - 任何失败 → 返回 null，调用方保留文字消息（自动降级为文字，不影响聊天）。
 */

import { hashWaveBars } from './audio-utils';
import { isBuiltinVoiceId, BUILTIN_DEFAULT_FEMALE, BUILTIN_DEFAULT_MALE } from './builtin-voices';
import { cleanTextForTts, expressStyleTtsSpeed, isTtsConfigured, resolveVoiceForContact } from './tts-client';
import { getContact } from './contacts-store';
import { SAFE_VOICE_BY_PROVIDER, useSettings } from './store';

// ---------------- 频率设置 ----------------

export type AiVoiceFreq = 'off' | 'always' | 'often' | 'sometimes' | 'rarely';

export interface AiVoiceFreqOption {
  value: AiVoiceFreq;
  label: string;
  desc: string;
}

export const AI_VOICE_FREQ_OPTIONS: readonly AiVoiceFreqOption[] = [
  { value: 'off', label: '关闭', desc: 'AI 不发语音，只发文字' },
  { value: 'always', label: '每条都发语音', desc: 'AI 的每条消息都用语音发送' },
  { value: 'often', label: '经常', desc: '文字消息每 3 条出 1 条语音' },
  { value: 'sometimes', label: '偶尔', desc: '文字消息每 7 条出 1 条语音' },
  { value: 'rarely', label: '不经常', desc: '文字消息每 12 条出 1 条语音' },
];

/** 非关闭/每条档位对应的频率倍数（每 N 条消息中 1 条语音） */
const FREQ_EVERY: Record<Exclude<AiVoiceFreq, 'off' | 'always'>, number> = {
  often: 3,
  sometimes: 7,
  rarely: 12,
};

const FREQ_STORE_KEY = 'ai-voice-freq';
const COUNTER_STORE_KEY = 'ai-voice-counters';

export function normalizeAiVoiceFreq(v: unknown): AiVoiceFreq {
  return v === 'always' || v === 'often' || v === 'sometimes' || v === 'rarely' || v === 'off' ? v : 'often';
}

function loadFreqMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FREQ_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的 AI 语音频率（未设置时默认『经常』——未配置语音 API 也照发语音条，静音展示；用户显式关闭过才不发；freqKey 按账号作用域） */
export function getAiVoiceFreq(freqKey: string): AiVoiceFreq {
  return normalizeAiVoiceFreq(loadFreqMap()[scopedConvKey(freqKey)]);
}

/** 保存某会话的 AI 语音频率（localStorage 持久化，按 freqKey+账号隔离） */
export function saveAiVoiceFreq(freqKey: string, freq: AiVoiceFreq): void {
  if (typeof window === 'undefined') return;
  const k = scopedConvKey(freqKey);
  const map = loadFreqMap();
  if (freq === 'off') map[k] = 'off'; // 显式关闭也要落盘：与「从未设置」区分（未设置=默认发语音，off=用户明确关闭）
  else map[k] = freq;
  try {
    window.localStorage.setItem(FREQ_STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍生效）
  }
}

/** 频率档位的展示名（入口行摘要用） */
export function aiVoiceFreqLabel(freq: AiVoiceFreq): string {
  return AI_VOICE_FREQ_OPTIONS.find((o) => o.value === freq)?.label ?? '关闭';
}

// ---------------- 计数器（按 counterKey 隔离） ----------------

function loadCounters(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COUNTER_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveCounters(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COUNTER_STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略
  }
}

/**
 * 决定「这一条」AI 消息发文字还是语音（每条消息独立调用一次，副作用：推进计数器）：
 * - 关闭 → 永远文字；
 * - 每条都发 → 永远语音；
 * - 经常/偶尔/不经常（每 N 条消息中 1 条语音）→ n % N === 0 → 本条语音且计数器重置为 1
 *   （语音本身算新周期第 1 条），否则文字且 n+1；第 1、N+1、2N+1… 条是语音。
 */
export function decideAiVoiceMessage(freqKey: string, counterKey: string = freqKey): boolean {
  const freq = getAiVoiceFreq(freqKey);
  if (freq === 'off') return false;
  if (freq === 'always') return true;
  const every = FREQ_EVERY[freq];
  const ck = scopedConvKey(counterKey);
  const map = loadCounters();
  const n = map[ck] ?? 0;
  const speak = n % every === 0;
  map[ck] = speak ? 1 : n + 1;
  saveCounters(map);
  // B6：记录本次命中（供合成失败回滚）；投递串行执行，单变量记住最近一次命中的键与前值足够
  lastVoiceDecision = speak ? { ck, prev: n } : null;
  return speak;
}

/** 最近一次 decideAiVoiceMessage 命中语音的计数器快照（回滚用；投递串行，单槽位足够） */
let lastVoiceDecision: { ck: string; prev: number } | null = null;

/** B6：语音合成失败时回滚上一次计数器推进——否则一次 TTS 故障会把语音周期永久后移
 *  （周期本该出现在第 N+1 条的节奏被打乱且不再回来）。仅在「判定命中 → 合成失败」路径调用 */
export function undoLastAiVoiceDecision(): void {
  if (!lastVoiceDecision) return;
  const map = loadCounters();
  map[lastVoiceDecision.ck] = lastVoiceDecision.prev;
  saveCounters(map);
  lastVoiceDecision = null;
}

// ---------------- AI 语音合成 ----------------

/** AI 语音消息数据（落库时展开进消息的 voice 字段） */
export interface AiVoiceClip {
  /** 音频 dataURL（服务商 TTS）；内置引擎/未配置 API 通道为空串（静音语音条，点击由
   *  voice-player 按 contactId 用角色音色实时朗读，配置了声音即出声） */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，22 根，文本哈希） */
  wave: number[];
  /** 清洗后的朗读原文（静音语音条长按转文字直接用 / 历史存量内置引擎点击朗读用） */
  localText: string;
  /** 'api' = 已存真实音频 dataURL；'builtin' 仅存在于历史存量消息（旧版内置引擎实时朗读），
   *  新消息内置通道不再产出（留空 = 静音语音条，点击只走静音进度动画） */
  synth?: 'builtin' | 'api';
}

/** 仿真朗读时长估算（约 4 字/秒，至少 1 秒）——与文字转语音消息同一公式 */
function estimateDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('音频编码失败'));
    reader.readAsDataURL(blob);
  });
}

/** 读音频元数据拿真实时长；超时/解析失败回退估算值 */
function readAudioDuration(url: string, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(v);
    };
    const timer = window.setTimeout(() => done(fallback), 3000);
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        done(Number.isFinite(d) && d > 0 ? Math.max(1, Math.ceil(d)) : fallback);
      };
      audio.onerror = () => done(fallback);
      audio.src = url;
    } catch {
      done(fallback);
    }
  });
}

/**
 * 解析「当前角色的音色」对应的 API voiceId（AI 语音消息服务商合成用）：
 * 角色独立 voiceId → 全局默认 → 服务商安全默认；角色/全局都没设时按联系人性别给内置默认声线；
 * 服务商 API 不认识内置声线 id（builtin:…）→ 替换为该服务商安全默认音色。
 */
export async function resolveAiVoiceIdForApi(contactId: string | null | undefined): Promise<string> {
  const cfg = useSettings.getState().ttsConfig;
  const rv = await resolveVoiceForContact(contactId ?? null);
  let voiceId = rv.voiceId;
  if (rv.source === 'builtin' && rv.gender) {
    voiceId = rv.gender === 'male' ? BUILTIN_DEFAULT_MALE : BUILTIN_DEFAULT_FEMALE;
  }
  if (cfg.provider !== 'builtin' && isBuiltinVoiceId(voiceId)) {
    voiceId = SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? voiceId;
  }
  return voiceId;
}

/**
 * 把一段 AI 回复文本合成为语音消息数据（用当前角色的音色）：
 * 失败返回 null（调用方保留文字消息，自动降级，不影响聊天）。
 */
export async function synthesizeAiVoice(text: string, contactId: string | null | undefined): Promise<AiVoiceClip | null> {
  const cleaned = cleanTextForTts(text ?? '').slice(0, 400);
  if (!cleaned) return null;
  const cfg = useSettings.getState().ttsConfig;
  const useBuiltinEngine = cfg.provider === 'builtin' || !isTtsConfigured(cfg);
  const wave = hashWaveBars(cleaned, 22);

  // ① 内置引擎 / 未配置语音 API：静音语音条——不出音频文件；点击由 voice-player 走
  //    角色音色实时朗读（speakUserTts：本地引擎可用用本地，哑火自动云端兜底，配了 API 用 API 音色），
  //    长按「转文字」仍可看原文。
  //    synth='builtin' 必带：assistant 等非联系人会话没有 contactId，历史上无标记会被
  //    voice-player 误判为「我方文字转语音」走静音模拟——点击永远无声（用户反馈的
  //    「Web Speech 不能用」场景之一）；带标记后所有 AI 语音条点击都真实出声
  if (useBuiltinEngine) {
    return { url: '', duration: estimateDuration(cleaned), wave, localText: cleaned, synth: 'builtin' };
  }

  // ② 用户语音 API（MiniMax / OpenAI 兼容）：合成真实音频 → dataURL 持久化；
  //  B4 表达风格联动：语速按联系人「表达风格」微调（轻声细语稍慢 / 活泼元气稍快）
  try {
    const voiceId = await resolveAiVoiceIdForApi(contactId ?? null);
    const styleSpeed = contactId
      ? expressStyleTtsSpeed((await getContact(contactId).catch(() => null))?.expressStyle)
      : 1;
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, voiceId, text: cleaned, speed: styleSpeed }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    const url = await blobToDataURL(blob);
    const duration = await readAudioDuration(url, estimateDuration(cleaned));
    return { url, duration, wave, localText: cleaned, synth: 'api' };
  } catch {
    return null;
  }
}
