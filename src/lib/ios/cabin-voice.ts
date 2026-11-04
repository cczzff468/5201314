/**
 * 拾光小屋 · 语音输入兜底层（v10.3 / v11 接入设置里的 SenseVoice 模型）
 *
 * 背景：原来的语音输入只依赖 Web Speech API（浏览器内置识别），而国产安卓浏览器 /
 * WebView 里基本不可用（识别引擎走的 Google 服务不可达，甚至没有该 API），
 * 表现就是「点麦克风没反应、不转文字」。
 *
 * 本模块提供与浏览器无关的本地兜底链路：
 * 1. startManualRecording —— MediaRecorder 录音（按住说话的一次性录音）；
 * 2. blobToWav16kBase64 —— 录音解码 → 重采样 16kHz 单声道 → WAV → base64；
 * 3. transcribeBlob —— 识别优先级链（v11）：
 *    ① 设置 App 已下载的 SenseVoice 端侧模型（offline-asr，断网可用、零配置零等待）；
 *    ② 设置 App 配置的云端 STT（stt-client → /api/stt，OpenAI 兼容服务商）；
 *    ③ 内置 z-ai ASR（POST /api/phone/asr，免配置服务端兑底）；
 *    麦克风按钮与连续对讲共用本函数，一处接入全部生效；
 * 4. createVoiceSegmenter —— 连续对讲的自动分段：RMS 音量检测，
 *    检测到说话自动开录，静音 ~1.1s 自动收段 → onSegment(blob) → 逐句识别发送。
 *
 * 麦克风与 Web Speech 可共存（Chrome/Safari 允许多路共享），Web Speech 有结果时
 * 优先用（零等待），没结果时回退录音识别 —— 两头都不空转。
 */

import { pickRecorderMime } from './audio-utils';
import { isOfflineAsrReady, offlineAsrTranscribe } from './offline-asr';
import { isSttReady, transcribeAudioBlob } from './stt-client';

// ---------------- WAV 编码（16kHz 单声道 16bit PCM） ----------------

/** AudioBuffer → 16k 单声道 WAV Blob（含重采样） */
async function encodeWav16k(audio: AudioBuffer): Promise<Blob> {
  const RATE = 16000;
  const MAX_SEC = 55;
  const dur = Math.min(audio.duration || 0, MAX_SEC);
  const len = Math.max(1, Math.ceil(dur * RATE));
  const off = new OfflineAudioContext(1, len, RATE);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const ch = rendered.getChannelData(0);
  // WAV 头（44 字节）+ 16bit PCM
  const dataLen = ch.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataLen));
  const wstr = (off0: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off0 + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wstr(36, 'data');
  view.setUint32(40, dataLen, true);
  let p = 44;
  for (let i = 0; i < ch.length; i++) {
    const v = Math.max(-1, Math.min(1, ch[i]));
    view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    p += 2;
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/** ArrayBuffer → base64（分块 btoa，避免大串栈溢出） */
function abToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/** 录音 Blob → 16k WAV base64（喂给 /api/phone/asr 的 audioBase64） */
export async function blobToWav16kBase64(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const ac = new AudioContext();
  let audio: AudioBuffer;
  try {
    audio = await ac.decodeAudioData(ab);
  } finally {
    void ac.close();
  }
  const wav = await encodeWav16k(audio);
  return abToBase64(await wav.arrayBuffer());
}

// ---------------- 服务端识别 ----------------

/**
 * 录音 → 识别 → 文本；空结果/失败抛错（调用方提示「没听清」）。
 *
 * v11 识别优先级链（接入设置 App 的 SenseVoice 模型）：
 * ① SenseVoice 端侧模型（设置里下载后就绪即用：断网可用、零成本、无外发流量）；
 * ② 用户在设置里配置的云端 STT（OpenAI 兼容 /audio/transcriptions，经 /api/stt 代理）；
 * ③ 内置 z-ai ASR（/api/phone/asr，免配置服务端兑底）。
 * 三级全失败才抛错 —— 只要有任何一路可用，语音输入就不再是「没反应」。
 */
export async function transcribeBlob(blob: Blob): Promise<string> {
  // ① SenseVoice 端侧模型（设置 App → 语音识别 STT → 离线识别；失败静默降级）
  if (isOfflineAsrReady()) {
    try {
      const localText = await offlineAsrTranscribe(blob);
      const t = localText.trim();
      // 过滤纯符号输出（静音/噪声的典型误识别）
      if (t && !/^[#\s*_\-.,!?~。？！，、…—·]+$/.test(t)) return t;
    } catch {
      // 端侧引擎失败（初始化中/解码异常/超时）：静默降级下一级
    }
  }

  // ② 用户配置的云端 STT（内部同样先端侧后云端；此处仅在其就绪时调用）
  if (isSttReady()) {
    try {
      const cloudText = await transcribeAudioBlob(blob);
      if (cloudText) return cloudText;
    } catch {
      // 云端失败：降级内置兑底
    }
  }

  // ③ 内置 z-ai ASR 兑底（免配置，服务端转发）
  const audioBase64 = await blobToWav16kBase64(blob);
  const res = await fetch('/api/phone/asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64 }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || !j || j.error || !j.text) {
    throw new Error(j?.error ?? '没听清，再试一次～');
  }
  return j.text.trim();
}

// ---------------- 一次性录音（麦克风按钮） ----------------

export interface ManualRecording {
  /** 停止并取回完整录音 */
  stop(): Promise<Blob>;
  /** 丢弃：不再产出录音 */
  abort(): void;
}

/** 开始一次性录音（MediaRecorder；不支持的浏览器返回 null） */
export function startManualRecording(stream: MediaStream): ManualRecording | null {
  if (typeof MediaRecorder === 'undefined') return null;
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, pickRecorderMime() ? { mimeType: pickRecorderMime() } : undefined);
  } catch {
    try {
      rec = new MediaRecorder(stream);
    } catch {
      return null;
    }
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop(): Promise<Blob> {
      return new Promise<Blob>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        };
        rec.onstop = finish;
        try {
          rec.stop();
        } catch {
          finish();
        }
        window.setTimeout(finish, 700); //个别浏览器 onstop 不可靠
      });
    },
    abort() {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------- 连续对讲 · 自动分段 ----------------

export interface VoiceSegmenter {
  /** 停止监听并释放资源 */
  stop(): Promise<void>;
}

/**
 * 连续语音分段器：监听麦克风电平（RMS），说话自动开录、静音 ~1.1s 自动收段。
 * 每段通过 onSegment 交出去（调用方 → transcribeBlob → 发送）。
 * - 误触发保护：开口不足 0.3s 的瞬态噪声直接丢弃；
 * - 单段上限 12s（到了强制收段，防止说个不停撑爆识别）。
 */
export function createVoiceSegmenter(opts: {
  stream: MediaStream;
  onSegment: (blob: Blob) => void;
}): VoiceSegmenter {
  const { stream, onSegment } = opts;
  const TICK = 60;
  const START_RMS = 0.02; // 说话电平阈值（普通手机麦克风实测 0.005~0.03 之间）
  const MIN_SPEECH = 300; // 有效语音最短时长
  const SILENCE_END = 1100; // 静音收段时长
  const MAX_SEG = 12000; // 单段上限

  const ac = new AudioContext();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  try {
    ac.createMediaStreamSource(stream).connect(analyser);
  } catch {
    /* 音量检测不可用时降级为定时收段 */
  }
  const buf = new Float32Array(analyser.fftSize);

  let rec: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let keep = true;
  let speaking = false;
  let speechMs = 0;
  let silenceMs = 0;
  let stopped = false;
  const timer = window.setInterval(tickFn, TICK);

  function startRec(): void {
    if (typeof MediaRecorder === 'undefined') return;
    try {
      rec = new MediaRecorder(stream, pickRecorderMime() ? { mimeType: pickRecorderMime() } : undefined);
    } catch {
      try {
        rec = new MediaRecorder(stream);
      } catch {
        return;
      }
    }
    chunks = [];
    keep = true;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
      chunks = [];
      rec = null;
      if (keep && blob.size > 1200) onSegment(blob);
    };
    try {
      rec.start();
    } catch {
      rec = null;
    }
  }

  function endRec(keepIt: boolean): void {
    keep = keepIt;
    try {
      rec?.stop();
    } catch {
      rec = null;
    }
  }

  function tickFn(): void {
    if (stopped) return;
    let rms = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      rms = Math.sqrt(sum / buf.length);
    }
    const loud = rms > START_RMS;
    if (loud) {
      if (!speaking) {
        speaking = true;
        speechMs = 0;
        silenceMs = 0;
        if (!rec) startRec();
      }
      speechMs += TICK;
      silenceMs = 0;
      if (speechMs > MAX_SEG) {
        // 说太久了：强制收段（继续说会自动开下一段）
        speaking = false;
        endRec(true);
      }
    } else if (speaking) {
      silenceMs += TICK;
      if (speechMs >= MIN_SPEECH && silenceMs >= SILENCE_END) {
        speaking = false;
        endRec(true); // 正常一句说完
      } else if (speechMs < MIN_SPEECH && silenceMs > 700) {
        speaking = false;
        endRec(false); // 误触发噪声：丢弃
      }
    }
  }

  return {
    stop(): Promise<void> {
      stopped = true;
      window.clearInterval(timer);
      endRec(false);
      return ac.close().catch(() => undefined) as Promise<void>;
    },
  };
}
