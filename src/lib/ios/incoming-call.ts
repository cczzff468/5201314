'use client';

/**
 * 全局来电中心（AI 主动打来的电话 / 微信语音通话邀请）：
 *
 * - 电话来电（source='phone'，信息 App 的 AI 回复带 [语音通话] 标记触发）：
 *   iOS 全屏来电界面自动显示（IncomingCallLayer 渲染，来电界面不叠加弹窗）；
 *   点界面左上「退出」收起来电界面 → 只剩顶部横幅弹窗（头像左/拒接接听右，锚定灵动岛原位），
 *   点弹窗非按钮区可回到来电界面；响铃 25 秒无人处理 → 超时未接；
 *   接听 → 回调 onAnswer（打开电话 App 进通话界面）；
 *   拒绝/超时 → 回调 onMissed（落未接通话记录 + AI 语音留言）；
 * - 微信语音来电（source='wx'，AI 回复带 [语音通话] 标记触发）：微信大窗弹窗显示 5 秒 →
 *   缩成胶囊小窗（继续响铃）；全屏来电界面由现有全局通话层（WxCallScreen incoming 态）承担，
 *   弹窗上的接听/忽略经 global-call 的引擎转发代理（engine.accept / engine.reject）；
 * - QQ 来电不经过本模块（QQ 没有来电弹窗，保持直接全屏）；
 * - 弹窗与全屏来电界面挂在 PhoneShell（z-94 / z-84）：高于一切 App / 锁屏，任何界面都显示。
 */

import { create } from 'zustand';
import type { ContactRecord } from '@/lib/contacts';

/** 一次全局来电的快照（触发方一次性给定） */
export interface IncomingCallSnapshot {
  /** 本次来电唯一 id（弹窗动画 key / effect 重跑依赖） */
  id: string;
  /** 来电来源：phone=电话 App（iOS 来电） / wx=微信语音通话邀请 */
  source: 'phone' | 'wx';
  name: string;
  avatar: string | null;
  /** 通话媒体（Task 22 视频通话）：video=视频通话邀请——弹窗文案/接听图标按视频显示；缺省语音 */
  media?: 'voice' | 'video';
  /** 电话来电的对端号码（来电界面显示） */
  number?: string;
  contact: ContactRecord | null;
  /** 弹窗形态：big=微信大窗（5 秒后自动换 pill）/ pill=顶部胶囊（电话来电直接用） */
  bannerStage: 'big' | 'pill';
  startedAt: number;
  /** 接听回调（仅 phone 有：打开电话 App 进来电方向的通话界面；wx 由引擎转发代理） */
  onAnswer?: () => void;
  /** 拒绝（declined）/ 响铃超时（timeout）回调（仅 phone 有：落未接记录 + AI 语音留言） */
  onMissed?: (reason: 'declined' | 'timeout') => void;
}

interface IncomingCallState {
  call: IncomingCallSnapshot | null;
  /** 电话全屏来电界面是否已退出：退出后只显示顶部弹窗（来电继续响铃），点弹窗非按钮区回到来电界面 */
  screenHidden: boolean;
  /** 触发一次来电（已有来电时忽略——同一时刻只有一通） */
  trigger: (call: IncomingCallSnapshot) => void;
  /** 微信大窗 → 胶囊（5 秒定时器到点由 Layer 调用） */
  setStage: (stage: 'big' | 'pill') => void;
  /** 退出全屏来电界面（仅电话来电有此界面）：来电保持响铃，只剩顶部弹窗 */
  hideScreen: () => void;
  /** 回到全屏来电界面（点弹窗除按钮外的区域） */
  showScreen: () => void;
  /** 用户接听（弹窗或全屏来电界面）：走快照回调后清层 */
  answer: () => void;
  /** 用户拒绝 / 响铃超时：走快照回调后清层 */
  dismiss: (reason: 'declined' | 'timeout') => void;
  /** 直接清层（不触发回调；微信侧 missed-in 由引擎自理后调） */
  clear: () => void;
}

export const useIncomingCall = create<IncomingCallState>()((set, get) => ({
  call: null,
  screenHidden: false,
  trigger: (call) => {
    if (get().call) return; // 通话中/响铃中忽略新来电
    set({ call, screenHidden: false });
  },
  setStage: (stage) => {
    const call = get().call;
    if (!call || call.bannerStage === stage) return;
    set({ call: { ...call, bannerStage: stage } });
  },
  hideScreen: () => {
    if (get().call?.source !== 'phone') return;
    set({ screenHidden: true });
  },
  showScreen: () => set({ screenHidden: false }),
  answer: () => {
    const call = get().call;
    if (!call) return;
    set({ call: null, screenHidden: false });
    try {
      call.onAnswer?.();
    } catch {
      // 回调异常不阻塞清层
    }
  },
  dismiss: (reason) => {
    const call = get().call;
    if (!call) return;
    set({ call: null, screenHidden: false });
    try {
      call.onMissed?.(reason);
    } catch {
      // 回调异常不阻塞清层
    }
  },
  clear: () => set({ call: null, screenHidden: false }),
}));

/** 触发一次全局来电（微信/电话 AI 来电共用入口；QQ 不用） */
export function triggerIncomingCall(call: Omit<IncomingCallSnapshot, 'startedAt' | 'id'>): void {
  useIncomingCall.getState().trigger({ ...call, id: genCallId(), startedAt: Date.now() });
}

let callSeq = 0;
function genCallId(): string {
  callSeq += 1;
  return `ic-${Date.now()}-${callSeq}`;
}

// ---------------- 电话来电「已接听」交接桥（IncomingCallLayer → 电话 App） ----------------

/** 接听后待电话 App 消费的来电（openApp('phone') 后由其 mount effect 取走并进入电方向通话界面）。
 *  模块级单变量：同一时刻只有一通电话，取走即清 */
export interface PendingPhoneAnswer {
  contact: ContactRecord | null;
  number: string;
  name: string;
  /** AI 主动来电的拨打目的（AI 决策 API 的 reason）：电话 App 透传给通话引擎作为开场情境；
   *  普通来电（聊天标记触发的 AI 来电 / 用户操作）无此字段 */
  proactiveContext?: string;
  /** C14 AI 主动视频来电：决策端选 video 时接听进视频通话（全局层）；缺省语音 CallScreen */
  media?: 'voice' | 'video';
}

let pendingPhoneAnswer: PendingPhoneAnswer | null = null;

/** 写入待接听的电话来电（IncomingCallLayer 接听回调调用，随后 openApp('phone')） */
export function setPendingPhoneAnswer(p: PendingPhoneAnswer): void {
  pendingPhoneAnswer = p;
}

/** 电话 App 取走待接听来电（mount effect 调用；取走即清，无则返回 null） */
export function takePendingPhoneAnswer(): PendingPhoneAnswer | null {
  const p = pendingPhoneAnswer;
  pendingPhoneAnswer = null;
  return p;
}

// ---------------- 接听交接事件（幽灵来电修复：电话 App 已在前台/锁屏时接听的兜底） ----------------

/** 「消费 pending 来电」事件名（电话 App 已挂载时监听；来电层派发，事件驱动立即进通话界面） */
export const PENDING_PHONE_ANSWER_EVENT = 'pending-phone-answer';

/** 是否有待接听的电话来电（解锁兜底/派发事件前判断用；只读不消费） */
export function hasPendingPhoneAnswer(): boolean {
  return pendingPhoneAnswer !== null;
}

/** 派发「消费 pending 来电」事件：已挂载的电话 App 立即消费进通话界面；
 *  未挂载时无人监听（无害），由其挂载 effect 消费。接听交接时 switchToApp 帮不上忙的场景
 *  （电话 App 已在前台 = 无事发生 / 锁屏 = 被拦截保留 pending）由来电层调用这里补齐 */
export function notifyPendingPhoneAnswer(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PENDING_PHONE_ANSWER_EVENT));
}

// ---------------- 电话来电铃声（iOS「嘟—嘟—嘟」循环；微信来电铃声由 WxCallScreen 自理） ----------------

let audioCtx: AudioContext | null = null;
function tone(freq: number, durationMs: number, gain: number, delayMs = 0): void {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const t0 = audioCtx.currentTime + delayMs / 1000;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.setValueAtTime(gain, t0 + durationMs / 1000 - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.05);
  } catch {
    // 音频不可用静默
  }
}

let ringTimer: number | null = null;

/** 播放一轮电话来电铃声（4 秒周期：两声短鸣）；循环由调用方 setInterval 驱动 */
function playRingOnce(): void {
  tone(1180, 420, 0.08);
  tone(1180, 420, 0.08, 640);
}

/** 开始来电铃声循环（重复调用安全：先停旧的） */
export function startIncomingRing(): void {
  stopIncomingRing();
  playRingOnce();
  ringTimer = window.setInterval(playRingOnce, 4000);
}

/** 停止来电铃声 */
export function stopIncomingRing(): void {
  if (ringTimer !== null) {
    window.clearInterval(ringTimer);
    ringTimer = null;
  }
}
