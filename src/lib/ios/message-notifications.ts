'use client';

/**
 * AI 消息系统通知模块（v2.4.30·一消息一弹窗重构）。
 *
 * 机主规格（第四十九轮，推翻 v2.4.29 的合并排版）：
 * 一、AI 每发一条独立的消息，系统就弹一条独立的横幅通知——绝不合并、绝不原地更新：
 *  - 每条消息的通知 tag = `msg-<消息id>`（id 全局唯一 → Android (tag,id) 对唯一，
 *    系统层面绝不互相覆盖/合并）；通知 int id 用消息 id 的稳定哈希（同 id 复算同值）；
 *  - 标题 = 角色名，正文 = 该条消息本身（超长由系统省略号折叠，下拉 BigTextStyle 全文）。
 * 二、通知图标（v2.4.33 方向根修·机主规格「左边图标变成我选择的图标，右面显示AI头像」）：
 *  - 小图标（通知卡左上）= 机主在 设置›APP图标 里选择的那一枚图标（appIcon 参数：
 *    原生侧下载解码成彩色位图小图标）；
 *  - 大图标（通知卡右侧）= 角色真实头像（avatar 参数；缺失不带大图标）。
 * 三、触发口径：只有 APP 在后台才弹系统通知（前台由应用内灵动岛横幅展示，
 *  点进 APP 聊天页即可看到完整消息，不需要一条条重新显示）。
 *
 * 入口：island-notify.maybeWebNotification 原生分支（信息/微信/QQ 三端 AI 消息投递共用）。
 */

import { useSettings } from './store';

/**
 * v2.4.35 图标过桥根修：原生层（HttpURLConnection）无法访问 WebView 的
 * https://localhost 源（Capacitor 请求拦截只对 WebView 生效）——旧版把
 * `https://localhost/icons/app/icon-1-192.png` 这类绝对 URL 直接传给原生，
 * 原生下载必败 → 小图标永远回落默认 ic_stat_cove（左上角从不变）、大图标
 * 路径头像时有时无（dataURL 头像能解、路径头像解不了）。
 *
 * 修法：JS 侧先把图标/头像转成 dataURL 再过桥——
 * - 头像：compressAvatarForPush（96px 圆形 JPEG + monogram 兑底，bg-turn 同源）。
 * - APP 图标：fetch → blob → FileReader → dataURL，localStorage 持久缓存
 *  （5 枚静态 PNG，冷启动也能秒取）。
 */

/** 消息通知请求（id 必填：每条消息一条独立通知） */
export interface MessageNotificationReq {
  /** 消息唯一 ID（通知 tag 与去重键：同一消息绝不弹第二条） */
  id: string;
  /** 通知标题（角色名） */
  title: string;
  /** 通知正文（消息正文） */
  body: string;
  /** 点击跳转目标（app + contactId；null = 仅打开 App） */
  target?: { app: string; contactId?: string } | null;
  /** 角色头像（路径 / dataURL；原生侧作通知大图标的回落） */
  avatar?: string | null;
}

/** 字符串 → 稳定 32 位哈希（消息 id → Android 通知 int id；同 id 复算同值） */
function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

/* ---------------- 串行队列（并发不被吞） ---------------- */

let chain: Promise<void> = Promise.resolve();

/** 已入队/已发送的消息 id 去重（同一消息绝不重复弹两条） */
const sentIds = new Set<string>();

/** 队列指标（设置页/调试可读：当前积压 + 累计发送） */
export const notifyStats = { queued: 0, sent: 0 };

/* ---------------- 图标规范化（v2.4.35：dataURL 过桥，原生可直接解码） ---------------- */

/** APP 图标 dataURL 内存缓存（v → Promise，防并发重复转换） */
const appIconCache = new Map<string, Promise<string | undefined>>();

/** 站内路径图标 → dataURL（fetch 走 WebView 拦截器可达；localStorage 持久缓存，
 *  失败返回 undefined → 原生回落默认小图标）。http(s) 绝对地址同网可下时也尝试转内嵌。 */
async function toDataUrl(src: string): Promise<string | undefined> {
  const v = useSettings.getState().appIcon;
  const cacheKey = src.startsWith('/icons/app/') && (v === '1' || v === '2' || v === '3' || v === '4' || v === '5') ? `notify-appicon:${v}` : `notify-img:${src.slice(0, 120)}`;
  // 持久缓存命中（同文件静态图标二次会话零开销）
  try {
    const hit = window.localStorage.getItem(cacheKey);
    if (hit && hit.startsWith('data:image/')) return hit;
  } catch {
    /* localStorage 不可用：内存缓存见下 */
  }
  let p = appIconCache.get(cacheKey);
  if (!p) {
    p = (async () => {
      try {
        const url = src.startsWith('data:') ? src : /^https?:\/\//i.test(src) ? src : new URL(src, window.location.origin).href;
        if (src.startsWith('data:')) return src;
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) return undefined;
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size > 400_000) return undefined;
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(new Error('read'));
          fr.readAsDataURL(blob);
        });
        if (!dataUrl.startsWith('data:image/')) return undefined;
        try {
          window.localStorage.setItem(cacheKey, dataUrl);
        } catch {
          /* 配额满：内存缓存仍生效 */
        }
        return dataUrl;
      } catch {
        return undefined;
      }
    })();
    appIconCache.set(cacheKey, p);
    if (appIconCache.size > 8) {
      const oldest = appIconCache.keys().next().value;
      if (oldest !== undefined && oldest.startsWith('notify-img:')) appIconCache.delete(oldest);
    }
  }
  return p;
}

/** 机主选择的 APP 图标（设置›APP图标，'1'~'5'）→ dataURL；读取/转换失败返回 undefined */
async function chosenAppIconDataUrl(): Promise<string | undefined> {
  try {
    const v = useSettings.getState().appIcon;
    if (v !== '1' && v !== '2' && v !== '3' && v !== '4' && v !== '5') return undefined;
    return await toDataUrl(`/icons/app/icon-${v}-192.png`);
  } catch {
    return undefined;
  }
}

/** 单条下发（内部）：走原生 localNotify（IMPORTANCE_HIGH 多渠道轮询 + BigTextStyle + 图标 dataURL 过桥）。
 *  v2.4.35：图标/头像全部转 dataURL 再过桥——原生 HttpURLConnection 访问不了 WebView 的
 *  localhost 源，旧版传绝对 URL 必败（左上角图标从不变 + 右侧头像时有时无的直接根因）。 */
async function postOne(req: MessageNotificationReq): Promise<boolean> {
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return false;
    // 头像 → 96px 圆形 JPEG dataURL（含 monogram 兑底，右侧头像永不缺席）；
    // APP 图标 → dataURL（左上角 = 机主所选图标）；两路并行转换
    const [avatarData, appIconData] = await Promise.all([
      import('./bg-turn').then(({ compressAvatarForPush }) => compressAvatarForPush(req.avatar ?? '', req.title)),
      chosenAppIconDataUrl(),
    ]);
    // v2.4.30 一消息一弹窗：tag = msg-<消息id>（唯一 → 系统绝不合并/覆盖）
    const ok = await np.localNotify({
      title: req.title,
      body: req.body,
      tag: `msg-${req.id}`,
      url: '/',
      target: req.target ?? undefined,
      // v2.4.35 图标方向 + dataURL 过桥：小图标 = 机主所选 APP 图标（dataURL）；
      // 大图标 = 角色 AI 头像（96px 圆形 JPEG dataURL，monogram 兑底）
      appIcon: appIconData,
      avatar: avatarData ?? undefined,
    });
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * 调度一条 AI 消息系统通知（规范入口）：
 * 1. 同一消息 id 只发一次（去重）；
 * 2. 入串行队列：顺序稳定，并发不被系统吞；
 * 3. 一条消息 = 一条独立通知（唯一 tag，绝不合并成「发来了 N 条」）。
 */
export function scheduleLocalNotification(req: MessageNotificationReq): void {
  if (typeof window === 'undefined') return;
  // 消息 id 去重——同一条消息绝不弹第二条
  if (sentIds.has(req.id)) return;
  sentIds.add(req.id);
  // 容量自限（极端长会话防泄漏：记住最近 500 条已发 id）
  if (sentIds.size > 500) {
    const it = sentIds.values();
    for (let i = 0; i < 100; i++) it.next();
    // Set 迭代顺序即插入顺序：丢掉最老的 100 条
  }
  notifyStats.queued += 1;
  chain = chain
    .then(async () => {
      const ok = await postOne(req);
      if (ok) notifyStats.sent += 1;
    })
    .catch(() => undefined)
    .finally(() => {
      notifyStats.queued = Math.max(0, notifyStats.queued - 1);
    });
}

/**
 * 撤销本模块发的全部消息通知（进聊天页清未读时用；与 localNotifyCancelByTagPrefix 同款，
 * 只清 msg- 前缀的本模块通知，常驻守护/其它通知不受影响）。
 */
export async function cancelAllMessageNotifications(): Promise<void> {
  try {
    const np = await import('./native-perception');
    if (!np.isNativePerception()) return;
    await np.localNotifyCancelByTagPrefix('msg-');
  } catch {
    /* 静默 */
  }
}

/** 调试口：当前队列状态 */
export function messageNotifySnapshot(): { queued: number; sent: number; ids: number } {
  return { queued: notifyStats.queued, sent: notifyStats.sent, ids: sentIds.size };
}

/** 消息 id → Android 通知 int id（导出给调试/设置页复用） */
export function notificationIdFor(msgId: string): number {
  return hashId(msgId);
}
