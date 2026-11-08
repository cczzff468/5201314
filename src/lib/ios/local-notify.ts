'use client';

/**
 * 客户端本地通知统一入口（C2 推送到手机通知栏）：
 *
 * 三个事件源（Agent 任务完成 / AI 来电与语音留言 / 情侣小家便签）在「页面在后台」时
 * 应用内灵动岛弹窗看不见，这里补一条系统通知栏提醒：
 * - 前台（document.hidden === false）静默跳过 —— 用户正看着网页，页内弹窗已足够；
 * - 原生壳内（isNativePerception）直发 NativePerception.localNotify（Android 通知栏即达，
 *   APK 退到后台/锁屏也能弹，双权限闸在原生侧）；
 * - 纯浏览器/PWA 在通知权限 granted 时走 ensureSwRegistration()（复用 system-notify 幂等注册）
 *   → showNotification（tag 去重、icon 可选、data.url 供 sw.js notificationclick 聚焦/新开）；
 *   SW 不可用回落 new Notification（桌面可用；Android 页内无构造器 → 静默）。
 *
 * 与 web-push（push-client / /api/push）互不重复：那条是服务端下发（网页已关闭也能收），
 * 本模块是页面 JS 直发的「本地通知」，只在页面进程还活着但处于后台时生效。
 *
 * 全程 try-catch 静默：通知是锦上添花，绝不影响业务主链路。
 */

import { isNativePerception } from './native-perception';
import { ensureSwRegistration } from './system-notify';

export interface LocalNotifyOptions {
  /** 通知 tag：同 tag 后发替换先发（去重），cancelLocalNotify 按 tag 定向撤销 */
  tag?: string;
  /** 点击通知的落地页路径（sw.js notificationclick 读取 data.url 聚焦/新开窗口） */
  url?: string;
  /** 通知图标（缺省用 PWA 192 图标） */
  icon?: string;
}

/**
 * 「发后即忘」原生桥调用：只向 window.androidBridge.postMessage 投递 Capacitor 协议报文
 * {callbackId, pluginId:'NativePerception', methodName, options}（ln- 前缀 callbackId），
 * 不注册任何回包钩子 —— native-perception.ts 的 ensureBridgeHook 独占 onmessage/fromNative
 * 路由，未知 callbackId 被其静默忽略，因此零干扰、也不会把既有原生调用路由搞挂。
 * 代价是 JS 侧拿不到原生失败原因（如 Android 13+ 未授通知权限）——本就要求全程静默，等价满足。
 */
function nativeFireAndForget(methodName: string, options: Record<string, unknown>): void {
  try {
    const w = window as typeof window & { androidBridge?: { postMessage(data: string): void } };
    const bridge = w.androidBridge;
    if (!bridge || typeof bridge.postMessage !== 'function') return;
    const callbackId = `ln-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    bridge.postMessage(JSON.stringify({ callbackId, pluginId: 'NativePerception', methodName, options }));
  } catch {
    // 桥不可用/序列化失败 → 静默（调用方本就 fire-and-forget）
  }
}

/**
 * 页面在后台时弹一条系统通知（前台静默跳过，调用方无需自行判 hidden）：
 * notifyIfHidden('智能体', '任务已完成', { tag: 'agent', url: '/' })
 *
 * 三通道自适应：
 * ① APK 原生壳 → NativePerception.localNotify（通知栏即达，APK 在后台也弹）；
 * ② 浏览器/PWA 权限 granted → SW showNotification（Android 唯一正路，点击由 sw.js 处理）；
 * ③ SW 不可用 → new Notification 兜底（桌面；Android 页内无构造器 → catch 静默）。
 */
export async function notifyIfHidden(title: string, body: string, opts: LocalNotifyOptions = {}): Promise<void> {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    // 前台闸门：用户正看着页面 → 页内弹窗已足够，不发系统通知
    if (!document.hidden) return;

    // ① 原生壳：直发原生本地通知（权限闸/渠道/去重全在原生侧）
    if (isNativePerception()) {
      nativeFireAndForget('localNotify', {
        title,
        body,
        ...(opts.tag ? { tag: opts.tag } : {}),
      });
      return;
    }

    // ② 纯浏览器/PWA：无权限（默认 denied 或被拒）静默退出
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const payload: NotificationOptions & { data?: unknown } = {
      body,
      tag: opts.tag || `local-${Date.now().toString(36)}`,
      icon: opts.icon || '/icons/pwa/icon-192.png',
      // sw.js notificationclick 读 data.url 聚焦/新开落地页
      data: { url: opts.url || '/' },
    };
    try {
      const reg = await ensureSwRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, payload);
        return;
      }
    } catch {
      // SW 不可用（iframe 权限策略/注册失败）→ 落到页面构造器兜底
    }
    try {
      const n = new Notification(title, payload);
      n.onclick = () => {
        window.focus();
        n.close();
        if (opts.url) window.location.href = opts.url;
      };
    } catch {
      // Android 页内无 Notification 构造器（Illegal constructor）→ 静默
    }
  } catch {
    // 全程静默：通知绝不影响业务主链路
  }
}

/**
 * 撤销一条本地通知（与 notifyIfHidden 同通道对称）：
 * - 原生壳 → NativePerception.localNotifyCancel({tag})（按 (tag, tag.hashCode()) 配对 cancel）；
 * - 浏览器/PWA → SW getNotifications({tag}) 逐条 close。
 * 不受前台/后台限制（来电接起/已读等场景随时要撤），fire-and-forget 全程静默。
 */
export function cancelLocalNotify(tag: string): void {
  try {
    if (typeof window === 'undefined' || !tag) return;

    // ① 原生壳：定向撤销
    if (isNativePerception()) {
      nativeFireAndForget('localNotifyCancel', { tag });
      return;
    }

    // ② 浏览器/PWA：按 tag 检索已弹通知并关闭
    void (async () => {
      try {
        const reg = await ensureSwRegistration();
        if (!reg) return;
        const list = await reg.getNotifications({ tag });
        for (const n of list) n.close();
      } catch {
        // 静默
      }
    })();
  } catch {
    // 静默
  }
}
