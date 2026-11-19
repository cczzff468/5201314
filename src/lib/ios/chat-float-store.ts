'use client';

/**
 * v73 AI 聊天悬浮小窗：全局会话态（Zustand）
 *
 * 职责：小窗的 isOpen（contactId）与当前 position（需求五-2）；
 * 组件挂载在 PhoneShell 壳层（App 窗口之外）——切换底部 App 不卸载。
 * 小窗内容复用微信 ChatPage（ChatCore 本体，float 变体），消息双写互通靠
 * wechat.tsx 的会话消息共享源（wxSessionMsgs），不在此处复制聊天状态。
 *
 * 位置持久化：localStorage 右上角锚点偏移 {x,y}（左上角坐标，层内 px），
 * 与悬浮球 assist-ball-pos 同款模式；挂载时钳回层内自愈老数据。
 */

import { create } from 'zustand';

export interface ChatFloatPos {
  x: number;
  y: number;
}

const POS_KEY = 'chat-float-pos';

interface ChatFloatState {
  /** 当前小窗会话（null = 未开小窗；切换会话 = 换人） */
  contactId: string | null;
  /** 最小化：ChatPage 卸载只留胶囊（释放渲染压力；未读角标恢复累计） */
  minimized: boolean;
  /** 窗口左上角位置（层内 px；null = 默认右上） */
  pos: ChatFloatPos | null;
  open: (contactId: string) => void;
  close: () => void;
  minimize: () => void;
  restore: () => void;
  setPos: (pos: ChatFloatPos) => void;
}

export const useChatFloat = create<ChatFloatState>()((set) => ({
  contactId: null,
  minimized: false,
  pos: null,
  // 同会话已是展开窗口时不动（避免重置滚动位置）；换会话/从胶囊恢复时重开
  open: (contactId) =>
    set((s) => (s.contactId === contactId && !s.minimized ? {} : { contactId, minimized: false })),
  close: () => set({ contactId: null, minimized: false }),
  minimize: () => set({ minimized: true }),
  restore: () => set({ minimized: false }),
  setPos: (pos) => set({ pos }),
}));

/** 非组件层入口：聊天页顶栏「小窗模式」按钮（打开小窗并退出全屏聊天） */
export function openChatFloat(contactId: string): void {
  useChatFloat.getState().open(contactId);
}

export function loadChatFloatPos(): ChatFloatPos | null {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ChatFloatPos>;
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

export function saveChatFloatPos(pos: ChatFloatPos): void {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* 存储不可用仅本次会话生效 */
  }
}
