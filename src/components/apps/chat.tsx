'use client';

import { Fragment, useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  AudioLines,
  Camera,
  ChevronRight,
  CircleCheck,
  EyeOff,
  History,
  Image as ImageIcon,
  Loader2,
  Mail,
  MailOpen,
  MessageCircle,
  Mic,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { GlassButton } from '@/components/ios/GlassButton';
import { AnonSwitchSheet } from '@/components/ios/AnonSwitchSheet';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import PeerStatusCard from '@/components/apps/peer-status-card';
import { useSettings, useUI } from '@/lib/ios/store';
// 聊天气泡装扮（信息 App 接入）：bubbleVisual 计算每条消息的覆盖样式（背景/文字色/尾巴），
// 与微信/QQ 完全隔离（bubbleStyle.sms 独立槽位）；设置入口 = 聊天设置 › 主题
import { BUBBLE_KIND_LABEL, bubbleVisual, TAIL_CLIP_LEFT, TAIL_CLIP_RIGHT } from '@/lib/ios/bubble-style';
import { ThemeStylePage } from './bubble-style-settings';
import { pushChatNotification, notifyPreviewText, takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, markDeliverBoundary, peekPendingMsgs, purgeDeliveryQueueByPrefix, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { consumeBgPending, onBgPageVisible, peekBgBadgeCounts, pullBgPending, registerBgSession, unregisterBgSession, type BgPendingItem } from '@/lib/ios/bg-turn';
import {
  abortStreamsByPrefix,
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  useChatStream,
  useChatStreamFinalized,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { addressNameOf } from '@/lib/contacts';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import { requestCallFollowup } from '@/lib/ios/call-followup';
import { hasVoiceCallMark, stripVoiceCallMark } from '@/lib/ios/chat-call';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { setPendingPhoneAnswer, triggerIncomingCall, useIncomingCall } from '@/lib/ios/incoming-call';
import { useGlobalCall } from '@/lib/ios/global-call';
import { localDB, genId, type CallLogRecord, type VoicemailRecord } from '@/lib/ios/db';
import { ownerProfile, setAppRelation, cachedOwnerName } from '@/lib/ios/contacts-store';
import { buildTimeAwareBlock as buildSmsTimeBlock } from '@/lib/time-aware';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
// 注：表情包开关已按需求从信息端设置页移除（信息端无表情包面板）——AI emoji 回到默认行为（始终允许，按人设自然使用）；
// 历史 localStorage 键 chat-sticker-on 对 sms 会话的残留值不再被读取
import { getActionDescOn, saveActionDescOn, useActionDescOn, ACTION_DESC_RULE, ACTION_DESC_OFF_RULE, actionDescViewOf } from '@/lib/action-desc';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
import { DEEP_THINK_RULE, extractThinkBlocks, setDeepThinkOn, useDeepThinkOn } from '@/lib/deep-think';
import { ThinkCard, ThinkLiveCard } from './think-card';
import { ActionDescLine } from './action-desc-line';
import { buildVisionRules, cleanBubbleText, extractRichActionParts } from '@/lib/chat-rich';
import { splitVisionDesc } from '@/lib/vision-client';
import {
  acceptBlockReq,
  applyCharBlockAction,
  applyUserBlockReq,
  blockActionKindOf,
  blockCoversAt,
  BLOCK_REQ_MAX_REJECTED,
  buildBlockPromptBlock,
  charRequestOnlyOf,
  isUserBlockIntent,
  loadBlock,
  rejectBlockReq,
  resolveUserReqByChar,
  setUserBlock,
  userReqActionKindOf,
  type BlockEntry,
} from '@/lib/ios/block-state';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { useEnterSend, setEnterSend, guardEnterToSend } from '@/lib/enter-send';
import { kvDel, kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { getMemSettings, memAfterAiTurn, memChatRecallBlock, memConvoFromRaw, memPurgeMessageSources, memRecallBlock, memSummarizeCallNow, profileRecallBlock, setMemScopeForApp } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { buildDynamicStateBlocks } from '@/lib/ios/ai-mood';
import { buildMomentsChatBlock } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { buildForumChatBlock } from '@/lib/forum/social';
import { ChatReplyCountPage, ChatTranslatePage, ChatVoiceFreqPage, ChatVoicePage, SmsChatSettingsPage, WorldBookPickerPage } from './chat-settings';
import { ProactiveMsgPage } from './proactive-msg-page';
import { proactiveCfgSummary, parseReminderInstruction, reminderHintHit, reminderSysHint, buildReminderSysMsg, setActiveProactiveChat } from '@/lib/ios/proactive-msg';
import {
  WB_EMPTY_BLOCKS,
  applyWbUserBlocks,
  collectWbBlocks,
  getBoundBookIds,
  loadBooks,
  setBoundBookIds,
  wbRulesBlock,
  wbScanText,
} from '@/lib/ios/worldbook';
// listContactsFor：按 App 投影联系人（sms 槽位优先，回退全局 avatar）——信息 App 内一律用它加载
import { deleteContact, getContact, listContactsFor, ownerRealName, contactRealName, updateContact, setAppFriendFlag } from '@/lib/ios/contacts-store';
import { listAlbums, getAlbum, addAlbum, addVisionDecision } from '@/lib/ios/album-store';
// 多账号 v2（Task 40-2c）：信息端账号一律走 For('sms')，AI 来电/留言归属电话 App 当前账号（For('phone')）；
// accLs 每次「现算」账号作用域 localStorage 键（大号原键零迁移），严禁缓存成模块级常量
import { ACCOUNT_CHANGED_EVENT, accLs, getAccountById, getActiveAccountFor, getActiveAccountIdFor, type AccountApp } from '@/lib/ios/accounts';
// 生图（锁脸）：回复文本 [图片:描述]/[照片:描述] 标签 → 自动生图投递（未配置/失败降级文字图片卡片）；
// 手动入口 = 加号面板「文字图片」——Task 13 起为纯文字卡片，不走生图
import { buildPhotoDescHistory, buildPhotoTagRule, downloadImageSrc, extractPhotoTags, generateCharacterPhoto, imgGenConfigReady, notePhotoMemory, splitUnfinishedPhotoTag, stripUnfinishedPhotoTag, type PhotoTag } from '@/lib/imggen';
import { autoCardText } from '@/lib/textcard';
import { TextCardActionSheet, TextCardBubble } from '@/components/apps/text-card-bubble';
import { ImageRegenSheet } from '@/components/apps/image-regen-sheet';
import { displayNameOf, isFriendIn, withDisplayNames, activeAccountIdOf, relationForAccount, remarkForApp, type ContactRecord } from '@/lib/contacts';
import { chatBadge } from '@/lib/unread-store';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { RecordOverlayWx, SttPreviewOverlay, VoiceHoldBar, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildVoicePlaceholderRule } from '@/lib/chat-media-rules';
import { cleanTextForTts, stopSpeaking } from '@/lib/ios/tts-client';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { useAutoTextareaRef } from '@/lib/ios/use-auto-textarea';
import { stopVoicePlayback, VOICE_PLAY_ERROR_EVENT } from '@/lib/ios/voice-player';
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
import { CHAT_PARSE_FAIL_TEXT, CHAT_UNKNOWN_FAIL_TEXT, classifyChatError, cooldownRemainText, lastChatErrorDetail, recordChatFail, recordChatSuccess } from '@/lib/chat-errors';
// Task 40 草稿箱：输入框文本按会话隔离持久化（小助手 assistant 与联系人会话键各自隔离，发送成功清空）
import { CHAT_DRAFT_MAX, clearChatDraft, getChatDraft, saveChatDraft } from '@/lib/ios/chat-drafts';
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { ChatErrorLine } from './chat-error-line';
import { decideAiVoiceMessage, getAiVoiceFreq, saveAiVoiceFreq, synthesizeAiVoice, undoLastAiVoiceDecision } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';

// ---------------- 类型与常量 ----------------

type TabKey = 'chats' | 'contacts';
type View = 'main' | 'add' | 'chat';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: number;
  /** 消息类型（缺省 = text；旧数据无此字段天然兼容；textcard = 文字图片卡片） */
  kind?: 'text' | 'voice' | 'image' | 'textcard';
  /** 语音消息数据（kind==='voice' 时有效；音频 dataURL 持久化在聊天记录里） */
  voice?: VoiceMsgData;
  /** 图片消息数据（kind==='image' 时有效；自动生图投递，src 为压缩 dataURL；
   *  desc 为照片描述——AI 历史可读「[图片]（图片内容：…）」、相册存档与决策日志共用；
   *  fromCard = 文字图片卡片转出的图（长按可重新生成；AI 卡片转图带角色锁脸，我的卡片不带）；
   *  prevSrc = 重新生成前的上一版图（支持恢复：长按菜单「恢复上一张」，src↔prevSrc 互换） */
  img?: { src: string; desc: string; fromCard?: boolean; prevSrc?: string };
  /** 文字图片卡片数据（kind==='textcard' 时有效）：印在卡片上的文字（AI 代笔/用户代写），无生图依赖 */
  card?: { text: string };
  /** 错误占位消息（历史遗留数据：旧版流失败/空回复落库的错误文案）：新版失败不再落占位消息，
   *  改为在触发的用户消息上打 replyFail 红色 ! 徽标；渲染层直接跳过 error 消息（不参与上下文口径不变） */
  error?: boolean;
  /** AI 回复失败标记（红色 ! 徽标）：流失败/空回复且本轮无任何产出时打在触发的我的消息上；
   *  点击徽标重试（startAiTurn），成功后 finalize 清除，仍失败可再点。不进 AI 上下文（消息本体照常参与） */
  replyFail?: boolean;
  /** Task 40 错误提示优化：失败分类文案（气泡下方居中灰字提示行显示；不落原始报错，详情走「复制错误详情」） */
  failReason?: string;
  /** 引用回复（长按菜单「引用」后发送时带上；气泡内嵌小引用块；AI 上下文带引用前缀） */
  quote?: { name: string; content: string };
  /** 已撤回（渲染为居中灰字「你撤回一条消息 / 对方撤回一条消息」，不再参与上下文） */
  recalled?: boolean;
  /** 系统提示行（拉黑/解除拉黑等状态变更；居中灰字胶囊，不参与上下文） */
  sys?: { text: string };
  /** 申请解除拉黑卡片：40-a 起双向——from 缺省视为 'char'（角色发起，用户点同意/拒绝）；
   *  from='user'（用户发起，角色用 [同意/拒绝解除拉黑] 标记决策） */
  blkreq?: { reason: string; status: 'pending' | 'accepted' | 'rejected'; from?: 'char' | 'user' };
  /** 深度思考：本轮回复 [思考]…[/思考] 块剥离出的思考过程（挂在回合第一条 AI 文本消息上，
   *  渲染为气泡上方可折叠的思维链卡片；深度思考开关关闭时渲染层直接丢弃不显示。
   *  仅展示层字段：历史序列化/记忆/翻译/语音合成均不读它） */
  thinking?: string;
  /** 历史数据兼容：wx/qq 端好友添加标记（fr）。信息端不显示加好友过程，
   *  本端不再写入也不渲染 fr 消息；旧数据若残留该字段按普通消息处理 */
}

/** 申请解除拉黑卡片：from='char' 角色发起（用户点同意/拒绝）；from='user' 用户发起（角色 AI 决策，仅展示状态） */
function SmsBlockReqCard({
  name,
  avatar,
  reason,
  status,
  from = 'char',
  onAccept,
  onReject,
}: {
  name: string;
  avatar: string | null;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  from?: 'char' | 'user';
  onAccept: () => void;
  onReject: () => void;
}) {
  const mine = from === 'user';
  return (
    <div
      data-testid={mine ? 'sms-blockreq-card-mine' : 'sms-blockreq-card'}
      className="w-fit max-w-full rounded-[18px] rounded-bl-[5px] bg-muted px-3.5 py-2.5"
      aria-label={`${name}申请解除拉黑`}
    >
      <div className="flex items-center gap-2">
        {avatar ? (
          <img src={avatar} alt="" className="h-[34px] w-[34px] shrink-0 rounded-full object-cover" />
        ) : (
          <DefaultAvatar size={34} />
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 text-[12px] leading-tight text-muted-foreground">申请解除拉黑</p>
        </div>
      </div>
      {reason && (
        <p className="mt-2 rounded-[10px] bg-black/[0.04] px-2 py-1.5 text-[13px] leading-[1.5] text-black/70 dark:bg-white/[0.08] dark:text-white/70">「{reason}」</p>
      )}
      {mine ? (
        /* 40-a：用户发起的申请——决策方是角色（AI 标记），这里只展示状态 */
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">
          {status === 'pending' ? '等待对方处理' : status === 'accepted' ? '对方已同意，拉黑已解除' : '对方已拒绝'}
        </p>
      ) : status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="sms-blockreq-reject"
            aria-label={`拒绝${name}的解除拉黑申请`}
            onClick={onReject}
            className="h-8 flex-1 rounded-full bg-black/[0.06] text-[13px] text-black/70 transition active:opacity-70 dark:bg-white/10 dark:text-white/70"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="sms-blockreq-accept"
            aria-label={`同意${name}的解除拉黑申请`}
            onClick={onAccept}
            className="h-8 flex-1 rounded-full bg-[#007AFF] text-[13px] font-medium text-white transition active:opacity-80"
          >
            同意
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">{status === 'accepted' ? '已同意，拉黑已解除' : '已拒绝'}</p>
      )}
    </div>
  );
}

/** 小助手（内置 AI 联系人，回复由 /api/chat 按用户配置的 OpenAI 兼容接口流式提供） */
const ASSISTANT = {
  name: '小助手',
  phone: '10086',
  desc: 'AI 智能助理 · 随时在线',
} as const;

/** iMessage 己方气泡蓝（用户指定参考 iMessage 截图） */
const SELF_BLUE = '#007AFF';

const SEED_MSGS: ChatMsg[] = [
  {
    id: 'seed-1',
    role: 'assistant',
    content: '你好，欢迎来到Cove，我是你的AI小助手。聊天解闷、头脑风暴、算数查资料…有什么想问的随时发消息给我',
    time: 0,
  },
];

/** 本地持久化：小助手沿用旧 key 兼容历史记录；联系人会话按 id 分 key */
const LS_READ_KEY = 'ios-chat-assistant-read';
/** 小助手会话未读条数（AI 发了几条消息，主屏角标/会话行角标就是几；0 = 已读） */
const LS_UNREAD_N_KEY = 'ios-chat-assistant-unread-n';
const LS_HIDDEN_KEY = 'ios-chat-assistant-hidden';
const LS_PIN_KEY = 'ios-chat-assistant-pin';

function lsMsgsKey(sessionKey: string): string {
  return sessionKey === 'assistant' ? 'ios-chat-assistant-msgs' : `ios-chat-msgs:${sessionKey}`;
}

function loadMsgs(sessionKey: string): ChatMsg[] | null {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const parsed: unknown = kvGet<ChatMsg[]>(lsMsgsKey(sessionKey));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const ok = parsed.every(
      (m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as ChatMsg).content === 'string' &&
        ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant')
    );
    if (!ok) return null;
    // 聊天记录不封顶（用户反馈：以前截 1000 条会挤丢旧聊天记录；kv 在 IndexedDB，纯文本容量可控）
    const msgs = parsed as ChatMsg[];
    // 语音消息规范化（旧记录/损坏记录兼容：既无音频 url 也无 localText 的语音降级为文本占位；
    // 文字转语音的本地仿真消息 url 为空串但带 localText —— 原样保留，重启后仍可静音重播）
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.kind !== 'voice') continue;
      const v = m.voice;
      const hasUrl = Boolean(v && typeof v.url === 'string' && v.url);
      const hasLocal = Boolean(v && typeof v.localText === 'string' && v.localText.trim());
      if (v && (hasUrl || hasLocal)) {
        msgs[i] = {
          ...m,
          voice: {
            url: hasUrl ? v.url : '',
            duration: typeof v.duration === 'number' && v.duration > 0 ? v.duration : 1,
            wave: Array.isArray(v.wave) ? v.wave.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1) : [],
            localText: hasLocal ? v.localText : undefined,
            transcript: typeof v.transcript === 'string' && v.transcript ? v.transcript : undefined,
            stt: v.stt === 'pending' || v.stt === 'done' || v.stt === 'failed' ? v.stt : undefined,
            synth: v.synth === 'builtin' || v.synth === 'api' ? v.synth : undefined,
            contactId: typeof v.contactId === 'string' && v.contactId ? v.contactId : undefined,
          },
        };
      } else {
        msgs[i] = { ...m, kind: 'text', voice: undefined, content: m.content || '[语音]' };
      }
    }
    // 欢迎语文案迁移：种子消息按固定 id 识别，旧文案就地替换为最新文案（用户消息不动）
    if (sessionKey === 'assistant' && msgs[0]?.id === SEED_MSGS[0].id && msgs[0].content !== SEED_MSGS[0].content) {
      msgs[0] = { ...msgs[0], content: SEED_MSGS[0].content };
    }
    return msgs;
  } catch {
    return null;
  }
}

function saveMsgs(sessionKey: string, msgs: ChatMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步；落盘防抖合并，同微信/QQ 端）；旧 localStorage 键已由迁移器删除
  // 聊天记录不封顶（用户反馈：以前截 1000 条会挤丢旧聊天记录；kv 在 IndexedDB，纯文本容量可控）
  kvSetDebounced(lsMsgsKey(sessionKey), msgs);
}

/** 会话内最后一条 assistant 消息（小助手未读水位键）：返回 id+时间，无 assistant 消息返回 null。
 *  A-5：水位从「已见消息条数」改为「最后一条已计数的 assistant 消息键」——条数水位假设消息只增
 *  不减，会话内删过消息（或 loadMsgs 的 100 条封顶截断）后 saved.length 与水位错位，
 *  saved.length > prevLen 长期不成立 → 未读角标从此不再增长 */
function lastAssistantMarkOf(list: ChatMsg[]): { id: string; time: number } | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant' && list[i].id) return { id: list[i].id, time: list[i].time };
  }
  return null;
}

// ---------------- #8 排队补跑回合的持久化（#28） ----------------

/** 待补跑回合：kick = 消息已入列（文字/语音/划转文字），只需补一轮 AI 回复；dispatch = 分句发送批次统一触发；
 *  event = 随回合注入的系统事件（拉黑申请同意/拒绝在回复中排队时保留事件，不丢语义） */
type QueuedTurn = { kind: 'kick' | 'dispatch'; event?: string };

/** 排队补跑持久化（key: sms-queued-turns）：Record<storageKey, QueuedTurn[]> JSON 落 localStorage。
 *  刷新后队列不丢：重新进入该会话时恢复进 ref、既有 flush effect 自动补跑；会话没打开就等下次进入
 *  （补跑依赖聊天页组件挂载，这是与 wx/qq 一致的既有边界）。
 *  多账号 v2：键按信息 App 当前账号作用域（accLs 每次现算，大号原键；切号后 ChatView 重挂载重读新号队列） */
const SMS_QUEUED_TURNS_KEY = 'sms-queued-turns';

function readSmsQueuedTurns(storageKey: string): QueuedTurn[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(accLs(SMS_QUEUED_TURNS_KEY, 'sms')) ?? '{}');
    const slot = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[storageKey] : null;
    if (!Array.isArray(slot)) return [];
    return slot.filter((x): x is QueuedTurn => {
      const k = (x as QueuedTurn | null)?.kind;
      return k === 'kick' || k === 'dispatch';
    });
  } catch {
    return [];
  }
}

function writeSmsQueuedTurns(storageKey: string, turns: QueuedTurn[]): void {
  try {
    const map: Record<string, QueuedTurn[]> = {};
    try {
      const raw: unknown = JSON.parse(window.localStorage.getItem(accLs(SMS_QUEUED_TURNS_KEY, 'sms')) ?? '{}');
      if (raw && typeof raw === 'object') Object.assign(map, raw);
    } catch {
      // 旧数据损坏则从空重建
    }
    if (turns.length > 0) map[storageKey] = [...turns];
    else delete map[storageKey];
    window.localStorage.setItem(accLs(SMS_QUEUED_TURNS_KEY, 'sms'), JSON.stringify(map));
  } catch {
    // localStorage 异常忽略：内存队列照常工作（仅刷新后丢该条补跑）
  }
}

/** 联系人无手机号（phone 为 null/空串）时的稳定占位号：联系人 id 哈希派生 11 位号码（1 开头、
 *  同一联系人恒定同号）——来电界面与通话记录/留言不出现空串，不同联系人的记录互不串号 */
function derivePlaceholderNumber(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `1${String(h % 10000000000).padStart(10, '0')}`;
}

/** AI 打来的电话被拒接 / 响铃超时未接（信息 App AI 语音通话标记触发）：
 *  落「未接来电」通话记录 + AI 语音留言（人设化解释，走挂断续聊 followup 链路），
 *  留言逐条落 voicemails（未读红点），电话 App 打开时可见；失败静默（记录已落，留言缺失可接受） */
async function recordMissedPhoneCall(
  contact: ContactRecord | null,
  number: string,
  fallbackName: string,
  reason: 'declined' | 'timeout',
): Promise<void> {
  const contactId = contact?.id ?? null;
  const displayName = contact?.name ?? fallbackName;
  try {
    await localDB.put('call-logs', {
      id: genId(),
      number,
      contactId,
      displayName,
      peerKind: (contact?.kind as CallLogRecord['peerKind']) ?? 'unknown',
      avatar: contact?.avatar ?? null,
      direction: 'missed',
      duration: 0,
      createdAt: Date.now(),
      // 多账号 v2：AI 来电记录归属「电话 App」当前账号（信息端 AI 来电时电话可能正用小号/匿名号）
      account: getActiveAccountIdFor('phone'),
    });
  } catch {
    // 记录落盘失败静默
  }
  if (!contact) return;
  // 40-a 拉黑拦截：用户拉黑了该角色（byUser）后，被拒/未接的 AI 语音留言不再落库
  //（通话记录本身属于电话维度照常落；这里只拦「AI 发到留言信箱的聊天内容」）
  if (loadBlock('sms', contact.id).byUser) return;
  try {
    const [owner, recent] = await Promise.all([
      ownerProfile().catch(() => null),
      Promise.resolve(loadMsgs(`c:${contact.id}`) ?? []),
    ]);
    const recentChat = recent
      .filter((m) => !m.sys && !m.blkreq && !m.recalled && (m.content ?? '').trim().length > 0)
      .slice(-6)
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
    const texts = await requestCallFollowup({
      contact: {
        name: contact.name,
        kind: contact.kind,
        gender: contact.gender || null,
        age: contact.age || null,
        height: contact.height || null,
        weight: contact.weight || null,
        occupation: contact.occupation || null,
        company: contact.company || null,
        region: contact.region || null,
        relation: contact.relation || null,
        relationByAcc: contact.relationByAcc ?? null,
        relationToUser: contact.relationToUser || null,
        birthday: contact.birthday || null,
        persona: contact.persona || null,
        background: contact.background || null,
        expressStyle: contact.expressStyle || null,
        nickname: contact.nickname || null,
        // 真实姓名用 realName 字段（name 在展示层可能已被昵称/备注替换，注入人设必须是真名）
        realName: contact.realName ?? null,
      },
      // fix3-c #8：AI 是主叫，但 direction 为机主手机视角：in=AI拨来/out=机主拨出 → AI 主叫未接场景传 'in'（对齐 chat-call 引擎口径；followup 服务端当前不消费该字段）；
      // 被拒接 = reject、响铃超时 = missed-in（与现有场景文案语义一致）
      direction: 'in',
      endReason: reason === 'declined' ? 'reject' : 'missed-in',
      connected: false,
      duration: 0,
      transcript: [],
      recentChat,
      // fix4 L17：missed 留言属电话域，记忆召回 app 键对齐 proactive-call.ts:424（#78 同款修正）
      // 与 phone.tsx 挂断续聊——通话记忆由 memSummarizeCallNow 写在 'phone' 名下（MemApp 含
      // 'phone'），互通关闭时召回按 f.app === app 精确过滤，'sms' 键召不到通话记忆（召回落空）
      memoryBlock: memRecallBlock(contact.id, 'phone', recentChat.map((m) => m.content).join(' ')) || undefined,
      timeBlock: buildSmsTimeBlock({ lastMsgTime: recent.length > 0 ? recent[recent.length - 1].time : null, regionHint: contact.region || null }),
      multiApp: getMemSettings(contact.id).share,
      // 留言条数 = 该联系人在信息聊天设置页选定的回复条数
      // （未设置默认 5 条，与微信端默认口径一致）。
      replyCount: getReplyCount(`sms:c:${contact.id}`),
      // 机主称呼：只传真名（用户规则：AI 永远不知道机主昵称，userNickname 不再下传）
      userRealName: owner?.realName || undefined,
      // 多账号关系感知：留言归属当前信息账号，分账号关系同口径
      accountId: getActiveAccountIdFor('sms'),
    });
    for (const text of texts) {
      await localDB.put('voicemails', {
        id: genId(),
        number,
        contactId,
        displayName,
        peerKind: (contact.kind as CallLogRecord['peerKind']) ?? 'unknown',
        avatar: contact.avatar ?? null,
        text,
        kind: 'voicemail',
        read: false,
        duration: Math.max(1, Math.ceil(text.length / 4)),
        createdAt: Date.now(),
        // 多账号 v2：留言同来电记录，归属电话 App 当前账号（缺省 main）
        account: getActiveAccountIdFor('phone'),
      });
    }
    // C9 信息端来电不再零痕（对齐 wx/qq 的挂断续聊落库口径）：AI 的反应文字同步落到该联系人的
    // 信息会话（错峰投递模拟打字节奏）——此前信息会话对这通来电无卡片无文字无记忆总结，
    // AI 下次在信息里完全不知道打过电话；并写通话记忆（'phone' 名下，与留言召回同库）
    try {
      const sessionKey = `c:${contact.id}`;
      const existing = loadMsgs(sessionKey) ?? [];
      const base = (existing[existing.length - 1]?.time ?? Date.now()) + 1_500;
      const withFollowup = [...existing];
      texts.forEach((text, i) => {
        withFollowup.push({
          id: genId(),
          role: 'assistant',
          content: text,
          time: base + i * 2_000,
          kind: 'text',
        });
      });
      saveMsgs(sessionKey, withFollowup);
      try {
        window.dispatchEvent(new CustomEvent('sms-msgs-changed', { detail: { cid: contact.id } }));
      } catch {
        /* 事件广播失败不影响落库 */
      }
      const ownerName = owner?.realName || '用户';
      memSummarizeCallNow(
        contact.id,
        'phone',
        useSettings.getState().apiConfig,
        [
          { role: 'peer' as const, text: '（电话打过去了，但 TA 没有接听）' },
          ...texts.map((t) => ({ role: 'peer' as const, text: t })),
        ],
        { user: ownerName, peer: contact.name },
        { direction: 'in' },
      );
    } catch {
      // 信息会话落库失败静默（留言已落，不阻塞）
    }
  } catch {
    // 留言失败静默
  }
}

/** 由联系人资料拼 AI 扮演人设（system prompt）：七要素结构化人设由全 App 共用模块组装；NPC 的归属者即聊天中用户扮演的对象；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况），由 npc-bond 组装；
 *  userReal：机主真实姓名（AI 称呼用；用户规则：昵称不再下传，AI 永远不知道机主昵称） */
/**
 * 当前联系人会话的大号关系标签（openContactChat 打开会话时写入；AI 助手会话复位为空）：
 * 信息端聊天发送流的 peer 只是显示对象，不带 relation——记忆召回的披露解锁包装段
 *（memMainRecallBlockForAlt 的 altMainRelation）从这里取。
 */
let activeContactRelation = '';
/** C6：信息端同样告知「文字消息有时会以语音条送达」（与微信/QQ 同款，见 wechat.tsx AI_VOICE_DELIVERY_RULE）——
 *  此前信息端会升级语音但不告知，AI 可能说「我给你发条语音」而系统并不发（承诺落空穿帮） */
const SMS_AI_VOICE_DELIVERY_RULE =
  '（你的文字消息有时会以语音条的形式送达对方——这是正常的送达方式，不用在意；但不要在正文里说「我给你发条语音」这类话，也不要主动承诺发语音，用文字自然聊就好。）';

function buildPersonaPrompt(c: ContactRecord, ownerName: string | null, multiApp: boolean, npcExtra?: NpcPromptExtra | null, userReal?: string | null): string {
  const mode = useSettings.getState().addressMode;
  const addrName = userReal ? addressNameOf({ name: userReal, realName: userReal }, mode) : null;
  // 多账号（用户规则二.2）：小号/匿名号侧不再注入任何大号身份/关系信息（【用户的另一个身份】段已移除）
  const accId = activeAccountIdOf('sms');
  // 多账号陌生语义（用户规则：换号/匿名号第一次联系 AI，AI 不认识这个身份）：
  // 非主号账号且与角色没有任何已建立关系（分账号关系 relationByAcc / 本账号好友标记）→ 陌生身份模式：
  // 人设不再继承大号全局关系（旧逻辑会回退成「朋友」，AI 一开口就认识人）。
  // 本账号已加过好友/填过分账号关系 → 维持独立关系语义（普通朋友默认）
  const smsAcc = getAccountById(accId);
  const strangerText =
    !!smsAcc &&
    smsAcc.kind !== 'main' &&
    !(c.relationByAcc?.[accId] ?? '').trim() &&
    ![c.friendWxByAcc?.[accId], c.friendQqByAcc?.[accId], c.friendSmsByAcc?.[accId]].some((m) => typeof m === 'boolean');
  return buildPersonaSystemPrompt(c, {
    channel: '短信',
    userName: addrName,
    ownerName,
    accountId: accId,
    // 跨 App 身份感知：互通开关（打开会话时现场读取）；陌生身份模式由人设内部忽略用户称呼/关系/多端段
    multiApp,
    // C6：语音频率非 off 时告知「文字可能以语音条送达」（与微信/QQ 三端同口径）
    extraRules: getAiVoiceFreq(`sms:${c.id}`) !== 'off' || getAiVoiceFreq(`wx:${c.id}`) !== 'off' ? [SMS_AI_VOICE_DELIVERY_RULE] : [],
    ...(strangerText ? { strangerMode: 'text' as const } : {}),
    ...npcExtra,
  });
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDay(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 会话列表时间：今天显示 HH:MM，跨天显示 M月D日 */
function fmtListTime(t: number): string {
  if (!t) return '';
  return dayKey(t) === dayKey(Date.now()) ? fmtTime(t) : fmtDay(t);
}

/** 聊天日期分隔行文案（与微信聊天时间规则一致）：今天只显 HH:MM（不加日期）；
 *  昨天「昨天 HH:MM」；一周内（含前天）「星期X HH:MM」；一周前「M月D日 HH:MM」 */
function fmtChatStamp(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(t);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${fmtTime(t)}`;
  if (now.getTime() - t < 7 * 86400000) return `星期${'日一二三四五六'[d.getDay()]} ${fmtTime(t)}`;
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

// ---------------- 长按（微信风格菜单：记录触点与行位置） ----------------

/** 长按触发时的触点信息（x=视口横坐标，rowBottom=会话行底部视口纵坐标） */
interface LongPressPos {
  x: number;
  rowBottom: number;
}

function useLongPress(onFire: (pos: LongPressPos) => void, ms = 500) {
  const timer = useRef(0);
  const fired = useRef(false);
  const pos = useRef<LongPressPos>({ x: 0, rowBottom: 0 });
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      fired.current = false;
      // rect 需在事件同步阶段捕获（timeout 里 currentTarget 已为 null）
      pos.current = { x: e.clientX, rowBottom: e.currentTarget.getBoundingClientRect().bottom };
      stop();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
        onFire(pos.current);
      }, ms);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    /** 长按已触发时拦截随后的 click（不打开会话） */
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

// ---------------- 日期分隔行（iMessage 风格） ----------------

function DaySeparator({ time }: { time: number }) {
  return (
    <div className="my-3.5 flex flex-col items-center gap-[3px]">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">iMessage</span>
      <span className="text-[11px] text-muted-foreground/80">{fmtChatStamp(time)}</span>
    </div>
  );
}

// ---------------- 气泡尾巴（与气泡同色的弧形小尾巴：剪影常量已上移 bubble-style.ts 共享，
// ---------------- QQ 装扮气泡改成信息 App 同款后两端共用同一对 TAIL_CLIP） ----------------

// ---------------- 会话行 ----------------

function AssistantRow({
  preview,
  time,
  unreadCount,
  pinned,
  onOpen,
  onLongPress,
}: {
  preview: string;
  time: string;
  unreadCount: number;
  pinned: boolean;
  onOpen: () => void;
  onLongPress: (pos: LongPressPos) => void;
}) {
  const press = useLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="和小助手聊天"
      {...press}
      // 微信样式：置顶 = 整行灰底；按下高亮 = 同款灰色（按下瞬间像临时置顶）
      // sms-session-row：会话行锚点（自定义 CSS 示例模板可改行底/分割线）
      className={`sms-session-row relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        pinned ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''
      } active:bg-black/[0.06] dark:active:bg-white/[0.08]`}
    >
      <DefaultAvatar size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-semibold">{ASSISTANT.name}</span>
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{time}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[13px] leading-snug text-muted-foreground">{preview}</p>
          {unreadCount > 0 && (
            <span
              data-testid="sms-unread-badge"
              aria-label={`${unreadCount} 条未读`}
              className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[11px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
      {/* iOS 内缩式发丝分隔线 */}
      <span aria-hidden="true" className="absolute bottom-0 left-[76px] right-0 h-px bg-border/50" />
    </button>
  );
}

// ---------------- 微信风格长按菜单（深色浮层，横向图标+文字，锚定在会话卡片下方） ----------------

interface WxMenuItem {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

/** 估算菜单总宽（CJK 字宽 ≈ 字号，每项左右 px-[13px]） */
function wxMenuWidth(labels: string[]): number {
  return labels.reduce((acc, l) => acc + l.length * 10.5 + 26, 0);
}

function WxLongPressMenu({
  pos,
  items,
  onClose,
}: {
  pos: { top: number; left: number; arrowX: number };
  items: WxMenuItem[];
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label="会话操作菜单" aria-modal="true">
      {/* 透明遮罩：点击空白处关闭 */}
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 cursor-default" />
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="absolute"
        style={{ top: pos.top, left: pos.left, transformOrigin: `${pos.arrowX + 5}px 0` }}
      >
        {/* 指向会话卡片的小箭头（与菜单同色） */}
        <span
          aria-hidden="true"
          className="absolute -top-[4.5px] z-10 h-[11px] w-[11px] rotate-45 rounded-[2px]"
          style={{ left: pos.arrowX, backgroundColor: 'rgba(44,44,46,0.97)' }}
        />
        <div
          className="relative flex items-stretch overflow-hidden rounded-[10px] shadow-2xl"
          style={{ backgroundColor: 'rgba(44,44,46,0.97)', backdropFilter: 'blur(20px)' }}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`flex flex-col items-center gap-[5px] px-[13px] pb-2 pt-[9px] text-white transition-colors active:bg-white/15 ${
                i > 0 ? 'border-l border-white/10' : ''
              }`}
            >
              <item.icon className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
              <span className="whitespace-nowrap text-[10.5px] leading-none">{item.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ---------------- iOS 风格确认弹窗（App 容器内绝对定位，弹簧动画） ----------------

function IOSConfirmDialog({
  open,
  title,
  desc,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  desc?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center px-10"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <button type="button" aria-label="取消" onClick={onCancel} className="absolute inset-0 cursor-default bg-black/35" />
      <motion.div
        initial={{ opacity: 0, scale: 1.1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 480, damping: 30 }}
        className="relative w-full max-w-[270px] overflow-hidden rounded-[14px] bg-[#f4f4f6]/95 text-center shadow-2xl backdrop-blur-2xl dark:bg-[#2a2a2c]/95"
      >
        <div className="px-4 pb-4 pt-[18px]">
          <p className="text-[16px] font-semibold leading-snug">{title}</p>
          {desc && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{desc}</p>}
        </div>
        <div className="flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-[44px] flex-1 items-center justify-center border-r border-black/10 text-[16px] transition-colors active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-[44px] flex-1 items-center justify-center text-[16px] font-semibold text-[#FF3B30] transition-colors active:bg-black/5 dark:text-[#FF453A] dark:active:bg-white/10"
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------- 聊天视图（iMessage 风格） ----------------

// ---------------- 加号面板：相机 / 图片 / 文字图片（对齐微信 PlusPanel，iMessage 配色） ----------------

type SmsPlusAction = 'camera' | 'image' | 'textcard';

/** File → 压缩 dataURL（与微信端 readImageFile 同款：默认 720px 上限、GIF 动图直通） */
function readSmsImageFile(file: File, max = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const result = String(reader.result);
      // GIF 动图直通：不经 canvas（重绘会只保留第一帧）
      if (file.type === 'image/gif' || /^data:image\/gif/i.test(result)) {
        resolve(result);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('图片处理失败'));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          reject(new Error('图片处理失败'));
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

/** 加号面板（输入栏下方弹出；相机/图片/文字图片三宫格，瓷贴样式对齐微信端）。信息 App 保持原生（不可自定义） */
function SmsPlusPanel({ onAction }: { onAction: (a: SmsPlusAction) => void }) {
  const all: Array<{ key: SmsPlusAction; label: string; icon: React.ReactNode }> = [
    { key: 'camera', label: '相机', icon: <Camera className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'image', label: '图片', icon: <ImageIcon className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'textcard', label: '文字图片', icon: <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
  ];
  return (
    <div
      className="z-20 shrink-0 border-t border-white/60 bg-white/60 px-2 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
      data-testid="sms-plus-panel"
    >
      <div className="grid grid-cols-3">
        {all.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`sms-plus-${it.key}`}
            onClick={() => onAction(it.key)}
            className="flex flex-col items-center gap-[7px] py-2 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="flex h-[57px] w-[57px] items-center justify-center rounded-[14px] bg-white/70 text-black/70 shadow-[0_1px_5px_rgba(0,0,0,0.05)] ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.1] dark:text-white/75 dark:ring-white/[0.1]">
              {it.icon}
            </span>
            <span className="text-[12px] text-black/60 dark:text-white/60">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 「文字图片」弹层（加号面板 → 文字图片；Task 13 卡片版，无生图依赖——
 *  输入可空：留空 = AI 按人设+聊天记录代笔；输入非空 = 用户代笔直接上卡） */
function SmsTextCardSheet({
  charName,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  charName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (busy) return;
    onSubmit(text.trim());
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="sms-textcard-sheet">
      <div className="w-full max-w-[420px] rounded-t-[20px] bg-white/85 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 shadow-[0_8px_28px_rgba(17,24,39,0.14)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1C1C1E]/85 dark:ring-white/[0.09]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold">写一张文字图片发给{charName}</p>
          <button
            type="button"
            aria-label="关闭文字图片"
            data-testid="sms-textcard-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-black/50 ring-1 ring-white/70 backdrop-blur-xl disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60 dark:ring-white/[0.1]"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={160}
          data-testid="sms-textcard-input"
          placeholder="写点想印在卡片上的字（留空 = AI 结合 TA 的人设和你们的聊天记录帮你写）"
          className="w-full resize-none rounded-[12px] bg-white/60 p-3 text-[15px] leading-[1.6] outline-none ring-1 ring-white/70 backdrop-blur-xl placeholder:text-black/30 focus:ring-2 focus:ring-[#007AFF]/60 disabled:opacity-60 dark:bg-white/[0.08] dark:ring-white/[0.1] dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="sms-textcard-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="sms-textcard-submit"
          onClick={submit}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#007AFF] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              正在写文字图片…
            </>
          ) : (
            '生成并发送'
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-black/35 dark:text-white/35">
          文字图片以我的身份发出，{charName}会看到卡片上的字
        </p>
      </div>
    </div>
  );
}

/** 聊天对端信息：顶栏标题（手机号）与头像 */
interface ChatPeer {
  title: string;
  avatarSrc: string | null;
  /** 对方名字（聊天设置页信息卡用；信息 App 内为昵称/备注） */
  name?: string;
  /** 备注名（仅机主自己可见；聊天设置页备注行用） */
  remark?: string;
}

/** 当前聊天会话：'assistant' | 'c:<contactId>' */
interface ChatSession {
  key: string;
  peer: ChatPeer;
  systemPrompt: string | null;
}

function ChatView({
  storageKey,
  initialMsgs,
  onMsgsChange,
  peer,
  systemPrompt,
  onBack,
  onSaveRemark,
  /** 当前联系人音色（contact.voiceId；仅联系人会话传入，「他的声音」入口摘要与选择页用；AI 助手会话不传） */
  contactVoiceId,
  /** 保存 TA 的声音（仅联系人会话传入；空串 = 恢复默认；宿主复用备注的持久化路径写到联系人 voiceId） */
  onSaveVoiceId,
  /** 联系人资料变更后通知父级刷新 contacts state + chatSession.peer.avatarSrc（仅联系人会话传入；
   *  AI 自主换头像后调用，保证退出会话再回主列表 / 重新进入会话时数据一致；#108/#119） */
  onContactChanged,
  /** 当前账号与角色的关系（多账号关系感知；父级按联系人实时计算，AI 助手/USER 会话不传 = 隐藏） */
  relation: relationProp,
  /** 保存关系（当前账号作用域，父级调 setAppRelation + loadContacts）；不传 = 隐藏该行 */
  onSaveRelation: onSaveRelationProp,
  /** 打开角色状态卡（点击顶栏对方头像时回调；仅联系人会话传入，小助手会话不弹） */
  onOpenPeerStatus,
}: {
  /** 会话存储键：'assistant' | 'c:<contactId>'（key 变化 = 组件重挂载，互不串扰） */
  storageKey: string;
  initialMsgs: ChatMsg[];
  /** 消息变化回传父级（小助手会话用于列表预览；联系人会话不传） */
  onMsgsChange?: (msgs: ChatMsg[]) => void;
  peer: ChatPeer;
  /** 联系人聊天的 AI 人设（system 消息，随请求发送） */
  systemPrompt: string | null;
  onBack: () => void;
  /** 保存备注（仅联系人会话传入；空串 = 清除；宿主负责持久化并刷新展示名） */
  onSaveRemark?: (v: string) => void;
  /** 当前联系人音色（contact.voiceId；空 = 跟随全局默认） */
  contactVoiceId?: string | null;
  /** 保存 TA 的声音（空串 = 恢复默认；宿主负责持久化并刷新联系人列表） */
  onSaveVoiceId?: (vid: string) => void;
  /** 联系人资料变更后通知父级刷新 contacts state + chatSession.peer.avatarSrc（仅联系人会话传入；
   *  AI 自主换头像后调用，保证退出会话再回主列表 / 重新进入会话时数据一致；#108/#119） */
  onContactChanged?: (contactId: string) => void;
  /** 当前账号与角色的关系（多账号关系感知；父级计算；不传 = 隐藏关系行） */
  relation?: string | null;
  /** 保存关系（当前账号作用域；父级持久化）；不传 = 隐藏该行 */
  onSaveRelation?: (v: string) => void;
  /** 打开角色状态卡（仅联系人会话传入；小助手会话不传 → 顶栏头像不可点） */
  onOpenPeerStatus?: () => void;
}) {
  // Task 40 草稿箱：惰性初始化恢复本会话未发送草稿（ChatView 按 storageKey keyed 重挂载，
  // 小助手 assistant 与各联系人会话键天然隔离互不干扰）
  const [input, setInput] = useState(() => getChatDraft('sms', storageKey));
  /** Task 40 草稿箱：超长截断提示的 5 秒节流（连续键入超长文本只提示一次） */
  const draftWarnRef = useRef(0);
  /** 多行输入自适应增高：内容变化时重算高度（iMessage 胶囊随内容长高，清空回落单行） */
  const smsTaRef = useAutoTextareaRef(input, 110);
  // 挂载时读本地记录；无记录（或被清空）则回落 initialMsgs
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    const saved = loadMsgs(storageKey);
    return saved && saved.length ? saved : initialMsgs;
  });
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `sms:${storageKey}`;
  /** Task 40 错误提示优化：用户点「隐藏这条提示」的失败提示行（内存态，重挂载/刷新后恢复显示） */
  const [hiddenFail, setHiddenFail] = useState<Record<string, boolean>>({});
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  // 退出聊天页/切换会话（组件按 key 重挂载）：停止语音气泡播放与朗读并释放（防跨会话串音）
  useEffect(
    () => () => {
      stopSpeaking();
      stopVoicePlayback();
    },
    [sessionKey],
  );
  // 用户自己的 OpenAI 兼容接口配置（设置 › API 配置），聊天全部走该配置
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 机主名字（记忆提取视角统一用：碎片一律用真实名字指代用户；设置 › Apple 账户可改） */
  const profileName = useSettings((s) => s.profile.name);
  /** 机主头像（40-a：用户发起的解除拉黑申请卡头像用） */
  const profileAvatar = useSettings((s) => s.profile.avatar);
  /** 聊天设置页（顶栏摄像机图标进入）：翻译入口 + 回复条数入口 + 分句发送开关 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 主题界面（聊天设置 › 主题 进入）：顶部毛玻璃胶囊两个选择（主题/气泡） */
  const [themeOpen, setThemeOpen] = useState(false);
  /** 聊天气泡装扮配置（信息 App 独立槽位，与微信/QQ 隔离）：全部气泡（文本/语音/输入中指示器+尾巴）实时跟随 */
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  /* 第五十三轮（用户指定）：删除「新版」主题——信息 App 聊天页回归唯一默认主题 */
  /** 关系本地显示值（多账号关系感知）：保存后乐观更新（重进会话/切号后重读） */
  const [relationLocal, setRelationLocal] = useState<string | null>(null);
  /** 图片全屏预览（点图片气泡打开；自动生图/历史图片共用；点任意处关闭） */
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  // ---- 加号面板（相机/图片/文字图片）：待发送图片预览条 + 原生相机/相册隐藏入口 ----
  const [plusOpen, setPlusOpen] = useState(false);
  const [pendingImgs, setPendingImgs] = useState<Array<{ id: string; src: string }>>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // ---- 文字图片（Task 13 卡片版，无生图依赖：留空 = AI 按人设+聊天记录代笔）：弹层状态 ----
  const [cardOpen, setCardOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState('');
  // ---- 点击「文字图片」卡片弹出的操作面板（用图像生成生成图片/复制文字）：目标消息 id + 生成中标记 ----
  const [cardActionId, setCardActionId] = useState<string | null>(null);
  const [cardGenBusy, setCardGenBusy] = useState(false);
  // ---- 长按 AI 图片「重新生成图片」弹层：目标消息 id + 可编辑描述 + busy/错误（三端同款交互） ----
  const [regenImgId, setRegenImgId] = useState<string | null>(null);
  const [regenImgDesc, setRegenImgDesc] = useState('');
  const [regenImgBusy, setRegenImgBusy] = useState(false);
  const [regenImgError, setRegenImgError] = useState('');
  /** 翻译页（设置页「翻译」进入的独立二级页，按会话隔离） */
  const [translateOpen, setTranslateOpen] = useState(false);
  /** 回复条数选择页（设置页「回复条数」进入的独立二级页，按会话隔离） */
  const [replyCountOpen, setReplyCountOpen] = useState(false);
  /** 当前会话的回复条数（信息端每会话独立；未设置默认 5 条，与微信端同口径） */
  const [replyCountValue, setReplyCountValue] = useState(() => getReplyCount(sessionKey));
  // 切换会话时重读新会话的回复条数（与 transCfg/sentenceSend 既有会话级 state 同模式）
  useEffect(() => {
    setReplyCountValue(getReplyCount(sessionKey));
  }, [sessionKey]);
  /** 当前会话的翻译配置（开启后文字消息气泡下方显示所选语言的译文） */
  const [transCfg, setTransCfgState] = useState<ChatTranslateCfg>(() => getTranslateCfg(sessionKey));
  useEffect(() => {
    setTransCfgState(getTranslateCfg(sessionKey));
  }, [sessionKey]);
  /** 译文缓存（key = `${msgId}|${langCode}`）与失败标记（避免每帧重试） */
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [trFailed, setTrFailed] = useState<Record<string, boolean>>({});
  /** 分句发送开关（开启后连续发消息 AI 不回复，输入框为空再点一次发送才触发回复） */
  const [sentenceSend, setSentenceSendState] = useState(() => getSentenceSend(sessionKey));
  useEffect(() => {
    setSentenceSendState(getSentenceSend(sessionKey));
  }, [sessionKey]);
  /** 时间感知开关（本会话独立，发送时现场读取；见 @/lib/time-aware） */
  const [timeAware, setTimeAwareState] = useState(() => getTimeAware(sessionKey));
  useEffect(() => {
    setTimeAwareState(getTimeAware(sessionKey));
  }, [sessionKey]);
  // 动作描写开关（渲染订阅版）：设置页切换后经事件即时刷新，历史消息显示同步生效
  const actionDescOn = useActionDescOn(sessionKey);
  // 「回车键发送消息」开关（信息 App 级、按账号隔离；默认开启=回车发送，关闭=回车换行）
  const enterSend = useEnterSend('sms');
  /** 语音输入模式：输入框替换为「按住 说话」胶囊（右侧 Mic 钮切换，原装饰图标位置） */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用） */
  const [ttsSend, setTtsSend] = useState(false);
  /** 引用回复（输入框上方条；发送时挂到新消息上）——send 在下方引用，需先声明 */
  const [quote, setQuote] = useState<null | { name: string; content: string }>(null);
  /** 世界书挂载（仅联系人会话参与；AI 助手会话无人设不注入，见 @/lib/ios/worldbook） */
  const wbContactId = storageKey.startsWith('c:') ? storageKey.slice(2) : null;
  // 深度思考开关（渲染订阅版，IndexedDB 按联系人隔离；AI 助手会话无联系人恒为关）：关闭时思维链卡片
  // 整体丢弃不渲染（思考指令仍注入，AI 后台照常思考）
  const deepThinkOn = useDeepThinkOn(wbContactId ?? '');
  /** 深度思考本轮上下文（startAiTurn 开头重置）：firstMsgId = 本回合第一条 AI 文本消息 id（投递完回填思考用），
   *  text = 流层剥离 + buildReplyMsgs 兜底剥离合并的思考过程 */
  const turnThinkRef = useRef<{ firstMsgId: string | null; text: string }>({ firstMsgId: null, text: '' });
  /** 联系人 id（记忆库/拉黑/语音合成用；AI 助手会话为 null）——原在 startAiTurn 内定义，
   *  提升 bg 接线后与组件级 deliverAiMsg 共用 */
  const memContactId = storageKey.startsWith('c:') ? storageKey.slice(2) : null;
  /** 会话对方显示名（灵动岛通知标题 / 接力 Web Push 标题 / 拉黑系统行文案共用） */
  const peerLabel = peer.name ?? peer.title;
  /** AI 语音频率设置键：联系人会话与微信同键（wx:<联系人 id>），信息端的频率跟随微信 App 里的设置；
   *  AI 助手会话无微信对应会话，维持 sms: 会话独立 */
  const voiceFreqKey = wbContactId ? `wx:${wbContactId}` : sessionKey;
  /** 双向拉黑状态（仅联系人会话；小助手会话无角色 ID 不参与；kv 持久化按联系人隔离） */
  const [blk, setBlk] = useState<BlockEntry>(() => (wbContactId ? loadBlock('sms', wbContactId) : {}));
  // 40-b 跨 App 环境感知：会话打开即预热（其他三个 App 最近原始消息 + 共同群近况），
  // 每轮 AI 回合开头再异步刷新一次；回合内同步读最近一次构建结果（仅联系人会话；助手会话不参与）
  const crossCtxRef = useRef<{ crossAppBlock: string; groupBlock: string }>({ crossAppBlock: '', groupBlock: '' });
  useEffect(() => {
    if (!memContactId) return;
    let alive = true;
    buildCrossContextBlocks(memContactId, 'sms', profileName)
      .then((b) => {
        if (alive) crossCtxRef.current = b;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [memContactId, profileName]);
  // 46-g 视觉管理：AI peer 的相册清单（预加载，供 startAiTurn 注入 buildVisionRules 视觉自主决策规则；
  // 同时供 buildReplyMsgs 内 pick-album-avatar 同步预检 targetId 是否命中相册条目）。每轮 AI 回合开头
  // fire-and-forget 刷新一次（供下一轮使用）；信息端通常 albumSummary 为空 → buildVisionRules 只注入换头像规则
  const albumSummaryRef = useRef<{ id: string; desc: string }[] | null>(null);
  useEffect(() => {
    if (!memContactId) {
      albumSummaryRef.current = null;
      return;
    }
    let alive = true;
    void listAlbums(memContactId)
      .then((list) => {
        if (!alive) return;
        albumSummaryRef.current =
          list.length > 0
            ? list.slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
            : null;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [memContactId]);
  // 40-a：用户发起「解除拉黑申请」的展开面板与理由输入（仅被角色拉黑时显示；会话切换随组件重挂载复位）
  const [userReqOpen, setUserReqOpen] = useState(false);
  const [userReqText, setUserReqText] = useState('');
  const [wbOpen, setWbOpen] = useState(false);
  /** 主动发消息设置页（聊天设置二级页：定时/事件/自主/提醒四类触发，仅联系人会话） */
  const [proactiveOpen, setProactiveOpen] = useState(false);
  // 主动发消息角标守卫登记：用户正看着该会话时主动消息不涨角标（联系人会话才有角色，助手会话不参与）
  useEffect(() => {
    setActiveProactiveChat('sms', wbContactId);
    return () => {
      setActiveProactiveChat('sms', null);
    };
  }, [wbContactId]);
  // 46-g 视觉管理：头像本地覆盖（pick-album-avatar 落库后即时刷新顶栏头像；reset 入口已移除）
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  /** 顶栏头像（pick-album-avatar 落库后本地 override 优先；切会话随组件重挂载复位 → 自动回退 peer.avatarSrc） */
  const peerAvatarSrc = avatarOverride ?? peer.avatarSrc;
  const [wbBound, setWbBound] = useState<string[]>(() => (wbContactId ? getBoundBookIds(wbContactId) : []));
  useEffect(() => {
    setWbBound(wbContactId ? getBoundBookIds(wbContactId) : []);
  }, [wbContactId]);
  /** 「他的声音」页（聊天设置二级页，仅联系人会话）与 AI 语音频率页（其下的频率选择页，按会话独立） */
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceFreqOpen, setVoiceFreqOpen] = useState(false);
  /** 我的音色库（「他的声音」入口行摘要解析：音色 id → 展示名，见 @/lib/ios/my-voices） */
  const myVoicesForSummary = useMyVoices((s) => s.voices);
  /** 分句发送批次「待 AI 回复」标记（跨页面切换持久，见 @/lib/sentence-send） */
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sessionKey));
  useEffect(() => {
    setPendingDispatch(hasPendingBatch(sessionKey));
  }, [sessionKey]);
  const onMsgsChangeRef = useRef(onMsgsChange);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）
  useEffect(() => {
    onMsgsChangeRef.current = onMsgsChange;
  });

  // 消息回传父级（小助手会话列表预览）
  useEffect(() => {
    onMsgsChangeRef.current?.(msgs);
  }, [msgs]);

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(storageKey, msgs);
  }, [msgs, storageKey]);

  // 新消息/流式输出时自动滚到底部
  // 滚底签名守卫：仅结构性变化（条数/末条 id/流式内容）才滚底；
  // 转文字等原地更新（msgs 引用变但结构不变）不触发滚动，避免转写面板出现时气泡被拽上移
  // 性能+体验：仅当用户本就停在底部附近（距底 ≤160px）或首次进入时才跟随滚底，滚动放 rAF（同微信端注释）
  const scrollSigRef = useRef('');
  useEffect(() => {
    const sig = `${msgs.length}:${msgs[msgs.length - 1]?.id ?? ''}:${stream?.content ?? ''}`;
    if (sig === scrollSigRef.current) return;
    const first = scrollSigRef.current === '';
    scrollSigRef.current = sig;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (first || nearBottom) el.scrollTop = el.scrollHeight;
    });
  }, [msgs, stream]);

  // 翻译：开启后把文字消息（最近 60 条，排除错误/兑底文案）按检测到的语言双向翻译成另一侧
  // （左侧语言的消息译成右侧，右侧语言的消息译成左侧）。缓存、并发闸、在途去重都在
  // @/lib/chat-translate 内部，这里只负责把结果写入组件状态
  useEffect(() => {
    if (!transCfg.on) return;
    const targets = msgs
      .filter((m) => !m.error && m.content.trim() && !m.content.startsWith('（AI'))
      .slice(-60);
    if (targets.length === 0) return;
    let alive = true;
    for (const m of targets) {
      const code = detectTranslateTarget(m.content, transCfg.left, transCfg.right);
      const key = `${m.id}|${code}`;
      if (translations[key] !== undefined || trFailed[key]) continue;
      requestTranslation({ text: m.content, lang: code, apiConfig })
        .then((text) => {
          if (alive) setTranslations((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
        })
        .catch(() => {
          if (alive) setTrFailed((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
        });
    }
    return () => {
      alive = false;
    };
  }, [msgs, transCfg, translations, trFailed, apiConfig]);

  /** 气泡下方译文行（翻译开启时按消息语言显示对侧语言的译文，带语言名前缀） */
  const renderTranslations = (msgId: string, content: string, error?: boolean) => {
    if (error || !transCfg.on) return null;
    if (!content.trim() || content.startsWith('（AI')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="sms-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-muted-foreground"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑 */
  useLayoutEffect(() => {
    if (!stream || stream.status === 'streaming') return;
    void Promise.resolve().then(() => {
      setMsgs((prev) => {
        const saved = loadMsgs(storageKey);
        if (!saved || saved.length === 0) return prev;
        // 按 id 合并：本地消息优先，落盘新增的只会是 AI 回复
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...saved.filter((m) => !ids.has(m.id))];
      });
      clearChatStream(sessionKey);
    });
  }, [stream, sessionKey, storageKey]);

  /** 逐条投递 tick：AI 回复由 ai-delivery 调度器按真人节奏逐条落盘（模块层，与页面是否存活无关），
   *  每条到达后把落盘记录合并进本地 state；同 id 用落盘数据覆盖（语音升级以存储为权威）。
   *  #35：合并后按创建时间稳定排序——投递插入边界让落库时序正确，但 state 合并是新项尾部追加，
   *  排序把「插在边界前的旧回复」放回正确位置，显示与下一轮上下文都按真实对话时序 */
  useEffect(() => {
    return subscribeAiDelivery(sessionKey, () => {
      setMsgs((prev) => {
        const saved = loadMsgs(storageKey) ?? [];
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        return sortMsgsByTime([
          ...prev.map((m) => savedMap.get(m.id) ?? m),
          ...saved.filter((m) => !prev.some((p) => p.id === m.id)),
        ]);
      });
    });
  }, [sessionKey, storageKey]);

  /** 投递进行中（含排队批次）：流结束后仍维持「正在输入」打字指示，直到最后一条消息发出 */
  const [delivering, setDelivering] = useState(() => isAiDelivering(sessionKey));
  useEffect(() => {
    setDelivering(isAiDelivering(sessionKey));
    return subscribeAiDeliveryActive(() => setDelivering(isAiDelivering(sessionKey)));
  }, [sessionKey]);

  /** [语音通话] 标记本轮是否出现过（流中分段/最后一段/接力回复共用同一 ref）：startAiTurn 开回合时重置，
   *  buildReplyMsgs 解析到标记时置位——原来是回合内局部变量，buildReplyMsgs 提升到组件层后改用 ref 传递 */
  const wantCallSeenRef = useRef(false);

  /** 单条 AI 消息投递：落盘 + 灵动岛通知 + 语音频率判定/合成（ai-delivery 调度器模块层调用，与页面是否存活无关）。
   *  startAiTurn 的投递批次与退出网页接力的后台回复（bg-turn 拉取）共用同一套管线 */
  const deliverAiMsg = useCallback(
    (m: ChatMsg) => {
      // #35：有插入边界时（用户在上一轮投递中插话）插到边界用户消息之前，落库顺序即对话时序
      saveMsgs(storageKey, appendWithBoundary(sessionKey, loadMsgs(storageKey) ?? [], m));
      // 语音频率：每条文字消息独立判定（短路调用保持周期语义；命中 → 通知直接显示[语音]，未命中 → 常规文字预览）
      const voiceTurn =
        !m.error && !m.sys && !m.blkreq &&
        (m.kind === undefined || m.kind === 'text') &&
        m.content.trim().length > 0 &&
        // B6：TTS 清洗后为空的内容（纯 *动作描写* 行等）跳过判定（不白吃语音名额）
        cleanTextForTts(m.content).trim().length > 0 &&
        // C6：档位跟随微信设置（voiceFreqKey=wx:<id> 同键），计数器分键 sms:* 独立推进——
        // 此前与微信共享计数器，微信聊 2 条后来信息端第 1 条就出语音（节奏串扰未在文案披露）
        decideAiVoiceMessage(voiceFreqKey, `sms:${voiceFreqKey}`);
      const body = voiceTurn
        ? '[语音]'
        : notifyPreviewText({
            kind: m.kind,
            content: m.content,
            voiceText: m.voice?.transcript || m.voice?.localText || null,
          });
      if (body !== null) {
        pushChatNotification({
          sessionKey: `sms:${storageKey}`,
          app: 'chat',
          title: peerLabel,
          avatar: peerAvatarSrc ?? null,
          body,
          target: storageKey.startsWith('c:') ? { app: 'chat', contactId: storageKey.slice(2) } : { app: 'chat' },
        });
      }
      // 命中语音频率：异步合成，成功后就地升级为语音气泡（失败保持文字自动降级）
      if (voiceTurn) {
        const targetId = m.id;
        void synthesizeAiVoice(m.content, memContactId)
          .then((clip) => {
            if (!clip) {
              undoLastAiVoiceDecision(); // B6：合成失败回滚计数
              return; // 合成失败 → 保持文字
            }
            const voice: VoiceMsgData = {
              url: clip.url,
              duration: clip.duration,
              wave: clip.wave,
              localText: clip.localText,
              synth: clip.synth,
              contactId: memContactId ?? undefined,
            };
            const upgrade = (list: ChatMsg[]): ChatMsg[] =>
              list.map((x) => (x.id === targetId ? { ...x, content: '', kind: 'voice' as const, voice } : x));
            setMsgs(upgrade);
            saveMsgs(storageKey, upgrade(loadMsgs(storageKey) ?? []));
          })
          .catch(() => {});
      }
    },
    [memContactId, peer, peerLabel, peerAvatarSrc, storageKey, voiceFreqKey],
  );

  // ---- 生图（锁脸）：buildReplyMsgs 从回复文本剥出的 [照片:描述] 标签攒进队列，flushPhotoJobs 统一异步生成 ----
  /** 本轮待生成的照片任务（buildReplyMsgs 同步解析时入队；flushPhotoJobs 消费并清空） */
  const photoJobsRef = useRef<PhotoTag[]>([]);
  /** F1 流式分段 carry-over：流中分段把 [图片:描述] 标签切成两半时，尾部半截暂存于此，与下一段拼接后
   *  再走 buildReplyMsgs 解析（startAiTurn 开回合清空；finalize 收尾合并后丢弃仍未闭合的残留） */
  const photoCarryRef = useRef('');

  /**
   * 消费照片任务：配置完整时每条先生「正在拍照…」系统行，异步生成成功后落图片消息 + 存相册（origin 'ai'）+
   * 决策日志 + 记忆（30 分钟节流不刷屏）+ 刷新相册清单缓存（供下一轮视觉规则/选头像用）；
   * 未配置/生成失败自动降级为「文字图片」卡片（desc 即卡片文字，不影响聊天）。
   * 单次 flush 最多 2 张防刷屏；小助手会话（无角色身份）无锁脸直生成（与「我的卡片」转图同口径，
   * 相册/决策日志/记忆无挂点全部跳过），生成失败同样降级为卡片——不再静默丢弃
   * （旧规则已配置时标签被静默吞掉，用户什么都收不到，与未配置时的降级卡片不一致）。
   * deliver：投递函数（回合内 = startAiTurn 的 enqueueBatch；退出网页接力 = deliverBgItems 的 bgEnqueueBatch）
   */
  const flushPhotoJobs = useCallback(
    (deliver: (built: ChatMsg[]) => void) => {
      const jobs = photoJobsRef.current;
      photoJobsRef.current = [];
      // F3 照片任务持久化：快照消费即清（入队时已在 buildReplyMsgs 同步落快照，进程被杀后挂载补发）
      kvDel(`sms-photo-jobs:${storageKey}`);
      if (jobs.length === 0) return;
      // D 多标签溢出提示：单次 flush 最多生成 2 张（防刷屏），slice 丢弃的多余任务不再静默——补一条系统行告知
      const overflowNote: ChatMsg | null =
        jobs.length > 2
          ? { id: uid(), role: 'assistant', content: '', time: Date.now(), sys: { text: `还有 ${jobs.length - 2} 张图片没有生成出来` } }
          : null;
      const cid = wbContactId;
      const cfg = useSettings.getState().imgGenConfig;
      if (!cfg.enabled || !imgGenConfigReady(cfg)) {
        // 未配置生图：降级为「文字图片」卡片（无「正在拍照…」行，卡片即最终形态）
        for (const job of jobs.slice(0, 2)) {
          deliver([{ id: uid(), role: 'assistant', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } }]);
        }
        if (overflowNote) deliver([overflowNote]); // 降级卡片之后追加溢出提示
        return;
      }
      if (!cid) {
        // 小助手会话（无角色 id）：无锁脸直生成（contactId 空 = 纯描述图），失败同样降级卡片
        for (const job of jobs.slice(0, 2)) {
          void (async () => {
            try {
              const r = await generateCharacterPhoto({ cfg, contactId: '', desc: job.desc, charName: peerLabel, useRef: false });
              deliver([{ id: uid(), role: 'assistant', content: '', time: Date.now(), kind: 'image', img: { src: r.src, desc: job.desc } }]);
            } catch {
              deliver([{ id: uid(), role: 'assistant', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } }]);
            }
          })();
        }
        if (overflowNote) deliver([overflowNote]); // 溢出提示同理（直生成/降级之后追加）
        return;
      }
      const charName = peerLabel;
      for (const job of jobs.slice(0, 2)) {
        deliver([{ id: uid(), role: 'assistant', content: '', time: Date.now(), sys: { text: `「${charName}」正在拍照…` } }]);
        void (async () => {
          try {
            const r = await generateCharacterPhoto({ cfg, contactId: cid, desc: job.desc, charName, useRef: job.useRef });
            void addAlbum(cid, r.src, { desc: job.desc, origin: 'ai' });
            void addVisionDecision({ contactId: cid, app: 'sms', action: 'imggen', targetId: '', imgSrc: r.src, reason: job.desc });
            notePhotoMemory(cid, 'sms', job.desc);
            // 相册清单缓存刷新（组件级 albumSummaryRef）：下一轮 AI 视觉规则可见新图（选头像预检同步读该缓存）
            void listAlbums(cid)
              .then((list) => {
                albumSummaryRef.current =
                  list.length > 0
                    ? list.slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
                    : null;
              })
              .catch(() => {});
            deliver([{ id: uid(), role: 'assistant', content: '', time: Date.now(), kind: 'image', img: { src: r.src, desc: job.desc } }]);
          } catch {
            // 生成失败：降级为文字图片卡片（先落一行系统提示说明状态，不阻塞聊天）
            deliver([
              { id: uid(), role: 'assistant', content: '', time: Date.now(), sys: { text: '照片生成失败，已改为文字图片' } },
              { id: uid(), role: 'assistant', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } },
            ]);
          }
        })();
      }
      if (overflowNote) deliver([overflowNote]); // 「正在拍照…」行之外单独投一条溢出提示
    },
    [peerLabel, wbContactId, storageKey],
  );

  /** 40-a：把「用户发起的解除拉黑申请卡」置为终态（存储 + 本地 state 同步；无 pending 卡时空操作）。
   *  buildReplyMsgs 内部使用（角色决策/角色主动解除拉黑时调用）——声明须在其之前（TDZ） */
  const settleUserBlockReq = useCallback(
    (status: 'accepted' | 'rejected') => {
      if (!wbContactId) return;
      const saved = (loadMsgs(storageKey) ?? []).map((x) =>
        x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
      );
      saveMsgs(storageKey, saved);
      setMsgs((prev) =>
        prev.map((x) =>
          x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
        ),
      );
    },
    [storageKey, wbContactId],
  );

  /**
   * 把一段回复文本解析成待投递消息（startAiTurn 流中分段/finalize 与退出网页接力的后台回复共用同一套管线，不重不漏）：
   * 拉黑类动作标记就地应用（改状态 + 系统提示行/申请卡片）；asSingle=true（单条模式）时文字块
   * 再按「&&&」标记切分，false（多条模式）时一段就是一条消息（分段器已按边界切好，不再二次切分）。
   * idBase/idStart：本轮 AI 消息 id 序列（首条 = idBase，后续 = idBase-N；返回 nextIdx 供调用方续接，
   * 接力回复每次投递用全新 uid() 起一段新序列，与回合内序列互不冲突）
   */
  const buildReplyMsgs = useCallback(
    (rawText: string, asSingle: boolean, baseTime: number, idBase: string, idStart: number): { msgs: ChatMsg[]; nextIdx: number } => {
      // AI 主动打来电话（[语音通话] 标记，全半角括号变体都认）：从气泡文本里剥除，只作为来电信号
      // 40-a 拉黑拦截（#2，对齐微信/QQ 同类修复）：仅申请卡模式（byUser）时标记不进 wantCallSeen——
      // 正文在下方被整段丢弃，来电若照常弹出会绕过拉黑语义；bg-turn 接力投递共用本管线同守卫
      const wantCall = hasVoiceCallMark(rawText);
      if (wantCall && wbContactId && !loadBlock('sms', wbContactId).byUser) wantCallSeenRef.current = true;
      // 深度思考兜底剥离（bg 关页接力等绕过流总线的路径拿到整段原文时，[思考]块就地剥掉防泄漏进气泡；
      // 流式路径正文早已在 chat-stream-store 剥过，这里天然为 no-op）：思考内容累积到本轮上下文，投递完回填
      const tkParts = extractThinkBlocks(rawText);
      if (tkParts.thinking) {
        turnThinkRef.current.text = turnThinkRef.current.text ? `${turnThinkRef.current.text}\n${tkParts.thinking}` : tkParts.thinking;
      }
      const text = wantCall ? stripVoiceCallMark(tkParts.text) : tkParts.text;
      const out: ChatMsg[] = [];
      let t = baseTime;
      let msgIdx = idStart;
      for (const part of extractRichActionParts(text)) {
        if (part.type === 'action') {
          const bk = blockActionKindOf(part.action);
          if (bk && wbContactId) {
            const res = applyCharBlockAction('sms', wbContactId, bk, part.action.targetId);
            setBlk(res.entry);
            if (res.changed && bk === 'block') {
              out.push({ id: `${idBase}-sys-${msgIdx}`, role: 'assistant', content: '', time: t, sys: { text: `你已被「${peerLabel}」拉黑` } });
              t += 1;
              msgIdx += 1;
            } else if (res.changed && bk === 'unblock') {
              out.push({ id: `${idBase}-sys-${msgIdx}`, role: 'assistant', content: '', time: t, sys: { text: `「${peerLabel}」解除了对你的拉黑` } });
              t += 1;
              msgIdx += 1;
              // 40-a：角色主动解除拉黑 = 视同同意用户侧待处理申请（有的话置终态，避免卡片永远「等待对方处理」）
              settleUserBlockReq('accepted');
            } else if (res.reqCreated && bk === 'request') {
              out.push({ id: `${idBase}-blk-${msgIdx}`, role: 'assistant', content: '', time: t, blkreq: { reason: res.entry.reqReason ?? '', status: 'pending' } });
              t += 1;
              msgIdx += 1;
            }
          }
          // 40-a：角色对「用户发来的解除拉黑申请」的决策（[同意解除拉黑]/[拒绝解除拉黑]）
          const uk = userReqActionKindOf(part.action);
          if (uk && wbContactId) {
            const res = resolveUserReqByChar('sms', wbContactId, uk === 'approve');
            setBlk(res.entry);
            if (res.changed) {
              settleUserBlockReq(uk === 'approve' ? 'accepted' : 'rejected');
              out.push({
                id: `${idBase}-sys-${msgIdx}`,
                role: 'assistant',
                content: '',
                time: t,
                sys: { text: uk === 'approve' ? `「${peerLabel}」同意了你的解除拉黑申请` : `「${peerLabel}」拒绝了你的解除拉黑申请` },
              });
              t += 1;
              msgIdx += 1;
            }
          }
          // 40-a 拉黑拦截（#30，对齐微信 fix-wechat B 的收窄）：仅申请卡模式（byUser）下动作标记
          // 只放行拉黑类（bk/uk 已在上方处理）——视觉等其余标记一律丢弃不执行，
          // 否则拉黑期间 AI 仍能真实改头像/写视觉决策
          if (wbContactId && loadBlock('sms', wbContactId).byUser) continue;
          // 46-g 视觉自主决策动作（信息端无图片消息也无朋友圈）：
          // - change-avatar / change-moments-bg / save-to-album / pick-album-bg / pick-album-send：信息端静默丢弃
          //   （无图无朋友圈，extractRichActionParts 已解析但无分支处理则跳过到下方 continue）
          // - pick-album-avatar：信息端唯一支持的视觉动作（从 AI peer 相册选图设头像）；
          //   用预加载相册清单 albumSummaryRef 同步预检 targetId 命中后推 sys 行 + 异步落 updateContact + addVisionDecision
          if (part.action.kind === 'pick-album-avatar' && wbContactId) {
            if (!part.action.targetId) continue;
            const cached = albumSummaryRef.current;
            const hit = cached?.some((a) => a.id === part.action.targetId) ?? false;
            if (hit) {
              out.push({
                id: `${idBase}-sys-${msgIdx}`,
                role: 'assistant',
                content: '',
                time: t,
                sys: { text: `「${peerLabel}」从相册选了张图换头像` },
              });
              t += 1;
              msgIdx += 1;
              void (async () => {
                try {
                  const album = await getAlbum(part.action.targetId);
                  if (!album || album.contactId !== wbContactId) return;
                  // 头像按 App 隔离：只写信息槽位（联系人 App 的全局默认头像不受影响；updateContact 对 avatars 合并写入）
                  await updateContact(wbContactId, { avatars: { sms: album.src } });
                  setAvatarOverride(album.src); // #108 即时刷新顶栏头像（peerAvatarSrc 经 avatarOverride 优先取新图）
                  onContactChanged?.(wbContactId); // #108/#119 同步父级 contacts state + chatSession.peer.avatarSrc
                  void addVisionDecision({
                    contactId: wbContactId,
                    app: 'sms',
                    action: 'pick-album-avatar',
                    targetId: album.id,
                    imgSrc: album.src,
                  });
                } catch {
                  /* 持久化失败静默（视觉动作为增强能力） */
                }
              })();
            }
            continue;
          }
          continue; // 信息端无红包/转账动作
        }
        // 40-a：仅申请卡模式（用户拉黑了角色）——AI 的正文/表情一律丢弃，只有上面动作分支产出的
        // 申请卡片与系统行能落盘（入口守卫已保证：能走到这里的 byUser 回合必然处于可申请状态）
        if (wbContactId && loadBlock('sms', wbContactId).byUser) continue;
        // #42：下方 segs 清洗仅正常模式（byUser=false）执行——byUser continue 上面已拦；
        // 信息端表情包开关已移除 → 回复文字保留原文（不再剥 emoji）
        // 生图（锁脸）：先从文本剥出 [照片:描述] 标签（入队 photoJobsRef，flushPhotoJobs 异步生成投递）；
        // 生图关闭/配置不完整时标签同样剥除（残留在气泡里可读性更差，由 flushPhotoJobs 静默丢弃兜底）
        // 首尾清洗（与微信/QQ 同款）：剥掉首尾空白与零宽/盲文空格等「看不见的占位字符」——
        // 只含空白/不可见字符的段直接跳过，不生成空白气泡（动作描写被剥离后只剩空段时尤其必要）
        const segs = splitReplySegments(part.text, !asSingle)
          .map((seg) => {
            const { text: photoFreeText, tags: photoTags } = extractPhotoTags(seg);
            if (photoTags.length > 0) {
              photoJobsRef.current.push(...photoTags);
              // F3 照片任务快照持久化：入队即落盘，进程被杀后挂载时补发（flushPhotoJobs 消费时清快照）
              kvSet(`sms-photo-jobs:${storageKey}`, JSON.stringify(photoJobsRef.current));
            }
            return cleanBubbleText(photoFreeText);
          })
          .filter((seg) => seg.length > 0);
        for (const seg of segs) {
          out.push({
            id: msgIdx === 0 ? idBase : `${idBase}-${msgIdx}`,
            role: 'assistant',
            content: seg,
            time: t,
          });
          t += 600 + Math.floor(Math.random() * 600);
          msgIdx += 1;
        }
      }
      // 深度思考：记录本回合第一条 AI 文本消息 id（只记第一次——流中首个分段的产出即本轮第一条；
      // 卡片/系统行等非文本消息不承载思维链卡片，跳过）
      if (!turnThinkRef.current.firstMsgId) {
        const firstText = out.find((x) => x.role === 'assistant' && (!x.kind || x.kind === 'text') && !x.recalled);
        if (firstText) turnThinkRef.current.firstMsgId = firstText.id;
      }
      return { msgs: out, nextIdx: msgIdx };
    },
    [peerLabel, settleUserBlockReq, wbContactId, setAvatarOverride, onContactChanged, storageKey],
  );

  /** 语音链路（定义在 startAiTurn 之后）经 ref 调用最新一轮 startAiTurn：msgs 变化不重建 useCallback，
   *  转写完成后（异步）触发回复时拿到的才是含语音消息与转写的最新历史 */
  const startAiTurnRef = useRef<((userMsg: ChatMsg | null, sysEvent?: string, baseMsgs?: ChatMsg[]) => void) | null>(null);
  /** 文字转语音发送（定义在 send 之后）：send 在前引用 → 同 ref 模式 */
  const sendTextAsVoiceRef = useRef<(t: string) => void>(() => undefined);

  /** AI 回合：把整轮流式请求交给全局 store（userMsg 为 null = 分句发送批次触发/语音转写完成触发，消息早已入列）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容。
   *  baseMsgs：显式传入最新消息数组（语音转写完成后调用时避免闭包旧状态漏掉刚落库的语音消息） */
  const startAiTurn = (userMsg: ChatMsg | null, sysEvent?: string, baseMsgs?: ChatMsg[]) => {
    // F1：回合开始清空照片标签 carry（上一回合流中断/换号中止的残留不串入本回合）
    photoCarryRef.current = '';
    // fix3-D #8：用户消息先入列再判拉黑守卫（对齐微信 wechat.tsx send「先 setMsgs 再 runAiTurn」同口径）——
    // 拉黑期（byUser）用户消息照常进记录上屏、AI 不回（回合静默取消）。此前守卫在前会把文字消息一并吞掉
    // （send 与 sttPreview 两条文字路都把落库委托给本函数；语音路 commitVoiceMsg 已先入列不受累，
    // 此处入列的 userMsg 只来自这两条文字路，无双入列）。入列后经 msgs 持久化 effect 自动落盘。
    // 红色 ! 徽标重试（retryReply）也会带已入列的消息进来：按 id 判重，不重复入列（对齐微信/QQ 同款守卫）
    if (userMsg) setMsgs((prev) => (prev.some((m) => m.id === userMsg.id) ? prev : [...prev, userMsg]));
    // 深度思考：重置本轮上下文（重试/新回合互不串台；firstMsgId 由 buildReplyMsgs 首次产出时记录）
    turnThinkRef.current = { firstMsgId: null, text: '' };
    // 40-a 拉黑拦截（第一层）：用户拉黑角色（byUser）后，本 App 内 AI 不能发任何消息——回合静默取消。
    // 唯一例外=「解除拉黑申请卡片」仍可发起（charRequestOnlyOf 放行模式：回合照常请求，但回复中
    // 除申请卡片/系统行外的正文由 buildReplyMsgs 丢弃）；申请同意后的回应回合因 byUser 已清自然放行。
    // 小助手会话（wbContactId 为空）不参与拉黑；群聊不用本组件（wx-group/qq-group 自有管线）。
    const blkEntry = wbContactId ? loadBlock('sms', wbContactId) : null;
    if (blkEntry?.byUser && !charRequestOnlyOf(blkEntry)) return;
    // 40-b：跨 App/群聊近况刷新（fire-and-forget，供下一轮使用；本轮用预热缓存；仅联系人会话）
    if (memContactId) {
      void buildCrossContextBlocks(memContactId, 'sms', profileName)
        .then((b) => {
          crossCtxRef.current = b;
        })
        .catch(() => {});
      // 46-g 视觉管理：同步刷新 AI peer 相册清单（fire-and-forget，供下一轮 buildVisionRules 用）
      void listAlbums(memContactId)
        .then((list) => {
          albumSummaryRef.current =
            list.length > 0
              ? list.slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
              : null;
        })
        .catch(() => {});
    }
    // 40-a：本轮是否处于「仅申请卡」放行模式（byUser 命中且守卫放行）——finalize 不落兑底占位
    const requestOnly = blkEntry?.byUser === true;
    // #35 上下文补投递尾巴（群聊 #22 已修，单聊同款）：上一轮的回复还在打字节奏投递队列里（未落盘）时，
    // 只读 msgs state 会漏看——AI 看不到自己刚说的话，把旧话题再答一遍（自言自语/像没读到用户最新消息）。
    // 队列尾巴按序拼进 base（时序上属于上一轮，排在最新用户消息之前）；同一消息要么已落盘/进 state、
    // 要么还在队列里（deliveredIndex 逐条同步推进），不会重复。
    const pendingTail = peekPendingMsgs<ChatMsg>(sessionKey);
    const base = [...(baseMsgs ?? msgs), ...pendingTail, ...(userMsg ? [userMsg] : [])];
    // 识图输入（加号发图/文字随图）：从末尾向前收集连续「我」（user）消息里的图片（最多 3 张），
    // 遇到对方/AI 消息即停。识图模型配置存在时，chat-stream-store 先把图片转描述再交给聊天模型，
    // 并经 onVision 把描述写回对应图片消息（img.desc 持久化，之后的聊天历史 AI 都能读到图片内容）
    const turnImages: string[] = [];
    const turnImageMsgIds: string[] = [];
    for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
      const m = base[i];
      if (m.role !== 'user') break;
      if (m.kind === 'image' && m.img?.src) {
        turnImages.unshift(m.img.src);
        turnImageMsgIds.unshift(m.id);
      }
    }
    // 上下文：只带有效消息最近 20 条（已撤回的消息不再进入上下文；引用消息带引用前缀让 AI 感知；
    // 语音消息 content 为空 → 按 kind 白名单放行，AI 直接读转写文本，未识别时用占位；
    // 图片消息 content 为空 → 同样放行，AI 读「[图片]（图片内容：…）」占位，知道自己/对方发过什么照片；
    // 文字图片卡片 → 以「[文字图片]（卡片上写着：…）」进入历史，AI 知道发过什么卡片）。
    // #35：按创建时间稳定排序还原对话时序（旧气泡倒挂的历史数据），保证上下文顺序正确
    const history = base
      .filter(
        (m) =>
          !m.error &&
          !m.recalled &&
          (m.content || m.kind === 'voice' || (m.kind === 'image' && m.img) || (m.kind === 'textcard' && m.card))
      )
      .sort((a, b) => a.time - b.time)
      .slice(-20)
      .map((m) => ({
        role: m.role,
        // 深度思考：AI 自己的历史回复带思考过程时还原 [思考]…[/思考] 前缀——模型看到自己一直按此格式
        // 输出（in-context 自我一致），新回复的思考块遵循度大幅提升；标签展示前已被流层剥离，不进任何气泡
        content: `${m.role === 'assistant' && m.thinking ? `[思考]${m.thinking}[/思考]\n` : ''}${
          m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : ''
        }${
          m.kind === 'voice'
            ? m.voice?.transcript || m.voice?.localText || '[语音]'
            : m.kind === 'image'
              ? m.img?.desc
                ? `[图片]（图片内容：${m.img.desc}）`
                : '[图片]'
              : m.kind === 'textcard' && m.card
                ? `[文字图片]（卡片上写着：${m.card.text}）`
                : m.content
        }`,
      }));

    const aiId = uid();
    // 用户消息已在函数入口入列（fix3-D #8：先于拉黑守卫，拉黑期照常落库上屏）——AI 回复交给全局
    // store 流式接收（退出聊天页不中断），结束/失败后由 finalize 写入本会话聊天记录，此处不重复入列

    // 联系人聊天：人设作为 system 消息插在上下文最前（/api/chat 支持 system 透传）
    // 回复条数：信息端每会话独立设置（信息聊天设置页 → 回复条数，读写 sms:c:<id> 键），
    // 未设置默认 5 条（与微信端同口径）；AI 助手会话（无 systemPrompt 人设）恒 1 条不变。
    const replyCount = systemPrompt ? getReplyCount(sessionKey) : 1;
    // 记忆库：联系人会话召回记忆（memContactId 为组件级常量：storageKey 形如 c:<contactId>；AI 助手会话无联系人 → 不注入）
    const memoryBlock = memContactId
      ? memChatRecallBlock(
          memContactId,
          'sms',
          [userMsg?.content ?? '', ...base.slice(-6).map((m) => (m.kind === 'voice' ? m.voice?.transcript || '' : m.kind === 'textcard' ? m.card?.text || '' : m.content))]
            .filter(Boolean)
            .join(' '),
          {
            // 小号披露门控（用户最新规则）：仅用户侧发言参与检测——默认纯陌生人，亮明身份才解锁大号记忆
            disclosureText: [userMsg?.content ?? '', ...base.slice(-6).filter((m) => m.role === 'user').map((m) => (m.kind === 'voice' ? m.voice?.transcript || '' : m.kind === 'textcard' ? m.card?.text || '' : m.content))].filter(Boolean).join(' '),
            altMainName: cachedOwnerName(),
            altMainRelation: activeContactRelation,
          }
        )
      : '';
    // 画像图谱注入（Task 14-b B1）：用户画像事实层（喜好/忌讳/习惯/身份/重要日子），与记忆召回块并列注入——
    // 让 TA 在聊天中自然引用用户习惯（「你不是不吃香菜嘛」）；无画像事实时为空串，join 后零成本
    const profileBlock = memContactId ? profileRecallBlock(memContactId) : '';
    // 社交动态感知（四）：互通开关打开时把朋友圈/QQ动态注入 system（信息 App 无自有平台，
    // 关闭时不注入——动态属于社交平台，不属于短信）；用户广播动态首次被看到时懒写入该角色记忆
    const momentsBlock = memContactId
      ? buildMomentsChatBlock({
          contactId: memContactId,
          app: 'sms',
          userName: profileName,
          peer: { id: memContactId, name: peer.name ?? peer.title, nickname: null },
        })
      : '';
    // v33【AI 真人社交】：X论坛近况感知（TA 发的帖/我发的帖/评论互动）——AI 私聊时能自然提起论坛的事
    const forumBlock = memContactId ? buildForumChatBlock(memContactId) : '';
    // 时间感知（本会话独立开关，发送时现场读取；关闭时不注入任何时间信息，恢复普通聊天）：
    // 上次聊天间隔 = 该会话上一条消息时间戳（不含本轮刚发的消息）与当前时间的差值；
    // AI 助手会话（无人设）也注入时间块，让「现在几点」这类问题能答准
    const timeBlock = getTimeAware(sessionKey)
      ? buildTimeAwareBlock({ lastMsgTime: msgs.length > 0 ? msgs[msgs.length - 1].time : null })
      : '';
    // 世界书：仅联系人会话参与（AI 助手会话无联系人角色）；命中触发词条目按插入位置注入
    //（每本书独立包裹成【世界设定开始】/【世界设定结束】块；有内容时 system 末尾附带使用规则）
    const wbBlocks = wbContactId
      ? collectWbBlocks(wbContactId, wbScanText([userMsg?.content, ...base.slice(-8).map((m) => (m.kind === 'voice' ? m.voice?.transcript || '' : m.kind === 'textcard' ? m.card?.text || '' : m.content))]))
      : null;
    const charBlock =
      wbBlocks && systemPrompt
        ? [wbBlocks.beforeChar, systemPrompt, wbBlocks.afterChar].filter(Boolean).join('\n\n')
        : systemPrompt ?? '';
    // 动作描写开关：发送时现场读取（与上方 getTimeAware 现场读取同款），开启下发格式约定、关闭下发禁令
    const actionDescOn = getActionDescOn(sessionKey);
    // 发图片能力常开：注入照片标签规则（配置完整时发真图；未配置/生成失败自动降级为文字图片卡片，
    // AI 无需关心）；仅联系人会话注入（小助手无角色身份）且非申请卡模式（正文会被整段丢弃，不诱导输出标签）
    const photoRule = Boolean(wbContactId) && !requestOnly ? buildPhotoTagRule(peer.name ?? peer.title) : '';
    const baseSys = [
      ...(wbBlocks ? [wbBlocks.beforeSystem] : []),
      charBlock,
      memoryBlock,
      // 第十六轮：AI 动态状态（情绪+作息）——AI 带着当前心情说话、按 TA 记住的作息规律拿捏分寸
      //（仅联系人会话；AI 助手无角色身份不注入）
      ...(memContactId ? [buildDynamicStateBlocks(memContactId)] : []),
      // 画像图谱（Task 14-b B1）：用户画像事实层，紧随记忆召回块并列注入
      profileBlock,
      // 40-b 跨 App 环境感知：当前 App 记忆 → 其他 App 最近 10 条 → 群聊最近 10 条（长期/核心在 memoryBlock 内）
      crossCtxRef.current.crossAppBlock,
      crossCtxRef.current.groupBlock,
      momentsBlock,
      // v33【AI 真人社交】：论坛近况（紧随动态感知块；空串时零成本）
      forumBlock,
      // 双向拉黑感知：当前会话的拉黑关系注入 system（无拉黑状态时为空串；40-a 重构后拉黑会拦截本 App 内的消息发送）
      wbContactId ? buildBlockPromptBlock('sms', wbContactId, profileName) : '',
      // 语音占位防编造：最近消息里有听不到内容的语音时注入，AI 不假装听过、不编造内容；
      // fix3-c #6：占位规则按发送者区分文案（MediaRuleMsg 新增 role?: 'me'|'peer' 契约）——
      // 信息端消息角色是 user/assistant，映射为 me/peer 后传入（契约合并前多出的 role 属性不参与匹配，合并后即生效）
      buildVoicePlaceholderRule(
        msgs.map((m) => ({ ...m, role: m.role === 'user' ? ('me' as const) : ('peer' as const) })),
      ),
      // 语音通话能力（仅联系人会话）：AI 想马上说话时可在回复开头加 [语音通话] 给机主打一次电话
      wbContactId
        ? '【语音通话能力】如果你此刻非常想和对方马上说话（想TA了、有急事、聊到特别开心等自然原因），可以在回复的最开头单独加上标记 [语音通话] 打一次电话给对方，对方手机会弹出你的来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。'
        : '',
      timeBlock,
      // 动作描写：开启下发 *...* 格式约定（灰色小字居中显示），关闭下发显式禁令（渲染层另有硬剥离兜底）
      actionDescOn ? ACTION_DESC_RULE : ACTION_DESC_OFF_RULE,
      // 46-g 视觉自主决策规则（仅联系人会话；信息端无图无朋友圈，albumSummary 通常为空 → 只注入换头像规则；
      // 相册非空时额外注入【选图操作】+【相册清单】，让 AI 可用 [选图设头像:alb-xxx] 从相册挑图换头像）
      // #111 信息端仅支持 pick-album-avatar：通用 buildVisionRules 列了 3 个 pick-album-* 动作，但 chat.tsx
      // 只接 pick-album-avatar；另两个标记会被 buildReplyMsgs 静默吞掉无反馈。这里在规则末尾追加一条
      // 信息端限制，明确禁止 [选图设背景]/[选图发送]，避免 AI 反复尝试生成不支持的标记
      // #30 仅申请卡模式（requestOnly）不注入视觉规则（对照微信 actionRules 处理）：正文已被拦截，
      // 提示词层面也不该诱导 AI 输出会被整段丢弃的视觉标记
      ...(wbContactId && !requestOnly
        ? [
            ...buildVisionRules(albumSummaryRef.current),
            '【信息端限制】当前会话只支持 [选图设头像:相册条目ID]，[选图设背景] 与 [选图发送] 在信息端不可用，请不要使用这两个标记。',
          ]
        : []),
      // 生图（锁脸）：照片标签规则（自动生图开启时；AI 输出 [照片:描述]，系统剥标签自动生图并以图片消息投递）
      ...(photoRule ? [photoRule] : []),
      ...(wbBlocks ? [wbBlocks.afterSystem, wbRulesBlock(wbBlocks)] : []),
    ]
      .filter(Boolean)
      .join('\n\n');
    // 深度思考指令（无论开关开还是关都注入，开关只控制前端是否展示思维链卡片）；
    // 拼在 system 真正的最末尾（条数指令之后）：最新指令最受模型关注，短回复场景也不跳过思考块
    const sysContent = baseSys
      ? replyCount > 1
        ? `${baseSys}\n\n${buildReplyCountPrompt(replyCount)}\n\n${DEEP_THINK_RULE}`
        : `${baseSys}\n\n${DEEP_THINK_RULE}`
      : null;
    const payload: ChatPayloadMessage[] = applyWbUserBlocks(
      sysContent ? [{ role: 'system' as const, content: sysContent }, ...history] : history,
      wbBlocks ?? WB_EMPTY_BLOCKS,
    );
    if (sysEvent) payload.push({ role: 'user', content: sysEvent });
    // ---- 边接收边逐条投递（分段流式核心）----
    // 流中每凑齐一条完整消息（分段器回调 onSegment）立刻排队投递上屏；
    // 流结束后 finalize 只处理剩余的最后一条（N 条上限的第 N 条）——
    // 不再有「先全文显示、消失、再逐条重放」的流式气泡，流式与分条也不改同一块展示状态。
    let deliveredAny = false; // 本轮是否已有分段消息排队投递（决定兜底文案）
    let batchStarted = false; // 是否已排过批（首批立即上屏，后续批按打字节奏先停顿）
    let msgIdx = 0; // 本轮已构建消息数（延续 aiMsgId 与 -N 后缀的 id 序列）
    // [语音通话] 标记本轮是否出现过（组件级 ref，开回合时重置；buildReplyMsgs 解析到标记时置位）
    wantCallSeenRef.current = false;

    /** 排队投递一批：首批立即上屏（边接收边显示），后续批先按打字节奏停顿（逐条冒出来） */
    const enqueueBatch = (built: ChatMsg[]) => {
      if (built.length === 0) return;
      void scheduleAiDelivery<ChatMsg>(
        sessionKey,
        built,
        deliverAiMsg,
        {
          initialDelay: batchStarted ? typingDelayOf(built[0].content ?? '') : 0,
          delay: (i) => (i + 1 < built.length ? typingDelayOf(built[i + 1].content ?? '') : 0),
        },
      );
      batchStarted = true;
    };

    /** 流中分段投递：分段器每凑齐一条完整消息回调一次，立刻排队上屏（边接收边逐条显示） */
    const deliverSegment = (seg: string) => {
      // F1 流式分段 carry-over：上一段尾部未闭合的照片标签起始先拼回本段再解析（跨段标签在此闭合还原）；
      // 本段尾部仍未闭合的部分继续 carry 给下一段（分段器只防半角 [ 被切碎，全角【图片：…】仍可能被
      // 句末标点/流结束切开）。send 为空 = 本段整体是未闭合标签起始，跳过本轮投递等下一段拼接
      const merged = photoCarryRef.current + seg;
      const { send, carry } = splitUnfinishedPhotoTag(merged);
      photoCarryRef.current = carry;
      if (!send) return;
      const { msgs: built, nextIdx } = buildReplyMsgs(send, false, Date.now(), aiId, msgIdx);
      msgIdx = nextIdx;
      if (built.length === 0) return;
      deliveredAny = true;
      enqueueBatch(built);
      flushPhotoJobs(enqueueBatch); // 生图（锁脸）：流中分段剥出的照片标签统一异步生成投递
    };

    const started = beginChatStream({
      sessionKey,
      aiMsgId: aiId,
      messages: payload,
      apiConfig,
      replyCount,
      ...(turnImages.length > 0
        ? {
            vision: { images: turnImages, text: '' },
            // 识图描述按「图N：」行拆分后逐张回写（img.desc 持久化）：与微信端同款管线
            onVision: (desc: string) => {
              const parts = splitVisionDesc(desc, turnImageMsgIds.length);
              turnImageMsgIds.forEach((targetId, i) => {
                const part = parts[i]?.trim();
                if (!part) return;
                setMsgs((prev) =>
                  prev.map((x) => (x.id === targetId && x.img ? { ...x, img: { ...x.img, desc: part } } : x)),
                );
              });
            },
          }
        : {}),
      // 边接收边逐条显示：分段器每凑齐一条完整消息立刻排队投递（多条模式）
      onSegment: deliverSegment,
      finalize: ({ content, error, tail, thinking }) => {
        // 深度思考：合并流层收集的思考过程（buildReplyMsgs 兜底剥离的已累积在 ref 里，流层的在此并入）
        if (thinking && thinking.trim()) {
          const prevTk = turnThinkRef.current.text;
          turnThinkRef.current.text = prevTk ? `${prevTk}\n${thinking.trim()}` : thinking.trim();
        }
        // F1 流收尾：残留 carry 与收尾文本（多条 = 分段器剩余 tail；单条 = 完整 content）合并后再解析，
        // 跨段/收尾边界切开的照片标签在此闭合还原；流已结束，合并后尾部仍未闭合的标签起始直接丢弃
        //（不投递残留文本，防半截标签上屏），carry 清空不影响下一回合（流错误中断同样在此清空）
        const endMerged = photoCarryRef.current + (replyCount > 1 ? tail : content);
        photoCarryRef.current = '';
        const endText = splitUnfinishedPhotoTag(endMerged).send;
        // 失败标记触发的我的消息（userMsg 为 null 时取 base 里最后一条我的消息）：
        // 新版失败不再落错误占位消息——在本条消息气泡前打红色 ! 徽标（点击重试），成功后在下方清除
        const failTargetId = userMsg?.id ?? [...base].reverse().find((m) => m.role === 'user' && !m.recalled)?.id ?? null;
        /** 落库 + 同步 state：给触发消息打/清 replyFail 标记（红色 ! 徽标）；
         *  Task 40 错误提示优化：失败时同步写入分类文案 failReason（居中灰字提示行用），清除时一并抹掉 */
        const setReplyFail = (fail: boolean, reason?: string) => {
          if (!failTargetId) return;
          const cur = loadMsgs(storageKey) ?? [];
          if (!cur.some((m) => m.id === failTargetId)) return;
          const patch = (m: ChatMsg): ChatMsg => {
            if (m.id !== failTargetId) return m;
            // 标记与文案都无变化时跳过（防无意义的全量落库）；成功清除（fail=false）连 failReason 一起抹掉
            if (Boolean(m.replyFail) === fail && (!fail || m.failReason === reason)) return m;
            return { ...m, replyFail: fail || undefined, failReason: fail ? reason : undefined };
          };
          const changed = cur.map(patch);
          saveMsgs(storageKey, changed);
          setMsgs((prev) => prev.map(patch));
        };
        if (error) {
          // Task 40 错误提示优化：先记失败计数（同会话连续失败 2 次起重试进入冷却）；
          // 原始报错仅存内存供「复制错误详情」，界面只显示分类后的友好文案
          recordChatFail(sessionKey, error);
          // A-3：流中已投递出分段时不再打失败徽标——分段已作为真实回复逐条上屏（本轮并非无回应）；
          // 投递队列无取消路径，已排队分段必然逐条落盘，此刻静默收尾即可（冷却计数仍生效，见上）。
          // 仍未投递出任何分段（完全无回应）→ 触发消息打 replyFail 红色 ! 徽标 + 分类文案，不再落错误占位文案
          if (deliveredAny) return;
          setReplyFail(true, classifyChatError(error).text);
          return;
        }
        // 多条模式：流中分段已通过 onSegment 逐条排队投递上屏（边接收边逐条显示），
        // 这里只处理剩余的最后一条（N 条上限的第 N 条）；单条模式：整条回复在此按旧管线落盘
        const { msgs: built } = buildReplyMsgs(endText, replyCount <= 1, Date.now(), aiId, msgIdx);
        // 剩余为空且流中也没有任何分段/动作产出时不算有效回复 → 触发消息打红色 ! 徽标（不再落兜底占位文案）；
        // requestOnly（拉黑放行模式）正文已被丢弃，静默收尾不打标
        const finalBatch: ChatMsg[] =
          built.length > 0
            ? built
            : deliveredAny
              ? []
              : requestOnly
                ? []
                // Task 40 错误提示优化：空回复/解析失败按解析类文案打标 + 记失败计数
                : (setReplyFail(true, CHAT_PARSE_FAIL_TEXT), recordChatFail(sessionKey, '空回复'), []);
        // 有任何产出（分段投递/本轮落盘消息）：清除触发消息上的失败徽标（重试成功场景）
        if (built.length > 0 || deliveredAny) {
          setReplyFail(false);
          // Task 40：成功即清零失败计数与冷却（重试成功/正常回复场景）
          recordChatSuccess(sessionKey);
        }
        // 排队投递（模拟真人连发）：每条到达时才落盘 + 弹灵动岛通知 + 判定语音频率，停顿按内容长度
        // 模拟打字节奏；空批仅作占位，记忆库等「一轮结束」动作挂在全部消息投递完之后；
        // 调度器在模块层运行，与聊天页是否存活无关（退出页面后继续接收/投递）
        flushPhotoJobs(enqueueBatch); // 生图（锁脸）：finalize 剩余段剥出的照片标签统一异步生成投递
        void scheduleAiDelivery<ChatMsg>(
          sessionKey,
          finalBatch,
          deliverAiMsg,
          {
            initialDelay: finalBatch.length > 0 ? (batchStarted ? typingDelayOf(finalBatch[0].content ?? '') : 0) : 0,
            delay: (i) => (i + 1 < finalBatch.length ? typingDelayOf(finalBatch[i + 1].content ?? '') : 0),
          },
        ).then(() => {
          // 深度思考回填：本轮全部消息投递完落库后，把思考过程写到本回合第一条 AI 文本消息的
          // thinking 字段（深度思考开关关闭时渲染层不显示，字段照存——重开开关即可回看）
          const tkCtx = turnThinkRef.current;
          const thinkText = tkCtx.text.trim();
          if (thinkText && tkCtx.firstMsgId) {
            const targetId = tkCtx.firstMsgId;
            const cur = loadMsgs(storageKey) ?? [];
            if (cur.some((x) => x.id === targetId)) {
              saveMsgs(storageKey, cur.map((x) => (x.id === targetId ? { ...x, thinking: thinkText } : x)));
              setMsgs((prev) => prev.map((x) => (x.id === targetId ? { ...x, thinking: thinkText } : x)));
            }
          }
          // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片（全部消息投递完后执行；AI 助手会话不参与；
          // 后台异步，失败静默）。names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人
          // name，均非昵称——展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用
          if (memContactId) {
            void Promise.all([ownerRealName(), contactRealName(memContactId)]).then(([owner, peerReal]) =>
              memAfterAiTurn(
                memContactId,
                'sms',
                apiConfig,
                () => memConvoFromRaw(loadMsgs(storageKey) ?? [], ''),
                () => loadMsgs(storageKey) ?? [],
                { user: owner || profileName, peer: peerReal || (peer.name ?? peer.title) }
              )
            );
          }
          // AI 主动打来电话（标记可能出现在流中任一分段）：剥除后按 5 分钟冷却弹出来电——
          // 全局胶囊弹窗 + iOS 全屏来电界面（PhoneShell › IncomingCallLayer），任何界面都会被覆盖。
          // 拉黑破口修复（#2，对齐 qq.tsx 同款）：仅申请卡模式（requestOnly）不弹真实来电；
          // 触发时现场重读拉黑状态防回合内变更（收集点守卫只挡回合开始时的状态）
          if (wantCallSeenRef.current && memContactId && !requestOnly && !loadBlock('sms', memContactId).byUser) {
            void (async () => {
              try {
                const lastCallAt = Number(window.localStorage.getItem(`sms-vc-last:${memContactId}`) ?? '0');
                if (Number.isFinite(lastCallAt) && Date.now() - lastCallAt > 5 * 60 * 1000) {
                  window.localStorage.setItem(`sms-vc-last:${memContactId}`, String(Date.now()));
                  // 头像按 App 投影：信息端发起的来电读 sms 槽位（无槽位回退全局默认头像）
                  const contact = (await listContactsFor('sms')).find((c) => c.id === memContactId) ?? null;
                  // B-9：联系人无手机号（null/空串）时用 id 派生的稳定占位号，来电界面与
                  // 通话记录/留言不出现空串（电话 App 联系人列表同场景显示「无号码」）
                  const number = contact?.phone || derivePlaceholderNumber(contact?.id ?? 'sms-ai');
                  const name = contact?.name ?? peerLabel;
                  window.setTimeout(() => {
                    // B-2：幂等防御（对齐 qq.tsx/wechat.tsx 既有双查口径）——上一通来电还在响铃
                    // （useIncomingCall.call）、微信/QQ 全局通话进行中（useGlobalCall.session）或
                    // 电话 App 通话中（useUI.callActive，#8）时整跳取消本次来电：triggerIncomingCall
                    // 只互斥来电弹窗不查已有通话，放行会出现电话 CallScreen 与 wx/qq 通话引擎同时
                    // 存活的双麦克风双 TTS 僵尸会话。
                    // 跳过时回复文本里的〔语音通话〕标记已剥除，与 qq/wechat 现行同场景行为一致
                    if (useUI.getState().callActive) return;
                    if (useIncomingCall.getState().call) return;
                    if (useGlobalCall.getState().session) return;
                    triggerIncomingCall({
                      source: 'phone',
                      name,
                      avatar: contact?.avatar ?? null,
                      number,
                      contact,
                      bannerStage: 'pill',
                      // 接听：打开电话 App，由其消费 pending 进「来电方向」的通话界面（AI 先开口）；
                      // 用 switchToApp（跨 App 强制切换）——当前正在任何 App 里都要跳转到来电通话
                      onAnswer: () => {
                        setPendingPhoneAnswer({ contact, number, name });
                        useUI.getState().switchToApp('phone');
                      },
                      // 拒绝 / 响铃 25 秒超时：落未接记录 + AI 语音留言
                      onMissed: (reason) => {
                        void recordMissedPhoneCall(contact, number, name, reason);
                      },
                    });
                  }, 1200);
                }
              } catch {
                // localStorage 异常忽略
              }
            })();
          }
        });
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started) {
      if (userMsg) setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
    }
  };
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）；无依赖数组 = 每次渲染后同步最新闭包
  useEffect(() => {
    startAiTurnRef.current = startAiTurn;
  });

  /** 红色 ! 徽标重试：AI 回复失败的消息点击后重发同一回合（流/投递占用时静默，徽标保留可再点；
   *  消息本体已在 state 与存储里，startAiTurn 入列按既有逻辑去重；成功在 finalize 清除标记）。
   *  Task 40 错误提示优化：入口加连续失败冷却拦截——重试动作受冷却约束（发新消息不受影响），拦截时 toast 提示剩余秒数 */
  const retryReply = (m: ChatMsg) => {
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
    const cd = cooldownRemainText(sessionKey);
    if (cd) {
      showToast(cd);
      return;
    }
    startAiTurnRef.current?.(m);
  };

  // ---------------- 退出网页接力（bg-turn）：服务端代跑的回复拉取 + 原管线投递 ----------------

  /** 排队投递一批接力回复（首条立即上屏，后续按打字节奏）——与 startAiTurn 的 enqueueBatch
   *  首批（batchStarted=false）完全同参数口径 */
  const bgEnqueueBatch = useCallback(
    (built: ChatMsg[]) => {
      if (built.length === 0) return;
      void scheduleAiDelivery<ChatMsg>(
        sessionKey,
        built,
        deliverAiMsg,
        {
          initialDelay: 0,
          delay: (i) => (i + 1 < built.length ? typingDelayOf(built[i + 1].content ?? '') : 0),
        },
      );
    },
    [deliverAiMsg, sessionKey],
  );

  /** 接力回复投递：与 finalize 完全同管线（buildReplyMsgs 解析 → 排队投递）。
   *  single=true：texts[0] 是一次完整回复原文（可能含 &&& 分段与动作标记）→ 单条模式；
   *  single=false：每项就是一条独立消息文本 → 多条模式逐条投递 */
  const deliverBgItems = useCallback(
    (items: BgPendingItem[]) => {
      // 接力 generate 存的是完整回复原文：按该会话自己的回复条数决定解析模式（与 finalize 同语义；
      // AI 助手会话运行时恒为单条（无人设不给条数指令），接力投递同口径不切句）
      const bgAsSingle = sessionKey === 'sms:assistant' || getReplyCount(sessionKey) <= 1;
      for (const item of items) {
        if (item.single) {
          // F1 兜底：接力文本非流式分段，但服务端截断可能留下尾部未闭合的照片标签起始——剥除防上屏
          bgEnqueueBatch(buildReplyMsgs(stripUnfinishedPhotoTag(item.texts.join('')), bgAsSingle, Date.now(), uid(), 0).msgs);
          flushPhotoJobs(bgEnqueueBatch); // 生图（锁脸）：接力回复里的照片标签同样异步生成投递
        } else {
          for (const t of item.texts) {
            bgEnqueueBatch(buildReplyMsgs(stripUnfinishedPhotoTag(t), false, Date.now(), uid(), 0).msgs);
            flushPhotoJobs(bgEnqueueBatch); // 生图（锁脸）：接力回复里的照片标签同样异步生成投递
          }
        }
      }
    },
    [bgEnqueueBatch, buildReplyMsgs, flushPhotoJobs, sessionKey],
  );

  const bgDeliverRef = useRef<(items: BgPendingItem[]) => void>(() => undefined);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）
  useEffect(() => {
    bgDeliverRef.current = deliverBgItems;
  });

  // 挂载注册会话元数据（pagehide 上报 beacon 携带显示名+头像，Web Push 标题/通知头像用对方名字与头像）；
  // 卸载/会话切换时解除（ChatView 按 storageKey keyed 重挂载，切会话先卸旧再挂新）
  useEffect(() => {
    registerBgSession(sessionKey, { title: peerLabel, app: 'chat', avatar: peerAvatarSrc });
    return () => {
      unregisterBgSession(sessionKey);
    };
  }, [peerLabel, peerAvatarSrc, sessionKey]);

  // 挂载 + 回前台时拉取本会话待达消息（服务端即清除），经原投递管线逐条落盘
  //（灵动岛通知/语音频率与页面内 AI 回复完全同口径；会话有活跃流/投递时 pull 内部返回空，等下次回前台再拉）
  useEffect(() => {
    let alive = true;
    const pull = () => {
      void pullBgPending(sessionKey).then((items) => {
        if (alive && items.length > 0) {
          // alive 校验通过才消费：StrictMode 双挂载/快速切会话时先拉到的实例被卸载丢弃，
          // pending 未清，重挂载的实例重新拉取投递（读拉/写清分离防吞消息）
          consumeBgPending(sessionKey);
          bgDeliverRef.current(items);
        }
      });
    };
    pull();
    const offVisible = onBgPageVisible(pull);
    return () => {
      alive = false;
      offVisible();
    };
  }, [sessionKey]);

  // F3 照片任务持久化恢复：上次回合入队但未消费的照片任务快照（进程被杀等）挂载时补发——
  // 读取快照 JSON 校验（数组且每项有 string desc）→ 清 kv（一次性消费，恢复期间新回合入队不重入）→
  // 塞回 photoJobsRef 交 flushPhotoJobs 走正常投递（「正在拍照…」/ 降级卡片 / 相册决策记忆挂点全部复用）；
  // 投递用 bgEnqueueBatch（落库 + 通知与消息持久化 effect 完全同口径）。kv 已清，effect 重跑幂等无副作用
  useEffect(() => {
    const rawText = kvGet<string>(`sms-photo-jobs:${storageKey}`);
    if (!rawText) return;
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (!Array.isArray(parsed)) return;
      const jobs: PhotoTag[] = [];
      for (const item of parsed) {
        const j = item as PhotoTag | null;
        if (j && typeof j === 'object' && typeof j.desc === 'string' && j.desc.trim()) {
          jobs.push({ desc: j.desc, useRef: j.useRef !== false });
        }
      }
      if (jobs.length === 0) {
        kvDel(`sms-photo-jobs:${storageKey}`); // 快照为空/损坏：顺手清理
        return;
      }
      kvDel(`sms-photo-jobs:${storageKey}`);
      photoJobsRef.current = jobs;
      flushPhotoJobs(bgEnqueueBatch);
    } catch {
      // 快照损坏忽略：不影响聊天
    }
  }, [bgEnqueueBatch, flushPhotoJobs, storageKey]);

  // ---------------- #8 流式接收期间的发送排队（对齐微信 wxQueuedTurns：消息照常上屏，回复自动补跑） ----------------

  /** 待补跑回合队列（组件按会话 key 重挂载天然按会话隔离）：#28 localStorage 持久化——
   *  入队/消费即写回 sms-queued-turns，挂载时恢复：刷新后重新进入该会话自动补跑，不丢补跑回合 */
  const queuedTurnsRef = useRef<QueuedTurn[]>([]);

  /** 入队一条补跑回合（dispatch 幂等：批次触发只排一次，回复中连点「发送」不重复排队） */
  const enqueueQueuedTurn = useCallback(
    (t: QueuedTurn) => {
      if (t.kind === 'dispatch' && queuedTurnsRef.current.some((x) => x.kind === 'dispatch')) return;
      queuedTurnsRef.current.push(t);
      writeSmsQueuedTurns(storageKey, queuedTurnsRef.current); // #28 同步持久化
    },
    [storageKey],
  );

  /**
   * 消费补跑队列（串行）：仅当「回复流已收尾 + 本轮消息全部投递完」时放行下一条——
   * 放行即开新流（beginChatStream 同步置位 streaming），上一条补跑的回复完全走完之前
   * 重复触发都会被这两个模块级状态守卫挡住，串行由此保证。
   */
  const tryFlushQueuedTurns = useCallback(() => {
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
    const next = queuedTurnsRef.current.shift();
    if (!next) return;
    writeSmsQueuedTurns(storageKey, queuedTurnsRef.current); // #28 消费即从持久化移除
    if (next.kind === 'dispatch') {
      setPendingDispatch(false);
      markPendingBatch(sessionKey, false);
    }
    startAiTurnRef.current?.(null, next.event);
  }, [sessionKey, storageKey]);

  // 挂载时恢复持久化队列（#28）：声明在补跑触发 effect 之前——挂载帧先恢复、后尝试消费，
  // 队列非空且不在流式/投递中即自动开跑；刷新后重新进入该会话会自动补跑，会话没打开则等下次进入
  useEffect(() => {
    const saved = readSmsQueuedTurns(storageKey);
    if (saved.length > 0) queuedTurnsRef.current = [...saved, ...queuedTurnsRef.current];
  }, [storageKey]);

  // 补跑触发点（各尝试一次，重复触发被流/投递状态守卫挡住；声明在 startAiTurnRef 同步 effect 之后，
  // 放行时读到的闭包一定已含最后一次投递 tick 合并进来的落盘消息）：
  // ① 回复流结束（成功/失败；失败路径没有投递批次，只有这里能放行）② 本轮消息全部投递完（正常路径的实际放行点）
  useEffect(() => {
    if (streaming) return;
    tryFlushQueuedTurns();
  }, [streaming, tryFlushQueuedTurns]);
  useEffect(() => {
    if (delivering) return;
    tryFlushQueuedTurns();
  }, [delivering, tryFlushQueuedTurns]);

  // ---------------- 双向拉黑（仅联系人会话；小助手会话不参与） ----------------

  /** 追加一条系统提示行（拉黑状态变更提示；居中灰字胶囊，不参与上下文） */
  const pushSysMsg = (text: string) => {
    setMsgs((prev) => [...prev, { id: uid(), role: 'assistant' as const, content: '', time: Date.now(), sys: { text } }]);
  };

  /** 设置页「拉黑」开关：持久化（kv，按联系人隔离）+ 生成系统消息；角色下一轮起通过 system 感知 */
  const toggleBlockFromSettings = (v: boolean) => {
    if (!wbContactId) return;
    setBlk(setUserBlock('sms', wbContactId, v));
    pushSysMsg(v ? `你已拉黑「${peer.name ?? peer.title}」` : `你已解除拉黑「${peer.name ?? peer.title}」`);
  };

  /** 处理「申请解除拉黑」卡片：同意 → 解除拉黑；拒绝 → 保持并记录拒绝（角色下一轮知道被拒绝）。
   *  两种结果都会立刻注入系统事件触发角色人设化回应，避免「点了没反应」。
   *  #35：对方正在回复（流式/连发投递）时事件随补跑回合排队（event 随队列持久化），不丢语义也不开交错回合 */
  const resolveBlockReq = (m: ChatMsg, accept: boolean) => {
    if (!wbContactId || m.blkreq?.status !== 'pending') return;
    setMsgs((prev) => prev.map((x) => (x.id === m.id && x.blkreq ? { ...x, blkreq: { ...x.blkreq, status: accept ? ('accepted' as const) : ('rejected' as const) } } : x)));
    const ev = accept
      ? `（系统事件：对方同意了你的解除拉黑申请，现在已经解除拉黑、恢复正常关系。请用符合人设的一两句话自然回应这件事。）`
      : `（系统事件：对方拒绝了你的解除拉黑申请，拉黑仍然生效。请用符合人设的一两句话自然回应这件事，不要假装已经解除。）`;
    if (accept) {
      setBlk(acceptBlockReq('sms', wbContactId));
      pushSysMsg(`你同意了「${peer.name ?? peer.title}」的解除拉黑申请`);
    } else {
      setBlk(rejectBlockReq('sms', wbContactId));
      pushSysMsg(`你拒绝了「${peer.name ?? peer.title}」的解除拉黑申请`);
    }
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      enqueueQueuedTurn({ kind: 'kick', event: ev });
      return;
    }
    startAiTurn(null, ev);
  };

  /**
   * 40-a：发送「解除拉黑申请」（用户→角色；被拉黑后唯一放行的发送通道）：
   * 落一张用户发起的申请卡（from:'user'）+ 系统事件触发角色决策回合
   *（角色用 [同意解除拉黑]/[拒绝解除拉黑] 标记回复，见 buildReplyMsgs 的决策分支）。
   * applyUserBlockReq 未受理（并发/已达上限）时静默收起面板；对方正在回复时事件随补跑回合排队。
   */
  const submitUserBlockReq = () => {
    if (!wbContactId) return;
    const res = applyUserBlockReq('sms', wbContactId, userReqText);
    setUserReqOpen(false);
    setUserReqText('');
    if (!res.created) return;
    setBlk(res.entry);
    setMsgs((prev) => [
      ...prev,
      { id: uid(), role: 'user' as const, content: '', time: Date.now(), blkreq: { reason: res.entry.userReqReason ?? '', status: 'pending' as const, from: 'user' as const } },
    ]);
    const ev = `（系统事件：你之前把对方拉黑了，现在对方发来一条解除拉黑申请，理由：「${res.entry.userReqReason ?? ''}」。如果你愿意解除拉黑给对方一个机会，请在回复的最开头单独加上标记 [同意解除拉黑]；如果决定拒绝，请在回复的最开头单独加上标记 [拒绝解除拉黑]。先用你的方式自然回应这件事）`;
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      enqueueQueuedTurn({ kind: 'kick', event: ev });
      return;
    }
    startAiTurn(null, ev);
  };

  /** 拉黑标记（红色 ! 圆点紧贴气泡——拉黑关系存续期间（任一方向），该期间内的双方气泡都带图标；
   *  按拉黑区间判定：拉黑前的历史消息不标，拉黑期间发的消息恒标（解除后也不消失），解除后新消息不标；
   *  系统提示行/申请卡片/撤回行不显示 */
  const blockSideOf = (m: ChatMsg): 'me' | 'peer' | null => {
    if (m.recalled || m.sys || m.blkreq) return null;
    if (!blockCoversAt(blk, 'byUser', m.time) && !blockCoversAt(blk, 'byChar', m.time)) return null;
    return m.role === 'user' ? 'me' : 'peer';
  };

  /** 拉黑图标渲染（红色 ! 圆点）：我的消息在气泡左侧、对方在气泡右侧（流式与落盘共用） */
  const blockIconSpan = (side: 'me' | 'peer', testid: string) => (
    <span
      data-testid={testid}
      aria-label={side === 'me' ? '我被拉黑' : '对方被我拉黑'}
      className="flex h-[20px] w-[20px] shrink-0 self-center items-center justify-center rounded-full bg-[#FF3B30] text-[13px] font-bold leading-none text-white"
    >
      !
    </span>
  );

  /** 红色 ! 圆点：紧贴气泡（流式与落盘消息共用同款样式） */
  const blockedIconOf = (m: ChatMsg) => {
    const side = blockSideOf(m);
    if (!side) return null;
    return blockIconSpan(side, side === 'me' ? 'sms-block-icon-me' : 'sms-block-icon-peer');
  };

  /** AI 回复失败徽标（红色 !，点击重试）：优先于拉黑图标（新版失败表达方式，替代旧版错误占位行） */
  const failBadgeOf = (m: ChatMsg) => (
    <button
      type="button"
      data-testid={`sms-replyfail-${m.id}`}
      aria-label="AI 回复失败，点击重试"
      title="AI 回复失败，点击重试"
      onClick={() => retryReply(m)}
      className="flex h-[20px] w-[20px] shrink-0 cursor-pointer self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white transition-opacity active:opacity-70"
    >
      !
    </button>
  );

  /** 「消息已发出，但被对方拒收了。」状态行：仅「对方拉黑我」区间内我的消息后面跟随（与图标判定解耦：
   *  用户拉黑 AI 后自己的气泡也有图标，但不显示拒收文案），
   *  居中半透明圆角胶囊（与系统提示行同款） */
  const blockedLineOf = (m: ChatMsg) => {
    if (m.recalled || m.sys || m.blkreq) return null;
    if (m.role !== 'user' || !blockCoversAt(blk, 'byChar', m.time)) return null;
    return (
      <div className="mt-1 flex justify-center">
        <span
          data-testid="sms-block-line-me"
          className="rounded-[6px] bg-black/[0.06] px-3 py-[4px] text-[12px] text-muted-foreground dark:bg-white/[0.08]"
        >
          消息已发出，但被对方拒收了。
        </span>
      </div>
    );
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;

    // 40-a 拉黑拦截：被角色拉黑（byChar）后本 App 内不能发送任何消息（toast + 不落库）；
    // 唯一例外是「解除拉黑申请」，走输入区上方独立入口，不在 send 链上
    if (wbContactId && loadBlock('sms', wbContactId).byChar) {
      showToast('对方已将你拉黑，无法发送');
      return;
    }

    // 发送提示音（设置 › 通知可配；文字/图片/转语音共用的发送链入口）
    playNotifySound('send');

    // 加号选图随文字一起发出（先图后文）：图片消息先入列，随后文字照常走下方流程触发 AI 回合
    if (pendingImgs.length > 0) {
      const imgMsgs: ChatMsg[] = pendingImgs.map((p) => ({
        id: uid(),
        role: 'user',
        content: '',
        time: Date.now(),
        kind: 'image',
        img: { src: p.src, desc: '' },
      }));
      setPendingImgs([]);
      setMsgs((prev) => [...prev, ...imgMsgs]);
    }

    // 文字转语音发送：合成语音气泡（transcript 带原文，AI 直接读得到内容）；失败只 toast 不发文字
    if (ttsSend) {
      sendTextAsVoiceRef.current(text);
      return;
    }

    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text, time: Date.now(), quote: quote ?? undefined };
    // #8 对方正在回复（流式接收或连发投递未清空，投递可拖到流结束后数秒）：消息照常上屏并排队补跑，
    // 「流收尾且投递完毕」后自动触发回复——不再静默丢弃（对齐微信：消息发出去了，AI 稍后回复；
    // 投递中也排队，否则旧回复尾部进不了新回合上下文、旧 AI 气泡还会倒挂在用户新消息下面）。
    // #35：标记投递插入边界——上一轮还在队列里的回复落库时插到这条新消息之前（时序归属上一轮）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      setInput('');
      clearChatDraft('sms', storageKey); // Task 40 草稿箱：消息已入列即清草稿（重进不回显）
      setQuote(null);
      setMsgs((prev) => [...prev, userMsg]);
      markDeliverBoundary(sessionKey, userMsg.id);
      enqueueQueuedTurn({ kind: 'kick' });
      return;
    }
    setInput('');
    clearChatDraft('sms', storageKey); // Task 40 草稿箱：发送成功清空草稿
    setQuote(null);
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setMsgs((prev) => [...prev, userMsg]);
      setPendingDispatch(true);
      markPendingBatch(sessionKey, true);
      return;
    }
    // 拉黑方向修正：用户说「我要拉黑你」类明确宣言 → 系统直接执行「用户拉黑对方」
    //（此前 AI 会误解成让它拉黑用户，方向反了；现在系统代为执行，AI 回合守卫自动转
    // 「仅申请解除拉黑」口径，AI 按人设反应；拉黑跃迁同时触发跨 App 找人/来电钩子）
    if (wbContactId && isUserBlockIntent(userMsg.content) && !loadBlock('sms', wbContactId).byUser) {
      setBlk(setUserBlock('sms', wbContactId, true));
      const peerTitle = peer.name ?? peer.title;
      showToast(`已将「${peerTitle}」加入黑名单`);
      const blkSys = { id: uid(), role: 'assistant' as const, content: '', time: Date.now(), sys: { text: `你已拉黑「${peerTitle}」` } } as unknown as ChatMsg;
      saveMsgs(storageKey, appendWithBoundary(sessionKey, loadMsgs(storageKey) ?? [], blkSys));
      setMsgs((prev) => (prev.some((m) => m.id === userMsg.id) ? [...prev, blkSys] : [...prev, userMsg, blkSys]));
      startAiTurn(userMsg);
      return;
    }
    // Task 49 定时提醒：用户消息像「定时发消息」指令时先解析（LLM 两级兜底；正则闸未命中零开销）；
    // 落任务后：聊天里落灰色系统行（确定性反馈）+ 本轮 sysEvent 带确认提示（AI 自然确认）；仅联系人会话
    if (wbContactId && reminderHintHit(userMsg.content)) {
      const label = await parseReminderInstruction('sms', wbContactId, userMsg.content);
      if (label) {
        const sys = buildReminderSysMsg('sms', label) as unknown as ChatMsg;
        saveMsgs(storageKey, appendWithBoundary(sessionKey, loadMsgs(storageKey) ?? [], sys));
        setMsgs((prev) => (prev.some((m) => m.id === sys.id) ? prev : [...prev, sys]));
        startAiTurn(userMsg, reminderSysHint(label));
        return;
      }
    }
    startAiTurn(userMsg);
  };

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」）；
   *  对方正在回复（流式/投递中）时排队等上一轮走完自动触发，不再静默无响应 */
  const dispatchBatch = () => {
    if (!pendingDispatch) return;
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      enqueueQueuedTurn({ kind: 'dispatch' });
      return;
    }
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    startAiTurn(null);
  };

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次；回复中也可点，走排队补跑） */
  const canDispatch = sentenceSend && pendingDispatch;

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回（信息端无转发/收藏/重新生成） ----------------

  /** 轻量提示（复制/删除等动作反馈；信息端无全局 toast） */
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 1500);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );
  // Task 40：语音气泡播放失败 → 本端自绘 toast（播放器本体无 UI，经全局事件解耦；showToast 为稳定引用，挂载/卸载成对）
  useEffect(() => {
    const onVoicePlayError = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      showToast(typeof msg === 'string' && msg ? msg : '语音播放失败，请稍后重试');
    };
    window.addEventListener(VOICE_PLAY_ERROR_EVENT, onVoicePlayError);
    return () => window.removeEventListener(VOICE_PLAY_ERROR_EVENT, onVoicePlayError);
  }, [showToast]);

  // ---------------- 加号面板：相机 / 图片 / 文字图片 ----------------

  /** 选图（相机拍照 / 相册多选共用）：File → 压缩 dataURL → 待发送预览条（最多 9 张） */
  const onPickImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 9);
    try {
      const srcs = await Promise.all(list.map((f) => readSmsImageFile(f)));
      setPendingImgs((prev) => [...prev, ...srcs.map((src) => ({ id: uid(), src }))].slice(0, 9));
    } catch {
      showToast('图片读取失败，请重试');
    }
  };

  /** 加号面板动作分发：相机（原生后置拍照）/ 图片（系统相册多选）/ 文字图片（弹层） */
  const handlePlusAction = (a: SmsPlusAction) => {
    if (a === 'camera') {
      setPlusOpen(false);
      cameraInputRef.current?.click();
      return;
    }
    if (a === 'image') {
      setPlusOpen(false);
      photoInputRef.current?.click();
      return;
    }
    // 文字图片（Task 13 卡片版）：AI 按人设+聊天记录代笔或用户代写，以卡片消息发到聊天
    setPlusOpen(false);
    setCardError('');
    setCardOpen(true);
  };

  /** 只发图片（选图后直接点发送键；触发 AI 回合，识图管线让 TA 看到图片内容） */
  const sendPendingImages = () => {
    if (pendingImgs.length === 0) return;
    if (wbContactId && loadBlock('sms', wbContactId).byChar) {
      showToast('对方已将你拉黑，无法发送');
      return;
    }
    const built: ChatMsg[] = pendingImgs.map((p) => ({
      id: uid(),
      role: 'user',
      content: '',
      time: Date.now(),
      kind: 'image',
      img: { src: p.src, desc: '' },
    }));
    setPendingImgs([]);
    setMsgs((prev) => [...prev, ...built]);
    // 对方正在回复（流式/投递中）：图片照常上屏并排队补跑（与 send 文字路同口径）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      markDeliverBoundary(sessionKey, built[built.length - 1].id);
      enqueueQueuedTurn({ kind: 'kick' });
      return;
    }
    window.setTimeout(() => startAiTurnRef.current?.(null), 80); // 等重渲染 + ref 回填新闭包（含图片消息）
  };

  /**
   * 手动触发「文字图片」（Task 14 起方向反转）：文字图片是「我」发给 TA 的卡片——
   * 输入留空时让 AI 按人设+最近聊天记录代笔（/api/textcard，用户上游优先、服务端内置模型兑底）；
   * 输入非空 = 用户自己写。成功 → 弹层关闭 + role='user' 的卡片消息上屏（msgs 持久化 effect 落盘）
   * 并触发 AI 回合（卡片文字以「[文字图片]（卡片上写着：…）」进上下文，TA 能读到并回应）；
   * 失败 → 错误留在弹层内（不关弹窗，可重试或取消）。
   */
  const submitTextCard = async (text: string) => {
    // 40-a 拉黑拦截：被角色拉黑（byChar）后不能发送任何消息
    if (wbContactId && loadBlock('sms', wbContactId).byChar) {
      showToast('对方已将你拉黑，无法发送');
      setCardOpen(false);
      return;
    }
    setCardBusy(true);
    setCardError('');
    try {
      let finalText = text;
      if (!finalText) {
        // 留空 → AI 代笔（人设取联系人资料；小助手会话无人设也可用）
        const contact = wbContactId ? await getContact(wbContactId).catch(() => null) : null;
        finalText = await autoCardText({
          config: apiConfig,
          charName: peerLabel,
          channel: '短信',
          persona: contact?.persona ?? '',
          history: buildPhotoDescHistory(msgs, profileName || '我', peerLabel),
        });
      }
      const cardMsg: ChatMsg = { id: uid(), role: 'user', content: '', time: Date.now(), kind: 'textcard', card: { text: finalText } };
      setCardOpen(false);
      // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发
      if (sentenceSend) {
        setMsgs((prev) => [...prev, cardMsg]);
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
      } else if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        // 对方正在回复（流式/投递中）：卡片照常上屏并排队补跑（与 send 文字路同口径）
        setMsgs((prev) => [...prev, cardMsg]);
        markDeliverBoundary(sessionKey, cardMsg.id);
        enqueueQueuedTurn({ kind: 'kick' });
      } else {
        // 文字路同口径：startAiTurn 入列（持久化 effect 自动落盘）+ 触发回复
        startAiTurnRef.current?.(cardMsg);
      }
      showToast('文字图片已发送');
    } catch (e) {
      setCardError(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setCardBusy(false);
    }
  };

  /**
   * 点击「文字图片」卡片 → 用图像生成把卡片文字生成图片（设置 › 图像生成 配置）：
   * 卡片是「我」发的，生图不带角色锁脸（contactId 空，画面描述可在操作面板里改）；
   * 成功 → 卡片消息**原位**变成图片消息（文字图片消失，生成的图显示在原来卡片的位置），
   * 不新增消息、不触发 AI 回合（不是发图给 AI），持久化 effect 自动落盘；
   * 失败 → 只 toast，面板留在原地可重试。
   */
  const generateCardImage = async (m: ChatMsg, descInput: string) => {
    const desc = descInput.trim().slice(0, 400); // G1 描述长度上限与照片标签正则同口径（400 字）
    if (!desc || cardGenBusy) return;
    const cfg = useSettings.getState().imgGenConfig;
    if (!cfg.enabled || !imgGenConfigReady(cfg)) {
      showToast('请先在 设置 › 图像生成 完成配置');
      return;
    }
    setCardGenBusy(true);
    try {
      // 按卡片作者分叉（与长按「重新生成」submitImgRegen 同口径）：AI 的卡片（发图降级卡片）转图带角色
      // 锁脸（首次生成与重新生成都锁，前后一致）；我自己写的卡片转图不带锁脸（contactId 空 = 纯描述图）
      const aiCard = m.role === 'assistant' && Boolean(wbContactId);
      const r = aiCard
        ? await generateCharacterPhoto({ cfg, contactId: wbContactId ?? '', desc, charName: peer.name || peer.title, useRef: true })
        : await generateCharacterPhoto({ cfg, contactId: '', desc, charName: '文字图片', useRef: false });
      // 原位替换：卡片 → 图片（同一条消息位置不变；fromCard 标记让长按菜单出现「重新生成」）
      setMsgs((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, kind: 'image' as const, card: undefined, img: { src: r.src, desc, fromCard: true } } : x)),
      );
      if (aiCard && wbContactId) {
        // B1 卡片转图补齐与 flushPhotoJobs 自动生图完全同口径的挂点（仅 AI 卡：有角色身份；我的卡无角色身份不挂）：
        // 相册归档（origin 'ai'）+ 视觉决策日志 + 照片记忆（节流）+ 相册清单缓存刷新（下一轮视觉规则/选头像可见）
        void addAlbum(wbContactId, r.src, { desc, origin: 'ai' });
        void addVisionDecision({ contactId: wbContactId, app: 'sms', action: 'imggen', targetId: '', imgSrc: r.src, reason: desc });
        notePhotoMemory(wbContactId, 'sms', desc);
        void listAlbums(wbContactId)
          .then((list) => {
            albumSummaryRef.current =
              list.length > 0
                ? list.slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
                : null;
          })
          .catch(() => {});
      }
      setCardActionId(null);
      showToast('图片已生成');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      setCardGenBusy(false);
    }
  };

  /** 「他的声音」选择保存（仅联系人会话）：toast 反馈 + 交宿主持久化（与备注同路径：updateContact 写 voiceId + 刷新联系人） */
  const saveVoiceId = (vid: string) => {
    if (!wbContactId) return;
    showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
    onSaveVoiceId?.(vid);
  };

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字 ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音只有 dataURL） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[]; localText?: string };

  /** 语音消息落库：入列 → 直发语音先自动转写（AI 读内容）再触发回复；已有转写直接触发；
   *  presetTranscript = 文字转语音/划转文字/Web Speech 实时结果；对方正在回复时不打断（语音照常入列，仅跳过本轮触发） */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后语音消息也不能发（按住说话/文字转语音/划转文字共用本入口）
      if (wbContactId && loadBlock('sms', wbContactId).byChar) {
        showToast('对方已将你拉黑，无法发送');
        return;
      }
      const hasText = typeof presetTranscript === 'string' && presetTranscript.trim().length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, stt: 'pending' };
      const msg: ChatMsg = { id: uid(), role: 'user', content: '', time: Date.now(), kind: 'voice', voice };
      setMsgs((prev) => [...prev, msg]);
      /** 触发 AI 回复（对方正在回复——流式/投递中——则排队补跑，语音照常入列不丢弃）；
       *  转写完成后再触发，AI 才能读到语音内容 */
      const kickTurn = () => {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          markDeliverBoundary(sessionKey, msg.id); // #35：语音消息也作插入边界，旧回复落库时插到它前面
          enqueueQueuedTurn({ kind: 'kick' }); // 对方正在回复：本轮「流收尾且投递完毕」后自动补跑
          return;
        }
        window.setTimeout(() => startAiTurnRef.current?.(null), 80);
      };
      if (hasText) {
        kickTurn();
        return;
      }
      // 直发语音：先自动转写（AI 当轮就能读到内容），成功回填 transcript 后触发回复；
      // 失败/超时也照常触发——AI 按「语音占位」防编造规则回应，不假装听过
      void autoTranscribeForAi(clip.blob).then((text) => {
        setMsgs((prev) =>
          prev.map((x) =>
            x.id === msg.id && x.voice
              ? { ...x, voice: text ? { ...x.voice, transcript: text, stt: 'done' as const } : { ...x.voice, stt: 'failed' as const } }
              : x,
          ),
        );
        window.setTimeout(kickTurn, 150); // 等重渲染 + startAiTurnRef 回填新闭包（含转写文本）
      });
    },
    [enqueueQueuedTurn, sessionKey, showToast, wbContactId],
  );

  /** 「划到转文字」松开后：先识别再预览，由用户决定发送文字 / 发送语音（原始录音）/ 取消 */
  const sttPreview = useSttPreview({
    onSendText: (text) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后不能发送
      if (wbContactId && loadBlock('sms', wbContactId).byChar) {
        showToast('对方已将你拉黑，无法发送');
        return;
      }
      const userMsg: ChatMsg = { id: uid(), role: 'user', content: text, time: Date.now() };
      // #8 对方正在回复：消息照常上屏并排队补跑（对齐微信，不再弹提示丢弃）。#35：标记插入边界
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        setMsgs((prev) => [...prev, userMsg]);
        markDeliverBoundary(sessionKey, userMsg.id);
        enqueueQueuedTurn({ kind: 'kick' });
        return;
      }
      if (sentenceSend) {
        setMsgs((prev) => [...prev, userMsg]);
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
        return;
      }
      startAiTurnRef.current?.(userMsg);
    },
    onSendVoice: (clip) => {
      void blobToDataUrl(clip.blob).then((dataUrl) =>
        commitVoiceMsg({ blob: clip.blob, dataUrl, duration: clip.duration, wave: clip.wave }, clip.transcript),
      );
    },
  });

  /** 录音手势结果分发：松开=发语音；划到转文字=预览确认；取消/太短=丢弃 */
  const handleVoiceOutcome = useCallback(
    (result: VoiceRecordResult | null, zone: VoiceRecordZone) => {
      // 取消手势（哪怕录够了时长）与太短结果一律丢弃；仅「原松开未滑动」的太短给提示
      if (!result || zone === 'cancel') {
        if (!result && zone === null) showToast('说话时间太短');
        return;
      }
      if (zone === 'stt') {
        // 划到「转文字」：先识别并预览，用户决定发送文字 / 发送语音 / 取消（不再直接发送）
        sttPreview.open(result);
        return;
      }
      // 原松开：语音气泡入列（附带 Web Speech 实时转写如有）；无转写由 commitVoiceMsg 自动补识别，再触发回复
      void blobToDataUrl(result.blob).then((dataUrl) =>
        commitVoiceMsg({ blob: result.blob, dataUrl, duration: result.duration, wave: result.wave }, result.transcript),
      );
    },
    [commitVoiceMsg, sessionKey, showToast, sttPreview.open],
  );

  const rec = useVoiceRecorder({ onResult: handleVoiceOutcome, onStartError: showToast });

  /** 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）；失败只 toast，不当聊天内容 */
  const sendTextAsVoice = useCallback(
    (text: string) => {
      setInput('');
      clearChatDraft('sms', storageKey); // Task 40 草稿箱：转语音发送同样清空草稿
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => showToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, showToast, storageKey],
  );
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）；send 前引用经此拿到最新实现
  useEffect(() => {
    sendTextAsVoiceRef.current = sendTextAsVoice;
  });

  /** 气泡长按菜单（横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: ChatMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<ChatMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  /** 多选模式：勾选消息批量删除 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 聊天页根元素（长按菜单定位参照） */
  const pageRef = useRef<HTMLDivElement>(null);

  /** 引用人名：我的消息 → 机主称呼/名字（fix3-c #4：不再用「我」，与微信端一致；历史前缀「（引用 XX：…）」随之自动修正）；
   *  对方 → 联系人名/手机号。profileName 未设置时回退「我」保持旧行为 */
  const quoteNameOf = (m: ChatMsg): string => (m.role === 'user' ? profileName || '我' : peer.name || peer.title);

  /** 消息的可复制/引用文本快照（语音 = [语音] + 转写、图片 = [图片] + 描述、文字图片卡片 = 卡片文字，与微信同语义） */
  const quoteContentOf = (m: ChatMsg): string =>
    m.kind === 'voice'
      ? m.voice?.transcript
        ? `[语音] ${m.voice.transcript}`
        : '[语音]'
      : m.kind === 'image'
        ? m.img?.desc
          ? `[图片] ${m.img.desc}`
          : '[图片]'
        : m.kind === 'textcard'
          ? m.card?.text
            ? `[文字图片] ${m.card.text}`
            : '[文字图片]'
          : m.content;

  /** 按发送方组装长按菜单项（语音首项转文字；图片无编辑（内容不可改）有保存/重新生成；复制 删除 编辑 引用 多选 撤回；语音可编辑转写文本、无引用） */
  const buildMsgMenuItems = (m: ChatMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isVoice = m.kind === 'voice';
    const isImage = m.kind === 'image';
    const isCard = m.kind === 'textcard';
    const items: BubbleMenuItem[] = [];
    if (isVoice) items.push({ key: 'stt', label: m.voice?.stt === 'done' && m.voice.transcript ? '取消转文字' : '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    // 图片消息：保存到设备（dataURL 直接下载）
    if (isImage && m.img?.src) items.push({ key: 'saveimg', label: '保存', icon: B.save });
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (!isImage && !isCard) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (!isVoice) {
      items.push({ key: 'quote', label: '引用', icon: B.quote });
    }
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    // AI 图片与「文字图片卡片转出的图片」：重新生成图片（自填描述，原地替换）；我的实拍图不提供
    if (isImage && (m.role === 'assistant' || m.img?.fromCard)) items.push({ key: 'regenimg', label: '重新生成', icon: B.regenimg });
    // G2 恢复上一张：重新生成前的上一版图还在时可恢复（src↔prevSrc 互换；目标约束与重新生成一致）
    if (isImage && m.img?.prevSrc) items.push({ key: 'restoreimg', label: '恢复上一张', icon: History });
    return items;
  };

  /** 气泡长按手势（fire 里用 data-mid 反查消息；多选模式下不弹菜单改为点选勾选） */
  const bubblePress = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || msg.recalled || msg.sys || msg.blkreq) return;
    setMsgMenu({ msg, pos: computeBubbleMenuPos(el.getBoundingClientRect(), pageRef.current?.getBoundingClientRect() ?? null, buildMsgMenuItems(msg).length) });
  }, !selectMode);

  /** 退出多选模式 */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 长按菜单动作分发（执行后关闭菜单） */
  const handleMenuAction = (key: string) => {
    const m = msgMenu?.msg ?? null;
    setMsgMenu(null);
    if (!m) return;
    switch (key) {
      case 'stt': {
        // 语音消息「转文字」：已有结果 → 再点一次=取消转文字（收起结果）；否则现场识别（builtin 免配置），失败可重试
        const v = m.voice;
        if (!v) break;
        if (v.stt === 'done' && v.transcript) {
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: undefined, stt: undefined } } : x)),
          );
          showToast('已取消转文字');
          break;
        }
        // 本地已存原文的语音（AI 语音消息/文字转语音）：直接显示原文，无需识别
        if (!v.url && v.localText) {
          const local = v.localText;
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: local, stt: 'done' as const } } : x)),
          );
          showToast('已转文字');
          break;
        }
        showToast('正在转文字…');
        void (async () => {
          try {
            const blob = await (await fetch(v.url)).blob();
            const text = await transcribeAudioBlob(blob);
            if (!text) {
              showToast('转文字失败，请重试');
              return;
            }
            setMsgs((prev) =>
              prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: text, stt: 'done' as const } } : x)),
            );
            showToast('已转文字');
          } catch {
            showToast('转文字失败，请重试');
          }
        })();
        break;
      }
      case 'copy': {
        const t = quoteContentOf(m);
        const done = () => showToast('已拷贝');
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = t;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
          } catch {
            showToast('拷贝失败');
          }
        };
        try {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(t).then(done).catch(fallback);
          } else {
            fallback();
          }
        } catch {
          fallback();
        }
        break;
      }
      case 'del': {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          showToast('对方正在回复，请稍后再试');
          return;
        }
        setMsgs((prev) => prev.filter((x) => x.id !== m.id));
        showToast('已删除');
        break;
      }
      case 'edit':
        // 语音消息编辑转写/朗读文本；文字消息编辑正文
        setEditMsg(m);
        setEditDraft(m.kind === 'voice' ? m.voice?.transcript ?? m.voice?.localText ?? '' : m.content);
        break;
      case 'quote':
        setQuote({ name: quoteNameOf(m), content: quoteContentOf(m) });
        break;
      case 'multi':
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          showToast('对方正在回复，请稍后再试');
          return;
        }
        setMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, recalled: true } : x)));
        showToast('已撤回');
        // fix3-D #12 撤回级联撤记忆（对齐微信 #17 wechat.tsx:5861 / QQ qq.tsx:4504 同口径）：
        // 该消息若已被提取成记忆碎片，一并清掉，AI 不再引用已撤回内容（异步不阻塞主流程，失败静默）
        if (memContactId) void memPurgeMessageSources(memContactId, m.id);
        break;
      }
      case 'saveimg': {
        // 图片保存到设备：dataURL 直接以 <a download> 触发下载
        const src = m.kind === 'image' ? m.img?.src ?? '' : '';
        if (src && downloadImageSrc(src)) showToast('已保存到设备');
        else showToast('保存失败');
        break;
      }
      case 'regenimg': {
        // 重新生成图片：未配置生图时提示；否则打开描述编辑弹层（预填原图描述）
        const cfg = useSettings.getState().imgGenConfig;
        if (!cfg.enabled || !imgGenConfigReady(cfg)) {
          showToast('请先在 设置 › 图像生成 完成配置');
          break;
        }
        setRegenImgDesc(m.img?.desc ?? '');
        setRegenImgError('');
        setRegenImgId(m.id);
        break;
      }
      case 'restoreimg': {
        // G2 恢复上一张：与重新生成同目标约束（AI 图片或卡片转出的图）；
        // src↔prevSrc 互换（当前图存回 prevSrc，可再次点「恢复上一张」换回来）；原地替换自动落盘
        const img = m.kind === 'image' ? m.img : undefined;
        if (!img || !img.prevSrc) break;
        if (!(m.role === 'assistant' || img.fromCard)) break;
        const curSrc = img.src;
        const restoredSrc = img.prevSrc;
        setMsgs((list) =>
          list.map((x) =>
            x.id === m.id && x.kind === 'image' && x.img ? { ...x, img: { ...x.img, src: restoredSrc, prevSrc: curSrc } } : x,
          ),
        );
        showToast('已恢复上一张');
        break;
      }
    }
  };

  /** 重新生成图片提交：按（可编辑的）描述重生成，成功后原地替换该条消息的图片（自动落盘）；
   *  AI 图片按角色形象锁脸；「文字图片卡片转出的图片」不带锁脸（与首图同口径） */
  const submitImgRegen = async () => {
    const target = regenImgId ? msgs.find((x) => x.id === regenImgId && x.kind === 'image' && (x.role === 'assistant' || x.img?.fromCard)) : null;
    const desc = regenImgDesc.trim().slice(0, 400); // G1 描述长度上限与照片标签正则同口径（400 字）
    if (!target || !desc || regenImgBusy) return;
    setRegenImgBusy(true);
    setRegenImgError('');
    try {
      const cfg = useSettings.getState().imgGenConfig;
      const r =
        target.role === 'assistant'
          ? await generateCharacterPhoto({ cfg, contactId: wbContactId ?? '', desc, charName: peer.name || peer.title, useRef: true })
          : await generateCharacterPhoto({ cfg, contactId: '', desc, charName: '文字图片', useRef: false });
      // G2：旧图存入 prevSrc（长按「恢复上一张」可换回）；B2：AI 图片补相册（追加式，相册保留历史版本）
      setMsgs((prev) => prev.map((x) => (x.id === target.id && x.kind === 'image' ? { ...x, img: { ...x.img, src: r.src, desc, prevSrc: x.img?.src } } : x)));
      if (target.role === 'assistant' && wbContactId) {
        void addAlbum(wbContactId, r.src, { desc, origin: 'ai' });
      }
      setRegenImgId(null);
      showToast('已重新生成图片');
    } catch (e) {
      setRegenImgError(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      setRegenImgBusy(false);
    }
  };

  /** 编辑保存：文字消息更新正文；语音消息更新转写文本（无音频 URL 的同步朗读原文），置为已转写；自动落盘 */
  const saveEdit = () => {
    const t = editDraft.trim();
    if (!editMsg) return;
    if (!t) {
      showToast('内容不能为空');
      return;
    }
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      showToast('对方正在回复，请稍后再试');
      return;
    }
    if (editMsg.kind === 'voice' && editMsg.voice) {
      setMsgs((prev) =>
        prev.map((x) =>
          x.id === editMsg.id && x.voice
            ? { ...x, voice: { ...x.voice, localText: x.voice.url ? x.voice.localText : t, transcript: t, stt: 'done' as const } }
            : x,
        ),
      );
      setEditMsg(null);
      showToast('已修改');
      return;
    }
    setMsgs((prev) => prev.map((x) => (x.id === editMsg.id ? { ...x, content: t } : x)));
    setEditMsg(null);
    showToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      showToast('对方正在回复，请稍后再试');
      return;
    }
    const ids = new Set(selectedIds);
    setMsgs((prev) => prev.filter((x) => !ids.has(x.id)));
    showToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  // iMessage 语义：「已送达」挂在最后一条己方消息下方
  const lastUserIdx = msgs.reduce((acc, m, idx) => (m.role === 'user' ? idx : acc), -1);

  return (
    <div ref={pageRef} className="relative flex h-full min-h-0 flex-col">
      {/* 默认顶栏：返回箭头 + 居中头像/手机号（不显示名字）+ 摄像机图标（聊天设置入口） */}
      {/* sms-topbar：顶部栏锚点（自定义 CSS 示例模板可改底色/横线） */}
      <div className="sms-topbar z-20 shrink-0 border-b border-white/60 bg-white/60 pt-[54px] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]">
        <div className="relative flex h-[64px] items-center px-3">
          <IOSBackButton label="" onClick={onBack} />
          <div
            className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${
              onOpenPeerStatus ? 'cursor-pointer rounded-full transition-opacity active:opacity-60' : ''
            }`}
            onClick={onOpenPeerStatus}
            role={onOpenPeerStatus ? 'button' : undefined}
            aria-label={onOpenPeerStatus ? '查看对方状态' : undefined}
            data-testid="sms-peer-avatar"
          >
            {peerAvatarSrc ? (
              <img src={peerAvatarSrc} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <DefaultAvatar size={40} />
            )}
            <div className="mt-0.5 flex items-center gap-0.5 leading-none">
              <span className="text-[13px] font-semibold tabular-nums">{peer.title}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/70" strokeWidth={2.5} aria-hidden="true" />
            </div>
          </div>
          <div className="ml-auto flex items-center">
            <button
              type="button"
              aria-label="聊天设置"
              data-testid="sms-chat-settings-entry"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-black/5"
            >
              <Video className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="聊天消息"
        aria-live="polite"
        className="sms-chat-list no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-1"
      >
        {!msgs.some((m) => !m.error) && (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 pb-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
              <MessageCircle className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="text-[14px] font-medium text-muted-foreground">发条短信打个招呼吧</p>
          </div>
        )}
        {msgs.map((m, i) => {
          // 错误占位消息（旧版失败落库文案）：新版失败改由触发消息上的红色 ! 徽标表达，不再渲染占位文字行
          if (m.error) return null;
          const prev = i > 0 ? msgs[i - 1] : undefined;
          const next = i < msgs.length - 1 ? msgs[i + 1] : undefined;
          const newDay = prev === undefined || dayKey(prev.time) !== dayKey(m.time);
          const grouped = prev !== undefined && !newDay && prev.role === m.role;
          const lastOfGroup = next === undefined || next.role !== m.role;
          const mine = m.role === 'user';
          const text = m.content.trim();
          // 聊天气泡装扮：按消息序号计算本条气泡视觉（七彩=序号递增循环取色；原生默认时零覆盖直通）。
          // 文本/语音/输入中指示器共用同一 bvis——所有气泡样式一致跟随主题装扮
          const bvis = bubbleVisual(mine ? 'mine' : 'theirs', bubbleStyle, i, 'sms');
          // 动作描写视图（仅对方 AI 的文本消息；我的消息/系统行/申请卡/错误占位/无星号内容 → null 走原路径）
          const actView = !mine && !m.recalled && !m.sys && !m.blkreq && !m.error ? actionDescViewOf(m.content, actionDescOn) : null;
          const actLines = actView ? [...actView.before, ...actView.after] : [];
          // 动作描写开启时气泡正文（剥离描写并整理空白；actView 为 null 时保持原文）
          const bubbleContent = actView && actView.text ? actView.text : text;
          // 空白气泡防御：对方纯文本消息清洗后没有任何可见内容（历史脏数据/空段/纯不可见字符）
          // → 整行不渲染气泡（与「整条只有动作描写」同分支：多选模式保留勾选圈行，其余渲染为空）
          const bubbleBlank =
            !mine && !m.recalled && !m.sys && !m.blkreq && !m.error && !m.kind && !cleanBubbleText(bubbleContent);
          const lineOnly = (actView && !actView.text) || bubbleBlank;
          // Task 40 错误提示优化：Fragment 包 key——消息行后可能追加失败提示行（ChatErrorLine）
          return (
            <Fragment key={m.id}>
            <div
              data-mid={m.id}
              onClickCapture={
                selectMode && !m.recalled && !m.sys && !m.blkreq
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }
                  : undefined
              }
            >
              {newDay && <DaySeparator time={m.time} />}
              {/* 深度思考思维链卡片：消息行级别（日期分隔下方、气泡行上方，紧凑小卡片左贴边=信息端对方气泡起点）——对方任意消息类型
                  （文本/语音/卡片）都可携带思考过程；开关关闭时直接丢弃不渲染 */}
              {!mine && deepThinkOn && m.thinking && !m.recalled ? (
                <div className="px-1 pb-[2px]">
                  <ThinkCard text={m.thinking} testId={`sms-think-${m.id}`} />
                </div>
              ) : null}
              {lineOnly ? (
                /* 整条只有动作描写（或关闭态过滤后无正文 / 空白脏数据）：渲染为居中灰字行；多选模式给勾选圈行保证可勾选 */
                selectMode && !m.recalled && !m.sys && !m.blkreq ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                    className="flex justify-start"
                  >
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {actLines.map((a, k) => (
                        <ActionDescLine key={k} text={a} testId={`sms-action-${m.id}-${k}`} />
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  actLines.map((a, k) => <ActionDescLine key={k} text={a} testId={`sms-action-${m.id}-${k}`} />)
                )
              ) : (
              <>
                {actView?.before.map((a, k) => (
                  <ActionDescLine key={`b${k}`} text={a} testId={`sms-action-${m.id}-${k}`} />
                ))}
              {m.recalled ? (
                /* 已撤回：居中灰字胶囊（你撤回一条消息 / 对方撤回一条消息） */
                <div className="mt-2.5 flex justify-center" data-testid="sms-recall-row">
                  <span className="rounded-[4px] border border-black/15 bg-black/[0.06] px-2 py-[3px] text-[12px] leading-[1.4] text-black/55 dark:border-white/15 dark:bg-white/[0.1] dark:text-white/60">
                    {mine ? '你撤回一条消息' : '对方撤回一条消息'}
                  </span>
                </div>
              ) : m.sys ? (
                /* 系统提示行（拉黑/解除拉黑等状态变更）：居中灰字胶囊 */
                <div className="mt-2.5 flex justify-center" data-testid="sms-sys-row">
                  <span className="rounded-[4px] border border-black/15 bg-black/[0.06] px-2 py-[3px] text-[12px] leading-[1.4] text-black/55 dark:border-white/15 dark:bg-white/[0.1] dark:text-white/60">
                    {m.sys.text}
                  </span>
                </div>
              ) : m.blkreq ? (
                /* 申请解除拉黑卡片：40-a 双向——角色发起（左侧，用户点同意/拒绝）/
                   用户发起（右侧，角色用标记决策，仅展示状态） */
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  className={`mt-2.5 flex ${m.blkreq.from === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <SmsBlockReqCard
                    name={m.blkreq.from === 'user' ? profileName || '我' : (peer.name ?? peer.title)}
                    avatar={m.blkreq.from === 'user' ? profileAvatar : peerAvatarSrc}
                    reason={m.blkreq.reason}
                    status={m.blkreq.status}
                    from={m.blkreq.from}
                    onAccept={() => resolveBlockReq(m, true)}
                    onReject={() => resolveBlockReq(m, false)}
                  />
                </motion.div>
              ) : m.kind === 'voice' && m.voice ? (
                /* 语音消息：VoiceMsgBubble（播放/波形/时长；转写结果由组件内置展示在气泡下方）。
                   我方气泡 #007AFF 白字（与文本气泡同款圆角 18px）；长按菜单/多选/拉黑图标与文本消息一致 */
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-[3px]' : 'mt-2.5'}`}
                >
                  {selectMode && !mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                  {mine && (m.replyFail ? failBadgeOf(m) : blockedIconOf(m))}
                  <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div {...bubblePress}>
                      <VoiceMsgBubble
                        msgId={m.id}
                        voice={{
                          ...m.voice,
                          // 旧存档兼容：早期内置语音条没存 synth/contactId（assistant 会话两者皆无），
                          // 点击会被当成「我方文字转语音」走静音模拟。对方（AI）的静音语音条
                          // 一律按内置朗读通道处理——旧消息无需迁移即可点击真实出声
                          synth: m.voice.synth ?? (mine ? undefined : 'builtin'),
                        }}
                        side={mine ? 'me' : 'peer'}
                        theme="im"
                        // 聊天气泡装扮：语音气泡与文本气泡同一视觉（纯色/七彩换底色随尾巴色、
                        // 毛玻璃/液态胶囊收窄 34px 无尾巴）；无装扮时保持原生（我方 iOS 蓝底）
                        bubbleClassName={bvis.override ? bvis.className : undefined}
                        decorated={bvis.override}
                        hideTail={bvis.override && bvis.tail === 'none'}
                        style={bvis.override ? bvis.style : mine ? { backgroundColor: SELF_BLUE } : undefined}
                        decorApp="sms"
                        msgIndex={i}
                      />
                    </div>
                    {/* iMessage：已送达挂在最后一条己方消息下沿（与文本气泡同规则） */}
                    {mine && i === lastUserIdx && (
                      <p className="mt-1 self-stretch pl-1 text-left text-[11px] leading-none text-muted-foreground">已送达</p>
                    )}
                  </div>
                  {!mine && blockedIconOf(m)}
                  {selectMode && mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`ml-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                </motion.div>
              ) : m.kind === 'image' && m.img ? (
                /* 图片消息（生图自动投递/历史图片）：iMessage 同款大圆角图片气泡（无文字气泡底），点开全屏预览；
                   长按菜单/多选/拉黑图标/已送达与文本消息一致 */
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-[3px]' : 'mt-2.5'}`}
                >
                  {selectMode && !mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                  {mine && (m.replyFail ? failBadgeOf(m) : blockedIconOf(m))}
                  <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div {...bubblePress}>
                      <button
                        type="button"
                        data-testid="sms-img-bubble"
                        aria-label="图片消息"
                        onClick={() => setViewerSrc(m.img?.src ?? null)}
                        className="block overflow-hidden rounded-[16px] active:opacity-80"
                      >
                        {/* 固定像素上限（max-w/max-h 绝对值按比例缩放互不冲突；与微信端 ImageMsgBubble 同口径） */}
                        <img
                          src={m.img.src}
                          alt={m.img.desc || '图片消息'}
                          className="block max-h-[220px] w-auto min-w-[110px] max-w-[168px] object-cover"
                          loading="lazy"
                        />
                      </button>
                    </div>
                    {/* iMessage：已送达挂在最后一条己方消息下沿（与文本/语音气泡同规则） */}
                    {mine && i === lastUserIdx && (
                      <p className="mt-1 self-stretch pl-1 text-left text-[11px] leading-none text-muted-foreground">已送达</p>
                    )}
                  </div>
                  {!mine && blockedIconOf(m)}
                  {selectMode && mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`ml-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                </motion.div>
              ) : m.kind === 'textcard' && m.card ? (
                /* 文字图片卡片（Task 13：无生图依赖——AI 代笔/用户代写的文字直接印在卡片上）；
                   长按菜单/多选/拉黑图标与文本消息一致；无点击行为（纯展示） */
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-[3px]' : 'mt-2.5'}`}
                >
                  {selectMode && !mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                  {mine && (m.replyFail ? failBadgeOf(m) : blockedIconOf(m))}
                  <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div {...bubblePress}>
                      <TextCardBubble
                        text={m.card.text}
                        signedBy={mine ? profileName || '我' : peer.name ?? peer.title}
                        variant="sms"
                        onClick={() => {
                          if (!selectMode) setCardActionId(m.id);
                        }}
                      />
                    </div>
                    {/* iMessage：已送达挂在最后一条己方消息下沿（与文本/语音/图片气泡同规则） */}
                    {mine && i === lastUserIdx && (
                      <p className="mt-1 self-stretch pl-1 text-left text-[11px] leading-none text-muted-foreground">已送达</p>
                    )}
                  </div>
                  {!mine && blockedIconOf(m)}
                  {selectMode && mine && (
                    <span
                      aria-hidden="true"
                      data-testid={`sms-select-${m.id}`}
                      className={`ml-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                    </span>
                  )}
                </motion.div>
              ) : (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-[3px]' : 'mt-2.5'}`}
              >
                {selectMode && !mine && (
                  <span
                    aria-hidden="true"
                    data-testid={`sms-select-${m.id}`}
                    className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                  </span>
                )}
                {/* 拉黑图标（红色 !）：我的消息在气泡左侧 */}
                {mine && (m.replyFail ? failBadgeOf(m) : blockedIconOf(m))}
                {/* 内层收缩为气泡宽度（上限76%），让「已送达」能对齐气泡左缘 */}
                <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {/* 引用块（与微信/QQ 同款：气泡上方独立的半透明圆角胶囊，小圆角 + 细黑边框） */}
                  {m.quote && (
                    <div
                      data-testid="sms-quote-block"
                      className="mb-1 max-w-full overflow-hidden rounded-[4px] border border-black/15 bg-black/[0.06] px-2 py-[3px] text-[12px] leading-[1.4] text-black/55 dark:border-white/15 dark:bg-white/[0.1] dark:text-white/60"
                    >
                      <p className="line-clamp-2 whitespace-pre-wrap break-all">
                        {m.quote.name}：{m.quote.content}
                      </p>
                    </div>
                  )}
                  <div
                      {...bubblePress}
                      data-testid="sms-text-bubble"
                      className={`relative w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[15px] leading-[1.45] ${
                        bvis.override
                          ? `${bvis.className} ${
                              // 纯色/七彩装扮：保留原生气泡圆角与组尾小圆角（信息端 18px 不覆盖——与原生完全一致）
                              lastOfGroup ? (mine ? 'rounded-br-[5px]' : 'rounded-bl-[5px]') : ''
                            }`
                          : mine
                            ? `sms-bub-mine bg-[#007AFF] text-white ${lastOfGroup ? 'rounded-br-[5px]' : ''}`
                            : `sms-bub-theirs bg-muted text-foreground ${lastOfGroup ? 'rounded-bl-[5px]' : ''}`
                      }`}
                      style={bvis.override ? bvis.style : undefined}
                    >
                      {/* 气泡小尾巴：装扮纯色/七彩 = 原生弯钩剪影随色（tailColor）；
                          毛玻璃/液态胶囊无尾巴（tail='none'）；无装扮 = 原生 iOS 蓝/bg-muted */}
                      {!mine && lastOfGroup && bvis.tail !== 'none' && (
                        <span
                          aria-hidden="true"
                          className={`sms-bub-tail-theirs absolute -left-[6px] bottom-0 h-[18px] w-[14px] ${
                            bvis.override && bvis.tailColor ? '' : 'bg-muted'
                          }`}
                          style={{ clipPath: TAIL_CLIP_LEFT, ...(bvis.override && bvis.tailColor ? { backgroundColor: bvis.tailColor } : {}) }}
                        />
                      )}
                      {mine && lastOfGroup && bvis.tail !== 'none' && (
                        <span
                          aria-hidden="true"
                          className={`sms-bub-tail-mine absolute -right-[6px] bottom-0 h-[18px] w-[14px] ${
                            bvis.override && bvis.tailColor ? '' : 'bg-[#007AFF]'
                          }`}
                          style={{ clipPath: TAIL_CLIP_RIGHT, ...(bvis.override && bvis.tailColor ? { backgroundColor: bvis.tailColor } : {}) }}
                        />
                      )}
                      <span className={`relative ${m.error && !mine ? 'text-[#FF3B30]' : ''}`}>{bubbleContent}</span>
                    </div>
                  {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                  {renderTranslations(m.id, m.content, m.error && !mine)}
                  {/* iMessage：已送达挂在气泡下沿、小尾巴另一侧（气泡左下角，与气泡左缘对齐） */}
                  {mine && i === lastUserIdx && !m.error && (
                    <p className="mt-1 self-stretch pl-1 text-left text-[11px] leading-none text-muted-foreground">已送达</p>
                  )}
                </div>
                {/* 拉黑图标（红色 !）：对方的消息在气泡右侧 */}
                {!mine && blockedIconOf(m)}
                {selectMode && mine && (
                  <span
                    aria-hidden="true"
                    data-testid={`sms-select-${m.id}`}
                    className={`ml-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                  </span>
                )}
              </motion.div>
              )}
                {actView?.after.map((a, k) => (
                  <ActionDescLine key={`a${k}`} text={a} testId={`sms-action-${m.id}-${k}`} />
                ))}
              </>
              )}
              {/* 拒收状态行：仅「对方拉黑我」时跟在我的消息后面，居中半透明胶囊；我拉黑对方不显示 */}
              {blockedLineOf(m)}
            </div>
            {/* Task 40 错误提示优化：失败消息行后居中灰字提示（语音/图片/文字卡/文本各类气泡统一在行容器后追加，
                点击重试/长按菜单）；「隐藏这条提示」后本会话不再显示 */}
            {mine && m.replyFail && !hiddenFail[m.id] && (
              <ChatErrorLine
                text={m.failReason || CHAT_UNKNOWN_FAIL_TEXT}
                detail={lastChatErrorDetail(sessionKey)}
                cooldownText={cooldownRemainText(sessionKey)}
                onRetry={() => retryReply(m)}
                onHide={() => setHiddenFail((prev) => ({ ...prev, [m.id]: true }))}
                testId={`sms-errline-${m.id}`}
              />
            )}
            </Fragment>
          );
        })}
        {/* 正在输入指示（流式接收 + 逐条投递期间显示）：AI 回复为「边接收边逐条显示」——
            完整分段直接作为真实消息逐条投递上屏（见 runTurn 的 onSegment/finalize），
            不再有先全文显示后消失的流式气泡（信息端顶栏无「正在输入」标题，这个气泡就是输入指示）。
            气泡装扮跟随：与 TA 的消息气泡同一视觉（对方侧、序号 0） */}
        {(streaming || delivering) && (() => {
          const tvis = bubbleVisual('theirs', bubbleStyle, 0, 'sms');
          return (
          <>
          {/* B2 深度思考实况：流式期间思考增量到达时，输入指示气泡上方先展示「正在深度思考…」
              脉动卡（可展开实时思考）；正文开始流后自动切「已深度思考 (点击展开)」，
              与消息落盘后的 ThinkCard 无缝衔接；深度思考开关关闭时不渲染（思考照常后台进行）。
              信息端无头像，卡片左贴边（与落盘 ThinkCard 的 px-1 同口径） */}
          {deepThinkOn && stream?.liveThink ? (
            <div className="px-1 pb-[2px]">
              <ThinkLiveCard text={stream.liveThink} done={stream.thinkDone ?? false} testId="sms-think-live" />
            </div>
          ) : null}
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className="mt-2.5 flex justify-start"
            data-testid="sms-deliver-typing"
          >
            <div
              className={`relative rounded-[18px] px-4 py-3.5 ${
                tvis.override ? tvis.className : 'bg-muted'
              } ${tvis.override ? '' : 'rounded-bl-[5px]'}`}
              style={tvis.override ? tvis.style : undefined}
            >
              {tvis.tail !== 'none' && (
              <span
                aria-hidden="true"
                className={`absolute -left-[6px] bottom-0 h-[18px] w-[14px] ${
                  tvis.override && tvis.tailColor ? '' : 'bg-muted'
                }`}
                style={{ clipPath: TAIL_CLIP_LEFT, ...(tvis.override && tvis.tailColor ? { backgroundColor: tvis.tailColor } : {}) }}
              />
              )}
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className={`h-1.5 w-1.5 animate-bounce rounded-full ${tvis.override ? 'bg-current' : 'bg-muted-foreground/70'}`}
                    style={{ animationDelay: `${d * 0.15}s`, ...(tvis.override ? { opacity: 0.65 } : {}) }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
          </>
          );
        })()}
        <div aria-hidden="true" className="h-1" />
      </div>

      {/* 输入栏（多选模式下变为批量删除操作栏）：引用条 + 圆钮 / iMessage输入框（麦克风↔发送） */}
      {selectMode ? (
        <div
          className={`z-20 flex shrink-0 items-center justify-between border-t border-white/60 bg-white/60 px-6 pb-[30px] pt-2 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]`}
          data-testid="sms-select-bar"
        >
          <button type="button" data-testid="sms-select-cancel" onClick={exitSelect} className="text-[15px] text-muted-foreground">
            取消
          </button>
          <span className="text-[13px] text-muted-foreground">已选 {selectedIds.length} 条</span>
          <button
            type="button"
            data-testid="sms-select-del"
            disabled={selectedIds.length === 0}
            onClick={batchDelete}
            className="text-[15px] font-medium text-[#FF3B30] disabled:opacity-40"
          >
            删除{selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </button>
        </div>
      ) : (
      <>
      {/* 40-a：被角色拉黑提示条 + 用户发起「解除拉黑申请」入口（仅联系人会话；pending 或已达拒绝上限时隐藏，
          会话内改用跨 App/电话联系方式不受影响）。展开的小面板 = 理由输入 + 发送/取消 */}
      {wbContactId && blk.byChar === true && blk.userReqStatus !== 'pending' && (blk.userReqRejectedCount ?? 0) < BLOCK_REQ_MAX_REJECTED && (
        userReqOpen ? (
          <div
            className="z-20 flex shrink-0 items-center gap-2 border-t border-white/60 bg-white/60 px-3 py-2 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
            data-testid="sms-user-blockreq-panel"
          >
            <input
              value={userReqText}
              onChange={(e) => setUserReqText(e.target.value)}
              maxLength={80}
              autoFocus
              placeholder={`向「${peerLabel}」写一句申请理由…`}
              aria-label="解除拉黑申请理由"
              data-testid="sms-user-blockreq-input"
              className="h-[34px] min-w-0 flex-1 rounded-full bg-white/60 px-3.5 text-[14px] outline-none ring-1 ring-white/70 backdrop-blur-xl placeholder:text-muted-foreground/50 dark:bg-white/[0.08] dark:ring-white/[0.1]"
            />
            <button
              type="button"
              data-testid="sms-user-blockreq-cancel"
              onClick={() => {
                setUserReqOpen(false);
                setUserReqText('');
              }}
              className="shrink-0 text-[14px] text-muted-foreground"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="sms-user-blockreq-send"
              disabled={!userReqText.trim()}
              onClick={submitUserBlockReq}
              className="h-[30px] shrink-0 rounded-full bg-[#007AFF] px-3.5 text-[13px] font-medium text-white transition active:opacity-80 disabled:opacity-40"
            >
              发送
            </button>
          </div>
        ) : (
          <div
            className="z-20 flex shrink-0 items-center gap-2 border-t border-white/60 bg-white/60 px-3 py-1.5 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
            data-testid="sms-user-blockreq-bar"
          >
            <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-muted-foreground">你已被「{peerLabel}」拉黑，无法发送消息</p>
            <button
              type="button"
              data-testid="sms-user-blockreq-open"
              onClick={() => setUserReqOpen(true)}
              className="shrink-0 rounded-full bg-[#007AFF]/10 px-3 py-1 text-[12px] font-medium text-[#007AFF] transition active:opacity-70"
            >
              发送解除申请
            </button>
          </div>
        )
      )}
      {/* 引用条（长按菜单「引用」后显示在输入栏上方；发送时挂到新消息上） */}
      {quote && (
        <div
          className="z-20 flex shrink-0 items-start gap-2 border-t border-white/60 bg-white/60 px-3 py-1.5 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
          data-testid="sms-quote-bar"
        >
          <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-muted-foreground">
            引用 {quote.name}：{quote.content}
          </p>
          <button
            type="button"
            aria-label="取消引用"
            data-testid="sms-quote-cancel"
            onClick={() => setQuote(null)}
            className="shrink-0 text-muted-foreground/70"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (input.trim()) void send();
          else if (pendingImgs.length > 0) sendPendingImages();
          else dispatchBatch();
        }}
        className="sms-inputbar z-20 flex shrink-0 items-center gap-2 border-t border-white/60 bg-white/60 px-2.5 pb-[30px] pt-2 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
      >
        {/* 加号（更多功能）：相机/图片/文字图片面板；iOS 同款灰色圆圈内加号，展开时旋转 45°（对齐微信加号交互） */}
        <button
          type="button"
          aria-label={plusOpen ? '收起更多功能' : '更多功能'}
          aria-expanded={plusOpen}
          data-testid="sms-plus-button"
          onClick={() => setPlusOpen((v) => !v)}
          className="flex h-[33px] w-[33px] shrink-0 items-center justify-center rounded-full bg-white/60 text-muted-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-all active:opacity-60 dark:bg-white/[0.08] dark:ring-white/[0.1]"
        >
          <Plus className={`h-[19px] w-[19px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="flex min-h-[36px] min-w-0 flex-1 items-center rounded-[18px] bg-white/60 pl-3.5 pr-1.5 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
          {voiceMode ? (
            /* 语音输入模式：按住说话（上滑/左滑取消，右滑转文字，松开发送） */
            <VoiceHoldBar rec={rec} testId="sms-voice-hold" />
          ) : (
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={smsTaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Task 40 草稿箱：随输入持久化草稿（防抖合幵落库）；超长截断保存并 5 秒节流提示一次
                  if (saveChatDraft('sms', storageKey, e.target.value) && draftWarnRef.current <= Date.now() - 5000) {
                    draftWarnRef.current = Date.now();
                    showToast(`草稿过长，仅保留前 ${CHAT_DRAFT_MAX} 字`);
                  }
                }}
                onKeyDown={(e) => {
                  // 多行输入：「回车键发送消息」开关统一口径（五端共用 guardEnterToSend）——
                  // 开启=Enter 发送（requestSubmit 与发送键走同一条 form 分流）/ Shift+Enter 换行；关闭=回车一律换行；输入法选词回车永不发送
                  guardEnterToSend(e, enterSend, () => e.currentTarget.form?.requestSubmit());
                }}
                enterKeyHint={enterSend ? 'send' : undefined}
                placeholder={ttsSend ? '输入文字，发送后转为语音' : 'iMessage信息'}
                aria-label="消息输入框"
                className="max-h-[110px] min-h-[22px] w-full resize-none overflow-y-auto bg-transparent py-[7px] pr-10 text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground/50"
              />
              {/* 文字转语音开关（声波图标在输入框内右侧）：开启后输入文字发送为语音气泡
                  （本地仿真，无需配置语音 API，点击不出声）；切到「按住说话」模式时随输入框一起隐藏 */}
              <button
                type="button"
                aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
                aria-pressed={ttsSend}
                data-testid="sms-tts-toggle"
                onClick={() => {
                  const nv = !ttsSend;
                  setTtsSend(nv);
                  showToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
                }}
                className={`absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full transition-colors active:opacity-60 ${
                  ttsSend ? 'text-[#007AFF]' : 'text-black/40 dark:text-white/40'
                }`}
              >
                <AudioLines className="h-[16px] w-[16px]" strokeWidth={ttsSend ? 2.2 : 1.8} aria-hidden="true" />
              </button>
            </div>
          )}
          {!voiceMode && (input.trim() || canDispatch || pendingImgs.length > 0) ? (
            <>
              <button
                type="submit"
                aria-label={ttsSend ? '发送（转语音）' : input.trim() ? '发送' : '发送（让对方回复）'}
                className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full text-white transition active:scale-90 disabled:opacity-40"
                style={{ backgroundColor: SELF_BLUE }}
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.6} aria-hidden="true" />
                )}
              </button>
            </>
          ) : (
            /* 语音模式切换钮（原装饰 Mic 位置）：语音模式高亮 */
            <button
              type="button"
              aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
              aria-pressed={voiceMode}
              data-testid="sms-voice-toggle"
              onClick={() => {
                if (rec.phase !== 'idle') return; // 录音按住中不允许切换
                setVoiceMode((v) => !v);
              }}
              className={`mx-1 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full transition-colors active:opacity-70 ${
                voiceMode ? 'bg-[#007AFF] text-white' : 'text-muted-foreground'
              }`}
            >
              <Mic className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      {/* 待发送图片预览条（加号选图后先预览，点发送键发出；面板展开时隐藏避免遮挡） */}
      {pendingImgs.length > 0 && !plusOpen && (
        <div
          className="z-20 flex shrink-0 items-center gap-2 border-t border-white/60 bg-white/60 px-3 py-2 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]"
          data-testid="sms-img-preview-bar"
        >
          {pendingImgs.map((p, k) => (
            <div key={p.id} className="relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-[10px] ring-1 ring-black/[0.06] dark:ring-white/10">
              <img src={p.src} alt={`待发送图片 ${k + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="移除图片"
                data-testid={`sms-img-preview-remove-${k}`}
                onClick={() => setPendingImgs((prev) => prev.filter((x) => x.id !== p.id))}
                className="absolute right-0.5 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-black/55 text-white active:opacity-70"
              >
                <X className="h-[11px] w-[11px]" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          <p className="ml-1 shrink-0 text-[11px] leading-[1.5] text-muted-foreground">
            点发送键发出
            <br />
            （AI 会看到图片）
          </p>
        </div>
      )}
      {/* 加号面板（相机/图片/文字图片）+ 原生相机/相册隐藏入口（信息 App 不接入输入框自定义，保持原生） */}
      {plusOpen && <SmsPlusPanel onAction={handlePlusAction} />}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="sms-camera-input"
        onChange={(e) => {
          void onPickImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="sms-photo-input"
        onChange={(e) => {
          void onPickImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      </>
      )}

      {/* 文字图片弹层（加号面板 → 文字图片；Task 14 卡片版，以「我」的身份发出） */}
      {cardOpen && (
        <SmsTextCardSheet
          charName={peerLabel}
          busy={cardBusy}
          error={cardError}
          onClose={() => (cardBusy ? undefined : setCardOpen(false))}
          onSubmit={(t) => void submitTextCard(t)}
        />
      )}
      {/* 点击「文字图片」卡片弹出的操作面板：用图像生成生成图片 / 复制文字（三端共用组件） */}
      {(() => {
        const am = cardActionId ? msgs.find((x) => x.id === cardActionId && x.card) : null;
        return am?.card ? (
          <TextCardActionSheet
            text={am.card.text}
            busy={cardGenBusy}
            accent="#007AFF"
            onGenerate={(d) => void generateCardImage(am, d)}
            onToast={showToast}
            onClose={() => (cardGenBusy ? undefined : setCardActionId(null))}
          />
        ) : null;
      })()}
      {/* 长按 AI 图片「重新生成」弹层：可编辑描述 + 锁脸重生成，原地替换（三端共用组件） */}
      {(() => {
        const am = regenImgId ? msgs.find((x) => x.id === regenImgId && x.kind === 'image') : null;
        return am ? (
          <ImageRegenSheet
            desc={regenImgDesc}
            busy={regenImgBusy}
            error={regenImgError}
            accent="#007AFF"
            onDescChange={setRegenImgDesc}
            onSubmit={() => void submitImgRegen()}
            onClose={() => (regenImgBusy ? undefined : setRegenImgId(null))}
          />
        ) : null;
      })()}
      {/* 聊天设置页（顶栏摄像机图标进入）：翻译入口 + 分句发送开关 */}
      {settingsOpen && (
        <SmsChatSettingsPage
          peerName={peer.name ?? peer.title}
          peerAvatar={peerAvatarSrc}
          phone={peer.title}
          remark={peer.remark ?? ''}
          relation={relationLocal ?? relationProp ?? undefined}
          onSaveRelation={
            relationProp != null
              ? (v) => {
                  // 多账号关系感知：关系落信息 App 当前账号作用域（大号/匿名号各自独立）；乐观更新显示
                  setRelationLocal(v);
                  onSaveRelationProp?.(v);
                }
              : undefined
          }
          onSaveRemark={(v) => {
            if (wbContactId) onSaveRemark?.(v);
          }}
          translateSummary={
            transCfg.on
              ? `${translateLangLabel(transCfg.left)} ⇄ ${translateLangLabel(transCfg.right)}`
              : '未开启'
          }
          sentenceSend={sentenceSend}
          timeAware={timeAware}
          actionDescOn={actionDescOn}
          onToggleActionDesc={(v) => saveActionDescOn(sessionKey, v)}
          // 深度思考（IndexedDB 按联系人隔离；AI 助手会话无联系人不提供开关）：开关只控制思维链卡片展示
          deepThinkOn={deepThinkOn}
          onToggleDeepThink={wbContactId ? (v) => setDeepThinkOn(wbContactId, v) : undefined}
          worldBooksSummary={
            wbContactId
              ? loadBooks()
                  .filter((b) => wbBound.includes(b.id))
                  .map((b) => b.name)
                  .join('、') || '未选择'
              : '未选择'
          }
          onBack={() => setSettingsOpen(false)}
          onOpenTranslate={() => setTranslateOpen(true)}
          themeSummary={(() => {
            const s = bubbleStyle.sms;
            const theme = s?.theme === 'liquid' ? '液态玻璃' : '默认';
            const kind = s && s.kind !== 'default' ? ` · ${BUBBLE_KIND_LABEL[s.kind]}` : '';
            return theme + kind;
          })()}
          onOpenTheme={() => setThemeOpen(true)}
          replyCount={replyCountValue}
          onOpenReplyCount={() => setReplyCountOpen(true)}
          onToggleSentenceSend={(v) => {
            saveSentenceSend(sessionKey, v);
            setSentenceSendState(v);
            if (!v) {
              // 关闭分句发送：清除待回复批次标记，后续发送恢复原有的即时回复行为
              markPendingBatch(sessionKey, false);
              setPendingDispatch(false);
            }
          }}
          onToggleTimeAware={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）
            setTimeAware(sessionKey, v);
            setTimeAwareState(v);
          }}
          enterSend={enterSend}
          onToggleEnterSend={(v) => setEnterSend('sms', v)}
          onOpenWorldBooks={wbContactId ? () => setWbOpen(true) : undefined}
          voiceSummary={describeVoiceId(contactVoiceId, myVoicesForSummary)}
          onOpenVoice={wbContactId ? () => setVoiceOpen(true) : undefined}
          onOpenProactive={wbContactId ? () => setProactiveOpen(true) : undefined}
          proactiveSummary={wbContactId ? proactiveCfgSummary('sms', wbContactId) : undefined}
          blockedByUser={blk.byUser === true}
          onToggleBlock={wbContactId ? toggleBlockFromSettings : undefined}
        />
      )}

      {/* 主题界面（聊天设置 › 主题）：顶部毛玻璃胶囊两个选择（主题/气泡）；
          装扮写入 bubbleStyle.sms 独立槽位——与微信/QQ 完全隔离 */}
      {themeOpen && (
        <div className="absolute inset-0 z-[60]">
          <ThemeStylePage
            app="sms"
            onBack={() => setThemeOpen(false)}
            onToast={showToast}
          />
        </div>
      )}

      {/* 主动发消息设置页（聊天设置二级页，仅联系人会话）：定时/事件/自主/提醒四类触发 */}
      {proactiveOpen && wbContactId && (
        <ProactiveMsgPage variant="sms" contactId={wbContactId} contactName={peerLabel} onBack={() => setProactiveOpen(false)} />
      )}

      {/* 回复条数选择页（聊天设置二级页）：信息端每会话独立，选择后立即持久化生效 */}
      {replyCountOpen && (
        <ChatReplyCountPage
          variant="sms"
          value={replyCountValue}
          onBack={() => setReplyCountOpen(false)}
          onSelect={(n) => {
            saveReplyCount(sessionKey, n);
            setReplyCountValue(n);
          }}
        />
      )}

      {/* 世界书挂载页（聊天设置二级页，仅联系人会话）：为联系人勾选挂载的书籍 */}
      {wbOpen && wbContactId && (
        <WorldBookPickerPage
          variant="sms"
          books={loadBooks()
            .filter((b) => b.scope === 'local')
            .map((b) => ({
              id: b.id,
              name: b.name,
              entryCount: b.entries.length,
              enabledCount: b.entries.filter((e) => e.enabled).length,
            }))}
          boundIds={wbBound}
          onBack={() => setWbOpen(false)}
          onChange={(ids) => {
            setBoundBookIds(wbContactId, ids);
            setWbBound(ids);
          }}
        />
      )}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen && (
        <ChatTranslatePage
          variant="sms"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      )}

      {/* 他的声音页（聊天设置二级页，仅联系人会话）：角色音色选择 + AI 语音频率入口；选择结果交宿主写联系人 voiceId */}
      {voiceOpen && wbContactId && (
        <ChatVoicePage
          variant="sms"
          peerName={peer.name ?? peer.title}
          voiceId={contactVoiceId ?? ''}
          voiceFreq={getAiVoiceFreq(voiceFreqKey)}
          onBack={() => setVoiceOpen(false)}
          onSelect={(vid) => {
            saveVoiceId(vid);
            setVoiceOpen(false);
          }}
          onOpenFreq={() => setVoiceFreqOpen(true)}
        />
      )}

      {/* AI 语音频率页（他的声音页二级页）：本轮起按频率决定 AI 回复发语音还是文字；
          联系人会话与微信同键读写（跟随微信 App 里的设置，两端改一处同步生效） */}
      {voiceFreqOpen && (
        <ChatVoiceFreqPage
          variant="sms"
          value={getAiVoiceFreq(voiceFreqKey)}
          onBack={() => setVoiceFreqOpen(false)}
          onSelect={(f) => {
            saveAiVoiceFreq(voiceFreqKey, f);
            setVoiceFreqOpen(false);
          }}
        />
      )}

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/35 px-8" data-testid="sms-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[280px] overflow-hidden rounded-[14px] bg-[#f4f4f6]/95 shadow-2xl backdrop-blur-2xl dark:bg-[#2a2a2c]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-semibold">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="sms-edit-input"
                className="w-full resize-none rounded-[10px] bg-white/70 px-2.5 py-2 text-[15px] leading-[1.45] outline-none ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.1] dark:ring-white/[0.1]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-[44px] flex-1 border-r border-black/10 text-[16px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="sms-edit-save"
                onClick={saveEdit}
                className="h-[44px] flex-1 text-[16px] font-semibold text-[#007AFF] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片全屏预览（点图片气泡打开；点任意处关闭）：黑底居中大图，iMessage 图片查看器同款观感 */}
      {viewerSrc && (
        <div
          className="absolute inset-0 z-[90] flex items-center justify-center bg-black/90"
          data-testid="sms-img-viewer"
          role="dialog"
          aria-label="图片预览"
          onClick={() => setViewerSrc(null)}
        >
          <img src={viewerSrc} alt="图片预览" className="max-h-[80%] max-w-[92%] rounded-[6px] object-contain" />
        </div>
      )}

      {/* 气泡长按横向菜单（横向深色卡片；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="sms-menu"
        />
      )}

      {/* 录音浮层（按住说话期间）：计时 + 实时波形 + 手势提示（纯视觉，手势在按住的胶囊上） */}
      {rec.phase !== 'idle' && <RecordOverlayWx rec={rec} theme="im" />}
      {sttPreview.state && (
        <SttPreviewOverlay
          state={sttPreview.state}
          accent="#007AFF"
          onCancel={sttPreview.close}
          onSendText={sttPreview.sendText}
          onSendVoice={sttPreview.sendVoice}
          onChangeText={sttPreview.setText}
        />
      )}

      {/* 轻量提示（复制/删除等动作反馈） */}
      {toastMsg && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-[90] -translate-x-1/2" data-testid="sms-toast">
          <span className="rounded-full bg-black/75 px-3.5 py-1.5 text-[13px] text-white shadow-lg dark:bg-white/85 dark:text-black">{toastMsg}</span>
        </div>
      )}

    </div>
  );
}

// ---------------- 添加好友（连接联系人 App：把创建好的 CHAR/NPC 加为好友） ----------------

/**
 * 添加好友页（「未添加好友」只能在这里添加/删除）：
 * - 「联系人」App 里创建了但尚未添加为好友的 CHAR/NPC，需输入 TA 的手机号搜索到后才能添加；
 *   也可以在这里直接删除这些未添加好友（二次确认，删除后联系人一并移除）
 * - 添加成功后：出现在联系人 App 主列表与信息 App（联系人面板 + 可发起聊天）
 */
function AddFriendView({
  contacts,
  onBack,
  onAddFriend,
  onDeleted,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onAddFriend: (c: ContactRecord) => void;
  /** 删除成功：把该联系人（及其名下级联 NPC）从本地列表移除 */
  onDeleted: (c: ContactRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** 刚添加成功的联系人名字（顶部成功提示条，2 秒后消失） */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /** 删除二次确认：当前处于「确认删除」状态的联系人 id（3 秒不点自动退回） */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** 刚删除成功的联系人名字（顶部提示条，2.4 秒后消失） */
  const [justDeleted, setJustDeleted] = useState<string | null>(null);

  const pending = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && !isFriendIn(c, 'sms')),
    [contacts]
  );
  /** 只有输入手机号才搜索（名字搜不到）：必须凭手机号才能找到待添加的好友 */
  const q = query.trim().toLowerCase();
  const filtered = q ? pending.filter((c) => (c.phone ?? '').toLowerCase().includes(q)) : [];

  // 成功提示自动消失 + 删除确认自动退回
  useEffect(() => {
    if (!justAdded) return;
    const t = window.setTimeout(() => setJustAdded(null), 2200);
    return () => window.clearTimeout(t);
  }, [justAdded]);
  useEffect(() => {
    if (!justDeleted) return;
    const t = window.setTimeout(() => setJustDeleted(null), 2400);
    return () => window.clearTimeout(t);
  }, [justDeleted]);
  useEffect(() => {
    if (!confirmId) return;
    const t = window.setTimeout(() => setConfirmId(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmId]);

  const add = async (c: ContactRecord) => {
    if (addingId) return;
    setAddingId(c.id);
    setError('');
    try {
      // 多账号 Task 41：好友标记落当前账号作用域（大号/小号/匿名号各自的好友圈互不可见）
      const updated = await setAppFriendFlag('sms', c.id, true);
      if (!updated) throw new Error('联系人不存在');
      // 信息端不显示加好友过程（不写成功提示等系统消息，直接完成添加）
      onAddFriend(updated);
      setJustAdded(displayNameOf(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败，请重试');
    } finally {
      setAddingId(null);
    }
  };

  /** 删除未添加好友（名下 NPC 级联删，本地完成），成功后同步本地列表 */
  const del = async (c: ContactRecord) => {
    if (deletingId) return;
    setDeletingId(c.id);
    setError('');
    try {
      const removed = await deleteContact(c.id);
      if (!removed) throw new Error('删除失败');
      onDeleted(c);
      setJustDeleted(c.name);
      setConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <IOSNavBar
        large={false}
        title="添加好友"
        left={<IOSBackButton label="信息" onClick={onBack} />}
        right={<span className="min-w-[40px]" />}
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* 搜索：长方形边框输入框，必须输入手机号才能找到待添加的好友 */}
        <div
          className={`mt-1 flex h-[46px] items-center gap-2 rounded-[14px] bg-white/60 px-3.5 shadow-sm ring-1 backdrop-blur-xl transition-shadow focus-within:ring-2 focus-within:ring-foreground/30 dark:bg-white/[0.08] dark:ring-white/[0.1] ${
            error ? 'ring-[#FF3B30]/60!' : 'ring-white/70'
          }`}
        >
          <Search className="h-[17px] w-[17px] shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
          <input
            id="add-friend-query"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError('');
            }}
            placeholder="输入手机号查找好友"
            aria-label="输入手机号搜索好友"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/30 text-background transition active:opacity-60"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
        {error && (
          <p className="mt-1.5 px-1 text-[12px] leading-none text-[#FF3B30]" role="alert">
            {error}
          </p>
        )}
        <p className="mt-2 px-1 text-[12px] leading-[17px] text-muted-foreground">
          在「联系人」App 创建的联系人，需输入 TA 的手机号搜索到后才能添加；未添加好友也只能在这里删除
        </p>

        {/* 刚添加/删除成功提示 */}
        {justAdded && (
          <div
            className="mt-3 flex items-start gap-2 rounded-[12px] bg-[#34C759]/12 px-3.5 py-2.5 text-[13px] leading-snug text-[#248A3D] dark:text-[#30D158]"
            role="status"
          >
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>已添加「{justAdded}」为好友，现在可以在「信息」App 和 TA 聊天了</span>
          </div>
        )}
        {justDeleted && (
          <div
            className="mt-3 flex items-start gap-2 rounded-[12px] bg-[#FF453A]/12 px-3.5 py-2.5 text-[13px] leading-snug text-[#D70015] dark:text-[#FF453A]"
            role="status"
          >
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>已删除未添加好友「{justDeleted}」</span>
          </div>
        )}

        {/* 搜索结果：必须输入手机号才会出现待添加的好友 */}
        {!q ? (
          <div className="mt-3 rounded-[14px] border-[1.5px] border-dashed border-border/70 bg-white/50 px-4 py-8 text-center backdrop-blur-xl dark:bg-white/[0.05]">
            <p className="text-[14px] font-medium text-muted-foreground">输入手机号查找好友</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
              到「联系人」App 创建联系人后，凭手机号来这里添加
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-3 rounded-[14px] bg-white/60 px-4 py-8 text-center shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <p className="text-[14px] font-medium text-muted-foreground">没有找到该手机号</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
              检查号码是否正确，或到「联系人」App 查看手机号
            </p>
          </div>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]" aria-label="待添加好友列表">
            {filtered.map((c) => (
              <li key={c.id} className="border-b border-border/50 last:border-b-0">
                <div className="flex w-full items-center gap-3 px-3.5 py-2.5">
                  {c.avatar ? (
                    <img
                      src={c.avatar}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <DefaultAvatar size={48} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-tight">{c.name}</span>
                    <span className="mt-0.5 block truncate text-[12px] tabular-nums text-muted-foreground">
                      {c.kind.toUpperCase()} · {c.phone ?? '未设置手机号'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <GlassButton
                      type="button"
                      onClick={() => void add(c)}
                      disabled={addingId === c.id || deletingId === c.id}
                      aria-label={`添加${c.name}为好友`}
                      className="flex h-[32px] items-center gap-1 rounded-full px-4 text-[13px] font-semibold"
                    >
                      {addingId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                      )}
                      {addingId === c.id ? '添加中' : '添加'}
                    </GlassButton>
                    {confirmId === c.id ? (
                      <GlassButton
                        variant="danger"
                        type="button"
                        onClick={() => void del(c)}
                        disabled={deletingId === c.id}
                        aria-label={`确认删除${c.name}`}
                        data-testid={`confirm-delete-${c.id}`}
                        className="flex h-[32px] items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                        )}
                        {deletingId === c.id ? '删除中' : '确认删除'}
                      </GlassButton>
                    ) : (
                      <GlassButton
                        variant="danger"
                        type="button"
                        onClick={() => setConfirmId(c.id)}
                        disabled={deletingId === c.id}
                        aria-label={`删除${c.name}`}
                        data-testid={`delete-pending-${c.id}`}
                        className="flex h-[32px] items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                        删除
                      </GlassButton>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ---------------- 联系人面板（连接联系人 App：只显示 CHAR 与 NPC，USER 不出现） ----------------

function ContactRow({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`和${contact.name}聊天`}
      className="relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/60"
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={44} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight">{contact.name}</span>
        <span className="mt-0.5 block truncate text-[12px] tabular-nums text-muted-foreground">
          {contact.phone ?? '未设置手机号'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} aria-hidden="true" />
      <span aria-hidden="true" className="absolute bottom-0 left-[72px] right-0 h-px bg-border/50" />
    </button>
  );
}

/** 单个分组（CHAR / NPC）：空组整块隐藏 */
function ContactGroup({
  label,
  list,
  emptyHint,
  onOpenContact,
}: {
  label: string;
  list: ContactRecord[];
  emptyHint: string;
  onOpenContact: (c: ContactRecord) => void;
}) {
  if (list.length === 0) {
    return (
      <>
        <p className="px-4 pb-1 pt-4 text-[12px] font-medium tracking-wide text-muted-foreground">{label}</p>
        <p className="px-4 pb-1 text-[13px] leading-snug text-muted-foreground/55">{emptyHint}</p>
      </>
    );
  }
  return (
    <>
      <p className="px-4 pb-1 pt-4 text-[12px] font-medium tracking-wide text-muted-foreground">{label}</p>
      <ul aria-label={`${label}联系人列表`}>
        {list.map((c) => (
          <li key={c.id}>
            <ContactRow contact={c} onOpen={() => onOpenContact(c)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ContactsPanel({
  contacts,
  state,
  query,
  onQuery,
  onRetry,
  onOpenAssistant,
  onOpenContact,
}: {
  contacts: ContactRecord[];
  state: 'loading' | 'error' | 'ready';
  query: string;
  onQuery: (v: string) => void;
  onRetry: () => void;
  onOpenAssistant: () => void;
  onOpenContact: (c: ContactRecord) => void;
}) {
  const q = query.trim().toLowerCase();
  /** 搜索：名字/手机号/微信号/职业/地区/关系；USER 与未添加好友的不出现 */
  const match = (c: ContactRecord) =>
    !q ||
    [c.name, c.phone, c.wechatId, c.occupation, c.region, c.relation].some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(q)
    );
  const charList = contacts.filter((c) => c.kind === 'char' && isFriendIn(c, 'sms') && match(c));
  const npcList = contacts.filter((c) => c.kind === 'npc' && isFriendIn(c, 'sms') && match(c));
  const friendList = [...charList, ...npcList];

  return (
    <>
      {/* 搜索框 */}
      <div className="px-4 pb-1 pt-2">
        <div className="flex h-[36px] items-center gap-1.5 rounded-[11px] bg-white/60 px-3 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索"
            aria-label="搜索联系人"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="清空搜索"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/30 text-background transition active:opacity-60"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 智能助理 */}
      <p className="px-4 pb-1 pt-3 text-[12px] font-medium tracking-wide text-muted-foreground">智能助理</p>
      <button
        type="button"
        onClick={onOpenAssistant}
        aria-label="查看小助手资料"
        className="relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition active:bg-muted/60"
      >
        <DefaultAvatar size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{ASSISTANT.name}</div>
          <div className="mt-0.5 truncate text-[12px] tabular-nums text-muted-foreground">{ASSISTANT.phone}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
        <span aria-hidden="true" className="absolute bottom-0 left-[72px] right-0 h-px bg-border/50" />
      </button>

      {/* 联系人数据（来自联系人 App） */}
      {state === 'loading' && (
        <div className="flex h-28 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="加载联系人" />
        </div>
      )}
      {state === 'error' && (
        <div className="px-6 py-8 text-center text-[14px] text-muted-foreground">
          联系人读取失败
          <button type="button" onClick={onRetry} className="ml-2 text-foreground underline">
            重试
          </button>
        </div>
      )}
      {state === 'ready' && (
        <>
          <ContactGroup
            label="联系人"
            list={friendList}
            emptyHint={q ? '没有匹配的联系人' : '还没有好友，点右上角「+」添加好友'}
            onOpenContact={onOpenContact}
          />
          <div aria-hidden="true" className="h-6" />
        </>
      )}
    </>
  );
}

// ---------------- 联系人会话行（信息列表：和好友的聊天记录预览） ----------------

/** 联系人会话预览 */
interface ContactSessionPreview {
  contact: ContactRecord;
  preview: string;
  time: number;
}

/** 扫描本地聊天记录：已添加好友的 CHAR/NPC 中有消息记录的进会话列表（按最后消息时间倒序；撤回的消息预览显示撤回文案） */
function scanContactSessions(contacts: ContactRecord[]): ContactSessionPreview[] {
  const out: ContactSessionPreview[] = [];
  for (const c of contacts) {
    if (c.kind === 'user' || !isFriendIn(c, 'sms')) continue;
    const msgs = loadMsgs(`c:${c.id}`);
    if (!msgs || msgs.length === 0) continue;
    // 错误占位消息（旧版失败落库文案）不作会话预览，回退到最后一条实质消息
    const last = [...msgs].reverse().find((m) => m.error !== true) ?? msgs[msgs.length - 1];
    // 语音消息预览统一显示 [语音]、图片消息显示 [图片]、文字图片卡片显示 [文字图片]（与微信会话列表同口径；语音 content 为空串，不透出转写原文）
    const lastText =
      last?.kind === 'voice'
        ? '[语音]'
        : last?.kind === 'image'
          ? '[图片]'
          : last?.kind === 'textcard'
            ? '[文字图片]'
            : (last?.content ?? '');
    out.push({
      contact: c,
      preview: last?.recalled
        ? last.role === 'user'
          ? '你撤回一条消息'
          : '对方撤回一条消息'
        : lastText.trim() || '…',
      time: last?.time ?? 0,
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** 联系人会话行：头像 + 名字 + 最后一条消息预览 + 时间（点击进入聊天） */
function ContactSessionRow({
  contact,
  preview,
  time,
  onOpen,
}: {
  contact: ContactRecord;
  preview: string;
  time: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`和${contact.name}聊天`}
      className="sms-session-row relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.08]"
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="h-[52px] w-[52px] shrink-0 rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={52} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{contact.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtListTime(time)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[13px] leading-snug text-muted-foreground">{preview}</p>
        </div>
      </div>
      {/* iOS 内缩式发丝分隔线 */}
      <span aria-hidden="true" className="absolute bottom-0 left-[76px] right-0 h-px bg-border/50" />
    </button>
  );
}

// ---------------- 底部椭圆分段控件（信息 / 联系人） ----------------

function BottomTabBar({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  const items = [
    { key: 'chats', label: '信息' },
    { key: 'contacts', label: '联系人' },
  ] as const;
  return (
    <nav className="sms-tabbar z-20 shrink-0 bg-white/60 pb-[30px] pt-2.5 backdrop-blur-2xl dark:bg-white/[0.06]">
      <div role="tablist" aria-label="信息分组" className="mx-auto flex w-[220px] rounded-full bg-white/60 p-[2px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
        {items.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onChange(key)}
            className="relative flex-1 rounded-full py-[7px] text-[13px] font-medium transition-colors"
          >
            {tab === key && (
              <motion.span
                layoutId="msg-tab-thumb"
                className="absolute inset-0 rounded-full bg-[#007AFF] shadow-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className={`relative z-10 transition-colors ${tab === key ? 'text-white' : 'text-muted-foreground'}`}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------- 主视图 ----------------

export default function ChatApp() {
  const [view, setView] = useState<View>('main');
  const [tab, setTab] = useState<TabKey>('chats');
  /** 跨 App 跳转：电话 App 联系人详情点「信息」带来的联系人 id（挂载时消费，等联系人载入后自动进会话） */
  const [pendingJump, setPendingJump] = useState<string | null>(() => useUI.getState().pendingChatContact);
  /** 小助手会话未读条数（AI 发了几条消息角标就是几；0 = 已读） */
  const [unreadN, setUnreadN] = useState(0);
  const unread = unreadN > 0;
  /** 已读水位：最后一条已计数的 assistant 消息（id+时间）。AI 回复落盘时统计该键之后的 assistant
   *  消息数累加未读（id 在盘上找不到 = 该条已被删除，按时间戳兑底）；null = 首轮/清空后全量计入 */
  const seenRef = useRef<{ id: string; time: number } | null>(null);
  /** 会话被删除后隐藏（从联系人重新进入聊天即恢复） */
  const [hidden, setHidden] = useState(false);
  /** 置顶 */
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 微信菜单位置（相对 App 容器） */
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, arrowX: 0 });
  /** 删除确认弹窗 */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  /** 小助手会话消息（父级持有：会话行预览用；聊天内状态在 ChatView 内部） */
  const [assistantMsgs, setAssistantMsgs] = useState<ChatMsg[]>(SEED_MSGS);
  const [mounted, setMounted] = useState(false);

  // 联系人数据（连接联系人 App）
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [contactState, setContactState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [query, setQuery] = useState('');
  /** 当前聊天会话（null = 未在聊天中） */
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  /** 角色状态卡（聊天界面点击对方头像弹出：三端共用 PeerStatusCard；小助手会话不弹） */
  const [statusCardOpen, setStatusCardOpen] = useState(false);
  /** 好友会话预览（信息列表：有聊天记录的好友 CHAR/NPC） */
  const [contactSessions, setContactSessions] = useState<ContactSessionPreview[]>([]);
  // 多账号 v2（Task 40-E/40-2c）：当前 sms 账号是否匿名号（顶栏 EyeOff 蓝点角标提示身份非本号）。
  // 切号不刷新网页（switchAccountFor 派发事件）：监听 ACCOUNT_CHANGED_EVENT 实时更新角标 + 重读数据
  const [anonActive, setAnonActive] = useState(() => getActiveAccountFor('sms').kind === 'anon');
  /** 匿名号码切换弹层（会话列表顶栏 EyeOff 入口，与电话 App 共用 AnonSwitchSheet） */
  const [anonSheetOpen, setAnonSheetOpen] = useState(false);
  /** 账号切换版本号：sms 账号变更时 +1，挂在小助手状态载入 / 会话列表扫描 effect 上强制重读新账号数据 */
  const [reloadKey, setReloadKey] = useState(0);

  // 账号切换订阅（Task 40-2c，单库不刷新架构的关键）：sms 域切号（AnonSwitchSheet 或其他入口）→
  // ① 中断旧账号在途流式回复（abortStreamsByPrefix 预置 finalized，旧回复不落盘不串号）+ 清空消息投递队列；
  // ② UI 重置：聊天/添加视图退回会话列表页、关闭打开中的面板（ChatView 随之卸载，重进时按新账号重挂载——
  //    消息本体/回复条数/翻译/排队补跑 sms-queued-turns 等会话级状态全部现场重读）；
  // ③ reloadKey+1 触发重读：小助手会话状态（LS 现算作用域键）、会话列表预览（loadMsgs 现算作用域）、
  //    未读角标 chatBadge 经既有 [unreadN, hidden, mounted] 同步 effect 联动重算。
  //    注册表写入发生在派发事件之前：本处理器及后续 effect 里的 accLs/kv 作用域均已指向新账号
  useEffect(() => {
    const onAccountChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: AccountApp; id?: string }>).detail;
      if (!detail || detail.app !== 'sms') return;
      abortStreamsByPrefix('sms:');
      purgeDeliveryQueueByPrefix('sms:');
      setView('main');
      setTab('chats');
      setMenuOpen(false);
      setConfirmDelete(false);
      setStatusCardOpen(false);
      setAnonSheetOpen(false);
      setAnonActive(getActiveAccountFor('sms').kind === 'anon');
      setReloadKey((k) => k + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, onAccountChanged);
  }, []);

  // 载入小助手本地状态（已读/置顶/删除标记 + 预览消息；异步微任务：保持水合安全）。
  // reloadKey：sms 账号切换后重跑——LS 键 accLs 现算新账号作用域，消息本体 loadMsgs 走 kv 自动作用域；
  // 新账号无记录时回落种子欢迎语并重置旧号残留（水位/未读一并重置，切换后界面立即全量新账号数据）
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setHidden(window.localStorage.getItem(accLs(LS_HIDDEN_KEY, 'sms')) === '1');
      setPinned(window.localStorage.getItem(accLs(LS_PIN_KEY, 'sms')) === '1');
      // 未读条数：优先读计数（AI 发了几条就是几）；旧数据只有已读布尔 → 未读时至少 1
      let n = 0;
      try {
        const raw = Number(window.localStorage.getItem(accLs(LS_UNREAD_N_KEY, 'sms')));
        if (Number.isFinite(raw) && raw > 0) n = Math.min(Math.floor(raw), 99);
        if (window.localStorage.getItem(accLs(LS_READ_KEY, 'sms')) !== '1') n = Math.max(n, 1);
      } catch {
        // 读取失败按 0
      }
      setUnreadN(n);
      const saved = loadMsgs('assistant');
      if (saved && saved.length) setAssistantMsgs(saved);
      else setAssistantMsgs(SEED_MSGS);
      // 水位初始化：盘上最后一条 assistant 消息（持久化未读计数已含它，这里只记录键不重复计数）
      seenRef.current = saved ? lastAssistantMarkOf(saved) : null;
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 未读条数变化 → 落盘（同时同步旧版已读布尔键，兼容旧逻辑；键按 sms 当前账号现算作用域）
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(accLs(LS_UNREAD_N_KEY, 'sms'), String(unreadN));
      if (unreadN > 0) window.localStorage.removeItem(accLs(LS_READ_KEY, 'sms'));
      else window.localStorage.setItem(accLs(LS_READ_KEY, 'sms'), '1');
    } catch {
      // 持久化失败忽略
    }
  }, [unreadN, mounted]);

  /** 小助手预览/未读推进（按「最后一条已计数 assistant 消息」增量，A-5）：流结束（finalized，错误路径
   *  一次性落盘）与逐条投递 tick（ai-delivery 每条落盘）两路共用——finalize 时刻只有首条在盘上，
   *  未读按条数累加必须逐条跟随，全部投完才满足「AI 发了几条消息角标就是几」（只统计 assistant 消息，
   *  与微信/QQ 端口径一致；旧实现按数组长度做水位，会话内删过消息后未读从此不再增长） */
  const syncAssistantFromStore = useCallback(() => {
    const saved = loadMsgs('assistant');
    if (!saved || !saved.length) return;
    setAssistantMsgs(saved);
    const lastMark = lastAssistantMarkOf(saved);
    if (!lastMark) return;
    if (view === 'chat' && chatSession?.key === 'assistant') {
      // 小助手聊天页正开着：消息实时可见，不计未读，只推进已读水位
      seenRef.current = lastMark;
      return;
    }
    // AI 在聊天页外回复：未读条数按「水位键之后的 assistant 消息」累加（进聊天即清零）。
    // 水位键在盘上找不到（该条已被删除）时按时间戳兑底统计其后的消息；水位为空（首次/清空后）全量计入
    const seen = seenRef.current;
    let fresh: number;
    if (!seen) {
      fresh = saved.filter((m) => m.role === 'assistant').length;
    } else {
      const seenIdx = saved.findIndex((m) => m.role === 'assistant' && m.id === seen.id);
      fresh =
        seenIdx >= 0
          ? saved.slice(seenIdx + 1).filter((m) => m.role === 'assistant').length
          : lastMark.time > seen.time
            ? saved.filter((m) => m.role === 'assistant' && m.time > seen.time).length
            : 0;
    }
    seenRef.current = lastMark;
    if (fresh > 0) setUnreadN((n) => Math.min(n + fresh, 99));
  }, [view, chatSession]);

  // 全局流式回复落盘：小助手会话在聊天页外收到 AI 回复时，从存储刷新列表预览并按条数累计未读
  // （联系人会话预览由 contactSessions 在进入列表时重算，无需额外订阅）
  useChatStreamFinalized('sms:assistant', syncAssistantFromStore);

  // 逐条投递 tick：AI 回复由 ai-delivery 调度器逐条落盘，每条到达即推进预览与未读水位
  useEffect(() => {
    return subscribeAiDelivery('sms:assistant', syncAssistantFromStore);
  }, [syncAssistantFromStore]);

  // 置顶 / 删除标记持久化（键按 sms 当前账号现算作用域）
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(accLs(LS_PIN_KEY, 'sms'), pinned ? '1' : '0');
      window.localStorage.setItem(accLs(LS_HIDDEN_KEY, 'sms'), hidden ? '1' : '0');
    } catch {
      // 持久化失败忽略
    }
  }, [pinned, hidden, mounted]);

  /** 和小助手聊天（空记录时 ChatView 内部重新播种欢迎语） */
  const openAssistantChat = () => {
    setUnreadN(0);
    const cur = loadMsgs('assistant');
    // 进聊天即全部已读：水位推进到盘上最后一条 assistant 消息
    if (cur) seenRef.current = lastAssistantMarkOf(cur);
    // 已删除/隐藏的会话重新进入即恢复显示
    setHidden(false);
    activeContactRelation = ''; // AI 助手会话无联系人：清大号关系标签（披露解锁包装段不用）
    setChatSession({ key: 'assistant', peer: { title: ASSISTANT.phone, avatarSrc: null, name: ASSISTANT.name }, systemPrompt: null });
    setView('chat');
  };

  /** 和联系人（CHAR/NPC）聊天：AI 按人设扮演（含配角圈/归属者了解注入） */
  const openContactChat = (c: ContactRecord) => {
    const owner = c.ownerId ? contacts.find((o) => o.id === c.ownerId) : undefined;
    // 机主卡片（名字/昵称区分）：人设里明确「名字是凡凡，昵称是凑凑」。
    // 多账号 v2：取当前信息账号对应的「我」——主号取机主卡片（排除小号/匿名号档案），
    // 小号/匿名号取本账号档案联系人（此前 find(kind==='user') 可能误命中档案导致身份错位/泄露机主真名）
    const smsAcc = getAccountById(activeAccountIdOf('sms'));
    const meCard =
      smsAcc && smsAcc.kind !== 'main'
        ? contacts.find((x) => x.altOf === smsAcc.id)
        : contacts.find((x) => x.kind === 'user' && !x.altOf);
    // 大号关系标签：披露解锁后的「你认出来了」包装段用（memChatRecallBlock altMainRelation）
    activeContactRelation = c.relation?.trim() || '';
    // B8 作用域竞态修复：buildNpcPromptExtra 读碎片依赖模块级账号作用域，提前落位
    setMemScopeForApp('sms');
    setChatSession({
      key: `c:${c.id}`,
      peer: { title: c.phone || c.name, avatarSrc: c.avatar, name: displayNameOf(c, 'sms') || c.name, remark: remarkForApp(c, 'sms') },
      systemPrompt: buildPersonaPrompt(
        c,
        owner?.name ?? null,
        getMemSettings(c.id).share,
        buildNpcPromptExtra(c, contacts),
        // 与微信/QQ 端同口径双重兜底：展示副本没写 realName（机主卡无备注）时回退真名本身，
        // 避免人设回退「用户只是占位词」段落（明明有真名却没用）
        meCard?.realName ?? meCard?.name ?? null
      ),
    });
    setView('chat');
  };

  // 挂载即消费跨 App 请求（避免失败时残留导致以后误跳）
  useEffect(() => {
    if (useUI.getState().pendingChatContact) useUI.getState().setPendingChatContact(null);
  }, []);

  // 电话 App 跳转过来的：联系人载入后自动打开对应会话（相当于添加好友直达聊天）；
  // 找不到（已被删）或载入失败则静默留在信息主界面
  useEffect(() => {
    if (!pendingJump || contactState === 'loading') return;
    const c = contacts.find((x) => x.id === pendingJump);
    setPendingJump(null);
    if (c && c.kind !== 'user') openContactChat(c);
  }, [pendingJump, contactState, contacts]);

  // 灵动岛通知点击跳转：打开通知对应的会话（信息 App 已打开时由事件驱动，
  // 未打开时挂载后消费；联系人未就绪时复用 pendingJump 等载入后自动进入）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('chat');
      if (!t) return;
      if (t.contactId) {
        setPendingJump(t.contactId);
      } else {
        openAssistantChat();
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, []);

  // 拉取联系人（CHAR/NPC 进信息 App，USER 不出现；本地 IndexedDB）
  const loadContacts = useCallback(async () => {
    setContactState('loading');
    try {
      // 信息 App 内显示昵称（昵称优先于真实名字，与 QQ/微信一致）；
      // 头像按 App 投影：读 sms 槽位（无槽位回退全局默认头像）；
      // 备注按 App 隔离（第四十八轮）：读 sms 槽位（未设置回退全局 remark）
      setContacts(withDisplayNames(await listContactsFor('sms'), { app: 'sms' }));
      setContactState('ready');
    } catch {
      setContactState('error');
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  // 换头像跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，渲染端 avatarFor 实时解析；
  // 其他 App（联系人/微信/QQ/电话）改了头像时刷新本端联系人缓存，打开中的会话/列表立刻显示新头像。
  // contact-updated：任意资料字段（名字/手机号/昵称/人设…）变更也刷新——否则编辑联系人不换头像时
  // 本端一直持旧快照（会话面板/列表显示旧名字等）
  useEffect(() => {
    const fn = () => void loadContacts();
    window.addEventListener('contact-avatar-changed', fn);
    window.addEventListener('contact-updated', fn);
    return () => {
      window.removeEventListener('contact-avatar-changed', fn);
      window.removeEventListener('contact-updated', fn);
    };
  }, [loadContacts]);

  /** 添加好友后同步联系人数据（列表/面板/会话即时生效；落库记录带真实名字，展示层统一换成昵称） */
  const upsertContact = useCallback((c: ContactRecord) => {
    const shown = withDisplayNames([c], { app: 'sms' })[0];
    setContacts((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      if (i === -1) return [shown, ...prev];
      const next = [...prev];
      next[i] = shown;
      return next;
    });
  }, []);

  // 会话列表预览：回到主视图时重扫本地聊天记录（从聊天返回也能刷新预览）；
  // reloadKey：sms 账号切换后强制重扫（scanContactSessions 读 loadMsgs，kv 按新账号作用域返回新数据）
  useEffect(() => {
    if (view !== 'main') return;
    setContactSessions(scanContactSessions(contacts));
  }, [contacts, view, reloadKey]);

  // 进入添加好友页时刷新联系人：同步「联系人」App 里新建的 CHAR/NPC（新的朋友列表保持最新）
  useEffect(() => {
    if (view === 'add') void loadContacts();
  }, [view, loadContacts]);

  const togglePin = () => setPinned((v) => !v);

  /** 标为未读/已读（微信语义：会话行红点，未读条数同步持久化；标为未读 = 1 条起计） */
  const markUnread = () => {
    setUnreadN(1);
  };

  const markRead = () => {
    setUnreadN(0);
  };

  /** 不显示该聊天：隐藏会话行但保留聊天记录（从联系人重新进入即恢复）；隐藏后未读无处展示，一并清为已读避免主屏角标卡死 */
  const hideChat = () => {
    setHidden(true);
    markRead();
  };

  /** 删除该聊天：清空记录并隐藏（重新进入重新播种欢迎语） */
  const deleteChat = () => {
    setAssistantMsgs([]);
    saveMsgs('assistant', []);
    setHidden(true);
    seenRef.current = null; // 记录已清空：水位归零，下一轮 AI 回复从零计数
    setUnreadN(0);
  };

  // 主屏图标红点同步：小助手会话未读 → unread-store 总线（与微信/QQ 主屏角标同款，实时+持久化）
  useEffect(() => {
    if (!mounted) return; // 等本地已读状态载入后再同步，避免默认 true 造成误闪
    chatBadge.set(unreadN > 0 && !hidden ? Math.min(unreadN, 99) : 0);
  }, [unreadN, hidden, mounted]);

  // 退出网页接力：服务端代跑的回复已待达 → 未读角标（同一批条目只在第一次查询时提示，
  // peek 内部 localStorage 去重；进聊天页正式拉取投递后自动解除）。信息 App 只有「小助手」
  // 会话有未读表（sms:assistant → unreadN/setUnreadN），联系人会话没有未读 store（待达消息由
  // 聊天页挂载拉取投递 + 灵动岛通知覆盖），其余 sms: 键不打角标
  useEffect(() => {
    if (!mounted) return; // 等本地未读状态载入后再叠加，避免被初始化覆盖
    void peekBgBadgeCounts().then((counts) => {
      for (const [key, n] of Object.entries(counts)) {
        if (!key.startsWith('sms:')) continue;
        if (key.slice(4) === 'assistant') setUnreadN((prev) => Math.min(prev + n, 99));
      }
    });
  }, [mounted]);

  /** 打开微信风格长按菜单：锚定在会话行下方、水平对齐触点 */
  const openMenuAt = (x: number, rowBottom: number) => {
    const screen = screenRef.current?.getBoundingClientRect();
    const w = wxMenuWidth(menuItems.map((it) => it.label));
    const sw = screen?.width ?? 390;
    const top = Math.max(rowBottom - (screen?.top ?? 0) + 8, 8);
    const left = Math.min(Math.max(x - w / 2, 10), Math.max(sw - w - 10, 10));
    const arrowX = Math.min(Math.max(x - left - 6, 10), Math.max(w - 22, 10));
    setMenuPos({ top, left, arrowX });
    setMenuOpen(true);
  };

  const menuItems: WxMenuItem[] = [
    unread
      ? { icon: MailOpen, label: '标为已读', onSelect: markRead }
      : { icon: Mail, label: '标为未读', onSelect: markUnread },
    pinned
      ? { icon: PinOff, label: '取消置顶', onSelect: togglePin }
      : { icon: Pin, label: '置顶该聊天', onSelect: togglePin },
    { icon: EyeOff, label: '不显示该聊天', onSelect: hideChat },
    { icon: Trash2, label: '删除该聊天', onSelect: () => setConfirmDelete(true) },
  ];

  const last = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : undefined;
  // 撤回的消息在会话列表预览显示「你/对方撤回一条消息」；语音消息预览统一显示 [语音]、图片 [图片]、文字图片卡片 [文字图片]（与微信同口径）
  const preview = last?.recalled
    ? last.role === 'user'
      ? '你撤回一条消息'
      : '对方撤回一条消息'
    : last?.kind === 'voice'
      ? '[语音]'
      : last?.kind === 'image'
        ? '[图片]'
        : last?.kind === 'textcard'
          ? '[文字图片]'
          : last?.content || SEED_MSGS[0].content;
  // 跨天显示 M月D日（与上方联系人行 fmtListTime 同口径，A-8；无时间落盘时保留「现在」兑底）
  const listTime = mounted ? (last && last.time > 0 ? fmtListTime(last.time) : '现在') : '';

  // 跨 App 跳转中（等联系人载入）：先不渲染主界面，避免闪一下会话列表
  if (pendingJump) {
    return (
      <IOSScreen className="items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </IOSScreen>
    );
  }

  if (view === 'add') {
    return (
      <IOSScreen>
        <AddFriendView
          contacts={contacts}
          onBack={() => setView('main')}
          onAddFriend={upsertContact}
          onDeleted={(c) => setContacts((prev) => prev.filter((x) => x.id !== c.id && x.ownerId !== c.id))}
        />
      </IOSScreen>
    );
  }

  if (view === 'chat' && chatSession) {
    const isAssistant = chatSession.key === 'assistant';
    return (
      <IOSScreen>
        <ChatView
          key={chatSession.key}
          storageKey={chatSession.key}
          initialMsgs={isAssistant ? SEED_MSGS.map((m) => ({ ...m, time: Date.now() })) : []}
          onMsgsChange={isAssistant ? setAssistantMsgs : undefined}
          peer={chatSession.peer}
          systemPrompt={chatSession.systemPrompt}
          onBack={() => setView('main')}
          onOpenPeerStatus={isAssistant ? undefined : () => setStatusCardOpen(true)}
          contactVoiceId={isAssistant ? null : contacts.find((c) => c.id === chatSession.key.slice(2))?.voiceId ?? null}
          relation={
            isAssistant
              ? undefined
              : (() => {
                  const c = contacts.find((x) => x.id === chatSession.key.slice(2));
                  return c && c.kind !== 'user' ? relationForAccount(c, 'sms') : undefined;
                })()
          }
          onSaveRelation={
            isAssistant
              ? undefined
              : (v) => {
                  const cid = chatSession.key.slice(2);
                  void (async () => {
                    try {
                      await setAppRelation('sms', cid, v);
                      await loadContacts();
                    } catch {
                      // 持久化失败静默（关系为增强能力，本地显示值已乐观更新）
                    }
                  })();
                }
          }
          onSaveVoiceId={(vid) => {
            if (!chatSession || chatSession.key === 'assistant') return;
            const cid = chatSession.key.slice(2);
            void (async () => {
              try {
                // 与备注同路径：updateContact 写联系人 voiceId（空串 = 清除，回退全局默认）+ 刷新联系人列表（prop 随之更新）
                await updateContact(cid, { voiceId: vid || null });
                await loadContacts();
              } catch {
                // 持久化失败静默（音色为增强能力）
              }
            })();
          }}
          onSaveRemark={(v) => {
            if (!chatSession || chatSession.key === 'assistant') return;
            const cid = chatSession.key.slice(2);
            void (async () => {
              try {
                // 第四十八轮：备注按 App 隔离——信息里的备注只写 sms 槽位，微信/QQ 不受影响
                await updateContact(cid, { remarks: { sms: v || null } });
                const raw = await listContactsFor('sms');
                const c = raw.find((x) => x.id === cid);
                await loadContacts();
                if (c) {
                  const shown = withDisplayNames([c], { app: 'sms' })[0];
                  setChatSession((prev) =>
                    prev && prev.key === `c:${cid}`
                      ? { ...prev, peer: { ...prev.peer, name: displayNameOf(shown, 'sms') || shown.name, remark: remarkForApp(shown, 'sms') } }
                      : prev,
                  );
                }
              } catch {
                // 持久化失败静默（备注为增强能力）
              }
            })();
          }}
          onContactChanged={(cid) => {
            // #108/#119：AI 自主换头像后同步父级 contacts state + chatSession.peer.avatarSrc，
            // 保证退出会话再回主列表 / 重新进入会话时头像数据一致（avatarOverride 已在 ChatView 内即时刷新顶栏）
            void (async () => {
              try {
                // 头像按 App 投影：AI 换头像只写 sms 槽位，这里重读也按 sms 投影取 avatarSrc
                const raw = await listContactsFor('sms');
                const c = raw.find((x) => x.id === cid);
                await loadContacts();
                if (c) {
                  const shown = withDisplayNames([c], { app: 'sms' })[0];
                  setChatSession((prev) =>
                    prev && prev.key === `c:${cid}`
                      ? { ...prev, peer: { ...prev.peer, avatarSrc: shown.avatar, name: displayNameOf(shown, 'sms') || shown.name, remark: remarkForApp(shown, 'sms') } }
                      : prev,
                  );
                }
              } catch {
                /* 持久化失败静默（视觉动作为增强能力） */
              }
            })();
          }}
        />
        {/* 角色状态卡（点击顶栏对方头像弹出；关闭不影响聊天，内容不写记忆除非主动存入。
            contact 按会话键实时解析：切会话/退出聊天时 contact=null 时不渲染） */}
        <PeerStatusCard
          open={statusCardOpen}
          onClose={() => setStatusCardOpen(false)}
          contact={chatSession.key.startsWith('c:') ? contacts.find((c) => c.id === chatSession.key.slice(2)) ?? null : null}
          app="sms"
        />
      </IOSScreen>
    );
  }

  return (
    <IOSScreen className="relative">
      {/* 导航栏：返回主屏 + 标题 + 右上角加号（添加好友） */}
      <IOSNavBar
        inline
        title="信息"
        className="shrink-0"
        left={<BackToHome className="static!" />}
        right={
          <>
            {/* 匿名号码切换（Task 40-E）：点击弹共享半屏弹层；当前就是匿名号时右上角蓝点角标提示身份非本号。
                视觉同旁边「+」按钮（h-9 w-9 玻璃圆钮），after:-inset-1 把触控区扩到 44px */}
            <GlassButton
              type="button"
              onClick={() => setAnonSheetOpen(true)}
              aria-label="切换匿名号码"
              data-testid="chat-list-anon"
              className="relative flex h-9 w-9 items-center justify-center rounded-full after:absolute after:-inset-1 after:content-['']"
            >
              <EyeOff className="h-[20px] w-[20px]" strokeWidth={2} aria-hidden="true" />
              {anonActive && (
                <span
                  data-testid="chat-list-anon-dot"
                  className="absolute right-[4px] top-[4px] h-2 w-2 rounded-full bg-[#0A84FF] ring-2 ring-card"
                  aria-hidden="true"
                />
              )}
            </GlassButton>
            <GlassButton
              type="button"
              onClick={() => setView('add')}
              aria-label="添加好友"
              className="flex h-9 w-9 items-center justify-center rounded-full"
            >
              <Plus className="h-[20px] w-[20px]" strokeWidth={2} aria-hidden="true" />
            </GlassButton>
          </>
        }
      />

      {/* Tab 内容 */}
      {tab === 'chats' ? (
        <div role="tabpanel" aria-label="信息" className="sms-session-list no-scrollbar min-h-0 flex-1 overflow-y-auto">
          {!hidden && (
            <AssistantRow
              preview={preview}
              time={listTime}
              unreadCount={unreadN}
              pinned={pinned}
              onOpen={openAssistantChat}
              onLongPress={({ x, rowBottom }) => openMenuAt(x, rowBottom)}
            />
          )}
          {/* 与好友（CHAR/NPC）的会话：聊过天即出现在列表，按最后消息时间排序 */}
          {contactSessions.map((s) => (
            <ContactSessionRow
              key={s.contact.id}
              contact={s.contact}
              preview={s.preview}
              time={s.time}
              onOpen={() => openContactChat(s.contact)}
            />
          ))}
          {hidden && contactSessions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 pb-14">
              <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-black/5 text-muted-foreground dark:bg-white/10">
                <MessageCircle className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="text-[16px] font-medium">暂无会话</div>
              <div className="max-w-[240px] text-center text-[13px] leading-snug text-muted-foreground">
                会话已删除或不显示，可从联系人重新发起聊天
              </div>
              <GlassButton
                type="button"
                onClick={() => setTab('contacts')}
                aria-label="去联系人"
                className="mt-1 rounded-full px-5 py-2 text-[14px] font-medium"
              >
                去联系人
              </GlassButton>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="联系人" className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <ContactsPanel
            contacts={contacts}
            state={contactState}
            query={query}
            onQuery={setQuery}
            onRetry={() => void loadContacts()}
            onOpenAssistant={openAssistantChat}
            onOpenContact={openContactChat}
          />
        </div>
      )}

      {/* 底部椭圆分段控件 */}
      <BottomTabBar tab={tab} onChange={setTab} />

      {/* 微信风格长按菜单：标为(已)未读 / (取消)置顶 / 不显示 / 删除 */}
      {menuOpen && <WxLongPressMenu pos={menuPos} items={menuItems} onClose={() => setMenuOpen(false)} />}

      {/* 删除该聊天：iOS 风格确认弹窗 */}
      <IOSConfirmDialog
        open={confirmDelete}
        title="删除该聊天？"
        desc={`与「${ASSISTANT.name}」的聊天记录将被删除。`}
        confirmLabel="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteChat();
        }}
      />

      {/* 匿名号码切换弹层（Task 40-E，与电话 App 共享；app="sms" 切的是信息端账号）。
          切号不刷新网页：switchAccountFor 派发事件，本组件监听后重置 UI 并重读新账号数据 */}
      <AnonSwitchSheet app="sms" open={anonSheetOpen} onClose={() => setAnonSheetOpen(false)} />

      {/* 坐标参照层：铺满 App 容器用于菜单定位（不拦截事件） */}
      <div ref={screenRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
    </IOSScreen>
  );
}
