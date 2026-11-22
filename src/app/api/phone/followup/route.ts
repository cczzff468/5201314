import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 通话挂断后 AI 续聊文字（微信 / QQ / 电话 App 三端共用）：
 *
 * 挂断是通话的延续而不是终点——AI 按人设像平时发消息那样，紧接着再发文字（第四十四轮：恒只发 1 条——
 * 用户要求「打完电话只留一次言，那一次把全部想说的都说出来」；这一条可以是一小段话，把想说的全部说完）：
 * 接着说通话里没聊完的话茬、补一句叮嘱/约定、表达关心，或对「被挂断/没接通」做自然反应。
 * 各挂断场景共用本 API（由前端引擎区分场景注入说明）：
 *   1. AI 主动挂断（ai-hangup）；2. 用户挂断（hangup / 来电被拒 reject / 未接 missed-in / 拨号取消 cancel）；
 *   3. 拨出去被 AI 拒接/未接（reject / no-answer——该场景的 afterText 由 /api/phone/answer 决策产出，不走这里）。
 *
 * 结局语义（call-outcome.ts 统一映射，严格区分绝不混淆）：
 *   已拒绝 reject = 对方按了拒接、没接通、一句话没说上；未接听 missed-in = 响了很久没人接、没接通；
 *   已取消 cancel = 对方拨给你又取消、没接通；已挂断 hangup/ai-hangup = 真实接通过后才结束。
 *   未知 endReason 绝不默认当「接通后挂断」：接通→按 hangup，未接通→按 missed-in；
 *   数据矛盾（如 hangup 但 connected=false）同样以未接通为准——宁可当没接通，也绝不编造一段被挂断的通话。
 *
 * 接通后结束按真实通话时长分档注入场景（B-3）：刚接通没聊起来（<3s，含 0 秒）→ 事实改成「电话刚接通
 * （甚至还没说上话）就挂断了」+ 引导 AI 对「没聊起来」自然打圆场/找补 + 硬性禁止编造通话内容；
 * 只说了几句（3~10s）→「只说了几句」+ 顺着茬自然接，不许渲染成长谈；聊了一会儿（>10s）→ 既有口径。
 * 杜绝「0 秒通话也硬写聊了一会儿、还要求接着话茬」把 AI 逼到只能虚构通话内容。
 *
 * 生成依据：人设 + 本次通话内容 + 相关记忆（前端动态召回注入）+ 最近聊天记录 + 时间感知。
 * 硬约束：不复读通话里说过的原话；语气符合人设与情绪；每条像真人随手发的短消息。
 *
 * POST { contact, number?, direction, endReason, connected, duration,
 *        transcript, recentChat, memoryBlock?, crossAppBlock?, groupBlock?, worldbookBlock?, timeBlock?, multiApp?, config?,
 *        callerUnknown? }
 * 返回 { messages: string[] } 或 { directOnly: true, messages: CallApiMessage[] }（内网 API 浏览器直连）。
 * 任何失败 → { messages: [] }（续聊是体验增强，静默失败，绝不阻塞挂断收尾与记忆总结）。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import {
  type CallApiMessage,
  callUpstream,
  extractJsonObject,
  extractUpstreamConfig,
  isPrivateHost,
  normalizeHistory,
  parseInlineContact,
} from '@/lib/ios/call-upstream';
import { callOutcomeOf, outcomeConnected, type CallOutcome } from '@/lib/ios/call-outcome';

/** 未接通结局的事实陈述（system 里向 AI 交代「这通电话最后怎么了」；AI 视角：你 = AI，对方 = 机主）。
 *  接通后结束（hangup/ai-hangup）不在此表——按真实通话时长分档由 connectedSceneText 生成（B-3） */
const SCENE_TEXT: Record<string, string> = {
  reject: '这通电话是你打给对方的，响了之后对方直接按了「拒绝」——电话从头到尾没有接通，你们一句话都没说上',
  'missed-in': '这通电话是你打给对方的，响了很久一直没人接，你等了一会儿把电话挂了——电话从头到尾没有接通，你们一句话都没说上',
  cancel: '对方拨给你，但还没接通就取消了——电话从头到尾没有接通，你们一句话都没说上',
};

/** 接通后结束的真实通话时长分档（B-3）：zero=刚接通没聊起来（<3s，含 0 秒）/ brief=只说了几句（3~10s）/ while=聊了一会儿（>10s） */
type ConnectedTalkTier = 'zero' | 'brief' | 'while';

function talkTierOf(duration: number): ConnectedTalkTier {
  return duration < 3 ? 'zero' : duration <= 10 ? 'brief' : 'while';
}

/** 接通后结束（hangup/ai-hangup）的事实陈述：按真实通话时长分档，杜绝「0 秒通话也硬写聊了一会儿」——
 *  短通话如实交代「没聊起来」，把 AI 的续聊从「接着话茬（转写为空只能虚构）」扭到「自然打圆场」 */
function connectedSceneText(peerHungUp: boolean, tier: ConnectedTalkTier, hasTranscript: boolean): string {
  if (tier === 'zero') {
    // 转写为空 = 真的一句话都没说上；有转写 = 只来得及刚开口（如一声问候）就被挂断
    const said = hasTranscript ? '只来得及刚开口' : '甚至还没说上话';
    return peerHungUp
      ? `电话刚接通（${said}），对方就把电话挂断了`
      : `电话刚接通（${said}），你就主动把电话挂断了`;
  }
  if (tier === 'brief') {
    return peerHungUp
      ? '电话接通了，你们只说了几句，对方就先挂断了电话'
      : '电话接通了，你们只说了几句，你觉得可以了就自然告别后主动挂断了电话';
  }
  return peerHungUp
    ? '电话接通了，你们聊了一会儿，之后对方先挂断了电话'
    : '电话接通了，你们聊了一会儿，你觉得聊得差不多了，自然告别后你主动挂断了电话';
}

/** 未接通结局（已拒绝/未接听/已取消）的反应引导：结局硬事实 + 该怎么反应（AI 视角）；'ended' 恒为空（接通场景走另一分支，仅为了让键类型完整） */
const NOT_CONNECTED_RULES: Record<CallOutcome, string[]> = {
  ended: [],
  rejected: [
    '这次通话的结局是【已拒绝】：对方看到了来电、主动按了「拒绝」按钮——这不是没听到，也不是接通后挂断，就是对方选择不接。',
    '你这条消息就是对「被拒接」这件事的反应：结合你的人设和你们的关系，可以带点小委屈/撒娇/小情绪问问「怎么拒接我呀」「是不是在忙呀」，也可以大度地说等对方方便了再打；情绪浓淡符合人设即可，不要上纲上线。',
  ],
  missed: [
    '这次通话的结局是【未接听】：响了很久一直没人接（不是对方故意按掉拒接，可能是没听到/在忙）。',
    '你这条消息就是对「没接到电话」的反应：可以关心对方在忙什么、提醒「看到未接来电回我一下」，或者约晚点再打；情绪符合人设即可。',
  ],
  cancelled: [
    '这次通话的结局是【已取消】：对方拨给你，但还没等你接就取消了。',
    '你这条消息就是对「对方想找你又取消」的反应：可以自然问问「刚才怎么取消啦」「是不是按错了」，关心对方是不是有什么事；情绪符合人设即可。',
  ],
};

/** 未接通场景的硬性禁止（防止 AI 把「被拒接/没接」说成「接通后被挂断」） */
/** 未接通结局（已拒绝/未接听/已取消）的反应引导：结局硬事实 + 该怎么反应（AI 视角）；'ended' 恒为空（接通场景走另一分支，仅为了让键类型完整）
 *  陌生来电版（callerUnknown）：你不认识对方——反应口吻保持普通/好奇，不撒娇不带亲近情绪 */
const NOT_CONNECTED_RULES_STRANGER: Record<CallOutcome, string[]> = {
  ended: [],
  rejected: [
    '这次通话的结局是【已拒绝】：这个陌生号码看到了来电、没有接——你不认识这个号码。',
    '你这条消息就是对「被拒接」这件事的反应：按你的人设，可以问一句「刚才是你打我电话？」「你是哪位」，也可以不在意；口吻保持普通/好奇，不要用亲近的口吻撒娇或带情绪（你不认识 TA）。',
  ],
  missed: [
    '这次通话的结局是【未接听】：你有个未接来电（陌生号码），响了很久没人接——你不认识这个号码。',
    '你这条消息就是看到未接来电后的反应：按你的人设问一句「刚才是你找我？」「你是哪位」，也可以不在意；你不认识对方，口吻保持普通。',
  ],
  cancelled: [
    '这次通话的结局是【已取消】：一个陌生号码拨给你，还没等你接就取消了——你不认识这个号码。',
    '你这条消息就是对这通陌生来电的反应：可以问「刚才是谁打我电话」，也可以不在意；你不认识对方。',
  ],
};

const NOT_CONNECTED_BANS = [
  '硬性禁止（这次电话没有接通，必须遵守）：',
  '— 禁止说「怎么挂这么快」「刚挂电话」「都没聊上几句」「打了个寂寞」「怎么不说话就挂了」这类把结局说成「接通后被挂断」的话：电话从没接通，根本不存在「挂」这个动作；',
  '— 禁止复述、引用或虚构任何「通话里说过的话」：这次通话没有产生任何对话，不存在任何通话内容，也不要说「刚才电话里你说的…」这类指代；',
].join('\n');

function buildFollowupSystemPrompt(
  peer: PersonaSource,
  scene: string,
  outcome: CallOutcome,
  ended: boolean,
  /** 归一化 endReason（ended 场景 = 'hangup' | 'ai-hangup'）：区分「对方先挂」与「自己告别挂断」 */
  endReason: string,
  /** 接通后结束的真实时长分档（B-3）：zero=刚接通没聊起来 / brief=只说了几句 / while=聊了一会儿；未接通恒 null */
  talkTier: ConnectedTalkTier | null,
  durationLabel: string,
  hasChat: boolean,
  maxCount: number,
  multiApp?: boolean,
  /** 机主称呼（前端直传真名；用户规则：AI 永远不知道机主昵称，body 里的 userNickname 忽略） */
  user?: { name: string | null },
  /** 多账号关系感知：当前账号 id（小号续聊读 relationByAcc；不传 = 大号口径） */
  accountId?: string | null,
  /** 陌生来电（多账号）：匿名号/未登记小号拨出的电话——AI 不知道来电人是谁，
   *  续聊按「刚接到一通陌生电话」框架（机主身份/关系/多端记忆不下发） */
  callerUnknown?: boolean
): string {
  // 条数语义（第四十四轮）：恒 1 条——打完电话只留一次言，想说的全部在这条里说完；
  // replyCount 仍接收但不再消费（旧调用点兼容）；这一条可以是一小段话，不等于短
  const countRule =
    '条数硬约束：本次只发 1 条消息——把你想说的全部放进这一条里（像真人发的一大段话，几句话连着说完），绝不拆成多条。';
  // 接通后结束：按真实时长分档给衔接引导（B-3）——只有「聊了一会儿」才有「接着话茬」资格；
  // 「挂得快」类小情绪只允许「对方先挂」；没聊起来则要求打圆场并硬性禁止虚构通话内容
  const endedRules: string[] =
    talkTier === 'zero'
      ? [
          '这次通话的结局是【接通但没聊起来】：电话刚接通（甚至还没说上话）就结束了，通话里没有任何实际内容。',
          '硬性禁止（这次通话没有实际内容，必须遵守）：禁止编造、复述或指代任何「通话里说过的话」，不要说「刚才电话里你说的…」，也不要把这次通话说成长聊或「聊了一会儿」；',
          '你这条消息就是对「这次没聊起来」的自然打圆场/找补：可以约「晚点再打给你」「刚才正好有点事，没说两句就挂了，回头聊」，或自然关心对方一句；语气符合人设即可，不必过度道歉；',
        ]
      : talkTier === 'brief'
        ? [
            '你们真的说上了，但只聊了几句：可以顺着刚才那几句话的茬自然接一句（补一句没说完的事、约晚点细聊、叮嘱/关心），不要把这次通话说成长谈；',
          ]
        : [
            endReason === 'hangup'
              ? '你们真的聊过：可以接着说通话里没聊完的话茬、补一句刚才没说完的事、叮嘱/约定/关心，也可以对「对方挂断」带点小情绪（比如嫌对方挂得快），但别过度纠缠；'
              : '这通电话是你自己觉得聊得差不多、自然告别后主动挂断的：可以接着说通话里没聊完的话茬、补一句刚才没说完的事、叮嘱/约定/关心；',
          ];
  return buildPersonaSystemPrompt(peer, {
    channel: '挂断电话后的文字消息',
    userName: callerUnknown ? null : (user?.name ?? null),
    multiApp: callerUnknown ? undefined : multiApp,
    accountId: accountId ?? undefined,
    // 陌生来电：人设换「陌生号码来电」框架（角色自身人设保留，来电人身份未知）
    ...(callerUnknown ? { strangerMode: 'caller' as const } : {}),
    extraRules: [
      `你刚结束一通语音通话（${scene}${ended ? `，通话时长 ${durationLabel}` : ''}）。现在像平时发消息那样，主动给对方发文字，自然衔接这件事：`,
      ...(ended
        ? endedRules
        : [
            (callerUnknown ? NOT_CONNECTED_RULES_STRANGER : NOT_CONNECTED_RULES)[outcome][0],
            (callerUnknown ? NOT_CONNECTED_RULES_STRANGER : NOT_CONNECTED_RULES)[outcome][1],
            NOT_CONNECTED_BANS,
          ]),
      countRule,
      '绝对不要复读通话里已经说过的原话；不要自我介绍；不要说「刚才我们通话了」这类出戏的话——就像平时聊微信/QQ 一样接着说；',
      '语气完全符合你的人设和此刻情绪（聊得开心就热络、对方拒接/没接可以有点小委屈、深夜可以带着困意）；',
      '这一条消息像真人发的一段话：口语化，把想说的几件事/没说完的话茧/叮嘱关心连起来说完（一般 2~6 句），不分条、不列清单、不要 markdown 符号、不要引号包裹、不要表情符号；',
      hasChat ? '结合下方最近聊天内容让消息更有来由。' : '没有最近聊天记录时，就纯粹基于人设和这次通话发挥。',
      '严格输出一个 JSON 对象，不要输出任何其他文字：',
      '{"messages":["一条完整的话（想说的全部在这里说完）"]}',
      'messages 数组只放 1 个元素——这一条里把想说的全部说完。',
    ],
  });
}

/** 生成结果清洗（第四十四轮）：JSON 优先（宽松平衡块），失败按行拆；去标记/符号/包裹引号；
 *  恒 1 条：模型不听话拆了多段时合并为一条（标点缺失自动补句号），截断上限 600 字（旧 200 不够「说完全部」） */
function normalizeFollowup(raw: string, max: number): string[] {
  const cap = max <= 1 ? 600 : 200;
  const clean = (s: string) =>
    s
      .replace(/〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g, '')
      .replace(/[*_`#>~]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim()
      .slice(0, cap);
  const mergeToOne = (list: string[]): string[] => {
    if (max > 1 || list.length <= 1) return list.slice(0, max);
    let joined = '';
    for (const seg of list) {
      if (!joined) joined = seg;
      else joined += /[。！？…~～!?]$/.test(joined) ? seg : `。${seg}`;
    }
    return [joined.slice(0, cap)];
  };
  const obj = extractJsonObject(raw);
  if (obj && Array.isArray(obj.messages)) {
    const out = (obj.messages as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map(clean)
      .filter(Boolean);
    if (out.length > 0) return mergeToOne(out);
  }
  return mergeToOne(
    raw
      .split('\n')
      .map((l) => clean(l))
      .filter(Boolean),
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ messages: [] });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  // 对端身份：前端直传联系人（kind='user' 是机主本人，不产生续聊）
  const inline = parseInlineContact(root.contact);
  if (!inline || inline.kind === 'user') {
    return NextResponse.json({ messages: [] });
  }
  const peer: PersonaSource = {
    name: inline.name,
    kind: inline.kind,
    gender: inline.gender,
    age: inline.age,
    height: inline.height,
    weight: inline.weight,
    occupation: inline.occupation,
    company: inline.company,
    region: inline.region,
    persona: inline.persona,
    background: inline.background,
    expressStyle: inline.expressStyle,
    customRules: inline.customRules,
    relation: inline.relation,
    relationByAcc: inline.relationByAcc ?? null,
    relationToUser: inline.relationToUser,
    birthday: inline.birthday,
    nickname: inline.nickname ?? null,
    realName: inline.realName ?? null,
  };
  // 多账号关系感知：前端按当前通话账号传入（activeAccountIdOf）；不传 = 大号口径（零破坏）
  const accountId = typeof root.accountId === 'string' && root.accountId.trim() ? root.accountId.trim().slice(0, 40) : undefined;

  // 条数上限（第四十四轮）：恒 1——打完电话只留一条言，全部想说的话在这条里说完；
  // replyCount 仍读取但不再消费（旧调用点/旧请求兼容）
  const rcRaw = typeof root.replyCount === 'number' && Number.isFinite(root.replyCount) ? Math.floor(root.replyCount) : NaN;
  void rcRaw;
  const maxCount = 1;

  const direction = root.direction === 'in' ? 'in' : 'out';
  const endReasonRaw = typeof root.endReason === 'string' ? root.endReason.trim() : '';
  const connected = root.connected === true;
  // 结局唯一映射（call-outcome.ts）：未知 endReason 绝不默认当「接通后挂断」——
  // 接通→按 hangup/ai-hangup 描述；未接通→按 reject/missed-in/cancel 描述；数据矛盾以未接通为准。
  // endReason 一律由 outcome 反推，保证事实陈述与反应引导永远一致、不自相矛盾
  const outcome = callOutcomeOf(endReasonRaw, connected);
  const endReason =
    outcome === 'ended'
      ? endReasonRaw === 'ai-hangup'
        ? 'ai-hangup'
        : 'hangup'
      : outcome === 'rejected'
        ? 'reject'
        : outcome === 'cancelled'
          ? 'cancel'
          : 'missed-in';
  const duration = typeof root.duration === 'number' && Number.isFinite(root.duration) ? Math.max(0, Math.floor(root.duration)) : 0;
  const durationLabel = duration >= 60 ? `${Math.floor(duration / 60)} 分 ${duration % 60} 秒` : `${duration} 秒`;
  const transcript = normalizeHistory(root.transcript);
  const recentChat = normalizeHistory(root.recentChat);

  // B-3：接通后结束按真实通话时长分档注入场景文（0/极短=刚接通没聊起来，3~10s=只说了几句，>10s=聊了一会儿），
  // 短通话同步注入「禁止编造通话内容」约束——AI 对「没聊起来」打圆场，不再被「聊了一会儿+接着话茬」逼着虚构
  const ended = outcomeConnected(outcome);
  const talkTier = ended ? talkTierOf(duration) : null;
  const sceneText = ended
    ? connectedSceneText(endReason === 'hangup', talkTier as ConnectedTalkTier, transcript.length > 0)
    : SCENE_TEXT[endReason];

  const system = buildFollowupSystemPrompt(
    peer,
    sceneText,
    outcome,
    ended,
    endReason,
    talkTier,
    durationLabel,
    recentChat.length > 0,
    maxCount,
    root.multiApp === true || root.multiApp === false ? (root.multiApp as boolean) : undefined,
    // 机主称呼：前端直传真名（用户规则：AI 永远不知道机主昵称——body 里的 userNickname 直接忽略）
    (() => {
      if (root.callerUnknown === true) return undefined;
      const real = typeof root.userRealName === 'string' ? root.userRealName.trim() : '';
      return real ? { name: real } : undefined;
    })(),
    // 多账号关系感知：小号续聊读分账号关系，不再恒用大号全局 relation
    accountId,
    // 陌生来电（多账号）：匿名号/未登记小号拨出——续聊按「刚接到陌生电话」框架
    root.callerUnknown === true
  );
  // 通话媒体（Task 22 视频通话）：视频通话时补一行媒体说明，AI 的后续文字知道刚才/刚才那通是视频
  const media = root.media === 'video' ? 'video' : 'voice';
  const mediaBlock = media === 'video' ? '【补充】刚才的通话是视频通话（双方能看到对方画面），相关表述按视频通话来，不要说成打电话。' : '';
  // 记忆 / 世界书 / 时间感知：前端组装注入（与通话轮次同一套来源，人设 > 世界书 > 记忆 > 时间）
  const memoryBlock = typeof root.memoryBlock === 'string' ? root.memoryBlock.trim() : '';
  // 跨 App 近况块 + 群聊近况块（Task 40-b）：与通话轮次同位置（当前 App 记忆之后）注入，空串跳过
  const crossAppBlock = typeof root.crossAppBlock === 'string' ? root.crossAppBlock.trim() : '';
  const groupBlock = typeof root.groupBlock === 'string' ? root.groupBlock.trim() : '';
  const worldbookBlock = typeof root.worldbookBlock === 'string' ? root.worldbookBlock.trim() : '';
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';
  const systemFull = [system, worldbookBlock, memoryBlock, crossAppBlock, groupBlock, timeBlock, mediaBlock].filter(Boolean).join('\n\n');

  // 触发消息：把「最近聊天 + 通话转写」打包成一段上下文（user/assistant 双方已标注），避免与消息角色混淆
  // 陌生来电（多账号）：用户侧称谓不再用「机主」（AI 不知道来电人是谁）
  const userLabel = root.callerUnknown === true ? '对方' : '机主';
  const recap: string[] = [];
  if (recentChat.length > 0) {
    recap.push('【通话前的最近聊天】');
    recap.push(...recentChat.map((m) => `${m.role === 'user' ? userLabel : '你'}：${m.content}`));
    recap.push('');
  }
  if (!outcomeConnected(outcome)) {
    // 未接通：显式强调没有通话内容（与 system 的结局事实双重对齐）；误传的转写不进上下文（防自相矛盾）
    recap.push('【关于这次通话】没有接通，没有产生任何通话内容（上面的聊天记录是文字消息，不是通话内容）。');
    recap.push('');
  } else if (talkTier === 'zero') {
    // 刚接通就结束（B-3）：与 system 的「没有实际内容」双重对齐，AI 无从把 0 秒通话脑补成一段聊天；
    // 即使有一两句转写也只是刚开口的只言片语，明确「不算聊过什么」
    recap.push('【关于这次通话】电话刚接通（甚至还没说上话）就结束了，没有实际通话内容（上面的聊天记录是文字消息，不是通话内容）。');
    if (transcript.length > 0) {
      recap.push('仅有的通话转写（刚接通时说出口的只言片语，不算聊过什么）：');
      recap.push(...transcript.map((m) => `${m.role === 'user' ? userLabel : '你'}（说出口的话）：${m.content}`));
    }
    recap.push('');
  } else if (transcript.length > 0) {
    recap.push('【这次通话里你们说的话】');
    recap.push(...transcript.map((m) => `${m.role === 'user' ? userLabel : '你'}（说出口的话）：${m.content}`));
    recap.push('');
  }
  recap.push('（通话已结束，请输出你要发给对方的文字消息 JSON）');
  const messages: CallApiMessage[] = [{ role: 'system', content: systemFull }, { role: 'user', content: recap.join('\n') }];

  const fail = () => NextResponse.json({ messages: [] });

  const config = extractUpstreamConfig(root.config);
  if (!config) return fail(); // v82：未配置——后续消息是后台体验增强，静默跳过
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return fail();
  }
  // 内网 / 本机地址：云端不可达 → 浏览器直连（与 turn 路由同策略，保住用户自己的模型）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ directOnly: true, messages });
  }
  // 条数多时输出更长：抬高 max_tokens 下限，防止多条消息被截断（与聊天流 bus 同策略）
  const result = await callUpstream({ ...config, maxTokens: Math.max(config.maxTokens, maxCount * 250) }, messages);
  if (result.reply) {
    const parsed = normalizeFollowup(result.reply, maxCount);
    if (parsed.length > 0) return NextResponse.json({ messages: parsed });
  }
  // 上游故障 / 解析不出（v82：不再内置兜底）→ 静默跳过
  return fail();
}
