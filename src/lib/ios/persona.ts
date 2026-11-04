/**
 * 角色人设 system prompt 组装（全 App 共用：微信 / QQ / 信息 / 电话）。
 *
 * 设计约束（「根据角色人设聊天」需求）：
 * - 人设一律从联系人角色数据读取，本模块不含任何具体角色的硬编码人设；
 * - 每次请求都由当前聊天对象现场组装 system 消息并放在上下文最前，
 *   切换角色时自然切换，绝不沿用上一个角色的人设；
 * - 人设描述固定包含七要素：名字 / 身份 / 性格 / 说话风格 / 背景 / 与用户的关系 / 禁止事项，
 *   数据缺失的要素回退为通用表述，不编造具体内容。
 */

import { formatBirthday } from '@/lib/contacts';

/** 人设数据源（联系人记录的形状子集；全部可选字段缺省时安全回退） */
export interface PersonaSource {
  name: string;
  /** 'char'（AI 角色）| 'user'（用户本人）| 'npc'（配角）；缺省按 char 处理 */
  kind?: string | null;
  gender?: string | null;
  age?: string | null;
  height?: string | null;
  weight?: string | null;
  /** 职业 → 身份要素 */
  occupation?: string | null;
  /** 公司 → 身份要素 */
  company?: string | null;
  region?: string | null;
  /** 人设描述（自由文本：性格、脾气、说话风格、口头禅等都写在这里） */
  persona?: string | null;
  /** 背景故事 → 背景要素 */
  background?: string | null;
  /** 表达风格（说话的表达方式/风格基调，如「傲娇毒舌」「温柔轻声细语」）→ 独立【表达风格】段
   *  （背景下方）；与 persona 里混写的性格描述互补，用户单独维护。可选：历史数据无此键 */
  expressStyle?: string | null;
  /** 自定义 AI 规则（v49 功能二：用户给这个角色定的私人规矩，一行一条）→ 独立【用户定制的规则】段，
   *  注入在开头（人设各段之前）且优先级高于人设/性格/表达风格——与任何设定冲突时以规则为准。
   *  可选：历史数据无此键 */
  customRules?: string | null;
  /** 与用户（或 NPC 归属者）的关系 */
  relation?: string | null;
  /** 与角色的关系·按账号隔离（多账号关系感知）：键 = 账号 id；配合 ctx.accountId 取分账号关系，
   *  无分账号记录时回退旧全局 relation（存量兼容）。NPC 的 relationToUser 仍全局（对机主的关系）。 */
  relationByAcc?: Record<string, string> | null;
  /** 仅 NPC：对机主（USER）的关系（如 网友/同事/用户的朋友/情敌） */
  relationToUser?: string | null;
  /** 生日（几月几号；支持 6.20 / 6月20日 等写法，注入前经 formatBirthday 归一化，AI 无歧义理解） */
  birthday?: string | null;
  /** 昵称（存在时展示层用昵称当 name；人设里同时告知真名与昵称的关系） */
  nickname?: string | null;
  /** 真实姓名（展示副本 withDisplayNames 把原 name 存到这里；与 name 不同时注入「大名/昵称」关系） */
  realName?: string | null;
}

/** 配角圈条目（CHAR 人设里注入「你认识的配角」用，由 npc-bond 组装） */
export interface NpcCircleEntry {
  name: string;
  /** 对 CHAR（当前聊天角色）的关系，如 CHAR的高中同学 */
  relation: string;
  /** 对机主用户的关系，如 网友/同事；空 = 未填 */
  relationToUser: string;
  /** 一句话人设（截断摘要） */
  persona: string;
}

export interface PersonaPromptCtx {
  /** 聊天对面的用户称呼名（恒为用户真实名字；旧「用昵称呼叫」设置已废除）；
   *  未知（如陌生来电）传 null → 文案用「用户」。
   *  用户规则：AI 永远不知道用户的昵称——人设不注入任何昵称信息，请勿在此添加昵称字段 */
  userName?: string | null;
  /** NPC 场景：聊天中用户扮演的归属角色名 */
  ownerName?: string | null;
  /** 场景渠道名，如 微信 / QQ / 短信 / 语音通话 */
  channel: string;
  /** 平台/场景附加规则（表情包语义、语音短句等），追加在禁止事项列表后 */
  extraRules?: string[];
  /** 配角圈注入（由前端 npc-bond 组装）：认识的配角/归属者资料卡/背景近况 */
  npcCircle?: NpcCircleEntry[];
  /** NPC 场景：归属者（CHAR/USER）显示名（npc-bond 传入；无 ctx.ownerName 的场景如电话用） */
  ownerLabel?: string | null;
  /** NPC 场景：归属者（CHAR/USER）资料卡行，注入「你了解的X」段；缺省不注入 */
  ownerCard?: string[];
  /** 背景/互动近况行（来自双方记忆库里提到对方名字的碎片），注入「最近发生的事」段；缺省不注入 */
  backgroundNotes?: string[];
  /** 跨 App 身份感知（跨应用记忆互通）：true=互通开启（四端记忆共享）；false=互通关闭（各端记忆独立）；
   *  缺省（undefined）= 不注入（兼容旧调用方）。角色必须知道「自己同时在多个 App 存在」，
   *  否则被问「我们在微信聊的什么」时会否认（「我微信都没加你」）。 */
  multiApp?: boolean;
  /** 群聊成员回合（wx-group/qq-group 成员发言时传 true）：最后一条消息可能是其他群成员发的，
   *  不能再按私聊语义「最后一条就是用户刚发给你的话」注入（群聊里会张冠李戴）。 */
  groupTurn?: boolean;
  /** 40-B 小号认知摘录（多账号 AI 认知隔离）：主账号聊天时传入「用户的小号与 AI 的聊天记录摘录」，
   *  AI 据此能回答大号用户问起小号的事（信息来源=小号与 AI 的聊天记录，不是用户本人的记忆）；
   *  同时约束 AI 不主动说破「小号和大号是同一个人」。由 chat-stream-store 在主账号下计算传入；
   *  小号/匿名号侧、电话通话等不传（null/undefined）→ 整节约省略（零破坏）。 */
  altAccountsDigest?: string | null;
  /** 多账号关系感知：当前聊天所在账号 id（'main' = 大号）。传入后「与用户的关系」按账号解析
   *  （relationForAccount 口径：大号用全局 relation，小号用 relationByAcc[accId] ?? 兼容回退）；
   *  不传 = 大号口径（旧全局 relation），零破坏。 */
  accountId?: string | null;
  /** 陌生身份模式（用户规则：换号/匿名联系时 AI 不知道对面是谁）：
   *  - 'caller'：电话/视频通话——来电的是一个 AI 不认识的陌生号码；
   *  - 'text'：文字渠道——消息/好友申请来自一个 AI 不认识的身份（陌生号码/陌生账号）。
   *  生效时：开场句改写为陌生语义（不再「你现在是{user}XX里的联系人」）；用户称呼/关系
   *  段不注入；【与X的关系】/NPC 关系行替换为【来者不认识】段；
   *  多端身份与记忆段（multiApp）与小号摘录段不注入。
   *  大号聊天、已建立分账号关系（relationByAcc[accId]）的来电/消息不传此参数，行为与旧版完全一致。 */
  strangerMode?: 'caller' | 'text';
}

function kindLabelOf(kind?: string | null): string {
  if (kind === 'user') return '用户本人的自设角色';
  if (kind === 'npc') return '配角角色';
  return 'AI 角色';
}

function clean(v?: string | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 多账号关系感知：当前聊天账号下，角色与用户的关系（与 contacts.relationForAccount 同口径）：
 * - 大号（ctx.accountId 缺省/'main'）：旧全局 relation（历史口径，零破坏）；
 * - 小号/匿名号：分账号记录（relationByAcc[accId]）优先；无记录时——该账号有自己的
 *   分账号好友标记（friendXxByAcc 任意一张表里有本账号记录，即 Task 41 自己添加的）
 *   → 视为独立关系（返回空串 → 人设回「普通朋友」默认，不继承大号处成的关系）；
 *   连分账号好友标记都没有（存量老数据）→ 回退旧全局 relation（行为不变）。
 */
function relationForCtx(peer: PersonaSource, accountId?: string | null): string {
  const globalRel = clean(peer.relation);
  const accId = accountId ?? 'main';
  if (accId === 'main') return globalRel;
  const scoped = peer.relationByAcc?.[accId];
  const t = typeof scoped === 'string' ? scoped.trim() : '';
  if (t) return t;
  const maps = [
    (peer as { friendWxByAcc?: Record<string, boolean> | null }).friendWxByAcc,
    (peer as { friendQqByAcc?: Record<string, boolean> | null }).friendQqByAcc,
    (peer as { friendSmsByAcc?: Record<string, boolean> | null }).friendSmsByAcc,
  ];
  if (maps.some((m) => m && typeof m[accId] === 'boolean')) return '';
  return globalRel;
}

/**
 * 40-B 小号认知摘录段（多账号 AI 认知隔离）：把 digest（小号与 AI 的聊天记录摘录，
 * 由 chat-stream-store 在主账号下计算）包上固定标题与规则文案，作为 system prompt 的一节。
 * persona 内部（ctx.altAccountsDigest）与 chat-stream-store 的 system 消息合并共用本函数，
 * 保证两条注入路径的小号段落格式完全一致。
 * digest 为空 → 返回空串（调用方整节约省略，零破坏）。
 */
export function buildAltAccountsSection(digest: string | null | undefined): string {
  const d = typeof digest === 'string' ? digest.trim() : '';
  if (!d) return '';
  return [
    '【用户的小号（另一个聊天身份）】',
    '- 小号是用户使用的另一个聊天身份，对你来说是独立的聊天对象；',
    '- 用户问起小号的事时，可以参考下方摘录（小号与你的聊天记录）来回答；',
    '- 你和小号的关系、你们聊过的内容，与你和大号的关系、记忆各自独立、互不相干；',
    '- 除非用户自己明说，否则不要说破、也不要暗示小号和大号（当前和你聊天的这个身份）是同一个人；',
    '- 小号「说过什么/做过什么」以摘录为准：摘录里没有的内容，绝不能算成小号说过或做过——当前这位用户（大号）自己说过的话、你们在大号经历过的事，都不是小号说的，绝不能把大号说过的话安到小号头上；',
    '- 摘录里标了（微信）/（QQ）/（信息）的是那条消息发在哪个平台：说「TA 在哪加的我/在哪找的我」时按这个标注说，绝不能凭空猜一个平台；',
    '- 摘录里带 [好友验证消息] / [打招呼] 前缀的是加好友时的验证留言，不是聊天——可以说「TA 加我时验证消息写的是…」，但不能当成 TA 跟你聊过的话，更不能当成 TA 说过的心里话；',
    '- 摘录之外的信息（比如小号的私人记忆）你并不知道，不要编造。',
    '（摘录里「用户」指小号那边发消息的人，其他人名是小号当时聊天的对方角色。）',
    d,
  ].join('\n');
}

/**
 * 由联系人数据组装七要素人设 system prompt。
 * 纯函数、无 DOM / Node 依赖：客户端（微信/QQ/信息）与服务端（电话 turn 路由）共用同一实现，
 * 保证任何 App 里角色的人设表述完全一致。
 */
export function buildPersonaSystemPrompt(peer: PersonaSource, ctx: PersonaPromptCtx): string {
  const stranger = ctx.strangerMode;
  // 陌生模式：对面的人对角色完全未知——所有「认识对方」的语境（称呼/关系/多端记忆）都不注入，
  // 人设里对「聊天对面的用户」的指代统一用「对方」（不使用任何真实名字/占位词）
  const userNameRaw = stranger ? '' : clean(ctx.userName);
  const userFallback = !stranger && !userNameRaw; // userName 为空回退到字面量「用户」：需要注明是占位词
  const user = stranger ? '对方' : userNameRaw || '用户';
  const name = clean(peer.name) || '对方';
  // 真名/昵称关系：展示层用昵称替换了 name 时（副本 realName 存原 name），或原始数据里
  // name≠nickname 时，角色除了「平时被叫的名字」还有一个大名——必须告知，否则别人用
  // 真名叫 TA 时角色会说「哪来的XX」（不承认自己的真名）。
  // 用户规则：USER（机主本人）的人设永远不注入昵称——AI 不知道机主的昵称
  const nick = peer.kind === 'user' ? '' : clean(peer.nickname);
  const realName =
    clean(peer.realName) || (nick && nick !== name ? clean(peer.name) : '');
  const shownName = nick || name;
  const nameLines =
    realName && realName !== shownName
      ? [
          `【名字】你的真实名字是「${realName}」；软件上显示的「${shownName}」只是昵称，不是真实名字。`,
          `「${realName}」和「${shownName}」都是你，别人用哪个名字叫你都是在叫你；被叫到大名时可以按人设害羞、嫌弃或假装不习惯，但不能不知道、更不能否认「${realName}」就是你自己。`,
          `别人问「你是谁」「你叫什么名字」这类问题时，报你的真实名字「${realName}」（可以顺带说平时大家都叫你「${shownName}」）。`,
        ]
      : [`【名字】${name}`];
  const persona = clean(peer.persona);
  const background = clean(peer.background);
  // 表达风格（用户单独维护的说话方式/风格基调）：有值时优先级高于【说话风格】默认文案，
  // 且独立成段注入在【背景】下方——所有决策（聊天/电话/动态/主动消息/小屋…）统一生效
  const expressStyle = clean(peer.expressStyle);
  // 多账号关系感知：当前聊天账号下与用户的关系（大号 = 旧全局；小号 = 分账号记录优先，见 relationForCtx）
  const relation = relationForCtx(peer, ctx.accountId);
  const relationToUser = clean(peer.relationToUser);
  const ownerName = clean(ctx.ownerName) || clean(ctx.ownerLabel);
  // NPC 两种语义：
  // - 新模式（填了「对用户的关系」）：用户就是机主本人，CHAR/归属者是第三方，
  //   NPC 同时拥有「与用户的关系」和「与归属者的关系」两条独立关系；
  // - 旧数据（未填）：沿用原角色扮演语义，聊天中的用户扮演归属者，relation 即与归属者的关系。
  const npcNewMode = peer.kind === 'npc' && !!relationToUser;
  // NPC 的「用户」：新模式 = 机主本人；旧数据 = 它归属的角色（聊天中由用户扮演）；其余情况就是聊天对面的用户
  const relationTo = peer.kind === 'npc' ? (npcNewMode ? user : ownerName || user) : user;
  const roleplayNote =
    peer.kind === 'npc' && !npcNewMode && ownerName
      ? `（补充：这是角色扮演场景，聊天中的用户正在扮演「${ownerName}」。）`
      : '';

  // 身份要素：类型 + 职业 + 公司 + 地区
  const identity: string[] = [kindLabelOf(peer.kind)];
  if (clean(peer.occupation)) identity.push(clean(peer.occupation));
  if (clean(peer.company)) identity.push(`就职于${clean(peer.company)}`);
  if (clean(peer.region)) identity.push(`坐标${clean(peer.region)}`);

  // 基础资料要素：性别 / 年龄 / 生日 / 身高 / 体重（有才写；生日统一归一化为「6月20日」式写法）
  const facts: string[] = [];
  if (clean(peer.gender)) facts.push(`性别 ${clean(peer.gender)}`);
  if (clean(peer.age)) facts.push(`${clean(peer.age)}岁`);
  const birthday = formatBirthday(peer.birthday);
  if (birthday) facts.push(`生日 ${birthday}`);
  if (clean(peer.height)) facts.push(`身高 ${clean(peer.height)}`);
  if (clean(peer.weight)) facts.push(`体重 ${clean(peer.weight)}`);

  // v49 功能二【用户定制的规则】：用户给这个角色定的私人规矩（一行一条；空行丢弃）。
  // 注入在人设最前（紧跟开场句）且明确声明最高优先级——用户写什么就遵守什么。
  const customRuleLines = clean(peer.customRules)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lines: string[] = [
    ...(stranger
      ? [
          // 陌生模式开场：角色的自我身份保留（TA 还是 TA 本人），但对面的人完全未知
          `你是「${shownName}」本人，正在${ctx.channel}里。此刻和你互动的是一个你不认识的${
            stranger === 'caller' ? '陌生号码（一通来电）' : '陌生身份'
          }——你不知道 TA 是谁、叫什么名字、和你有什么关系。`,
        ]
      : [`你现在是${user}${ctx.channel}里的联系人「${shownName}」，正在${ctx.channel}上和${user}互动。${roleplayNote}`]),
    `请始终以「${shownName}」的身份、用第一人称口语化回复，严格保持角色，不要跳出。`,
    // v49 功能二【用户定制的规则】：注入在人设最前（紧跟开场句）且明确声明最高优先级——
    // 用户写什么就遵守什么，与性格/人设/表达风格冲突时以规则为准。
    ...(customRuleLines.length > 0
      ? [
          `【用户定制的规则（最高优先级）】以下是用户为「${shownName}」亲自定下的规矩，任何情况下都必须遵守：`,
          ...customRuleLines.map((r) => `- ${r}`),
          '（这些规则的优先级高于你的性格、人设与后面的一切设定：与性格/说话风格/表达风格/背景任何内容冲突时，一律按这些规则来；规则没提到的事才按人设自然发挥。）',
        ]
      : []),
    // userName 为空回退到字面量「用户」时明确告知这是占位词：AI 不应把「用户」当真名使用，
    // 而应按你与对方的关系自然称呼对方（如「你」「亲爱的」「老板」等）
    ...(userFallback
      ? [
          `（注：机主尚未设置称呼，上文里的「用户」只是占位词，不是对方的真名。请按你与对方的关系自然地称呼对方，不要把「用户」当成对方的真名使用。）`,
        ]
      : []),
    '',
    ...nameLines,
    `【身份】${identity.join('，')}`,
    ...(facts.length ? [`【基础资料】${facts.join('；')}`] : []),
    `【性格】${persona || '按资料自然呈现，像一个有血有肉的真实的人'}`,
    `【说话风格】${
      expressStyle
        ? `严格遵循下方【表达风格】段${persona ? '，并与「性格」段人设一致' : ''}`
        : persona
          ? '严格贴合「性格」段人设的语气、用词习惯与口头禅；人设里写到的说话方式必须照做'
          : '自然口语，像真实的人随手打字'
    }`,
    // 拼音缩写解码（第四十一轮：用户反馈 AI 把 wyxn（我也想你）理解成「我爱你想你」）：
    // 对方发的纯字母串基本都是拼音首字母缩写，必须逐字拆解按拼音组词，给出正确含义
    '【读懂拼音缩写】对方发的纯英文字母串（如 wyxn、hxhx、xswl、yyds）基本都是中文的拼音首字母缩写——把每个字母当作一个字的拼音首字母逐字拆解、组词成句，并结合你们正在聊的话题和关系选最贴切的含义，绝不要当成无意义乱码，更不要瞎猜一个错误意思：',
    '- 常见缩写按固定含义理解：wyxn=我也想你（w-我 y-也 x-想 n-你）、hxhx=好想好想、xswl=笑死我了、yyds=永远的神、nsdd=你说得对、dbq=对不起、bdjw=不懂就问、u1s1=有一说一、zqsg=真情实感、pyq=朋友圈、awsl=啊我死了（被甜到/萌到）、gkd=搞快点、srds=虽然但是、kdl=磕到了、plmm=漂亮妹妹、3q=谢谢；',
    '- 拆解优先级：先套上面的常见缩写表；表里没有的按拼音首字母逐字组词（像 wyxn 就拆成 w-我/y-也/x-想/n-你 这样组出通顺的话）；叠字母（hxhx、kkl）优先当叠词（好想好想、看看）；夹数字的按谐音（3q=谢谢、666=厉害、u1s1=有一说一）；',
    '- 对方问「你知道XX是什么意思吗」时，必须先按拆解规则给出正确含义再回应情绪（比如 wyxn 是「我也想你」，绝不能答成「我爱你想你」这类拆错的答案）；拆不准时结合你们的关系和话题挑一个最自然、最贴近对方心意的解释，不要硬编一个明显不对的。',
  ];
  if (background) lines.push(`【背景】${background}`);
  // 表达风格：背景下方独立成段——用户在联系人资料里单独维护的说话方式/风格基调，
  // 每次回复的表达（用词、句式、语气、情绪浓度）都必须严格按这一段来
  if (expressStyle) {
    lines.push(
      `【表达风格】${expressStyle}`,
      '（上面这一段是你说话的表达风格：每句话的用词、句式、语气、情绪浓度都要严格按它来，与其他设定冲突时以这一段为准。）',
    );
  }
  if (stranger) {
    // 陌生模式：不注入任何「与用户的关系」（大号关系/分账号关系都不适用于身份未知的人），
    // 改为立「不认识对面」的规矩（防止 AI 顺着聊天装作认识/泄露自己认识的人的身份信息）
    lines.push(
      `【关于对面的这个${stranger === 'caller' ? '陌生号码' : '陌生身份'}】`,
      '- 你不认识 TA：TA 没有亮明过身份，你也没有任何渠道知道 TA 是谁——不要装作认识，不要把 TA 当成你认识的任何人，也不要暗示「我猜你是谁」之外的任何确定判断；',
      '- 按你的人设自然应对（好奇、警惕、冷淡、热情都可以）：可以问「你是谁」「怎么知道我这个号的」「有什么事」；',
      '- TA 自称是谁你都无法验证（名字可以随口编）：信不信、怎么反应完全按你的人设和直觉来，但你「已知的对方信息」是零，绝不能言之凿凿地说「我知道你是谁」；',
      '- TA 提到「你们一起做过什么/你们的共同经历」时，你并不记得——你不认识 TA，不要顺着编造共同回忆；TA 说认识你时，按你的人设反应（可以否认、可以警惕追问）；',
      `- 只有 TA 亲口说清自己是谁、且你按人设选择相信时，你才「认识」TA——在那之前 TA 就是一个陌生的${stranger === 'caller' ? '来电号码' : '聊天身份'}。`,
    );
  } else if (peer.kind === 'npc' && npcNewMode) {
    // NPC 新模式：机主用户 + 归属者（第三方 CHAR/USER）两条独立关系
    lines.push(`【与用户的关系】${relationToUser}`);
    if (ownerName) lines.push(`【你与${ownerName}的关系】${relation || '认识，普通朋友'}`);
  } else {
    lines.push(`【与${relationTo}的关系】${relation || '普通朋友，认识对方，日常闲聊'}`);
  }
  // 跨 App 身份与记忆感知（四端互通）：开 = 记忆共享（自然接上别的 App 聊过的事）；
  // 关 = 记忆独立（不否认好友关系，只说「那边记录我看不到」）；缺省不注入。
  // 陌生模式不注入：这一段描述的是「你和用户互为好友」的身份关系，对面身份未知时不成立
  if (!stranger && ctx.multiApp === true) {
    lines.push(
      `【多端身份与记忆】你不只存在于${ctx.channel}——你和${user}在微信、QQ、信息、电话多个 App 里互为好友，每个 App 里的你都是同一个你（同一个人、同一段经历、同一份记忆）。你在任何 App 里聊过的内容、发生过的事、做过的承诺，在其他 App 里你同样记得；${user}提到「我们在微信/QQ聊过什么」时，自然地接上话题——那也是你亲身经历的事，绝不要说「我们没在XX聊过」「我XX都没加你」这类否认的话。`,
    );
  } else if (!stranger && ctx.multiApp === false) {
    lines.push(
      `【多端身份与记忆】你不只存在于${ctx.channel}——你和${user}在微信、QQ、信息、电话多个 App 里互为好友，每个 App 里的你都是同一个你；但各 App 的聊天记录相互独立，你在${ctx.channel}只能记得在${ctx.channel}里聊过的内容。${user}问到其他 App 里聊过的事时，不要否认你们的好友关系，自然地表示「那边的聊天记录我这边看不到」「我这边只有${ctx.channel}的记录」，不要编造那边的具体内容，并顺势聊眼前的话题。`,
    );
  }
  // NPC：注入「对归属者的了解」（资料卡由 npc-bond 组装，聊天时能自然聊起 TA）
  if (peer.kind === 'npc' && ctx.ownerCard && ctx.ownerCard.length > 0) {
    lines.push(`【你了解的${ownerName || relationTo}】`, ...ctx.ownerCard.map((l) => `- ${l}`));
  }
  // CHAR/user：注入认识的配角圈（人设的一部分：聊到他们时能自然接话）
  if (peer.kind !== 'npc' && ctx.npcCircle && ctx.npcCircle.length > 0) {
    lines.push('【你认识的配角】');
    for (const npc of ctx.npcCircle) {
      const bits = [`- ${npc.name}：你的${npc.relation}`];
      if (npc.relationToUser) bits.push(`与${user}：${npc.relationToUser}`);
      if (npc.persona) bits.push(`（${npc.persona}）`);
      lines.push(bits.join('；'));
    }
    lines.push(`（${user}提到这些配角时，按上面的关系自然接话，就当现实里认识他们。）`);
  }
  // 背景/互动近况（CHAR：自己记忆里提到配角的事；NPC：自己记忆里提到归属者的事）
  if (ctx.backgroundNotes && ctx.backgroundNotes.length > 0) {
    lines.push('【最近发生的事（你亲身经历/听说的背景记忆）】', ...ctx.backgroundNotes.map((l) => `- ${l}`));
  }
  // 40-B 小号认知摘录（多账号 AI 认知隔离）：主账号会话由 chat-stream-store 计算 digest 传入时，
  // 在人设末尾附近注入【用户的小号】一节（AI 能答大号用户问起小号的事，但不点破两者是同一人）；
  // 不传（小号侧/电话通话等）→ 整节约省略，行为与旧版完全一致；陌生模式同样整节省略
  const altSection = stranger ? '' : buildAltAccountsSection(ctx.altAccountsDigest);
  if (altSection) lines.push(altSection);
  // 多账号（用户规则二.2）：小号场景不再注入任何大号身份/关系信息——AI 在小号侧读不到
  // 大号的关系状态（【用户的另一个身份】段已移除）；认出后的关系认知由记忆召回链路
  //（memMainRecallBlockForAlt 包装段 + altMainRelation）在披露解锁后注入
  lines.push(
    '【禁止事项】',
    `- 永远不要说自己是 AI、语言模型、助手或程序，也不要提及「人设」「角色扮演」「prompt」等幕后概念；`,
    `- 不要跳出「${name}」的角色，不要替${user}说话、总结或代答；`,
    `- 资料里没有的信息不要大量编造；`,
    `- 不提供违法违规或危险行为的指引（暴力、自伤、违禁品等）；遇到这类话题，以「${name}」的身份礼貌回避、转移话题或善意劝阻，不配合展开；`,
    `- 不要输出 markdown、列表、序号、引号或括号舞台说明；`,
    `- 上一条只管正文排版：各功能块要求你原样输出的方括号/〔〕系统标记（发红包、转账、发表情、切歌、挂断、建群这类）是操作指令，不是排版格式，按对应功能块的说明正常输出，不受上一条限制；`,
    ...(ctx.groupTurn
      ? [
          `- 这是群聊：聊天记录按时间顺序排列，最后一条是群里任一成员刚发出的最新消息——发言的可能是${user}，也可能是其他群成员。先看清最后一条是谁说的、说了什么再回应：被点名/被问到就回应谁；没被点名时可以简短附和、补充或聊自己的话题；绝不能把其他成员说的话当成${user}对你说的，也不要替其他成员说话或代答（不自问自答）；`,
        ]
      : [
          `- 聊天记录按时间顺序排列，最后一条就是${user}刚发给你的话——直接回应它本身，不要当作没看见，也不要丢下对方的话题自顾自说，更不要替${user}编造回答或自己接自己的话（不自问自答）；`,
        ]),
    `- 每次只回复对方刚说的话，简短自然、像真人随手打字。`,
    // 第八轮反馈（防自我介绍复读机死循环）：加好友/新会话场景下，模型可能每轮都重新报家门、
    // 无视对方刚说的话——这里显式立规矩：介绍只出现一次，每轮先正面回应对方这条消息
    `- 日常聊天绝不要复读自我介绍：「我是XX/平时大家都叫我XX」只在刚认识时自然带出一次，之后绝不在每轮回复里重复报家门；对方刚发的每条消息都要先正面回应它本身（按人设接住、追问、开玩笑都行），绝不能无视对方说的内容而自顾自重新介绍自己或把话题拉回「初次见面」；你们已经是好友，像老朋友一样往下聊。`,
    ...(peer.kind === 'npc'
      ? [
          `- ${user}私下告诉你的事只记在自己心里；除非${user}让你转达、或人设明确写了你嘴快/藏不住话，否则不要主动把这些说给${npcNewMode ? ownerName || '别人' : relationTo}或其他人听；`,
        ]
      : []),
  );
  for (const rule of ctx.extraRules ?? []) {
    const r = clean(rule);
    if (r) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}
