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
// C6 应用内通知中心：记录钩子（先于通道判断）+ 原生点击回传处理（已读/导航/收面板）
import { recordCenterNotification, removeCenterByTag, openCenterItem } from './notification-center';

export interface LocalNotifyOptions {
  /** 通知 tag：同 tag 后发替换先发（去重），cancelLocalNotify 按 tag 定向撤销 */
  tag?: string;
  /** 点击通知的落地页路径（sw.js notificationclick 读取 data.url 聚焦/新开窗口） */
  url?: string;
  /** 通知图标（缺省用 PWA 192 图标） */
  icon?: string;
  /** C5 点击直达目标（与 island-notify NotifyTarget 同构的纯对象，如 { app: 'phone' }）：
   *  - SW 通道随 data.target 透传 → sw.js notificationclick 读到后 postMessage 回页面
   *    导航总线（island-notify 监听 'notify-nav' → switchToApp 切到目标 App）；
   *  - 原生通道序列化为 JSON 字符串随 NativePerception.localNotify({target}) 透传，
   *    点击通知由原生侧注入 'local-notify-open' 事件回传（事件契约见 NativePerceptionPlugin）。 */
  target?: unknown;
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

    // ★★★ C6 通知中心记录钩子：必须放在一切通道判断之前 ★★★
    // 原因：下方逻辑会因「前台」（document.hidden === false，不发系统通知）、「原生壳内」
    // 「浏览器权限未授予」等闸门提前 return——任何一条通道闸门都不该影响历史记录。
    // 通知中心的核心价值是「网页端没弹出系统通知也能回看历史，不漏消息」，
    // 所以无论前台后台、无论最终走原生还是浏览器通道、无论通知是否真弹出，
    // 都先在中心里记一条；同 tag 由 store 走替换逻辑（对齐 Android tag 去重心智）。
    // target 是并行任务 2-b 正在加的可选字段，这里按 unknown 容错透传，不动本文件类型定义。
    recordCenterNotification({
      title,
      body,
      ...(opts.tag ? { tag: opts.tag } : {}),
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.icon ? { icon: opts.icon } : {}),
      ...((opts as { target?: unknown }).target !== undefined
        ? { target: (opts as { target?: unknown }).target }
        : {}),
    });

    // 前台闸门：用户正看着页面 → 页内弹窗已足够，不发系统通知
    if (!document.hidden) return;

    // ① 原生壳：直发原生本地通知（权限闸/渠道/去重全在原生侧）
    if (isNativePerception()) {
      nativeFireAndForget('localNotify', {
        title,
        body,
        ...(opts.tag ? { tag: opts.tag } : {}),
        // C5 点击直达透传：url = 落地页路径字符串；target = 序列化为 JSON 字符串
        //（原生侧 parse 失败只带 url，事件契约见 NativePerceptionPlugin.injectLocalNotifyOpen）
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.target !== undefined ? { target: JSON.stringify(opts.target) } : {}),
      });
      return;
    }

    // ② 纯浏览器/PWA：无权限（默认 denied 或被拒）静默退出
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const payload: NotificationOptions & { data?: unknown } = {
      body,
      tag: opts.tag || `local-${Date.now().toString(36)}`,
      icon: opts.icon || '/icons/pwa/icon-192.png',
      // sw.js notificationclick 读 data.url 聚焦/新开落地页；带 target（对象）时
      // 优先 postMessage 回页面导航总线（island-notify → switchToApp 精确切 App）
      data: {
        url: opts.url || '/',
        ...(opts.target !== undefined && opts.target !== null ? { target: opts.target } : {}),
      },
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
        // C5：页面构造器兜底只按 url 落地 —— island-notify 的 navigateFromSystemNotify
        // 未导出（不可在不改该文件的前提下走 target 导航总线），target 精确导航仅 SW 通道支持
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

    // C6 同步钩子：撤销系统通知的同时，移除通知中心内同 tag 条目（不依赖通道分支，
    // 原生/浏览器哪条路都撤，与记录钩子「先于通道判断」同一口径）
    removeCenterByTag(tag);

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

// ---------------- C6：原生通知点击事件监听（幂等，client-only） ----------------

/**
 * 原生点击契约（并行任务 2-b 在 APK 原生侧实现）：
 * 用户点 APK 通知栏里的本地通知 → WebView 收到 MessageEvent('local-notify-open')，
 * event.data = { url: string, target?: object }。
 *
 * 收到后（经 notification-center.openCenterItem 统一处理）：
 * ① markRead：按 url（有 tag 场景由 store 侧 tag 优先匹配）把中心内对应条目置已读；
 * ② 导航：有 target 走 island-notify.navigateFromSystemNotify（App 内切页，不整页刷新），
 *    否则 window.location.href = url（'/' 不跳）；
 * ③ 导航后自动收起通知中心面板（store.closeCenter，UI 订阅后播收起动画）。
 *
 * 双形态兼容：主通道按事件类型 'local-notify-open' 监听（new MessageEvent(type, {data})）；
 * 兼容通道按 window message + data.type === 'local-notify-open'（部分 WebView bridge 以
 * message 投递）。两通道可能同帧重复触发 → 400ms 去重窗，重复调用无害（已读幂等）但导航会双跳。
 */
if (typeof window !== 'undefined') {
  const w = window as typeof window & { __lnOpenListenerInstalled?: boolean };
  if (!w.__lnOpenListenerInstalled) {
    w.__lnOpenListenerInstalled = true; // 幂等闸：dev StrictMode/模块多次求值不重复挂
    let lastHandledAt = 0;
    const handleOpen = (data: unknown): void => {
      const d = data as { url?: unknown; target?: unknown } | null;
      if (!d || typeof d !== 'object') return;
      const now = Date.now();
      if (now - lastHandledAt < 400) return; // 双通道同帧去重
      lastHandledAt = now;
      try {
        openCenterItem({
          ...(typeof d.url === 'string' ? { url: d.url } : {}),
          ...(d.target !== undefined ? { target: d.target } : {}),
        });
      } catch {
        // 全程静默：点击回传绝不影响主链路
      }
    };
    // 主通道：事件类型即 'local-notify-open'
    window.addEventListener('local-notify-open', (ev) => handleOpen((ev as MessageEvent).data));
    // 兼容通道：window message + data.type 事件名
    window.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (d && d.type === 'local-notify-open') handleOpen(d);
    });
  }
}

// ---------------- 测试钩子（仅 dev 生效） ----------------

/**
 * 测试钩子（仅 dev）：E2E/手工验证用 ——
 * window.__lnTest.notify(title, body, opts) 走真实入口 notifyIfHidden
 * （含「先于通道判断」的记录钩子：前台调用时通道闸门全部短路，但中心里必然有记录）；
 * window.__lnTest.cancel(tag) 走真实入口 cancelLocalNotify（验证中心内同 tag 条目同步移除）。
 * 生产构建（NODE_ENV=production）下不挂载，无任何暴露面。
 */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __lnTest?: {
      notify: (title: string, body: string, opts?: LocalNotifyOptions) => void;
      cancel: (tag: string) => void;
    };
  };
  w.__lnTest = {
    notify: (title, body, opts) => void notifyIfHidden(title, body, opts ?? {}),
    cancel: (tag) => cancelLocalNotify(tag),
  };
}
