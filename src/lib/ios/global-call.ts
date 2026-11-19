'use client';

/**
 * 全局语音通话会话（微信 / QQ 共用）：
 *
 * 把「正在进行的通话」从聊天页组件中解耦出来，由本模块（页面之外的全局单例）持有：
 *
 * 1. 宿主（微信/QQ 聊天页）用 start() 发起通话（携带联系人/方向/上下文快照与 onEnd 回调），
 *    全屏通话页由 PhoneShell 挂载的 GlobalCallLayer 渲染 —— 退出聊天页 / 退出 App /
 *    打开别的 App 都不会卸载通话引擎，电话不断（全局化）；
 *    微信 AI 来电以 view='hidden' 启动：响铃期间引擎照常跑但任何通话 UI 都不显示，
 *    只留全局来电弹窗（点弹窗非按钮区域 expand() 展开全屏来电页，弹窗接听则收成小窗）；
 * 2. 通话中点左上角小窗图标 minimize()：全屏页隐藏（组件保持挂载，引擎不停），悬浮小窗
 *    （PiP）出现在屏幕上；点小窗 expand() 回到全屏通话页；
 * 3. 小窗可拖动；拖到屏幕左右边缘 dock() 后只露一条边缘（edge sliver），点边缘 undock()
 *    恢复完整小窗，再点小窗进全屏通话页；
 * 4. 通话结束（恰好一次）：引擎回调 onEnd —— 宿主在回调里用各自的 loadMsgs/saveMsgs
 *    直写通话卡片（聊天页卸载了也能落盘），随后 close() 清理会话；
 *    替换中的旧通话也走同一路径（startGlobalCall 替换前收尾兜底，B-1）——旧通话先完整收尾再被新通话顶替；
 * 5. 通话秒数总线：引擎每秒 reportCallSeconds 上报，悬浮小窗订阅显示实时时长
 *    （小窗与全屏页是两个组件，时长经此共享）。
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ContactRecord } from '@/lib/contacts';
import type { ChatCallResult, ChatCallTurnMsg } from './chat-call';

/** 一次全局通话的完整入参（宿主发起时一次性快照） */
export interface GlobalCallSession {
  /** wx=微信皮肤 / qq=QQ皮肤 / phone=电话 App（iOS 黑白灰，仅视频通话走全局层） */
  variant: 'wx' | 'qq' | 'phone';
  /** 通话媒体（Task 22 视频通话）：voice=语音（默认，全链路旧行为）/ video=视频——全局层渲染
   *  VideoCallScreen、小窗/弹窗显示视频图标、规则/记忆/卡片按视频分叉 */
  media?: 'voice' | 'video';
  name: string;
  avatar: string | null;
  /** 用户（机主）自己的头像（Task 27 视频通话）：关闭摄像头/权限拒绝时视频通话页显示它
   *  （替代「摄像头已关」占位）；微信/QQ 传各自 App 机主头像，电话传系统设置头像；缺省 undefined */
  myAvatar?: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  /** 记忆召回快照（发起时；兑底用） */
  memoryBlock?: string;
  /** 每轮动态召回记忆（宿主组装；引擎以「用户刚说的话」逐轮调用，优先于 memoryBlock） */
  memoryBlockFn?: (userText: string | null) => string | undefined;
  /** 世界书块（宿主 collectWbBlocks 组装；随人设注入 turn API） */
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主直写通话卡片并落盘，随后全局层自动 close() */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主以聊天消息落盘 */
  onFollowup?: (texts: string[]) => void;
}

interface GlobalCallState {
  session: GlobalCallSession | null;
  /** 会话序号：每次 start 递增，VoiceCallScreen 用 key 重挂载新通话 */
  seq: number;
  /** full=全屏通话页 / pip=悬浮小窗（小窗被推到边缘时只露一条边） /
   *  hidden=完全隐藏（微信 AI 来电响铃中：引擎挂载运行但全屏页与小窗都不显示） */
  view: 'full' | 'pip' | 'hidden';
  pipDocked: boolean;
  pipSide: 'left' | 'right';
  /** 小窗位置（相对手机壳左上角；null=未初始化，首次显示时按壳尺寸摆到右上） */
  pipPos: { x: number; y: number } | null;
  /** 来电中全屏通话页引擎的接听/拒绝方法：全局来电弹窗（微信大窗/胶囊）上的接听、忽略按钮经此代理到页内引擎；
   *  finishByReplacement 供 startGlobalCall 替换旧通话前触发完整收尾（B-1 兜底，所有方向都注册） */
  engine: { accept: () => void; reject: () => void; finishByReplacement: () => void } | null;
  /** 全屏通话页引擎当前阶段（来电弹窗跟随：incoming 才显示，接通/结束后消失） */
  enginePhase: 'dialing' | 'incoming' | 'active' | 'ended' | null;
  setEngine: (
    engine: { accept: () => void; reject: () => void; finishByReplacement: () => void } | null,
    phase: GlobalCallState['enginePhase'],
  ) => void;
  setEnginePhase: (phase: GlobalCallState['enginePhase']) => void;
  start: (s: GlobalCallSession, initialView?: 'full' | 'hidden') => void;
  minimize: () => void;
  expand: () => void;
  dock: (side: 'left' | 'right') => void;
  undock: () => void;
  setPipPos: (p: { x: number; y: number }) => void;
  close: () => void;
}

export const useGlobalCall = create<GlobalCallState>()((set) => ({
  session: null,
  seq: 0,
  view: 'full',
  pipDocked: false,
  pipSide: 'right',
  pipPos: null,
  engine: null,
  enginePhase: null,
  setEngine: (engine, phase) => set({ engine, enginePhase: phase }),
  setEnginePhase: (phase) => set({ enginePhase: phase }),
  start: (s, initialView = 'full') =>
    set((prev) => ({
      session: s,
      seq: prev.seq + 1,
      view: initialView,
      pipDocked: false,
      pipPos: null,
      engine: null,
      enginePhase: null,
    })),
  minimize: () => set({ view: 'pip', pipDocked: false }),
  expand: () => set({ view: 'full' }),
  dock: (side) => set({ pipDocked: true, pipSide: side }),
  undock: () => set({ pipDocked: false }),
  setPipPos: (p) => set({ pipPos: p }),
  close: () => {
    reportCallSeconds(0);
    set({ session: null, view: 'full', pipDocked: false, pipPos: null, engine: null, enginePhase: null });
  },
}));

/** 发起一次全局通话（宿主入口）。initialView='hidden'：微信 AI 来电用——响铃期间不显示全屏通话页，只留来电弹窗。
 *  已有活动通话时（B-1 兜底）：先让旧通话走完整收尾再启动新通话，绝不静默替换杀死旧通话（见下）。 */
export function startGlobalCall(session: GlobalCallSession, initialView: 'full' | 'hidden' = 'full'): void {
  const prev = useGlobalCall.getState();
  if (!prev.session) {
    prev.start(session, initialView);
    return;
  }
  // —— 替换前收尾兜底（B-1）：已有活动通话时绝不静默替换（那会直接重挂引擎杀死旧通话，
  // 旧通话的通话卡片/挂断续聊/记忆总结全部丢失）。先经引擎句柄让旧通话按当前阶段走完整收尾：
  // finish（按阶段映射真实结局）→ onEnd（宿主写通话卡片 + 挂断续聊 + 记忆总结）→ 全局层回调 close()
  // 清理会话，然后再启动新通话。防 double-finish：旧通话已结束（enginePhase==='ended'）直接放行，
  // 引擎内 endedRef 幂等拦截；引擎句柄缺失（动态加载未挂载的亚秒窗口）无收尾可走，按旧行为直接替换。
  if (prev.engine && prev.enginePhase !== 'ended') {
    try {
      prev.engine.finishByReplacement();
    } catch {
      // 收尾回调异常也不能吞掉新通话：照常启动
    }
  }
  useGlobalCall.getState().start(session, initialView);
}

// ---------------- 通话秒数总线（引擎 → 悬浮小窗） ----------------

let callSeconds = 0;
const secondsSubs = new Set<() => void>();

/** 通话引擎每秒上报接通秒数（小窗订阅显示；close/start 时归零） */
export function reportCallSeconds(s: number): void {
  if (callSeconds === s) return;
  callSeconds = s;
  secondsSubs.forEach((fn) => fn());
}

function subscribeCallSeconds(fn: () => void): () => void {
  secondsSubs.add(fn);
  return () => {
    secondsSubs.delete(fn);
  };
}

/** 订阅通话实时秒数（SSR 快照 0） */
export function useCallSeconds(): number {
  return useSyncExternalStore(
    subscribeCallSeconds,
    () => callSeconds,
    () => 0,
  );
}
