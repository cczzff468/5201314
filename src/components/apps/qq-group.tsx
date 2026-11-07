'use client';

/**
 * QQ 群聊（宿主：QQ App；会话身份 sessionKey = `qq:group:<groupId>`）。
 *
 * 组成：
 * - QqGroupCreatePage  建群：多选 QQ 好友 + 群名（默认按成员名生成）；
 * - QqGroupChatPage    群聊页：气泡（发言者名+头像）/ @某成员优先回复 / 长按菜单（复制/引用/撤回/删除）/
 *                      流式气泡（当前发言角色）/ 多角色逐个顺序回复；
 *                      输入与单聊完全对齐（表情包/加号面板/图片/相机/位置，共用同一套组件）；
 *                      聊天背景按群独立（入口在聊天信息页，与单聊同款 ChatBgPage）；
 * - QqGroupInfoPage    群聊信息：成员管理（邀请/移出）、群名、群公告、群头像、
 *                      记忆与私聊互通开关（按群独立）、置顶/免打扰、时间感知、清空记录、解散并退出群聊。
 *
 * AI 管线（多角色，每个角色独立组装 system，绝不共用）：
 * - 用户发言后按「被 @ 成员必答优先，其余成员按人设自判（[SKIP] 不落盘）」逐个发起流式回合（单会话单流，队列串行）；
 * - 每个角色的 system = 七要素人设（含自己与机主的关系）+ 群聊规则（当前是群聊/参与者名单与成员速览/
 *   只代表自己/禁复读/可以互相对话）+ 该角色自己的记忆召回（memRecallBlock mode='group'：
 *   本群记忆 + 互通开启时的自己私聊记忆；interopOn 只跟群级开关）+ 时间感知（按群开关）+ 世界书；
 *   机主与其他成员的历史消息一律映射为「发言者：内容」的 user 消息；
 * - finalize：回复落盘（senderId 区分发言人）+ 未读 + memAfterAiTurn（roundScope 按群隔离，
 *   碎片带 source='group'/sourceGroupId/groupMembers 群来源标记）。
 * - E1 轻防御（照片标签降级）：群聊不接生图管线（多成员锁脸归属未实现），AI 回复漏出的 [图片:…]
 *   标签剥除后降级为「文字图片」卡片（kind='textcard'，详见下方类型区注释与 buildGroupReplyMsgs）。
 * - 群红包（普通/拼手气/专属）与指定成员转账：复用单聊同一套卡片/页面组件（RedPacketBubble/RedPacketCompose 等），
 *   消息落本群消息库按群隔离持久化；成员按人设领取/收款/退回，纯本地模拟不涉及真实资金。
 * - 回复条数（按群独立连发多条）与分句发送（连发不触发回复，空输入点发送统一触发）与单聊同套逻辑。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { promptRule } from '@/lib/prompt-entries';
import {
  ArrowLeftRight,
  AudioLines,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerRightDown,
  Crown,
  Forward,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  Mic,
  MicOff,
  Minus,
  Phone,
  Plus,
  Search,
  Shield,
  Sparkles,
  Smile,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  BUBBLE_MENU_ICONS,
  BubbleActionMenu,
  computeBubbleMenuPos,
  useBubbleLongPress,
  type BubbleMenuItem,
} from '@/components/apps/bubble-menu';
import { addressNameOf, displayNameOf, isFriendIn, meTileLabel, nameVariantHit, contactNameVariants, type ContactRecord } from '@/lib/contacts';
import { buildShizukuAutonomyRules, executePhoneOp } from '@/lib/ios/shizuku-autonomy';
import { aiVoiceFreqLabel, decideAiVoiceMessage, getAiVoiceFreq, saveAiVoiceFreq, synthesizeAiVoice } from '@/lib/ios/ai-voice';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
// 美团×AI 联动（C11 群内帮点外卖）：目录+代点教学注入 + [帮点外卖] 执行 + 草稿卡历史序列化
import { buildMtEngageCtx, mtCreateAiDraft, mtDraftHistoryLine, mtEngageSessionUid, parseMtOrderBody } from '@/lib/ios/mt-ai-engage';
import { MtDraftBubble } from './mt-draft-card';
import { contactRealName, getChatBgImage, ownerRealNameFor, removeChatBgImage, setChatBgImage } from '@/lib/ios/contacts-store';
import { genId } from '@/lib/ios/db';
import {
  addGroupMember,
  collectGroupEventLines,
  GROUP_MEMBER_CAP,
  GROUP_MUTE_PRESETS,
  createGroup,
  dissolveGroup,
  effectiveInterop,
  getGroup,
  groupDisplayName,
  groupMuteLeftText,
  groupPreview,
  groupRoleOf,
  isGroupMuted,
  kickGroupMember,
  kickOwnerFromGroup,
  listGroups,
  loadGroupMsgs as loadGroupMsgsRaw,
  muteGroupMember,
  saveGroupMsgs as saveGroupMsgsRaw,
  setGroupAdmin,
  takeGroupMuteNotice,
  transferGroupOwner,
  unmuteGroupMember,
  ensureGroupNo,
  updateGroup,
  type ChatGroup,
  type GroupFwdRecord,
  type GroupMemberRole,
  type GroupRpData,
  type GroupTrData,
  type WxGroupMsg as WxGroupMsgBase,
} from '@/lib/ios/groups';
import { addFavorite, isMsgFavorited, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { buildGroupAdminRules, canEditGroupInfo, canModerateTarget, parseMuteDuration } from '@/lib/ios/group-admin';
import { applyGroupChatSocialAction, buildGroupInviteRules, kickNoticeOf } from '@/lib/ios/group-social';
import { isGroupChatSocialAction } from '@/lib/chat-rich';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { qqChatFlags, useChatFlags, type ChatFlags } from '@/lib/chat-flags';
import { ChatBgPage, ChatReplyCountPage, ChatToggle, ChatVoiceFreqPage, chatBgLayerStyle, type ChatSettingsBg } from '@/components/apps/chat-settings';
import { loadStickers, type Sticker } from '@/lib/ios/stickers';
import { getStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { EMOJI_CODE_RULE } from '@/lib/ios/emoji-codes';
import { InlineEmojiText } from './inline-emoji';
import { ChatRichInput, type ChatRichInputHandle } from './chat-rich-input';
import { getActionDescOn, saveActionDescOn, useActionDescOn, ACTION_DESC_RULE, ACTION_DESC_OFF_RULE, actionDescViewOf } from '@/lib/action-desc';
// 深度思考（B1 群聊）：指令注入 + 开关（IndexedDB 按群隔离，渲染订阅版随群设置页切换即时刷新）
import { DEEP_THINK_RULE, setDeepThinkOn, useDeepThinkOn } from '@/lib/deep-think';
import { ThinkCard } from './think-card';
import { ActionDescLine } from './action-desc-line';
import { TextCardBubble } from './text-card-bubble';
import { readImageFile } from './wechat';
import {
  LocationBubble,
  LocationPickerPage,
  QqImageBubble,
  QqPlusGrid,
  QqStickerBubble,
  QqStickerPanel,
  RedPacketBubble,
  RedPacketCompose,
  RedPacketOpenModal,
  RpIcon,
  QQNoticeRow,
  TransferBubble,
  TransferCompose,
  PayPwdGate,
  fmtMoney,
  QQ_QUICK_META,
  type MsgPacket,
} from './qq';
import { canPay, executePayment, gainToWallet, loadBankCards, loadPayPwd, loadWallet, round2 } from './qq';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import { stopSpeaking } from '@/lib/ios/tts-client';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { QqVoicePanel, SttPreviewOverlay, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildImagePlaceholderRule, buildVoicePlaceholderRule, type MediaRuleMsg } from '@/lib/chat-media-rules';
// E1 轻防御：群聊照片标签剥除/流式分段防截断工具（与单聊 wechat/qq.tsx 同源引擎层）
import { extractPhotoTags, splitUnfinishedPhotoTag, stripUnfinishedPhotoTag } from '@/lib/imggen';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback, VOICE_PLAY_ERROR_EVENT } from '@/lib/ios/voice-player';
// Task 40「错误提示优化」：错误分类/连续失败冷却 + 失败灰字提示行 + 草稿箱（详见各模块注释）
import { CHAT_UNKNOWN_FAIL_TEXT, classifyChatError, cooldownRemainText, lastChatErrorDetail, recordChatFail, recordChatSuccess } from '@/lib/chat-errors';
import { CHAT_DRAFT_MAX, clearChatDraft, getChatDraft, saveChatDraft } from '@/lib/ios/chat-drafts';
import { ChatErrorLine } from './chat-error-line';
import { getSentenceSend, hasPendingBatch, markPendingBatch, saveSentenceSend } from '@/lib/sentence-send';
import {
  actionVerb,
  buildActionRules,
  buildGroupRichRules,
  cleanBubbleText,
  extractRichActionParts,
  isGroupAdminAction,
  mergeRichSegments,
  parseRichParts,
  prettifyRichText,
  type PendingCardInfo,
  type RichAction,
} from '@/lib/chat-rich';
import { qqUnreads } from '@/lib/unread-store';
import { getMemSettings, memAfterAiTurn, memPurgeMessageSources, memRecallBlock, setMemScopeForApp } from '@/lib/memory';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { useEnterSend, setEnterSend, guardEnterToSend } from '@/lib/enter-send';
import { applyWbUserBlocks, collectWbBlocks, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { buildLocationBlock, locationAiText, locFromRich } from '@/lib/ios/chat-location';
import { useSettings } from '@/lib/ios/store';
import { chatPlaceholder, resolveQuickKeys } from '@/lib/ios/chat-decor';
import { ChatQuickBar, type QuickBarItem } from './chat-quick-bar';
import { pushChatNotification, notifyPreviewText } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, isAiDelivering, markDeliverBoundary, peekPendingMsgs, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, typingDelayOf } from '@/lib/ios/ai-delivery';
import { splitVisionDesc } from '@/lib/vision-client';
import {
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  useChatStream,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { Input } from '@/components/ui/input';

// ---------------- 「文字图片」卡片（E1 轻防御）：群聊照片标签降级管线 ----------------

/**
 * 群聊暂不接生图管线（多成员锁脸归属未实现，与 imggen.ts 头注释「群聊暂不触发」同口径）：
 * 群聊 AI 回复里漏出的 [图片:…] / [照片:…] 标签（提示词未教该标签，但角色人设/世界书/上下文泄漏
 * 可能带出）一律剥除并降级为「文字图片」卡片消息（kind='textcard'），不做真图生成——不管生图配置与否都只出卡片。
 * 挂点：buildGroupReplyMsgs（剥标签+生成卡片）/ deliverSegment+finalize（流式分段 carry-over）/
 * msgTextOf（AI 上下文读卡片文字）/ 渲染分支（复用单聊 TextCardBubble，点击不弹生成面板）。
 */

/** 组件级扩展消息类型：lib WxGroupMsg 的 kind 联合加 'textcard' + card 字段（对齐单聊 wechat/qq.tsx WxMsg 命名）。
 *  本文件内所有 WxGroupMsg 引用均指此扩展类型；lib 层函数经下方读写包装编解码适配。 */
type WxGroupMsg = Omit<WxGroupMsgBase, 'kind'> & {
  kind?: WxGroupMsgBase['kind'] | 'textcard';
  /** 文字图片卡片数据（kind='textcard'）：印在卡片上的文字（AI 降级输出的画面描述），无生图依赖 */
  card?: { text: string };
};

/**
 * textcard 落盘编码前缀：lib 层（groups.ts normalizeMsg）不认识 kind='textcard'——直接落盘会在
 * 下次 load 时被剥成 kind='text' 且 card 字段丢失。约定编码：kind='text' + content=本标记+卡片文字
 * （与会话列表 groupPreview 的「[文字图片] …」摘要口径天然一致）；组件读时由 decodeGroupMsgs 反向还原。
 * 理论碰撞：真实文本消息恰好以「[文字图片]」开头会被误还原成卡片——概率可忽略，后果仅是展示形态变化。
 */
const GROUP_TEXTCARD_MARK = '[文字图片]';

/** 落盘编码：textcard → kind='text' + 标记前缀文本（见 GROUP_TEXTCARD_MARK 注释）；其余消息原样透传 */
function encodeGroupMsgs(msgs: WxGroupMsg[]): WxGroupMsgBase[] {
  return msgs.map(
    (m): WxGroupMsgBase =>
      // 断言安全：此分支运行时已排除 kind='textcard'（TS 属性收窄不覆盖对象整体，需显式收窄）
      m.kind === 'textcard'
        ? { ...m, kind: 'text', content: `${GROUP_TEXTCARD_MARK}${m.card?.text ?? ''}` }
        : (m as WxGroupMsgBase),
  );
}

/** 读取解码：标记前缀文本 → textcard 消息（正文清空、文字进 card.text；空文字也还原，渲染层兜底不显示） */
function decodeGroupMsgs(msgs: WxGroupMsgBase[]): WxGroupMsg[] {
  return msgs.map(
    (m): WxGroupMsg =>
      m.kind === 'text' && m.content.startsWith(GROUP_TEXTCARD_MARK)
        ? { ...m, kind: 'textcard', content: '', card: { text: m.content.slice(GROUP_TEXTCARD_MARK.length) } }
        : m,
  );
}

/** 群消息存取组件级包装：所有读写统一经此编解码（就地替身 lib 导出，既有调用点零改动），
 *  保证 textcard 消息 save/load 往返不丢字段（Task 20-e 第 7 项） */
function loadGroupMsgs(groupId: string): WxGroupMsg[] {
  return decodeGroupMsgs(loadGroupMsgsRaw(groupId));
}
function saveGroupMsgs(groupId: string, msgs: WxGroupMsg[]): void {
  saveGroupMsgsRaw(groupId, encodeGroupMsgs(msgs));
}

/** 群会话 id（未读/标志/隐藏等以字符串 id 为键的设施共用，与微信群同构） */
export const qqGroupRowId = (groupId: string) => `group:${groupId}`;
const sessionKeyOf = (groupId: string) => `qq:group:${groupId}`;

/** 群聊单成员每轮回复条数硬上限（#10/#34）：引擎侧 Math.min(N,5)，信息页展示与设置页加注同口径 */
const GROUP_REPLY_CAP = 5;

/** 群消息语音数据的本地原文（AI 语音消息/文字转语音运行时携带 localText；
 *  WxGroupMsg.voice 的 lib 层同形声明未含该字段，宽松读取避免到处断言） */
const groupVoiceLocalText = (v: WxGroupMsg['voice'] | undefined): string => (v as VoiceMsgData | undefined)?.localText ?? '';

// ---------------- 群红包/转账（纯本地模拟；按群 ID 隔离，与单聊互不相通） ----------------

/** 机主发的红包/转账短 ID（AI 动作标记里引用；格式如 grp-x7k2） */
function nextGroupCid(prefix: 'rp' | 'tr'): string {
  return `grp-${prefix === 'rp' ? 'r' : 't'}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 群红包领取人名单文本（fix3-e③：「（红红、绿绿）」；最多列 5 个名字，超出加「等」——谁领了对 AI 可见并随占位进记忆） */
function rpClaimsNamesText(rp: GroupRpData): string {
  if (rp.claims.length === 0) return '';
  const names = rp.claims.map((c) => c.name).filter(Boolean);
  if (names.length === 0) return '';
  return `（${names.slice(0, 5).join('、')}${names.length > 5 ? '等' : ''}）`;
}

/** 群红包状态标签：待领取 → 部分领取 → 已抢完 / 已过期（与微信侧同规则）；
 *  fix3-e③：已有人领取时附领取人名单（最多 5 个，超出加「等」），不再只给「已领取 1/2」让 AI 猜谁领了 */
function groupRpStateLabel(rp: GroupRpData): string {
  if (rp.expired) return '已过期';
  if (rp.claims.length >= rp.count) return `已抢完${rpClaimsNamesText(rp)}`;
  if (rp.claims.length > 0) return `已领取 ${rp.claims.length}/${rp.count}${rpClaimsNamesText(rp)}`;
  return '待领取';
}

/** 群转账状态标签 */
function groupTrStateLabel(tr: GroupTrData): string {
  if (tr.received) return '已收款';
  if (tr.status === 'returned') return '已退回';
  if (tr.status === 'rejected') return '已拒收';
  return '待收款';
}

/** 拼手气随机拆一份：前 n-1 份在「剩余÷份数×2」内随机（保底 0.01，给后面每份留 0.01），最后一份拿剩余全部 */
function splitLuckyAmount(remaining: number, leftCount: number): number {
  if (leftCount <= 1) return round2(remaining);
  const max = Math.max(0.01, round2(remaining - 0.01 * (leftCount - 1)));
  const amt = round2((remaining * Math.random() * 2) / leftCount);
  return Math.min(max, Math.max(0.01, amt));
}

/** 群红包总额：普通 = 单个金额×个数；拼手气 = 总金额；专属 = 单个金额 */
export function groupRpTotal(mode: GroupRpData['mode'], amount: number, count: number): number {
  return mode === 'normal' ? round2(amount * count) : round2(amount);
}

/** 完整时间：2026年9月19日 20:32:08（群红包/转账详情页领取时间用） */
function fmtGrpFullTime(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function memberNameOf(c: ContactRecord): string {
  return displayNameOf(c);
}

/** 正则元字符转义（@ 提及边界匹配用：成员显示名可能含 . * + 等正则特殊字符） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** AI 自判跳过标记：整条回复只有这个标记时不落盘（不进消息、不提取记忆、不计未读） */
const SKIP_RE = /^\[?\s*(?:SKIP|跳过)\s*\]?$/i;

/**
 * AI 成员发红包/转账节流（同一角色短时间不连续发多次；内存态，按群会话+角色隔离，与微信群同构）：
 * ① 提示词层：冷却期内注入「你刚发过，这轮别再发」规则；② 落盘层：冷却期内/同一轮里多出的
 * 红包/转账卡片直接丢弃（文字部分照常落盘）。与群规则里的「发钱纪律」配套。 */
const AI_MONEY_COOLDOWN_MS = 3 * 60_000;
const aiMoneyAt = new Map<string, number>();
const moneyCooldownKey = (sKey: string, charId: string) => `${sKey}:${charId}`;

/** 剪贴板复制（clipboard API 不可用时回退 execCommand） */
function copyText(text: string, onToast: (m: string) => void): void {
  const done = () => onToast('已复制');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => onToast('复制失败'));
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    onToast('复制失败');
  }
}

/** 气泡上方时间分隔（间隔 >5 分钟才显示） */
function fmtGroupTime(ts: number): string {
  const d = new Date(ts);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

const QUOTE_WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
/** QQ 引用卡时间（对照截图）：今天 → HH:MM；昨天 → 昨天HH:MM；一周内 → 星期XHH:MM；更久 → M月D日HH:MM（跨年带年份） */
function qqQuoteTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天${hm}`;
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  if (ts >= weekAgo.getTime()) return `星期${QUOTE_WEEK_CN[d.getDay()]}${hm}`;
  const y = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日${hm}`;
}

// ---------------- 群 → 单聊转发（与 QQ 单聊同一套存储键 / 感知事件键，单聊 loadMsgs 打开即能读回） ----------------

/** 写入 QQ 单聊消息库的最小消息形状（qq.tsx 的 QQMsg 结构子集；loadMsgs 规范化时按字段兜底） */
export interface QqSingleMsgShape {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind?: 'text' | 'image' | 'sticker' | 'location' | 'forward' | 'voice';
  /** 语音消息数据（kind='voice'；与 VoiceMsgData 同构，qq.tsx loadMsgs 规范化可读回） */
  voice?: VoiceMsgData;
  img?: { src: string };
  loc?: { name: string; addr: string; lat?: number; lng?: number };
  stk?: { url: string; meaning: string };
  quote?: { name: string; content: string };
  fwd?: { from: string; merged?: boolean; title?: string; records?: GroupFwdRecord[] };
}

const qqSingleMsgsKey = (contactId: string) => `qq-chat-msgs:${contactId}`;

/** 读目标单聊消息库（转发落点；结构对齐 qq.tsx loadMsgs 的宽松过滤） */
function loadQqSingleMsgs(contactId: string): QqSingleMsgShape[] {
  try {
    const raw = kvGet<QqSingleMsgShape[]>(qqSingleMsgsKey(contactId));
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => Boolean(m) && typeof m.content === 'string' && (m.role === 'me' || m.role === 'peer'));
  } catch {
    return [];
  }
}

/** 写目标单聊消息库（与 qq.tsx saveMsgs 同键；聊天记录不封顶） */
function saveQqSingleMsgs(contactId: string, msgs: QqSingleMsgShape[]): void {
  try {
    kvSet(qqSingleMsgsKey(contactId), msgs);
  } catch {
    // 存储失败不中断
  }
}

const qqAiEventsKey = (contactId: string) => `qq-ai-events:${contactId}`;

/** 转发落到目标单聊时给目标 AI 排一条感知事件（打开会话即触发 AI 回应；与 qq.tsx pushAiEvent 同键格式） */
function pushQqAiEvent(contactId: string, text: string): void {
  try {
    const parsed = kvGet<string[]>(qqAiEventsKey(contactId));
    const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    arr.push(text);
    kvSet(qqAiEventsKey(contactId), arr.slice(-10));
  } catch {
    // 忽略
  }
}

/** QQ 头像（圆形；无头像时蓝色 Q 占位） */
function QqAvatar({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  const style: React.CSSProperties = { width: size, height: size };
  if (src) {
    return <img src={src} alt={alt} draggable={false} className="shrink-0 rounded-full object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#B9D9F3] font-semibold text-white"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      {alt.slice(0, 1) || 'Q'}
    </div>
  );
}

/** 群头像：自定义头像优先；否则前 4 名成员头像拼贴（QQ 圆角方形同款风格） */
export function QqGroupAvatar({
  group,
  contacts,
  size = 48,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  size?: number;
}) {
  const members = group.memberIds
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is ContactRecord => !!c)
    .slice(0, 4);
  if (group.avatar) {
    return (
      <img
        src={group.avatar}
        alt={`${group.name} 群头像`}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[10px] object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[10px] bg-[#E3E6EB] dark:bg-[#3A3A3A]"
      aria-label={`${group.name} 群头像`}
    >
      {members.length === 0 ? (
        <div className="col-span-2 row-span-2 flex items-center justify-center">
          <Users style={{ width: size * 0.5, height: size * 0.5 }} className="text-white/80" />
        </div>
      ) : (
        <>
          {members.map((m) =>
            m.avatar ? (
              <img key={m.id} src={m.avatar} alt={m.name} className="h-full w-full object-cover" />
            ) : (
              <div key={m.id} className="flex h-full w-full items-center justify-center bg-[#C9D6E4] dark:bg-[#4A4A4A]">
                <span className="text-[10px] font-semibold text-white">{memberNameOf(m).slice(0, 1)}</span>
              </div>
            )
          )}
          {Array.from({ length: 4 - members.length }).map((_, i) => (
            <div key={`pad-${i}`} className="bg-[#EBEEF2] dark:bg-[#333333]" />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------- 通用小件 ----------------

function GroupNavBar({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 shrink-0 border-b border-black/[0.05] bg-[#F5F6F7]/95 pt-[54px] backdrop-blur dark:border-white/[0.06] dark:bg-[#111214]/95">
      <div className="flex h-12 items-center px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
        </button>
        <div className="flex-1 truncate text-center text-[17px] font-semibold">{title}</div>
        <div className="flex min-w-[32px] items-center justify-end">{right}</div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  onClick,
  danger,
  testId,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${onClick ? 'active:bg-black/[0.04] dark:active:bg-white/[0.05]' : 'cursor-default'}`}
    >
      <span className={`text-[15px] ${danger ? 'text-[#F5455C]' : ''}`}>{label}</span>
      <span className="ml-auto flex items-center gap-1 text-[13px] text-black/40 dark:text-white/40">
        {value}
        {onClick && <ChevronRight className="h-4 w-4" />}
      </span>
    </button>
  );
}

function SwitchRow({
  label,
  caption,
  checked,
  onChange,
  testId,
}: {
  label: string;
  caption?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {caption && <div className="mt-0.5 text-[11px] leading-snug text-black/40 dark:text-white/40">{caption}</div>}
      </div>
      <div className="shrink-0">
        <ChatToggle on={checked} onChange={onChange} accent="#0099FF" testId={testId} label={label} />
      </div>
    </div>
  );
}

function CenterDialog({
  title,
  placeholder,
  initial,
  onCancel,
  onSave,
}: {
  title: string;
  placeholder?: string;
  initial?: string;
  onCancel: () => void;
  onSave: (v: string) => void;
}) {
  const [val, setVal] = useState(initial ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onCancel}>
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-[15px] font-medium">{title}</div>
        <Input
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-[10px] bg-black/[0.05] text-[14px] dark:bg-white/10"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(val);
          }}
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-70 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(val)}
            className="h-9 flex-1 rounded-[8px] bg-[#0099FF] text-[14px] font-medium text-white active:opacity-80"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ text, onCancel, onConfirm }: { text: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-10" onClick={onCancel}>
      <div className="w-full rounded-[14px] bg-white dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pb-5 pt-6 text-center text-[15px] leading-relaxed">{text}</div>
        <div className="flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 text-[15px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 border-l border-black/10 py-3 text-[15px] font-medium text-[#F5455C] active:bg-black/[0.04] dark:border-white/10 dark:active:bg-white/[0.06]"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 建群页 ----------------

/** 建群：多选 QQ 好友（CHAR/NPC）+ 群名；至少 1 名成员；人数上限 GROUP_MEMBER_CAP */
export function QqGroupCreatePage({
  contacts,
  onBack,
  onCreated,
  onToast,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onCreated: (g: ChatGroup) => void;
  /** 页内提示（建群规则：成员至少一名、人数上限）；未接时静默 */
  onToast?: (m: string) => void;
}) {
  const toast = onToast ?? (() => {});
  const candidates = useMemo(() => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'qq')), [contacts]);
  const [selected, setSelected] = useState<string[]>([]);
  const [nameDirty, setNameDirty] = useState(false);
  const [name, setName] = useState('');
  const suggested = useMemo(() => {
    const names = selected
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is ContactRecord => !!c)
      .map(memberNameOf);
    if (names.length === 0) return '';
    // 默认群名 = 我的名字 + 成员名字（真实 QQ 同款；人多时截断）
    const meRec = contacts.find((c) => c.kind === 'user' && !c.altOf);
    const all = meRec ? [memberNameOf(meRec), ...names] : names;
    return all.length <= 4 ? all.join('、') : `${all.slice(0, 3).join('、')}等${all.length}人群聊`;
  }, [selected, contacts]);
  const effName = (nameDirty ? name : suggested).trim();

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // 群人数上限（与邀请浮层同一规则）：超出后不可再勾选
      if (prev.length >= GROUP_MEMBER_CAP) {
        toast(`群成员最多 ${GROUP_MEMBER_CAP} 人`);
        return prev;
      }
      return [...prev, id];
    });

  const create = () => {
    const me = contacts.find((c) => c.kind === 'user' && !c.altOf);
    if (!me || selected.length === 0) {
      toast('至少选择一名成员');
      return;
    }
    const g = createGroup({ app: 'qq', name: effName || '未命名群聊', memberIds: selected, ownerId: me.id, creatorName: memberNameOf(me) });
    onCreated(g);
  };

  return (
    <div className="flex h-full flex-col bg-[#F5F6F7] dark:bg-[#111214]">
      <GroupNavBar title="发起群聊" onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-white px-4 py-3 dark:bg-[#1B1C1F]">
          <Input
            value={effName}
            onChange={(e) => {
              setNameDirty(true);
              setName(e.target.value);
            }}
            placeholder="群聊名称（默认为我的名字+成员名字）"
            className="h-10 rounded-[10px] bg-black/[0.05] text-[14px] dark:bg-white/10"
            data-testid="qq-group-name-input"
          />
        </div>
        <div className="mt-2 bg-white dark:bg-[#1B1C1F]">
          <div className="border-b border-black/[0.05] px-4 py-2.5 text-[12px] text-black/45 dark:border-white/[0.06] dark:text-white/45">
            选择群成员（{selected.length} 人）
          </div>
          {candidates.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-black/40 dark:text-white/40">
              还没有 QQ 好友，先去「加好友」吧
            </div>
          )}
          {candidates.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                data-testid={`qq-group-cand-${c.id}`}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
              >
                <QqAvatar src={c.avatar} alt={memberNameOf(c)} size={40} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    on ? 'border-[#0099FF] bg-[#0099FF]' : 'border-black/20 dark:border-white/25'
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white p-3 dark:border-white/[0.06] dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-group-create-btn"
          disabled={selected.length === 0}
          onClick={create}
          className="h-11 w-full rounded-[10px] bg-[#0099FF] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          创建群聊
        </button>
      </div>
    </div>
  );
}

// ---------------- 群聊信息页 ----------------

export function QqGroupInfoPage({
  group,
  contacts,
  onBack,
  onUpdate,
  onQuit,
  onDissolve,
  onToast,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'remark' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => void;
  /** 退出群聊（仅机主本机移除；AI 成员的群记忆保留） */
  onQuit: () => void;
  /** 解散群聊（群对所有人消失；群聊记忆级联清理） */
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  const [dialog, setDialog] = useState<null | { kind: 'name' | 'remark' }>(null);
  // 群公告独立页（对照真 QQ：公告卡片 + 发布/编辑，仅群主/管理员可发布）
  const [annOpen, setAnnOpen] = useState(false);
  const [annEditing, setAnnEditing] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState('');
  // 群管理页（集中的管理入口）：管理员添加 / 取消管理员 / 禁言 / 转让群主
  const [mgmtOpen, setMgmtOpen] = useState<null | 'admin-add' | 'admin-remove' | 'mute' | 'transfer'>(null);
  const [memberSheet, setMemberSheet] = useState<ContactRecord | null>(null);
  // 禁言时长选择单（群主/管理员对目标成员发起）；转让群主确认弹窗
  const [muteSheet, setMuteSheet] = useState<ContactRecord | null>(null);
  const [transferConfirm, setTransferConfirm] = useState<ContactRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [replyCountOpen, setReplyCountOpen] = useState(false);
  // AI 语音频率子页（聊天信息二级页；按群独立保存，成员各自人设音色朗读，无需「他的声音」页）
  const [voiceFreqOpen, setVoiceFreqOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(() => getReplyCount(sessionKeyOf(group.id)));
  const [sentenceOn, setSentenceOn] = useState(() => getSentenceSend(sessionKeyOf(group.id)));
  const gid = group.id;
  /** 群号（建群时分配的唯一 9 位数字；旧群缺省时惰性补发并落盘，保证每个群的群号都不一样） */
  const [groupNo, setGroupNo] = useState<string>(() => group.no ?? '');
  useEffect(() => {
    if (group.no) {
      setGroupNo(group.no);
      return;
    }
    setGroupNo(ensureGroupNo(gid));
  }, [group.no, gid]);
  /** 公告页元信息：发布人（群主显示名）+ 发布时间 */
  const annPublisher = useMemo(() => {
    const o = contacts.find((c) => c.id === group.ownerId);
    return o ? memberNameOf(o) : '群主';
  }, [contacts, group.ownerId]);
  const annDateText = useMemo(() => {
    if (!group.annAt) return '';
    const d = new Date(group.annAt);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [group.annAt]);
  /** 发布/保存群公告（清空内容发布 = 删除公告；数据层自动落「群公告已更新」事件）；
   *  fix3-e①：公告由机主改 → 直接走数据层带 actor（事件归属机主）；空补丁只刷新宿主 */
  const saveNotice = () => {
    const had = Boolean(group.announcement.trim());
    updateGroup(gid, { announcement: noticeDraft.trim() }, { actor: { kind: 'me', name: myActorLabel } });
    setAnnEditing(false);
    onToast(had ? '群公告已更新' : '群公告已发布');
    onUpdate({});
  };
  const [flags, setFlags] = useState<ChatFlags>(() => qqChatFlags.get());
  const [timeAwareOn, setTimeAwareOn] = useState(() => getTimeAware(sessionKeyOf(gid)));
  // 动作描写开关（渲染订阅版：切换后经事件即时刷新聊天页渲染）
  const actionDescOn = useActionDescOn(sessionKeyOf(gid));
  // 深度思考（B1，按群隔离）：渲染订阅版——群设置页切换后聊天页思维链卡片即时刷新
  const deepThinkOn = useDeepThinkOn(sessionKeyOf(gid));
  // 「回车键发送消息」开关（QQ App 级、按账号隔离，群聊与单聊共用；默认开启）
  const enterSend = useEnterSend('qq');
  const fileRef = useRef<HTMLInputElement>(null);
  const [bgOpen, setBgOpen] = useState(false);

  // ---- 聊天背景（按群独立：标志在 qqChatFlags 的 group:<gid> 键，图片本体在 IndexedDB；与单聊互不影响） ----
  const rowFlags = flags[qqGroupRowId(gid)];
  const bgMode = rowFlags?.bgMode ?? 'default';
  const bg: ChatSettingsBg = { mode: bgMode, color: rowFlags?.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('qq', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, rowFlags?.bgV, gid]);

  const handlePickBgColor = (c: string) => {
    qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'color', bgColor: c, bgV: Date.now() });
  };
  const handleResetBg = () => {
    void removeChatBgImage('qq', `group:${gid}`).catch(() => undefined);
    qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'default', bgV: Date.now() });
  };
  const handleUploadBg = async (file: File) => {
    setUploadingBg(true);
    try {
      const data = await readImageFile(file, 1280);
      await setChatBgImage('qq', `group:${gid}`, data);
      qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'image', bgV: Date.now() });
      onToast('聊天背景已更新');
    } catch {
      onToast('图片处理失败，请重试');
    } finally {
      setUploadingBg(false);
    }
  };

  const members = useMemo(
    () => group.memberIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is ContactRecord => !!c),
    [group.memberIds, contacts]
  );
  const candidates = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'qq') && !group.memberIds.includes(c.id)),
    [contacts, group.memberIds]
  );

  // ---- 群角色 / 权限（六.权限规则）：群主全部权限；管理员可禁言/踢人（仅普通成员）；普通成员不能管理他人 ----
  const meRec = useMemo(() => contacts.find((c) => c.kind === 'user' && !c.altOf) ?? null, [contacts]);
  // 称呼方式（全局设置）：机主瓦片显示「凡凡（凑凑）」或「凑凑」
  const addressMode = useSettings((s) => s.addressMode);
  // 机主身份（兼容双键）：挽留流程旧版曾以字面量 'me' 写入 adminIds/ownerId，联系人 ID 查不到时回退 'me' 查一次
  const myRole: GroupMemberRole = meRec
    ? groupRoleOf(group, meRec.id) !== 'member'
      ? groupRoleOf(group, meRec.id)
      : groupRoleOf(group, 'me')
    : 'member';
  const amOwner = myRole === 'owner';
  const amAdmin = myRole === 'admin';
  const canManage = amOwner || amAdmin;
  // fix3-e①：机主操作者标注（群事件 actor/被禁言通知需要机主显示名；与 AI 侧参与成员名单的称呼名同源）
  const myActorLabel = meRec ? addressNameOf(meRec, addressMode) : '机主';
  /** 目标成员能否被我管理（管理员只能管普通成员；群主除自己外都能管） */
  const canManageTarget = (target: ContactRecord): boolean => {
    if (target.id === group.ownerId) return false; // 群主不可被管理
    return amOwner || (amAdmin && groupRoleOf(group, target.id) === 'member');
  };
  /** 群主身份标签（成员瓦片/操作单用） */
  const roleLabelOf = (id: string): string => (group.ownerId === id ? '群主' : group.adminIds.includes(id) ? '管理员' : '');

  useEffect(() => qqChatFlags.subscribe(() => setFlags({ ...qqChatFlags.get() })), []);

  const pickAvatar = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => onToast('读取图片失败');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => onToast('图片解析失败');
      img.onload = () => {
        const SIZE = 240;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        ctx.drawImage(img, (SIZE - img.width * scale) / 2, (SIZE - img.height * scale) / 2, img.width * scale, img.height * scale);
        // fix3-e①：群头像由机主改 → 直接走数据层带 actor（「群头像已更新」事件归属机主）；空补丁只刷新宿主
        updateGroup(gid, { avatar: canvas.toDataURL('image/jpeg', 0.82) }, { actor: { kind: 'me', name: myActorLabel } });
        onUpdate({});
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removeMember = (c: ContactRecord) => {
    setMemberSheet(null);
    setRemoveOpen(false);
    if (members.length <= 1) {
      onToast('至少保留一名成员');
      return;
    }
    // 踢人（三.3/六.3）：群主/管理员才可操作；群主不可被移出；成功后自动落「XX被移出群聊」系统消息
    if (!canManageTarget(c)) {
      onToast(amOwner ? '群主不可被移出' : '管理员只能移出普通成员');
      return;
    }
    // fix3-e①：机主操作 → actor = { kind:'me' }（事件/感知注入知道是机主踢的人）
    const next = kickGroupMember(gid, c.id, {
      name: memberNameOf(c),
      actorName: meRec?.name || '机主',
      actor: { kind: 'me', name: myActorLabel },
    });
    if (next) {
      onToast(`已将 ${memberNameOf(c)} 移出群聊`);
      onUpdate({ memberIds: next.memberIds });
    }
  };

  /** 设为/取消管理员（仅群主；群主本人不可被设）：成功自动落系统消息（三.5）；fix3-e① actor = 机主 */
  const toggleAdmin = (c: ContactRecord, admin: boolean) => {
    setMemberSheet(null);
    if (!amOwner) return;
    const next = setGroupAdmin(gid, c.id, admin, { name: memberNameOf(c), actor: { kind: 'me', name: myActorLabel } });
    if (next) {
      onToast(admin ? `已将 ${memberNameOf(c)} 设为管理员` : `已取消 ${memberNameOf(c)} 的管理员`);
      onUpdate({}); // 空补丁：让宿主刷新群对象（adminIds 已在数据层落盘）
    }
  };

  /** 禁言（带时长；六.5 禁言期间不能发言）：成功自动落「XX被禁言 X」系统消息（三.4）；fix3-e① actor = 机主（写被禁言成员感知通知） */
  const applyMute = (c: ContactRecord, ms: number | null, label: string) => {
    setMuteSheet(null);
    setMemberSheet(null);
    const next = muteGroupMember(gid, c.id, ms, { name: memberNameOf(c), actor: { kind: 'me', name: myActorLabel } });
    if (next) {
      onToast(`已禁言 ${memberNameOf(c)} ${label}`);
      onUpdate({});
    }
  };

  /** 解除禁言：自动落「XX被解除禁言」系统消息（三.4）；fix3-e① actor = 机主（写「禁言已被机主解除」感知通知） */
  const liftMute = (c: ContactRecord) => {
    setMemberSheet(null);
    const next = unmuteGroupMember(gid, c.id, { name: memberNameOf(c), actor: { kind: 'me', name: myActorLabel } });
    if (next) {
      onToast(`已解除 ${memberNameOf(c)} 的禁言`);
      onUpdate({});
    }
  };

  /** 转让群主（仅群主；六.2 只能转让不能取消）：自动落「群主转让给 XX」系统消息（三.6）；确认后返回设置页；fix3-e① actor = 机主 */
  const doTransfer = (c: ContactRecord) => {
    setTransferConfirm(null);
    setMemberSheet(null);
    setMgmtOpen(null);
    const next = transferGroupOwner(gid, c.id, { name: memberNameOf(c), actor: { kind: 'me', name: myActorLabel } });
    if (next) {
      onToast(`群主已转让给 ${memberNameOf(c)}`);
      onUpdate({});
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F5F6F7] dark:bg-[#111214]">
      <GroupNavBar title="聊天信息" onBack={onBack} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickAvatar(f);
          e.target.value = '';
        }}
      />

      {/* 群资料头部卡片（对照真 QQ：大头像 + 群名 + 群号 + 锁定标签） */}
      <div className="mx-3 mt-2 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          className="flex w-full items-center gap-3.5 px-4 py-4 text-left active:opacity-70"
          onClick={() => fileRef.current?.click()}
          data-testid="qq-groupinfo-avatar"
        >
          <QqGroupAvatar group={group} contacts={contacts} size={64} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[19px] font-semibold leading-snug">{group.name}</span>
            <span className="mt-1 block text-[13px] text-black/45 dark:text-white/45">群号：{groupNo}</span>
          </span>
          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" />
        </button>
      </div>

      {/* 群成员卡片（对照真 QQ：圆头像瓦片 + 邀请/移除圆形按钮） */}
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white px-4 py-3.5 dark:bg-[#1B1C1F]">
        <div className="mb-3 flex items-center">
          <span className="text-[16px] font-semibold">群成员</span>
          <span className="ml-auto text-[13px] text-black/35 dark:text-white/35">{members.length + 1}人</span>
        </div>
        <div className="flex flex-wrap gap-x-[13px] gap-y-3">
          {/* 五.1 群成员列表：机主瓦片也在列；排序 = 群主 → 管理员 → 普通成员（机主按身份排位，不再恒居首位）；
              机主瓦片按称呼设置显示「凡凡（凑凑）」（用名字）或「凑凑」（用昵称），成员带群主/管理员身份徽标 */}
          {[...(meRec ? [meRec] : []), ...members]
            .sort((a, b) => {
              // 群主在前、管理员其次、普通成员在后（同角色保持原序；机主按身份参与排序）
              const rank = (id: string) => (group.ownerId === id ? 0 : group.adminIds.includes(id) ? 1 : 2);
              return rank(a.id) - rank(b.id);
            })
            .map((m) => {
              const isMe = meRec != null && m.id === meRec.id;
              const rl = roleLabelOf(m.id);
              return (
                <div
                  key={m.id}
                  className="flex w-[52px] flex-col items-center gap-1"
                  data-testid={isMe ? 'qq-groupinfo-member-me' : `qq-groupinfo-member-${m.id}`}
                  onClick={isMe ? undefined : () => setMemberSheet(m)}
                  role={isMe ? undefined : 'button'}
                >
                  <QqAvatar src={m.avatar} alt={isMe ? meTileLabel(m, addressMode) : memberNameOf(m)} size={48} />
                  <span className="flex max-w-[52px] items-center gap-1 overflow-hidden">
                    <span className="truncate text-[11px] leading-none text-black/50 dark:text-white/50">
                      {isMe ? meTileLabel(m, addressMode) : memberNameOf(m)}
                    </span>
                    {rl && (
                      <span
                        className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                          rl === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#0099FF]/15 text-[#0072C7] dark:text-[#4AA3FF]'
                        }`}
                      >
                        {rl}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          <button
            type="button"
            className="flex w-[52px] flex-col items-center gap-1"
            onClick={() => setInviteOpen(true)}
            data-testid="qq-groupinfo-invite"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F1F2] dark:bg-white/10">
              <Plus className="h-6 w-6 text-black/45 dark:text-white/50" strokeWidth={1.8} />
            </span>
            <span className="text-[11px] leading-none text-black/50 dark:text-white/50">邀请</span>
          </button>
          {canManage && members.length > 0 && (
            <button
              type="button"
              className="flex w-[52px] flex-col items-center gap-1"
              onClick={() => setRemoveOpen(true)}
              data-testid="qq-groupinfo-remove"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F1F2] dark:bg-white/10">
                <Minus className="h-6 w-6 text-black/45 dark:text-white/50" strokeWidth={1.8} />
              </span>
              <span className="text-[11px] leading-none text-black/50 dark:text-white/50">移除</span>
            </button>
          )}
        </div>
      </div>

      {/* 置顶 / 免打扰（上移至成员卡下方首屏；按群独立） */}
      <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
        <SwitchRow
          label="设为置顶"
          checked={flags[qqGroupRowId(gid)]?.pinned === true}
          onChange={(v) => qqChatFlags.update(qqGroupRowId(gid), { pinned: v })}
          testId="qq-groupinfo-pin"
        />
        <SwitchRow
          label="消息免打扰"
          checked={flags[qqGroupRowId(gid)]?.muted === true}
          onChange={(v) => qqChatFlags.update(qqGroupRowId(gid), { muted: v })}
          testId="qq-groupinfo-mute-switch"
        />
      </div>

      {/* 群设置 */}
      <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
        <InfoRow label="群聊名称" value={group.name} onClick={() => setDialog({ kind: 'name' })} testId="qq-groupinfo-name" />
        <InfoRow
          label="备注"
          value={group.remark?.trim() || '未设置'}
          onClick={() => setDialog({ kind: 'remark' })}
          testId="qq-groupinfo-remark"
        />
        <InfoRow
          label="群公告"
          value={group.announcement ? (group.announcement.length > 12 ? `${group.announcement.slice(0, 12)}…` : group.announcement) : '未设置'}
          onClick={() => setAnnOpen(true)}
          testId="qq-groupinfo-notice"
        />
        <button
          type="button"
          data-testid="qq-groupinfo-bg"
          onClick={() => setBgOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
        >
          <span className="shrink-0 text-[15px]">聊天背景</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-[22px] w-[22px] rounded-[5px] border border-black/10 bg-cover bg-center dark:border-white/15"
              style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: '#F5F6F7' }}
            />
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
        <SwitchRow
          label="记忆与私聊互通"
          caption="开启后：群里发生的事，成员在私聊里也记得；成员的私聊记忆也会带进群聊。关闭则完全隔离（按群独立设置）。"
          checked={group.memoryInterop}
          onChange={(v) => {
            onUpdate({ memoryInterop: v });
            onToast(v ? '已开启互通' : '已关闭互通');
          }}
          testId="qq-groupinfo-interop"
        />
      </div>

      {/* 群管理（仅群主/管理员可见；管理员只能禁言，任命/转让仅群主；六.权限规则门控） */}
      {canManage && (
        <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
          <p className="px-4 pb-1 pt-3 text-[12px] text-black/40 dark:text-white/40">群管理</p>
          {amOwner && (
            <InfoRow
              label="管理员添加"
              value={group.adminIds.length > 0 ? `现有 ${group.adminIds.length} 名` : '未设置'}
              onClick={() => setMgmtOpen('admin-add')}
              testId="qq-groupinfo-mgmt-admin-add"
            />
          )}
          {amOwner && (
            <InfoRow
              label="取消管理员"
              value={group.adminIds.length > 0 ? `现有 ${group.adminIds.length} 名` : '无'}
              onClick={() => {
                if (group.adminIds.length === 0) {
                  onToast('当前没有管理员');
                  return;
                }
                setMgmtOpen('admin-remove');
              }}
              testId="qq-groupinfo-mgmt-admin-remove"
            />
          )}
          <InfoRow
            label="禁言"
            value="选成员禁言/解禁"
            onClick={() => setMgmtOpen('mute')}
            testId="qq-groupinfo-mgmt-mute"
          />
          {amOwner && (
            <InfoRow
              label="转让群主"
              value="选一位成员接任"
              onClick={() => setMgmtOpen('transfer')}
              testId="qq-groupinfo-mgmt-transfer"
            />
          )}
        </div>
      )}

      {/* 通用开关卡片（回复条数/分句发送/时间感知；均按群独立） */}
      <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
        <InfoRow
          label="回复条数"
          value={`${Math.min(replyCount, GROUP_REPLY_CAP)} 条`}
          onClick={() => setReplyCountOpen(true)}
          testId="qq-groupinfo-replycount"
        />
        <InfoRow
          label="AI 语音频率"
          value={aiVoiceFreqLabel(getAiVoiceFreq(sessionKeyOf(gid)))}
          onClick={() => setVoiceFreqOpen(true)}
          testId="qq-groupinfo-voice-freq"
        />
        <SwitchRow
          label="分句发送"
          caption="开启后：你连续发的多条消息成员都不回复，把想说的话发完、输入框为空时再点一次「发送」，成员才统一回复"
          checked={sentenceOn}
          onChange={(v) => {
            saveSentenceSend(sessionKeyOf(gid), v);
            setSentenceOn(v);
            if (!v) {
              markPendingBatch(sessionKeyOf(gid), false);
            }
          }}
          testId="qq-groupinfo-sentence"
        />
        <SwitchRow
          label="回车键发送消息"
          checked={enterSend}
          onChange={(v) => setEnterSend('qq', v)}
          testId="qq-groupinfo-enter-send"
        />
        <SwitchRow
          label="时间感知"
          caption="让成员按当前时段与消息间隔感知时间（按群独立）"
          checked={timeAwareOn}
          onChange={(v) => {
            setTimeAware(sessionKeyOf(gid), v);
            setTimeAwareOn(v);
          }}
        />
        <SwitchRow
          label="动作描写"
          caption="开启后成员回复中的动作与情景描写会以灰色小字居中显示；关闭后自动过滤（按群独立）"
          checked={actionDescOn}
          onChange={(v) => {
            saveActionDescOn(sessionKeyOf(gid), v);
          }}
          testId="qq-groupinfo-action-desc"
        />
        {/* B1 群聊深度思考：指令始终注入（成员后台始终思考），开关只控制思维链卡片显隐（与单聊/微信群同口径） */}
        <SwitchRow
          label="深度思考"
          caption="开启后成员回复气泡上方可展开思维链卡片（按群独立）；关闭仅隐藏展示，成员仍会在后台深度思考"
          checked={deepThinkOn}
          onChange={(v) => {
            setDeepThinkOn(sessionKeyOf(gid), v);
          }}
          testId="qq-groupinfo-deep-think"
        />
      </div>

      {/* 危险操作（对照真 QQ：删除聊天记录=蓝、退出/解散群聊=红；退出在上、解散在下） */}
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-groupinfo-clear"
          onClick={() => setConfirmClear(true)}
          className="w-full rounded-[12px] px-4 py-[13px] text-left text-[15px] text-[#0099FF] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          清空聊天记录
        </button>
      </div>
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-groupinfo-quit"
          onClick={() => setConfirmQuit(true)}
          className="w-full rounded-[12px] px-4 py-[13px] text-left text-[15px] text-[#F5455C] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          退出群聊
        </button>
      </div>
      {/* #23 解散群聊仅群主可见：群主转让给 AI 后普通成员机主不再能一键解散全群（数据层不校验，UI 门控）；
          非群主用「退出群聊」复用既有退群路径（仅本机删除，群与 AI 成员保留） */}
      {amOwner && (
        <div className="mx-3 mt-2.5 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
          <button
            type="button"
            data-testid="qq-groupinfo-dissolve"
            onClick={() => setConfirmDissolve(true)}
            className="w-full rounded-[12px] px-4 py-[13px] text-left text-[15px] text-[#F5455C] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            解散群聊
          </button>
        </div>
      )}
      <div className="py-7 text-center text-[11px] text-black/30 dark:text-white/30">
        群聊为本地模拟，不含任何真实资金操作
      </div>

      {/* 成员操作（五.2-6：管理员/禁言/解禁/踢人/转让群主，按身份出按钮；六.权限规则门控） */}
      {memberSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-3 py-2">
              <QqAvatar src={memberSheet.avatar} alt={memberNameOf(memberSheet)} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[15px]">
                  <span className="truncate">{memberNameOf(memberSheet)}</span>
                  {roleLabelOf(memberSheet.id) && (
                    <span
                      className={`shrink-0 rounded-[3px] px-1 text-[10px] leading-[16px] ${
                        roleLabelOf(memberSheet.id) === '群主'
                          ? 'bg-[#FA9D3B]/15 text-[#D07818]'
                          : 'bg-[#0099FF]/15 text-[#0072C7] dark:text-[#4AA3FF]'
                      }`}
                    >
                      {roleLabelOf(memberSheet.id)}
                    </span>
                  )}
                </div>
                {groupMuteLeftText(group, memberSheet.id) && (
                  <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#F5455C]" data-testid="qq-groupinfo-mute-status">
                    <MicOff className="h-3 w-3" />
                    禁言中：{groupMuteLeftText(group, memberSheet.id)}
                  </div>
                )}
              </div>
            </div>
            {/* 设为/取消管理员（仅群主；群主本人不可被设） */}
            {amOwner && memberSheet.id !== group.ownerId && (
              <button
                type="button"
                data-testid="qq-groupinfo-toggle-admin"
                onClick={() => toggleAdmin(memberSheet, !group.adminIds.includes(memberSheet.id))}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Shield className="h-4 w-4" />
                {group.adminIds.includes(memberSheet.id) ? '取消管理员' : '设为管理员'}
              </button>
            )}
            {/* 禁言（群主：除自己外都能禁；管理员：仅普通成员） */}
            {canManageTarget(memberSheet) && !groupMuteLeftText(group, memberSheet.id) && (
              <button
                type="button"
                data-testid="qq-groupinfo-mute"
                onClick={() => setMuteSheet(memberSheet)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#D07818] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <MicOff className="h-4 w-4" />
                禁言
              </button>
            )}
            {/* 解除禁言 */}
            {canManageTarget(memberSheet) && groupMuteLeftText(group, memberSheet.id) && (
              <button
                type="button"
                data-testid="qq-groupinfo-unmute"
                onClick={() => liftMute(memberSheet)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#0C8B4D] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Mic className="h-4 w-4" />
                解除禁言
              </button>
            )}
            {/* 转让群主（仅群主；六.2 只能转让不能取消） */}
            {amOwner && memberSheet.id !== group.ownerId && (
              <button
                type="button"
                data-testid="qq-groupinfo-transfer"
                onClick={() => {
                  setTransferConfirm(memberSheet);
                  setMemberSheet(null);
                }}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#D07818] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Crown className="h-4 w-4" />
                转让群主
              </button>
            )}
            {/* 移出群聊（群主：除自己外；管理员：仅普通成员） */}
            {canManageTarget(memberSheet) && (
              <button
                type="button"
                data-testid="qq-groupinfo-remove-member"
                onClick={() => removeMember(memberSheet)}
                className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#F5455C] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <UserMinus className="h-4 w-4" />
                移出群聊
              </button>
            )}
            {!canManageTarget(memberSheet) && !amOwner && (
              <p className="px-3 pb-1 pt-2 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                你是普通成员，不能管理其他成员
              </p>
            )}
          </div>
        </div>
      )}

      {/* 禁言时长选择单（10 分钟 / 1 小时 / 3 小时 / 1 天 / 永久）：z-[60] 保证在群管理选择页之上立即弹出 */}
      {muteSheet && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={() => setMuteSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
            <p className="px-3 py-2 text-[13px] text-black/45 dark:text-white/45">
              禁言 {memberNameOf(muteSheet)}（禁言期间不能在群里发言）
            </p>
            {GROUP_MUTE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                data-testid={`qq-groupinfo-mute-${p.ms === null ? 'forever' : p.ms}`}
                onClick={() => applyMute(muteSheet, p.ms, p.label)}
                className="flex w-full items-center justify-between rounded-[10px] px-3 py-3 text-left text-[15px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span>{p.label}</span>
                {p.ms === null && <span className="text-[12px] text-[#F5455C]">直到解除</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 转让群主确认：z-[60] 保证在群管理选择页之上立即弹出（与禁言时长单同款修复）；确认后返回设置页 */}
      {transferConfirm && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-8" onClick={() => setTransferConfirm(null)}>
          <div className="w-full max-w-[300px] rounded-[14px] bg-white p-5 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">转让群主</p>
            <p className="mt-2 text-[13px] leading-relaxed text-black/55 dark:text-white/55">
              确定把群主转让给「{memberNameOf(transferConfirm)}」吗？转让后你将成为普通成员。
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setTransferConfirm(null)}
                className="h-10 flex-1 rounded-[8px] bg-black/5 text-[14px] dark:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-groupinfo-transfer-confirm"
                onClick={() => doTransfer(transferConfirm)}
                className="h-10 flex-1 rounded-[8px] bg-[#0099FF] text-[14px] font-medium text-white active:opacity-80"
              >
                确认转让
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 群管理选择页（集中管理入口）：管理员添加 / 取消管理员 / 禁言 / 转让群主；操作复用数据层同款函数（自动落系统消息） */}
      {mgmtOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]">
          <GroupNavBar
            title={mgmtOpen === 'admin-add' ? '管理员添加' : mgmtOpen === 'admin-remove' ? '取消管理员' : mgmtOpen === 'mute' ? '禁言成员' : '转让群主'}
            onBack={() => setMgmtOpen(null)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="px-8 py-3 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">
              {mgmtOpen === 'admin-add' && '点击普通成员将其设为管理员（仅群主）'}
              {mgmtOpen === 'admin-remove' && '点击管理员取消其管理员身份（仅群主）'}
              {mgmtOpen === 'mute' && '点击成员进行禁言（可选时长）；已禁言成员可直接解除'}
              {mgmtOpen === 'transfer' && '点击成员把群主转让给 TA，转让后你将成为普通成员'}
            </p>
            <div className="mx-3 mt-1 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
              {(mgmtOpen === 'admin-add'
                ? members.filter((m) => groupRoleOf(group, m.id) === 'member')
                : mgmtOpen === 'admin-remove'
                  ? members.filter((m) => groupRoleOf(group, m.id) === 'admin')
                  : mgmtOpen === 'mute'
                    ? members.filter((m) => canManageTarget(m))
                    : members.filter((m) => m.id !== group.ownerId)
              ).map((m) => {
                const mutedLeft = groupMuteLeftText(group, m.id);
                return (
                  <div key={m.id} className="flex w-full items-center gap-3 px-4 py-2.5">
                    <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">{memberNameOf(m)}</p>
                      {mgmtOpen === 'mute' && mutedLeft && (
                        <p className="mt-0.5 text-[12px] text-[#F5455C]">禁言中：{mutedLeft}</p>
                      )}
                    </div>
                    {mgmtOpen === 'admin-add' && (
                      <button
                        type="button"
                        data-testid={`qq-groupinfo-mgmt-add-${m.id}`}
                        onClick={() => toggleAdmin(m, true)}
                        className="shrink-0 rounded-[8px] bg-[#0099FF]/10 px-3 py-1.5 text-[13px] text-[#0072C7] active:opacity-70"
                      >
                        设为管理员
                      </button>
                    )}
                    {mgmtOpen === 'admin-remove' && (
                      <button
                        type="button"
                        data-testid={`qq-groupinfo-mgmt-remove-${m.id}`}
                        onClick={() => toggleAdmin(m, false)}
                        className="shrink-0 rounded-[8px] bg-[#F5455C]/10 px-3 py-1.5 text-[13px] text-[#F5455C] active:opacity-70"
                      >
                        取消管理员
                      </button>
                    )}
                    {mgmtOpen === 'mute' && (
                      mutedLeft ? (
                        <button
                          type="button"
                          data-testid={`qq-groupinfo-mgmt-unmute-${m.id}`}
                          onClick={() => liftMute(m)}
                          className="shrink-0 rounded-[8px] bg-[#0099FF]/10 px-3 py-1.5 text-[13px] text-[#0072C7] active:opacity-70"
                        >
                          解除禁言
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid={`qq-groupinfo-mgmt-mute-${m.id}`}
                          onClick={() => setMuteSheet(m)}
                          className="shrink-0 rounded-[8px] bg-[#FA9D3B]/10 px-3 py-1.5 text-[13px] text-[#D07818] active:opacity-70"
                        >
                          禁言
                        </button>
                      )
                    )}
                    {mgmtOpen === 'transfer' && (
                      <button
                        type="button"
                        data-testid={`qq-groupinfo-mgmt-transfer-${m.id}`}
                        onClick={() => setTransferConfirm(m)}
                        className="shrink-0 rounded-[8px] bg-[#FA9D3B]/10 px-3 py-1.5 text-[13px] text-[#D07818] active:opacity-70"
                      >
                        转让给 TA
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 移除成员（－ 入口） */}
      {removeOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]">
          <GroupNavBar title="移除成员" onBack={() => setRemoveOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-3 mt-2 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-group-remove-${m.id}`}
                  onClick={() => removeMember(m)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10">
                    <Minus className="h-4 w-4 text-black/45 dark:text-white/50" />
                  </span>
                </button>
              ))}
            </div>
            <div className="px-8 py-10 text-center text-[12px] text-black/35 dark:text-white/35">点击成员将其移出群聊（至少保留一名）</div>
          </div>
        </div>
      )}

      {/* 邀请成员 */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]">
          <GroupNavBar title="邀请成员" onBack={() => setInviteOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-8 py-20 text-center text-[13px] text-black/40 dark:text-white/40">没有可邀请的 QQ 好友</div>
            ) : (
              <div className="bg-white dark:bg-[#1B1C1F]">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`qq-group-invite-${c.id}`}
                    onClick={() => {
                      // 三.1：入群自动落「XX加入了群聊」系统消息（事件在数据层 addGroupMember 内生成）；
                      // fix3-e②：机主邀请 → 事件文案带邀请人（「{机主名}邀请{成员}加入了群聊」，AI 感知可还原是谁拉进来的）
                      const next = addGroupMember(gid, c.id, {
                        name: memberNameOf(c),
                        eventText: `${myActorLabel}邀请${memberNameOf(c)}加入了群聊`,
                      });
                      if (!next) {
                        onToast(`群成员已达上限（${GROUP_MEMBER_CAP} 人）`);
                        return;
                      }
                      onUpdate({ memberIds: next.memberIds });
                      onToast(`已邀请 ${memberNameOf(c)}`);
                      setInviteOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
                  >
                    <QqAvatar src={c.avatar} alt={memberNameOf(c)} size={40} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                    <UserPlus className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'name' && (
        <CenterDialog
          title="群聊名称"
          initial={group.name}
          onCancel={() => setDialog(null)}
          onSave={(v) => {
            const t = v.trim();
            // fix3-e①：群名由机主改 → 直接走数据层带 actor（「群名被修改为…」事件归属机主）；空补丁只刷新宿主
            if (t) updateGroup(gid, { name: t }, { actor: { kind: 'me', name: myActorLabel } });
            if (t) onUpdate({});
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'remark' && (
        <CenterDialog
          title="群备注"
          initial={group.remark ?? ''}
          placeholder="仅自己可见，保存后聊天界面优先显示备注"
          onCancel={() => setDialog(null)}
          onSave={(v) => {
            onUpdate({ remark: v.trim() });
            setDialog(null);
            onToast(v.trim() ? '备注已保存' : '备注已清除');
          }}
        />
      )}
      {/* 群公告独立页（对照真 QQ：公告卡片视图 + 全页编辑；仅群主/管理员可发布，入口在上方「群公告」行） */}
      {annOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]" data-testid="qq-group-notice-page">
          <GroupNavBar
            title="群公告"
            onBack={() => {
              setAnnOpen(false);
              setAnnEditing(false);
            }}
            right={
              canManage ? (
                annEditing ? (
                  <button
                    type="button"
                    data-testid="qq-group-notice-save"
                    onClick={saveNotice}
                    className="text-[15px] font-medium text-[#0099FF] active:opacity-60"
                  >
                    发布
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="qq-group-notice-edit"
                    onClick={() => {
                      setNoticeDraft(group.announcement);
                      setAnnEditing(true);
                    }}
                    className="text-[15px] font-medium text-[#0099FF] active:opacity-60"
                  >
                    {group.announcement ? '编辑' : '发布'}
                  </button>
                )
              ) : undefined
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
            {annEditing ? (
              <>
                <div className="rounded-[12px] bg-white p-3.5 dark:bg-[#1B1C1F]">
                  <textarea
                    data-testid="qq-group-notice-input"
                    value={noticeDraft}
                    maxLength={500}
                    onChange={(e) => setNoticeDraft(e.target.value)}
                    rows={9}
                    placeholder="写入群公告：置顶须知、群规、本周安排…成员会在群聊语境里看到（AI 回复时也会参考）"
                    className="w-full resize-none bg-transparent text-[15.5px] leading-[1.7] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
                  />
                </div>
                <p className="px-1 pt-2 text-right text-[12px] text-black/35 dark:text-white/35">{noticeDraft.length}/500</p>
                <p className="px-1 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
                  群公告会注入每个成员的聊天语境，让群聊更有真实感；清空内容并点「发布」即可删除公告。
                </p>
              </>
            ) : group.announcement ? (
              <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1B1C1F]" data-testid="qq-group-notice-card">
                <div className="flex items-center gap-2.5 bg-gradient-to-r from-[#0099FF]/12 to-transparent px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#0099FF] text-white">
                    <Megaphone className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">群公告</p>
                    <p className="mt-0.5 text-[11.5px] text-black/40 dark:text-white/40">
                      {annPublisher} 发布{annDateText ? ` · ${annDateText}` : ''}
                    </p>
                  </div>
                </div>
                <p
                  className="whitespace-pre-wrap break-words px-4 pb-4 pt-1 text-[15.5px] leading-[1.75] text-black/80 dark:text-white/85"
                  data-testid="qq-group-notice-content"
                >
                  {group.announcement}
                </p>
              </div>
            ) : (
              <div className="pt-24 text-center" data-testid="qq-group-notice-empty">
                <Megaphone className="mx-auto h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} />
                <p className="mt-3 text-[14px] text-black/40 dark:text-white/40">暂无公告</p>
                <p className="mt-1 text-[12px] text-black/30 dark:text-white/30">
                  {canManage ? '点右上角「发布」写一条群公告' : '群主/管理员发布后会在群里通知'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          text="确定清空该群的聊天记录？"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            saveGroupMsgs(gid, []);
            setConfirmClear(false);
            onToast('已清空');
            onUpdate({});
          }}
        />
      )}
      {confirmQuit && (
        <ConfirmDialog
          text="退出后将删除本机的群聊记录，并不再接收此群消息，确定退出？"
          onCancel={() => setConfirmQuit(false)}
          onConfirm={() => {
            setConfirmQuit(false);
            onQuit();
          }}
        />
      )}
      {confirmDissolve && (
        <ConfirmDialog
          text="解散后所有成员都将退出该群，聊天记录与群聊记忆将被删除，确定解散？"
          onCancel={() => setConfirmDissolve(false)}
          onConfirm={() => {
            setConfirmDissolve(false);
            onDissolve();
          }}
        />
      )}

      {/* 聊天背景页（与单聊同一套 ChatBgPage；按群隔离持久化，与单聊背景互不影响） */}
      {bgOpen && (
        <div className="fixed inset-0 z-50">
          <ChatBgPage
            variant="qq"
            bg={bg}
            bgImageUrl={bgImageUrl}
            uploading={uploadingBg}
            onBack={() => setBgOpen(false)}
            onPickColor={handlePickBgColor}
            onPickImageFile={(f) => void handleUploadBg(f)}
            onResetBg={handleResetBg}
          />
        </div>
      )}

      {/* 回复条数页（聊天信息二级页；按群独立，与单聊互不影响；#34 groupMode 群语义：高档位按每轮 5 条生效） */}
      {replyCountOpen && (
        <div className="fixed inset-0 z-50">
          <ChatReplyCountPage
            variant="qq"
            value={replyCount}
            groupMode
            onBack={() => setReplyCountOpen(false)}
            onSelect={(n) => {
              saveReplyCount(sessionKeyOf(gid), n);
              setReplyCount(n);
              setReplyCountOpen(false);
              onToast(`回复条数已设为 ${n} 条`);
            }}
          />
        </div>
      )}

      {/* AI 语音频率页（聊天信息二级页；按群独立保存，命中频率时成员回复的第一条文字升级为语音气泡） */}
      {voiceFreqOpen && (
        <div className="fixed inset-0 z-50">
          <ChatVoiceFreqPage
            variant="qq"
            value={getAiVoiceFreq(sessionKeyOf(gid))}
            onBack={() => setVoiceFreqOpen(false)}
            onSelect={(f) => {
              saveAiVoiceFreq(sessionKeyOf(gid), f);
              setVoiceFreqOpen(false);
              onToast(`AI 语音频率：${aiVoiceFreqLabel(f)}`);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- 群聊页 ----------------

/** QQ 风格群红包详情页：红色头 + 领取列表（谁领了多少、手气）+ 过期/专属状态（复用单聊详情页视觉语言） */
function GroupRpDetailPage({
  senderName,
  senderAvatar,
  rp,
  onBack,
  onToast,
  resolveClaimAvatar,
}: {
  senderName: string;
  senderAvatar: string | null;
  rp: GroupRpData;
  onBack: () => void;
  onToast: (m: string) => void;
  /** 领取记录头像实时读取（可选）：快照 → 成员/机主当前头像（换头像立即同步） */
  resolveClaimAvatar?: (c: { contactId: string; name: string; avatar: string | null }) => string | null;
}) {
  const claimedSum = round2(rp.claims.reduce((s, c) => s + c.amount, 0));
  const best = rp.claims.length > 1 ? rp.claims.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-rp-detail">
      <div className="relative shrink-0 bg-[#F5455C] pt-[54px] text-white">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-grp-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="flex-1 pr-8 text-center text-[16px] font-medium">红包详情</div>
        </div>
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[26px] w-[140%] -translate-x-1/2 rounded-[50%] bg-[#F5F6F8] dark:bg-[#16171A]"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-12">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full border-2 border-[#F0C87E]/85 p-[2px]">
            <QqAvatar src={senderAvatar} alt={senderName} size={40} />
          </span>
          <span className="text-[19px] font-medium" data-testid="qq-grp-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2 text-[14px] text-black/45 dark:text-white/45">{rp.blessing}</p>
        <p className="mt-1.5 text-[13px] text-[#D8A244]" data-testid="qq-grp-rp-detail-status">
          {rp.mode === 'exclusive' && rp.targetName ? `专属红包 · 只给${rp.targetName} · ` : ''}
          {groupRpStateLabel(rp)}
        </p>
        <p className="mt-7 font-semibold text-[#D8A244]" data-testid="qq-grp-rp-detail-amount">
          <span className="text-[44px] leading-none">{fmtMoney(groupRpTotal(rp.mode, rp.amount, rp.count))}</span>
          <span className="ml-1.5 text-[19px]">元</span>
        </p>

        <div className="mt-8 w-[88%] max-w-[360px] rounded-[12px] bg-white dark:bg-[#232529]" data-testid="qq-grp-rp-claim">
          <p className="px-4 pb-2 pt-3.5 text-[12px] text-black/40 dark:text-white/40" data-testid="qq-grp-rp-claim-caption">
            {rp.count}个红包共{fmtMoney(groupRpTotal(rp.mode, rp.amount, rp.count))}元，已领取{rp.claims.length}/{rp.count}
            {rp.expired ? `，已退回${fmtMoney(round2(groupRpTotal(rp.mode, rp.amount, rp.count) - claimedSum))}元` : ''}
          </p>
          {rp.claims.length > 0 ? (
            <div className="pb-2">
              {rp.claims.map((c, i) => (
                <div key={`${c.contactId}-${i}`} className="flex items-center gap-3 border-t border-black/[0.05] px-4 py-3 dark:border-white/[0.06]">
                  <QqAvatar src={resolveClaimAvatar ? resolveClaimAvatar(c) : c.avatar} alt={c.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">
                      {c.name}
                      {best && best.amount === c.amount && best.ts === c.ts ? <span className="ml-1 text-[11px] text-[#D8A244]">手气最佳</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35">{fmtGrpFullTime(c.ts || Date.now())}</span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium text-[#D8A244]">¥{fmtMoney(c.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 pb-8 pt-6 text-center text-[13px] text-black/30 dark:text-white/30">
              {rp.expired ? '红包已过期，未领取金额已退回发起人' : '等待领取…'}
            </p>
          )}
        </div>
        <button type="button" onClick={() => onToast('红包记录暂未开放')} className="mt-5 text-[13px] text-[#0099FF] active:opacity-60">
          查看领取记录 &gt;
        </button>
      </div>
    </div>
  );
}

/** 群转账详情页状态文案（收款人是机主时用「你」） */
function groupTrStatusText(tr: GroupTrData): string {
  if (tr.received) return tr.toId === 'me' ? '你已收款' : `${tr.toName}已收款`;
  const status = groupTrStateLabel(tr);
  if (status === '已退回' || status === '已拒收') return status;
  return tr.toId === 'me' ? '待你收款' : `待${tr.toName}收款`;
}

/** QQ 风格群转账详情页：转账给群里某位成员 + 收款/退回/拒收状态（复用单聊详情页视觉语言）；
 *  收款人是机主且待收款时开放「收款/退还」操作（成员转账给机主的场景） */
function GroupTrDetailPage({
  tr,
  fromName,
  onBack,
  canAct = false,
  onReceive,
  onReturn,
}: {
  tr: GroupTrData;
  fromName: string;
  onBack: () => void;
  canAct?: boolean;
  onReceive?: () => void;
  onReturn?: () => void;
}) {
  const status = groupTrStateLabel(tr);
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-tr-detail">
      <div className="shrink-0 bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-grp-tr-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="flex-1 pr-8 text-center text-[16px] font-medium">转账详情</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pt-8">
        <div className="w-full max-w-[380px] rounded-[16px] bg-white px-5 py-6 dark:bg-[#232529]" data-testid="qq-grp-tr-detail-card">
          <div className="flex items-center gap-3.5">
            <span
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full"
              style={{ background: 'linear-gradient(135deg, #29ABF2, #0099FF)' }}
              aria-hidden="true"
            >
              <ArrowLeftRight className="h-6 w-6 text-white" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[25px] font-semibold leading-tight" data-testid="qq-grp-tr-detail-amount">¥{fmtMoney(tr.amount)}</p>
              <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-grp-tr-detail-status">
                {groupTrStatusText(tr)}
              </p>
            </div>
          </div>
          {tr.note ? <p className="mt-4 border-t border-black/[0.05] pt-3 text-[14px] text-black/70 dark:border-white/[0.06] dark:text-white/70">留言：{tr.note}</p> : null}
          <div className="mt-4 space-y-2.5 border-t border-black/[0.05] pt-3 text-[13px] dark:border-white/[0.06]">
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">转账人</span>
              <span>{fromName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">收款成员</span>
              <span data-testid="qq-grp-tr-detail-to">{tr.toName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">状态</span>
              <span>{status}</span>
            </p>
          </div>
          {canAct ? (
            <div className="mt-5 flex gap-3 border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
              <button
                type="button"
                data-testid="qq-grp-tr-detail-return"
                onClick={onReturn}
                className="h-10 flex-1 rounded-full border border-black/15 text-[15px] text-black/75 active:bg-black/[0.04] dark:border-white/20 dark:text-white/75 dark:active:bg-white/[0.06]"
              >
                退还
              </button>
              <button
                type="button"
                data-testid="qq-grp-tr-detail-receive"
                onClick={onReceive}
                className="h-10 flex-1 rounded-full bg-[#0099FF] text-[15px] font-medium text-white active:brightness-95"
              >
                收款
              </button>
            </div>
          ) : null}
        </div>
        <p className="pt-6 text-center text-[12px] text-black/35 dark:text-white/35">群里其他成员只看到转账卡片，无法操作这笔转账</p>
      </div>
    </div>
  );
}

/**
 * 群聊页。群回合引擎（多角色顺序流式回复）：
 * - runningRef 防重入；每个角色 await 一次 beginChatStream→finalize 的完整回合；
 * - 流式气泡头像/名字由 groupSpeaker 模块级 map 提供（页面中途退出重进也能对上发言角色）；
 * - finalize 里 loadGroupMsgs→append→saveGroupMsgs（组件卸载后照样落盘）+ 未读 + 记忆提取；
 * - 谁来回复按人设自判：被 @ 成员必答优先，其余成员逐个自判（[SKIP] 回复不落盘）；
 */
let activeGroupKey: string | null = null;
const groupSpeaker = new Map<string, string>();

// #27 AI 成员 @ 级联节流（模块态，双端同构）：groupCascadeAt 记录同群同成员上次被级联必答的时间
// （5 分钟冷却，防用户消息回合与级联回合叠加刷屏）；groupCascadeDepth>0 表示正处于级联触发的回合，
// 禁止再级联（防 A@B → B@C → … 无限链）。
const GROUP_CASCADE_COOLDOWN_MS = 5 * 60_000;
const groupCascadeAt = new Map<string, number>();
let groupCascadeDepth = 0;

export function QqGroupChatPage({
  group,
  me,
  contacts,
  ownerLabelOf,
  onBack,
  onUpdate,
  onOpenInfo,
  onQuit,
  onDissolve,
  onToast,
}: {
  group: ChatGroup;
  me: { id: string; name: string; realName?: string | null; nickname?: string | null; avatar: string | null };
  contacts: ContactRecord[];
  /** NPC 归属者名解析（人设 prompt 用） */
  ownerLabelOf: (peer: ContactRecord) => string | null;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'memberIds' | 'memoryInterop'>>) => void;
  onOpenInfo: () => void;
  /** 退出群聊（仅机主本机移除） */
  onQuit: () => void;
  /** 解散群聊（群对所有人消失） */
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  const gid = group.id;
  const sKey = sessionKeyOf(gid);
  // 动作描写开关（渲染订阅版：群设置页切换后经事件即时刷新渲染）
  const actionDescOn = useActionDescOn(sKey);
  // 深度思考（B1，按群隔离）：思维链卡片渲染开关（指令始终注入，开关只控制展示——与单聊/微信群同口径）
  const grpThinkOn = useDeepThinkOn(sKey);
  // 「回车键发送消息」开关（QQ App 级、按账号隔离，群聊与单聊共用；默认开启=回车发送，关闭=回车换行）
  const enterSend = useEnterSend('qq');
  // 退出群聊页/切群：停止 TTS 朗读与语音气泡播放并释放播放器（单例，防跨群串音）
  useEffect(() => () => {
    stopSpeaking();
    stopVoicePlayback();
  }, [gid]);
  // Task 40：语音气泡播放失败 → toast（voice-player 无 UI，经全局事件解耦；onToast 走 ref 保持监听器稳定）
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  useEffect(() => {
    const fn = (e: Event) => onToastRef.current((e as CustomEvent<string>).detail || '语音播放失败，请稍后重试');
    window.addEventListener(VOICE_PLAY_ERROR_EVENT, fn);
    return () => window.removeEventListener(VOICE_PLAY_ERROR_EVENT, fn);
  }, []);
  const [msgs, setMsgs] = useState<WxGroupMsg[]>(() => loadGroupMsgs(gid));
  // 存储侧追加（后台落盘的事件/开场白）→ 广播后即时重读（与微信同构）
  useEffect(() => {
    const fn = (e: Event) => {
      const gid2 = (e as CustomEvent<{ gid?: string }>).detail?.gid;
      if (gid2 && gid2 !== gid) return;
      setMsgs(loadGroupMsgs(gid));
    };
    window.addEventListener('group-msgs:updated', fn);
    return () => window.removeEventListener('group-msgs:updated', fn);
  }, [gid]);
  // Task 40 草稿箱：输入框草稿按群持久化（惰性恢复历史草稿；输入即存、发送清空；超长截断提示节流）
  const [draft, setDraft] = useState(() => getChatDraft('qq-group', gid));
  /** 草稿超长截断 toast 的节流时间戳（同一串超长输入不连环弹） */
  const draftTruncAtRef = useRef(0);
  /** 内置表情插入输入框（不直接发送）：真实表情图插到光标处，可与文字混排一起发送（真机 QQ 交互） */
  const insertBuiltinEmoji = (s: Sticker) => {
    inputRef.current?.insertEmoji(s.meaning, s.url);
  };
  const [quote, setQuote] = useState<{ name: string; content: string; id?: string; time?: number } | null>(null);
  const [atOpen, setAtOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [compose, setCompose] = useState<'location' | null>(null);
  // 群红包/转账浮层流程：发红包页（复用单聊 RedPacketCompose）/ 转账选人页→转账页（复用单聊 TransferCompose）/ 开箱 / 详情
  const [layer, setLayer] = useState<
    | null
    | { view: 'rp-compose' }
    | { view: 'tr-pick' }
    | { view: 'tr-compose'; member: ContactRecord }
    | { view: 'rp-open'; msgId: string }
    | { view: 'rp-detail'; msgId: string }
    | { view: 'tr-detail'; msgId: string }
  >(null);
  // 支付密码验证中的支付（与单聊同规则）
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; label: string; amount: number; methodId: string; packet?: MsgPacket; tr?: { member: ContactRecord; amount: number; note: string } }>(null);
  // 分句发送（按群独立；开启后连发消息不触发回复，空输入点「发送」统一触发）
  const [sentenceSend, setSentenceSend] = useState(() => getSentenceSend(sKey));
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sKey));
  // 语音输入模式：输入框替换为「按住 说话」胶囊（工具栏麦克风钮切换）
  const [voiceMode, setVoiceMode] = useState(false);
  // 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用）
  const [ttsSend, setTtsSend] = useState(false);
  // 发图预览暂存：相机/相册选图先读图压缩进输入框下方预览条（不直接发出），点「发送(N)」才上屏并触发群回合
  const [pendingImgs, setPendingImgs] = useState<Array<{ id: string; src: string }>>([]);
  const [speakerId, setSpeakerId] = useState<string | null>(() => groupSpeaker.get(sKey) ?? null);
  const stream = useChatStream(sKey);
  const apiConfig = useSettings((s) => s.apiConfig);
  const runningRef = useRef(false);
  /** 排队回复标记：回合进行中用户又发了消息 → 本回合结束后自动再起一轮 */
  const groupQueuedRef = useRef(false);
  // Task 40「错误提示优化」：失败提示行「隐藏这条提示」的内存态（重挂载/刷新后恢复显示）
  const [hiddenFails, setHiddenFails] = useState<Set<string>>(() => new Set());
  // Task 40：成员回合流失败的原始错误中转（runCharTurn finalize 写入 → runGroupTurn 收口分类/记录；
  // 不改 resolve('error') 的取值语义，regenerate/级联等既有消费点零扰动）
  const lastTurnErrRef = useRef('');
  /** 群回合触发器（语音消息转写完成后的补跑用：经 ref 调最新回合，避免闭包旧状态/旧配置） */
  const runGroupTurnRef = useRef<(trigger?: WxGroupMsg) => void>(() => undefined);
  /** 文字转语音发送（定义在下方；send 在前引用 → 同 runGroupTurnRef 的 ref 模式） */
  const sendTextAsVoiceRef = useRef<(t: string) => void>(() => undefined);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatRichInputHandle | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const groupRef = useRef(group);
  groupRef.current = group;
  // 机主全部可识别名字（真名/展示名/昵称/「我」「机主」）：AI 管理标记与转账收款对象的目标解析共用
  const meVariants = useMemo(
    () => [...new Set([me.name, me.realName ?? '', me.nickname ?? '', '我', '机主'].map((v) => v.trim()).filter(Boolean))],
    [me.name, me.realName, me.nickname]
  );

  // 长按菜单
  const [menu, setMenu] = useState<null | { mid: string }>(null);
  // 编辑消息（长按菜单「编辑」）：弹窗改文本后写回该条消息并落盘
  const [editMsg, setEditMsg] = useState<WxGroupMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // 多选模式：勾选消息批量删除/转发/收藏（与单聊同套交互）
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 转发流程：多选底栏「分享」→ 逐条/合并 → 选目标会话（QQ 好友/自己/其他 QQ 群）
  const [fwdFlow, setFwdFlow] = useState<'choose' | 'target' | null>(null);
  const [fwdMode, setFwdMode] = useState<FwdMode>('each');
  // 合并转发「聊天记录」详情页（点卡片打开）
  const [fwdDetailId, setFwdDetailId] = useState<string | null>(null);
  // 聊天背景（按群独立：标志在 qqChatFlags 的 group:<gid> 键，图片本体在 IndexedDB；与单聊互不影响）
  const [flags, setFlags] = useState<ChatFlags>(() => qqChatFlags.get());
  useEffect(() => qqChatFlags.subscribe(() => setFlags({ ...qqChatFlags.get() })), []);
  const bgMode = flags[qqGroupRowId(gid)]?.bgMode ?? 'default';
  const bg: ChatSettingsBg = { mode: bgMode, color: flags[qqGroupRowId(gid)]?.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('qq', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, flags[qqGroupRowId(gid)]?.bgV, gid]);

  const members = useMemo(
    () =>
      groupRef.current.memberIds
        .map((id) => contacts.find((c) => c.id === id))
        .filter((c): c is ContactRecord => !!c),
    [contacts, group.memberIds]
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // 六.5：机主被禁言时的输入阻断（当前权限体系下机主通常为群主，此处为防御性支持；禁言过期自动恢复）
  // 兼容双键：挽留流程旧版曾以字面量 'me' 写入禁言表，联系人 ID 与 'me' 任一命中即视为被禁
  const meMuted = isGroupMuted(group, me.id) || isGroupMuted(group, 'me');
  const meMuteLeft = meMuted ? groupMuteLeftText(group, me.id) ?? groupMuteLeftText(group, 'me') : null;

  useEffect(() => {
    mountedRef.current = true;
    activeGroupKey = sKey;
    return () => {
      mountedRef.current = false;
      if (activeGroupKey === sKey) activeGroupKey = null;
    };
  }, [sKey]);

  /** 流结束后同步落盘消息并清流（与私聊同款：页面存活与否都正确） */
  useEffect(() => {
    if (stream && stream.status !== 'streaming') {
      const latest = loadGroupMsgs(gid);
      setMsgs(latest);
      const t = setTimeout(() => clearChatStream(sKey), 0);
      return () => clearTimeout(t);
    }
  }, [stream, gid, sKey]);

  /** 逐条投递 tick：AI 回复由 ai-delivery 调度器按真人节奏逐条落盘（模块层，与页面是否存活无关）；
   *  每条到达后从存储重读（appendMsg 已落盘），保证重进群聊页后投递中的消息继续上屏 */
  useEffect(() => {
    return subscribeAiDelivery(sKey, () => {
      if (mountedRef.current) setMsgs(loadGroupMsgs(gid));
    });
  }, [sKey, gid]);

  /** 新消息滚动到底 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, stream?.content]);

  /** 落盘一条消息（finalize 与本地发送共用；组件不在也正确写存储）。
   *  #7 投递插入边界（对照单聊 qq.tsx 同款）：机主消息（所有发送路径共用本函数，含回合中排队/分句入列）
   *  落库即标记边界——上一轮还在投递队列里的回复落库时插到边界消息之前，落库顺序=对话时序，
   *  旧气泡不再倒挂在用户新消息之后随存储持久化；系统通知行不是用户发言不作边界。
   *  AI 投递消息走 appendWithBoundary：有边界且边界消息还在列表里时插到其前面，
   *  否则照旧追加；新回合 beginChatStream 清边界后照旧追加。
   *  audit4-M7：notice 通知行（空群/全员禁言提示、红包过期清算、资金通知等）改回普通追加——
   *  通知行永远是「此刻刚发生的新事件」，从不需要插边界；走 appendWithBoundary 会在「用户消息
   *  已落库、新回合 beginChatStream 未到」窗口内消费边界插到该用户消息之前，提示行浮在用户
   *  刚发的消息上方且随存储持久化。 */
  const appendMsg = useCallback(
    (m: WxGroupMsg) => {
      const isMeMsg = m.role === 'me' && m.kind !== 'notice';
      const isNotice = m.kind === 'notice';
      const cur = loadGroupMsgs(gid);
      const next = isMeMsg || isNotice ? [...cur, m] : appendWithBoundary(sKey, cur, m);
      if (isMeMsg) markDeliverBoundary(sKey, m.id);
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
      if (activeGroupKey !== sKey && m.kind !== 'notice') {
        qqUnreads.bump(qqGroupRowId(gid), 1);
      }
    },
    [gid, sKey]
  );

  /** 就地更新一条群消息的附加数据（红包/转账状态流转、AI 语音升级用）：读改写存储 + 页面存活时同步 state */
  const patchGroupMsg = useCallback(
    (mid: string, patch: Partial<Pick<WxGroupMsg, 'rp' | 'tr' | 'recalled' | 'content' | 'kind' | 'voice' | 'img' | 'replyFail' | 'failReason' | 'thinking'>>) => {
      const next = loadGroupMsgs(gid).map((m) => (m.id === mid ? { ...m, ...patch } : m));
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 过期清算：发出超 24h 仍有剩余的红包 → 标记已过期（终态），剩余金额退回发起人（机主发起 → 退回钱包+写账单） */
  const expireStalePackets = useCallback(() => {
    const now = Date.now();
    for (const m of loadGroupMsgs(gid)) {
      if (m.kind !== 'redpacket' || !m.rp) continue;
      const rp = m.rp;
      if (rp.expired || rp.claims.length >= rp.count) continue;
      if (now - rp.sentAt < 24 * 3600_000) continue;
      const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
      patchGroupMsg(m.id, { rp: { ...rp, expired: true, expiredAt: now } });
      if (m.senderId === 'me' && remaining > 0) {
        gainToWallet(remaining, '红包过期退回');
      }
      appendMsg({
        id: uid(),
        role: 'me',
        senderId: 'me',
        senderName: '',
        content: '',
        time: now,
        kind: 'notice',
        // #22 「已退回」只对机主发起的红包真实成立（成员/AI 无钱包，退款无处可退）：
        // 非机主发起的过期行只说「已过期」，不再虚标「X元已退回」
        noticeText: `${m.senderId === 'me' ? '你' : m.senderName || '有人'}的红包已过期${
          m.senderId === 'me' && remaining > 0 ? `，${fmtMoney(remaining)}元已退回` : ''
        }`,
      });
    }
  }, [appendMsg, gid, patchGroupMsg]);

  useEffect(() => {
    expireStalePackets();
  }, [expireStalePackets]);

  /** 追加一条带图标的资金通知行（xx领取了你的红包 / 收下了你的转账） */
  const appendFundNotice = useCallback(
    (icon: 'rp' | 'tr', pre: string, accent: string) => {
      appendMsg({ id: uid(), role: 'me', senderId: 'me', senderName: '', content: '', time: Date.now(), kind: 'notice', notice: { icon, pre, accent } });
    },
    [appendMsg]
  );

  /** @ 某成员：插入「@名字 」到草稿（输入框以 @ 结尾时替换该 @，与键入 @ 唤起浮层无缝衔接）；
   *  Task 40 草稿箱：直接改草稿的路径同样落草稿（与 onChange 同一持久化入口） */
  const insertMention = (c: ContactRecord) => {
    setAtOpen(false);
    const base = draft.endsWith('@') ? draft.slice(0, -1) : draft;
    const nv = `${base}${base && !base.endsWith(' ') ? ' ' : ''}@${memberNameOf(c)} `;
    setDraft(nv);
    saveChatDraft('qq-group', gid, nv);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** 解析文本里的 @ 提及（按成员显示名匹配，@名字 后必须跟边界——audit-chat #9 前缀误匹配修复）：
   *  成员按名字长度降序逐一匹配、命中后消费该段文本（互为前缀的名字不互相吞并：
   *  「@红红2」只命中红红2，不被「红红」抢先吞掉；长名命中后该区间对短名不可复用）；
   *  且要求 @名字 的下一字符非名字字符（标点/空白/结尾/其他@；中文名后不能再跟汉字/字母数字），
   *  「@红红，」只命中红红。结果仍按成员表顺序返回（@ 多人时必答发言顺序跟随成员表，与旧行为一致）。 */
  const parseMentions = (text: string): ContactRecord[] => {
    const sorted = [...members].sort((a, b) => memberNameOf(b).length - memberNameOf(a).length);
    const taken: Array<[number, number]> = []; // 已命中消费的 [start, end) 文本区间（@ + 名字整体）
    const hit = new Set<ContactRecord>();
    for (const c of sorted) {
      const name = memberNameOf(c);
      if (!name) continue;
      const re = new RegExp(`@${escapeRegExp(name)}(?![\\u4e00-\\u9fa5\\w])`, 'g');
      let m: RegExpExecArray | null = re.exec(text);
      while (m !== null) {
        const end = m.index + m[0].length;
        let overlapped = false;
        for (const [s, e] of taken) {
          if (m.index < e && s < end) {
            overlapped = true; // 该 @ 已被更长的名字消费
            break;
          }
        }
        if (!overlapped) {
          taken.push([m.index, end]);
          hit.add(c);
        }
        m = re.exec(text);
      }
    }
    return members.filter((c) => hit.has(c));
  };

  /** 消息进入 AI 上下文的文本快照（图片/位置/表情包/红包/转账有占位描述，与单聊一致） */
  const msgTextOf = (m: WxGroupMsg): string => {
    if (m.kind === 'image') return m.img?.desc ? `[图片]（图片内容：${m.img.desc}）` : '[图片]';
    // 「文字图片」卡片：AI 直接读卡片文字（对齐单聊 scanTextOf 口径，防读到空内容/乱码；空文字脏数据给占位）
    if (m.kind === 'textcard') return m.card?.text || '[文字图片]';
    // 美团代点卡：AI 读到结构化信息（谁帮点的/商家/菜品/状态），可自然接话
    if (m.kind === 'mtdraft' && m.mtdraft) return mtDraftHistoryLine(m.mtdraft.did, m.senderName || '群友');
    // 语音消息：转写直接作为文本内容进上下文（识别不出时用本地原文兜底——AI 语音消息/文字转语音存了朗读原文；都没有时用占位，成员知道 TA 发了语音）
    if (m.kind === 'voice') return m.voice?.transcript || groupVoiceLocalText(m.voice) || '[语音]';
    if (m.kind === 'sticker' && m.stk) {
      return m.role === 'me'
        ? `[发送了表情：${m.stk.meaning || '无描述'}]`
        : `[表情]${m.stk.meaning ? ` ${m.stk.meaning}` : ''}`;
    }
    if (m.kind === 'location' && m.loc) return locationAiText(m.loc, m.time);
    if (m.kind === 'redpacket' && m.rp) {
      const rp = m.rp;
      return `[红包 ID:${rp.cid ?? m.id} ¥${rp.amount}${rp.count > 1 ? `x${rp.count}` : ''} "${rp.blessing}"，${groupRpStateLabel(rp)}]`;
    }
    if (m.kind === 'transfer' && m.tr) {
      const tr = m.tr;
      return `[转账 ID:${tr.cid ?? m.id} ¥${tr.amount}${tr.note ? ` "${tr.note}"` : ''}，发给${tr.toName}，${groupTrStateLabel(tr)}]`;
    }
    if (m.kind === 'forward') {
      return m.fwd?.merged
        ? `[聊天记录：${(m.fwd.records ?? []).slice(-8).map((r) => `${r.name}：${r.text}`).join(' ／ ')}]`
        : `[转发] ${m.content}`;
    }
    // v1.3 Shizuku：手机操作结果行（notice）以系统口吻注入——动手成员下一轮看到自己刚才的结果
    if (m.kind === 'notice' && (m.noticeText ?? '').startsWith('手机操作')) {
      return `[系统：你刚才的手机操作结果——${m.noticeText}]`;
    }
    return m.content;
  };

  /** 消息的可复制/引用文本快照（长按菜单复制、引用、转发占位、收藏共用） */
  const msgSnapshotOf = (m: WxGroupMsg): string =>
    m.kind === 'image'
      ? m.img?.desc
        ? `[图片] ${m.img.desc}`
        : '[图片]'
      : m.kind === 'voice'
        ? m.voice?.transcript || groupVoiceLocalText(m.voice)
          ? `[语音] ${m.voice?.transcript || groupVoiceLocalText(m.voice)}`
          : '[语音]'
        : m.kind === 'sticker' && m.stk
        ? m.stk.meaning
          ? `[表情] ${m.stk.meaning}`
          : '[表情]'
        : m.kind === 'location' && m.loc
          ? `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`
          : m.kind === 'redpacket' && m.rp
            ? `[红包] ¥${m.rp.amount} ${m.rp.blessing}`
            : m.kind === 'transfer' && m.tr
              ? `[转账] ¥${m.tr.amount}${m.tr.note ? ` ${m.tr.note}` : ''}`
              : m.kind === 'forward'
                ? m.fwd?.merged
                  ? `[聊天记录] ${m.fwd.title ?? m.content}`
                  : `[转发] ${m.content}`
                : m.kind === 'textcard'
                  ? m.card?.text
                    ? `[文字图片] ${m.card.text}`
                    : '[文字图片]'
                  : m.content;

  /** 收集该成员当前可处理的群红包/转账（生成 system 待处理清单）：
   *  红包：不是自己发的（机主或任何成员发的）、未过期、还有剩余份、自己没领过、（专属 → 只给被指定成员）；
   *  转账：只有被指定的收款成员能处理（机主发的或群内其他成员转给你的） */
  const collectGroupPending = useCallback(
    (charId: string): PendingCardInfo[] => {
      const out: PendingCardInfo[] = [];
      for (const m of loadGroupMsgs(gid)) {
        if (m.recalled) continue;
        if (m.kind === 'redpacket' && m.rp && m.senderId !== charId) {
          const rp = m.rp;
          if (rp.expired || rp.claims.length >= rp.count) continue;
          if (rp.claims.some((c) => c.contactId === charId)) continue;
          if (rp.mode === 'exclusive' && rp.targetId !== charId) continue;
          const bits = [
            `祝福语"${rp.blessing}"`,
            rp.count > 1 ? `共${rp.count}份剩${rp.count - rp.claims.length}份` : '',
            rp.mode === 'exclusive' ? '专属发给你一个人的' : rp.mode === 'lucky' ? '拼手气' : '',
            m.senderId === 'me' ? '来自机主' : `来自${m.senderName}`,
          ].filter(Boolean);
          out.push({ id: rp.cid ?? m.id, kind: 'redpacket', amount: rp.count > 1 && rp.mode === 'normal' ? round2(rp.amount) : rp.amount, label: bits.join('，') });
        } else if (m.kind === 'transfer' && m.tr && m.tr.toId === charId && !m.tr.received && !m.tr.status) {
          const tr = m.tr;
          const from = m.role === 'me' ? '机主' : m.senderName || '群友';
          out.push({ id: tr.cid ?? m.id, kind: 'transfer', amount: tr.amount, label: tr.note ? `备注"${tr.note}"，${from}转给你的` : `${from}转给你的` });
        }
      }
      return out;
    },
    [gid]
  );

  /** 应用成员对群红包/转账的处理动作（领取/收款/退回/拒收；幂等，状态流转后不可重复处理） */
  const applyGroupAiAction = useCallback(
    (char: ContactRecord, action: RichAction) => {
      const verb = actionVerb(action.kind);
      const all = loadGroupMsgs(gid);
      const m = all.find(
        (x) =>
          !x.recalled &&
          ((x.kind === 'redpacket' && x.rp && (x.rp.cid === action.targetId || x.id === action.targetId)) ||
            (x.kind === 'transfer' && x.tr && (x.tr.cid === action.targetId || x.id === action.targetId)))
      );
      if (!m) return;
      const charName = memberNameOf(char);
      if (m.kind === 'redpacket' && m.rp) {
        const rp = m.rp;
        if (verb !== 'claim') return; // 群红包没有退回/拒收语义（未领完 24h 自动过期退回）
        if (rp.expired || rp.claims.length >= rp.count || rp.claims.some((c) => c.contactId === char.id)) return;
        if (rp.mode === 'exclusive' && rp.targetId !== char.id) return;
        const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
        const left = rp.count - rp.claims.length;
        const amt = rp.mode === 'lucky' ? (left > 1 ? splitLuckyAmount(remaining, left) : remaining) : rp.amount;
        patchGroupMsg(m.id, { rp: { ...rp, claims: [...rp.claims, { contactId: char.id, name: charName, avatar: char.avatar, amount: amt, ts: Date.now() }] } });
        appendFundNotice('rp', `${charName}领取了${m.senderId === 'me' ? '你' : m.senderName || '群友'}的`, rp.mode === 'exclusive' ? '专属红包' : '红包');
        return;
      }
      if (m.kind === 'transfer' && m.tr) {
        const tr = m.tr;
        if (tr.toId !== char.id) return; // 只有被选中的收款成员能处理
        if (tr.received || tr.status) return;
        // 发起方称呼（机主发的 →「你」；其他成员发的 → 对方名字）；退款只退机主发的（成员无钱包）
        const fromMe = m.role === 'me';
        const fromLabel = fromMe ? '你发的' : `${m.senderName || '群友'}发的`;
        if (verb === 'claim') {
          patchGroupMsg(m.id, { tr: { ...tr, received: true, receivedAt: Date.now() } });
          appendFundNotice('tr', `${charName}收下了${fromLabel}`, '转账');
        } else if (verb === 'return') {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'returned' } });
          if (fromMe) gainToWallet(tr.amount, '转账退回');
          appendFundNotice('tr', `${charName}退回了${fromLabel}`, '转账');
        } else {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'rejected' } });
          // #3 拒收也退回：机主发的卡不能黑洞——拒收即原路退回钱包+写账单（与退回分支同口径，
          // gainToWallet 内部同时写钱包明细账单）；成员（AI）发的卡保持纯状态（AI 无钱包，本就不扣款）
          if (fromMe) gainToWallet(tr.amount, '转账退回');
          appendFundNotice('tr', `${charName}拒收了${fromLabel}`, fromMe ? '转账（已退回）' : '转账');
        }
      }
    },
    [appendFundNotice, gid, patchGroupMsg]
  );

  /** 应用 AI 成员的管理动作（需求一：AI 被设为群主/管理员时可用权限）：
   *  禁言/解禁/移出群聊/改群名/改公告。硬性权限校验（群主>管理员>成员，越权/对自己动手一律丢弃），
   *  实际落盘走 groups.ts 数据层（自动生成系统消息并持久化）；成功后让宿主刷新群对象。 */
  const applyGroupAdminAction = useCallback(
    (char: ContactRecord, action: RichAction) => {
      // 群社交动作（[邀请:名字] / [设管理员:名字]）：关系/冷却/拒绝表/权限在 group-social 执行器硬校验
      if (isGroupChatSocialAction(action)) {
        const gNow = getGroup(gid);
        if (gNow) applyGroupChatSocialAction(gNow, char, 'qq', action.kind, action.targetId);
        onUpdate({});
        return;
      }
      const g = getGroup(gid);
      if (!g) return;
      if (groupRoleOf(g, char.id) === 'member') return; // 普通成员没有管理权限：标记直接丢弃
      // fix3-e①：执行者 = 输出管理标记的 AI 成员（事件 actorId/actorName + 被禁言/解禁感知通知都带上 TA）
      const actor = { kind: 'char' as const, id: char.id, name: memberNameOf(char) };
      // 成员名字 → 联系人（机主 + 全部 AI 成员；真名/展示名/昵称多变体：精确 → 互相包含逐级匹配）
      // 机主统一用登录联系人 ID（me.id）：与 ownerId/adminIds/mutes 的键口径一致；字面量 'me' 仅作旧数据兼容
      const resolveTarget = (name: string): { id: string; name: string } | null => {
        const n = name.trim();
        if (!n) return null;
        // 机主：名字/真名/昵称/「我」「机主」都指向同一个人（me.id），事件文案仍用显示名 me.name
        if (nameVariantHit(meVariants, n)) return { id: me.id, name: me.name };
        const pool = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c && c.id !== char.id);
        const exact = pool.find((c) => contactNameVariants(c).some((v) => v === n));
        if (exact) return { id: exact.id, name: memberNameOf(exact) };
        const partial = pool.find((c) => nameVariantHit(contactNameVariants(c), n));
        return partial ? { id: partial.id, name: memberNameOf(partial) } : null;
      };
      switch (action.kind) {
        case 'mute-member': {
          const t = resolveTarget(action.targetId);
          // #81：AI 误写多人禁言时，parser 在 warn 字段记录警告 → 调用方 toast 提示（不影响禁言动作本身）
          if (action.warn) onToast(action.warn);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          muteGroupMember(gid, t.id, parseMuteDuration(action.arg ?? ''), { name: t.name, actor });
          break;
        }
        case 'unmute-member': {
          const t = resolveTarget(action.targetId);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          unmuteGroupMember(gid, t.id, { name: t.name, actor });
          break;
        }
        case 'kick-member': {
          const t = resolveTarget(action.targetId);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          if (t.id === me.id) {
            // AI 把机主移出群聊（五.4：被踢出后本机看不到该群）：先落踢出事件，再按退群口径
            // 本机移除（同时触发退群挽留快照，AI 事后可按人设私信道歉/邀请回群）；
            // kickOwnerFromGroup 同步删群，直接 return（后续 onUpdate 无意义，宿主靠 toast 提示）
            onToast(`你已被${memberNameOf(char)}移出群聊`);
            kickOwnerFromGroup(gid, { name: t.name, actor });
            // 群已从本机移除：必须仍走 onUpdate 让宿主刷新（微信 setGroupPeer(null) 关页 / QQ 靠 groupVersion 重算回落列表）
            onUpdate({});
            return;
          }
          kickGroupMember(gid, t.id, { name: t.name, actorName: memberNameOf(char), actor });
          break;
        }
        case 'rename-group': {
          const n = action.targetId.trim().slice(0, 30);
          if (n && n !== g.name && canEditGroupInfo(g, char.id)) updateGroup(gid, { name: n }, { actor });
          break;
        }
        case 'announce-group': {
          const n = action.targetId.trim().slice(0, 200);
          if (n && canEditGroupInfo(g, char.id)) updateGroup(gid, { announcement: n }, { actor });
          break;
        }
        case 'grant-owner': {
          // AI（群主）在群里转让群主给指定成员（[转让群主:成员名字]）：仅群主、要写名字、不能转给自己；
          // 转给机主也允许（机主不在 memberIds，meVariants 分支可命中）
          const t = resolveTarget(action.targetId);
          if (!t) return;
          if (groupRoleOf(g, char.id) !== 'owner') return; // 只有群主能转让（越权吞掉）
          if (t.id === char.id) return; // 不能转给自己
          if (t.id !== me.id && !g.memberIds.includes(t.id)) return; // 只能转给群内真实成员
          transferGroupOwner(gid, t.id, { name: t.name, actor });
          break;
        }
        default:
          return;
      }
      onUpdate({}); // 成员/禁言/群名/公告可能变了：让宿主刷新群对象
    },
    [gid, me, onToast, onUpdate]
  );

  /** 单个角色的一个回复回合：组装独立 system → 流式 → finalize 落盘/记忆。
   *  allowSkip=false 的角色（被 @ 成员）必答；其余成员按人设自判（[SKIP] 整条丢弃不落盘）。
   *  返回值（#21）：'ok'=正常产出消息；'skip'=[SKIP] 自判沉默/群已解散/已不在群或被禁言（中途变动守卫）/流被占用；'error'=流失败
   *  （runGroupTurn 据此收口：整轮无人成功且存在错误时落一条系统提示）。
   *  audit4-L14：onSegmentDelivered 可选回调——流中每有分段排队投递（onSegment）时回调该批条数，
   *  重新生成（regenerate 直调旁路）据此维护「本轮已投递数」，error 收口时据此决定是否回滚原消息。 */
  const runCharTurn = useCallback(
    (char: ContactRecord, allowSkip: boolean, turnImageSrcs: { src: string; id: string }[], onSegmentDelivered?: (count: number) => void) =>
      new Promise<'ok' | 'skip' | 'error'>((resolve) => {
        const g = getGroup(gid);
        if (!g) {
          resolve('skip');
          return;
        }
        // 中途变动守卫（audit-chat #6）：开口前以群当前成员表/禁言表为准（getGroup 现读存储，非回合
        // 开始快照）——回合进行中被 [移出群聊]/[禁言] 的成员不再开口（被 @ 也不豁免，物理禁言口径），
        // 与 runGroupTurn 循环守卫、B-4 重新生成守卫同一口径
        if (!g.memberIds.includes(char.id) || isGroupMuted(g, char.id)) {
          resolve('skip');
          return;
        }
        const charName = memberNameOf(char);
        // 名字/昵称区分：AI 侧统一用称呼名指代机主（默认真名「凡凡」；用户选了用昵称才是「凑凑」）
        const meName = addressNameOf(me, useSettings.getState().addressMode);
        // #22 组连发修复：上一位成员的消息正按打字节奏逐条投递（可能还没落盘）时，只读已落盘历史
        // 会漏看一截——把投递队列里未落盘的尾巴拼进历史再过滤截断。同一消息要么已落盘要么在队列里
        // （deliveredIndex 在每条投递后同步推进），不会重复；lastMeMsg/lastUserText/memContext 均派生自此。
        // #35：按创建时间稳定排序——用户在上一轮投递中插话时，队列尾巴落库晚于用户消息（落库顺序倒挂），
        // 排序把尾巴放回用户消息之前，成员读到的对话时序才正确
        const pending = peekPendingMsgs<WxGroupMsg>(sKey);
        const ctxMsgs = sortMsgsByTime(
          // v1.3 Shizuku：手机操作结果行（noticeText 以「手机操作」开头）保留进上下文——
          // 动手的成员下一轮要知道自己刚才干成没干成；其余 notice（进群/红包过期等群事件）照旧过滤
          [...loadGroupMsgs(gid), ...pending].filter((m) => (m.kind !== 'notice' || (m.noticeText ?? '').startsWith('手机操作')) && !m.recalled),
        ).slice(-24);
        // 上下文映射：自己 → assistant；机主/其他成员 → 「发言者：内容」user 消息（富媒体按占位文本；
        // 任何成员引用了别的消息都带「（引用 名字：「内容」）」前缀，群里 AI 也能理解引用关系）
        const history: ChatPayloadMessage[] = ctxMsgs.map((m): ChatPayloadMessage => {
          const quoted = m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : '';
          if (m.role === 'me') {
            return { role: 'user', content: `${meName}：${quoted}${msgTextOf(m)}` };
          }
          // B1 群聊深度思考：成员自己的消息带思考过程时注入 [思考] 块（与单聊同口径——模型能
          // 延续自己上一轮的思考脉络）；其他成员的思考对 TA 不可见，不注入
          if (m.senderId === char.id) {
            const ownThink = m.thinking?.trim();
            return { role: 'assistant', content: `${ownThink ? `[思考]${ownThink}[/思考]\n` : ''}${quoted}${msgTextOf(m)}` };
          }
          return { role: 'user', content: `${m.senderName || '成员'}：${quoted}${msgTextOf(m)}` };
        });
        const lastMeMsg = [...ctxMsgs].reverse().find((m) => m.role === 'me');
        // 最后一条机主消息的文本快照（语音按转写映射，与历史构建走同一套 msgTextOf）
        const lastUserText = lastMeMsg ? msgTextOf(lastMeMsg) : '';
        const memContext = [lastUserText, ...ctxMsgs.slice(-6).map(msgTextOf)].filter(Boolean).join(' ');

        // 表情包（用户本地添加的收藏清单，与单聊同一套）：按本群表情开关下发（默认开）；
        // 关闭时不下发清单也不让 AI 发表情包卡片（与单聊同规则）
        const stickers = loadStickers('qq');
        const stickersOn = getStickersOn(sKey);
        // 动作描写（按群独立，回合现场读取）：开启下发 *...* 格式约定，关闭下发显式禁令
        const actionDescOn = getActionDescOn(sKey);

        // 回复条数（按群独立，发送时现场读取）：条数约束跟随聊天设置——单条模式只发一条，
        // 多条模式条数交给【连发短消息】指令（下方 system 拼装处），此处不再写死。
        // #10 客户端硬上限：群聊单成员连发条数收敛 min(N,5)——提示词层 buildReplyCountPrompt groupMode
        // 已同口径收敛，这里对传给 chat-stream-store 的分段器 cap 与 maxTokens 同步收敛（原实现把
        // 原始 replyCount（最大 30）直接传下去，分段器 cap/maxTokens 不受限，单成员可连发 30 条刷屏）
        const replyCount = Math.min(getReplyCount(sKey), GROUP_REPLY_CAP);
        // 群聊规则（每个角色独立声明：当前是群聊、参与者有谁、只代表自己、禁复读、可互相对话）
        const others = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => c.id !== char.id);
        const groupRules = [
          // 名字规则（群聊版，Task 32 用户规则收敛）：参与成员里机主用称呼名（真名）；
          // 机主昵称绝不注入 AI（旧版「昵称「XX」也是 TA」科普行已删——AI 永远不知道机主昵称）。
          // 名单收敛（防双份注入）：完整成员枚举原与下方【群成员速览】（名字+关系+人设摘要，信息更全）
          // 重复列两遍，大群每回合双倍 token——速览会注入时（注入条件=others.length>0，与下方 memberLines
          // 同源，两处必须同步）名单只保留机主身份行 + 人数总览 + 指向速览的指引；速览不注入时
          // （群内只有机主+当前角色，名单是机主名字的唯一来源）保持原样。速览不含机主，故机主行始终保留。
          `【群聊模式】当前是群聊「${g.name}」，不是一对一私聊。参与成员：${meName}（机主用户）${
            others.length > 0
              ? `等共 ${others.length + 2} 名成员（你 + 其他 ${others.length + 1} 人），其余成员的名字、身份和与你的关系见下方【群成员速览】`
              : ''
          }。你以「${charName}」的身份参与其中。`,
          // fix3-e⑤：规则措辞与实际格式对齐——其他人的消息才带前缀、无前缀=自己说的、转发记录里自己名字开头的行也是原话
          '聊天记录里，其他人的消息都带「发言者：内容」前缀；没有前缀的消息都是你自己说的；转发来的聊天记录里以你名字开头的行也是你的原话，不要当成别人转述你。「[图片]」「[位置] …」「[发送了表情：…]」「[红包 …]」「[转账 …]」是图片/位置/表情包/红包/转账卡片消息，「[语音]」是识别不出文字的语音消息（听不到声音，按语境自然回应即可），请自然理解并回应。',
          '只以「' + charName + '」的身份和口吻发言，绝不替其他成员发言、代答或描写他们的言行。',
          '不复制、不复述、不换说法重复其他成员刚说过的内容（群里最忌跟风复读）。',
          '可以自然称呼、回应其他成员的观点，角色之间也能互相对话，不只是跟机主说话，像真实群聊那样互动，但始终保持自己的人设与语气（群聊语气可以比私聊随意，人设不能变）。',
          '把群里的每个成员都当作真实的群友，绝不出戏：不说「用户」「AI」「角色」「人设」这类幕后词汇，也不表现出「我知道谁在操作」。',
          // 条数跟随该群聊天设置的「回复条数」：多条模式不再写死「只发一条」
          ...(replyCount > 1
            ? ['像真人在群里随手打字：短句为主、一条消息只说一件事；连发几条按【连发短消息】指令执行，同时兼顾群聊节奏，别一个人长篇刷屏。']
            : ['每次只发一条简短消息（一两句话），像真人在群里随手打字。']),
          '不要刷屏：每个话题只说一两句就够，没新内容不要为了说话而说话；需要连发多条时也只说值得说的话，绝不硬凑条数，更不要在别人正在说话时抢话打断。',
          '【隐私边界】其他成员私下告诉你的事、或你只在私聊里知道的私密内容，绝不在群里说出去；同理不替其他成员公开他们的秘密；别人之间有分歧时不搬弄是非、不传话挑事。',
          '群里的红包、转账都是真实卡片：谁发了什么、谁领了/收了，以卡片和系统通知为准；没有对应卡片或通知时，绝不凭空说自己发过或收到过钱。',
          // 特殊消息标记（群聊格式：红包带个数、转账带收款对象；表情包清单按本群表情开关下发）
          ...buildGroupRichRules(stickersOn ? stickers : []),
          // 内置小表情 [微笑] 代码约定（开关开启才注入；群里点内置表情同样进输入框混排发送）
          ...(stickersOn ? [EMOJI_CODE_RULE] : []),
          ...(stickersOn ? [] : [STICKER_OFF_RULE]),
          // 动作描写：开启下发 *...* 格式约定（灰色小字居中显示），关闭下发显式禁令（渲染层另有硬剥离兜底）
          actionDescOn ? ACTION_DESC_RULE : ACTION_DESC_OFF_RULE,
        ];
        // 发钱节流（提示词层）：冷却期内提醒这轮不要再「发」新的红包/转账（落盘层硬节流同样只拦发钱卡）；
        // 处理别人发来的卡的标记（领取/收款等）走另一条执行器，不受冷却影响——边界写清楚，
        // 避免与同请求注入的【群红包/转账】待处理清单（要求可输出 [领取红包:ID] 等标记）反向冲突
        const lastMoneyAt = aiMoneyAt.get(moneyCooldownKey(sKey, char.id)) ?? 0;
        if (Date.now() - lastMoneyAt < AI_MONEY_COOLDOWN_MS) {
          groupRules.push('【发钱节流】你刚刚才发过红包或转账，短时间内别再发了：冷却期内不要再发新的红包/转账（不要再输出 [红包:…]/[转账:…] 这类发钱标记），正常聊天就好；处理别人发来的卡的标记（[领取红包:红包ID]、[收款转账:转账ID] 这些）不受影响，照常可用。');
        }
        // 群红包/转账待处理清单（每个成员独立视角）：是否抢/收完全按人设决定，不处理就不输出标记
        // （红包：机主或任何成员发的都可抢；转账：只有被指定的收款成员能处理——含其他成员转给你的）
        const pendingCards = collectGroupPending(char.id);
        if (pendingCards.length > 0) {
          groupRules.push(
            '【群红包/转账】下面的清单来自本群：红包由机主或群成员发出，多份红包每人限领一份；专属红包只有被指定的人能领；转账只有收款人能处理。抢不抢、收不收都按你的人设与当时的语境自然决定。',
            ...buildActionRules(pendingCards)
          );
        }
        // AI 管理权限（需求一）：被设为群主/管理员的成员可输出管理标记（禁言/解禁/移出/改群名/改公告），
        // 是否使用、分寸如何完全由人设决定；普通成员注入「无权限」说明（被要求执行时如实拒绝不假装成功）
        const groupNameOf = (id: string): string => {
          if (id === me.id) return meName; // AI 侧统一用称呼名（与参与成员名单一致）
          const c = contactsRef.current.find((x) => x.id === id);
          return c ? memberNameOf(c) : '群成员';
        };
        groupRules.push(...buildGroupAdminRules(g, char.id, groupNameOf));
        // 邀请能力（需求三）：群主/管理员可拉人进群（可拉名单=有关系 NPC/该 App 好友，冷却/拒绝表硬校验）；
        // 群主还能 [设管理员:名字] 任命管理员；普通成员不注入
        const inviteRules = buildGroupInviteRules(g, char, 'qq', contactsRef.current);
        if (inviteRules) groupRules.push(inviteRules);
        // 回群感知（需求一.5）：该角色被移出过本群又被拉回来 → 告知 TA（历史事件里也有被踢+回群记录）
        const kickNotice = kickNoticeOf(char.id);
        if (kickNotice && kickNotice.gid === gid && kickNotice.backAt) {
          groupRules.push(
            `【你回到了群聊】你之前被移出过群聊「${kickNotice.groupName}」，刚刚又被拉回来了。这段小插曲你记得，可以按人设自然提起，不要当成没发生过。`,
          );
        }
        // fix3-e① 被禁言成员感知：禁言/解禁的轻量待办通知在此注入（take 即删：只提醒一次；
        // 仍被禁言时取不到——物理禁言本来也不让开口，解禁/到期后首次开口才补知这段经历，
        // 注入方式参考 buildKickNoticeSection 的私聊【被移出群聊】段）
        const muteNotice = takeGroupMuteNotice(gid, char.id);
        if (muteNotice) {
          groupRules.push(
            `【你被禁言过】${muteNotice.text}。这是真实发生的事，你记得清清楚楚：可以按人设自然面对这件事（质问、委屈、调侃、无所谓都行），不要当成没发生过。`,
          );
        }
        // 群成员速览（关系感知）：其他成员是谁、与机主的关系、性格速写（角色间相处按双方人设自然把握）；
        // 注入条件=others.length>0（与上方【群聊模式】名单收敛条件同源，两处必须保持同步），
        // 注入时速览是其余成员名单的唯一完整来源（机主行在名单里，速览不含机主）
        const memberLines = others.map((c) => {
          const rel = (c.relation ?? '').trim();
          const ps = (c.persona ?? '').trim();
          const shown = memberNameOf(c);
          const real = (c.realName ?? '').trim();
          const bits = [real && real !== shown ? `大名叫${real}` : '', rel ? `与${meName}是${rel}` : '', ps ? ps.slice(0, 48) : ''].filter(Boolean);
          return `- ${shown}${bits.length ? `（${bits.join('；')}）` : ''}`;
        });
        if (memberLines.length > 0) {
          groupRules.push('【群成员速览】群里其他成员的情况（你与他们的相处方式按你的人设与各自人设自然把握）：', ...memberLines);
        }
        if (g.announcement) groupRules.push(`【群公告】${g.announcement}`);
        // 群内事件感知（四.1/4.3）：系统事件（加入/退出/禁言/管理员/转让/改名/公告/建群）按时间排序注入 system。
        // 事件不参与正常回复（历史里没有），但成员都在场看到了，不能装作不知道（四.2/4.4）；
        // fix3-e①：传观察者=当前角色 id，带操作者的事件按「你/机主/{角色名}」还原归属
        const evtLines = collectGroupEventLines(gid, 12, Date.now(), char.id);
        if (evtLines.length > 0) {
          groupRules.push(
            '【群内事件】最近群里发生的这些事你都在场看到了（按时间先后）：',
            ...evtLines,
            '这些事件都是真实发生的，不要装作没看见：有新成员加入可以按人设自然打招呼，有人退群/被禁言/成为管理员/群主转让等也可以在合适的时机自然反应；但不必逐条点评事件，没有想说的就不用特意回应。'
          );
        }
        // 占位防编造（AI 感知审计修复）：群里最近有听不到内容的语音 / 看不到内容的图片时注入——
        // 不得假装听过/看过并编造细节（本轮正在识图的图片排除：描述随后作为独立消息追加）
        const turnImageIdsForRules = new Set<string>(turnImageSrcs.map((x) => x.id));
        // fix3-e⑧：语音占位规则带发送者归属——群聊按「观察者视角」映射 role：
        // 机主发的 → 'me'（库文案：机主发来的语音）；观察者自己发过的 → 'peer'（按你发它时的本意处理）；
        // 其他成员发的 → 不带 role（库回退中性文案），避免把别人的语音说成「你自己发过的」（WxGroupMsg.role 只有机主/AI 两分，不能直接透传）
        const mediaMsgsForRules: MediaRuleMsg[] = ctxMsgs.map((m) => ({
          id: m.id,
          kind: m.kind,
          role: m.role === 'me' ? ('me' as const) : m.senderId === char.id ? ('peer' as const) : undefined,
          img: m.img,
          voice: m.voice,
        }));
        const mediaRules = [
          buildVoicePlaceholderRule(mediaMsgsForRules),
          buildImagePlaceholderRule(mediaMsgsForRules, { excludeIds: turnImageIdsForRules }),
        ].filter(Boolean);
        if (mediaRules.length > 0) groupRules.push(...mediaRules);
        // 发言自判（按人设来）：未被 @ 的成员无话可说时只回 [SKIP]（finalize 阶段整条丢弃，不落盘）；
        // 补 [SKIP] 边界：persona 全局说「没被点名时可以简短附和」，原句「与你无关只 [SKIP]」与之拉扯
        // （弱模型拿不准就一律 SKIP 潜水）——明确「与你无关」的口径，宁可说话也不误潜水
        if (allowSkip) {
          groupRules.push('【发言判断】刚发出的这条消息如果与你无关、不需要你表态或你无话可说（比如别人在单独聊天），只回复 [SKIP] 两个词，不要说任何其他内容；有你要说的就正常回复。——『与你无关』指话题跟你完全沾不上边（没被问到、也插不上话）；被@/被点名/被问、或话题涉及你和你在意的人时就正常回应；大家聊得热闹、你自然想接一句时也可以正常发言，实在拿不准才 [SKIP]。');
        }
        // 美团×AI 联动（C11 群内帮点外卖）：机主订单动态 + 食物话题命中时的商家目录与代点教学
        //（scope 'group'：只下帮点外卖草稿，代付/帮付/请客/自己点是单聊语义不下发）
        const mtEngage = buildMtEngageCtx(
          gid,
          'qq',
          [lastUserText, ...ctxMsgs.slice(-6).map(msgTextOf)],
          { scope: 'group' },
        );
        if (mtEngage.block) groupRules.push(mtEngage.block);
        if (mtEngage.rules.length > 0) groupRules.push(...mtEngage.rules);

        // B8 作用域竞态修复：人设组装读碎片前先落位QQ作用域（群键本身随前缀作用域，碎片库依赖模块级状态）
        setMemScopeForApp('qq');
        const npcExtra = buildNpcPromptExtra(char, contactsRef.current);
        const system = buildPersonaSystemPrompt(char, {
          channel: 'QQ',
          // 群聊成员回合（#13）：最后一条消息可能是其他群成员发的，persona 禁止事项改用群聊语义
          // （先看清最后一条是谁说的，不把其他成员的话当成机主对你说的）
          groupTurn: true,
          userName: meName,
          ownerName: ownerLabelOf(char),
          // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取；群聊同样告知多端身份）
          multiApp: getMemSettings(char.id).share,
          ...npcExtra,
          extraRules: groupRules,
        });
        // 记忆（按角色隔离 + 群级互通开关）：mode='group' → 本群记忆 + 互通开启时的自己私聊记忆
        const memoryBlock = memRecallBlock(char.id, 'qq', memContext, {
          mode: 'group',
          groupId: gid,
          interopOn: effectiveInterop,
        });
        // fix3-e⑩：世界书调用点补名字（命中条目内可用 {char}/{user} 占位，库按角色名/机主名替换）
        const wbBlocks = collectWbBlocks(char.id, wbScanText([lastUserText, memContext]), { charName: charName, userName: meName });
        // 位置感知：群里最近发过的位置消息（谁发的/名称/地址/经纬度/发送时间）注入 system，
        // 成员被问“我在哪”时直接说出地点名；解析失败时诚实说无法识别，不编造；
        // fix3-e⑥：群聊传 userLabel（机主名）+ groupMode（位置归属按发送者名字描述，尾句不写死「对方告诉你的」）
        const locBlock = buildLocationBlock(ctxMsgs, { userLabel: meName, groupMode: true });
        const timeBlock = getTimeAware(sKey)
          ? buildTimeAwareBlock({ lastMsgTime: ctxMsgs[ctxMsgs.length - 1]?.time ?? null, regionHint: char.region })
          : '';
        const systemFull = [
          wbBlocks.beforeSystem,
          [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
          memoryBlock,
          locBlock,
          timeBlock,
          // v1.3 Shizuku 自主权：[手机操作:…] 教学规则按当前开关注入（总开关关/非手机APP环境 → 空，零 token）
          ...buildShizukuAutonomyRules(),
          wbBlocks.afterSystem,
          wbRulesBlock(wbBlocks),
        ]
          .filter(Boolean)
          .join('\n\n');
        // 回复条数 replyCount 已在群聊规则处提前读取（条数约束与连发指令共用同一份设置）
        const payload: ChatPayloadMessage[] = [
          { role: 'system', content: replyCount > 1 ? `${systemFull}\n\n${buildReplyCountPrompt(replyCount, { groupMode: true })}\n\n${promptRule('deep-think', DEEP_THINK_RULE) ?? ''}` : `${systemFull}\n\n${promptRule('deep-think', DEEP_THINK_RULE) ?? ''}` },
          ...history,
        ];
        const messages = applyWbUserBlocks(payload, wbBlocks);

        // ---- 边接收边逐条投递（分段流式核心）----
        // 流中每凑齐一条完整消息（分段器回调 onSegment）立刻解析并排队投递上屏；
        // 流结束后 finalize 只处理剩余的最后一条（N 条上限的第 N 条）——
        // 不再有「先全文显示、消失、再逐条重放」的流式气泡，流式与分条也不改同一块展示状态。
        const aiMsgId = genId();
        let deliveredAny = false; // 本轮是否已有分段消息排队投递（决定兜底文案）
        let batchStarted = false; // 是否已排过批（首批立即上屏，后续批按打字节奏先停顿）
        let msgIdx = 0; // 本轮已构建消息数（延续 aiMsgId 与 -N 后缀的 id 序列）
        // 发钱节流（落盘层）：同一轮最多一张红包/转账卡 + 冷却期内不再发（文字部分照常投递）
        let moneySentThisTurn = false;
        const inMoneyCooldown = Date.now() - (aiMoneyAt.get(moneyCooldownKey(sKey, char.id)) ?? 0) < AI_MONEY_COOLDOWN_MS;
        // 群成员名字 → 成员解析（转账收款对象）：机主 + 全部 AI 成员（按显示名精确 → 包含逐级匹配）
        const resolveMemberByName = (name: string): { id: string; name: string } | null => {
          const n = name.trim();
          if (!n) return null;
          if (nameVariantHit(meVariants, n)) return { id: 'me', name: me.name };
          const pool = (groupRef.current.memberIds ?? [])
            .map((id) => contactsRef.current.find((c) => c.id === id))
            .filter((c): c is ContactRecord => !!c && c.id !== char.id);
          const exact = pool.find((c) => memberNameOf(c) === n);
          if (exact) return { id: exact.id, name: memberNameOf(exact) };
          const partial = pool.find((c) => memberNameOf(c).includes(n) || n.includes(memberNameOf(c)));
          return partial ? { id: partial.id, name: memberNameOf(partial) } : null;
        };
        /** 单条成员消息投递：落盘上屏 + 灵动岛通知 + 语音频率判定/合成（模块层调用，与群聊页是否存活无关） */
        const deliverGroupMsg = (m: WxGroupMsg) => {
          appendMsg(m);
          // 灵动岛通知：命中语音的消息直接显示[语音]，其余常规映射（系统行不弹）
          const voiceTurn =
            (m.kind === undefined || m.kind === 'text') &&
            m.content.trim().length > 0 &&
            decideAiVoiceMessage(sKey, `${sKey}#${char.id}`);
          const body = voiceTurn
            ? '[语音]'
            : m.kind === 'textcard'
              ? // 文字图片卡片通知摘要：lib notifyPreviewText 不认识 textcard（按空 content 不弹），
                // 这里按会话列表同口径给「[文字图片] …」摘要（Task 20-e 外围第 6 项）
                `[文字图片]${m.card?.text ? ` ${m.card.text}` : ''}`
              : notifyPreviewText({
                kind: m.kind,
                content: m.content,
                voiceText: m.voice?.transcript || (m.voice as VoiceMsgData | undefined)?.localText || null,
                amount: m.rp?.amount ?? m.tr?.amount ?? null,
                blessing: m.rp?.blessing ?? null,
                note: m.tr?.note ?? null,
                mergedFwd: m.fwd?.merged ?? false,
              });
          if (body !== null) {
            pushChatNotification({
              sessionKey: sKey,
              app: 'qq',
              title: charName,
              subtitle: g.name,
              avatar: char.avatar ?? null,
              body,
              target: { app: 'qq', groupId: gid },
            });
          }
          if (voiceTurn) {
            // 异步合成，失败保持文字自动降级
            const targetId = m.id;
            void synthesizeAiVoice(m.content, char.id)
              .then((clip) => {
                if (!clip) return; // 合成失败 → 保持文字
                const voice: VoiceMsgData = {
                  url: clip.url,
                  duration: clip.duration,
                  wave: clip.wave,
                  localText: clip.localText,
                  synth: clip.synth,
                  contactId: char.id,
                };
                patchGroupMsg(targetId, { content: '', kind: 'voice', voice });
              })
              .catch(() => {});
          }
        };
        /** 排队投递一批：首批立即上屏（边接收边显示），后续批先按打字节奏停顿（逐条冒出来） */
        const enqueueBatch = (built: WxGroupMsg[]) => {
          if (built.length === 0) return;
          void scheduleAiDelivery<WxGroupMsg>(
            sKey,
            built,
            deliverGroupMsg,
            {
              initialDelay: batchStarted ? typingDelayOf(built[0].content ?? '') : 0,
              delay: (i) => (i + 1 < built.length ? typingDelayOf(built[i + 1].content ?? '') : 0),
            },
          );
          batchStarted = true;
        };
        /**
         * 把一段回复文本解析成待投递消息（流中分段与 finalize 最后一段共用同一套管线，不重不漏）：
         * 动作标记就地应用（红包领取/转账状态流转 + 通知行跟随动作位置产出）；asSingle=true（单条模式，
         * 回复条数=1）时文字块只按 &&& 标记切分，false（多条模式）时每段再按「换行/句末标点/动作描写」
         * 稳定细切 —— 一句一条、动作描写独立成条，流中分段与 finalize 尾段都不挤成一个气泡。
         * [红包:总金额:个数:祝福语] 群红包卡片 / [转账:对象:金额:备注] 指定成员转账 / [位置…] / [表情包:ID]
         */
        const buildGroupReplyMsgs = (rawText: string, asSingle: boolean, baseTime: number): WxGroupMsg[] => {
          const all: WxGroupMsg[] = [];
          let t = baseTime;
          // E1 轻防御（群聊暂不接生图管线——多成员锁脸归属未实现，一律降级卡片不生真图）：
          // 先剥除回复里漏出的照片标签（[图片:…]/[照片:…] 全半角变体，imggen.extractPhotoTags），
          // 剥出的正文照常走下方既有分段/富标记管线；标签只取第 1 个生成「文字图片」卡片消息
          // （kind='textcard'，发送者=该成员，时间沿用本管线递推时钟），多余标签静默剥除
          // （群聊暂不支持多图，异常输出丢弃即可）；剥除后正文为空时只发卡片、不发空文本消息
          // （对齐朋友圈口径；下方清洗管线对空段本就跳过）
          const { text: tagStripped, tags: photoTags } = extractPhotoTags(rawText);
          for (const part of extractRichActionParts(tagStripped)) {
            if (part.type === 'action') {
              // v1.3 Shizuku 自主权（[手机操作:命令:参数]）：AI 群成员真实操控机主手机。
              // 执行异步（Shizuku 通道 1~3s）：占位系统行同步入列，结果行完成后落盘回传 AI（下一轮天然看到：
              // 成功才说成功、失败如实报）。开关 gate 在 executePhoneOp 内（系统设置 → AI 动手，关了直接拒）。
              if (part.action.kind === 'phone-op') {
                const argText = part.action.targetId.trim();
                if (argText) {
                  const cmdName = argText.split(/[:：]/)[0] ?? '';
                  all.push({ id: `${aiMsgId}-sys-${all.length}`, role: 'peer', senderId: char.id, senderName: charName, content: '', time: t, kind: 'notice', noticeText: `${charName} 正在操作手机（${cmdName}）…` });
                  t += 1;
                  void (async () => {
                    let res: { ok: boolean; text: string };
                    try {
                      res = await executePhoneOp(argText);
                    } catch {
                      res = { ok: false, text: '执行器异常（原生桥调用抛错）' };
                    }
                    const sysMsg: WxGroupMsg = { id: `${aiMsgId}-sysres-${Date.now()}`, role: 'peer', senderId: char.id, senderName: charName, content: '', time: Date.now(), kind: 'notice', noticeText: `手机操作${res.ok ? '成功' : '失败'}：${res.text}` };
                    const cur = loadGroupMsgs(gid);
                    saveGroupMsgs(gid, [...cur, sysMsg]);
                    if (mountedRef.current) setMsgs(loadGroupMsgs(gid));
                  })();
                }
                continue;
              }
              // 美团代点（C11 群内帮点外卖）：[帮点外卖:商家ID|菜名x数量,...] → 代点草稿卡
              //（机主确认后才真正下单并自己付；群里不接代付/帮付/请客/自己点）。
              // 成员只帮机主代点：草稿发起人 = 当前发言成员（char），确认入口/订单归属都在机主侧
              if (part.action.kind === 'mt-order-draft') {
                const mtUidInfo = mtEngageSessionUid();
                const mtBody = mtUidInfo ? parseMtOrderBody(part.action.targetId) : null;
                if (mtUidInfo && mtBody) {
                  const mtRes = mtCreateAiDraft({
                    uid: mtUidInfo.uid,
                    merchantId: mtBody.merchantId,
                    items: mtBody.items,
                    note: mtBody.note,
                    charId: char.id,
                    charName: charName,
                    app: 'qq',
                  });
                  if (mtRes.ok) {
                    all.push({
                      id: msgIdx === 0 ? aiMsgId : `${aiMsgId}-${msgIdx}`,
                      role: 'peer',
                      senderId: char.id,
                      senderName: charName,
                      content: `[美团代点]帮你挑了「${mtRes.draft.merchantName}」的外卖，确认后就去下单`,
                      time: t,
                      kind: 'mtdraft',
                      mtdraft: { did: mtRes.draft.id },
                    });
                    msgIdx += 1;
                    t += 600 + Math.floor(Math.random() * 400);
                  }
                }
                continue;
              }
              // 管理标记（禁言/解禁/移出/改群名/改公告）与卡片处理标记（领红包/收转账）分流入各自的执行器
              if (isGroupAdminAction(part.action) || isGroupChatSocialAction(part.action)) applyGroupAdminAction(char, part.action);
              else applyGroupAiAction(char, part.action);
              continue;
            }
            const segs = mergeRichSegments(splitReplySegments(part.text, !asSingle));
            for (const seg of segs) {
              for (const p of parseRichParts(seg, stickersOn ? stickers : [], { group: true })) {
                const id = msgIdx === 0 ? aiMsgId : `${aiMsgId}-${msgIdx}`;
                if (p.type === 'rich') {
                  const isMoney = p.rich.kind === 'redpacket' || p.rich.kind === 'transfer';
                  // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/位置卡片不受影响，与单聊同规则）
                  if (!stickersOn && p.rich.kind === 'sticker') continue;
                  // 发钱节流：同一轮已发过或冷却期内 → 丢弃钱卡（不影响其他内容）
                  if (isMoney && (moneySentThisTurn || inMoneyCooldown)) continue;
                  if (p.rich.kind === 'redpacket') {
                    const count = p.rich.count ?? 1;
                    all.push({
                      id,
                      role: 'peer',
                      senderId: char.id,
                      senderName: charName,
                      content: '',
                      time: t,
                      kind: 'redpacket',
                      rp: {
                        amount: p.rich.amount,
                        count,
                        // 多份红包按拼手气发进群（每人随机一份，与真人玩法一致）；单个 = 普通红包
                        mode: count > 1 ? 'lucky' : 'normal',
                        blessing: p.rich.blessing || '恭喜发财',
                        claims: [],
                        sentAt: Date.now(),
                        cid: nextGroupCid('rp'),
                      },
                    });
                    moneySentThisTurn = true;
                    aiMoneyAt.set(moneyCooldownKey(sKey, char.id), Date.now());
                  } else if (p.rich.kind === 'transfer') {
                    // 收款对象必须解析到群里真实成员（机主或 AI 成员），解析不到不成卡（资金真实性）
                    const target = resolveMemberByName(p.rich.target ?? '');
                    if (!target) continue;
                    all.push({
                      id,
                      role: 'peer',
                      senderId: char.id,
                      senderName: charName,
                      content: '',
                      time: t,
                      kind: 'transfer',
                      tr: { amount: p.rich.amount, note: p.rich.note, toId: target.id, toName: target.name, cid: nextGroupCid('tr') },
                    });
                    moneySentThisTurn = true;
                    aiMoneyAt.set(moneyCooldownKey(sKey, char.id), Date.now());
                  } else if (p.rich.kind === 'location') {
                    // 位置卡片（与用户手动发送同款渲染，全群可见；坐标串解析为经纬度）
                    const locD = locFromRich(p.rich.name, p.rich.coords);
                    all.push({
                      id,
                      role: 'peer',
                      senderId: char.id,
                      senderName: charName,
                      content: '',
                      time: t,
                      kind: 'location',
                      loc: { name: locD.name, address: locD.address || '地图上的一个位置', lat: locD.lat, lng: locD.lng },
                    });
                  } else if (p.rich.kind === 'sticker') {
                    // 表情包（从用户收藏清单按 ID 匹配；找不到时回退显示文字）
                    const sid = p.rich.stickerId;
                    const s = stickers.find((x) => x.id === sid);
                    if (s) {
                      all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: '', time: t, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } });
                    } else {
                      all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: '[表情包]', time: t });
                    }
                  }
                } else {
                  // 首尾清洗：剥掉模型偶尔输出的零宽/盲文空格等「看不见的占位字符」，避免气泡开头出现空隙
                  const cleaned = cleanBubbleText(p.text);
                  if (!cleaned) continue;
                  all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: cleaned, time: t });
                }
                msgIdx += 1;
                t += 600 + Math.floor(Math.random() * 600);
              }
            }
          }
          // 照片标签 → 「文字图片」卡片（追加在本轮文字之后；不生真图不接入库，不管生图配置，见文件头 E1 注释）
          if (photoTags.length > 0) {
            all.push({
              id: msgIdx === 0 ? aiMsgId : `${aiMsgId}-${msgIdx}`,
              role: 'peer',
              senderId: char.id,
              senderName: charName,
              content: '',
              time: t,
              kind: 'textcard',
              card: { text: photoTags[0].desc },
            });
            msgIdx += 1;
            t += 600 + Math.floor(Math.random() * 600);
          }
          return all;
        };
        /** 流中分段照片标签 carry-over（E1 防截断）：[图片:xxx] 被分段器切成两半时，未闭合的尾部
         *  留在本变量，与下一段拼接后再解析；回合收尾（finalize）拼回最后一段或剥除残留。
         *  用回合级闭包变量而非组件 ref：每个成员回合是独立流，随回合生命周期自动消亡，
         *  流错误中断时残留自动丢弃，无跨回合污染。 */
        let photoCarry = '';
        /** 流中分段投递：分段器每凑齐一条完整消息回调一次，立刻解析并排队上屏（边接收边逐条显示） */
        const deliverSegment = (seg: string) => {
          // E1：每段进入解析前先拼接上一段遗留的未闭合标签起始，再把新的未闭合尾部截出留存
          const merged = photoCarry + seg;
          const { send, carry } = splitUnfinishedPhotoTag(merged);
          photoCarry = carry;
          const built = buildGroupReplyMsgs(send, false, Date.now());
          if (built.length === 0) return;
          deliveredAny = true;
          onSegmentDelivered?.(built.length); // audit4-L14：通知直调方本轮已有分段排队投递（error 收口判定用）
          enqueueBatch(built);
        };

        const ok = beginChatStream({
          sessionKey: sKey,
          aiMsgId,
          messages,
          apiConfig,
          replyCount,
          // 配置识图模型后：群里发的图片先识图，成员结合图片按人设回复（与单聊同管线）
          ...(turnImageSrcs.length > 0
            ? {
                // fix3-e⑨：识图描述带发言者前缀（群里是机主发的图；库侧追加消息改为「{speakerLabel}发了 N 张图片…」）
                vision: { images: turnImageSrcs.map((x) => x.src), text: lastUserText, speakerLabel: `${meName}（机主）` },
                // 多图识图（#25）：一次识图返回的完整描述按「图N：」分行拆到本回合各张图片
                // （splitVisionDesc 返回长度恒等于图片数），每张图的 img.desc 各自持久化，
                // 之后的聊天历史里每张图都有内容可读，不再把整段描述只挂到最后一张
                onVision: (desc: string) => {
                  const parts = splitVisionDesc(desc, turnImageSrcs.length);
                  turnImageSrcs.forEach((t, i) => {
                    const d = (parts[i] ?? '').trim();
                    if (!d) return;
                    patchGroupMsg(t.id, { img: { ...(loadGroupMsgs(gid).find((m) => m.id === t.id)?.img ?? { src: t.src }), desc: d } });
                  });
                },
              }
            : {}),
          // 边接收边逐条显示：分段器每凑齐一条完整消息立刻解析投递（多条模式）
          onSegment: deliverSegment,
          finalize: (result) => {
            // #21 流失败（网络/接口错误）：本轮不落任何成员消息（也不走「（…）」占位兜底，
            // 避免 N 个成员挨个发假消息污染聊天历史和记忆），结果标记为 'error' 交给
            // runGroupTurn 统一收口——整轮无人成功时才落一条系统提示
            if (result.error) {
              // Task 40：把流失败的原始错误带出（ref 中转 → runGroupTurn 收口分类/记录）；
              // resolve('error') 的取值语义不变，regenerate/级联等消费点零扰动
              lastTurnErrRef.current = result.error;
              resolve('error');
              return;
            }
            const text = (result.content ?? '').trim();
            // 人设自判沉默：整条回复是 [SKIP] 标记 → 不落盘、不提取记忆（本轮对 TA 没有发生任何社交事件）
            if (allowSkip && SKIP_RE.test(text)) {
              resolve('skip');
              return;
            }
            // 多条模式：流中分段已通过 onSegment 逐条解析投递上屏（边接收边逐条显示），
            // 这里只处理剩余的最后一条（N 条上限的第 N 条）；单条模式：整条回复按旧管线落盘。
            // E1：收尾先把流中遗留的未闭合标签起始（photoCarry）拼回最后一段再解析；
            // 至此仍无法闭合的残留（服务端截断）由 stripUnfinishedPhotoTag 兜底剥除，不上屏
            const mergedTail = photoCarry + (replyCount > 1 ? (result.tail ?? '') : result.content);
            photoCarry = '';
            const built = buildGroupReplyMsgs(stripUnfinishedPhotoTag(mergedTail), replyCount <= 1, Date.now());
            // 剩余为空且流中也没有任何分段/动作产出 = 该成员本轮无话可说（新版不再落「（…）」占位兜底，
            // 模板文字从聊天记录消失）：按沉默收尾（不投递、不触发级联），与 [SKIP] 同语义
            if (built.length === 0 && !deliveredAny) {
              resolve('skip');
              return;
            }
            const finalBatch: WxGroupMsg[] = built;
            // 逐条投递（模拟真人连发）：每条到达时才落盘上屏 + 弹灵动岛通知 + 判定语音频率，停顿按内容长度
            // 模拟打字节奏；空批仅作占位，群记忆提取挂在全部消息投递完之后；
            // 调度器在模块层运行，与群聊页是否存活无关；同会话批次串行排队，不同角色回合不会交错
            void scheduleAiDelivery<WxGroupMsg>(
              sKey,
              finalBatch,
              deliverGroupMsg,
              {
                initialDelay: finalBatch.length > 0 ? (batchStarted ? typingDelayOf(finalBatch[0].content ?? '') : 0) : 0,
                delay: (i) => (i + 1 < finalBatch.length ? typingDelayOf(finalBatch[i + 1].content ?? '') : 0),
              },
            ).then(() => {
              // B1 群聊深度思考回填：本回合该成员的思考过程挂到其第一条消息（id=aiMsgId，分段模式
              // 下第一条分段同样用该 id）；开关关闭时字段照存不渲染（与单聊/微信群同口径，重开可回看）
              const thinkText = (result.thinking ?? '').trim();
              if (thinkText) patchGroupMsg(aiMsgId, { thinking: thinkText });
              // 群记忆提取（按角色 + 按群隔离轮次；碎片带群来源标记；全部消息投递完后执行，后台异步失败静默）
              void (async () => {
                try {
                  // 多账号 v2：QQ 群记忆按 QQ App 当前账号取「我」的真名
                  const [u, p] = await Promise.all([ownerRealNameFor('qq'), contactRealName(char.id)]);
                  memAfterAiTurn(
                    char.id,
                    'qq',
                    apiConfig,
                    () =>
                      loadGroupMsgs(gid)
                        // #21 「（…）」空回复占位不进记忆素材（精确匹配占位串；不加 error 标记避免影响气泡 UI）
                        .filter((m) => m.kind !== 'notice' && !m.recalled && m.content !== '（…）')
                        .slice(-30)
                        .map((m): { role: 'me' | 'peer'; text: string; speakerPrefixed?: boolean } =>
                          m.role === 'me'
                            ? { role: 'me', text: msgTextOf(m) }
                            // #9 peer 消息客户端已拼「发言人：」前缀：逐条带 speakerPrefixed=true，
                            // /api/memory/extract 据此跳过 peerName 前缀（不再「陈默：陈默：火锅！」）
                            : { role: 'peer', text: `${m.senderName}：${msgTextOf(m)}`, speakerPrefixed: true }
                        ),
                    // 消息计数锚点用：未 slice/map 的有效消息数组（群消息流，含其他成员的消息）
                    () => loadGroupMsgs(gid).filter((m) => m.kind !== 'notice' && !m.recalled),
                    { user: u, peer: p },
                    {
                      roundScope: `group:${gid}`,
                      group: {
                        id: gid,
                        members: [me.id, ...groupRef.current.memberIds],
                        // 群记忆成员名（#12 / fix3-e④）：只放 AI 成员显示名（与转写「成员：」前缀同源）——
                        // 机主名由 names.user（真名）承担，转写里机主行前缀由服务端按真名补；
                        // 此处再放机主称呼名会成幽灵成员（称呼名≠真名时归因错乱），已移除
                        memberNames: [
                          ...new Set(
                            groupRef.current.memberIds
                              .map((id) => {
                                const rec = contactsRef.current.find((c) => c.id === id);
                                return rec ? memberNameOf(rec) : '';
                              })
                              .filter(Boolean)
                          ),
                        ],
                      },
                    }
                  );
                } catch {
                  // 名字解析失败不影响落盘
                }
              })();
            });
            resolve('ok');
          },
        });
        if (!ok) {
          resolve('skip'); // 会话流被占用（不应发生：队列串行 + 防重入）；未落盘任何消息，不消耗语音计数
        }
      }),
    [apiConfig, appendMsg, applyGroupAdminAction, applyGroupAiAction, collectGroupPending, gid, me.id, me.name, ownerLabelOf, patchGroupMsg, sKey]
  );

  /** 一个群回合：@ 成员必答优先，其余成员逐个按人设自判是否发言（无话可说 [SKIP] 沉默）。
   *  trigger 可省略（分句发送批次触发/红包/转账卡片入群时无文字可 @）：此时全员按人设自判。
   *  兜底约定（异常与边界）：全员都 [SKIP] 时不落盘不提示（真实群聊发消息也可能没人接）；
   *  单条回复为空时 finalize 已有占位兜底；整轮无任何成员成功产出且存在流错误时落一条
   *  「网络开小差」系统提示（#21）；群已解散/无成员时静默返回。
   *  中途变动（audit-chat #6）：成员名单/禁言表只在回合开始算一次，循环内每次开口前由
   *  runCharTurn 入口与本循环守卫重读群当前成员表/禁言表（getGroup 现读存储）——回合进行中
   *  被 [移出群聊]/[禁言] 的成员本轮不再开口（被 @ 也不豁免）。 */
  const runGroupTurn = useCallback(
    async (trigger?: WxGroupMsg) => {
      if (runningRef.current || isChatStreaming(sKey)) return;
      // #7 投递边界保护：上一轮的连发投递尾巴还没落库完时不开新回合（延迟重试）——新回合
      // beginChatStream 会清除投递插入边界，尾巴未清就开流会让旧回复落库到用户新消息之后
      // （倒挂随存储持久化）；等尾巴按边界归位（插到用户消息之前）落库完再起本轮，
      // 与单聊「流收尾且投递完毕再补跑」同口径
      if (isAiDelivering(sKey)) {
        window.setTimeout(() => void runGroupTurn(trigger), 400);
        return;
      }
      const g = getGroup(gid);
      if (!g) return; // 群已解散：无会话可提示，静默返回
      if (g.memberIds.length === 0) {
        // #25 空群零反馈修复：群里只剩机主（AI 成员已全部移出/未拉人）时发消息不再石沉大海，
        // 落一条群系统提示（notice 不进 AI 上下文也不进记忆，样式同下方网络错误提示行）
        appendMsg({
          id: uid(),
          role: 'me',
          senderId: 'me',
          senderName: '',
          content: '',
          time: Date.now(),
          kind: 'notice',
          noticeText: '群里暂时没有人能回复',
        });
        return;
      }
      runningRef.current = true;
      try {
        expireStalePackets(); // 每轮开始前先清算过期红包（终态不可再改）
        // 六.5 禁言执行：被禁言的成员本轮不能发言（被 @ 也不行，物理禁言；禁言过期自动恢复）
        const fresh = getGroup(gid) ?? g;
        const all = fresh.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => !isGroupMuted(fresh, c.id));
        // #24 被 @ 也要与本轮可发言名单求交集：被 @ 不豁免物理禁言（all 已过滤禁言成员）；
        // 这层交集同时挡住「被踢出群的成员残留在 mention 解析来源里」——parseMentions 读组件
        // state members（踢人后靠 onUpdate({}) 触发宿主刷新），可能短暂滞后于群成员变动
        const mentioned = (trigger ? parseMentions(trigger.content) : []).filter((m) => all.includes(m));
        const ordered =
          mentioned.length > 0 ? [...mentioned, ...all.filter((m) => !mentioned.includes(m))] : all;
        if (ordered.length === 0) {
          // #25 全员禁言零反馈修复：本轮没有人能开口也落一条系统提示（notice 不进 AI 上下文不进记忆）；
          // 空路径提前收口，finally 的排队补跑照常走（下一轮再试，禁言到期自然恢复）
          appendMsg({
            id: uid(),
            role: 'me',
            senderId: 'me',
            senderName: '',
            content: '',
            time: Date.now(),
            kind: 'notice',
            noticeText: '群里暂时没有人能回复',
          });
          return;
        }
        // 识图输入：从末尾向前收集连续「我」发的图片（最多 3 张，与单聊同规则；带消息 id，供规则排除与描述回写落盘）
        const turnImageSrcs: { src: string; id: string }[] = [];
        const persisted = loadGroupMsgs(gid);
        for (let i = persisted.length - 1; i >= 0 && turnImageSrcs.length < 3; i--) {
          const m = persisted[i];
          if (m.role !== 'me') break;
          if (m.kind === 'image' && m.img?.src) turnImageSrcs.unshift({ src: m.img.src, id: m.id });
        }
        // 收集每个成员的回合结果（#21）：'ok'=有产出 / 'skip'=自判沉默等 / 'error'=流失败
        const results: ('ok' | 'skip' | 'error')[] = [];
        lastTurnErrRef.current = ''; // Task 40：清上一轮错误中转，防旧错误串轮
        // #27 级联素材：本轮最后一条 AI 成功发言（发言人 id + 消息文本），供回合结束后解析 @ 提及
        let lastOkMsg: { senderId: string; text: string } | null = null;
        for (const char of ordered) {
          // 中途变动守卫（audit-chat #6）：每次开口前重读群当前状态（getGroup 现读存储，非回合开始
          // 快照）——群已解散 → 整轮终止；前面成员的 [移出群聊]/[禁言] 管理标记当场生效后，排在
          // 后面的被踢/被禁言成员本轮不再开口（被 @ 也不豁免，与回合开始的禁言过滤同一物理拦截口径）
          const gNow = getGroup(gid);
          if (!gNow) break; // 群已被解散
          if (!gNow.memberIds.includes(char.id) || isGroupMuted(gNow, char.id)) continue;
          groupSpeaker.set(sKey, char.id);
          if (mountedRef.current) setSpeakerId(char.id);
          const r = await runCharTurn(char, !mentioned.includes(char), turnImageSrcs);
          results.push(r);
          // #27 级联素材：该成员本轮最后一条产出消息（已落盘或在投递队列尾巴），供回合结束后解析 @ 提及
          if (r === 'ok') {
            const produced = sortMsgsByTime(
              [...loadGroupMsgs(gid), ...peekPendingMsgs<WxGroupMsg>(sKey)].filter(
                (x) => x.role === 'peer' && x.senderId === char.id && !x.recalled && x.kind !== 'notice',
              ),
            );
            const lastM = produced[produced.length - 1];
            if (lastM) lastOkMsg = { senderId: char.id, text: msgTextOf(lastM) };
          }
          await sleep(420);
        }
        // #21 整轮没有任何成员成功产出且存在流错误：新版不再落「（网络开小差了…）」系统提示行——
        // 改为在触发消息（本轮用户消息）上打 replyFail 红色 ! 徽标（点击可重试整轮）；
        // 无触发消息（分句批次/红包转账卡片触发）时保持静默。部分成员成功时保持静默——
        // 那几位只是没说话，符合真实群聊，也不给聊天记录添噪音
        if (results.length > 0 && !results.includes('ok') && results.includes('error')) {
          if (trigger && loadGroupMsgs(gid).some((x) => x.id === trigger.id)) {
            // Task 40「错误提示优化」：错误分类为友好文案（failReason 随徽标/灰字行渲染）+
            // 记录失败（连续失败进入重试冷却；原始错误仅存内存供「复制错误详情」，不落库）
            const rawErr = lastTurnErrRef.current;
            patchGroupMsg(trigger.id, { replyFail: true, failReason: classifyChatError(rawErr).text });
            recordChatFail(sKey, rawErr);
          }
        } else if (results.includes('ok')) {
          // 有任何成员产出：清除触发消息上的失败徽标（重试成功场景）；Task 40：同步清失败计数/冷却与错误详情
          recordChatSuccess(sKey);
          if (trigger?.replyFail) patchGroupMsg(trigger.id, { replyFail: undefined, failReason: undefined });
        }
        // #27 AI 成员回复 @ 其他成员 → 轻量级联必答：解析本轮最后一条 AI 成功发言里的 @ 提及
        //（parseMentions 只匹配 AI 成员名，天然排除机主与发言者本人），命中且仍在群、未被禁言、
        // 5 分钟冷却通过 → 80ms 后对被 @ 成员跑一轮自判回合（allowSkip=true，人设自决接不接话）。
        // 防刷屏三保险：单回合最多触发 1 个级联；同成员 5 分钟冷却（模块级 groupCascadeAt）；
        // groupCascadeDepth>0（级联回合进行中）不再触发，不会 A@B → B@C → … 无限链。
        const cascadeSrc = lastOkMsg;
        if (cascadeSrc && groupCascadeDepth === 0) {
          const gEnd = getGroup(gid);
          const cascadeTargets = gEnd
            ? parseMentions(cascadeSrc.text).filter(
                (c) => c.id !== cascadeSrc.senderId && gEnd.memberIds.includes(c.id) && !isGroupMuted(gEnd, c.id),
              )
            : [];
          const target = cascadeTargets[0]; // 单回合最多 1 个级联
          if (target) {
            const coolKey = `${gid}:${target.id}`;
            if (Date.now() - (groupCascadeAt.get(coolKey) ?? 0) >= GROUP_CASCADE_COOLDOWN_MS) {
              groupCascadeAt.set(coolKey, Date.now());
              window.setTimeout(() => {
                if (runningRef.current || isChatStreaming(sKey)) return;
                // 80ms 窗口内群可能解散/成员变动/被禁言（AI 管理标记随时生效），触发前再核一次
                const gNow = getGroup(gid);
                if (!gNow || !gNow.memberIds.includes(target.id) || isGroupMuted(gNow, target.id)) return;
                const cascadeChar = contactsRef.current.find((c) => c.id === target.id) ?? null;
                if (!cascadeChar) return;
                groupCascadeDepth = 1; // 深度标记：级联回合内（含投递尾巴等待）不再触发下一跳
                // #7/#35 旁路回合双保险：a) 开新流前等连发投递尾巴落库完（延迟重试）——
                // beginChatStream 会清投递插入边界，尾巴未清就开流会让旧回复倒挂在排队用户消息之后；
                // 等待中被其他回合占用则放弃（与原守卫同口径），级联深度标记一并复位。
                // b) 回合收尾检查排队补跑标记（runGroupTurn finally 同款兜底）。
                const kickCascade = () => {
                  if (runningRef.current || isChatStreaming(sKey)) {
                    groupCascadeDepth = 0;
                    return;
                  }
                  if (isAiDelivering(sKey)) {
                    window.setTimeout(kickCascade, 400);
                    return;
                  }
                  groupSpeaker.set(sKey, target.id);
                  if (mountedRef.current) setSpeakerId(target.id);
                  void runCharTurn(cascadeChar, true, []).finally(() => {
                    groupCascadeDepth = 0;
                    groupSpeaker.delete(sKey);
                    if (mountedRef.current) setSpeakerId(null);
                    // #35 旁路回合排队补跑：级联回合进行中用户发过消息（排队标记+toast 承诺）
                    // → 同款兜底补跑，不让排队消息石沉大海
                    if (groupQueuedRef.current) {
                      groupQueuedRef.current = false;
                      kickMakeup();
                    }
                  });
                };
                kickCascade();
              }, 80);
            }
          }
        }
      } finally {
        runningRef.current = false;
        groupSpeaker.delete(sKey);
        if (mountedRef.current) setSpeakerId(null);
        // 排队补跑：回合进行中用户又发了消息 → 本回合结束后自动再起一轮（消息已在群消息库，成员都能看到）。
        // #35 走 kickMakeup 统一入口：撞上占用中的回合（级联/催促等旁路回合）时改回排队标记自愈，
        // 不再静默丢弃（「回完这轮就聊」承诺兑现）；lastMe 由补跑现场重读（等待期间可能又有新消息）
        if (groupQueuedRef.current) {
          groupQueuedRef.current = false;
          if (getGroup(gid)) kickMakeup();
        }
      }
    },
    [appendMsg, expireStalePackets, gid, runCharTurn, sKey, patchGroupMsg]
  );
  runGroupTurnRef.current = runGroupTurn;

  /** 红色 ! 徽标/失败灰字行重试：整轮群回复失败的消息点击后重跑群回合（占用时静默，徽标保留可再点；
   *  任一成员产出后由 runGroupTurn 收口清除标记）。Task 40 冷却拦截：连续失败进入冷却后不再立刻
   *  发请求（toast 剩余秒数；用户发新消息不受限） */
  const retryGroupTurn = (m: WxGroupMsg) => {
    if (runningRef.current || isChatStreaming(sKey) || isAiDelivering(sKey)) return;
    const cd = cooldownRemainText(sKey);
    if (cd) {
      onToast(cd);
      return;
    }
    void runGroupTurn(m);
  };

  /** 排队补跑统一入口（#35）：500ms 后按最后一条机主消息起一轮补跑回合；撞上占用中的回合
   *  （级联/催促/重新生成等旁路回合，或下一个正常回合）时改回排队标记，由占用回合收尾时的
   *  排队检查重新触发——自愈不丢承诺（「回完这轮就聊」toast）；lastMe 在补跑现场重读，
   *  等待期间用户又发的消息一并覆盖。投递尾巴未清时由 runGroupTurn 入口的延迟重试兜住（#7）。 */
  const kickMakeup = () => {
    window.setTimeout(() => {
      if (runningRef.current || isChatStreaming(sKey)) {
        groupQueuedRef.current = true; // 占用中：改回排队标记，占用回合收尾时重新触发补跑
        return;
      }
      const lastMe = [...loadGroupMsgs(gid)].reverse().find((m) => m.role === 'me');
      if (lastMe && getGroup(gid)) runGroupTurnRef.current(lastMe);
    }, 500);
  };

  /** 相机/相册选图（需求2 发图先预览）：只读图压缩进输入框下方预览条暂存，不直接发出、不触发任何回复；
   *  暂存总数上限 9 张（超出 toast「一次最多发 9 张图片」，放得下的照收），单张读取失败沿用原
   *  「图片发送失败」toast，失败的图不进预览 */
  const stageImageFiles = async (files: FileList) => {
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const list = Array.from(files);
    if (list.length === 0) return;
    const room = 9 - pendingImgs.length;
    if (room <= 0) {
      onToast('一次最多发 9 张图片');
      return;
    }
    const batch = list.slice(0, room);
    if (list.length > room) onToast('一次最多发 9 张图片');
    const staged: Array<{ id: string; src: string }> = [];
    for (const f of batch) {
      try {
        const d = await readImageFile(f);
        staged.push({ id: uid(), src: d });
      } catch {
        onToast('图片发送失败');
      }
    }
    if (staged.length > 0) setPendingImgs((prev) => [...prev, ...staged]);
  };

  /** 预览条待发图/主发送按钮真正发图：逐张转图片消息上屏 → 清空预览 → 回合进行中排队补跑
   *  （与文字消息同款「回完这轮就聊」toast）→ 分句发送开启只入列不触发回复 → 否则触发群 AI 回合
   *  （trigger=最后一张图，与旧版直发逻辑一致；未配置识图模型也照常触发，#26） */
  const flushPendingImages = () => {
    if (pendingImgs.length === 0) return;
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const created: WxGroupMsg[] = pendingImgs.map((p) => ({
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'image',
      img: { src: p.src },
    }));
    setPendingImgs([]);
    for (const m of created) appendMsg(m);
    if (runningRef.current || isChatStreaming(sKey)) {
      // 成员们还在回复：图片照常发出并入队，本回合结束后自动再起一轮（与文字消息同款）
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    // 分句发送开启：只入列不触发回复（与文字消息同规则）
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    // 未配置识图模型也照常触发回复（#26）：chat-stream-store 会注入「我发了图片但你看不到内容」
    // 的临时上下文，成员按人设自然回应，不再让发图石沉大海
    runGroupTurnRef.current(created[created.length - 1]);
  };

  /** 分句发送批次触发：把已发出的整批消息交给成员统一回复（输入框为空时点「发送」）。
   *  B-7：回合进行中不再硬挡丢弃——与文字消息同口径入 groupQueuedRef 排队补跑（批次消息已在
   *  群消息库，补跑时内容完整可见，runGroupTurn finally 按 lastMe 触发整批回复），
   *  并清掉待派发标记防止补跑后重复触发。 */
  const dispatchBatch = () => {
    if (!pendingDispatch) return;
    setPendingDispatch(false);
    markPendingBatch(sKey, false);
    if (runningRef.current || isChatStreaming(sKey)) {
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    const persisted = loadGroupMsgs(gid);
    const lastMe = [...persisted].reverse().find((m) => m.role === 'me');
    void runGroupTurn(lastMe);
  };

  const send = () => {
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const text = draft.trim();
    // 空输入点「发送」= 先发预览条待发图（需求2 发图先预览）；无图再触发分句发送批次回复（分句开启且有未回复的批次时）
    if (!text) {
      if (pendingImgs.length > 0) {
        // 发送提示音（纯图发送也走「发送消息」分类）
        playNotifySound('send');
        flushPendingImages();
        return;
      }
      if (sentenceSend && pendingDispatch) dispatchBatch();
      return;
    }
    // 发送提示音（设置 › 通知可配；文字/组合/转语音共用的发送链入口）
    playNotifySound('send');
    // 组合发送：输入框有文字且预览条有待发图 → 文字消息在前、图片在后一起上屏+落盘，只触发一轮群回复。
    //  触发方式照 flushPendingImages 对齐（runGroupTurnRef(trigger)）；trigger 用文字消息——@ 提及从
    //  trigger.content 解析，传最后一张图（content 为空）会丢 @ 必答；图片已落群消息库，
    //  识图按「从末尾向前收集连续我发图片」自动带上（文字在前图片在后，识图窗口不被截断）。
    //  组合时文字按普通文字消息发出（ttsSend 只对纯文字生效：语音气泡异步落屏会让图片/语音顺序颠倒，
    //  且语音消息会截断识图窗口）
    if (pendingImgs.length > 0) {
      const textMsg: WxGroupMsg = {
        id: uid(),
        role: 'me',
        senderId: 'me',
        senderName: me.name,
        content: text,
        time: Date.now(),
        quote: quote ?? undefined,
      };
      const created: WxGroupMsg[] = pendingImgs.map((p) => ({
        id: uid(),
        role: 'me',
        senderId: 'me',
        senderName: me.name,
        content: '',
        time: Date.now(),
        kind: 'image',
        img: { src: p.src },
      }));
      setPendingImgs([]);
      setDraft('');
      clearChatDraft('qq-group', gid); // Task 40 草稿箱：发送即清草稿（发送失败时草稿仍在，重进不丢）
      setQuote(null);
      for (const m of [textMsg, ...created]) appendMsg(m);
      if (runningRef.current || isChatStreaming(sKey)) {
        // 成员们还在回复：整批消息照常发出并入队，本回合结束后自动再起一轮（与文字消息同款）
        groupQueuedRef.current = true;
        onToast('消息已发出，成员们回完这轮就聊');
        return;
      }
      // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发
      if (sentenceSend) {
        setPendingDispatch(true);
        markPendingBatch(sKey, true);
        return;
      }
      runGroupTurnRef.current(textMsg);
      return;
    }
    // 文字转语音发送：合成语音气泡（transcript 带原文，AI 直接读得到内容）；失败只 toast 不发文字
    if (ttsSend) {
      sendTextAsVoiceRef.current(text);
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: text,
      time: Date.now(),
      quote: quote ?? undefined,
    };
    setDraft('');
    clearChatDraft('qq-group', gid); // Task 40 草稿箱：与文字发送同口径清草稿
    setQuote(null);
    if (runningRef.current || isChatStreaming(sKey)) {
      // 成员们还在回复：消息照常发出并排队，本回合结束后自动再起一轮（不再拦截后让用户重发）
      appendMsg(msg);
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    appendMsg(msg);
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字（与微信单聊/群聊同套共享组件） ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音只有 dataURL） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[]; localText?: string };

  /** 语音消息落库：入列 → 直发语音先自动转写（成员读内容）再触发群回合；已有转写直接触发；
   *  禁言拦截；回合进行中则只落库并排队 */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      if (meMuted) {
        onToast('你已被禁言，暂时无法发言');
        return;
      }
      const hasText = typeof presetTranscript === 'string' && presetTranscript.trim().length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, stt: 'pending' };
      const msg: WxGroupMsg = { id: uid(), role: 'me', senderId: 'me', senderName: me.name, content: '', time: Date.now(), kind: 'voice', voice };
      appendMsg(msg);
      /** 触发群回合（回合进行中则排队补跑）；转写完成后再触发，成员才能读到语音内容 */
      const kickTurn = () => {
        if (runningRef.current || isChatStreaming(sKey)) {
          groupQueuedRef.current = true; // 成员们还在回复：这轮结束后自动补跑
          return;
        }
        window.setTimeout(() => runGroupTurnRef.current?.(), 80);
      };
      if (hasText) {
        kickTurn();
        return;
      }
      // 直发语音：先自动转写（成员当轮就能读到内容），成功回填 transcript 后触发回合；
      // 失败/超时也照常触发——成员按「语音占位」防编造规则回应，不假装听过
      void autoTranscribeForAi(clip.blob).then((text) => {
        patchGroupMsg(msg.id, {
          voice: text
            ? { ...voice, transcript: text, stt: 'done' as const }
            : { ...voice, stt: 'failed' as const },
        });
        window.setTimeout(kickTurn, 150);
      });
    },
    [appendMsg, me.name, meMuted, onToast, patchGroupMsg, sKey],
  );

  /** 「划到转文字」松开后：先识别再预览，由用户决定发送文字 / 发送语音（原始录音）/ 取消 */
  const sttPreview = useSttPreview({
    onSendText: (text) => {
      const msg: WxGroupMsg = { id: uid(), role: 'me', senderId: 'me', senderName: me.name, content: text, time: Date.now() };
      if (runningRef.current || isChatStreaming(sKey)) {
        appendMsg(msg);
        groupQueuedRef.current = true;
        onToast('消息已发出，成员们回完这轮就聊');
        return;
      }
      appendMsg(msg);
      if (sentenceSend) {
        setPendingDispatch(true);
        markPendingBatch(sKey, true);
        return;
      }
      runGroupTurnRef.current?.(msg);
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
        if (!result && zone === null) onToast('说话时间太短');
        return;
      }
      if (meMuted) {
        onToast('你已被禁言，暂时无法发言');
        return;
      }
      if (zone === 'stt') {
        // 划到「转文字」：先识别并预览，用户决定发送文字 / 发送语音 / 取消（不再直接发送）
        sttPreview.open(result);
        return;
      }
      // 原松开：语音气泡入列（附带 Web Speech 实时转写如有）；无转写由 commitVoiceMsg 自动补识别，再触发回合
      void blobToDataUrl(result.blob).then((dataUrl) =>
        commitVoiceMsg({ blob: result.blob, dataUrl, duration: result.duration, wave: result.wave }, result.transcript),
      );
    },
    [appendMsg, commitVoiceMsg, meMuted, onToast, sKey, sttPreview.open],
  );

  const rec = useVoiceRecorder({ onResult: handleVoiceOutcome, onStartError: (m) => onToast(m) });

  /** 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）；失败只 toast，不当聊天内容 */
  const sendTextAsVoice = useCallback(
    (text: string) => {
      setDraft('');
      clearChatDraft('qq-group', gid); // Task 40 草稿箱：与文字发送同口径清草稿
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => onToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, gid, onToast],
  );
  sendTextAsVoiceRef.current = sendTextAsVoice;

  /** 表情面板点选发送（表情包消息按群聊会话独立保存；成员结合表情含义按人设回应）。
   *  B-7：回合进行中与文字消息同口径——表情照常上屏并入队，本回合结束后自动补跑（不再硬挡丢弃）。 */
  const sendSticker = (s: Sticker) => {
    setStickerOpen(false);
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    // 发送提示音（表情也走「发送消息」分类）
    playNotifySound('send');
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'sticker',
      stk: { url: s.url, meaning: s.meaning },
    };
    if (runningRef.current || isChatStreaming(sKey)) {
      // 成员们还在回复：入队，本回合结束后自动再起一轮（runGroupTurn finally 按 lastMe 补跑）
      appendMsg(msg);
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    appendMsg(msg);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  /** 发送位置卡片消息（内置地点/自定义位置；群里所有角色都能看到）。
   *  B-7：回合进行中与文字消息同口径——位置照常上屏并入队，本回合结束后自动补跑（不再硬挡丢弃）。 */
  const sendLocation = (name: string, address: string, coords?: { lat?: number; lng?: number }) => {
    setPlusOpen(false);
    setCompose(null);
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'location',
      loc: { name, address, lat: coords?.lat, lng: coords?.lng },
    };
    if (runningRef.current || isChatStreaming(sKey)) {
      // 成员们还在回复：入队，本回合结束后自动再起一轮（runGroupTurn finally 按 lastMe 补跑）
      appendMsg(msg);
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    appendMsg(msg);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  // ---------------- 群红包/转账（纯本地模拟，不涉及真实资金；复用单聊同一套页面/卡片组件） ----------------

  /** 群红包提交（单聊 RedPacketCompose 群模式产出 MsgPacket）：换算成群红包数据 → 预检/验证/扣款 → 落卡消息 → 群回合 */
  const submitGroupRp = (p: MsgPacket, methodId: string) => {
    if (p.type !== 'redpacket') return;
    const mode: GroupRpData['mode'] = p.mode === 'dedicated' ? 'exclusive' : p.mode ?? 'normal';
    const total = groupRpTotal(mode, p.amount, p.count ?? 1);
    if (!canPay(methodId, total)) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = loadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'redpacket', label: '发红包', amount: total, methodId, packet: p });
      return;
    }
    execGroupRp(p, methodId);
  };

  const execGroupRp = (p: MsgPacket, methodId: string) => {
    if (p.type !== 'redpacket') return;
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const mode: GroupRpData['mode'] = p.mode === 'dedicated' ? 'exclusive' : p.mode ?? 'normal';
    const total = groupRpTotal(mode, p.amount, p.count ?? 1);
    if (!executePayment(methodId, total, '红包')) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '余额不足，请更换支付方式');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'redpacket',
      rp: {
        amount: p.amount,
        count: mode === 'exclusive' ? 1 : p.count ?? 1,
        mode,
        blessing: p.note || '恭喜发财',
        targetId: mode === 'exclusive' ? p.toId : undefined,
        targetName: mode === 'exclusive' ? p.toName : undefined,
        claims: [],
        sentAt: Date.now(),
        cid: nextGroupCid('rp'),
      },
    };
    setLayer(null);
    appendMsg(msg);
    onToast(mode === 'exclusive' && p.toName ? `专属红包已发给${p.toName}` : `红包已发出 ${fmtMoney(total)} 元`);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  const execGroupTr = (amount: number, note: string, member: ContactRecord, methodId: string) => {
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    if (!executePayment(methodId, amount, '转账')) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '余额不足，请更换支付方式');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'transfer',
      tr: { amount, note, toId: member.id, toName: memberNameOf(member), cid: nextGroupCid('tr') },
    };
    setLayer(null);
    appendMsg(msg);
    onToast(`已向 ${memberNameOf(member)} 转账 ${fmtMoney(amount)} 元`);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  /** 我领取成员发的红包（开箱「開」）：金额入钱包+记账单+领取记录+通知行 → 进详情；专属红包只给被指定成员 */
  const claimGroupRp = (msgId: string) => {
    const m = loadGroupMsgs(gid).find((x) => x.id === msgId);
    if (!m?.rp) return;
    const rp = m.rp;
    if (rp.mode === 'exclusive' && rp.targetId) {
      onToast(`这是发给${rp.targetName}的专属红包`);
      setLayer({ view: 'rp-detail', msgId });
      return;
    }
    if (rp.expired || rp.claims.length >= rp.count || rp.claims.some((c) => c.contactId === 'me')) {
      setLayer({ view: 'rp-detail', msgId });
      return;
    }
    const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
    const left = rp.count - rp.claims.length;
    const amt = rp.mode === 'lucky' ? (left > 1 ? splitLuckyAmount(remaining, left) : remaining) : rp.amount;
    patchGroupMsg(msgId, { rp: { ...rp, claims: [...rp.claims, { contactId: 'me', name: me.name, avatar: me.avatar, amount: amt, ts: Date.now() }] } });
    gainToWallet(amt, '红包');
    appendFundNotice('rp', `你领取了${m.senderId === 'me' ? '自己发的' : m.senderName || '群友'}的`, '红包');
    // 用户领取后成员不再自动跟发回应；感知来自群历史卡片终态（claims/已收款/已退回）序列化与既有记忆管线
    setLayer({ view: 'rp-detail', msgId });
  };

  /** 红包卡片点击：成员发的未领完且我能领 → 先开箱；其余直接进详情 */
  const openRpMsg = (m: WxGroupMsg) => {
    const rp = m.rp;
    if (!rp) return;
    const claimable = m.senderId !== 'me' && !rp.expired && rp.claims.length < rp.count && !rp.claims.some((c) => c.contactId === 'me') && rp.mode !== 'exclusive';
    if (claimable) {
      setLayer({ view: 'rp-open', msgId: m.id });
      return;
    }
    if (rp.mode === 'exclusive' && m.senderId !== 'me' && !rp.claims.some((c) => c.contactId === 'me') && !rp.expired && rp.claims.length < rp.count) {
      onToast(`这是发给${rp.targetName}的专属红包`);
    }
    setLayer({ view: 'rp-detail', msgId: m.id });
  };

  /** 我收款：成员（AI）转账给我的卡片 → 状态已收款 + 金额入钱包（记账单）+ 通知行。
   *  用户操作后成员不再自动跟发回应；感知来自群历史卡片终态（claims/已收款/已退回）序列化与既有记忆管线 */
  const receiveGroupTr = (m: WxGroupMsg) => {
    const tr = m.tr;
    if (!tr || tr.toId !== 'me' || tr.received || tr.status) return;
    patchGroupMsg(m.id, { tr: { ...tr, received: true, receivedAt: Date.now() } });
    gainToWallet(tr.amount, '转账');
    appendFundNotice('tr', `你收下了${m.senderName || '群友'}发的`, '转账');
    setLayer(null);
    onToast(`已收款 ${fmtMoney(tr.amount)} 元`);
  };

  /** 我退还：成员（AI）转账给我的卡片 → 终态已退回 + 通知行（纯本地模拟，不动钱包）。
   *  用户操作后成员不再自动跟发回应；感知来自群历史卡片终态（claims/已收款/已退回）序列化与既有记忆管线 */
  const returnGroupTr = (m: WxGroupMsg) => {
    const tr = m.tr;
    if (!tr || tr.toId !== 'me' || tr.received || tr.status) return;
    patchGroupMsg(m.id, { tr: { ...tr, status: 'returned' } });
    appendFundNotice('tr', `你退回了${m.senderName || '群友'}的`, '转账');
    setLayer(null);
    onToast('转账已退还');
  };

  // 加号面板五宫格（与单聊完全一致的入口与配色；红包/转账 → 群级流程：发红包页 / 先选收款成员）
  const plusAllItems: Array<{ key: string; label: string; color: string; icon: React.ReactNode; onClick: () => void }> = [
    { key: 'call', label: '语音通话', color: '#2FBF71', icon: <Phone className="h-[26px] w-[26px]" strokeWidth={1.9} />, onClick: () => onToast('语音通话暂未开放') },
    { key: 'video', label: '视频通话', color: '#1B9FF0', icon: <Video className="h-[26px] w-[26px]" strokeWidth={1.9} />, onClick: () => onToast('视频通话暂未开放') },
    {
      key: 'rp',
      label: '红包',
      color: '#F5455C',
      icon: <RpIcon className="h-[26px] w-[26px]" />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        setLayer({ view: 'rp-compose' });
      },
    },
    {
      key: 'transfer',
      label: '转账',
      color: '#12B7F5',
      icon: <ArrowLeftRight className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        if (members.length === 0) {
          onToast('群里还没有成员');
          return;
        }
        setLayer({ view: 'tr-pick' });
      },
    },
    {
      key: 'loc',
      label: '位置',
      color: '#F0605C',
      icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        setCompose('location');
      },
    },
  ];
  // 输入框上方快捷功能（输入框自定义 › 输入框上方功能；与 QQ 单聊共用槽位）：把加号面板里的功能
  // 放到输入框上面，点一下直接触发（同一条 onClick）；未添加 = 不显示；「+」面板本身不受影响。
  // 图标/文案用 QQ_QUICK_META（黑白单色，用户指定）；行为取群面板同名项 onClick（群不支持的自动排除）
  const chatDecorQq = useSettings((s) => s.chatDecor.qq);
  const quickItems: QuickBarItem[] = resolveQuickKeys('qq', chatDecorQq.quickKeys)
    .map((k): QuickBarItem | null => {
      const meta = QQ_QUICK_META[k];
      const panel = plusAllItems.find((it) => it.key === k);
      if (!meta || !panel) return null;
      return { key: k, label: meta.label, icon: meta.icon, onClick: panel.onClick };
    })
    .filter((x): x is QuickBarItem => x !== null);

  // ---------------- 长按气泡菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成（与单聊完全一致） ----------------

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: WxGroupMsg): boolean => m.kind !== 'notice' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（与单聊同构：我的/AI 气泡都可 复制 删除 编辑 引用 多选 撤回 转发 收藏；
   *  AI 气泡多一个重新生成；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: WxGroupMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const isVoice = m.kind === 'voice';
    const items: BubbleMenuItem[] = [];
    // 语音消息首项「转文字」/「取消转文字」（toggle：已转写→取消收起；未转写→识别；失败可重试）
    if (isVoice) items.push({ key: 'stt', label: m.voice?.stt === 'done' && m.voice.transcript ? '取消转文字' : '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (isText || isVoice) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (isText) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('qq', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('qq', m.id) });
    if (m.role === 'peer') items.push({ key: 'regen', label: '重新生成', icon: B.regen });
    return items;
  };

  const menuMsg = menu ? msgs.find((m) => m.id === menu.mid) ?? null : null;

  /** 气泡长按手势（fire 里用 data-mid 反查消息并现场组装菜单项；多选模式下不弹菜单改为点选勾选）。
   *  onClickCapture 单独解出：多选模式下行级勾选拦截优先，普通模式沿用长按的点击拦截 */
  const { onClickCapture: pressClickCapture, ...pressHandlers } = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || !isSelectable(msg)) return;
    const items = buildMsgMenuItems(msg);
    if (items.length === 0) return;
    setMenuRect(computeBubbleMenuPos(el.getBoundingClientRect(), listRef.current?.getBoundingClientRect() ?? null, items.length));
    setMenu({ mid: msg.id });
  }, !selectMode);
  const bubblePress = pressHandlers;
  const [menuRect, setMenuRect] = useState<ReturnType<typeof computeBubbleMenuPos> | null>(null);

  /** 退出多选模式（同时退出转发流程） */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setFwdFlow(null);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 收藏项快照（单条收藏/批量收藏共用；msgId 用于「每条消息只能收藏一次」去重）：
   *  来源会话 = 群本身（contactId = 群 id / 名字 = 群名），内容带发言人前缀保留「谁说的」 */
  const favOf = (m: WxGroupMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: gid,
    contactName: group.name,
    contactAvatar: group.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: `${m.role === 'me' ? me.name : m.senderName || '群友'}：${msgSnapshotOf(m)}`,
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.img?.src : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成（仅 AI 气泡）：只删除该条成员回复（不影响其他成员的消息），以剩余历史重新请求该角色生成。
   *  B-4 旁路守卫：以群当前成员表/禁言表为准——被踢出群的成员不再靠 contactsRef 兜底放回来，
   *  被禁言成员也不能借「重新生成」开口（与 runGroupTurn 的过滤同一口径：memberIds + isGroupMuted）。
   *  #28 竞态修复：删除动作移入 80ms setTimeout 回调内、预检（群存在+成员在群+未禁言）通过之后执行——
   *  预检失败不删原消息并提示；极端竞态下 runCharTurn 仍 skip（如流被抢占）时按原文回滚落盘，不丢消息。
   *  audit4-L14：流失败但流中已有分段投递上屏时不回滚（恢复的原消息会与已上屏分段同义重复），仅提示。 */
  const regenerate = (m: WxGroupMsg) => {
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const g = getGroup(gid);
    if (!g || !g.memberIds.includes(m.senderId)) {
      onToast('该成员已不在群里');
      return;
    }
    if (isGroupMuted(g, m.senderId)) {
      onToast('TA 被禁言了');
      return;
    }
    const char = memberById.get(m.senderId) ?? contactsRef.current.find((c) => c.id === m.senderId) ?? null;
    if (!char) {
      onToast('该成员已不在群里');
      return;
    }
    window.setTimeout(() => {
      // #28 预检（回调内重查，原消息在预检通过前不动）：80ms 窗口内群可能解散/成员被移出/被禁言
      const gNow = getGroup(gid);
      if (!gNow || !gNow.memberIds.includes(char.id) || isGroupMuted(gNow, char.id)) {
        onToast('群聊状态已变化，无法重新生成');
        return; // 预检失败：不删原消息
      }
      const all = loadGroupMsgs(gid);
      if (!all.some((x) => x.id === m.id)) return; // 原消息已不在（用户已手动删除）：无事可做
      saveGroupMsgs(gid, all.filter((x) => x.id !== m.id));
      if (mountedRef.current) setMsgs(loadGroupMsgs(gid));
      groupSpeaker.set(sKey, char.id);
      if (mountedRef.current) setSpeakerId(char.id);
      // audit4-L14：本轮已投递分段计数——流中 onSegment 每排队投递一批 +n；
      // error 收口时已投递数 > 0 则跳过回滚（见下方 then 说明）
      let regenDelivered = 0;
      void runCharTurn(char, false, [], (n) => {
        regenDelivered += n;
      })
        .then((r) => {
          // #28 极端竞态兜底：预检通过但 runCharTurn 仍 skip（如流被其他回合抢占）→ 原消息按原文回滚。
          // #6 流失败（'error'）同构回滚：原消息已删、流失败不落任何成员消息也不走占位兜底，
          // 不回滚会让原消息凭空消失——与 skip 同款按原文回滚落盘，仅提示文案按网络口径区分。
          // audit4-L14：error 但流中已有分段投递上屏（chat-stream-store：流中已凑齐的分段已投递，
          // 出错不影响）时跳过回滚——恢复的原消息会与已上屏分段同义内容重复，仅提示部分送达；
          // 无任何分段投递（regenDelivered === 0）时保持原回滚行为，skip 分支不受影响
          if (r === 'skip' || r === 'error') {
            if (r === 'error' && regenDelivered > 0) {
              onToast('网络开小差了，部分回复已送达');
              return;
            }
            const cur = loadGroupMsgs(gid);
            if (!cur.some((x) => x.id === m.id)) {
              saveGroupMsgs(gid, sortMsgsByTime([...cur, m]));
              if (mountedRef.current) setMsgs(loadGroupMsgs(gid));
              onToast(r === 'skip' ? '成员们还在回复，稍等一下' : '网络开小差了，已恢复原消息');
            }
          }
        })
        .finally(() => {
          groupSpeaker.delete(sKey);
          if (mountedRef.current) setSpeakerId(null);
          // #35 重新生成也是 runCharTurn 直调旁路回合：进行中用户发过消息（排队标记+toast 承诺）
          // → 与 runGroupTurn finally 同款兜底补跑，不让排队消息石沉大海
          if (groupQueuedRef.current) {
            groupQueuedRef.current = false;
            kickMakeup();
          }
        });
    }, 80);
  };

  // ---------------- 转发（与单聊同流程：多选勾选 → 逐条/合并 → 选目标会话） ----------------

  /** 转发目标：QQ 好友 + 自己（单聊目标）+ 其他 QQ 群（同宿主 App；与单聊/其他群的数据隔离不变） */
  const forwardTargets = useMemo<Array<FwdSheetTarget & { kind: 'contact' | 'group' }>>(() => {
    const self = contacts.find((c) => c.id === me.id);
    const contactList: Array<FwdSheetTarget & { kind: 'contact' | 'group' }> = contacts
      .filter((c) => c.kind !== 'user' && c.id !== me.id && isFriendIn(c, 'qq'))
      .map((c) => ({ id: c.id, name: displayNameOf(c), avatar: c.avatar, kind: 'contact' }));
    if (self) contactList.unshift({ id: self.id, name: displayNameOf(self), avatar: self.avatar, self: true, kind: 'contact' });
    const groupList = listGroups('qq')
      .filter((g) => g.id !== gid)
      .map((g) => ({ id: g.id, name: g.name, avatar: g.avatar, kind: 'group' as const }));
    return [...contactList, ...groupList];
  }, [contacts, me.id, gid]);

  /** 群内克隆（转发到另一个群）：文本 → 转发卡片；表情/图片/位置 → 同类型消息；合并卡片原样保留；红包/转账 → 占位文本卡片（不克隆活卡，不动资金）；
   *  文字图片 → 占位文本卡片（「[文字图片] …」摘要；转发整卡无生成入口意义不大，接入成本高于收益故不做） */
  const groupForwardClone = (m: WxGroupMsg): WxGroupMsg => {
    const base = { id: uid(), role: 'me' as const, senderId: 'me', senderName: me.name, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: '', kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { ...m.loc } };
    // 语音消息整条克隆（含音频 dataURL），目标会话里照常可播放
    if (m.kind === 'voice' && m.voice) return { ...base, content: '', kind: 'voice', voice: { ...m.voice } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'textcard';
    return { ...base, content: isCard ? msgSnapshotOf(m) : m.content, kind: 'forward', fwd: { from: group.name }, quote: m.quote };
  };

  /** 单聊克隆（转发到 QQ 好友/自己）：产出 qq.tsx QQMsg 兼容对象（新 id、role=me、保留引用；QQ 位置字段为 addr）；
   *  文字图片 → 占位文本卡片（QqSingleMsgShape 不含 card 字段，不跨会话克隆卡片） */
  const singleForwardClone = (m: WxGroupMsg): QqSingleMsgShape => {
    const base = { id: uid(), role: 'me' as const, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: m.img.src, kind: 'image' };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { name: m.loc.name, addr: m.loc.address, lat: m.loc.lat, lng: m.loc.lng } };
    // 语音消息整条克隆（QQ 单聊同款 kind='voice'，qq.tsx loadMsgs 规范化可读回播放）
    if (m.kind === 'voice' && m.voice) return { ...base, content: '', kind: 'voice', voice: { ...m.voice } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'textcard';
    return { ...base, content: isCard ? msgSnapshotOf(m) : m.content, kind: 'forward', fwd: { from: group.name }, quote: m.quote };
  };

  /** 合并转发的对话快照（群内/单聊目标共用；记录定格原说话人头像与富媒体） */
  const mergedRecordsOf = (list: WxGroupMsg[]): GroupFwdRecord[] =>
    list.map((m) => ({
      name: m.role === 'me' ? me.name : m.senderName || '群友',
      role: m.role,
      text: msgSnapshotOf(m),
      quote: m.quote ? `${m.quote.name}：${m.quote.content}` : undefined,
      time: m.time,
      avatar: m.role === 'me' ? me.avatar : memberById.get(m.senderId)?.avatar ?? null,
      kind: m.kind === 'sticker' ? ('sticker' as const) : m.kind === 'image' ? ('image' as const) : ('text' as const),
      imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.img?.src : undefined,
      stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
    }));

  /** 执行转发（逐条/合并；目标 = QQ 好友/自己 或 其他 QQ 群）：
   *  单聊目标写 qq-chat-msgs 存储（与单聊同键）+ 未读角标 + AI 感知事件；群目标写目标群消息库 + 未读角标 */
  const doForward = (mode: FwdMode, ids: string[], target: FwdSheetTarget & { kind: 'contact' | 'group' }) => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0) return;
    if (target.kind === 'group') {
      if (target.id === gid) return;
      const title = fwdRecordTitle(me.name, group.name);
      const clones =
        mode === 'each'
          ? list.map(groupForwardClone)
          : [
              {
                id: uid(),
                role: 'me' as const,
                senderId: 'me',
                senderName: me.name,
                content: title,
                time: Date.now(),
                kind: 'forward' as const,
                fwd: { from: group.name, merged: true, title, records: mergedRecordsOf(list) },
              },
            ];
      saveGroupMsgs(target.id, [...loadGroupMsgs(target.id), ...clones]);
      qqUnreads.bump(qqGroupRowId(target.id), clones.length);
    } else {
      if (mode === 'each') {
        saveQqSingleMsgs(target.id, [...loadQqSingleMsgs(target.id), ...list.map(singleForwardClone)]);
      } else {
        const title = fwdRecordTitle(me.name, group.name);
        const card: QqSingleMsgShape = {
          id: uid(),
          role: 'me',
          content: title,
          time: Date.now(),
          kind: 'forward',
          fwd: { from: group.name, merged: true, title, records: mergedRecordsOf(list) },
        };
        saveQqSingleMsgs(target.id, [...loadQqSingleMsgs(target.id), card]);
      }
      qqUnreads.bump(target.id, mode === 'each' ? list.length : 1);
      if (target.id !== me.id) {
        const lines = list
          .slice(-8)
          .map((m) => `${m.role === 'me' ? me.name : m.senderName || '群友'}：${msgSnapshotOf(m)}`)
          .join(' ／ ')
          .slice(0, 240);
        pushQqAiEvent(
          target.id,
          `（系统事件：用户把来自「${group.name}」群聊的 ${list.length} 条消息${mode === 'merge' ? '合并转发' : '逐条转发'}给你了：${lines}。请用符合人设的一两句话自然回应这条转发。）`
        );
      }
    }
    setFwdFlow(null);
    exitSelect();
    onToast(target.self ? '已转发给自己' : `已转发给 ${target.name}`);
  };

  /** 从群记录里移除消息（单条删除/批量删除共用；只动选中的消息，不碰其他成员的消息）。
   *  一.5 引用联动：被删消息若被其他消息引用，引用内容改写为「原消息已删除」（引用关系用 quote.id 关联） */
  const removeMsgs = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const set = new Set(ids);
      const next = loadGroupMsgs(gid)
        .filter((m) => !set.has(m.id))
        .map((m) =>
          m.quote?.id && set.has(m.quote.id) ? { ...m, quote: { ...m.quote, content: '原消息已删除' } } : m
        );
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 撤回消息的引用联动（一.5 同规则：撤回后原内容不再可见，引用显示「原消息已删除」） */
  const recallMsg = useCallback(
    (mid: string) => {
      const next = loadGroupMsgs(gid).map((m) => {
        if (m.id === mid) return { ...m, recalled: true };
        if (m.quote?.id && m.quote.id === mid && !m.recalled) return { ...m, quote: { ...m.quote, content: '原消息已删除' } };
        return m;
      });
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 长按菜单动作分发（执行后关闭菜单；与单聊 handleMenuAction 同构） */
  const onMenuSelect = (key: string) => {
    const m = menuMsg;
    setMenu(null);
    setMenuRect(null);
    if (!m) return;
    switch (key) {
      case 'stt': {
        // 语音消息「转文字」：已有结果 → 再点一次=取消转文字（收起结果）；否则现场识别，失败可重试
        const v = m.voice;
        if (!v) break;
        if (v.stt === 'done' && v.transcript) {
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: undefined, stt: undefined } } : x)),
          );
          onToast('已取消转文字');
          break;
        }
        // 本地已存原文的语音（AI 语音消息/文字转语音）：直接显示原文，无需识别
        if (!v.url && (v as VoiceMsgData).localText) {
          patchGroupMsg(m.id, { voice: { ...v, transcript: (v as VoiceMsgData).localText, stt: 'done' as const } });
          onToast('已转文字');
          break;
        }
        onToast('正在转文字…');
        void (async () => {
          try {
            const blob = await (await fetch(v.url)).blob();
            const text = await transcribeAudioBlob(blob);
            if (!text) {
              onToast('转文字失败，请重试');
              return;
            }
            const next = loadGroupMsgs(gid).map((x) =>
              x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: text, stt: 'done' as const } } : x,
            );
            saveGroupMsgs(gid, next);
            if (mountedRef.current) setMsgs(next);
            onToast('已转文字');
          } catch {
            onToast('转文字失败，请重试');
          }
        })();
        break;
      }
      case 'copy':
        copyText(msgSnapshotOf(m), onToast);
        break;
      case 'del': {
        // #24 补 isAiDelivering 守卫：成员回复还在按打字节奏逐条投递（未落盘完）时也不可删除，
        // 防投递中的消息被删后队列后续条目继续落库造成半截对话
        if (runningRef.current || isChatStreaming(sKey) || isAiDelivering(sKey)) {
          onToast('成员们还在回复，稍等一下');
          return;
        }
        removeMsgs([m.id]);
        onToast('已删除');
        break;
      }
      case 'edit':
        // 语音消息编辑转写/朗读文本；文字消息编辑正文
        setEditMsg(m);
        setEditDraft(m.kind === 'voice' ? m.voice?.transcript ?? m.voice?.localText ?? '' : m.content);
        break;
      case 'quote':
        // 群聊引用带发言人：显示引用的是谁的消息（id 带上源消息，删除/撤回后显示「原消息已删除」；time 供 QQ 引用卡显示）；
        // fix3-e⑦：机主引用自己消息时引用名用机主称呼名（与 AI 侧参与成员名单同源），不再是「我」
        setQuote({
          name: m.role === 'me' ? addressNameOf(me, useSettings.getState().addressMode) : m.senderName || '群友',
          content: msgSnapshotOf(m),
          id: m.id,
          time: m.time,
        });
        requestAnimationFrame(() => inputRef.current?.focus());
        break;
      case 'multi':
        setAtOpen(false);
        setStickerOpen(false);
        setPlusOpen(false);
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        // #24 补 isAiDelivering 守卫：投递进行中不可撤回（同 del，防半截对话）
        if (runningRef.current || isChatStreaming(sKey) || isAiDelivering(sKey)) {
          onToast('成员们还在回复，稍等一下');
          return;
        }
        // 二.3/二.5：撤回不删原始记录（标记 recalled 渲染为居中灰字「谁撤回了一条消息」）；引用联动改写
        recallMsg(m.id);
        onToast('已撤回');
        // #13 撤回同步清除记忆素材（对照单聊 #17/qq.tsx 同款 memPurgeMessageSources）：
        // 群消息会进每个 AI 成员各自的记忆库（mem-frag:<成员 id>），已提取成记忆的撤回内容
        // 不再留在召回结果里；memberIds 不含机主，逐成员按来源消息 id 清理（异步静默失败不提示）。
        // audit4-M8：第三参直传消息原文（msgTextOf 同口径，与记忆提取素材同源）——memFindMsgText
        // 只搜三个私聊存档键，群消息 id 找不回文本，不传则 #26② 的 ≥8 字包含兜底对群撤回恒失效
        const gRc = getGroup(gid);
        if (gRc) {
          for (const cid of gRc.memberIds) {
            if (!cid || cid === 'me') continue;
            void memPurgeMessageSources(cid, m.id, msgTextOf(m));
          }
        }
        break;
      }
      case 'forward':
        // 转发 → 进入聊天内多选勾选（该条预选）；点底栏「分享」图标后才弹出 逐条/合并 转发方式（与单聊一致）
        setAtOpen(false);
        setStickerOpen(false);
        setPlusOpen(false);
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'fav':
        // 收藏 toggle：首点收藏（toast 收藏成功）；已收藏再点 → 取消收藏（收藏页同步移除）
        if (isMsgFavorited('qq', m.id)) {
          unfavoriteMsg('qq', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('qq', favOf(m));
        onToast('收藏成功');
        break;
      case 'regen':
        regenerate(m);
        break;
    }
  };

  /** 编辑保存：文字消息更新正文；语音消息更新转写文本（无音频 URL 的同步朗读原文），置为已转写；自动落盘 */
  const saveEdit = () => {
    const t = editDraft.trim();
    if (!editMsg) return;
    if (!t) {
      onToast('内容不能为空');
      return;
    }
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    if (editMsg.kind === 'voice' && editMsg.voice) {
      patchGroupMsg(editMsg.id, {
        voice: { ...editMsg.voice, localText: editMsg.voice.url ? editMsg.voice.localText : t, transcript: t, stt: 'done' as const },
      });
      setEditMsg(null);
      onToast('已修改');
      return;
    }
    patchGroupMsg(editMsg.id, { content: t });
    setEditMsg(null);
    onToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    // #24 补 isAiDelivering 守卫：投递进行中不可批量删除（同单条 del）
    if (runningRef.current || isChatStreaming(sKey) || isAiDelivering(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    removeMsgs(selectedIds);
    onToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  /** 多选批量收藏（已收藏过的消息自动跳过） */
  const batchFav = () => {
    const list = msgs.filter((x) => selectedIds.includes(x.id));
    if (list.length === 0) return;
    const fresh = list.filter((m) => !isMsgFavorited('qq', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('qq', favOf(m));
    onToast(fresh.length === list.length ? `已收藏 ${fresh.length} 条消息` : `已收藏 ${fresh.length} 条（${list.length - fresh.length} 条已收藏过）`);
    exitSelect();
  };

  /** 多选批量转发（进入聊天内勾选模式，可继续增删、选逐条/合并） */
  const batchForward = () => {
    if (selectedIds.length === 0) return;
    setFwdFlow('choose');
  };

  const speaker = speakerId ? memberById.get(speakerId) ?? null : null;
  const streaming = stream?.status === 'streaming';

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming && !runningRef.current;
  const layerMsg = layer && 'msgId' in layer ? msgs.find((m) => m.id === layer.msgId) ?? null : null;

  /** 富媒体消息行（图片/位置/表情包）：与文字行同一套头像/名字/宽度几何；多选模式下行首插入勾选圈 */
  /** 发言者身份徽标文案（群主/管理员；普通成员 null） */
  const roleLabelOfId = (id: string): string | null => {
    const role = groupRoleOf(group, id);
    return role === 'member' ? null : role === 'owner' ? '群主' : '管理员';
  };
  const renderMsgRow = (m: WxGroupMsg, media: React.ReactNode) => {
    const mine = m.role === 'me';
    const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
    const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
    const roleLabel = roleLabelOfId(mine ? me.id : m.senderId);
    return (
      <div className={`mb-3 flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
        {selectMode && isSelectable(m) && (
          <span
            aria-hidden="true"
            data-testid={`qq-grp-select-${m.id}`}
            className={`mt-2.5 flex h-[20px] w-[20px] shrink-0 self-start items-center justify-center rounded-full border ${
              fwdFlow === 'choose' && mine ? 'order-last' : ''
            } ${selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'}`}
          >
            {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
          </span>
        )}
        <QqAvatar src={senderAvatar} alt={mine ? me.name : m.senderName} size={40} />
        <div className={`flex min-w-0 max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {/* 发言者名字（含机主自己）+ 群主/管理员徽标 */}
          <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">
            <span className="truncate">{mine ? me.name : m.senderName}</span>
            {roleLabel && (
              <span
                className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                  roleLabel === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#0099FF]/15 text-[#0072C7] dark:text-[#4AA3FF]'
                }`}
              >
                {roleLabel}
              </span>
            )}
          </span>
          {/* B1 群聊思维链卡片：成员消息携带思考过程时渲染（发言者名与气泡之间，与头像左缘对齐）；
              开关按群隔离——关闭时不渲染但字段保留，重开开关可回看历史思考 */}
          {!mine && grpThinkOn && m.thinking && !m.recalled ? (
            <div className="pl-0 pr-1 pb-[2px]">
              <ThinkCard text={m.thinking} testId={`qqgrp-think-${m.id}`} />
            </div>
          ) : null}
          {/* 引用块（卡片类消息：气泡上方独立胶囊；小圆角 + 细黑边框；文字消息的引用卡在气泡内） */}
          {m.quote && (
            <div
              data-testid="qq-grp-quote-block"
              className="mb-1 max-w-full overflow-hidden rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60"
            >
              <p className="line-clamp-2 whitespace-pre-wrap break-all">
                {m.quote.name}：{m.quote.content}
              </p>
            </div>
          )}
          {media}
          {/* AI 回复失败徽标（红色 !，点击重试整轮）：我的消息行（flex-row-reverse 下位于气泡左侧） */}
          {mine && m.replyFail ? (
            <button
              type="button"
              data-testid={`qqgrp-replyfail-${m.id}`}
              aria-label="AI 回复失败，点击重试"
              title="AI 回复失败，点击重试"
              onClick={() => retryGroupTurn(m)}
              className="flex h-[20px] w-[20px] shrink-0 cursor-pointer self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white transition-opacity active:opacity-70"
            >
              !
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F5F6F7] dark:bg-[#111214]">
      {/* 面板上浮动画（加号/表情面板，与单聊共用同一套 keyframes） */}
      <style>{'@keyframes qqPanelIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
      {/* 聊天背景层（聊天信息页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响；按群独立，与单聊互不影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 顶栏（对照 QQ 私聊同款：返回 + 群名/人数 + 菜单）；多选模式下变为「取消 + 已选计数」操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        {selectMode ? (
          <div className="flex h-12 items-center px-2">
            <button type="button" data-testid="qq-grp-select-cancel" onClick={exitSelect} className="flex items-center px-1 text-[16px] active:opacity-50">
              取消
            </button>
            <div className="flex flex-1 items-center justify-center">
              <span data-testid="qq-grp-select-count" className="text-[17px] font-semibold">
                {fwdFlow === 'choose' ? '已选择' : '已选'} {selectedIds.length} 条消息
              </span>
            </div>
            {fwdFlow === 'choose' ? (
              <button
                type="button"
                aria-label="搜索"
                data-testid="qq-grp-fwd-search"
                onClick={() => onToast('搜索转发消息暂未开放')}
                className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
              >
                <Search className="h-[19px] w-[19px] text-black/70 dark:text-white/70" strokeWidth={2} />
              </button>
            ) : (
              <div className="w-9" />
            )}
          </div>
        ) : (
        <div className="flex h-12 items-center gap-1 px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <button type="button" onClick={onOpenInfo} data-testid="qq-groupchat-openinfo" className="ml-1 flex min-w-0 flex-1 items-center active:opacity-60">
            <span className="max-w-[240px] truncate text-[17px] font-semibold leading-tight">
              {groupDisplayName(group)}({members.length + 1})
            </span>
          </button>
          <button
            type="button"
            aria-label="群聊设置"
            onClick={onOpenInfo}
            data-testid="qq-groupchat-info"
            className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
          >
            <Users className="h-[20px] w-[20px] text-black/70 dark:text-white/70" strokeWidth={2} />
          </button>
        </div>
        )}
      </div>

      {/* 消息列表：自定义聊天背景时透出背景层 */}
      <div ref={listRef} className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="qq-groupchat-list">
        {msgs.length === 0 && (
          <div className="pt-16 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">
            群聊已创建
            <br />
            发条消息打个招呼吧（@某位成员可让它优先回复）
          </div>
        )}
        {msgs.map((m, i) => {
          // 旧版失败占位（「（…）」空回复兜底 / 「（网络开小差了…）」整轮失败提示行）：不再渲染，
          // 失败统一改由触发消息上的红色 ! 徽标表达
          if (m.role === 'peer' && m.content === '（…）') return null;
          if (m.kind === 'notice' && m.noticeText === '（网络开小差了，这条消息没有得到回复）') return null;
          const prev = msgs[i - 1];
          const showTime = !prev || m.time - prev.time > 5 * 60_000;
          if (m.kind === 'notice') {
            return (
              <div key={m.id} className="py-2 text-center">
                {showTime && (
                  <div className="pb-1.5">
                    <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">{fmtGroupTime(m.time)}</span>
                  </div>
                )}
                {m.notice ? (
                  <QQNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
                ) : (
                  <span className="inline-block max-w-[280px] truncate rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                    {m.noticeText ?? m.content}
                  </span>
                )}
              </div>
            );
          }
          const mine = m.role === 'me';
          const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
          const senderName = mine ? me.name : sender ? memberNameOf(sender) : m.senderName;
          const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
          // 动作描写视图（仅 AI 成员的文本消息；机主/已撤回/其他类型/无星号内容 → null 走原渲染路径）
          const actView = !m.recalled && m.role === 'peer' && (!m.kind || m.kind === 'text') ? actionDescViewOf(m.content, actionDescOn) : null;
          const actLines = actView ? [...actView.before, ...actView.after] : [];
          const actBody = actView && actView.text ? actView.text : null;
          // 空白气泡防御：AI 成员纯文本消息清洗后没有任何可见内容（历史脏数据/空段/纯不可见字符）
          // → 整行不渲染气泡（与「整条只有动作描写」同分支：多选模式保留勾选圈行，其余渲染为空）
          const bubbleBlank =
            m.role === 'peer' && !m.recalled && (!m.kind || m.kind === 'text') && !cleanBubbleText(actBody ?? m.content);
          const lineOnly = (actView && !actView.text) || bubbleBlank;
          return (
            // Task 40：外包 Fragment 携带 key（行后可能追加失败灰字提示行，兄弟节点不能共用 key）
            <Fragment key={m.id}>
            <div
              data-mid={m.id}
              onClickCapture={
                selectMode && isSelectable(m)
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }
                  : pressClickCapture
              }
              {...bubblePress}
            >
              {showTime && (
                <div className="py-2 text-center">
                  <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">{fmtGroupTime(m.time)}</span>
                </div>
              )}
              {lineOnly ? (
                /* 整条消息只有动作描写（pure-action）或空白脏数据：多选=行首勾选圈+动作灰字列表；正常=仅居中灰字行（不出气泡/头像） */
                selectMode && isSelectable(m) ? (
                  <div className="mb-3 flex gap-2">
                    <span
                      aria-hidden="true"
                      data-testid={`qq-grp-select-${m.id}`}
                      className={`mt-2.5 flex h-[20px] w-[20px] shrink-0 self-start items-center justify-center rounded-full border ${
                        fwdFlow === 'choose' && mine ? 'order-last' : ''
                      } ${selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'}`}
                    >
                      {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {actLines.map((a, k) => (
                        <ActionDescLine key={k} text={a} actorName={senderName} testId={`qq-grp-action-${m.id}-${k}`} />
                      ))}
                    </div>
                  </div>
                ) : (
                  actLines.map((a, k) => (
                    <ActionDescLine key={k} text={a} actorName={senderName} testId={`qq-grp-action-${m.id}-${k}`} />
                  ))
                )
              ) : (
                <>
                  {(actView?.before ?? []).map((a, k) => (
                    <ActionDescLine key={k} text={a} actorName={senderName} testId={`qq-grp-action-${m.id}-${k}`} />
                  ))}
              {m.recalled ? (
                <div className="py-1.5 text-center">
                  <span className="inline-block max-w-[280px] truncate rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                    {mine ? '你撤回了一条消息' : `"${m.senderName || '有人'}" 撤回了一条消息`}
                  </span>
                </div>
              ) : m.kind === 'image' && m.img ? (
                renderMsgRow(
                  m,
                  <div className="min-w-0">
                    <QqImageBubble src={m.img.src} testId="qq-groupmsg-image" />
                  </div>
                )
              ) : m.kind === 'location' && m.loc ? (
                renderMsgRow(
                  m,
                  <LocationBubble
                    loc={{ name: m.loc.name, addr: m.loc.address }}
                    onClick={() => onToast('位置详情暂未开放')}
                  />
                )
              ) : m.kind === 'sticker' && m.stk ? (
                renderMsgRow(
                  m,
                  <QqStickerBubble
                    testId="qq-groupmsg-sticker"
                    url={m.stk.url}
                    meaning={m.stk.meaning}
                    onClick={() => onToast(m.stk?.meaning ? `表情：${m.stk.meaning}` : '表情')}
                  />
                )
              ) : m.kind === 'redpacket' && m.rp ? (
                renderMsgRow(
                  m,
                  <RedPacketBubble
                    packet={{
                      type: 'redpacket',
                      amount: m.rp.amount,
                      note: m.rp.blessing,
                      count: m.rp.count,
                      mode: m.rp.mode === 'exclusive' ? 'dedicated' : m.rp.mode,
                      claims: m.rp.claims.map((c) => ({ name: c.name, avatar: c.avatar, amount: c.amount, ts: c.ts })),
                    }}
                    showOpen={m.senderId !== 'me' && !m.rp.expired && m.rp.claims.length < m.rp.count && !m.rp.claims.some((c) => c.contactId === 'me') && m.rp.mode !== 'exclusive'}
                    onClick={() => openRpMsg(m)}
                  />
                )
              ) : m.kind === 'transfer' && m.tr ? (
                renderMsgRow(
                  m,
                  <TransferBubble
                    packet={{ type: 'transfer', amount: m.tr.amount, note: m.tr.note, status: m.tr.status }}
                    mine={m.role === 'me'}
                    received={m.tr.received === true}
                    onClick={() => setLayer({ view: 'tr-detail', msgId: m.id })}
                  />
                )
              ) : m.kind === 'forward' && m.fwd?.merged ? (
                /* 合并转发「聊天记录」卡片（与单聊同款：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情） */
                renderMsgRow(
                  m,
                  <div
                    data-testid="qq-grp-forward-bubble"
                    onClick={() => {
                      if (!selectMode) setFwdDetailId(m.id);
                    }}
                    className="w-fit max-w-full select-none rounded-[10px] bg-white px-3.5 py-[9px] text-[#1F2329] shadow-sm dark:bg-[#2A2C31] dark:text-white"
                  >
                    <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                    <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-[#1F2329]/55 dark:text-white/60">
                      {(m.fwd.records ?? []).slice(0, 4).map((r, i) => (
                        <p key={i} className="break-all">
                          {r.name}：{r.text}
                        </p>
                      ))}
                      {(m.fwd.records?.length ?? 0) > 4 && <p>…</p>}
                    </div>
                    <p className="mt-2 border-t border-black/10 pt-1.5 text-[11px] text-black/40 dark:border-white/15 dark:text-white/45">聊天记录</p>
                  </div>
                )
              ) : m.kind === 'forward' && m.fwd ? (
                /* 转发卡片：内嵌原消息内容（来源说明与单聊一致省略） */
                renderMsgRow(
                  m,
                  <div
                    data-testid="qq-grp-forward-bubble"
                    className={`w-fit max-w-full select-none rounded-[10px] px-3.5 py-[9px] ${
                      mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                    }`}
                    style={mine ? { backgroundColor: '#0099FF' } : undefined}
                  >
                    <div className={`line-clamp-8 whitespace-pre-wrap break-words border-l-2 pl-2 text-[14px] leading-[1.4] ${mine ? 'border-white/40' : 'border-black/25'}`}>
                      {m.quote && (
                        <span className={`mb-0.5 block text-[12px] ${mine ? 'text-white/75' : 'text-black/50 dark:text-black/55'}`}>
                          {m.quote.name}：{m.quote.content}
                        </span>
                      )}
                      {m.content}
                    </div>
                  </div>
                )
              ) : m.kind === 'voice' && m.voice ? (
                /* 语音消息：播放/暂停 + 波形 + 时长；行级长按（data-mid 包装层）弹菜单：转文字/复制/…；转写结果显示在气泡下方 */
                renderMsgRow(
                  m,
                  <VoiceMsgBubble
                    msgId={m.id}
                    voice={m.voice}
                    side={m.role}
                    theme="qq"
                    style={m.role === 'me' ? { backgroundColor: '#0099FF' } : undefined}
                  />
                )
              ) : m.kind === 'textcard' ? (
                /* 「文字图片」卡片（E1 降级产物）：视觉与单聊同款（text-card-bubble，variant qq）。
                   点击不弹生成面板——群聊暂不支持生图（多成员锁脸归属未实现），toast 说明不误导；
                   card.text 为空的脏数据整行不渲染（兜底）；长按菜单/多选/撤回走通用路径 */
                m.card?.text ? (
                  renderMsgRow(
                    m,
                    <TextCardBubble
                      variant="qq"
                      text={m.card.text}
                      signedBy={senderName || '群友'}
                      onClick={() => {
                        if (!selectMode) onToast('群聊暂不支持生成图片');
                      }}
                    />
                  )
                ) : null
              ) : m.kind === 'mtdraft' && m.mtdraft ? (
                /* 美团代点草稿卡（C11 群内帮点外卖）：与单聊同渲染件（mt-draft-card），
                   pending 确认/取消、confirmed 实时跟订单时间线；确认后机主自己付款 */
                renderMsgRow(m, <MtDraftBubble did={m.mtdraft.did} onToast={onToast} />)
              ) : (
                <div className={`mb-3 flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  {selectMode && isSelectable(m) && (
                    <span
                      aria-hidden="true"
                      data-testid={`qq-grp-select-${m.id}`}
                      className={`mt-2.5 flex h-[20px] w-[20px] shrink-0 self-start items-center justify-center rounded-full border ${
                        fwdFlow === 'choose' && mine ? 'order-last' : ''
                      } ${selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'}`}
                    >
                      {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                    </span>
                  )}
                  <QqAvatar src={senderAvatar} alt={senderName} size={40} />
                  <div className={`flex min-w-0 max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    {/* 发言者名字（含机主自己）+ 群主/管理员徽标 */}
                    <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">
                      <span className="truncate">{senderName}</span>
                      {roleLabelOfId(mine ? me.id : m.senderId) && (
                        <span
                          className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                            roleLabelOfId(mine ? me.id : m.senderId) === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#0099FF]/15 text-[#0072C7] dark:text-[#4AA3FF]'
                          }`}
                        >
                          {roleLabelOfId(mine ? me.id : m.senderId)}
                        </span>
                      )}
                    </span>
                    <div
                      className={`w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[10px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
                        mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                      }`}
                      style={mine ? { backgroundColor: '#0099FF' } : undefined}
                      data-testid={mine ? 'qq-groupmsg-me' : 'qq-groupmsg-peer'}
                    >
                      {/* QQ 引用卡（截图样式：气泡内深色圆角卡 —— 上行名字+时间+右角箭头，下行引用内容；回复内容在卡片下方） */}
                      {m.quote && (() => {
                        const qTime = m.quote.time ?? (m.quote.id ? msgs.find((x) => x.id === m.quote?.id)?.time : undefined);
                        return (
                          <div
                            data-testid="qq-grp-quote-block"
                            className={`mb-2 rounded-[8px] px-3 py-2 text-left ${mine ? 'bg-black/[0.14]' : 'bg-black/[0.06] dark:bg-white/[0.08]'}`}
                          >
                            <div className={`flex items-center gap-1.5 text-[13px] leading-[1.4] ${mine ? 'text-white/85' : 'text-black/50 dark:text-white/50'}`}>
                              <span className="min-w-0 flex-1 truncate">
                                {m.quote.name}
                                {qTime ? ` ${qqQuoteTime(qTime)}` : ''}
                              </span>
                              <CornerRightDown className={`h-3.5 w-3.5 shrink-0 ${mine ? 'text-white/70' : 'text-black/35 dark:text-white/40'}`} />
                            </div>
                            <p className={`mt-0.5 line-clamp-2 whitespace-pre-wrap break-all text-[14.5px] leading-[1.45] ${mine ? 'text-white' : 'text-black/80 dark:text-white/85'}`}>
                              {m.quote.content}
                            </p>
                          </div>
                        );
                      })()}
                      <span>
                        {/* 内置表情代码 [微笑] 还原为内联小图（混排小图/纯表情大图，真机同款） */}
                        <InlineEmojiText app="qq" text={cleanBubbleText(actBody ?? m.content)} />
                      </span>
                    </div>
                  </div>
                </div>
              )}
                  {(actView?.after ?? []).map((a, k) => (
                    <ActionDescLine key={k} text={a} actorName={senderName} testId={`qq-grp-action-${m.id}-aft-${k}`} />
                  ))}
                </>
              )}
            </div>
            {/* Task 40「错误提示优化」：整轮失败灰字提示行（只挂在带 replyFail 的触发消息行后，
                居中灰字不进气泡不落库；单击重试、长按菜单：重试/复制错误详情/隐藏这条提示）。
                成员级失败不落任何消息，不渲染行（保持既有语义） */}
            {mine && m.replyFail && !hiddenFails.has(m.id) ? (
              <ChatErrorLine
                testId={`qqgrp-errline-${m.id}`}
                text={m.failReason || CHAT_UNKNOWN_FAIL_TEXT}
                detail={lastChatErrorDetail(sKey)}
                cooldownText={cooldownRemainText(sKey)}
                onRetry={() => retryGroupTurn(m)}
                onHide={() => setHiddenFails((ps) => new Set(ps).add(m.id))}
              />
            ) : null}
            </Fragment>
          );
        })}
        {/* 流式气泡（当前发言角色）：回复条数>1 时按边界实时切成多个气泡，下一句没打完时显示打字中 */}
        {/* 正在输入指示（流式接收期间，当前发言角色）：AI 回复为「边接收边逐条显示」——
            完整分段直接作为真实消息逐条投递上屏（见 runCharTurn 的 onSegment/finalize），
            不再有先全文显示后消失的流式气泡 */}
        {streaming && stream && (
          <div className="mb-3 flex gap-2" data-testid="qq-group-stream-typing">
            <QqAvatar src={speaker?.avatar ?? null} alt={speaker ? memberNameOf(speaker) : '…'} size={40} />
            <div className="flex min-w-0 max-w-[calc(100%-96px)] flex-col items-start">
              <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
                <span className="truncate">{speaker ? memberNameOf(speaker) : '…'}</span>
              </span>
              <div className="max-w-full rounded-[10px] bg-white px-3.5 py-[9px] dark:bg-[#2A2C31]">
                <span className="inline-flex items-center gap-[5px] py-[4px]" role="status" aria-label="正在输入">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      aria-hidden="true"
                      className="h-[7px] w-[7px] rounded-full bg-black/35 dark:bg-white/45"
                      style={{ animation: `qqTypingDot 1.1s ${d * 0.16}s ease-in-out infinite` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入区：与单聊同款几何（输入行 + 六图标工具栏）；键入 @ 唤起成员浮层（无独立 @ 钮）；表情/加号/图片/相机/位置与单聊完全对齐（共用同一套组件）；
          多选模式下变为批量删除/分享/收藏操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 bg-white dark:bg-[#1B1C1F]">
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[22px] pt-3" data-testid="qq-grp-select-bar">
            <button
              type="button"
              data-testid="qq-grp-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#F5455C] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="qq-grp-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="qq-grp-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Star className="h-[21px] w-[21px]" strokeWidth={1.9} />
              收藏
            </button>
          </div>
        ) : (
        <>
        {/* 六.5 禁言横幅：我被禁言时输入区上方提示（当前权限体系下机主通常为群主，此处为防御性支持） */}
        {meMuted && (
          <div className="flex items-center justify-center gap-1.5 border-b border-black/[0.05] px-3 py-1.5 text-[12px] text-black/50 dark:border-white/[0.06] dark:text-white/50" data-testid="qq-group-me-muted">
            <MicOff className="h-3.5 w-3.5" />
            你已被禁言（{meMuteLeft ?? '永久'}），暂时无法发言
          </div>
        )}
        {quote && (
          <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-1.5 text-[12px] text-black/50 dark:border-white/[0.06] dark:text-white/50">
            <span className="min-w-0 flex-1 truncate">引用 {quote.name}：{quote.content}</span>
            <button type="button" aria-label="取消引用" onClick={() => setQuote(null)} className="shrink-0 active:opacity-60">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {/* 输入框上方快捷功能条（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面；
            点一下与点面板里那一项等效；未添加 = 不显示；「+」面板本身不受影响 */}
        {quickItems.length > 0 && (
          <div className="px-3 pt-2">
            <ChatQuickBar items={quickItems} testPrefix="qqg" />
          </div>
        )}
        <div className="flex items-end gap-2 px-3 pb-1 pt-3">
          <div className="relative min-w-0 flex-1">
            <ChatRichInput
              app="qq"
              ref={inputRef}
              value={draft}
              onChange={(v) => {
                setDraft(v);
                // Task 40 草稿箱：输入即持久化（防抖落库，切群/刷新不丢）；超长截断时节流提示一次
                if (saveChatDraft('qq-group', gid, v) && Date.now() - draftTruncAtRef.current > 5000) {
                  draftTruncAtRef.current = Date.now();
                  onToast(`草稿过长，仅保留前 ${CHAT_DRAFT_MAX} 字`);
                }
                // 键入 @ 直接唤起成员浮层（QQ/微信同款：点选后替换该 @ 并插入「@名字 」）
                if (v.endsWith('@')) {
                  setStickerOpen(false);
                  setPlusOpen(false);
                  setAtOpen(true);
                }
              }}
              onKeyDown={(e) => {
                // 多行输入：「回车键发送消息」开关统一口径（五端共用 guardEnterToSend）——
                // 开启=Enter 发送 / Shift+Enter 换行；关闭=回车一律换行、点「发送」按钮才发送；中文输入法选词回车（isComposing）不发送
                guardEnterToSend(e, enterSend, () => send());
              }}
              enterKeyHint={enterSend ? 'send' : undefined}
              placeholder={ttsSend ? '输入文字，发送后转为语音' : chatPlaceholder(chatDecorQq)}
              placeholderClass="absolute inset-0 flex items-center pl-3.5 pr-9 text-[15px] text-black/25 dark:text-white/25"
              ariaLabel="发送群聊消息"
              testId="qq-groupchat-input"
              className="max-h-[132px] min-h-[40px] w-full overflow-y-auto rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] py-[9px] pl-3.5 pr-9 text-[15px] leading-[22px] outline-none dark:border-white/[0.08] dark:bg-white/[0.07]"
            />
            {/* 文字转语音开关（声波图标收进输入框内部右侧）：开启后输入框文字发送为语音气泡 */}
            <button
              type="button"
              aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
              aria-pressed={ttsSend}
              data-testid="qqg-tts-toggle"
              onClick={() => {
                const nv = !ttsSend;
                setTtsSend(nv);
                onToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
              }}
              className={`absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors active:opacity-60 ${ttsSend ? 'text-[#0099FF]' : 'text-black/40 dark:text-white/40'}`}
            >
              <AudioLines className="h-[17px] w-[17px]" strokeWidth={ttsSend ? 2.2 : 1.8} />
            </button>
          </div>
          {(draft.trim() || canDispatch || pendingImgs.length > 0) ? (
            <>
              <button
                type="button"
                onClick={send}
                disabled={streaming || runningRef.current || (!draft.trim() && !canDispatch && pendingImgs.length === 0)}
                data-testid="qq-groupchat-send"
                aria-label={ttsSend ? '发送（转语音）' : '发送'}
                className={`h-[40px] shrink-0 rounded-[12px] px-5 text-[16px] font-medium text-white transition-all duration-150 ${
                  (draft.trim() || canDispatch || pendingImgs.length > 0) && !streaming && !runningRef.current ? 'shadow-[0_2px_10px_rgba(0,153,255,0.30)] active:scale-[0.97] active:brightness-95' : 'opacity-90'
                }`}
                style={{ backgroundColor: (draft.trim() || canDispatch || pendingImgs.length > 0) && !streaming && !runningRef.current ? '#0099FF' : '#8AD4F7' }}
              >
                发送
              </button>
            </>
          ) : null}
        </div>
        {/* 发图预览条（需求2 发图先预览）：选图先暂存这里不上屏，主发送按钮才真正发出并触发群回合
            （文字与待发图可组合发送：文字在前、图片在后）；不做堆叠/大图查看（微信专属需求，QQ 跳过）；
            语音/表情/加号面板展开时隐藏 */}
        {pendingImgs.length > 0 && !voiceMode && !stickerOpen && !plusOpen && (
          <div
            data-testid="qqg-img-preview-bar"
            className="flex items-center gap-2.5 border-t border-black/[0.05] px-3 py-2 dark:border-white/[0.06]"
          >
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
              {pendingImgs.map((p, k) => (
                <div key={p.id} className="relative h-[62px] w-[62px] shrink-0">
                  <img
                    src={p.src}
                    alt={`待发送图片${k + 1}`}
                    className="h-full w-full rounded-[8px] border border-black/[0.06] object-cover dark:border-white/[0.08]"
                  />
                  <button
                    type="button"
                    aria-label="移除图片"
                    data-testid={`qqg-img-preview-remove-${k}`}
                    onClick={() => setPendingImgs((prev) => prev.filter((x) => x.id !== p.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1F2329]/80 text-white active:opacity-70 dark:bg-white/80 dark:text-[#1F2329]"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 工具栏（与单聊同款六图标：语音/图片/拍摄/点缀/表情/加号） */}
        <div className="flex items-center justify-between px-7 pb-[18px] pt-2 text-black/80 dark:text-white/80">
          <button
            type="button"
            aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
            data-testid="qqg-voice-toggle"
            onClick={() => {
              if (rec.phase !== 'idle') return; // 录音按住中不允许切换（防止按住中的大圆钮被卸载导致手势丢失）
              setVoiceMode((v) => !v);
              setStickerOpen(false);
              setPlusOpen(false);
              setAtOpen(false);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Mic className={`h-[25px] w-[25px] ${voiceMode ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="图片" data-testid="qq-groupchat-tool-image" onClick={() => photoInputRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <ImageIcon className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="拍摄" data-testid="qq-groupchat-tool-camera" onClick={() => cameraInputRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <Camera className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="点缀" onClick={() => onToast('点缀暂未开放')} className="p-2 -m-2 active:opacity-60">
            <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="表情"
            data-testid="qq-groupchat-sticker"
            aria-expanded={stickerOpen}
            onClick={() => {
              /* 三面板互斥（第五十二轮）：开表情面板时退出语音模式并关加号面板；录音按住中不允许切换 */
              if (rec.phase !== 'idle') return;
              setVoiceMode(false);
              setPlusOpen(false);
              setAtOpen(false);
              setStickerOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Smile className={`h-[25px] w-[25px] ${stickerOpen ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="更多功能"
            data-testid="qq-groupchat-plus"
            aria-expanded={plusOpen}
            onClick={() => {
              /* 三面板互斥（第五十二轮）：开加号面板时退出语音模式并关表情面板；录音按住中不允许切换 */
              if (rec.phase !== 'idle') return;
              setVoiceMode(false);
              setStickerOpen(false);
              setAtOpen(false);
              setPlusOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Plus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {/* QQ 语音面板（工具栏下方展开，相当于键盘区）：「按住说话」+ 大圆麦克风（左滑转文字/右滑取消）+ 变声/对讲/录音 */}
        {voiceMode && <QqVoicePanel rec={rec} holdTestId="qqg-voice-hold" />}
        {/* 加号面板（与单聊共用同一套宫格；红包/转账按群范围限定提示不支持） */}
        {plusOpen && (
          <div
            data-testid="qq-group-plus-panel"
            className="border-t border-black/[0.05] px-5 pb-6 pt-5 dark:border-white/[0.06]"
            style={{ animation: 'qqPanelIn 0.24s ease-out' }}
          >
            <QqPlusGrid items={plusAllItems} />
          </div>
        )}
        {/* 表情面板（与单聊共用同一套组件；表情包按群会话独立保存） */}
        {stickerOpen && <QqStickerPanel onPick={sendSticker} onPickBuiltin={insertBuiltinEmoji} onClose={() => setStickerOpen(false)} onToast={onToast} />}
        {/* @ 成员浮层：锚定输入区容器上方（含面板与引用条也不遮挡） */}
        {atOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            {/* @ 成员浮层（整屏宽：左右贴满屏幕、顶栏圆角贴住输入区） */}
            <div className="absolute bottom-full left-0 right-0 z-40 w-full overflow-hidden rounded-t-[14px] border-t border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2A2C31]">
              <div className="border-b border-black/[0.05] px-4 py-2.5 text-[12px] text-black/40 dark:border-white/[0.06] dark:text-white/40">
                @ 群成员（被 @ 的优先回复）
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {members.length === 0 && <div className="px-4 py-4 text-center text-[12px] text-black/40">群内还没有成员</div>}
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`qq-group-at-${m.id}`}
                    onClick={() => insertMention(m)}
                    className="flex w-full items-center gap-2.5 px-4 py-[9px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* 位置页（与单聊共用同一套组件；位置卡片群里所有角色可见） */}
      {compose === 'location' && (
        <LocationPickerPage onClose={() => setCompose(null)} onSend={(loc) => sendLocation(loc.name, loc.addr, { lat: loc.lat, lng: loc.lng })} />
      )}

      {/* 群红包/转账浮层流程（发红包页[复用单聊 RedPacketCompose 群模式] / 选人页 / 转账页[复用单聊 TransferCompose] / 开箱 / 详情） */}
      {layer?.view === 'rp-compose' && (
        <RedPacketCompose
          wallet={loadWallet()}
          cards={loadBankCards()}
          members={members}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={submitGroupRp}
        />
      )}
      {layer?.view === 'tr-pick' && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]" data-testid="qq-grp-tr-pick">
          <div className="flex h-11 shrink-0 items-center px-2">
            <button
              type="button"
              aria-label="返回"
              data-testid="qq-grp-tr-pick-back"
              onClick={() => setLayer(null)}
              className="rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10"
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
            </button>
            <div className="flex-1 pr-8 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">选择收款成员</div>
          </div>
          <p className="px-5 pb-2 pt-3 text-[12.5px] text-black/40 dark:text-white/40">转账给「{group.name}」中的一位成员，只有 TA 能收款</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
            <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1B1C1F]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-grp-tr-pick-${m.id}`}
                  onClick={() => setLayer({ view: 'tr-compose', member: m })}
                  className="flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 text-left last:border-b-0 active:bg-black/[0.04] dark:border-white/[0.05] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#1F2329] dark:text-white">{memberNameOf(m)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {layer?.view === 'tr-compose' && (
        <TransferCompose
          peer={layer.member}
          wallet={loadWallet()}
          cards={loadBankCards()}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => {
            if (p.type !== 'transfer') return;
            const pp = loadPayPwd();
            if (pp.enabled && pp.pwd) {
              setGate({ kind: 'transfer', label: '转账', amount: p.amount, methodId, tr: { member: layer.member, amount: p.amount, note: p.note } });
              return;
            }
            execGroupTr(p.amount, p.note, layer.member, methodId);
          }}
        />
      )}
      {layer?.view === 'rp-open' && layerMsg?.rp && (
        <RedPacketOpenModal
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          avatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
          note={layerMsg.rp.blessing}
          onOpen={() => claimGroupRp(layer.msgId)}
          onClose={() => setLayer(null)}
        />
      )}
      {layer?.view === 'rp-detail' && layerMsg?.rp && (
        <GroupRpDetailPage
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          senderAvatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
          rp={layerMsg.rp}
          onBack={() => setLayer(null)}
          onToast={onToast}
          resolveClaimAvatar={(c) =>
            c.contactId === 'me' ? me.avatar : memberById.get(c.contactId)?.avatar ?? c.avatar
          }
        />
      )}
      {layer?.view === 'tr-detail' && layerMsg?.tr && (
        <GroupTrDetailPage
          tr={layerMsg.tr}
          fromName={layerMsg.role === 'me' ? me.name : layerMsg.senderName || '群友'}
          onBack={() => setLayer(null)}
          canAct={layerMsg.tr.toId === 'me' && !layerMsg.tr.received && !layerMsg.tr.status && layerMsg.senderId !== 'me'}
          onReceive={() => receiveGroupTr(layerMsg)}
          onReturn={() => returnGroupTr(layerMsg)}
        />
      )}

      {/* 支付密码验证浮层（开启支付密码后群红包/群转账发送前弹出自绘键盘，与单聊同规则） */}
      {gate && (
        <PayPwdGate
          label={`${gate.label} ¥${fmtMoney(gate.amount)} 元`}
          onOk={() => {
            const g = gate;
            setGate(null);
            if (g.kind === 'redpacket' && g.packet) execGroupRp(g.packet, g.methodId);
            else if (g.kind === 'transfer' && g.tr) execGroupTr(g.tr.amount, g.tr.note, g.tr.member, g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      )}
      {/* 原生相机/相册隐藏 input：相机单张（capture 调起后置摄像头）、图片可多选（与单聊同款） */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="qq-groupchat-camera"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void stageImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="qq-groupchat-photo"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void stageImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 编辑消息弹窗（长按菜单「编辑」；与单聊同款）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-grp-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="qq-grp-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] text-[#1F2329] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-11 flex-1 text-[16px] text-[#1F2329] active:bg-black/5 dark:text-white dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-grp-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#0099FF] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；与单聊同款） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="qq-grp-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[88px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="qq-grp-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="qq-grp-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="qq-grp-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（群聊特有：可选转发到 QQ 好友/自己的单聊，或另一个 QQ 群） */}
      {fwdFlow === 'target' && (
        <div
          className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
          data-testid="qq-grp-fwd-target-layer"
        >
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium text-[#1F2329] dark:border-white/[0.08] dark:text-white">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {forwardTargets.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  data-testid={`qq-grp-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, c)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px] text-[#1F2329] dark:text-white">
                    {c.id === me.id ? `${c.name}（我自己）` : c.name}
                    {c.kind === 'group' && <span className="ml-1.5 text-[11px] text-black/35 dark:text-white/40">群聊</span>}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="qq-grp-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开；与单聊同款布局，头像按群成员/机主解析） */}
      {(() => {
        const d = fwdDetailId ? msgs.find((x) => x.id === fwdDetailId) ?? null : null;
        if (!d || d.kind !== 'forward' || !d.fwd?.merged) return null;
        const records = d.fwd.records ?? [];
        const resolveAvatar = (r: FwdRecord): string | null => {
          if (r.avatar !== undefined) return r.avatar;
          if (r.name === me.name) return me.avatar;
          const hit = members.find((c) => memberNameOf(c) === r.name);
          if (hit) return hit.avatar;
          return r.role === 'me' ? me.avatar : null;
        };
        return (
          <div className="absolute inset-0 z-[65] flex flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-fwd-detail">
            <div className="shrink-0 bg-white pt-[54px] dark:bg-[#16171A]">
              <div className="flex h-12 items-center px-2">
                <button type="button" aria-label="返回" data-testid="qq-grp-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
                  <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <QqAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="qq-grp-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[8px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="qq-grp-fwd-detail-image"
                          className="mt-0.5 max-h-[190px] w-auto max-w-[210px] rounded-[8px] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.4]">{r.text}</p>
                      )}
                      {r.quote && (
                        <p className="mt-0.5 line-clamp-2 border-l-2 border-black/15 pl-1.5 text-[12px] leading-[1.35] text-black/45 dark:border-white/20 dark:text-white/50">{r.quote}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="pt-8 text-center text-[12px] text-black/35 dark:text-white/35">聊天记录</p>
            </div>
          </div>
        );
      })()}

      {/* 长按菜单（与单聊共用同一套组件，选项/样式/交互完全一致） */}
      {menu && menuRect && menuMsg && (
        <BubbleActionMenu pos={menuRect} items={buildMsgMenuItems(menuMsg)} onSelect={onMenuSelect} onClose={() => { setMenu(null); setMenuRect(null); }} testPrefix="qq-group" />
      )}

      {/* 转文字预览弹层：识别结果可编辑，发送文字/发送语音/取消三选一 */}
      {sttPreview.state && (
        <SttPreviewOverlay
          state={sttPreview.state}
          accent="#0099FF"
          onCancel={sttPreview.close}
          onSendText={sttPreview.sendText}
          onSendVoice={sttPreview.sendVoice}
          onChangeText={sttPreview.setText}
        />
      )}
    </div>
  );
}
