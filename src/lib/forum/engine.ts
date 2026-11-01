'use client';

/**
 * X论坛 · 行为引擎。
 *
 * 职责（全部非阻塞、失败静默、绝不抛错到 UI）：
 * 1. ensureSeed：仅首次打开 → NPC 文案池先落盘（论坛立刻有内容 + 连带评论）+ 系统通知 + 欢迎私信；
 *    再异步 LLM 精修（NPC 新帖 + char 好友按人设发帖，LLM 失败仅跳过该条——NPC 池已保底）。
 *    【用户要求】生成完一批后不再自动生成：打开 App 不补帖（ensureFresh 已删）、
 *    打开帖子也不自动补评论（ensureThreadComments 已删）——只在用户自己上滑/下滑松开、
 *    点「显示更多评论」时才生成。
 * 2. queueUserPostInteractions：用户发帖后延迟点赞（1~3 位 NPC + 好友），
 *    0~2 条 AI 回复（持久 pending 队列，重启不丢）。
 * 3. queueAiReplyToUserReply：用户回复了 AI 的帖/评论 → 该作者延迟再回一条
 *    （带完整上下文：主帖 + 被回复评论 + 用户评论 + 最近对话链，可无限多轮）。
 * 4. queueDmReply：用户私信发消息 → 对方延迟回复（LLM，失败通用兜底句）。
 * 5. generateMoreFeedPosts / generateNewFeedPosts：主页上拉/下拉松开 → 无限生成一批帖子
 *    （7~15 条，时间戳向前排，旧帖永不消失）；LLM 批量失败时 NPC 文案池兜底。
 * 6. generateMoreComments：「显示更多评论」按钮 → 再生成 7~15 条（含楼中楼子回复）。
 * 7. 热度合理性：评论/楼中楼/AI 回复的点赞浏览按父帖比例缩放（评论赞 << 主帖赞，像推特）。
 *
 * 模型连接（设置 App）：
 * - API 模型（apiConfig）：所有 LLM 生成（帖子/评论/回复/私信）；
 * - 识图模型（visionConfig）：帖子带图时先把配图转成文字描述再喂给 LLM，
 *   让 AI「看得到」图（未配置时降级内置识图，再失败跳过）。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  COMMUNITY_DEFS,
  GEN_VERSION,
  NPC_DEFS,
  PERSONA_ARCHETYPES,
  POST_MAX,
  REPLY_MAX,
  createDynNpc,
  likesOf,
  recordDynNpcRecent,
  renameBuiltinNpc,
  renameDynNpc,
  rollEngagement,
  seedBuiltinNpcFallbackNames,
  unnamedDynKeys,
  unnamedNpcIds,
  type AuthorKey,
  type ForumData,
  type ForumPost,
  forumContactsSnap,
  forumData,
  resolveAuthor,
  saveForum,
  uid,
} from './core';
import { describeImagesAuto } from '@/lib/vision-client';
import { renderTextImage } from './textimg';

// ---------------- pending 队列（跨刷新持久） ----------------

interface PendingJob {
  id: string;
  /** 到期时间戳 */
  due: number;
  kind: 'replyToUserPost' | 'aiReplyBack' | 'dmReply';
  /** 相关帖子 id（reply 类）/ dm 对方 key（dmReply） */
  postKey: string;
  meta: {
    authorKey?: AuthorKey;
    parentContent?: string;
    /** aiReplyBack 增强：分组锚点（顶层评论/主帖 id） */
    rootId?: string;
    /** aiReplyBack 增强：主帖 id（上下文用） */
    mainPostId?: string;
    /** aiReplyBack 增强：用户刚发的回复 id（AI 据此接话） */
    userReplyId?: string;
  };
}

const PENDING_KEY = 'forum-pending-v1';
/** 本会话已挂 timer 的任务 id（防重复挂；持久队列里任务保留到执行完才删） */
const scheduled = new Set<string>();

function loadPending(): Record<string, PendingJob> {
  const raw = kvGet(PENDING_KEY);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, PendingJob>;
  return {};
}

function savePending(p: Record<string, PendingJob>): void {
  void kvSet(PENDING_KEY, p);
}

function addPending(job: PendingJob): void {
  const p = loadPending();
  p[job.id] = job;
  savePending(p);
}

function dropPending(id: string): void {
  const p = loadPending();
  delete p[id];
  savePending(p);
  scheduled.delete(id);
}

// ---------------- LLM 调用 ----------------

/** 限流识别（服务端错误详情里带 429/Too many requests 即为配额干旱） */
const RATE_LIMIT_RE = /429|too many requests|rate.?limit/i;
/** LLM 配额冷却截止时间：429 后 90s 内所有生成类请求直接抛错走池子兜底。
 *  环境内置模型配额被翻译（用户手点，交互）与生成（后台批量）共享——
 *  限流干旱期继续发请求只会：① 在服务端队列挂几分钟再 500（日志实测 6.3min）；
 *  ② 挤占翻译的高优会话锁配额恢复窗口。冷却期内论坛照常有内容（池子兜底
 *  秒出），翻译胜率大幅提升；冷却结束自动恢复 LLM 生成。 */
let llmCooldownUntil = 0;

async function callApi(payload: Record<string, unknown>): Promise<unknown> {
  if (Date.now() < llmCooldownUntil) throw new Error('AI 配额冷却中（刚被限流，走池子兜底）');
  const { useSettings } = await import('@/lib/ios/store');
  const res = await fetch('/api/forum/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, config: useSettings.getState().apiConfig }),
  });
  if (!res.ok) {
    // 带上服务端错误详情：含 429 字样 → 识别为限流，进入冷却（不再轰炸）
    let detail = '';
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') detail = j.error;
    } catch {
      /* 忽略解析失败 */
    }
    if (RATE_LIMIT_RE.test(detail)) llmCooldownUntil = Date.now() + 90_000;
    throw new Error(detail || `请求失败 ${res.status}`);
  }
  return res.json();
}

// ---------------- 识图（设置 › 识图模型） ----------------

/** 帖子配图 → 文字描述（识图模型优先、内置识图兜底；无图/失败返回空串）。
 *  连接设置里的识图模型：AI 评论/回复带图帖子时能「看到」图片内容。 */
async function describePostMedia(media: string[] | undefined): Promise<string> {
  if (!media?.length) return '';
  const imgs = media.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 2);
  if (!imgs.length) return '';
  try {
    const { useSettings } = await import('@/lib/ios/store');
    const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
      images: imgs,
      text: '这是论坛帖子的配图，请描述图片里有什么',
    });
    return desc.trim().slice(0, 200);
  } catch {
    return '';
  }
}

// ---------------- 帖子构造 ----------------

/** 评论/楼中楼互动量（用户要求：评论的点赞/浏览必须合理——主帖 180 赞、
 *  单条评论却几万赞太假，像推特一样评论赞远小于主帖赞）：
 *  按父帖热度比例缩放——42% 几乎没人赞（父帖的 0.2%~3%）、33% 少量（2%~10%）、
 *  20% 小热门（8%~30%）、5% 热评（20%~60%）；浏览 ≈ 父帖浏览的 2%~25%；转推 0~2。 */
function rollCommentEngagement(parentLikes: number, parentViews: number): { likeBoost: number; views: number; reposts: number } {
  const r = Math.random();
  let ratio: number;
  if (r < 0.42) ratio = 0.002 + Math.random() * 0.028;
  else if (r < 0.75) ratio = 0.02 + Math.random() * 0.08;
  else if (r < 0.95) ratio = 0.08 + Math.random() * 0.22;
  else ratio = 0.2 + Math.random() * 0.4;
  return {
    likeBoost: Math.floor(parentLikes * ratio),
    views: Math.max(3, Math.floor(parentViews * (0.02 + Math.random() * 0.23))),
    reposts: Math.random() < 0.08 ? 1 + Math.floor(Math.random() * 2) : 0,
  };
}

function basePost(
  authorKey: AuthorKey,
  content: string,
  community: string | null,
  at: number,
  replyTo?: string,
  replyToName?: string | null,
  organic = true,
  /** 被回复父帖的热度（评论点赞/浏览按父帖比例缩放，不再独立重尾分布） */
  parentEng?: { likes: number; views: number },
): ForumPost {
  const npcKeys = NPC_DEFS.map((n) => `npc:${n.id}` as AuthorKey);
  const likes: AuthorKey[] =
    organic && authorKey !== 'user'
      ? npcKeys
          .slice()
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.floor(Math.random() * 5))
          .filter(() => Math.random() < 0.85)
      : [];
  // 热度分级：主帖重尾分布（十几~几百万）；评论/楼中楼按父帖比例缩放（评论赞 << 主帖赞）
  const eng = organic
    ? replyTo !== undefined
      ? rollCommentEngagement(parentEng?.likes ?? 40, parentEng?.views ?? 600)
      : rollEngagement()
    : { likeBoost: 0, views: Math.floor(Math.random() * 45), reposts: 0 };
  return {
    id: uid('p'),
    authorKey,
    content: content.slice(0, POST_MAX),
    community,
    createdAt: at,
    likes,
    reposts: eng.reposts,
    views: eng.views,
    likeBoost: eng.likeBoost,
    replyTo: replyTo ?? null,
    replyToName: replyToName ?? null,
  };
}

/** NPC → 默认版块（主题化：吃瓜/明星→娱乐八卦，影视→影视片单，车→汽车俱乐部，吐槽→吐槽大会） */
function defaultCommunityFor(npcId: string): string | null {
  const map: Record<string, string> = {
    wang: 'gossip',
    canteen: 'gossip',
    kitty: 'rant',
    iron: 'car',
    boat: 'movie',
    abacus: 'movie',
    kai: 'car',
    candy: 'gossip',
    liang: 'rant',
    sunny: 'gossip',
    gua: 'gossip',
    ju: 'movie',
    che: 'car',
    bao: 'gossip',
  };
  const v = map[npcId];
  return v === undefined ? null : v;
}

/** 池内 #话题# → 版块 id（null = 广场/今日热议）。新主题话题 + 旧话题兼容（历史帖归位） */
const NPC_COMMUNITY_MAP: Record<string, string | null> = {
  吃瓜现场: 'gossip',
  热搜围观: 'gossip',
  明星动态: 'gossip',
  追剧日常: 'movie',
  剧荒互助: 'movie',
  电影短评: 'movie',
  汽车俱乐部: 'car',
  提车日记: 'car',
  老司机日常: 'car',
  今日吐槽: 'rant',
  数码圈: 'digital',
  吃货联盟: 'food',
  职场摸鱼: 'work',
  健身打卡: 'fit',
  旅行摄影: 'travel',
  游戏玩家: 'game',
  深夜树洞: 'night',
  下班后的生活: null,
};

function communityOfPoolText(npcId: string, text: string): string | null {
  const tag = /#([^#\s]+)#/.exec(text)?.[1];
  if (tag && NPC_COMMUNITY_MAP[tag] !== undefined) return NPC_COMMUNITY_MAP[tag];
  const def = defaultCommunityFor(npcId);
  return def;
}

// ---------------- 防刷屏 / 时间线工具 ----------------

/** 全部人设原型 id（信息流大杂烩轮换环：每隔几条就是完全不同领域和语气的人） */
const ARCHETYPE_IDS = PERSONA_ARCHETYPES.map((a) => a.id);

/** 重排一批帖子：同一信息流内绝不连续出现同一作者（用户要求：严格防刷屏）。
 *  prev = 批次之前紧邻的那条作者（如现有 feed 最老一条），一并隔开。 */
function shuffleNoAdjacent<T extends { key: AuthorKey }>(items: T[], prev?: AuthorKey): T[] {
  const pool = items.slice();
  const out: T[] = [];
  let last = prev;
  let guard = 0;
  while (pool.length && guard++ < 600) {
    let idx = Math.floor(Math.random() * pool.length);
    if (pool[idx].key === last) {
      // 随机撞了同一作者：强制换人（找不到别人才允许连排）
      const alt = pool.findIndex((p) => p.key !== last);
      if (alt !== -1) idx = alt;
    }
    out.push(pool[idx]);
    last = pool[idx].key;
    pool.splice(idx, 1);
  }
  return out;
}

/** 自然时间间隔（用户要求：最新一条「刚刚」，往下 15分钟前/1小时前/昨天 衰减自然）。
 *  越往下间隔越大：几分钟 → 几十分钟 → 几小时，偶尔隔天；带随机抖动。 */
function naturalGapMs(depth: number): number {
  const r = Math.random();
  if (depth < 2) return (2 + Math.random() * 20) * 60_000; // 头两条：2~22 分钟
  if (depth < 5) return (15 + Math.random() * 75) * 60_000; // 15~90 分钟
  if (r < 0.12) return (8 + Math.random() * 34) * 3600_000; // 偶尔隔大半天
  return (40 + Math.random() * 170) * 60_000; // 40分钟~3.5小时
}

// ---------------- LLM 起名（用户要求：网名不要内置池子，让 AI 生成；
// v5：网名与帖子领域彻底解绑 + 内置 NPC 也由 LLM 起名） ----------------

/** 用 LLM 批量起网名并落地（三路目标，一次 API 调用全搞定）：
 *  1. 本批新建的动态网友（keys）：换掉通用池占位名；
 *  2. 回填还挂着占位名的老网友（限流期创建、上次起名失败落下的）；
 *  3. v5 新增：内置 NPC 也挨个换成 LLM 名（「电影院常驻嘉宾」「是小柔本人呀」
 *     这类内置描述型网名全部下岗）。
 *  顺手多要一批存进 nameBank 名字库——createDynNpc 随取随用，
 *  之后新建网友不再等本次 LLM 成功（限流期也有 AI 名可用）。
 *  起名失败静默保留占位名（论坛永不因起名失败断内容）。 */
async function renameDynNpcsViaLlm(keys: AuthorKey[]): Promise<number> {
  const seen = new Set<string>();
  const d0 = forumData();
  const dynTargets: { id: string; old: string }[] = [];
  for (const k of keys) {
    if (!k.startsWith('dyn:') || seen.has(k)) continue;
    seen.add(k);
    const npc = d0.dynNpcs?.[k.slice(4)];
    if (npc && npc.name) dynTargets.push({ id: k.slice(4), old: npc.name });
  }
  // 回填：占位名动态网友补进同一批（去重后总量 ≤ 30，与 API 上限对齐）
  if (dynTargets.length < 30) {
    for (const k of unnamedDynKeys(30)) {
      if (seen.has(k)) continue;
      const npc = d0.dynNpcs?.[k.slice(4)];
      if (npc && npc.name) {
        seen.add(k);
        dynTargets.push({ id: k.slice(4), old: npc.name });
      }
      if (dynTargets.length >= 30) break;
    }
  }
  // v5 回填：还没换上 LLM 名的内置 NPC（总量同样封顶 30）
  const npcTargets = unnamedNpcIds().slice(0, Math.max(0, 30 - dynTargets.length));
  const total = dynTargets.length + npcTargets.length;
  // 没有目标且名字库充足时不白跑一趟；库见底时也补一批发（createDynNpc 备用）
  if (!total && (d0.nameBank?.length ?? 0) >= 10) return 0;
  try {
    const avoidNames = [...(d0.usedNames ?? [])].slice(-80);
    const want = Math.min(30, Math.max(total, 1) + 12); // 目标数 + 名字库补充额度
    const r = (await callApi({ kind: 'names', count: want, avoid: avoidNames })) as { items?: string[] };
    const raw = Array.isArray(r.items) ? r.items : [];
    const usedNow = new Set(d0.usedNames ?? []);
    const cands: string[] = [];
    for (const x of raw) {
      const n = String(x).trim().replace(/^@/, '').slice(0, 16);
      if (n.length < 2 || usedNow.has(n) || cands.includes(n)) continue;
      cands.push(n);
    }
    if (!cands.length) return 0;
    let changed = 0;
    for (const t of dynTargets) {
      const nn = cands.shift();
      if (!nn) break;
      if (renameDynNpc(`dyn:${t.id}`, nn)) changed += 1;
    }
    for (const id of npcTargets) {
      const nn = cands.shift();
      if (!nn) break;
      if (renameBuiltinNpc(id, nn)) changed += 1;
    }
    // 剩余名入库存着（下批 createDynNpc 直接取，不再依赖本次 LLM 成功）
    if (cands.length) {
      const d1 = forumData();
      d1.nameBank = [...(d1.nameBank ?? []), ...cands].slice(-60);
    }
    if (changed || cands.length) saveForum({ ...forumData() });
    return changed;
  } catch {
    return 0; // 起名失败：静默保留占位名（论坛永不因起名失败断内容）
  }
}

// ---------------- 播种 ----------------

let seeding = false;

/** 内容风格版本升级：清除旧 AI 帖（用户自己的帖子/回复保留），重新播种。
 *  v4 = 网名 LLM 生成 + 动态网友占比提升；
 *  v5 = 网名与帖子领域解绑（删原型网名池 + 名字库）+ 内置 NPC 也 LLM 起名。 */
function resetAiContent(d: ForumData): void {
  const keepPosts = d.posts.filter((p) => p.authorKey === 'user');
  const keepIds = new Set(keepPosts.map((p) => p.id));
  d.posts = keepPosts;
  d.dynNpcs = {};
  d.usedNames = [];
  d.npcNames = {}; // v5：内置 NPC 覆盖名一并清零，重新播种时由 LLM 起新名
  d.npcLlmNamed = {};
  d.nameBank = []; // 名字库也清零（旧库可能已被用过一轮）
  d.hiddenPosts = (d.hiddenPosts ?? []).filter((id) => keepIds.has(id));
  // 通知里指向已删帖的丢掉（system 通知 postId 为空，保留）
  d.notifications = d.notifications.filter((n) => !n.postId || keepIds.has(n.postId));
  // 关注列表里已消失的动态网友清理
  d.following = d.following.filter((k) => !k.startsWith('dyn:'));
  d.genVersion = GEN_VERSION;
  d.seeded = false;
}

/** 给种子帖同步连带一批评论（用户要求：第一次生成帖子就连带着生成评论——
 *  打开帖子就是热闹评论区，而不是「评论正在赶来」）。
 *  池子主题匹配（评论对得上帖子内容）+ 少量楼中楼；时间在（发帖, 现在）内升序。 */
function seedCommentsFor(post: ForumPost, out: ForumPost[]): void {
  const postAuthor = resolveAuthor(post.authorKey);
  const count = 7 + Math.floor(Math.random() * 9); // 7~15 条（用户要求：评论一批 7~15）
  const keys = pickCommenters(count, postAuthor.lang, post.content, post.authorKey);
  const usedCt = new Set<string>();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const lang = resolveAuthor(keys[i]).lang ?? 'zh-Hans';
    texts.push(pickTopicComment(post.content, lang, usedCt, post.community) ?? pickGenericComment('zh-Hans', usedCt) ?? '哈哈哈哈');
  }
  // 时间：在（发帖后, 现在）窗口内自然铺开；帖子很新时评论挤在最近几十秒（爆款即视感），
  // 老帖则从发帖后一直散到现在——绝不再出现全部同一毫秒的假时间戳
  const hi = Date.now() - 5_000;
  let lo = Math.max(post.createdAt + 5_000, hi - Math.max(texts.length * 2_500, 90_000));
  const span = Math.max(hi - lo, texts.length * 1_200);
  const postEng = { likes: likesOf(post), views: post.views };
  const newComments: ForumPost[] = [];
  texts.forEach((t, i) => {
    const at = Math.floor(lo + (span * (i + 0.15 + Math.random() * 0.7)) / texts.length);
    const c = basePost(
      keys[i],
      t.slice(0, REPLY_MAX),
      post.community,
      Math.min(Math.max(at, post.createdAt + 5_000), hi),
      post.id,
      postAuthor.name,
      true,
      postEng,
    );
    newComments.push(c);
    out.push(c);
  });
  // 楼中楼：随机挑 1~2 条评论各接一条子回复（其他网友/楼主接话）
  const subN = Math.min(newComments.length, 1 + Math.floor(Math.random() * 2));
  const subs = newComments.slice().sort(() => Math.random() - 0.5).slice(0, subN);
  const usedSub = new Set<string>();
  for (const c of subs) {
    const byAuthor = post.authorKey !== 'user' && Math.random() < 0.35 ? post.authorKey : pickCommenters(1, postAuthor.lang, post.content, post.authorKey, ...keys)[0];
    const subLang = resolveAuthor(byAuthor).lang ?? 'zh-Hans';
    const text = pickTopicComment(`${c.content} ${post.content}`, subLang, usedSub, post.community) ?? pickGenericComment('zh-Hans', usedSub) ?? '哈哈哈哈哈';
    const subAt = Math.min(Date.now() - 30_000, c.createdAt + (3 + Math.random() * 40) * 60_000);
    const sub = basePost(
      byAuthor,
      text.slice(0, REPLY_MAX),
      post.community,
      Math.max(subAt, c.createdAt + 90_000),
      c.id,
      resolveAuthor(c.authorKey).name,
      true,
      { likes: likesOf(c), views: c.views },
    );
    sub.replyToPost = c.id;
    out.push(sub);
  }
}

/** 内置 NPC → 领域相近的人设原型（池子文案交给动态网友发时，人设与内容领域对上：
 *  车帖由车友发、吃瓜帖由吃瓜群众发——口吻才真实） */
const NPC_DOMAIN_ARCH: Record<string, string[]> = {
  wang: ['chigua', 'gangjing'], canteen: ['fanquan', 'chigua'], kitty: ['dagong', 'gaoxiao'],
  iron: ['xinshou', 'laosiji'], boat: ['zhuiju', 'yemao'], abacus: ['zhuiju'],
  kai: ['laosiji'], candy: ['fanquan'], liang: ['dagong', 'ningmeng'], sunny: ['chigua'],
  gua: ['chigua', 'kebiao'], ju: ['zhuiju'], che: ['laosiji', 'xinshou'], bao: ['kebiao', 'chigua'],
};

/** 首次打开：池子同步落盘（立即有内容 + 连带评论），LLM 精修异步追加。幂等。
 *  播种作者 85% 动态真实感网友 + 15% 内置主题 NPC（v4：动态网友为主，内置 NPC 只做保底大 V；
 *  网名由 LLM 异步起名替换——池子名只是首屏临时占位）；
 *  防刷屏：落盘前重排（同一信息流绝不连续同一作者）；时间线自然衰减（刚刚→15分钟→1小时→昨天）。 */
export async function ensureSeed(): Promise<void> {
  const d0 = forumData();
  if ((d0.genVersion ?? 1) < GEN_VERSION && d0.seeded) {
    // 内容风格升级：旧 AI 帖清除重播种（用户帖保留）
    resetAiContent(d0);
    saveForum({ ...d0 });
  }
  const d = forumData();
  if (d.seeded || seeding) return;
  seeding = true;
  try {
    const now = Date.now();
    // v5：内置 NPC 同步挂真实感池子覆盖名（不依赖 LLM：限流期也不露出
    // 「电影院常驻嘉宾」「是小柔本人呀」这类内置描述型网名；LLM 回填后再换 AI 名）
    seedBuiltinNpcFallbackNames();
    const specs: { key: AuthorKey; text: string; community: string | null; npcId: string }[] = [];
    for (const npc of NPC_DEFS) {
      const n = 1 + Math.floor(Math.random() * 2);
      const pool = [...npc.pool];
      for (let i = 0; i < n && pool.length; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        const text = pool.splice(idx, 1)[0];
        // 85% 概率换成动态真实感网友发（人设原型与文案领域对上，口吻才真实）；
        // 内置 NPC 只占 15%（v4：网名与内容都靠 LLM，内置池子仅作保底）
        const domainArch = NPC_DOMAIN_ARCH[npc.id] ?? [];
        const author: AuthorKey =
          Math.random() < 0.85
            ? createDynNpc({ archetypeId: domainArch.length ? domainArch[Math.floor(Math.random() * domainArch.length)] : undefined })
            : `npc:${npc.id}`;
        specs.push({ key: author, text, community: communityOfPoolText(npc.id, text), npcId: npc.id });
      }
    }
    // 防刷屏重排（同一信息流绝不连续同一作者）
    const ordered = shuffleNoAdjacent(specs);
    // 自然时间线：最新一条「刚刚」（15~60 秒前），往下间隔逐渐拉大（15分钟→1小时→昨天）
    const seedPosts: ForumPost[] = [];
    let at = now - (15 + Math.random() * 45) * 1000;
    ordered.forEach((sp, i) => {
      seedPosts.push(basePost(sp.key, sp.text, sp.community, at));
      // 人设连通性：记录动态网友最近发的内容（下个帖子里接上话疸）
      recordDynNpcRecent(sp.key, sp.text);
      at -= naturalGapMs(i);
    });
    // 首刷连带评论（用户要求：第一次生成帖子就连带着生成评论）
    const allNew: ForumPost[] = [...seedPosts];
    for (const sp of seedPosts) seedCommentsFor(sp, allNew);
    const next: ForumData = {
      ...d,
      posts: [...d.posts, ...allNew],
      // char 好友自动关注（X：好友互关，「关注」页能刷到 TA 的帖子）
      following: [...new Set([...d.following, ...forumContactsSnap().filter((c) => c.kind === 'char').map((c) => `char:${c.id}` as AuthorKey)])],
      notifications: [
        ...d.notifications,
        {
          id: uid('n'),
          type: 'system',
          fromKey: 'official',
          postId: null,
          text: '欢迎加入X论坛！发一条帖子，让广场认识你。',
          createdAt: now - 300_000,
          read: false,
        },
      ],
      dms: d.dms.some((x) => x.peerKey === 'official')
        ? d.dms
        : [
            ...d.dms,
            {
              peerKey: 'official',
              messages: [
                { id: uid('m'), from: 'official', text: '欢迎加入X论坛！我是论坛小助手。', at: now - 300_000 },
                { id: uid('m'), from: 'official', text: '小技巧：点右下角蓝色按钮就能发帖；帖子带 #话题# 更容易被大家刷到哦。', at: now - 299_000 },
              ],
            },
          ],
      genVersion: GEN_VERSION,
      seeded: true,
      lastGenAt: now,
    };
    saveForum(next);
    // LLM 起名：播种期新建的动态网友全部换 AI 生成的网名（池子名只是首屏临时占位）；
    // 与 llmPolish 并行（服务端 SDK 串行队列会自然排队，不再互相挤兑 429）
    const seedDynKeys = Object.keys(forumData().dynNpcs ?? {}).map((id) => `dyn:${id}` as AuthorKey);
    if (seedDynKeys.length) void renameDynNpcsViaLlm(seedDynKeys);
    // 异步 LLM 精修（NPC 3 条新帖 + char 好友按人设发帖；失败静默跳过）
    void llmPolish();
  } finally {
    seeding = false;
  }
}

/** LLM 生成追加（失败静默——池子内容已保证不空） */
async function llmPolish(): Promise<void> {
  try {
    const d = forumData();
    const npcPicks = NPC_DEFS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    // char 好友：各生成一条人设帖（最多 2 位，避免首批请求过重）
    const charPicks = forumContactsSnap()
      .filter((c) => c.kind === 'char' && (c.persona || c.background))
      .slice(0, 2)
      .map((c) => {
        const name = c.nickname || c.name;
        return { name, persona: [c.persona, c.background, c.expressStyle].filter(Boolean).join('；'), isChar: true, id: c.id };
      });
    const items = [
      ...npcPicks.map((n) => {
        // v5：名字/人设都走 resolveAuthor（内置 NPC 已换成 LLM 名，口吻跟新身份走）
        const a = resolveAuthor(`npc:${n.id}` as AuthorKey);
        return { name: a.name, persona: a.persona ?? n.persona, community: defaultCommunityFor(n.id) ?? '今日热议', isChar: false, id: n.id };
      }),
      ...charPicks.map((c) => ({ name: c.name, persona: c.persona, community: '今日热议', isChar: true, id: c.id })),
    ].slice(0, 5);
    if (!items.length) return;
    const avoid = d.posts.slice(-8).map((p) => p.content.slice(0, 60));
    const topics = FEED_TOPICS.slice().sort(() => Math.random() - 0.5);
    const r = (await callApi({
      kind: 'posts',
      items: items.map(({ name, persona, community }, i) => ({ name, persona, community, topic: topics[i % topics.length] })),
      avoid,
      userName: resolveAuthor('user').name,
    })) as { items?: { content?: unknown; textImage?: unknown }[] };
    // v7 契约：服务端严格 JSON 解析后的对象数组（第 i 项对应第 i 位作者；
    // 无效项 content 为空串——这里直接跳过，不错位到别人头上）
    const objs = Array.isArray(r.items) ? r.items : [];
    const now = Date.now();
    const next: ForumData = { ...forumData() };
    let imgN = 0;
    objs.forEach((o, i) => {
      const spec = items[i];
      if (!spec) return;
      const t = typeof o?.content === 'string' ? o.content.trim() : '';
      if (t.length < 6) return;
      const authorKey: AuthorKey = spec.isChar ? `char:${spec.id}` : `npc:${spec.id}`;
      // LLM 帖不带 #话题 时，按默认版块归位
      const tag = /#([^#\s]+)#/.exec(t)?.[1];
      const cid = spec.isChar ? (tag ? NPC_COMMUNITY_MAP[tag] ?? null : null) : communityOfPoolText(spec.id, t);
      const post = basePost(authorKey, t, cid, now - (i + 1) * 420_000);
      // v9 文字图片：LLM 给了合适短句就 canvas 直出一张（每批最多 3 张，失败静默纯文字）
      const ti = typeof o?.textImage === 'string' ? o.textImage.trim() : '';
      if (ti.length >= 2 && ti.length <= 40 && ti !== t && imgN < 3) {
        try {
          post.media = [renderTextImage(ti)];
          imgN += 1;
        } catch {
          /* canvas 不可用等：保持纯文字 */
        }
      }
      next.posts.push(post);
    });
    saveForum(next);
  } catch {
    /* LLM 失败：池子内容已够看 */
  }
}

// ---------------- 主页无限生成（底部上拉松开 / 顶部下拉松开 → 过界手势触发） ----------------
// 用户要求：生成完一批后不再自动生成——打开 App 不补帖（ensureFresh 已删），
// 只在用户自己下拉/上拉松开、或点「显示更多评论」时才生成。

let feedGenerating = false;

/** 通用评论池（LLM 失败时的兜底扩充：与 NPC 池合计保证任何帖子都能补满 10~30 条不重样评论；
 *  去重只在本帖内——不同帖子评论区出现相似短评很正常）。
 *  用户要求评论也可多语言（英语/韩语/日语/繁体）：外语短评由外语网友发出，
 *  兜底时按评论者语言匹配对应语言的池子。 */
const GENERIC_COMMENTS: { text: string; lang: string }[] = [
  { text: '哈哈哈哈太真实了', lang: 'zh-Hans' },
  { text: '这条必须顶上去，说得太对了', lang: 'zh-Hans' },
  { text: '同感同感，深有体会', lang: 'zh-Hans' },
  { text: '前排围观，楼主说得好', lang: 'zh-Hans' },
  { text: '看完沉默了，想想还真是这样', lang: 'zh-Hans' },
  { text: '每天刷论坛就为了等这种帖子', lang: 'zh-Hans' },
  { text: '理性讨论，这条我站楼主', lang: 'zh-Hans' },
  { text: '泪目了，突然想家了', lang: 'zh-Hans' },
  { text: '有点东西，已经收藏了', lang: 'zh-Hans' },
  { text: '这波总结到位，一个字都没多说', lang: 'zh-Hans' },
  { text: '蹲一个后续，别断更啊', lang: 'zh-Hans' },
  { text: '评论区比帖子还精彩，哈哈', lang: 'zh-Hans' },
  { text: '楼主是懂生活的', lang: 'zh-Hans' },
  { text: '说实话，看饿了', lang: 'zh-Hans' },
  { text: '半夜看到这条，直接破防', lang: 'zh-Hans' },
  { text: '人间清醒，就是这么回事', lang: 'zh-Hans' },
  { text: '这就是生活啊，平平常常的才是真', lang: 'zh-Hans' },
  { text: '太治愈了，谢谢分享', lang: 'zh-Hans' },
  { text: '有用，马克一下回头细看', lang: 'zh-Hans' },
  { text: '好家伙，直接说进心坎里了', lang: 'zh-Hans' },
  { text: '有点意思，已关注', lang: 'zh-Hans' },
  { text: '笑死，段子手果然在民间', lang: 'zh-Hans' },
  { text: '支持支持，让更多人看到', lang: 'zh-Hans' },
  { text: '路过留个爪，明天再来看', lang: 'zh-Hans' },
  { text: '这就是普通人的浪漫吧', lang: 'zh-Hans' },
  { text: '确实，没毛病', lang: 'zh-Hans' },
  { text: '看得出来很用心，赞一个', lang: 'zh-Hans' },
  { text: '学到了学到了，受教', lang: 'zh-Hans' },
  { text: '突然被这句话安慰到了', lang: 'zh-Hans' },
  { text: '已转给我朋友看，她说太像了', lang: 'zh-Hans' },
  { text: '一整个共鸣住了', lang: 'zh-Hans' },
  { text: '楼主文笔可以啊，多写点', lang: 'zh-Hans' },
  { text: '认真看完，值得细品', lang: 'zh-Hans' },
  { text: '这么好的帖子不能沉', lang: 'zh-Hans' },
  { text: '是本人了，别念了别念了', lang: 'zh-Hans' },
  { text: '哈哈哈评论区都是人才', lang: 'zh-Hans' },
  { text: '说出了我不敢说的', lang: 'zh-Hans' },
  { text: '这个观点我保留，但尊重', lang: 'zh-Hans' },
  { text: '细想还真是这个理', lang: 'zh-Hans' },
  { text: '先赞后看，习惯了', lang: 'zh-Hans' },
  { text: '前排吃瓜，瓜子已备好', lang: 'zh-Hans' },
  { text: '这瓜太大了，先马后看', lang: 'zh-Hans' },
  { text: '车主路过，确实是这样', lang: 'zh-Hans' },
  { text: '这剧我也在追，上头了', lang: 'zh-Hans' },
  { text: '反转了反转了，快看最新', lang: 'zh-Hans' },
  { text: '让子弹再飞一会儿', lang: 'zh-Hans' },
  { text: '课代表什么时候来总结', lang: 'zh-Hans' },
  { text: '追星女孩路过，理智看待', lang: 'zh-Hans' },
  { text: '这瓜保熟吗', lang: 'zh-Hans' },
  { text: '老司机看不下去了，说两句', lang: 'zh-Hans' },
  { text: '省流：就是那么回事', lang: 'zh-Hans' },
  { text: '已经开始二刷了，别拦我', lang: 'zh-Hans' },
  { text: '这车我也试驾过，感觉还行', lang: 'zh-Hans' },
  { text: '热搜挂一整天了，看疲劳了', lang: 'zh-Hans' },
  { text: '天哪这也太好磕了', lang: 'zh-Hans' },
  { text: '姐妹你是我的互联网嘴替', lang: 'zh-Hans' },
  // 繁体中文（港台网友）
  { text: '笑死，超真實', lang: 'zh-Hant' },
  { text: '太懂了吧，完全講中我', lang: 'zh-Hant' },
  { text: '蹲後續，别斷更', lang: 'zh-Hant' },
  { text: '這瓜也太大了，先吃為敬', lang: 'zh-Hant' },
  { text: '台北路過，推一個', lang: 'zh-Hant' },
  { text: '真的假的啦，長知識了', lang: 'zh-Hant' },
  { text: '編劇出來面對！', lang: 'zh-Hant' },
  { text: '這部我也在看，超上頭', lang: 'zh-Hant' },
  // 英语
  { text: 'omg so true', lang: 'en' },
  { text: 'this is so real lol', lang: 'en' },
  { text: 'why is this so accurate', lang: 'en' },
  { text: 'nah this is wild', lang: 'en' },
  { text: 'first time commenting but wow', lang: 'en' },
  { text: 'the way I screamed reading this', lang: 'en' },
  { text: 'wait is this actually happening??', lang: 'en' },
  { text: 'he is SO handsome in person, trust me', lang: 'en' },
  { text: 'the drama never ends here lol', lang: 'en' },
  { text: 'saving this thread for later', lang: 'en' },
  // 日语
  { text: 'わかる', lang: 'ja' },
  { text: 'それな', lang: 'ja' },
  { text: '草', lang: 'ja' },
  { text: '尊い', lang: 'ja' },
  { text: 'あるあるすぎる', lang: 'ja' },
  { text: 'え、まじで？', lang: 'ja' },
  { text: 'この続きが気になる', lang: 'ja' },
  { text: '実際に会った人いるんだ、羨ましい', lang: 'ja' },
  { text: '情報ありがとう、保存しました', lang: 'ja' },
  // 韩语
  { text: 'ㄹㅇㅋㅋ', lang: 'ko' },
  { text: '실화냐', lang: 'ko' },
  { text: '인정', lang: 'ko' },
  { text: '정보 감사합니다', lang: 'ko' },
  { text: '이거 진짜 웃기네', lang: 'ko' },
  { text: '후속 기다립니다', lang: 'ko' },
  { text: '완전 공감', lang: 'ko' },
  { text: '직접 본 사람도 있다니 부럽다', lang: 'ko' },
];

/** 按评论者语言从通用池抽取未用短评（语言池尽 → 落中文池：外国网友用翻译器发中文也很真实） */
function pickGenericComment(lang: string, usedCt: Set<string>): string | null {
  for (let i = 0; i < 60; i++) {
    const pool = GENERIC_COMMENTS.filter((c) => c.lang === lang);
    const usePool = pool.length && Math.random() < 0.8 ? pool : GENERIC_COMMENTS;
    const cand = usePool[Math.floor(Math.random() * usePool.length)].text;
    const k = cand.slice(0, 16);
    if (!usedCt.has(k)) {
      usedCt.add(k);
      return cand;
    }
  }
  return null;
}

/** 生成主题池（用户指定内容方向：八卦/明星/吐槽/车/影视/娱乐/吃瓜）——
 *  LLM 按主题方向生成；兜底组合池同主题，保证无 LLM 也是对味内容 */
export const FEED_TOPICS = ['明星八卦', '吃瓜现场', '影视综艺', '汽车圈', '娱乐热点', '今日吐槽'];

// ---------------- 主题匹配评论池（评论必须对得上帖子内容） ----------------

/** 主题评论池：按帖子关键词命中主题，评论直接围绕该主题接话
 *  （用户要求：评论和发表的内容对不上是不行的；含杠精/课代表/跟风/吐槽党多角色）。
 *  {t} = 帖子命中的话题词（如「这瓜」「这车」「这剧」），渲染时替换。 */
const TOPIC_COMMENT_POOLS: { re: RegExp; subject: string; comments: string[] }[] = [
  {
    re: /瓜|塌|恋情|官宣|热搜|爆料|同框|拍到|声明|辟谣|反转|吃瓜|出轨|分手|结婚|离婚|绯闻/i,
    subject: '这瓜',
    comments: [
      '救命这瓜也太大了吧？？？我吃到现在都没吃明白，有没有课代表总结一下',
      '课代表来了：起因是{t}被扒，中间反转了两次，现在双方都装死，蹲后续',
      '只有我觉得{t}很无聊吗，每次都是这套流程，看腻了',
      '让子弹再飞一会儿，上次那个瓜最后不也是乌龙',
      '我朋友就在现场，她说根本不是传的那样，等我详细问问',
      '哈哈哈哈哈哈笑死，楼主你太惨了，蹲蹲蹲',
      '{t}我早就有预感了，懂的都懂，不敢多说',
      '蹲一个后续，别断更啊，我瓜子都买好了',
      '家人们谁懂啊，半夜刷到{t}直接睡不着了',
      '就这也能上热搜？现在的热搜是越来越水了',
      '先别站队，上次提前站队的都被打脸了，让子弹飞',
      '这瓜保熟吗，不保熟我可就走了',
    ],
  },
  {
    re: /剧|追剧|大结局|烂尾|编剧|男主|女主|剧情|综艺|电影|影院|红毯|上映|预告|豆瓣|倍速|剧荒/i,
    subject: '这剧',
    comments: [
      '{t}我也在追！！第八集直接封神，编剧是懂怎么拿捏我的',
      '预警：后面开始注水了，回忆杀能占半集，我提前弃了',
      '编剧出来挨打！！{t}这结局我意难平到现在',
      '只有我觉得{t}很难看吗，全程倍速都嫌慢',
      '课代表总结：{t}前三集平，第四集起飞，中间注水两集，结局烂尾',
      '为了{t}开了三个会员，平台是懂绑架的',
      '哈哈哈哈哈楼主说的太对了，我也是这么想的',
      '别看解说版！{t}必须亲自看，两分钟解说会毁掉两小时',
      '安利给所有还没看的人，撑过前三集你会回来谢我的',
      '这导演的运镜真的绝，{t}那段长镜头我倒回去看了五遍',
      '女主演技被女主粉丝吹过头了吧，尴尬到脚趾抠地',
      '求下饭剧！不烧脑不虐心一集一个故事的那种',
    ],
  },
  {
    re: /车|油|堵|驾|4S|提车|试驾|轮胎|油耗|加塞|变道|停车场|科目|刹车|引擎|声浪/i,
    subject: '这车',
    comments: [
      '别买{t}，买了就后悔，修车排队排到怀疑人生',
      '车主路过，{t}确实是这样，油耗高得离谱',
      '只有我一个人觉得{t}还行吗，你们是不是要求太高了',
      '课代表：{t}优点是动力，缺点是价格和油耗，自己权衡',
      '键盘车神又开始了，{t}你们真开过吗就搁这评',
      '哈哈哈哈哈哈笑死，新手司机真实写照，我也是三把才进去的',
      '早高峰被加塞三次+1，血压和油门一起踩到底',
      '攒钱提车中，看完{t}更焦虑了，钱包和快乐总得选一个',
      '这油耗正常吧，市区通勤谁开都这样，别吓唬楼主',
      '老司机说得对，刹得住比跑得快重要',
      '{t}我试驾过，推背感是真的，价格也是真的硬',
      '刚拿本别买手动挡，相信我，堵车的时候你会哭的',
    ],
  },
  {
    re: /明星|偶像|爱豆|本命|追星|演唱会|应援|粉丝|站姐|代拍|周边|签售|安可|主唱|哥哥|姐姐|排队|见到本人|现场|本人比屏幕/i,
    subject: '追星',
    comments: [
      '天哪这也太好磕了，{t}我先磕为敬',
      '姐妹你是我的互联网嘴替！！说得太对了',
      '理智追星，不代拍不私生，{t}看看就好别上头',
      '只有我觉得{t}有点过了吗，追星还是要先过好自己的生活',
      '我也在现场！！{t}那段我现在想起来还是想哭',
      '代拍真的该管管了，{t}都被拍成什么样了',
      '啊啊啊啊啊同担！！终于刷到组织了',
      '追星女孩路过，{t}这个说法我认可',
      '白嫖它不香吗，{t}氪金要量力而行啊家人们',
      '笑死，追星追到倾家荡产，说的是我本人',
      '蹲一个演唱会门票转让，蹲蹲蹲',
      '他站到光里的同时你也要把自己的日子过亮呀',
    ],
  },
  {
    re: /班|老板|工资|加班|通勤|辞职|摸鱼|周报|开会|同事|甲方|乙方|上班|打工|绩效|KPI|裁员|领导|地铁/i,
    subject: '打工',
    comments: [
      '{t}世另我，今天也是不想上班的一天',
      '老板画的饼真香，我血压也真高',
      '只有我觉得{t}还能忍吗，至少还有工资拿',
      '课代表：{t}的本质是资本压榨，建议保留证据，骑驴找马',
      '哈哈哈哈哈哈带薪如厕大师就是我，摸鱼才是打工人的本体',
      '已老实，{t}之后我连辞职口号都不敢喊了',
      '工资三分钟热度+1，每月还款日都在怀疑人生',
      '辞职口号月更选手路过，咱们俩组个队吧',
      '{t}真的会谢，谁懂啊，周一综合征又犯了',
      '跑吧，{t}这种环境待久了人会废掉的',
      '工位摸鱼冠军在此，楼主悄悄的，别让老板刷到',
      '笑死，班味洗不掉的，周末泡澡都没用',
    ],
  },
  {
    re: /猫|狗|宠物|铲屎|主子|疫苗|猫粮|狗粮|拆家|撸猫|遛狗/i,
    subject: '宠物',
    comments: [
      '{t}快发照片！不看照片等于没说',
      '哈哈哈哈哈哈拆家现场我也经历过，沙发已经阵亡了',
      '铲屎官含泪点赞，{t}懂的都懂',
      '只有养过的人才知道{t}有多真实，主子的脸色就是天气',
      '猫毛过敏但养猫+1，戒不掉的根本戒不掉',
      '{t}建议直接发视频，让我们云吸一下',
      '我家那位也是，{t}的时候一脸无辜，气死又好笑',
      '疫苗本收藏家路过，宠物医院VIP就是我',
      '笑死，{t}这条我要转给我妈看，让她知道养宠物的快乐',
    ],
  },
  {
    re: /吃|喝|外卖|探店|美食|火锅|奶茶|咖啡|餐厅|好吃|难吃|宵夜|零食|甜品/i,
    subject: '探店',
    comments: [
      '看饿了，{t}求地址，已经准备好出发了',
      '{t}避雷+1，我也踩过这个坑，难吃到怀疑人生',
      '只有我觉得{t}一般般吗，可能是我口味问题',
      '哈哈哈哈哈哈深夜放毒是吧，举报了（咽口水）',
      '课代表总结：{t}值得冲的是招牌，别的别点',
      '奶茶三分甜选手路过，{t}这个搭配我认可',
      '救命，半夜刷到{t}是对减肥人士的谋杀',
      '碳水快乐星人狂喜，{t}看着就香',
      '外卖红包猎人来了，{t}有没有优惠券链接',
    ],
  },
  {
    re: /手机|芯片|跑分|新机|发布会|显卡|装机|屏幕|数码|耳机|键盘|游戏|排位|上分|开黑|外挂/i,
    subject: '数码',
    comments: [
      '等等党永不为奴，{t}再战三年',
      '只有我觉得{t}参数没意义吗，体验才是王道',
      '跑分不代表体验，{t}实测才是真的',
      '{t}买新不买旧，一步到位，别问，问就是过来人',
      '装机预算超了+1，{t}一看价格我沉默了',
      '哈哈哈哈哈哈显卡终于到了，恭喜脱贫',
      '{t}散热怎么样，我看评测说烫手',
      '课代表：{t}首发别冲，等两个月降价+固件稳定',
      '凌晨排位的兄弟还在吗，{t}组一队',
    ],
  },
  {
    re: /失眠|熬夜|凌晨|睡不着|emo|崩溃|焦虑|压力|累|孤独|深夜/i,
    subject: '深夜',
    comments: [
      '凌晨三点刷到{t}，突然就不那么孤独了',
      '抱抱楼主，{t}这个阶段都会过去的',
      '只有我睡不着的时候刷到{t}更emo了吗',
      '月亮不睡我不睡+1，{t}咱们组个失眠互助群吧',
      '{t}写的就是我吧，别念了别念了',
      '褪黑素依赖中，{t}看得我更清醒了',
      '深夜的情绪别当真，{t}睡一觉明天再看会不一样',
      '数羊数到一万选手路过，{t}同病相怜',
    ],
  },
];

/** 版块 → 匹配的主题评论池（评论与帖子内容对得上：版块定领域，关键词做微调）。
 *  索引：0=瓜 1=剧 2=车 3=追星 4=打工 5=宠物 6=吃 7=数码 8=深夜 */
const COMMUNITY_POOLS: Record<string, number[]> = {
  gossip: [0, 3],
  movie: [1],
  car: [2],
  rant: [4],
  digital: [7],
  food: [6],
  work: [4],
  fit: [7],
  travel: [6, 8],
  night: [8],
  game: [7],
};

/** 从帖子内容提取主题词（给 {t} 槽位用：优先 #话题#，否则用主体词） */
function topicSubjectOf(text: string, fallback: string): string {
  const tag = /#([^#\s]{1,12})#/.exec(text)?.[1];
  return tag ?? fallback;
}

/** 剥离回复对象前缀（与服务端 stripReplyPrefix 同口径的客户端兜底：
 *  LLM 偶尔无视「禁止@开头」要求，落库前再洗一遍——正文绝不带「回复 @xx：」「@xx 」） */
function stripReplyPrefixClient(raw: string): string {
  let t = raw.trim();
  for (let i = 0; i < 3; i++) {
    const next = t
      .replace(/^[回复回覆]?\s*[@＠]\S{1,24}\s*[:：，,\s]\s*/, '')
      .replace(/^回复\s*[^@\s：:，,]{1,24}\s*[:：]\s*/, '')
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

/** 求推荐/求助帖检测（v7 用户反馈：楼主求「不烧脑不虐心」的剧，NPC 却回「中间注水、
 *  结局烂尾」——池子兜底也要看帖作答，求什么答什么） */
const REQUEST_POST_RE = /求推荐|求推|推荐一下|推荐几|有没有.{0,8}(推荐|好看|好听的)|剧荒|书荒|歌荒|安利|求个|求助|跪求|在线等|姐妹们.{0,6}推|家人们.{0,6}推|求下饭|求剧|求歌|求攻略|怎么选|哪个好|求避雷/i;

/** 求推荐/求助专用兜底池：只有「真心推荐（带具体作品）」「同求」「避雷（带名字）」
 *  三类正面回答——求推荐帖绝不落剧情评价类万金油 */
const REQUEST_COMMENT_POOL: string[] = [
  '同求！我也想要这种的，蹲一个',
  '同求，收藏了等评论区大佬',
  '蹲蹲蹲，也想看这种的',
  '去搜「爱慕虚颜的猫」，纯甜无刀，我上个月刚二刷',
  '推荐「面包和汤和猫咪好天气」，节奏慢悠悠的特别下饭，一点不虐',
  '「孤独的美食家」了解下，一集吃一顿饭，零脑零虐',
  '「想做饭的女人和想吃饭的女人」甜到我打滚，每集二十分钟无脑嗑',
  '「俗女养成记」！好笑又温暖，哭也是那种释怀的哭不算虐',
  '「森林民宿」慢综艺化的剧，看着看着就困了，助眠神器',
  '避雷「深空之眼」，前面甜后面全是刀，我被创死了',
  '别看「漫长的季节」……不是说不好，是后劲太大，不算不虐心',
  '「重启人生」！治愈系神作，看完只想好好生活',
  '「我的解放日志」慢一点但很舒服，适合下班瘫着看',
  '我片单跟你需求一模一样，已收藏这条帖子',
  '马克！看完回来汇报',
  '听我的，先看「请回答1988」，笑点泪点都刚刚好',
  '「风骚律师」不行，太烧脑，快进到「摩登家庭」无脑笑就完事了',
  '求同款！上次按评论区推荐看的「装腔启示录」还行，不虐',
];

/** 求推荐池优先：帖子在求东西时，兜底评论必须正面回答（推荐/同求/避雷） */
function pickRequestComment(postContent: string, used: Set<string>): string | null {
  if (!REQUEST_POST_RE.test(postContent)) return null;
  for (let i = 0; i < 40; i++) {
    const cand = REQUEST_COMMENT_POOL[Math.floor(Math.random() * REQUEST_COMMENT_POOL.length)];
    if (!used.has(cand.slice(0, 16))) {
      used.add(cand.slice(0, 16));
      return cand;
    }
  }
  return null;
}

/** 兜底评论：按帖子内容命中的主题池抽取（对得上帖子内容，不是万金油），
 *  主题池尽/未命中 → 通用池。外语评论者走外语通用池。
 *  v7：求推荐/求助帖 → 优先求推荐池（求什么答什么，绝不答非所问）。 */
function pickTopicComment(postContent: string, lang: string, used: Set<string>, community?: string | null): string | null {
  if (lang !== 'zh-Hans') {
    const cand = pickGenericComment(lang, used);
    if (cand) return cand;
  }
  // 求推荐/求助帖优先：正面回答（推荐/同求/避雷），再考虑主题池
  const req = pickRequestComment(postContent, used);
  if (req) return req;
  // 版块优先：帖子所在版块的领域池先抽（追星帖出追星评论，车帖出车友评论）
  const pools: { re: RegExp; subject: string; comments: string[] }[] = [];
  const commIdx = community ? COMMUNITY_POOLS[community] ?? [] : [];
  for (const i of commIdx) pools.push(TOPIC_COMMENT_POOLS[i]);
  // 再补关键词命中的池（版块没匹配到时兜底；已加入的不重复）
  const hit = TOPIC_COMMENT_POOLS.filter((p) => p.re.test(postContent) && !pools.includes(p));
  pools.push(...hit);
  if (!pools.length) return pickGenericComment('zh-Hans', used);
  for (let i = 0; i < 60; i++) {
    const pool = pools[Math.floor(Math.random() * pools.length)];
    const raw = pool.comments[Math.floor(Math.random() * pool.comments.length)];
    const cand = raw.replaceAll('{t}', topicSubjectOf(postContent, pool.subject));
    if (!used.has(cand.slice(0, 16))) {
      used.add(cand.slice(0, 16));
      return cand;
    }
  }
  return pickGenericComment('zh-Hans', used);
}

/** 组合式帖子兜底（NPC 池耗尽 + LLM 失败时：话题×开头×正文×结尾 组合出近乎无限的帖子，
 *  保证「下滑无限生成」在任何情况下都有新内容；主题与 FEED_TOPICS 同向） */
const GEN_TOPICS = ['明星塌房', '恋情官宣', '热搜第一', '大结局烂尾', '新剧上头', '电影彩蛋', '提车第一天', '油价', '早高峰堵车', '司机加塞', '综艺名场面', '红毯造型', '剧组路透', '新车发布', '试驾感受', '二手车避坑', '追星开销', '剧荒求推', '瓜反转', '代拍乱象'];
const GEN_MOODS = [
  '刚刷到{t}，先蹲一个后续：',
  '关于{t}，说点个人看法：',
  '{t}这事儿，懂的都懂。',
  '不是，{t}都能上热搜？',
  '{t}，建议全体围观：',
  '一觉醒来又被{t}刷屏了。',
  '有人聊{t}吗，在线等。',
  '今日份{t}，瓜保熟：',
];
const GEN_BODIES = [
  '前排吃瓜，目前信息还很乱，先别急着站队',
  '瓜越吃越大，反转比剧还精彩，我已经搬好小板凳了',
  '追了三季，这个走向我直接傻眼，编剧你出来',
  '红毯造型一出，评论区已经吵了八百楼',
  '试驾了一圈，动力是真好，价格也是真硬',
  '早高峰被加塞三次，血压和油门一起踩到底了',
  '路透看着还行，正片出来之前保持冷静',
  '官宣文案我都能背了，就等一个后续',
  '粉丝说是状态问题，路人说是审美问题，我说都有问题',
  '第二集开始封神，安利给所有还没看的人',
  '剧组宣发真会玩，预告剪得比正片好看',
  '朋友提了新车，我把副驾坐出包浆了',
  '黄牛加价三倍，官方声明管用吗，蹲一个结果',
  '这瓜保熟吗，先让子弹飞一会儿',
];
const GEN_TAILS = ['评论区蹲一个真相。', '有懂哥出来讲讲吗？', '理性讨论，别吵架。', '先吃瓜，后负责。', '就问还有谁。', '懂的都懂。', '让我看看谁的DNA动了。', ''];

/** 外语整帖兑底（LLM 失败时外语网友的帖子：每个语言一组真实感短帖，
 *  与中文组合池互补——多语言不只依赖 LLM） */
const GEN_FOREIGN: { lang: string; texts: string[] }[] = [
  {
    lang: 'zh-Hant',
    texts: [
      '今天在百貨公司碰到某頂流本人，真人比螢幕帥太多了，直接看呆，一句話都說不出來。',
      '那對cp的戀情官宣了，一點都不意外，早就看出來了，恭喜恭喜。',
      '這部劇的結局爛到我說不出話，編劇出來面對，我投入的感情可以退貨嗎。',
      '今天熱搜太精彩了，前十有三條都是瓜，吃不完，根本吃不完。',
      '新車發佈會看完，大家又開始吵價格了，每次都這樣，累不累啊。',
      '演唱會現場那個安可環節，全場大合唱，我在人群裡直接哭出來，值得。',
      '同事今天又在那邊炫耀她的新包，我就靜靜看她表演，內心毫無波瀾（有一點）。',
    ],
  },
  {
    lang: 'en',
    texts: [
      'Just ran into that A-list actor at the mall today. He is SO much more handsome in person, I literally froze and forgot how to speak.',
      'The celebrity couple news dropped and honestly? Not even surprised. We all saw it coming months ago.',
      'That drama finale ruined my entire week. I want a refund for my emotions. Writer, come out and face us.',
      'Hot search is wild today. Three gossip trends in the top ten. What is going on this week.',
      'New car launch watched, and everyone is fighting about the price again. It is ALWAYS about the price.',
      'The fandom drama today is more entertaining than any show I have watched this year. Popcorn ready, staying tuned.',
      'Waiting outside the venue for six hours was worth it. The moment he waved at our section, I stopped functioning.',
    ],
  },
  {
    lang: 'ja',
    texts: [
      '今日デパートであの俳優さんを目撃。画面より断然かっこよくて、マジで固まった。手を振ればよかった。',
      'あのカップルの熱愛報道、やっと出たね。前からそうだと思ってた。おめでとう。',
      'ドラマの最終回が酷すぎて一週間引きずってる。感情の返金を要求したい。',
      '今日のトレンド、お祭り騒ぎすぎて追いつかない。瓜（お祭り）を食べるのも一苦労。',
      '新車の発表見たけど、また値段の議論ばっかり。毎回そう。',
      'ライブのアンコールで会場全体が大合唱して、私だけ泣いてた。行ってよかった。',
    ],
  },
  {
    lang: 'ko',
    texts: [
      '오늘 백화점에서 그 배우 봤는데 진짜 미모가 실화냐. 눈 못 떼었음. 인증샷은 못 찍지만 진짜임.',
      '그 커플 열애설 드디어 인정했네. 뜨악하지도 않았음. 다들 알고 있었어.',
      '드라마 결말 실화냐… 일주일째 못 벗어나고 있음. 감정 환불 요청합니다.',
      '오늘 실시간 검색어 개쩜. 연예 뉴스가 셋이나 상위권. 이번 주는 뭐가 다 그렇다.',
      '새차 출시 봤는데 또 가격 논쟁 시작. 늘 그 패턴.',
      '공장 앞 6시간 기다린 보람 있었음. 우리 쪽 손 흔들어줄 때 심장 멎는 줄.',
    ],
  },
];

/** 从组合池里抽一条不重复的帖子文案（used = 已用内容前缀指纹；80 次抽不到就放弃）。
 *  lang 指定语言：外语走整帖兑底池（外语池尽 → 落中文组合池）。 */
function comboPostText(used: Set<string>, lang = 'zh-Hans'): string | null {
  if (lang !== 'zh-Hans') {
    const g = GEN_FOREIGN.find((x) => x.lang === lang);
    if (g) {
      const cand = g.texts.filter((x) => !used.has(x.slice(0, 20)));
      if (cand.length) {
        const s = cand[Math.floor(Math.random() * cand.length)].slice(0, POST_MAX);
        used.add(s.slice(0, 20));
        return s;
      }
    }
    // 外语池尽：落中文组合池（外语网友用翻译器发中文帖，也真实）
  }
  for (let i = 0; i < 80; i++) {
    const t = GEN_TOPICS[Math.floor(Math.random() * GEN_TOPICS.length)];
    const m = GEN_MOODS[Math.floor(Math.random() * GEN_MOODS.length)].replace('{t}', t);
    const b = GEN_BODIES[Math.floor(Math.random() * GEN_BODIES.length)];
    const tail = GEN_TAILS[Math.floor(Math.random() * GEN_TAILS.length)];
    const s = `${m}${b}。${tail}`.slice(0, POST_MAX);
    const k = s.slice(0, 20);
    if (!used.has(k)) {
      used.add(k);
      return s;
    }
  }
  return null;
}

/** 批量生成一批 feed 帖子（作者池 = 动态真实感网友为主：新面孔 ~60% + 老网友回访 ~24%
 *  + 内置主题 NPC 缩减到 ~8%（v4：网名与内容都靠 LLM，内置池子仅作保底）+ char 好友 ~8%，
 *  动态网友按原型轮换 → 信息流大杂烩，每隔几条就是完全不同领域和语气的人；
 *  复用的老网友带 recent 记忆 → 跨帖连通）。
 *  LLM 批量（设置›API 模型）→ NPC 文案池轮换补齐（每 NPC 一轮只出一条，绝不连发）
 *  → 组合式兜底，任何情况下都有内容。
 *  used = 全局内容前缀指纹（跨调用累积去重）。 */
async function buildFeedBatch(
  n: number,
  used: Set<string>,
  avoid: string[],
): Promise<{ key: AuthorKey; text: string; recent?: string[] }[]> {
  const chars = forumContactsSnap().filter((c) => c.kind === 'char' && (c.persona || c.background));
  const shuffledNpcs = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
  const topics = FEED_TOPICS.slice().sort(() => Math.random() - 0.5);
  // 原型轮换环（打工人→饭圈女孩→数码极客→宝妈→搞笑女……保证大杂烩）
  const archRing = ARCHETYPE_IDS.slice().sort(() => Math.random() - 0.5);
  const specs: { key: AuthorKey; name: string; persona: string; community: string | null; topic: string; lang: string; recent?: string[] }[] = [];
  // 本批新建的动态网友（LLM 起名目标；池子名只是占位）
  const newDyn: AuthorKey[] = [];
  let npcCursor = 0;
  let archCursor = 0;
  for (let i = 0; i < n; i++) {
    const topic = topics[i % topics.length];
    const r = Math.random();
    if (chars.length && r < 0.08) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      specs.push({
        key: `char:${ch.id}`,
        name: ch.nickname || ch.name,
        persona: [ch.persona, ch.background, ch.expressStyle].filter(Boolean).join('；'),
        community: null,
        topic,
        lang: 'zh-Hans',
      });
    } else if (r < 0.16) {
      // 内置主题 NPC（v4 缩减到 ~8%，只作保底大 V；轮换环保证一环内不重复；
      // v5 名字/persona 走 resolveAuthor——内置 NPC 也挂着 LLM 名）
      const nd = shuffledNpcs[npcCursor++ % shuffledNpcs.length];
      const a = resolveAuthor(`npc:${nd.id}` as AuthorKey);
      specs.push({ key: `npc:${nd.id}`, name: a.name, persona: a.persona ?? nd.persona, community: defaultCommunityFor(nd.id), topic, lang: 'zh-Hans' });
    } else if (r < 0.4) {
      // 老网友回访（带 recent 记忆：上一个帖子里聊过的事，这次能接上话疸）
      const d = forumData();
      const dynIds = Object.keys(d.dynNpcs ?? {});
      if (dynIds.length) {
        const key = `dyn:${dynIds[Math.floor(Math.random() * dynIds.length)]}`;
        const a = resolveAuthor(key);
        const npc = d.dynNpcs![key.slice(4)];
        specs.push({ key, name: a.name, persona: a.persona ?? '', community: null, topic, lang: a.lang ?? 'zh-Hans', recent: npc.recent });
        continue;
      }
      // 池子还空（首刷）：落新网友
      const key = createDynNpc({ archetypeId: archRing[archCursor++ % archRing.length] });
      newDyn.push(key);
      const a = resolveAuthor(key);
      specs.push({ key, name: a.name, persona: a.persona ?? '', community: null, topic, lang: a.lang ?? 'zh-Hans' });
    } else {
      // 新面孔（原型轮换：每隔几条就是完全不同领域的人）；网名随后由 LLM 起
      const key = createDynNpc({ archetypeId: archRing[archCursor++ % archRing.length] });
      newDyn.push(key);
      const a = resolveAuthor(key);
      specs.push({ key, name: a.name, persona: a.persona ?? '', community: null, topic, lang: a.lang ?? 'zh-Hans' });
    }
  }

  // LLM 批量生成（一次 7~20 条；失败静默走池子；recent = 老网友最近发过的内容，LLM 据此接话疸）
  // v7 契约：服务端严格 JSON 解析后的对象数组（第 i 项对应第 i 位作者，无效项
  // content 为空串——这里直接跳过，文案池在尾部补齐，作者不错位）
  const results: { key: AuthorKey; text: string; textImage?: string }[] = [];
  try {
    const r = (await callApi({
      kind: 'posts',
      items: specs.map(({ name, persona, community, topic, lang, recent }) => ({ name, persona, community: community ?? '今日热议', topic, lang, recent })),
      avoid,
      userName: resolveAuthor('user').name,
    })) as { items?: { content?: unknown; textImage?: unknown }[] };
    const objs = Array.isArray(r.items) ? r.items : [];
    objs.forEach((o, i) => {
      const spec = specs[i];
      if (!spec) return;
      const content = typeof o?.content === 'string' ? o.content.trim() : '';
      if (content.length < 4) return; // 无效条目 → 池子兜底补齐
      const k = content.slice(0, 20);
      if (used.has(k)) return;
      used.add(k);
      const ti = typeof o?.textImage === 'string' ? o.textImage.trim() : '';
      results.push({
        key: spec.key,
        text: content,
        textImage: ti.length >= 2 && ti.length <= 40 && ti !== content ? ti : undefined,
      });
    });
  } catch {
    /* 走池子兜底 */
  }
  // NPC 文案池补齐（LLM 失败/条数不足）：轮换环——每个 NPC 一轮只出一条，
  // 同一批内绝不连续出现同一作者（修复「秋名山下打车连发多条」刷屏 Bug 的关键）
  if (results.length < n) {
    let rounds = 0;
    while (results.length < n && rounds < 60) {
      let addedThisRound = 0;
      for (const npc of shuffledNpcs) {
        if (results.length >= n) break;
        const cand = npc.pool.find((x) => !used.has(x.slice(0, 20)));
        if (!cand) continue;
        used.add(cand.slice(0, 20));
        results.push({ key: `npc:${npc.id}`, text: cand });
        addedThisRound += 1;
      }
      if (!addedThisRound) break; // 池子彻底耗尽
      rounds += 1;
    }
  }
  // NPC 池也耗尽 → 组合式生成兜底（话题×开头×正文×结尾 + 外语整帖，近乎无限；作者轮换环）
  if (results.length < n) {
    const d = forumData();
    const dynIds = Object.keys(d.dynNpcs ?? {}).sort(() => Math.random() - 0.5);
    const npcRing = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
    let rr = 0;
    while (results.length < n) {
      const spec = specs[results.length] ?? specs[specs.length - 1];
      const lang = spec?.key.startsWith('dyn:') ? resolveAuthor(spec.key).lang ?? 'zh-Hans' : 'zh-Hans';
      const t = comboPostText(used, lang);
      if (!t) break;
      // 作者轮换：动态网友与内置 NPC 交替，同批不重样
      const author: AuthorKey =
        dynIds.length && rr % 3 !== 2
          ? `dyn:${dynIds[rr % dynIds.length]}`
          : `npc:${npcRing[rr % npcRing.length].id}`;
      results.push({ key: author, text: t });
      rr += 1;
    }
  }
  // LLM 起名：本批新建的动态网友换 AI 生成的网名（在调用方落盘前完成；失败保留占位名）
  if (newDyn.length) await renameDynNpcsViaLlm(newDyn);
  return results;
}

/** 主页滑到最后一个帖子、继续上滑并松开 → 无限生成一批新帖子（过界手势触发）。
 *  - 一次 7~15 条（用户要求；LLM 批量，设置里的 API 模型，主题：八卦/明星/吐槽/车/影视/娱乐/吃瓜）；
 *  - 时间戳排在现有最老主帖之前（信息流向下无限延伸，旧帖永不消失）；
 *  - 防刷屏：与现有 feed 尾部作者隔开 + 批内绝不连排；时间间隔自然衰减（40分钟~几小时，偶尔隔天）。
 *  返回本次新增条数。 */
// ---------------- 生成帖子按需配「文字图片」（v9） ----------------

/** 单批最多文字图片数（太多会刷屏，像人人都发金句图） */
const FEED_TEXTIMG_MAX = 3;

/** 给一条新生成的帖子按需配「文字图片」（v9：用户要求的配图方式——
 *  用文字描述图片，即把 LLM 给出的短句 canvas 渲染成白底居中灰字的
 *  文字图，与发布弹层「文字图片」同款观感）：
 *  纯前端直出，零 API 成本、同步完成不阻塞；渲染失败静默保持纯文字。
 *  count 为本批已配图计数（跨帖子共享，封顶 FEED_TEXTIMG_MAX）。 */
function attachTextImage(post: ForumPost, textImage: string | undefined, count: { n: number }): void {
  const ti = textImage?.trim();
  if (!ti || ti.length < 2 || ti.length > 40 || post.media?.length) return;
  if (count.n >= FEED_TEXTIMG_MAX) return;
  try {
    post.media = [renderTextImage(ti)];
    count.n += 1;
  } catch {
    /* canvas 不可用等：保持纯文字 */
  }
}

/** 主页滑到底、上拉松开 → 生成一批更早的帖子（追加在信息流下方，旧帖永不消失）。 */
export async function generateMoreFeedPosts(): Promise<number> {
  if (feedGenerating) return 0;
  feedGenerating = true;
  try {
    const d = forumData();
    if (!d.seeded) return 0;
    const n = 7 + Math.floor(Math.random() * 9); // 7~15 条（用户要求）
    // 时间边界：全部主帖里最老的时间，新帖排在它之前（feed 下方）；
    // 同时拿到它的作者——新批次与它隔开（防刷屏跨批次也生效）
    let frontier = Date.now();
    let frontierAuthor: AuthorKey | undefined;
    for (const p of d.posts) {
      if (p.replyTo === null && p.createdAt < frontier) {
        frontier = p.createdAt;
        frontierAuthor = p.authorKey;
      }
    }
    // 防重复：取现有全部帖子的前缀指纹
    const used = new Set(d.posts.map((p) => p.content.slice(0, 20)));
    const avoid = [...d.posts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((p) => p.content.slice(0, 60));

    const raw = await buildFeedBatch(n, used, avoid);
    if (!raw.length) return 0;
    // 防刷屏重排：绝不连续同一作者（含与 feed 现有尾部那奈）
    const results = shuffleNoAdjacent(raw, frontierAuthor);

    // 落库：时间戳自 frontier 向前铺（自然衰减：40分钟~3.5小时一档，10% 隔半天）；
    // 同一作者的帖子若同批出现两次，天然被隔到不同深度（时间差拉开）
    const next = { ...forumData() };
    let at = frontier - (8 + Math.random() * 30) * 60_000;
    const imgCount = { n: 0 }; // 本批文字图片计数（封顶 FEED_TEXTIMG_MAX）
    results.forEach(({ key, text, textImage }, i) => {
      const tag = /#([^#\s]+)#/.exec(text)?.[1];
      const cid = key.startsWith('npc:')
        ? communityOfPoolText(key.slice(4), text)
        : tag
          ? NPC_COMMUNITY_MAP[tag] ?? null
          : null;
      const p = basePost(key, text, cid, at);
      attachTextImage(p, textImage, imgCount); // v9：按需配文字图片（canvas 同步直出）
      next.posts.push(p);
      recordDynNpcRecent(key, text); // 人设连通性
      at -= naturalGapMs(6 + i); // 底部生成：间隔从几十分钟起拉大
    });
    next.lastGenAt = Date.now();
    saveForum(next);
    return results.length;
  } catch {
    return 0;
  } finally {
    feedGenerating = false;
  }
}

/** 主页滑到最顶部、下拉并松开 → 生成一批全新内容（过界手势触发）。
 *  - 一次 7~15 条（用户要求），时间戳全部晚于现有最新帖（新内容整批插入信息流最上方）；
 *  - 防刷屏 + 自然时间衰减（最新一条「刚刚」，往下几分钟→几十分钟）；
 *  - 与底部生成共用互斥锁与批量生成器，旧帖永不消失。 */
export async function generateNewFeedPosts(): Promise<number> {
  if (feedGenerating) return 0;
  const d0 = forumData();
  if (!d0.seeded) return 0;
  feedGenerating = true;
  try {
    const n = 7 + Math.floor(Math.random() * 9); // 7~15 条（用户要求）
    const used = new Set(d0.posts.map((p) => p.content.slice(0, 20)));
    const avoid = [...d0.posts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((p) => p.content.slice(0, 60));

    const raw = await buildFeedBatch(n, used, avoid);
    if (!raw.length) return 0;
    // 防刷屏重排（新内容插最上方，批内绝不连排）
    const results = shuffleNoAdjacent(raw);

    // 落库：最新一条 = 刚刚（30~90 秒前），往下自然衰减（几分钟→几十分钟）；
    // 不越过现有最新帖（否则会被旧帖压到下面）
    const next = { ...forumData() };
    let newestExisting = 0;
    for (const p of next.posts) newestExisting = Math.max(newestExisting, p.createdAt);
    const floorAt = newestExisting + 90_000;
    let at = Date.now() - (30 + Math.random() * 60) * 1000;
    const imgCount = { n: 0 }; // 本批文字图片计数（封顶 FEED_TEXTIMG_MAX）
    results.forEach(({ key, text, textImage }, i) => {
      const tag = /#([^#\s]+)#/.exec(text)?.[1];
      const cid = key.startsWith('npc:')
        ? communityOfPoolText(key.slice(4), text)
        : tag
          ? NPC_COMMUNITY_MAP[tag] ?? null
          : null;
      const p = basePost(key, text, cid, at);
      attachTextImage(p, textImage, imgCount); // v9：按需配文字图片（canvas 同步直出）
      next.posts.push(p);
      recordDynNpcRecent(key, text); // 人设连通性
      at = Math.max(at - naturalGapMs(i), floorAt);
    });
    next.lastGenAt = Date.now();
    saveForum(next);
    return results.length;
  } catch {
    return 0;
  } finally {
    feedGenerating = false;
  }
}

// ---------------- 帖子评论区批量生成（7~15 条 + 楼中楼；仅「更多评论」按钮触发） ----------------

/** 正在生成评论的帖子 id（防并发重复） */
const threadGen = new Set<string>();

/** 随机挑评论者（用户要求评论区网名也要真实不重复）：
 *  ~58% 动态真实感新网友（每条帖子评论区大量新面孔）+ ~24% 已有动态网友回访
 *  + ~10% 内置 NPC + char 好友穿插。
 *  postLang = 主帖语言（外语帖评论区外语网友更多）；
 *  postContent = 主帖内容（新网友的人设原型向帖子主题倾斜：车帖更容易招来车友）；
 *  avoidKeys = 本帖内已出现过的作者（同帖不重复 + 避开楼主——真实评论区没有复读机）。 */
function pickCommenters(count: number, postLang?: string, postContent?: string, ...avoidKeys: AuthorKey[]): AuthorKey[] {
  const d = forumData();
  const chars = forumContactsSnap().filter((c) => c.kind === 'char' && (c.persona || c.background));
  const npcs = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
  const dynKeys = Object.keys(d.dynNpcs ?? {});
  const bias = postLang && postLang !== 'zh-Hans' ? postLang : undefined;
  // 帖子主题 → 更可能来评论的人设原型（评论区同温层，但保留乱入的乐子人）
  const archBias = postContent ? archetypeIdsForContent(postContent) : [];
  const seen = new Set<AuthorKey>(avoidKeys.filter(Boolean));
  const out: AuthorKey[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 12) {
    const r = Math.random();
    let k: AuthorKey;
    if (chars.length && r < 0.06) {
      k = `char:${chars[Math.floor(Math.random() * chars.length)].id}`;
    } else if (r < 0.1) {
      // 内置 NPC 缩减到 ~4%（v4：评论区也以动态网友为主，网名靠 LLM）
      k = `npc:${npcs[out.length % npcs.length].id}`;
    } else if (r < 0.4 && dynKeys.length) {
      // 已有动态网友回访（同一人出现在不同帖子评论区，真实论坛常态）
      k = `dyn:${dynKeys[Math.floor(Math.random() * dynKeys.length)]}`;
    } else {
      // 新面孔：60% 概率人设原型贴合帖子主题，40% 纯随机乱入（大杂烩）
      const archId = archBias.length && Math.random() < 0.6 ? archBias[Math.floor(Math.random() * archBias.length)] : undefined;
      k = createDynNpc({ archetypeId: archId, langBias: bias });
    }
    if (seen.has(k)) continue; // 同帖去重：换下一个人（绝不连发两条）
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 帖子内容 → 相关人设原型 id 列表（评论者与帖子同领域，评论才对得上内容） */
function archetypeIdsForContent(content: string): string[] {
  const map: { re: RegExp; ids: string[] }[] = [
    { re: /车|油|堵|驾|4S|提车|试驾|胎|加塞|变道/i, ids: ['laosiji', 'xinshou', 'beipiao', 'dagong'] },
    { re: /剧|追|烂尾|编剧|男主|女主|电影|影院|综艺|红毯|上映|剧荒|倍速/i, ids: ['zhuiju', 'yemao', 'daxuesheng', 'gaoxiao'] },
    { re: /瓜|塌|恋情|官宣|热搜|爆料|同框|拍到|辟谣|反转|吃瓜/i, ids: ['chigua', 'fanquan', 'kebiao', 'gangjing'] },
    { re: /明星|偶像|爱豆|本命|追星|演唱会|应援|粉丝|代拍|安可/i, ids: ['fanquan', 'gaoxiao', 'chigua'] },
    { re: /班|老板|工资|加班|通勤|辞职|摸鱼|周报|开会|同事|打工/i, ids: ['dagong', 'beipiao', 'kafei', 'daxuesheng'] },
    { re: /手机|芯片|跑分|新机|发布会|显卡|装机|屏幕|数码/i, ids: ['shuma', 'ningmeng', 'dagong'] },
    { re: /游戏|排位|上分|开黑|外挂|新游/i, ids: ['youxi', 'daxuesheng', 'yemao'] },
    { re: /猫|狗|宠物|铲屎|主子/i, ids: ['chanshou', 'baoma', 'gaoxiao'] },
    { re: /吃|喝|外卖|探店|美食|火锅|奶茶|咖啡|宵夜/i, ids: ['chihuo', 'shengqian', 'jianshen'] },
    { re: /失眠|熬夜|凌晨|睡不着|emo|深夜/i, ids: ['yemao', 'beipiao', 'daxuesheng'] },
    { re: /健身|减脂|体脂|蛋白|深蹲/i, ids: ['jianshen', 'chihuo'] },
    { re: /考研|背书|图书馆|自习/i, ids: ['kaoyan', 'daxuesheng'] },
  ];
  const out: string[] = [];
  for (const m of map) if (m.re.test(content)) out.push(...m.ids);
  return out;
}

/** 生成一批评论并落库（LLM 批量 + 池子兜底 + 楼中楼子回复）。
 *  仅由「显示更多评论」按钮触发（用户要求：生成完后不再自动生成，
 *  只有用户自己上滑/下滑、点更多评论时才生成）；一次 7~15 条。
 *  返回新增评论数（含子回复）。 */
async function genCommentBatch(postId: string): Promise<number> {
  if (threadGen.has(postId)) return 0;
  const d0 = forumData();
  const post = d0.posts.find((p) => p.id === postId);
  if (!post) return 0;
  const want = 7 + Math.floor(Math.random() * 9); // 7~15 条（用户要求）
  threadGen.add(postId);
  try {
    const d = forumData();
    const postAuthor = resolveAuthor(post.authorKey);
    // 本帖现有评论（顶层 + 楼中楼）——去重与 avoid 只看本帖：
    // 不同帖子评论区出现相似短评很正常，全局去重会把池子过早耗尽
    const threadReplies = d.posts.filter(
      (p) => p.replyTo === postId || d.posts.some((c) => c.id === p.replyTo && c.replyTo === postId),
    );
    // 识图模型：帖子带图先「看图」，AI 评论才有画面感
    const mediaDesc = await describePostMedia(post.media);
    // 主帖语言（外语帖评论区外语网友更多）
    const postLang = resolveAuthor(post.authorKey).lang ?? 'zh-Hans';
    // 评论者：新面孔 + 老网友回访；同帖去重（含已有评论者 + 楼主，绝不复读）
    const existingKeys = threadReplies.map((p) => p.authorKey);
    const dynBefore = new Set(Object.keys(forumData().dynNpcs ?? {}));
    const commenterKeys = pickCommenters(want, postLang, post.content, post.authorKey, ...existingKeys);
    // 本批新建的评论者（LLM 起名目标；池子名只是占位）
    const newDynCommenters = commenterKeys.filter((k) => k.startsWith('dyn:') && !dynBefore.has(k.slice(4)));
    const avoid = threadReplies.slice(-10).map((p) => p.content.slice(0, 40));

    // ---- 顶层评论（LLM 批量，池子兜底） ----
    let texts: string[] = [];
    try {
      const r = (await callApi({
        kind: 'comments',
        post: { authorName: postAuthor.name, content: post.content, mediaDesc },
        count: want,
        personas: commenterKeys.map((k) => {
          const a = resolveAuthor(k);
          const recent = k.startsWith('dyn:') ? forumData().dynNpcs?.[k.slice(4)]?.recent : undefined;
          return { name: a.name, persona: a.persona || '普通论坛网友', lang: a.lang ?? 'zh-Hans', recent };
        }),
        avoid,
        userName: resolveAuthor('user').name,
      })) as { items?: string[] };
      texts = Array.isArray(r.items)
        ? r.items.map((x) => (typeof x === 'string' ? stripReplyPrefixClient(x) : x)).filter((x) => typeof x === 'string' && x.trim().length >= 2)
        : [];
    } catch {
      texts = [];
    }
    if (texts.length < want) {
      // 池子兜底：按帖子内容命中的主题评论池（评论对得上帖子内容，不是万金油）
      // + 外语评论者走外语通用池；去重仅限本帖，保证任何帖子都能补满
      const usedCt = new Set<string>([
        ...texts.map((t) => t.slice(0, 16)),
        ...threadReplies.map((p) => p.content.slice(0, 16)),
      ]);
      let ni = 0;
      while (texts.length < want && ni < 400) {
        const idx = texts.length;
        const commenterLang = resolveAuthor(commenterKeys[idx] ?? 'user').lang ?? 'zh-Hans';
        const cand = pickTopicComment(post.content, commenterLang, usedCt, post.community) ?? pickGenericComment('zh-Hans', usedCt);
        if (cand) {
          usedCt.add(cand.slice(0, 16));
          texts.push(cand);
        }
        ni += 1;
      }
    }
    if (!texts.length) return 0;

    // LLM 起名：本批新建的评论者换 AI 生成的网名（在落盘前完成——
    // 评论作者名与楼中楼「回复 @xx」一并用新名；失败保留占位名）
    if (newDynCommenters.length) await renameDynNpcsViaLlm(newDynCommenters);

    // 时间戳：在（发帖时间、现在］内升序铺开；已有评论则从最后一条之后接。
    // 修复：起点不再越过「现在」（旧逻辑全新帖会把起点排到未来，全部被钳到同一毫秒）
    const lastAt = threadReplies.reduce((m, p) => Math.max(m, p.createdAt), 0);
    const hi = Date.now() - 5_000;
    let lo = Math.max(post.createdAt + 60_000, lastAt + 60_000);
    if (lo > hi - texts.length * 1_500) lo = hi - texts.length * 1_500;
    lo = Math.max(lo, post.createdAt + 5_000);
    const span = Math.max(hi - lo, texts.length * 1_000);

    const next: ForumData = { ...forumData() };
    const newComments: ForumPost[] = [];
    // 主帖热度（评论点赞/浏览按父帖比例缩放：评论赞 << 主帖赞，像推特一样合理）
    const postEng = { likes: likesOf(post), views: post.views };
    texts.forEach((t, i) => {
      const at = Math.floor(lo + (span * (i + 0.2 + Math.random() * 0.65)) / texts.length);
      const authorKey = commenterKeys[i] ?? commenterKeys[commenterKeys.length - 1];
      const c = basePost(authorKey, t.slice(0, REPLY_MAX), post.community, at, postId, postAuthor.name, true, postEng);
      newComments.push(c);
      next.posts.push(c);
      // 人设连通性：记录动态网友最近评论过的内容（下次发帖/评论能接上话疸）
      recordDynNpcRecent(authorKey, `评论过：${t.slice(0, 60)}`);
    });

    // ---- 楼中楼：约 1/3 的新评论各来 1 条子回复（其他网友/楼主接话） ----
    try {
      const subTargets = newComments
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.max(1, Math.floor(newComments.length / 3)));
      if (subTargets.length) {
        // 子回复作者：其他网友（动态+内置混合，偶尔楼主本人回评，很 X）；同帖去重
        const dynBeforeSubs = new Set(Object.keys(forumData().dynNpcs ?? {}));
        const subKeys = subTargets.map((c) => {
          if (post.authorKey !== 'user' && Math.random() < 0.3) return post.authorKey;
          return pickCommenters(1, postLang, post.content, post.authorKey, ...existingKeys, ...commenterKeys)[0];
        });
        let subTexts: string[] = [];
        try {
          const r = (await callApi({
            kind: 'subreplies',
            post: { authorName: postAuthor.name, content: post.content, mediaDesc },
            threads: subTargets.map((c) => ({ authorName: resolveAuthor(c.authorKey).name, content: c.content })),
            personas: subKeys.map((k) => {
              const a = resolveAuthor(k);
              return { name: a.name, persona: a.persona || '普通论坛网友', lang: a.lang ?? 'zh-Hans' };
            }),
            userName: resolveAuthor('user').name,
          })) as { items?: string[] };
          subTexts = Array.isArray(r.items)
            ? r.items.map((x) => (typeof x === 'string' ? stripReplyPrefixClient(x) : x)).filter((x) => typeof x === 'string' && x.trim().length >= 2)
            : [];
        } catch {
          subTexts = [];
        }
        // 兜底子回复共享去重集（同一帖的楼中楼不重复用同一条兜底文案）
        const usedSub = new Set<string>();
        subTargets.forEach((c, i) => {
          let text = subTexts[i];
          if (!text) {
            // 池子兜底：优先主题匹配（接得上评论/主帖），外语网友外语接话
            const subLang = resolveAuthor(subKeys[i]).lang ?? 'zh-Hans';
            text = pickTopicComment(`${c.content} ${post.content}`, subLang, usedSub) ?? pickGenericComment(subLang, usedSub) ?? pickGenericComment('zh-Hans', usedSub) ?? '哈哈哈哈';
          }
          const subAt = Math.min(Date.now() - Math.floor(Math.random() * 60_000), c.createdAt + (2 + Math.random() * 30) * 60_000);
          const sub = basePost(
            subKeys[i],
            text.slice(0, REPLY_MAX),
            post.community,
            Math.max(subAt, c.createdAt + 60_000),
            c.id,
            resolveAuthor(c.authorKey).name,
            true,
            { likes: likesOf(c), views: c.views },
          );
          sub.replyToPost = c.id;
          next.posts.push(sub);
        });
        // LLM 起名：楼中楼阶段新建的动态网友也换 AI 网名（落盘前完成；失败保留占位名）
        const subNewDyn = subKeys.filter((k) => k.startsWith('dyn:') && !dynBeforeSubs.has(k.slice(4)));
        if (subNewDyn.length) await renameDynNpcsViaLlm(subNewDyn);
      }
    } catch {
      /* 子回复失败不影响主评论 */
    }

    // 楼主是用户 → 前 3 条评论发通知（X：别人回复了你的帖子）
    if (post.authorKey === 'user') {
      next.notifications = [
        ...newComments.slice(0, 3).map((c) => ({
          id: uid('n'),
          type: 'reply' as const,
          fromKey: c.authorKey,
          postId: c.id,
          createdAt: c.createdAt,
          read: false,
        })),
        ...next.notifications,
      ];
    }
    saveForum(next);
    const subs = next.posts.filter((p) => newComments.some((c) => c.id === p.replyTo)).length;
    return newComments.length + subs;
  } catch {
    return 0;
  } finally {
    threadGen.delete(postId);
  }
}

/** 「更多评论」按钮：再生成 7~15 条（含楼中楼；用户要求：仅按钮触发，打开帖子不自动补）。
 *  返回新增数。 */
export async function generateMoreComments(postId: string): Promise<number> {
  return genCommentBatch(postId);
}

// ---------------- 用户发帖 → NPC/char 互动 ----------------

/** 用户发布帖子后调用：延迟点赞 + 0~2 条 AI 回复（持久 pending）。
 *  互动者也以动态真实感网友为主（点赞/回帖名单不重复）。 */
export function queueUserPostInteractions(post: ForumPost): void {
  const next0 = forumData();
  // 点赞名单：动态网友 + 内置 NPC 混合（3~5 位，不再全是老面孔）
  const likers: AuthorKey[] = [];
  const npcCount = 1 + Math.floor(Math.random() * 2);
  NPC_DEFS.slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, npcCount)
    .forEach((l) => likers.push(`npc:${l.id}`));
  while (likers.length < 3 + Math.floor(Math.random() * 3)) likers.push(createDynNpc());
  // LLM 起名：新建的点赞网友换 AI 生成的网名（通知/主页里都是 AI 起的名；失败保留占位名）
  void renameDynNpcsViaLlm(likers.filter((k) => k.startsWith('dyn:')));
  // char 好友优先来点赞
  const charLiker = next0.posts
    .filter((p) => p.authorKey.startsWith('char:'))
    .map((p) => p.authorKey)[0];
  window.setTimeout(() => {
    try {
      const next = { ...forumData() };
      const p = next.posts.find((x) => x.id === post.id);
      if (!p) return;
      p.likes = [...new Set([...p.likes, ...likers, ...(charLiker ? [charLiker] : [])])];
      // 点赞也发通知（X：有人赞了你的帖子）
      next.notifications = [
        {
          id: uid('n'),
          type: 'like' as const,
          fromKey: likers[0] ?? (charLiker ?? 'npc:wang'),
          postId: post.id,
          createdAt: Date.now(),
          read: false,
        },
        ...next.notifications,
      ];
      saveForum(next);
    } catch {
      /* 静默 */
    }
  }, 3000 + Math.random() * 6000);
  const replyCount = Math.random() < 0.75 ? 1 + (Math.random() < 0.35 ? 1 : 0) : 0;
  for (let i = 0; i < replyCount; i++) {
    addPending({
      id: uid('j'),
      due: Date.now() + 8000 + Math.random() * 12000 + i * (5000 + Math.random() * 8000),
      kind: 'replyToUserPost',
      postKey: post.id,
      // 回帖者优先动态网友（新面孔来搭讪）
      meta: { authorKey: likers[npcCount + i] ?? likers[0], parentContent: post.content },
    });
  }
  // 立即落盘新建的动态网友（点赞名单先持久化，不等延时任务）
  saveForum({ ...forumData() });
  runPending();
}

/** 用户回复某帖/某条评论（thread 页）后调用：若被回复对象作者是 AI，排一条再回复。
 *  targetPostId = 实际被回复的那条（主帖或某条评论/子回复）→ 其作者来接话；
 *  rootId = 分组锚点（顶层评论 id 或主帖 id）→ AI 的回复挂在这一层显示；
 *  mainPostId = 主帖 id（LLM 上下文用）。
 *  每次用户回复都排一条 → 我再回复他、他还能再回复我（无限多轮）。 */
export function queueAiReplyToUserReply(targetPostId: string, userReplyId: string, rootId?: string, mainPostId?: string): void {
  const d = forumData();
  const target = d.posts.find((p) => p.id === targetPostId);
  if (!target || target.authorKey === 'user') return;
  if (!d.posts.find((p) => p.id === userReplyId)) return;
  addPending({
    id: uid('j'),
    due: Date.now() + 5000 + Math.random() * 8000,
    kind: 'aiReplyBack',
    postKey: targetPostId,
    meta: {
      authorKey: target.authorKey,
      parentContent: target.content,
      rootId: rootId ?? targetPostId,
      mainPostId: mainPostId ?? (rootId && rootId !== targetPostId ? rootId : targetPostId),
      userReplyId,
    },
  });
  runPending();
}

// ---------------- 私信 ----------------

/** 用户在私信发消息后调用：对方延迟回复（官方小助手不聊天） */
export function queueDmReply(peerKey: AuthorKey): void {
  if (peerKey === 'official') return;
  addPending({
    id: uid('j'),
    due: Date.now() + 5000 + Math.random() * 7000,
    kind: 'dmReply',
    postKey: peerKey,
    meta: { authorKey: peerKey },
  });
  runPending();
}

// ---------------- pending 执行器 ----------------

/** 把任务挂上 timer（App 打开时 + 新任务入队时调用）。
 *  已挂 timer 的任务保留在持久队列（执行完才删）——App 中途关闭后下次打开会重新挂。 */
export function runPending(): void {
  const p = loadPending();
  const now = Date.now();
  for (const job of Object.values(p)) {
    if (scheduled.has(job.id)) continue;
    const wait = Math.max(0, job.due - now);
    if (wait > 90_000) continue; // 远期任务等下次触发点再挂
    scheduled.add(job.id);
    window.setTimeout(() => {
      void execJob(job).finally(() => dropPending(job.id));
    }, wait);
  }
}

async function execJob(job: PendingJob): Promise<void> {
  try {
    if (job.kind === 'replyToUserPost' || job.kind === 'aiReplyBack') {
      const d = forumData();
      const target = d.posts.find((x) => x.id === job.postKey);
      if (!target) return;
      const authorKey = job.meta.authorKey ?? 'npc:wang';
      const author = resolveAuthor(authorKey);
      const userName = resolveAuthor('user').name;

      // ---- 组装 LLM 上下文（感觉帖子内容 + 用户评论内容 + 最近对话链） ----
      let postContent = '';
      let history: { from: 'user' | 'peer'; text: string }[] = [];
      let groupId = target.id; // AI 回复挂载的分组锚点
      let replyName = resolveAuthor(target.authorKey).name;
      let parentContent = target.content; // 被回复的内容（默认=目标帖本身）

      if (job.kind === 'aiReplyBack') {
        // 用户在评论区回复了 AI：AI 回应用户的评论
        const mainId = job.meta.mainPostId ?? job.meta.rootId ?? target.id;
        const mainPost = d.posts.find((p) => p.id === mainId);
        postContent = mainPost?.content ?? '';
        groupId = job.meta.rootId ?? target.id;
        // 被回复对象 = 用户刚发的回复（AI 回应「我评论的内容」）
        const userReply = job.meta.userReplyId ? d.posts.find((p) => p.id === job.meta.userReplyId) : null;
        parentContent = userReply?.content ?? target.content;
        replyName = userName;
        // 最近对话链：分组锚点下「该 AI ↔ 用户」的最近几轮（多轮来回的上下文；
        // 排除用户刚发的这条——它已作为 parent 单独传，避免重复）
        history = d.posts
          .filter((p) => p.replyTo === groupId && (p.authorKey === authorKey || p.authorKey === 'user') && p.id !== job.meta.userReplyId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-6)
          .map((p) => ({ from: p.authorKey === 'user' ? ('user' as const) : ('peer' as const), text: p.content }));
      } else {
        // NPC 回复用户的新帖
        postContent = target.content;
        parentContent = target.content;
        groupId = target.id;
        replyName = userName;
      }

      // 识图模型：帖子带图时先「看图」再回复
      const mainForMedia = d.posts.find((p) => p.id === (job.kind === 'aiReplyBack' ? (job.meta.mainPostId ?? job.meta.rootId ?? target.id) : target.id));
      const mediaDesc = await describePostMedia(mainForMedia?.media ?? target.media);

      let text = '';
      try {
        const r = (await callApi({
          kind: 'reply',
          author: { name: author.name, persona: author.persona || '', lang: author.lang ?? 'zh-Hans' },
          parent: { authorName: replyName, content: parentContent },
          postContent,
          mediaDesc,
          history,
          userName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? stripReplyPrefixClient(r.text) : '';
      } catch {
        text = '';
      }
      if (!text) {
        const npc = NPC_DEFS.find((n) => `npc:${n.id}` === authorKey);
        const lang = author.lang ?? 'zh-Hans';
        // v7：兜底也要看帖作答——求推荐帖 → 推荐/同求/避雷池；主题帖 → 主题池；
        // 池子尽/外语 → 原通用兜底（不再一律万金油「蹲一个后续」）
        const used = new Set<string>();
        const smart =
          lang === 'zh-Hans'
            ? pickTopicComment(`${parentContent} ${postContent}`, 'zh-Hans', used, target.community)
            : pickGenericComment(lang, used);
        if (smart) {
          text = smart;
        } else {
          const pool = npc
            ? npc.replies
            : lang !== 'zh-Hans'
              ? ['哈哈哈哈']
              : ['有意思，蹲一个后续。', '这条我认可。', '顶上去让更多人看到。', '哈哈你这么一说我竟无法反驳。', '有道理，学到了。'];
          text = pool[Math.floor(Math.random() * pool.length)];
        }
      }
      const next = { ...forumData() };
      // AI 回复的热度按被回复父帖缩放（评论赞 << 主帖赞；用户的新帖 0 赞 → 回复也几乎 0 赞）
      const replyPost = basePost(
        authorKey,
        text.slice(0, REPLY_MAX),
        target.community,
        Date.now(),
        groupId,
        replyName,
        true,
        { likes: likesOf(target), views: target.views },
      );
      // 精确被回复对象 = 用户的回复（多轮接话定位）
      if (job.kind === 'aiReplyBack' && job.meta.userReplyId) replyPost.replyToPost = job.meta.userReplyId;
      next.posts.push(replyPost);
      next.notifications = [
        {
          id: uid('n'),
          type: 'reply',
          fromKey: authorKey,
          postId: replyPost.id,
          createdAt: replyPost.createdAt,
          read: false,
        },
        ...next.notifications,
      ];
      saveForum(next);
      return;
    }
    if (job.kind === 'dmReply') {
      const peerKey = job.postKey as AuthorKey;
      const d = forumData();
      const dm = d.dms.find((x) => x.peerKey === peerKey);
      if (!dm) return;
      const peer = resolveAuthor(peerKey);
      const history = dm.messages.slice(-8).map((m) => ({ from: m.from === 'user' ? ('user' as const) : ('peer' as const), text: m.text }));
      let text = '';
      try {
        const r = (await callApi({
          kind: 'dm',
          author: { name: peer.name, persona: peer.persona || '' },
          history,
          userName: resolveAuthor('user').name,
        })) as { text?: string };
        text = typeof r.text === 'string' ? stripReplyPrefixClient(r.text) : '';
      } catch {
        text = '';
      }
      if (!text) text = ['刚看到私信，在呢在呢', '哈哈你说得对', '嗯嗯，我也是这么想的', '等我想想再回你'][Math.floor(Math.random() * 4)];
      const next = { ...forumData() };
      const target = next.dms.find((x) => x.peerKey === peerKey);
      if (!target) return;
      target.messages.push({ id: uid('m'), from: peerKey, text: text.slice(0, 160), at: Date.now() });
      saveForum(next);
      return;
    }
  } catch {
    /* 单任务失败静默 */
  }
}

// ---------------- 启动入口（App 挂载/重置后调用；幂等可重入） ----------------

let booting = false;

/** 版块同步：COMMUNITY_DEFS 新增的主题版块（娱乐八卦/影视片单/汽车俱乐部/吐槽大会）
 *  补进老数据（不动已加入状态）——存量用户不清数据也能看到新板块。 */
function syncCommunities(): void {
  try {
    const d = forumData();
    const missing = COMMUNITY_DEFS.filter((c) => !d.communities.some((x) => x.id === c.id));
    if (!missing.length) return;
    d.communities = [...d.communities, ...missing.map((c) => ({ ...c, joined: false }))];
    saveForum({ ...d });
  } catch {
    /* 静默 */
  }
}

/** v7 存量数据修复（幂等，boot 时执行）：
 *  1. AI 生成的评论/楼中楼正文曾带「@某人 」「回复 @某人：」前缀（旧 prompt 要求 LLM 自己写，
 *     批量错位时会@到从没出现过的人）——一律剥掉，改由前端按真实 parentId 动态渲染前缀；
 *  2. replyToName 存的是生成时的快照名，NPC 后来被 LLM 改名后就变成「幽灵名字」
 *     （如占位名 plmm在线冲浪）——统一回填为父帖作者的当前昵称。
 *  用户手写的帖子/回复（authorKey=user）不动——@谁是 TA 自己的自由。 */
function migrateV7ReplyData(): void {
  try {
    const d = forumData();
    let changed = false;
    const byId = new Map(d.posts.map((p) => [p.id, p]));
    for (const p of d.posts) {
      if (p.authorKey === 'user') continue;
      // ① 剥正文前缀
      const cleaned = stripReplyPrefixClient(p.content);
      if (cleaned !== p.content && cleaned.length >= 1) {
        p.content = cleaned;
        changed = true;
      }
      // ② replyToName 回填为父帖作者当前名
      if (p.replyTo !== null || p.replyToPost) {
        const parent = byId.get(p.replyToPost ?? p.replyTo ?? '');
        const want = parent ? resolveAuthor(parent.authorKey).name : null;
        if (want && p.replyToName !== want) {
          p.replyToName = want;
          changed = true;
        }
      }
    }
    if (changed) saveForum({ ...d });
  } catch {
    /* 迁移失败静默（不影响正常使用） */
  }
}

export async function bootForum(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    // 仅首次播种（打开 App 不再自动补帖——用户要求：生成完后不自动生成，
    // 只在用户下拉/上拉松开、点「更多评论」时才生成）
    await ensureSeed();
    syncCommunities();
    // v7：存量评论数据修复（@前缀清洗 + 回复对象名回填）
    migrateV7ReplyData();
    // v5 兜底迁移：限流期播种/中间版本数据没挂上内置 NPC 覆盖名的，现在补上
    //（幂等：已有覆盖名/LLM 名的跳过；保证任何情况下都不露出内置描述型网名）
    if (seedBuiltinNpcFallbackNames()) saveForum({ ...forumData() });
    // 起名回填：限流期没换上 LLM 名的网友趁机补齐（静默）
    void renameDynNpcsViaLlm([]);
    runPending();
  } catch {
    /* 引擎失败不拦 UI */
  } finally {
    booting = false;
  }
}
