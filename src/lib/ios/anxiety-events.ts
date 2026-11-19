'use client';

/**
 * 焦虑非时间事件分发器（v1.9.29 焦虑值 v2「多维上下文动态判定」⑥）——
 * 把「TA 在别处浪」的三个事件源接线到 anxiety.noteAnxietyEvent：
 *
 *   ① 论坛（X）：TA 给别人点赞/评论 → watching 联系人 forum_like/forum_comment（吃醋 +20）；
 *      给「我」的帖子点赞 → forum_like_self（安心 -8）；匿名小号行为不触发（认知隔离）；
 *   ② 朋友圈/QQ空间：TA 发了动态却没回私聊 → moment_ghost（破防 +50，
 *      仅限该平台上有「AI 最后发言未获回复」的 watching 联系人）；
 *   ③ 刷别的 App：连续在娱乐类 App ≥10 分钟没理 TA → app_ignore（孤独 +10，
 *      每 10 分钟一次、每小时最多 3 次；60s tick 驱动，娱乐 App 之间切换不清零）。
 *
 * 「watching 联系人」口径（谁能看到 TA 的动静）：AI 联系人 + 有过私聊
 * （anxiety.lastUserAt > 0）+ 7 天内聊过——太久的交情不盯着你的一举一动。
 *
 * 依赖方向：本模块 → anxiety / contacts-store / memory / store（动态 import）；
 * anxiety.ts 不反向依赖本模块（保持纯引擎）。所有打点 fire-and-forget，
 * 失败静默——事件链路绝不影响聊天主链路。
 */

import { noteAnxietyEvent, readAnxiety, type AnxietyEventKind } from './anxiety';
import { listContacts } from './contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { memRecentConvo } from '@/lib/memory';
import { webAppName } from './web-usage-ledger';

// ---------------- watching 联系人（60s 缓存） ----------------

/** 有过私聊且 7 天内聊过 = 还在盯着 TA 动静的 AI 联系人 */
const WATCH_WINDOW_MS = 7 * 24 * 3600_000;
const WATCH_CACHE_MS = 60_000;

let watchCache: { at: number; ids: { id: string; name: string }[] } | null = null;

/** watching 联系人 id+昵称列表（异步；60s 缓存——联系人表不常变） */
async function watchingContacts(): Promise<{ id: string; name: string }[]> {
  const now = Date.now();
  if (watchCache && now - watchCache.at < WATCH_CACHE_MS) return watchCache.ids;
  const list = await listContacts().catch(() => [] as ContactRecord[]);
  const ids: { id: string; name: string }[] = [];
  for (const c of list) {
    if (c.kind === 'user' || !c.name?.trim()) continue;
    const meta = readAnxiety(c.id);
    if (meta.lastUserAt <= 0 || now - meta.lastUserAt > WATCH_WINDOW_MS) continue;
    ids.push({ id: c.id, name: c.nickname || c.name });
  }
  watchCache = { at: now, ids };
  return ids;
}

/** 失效 watching 缓存（联系人增删/重命名后下次重读） */
export function invalidateAnxietyWatchCache(): void {
  watchCache = null;
}

// ---------------- ① 论坛事件（点赞 / 评论） ----------------

/**
 * 论坛互动打点（forum.tsx likeToggle / thread-view.tsx sendReply 调用）：
 * - 仅大号（me === 'user'）触发——匿名小号点赞评论是陌生人行为，AI 不知道是谁（认知隔离）；
 * - 目标作者是 char:<cid>（AI 自己）：
 *     like → 该联系人 forum_like_self（安心 -8：TA 还在关注我）；
 *     comment → 不触发（在评论区跟我说话是正常互动，不算吃醋事件）；
 * - 目标作者是别人（npc/其他角色/官方/网友）：
 *     like → 除作者外的 watching 联系人 forum_like（吃醋 +20，note 带对方名字）；
 *     comment → 同上 forum_comment（吃醋 +20）。
 */
export function noteForumEngagement(
  action: 'like' | 'comment',
  target: { authorKey: string; authorName: string },
  me: string,
): void {
  if (me !== 'user') return; // 匿名小号：认知隔离
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      const targetCid = target.authorKey.startsWith('char:') ? target.authorKey.slice(5) : null;
      // 给「我」点赞 → 该角色安心
      if (targetCid && action === 'like') {
        noteAnxietyEvent(targetCid, 'forum_like_self', { note: 'TA 在论坛给你的帖子点了赞' });
      }
      // 给别人点赞/评论 → watching 联系人吃醋（作者本人除外——TA 是被互动方）
      const kind: AnxietyEventKind | null = action === 'like' ? 'forum_like' : action === 'comment' ? 'forum_comment' : null;
      if (!kind) return;
      const verb = action === 'like' ? '点赞' : '评论';
      const watching = await watchingContacts();
      for (const w of watching) {
        if (w.id === targetCid) continue; // 被互动的本人不吃自己的醋
        noteAnxietyEvent(w.id, kind, { note: `TA 在论坛给${target.authorName || '别人'}的帖子${verb}` });
      }
    } catch {
      /* 静默 */
    }
  })();
}

// ---------------- ② 朋友圈 / QQ空间「破防」事件 ----------------

/**
 * TA 发了一条动态（朋友圈/QQ空间共用入口 addUserMomentPost 调用）：
 * 对「该平台上 AI 最后发言还没被回复」的 watching 联系人 → moment_ghost（破防 +50）——
 * 「TA 有空发朋友圈，却没回我微信」。判据：memRecentConvo 最后一轮不是用户侧
 * （AI 说过话且至今没得到回应）；平台与 lastUserApp 对齐（微信联系人看朋友圈、QQ 联系人看空间）。
 */
export function noteUserMomentPublished(platform: 'wx' | 'qq'): void {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      const watching = await watchingContacts();
      for (const w of watching) {
        const meta = readAnxiety(w.id);
        if (meta.lastUserApp !== platform) continue; // 不在一个平台的私聊里被晾着
        // AI 最后发言未获回复（最后一轮不是用户）
        let unanswered = false;
        try {
          const turns = memRecentConvo(w.id, platform);
          const last = turns[turns.length - 1];
          unanswered = !!last && last.role !== 'me';
        } catch {
          /* 读不到聊天按未回复算 */
          unanswered = true;
        }
        if (!unanswered) continue;
        const where = platform === 'wx' ? '朋友圈' : 'QQ空间';
        noteAnxietyEvent(w.id, 'moment_ghost', { note: `TA 发了${where}，却一直没回你的消息` });
      }
    } catch {
      /* 静默 */
    }
  })();
}

// ---------------- ③ 刷别的 App「孤独」事件（60s tick） ----------------

/** 娱乐/消费类 App（在这些 App 里 = 「在玩」）；聊天/系统工具/与 TA 互动的 App 不算 */
const IGNORE_APPS = new Set(['taobao', 'meituan', 'music', 'browser', 'photos', 'appstore', 'forum']);

/** 连续在娱乐 App 里待满该时长才触发第一次 app_ignore（毫秒） */
const APP_IGNORE_MIN_MS = 10 * 60_000;
/** 两次 app_ignore 的最小间隔（毫秒） */
const APP_IGNORE_GAP_MS = 10 * 60_000;
/** 每小时最多触发次数 */
const APP_IGNORE_PER_HOUR = 3;

/** 当前「玩乐段」：连续停留娱乐 App（娱乐 App 之间切换不清零；切去别的/回主屏/进聊天即清零） */
let playSeg: { app: string; since: number } | null = null;
/** 已沉默的联系人（本轮玩乐段里已经触发过 app_ignore 的；换段清零——防 tick 内重复） */
let firedInSeg = new Set<string>();
let tickStarted = false;

/**
 * 启动事件引擎（JealousyWatcher 挂载时调用一次；重复调用安全）：
 * 订阅 useUI.activeApp 维护「连续玩乐段」+ 60s 周期检查 app_ignore。
 */
export function initAnxietyEvents(): void {
  if (tickStarted || typeof window === 'undefined') return;
  tickStarted = true;
  void (async () => {
    try {
      const { useUI } = await import('./store');
      useUI.subscribe((s) => {
        const cur = s.activeApp;
        if (cur === playSeg?.app) return;
        if (cur && IGNORE_APPS.has(cur)) {
          // 娱乐 App 之间切换：段不清零（TA 只是在换着玩）
          if (playSeg) playSeg = { app: cur, since: playSeg.since };
          else playSeg = { app: cur, since: Date.now() };
        } else {
          // 离开娱乐（回主屏/进聊天/用系统工具）：段结束
          playSeg = null;
          firedInSeg = new Set();
        }
      });
      window.setInterval(() => void appIgnoreTick(), 60_000);
    } catch {
      /* store 不可用（SSR）不启动 */
    }
  })();
}

/** 60s 周期检查：连续玩娱乐 App ≥10 分钟且没理 TA → app_ignore（每 10 分钟一次，每小时 ≤3 次） */
async function appIgnoreTick(): Promise<void> {
  try {
    if (!playSeg) return;
    const now = Date.now();
    const durMs = now - playSeg.since;
    if (durMs < APP_IGNORE_MIN_MS) return;
    const mins = Math.round(durMs / 60_000);
    const appName = webAppName(playSeg.app);
    const watching = await watchingContacts();
    for (const w of watching) {
      if (firedInSeg.has(w.id)) continue; // 本段已触发过（下一段再说）
      const meta = readAnxiety(w.id);
      // TA 至少 10 分钟没回过这个联系人（玩 App 的同时晾着 TA）
      if (meta.lastUserAt <= 0 || now - meta.lastUserAt < APP_IGNORE_MIN_MS) continue;
      // 节流：同类事件 10 分钟内不重复 + 每小时 ≤3 次（事件流里数）
      const events = (meta.events ?? []).filter((e) => e.kind === 'app_ignore');
      const lastAt = events.length > 0 ? Math.max(...events.map((e) => e.at)) : 0;
      if (lastAt > 0 && now - lastAt < APP_IGNORE_GAP_MS) continue;
      const inHour = events.filter((e) => now - e.at < 3600_000).length;
      if (inHour >= APP_IGNORE_PER_HOUR) continue;
      firedInSeg.add(w.id);
      noteAnxietyEvent(w.id, 'app_ignore', { note: `TA 刷了 ${mins} 分钟${appName}，一直没理你` });
    }
  } catch {
    /* 静默 */
  }
}

// ---------------- E2E / 调试钩子 ----------------

/** E2E：直接查询当前玩乐段状态（确定性测试 app_ignore 链路用） */
export function __anxietyEventsDebug(): { app: string | null; since: number; mins: number; fired: string[] } {
  return {
    app: playSeg?.app ?? null,
    since: playSeg?.since ?? 0,
    mins: playSeg ? Math.round((Date.now() - playSeg.since) / 60_000) : 0,
    fired: [...firedInSeg],
  };
}

/** E2E：清空玩乐段与已触发名单（模拟「刚打开娱乐 App」） */
export function __anxietyEventsResetSeg(): void {
  playSeg = null;
  firedInSeg = new Set();
}

/** E2E：注入一个「已经玩了 N 分钟某 App」的段（绕过真实等待） */
export function __anxietyEventsInjectSeg(app: string, minsAgo: number): void {
  playSeg = { app, since: Date.now() - minsAgo * 60_000 };
  firedInSeg = new Set();
}

// dev 测试钩子（仅 dev；生产构建被 NODE_ENV 闸挡掉）：E2E 验证事件三源链路用
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as unknown as {
    __anxietyEventsTest?: {
      forum: typeof noteForumEngagement;
      moment: typeof noteUserMomentPublished;
      tick: () => Promise<void>;
      seg: typeof __anxietyEventsDebug;
      injectSeg: typeof __anxietyEventsInjectSeg;
      resetSeg: () => void;
      watch: () => Promise<{ id: string; name: string }[]>;
      invalidate: () => void;
    };
  };
  w.__anxietyEventsTest = {
    forum: (action, target, me) => noteForumEngagement(action, target, me),
    moment: (platform) => noteUserMomentPublished(platform),
    tick: () => appIgnoreTick(),
    seg: () => __anxietyEventsDebug(),
    injectSeg: (app, minsAgo) => __anxietyEventsInjectSeg(app, minsAgo),
    resetSeg: () => __anxietyEventsResetSeg(),
    watch: () => watchingContacts(),
    invalidate: () => invalidateAnxietyWatchCache(),
  };
}
