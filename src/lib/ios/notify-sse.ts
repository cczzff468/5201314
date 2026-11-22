'use client';

/**
 * 通知系统客户端桥（v57）：SSE 长连接 + Service Worker showNotification。
 *
 * 链路：页面事件（AI 落盘一条消息 → pushChatNotification）→ POST /api/notify/push
 * → 服务端广播（notify-bus）→ 本模块的 EventSource('/api/notify/stream') 长连接收到
 * → showSystemNotification（SW registration.showNotification() 优先，页面构造器兜底）
 * → 系统通知动态显示：角色头像（复合图标 dataURL）+ 角色名字（title）+ App 图标（badge）。
 *
 * 为什么绕一圈走服务器：SSE 长连接让「通知投递」成为服务端可寻址的通道——
 * 浏览器标签页后台化（定时器节流到 ≥1 次/分钟）时事件仍即时唤醒页面 JS 弹通知，
 * 未来服务端接力生成的消息也能直接推（同一通道，无需页面在场）。
 *
 * 门禁（接收侧）：Notification 权限 granted + 系统级通知总闸开（与 island-notify 同键，
 * 就地重读避免循环 import）；任一不满足只收不发。
 * 兜底（发送侧）：POST 失败（网络/路由异常）由 island-notify 直接调 showSystemNotification。
 */

import { showSystemNotification, isPageBackground } from './system-notify';

/** 与 island-notify.SYS_NOTIFY_KEY 同键（避免循环 import，就地重读 localStorage） */
const SYS_NOTIFY_KEY = 'ios-sys-notify-enabled';

/** SSE 通知载荷（与 /api/notify/push 的广播契约一致） */
export interface SseNotifyPayload {
  title: string;
  body?: string;
  tag?: string;
  /** 复合图标 dataURL（角色头像圆底 + App 角标） */
  icon?: string;
  /** App 图标路径（badge） */
  badge?: string;
  /** v75：点击跳转目标（App + 会话 id；island-notify 透传）——收到后写入 notification.data，
 *  sw.js notificationclick 读到后 postMessage 回页面导航总线，实现「点击系统通知跳回对应聊天界面」 */
  target?: { app?: string; contactId?: string; groupId?: string; pay?: boolean };
}

function sysNotifyEnabled(): boolean {
  try {
    return window.localStorage.getItem(SYS_NOTIFY_KEY) !== 'off';
  } catch {
    return true; // 存储不可用：默认开（与 island-notify 口径一致）
  }
}

// ---------------- E2E 自测钩子（不参与业务逻辑；agent-browser 验证长连接/广播链路用） ----------------

const sseDebug = {
  connected: 0, // EventSource readyState（0=连接中 1=已连接 2=已关闭）
  received: 0, // 收到的广播事件数
  shown: 0, // 实际经 SW/页面通道弹出的通知数
  last: null as SseNotifyPayload | null, // 最近一条收到的载荷
};
if (typeof window !== 'undefined') {
  (window as unknown as { __notifySse?: typeof sseDebug }).__notifySse = sseDebug;
}

// ---------------- SSE 长连接（单例；断线由 EventSource 自动重连） ----------------

let started = false;

/** 建立通知长连接（幂等；页面/PhoneShell 加载与首次推送都会调它） */
export function ensureNotifySse(): void {
  if (started || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  started = true;
  try {
    const es = new EventSource('/api/notify/stream');
    const syncState = () => {
      sseDebug.connected = es.readyState;
    };
    es.onopen = syncState;
    es.onerror = syncState; // 断线自动重连（readyState=0）；这里只同步调试读数
    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const p = JSON.parse(ev.data) as SseNotifyPayload;
        if (!p || typeof p.title !== 'string' || !p.title.trim()) return;
        sseDebug.received += 1;
        sseDebug.last = p;
        // 接收侧门禁：未授权 / 系统通知总闸关 / 前台（用户正看着本页）→ 只收不弹。
        // v75 前台闸门：多标签/回环场景下，可见的那个页面绝不弹系统通知（防刷屏）——
        // 只有「隐藏的后台标签页」才真正 showNotification（后台化标签的定时器被节流，
        // SSE 事件仍即时唤醒它弹通知，这正是本通道存在的意义）
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (!sysNotifyEnabled()) return;
        if (!isPageBackground()) return;
        void showSystemNotification(p.title, {
          body: p.body,
          tag: p.tag,
          icon: p.icon,
          badge: p.badge,
          data: { target: p.target },
        })
          .then((ch) => {
            if (ch) sseDebug.shown += 1;
          })
          .catch(() => null);
      } catch {
        /* 非法载荷静默丢弃 */
      }
    };
    syncState();
  } catch {
    /* SSE 不可用（极老浏览器）：发送侧有直发兜底 */
  }
}

/** 经服务端广播一条系统通知（返回是否成功送达广播通道；失败由调用方直发兜底） */
export async function pushSysNotifyViaSse(p: SseNotifyPayload): Promise<boolean> {
  ensureNotifySse();
  try {
    const r = await fetch('/api/notify/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// 模块加载即挂长连接（island-notify 被 PhoneShell 链路引入时本模块随之生效；
// 无需等第一条消息——「SSE 长连接」常开，服务端随时可推）
if (typeof window !== 'undefined') {
  ensureNotifySse();
}
