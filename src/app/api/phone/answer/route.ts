import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 通话接听决策（AI 决定接听 / 拒绝 / 不接）——微信 / QQ / 电话 App 三端共用：
 *
 * 机主打给 AI 联系人时，响铃期间调用本 API，让 AI 基于
 * 人设 / 与机主的关系 / 当前时间与状态（深夜、忙碌、睡觉、生病、刚吵完架…）/ 最近聊天内容
 * 决定：接听（answer）· 拒绝（reject，几声铃后挂断）· 不接（miss，响到超时无人接听）。
 * 拒绝 / 不接时附一条 afterText——「稍后」AI 会以文字（微信/QQ）或语音留言（电话 App）
 * 主动解释为什么没接。
 *
 * POST { contact, number, recentChat, timeBlock?, config, callerUnknown? }
 * 返回 { decision: 'answer' | 'reject' | 'miss', afterText?, viaSdk? }
 * 任何失败（未配置 / 上游故障 / 解析不出）都兜底 answer——宁可多接，不让用户白等。
 */

import { extractThinkBlocks } from '@/lib/think-filter';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import {
  type CallApiMessage,
  callUpstream,
  extractJsonObject,
  extractUpstreamConfig,
  isPrivateHost,
  normalizeHistory,
  parseInlineContact,
  unknownPersona,
} from '@/lib/ios/call-upstream';

export interface AnswerDecision {
  decision: 'answer' | 'reject' | 'miss';
  /** 拒绝/不接后 AI 稍后发的解释文字（符合人设口语，1~2 句） */
  afterText?: string;
  viaSdk?: boolean;
}

function buildDecisionSystemPrompt(
  peer: Parameters<typeof buildPersonaSystemPrompt>[0],
  hasChat: boolean,
  /** 机主称呼（前端直传真名；用户规则：AI 永远不知道机主昵称，body 里的 userNickname 忽略） */
  user?: { name: string | null },
  /** 跨 App 身份感知（与 followup 同口径；undefined=不注入） */
  multiApp?: boolean,
  /** 多账号关系感知：当前账号 id（小号来电读 relationByAcc；不传 = 大号口径） */
  accountId?: string | null,
  /** 陌生来电（多账号）：匿名号/未登记小号拨出——AI 不知道来电人是谁，按陌生来电决策 */
  callerUnknown?: boolean
): string {
  // 陌生来电：决策情境整体换「陌生号码呼入」框架（机主称呼/关系/多端记忆不适用）
  const sceneRules: string[] = callerUnknown
    ? [
        '你的电话正在响铃，来电的是一个陌生号码——你不认识对方，完全不知道 TA 是谁。请代入你的人设和此刻的真实状态，判断你会不会接这个陌生来电：',
        '接不接完全按你的性格来：好奇心重/礼貌/正好闲着的人可以接；警惕、讨厌陌生来电、正忙/正睡觉的人可以不接或拒接；',
        '「拒绝」（几声铃就挂断）适合：明确不想接陌生电话、正在气头上、故意的；「不接」（响到超时也无人接）适合：没听到、睡着了、不想接；',
        hasChat
          ? '结合下方最近聊天内容判断（但你不认识来电人）。'
          : '你不知道来电的人是谁，按你的人设和当下状态处理。',
        '严格输出一个 JSON 对象，不要输出任何其他文字：',
        '{"decision":"answer或reject或miss","afterText":"..."}',
        'decision 取值：answer=接听；reject=拒绝（响几声就挂）；miss=不接（一直响到无人接听）。',
        'afterText：只有 reject / miss 时需要——你不接这通陌生来电，过一会儿给这个号码留一句解释，完全符合你的人设和口语习惯（如「不接陌生电话哦」「哪位啊？睡了」），1~2 句；answer 时给空字符串。',
      ]
    : [
        '机主（你的联系人）刚刚拨通了你的电话，你正在响铃。请完全代入你的人设、你们的关系和此刻的真实状态，判断你会不会接这通电话：',
        '大多数情况下应该接（熟人来电、正闲着、关系亲近、正聊得起劲……）；',
        '只有当下确实不方便时才不接：深夜/凌晨正睡觉、正在上班/上课/开会/开车/洗澡、身体不舒服、刚吵完架还在气头上、你人设里正在忙别的重要事情、最近聊天显示你们关系冷淡等；',
        '「拒绝」（几声铃就挂断）适合：明确不想接、正在气头上、故意的；「不接」（响到超时也无人接）适合：没听到、睡着了、不方便只能不接；',
        hasChat
          ? '结合下方最近聊天内容判断你们此刻的关系氛围。'
          : '没有最近聊天记录时，默认按你们平常的关系正常处理（通常应该接）。',
        '严格输出一个 JSON 对象，不要输出任何其他文字：',
        '{"decision":"answer或reject或miss","afterText":"..."}',
        'decision 取值：answer=接听；reject=拒绝（响几声就挂）；miss=不接（一直响到无人接听）。',
        'afterText：只有 reject / miss 时需要——你过一会儿发给机主的解释文字，完全符合你的人设和口语习惯，1~2 句（如「刚在开会，怎啦？」「呼啥呢，睡了啦」），拒绝可以带点情绪，不接可以事后关心；answer 时给空字符串。',
      ];
  return buildPersonaSystemPrompt(peer, {
    channel: '决定是否接听一通来电',
    userName: callerUnknown ? null : (user?.name ?? null),
    multiApp: callerUnknown ? undefined : multiApp,
    accountId: accountId ?? undefined,
    // 陌生来电：人设换「陌生号码来电」框架（角色自身人设保留，来电人身份未知）
    ...(callerUnknown ? { strangerMode: 'caller' as const } : {}),
    extraRules: sceneRules,
  });
}

/** 决策结果清洗：非法值一律兜底 answer */
function normalizeDecision(raw: string): AnswerDecision {
  const obj = extractJsonObject(raw);
  if (!obj) return { decision: 'answer' };
  const d = typeof obj.decision === 'string' ? obj.decision.trim().toLowerCase() : '';
  const decision: AnswerDecision['decision'] = d === 'reject' || d === 'miss' ? d : 'answer';
  // [思考]块兜底剥离（A1）：模型跨链路模仿单聊习惯时会把思考写进 afterText 字段或裹在
  // JSON 外——思考内容会被当成留言朗读/落进气泡，必须剥掉
  const afterRaw = extractThinkBlocks(typeof obj.afterText === 'string' ? obj.afterText : '').text.trim();
  // 去掉可能包裹的引号与 markdown 残留（解释文字要作为聊天气泡/留言原文呈现）
  const afterText = afterRaw
    .replace(/[*_`#>~[\]]/g, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .slice(0, 200);
  return {
    decision,
    ...(decision !== 'answer' && afterText ? { afterText } : {}),
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const number = typeof root.number === 'string' && root.number.trim() ? root.number.trim() : '10086';
  const recentChat = normalizeHistory(root.recentChat);
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';

  // 对端身份：前端直传联系人 / 陌生号码（陌生人默认接，不浪费决策）
  const inline = parseInlineContact(root.contact);
  if (!inline || inline.kind === 'user') {
    return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
  }
  const peer = {
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

  // 机主身份：前端直传真名（用户规则：AI 永远不知道机主昵称——body 里的 userNickname 直接忽略）
  const userReal = typeof root.userRealName === 'string' ? root.userRealName.trim() : '';
  const multiApp = root.multiApp === true || root.multiApp === false ? (root.multiApp as boolean) : undefined;
  const accountId = typeof root.accountId === 'string' && root.accountId.trim() ? root.accountId.trim().slice(0, 40) : undefined;
  // 陌生来电（多账号）：匿名号/未登记小号拨出——决策换陌生框架，机主身份不下发
  const callerUnknown = root.callerUnknown === true;
  const system = buildDecisionSystemPrompt(
    peer,
    recentChat.length > 0,
    callerUnknown ? undefined : userReal ? { name: userReal } : undefined,
    multiApp,
    accountId,
    callerUnknown
  );
  const messages: CallApiMessage[] = [
    { role: 'system', content: [system, timeBlock].filter(Boolean).join('\n\n') },
    // 上游要求 user 消息收尾：把最近聊天作为判断依据 + 触发决策
    ...(recentChat.length > 0
      ? recentChat.map((m) => ({ role: m.role, content: m.content }) as CallApiMessage)
      : []),
    { role: 'user', content: '（你的手机正在响铃，是上面这位联系人的来电。请输出你的接听决策 JSON）' },
  ];

  const config = extractUpstreamConfig(root.config);
  if (!config) {
    // v82：内置模型已移除——未配置直接走默认接听（决策是后台体验增强，不阻断来电）
    return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
  }
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
  }
  // 内网地址：云端不可达 → 默认接听（决策是后台体验增强，不走浏览器直连）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
  }
  const result = await callUpstream(config, messages);
  if (result.reply) {
    return NextResponse.json(normalizeDecision(result.reply) satisfies AnswerDecision);
  }
  // 上游故障（v82：不再内置兜底）→ 默认接听
  return NextResponse.json({ decision: 'answer' } satisfies AnswerDecision);
}
