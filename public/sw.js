/**
 * Web Push Service Worker（退出网页后也收「每条消息一条系统通知」）：
 * - push 事件：每条推送 show 一条系统通知（tag 唯一 → 每条消息一个独立弹窗，不互相替换）；
 * - 点击通知：聚焦已打开的页面 / 新开页面（落地到首页，由用户进入对应会话）。
 * 注册失败（iframe/不支持）静默降级：应用内灵动岛弹窗与页面隐藏时的 Web Notification 不受影响。
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
