'use client';

/**
 * Web Push 订阅客户端（退出网页后也收「每条消息一条系统通知」）：
 * - 前提：浏览器通知权限已 granted + 支持 Service Worker / PushManager；
 * - 注册 /sw.js → 取服务端 VAPID 公钥 → 订阅推送 → 上报订阅到 /api/push；
 * - 全程尽力而为：预览面板 iframe / iOS 非主屏 PWA / 不支持的浏览器都会静默失败，
 *   应用内灵动岛弹窗与页面隐藏时的 Web Notification 通道不受影响。
 * 由 island-notify 在通知权限变为 granted 时调用（模块内只跑一次）。
 *
 * 每次尝试的终态写入 localStorage（ios-push-status）：设置 › 通知页据此展示
 * 「订阅到哪一步失败」，否则订阅失败完全静默，用户开了权限也永远收不到系统通知却无从排查。
 */

/** 订阅尝试的终态（设置 › 通知页展示诊断用） */
export interface PushSetupStatus {
  /** subscribed=全链路成功；unsupported/sw-failed/key-failed/subscribe-failed=失败及原因 */
  state: 'subscribed' | 'unsupported' | 'no-permission' | 'sw-failed' | 'key-failed' | 'subscribe-failed';
  /** 失败细节（如 NotAllowedError；iframe 环境多为权限策略拦截） */
  detail?: string;
  at: number;
}

const STATUS_KEY = 'ios-push-status';

function saveStatus(status: Omit<PushSetupStatus, 'at'>): void {
  try {
    window.localStorage.setItem(STATUS_KEY, JSON.stringify({ ...status, at: Date.now() } satisfies PushSetupStatus));
  } catch {
    // 存储不可用忽略（诊断是尽力而为）
  }
}

/** 最近一次订阅尝试的终态（设置 › 通知页读取展示；无记录返回 null） */
export function lastPushStatus(): PushSetupStatus | null {
  try {
    const raw = window.localStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { state?: unknown; detail?: unknown; at?: unknown };
    if (typeof obj.state !== 'string') return null;
    return {
      state: obj.state as PushSetupStatus['state'],
      detail: typeof obj.detail === 'string' ? obj.detail : undefined,
      at: typeof obj.at === 'number' ? obj.at : 0,
    };
  } catch {
    return null;
  }
}

let tried = false;

export interface PushSetupOptions {
  /**
   * true = 重置「本页只尝试一次」单次锁，重跑完整订阅链路。
   * 修复：首次订阅瞬时失败后 tried 锁死，设置页所有恢复路径短路只能回显旧失败诊断，
   * 唯一办法刷新整页。仅用户主动恢复入口（设置页开关重开/重试按钮）传 force；
   * 首次自动订阅路径（island-notify）不传，保持只试一次，防每条消息都重试刷屏。
   */
  force?: boolean;
}

export async function setupPushSubscription(opts?: PushSetupOptions): Promise<PushSetupStatus> {
  if (tried && !opts?.force) return lastPushStatus() ?? { state: 'unsupported', detail: '本页已尝试过', at: 0 };
  tried = true;
  try {
    if (typeof window === 'undefined') return { state: 'unsupported', detail: '非浏览器环境', at: 0 };
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      const s = { state: 'unsupported' as const, detail: '浏览器不支持 Service Worker / Push' };
      saveStatus(s);
      return { ...s, at: Date.now() };
    }
    if (Notification.permission !== 'granted') {
      const s = { state: 'no-permission' as const };
      saveStatus(s);
      return { ...s, at: Date.now() };
    }
    // 同源安全上下文才可用（https 或 localhost）；iframe 里注册失败会走 catch 静默降级
    const reg = await navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      saveStatus({ state: 'sw-failed', detail: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (!reg) return lastPushStatus() ?? { state: 'sw-failed', at: Date.now() };
    const res = await fetch('/api/push').catch(() => null);
    if (!res || !res.ok) {
      const s = { state: 'key-failed' as const, detail: res ? `GET /api/push ${res.status}` : '网络错误' };
      saveStatus(s);
      return { ...s, at: Date.now() };
    }
    const data = (await res.json()) as { publicKey?: string };
    if (!data.publicKey) {
      const s = { state: 'key-failed' as const, detail: '服务端未返回公钥' };
      saveStatus(s);
      return { ...s, at: Date.now() };
    }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager
        .subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
        })
        .catch((err: unknown) => {
          saveStatus({
            state: 'subscribe-failed',
            detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          });
          return null;
        });
      if (!sub) return lastPushStatus() ?? { state: 'subscribe-failed', at: Date.now() };
    }
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    const s = { state: 'subscribed' as const };
    saveStatus(s);
    return { ...s, at: Date.now() };
  } catch (err) {
    const s = { state: 'subscribe-failed' as const, detail: err instanceof Error ? err.message : String(err) };
    saveStatus(s);
    return { ...s, at: Date.now() };
  }
}

/**
 * 退订 Web Push（设置 › 通知关闭「允许通知」时调用）：
 * - pushSubscription.unsubscribe + 通知服务端删除该订阅（/api/push DELETE，离线不再推）；
 * - 终态落 localStorage（ios-push-status，设置页回显）；全程尽力而为，失败不阻塞开关本身。
 * 返回退订后的状态（state 恒为 'no-permission'，detail 描述退订结果）。
 */
export async function teardownPushSubscription(): Promise<PushSetupStatus> {
  const off = (detail: string): PushSetupStatus => ({
    state: 'no-permission' as const,
    detail,
    at: Date.now(),
  });
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      const s = off('已在设置中关闭系统通知');
      saveStatus(s);
      return s;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) {
      const s = off('已在设置中关闭系统通知');
      saveStatus(s);
      return s;
    }
    const removed = await sub.unsubscribe().catch(() => false);
    if (removed) {
      // 服务端同步删除：页面关闭后服务端不再向本浏览器推送
      await fetch('/api/push', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => null);
    }
    const s = off(removed ? '已在设置中关闭系统通知，后台推送已退订' : '已在设置中关闭系统通知');
    saveStatus(s);
    return s;
  } catch {
    return off('已在设置中关闭系统通知');
  }
}

/** VAPID 公钥（base64url）→ applicationServerKey 所需的 Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
