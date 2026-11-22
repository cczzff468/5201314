'use client';

/**
 * X论坛 · 帖子记忆库（深度记忆 / 金鱼记忆，v42「帖子记忆」开关的数据层）。
 *
 * 记忆类型：type='forum_post'（用户规格五），带 accountId 区分大号/小号——
 *  存储格式：{ type: 'forum_post', postId, accountId, content, mediaCount, tags, createdAt, npcComments }
 *  · 正文/配图/话题标签在发帖时入库（配图以数量+占位入库，dataURL 体积大不入库）；
 *  · NPC 评论（含虚拟网友/AI 角色）落到「我的帖子」下时追加进 npcComments——
 *    「某 NPC 在我的哪个帖子里说了什么」；
 *  · 账号物理隔离：大号与小号各用独立 kv 键（forum-post-memories:main / :anon），
 *    互不可见；AI 侧仅在「该联系人已知情（用户亲口说破）」时才读 anon 仓。
 *
 * 金鱼模式（开关关）：所有写入函数直接跳过（论坛互动零落库），
 * 读取块返回空串（AI 提不起任何过往帖与评论）。
 *
 * 本模块只做数据读写与块拼装，不 import engine/social（避免循环依赖）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { ANON_KEY, isPostMemoryOn, isUserAuthor, relTime, resolveAuthor, type ForumPost } from './core';

// ---------------- 类型 ----------------

/** NPC 在我的帖子下说过的话（npcComments 条目） */
export interface ForumNpcComment {
  /** 评论者显示名（落库时快照；改名后不追溯——记忆记的是「当时谁说了什么」） */
  author: string;
  /** 评论者作者 key（去重用） */
  authorKey: string;
  /** 评论正文（截 80 字） */
  text: string;
  at: number;
}

/** 帖子记忆条目（用户规格五：type='forum_post' + account_id） */
export interface ForumPostMemory {
  type: 'forum_post';
  postId: string;
  /** 发帖账号：'main'（大号）| 'anon'（匿名小号）——两仓物理隔离 */
  accountId: 'main' | 'anon';
  /** 帖子正文（截 200 字；话题标签原样保留在正文里，另抽 tags 字段方便检索） */
  content: string;
  /** 配图数量（配图本体是 dataURL 体积大，不入库——记忆记「配了几张图」） */
  mediaCount: number;
  /** 话题标签（#xx# 形式，最多 3 个） */
  tags: string[];
  createdAt: number;
  /** NPC（虚拟网友/AI 角色）在这条帖下说过的评论（按时间序，每帖封顶 8 条） */
  npcComments: ForumNpcComment[];
}

// ---------------- 存储（main / anon 物理隔离） ----------------

/** 每账号主帖记忆上限（旧的滚动丢弃——记忆库只留近期，不无限增长） */
const PER_ACCOUNT_CAP = 40;
/** 每帖 NPC 评论条数上限（保留最新 8 条） */
const PER_POST_COMMENT_CAP = 8;

function keyOf(accountId: 'main' | 'anon'): string {
  return `forum-post-memories:${accountId}`;
}

function readList(accountId: 'main' | 'anon'): ForumPostMemory[] {
  try {
    const raw = kvGet<ForumPostMemory[]>(keyOf(accountId));
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof x === 'object' && x.type === 'forum_post' && typeof x.postId === 'string');
  } catch {
    return [];
  }
}

function writeList(accountId: 'main' | 'anon', list: ForumPostMemory[]): void {
  try {
    kvSet(keyOf(accountId), list.slice(-PER_ACCOUNT_CAP));
  } catch {
    /* 落库失败静默（记忆是增强能力，不阻断论坛主流程） */
  }
}

/** 帖子归属账号：user → main 仓；anon → anon 仓；其他作者（NPC/角色）不属于机主记忆 */
export function accountOfPost(post: ForumPost): 'main' | 'anon' | null {
  if (post.authorKey === ANON_KEY) return 'anon';
  if (post.authorKey === 'user') return 'main';
  return null;
}

// ---------------- 写入（全部受「帖子记忆」开关守卫） ----------------

/** 用户发帖 → 帖子记忆入库（正文/配图/话题标签）。开关关（金鱼）时零写入。 */
export function notePostPublished(post: ForumPost): void {
  try {
    if (!isPostMemoryOn()) return; // 金鱼模式：不写入长期记忆
    const account = accountOfPost(post);
    if (!account) return;
    const tags = (post.content.match(/#[^#\s]{1,14}#/g) ?? []).slice(0, 3);
    const rec: ForumPostMemory = {
      type: 'forum_post',
      postId: post.id,
      accountId: account,
      content: post.content.replace(/\s+/g, ' ').slice(0, 200),
      mediaCount: (post.media ?? []).length,
      tags,
      createdAt: post.createdAt,
      npcComments: [],
    };
    const list = readList(account).filter((x) => x.postId !== post.id);
    list.push(rec);
    writeList(account, list);
  } catch {
    /* 静默 */
  }
}

/**
 * NPC（虚拟网友/AI 角色）评论了「我的帖子」→ 追加进对应帖的 npcComments。
 * 「某 NPC 在我的哪个帖子里，说了什么话」——跨应用感知的素材源。
 * 同一条评论（同 postId+commentId）幂等；开关关（金鱼）时零写入。
 */
export function noteNpcCommentOnMyPost(myPostId: string, comment: ForumPost): void {
  try {
    if (!isPostMemoryOn()) return;
    if (isUserAuthor(comment.authorKey)) return; // 自己（大号/小号）的评论不记
    // 找归属仓：主帖可能是大号帖或小号帖
    for (const account of ['main', 'anon'] as const) {
      const list = readList(account);
      const idx = list.findIndex((x) => x.postId === myPostId);
      if (idx < 0) continue;
      if (list[idx].npcComments.some((c) => `${c.authorKey}::${c.text}` === `${comment.authorKey}::${comment.content.slice(0, 80)}`)) {
        return; // 幂等
      }
      const entry: ForumNpcComment = {
        author: resolveAuthor(comment.authorKey).name,
        authorKey: comment.authorKey,
        text: comment.content.replace(/\s+/g, ' ').slice(0, 80),
        at: comment.createdAt,
      };
      list[idx].npcComments = [...list[idx].npcComments, entry].slice(-PER_POST_COMMENT_CAP);
      writeList(account, list);
      return;
    }
    // 主帖不在库里（发帖时金鱼模式关着/更早的历史帖）→ 跳过（记忆从发帖时刻开始记）
  } catch {
    /* 静默 */
  }
}

/** 删除帖子时级联清掉对应记忆（保持「AI 不再引用已删内容」的全站口径） */
export function purgePostMemory(postId: string): void {
  for (const account of ['main', 'anon'] as const) {
    const list = readList(account);
    if (list.some((x) => x.postId === postId)) writeList(account, list.filter((x) => x.postId !== postId));
  }
}

// ---------------- 读取 ----------------

/** 某账号的帖子记忆（时间倒序）。认知规则由调用方把关（anon 仓仅说破后可读给 AI）。 */
export function listPostMemories(accountId: 'main' | 'anon', limit = 10): ForumPostMemory[] {
  try {
    return readList(accountId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * 跨应用感知块（微信/QQ/信息私聊 system prompt 注入）：
 * 「TA 前天发的帖子「…」下，网友「X」评论说「…」」——AI 能主动提起论坛近况。
 * · 金鱼模式（开关关）→ 空串（绝对不提起过往帖与评论）；
 * · 大号仓常驻；匿名小号仓仅在该联系人已知情（用户亲口说破）时并入（认知隔离）；
 * · 每帖带最近 1 条 NPC 评论（「那个谁谁谁的评论太逗了」的素材）。
 */
export function buildForumPostMemoryBlock(contactId: string, disclosed: boolean): string {
  try {
    if (!isPostMemoryOn()) return ''; // 金鱼记忆：零提起
    const recs = listPostMemories('main', 2);
    if (disclosed) recs.push(...listPostMemories('anon', 1)); // 说破后：小号帖也算「TA发的」
    if (!recs.length) return '';
    const now = Date.now();
    const lines = recs.slice(0, 3).map((r) => {
      const media = r.mediaCount ? `（配了${r.mediaCount}张图）` : '';
      const tags = r.tags.length ? `（话题：${r.tags.join(' ')}）` : '';
      // v43【NPC 记忆联动】：每帖带最近 2 条不同 NPC 的评论（私聊吐槽素材更足——
      //「哪个网友在哪个帖里说了什么」一眼可辨）
      const cLines = r.npcComments
        .slice(-2)
        .map((c) => `网友「${c.author}」评论说：「${c.text.slice(0, 40)}」`)
        .join('，');
      const cLine = cLines ? `，${cLines}` : '';
      return `- TA ${relTime(r.createdAt, now)}发的帖子：「${r.content.slice(0, 60)}」${media}${tags}${cLine}`;
    });
    return [
      '【TA的X论坛帖子记忆（TA最近发过的帖子与网友评论——可以自然提起，比如聊到相关话题时说「我看到你前几天发的那个帖子了，那个谁谁谁的评论太逗了」；不要逐条复述，更不要一口气全提）】',
      ...lines,
    ].join('\n');
  } catch {
    return '';
  }
}
