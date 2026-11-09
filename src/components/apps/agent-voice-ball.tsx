'use client';

/**
 * C1 语音唤起智能体——Siri 式全屏语音会话 + 悬浮球（v1.7.1 专属人设）：
 *
 * - 悬浮球：屏幕右侧边缘可拖动（Siri 彩虹渐变环 + 深色玻璃 + 麦克风），拖动跟手、
 *   松手吸左右边、位置记忆（localStorage agent-voice-ball-pos-v1）；点按（位移 < 8px）
 *   打开全屏语音会话；连续唤醒监听开着时带一圈呼吸光环（提示「正在听」）
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
 * - 显示门槛：APP 原生壳（浏览器可用 agent-voice-debug=1 调试预览，仅聊天/路由可用，
 *   真任务仍被原生闸拒绝并原样说明）+ 已解锁 + 「AI 动手」总开关 + 智能体能力 +
 *   悬浮球开关（默认开）+ 无 Agent 任务运行 + 无通话/来电
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
import { isNativePerception } from '@/lib/ios/native-perception';
import {
  useAgentVoice,
  useAgentRecorder,
  useAgentWakeLoop,
  canAgentWakeListen,
  canAgentVoiceActNow,
  consumeAgentTaskVoiceOrigin,
  markAgentTaskVoiceOrigin,
  speakAgentResult,
  vibrateSafely,
} from '@/lib/ios/agent-voice';
import { isSpeaking, isTtsConfigured, speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';
import { voiceTurn } from '@/lib/ios/agent-chat';
import { assistantGreeting } from '@/lib/ios/assistant-persona';
import { matchOpenAppIntent, openAppPage } from '@/lib/ios/agent-app-nav';

// Agent 运行状态探针：shizuku-agent 引擎体量大，不能静态打进本组件包体——
// 借道 agent-ui（PhoneShell 本就 dynamic 引它）订阅运行态，只回传一个轻量布尔
const AgentRunningProbe = dynamic(() => import('@/components/apps/agent-ui').then((m) => m.AgentRunningProbe), {
  ssr: false,
});

// ---------------- 常量 ----------------

const BALL_SIZE = 48;
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
  // 调试模式下免检（网页预览没有 autonomy 面板数据）
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

  // 挂载级开关：全关时整层卸载零开销（浏览器预览 native=false 恒卸载）
  const layerOn = native && cfg.ball && autoOn;
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
  const rec = useAgentRecorder({
    onResult: (r) => {
      if (r === null) {
        setSessionMsg('没听到有效内容，请再试一次或直接打字');
        return;
      }
      if (r.ok) {
        setSessionMsg('');
        void routeRef.current(r.text);
      } else {
        setSessionMsg(r.error);
      }
    },
    onStartError: (msg) => setSessionMsg(msg),
  });
  const recRef = useRef(rec);
  useEffect(() => {
    recRef.current = rec;
  }, [rec]);

  // ---- 会话开合 ----
  /** 开会话时跳过自动开录（追问重开/播报在放等场景；一次性，用后即清） */
  const skipAutoStartRef = useRef(false);

  // ---- 会话内 TTS（聊天回复朗读；共享 tts-client 栈）----
  const speakInSession = useCallback(async (text: string): Promise<void> => {
    if (!isTtsConfigured()) return;
    stopSpeaking(); // 打断上一条未播完的播报（token 机制）
    setSpeaking(true);
    try {
      await speakUserTts({ text });
    } catch {
      /* 合成失败静默：文字已在对话流里 */
    } finally {
      setSpeaking(false);
    }
  }, []);

  /** Siri 式开场：应一声（分时段随机问候）→ 朗读 → 播完自动开录（应声→聆听闭环）。
   *  仅在新会话（对话流为空）时用，继续上次对话不重复问候；TTS 未配置则立即开录。 */
  const greetOnOpen = useCallback(async (): Promise<void> => {
    const line = assistantGreeting();
    appendTurnRef.current('agent', line);
    await speakInSession(line);
    if (sessionOpenRef.current && !routingRef.current && recRef.current.phase === 'idle') {
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
    setSessionOpen(false);
    setSessionMsg('');
    setThinking(false);
    setSpeaking(false);
    routingRef.current = false;
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
    if (recRef.current.phase === 'idle') recRef.current.start();
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
      setSessionOpen(false);
      setSessionMsg('');
      try {
        const { runAgentTask } = await import('@/lib/ios/shizuku-agent');
        // 闸拒绝会在同一微任务链里返回；250ms 内有结果即视为被拒（真任务不可能秒完成）
        const running = runAgentTask(text);
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
          // 「打开微信」类纯打开意图：不走 Agent（不依赖 Shizuku 是否启动），
          // 直接切到**网页内（本项目虚拟手机）**的对应应用页面——真实手机微信/淘宝不会被拉起
          const nav = matchOpenAppIntent(r.task) ?? matchOpenAppIntent(text);
          if (nav) {
            const ok = openAppPage(nav.appId); // App 窗口 z-40 在会话层下，先收会话再切页
            const reply = ok ? `好嘞，${nav.label}打开啦~` : `现在不方便打开${nav.label}哦~`;
            setThinking(false);
            closeSession();
            appendTurnRef.current('agent', reply); // 会话流保留记录，下次打开可见
            await speakInSession(reply);
            return;
          }
          await execute(r.task);
          return; // execute 内部已收尾（会话关闭/重开），不再回 idle 提示
        }
        appendTurnRef.current('agent', r.reply);
        await speakInSession(r.reply);
      } finally {
        setThinking(false);
        routingRef.current = false;
      }
    },
    [execute, speakInSession, closeSession],
  );
  // 识别结果落地 → 最新路由闭包（recorder 的 onResult 经 routeRef 透传）
  useEffect(() => {
    routeRef.current = routeUtterance;
  }, [routeUtterance]);

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
    // ② TTS 播报（内部再判 开关||语音来源、isTtsConfigured、闸门，不满足静默跳过）
    speakAgentResult(text, { voiceOrigin });
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
  const wakeOn = layerOn && cfg.listen && asrReady && !wakeBlocked;
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
  useAgentWakeLoop({ enabled: wakeOn, name: cfg.name, canListen, onWake });

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
  }, [clearFollowup, openSession]);

  const toggleMic = useCallback(() => {
    bumpFollowup();
    if (recRef.current.phase === 'recording' || recRef.current.phase === 'starting') {
      recRef.current.stop();
      return;
    }
    if (speaking) {
      stopSpeaking(); // 播报中点麦克风：先打断 TTS 再开录
      setSpeaking(false);
    }
    if (recRef.current.phase === 'idle' && !thinking) recRef.current.start();
  }, [bumpFollowup, speaking, thinking]);

  const clearTranscript = useCallback(() => {
    setTurns([]);
    turnIdRef.current = 0;
    setSessionMsg('已清空对话');
  }, []);

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
                <span className="text-[12.5px] text-white/55">请说出任务或想聊的…（说完自动停止）</span>
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

      {/* ================= 悬浮球（Siri 渐变环 + 深色玻璃，可拖动吸边） ================= */}
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
        className="pointer-events-auto absolute bottom-[140px] right-0 flex h-[48px] w-[48px] touch-none select-none items-center justify-center rounded-full"
        data-testid="agent-voice-ball"
      >
        {/* 呼吸光环（连续唤醒监听中） */}
        {listening ? (
          <span aria-hidden="true" className="absolute inset-[-4px] animate-ping rounded-full bg-white/25" style={{ animationDuration: '2.4s' }} />
        ) : null}
        {/* 柔和彩虹外发光 */}
        <span aria-hidden="true" className="absolute -inset-[5px] rounded-full opacity-55 blur-md" style={{ background: SIRI_CONIC }} />
        {/* 旋转彩虹环 */}
        <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ background: SIRI_CONIC, animation: 'agentVoiceSpin 7s linear infinite' }} />
        {/* 深色玻璃主体 */}
        <span aria-hidden="true" className="absolute inset-[2.5px] rounded-full bg-[#0B0B10]/90 backdrop-blur-xl ring-1 ring-white/10" />
        {/* 内缘高光（玻璃质感） */}
        <span
          aria-hidden="true"
          className="absolute inset-[2.5px] rounded-full"
          style={{ background: 'radial-gradient(120% 90% at 30% 18%, rgba(255,255,255,0.22), transparent 42%)' }}
        />
        <Mic className="relative h-[18px] w-[18px] text-white" />
      </motion.button>
    </div>
  );
}
