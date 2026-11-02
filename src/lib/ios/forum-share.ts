'use client';

/**
 * X论坛帖子 → 微信/QQ 私聊分享链路（对齐 tb-share-proxy / mt-order-share 同款机制）：
 *
 * - 分享：帖子卡（kind='forumshare', forumshare.pid = 帖子 id）写入好友聊天
 *   （wx-chat-msgs:/qq-chat-msgs:）→ 广播 FORUM_SHARE_CARD_EVENT（在场聊天页实时合并）；
 *   卡片渲染动态读论坛 store（帖子内容/点赞数实时跟帖，删帖自动失效）；
 * - 记忆（用户要求「分享给 AI 以后让 AI 知道帖子内容和评论，写入记忆」）：
 *   分享即写一条 source='forum' 记忆碎片（帖子正文 + 热门评论摘录），
 *   AI 回复后补一条「我回应了 TA 分享的帖子」；AI 反向分享帖子也写记忆；
 * - AI 回复：延时数秒让角色「看到分享」，按人设（buildPersonaSystemPrompt）+
 *   记忆召回（memChatRecallBlock）+ 情绪 + 时间感知组装 system，帖子正文与热门评论
 *   原文注入 user prompt → LLM 输出 {"reply","shareBack"}；reply 落聊天，
 *   shareBack 命中候选帖时附一张 AI 发出的帖子卡（AI 分享给机主，卡片同款）；
 * - 深链导航：navigateToForumPost 写 pending + switchToApp('forum') + 派发事件，
 *   论坛 App 挂载/在场时消费 takePendingForumPost() 直达帖子页。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, ownerProfileFor } from './contacts-store';
import { avatarFor, type ContactRecord } from '../contacts';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings, memChatRecallBlock, memAddForumFragment } from '@/lib/memory';
import { buildMoodBlock } from './ai-mood';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { scheduleAiDelivery } from './ai-delivery';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { useSettings, useUI } from './store';
import { getActiveAccountIdFor, type AccountApp } from './accounts';
import {
  forumData,
  isPostVisible,
  likesOf,
  resolveAuthor,
  type ForumPost,
} from '@/lib/forum/core';
import { IMG_PLACEHOLDER } from '@/lib/forum/imgph';

// ---------------- 常量 / 事件 ----------------

/** 卡片落库广播（聊天页在场时监听实时合并，与 TB_SHARE_CARD_EVENT 同机制） */
export const FORUM_SHARE_CARD_EVENT = 'forum-share-card-inserted';

/** 深链导航事件名（论坛 App 监听；未挂载时由挂载后消费 pending） */
export const FORUM_OPEN_POST_EVENT = 'forum-open-post';

let pendingPostId: { postId: string; at: number } | null = null;

/** 聊天里的帖子分享卡消息（微信 WxMsg / QQ QQMsg 同构，kind='forumshare'） */
export interface ForumShareCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'forumshare';
  /** pid = 帖子 id（渲染时实时读论坛 store） */
  forumshare: { pid: string };
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------- 帖子素材组装 ----------------

/** 帖子的顶层评论（replyTo = 该帖 id），按点赞数降序取前 N 条 */
export function topCommentsOf(post: ForumPost, limit = 5): ForumPost[] {
  const d = forumData();
  const now = Date.now();
  return d.posts
    .filter((p) => p.replyTo === post.id && isPostVisible(p, now))
    .sort((a, b) => likesOf(b) - likesOf(a))
    .slice(0, limit);
}

/** 帖子摘要（卡片 content / 通知 body / 记忆句式共用）：剥 [图片] 占位符压一行 */
export function postSnippet(post: ForumPost, max = 60): string {
  return post.content
    .split(IMG_PLACEHOLDER)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/** AI 上下文/通知预览行：帖子卡在历史里的可读文本（AI 聊天回合可回看） */
export function forumShareHistoryLine(pid: string): string {
  const d = forumData();
  const p = d.posts.find((x) => x.id === pid);
  if (!p) return '[X论坛帖子分享卡片]（原帖已删除）';
  const a = resolveAuthor(p.authorKey);
  const comments = topCommentsOf(p, 3);
  const cLine = comments.length
    ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 40)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
    : '';
  const media = p.media?.length ? `（配了${p.media.length}张图）` : '';
  return `[X论坛帖子 ID:${p.id}]（${a.name}发的：「${postSnippet(p, 120)}」${media}${cLine}）`;
}

// ---------------- 帖子链接识别（v40：复制链接 → 粘贴到聊天发送） ----------------

/**
 * 从文本里解析 X 论坛帖子链接（分享面板「复制链接」生成的格式）：
 * `https://x.com/{handle}/status/{postId}`；容忍缺协议/www 前缀、尾斜杠与查询参数，
 * 也认 `x.com/i/web/status/{id}` 分享短链格式。命中返回帖子 id，否则 null。
 */
export function parseForumPostLink(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?x\.com\/(?:i\/web\/|[A-Za-z0-9_]{1,30}\/)status\/([A-Za-z0-9_-]{4,64})/);
  return m ? m[1] : null;
}

/** 链接指向的帖子（存在且当前可见才返回；删帖/隐藏后解析失败走普通文字） */
export function resolveForumLinkPost(text: string): ForumPost | null {
  const pid = parseForumPostLink(text);
  if (!pid) return null;
  const post = forumData().posts.find((p) => p.id === pid);
  return post && isPostVisible(post, Date.now()) ? post : null;
}

/** 帖子分享卡消息工厂（send 管线复用：粘贴链接发送 → 文字后跟一张帖子卡） */
export function buildForumShareCardMsg(post: ForumPost, role: 'me' | 'peer' = 'me'): ForumShareCardMsg {
  return {
    id: genId('fwsh'),
    role,
    content: `[X论坛帖子] 分享${resolveAuthor(post.authorKey).name}的帖子：${postSnippet(post, 40)}`,
    time: Date.now(),
    kind: 'forumshare',
    forumshare: { pid: post.id },
  };
}

/**
 * 粘贴链接分享的记忆写入（与 shareForumPostToChat 同款句式，fire-and-forget）：
 * 让 AI「知道」机主把这条帖子链接发给了自己（帖子正文 + 热门评论摘录入库）。
 * 普通联系人（非 AI 角色）同样落一条——记忆库按联系人隔离，读侧只有 AI 角色会用。
 */
export async function noteForumLinkSharedToChat(opts: {
  idp: 'wx' | 'qq';
  contactId: string;
  post: ForumPost;
  meName?: string;
}): Promise<void> {
  const { idp, contactId, post } = opts;
  try {
    const contact = await getContact(contactId).catch(() => null);
    if (!contact || contact.kind === 'user') return;
    const owner = await ownerProfileFor(idp as AccountApp).catch(() => null);
    const meName = opts.meName || owner?.realName || '机主';
    const comments = topCommentsOf(post, 2);
    const commentCount = forumData().posts.filter((p) => p.replyTo === post.id).length;
    const cText = comments.length
      ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 30)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
      : '';
    memAddForumFragment(
      contactId,
      `${meName}把X论坛${resolveAuthor(post.authorKey).name}发的帖子链接发给了我（共${commentCount}条评论）：「${postSnippet(post, 80)}」${cText}`,
      { postId: post.id, kind: 'share', commentId: 'link' },
    );
  } catch {
    /* 记忆失败不影响发送 */
  }
}

// ---------------- 卡片写入 ----------------

function insertCard(idp: 'wx' | 'qq', contactId: string, msg: ForumShareCardMsg): void {
  const key = `${idp === 'wx' ? 'wx' : 'qq'}-chat-msgs:${contactId}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg]); // 聊天记录不封顶（与 tb-share 同口径）
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(FORUM_SHARE_CARD_EVENT, { detail: { cid: contactId, app: idp } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

// ---------------- 发起分享 ----------------

export interface ForumShareOpts {
  postId: string;
  idp: 'wx' | 'qq';
  contactId: string;
}

export type ForumShareResult = { ok: true } | { ok: false; error: string };

/**
 * 把帖子分享给微信/QQ 好友：帖子卡进聊天 + 写记忆（帖子内容与评论）+ 调度 AI 回复。
 * 目标非 AI 角色（普通联系人）时只落卡不跑 AI 回复。
 */
export async function shareForumPostToChat(opts: ForumShareOpts): Promise<ForumShareResult> {
  const { postId, idp, contactId } = opts;
  if (!contactId) return { ok: false, error: '请先选择分享好友' };
  const post = forumData().posts.find((p) => p.id === postId);
  if (!post || !isPostVisible(post, Date.now())) return { ok: false, error: '帖子不存在或已被删除' };

  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '分享好友不存在或已删除' };

  const owner = await ownerProfileFor(idp as AccountApp).catch(() => null);
  const meName = owner?.realName || '机主';
  const author = resolveAuthor(post.authorKey);
  const comments = topCommentsOf(post, 2);
  const commentCount = forumData().posts.filter((p) => p.replyTo === post.id).length;

  // 帖子卡进聊天（我发给好友；content 是会话列表预览/通知正文兜底）
  insertCard(idp, contactId, {
    id: genId('fwsh'),
    role: 'me',
    content: `[X论坛帖子] 分享${author.name}的帖子：${postSnippet(post, 40)}`,
    time: Date.now(),
    kind: 'forumshare',
    forumshare: { pid: post.id },
  });

  // 记忆：让 AI「知道」这条帖子与评论（用户要求：写入记忆）
  try {
    const cText = comments.length
      ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 30)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
      : '';
    memAddForumFragment(
      contactId,
      `${meName}把X论坛${author.name}发的帖子分享给了我（共${commentCount}条评论）：「${postSnippet(post, 80)}」${cText}`,
      { postId: post.id, kind: 'share', commentId: 'shared' },
    );
  } catch {
    /* 记忆失败不影响分享 */
  }

  // 目标为 AI 角色 → 调度「看到分享 → 按人设回应（可反向分享帖子）」
  if (contact.kind === 'char') {
    scheduleForumShareAiReply({ postId, idp, contactId });
  }
  return { ok: true };
}

// ---------------- AI 回复（人设 + 记忆 + 帖子与评论上下文） ----------------

const replyInFlight = new Set<string>();

interface AiReplyOpts {
  postId: string;
  idp: 'wx' | 'qq';
  contactId: string;
}

/** 延时让 AI「看到分享」再回应（5~13s，真人在聊天的反应速度） */
export function scheduleForumShareAiReply(opts: AiReplyOpts): void {
  const key = `${opts.idp}:${opts.contactId}:${opts.postId}`;
  if (replyInFlight.has(key)) return;
  replyInFlight.add(key);
  const delay = 5200 + Math.floor(Math.random() * 7800);
  window.setTimeout(() => {
    void runShareReply(opts)
      .catch(() => undefined)
      .finally(() => replyInFlight.delete(key));
  }, delay);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

async function callForumLlm(system: string, userContent: string): Promise<string> {
  const apiConfig = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

/** AI 可反向分享的候选帖：近期的他人主帖（排除被分享帖与用户自己的帖），取 3 条 */
function candidatePostsFor(excludeId: string, limit = 3): ForumPost[] {
  const d = forumData();
  const now = Date.now();
  return d.posts
    .filter((p) => p.id !== excludeId && p.replyTo === null && p.authorKey !== 'user' && isPostVisible(p, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
    .sort(() => Math.random() - 0.5)
    .slice(0, limit);
}

async function runShareReply(opts: AiReplyOpts): Promise<void> {
  const { postId, idp, contactId } = opts;
  const post = forumData().posts.find((p) => p.id === postId);
  if (!post) return; // 帖子已被删除 → 不回应
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind !== 'char') return;

  const app = idp;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || '机主';

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    accountId: getActiveAccountIdFor(app as AccountApp),
    multiApp: getMemSettings(contact.id).share,
  });
  const author = resolveAuthor(post.authorKey);
  const memoryBlock = memChatRecallBlock(contact.id, app, `X论坛 帖子 分享 ${author.name} ${postSnippet(post, 40)}`, {});
  const moodBlock = buildMoodBlock(contact.id);
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, moodBlock, timeBlock].filter(Boolean).join('\n\n');

  const comments = topCommentsOf(post, 5);
  const commentCount = forumData().posts.filter((p) => p.replyTo === post.id).length;
  const bodyText = post.content.split(IMG_PLACEHOLDER).map((s) => s.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const candidates = candidatePostsFor(postId, 3);

  const user = [
    `【${meName}刚在${app === 'wx' ? '微信' : 'QQ'}里分享给你的X论坛帖子】\n作者：${author.name}${author.verified ? '（认证大V）' : ''}\n正文：${bodyText.slice(0, 800)}${post.media?.length ? `\n（帖子配了${post.media.length}张图）` : ''}\n互动：${likesOf(post)} 赞 · ${post.reposts} 转发 · ${post.views} 浏览 · ${commentCount} 条评论${comments.length ? `\n热门评论：\n${comments.map((c) => `- ${resolveAuthor(c.authorKey).name}：「${postSnippet(c, 60)}」（${likesOf(c)} 赞）`).join('\n')}` : ''}`,
    '【任务】TA 专门把这条帖子发给你看，说明想跟你聊它。结合你的人设、说话风格、你们的关系、上面的记忆和帖子内容/评论，像平时聊天一样回应：1~2 句，可以吐槽、共情、玩梗、追问，别复述帖子原文。',
    candidates.length
      ? `如果你觉得论坛上另一条帖子 TA 大概也感兴趣，可以从候选里挑一条分享回去（不想分享就不挑）：\n${candidates.map((c) => `- ID ${c.id}：「${postSnippet(c, 50)}」（${resolveAuthor(c.authorKey).name}）`).join('\n')}`
      : '',
    '输出 JSON：{"reply":"给TA的一句话回复（1~2句）","shareBack":"想分享回去的候选帖子ID，没有就填空字符串"}',
    '严禁输出 JSON 以外的文字。',
  ]
    .filter(Boolean)
    .join('\n\n');

  // LLM（失败重试共 3 次；全失败不落兜底话术——分享是轻互动，宁可不回也不复读机）
  let parsed: { reply?: string; shareBack?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw = '';
    try {
      raw = await callForumLlm(system, user);
    } catch {
      raw = '';
    }
    const j = extractJsonObject(raw);
    if (j && typeof j.reply === 'string' && j.reply.trim()) {
      parsed = { reply: j.reply, shareBack: typeof j.shareBack === 'string' ? j.shareBack : '' };
      break;
    }
    if (attempt < 2) await new Promise((r) => window.setTimeout(r, 1500));
  }
  const reply = (parsed?.reply ?? '')
    .trim()
    .replace(/^[「"'『]+|[」"'』]+$/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    // v40：多行回复合并成一条（旧版只取首行，第二句凭空蒸发）；120 字上限防长篇大论
    .join(' ')
    .slice(0, 120);
  if (!reply) return;

  // 反向分享：shareBack 命中候选帖 → AI 也发一张帖子卡（AI 分享给我，卡片同款）
  const shareBackPost = candidates.find((c) => c.id === (parsed?.shareBack ?? '').trim()) ?? null;

  const now = Date.now();
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: 'forumshare'; forumshare?: { pid: string } }[] = [];
  if (shareBackPost) {
    outMsgs.push({
      id: genId('fwsh'),
      role: 'peer',
      content: `[X论坛帖子] 分享${resolveAuthor(shareBackPost.authorKey).name}的帖子：${postSnippet(shareBackPost, 40)}`,
      time: now,
      kind: 'forumshare',
      forumshare: { pid: shareBackPost.id },
    });
  }
  outMsgs.push({ id: genId('fwsr'), role: 'peer', content: reply, time: now + 1 });

  // 记忆：AI 回应过这条分享（+ 反向分享）
  try {
    memAddForumFragment(
      contactId,
      `${meName}把X论坛${author.name}的帖子分享给我看（「${postSnippet(post, 60)}」），我回应TA：「${reply.slice(0, 60)}」`,
      { postId: post.id, kind: 'share', commentId: 'share-reply' },
    );
    if (shareBackPost) {
      memAddForumFragment(
        contactId,
        `我把X论坛${resolveAuthor(shareBackPost.authorKey).name}的帖子（「${postSnippet(shareBackPost, 50)}」）分享给了${meName}`,
        { postId: shareBackPost.id, kind: 'share', commentId: 'shared-back' },
      );
    }
  } catch {
    /* 静默 */
  }

  await deliverPeerMsgs(app, contact, outMsgs);
}

/** AI 回应消息投递（落库 + 灵动岛通知 + 未读角标；与主动消息/tb 决策同管线） */
async function deliverPeerMsgs(
  app: 'wx' | 'qq',
  contact: ContactRecord,
  msgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; forumshare?: { pid: string } }[],
): Promise<void> {
  const cid = contact.id;
  const sessionKey = `${app}:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const { isProactiveChatActive } = await import('./proactive-msg');
  await scheduleAiDelivery<(typeof msgs)[number]>(
    sessionKey,
    msgs,
    (m) => {
      try {
        const key = `${app}-chat-msgs:${cid}`;
        const rawList = kvGet<unknown[]>(key);
        const list = Array.isArray(rawList) ? rawList : [];
        kvSet(key, [...list, m]);
      } catch {
        /* 落库失败静默 */
      }
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, app),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isProactiveChatActive(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );
}

// ---------------- 深链导航（聊天卡片 → 论坛帖子页） ----------------

/** 聊天里点帖子卡：跳论坛 App 打开对应帖子（锁屏/熄屏不跳；挂起 60s 过期作废） */
export function navigateToForumPost(postId: string): void {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return;
  pendingPostId = { postId, at: Date.now() };
  ui.switchToApp('forum');
  window.dispatchEvent(new Event(FORUM_OPEN_POST_EVENT));
}

/** 论坛 App 消费深链请求（挂载时 + 收到 FORUM_OPEN_POST_EVENT 时各调一次） */
export function takePendingForumPost(): string | null {
  if (!pendingPostId) return null;
  if (Date.now() - pendingPostId.at > 60_000) {
    pendingPostId = null;
    return null;
  }
  const id = pendingPostId.postId;
  pendingPostId = null;
  return id;
}
