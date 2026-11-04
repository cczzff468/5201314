import { NextResponse } from 'next/server';
import { promptTextOf } from '@/lib/prompt-entries';

export const runtime = 'nodejs';

/**
 * 朋友圈/QQ动态 · AI 内容生成（发动态 / 评论 / 回复评论 共用一个端点）。
 *
 * POST {
 *   config?: UpstreamConfig,           // 用户 API 配置（设置 App 里配的；缺省服务端 SDK 兜底）
 *   kind: 'post' | 'comment' | 'reply' | 'repost',
 *   platform: 'wx' | 'qq',
 *   userName?: string,                 // 机主展示名（prompt 指代用）
 *   peer: { name, nickname?, gender?, age?, occupation?, company?, region?,
 *           persona?, background?, relation?, relationToUser?, kind? },
 *   recentChat?: { role: 'me'|'peer', text: string }[],   // 最近私聊（灵感素材，≤12 条）
 *   memories?: string[],               // 记忆库素材（≤10 条）
 *   post?: { authorName?: string, author?: 'user'|'char', content?: string, imagesOnly?: boolean },  // 要评论的动态；
 *                                      // imagesOnly=true = 纯图动态（#14：放行并注入防编造；
 *                                      // #19：引擎显式布尔声明，不再按 content 文案前缀识别——前缀可被正文伪造）
 *   thread?: { authorName?: string, content?: string }[], // 评论区上下文（回复时）
 *   replyTo?: { authorName?: string, content?: string, realName?: string, parentAuthor?: 'user' },
 *                                      // 被回复的评论（realName=对方真实名字，称呼用）；
 *                                      // parentAuthor='user' 由引擎声明「parent 是用户评论」——#41d 防悬空 replyTo 绕过防自评
 *   hint?: string,                     // 触发语境提示（如「结合最近聊天有感而发」）
 *   ownRecentPosts?: string[],         // 该角色最近已发过的动态（发动态时防重复/防自相矛盾）
 *   avoid?: string[],                  // 禁复读名单：该角色最近说过的话（评论/回复/转发不与已说过的重复；
 *                                      //   微信/QQ 两平台各自独立生成，后生成方会读到先落盘方的同一角色发言）
 *   variation?: string,                // 随机切入角度（每次生成都不同——两平台/两次触发不再产出一字不差的内容）
 *   bilingual?: boolean,               // 48-3/53：是否启用双语规则（true 时返回 { content, contentZh }）
 *   bilingualPrompt?: string,          // 48-3/53：双语提示词（空则用 DEFAULT_BILINGUAL_PROMPT 新规则）
 * }
 * → { content: string, contentZh: string }（contentZh 为空串表示中文正文无译文；非中文时 LLM 按「原文|中文译文」格式输出，splitBilingual 按 | 拆分）
 *
 * 设计约束：
 * - 内容完全由传入的 persona 驱动：不同角色人设不同 → 动态/评论风格天然不同（一.5）；
 * - 生成素材（最近聊天 + 记忆）只做灵感，prompt 明确禁止逐字复述、禁止暴露幕后概念；
 * - 严格第一人称、口语化、短小（动态 ≤120 字 / 评论 ≤50 字），输出只含正文本身；
 * - 发动态（post）一律不加 emoji：提示词显式禁令 + 返回前 stripEmojiText 硬性剥离双保险。
 */

import { completeWithFallback, extractUpstreamConfig, type LLMMessage } from '@/lib/server-llm';
import { stripEmojiText } from '@/lib/emoji';
import { extractThinkBlocks } from '@/lib/think-filter';

interface PeerInput {
  name?: unknown;
  nickname?: unknown;
  gender?: unknown;
  age?: unknown;
  occupation?: unknown;
  company?: unknown;
  region?: unknown;
  persona?: unknown;
  background?: unknown;
  /** 表达风格（说话方式/风格基调；注入【表达风格】段，动态/评论同样遵循） */
  expressStyle?: unknown;
  /** 自定义 AI 规则（v49：一行一条；注入【用户定制的规则】段，优先级高于人设） */
  customRules?: unknown;
  relation?: unknown;
  relationToUser?: unknown;
  kind?: unknown;
}

function s(v: unknown, max = 120): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanName(v: unknown, fallback: string): string {
  const t = s(v, 20);
  return t || fallback;
}

const PLATFORM_LABEL: Record<string, string> = { wx: '微信朋友圈', qq: 'QQ空间' };

/**
 * 北京时间（UTC+8）当前时刻 + 时段一行（发动态/评论/回复/转发 prompt 通用的时间感知注入）。
 * 服务端 Node 运行时内联 UTC+8 偏移计算（src/lib/time-aware.ts 标记 'use client' 且内部依赖
 * localStorage，不可从服务端路由 import，故此处内联同口径计算），不依赖任何浏览器 API。
 * 时段划分：清晨5-8 / 上午8-11 / 中午11-13 / 下午13-17 / 傍晚17-19 / 晚上19-23 / 深夜23-5。
 */
function bjTimeLine(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const period =
    hour >= 5 && hour < 8 ? '清晨'
    : hour >= 8 && hour < 11 ? '上午'
    : hour >= 11 && hour < 13 ? '中午'
    : hour >= 13 && hour < 17 ? '下午'
    : hour >= 17 && hour < 19 ? '傍晚'
    : hour >= 19 && hour < 23 ? '晚上'
    : '深夜';
  const hm = `${hour}:${String(minute).padStart(2, '0')}`;
  return `（现在是北京时间 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}，${period}——发言要符合这个时间的语境：凌晨/深夜不说「早安」「早上好」，早上别说「晚安」，也不要在正文里复述时间）`;
}

/** 从模型回复中清洗正文：去围栏/引号包裹/舞台指示，压成单段 */
function cleanContent(raw: string): string {
  let t = raw.replace(/```(?:[\w-]+)?/gi, '').trim();
  // 去掉首尾成对引号包裹（模型爱给正文套引号）
  t = t.replace(/^[「"'“"]+/, '').replace(/[」"'”"]+$/, '').trim();
  // 去掉开头的舞台指示（括号动作）与 markdown 痕迹；照片标签 [图片:/[照片: 开头时除外——
  // 模型偶尔只发标签不写正文，标签就在开头，被当舞台指示剥掉会连「降级文字图片卡片」的描述一起丢
  if (!/^[【\[]\s*(?:照片|图片)\s*[:：]/.test(t)) {
    t = t.replace(/^[（(【\[][^）)】\]]{0,24}[）)】\]]/, '').trim();
  }
  t = t.replace(/^[#*\-•\s]+/, '');
  // 多行压成自然段（动态/评论都不该有排版）
  t = t.replace(/\n{2,}/g, '\n').trim();
  return t.slice(0, 320);
}

/**
 * 48-3 / 53 双语拆分：LLM 按「原文|简体中文译文」格式输出时，
 * 找最后一个 `|` 切分为原文与译文（译文是中文不会含 |，故取最后一个最安全）；
 * 无 `|` 视为中文正文无译文，contentZh='' 容错。
 * 注意：照片标签 [照片:...] 内的描述也可能含 |，但描述在 `]` 之内，
 *   且正文末尾的 | 才是原文/译文分隔符——取最后一个 | 能避开标签内的 |。
 */
function splitBilingual(raw: string): { content: string; contentZh: string } {
  const idx = raw.lastIndexOf('|');
  if (idx > 0) {
    const content = raw.slice(0, idx);
    const contentZh = raw.slice(idx + 1);
    // 译文必须非空且是中文才视为有效（避免正文里的 | 被误判）
    if (contentZh.trim() && /[\u4e00-\u9fa5]/.test(contentZh)) {
      return { content: content.trim(), contentZh: contentZh.trim() };
    }
  }
  return { content: raw, contentZh: '' };
}

/* ---------------- 可选鉴权 + 全局滑动窗口限流（四轮审计 M1，照搬 api/chat/bg 的 #16 模式） ---------------- */

/**
 * 本端点单次 POST 最多 upstream+SDK 两次 LLM 调用（server-llm completeWithFallback：上游失败落 SDK 兜底），
 * 未传 config 时烧服务端内置 SDK 凭据——公网部署无鉴权无限流可被第三方刷爆。与 api/push / api/chat/bg 同款口径：
 * - 可选鉴权：配置环境变量 PUSH_SHARED_TOKEN 时要求请求头 x-shared-token 精确匹配，否则 401；
 *   未配置（本地沙箱默认）两者均不生效，行为完全不变，现有 UI 流程零影响。
 *   客户端引擎（lib/moments.ts callGenerateApi）为同源 fetch、不带 token——配置 token 的公网部署上
 *   动态引擎会被 401 拒绝，需部署方同步把 token 暴露给前端（与 bg 链路 bg-turn.ts / push-client.ts
 *   的既有妥协同一口径）。
 * - 全局滑动窗口限流：动态生成单次成本高于 bg 接力（上游失败时一次 POST 内部可重落到 SDK，
 *   引擎禁复读还会对同一项两轮重试），阈值比 bg（30/60s）更紧；正常单客户端一次 tick
 *   （90s 预算）至多十来次生成，不会误伤。超限 429。
 */
const SHARED_TOKEN = process.env.PUSH_SHARED_TOKEN;

/** 共享 token 校验：未配置恒通过；已配置时请求头 x-shared-token 必须精确匹配（同 api/push tokenOk 写法） */
function sharedTokenOk(req: Request): boolean {
  if (!SHARED_TOKEN) return true;
  try {
    return req.headers.get('x-shared-token') === SHARED_TOKEN;
  } catch {
    return false;
  }
}

const GENERATE_WINDOW_MS = 60_000;
const GLOBAL_GENERATE_RATE_LIMIT = 20;
/** 全局滑动窗口内最近请求时刻（模块级数组，内存态，服务重启清空；单线程事件循环内读写） */
const generateHitTimes: number[] = [];

/** 全局滑动窗口限流：未超限记一笔并返回 false；超限返回 true（本次不记，不刷新窗口） */
function generateRateLimited(): boolean {
  const now = Date.now();
  while (generateHitTimes.length > 0 && now - generateHitTimes[0] >= GENERATE_WINDOW_MS) {
    generateHitTimes.shift();
  }
  if (generateHitTimes.length >= GLOBAL_GENERATE_RATE_LIMIT) return true;
  generateHitTimes.push(now);
  return false;
}

export async function POST(req: Request) {
  // 可选鉴权 + 全局限流（说明见上）：未配置 PUSH_SHARED_TOKEN 时两者均不生效，行为不变
  if (!sharedTokenOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (generateRateLimited()) return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
  let body: Record<string, unknown> | null = null;
  try {
    const raw: unknown = await req.json();
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: '请求体不能为空' }, { status: 400 });

  const kind =
    body.kind === 'comment' || body.kind === 'reply' || body.kind === 'repost'
      ? (body.kind as 'comment' | 'reply' | 'repost')
      : 'post';
  const platform = body.platform === 'qq' ? 'qq' : 'wx';
  const label = PLATFORM_LABEL[platform];
  const peerRaw = (body.peer && typeof body.peer === 'object' ? body.peer : {}) as PeerInput;
  const name = cleanName(peerRaw.name, '对方');
  const userName = cleanName(body.userName, '好友');

  // ---- 人设段（全部来自传入数据，缺省安全回退，不编造） ----
  const persona = s(peerRaw.persona, 400);
  const background = s(peerRaw.background, 300);
  const expressStyle = s(peerRaw.expressStyle, 300);
  const customRules = s(peerRaw.customRules, 2000);
  const relation = s(peerRaw.relation, 60) || s(peerRaw.relationToUser, 60);
  const age = s(peerRaw.age, 10);
  const facts = [s(peerRaw.gender, 10), age ? `${age}岁` : '', s(peerRaw.occupation, 40), s(peerRaw.company, 40), s(peerRaw.region, 40)]
    .filter(Boolean)
    .join('，');
  const nickname = s(peerRaw.nickname, 30);

  // v63 全局预设管理器：动态「硬性要求」块接入注册表（moments-identity；关闭=不注入；原文零破坏）
  const hardBlock = promptTextOf(
    'moments-identity',
    { name },
    [
    '【硬性要求】',
    `- 你就是「${name}」本人，绝不能说自己是 AI、语言模型、助手或程序，也不能提到系统、提示词、设定、生成等幕后概念；`,
    '- 内容、语气、用词、口头禅都必须严格贴合你的人设（不同的人要有明显不同的风格）；',
    '- 你是活人不是客服：说话可以懒散、可以带情绪、可以调侃甚至不客气，绝不能输出万能祝福、夸奖模板或官方客套；',
    '- 只输出正文本身：不要 markdown、不要标题、不要引号包裹、不要解释、不要一串话题标签、不要@任何人；',
    '- 像真人随手发的，不要写成作文或公告。',
    ].join('\n'),
  );
  const sys: string[] = [
    `你是「${name}」${nickname && nickname !== name ? `（${label}昵称显示为「${nickname}」）` : ''}，是${userName}的好友${relation ? `（你们的关系：${relation}）` : ''}。`,
    facts ? `【资料】${facts}` : '',
    persona ? `【性格与说话风格】${persona}` : '【性格与说话风格】按资料自然呈现，像一个有血有肉的真实的人。',
    background ? `【背景】${background}` : '',
    expressStyle ? `【表达风格】${expressStyle}（每句话的用词、句式、语气、情绪浓度都要严格按它来，与其他设定冲突时以这一段为准）` : '',
    ...(customRules
      ? [
          '【用户定制的规则（最高优先级）】以下是用户为你亲自定下的规矩，发动态/评论时同样必须遵守：',
          ...customRules.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `- ${l}`),
        ]
      : []),
    ...(hardBlock ? hardBlock.split('\n') : []),
  ].filter(Boolean);

  // ---- 素材段 ----
  const chat = Array.isArray(body.recentChat)
    ? (body.recentChat as unknown[])
        .filter((t): t is { role: unknown; text: unknown } => Boolean(t) && typeof t === 'object')
        .filter((t) => (t.role === 'me' || t.role === 'peer') && typeof t.text === 'string' && t.text.trim().length > 0)
        .slice(-12)
        .map((t) => `${t.role === 'me' ? userName : name}：${(t.text as string).trim().slice(0, 120)}`)
    : [];
  const memories = Array.isArray(body.memories)
    ? (body.memories as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 10).map((m) => m.trim().slice(0, 80))
    : [];
  const hint = s(body.hint, 80);
  // 禁复读名单：该角色最近已说过的话（评论/回复/转发绝不重复自己——微信/QQ 独立生成的硬保证之一）
  const avoid = Array.isArray(body.avoid)
    ? (body.avoid as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 8)
        .map((x) => x.trim().slice(0, 80))
    : [];
  // 该角色最近已发过的动态（发动态防重复/防自相矛盾：同一个人是连续的生活）
  const ownRecentPosts = Array.isArray(body.ownRecentPosts)
    ? (body.ownRecentPosts as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 100))
    : [];
  // 随机切入角度（引擎每次随机指定，同样的 prompt 基础产出不同方向）
  const variation = s(body.variation, 40);
  // 48-3 / 53：双语翻译支持（新规则：原文|中文译文，用 | 分隔；中文正文无译文）
  const bilingual = body.bilingual === true;
  const DEFAULT_BILINGUAL_PROMPT = `【朋友圈双语规则（仅非中文角色使用，中文角色忽略此规则）】
- **不改变协议头和结构标签**：只对你实际输出的正文内容使用双语格式，不要翻译或改动协议头和结构标签，不要改动 [回复 昵称]、[不回复]、[NPC点赞]、[NPC评论]、昵称、以及"昵称 回复 被回复者昵称:"这类结构。
- **中文正常输出无需译文**：如果正文是中文，直接正常输出，不要添加译文
- **非中文语言译文输出格式**：非中文语言，正文必须使用"原文|对应的简体中文译文"的格式输出，必须有|分割符号。
- **朋友圈正文双语补充**：如果朋友圈正文、评论正文或回复正文使用非中文，必须在同一段正文里写成"完整外文原文|完整简体中文译文"。
- **照片双语规则**：照片标签（[照片:使用参考图:描述] / [照片:不使用参考图:描述] / [图片:描述]）的标签结构保持原样不动，且标签内的描述只用中文书写，不做双语、不要中英混写（描述会直接用作生图提示词，混入外文既降低出图质量，也会把标签顶超长导致识别失败）。`;
  // v63：moments-bilingual（关闭=不注入双语规则；原文零破坏）
  const bilingualPrompt =
    s(body.bilingualPrompt, 1200) || (promptTextOf('moments-bilingual', undefined, DEFAULT_BILINGUAL_PROMPT) ?? '');

  const user: string[] = [
    // 时间感知（G）：post/comment/reply/repost 四个分支通用，放在 user prompt 开头附近，
    // 让内容贴合真实的北京时间与时段语境（深夜不发早安、清晨不提晚安）
    bjTimeLine(),
  ];
  if (kind === 'post') {
    // v63 全局预设管理器：发文规则接入注册表（moments-post-rule；原文零破坏）
    const postRuleBlock =
      promptTextOf(
        'moments-post-rule',
        { name, label, user: userName },
        [
    `请以「${name}」的口吻，现在发一条${label}动态。`,
    '- 第一人称、口语化，20~120 字；禁止使用任何 emoji 或表情符号（如 😀😂🎉✨🔥👍❤☀ 之类一律不用）；正文是纯文字（仅当下方开放配图协议时，允许在末尾带一个配图标签）；',
    '- 内容是你自己的近况、心情、见闻或想法，要贴合你的身份、职业和生活；',
    '- 这是你自己在发动态，不是去评论别人的动态、也不是回复谁的消息；',
    ...(chat.length > 0 ? ['- 可以自然融入你们最近的相处与共同话题（下方素材），但绝不能逐字复述聊天记录，也不要写「你说过…」这种引用句式；'] : []),
    `- 这是发在动态广场的公开内容，不是发给某人的私聊，不要直接对${userName}说心里话式的称呼。`,
        ].join('\n'),
      ) ?? '';
    if (postRuleBlock) user.push(...postRuleBlock.split('\n'));

    // 配图协议（按次随机，需求「AI 发朋友圈不要每条都带文字图片」）：本次请求先掷点决定是否开放配图——
    // 约 6 成动态完全不教配图协议并明令禁止输出图片标签（模型看不到协议就不会配图，比口头节制可靠得多），
    // 其余动态开放协议、由模型按内容决定配不配（协议内含节制约束）。前端引擎只在剥出标签时才走生图。
    if (Math.random() < 0.4) {
      user.push(
        '- 你可以给这条动态配一张照片：在正文写完后，另起一行在最后输出标签 [图片:画面描述]（正文本身必须保留，不能只发标签）；描述用具体的画面语言（场景/光线/动作/氛围，20~60字），描述只写中文，不要中英混写，如「[图片:黄昏的咖啡厅窗边，一杯拿铁和摊开的画册，暖光铺在桌面上]」；你的面部形象系统会自动处理，描述里不要写五官长相，也不要写文字/水印/分镜要求，不要套引号；'
      );
      user.push(
        '- 配图要有节制（重要）：只有内容天然有画面（眼前的风景/正在吃的东西/正在做的事/值得记录的瞬间）且你此刻确实想分享时才输出标签；一条动态最多一个标签；内容没有画面感时绝对不要输出标签。'
      );
    } else {
      user.push('- 本次动态不配图：不要输出任何 [图片:…]/[照片:…] 标签，正文就是纯文字（发文字动态也很自然）。');
    }
    if (ownRecentPosts.length > 0)
      user.push(
        `【你最近已经发过的动态（新动态绝不能与它们重复，也不能在事实/心情/境遇上前后矛盾——你始终是同一个连续生活的人）】\n${ownRecentPosts.map((p) => `- ${p}`).join('\n')}`
      );
    if (hint) user.push(`（本次灵感提示：${hint}）`);
    if (chat.length > 0) user.push(`【你们最近的聊天（素材，不必全用）】\n${chat.join('\n')}`);
    if (memories.length > 0) user.push(`【你记得的关于${userName}和你们之间的事（素材）】\n${memories.map((m) => `- ${m}`).join('\n')}`);
  } else {
    const postRaw = (body.post && typeof body.post === 'object' ? body.post : {}) as {
      authorName?: unknown;
      author?: unknown;
      content?: unknown;
      imagesOnly?: unknown;
    };
    const postContent = s(postRaw.content, 200);
    // #14/#19：纯图动态由引擎 payload 显式布尔声明（仅纯图动态 true）——
    // 旧版按「（该动态仅配图」文案前缀识别，用户正文伪造前缀即可误触发；
    // 改布尔后标记原文也不再进 prompt（各分支按布尔自组文案）
    const imagesOnly = postRaw.imagesOnly === true;
    if (!postContent) return NextResponse.json({ error: '缺少要评论的动态内容' }, { status: 400 });
    // 身份修复：动态作者是谁必须用传入的 authorName（角色动态的真实发帖人），
    // 绝不能用 name（那是本次要评论的评论人）——旧版把评论人当发帖人，导致「AI 自己给自己评论」。
    const postAuthorName = s(postRaw.authorName, 20);
    const postAuthor = postRaw.author === 'char' ? postAuthorName || '对方' : userName;
    // 服务端硬性守卫：发帖人不能「主动评论」自己的动态（旧版 bug 的直接根因，双保险）；
    // reply 放行——作者回复用户在自己动态下的评论是正常多轮互动（不能拦，否则用户评论 AI 动态后 AI 永远不回）
    if (kind !== 'reply' && postRaw.author === 'char' && postAuthorName && postAuthorName === name) {
      return NextResponse.json({ error: '发帖人不能评论自己的动态' }, { status: 400 });
    }
    // 评论区上下文（评论和回复都用：别人说过的话不能再重复/附和）
    const thread = Array.isArray(body.thread)
      ? (body.thread as unknown[])
          .filter((c): c is { authorName?: unknown; content?: unknown } => Boolean(c) && typeof c === 'object')
          .slice(-6)
          .map((c) => `${s(c.authorName, 20) || userName}：${s(c.content, 80)}`)
          .filter(Boolean)
      : [];
    if (kind === 'repost') {
      // 转发：把别人的动态转到自己空间，生成一句转发理由（正文短、不复述原文）。
      // postRaw/postContent/postAuthorName/postAuthor 复用外层解析（#14：纯图动态同样放行；#19：布尔识别）
      if (postRaw.author === 'char' && postAuthorName && postAuthorName === name) {
        return NextResponse.json({ error: '不能转发自己的动态' }, { status: 400 });
      }
      if (imagesOnly) {
        user.push(`${postAuthor}发了一条${label}动态（只有配图，没有文字）。`);
        user.push('- 防编造：这条动态只有配图没有文字：转发理由不要编造图片里的具体人物、文字或细节，只围绕配图呈现的主题/氛围与你的关系写一句感想；');
      } else {
        user.push(`${postAuthor}发了一条${label}动态：「${postContent}」。`);
      }
      // #42：防矛盾素材——你最近已发过的动态（转发理由不得与之重复/在事实与心情上矛盾）
      if (ownRecentPosts.length > 0)
        user.push(
          `【你最近已经发过的动态（转发理由不能与它们重复，也不能在事实/心情/境遇上前后矛盾——你始终是同一个连续生活的人）】\n${ownRecentPosts.map((p) => `- ${p}`).join('\n')}`
        );
      user.push(`请以「${name}」的身份把这条动态转发到你的${label}，写一句你转发时想说的话（转发理由）。`);
      user.push('- 8~30 字，口语化：可以感叹、安利、调侃、吐槽或补一句你的看法；不要复述原文内容；');
      user.push('- 只输出转发理由这句话本身，不要「转发：」之类前缀，不要话题标签，不要@任何人，不要 emoji；');
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（理由不得与这些已知事实矛盾）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
    } else if (kind === 'comment') {
      if (imagesOnly) {
        user.push(`${postAuthor}发了一条${label}动态（只有配图，没有文字）。`);
        user.push('- 防编造（最重要）：这条动态只有配图没有文字：不要编造图片里的具体人物、文字或细节，只围绕配图呈现的主题/氛围与你的关系自然评论；');
      } else {
        user.push(`${postAuthor}发了一条${label}动态：「${postContent}」。`);
      }
      user.push(`请以「${name}」的身份（你是评论人，不是发帖人）给这条动态写一条评论。`);
      user.push(`- 身份提醒：这条动态是「${postAuthor}」发的，你不是TA——以你「${name}」自己的口吻回应TA的内容，不要模仿作者的口吻、不要替TA说话、不要自问自答；`);
      user.push('- 15~50 字，口语化，像熟人随手打的：接梗、调侃、吐槽、反问、拆台都行，也可以就一短句；');
      user.push(
        `- 要不要称呼对方，由你的人设和平时说话习惯决定：平时爱喊人的角色可以喊一句（喊真实名字「${postAuthor}」），平时不喊人的就直接开口说；但不要每句都喊，一句话里称呼最多出现一次，也不要用「XX啊，」这种客套式重复开头；`
      );
      // 称呼红线（与 reply 分支同口径）：除名字与人设/关系里明确存在的称呼外，绝不自造「姐姐/哥哥/美女/帅哥」类称谓
      user.push(
        `- 称呼红线：TA 的名字是「${postAuthor}」。除名字和你人设/你们关系里明确存在的称呼外，绝不自造「姐姐/哥哥/姐/哥/美女/帅哥/宝/宝贝」这类与关系不符的称谓；不确定就直接不加称呼。`
      );
      user.push('- 必须扣住这条动态里的具体内容（事情/细节/情绪/人物），结合你和动态作者的关系，禁止空泛夸赞；');
      if (thread.length > 0) user.push(`【评论区已有的发言（这些话和类似的话术你都不能再说）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和其他好友的事（评论不得与这些已知事实矛盾；能自然顺带一句最好，但不能生硬复述）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push('- 禁止客服腔和万能模板：不能出现「这话说得真好」「希望你能…」「祝你…」「为你感到开心」「加油」「永远支持你」「这句话说得真好啊」这类套话，也不要纯夸奖；');
      user.push('- 你怎么评这条动态，要一眼认得出是你这个人评的：换别的角色来评，评法和语气必须完全不同；');
      user.push(
        `- 再次强调（最重要）：你要评论的动态是${postAuthor}发的${
          imagesOnly ? '（纯图动态，只有配图没有文字）' : `「${postContent.slice(0, 80)}」`
        }，评论必须让人一眼看出你看懂了这条动态，与这条动态无关的话一句都不要说——跑题的评论是无效输出；`
      );
      user.push('- 只输出评论文本，不要任何解释。');
    } else {
      const replyRaw = (body.replyTo && typeof body.replyTo === 'object' ? body.replyTo : {}) as {
        authorName?: unknown;
        content?: unknown;
        realName?: unknown;
        parentAuthor?: unknown;
      };
      const replyFrom = s(replyRaw.authorName, 20) || userName;
      const replyRealName = s(replyRaw.realName, 20);
      const replyContent = s(replyRaw.content, 120);
      if (!replyContent) return NextResponse.json({ error: '缺少要回复的评论内容' }, { status: 400 });
      // 服务端硬性守卫：不能回复自己的评论（防「AI 自己回复自己」）
      if (replyFrom === name) {
        return NextResponse.json({ error: '不能回复自己的评论' }, { status: 400 });
      }
      // #41d（防自评第四层，与引擎 addCharMomentComment/aiCommentOnMoment 同口径）：
      // 引擎只在「parent 真实存在且是用户评论」时才传 replyTo 并声明 parentAuthor='user'；
      // 声明为非用户评论的请求一律拒绝（悬空/伪造 replyTo 不能借 reply 分支绕过防自评防线）
      const parentAuthor = s(replyRaw.parentAuthor, 10);
      if (parentAuthor && parentAuthor !== 'user') {
        return NextResponse.json({ error: '回复目标无效' }, { status: 400 });
      }
      // 称呼规则（用户新要求）：不再按「评论区人数」分两种模式（那是所有角色同一种称呼的旧做法）。
      // 称呼由人设/说话习惯 + 动态/评论语境决定，交给 LLM；引擎只传真实名字，保两条硬约束：
      // 不要每句都叫、要叫就叫真实名字（不用昵称/网名）。
      // 回复的结构（修复「回复不搭/复读自己动态」）：被回复的评论是唯一话题中心，放最前面；
      // 动态原文降为末尾的背景参考。旧版把动态放开头最显眼处，模型顺势把动态改写一遍
      // 当回复（用户实锤：财评「辛苦你了」，陈回「财啊，项目算搞定了…」——整句复读动态）
      user.push(`你在一条${label}动态的评论区里，${replyFrom}对你说了一句话，你只回TA这一句（不是评论区里的其他人）。`);
      user.push(`【要回复的那句话（你唯一的话题中心，回复必须直接接住它的内容/情绪/问题）】${replyFrom}对你说：「${replyContent}」`);
      user.push('- 像聊天接话一样自然衔接：让人一眼看出你回的是上面那句话，而不是随便又说了段别的；也不要把TA这句话原样或换个说法再说一遍（复读上一句无效）；');
      user.push('- 动态原文只是背景不是话题：动态里已经写过的内容、意思、句式一律不要再重复（再说一遍是复读机，不是回复）；你自己在评论区刚说过的话（包括你的上一条回复）也不要再重复或变着说一遍；');
      user.push(
        `- 要不要称呼对方，由你的人设、说话习惯和TA这句话的语气决定：平时爱喊人的角色可以喊一句（要喊就叫TA的真实名字「${replyRealName || replyFrom}」，绝不要用昵称/网名），平时不喊人的就直接说内容；无论哪种都不要每句都喊，整个回复里称呼最多出现一次；`
      );
      // 称呼红线（用户实测：AI 回复评论自造「姐姐」）：TA 的名字就是「${replyRealName || replyFrom}」，
      // 绝不自造「姐姐/哥哥/美女/帅哥/宝」等与你们关系不符的称谓——关系里有明确爱称（如人设/关系字段写的）
      // 才能用，否则要么直接叫名字，要么不加称呼
      user.push(
        `- 称呼红线（最重要）：TA 的名字是「${replyRealName || replyFrom}」。除名字和你人设/你们关系里明确存在的称呼（如「老公」「老婆」等下方关系里真实写明的）之外，绝不自造「姐姐/哥哥/姐/哥/美女/帅哥/宝/宝贝」这类称呼——关系里没有的称谓说出来就是假的，一眼穿帮；不确定就直接不加称呼。`
      );
      user.push('- 8~40 字，口语化短句，像真人随手回消息：可以接梗、调侃、反问、敷衍、装傻；禁止客套模板（「谢谢」「说得好」「祝你…」「这句话说得真好啊」这类）；');
      user.push(
        imagesOnly
          ? `（背景，仅供理解语境，禁止复述：这条动态是${postAuthor}发的，只有配图没有文字。）`
          : `（背景，仅供理解语境，禁止复述：这条动态是${postAuthor}发的：「${postContent.slice(0, 60)}」）`
      );
      if (thread.length > 0) user.push(`【评论区最近的发言（按先后；里面已有的话和类似话术不要再重复）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（回复不得与这些已知事实矛盾）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push('- 只输出回复文本本身，不要任何解释。');
    }
  }

  // 禁复读名单（评论/回复/转发/发动态通用）：与已说过的话一字不差是硬性废品
  if (avoid.length > 0) {
    user.push(
      `【禁复读（硬性要求）：下面是你最近已经说过的话（可能在另一个 App 或别的动态下说的）。你这次输出的话必须换一个完全不同的角度和说法，与它们一个字都不能相同，意思和句式也不能雷同】\n${avoid.map((t) => `- ${t}`).join('\n')}`
    );
  }
  // 随机切入角度（引擎每次随机指定）：同样的素材也能产出不同方向的内容
  if (variation) {
    user.push(`（本次切入角度（内部指定，直接照此发挥即可，输出里不要出现“角度/要求”这类字眼）：${variation}）`);
  }

  // 48-3 / 53：bilingual=true 时直接追加双语规则全文（规则自含格式说明：原文|中文译文，用 | 分隔）
  if (bilingual) {
    user.push(bilingualPrompt);
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: sys.join('\n') },
    { role: 'user', content: user.join('\n') },
  ];

  try {
    const config = extractUpstreamConfig(body.config);
    // 动态/评论是创意短文本：温度过低（或上游缓存）会让同一角色在微信/QQ 两平台产出一字不差的内容，
    // 这里抬高到 ≥0.9 保证多样性（仅影响本端点，不改用户全局配置）
    if (config) config.temperature = Math.max(config.temperature, 0.9);
    const { text } = await completeWithFallback(config, messages);
    // [思考]块兜底剥离（A1）：动态/评论链路未注入思考指令，但模型会跨链路模仿单聊输出习惯
    // 偶发在正文前裹 [思考]…[/思考]——必须先剥再做双语拆分（思考块里若含 | 会污染分隔判定）
    // 与 cleanContent，否则思考内容会原样泄漏进朋友圈/QQ空间动态正文
    const textClean = extractThinkBlocks(text).text;
    // #47：发动态 / 评论 / 回复统一硬性剥 emoji——朋友圈文字干净；提示词禁令之外再剥一次（模型偶尔无视禁令）
    // 48-3 / 53：bilingual=true 时 LLM 按「原文|中文译文」格式输出，splitBilingual 按 | 拆分；中文正文无 | 则 contentZh=''
    let rawContent = textClean;
    let rawZh = '';
    if (bilingual) {
      const parts = splitBilingual(textClean);
      rawContent = parts.content;
      rawZh = parts.contentZh;
    }
    const content = stripEmojiText(cleanContent(rawContent));
    const contentZh = cleanContent(rawZh);
    if (!content) return NextResponse.json({ error: '生成结果为空' }, { status: 502 });
    return NextResponse.json({ content, contentZh });
  } catch (err) {
    const msg = err instanceof Error && err.message ? err.message : '生成失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
