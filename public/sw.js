/**
 * Web Push Service Worker（退出网页后也收「每条消息一条系统通知」）＋ 静态资源 SWR 缓存。
 *
 * —— push 事件：每条推送 show 一条系统通知（tag 唯一 → 每条消息一个独立弹窗，不互相替换）；
 * —— 点击通知：聚焦已打开的页面 / 新开页面（落地到首页，由用户进入对应会话）。
 * 注册失败（iframe/不支持）静默降级：应用内灵动岛弹窗与页面隐藏时的 Web Notification 不受影响。
 *
 * —— v80 预览提速（资源缓存）：预览走外网网关时，dev 模式 /_next/static/chunks 是
 *   no-cache/must-revalidate —— 每次刷新 40+ 个 JS chunk 都要逐个发协商请求（每个一趟公网
 *   RTT），锁屏/APP 二次打开全部卡在资源重验证上。这里对「内容寻址」的静态资源做
 *   stale-while-revalidate：命中缓存立即返回（0 网络等待），同时后台拉网络刷新缓存，
 *   下次加载自然取到新版本；代码变更后 Turbopack 会生成新哈希 URL，新 URL 缓存未命中
 *   会直接走网络，不影响热更新。
 *   不缓存：HTML 导航、/api/**（含 SSE）、/_next/image（dev 优化器）、非 GET、跨域。
 */

/** 缓存版本号：资源缓存策略变更时 bump（旧缓存会在 activate 时清除） */
const CACHE_VER = 'ai-static-v80';

/** 可缓存的同源静态路径前缀（内容按文件名寻址、变更即换名） */
const CACHEABLE_PREFIXES = [
  '/_next/static/', // Turbopack chunks / media / css（URL 含内容哈希）
  '/icons/',
  '/icons-dark/',
  '/wallpapers/',
  '/home/',
  '/images/',
  '/stickers/',
  '/qq-emojis/',
  '/avatar-library/',
  '/tarot/',
  '/board-bg/',
  '/board-cards/',
  '/pets/',
  '/mt/',
  '/couriers/',
  '/fonts/',
  '/models/',
  '/goods/',
  '/goods-sketch/',
  '/gifts/',
  '/asr/',
];

/** 根路径下的单文件静态资源（PWA 清单与站点 logo） */
const CACHEABLE_EXACT = new Set(['/manifest.json', '/logo.svg']);

/** 该请求是否可走 SWR 缓存（同源 GET + 命中静态路径清单） */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    CACHEABLE_EXACT.has(url.pathname) ||
    CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p))
  );
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清除旧版本资源缓存（升级部署后自动失效）
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_VER).map((k) => caches.delete(k)),
        );
      } catch (e) {
        /* 缓存清理失败不影响激活 */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (!isCacheable(url)) return; // HTML 导航 / API / SSE 等直接放行
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VER);
      // ignoreVary：防御性处理（Next 响应可能携带 Vary 头，同 URL 静态资源无需按它区分）
      const cached = await cache.match(req, { ignoreVary: true }).catch(() => null);
      const net = fetch(req).catch(() => null);
      if (cached) {
        // stale-while-revalidate：立即回缓存，后台把网络结果写入缓存供下次使用
        event.waitUntil(
          net
            .then((res) => {
              if (res && res.status === 200) return cache.put(req, res.clone());
            })
            .catch(() => {}),
        );
        return cached;
      }
      const fresh = await net;
      if (fresh && fresh.status === 200) {
        const clone = fresh.clone();
        event.waitUntil(cache.put(req, clone).catch(() => {}));
      }
      return fresh || new Response('offline', { status: 504, statusText: 'offline' });
    })(),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : '新消息';
  const body = typeof data.body === 'string' ? data.body : '';
  const tag = typeof data.tag === 'string' ? data.tag : `push-${Date.now()}`;
  const url = typeof data.url === 'string' && data.url ? data.url : '/';
  // 角色头像（服务端携带的压缩 dataURL / 路径）：离线通知也显示「谁发来的」；
  // 缺失时回落到信息 App 图标（与历史行为一致）
  const icon = typeof data.icon === 'string' && data.icon ? data.icon : '/icons/chat.png';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      data: { url },
      badge: '/icons/wechat.png',
      silent: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data || {}) || {};
  const url = (typeof data.url === 'string' && data.url) || '/';
  // v75：点击跳转目标（页面经 showNotification data.target 下发；Web Push 载荷同理）
  // - 已有打开的页面：聚焦它 + postMessage 把 target 交回页面导航总线
  //   （island-notify 监听 'notify-nav' → 切 App + 打开对应聊天会话；锁屏时先记意图解锁后补跳）
  // - 没有已开页面：openWindow 带 #notify=<encoded> hash，应用启动后消费跳转
  const target = data.target && typeof data.target === 'object' ? data.target : null;
  const openUrl = target
    ? `/#notify=${encodeURIComponent(JSON.stringify(target))}`
    : url;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if (target) {
            try {
              client.postMessage({ type: 'notify-nav', target });
            } catch (e) {
              /* postMessage 失败不影响聚焦 */
            }
          }
          return;
        }
      }
      return self.clients.openWindow(openUrl);
    }),
  );
});
