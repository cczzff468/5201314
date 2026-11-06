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

// ---------------- 前台/后台判断（v75 通知触发方向修复） ----------------

/**
 * 页面是否获得过焦点（曾聚焦标记）：
 * - 顶层窗口直接打开时加载即有焦点；
 * - 预览面板等 iframe 场景：用户点进手机后才拿到焦点——在此之前不把「未聚焦」
 *   当成后台（否则页面一打开就弹系统通知，恰恰相反）；
 * - 用户点进来之后又切到别的窗口（blur）→ 才判定为「不在网页上」。
 */
let everFocused = typeof window !== 'undefined' && typeof document !== 'undefined' && document.hasFocus();

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    everFocused = true;
  });
}

/**
 * 用户是否「不在网页上」（v75）：系统通知（SW showNotification）只允许在后台时弹。
 * 判定（双信号）：
 * ① document.visibilityState === 'hidden'——切到别的标签页/最小化/切 App/锁屏（iframe 内同样可靠：
 *    顶层页隐藏时 iframe 文档也报告 hidden）；
 * ② 曾聚焦过但当前失焦（everFocused && !document.hasFocus()）——用户切到了同一窗口的
 *    别的窗口/别的应用，标签页仍「可见」但人已不在（预览面板 iframe 首次点击前不触发：
 *    everFocused=false 时保持前台判定，防误判）。
 * 前台（用户正看着网页）→ false → 调用方不弹任何系统通知（应用内灵动岛弹窗已足够）。
 */
export function isPageBackground(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return true;
  return everFocused && !document.hasFocus();
}

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
  /** v75：通知携带数据（透传到 notification.data）——sw.js notificationclick 读取
 *  data.target 后 postMessage 回页面，实现「点击系统通知跳回对应聊天界面」 */
  data?: unknown;
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
    // v75：点击跳转目标（sw.js notificationclick → client.postMessage → 页面导航总线）
    data: options.data,
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
