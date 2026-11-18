'use client';

/**
 * 「回车键发送消息」设置总线（微信/QQ/信息五端共用，对照 chat-flags 模式）：
 * - 每个 App 一份设置：wx-enter-send / qq-enter-send / sms-enter-send（App 内单聊+群聊共用一套逻辑）
 * - localStorage 持久化（重启后保留），多账号按 accLs 前缀映射自动作用域——
 *   设置按账号隔离：切换账号自动切到该账号自己的开关值，互不残留
 * - 默认开启：键盘回车 / 移动端键盘「发送」键（enterKeyHint=send）直接发送消息，与点「发送」按钮一致；
 *   关闭：回车一律换行（不拦截原生行为，textarea 正确显示多行），只能点「发送」按钮发送
 * - 变更即时广播（useSyncExternalStore）：聊天输入框 enterKeyHint、聊天设置页/群聊设置页开关实时同步，无需重启
 */
import { useSyncExternalStore } from 'react';
import { ACCOUNT_CHANGED_EVENT, accLs } from '@/lib/ios/accounts';

/** 支持回车发送设置的 App（信息 sms：单聊含 AI 助手/联系人会话；wx/qq：单聊+群聊共用各自 App 的开关值） */
export type EnterSendApp = 'wx' | 'qq' | 'sms';

/** 各 App 的存储基键（实际写入时经 accLs 追加当前账号作用域后缀，大号保持原键） */
const BASE_KEYS: Record<EnterSendApp, string> = {
  wx: 'wx-enter-send',
  qq: 'qq-enter-send',
  sms: 'sms-enter-send',
};

/** 从 localStorage 读取当前账号的开关值（无记录 = 默认开启） */
function readFlag(app: EnterSendApp): boolean {
  try {
    const v = window.localStorage.getItem(accLs(BASE_KEYS[app], app));
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();
/** 内存快照（getSnapshot 引用稳定，仅在变更时更换） */
let snapshot: Record<EnterSendApp, boolean> | null = null;

function cur(): Record<EnterSendApp, boolean> {
  if (!snapshot) snapshot = { wx: readFlag('wx'), qq: readFlag('qq'), sms: readFlag('sms') };
  return snapshot;
}

function emit() {
  listeners.forEach((fn) => fn());
}

// 账号切换：换到哪个 App 账号就重读该 App 的开关值并广播（设置跟随账号隔离，切换不残留）
if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_CHANGED_EVENT, (e: Event) => {
    const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
    if (!d || (d.app !== 'wx' && d.app !== 'qq' && d.app !== 'sms')) return;
    const app = d.app as EnterSendApp;
    const next = readFlag(app);
    if (next === cur()[app]) return;
    snapshot = { ...cur(), [app]: next };
    emit();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 读取当前账号下某 App 的「回车键发送消息」开关（非 React 场景用，如发送/键盘处理函数内） */
export function getEnterSend(app: EnterSendApp): boolean {
  return cur()[app];
}

/** 写入当前账号下某 App 的开关并即时广播（localStorage 持久化，重启保留） */
export function setEnterSend(app: EnterSendApp, v: boolean) {
  try {
    window.localStorage.setItem(accLs(BASE_KEYS[app], app), v ? '1' : '0');
  } catch {
    // 持久化失败忽略（内存值仍然生效到本次会话）
  }
  snapshot = { ...cur(), [app]: v };
  emit();
}

/** 组件侧订阅：SSR 用默认开启快照避免水合不一致，客户端挂载后即取真实值 */
export function useEnterSend(app: EnterSendApp): boolean {
  return useSyncExternalStore(
    subscribe,
    () => cur()[app],
    () => true
  );
}

/**
 * 五端统一的回车键行为（共用一套逻辑）：
 * - 关闭：完全不拦截 —— 桌面 Enter / 移动端键盘回车键一律走 textarea 原生行为插入换行（多行内容正确显示）；
 * - 开启：Enter（非 Shift、非输入法选词）拦截并调用 onSend，与点「发送」按钮完全一致；
 * - Shift+Enter 在开启时仍换行（多行输入习惯保留）；输入法选词回车（isComposing）永不发送。
 */
export function guardEnterToSend(
  e: React.KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>,
  enterSend: boolean,
  onSend: () => void
): void {
  if (!enterSend) return; // 关闭：回车=换行，交给浏览器原生行为
  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  onSend();
}
