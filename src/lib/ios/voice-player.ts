/**
 * 语音消息播放器（单聊/群聊语音气泡共用，模块级单例）：
 * - 一条语音在播时再点其它语音 → 自动停旧的播新的；暂停/继续同一实例（进度保留）
 * - 进度 0~1 每 100ms 广播，气泡波形按进度填充
 * - 三通道：普通语音 = 音频文件（dataURL，真实出声）；文字转语音消息（带 localText）=
 *   **静音模拟播放**——不出声、不需要语音 API，点击只按估算时长推进波形进度动画；
 *   AI 语音消息（带 contactId 或历史存量 synth='builtin'）= **实时朗读**——点击时用当前
 *   角色音色把 localText 真实读出来（Task 33：只要配置了声音——内置语音免配置恒可用，
 *   配了第三方语音 API 则用 API 音色——AI 的静音语音条/文字语音也能点播放出声；
 *   进度按估算推进，真实播完自动收尾，引擎失败降级静音模拟）
 * - 与 TTS 朗读（电话等）互斥：播放前 stopOtherAudio 停掉对方
 * - stopVoicePlayback() 供聊天页卸载/切换会话/开录前释放（同时会停掉 AI 语音的实时朗读）
 */

import { create } from 'zustand';
import { registerAudioSource, stopOtherAudio } from './audio-focus';
import { speakUserTts, stopSpeaking } from './tts-client';
import { estimateSpeakDuration } from './voice-send';

interface VoicePlayStore {
  /** 正在播放（或暂停挂起）的语音消息 id */
  activeId: string | null;
  /** 是否正在播放（false = 暂停或无播放） */
  playing: boolean;
  /** 播放进度 0~1 */
  progress: number;
}

export const useVoicePlayback = create<VoicePlayStore>(() => ({
  activeId: null,
  playing: false,
  progress: 0,
}));

let audio: HTMLAudioElement | null = null;
let currentId: string | null = null;
let currentUrl: string | null = null;
let timer: number | null = null;
/** 当前在播的语音是否走「角色音色实时朗读」（stopVoicePlayback 时要同步停掉 TTS 引擎） */
let activeContactTts = false;

/** 静音模拟播放状态（文字转语音消息 / AI 语音进度动画）：进度 = offset + 本次起点以来经过的时间 */
interface SimState {
  id: string;
  dur: number;
  offset: number;
  startedAt: number;
  /** true = 有真实播放挂在后面（AI 语音实时朗读）：到点后悬在 98% 等真实结束，不自行收尾 */
  hold?: boolean;
}
let simState: SimState | null = null;

function clearTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function teardown(): void {
  clearTimer();
  if (activeContactTts) {
    activeContactTts = false;
    // 停掉实时朗读：API 音频与内置朗读引擎一并立刻截断（stopSpeaking 内部已含 stopBuiltinSpeech）
    stopSpeaking();
  }
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
    } catch {
      // 已释放的 Audio 再 pause 不抛错
    }
    audio.src = '';
    audio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  currentId = null;
  simState = null;
}

/** 停止当前语音播放并清空状态（页面卸载/切换会话/新播放前调用；含静音模拟） */
export function stopVoicePlayback(): void {
  teardown();
  useVoicePlayback.setState({ activeId: null, playing: false, progress: 0 });
}

/** 静音模拟进度计时：按估算时长推进 0~1（暂停时不推进；hold=true 时到点后悬在 98% 等真实播放收尾） */
function startSimTimer(id: string): void {
  clearTimer();
  timer = window.setInterval(() => {
    if (!simState || simState.id !== id) return;
    if (!useVoicePlayback.getState().playing) return;
    const elapsed = simState.offset + (performance.now() - simState.startedAt) / 1000;
    if (elapsed >= simState.dur) {
      // hold（AI 语音实时朗读）：估算时长已走完但真实语音可能还没读完 → 悬在 98% 等真实播放结束；
      // 超过估算 3 倍仍没结束视为引擎卡死，强制收尾
      if (simState.hold && elapsed < simState.dur * 3) {
        useVoicePlayback.setState({ progress: 0.98 });
        return;
      }
      stopVoicePlayback();
      return;
    }
    useVoicePlayback.setState({ progress: Math.min(1, elapsed / simState.dur) });
  }, 100);
}

/** 静音模拟路径（文字转语音消息）：点击切换 播放/暂停/继续，全程不出声 */
function toggleSim(id: string, dur: number): void {
  const st = useVoicePlayback.getState();
  if (st.activeId === id) {
    if (st.playing) {
      // 暂停：记录已走秒数
      if (simState && simState.id === id) {
        simState.offset += (performance.now() - simState.startedAt) / 1000;
      }
      useVoicePlayback.setState({ playing: false });
    } else {
      // 继续
      if (simState && simState.id === id) simState.startedAt = performance.now();
      useVoicePlayback.setState({ playing: true });
      startSimTimer(id);
    }
    return;
  }
  // 新播放：停掉其它音频/模拟播放（单实例）
  stopOtherAudio('voice-msg');
  teardown();
  simState = { id, dur, offset: 0, startedAt: performance.now() };
  useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  startSimTimer(id);
}

/** 语音气泡播放失败事件（Task 40）：宿主（微信/QQ/信息页）监听后用各自 toast 提示，
 *  播放器本体无 UI，保持解耦；同一失败不重复弹（3s 节流） */
export const VOICE_PLAY_ERROR_EVENT = 'chat-voice-play-error';
let lastVoiceErrAt = 0;
function emitVoicePlayError(message: string): void {
  try {
    const now = Date.now();
    if (now - lastVoiceErrAt < 3000) return; // 3s 节流，防连续点击连环弹
    lastVoiceErrAt = now;
    window.dispatchEvent(new CustomEvent(VOICE_PLAY_ERROR_EVENT, { detail: message }));
  } catch {
    // 忽略
  }
}

/** 开始/继续播放。src 为 dataURL（消息里持久化的音频） */
function startPlay(id: string, src: string, fromPause: boolean): void {
  const sameInstance = fromPause && audio !== null && currentId === id;
  if (!sameInstance) {
    // 新播放开始前停掉其它音频（TTS 朗读/静音模拟等）
    stopOtherAudio('voice-msg');
    teardown();
    audio = new Audio(src);
    currentId = id;
    currentUrl = src.startsWith('blob:') ? src : null; // dataURL 不需要 revoke
    useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  } else {
    useVoicePlayback.setState({ activeId: id, playing: true });
  }
  if (!audio) return;
  const a: HTMLAudioElement = audio;
  a.onended = () => stopVoicePlayback();
  a.onerror = () => {
    stopVoicePlayback();
    // Task 40：音频加载失败不再静默（进度动画无声走完是既往空洞）
    emitVoicePlayError('语音播放失败，请稍后重试');
  };
  clearTimer();
  timer = window.setInterval(() => {
    if (!audio || audio.paused || audio.ended) return;
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    useVoicePlayback.setState({ progress: d > 0 ? Math.min(1, audio.currentTime / d) : 0 });
  }, 100);
  void a.play().catch(() => {
    stopVoicePlayback();
    // Task 40：浏览器拦截/播放器异常时给出反馈
    emitVoicePlayError('语音播放失败，请稍后重试');
  });
}

/**
 * AI 语音消息：点击 → 用当前角色音色把 localText 实时朗读出来（真实出声）。
 * 覆盖两类气泡：新版内置通道的静音语音条（url=''、无 synth 标记、带 contactId）与
 * 历史存量 synth='builtin' 消息——只要配置了声音（内置语音免配置恒可用；配了第三方
 * 语音 API 则用 API 音色）点击播放都能出声（Task 33）。
 * - 再次点击 = 停止（TTS 无法真暂停，再次点击从头播）；
 * - 进度按估算时长推进（hold：到点悬在 98% 等真实播完收尾）；
 * - 引擎不可用/播放失败 → simState 保留，进度动画按静音模拟继续走完（不打断 UI）；
 * - speakUserTts 传 keepOthers：互斥已由本播放器 stopOtherAudio 完成，播放状态留给气泡 UI。
 */
function toggleContactTts(id: string, text: string, contactId: string | null): void {
  const st = useVoicePlayback.getState();
  if (st.activeId === id) {
    // 播放中/暂停挂起 → 停止（含语音引擎）
    stopVoicePlayback();
    return;
  }
  // 新播放：停掉其它音频（电话 TTS / 录音气泡 / 其它模拟播放）
  stopOtherAudio('voice-msg');
  stopVoicePlayback();
  activeContactTts = true;
  simState = { id, dur: estimateSpeakDuration(text), offset: 0, startedAt: performance.now(), hold: true };
  useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  startSimTimer(id);
  void (async () => {
    try {
      // 每次点击现场解析角色音色（角色独立音色 → 全局默认 → 内置默认声线；配了 API 用 API 合成），
      // 切音色/改配置后对历史语音气泡也立即生效
      await speakUserTts({
        text,
        contactId,
        keepOthers: true, // 播放状态归本播放器管，不能被互斥逻辑清掉
        onEnd: () => stopVoicePlayback(),
      });
    } catch (err) {
      // 引擎不可用/合成失败：保留已启动的进度动画（静音模拟兜底）+ 提示原因（Task 40）
      const msg = err instanceof Error && err.message ? err.message : '';
      emitVoicePlayError(voiceTtsFailText(msg));
    }
  })();
}

/** TTS 播放失败文案：从 speakUserTts 抛出的错误里取服务端友好文案，取不到用通用提示 */
function voiceTtsFailText(raw: string): string {
  const msg = String(raw || '');
  if (!msg.trim() || /^failed to fetch|networkerror|load failed/i.test(msg)) return '网络不稳定，语音播放失败';
  if (/timeout|超时/i.test(msg)) return '请求超时，语音播放失败';
  return msg.slice(0, 40);
}

/** 点击语音气泡的额外信息（AI 语音消息用） */
export interface VoiceToggleOptions {
  /** 'builtin' = 内置引擎实时朗读通道（历史存量 AI 语音消息） */
  synth?: 'builtin' | 'api';
  /** 发送该语音的联系人 id：非空 = AI 语音消息，点击用角色音色实时朗读（配置了声音即出声） */
  contactId?: string | null;
}

export const voicePlayer = {
  /** 点击语音气泡：空闲 → 播放；播放中 → 暂停；暂停中 → 继续。
   *  - 有音频文件（url 非空）→ 真实播放；
   *  - localText 非空且无音频（文字转语音消息/AI 静音语音条）→
   *    AI 消息（带 contactId 或 synth='builtin'）按角色音色实时朗读（真实出声）；
   *    我方的文字转语音消息（无 contactId）维持静音模拟：不出声、只走进度动画 */
  toggle(id: string, src: string, localText?: string | null, opts?: VoiceToggleOptions): void {
    if (localText && localText.trim() && !src) {
      const text = localText.trim();
      if (opts?.synth === 'builtin' || opts?.contactId) {
        toggleContactTts(id, text, opts.contactId ?? null);
        return;
      }
      toggleSim(id, estimateSpeakDuration(text));
      return;
    }
    const { activeId, playing } = useVoicePlayback.getState();
    if (activeId === id) {
      if (playing) {
        audio?.pause();
        useVoicePlayback.setState({ playing: false });
      } else {
        startPlay(id, src, true);
      }
      return;
    }
    startPlay(id, src, false);
  },
  /** 外部强停（如长按菜单动作时） */
  stop(): void {
    stopVoicePlayback();
  },
};

// 注册到全局音频焦点：TTS 朗读开始前会停掉这里的播放（含静音模拟）
registerAudioSource('voice-msg', () => stopVoicePlayback());
