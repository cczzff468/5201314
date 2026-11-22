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
  isPostMemoryOn,
  isPostVisible,
  isUserAuthor,
  likesOf,
  resolveAuthor,
  ANON_KEY,
  type ForumPost,
} from '@/lib/forum/core';
import { isForumAnonDisclosed } from './forum-anon';
import { IMG_PLACEHOLDER } from '@/lib/forum/imgph';
import { extractTopicWords } from '@/lib/forum/topic';

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

/** 帖子作者在「该联系人认知里」的归因描述（匿名小号认知隔离/揭秘用）：
 *  · 匿名帖 + 未揭秘 → 陌生网友框架（AI 初始认知：这是个不认识的人发的）；
 *  · 匿名帖 + 已说破 → 「TA 的小号」框架（态度可以转变：调侃钓鱼/吃醋）；
 *  · 其他作者（NPC/大号/角色）→ 原名照述。 */
function authorCognitionOf(post: ForumPost, viewerContactId?: string): string {
  const a = resolveAuthor(post.authorKey);
  if (post.authorKey === ANON_KEY && viewerContactId) {
    return isForumAnonDisclosed(viewerContactId)
      ? `${a.name}（TA本人的小号，TA已向你承认过）`
      : `${a.name}（你不认识的陌生网友）`;
  }
  return a.name;
}

/** AI 上下文/通知预览行：帖子卡在历史里的可读文本（AI 聊天回合可回看）。
 *  viewerContactId（可选）：看这条历史的联系人——匿名小号帖按 TA 的认知序列化
 *  （未说破 = 陌生网友；说破后 = TA 的小号）。 */
export function forumShareHistoryLine(pid: string, viewerContactId?: string): string {
  const d = forumData();
  const p = d.posts.find((x) => x.id === pid);
  if (!p) return '[X论坛帖子分享卡片]（原帖已删除）';
  const authorDesc = authorCognitionOf(p, viewerContactId);
  const comments = topCommentsOf(p, 3);
  const cLine = comments.length
    ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 40)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
    : '';
  const media = p.media?.length ? `（配了${p.media.length}张图）` : '';
  return `[X论坛帖子 ID:${p.id}]（${authorDesc}发的：「${postSnippet(p, 120)}」${media}${cLine}）`;
}

// ---------------- 帖子链接识别（v40：复制链接 → 粘贴到聊天发送） ----------------

/**
 * 从文本里解析 X 论坛帖子链接（分享面板「复制链接」生成的格式）：
 * `https://x.com/{handle}/status/{postId}`；容忍缺协议/www 前缀、尾斜杠与查询参数，
 * 也认 `x.com/i/web/status/{id}` 分享短链格式。命中返回帖子 id，否则 null。
 * v39 审查修复：handle 段放宽到任意非斜杠/非空白字符（ sanitizeHandle 允许中文等
 * 自定义账号名——旧正则 [A-Za-z0-9_] 会让中文 handle 复制的链接粘贴后解析失败）。
 */
export function parseForumPostLink(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?x\.com\/(?:i\/web\/|[^\/?\s#]{1,40}\/)status\/([A-Za-z0-9_-]{4,64})/);
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
  idp: 'wx' | 'qq' | 'sms';
  contactId: string;
  post: ForumPost;
  meName?: string;
}): Promise<void> {
  const { idp, contactId, post } = opts;
  try {
    if (!isPostMemoryOn()) return; // v42 金鱼模式：论坛互动不写入长期记忆（当轮上下文仍带帖子原文，AI 能回应）
    const contact = await getContact(contactId).catch(() => null);
    if (!contact || contact.kind === 'user') return;
    const owner = await ownerProfileFor(idp as AccountApp).catch(() => null);
    const meName = opts.meName || owner?.realName || '机主';
    const comments = topCommentsOf(post, 2);
    const commentCount = forumData().posts.filter((p) => p.replyTo === post.id).length;
    const cText = comments.length
      ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 30)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
      : '';
    // 匿名小号帖：认知隔离——AI 记的是「TA把一个陌生网友的帖子发给了我」；
    // 已对 TA 说破（揭秘）→ 记忆直接关联「TA的小号」。
    const anonName = resolveAuthor(ANON_KEY).name;
    const anonNote =
      post.authorKey === ANON_KEY
        ? isForumAnonDisclosed(contactId)
          ? `${meName}把TA自己小号「${anonName}」发的X论坛帖子链接发给了我`
          : `${meName}把X论坛一个陌生网友「${anonName}」发的帖子链接发给了我（我不认识这个网友）`
        : `${meName}把X论坛${resolveAuthor(post.authorKey).name}发的帖子链接发给了我`;
    memAddForumFragment(
      contactId,
      `${anonNote}（共${commentCount}条评论）：「${postSnippet(post, 80)}」${cText}`,
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

  // 记忆：让 AI「知道」这条帖子与评论（用户要求：写入记忆）。
  // v42 金鱼模式（帖子记忆开关关）：分享属于论坛互动——不写入长期记忆
  //（当轮回应的上下文里仍有帖子原文，AI 照常回应；只是过后不再记得）。
  // 匿名小号帖：陌生网友框架（认知隔离——AI 初始认知是「一个陌生人发的帖子」）；
  // 已对该联系人说破（揭秘）→ 「TA的小号」框架（态度可以转变）。
  try {
    const cText = comments.length
      ? `，热门评论：${comments.map((c) => `「${postSnippet(c, 30)}」（${resolveAuthor(c.authorKey).name}）`).join('、')}`
      : '';
    if (isPostMemoryOn()) {
      const shareNote =
        post.authorKey === ANON_KEY
          ? isForumAnonDisclosed(contactId)
            ? `${meName}把TA自己小号「${author.name}」发的X论坛帖子分享给了我`
            : `${meName}把X论坛一个陌生网友「${author.name}」发的帖子分享给了我（我不认识这个网友）`
          : `${meName}把X论坛${author.name}发的帖子分享给了我`;
      memAddForumFragment(
        contactId,
        `${shareNote}（共${commentCount}条评论）：「${postSnippet(post, 80)}」${cText}`,
        { postId: post.id, kind: 'share', commentId: 'shared' },
      );
    }
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

/** 延时让 AI「看到分享」再回应（5~13s，真人在聊天的反应速度）；
 *  v41（D1）：三次全失败不再静默——2 分钟后自动补试一次（限一次，
 *  避开「分享出去石沉大海」的空转体感） */
export function scheduleForumShareAiReply(opts: AiReplyOpts): void {
  const key = `${opts.idp}:${opts.contactId}:${opts.postId}`;
  if (replyInFlight.has(key)) return;
  replyInFlight.add(key);
  const delay = 5200 + Math.floor(Math.random() * 7800);
  window.setTimeout(() => {
    void runShareReply(opts)
      .then((delivered) => {
        // v41（D1）：未投递且未补试过 → 2 分钟后自动补试一次（分享不该石沉大海）
        if (!delivered && !retryDone.has(key)) {
          retryDone.add(key);
          window.setTimeout(() => {
            void runShareReply(opts)
              .catch(() => undefined)
              .finally(() => retryDone.delete(key));
          }, 120_000);
          return;
        }
        retryDone.delete(key);
      })
      .catch(() => undefined)
      .finally(() => replyInFlight.delete(key));
  }, delay);
}

/** v41（D1）：已补试过一轮的分享回应（同一条分享最多补试一次） */
const retryDone = new Set<string>();

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

/** AI 可反向分享的候选帖（v41 D2：按机主兴趣挑，不再「近 12 帖随机抽 3」）：
 *  兴趣画像 = 机主最近的主帖话题词（extractTopicWords）——候选帖与这些词
 *  命中越多排序越靠前；无任何命中时退回近期随机（冷启动兼容）。 */
function candidatePostsFor(excludeId: string, limit = 3): ForumPost[] {
  const d = forumData();
  const now = Date.now();
  // 机主兴趣词：最近 5 条主帖（大号或匿名小号——都是 TA 本人聊什么 = 对什么感兴趣）
  // 的话题词去重汇总
  const myInterest = new Set<string>();
  for (const p of d.posts
    .filter((x) => isUserAuthor(x.authorKey) && x.replyTo === null && isPostVisible(x, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)) {
    for (const w of extractTopicWords(p.content)) myInterest.add(w);
  }
  const pool = d.posts
    .filter((p) => p.id !== excludeId && p.replyTo === null && !isUserAuthor(p.authorKey) && isPostVisible(p, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24);
  if (!pool.length) return [];
  if (!myInterest.size) {
    // 冷启动：无兴趣画像 → 近期随机（旧口径）
    return pool.slice(0, 12).sort(() => Math.random() - 0.5).slice(0, limit);
  }
  // 兴趣命中打分（命中的话题词数 × 2 + 随机扰动 0~1）；同分随机打散
  return pool
    .map((p) => {
      const text = postSnippet(p, 300);
      let hits = 0;
      for (const w of myInterest) if (w.length >= 2 && text.includes(w)) hits += 1;
      return { p, score: hits * 2 + Math.random() };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

async function runShareReply(opts: AiReplyOpts): Promise<boolean> {
  const { postId, idp, contactId } = opts;
  const post = forumData().posts.find((p) => p.id === postId);
  if (!post) return false; // 帖子已被删除 → 不回应
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind !== 'char') return false;

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

  // 匿名小号认知（用户规则三）：未说破 → 帖子作者对 AI 是陌生网友（可吐槽吃瓜，
  // 但绝不能认出是 TA 本人）；已说破（揭秘时刻）→ TA 的小号，态度可以转变。
  const isAnonPost = post.authorKey === ANON_KEY;
  const anonDisclosed = isAnonPost && isForumAnonDisclosed(contactId);
  const authorLine = authorCognitionOf(post, contactId);

  const comments = topCommentsOf(post, 5);
  const commentCount = forumData().posts.filter((p) => p.replyTo === post.id).length;
  const bodyText = post.content.split(IMG_PLACEHOLDER).map((s) => s.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const candidates = candidatePostsFor(postId, 3);

  const user = [
    `【${meName}刚在${app === 'wx' ? '微信' : 'QQ'}里分享给你的X论坛帖子】\n作者：${authorLine}${author.verified ? '（认证大V）' : ''}\n正文：${bodyText.slice(0, 800)}${post.media?.length ? `\n（帖子配了${post.media.length}张图）` : ''}\n互动：${likesOf(post)} 赞 · ${post.reposts} 转发 · ${post.views} 浏览 · ${commentCount} 条评论${comments.length ? `\n热门评论：\n${comments.map((c) => `- ${resolveAuthor(c.authorKey).name}：「${postSnippet(c, 60)}」（${likesOf(c)} 赞）`).join('\n')}` : ''}`,
    isAnonPost && !anonDisclosed
      ? '【作者身份】发这个帖子的人你不认识——就是一个陌生网友。你可以吐槽、吃瓜、评头论足，但绝对不要把这个人和TA（机主）本人或你们认识的任何人联系起来（不许出现「楼主不会是你吧」「这风格好熟悉」之类的话）。'
      : anonDisclosed
        ? '【作者身份】这个帖子其实是TA本人的小号（匿名账号）发的——TA已经向你承认过。你的态度可以转变：调侃TA钓鱼、吃醋、揭穿式吐槽都行，但别上升到真人吵架。'
        : '',
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
  if (!reply) return false;

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

  // 记忆：AI 回应过这条分享（+ 反向分享）。匿名小号帖按认知框架落句。
  // v42 金鱼模式：不写入长期记忆（过后不记得回应过）
  try {
    if (isPostMemoryOn()) {
      const replyNote =
        isAnonPost
          ? anonDisclosed
            ? `${meName}把TA自己小号「${author.name}」发的X论坛帖子分享给我看（「${postSnippet(post, 60)}」），我回应TA：「${reply.slice(0, 60)}」`
            : `${meName}把一个陌生网友「${author.name}」的X论坛帖子分享给我看（「${postSnippet(post, 60)}」），我回应TA：「${reply.slice(0, 60)}」`
          : `${meName}把X论坛${author.name}的帖子分享给我看（「${postSnippet(post, 60)}」），我回应TA：「${reply.slice(0, 60)}」`;
      memAddForumFragment(
        contactId,
        replyNote,
        { postId: post.id, kind: 'share', commentId: 'share-reply' },
      );
      if (shareBackPost) {
        memAddForumFragment(
          contactId,
          `我把X论坛${resolveAuthor(shareBackPost.authorKey).name}的帖子（「${postSnippet(shareBackPost, 50)}」）分享给了${meName}`,
          { postId: shareBackPost.id, kind: 'share', commentId: 'shared-back' },
        );
      }
    }
  } catch {
    /* 静默 */
  }

  await deliverPeerMsgs(app, contact, outMsgs);
  return true;
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
