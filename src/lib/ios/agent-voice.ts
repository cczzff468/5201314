'use client';

/**
 * C1 语音唤起智能体——逻辑层（悬浮球组件保持薄，UI 之外的全部在这里）：
 *
 * - 配置存储：localStorage 单键 agent-voice-wake-v1 { name, ball, listen }
 *   + zustand 镜像（设置页 / 悬浮球共享同一份，改动即时生效）
 * - 识别链路（recognizeAgentBlob）：离线 SenseVoice（APK 首选，端侧 WASM）→
 *   Web Speech 实时识别文本（离线引擎未就绪且浏览器支持时，录音期间并行起）→
 *   transcribeAudioBlob（已配置 OpenAI 兼容 STT 时服务端兜底）；
 *   全部不可用抛中文引导（面板提供打字输入框兜底，永远存在）
 * - 录音器（useAgentRecorder）：MediaRecorder + AnalyserNode 实时振幅 +
 *   静默自动停止（持续 1.4s 无声）+ 30s 上限 + 0.7s 下限，仿 voice-input 的已验证链路
 * - 连续唤醒监听（useAgentWakeLoop）三通道（v1.8 通道顺序重排，大陆网络秒起听）：
 *   ① 离线（APK 已下载模型时首选）每轮录 3.2s → 端侧转写 → 匹配唤醒名；
 *   ② VAD 说话检测 + 服务端识别 /api/wake-asr（不依赖 Google，安静环境零请求、说一句才发
 *      一次；APK 原生壳先请求系统麦克风权限；服务端连续多次不可达才降级③）；
 *   ③ Web Speech 实时监听（免下载模型，但 Chrome 语音服务走 Google，大陆不可达，只作兜底）。
 *   命中即震动 + 回调（去掉唤醒名后剩余 ≥4 字直接作任务文本，否则让用户继续说）；
 *   页面隐藏 / Agent 任务运行 / 通话 / TTS·语音播放 / 面板打开 时自动暂停，
 *   恢复空闲后续听；麦克风连续失败熔断并记录原因（悬浮球红点 + 设置页文案双重提示）
 * - C4 任务终态播报（speakAgentResult）：任务结束后按开关/语音来源 + 闸门（canAgentVoiceActNow）
 *   用共享 TTS 栈（tts-client）朗读结果摘要；语音来源标记（markAgentTaskVoiceOrigin）由
 *   悬浮球在任务真正跑起来时置位、终态播报钩子消费
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { pickRecorderMime } from './audio-utils';
import { blobTo16kMono, isOfflineAsrReady, offlineAsrTranscribe } from './offline-asr';
import { isWebSpeechSupported, startWebSpeechSession, type WebSpeechSession } from './web-speech';
import { isSttReady, transcribeAudioBlob } from './stt-client';
import { isSpeaking, isTtsConfigured, speakUserTts, stopSpeaking } from './tts-client';
import { useVoicePlayback } from './voice-player';
import { isNativePerception, requestMicPermission } from './native-perception';
import { useIncomingCall } from './incoming-call';
import { useUI } from './store';

// ============================================================
// A1. 配置存储（localStorage 单键 + zustand 镜像）
// ============================================================

const STORE_KEY = 'agent-voice-wake-v1';

/** 默认唤醒名（可在设置里改，≤6 字） */
export const DEFAULT_WAKE_NAME = '小灵';

export interface AgentVoiceCfg {
  /** 唤醒名（喊出即唤起，忽略大小写/空格/标点） */
  name: string;
  /** 悬浮球开关（默认开） */
  ball: boolean;
  /** 连续唤醒监听（v1.7.2 默认开：喊唤醒名自动唤起；耗电较高，可在设置关） */
  listen: boolean;
  /** 任务完成后 TTS 播报结果摘要（C4，默认关；语音唤起启动的任务不受此限，始终播报） */
  announce: boolean;
  /** 任务后追问窗口（C4，默认开）：语音任务结束后面板保持展开 10s，可直接追问免喊唤醒名 */
  followup: boolean;
  /** 助手音色（v1.8）：TA 说话用的声音（设置 › 语音智能体可选内置声线/我的音色）。
   *  空 = 跟随「语音 API」里的全局默认音色。 */
  voice: string;
}

const DEFAULT_CFG: AgentVoiceCfg = {
  name: DEFAULT_WAKE_NAME,
  ball: true,
  // v1.7.2 默认开：喊唤醒名自动唤起语音界面（离线识别引擎就绪才会真正跑，浏览器/未就绪自动空转）
  listen: true,
  announce: false,
  followup: true,
  voice: '',
};

/** v1.7.2 一次性迁移键：老版本把 listen=false 写进了存储，迁移一次翻成默认开（之后用户可再关） */
const WAKE_LISTEN_MIGRATION_KEY = 'agent-voice-wake-listen-v2';

function readCfg(): AgentVoiceCfg {
  if (typeof window === 'undefined') return { ...DEFAULT_CFG };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_CFG };
    const p = JSON.parse(raw) as Partial<AgentVoiceCfg>;
    let migrated = false;
    if (!window.localStorage.getItem(WAKE_LISTEN_MIGRATION_KEY)) {
      p.listen = true; // 老配置翻新：喊名字默认唤起（设置页仍可手动关）
      migrated = true;
    }
    const name = (typeof p.name === 'string' ? p.name.trim().slice(0, 6) : '') || DEFAULT_WAKE_NAME;
    const cfg: AgentVoiceCfg = {
      name,
      ball: p.ball !== false,
      listen: p.listen === true,
      announce: p.announce === true,
      followup: p.followup !== false,
      voice: typeof p.voice === 'string' ? p.voice.trim() : '',
    };
    if (migrated) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
        window.localStorage.setItem(WAKE_LISTEN_MIGRATION_KEY, '1');
      } catch {
        /* 存储不可用仅本次会话生效 */
      }
    }
    return cfg;
  } catch {
    return { ...DEFAULT_CFG };
  }
}

interface AgentVoiceStore {
  cfg: AgentVoiceCfg;
  /** 连续唤醒熔断原因（麦克风不可用等）；null = 正常 */
  wakeBlocked: string | null;
}

/** 悬浮球/设置页共享的配置 store（懒初始化：两端都是交互后挂载的纯客户端组件） */
export const useAgentVoice = create<AgentVoiceStore>(() => ({ cfg: readCfg(), wakeBlocked: null }));

/** 现场读配置（非 React 上下文用） */
export function getAgentVoiceCfg(): AgentVoiceCfg {
  return useAgentVoice.getState().cfg;
}

/** 更新配置（localStorage + store 同步写；任意开关改动立即生效并清除熔断态） */
export function updateAgentVoiceCfg(patch: Partial<AgentVoiceCfg>): AgentVoiceCfg {
  const next = { ...useAgentVoice.getState().cfg, ...patch };
  next.name = next.name.trim().slice(0, 6) || DEFAULT_WAKE_NAME;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式等写入失败静默 */
  }
  useAgentVoice.setState({ cfg: next, wakeBlocked: null });
  return next;
}

// ============================================================
// A2. 唤醒名匹配 + 震动
// ============================================================

/** 匹配前清洗：忽略大小写/空格/常见中英文标点（ASR 输出形态多变，只按字面音节匹配） */
const WAKE_STRIP_RE = /[\s,，.。!！?？、;；:：'’‘"“”~·…\-_*#（）()[\]【】]/g;

function cleanForWake(s: string): string {
  return s.toLowerCase().replace(WAKE_STRIP_RE, '');
}

/**
 * 唤醒名匹配（字面）：转写包含唤醒名即命中（忽略大小写/空格/标点）。
 * 命中 → 返回去掉唤醒名后的剩余文本（空串 = 只喊了名字；≥4 字可作一句话任务）；
 * 未命中 → 返回 null。
 */
export function matchWakeName(transcript: string, wakeName: string): string | null {
  const name = cleanForWake(wakeName);
  const hay = cleanForWake(transcript);
  if (!name || !hay) return null;
  const idx = hay.indexOf(name);
  if (idx < 0) return null;
  return (hay.slice(0, idx) + hay.slice(idx + name.length)).trim();
}

// ---------------- 同音容错匹配（拼音级）：ASR 常把唤醒名转成同音别字（小灵→小玲/小凌） ----------------

type PinyinModule = typeof import('pinyin-pro');
let pinyinMod: PinyinModule | null = null;
let pinyinModPromise: Promise<PinyinModule> | null = null;

/** 惰性加载 pinyin-pro（只在唤醒匹配首次进入拼音分支时加载，不进首屏包体） */
async function loadPinyin(): Promise<PinyinModule> {
  if (!pinyinMod) {
    pinyinModPromise ??= import('pinyin-pro').then((m) => {
      pinyinMod = m;
      return m;
    });
    await pinyinModPromise;
  }
  return pinyinMod;
}

/** 唤醒名拼音 key 缓存（按清洗后名字缓存；改名/首次各算一次） */
const wakeKeyCache = new Map<string, string>();

/** 单字/短句 → 无音调拼音串（小写；英文数字原样），失败回退原文 */
async function toPinyinKey(s: string): Promise<string> {
  try {
    const { pinyin } = await loadPinyin();
    const py = pinyin(s, { toneType: 'none', type: 'string', separator: '' }).toLowerCase();
    return py.replace(/[^a-z0-9]/g, '') || s.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * 唤醒名匹配（智能版，三通道统一入口）：
 * ① 字面包含（快路径，已有行为）；② 拼音同音滑窗（慢路径）：对转写中与唤醒名等长的片段
 * 逐段比较无音调拼音，同音即命中（如「小玲/小凌打开微信」≈「小灵打开微信」）；
 * 命中同样返回去掉该片段后的剩余文本；两路都未命中返回 null。
 */
export async function matchWakeNameSmart(transcript: string, wakeName: string): Promise<string | null> {
  const literal = matchWakeName(transcript, wakeName);
  if (literal !== null) return literal;
  const name = cleanForWake(wakeName);
  const hay = cleanForWake(transcript);
  if (!name || !hay || hay.length < name.length) return null;
  let nameKey = wakeKeyCache.get(name);
  if (!nameKey) {
    nameKey = await toPinyinKey(name);
    wakeKeyCache.set(name, nameKey);
    if (wakeKeyCache.size > 8) wakeKeyCache.delete(wakeKeyCache.keys().next().value as string);
  }
  if (!nameKey) return null;
  // 滑窗：片段长度=名字长度（±1 容错多字/漏字），逐段拼音比较；超长转写只扫尾部 80 字
  // （唤醒词几乎不会在更早位置仍未命中），控制 O(n²) 拼音调用在几十毫秒内
  const WIN = 80;
  const scanFrom = hay.length > WIN ? hay.length - WIN : 0;
  for (let take = name.length; take <= Math.min(name.length + 1, hay.length); take++) {
    for (let i = scanFrom; i + take <= hay.length; i++) {
      const segKey = await toPinyinKey(hay.slice(i, i + take));
      if (segKey && segKey === nameKey) {
        return (hay.slice(0, i) + hay.slice(i + take)).trim();
      }
    }
  }
  return null;
}

/** 震动反馈（防御式：WebView/浏览器不支持时静默） */
export function vibrateSafely(pattern: number | number[]): void {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }) : null;
    if (nav && typeof nav.vibrate === 'function') nav.vibrate(pattern);
  } catch {
    /* 不支持震动静默 */
  }
}

// ============================================================
// A3. 识别链路（offline → Web Speech 实时文本 → 云端 STT）
// ============================================================

export type AgentAsrVia = 'offline' | 'webspeech' | 'cloud';

/** 识别链路全部不可用时的中文引导（面板同时提供打字输入框兜底） */
export const ASR_GUIDE_TEXT = '语音识别不可用：请到设置 › 语音 API 配置，或直接打字';

/**
 * 一段录音 → 任务文本。优先级：
 * ① 离线 SenseVoice（APK 首选，端侧推理断网可用）；
 * ② Web Speech 实时识别文本（录音期间浏览器内置识别的累计结果，离线引擎未就绪时才有）；
 * ③ transcribeAudioBlob（配置了 OpenAI 兼容 STT 时服务端兜底）。
 * 全部不可用 → 抛 Error（中文文案）：链路全缺给引导，链路在但没听清给重试提示。
 */
export async function recognizeAgentBlob(blob: Blob, liveText = ''): Promise<{ text: string; via: AgentAsrVia }> {
  const live = liveText.trim();
  if (isOfflineAsrReady()) {
    try {
      const t = await offlineAsrTranscribe(blob);
      if (t) return { text: t, via: 'offline' };
    } catch {
      /* 端侧失败（初始化中/解码异常/超时）：静默降级下一链路 */
    }
  }
  if (live) return { text: live, via: 'webspeech' };
  if (isSttReady()) {
    try {
      const t = await transcribeAudioBlob(blob);
      if (t) return { text: t, via: 'cloud' };
    } catch {
      /* 云端失败：走统一错误文案 */
    }
  }
  if (!isOfflineAsrReady() && !live && !isSttReady()) throw new Error(ASR_GUIDE_TEXT);
  throw new Error('没有听清，请再说一遍或直接打字');
}

// ============================================================
// A4. 录音基建（MediaRecorder + 振幅采样 + Blob 组装，仿 voice-input）
// ============================================================

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Safari 录音实际是 audio/mp4，MIME 探测失败时按浏览器分支兜底（voice-input #43 同款） */
function fallbackMime(): string {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || (/AppleWebKit/i.test(ua) && !/Chrome/i.test(ua));
  return isSafari ? 'audio/mp4' : 'audio/webm';
}

function buildBlob(chunks: Blob[], mime: string): Blob {
  return new Blob(chunks, { type: mime.includes('audio') ? mime : fallbackMime() });
}

export type AgentRecPhase = 'idle' | 'starting' | 'recording' | 'recognizing';

export interface AgentRecResult {
  ok: true;
  text: string;
  via: AgentAsrVia;
}
export interface AgentRecError {
  ok: false;
  error: string;
}

export interface AgentRecHandle {
  phase: AgentRecPhase;
  /** 已录秒数（100ms 刷新） */
  seconds: number;
  /** 实时振幅（0~1，约每 100ms 一个） */
  levels: number[];
  /** Web Speech 实时增量文本（离线引擎未就绪且浏览器支持时才有） */
  partial: string;
  start: () => void;
  /** 手动停止 → 收尾识别 */
  stop: () => void;
  /** 直接丢弃（关面板/执行时） */
  cancel: () => void;
}

/** 面板录音上限（秒） */
const REC_MAX_SEC = 30;
/** 静默自动停止（持续无声毫秒数，需求 1.2-1.5s 取 1.4s） */
const REC_SILENCE_MS = 1400;
/** 有效录音下限（秒）：更短视为没说到内容 */
const REC_MIN_SEC = 0.7;
/** 静默判定 RMS 阈值（原始 0~1 振幅；低于视为无声） */
const REC_SILENCE_RMS = 0.018;

/**
 * 面板录音器：MediaRecorder 录音（MIME 能力探测 + 24kbps opus）+ AnalyserNode 实时振幅，
 * 静默 1.4s 自动停止（已录 >1s 才判定），30s 上限自动结束，0.7s 以下视为无效；
 * 离线引擎未就绪且浏览器支持时并行跑 Web Speech（实时增量文本展示 + 转写兜底）。
 * 结果统一走 onResult（null = 太短没内容；ok:false = 识别链路报错，文案已中文）。
 */
export function useAgentRecorder(opts: {
  onResult: (r: AgentRecResult | AgentRecError | null) => void;
  onStartError: (msg: string) => void;
}): AgentRecHandle {
  const [phase, setPhase] = useState<AgentRecPhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [partial, setPartial] = useState('');

  const optsRef = useRef(opts);
  // 回调经 ref 透传（避免 handle 随 onResult 身份变化重建，面板 effect 依赖稳定）
  useEffect(() => {
    optsRef.current = opts;
  });

  const phaseRef = useRef<AgentRecPhase>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('');
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const silenceRef = useRef(0);
  const lastSampleRef = useRef(0);
  const levelBufRef = useRef<number[]>([]);
  const speechRef = useRef<WebSpeechSession | null>(null);
  const partialRef = useRef('');
  const stopReqRef = useRef(false);
  const deadRef = useRef(false);
  const stopRef = useRef<() => void>(() => undefined);

  const setPhaseSafe = (p: AgentRecPhase): void => {
    phaseRef.current = p;
    setPhase(p);
  };

  const cleanupCapture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      ctxRef.current?.close();
    } catch {
      /* ignore */
    }
    ctxRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 卸载时若还在录音：静默丢弃并释放麦克风
  useEffect(
    () => () => {
      deadRef.current = true;
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recRef.current = null;
      speechRef.current?.abort();
      speechRef.current = null;
      cleanupCapture();
    },
    [cleanupCapture],
  );

  const finalize = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    const elapsed = (performance.now() - startRef.current) / 1000;
    const speech = speechRef.current;
    speechRef.current = null;
    cleanupCapture();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    setSeconds(0);
    setLevels([]);
    if (!rec || elapsed < REC_MIN_SEC || chunks.length === 0) {
      // 太短（静默过早触发/秒点停止）：不算错误，让面板回到可重录态
      speech?.abort();
      setPhaseSafe('idle');
      setPartial('');
      partialRef.current = '';
      optsRef.current.onResult(null);
      return;
    }
    const blob = buildBlob(chunks, mimeRef.current);
    const live = partialRef.current;
    partialRef.current = '';
    setPartial('');
    setPhaseSafe('recognizing');
    try {
      const r = await recognizeAgentBlob(blob, live);
      setPhaseSafe('idle');
      optsRef.current.onResult({ ok: true, text: r.text, via: r.via });
    } catch (err) {
      setPhaseSafe('idle');
      optsRef.current.onResult({ ok: false, error: err instanceof Error ? err.message : '识别失败，请重试' });
    }
  }, [cleanupCapture]);

  const stop = useCallback(() => {
    if (phaseRef.current === 'starting') {
      // 还在等权限/启动：标记，等真正开始录音后立即结束
      stopReqRef.current = true;
      return;
    }
    if (phaseRef.current !== 'recording') return;
    const rec = recRef.current;
    if (!rec) return;
    try {
      if (rec.state !== 'inactive') rec.stop();
      else void finalize();
    } catch {
      void finalize();
    }
  }, [finalize]);
  // 计时器回调里要拿到最新 stop（ref 中转，避免闭包过期）
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const cancel = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null; // 阻断 finalize：丢弃音频
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recRef.current = null;
    speechRef.current?.abort();
    speechRef.current = null;
    chunksRef.current = [];
    cleanupCapture();
    setPhaseSafe('idle');
    setSeconds(0);
    setLevels([]);
    setPartial('');
    partialRef.current = '';
    stopReqRef.current = false;
  }, [cleanupCapture]);

  const start = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      optsRef.current.onStartError('当前环境不支持录音，可直接打字下发任务');
      return;
    }
    stopReqRef.current = false;
    chunksRef.current = [];
    levelBufRef.current = [];
    silenceRef.current = 0;
    lastSampleRef.current = 0;
    partialRef.current = '';
    setPartial('');
    // Web Speech 实时识别：仅离线引擎未就绪且浏览器支持时并行起
    // （APK 内首选端侧链路，不重复占识别通道；浏览器网页预览靠它兜底）
    if (!isOfflineAsrReady() && isWebSpeechSupported()) {
      speechRef.current?.abort();
      speechRef.current = startWebSpeechSession({
        onPartial: (t) => {
          partialRef.current = t;
          setPartial(t);
        },
      });
    }
    setPhaseSafe('starting');
    const beginCapture = (): void => {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (phaseRef.current !== 'starting' || deadRef.current) {
            // 等权限期间已关面板/卸载
            stream.getTracks().forEach((t) => t.stop());
            speechRef.current?.abort();
            speechRef.current = null;
            return;
          }
          streamRef.current = stream;
          const mime = pickRecorderMime();
          mimeRef.current = mime ?? 'audio/webm';
          let rec: MediaRecorder;
          try {
            rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
          } catch {
            try {
              rec = new MediaRecorder(stream);
              mimeRef.current = rec.mimeType || 'audio/webm';
            } catch {
              stream.getTracks().forEach((t) => t.stop());
              setPhaseSafe('idle');
              optsRef.current.onStartError('当前环境不支持录音，可直接打字下发任务');
              return;
            }
          }
          chunksRef.current = [];
          rec.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
          };
          rec.onstop = () => void finalize();
          rec.start(200);
          recRef.current = rec;

          // 实时振幅采样（波形动画 + 静默判定）；失败不影响录音本身
          try {
            const w = window as Window & { webkitAudioContext?: typeof AudioContext };
            const Ctor = window.AudioContext ?? w.webkitAudioContext;
            if (Ctor) {
              const ctx = new Ctor();
              void ctx.resume().catch(() => undefined);
              const source = ctx.createMediaStreamSource(stream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              ctxRef.current = ctx;
              analyserRef.current = analyser;
            }
          } catch {
            /* 采样失败静默 */
          }

          startRef.current = performance.now();
          silenceRef.current = 0;
          setSeconds(0);
          setPhaseSafe('recording');
          timerRef.current = window.setInterval(() => {
            const sec = (performance.now() - startRef.current) / 1000;
            setSeconds(sec);
            // 每 ~100ms 采一个 RMS（波形 + 静默判定）
            const analyser = analyserRef.current;
            let rms = 0;
            if (analyser && performance.now() - lastSampleRef.current > 100) {
              lastSampleRef.current = performance.now();
              const buf = new Uint8Array(analyser.fftSize);
              analyser.getByteTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) {
                const d = (buf[i] - 128) / 128;
                sum += d * d;
              }
              rms = Math.sqrt(sum / buf.length);
              levelBufRef.current.push(Math.max(0.08, Math.min(1, rms * 3.2)));
              setLevels(levelBufRef.current.slice(-140));
            }
            // 静默自动停止：已录 >1s 且持续 1.4s 无声（无分析器时跳过，仅 30s 上限兜底）
            if (rms > 0) {
              if (rms < REC_SILENCE_RMS) silenceRef.current += 100;
              else silenceRef.current = 0;
              if (sec > 1 && silenceRef.current >= REC_SILENCE_MS) {
                stopRef.current();
                return;
              }
            }
            if (sec >= REC_MAX_SEC) {
              stopRef.current();
              return; // 30 秒上限：自动结束并识别
            }
          }, 100);
          // 启动期间就请求了停止：立即收尾
          if (stopReqRef.current) {
            stopReqRef.current = false;
            stopRef.current();
          }
        })
        .catch((err: unknown) => {
          // 启动失败（权限拒绝/无麦克风等）：释放可能已取得的资源，给出中文引导
          const rec = recRef.current;
          if (rec && rec.state !== 'inactive') {
            rec.onstop = null;
            try {
              rec.stop();
            } catch {
              /* ignore */
            }
          }
          recRef.current = null;
          speechRef.current?.abort();
          speechRef.current = null;
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          cleanupCapture();
          setPhaseSafe('idle');
          const name = typeof err === 'object' && err !== null ? (err as { name?: string }).name : '';
          if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
            optsRef.current.onStartError('无法使用麦克风：请允许录音权限，或直接打字下发任务');
          } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            optsRef.current.onStartError('未找到可用麦克风，可直接打字下发任务');
          } else {
            optsRef.current.onStartError('无法访问麦克风，可直接打字下发任务');
          }
        });
    };
    // v1.6.1 APK 原生壳：先走原生运行时权限申请（未授予时弹系统授权框）。WebView 的
    // getUserMedia 在 Android 权限未授予时被系统静默拒绝（永不弹框）——旧壳（Manifest 未声明
    // RECORD_AUDIO）上表现为一直「无法使用麦克风」，部分设备还会异常退出；这里前置拿权，
    // 授权后 getUserMedia 经 Capacitor onPermissionRequest 自动放行
    void (async () => {
      if (isNativePerception()) {
        const mp = await requestMicPermission().catch(() => null);
        if (!mp || mp.granted !== true) {
          if (phaseRef.current === 'starting' && !deadRef.current) {
            setPhaseSafe('idle');
            optsRef.current.onStartError(
              '无法使用麦克风：请在系统设置 › 应用 › AI Phone › 权限中允许「麦克风」，或直接打字下发任务'
            );
          }
          return;
        }
      }
      beginCapture();
    })();
  }, [cleanupCapture, finalize]);

  return { phase, seconds, levels, partial, start, stop, cancel };
}

// ============================================================
// A5. 连续唤醒监听（喊名字唤醒，默认关）
// ============================================================

/**
 * 连续唤醒能否开录（每轮开录前 + 录音中每 200ms 复查）。
 * panelOpen/agentRunning 由组件传入；其余现场读各 store：
 * 页面隐藏 / 锁屏 / 熄屏 / 多任务 / 通话（主动+来电） / TTS 朗读 / 语音消息播放 → 暂停。
 */
export function canAgentWakeListen(panelOpen: boolean, agentRunning: boolean): boolean {
  if (panelOpen || agentRunning) return false;
  if (typeof document === 'undefined' || document.hidden) return false;
  try {
    const ui = useUI.getState();
    if (ui.locked || ui.screenOff || ui.switcherOpen || ui.callActive) return false;
    if (useIncomingCall.getState().call) return false;
  } catch {
    /* store 异常不阻断监听 */
  }
  try {
    if (isSpeaking()) return false; // TTS 朗读中（电话/语音条实时朗读）
    if (useVoicePlayback.getState().playing) return false; // 语音消息播放中
  } catch {
    /* 播放状态读取失败不阻断 */
  }
  return true;
}

/** 单轮唤醒录音：固定毫秒窗口；shouldAbort 命中即提前收尾并丢弃（返回 null）。 */
async function recordWakeChunk(ms: number, shouldAbort: () => boolean): Promise<Blob | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持录音');
  }
  // v1.6.1 APK 原生壳：前置拿 Android 运行时麦克风权限（首轮弹系统授权框，已授零开销直通）；
  // 被拒抛错 → 唤醒循环既有熔断记录原因并停轮询，不再每轮空转撞墙
  if (isNativePerception()) {
    const mp = await requestMicPermission().catch(() => null);
    if (!mp || mp.granted !== true) throw new Error('mic-permission-denied');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
    } catch {
      rec = new MediaRecorder(stream);
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.start(250);
    let aborted = false;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await sleep(200);
      if (shouldAbort()) {
        aborted = true;
        break;
      }
    }
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      /* ignore */
    }
    await Promise.race([stopped, sleep(800)]);
    if (aborted) return null;
    return chunks.length > 0 ? buildBlob(chunks, rec.mimeType || mime || '') : null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** 唤醒命中后剩余字数门槛：≥4 字直接作任务文本进确认卡（一句话直达） */
const WAKE_REST_MIN = 4;
/** 每轮监听录音时长（需求 3-4s 取 3.2s） */
const WAKE_CHUNK_MS = 3200;
/** 未命中轮间间隔（省电，需求 ≥1.5s） */
const WAKE_GAP_MS = 1500;
/** 麦克风连续失败熔断阈值 */
const WAKE_FAIL_FUSE = 3;
/** 通道 C 服务端识别连续失败降级阈值：连续 N 次不可达改走 Web Speech 兜底 */
const WAKE_SERVER_FAIL_DEGRADE = 4;

// ---------------- 通道 C：VAD 说话检测 + 服务端识别（不依赖 Google，大陆网络可靠） ----------------

/** VAD 分析帧长 */
const VAD_FRAME_MS = 60;
/** 说话检测阈值（rms；正常说话 0.1+，环境噪声 <0.03） */
const VAD_THRESHOLD = 0.05;
/** 连续多少帧超阈值视为开口（4 帧 ≈ 240ms 防误触发） */
const VAD_ON_FRAMES = 4;
/** 录中连续多少帧静默视为说完（20 帧 ≈ 1.2s） */
const VAD_OFF_FRAMES = 20;
/** 单段录音上限 */
const VAD_MAX_MS = 4000;
/** 未命中段间防重触发间隔 */
const VAD_GAP_MS = 800;

/** 通道 C 可用性：能开麦 + 能录音即可（浏览器与 APK WebView 均满足；悬浮球组件判定 wakeOn 用） */
export function canWakeVad(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** Float32（16k 单声道）→ 16bit PCM WAV ArrayBuffer（服务端 ASR 明确支持 WAV） */
function encodeWav16k(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 单声道
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); // 16000 * 2 字节率
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ws(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Blob → 去掉 dataURL 前缀的 base64（FileReader 实现，避开 btoa 大数组栈溢出） */
function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(new Error('音频读取失败'));
    fr.readAsDataURL(b);
  });
}

/** 服务端唤醒识别：16k 单声道样本 → WAV base64 → POST /api/wake-asr → 文本（12s 看门狗） */
async function wakeAsrTranscribe(samples: Float32Array): Promise<string> {
  const b64 = await blobToBase64(new Blob([encodeWav16k(samples)], { type: 'audio/wav' }));
  const res = await fetch('/api/wake-asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: b64 }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`wake-asr ${res.status}`);
  const j = (await res.json()) as { text?: unknown };
  return typeof j.text === 'string' ? j.text : '';
}

/**
 * 连续唤醒循环（挂载即后台跑，由 enabled 一键启停）三通道（本次会话固定，依可用性择一；
 * v1.8 通道顺序重排：大陆网络秒起听，不再让 Google 不可达的 Web Speech 先白跑几十秒）：
 * - 通道 B（离线引擎就绪，APK 已下载模型时首选）：每轮 录 3.2s → 端侧转写 → 匹配唤醒名，断网可用；
 * - 通道 C（VAD + 服务端识别）：AnalyserNode 监测说话（安静零请求）→ 录 ≤4s →
 *   16k WAV → POST /api/wake-asr（z-ai ASR）→ 匹配唤醒名；不依赖 Google，大陆网络可靠；
 *   APK 原生壳先弹系统麦克风权限；服务端连续 4 次不可达才降级通道 A；
 * - 通道 A（Web Speech）：实时监听免下载模型，但 Chrome 语音服务走 Google，大陆常不可达，只作兜底。
 * 命中统一：震动 + onWake（剩余 ≥4 字带任务文本）；麦克风连续 3 轮失败 → 熔断停循环并记录原因
 * （悬浮球红点 + 设置页展示，重新拨动开关即重试）；暂停条件见 canAgentWakeListen。
 */
export function useAgentWakeLoop(opts: {
  /** 总启用（listen 开关 && [离线就绪 || Web Speech 可用 || VAD+服务端可用] && 未熔断）——外层算好传入 */
  enabled: boolean;
  /** 唤醒名（经 optsRef 透传，设置页改完下一轮立即生效） */
  name: string;
  /** 每轮开录前动态检查（含面板打开/Agent 运行，组件用 ref 透传最新值） */
  canListen: () => boolean;
  /** 命中唤醒名：task=null 表示只喊了名字（面板进录音态等继续说），否则直接进确认卡 */
  onWake: (task: string | null) => void;
}): void {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    if (!opts.enabled) return undefined;
    let aborted = false;
    let micFails = 0;
    const MIC_FUSE_MSG = '无法访问麦克风：喊名唤醒已自动停用（允许麦克风权限后重新打开此开关；点悬浮球仍可对话）';
    /** 熔断：大概率无麦克风权限/不支持录音——停循环并记录原因，重新拨动开关即重试 */
    const fuseMic = () => {
      useAgentVoice.setState({ wakeBlocked: MIC_FUSE_MSG });
      aborted = true;
    };

    void (async () => {
      // 首轮小延迟：避开开开关瞬间的其它音频操作与权限弹窗竞争
      await sleep(1200);

      // —— 通道 B：MediaRecorder 3.2s 分块 + 端侧转写（离线引擎就绪时首选，断网可用）——
      if (isOfflineAsrReady()) {
        while (!aborted) {
          if (!optsRef.current.canListen()) {
            await sleep(900); // 暂停期低频轮询，恢复可见/空闲后 1s 内续听
            continue;
          }
          try {
            const blob = await recordWakeChunk(WAKE_CHUNK_MS, () => aborted || !optsRef.current.canListen());
            if (aborted) break;
            if (!blob) continue; // 中途被暂停打断：不消耗轮间隔
            const text = await offlineAsrTranscribe(blob).catch(() => '');
            if (aborted) break;
            const rest = await matchWakeNameSmart(text, optsRef.current.name);
            micFails = 0;
            if (rest !== null) {
              vibrateSafely([40, 80, 40]); // 命中反馈：短震动两连
              optsRef.current.onWake(rest.length >= WAKE_REST_MIN ? rest : null);
              await sleep(WAKE_GAP_MS); // 面板打开期间 canListen 会挡住后续轮
            } else {
              await sleep(WAKE_GAP_MS); // 未命中：轮间 ≥1.5s 省电
            }
          } catch {
            micFails += 1;
            if (micFails >= WAKE_FAIL_FUSE) {
              fuseMic();
              break;
            }
            await sleep(2500);
          }
        }
        return;
      }

      // —— 通道 C：VAD 说话检测 + 服务端识别 /api/wake-asr（大陆网络首选，不依赖 Google）——
      // AnalyserNode 持续监测振幅：安静环境零请求；连续 ~240ms 超阈值视为开口 → 录至
      // 静默 1.2s（上限 4s）→ 16k WAV → 服务端 z-ai ASR → 匹配唤醒名。
      // 服务端连续 4 次不可达（接口挂/断网）→ 落到下方通道 A（Web Speech）兜底。
      let serverFails = 0;
      if (canWakeVad()) {
        while (!aborted && serverFails < WAKE_SERVER_FAIL_DEGRADE) {
          if (!optsRef.current.canListen()) {
            await sleep(900);
            continue;
          }
          // v1.8 APK 原生壳：前置拿 Android 运行时麦克风权限（与面板录音同款）——
          // WebView 的 getUserMedia 在权限未授予时被静默拒绝，不弹框也不报给人听
          if (isNativePerception()) {
            const mp = await requestMicPermission().catch(() => null);
            if (!mp || mp.granted !== true) {
              micFails += 1;
              if (micFails >= WAKE_FAIL_FUSE) {
                fuseMic();
                break;
              }
              await sleep(2500);
              continue;
            }
          }
          let stream: MediaStream | null = null;
          let ctx: AudioContext | null = null;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            micFails += 1;
            if (micFails >= WAKE_FAIL_FUSE) {
              fuseMic();
              break;
            }
            await sleep(2500);
            continue;
          }
          try {
            ctx = new AudioContext();
            if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            ctx.createMediaStreamSource(stream).connect(analyser);
            const frame = new Float32Array(analyser.fftSize);
            const rms = (): number => {
              analyser.getFloatTimeDomainData(frame);
              let sum = 0;
              for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
              return Math.sqrt(sum / frame.length);
            };
            // VAD 等待开口：连续 4 帧超阈值视为开始说话
            let hot = 0;
            let spoke = false;
            let suspendedFrames = 0; // AudioContext 被自动播放策略挂起（页面刚加载无手势）：持续重试 resume，超 8s 放弃本轮
            while (!aborted && !spoke) {
              await sleep(VAD_FRAME_MS);
              if (!optsRef.current.canListen()) break;
              if (ctx.state !== 'running') {
                void ctx.resume().catch(() => undefined);
                suspendedFrames += 1;
                if (suspendedFrames * VAD_FRAME_MS >= 8000) break;
                continue;
              }
              hot = rms() > VAD_THRESHOLD ? hot + 1 : 0;
              if (hot >= VAD_ON_FRAMES) spoke = true;
            }
            if (!spoke) continue; // 暂停/卸载/挂起打断（finally 清流），下轮重开
            // 开录：唤醒词与后续指令通常同段；静默 ~1.2s 或 4s 上限收尾
            const mime = pickRecorderMime();
            let rec: MediaRecorder;
            try {
              rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
            } catch {
              rec = new MediaRecorder(stream);
            }
            const chunks: Blob[] = [];
            rec.ondataavailable = (e: BlobEvent) => {
              if (e.data && e.data.size > 0) chunks.push(e.data);
            };
            const stopped = new Promise<void>((resolve) => {
              rec.onstop = () => resolve();
            });
            rec.start(250);
            const startedAt = Date.now();
            let quiet = 0;
            while (!aborted && Date.now() - startedAt < VAD_MAX_MS) {
              await sleep(VAD_FRAME_MS);
              if (!optsRef.current.canListen()) break;
              quiet = rms() > VAD_THRESHOLD ? 0 : quiet + 1;
              if (quiet >= VAD_OFF_FRAMES) break;
            }
            try {
              if (rec.state !== 'inactive') rec.stop();
            } catch {
              /* ignore */
            }
            await Promise.race([stopped, sleep(800)]);
            if (aborted || !optsRef.current.canListen()) continue;
            if (chunks.length === 0) {
              await sleep(VAD_GAP_MS);
              continue;
            }
            const blob = buildBlob(chunks, rec.mimeType || mime || '');
            // 解码重采样 16k 单声道（复用离线链路的已验证实现），太短的误触发丢弃
            const samples = await blobTo16kMono(blob).catch(() => new Float32Array(0));
            if (aborted) break;
            if (samples.length < 4000) {
              await sleep(VAD_GAP_MS);
              continue;
            }
            let text = '';
            try {
              text = await wakeAsrTranscribe(samples);
              serverFails = 0; // 服务端健康：清零降级计数
            } catch {
              serverFails += 1; // 服务端不可达（接口挂/断网）：累计，连续 4 次降级通道 A
              await sleep(VAD_GAP_MS);
              continue;
            }
            micFails = 0;
            if (aborted) break;
            const rest = await matchWakeNameSmart(text, optsRef.current.name);
            if (rest !== null) {
              vibrateSafely([40, 80, 40]); // 命中反馈：短震动两连
              optsRef.current.onWake(rest.length >= WAKE_REST_MIN ? rest : null);
              await sleep(WAKE_GAP_MS); // 面板打开期间 canListen 会挡住后续轮
            } else {
              await sleep(VAD_GAP_MS); // 未命中：防连触
            }
          } finally {
            try {
              stream?.getTracks().forEach((t) => t.stop());
            } catch {
              /* ignore */
            }
            try {
              void ctx?.close().catch(() => undefined);
            } catch {
              /* ignore */
            }
          }
        }
      }

      // —— 通道 A：Web Speech 实时监听（服务端识别连败/无 MediaRecorder 时的兜底）——
      // SpeechRecognition continuous 持续听（onend 自动重启），识别文本含唤醒名即命中；
      // Chrome 语音服务走 Google，大陆网络常不可达 → 「自然死亡且零识别数据」空转，仅在
      // 通道 C 不可用时启用（岛外浏览器老接口/服务端挂掉的场景）。
      if (isWebSpeechSupported()) {
        while (!aborted) {
          if (!optsRef.current.canListen()) {
            await sleep(900); // 暂停期低频轮询，恢复可见/空闲后 1s 内续听
            continue;
          }
          let woke = false;
          let dead = false; // 本轮会话已结束（致命错误/无法重启）→ 重起新会话续听
          let gotData = false; // 本轮收到过任何识别文本（健康信号）
          let lastText = ''; // 最新累计识别文本（onPartial 只记录；同音匹配是 async，在等待循环里做）
          const session = startWebSpeechSession({
            lang: 'zh-CN',
            onPartial: (text) => {
              lastText = text;
              if (text.trim()) gotData = true;
            },
            onError: (code) => {
              if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
                micFails += 1;
                if (micFails >= WAKE_FAIL_FUSE) fuseMic();
              }
              dead = true; // 所有错误都终结本轮：not-allowed 等不再自动重启；no-speech 等下轮重起更稳
            },
          });
          if (!session) {
            await sleep(2500); // 起监听失败（罕见）：稍后重试
            continue;
          }
          // 等待：命中 / 暂停条件（面板打开等）/ 卸载 / 本轮结束；新文本落地即异步匹配
          const startedAt = Date.now();
          let matchedLen = 0;
          while (!aborted && !woke && !dead) {
            await sleep(300);
            if (Date.now() - startedAt > 10_000) micFails = 0; // 会话健康存活 10s+：权限正常，清零熔断计数
            if (lastText.length > matchedLen) {
              matchedLen = lastText.length;
              const rest = await matchWakeNameSmart(lastText, optsRef.current.name).catch(() => null);
              if (rest !== null) {
                woke = true;
                vibrateSafely([40, 80, 40]); // 命中反馈：短震动两连
                optsRef.current.onWake(rest.length >= WAKE_REST_MIN ? rest : null);
                break;
              }
            }
            if (!woke && !optsRef.current.canListen()) break; // 暂停：下轮重开
          }
          try {
            session.abort();
          } catch {
            /* ignore */
          }
          if (aborted) break;
          await sleep(woke ? WAKE_GAP_MS : 600); // 命中后停一拍等面板开；未命中很快重起续听
        }
      }
    })();

    return () => {
      aborted = true;
    };
    // 只随 enabled 启停；name/canListen/onWake 经 optsRef 透传最新值（刻意不进依赖）
  }, [opts.enabled]);
}

// ============================================================
// A6. C4 任务终态播报（Siri 式闭环）+ 语音来源标记 + 播报/追问统一闸门
// ============================================================

/**
 * 最近一次「语音唤起启动」的 Agent 任务时间戳（0 = 无）：
 * 悬浮球语音面板执行任务、且确认真正跑起来（未被能力闸/防重入秒拒）后置位；
 * 任务终态播报钩子（shizuku-agent.setAgentResultAnnouncer 回调）读后即清。
 * 10min 兜底过期：语音层中途卸载等极端场景下标记没被消费，避免污染后续非语音任务。
 */
let voiceOriginAt = 0;

/** 悬浮球语音面板执行任务且确认真正跑起来后调用：标记本任务为语音唤起来源 */
export function markAgentTaskVoiceOrigin(): void {
  voiceOriginAt = Date.now();
}

/** 终态播报钩子消费语音来源标记（读后即清；超过 10min 的陈旧标记视为无效） */
export function consumeAgentTaskVoiceOrigin(): boolean {
  if (!voiceOriginAt) return false;
  const ok = Date.now() - voiceOriginAt < 10 * 60_000;
  voiceOriginAt = 0;
  return ok;
}

/** 播报闸门用：当前正在出声的是否我们自己的任务播报（是 → 允许打断重播，不算抢话筒） */
let selfAnnouncing = false;

/**
 * 播报/追问统一闸门（C4）：任务终态瞬间语音层能否动作（TTS 播报 + 进追问模式共用）。
 * 与唤醒监听暂停条件（canAgentWakeListen）同源，但不含 panelOpen/agentRunning——
 * 终态时 running 已落 false（任务刚结束不算「执行中」，且防重入保证同一时刻只有一个任务，
 * 终态回调触发时不可能有新任务在跑），追问模式本身就要求面板展开：
 * 页面隐藏 / 锁屏 / 熄屏 / 多任务 / 通话（主动+来电）/ 语音消息播放中 / 其它 TTS 朗读中 → false。
 */
export function canAgentVoiceActNow(): boolean {
  if (typeof document === 'undefined' || document.hidden) return false;
  try {
    const ui = useUI.getState();
    if (ui.locked || ui.screenOff || ui.switcherOpen || ui.callActive) return false;
    if (useIncomingCall.getState().call) return false;
  } catch {
    /* store 异常不阻断 */
  }
  try {
    if (useVoicePlayback.getState().playing) return false; // 语音消息播放中：不抢话筒
    if (isSpeaking() && !selfAnnouncing) return false; // 其它 TTS 在放（电话/语音条实时朗读）：让路
  } catch {
    /* 播放状态读取失败不阻断 */
  }
  return true;
}

/**
 * 助手音色（v1.8）：语音智能体（小灵）说话用的 voiceId。空串 = 跟随「语音 API」全局默认
 * （speakUserTts 的默认解析链），非空则显式传给 speakUserTts（显式音色优先级最高）。
 * 音色在设置 › AI 动手 › 语音智能体 › 「助手音色」选择（内置声线 / 我的音色）。
 */
export function assistantVoiceId(): string {
  return getAgentVoiceCfg().voice.trim();
}

/**
 * 任务终态语音播报（C4，Siri 式闭环）：复用共享 TTS 栈（tts-client，音色/清理/云端兜底全继承）。
 * 播报条件（全部满足才出声，否则静默跳过——不弹任何打扰，未配置的提示放设置页）：
 * ① 「执行结果语音播报」开关开，或本次任务是语音唤起启动的（voiceOrigin，任一满足）；
 * ② TTS 已配置（isTtsConfigured；第三方服务商没填 Key/地址时跳过）；
 * ③ canAgentVoiceActNow() 闸门通过（通话/锁屏/熄屏/多任务/页面隐藏/其它音频在放）。
 * 播报前先 stopSpeaking() 显式打断上一条未播完的播报（token 机制：stopSpeaking 令牌 +1，
 * 旧链路收尾不再触碰公共状态）；播报失败静默（合成超时/引擎哑火等），绝不影响任务收尾。
 * 音色用助手音色（assistantVoiceId，未设则跟随语音 API 全局默认）。
 */
export function speakAgentResult(text: string, opts: { voiceOrigin: boolean }): void {
  const cfg = getAgentVoiceCfg();
  if (!cfg.announce && !opts.voiceOrigin) return;
  if (!isTtsConfigured()) return;
  if (!canAgentVoiceActNow()) return;
  const voice = cfg.voice.trim();
  selfAnnouncing = true;
  stopSpeaking();
  void speakUserTts({
    text,
    voiceId: voice || undefined,
    onEnd: () => {
      selfAnnouncing = false;
    },
  })
    .catch(() => undefined)
    .finally(() => {
      selfAnnouncing = false;
    });
}
