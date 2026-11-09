'use client';

/**
 * C1 语音唤起智能体——悬浮球 + 语音面板（真 Siri 式体验）：
 *
 * - 悬浮球：屏幕右侧边缘可拖动（毛玻璃 + 麦克风图标），拖动跟手、松手吸左右边、
 *   位置记忆（localStorage agent-voice-ball-pos-v1）；点按（位移 < 8px）展开语音面板；
 *   连续唤醒监听开着时带一圈呼吸光环（提示「正在听」）
 * - 显示门槛（全部满足才显示）：APP 原生壳 + 已解锁 + 「AI 动手」总开关 +
 *   「智能体多步任务」能力 + 悬浮球开关（默认开）+ 无 Agent 任务运行 + 无通话；
 *   浏览器网页预览一律不显示（Agent 只能在 APP 真机跑）
 * - 语音面板：展开即录音（静默 1.4s 自动停 / 手动停 / 30s 上限）→ 识别 →
 *   可编辑确认卡（改错字 +「将由智能体接管手机执行」提示）→ 执行；
 *   执行经 dynamic import 拉起 runAgentTask（进度条/急停由 AgentGlobalLayers 接管），
 *   被能力闸/防重入拒绝时重开面板用中文说明原因；打字输入框兜底永远存在
 * - 连续唤醒：喊出唤醒名（默认「小灵」）震动唤起；一句话（去唤醒名 ≥4 字）直达确认卡
 * - C4 任务终态播报 + 追问模式：挂载时经 dynamic import 注册终态播报钩子
 *   （setAgentResultAnnouncer，避免把引擎静态打进本组件包体）——语音唤起启动的任务
 *   结束后：①按开关/来源用共享 TTS 栈播报结果摘要（Siri 式闭环）；
 *   ②面板重开进「追问模式」（倒计时 10s，见下方状态机注释），期间录音免喊唤醒名
 *
 * 逻辑全在 lib/ios/agent-voice.ts，本组件只做状态编排与渲染。
 */

import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Sparkles, Square, X } from 'lucide-react';
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
import { stopSpeaking } from '@/lib/ios/tts-client';

// Agent 运行状态探针：shizuku-agent 引擎体量大，不能静态打进本组件——
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
/** 拒绝原因 toast 自动消退 */
const MSG_CLEAR_MS = 6000;
/** 追问模式窗口（C4）：任务结束后面板保持展开供直接追问的时长 */
const FOLLOWUP_WINDOW_MS = 10000;

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

export default function AgentVoiceBall() {
  // ---- 门槛状态 ----
  // 懒初始化（本组件 dynamic ssr:false，window 必然可用）：原生壳判定不需要 effect 二次 setState
  const [native] = useState(() => isNativePerception());
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

  // autonomy 开关是纯 localStorage（无 store），1.2s 轮询兜出「设置页改完球即时消失」
  const [autoOn, setAutoOn] = useState(false);
  useEffect(() => {
    if (!native) return undefined;
    const check = () => {
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

  // ---- 面板状态 ----
  const [panelOpen, setPanelOpen] = useState(false);
  /** 确认卡文本；null = 未进确认卡 */
  const [confirmText, setConfirmText] = useState<string | null>(null);
  /** 面板内提示/错误（toast 式，自动消退） */
  const [panelMsg, setPanelMsg] = useState('');
  /** 拒绝重开等场景跳过「开面板自动开录」 */
  const skipAutoStartRef = useRef(false);
  const panelOpenRef = useRef(false);
  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);
  // 面板提示自动消退
  useEffect(() => {
    if (!panelMsg) return undefined;
    const t = window.setTimeout(() => setPanelMsg(''), MSG_CLEAR_MS);
    return () => window.clearTimeout(t);
  }, [panelMsg]);

  // ---- 追问模式状态机（C4，任务后免喊唤醒名直接追问）----
  //
  // normal ──(语音来源任务结束，追问窗口开)──▶ followup
  // followup ──(倒计时 10s 到点 / 用户点关闭/背板)──▶ normal（关面板，恢复常规唤醒循环）
  // followup ──(用户开录/确认卡出现)──▶ 倒计时暂停（视为已响应；执行/取消后随面板流转）
  // followup ──(用户执行新任务)──▶ normal（面板收起；新任务结束且语音来源时再进 followup）
  //
  // 进入闸门（在 onAgentFinished 里判）：语音来源任务 && cfg.followup && layerOn &&
  // canAgentVoiceActNow()（无锁屏/熄屏/多任务/通话/来电/页面隐藏/其它音频在放）；
  // 任务刚结束不算「执行中」。追问期间面板不自动开录（结果播报可能正在放，避免麦克风吃 TTS），
  // 用户点麦克风后走既有录音→确认卡→执行链路（录音本身就不需要唤醒名，
  // 唤醒名只用于后台唤醒循环——追问期间唤醒循环因面板打开而自然暂停）。
  const [followup, setFollowup] = useState(false);
  /** 倒计时剩余毫秒（展示用；绝对期限在 followupUntilRef） */
  const [followupLeft, setFollowupLeft] = useState(FOLLOWUP_WINDOW_MS);
  const followupUntilRef = useRef(0);

  /** 退出追问模式（仅清状态不关面板：执行/录音动作等场景面板继续用） */
  const clearFollowup = useCallback(() => {
    followupUntilRef.current = 0;
    setFollowup(false);
    setFollowupLeft(FOLLOWUP_WINDOW_MS);
  }, []);

  /** 进入追问模式：面板重开展开 + 10s 倒计时；不自动开录（skipAutoStart） */
  const enterFollowup = useCallback(() => {
    skipAutoStartRef.current = true; // 结果播报可能正在放：不自动开录，避免麦克风吃 TTS
    setPanelMsg('');
    setConfirmText(null);
    setPanelOpen(true);
    followupUntilRef.current = Date.now() + FOLLOWUP_WINDOW_MS;
    setFollowupLeft(FOLLOWUP_WINDOW_MS);
    setFollowup(true);
  }, []);

  // ---- C4 任务终态播报 + 追问模式入口 ----
  // 终态回调经 ref 透传最新逻辑（shizuku-agent 只持一个稳定蹦床，避免闭包过期）；
  // 悬浮球层启用态经 ref 同步（终态瞬间可能还没有一次重渲染）
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
      enterFollowup();
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

  // ---- 录音器（链路：离线 → Web Speech → 云端，见 agent-voice.ts） ----
  const rec = useAgentRecorder({
    onResult: (r) => {
      if (r === null) {
        setPanelMsg('没听到有效内容，请再试一次或直接打字');
        return;
      }
      if (r.ok) {
        setPanelMsg('');
        setConfirmText(r.text);
      } else {
        setPanelMsg(r.error);
      }
    },
    onStartError: (msg) => setPanelMsg(msg),
  });
  const recRef = useRef(rec);
  useEffect(() => {
    recRef.current = rec;
  }, [rec]);

  // 追问倒计时（C4）：仅在「追问模式 && 无确认卡 && 空闲态」走表（开录/识别中=已响应，暂停）。
  // 到点退出追问模式并收起面板，恢复常规唤醒循环；期限是绝对值，暂停后恢复不重置。
  useEffect(() => {
    if (!followup) return undefined;
    if (confirmText !== null || rec.phase !== 'idle') return undefined;
    const tick = () => {
      const left = followupUntilRef.current - Date.now();
      if (left <= 0) {
        clearFollowup();
        setPanelOpen(false);
        setConfirmText(null);
        setPanelMsg('');
        return;
      }
      setFollowupLeft(left);
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [followup, confirmText, rec.phase, clearFollowup]);

  // 开面板（非确认卡路径）自动开录；关面板/执行时收尾丢弃
  useEffect(() => {
    if (!panelOpen) {
      recRef.current.cancel();
      return undefined;
    }
    if (confirmText !== null) return undefined;
    if (skipAutoStartRef.current) {
      skipAutoStartRef.current = false;
      return undefined;
    }
    if (recRef.current.phase === 'idle') recRef.current.start();
    return undefined;
  }, [panelOpen, confirmText]);

  // ---- 连续唤醒监听 ----
  const wakeOn = layerOn && cfg.listen && asrReady && !wakeBlocked;
  const onWake = useCallback((task: string | null) => {
    setPanelMsg('');
    setConfirmText(task); // null = 只喊了名字 → 录音态等继续说；有值 = 一句话直达确认卡
    setPanelOpen(true);
  }, []);
  const canListen = useCallback(() => canAgentWakeListen(panelOpenRef.current, agentRunningRef.current), []);
  // enabled 只随总启用态启停；锁屏/通话/面板打开等暂停条件由 canListen 每轮动态判断
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
  const openPanel = useCallback(() => {
    clearFollowup(); // 手动开面板：不处于追问模式（若已在追问，重置为常规面板）
    skipAutoStartRef.current = false;
    setPanelMsg('');
    setConfirmText(null);
    setPanelOpen(true);
  }, [clearFollowup]);
  const closePanel = useCallback(() => {
    clearFollowup(); // 用户点关闭：退出追问模式，恢复常规唤醒循环
    setPanelOpen(false);
    setConfirmText(null);
    setPanelMsg('');
  }, [clearFollowup]);
  const retryRecord = useCallback(() => {
    setPanelMsg('');
    recRef.current.start();
  }, []);

  /** 执行任务：收起面板 → dynamic import 拉起 runAgentTask → 全局进度条接管；
   *  被能力闸/防重入拒绝（闸全部同步判定，promise 秒回）→ 重开面板中文说明原因。
   *  C4：执行即退出追问模式；上一条结果播报若还在放立即打断（TTS token 机制）；
   *  任务真正跑起来后标记「语音唤起来源」（终态播报/追问模式据此判定） */
  const execute = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      vibrateSafely(18);
      recRef.current.cancel();
      clearFollowup(); // 追问模式随执行退出（新任务结束后按需再进）
      stopSpeaking(); // 上一条播报若还在放：立即打断，不与新任务播报叠音
      setPanelOpen(false);
      setConfirmText(null);
      setPanelMsg('');
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
        } else if (!early.ok) {
          skipAutoStartRef.current = true;
          setPanelMsg(early.text);
          setPanelOpen(true);
        }
      } catch (err) {
        skipAutoStartRef.current = true;
        setPanelMsg(err instanceof Error ? err.message : '任务启动失败，请重试');
        setPanelOpen(true);
      }
    },
    [clearFollowup],
  );

  if (!layerOn) return null;

  const listening = wakeOn && visible; // 呼吸光环：连续唤醒在听
  const recBusy = rec.phase === 'starting' || rec.phase === 'recording';

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[57]"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
      data-testid="agent-voice-layer"
      data-suppress-edge-gesture
    >
      {/* Agent 运行状态探针（dynamic 拉起 agent-ui → shizuku-agent；纯副作用不渲染内容） */}
      <AgentRunningProbe onChange={onRunningChange} />

      {/* 面板打开时的透明背板：点面板外任意处收起（iOS 同款消费型关闭） */}
      {panelOpen ? (
        <button
          type="button"
          aria-label="收起语音面板"
          className="pointer-events-auto absolute inset-0 cursor-default bg-black/25"
          onClick={closePanel}
          data-testid="agent-voice-backdrop"
        />
      ) : null}

      {/* 语音面板（居中靠下，毛玻璃卡） */}
      <AnimatePresence>
        {panelOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            role="dialog"
            aria-label="语音唤起智能体"
            className="pointer-events-auto absolute bottom-[110px] left-[7%] w-[86%] max-w-[330px] rounded-[24px] bg-white/85 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] ring-1 ring-black/10 backdrop-blur-xl dark:bg-[#1C1C1E]/92 dark:ring-white/15"
            data-testid="agent-voice-panel"
          >
            {/* 标题行 */}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#34C759]/15" aria-hidden="true">
                <Sparkles className="h-4 w-4 text-[#248A3D] dark:text-[#34C759]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
                {cfg.name} · 语音任务
              </span>
              <button
                type="button"
                aria-label="关闭"
                onClick={closePanel}
                className="flex h-8 w-8 items-center justify-center rounded-full text-foreground/50 transition active:bg-black/5 dark:active:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 追问模式提示（C4）：面板保持展开 + 倒计时；期间录音免喊唤醒名（10s 内点麦克风即可） */}
            {followup ? (
              <div
                className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#34C759]/10 px-3 py-2 text-[12px] leading-relaxed text-[#248A3D] dark:text-[#34C759]"
                role="status"
                data-testid="agent-voice-followup-hint"
              >
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  追问 · {Math.max(1, Math.ceil(followupLeft / 1000))}s 内可直接说下一个任务，无需再喊{cfg.name}
                </span>
              </div>
            ) : null}

            {/* 提示/错误（toast 式） */}
            {panelMsg ? (
              <div
                className="mt-2 rounded-xl bg-[#FF3B30]/10 px-3 py-2 text-[12px] leading-relaxed text-[#D70015] dark:text-[#FF6961]"
                role="alert"
                data-testid="agent-voice-msg"
              >
                {panelMsg}
              </div>
            ) : null}

            {/* 确认卡：可编辑转写文本 + 执行/取消 */}
            {confirmText !== null ? (
              <div className="mt-3">
                <textarea
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  rows={3}
                  autoFocus
                  aria-label="任务文本（可修改）"
                  className="w-full resize-none rounded-2xl bg-black/[0.05] p-3 text-[14px] leading-relaxed text-foreground outline-none ring-1 ring-black/[0.06] focus:ring-[#34C759]/50 dark:bg-white/[0.08] dark:ring-white/[0.08]"
                  data-testid="agent-voice-confirm-input"
                />
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                  将由智能体接管手机执行 · 敏感操作会先征求你的同意
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="h-11 flex-1 rounded-full bg-black/[0.06] text-[14px] font-medium text-foreground transition active:scale-[0.98] dark:bg-white/[0.09]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void execute(confirmText)}
                    disabled={!confirmText.trim()}
                    className="h-11 flex-1 rounded-full bg-[#34C759] text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
                    data-testid="agent-voice-execute"
                  >
                    执行
                  </button>
                </div>
              </div>
            ) : rec.phase === 'recognizing' ? (
              /* 识别中 */
              <div className="flex flex-col items-center gap-2 py-6" aria-live="polite">
                <Loader2 className="h-7 w-7 animate-spin text-[#34C759]" aria-hidden="true" />
                <p className="text-[13px] text-muted-foreground">识别中…</p>
              </div>
            ) : (
              /* 录音态 / 就绪态 */
              <div className="mt-2 flex flex-col items-center">
                {/* 实时波形 + 已录时长 */}
                <div className="flex h-10 items-center gap-[3px]" aria-hidden="true">
                  {recBusy && rec.levels.length > 0 ? (
                    rec.levels.slice(-18).map((v, i) => (
                      <span
                        key={`${i}-${rec.levels.length}`}
                        style={{ height: `${Math.max(5, v * 32)}px` }}
                        className="w-[3px] rounded-full bg-[#34C759]"
                      />
                    ))
                  ) : (
                    <span className="text-[12px] text-muted-foreground">
                      {rec.phase === 'starting' ? '准备中…' : '点下方按钮开始说话'}
                    </span>
                  )}
                </div>
                <p className="mt-1 min-h-[18px] max-w-full truncate px-2 text-[13px] text-foreground/85" aria-live="polite">
                  {rec.partial || (recBusy ? '请说出任务…' : '')}
                </p>
                {/* 手动停止 / 重新开始 */}
                {recBusy ? (
                  <button
                    type="button"
                    onClick={rec.stop}
                    aria-label="停止录音"
                    className="mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-[0_8px_20px_rgba(255,59,48,0.4)] transition active:scale-95"
                    data-testid="agent-voice-stop"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={retryRecord}
                    aria-label="开始录音"
                    className="mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-[#34C759] text-white shadow-[0_8px_20px_rgba(52,199,89,0.4)] transition active:scale-95"
                    data-testid="agent-voice-record"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {recBusy ? `说完自动停止 · ${Math.floor(rec.seconds)}s / 30s` : '说一句话任务，如「打开微信给妈妈发晚安」'}
                </p>
                {/* 打字兜底（永远可用） */}
                <TextFallback onSubmit={(t) => void execute(t)} />
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* 悬浮球（右侧边缘可拖动，吸边 + 位置记忆；连续唤醒监听中带呼吸光环） */}
      <motion.button
        type="button"
        aria-label="语音唤起智能体（拖动移位，点按说话）"
        drag
        dragConstraints={layerRef}
        dragElastic={0.12}
        dragMomentum={false}
        whileTap={{ scale: 0.92 }}
        onPointerDown={() => {
          dragMovedRef.current = false;
        }}
        onPointerUp={() => {
          if (!dragMovedRef.current) openPanel(); // 位移阈值内视为点按
        }}
        onDrag={(_e, info) => {
          if (Math.abs(info.offset.x) > TAP_SLOP || Math.abs(info.offset.y) > TAP_SLOP) dragMovedRef.current = true;
        }}
        onDragEnd={(_e, info) => onDragEnd(info)}
        animate={pos ? { x: pos.x, y: pos.y } : undefined}
        transition={{ duration: 0.16 }}
        className="pointer-events-auto absolute bottom-[140px] right-0 flex h-[48px] w-[48px] touch-none select-none items-center justify-center rounded-full bg-gradient-to-b from-white/90 to-white/65 shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.10] backdrop-blur-xl dark:from-[#2C2C2E]/90 dark:to-[#161618]/85 dark:ring-white/[0.16]"
        data-testid="agent-voice-ball"
      >
        {/* 呼吸光环（连续唤醒监听中） */}
        {listening ? (
          <span
            aria-hidden="true"
            className="absolute inset-[-4px] animate-ping rounded-full bg-[#34C759]/25"
            style={{ animationDuration: '2.4s' }}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#34C759]/90 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]"
        >
          <Mic className="h-4 w-4 text-white" />
        </span>
      </motion.button>
    </div>
  );
}

/** 打字兜底输入行（识别链路全不可用时的硬兜底，永远渲染在录音/就绪态下） */
function TextFallback({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    onSubmit(t);
  };
  return (
    <form
      className="mt-3 flex w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="或直接输入任务…"
        aria-label="直接输入任务"
        className="h-10 min-w-0 flex-1 rounded-full bg-black/[0.05] px-4 text-[14px] text-foreground outline-none ring-1 ring-black/[0.05] placeholder:text-muted-foreground/70 focus:ring-[#34C759]/50 dark:bg-white/[0.08] dark:ring-white/[0.08]"
        data-testid="agent-voice-text-input"
      />
      <button
        type="submit"
        aria-label="发送任务"
        disabled={!draft.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white transition active:scale-95 disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
