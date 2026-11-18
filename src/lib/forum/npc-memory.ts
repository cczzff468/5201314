'use client';

/**
 * X论坛 · NPC 记忆系统（v43，「NPC 也能记住用户的所有发帖和互动历史」的数据层）。
 *
 * 三块能力（全部受「帖子记忆」开关守卫——金鱼模式零写入零读取）：
 * 1. 【NPC 留言记忆】某个具体 NPC（网友/AI 角色）在用户的哪篇帖子下、留过什么评论。
 *    下次用户发新帖，这个 NPC 再次被选中评论时，注入「你之前在TA帖子下说过……」——
 *    人设与态度连贯（昨天骂过楼主的杠精今天开口就是「怎么又是你」）。
 * 2. 【楼主帖子历史】NPC 评论用户当前帖时，能读到该账号过往发过的帖子
 *    （正文/配图/话题标签，读自帖子记忆库 post-memory）——「楼主终于走出来了」。
 * 3. 【马甲暴露检测】用户在大号帖正文里自己暴露了小号特征（@handle 或「小号/马甲」
 *    + 小号网名）→ 标记 NPC 侧知晓；此后 NPC 评论小号帖可并入大号历史（认出马甲）。
 *
 * 数据隔离铁律：
 * - 每 NPC 独立记忆库（键含 npcKey）——NPC_A 永远读不到 NPC_B 与用户的互动；
 * - 每 NPC 的「大号楼主记忆」与「匿名楼主记忆」物理分仓（键含 account）——
 *   匿名马甲帖在 NPC 眼里就是另一个陌生人，绝不把大号态度/历史带过去（防穿帮）；
 * - 马甲暴露（仅用户主动）后读取侧单向合并 + 明示「你认出这是同一个人的号」。
 *
 * 本模块只做数据读写与 prompt 块拼装，不 import engine/social（避免循环依赖）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { ANON_KEY, isPostMemoryOn, isUserAuthor, relTime, resolveAuthor, type ForumPost } from './core';
import { accountOfPost, listPostMemories, type ForumPostMemory } from './post-memory';

// ---------------- 类型 ----------------

/** NPC 留言记忆条目：「我在TA的这篇帖子下说过这句话」 */
export interface NpcMyComment {
  postId: string;
  /** 当时那篇帖子的摘要（NPC 回想「TA当时发的是个什么帖」） */
  postSnippet: string;
  /** 我当时的评论（截 80 字） */
  myComment: string;
  at: number;
}

// ---------------- 存储（每 NPC × 每账号 物理隔离） ----------------

/** 每 NPC 每账号仓的留言条数上限（保留最近 12 条——「记性没那么好」也够连贯） */
const PER_NPC_CAP = 12;

function keyOf(npcKey: string, account: 'main' | 'anon'): string {
  return `forum-npc-mem:${npcKey}:${account}`;
}

/** 账号仓索引（记录「哪些 NPC 在该账号帖下留过言」——回访优先挑选用） */
function idxKeyOf(account: 'main' | 'anon'): string {
  return `forum-npc-mem-idx:${account}`;
}

function readList(npcKey: string, account: 'main' | 'anon'): NpcMyComment[] {
  try {
    const raw = kvGet<NpcMyComment[]>(keyOf(npcKey, account));
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof x === 'object' && typeof x.postId === 'string' && typeof x.myComment === 'string');
  } catch {
    return [];
  }
}

function writeList(npcKey: string, account: 'main' | 'anon', list: NpcMyComment[]): void {
  try {
    kvSet(keyOf(npcKey, account), list.slice(-PER_NPC_CAP));
  } catch {
    /* 落库失败静默（记忆是增强能力，不阻断论坛主流程） */
  }
}

function readIdx(account: 'main' | 'anon'): string[] {
  try {
    const raw = kvGet<string[]>(idxKeyOf(account));
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ---------------- 马甲暴露（NPC 侧知晓标记） ----------------

const ANON_KNOWN_KEY = 'forum-npc-anon-known-v1';

/** NPC 侧是否已知晓「匿名小号 = 机主大号」（仅当用户在大号帖里自己暴露过马甲特征） */
export function isNpcAnonKnown(): boolean {
  try {
    return kvGet<boolean>(ANON_KNOWN_KEY) === true;
  } catch {
    return false;
  }
}

/** 标记 NPC 侧知晓马甲（大号帖暴露特征时调用；一次性知识，落库不追溯） */
export function markNpcAnonKnown(): void {
  try {
    if (isNpcAnonKnown()) return;
    kvSet(ANON_KNOWN_KEY, true);
  } catch {
    /* 静默 */
  }
}

/**
 * 大号帖正文是否暴露了匿名小号特征（「除非用户自己在大号发帖时暴露了马甲特征」）：
 * - 正文 @ 了小号 handle（@xxx 完整形式）→ 暴露；
 * - 正文含「小号/马甲/分身/另一个号」且同时出现小号网名或 handle → 暴露；
 * - 其余一律不暴露（防常见词误判——叫 momo 的小号不背锅）。
 */
export function exposeAnonIdentityIn(content: string): boolean {
  try {
    if (!content || isNpcAnonKnown()) return false;
    const anon = resolveAuthor(ANON_KEY);
    const name = (anon.name ?? '').trim();
    const handle = (anon.handle ?? '').trim().replace(/^@/, '');
    if (!name && !handle) return false;
    const text = content.replace(/\s+/g, ' ');
    if (handle && text.includes(`@${handle}`)) return true;
    if (/(小号|马甲|分身|另一个号|另个号)/.test(text)) {
      if (name && name.length >= 2 && text.includes(name)) return true;
      if (handle && handle.length >= 2 && text.includes(handle)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------- 写入（受「帖子记忆」开关守卫） ----------------

// ---------------- v43（C2）时间感知分级 ----------------

/** 记忆新旧分级提示：24h 内 = 强认脸（「今天又来了？」）；一周内 = 常规；
 *  一周以上 = 弱提（印象模糊，顶多眼熟，别硬提细节）。所有记忆注入统一走此分级——
 *  真人记忆会褪色，NPC 的认脸强度也应随时间衰减（而不是永远「怎么又是你」）。 */
function memoryGrade(at: number): string {
  try {
    const age = Date.now() - at;
    if (age < 24 * 3600_000) return '（最近就打过交道——印象还热乎，开口可以直接认脸，比如「今天又来了？」）';
    if (age < 7 * 24 * 3600_000) return '';
    return '（这是好一阵子前的事了——印象已经模糊，顶多觉得眼熟，别硬提当时的细节）';
  } catch {
    return '';
  }
}

/**
 * NPC（虚拟网友/AI 角色）在用户帖子下留了言 → 写入该 NPC 的留言记忆。
 * · 金鱼模式（开关关）零写入；
 * · 非 NPC 本人（用户自己大号/小号的评论）不记；
 * · 帖子不是用户账号（NPC/角色帖）不记——NPC 记忆只关于「楼主」；
 * · 帖子记忆库缺该帖（更早的历史帖/发帖时金鱼关着）也照写——
 *   NPC 记的是「我说过什么」，与帖子库互为补充。
 * 幂等：同 postId + 同评论文本去重。
 */
export function noteNpcMyComment(npcKey: string, post: ForumPost, myComment: string): void {
  try {
    if (!isPostMemoryOn()) return; // 金鱼模式：NPC 对楼主的记忆零落库
    if (!npcKey || isUserAuthor(npcKey)) return;
    const comment = (myComment ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!comment) return;
    const account = accountOfPost(post);
    if (!account) return; // 只记「在楼主（用户账号）帖子下」说过的话
    const list = readList(npcKey, account);
    if (list.some((x) => x.postId === post.id && x.myComment === comment)) return; // 幂等
    list.push({
      postId: post.id,
      postSnippet: (post.content ?? '').replace(/\s+/g, ' ').slice(0, 40),
      myComment: comment,
      at: Date.now(),
    });
    writeList(npcKey, account, list);
    // 账号仓索引（回访优先挑选用）
    const idx = readIdx(account);
    if (!idx.includes(npcKey)) kvSet(idxKeyOf(account), [...idx, npcKey]);
  } catch {
    /* 静默 */
  }
}

// ---------------- 读取（全部受开关守卫；金鱼 = 空串） ----------------

/** 该 NPC 在某账号下的留言史（时间正序，最多 limit 条）；
 *  马甲已暴露（NPC 侧知晓）时并入另一账号仓（NPC 认得这是同一个人） */
function npcHistory(npcKey: string, account: 'main' | 'anon', limit: number): NpcMyComment[] {
  const list = readList(npcKey, account).slice(-limit);
  if (isNpcAnonKnown()) {
    // 认得马甲：另一账号下的留言也算「跟这个楼主打过交道」
    const other = readList(npcKey, account === 'main' ? 'anon' : 'main').slice(-limit);
    return [...list, ...other].sort((a, b) => a.at - b.at).slice(-limit);
  }
  return list;
}

/**
 * 单行版（批量评论 prompt 的 personas[].npcHistory 用）：
 * 「3天前在楼主的帖子「被渣男甩了…」下说过「这种男的趁早扔」」——空史返回 ''。
 */
export function npcMyHistoryLine(npcKey: string, post: ForumPost): string {
  try {
    if (!isPostMemoryOn()) return '';
    if (isUserAuthor(npcKey)) return '';
    const account = accountOfPost(post);
    if (!account) return '';
    const recs = npcHistory(npcKey, account, 2);
    if (!recs.length) return '';
    const base = recs
      .map((r) => `${relTime(r.at, Date.now())}在楼主的帖子「${r.postSnippet.slice(0, 24)}」下说过「${r.myComment.slice(0, 50)}」`)
      .join('；');
    // v43（C2）：时间分级提示附在行尾（最近=强认脸 / 好久=弱提）
    const grade = memoryGrade(recs[recs.length - 1].at);
    return grade ? `${base}${grade}` : base;
  } catch {
    return '';
  }
}

/**
 * NPC 自身留言史块（楼层对话回复 prompt 的【你之前在楼主帖子下留过的话】）：
 * 人设与态度连贯性素材——「怎么又是你」「楼主终于走出来了」的口吻来源。
 * · 金鱼模式 → ''（NPC 对楼主没有任何历史认知，只针对当前帖）；
 * · post 非用户账号帖 → ''（楼主的帖子才有「楼主记忆」）。
 */
export function npcMyHistoryBlock(npcKey: string, post: ForumPost): string {
  try {
    if (!isPostMemoryOn()) return '';
    if (isUserAuthor(npcKey)) return '';
    const account = accountOfPost(post);
    if (!account) return '';
    const recs = npcHistory(npcKey, account, 4);
    if (!recs.length) return '';
    const now = Date.now();
    const lines = recs.map(
      (r) => `- ${relTime(r.at, now)}TA发「${r.postSnippet.slice(0, 30)}」时你评论过：「${r.myComment.slice(0, 50)}」`,
    );
    const altLine = isNpcAnonKnown()
      ? '（你认得TA：TA的大号和小号你都见过——两个号在论坛发言都是同一个人，你对TA的整体印象延续）'
      : '';
    // v43（C2）：时间分级（最近=强认脸 / 好久=弱提）
    const grade = memoryGrade(recs[recs.length - 1].at);
    return [
      `【你之前在楼主帖子下留过的话（你记得这个楼主——延续你当时的态度和语气：怼过TA的继续怼，安慰过TA的接着关心；也可以「怎么又是你」式认脸。别整段复述，自然带出来）】${altLine}`,
      ...(grade ? [grade] : []),
      ...lines,
    ].join('\n');
  } catch {
    return '';
  }
}

/**
 * 楼主帖子历史块（NPC 评论用户帖时注入）：该账号最近发过的帖子
 * （读帖子记忆库，带 NPC 评论摘要）——「楼主昨天说被渣男甩了，今天发天气真好」。
 * · 金鱼模式 → ''；post 非用户账号帖 → ''；
 * · 马甲暴露 → 并入另一账号（NPC 视角：TA的另一个号发过的也见过）。
 */
export function posterHistoryBlock(post: ForumPost): string {
  try {
    if (!isPostMemoryOn()) return '';
    const account = accountOfPost(post);
    if (!account) return '';
    const recs = collectPosterHistory(post, account, 3);
    if (!recs.length) return '';
    const now = Date.now();
    const lines = recs.map((r) => {
      const c = r.npcComments[r.npcComments.length - 1];
      const cLine = c ? `（当时网友「${c.author}」留言：「${c.text.slice(0, 36)}」）` : '';
      return `- ${relTime(r.createdAt, now)}TA发过：「${r.content.slice(0, 60)}」${cLine}`;
    });
    const altLine = isNpcAnonKnown() ? '（TA的大号和小号你都认得——两边的帖子都是同一个人发的）' : '';
    return [
      `【楼主过往发过的帖子（你刷论坛时看到过——这些是真实背景，引用它们不算跑题：可以接旧事、感叹TA的变化（比如TA之前emo过、这次像走出来了）；但评论主体仍要针对当前帖，旧帖内容最多点一句，别复述）】${altLine}`,
      ...lines,
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

/** 锚定语料用的纯文本版（不带块头说明词——防词表污染）：楼主历史帖正文空格拼接 */
export function posterHistoryRaw(post: ForumPost): string {
  try {
    if (!isPostMemoryOn()) return '';
    const account = accountOfPost(post);
    if (!account) return '';
    return collectPosterHistory(post, account, 3)
      .map((r) => r.content)
      .join(' ');
  } catch {
    return '';
  }
}

function collectPosterHistory(post: ForumPost, account: 'main' | 'anon', limit: number): ForumPostMemory[] {
  let recs = listPostMemories(account, limit + 1).filter((r) => r.postId !== post.id).slice(0, limit);
  if (isNpcAnonKnown()) {
    // NPC 认得马甲：另一账号发过的帖也是「这个楼主」的
    const other = listPostMemories(account === 'main' ? 'anon' : 'main', limit + 1)
      .filter((r) => r.postId !== post.id)
      .slice(0, limit);
    const seen = new Set(recs.map((r) => r.postId));
    recs = [...recs, ...other.filter((r) => !seen.has(r.postId))]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  return recs;
}

// ---------------- v43（A3）论坛私信记忆 ----------------

/** 论坛私信用：这位 NPC 对「楼主」（机主）的整体记忆块——TA 自己的留言史 +
 *  楼主最近发的帖（含最近一条 NPC 评论）。微信/QQ/信息早有跨应用感知块，
 *  论坛自己的私信此前反而失忆（刚被怼完转头私聊像没事人）。仅大号会话调用——
 *  小号会话（stranger 模式）零注入，认知隔离铁律。 */
export function npcDmMemoryBlock(npcKey: string): string {
  try {
    if (!isPostMemoryOn()) return '';
    if (isUserAuthor(npcKey)) return '';
    const self = npcHistory(npcKey, 'main', 3);
    let posts = listPostMemories('main', 2);
    if (isNpcAnonKnown()) {
      // NPC 认得马甲：两个号的帖都是同一个人发的
      const other = listPostMemories('anon', 2);
      const seen = new Set(posts.map((r) => r.postId));
      posts = [...posts, ...other.filter((r) => !seen.has(r.postId))]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 2);
    }
    if (!self.length && !posts.length) return '';
    const now = Date.now();
    const parts: string[] = [];
    if (self.length) {
      parts.push(
        '【你跟TA打过交道（你记得这个楼主——延续你当时的态度和语气：怼过的接着怼，聊得来的自然熟稳；别整段复述，聊到相关话题自然带出）】',
        ...self.map(
          (r) => `- ${relTime(r.at, now)}TA发「${r.postSnippet.slice(0, 24)}」时你评论过：「${r.myComment.slice(0, 50)}」`,
        ),
      );
    }
    if (posts.length) {
      parts.push(
        '【TA最近发的帖子（你刷到过——聊到相关话题可以提，比如评论区谁说了什么；别一口气全提）】',
        ...posts.map((r) => {
          const c = r.npcComments[r.npcComments.length - 1];
          const cLine = c ? `（当时网友「${c.author}」留言：「${c.text.slice(0, 36)}」）` : '';
          return `- ${relTime(r.createdAt, now)}TA发过：「${r.content.slice(0, 60)}」${cLine}`;
        }),
      );
    }
    return parts.join('\n');
  } catch {
    return '';
  }
}

// ---------------- v43（C4）老熟人检测（通知文案记忆梗） ----------------

/** 这位 NPC 是不是「老熟人」（在用户帖下留过 ≥2 次言）——通知页「又来了」变体用。
 *  跨大号/小号合计（用户自己知道两个号都是自己，文案不暴露身份）。金鱼模式一律不算。 */
export function isNpcVeteran(npcKey: string): boolean {
  try {
    if (!isPostMemoryOn() || isUserAuthor(npcKey)) return false;
    return readList(npcKey, 'main').length + readList(npcKey, 'anon').length >= 2;
  } catch {
    return false;
  }
}

// ---------------- 回访名单 ----------------

/** 在该账号帖下留过言的 NPC 名单（genCommentBatch 回访优先挑选用；金鱼返回空） */
export function npcsWithHistoryOn(account: 'main' | 'anon'): string[] {
  try {
    if (!isPostMemoryOn()) return [];
    return readIdx(account);
  } catch {
    return [];
  }
}

// ---------------- 删帖级联 ----------------

/** 删除帖子时清掉相关 NPC 留言记忆（与 purgePostMemory 同口径） */
export function purgeNpcMemoryForPost(postId: string): void {
  try {
    for (const account of ['main', 'anon'] as const) {
      for (const npcKey of readIdx(account)) {
        const list = readList(npcKey, account);
        if (list.some((x) => x.postId === postId)) writeList(npcKey, account, list.filter((x) => x.postId !== postId));
      }
    }
  } catch {
    /* 静默 */
  }
}
