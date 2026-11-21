'use client';

/**
 * 语音活动检测（VAD）——「自动对话」模式核心（微信 / QQ 通话、电话 App 三端共用）：
 *
 * 免提循环：AI 播报结束 → 自动开录音 + 挂 VAD 待命（无需点任何按钮）→ 检测到用户开口
 * → 用户说完（停顿 AUTO_SILENCE_MS）→ 自动结束录音交给 STT → AI 回复 → TTS 播完 → 下一轮。
 *
 * - 基于 WebAudio AnalyserNode 的实时音量（RMS）分析；开听后前 600ms 采样环境底噪自动校准
 *   阈值（覆盖 TTS 尾音/环境噪声），阈值下限 0.012，避免安静环境误触发；
 * - onSpeechStart：连续 150ms 高于阈值 = 用户开口（状态区「在听你说」）；
 * - onSpeechEnd('pause')：说话中停顿超过 silenceMs = 说完了，自动发送；
 * - onSpeechEnd('silent-timeout')：开听后 waitMs 内一直没人说话 = 丢弃本轮重新听
 *   （VAD 检测不到声音时不能一直录）；
 * - onSpeechEnd('maxlen')：单次说话超过 maxMs 强制截断发送（防失控长录）；
 * - WebAudio 不可用的极少数环境：20s 兜底截断，保证免提循环不死锁。
 * stop() 只断开音频分析节点，不动 MediaStream（MediaRecorder 与 VAD 共享同一路流）。
 */

/** 说完停顿判定：静音超过该时长视为「说完了」自动发送 */
export const AUTO_SILENCE_MS = 1400;
/** 开听后一直无人说话的等待上限：超时丢弃本轮重新听（VAD 检测不到声音不能一直录） */
export const AUTO_WAIT_MS = 7000;
/** 单次说话最长时长：强制截断发送 */
export const AUTO_MAX_MS = 30000;
/** 识别失败/没听到声音后自动重听前的缓冲（给提示留展示时间） */
export const AUTO_RETRY_DELAY_MS = 900;
/** 连续识别失败次数上限：达到后暂停自动听（避免无限空转），提示改用文字聊天或点麦克风重试 */
export const STT_FAIL_LIMIT = 3;
/** AI 主动开口：用户一直不说话超过该区间（随机取值避免机械感）后，AI 基于人设/记忆/上下文主动说一句 */
export const PROACTIVE_MIN_MS = 3000;
export const PROACTIVE_MAX_MS = 5000;

export type VadEndReason = 'pause' | 'maxlen' | 'silent-timeout';

export interface VadHandle {
  /** 停止检测并释放分析节点（不影响 MediaStream 本身） */
  stop: () => void;
}

export interface VadOptions {
  /** 与 MediaRecorder 共享的麦克风流 */
  stream: MediaStream;
  /** 检测到用户开口（连续 150ms 高于阈值） */
  onSpeechStart?: () => void;
  /** 一轮结束：pause=说完停顿 / maxlen=超长截断 / silent-timeout=一直没人说话 */
  onSpeechEnd: (reason: VadEndReason) => void;
  /** 停顿判定（默认 AUTO_SILENCE_MS） */
  silenceMs?: number;
  /** 开听等待上限（默认 AUTO_WAIT_MS） */
  waitMs?: number;
  /** 单次说话上限（默认 AUTO_MAX_MS） */
  maxMs?: number;
  /** 固定音量阈值（默认自动底噪校准） */
  threshold?: number;
}

let ctxSingleton: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!ctxSingleton) ctxSingleton = new Ctx();
    if (ctxSingleton.state === 'suspended') void ctxSingleton.resume();
    return ctxSingleton;
  } catch {
    return null;
  }
}

/** 底噪校准窗口：开听后先采样环境音（含 TTS 尾音）再定阈值 */
const CALIB_MS = 600;
/** 校准窗口内混入强声（AI 播报尾音等）时的判定线：超过则窗口后移重采 */
const NOISE_SUSPECT_LEVEL = 0.05;
/** 阈值上限：底噪被尾音抬高时 clamp，防止阈值高到永远听不见说话 */
const THRESHOLD_MAX = 0.055;
/** 强声重采次数上限（之后强制用当前窗口定阈值，校准最多拖 ~2.4s） */
const CALIB_REMAX = 3;
/** 连续高于阈值多久算「开口」（防瞬时噪声误触发） */
const SPEECH_START_MS = 150;
const TICK = 50;

export function startVad(opts: VadOptions): VadHandle {
  const silenceMs = opts.silenceMs ?? AUTO_SILENCE_MS;
  const waitMs = opts.waitMs ?? AUTO_WAIT_MS;
  const maxMs = opts.maxMs ?? AUTO_MAX_MS;
  const startedAt = Date.now();

  let stopped = false;
  let endFired = false;
  let speaking = false;
  /** 开口时刻（maxlen 从这里起算：限制单次说话时长） */
  let speechStartAt = 0;
  let lastVoiceAt = 0;
  let aboveRun = 0;
  let threshold = opts.threshold ?? 0.012;
  let calibrated = opts.threshold !== undefined;
  let calibSum = 0;
  let calibCount = 0;
  let calibMax = 0;
  let calibRounds = 0;
  let calibStartAt = startedAt;

  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let buf: Float32Array<ArrayBuffer> | null = null;
  let timer: number | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      analyser?.disconnect();
    } catch {
      /* ignore */
    }
    source = null;
    analyser = null;
    buf = null;
  };

  const finish = (reason: VadEndReason) => {
    if (endFired || stopped) return;
    endFired = true;
    stop();
    opts.onSpeechEnd(reason);
  };

  try {
    const ctx = getCtx();
    if (!ctx) {
      // WebAudio 不可用：VAD 挂了也要保证循环不死锁——20s 兜底按超长截断
      timer = window.setTimeout(() => finish('maxlen'), 20000);
      return { stop };
    }
    source = ctx.createMediaStreamSource(opts.stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.1;
    source.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    const readRms = (): number => {
      if (!analyser || !buf) return 0;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };

    timer = window.setInterval(() => {
      if (stopped) return;
      const now = Date.now();
      const level = readRms();
      // 底噪校准：开听后先采样 600ms 环境音；窗口内混入强声（AI 播报尾音/关门声等）
      // → 窗口后移重采（最多 CALIB_REMAX 次），避免阈值被抬高到永远听不见说话
      if (!calibrated) {
        calibSum += level;
        calibCount += 1;
        if (level > calibMax) calibMax = level;
        if (now - calibStartAt >= CALIB_MS) {
          if (calibMax > NOISE_SUSPECT_LEVEL && calibRounds < CALIB_REMAX) {
            calibRounds += 1;
            calibSum = 0;
            calibCount = 0;
            calibMax = 0;
            calibStartAt = now;
            return;
          }
          const floor = calibCount > 0 ? calibSum / calibCount : 0;
          threshold = Math.min(Math.max(0.012, floor * 2.5), THRESHOLD_MAX);
          calibrated = true;
        }
        return;
      }
      if (level > threshold) {
        aboveRun += TICK;
        lastVoiceAt = now;
        if (!speaking && aboveRun >= SPEECH_START_MS) {
          speaking = true;
          speechStartAt = now;
          opts.onSpeechStart?.();
        }
      } else {
        aboveRun = 0;
      }
      if (speaking) {
        // 说话中：停顿 silenceMs → 说完了；单次说话超 maxMs → 强制截断
        if (now - lastVoiceAt >= silenceMs) finish('pause');
        else if (now - speechStartAt >= maxMs) finish('maxlen');
      } else if (now - startedAt >= waitMs) {
        // 一直没人说话：丢弃本轮重新听（不能一直录）
        finish('silent-timeout');
      }
    }, TICK);
  } catch {
    // 分析节点创建失败：同样 20s 兜底，免提循环不死锁
    timer = window.setTimeout(() => finish('maxlen'), 20000);
  }

  return { stop };
}
