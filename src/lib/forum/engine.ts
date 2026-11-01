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
import { commentAnchored, dominantDomainId, domainScores, topicAnchorOf } from './topic';

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

/** 评论/楼中楼互动量（v9 用户【评论区数据逻辑】强校验）：
 *  1. 浏览量必须远小于帖子浏览量——父帖浏览的 0.5%~8%，硬上限几万~几十万
 *     （3w~45w 随机），绝不能出现几百万；
 *  2. 点赞从浏览量推导（浏览的 0.5%~12%——真实平台评论赞永远远小于评论浏览，
 *     绝不会出现「赞比浏览还多」），且硬上限楼主点赞数的 60%（绝不超楼主）；
 *  3. 转发数通常为个位数（0~9，占 85%）或十几个（10~19，占 13%）；
 *     只有约 2% 极具争议的引战评论可以到几百（100~599）。 */
function rollCommentEngagement(parentLikes: number, parentViews: number): { likeBoost: number; views: number; reposts: number } {
  // 浏览：父帖的 0.5%~8%，硬上限 3w~45w（几万~几十万档，绝无几百万）
  const cap = 30_000 + Math.floor(Math.random() * 420_000);
  const views = Math.max(3, Math.min(Math.floor(parentViews * (0.005 + Math.random() * 0.075)), cap));
  // 点赞：浏览量的 0.5%~12%（远小于浏览），且硬上限楼主点赞的 60%
  const likeBoost = Math.min(
    Math.floor(views * (0.005 + Math.random() * 0.115)),
    Math.floor(parentLikes * 0.6),
  );
  // 转发：个位数为主 / 十几个次之 / ~2% 引战热评几百
  const fr = Math.random();
  const reposts =
    fr < 0.55
      ? Math.floor(Math.random() * 6) // 0~5
      : fr < 0.85
        ? 5 + Math.floor(Math.random() * 5) // 5~9
        : fr < 0.98
          ? 10 + Math.floor(Math.random() * 10) // 10~19
          : 100 + Math.floor(Math.random() * 500); // 引战争议评论 100~599
  return { likeBoost, views, reposts };
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
  // v9 硬钳制：评论的总点赞（NPC点赞 + 合成热度）绝对不超过楼主帖子的点赞数
  if (replyTo !== undefined && parentEng) {
    const cap = Math.max(0, parentEng.likes - likes.length);
    if (likes.length + eng.likeBoost > parentEng.likes) eng.likeBoost = Math.min(eng.likeBoost, cap);
  }
  // v11 自洽：评论浏览量绝不低于总点赞数（点赞的人必然看过——极小浏览的
  // 评论配上 NPC 有机赞数组会出现「4赞3浏览」，浏览抬到点赞数封底）
  if (replyTo !== undefined) {
    const totalLikes = likes.length + eng.likeBoost;
    if (eng.views < totalLikes) eng.views = totalLikes;
  }
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
    star: 'gossip', // v13 明星本尊：营业帖归娱乐八卦
    wave: 'night', // v13 海王：暧昧实录归深夜树洞
    greentea: 'hot', // v13 绿茶：引战帖归今日热议（最大曝光，评论区吵起来才真实）
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
 *  池子主题匹配（评论对得上帖子内容）+ 少量楼中楼；时间在（发帖, 现在）内升序。
 *  v9：评论语言跟随帖子（中文帖全中文，外语网友最多带 1-3 个母语字符点缀）。 */
function seedCommentsFor(post: ForumPost, out: ForumPost[]): void {
  const postAuthor = resolveAuthor(post.authorKey);
  const postLang = detectPostLang(post.content, postAuthor.lang);
  const count = 7 + Math.floor(Math.random() * 9); // 7~15 条（用户要求：评论一批 7~15）
  const keys = pickCommenters(count, postLang, post.content, post.authorKey);
  const usedCt = new Set<string>();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const commenterLang = resolveAuthor(keys[i]).lang ?? 'zh-Hans';
    // v9：中文帖 → 人人中文（外语网友偶尔加母语口癖点缀）；外语帖 → 跟帖子语言
    const lang = commentLangFor(postLang, commenterLang);
    // v14.2：口癖只加在池子评论上（加在兜底上会破坏去重键→重复刷屏）；
    // 兜底模板/变体全部用尽 → 跳过这条（宁可少一条也不重复）
    const pooled = pickTopicComment(post.content, lang, usedCt) ?? pickGenericComment(lang, usedCt, post.content);
    let base: string | null = pooled;
    if (base && lang === 'zh-Hans' && postLang === 'zh-Hans') {
      base = maybeForeignFlavor(base, commenterLang);
      usedCt.add(base.slice(0, 16));
    }
    if (!base) base = followupComment(post.content, usedCt);
    if (base) texts.push(base);
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
  // v8 修复：去重集继承顶层评论已用文案——同一帖里两个人发一模一样的话太假
  const usedSub = new Set(usedCt);
  for (const c of subs) {
    const byAuthor = post.authorKey !== 'user' && Math.random() < 0.35 ? post.authorKey : pickCommenters(1, postLang, post.content, post.authorKey, ...keys)[0];
    const subCommenterLang = resolveAuthor(byAuthor).lang ?? 'zh-Hans';
    const subLang = commentLangFor(postLang, subCommenterLang);
    // v14.2：口癖只加在池子评论上（加在兜底上会破坏去重键）；兜底用尽 → 跳过这条楼中楼
    const pooled = pickTopicComment(`${c.content} ${post.content}`, subLang, usedSub) ?? pickGenericComment(subLang, usedSub, `${c.content} ${post.content}`);
    let text: string | null = pooled;
    if (text && subLang === 'zh-Hans' && postLang === 'zh-Hans') {
      text = maybeForeignFlavor(text, subCommenterLang);
      usedSub.add(text.slice(0, 16));
    }
    if (!text) text = followupComment(post.content, usedSub);
    if (!text) continue;
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
  // v13 新增：海王/绿茶池可改派给动态网友（匿名发帖也成立）；star 是 pinned 不走这里
  wave: ['yemao', 'gaoxiao'], greentea: ['ningmeng', 'baoma'],
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
        // 内置 NPC 只占 15%（v4：网名与内容都靠 LLM，内置池子仅作保底）；
        // v13：pinned 本尊账号（明星本尊）的池子帖不改派——
        // 打工人小号发明星营业帖会穿帮（海王/绿茶帖可匿名改派，更真实）
        const domainArch = NPC_DOMAIN_ARCH[npc.id] ?? [];
        const author: AuthorKey =
          !npc.pinned && Math.random() < 0.85
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
    // v9：版本升级重播种时用户帖的旧评论已被清掉——给用户自己的帖子也补一批
    // 干净评论（新强校验逻辑：贴题+语言跟随+数据合理），帖子不至于零回复
    const userPosts = d.posts.filter((p) => p.authorKey === 'user').slice(-6);
    for (const up of userPosts) {
      if (allNew.some((p) => p.replyTo === up.id)) continue;
      seedCommentsFor(up, allNew);
    }
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

/** v14 通用池彻底重做：中文万能附和（「太真实了」「同感同感」「说得太对」）
 *  全部删除——中文评论一律走主题池（强锚定）→ 追问式兜底（带话题词），
 *  绝不再出现水军式空评。这里只留外语池（外语帖子评论区用，外语网友
 *  母语口吻；纯附和型外语废话同样已清掉）。 */
const GENERIC_COMMENTS: { text: string; lang: string }[] = [
  // 繁体中文（港台网友）
  { text: '蹲後續，別斷更', lang: 'zh-Hant' },
  { text: '這瓜也太大了，先吃為敬', lang: 'zh-Hant' },
  { text: '編劇出來面對！', lang: 'zh-Hant' },
  { text: '這部我也在看，超上頭', lang: 'zh-Hant' },
  { text: '台北路過，推一個', lang: 'zh-Hant' },
  { text: '真的假的啦，長知識了', lang: 'zh-Hant' },
  { text: '這結局我不能接受，重寫', lang: 'zh-Hant' },
  { text: '先別站隊，讓子彈飛一會兒', lang: 'zh-Hant' },
  // 英语
  { text: 'nah this is wild', lang: 'en' },
  { text: 'wait is this actually happening??', lang: 'en' },
  { text: 'he is SO much more handsome in person, trust me', lang: 'en' },
  { text: 'the drama never ends here lol', lang: 'en' },
  { text: 'saving this thread for later', lang: 'en' },
  { text: 'drop the location, need to see this myself', lang: 'en' },
  { text: 'ok but WHO was it, do not leave us hanging', lang: 'en' },
  // 日语
  { text: 'え、まじで？', lang: 'ja' },
  { text: 'この続きが気になる', lang: 'ja' },
  { text: '実際に会った人いるんだ、羨ましい', lang: 'ja' },
  { text: '情報ありがとう、保存しました', lang: 'ja' },
  { text: 'そこ一番好きな場面なんだが', lang: 'ja' },
  // 韩语
  { text: '실화냐', lang: 'ko' },
  { text: '정보 감사합니다', lang: 'ko' },
  { text: '후속 기다립니다', lang: 'ko' },
  { text: '직접 본 사람도 있다니 부럽다', lang: 'ko' },
];

/** 追问式兜底（终极兜底，v14）：围绕帖子的事件要后续/要细节/要图，
 *  话题词由 topicAnchorOf 从原帖提取填充 → 天然锚定核心话题，
 *  是「追问」不是「附和」——楼主聊什么就追着什么问，绝不串台。
 *  模板耗尽时用变体后缀，全部用尽返回空串（调用方跳过，绝不重复刷屏）。 */
const FOLLOWUP_COMMENT_TEMPLATES: string[] = [
  '{t}这事蹲一个后续，别断更啊',
  '{t}？？真的假的，细说',
  '就{t}这事，我能聊十块钱的',
  '{t}后面怎么样了，楼主别睡',
  '无图无真相，{t}求个截图',
  '{t}……先收藏，回头来考古',
  '不是，{t}就这？后续呢',
  '{t}这事我关注了，等一个下文',
  '{t}什么时候的事？我怎么现在才刷到',
  '楼主把{t}的完整时间线捋一捋，我拿小板凳等着',
  '{t}有后续记得@我，我先关注了',
  '蹲{t}的下文，今晚不睡等更新',
  '{t}这事我得转发给我姐妹一起蹲',
  '楼主更新{t}的时候麻烦开个追更',
];

/** 模板耗尽后的变体后缀（保证同帖绝不出现一模一样的兜底评论） */
const FOLLOWUP_SUFFIXES: string[] = ['，蹲蹲蹲', '，坐等下文', '，在线蹲', '，瓜子已备好', '，小板凳已就位', '，别让楼主跑了'];

/** 渲染一条追问式兜底评论（{t} = 原帖话题锚点；本帖内去重；
 *  模板+变体全部用尽 → 返回空串，调用方跳过这条） */
function followupComment(postContent: string, used: Set<string>): string {
  const t = topicAnchorOf(postContent);
  for (let i = 0; i < 40; i++) {
    const tpl = FOLLOWUP_COMMENT_TEMPLATES[Math.floor(Math.random() * FOLLOWUP_COMMENT_TEMPLATES.length)];
    const cand = tpl.replaceAll('{t}', t);
    if (!used.has(cand.slice(0, 16))) {
      used.add(cand.slice(0, 16));
      return cand;
    }
  }
  for (const suf of FOLLOWUP_SUFFIXES) {
    const cand = `${t}这事蹲一个后续${suf}`;
    if (!used.has(cand.slice(0, 16))) {
      used.add(cand.slice(0, 16));
      return cand;
    }
  }
  return ''; // 全部用尽：宁可少一条，也绝不重复刷屏
}

/** 按评论者语言从外语池抽取（v14：中文万能池已整池删除——中文评论一律
 *  走主题池（强锚定）→ 追问式兜底；外语评论只服务外语帖子，
 *  候选同样要过 commentAnchored 废话黑名单）。 */
function pickGenericComment(lang: string, usedCt: Set<string>, postContent = ''): string | null {
  if (lang === 'zh-Hans') return null; // 中文池已删除：中文走主题池 + 追问兜底
  const pool = GENERIC_COMMENTS.filter((c) => c.lang === lang);
  if (!pool.length) return null;
  for (let i = 0; i < 40; i++) {
    const cand = pool[Math.floor(Math.random() * pool.length)]?.text;
    if (!cand || usedCt.has(cand.slice(0, 16))) continue;
    if (postContent && !commentAnchored(cand, postContent)) continue;
    usedCt.add(cand.slice(0, 16));
    return cand;
  }
  return null;
}

/** 生成主题池（用户指定内容方向：八卦/明星/吐槽/车/影视/娱乐/吃瓜）——
 *  LLM 按主题方向生成；兜底组合池同主题，保证无 LLM 也是对味内容 */
export const FEED_TOPICS = ['明星八卦', '吃瓜现场', '影视综艺', '汽车圈', '娱乐热点', '今日吐槽'];

// ---------------- 主题匹配评论池（v14 领域计分制重写） ----------------

/** 主题评论池：与 topic.ts 的 15 个话题领域一一对应。
 *  出场资格 = 帖子在该领域的得分（强词×2＋弱词×1）≥ 3（v14 串台修复：
 *  旧版按版块硬塞评论池——吐槽版块的追剧帖被强插「老板画饼」类打工评论、
 *  单个泛词（累/班/屏幕）误触打工池/数码池，全部废除，只认帖子内容本身；
 *  单个强词的顺带提及【追剧帖里一句「工资不多」】也不放行）；
 *  权重 = 得分²。所有候选渲染后还要过 commentAnchored 锚定校验
 *  （呼应核心话题词 + AI 废话黑名单），不达标一律重抽。
 *  {t} = 帖子话题锚点（话题标签 → 领域话题词），渲染时替换。 */
interface TopicPool {
  /** topic.ts 领域 id（词表/计分/呼应词共享） */
  domain: string;
  /** 领域兜底话题词（帖子无话题标签时 {t} 用它） */
  subject: string;
  comments: string[];
}

const TOPIC_COMMENT_POOLS: TopicPool[] = [
  {
    domain: 'drama',
    subject: '这剧',
    comments: [
      '{t}我也在追！！第八集直接封神，编剧是懂怎么拿捏我的',
      '预警：后面开始注水了，回忆杀能占半集，我提前弃了',
      '编剧出来挨打！！{t}这结局我意难平到现在',
      '课代表总结：{t}前三集平，第四集起飞，中间注水两集，结局烂尾',
      '为了{t}开了三个会员，平台是懂绑架的',
      '别看解说版！{t}必须亲自看，两分钟解说会毁掉两小时',
      '安利给所有还没看的人，撑过前三集你会回来谢我的',
      '导演的运镜真的绝，{t}那段长镜头我倒回去看了五遍',
      '女主演技被粉丝吹过头了吧，尴尬到脚趾抠地',
      '男主第14集那个眼神，我直接暂停回味了半分钟',
      '求别烂尾求别烂尾，{t}现在每更新一集我都当最后一集看',
      '熬到凌晨三点刷完更新，第二天顶着黑眼圈去公司，值',
      '{t}我二倍速看的，注水部分直接拖进度条，不影响主线',
      '弹幕全是「啊啊啊」，我的观后感：吵，但是对',
      '{t}更到几集了？我怎么记得上次更新还是上周',
      '会员到期前一小时速刷大结局的就是我，顺便取消了自动续费',
      '这编剧的套路我熟：前紧后松，中期注水，结局匆忙',
      '男主的睫毛！！特写那一帧我暂停截图当壁纸了',
    ],
  },
  {
    domain: 'gossip',
    subject: '这瓜',
    comments: [
      '救命这瓜也太大了吧？？？我吃到现在都没吃明白，有没有课代表总结一下',
      '课代表来了：起因是{t}被扒，中间反转了两次，现在双方都装死，蹲后续',
      '让子弹再飞一会儿，上次那个瓜最后不也是乌龙',
      '我朋友就在现场，她说根本不是传的那样，等我详细问问',
      '{t}我早就有预感了，懂的都懂，不敢多说',
      '就这也能上热搜？现在的热搜是越来越水了',
      '先别站队，上次提前站队的都被打脸了，让子弹飞',
      '蹲一个后续，我瓜子都买好了',
      '家人们谁懂啊，半夜刷到{t}直接睡不着了',
      '代拍拍的糊图也能锤？我先存疑，等高清再站队',
      '声明文案都是同一个公关写的吧，句式我都能背了',
      '我宣布，这是我今年吃过最绕的一个瓜，没有之一',
      '前排出售瓜子花生矿泉水，蹲一个后续',
      '瓜田里上蹿下跳一天，我的意见是：都别急，等实锤',
    ],
  },
  {
    domain: 'star',
    subject: '追星',
    comments: [
      '天哪这也太好磕了，{t}我先磕为敬',
      '姐妹你是我的互联网嘴替！！一句没多一句没少',
      '理智追星，不代拍不私生，{t}看看就好别上头',
      '我也在现场！！{t}那段我现在想起来还是想哭',
      '代拍真的该管管了，{t}都被拍成什么样了',
      '啊啊啊啊啊同担！！终于刷到组织了',
      '白嫖它不香吗，{t}氪金要量力而行啊家人们',
      '蹲一个演唱会门票转让，蹲蹲蹲',
      '他站到光里的同时你也要把自己的日子过亮呀，理智追星',
      '小卡吧唧一圈下来五百块，我钱包已经在哭了',
      '直拍我循环了二十遍，这个走位是练了多久啊',
      '抢票抢了六次，次次陪跑，黄牛加价三倍真有脸',
      '周边秒没，官方店铺是拿服务器开玩笑吧',
      '物料里他笑的那一帧我存了，当头像已经半年',
    ],
  },
  {
    domain: 'work',
    subject: '打工',
    comments: [
      '{t}世另我，今天也是不想上班的一天',
      '老板画的饼真香，我血压也真高',
      '课代表：{t}的本质是能拖就拖，建议保留证据，骑驴找马',
      '带薪如厕大师就是我，摸鱼才是打工人的本体',
      '已老实，{t}之后我连辞职口号都不敢喊了',
      '辞职口号月更选手路过，咱们俩组个队吧',
      '跑吧，{t}这种环境待久了人会废掉的',
      '工位摸鱼冠军在此，楼主悄悄的，别让老板刷到',
      '笑死，班味洗不掉的，周末泡澡都没用',
      '试用期第23天，我已经在数离职倒计时了',
      '{t}同款经历+1，周报写了个寂寞',
      '同款周报受害者，我现在把周报存成模板每周改三个词',
      '面试时说的和入职后干的完全是两回事',
      '开会两小时，结论零条，散会前说下次再议',
    ],
  },
  {
    domain: 'car',
    subject: '这车',
    comments: [
      '别买{t}，买了就后悔，修车排队排到怀疑人生',
      '车主路过，{t}确实是这样，油耗高得离谱',
      '课代表：{t}优点是动力，缺点是价格和油耗，自己权衡',
      '键盘车神又开始了，{t}你们真开过吗就搁这评',
      '早高峰被加塞三次+1，血压和油门一起踩到底',
      '攒钱提车中，看完{t}更焦虑了，钱包和快乐总得选一个',
      '这油耗正常吧，市区通勤谁开都这样，别吓唬楼主',
      '老司机说得对，刹得住比跑得快重要',
      '{t}我试驾过，推背感是真的，价格也是真的硬',
      '刚拿本别买手动挡，相信我，堵车的时候你会哭的',
      '保养别去4S当冤种，找靠谱的修理厂能省一半',
      '新手司机路过，看到楼主这操作我先怕了',
      '自动启停这功能谁发明的，等红灯一顿一顿的',
      '保险别乱买，我第一年多花了小两千冤枉钱',
      '油价又涨了，加油的时候我的心在滴血',
    ],
  },
  {
    domain: 'digital',
    subject: '这机子',
    comments: [
      '等等党永不为奴，{t}再战三年',
      '跑分不代表体验，{t}实测才是真的',
      '{t}买新不买旧，一步到位，别问，问就是过来人',
      '装机预算超了+1，{t}一看价格我沉默了',
      '显卡终于到了，恭喜脱贫',
      '{t}散热怎么样，我看评测说烫手',
      '课代表：{t}首发别冲，等两个月降价+固件稳定',
      '首发冲了，一个月亏三百，我是大冤种',
      '碎屏险值得买，我上个月刚用上，血赚',
      '系统更新别急着升，等一个月看看反馈',
      '存储永远不够用，当初选最小容量是我的错',
      '同款设备用了两年，除了电池其他都还行',
    ],
  },
  {
    domain: 'game',
    subject: '这游戏',
    comments: [
      '{t}这赛季匹配机制有毒吧，连跪五把给我排俩挂机',
      '组我组我，{t}我也在肝，今晚通宵',
      '策划出来挨打，{t}这波削弱没人同意',
      '零氪党路过，{t}白嫖玩得也挺开心',
      '外挂再不管管{t}就凉了，昨晚把把神仙',
      '菜就多练，{t}这操作我上我也行——行不了，我更菜',
      '{t}新赛季上分攻略出了吗，蹲一个',
      '这匹配机制我服了，赢一把安排三把猪队友',
      '版本答案又变了，我刚练熟的上个版本英雄',
      '今晚八点车队缺一个，评论区摇人',
    ],
  },
  {
    domain: 'food',
    subject: '这家店',
    comments: [
      '看饿了，{t}求地址，已经准备好出发了',
      '{t}避雷+1，我也踩过这个坑，难吃到怀疑人生',
      '深夜放毒是吧，举报了（咽口水）',
      '课代表总结：{t}值得冲的是招牌，别的别点',
      '奶茶三分甜选手路过，{t}这个搭配我认可',
      '救命，半夜刷到{t}是对减肥人士的谋杀',
      '碳水快乐星人狂喜，{t}看着就香',
      '{t}排队要多久？我怕站到腿软',
      '这家我吃过！招牌确实可以，别的真的别点',
      '深夜刷到吃的，我的胃在抗议',
      '外卖红包群了解一下，一个月省出好几顿早饭',
    ],
  },
  {
    domain: 'pet',
    subject: '毛孩子',
    comments: [
      '{t}快发照片！不看照片等于没说',
      '拆家现场我也经历过，沙发已经阵亡了',
      '铲屎官含泪点赞，懂的都懂',
      '猫毛过敏但养猫+1，戒不掉的根本戒不掉',
      '{t}建议直接发视频，让我们云吸一下',
      '我家那位主子也是，犯错的时候一脸无辜，气死又好笑',
      '疫苗本收藏家路过，宠物医院VIP就是我',
      '{t}吐了多久了？一天超过两次赶紧去医院，别拖',
      '养猫第三年，猫毛已经织进我的每一件衣服',
      '别问我家里为什么到处是猫抓板，问就是沙发保命',
      '我家那位凌晨四点准时跑酷，我的黑眼圈它功不可没',
      '驱虫药别忘了定时喂，别问我怎么知道的',
    ],
  },
  {
    domain: 'night',
    subject: '深夜',
    comments: [
      '凌晨三点刷到这个，突然就不那么孤独了',
      '抱抱，这个阶段都会过去的',
      '月亮不睡我不睡+1，咱们组个失眠互助群吧',
      '褪黑素依赖中，看得我更清醒了',
      '深夜的情绪别当真，睡一觉明天再看会不一样',
      '睡不着数羊数到一万的选手路过，同病相怜',
      '别刷手机了，越刷越精神，说的是你也是我',
      '失眠第4天，眼下的青黑已经可以出门不画卧蚕了',
      '闭眼两小时，大脑开了场演唱会',
      '数了三百只羊，羊都睡了我还醒着',
      '凌晨四点的天花板我已经看了快一个月',
      '白天的困是真的，晚上的清醒也是真的，离谱',
    ],
  },
  {
    domain: 'love',
    subject: '这段感情',
    comments: [
      '暧昧期最折磨，他一句话我能反刍一晚上',
      '冲！不说出口的喜欢都是遗憾',
      '异地恋第400天，见面那刻觉得一切都值',
      '清醒一点，对你忽冷忽热的对象就算了吧',
      '心动是真的，心疼自己也是真的',
      '{t}到什么阶段了？评论区帮你分析分析',
      '暧昧期别急着表白，再观察观察，急着摊牌的容易输',
      '暗恋十年还是异地，你俩这是双向奔赴还是单机模式',
      '前任这关，谁过谁知道',
      '心动过的人，再遇见还是会乱',
      '喜欢过的人的余光，确实比正文长',
      '暧昧最狠的就是这种欲言又止',
    ],
  },
  {
    domain: 'fitness',
    subject: '训练',
    comments: [
      '{t}第38天打卡，体重没变但裤腰松了两格',
      '三分练七分吃，鸡胸肉吃到怀疑人生',
      '拉伸别偷懒，我上周就是没拉伸，现在走路像机器人',
      '私教课真贵，一节课够我办两年视频会员',
      '体脂秤的数字别太当真，围度和镜子不会骗人',
      '{t}练后那顿饭才是我坚持的全部理由',
      '新手别上大重量，动作变形练了等于白练还伤腰',
      '别问体重，问就是肌肉密度大',
      '练完第二天下楼梯的姿势，懂的都懂',
      '蛋白粉喝出中药味，我的味蕾已经投降',
    ],
  },
  {
    domain: 'study',
    subject: '学习',
    comments: [
      '图书馆占座大军申请出战，七点不到门口排队',
      '错题本比刷新题有用，血泪教训',
      '{t}第200天，政治还没背完，我先疯为敬',
      '同考研，昨晚三点睡的，互相伤害',
      '上岸的过来人说一句：真题刷三遍不过分',
      '背了忘忘了背，我的海马体已经在抗议了',
      '{t}进度到哪了？我这个月才过完一轮，慌',
      '占座失败，转战走廊，膝盖当桌子',
      '背书背到怀疑自己的记忆是漏斗',
      '图书馆的闭馆音乐是我每天的下班铃',
    ],
  },
  {
    domain: 'travel',
    subject: '这趟',
    comments: [
      '特种兵行程看着就累，我更推荐躺平游',
      '人从众警告，假期出门先做好排队三小时准备',
      '民宿照片仅供参考系列，实际开窗是停车场',
      '出片攻略收了，下次照抄',
      '古镇都长一个样，卖的东西全国统一',
      '{t}预算多少？我也在规划这条线',
      '错峰旅行才是王道，工作日请两天假人少一半',
      '这个季节去人少，性价比拉满',
      '高铁晚点两小时，我的行程全乱套',
      '酒店早餐七点结束，我七点半醒的，完美错过',
    ],
  },
  {
    domain: 'weather',
    subject: '今天',
    comments: [
      '今天出门被风吹成表情包，发型已阵亡',
      '降温提醒：秋裤该请出来了，别硬扛',
      '这种天气就该窝在家里，谁劝我出门我跟谁急',
      '桂花开了？难怪这两天一路走一路闻',
      '回南天墙都在流泪，晾了一周的衣服长蘑菇了',
      '{t}这种天气，适合窝被窝里刷剧，谁都别拦我',
      '天气预报说晴，出门就下雨，我再也不信它了',
      '这种风，出门五分钟发型全毁',
      '降温别硬扛，秋裤是人类之光',
      '一到换季就感冒，我的嗓子已经预警',
      '今天的风是免费的吹风机，还是强力档',
    ],
  },
];

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

/** 评论正文清洗（v9 乱码修复，与服务端 sanitizeCommentText 同口径）：
 *  零宽/控制字符/替换符、拼接符连串、markdown 记号、emoji 全部清除。 */
function sanitizeCommentClient(raw: string): string {
  let t = raw;
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFFFD/g, '');
  t = t.replace(/[~～|｜·•※]{2,}/g, ' ');
  t = t.replace(/```+/g, '').replace(/[*_`#>]{1,3}(?=\s|$)/g, '');
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/gu, '');
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

/** 判断帖子内容是否以中文为主体（v9 语言铁律：评论语言跟随帖子）。
 *  内容脚本占比判断 + 作者语言兜底（内容太短/无脚本字符时信作者）。 */
export function detectPostLang(content: string, authorLang?: string): string {
  let zh = 0;
  let foreign = 0;
  for (const ch of content) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x4e00 && c <= 0x9fff) zh += 1;
    else if (
      (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x3040 && c <= 0x30ff) || c === 0x30fc ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f)
    ) foreign += 1;
  }
  if (zh + foreign < 4) return authorLang ?? 'zh-Hans';
  return zh >= foreign ? 'zh-Hans' : (authorLang ?? 'zh-Hans');
}

/** 评论者语言 → 实际评论文案语言（v9：中文帖人人用中文，外语网友可带 1-3 个母语字符点缀；
 *  外语帖用帖子语言或中文）。 */
function commentLangFor(postLang: string, commenterLang: string): string {
  if (postLang === 'zh-Hans') return 'zh-Hans';
  return commenterLang === postLang ? postLang : 'zh-Hans';
}

/** 外语网友在中文帖评论时的母语口癖点缀（v9 允许 1-3 个外文字符夹杂）。
 *  三成概率给中文文案补一个小尾巴，像懂中文的外国网友随手打的。 */
const FOREIGN_FLAVORS = ['www', 'ㅋㅋ', 'hhh', 'lol', '草', 'hh'];
function maybeForeignFlavor(text: string, commenterLang: string): string {
  if (commenterLang === 'zh-Hans') return text;
  if (Math.random() >= 0.3) return text;
  const f = FOREIGN_FLAVORS[Math.floor(Math.random() * FOREIGN_FLAVORS.length)];
  return /[。！？!?~～\s]$/.test(text) ? `${text}${f}` : `${text} ${f}`;
}

/** 客户端整句外语判定（与服务端 violatesCommentLang 同口径的兜底）：
 *  中文帖的评论若被外语主导（整句英/日/韩/繁）→ true，调用方丢弃换池子。 */
function foreignDominantClient(text: string): boolean {
  let zh = 0;
  let latin = 0;
  let kana = 0;
  let hangul = 0;
  let trad = 0;
  let simp = 0;
  const TRAD_SET = '們個這時過還發對說聽後來車馬門問長無書龍鳥語體點關應讓證邊沒壞愛國會間東兩單買賣辦動務名條當處帶幫廣歸開從優傷兒內準決覺觀視親計訊訪話該詳誤說課調誰謝負財貢風飛飯飲館駐騙體魚島嶼歡樂進遠違連遲適選遜鄰醫針錢鐵銀錯鍵鎮閃閉閑閱隊階際隨隱難電霧頁頂項順頗領頻題顏願香講種樣認談論請讀讚絲喪髮為麼裡幾別嗎寫實續識編劇簡體雙嚇';
  const SIMP_SET = '们这说过发对听后来车马门问长无书龙鸟语体点关应让证边没坏爱国会间东两单买卖办动务名条当处带帮广归开从优伤儿内准决觉观视亲计讯访话该详误课调谁谢负财贡风飞饭饮馆驻骗体鱼岛屿欢乐进远违连迟适选逊邻医针钱铁银错键镇闪闭闲阅队阶际随隐难电雾页顶项顺颇领频题颜愿香讲种样认谈论请读赞丝丧发为么里几别吗写实续识编剧简体双吓';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x4e00 && c <= 0x9fff) {
      zh += 1;
      if (TRAD_SET.includes(ch)) trad += 1;
      else if (SIMP_SET.includes(ch)) simp += 1;
    } else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
    else if ((c >= 0x3040 && c <= 0x30ff) || c === 0x30fc) kana += 1;
    else if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f)) hangul += c >= 0xac00 ? 1 : 0.5;
  }
  if (kana >= 4) return true;
  if (hangul >= 4) return true;
  if (latin >= 10 && latin > zh * 0.8) return true;
  if (zh === 0 && latin + kana + hangul + trad >= 5) return true;
  if (trad >= 5) return true;
  if (trad >= 3 && simp <= 1) return true; // 整句繁体（繁体独有字≥3且简体独有字几乎没有）
  return false;
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

/** 兜底评论（v14 领域计分制重写）：只认帖子内容本身——
 *  1) 外语评论者 → 外语池；
 *  2) 求推荐/求助帖 → 求推荐池（求什么答什么，绝不答非所问）；
 *  3) 领域得分（强词×2＋弱词×1）≥2 的主题池按 得分² 加权抽取，
 *     无一命中时放宽到最高分池（弱相关也比对不上强）；
 *  4) 每条候选渲染 {t} 后必须过 commentAnchored 锚定校验
 *     （呼应核心话题词 + AI 废话黑名单），不达标重抽；
 *  5) 池子耗尽 → 返回 null，调用方落「追问式兜底」（带话题锚点）。 */
function pickTopicComment(postContent: string, lang: string, used: Set<string>): string | null {
  if (lang !== 'zh-Hans') {
    const cand = pickGenericComment(lang, used, postContent);
    if (cand) return cand;
  }
  // 求推荐/求助帖优先：正面回答（推荐/同求/避雷），再考虑主题池
  const req = pickRequestComment(postContent, used);
  if (req) return req;
  // 领域计分（v14.1 门槛 3 分）：单个强词的顺带提及（追剧帖里一句「工资不多」）
  // 不再让打工池入场——得分 ≥3 的池子才有出场资格，权重 = 得分²
  const scores = new Map(domainScores(postContent).map((x) => [x.id, x.score]));
  let weighted: { pool: TopicPool; w: number }[] = TOPIC_COMMENT_POOLS.filter((p) => (scores.get(p.domain) ?? 0) >= 3).map((p) => ({
    pool: p,
    w: (scores.get(p.domain) ?? 3) ** 2,
  }));
  // 无一命中：放宽到「最早出现」主领域池（v14.2：并列得分时不再把所有并列池
  // 拉进评论区——恋爱帖顺带提一句「低头看手机」时只出恋爱池，不出数码池）
  if (!weighted.length) {
    const dom = dominantDomainId(postContent);
    if (dom) {
      const pool = TOPIC_COMMENT_POOLS.find((p) => p.domain === dom);
      if (pool) weighted = [{ pool, w: 1 }];
    }
  }
  if (!weighted.length) return null; // 调用方落追问式兜底
  const totalW = weighted.reduce((s, x) => s + x.w, 0);
  for (let i = 0; i < 80; i++) {
    let r = Math.random() * totalW;
    let picked = weighted[0].pool;
    for (const x of weighted) {
      r -= x.w;
      if (r <= 0) {
        picked = x.pool;
        break;
      }
    }
    const raw = picked.comments[Math.floor(Math.random() * picked.comments.length)];
    const cand = raw.replaceAll('{t}', topicSubjectOf(postContent, picked.subject));
    if (used.has(cand.slice(0, 16))) continue;
    // v14 锚定校验：必须呼应核心话题词 + 不在废话黑名单，不达标重抽
    if (!commentAnchored(cand, postContent)) continue;
    used.add(cand.slice(0, 16));
    return cand;
  }
  return null;
}

/** 组合式帖子兜底（v14 全面重写）：旧版「话题×开头×正文×结尾」拼出来的是
 *  新闻摘要腔——被用户点名「太人机」。新版按八大真实网友风格写整段模板：
 *  八卦爆料/暴躁吐槽/追星发疯/明星营业/搞抽象/暧昧擦边/阴暗爬行/日常分享，
 *  每条自带场景/动作/情绪/数据，槽位（{place}{code}{food}{n}）替换保证不重样，
 *  LLM 失败时兜底帖也像真人发的（篇幅与 NPC 池、八大风格 Prompt 同水位）。 */
const COMBO_SLOTS: Record<string, string[]> = {
  place: ['国贸B1的寿司店', '公司楼下的便利店', '小区门口的快递驿站', '大学城小吃街', '机场T2的咖啡店', '商场顶楼的火锅店', '老家属院的楼道', '高铁站候车厅', '凌晨两点的马路牙子', '健身房更衣室'],
  code: ['W姓顶流', 'Z老师', 'L姓小生', 'H姓影后', '那个选秀出道的', '某男团门面', '仙侠剧男主', '唱跳那个X'],
  food: ['38块的猪脚饭', '半糖去冰的奶茶', '两个烤红薯', '加辣的螺蛳粉', '便利店的关东煮', '双拼麻辣烫', '九块九的沙拉'],
  n: ['三', '五', '七', '十', '两', '半'],
};

const COMBO_POST_STYLES: string[][] = [
  // 一、八卦爆料（细节拉满，有「偷感」）
  [
    '家人们谁懂啊，我在{place}排队，斜前方卡座一个戴口罩鸭舌帽的男的，侧脸越看越不对劲——{code}！就是最近那部剧里演反派的那个！本人比屏幕上还瘦，手腕上那串珠子跟上周活动戴的是同一串。他跟对面女生全程没说话，我不敢多看，假装回消息偷瞄了二十分钟，手心的汗把手机壳都捂热了。没敢拍，门口蹲着俩代拍，一举手机就露馅 #在{place}撞见{code}#',
    '表妹在{place}打工，刚给我发了六十秒语音，全是尖叫。说{code}今天来了，全程帽子口罩，但那个身高和走路姿势错不了，点单的时候声音压得特别低，说了句谢谢就赶紧走。表妹说后厨都在传，经理进场前还专门开了个短会。细节我还在问，蹲到的先别外传 #{code}现身{place}#',
    '刚才在{place}等位，隔壁桌两个人聊天声音越来越小，我耳朵已经竖成天线了。听到几个关键词：「档期」「不方便」「别拍到我」。抬头一看，其中一个人的工作证我刷到过——{code}的妆造师！另一个人递了个牛皮纸袋，她放进包里的动作特别快。这是什么新瓜？我瓜子已经就位 #{code}深夜密会现场#',
    '停车场蹲到个大的。我取车的时候，旁边商务车车门开着，一个裹得严严实实的人在上车，那个下巴的形状我一眼认出来——{code}！重点是，从车上下来的另一个人把他的外套披走了，俩人一句话没说，车窗升上去之前还互相看了一眼。我在原地愣了半分钟，行车记录仪都没来得及开 #停车场目击{code}#',
  ],
  // 二、暴躁吐槽（极度情绪化，针对具体槽点）
  [
    '中午点了个{food}，打开盒子我人傻了：{n}块肉，最薄那块对着灯看是半透明的，米饭比肉多四倍，汤就一层油。卧槽我备注写得清清楚楚的加辣呢？？骑手都走了我找谁去。客服机器人复读「亲亲这边建议您下次备注哦」——备注了！！我备注了！！！建议这家店直接改名米饭配米饭，肉纯属装饰 #外卖避雷实录#',
    '停车场排队二十分钟，保安大哥挨个车窗问「找谁」，到我这直接抬杆了，连问都不问。我说大哥你不问问？他说：看你这样就是来找车位的。合着我这张脸就是月卡通行证呗？？最气的是绕了{n}层发现全是满的，最后停到隔壁商场又走了十五分钟回来。一个月停车费三百多，买的是个寂寞 #我的脸就是停车场通行证#',
    '客服电话打了一小时四十分，转人工按了九次「0」，每次都说「当前排队人数较多」。好不容易接通，对面第一句：「请问您的问题是什么呢？」我从头说了一遍，她说：这个问题需要帮您转接专门部门。又挂了！！从头再来！！你们的热线是莫比乌斯环吗 #转人工转人工转人工#',
    '楼下装修第八天了。电钻早上八点准时开工，比我闹钟还准。戴耳塞、戴耳机、开冰箱听嗡嗡声，都盖不住。上去沟通，师傅特别客气：快了快了，还有二十来天。二十来天？？中介当时说的是「隔壁轻微施工一周」！！押金我不退了行吗，我就想知道「轻微」的标准是谁定的 #装修第八天精神状态良好#',
    '新买的手机壳七天就黄了，客服说是我使用不当。我使用不当？？我把它供在桌上它自己黄的！评论区教我用牙膏擦、用酒精泡，全试了，黄得更均匀了。九块九的东西我生什么气，我生气的是它黄之前还挺好看 #手机壳黄了是我的错吗#',
  ],
  // 三、追星发疯（饭圈黑话，感叹号管够）
  [
    '啊啊啊啊新物料出了！！！白毛衣！！袖子挽到小臂！！副歌抬头对镜头笑了一下，就一下！！！我原地去世！！！下颌线什么神仙角度，慢放看了十四遍，我妈以为我在哭，我是真的在哭！！耳返松了全程左手按着唱完，一句没跑，这什么敬业爱豆！！15分钟百万播放不是没道理的，我先去循环500遍 #新物料杀我#',
    '刚从现场回来，手还在抖。安可的时候他走到我们这区，隔着一排人看了这边一眼——就一眼！我旁边的姐妹直接蹲下去了，我脑子一片空白，回来的路上一直在笑，司机师傅一直在看我。嗓子喊哑了，明天再说，今晚谁也别想让我睡 #安可一眼值回票价#',
    '他今天机场图出了，灰色卫衣，帽子压得很低，但是包上挂的娃娃是我们送的那个！！他挂上了！！他真的挂上了！！去年生日应援送的，我以为到了工作室就进仓库了，呜呜呜他带着它飞了三个城市了，这个娃娃过得比我好 #他挂上我们送的娃娃了#',
    '新歌第一句出来我就跪了，那个气声！！那个咬字！！耳机开最大声，鸡皮疙瘩从后颈起到脚后跟。有人质疑唱功的，麻烦听一下副歌那段升key，一遍过，现场稳得像CD。我已经把歌词背下来了，虽然整首就四十多个词 #新歌气声绝了#',
  ],
  // 四、明星日常（假装本尊，非常营业）
  [
    '今天难得六点收工，路过楼下买了杯热美式，店员小哥问我是不是上次那个「加三份浓缩」的狠人，行吧，我在陌生人心里的形象是这样。你们最近都在追什么剧？评论区安利我，收工回去下饭。对了，我那部剧这周更到关键剧情，别倍速看，会后悔。还有，说我耍大牌那条是假的，那天我在补妆，导演可以作证，他骂我笑场骂了二十分钟。配图收工自拍，风大，头发乱了，凑合看',
    '凌晨三点还没睡，不是失眠，是背台词背的。明早六点开工，现在睡等于没睡，干脆不睡。翻了翻评论区，看到有学生党说考完试来看我，好好考试！！考完随便看。问我最近为什么瘦了的，剧组盒饭是真难吃，我含泪瘦了六斤，这波算工伤。碎碎念完了，去冲个澡，早上见 #收工碎碎念#',
    '被公司逼着营业的一天。问：今天的自拍为什么是背影？答：因为正脸在赶工的剧里，先留个悬念。问：什么时候播出？答：快了，比我化妆快。问：最近有什么开心的事？答：刚发现楼下的猫会握手了，比我会营业。行了，老板说字数够了，评论区见 #被逼营业现场#',
  ],
  // 五、搞抽象/无厘头（毫无逻辑，纯发疯）
  [
    '刚才电梯里放了个屁，11楼到1楼停了{n}次，每个人都进来看了我一眼，我悟了，这就是社会性死亡倒计时。说个事，我家猫最近看我的眼神像HR看简历，随时准备把我优化掉。早上它把杯子推下桌是慢动作的，边推边看我，像我删好友前最后看一眼对方头像 #本猫疑似有编制#',
    '一个冷知识：人在等外卖的时候，时间会变慢。我刚才盯着骑手轨迹看了八分钟，他在地图上转了个圈，我以为他在跳舞，其实他在掉头。外卖到了，我的腿麻了，站起来的时候膝盖响了一声，像开瓶盖。二十八岁，身体已经进入售后阶段 #身体进入售后阶段#',
    '我怀疑我家的WiFi有情绪。我想看视频它就转圈，我一放下手机它就满格，跟故意的似的。刚才我跟它对峙了十分钟——把手机放桌上假装走开，偷偷回头看，信号满格；一把抓起来，它又转圈了。行，你赢了你赢了好不好，今晚我陪你耗着 #我家WiFi成精了#',
    '早上称体重，秤显示「Err」。我重新站上去，它还是「Err」。我妈路过说：它不是坏了，它是不想伤害你。好家伙，现在连秤都学会高情商发言了。中午我吃了两碗饭压压惊，晚上再称，它学会直接黑屏了 #体重秤的高情商时刻#',
  ],
  // 六、暧昧擦边（高端海王风，话不说透）
  [
    '昨晚酒局散得晚，他送我到楼下，说外套先披着明天还。今天来拿外套，他顺手端走我桌上那杯咖啡喝了一口，说：苦的，跟你一样。我说那你怎么不撒手。他笑了一下没接话，走的时候在门口站了两秒……就两秒。外套我洗过了，掉的那颗扣子也缝回去了。算了不说了，说多了显得我没出息……',
    '他说「顺路」送我回家，导航明明显示他家在反方向。车上放的歌单全是我上次随口说过好听的那些，一首不差。红灯的时候他手搭在挡把上，离我的手就两厘米，我盯着那个红灯看了整整九十秒。到了楼下他说「那，上去吧」，就这三个字，我在电梯里回放了半小时……',
    '健身房的教练今天纠正我动作，手虚扶在我手肘下面，没碰到，就那么一点距离。他说「沉肩」，声音比平时低了半度。我肩膀没沉下去，心跳先沉不下去了。下课他递水给我，瓶盖是拧开过的……我知道那可能是随手，但我今天多练了二十分钟，练到他下班。嗯，就当是练腿。',
  ],
  // 七、阴暗爬行（引战/三观炸裂，理直气壮）
  [
    '想跟大家商量个事。我室友保研了，但她家境不好，那个奖学金对她很重要。我差0.3分没评上，难受了很久。我在想要不要跟辅导员提一嘴她上次翘团建的事（就一次），名额顺延下来就是我的了。我不是坏心，规则就是规则，翘了就是翘了，跟我举不举报没关系呀。而且我更需要这个名额，我谈恋爱了花销大，她一个单身的人要那么多钱干嘛呢。你们说，我这不算小人吧？',
    '男朋友一个月挣两万，却只给我花三千，我要分手有问题吗？我闺蜜说她男朋友每个月工资全交，我妈说我虚荣。可是我都陪他聊天到半夜了，我的时间不要钱吗？他打游戏的时候我在旁边看着，这不算付出？昨天他点了杯三十块的奶茶还备注「少糖，她最近减肥」，无语，我减肥是为谁啊，还不是为了带出去给他长面子 #我的付出值得更多#',
    '我有个习惯，跟每个前任分手前都会把他们送的东西折现要回来。闺蜜说这样不好，可我觉得这叫止损。上一任的手表我卖了四千二，回血率百分之六十，已经很高了。这次谈的这个，第一次约会就送了本二手的书，二手的！我都开始盘算分手时怎么开口了。他要是问我为什么，我就说：书我看完了，留着也是浪费，你说对吗 #谈恋爱要懂得止损#',
  ],
  // 八、日常分享（天气/气味/感官/情绪打底）
  [
    '下班出来闻到今年第一茬桂花，甜得发闷。绕路买了糖炒栗子，老板娘多给了两颗，说看我脸色像加班的。地铁上剥了一颗，烫手，但是那种很扎实的甜。到家楼下看见一对老夫妻分一个烤红薯，老头把皮剥好了才递过去。突然想给我妈打电话，拨到一半挂了，改成发「吃了吗」，她秒回「吃了，你呢」。配图：上周在江边拍的晚霞 #秋天的第一口甜#',
    '今天下雨，没带伞，在便利店门口站了十分钟等雨小。旁边大爷把伞往我这边偏了偏，说「姑娘，顺路，走吧」。我蹭了他的伞走了两百米，一路上聊了他孙子的期末考试。到小区门口他要给我伞，我说不用，跑两步的事。跑的时候雨打在脸上，凉的，但我一直在笑。回家路上买了两把伞，放一把在包里，以后也能帮别人挡一挡 #雨天蹭伞两百米#',
    '周末大扫除，从床底下扫出来一只失踪半年的袜子，和它一起出来的还有三块钱、一张电影票根和半包受潮的薯片。袜子找到了另一半，钱进了存钱罐，票根让我想起那部看到一半睡着的电影，薯片……薯片我尝了一口，还是脆的，缘分。下午的阳光斜进来，灰尘在光里飘，我坐在地板上发了半小时呆 #床底考古现场#',
    '今天降温，把厚被子翻出来了。晒了一下午太阳的被子，晚上钻进去有一股说不出的味道，我妈管这叫「太阳味」。开了加湿器，泡了脚，水凉了三次才舍得擦。这种晚上就适合早点关灯，裹着被子听窗外呼呼的风，心想：幸好明天是周日。配图是我的被子角，猫已经踩好奶了 #太阳味的被子#',
    '早高峰的地铁上，前面一个女生的手机壳背后贴了张便利贴：「再坚持三天就放假」。我盯着看了两站地，心情莫名好了起来。到站的时候人挤人，她护着咖啡挤下车，一滴没洒，厉害。我买了这么多年咖啡，洒过三杯在键盘上。今天上班路上没那么烦了，谢谢那张便利条 #地铁上的能量便利贴#',
  ],
];

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
 *  v14：整段八大风格模板 + 槽位一致替换（同一条里 {place}/{code} 取值相同）；
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
  const flat = COMBO_POST_STYLES.flat();
  for (let i = 0; i < 80; i++) {
    const tpl = flat[Math.floor(Math.random() * flat.length)];
    // 槽位一致替换：同一个槽位名在一条模板里取同一个值
    const vals: Record<string, string> = {};
    for (const k of Object.keys(COMBO_SLOTS)) {
      const arr = COMBO_SLOTS[k];
      vals[k] = arr[Math.floor(Math.random() * arr.length)];
    }
    const s = tpl.replace(/\{(\w+)\}/g, (_m, k: string) => vals[k] ?? '').slice(0, POST_MAX);
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
): Promise<{ key: AuthorKey; text: string; textImage?: string; recent?: string[] }[]> {
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
    } else if (r < 0.32 && dynKeys.length) {
      // 已有动态网友回访（同一人出现在不同帖子评论区，真实论坛常态）。
      // v8：回访率 0.4→0.32（用户反馈：网名老用那几个——新面孔占比更高，评论区更丰富）
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
    // 主帖语言（v9：内容判定 + 作者语言兜底——中文帖的评论全部中文，外语帖才外语）
    const postLang = detectPostLang(post.content, resolveAuthor(post.authorKey).lang);
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
        post: { authorName: postAuthor.name, content: post.content, mediaDesc, lang: postLang },
        count: want,
        personas: commenterKeys.map((k) => {
          const a = resolveAuthor(k);
          return { name: a.name, persona: a.persona || '普通论坛网友', lang: a.lang ?? 'zh-Hans' };
        }),
        avoid,
        userName: resolveAuthor('user').name,
      })) as { items?: string[] };
      texts = Array.isArray(r.items)
        ? (r.items as unknown[])
            .map((x) => {
              if (typeof x !== 'string') return '';
              const s = sanitizeCommentClient(stripReplyPrefixClient(x));
              if (s.trim().length < 2) return '';
              if (postLang === 'zh-Hans' && foreignDominantClient(s)) return '';
              // v14 锚定校验：串台/AI 废话直接丢弃（与服务端双保险），池子补位
              if (!commentAnchored(s, post.content)) return '';
              return s;
            })
            .filter(Boolean)
        : [];
    } catch {
      texts = [];
    }
    if (texts.length < want) {
      // 池子兜底：按帖子内容命中的主题评论池（评论对得上帖子内容，不是万金油）
      // v9：语言跟随帖子——中文帖人人中文（外语网友带 1-3 字符口癖）；外语帖用帖子语言
      // 去重仅限本帖，保证任何帖子都能补满
      const usedCt = new Set<string>([
        ...texts.map((t) => t.slice(0, 16)),
        ...threadReplies.map((p) => p.content.slice(0, 16)),
      ]);
      let ni = 0;
      while (texts.length < want && ni < 400) {
        const idx = texts.length;
        const commenterLang = resolveAuthor(commenterKeys[idx] ?? 'user').lang ?? 'zh-Hans';
        const lang = commentLangFor(postLang, commenterLang);
        // v14.2：口癖只加在池子评论上；兜底用尽 → 本条跳过（绝不重复刷屏）
        const pooled = pickTopicComment(post.content, lang, usedCt) ?? pickGenericComment(lang, usedCt, post.content);
        let cand: string | null = pooled;
        if (cand && lang === 'zh-Hans' && postLang === 'zh-Hans') {
          cand = maybeForeignFlavor(cand, commenterLang);
          usedCt.add(cand.slice(0, 16));
        }
        if (!cand) cand = followupComment(post.content, usedCt);
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
            post: { authorName: postAuthor.name, content: post.content, mediaDesc, lang: postLang },
            threads: subTargets.map((c) => ({ authorName: resolveAuthor(c.authorKey).name, content: c.content })),
            personas: subKeys.map((k) => {
              const a = resolveAuthor(k);
              return { name: a.name, persona: a.persona || '普通论坛网友', lang: a.lang ?? 'zh-Hans' };
            }),
            userName: resolveAuthor('user').name,
          })) as { items?: string[] };
          subTexts = Array.isArray(r.items)
            ? (r.items as unknown[]).map((x, i) => {
                // 位置对齐：无效项置空串（由池子兜底补位），不向后错位
                if (typeof x !== 'string') return '';
                const s = sanitizeCommentClient(stripReplyPrefixClient(x));
                if (s.trim().length < 2) return '';
                if (postLang === 'zh-Hans' && foreignDominantClient(s)) return '';
                // v14 锚定校验：楼中楼必须呼应「被回复评论 + 主帖」
                if (!commentAnchored(s, `${subTargets[i]?.content ?? ''} ${post.content}`)) return '';
                return s;
              })
            : [];
        } catch {
          subTexts = [];
        }
        // 兜底子回复共享去重集（同一帖的楼中楼不重复用同一条兜底文案；
        // v8 修复：继承本批顶层评论 + 该帖已有评论的已用文案，杜绝两人发同一条）
        const usedSub = new Set<string>([
          ...texts.map((t) => t.slice(0, 16)),
          ...threadReplies.map((p) => p.content.slice(0, 16)),
        ]);
        subTargets.forEach((c, i) => {
          let text = subTexts[i];
          if (!text) {
            // 池子兜底：优先主题匹配（接得上评论/主帖）；v9 语言跟随帖子
            const subCommenterLang = resolveAuthor(subKeys[i]).lang ?? 'zh-Hans';
            const subLang = commentLangFor(postLang, subCommenterLang);
            // v14.2：口癖只加在池子评论上；兜底用尽 → 跳过这条楼中楼
            const pooled = pickTopicComment(`${c.content} ${post.content}`, subLang, usedSub) ?? pickGenericComment(subLang, usedSub, `${c.content} ${post.content}`);
            let cand: string | null = pooled;
            if (cand && subLang === 'zh-Hans' && postLang === 'zh-Hans') {
              cand = maybeForeignFlavor(cand, subCommenterLang);
              usedSub.add(cand.slice(0, 16));
            }
            if (!cand) cand = followupComment(post.content, usedSub);
            if (!cand) return; // forEach 回调内跳过本条楼中楼
            text = cand;
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
      // v9：主帖语言（中文帖的 AI 回复也必须中文为主体）
      const mainPostAuthorLang = mainForMedia ? resolveAuthor(mainForMedia.authorKey).lang : undefined;
      const postLang = detectPostLang(postContent || target.content, mainPostAuthorLang ?? resolveAuthor(target.authorKey).lang);

      let text = '';
      try {
        const r = (await callApi({
          kind: 'reply',
          author: { name: author.name, persona: author.persona || '', lang: author.lang ?? 'zh-Hans' },
          parent: { authorName: replyName, content: parentContent },
          postContent,
          postLang,
          mediaDesc,
          history,
          userName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? sanitizeCommentClient(stripReplyPrefixClient(r.text)) : '';
        // v9 客户端兜底：中文帖拒绝整句外语回复
        if (text && postLang === 'zh-Hans' && foreignDominantClient(text)) text = '';
      } catch {
        text = '';
      }
      if (!text) {
        // v14 兜底重写：旧版「有道理，学到了」「这条我认可」是用户点名的 AI 废话，
        // 全部废除——兜底也必须锚定：主题池（看帖作答）→ 追问式（带话题锚点）
        const commenterLang = author.lang ?? 'zh-Hans';
        const lang = commentLangFor(postLang, commenterLang);
        const used = new Set<string>();
        const ctxContent = `${parentContent} ${postContent}`;
        const pooled = pickTopicComment(ctxContent, lang, used) ?? pickGenericComment(lang, used, ctxContent);
        let smart: string | null = pooled;
        if (smart && lang === 'zh-Hans' && postLang === 'zh-Hans') {
          smart = maybeForeignFlavor(smart, commenterLang);
        }
        if (!smart) smart = followupComment(ctxContent, used);
        text = smart || '蹲一个后续，别断更啊';
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
