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
 * 3. queueAiReplyToUserReply：用户回复了 AI 的帖/评论 → 1-5 位网友延迟回复
 *    （被回复者大概率在场 + 围观者；完整上下文：主帖 + 用户回复的那条评论 +
 *    用户评论 + 整楼对话链，可无限多轮，时间彼此错开陆续到达）。
 * 4. queueDmReply：用户私信发消息 → 对方延迟回复（LLM，失败通用兜底句）。
 * 5. generateMoreFeedPosts / generateNewFeedPosts：主页上拉/下拉松开 → 无限生成一批帖子
 *    （7~15 条，时间戳向前排，旧帖永不消失）；LLM 批量失败时 NPC 文案池兜底。
 * 6. generateMoreComments：「显示更多评论」→ 7~15 条一级评论 + 楼中楼森林
 *    （v26：每条评论 1-5 位不同网友直接回复，部分回复再被回复成 3/4 层；
 *    前台只等前两层，深层回复像真实 thread 一样陆续冒出来）。
 * 7. 热度合理性：评论/楼中楼/AI 回复的点赞浏览按父帖比例缩放（评论赞 << 主帖赞，像推特）。
 * 8. 【AI 真人社交】角色侧闭环（social.ts 提供人设/情绪/记忆/事件素材）：
 *    - tickForumSocial（ForumScheduler 心跳驱动）：按节奏给每个 char 排「主动发帖」任务；
 *    - charPost：基于【人设+当前情绪+对用户的记忆+今日事件素材+用户最近发的帖】发帖，
 *      发帖后安排网友点赞/评论（真实网友规则）+ 写入自己的记忆；
 *    - queueCharEngagements（用户发帖后）：每位角色延迟几分钟独立决定要不要点赞/评论
 *      （LLM 决策，评论必须针对帖子具体内容）；
 *    - queueAiReplyToUserReply 升级：被回复对象是 char 时，保证 TA 本人延迟几分钟「神回复」
 *      （带人设+记忆+完整对话链）；
 *    - queueCharThanksForLike：用户给角色点赞 → 角色偶尔来评论区回一句；
 *    - 所有延迟模拟真人（分钟~小时级，不秒回）；活跃度开关（ForumData.aiActivity）门控主动行为。
 *
 * 模型连接（设置 App）：
 * - API 模型（apiConfig）：所有 LLM 生成（帖子/评论/回复/私信）；
 * - 识图模型（visionConfig）：帖子带图时先把配图转成文字描述再喂给 LLM，
 *   让 AI「看得到」图（未配置时降级内置识图，再失败跳过）。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
// v41（B3）：致谢持久标记直连记忆库（like-thanks 去重）；D3 跨 App 主动消息
import { memAddForumFragment, memHasForumFragment } from '@/lib/memory';
import {
  ANON_KEY,
  COMMUNITY_DEFS,
  GEN_VERSION,
  IMG_PLACEHOLDER,
  NPC_DEFS,
  poolTextImage,
  PERSONA_ARCHETYPES,
  POST_MAX,
  REPLY_MAX,
  createDynNpc,
  isPostMemoryOn,
  isUserAuthor,
  likesOf,
  recordDynNpcRecent,
  renameBuiltinNpc,
  renameDynNpc,
  rollEngagement,
  seedBuiltinNpcFallbackNames,
  stripImgPh,
  unnamedDynKeys,
  unnamedNpcIds,
  type AuthorKey,
  type ForumData,
  type ForumPost,
  forumContactsSnap,
  forumData,
  mutateForum,
  refreshForumAuthors,
  resolveAuthor,
  saveForum,
  uid,
} from './core';
import { describeImagesAuto } from '@/lib/vision-client';
import { renderTextImage } from './textimg';
import { commentAnchored, isTenderPost, loudMemeIn, offTopicIn, personaBleedIn, postAllowsCatchall, universalPhraseIn, isParrotReply, isScoopPost, jsonLeakIn, promptLeakIn, sweetShipIn } from './topic';
import { promptOverridesPayload, rollCommentCount, rollPostCount } from './gen-settings';
// v42【帖子记忆】：帖子入库 + NPC 评论入库（深度记忆开关守卫在模块内部）
import { noteNpcCommentOnMyPost, notePostPublished, accountOfPost } from './post-memory';
// v43【NPC 记忆系统】：NPC 记住自己在用户帖下说过什么（人设/态度连贯）+
// 楼主帖子历史块（NPC 评论时读用户过往帖）+ 马甲暴露检测（金鱼守卫在模块内部）
import {
  npcMyHistoryBlock,
  npcMyHistoryLine,
  noteNpcMyComment,
  npcsWithHistoryOn,
  posterHistoryBlock,
  posterHistoryRaw,
} from './npc-memory';
import {
  charMemoryDigest,
  charMoodBlock,
  charPersonaCard,
  charRecentPosts,
  charRelationLine,
  dailyEventsFor,
  forumCharBriefs,
  noteCharEngaged,
  pickCharsWeighted,
  userPostsDigest,
  writeCharEngageMemory,
  writeCharOwnPostMemory,
  writeCharReplyMemory,
} from './social';
// 【多世界观】矩阵阵容 / 世界观话题 / AI 规则载荷（worldview-store 客户端层）
import {
  activeMatrixNpcs,
  activeWorldview,
  rebuildMatrixIndex,
  setActiveWorldviewId,
  worldviewApiPayload,
} from './worldview-store';
import { matrixNpcPersona, type MatrixNpc } from './worldview';
// v41（D3）：角色刷到你的帖子 → 低概率跨 App 主动来微信/QQ 私聊
import { maybeCrossAppPing } from './crossapp';

// ---------------- pending 队列（跨刷新持久） ----------------

interface PendingJob {
  id: string;
  /** 到期时间戳 */
  due: number;
  kind: 'replyToUserPost' | 'aiReplyBack' | 'dmReply' | 'charPost' | 'charEngage' | 'charReply' | 'netLike';
  /** 相关帖子 id（reply 类）/ dm 对方 key（dmReply）/ charPost=charKey */
  postKey: string;
  meta: {
    authorKey?: AuthorKey;
    parentContent?: string;
    /** netLike：是否发「赞了你的帖子」通知（仅用户自己的帖子才通知——v41 A4） */
    notify?: boolean;
    /** aiReplyBack 增强：分组锚点（顶层评论/主帖 id） */
    rootId?: string;
    /** aiReplyBack 增强：主帖 id（上下文用） */
    mainPostId?: string;
    /** aiReplyBack/charReply 增强：用户刚发的回复 id（AI 据此接话） */
    userReplyId?: string;
    /** 【AI 真人社交】charPost/charEngage/charReply：目标角色 char:<contactId> */
    charKey?: AuthorKey;
    /** charReply：点赞致谢模式（用户点赞后角色来评论区回一句，可返回空=不打扰） */
    thanks?: boolean;
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
  // v34 提示词面板：抽屉里编辑的提示词覆盖随请求上送（空对象 = 全默认零开销；
  // 保存即生效——每次调用都重读设置，后台调度器触发的生成同样用新提示词）
  const prompts = promptOverridesPayload();
  // 【多世界观】激活世界观背景/标签 + 用户 AI 规则（发帖/评论/审核）随请求上送——
  // 服务端把自定义规则拼在 System Prompt 最前端、世界观背景紧随其后；保存即生效
  //（每次调用都重读 store，后台调度器触发的生成同样用新世界观与新规则）
  const wv = worldviewApiPayload();
  const res = await fetch('/api/forum/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(Object.keys(prompts).length ? { prompts } : {}),
      worldview: wv.worldview,
      aiRules: wv.rules,
      config: useSettings.getState().apiConfig,
    }),
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

// ---------------- 【多世界观】矩阵 NPC 阵容（worldview-store 驱动） ----------------

/** 当前世界观的矩阵 NPC 阵容（authorKey = `mnpc:<id>`；空数组 = 无矩阵，走经典内置 NPC 池） */
function matrixCast(): { key: AuthorKey; npc: MatrixNpc }[] {
  return activeMatrixNpcs().map((npc) => ({ key: `mnpc:${npc.id}` as AuthorKey, npc }));
}

/** 按 postFreq 加权随机挑矩阵 NPC（avoidKeys 去重；无候选返回 undefined） */
function pickMatrixNpc(
  cast: { key: AuthorKey; npc: MatrixNpc }[],
  ...avoidKeys: AuthorKey[]
): { key: AuthorKey; npc: MatrixNpc } | undefined {
  const seen = new Set<AuthorKey>(avoidKeys.filter(Boolean));
  const avail = cast.filter((c) => !seen.has(c.key));
  if (!avail.length) return undefined;
  const total = avail.reduce((s, c) => s + Math.max(1, c.npc.postFreq), 0);
  let r = Math.random() * total;
  for (const c of avail) {
    r -= Math.max(1, c.npc.postFreq);
    if (r < 0) return c;
  }
  return avail[avail.length - 1];
}

/** 矩阵 NPC 的生成字段（name/persona 走 resolveAuthor 的作者索引；索引缺失时兜底直拼） */
function matrixSpecFields(npc: MatrixNpc): { name: string; persona: string } {
  const a = resolveAuthor(`mnpc:${npc.id}` as AuthorKey);
  return { name: a.name, persona: a.persona || matrixNpcPersona(npc) };
}

/** 当前世界观的话题方向（v37：洗牌后逐帖注入生成——自然混在内容里，
 *  不再作首页 tab 标签展示；空 = 经典 FEED_TOPICS） */
function worldviewTopics(): string[] {
  const tags = activeWorldview()?.tags.filter((x) => x.trim()) ?? [];
  return tags.length ? tags : FEED_TOPICS;
}

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

/** v25：只发帖不评论的内置 NPC（人设道具型——江屿/海王/绿茶：
 *  人设里自带具体道具【代言品牌/剧名/粉丝称呼】，去评论别人时
 *  极易把道具泄漏进评论造成角色串线；且明星本尊出现在素人帖评论区本身违和） */
const POSTER_ONLY_NPCS = new Set(['star', 'wave', 'greentea']);

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
  const keepPosts = d.posts.filter((p) => isUserAuthor(p.authorKey));
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

/** v22：seedCommentsFor（同步铺「追问式」占位评论）已删——用户明令禁止
 *  「蹲后续/这瓜保熟吗/等一个下文」这类万能句式，而追问式模板池全部由这类
 *  句子组成；评论 100% 由大模型根据当前帖子正文实时生成
 *  （ensureSeed 落盘后立刻调 llmPolishSeedComments → kind=multiComments，
 *  服务端把每条帖子的正文+话题标签原封不动传给模型；失败静默，宁缺毋滥——
 *  评论区短暂为空也不铺万能句式模板）。 */

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
    // 【多世界观】优先用世界观风格池播种：矩阵阵容领衔（每人保底一帖）+
    // 动态网友填充——绝不落入内置八卦池串味；自建世界观（无风格池）走
    // buildFeedBatch LLM 批量（世界观背景+矩阵人设+话题方向全注入），
    // LLM 失败/限流才回落经典 NPC 池（保论坛非空）
    const wvActive = activeWorldview();
    const wvSeed = wvActive?.seedPool ?? [];
    if (wvSeed.length) {
      const cast = matrixCast();
      const castKeys = cast.map((c) => c.key).sort(() => Math.random() - 0.5);
      const dynKeys: AuthorKey[] = [];
      for (let i = 0; i < Math.max(3, Math.ceil(wvSeed.length * 0.8)); i++) dynKeys.push(createDynNpc());
      const filler = [...castKeys, ...dynKeys].sort(() => Math.random() - 0.5);
      wvSeed.forEach((text, i) => {
        const key: AuthorKey =
          i < castKeys.length ? castKeys[i] : filler[(i - castKeys.length) % filler.length] ?? castKeys[0] ?? dynKeys[0] ?? 'official';
        specs.push({ key, text, community: null, npcId: '' });
      });
    } else if (wvActive) {
      // 【多世界观 v37】自建世界观：种子帖与上拉生成同一条 LLM 路径——
      // 风格贴合用户写的背景设定，绝不串味到内置八卦池
      let llmRaw: { key: AuthorKey; text: string }[] = [];
      try {
        llmRaw = await buildFeedBatch(10, new Set(), []);
      } catch {
        /* 冷却/限流 → 下方经典池兜底 */
      }
      if (llmRaw.length) {
        llmRaw.forEach(({ key, text }) => specs.push({ key, text, community: null, npcId: '' }));
      } else {
        for (const npc of NPC_DEFS) {
          const pool = [...npc.pool];
          const text = pool[Math.floor(Math.random() * pool.length)];
          if (text) specs.push({ key: `npc:${npc.id}`, text, community: communityOfPoolText(npc.id, text), npcId: npc.id });
        }
      }
    } else {
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
    }
    // 防刷屏重排（同一信息流绝不连续同一作者）
    const ordered = shuffleNoAdjacent(specs);
    // 自然时间线：最新一条「刚刚」（15~60 秒前），往下间隔逐渐拉大（15分钟→1小时→昨天）
    const seedPosts: ForumPost[] = [];
    let at = now - (15 + Math.random() * 45) * 1000;
    // v29 池子帖配图挂点：POOL_TEXTIMG 描述 → attachTextImage 渲染白底居中文字图
    const seedImgCount = { n: 0 };
    ordered.forEach((sp, i) => {
      const p = basePost(sp.key, sp.text, sp.community, at);
      attachTextImage(p, poolTextImage(sp.text), seedImgCount);
      seedPosts.push(p);
      // 人设连通性：记录动态网友最近发的内容（下个帖子里接上话疸）
      recordDynNpcRecent(sp.key, sp.text);
      at -= naturalGapMs(i);
    });
    // v22：同步占位评论已删（万能句式池清洗）——所有评论（含用户帖）
    // 全部由紧随其后的 llmPolishSeedComments 按每条帖子正文 LLM 实时生成
    const allNew: ForumPost[] = [...seedPosts];
    // v9：版本升级重播种时用户帖的旧评论已被清掉——给自己的帖子（大号或匿名小号）
    // 也补一批干净评论（新强校验逻辑：贴题+语言跟随+数据合理），帖子不至于零回复
    const userPosts = d.posts.filter((p) => isUserAuthor(p.authorKey)).slice(-6);
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
    // v15：一次 multiComments 批量调用给所有种子帖（含用户帖）按每条帖子的
    // 具体内容实时生成真实评论——首屏评论区不再依赖写死池子
    void llmPolishSeedComments([...seedPosts.map((p) => p.id), ...userPosts.map((p) => p.id)]);
  } finally {
    seeding = false;
  }
}

/** LLM 生成追加（失败静默——池子内容已保证不空） */
async function llmPolish(): Promise<void> {
  try {
    const d = forumData();
    // 【多世界观】精修帖优先由矩阵阵容发（persona 含【身份】【性格】【口头禅】，
    // 服务端强制代入）；无矩阵回落内置 NPC
    const cast = matrixCast();
    const npcPicks: { id: string; matrix: boolean; npc?: MatrixNpc }[] = cast.length
      ? cast.slice().sort(() => Math.random() - 0.5).slice(0, 3).map((c) => ({ id: c.npc.id, matrix: true, npc: c.npc }))
      : NPC_DEFS.slice().sort(() => Math.random() - 0.5).slice(0, 3).map((n) => ({ id: n.id, matrix: false }));
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
        if (n.matrix && n.npc) {
          const f = matrixSpecFields(n.npc);
          return { name: f.name, persona: f.persona, community: '今日热议', isChar: false, id: n.id, matrix: true };
        }
        // v5：名字/人设都走 resolveAuthor（内置 NPC 已换成 LLM 名，口吻跟新身份走）
        const a = resolveAuthor(`npc:${n.id}` as AuthorKey);
        return { name: a.name, persona: a.persona ?? '', community: defaultCommunityFor(n.id) ?? '今日热议', isChar: false, id: n.id, matrix: false };
      }),
      ...charPicks.map((c) => ({ name: c.name, persona: c.persona, community: '今日热议', isChar: true, id: c.id, matrix: false })),
    ].slice(0, 5);
    if (!items.length) return;
    const avoid = d.posts.slice(-8).map((p) => p.content.slice(0, 60));
    const topics = worldviewTopics().slice().sort(() => Math.random() - 0.5);
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
      const authorKey: AuthorKey = spec.isChar ? `char:${spec.id}` : spec.matrix ? `mnpc:${spec.id}` : `npc:${spec.id}`;
      // LLM 帖不带 #话题 时，按默认版块归位
      const tag = /#([^#\s]+)#/.exec(t)?.[1];
      const cid = spec.isChar || spec.matrix ? (tag ? NPC_COMMUNITY_MAP[tag] ?? null : null) : communityOfPoolText(spec.id, t);
      const post = basePost(authorKey, t, cid, now - (i + 1) * 420_000);
      // v27 文字图片：has_image 帖的 image_description canvas 直出一张
      // （纯白底居中文字图；图被丢弃时剥掉 [图片] 占位符防字面上屏）
      const ti = typeof o?.textImage === 'string' ? o.textImage.trim() : '';
      const imgOk = ti.length >= 4 && ti.length <= 120 && imgN < FEED_TEXTIMG_MAX;
      if (imgOk) {
        try {
          post.media = [renderTextImage(ti)];
          imgN += 1;
        } catch {
          /* canvas 不可用等：剥占位符保持纯文字 */
        }
      }
      if (!post.media?.length && post.content.includes(IMG_PLACEHOLDER)) {
        post.content = stripPlaceholder(post.content);
      }
      next.posts.push(post);
    });
    saveForum(next);
  } catch {
    /* LLM 失败：池子内容已够看 */
  }
}

/** v15 新增：播种后给种子帖（含用户自己的帖子）异步补足真实评论。
 *  一次 kind=multiComments 调用（服务端把每条帖子的正文+话题标签原封不动
 *  传给模型，Prompt 开头强制锚定）→ 每帖 4~6 条完全由大模型按帖子具体内容
 *  实时生成的一级评论；客户端再做一遍锚定/语言双保险校验。
 *  失败静默——评论区短暂为空也不铺万能句式模板（宁缺毋滥）；
 *  用户点开帖子可随时点「显示更多评论」触发 genCommentBatch 实时补齐。 */
async function llmPolishSeedComments(seedPostIds: string[]): Promise<void> {
  try {
    const d = forumData();
    const seen = new Set<string>();
    const targets = seedPostIds
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => d.posts.find((p) => p.id === id))
      .filter((p): p is ForumPost => !!p && p.replyTo === null)
      .slice(-16); // API 上限 16 帖（取最新的）
    if (!targets.length) return;
    const perPost = 4 + Math.floor(Math.random() * 3); // 4~6 条/帖
    const r = (await callApi({
      kind: 'multiComments',
      posts: targets.map((p) => ({
        id: p.id,
        authorName: resolveAuthor(p.authorKey).name,
        content: p.content,
        lang: detectPostLang(p.content, resolveAuthor(p.authorKey).lang),
      })),
      perPost,
    })) as { items?: { postId?: unknown; comments?: unknown }[] };
    const items = Array.isArray(r.items) ? r.items : [];
    const next: ForumData = { ...forumData() };
    const newDyn: AuthorKey[] = [];
    const dynBefore = new Set(Object.keys(forumData().dynNpcs ?? {}));
    let added = 0;
    // v26：全部新评论（跨帖汇总——种子楼中楼的选材池）
    const createdAll: ForumPost[] = [];
    for (const t of targets) {
      const block = items.find((x) => typeof x?.postId === 'string' && x.postId === t.id);
      const raw = Array.isArray(block?.comments) ? block.comments : [];
      const postAuthor = resolveAuthor(t.authorKey);
      const postLang = detectPostLang(t.content, postAuthor.lang);
      // 客户端双保险：清洗 + 去重 + 整句外语拦截 + 锚定校验（与服务端同口径）
      const existing = next.posts.filter((p) => p.replyTo === t.id);
      const seenCt = new Set(existing.map((p) => p.content.slice(0, 16)));
      const valid: string[] = [];
      const catchallOk = postAllowsCatchall(t.content); // 万能句式豁免（未完结八卦/求助帖）
      let catchallUsed = false;
      // v35：爆料帖磕糖甜评限 1 条 + 泄露双保险（与服务端同口径）
      const scoopPost = isScoopPost(t.content) && !isTenderPost(t.content);
      let sweetUsed = false;
      for (const c of raw) {
        if (typeof c !== 'string') continue;
        const s = sanitizeCommentClient(stripReplyPrefixClient(c));
        // 用户规范：评论 3~100 字（留 10 字容差）
        if (s.trim().length < 3 || s.length > 110 || seenCt.has(s.slice(0, 16))) continue;
        if (postLang === 'zh-Hans' && foreignDominantClient(s)) continue;
        // v35 第一道闸：JSON 残留（{"thought":…}）/ 指令泄露（【本帖核心话题词…】）→ 丢弃
        if (jsonLeakIn(s) || promptLeakIn(s)) continue;
        // v22 万能句式：非豁免帖一律丢弃；豁免帖最多 1 条
        if (universalPhraseIn(s)) {
          if (!catchallOk || catchallUsed) continue;
          catchallUsed = true;
        }
        // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱丢弃（与服务端双保险）
        if (isTenderPost(t.content) && loudMemeIn(s)) continue;
        // v35 爆料帖：磕糖甜评超 1 条 → 丢弃
        if (scoopPost && sweetShipIn(s)) {
          if (sweetUsed) continue;
          sweetUsed = true;
        }
        // v25 领域私货：≥2 个该帖领域之外的关键词 → 串台丢弃（与服务端双保险）；
        // v27 锚定前剥 [图片] 占位符（防词表污染误杀正常评论）
        const anchorText = stripImgPh(t.content);
        if (offTopicIn(s, anchorText)) continue;
        if (!commentAnchored(s, anchorText)) continue; // 串台/AI 废话 → 丢弃
        // v35 跨批次去重：与本帖已有评论整句级重合（换皮复读）→ 丢弃
        if (existing.some((tp) => isParrotReply(s, tp.content))) continue;
        seenCt.add(s.slice(0, 16));
        // v35：批内一级评论互相复读（同措辞换网名）→ 只保留首条（与服务端同口径双保险）
        if (valid.some((v) => isParrotReply(s, v))) continue;
        valid.push(s);
      }
      if (!valid.length) continue;
      // 评论者：新面孔 + 老网友回访；同帖去重（楼主 + 已有评论者）
      const keys = pickCommenters(valid.length, postLang, t.content, t.authorKey, ...existing.map((p) => p.authorKey));
      keys.forEach((k) => {
        if (k.startsWith('dyn:') && !dynBefore.has(k.slice(4))) newDyn.push(k);
      });
      // 时间：从该帖现有最后一条评论之后铺到现在
      const lastAt = existing.reduce((m, p) => Math.max(m, p.createdAt), t.createdAt);
      const hi = Date.now() - 3_000;
      const span = Math.max(hi - lastAt, valid.length * 90_000);
      const postEng = { likes: likesOf(t), views: t.views };
      const created: ForumPost[] = [];
      valid.forEach((txt, i) => {
        const at = Math.min(Math.floor(lastAt + (span * (i + 0.3 + Math.random() * 0.6)) / valid.length), hi);
        const c = basePost(
          keys[i] ?? t.authorKey,
          txt.slice(0, REPLY_MAX),
          t.community,
          Math.max(at, t.createdAt + 5_000),
          t.id,
          postAuthor.name,
          true,
          postEng,
        );
        created.push(c);
        next.posts.push(c);
        recordDynNpcRecent(keys[i] ?? t.authorKey, `评论过：${txt.slice(0, 60)}`);
      });
      added += created.length;
      createdAll.push(...created);
      // 楼主是用户（大号/小号） → 前 2 条评论发通知（X：别人回复了你的帖子）
      if (isUserAuthor(t.authorKey) && created.length) {
        // v42【帖子记忆】：播种期生成的网友评论也入「某NPC在我的帖子里说了什么」
        created.forEach((c) => noteNpcCommentOnMyPost(t.id, c));
        // v43【NPC 记忆系统】：播种期网友也记「我在TA帖下说过这句」
        created.forEach((c) => noteNpcMyComment(c.authorKey, t, c.content));
        next.notifications = [
          ...created.slice(0, 2).map((c) => ({
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
    }
    if (!added && !newDyn.length) return;
    // LLM 起名：本批新建的评论者换 AI 网名（失败保留占位名）
    if (newDyn.length) await renameDynNpcsViaLlm([...new Set(newDyn)]);
    saveForum(next);
    // v26：种子评论的楼中楼（后台静默长树；预算受限——「显示更多评论」给全量 1-5 人）
    if (createdAll.length) void growSeedSubReplies(createdAll);
  } catch {
    /* 静默：评论区维持现状（宁缺毋滥），下次点「更多评论」再补 */
  }
}

/** v26：种子评论的楼中楼（llmPolishSeedComments 落盘后异步调用）。
 *  挑 3~5 个拿到新评论的种子帖，各给小预算楼中楼（每帖 2 条评论 × 1~3 人
 *  直接回复，L3 ≤2、L4 ≤1）——首屏打开帖子就能看到「评论下面有人回复、回复
 *  下面还有人回复」；点「显示更多评论」时 genCommentBatch 给新评论全量 1-5 人。
 *  开机后台静默长树（失败静默——评论区维持现状，宁缺毋滥）。 */
async function growSeedSubReplies(created: ForumPost[]): Promise<void> {
  try {
    if (!created.length) return;
    // 按主帖分组（created 都是 replyTo = 主帖 id 的一级评论）
    const byPost = new Map<string, ForumPost[]>();
    for (const c of created) {
      const pid = c.replyTo ?? '';
      if (!pid) continue;
      const list = byPost.get(pid) ?? [];
      list.push(c);
      byPost.set(pid, list);
    }
    // 挑 3~5 帖（每帖至少 1 条新评论；跨帖分散——更多帖子能刷到楼中楼）
    const picked = [...byPost.entries()].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
    const newDynAll: AuthorKey[] = [];
    for (const [pid, comments] of picked) {
      const post = forumData().posts.find((p) => p.id === pid);
      if (!post || !comments.length) continue;
      const postAuthor = resolveAuthor(post.authorKey);
      const postLang = detectPostLang(post.content, postAuthor.lang);
      const mediaDesc = await describePostMedia(post.media);
      // 每帖挑 2 条评论（随机）；L2 选人避开本帖已有作者
      const targets = comments.slice().sort(() => Math.random() - 0.5).slice(0, 2);
      const existing = [
        post.authorKey,
        ...forumData().posts.filter((p) => p.replyTo === pid).map((p) => p.authorKey),
        ...targets.map((t) => t.authorKey),
      ];
      const made = await growSubReplyForest({
        post,
        postAuthorName: postAuthor.name,
        postLang,
        mediaDesc,
        targets,
        existingKeys: existing,
        catchall: { ok: postAllowsCatchall(post.content), used: false },
        budget: { maxDirect: 3, l3Max: 2, l4Max: 1 },
        renameMode: 'defer',
      });
      newDynAll.push(...made.newDyn);
    }
    if (newDynAll.length) await renameDynNpcsViaLlm([...new Set(newDynAll)]);
  } catch {
    /* 静默：开机楼中楼失败不影响评论区（点「更多评论」随时补） */
  }
}

// ---------------- 主页无限生成（底部上拉松开 / 顶部下拉松开 → 过界手势触发） ----------------
// 用户要求：生成完一批后不再自动生成——打开 App 不补帖（ensureFresh 已删），
// 只在用户自己下拉/上拉松开、或点「显示更多评论」时才生成。

let feedGenerating = false;

/** v22 万能句式池彻底清除（用户规范：「绝对禁止万能句式——蹲后续/
 *  这瓜保熟吗/等一个下文，除非帖子真的是在爆料未完结的八卦」）：
 *  - v15 的 FOLLOWUP_COMMENT_TEMPLATES（22 条追问式模板）与变体后缀全部由
 *    这类万能句式组成——原设计是 LLM 失败/不足额时的应急兜底，但它正是
 *    评论区「满屏蹲后续」的直接来源，用户已明令禁止，整池删除；
 *  - 现在评论一律由大模型根据当前帖子正文实时生成（/api/forum/generate
 *    的 comments / multiComments / subreplies 分支，Prompt 按「先分析后
 *    生成 + 五种网友人设 + 万能句式黑名单」重写）；LLM 失败/限流时
 *    宁缺毋滥——评论区维持现状等配额恢复，绝不铺模板。 */

/** 生成主题池（用户指定内容方向：八卦/明星/吐槽/车/影视/娱乐/吃瓜）——
 *  LLM 按主题方向生成；兜底组合池同主题，保证无 LLM 也是对味内容 */
export const FEED_TOPICS = ['明星八卦', '吃瓜现场', '影视综艺', '汽车圈', '娱乐热点', '今日吐槽'];

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

/** 常用聊天 emoji 白名单（B6 v41：真实网友会用少量 emoji；全套剥除后角色永远
 *  打不出表情，冷冰冰）。白名单 = 表情脸（U+1F600–1F64F）+ 常用手势爱心火苗
 *  （👍👏🙏💪❤️✨🔥💯🎉）；数量限 ≤2 个，超出的从尾部删；其余奇异符号
 *  （旗帜/技术符号/组合装饰）照旧全剥。 */
const EMOJI_KEEP = /[\u{1F600}-\u{1F64F}\u{1F44D}\u{1F44C}\u{1F44F}\u{1F64C}\u{1F91D}\u{1F4AA}\u{2764}\u{2728}\u{1F525}\u{1F4AF}\u{1F389}\u{1F38A}]/u;

/** emoji 过滤（B6 v41）：白名单常用 emoji 保留 ≤2 个，其余全剥。 */
function filterEmoji(raw: string): string {
  // 逐码点扫描（代理对安全）；只保前 2 个白名单 emoji，其余全剥
  const cps = Array.from(raw);
  const keepIdx: number[] = [];
  cps.forEach((ch, i) => {
    if (EMOJI_KEEP.test(ch)) keepIdx.push(i);
  });
  const keepSet = new Set(keepIdx.slice(0, 2));
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const c = ch.codePointAt(0) ?? 0;
    const isEmoji =
      (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0xfe00 && c <= 0xfe0f) ||
      (c >= 0x1f1e6 && c <= 0x1f1ff) || (c >= 0x2b00 && c <= 0x2bff);
    if (!isEmoji || keepSet.has(i)) out += ch; // 非白名单 emoji 或超额：丢弃
  }
  return out;
}

/** 评论正文清洗（v9 乱码修复，与服务端 sanitizeCommentText 同口径）：
 *  零宽/控制字符/替换符、拼接符连串、markdown 记号全清除；
 *  v41（B6）：emoji 改白名单过滤（常用表情脸/手势保留 ≤2 个，其余照剥）。 */
function sanitizeCommentClient(raw: string): string {
  let t = raw;
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFFFD/g, '');
  t = t.replace(/[~～|｜·•※]{2,}/g, ' ');
  t = t.replace(/```+/g, '').replace(/[*_`#>]{1,3}(?=\s|$)/g, '');
  t = filterEmoji(t);
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

/** v41（C1）：私信文本轻量清洗（不剥 emoji——私聊表情更自然；只清控制字符/
 *  markdown 记号/拼接符，折叠空白）。 */
function sanitizeDmClient(raw: string): string {
  let t = raw;
  t = t.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFFFD/g, '');
  t = t.replace(/[~～|｜·•※]{2,}/g, ' ');
  t = t.replace(/```+/g, '').replace(/[*_`#>]{1,3}(?=\s|$)/g, '');
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
  // 四、明星日常（假装本尊，非常营业；v24 单主题化——一条只讲一件事，
  // 严禁咖啡梗+剧宣+澄清+求互动塞同一条，那是营销号清单不是人发的帖子）
  [
    '今天难得六点收工，路过楼下买了杯热美式，店员小哥问我是不是上次那个「加三份浓缩」的狠人，行吧，我在陌生人心里的形象是这样了。他问今天还加吗，我说不了，今天想当个普通人。他说普通人喝白开水。行，那明天继续当狠人。配图收工自拍，风大，头发乱了，凑合看',
    '凌晨三点还没睡，不是失眠，是背台词背的。明早六点开工，现在睡等于没睡，干脆不睡。翻了翻评论区，看到有学生党说考完试来看我，好好考试！！考完随便看。问我最近为什么瘦了的，剧组盒饭是真难吃，我含泪瘦了六斤，这波算工伤。碎碎念完了，去冲个澡，早上见 #收工碎碎念#',
    '被公司逼着营业的一天。问：今天的自拍为什么是背影？答：因为正脸在赶工的剧里，先留个悬念。问：什么时候播出？答：快了，比我化妆快。问：最近有什么开心的事？答：刚发现楼下的猫会握手了，比我会营业。行了，老板说字数够了，评论区见 #被逼营业现场#',
    '新剧明晚更新第八集。有一场对峙戏我们拍了两天，对手戏老师全程压着我演，导演喊咔之后全组安静了几秒，然后才有人鼓掌。播出前我偷偷看了粗剪，那几分钟我自己都起鸡皮疙瘩。明晚别倍速，反转那三分钟快进了会后悔，就当帮我个忙，慢慢看',
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
  // 【多世界观 v37】话题方向优先用世界观话题（洗牌后逐帖注入，自然混在信息流里）；矩阵阵容进入作者池（按 postFreq
  // 加权 ~35% 出场率——瓜主/营销号/站姐/杠精是这个世界观的原住民）
  const topics = worldviewTopics().slice().sort(() => Math.random() - 0.5);
  const cast = matrixCast();
  const pChar = chars.length ? 0.08 : 0;
  const pMatrix = cast.length ? 0.35 : 0;
  const pNpc = cast.length ? 0 : 0.08;
  const pOldDyn = 0.24;
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
    if (r < pChar) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      specs.push({
        key: `char:${ch.id}`,
        name: ch.nickname || ch.name,
        persona: [ch.persona, ch.background, ch.expressStyle].filter(Boolean).join('；'),
        community: null,
        topic,
        lang: 'zh-Hans',
      });
    } else if (r < pChar + pMatrix) {
      // 【多世界观】矩阵 NPC：persona 含【身份】【性格】【口头禅】强制代入
      const m = pickMatrixNpc(cast);
      if (m) {
        const f = matrixSpecFields(m.npc);
        specs.push({ key: m.key, name: f.name, persona: f.persona, community: null, topic, lang: 'zh-Hans' });
        continue;
      }
      // 加权抽取意外失败：落新网友兑底
      const key = createDynNpc({ archetypeId: archRing[archCursor++ % archRing.length] });
      newDyn.push(key);
      const a = resolveAuthor(key);
      specs.push({ key, name: a.name, persona: a.persona ?? '', community: null, topic, lang: a.lang ?? 'zh-Hans' });
    } else if (r < pChar + pMatrix + pNpc) {
      // 内置主题 NPC（v4 缩减到 ~8%，只作保底大 V；轮换环保证一环内不重复；
      // v5 名字/persona 走 resolveAuthor——内置 NPC 也挂着 LLM 名）
      const nd = shuffledNpcs[npcCursor++ % shuffledNpcs.length];
      const a = resolveAuthor(`npc:${nd.id}` as AuthorKey);
      specs.push({ key: `npc:${nd.id}`, name: a.name, persona: a.persona ?? nd.persona, community: defaultCommunityFor(nd.id), topic, lang: 'zh-Hans' });
    } else if (r < pChar + pMatrix + pNpc + pOldDyn) {
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
        textImage: ti.length >= 4 && ti.length <= 120 ? ti : undefined,
      });
    });
  } catch {
    /* 走池子兜底 */
  }
  // 【多世界观】风格一致的兑底池：矩阵阵容 + 动态网友轮流出帖（绝不串味到内置八卦池）
  const wvSeedPool = activeWorldview()?.seedPool ?? [];
  if (results.length < n && wvSeedPool.length) {
    const d = forumData();
    const dynIds = Object.keys(d.dynNpcs ?? {})
      .sort(() => Math.random() - 0.5)
      .map((id) => `dyn:${id}` as AuthorKey);
    const ring: AuthorKey[] = [...cast.map((c) => c.key), ...dynIds];
    while (ring.length < 3) ring.push(createDynNpc());
    let ri = 0;
    for (const text of wvSeedPool) {
      if (results.length >= n) break;
      if (used.has(text.slice(0, 20))) continue;
      used.add(text.slice(0, 20));
      results.push({ key: ring[ri++ % ring.length], text, textImage: poolTextImage(text) });
    }
  }
  // NPC 文案池补齐（LLM 失败/条数不足）：轮换环——每个 NPC 一轮只出一条，
  // 同一批内绝不连续出现同一作者（修复「秋名山下打车连发多条」刷屏 Bug 的关键）。
  // 【多世界观】有风格池时跳过（内置八卦池会串味），直接走下方组合式兑底
  if (results.length < n && !wvSeedPool.length) {
    let rounds = 0;
    while (results.length < n && rounds < 60) {
      let addedThisRound = 0;
      for (const npc of shuffledNpcs) {
        if (results.length >= n) break;
        const cand = npc.pool.find((x) => !used.has(x.slice(0, 20)));
        if (!cand) continue;
        used.add(cand.slice(0, 20));
        results.push({ key: `npc:${npc.id}`, text: cand, textImage: poolTextImage(cand) }); // v29 池子帖配图
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
      results.push({ key: author, text: t, textImage: poolTextImage(t) }); // v29 combo 帖子配图（新四档池条目）
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
// ---------------- 生成帖子按需配「文字图片」（v9；v27 图文并茂重写） ----------------

/** 单批最多文字图片数（太多会刷屏；v27 配图帖比例提升 3→5；
 *  v29 用户新配图规则（触发词命中必配、无图仅三种例外）下配图率大涨，5→8） */
const FEED_TEXTIMG_MAX = 8;

/** 剥掉正文里的 [图片] 占位符并清理多余空白（配图被丢弃时防字面上屏）。 */
function stripPlaceholder(content: string): string {
  return content
    .split(IMG_PLACEHOLDER)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 给一条新生成的帖子按需配「文字图片」（v27：用户要求的配图方式——
 *  LLM 按 has_image 输出 image_description（以【视角】开头，30~100 字），
 *  客户端把它 canvas 渲染成纯白底居中灰字的文字图（与发布弹层「文字图片」
 *  同款观感），content 里对应位置保留 [图片] 占位符，渲染端分段交替上屏；
 *  图被丢弃（描述无效/封顶/canvas 失败）时必须剥掉占位符。
 *  纯前端直出，零 API 成本；count 为本批已配图计数（封顶 FEED_TEXTIMG_MAX）。 */
function attachTextImage(post: ForumPost, textImage: string | undefined, count: { n: number }): void {
  const ti = textImage?.trim();
  const usable = !!ti && ti.length >= 4 && ti.length <= 120 && !post.media?.length && count.n < FEED_TEXTIMG_MAX;
  try {
    if (usable && ti) {
      post.media = [renderTextImage(ti)];
      count.n += 1;
      return; // 配图成功：占位符保留（渲染端分段上屏）
    }
  } catch {
    /* canvas 不可用等：按配图失败处理 */
  }
  // 配图失败/无效/封顶：剥掉占位符（防字面 [图片] 上屏）
  if (post.content.includes(IMG_PLACEHOLDER)) post.content = stripPlaceholder(post.content);
}

/** 主页滑到底、上拉松开 → 生成一批更早的帖子（追加在信息流下方，旧帖永不消失）。 */
export async function generateMoreFeedPosts(): Promise<number> {
  if (feedGenerating) return 0;
  feedGenerating = true;
  try {
    const d = forumData();
    if (!d.seeded) return 0;
    const n = rollPostCount(); // v34：抽屉「每次生成帖子」范围（默认 7~15 条）
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
    const n = rollPostCount(); // v34：抽屉「每次生成帖子」范围（默认 7~15 条）
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
  // v25：人设道具型 NPC（明星本尊江屿/海王/绿茶）退出评论区候选——
  // 这些人设自带大量具体道具（咖啡品牌代言/剧名/粉丝称呼「屿哥」），
  // 去评论素人帖子时极易把道具泄漏进评论（角色串线重灾区）。
  // 发帖保留（人设在自家帖子里成立），评论一律由普通网友承担。
  const npcs = NPC_DEFS.slice()
    .filter((n) => !POSTER_ONLY_NPCS.has(n.id))
    .sort(() => Math.random() - 0.5);
  const dynKeys = Object.keys(d.dynNpcs ?? {});
  const bias = postLang && postLang !== 'zh-Hans' ? postLang : undefined;
  // 帖子主题 → 更可能来评论的人设原型（评论区同温层，但保留乱入的乐子人）
  const archBias = postContent ? archetypeIdsForContent(postContent) : [];
  const seen = new Set<AuthorKey>(avoidKeys.filter(Boolean));
  const out: AuthorKey[] = [];
  // 【多世界观】矩阵阵容的评论区存在感（按 postFreq 加权 ~18%——
  // 核心 NPC 必须频繁出没评论区，且身份/性格/口头禅强制代入）
  const cast = matrixCast();
  let guard = 0;
  while (out.length < count && guard++ < count * 12) {
    const r = Math.random();
    let k: AuthorKey;
    if (cast.length && r < 0.18) {
      const m = pickMatrixNpc(cast, ...seen);
      if (m) {
        seen.add(m.key);
        out.push(m.key);
        continue;
      }
    }
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
    // v25：引战/三观争议帖放最前——杠精/暴躁口吻优先（这类帖子评论区骂声一片）
    { re: /保研|名额|奖学金|室友矛盾|我不是坏心|小三|彩礼|该不该分|要不要分|重男轻女|偏心|举报她|举报他/i, ids: ['gangjing', 'daxuesheng', 'dagong', 'kaoyan'] },
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

// ---------------- v26 楼中楼：多层回复树（评论下 1-5 人 · 回复下还有回复） ----------------

/** L2 直接回复条数：1~5（用户需求「评论下面回复评论可以有 1-5 个人」；
 *  2~3 条为主流，1 条和 5 条都真实存在。max 供种子期预算压缩（1~3）用。 */
function rollSubCount(max = 5): number {
  const r = Math.random();
  if (r < 0.2) return Math.min(1, max);
  if (r < 0.45) return Math.min(2, max);
  if (r < 0.7) return Math.min(3, max);
  if (r < 0.87) return Math.min(4, max);
  return Math.min(5, max);
}

/** 一批楼中楼的调用计划（按位对齐）：target = 被回复的帖子；root = 所属一级评论
 *  （replyTo 分组锚点——挂在这条评论的楼中楼里显示）；key = 回复者。 */
interface SubPlan {
  target: ForumPost;
  root: ForumPost;
  key: AuthorKey;
}

/** 调 subreplies API 生成一层楼中楼（≤30 线程/调用，分片并行）→ 客户端双保险
 *  校验 → basePost 建帖（replyTo = root 锚点、replyToPost = target 精确挂树）。
 *  时间戳晚于被回复帖 1~40 分钟（不晚于现在）；没写出来的位置直接跳过
 *  （v20 起无模板兜底——宁缺毋滥）。 */
async function callSubReplyLayer(
  ctx: {
    post: ForumPost;
    postAuthorName: string;
    postLang: string;
    mediaDesc: string;
    catchall: { ok: boolean; used: boolean };
  },
  plans: SubPlan[],
): Promise<ForumPost[]> {
  const out: ForumPost[] = [];
  if (!plans.length) return [];
  const CHUNK = 30; // 与服务端 subreplies 线程上限同步（v26：12→30）
  const chunks: SubPlan[][] = [];
  for (let i = 0; i < plans.length; i += CHUNK) chunks.push(plans.slice(i, i + CHUNK));
  // v35：爆料帖磕糖甜评限 1 条（整批共享）
  const scoop = isScoopPost(ctx.post.content, ctx.mediaDesc) && !isTenderPost(ctx.post.content, ctx.mediaDesc);
  let sweetUsed = false;
  const groups = await Promise.all(
    chunks.map(async (ch): Promise<ForumPost[]> => {
      let texts: string[] = [];
      try {
        // v35：带上每层楼已有的回复（生成时明确避开——盖楼复读的解药）
        const dNow = forumData();
        const prevOf = (targetId: string): string[] =>
          dNow.posts
            .filter((s) => s.replyToPost === targetId && s.content)
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-4)
            .map((s) => s.content);
        // v35：本帖全部一级评论（楼中楼整句照搬别楼评论 = 换皮复读 → 拦截）
        const topLevelTexts = dNow.posts
          .filter((s) => s.replyTo === ctx.post.id && s.content)
          .map((s) => s.content);
        // v41（C2）：avoid 防重复注入楼中楼——本帖最近已说过的评论不再重复
        const avoid = dNow.posts
          .filter((s) => (s.replyTo === ctx.post.id || s.replyToPost) && s.content)
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 12)
          .map((s) => s.content.slice(0, 40));
        const r = (await callApi({
          kind: 'subreplies',
          post: { authorName: ctx.postAuthorName, content: ctx.post.content, mediaDesc: ctx.mediaDesc, lang: ctx.postLang },
          threads: ch.map((p) => ({
            authorName: resolveAuthor(p.target.authorKey).name,
            content: p.target.content,
            prev: prevOf(p.target.id),
          })),
          personas: ch.map((p) => {
            const a = resolveAuthor(p.key);
            // 【多世界观】矩阵 NPC 身份强制代入标记（服务端渲染强度不同）
            return {
              name: a.name,
              persona: a.persona || '普通论坛网友',
              lang: a.lang ?? 'zh-Hans',
              ...(p.key.startsWith('mnpc:') ? { matrix: true } : {}),
            };
          }),
          avoid,
          userName: resolveAuthor('user').name,
        })) as { items?: string[] };
        texts = Array.isArray(r.items)
          ? (r.items as unknown[]).map((x, i) => {
              // 位置对齐：无效项置空串，不向后错位
              if (typeof x !== 'string') return '';
              const s = sanitizeCommentClient(stripReplyPrefixClient(x));
              // 用户规范：回复 3~100 字（留 10 字容差）
              if (s.trim().length < 3 || s.length > 110) return '';
              if (ctx.postLang === 'zh-Hans' && foreignDominantClient(s)) return '';
              // v35 第一道闸：JSON 残留（{"thought":…}）/ 指令泄露（【本帖核心话题词…】）→ 丢弃
              if (jsonLeakIn(s) || promptLeakIn(s)) return '';
              const plan = ch[i];
              // v35 复读机检测：与被回复评论词面高度重合（盖楼复读）→ 丢弃
              if (isParrotReply(s, plan.target.content)) return '';
              // v35 同楼层去重：与楼层里已有的回复复读撞车 → 丢弃
              if (prevOf(plan.target.id).some((pv) => isParrotReply(s, pv))) return '';
              // v35 跨楼照搬：整句照搬本帖别的一级评论（换皮复读）→ 丢弃
              if (topLevelTexts.some((c) => c !== plan.target.content && isParrotReply(s, c))) return '';
              // 万能句式：非豁免帖全废；豁免帖与整批共享 1 条额度
              if (universalPhraseIn(s)) {
                if (!ctx.catchall.ok || ctx.catchall.used) return '';
                ctx.catchall.used = true;
              }
              // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱丢弃
              if (isTenderPost(ctx.post.content, ctx.mediaDesc) && loudMemeIn(s)) return '';
              // v35 爆料帖：磕糖甜评超 1 条 → 丢弃
              if (scoop && sweetShipIn(s)) {
                if (sweetUsed) return '';
                sweetUsed = true;
              }
              // v25 称呼/名称串线：拿回复者网名拼称呼/自称网名 → 丢弃
              if (personaBleedIn(s, resolveAuthor(plan.target.authorKey).name, [resolveAuthor(plan.key).name])) return '';
              // v25 领域私货：≥2 个「被回复内容 + 主帖」领域之外的关键词 → 丢弃
              // v27 锚定前剥 [图片] 占位符（防词表污染误杀）
              const anchorCtx = stripImgPh(`${plan.target.content} ${ctx.post.content}`);
              if (offTopicIn(s, anchorCtx)) return '';
              // 锚定校验：必须呼应「被回复的那条 + 主帖」
              if (!commentAnchored(s, anchorCtx)) return '';
              return s;
            })
          : [];
      } catch {
        texts = [];
      }
      const made: ForumPost[] = [];
      ch.forEach((plan, i) => {
        const text = texts[i];
        if (!text) return;
        // 时间：晚于被回复帖 1~40 分钟（下限 +60s 优先，上限不晚于现在）
        const subAt = Math.max(
          plan.target.createdAt + 60_000,
          Math.min(Date.now() - 2_000, plan.target.createdAt + (2 + Math.random() * 38) * 60_000),
        );
        const sub = basePost(
          plan.key,
          text.slice(0, REPLY_MAX),
          ctx.post.community,
          subAt,
          plan.root.id,
          resolveAuthor(plan.target.authorKey).name,
          true,
          { likes: likesOf(plan.target), views: plan.target.views },
        );
        sub.replyToPost = plan.target.id;
        made.push(sub);
      });
      return made;
    }),
  );
  for (const g of groups) out.push(...g);
  return out;
}

/** 给一批一级评论挂「直接回复 1-5 条 + 部分回复再被回复」的楼中楼森林。
 *  层级结构（用户需求：评论下面回复评论 1-5 个人；回复他人下面还要有回复）：
 *  · L2 直接回复评论：每条 1~5 位不同网友（25% 楼主本人下场，其余新面孔/回访）；
 *  · L3 回复某条 L2：约 30% 被回复——45% 由该一级评论的作者出面回应
 *    （别人回复了你的评论，你回一句），12% 楼主，其余围观网友；
 *  · L4 回复某条 L3：约 18% 被回复（同规则：被回复对象出面回应为主）。
 *  逐层落盘（UI 实时长树）；L2 落盘后回调 onAfterDirect——「显示更多评论」
 *  按钮据此提前结束等待，L3/L4 像真实回复一样陆续冒出来。
 *  renameMode：'phase'（L2 落盘前先换 AI 网名——名字首屏即终态）/
 *  'defer'（调用方最后统一换名——种子期多帖并发时省调用）。 */
async function growSubReplyForest(opts: {
  post: ForumPost;
  postAuthorName: string;
  postLang: string;
  mediaDesc: string;
  /** 参与楼中楼的一级评论 */
  targets: ForumPost[];
  /** 本帖已有作者（L2 选人避开；L3/L4 的「被回复者回应」是刻意复用不受此限） */
  existingKeys: AuthorKey[];
  /** 万能句式豁免状态（整批共享 1 条额度） */
  catchall: { ok: boolean; used: boolean };
  /** L2 落盘后回调（前台提前返回用） */
  onAfterDirect?: (direct: ForumPost[]) => void;
  /** 种子期预算压缩（maxDirect：每条评论直接回复 1~max 条；l3/l4 层数上限） */
  budget?: { maxDirect?: number; l3Max?: number; l4Max?: number };
  renameMode?: 'phase' | 'defer';
}): Promise<{ posts: ForumPost[]; newDyn: AuthorKey[] }> {
  const { post, targets } = opts;
  const created: ForumPost[] = [];
  const newDyn: AuthorKey[] = [];
  if (!targets.length) {
    opts.onAfterDirect?.([]);
    return { posts: created, newDyn };
  }
  const dynBefore = new Set(Object.keys(forumData().dynNpcs ?? {}));
  const track = (k: AuthorKey | undefined) => {
    if (!k) return;
    if (k.startsWith('dyn:') && !dynBefore.has(k.slice(4))) newDyn.push(k);
  };
  const ctx = {
    post,
    postAuthorName: opts.postAuthorName,
    postLang: opts.postLang,
    mediaDesc: opts.mediaDesc,
    catchall: opts.catchall,
  };
  const opKey = post.authorKey; // 楼主（user/anon 时不下场——AI 绝不代机主的任何账号说话）
  const ownerCanSpeak = !isUserAuthor(opKey);
  const avoid = new Set<AuthorKey>(opts.existingKeys.filter(Boolean));
  const saveLayer = (made: ForumPost[]) => {
    if (!made.length) return;
    const next = { ...forumData() };
    next.posts.push(...made);
    saveForum(next);
    // v42 补挂 + v43【NPC 记忆系统】：楼中楼里网友说的话也算「在楼主的帖子里说过话」
    // （楼主是用户账号帖时模块内部才落库；金鱼模式零写入）
    made.forEach((s) => {
      noteNpcCommentOnMyPost(post.id, s);
      noteNpcMyComment(s.authorKey, post, s.content);
    });
  };
  const noteRecent = (made: ForumPost[]) => {
    made.forEach((s) => recordDynNpcRecent(s.authorKey, `评论过：${s.content.slice(0, 60)}`));
  };

  // ---- L2：每条一级评论 1~5 位不同网友直接回复 ----
  const maxDirect = opts.budget?.maxDirect ?? 5;
  const l2Plans: SubPlan[] = [];
  for (const c of targets) {
    const n = rollSubCount(maxDirect);
    const usedHere = new Set<AuthorKey>([c.authorKey]); // 同一条评论下绝不重复同一个人
    for (let j = 0; j < n; j++) {
      let key: AuthorKey | undefined;
      if (ownerCanSpeak && Math.random() < 0.25) key = opKey; // 楼主下场回评（X 常态）
      else key = pickCommenters(1, opts.postLang, post.content, ...avoid, ...usedHere)[0];
      if (!key) key = ownerCanSpeak ? opKey : pickCommenters(1, opts.postLang, post.content)[0];
      if (!key) continue; // 实在凑不到人：这条少一个（1-5 本来就有弹性）
      usedHere.add(key);
      track(key);
      l2Plans.push({ target: c, root: c, key });
    }
  }
  let l2: ForumPost[] = [];
  try {
    l2 = await callSubReplyLayer(ctx, l2Plans);
  } catch {
    l2 = [];
  }
  created.push(...l2);
  // L2 新网友先换 AI 网名再上屏（L3 的上下文里也是终名）
  if (opts.renameMode !== 'defer' && newDyn.length) await renameDynNpcsViaLlm([...new Set(newDyn)]);
  saveLayer(l2);
  noteRecent(l2);
  opts.onAfterDirect?.(l2);

  // ---- L3：约 30% 的 L2 被回复（用户需求「回复他人下面还要有回复」） ----
  // 人选：45% 被回复那条所在评论的作者出面（别人回复了你的评论，你回一句）；
  // 12% 楼主；其余围观网友（50% 本楼已有参与者，50% 新面孔）
  const pickDeepKey = (target: ForumPost, root: ForumPost): AuthorKey => {
    const parent = [...created, ...forumData().posts].find((x) => x.id === target.replyToPost);
    if (parent && !isUserAuthor(parent.authorKey) && Math.random() < 0.45) return parent.authorKey;
    if (ownerCanSpeak && Math.random() < 0.12) return opKey;
    const pool = [root.authorKey, ...created.filter((x) => x.replyTo === root.id).map((x) => x.authorKey)].filter(
      (k) => !isUserAuthor(k),
    );
    if (pool.length && Math.random() < 0.5) return pool[Math.floor(Math.random() * pool.length)];
    return pickCommenters(1, opts.postLang, post.content, ...avoid)[0] ?? (ownerCanSpeak ? opKey : 'npc:wang');
  };
  const l3Max = opts.budget?.l3Max ?? Infinity;
  let l3Sel = l2
    .slice()
    .sort(() => Math.random() - 0.5)
    .filter(() => Math.random() < 0.3);
  if (l3Sel.length < Math.min(2, l2.length)) {
    // 保底：这批至少 2 条 L2 被回复（「回复下面还有回复」必须看得见）
    const rest = l2.filter((x) => !l3Sel.includes(x)).sort(() => Math.random() - 0.5);
    while (l3Sel.length < Math.min(2, l2.length) && rest.length) l3Sel.push(rest.pop() as ForumPost);
  }
  l3Sel = l3Sel.slice(0, l3Max);
  const l3Plans: SubPlan[] = l3Sel
    .map((r2) => {
      const root = targets.find((c) => c.id === r2.replyToPost);
      if (!root) return null;
      const key = pickDeepKey(r2, root);
      track(key);
      return { target: r2, root, key };
    })
    .filter((x): x is SubPlan => !!x);
  let l3: ForumPost[] = [];
  try {
    l3 = await callSubReplyLayer(ctx, l3Plans);
  } catch {
    l3 = [];
  }
  created.push(...l3);
  saveLayer(l3);
  noteRecent(l3);

  // ---- L4：约 18% 的 L3 再被回复（同规则：被回复对象出面回应为主） ----
  const l4Max = opts.budget?.l4Max ?? Infinity;
  let l4Sel = l3
    .slice()
    .sort(() => Math.random() - 0.5)
    .filter(() => Math.random() < 0.18);
  if (!l4Sel.length && l3.length) l4Sel = [l3[Math.floor(Math.random() * l3.length)]];
  l4Sel = l4Sel.slice(0, l4Max);
  const l4Plans: SubPlan[] = l4Sel
    .map((r3) => {
      const r2 = l2.find((x) => x.id === r3.replyToPost);
      const root = r2 ? targets.find((c) => c.id === r2.replyToPost) : undefined;
      if (!root) return null;
      const key = pickDeepKey(r3, root);
      track(key);
      return { target: r3, root, key };
    })
    .filter((x): x is SubPlan => !!x);
  let l4: ForumPost[] = [];
  try {
    l4 = await callSubReplyLayer(ctx, l4Plans);
  } catch {
    l4 = [];
  }
  created.push(...l4);
  saveLayer(l4);
  noteRecent(l4);
  return { posts: created, newDyn };
}

/** 生成一批评论并落库（v22：100% LLM 实时生成，无模板兜底）。
 *  仅由「显示更多评论」按钮触发（用户要求：生成完后不再自动生成，
 *  只有用户自己上滑/下滑、点更多评论时才生成）；一次 7~15 条。
 *  LLM 失败/限流时宁缺毋滥（返回 0，评论区维持现状）；万能句式
 *  （蹲后续/保熟/等下文）只有未完结八卦/求助帖豁免且每批最多 1 条。
 *  返回新增评论数（含子回复）。 */
async function genCommentBatch(postId: string, report?: (n: number) => void): Promise<number> {
  if (threadGen.has(postId)) return 0;
  const d0 = forumData();
  const post = d0.posts.find((p) => p.id === postId);
  if (!post) {
    report?.(0);
    return 0;
  }
  const want = rollCommentCount(); // v34：抽屉「每次生成评论」范围（默认 7~15 条）
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
    // v43【NPC 记忆·回访优先】：楼主是用户账号帖（大号/小号）时，「在TA帖下留过言的 NPC」
    // 优先回访（真实论坛里常客就是那几个——NPC 再次出现才接得上「我记得你」的连贯性）。
    // 只替换本批新建的动态网友席位（矩阵/内置/已有回访者不动），最多 40%。金鱼模式名单为空、零替换。
    const posterAccount = accountOfPost(post);
    if (posterAccount) {
      const veterans = npcsWithHistoryOn(posterAccount).filter(
        (k) => !existingKeys.includes(k) && k !== post.authorKey && !commenterKeys.includes(k) && !isUserAuthor(k),
      );
      const n = Math.min(veterans.length, Math.max(1, Math.floor(commenterKeys.length * 0.4)));
      const shuffled = veterans.slice().sort(() => Math.random() - 0.5);
      let vi = 0;
      for (let i = commenterKeys.length - 1; i >= 0 && vi < n; i--) {
        if (commenterKeys[i].startsWith('dyn:')) {
          const v = shuffled[vi++];
          if (v) commenterKeys[i] = v;
        }
      }
    }
    // 本批新建的评论者（LLM 起名目标；池子名只是占位）
    const newDynCommenters = commenterKeys.filter((k) => k.startsWith('dyn:') && !dynBefore.has(k.slice(4)));
    const avoid = threadReplies.slice(-10).map((p) => p.content.slice(0, 40));

    // ---- 顶层评论（v22：100% LLM 实时生成，无模板兜底） ----
    let texts: string[] = [];
    const catchallOk = postAllowsCatchall(post.content); // 万能句式豁免（未完结八卦/求助帖）
    let catchallUsed = false; // 豁免帖每批也最多 1 条万能句式
    // v35：爆料帖磕糖甜评限 1 条（与服务端同口径）
    const scoop = isScoopPost(post.content, mediaDesc) && !isTenderPost(post.content, mediaDesc);
    let sweetUsed = false;
    // v25：称呼串线检测名单（本批评论者网名；服务端已拦，这里双保险）
    const commenterNames = commenterKeys.map((k) => resolveAuthor(k).name);
    try {
      const r = (await callApi({
        kind: 'comments',
        post: { authorName: postAuthor.name, content: post.content, mediaDesc, lang: postLang },
        count: want,
        personas: commenterKeys.map((k) => {
          const a = resolveAuthor(k);
          // 【多世界观】矩阵 NPC：persona 含【身份】【性格】【口头禅】——
          // 服务端按「必须完全代入」渲染（不再是普通网友的「只学语气」降级）
          // v43【NPC 记忆】：这位网友在楼主帖下留过的言（单行；金鱼/无史/非用户帖 → 缺省零注入）
          const npcMem = npcMyHistoryLine(k, post);
          return {
            name: a.name,
            persona: a.persona || '普通论坛网友',
            lang: a.lang ?? 'zh-Hans',
            ...(k.startsWith('mnpc:') ? { matrix: true } : {}),
            ...(npcMem ? { npcHistory: npcMem } : {}),
          };
        }),
        avoid,
        // v43【NPC 记忆】：楼主过往发过的帖（整批背景——「楼主终于走出来了」的素材；金鱼 → 空串）
        posterHistory: posterHistoryBlock(post),
        userName: resolveAuthor('user').name,
      })) as { items?: string[] };
      texts = Array.isArray(r.items)
        ? (r.items as unknown[])
            .map((x) => {
              if (typeof x !== 'string') return '';
              const s = sanitizeCommentClient(stripReplyPrefixClient(x));
              // 用户规范：评论 3~100 字（留 10 字容差；过短/过长都是废稿）
              if (s.trim().length < 3 || s.length > 110) return '';
              if (postLang === 'zh-Hans' && foreignDominantClient(s)) return '';
              // v35 第一道闸：JSON 残留（{"thought":…}）/ 指令泄露（【本帖核心话题词…】）→ 丢弃
              if (jsonLeakIn(s) || promptLeakIn(s)) return '';
              // v22 万能句式：非豁免帖一律丢弃；豁免帖最多 1 条
              if (universalPhraseIn(s)) {
                if (!catchallOk || catchallUsed) return '';
                catchallUsed = true;
              }
              // v28 走心帖：聒噪烂梗（锁死/放毒/笑死/xswl…）→ 语境错乱丢弃（与服务端双保险）
              if (isTenderPost(post.content, mediaDesc) && loudMemeIn(s)) return '';
              // v35 爆料帖：磕糖甜评（好甜/好稳/锁死）超 1 条 → 丢弃
              if (scoop && sweetShipIn(s)) {
                if (sweetUsed) return '';
                sweetUsed = true;
              }
              // v35 跨批次去重：与本帖已有评论整句级重合（换皮复读）→ 丢弃
              if (threadReplies.some((tp) => isParrotReply(s, tp.content))) return '';
              // v25 称呼/名称串线：屿哥（拿评论者网名拼称呼）/自称网名 → 丢弃
              if (personaBleedIn(s, postAuthor.name, commenterNames)) return '';
              // v25 领域私货：≥2 个主帖领域之外的关键词（剧+特调混进保研帖）→ 丢弃
              // v27 锚定前剥 [图片] 占位符（防词表污染误杀）
              const anchorPost = stripImgPh(post.content);
              if (offTopicIn(s, anchorPost)) return '';
              // v14 锚定校验：串台/AI 废话直接丢弃（与服务端双保险）
              // v43【NPC 记忆】：锚定语料并入楼主历史帖正文（NPC 提旧事也能过校验；
              // 串台检测仍只看当前帖——旧帖不算私货）
              const anchorAll = posterHistoryRaw(post) ? `${anchorPost} ${posterHistoryRaw(post)}` : anchorPost;
              if (!commentAnchored(s, anchorAll)) return '';
              return s;
            })
            .filter(Boolean)
        : [];
    } catch {
      // v22：LLM 失败（限流/断网）→ 宁缺毋滥，不铺任何模板
      texts = [];
    }
    // v35：批内一级评论互相复读（同措辞换网名）→ 只保留首条（与服务端同口径双保险）
    if (texts.length > 1) {
      const keptC: string[] = [];
      texts = texts.filter((s) => {
        if (keptC.some((k) => isParrotReply(s, k))) return false;
        keptC.push(s);
        return true;
      });
    }
    if (!texts.length) {
      // v26：report 必须在每条退出路径上给到（否则前台 Promise 悬挂）
      report?.(0);
      return 0;
    }

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
      // 人设连通性：记录动态网友最近评论过的内容（下次发帖/评论能接上话）
      recordDynNpcRecent(authorKey, `评论过：${t.slice(0, 60)}`);
      // v42 补挂：用户帖点「显示更多评论」生成的网友评论也入「某NPC在我的帖子里说了什么」
      // （非用户帖在两模块内部均无副作用）
      noteNpcCommentOnMyPost(post.id, c);
      // v43【NPC 记忆系统】：这些网友记住「我在楼主的这篇帖下说了这句话」
      noteNpcMyComment(authorKey, post, t);
    });

    // ---- v26 楼中楼森林：每条新评论 1-5 位不同网友直接回复；部分回复再被回复 ----
    // （3/4 层嵌套，回复他人下面还有回复）。逐层落盘实时上屏；L2 完成后通过
    // report 提前返回——L3/L4 由森林内部继续（像真实回复一样陆续冒出来）。

    // 楼主是用户（大号/小号） → 前 3 条评论发通知（X：别人回复了你的帖子）
    if (isUserAuthor(post.authorKey)) {
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
    // v26：一级评论先上屏（楼中楼还在路上——真实 thread 里回复本来就有先后）
    saveForum(next);

    const forest = await growSubReplyForest({
      post,
      postAuthorName: postAuthor.name,
      postLang,
      mediaDesc,
      targets: newComments,
      existingKeys: [post.authorKey, ...existingKeys, ...commenterKeys],
      catchall: { ok: catchallOk, used: catchallUsed },
      onAfterDirect: (direct) => report?.(newComments.length + direct.length),
    });
    return newComments.length + forest.posts.length;
  } catch {
    report?.(0);
    return 0;
  } finally {
    // 森林全部长完才解锁（前台已提前返回；长树期间再点按钮会提示稍后再试）
    threadGen.delete(postId);
  }
}

/** 「更多评论」按钮：再生成 7~15 条一级评论 + 楼中楼森林（v26：每条评论
 *  1-5 位不同网友回复、部分回复再被回复）。前台只等一级评论 + 直接回复（L2）
 *  ——L3/L4 像真实回复一样陆续冒出来（分层数据逐层落盘，UI 实时长树）。
 *  用户要求：仅按钮触发，打开帖子不自动补。返回前台可见新增数。 */
export async function generateMoreComments(postId: string): Promise<number> {
  if (threadGen.has(postId)) return 0;
  return new Promise<number>((resolve) => {
    let settled = false;
    const settle = (n: number) => {
      if (settled) return;
      settled = true;
      resolve(n);
    };
    void genCommentBatch(postId, (n) => settle(n)).catch(() => settle(0));
  });
}

// ---------------- 【AI 真人社交】角色社交（人设+记忆+情绪驱动） ----------------

/** 角色社交延迟（用户要求：不要秒回——模拟真人，延迟几分钟甚至几小时）。
 *  全部落在分钟~小时量级；动态网友（背景音）保持秒级~分钟级。 */
const CHAR_DELAY = {
  /** 首次激活后的第一帖（角色「入驻」论坛，几分钟内能刷到） */
  firstPost: () => 90_000 + Math.random() * 330_000, // 1.5~7 分钟
  /** 常规主动发帖间隔 */
  postInterval: () => (30 + Math.random() * 240) * 60_000, // 0.5~4.5 小时
  /** 角色刷到用户帖子后的反应延迟（i = 第几位角色，彼此错开） */
  engage: (i: number) => 60_000 + Math.random() * 840_000 + i * (120_000 + Math.random() * 300_000), // 1~15 分钟+错开
  /** 神回复延迟（你评论了 TA，TA 过几分钟才回你） */
  godReply: () => 45_000 + Math.random() * 225_000, // 0.75~5 分钟
  /** 被点赞后来评论区回一句（低概率触发时的延迟） */
  thanks: () => 120_000 + Math.random() * 480_000, // 2~10 分钟
  /** 角色帖子收到的网友点赞（i = 第几个网友） */
  netLike: (i: number) => 12_000 + Math.random() * 168_000 + i * 25_000, // 12 秒~3 分钟
  /** 角色帖子收到的网友评论（i = 第几条） */
  netComment: (i: number) => 45_000 + Math.random() * 315_000 + i * (90_000 + Math.random() * 180_000), // 45 秒~6 分钟
};

/** 活跃度开关是否打开（缺省开） */
function aiActivityOn(): boolean {
  return forumData().aiActivity !== false;
}

/** 抽屉「AI 活跃度」开关：开 → 重置各角色排程（几分钟内开始发帖）；
 *  关 → 不再排新主动帖（存量任务执行时顺延不丢——v41 B5；神回复不受影响）。
 *  v41（A6）：重开时错峰——firstPost 随机 + 按序错开，不再全部挤在同一分钟段；
 *  lastPostAt 保留（不重置历史节奏，也不多等一个完整周期）。 */
export function setForumAiActivity(on: boolean): void {
  mutateForum((d) => {
    d.aiActivity = on;
    if (on) {
      const soc: NonNullable<ForumData['charSocial']> = { ...(d.charSocial ?? {}) };
      forumCharBriefs().forEach((b, i) => {
        soc[b.contactId] = {
          lastPostAt: soc[b.contactId]?.lastPostAt ?? 0,
          nextPostAt: Date.now() + CHAR_DELAY.firstPost() + i * (120_000 + Math.random() * 300_000),
        };
      });
      d.charSocial = soc;
    }
  });
  if (on) {
    // v41（B5）：挂起（顺延中）的 charPost 任务拉回近期执行——开关重开即恢复节奏，
    // 而不是等到顺延的 due（可能远在 12 小时后）
    const pend = loadPending();
    let j = 0;
    for (const job of Object.values(pend)) {
      if (job.kind === 'charPost' && job.due > Date.now()) {
        pend[job.id] = { ...job, due: Date.now() + CHAR_DELAY.firstPost() + j * 90_000 };
        j++;
      }
    }
    if (j) savePending(pend);
  }
  runPending();
}

/** ForumScheduler 心跳（App 不打开也照常调度）：
 *  1. runPending 重挂到期任务（远期任务进入 90s 窗口时自动上 timer）；
 *  2. 活跃度开 → 窗口到期的角色按节奏排「主动发帖」任务（人设+记忆+情绪+今日事件）。
 *  v41（A1+A2）：
 *  - 全员参与轮换——窗口到期的角色进加权抽签，每拍最多排 2 个发帖任务
 *    （旧的「发帖数前 6 」截断会让圈外角色永远轮不到）；
 *  - 发帖间隔记账修复：窗口到期 → 短键的酝酿延迟后发帖，间隔一次性算清
 *    （旧版 due = now + interval 再 + interval 记账，0.5~4.5h 实际跑成 1~9h）。 */
export async function tickForumSocial(): Promise<void> {
  try {
    const d = forumData();
    if (!d.seeded) return; // 论坛从未打开过：不强制播种（首次打开 App 时 ensureSeed）
    if (!forumContactsSnap().length) await refreshForumAuthors(); // 角色快照兜底
    runPending();
    if (!aiActivityOn()) return;
    const briefs = forumCharBriefs(); // v41（A1）：全部角色（不再截断前 6）
    if (!briefs.length) return;
    const pend = loadPending();
    const hasJob = (key: string) => Object.values(pend).some((j) => j.kind === 'charPost' && j.meta.charKey === key);
    const now = Date.now();
    // 窗口到期的候选（含从未排过的；已排队的不重复排）
    const due = briefs.filter((b) => {
      const st = d.charSocial?.[b.contactId];
      return !(st?.nextPostAt && st.nextPostAt > now) && !hasJob(b.key);
    });
    if (!due.length) return;
    // v41（A1+B1）：加权抽签每拍最多排 2 位（熟悉度+活跃度+噪声+冷却轮换）——
    // 高频小圈子 → 低频全员轮换，人人都有发帖窗口
    const winners = pickCharsWeighted(2, due);
    if (!winners.length) return;
    const soc: NonNullable<ForumData['charSocial']> = { ...(forumData().charSocial ?? {}) };
    let changed = false;
    winners.forEach((b, i) => {
      const st = d.charSocial?.[b.contactId];
      const first = !st?.lastPostAt && !b.postCount;
      // v41（A2）：窗口到期后的酝酿延迟（3 秒~12 分钟——「今天想起来要发帖」），
      // 发帖间隔在记账时一次算清：nextPostAt = 发帖时刻 + 新间隔
      const delay = first
        ? CHAR_DELAY.firstPost() + i * (120_000 + Math.random() * 180_000)
        : 3_000 + Math.random() * 12 * 60_000;
      const at = now + delay;
      addPending({ id: uid('j'), due: at, kind: 'charPost', postKey: b.key, meta: { charKey: b.key } });
      soc[b.contactId] = {
        lastPostAt: st?.lastPostAt ?? 0,
        nextPostAt: at + CHAR_DELAY.postInterval(),
      };
      changed = true;
    });
    if (changed) {
      // v41（A5）：合并式落盘——以最新快照为底，只覆盖本轮改动的角色条目
      //（旧版整表覆盖会吞掉执行期间 charPost 任务写入的 lastPostAt）
      mutateForum((latest) => {
        const merged = { ...(latest.charSocial ?? {}) };
        for (const [cid, st] of Object.entries(soc)) {
          merged[cid] = { ...(merged[cid] ?? {}), ...st };
        }
        latest.charSocial = merged;
      });
    }
  } catch {
    /* 心跳失败静默 */
  }
}

/** 用户发帖后：每位论坛角色独立排队「看到帖子 → 决定点赞/评论」（延迟分钟级、彼此错开）。
 *  决策由 LLM 在任务执行时做（要不要赞、要不要评论、评论写什么——针对帖子具体内容）。
 *  v41（A1+B1）：不再固定「发帖数前 4」——加权随机抽 2~4 位轮换
 *  （熟悉度+活跃度+噪声），单角色 8h 冷却不重复；首位仍最错峰。 */
export function queueCharEngagements(post: ForumPost): void {
  try {
    if (!aiActivityOn()) return;
    const briefs = pickCharsWeighted(2 + Math.floor(Math.random() * 3)); // 2~4 位轮换
    briefs.forEach((b, i) => {
      noteCharEngaged(b.contactId);
      addPending({
        id: uid('j'),
        due: Date.now() + CHAR_DELAY.engage(i),
        kind: 'charEngage',
        postKey: post.id,
        meta: { charKey: b.key, parentContent: post.content.slice(0, 200) },
      });
    });
    if (briefs.length) runPending();
  } catch {
    /* 静默 */
  }
}

/** 角色帖子发布后：安排虚拟网友点赞 + 0~2 条评论（真实网友规则；秒级~分钟级到达）。
 *  评论走既有 replyToUserPost 管线（完整上下文 + 校验链 + 宁缺毋滥）。
 *  v41：B2——点赞改持久 pending 任务（关页面不再丢，重开补发）；
 *  B4——道具型 NPC（站姐/浪姐/绿茶）滤出点赞名单，评论者不与首位点赞者重复；
 *  A4——角色帖的网友点赞/评论不再给机主发「赞了你的帖子/回复了你」通知
 *  （帖子不是你发的，误归因）。 */
function queueNetizenReactionsToCharPost(post: ForumPost): void {
  const next0 = forumData();
  const likers: AuthorKey[] = [];
  const npcCount = 1 + Math.floor(Math.random() * 2);
  // v41（B4）：道具型 NPC 滤出（人设自带代言品牌/剧名/粉丝称呼，去点赞别人帖易串线）
  NPC_DEFS.slice()
    .filter((n) => !POSTER_ONLY_NPCS.has(n.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, npcCount)
    .forEach((l) => likers.push(`npc:${l.id}`));
  while (likers.length < 2 + Math.floor(Math.random() * 3)) likers.push(createDynNpc());
  void renameDynNpcsViaLlm(likers.filter((k) => k.startsWith('dyn:')));
  // v41（B2）：点赞改持久任务分批陆续到达（不是同一瞬间齐刷刷；关页面不丢）
  likers.forEach((k, i) => {
    addPending({
      id: uid('j'),
      due: Date.now() + CHAR_DELAY.netLike(i),
      kind: 'netLike',
      postKey: post.id,
      meta: { authorKey: k, notify: false }, // A4：角色帖不通知机主
    });
  });
  const replyCount = Math.random() < 0.8 ? 1 + (Math.random() < 0.4 ? 1 : 0) : 0;
  // v41（B4）：评论者不与首位点赞者重复（同一人发两条）；从点赞名单里
  // 挑没用过的，还不够就新建动态网友
  const usedCommenters = new Set<AuthorKey>();
  for (let i = 0; i < replyCount; i++) {
    let commenter = likers[npcCount + i];
    if (!commenter || usedCommenters.has(commenter)) {
      commenter =
        likers.find((k) => !usedCommenters.has(k) && k !== likers[0]) ?? createDynNpc();
    }
    usedCommenters.add(commenter);
    addPending({
      id: uid('j'),
      due: Date.now() + CHAR_DELAY.netComment(i),
      kind: 'replyToUserPost',
      postKey: post.id,
      meta: { authorKey: commenter, parentContent: post.content },
    });
  }
  saveForum({ ...next0 });
  runPending();
}

/** 用户给角色的帖子点赞后（forum.tsx likeToggle 调用）：低概率角色来评论区回一句
 *  （「看到你给我点赞啦」式轻互动，可能返回空 = 选择不打扰）。
 *  v41（B3）：持久致谢标记——同帖只致谢一次（快速赞↔取消↔再赞不叠加双份）；
 *  排队去重仍在（在队任务不重复排）。 */
export function queueCharThanksForLike(post: ForumPost): void {
  try {
    if (!aiActivityOn() || !post.authorKey.startsWith('char:')) return;
    const contactId = post.authorKey.slice(5);
    // v41（B3）：已致谢过的帖子不再排致谢任务（持久标记在记忆库里）
    if (memHasForumFragment(contactId, post.id, 'like-thanks')) return;
    if (Math.random() > 0.3) return; // 30% 概率：真人也不会每次都回
    // 去重：同帖已有致谢任务排队时不重复排（点赞↔取消↔再点赞不叠加）
    const pend = loadPending();
    const dup = Object.values(pend).some((j) => j.kind === 'charReply' && j.meta.thanks && j.postKey === post.id);
    if (dup) return;
    addPending({
      id: uid('j'),
      due: Date.now() + CHAR_DELAY.thanks(),
      kind: 'charReply',
      postKey: post.id,
      meta: { charKey: post.authorKey, thanks: true, rootId: post.id, mainPostId: post.id },
    });
    runPending();
  } catch {
    /* 静默 */
  }
}

// ---------------- 用户发帖 → NPC/char 互动 ----------------

/** 用户发布帖子后调用：延迟点赞 + 0~2 条 AI 回复（持久 pending）。
 *  互动者也以动态真实感网友为主（点赞/回帖名单不重复）。
 *  v33【真人节奏】：点赞 15~90 秒陆续到达、评论 45 秒~5 分钟错开——不秒回；
 *  char 好友的点赞/评论改由 queueCharEngagements 独立管线（分钟级延迟 + LLM 决策）。
 *  v41（B2）：点赞改持久 pending 任务（关页面不丢，重开补发）；
 *  v41（B4）：道具型 NPC 滤出点赞名单；评论者不与首位点赞者重复。 */
export function queueUserPostInteractions(post: ForumPost): void {
  const next0 = forumData();
  // 点赞名单：动态网友 + 矩阵阵容/内置 NPC 混合（3~5 位，不再全是老面孔）。
  // 【多世界观】矩阵 NPC 优先光顾用户帖（核心阵容是这个世界的原住民）
  const likers: AuthorKey[] = [];
  const cast = matrixCast();
  if (cast.length) {
    cast.slice().sort(() => Math.random() - 0.5).slice(0, 2).forEach((c) => likers.push(c.key));
  }
  let npcCount = likers.length;
  if (!cast.length) {
    npcCount = 1 + Math.floor(Math.random() * 2);
    // v41（B4）：道具型 NPC 滤出（串线重灾区）
    NPC_DEFS.slice()
      .filter((n) => !POSTER_ONLY_NPCS.has(n.id))
      .sort(() => Math.random() - 0.5)
      .slice(0, npcCount)
      .forEach((l) => likers.push(`npc:${l.id}`));
  }
  while (likers.length < 3 + Math.floor(Math.random() * 3)) likers.push(createDynNpc());
  // LLM 起名：新建的点赞网友换 AI 生成的网名（通知/主页里都是 AI 起的名；失败保留占位名）
  void renameDynNpcsViaLlm(likers.filter((k) => k.startsWith('dyn:')));
  // v41（B2）：点赞改持久任务陆续到达（15~90s，真人刷到帖子的反应速度；首位带通知）
  likers.forEach((k, i) => {
    addPending({
      id: uid('j'),
      due: Date.now() + 15_000 + Math.random() * 75_000 + i * 9000,
      kind: 'netLike',
      postKey: post.id,
      meta: { authorKey: k, notify: i === 0 },
    });
  });
  const replyCount = Math.random() < 0.75 ? 1 + (Math.random() < 0.35 ? 1 : 0) : 0;
  // v41（B4）：评论者兜底不再直接回退 likers[0]（同一人发两条）——
  // 名单里没用过的优先，否则新建动态网友
  const usedCommenters = new Set<AuthorKey>();
  for (let i = 0; i < replyCount; i++) {
    let fallback = likers[npcCount + i];
    if (!fallback || usedCommenters.has(fallback)) {
      fallback = likers.find((k) => !usedCommenters.has(k)) ?? createDynNpc();
    }
    usedCommenters.add(fallback);
    addPending({
      id: uid('j'),
      due: Date.now() + 45_000 + Math.random() * 270_000 + i * (60_000 + Math.random() * 150_000),
      kind: 'replyToUserPost',
      postKey: post.id,
      // 回帖者：【多世界观】矩阵 NPC 高概率出场（身份鲜明的神回复）；
      // 否则动态网友新面孔来搭讪
      meta: {
        authorKey:
          cast.length && Math.random() < 0.6
            ? cast[Math.floor(Math.random() * cast.length)].key
            : fallback,
        parentContent: post.content,
      },
    });
  }
  // 立即落盘新建的动态网友（点赞名单先持久化，不等延时任务）
  saveForum({ ...next0 });
  runPending();
}

/** 用户回复某帖/某条评论（thread 页）后调用：排 1-5 位网友回复用户。
 *  v26（用户需求：我回复一个人以后，网友知道我回复的什么，网友可以回复我
 *  1-5 个人）：
 *  · 被回复者 85% 在场（你回复了 TA，TA 大概率回你），排第一个；
 *  · 围观网友补足人数——本楼已有参与者（正在跟这层楼的人）+ 新面孔，
 *    到达时间彼此错开（真实 thread 里「有人回复你，别人也凑热闹」）；
 *  · 每位网友接话前都拿到完整上下文：主帖 + 用户回复的那条评论
 *    （「我回复的什么」）+ 用户这条回复 + 整楼最近的对话链（execJob 组装）。
 *  targetPostId = 实际被回复的那条（主帖或某条评论/子回复）；
 *  rootId = 分组锚点（顶层评论 id 或主帖 id）→ AI 的回复挂在这一层显示；
 *  mainPostId = 主帖 id（LLM 上下文用）。
 *  无限多轮：用户再回复任何一条 → 再排一批。 */
export function queueAiReplyToUserReply(targetPostId: string, userReplyId: string, rootId?: string, mainPostId?: string): void {
  const d = forumData();
  const target = d.posts.find((p) => p.id === targetPostId);
  if (!target || isUserAuthor(target.authorKey)) return;
  const userReplyPost = d.posts.find((p) => p.id === userReplyId);
  if (!userReplyPost) return;
  // 匿名认知隔离：机主用小号评论 → 角色不排「神回复」（那是对「熟人的 TA」的专属反应，
  // 对陌生网友的评论 AI 角色不会特意回）；围观网友照常接话（看到的就是陌生网友发言）。
  const replyFromAnon = userReplyPost.authorKey === ANON_KEY;
  const groupId = rootId ?? targetPostId;
  const mainId = mainPostId ?? (rootId && rootId !== targetPostId ? rootId : targetPostId);
  // v33【AI 真人社交·神回复保证】：被回复对象是 char（AI 角色）时，TA 本人必须延迟几分钟
  // 回复用户（带人设+对用户的记忆+完整对话链——queueUserPostInteractions 式秒赞已废除）。
  // 神回复不受活跃度开关限制（那是 TA 的「社交礼仪」，不是主动行为）。
  const charTarget = target.authorKey.startsWith('char:') ? target.authorKey : null;
  if (charTarget && !replyFromAnon) {
    const pend = loadPending();
    const dup = Object.values(pend).some(
      (j) => j.kind === 'charReply' && !j.meta.thanks && j.meta.userReplyId === userReplyId,
    );
    if (!dup) {
      addPending({
        id: uid('j'),
        due: Date.now() + CHAR_DELAY.godReply(),
        kind: 'charReply',
        postKey: targetPostId,
        meta: { charKey: charTarget, rootId: groupId, mainPostId: mainId, userReplyId },
      });
    }
  }
  // v26 总人数 1-5：被回复者 85% 在场；围观网友 = 本楼已有参与者 + 新面孔
  const total = 1 + Math.floor(Math.random() * 5); // 1~5
  const picked: AuthorKey[] = [];
  const pickedSet = new Set<AuthorKey>();
  const addPick = (k: AuthorKey | undefined) => {
    if (!k || isUserAuthor(k) || pickedSet.has(k)) return;
    // char 已有专属神回复管线，不再进通用网友池（防同一角色双回复）
    if (charTarget && k.startsWith('char:')) return;
    picked.push(k);
    pickedSet.add(k);
  };
  if (Math.random() < 0.85 && !charTarget) addPick(target.authorKey); // 你回复了 TA，TA 大概率回你
  // 本楼已有参与者（分组锚点下的其他 AI 作者——正在看这层楼的人）
  const threadKeys = d.posts
    .filter((p) => p.replyTo === groupId && p.id !== userReplyId && p.id !== targetPostId)
    .map((p) => p.authorKey)
    .filter((k) => k !== 'user');
  let guard = 0;
  while (picked.length < total && guard++ < total * 6) {
    const pool = threadKeys.filter((k) => !pickedSet.has(k));
    if (pool.length && Math.random() < 0.5) {
      addPick(pool[Math.floor(Math.random() * pool.length)]);
      continue;
    }
    addPick(pickCommenters(1, undefined, undefined, ...picked)[0]);
  }
  if (!picked.length) {
    // 兜底：至少被回复者回一句（char 已有专属神回复管线，无需网友兜底）
    if (!charTarget) addPick(target.authorKey);
  }
  if (!picked.length) return;
  picked.forEach((k, idx) => {
    // 被回复者先回（5~15s）；围观网友陆续（每位再错开 6~20s；封顶 80s
    // ——pending 执行器只挂 90s 内的任务，晚了要等下次触发点才补挂）
    const due = Date.now() + 5000 + Math.random() * 10000 + idx * (6000 + Math.random() * 14000);
    addPending({
      id: uid('j'),
      due: Math.min(due, Date.now() + 80_000),
      kind: 'aiReplyBack',
      postKey: targetPostId,
      meta: {
        authorKey: k,
        parentContent: target.content,
        rootId: groupId,
        mainPostId: mainId,
        userReplyId,
      },
    });
  });
  // 新围观网友换 AI 网名（回复发出前后均可——显示名动态解析，落盘即刷新）
  const freshDyn = picked.filter((k) => k.startsWith('dyn:'));
  if (freshDyn.length) void renameDynNpcsViaLlm(freshDyn);
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
    // ================= 【AI 真人社交】角色任务 =================

    // v41（B5）：活跃度开关关着时主动类任务不丢——顺延 12h 重排队
    //（开关重开时 setForumAiActivity 会把挂起任务拉回近期）；
    // 神回复/网友回复/点赞不受开关限制，照常执行
    if ((job.kind === 'charPost' || job.kind === 'charEngage') && !aiActivityOn()) {
      addPending({ ...job, due: Date.now() + 12 * 3600_000 });
      return;
    }

    // v41（B2）：网友点赞（持久任务版——关页面不丢，执行时原子改写）
    if (job.kind === 'netLike') {
      const k = job.meta.authorKey;
      if (!k) return;
      mutateForum((next) => {
        const p = next.posts.find((x) => x.id === job.postKey);
        if (!p) return;
        p.likes = [...new Set([...p.likes, k])];
        // v41（A4）：只有用户自己的帖子（大号/小号）才发「赞了你的帖子」通知
        //（角色帖的网友点赞不再误归因给机主）
        if (job.meta.notify && isUserAuthor(p.authorKey)) {
          next.notifications = [
            { id: uid('n'), type: 'like' as const, fromKey: k, postId: p.id, createdAt: Date.now(), read: false },
            ...next.notifications,
          ];
        }
      });
      return;
    }

    if (job.kind === 'charPost') {
      // 角色主动发帖：人设+情绪+对用户的记忆+今日事件素材+用户最近帖子 → 一条完全「TA 本人」的帖子
      const charKey = (job.meta.charKey ?? job.postKey) as AuthorKey;
      const brief = forumCharBriefs().find((b) => b.key === charKey);
      if (!brief) return;
      const userName = resolveAuthor('user').name;
      let content = '';
      let textImage = '';
      try {
        const r = (await callApi({
          kind: 'charPost',
          char: {
            name: brief.contact.nickname || brief.contact.name,
            persona: charPersonaCard(brief.contact),
            relation: charRelationLine(brief.contact),
            mood: charMoodBlock(brief.contactId),
            memory: charMemoryDigest(brief.contactId),
            recent: charRecentPosts(charKey, 2).map((p) => p.content.slice(0, 60)),
          },
          userPosts: userPostsDigest(),
          // v41（B7）：当日事件日内一致性——同一角色同一天固定拿同一组素材
          //（不再「上午加班到九点、下午去了健身房」自相矛盾）
          events: dailyEventsFor(charKey, 2),
          userName,
        })) as { content?: string; textImage?: string };
        content = typeof r.content === 'string' ? r.content.trim() : '';
        textImage = typeof r.textImage === 'string' ? r.textImage.trim().slice(0, 110) : '';
        // 客户端兜底：长度下限（服务端已按四档严校验）；占位符缺失时不配图
        if (content && (content.length < 10 || content.length > POST_MAX)) content = '';
        if (content && !content.includes(IMG_PLACEHOLDER)) textImage = '';
      } catch {
        content = '';
      }
      if (!content) return; // 宁缺毋滥：人设帖 LLM 失败不落模板垃圾帖
      const next = { ...forumData() };
      // organic=false：新帖从零热度起步（网友反应会陆续带来真实点赞），不预支百万热度
      const post = basePost(charKey, content.slice(0, POST_MAX), null, Date.now(), undefined, undefined, false);
      const imgCount = { n: 0 };
      attachTextImage(post, textImage, imgCount);
      next.posts.push(post);
      const soc = { ...(next.charSocial ?? {}) };
      soc[brief.contactId] = { ...(soc[brief.contactId] ?? {}), lastPostAt: post.createdAt };
      next.charSocial = soc;
      saveForum(next);
      // 发帖后：网友按真实网友规则来互动（点赞陆续 + 0~2 条评论）
      queueNetizenReactionsToCharPost(post);
      // 记忆写入：「我今天在X论坛发了帖子……」（下次私聊能自然提起）
      writeCharOwnPostMemory(brief.contactId, post);
      return;
    }

    if (job.kind === 'charEngage') {
      // 角色刷到了用户的帖子：LLM 决定要不要点赞/评论（评论必须针对帖子具体内容）
      const d0 = forumData();
      const post = d0.posts.find((x) => x.id === job.postKey);
      if (!post || post.authorKey !== 'user') return;
      const charKey = job.meta.charKey ?? '';
      const brief = forumCharBriefs().find((b) => b.key === charKey);
      if (!brief) return;
      const userName = resolveAuthor('user').name;
      const mediaDesc = await describePostMedia(post.media);
      // v41（B8）：语言跟随帖子（中文帖才拒整句外语；外语帖不再误杀）
      const postLang = detectPostLang(post.content);
      let like = false;
      let comment = '';
      try {
        const r = (await callApi({
          kind: 'charEngage',
          char: {
            name: brief.contact.nickname || brief.contact.name,
            persona: charPersonaCard(brief.contact),
            relation: charRelationLine(brief.contact),
            mood: charMoodBlock(brief.contactId),
            memory: charMemoryDigest(brief.contactId),
          },
          // v41（B8）：postLang 随请求上送（服务端语言校验跟随帖子，不再写死中文）
          post: { content: post.content.slice(0, 600), mediaDesc, lang: postLang },
          userName,
        })) as { like?: boolean; comment?: string };
        like = r.like === true;
        comment = typeof r.comment === 'string' ? sanitizeCommentClient(stripReplyPrefixClient(r.comment)) : '';
        // 双保险：15~150 字 + 必须锚定帖子具体内容（禁「沙发/支持」式空评）
        if (comment && (comment.length < 15 || comment.length > 150)) comment = '';
        // v35：JSON 残留 / 指令泄露 → 作废（角色评论不能把 thought 字段吐出来）
        if (comment && (jsonLeakIn(comment) || promptLeakIn(comment))) comment = '';
        if (comment && !commentAnchored(comment, stripImgPh(post.content))) comment = '';
      } catch {
        like = false;
        comment = '';
      }
      if (!like && !comment) return; // AI 决定不互动（真人也不是每条都理）
      const next = { ...forumData() };
      const target = next.posts.find((x) => x.id === post.id);
      if (!target) return;
      if (like && !target.likes.includes(charKey)) {
        target.likes = [...target.likes, charKey];
        next.notifications = [
          { id: uid('n'), type: 'like' as const, fromKey: charKey, postId: post.id, createdAt: Date.now(), read: false },
          ...next.notifications,
        ];
      }
      if (comment) {
        const reply = basePost(
          charKey,
          comment.slice(0, REPLY_MAX),
          target.community,
          Date.now(),
          target.id,
          userName,
          true,
          { likes: likesOf(target), views: target.views },
        );
        next.posts.push(reply);
        // v42【帖子记忆】：角色评论了用户的帖 → 「某NPC在我的哪个帖子里说了什么」入库
        noteNpcCommentOnMyPost(target.id, reply);
        // v43【NPC 记忆系统】：角色也记「我在TA帖下说过这句」（下次逛到TA新帖态度可延续）
        noteNpcMyComment(charKey, post, comment);
        next.notifications = [
          { id: uid('n'), type: 'reply' as const, fromKey: charKey, postId: reply.id, createdAt: Date.now(), read: false },
          ...next.notifications,
        ];
      }
      saveForum(next);
      // 记忆写入：「我给TA的帖子点了赞/我在TA的帖子下评论了……」
      writeCharEngageMemory(brief.contactId, { post, liked: like, comment: comment || undefined });
      // v41（D3）：角色在评论区互动过后，低概率跨 App 主动来私聊——
      //「刚在论坛看到你发的帖子」的自然开话；只在互动成功（赞/评）时触发
      if (like || comment) void maybeCrossAppPing(brief, post, comment);
      return;
    }

    if (job.kind === 'charReply') {
      // 神回复：用户评论了角色的帖子/评论 → 角色本人带人设+记忆+对话链回复；
      // thanks 模式：用户只是点了赞 → 角色低概率来评论区回一句（可返回空=不打扰）
      const d0 = forumData();
      const charKey = job.meta.charKey ?? '';
      const brief = forumCharBriefs().find((b) => b.key === charKey);
      if (!brief) return;
      const thanks = job.meta.thanks === true;
      if (thanks && !aiActivityOn()) return;
      const mainId = job.meta.mainPostId ?? job.meta.rootId ?? job.postKey;
      const mainPost = d0.posts.find((p) => p.id === mainId);
      if (!mainPost) return;
      if (thanks && !mainPost.likes.includes('user')) return; // 用户已取消点赞→不打扰
      const groupId = job.meta.rootId ?? mainId;
      const userReply = job.meta.userReplyId ? d0.posts.find((p) => p.id === job.meta.userReplyId) : null;
      const userName = resolveAuthor('user').name;
      // 整楼对话链（最近 6 条带说话人名——神回复要接得住前面的梗）。
      // isUserAuthor：机主大号/匿名小号的评论都在「user 侧」，但 speaker 用各自账号
      // 的昵称（匿名评论对 AI 就是一个陌生网友在说话）
      const history = d0.posts
        .filter((p) => p.replyTo === groupId && p.id !== job.meta.userReplyId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-6)
        .map((p) => ({
          from: isUserAuthor(p.authorKey) ? ('user' as const) : ('peer' as const),
          speaker: resolveAuthor(p.authorKey).name,
          text: p.content,
        }));
      const mediaDesc = await describePostMedia(mainPost.media);
      // v41（B8）：语言跟随主帖（服务端校验用；中文帖才拒整句外语）
      const postLang = detectPostLang(mainPost.content, resolveAuthor(mainPost.authorKey).lang);
      let text = '';
      try {
        const r = (await callApi({
          kind: 'charReply',
          char: {
            name: brief.contact.nickname || brief.contact.name,
            persona: charPersonaCard(brief.contact),
            relation: charRelationLine(brief.contact),
            mood: charMoodBlock(brief.contactId),
            memory: charMemoryDigest(brief.contactId),
          },
          postContent: mainPost.content.slice(0, 1000),
          postAuthor: resolveAuthor(mainPost.authorKey).name,
          userComment: thanks ? '' : (userReply?.content ?? ''),
          history,
          mediaDesc,
          thanks,
          postLang,
          userName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? sanitizeCommentClient(stripReplyPrefixClient(r.text)) : '';
        if (text && (text.length < 8 || text.length > 120)) text = '';
        // v35：神回复同样拦截泄露（指令原文/JSON 当话说）
        if (text && (jsonLeakIn(text) || promptLeakIn(text))) text = '';
        // 神回复锚定双保险：必须接得上「用户的评论 + 主帖」
        if (text && !thanks && !commentAnchored(text, stripImgPh(`${userReply?.content ?? ''} ${mainPost.content}`))) text = '';
      } catch {
        text = '';
      }
      if (!text) return; // 致谢空=选择不打扰；神回复空=宁缺毋滥（不发假通知）
      const next = { ...forumData() };
      const parentEng = userReply
        ? { likes: likesOf(userReply), views: userReply.views }
        : { likes: likesOf(mainPost), views: mainPost.views };
      const reply = basePost(
        charKey,
        text.slice(0, REPLY_MAX),
        mainPost.community,
        Date.now(),
        groupId,
        userReply ? userName : resolveAuthor(mainPost.authorKey).name,
        true,
        parentEng,
      );
      if (userReply) reply.replyToPost = userReply.id; // 精确回应用户那条评论
      next.posts.push(reply);
      // v42【帖子记忆】：神回复落用户帖的评论区 → 也算「某NPC在我的帖子里说了话」入库
      noteNpcCommentOnMyPost(mainId, reply);
      // v43【NPC 记忆系统】：神回复也是「我在TA帖下说过的话」（角色侧连贯性）
      noteNpcMyComment(charKey, mainPost, text);
      next.notifications = [
        { id: uid('n'), type: 'reply' as const, fromKey: charKey, postId: reply.id, createdAt: Date.now(), read: false },
        ...next.notifications,
      ];
      saveForum(next);
      // 记忆写入：「TA评论了我的帖子，我回复TA：……」
      if (!thanks && userReply) {
        writeCharReplyMemory(brief.contactId, { userComment: userReply.content, reply: text, postId: mainPost.id });
      }
      // v41（B3）：致谢持久标记——写过这条的同帖不再二次致谢（快速赞↔取消↔再赞不叠加）
      if (thanks) {
        // v42【帖子记忆·金鱼】：致谢去重标记也是论坛来源记忆——开关关时不落库
        //（代价：快速赞↔取消↔再赞可能重复致谢，可接受；金鱼模式本就不该记住赞过谁）
        try {
          if (isPostMemoryOn()) {
            memAddForumFragment(
              brief.contactId,
              `${userName}给${resolveAuthor(mainPost.authorKey).name === brief.contact.nickname || brief.contact.name ? '我' : '我'}发的帖子点过赞，我在评论区谢过TA了`,
              { postId: mainPost.id, kind: 'like', commentId: 'like-thanks' },
            );
          }
        } catch {
          /* 静默 */
        }
      }
      return;
    }

    // ================= 既有任务（网友回复/私信） =================

    if (job.kind === 'replyToUserPost' || job.kind === 'aiReplyBack') {
      const d = forumData();
      const target = d.posts.find((x) => x.id === job.postKey);
      if (!target) return;
      const authorKey = job.meta.authorKey ?? 'npc:wang';
      const author = resolveAuthor(authorKey);
      const userName = resolveAuthor('user').name;

      // ---- 组装 LLM 上下文（感觉帖子内容 + 用户评论内容 + 最近对话链） ----
      // 匿名认知隔离：被回复对象是大号 → 机主名；匿名小号 → 小号网名（AI 眼里就是个
      // 普通陌生网友，与机主零关联）；其他作者 → TA 自己的名。
      let postContent = '';
      let history: { from: 'user' | 'peer'; speaker?: string; text: string }[] = [];
      let groupId = target.id; // AI 回复挂载的分组锚点
      let replyName = resolveAuthor(target.authorKey).name;
      let parentContent = target.content; // 被回复的内容（默认 = 目标帖本身）
      // v26「我回复的什么」：用户回复的那条评论（围观网友接话的完整上下文；
      // 被回复对象不是主帖本身时才有——直接回复主帖时它＝主帖，不再重复）
      let repliedTo: { authorName: string; content: string } | undefined;
      // v26：回复的热度跟随它的父帖（AI 回的是用户的回复→按用户回复缩放，
      // 多半接近 0 赞——新接的话本来就没人赞；旧版错拿被回复评论的热度）
      let parentEng = { likes: likesOf(target), views: target.views };

      if (job.kind === 'aiReplyBack') {
        // 用户（大号/小号）在评论区回复了 AI/网友：这位作者（被回复者或围观者）回应用户的回复
        const mainId = job.meta.mainPostId ?? job.meta.rootId ?? target.id;
        const mainPost = d.posts.find((p) => p.id === mainId);
        postContent = mainPost?.content ?? '';
        groupId = job.meta.rootId ?? target.id;
        // 被回复对象 = 用户刚发的回复（AI 回应「我评论的内容」）——
        // 匿名小号评论 → AI 看到的说话人就是小号网名（陌生网友）
        const userReply = job.meta.userReplyId ? d.posts.find((p) => p.id === job.meta.userReplyId) : null;
        parentContent = userReply?.content ?? target.content;
        replyName = resolveAuthor(userReply?.authorKey ?? target.authorKey).name;
        if (userReply) parentEng = { likes: likesOf(userReply), views: userReply.views };
        if (target.id !== mainId) {
          repliedTo = { authorName: resolveAuthor(target.authorKey).name, content: target.content };
        }
        // v26 整楼对话链：分组锚点下最近的发言（任何作者——1-5 位围观者看的是
        // 整层楼，不再只看「自己 ↔ 用户」；排除用户刚发的这条（已作为 parent 单传）
        // 和被回复的那条（已作为 repliedTo 单传），逐条带真实说话人名（匿名评论
        // 也用小号网名——对 AI 是陌生网友的发言）
        history = d.posts
          .filter((p) => p.replyTo === groupId && p.id !== job.meta.userReplyId && p.id !== target.id)
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-6)
          .map((p) => ({
            from: isUserAuthor(p.authorKey) ? ('user' as const) : ('peer' as const),
            speaker: resolveAuthor(p.authorKey).name,
            text: p.content,
          }));
      } else {
        // NPC 回复用户的新帖（v33：也承接网友对 char 帖子的评论——被回复对象名取帖子真实作者）。
        // 匿名小号帖：AI 看到的楼主 = 小号网名（陌生网友，与机主零关联）
        postContent = target.content;
        parentContent = target.content;
        groupId = target.id;
        replyName = resolveAuthor(target.authorKey).name;
      }

      // 识图模型：帖子带图时先「看图」再回复
      const mainForMedia = d.posts.find((p) => p.id === (job.kind === 'aiReplyBack' ? (job.meta.mainPostId ?? job.meta.rootId ?? target.id) : target.id));
      const mediaDesc = await describePostMedia(mainForMedia?.media ?? target.media);
      // v43【NPC 记忆系统】：主帖是用户账号帖（大号/小号）时——
      // · posterHist：楼主过往发过的帖（NPC 能接旧事：「楼主终于走出来了」）；
      // · npcSelfHist：这位 NPC 自己在TA帖子下留过的言（态度连贯：「怎么又是你」）；
      // 金鱼模式（帖子记忆关）两者皆空——NPC 只针对当前帖；
      // 匿名小号帖走 anon 仓（NPC 眼里是另一个陌生楼主，绝不带大号历史，防穿帮）。
      const mainPostForMem = mainForMedia ?? target;
      const posterHist = posterHistoryBlock(mainPostForMem);
      const npcSelfHist = posterHist || isUserAuthor(mainPostForMem.authorKey) ? npcMyHistoryBlock(authorKey, mainPostForMem) : '';
      // v9：主帖语言（中文帖的 AI 回复也必须中文为主体）
      const mainPostAuthorLang = mainForMedia ? resolveAuthor(mainForMedia.authorKey).lang : undefined;
      const postLang = detectPostLang(postContent || target.content, mainPostAuthorLang ?? resolveAuthor(target.authorKey).lang);

      let text = '';
      try {
        // v41（C2）：avoid 防重复注入——本楼最近说过的内容不再重复
        const avoid = d.posts
          .filter((p) => p.replyTo === groupId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-8)
          .map((p) => p.content.slice(0, 40));
        const r = (await callApi({
          kind: 'reply',
          author: {
            name: author.name,
            persona: author.persona || '',
            lang: author.lang ?? 'zh-Hans',
            // 【多世界观】矩阵 NPC 身份强制代入标记
            ...(authorKey.startsWith('mnpc:') ? { matrix: true } : {}),
          },
          parent: { authorName: replyName, content: parentContent },
          postContent,
          postLang,
          mediaDesc,
          history,
          repliedTo, // v26：用户回复的那条评论（"我回复的什么"）
          avoid,
          // v43【NPC 记忆系统】：楼主历史帖 + 这位 NPC 自己的留言史（空串时服务端零注入）
          posterHistory: posterHist,
          npcSelf: npcSelfHist,
          userName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? sanitizeCommentClient(stripReplyPrefixClient(r.text)) : '';
        // v9 客户端兜底：中文帖拒绝整句外语回复
        if (text && postLang === 'zh-Hans' && foreignDominantClient(text)) text = '';
        // v24 客户端兜底：楼层对话回复 20-80 字（留容差 12~95）——过短/过长直接不发生
        if (text && (text.length < 12 || text.length > 95)) text = '';
        // v35：JSON 残留 / 指令泄露 → 作废（双保险，与服务端同口径）
        if (text && (jsonLeakIn(text) || promptLeakIn(text))) text = '';
        // v35 复读机检测：AI 不许原样复读用户/被回复者的话（盖楼复读）
        if (text && isParrotReply(text, parentContent)) text = '';
        // v26 锚定双保险：必须接得上「用户这条回复 + 用户回复的那条 + 主帖」（与服务端同口径）
        // v27 锚定前剥 [图片] 占位符（防词表污染误杀）
        // v43【NPC 记忆】：锚定语料并入楼主历史帖（NPC 提旧事「渣男不值得」也能过校验）
        if (
          text &&
          !commentAnchored(
            text,
            stripImgPh(`${parentContent} ${repliedTo?.content ?? ''} ${postContent} ${posterHistoryRaw(mainPostForMem)}`),
          )
        )
          text = '';
      } catch {
        text = '';
      }
      if (!text) {
        // v22：万能句式兜底已删（用户明令禁止「蹲一个后续，别断更啊」这类
        // 万能句式）；LLM 失败时宁缺毋滥——这条回复直接不发生（静默跳过），
        // 也不发虚假通知
        return;
      }
      const next = { ...forumData() };
      // AI 回复的热度按被回复父帖缩放（v26：aiReplyBack 的父帖 = 用户的回复，
      // 多半接近 0 赞——新接的话本来就没人赞；评论赞 << 主帖赞）
      const replyPost = basePost(
        authorKey,
        text.slice(0, REPLY_MAX),
        target.community,
        Date.now(),
        groupId,
        replyName,
        true,
        parentEng,
      );
      // 精确被回复对象 = 用户的回复（多轮接话定位）
      if (job.kind === 'aiReplyBack' && job.meta.userReplyId) replyPost.replyToPost = job.meta.userReplyId;
      next.posts.push(replyPost);
      // v42【帖子记忆】：网友/围观者评论了用户的帖（或楼中楼接话）→
      // 「某NPC在我的哪个帖子里说了什么」入库（自己账号的评论不记，模块内部守卫）
      noteNpcCommentOnMyPost(
        job.kind === 'aiReplyBack' ? (job.meta.mainPostId ?? job.meta.rootId ?? target.id) : target.id,
        replyPost,
      );
      // v43【NPC 记忆系统】：这位 NPC 记住「我在楼主的这篇帖下说了这句话」——
      // 下次再遇到TA的新帖，态度可延续（怎么又是你）
      noteNpcMyComment(authorKey, mainPostForMem, text);
      // v41（A4）：通知只发「用户在对话链里」的场景——
      // · aiReplyBack：用户（大号/小号）在评论区发了回复，别人回 TA → 通知 ✓
      // · replyToUserPost 且主帖是用户账号发的（大号/小号） → 通知 ✓
      // · replyToUserPost 但主帖是角色帖（网友评论角色的帖子）→ 不通知（帖子不是你发的）
      const notifyUser = job.kind === 'aiReplyBack' || isUserAuthor(target.authorKey);
      if (notifyUser) {
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
      }
      saveForum(next);
      return;
    }
    if (job.kind === 'dmReply') {
      const peerKey = job.postKey as AuthorKey;
      const d = forumData();
      const dm = d.dms.find((x) => x.peerKey === peerKey);
      if (!dm) return;
      const peer = resolveAuthor(peerKey);
      // 匿名认知隔离：最后一封我方私信若是小号发的（from='anon'），对方（AI 角色/网友）
      // 看到的私信对象就是小号网名——素不相识的陌生网友，不带任何关系/记忆块
      const lastMine = [...dm.messages].reverse().find((m) => isUserAuthor(m.from));
      const fromAnon = lastMine?.from === ANON_KEY;
      const speakerName = resolveAuthor(lastMine?.from ?? 'user').name;
      const history = dm.messages.slice(-8).map((m) => ({ from: isUserAuthor(m.from) ? ('user' as const) : ('peer' as const), text: m.text }));
      // v41（C1）：对方是 AI 角色时带完整身份块（人设卡+关系+情绪+对用户的记忆），
      // 对齐 charReply 规格；普通网友保持轻量（网名+persona）。
      // 小号会话 → 一律陌生网友模式（stranger）：剥离关系/情绪/记忆（记忆里全是
      // 与机主本人的事，注入即穿帮）
      const brief = !fromAnon && peerKey.startsWith('char:') ? forumCharBriefs().find((b) => b.key === peerKey) : null;
      let text = '';
      try {
        // v41（C2）：私信也注入 avoid——对方最近说过的内容不再重复
        const avoid = dm.messages
          .filter((m) => m.from === peerKey)
          .slice(-6)
          .map((m) => m.text.slice(0, 40));
        const r = (await callApi({
          kind: 'dm',
          author: {
            name: peer.name,
            persona: peer.persona || '',
            ...(fromAnon
              ? { stranger: true }
              : brief
                ? {
                    relation: charRelationLine(brief.contact),
                    mood: charMoodBlock(brief.contactId),
                    memory: charMemoryDigest(brief.contactId),
                    char: true,
                  }
                : {}),
          },
          history,
          avoid,
          userName: speakerName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? sanitizeDmClient(stripReplyPrefixClient(r.text)) : '';
        // v41（C1）：泄露拦截 + 长度校验（对齐全站「宁缺毋滥」口径）
        if (text && (jsonLeakIn(text) || promptLeakIn(text))) text = '';
        if (text && (text.length < 2 || text.length > 300)) text = '';
      } catch {
        text = '';
      }
      // v41（C1）：删掉 4 句固定复读话术兜底——LLM 失败时私信不落垃圾句
      //（与全站「宁缺毋滥」口径一致；用户再发一条会重新触发回复）
      if (!text) return;
      mutateForum((next) => {
        const target = next.dms.find((x) => x.peerKey === peerKey);
        if (!target) return;
        target.messages.push({ id: uid('m'), from: peerKey, text: text.slice(0, 160), at: Date.now() });
      });
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
      if (isUserAuthor(p.authorKey)) continue;
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

/** v35 存量脏数据清洗（幂等，boot 时执行）：
 *  ① 泄露清理：用户实锤截图里「半糖去冰」「凌晨四点」等评论存的就是
 *  {"thought":"...","comment":"..."} 原始 JSON 串、「巷口的…」存的是
 *  【本帖核心话题词…】指令原文——本次升级前已落库的这些出戏评论，
 *  现在按新检测器全部清掉（含其下楼中楼整链——父评论没了子回复悬空）；
 *  ② 复读清理：同帖内整句级换皮重复的旧评论（如截图里「代拍太可怕了」×4）
 *  只留时间最早的一条；用户手写内容（authorKey=user）一律不动。 */
function migrateV35PurgeLeaked(): void {
  try {
    const d = forumData();
    const bad = new Set<string>();
    for (const p of d.posts) {
      if (isUserAuthor(p.authorKey)) continue;
      if (jsonLeakIn(p.content) || promptLeakIn(p.content)) bad.add(p.id);
    }
    if (bad.size) {
      // 迭代闭包：被删评论的楼中楼（replyToPost 指向它）一并删除，防悬空
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of d.posts) {
          if (bad.has(p.id)) continue;
          const parentId = p.replyToPost ?? p.replyTo ?? '';
          if (parentId && bad.has(parentId)) {
            bad.add(p.id);
            grew = true;
          }
        }
      }
    }
    const posts = d.posts.filter((p) => !bad.has(p.id));
    // 第二阶段：同帖内的旧复读评论（换皮重复）——按主帖整树分组（一级评论+
    // 全部楼中楼同页可见）、时间排序，AI 评论与前面保留的评论整句级重合 → 删除
    //（用户内容不动）；父链断裂时退化按自身锚点分组
    const purged = new Set(bad);
    const byId = new Map(posts.map((p) => [p.id, p]));
    const mainOf = (p: ForumPost): string => {
      let cur = p;
      for (let guard = 0; guard < 6; guard++) {
        const parent = byId.get(cur.replyToPost ?? cur.replyTo ?? '');
        if (!parent) return cur.replyTo ?? cur.id;
        if (parent.replyTo === null) return parent.id;
        cur = parent;
      }
      return cur.replyTo ?? cur.id;
    };
    const byMain = new Map<string, ForumPost[]>();
    for (const p of posts) {
      if (isUserAuthor(p.authorKey) || !p.replyTo) continue;
      const key = mainOf(p);
      const group = byMain.get(key) ?? [];
      group.push(p);
      byMain.set(key, group);
    }
    for (const group of byMain.values()) {
      const keptTexts: string[] = [];
      for (const p of group.slice().sort((a, b) => a.createdAt - b.createdAt)) {
        if (keptTexts.some((k) => isParrotReply(p.content, k))) {
          purged.add(p.id);
          continue;
        }
        keptTexts.push(p.content);
      }
    }
    if (!purged.size) return;
    const finalPosts = d.posts.filter((p) => !purged.has(p.id));
    // 系统通知 postId 为 null 必须保留；指向被删帖的通知一并清掉
    const finalNotis = d.notifications.filter((n) => n.postId === null || finalPosts.some((p) => p.id === n.postId));
    saveForum({ ...d, posts: finalPosts, notifications: finalNotis });
  } catch {
    /* 迁移失败静默 */
  }
}

export async function bootForum(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    // 【多世界观】确保矩阵作者索引就绪（首次打开/切换后 resolveAuthor('mnpc:') 有数据）
    rebuildMatrixIndex();
    // 仅首次播种（打开 App 不再自动补帖——用户要求：生成完后不自动生成，
    // 只在用户下拉/上拉松开、点「更多评论」时才生成）
    await ensureSeed();
    syncCommunities();
    // v7：存量评论数据修复（@前缀清洗 + 回复对象名回填）
    migrateV7ReplyData();
    // v35：存量出戏评论清洗（JSON 残留/指令泄露 + 其楼中楼整链）
    migrateV35PurgeLeaked();
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

/** 【多世界观】切换世界观（瞬间风格切换）——抽屉「切换世界观」面板调用：
 *  1. worldview-store 激活新世界观（首页标签/面板即时刷新）；
 *  2. 重建矩阵作者索引（mnpc 作者解析立即用新阵容的名字/头像/人设）；
 *  3. 复位论坛内容（旧世界观的帖子/评论/通知/动态网友清空，用户自己的帖子保留）；
 *  4. bootForum 重新播种——新世界观第一屏立刻到位：矩阵阵容领衔发帖、
 *     话题方向/语气/人设/兑底池全部来自新世界观，随后 LLM 精修帖 +
 *     multiComments 评论也按新设定生成（callApi 每次都带新世界观背景与规则）。 */
export async function switchWorldview(id: string): Promise<boolean> {
  try {
    if (!setActiveWorldviewId(id)) return false;
    rebuildMatrixIndex();
    const d = forumData();
    resetAiContent(d);
    saveForum({ ...d });
    await bootForum();
    return true;
  } catch {
    return false;
  }
}
