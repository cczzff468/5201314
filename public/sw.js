/**
 * Web Push Service Worker（退出网页后也收「每条消息一条系统通知」）
 *   ＋ 静态资源 SWR 缓存 ＋ PWA 离线壳（v1.9.22）。
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
 *   不缓存：HTML 导航以外的动态请求、/api/**（含 SSE）、/_next/image（dev 优化器）、非 GET、跨域。
 *
 * —— v1.9.22 离线壳（「添加到主屏幕」安装后断网可开）：
 *   HTML 导航请求 network-first（在线零行为变化）→ 成功响应顺手写入壳缓存（归一化为 '/' 单键，
 *   携带 ?open= 深链/hash 变体不膨胀）→ 断网 / 超时(8s) / 5xx 时回退缓存壳（上次在线时整页
 *   HTML + 它引用的静态 chunk 都在缓存里 → 应用能完整启动，IndexedDB 数据本就在本地）→
 *   连壳缓存都没有（装完从没成功打开过）才回退内联「离线提示页」。
 *   壳缓存与静态缓存同版本（v82）：版本升级 activate 时一并重建（v1.9.35 删除 shizuku-agent/shizuku-lab 模块，旧缓存会引用已删 chunk——bump 强制全量重建），杜绝「新 HTML 引用已被
 *   清掉的旧 chunk」的分叉；静态缓存加 400 条 FIFO 上限，防 dev 热编译 chunk 无限膨胀。
 */

/** 缓存版本号：缓存策略变更时 bump（旧缓存会在 activate 时清除） */
const CACHE_VER = 'ai-static-v82';
/** 离线壳缓存（HTML 导航；与静态缓存同版本号，activate 一并清理重建） */
const SHELL_CACHE = 'ai-shell-v82';
/** 壳缓存键：所有导航变体（?open=… / #hash）归一化为根路径单键，防变体膨胀 */
const SHELL_KEY = new URL('/', self.location.origin).href;
/** 静态缓存条目上限（FIFO 修剪：dev 热编译不断换 chunk URL，不设限会无限膨胀） */
const MAX_STATIC_ENTRIES = 400;
/** 导航请求网络超时：超时即回退缓存壳（弱网/被劫持网络不干等） */
const NAV_TIMEOUT_MS = 8000;

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

/** 缓存 FIFO 修剪：超出上限删最旧条目（Cache.keys() 按插入序） */
async function trimCache(cache, max) {
  try {
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (let i = 0; i < keys.length - max; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) {
    /* 修剪失败不影响主流程 */
  }
}

/** 带超时的 fetch：超时按网络失败处理（导航回退缓存壳） */
function fetchWithTimeout(req, ms) {
  return Promise.race([
    fetch(req),
    new Promise((_, reject) => setTimeout(() => reject(new Error('nav-timeout')), ms)),
  ]);
}

/** 内联离线提示页（壳缓存也没有时兜底：装完从没成功打开过/首次离线访问） */
const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<title>AI Phone · 离线</title><style>' +
  'html,body{margin:0;height:100%;background:#f2f2f7;color:#1c1c1e;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;}' +
  '@media (prefers-color-scheme:dark){html,body{background:#000;color:#f2f2f7}}' +
  '.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center;}' +
  '.icon{font-size:56px;line-height:1}' +
  'h1{font-size:20px;margin:6px 0 0}' +
  'p{font-size:14px;line-height:1.7;color:rgba(60,60,67,.72);margin:0;max-width:300px}' +
  '@media (prefers-color-scheme:dark){p{color:rgba(235,235,245,.6)}}' +
  'button{margin-top:10px;padding:10px 28px;font-size:15px;border:none;border-radius:999px;background:#34c759;color:#fff;cursor:pointer}' +
  'button:active{filter:brightness(.9)}' +
  '</style></head><body><div class="wrap">' +
  '<div class="icon">📴</div><h1>当前无网络连接</h1>' +
  '<p>AI Phone 需要联网完成首次打开。<br>连上网后再试——已打开过的页面之后可离线使用，聊天记录与照片等数据一直存在本机。</p>' +
  '<button onclick="location.reload()">重试</button>' +
  '</div><script>addEventListener("online",function(){location.reload()});</script></body></html>';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清除旧版本缓存（升级部署后自动失效：静态 + 离线壳一并重建，杜绝新旧分叉）
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_VER && k !== SHELL_CACHE).map((k) => caches.delete(k)),
        );
      } catch (e) {
        /* 缓存清理失败不影响激活 */
      }
      // 顺手修剪静态缓存（防 dev 热编译 chunk 无限膨胀）
      try {
        trimCache(await caches.open(CACHE_VER), MAX_STATIC_ENTRIES);
      } catch (e) {
        /* 修剪失败不影响激活 */
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
  if (url.origin !== self.location.origin) return;

  // PWA 离线壳：HTML 导航（文档请求）network-first + 缓存回退 + 内联离线页
  if ((req.mode === 'navigate' || req.destination === 'document') && !url.pathname.startsWith('/api/')) {
    event.respondWith(handleNavigation(event, req));
    return;
  }

  if (!isCacheable(url)) return; // API / SSE / 图片优化器等直接放行
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

/** HTML 导航：network-first → 缓存壳 → 内联离线页（详见文件头 v1.9.22 注释） */
async function handleNavigation(event, req) {
  const shell = await caches.open(SHELL_CACHE);
  let net = null;
  try {
    net = await fetchWithTimeout(req, NAV_TIMEOUT_MS);
  } catch (e) {
    net = null; // 断网 / 超时 → 走缓存壳
  }
  if (net && net.ok) {
    // 在线：原样返回，同时后台把整页 HTML 归一化写入壳缓存（深链/hash 变体共用单键）
    event.waitUntil(
      (async () => {
        try {
          await shell.put(SHELL_KEY, net.clone());
          trimCache(await caches.open(CACHE_VER), MAX_STATIC_ENTRIES);
        } catch (e) {
          /* 写缓存失败不影响本次响应 */
        }
      })(),
    );
    return net;
  }
  // 断网 / 超时 / 5xx：回退缓存壳（上次在线时的整页 HTML + 静态 chunk 均在缓存）
  const cached = await shell.match(SHELL_KEY, { ignoreVary: true }).catch(() => null);
  if (cached) return cached;
  if (net) return net; // 4xx 等非 5xx 真实响应原样透出（由应用/浏览器自行呈现）
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

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
  // target（点击跳转目标，服务端 push-send 载荷携带）透传进通知 data ——
  // notificationclick 读到后 postMessage/hash 回页面，点击推送通知直达对应会话
  const ntfData = { url, ...(data.target && typeof data.target === 'object' ? { target: data.target } : {}) };
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      data: ntfData,
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
  // v1.9.10：恢复直达会话（v1.9.6 基线行为），不再回传 title/body/tag 构造展开面板
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
