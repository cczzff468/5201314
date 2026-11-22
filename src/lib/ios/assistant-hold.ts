'use client';

/**
 * D3 全局语音助手（长按唤起）——独立小 store（禁止进 settings.tsx 的独立开关面）：
 *
 * - localStorage 键 `voice-assistant-hold-v1` 持久化两件事：
 *   · enabled：语音助手已启用（默认 true）。关掉后主屏长按 600ms 不再唤起，
 *     回落原有「长按进编辑」手势，浮层（悬浮球）行为不受影响；
 *   · hintShown：唤起方式提示是否已展示过（首次解锁进主屏时展示一次「长按空白处唤起」
 *     胶囊提示，展示后置位持久化，之后不再打扰）。
 * - openSeq：唤起请求信号量。主屏长按 600ms → requestAssistantHold() →
 *   agent-voice-ball 的 Siri 式全屏会话层订阅 openSeq 变化后打开（见组件内
 *   「主屏长按唤起」effect）。用序号而非布尔的理由：连续两次长按各自自增，
 *   会话层每次都能感知（布尔翻转在「已开→再唤」时会丢事件）。
 * - 会话 UI / 识别 / TTS 全部复用既有管线（agent-voice / tts-client 等），
 *   本文件只管「开关 + 提示 + 唤起信号」三件事，不碰任何业务逻辑。
 */

import { create } from 'zustand';

export interface AssistantHoldState {
  /** 语音助手已启用（默认 true；localStorage 持久化） */
  enabled: boolean;
  /** 唤起方式提示已展示过（一次性；localStorage 持久化） */
  hintShown: boolean;
  /** 唤起请求序号（自增信号量；会话层订阅后打开全屏会话） */
  openSeq: number;
}

const STORE_KEY = 'voice-assistant-hold-v1';

/** 读持久化配置（缺省：启用 + 提示未展示；SSR/存储异常都回落默认） */
function readPersisted(): { enabled: boolean; hintShown: boolean } {
  if (typeof window === 'undefined') return { enabled: true, hintShown: false };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { enabled: true, hintShown: false };
    const p = JSON.parse(raw) as { enabled?: unknown; hintShown?: unknown };
    return { enabled: p.enabled !== false, hintShown: p.hintShown === true };
  } catch {
    return { enabled: true, hintShown: false };
  }
}

/** 合并写回 localStorage（存储不可用仅本次会话生效，不抛错） */
function persist(patch: { enabled?: boolean; hintShown?: boolean }): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = readPersisted();
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* 存储不可用仅本次会话生效 */
  }
}

const initial = readPersisted();

export const useAssistantHold = create<AssistantHoldState>(() => ({
  enabled: initial.enabled,
  hintShown: initial.hintShown,
  openSeq: 0,
}));

/** 语音助手是否启用（非 React 上下文读现场值：主屏长按手势判定用） */
export function isAssistantHoldEnabled(): boolean {
  return useAssistantHold.getState().enabled;
}

/** 唤起全屏语音助手（主屏长按等入口调用；序号自增，会话层每次都会打开） */
export function requestAssistantHold(): void {
  useAssistantHold.setState((s) => ({ openSeq: s.openSeq + 1 }));
}

/** 设置「语音助手已启用」开关（localStorage 持久化，立即生效） */
export function setAssistantHoldEnabled(v: boolean): void {
  persist({ enabled: v });
  useAssistantHold.setState({ enabled: v });
}

/** 标记唤起方式提示已展示（主屏一次性提示展示后调用，之后不再打扰） */
export function markAssistantHintShown(): void {
  persist({ hintShown: true });
  useAssistantHold.setState({ hintShown: true });
}
