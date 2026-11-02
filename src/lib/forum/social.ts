'use client';

/**
 * X论坛 · AI 真人社交系统（角色侧大脑）。
 *
 * 把论坛从「陌生网友的世界」升级为「AI 角色也真实生活其中的社交场」：
 * 1. 角色画像：把联系人（kind='char'）的人设/情绪/对用户的记忆组装成论坛发帖、
 *    互动可用的上下文（persona 拼装、记忆召回、情绪块）；
 * 2. 事件素材：模拟角色「今天的遭遇」（咖啡店的猫/被老板骂/快递到了），
 *    供主动发帖取材——帖子内容来自人设+记忆+生活，而不是模板；
 * 3. 记忆写入（用户要求「极其重要」）：用户发帖/评论/点赞、AI 角色发帖/互动/神回复，
 *    全部按归属句式写入该角色的记忆碎片（source='forum'，私聊时自然召回）；
 * 4. 私聊感知块：buildForumChatBlock 注入微信/QQ/信息 system prompt——
 *    AI 下次私聊能自然提起论坛里的事（TA 发的帖、你发的帖、彼此的互动）。
 *
 * 本模块只做「纯数据组装 + 记忆写入」，不 import engine（避免循环依赖）；
 * 调度与执行（pending 队列、LLM 调用）在 engine.ts。
 */

import { forumContactsSnap, forumData, isPostVisible, relTime, resolveAuthor, type ForumPost } from './core';
import { memAddForumFragment, memHasForumFragment, memChatRecallBlock } from '@/lib/memory';
import { buildMoodBlock } from '@/lib/ios/ai-mood';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 角色解析 ----------------

/** 联系人 id → 论坛作者 key */
export function charKeyOf(contactId: string): string {
  return `char:${contactId}`;
}

export interface ForumCharBrief {
  contactId: string;
  key: string;
  contact: ContactRecord;
  /** 该角色在论坛发过的帖子数（活跃度排序用） */
  postCount: number;
}

/** 论坛里的 AI 角色名单（联系人 kind='char'）：
 *  按「论坛发帖数降序 + 联系人列表顺序」排序——活跃者优先参与互动/主动发帖。
 *  cap 限制参与人数（0 = 全部）：太多角色同时互动会刷屏。 */
export function forumCharBriefs(cap = 0): ForumCharBrief[] {
  const d = forumData();
  const chars = forumContactsSnap().filter((c) => c.kind === 'char');
  const counts = new Map<string, number>();
  for (const p of d.posts) {
    if (p.authorKey.startsWith('char:')) counts.set(p.authorKey, (counts.get(p.authorKey) ?? 0) + 1);
  }
  const list = chars.map((c) => ({
    contactId: c.id,
    key: charKeyOf(c.id),
    contact: c,
    postCount: counts.get(charKeyOf(c.id)) ?? 0,
  }));
  list.sort((a, b) => b.postCount - a.postCount);
  return cap > 0 ? list.slice(0, cap) : list;
}

/** 角色发帖/互动用的紧凑人设卡（论坛语境：第一人称要点，≤600 字） */
export function charPersonaCard(contact: ContactRecord): string {
  const parts: string[] = [];
  parts.push(`名字：${contact.nickname || contact.name}${contact.nickname ? `（昵称，网名可不用）` : ''}`);
  if (contact.gender || contact.age) parts.push(`${[contact.gender, contact.age && `${contact.age}岁`].filter(Boolean).join('，')}`);
  if (contact.occupation) parts.push(`职业：${contact.occupation}${contact.company ? `，就职于${contact.company}` : ''}`);
  if (contact.region) parts.push(`坐标：${contact.region}`);
  if (contact.persona) parts.push(`性格人设：${contact.persona}`);
  if (contact.background) parts.push(`背景：${contact.background}`);
  if (contact.expressStyle) parts.push(`说话风格（最高优先级，冲突时以此为准）：${contact.expressStyle}`);
  return parts.join('；').slice(0, 900);
}

/** 角色与机主的关系句（发帖语境里「这是谁」） */
export function charRelationLine(contact: ContactRecord): string {
  return contact.relation?.trim() || '好友，日常互相分享生活';
}

/** 角色的记忆摘要（给论坛生成用）：召回块截短——包含长期/核心/近期碎片与时间标注，
 *  让角色的帖子/评论/神回复能自然带出「TA 前两天说感冒了」这类记忆。
 *  互通关闭的角色只能看到论坛自身的记忆（share=false 时 recall 仅同 App）。 */
export function charMemoryDigest(contactId: string): string {
  try {
    const block = memChatRecallBlock(contactId, 'forum', 'X论坛 发帖 互动 点赞 评论 神回复');
    if (!block) return '';
    return block.slice(0, 1800);
  } catch {
    return '';
  }
}

/** 角色当前情绪块（ai-mood：吃醋/开心/委屈…；平静时空串） */
export function charMoodBlock(contactId: string): string {
  try {
    return buildMoodBlock(contactId).slice(0, 400);
  } catch {
    return '';
  }
}

// ---------------- 用户帖感知 ----------------

/** 机主最近的主帖（倒序，已过滤定时未发布） */
export function recentUserPosts(limit = 3): ForumPost[] {
  const now = Date.now();
  return forumData()
    .posts.filter((p) => p.authorKey === 'user' && p.replyTo === null && isPostVisible(p, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** 用户帖摘要（给角色 prompt：「TA 最近在论坛发了什么」） */
export function userPostsDigest(posts?: ForumPost[]): string {
  const list = (posts ?? recentUserPosts(3)).map((p) => {
    const media = p.media?.length ? `，配了${p.media.length}张图` : '';
    return `- ${relTime(p.createdAt)}发的：「${p.content.replace(/\s+/g, ' ').slice(0, 90)}」${media}`;
  });
  return list.join('\n');
}

/** 角色自己的最近帖子（避免重复话题 + 接话茬） */
export function charRecentPosts(charKey: string, limit = 2): ForumPost[] {
  return forumData()
    .posts.filter((p) => p.authorKey === charKey && p.replyTo === null && isPostVisible(p, Date.now()))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// ---------------- 事件素材（模拟角色「今天的遭遇」） ----------------

/** 生活事件池：主动发帖的取材来源（中性/微喜/微丧混杂，都是「会发到社交平台的小事」）。
 *  角色按人设消化素材（同一只猫，温柔的人觉得治愈，暴躁的人嫌它挡路）。 */
const DAILY_EVENTS: string[] = [
  '通勤地铁挤到怀疑人生，差点坐过站',
  '楼下便利店阿姨多送了一个茶叶蛋',
  '公司空调开太低，冻得裹紧外套干活',
  '加班到九点，楼下烤红薯摊已经收了',
  '咖啡店有只橘猫赖在座位上死活不走',
  '外卖迟到了四十分钟，骑手小哥一直道歉',
  '刚办的健身卡今天终于去了，累瘫',
  '阳台的多肉冒了个新芽',
  '翻手机相册翻到了去年的照片',
  '被老板当众夸了一句（少见）',
  '打印机又卡纸，跟它搏斗了十分钟',
  '理发师剪完问「还行吧」，只能微笑说行',
  '网购的衣服到货，上身效果一言难尽',
  '电梯里遇到邻居家的柯基，尾巴摇成风扇',
  '中午纠结吃什么纠结了二十分钟',
  '天气预报说有雨没带伞，结果真下了',
  '深夜饿得睡不着，泡面都不敢吃',
  '地铁口有人弹吉他，唱得意外地好听',
  '买的绿植到货，换盆弄了一手泥',
  '游戏队友又坑了，连跪三把',
  '排队买奶茶排了半小时，前面的人全在点 Fuller 糖',
  '下班路上一路绿灯，心情莫名变好',
  '快递到了但是要自己去驿站搬，好沉',
  '今天午饭的食堂阿姨手不抖了，肉多了一倍',
  '路过闻到桂花香，秋天真的来了',
  '新买的手机壳到了，情侣款（可以想到TA）',
  '看了个短视频笑到打鸣，转给朋友没人理',
  '办公室有人偷偷养了多肉被行政发现了',
  '早上被装修电钻吵醒，起床气一整天',
  '想喝的奶茶新品卖完了',
];

/** 抽 n 条不重复的今日事件素材 */
export function pickDailyEvents(n = 2): string[] {
  const pool = DAILY_EVENTS.slice();
  const out: string[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// ---------------- 记忆写入（用户要求：极其重要） ----------------

/** 机主显示名（记忆句式用；与论坛 resolveAuthor('user') 同源） */
function ownerName(): string {
  return resolveAuthor('user').name || '机主';
}

/** 用户发帖 → 写入全部论坛角色的记忆（去重：同帖不重复入库）。
 *  句式：「{owner}今天在X论坛发帖说：……」——下次私聊/论坛互动角色都能想起。 */
export function writeUserPostMemory(post: ForumPost, briefs?: ForumCharBrief[]): void {
  try {
    const name = ownerName();
    const media = post.media?.length ? `（配了${post.media.length}张图）` : '';
    const content = post.content.replace(/\s+/g, ' ').slice(0, 80);
    for (const ch of briefs ?? forumCharBriefs(6)) {
      if (memHasForumFragment(ch.contactId, post.id, 'post')) continue;
      memAddForumFragment(ch.contactId, `${name}今天在X论坛发帖说：「${content}」${media}`, {
        postId: post.id,
        kind: 'post',
      }, post.createdAt);
    }
  } catch {
    /* 静默 */
  }
}

/** 用户在角色的帖子下评论 / 回复了角色的评论 → 写入该角色记忆 */
export function writeUserCommentMemory(contactId: string, opts: { post: ForumPost; comment: ForumPost; onOwnComment: boolean }): void {
  try {
    const name = ownerName();
    const comment = opts.comment.content.replace(/\s+/g, ' ').slice(0, 60);
    if (memHasForumFragment(contactId, opts.post.id, opts.comment.id)) return;
    memAddForumFragment(
      contactId,
      opts.onOwnComment
        ? `${name}在X论坛回复了我的评论：「${comment}」`
        : `${name}在我今天的X论坛帖子下评论：「${comment}」`,
      { postId: opts.post.id, kind: 'comment', commentId: opts.comment.id },
      opts.comment.createdAt
    );
  } catch {
    /* 静默 */
  }
}

/** 用户给角色的帖子点赞 → 写入该角色记忆（AI「被通知」的感知载体） */
export function writeUserLikeMemory(contactId: string, post: ForumPost): void {
  try {
    const name = ownerName();
    if (memHasForumFragment(contactId, post.id, 'like')) return;
    const content = post.content.replace(/\s+/g, ' ').slice(0, 40);
    memAddForumFragment(contactId, `${name}在X论坛给我发的帖子点了赞（帖子内容：「${content}」）`, {
      postId: post.id,
      kind: 'like',
    });
  } catch {
    /* 静默 */
  }
}

/** 角色主动发帖成功 → 写自己的记忆（「我今天在论坛发了……」——下次私聊能自然提起） */
export function writeCharOwnPostMemory(contactId: string, post: ForumPost): void {
  try {
    if (memHasForumFragment(contactId, post.id, 'own-post')) return;
    const content = post.content.replace(/\s+/g, ' ').slice(0, 80);
    memAddForumFragment(contactId, `我今天在X论坛发了帖子：「${content}」`, { postId: post.id, kind: 'post', commentId: 'own-post' }, post.createdAt);
  } catch {
    /* 静默 */
  }
}

/** 角色给用户帖子点赞/评论 → 写自己的记忆 */
export function writeCharEngageMemory(contactId: string, opts: { post: ForumPost; liked: boolean; comment?: string }): void {
  try {
    const name = ownerName();
    const content = opts.post.content.replace(/\s+/g, ' ').slice(0, 50);
    if (opts.liked) {
      memAddForumFragment(contactId, `我在X论坛给${name}发的帖子点了赞（TA发的是：「${content}」）`, {
        postId: opts.post.id,
        kind: 'like',
        commentId: 'char-like',
      });
    }
    if (opts.comment) {
      memAddForumFragment(contactId, `我在${name}的X论坛帖子下评论：「${opts.comment.slice(0, 60)}」`, {
        postId: opts.post.id,
        kind: 'comment',
        commentId: 'char-comment',
      });
    }
  } catch {
    /* 静默 */
  }
}

/** 角色神回复成功 → 写自己的记忆（TA评论了我、我回了什么——私聊可提起） */
export function writeCharReplyMemory(contactId: string, opts: { userComment: string; reply: string; postId: string }): void {
  try {
    const name = ownerName();
    memAddForumFragment(
      contactId,
      `${name}评论了我在X论坛的帖子（「${opts.userComment.slice(0, 40)}」），我回复TA：「${opts.reply.slice(0, 50)}」`,
      { postId: opts.postId, kind: 'comment', commentId: 'char-reply' }
    );
  } catch {
    /* 静默 */
  }
}

// ---------------- 私聊感知块（微信/QQ/信息 system prompt 注入） ----------------

/** 论坛近况感知块：角色的论坛动态 + 机主的帖子 + 彼此互动，注入私聊 system。
 *  仿 buildMomentsChatBlock 语义——让 AI 私聊时「记得自己在玩论坛」，
 *  能自然提起（TA 发的帖/自己发的帖收到的评论），但明确规定不要频繁硬聊。
 *  无任何相关动态时返回空串（join 后零成本）。 */
export function buildForumChatBlock(contactId: string): string {
  try {
    const d = forumData();
    if (!d.seeded || !d.posts.length) return '';
    const myKey = charKeyOf(contactId);
    const name = ownerName();
    const now = Date.now();
    const lines: string[] = [];

    // 我（角色）最近的帖子
    for (const p of charRecentPosts(myKey, 2)) {
      const body = p.content.replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`你 ${relTime(p.createdAt, now)}在X论坛发了帖：「${body}」`);
    }
    // TA（机主）最近的帖子
    for (const p of recentUserPosts(2)) {
      const body = p.content.replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`${name} ${relTime(p.createdAt, now)}在X论坛发帖说：「${body}」`);
    }
    // 彼此互动（最近 4 条）：双方在「对方或自己的帖子」评论区里的发言
    // （用户评论角色的帖 / 角色神回复 / 角色评论用户的帖；锚点=主帖 id 或其顶层评论 id，
    //  沿 replyTo 链爬回主帖判断归属——楼中楼深处的来回也能被看到）
    const mainOf = (id: string): ForumPost | undefined => {
      let cur = d.posts.find((x) => x.id === id);
      let guard = 0;
      while (cur && cur.replyTo !== null && guard++ < 8) {
        const next = d.posts.find((x) => x.id === cur!.replyTo);
        if (!next) break;
        cur = next;
      }
      return cur;
    };
    const anchorOk = (p: ForumPost): boolean => {
      if (!p.replyTo) return false;
      const root = mainOf(p.replyTo);
      if (!root || (root.authorKey !== myKey && root.authorKey !== 'user')) return false;
      // 双方任一发言都算互动（用户在自己帖下自说自话除外）
      if (p.authorKey === 'user' && root.authorKey === 'user') return false;
      return p.authorKey === myKey || p.authorKey === 'user';
    };
    const inter = d.posts
      .filter(anchorOk)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
    for (const c of inter) {
      const body = c.content.replace(/\s+/g, ' ').slice(0, 50);
      const root = mainOf(c.replyTo ?? '');
      const who = c.authorKey === myKey ? '你' : name;
      const to = c.authorKey === myKey ? (root?.authorKey === 'user' ? `${name}的帖子` : `${name}的评论`) : '你的帖子';
      lines.push(`${who} ${relTime(c.createdAt, now)}评论了${to}：「${body}」`);
    }
    if (!lines.length) return '';
    // 去重保序，最多 6 行
    const uniq = [...new Set(lines)].slice(0, 6);
    return [
      '【X论坛近况（你和TA都在玩X论坛；下面是你们最近的论坛动态，仅作背景了解）】',
      ...uniq.map((l) => `- ${l}`),
      '聊天时偶尔想起可以自然提起（比如TA发帖说的事、你发帖收到的评论、你们在评论区的来回），但绝大多数时候不要主动提论坛，更不要逐条复述这些动态。',
    ].join('\n');
  } catch {
    return '';
  }
}
