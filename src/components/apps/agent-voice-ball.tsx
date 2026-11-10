'use client';

/**
 * C1 语音唤起智能体——Siri 式全屏语音会话 + 悬浮球（v1.7.1 专属人设）：
 *
 * - 悬浮球：屏幕右侧边缘可拖动（v1.9.14 简约毛玻璃：单层半透黑 + backdrop-blur +
 *   细白描边 + 白细线麦克风，去多层堆叠），拖动跟手、松手吸左右边、
 *   位置记忆（localStorage agent-voice-ball-pos-v1）；
 *   点按（位移 < 8px）打开全屏语音会话；连续唤醒监听开着时带一圈极细呼吸光环（提示「正在听」）
 * - 全屏会话（苹果 Siri 式）：黑玻璃背景 + 顶部彩虹光球 + 光球下方助手名牌（名字=
 *   唤醒名）+ 左上关闭 + 中部对话流（用户右侧气泡 / 助手左侧纯文本）+ 底部输入栏
 * - 双重职责（Siri 式闭环）：
 *   ① 闲聊/问答：经 agent-chat.voiceTurn 按专属人设「小灵」（assistant-persona，
 *      名字跟随唤醒名）直接回复，回复经共享 TTS 栈朗读出来；
 *   ② 任务/操作：voiceTurn 识别为 task → 收起会话 → runAgentTask 接管（进度条/急停
 *      由 AgentGlobalLayers 负责）→ 任务结束按追问设置重开会话播报结果（C4）；
 *   语音识别链（离线 → Web Speech → 云端）与连续唤醒循环全部沿用 v1.6.1。
 * - Siri 式开场（新会话）：应一声（assistant-persona 分时段随机问候）→ 朗读 →
 *   播完自动开录（应声→聆听闭环）；继续上次对话不重复问候
 * - 追问模式：语音来源任务结束 → 全屏会话自动重开（结果进对话流 + 15s 无操作自动收起，
 *   任意触摸重新计时）；期间点麦克风即可继续说，免喊唤醒名
 * - 连续对话（Siri 式一问一答，cfg.contChat 默认开）：会话内播报完自动续听进入下一轮
 *   （聊天回合收尾 resumeListening；任务终态追问播报完经 speakAgentResult onEnd 续听）；
 *   播报中用户开口即打断（barge-in：独立麦流 echoCancellation+noiseSuppression + 能量检测，
 *   超阈连续 ~250ms → stopSpeaking + 开录；TTS 前 600ms 起振保护防扬声器回声）；
 *   自动续听轮连续 2 次没听到 → 停止续听提示点麦克风/打字（防对着空气无限循环）；
 *   任务交接（直达动作/任务执行）已同步关会话，续听自然跳过；任务运行中不续听不 barge-in
 * - 显示门槛：APP 原生壳（受「AI 动手」总闸管）或网页端（悬浮球开关默认开即显示，
 *   喊唤醒名/点球都能唤起；真任务仍被原生闸拒绝并原样说明）+ 已解锁 +
 *   悬浮球开关 + 无 Agent 任务运行 + 无通话/来电
 *
 * 逻辑在 lib/ios/agent-voice.ts（识别/唤醒/播报）与 lib/ios/agent-chat.ts（聊天大脑），
 * 本组件只做状态编排与渲染。
 */

import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Plus, Square, X } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { useOfflineAsr } from '@/lib/ios/offline-asr';
import { getAutonomyConfig } from '@/lib/ios/shizuku-autonomy';
import { isNativePerception, requestMicPermission } from '@/lib/ios/native-perception';
import {
  useAgentVoice,
  useAgentRecorder,
  useAgentWakeLoop,
  useWakeDiag,
  canAgentWakeListen,
  canAgentVoiceActNow,
  canWakeVad,
  consumeAgentTaskVoiceOrigin,
  markAgentTaskVoiceOrigin,
  speakAgentResult,
  assistantVoiceId,
  vibrateSafely,
} from '@/lib/ios/agent-voice';
import { isSpeaking, isTtsConfigured, speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';
import { isWebSpeechSupported } from '@/lib/ios/web-speech';
import { voiceTurn } from '@/lib/ios/agent-chat';
import { assistantGreeting } from '@/lib/ios/assistant-persona';
import { matchOpenAppIntent, openAppPage } from '@/lib/ios/agent-app-nav';
import { matchWeatherIntent, runWeatherReport } from '@/lib/ios/agent-weather';

// Agent 运行状态探针：shizuku-agent 引擎体量大，不能静态打进本组件包体——
// 借道 agent-ui（PhoneShell 本就 dynamic 引它）订阅运行态，只回传一个轻量布尔
const AgentRunningProbe = dynamic(() => import('@/components/apps/agent-ui').then((m) => m.AgentRunningProbe), {
  ssr: false,
});

// ---------------- 常量 ----------------

const BALL_SIZE = 44;
/** 吸边后距屏幕左右边缘的间距 */
const BALL_EDGE = 6;
/** 球默认锚位（bottom 偏移，与 className 同步） */
const BALL_BOTTOM = 140;
/** 位置记忆键 */
const POS_KEY = 'agent-voice-ball-pos-v1';
/** 点按判定位移阈值（px） */
const TAP_SLOP = 8;
/** 会话内提示自动消退 */
const MSG_CLEAR_MS = 6000;
/** 追问模式自动收起（任务后自动重开的会话，无操作到点收起；任意触摸重新计时） */
const FOLLOWUP_AUTO_CLOSE_MS = 15000;

/** 连续对话防空气循环：自动续听轮连续没听到几次后停止（提示点麦克风/打字继续） */
const CONT_NOHEAR_MAX = 2;
/** barge-in 能量检测采样帧长（ms） */
const BARGE_FRAME_MS = 60;
/** barge-in 连续超阈帧数（4×60ms≈250ms：持续说话才触发，咳嗽/碰撞等瞬态不触发） */
const BARGE_ON_FRAMES = 4;
/** barge-in 能量 RMS 阈值（0~1，固定中等值）：echoCancellation 下 TTS 泄漏远低于此、
 *  人声易超过；可经 window.__ballDebug.bargeRms 现场调（调试口见组件尾部） */
const BARGE_RMS = 0.045;
/** barge-in 起振保护：TTS 开始后前 600ms 忽略能量（扬声器起振/首包延迟期防误触发） */
const BARGE_ONSET_IGNORE_MS = 600;

/** Siri 彩虹渐变（悬浮球环 + 会话光球共用色板：青→紫→粉→橙→黄→绿） */
const SIRI_CONIC =
  'conic-gradient(from 0deg, #6EE7F9, #A78BFA, #F472B6, #FB923C, #FDE047, #86EFAC, #22D3EE, #6EE7F9)';

/** 浏览器调试开关：localStorage agent-voice-debug=1 时在网页预览里也显示球/会话（仅聊天链路可用） */
function isVoiceDebug(): boolean {
  try {
    return window.localStorage.getItem('agent-voice-debug') === '1';
  } catch {
    return false;
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 读取记忆的球位置（懒初始化；组件 dynamic ssr:false，window 必然可用） */
function readBallPos(): { x: number; y: number } | null {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y };
  } catch {
    /* 坏数据回默认位 */
  }
  return null;
}

// ---------------- 会话数据 ----------------

interface SessionTurn {
  id: number;
  role: 'user' | 'agent';
  text: string;
}

export default function AgentVoiceBall() {
  // ---- 门槛状态 ----
  // 懒初始化（本组件 dynamic ssr:false，window 必然可用）：原生壳判定 + 浏览器调试开关
  const [native] = useState(() => isNativePerception() || isVoiceDebug());
  const cfg = useAgentVoice((s) => s.cfg);
  const wakeBlocked = useAgentVoice((s) => s.wakeBlocked);
  const asrReady = useOfflineAsr((s) => s.status === 'ready');
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const callActive = useUI((s) => s.callActive);
  const incomingCall = useIncomingCall((s) => s.call);

  // Agent 是否在跑：经探针订阅（engine 模块 dynamic 拉起，不进本组件包体）
  const [agentRunning, setAgentRunning] = useState(false);
  const agentRunningRef = useRef(false);
  const onRunningChange = useCallback((v: boolean) => {
    agentRunningRef.current = v;
    setAgentRunning(v);
  }, []);

  // autonomy 开关是纯 localStorage（无 store），1.2s 轮询兜出「设置页改完球即时消失」；
  // 网页端不受 autonomy 总闸管（layerOn 里恒 true，球显隐只由悬浮球开关控制）；调试模式免检
  const [autoOn, setAutoOn] = useState(false);
  useEffect(() => {
    if (!native) return undefined;
    const check = () => {
      if (isVoiceDebug()) {
        setAutoOn(true);
        return;
      }
      const c = getAutonomyConfig();
      setAutoOn(c.master && c.caps['agent'] === true);
    };
    check();
    const t = window.setInterval(check, 1200);
    return () => window.clearInterval(t);
  }, [native]);

  // 挂载级开关：APP 原生壳看 autonomy 总闸；网页端只看悬浮球开关（v90.1 起网页也出球，
  // 喊唤醒名/点球都能唤起——修复「叫名字没反应」：此前网页整层不挂载）
  const layerOn = cfg.ball && (native ? autoOn : true);
  // 瞬时隐藏（保持挂载：唤醒循环/探针不停，只是看不见）
  const visible = layerOn && !locked && !screenOff && !switcherOpen && !agentRunning && !callActive && !incomingCall;

  // ---- 会话状态 ----
  const [sessionOpen, setSessionOpen] = useState(false);
  const sessionOpenRef = useRef(false);
  useEffect(() => {
    sessionOpenRef.current = sessionOpen;
  }, [sessionOpen]);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const turnsRef = useRef<SessionTurn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  const turnIdRef = useRef(0);
  /** 会话内提示/错误（toast 式，自动消退） */
  const [sessionMsg, setSessionMsg] = useState('');
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const routingRef = useRef(false);
  const [inputDraft, setInputDraft] = useState('');
  const sessionMsgClearRef = useRef<number | null>(null);
  /** 连续对话：当前是否处于自动续听（UI 状态行用「聆听中…」，逻辑用 autoListenRef） */
  const [autoListenUi, setAutoListenUi] = useState(false);

  const appendTurn = useCallback((role: 'user' | 'agent', text: string): void => {
    const t = text.trim();
    if (!t) return;
    turnIdRef.current += 1;
    const turn: SessionTurn = { id: turnIdRef.current, role, text: t };
    setTurns((prev) => [...prev, turn]);
  }, []);

  const appendTurnRef = useRef(appendTurn);
  useEffect(() => {
    appendTurnRef.current = appendTurn;
  }, [appendTurn]);

  // 对话流自动滚到底（新消息/状态变化时；用户上翻时不强拉——以「距底 < 80px」为准）
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns, thinking, speaking, sessionMsg]);

  // 会话提示自动消退
  useEffect(() => {
    if (sessionMsgClearRef.current !== null) window.clearTimeout(sessionMsgClearRef.current);
    if (!sessionMsg) return undefined;
    sessionMsgClearRef.current = window.setTimeout(() => setSessionMsg(''), MSG_CLEAR_MS);
    return () => {
      if (sessionMsgClearRef.current !== null) window.clearTimeout(sessionMsgClearRef.current);
    };
  }, [sessionMsg]);

  // ---- 追问模式（C4，任务后免喊唤醒名继续说）----
  //
  // normal ──(语音来源任务结束，追问窗口开)──▶ followup（会话自动重开，结果进对话流）
  // followup ──(15s 无操作到点)──▶ normal（自动收起，恢复常规唤醒循环）
  // followup ──(任意触摸)──▶ 重新计时（视为仍在互动）
  // followup ──(用户执行新任务/点关闭)──▶ normal
  const [followup, setFollowup] = useState(false);
  const followupUntilRef = useRef(0);
  const [followupLeft, setFollowupLeft] = useState(FOLLOWUP_AUTO_CLOSE_MS);

  const clearFollowup = useCallback((): void => {
    followupUntilRef.current = 0;
    setFollowup(false);
    setFollowupLeft(FOLLOWUP_AUTO_CLOSE_MS);
  }, []);

  /** 触摸续期（追问模式下任意触摸把自动收起期限推后一个窗口） */
  const bumpFollowup = useCallback((): void => {
    if (!followupUntilRef.current) return;
    followupUntilRef.current = Date.now() + FOLLOWUP_AUTO_CLOSE_MS;
    setFollowupLeft(FOLLOWUP_AUTO_CLOSE_MS);
  }, []);

  // ---- 录音器（链路：离线 → Web Speech → 云端，见 agent-voice.ts） ----
  // 路由函数经 ref 透传（routeUtterance 声明在后；识别结果落地时取最新闭包）
  const routeRef = useRef<(t: string) => Promise<void> | void>(() => undefined);
  // 连续对话：续听开录实现（声明在后，经 ref 透传给 recorder onResult，照 routeRef 同款打破声明序）
  const resumeListeningRef = useRef<() => void>(() => undefined);
  /** 当前录音轮是否为「连续对话自动开录」（问候/续听 = true；用户手点 = false）：
   *  只有自动轮的空结果才走续听循环，防空气无限循环；用户说话命中即清零 */
  const autoListenRef = useRef(false);
  /** 自动轮连续「没听到」计数（连续 CONT_NOHEAR_MAX 次 → 停止自动续听） */
  const noHearStreakRef = useRef(0);
  /** 续听累计次数（window.__ballDebug 调试口观测用） */
  const resumeCountRef = useRef(0);
  const rec = useAgentRecorder({
    onResult: (r) => {
      if (r === null) {
        // 连续对话防空气循环：自动续听轮连续 2 次没听到 → 停止续听（提示点麦克风/打字继续），
        // 未到上限则自动再听一轮（Siri 式持续听，波形 UI 即续听态）；用户手点的轮维持原提示
        if (autoListenRef.current && sessionOpenRef.current && useAgentVoice.getState().cfg.contChat) {
          noHearStreakRef.current += 1;
          if (noHearStreakRef.current >= CONT_NOHEAR_MAX) {
            autoListenRef.current = false;
            noHearStreakRef.current = 0;
            setAutoListenUi(false);
            setSessionMsg('先说到这里，点麦克风或打字继续');
            return;
          }
          resumeListeningRef.current();
          return;
        }
        setSessionMsg('没听到有效内容，请再试一次或直接打字');
        return;
      }
      if (r.ok) {
        noHearStreakRef.current = 0; // 命中即重置：下一轮重新计数
        autoListenRef.current = false; // 本轮已进路由，是否续听由回合收尾决定
        setAutoListenUi(false);
        setSessionMsg('');
        void routeRef.current(r.text);
      } else {
        autoListenRef.current = false; // 识别链路报错不自动续听（避免错误无限循环）
        setAutoListenUi(false);
        setSessionMsg(r.error);
      }
    },
    onStartError: (msg) => setSessionMsg(msg),
  });
  const recRef = useRef(rec);
  useEffect(() => {
    recRef.current = rec;
  }, [rec]);

  // ---- 连续对话 ①：自动续听 ----
  // 调用点：聊天/打字回合收尾（routeUtterance finally，routingRef 清零后）与任务终态追问播报完
  // （speakAgentResult onEnd）。任务/直达动作收尾时已同步关会话（sessionOpenRef 同 tick 置 false），
  // 这里自然跳过；任务运行中（agentRunning）不续听。守卫全部用 ref/现场读，不依赖渲染时序。
  const resumeListening = useCallback((): void => {
    if (!sessionOpenRef.current || routingRef.current || agentRunningRef.current) return;
    if (!useAgentVoice.getState().cfg.contChat) return;
    if (recRef.current.phase !== 'idle') return; // 已在录/正在起录（如 barge-in 已先开）：不重复开
    autoListenRef.current = true;
    setAutoListenUi(true);
    resumeCountRef.current += 1;
    recRef.current.start();
  }, []);
  // 最新实现经 ref 透传（recorder onResult 声明在前拿不到闭包；照 routeRef 同款模式）
  useEffect(() => {
    resumeListeningRef.current = resumeListening;
  }, [resumeListening]);

  // ---- 会话开合 ----
  /** 开会话时跳过自动开录（追问重开/播报在放等场景；一次性，用后即清） */
  const skipAutoStartRef = useRef(false);

  // ---- 会话内 TTS（聊天回复朗读；共享 tts-client 栈，音色=助手音色（v1.8），未设则跟随语音 API 全局默认）----
  const speakInSession = useCallback(async (text: string): Promise<void> => {
    if (!isTtsConfigured()) return;
    stopSpeaking(); // 打断上一条未播完的播报（token 机制）
    setSpeaking(true);
    try {
      await speakUserTts({ text, voiceId: assistantVoiceId() || undefined });
    } catch {
      /* 合成失败静默：文字已在对话流里 */
    } finally {
      setSpeaking(false);
    }
  }, []);

  /** 直达动作前让会话「出现并可读」的最短停留：喊名唤起必须能看到全屏会话与自己说的话、
   *  以及助手的应答，之后才收起去切页/执行（修「喊名字全屏会话不出现/一闪而过」） */
  const SESSION_SHOW_MS = 1400;
  const sleepBrief = useCallback((): Promise<void> => new Promise<void>((r) => window.setTimeout(r, SESSION_SHOW_MS)), []);

  /** Siri 式开场：应一声（分时段随机问候）→ 朗读 → 播完自动开录（应声→聆听闭环）。
   *  仅在新会话（对话流为空）时用，继续上次对话不重复问候；TTS 未配置则立即开录。 */
  const greetOnOpen = useCallback(async (): Promise<void> => {
    const line = assistantGreeting();
    appendTurnRef.current('agent', line);
    await speakInSession(line);
    if (sessionOpenRef.current && !routingRef.current && recRef.current.phase === 'idle') {
      autoListenRef.current = true; // 问候后的开录算自动轮：空结果走续听循环
      setAutoListenUi(true);
      recRef.current.start();
    }
  }, [speakInSession]);

  const openSession = useCallback(
    (opts?: { autoRecord?: boolean; followupMode?: boolean; greet?: boolean }) => {
      // 开场问候时先不录（麦克风吃 TTS）：问候播完由 greetOnOpen 自动开录
      const willGreet = opts?.greet === true && turnsRef.current.length === 0;
      skipAutoStartRef.current = willGreet || opts?.autoRecord === false || isSpeaking();
      setSessionMsg('');
      setThinking(false);
      sessionOpenRef.current = true; // 同步置位：问候/续听守卫不等 commit（旧 ref 未同步时 TTS 未配置路径会漏开录）
      setSessionOpen(true);
      if (willGreet) void greetOnOpen();
      if (opts?.followupMode) {
        followupUntilRef.current = Date.now() + FOLLOWUP_AUTO_CLOSE_MS;
        setFollowupLeft(FOLLOWUP_AUTO_CLOSE_MS);
        setFollowup(true);
      }
    },
    [greetOnOpen],
  );

  const closeSession = useCallback((): void => {
    clearFollowup();
    sessionOpenRef.current = false; // 同步收口：续听/barge-in 守卫同 tick 内即见「已关」（不等 commit）
    setSessionOpen(false);
    setSessionMsg('');
    setThinking(false);
    setSpeaking(false);
    routingRef.current = false;
    autoListenRef.current = false;
    noHearStreakRef.current = 0;
    setAutoListenUi(false);
    recRef.current.cancel();
    stopSpeaking();
  }, [clearFollowup]);

  // 开会话自动开录（skipAutoStart 时跳过一次）；关会话收尾丢弃
  useEffect(() => {
    if (!sessionOpen) {
      recRef.current.cancel();
      return undefined;
    }
    if (skipAutoStartRef.current) {
      skipAutoStartRef.current = false;
      return undefined;
    }
    if (recRef.current.phase === 'idle') {
      autoListenRef.current = false; // 开会话自动开录（非续听轮）：空结果走原提示不循环
      recRef.current.start();
    }
    return undefined;
  }, [sessionOpen]);

  // ---- 任务执行（Siri → Agent 交接）----
  /** 执行任务：收起会话 → dynamic import 拉起 runAgentTask → 全局进度条接管；
   *  被能力闸/防重入拒绝（闸全部同步判定，promise 秒回）→ 重开会话把原因作为助手回复展示。
   *  追问模式随执行退出；上一条播报立即打断（TTS token 机制）；
   *  任务真正跑起来后标记「语音唤起来源」（终态播报/追问模式据此判定） */
  const execute = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text) return;
      vibrateSafely(18);
      recRef.current.cancel();
      clearFollowup();
      stopSpeaking();
      setSpeaking(false);
      setThinking(false);
      routingRef.current = false;
      autoListenRef.current = false; // 任务交接：退出连续对话循环（结果由追问模式收口）
      noHearStreakRef.current = 0;
      setAutoListenUi(false);
      sessionOpenRef.current = false; // 同步收口（同 closeSession）：防交接窗口内续听/barge-in 误触发
      setSessionOpen(false);
      setSessionMsg('');
      try {
        const { runAgentTask } = await import('@/lib/ios/shizuku-agent');
        // 「再试一次/继续/还是不行」这类模糊指代脱离会话就没法办：把最近对话一并交给
        // Agent 规划层（recentChat 注入 system prompt），LLM 才知道「再试」的是什么任务
        const recent = turnsRef.current
          .slice(-6)
          .map((t) => `${t.role === 'user' ? '机主' : '助手'}：${t.text}`)
          .join('\n');
        // 闸拒绝会在同一微任务链里返回；250ms 内有结果即视为被拒（真任务不可能秒完成）
        const running = runAgentTask(text, { ctx: recent ? { recentChat: recent } : undefined });
        const early = await Promise.race([
          running,
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 250)),
        ]);
        if (early === null) {
          // 任务真正跑起来了：标记「语音唤起来源」。（能力闸/防重入拒绝不会走到
          // runAgentTask 的 finally，提前标记会污染后续非语音任务）
          markAgentTaskVoiceOrigin();
        } else {
          // 被拒（或极端秒完成）：结果/原因作为助手回复进对话流并重开会话
          appendTurnRef.current('agent', early.text);
          setSessionOpen(true);
        }
      } catch (err) {
        appendTurnRef.current('agent', err instanceof Error ? err.message : '任务启动失败，请重试');
        setSessionOpen(true);
      }
    },
    [clearFollowup],
  );

  // ---- 语音回合路由（聊天/任务一体，见 agent-chat.ts）----
  const routeUtterance = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || routingRef.current) return;
      routingRef.current = true;
      recRef.current.cancel();
      vibrateSafely(12);
      appendTurnRef.current('user', text);
      // ---- 直达 ①：天气查询（v1.8，纯本地意图零 LLM 延迟）——查城市+写天气 App+朗读一步
      //      到位，修「查天气只开个天气 App 就没了」；「打开天气」（无地点、句首打开动词）
      //      不算查询，落到直达 ② 只开 App 不播报。
      //      喊名唤起时全屏会话必须先出现（用户看到自己说的话+助手应答，停 1.4s），
      //      再收起切进天气页——朗读走全局 TTS 栈，收会话后继续播完
      const openLead = /^(帮我打开|给我打开|打开|开启|启动|进入|切到|切换到)/.test(text);
      const wIntent = matchWeatherIntent(text);
      if (wIntent && (wIntent.location || !openLead)) {
        setThinking(true);
        const rep = await runWeatherReport(wIntent.location);
        setThinking(false);
        appendTurnRef.current('agent', rep.reply);
        if (rep.ok) {
          await sleepBrief(); // 会话可见停留（修喊名直达闪退）
          closeSession(); // App 窗口 z-40 在会话层下：先收会话再切页
          openAppPage('weather');
        }
        await speakInSession(rep.reply);
        return;
      }
      // ---- 直达 ②：纯打开意图（打开微信/淘宝…）——不进 LLM、不依赖 Shizuku 是否启动，
      //      直接切**网页内（本项目虚拟手机）**对应应用页面；真实手机应用不会被拉起。
      //      会话先出现应答（1.4s）再收起切页，朗读收会话后继续
      const nav = matchOpenAppIntent(text);
      if (nav) {
        const ok = openAppPage(nav.appId);
        const reply = ok ? `好嘞，${nav.label}打开啦~` : `现在不方便打开${nav.label}哦~`;
        appendTurnRef.current('agent', reply);
        if (ok) await sleepBrief();
        closeSession();
        await speakInSession(reply);
        return;
      }
      setThinking(true);
      try {
        const history = turnsRef.current
          .slice(-10)
          .filter((t) => t.text.length < 500)
          .map((t) => ({ role: t.role, text: t.text }));
        // 历史里去掉刚追加的这条 user（voiceTurn 的 user 消息由本回合文本承担）
        if (history.length > 0 && history[history.length - 1].role === 'user') history.pop();
        const r = await voiceTurn(text, history);
        if (r.mode === 'task') {
          // LLM 判成任务但其实是纯打开意图（改写后动词丢失等）：再兜一次网页内直达
          const nav2 = matchOpenAppIntent(r.task);
          if (nav2) {
            const ok = openAppPage(nav2.appId);
            const reply = ok ? `好嘞，${nav2.label}打开啦~` : `现在不方便打开${nav2.label}哦~`;
            setThinking(false);
            appendTurnRef.current('agent', reply);
            if (ok) await sleepBrief();
            closeSession();
            await speakInSession(reply);
            return;
          }
          await execute(r.task);
          return; // execute 内部已收尾（会话关闭/重开），不再回 idle 提示
        }
        appendTurnRef.current('agent', r.reply);
        setThinking(false); // 播报期间不占「思考中」：状态行显示正在说，麦克风可点（手动打断与 barge-in 同语义）
        await speakInSession(r.reply);
      } finally {
        setThinking(false);
        routingRef.current = false;
        // 连续对话：聊天/打字回合自然收尾 → 自动续听进入下一轮（任务/直达动作已同步关会话，这里自然跳过）
        resumeListening();
      }
    },
    [execute, speakInSession, closeSession, resumeListening],
  );
  // 识别结果落地 → 最新路由闭包（recorder 的 onResult 经 routeRef 透传）
  useEffect(() => {
    routeRef.current = routeUtterance;
  }, [routeUtterance]);

  // ---- 连续对话 ②：barge-in 播报打断 ----
  // speaking 期间挂轻量麦克风监听：独立 getUserMedia 流（必须 echoCancellation+noiseSuppression，
  // 否则扬声器里的 TTS 声会误触发）+ AudioContext + AnalyserNode 能量检测；
  // 超阈连续 BARGE_ON_FRAMES 帧（≈250ms）→ fireBargeIn（stopSpeaking + 转入聆听）。
  // 防 TTS 回声：TTS 开始后前 600ms 忽略能量（扬声器起振期）+ AEC 硬约束 + 持续超阈才触发。
  // 资源收口：停止播报/关会话/任务运行/组件卸载 → effect cleanup 立即停轨 + close(ctx)；
  // 无麦克风权限/设备占用 → 静默放弃 barge-in（播报照常播完，点麦克风仍可打断）。
  const bargeRef = useRef({ armed: false, triggered: 0, lastRms: 0 });
  /** barge-in 触发收口：打断 TTS → 立即开录（仅会话内；任务运行中不接） */
  const fireBargeIn = useCallback((): void => {
    stopSpeaking();
    setSpeaking(false); // 立即同步熄「正在说」态（播报 promise 随后 resolve，状态行不再矛盾）
    if (sessionOpenRef.current && recRef.current.phase === 'idle' && !agentRunningRef.current) {
      autoListenRef.current = true; // barge-in 转入的聆听算自动轮：空结果走续听循环
      setAutoListenUi(true);
      recRef.current.start();
    }
  }, []);
  useEffect(() => {
    // 不监听的条件：非播报中 / 会话已关 / 任务运行中 / 录音器已在录音（续听轮本身就在听）/
    // 环境无麦克风能力（静默放弃，不打扰播报）
    if (!speaking || !sessionOpen || agentRunning) return undefined;
    if (recRef.current.phase !== 'idle') return undefined;
    if (!navigator.mediaDevices?.getUserMedia) return undefined;
    let aborted = false;
    let timer: number | null = null;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    const release = (): void => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      try {
        stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      stream = null;
      try {
        void ctx?.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      ctx = null;
      bargeRef.current.armed = false;
    };
    bargeRef.current.armed = true;
    bargeRef.current.lastRms = 0;
    void (async (): Promise<void> => {
      try {
        // APK 原生壳：与唤醒/录音同款前置权限（已授予零开销直通；未授予弹系统框，授权后下次生效）
        if (isNativePerception()) {
          const mp = await requestMicPermission().catch(() => null);
          if (!mp || mp.granted !== true) {
            release();
            return;
          }
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (aborted) {
          release();
          return;
        }
        const w = window as Window & { webkitAudioContext?: typeof AudioContext };
        const Ctor = window.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) {
          release();
          return;
        }
        const c = new Ctor();
        void c.resume().catch(() => undefined);
        const analyser = c.createAnalyser();
        analyser.fftSize = 512;
        c.createMediaStreamSource(stream).connect(analyser);
        ctx = c;
        const buf = new Float32Array(analyser.fftSize);
        const onsetAt = performance.now(); // 起振保护起点（≈TTS 出声起点）
        let hot = 0;
        timer = window.setInterval(() => {
          if (aborted) return;
          if (performance.now() - onsetAt < BARGE_ONSET_IGNORE_MS) return; // 起振保护
          if (c.state !== 'running') {
            void c.resume().catch(() => undefined);
            return;
          }
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          bargeRef.current.lastRms = rms;
          // 阈值可经 window.__ballDebug.bargeRms 现场调（默认固定中等值，别过度工程）
          const dbg = (window as Window & { __ballDebug?: { bargeRms?: unknown } }).__ballDebug;
          const th = typeof dbg?.bargeRms === 'number' ? dbg.bargeRms : BARGE_RMS;
          hot = rms >= th ? hot + 1 : 0;
          if (hot >= BARGE_ON_FRAMES) {
            aborted = true;
            release(); // 先释放监听流再开录：避免两路争麦
            bargeRef.current.triggered += 1;
            fireBargeIn();
          }
        }, BARGE_FRAME_MS);
      } catch {
        release(); // 无权限/设备占用等：静默放弃 barge-in
      }
    })();
    return () => {
      aborted = true;
      release();
    };
  }, [speaking, sessionOpen, agentRunning, fireBargeIn]);

  // ---- 追问倒计时（followup && 会话开 && 全空闲才走表；任意触摸经 bumpFollowup 续期）----
  useEffect(() => {
    if (!followup || !sessionOpen) return undefined;
    if (thinking || speaking || rec.phase !== 'idle') return undefined;
    const tick = () => {
      const left = followupUntilRef.current - Date.now();
      if (left <= 0) {
        closeSession();
        return;
      }
      setFollowupLeft(left);
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [followup, sessionOpen, thinking, speaking, rec.phase, closeSession]);

  // ---- C4 任务终态播报 + 追问模式入口 ----
  const layerOnRef = useRef(layerOn);
  useEffect(() => {
    layerOnRef.current = layerOn;
  }, [layerOn]);
  const handleResultRef = useRef<(text: string) => void>(() => undefined);
  const onAgentFinished = (text: string) => {
    // 语音来源标记读后即清：本次终态是否属于「语音唤起启动的任务」
    const voiceOrigin = consumeAgentTaskVoiceOrigin();
    const cfgNow = useAgentVoice.getState().cfg;
    // ① 追问模式入口（闸门见上方状态机注释；开关关/闸门不过→直接回常规循环）
    if (voiceOrigin && cfgNow.followup && layerOnRef.current && canAgentVoiceActNow()) {
      appendTurnRef.current('agent', text);
      openSession({ autoRecord: false, followupMode: true });
    }
    // ② TTS 播报（内部再判 开关||语音来源、isTtsConfigured、闸门，不满足静默跳过）；
    //    播报完（或被打断/失败的收尾）且会话开着（追问窗口）→ 连续对话自动续听，
    //    优先级不变：仍是「播报完再听」，不抢在会话重开/播报之前
    speakAgentResult(text, {
      voiceOrigin,
      onEnd: () => resumeListeningRef.current(),
    });
  };
  useEffect(() => {
    handleResultRef.current = onAgentFinished;
  });
  // 注册终态播报钩子：dynamic import（不把引擎静态打进本组件包体）；卸载解绑。
  // 序号防竞态：StrictMode 双挂载时旧 cleanup 不得误清新一次注册
  const regSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++regSeqRef.current;
    let alive = true;
    void import('@/lib/ios/shizuku-agent').then((m) => {
      if (!alive || seq !== regSeqRef.current) return;
      m.setAgentResultAnnouncer((text: string) => handleResultRef.current(text));
    });
    return () => {
      alive = false;
      void import('@/lib/ios/shizuku-agent').then((m) => {
        if (seq === regSeqRef.current) m.setAgentResultAnnouncer(null);
      });
    };
  }, []);

  // ---- 连续唤醒监听 ----
  // 通道选择（useAgentWakeLoop 内）：① 离线引擎就绪 → 端侧分块转写；② Web Speech → 实时监听
  // （Google 不可达自动降级）；③ VAD 说话检测 + 服务端识别（免下载模型、不依赖 Google）。
  // 此处只判「至少一条通道可用」（组件 dynamic ssr:false，惰性初始化时 window 必可用）
  const [wsWakeOk] = useState(() => isWebSpeechSupported());
  const [vadOk] = useState(() => canWakeVad());
  const wakeOn = layerOn && cfg.listen && !wakeBlocked && (asrReady || wsWakeOk || vadOk);
  // 重试信号：设置页「重试」按钮 bump → 唤醒循环立即重建（清熔断/换通道）
  const retrySeq = useWakeDiag((s) => s.retrySeq);
  const onWake = useCallback(
    (task: string | null) => {
      setSessionMsg('');
      if (task) {
        appendTurnRef.current('user', task); // 一句话直达：先记进对话流再路由
        setSessionOpen(true);
        void routeUtterance(task);
      } else {
        // 只喊了名字 → 应一声（新会话问候，播完自动开录），等继续说
        openSession({ greet: true });
      }
    },
    [routeUtterance, openSession],
  );
  const canListen = useCallback(() => canAgentWakeListen(sessionOpenRef.current, agentRunningRef.current), []);
  // enabled 只随总启用态启停；锁屏/通话/会话打开等暂停条件由 canListen 每轮动态判断
  useAgentWakeLoop({ enabled: wakeOn, name: cfg.name, canListen, onWake, retrySignal: retrySeq });

  // ---- 悬浮球拖拽（framer-motion，吸边 + 位置记忆） ----
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readBallPos());
  const dragMovedRef = useRef(false);

  const persistPos = useCallback((p: { x: number; y: number }) => {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {
      /* 存储不可用仅本次会话生效 */
    }
  }, []);

  const onDragEnd = (info: { offset: { x: number; y: number } }) => {
    const lr = layerRef.current?.getBoundingClientRect();
    const base = pos ?? { x: BALL_EDGE, y: 0 };
    if (!lr || lr.width < BALL_SIZE || lr.height < BALL_SIZE) return;
    // y：上下留 6px 安全边；x：按球心在中线左侧/右侧吸附对应用边
    const yRange = lr.height - BALL_BOTTOM - BALL_SIZE - BALL_EDGE;
    const ny = clamp(base.y + info.offset.y, -yRange, yRange);
    const centerX = lr.width - BALL_SIZE + base.x + info.offset.x + BALL_SIZE / 2;
    const nx = centerX < lr.width / 2 ? -(lr.width - BALL_SIZE - BALL_EDGE) : BALL_EDGE;
    const next = { x: nx, y: ny };
    setPos(next);
    persistPos(next);
  };

  // ---- 动作 ----
  const openFromBall = useCallback(() => {
    clearFollowup(); // 手动开会话：不处于追问模式
    openSession({ greet: true });
    // 唤醒监听被熔断时点球给出可见原因（此前只藏设置页，用户不知道喊名为何没反应）
    const blocked = useAgentVoice.getState().wakeBlocked;
    if (blocked) setSessionMsg(blocked);
  }, [clearFollowup, openSession]);

  const toggleMic = useCallback(() => {
    bumpFollowup();
    // 手动接管：退出自动续听循环（下一轮回复播报完按开关重新续听）
    autoListenRef.current = false;
    noHearStreakRef.current = 0;
    setAutoListenUi(false);
    if (recRef.current.phase === 'recording' || recRef.current.phase === 'starting') {
      recRef.current.stop();
      return;
    }
    if (speaking) {
      stopSpeaking(); // 播报中点麦克风：先打断 TTS 再开录（barge-in 的手动同义路径）
      setSpeaking(false);
    }
    if (recRef.current.phase === 'idle' && !thinking) recRef.current.start();
  }, [bumpFollowup, speaking, thinking]);

  const clearTranscript = useCallback(() => {
    setTurns([]);
    turnIdRef.current = 0;
    setSessionMsg('已清空对话');
  }, []);

  // ---- 调试口（验完保留，供浏览器 E2E/真机排查连续对话状态机与 barge-in 建流/释流）----
  // window.__ballDebug：每次渲染同步快照；bargeRms 可写自定义阈值（检测循环每帧读取，
  // 这里只兜底初始化不覆盖用户设置）；bargeFire() 可无麦模拟一次打断（stopSpeaking+开录）
  useEffect(() => {
    const w = window as Window & { __ballDebug?: Record<string, unknown> };
    const d = (w.__ballDebug ??= {});
    d.sessionOpen = sessionOpen;
    d.thinking = thinking;
    d.speaking = speaking;
    d.recPhase = rec.phase;
    d.autoListen = autoListenRef.current;
    d.noHearStreak = noHearStreakRef.current;
    d.resumeCount = resumeCountRef.current;
    d.bargeArmed = bargeRef.current.armed;
    d.bargeTriggered = bargeRef.current.triggered;
    d.bargeLastRms = bargeRef.current.lastRms;
    if (typeof d.bargeRms !== 'number') d.bargeRms = BARGE_RMS;
    d.bargeFire = () => fireBargeIn();
  });

  if (!layerOn) return null;

  const listening = wakeOn && visible && !sessionOpen; // 呼吸光环：连续唤醒在听（会话开时不闪）
  const recBusy = rec.phase === 'starting' || rec.phase === 'recording';
  const showWave = recBusy && rec.levels.length > 0;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[57]"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
      data-testid="agent-voice-layer"
      data-agent-voice-layer=""
      data-suppress-edge-gesture
    >
      {/* 本组件专用动画/滚动条样式（类名唯一，不外泄） */}
      <style>{`@keyframes agentVoiceSpin{to{transform:rotate(360deg)}}@keyframes agentVoiceBreath{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.05);opacity:1}}.ph-voice-scroll{scrollbar-width:none;-ms-overflow-style:none}.ph-voice-scroll::-webkit-scrollbar{display:none}`}</style>

      {/* Agent 运行状态探针（dynamic 拉起 agent-ui → shizuku-agent；纯副作用不渲染内容） */}
      <AgentRunningProbe onChange={onRunningChange} />

      {/* ================= 全屏语音会话（Siri 式） ================= */}
      <AnimatePresence>
        {sessionOpen ? (
          <motion.div
            key="agent-voice-session"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            role="dialog"
            aria-label="语音助手会话"
            data-testid="agent-voice-session"
            className="pointer-events-auto absolute inset-0 z-[1] flex flex-col overflow-hidden bg-black/85 backdrop-blur-2xl"
            onPointerDown={bumpFollowup}
          >
            {/* 关闭（左上） */}
            <button
              type="button"
              aria-label="关闭语音会话"
              onClick={closeSession}
              data-testid="agent-voice-close"
              className="absolute left-4 top-[52px] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 backdrop-blur-md transition active:scale-95 active:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Siri 光球（极简版：环境柔光 + 慢旋柔化极光盘 + 白芯，无硬边；状态越忙呼吸越亮） */}
            <div className="pointer-events-none absolute left-1/2 top-[108px] h-[92px] w-[92px] -translate-x-1/2" aria-hidden="true">
              {/* 环境柔光（忙碌时呼吸） */}
              <div
                className="absolute -inset-4 rounded-full opacity-25 blur-xl"
                style={{ background: SIRI_CONIC, animation: recBusy || thinking || speaking ? 'agentVoiceBreath 1.8s ease-in-out infinite' : undefined }}
              />
              {/* 主体：圆盘内慢旋 aurora（blur 柔化，无硬边） */}
              <div className="absolute inset-0 overflow-hidden rounded-full ring-1 ring-white/10">
                <div
                  className="absolute -inset-[30%]"
                  style={{ background: SIRI_CONIC, filter: 'blur(16px)', opacity: 0.8, animation: 'agentVoiceSpin 16s linear infinite' }}
                />
                {/* 中心白芯（通透感） */}
                <div
                  className="absolute inset-[18%] rounded-full"
                  style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.5), rgba(255,255,255,0.08) 62%, transparent)' }}
                />
                {/* 顶部内高光（玻璃质感） */}
                <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgba(255,255,255,0.16), transparent 55%)' }} />
              </div>
            </div>

            {/* 助手名牌（光球正下方，Siri 呼出后的身份标识） */}
            <div className="pointer-events-none absolute inset-x-0 top-[210px] flex flex-col items-center gap-0.5" aria-hidden="true">
              <span className="text-[15px] font-medium tracking-wide text-white/85" data-testid="agent-voice-name">
                {cfg.name || '小灵'}
              </span>
              <span className="text-[11px] text-white/35">你的专属语音助手 · 能聊也能办</span>
            </div>

            {/* 对话流（用户右侧气泡 / 助手左侧纯文本，Siri 式） */}
            <div
              ref={transcriptRef}
              className="ph-voice-scroll absolute inset-x-5 bottom-[118px] top-[248px] flex flex-col gap-3.5 overflow-y-auto"
              data-testid="agent-voice-transcript"
            >
              {turns.length === 0 && !sessionMsg ? (
                <div className="mt-2 text-center text-[14px] leading-relaxed text-white/40">
                  问候、闲聊、提问都可以
                  <br />
                  要我做事直接说，比如「创建一个联系人，性格温柔」
                </div>
              ) : null}
              {turns.map((t) =>
                t.role === 'user' ? (
                  <div
                    key={t.id}
                    className="ml-auto max-w-[82%] whitespace-pre-wrap rounded-[22px] rounded-br-md bg-white/15 px-4 py-2.5 text-[15px] leading-relaxed text-white"
                  >
                    {t.text}
                  </div>
                ) : (
                  <div key={t.id} className="mr-auto max-w-[88%] whitespace-pre-wrap text-[15.5px] leading-[1.7] text-white/95">
                    {t.text}
                  </div>
                ),
              )}
              {/* 追问模式提示（C4） */}
              {followup ? (
                <div className="mx-auto rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] text-white/60" role="status" data-testid="agent-voice-followup-hint">
                  可直接继续说 · {Math.max(1, Math.ceil(followupLeft / 1000))}s 无操作自动收起
                </div>
              ) : null}
            </div>

            {/* 状态行（波形 / 识别中 / 思考中 / 朗读中 / 提示） */}
            <div className="pointer-events-none absolute inset-x-0 bottom-[92px] flex h-6 items-center justify-center gap-2" aria-live="polite">
              {showWave ? (
                <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
                  {rec.levels.slice(-16).map((v, i) => (
                    <span key={`${i}-${rec.levels.length}`} style={{ height: `${Math.max(4, v * 18)}px` }} className="w-[3px] rounded-full bg-white/85" />
                  ))}
                </span>
              ) : rec.phase === 'recognizing' ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-white/65">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> 识别中…
                </span>
              ) : thinking ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-white/65">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> 思考中…
                </span>
              ) : speaking ? (
                <span className="flex items-center gap-1 text-[12.5px] text-white/65" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-white/70"
                      style={{ height: '12px', animation: `agentVoiceBreath ${0.9 + i * 0.18}s ease-in-out infinite` }}
                    />
                  ))}
                  <span className="ml-1">正在说…</span>
                </span>
              ) : sessionMsg ? (
                <span className="max-w-[86%] truncate text-[12.5px] text-white/60" role="status" data-testid="agent-voice-msg">
                  {sessionMsg}
                </span>
              ) : recBusy ? (
                <span className="text-[12.5px] text-white/55">
                  {autoListenUi ? '聆听中…（说完自动停止）' : '请说出任务或想聊的…（说完自动停止）'}
                </span>
              ) : null}
            </div>

            {/* 底部输入栏（+ 清空 / 输入框 / 麦克风——iOS Siri 同布局） */}
            <form
              className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 px-4 pb-[20px] pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const t = inputDraft.trim();
                if (!t) return;
                setInputDraft('');
                void routeUtterance(t);
              }}
            >
              <button
                type="button"
                aria-label="清空对话"
                onClick={clearTranscript}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/90 backdrop-blur-md transition active:scale-95 active:bg-white/20"
              >
                <Plus className="h-5 w-5" />
              </button>
              <input
                value={inputDraft}
                onChange={(e) => setInputDraft(e.target.value)}
                placeholder={cfg.name ? `问${cfg.name}点什么，或直接下达任务` : '问点什么，或直接下达任务'}
                aria-label="问点什么，或直接下达任务"
                data-testid="agent-voice-input"
                className="h-11 min-w-0 flex-1 rounded-full bg-white/10 px-4 text-[15px] text-white outline-none ring-1 ring-white/10 backdrop-blur-md placeholder:text-white/40 focus:ring-white/25"
              />
              <button
                type="button"
                aria-label={recBusy ? '停止录音' : '开始录音'}
                onClick={toggleMic}
                disabled={thinking}
                data-testid="agent-voice-mic"
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95 disabled:opacity-40 ${
                  recBusy ? 'bg-[#FF453A] shadow-[0_6px_18px_rgba(255,69,58,0.45)]' : 'bg-white/10 backdrop-blur-md active:bg-white/20'
                }`}
              >
                {recBusy ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
              </button>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ================= 悬浮球（v1.9.14 简约毛玻璃，可拖动吸边） =================
          设计语言：单层中性磨砂玻璃圆片（半透黑 + backdrop-blur + 细白描边 + 柔和落影），
          去掉 v1.9.13 的渐变描边圈/双层内高光/径向反光等多层堆叠——极简「毛玻璃」，
          白色细线麦克风浮在玻璃上；状态表达仍是两个：连续唤醒监听中（单圈呼吸光环）与
          唤醒熔断（右上 ALERT 点） */}
      <motion.button
        type="button"
        aria-label="语音助手（拖动移位，点按说话）"
        drag
        dragConstraints={layerRef}
        dragElastic={0.12}
        dragMomentum={false}
        whileTap={{ scale: 0.92 }}
        onPointerDown={() => {
          dragMovedRef.current = false;
        }}
        onPointerUp={() => {
          if (!dragMovedRef.current) openFromBall(); // 位移阈值内视为点按
        }}
        onDrag={(_e, info) => {
          if (Math.abs(info.offset.x) > TAP_SLOP || Math.abs(info.offset.y) > TAP_SLOP) dragMovedRef.current = true;
        }}
        onDragEnd={(_e, info) => onDragEnd(info)}
        animate={pos ? { x: pos.x, y: pos.y } : undefined}
        transition={{ duration: 0.16 }}
        style={{ visibility: sessionOpen ? 'hidden' : 'visible' }}
        className="pointer-events-auto absolute bottom-[140px] right-0 flex h-[44px] w-[44px] touch-none select-none items-center justify-center rounded-full"
        data-testid="agent-voice-ball"
      >
        {/* 呼吸光环（连续唤醒监听中）：单圈细白线慢呼吸，「正在听」的安静提示 */}
        {listening ? (
          <span
            aria-hidden="true"
            className="absolute -inset-[5px] rounded-full ring-1 ring-white/30"
            style={{ animation: 'agentVoiceBreath 2.8s ease-in-out infinite' }}
          />
        ) : null}
        {/* 唤醒熔断提示点（唯一状态点）：喊名唤醒因麦克风权限等原因停用时点亮，点球看原因 */}
        {wakeBlocked ? (
          <span
            aria-hidden="true"
            data-testid="agent-voice-ball-alert"
            className="absolute right-[3px] top-[3px] z-10 h-2 w-2 rounded-full bg-[#FF453A] ring-[1.5px] ring-black/45"
          />
        ) : null}
        {/* 球体：单层毛玻璃——中性半透黑 + 大半径 backdrop-blur + 细白描边，内壁一线微光 */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-black/35 ring-1 ring-white/35 backdrop-blur-2xl"
          style={{ boxShadow: '0 4px 14px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.14)' }}
        />
        <Mic className="relative h-[17px] w-[17px] text-white/90" strokeWidth={1.8} />
      </motion.button>
    </div>
  );
}
