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

import { ANON_KEY, forumContactsSnap, forumData, isPostMemoryOn, isPostVisible, isUserAuthor, relTime, resolveAuthor, type ForumPost } from './core';
import { memAddForumFragment, memCountFragments, memHasForumFragment, memChatRecallBlock } from '@/lib/memory';
import { buildMoodBlock } from '@/lib/ios/ai-mood';
import { isForumAnonDisclosed } from '@/lib/ios/forum-anon';
import { buildForumPostMemoryBlock } from './post-memory';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- v44【AI 关注者】：关注请求检测 + 记忆 ----------------

/** 「让 TA 去论坛关注我」意图检测（聊天/私信文本）：
 *  明说型：去/上/到 x论坛 关注我；反向型：关注我的 x论坛/论坛号。
 *  inForum=true（论坛私信语境）时放宽：不带「论坛」字的「关注我」也算——
 *  对话已经在论坛里，指代无需重复。取关/别关注等否定式不算。 */
const FORUM_FOLLOW_ASK_RE =
  /(?:去|上|到|进|在|玩|有空)[^。！？!?\n]{0,14}(?:X论坛|x论坛|论坛)[^。！？!?\n]{0,14}(?:关注|follow|订阅)[^。！？!?\n]{0,10}(?:我|一下|我一下)|(?:关注|follow)[^。！？!?\n]{0,10}我[^。！？!?\n]{0,14}(?:的)?(?:X论坛|x论坛|论坛|论坛号|论坛主页|论坛账号)/;

export function wantsForumFollow(text: string, opts?: { inForum?: boolean }): boolean {
  const t = text ?? '';
  if (!t.trim()) return false;
  if (FORUM_FOLLOW_ASK_RE.test(t)) return true;
  if (opts?.inForum) {
    if (/(取关|别关注|不用关注|不要关注|不想让你关注)/.test(t)) return false;
    return /(关注|follow)[^。！？!?\n]{0,8}(?:我|一下我)/.test(t);
  }
  return false;
}

/** 角色关注/拒绝关注机主 → 写自己的记忆（v44【AI 关注者】；金鱼模式零写入）。
 *  关注成功：AI 私聊能自然提起「我关注你了」；拒绝：能解释为什么没关注。 */
export function writeCharFollowMemory(contactId: string, followed: boolean, source: 'chat' | 'dm' | 'self'): void {
  try {
    if (!isPostMemoryOn()) return;
    const name = ownerName();
    const line = followed
      ? source === 'self'
        ? `我在X论坛关注了${name}的主页（刷到TA的帖子，想长期看TA发的内容）`
        : `${name}让我去X论坛关注TA，我关注了TA的主页`
      : `${name}让我去X论坛关注TA，我没关注（${source === 'dm' ? 'TA在论坛私信里提的' : 'TA聊天时提的'}）`;
    memAddForumFragment(contactId, line, { postId: 'follow-ask', kind: 'share', commentId: `follow-${followed ? 'y' : 'n'}` });
  } catch {
    /* 静默 */
  }
}

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

/** 论坛里的 AI 角色名单（联系人 kind='char'）：全部返回，不再按发帖数截断。
 *  v41（A1 修复）：旧版「按发帖数降序取前 N」会固化小圈子——头部角色永远第一个反应、
 *  圈外角色永远轮不到；现在 cap 仅作展示排序参考，互动/发帖参与改由
 *  pickCharsWeighted 加权随机 + 单角色冷却轮换（B1），人人有机会、熟的更常来。 */
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

// ---------------- v41（A1+B1）互动轮换：好感/记忆加权随机 + 单角色冷却 ----------------

/** 单角色互动冷却（毫秒）：同一角色 8 小时内不重复参与「看到用户帖决定互动」，
 *  避免固定某人永远第一个反应。 */
const ENGAGE_COOL_MS = 8 * 3600_000;

/** 内存态互动冷却表（contactId → 最近一次参与 charEngage 的时刻；
 *  不落盘——冷却是「会话内轮换节奏」，App 重启清零反而像真人重新上线） */
const engageLastAt = new Map<string, number>();

/** 记录某角色刚参与了一次互动（排任务时调） */
export function noteCharEngaged(contactId: string): void {
  engageLastAt.set(contactId, Date.now());
}

/** 加权随机抽 k 位角色（不放回抽样；权重 = 熟悉度 + 活跃度 + 随机扰动）：
 *  - 熟悉度：记忆碎片数（memCountFragments，0~25 封顶线性）——与机主互动多的角色更可能回应；
 *  - 活跃度：论坛发帖数开方——爱发帖的人更常刷论坛（但不霸榜：开方压平数量级差距）；
 *  - 随机扰动：×(1~2.4) 均匀噪声——保证低权重角色也有稳定出场概率；
 *  - 冷却：8h 内刚参与过的权重归零（本轮不选），全部冷却时解禁最久的一位；
 *  - from：限定候选子集（如「发帖窗口已到期」的角色），缺省 = 全部角色。
 *  返回按抽中顺序排列（调用方按序错开延迟）。 */
export function pickCharsWeighted(k: number, from?: ForumCharBrief[]): ForumCharBrief[] {
  const all = from ?? forumCharBriefs(); // 全部角色参与抽签（A1：不再只有前 N 名）
  if (!all.length || k <= 0) return [];
  const now = Date.now();
  const pool = all
    .map((b) => {
      const cooled = now - (engageLastAt.get(b.contactId) ?? 0) >= ENGAGE_COOL_MS;
      const familiar = Math.min(memCountFragments(b.contactId), 25);
      const active = Math.sqrt(b.postCount);
      const noise = 1 + Math.random() * 1.4;
      return { b, w: cooled ? (1 + familiar * 0.16 + active * 0.3) * noise : 0 };
    })
    .filter((x) => x.w > 0);
  // 全员冷却中：解禁最久没互动的那位（保底不空转）
  if (!pool.length) {
    const stale = all.slice().sort((a, b) => (engageLastAt.get(a.contactId) ?? 0) - (engageLastAt.get(b.contactId) ?? 0))[0];
    return stale ? [stale] : [];
  }
  const picked: ForumCharBrief[] = [];
  let rest = pool.slice();
  while (picked.length < k && rest.length) {
    const total = rest.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let idx = rest.length - 1;
    for (let i = 0; i < rest.length; i++) {
      r -= rest[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(rest[idx].b);
    rest.splice(idx, 1);
  }
  return picked;
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
 *  互通关闭的角色只能看到论坛自身的记忆（share=false 时 recall 仅同 App）。
 *  v42【帖子记忆·金鱼】：开关关时排除 source='forum' 的碎片——角色在论坛生成里
 *  也提不起过往论坛互动（只针对当前帖子的上下文回复，当前帖正文走即时 prompt 不受影响）。 */
export function charMemoryDigest(contactId: string): string {
  try {
    const block = memChatRecallBlock(contactId, 'forum', 'X论坛 发帖 互动 点赞 评论 神回复', {
      excludeFragmentSources: isPostMemoryOn() ? undefined : ['forum'],
    });
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

// ---------------- B7（v41）：今日事件日内一致性 ----------------

/** 角色 × 日 的当日事件缓存（内存 Map；App 生命周期内同角色同一天拿到同一组事件，
 *  不会再「上午加班到九点、下午去了健身房」自相矛盾；跨天自动换新的一组） */
const dayEventsCache = new Map<string, string[]>();

function dayKeyOf(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 某角色今天的生活事件（当天内固定；同一天反复发帖引用同一遭遇，人设自洽） */
export function dailyEventsFor(charKey: string, n = 2): string[] {
  const day = dayKeyOf();
  const cacheKey = `${day}|${charKey}`;
  let evts = dayEventsCache.get(cacheKey);
  if (!evts) {
    // 跨天清理旧键（Map 不无限增长）
    for (const k of dayEventsCache.keys()) {
      if (!k.startsWith(`${day}|`)) dayEventsCache.delete(k);
    }
    evts = pickDailyEvents(2); // 每人每天固定 2 条备用素材
    dayEventsCache.set(cacheKey, evts);
  }
  return evts.slice(0, n);
}

// ---------------- 记忆写入（用户要求：极其重要） ----------------

/** 机主显示名（记忆句式用；与论坛 resolveAuthor('user') 同源） */
function ownerName(): string {
  return resolveAuthor('user').name || '机主';
}

/** 用户发帖 → 写入全部论坛角色的记忆（v43-B4 全面退役，保留签名避免调用方改动）。
 *  「{owner}今天在X论坛发帖说：……」记忆碎片通道与 v42 帖子记忆块全渠道重复
 *  （微信/QQ/信息走 buildForumChatBlock、论坛私信任 v43-A3 也注入块）——
 *  同一帖在 system prompt 里出现两遍，AI 一句话提两次「你那帖子」的元凶。
 *  深度模式由帖子记忆块独家覆盖；金鱼模式（开关关）本就零写入。
 *  其余 write*Memory（评论/点赞/角色自发帖/神回复）是块不覆盖的独有事件，照写。 */
export function writeUserPostMemory(_post: ForumPost, _briefs?: ForumCharBrief[]): void {
  void _post;
  void _briefs;
}

/** 用户在角色的帖子下评论 / 回复了角色的评论 → 写入该角色记忆。
 *  v42【帖子记忆·金鱼】：开关关时零写入。 */
export function writeUserCommentMemory(contactId: string, opts: { post: ForumPost; comment: ForumPost; onOwnComment: boolean }): void {
  try {
    if (!isPostMemoryOn()) return;
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

/** 用户给角色的帖子点赞 → 写入该角色记忆（AI「被通知」的感知载体）。
 *  v42【帖子记忆·金鱼】：开关关时零写入。 */
export function writeUserLikeMemory(contactId: string, post: ForumPost): void {
  try {
    if (!isPostMemoryOn()) return;
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

/** 角色主动发帖成功 → 写自己的记忆（「我今天在论坛发了……」——下次私聊能自然提起）。
 *  v42【帖子记忆·金鱼】：开关关时零写入（角色发帖同样不进长期记忆）。 */
export function writeCharOwnPostMemory(contactId: string, post: ForumPost): void {
  try {
    if (!isPostMemoryOn()) return;
    if (memHasForumFragment(contactId, post.id, 'own-post')) return;
    const content = post.content.replace(/\s+/g, ' ').slice(0, 80);
    memAddForumFragment(contactId, `我今天在X论坛发了帖子：「${content}」`, { postId: post.id, kind: 'post', commentId: 'own-post' }, post.createdAt);
  } catch {
    /* 静默 */
  }
}

/** 角色给用户帖子点赞/评论 → 写自己的记忆。
 *  v42【帖子记忆·金鱼】：开关关时零写入。 */
export function writeCharEngageMemory(contactId: string, opts: { post: ForumPost; liked: boolean; comment?: string }): void {
  try {
    if (!isPostMemoryOn()) return;
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

/** 角色神回复成功 → 写自己的记忆（TA评论了我、我回了什么——私聊可提起）。
 *  v42【帖子记忆·金鱼】：开关关时零写入。 */
export function writeCharReplyMemory(contactId: string, opts: { userComment: string; reply: string; postId: string }): void {
  try {
    if (!isPostMemoryOn()) return;
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

/** v46【楼主回复】AI 挑选网友评论回复成功 → 写自己的记忆（记忆联动：下次聊天能提起）。
 *  · ownPost（AI 自己的帖）：「网友XX在我帖子下说了XX，我回了TA」；
 *  · userPost（护短）：「网友XX在TA的帖子下说了难听话/抬杠，我帮TA回了」——
 *    下次私聊 AI 能自然说出「昨天论坛里有个杠精，我帮你怼了他」。
 *  v42【帖子记忆·金鱼】：开关关时零写入。 */
export function writeOwnerReplyMemory(
  contactId: string,
  opts: { post: ForumPost; comment: ForumPost; reply: string; mode: 'ownPost' | 'userPost' },
): void {
  try {
    if (!isPostMemoryOn()) return;
    const name = ownerName();
    const npcName = resolveAuthor(opts.comment.authorKey).name;
    const comment = opts.comment.content.replace(/\s+/g, ' ').slice(0, 50);
    const reply = opts.reply.slice(0, 60);
    const line =
      opts.mode === 'ownPost'
        ? `网友${npcName}在我X论坛的帖子下评论（「${comment}」），我回了TA：「${reply}」`
        : `网友${npcName}在${name}的X论坛帖子下说「${comment}」，我帮TA回了他：「${reply}」`;
    memAddForumFragment(contactId, line, {
      postId: opts.post.id,
      kind: 'comment',
      commentId: opts.comment.id,
    });
  } catch {
    /* 静默 */
  }
}

// ---------------- 私聊感知块（微信/QQ/信息 system prompt 注入） ----------------

/** 论坛近况感知块：角色的论坛动态 + 机主的帖子 + 彼此互动，注入私聊 system。
 *  仿 buildMomentsChatBlock 语义——让 AI 私聊时「记得自己在玩论坛」，
 *  能自然提起（TA 发的帖/自己发的帖收到的评论），但明确规定不要频繁硬聊。
 *  v42【帖子记忆】：
 *  · 金鱼模式（开关关）→ 空串（论坛互动零提起——过往帖/评论一律不提）；
 *  · 深度模式 → 追加「帖子记忆块」：TA 发过的帖子 + NPC 评论内容（跨应用感知素材：
 *    「我看到你昨天发的帖子了，那个谁谁谁的评论太逗了」）；匿名小号仓仅说破后并入。
 *  无任何相关动态时返回空串（join 后零成本）。 */
export function buildForumChatBlock(contactId: string, lastUserMsg?: string): string {
  try {
    // v44【AI 关注者】：TA 这条消息是在让你去 X 论坛关注 TA ——
    // ① 排一次自主关注决策（engine 延迟 45s~2min，像真人「等等再说」；
    //    动态 import 规避 social↔engine 循环依赖）；
    // ② 注入引导行：这一轮聊天里自然回应 TA 的请求（答应/婉拒/打岔都行）。
    //    发生在金鱼开关判定之前——眼前事不是「过往论坛记忆」，不该被金鱼吞掉。
    const followAsked = wantsForumFollow(lastUserMsg ?? '');
    if (followAsked) {
      const myKey0 = charKeyOf(contactId);
      void import('./engine')
        .then((m) => m.queueForumFollowAsk(myKey0, 'chat'))
        .catch(() => {
          /* 静默 */
        });
    }
    const followGuide = followAsked
      ? `TA 这条消息是在让你去 X 论坛关注 TA——你按自己的意思自然回应（答应/婉拒/打岔/讨价还价都行，像真人一样）；要不要真的关注由你自己决定，稍后会按你的整体人设处理，聊天里不用提任何机制。\n`
      : '';
    // 金鱼记忆：绝对不提起用户过往发过的帖子和他们在帖子下留过的评论
    if (!isPostMemoryOn()) return followGuide;
    const d = forumData();
    if (!d.seeded || !d.posts.length) return followGuide;
    const myKey = charKeyOf(contactId);
    const name = ownerName();
    const now = Date.now();
    const lines: string[] = [];

    // 我（角色）最近的帖子
    for (const p of charRecentPosts(myKey, 2)) {
      const body = p.content.replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`你 ${relTime(p.createdAt, now)}在X论坛发了帖：「${body}」`);
    }
    // TA（机主）最近的帖子：大号常驻；匿名小号帖仅在「TA已对该角色说破」后合并
    //（认知隔离：未说破时 AI 不能知道小号帖也是 TA 发的）
    for (const p of recentUserPosts(2)) {
      const body = p.content.replace(/\s+/g, ' ').slice(0, 60);
      lines.push(`${name} ${relTime(p.createdAt, now)}在X论坛发帖说：「${body}」`);
    }
    if (isForumAnonDisclosed(contactId)) {
      const anonName = resolveAuthor(ANON_KEY).name;
      const now2 = Date.now();
      const anonPosts = forumData()
        .posts.filter((p) => p.authorKey === ANON_KEY && p.replyTo === null && isPostVisible(p, now2))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 2);
      for (const p of anonPosts) {
        const body = p.content.replace(/\s+/g, ' ').slice(0, 60);
        lines.push(`${name} ${relTime(p.createdAt, now2)}用TA的小号「${anonName}」在X论坛发帖说：「${body}」`);
      }
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
    const anonKnown = isForumAnonDisclosed(contactId);
    const anchorOk = (p: ForumPost): boolean => {
      if (!p.replyTo) return false;
      const root = mainOf(p.replyTo);
      if (!root || (root.authorKey !== myKey && !isUserAuthor(root.authorKey))) return false;
      // 匿名小号的发言/帖子仅在该角色已知情（说破）时才算「彼此互动」——
      // 未说破时混进来 = AI 在论坛看到同样文案的小号评论，反向认出机主（穿帮）
      if (p.authorKey === ANON_KEY && !anonKnown) return false;
      if (root.authorKey === ANON_KEY && !anonKnown) return false;
      // 双方任一发言都算互动（用户在自己帖下自说自话除外）
      if (isUserAuthor(p.authorKey) && isUserAuthor(root.authorKey)) return false;
      return p.authorKey === myKey || isUserAuthor(p.authorKey);
    };
    const inter = d.posts
      .filter(anchorOk)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
    for (const c of inter) {
      const body = c.content.replace(/\s+/g, ' ').slice(0, 50);
      const root = mainOf(c.replyTo ?? '');
      const who = c.authorKey === myKey ? '你' : name;
      const to = c.authorKey === myKey ? (isUserAuthor(root?.authorKey ?? '') ? `${name}的帖子` : `${name}的评论`) : '你的帖子';
      lines.push(`${who} ${relTime(c.createdAt, now)}评论了${to}：「${body}」`);
    }
    if (!lines.length) {
      // 近况行为空但帖子记忆库有货（角色自己没发帖/没互动）→ 仍注入帖子记忆块
      const memBlock = buildForumPostMemoryBlock(contactId, isForumAnonDisclosed(contactId));
      return [followGuide, memBlock].filter(Boolean).join('\n');
    }
    // 去重保序，最多 6 行 + 帖子记忆块（TA发过的帖子与NPC评论——跨应用感知）
    const uniq = [...new Set(lines)].slice(0, 6);
    const memBlock = buildForumPostMemoryBlock(contactId, isForumAnonDisclosed(contactId));
    return [
      followGuide,
      '【X论坛近况（你和TA都在玩X论坛；下面是你们最近的论坛动态，仅作背景了解）】',
      ...uniq.map((l) => `- ${l}`),
      '聊天时偶尔想起可以自然提起（比如TA发帖说的事、你发帖收到的评论、你们在评论区的来回），但绝大多数时候不要主动提论坛，更不要逐条复述这些动态。',
      memBlock,
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}
