'use client';

/**
 * 网站回复同步真机（v20，机主定调「让 TA 在网站上回复了以后，出现在真机微信/QQ 上」）：
 *
 * 网站聊天页（微信/QQ App 的绑定联系人会话）每轮 AI 回复投递完成后，把该轮的文字分段
 * 同步转发到真机微信/QQ（经 proactive-relay：① 本机网关 send-active → ② 云端函数兜底）。
 * - 微信：走最近会话上下文（24h 内）代发——无平台配额限制，开箱即用；
 * - QQ：优先吃被动回复余量（对方 5 分钟内在真机发过消息时零配额），耗尽才走主动消息
 *   （QQ 平台限每用户每月 4 条主动消息——超限该轮转发报错，静默不影响站内投递）。
 *
 * 开关（每通道独立，localStorage 单键；默认开启）：设置 → 云端助手 →「网站回复同步真机」。
 * 只对「真机已接入的绑定联系人」会话生效（relayTargetReady 校验：微信 iLink / QQ Bot
 * 登录快照的 boundContactId 与当前聊天联系人一致才转发）——站内其它联系人聊天不受影响。
 */

const WX_KEY = 'website-reply-sync-wx';
const QQ_KEY = 'website-reply-sync-qq';

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, val: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, val);
  } catch {
    /* 持久化失败忽略（本次会话内存态仍然生效） */
  }
}

/** 读取「网站回复同步真机」开关（默认开启；关闭后网站聊天不再镜像到真机） */
export function getWebsiteReplySync(app: 'wx' | 'qq'): boolean {
  const v = lsGet(app === 'wx' ? WX_KEY : QQ_KEY);
  // v20 默认开启：没写过 = 开（机主要求的行为）；显式 '0' = 关
  return v !== '0';
}

/** 保存开关（调用方负责 toast/页面提示） */
export function saveWebsiteReplySync(app: 'wx' | 'qq', on: boolean): void {
  lsSet(app === 'wx' ? WX_KEY : QQ_KEY, on ? '1' : '0');
}
