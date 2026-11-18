'use client';

/**
 * 真机微信接入（微信官方 iLink Bot 通道）——连接状态中心 · v3。
 *
 * v3 协议对齐（根治「此 OpenClaw 的运行环境存在风险，暂无法连接」）：
 * 此前实现与官方插件协议（Tencent/openclaw-weixin docs/protocol_zh_CN.md，2026-11 现行）
 * 有七处偏差——①状态轮询 3s 猖狂打接口（官方是 35s 长轮询，猖狂轮询本身就是风控信号）；
 * ②取码请求体空（官方要带 local_token_list，后端靠它认出「这台环境之前绑过哪个 bot」，
 * 直接关系到重绑能否放行）；③请求头缺失（取码要 AuthorizationType+X-WECHAT-UIN，状态
 * 轮询要 iLink-App-Id/ClientVersion，代理已按路径自动补齐）；④base_info 版本过老（1.0.2 →
 * 2.4.10，后端按版本识别客户端代际）；⑤不支持 PIN 校验（微信即将强制：扫码后手机上
 * 显示数字，需回传 verify_code）；⑥不支持 scaned_but_redirect 换域轮询；⑦不支持
 * binded_redirect（已绑到其它环境）与 verify_code_blocked（错太多次换码重试）。
 *
 * v3 全部补齐：取码带 local_token_list（本机 bot token 历史，断开重接同一环境能认出亲缘）；
 * 状态改为串行长轮询（服务端挂 ~35s，网络失败视作 wait 续轮）；PIN 状态机（need_verifycode →
 * UI 输入 → verify_code 随下一轮上报，错码重输，verify_code_blocked 自动换码≤3次）；
 * scaned_but_redirect 切 redirect_host 续轮；binded_redirect 给出解绑引导；confirmed 保存
 * baseurl 并用于后续 Bot API（代理 host 白名单转发）。
 *
 * v2 方向不变：接入的目的是「你本人在真机微信上和 TA（AI 角色）聊天」，不是替你自动回复好友。
 * 用法：拿一个微信号（建议小号）扫我们生成的二维码 → 那个微信号就变成绑定的 AI 角色 →
 * 用你常用的微信加 TA 为好友，直接聊。
 *
 * 通道说明：ilinkai.weixin.qq.com 是微信官方对 Bot 开放的通道，扫码授权拿 bot_token，
 * 收发全是无状态 HTTP（getupdates 长轮询 + sendmessage）。二维码：iLink 返回的
 * qrcode_img_content 是授权页 URL（不是图片！），用 qrcode 库在本地生成二维码图。
 *
 * 持久化（同 music-login-qq 模式：内存明文 + AES-GCM 密文 kv）：
 * - kv 'wx-ilink-login'：登录凭证（botToken 等，密文）
 * - kv 'wx-ilink-msgs'：收发日志（明文，上限 200 条，接入页展示用）
 * - kv 'wx-ilink-auto'：本机自动回复开关
 * - kv 'wx-ilink-token-history'：本机最近 10 个 bot token（明文；取码时随 local_token_list
 *   上报，后端靠它认出环境亲缘——断开重连/换绑时不再被当作陌生环境风控）
 *
 * 24 小时在线：设置 → 云端助手，部署到用户自己的 Supabase / HF / ClawCloud（wx-cloud 模块）。
 * 接入/换绑/断开后自动重推运行包到云端（cloudAutoSync，已部署过才推；动态 import 避免循环依赖）。
 */

import { create } from 'zustand';
import QRCode from 'qrcode';
import { ensureKvReady, kvGet, kvSet, kvDel } from './idb-kv';
import { decryptSecret, encryptSecret, isEncrypted } from './secret-box';
import { buildPersonaSystemPrompt } from './persona';
import { buildMoodBlock } from './ai-mood';
import { memChatRecallBlock } from '@/lib/memory';
import { getContact, ownerProfileFor } from './contacts-store';
import { getActiveAccountIdFor } from './accounts';
import { useSettings } from './store';
import { loadMsgs, saveMsgs, type WxMsg } from '@/components/apps/wx-app/core';
import type { ContactRecord } from '@/lib/contacts';
import { BUILTIN_WX_STICKERS } from './builtin-stickers';

// ---------------- 类型 ----------------

/** 接入/换绑/断开后自动重推运行包到云端（已部署过才推；动态 import 避免与 wx-cloud 的循环依赖） */
function cloudAutoSync(reason: string): void {
  void import('./wx-cloud/supabase')
    .then((m) => m.autoSyncRunPackageIfDeployed(reason))
    .catch(() => undefined);
}

export interface WxIlinkLogin {
  botToken: string;
  botId: string;
  /** confirmed 回包的 baseurl（后续 Bot API 用；缺省回 ilinkai.weixin.qq.com） */
  baseUrl?: string;
  /** 扫码用户（ilink_user_id，绑定的是哪个微信号） */
  ilinkUserId?: string;
  /** 绑定的联系人（AI 角色）id：这个微信号扫完码就「变成」TA */
  boundContactId: string;
  /** 绑定联系人名快照（联系人被删后 UI 仍能显示） */
  boundContactName: string;
  connectedAt: number;
}

export interface WxIlinkMsg {
  id: string;
  fromUserId: string;
  text: string;
  /** AI 的回复（生成中为空） */
  reply?: string;
  replyErr?: string;
  ts: number;
}

export type WxQrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  /** 微信要求 PIN：手机上显示数字，需在本页输入后随下一轮轮询上报 verify_code */
  | 'need_verifycode'
  /** PIN 错太多次被锁：自动换一张码（上限 3 次） */
  | 'verify_code_blocked'
  /** 这个微信号已绑定到其它环境：需先在原环境解绑或换号 */
  | 'binded_redirect';

export interface WxIlinkQr {
  qrcode: string;
  /** 本地生成的二维码图（data URL，直接 <img src>） */
  img: string;
  status: WxQrStatus;
  /** 需要输入 PIN 时的错误提示（输错码时展示；空 = 首次要求输入） */
  pinErr?: string;
  /** binded_redirect 等终态的引导文案 */
  hint?: string;
}

// ---------------- iLink 请求层 ----------------

/** base_info：版本对齐官方插件代际（协议文档：后端按 channel_version 识别客户端代际，认不出记 0.0.0 按不支持处理） */
const BASE_INFO = { channel_version: '2.4.10', bot_agent: 'OpenClaw' };

/** host 覆盖：login.baseUrl（confirmed 回包）去掉协议头后的裸域名；空 = 默认 ilinkai */
function hostOf(baseUrl?: string): string | undefined {
  const m = /^https:\/\/([a-z0-9.-]+)$/i.exec(String(baseUrl || '').trim());
  return m ? m[1].toLowerCase() : undefined;
}

async function ilink<T = Record<string, unknown>>(
  path: string,
  opts: { botToken?: string; body?: unknown; method?: 'GET' | 'POST'; host?: string; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch('/api/weixin-ilink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      method: opts.method ?? 'POST',
      botToken: opts.botToken,
      body: opts.body ?? {},
      ...(opts.host ? { host: opts.host } : {}),
    }),
    // 状态长轮询与 getupdates 服务端挂 ~35s：客户端窗留足 50s，其余 40s
    signal: AbortSignal.timeout(opts.timeoutMs ?? 40_000),
  });
  const text = await res.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`iLink 响应异常（${res.status}）：${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    const rec = j as { error?: string; message?: string };
    throw new Error(rec.message || rec.error || `iLink 请求失败（${res.status}）`);
  }
  return j as T;
}

// ---------------- 持久化（密文凭证 + 明文日志） ----------------

const LOGIN_KEY = 'wx-ilink-login';
const MSGS_KEY = 'wx-ilink-msgs';
const AUTO_KEY = 'wx-ilink-auto';
const MSGS_CAP = 200;

let memLogin: WxIlinkLogin | null = null;
let wxConnectReady = false;

/** 同步读登录凭证（boot 后有效；供设置页云端模块等非 React 场景使用） */
export function wxIlinkLoginSnapshot(): WxIlinkLogin | null {
  return memLogin;
}

async function readEncJson<T>(key: string): Promise<T | null> {
  try {
    const raw = kvGet<string>(key);
    if (!raw) return null;
    const plain = isEncrypted(raw) ? await decryptSecret(raw) : raw;
    return JSON.parse(plain) as T;
  } catch {
    return null;
  }
}

async function writeEncJson(key: string, value: unknown): Promise<void> {
  try {
    const cipher = await encryptSecret(JSON.stringify(value));
    kvSet(key, cipher);
  } catch {
    // 加密失败不阻塞功能（secret-box 内部已有降级）
  }
}

// ---------------- bot token 历史（取码时随 local_token_list 上报，后端认环境亲缘） ----------------

const TOKEN_HISTORY_KEY = 'wx-ilink-token-history';
const TOKEN_HISTORY_CAP = 10;

let memTokenHistory: string[] = [];

/** 本机 token 历史（boot 后有效）：取码时作为 local_token_list 上报（最新在前，上限 10） */
function tokenHistorySnapshot(): string[] {
  return memTokenHistory.slice(0, TOKEN_HISTORY_CAP);
}

/** 记一个新 token（去重前置；断开不清空——重连同一环境靠它认亲缘） */
function rememberToken(token: string): void {
  if (!token) return;
  memTokenHistory = [token, ...memTokenHistory.filter((t) => t !== token)].slice(0, TOKEN_HISTORY_CAP);
  try {
    kvSet(TOKEN_HISTORY_KEY, JSON.stringify(memTokenHistory));
  } catch {
    /* 忽略 */
  }
}

function loadTokenHistory(): void {
  try {
    const raw = kvGet<string>(TOKEN_HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    memTokenHistory = Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t).slice(0, TOKEN_HISTORY_CAP) : [];
  } catch {
    memTokenHistory = [];
  }
}

// ---------------- 聊天线程同步（真机微信 ↔ 手机 App 聊天界面） ----------------

/** 往绑定联系人的微信聊天线程追加一条消息，并广播刷新事件（正在开着的聊天页实时上屏） */
function appendThreadMsg(contactId: string, m: WxMsg): void {
  try {
    const list = loadMsgs(contactId);
    if (list.some((x) => x.id === m.id)) return;
    saveMsgs(contactId, [...list, m]);
    window.dispatchEvent(new CustomEvent('chat-stream-sysline', { detail: { sessionKey: `wx:${contactId}` } }));
  } catch {
    /* 线程写入失败不影响微信收发 */
  }
}

/** 最近一条来消息的上下文（网站侧新回复转发回微信时用） */
let lastCtx: { fromUserId: string; contextToken: string } | null = null;

// ---------------- 人设 prompt（与站内聊天同一套：人设/表达/规则/心情/记忆召回） ----------------

/** 轮询代数：disconnect/关开关时 +1，旧循环自然退出 */
let loopGen = 0;
/** getupdates 游标（会话内有效；微信不补发历史消息，新会话从「现在」开始收） */
let updatesBuf = '';
/** 绑定联系人人设缓存（循环内复用，换绑时刷新） */
let personaCache: { contactId: string; system: string } | null = null;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------- 真机微信出站文本净化（iLink 通道只能发文字） ----------------

/** 微信经典表情代码名全集（wxb- 内置清单的 meaning；真机微信客户端会把 [名字] 文本渲染成真表情） */
const WX_CLASSIC_EMOJI_SET = new Set(BUILTIN_WX_STICKERS.map((s) => s.meaning));

/** 纯表情净化后的兜底颜文字（回复整条只剩大表情标记时，不至于变空消息） */
const WX_EMOJI_FALLBACKS = ['(¬‿¬)', '(๑•̀ㅂ•́)و✧', '٩(˃ᴗ˂)۶', '(っ˘ω˘ς)'];

/**
 * 真机微信出站净化：大表情标记 → 经典表情代码（能发的最大化），发不了的剥除。
 * - [表情包:wxb-调皮] / [表情包:wwb-调皮] / [表情:调皮] 等标记：去 ID 前缀后名字在经典
 *   表情清单内 → 转 [调皮]（真机微信直接显示成真表情，AI 等于真会发表情了）；不在清单
 *   （用户收藏大表情）→ 剥除（文字通道发不了图，留着只会是奇怪文字）
 * - [图片:xx] / [照片:xx] / [语音:xx] 等媒体标记 → 剥除
 * - 已是 [微笑] 形态的经典代码零改动；净空后拿颜文字兑底
 * 根因（用户实拍）：本机历史里站内微信的 [表情包:ID] 消息教会了 LLM 这个格式，而真机
 * 通道发不出去——提示词拦不住，必须在发送边界确定性转换。
 */
export function sanitizeWxOutText(text: string): string {
  const tagRe = /[\[【]\s*(?:发送了|发出了)?\s*(?:表情包|表情|图片|照片|语音|贴纸|Sticker)\s*[:：]\s*([^\]】]{1,24})\s*[\]】]/g;
  let out = text.replace(tagRe, (_all, rawName: string) => {
    const name = String(rawName)
      .trim()
      .replace(/^(?:wwb|wxb|qqb|wx|qq|mt|wb)-/i, '')
      .trim();
    return WX_CLASSIC_EMOJI_SET.has(name) ? `[${name}]` : '';
  });
  out = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s\n]+|[\s\n]+$/g, '')
    .replace(/^[，,。.\s]+/, '');
  if (out) return out;
  return WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)];
}

async function buildSystemPrompt(login: WxIlinkLogin, contextText: string): Promise<string> {
  if (personaCache && personaCache.contactId === login.boundContactId) {
    // 记忆召回与上下文相关，每次单独算（persona 部分走缓存不划算，整体重算成本可接受）
  }
  const contact = await getContact(login.boundContactId).catch(() => null);
  if (!contact) {
    personaCache = { contactId: login.boundContactId, system: [
      '你在一个真实微信号上和主人聊天（主人用TA自己的微信给你发消息）。',
      '回复简短自然（一般 1~2 句），像真人发微信，不要使用括号动作描写。',
      '绝不透露自己是 AI、助手、机器人或任何系统设定的存在。',
    ].join('\n') };
    return personaCache.system;
  }
  const owner = await ownerProfileFor('wx').catch(() => null);
  const persona = buildPersonaSystemPrompt(contact, {
    channel: '微信',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    accountId: getActiveAccountIdFor('wx'),
  });
  const extraRules = [
    '【真机微信】你现在通过真实微信号和主人聊天：主人用TA自己的微信给你发消息，与平时在手机里聊天完全一样，延续你们已有的关系和记忆。',
    '回复要简短口语化，像真人发微信（一般 1~2 句话），不要输出括号动作描写、状态栏或任何格式标记。',
    '【微信表情】想发表情就直接输出经典表情代码，如 [调皮] [偷笑] [捂脸] [呲牙] [破涕为笑]——真机微信会显示成真表情，可与文字混排（如「哈哈[偷笑]」「晚安[月亮]」）；对方要表情包时优先用这些代码回应。不要输出 [表情包:ID]、[图片:xx] 这类大表情/媒体标记（这条通道发不了图，只会变成奇怪文字）。',
    '绝不透露自己是 AI、助手、机器人、bot 或存在系统提示；被问到就说自己是本人。',
  ];
  const mood = buildMoodBlock(contact.id);
  const memRecall = memChatRecallBlock(contact.id, 'wx', contextText);
  personaCache = { contactId: login.boundContactId, system: [persona, mood, memRecall, ...extraRules].filter(Boolean).join('\n\n') };
  return personaCache.system;
}

/** 调 /api/chat（跟随「API 设置」，自配 API 优先，失败回退内置 SDK） */
async function callLlm(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) throw new Error(`chat ${res.status}`);
    return res.text();
  };
  const apiConfig = useSettings.getState().apiConfig;
  try {
    const raw = await call({ config: apiConfig });
    if (raw.trim()) return raw;
  } catch {
    // 走 SDK 兜底
  }
  return call({ forceSdk: true });
}

interface ILinkItem {
  type?: number;
  text_item?: { text?: string };
}

interface ILinkMessage {
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  context_token?: string;
  item_list?: ILinkItem[];
}

/** 处理一条来消息：落线程 → 打字状态 → 人设回复 → 发回微信 + 落线程 */
async function handleIncoming(st: WxConnectStore, login: WxIlinkLogin, msg: ILinkMessage): Promise<void> {
  const textItem = (msg.item_list ?? []).find((i) => i.type === 1);
  const text = (textItem?.text_item?.text ?? '').trim();
  if (!text || !msg.from_user_id || !msg.context_token) return;
  if (msg.from_user_id === login.botId) return; // 自己发出的（多端同收）

  const entry: WxIlinkMsg = {
    id: `${msg.message_id ?? Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromUserId: msg.from_user_id,
    text: text.slice(0, 2000),
    ts: Date.now(),
  };
  st.pushMsg(entry);
  // 对方（通常是你自己）说的 → 线程里记为「我方(me)」消息
  appendThreadMsg(login.boundContactId, { id: `wxr-${entry.id}`, role: 'me', content: text.slice(0, 2000), time: Date.now() });
  lastCtx = { fromUserId: msg.from_user_id, contextToken: msg.context_token };

  // 「正在输入」：getconfig 拿 ticket，回复期间每 4.5s 续一次（host 跟随 login.baseUrl）
  const api = { host: hostOf(login.baseUrl) };
  let typingTicket = '';
  let typingTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const cfg = await ilink<{ ret?: number; typing_ticket?: string }>('/ilink/bot/getconfig', {
      botToken: login.botToken,
      host: api.host,
      body: { ilink_user_id: msg.from_user_id, context_token: msg.context_token, base_info: BASE_INFO },
    });
    typingTicket = cfg.typing_ticket ?? '';
  } catch {
    /* 打字状态可有可无 */
  }
  const stopTyping = () => {
    if (typingTimer) clearInterval(typingTimer);
    typingTimer = null;
    if (typingTicket) {
      void ilink('/ilink/bot/sendtyping', {
        botToken: login.botToken,
        host: api.host,
        body: { ilink_user_id: msg.from_user_id, typing_ticket: typingTicket, status: 2, base_info: BASE_INFO },
      }).catch(() => undefined);
    }
  };
  if (typingTicket) {
    const beat = () =>
      void ilink('/ilink/bot/sendtyping', {
        botToken: login.botToken,
        host: api.host,
        body: { ilink_user_id: msg.from_user_id, typing_ticket: typingTicket, status: 1, base_info: BASE_INFO },
      }).catch(() => undefined);
    beat();
    typingTimer = setInterval(beat, 4500);
  }

  try {
    // 组 prompt：人设 system + 绑定联系人线程的最近历史（真机/网页两侧聊天都在线程里，天然互通）
    const thread = loadMsgs(login.boundContactId).filter((m) => !m.kind || m.kind === 'text').slice(-14);
    const history = thread.slice(0, -1).map((m) => ({ role: m.role === 'me' ? ('user' as const) : ('assistant' as const), content: m.content.slice(0, 800) }));
    const contextText = thread.map((m) => `${m.role === 'me' ? '我' : 'TA'}: ${m.content}`).join('\n').slice(-1500);
    const system = await buildSystemPrompt(login, contextText);
    const reply = sanitizeWxOutText((await callLlm([...history, { role: 'user', content: text.slice(0, 2000) }])).trim());
    if (!reply) throw new Error('生成了空回复');

    await ilink('/ilink/bot/sendmessage', {
      botToken: login.botToken,
      host: api.host,
      body: {
        msg: {
          from_user_id: '',
          to_user_id: msg.from_user_id,
          client_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message_type: 2,
          message_state: 2,
          context_token: msg.context_token,
          item_list: [{ type: 1, text_item: { text: reply.slice(0, 2000) } }],
        },
        base_info: BASE_INFO,
      },
    });
    st.patchMsg(entry.id, { reply: reply.slice(0, 2000) });
    // 角色说的 → 线程里记为「对方(peer)」，并标记为我们转发的（别再往微信发一遍）
    const peerId = `wxr-${entry.id}-r`;
    knownPeerIds.add(peerId);
    appendThreadMsg(login.boundContactId, { id: peerId, role: 'peer', content: reply.slice(0, 2000), time: Date.now() });
  } catch (e) {
    st.patchMsg(entry.id, { replyErr: e instanceof Error ? e.message : String(e) });
  } finally {
    stopTyping();
  }
}

// ---------------- 网页侧新回复 → 转发回真机微信 ----------------

/** 已知「对方(peer)」消息 id 集合：我们自己落的不转发；boot 时把存量全部视为已知（不发历史） */
const knownPeerIds = new Set<string>();

async function forwardThreadWatcher(login: WxIlinkLogin): Promise<void> {
  try {
    const list = loadMsgs(login.boundContactId);
    const fresh = list.filter((m) => m.role === 'peer' && (!m.kind || m.kind === 'text') && !knownPeerIds.has(m.id));
    for (const m of fresh) {
      knownPeerIds.add(m.id);
      if (!lastCtx) continue; // 还没有任何微信来消息，没有 context_token 可用
      await ilink('/ilink/bot/sendmessage', {
        botToken: login.botToken,
        host: hostOf(login.baseUrl),
        body: {
          msg: {
            from_user_id: '',
            to_user_id: lastCtx.fromUserId,
            client_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            message_type: 2,
            message_state: 2,
            context_token: lastCtx.contextToken,
            item_list: [{ type: 1, text_item: { text: sanitizeWxOutText(m.content).slice(0, 2000) } }],
          },
          base_info: BASE_INFO,
        },
      }).catch(() => undefined);
    }
  } catch {
    /* 转发尽力而为 */
  }
}

// ---------------- 本机轮询主循环 ----------------

async function runLoop(gen: number): Promise<void> {
  const st = useWxConnect.getState();
  st.setLoop('running', '');
  while (gen === loopGen) {
    const { login, autoReply } = useWxConnect.getState();
    if (!login || !autoReply) break;
    try {
      const d = await ilink<{ ret?: number; error_code?: number; msgs?: ILinkMessage[]; get_updates_buf?: string }>(
        '/ilink/bot/getupdates',
        // host 跟随 confirmed 回包的 baseurl（换域后继续可用）；长轮询窗 50s
        { botToken: login.botToken, host: hostOf(login.baseUrl), timeoutMs: 50_000, body: { get_updates_buf: updatesBuf, base_info: BASE_INFO } },
      );
      if (gen !== loopGen) break;
      if (d.error_code === -14) {
        useWxConnect.getState().setLoop('error', 'Token 已过期，请回到微信重新扫码接入');
        return;
      }
      if (typeof d.get_updates_buf === 'string' && d.get_updates_buf) updatesBuf = d.get_updates_buf;
      for (const m of d.msgs ?? []) {
        if (gen !== loopGen) break;
        await handleIncoming(useWxConnect.getState(), login, m).catch(() => undefined);
      }
      // 网页侧新回复转发（每轮一次）
      await forwardThreadWatcher(login);
      useWxConnect.setState({ lastPollAt: Date.now() });
      if (useWxConnect.getState().loopStatus === 'error') {
        useWxConnect.getState().setLoop('running', '');
      }
    } catch (e) {
      if (gen !== loopGen) return;
      useWxConnect.getState().setLoop('error', e instanceof Error ? e.message : String(e));
      await sleep(5000);
    }
  }
  if (gen === loopGen) useWxConnect.getState().setLoop('off', '');
}

// ---------------- Store ----------------

interface WxConnectStore {
  ready: boolean;
  login: WxIlinkLogin | null;
  autoReply: boolean;
  loopStatus: 'off' | 'running' | 'error';
  loopError: string;
  lastPollAt: number | null;
  msgs: WxIlinkMsg[];
  qr: WxIlinkQr | null;
  qrLoading: boolean;
  testing: boolean;
  lastTest: { ok: boolean; msg: string; at: number } | null;

  boot: () => Promise<void>;
  /** 选好绑定联系人后取二维码并开始官方协议状态机（长轮询 + PIN + 重定向 + 换码） */
  startQr: (contactId: string, contactName: string) => Promise<void>;
  /** 提交微信 PIN（need_verifycode 时 UI 输入 → 下一轮轮询带 verify_code） */
  submitPin: (pin: string) => void;
  cancelQr: () => void;
  /** 换绑角色（不重新扫码，只改绑定的联系人） */
  rebindContact: (contactId: string, contactName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** 测试连接：getupdates 一次（有效 token 会快速返回，无效/过期会报错） */
  test: () => Promise<boolean>;
  setAutoReply: (v: boolean) => void;
  pushMsg: (m: WxIlinkMsg) => void;
  patchMsg: (id: string, patch: Partial<WxIlinkMsg>) => void;
  clearMsgs: () => void;
  setLoop: (s: 'off' | 'running' | 'error', err: string) => void;
}

/** 扫码状态机代数：start/stop/cancel 递增，旧循环自动退出 */
let qrGen = 0;
/** PIN 待提交的 resolver（need_verifycode 时 UI 输入后唤醒轮询循环） */
let pinResolve: ((pin: string) => void) | null = null;

export const useWxConnect = create<WxConnectStore>((set, get) => ({
  ready: false,
  login: null,
  autoReply: false,
  loopStatus: 'off',
  loopError: '',
  lastPollAt: null,
  msgs: [],
  qr: null,
  qrLoading: false,
  testing: false,
  lastTest: null,

  boot: async () => {
    if (wxConnectReady) return;
    wxConnectReady = true;
    try {
      await ensureKvReady();
      loadTokenHistory();
      memLogin = await readEncJson<WxIlinkLogin>(LOGIN_KEY);
      if (memLogin?.botToken) rememberToken(memLogin.botToken);
      const msgs = await readEncJson<WxIlinkMsg[]>(MSGS_KEY).catch(() => null);
      const auto = (() => {
        try {
          return kvGet<string>(AUTO_KEY) === '1';
        } catch {
          return false;
        }
      })();
      const list = Array.isArray(msgs) ? msgs.slice(-MSGS_CAP) : [];
      set({ login: memLogin, msgs: list, autoReply: auto && !!memLogin, ready: true });
      if (memLogin) {
        // 存量对方消息全部视为已知（不把历史回复重发到微信）
        try {
          for (const m of loadMsgs(memLogin.boundContactId)) {
            if (m.role === 'peer') knownPeerIds.add(m.id);
          }
        } catch {
          /* 忽略 */
        }
        if (auto) {
          loopGen++;
          void runLoop(loopGen);
        }
      }
    } catch {
      set({ ready: true });
    }
  },

  /**
   * 官方协议状态机（Tencent/openclaw-weixin docs/protocol_zh_CN.md）：
   * ① POST get_bot_qrcode?bot_type=3，请求体 {local_token_list}（本机最近 10 个 bot token——
   *   后端靠它认出环境亲缘，重绑不被当陌生环境风控）
   * ② GET get_qrcode_status?qrcode=… 串行长轮询（服务端挂 ~35s；超时/网络错 = wait 续轮）。
   *    状态：wait / scaned / confirmed（保存 bot_token+ilink_bot_id+baseurl+ilink_user_id）/
   *    expired / 含 need_verifycode（手机显示数字 → 用户输入 → 下一轮带 verify_code，
   *    再遇 need_verifycode = 输错重输）/ verify_code_blocked（错太多，换码重试 ≤3）/
   *    scaned_but_redirect（后续轮询切 redirect_host）/ binded_redirect（已绑其它环境，终态引导）
   * ③ 过期/锁死自动换码重试 3 次，超限提示稍后再试。
   */
  startQr: async (contactId, contactName) => {
    if (get().qrLoading) return;
    const myGen = ++qrGen;
    set({ qrLoading: true, qr: null });
    try {
      await ensureKvReady();
      // 换码重试外环（expired / verify_code_blocked ≤ 3 次）
      for (let refresh = 0; refresh <= 3 && qrGen === myGen; refresh++) {
        const d = await ilink<{ qrcode?: string; qrcode_img_content?: string; ret?: number }>(
          '/ilink/bot/get_bot_qrcode?bot_type=3',
          // local_token_list：本机 token 历史（协议：最多 10 个，后端认环境亲缘用）
          { body: { local_token_list: tokenHistorySnapshot() } },
        );
        if (qrGen !== myGen) return;
        if (!d.qrcode || !d.qrcode_img_content) throw new Error('iLink 未返回二维码');
        // qrcode_img_content 是授权页 URL（不是图片）——本地生成二维码 data URL
        const img = await QRCode.toDataURL(d.qrcode_img_content, { width: 320, margin: 2 });
        set({ qr: { qrcode: d.qrcode, img, status: 'wait' }, qrLoading: false });

        const qrcode = d.qrcode;
        let statusHost: string | undefined; // scaned_but_redirect 后续切 redirect_host
        let pin = ''; // 暂存 PIN：仅随「下一次」轮询上报（协议约定）
        let wasPin = false; // 上一轮是否处于 PIN 输入（区分首次要求与输错重输）
        interface QrStatusResp {
          status?: string;
          bot_token?: string;
          ilink_bot_id?: string;
          baseurl?: string;
          ilink_user_id?: string;
          redirect_host?: string;
        }
        // 串行长轮询内环
        while (qrGen === myGen) {
          const cur = get().qr;
          if (!cur || cur.qrcode !== qrcode) return; // 被新码/取消取代
          const qs = `qrcode=${encodeURIComponent(qrcode)}${pin ? `&verify_code=${encodeURIComponent(pin)}` : ''}`;
          let s: QrStatusResp | null = null;
          try {
            s = await ilink<QrStatusResp>(`/ilink/bot/get_qrcode_status?${qs}`, {
              method: 'GET',
              body: {},
              host: statusHost,
              timeoutMs: 50_000,
            });
          } catch {
            // 协议：单次失败/超时按 wait 续轮（短歇后重试）
            await sleep(1000);
            continue;
          }
          if (qrGen !== myGen) return;
          const status = String(s?.status || 'wait');
          // ① confirmed：保存凭证（含 baseurl / ilink_user_id）
          if (status === 'confirmed' && s?.bot_token && s?.ilink_bot_id) {
            const login: WxIlinkLogin = {
              botToken: s.bot_token,
              botId: s.ilink_bot_id,
              ...(typeof s.baseurl === 'string' && s.baseurl ? { baseUrl: s.baseurl } : {}),
              ...(typeof s.ilink_user_id === 'string' && s.ilink_user_id ? { ilinkUserId: s.ilink_user_id } : {}),
              boundContactId: contactId,
              boundContactName: contactName,
              connectedAt: Date.now(),
            };
            memLogin = login;
            await writeEncJson(LOGIN_KEY, login);
            rememberToken(login.botToken);
            personaCache = null;
            lastCtx = null;
            updatesBuf = '';
            pinResolve = null;
            set({ login, qr: { ...cur, status: 'confirmed', pinErr: undefined }, msgs: [], lastTest: null });
            // 扫码接入成功后默认开启本机自动回复（用户可关；24h 在线建议部署云端）
            get().setAutoReply(true);
            // 已部署过云端则自动重推运行包（微信通道即刻生效，无需手动点同步）
            cloudAutoSync('微信接入成功');
            return;
          }
          // ② 需要输入 PIN（含 need_verifycode / confirmed_but_need_verifycode）
          if (status.includes('need_verifycode')) {
            set({
              qr: {
                ...cur,
                status: 'need_verifycode',
                pinErr: wasPin ? '数字不对，看看微信上显示的是多少，重新输一次' : undefined,
              },
            });
            const typed = await new Promise<string>((resolve) => {
              pinResolve = resolve;
            });
            if (qrGen !== myGen) return;
            pin = typed.trim().replace(/\D/g, '').slice(0, 8);
            wasPin = true;
            continue; // 下一轮带 verify_code（返回 need_verifycode 依旧 = 输错）
          }
          // ③ 已扫码（带过 verify_code 时表示数字已接受 → 丢弃）
          if (status === 'scaned') {
            pin = '';
            wasPin = false;
            if (cur.status !== 'scaned') set({ qr: { ...cur, status: 'scaned', pinErr: undefined } });
            continue;
          }
          // ④ 过期 / 错码锁死：换码重试（≤3），超限退出引导
          if (status === 'expired' || status === 'verify_code_blocked') {
            pin = '';
            pinResolve = null;
            if (refresh >= 3) {
              set({
                qr: {
                  ...cur,
                  status: 'expired',
                  hint: status === 'verify_code_blocked' ? '数字错太多次被锁：稍后再试，或点重新获取' : undefined,
                },
              });
              return;
            }
            break; // 外环换新码
          }
          // ⑤ 扫码后换域：后续轮询切 redirect_host
          if (status === 'scaned_but_redirect') {
            const rh = String(s?.redirect_host || '').trim();
            if (rh) statusHost = rh.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
            if (cur.status !== 'scaned') set({ qr: { ...cur, status: 'scaned', pinErr: undefined } });
            continue;
          }
          // ⑥ 已绑到其它环境（终态）：给解绑引导，停止轮询
          if (status === 'binded_redirect') {
            pinResolve = null;
            set({
              qr: {
                ...cur,
                status: 'binded_redirect',
                hint: '这个微信号已连接到其它环境（比如之前连过别处的机器人）：先在那边断开/解绑，或换一个微信号扫码',
              },
            });
            return;
          }
          // ⑦ wait：继续长轮询
          if (cur.status !== 'wait') set({ qr: { ...cur, status: 'wait', pinErr: undefined } });
        }
      }
    } catch (e) {
      set({ qrLoading: false });
      throw e;
    }
  },

  submitPin: (pin) => {
    const r = pinResolve;
    pinResolve = null;
    if (r) r(pin);
  },

  cancelQr: () => {
    qrGen++;
    const r = pinResolve;
    pinResolve = null;
    if (r) r('');
    set({ qr: null });
  },

  rebindContact: async (contactId, contactName) => {
    const login = get().login;
    if (!login) return;
    const next: WxIlinkLogin = { ...login, boundContactId: contactId, boundContactName: contactName };
    memLogin = next;
    personaCache = null;
    await writeEncJson(LOGIN_KEY, next);
    set({ login: next });
    // 换绑后云端人设同步更新
    cloudAutoSync('微信换绑角色');
  },

  disconnect: async () => {
    loopGen++;
    qrGen++;
    const r = pinResolve;
    pinResolve = null;
    if (r) r('');
    updatesBuf = '';
    personaCache = null;
    lastCtx = null;
    knownPeerIds.clear();
    memLogin = null;
    try {
      await kvDel(LOGIN_KEY);
      kvDel(AUTO_KEY);
    } catch {
      /* 忽略 */
    }
    // token 历史保留（断开重接同一环境靠它认亲缘）
    set({ login: null, autoReply: false, qr: null, loopStatus: 'off', loopError: '', lastPollAt: null, lastTest: null });
    // 断开后自动重推（云端立即停用微信通道）
    cloudAutoSync('微信已断开');
  },

  test: async () => {
    const login = get().login;
    if (!login) return false;
    set({ testing: true });
    try {
      const d = await ilink<{ ret?: number; error_code?: number; get_updates_buf?: string }>('/ilink/bot/getupdates', {
        botToken: login.botToken,
        body: { get_updates_buf: '', base_info: BASE_INFO },
      });
      const expired = d.error_code === -14;
      const ok = !expired;
      const msg = expired ? 'Token 已过期，请重新扫码接入' : ok ? '连接正常，通道可用' : `通道返回异常（code ${d.error_code}）`;
      set({ testing: false, lastTest: { ok, msg, at: Date.now() } });
      return ok;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ testing: false, lastTest: { ok: false, msg, at: Date.now() } });
      return false;
    }
  },

  setAutoReply: (v) => {
    const login = get().login;
    try {
      kvSet(AUTO_KEY, v ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    if (!v) {
      loopGen++;
      set({ autoReply: false, loopStatus: 'off', loopError: '' });
      return;
    }
    set({ autoReply: true });
    if (login && get().loopStatus === 'off') {
      loopGen++;
      void runLoop(loopGen);
    }
  },

  pushMsg: (m) => {
    const list = [...get().msgs, m].slice(-MSGS_CAP);
    set({ msgs: list });
    try {
      kvSet(MSGS_KEY, JSON.stringify(list));
    } catch {
      /* 忽略 */
    }
  },

  patchMsg: (id, patch) => {
    const list = get().msgs.map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ msgs: list });
    try {
      kvSet(MSGS_KEY, JSON.stringify(list));
    } catch {
      /* 忽略 */
    }
  },

  clearMsgs: () => {
    set({ msgs: [] });
    try {
      kvDel(MSGS_KEY);
    } catch {
      /* 忽略 */
    }
  },

  setLoop: (s, err) => set({ loopStatus: s, loopError: err }),
}));

/** 读消息日志（云部署模块组运行包历史用；同步读内存态） */
export function wxIlinkMsgsSnapshot(): WxIlinkMsg[] {
  return useWxConnect.getState().msgs;
}
