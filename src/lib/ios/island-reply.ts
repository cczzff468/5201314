'use client';

/**
 * 通知横幅快捷回复（v1.9.7）——灵动岛通知卡点击展开全文 + 输入框，不点进 APP 就能回信息。
 *
 * 覆盖范围（只对「单聊且有联系人」的目标提供输入框）：
 * - 微信单聊（target {app:'wechat', contactId}）/ QQ 单聊（target {app:'qq', contactId}）
 * - 信息端联系人会话（target {app:'chat', contactId}，sessionKey 形如 sms:c:<cid>）；
 * 群聊（带 groupId）/ 小助手会话（信息端 target 无 contactId）/ 美团淘宝订单通知（订单 id 非联系人）
 * 只展开全文不提供输入——群聊回复有自己的成员决策管线、订单目标没有「回信息」语义。
 *
 * 目标会话正被用户查看（isProactiveChatActive）时同样不提供输入：聊天页组件持有 msgs
 * 内存态并有整存落盘 effect，外部直写 kv 会被覆盖（数据丢失风险）；且此时屏幕下方就是
 * 聊天输入框，快捷回复无意义。
 *
 * 回复管线（目标聊天页未挂载时的独立路径，与 AI 主动消息/三端聊天同口径）：
 * ① 用户消息按三端 ChatView send() 同构形态落盘（kv 键与字数上限一致）；
 * ② 人设 + 记忆召回 + 跨 App 近况 + 社交动态 + 动态情绪状态 + 时间感知 → LLM 生成回复
 *   （多行 = 多条气泡，清洗规则与主动消息 generateProactiveTexts 同口径）；
 * ③ scheduleAiDelivery 逐条投递：落盘 + pushChatNotification（横幅/系统通知逐条弹）+
 *   未读角标（会话正被查看不计数，与主动消息 deliverProactiveMsg 同闸）；
 * ④ memAfterAiTurn 写记忆管线（与三端聊天/主动消息同口径）。
 * 生成按会话串行排队（genTails）——连发多条时每条都有回复轮，且互不重叠。
 */

import { genId } from './db';
import { kvGet, kvSet } from './idb-kv';
import { getActiveAccountIdFor, type AccountApp } from './accounts';
import { getContact, listContacts, ownerProfileFor, cachedOwnerName } from './contacts-store';
import { avatarFor, type ContactAvatarApp, type ContactRecord } from '@/lib/contacts';
import { buildPersonaSystemPrompt } from './persona';
import { buildDynamicStateBlocks } from './ai-mood';
import { buildNpcPromptExtra } from './npc-bond';
import { loadBlock } from './block-state';
import { getMemSettings, memChatRecallBlock, memAfterAiTurn, memConvoFromRaw } from '@/lib/memory';
import { buildMomentsChatBlock } from '../moments';
import { buildCrossAppBlock } from './cross-app-context';
import { buildTimeAwareBlock, getTimeAware } from '@/lib/time-aware';
import { extractThinkBlocks } from '@/lib/think-filter';
import { stripLiteralQuotePrefix } from '@/lib/chat-rich';
import { scheduleAiDelivery, isAiDelivering } from './ai-delivery';
import { isChatStreaming } from '@/lib/chat-stream-store';
import { pushChatNotification, type NotifyTarget } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { useSettings } from './store';
import type { ApiConfig } from './store';
// 内网地址的浏览器直连兜底（与三端聊天 runAiTurn 同策略：directChatStream + CORS 兜底）
import { directChatStream, isPrivateApiUrl } from './direct-api';

// ---------------- 目标解析 ----------------

/** 通知 App → 三端聊天端标识（非聊天端返回 null） */
export function mapNotifyAppToChatApp(app: NotifyTarget['app']): 'wx' | 'qq' | 'sms' | null {
  if (app === 'wechat') return 'wx';
  if (app === 'qq') return 'qq';
  if (app === 'chat') return 'sms';
  return null;
}

/**
 * 横幅是否可快捷回复：三端单聊目标（有 contactId 且非群聊）。
 * 小助手会话/订单目标天然无 contactId → false；群聊显式排除。
 */
export function isReplyableNotifyTarget(target: NotifyTarget): boolean {
  const app = mapNotifyAppToChatApp(target.app);
  return !!app && !!target.contactId && !target.groupId;
}

/** 横幅目标会话是否正被用户查看（聊天页挂载中——此时不提供快捷回复输入框） */
export function isReplyTargetChatActive(target: NotifyTarget): boolean {
  const app = mapNotifyAppToChatApp(target.app);
  if (!app || !target.contactId || target.groupId) return false;
  return isProactiveChatActive(app, target.contactId);
}

function sessionKeyOf(app: 'wx' | 'qq' | 'sms', cid: string): string {
  return app === 'wx' ? `wx:${cid}` : app === 'qq' ? `qq:${cid}` : `sms:c:${cid}`;
}

/** 三端消息 kv 键（与 proactive-msg.msgsKeyOf 同源） */
function msgsKeyOf(app: 'wx' | 'qq' | 'sms', cid: string): string {
  return app === 'wx' ? `wx-chat-msgs:${cid}` : app === 'qq' ? `qq-chat-msgs:${cid}` : `ios-chat-msgs:c:${cid}`;
}

// ---------------- 消息历史归一化（与 proactive-msg.readNormMsgs 同口径；回复上下文用） ----------------

interface NormMsg {
  role: 'user' | 'assistant';
  text: string;
  time: number;
}

function extractMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.error === true) return '';
  if (r.sys || r.blkreq || r.notice) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  if (kind === 'call' || kind === 'redpacket' || kind === 'transfer' || kind === 'family' || kind === 'forward' || kind === 'groupcard' || kind === 'blockreq' || kind === 'sys' || kind === 'textcard') {
    return '';
  }
  const content = typeof r.content === 'string' ? r.content.trim() : '';
  const voice = r.voice as { transcript?: unknown; localText?: unknown } | undefined;
  if (kind === 'voice') {
    const t = typeof voice?.transcript === 'string' ? voice.transcript.trim() : '';
    if (t) return t;
    const l = typeof voice?.localText === 'string' ? voice.localText.trim() : '';
    if (l) return l;
    return content && !content.startsWith('data:') ? content : '[语音]';
  }
  switch (kind) {
    case 'image': {
      const img = r.img as { desc?: unknown } | undefined;
      const d = typeof img?.desc === 'string' ? img.desc.trim() : '';
      return d ? `[图片] ${d}` : '[图片]';
    }
    case 'sticker': {
      const stk = r.stk as { meaning?: unknown } | undefined;
      const d = typeof stk?.meaning === 'string' ? stk.meaning.trim() : '';
      return d ? `[表情包] ${d}` : '[表情]';
    }
    case 'location': {
      const loc = r.loc as { name?: unknown } | undefined;
      const d = typeof loc?.name === 'string' ? loc.name.trim() : '';
      return d ? `[位置] ${d}` : '[位置]';
    }
    default:
      if (!content) return '';
      return content.startsWith('data:') ? '[图片]' : content;
  }
}

function readNormMsgs(app: 'wx' | 'qq' | 'sms', cid: string): NormMsg[] {
  const raw = kvGet<unknown>(msgsKeyOf(app, cid));
  if (!Array.isArray(raw)) return [];
  const out: NormMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const role = r.role === 'user' || r.role === 'me' ? ('user' as const) : r.role === 'assistant' || r.role === 'peer' ? ('assistant' as const) : null;
    if (!role || typeof r.time !== 'number') continue;
    const text = extractMsgText(r);
    if (!text.trim()) continue;
    out.push({ role, text, time: r.time });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------- LLM 调用（服务端代理 → 浏览器直连 → 内置模型，与三端聊天 runAiTurn 同策略） ----------------

/** /api/chat 对内网地址返回 502 + directOnly 标记（让客户端浏览器直连） */
const DIRECT_ONLY = Symbol('direct-only');

/** 服务端代理调用（返回文本 / DIRECT_ONLY 标记 / 空串=失败） */
async function callViaProxy(body: Record<string, unknown>): Promise<string | typeof DIRECT_ONLY> {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) {
      let directOnly = false;
      try {
        const data = (await res.clone().json()) as { directOnly?: unknown } | null;
        directOnly = data?.directOnly === true;
      } catch {
        /* 非 JSON 错误体按非 directOnly */
      }
      return directOnly ? DIRECT_ONLY : '';
    }
    return await res.text();
  } catch {
    return '';
  }
}

async function callLlmTwoTier(system: string, userContent: string, apiConfig: ApiConfig): Promise<string> {
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: userContent },
  ];
  const viaDirect = (): Promise<string> =>
    directChatStream(apiConfig, messages, () => undefined, 75_000).catch(() => '');
  let raw = '';
  if (isPrivateApiUrl(apiConfig.baseUrl)) {
    // 内网地址：云端服务器必然不可达，浏览器直连优先（directChatStream 自带 CORS 兑底与参数兼容重试）
    raw = await viaDirect();
    if (!raw.trim()) raw = await callViaProxy({ messages, config: apiConfig }).then((r) => (r === DIRECT_ONLY ? '' : r));
  } else {
    const first = await callViaProxy({ messages, config: apiConfig });
    raw = first === DIRECT_ONLY ? await viaDirect() : first;
    if (!raw.trim()) raw = await viaDirect();
  }
  if (!raw.trim()) raw = await callViaProxy({ messages, forceSdk: true }).then((r) => (r === DIRECT_ONLY ? '' : r));
  return raw;
}

// ---------------- 生成 ----------------

/** 单轮回复气泡条数保护上限（快捷回复通常 1~3 条，防模型失控连发刷屏） */
const REPLY_MAX_BUBBLES = 6;
/** 上下文最近消息条数 */
const CONTEXT_TURNS = 12;

/** 回复生成规则（人设 extraRules；口径对齐主动消息 genRules） */
function replyRules(timeAware: boolean): string[] {
  const rules = [
    '【快捷回复场景】对方刚发来一条新消息，你现在要直接回复——就像平时聊天一样自然口语化。',
    '回复内容可长可短完全由你决定：可以只回一句，也可以一口气说一大段，还可以拆成几条连发（每条单独一行）——长短和条数没有任何数字限制。禁止标题、解释、括号说明、JSON、markdown，禁止用引号把整条消息包起来。',
    '结合你们的关系、人设、记忆和最近聊过的内容自然回应；下面注入的记忆、跨 App 近况、社交动态都是你亲身经历的事：可以自然接着聊，但内容必须有来处——绝不能编造记录里没有的细节。',
    '【社交动态归属红线】朋友圈/QQ空间动态都带归属标注：标「用户本人」的才是对方发的动态，标「AI角色本人，就是你自己」的是你自己发的——绝不能把自己发的动态说成对方发的（反之亦然）；归属看不清就不要提动态。',
    '不要重复你最近已经说过的话，也不要复述对方的话；不要每次都用同一种开头。',
  ];
  if (timeAware) rules.push('内容必须符合当前真实时间（深夜别元气满满问吃了吗、早上适合问早、饭点可以聊吃的）。');
  return rules;
}

/** 生成一条用户消息的 AI 回复（多行 = 多条气泡；清洗与主动消息同口径） */
async function generateReplyTexts(app: 'wx' | 'qq' | 'sms', contact: ContactRecord, userText: string): Promise<string[]> {
  const cid = contact.id;
  const sessionKey = sessionKeyOf(app, cid);
  const norm = readNormMsgs(app, cid);
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const userName = owner?.realName || '用户';

  // 时间感知开关（会话级设置；与主动消息同口径）
  const timeAwareOn = getTimeAware(sessionKey);
  const timeBlock = timeAwareOn
    ? buildTimeAwareBlock({ lastMsgTime: norm.length > 0 ? norm[norm.length - 1].time : null, regionHint: contact.region || null })
    : '';

  const disclosureText = norm
    .filter((m) => m.role === 'user')
    .slice(-6)
    .map((m) => m.text)
    .join(' ');
  const allContacts = await listContacts().catch(() => [] as ContactRecord[]);
  const npcExtra = buildNpcPromptExtra(contact, allContacts) as unknown as Record<string, unknown> | null;
  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(cid).share,
    accountId: getActiveAccountIdFor(app as AccountApp),
    extraRules: replyRules(timeAwareOn),
    ...(npcExtra ?? {}),
  });
  const memoryBlock = memChatRecallBlock(cid, app, [userText, disclosureText].filter(Boolean).join(' '), {
    disclosureText: disclosureText || undefined,
    altMainName: cachedOwnerName() || undefined,
    altMainRelation: contact.relation?.trim() || '',
  });
  const momentsBlock = buildMomentsChatBlock({
    contactId: cid,
    app,
    userName,
    userRealName: owner?.realName || undefined,
    peer: contact,
  });
  const crossAppBlock = await buildCrossAppBlock(cid, app, userName).catch(() => '');

  // 用户在场（userPresent: true）——快捷回复就是对用户消息的即时回应
  const system = [persona, memoryBlock, crossAppBlock, momentsBlock, timeBlock, buildDynamicStateBlocks(cid, { userPresent: true })]
    .filter(Boolean)
    .join('\n\n');

  // user prompt：最近聊天 + 本次新消息 + 输出要求
  const recent = norm.slice(-CONTEXT_TURNS);
  const recentLines = recent
    .map((m) => (m.role === 'user' ? `${userName}：${m.text}` : `${contact.name}：${m.text}`))
    .join('\n');
  const parts: string[] = [];
  if (recentLines.trim()) parts.push(`【最近聊天】\n${recentLines}`);
  parts.push(
    `【现在】\n对方刚发来一条新消息：「${userText}」。请直接输出你要回复的正文（只有正文，不要任何前后缀）。可以是一两句、一大段，或者拆成多条（每条一行）——按你此刻想说的自然决定。`,
  );
  const user = parts.join('\n\n');

  const raw = await callLlmTwoTier(system, user, useSettings.getState().apiConfig);
  // 清洗：[思考]块剥离 → 去引号包裹/前缀说明 → 按行拆条 → 去重（与主动消息 generateProactiveTexts 同口径）
  let text = extractThinkBlocks(raw ?? '').text.trim();
  text = text.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  text = text.replace(/^(好的[，,]?|以下是?我的?回复[：:]?)\s*/i, '').trim();
  const cleanLine = (s: string): string =>
    stripLiteralQuotePrefix(s)
      .replace(/^[-–—•·\d.、]+\s*/, '')
      .replace(/^[「"'『]+|[」"'』]+$/g, '')
      .trim();
  const lines = text
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
  const uniq: string[] = [];
  for (const l of lines) if (!uniq.includes(l)) uniq.push(l);
  if (uniq.length > 0) return uniq.slice(0, REPLY_MAX_BUBBLES);
  return [text].filter(Boolean);
}

// ---------------- 投递（与主动消息 deliverProactiveMsg 同管线；不做主动消息簿记） ----------------

async function deliverReply(app: 'wx' | 'qq' | 'sms', contact: ContactRecord, texts: string[]): Promise<void> {
  if (texts.length === 0) return;
  const cid = contact.id;
  const sessionKey = sessionKeyOf(app, cid);
  const notifyApp = app === 'wx' ? ('wechat' as const) : app === 'qq' ? ('qq' as const) : ('chat' as const);
  const now = Date.now();
  const msgs = texts.map((t, i) =>
    app === 'sms'
      ? { id: genId(), role: 'assistant' as const, content: t, time: now + i * 50, kind: 'text' as const }
      : { id: genId(), role: 'peer' as const, content: t, time: now + i * 50, kind: 'text' as const },
  );

  const saveOne = (m: (typeof msgs)[number]): void => {
    try {
      const raw = kvGet<unknown[]>(msgsKeyOf(app, cid));
      const list = Array.isArray(raw) ? raw : [];
      kvSet(msgsKeyOf(app, cid), [...list, m].slice(-(app === 'sms' ? 100 : 200)));
    } catch {
      /* 落库失败静默 */
    }
  };

  await scheduleAiDelivery(
    sessionKey,
    msgs,
    (m) => {
      saveOne(m);
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, app),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isProactiveChatActive(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else if (app === 'qq') qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );

  // 记忆管线（与三端聊天 memAfterAiTurn / 主动消息同口径）
  try {
    const apiCfg = useSettings.getState().apiConfig;
    const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
    const getRaw = (): unknown[] => {
      const r = kvGet<unknown>(msgsKeyOf(app, cid));
      return Array.isArray(r) ? r : [];
    };
    memAfterAiTurn(
      cid,
      app as AccountApp,
      apiCfg,
      () => memConvoFromRaw(getRaw(), contact.name),
      getRaw,
      { user: owner?.realName || null, peer: contact.name },
      { scene: '通知横幅快捷回复' },
    );
  } catch {
    /* 记忆失败不影响投递 */
  }
}

// ---------------- 发送入口 ----------------

export type IslandReplyResult = 'sent' | 'busy' | 'blocked' | 'fail';

/** 每会话生成串行队列：连发多条时每条都有回复轮，互不重叠 */
const genTails = new Map<string, Promise<void>>();
/** dev 调试：最近一次生成/投递失败原因（E2E 排查用，生产恒 null） */
let lastGenError: string | null = null;

function enqueueGeneration(sessionKey: string, run: () => Promise<void>): void {
  const prev = genTails.get(sessionKey) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  genTails.set(sessionKey, next);
  void next.catch(() => undefined).finally(() => {
    if (genTails.get(sessionKey) === next) genTails.delete(sessionKey);
  });
}

/**
 * 横幅快捷回复发送：
 * - 会话正被查看/目标不可回复 → 调用方本就不该展示输入框（不在此重复拦截）；
 * - 对方回复中（流式接收或连发投递未清）→ 用户消息照常落盘，返回 'busy'
 *   （不叠加生成——in-flight 回复继续走，防双回复时序错乱）；
 * - 被角色拉黑（byChar）→ 'blocked'（消息不落库，与三端 send() 拦截同口径）；
 * - 正常 → 用户消息落盘 + 后台串行生成投递（立即返回 'sent'，AI 回复稍后逐条弹出）。
 */
export async function sendIslandReply(target: NotifyTarget, text: string): Promise<IslandReplyResult> {
  const body = text.trim();
  const app = mapNotifyAppToChatApp(target.app);
  const cid = target.contactId;
  if (!body || !app || !cid || target.groupId) return 'fail';
  const sessionKey = sessionKeyOf(app, cid);
  if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return 'busy';
  if (loadBlock(app, cid).byChar) return 'blocked';
  const contact = await getContact(cid);
  if (!contact || contact.kind === 'user') return 'fail';

  // ① 用户消息落盘（与三端 ChatView send() 同构形态：wx 带 unread、三端均 kind='text'）
  const now = Date.now();
  const userMsg =
    app === 'sms'
      ? { id: genId(), role: 'user' as const, content: body, time: now, kind: 'text' as const }
      : { id: genId(), role: 'me' as const, content: body, time: now, kind: 'text' as const, ...(app === 'wx' ? { unread: true } : {}) };
  try {
    const raw = kvGet<unknown[]>(msgsKeyOf(app, cid));
    const list = Array.isArray(raw) ? raw : [];
    kvSet(msgsKeyOf(app, cid), [...list, userMsg].slice(-(app === 'sms' ? 100 : 200)));
  } catch {
    return 'fail';
  }

  // ② 后台串行生成 + 投递（生成中再次发送 → 排到本轮之后，不重叠）
  enqueueGeneration(sessionKey, async () => {
    try {
      // 排到的这一轮若会话已 busy（用户进了聊天页触发了原生回复轮），本轮让位
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
      const texts = await generateReplyTexts(app, contact, body);
      await deliverReply(app, contact, texts);
      lastGenError = null;
    } catch (err) {
      // 生成/投递失败静默——用户消息已落盘，进聊天页可再发；dev 下留痕供 E2E 排查
      lastGenError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  });
  return 'sent';
}

// 测试钩子（仅 dev）：E2E 排查生成链路失败原因
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as unknown as { __islandReplyDebug?: { lastError: () => string | null; tails: () => number } };
  w.__islandReplyDebug = {
    lastError: () => lastGenError,
    tails: () => genTails.size,
  };
}
