'use client';

/**
 * 语音录制交互（微信 / QQ / 信息 / 两端群聊共用）：
 * - useVoiceRecorder：MediaRecorder 录音（mime 能力探测 + 24kbps opus），AnalyserNode 实时振幅采样，
 *   60 秒上限自动结束；结束回调 onResult(result, zone) —— result 为 null 表示太短/已取消
 * - 按住标志（多任务误触修复）：beginVoiceHold/endVoiceHold 维护模块级计数，PhoneShell 底部
 *   边缘上滑手势读到 isVoiceHoldActive() 即中止 —— 「按住 说话」胶囊就在边缘带内，录音时
 *   上滑取消不再把多任务卡片拉起来（实现抽到 lib/ios/voice-hold-flag 微模块：
 *   PhoneShell 只引那几行，不再把整个录音组件拖进首屏 bundle）
 * - VoiceHoldBar：微信/信息输入区「按住 说话」胶囊。按住开录，setPointerCapture + touch-none
 *   保证手指划出仍持续跟踪、不被浏览器滚动认领；分区判定（所见即所得优先）：
 *   滑到浮层「取消 / 滑到这里 转文字」视觉目标上直接命中（data-voice-target），
 *   未命中时右滑 → 转文字、明显上滑/左滑 → 取消，原松开 → 发送
 * - QqVoicePanel / QqVoiceHoldButton：QQ 风语音面板（参考 QQ App：工具栏下方展开
 *   「按住说话」+ 大圆麦克风 + 变声/对讲/录音页签）。大圆钮按住开录且**原位不动**（原位光环）：
 *   录音时**计时+两侧波形贴在面板内大圆钮正上方**；左「文」/右「×」圆钮也在面板内大圆钮两侧
 *   （不浮层不白幕，消息区全程可见）；滑向「文」→ 转文字、滑向「×」/上滑 → 取消，原松开 → 发送
 * - RecordOverlayWx：微信风录音浮层 —— 暗幕 + 绿色气泡实时波形（屏幕中部偏下）+ 底部「取消 / 滑到这里 转文字」
 *   + 浅色「松开 发送」条
 * - useSttPreview / SttPreviewOverlay：「划到转文字」松开后先识别再预览，结果**可编辑**，用户决定发送文字 /
 *   发送语音（原始录音）/ 取消，不再直接发送
 * - Web Speech API 实时识别（sttConfig.webSpeech 开启且浏览器支持时）：按住录音期间并行跑
 *   SpeechRecognition，「划到转文字」松手即得文本秒出预览（不请求 /api/stt）；浮层实时展示增量文字；
 *   原松开直发的语音自动附带实时转写（AI 直接读到语音内容）；不支持/失败时录音照常，
 *   App 层回退服务端识别（内置识别模型已移除，仅在配置了 OpenAI 兼容 STT 时可用）
 * - 权限被拒/不支持录音：onStartError 提示，仍可继续用文字聊天
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic } from 'lucide-react';
// 按住录音标志实现抽到微模块（性能：PhoneShell 只引微模块，不把整个录音组件拖进首屏包）；
// 本组件转发这些 API 保持既有调用点兼容
import { beginVoiceHold, endVoiceHold } from '@/lib/ios/voice-hold-flag';
import { downsampleWave, pickRecorderMime } from '@/lib/ios/audio-utils';
import { transcribeAudioBlob } from '@/lib/ios/stt-client';
import { stopVoicePlayback } from '@/lib/ios/voice-player';
import { useSettings } from '@/lib/ios/store';
import { isWebSpeechSupported, startWebSpeechSession, type WebSpeechSession } from '@/lib/ios/web-speech';

export interface VoiceRecordResult {
  blob: Blob;
  /** 秒（≥1，四舍五入） */
  duration: number;
  /** 气泡静态波形（22 根，0~1） */
  wave: number[];
  /** Web Speech API 实时识别文本（录音期间浏览器内置识别；仅「划到转文字」时附带，可能为空/缺省） */
  transcript?: string;
}

export type VoiceRecordZone = 'cancel' | 'stt' | null;

/** 按住手势移动上下文：指针屏幕坐标 + 相对按下点的位移 */
export interface VoiceHoldPoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/**
 * 指针是否「划向」浮层手势目标（data-voice-target）：
 * ① 指针进入目标矩形（含少量容差）→ 命中；
 * ② 指针位于「按下点 → 目标中心」的走廊内（斜滑路径上的中间点也算）→ 命中，
 *    途中不再被垂直分量抢先判成取消（修复「划到转文字却显示取消」），
 *    同时走廊宽度收窄，正常上滑取消（偏离走廊）不受影响。
 */
function hitVoiceTarget(p: VoiceHoldPoint, kind: 'stt' | 'cancel'): boolean {
  const el = document.querySelector(`[data-voice-target="${kind}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (p.x >= r.left - 10 && p.x <= r.right + 10 && p.y >= r.top - 10 && p.y <= r.bottom + 10) return true;
  // 走廊判定：按下点 = 当前位置 - 位移
  const sx = p.x - p.dx;
  const sy = p.y - p.dy;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const vx = cx - sx;
  const vy = cy - sy;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1) return false;
  let t = ((p.x - sx) * vx + (p.y - sy) * vy) / len2;
  if (t < 0.25) return false; // 还没离开按下点一段距离：不视为划向目标
  t = Math.min(t, 1);
  const dist = Math.hypot(p.x - (sx + vx * t), p.y - (sy + vy * t));
  return dist <= 26;
}

export interface VoiceRecorder {
  phase: 'idle' | 'starting' | 'recording';
  /** 录音已进行秒数（浮点，100ms 刷新） */
  seconds: number;
  /** 实时振幅采样（约每 100ms 一个，0~1） */
  levels: number[];
  /** 手势目标区：null=原松开发送 / cancel=取消 / stt=转文字 */
  zone: VoiceRecordZone;
  setZone: (z: VoiceRecordZone) => void;
  /** Web Speech 实时识别的增量文本（「划到转文字」分区时展示；未开启/不支持时恒为空） */
  partial: string;
  start: () => void;
  finish: () => void;
}

const WAVE_BARS = 22;
const MAX_SEC = 60;
const MIN_SEC = 0.7;

/* ───────────────────────── 按住录音标志（供 PhoneShell 屏蔽多任务手势） ───────────────────────── */

export { isVoiceHoldActive } from '@/lib/ios/voice-hold-flag';

/** 按住标志接线：down 时 begin，up/cancel/卸载时 end（防重复、防泄漏） */
function useHoldFlag() {
  const flagRef = useRef(false);
  useEffect(
    () => () => {
      if (flagRef.current) {
        flagRef.current = false;
        endVoiceHold();
      }
    },
    [],
  );
  return {
    begin: () => {
      if (!flagRef.current) {
        flagRef.current = true;
        beginVoiceHold();
      }
    },
    end: () => {
      if (flagRef.current) {
        flagRef.current = false;
        endVoiceHold();
      }
    },
  };
}

/* ───────────────────────── 录音器 ───────────────────────── */

export function useVoiceRecorder(opts: {
  /** 结束回调：result=null 表示太短或取消；zone 告知手势去向 */
  onResult: (result: VoiceRecordResult | null, zone: VoiceRecordZone) => void;
  /** 开始失败（权限被拒/不支持）提示文案回调 */
  onStartError: (msg: string) => void;
}): VoiceRecorder {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [zone, setZoneState] = useState<VoiceRecordZone>(null);
  const [partial, setPartial] = useState('');

  const optsRef = useRef(opts);
  // 回调经 ref 透传（避免 useVoiceRecorder 返回的函数随 onResult 身份变化重建）
  useEffect(() => {
    optsRef.current = opts;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('');
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBufRef = useRef<number[]>([]);
  const lastSampleRef = useRef(0);
  const startRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const phaseRef = useRef<'idle' | 'starting' | 'recording'>('idle');
  const zoneRef = useRef<VoiceRecordZone>(null);
  const stopRequestedRef = useRef(false);
  const deadRef = useRef(false);
  const speechRef = useRef<WebSpeechSession | null>(null);
  const partialRef = useRef('');

  const setPhaseSafe = (p: 'idle' | 'starting' | 'recording') => {
    phaseRef.current = p;
    setPhase(p);
  };
  const setZoneSafe = useCallback((z: VoiceRecordZone) => {
    zoneRef.current = z;
    setZoneState(z);
  }, []);

  const cleanupCapture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
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

  // 卸载时若还在录音：静默丢弃
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

  const finalize = useCallback(
    (discard: boolean) => {
      const rec = recRef.current;
      const elapsed = (performance.now() - startRef.current) / 1000;
      const z = zoneRef.current;
      recRef.current = null;
      const speech = speechRef.current;
      speechRef.current = null;
      cleanupCapture();
      setPhaseSafe('idle');
      setZoneSafe(null);
      setSeconds(0);
      setLevels([]);
      setPartial('');
      partialRef.current = '';
      if (discard || !rec || elapsed < MIN_SEC) {
        // 太短：只有「原松开」才提示，取消手势静默
        speech?.abort();
        chunksRef.current = [];
        if (!discard && z === null) optsRef.current.onResult(null, null);
        return;
      }
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (chunks.length === 0) {
        speech?.abort();
        optsRef.current.onResult(null, z);
        return;
      }
      // #43：Safari 录音实际是 'audio/mp4'，原兜底 'audio/webm' 会让 Safari 录音 blob 失去正确 MIME。
      // 探测失败（mimeRef 不含 audio）时按浏览器分支兜底：Safari/WebKit → 'audio/mp4'，其他 → 'audio/webm'
      const fallbackMime = (() => {
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const isSafari = /^((?!chrome|android).)*safari/i.test(ua) || /AppleWebKit/i.test(ua) && !/Chrome/i.test(ua);
        return isSafari ? 'audio/mp4' : 'audio/webm';
      })();
      const blob = new Blob(chunks, { type: mimeRef.current.includes('audio') ? mimeRef.current : fallbackMime });
      const result: VoiceRecordResult = {
        blob,
        // 时长钳制到 60s 上限：极端场景（后台页 timer 节流致自动停止延迟触发）下不超上限
        duration: Math.max(1, Math.min(MAX_SEC, Math.round(elapsed))),
        wave: downsampleWave(levelBufRef.current, WAVE_BARS),
      };
      if (z === 'stt' && speech) {
        // 「划到转文字」：等实时识别收尾（≤800ms），拿到文本直接秒出预览（不再请求服务端）
        void speech
          .stop()
          .then((liveText) => {
            const transcript = liveText.trim();
            optsRef.current.onResult(transcript ? { ...result, transcript } : result, z);
          })
          .catch(() => optsRef.current.onResult(result, z));
        return;
      }
      // 原松开发送：附带 Web Speech 实时转写（AI 能直接读到语音内容；失败照常发纯语音，App 层会补识别）
      // 取消：不需要文本，后台静默收尾
      if (z === null) {
        if (!speech) {
          optsRef.current.onResult(result, null);
          return;
        }
        void speech
          .stop()
          .then((liveText) => {
            const transcript = liveText.trim();
            optsRef.current.onResult(transcript ? { ...result, transcript } : result, null);
          })
          .catch(() => optsRef.current.onResult(result, null));
        return;
      }
      void speech?.stop();
      optsRef.current.onResult(result, z);
    },
    [cleanupCapture, setZoneSafe],
  );

  const start = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    // 录音前停掉在播的语音气泡/TTS，避免回声
    stopVoicePlayback();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      optsRef.current.onStartError('当前浏览器不支持录音');
      return;
    }
    stopRequestedRef.current = false;
    // Web Speech API 实时识别（设置开启且浏览器支持时）：在指针手势调用栈内同步启动（Safari 要求
    // 用户手势上下文），与 MediaRecorder 并行共用麦克风；失败/不支持返回 null，静默走服务端兜底
    partialRef.current = '';
    setPartial('');
    speechRef.current?.abort();
    speechRef.current = null;
    const sttCfg = useSettings.getState().sttConfig;
    if (sttCfg.webSpeech && isWebSpeechSupported()) {
      speechRef.current = startWebSpeechSession({
        onPartial: (t) => {
          partialRef.current = t;
          setPartial(t);
        },
      });
    }
    setPhaseSafe('starting');
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (phaseRef.current !== 'starting' || deadRef.current) {
          // 等权限期间已卸载/取消
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
            optsRef.current.onStartError('当前浏览器不支持录音');
            return;
          }
        }
        chunksRef.current = [];
        levelBufRef.current = [];
        lastSampleRef.current = 0;
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onstop = () => finalize(false);
        rec.start(200);
        recRef.current = rec;

        // 实时振幅采样（overlay 波形动画 + 气泡静态波形）
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
          // 采样失败不影响录音本身
        }

        startRef.current = performance.now();
        setSeconds(0);
        setPhaseSafe('recording');
        timerRef.current = window.setInterval(() => {
          const sec = (performance.now() - startRef.current) / 1000;
          setSeconds(sec);
          // 每 ~100ms 采一个 RMS
          const analyser = analyserRef.current;
          if (analyser && performance.now() - lastSampleRef.current > 100) {
            lastSampleRef.current = performance.now();
            const buf = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const d = (buf[i] - 128) / 128;
              sum += d * d;
            }
            const rms = Math.sqrt(sum / buf.length);
            levelBufRef.current.push(Math.max(0.08, Math.min(1, rms * 3.2)));
            setLevels(levelBufRef.current.slice(-160));
          }
          if (sec >= MAX_SEC) {
            // 60 秒上限：自动结束并发送（与松开同路径，走 onstop → finalize）
            const cur = recRef.current;
            if (cur && cur.state !== 'inactive') {
              try {
                cur.stop();
              } catch {
                finalize(false);
              }
            }
          }
        }, 100);
        // 按住期间就松手（getUserMedia 等待中）：进入录音后立刻结束
        if (stopRequestedRef.current) finalize(false);
      })
      .catch((err: unknown) => {
        // 启动失败（权限拒绝 / 构造或启动录音器异常）：释放可能已取得的媒体流与录音器，避免麦克风占用泄漏
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
          optsRef.current.onStartError('无法使用麦克风：请在浏览器设置中允许录音权限');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          optsRef.current.onStartError('未找到可用麦克风');
        } else {
          optsRef.current.onStartError('无法访问麦克风，请检查权限设置');
        }
      });
  }, [cleanupCapture, finalize]);

  const finish = useCallback(() => {
    if (phaseRef.current === 'starting') {
      // 还在等权限/启动：标记，等真正开始录音后立即结束
      stopRequestedRef.current = true;
      return;
    }
    if (phaseRef.current !== 'recording') return;
    const rec = recRef.current;
    if (!rec) return;
    try {
      if (rec.state !== 'inactive') rec.stop();
      else finalize(false);
    } catch {
      finalize(false);
    }
  }, [finalize]);

  return { phase, seconds, levels, zone, setZone: setZoneSafe, partial, start, finish };
}

/* ───────────────────────── 按住手势（微信/信息胶囊 + QQ 大圆钮） ───────────────────────── */

/** 按住手势通用接线：down 起录 + 标志，move 更新区，up/cancel 收尾 */
function useHoldGesture(rec: VoiceRecorder, applyZone: (p: VoiceHoldPoint) => void) {
  const startPt = useRef({ x: 0, y: 0 });
  const flag = useHoldFlag();
  const holding = rec.phase !== 'idle';

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    startPt.current = { x: e.clientX, y: e.clientY };
    flag.begin();
    rec.setZone(null);
    rec.start();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holding) return;
    applyZone({
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - startPt.current.x,
      dy: e.clientY - startPt.current.y,
    });
  };
  const onPointerUp = () => {
    if (!holding) return;
    flag.end();
    rec.finish();
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** 「按住 说话」胶囊（微信/信息）：按住开录；上滑/左滑取消，右滑转文字，松开发送 */
export function VoiceHoldBar({
  rec,
  testId = 'voice-hold-bar',
  glass = false,
}: {
  rec: VoiceRecorder;
  testId?: string;
  /** 液态玻璃主题（微信 2-a）：常态底改半透玻璃胶囊（lg-input）；取消/转文字反馈色不变。
   *  默认 false —— 其他端（信息/QQ/群聊）不受影响，默认视觉像素级不变 */
  glass?: boolean;
}) {
  const holding = rec.phase !== 'idle';
  // 分区判定（优先级从高到低）：
  // ① 几乎垂直的上滑 → 取消（最先判：上滑取消不会被右侧目标走廊拦截）；
  // ② 划向浮层「转文字」目标（矩形/走廊命中）→ 转文字；
  // ③ 滑到「取消」胶囊上 → 取消；
  // ④ 未命中时按方位兑底：右滑 → 转文字，明显上滑/左滑 → 取消，原松开 → 发送
  const applyZone = (p: VoiceHoldPoint) => {
    const adx = Math.abs(p.dx);
    const ady = Math.abs(p.dy);
    if (p.dy < -70 && adx < 24) {
      rec.setZone('cancel');
      return;
    }
    if (hitVoiceTarget(p, 'stt')) {
      rec.setZone('stt');
      return;
    }
    if (hitVoiceTarget(p, 'cancel')) {
      rec.setZone('cancel');
      return;
    }
    if (p.dy < -70 && ady > adx) rec.setZone('cancel'); // 明显上滑 → 取消
    else if (p.dx > 60) rec.setZone('stt'); // 右滑 → 转文字
    else if (p.dx < -60) rec.setZone('cancel'); // 左滑 → 取消
    else rec.setZone(null);
  };
  const g = useHoldGesture(rec, applyZone);

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={holding ? '正在录音，松开发送，上滑取消，右滑转文字' : '按住说话'}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`h-[36px] min-w-0 flex-1 touch-none select-none text-center text-[16px] leading-[36px] transition-colors ${
        rec.zone === 'cancel'
          ? 'rounded-[5px] bg-[#FA5151] text-white'
          : rec.zone === 'stt'
            ? 'rounded-[5px] bg-[#07C160] text-white'
            : glass
              ? 'lg-input rounded-full text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              : 'rounded-[5px] bg-white text-black active:bg-black/[0.04] dark:bg-[#232323] dark:text-white dark:active:bg-white/[0.06]'
      }`}
    >
      {rec.phase === 'starting' ? '准备中…' : holding ? '松开 发送' : '按住 说话'}
    </button>
  );
}

/** QQ 大圆麦克风钮：按住开录；左滑 → 「文」转文字，右滑/上滑 → 「×」取消，松开发送（无外圈光环） */
export function QqVoiceHoldButton({
  rec,
  testId = 'qq-voice-hold',
}: {
  rec: VoiceRecorder;
  testId?: string;
}) {
  const holding = rec.phase !== 'idle';
  // 分区判定（同 VoiceHoldBar，方向镜像）：① 几乎垂直上滑 → 取消；② 划向浮层「文」→ 转文字；
  // ③ 滑到「×」→ 取消；④ 兑底：左滑 → 转文字，明显上滑/右滑 → 取消
  const applyZone = (p: VoiceHoldPoint) => {
    const adx = Math.abs(p.dx);
    const ady = Math.abs(p.dy);
    if (p.dy < -70 && adx < 24) {
      rec.setZone('cancel');
      return;
    }
    if (hitVoiceTarget(p, 'stt')) {
      rec.setZone('stt');
      return;
    }
    if (hitVoiceTarget(p, 'cancel')) {
      rec.setZone('cancel');
      return;
    }
    if (p.dy < -70 && ady > adx) rec.setZone('cancel'); // 明显上滑 → 取消
    else if (p.dx < -60) rec.setZone('stt'); // 左滑 → 「文」转文字
    else if (p.dx > 60) rec.setZone('cancel'); // 右滑 → 取消
    else rec.setZone(null);
  };
  const g = useHoldGesture(rec, applyZone);

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={holding ? '正在录音，松开发送，左滑转文字，右滑取消' : '按住说话'}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className="relative grid h-[112px] w-[112px] touch-none select-none place-items-center rounded-full bg-gradient-to-b from-[#3AA0FF] to-[#1374F0] shadow-[0_10px_36px_rgba(31,143,255,0.45)] transition-transform active:scale-[0.97]"
    >
      <Mic className="h-12 w-12 text-white" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** QQ 语音面板（工具栏下方展开）：「按住说话」+ 大圆麦克风 + 变声/对讲/录音页签（装饰）
 *  录音时全部在面板内：计时+两侧波形贴大圆钮正上方；左「文」（转文字）/右「×」（取消）在大圆钮两侧；
 *  不再弹白幕浮层，消息区全程可见（QQ App 原生体验）。
 *  液态玻璃（liquid，单聊传入）：面板换乳白强模糊玻璃（lg-sheet）；群聊等调用点不传保持默认白底 */
export function QqVoicePanel({
  rec,
  holdTestId = 'qq-voice-hold',
  liquid = false,
}: {
  rec: VoiceRecorder;
  holdTestId?: string;
  liquid?: boolean;
}) {
  const holding = rec.phase !== 'idle';
  const recording = rec.phase === 'recording';
  const cancel = rec.zone === 'cancel';
  const stt = rec.zone === 'stt';
  const bars = rec.levels.slice(-7);
  while (bars.length < 7) bars.unshift(0.08);
  const rightBars = [...bars].reverse();
  return (
    <div
      className={
        liquid
          ? /* 液态玻璃（用户指定）：去实底白，乳白强模糊玻璃面板（.dark 变体 CSS 内建） */
            'lg-sheet relative z-10 mx-2.5 mb-2.5 flex h-[290px] shrink-0 select-none flex-col items-center rounded-[28px] pb-3'
          : 'relative z-10 flex h-[290px] shrink-0 select-none flex-col items-center bg-white pb-3 dark:bg-[#1B1C1F]'
      }
      data-testid="qq-voice-panel"
    >
      {/* 顶部提示：录音时隐藏（计时/波形条绝对定位在同一高度，不挤动布局）；
          划到「文」且 Web Speech 已出文字时，同位置改为实时识别文字 */}
      <p
        className={`mt-4 truncate px-8 text-[17px] text-black/40 dark:text-white/40 ${
          recording && !(stt && rec.partial) ? 'invisible' : ''
        }`}
        data-testid={recording && stt && rec.partial ? 'qq-live-partial' : undefined}
      >
        {recording ? (stt ? rec.partial : '') : rec.phase === 'starting' ? '准备中…' : '按住说话'}
      </p>
      {/* 录音条：计时+波形贴在原位大圆钮正上方（面板内；面板 relative 已定位，大圆钮布局不受影响） */}
      {recording && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-[44px] flex h-[30px] items-center justify-center"
          data-testid="qq-record-strip"
        >
          {bars.map((v, i) => (
            <span
              key={`l${i}`}
              className="w-[3px] rounded-full bg-black/25 transition-[height] duration-150 ease-out dark:bg-white/35"
              style={{ height: `${Math.max(3, v * 20)}px` }}
            />
          ))}
          <span
            className="mx-3 min-w-[56px] text-center text-[19px] font-light tabular-nums text-black/75 dark:text-white/75"
            data-testid="voice-record-timer"
          >
            {timeLabelOf(rec.seconds)}
          </span>
          {rightBars.map((v, i) => (
            <span
              key={`r${i}`}
              className="w-[3px] rounded-full bg-black/25 transition-[height] duration-150 ease-out dark:bg-white/35"
              style={{ height: `${Math.max(3, v * 20)}px` }}
            />
          ))}
        </div>
      )}
      {/* 中部：左「文」（转文字）+ 大圆麦克风 + 右「×」（取消）——全部在面板内、彼此远离；
          未按住时两侧隐藏但占位，大圆钮始终居中不跳；标 data-voice-target 供手势命中判定 */}
      <div className="flex flex-1 items-center justify-center gap-9">
        <span className="grid h-[64px] w-[64px] shrink-0 place-items-center">
          <span
            data-voice-target="stt"
            data-testid="qq-panel-stt"
            aria-hidden={!holding}
            className={`grid h-[58px] w-[58px] place-items-center rounded-full text-[19px] transition-all duration-150 ${
              holding ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            } ${
              stt
                ? 'bg-[#0099FF] text-white shadow-[0_6px_18px_rgba(0,153,255,0.4)]'
                : 'bg-[#F2F3F5] text-black/70 dark:bg-white/10 dark:text-white/80'
            }`}
          >
            文
          </span>
        </span>
        <QqVoiceHoldButton rec={rec} testId={holdTestId} />
        <span className="grid h-[64px] w-[64px] shrink-0 place-items-center">
          <span
            data-voice-target="cancel"
            data-testid="qq-panel-cancel"
            aria-hidden={!holding}
            className={`grid h-[58px] w-[58px] place-items-center rounded-full text-[20px] transition-all duration-150 ${
              holding ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
            } ${
              cancel
                ? 'bg-[#FA5151] text-white shadow-[0_6px_18px_rgba(250,81,81,0.4)]'
                : 'bg-[#F2F3F5] text-black/70 dark:bg-white/10 dark:text-white/80'
            }`}
          >
            ✕
          </span>
        </span>
      </div>
      {/* 松开提示行（固定高度防布局跳动） */}
      <p className="h-[22px] text-[14px] text-black/40 dark:text-white/40" data-testid="qq-record-hint">
        {holding ? (cancel ? '松开 取消' : stt ? '松开 转文字' : '松开 发送') : ''}
      </p>
      <div className="flex w-full items-center justify-center gap-14 text-[15px]">
        <span className="text-black/30 dark:text-white/30">变声</span>
        <span className="font-medium text-black/85 dark:text-white/85">对讲</span>
        <span className="text-black/30 dark:text-white/30">录音</span>
      </div>
    </div>
  );
}

/* ───────────────────────── 「划到转文字」识别预览（松开后不再直接发送） ───────────────────────── */

function timeLabelOf(seconds: number): string {
  const sec = Math.floor(seconds);
  return `0:${String(Math.min(59, sec)).padStart(2, '0')}`;
}

/** 微信风录音浮层：暗幕 + 录音气泡实时波形 + 底部「取消 / 滑到这里 转文字」+ 浅色「松开 发送」条
 *  波形美化：更密的采样条 + 高度过渡平滑 morph + 两端渐隐 + 柔和投影
 *  theme：'wx' = 微信绿气泡（默认）；'im' = 信息/iMessage 蓝气泡（信息 App 按住说话用） */
export function RecordOverlayWx({ rec, theme = 'wx' }: { rec: VoiceRecorder; theme?: 'wx' | 'im' }) {
  if (rec.phase === 'idle') return null;
  const cancel = rec.zone === 'cancel';
  const stt = rec.zone === 'stt';
  const bars = rec.levels.slice(-30);
  while (bars.length < 30) bars.unshift(0.08);
  const im = theme === 'im';
  const bubbleCls = cancel ? 'bg-[#FA5151]' : im ? 'bg-[#0A84FF]' : 'bg-[#95EC69]';
  const barCls = cancel ? 'bg-white/90' : im ? 'bg-white/95' : 'bg-[#3CA135]/90';
  const tailCls = cancel ? 'border-t-[#FA5151]' : im ? 'border-t-[#0A84FF]' : 'border-t-[#95EC69]';
  return (
    <div
      data-testid="voice-record-overlay"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center bg-black/75"
    >
      {/* 顶部占位（与底部 5:2）：把录音气泡压到屏幕中部，不再贴顶 */}
      <div className="min-h-0 flex-[5]" />
      {/* 录音气泡（转文字/取消时变色）+ 下指尾巴 */}
      <div className="relative">
        <div
          className={`flex h-[92px] items-center justify-center gap-[2.5px] overflow-hidden rounded-[20px] px-6 shadow-[0_18px_50px_rgba(0,0,0,0.4)] transition-colors ${bubbleCls}`}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={`w-[3.5px] rounded-full transition-[height] duration-150 ease-out ${barCls}`}
              style={{
                height: `${Math.max(5, v * 58)}px`,
                // 两端渐隐：首尾采样条透明度更低，波形更柔和（与微信录音浮层一致）
                opacity: 0.4 + 0.6 * Math.min(1, Math.min(i, bars.length - 1 - i) / 6),
              }}
            />
          ))}
        </div>
        <span
          className={`absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent transition-colors ${tailCls}`}
        />
      </div>
      {/* 计时 */}
      <p className="mt-5 text-[16px] tabular-nums text-white/80" data-testid="voice-record-timer">
        {timeLabelOf(rec.seconds)}
      </p>
      {/* 实时识别文字（划到转文字时展示，Web Speech API；固定高度防布局跳动） */}
      <p
        className="mt-1 h-[20px] max-w-[72%] truncate px-6 text-center text-[13px] leading-[20px] text-white/70"
        data-testid="voice-live-partial"
      >
        {stt ? rec.partial : ''}
      </p>
      <div className="min-h-0 flex-[2]" />
      {/* 底部手势提示区（手势仍在按住的胶囊上，纯视觉；标 data-voice-target 供手势目标命中判定） */}
      <div className="mt-auto flex w-full items-end justify-between px-6 pb-[84px]">
        <span
          data-voice-target="cancel"
          className={`rounded-full px-5 py-2 text-[15px] transition-colors ${
            cancel ? 'bg-white text-[#FA5151]' : 'bg-white/15 text-white/80'
          }`}
        >
          取消
        </span>
        <span
          data-voice-target="stt"
          className={`rounded-full px-5 py-2 text-[15px] transition-colors ${
            stt ? 'bg-white text-[#07C160]' : 'bg-white/15 text-white/80'
          }`}
        >
          滑到这里 转文字
        </span>
      </div>
      {/* 浅色「松开 发送」条（模拟输入区位置） */}
      <div className="flex h-[58px] w-full items-center justify-center bg-[#EDEDED]/95 dark:bg-[#2C2C2C]/95">
        <span className="text-[16px] text-black/85 dark:text-white/85">
          {cancel ? '松开 取消' : stt ? '松开 转文字' : '松开 发送'}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── 「划到转文字」识别预览（松开后不再直接发送） ───────────────────────── */

/** 预览状态：识别中 / 已出文字 / 识别失败（录音 blob 随状态保留，供「发送语音」用原始录音） */
export interface SttPreviewState {
  status: 'pending' | 'done' | 'failed';
  text: string;
  clip: VoiceRecordResult;
}

/**
 * 转文字预览流程：open(clip) → 识别 → 显示文字 → 用户决定：
 * - 发送文字：走各端正常文字发送链路（onSendText）；识别结果**可编辑**（setText）后再发
 * - 发送语音：原始录音照语音气泡发送（onSendVoice，不重新合成）
 * - 取消：整条丢弃
 */
export function useSttPreview(opts: {
  onSendText: (text: string) => void;
  onSendVoice: (clip: VoiceRecordResult) => void;
}) {
  const [state, setState] = useState<SttPreviewState | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const stateRef = useRef<SttPreviewState | null>(null);
  const seqRef = useRef(0);

  const apply = useCallback((next: SttPreviewState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const open = useCallback(
    (clip: VoiceRecordResult) => {
      seqRef.current += 1;
      const seq = seqRef.current;
      // Web Speech API 已在录音期间实时识别：直接出结果（可编辑），不再请求服务端
      const live = (clip.transcript ?? '').trim();
      if (live) {
        apply({ status: 'done', text: live, clip });
        return;
      }
      apply({ status: 'pending', text: '', clip });
      void transcribeAudioBlob(clip.blob)
        .then((text) => {
          if (seqRef.current !== seq) return; // 期间已取消/重开：丢弃过期结果
          apply(text ? { status: 'done', text, clip } : { status: 'failed', text: '', clip });
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          apply({ status: 'failed', text: '', clip });
        });
    },
    [apply],
  );

  const close = useCallback(() => {
    seqRef.current += 1;
    apply(null);
  }, [apply]);

  /** 编辑识别结果（发送前可改文字） */
  const setText = useCallback(
    (text: string) => {
      const st = stateRef.current;
      if (st) apply({ ...st, text });
    },
    [apply],
  );

  const sendText = useCallback(() => {
    const st = stateRef.current;
    close();
    if (st && st.status === 'done' && st.text) optsRef.current.onSendText(st.text);
  }, [close]);

  const sendVoice = useCallback(() => {
    const st = stateRef.current;
    close();
    if (!st) return;
    // 预览确认过的识别文字并入语音消息（transcript）：AI 直接读到内容，长按「转文字」也无需再识别
    const transcript = st.status === 'done' ? st.text.trim() : '';
    optsRef.current.onSendVoice(transcript ? { ...st.clip, transcript } : st.clip);
  }, [close]);

  return { state, open, close, sendText, sendVoice, setText };
}

/** 转文字预览弹层：识别中转圈 / 结果**可编辑**（textarea，发送前可改文字）；失败仍可「发送语音」保住录音；accent 按各端主题色 */
export function SttPreviewOverlay({
  state,
  accent = '#07C160',
  onCancel,
  onSendText,
  onSendVoice,
  onChangeText,
}: {
  state: SttPreviewState;
  /** 各端主题色（微信绿 / QQ 蓝 / 信息蓝） */
  accent?: string;
  onCancel: () => void;
  onSendText: () => void;
  onSendVoice: () => void;
  /** 编辑识别结果（textarea onChange） */
  onChangeText?: (text: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 px-7" data-testid="stt-preview">
      <div className="w-full max-w-[300px] rounded-[16px] bg-white p-4 shadow-2xl dark:bg-[#2A2C31]">
        <p className="text-center text-[16px] font-medium text-black/85 dark:text-white/90">转文字</p>
        {state.status === 'pending' ? (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="stt-preview-pending">
            <Loader2 className="h-7 w-7 animate-spin text-black/35 dark:text-white/35" aria-hidden="true" />
            <p className="text-[14px] text-black/45 dark:text-white/45">识别中…</p>
          </div>
        ) : state.status === 'failed' ? (
          <div className="py-6 text-center" data-testid="stt-preview-failed">
            <p className="text-[14px] text-[#FA5151]">转文字失败，请重试</p>
            <p className="mt-1.5 text-[12px] text-black/40 dark:text-white/40">仍可发送语音，或取消丢弃</p>
          </div>
        ) : (
          <div className="mt-3">
            <textarea
              data-testid="stt-preview-text"
              value={state.text}
              onChange={(e) => onChangeText?.(e.target.value)}
              rows={4}
              aria-label="识别结果（可编辑）"
              placeholder="识别结果"
              className="block max-h-[180px] min-h-[88px] w-full resize-none overflow-y-auto rounded-[10px] bg-black/[0.04] p-3 text-[15px] leading-[1.5] text-black/85 outline-none placeholder:text-black/30 focus:ring-1 focus:ring-black/10 dark:bg-white/[0.06] dark:text-white/90 dark:placeholder:text-white/30 dark:focus:ring-white/15"
            />
            <p className="mt-1.5 text-[12px] text-black/35 dark:text-white/35">识别结果可编辑，修改后再发送</p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2.5">
          <button
            type="button"
            data-testid="stt-preview-cancel"
            onClick={onCancel}
            className="h-11 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] text-black/60 active:opacity-70 dark:bg-white/[0.08] dark:text-white/60"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="stt-preview-send-voice"
            onClick={onSendVoice}
            className="h-11 flex-1 rounded-[10px] text-[15px] font-medium active:opacity-80"
            style={{ backgroundColor: `${accent}1A`, color: accent }}
          >
            发送语音
          </button>
          {state.status === 'done' && (
            <button
              type="button"
              data-testid="stt-preview-send-text"
              onClick={onSendText}
              className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:opacity-80"
              style={{ backgroundColor: accent }}
            >
              发送文字
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
