'use client';

/**
 * 系统通知统一出口（SW showNotification 优先 + new Notification 兜底）：
 *
 * 为什么不能只用 new Notification(...)：
 * - Android Chrome / Edge 的页面里【没有】 Notification 构造器——直接调用抛
 *   "Illegal constructor"，系统通知必须经 Service WorkerRegistration.showNotification() 下发；
 * - 桌面 Chrome/Firefox/Safari 页面构造器可用，但 SW 通道在桌面同样可用且行为一致。
 *
 * 因此标准做法（与 MDN 指引一致）：已注册 SW → registration.showNotification()；
 * 未注册/注册失败 → new Notification 兜底（桌面环境）；都失败返回 null（应用内灵动岛弹窗兜底）。
 *
 * /sw.js 只挂了 push/notificationclick 处理器，注册它本身无副作用——这里按需懒注册并缓存，
 * 供「页面隐藏时弹系统通知」与「设置 › 通知 › 发送测试通知」共用。
 */

let swRegPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * 确保 /sw.js 已注册并返回 registration（不 push 也能用 showNotification）。
 * 失败（非安全上下文/不支持/被策略拦截）返回 null，由调用方走页面构造器兜底。
 */
export function ensureSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegPromise) {
    swRegPromise = (async () => {
      try {
        // 已有同 scope 注册直接复用（push-client 可能先注册过）
        const existing = await navigator.serviceWorker.getRegistration('/');
        if (existing) return existing;
        return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        return null;
      }
    })();
  }
  return swRegPromise;
}

export interface SystemNotifyOptions {
  body?: string;
  tag?: string;
  icon?: string;
  /** SW 通道角标（Android 状态栏小图标；页面构造器忽略） */
  badge?: string;
  onclick?: () => void;
}

export type SystemNotifyChannel = 'sw' | 'page' | null;

/**
 * 弹一条系统通知：SW 通道优先（全平台一致、Android 唯一正路）→ 页面构造器兜底。
 * 返回实际使用的通道；null = 两条路都失败（调用方自行降级应用内弹窗）。
 */
export async function showSystemNotification(title: string, options: SystemNotifyOptions = {}): Promise<SystemNotifyChannel> {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;
  const payload: NotificationOptions & { data?: unknown } = {
    body: options.body,
    tag: options.tag ?? `sys-${Date.now()}`,
    icon: options.icon,
    badge: options.badge,
  };
  // ① SW 通道：Android 全平台唯一可用；桌面同样支持（静默失败 → 兜底）
  try {
    const reg = await ensureSwRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, payload);
      // SW 通道的点击处理在 sw.js notificationclick（聚焦已有窗口）；页面内点击回调不可用
      return 'sw';
    }
  } catch {
    // SW 不可用（iframe 权限策略/注册失败）→ 落到页面构造器
  }
  // ② 页面构造器兜底：桌面可用；Android 抛 Illegal constructor → catch 返回 null
  try {
    const n = new Notification(title, payload);
    n.onclick = () => {
      window.focus();
      n.close();
      options.onclick?.();
    };
    return 'page';
  } catch {
    return null;
  }
}
