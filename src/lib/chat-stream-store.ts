'use client';

/**
 * 全局聊天流式请求总线（微信 / QQ / 信息 App 共用）。
 *
 * 把「发送消息 → 请求 AI 回复 → 接收流式数据 → 落盘聊天记录」的完整生命周期
 * 从聊天页组件中解耦出来，由本模块（页面之外的全局单例）管理：
 *
 * 1. 用户发送消息后，请求由 beginChatStream 在全局发起并接收流式数据；
 * 2. 退出聊天页 / 退出 App 不会中断请求（流与 React 组件生命周期完全解耦，
 *    读流循环跑在本模块的异步函数里，不依赖任何组件存活）；
 * 3. 重新进入聊天页时，useChatStream 读到该会话的流状态继续渲染（流式期间只显示「正在输入」，
 *    已收到的分段消息由各 App 经 onSegment 解析成真实消息逐条投递落盘，与页面是否存活无关）；
 * 4. 回复条数 >1 时按「边接收边逐条显示」分段：分段器每凑齐一条完整句子立刻回调 onSegment
 *    投递上屏（不设硬上限，一句一条绝不挤压），收尾剩余的一段经 finalize 的 result.tail 交付；
 * 5. 请求完成或失败后，由发起方注册的 finalize 回调把剩余消息写入
 *    对应角色的聊天记录（各 App 自己的 loadMsgs/saveMsgs，消息类型与错误文案按 App 区分），
 *    并广播 chat-stream-finalized 事件供会话列表刷新预览；
 * 6. 角色隔离：以 sessionKey（如 wx:<contactId> / qq:<contactId> / sms:<storageKey>）为键，
 *    每个会话同一时刻最多一条流（isChatStreaming 防重入），不同角色 / 不同 App 的流互不影响；
 *    人设 system 消息仍由各 App 在发送时组装后随 messages 传入（本模块原样透传，不感知人设）。
 *    唯一例外（40-B 多账号 AI 认知隔离）：主账号下发起请求前，把「用户的小号」聊天摘录 digest
 *    以附加段落追加进首条 system 消息末尾（computeAltAccountsDigest → mergeAltDigestIntoMessages），
 *    覆盖经本总线发起的全部会话（wx/qq 私聊与群聊、信息联系人会话、信息小助手会话、社交/退圈后台流）；
 *    小号/匿名号侧与电话通话（服务端 persona 直调）不注入。
 * 7. 回复条数：条数指令（N 条上限）由各 App 注入人设 system 消息，一轮发完、不做补发；
 *
 * 响应格式：/api/chat 返回 text/plain 纯文本增量流（服务端已把上游 SSE 解析为纯文本），
 * 客户端按「字节累积 = 已收内容」处理；上游不可达 / directOnly 时回退浏览器直连
 * （directChatStream，SSE 解析），失败文案与各 App 原有错误处理保持一致。
 * 未配置 API（无 Key 且默认官方地址）时客户端直接走内置模型，不发无效请求。
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ApiConfig } from '@/lib/ios/store';
import { useSettings } from '@/lib/ios/store';
import { directChatStream, isPrivateApiUrl } from '@/lib/ios/direct-api';
import { createReplySegmentScanner } from '@/lib/reply-count';
// 深度思考：流式统一剥离 [思考]…[/思考] 块（正文/分段器只见纯正文，思考内容单独收集交 finalize）
import { createThinkFilter } from '@/lib/deep-think';
import { describeImagesAuto } from '@/lib/vision-client';
import { clearDeliverBoundary, isAiDelivering, scheduleAiDelivery } from '@/lib/ios/ai-delivery';
import { charRequestOnlyOf, loadBlock, type BlockApp } from '@/lib/ios/block-state';
// 40-B 多账号 AI 认知隔离：主账号（该 App 当前账号为大号）下计算「用户的小号」聊天摘录并合并进人设 system 消息
import {
  getAccountById,
  getAccounts,
  getActiveAccountIdFor,
  MAIN_ACCOUNT_ID,
  parseScopedKey,
  type AccountApp,
} from '@/lib/ios/accounts';
// 大号侧「小号是我」披露检测（用户规则一/二：账号关联记忆）与主号侧事件记忆碎片
import { memAddEventFragment, memDetectMainAltDisclosure, memLinkAltAccounts } from '@/lib/memory';
// X论坛匿名小号「揭秘时刻」：私聊里说破「那是我小号」→ 关联记忆 + 持久披露标记
import { detectForumAnonDisclosure, markForumAnonDisclosed } from '@/lib/ios/forum-anon';
import { resolveAuthor, ANON_KEY } from '@/lib/forum/core';
import { localDB } from '@/lib/ios/db';
import { buildAltAccountsSection } from '@/lib/ios/persona';
import { cachedOwnerName } from '@/lib/ios/contacts-store';
// 第十六轮：AI 情绪系统（用户消息打点→情绪变化）+ 作息记忆（活跃时间直方图）
import { noteUserMsgMood } from '@/lib/ios/ai-mood';
import { noteActive } from '@/lib/ios/routine';

/** 会话键 → 账号所属 App（v2 per-app 账号）：wx:* → 微信、qq:* → QQ、其余（sms 开头与 assistant 等历史键）→ 信息 */
function streamAppOf(sessionKey: string): AccountApp {
  if (sessionKey.startsWith('wx:')) return 'wx';
  if (sessionKey.startsWith('qq:')) return 'qq';
  return 'sms';
}

/** 会话键 → 私聊联系人 id（wx:<cid> / qq:<cid> / sms:c:<cid>）；群聊（wx:group:* / qq:group:*）、
 *  小助手（sms:assistant）及其他非联系人会话返回 null——披露检测/记忆只针对与 AI 角色的私聊 */
function streamContactIdOf(sessionKey: string): string | null {
  if (sessionKey.startsWith('sms:c:')) return sessionKey.slice('sms:c:'.length);
  const m = /^(wx|qq):(.+)$/.exec(sessionKey);
  if (!m) return null;
  return m[2].startsWith('group:') ? null : m[2];
}

// ---------------- 公开类型 ----------------

export type ChatStreamStatus = 'streaming' | 'done' | 'error';

/** 单条流的状态（不可变对象：每次更新都替换引用，可安全用作 useSyncExternalStore 快照） */
export interface ChatStreamState {
  /** 会话键：wx:<contactId> / qq:<contactId> / sms:<storageKey> */
  sessionKey: string;
  /** AI 回复消息 id（最终落盘沿用，页面渲染 key 用） */
  aiMsgId: string;
  /** 已接收的完整内容（流进行中不更新、结束时一次性写入；不再用于流式气泡展示） */
  content: string;
  status: ChatStreamStatus;
  /** status==='error' 时的友好错误文案（各 App 落盘时按自己的格式包裹） */
  error?: string;
  /** 流开始时间（= 用户消息发出时刻，落盘时作为消息时间） */
  startedAt: number;
  /** 本次流请求的回复条数（>1 时按「边接收边逐条显示」分段投递，N 为上限） */
  replyCount?: number;
  /**
   * 识图失败提示（本轮图片交给识图模型失败时展示；只作系统提示，
   * 不进对话上下文、不当角色台词、不影响本轮之后的聊天）
   */
  visionNotice?: string;
  /**
   * 深度思考实况（B2）：流式接收期间已收集的 [思考] 块内容（undefined = 本轮未输出思考块）。
   * 首个思考增量立刻上屏、后续 150ms 节流合并推送；配合 thinkDone 驱动三端
   * 「正在深度思考…」脉动动效 → 「已深度思考（点击展开）」两阶段展示；
   * 流结束后随状态保留到投递完成，与落盘消息的 thinking 字段无缝衔接。
   */
  liveThink?: string;
  /** 思考阶段是否已结束（true = 正文已开始流出或流已收尾，实况卡切「已深度思考」态） */
  thinkDone?: boolean;
}

export interface ChatPayloadMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 本轮识图输入：用户随消息发送的图片（data URL）+ 随图文字（可为空） */
export interface ChatVisionInput {
  images: string[];
  text: string;
  /** fix3-8 发送者称呼（可选）：群聊传发出图片的成员名（机主行传机主名）——
   *  识图描述上下文行标注「谁发的图片」，防群聊里把机主发的图说成 AI 自己发的；
   *  缺省沿用「我」（单聊=机主本人，行为不变） */
  speakerLabel?: string;
}

/** finalize 结果：流结束（成功/失败）后的最终数据 */
export interface ChatStreamResult {
  aiMsgId: string;
  /** 流式接收的完整内容（可能为空串：由各 App 决定空回复兜底文案） */
  content: string;
  /**
   * 深度思考：本轮 [思考]…[/思考] 块收集到的思考过程（未开启/未输出时为 undefined）；
   * 各端挂到本轮第一条 AI 文本消息的 thinking 字段（渲染为气泡上方可折叠的思维链卡片）
   */
  thinking?: string;
  /**
   * 未随 onSegment 放出的最后一段：回复条数 >1 时 = 第 N 条（分段器已按上限留出，
   * 可能包含溢出合并的后续句子；空串 = 流中分段已全部投递）；单条模式 = 完整 content。
   * 各 App 的 finalize 只处理 tail（多条模式）/ content（单条模式），与流中已投递分段不重不漏。
   */
  tail: string;
  /** 失败原因（status==='error' 时存在） */
  error?: string;
  /** 流开始时间（消息 time 字段用） */
  startedAt: number;
}

export interface BeginChatStreamOptions {
  sessionKey: string;
  aiMsgId: string;
  /** 完整请求消息（system 人设在最前 + 上下文），本模块原样透传给 /api/chat 与浏览器直连 */
  messages: ChatPayloadMessage[];
  apiConfig: ApiConfig;
  /**
   * 回复条数（>1 时启用）：本次要求 AI 连发多条消息（N 是上限不是任务），
   * 本模块按「边接收边逐条显示」处理——每凑齐一条完整消息立刻回调 onSegment，
   * 并抬高 max_tokens 下限防止多条被截断；最后一条经 finalize 的 result.tail 交付。
   */
  replyCount?: number;
  /**
   * 流中分段回调（回复条数 >1 时启用）：分段器每凑齐一条完整消息（边界出现、标记闭合）
   * 立刻回调一次，各 App 在此把该段解析成真实消息排队逐条投递上屏（边接收边逐条显示，
   * 不存在先全文后消失的流式气泡）；退出页面后本回调照常触发（模块层运行）。
   */
  onSegment?: (segment: string) => void;
  /**
   * 本轮识图输入（可选）：用户在聊天里发送的图片。提供时先用「设置 › 识图模型」
   * 把图片转成文字描述，再作为上下文交给聊天模型；识图模型只负责看图，
   * 最终回复由聊天模型生成；未配置识图模型 / 识图失败不影响文字聊天。
   */
  vision?: ChatVisionInput;
  /**
   * 识图成功回调（可选）：desc = 本轮全部图片的完整描述文本（多张时为按「图N：」分行的逐张描述）。
   * 各 App 在此把描述拆分写进对应图片消息持久化（img.desc，多图用 vision-client 的
   * splitVisionDesc(desc, images.length) 对应各图），之后的聊天历史 AI 都能读到图片内容，
   * 不再只剩「[图片]」占位；与页面是否存活无关（模块层调用）。
   */
  onVision?: (desc: string) => void;
  /**
   * 流结束（成功或失败，恰好一次）后把最终 AI 消息写入该角色的聊天记录。
   * 由各 App 在发起时提供：内部使用该 App 的 loadMsgs/saveMsgs 与消息类型，
   * 不依赖任何组件存活（页面已退出也能正确落盘）。
   */
  finalize: (result: ChatStreamResult) => void;
}

// ---------------- 40-a 拉黑第二层兜底 ----------------

/**
 * 从 sessionKey 解析参与拉黑的会话（wx:<contactId> / qq:<contactId> / sms:c:<contactId>）；
 * 群聊（wx:group: / qq:group:）、小助手（sms:assistant）及其他非联系人会话返回 null（不参与拉黑）。
 * 拉黑状态按 App × 联系人 ID 隔离，这里的解析与各 App 的会话键同源同义。
 */
function blockSessionOf(sessionKey: string): { app: BlockApp; contactId: string } | null {
  // 群聊会话无拉黑关系天然放行（拉黑按 App × 单联系人 ID 隔离，群成员不参与拉黑）；
  // AI 助手会话同理（sms:assistant / assistant）：助手是系统侧角色，不进入「角色 ↔ 用户」拉黑图谱
  if (sessionKey.startsWith('wx:group:') || sessionKey.startsWith('qq:group:')) return null;
  if (sessionKey === 'sms:assistant' || sessionKey === 'assistant') return null;
  if (sessionKey.startsWith('sms:c:')) return { app: 'sms', contactId: sessionKey.slice('sms:c:'.length) };
  if (sessionKey.startsWith('sms:')) return null; // 其余 sms 键（历史助手兼容等）不参与拉黑
  const m = /^(wx|qq):(.+)$/.exec(sessionKey);
  return m ? { app: m[1] as BlockApp, contactId: m[2] } : null;
}

/**
 * 第十六轮：用户发言打点（每轮聊天一次）——
 * - 作息记忆：noteActive()（全局活跃直方图，群聊/助手也计——机主在用手机）；
 * - AI 情绪：仅 1:1 会话（blockSessionOf 解析出联系人）→ noteUserMsgMood(cid, 本轮最后一条用户消息文本)。
 */
function noteEngagement(sessionKey: string, messages: ChatPayloadMessage[]): void {
  try {
    noteActive();
    const bs = blockSessionOf(sessionKey);
    if (!bs) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
        noteUserMsgMood(bs.contactId, msg.content);
        return;
      }
    }
  } catch {
    /* 打点失败绝不影响聊天 */
  }
}

// ---------------- 40-B 小号认知摘录（多账号 AI 认知隔离） ----------------

/**
 * 需求「二/三/四」（AI 认知隔离）的注入实现（v2：单库 + 键作用域 + per-app 账号）：
 * - 某 App 当前账号为大号（main）时发起聊天，把用户各小号/匿名号与 AI 的聊天记录摘录算成 digest，
 *   追加进本轮人设 system 消息（persona.buildAltAccountsSection 的固定规则文案 + 摘录），
 *   AI 因此能回答大号用户问起小号的事（信息来源=小号与 AI 的聊天记录）；
 * - 小号/匿名号侧聊天不注入（getActiveAccountIdFor(app) 非 main → null）：AI 对小号是陌生人，
 *   也绝不反向泄露大号记忆——digest 只从小号作用域键单向读出；
 * - 数据源（v2）：主库 localDB 的 kv store 一次 getAll 拿全部原始行（各账号键带 `--{id}` 后缀），
 *   按 accounts.parseScopedKey 解析 {base, accId} 归属账号；联系人名字映射用共享库 contacts store；
 * - 每轮最多计算一次（runStream 内、构建请求前），IndexedDB 读很快；失败→null 零注入，
 *   不影响本轮聊天。电话通话走服务端 persona 直调（不传 ctx.altAccountsDigest）→ 不注入，行为零变化。
 */

/** 小号/匿名号作用域键内聊天记录的 kv 裸键前缀（与 idb-kv 迁移清单同源；sms- 为更早版本遗留键） */
const ALT_CHAT_KEY_PREFIXES = ['wx-chat-msgs:', 'qq-chat-msgs:', 'ios-chat-msgs:', 'sms-chat-msgs:'] as const;
/** 信息 App 内置 AI 小助手会话（精确键） */
const ALT_ASSISTANT_KEY = 'ios-chat-assistant-msgs';
/** 每账号摘录的最大消息条数（跨会话合并取最新） */
const ALT_DIGEST_MAX_MSGS = 24;
/** 单条摘录文本最大长度（超出截断，防长图描述/长句撑爆 prompt） */
const ALT_DIGEST_MSG_MAX_CHARS = 80;
/** digest 总字符上限（多小号兜底，超出截断） */
const ALT_DIGEST_MAX_CHARS = 2400;

/** 摘录条目（mine=true=小号侧发出；peer=该会话对方角色名；time=消息时间戳；app=来源平台标注） */
interface AltDigestEntry {
  time: number;
  mine: boolean;
  peer: string;
  text: string;
  app: string;
}

/** 单条消息 → 摘录条目；不参与 AI 上下文的消息（撤回/错误/系统行/通知/拉黑卡等）与空消息返回 null。
 *  消息形状三端兼容：role me|user|self=小号侧，其余（peer/assistant/…）=对方；文本取 text|content。
 *  appLabel：会话所在平台（微信/QQ/信息，用户规则四：添加来源要说对，不能猜） */
function altDigestEntryOf(raw: unknown, peer: string, appLabel: string): AltDigestEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.recalled === true || m.error === true) return null;
  const kind = typeof m.kind === 'string' ? m.kind : '';
  // 与各 App 历史上下文同口径：系统提示/通知行/拉黑卡/群邀请卡/通话卡不进上下文，摘录同样排除
  if (kind === 'sys' || kind === 'notice' || kind === 'blockreq' || kind === 'groupcard' || kind === 'call') return null;
  const mine = m.role === 'me' || m.role === 'user' || m.role === 'self';
  const time = typeof m.time === 'number' && m.time > 0 ? m.time : 0;
  let text = typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : '';
  text = text.trim();
  // 好友验证消息/打招呼不是聊天内容（用户规则五）：加好友过程消息区分标注——加进摘录但绝不当作
  // 「小号说过的话」（添加成功提示纯系统行直接丢弃）；AI 只能说「TA 加我时验证消息写的是…」
  const fr = typeof m.fr === 'string' ? m.fr : '';
  if (fr === 'added') return null;
  if (fr === 'apply') text = `[好友验证消息] ${text}`;
  else if (fr === 'greet') text = `[打招呼] ${text}`;
  if (text.startsWith('data:')) text = ''; // QQ 图片消息 content=dataURL：不出原始图，按 kind 出占位
  if (kind === 'image') {
    // 图片消息：有识图描述时带出内容（wx 端 content 恒为「[图片]」占位，desc 才是有效信息）
    const desc = (m.img as { desc?: unknown } | undefined)?.desc;
    if (typeof desc === 'string' && desc.trim()) text = `[图片]（图片内容：${desc.trim()}）`;
  }
  if (!text) {
    // 非文本消息按 kind 出占位/描述（与各 App 历史序列化占位口径一致；图片描述已在上方带出）
    if (kind === 'image') {
      text = '[图片]';
    } else if (kind === 'voice') {
      const v = m.voice as { transcript?: unknown; localText?: unknown } | undefined;
      const t = typeof v?.transcript === 'string' ? v.transcript.trim() : '';
      const l = typeof v?.localText === 'string' ? v.localText.trim() : '';
      text = t || l || '[语音]';
    } else if (kind === 'sticker') {
      const meaning = (m.stk as { meaning?: unknown } | undefined)?.meaning;
      text = typeof meaning === 'string' && meaning.trim() ? `[表情包：${meaning.trim()}]` : '[表情包]';
    } else if (kind === 'textcard') {
      const cardText = (m.card as { text?: unknown } | undefined)?.text;
      text = typeof cardText === 'string' && cardText.trim() ? `[文字图片]（卡片上写着：${cardText.trim()}）` : '[文字图片]';
    } else if (kind === 'redpacket') text = '[红包]';
    else if (kind === 'giftcard') text = '[礼物]';
    else if (kind === 'transfer') text = '[转账]';
    else if (kind === 'location') text = '[位置]';
    else if (kind === 'forward') text = '[转发消息]';
    else if (kind === 'family') text = '[亲属卡]';
    else return null; // 无文本且非已知类型：跳过
  }
  // 压成单行 + 截断（摘录是给 AI 看的上下文，不保留换行排版）
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length > ALT_DIGEST_MSG_MAX_CHARS) text = `${text.slice(0, ALT_DIGEST_MSG_MAX_CHARS)}…`;
  return { time, mine, peer, text, app: appLabel };
}

/** kv 裸键（base）→ 会话对方角色名；非聊天键返回 null（联系人会话按 contactId 查共享联系人名映射） */
function altSessionPeerName(key: string, nameById: Map<string, string>): string | null {
  if (key === ALT_ASSISTANT_KEY) return '小助手';
  for (const p of ALT_CHAT_KEY_PREFIXES) {
    if (!key.startsWith(p)) continue;
    let id = key.slice(p.length);
    if (id.startsWith('c:')) id = id.slice(2); // 信息端会话键形如 c:<contactId>
    if (nameById.has(id)) return nameById.get(id) as string;
    return p === 'wx-chat-msgs:' ? '微信联系人' : p === 'qq-chat-msgs:' ? 'QQ好友' : '联系人';
  }
  return null;
}

/** kv 裸键（base）→ 来源平台标注（用户规则四：添加来源/在哪聊的要准，AI 不许猜）：
 *  微信键系→微信、QQ 键系→QQ、信息键系（含历史 sms-）→信息；其余返回 '' */
function altSessionAppLabel(key: string): string {
  if (key.startsWith('wx-chat-msgs:')) return '微信';
  if (key.startsWith('qq-chat-msgs:')) return 'QQ';
  if (key.startsWith('ios-chat-msgs:') || key.startsWith('sms-chat-msgs:')) return '信息';
  if (key === ALT_ASSISTANT_KEY) return '信息';
  return '';
}

/** 相对时间（小号摘录标题行用：最近一条消息距今多久） */
function altRelTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return `${Math.floor(diff / (30 * 86_400_000))}个月前`;
}

/**
 * 计算「用户的小号」聊天摘录 digest（仅在该 App 当前账号为大号时返回内容；否则/失败/无数据 → null）。
 * v2 单库：一次读主库 kv 全部原始行（各账号键带 `--{id}` 后缀），按 parseScopedKey 解析出的
 * 账号 id 归属；base 匹配聊天键前缀（或小助手精确键）的行即该账号的聊天消息；
 * 联系人名字映射用共享库 contacts（三端共享联系人，id→名字一次建全）。
 * 跨会话合并消息按时间倒序取最新 24 条；每账号一个块（标题行用注册表条目：小号名/匿名账号 + 号码），
 * 块间空行；无聊天记录的账号跳过；主库读取失败返回 null（零注入）。
 */
async function computeAltAccountsDigest(app: AccountApp): Promise<string | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;
  // 门控：仅该 App 当前账号为大号时注入（小号/匿名号侧 AI 与用户互为陌生人）
  const currentId = getActiveAccountIdFor(app);
  if (currentId !== MAIN_ACCOUNT_ID) return null;
  const alts = getAccounts().filter((a) => a && a.kind !== 'main' && a.id !== currentId);
  if (alts.length === 0) return null;
  // 主库一次 getAll 拿 kv 全部原始行（含各账号后缀键）+ contacts 全部记录
  let kvRows: { key: string; value: unknown }[];
  let contactRows: { id: string; name: string }[];
  try {
    const [kv, contacts] = await Promise.all([localDB.getAll('kv'), localDB.getAll('contacts')]);
    kvRows = kv as { key: string; value: unknown }[];
    contactRows = contacts as { id: string; name: string }[];
  } catch {
    return null; // 主库读取失败：本轮零注入，不影响聊天
  }
  const nameById = new Map<string, string>();
  for (const c of contactRows) {
    if (c && typeof c.id === 'string' && typeof c.name === 'string' && c.name.trim()) {
      nameById.set(c.id, c.name.trim());
    }
  }
  // 按账号收集摘录条目：键后缀归属小号账号 + base（裸键）匹配聊天键
  const altIds = new Set(alts.map((a) => a.id));
  const entriesByAcc = new Map<string, AltDigestEntry[]>();
  for (const row of kvRows) {
    if (!row || typeof row.key !== 'string' || !Array.isArray(row.value)) continue;
    const scoped = parseScopedKey(row.key);
    if (!scoped || !altIds.has(scoped.accId)) continue; // 大号原键/其他账号数据跳过
    const peer = altSessionPeerName(scoped.base, nameById);
    if (!peer) continue;
    const appLabel = altSessionAppLabel(scoped.base);
    const list = entriesByAcc.get(scoped.accId) ?? [];
    for (const raw of row.value) {
      const e = altDigestEntryOf(raw, peer, appLabel);
      if (e) list.push(e);
    }
    entriesByAcc.set(scoped.accId, list);
  }
  const blocks: string[] = [];
  for (const acc of alts) {
    const entries = entriesByAcc.get(acc.id) ?? [];
    if (entries.length === 0) continue; // 无聊天记录的账号跳过
    // 跨会话按时间倒序取最新 N 条，再按时间正序输出（对话自然阅读顺序）
    entries.sort((a, b) => b.time - a.time);
    const picked = entries.slice(0, ALT_DIGEST_MAX_MSGS);
    picked.sort((a, b) => a.time - b.time);
    // 标题行用注册表条目（小号名/匿名账号 + 手机号），摘录格式与 v1 完全一致；
    // C15：大号档账号（grade='main'，Task 33 引入）此前也被装进【用户的小号】标题下——
    // 标题补「（大号）」让 AI 知道这是用户的大号马甲（语义上不再是「小号」）
    const label =
      acc.kind === 'anon'
        ? '匿名账号'
        : (acc.name.trim() || '小号') + (acc.grade === 'main' ? '（大号）' : '');
    const phone = acc.phone ? `（${acc.phone}）` : '';
    const recent = altRelTime(picked[picked.length - 1].time);
    const lines = [`〔${label}〕${phone}与你的最近聊天${recent ? `（最近消息：${recent}）` : ''}：`];
    for (const e of picked) {
      // 每条带来源平台标注（微信/QQ/信息；用户规则四：AI 说「在哪加的/在哪聊的」必须准）：
      // 「用户（微信）：想你」=小号在微信说的；peer 行=你（AI）在那个平台回复的
      lines.push(`${e.mine ? '用户' : e.peer}${e.app ? `（${e.app}）` : ''}：${e.text}`);
    }
    blocks.push(lines.join('\n'));
  }
  if (blocks.length === 0) return null;
  let digest = blocks.join('\n\n');
  if (digest.length > ALT_DIGEST_MAX_CHARS) digest = `${digest.slice(0, ALT_DIGEST_MAX_CHARS)}…`;
  return digest;
}

/** 把 digest 段合并进请求消息：追加到首条 system 消息（人设 prompt）末尾；
 *  极端情况下请求里没有 system 消息（理论上不发生——人设/时间块恒在首位）时前置一条附加 system。 */
function mergeAltDigestIntoMessages(messages: ChatPayloadMessage[], digest: string): ChatPayloadMessage[] {
  const section = buildAltAccountsSection(digest);
  if (!section) return messages;
  const idx = messages.findIndex((m) => m.role === 'system');
  if (idx === -1) return [{ role: 'system', content: section }, ...messages];
  const out = messages.slice();
  out[idx] = { ...out[idx], content: `${out[idx].content}\n\n${section}` };
  return out;
}

// ---------------- 内部状态 ----------------

interface StreamRuntime {
  state: ChatStreamState;
  /** finalize 是否已执行（防止重复落盘） */
  finalized: boolean;
  /** 换号中止标记（abortStreamsByPrefix 预置）：onDelta 停止喂分段器、收尾跳过落盘与 payload 清理 */
  aborted: boolean;
}

/** 全部流（含已结束未清理的：留给页面重进时同步，超量后按时间淘汰） */
const streams = new Map<string, StreamRuntime>();
/** 进行中流的实际请求 payload（workMessages + effConfig）：pagehide 时上报服务端接力生成用（bg-turn） */
const activePayloads = new Map<string, { messages: ChatPayloadMessage[]; config: ApiConfig }>();
const subs = new Set<() => void>();
const finalizedSubs = new Set<(sessionKey: string) => void>();

/**
 * 新流开始前，若服务端还有关页期间生成中的接力回复，上报 cancel 让其作废：
 * 否则用户回到网页马上发新消息时，会先收到迟到的旧接力回复、再收到新回复（双回复）。
 * 尽力而为：发失败（如刚关页重开时序颠倒）也不影响本轮聊天，接力回复只会多到一条。
 */
function cancelBgRelay(sessionKey: string): void {
  try {
    void fetch('/api/chat/bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'cancel', sessionKey }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // 同上：尽力而为
  }
}

function emit(): void {
  subs.forEach((fn) => fn());
}

function emitFinalized(sessionKey: string): void {
  finalizedSubs.forEach((fn) => {
    try {
      fn(sessionKey);
    } catch {
      // 监听器异常不影响其他监听器
    }
  });
}

/** 已结束的流最多保留 24 条（重进页面同步用），超出按开始时间淘汰最旧的 */
function evictFinished(): void {
  const finished = [...streams.entries()].filter(([, rt]) => rt.state.status !== 'streaming');
  const overflow = finished.length - 24;
  if (overflow <= 0) return;
  finished
    .sort((a, b) => a[1].state.startedAt - b[1].state.startedAt)
    .slice(0, overflow)
    .forEach(([key]) => streams.delete(key));
}

function patchState(rt: StreamRuntime, patch: Partial<ChatStreamState>): void {
  rt.state = { ...rt.state, ...patch };
  emit();
}

// ---------------- 流式请求执行（与页面生命周期无关） ----------------

/**
 * 用户聊天 API 是否处于「未配置」状态：API Key 为空，且地址为空或仍是内置默认官方地址。
 * 此状态下 /api/chat 代理必然失败（服务端要求填写 API Key）、浏览器直连必然被 CORS 拦截，
 * 白白多等 1~3 秒并制造控制台 403 噪音——调用方应直接走服务端内置模型（forceSdk）兜底。
 * 注意：Key 为空但地址是自定义网关时不算未配置（存在免 Key 的本地网关），仍走正常链路。
 */
function isApiUnconfigured(cfg: ApiConfig): boolean {
  if (cfg.apiKey.trim()) return false;
  const raw = cfg.baseUrl.trim();
  if (!raw) return true;
  try {
    return new URL(raw).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

async function runStream(rt: StreamRuntime, opts: BeginChatStreamOptions): Promise<void> {
  const { apiConfig, messages } = opts;
  // 流式分段器（回复条数 > 1 时启用）：边接收边切分，每凑齐一条完整句子立刻经 onSegment
  // 投递上屏（不设条数上限：回复几条由生成端决定，切分端一句一条、不把溢出句堆进最后一条）；
  // 原文只在本模块累计（raw），不写入展示状态 —— 流式期间页面只显示「正在输入」，
  // 不再有「先全文后消失」的流式气泡；分段与展示状态完全分离（流式和分条不改同一块状态）
  const multi = typeof opts.replyCount === 'number' && opts.replyCount > 1;
  let scanner = multi && opts.onSegment ? createReplySegmentScanner(opts.onSegment) : null;
  // 深度思考剥离器：与分段器同源同生命周期（SDK 兜底重建时一并重建）；未输出 [思考] 块的
  // 会话零行为变化（纯透传），输出过则正文/思考两侧永不合流
  let thinkFilter = createThinkFilter();
  let thinkText = '';
  // 深度思考实况（B2）：liveThinkShown = 已向状态推送过思考增量；thinkDonePatched = 正文已开始
  // （思考阶段结束的相位切换只打一次）；推送按 150ms 节流合并，避免每个网络分片都触发全量重渲染
  let liveThinkShown = false;
  let thinkDonePatched = false;
  let lastLivePatchAt = 0;
  const LIVE_THINK_PATCH_MS = 150;
  // 条数多时消息总长更长：抬高 max_tokens 下限，防止多条连发被截断（代理与浏览器直连共用该配置）
  const effConfig =
    multi && opts.replyCount
      ? { ...apiConfig, maxTokens: Math.max(apiConfig.maxTokens, opts.replyCount * 120) }
      : apiConfig;
  /** 增量统一入口：原文累计 + 多条模式进分段器（立刻放出已凑齐的完整消息） */
  let raw = '';
  const onDelta = (delta: string): void => {
    // 换号中止（abortStreamsByPrefix）：不再喂原文/分段器——流中分段就此截断，
    // 旧账号会话不再产生新的投递（finalize 挡板只拦最后一条，不拦流中分段，这里补齐）
    if (rt.aborted) return;
    // 深度思考：[思考]…[/思考] 块在进正文/分段器之前剥走（思考内容不进气泡、不被切成分段）
    const tk = thinkFilter.push(delta);
    if (tk.thinking) {
      thinkText += tk.thinking;
      // 实况推送（B2）：首个思考增量立刻上屏（脉动「正在深度思考…」出现时机要快），
      // 后续增量按节流窗合并，避免高频分片拖慢气泡列表渲染
      const now = Date.now();
      if (!liveThinkShown || now - lastLivePatchAt >= LIVE_THINK_PATCH_MS) {
        lastLivePatchAt = now;
        liveThinkShown = true;
        patchState(rt, { liveThink: thinkText, thinkDone: false });
      }
    }
    if (!tk.text) return;
    // 思考结束、正文开始：实况卡相位切到「已深度思考（点击展开）」（只切一次）
    if (liveThinkShown && !thinkDonePatched) {
      thinkDonePatched = true;
      patchState(rt, { liveThink: thinkText, thinkDone: true });
    }
    raw += tk.text;
    scanner?.push(tk.text);
  };
  /**
   * 发起一轮流式请求并读完整条流（增量统一交给 onDelta）。
   * 服务器代理失败 / directOnly / 内网地址时回退浏览器直连（SSE 解析）；抛错交给调用方。
   */
  const streamOnce = async (roundMessages: ChatPayloadMessage[]): Promise<void> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: roundMessages,
        config: effConfig,
      }),
    });
    if (!res.ok || !res.body) {
      let detail = '';
      let directOnly = false;
      try {
        const data: unknown = await res.json();
        if (data && typeof data === 'object') {
          const rec = data as { error?: unknown; directOnly?: unknown };
          if (typeof rec.error === 'string') detail = rec.error;
          directOnly = rec.directOnly === true;
        }
      } catch {
        // 忽略解析失败
      }
      if (directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
        // 内网地址 / 服务器建议直连：改用浏览器直连流式请求（SSE 解析）；
        // 空回复不在此处兜底：finalize 由各 App 写入自己的兜底文案
        try {
          await directChatStream(effConfig, roundMessages, onDelta);
        } catch (directErr) {
          // 公网地址直连也失败：保留服务器侧原因，便于区分地区限制还是 CORS 问题
          const directMsg = directErr instanceof Error && directErr.message ? directErr.message : '';
          if (!isPrivateApiUrl(apiConfig.baseUrl) && detail) {
            throw new Error(`${detail}；浏览器直连也不可用${directMsg ? `：${directMsg}` : ''}`);
          }
          throw directErr;
        }
      } else {
        throw new Error(detail || `请求失败（${res.status}）`);
      }
    } else {
      // 纯文本流（text/plain）：字节增量统一交给 onDelta（多条模式进分段器）
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onDelta(decoder.decode(value, { stream: true }));
      }
    }
  };

  /**
   * 最终兜底：代理 + 浏览器直连都失败后，请求服务端内置模型（forceSdk）生成回复；
   * 成功把全量文本交给 onDelta 返回 true，失败（含非 200 / 空文本）返回 false 保留原错误。
   */
  const sdkFallbackOnce = async (roundMessages: ChatPayloadMessage[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: roundMessages, forceSdk: true }),
      });
      if (!res.ok) return false;
      const text = await res.text();
      if (!text.trim()) return false;
      onDelta(text);
      return true;
    } catch {
      return false;
    }
  };

  // ---- 40-B AI 认知隔离：主账号下注入「用户的小号」聊天摘录 ----
  // 每轮最多计算一次（IndexedDB 读很快）；非主账号/无小号数据/读取失败 → null，零注入零破坏。
  // 小号/匿名号侧不注入：AI 对小号是陌生人，摘录也绝不反向泄露大号内容。
  let baseMessages = messages;
  // v2 per-app 账号：由 sessionKey 推导所属 App（wx:/qq:/其余=sms），摘录/披露检测都按该 App 当前账号门控
  const accApp = streamAppOf(opts.sessionKey);
  const accBefore = getActiveAccountIdFor(accApp);
  try {
    const altDigest = await computeAltAccountsDigest(accApp);
    // 摘录读取窗口内该 App 发生换号（v2 切号不刷新页面）：本轮作废，绝不把旧账号上下文
    // 的回复落进新账号的会话。与 abortStreamsByPrefix 同口径清理（finalized 预置跳过落盘、
    // 移除流状态与 payload，防流状态卡在 streaming 阻塞该会话后续新回合；切号事件监听方
    // 通常已先行中止，此处为兜底幂等清理）：
    if (getActiveAccountIdFor(accApp) !== accBefore) {
      rt.finalized = true;
      rt.aborted = true;
      cancelBgRelay(rt.state.sessionKey);
      streams.delete(rt.state.sessionKey);
      activePayloads.delete(rt.state.sessionKey);
      emit();
      return;
    }
    if (altDigest) baseMessages = mergeAltDigestIntoMessages(messages, altDigest);
  } catch {
    // 摘录失败不影响本轮聊天
  }
  // 摘录读取窗口内发生换号中止：本轮作废（与识图等待后的中止检查同口径）
  if (rt.aborted) return;

  // ---- 大号侧「小号是我」披露检测（用户规则一/二：账号关联记忆） ----
  // 主号私聊里用户发言命中「小号」披露表述 → ① 落账号关联（kv 设备级共享，幂等合并）+
  // 给每个关联小号预写全部四 App 的披露粘性标记（小号/电话侧下次来聊自动「认出」，免再亮明）；
  // ② 给当前联系人的【主号侧】记忆库补一条「用户亲口告知小号」事件碎片（持久化，AI 后续能自然提起）。
  // 仅主号 + 与 AI 角色的私聊；检测/写入任何失败都不影响本轮聊天（增强能力）。
  try {
    const linkCid = streamContactIdOf(opts.sessionKey);
    if (accBefore === MAIN_ACCOUNT_ID && linkCid) {
      const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const hitAltIds = memDetectMainAltDisclosure(lastUserText);
      if (hitAltIds.length > 0) {
        memLinkAltAccounts(linkCid, hitAltIds, lastUserText);
        // 机主称谓：联系人 App 机主真名优先（编辑自己后按最新），设置 profile 名仅兑底
        const ownerLabel = cachedOwnerName() || useSettings.getState().profile.name?.trim() || '机主';
        const altLabels = hitAltIds
          .map((id) => getAccountById(id)?.name?.trim() || '小号')
          .join('、');
        memAddEventFragment(
          linkCid,
          accApp,
          `${ownerLabel}亲口告知：「${altLabels}」是${ownerLabel}的小号——小号和大号都是${ownerLabel}本人（同一个人）`,
          { sourceTag: 'acc-link' },
        );
      }
      // 【X论坛匿名小号·揭秘时刻】聊天 App 小号系统没认领的「小号/那个帖子是我发的」表述
      // → 归论坛匿名账号（A 级帖子指向明确时优先级更高，不受聊天小号命中影响）：
      // 落持久披露标记 + 写关联记忆碎片——之后 AI 分享/聊到小号帖子的初始认知变成「TA本人」，
      // 态度可以转变（吃醋/调侃钓鱼）；默认（未说破）两号记忆完全隔离。
      try {
        const anonHit = detectForumAnonDisclosure(lastUserText, hitAltIds.length > 0);
        if (anonHit) {
          const fresh = markForumAnonDisclosed(linkCid, anonHit);
          const ownerLabel2 = cachedOwnerName() || useSettings.getState().profile.name?.trim() || '机主';
          const anonName = resolveAuthor(ANON_KEY).name;
          if (fresh) {
            memAddEventFragment(
              linkCid,
              accApp,
              `${ownerLabel2}亲口向我承认：X论坛网友「${anonName}」其实是${ownerLabel2}本人的小号（匿名账号）——之前我一直以为是个陌生网友`,
              { sourceTag: 'forum-anon-link' },
            );
          }
        }
      } catch {
        // 论坛小号检测失败不影响本轮聊天
      }
    }
  } catch {
    // 检测/落盘失败不影响本轮聊天
  }

  /** 本轮实际发送的消息（识图成功后会被替换为「原图消息 + 图片描述」的组合） */
  let workMessages: ChatPayloadMessage[] = baseMessages;

  try {
    // 识图前置步骤（设置 › 识图模型；未配置 / 本轮无图片时跳过，文字聊天零影响）：
    // 识图模型只负责「看」——把图片转成描述，追加为一条 user 上下文消息；
    // 最终回复仍由聊天模型生成；识图失败展示系统提示（不进上下文、不当角色台词），本轮按无图片继续
    if (opts.vision && opts.vision.images.length > 0) {
      const visionConfig = useSettings.getState().visionConfig;
      // 第二十九轮「让 AI 知道上传的图片长什么样」：识图不再依赖用户配置——
      // describeImagesAuto 配置了走用户模型（失败自动降级），未配置直接用内置识图兜底；
      // 内置也失败才回落「图片还在加载中」临时上下文（本轮按无图继续，不阻断聊天）
      try {
        const desc = await describeImagesAuto(visionConfig, { images: opts.vision.images, text: opts.vision.text });
        if (!desc) throw new Error('识图模型返回空内容');
        const n = opts.vision.images.length;
        // fix3-8 识图描述上下文行带发送者：群聊里是谁发的图片就说谁发了（speakerLabel），
        // 未传时维持「我」（单聊=机主本人），单数/复数两种既有句式均不变
        const speaker = opts.vision.speakerLabel || '我';
        const prefix = n > 1 ? `（${speaker}发了 ${n} 张图片，图片内容分别是：` : `（${speaker}发了一张图片，图片内容是：`;
        workMessages = [...baseMessages, { role: 'user' as const, content: `${prefix}${desc}）` }];
        // 描述回写落盘（onVision 由各 App 提供）：之后的聊天历史 AI 都能读到图片内容；
        // 换号中止后不再回写（旧账号会话的落盘动作全部停止）
        try {
          if (!rt.aborted) opts.onVision?.(desc);
        } catch {
          // 落盘失败不影响本轮回复（描述已进上下文）
        }
      } catch (err) {
        const detail = err instanceof Error && err.message ? err.message : '未知原因';
        // 兜底临时上下文：明确图片已收到但看不到内容，引导自然回应（不发编造细节）；
        // 临时消息不落盘，与识图描述上下文同口径；【100-c】文案剧情化（不提幕后配置）
        const n = opts.vision.images.length;
        const speaker = opts.vision.speakerLabel || '我';
        const note =
          n > 1
            ? `（${speaker}发了 ${n} 张图片，不过图片还在加载中，你暂时看不到内容——不要编造图片里有什么，可以泛泛回应，或自然让我重新发一次。）`
            : `（${speaker}发了一张图片，不过图片还在加载中，你暂时看不到内容——不要编造图片里有什么，可以泛泛回应，或自然让我重新发一次。）`;
        workMessages = [...baseMessages, { role: 'user' as const, content: note }];
        patchState(rt, { visionNotice: `图片识别失败，本次回复未结合图片（${detail}）` });
      }
    }
    // 换号中止（识图等待窗口内发生）：旧账号会话整体作废，不再登记 payload/发起请求
    if (rt.aborted) return;
    // 按各 App 组装的消息发起请求（条数指令已注入人设 system 消息，一轮发完、不做补发）；
    // 记录实际 payload：用户在流结束前关闭网页时，pagehide 上报服务端接力生成（bg-turn）
    activePayloads.set(rt.state.sessionKey, { messages: workMessages, config: effConfig });
    if (isApiUnconfigured(apiConfig)) {
      // 未配置用户 API（无 Key + 官方默认地址）：代理与直连必然失败，跳过等待直接走
      // 服务端内置模型（与下游失败兜底同一函数）；兜底失败才落错误文案引导用户去配置
      const viaSdk = await sdkFallbackOnce(workMessages);
      if (viaSdk) {
        patchState(rt, { status: 'done' });
      } else {
        patchState(rt, {
          status: 'error',
          error: '还没有配置 API Key，内置模型也不可用；请到「设置 › API 配置」填写后重试',
        });
      }
    } else {
      await streamOnce(workMessages);
      patchState(rt, { status: 'done' });
    }
  } catch (err) {
    // 换号中止后不再补救：旧账号会话的回复已整体作废（SDK 兜底请求与错误状态一并跳过）
    if (rt.aborted) return;
    // 代理与浏览器直连都失败：最后用服务端内置模型兜底一次（forceSdk），救回本轮回复；
    // 兜底成功按正常完成收尾，失败才落错误文案（保留最先的代理侧错误，便于区分原因）；
    // 流中已凑齐的分段已经过 onSegment 逐条投递上屏，出错不影响它们（不丢已到手的正文）
    // 关键：进入 SDK 兜底前清空 raw 并重建分段器，避免「半截上游文本 + 完整 SDK 文本」拼接成乱文；
    // 旧分段器已放出的分段保留上屏、不计入新分段器的条数计数
    // 深度思考：剥离器/思考收集/实况状态同口径重建清零（半截思考随旧正文一并作废，不混入 SDK 回复）
    raw = '';
    thinkFilter = createThinkFilter();
    thinkText = '';
    liveThinkShown = false;
    thinkDonePatched = false;
    if (rt.state.liveThink !== undefined) patchState(rt, { liveThink: undefined, thinkDone: undefined });
    if (multi && opts.onSegment) {
      scanner = createReplySegmentScanner(opts.onSegment);
    } else {
      scanner = null;
    }
    const viaSdk = await sdkFallbackOnce(workMessages);
    if (viaSdk) {
      patchState(rt, { status: 'done' });
    } else {
      patchState(rt, {
        status: 'error',
        error: err instanceof Error && err.message ? err.message : '消息没有送达，请稍后重试',
      });
    }
  }
  // ---- 收尾（status 补丁与 finalize 在同一微任务里，订阅方重渲染时落盘已完成）----
  // 换号中止（abortStreamsByPrefix）：整段收尾跳过——finalize 不再落盘（finalized 已预置）；
  // activePayloads 也不删：此刻同键可能已被换号后的新流重新登记，误删会丢新流的 pagehide 接力 payload
  if (!rt.aborted) {
    activePayloads.delete(rt.state.sessionKey);
    if (!rt.finalized) {
      rt.finalized = true;
      try {
        // 深度思考收尾：归位剥离器残量（未闭合的思考整段归入思考；正文侧半截标记按原文归还）
        // 后再交 finalize——残量正文也过一遍分段器，不丢最后一句
        const tkEnd = thinkFilter.finish();
        if (tkEnd.text) {
          raw += tkEnd.text;
          scanner?.push(tkEnd.text);
        }
        if (tkEnd.thinking) thinkText += tkEnd.thinking;
        opts.finalize({
          aiMsgId: rt.state.aiMsgId,
          content: raw,
          thinking: thinkText || undefined,
          // 多条模式：tail = 分段器剩余的最后一条（第 N 条，可能含溢出合并的句子）；
          // 单条模式：tail = 完整内容（finalize 按旧管线处理，行为与旧版一致）
          tail: scanner ? scanner.finish() : raw,
          error: rt.state.error,
          startedAt: rt.state.startedAt,
        });
        // 收尾实况（B2）：把完整思考（含 finish 归位的残量）一次性刷进状态并钉死「已深度思考」
        // 相位——流结束到消息投递完成的窗口里，输入指示器上方的实况卡继续展示，无缝衔接
        patchState(rt, { content: raw, ...(liveThinkShown ? { liveThink: thinkText, thinkDone: true } : {}) });
      } catch {
        // 落盘失败不影响状态广播（与各 App 持久化失败静默的既有策略一致）
      }
    }
    emitFinalized(rt.state.sessionKey);
    emit();
  }
}

// ---------------- 全局 API ----------------

/**
 * 发起一条流式请求（全局发起，与页面生命周期解耦）。
 * 同一会话已有进行中的流时拒绝并返回 false（调用方应回滚刚插入的用户消息）。
 */
export function beginChatStream(opts: BeginChatStreamOptions): boolean {
  // 40-a 第二层兜底：用户拉黑角色（byUser）后，该 App 内 AI 不得发消息——除「申请解除拉黑」放行模式
  //（charRequestOnlyOf，与各 App 回合入口守卫同一条件）外，这里不发起流。静默处理：返回 true 让
  // 调用方按「已开始」收尾（不回滚已上屏的用户消息、不触发 useChatStream 错误显示路径），
  // 实际不发请求、不产生任何流状态——挡住 bg-turn 接力等间接路径，群聊/助手会话天然放行。
  const blkSession = blockSessionOf(opts.sessionKey);
  if (blkSession) {
    const blkEntry = loadBlock(blkSession.app, blkSession.contactId);
    if (blkEntry.byUser && !charRequestOnlyOf(blkEntry)) return true;
  }
  // 第十六轮：情绪/作息打点（拉黑会话提前 return 不计；正常会话在流发起前记录）
  noteEngagement(opts.sessionKey, opts.messages);
  const existing = streams.get(opts.sessionKey);
  if (existing && existing.state.status === 'streaming') return false;
  // 新回合接管：清除投递插入边界（#35）——之后投递的消息都是对本回合上下文里最新用户消息的回复，
  // 照旧追加落库（边界只在「上一轮投递未完时用户插话」的窗口内生效）。
  // M6（四轮审计）根因侧修复：群成员间切换/regen 不等投递尾巴就开始下一轮，旧实现无条件清边界
  // 会让「还在按边界插入的旧尾巴」改成追加、倒挂在用户新消息之后落库——改为尾巴仍在时先排空批占位，
  // 排空（旧回合分段全部落库）瞬间在其 onDrained 里同步清边界（先于下一批开始投递），
  // 此后（含本回合经分段/finalize 新排队的批次）投递照旧追加，落库顺序=对话时序
  if (isAiDelivering(opts.sessionKey)) {
    void scheduleAiDelivery(opts.sessionKey, [], () => {}, {
      onDrained: () => clearDeliverBoundary(opts.sessionKey),
    });
  } else {
    clearDeliverBoundary(opts.sessionKey);
  }
  const rt: StreamRuntime = {
    state: {
      sessionKey: opts.sessionKey,
      aiMsgId: opts.aiMsgId,
      content: '',
      status: 'streaming',
      startedAt: Date.now(),
      replyCount: opts.replyCount,
    },
    finalized: false,
    aborted: false,
  };
  streams.set(opts.sessionKey, rt);
  evictFinished();
  emit();
  // 服务端可能还留着上一次关页接力的生成中回复：本轮用户已回页接管，让它作废（防双回复）
  cancelBgRelay(opts.sessionKey);
  // 流一开始就登记初始 payload：pagehide 接力不再漏掉识图前置阶段（发图后立刻关页的窗口）。
  // 识图成功后 runStream 会用 workMessages/effConfig 覆盖为实际 payload。
  activePayloads.set(opts.sessionKey, { messages: opts.messages, config: opts.apiConfig });
  void runStream(rt, opts);
  return true;
}

/** 读取某会话的流状态（引用稳定；无流返回 null） */
export function getChatStream(sessionKey: string): ChatStreamState | null {
  return streams.get(sessionKey)?.state ?? null;
}

/** 某会话是否正在流式接收中（发送按钮防重入；同步读取，无 stale closure 问题） */
export function isChatStreaming(sessionKey: string): boolean {
  return streams.get(sessionKey)?.state.status === 'streaming';
}

/** 进行中流的实际请求 payload（pagehide 接力上报用，bg-turn 调用） */
export interface ActiveStreamPayload {
  sessionKey: string;
  messages: ChatPayloadMessage[];
  config: ApiConfig;
}

/** 全部进行中流的 payload 快照（仅 status==='streaming'；已结束的不返回） */
export function getActiveStreamPayloads(): ActiveStreamPayload[] {
  const out: ActiveStreamPayload[] = [];
  streams.forEach((rt, key) => {
    if (rt.state.status !== 'streaming') return;
    const p = activePayloads.get(key);
    if (p) out.push({ sessionKey: key, messages: p.messages, config: p.config });
  });
  return out;
}

/** 清除某会话已结束的流状态（页面完成落盘同步后调用；进行中的流不可清除） */
export function clearChatStream(sessionKey: string): void {
  const rt = streams.get(sessionKey);
  if (!rt || rt.state.status === 'streaming') return;
  streams.delete(sessionKey);
  emit();
}

/**
 * 中止全部会话键以 prefix 开头的流并清掉对应流状态（换号 purge 用，审计 #3）：
 * - 进行中的流：预先登记「已收尾」（finalized）并从状态表移除——HTTP 请求本身无法取消，
 *   但收尾时的 finalize 回调不再执行（旧账号会话的回复不会落盘写进对应聊天记录键），
 *   服务端关页接力生成（bg relay）一并上报 cancel 作废（防换号后迟到回复）；
 * - 已结束未清理的流状态（重进页面同步用）：换号后不再需要，一并移除。
 * 只影响前缀匹配的会话（如 'qq:'），其他端（wx: / sms:）的流不受影响。
 * 返回被中止的进行中流数量（0 = 该前缀无在途流）。
 */
export function abortStreamsByPrefix(prefix: string): number {
  let aborted = 0;
  const keys: string[] = [];
  streams.forEach((rt, key) => {
    if (!key.startsWith(prefix)) return;
    keys.push(key);
    if (rt.state.status === 'streaming') {
      rt.finalized = true; // runStream 收尾时跳过 finalize（防旧会话回复落盘）
      // 同时预置中止标记：onDelta 停止喂分段器（流中分段不再产生）、收尾段整段跳过
      //（含 activePayloads 清理——此刻起同键可能被换号后的新流重新登记，旧流不得误删）
      rt.aborted = true;
      cancelBgRelay(key); // 服务端接力生成一并作废
      aborted += 1;
    }
  });
  if (keys.length > 0) {
    for (const key of keys) {
      streams.delete(key);
      activePayloads.delete(key);
    }
    emit();
  }
  return aborted;
}

/** 订阅任意流状态变化（useChatStream 用） */
export function subscribeChatStreams(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** 订阅流结束（finalize 落盘后广播）：会话列表等非聊天页 UI 监听刷新预览 */
export function subscribeChatStreamFinalized(fn: (sessionKey: string) => void): () => void {
  finalizedSubs.add(fn);
  return () => {
    finalizedSubs.delete(fn);
  };
}

// ---------------- Hooks ----------------

const NO_STREAM: ChatStreamState | null = null;

/** 订阅某会话的实时流状态：页面组件用它渲染流式气泡 /「正在输入…」；
 *  卸载后流继续由本模块接收，重进页面重新订阅即可读到实时内容（SSR 快照为 null） */
export function useChatStream(sessionKey: string): ChatStreamState | null {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeChatStreams(onStoreChange), []);
  const getSnapshot = useCallback(() => getChatStream(sessionKey), [sessionKey]);
  return useSyncExternalStore(subscribe, getSnapshot, () => NO_STREAM);
}

/** 订阅某前缀会话的流结束事件（会话列表刷新预览用，如 'wx:' / 'qq:' / 'sms:assistant'） */
export function useChatStreamFinalized(prefix: string, onFinalized: () => void): void {
  const cbRef = useRef(onFinalized);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref；store 事件为异步触发，回调读到的一定是新值）
  useEffect(() => {
    cbRef.current = onFinalized;
  });
  useEffect(() => {
    if (!prefix) return;
    return subscribeChatStreamFinalized((sessionKey) => {
      if (sessionKey.startsWith(prefix)) cbRef.current();
    });
  }, [prefix]);
}
