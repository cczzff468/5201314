'use client';

/** 单聊 ChatPage（流式管线/气泡渲染/输入区/卡片交互） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { Fragment, useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, AudioLines, BellOff, Camera, Check, ChevronLeft, ChevronRight, CornerRightDown, Forward, Headphones, Image as ImageIcon, MapPin, Menu, Mic, Phone, Package, Plus, Smile, Sparkles, Star, Trash2, Video, X } from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { ChatNewMsgPill, useChatAutoScroll } from '@/hooks/use-chat-autoscroll';
import { pushChatNotification, notifyPreviewText } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, markDeliverBoundary, peekPendingMsgs, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { consumeBgPending, onBgPageVisible, pullBgPending, registerBgSession, unregisterBgSession, type BgPendingItem } from '@/lib/ios/bg-turn';
import { cleanTextForTts, stopSpeaking } from '@/lib/ios/tts-client';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { CallCardBubble, callResultToCardState, callCardAiText } from '../voice-call-screen';
import { hasVoiceCallMark, stripVoiceCallMark, hasVideoCallMark, stripVideoCallMark, type ChatCallResult, type ChatCallTurnMsg } from '@/lib/ios/chat-call';
import { startGlobalCall, useGlobalCall } from '@/lib/ios/global-call';
import { triggerIncomingCall, useIncomingCall, type IncomingCallSnapshot } from '@/lib/ios/incoming-call';
import { buildLocationBlock, locationAiText } from '@/lib/ios/chat-location';
import { MtPayBubble, MtProxyDetailPage } from '../mt-proxy-detail';
import { MT_PROXY_CARD_EVENT } from '@/lib/ios/mt-proxy-pay';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
import { applyMtEngageAction, buildMtEngageCtx, isMtEngageActionKind, mtDraftHistoryLine, mtOrderShareHistoryLine, mtProxyHistoryLine, stripMtEchoText } from '@/lib/ios/mt-ai-engage';
import { MtDraftBubble } from '../mt-draft-card';
import { MT_SHARE_CARD_EVENT } from '@/lib/ios/mt-order-share';
import { MtShareBubble } from '../mt-share-card';
import { TbPayBubble, TbProxyDetailPage, TbShareBubble, TbExpressPicker } from '../tb-share-cards';
import { tbCreateOrderShare, tbGetProxy, tbProxyHistoryLine, tbProxyMeHistoryLine, tbReshareProxy, tbShareHistoryLine, stripTbEchoText, TB_PROXY_CARD_EVENT, TB_SHARE_CARD_EVENT } from '@/lib/ios/tb-share-proxy';
import { FORUM_SHARE_CARD_EVENT, buildForumShareCardMsg, forumShareHistoryLine, noteForumLinkSharedToChat, resolveForumLinkPost } from '@/lib/ios/forum-share';
import { ForumShareBubble } from '../forum/share-card';
import CoupleRelBubble from '@/components/apps/couple-rel-bubble';
import CouplePactBubble from '@/components/apps/couple-pact-bubble';
import CoupleExamBubble from '@/components/apps/couple-exam-bubble';
import CoupleLetterBubble from '@/components/apps/couple-letter-bubble';
import { COUPLE_CARD_EVENT, decideCoupleCard as decideCoupleCardAction } from '@/lib/ios/couple-invite';
import { TbDraftBubble } from '../tb-draft-card';
import { applyTbEngageAction, buildTbEngageCtx, isTbEngageActionKind, tbDraftHistoryLine } from '@/lib/ios/tb-ai-engage';
import { QqVoicePanel, SttPreviewOverlay, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildImagePlaceholderRule, buildVoicePlaceholderRule } from '@/lib/chat-media-rules';
import { splitVisionDesc } from '@/lib/vision-client';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback, VOICE_PLAY_ERROR_EVENT } from '@/lib/ios/voice-player';
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
import { CHAT_PARSE_FAIL_TEXT, CHAT_UNKNOWN_FAIL_TEXT, classifyChatError, cooldownRemainText, lastChatErrorDetail, recordChatFail, recordChatSuccess } from '@/lib/chat-errors';
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
import { CHAT_DRAFT_MAX, clearChatDraft, getChatDraft, saveChatDraft } from '@/lib/ios/chat-drafts';
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { ChatErrorLine } from '../chat-error-line';
import { beginChatStream, clearChatStream, isChatStreaming, subscribeChatStreamFinalized, useChatStream, type ChatPayloadMessage } from '@/lib/chat-stream-store';
import { promptRule } from '@/lib/prompt-entries';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import OfflineMeetingPage from '@/components/apps/offline-meeting';
import type { OfflineOnlineMsg } from '@/lib/offline-meet';
import PeerStatusCard from '@/components/apps/peer-status-card';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getMemSettings, memAfterAiTurn, memChatRecallBlock, memConvoFromRaw, memPurgeMessageSources, setMemScopeForApp } from '@/lib/memory';
import { aiWriteLetterOnRequest, coupleChatBlock, coupleLetterAskHit } from '@/lib/ios/couple-ai';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { buildDynamicStateBlocks } from '@/lib/ios/ai-mood';
import { addCharMomentPost, buildMomentsChatBlock, emitMomentsChanged, enqueuePostInteractions, // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage, markMomentAutoAttempt } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { buildForumChatBlock } from '@/lib/forum/social';
import { isPostMemoryOn } from '@/lib/forum/core';
import { useChatDisplay } from '@/lib/ios/chat-display';
import { bubbleVisual, isLiquidTheme, isRetroTheme, TAIL_CLIP_LEFT, TAIL_CLIP_RIGHT } from '@/lib/ios/bubble-style';
import { chatContactKey, chatCssScopeSelector, scopeCss } from '@/lib/ios/custom-css';
import { chatPlaceholder, resolveQuickKeys } from '@/lib/ios/chat-decor';
import { ChatQuickBar, type QuickBarItem } from '../chat-quick-bar';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
import { getStickersOn, saveStickersOn } from '@/lib/sticker-toggle';
import { getActionDescOn, saveActionDescOn, useActionDescOn, actionDescViewOf } from '@/lib/action-desc';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
import { DEEP_THINK_RULE, extractThinkBlocks, setDeepThinkOn, useDeepThinkOn } from '@/lib/deep-think';
import { ThinkCard, ThinkLiveCard } from '../think-card';
import { ActionDescLine } from '../action-desc-line';
import { stripEmojiCodes } from '@/lib/ios/emoji-codes';
import { InlineEmojiText } from '../inline-emoji';
import { ChatRichInput, type ChatRichInputHandle } from '../chat-rich-input';
import { stripEmojiText } from '@/lib/emoji';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import {
  buildPerceptionBlock,
  prewarmPerception,
  perceptionSummary,
  markTypingStart,
  markAiReplyEnd,
} from '@/lib/perception';
import { useEnterSend, setEnterSend, guardEnterToSend } from '@/lib/enter-send';
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { ownerRealNameFor, contactRealName, getChatBgImage, setChatBgImage, removeChatBgImage, updateContact, setPeerBg, setAppRelation, cachedOwnerName } from '@/lib/ios/contacts-store';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
import { RtPlusVoice, RtPlusVideo, RtPlusRedPacket, RtPlusTransfer, RtPlusLocation, RtPlusTextCard, RtPlusTogether, RtPlusExpress } from '../retro-icons';
import { listAlbumsForChat, addAlbum, getAlbum, addVisionDecision } from '@/lib/ios/album-store';
import { ensureAlbumDescs } from '@/lib/ios/album-vision';
import { buildAvatarBlock, ensureAvatarDesc, noteAvatarChanged } from '@/lib/ios/avatar-ai';
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { buildPhotoDescHistory, buildPhotoTagRule, downloadImageSrc, extractPhotoTags, generateCharacterPhoto, imgGenConfigReady, notePhotoMemory, splitUnfinishedPhotoTag, stripUnfinishedPhotoTag, type PhotoTag } from '@/lib/imggen';
import { autoCardText } from '@/lib/textcard';
import { TextCardActionSheet, TextCardBubble } from '@/components/apps/text-card-bubble';
import { ImageRegenSheet } from '@/components/apps/image-regen-sheet';
import type { AlbumRecord } from '@/lib/ios/db';
import { addressNameOf, avatarFor, displayNameOf, isFriendIn, withDisplayNames, relationForAccount, remarkForApp } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { DEFAULT_STICKER_GROUP_ID, loadStickers, newStickerId, saveStickers } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
import { buildShizukuAutonomyRules, enqueuePhoneOp } from '@/lib/ios/shizuku-autonomy';
import { useOpPill, SkillUsePill } from '../skill-use-pill';
import { buildActionRules, buildMomentPostRule, buildVisionRules, cleanBubbleText, stripMsgHandleText, extractRichActionParts, mergeRichSegments, parseRichParts, splitImageIdRefs, isQuitWinbackAction, isGroupSocialAction } from '@/lib/chat-rich';
import SongMsgBubble from '../song-msg-bubble';
import { sendUserTogetherInvite, TG_CARD_INSERTED_EVENT, type TgCardMsg } from '@/lib/ios/together-flow';
import { TogetherInviteSheet } from '../together-invite-sheet';
import { songArtistText, songCover } from '@/lib/ios/music-api';
import { cutUnfinishedMusicTag, runMusicRemote, takeMusicRemote, togetherLiveBlock } from '@/lib/ios/music-remote';
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
import { isProactiveCallOff } from '@/lib/ios/proactive-call';
import { markAiCall, recentAiCallWithin } from '@/lib/ios/ai-call-guard';
import { activeQuitFlowFor, applyQuitWinbackAction } from '@/lib/ios/quit-flow';
import { applyGroupCardDecision, applyGroupSocialAction, buildGroupSocialRules, buildKickNoticeSection } from '@/lib/ios/group-social';
import { useChatFlags, NO_FLAGS, qqChatFlags as qqChatFlagsStore } from '@/lib/chat-flags';
import { ChatBgPage, ChatReplyCountPage, ChatSearchPage, ChatSettingsPage, ChatTranslatePage, ChatVoiceFreqPage, ChatVoicePage, WorldBookPickerPage, chatBgLayerStyle, type ChatSearchItem, type ChatSettingsBg } from '../chat-settings';
import { ProactiveMsgPage } from '../proactive-msg-page';
import { PerceptionSettingsPage } from '../perception-settings';
import { proactiveCfgSummary, parseReminderInstruction, reminderHintHit, reminderSysHint, buildReminderSysMsg, setActiveProactiveChat } from '@/lib/ios/proactive-msg';
import { decideAiVoiceMessage, getAiVoiceFreq, saveAiVoiceFreq, synthesizeAiVoice, undoLastAiVoiceDecision } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { addFavorite, isMsgFavorited, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, computeBubbleMenuPosLiquid, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from '../bubble-menu';
import { LocalToast, useLocalToast } from '../page-toast';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from '../forward-sheet';
import { CoupleMark } from '../couple-mark';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { effectiveInterop } from '@/lib/ios/groups';

import { FamilyBubble, FamilyDetailPage, LocationBubble, LocationPickerPage, PayPwdGate, QQNoticeRow, QqGroupCardBubble, RedPacketBubble, RedPacketCompose, RedPacketDetailPage, RedPacketOpenModal, RpIcon, TransferBubble, TransferCompose, TransferDetailPage, TransferReceivePage } from './cards';
import { BOND_MSG_POINTS, ChatLayer, MsgPacket, QQMsg, QQUser, QQ_BLUE, addBondPoints, applyAiActions, bondHintTextOf, buildPersonaPrompt, cardStateLabel, collectPendingCards, compressImageFile, copyTextWithToast, drainAiEvents, expireStaleSingleCards, fmtChatTime, isTransferReceiptMsg, loadMsgs, nextCid, pushAiEvent, qqPatHistoryLine, qqQueueAdd, qqQueueDelete, qqQueuedTurns, qqQuoteTime, qqSessionEpoch, readQqClapText, richToQqMsg, saveMsgs, transferReceiptAiText, uid } from './core';
import { qqUnreads } from './pages';
import { QQ_QUICK_META, QqImageBubble, QqPlusGrid, QqStickerBubble, QqStickerPanel, QqTextCardSheet } from './stickers';
import { canPay, executePayment, fmtMoney, gainToWallet, loadBankCards, loadPayPwd, loadWallet, methodLabel, round2 } from './wallet';
import { QqAvatar, QqMetaUnderAvatar, QqMetaUnderBubble, QqQuoteThumb, qqMarkPeerRead } from './widgets';

/** 当前正在查看的 QQ 聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 
 * （v1.9.27 任务10 拆分：全部读写都在 ChatPage 内，声明随迁至此） */
let qqActiveChatId: string | null = null;

// ---------------- 聊天页 ----------------

/** 申请解除拉黑卡片（40-a 双向：from='char' 角色发起（用户点同意/拒绝）；from='user' 用户发起（角色 AI 决策，仅展示状态）） */
export function QqBlockReqCard({
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
      data-testid={mine ? 'qq-blockreq-card-mine' : 'qq-blockreq-card'}
      className="w-fit max-w-[calc(100%-40px)] rounded-[12px] bg-white px-3 py-2.5 shadow-sm dark:bg-[#2A2C31]"
      aria-label={`${name}申请解除拉黑`}
    >
      <div className="flex items-center gap-2">
        <QqAvatar src={avatar} alt={name} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium leading-tight text-[#1F2329] dark:text-white">{name}</p>
          <p className="mt-0.5 text-[12px] leading-tight text-black/45 dark:text-white/45">申请解除拉黑</p>
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
            data-testid="qq-blockreq-reject"
            aria-label={`拒绝${name}的解除拉黑申请`}
            onClick={onReject}
            className="h-8 flex-1 rounded-full bg-black/[0.05] text-[13px] text-black/70 transition active:opacity-70 dark:bg-white/10 dark:text-white/70"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="qq-blockreq-accept"
            aria-label={`同意${name}的解除拉黑申请`}
            onClick={onAccept}
            className="h-8 flex-1 rounded-full text-[13px] font-medium text-white transition active:opacity-80"
            style={{ backgroundColor: '#0099FF' }}
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

/** v56 引用冷却窗口（与微信端同款）：距上次成功挂载引用卡不足该时长的轮次一律丢弃引用标记——
 *  用户要「学会引用」而非「一直引用」，措辞约束之外由代码层兑底，挂载即刷新（同轮第二条也会被拦） */
export const AI_QUOTE_COOL_MS = 5 * 60_000;

/** v71 分窗渲染（与微信同款）：初始只渲染最近 WINDOW_FIRST 条，上滑到顶按 WINDOW_STEP 向前扩——
 *  长会话几千条一次性 map 渲染是「点进聊天界面卡顿」的主因；时间分隔/组尾角/七彩序号
 *  都按消息原始索引计算，分窗渲染带原索引 → 行为与全量渲染完全一致 */
export const WINDOW_FIRST = 120;
export const WINDOW_STEP = 160;

export function ChatPage({
  me,
  peer,
  contacts,
  ownerName,
  otherUnread,
  onBack,
  onOpenBond,
  onOpenFriendProfile,
  onSaveRemark,
  onSaveVoiceId,
  onOpenGroup,
  refreshContacts,
  onDeleteContact,
  pendingCall,
  onConsumePendingCall,
}: {
  me: QQUser;
  peer: ContactRecord;
  /** 全部联系人（长按菜单「转发」选择目标会话用） */
  contacts: ContactRecord[];
  ownerName: string | null;
  /** 除当前会话外的未读总数（他人在你聊天时来信 → 返回键旁灰圆数字） */
  otherUnread: number;
  onBack: () => void;
  onOpenBond: () => void;
  /** 聊天设置页点信息卡片 → 进入好友资料页 */
  onOpenFriendProfile: () => void;
  /** 保存备注（空串 = 清除；宿主持久化 + 刷新联系人展示名） */
  onSaveRemark: (v: string) => void | Promise<void>;
  /** 保存 TA 的声音（空串 = 恢复默认；宿主持久化 + 刷新联系人） */
  onSaveVoiceId: (vid: string) => void | Promise<void>;
  /** 群聊卡片「接受邀请」后进入群聊（宿主刷新群列表并打开群页） */
  onOpenGroup?: (gid: string) => void;
  /** 47-c #108：AI 自主换头像后即时刷新 contacts state，让聊天页 peer.avatar 反应式同步 */
  refreshContacts: () => Promise<ContactRecord[]>;
  /** App 根部 toast（在聊天分支不渲染，页内用 useLocalToast 自带 toast） */
  onToast?: (m: string) => void;
  /** 聊天设置「删除联系人」→ 宿主弹二次确认（确认后关聊天 + 删除好友关系）；不传/自己会话不显示 */
  onDeleteContact?: () => void;
  /** Task 28-b 资料页通话桥：好友资料页「音视频通话」ActionSheet 选语音/视频后，宿主关资料页并
   *  路由到本聊天页时下发 { contactId, media }；这里只消费 contactId 对准当前会话的下发（拨号逻辑见下方 effect） */
  pendingCall?: { contactId: string; media: 'voice' | 'video' } | null;
  /** 消费完 pendingCall 通知宿主清空（防同一次下发被重复消费） */
  onConsumePendingCall?: () => void;
}) {
  // 聊天页自带 toast（App 根 toast 在聊天分支提前 return 不渲染——收藏成功等提示靠它显示）
  const [chatToast, onToast] = useLocalToast();
  // 退出聊天页/切换会话：停止语音播放与 TTS 朗读并释放播放器（单例，防跨会话串音）
  useEffect(() => () => {
    stopSpeaking();
    stopVoicePlayback();
  }, [peer.id]);
  // Task 40：语音气泡播放失败 → 页内 toast（播放器本体无 UI，经全局事件解耦；onToast 为稳定引用，挂载/卸载成对）
  useEffect(() => {
    const onVoicePlayError = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      onToast(typeof msg === 'string' && msg ? msg : '语音播放失败，请稍后重试');
    };
    window.addEventListener(VOICE_PLAY_ERROR_EVENT, onVoicePlayError);
    return () => window.removeEventListener(VOICE_PLAY_ERROR_EVENT, onVoicePlayError);
  }, [onToast]);
  const apiConfig = useSettings((s) => s.apiConfig);
  // 第十七轮聊天气泡装扮：订阅全局配置（装扮页修改 → 聊天气泡实时跟随）
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  // 聊天显示设置（聊天设置 › 显示设置，按联系人隔离）：头像形状 / 已读未读回执 / 时间显示（修改 → 实时跟随）
  const chatDisplay = useChatDisplay('qq', peer.id);
  // 液态玻璃主题（个性装扮 › 界面主题）：只接管页面铬件——页面底 lg-root + 顶栏完全透明悬浮（名字椭圆形玻璃胶囊包裹）
  // + 返回/菜单 lg-chip 椭圆 + 输入框毛玻璃胶囊 + 六工具钮 lg-chip + 语音/加号/表情面板 lg-sheet；
  // 聊天气泡仍由装扮系统（kind）管、聊天背景层完全不受主题影响（用户指定）；默认主题时零覆盖
  const liquid = isLiquidTheme(bubbleStyle, 'qq');
  // 古早主题（retro，第五十四轮）：聊天页深灰安卓顶栏 + 灰色聊天底；气泡由装扮系统 kind='retro' 全局接管
  const retro = isRetroTheme(bubbleStyle, 'qq');
  // 液态玻璃皮肤（本轮新增）：顶栏名字区显示模式（text/avatarName/dual/dualName；仅液态主题生效）
  const liquidSkinQq = useSettings((s) => s.liquidSkin.qq);
  // 聊天输入框自定义（本轮新增）：输入框占位文字 + 加号面板功能（默认/液态两种主题都生效）
  const chatDecorQq = useSettings((s) => s.chatDecor.qq);
  // 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）：聊天作用域 —— 只作用于当前联系人的
  // QQ 聊天页（根节点挂 data-chat-css="qq:联系人ID"，选择器经 scopeCss 自动加前缀，
  // 且前缀比全局多一级属性 → 特异性压制全局 CSS；不会泄漏到聊天页以外/其他联系人）
  const qqCssKey = chatContactKey('qq', peer.id);
  const chatCustomCss = useSettings((s) => s.customCss.chats[qqCssKey]);
  const [msgs, setMsgs] = useState<QQMsg[]>(() => loadMsgs(peer.id));
  // v1.3 Shizuku：AI 使用技能时聊天界面正中的椭圆形胶囊浮层（start/finish 稳定引用，异步闭包里安全调用）
  const opPill = useOpPill();
  // 40-b 跨 App 环境感知：会话打开即预热（其他三个 App 最近原始消息 + 共同群近况），
  // 每轮 AI 回合开头再异步刷新一次；回合内同步读最近一次构建结果（systemFull 拼装是同步的）
  const crossCtxRef = useRef<{ crossAppBlock: string; groupBlock: string }>({ crossAppBlock: '', groupBlock: '' });
  useEffect(() => {
    let alive = true;
    // AI 视角统一真名指代用户（跨 App 块里的「{me}：」行标签/环境行）；展示名只用于 UI 显示
    buildCrossContextBlocks(peer.id, 'qq', me.realName || me.name)
      .then((b) => {
        if (alive) crossCtxRef.current = b;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peer.id, me.name, me.realName]);
  // 46-f：相册缓存——runAiTurn 开回合时刷新本联系人相册，buildReplyMsgs
  // 同步查 pick-album-* 目标（getAlbum 是 async 不能在同步循环里 await，改预取缓存）。挂载时
  // 也预热一次，避免接力回复（bgEnqueueBatch 路径，未走 runAiTurn）发生时缓存为空导致查不到。
  // 第三十一轮：改为「peer 相册 + 机主相册」合并视图（listAlbumsForChat）——AI 存图双写后
  // 两边相册都有内容，选图/清单/兕底统一用合并缓存（contactId 区分归属）
  const albumCacheRef = useRef<AlbumRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listAlbumsForChat(peer.id, me.id).then((list) => {
      if (alive) albumCacheRef.current = list;
    });
    return () => {
      alive = false;
    };
  }, [peer.id, me.id]);
  /** 双向拉黑状态（kv 持久化，按联系人隔离；气泡图标/设置开关/AI 感知共用） */
  const [blk, setBlk] = useState<BlockEntry>(() => loadBlock('qq', peer.id));
  // 40-a：用户发起「解除拉黑申请」的展开面板与理由输入（仅被角色拉黑时显示；ChatPage 按 peer.id keyed 重挂载，会话切换自然复位）
  const [userReqOpen, setUserReqOpen] = useState(false);
  const [userReqText, setUserReqText] = useState('');
  /** Task 40 错误提示优化：用户点「隐藏这条提示」的失败提示行（内存态，重挂载/刷新后恢复显示） */
  const [hiddenFail, setHiddenFail] = useState<Record<string, boolean>>({});
  // Task 40 草稿箱：惰性初始化恢复本会话未发送草稿（ChatPage 按 peer.id keyed 重挂载，切换会话各读各的）
  const [input, setInput] = useState(() => getChatDraft('qq', peer.id));
  /** Task 40 草稿箱：超长截断提示的 5 秒节流（连续键入超长文本只提示一次） */
  const draftWarnRef = useRef(0);
  /** 富文本输入框（contentEditable）：内置表情在框内显示真实表情图，发送时序列化回 [微笑] 代码 */
  const richInputRef = useRef<ChatRichInputHandle | null>(null);
  /** 语音输入模式：输入框替换为「按住 说话」胶囊（工具栏麦克风钮切换） */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用） */
  const [ttsSend, setTtsSend] = useState(false);
  /** 待发送图片预览（发图先预览）：工具栏「图片/拍摄」选图后先进输入框下方预览条，点「发送」才真正发出并触发 AI 回合 */
  const [pendingImgs, setPendingImgs] = useState<Array<{ id: string; src: string }>>([]);
  // pendingImgs 的同步镜像：异步压缩/移除/发出多处并发改写，统一以 ref 为准再同步回 state（避免闭包读到旧值）
  const pendingImgsRef = useRef<Array<{ id: string; src: string }>>([]);
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `qq:${peer.id}`;
  // v1.9.23 工具轮系统行实时上屏：phone-tools 直接落 kv 后广播 chat-stream-sysline，按会话增量合并
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey: string }>).detail;
      if (!d || d.sessionKey !== sessionKey) return;
      const loaded = loadMsgs(peer.id);
      if (!loaded) return;
      setMsgs((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const add = loaded.filter((m) => !seen.has(m.id));
        return add.length ? [...prev, ...add] : prev;
      });
    };
    window.addEventListener('chat-stream-sysline', h);
    return () => window.removeEventListener('chat-stream-sysline', h);
  }, [sessionKey, peer.id]);

  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  // v1.9.12 聊天滚动重做（全端共享 hook，见 hooks/use-chat-autoscroll.tsx 头注释）：
  // 进入即到底（无动画）、发送（末条=机主消息）必到底、AI 消息贴底跟随/看历史时浮轻提示；
  // 滚底签名守卫同旧实现：仅结构性变化（条数/末条 id/流式内容）才评估，转文字等原地更新不拽动视口
  const { scrollRef, scrollToBottom, showNewMsg } = useChatAutoScroll(
    `${msgs.length}:${msgs[msgs.length - 1]?.id ?? ''}:${stream?.content ?? ''}`,
    { mine: msgs[msgs.length - 1]?.role === 'me' },
  );
  // ---- v71 分窗渲染（界面提速）：初始只渲染最近 WINDOW_FIRST 条，上滑到顶自动向前扩 ----
  const [visibleCount, setVisibleCount] = useState(WINDOW_FIRST);
  const winStart = Math.max(0, msgs.length - visibleCount);
  /** 向前扩窗时记录「加载前内容底缘到视口顶的距离」，渲染提交后把 scrollTop 顶回，
   *  视口停留在原消息上（iOS 原生上翻加载同款体验） */
  const topAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (topAnchorRef.current != null && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = Math.max(0, el.scrollHeight - topAnchorRef.current);
      topAnchorRef.current = null;
    }
  });
  // 加号面板（弹出时把输入行+工具栏整体顶起，输入框跟随面板上浮）
  const [plusOpen, setPlusOpen] = useState(false);
  /** 一起听选歌弹层（加号面板「一起听」入口；选歌后我方发邀请卡进聊天，AI 接受后双方发同意卡） */
  const [tgPickOpen, setTgPickOpen] = useState(false);
  /** 单聊 @ 提及：键入 @ 唤起联系人浮层，点选后替换该 @ 并插入「@名字 」（与群聊同款交互） */
  const [atOpen, setAtOpen] = useState(false);
  // 表情面板（与加号面板互斥）
  const [stickerOpen, setStickerOpen] = useState(false);
  // 聊天内部浮层（发红包/转账/红包开箱/详情/发送位置/文字图片）
  const [layer, setLayer] = useState<ChatLayer>(null);
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; packet: MsgPacket; methodId: string }>(null);
  /** 手动「文字图片」状态（Task 14 卡片版，以「我」的身份发出）：loading / 错误（弹层内展示，失败不影响聊天） */
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState('');
  /** 点击「文字图片」卡片弹出的操作面板（用图像生成生成图片/复制文字）：目标消息 id + 生成中标记 */
  const [cardActionId, setCardActionId] = useState<string | null>(null);
  const [cardGenBusy, setCardGenBusy] = useState(false);
  // ---- 长按 AI 图片「重新生成图片」弹层：目标消息 id + 可编辑描述 + busy/错误（三端同款交互） ----
  const [regenImgId, setRegenImgId] = useState<string | null>(null);
  const [regenImgDesc, setRegenImgDesc] = useState('');
  const [regenImgBusy, setRegenImgBusy] = useState(false);
  const [regenImgError, setRegenImgError] = useState('');
  // ---- 图片大图查看器（点图片气泡打开，黑底居中；与信息端同款） ----
  const [imgViewer, setImgViewer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 原生相机隐藏 input（capture 调起后置摄像头，对齐微信：不再使用自建取景浮层）
  const cameraInputRef = useRef<HTMLInputElement>(null);
  /** 聊天设置页（右上角菜单进入）：信息卡片/置顶/免打扰/查找聊天记录/回复条数/聊天背景 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 关系本地显示值（多账号关系感知）：保存后乐观更新（peer 是快照，重挂载/切号后重读） */
  const [relationLocal, setRelationLocal] = useState<string | null>(null);
  /** 角色状态卡（点击消息行对方头像弹出：心情/好感度/心声/动作/穿着/位置/时间，实时生成不影响聊天） */
  const [peerStatusOpen, setPeerStatusOpen] = useState(false);
  /** 查找聊天记录页 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 聊天背景页（设置页「聊天背景」进入的独立二级页） */
  const [bgOpen, setBgOpen] = useState(false);
  /** 回复条数页（设置页「回复条数」进入的独立二级页，按会话隔离） */
  const [replyOpen, setReplyOpen] = useState(false);
  // 他的声音（角色音色选择）与 AI 语音频率二级页（设置页进入）
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceFreqOpen, setVoiceFreqOpen] = useState(false);
  const myVoicesForSummary = useMyVoices((s) => s.voices);
  /** 当前会话的回复条数（AI 连发多条消息；切换角色时随 sessionKey 重读） */
  const [replyCount, setReplyCountState] = useState(() => getReplyCount(sessionKey));
  useEffect(() => {
    setReplyCountState(getReplyCount(sessionKey));
  }, [sessionKey]);
  /** 翻译页（设置页「翻译」进入的独立二级页，按会话隔离） */
  const [translateOpen, setTranslateOpen] = useState(false);
  /** 当前会话的翻译配置（开启后文字消息气泡下方显示所选语言的译文；切换角色随 sessionKey 重读） */
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
  /** 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle） */
  const [stickersOn, setStickersOnState] = useState(() => getStickersOn(sessionKey));
  useEffect(() => {
    setStickersOnState(getStickersOn(sessionKey));
  }, [sessionKey]);
  // 动作描写开关（渲染订阅版）：设置页切换后经事件即时刷新，历史消息显示同步生效（见 @/lib/action-desc）
  const actionDescOn = useActionDescOn(sessionKey);
  // 深度思考开关（渲染订阅版，IndexedDB 按联系人隔离）：关闭时思维链卡片整体丢弃不渲染（思考指令仍注入）
  const deepThinkOn = useDeepThinkOn(peer.id);
  /** 深度思考本轮上下文（runAiTurn 开头重置）：firstMsgId = 本回合第一条 AI 文本消息 id（投递完回填思考用），
   *  text = 流层剥离 + buildReplyMsgs 兜底剥离合并的思考过程 */
  const turnThinkRef = useRef<{ firstMsgId: string | null; text: string }>({ firstMsgId: null, text: '' });
  // 「回车键发送消息」开关（QQ App 级、按账号隔离，单聊+群聊共用；默认开启=回车发送，关闭=回车换行）
  const enterSend = useEnterSend('qq');
  /** 世界书挂载页（设置页「世界书」进入）：为联系人勾选挂载的书籍（见 @/lib/ios/worldbook） */
  const [wbOpen, setWbOpen] = useState(false);
  /** 主动发消息设置页（聊天设置二级页：定时/事件/自主/提醒四类触发） */
  const [proactiveOpen, setProactiveOpen] = useState(false);
  /** 感知设置二级页开关（打字/电量/天气/日历/ActivityWatch 真机感知/看屏；按会话独立） */
  const [perceptionOpen, setPerceptionOpen] = useState(false);
  // 感知预热：进入聊天即拉一次感知数据（天气/ActivityWatch/屏幕描述缓存），首轮对话就有数据
  useEffect(() => {
    void prewarmPerception(sessionKey);
  }, [sessionKey]);
  /** 当前联系人挂载的世界书 id（切换联系人/挂载变化时重读） */
  const [wbBound, setWbBound] = useState<string[]>(() => getBoundBookIds(peer.id));
  useEffect(() => {
    setWbBound(getBoundBookIds(peer.id));
  }, [peer.id]);
  /** 分句发送批次「待 AI 回复」标记（跨页面切换持久，见 @/lib/sentence-send） */
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sessionKey));
  useEffect(() => {
    setPendingDispatch(hasPendingBatch(sessionKey));
  }, [sessionKey]);
  /** 登记当前正在查看的聊天：AI 回复落盘时按此决定是否计未读角标（退出聊天页后 AI 回复 → 角标 +1） */
  useEffect(() => {
    qqActiveChatId = peer.id;
    // 主动发消息角标守卫同步登记：用户正看着该会话时主动消息不涨角标（消息实时可见）
    setActiveProactiveChat('qq', peer.id);
    return () => {
      if (qqActiveChatId === peer.id) qqActiveChatId = null;
      setActiveProactiveChat('qq', null);
    };
  }, [peer.id]);
  /** 单聊卡片过期清算（进聊天页即扫 + 同步本会话视图）：AI 发的红包/转账超 24h 未领取/未收款 →
   *  过期退回（卡片置终态 + 「XX的红包/转账已过期退回」提示行；模块层防重入，QQ App 挂载时也会扫一遍） */
  useEffect(() => {
    let alive = true;
    void expireStaleSingleCards().then((changed) => {
      if (!alive || !changed) return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        return sortMsgsByTime([
          ...prev.map((m) => savedMap.get(m.id) ?? m),
          ...saved.filter((m) => !prev.some((p) => p.id === m.id)),
        ]);
      });
    });
    return () => {
      alive = false;
    };
  }, [peer.id]);
  /** 搜索定位命中的消息 id（短暂高亮） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 气泡长按菜单（横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: QQMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<QQMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  /** 引用回复（输入框上方条；发送时挂到新消息上） */
  const [quote, setQuote] = useState<null | { name: string; content: string; id?: string; time?: number }>(null);
  /** 多选模式：勾选消息批量删除/转发/收藏 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 转发流程：'choose'=在聊天里勾选消息（顶部计数栏 + 底部逐条/合并/取消）；'target'=选目标会话；null=未进行中 */
  const [fwdFlow, setFwdFlow] = useState<'choose' | 'target' | null>(null);
  const [fwdMode, setFwdMode] = useState<FwdMode>('each');
  /** 合并转发「聊天记录」卡片详情（点卡片打开） */
  const [fwdDetailId, setFwdDetailId] = useState<string | null>(null);
  /** 聊天页根元素（长按菜单定位参照） */
  const pageRef = useRef<HTMLDivElement>(null);
  /** 聊天背景（本会话）：置顶/免打扰/背景在 chat-flags 总线，图片本体在 IndexedDB */
  const flags = useChatFlags(qqChatFlagsStore)[peer.id] ?? NO_FLAGS;
  const bg: ChatSettingsBg = { mode: flags.bgMode ?? 'default', color: flags.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  // 发红包/转账页支付方式上下文（打开发送页时刷新）
  const [payCtx, setPayCtx] = useState(() => ({ wallet: loadWallet(), cards: loadBankCards() }));
  // 发红包/转账页支付方式上下文（打开发送页时刷新；微任务内 setState 规避 react-hooks/set-state-in-effect）
  useEffect(() => {
    if (layer?.view === 'redpacket' || layer?.view === 'transfer') {
      void Promise.resolve().then(() => {
        setPayCtx({ wallet: loadWallet(), cards: loadBankCards() });
      });
    }
  }, [layer]);

  const patchPacket = useCallback((msgId: string, patch: Partial<MsgPacket>) => {
    setMsgs((prev) => prev.map((m) => (m.id === msgId && m.packet ? { ...m, packet: { ...m.packet, ...patch } } : m)));
  }, []);

  /** runAiTurn 的稳定引用：发红包/转账/亲属卡（sendRedPacket 等定义在 runAiTurn 之前）也要触发 AI 回复，
   *  直接引用会产生先定义后声明的循环依赖，用 ref 中转（runAiTurn 定义后回填） */
  const runAiTurnRef = useRef<((userMsg: QQMsg | null, extra?: QQMsg[], sysEvent?: string, baseMsgs?: QQMsg[]) => void) | null>(null);

  /** 领取亲属卡（对方/AI 赠送的卡）：标记已领取 + 时间；纯本地模拟，无资金流转。
   *  #29 领取后关闭详情浮层：浮层停留时连点可能重复触发——关浮层移除按钮消除连点窗口（与退还路径同款）。
   *  用户操作后 AI 不再自动跟发；AI 感知来自聊天历史卡片终态序列化与既有记忆管线 */
  const claimFam = useCallback(
    (msgId: string) => {
      setMsgs((prev) => prev.map((m) => (m.id === msgId && m.fam && !m.fam.claimed ? { ...m, fam: { ...m.fam, claimed: true, claimedAt: Date.now() } } : m)));
      setLayer(null);
    },
    [],
  );

  /**
   * 退还 AI 发来的红包/转账/亲属卡（红包弹窗「退还」、转账收款页「退还」、亲属卡详情「退还」共用）：
   * 原卡标记终态（变灰）+ 聊天里追加通知行 + toast。用户操作后 AI 不再自动跟发；
   * AI 感知来自聊天历史卡片终态序列化与既有记忆管线
   */
  const refundPeerCard = useCallback(
    (m: QQMsg) => {
      if (m.kind === 'redpacket' && m.packet) {
        patchPacket(m.id, { status: 'returned' });
        setMsgs((prev) => [
          ...prev,
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你退回了${peer.name}的`, accent: '红包' } },
        ]);
        setLayer(null);
        onToast('红包已退还给对方');
      } else if (m.kind === 'transfer' && m.packet) {
        const refundedAt = Date.now();
        const trAmt = m.packet.amount;
        const trNote = m.packet.note;
        // 我退还 AI 发的转账：原卡标记终态（变灰）+ 追加「我」发出的退还凭据卡（灰卡↩+已退还，详情页「你已退还」）
        patchPacket(m.id, { status: 'returned', refundedAt });
        setMsgs((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'me',
            content: '',
            time: refundedAt,
            kind: 'transfer',
            packet: { type: 'transfer', amount: trAmt, note: trNote, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'me' as const },
          },
        ]);
        setLayer(null);
        onToast('转账已退还给对方');
      } else if (m.kind === 'family' && m.fam) {
        setMsgs((prev) => prev.map((x) => (x.id === m.id && x.fam ? { ...x, fam: { ...x.fam, rejected: true } } : x)));
        setMsgs((prev) => [
          ...prev,
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'fam', pre: `你退回了${peer.name}的`, accent: '亲属卡' } },
        ]);
        setLayer(null);
        onToast('亲属卡已退还');
      }
    },
    [patchPacket, peer.name, onToast]
  );

  // 发红包消息（生成 AI 可引用的短 ID）：AI 在回复里用动作标记决定领取/退回/拒收（不再定时自动领取），
  // 发出后立即触发一轮 AI 回复（红包会进待处理清单，AI 按人设处理）
  const sendRedPacket = useCallback(
    (p: MsgPacket) => {
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'redpacket', packet: { ...p, cid: nextCid('rp') } };
      setMsgs((prev) => [...prev, msg]);
      if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
    },
    [peer.id, me.id]
  );

  // 发转账消息（生成 AI 可引用的短 ID）：AI 在回复里用动作标记决定收款/退回/拒收，发出后立即触发 AI 回复
  const sendTransfer = useCallback(
    (p: MsgPacket) => {
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'transfer', packet: { ...p, cid: nextCid('tr') } };
      setMsgs((prev) => [...prev, msg]);
      if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
    },
    [peer.id, me.id]
  );

  // 发图先预览：工具栏「图片/拍摄」选图后只压缩进待发预览条（输入框下方，最多 9 张，可逐张移除），
  //  不上屏也不触发 AI；点主发送按钮才由 send()/flushPendingImages 真正发出（可与输入框文字组合发送：
  //  文字在前、图片在后，只触发一轮 AI 回合）。
  //  发出后照常触发 AI 回合：已配置识图模型时识图模型先看图、聊天模型再回复；未配置时
  //  chat-stream-store 注入「我发了图片但你看不到内容」临时上下文，AI 同样自然回应（#26）
  const stageImageFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      let overflow = 0;
      for (const f of Array.from(files)) {
        // 上限 9 张（含已在预览条里的）：超出不再读图，最后统一 toast 提示
        if (pendingImgsRef.current.length >= 9) {
          overflow += 1;
          continue;
        }
        try {
          const d = await compressImageFile(f);
          // 压缩等待期间预览条可能已变化（移除/发出），入列前再核一次上限
          if (pendingImgsRef.current.length >= 9) {
            overflow += 1;
            continue;
          }
          // 空串/非图片数据不再入列（第二十九轮：发出破图不如不发）
          if (!d.startsWith('data:image/')) {
            onToast('图片发送失败');
            continue;
          }
          const item = { id: uid(), src: d };
          pendingImgsRef.current = [...pendingImgsRef.current, item];
          setPendingImgs(pendingImgsRef.current);
        } catch {
          onToast('图片发送失败');
        }
      }
      if (overflow > 0) onToast('一次最多发 9 张图片');
    },
    [onToast]
  );

  /** 把预览条里的待发图片逐张转成图片消息发出（消息结构同旧版直发：content=dataURL，无 img 字段）并触发 AI 回合 */
  const flushPendingImages = useCallback(() => {
    const staged = pendingImgsRef.current;
    if (staged.length === 0) return;
    // 40-a 拉黑拦截：被角色拉黑（byChar）后图片也发不出（不落库不触发 AI）
    if (loadBlock('qq', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    pendingImgsRef.current = [];
    setPendingImgs([]);
    const created: QQMsg[] = staged.map((p) => ({ id: uid(), role: 'me', content: p.src, time: Date.now(), kind: 'image', unread: true }));
    for (const msg of created) setMsgs((prev) => [...qqMarkPeerRead(prev), msg]);
    if (peer.id === me.id) return;
    // 对方正在回复（流式/投递中）：与文字消息同口径排队补跑——本轮「流收尾且投递完毕」后自动回复图片消息
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      qqQueueAdd(peer.id);
      onToast('消息已发出，对方回完这轮就聊');
      return;
    }
    runAiTurnRef.current?.(null, created);
  }, [me.id, onToast, peer.id, sessionKey]);

  /** 从预览条移除一张待发图片 */
  const removePendingImg = (id: string) => {
    pendingImgsRef.current = pendingImgsRef.current.filter((p) => p.id !== id);
    setPendingImgs(pendingImgsRef.current);
  };

  // 按所选支付方式扣款并发送卡片消息
  const execAndSend = useCallback(
    (kind: 'redpacket' | 'transfer', p: MsgPacket, methodId: string) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后红包/转账也发不出（扣款前拦截，不落库不触发 AI）
      if (loadBlock('qq', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      const paid = executePayment(
        methodId,
        p.amount,
        kind === 'redpacket' ? 'QQ红包-发红包' : `转账-转给${peer.name}`,
        { kind: kind === 'redpacket' ? 'redpacket' : 'transfer', avatar: peer.avatar }
      );
      if (!paid) {
        onToast(methodId === 'balance' ? '余额不足，请更换支付方式或先充值' : '卡内余额不足，请更换支付方式');
        return;
      }
      if (kind === 'redpacket') {
        sendRedPacket(p);
        onToast(`红包已发出 ${fmtMoney(p.amount)} 元`);
      } else {
        sendTransfer(p);
        onToast(`已向${peer.name}转账 ${fmtMoney(p.amount)} 元`);
      }
      setLayer(null);
    },
    [onToast, peer.name, sendRedPacket, sendTransfer]
  );

  // 发送前：可支付性预检 → 开启支付密码则先弹自绘键盘验证
  const startSend = useCallback(
    (kind: 'redpacket' | 'transfer', p: MsgPacket, methodId: string) => {
      if (peer.id === me.id) {
        onToast(kind === 'redpacket' ? '不能给自己发红包哦' : '不能给自己转账哦');
        return;
      }
      if (!canPay(methodId, p.amount)) {
        onToast(methodId === 'balance' ? '余额不足，请更换支付方式或先充值' : '卡内余额不足，请更换支付方式');
        return;
      }
      const pp = loadPayPwd();
      if (pp.enabled && pp.pwd) setGate({ kind, packet: p, methodId });
      else execAndSend(kind, p, methodId);
    },
    [me.id, onToast, peer.id, execAndSend]
  );

  // 左滑手势：页面任意位置（表单控件/按钮除外）水平左滑 → 好友互动标识页
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    // 聊天设置/聊天背景/查找记录/红包等浮层打开时不触发手势，避免滑动误入互动标识页
    if (settingsOpen || searchOpen || bgOpen || layer) return;
    const el = e.target as HTMLElement;
    // 输入框/按钮不触发手势，避免影响输入与点击
    if (el.closest('input, textarea, button')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx < -50 && Math.abs(dy) < 80) {
      t.fired = true;
      onOpenBond();
      return;
    }
    if (dx > 30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(peer.id, msgs);
  }, [msgs, peer.id]);

  /** 群聊卡片：接受/拒绝（状态随消息持久化；接受后宿主打开群聊） */
  const decideGroupCard = useCallback(
    (m: QQMsg, accept: boolean) => {
      if (!m.gcard || m.gcard.status !== 'pending') return;
      const r = applyGroupCardDecision('qq', peer.id, m.id, accept);
      setMsgs((prev) => prev.map((x) => (x.id === m.id && x.gcard ? { ...x, gcard: { ...x.gcard, status: accept ? 'accepted' : 'rejected' } } : x)));
      if (accept && r?.joined) {
        onToast(`已加入群聊「${r.groupName}」`);
        onOpenGroup?.(m.gcard.gid);
      } else if (accept) {
        onToast('该群聊已失效');
      } else {
        onToast('已拒绝邀请');
      }
    },
    [peer.id, onOpenGroup, onToast],
  );

  /** 亲密关系卡片：接受/拒绝（情侣空间邀请卡；状态变更/成功卡/sys 行均由 couple-invite 落库，
   *  本地经 COUPLE_CARD_EVENT 合并刷新；content 为空、不进多选/长按菜单） */
  const decideCoupleCard = useCallback(
    (m: QQMsg, accept: boolean) => {
      if (!m.relcard || m.relcard.status !== 'pending') return;
      void decideCoupleCardAction(peer.id, m.id, accept).then((r) => {
        onToast(r.ok ? (accept ? '已同意，你们现在是情侣啦' : '已拒绝邀请') : r.error);
      });
    },
    [peer.id, onToast],
  );

  // 转发感知：其他会话转发消息给本会话时写入事件队列；进入聊天时 drain 并触发一次 AI 回合（AI 知道收到了什么）。
  // 37-a：drain 改为「读全部 + 内存登记已消费 + 延迟清除」，回合定时器不随卸载取消——
  // dev StrictMode 双挂载时：首跑消费的事件在重挂载第二次 drain 中被登记过滤（不双跑），
  // 首跑的回合定时器不再被 cleanup 清掉（不丢）；ChatPage 按 peer.id keyed 重挂载，定时器闭包
  // 持有的 runAiTurnRef 恒指向本会话实现，模块层投递管线与页面存活无关
  useEffect(() => {
    const evs = drainAiEvents(peer.id);
    if (evs.length === 0) return;
    window.setTimeout(() => {
      // 连发投递未清空时同样不开新回合（与发送排队同口径：上一轮尾部还没落盘完）；错过的事件随本轮上下文丢失，与流式中占用的既有口径一致
      if (!isChatStreaming(sessionKey) && !isAiDelivering(sessionKey)) runAiTurnRef.current?.(null, [], evs.join('\n'));
    }, 400);
  }, [peer.id, sessionKey]);

  // 聊天背景图片加载（bgMode = image 时从 IndexedDB 读；bgV 变化 = 重新上传，重读）
  useEffect(() => {
    let alive = true;
    if (bg.mode === 'image') {
      void getChatBgImage('qq', peer.id).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bg.mode, flags.bgV, peer.id]);

  // 翻译：开启后把文字消息（最近 60 条，排除错误/兑底文案）按检测到的语言双向翻译成另一侧
  // （左侧语言的消息译成右侧，右侧语言的消息译成左侧）。缓存、并发闸、在途去重都在
  // @/lib/chat-translate 内部，这里只负责把结果写入组件状态
  useEffect(() => {
    if (!transCfg.on) return;
    // 错误/兜底文案不参与翻译：新版统一〔…〕全角方括号包裹（与微信一致、历史组装同口径排除）；
    // 旧格式（消息发送失败：…）/（对方暂时…仍保留判定，兼容修复前已落盘的历史消息
    const isErrText = (s: string) => s.startsWith('〔') || s.startsWith('（消息发送失败') || s.startsWith('（AI') || s.startsWith('（对方暂时');
    const targets = msgs.filter((m) => !m.kind && m.content.trim() && !isErrText(m.content)).slice(-60);
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
  const renderTranslations = (msgId: string, content: string) => {
    if (!transCfg.on) return null;
    if (!content.trim() || content.startsWith('〔') || content.startsWith('（消息发送失败') || content.startsWith('（AI') || content.startsWith('（对方暂时')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="qq-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-black/45 dark:text-white/45"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑。
   *  同 id 消息用落盘的 packet/fam 覆盖本地（finalize 里 AI 领取/退回/拒收动作已更新卡片状态） */
  useLayoutEffect(() => {
    if (!stream || stream.status === 'streaming') return;
    void Promise.resolve().then(() => {
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        const merged = prev.map((m) => {
          const s = savedMap.get(m.id);
          if (!s) return m;
          return {
            ...m,
            ...(s.packet ? { packet: s.packet } : {}),
            ...(s.fam ? { fam: s.fam } : {}),
            ...(s.content && !m.content ? { content: s.content } : {}),
          };
        });
        // 按 id 合并：本地新增的（红包/转账等补丁后的消息）保留，落盘新增的只会是 AI 回复
        const ids = new Set(prev.map((m) => m.id));
        return [...merged, ...saved.filter((m) => !ids.has(m.id))];
      });
      clearChatStream(sessionKey);
    });
  }, [stream, sessionKey, peer.id]);

  /** 逐条投递 tick：AI 回复由 ai-delivery 调度器按真人节奏逐条落盘（模块层，与页面是否存活无关），
   *  每条到达后把落盘记录合并进本地 state；同 id 用落盘数据覆盖（动作状态/语音升级以存储为权威）。
   *  #35：合并后按创建时间稳定排序——投递插入边界让落库时序正确，但 state 合并是新项尾部追加，
   *  排序把「插在边界前的旧回复」放回正确位置，显示与下一轮上下文都按真实对话时序 */
  useEffect(() => {
    return subscribeAiDelivery(sessionKey, () => {
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        return sortMsgsByTime([
          ...prev.map((m) => savedMap.get(m.id) ?? m),
          ...saved.filter((m) => !prev.some((p) => p.id === m.id)),
        ]);
      });
    });
  }, [sessionKey, peer.id]);

  /** 一起听卡片落库监听（第二十六轮）：AI 邀请被接受（全局弹卡 ✓）时同意卡走 kv 直写
   *  （together-flow），聊天页在场时实时把新增落库消息合并进本地——不用重开聊天才显示 */
  useEffect(() => {
    const onTgCard = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const ids = new Set(prev.map((m) => m.id));
        return sortMsgsByTime([...prev, ...saved.filter((m) => !ids.has(m.id))]);
      });
    };
    window.addEventListener(TG_CARD_INSERTED_EVENT, onTgCard);
    return () => window.removeEventListener(TG_CARD_INSERTED_EVENT, onTgCard);
  }, [peer.id]);

  /** 美团找人代付卡片落库监听：美团收银台发请求卡/好友代付完成卡直写 kv 后广播，
   *  聊天页在场时实时合并落库消息（新卡片显示 + 请求卡状态刷新），不用重开聊天 */
  useEffect(() => {
    const onMtProxy = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const ids = new Set(prev.map((m) => m.id));
        return sortMsgsByTime([...prev, ...saved.filter((m) => !ids.has(m.id))]);
      });
    };
    window.addEventListener(MT_PROXY_CARD_EVENT, onMtProxy);
    return () => window.removeEventListener(MT_PROXY_CARD_EVENT, onMtProxy);
  }, [peer.id]);

  /** 美团订单分享卡片落库监听：订单详情分享卡直写 kv 后广播，聊天页在场时实时合并 */
  useEffect(() => {
    const onMtShare = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const ids = new Set(prev.map((m) => m.id));
        return sortMsgsByTime([...prev, ...saved.filter((m) => !ids.has(m.id))]);
      });
    };
    window.addEventListener(MT_SHARE_CARD_EVENT, onMtShare);
    return () => window.removeEventListener(MT_SHARE_CARD_EVENT, onMtShare);
  }, [peer.id]);

  /** 淘宝代付/订单分享卡片落库监听（用户反馈：加号快递里分享订单要退出重进才显示）：
   *  淘宝收银台代付请求卡/完成卡与订单分享卡直写 kv 后广播 TB_*_CARD_EVENT，
   *  聊天页在场时实时合并落库消息（新卡片立即上屏 + 请求卡状态刷新），不用重开聊天 */
  useEffect(() => {
    const onTbCard = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const ids = new Set(prev.map((m) => m.id));
        return sortMsgsByTime([...prev, ...saved.filter((m) => !ids.has(m.id))]);
      });
    };
    window.addEventListener(TB_PROXY_CARD_EVENT, onTbCard);
    window.addEventListener(TB_SHARE_CARD_EVENT, onTbCard);
    return () => {
      window.removeEventListener(TB_PROXY_CARD_EVENT, onTbCard);
      window.removeEventListener(TB_SHARE_CARD_EVENT, onTbCard);
    };
  }, [peer.id]);

  /** X论坛帖子分享卡落库监听：论坛分享/AI 回应直写 kv 后广播 FORUM_SHARE_CARD_EVENT，
   *  聊天页在场时实时合并落库消息（新卡片立即上屏），不用重开聊天 */
  useEffect(() => {
    const onForumCard = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const ids = new Set(prev.map((m) => m.id));
        return sortMsgsByTime([...prev, ...saved.filter((m) => !ids.has(m.id))]);
      });
    };
    window.addEventListener(FORUM_SHARE_CARD_EVENT, onForumCard);
    return () => window.removeEventListener(FORUM_SHARE_CARD_EVENT, onForumCard);
  }, [peer.id]);

  /** 情侣空间亲密关系卡片落库监听：邀请卡/成功卡/sys 行由 couple-invite 直写 kv 后广播
   *  COUPLE_CARD_EVENT，聊天页在场时实时合并落库消息（新卡片上屏 + 邀请卡状态刷新），不用重开聊天 */
  useEffect(() => {
    const onCoupleCard = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'qq') return;
      setMsgs((prev) => {
        const saved = loadMsgs(peer.id);
        const savedMap = new Map(saved.map((m) => [m.id, m]));
        return sortMsgsByTime([
          ...prev.map((m) => savedMap.get(m.id) ?? m),
          ...saved.filter((m) => !prev.some((p) => p.id === m.id)),
        ]);
      });
    };
    window.addEventListener(COUPLE_CARD_EVENT, onCoupleCard);
    return () => window.removeEventListener(COUPLE_CARD_EVENT, onCoupleCard);
  }, [peer.id]);

  /** 投递进行中（含排队批次）：标题维持「正在输入中…」，直到最后一条消息发出 */
  const [delivering, setDelivering] = useState(() => isAiDelivering(sessionKey));
  useEffect(() => {
    setDelivering(isAiDelivering(sessionKey));
    return subscribeAiDeliveryActive(() => setDelivering(isAiDelivering(sessionKey)));
  }, [sessionKey]);

  /** 排队补跑：流进行中/连发投递中发来的消息（qqQueuedTurns）在「流收尾且投递队列清空」后自动触发回复。
   *  页面存活时监听流结束广播与投递状态变化；离开后流才收尾的，重进页面时补跑（消息已落盘不丢）。
   *  投递未清空时不能开新回合：上一轮的尾部消息还卡在投递队列里逐条落盘，此刻开新流——
   *  旧回复尾巴进不了新回合上下文（AI 新回复自相矛盾），旧气泡也会倒挂在用户新消息下面。 */
  useEffect(() => {
    const kick = () => {
      const turns = qqQueuedTurns[peer.id];
      if (!turns || turns.length === 0) return;
      if (isChatStreaming(sessionKey)) return; // 本轮流还没收尾：等结束广播再跑
      if (isAiDelivering(sessionKey)) return; // 上一轮连发还在投递：等投递完成事件再跑
      qqQueueDelete(peer.id);
      // 37-a：队列项可带系统事件（回复中处理拉黑申请/退卡时入队）——合并注入补跑回合上下文
      const sysEvent =
        turns
          .map((t) => t.event)
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .join('\n') || undefined;
      window.setTimeout(() => {
        const saved = loadMsgs(peer.id);
        setMsgs((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...saved.filter((m) => !ids.has(m.id))];
        });
        runAiTurnRef.current?.(null, [], sysEvent, saved);
      }, 260);
    };
    const unsub = subscribeChatStreamFinalized((sKey) => {
      if (sKey === sessionKey) kick();
    });
    // 投递状态变化（本会话批次开跑/投递完毕）也尝试补跑：finalize 广播到达时最后一批常常才刚入队，
    // 投递完毕的 emitActive 才是「上一轮彻底写完」的可靠触发点（subscribeAiDeliveryActive 是全局广播，
    // kick 自带 qqQueuedTurns 门控，其他会话的事件空跑即返回）
    const unsubActive = subscribeAiDeliveryActive(() => kick());
    kick(); // 挂载时：之前排队但流已结束（离开页面后流才收尾）→ 立即补跑
    return () => {
      unsub();
      unsubActive();
    };
  }, [sessionKey, peer.id]);

  /** 37-a：直写落盘的通话消息补走通知管线（灵动岛/Web 通知）+ 未读角标——与 deliverAiMsg 同一口径
   *  （notifyPreviewText 映射预览、不在本会话才 bump 角标，在场不重复计）。用户切走时，挂断续聊/
   *  拒接解释/通话结束卡片也能弹通知、动角标（此前直写库绕过了这两条） */
  const notifyDirectSave = useCallback(
    (m: { kind?: string; content: string }) => {
      const body = notifyPreviewText({ kind: m.kind, content: m.content });
      if (body) {
        pushChatNotification({
          sessionKey: `qq:${peer.id}`,
          app: 'qq',
          title: peer.name,
          avatar: peer.avatar ?? null,
          body,
          target: { app: 'qq', contactId: peer.id },
        });
      }
      if (qqActiveChatId !== peer.id) qqUnreads.bump(peer.id, 1);
    },
    [peer],
  );

  // Task 22 记录最近一次发起的通话媒体（openVoiceCall 里写入，onEnd 写卡片用）：引擎 onEnd 的
  // ChatCallResult 不携带 media，落通话卡片时用本 ref 透传——卡片图标/文案与 AI 可读摘要随之分叉视频口径
  const lastCallMediaRef = useRef<'voice' | 'video'>('voice');

  /** 通话结束（恰好一次，可能发生在聊天页已退出时）：通话卡片直写持久化 + 在场时同步本地 state。
   *  全局通话层负责渲染通话页与悬浮小窗，宿主只关心把结果落成消息。 */
  const writeCallCard = useCallback(
    (r: ChatCallResult) => {
      // 40-a 拉黑拦截：用户拉黑了该角色（byUser）后，通话结束卡片不再落库（AI 侧产物不进聊天记录）
      if (loadBlock('qq', peer.id).byUser) return;
      const st = callResultToCardState(r);
      const card: QQMsg = {
        id: uid(),
        role: r.direction === 'out' ? 'me' : 'peer',
        // Task 22 视频通话：content（AI 可读摘要）与 call.media 都按本次通话媒体透传
        content: callCardAiText(st, r.duration, lastCallMediaRef.current),
        time: Date.now(),
        kind: 'call' as const,
        call: { state: st, duration: r.duration, direction: r.direction, media: lastCallMediaRef.current },
      };
      // 通话对话全程落聊天记录（用户要求「全部对话显示在聊天界面，不光打的字」，与微信端同款）：
      // 引擎 onEnd 回传全程转写（语音轮次+文字轮次），按普通文字消息逐条落库（时间用轮次真实时间），
      // 通话卡片垫在最后作为收尾标记；挂断续聊文字经 onFollowup 另行落库（转写快照不含续聊，不重复）；
      // 未接通/无对话时只有卡片，行为不变；消息本身不推通知（只有卡片按原口径通知）
      const turnMsgs: QQMsg[] = (r.transcript ?? []).map((t) => ({
        id: uid(),
        role: t.role === 'user' ? 'me' : 'peer',
        content: t.content,
        time: t.at || Date.now(),
      }));
      const additions = [...turnMsgs, card];
      saveMsgs(peer.id, [...loadMsgs(peer.id), ...additions]);
      setMsgs((prev) => {
        const fresh = additions.filter((m) => !prev.some((p) => p.id === m.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      notifyDirectSave(card);
      // AI 拒接/未接：过一会儿 AI 主动发一条人设化解释（接听决策产出 afterText）。
      // 聊天页不在场也照常落盘（saveMsgs 直写；回来时 loadMsgs 恢复，消息照常进后续 AI 上下文）
      if (r.afterText && r.direction === 'out' && !r.connected) {
        const after = r.afterText;
        // L9 换号防串号：调度时刻捕获会话纪元，回调执行时比对失配则跳过写入
        const epoch = qqSessionEpoch;
        window.setTimeout(() => {
          // L9：延迟窗口内发生换号 → 旧账号通话尾巴不再写进新账号聊天记录
          if (epoch !== qqSessionEpoch) return;
          // 40-a 拉黑拦截：落库前再核一次（等待窗口内用户可能已拉黑）
          if (loadBlock('qq', peer.id).byUser) return;
          const msg: QQMsg = { id: uid(), role: 'peer', content: after, time: Date.now() };
          saveMsgs(peer.id, [...loadMsgs(peer.id), msg]);
          setMsgs((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          notifyDirectSave(msg);
        }, 1500 + Math.floor(Math.random() * 1500));
      }
    },
    [peer.id, notifyDirectSave],
  );

  /** 挂断后 AI 续聊文字（引擎生成完毕回调，紧随挂断）：立刻落盘+在场呈现；多条错开像手动连发。
   *  文字已随通话转写一并沉淀记忆（chat-call 引擎），这里只负责呈现与持久化（照常进后续 AI 上下文） */
  const sendCallFollowup = useCallback(
    (texts: string[]) => {
      // 40-a 拉黑拦截：用户拉黑了该角色（byUser）后，挂断续聊文字不再落库
      if (loadBlock('qq', peer.id).byUser) return;
      // L9 换号防串号：调度时刻捕获会话纪元，各条延迟回调执行时比对失配则跳过写入
      const epoch = qqSessionEpoch;
      texts.forEach((t, i) => {
        window.setTimeout(
          () => {
            // L9：连发间隔内发生换号 → 旧账号通话尾巴不再写进新账号聊天记录
            if (epoch !== qqSessionEpoch) return;
            // 40-a 拉黑拦截：落库前再核一次（连发间隔内用户可能已拉黑）
            if (loadBlock('qq', peer.id).byUser) return;
            const msg: QQMsg = { id: uid(), role: 'peer', content: t, time: Date.now() };
            saveMsgs(peer.id, [...loadMsgs(peer.id), msg]);
            setMsgs((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            notifyDirectSave(msg);
          },
          i === 0 ? 400 + Math.floor(Math.random() * 500) : i * (1400 + Math.floor(Math.random() * 1100)),
        );
      });
    },
    [peer.id, notifyDirectSave],
  );

  /** 发起全局语音通话（加号面板「语音通话」/ 通话卡片回拨 / AI 来电共用）：打开瞬间快照最近上下文；
   *  通话页与小窗由 PhoneShell 的全局通话层渲染，退出聊天页/切 App 电话不断。
   *  opts.hiddenView（#35 引入，与微信 openVoiceCall 同款能力）：响铃期间不显示全屏通话页（view='hidden'），
   *  只留全局来电弹窗——#2 起 AI 来电不再传该参数（QQ 曾因此零 UI 幽灵响铃），改走可见来电；
   *  参数保留兼容（能力与微信对齐，供后续路径按需启用）。
   *  opts.media（Task 22 视频通话）：'video' 发起视频通话——session 带 media 供全局层渲染视频通话页、
   *  来电横幅显示「邀请你视频通话」，并记入 lastCallMediaRef 供 onEnd 落卡片透传媒体（缺省语音，行为不变） */
  const openVoiceCall = useCallback(
    (direction: 'out' | 'in', opts?: { hiddenView?: boolean; media?: 'voice' | 'video' }) => {
      // B-1 通话中防御：已有全局通话（通话中/拨号中）时不发起新通话——
      // startGlobalCall 会直接替换旧 session，旧通话的卡片/记录/续聊/记忆总结全部静默丢失。
      // AI 来电（direction='in'）由触发处先行双查后放行，这里只拦手动拨出
      if (useGlobalCall.getState().session) {
        if (direction === 'out') onToast('已在通话中，请先挂断再拨');
        return;
      }
      // 手动拨出（加号面板「语音通话」/通话卡片回拨）：有来电正在响铃（电话来电弹窗）同样不叠加
      if (direction === 'out' && useIncomingCall.getState().call) {
        onToast('有来电正在响铃，请先处理');
        return;
      }
      const base = msgs;
      const history: ChatCallTurnMsg[] = base
        .filter((m) => !m.recalled && (m.content.trim().length > 0 || m.kind === 'location' || (m.kind === 'image' && m.img?.desc && !m.content.startsWith('data:'))) && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))
        .slice(-8)
        .map((m) => ({
          role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
          // 语音取转写/本地原文；位置取完整位置文本（名称/地址/经纬度/发送时间）；图片取识图描述，通话里 AI 同样知道聊过的图片内容
          // 100-e 带描述的图片带消息 ID 进上下文（AI 需要抄写 ID 时能抄到真实的）
          // 好友验证消息/打招呼标注（用户规则五：验证消息要区分，不能当聊天内容）
          content:
            (m.fr === 'apply'
              ? '[好友验证消息，不是聊天内容] '
              : m.fr === 'greet'
                ? '[打招呼，不是聊天内容] '
                : '') +
            (m.kind === 'voice'
              ? m.voice?.transcript || m.voice?.localText || '[语音]'
              : m.kind === 'location'
                ? locationAiText(m.loc, m.time)
                : m.kind === 'image' && m.img?.desc && !m.content.startsWith('data:')
                  ? `[图片 ID:${m.id}]（图片内容：${m.img.desc}）`
                  : m.content),
        }));
      const memContext = history.map((h) => h.content).join(' ');
      // 世界书注入通话（与文字聊天同一套 collectWbBlocks：全局常驻 + 局部/专属按触发词命中）：
      // 六个位置块 + 使用规则拼成一个块随人设注入（优先级：人设/世界设定 > 记忆）
      // 100-e 世界书锚点对齐微信通话同款第三参 labels（「文中的『你』指谁」消歧）
      const callWb = collectWbBlocks(peer.id, wbScanText([memContext]), { charName: peer.name, userName: me.realName || me.name });
      const worldbookBlock =
        [
          callWb.beforeSystem,
          callWb.afterSystem,
          callWb.beforeChar,
          callWb.afterChar,
          callWb.beforeUser,
          callWb.afterUser,
          wbRulesBlock(callWb),
        ]
          .filter(Boolean)
          .join('\n\n') || undefined;
      // 每轮动态召回（引擎以「用户刚说的话」逐轮调用）：通话里 AI 能随话题变化召回相关记忆，
      // 主动提起之前聊过的事（文字聊过的事通话里能接上——互通开关决定召回范围）
      // disclosureText 只用用户侧发言（当前轮 + 近期用户消息）：小号披露身份才解锁大号记忆（默认纯陌生人）
      const memoryBlockFn = (userText: string | null) =>
        memChatRecallBlock(peer.id, 'qq', wbScanText([userText, ...history.slice(-4).map((h) => h.content)]), {
          interopOn: effectiveInterop,
          disclosureText: [userText ?? '', ...history.slice(-4).filter((h) => h.role === 'user').map((h) => h.content)].filter(Boolean).join(' '),
          altMainName: cachedOwnerName(),
          altMainRelation: peer.relation?.trim() || '',
        }) || undefined;
      // Task 22 视频通话：记录本次通话媒体（onEnd 落卡片用）——放在守卫之后，只有真正发起才写 ref
      lastCallMediaRef.current = opts?.media ?? 'voice';
      startGlobalCall({
        variant: 'qq',
        name: peer.name,
        avatar: peer.avatar ?? null,
        // Task 27：用户自己的头像——视频通话关摄像头时显示它（不再显示「摄像头已关」占位）
        myAvatar: me.avatar ?? null,
        contact: peer,
        direction,
        // Task 22 视频通话：'video' 时 GlobalCallLayer 渲染视频通话页（带识图小窗），缺省语音通话页
        media: opts?.media ?? 'voice',
        initialHistory: history,
        memoryBlock:
          memChatRecallBlock(peer.id, 'qq', memContext, {
            interopOn: effectiveInterop,
            disclosureText: history.filter((h) => h.role === 'user').map((h) => h.content).join(' '),
            altMainName: cachedOwnerName(),
            altMainRelation: peer.relation?.trim() || '',
          }) || undefined,
        memoryBlockFn,
        worldbookBlock,
        momentsBlock: buildMomentsChatBlock({ contactId: peer.id, app: 'qq', userName: me.name, userRealName: me.realName || me.name, peer }) || undefined,
        timeBlock: getTimeAware(sessionKey)
          ? buildTimeAwareBlock({ lastMsgTime: base.length > 0 ? base[base.length - 1].time : null, regionHint: peer.region || null })
          : '',
        // 位置块与文字聊天同一套 buildLocationBlock：通话里 AI 同样知道“用户在哪”；
        // 【fix3-d-5】补传 peerLabel：对方（AI 角色）发的位置会标为「TA 本人发的自己的位置」，不再被说成「对方=用户的位置」
        locBlock: buildLocationBlock(base, { userLabel: me.realName || me.name, peerLabel: `「${peer.name}」` }) || undefined,
        multiApp: getMemSettings(peer.id).share,
        onEnd: writeCallCard,
        onFollowup: sendCallFollowup,
      }, opts?.hiddenView ? 'hidden' : 'full');
    },
    [msgs, peer, me.name, me.avatar, sessionKey, writeCallCard, sendCallFollowup, onToast],
  );

  // Task 28-b 资料页通话桥：消费宿主下发的 pendingCall（资料页 ActionSheet 选了语音/视频，
  // 宿主已关资料页并路由到本聊天页）——复用 openVoiceCall 全链路（B-1 守卫 / 上下文快照 /
  // 世界书 / 记忆 / 落卡片 / 续聊），与会话页加号面板「语音通话/视频通话」同一拨号函数。
  // ref 按对象身份防重复消费：openVoiceCall 随 msgs 变化会让本 effect 重跑，但不能重拨。
  const consumedPendingCallRef = useRef<{ contactId: string; media: 'voice' | 'video' } | null>(null);
  useEffect(() => {
    if (!pendingCall || pendingCall.contactId !== peer.id) return;
    if (consumedPendingCallRef.current === pendingCall) return;
    consumedPendingCallRef.current = pendingCall;
    // 先清宿主侧下发再拨号（openVoiceCall 内部守卫/toast 照常工作）
    onConsumePendingCall?.();
    openVoiceCall('out', pendingCall.media === 'video' ? { media: 'video' } : undefined);
  }, [pendingCall, peer.id, onConsumePendingCall, openVoiceCall]);

  /** AI 回合：插入用户消息并把整轮流式请求交给全局 store（文本/表情共用；表情以 [发送了表情：意思] 进入对话历史，AI 据此理解表情）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容。
   *  extra：发红包/转账随消息触发回复时，刚入列还没进 state 的消息（要一并进上下文与待处理清单）。
   *  sysEvent：用户退还 AI 的红包/转账/亲属卡后注入的系统事件说明（只进本轮上下文，不落盘），让 AI 人设化地回应退还 */
  /** [语音通话] 标记本轮是否出现过（流中分段/最后一段/接力回复共用同一 ref）：runAiTurn 开回合时重置，
   *  buildReplyMsgs 解析到标记时置位——原来是回合内局部变量，buildReplyMsgs 提升到组件层后改用 ref 传递 */
  const wantCallSeenRef = useRef(false);
  // 一起听遥控（第三十七轮）：本轮是否剥出并执行过播控指令（纯指令回复不再落「暂无回复」兑底）
  const musicActedRef = useRef(false);
  // Task 22 视频通话：[视频通话] 标记本轮是否出现过（与 wantCallSeenRef 同款生命周期：runAiTurn 开回合
  // 重置、buildReplyMsgs 解析到标记置位、maybeTriggerAiCall 消费完即清）
  const wantVideoCallSeenRef = useRef(false);

  /**
   * AI 来电触发（#34 从 finalize 抽出共用：runAiTurn 收尾与 bg 接力投递同款）：
   * [语音通话] 标记出现过时按 5 分钟冷却弹出来电。requestOnly=true（仅申请卡放行模式）不触发——
   * 正文已被拦截，来电若照常弹出会绕过拉黑语义；现场读拉黑状态防回合内变更。
   * #8 前置防御：电话 App 通话全屏层显示中（callActive）不叠加 QQ AI 来电。
   * #2 来电改走可见路径：不传 hiddenView（响铃零 UI 已废弃），直接展开 QQ 全屏来电页，
   * 并列注册全局来电横幅（锁屏等全屏页不在前台时兜底），与微信来电同构。
   * #11 函数末尾（finally）必清 wantCallSeenRef：标记只对本次投递批次有效，消费完即复位。
   * Task 22 视频通话：[视频通话] 标记同款触发（独立冷却键 qq-videocall-last:*），wantVideoCallSeenRef 在 finally 一并清空。
   */
  const maybeTriggerAiCall = useCallback(
    (requestOnly: boolean) => {
      // #11 标记消费完即清（所有路径，含提前 return / 冷却拦截）：buildReplyMsgs 置位的
      // [语音通话] 标记只对「本次投递批次」有效——旧实现残留 true 会让后续不带标记的
      // bg 回复也凭空触发来电。判定/调度完成即复位；带标记的正常触发先完成调度再清，不受影响
      try {
        if (wantCallSeenRef.current && !requestOnly && !loadBlock('qq', peer.id).byUser) {
          // C3：off 档拦截（用户关闭「AI 主动来电」时标记来电不再真的拨出）+ 统一来电守卫互查
          if (isProactiveCallOff()) return;
          if (recentAiCallWithin(peer.id)) return;
          const lastCallAt = Number(window.localStorage.getItem(`qq-vc-last:${peer.id}`) ?? '0');
          if (Number.isFinite(lastCallAt) && Date.now() - lastCallAt > 5 * 60 * 1000) {
            window.localStorage.setItem(`qq-vc-last:${peer.id}`, String(Date.now()));
            markAiCall(peer.id);
            // M5 换号防串号：调度时刻捕获会话纪元，fire 时首先比对——等待窗口内发生换号
            // （purgeQqSessionData 递增纪元）则本次来电整体作废（守卫链之前）
            const epoch = qqSessionEpoch;
            window.setTimeout(() => {
              if (epoch !== qqSessionEpoch) return;
              // 幂等防御：上一通还没处理完时不再叠加新会话（openVoiceCall 会替换已有全局会话，
              // 双触发会产生叠层僵尸来电）——电话通话中/来电弹窗响铃中/已有全局通话进行中就整跳取消（#29/#8）
              if (useUI.getState().callActive) return;
              if (useIncomingCall.getState().call) return;
              if (useGlobalCall.getState().session) return;
              // #2 QQ AI 来电改走可见来电：不再传 hiddenView（旧实现响铃期间 view='hidden' 零 UI，
              // 25s 幽灵铃声必未接），来电直接展开 QQ 全屏来电页（响铃/接听/拒绝/超时未接由通话引擎自理）。
              // 全局来电横幅（IncomingCallLayer 的 'qq' 来源）并列注册：全屏来电页不在前台时
              //（如锁屏）由横幅兜底显示响铃 UI；微信路径同构参照 wechat.tsx triggerAiVoiceCall
              triggerIncomingCall({
                // incoming-call.ts 的快照类型联合未列 'qq'（该文件不在本任务允许修改清单内）：
                // 运行时写入 'qq'，IncomingCallLayer 按字符串宽化识别并渲染 QQ 来电横幅
                source: 'qq' as unknown as IncomingCallSnapshot['source'],
                name: peer.name,
                avatar: peer.avatar ?? null,
                contact: peer,
                bannerStage: 'big',
              });
              openVoiceCall('in');
            }, 1200);
          }
        }
        // Task 22 视频通话：[视频通话] 标记同款触发（与语音块同构）——独立 5 分钟冷却键
        //（qq-videocall-last:*，与语音 qq-vc-last:* 互不挤占），幂等防御/换号纪元挡板照抄语音块；
        // 来电快照与全局会话都带 media='video'：IncomingCallLayer 横幅显示「邀请你视频通话」+视频接听图标，
        // GlobalCallLayer 渲染视频通话页。QQ 不用 hiddenView（与语音来电同款可见路径）
        if (wantVideoCallSeenRef.current && !requestOnly && !loadBlock('qq', peer.id).byUser) {
          // C3：off 档拦截 + 统一来电守卫互查（同语音块口径）
          if (isProactiveCallOff()) return;
          if (recentAiCallWithin(peer.id)) return;
          const lastVideoCallAt = Number(window.localStorage.getItem(`qq-videocall-last:${peer.id}`) ?? '0');
          if (Number.isFinite(lastVideoCallAt) && Date.now() - lastVideoCallAt > 5 * 60 * 1000) {
            window.localStorage.setItem(`qq-videocall-last:${peer.id}`, String(Date.now()));
            markAiCall(peer.id);
            // M5 换号防串号：调度时刻捕获会话纪元，fire 时首先比对（与语音块同款）
            const epoch = qqSessionEpoch;
            window.setTimeout(() => {
              if (epoch !== qqSessionEpoch) return;
              // 幂等防御（与语音块同款）：电话通话中/来电响铃中/已有全局通话进行中就整跳取消
              if (useUI.getState().callActive) return;
              if (useIncomingCall.getState().call) return;
              if (useGlobalCall.getState().session) return;
              triggerIncomingCall({
                // 同语音块：'qq' 不在 incoming-call.ts 快照类型联合内，运行时写入由 IncomingCallLayer 宽化识别
                source: 'qq' as unknown as IncomingCallSnapshot['source'],
                name: peer.name,
                avatar: peer.avatar ?? null,
                contact: peer,
                bannerStage: 'big',
                media: 'video',
              });
              openVoiceCall('in', { media: 'video' });
            }, 1200);
          }
        }
      } catch {
        // localStorage 异常忽略
      } finally {
        wantCallSeenRef.current = false;
        wantVideoCallSeenRef.current = false;
      }
    },
    [peer, openVoiceCall],
  );

  /** 单条 AI 消息投递：落盘 + 灵动岛通知 + 语音频率判定/合成 + 未读角标（ai-delivery 调度器模块层调用，与页面是否存活无关）。
   *  runAiTurn 的投递批次与退出网页接力的后台回复（bg-turn 拉取）共用同一套管线 */
  const deliverAiMsg = useCallback(
    (raw: QQMsg) => {
      // 显示设置 › 已读回执：AI 消息本身未读（我回话时转已读）；
      // AI 回复落地 = TA 读了我说的话——我的全部未读消息转已读（磁盘为权威，UI 由投递订阅同步）
      const m: QQMsg = { ...raw, unread: true };
      const base = loadMsgs(peer.id);
      const cleared = base.some((x) => x.role === 'me' && x.unread)
        ? base.map((x) => (x.role === 'me' && x.unread ? { ...x, unread: false } : x))
        : base;
      // #35：有插入边界时（用户在上一轮投递中插话）插到边界用户消息之前，落库顺序即对话时序
      saveMsgs(peer.id, appendWithBoundary(sessionKey, cleared, m));
      // 语音频率：每条文字消息独立判定（命中 → 通知直接显示[语音]；未命中 → 常规文字预览）。
      // #20 错误占位（「〔消息发送失败：…〕」等）不算 AI 发言：不参与语音频率判定、更不被合成语音
      const voiceTurn =
        (m.kind === undefined || m.kind === 'text') &&
        m.content.trim().length > 0 &&
        // B6：TTS 清洗后为空的内容（纯 *动作描写* 行等）跳过判定（不白吃语音名额）
        cleanTextForTts(m.content).trim().length > 0 &&
        !m.error &&
        !m.content.startsWith('〔') &&
        decideAiVoiceMessage(sessionKey);
      const body = voiceTurn
        ? '[语音]'
        : notifyPreviewText({
            kind: m.kind,
            content: m.content,
            voiceText: m.voice?.transcript || m.voice?.localText || null,
            amount: m.packet?.amount ?? null,
            blessing: m.packet?.type === 'redpacket' ? m.packet.note : null,
            note: m.packet?.type === 'transfer' ? m.packet.note : null,
          });
      if (body !== null) {
        pushChatNotification({
          sessionKey: `qq:${peer.id}`,
          app: 'qq',
          title: peer.name,
          avatar: peer.avatar ?? null,
          body,
          target: { app: 'qq', contactId: peer.id },
        });
      }
      if (voiceTurn && !m.error && !m.content.startsWith('〔')) {
        // 异步合成，失败保持文字自动降级，不影响聊天（#20 同口径双保险：错误占位/系统提示行永不合成）
        const targetId = m.id;
        void synthesizeAiVoice(m.content, peer.id)
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
              contactId: peer.id,
            };
            const upgrade = (list: QQMsg[]): QQMsg[] =>
              list.map((x) => (x.id === targetId ? { ...x, content: '', kind: 'voice' as const, voice } : x));
            setMsgs(upgrade);
            saveMsgs(peer.id, upgrade(loadMsgs(peer.id)));
          })
          .catch(() => {});
      }
      // 用户已退出该聊天才计数（在聊天页内实时可见，不重复计）：AI 发了几条消息角标就是几
      if (qqActiveChatId !== peer.id) qqUnreads.bump(peer.id, 1);
    },
    [peer, sessionKey],
  );

  /**
   * 手动触发「文字图片」（加号面板「文字图片」入口；Task 14 起方向反转）：文字图片是「我」发给
   * TA 的卡片——输入留空时让 AI 按人设+最近聊天记录代笔（/api/textcard，用户上游优先、
   * 服务端内置模型兑底）；输入非空 = 用户自己写。
   * 成功 → 弹层关闭 + role='me' 的卡片消息上屏（msgs 持久化 effect 落盘）并触发 AI 回合
   * （卡片文字以「[文字图片]（卡片上写着：…）」进上下文，TA 能读到并回应）；
   * 失败 → 错误留在弹层内（不关弹窗，用户可重试或取消），不影响聊天。
   */
  const submitTextCard = useCallback(
    async (text: string) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后不能发送任何消息
      if (loadBlock('qq', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        setLayer(null);
        return;
      }
      setCardBusy(true);
      setCardError('');
      try {
        let finalText = text;
        if (!finalText) {
          // 留空 → AI 代笔（人设取联系人 persona；历史取最近聊天记录）
          finalText = await autoCardText({
            config: apiConfig,
            charName: peer.name,
            channel: 'QQ',
            persona: peer.persona ?? '',
            history: buildPhotoDescHistory(msgs, '我', peer.name),
          });
        }
        const cardMsg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'textcard' as const, card: { text: finalText } };
        setLayer(null);
        // 给自己发消息：只记录，不触发 AI 回复
        if (peer.id === me.id) {
          setMsgs((prev) => [...prev, cardMsg]);
        } else if (sentenceSend) {
          // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发
          setMsgs((prev) => [...prev, cardMsg]);
          setPendingDispatch(true);
          markPendingBatch(sessionKey, true);
        } else if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          // 对方正在回复（流式/连发投递中）：卡片照常上屏并排队补跑（与 send 文字路同口径）
          setMsgs((prev) => [...prev, cardMsg]);
          markDeliverBoundary(sessionKey, cardMsg.id);
          qqQueueAdd(peer.id);
        } else {
          // 与图片路同口径：先 setMsgs 入列上屏（持久化 effect 自动落盘），稍等重渲染后触发回复
          //（卡片作 extra 消息进本轮上下文；runAiTurn 的 base 按 id 去重，入列后再传不会重复）
          setMsgs((prev) => [...prev, cardMsg]);
          window.setTimeout(() => runAiTurnRef.current?.(null, [cardMsg]), 80);
        }
        onToast('文字图片已发送');
      } catch (e) {
        setCardError(e instanceof Error ? e.message : '生成失败，请重试');
      } finally {
        setCardBusy(false);
      }
    },
    [apiConfig, me.id, msgs, onToast, peer.id, peer.name, peer.persona, sentenceSend, sessionKey],
  );

  /**
   * 点击「文字图片」卡片 → 用图像生成把卡片文字生成图片（设置 › 图像生成 配置）：
   * 卡片是「我」发的，生图不带角色锁脸（contactId 空，画面描述可在操作面板里改）；
   * 成功 → 卡片消息**原位**变成图片消息（文字图片消失，生成的图显示在原来卡片的位置），
   * 不新增消息、不触发 AI 回合（不是发图给 AI），持久化 effect 自动落盘；
   * 失败 → 只 toast，面板留在原地可重试。
   */
  const generateCardImage = async (m: QQMsg, descInput: string) => {
    // G1：描述 trim 后截 400（与 imggen 照片标签正则上限同口径，超长部分静默丢弃）
    const desc = descInput.trim().slice(0, 400);
    if (!desc || cardGenBusy) return;
    const cfg = useSettings.getState().imgGenConfig;
    if (!cfg.enabled || !imgGenConfigReady(cfg)) {
      onToast('请先在 设置 › 图像生成 完成配置');
      return;
    }
    setCardGenBusy(true);
    try {
      // 按卡片作者分叉（与长按「重新生成」submitImgRegen 同口径）：AI 的卡片（发图降级卡片）转图带角色
      // 锁脸（首次生成与重新生成都锁，前后一致）；我自己写的卡片转图不带锁脸（contactId 空 = 纯描述图）
      const r =
        m.role === 'peer'
          ? await generateCharacterPhoto({ cfg, contactId: peer.id, desc, charName: peer.name, useRef: true })
          : await generateCharacterPhoto({ cfg, contactId: '', desc, charName: '文字图片', useRef: false });
      // 原位替换：卡片 → 图片（QQ 图片 dataURL 存 content，img.src 同步填上与微信端一致；fromCard 标记让长按菜单出现「重新生成」）
      setMsgs((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, kind: 'image' as const, content: r.src, card: undefined, img: { src: r.src, desc, fromCard: true } } : x)),
      );
      // B1 挂点补齐：AI 的卡片（role=peer）转图成功 → 与 flushPhotoJobs 自动生图完全同口径
      //（相册 origin 'ai' / 决策日志 imggen / 照片记忆 / 相册缓存刷新——下一轮 AI 可 [选图发送] 把这张照片再发出来）；
      // 我的卡片（role=me）转图无角色身份，不加挂点
      if (m.role === 'peer') {
        void addAlbum(peer.id, r.src, { desc, origin: 'ai' });
        void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'imggen', targetId: '', imgSrc: r.src, reason: desc });
        notePhotoMemory(peer.id, 'qq', desc);
        void listAlbumsForChat(peer.id, me.id).then((list) => {
          albumCacheRef.current = list;
        });
      }
      setCardActionId(null);
      onToast('图片已生成');
    } catch (e) {
      onToast(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      setCardGenBusy(false);
    }
  };

  // ---- 生图（锁脸）：buildReplyMsgs 从回复文本剥出的 [照片:描述] 标签攒进队列，flush 统一异步生成 ----
  /** 本轮待生成的照片任务（buildReplyMsgs 同步解析时入队；flushPhotoJobs 消费并清空） */
  const photoJobsRef = useRef<PhotoTag[]>([]);
  /** F1 流式分段 carry-over：上一段尾部未闭合的半截照片标签（如「[图片:黄昏的咖」），拼回下一段开头再走管线；
   *  回合开始清空、收尾取走（能闭合则正常识别生图，仍闭合不上则兜底剥除不投递） */
  const photoCarryRef = useRef('');
  // 一起听遥控（第三十七轮）：流式分段尾部未闭合的半截播控指令（如「[快进:」），下一段拼回（照片标签 carry 同款机制）
  const musicHoldRef = useRef('');
  // Task 30 AI 引用（v56 恢复）：[引用:M编号] 编号暂存（挂到紧随其后的第一条正文消息上；跨流式分段/切分边界接力）
  // + 编号→源消息映射（runAiTurn 开回合时构建 / 后台接力投递时按落盘记录重算）
  const quotePendingRef = useRef<string | null>(null);
  const quoteMapRef = useRef<Map<string, QQMsg> | null>(null);
  // v56 引用冷却：上次成功挂载引用卡的时刻（挂载即刷新——同轮后续标记全被冷却拦下，跨轮 5 分钟内不重复）
  const quoteLastAtRef = useRef(0);

  /**
   * 消费照片任务（微信端同款管线移植）：配置完整时每条先生「正在拍照…」系统行，异步生成成功后落照片消息 +
   * 存相册（origin 'ai'）+ 决策日志 + 记忆（30 分钟节流不刷屏）+ 刷新相册缓存；
   * 未配置/生成失败自动降级为「文字图片」卡片（不影响聊天）。单轮最多 2 张防刷屏。
   * enqueue = 本轮的投递入口（回合内传 runAiTurn 的 enqueueBatch——首批立即上屏/后续按打字节奏；
   * 接力回复传 bgEnqueueBatch——首条立即上屏），照片消息用全新 uid 不占 aiId 序列。
   */
  const flushPhotoJobs = useCallback(
    (enqueue: (built: QQMsg[]) => void) => {
      const jobs = photoJobsRef.current;
      photoJobsRef.current = [];
      if (jobs.length === 0) return;
      // F3 持久化：任务已被本轮消费，快照删除（挂载/切会话恢复 effect 只在快照仍存在时补做，不重复生成）
      kvDel(`qq-photo-jobs:${sessionKey}`);
      // D：模型异常连发 >2 个标签时第 3 个起丢弃（单轮最多 2 张防刷屏）——补一行系统提示不让多余任务
      // 静默消失（对齐微信/信息端口径；未配置/配置完整两路共用，只提示一次）
      if (jobs.length > 2) {
        enqueue([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `还有 ${jobs.length - 2} 张图片没有生成出来` } }]);
      }
      const cfg = useSettings.getState().imgGenConfig;
      if (!cfg.enabled || !imgGenConfigReady(cfg)) {
        // 未配置生图：降级为「文字图片」卡片（无「正在拍照…」行，卡片即最终形态）
        for (const job of jobs.slice(0, 2)) {
          enqueue([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } }]);
        }
        return;
      }
      for (const job of jobs.slice(0, 2)) {
        enqueue([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `「${peer.name}」正在拍照…` } }]);
        void (async () => {
          try {
            const r = await generateCharacterPhoto({ cfg, contactId: peer.id, desc: job.desc, charName: peer.name, useRef: job.useRef });
            void addAlbum(peer.id, r.src, { desc: job.desc, origin: 'ai' });
            void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'imggen', targetId: '', imgSrc: r.src, reason: job.desc });
            notePhotoMemory(peer.id, 'qq', job.desc);
            // QQ 端图片 dataURL 存 content（QqImageBubble 读 m.content），img.src 同步填上与微信端一致
            enqueue([{ id: uid(), role: 'peer', content: r.src, time: Date.now(), kind: 'image', img: { src: r.src, desc: job.desc } }]);
            // 相册缓存刷新：下一轮 AI 可用 [选图发送] 把这张照片再发出来
            void listAlbumsForChat(peer.id, me.id).then((list) => {
              albumCacheRef.current = list;
            });
          } catch {
            // 生成失败：降级为文字图片卡片（先落一行系统提示说明状态，不阻塞聊天）
            enqueue([
              { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: '照片生成失败，已改为文字图片' } },
              { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } },
            ]);
          }
        })();
      }
    },
    [peer.id, peer.name, sessionKey],
  );

  /**
   * 把一段回复文本解析成待投递消息（runAiTurn 流中分段/finalize 与退出网页接力的后台回复共用同一套管线，不重不漏）：
   * 动作标记就地应用（状态流转 + 通知行/凭据卡随正文顺序产出）；asSingle=true（单条模式）
   * 时文字块再按「&&&」标记切分，false（多条模式）时一段就是一条消息 —— 分段器已按边界切好，
   * 不再二次切分（N 条上限的最后一段可能含溢出合并的句子，切开会破上限）。
   * idBase/idStart：本轮 AI 消息 id 序列（首条 = idBase，后续 = idBase-N；返回 nextIdx 供调用方续接，
   * 接力回复每次投递用全新 uid() 起一段新序列，与回合内序列互不冲突）
   */
  /** 40-a：把「用户发起的解除拉黑申请卡」置为终态（存储 + 本地 state 同步；无 pending 卡时空操作）。
   *  buildReplyMsgs 内部使用（角色决策/角色主动解除拉黑时调用）——声明须在其之前（useCallback deps） */
  const settleUserBlockReq = useCallback(
    (status: 'accepted' | 'rejected') => {
      const saved = loadMsgs(peer.id).map((x) =>
        x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
      );
      saveMsgs(peer.id, saved);
      setMsgs((prev) =>
        prev.map((x) =>
          x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
        ),
      );
    },
    [peer.id],
  );

  const buildReplyMsgs = useCallback(
    (rawText: string, asSingle: boolean, baseTime: number, idBase: string, idStart: number): { msgs: QQMsg[]; cur: QQMsg[]; dirty: boolean; nextIdx: number } => {
      // 聊天端音乐遥控（第三十八轮）：剥出回复里的播控指令（[切歌]/[暂停]/[放歌:歌:歌手]…）并真实执行；
      // 私聊全部生效（system 已注入音乐实时情境块，AI 才有指令能力），指令不出现在任何气泡里
      const mrRemote = takeMusicRemote(rawText);
      if (mrRemote.controls.length > 0) {
        void runMusicRemote(mrRemote.controls);
        musicActedRef.current = true; // 本轮执行过播控：正文被剔空时 finalize 不落「暂无回复」兑底
      }
      rawText = mrRemote.text;
      // 深度思考兜底剥离（bg 关页接力等绕过流总线的路径拿到整段原文时，[思考]块就地剥掉防泄漏进气泡；
      // 流式路径正文早已在 chat-stream-store 剥过，这里天然为 no-op）：思考内容累积到本轮上下文，投递完回填
      const tkParts = extractThinkBlocks(rawText);
      if (tkParts.thinking) {
        turnThinkRef.current.text = turnThinkRef.current.text ? `${turnThinkRef.current.text}\n${tkParts.thinking}` : tkParts.thinking;
      }
      rawText = tkParts.text;
      // 触发标记全/半角括号变体都认（[语音通话]【语音通话】〔语音通话〕（语音通话）(语音通话)）：
      // 只认半角会导致模型输出全角变体时不来电、且标记原文漏进气泡；剥除用同一套兼容正则
      const wantCall = hasVoiceCallMark(rawText);
      if (wantCall) wantCallSeenRef.current = true;
      // Task 22 视频通话：[视频通话] 标记检测（全/半角括号变体都认），与语音通话标记同口径
      const wantVideoCall = hasVideoCallMark(rawText);
      if (wantVideoCall) wantVideoCallSeenRef.current = true;
      // 两种标记都可能出现在同一段回复：剥除行两种标记都剥（先视频后语音，顺序无关）
      const text = wantCall || wantVideoCall ? stripVoiceCallMark(stripVideoCallMark(rawText)) : rawText;
      const latest = loadMsgs(peer.id);
      let cur = latest;
      const out: QQMsg[] = [];
      let t = baseTime;
      let msgIdx = idStart;
      // 表情包开关与贴纸清单现场读取（与 runAiTurn 开回合同源；接力回复投递时读到的同样是当前值）
      const stickersOnNow = getStickersOn(sessionKey);
      const stickersNow = loadStickers('qq');
      for (const part of extractRichActionParts(text)) {
        if (part.type === 'action') {
          // 双向拉黑类动作（[拉黑]/[解除拉黑]/[申请解除拉黑:理由]）：改状态 + 生成系统消息/申请卡片，
          // 不走红包/转账处理；幂等——状态没变化（重复拉黑/没被拉黑就申请等）不产出任何消息
          const bk = blockActionKindOf(part.action);
          if (bk) {
            const res = applyCharBlockAction('qq', peer.id, bk, part.action.targetId);
            setBlk(res.entry);
            if (res.changed && bk === 'block') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `你已被「${peer.name}」拉黑` } });
              t += 1;
            } else if (res.changed && bk === 'unblock') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」解除了对你的拉黑` } });
              t += 1;
              // 40-a：角色主动解除拉黑 = 视同同意用户侧待处理申请（有的话置终态，避免卡片永远「等待对方处理」）
              settleUserBlockReq('accepted');
            } else if (res.reqCreated && bk === 'request') {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'blockreq', blkreq: { reason: res.entry.reqReason ?? '', status: 'pending' } });
              t += 1;
            }
            continue;
          }
          // 40-a：角色对「用户发来的解除拉黑申请」的决策（[同意解除拉黑]/[拒绝解除拉黑]）
          const uk = userReqActionKindOf(part.action);
          if (uk) {
            const res = resolveUserReqByChar('qq', peer.id, uk === 'approve');
            setBlk(res.entry);
            if (res.changed) {
              settleUserBlockReq(uk === 'approve' ? 'accepted' : 'rejected');
              out.push({
                id: uid(),
                role: 'peer',
                content: '',
                time: t,
                kind: 'sys',
                sys: { text: uk === 'approve' ? `「${peer.name}」同意了你的解除拉黑申请` : `「${peer.name}」拒绝了你的解除拉黑申请` },
              });
              t += 1;
            }
            continue;
          }
          // 40-a 拉黑破口修复（与微信单聊同构）：仅申请卡模式（用户拉黑角色，requestOnly）下，
          // 除上面放行的拉黑类标记（blockActionKindOf/userReqActionKindOf）外的所有动作标记
          //（资金/建群/邀请/退群挽留/视觉等）一律丢弃不执行——该模式下正文已被下方 continue 拦截，
          // 动作若照常执行会绕过拉黑语义（被拉黑还能动钱/建群）。现场读拉黑状态防回合内变更
          if (loadBlock('qq', peer.id).byUser) continue;
          // 退群挽留动作（[拉回群聊]/[设为管理员]/[转让群主]/[放弃邀请]）优先分流给 quit-flow 执行
          //（权限/配额在 quit-flow 内硬校验；返回 false 说明没有活跃流程，继续走卡片动作）
          if (isQuitWinbackAction(part.action)) {
            applyQuitWinbackAction(peer.id, part.action);
            continue;
          }
          // 群社交动作（[建群:群名:成员] 等）：建群 → 卡片消息随本回复落盘（权限/冷却/拒绝表在执行器硬校验）
          if (isGroupSocialAction(part.action)) {
            const card = applyGroupSocialAction(peer, 'qq', part.action.kind, part.action.targetId, part.action.arg);
            if (card) {
              out.push({ id: msgIdx === 0 ? idBase : `${idBase}-${msgIdx}`, role: 'peer', content: '', time: t, kind: 'groupcard', gcard: card });
              msgIdx += 1;
              t += 600 + Math.floor(Math.random() * 600);
            }
            continue;
          }
          // Task 30 AI 引用（[引用:M编号]，v56 恢复）：编号暂存 ref，挂到紧随其后的第一条正文消息上
          //（见下方文字分支；标记与正文跨流式分段/切分边界时靠 ref 跨段接力）。
          // v56 冷却闸：距上次成功挂载不足 AI_QUOTE_COOL_MS（挂载即刷新——同轮第二条引用也会被拦）→ 静默丢弃
          if (part.action.kind === 'quote') {
            if (Date.now() - quoteLastAtRef.current >= AI_QUOTE_COOL_MS) {
              quotePendingRef.current = part.action.targetId.trim();
            }
            continue;
          }
          // Task 30 AI 拍一拍（[拍一拍:文案]/[拍一拍]）：系统提示行「「角色」拍了拍你+文案」——
          // 文案由 AI 按人设/记忆/上下文自己决定；拍一拍不是消息，前后正文照常投递
          if (part.action.kind === 'pat') {
            const patText = part.action.targetId.trim().slice(0, 30);
            out.push({
              id: uid(),
              role: 'peer',
              content: '',
              time: t,
              kind: 'sys',
              sys: { text: `「${peer.name}」拍了拍你${patText}`, pat: { by: 'peer', ...(patText ? { text: patText } : {}) } },
            });
            t += 1;
            continue;
          }
          // v1.3 Shizuku 自主权（[手机操作:命令:参数]）：AI 真实操控手机（点按/滑动/打开App/强杀/媒体/截屏…）。
          // 执行异步（Shizuku 通道 1~3s）：占位系统行同步入列，结果行完成后落盘回传 AI（下一轮 AI 天然看到：
          // 成功才说成功、失败如实报）。开关 gate 在 executePhoneOp 内（系统设置 → AI 动手，关了直接拒）；
          // 拉黑（仅申请卡模式）下与资金/视觉标记同口径拦截——拉黑期间 AI 不许动手机。
          if (part.action.kind === 'phone-op') {
            const argText = part.action.targetId.trim();
            if (argText && !loadBlock('qq', peer.id).byUser) {
              musicActedRef.current = true; // 纯动作回复（无正文）不落空回复失败徽标（与播控同口径）
              const cmdName = argText.split(/[:：]/)[0] ?? '';
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」正在操作手机（${cmdName}）…` } });
              t += 1;
              void (async () => {
                // 串行队列：多步指令（打开→播放→切歌）按书写顺序逐个执行，轮到本条才亮技能胶囊
                // v1.5 Agent 逐步播报：纯展示 sys 行（sys 不带 op → 历史组装的基础过滤只放行 sys.pat/sys.op，
                // 本行直接被剔除不回喂 AI；最终结果仍走下方 op:true 结果行回喂）
                const res = await enqueuePhoneOp(argText, () => opPill.start(peer.name, cmdName), (text) => {
                  const pm = { id: uid(), role: 'peer' as const, content: '', time: Date.now(), kind: 'sys' as const, sys: { text } } as unknown as QQMsg;
                  saveMsgs(peer.id, appendWithBoundary(sessionKey, loadMsgs(peer.id), pm));
                  setMsgs((prev) => (prev.some((m) => m.id === pm.id) ? prev : [...prev, pm]));
                });
                opPill.finish(res.ok, res.text);
                const sysMsg = { id: uid(), role: 'peer' as const, content: '', time: Date.now(), kind: 'sys' as const, sys: { text: `手机操作${res.ok ? '成功' : '失败'}：${res.text}`, op: true } } as unknown as QQMsg;
                saveMsgs(peer.id, appendWithBoundary(sessionKey, loadMsgs(peer.id), sysMsg));
                setMsgs((prev) => (prev.some((m) => m.id === sysMsg.id) ? prev : [...prev, sysMsg]));
              })();
            }
            continue;
          }
          // 第二十九轮「AI 主动换头像」：[生成新头像:外观描述] → 系统按人设锁脸生成新照片 →
          // 设为 AI 的 QQ 头像 + 头像描述落库 + 决策日志；未配置生图时静默丢弃（教学规则只在配置完整时下发）
          if (part.action.kind === 'gen-avatar') {
            const genDesc = part.action.targetId.trim().slice(0, 60);
            const genCfg = useSettings.getState().imgGenConfig;
            if (genDesc && genCfg.enabled && imgGenConfigReady(genCfg)) {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」换了一个新头像` } });
              t += 1;
              void (async () => {
                try {
                  const r = await generateCharacterPhoto({ cfg: genCfg, contactId: peer.id, desc: genDesc, charName: peer.name, useRef: true });
                  await updateContact(peer.id, { avatars: { qq: r.src } });
                  void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'gen-avatar', targetId: '', imgSrc: r.src, reason: genDesc });
                  noteAvatarChanged(peer.id, 'qq', r.src, 'peer', genDesc);
                  refreshContacts();
                } catch {
                  /* 生图/写入失败不阻塞主流程 */
                }
              })();
            }
            continue;
          }
          // 46-f：视觉自主决策动作——[换头像:图片消息ID] / [换朋友圈背景:图片消息ID] / [存相册:图片消息ID]
          // targetId 按 id 在 cur 里找对应图片消息（AI 必须从最近用户发来的图片消息里原样抄 ID）；
          // 空 targetId 兜底取当回合最后一条图片消息（连续多图时取最新的一张）。QQ 端图片 dataURL
          // 存在 content 字段（QqImageBubble 读 m.content），与微信端 img.src 不同——这里取 content。
          if (part.action.kind === 'change-avatar' || part.action.kind === 'change-moments-bg' || part.action.kind === 'save-to-album') {
            const targetId = part.action.targetId;
            let imgMsg: QQMsg | null = null;
            if (targetId) {
              imgMsg = cur.find((m) => m.id === targetId && m.kind === 'image') ?? null;
              // 「第N张」容错（用户口径）：AI 把「第2张/2」原样写进标记（[换头像:第2张]）时按编号映射——
              // 第N张 = 会话内我发的第 N 张图片（与历史序列化「我发的第N张图」同口径），
              // 避免整标失效掉到兜底逻辑换错图（用户实测：第一次没换对的那张）
              if (!imgMsg) {
                const mSeq = /^(?:第)?(\d{1,3})\s*(?:张|张图|图片|张照片)?$/.exec(targetId.trim());
                if (mSeq) {
                  const n = Math.max(1, parseInt(mSeq[1], 10));
                  let k = 0;
                  for (const m of cur) {
                    if (!m.recalled && m.role === 'me' && m.kind === 'image' && typeof m.content === 'string' && m.content.startsWith('data:image/')) {
                      if (++k === n) {
                        imgMsg = m;
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (!imgMsg) {
              for (let i = cur.length - 1; i >= 0; i--) {
                if (cur[i].kind === 'image' && cur[i].role === 'me') {
                  imgMsg = cur[i];
                  break;
                }
              }
            }
            if (!imgMsg || !imgMsg.content || !imgMsg.content.startsWith('data:image/')) continue;
            const src = imgMsg.content;
            if (part.action.kind === 'change-avatar') {
              // 47-c #108：调 updateContact 后刷新 contacts state，让聊天页 peer.avatar 反应式同步（顶栏头像即时刷新）
              // 头像按 App 隔离：只写 QQ 槽位（updateContact 对 avatars 做合并写入），不影响微信/信息/电话与联系人 App 的头像
              void updateContact(peer.id, { avatars: { qq: src } })
                .then(() => refreshContacts())
                .catch(() => {});
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」换了头像` } });
              t += 1;
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'change-avatar', targetId: imgMsg.id, imgSrc: src });
              // 第二十九轮：头像描述落库——AI 之后知道自己现在的头像长什么样
              noteAvatarChanged(peer.id, 'qq', src, 'peer', imgMsg.img?.desc);
            } else if (part.action.kind === 'change-moments-bg') {
              void setPeerBg('qq', peer.id, src).catch(() => {});
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」更换了背景封面` } });
              t += 1;
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'change-moments-bg', targetId: imgMsg.id, imgSrc: src });
            } else {
              // save-to-album（第三十一轮双写）：AI 说「存到相册」必须真的在用户的「我的相册」页能看到——
              // 写两份：peer 相册（TA 自己的收藏，供 TA 之后 [选图设头像/发送]）+ 机主相册（用户打开
              // 「我的相册」直接看到，标 origin 'ai' + 备注来源）；决策日志 + 两条记录都 push 进合并缓存
              void (async () => {
                try {
                  const rec = await addAlbum(peer.id, src, { origin: 'ai', desc: imgMsg.img?.desc });
                  const ownerRec = me.id && me.id !== peer.id
                    ? await addAlbum(me.id, src, { origin: 'ai', desc: imgMsg.img?.desc, name: `${peer.name}存的` })
                    : null;
                  albumCacheRef.current = [...albumCacheRef.current, rec, ...(ownerRec ? [ownerRec] : [])];
                } catch {
                  /* 写入失败不阻塞主流程 */
                }
              })();
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」存了一张图到相册` } });
              t += 1;
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'save-to-album', targetId: imgMsg.id, imgSrc: src });
            }
            continue;
          }
          // 46-f：从相册选图——[选图设头像:相册条目ID] / [选图设背景:相册条目ID] / [选图发送:相册条目ID]
          // targetId 应原样抄自【相册清单】；用 albumCacheRef.current 同步查（runAiTurn 开回合时刷新）。
          // 第三十一轮：①归属校验放宽到「peer 或机主」的相册（合并缓存两边的都能选，用户说「去相册
          // 找一张」时 AI 自己相册可能为空）；②ID 未命中/漏抄时不再静默丢弃——从缓存里兜底取
          // 最新一张（优先 peer 相册、其次机主相册），修复「AI 说换了头像实际没换」
          if (part.action.kind === 'pick-album-avatar' || part.action.kind === 'pick-album-bg' || part.action.kind === 'pick-album-send') {
            const albumTargetId = part.action.targetId;
            let album =
              albumCacheRef.current.find((a) => a.id === albumTargetId && (a.contactId === peer.id || a.contactId === me.id)) ?? null;
            if (!album) {
              const minePool = albumCacheRef.current.filter((a) => a.contactId === peer.id);
              const ownerPool = albumCacheRef.current.filter((a) => a.contactId === me.id);
              album = minePool[minePool.length - 1] ?? ownerPool[ownerPool.length - 1] ?? null;
            }
            if (!album) continue; // 两边相册都为空：真无图可选，静默丢弃
            const src = album.src;
            if (part.action.kind === 'pick-album-avatar') {
              // 47-c #108：从相册选图换头像后同样刷新 contacts state（顶栏头像即时同步）
              // 头像按 App 隔离：只写 QQ 槽位（合并写入，不影响其他 App 的头像）
              void updateContact(peer.id, { avatars: { qq: src } })
                .then(() => refreshContacts())
                .catch(() => {});
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」从相册选了张图换头像` } });
              t += 1;
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'pick-album-avatar', targetId: album.id, imgSrc: src });
              // 第二十九轮：头像描述落库（相册图自带 desc 则直接用，无描述异步识图补）
              noteAvatarChanged(peer.id, 'qq', src, 'peer', album.desc);
            } else if (part.action.kind === 'pick-album-bg') {
              void setPeerBg('qq', peer.id, src).catch(() => {});
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」从相册选了张图换背景` } });
              t += 1;
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'pick-album-bg', targetId: album.id, imgSrc: src });
            } else {
              // 选图发送：QQ 端图片 dataURL 存 content（QqImageBubble 读 m.content），同时 img.src 也填上以保持与微信端一致
              out.push({ id: uid(), role: 'peer', content: src, time: t, kind: 'image', img: { src, desc: album.desc } });
              t += 600 + Math.floor(Math.random() * 600);
              void addVisionDecision({ contactId: peer.id, app: 'qq', action: 'pick-album-send', targetId: album.id, imgSrc: src });
            }
            continue;
          }
          // 美团外卖/代付联动动作（[代付:pid]/[帮付:订单id]/[帮点外卖:...]/[自己点外卖:...]/[请客点外卖:...]）：
          // A1 与微信同构：同步执行（代付立即生效/草稿生成），产出的卡片随本回复队列投递；
          // 异步流（请客/自己点）fire-and-forget，卡片/系统行经事件实时合并；角色记忆由执行器直写
          if (isMtEngageActionKind(part.action.kind)) {
            const mtRes = applyMtEngageAction(part.action, peer, {
              app: 'qq',
              recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
            });
            for (const cm of mtRes.msgs) {
              out.push(cm as QQMsg);
              t += 600 + Math.floor(Math.random() * 400);
            }
            if (mtRes.sys) {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: mtRes.sys } });
              t += 1;
            }
            continue;
          }
          // 淘宝购物/代付/取件联动动作（[帮付淘宝]/[帮你买]/[自己买]/[帮取快递]）：与微信端同构
          if (isTbEngageActionKind(part.action.kind)) {
            const tbRes = applyTbEngageAction(part.action, peer, {
              app: 'qq',
              recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
            });
            for (const cm of tbRes.msgs) {
              out.push(cm as QQMsg);
              t += 600 + Math.floor(Math.random() * 400);
            }
            if (tbRes.sys) {
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: tbRes.sys } });
              t += 1;
            }
            continue;
          }
          // AI 发说说动作（[发说说:正文]/[发动态:正文]，用户实测「AI 说发了但没发」根除）：
          // addCharMomentPost 真实落库到 QQ空间（写角色记忆「你发了一条动态」）+ emitMomentsChanged
          // 广播空间页实时刷新；sys 通知行随回复队列投递；空正文丢弃
          if (part.action.kind === 'post-moment') {
            const momentText = part.action.targetId.trim().slice(0, 500);
            if (momentText) {
              try {
                const posted = addCharMomentPost('qq', { peer, userName: me.name, content: momentText });
                emitMomentsChanged('qq');
                // C4：聊天路径发说说补齐自动发布同款后续——①好友/NPC 互动队列（此前聊天发的
                // 说说永远没有点赞评论）；②登记自动发帖尝试标记（10 分钟内调度器不再自动发）
                try {
                  enqueuePostInteractions('qq', posted.id);
                  markMomentAutoAttempt('qq', peer.id);
                } catch {
                  /* 互动队列失败不影响发帖本身 */
                }
              } catch {
                // 落盘失败静默：AI 正文照常上屏，不阻塞聊天
              }
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」发布了一条说说` } });
              t += 1;
            }
            continue;
          }
          const applied = applyAiActions([part.action], cur, peer, t);
          cur = applied.msgs;
          out.push(...applied.notices, ...applied.extras);
          continue;
        }
        // 40-a：仅申请卡模式（用户拉黑了角色）——AI 的正文/表情一律丢弃，只有上面动作分支产出的
        // 申请卡片与系统行能落盘（入口守卫已保证：能走到这里的 byUser 回合必然处于可申请状态）
        if (loadBlock('qq', peer.id).byUser) continue;
        // #42：下方 segs/stripEmojiText 仅正常模式（byUser=false）执行——byUser continue 上面已拦，
        // 不再在三元里再判 byUser；保留 stickersOnNow 三元用于表情开关关闭时剥 emoji
        const segs = mergeRichSegments(splitReplySegments(part.text, !asSingle));
        for (const seg of segs) {
          for (const p of parseRichParts(seg, stickersOnNow ? stickersNow : [])) {
            const id = msgIdx === 0 ? idBase : `${idBase}-${msgIdx}`;
            if (p.type === 'rich') {
              // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/亲属卡/位置卡片不受影响）
              if (!stickersOnNow && p.rich.kind === 'sticker') continue;
              out.push(richToQqMsg(p.rich, id, t, peer));
            } else {
              // 生图（锁脸）：先从文本剥出 [照片:描述] 标签（入队 photoJobsRef，flushPhotoJobs 异步生成投递），
              // 剥不干净的旧标签（生图关闭时）留在原文里可读性更差，统一剥除
              const { text: photoFreeText, tags: photoTags } = extractPhotoTags(p.text);
              if (photoTags.length > 0) {
                photoJobsRef.current.push(...photoTags);
                // F3 持久化：任务快照落 kv——会话中途退出/进程被杀时，挂载 effect 据此补做生成（flush 消费时即删）
                kvSet(`qq-photo-jobs:${sessionKey}`, JSON.stringify(photoJobsRef.current));
              }
              // F1 兕底：尾部未闭合的半截照片标签剥掉不投递（后台接力整段直入本管线时防「[图片:黄昏的咖」
              // 半截上屏；流式路径上游已用 splitUnfinishedPhotoTag 提前切走尾段，此处通常为空操作）
              const safePhotoText = stripTbEchoText(stripMtEchoText(stripUnfinishedPhotoTag(photoFreeText)));
              // 表情包开关关闭：文字里的 emoji 硬性剥除（prompt 禁令之外的双保险），残留的表情占位一并去掉；
              // 首尾清洗：剥掉零宽/盲文空格等「看不见的占位字符」，避免气泡开头出现空隙；
              // 门牌号剥除（Task 30）：模型偶尔裸抄历史行首的 [M数字] 编号进正文，统一剥掉
              const clean = cleanBubbleText(stripMsgHandleText(stickersOnNow ? safePhotoText : stripEmojiCodes('qq', stripEmojiText(safePhotoText.replace(/\[表情包\]|\[表情\]/g, ' ')))));
              if (!clean) continue;
              // 第三十二轮：AI 模仿历史标注输出 [图片 ID:xxx]（想发那张图）→ 拆分处理：
              // 命中会话里的图片消息 → 转成真实图片消息（QQ 图片 dataURL 存 content，img.src 同步填）；
              // 未命中/跨会话 ID → 剥除标记（含「（图片内容：…）」说明），绝不把原始标注漏进气泡
              const refSegs = splitImageIdRefs(clean);
              const refBodies = refSegs.filter((s) => s.kind === 'text').map((s) => (s.text || '').trim()).filter(Boolean);
              const refIds = refSegs.filter((s) => s.kind === 'imgref' && s.id).map((s) => s.id!);
              const body = refBodies.join(' ').replace(/\s{2,}/g, ' ').trim();
              // Task 30 AI 引用（v56 恢复）：此前剥出过 [引用:M编号] → 挂到这第一条正文消息上（QQ 引用卡随气泡展示）；
              // 编号查不到时分两档：①跨回合编号漂移/后台接力无映射（旧容忍）→ 静默丢弃；
              // ②编号越界（与微信同款：模型把 [M(N)] 当「给自己新消息编号」，N=最后一条+1）→
              //   引用意图是真的（正在回应对方刚发来的话），回退引用最近一条用户消息，不让引用凭空消失。
              // 挂载成功即刷新冷却时刻（同轮/近期后续引用标记一律拦下）
              let attachQuote: QQMsg['quote'] | null = null;
              if (quotePendingRef.current) {
                let qSrc = quoteMapRef.current?.get(quotePendingRef.current) ?? null;
                if (!qSrc) {
                  const n = parseInt(quotePendingRef.current.replace(/\D/g, ''), 10);
                  if (Number.isFinite(n) && n > 0 && (!quoteMapRef.current || n > quoteMapRef.current.size)) {
                    // 越界自编号：从 quoteMap（与 AI 所见历史同源）倒序找最近一条用户消息兜底
                    qSrc = [...(quoteMapRef.current?.values() ?? [])].reverse().find((x) => x.role === 'me' && !x.recalled) ?? null;
                  }
                }
                if (qSrc && !qSrc.recalled) {
                  attachQuote = { name: qSrc.role === 'me' ? me.name : peer.name, content: quoteContentOf(qSrc), id: qSrc.id, time: qSrc.time };
                  quoteLastAtRef.current = Date.now();
                }
                quotePendingRef.current = null;
              }
              if (body) {
                out.push({ id, role: 'peer', content: body, time: t, ...(attachQuote ? { quote: attachQuote } : {}) });
              }
              for (const refId of refIds) {
                const refMsg = cur.find((m) => m.id === refId && m.kind === 'image' && !m.recalled) ?? null;
                const rsrc = refMsg ? (typeof refMsg.content === 'string' && refMsg.content.startsWith('data:image/') ? refMsg.content : refMsg.img?.src || '') : '';
                if (!rsrc) continue; // 未命中：引用段已在文本里剥除，静默降级为纯文字
                out.push({ id: uid(), role: 'peer', content: rsrc, time: t, kind: 'image', img: { src: rsrc, desc: refMsg?.img?.desc } });
              }
            }
            msgIdx += 1;
            t += 600 + Math.floor(Math.random() * 600);
          }
        }
      }
      // 深度思考：记录本回合第一条 AI 文本消息 id（只记第一次——流中首个分段的产出即本轮第一条；
      // 卡片/系统行等非文本消息不承载思维链卡片，跳过）
      if (!turnThinkRef.current.firstMsgId) {
        const firstText = out.find((x) => x.role === 'peer' && (!x.kind || x.kind === 'text') && !x.recalled);
        if (firstText) turnThinkRef.current.firstMsgId = firstText.id;
      }
      return { msgs: out, cur, dirty: cur !== latest, nextIdx: msgIdx };
    },
    [peer, sessionKey, settleUserBlockReq, refreshContacts, me],
  );

  const runAiTurn = useCallback(
    async (userMsg: QQMsg | null, extra?: QQMsg[], sysEvent?: string, baseMsgs?: QQMsg[]) => {
    // 40-a 拉黑拦截（第一层）：用户拉黑角色（byUser）后，本 App 内 AI 不能发任何消息——回合静默取消。
    // 唯一例外=「解除拉黑申请卡片」仍可发起（charRequestOnlyOf 放行模式：回合照常请求，但回复中
    // 除申请卡片/系统行外的正文由 buildReplyMsgs 丢弃）；申请同意后的回应回合因 byUser 已清自然放行。
    //（密友值也不计：回合被取消 = 没有互动发生）
    const blkEntry = loadBlock('qq', peer.id);
    if (blkEntry.byUser && !charRequestOnlyOf(blkEntry)) return;
    // 40-b：跨 App/群聊近况刷新（fire-and-forget，供下一轮使用；本轮用预热缓存）
    void buildCrossContextBlocks(peer.id, 'qq', me.realName || me.name)
      .then((b) => {
        crossCtxRef.current = b;
      })
      .catch(() => {});
    // 40-a：本轮是否处于「仅申请卡」放行模式（byUser 命中且守卫放行）——finalize 不落兑底占位
    const requestOnly = blkEntry.byUser === true;
    // 密友值：对照 QQ 规则，我方每发一条消息 +2（每日上限 20）；批次触发（null）同样计一轮互动
    addBondPoints(peer.id, BOND_MSG_POINTS);
    // base 按 id 去重（保留后出现者）：extra/userMsg 里的消息通常已先一步进了 msgs state，
    // 不去重会把同一条消息算两遍——多图识图时重复 id 污染 turnImageMsgIds 映射，描述回写错位（#25）
    // #35 上下文补投递尾巴（群聊 #22 已修，单聊同款）：上一轮的回复还在打字节奏投递队列里（未落盘）时，
    // 只读 msgs state 会漏看——AI 看不到自己刚说的话，把旧话题再答一遍（自言自语/像没读到用户最新消息）。
    // 队列尾巴按序拼进 base（时序上属于上一轮，排在最新用户消息之前）；同一消息要么已落盘/进 state、
    // 要么还在队列里（deliveredIndex 逐条同步推进），不会重复。
    const pendingTail = peekPendingMsgs<QQMsg>(sessionKey);
    const baseRaw = [...(baseMsgs ?? msgs), ...pendingTail, ...(userMsg ? [userMsg] : []), ...(extra ?? [])];
    const baseSeen = new Set<string>();
    const base = baseRaw
      .reverse()
      .filter((m) => (baseSeen.has(m.id) ? false : (baseSeen.add(m.id), true)))
      .reverse()
      // #35 时序兑底：历史数据/合并竞态可能把上一轮未投递完的回复排在用户新消息之后（旧气泡倒挂），
      // 按创建时间稳定排序还原对话时序（正常数据 time 单调，排序为空操作），保证上下文顺序正确
      .sort((a, b) => a.time - b.time);
    // 情侣空间×情书（第五十八轮）：我在聊天里让 TA 写情书/写信 → TA 稍后真的提笔写一封寄到本会话
    //（只对恋人绑定的联系人生效；TA 先在聊天里自然应声，几秒后信封卡片寄到；90 秒冷却防重复）
    {
      const lastMine = [...base].reverse().find((m) => m.role === 'me' && typeof m.content === 'string' && m.content.trim());
      if (lastMine && coupleLetterAskHit(String(lastMine.content))) aiWriteLetterOnRequest(peer.id, 'qq');
    }
    // 上下文：卡片消息（红包/转账/亲属卡）按类型生成可读摘要（含 AI 可引用的 ID 与当前状态），让 AI 知道发过什么、好做处理决策；
    // 图片消息以 [图片] 占位、位置以完整位置文本进入历史（本轮图片的实际内容由识图模型描述追加在末尾）
    // 图片编号（用户要求：发多张图让 AI 换头像时可以说「第几张图片」；与微信同口径）：
    // 我发的图片消息在会话内按时间先后编号（第1张=最早发的），编号随历史序列化进上下文；
    // 在 slice(-20) 之前的完整 base 上计数，撤回的图片不计数（用户感知里它已不存在）。
    const userImgSeq = new Map<string, number>();
    {
      let seq = 0;
      for (const m of base) {
        if (!m.recalled && m.role === 'me' && m.kind === 'image') userImgSeq.set(m.id, ++seq);
      }
    }
    // Task 30 AI 引用编号（v56 恢复）：会话内每条消息的绝对位置编号（M1..Mn；撤回/错误/通知行/申请卡不占号）——
    // 历史行前缀 [M数字] 与 [引用:编号] 反查共用同一映射；绝对位置跨回合稳定（后台接力重算一致）
    const quoteMap = new Map<string, QQMsg>();
    const quoteIdOf = new Map<string, string>();
    {
      let n = 0;
      for (const m of base) {
        if (m.recalled || m.error || m.kind === 'notice' || m.kind === 'blockreq') continue;
        n += 1;
        quoteMap.set(`M${n}`, m);
        quoteIdOf.set(m.id, `M${n}`);
      }
    }
    quoteMapRef.current = quoteMap;
    quotePendingRef.current = null; // 回合开始清引用暂存：跨段残留只可能属于上一回合
    const history = base
      .filter(
        (m) =>
          // 拍一拍系统行（Task 30）也进历史：AI 要知道被拍/拍过谁与文案（按双方名字序列化，无主语歧义）；
          // v1.3 Shizuku：手机操作结果行（sys.op）同样进历史——AI 下一轮知道自己刚才动手的结果
          (!m.recalled && ((m.content || m.kind === 'image' || m.kind === 'textcard' || m.kind === 'voice' || m.kind === 'sticker' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'groupcard' || m.kind === 'relcard' || m.kind === 'pactcard' || m.kind === 'examcard' || m.kind === 'lettercard' || m.kind === 'call' || m.kind === 'location' || m.kind === 'song' || (m.kind === 'sys' && (m.sys?.pat || m.sys?.op))) && !m.content.startsWith('〔') && !m.content.startsWith('（AI')))
      )
      .slice(-20)
      .map((m) => {
        // 引用/转发让 AI 感知来源：引用 → 前缀说明引用的是谁说的什么；转发卡片 → 前缀说明来自哪个会话；
        // 好友验证消息/打招呼前缀标注（用户规则五：验证消息要区分，不能当聊天内容，也不入记忆）
        // 引用块名字防泄漏：展示层存的 quote.name 可能是机主昵称（社交显示名），进 AI 历史一律替换回真名
        const meReal = me.realName || me.name;
        const pre = `${
          m.fr === 'apply'
            ? '[好友验证消息，不是聊天内容] '
            : m.fr === 'greet'
              ? '[打招呼，不是聊天内容] '
              : ''
        }${m.quote ? `（引用 ${m.quote.name === me.name ? meReal : m.quote.name}：「${m.quote.content}」）` : ''}${
          m.kind === 'forward' && m.fwd
            ? m.fwd.merged
              ? // 【fix3-d-3】合并转发卡片：标题后拼逐条摘要（名字=原发言人，最多 8 条、每条截 40 字，
                // 超限补「…等N条」）——此前只带标题，AI 看不到转发了什么内容（旧注释声称「完整注入
                // 逐条对话」与实现不符，一并修正）
                `[合并转发的聊天记录「${m.fwd.title ?? '聊天记录'}」] ${(m.fwd.records ?? [])
                  .slice(-8)
                  .map((r) => `「${r.name}：${(r.text || '').slice(0, 40)}」`)
                  .join(' ／ ')}${(m.fwd.records?.length ?? 0) > 8 ? `…等${m.fwd.records?.length ?? 0}条` : ''}`
              : `[转发自「${m.fwd.from}」的消息] `
            : ''
        }`;
        return {
        role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
        // v75：携带源消息 ID——noteEngagement 区分「用户真实新回复」与「旧消息重放/系统事件合成注入」
        //（防焦虑 lastUserAt 被污染 → AI 幻觉「你终于回我了」；与微信端同口径）
        id: m.id,
        // 行首 [M数字] = 消息编号（v56 恢复：AI 用 [引用:编号] 引用它，教学见 chat-rich.ts）；我的表情以 [发送了表情：意思] 进入历史（AI 理解含义）；
        // AI 自己发的表情回写成 [表情包:ID] 示范正确输出格式（意思靠 system 清单反查），避免它模仿我的记录格式导致发表情变文字
        // 深度思考：AI 自己的历史回复带思考过程时还原 [思考]…[/思考] 前缀——模型看到自己一直按此格式输出
        //（in-context 自我一致），新回复的思考块遵循度大幅提升；标签展示前已被流层剥离，不进任何气泡
        content:
          (m.role === 'peer' && m.thinking ? `[思考]${m.thinking}[/思考]\n` : '') +
          (quoteIdOf.has(m.id) ? `[${quoteIdOf.get(m.id)}] ` : '') +
          pre +
          (m.kind === 'sticker' && m.stk
            ? m.role === 'me'
              ? `[发送了表情：${m.stk.meaning || '无描述'}]`
              : m.stk.sid
                ? `[表情包:${m.stk.sid}]`
                // 【fix3-d-2】AI 自己发的表情（无 ID 的兜底）用「你」点明主语：
                // 旧文案「[发送了表情：XX]」落在 assistant 槽位像是对用户动作的转述
                : `[你发送了表情：${m.stk.meaning || '无描述'}]`
            : m.kind === 'image'
            ? // 图片消息：全部带消息 ID 进上下文（视觉自主决策规则要求 AI 原样抄写图片消息 ID 来
              // [换头像:ID]/[换背景:ID]/[存入相册:ID]——此前无描述的图片不带 ID，AI 只能编造或换错图）；
              // 我发的图带会话内编号（用户说「第N张」时对照编号）；有描述附内容，无描述标「未识图」
              m.role === 'me' && userImgSeq.has(m.id)
              ? `[图片 ID:${m.id}]（我发的第${userImgSeq.get(m.id)}张图${m.img?.desc ? `；图片内容：${m.img.desc}）` : '；未识图，暂无内容描述）'}`
              : m.img?.desc
                ? `[图片 ID:${m.id}]（图片内容：${m.img.desc}）`
                : `[图片 ID:${m.id}]（未识图，暂无内容描述）`
            : m.kind === 'textcard' && m.card
            ? // 文字图片卡片：AI 知道发过什么卡片（历史可回看，避免接不上话题）
              `[文字图片]（卡片上写着：${m.card.text}）`
            : m.kind === 'voice'
            ? // 语音消息：AI 直接读转写文本（自然对话；AI 语音消息的朗读原文同源兑底）；识别失败/未识别时用占位
              m.voice?.transcript || m.voice?.localText || '[语音]'
            : m.kind === 'location'
            ? // 位置消息：AI 读到完整位置文本（名称/地址/经纬度/发送时间），问“我在哪”能直接答出地点名
              locationAiText(m.loc, m.time)
            : m.kind === 'song' && m.song
            ? // 歌曲卡片（Task 68）：AI 发的回写成示范格式；我发的用占位描述
              m.role === 'me'
              ? `[歌曲卡片]《${m.song.name}》${m.song.artist}`
              : m.song.autoPlay
                ? `[放歌:${m.song.name}:${m.song.artist}]`
                : `[分享歌曲:${m.song.name}:${m.song.artist}]`
            : m.kind === 'transfer' && m.packet && isTransferReceiptMsg(m)
            ? // 【fix3-d-1】转账凭据卡（收款凭据/退还凭据）带显式主语进历史，
              // 不再伪装成持卡人又发了一笔转账（资金方向不再被伪造）
              transferReceiptAiText(m, me.realName || me.name, peer.name)
            : m.kind === 'redpacket' && m.packet
              ? `[红包 ID:${m.packet.cid ?? m.id} ¥${m.packet.amount} "${m.packet.note}"，${cardStateLabel(m)}]`
              : m.kind === 'transfer' && m.packet
                ? `[转账 ID:${m.packet.cid ?? m.id} ¥${m.packet.amount}${m.packet.note ? ` "${m.packet.note}"` : ''}，${cardStateLabel(m)}]`
                : m.kind === 'family' && m.fam
                  ? `[亲属卡 ID:${m.fam.cid ?? m.id} 每月额度¥${m.fam.monthlyLimit}${m.fam.message ? ` "${m.fam.message}"` : ''}，${cardStateLabel(m)}]`
                  : m.kind === 'groupcard' && m.gcard
                    ? `[群聊邀请卡片：${m.gcard.name}（${m.gcard.inviterName || '群友'}邀请${m.gcard.memberNames?.length ? `，成员：${m.gcard.memberNames.join('、')}` : ''}），${m.gcard.status === 'pending' ? '待处理' : m.gcard.status === 'accepted' ? '已接受' : '已拒绝'}]`
                    : m.kind === 'mtpay' && m.mtpay
                      ? mtProxyHistoryLine(m.mtpay.pid, m.mtpay.role, m.role === 'me' ? me.realName || me.name : peer.name)
                      : m.kind === 'mtshare' && m.mtshare
                        ? mtOrderShareHistoryLine(m.mtshare.sid)
                        : m.kind === 'mtdraft' && m.mtdraft
                          ? mtDraftHistoryLine(m.mtdraft.did, peer.name)
                          : m.kind === 'tbpay' && m.tbpay
                            ? // 淘宝代付卡：AI 读到结构化信息；direction 'me' 请求卡（AI 请机主代付）用专属句式
                              m.tbpay.role === 'req' && m.role === 'peer'
                                ? tbProxyMeHistoryLine(m.tbpay.pid)
                                : tbProxyHistoryLine(m.tbpay.pid, m.tbpay.role, m.role === 'me' ? me.realName || me.name : peer.name)
                            : m.kind === 'tbshare' && m.tbshare
                              ? tbShareHistoryLine(m.tbshare.sid)
                              : m.kind === 'forumshare' && m.forumshare
                                ? forumShareHistoryLine(m.forumshare.pid, peer.id)
                                : m.kind === 'tbdraft' && m.tbdraft
                                ? tbDraftHistoryLine(m.tbdraft.did)
                                : m.kind === 'relcard' && m.relcard
                                  ? `[亲密关系卡片：${m.relcard.stage === 'invite' ? `${m.relcard.fromName}邀请${m.relcard.toName}建立情侣关系` : `${m.relcard.fromName}已同意，双方成功建立情侣关系`}，${m.relcard.status === 'pending' ? '待处理' : m.relcard.status === 'accepted' ? '已接受' : '已拒绝'}]`
                                // 拍一拍系统行（Task 30）：按双方名字显式序列化（文案后缀原样拼接），AI 无主语歧义
                                : m.kind === 'sys' && m.sys?.pat
                                  ? qqPatHistoryLine(m.sys.pat, me.realName || me.name, peer.name)
                                  // v1.3 Shizuku：手机操作结果行（sys.op）回给 AI——下一轮它知道自己刚才干了什么、成没成。
                                  // 圆括号+显式“勿复述”指引：防 AI 把反馈原文抄给机主（曾出现复述「手机操作成功：已拉起…」）
                                  : m.kind === 'sys' && m.sys?.op
                                    ? `（内部反馈：你刚才的手机操作结果——${m.sys.text}。这是只给你看的，用你自己的话告诉机主结果即可，严禁复述本行）`
                                    : m.content),
        };
      });

    const aiId = uid();
    // 用户消息立即入列（保存 effect 随即落盘）；AI 回复在全局 store 流式接收，
    // 结束/失败后由 finalize 写入本角色的聊天记录（与页面是否存活无关）。
    // userMsg 为 null = 分句发送批次触发（消息早已入列，只发起 AI 回复）。
    // 幂等入列：组合发送（文字+待发图一起发）时文字消息已先行上屏，按 id 去重跳过避免双气泡
    if (userMsg) setMsgs((prev) => (prev.some((x) => x.id === userMsg.id) ? prev : [...prev, userMsg]));
    // 深度思考：重置本轮上下文（重试/新回合互不串台；firstMsgId 由 buildReplyMsgs 首次产出时记录）
    turnThinkRef.current = { firstMsgId: null, text: '' };

    // 回复条数（本会话独立设置，发送时现场读取）：>1 时在人设后追加多条消息指令；
    // 特殊消息规则（红包/转账/亲属卡/位置/表情包标记 + 表情包 ID 清单）随表情包清单一起注入；
    // 我发给 AI 的待处理红包/转账 → 注入处理动作规则与待处理清单（AI 用 [领取红包:ID] 等标记处理，回应按人设正文说）
    const replyCount = getReplyCount(sessionKey);
    const stickers = loadStickers('qq');
    // 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji）
    const stickersOn = getStickersOn(sessionKey);
    // 动作描写开关（发送时现场读取）：开启注入格式约定、关闭注入显式禁令（见 @/lib/action-desc）
    const actionDescOn = getActionDescOn(sessionKey);
    // B8 作用域竞态修复：人设组装（bondNotesFor 读碎片）先于 memChatRecallBlock 设定作用域，
    // 显式提前落位，防止首轮发送 NPC 近况沿用上一次聊天的作用域读错账号记忆库
    setMemScopeForApp('qq');
    const system = buildPersonaPrompt(peer, me, ownerName, stickers, stickersOn, actionDescOn, buildNpcPromptExtra(peer, contacts), getAiVoiceFreq(sessionKey) !== 'off');
    // 40-a 拉黑破口修复：仅申请卡模式（requestOnly）下不再注入待处理卡清单与资金动作规则——
    // AI 在拉黑期间不能处理任何红包/转账（即使输出了处理标记也会被 buildReplyMsgs 丢弃），
    // 注入清单反而会诱导模型输出永远落不了地的处理动作
    // 100-e QQ 没有亲属卡功能：处理动作规则不下发亲属卡教学（opts.familyCard=false，与微信区分）
    const actionRules = requestOnly ? [] : buildActionRules(collectPendingCards(base), { familyCard: false });
    // 退群挽留背景（需求二）：该联系人所在的某个群存在活跃的退群流程时，注入退群事件、群内近况与
    // 拉回群/给权限标记说明（AI 按人设决定是否提起、是否拉回；每次退群最多一次，拒绝后不再提）
    const quitCtx = activeQuitFlowFor(peer.id);
    // 名字/昵称区分：AI 侧统一用称呼名（默认真名「凡凡」）指代用户；展示层（动态等）仍用显示名
    const meAddrName = addressNameOf(me, useSettings.getState().addressMode);
    // 被踢感知（需求一）：TA 被移出过群聊（未回群/刚回群）→ 私聊里记得并按人设自然提起
    const kickSection = buildKickNoticeSection(peer.id, meAddrName);
    // 建群能力（需求二/四）：关系到位、话题合适时可主动建群（冷却/拒绝表硬校验，提示词同步约束）
    const socialRules = buildGroupSocialRules(peer, 'qq', contacts, meAddrName);
    // 记忆库：召回该联系人（互通开关限定范围）的记忆注入 system，让 AI 带着记忆回复；
    // 相关性上下文用本轮触发消息（用户消息/系统事件）+ 最近几条，没记忆时返回空串不注入；
    // 图片消息以识图描述（无则占位）、语音消息以转写文本、位置以完整位置文本进上下文（防止 dataURL 大字符串进入记忆提取）
    const scanTextOf = (m: QQMsg): string =>
      m.kind === 'voice'
        ? m.voice?.transcript || ''
        : m.kind === 'image'
          ? m.img?.desc || ''
          : m.kind === 'textcard'
            ? m.card?.text || ''
            : m.kind === 'location'
              ? locationAiText(m.loc, m.time)
              : m.content;
    const memContext = [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ');
    // 记忆召回（私聊）：跨 App 互通开关照旧；群聊来源记忆按群级互通开关判断可见性
    //（effectiveInterop 只跟群开关；用户和角色 A 的私聊记忆默认不对角色 B 开放——
    //  存储键即隔离边界，这里只影响该角色自己的召回范围）
    const memoryBlock = memChatRecallBlock(peer.id, 'qq', memContext, {
      interopOn: effectiveInterop,
      // 小号披露门控（用户最新规则）：仅用户侧发言参与检测——默认纯陌生人，亮明身份才解锁大号记忆
      disclosureText: [userMsg?.content ?? '', ...base.slice(-8).filter((m) => m.role === 'me').map(scanTextOf)].filter(Boolean).join(' '),
      altMainName: cachedOwnerName(),
      altMainRelation: peer.relation?.trim() || '',
      // v42【帖子记忆·金鱼】：开关关时 forum 来源碎片零召回——过往帖子/评论绝不提起
      excludeFragmentSources: isPostMemoryOn() ? undefined : ['forum'],
    });
    // QQ动态感知（四）：把「最近的动态 + 相关互动」注入 system（互通开关关闭时只看 QQ 平台的动态），
    // AI 能像真人一样自然提起；用户广播动态首次被看到时懒写入该角色记忆（动态 → 记忆双向打通）
    // userName=展示名（动态存储检索口径）；userRealName=真名（标签/归属说明用真名称呼用户）
    const momentsBlock = buildMomentsChatBlock({ contactId: peer.id, app: 'qq', userName: me.name, userRealName: me.realName || me.name, peer });
    // v33【AI 真人社交】：X论坛近况感知（TA 发的帖/我发的帖/评论互动）——AI 私聊时能自然提起论坛的事
    // v44【AI 关注者】：带上 TA 刚发的这句——「你去x论坛关注我」会被感知并稍后自主决策
    const forumBlock = buildForumChatBlock(peer.id, userMsg?.content);
    // 情侣空间×AI（第九轮）：对方是恋人绑定的联系人时，注入你们在情侣空间里的一切
    const coupleBlock = coupleChatBlock(peer.id, 'qq', meAddrName);
    // 美团×AI 联动（外卖/代付）：实时订单动态 + 本聊天的待处理代付请求/待付订单 +
    // 食物话题命中时的商家目录与点外卖动作教学（全同步 kv 读，状态实时）——
    // A1：QQ 私聊同微信同构接入（此前仅卡片渲染/历史序列化接了，AI 本体不参与外卖/代付）
    const mtEngage = buildMtEngageCtx(peer.id, 'qq', [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]);
    // 淘宝×AI 联动（购物/代付/取件）：机主淘宝订单实时动态 + 待付订单帮付/在途快递帮取/
    // 礼物自动标记 + 购物话题时的商品目录与代买教学（全同步 kv 读，状态实时）
    const tbEngage = buildTbEngageCtx(peer.id, 'qq', [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]);
    // 时间感知（本会话独立开关，发送时现场读取；关闭时不注入任何时间信息，恢复普通聊天）：
    // 上次聊天间隔 = 该会话上一条消息时间戳（不含本轮刚发的消息）与当前时间的差值，按角色隔离不串台
    const priorMsgs = baseMsgs ?? msgs;
    const timeBlock = getTimeAware(sessionKey)
      ? buildTimeAwareBlock({
          lastMsgTime: priorMsgs.length > 0 ? priorMsgs[priorMsgs.length - 1].time : null,
          regionHint: peer.region || null,
        })
      : '';
    // 感知设置（第七十四轮）：打字耗时/电量/天气/日历 + ActivityWatch 真机感知 + VLM 看屏 ——
    // 预热缓存+现场读取范式（本轮同步读缓存，同时 fire-and-forget 刷新供下一轮）
    const perceptionBlock = buildPerceptionBlock(sessionKey, {
      lastMsgTime: priorMsgs.length > 0 ? priorMsgs[priorMsgs.length - 1].time : null,
    });
    void prewarmPerception(sessionKey);
    // 世界书：扫描「最新用户消息 + 最近 8 条上下文」，命中触发词的条目按插入位置分组注入
    //（每本书独立包裹成【世界设定开始】/【世界设定结束】块；系统/角色定义前后进 system，
    // 用户消息前后包裹最后一条 user 消息；未命中不发送；有内容时 system 末尾附带使用规则；
    // 图片消息以 [图片] 占位、语音消息以转写文本参与，防 dataURL 进入触发词扫描）
    // 100-e 世界书锚点对齐微信（主聊同款 collectWbBlocks 第三参 labels）：锚点块头注标注
    // 「文中的『你』指{角色名}、『机主/用户』指{机主名}」，消除世界书消歧「文中的你指谁」漂移
    const wbBlocks = collectWbBlocks(peer.id, wbScanText([userMsg?.content, sysEvent, ...base.slice(-8).map(scanTextOf)]), { charName: peer.name, userName: meAddrName });
    // 位置感知：用户最近发过的位置消息（名称/地址/经纬度/发送时间）注入 system——
    // AI 被问“我在哪/你知道我在哪吗”时直接说出地点名；解析失败时诚实说无法识别，不编造；
    // 【fix3-d-5】补传 peerLabel：AI 角色自己发的位置在注入块里标明「AI角色本人，就是你自己」，
    // 防止 AI 把自己发过的位置说成「对方（用户）的位置」
    const locBlock = buildLocationBlock(base, { userLabel: meAddrName, peerLabel: `「${peer.name}」` });
    // 双向拉黑感知：当前会话的拉黑关系注入 system（无拉黑状态时为空串；40-a 重构后拉黑会拦截本 App
    // 内的消息发送——byUser 时本回合早已被入口守卫取消；能走到这里的被拉黑回合=仅申请卡放行模式）
    const blkBlock = buildBlockPromptBlock('qq', peer.id, meAddrName);
    // 占位防编造（AI 感知审计修复）：最近消息里有听不到内容的语音 / 看不到内容的图片时注入——
    // AI 不得假装听过/看过并编造细节（本轮正在识图的图片排除：描述随后作为独立消息追加）
    const turnImageIds = new Set<string>();
    for (let i = base.length - 1; i >= 0 && turnImageIds.size < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image') turnImageIds.add(m.id);
    }
    // 【fix3-d-7】语音占位规则按发送者区分：QQ 消息 role 本就是 'me'|'peer' 且整条对象直接传入
    //（MediaRuleMsg 的 role 契约由 base 结构自动满足，无需额外映射）
    const mediaRules = [
      buildVoicePlaceholderRule(base),
      buildImagePlaceholderRule(base, { excludeIds: turnImageIds }),
    ].filter(Boolean);
    // 46-f：相册清单预取 + 视觉自主决策规则注入。buildVisionRules 注入【换头像/换背景/存相册/主动换头像】
    // 常驻规则；相册非空时追加【选图设头像/背景/发送】+【相册清单】（peer 最近 20 条 + 机主最近 15 条）。
    // 同时刷新 albumCacheRef 给 buildReplyMsgs 的 pick-album-* 分支同步查用（getAlbum async 不能在
    // 同步循环里 await，改预取缓存：本回合 buildReplyMsgs 读到的就是本次 listAlbumsForChat 的结果）
    let albumSummary: { id: string; desc: string }[] | null = null;
    let ownerAlbumSummary: { id: string; desc: string }[] | null = null;
    try {
      // 第三十一轮：peer 相册 + 机主相册合并预取（listAlbumsForChat）——AI 存图双写后两边都有图可选
      const albumList = await listAlbumsForChat(peer.id, me.id);
      albumCacheRef.current = albumList;
      // 第二十九轮：懒补缺失的图片描述（每边每轮最多 2 张，fire-and-forget）——
      // desc 是【相册清单】与「AI 主动分享相册照片」的依据，补齐后下一轮 AI 就知道每张图长什么样
      if (albumList.some((a) => !a.desc)) {
        void Promise.all([ensureAlbumDescs(peer.id, 2), me.id !== peer.id ? ensureAlbumDescs(me.id, 2) : Promise.resolve(0)])
          .then(async () => {
            albumCacheRef.current = await listAlbumsForChat(peer.id, me.id).catch(() => albumCacheRef.current);
          })
          .catch(() => {});
      }
      if (albumList.length > 0) {
        // 47-c #112：清单按归属拆两份（peer 的进【相册清单】、机主的进【对方的相册清单】），
        // 各取最近 20/15 张——AI 看到的是相册新增的最新内容
        albumSummary = albumList.filter((a) => a.contactId === peer.id).slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }));
        if (me.id !== peer.id) {
          const owners = albumList.filter((a) => a.contactId === me.id);
          if (owners.length > 0) ownerAlbumSummary = owners.slice(-15).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }));
        }
      }
    } catch {
      // 读相册失败不阻塞聊天主流程，仅放弃本回合的【选图操作】规则
    }
    // 第二十九轮「头像感知」：AI 头像描述懒补（换过头像但识图还没成功时补一次；fire-and-forget）
    const peerAvatarSrc = avatarFor(peer, 'qq');
    if (peerAvatarSrc) ensureAvatarDesc(peer.id, 'qq', peerAvatarSrc, 'peer');
    // 【fix3-d-6】传 app='qq'：视觉规则里的「换朋友圈背景」文案按端区分（QQ 端说明改的是 QQ 资料页封面）
    // 第三十一轮：规则恒注入（不再要求会话有图/相册非空）——「自主换头像/存相册」是 AI 的常驻能力，
    // 没图也能 [生成新头像]，按需注入会让 AI 根本不知道自己能换（拉黑仅申请卡模式除外）；
    // 机主相册清单非空时以第三参传入（【对方的相册清单】，AI 两边都能选图）
    const visionRules = requestOnly ? [] : buildVisionRules(albumSummary, 'qq', ownerAlbumSummary);
    // 发图片能力常开：注入照片标签规则（配置完整时发真图；未配置/生成失败自动降级为文字图片卡片，AI 无需关心）
    const photoRule = buildPhotoTagRule(peer.name);
    // AI 发说说能力（用户要求「发条说说」或自主想分享时真发）：[发说说:正文] 标记 →
    // buildReplyMsgs 执行器 addCharMomentPost 真实落库；教学规则恒注入（单聊都有空间，不等动态块非空）；
    // requestOnly（仅申请卡模式）下 AI 只能输出拉黑类动作，与 actionRules 同口径不下发
    const momentPostRule = requestOnly ? '' : buildMomentPostRule('qq');
    const systemFull = [
      wbBlocks.beforeSystem,
      [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
      memoryBlock,
      // 第十六轮：AI 动态状态（情绪+作息）——AI 带着当前心情说话（开心/吃醋/委屈…影响语气与表情选择）、
      // 按 TA 记住的作息规律拿捏说话时机（清早道早安/深夜催睡/饭点关心）
      buildDynamicStateBlocks(peer.id),
      // 40-b 跨 App 环境感知：当前 App 记忆 → 其他 App 最近 10 条 → 群聊最近 10 条（长期/核心在 memoryBlock 内）
      crossCtxRef.current.crossAppBlock,
      crossCtxRef.current.groupBlock,
      // 美团外卖动态：机主最近订单/配送状态实时注入（AI 知道机主点了什么、哪家店、多少钱、什么时候、现在到哪了）
      mtEngage.block,
      // 淘宝购物动态：机主最近订单/快递状态实时注入（AI 知道机主买了什么、快递到哪了，可自然提起）
      tbEngage.block,
      // 音乐实时情境（第三十八轮）：一起听中=一起听块；其余私聊=音乐点播块（播放器此刻歌名/歌手/进度/歌词
      // + 主动放歌引导 + 播控指令说明）（发消息瞬间现场构建，非缓存）
      togetherLiveBlock(peer.id, meAddrName),
      momentsBlock,
      // v33【AI 真人社交】：论坛近况（紧随 QQ动态感知块；空串时零成本）
      forumBlock,
      coupleBlock,
      locBlock,
      // 第二十九轮「头像感知」：AI 知道自己头像长什么样、用户头像长什么样/什么时候换的；
      // 用户换头像时 AI 会像真人一样自然注意到
      buildAvatarBlock(peer.id, me.id, meAddrName),
      [...actionRules, ...mtEngage.rules, ...tbEngage.rules].length > 0 ? [...actionRules, ...mtEngage.rules, ...tbEngage.rules].join('\n\n') : '',
      blkBlock,
      quitCtx?.section ?? '',
      kickSection,
      socialRules,
      ...(mediaRules.length > 0 ? [mediaRules.join('\n\n')] : []),
      '【语音通话能力】如果你此刻非常想和对方马上说话（想TA了、有急事、聊到特别开心等自然原因），可以在回复的最开头单独加上标记 [语音通话] 发起一次语音通话邀请，对方手机会弹出你的来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。',
      '【视频通话能力】如果你此刻很想看看对方（想TA了、有值得分享的时刻、对方说想见你/想看看你等自然原因），可以在回复的最开头单独加上标记 [视频通话] 发起一次视频通话邀请，对方手机会弹出你的视频来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。注意：标记必须是单独四个字 [视频通话]，严禁模仿聊天记录里「[视频通话：时长/内容摘要]」这类卡片描述文字的格式（那是系统卡片不是标记），不要输出带冒号的 [视频通话：……]。',
      timeBlock,
      perceptionBlock,
      // v1.3 Shizuku 自主权：[手机操作:…] 教学规则按当前开关注入（总开关关/非手机APP环境 → 空，零 token）
      ...buildShizukuAutonomyRules(),
      ...(visionRules.length > 0 ? [visionRules.join('\n\n')] : []),
      // 生图（锁脸）：照片标签规则（自动生图开启时；AI 输出 [照片:描述] 系统自动生图并以图片消息投递）
      ...(photoRule ? [photoRule] : []),
      // AI 发说说能力（[发说说:正文] 真实发布；在照片规则后：先把「图片描述」的用法钉死再教发动态标记，
      // 防 AI 用 [图片:空间编辑页面] 假装发了）
      momentPostRule,
      wbBlocks.afterSystem,
      wbRulesBlock(wbBlocks),
    ]
      .filter(Boolean)
      .join('\n\n');
    const payloadMsgs: ChatPayloadMessage[] = applyWbUserBlocks(
      [
        { role: 'system' as const, content: replyCount > 1 ? `${systemFull}\n\n${buildReplyCountPrompt(replyCount)}\n\n${promptRule('deep-think', DEEP_THINK_RULE) ?? ''}` : `${systemFull}\n\n${promptRule('deep-think', DEEP_THINK_RULE) ?? ''}` },
        ...history,
      ],
      wbBlocks,
    );
    if (sysEvent) payloadMsgs.push({ role: 'user', content: sysEvent });

    // 识图输入：收集本轮的图片（从末尾向前、连续「我」的消息里的图片；遇到对方/AI 回复即停，
    // 最多 3 张）。识图配置存在时，chat-stream-store 会先识图再把描述作为上下文交给聊天模型，
    // 并经 onVision 把描述写回对应图片消息（img.desc 持久化，之后的聊天历史 AI 都能读到图片内容）；
    // 未配置时该字段不生效，行为与旧版一致
    const turnImages: string[] = [];
    const turnImageMsgIds: string[] = [];
    for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image' && typeof m.content === 'string' && m.content.startsWith('data:image/')) {
        turnImages.unshift(m.content);
        turnImageMsgIds.unshift(m.id);
      }
    }
    // 回看兜底（用户实测：发图让 AI 看，AI 第一次没看懂，再让它看第二遍时不应要求重新发图；与微信同口径）：
    // 本轮没有新图时，若用户最新消息带「看图」意图（看/图/照片/识别…），回退取会话里最近的「我」发的
    // 图片（最多 3 张，可跨过 AI 的回复取到）——AI 自己就能看到之前发的图，识图描述回写后历史永久可读。
    if (turnImages.length === 0 && /看|图|照片|识/.test(userMsg?.content ?? '')) {
      for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
        const m = base[i];
        if (m.role === 'me' && m.kind === 'image' && typeof m.content === 'string' && m.content.startsWith('data:image/')) {
          turnImages.unshift(m.content);
          turnImageMsgIds.unshift(m.id);
        }
      }
    }

    // ---- 边接收边逐条投递（分段流式核心）----
    // 换号防串号（H1 纵深防御）：本回合全部投递闭包（流中分段/finalize 收尾）共用的会话纪元——
    // 换号 purge（purgeQqSessionData）递增纪元并中止在途流，此后触发/恢复的闭包按失配整体丢弃
    //（与 chat-stream-store 的 onDelta/finalize 挡板双保险）
    const turnEpoch = qqSessionEpoch;
    // 流中每凑齐一条完整消息（分段器回调 onSegment）立刻解析并排队投递上屏；
    // 流结束后 finalize 只处理剩余的最后一条（N 条上限的第 N 条）——
    // 不再有「先全文显示、消失、再逐条重放」的流式气泡，流式与分条也不改同一块展示状态。
    let deliveredAny = false; // 本轮是否已有分段消息排队投递（决定兜底文案）
    let batchStarted = false; // 是否已排过批（首批立即上屏，后续批按打字节奏先停顿）
    let msgIdx = 0; // 本轮已构建消息数（延续 aiMsgId 与 -N 后缀的 id 序列）
    // [语音通话] 标记本轮是否出现过（组件级 ref，开回合时重置；buildReplyMsgs 解析到标记时置位）
    wantCallSeenRef.current = false;
    // Task 22 视频通话：[视频通话] 标记同款开回合重置（buildReplyMsgs 解析到标记时置位）
    wantVideoCallSeenRef.current = false;
    // 一起听遥控：同款开回合重置（buildReplyMsgs 剥出播控指令时置位）
    musicActedRef.current = false;
    // F1 回合开始清 carry：跨段残留只可能属于上一回合，不复用（流中断/换号中止的半截标签不串入新回合）
    photoCarryRef.current = '';
    musicHoldRef.current = ''; // 一起听遥控：同款回合开始清留存（半截播控指令不串回合）

    /** 排队投递一批：首批立即上屏（边接收边显示），后续批先按打字节奏停顿（逐条冒出来） */
    const enqueueBatch = (built: QQMsg[]) => {
      if (built.length === 0) return;
      void scheduleAiDelivery<QQMsg>(
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

    /** 流中分段投递：分段器每凑齐一条完整消息回调一次，立刻解析并排队上屏（边接收边逐条显示） */
    const deliverSegment = (seg: string) => {
      // H1 纵深防御：换号（纪元失配）后本回合流中分段整体丢弃——不再解析/落盘/排队投递
      if (turnEpoch !== qqSessionEpoch) return;
      // F1 carry-over：上一段尾部未闭合的半截照片标签拼回本段开头，再切出本段尾部仍处未闭合的部分存回
      //（「[图片:黄昏的咖」跨段被切开后，两段各自都不再含半截标签；下一段到达后拼成完整标签正常剥出生图）
      const merged = photoCarryRef.current + seg;
      const { send, carry } = splitUnfinishedPhotoTag(merged);
      photoCarryRef.current = carry;
      // 一起听遥控：上一段尾部未闭合的半截播控指令拼回本段开头，再留住本段尾部新的半截（防「[快进:」被分段器切一半）
      const musicMerged = musicHoldRef.current + send;
      musicHoldRef.current = '';
      const musicCut = cutUnfinishedMusicTag(musicMerged);
      musicHoldRef.current = musicCut.held;
      const { msgs: built, cur, dirty, nextIdx } = buildReplyMsgs(musicCut.text, false, Date.now(), aiId, msgIdx);
      msgIdx = nextIdx;
      if (dirty) saveMsgs(peer.id, cur);
      if (built.length === 0) return;
      deliveredAny = true;
      enqueueBatch(built);
      flushPhotoJobs(enqueueBatch); // 生图（锁脸）：流中分段剥出的照片标签统一异步生成投递
    };

    const started = beginChatStream({
      sessionKey,
      aiMsgId: aiId,
      messages: payloadMsgs,
      apiConfig,
      replyCount,
      ...(turnImages.length > 0
        ? {
            vision: { images: turnImages, text: userMsg?.content ?? '' },
            // 识图描述按「图N：」行拆分后逐张回写（img.desc 持久化）：turnImageMsgIds 与 turnImages
            // 一一对应，每张图各得自己的描述（#25）；某张拆不出（空串）就跳过、保持 [图片] 占位，
            // 防编造规则兜住，之后的聊天历史 AI 都能读到图片内容
            onVision: (desc: string) => {
              const parts = splitVisionDesc(desc, turnImageMsgIds.length);
              turnImageMsgIds.forEach((targetId, i) => {
                const part = parts[i]?.trim();
                if (!targetId || !part) return;
                setMsgs((prev) =>
                  prev.map((x) => (x.id === targetId && x.kind === 'image' ? { ...x, img: { ...x.img, desc: part } } : x)),
                );
              });
            },
          }
        : {}),
      // 边接收边逐条显示：分段器每凑齐一条完整消息立刻解析投递（多条模式）
      onSegment: deliverSegment,
      finalize: ({ content, error, tail, thinking }) => {
        // 感知设置：AI 回复落地时刻 = 用户下一轮「思考+打字」计时的基线（打字感知开关用）
        markAiReplyEnd(sessionKey);
        // 深度思考：合并流层收集的思考过程（buildReplyMsgs 兜底剥离的已累积在 ref 里，流层的在此并入）
        if (thinking && thinking.trim()) {
          const prevTk = turnThinkRef.current.text;
          turnThinkRef.current.text = prevTk ? `${prevTk}\n${thinking.trim()}` : thinking.trim();
        }
        // F1 收尾：先把跨段 carry 取走并清空——流已结束，残留的半截照片标签不再单独投递
        //（拼回最后一段一起走管线，闭合则正常生图/降级，仍闭合不上则由 buildReplyMsgs 兜底剥除不投递）
        const carry = photoCarryRef.current;
        photoCarryRef.current = '';
        // 一起听遥控：收尾把留存的半截播控指令拼回（流已结束，不再留；未闭合的残留括号由 buildReplyMsgs 原文透传不执行）
        const musicHold = musicHoldRef.current;
        musicHoldRef.current = '';
        // 失败标记触发的我的消息（userMsg 为 null 时取 base 里最后一条我的消息）：
        // 新版失败不再落错误占位消息——在本条消息气泡前打红色 ! 徽标（点击重试），成功后在下方清除
        const failTargetId = userMsg?.id ?? [...base].reverse().find((m) => m.role === 'me' && !m.recalled)?.id ?? null;
        /** 落库 + 同步 state：给触发消息打/清 replyFail 标记（红色 ! 徽标）；
         *  Task 40 错误提示优化：失败时同步写入分类文案 failReason（居中灰字提示行用），清除时一并抹掉 */
        const setReplyFail = (fail: boolean, reason?: string) => {
          if (!failTargetId) return;
          const cur = loadMsgs(peer.id);
          if (!cur.some((m) => m.id === failTargetId)) return;
          const patch = (m: QQMsg): QQMsg => {
            if (m.id !== failTargetId) return m;
            // 标记与文案都无变化时跳过（防无意义的全量落库）；成功清除（fail=false）连 failReason 一起抹掉
            if (Boolean(m.replyFail) === fail && (!fail || m.failReason === reason)) return m;
            return { ...m, replyFail: fail || undefined, failReason: fail ? reason : undefined };
          };
          const changed = cur.map(patch);
          saveMsgs(peer.id, changed);
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
        // 多条模式：流中分段已通过 onSegment 逐条解析投递上屏（边接收边逐条显示），
        // 这里只处理剩余的最后一条（N 条上限的第 N 条，可能含溢出合并的句子；F1：跨段 carry 拼回开头）；
        // 单条模式：整条回复在此按旧管线（&&& 标记切分）落盘 —— 两种模式都不重放已投递的分段
        const { msgs: built, cur, dirty } = buildReplyMsgs(musicHold + carry + (replyCount > 1 ? tail : content), replyCount <= 1, Date.now(), aiId, msgIdx);
        if (dirty) saveMsgs(peer.id, cur);
        // 剩余为空且流中也没有任何分段/动作产出时不算有效回复 → 触发消息打红色 ! 徽标（不再落兜底占位文案）；
        //（40-a：仅申请卡模式正文已被丢弃，静默收尾不打标）
        const finalBatch: QQMsg[] =
          built.length > 0
            ? built
            : deliveredAny || musicActedRef.current
              ? []
              : requestOnly
                ? []
                // Task 40 错误提示优化：空回复/解析失败按解析类文案打标 + 记失败计数
                : (setReplyFail(true, CHAT_PARSE_FAIL_TEXT), recordChatFail(sessionKey, '空回复'), []);
        // 有任何产出（分段投递/动作/本轮落盘消息）：清除触发消息上的失败徽标（重试成功场景）
        if (built.length > 0 || deliveredAny || musicActedRef.current) {
          setReplyFail(false);
          // Task 40：成功即清零失败计数与冷却（重试成功/正常回复场景）
          recordChatSuccess(sessionKey);
        }
        // 排队投递（模拟真人连发）：每条到达时才落盘 + 弹灵动岛通知 + 判定语音频率，停顿按内容长度
        // 模拟打字节奏；空批仅作占位，密友值/记忆库等「一轮结束」动作挂在全部消息投递完之后；
        // 调度器在模块层运行，与聊天页是否存活无关（退出页面后继续接收/投递）
        flushPhotoJobs(enqueueBatch); // 生图（锁脸）：finalize 剩余段剥出的照片标签统一异步生成投递
        void scheduleAiDelivery<QQMsg>(
          sessionKey,
          finalBatch,
          deliverAiMsg,
          {
            initialDelay: finalBatch.length > 0 ? (batchStarted ? typingDelayOf(finalBatch[0].content ?? '') : 0) : 0,
            delay: (i) => (i + 1 < finalBatch.length ? typingDelayOf(finalBatch[i + 1].content ?? '') : 0),
          },
        ).then(() => {
          // 换号防串号：投递等待窗口内发生换号（纪元失配）→ 旧账号回合的密友值/记忆提取/
          // 过期清算/来电触发整体作废（换号 purge 会把排队批 resolve，本回调因此被激活）
          if (turnEpoch !== qqSessionEpoch) return;
          // 深度思考回填：本轮全部消息投递完落库后，把思考过程写到本回合第一条 AI 文本消息的
          // thinking 字段（深度思考开关关闭时渲染层不显示，字段照存——重开开关即可回看）
          const tkCtx = turnThinkRef.current;
          const thinkText = tkCtx.text.trim();
          if (thinkText && tkCtx.firstMsgId) {
            const targetId = tkCtx.firstMsgId;
            const cur = loadMsgs(peer.id);
            if (cur.some((x) => x.id === targetId)) {
              saveMsgs(peer.id, cur.map((x) => (x.id === targetId ? { ...x, thinking: thinkText } : x)));
              setMsgs((prev) => prev.map((x) => (x.id === targetId ? { ...x, thinking: thinkText } : x)));
            }
          }
          // 密友值 + 记忆库：一轮对话结束（全部消息投递完）后执行；后台异步，失败静默不打断聊天
          // 密友值：对方回复一轮也算互动 +2（失败不算；与页面是否存活无关）
          addBondPoints(peer.id, BOND_MSG_POINTS);
          // 单聊卡片过期清算（AI 回合结算后触发）：AI 发的红包/转账超 24h 未领取/未收款 → 过期退回；
          // 本会话有变更时把落盘记录（过期卡片 + 提示行）同步回本地视图（模块层防重入）
          void expireStaleSingleCards().then((swept) => {
            if (!swept) return;
            setMsgs((prev) => {
              const saved = loadMsgs(peer.id);
              const savedMap = new Map(saved.map((m) => [m.id, m]));
              return sortMsgsByTime([
                ...prev.map((m) => savedMap.get(m.id) ?? m),
                ...saved.filter((m) => !prev.some((p) => p.id === m.id)),
              ]);
            });
          });
          // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片；
          // names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人 name，均非昵称——
          // 展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）
          // 多账号 v2：记忆视角的「用户」= QQ 当前账号对应的「人」（大号=机主；小号/匿名号=档案联系人名）
          void Promise.all([ownerRealNameFor('qq'), contactRealName(peer.id)])
            .then(([owner, peerReal]) =>
              memAfterAiTurn(
                peer.id,
                'qq',
                apiConfig,
                () => memConvoFromRaw(loadMsgs(peer.id), peer.name),
                () => loadMsgs(peer.id),
                { user: owner || me.realName || me.name, peer: peerReal || displayNameOf(peer) || peer.name }
              )
            );
        });
        // AI 主动发起语音通话（标记可能出现在流中任一分段）：剥除后按 5 分钟冷却弹出来电浮层。
        // #34 触发块已抽为 maybeTriggerAiCall 共用（bg 接力投递完成同款触发，不再静默吞掉 [语音通话] 标记）
        maybeTriggerAiCall(requestOnly);
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started) {
      if (userMsg) setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
    }
    },
    [msgs, peer, me, apiConfig, ownerName, contacts, sessionKey, maybeTriggerAiCall, openVoiceCall, deliverAiMsg, buildReplyMsgs, flushPhotoJobs]
  );
  // 发红包/转账时通过 ref 触发（runAiTurn 定义在 sendRedPacket 之后，见 runAiTurnRef 注释）
  runAiTurnRef.current = runAiTurn;

  /** 红色 ! 徽标重试：AI 回复失败的消息点击后重发同一回合（流/投递占用时静默，徽标保留可再点；
   *  消息本体已在 state 与存储里，runAiTurn 按 id 去重不会重复入列；成功在 finalize 清除标记）。
   *  Task 40 错误提示优化：入口加连续失败冷却拦截——重试动作受冷却约束（发新消息不受影响），拦截时 toast 提示剩余秒数 */
  const retryReply = useCallback(
    (m: QQMsg) => {
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
      const cd = cooldownRemainText(sessionKey);
      if (cd) {
        onToast(cd);
        return;
      }
      runAiTurnRef.current?.(m);
    },
    [onToast, sessionKey]
  );

  // ---------------- 退出网页接力（bg-turn）：服务端代跑的回复拉取 + 原管线投递 ----------------

  /** 排队投递一批接力回复（首条立即上屏，后续按打字节奏）——与 runAiTurn 的 enqueueBatch
   *  首批（batchStarted=false）完全同参数口径 */
  const bgEnqueueBatch = useCallback(
    (built: QQMsg[]) => {
      if (built.length === 0) return;
      void scheduleAiDelivery<QQMsg>(
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

  // F3 遗留照片任务恢复：会话中途退出/进程被杀时，还没 flush 的照片任务快照留在 kv；挂载/切会话
  //（ChatPage 按 peer.id 重挂载）时读回 → JSON 校验（数组且每项 desc 为 string）→ 清快照 →
  // 补回 photoJobsRef → 用后台接力投递 flush 补做生成（生成/降级卡片/相册/决策日志/记忆挂点全复用，
  // 走 scheduleAiDelivery 全局队列，页面随后被关也不中断；快照已清，effect 重跑幂等）
  useEffect(() => {
    const kvKey = `qq-photo-jobs:${sessionKey}`;
    const saved: unknown = kvGet<unknown>(kvKey);
    kvDel(kvKey);
    if (typeof saved !== 'string' || !saved) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return; // 快照损坏按无遗留任务处理
    }
    if (!Array.isArray(parsed)) return;
    const jobs = parsed.filter((j): j is PhotoTag => Boolean(j) && typeof (j as PhotoTag).desc === 'string');
    if (jobs.length === 0) return;
    photoJobsRef.current = [...photoJobsRef.current, ...jobs];
    flushPhotoJobs(bgEnqueueBatch);
  }, [peer.id, sessionKey, flushPhotoJobs, bgEnqueueBatch]);

  /** 接力回复投递：与 finalize 完全同管线（buildReplyMsgs 解析 → 排队投递）。
   *  single=true：texts[0] 是一次完整回复原文（可能含 &&& 分段与动作标记）→ 单条模式；
   *  single=false：每项就是一条独立消息文本 → 多条模式逐条投递。
   *  动作标记（红包领取/拉黑等）就地应用，卡片状态变更随 dirty 落盘——与 finalize 同款 */
  const deliverBgItems = useCallback(
    (items: BgPendingItem[]) => {
      // Task 30（v56 恢复）：接力回复同样带消息编号映射——落盘记录按绝对位置重算（与生成侧同口径），
      // 生成时 AI 看到的 [引用:M编号] 在投递侧能对上同一条消息（中途删消息才可能漂移，罕见可容忍）
      {
        let n = 0;
        const map = new Map<string, QQMsg>();
        for (const m of loadMsgs(peer.id)) {
          if (m.recalled || m.error || m.kind === 'notice' || m.kind === 'blockreq') continue;
          n += 1;
          map.set(`M${n}`, m);
        }
        quoteMapRef.current = map;
      }
      // 接力 generate 存的是完整回复原文：按该会话自己的回复条数决定解析模式（与 finalize 同语义）
      const bgAsSingle = getReplyCount(sessionKey) <= 1;
      for (const item of items) {
        if (item.single) {
          const r = buildReplyMsgs(item.texts.join(''), bgAsSingle, Date.now(), uid(), 0);
          if (r.dirty) saveMsgs(peer.id, r.cur);
          bgEnqueueBatch(r.msgs);
          flushPhotoJobs(bgEnqueueBatch); // 生图（锁脸）：接力回复里的照片标签同样异步生成投递
        } else {
          for (const t of item.texts) {
            const r = buildReplyMsgs(t, false, Date.now(), uid(), 0);
            if (r.dirty) saveMsgs(peer.id, r.cur);
            bgEnqueueBatch(r.msgs);
            flushPhotoJobs(bgEnqueueBatch); // 生图（锁脸）：接力回复里的照片标签同样异步生成投递
          }
        }
      }
      // #34 接力回复同样可能带 [语音通话] 标记：buildReplyMsgs 会置位 wantCallSeenRef，
      // 旧实现只读不消费 → 标记被静默吞掉。投递完成后按 finalize 同款冷却触发来电
      //（bg 回复非仅申请卡模式，requestOnly=false；冷却/通话中/拉黑防御在 maybeTriggerAiCall 内）
      maybeTriggerAiCall(false);
    },
    [bgEnqueueBatch, buildReplyMsgs, maybeTriggerAiCall, peer.id, sessionKey, flushPhotoJobs],
  );

  const bgDeliverRef = useRef<(items: BgPendingItem[]) => void>(() => undefined);
  bgDeliverRef.current = deliverBgItems;

  // 挂载注册会话元数据（pagehide 上报 beacon 携带显示名，Web Push 标题用联系人名）；
  // 卸载/会话切换时解除（ChatPage 按 peer.id keyed 重挂载，切人先卸旧再挂新）
  useEffect(() => {
    registerBgSession(sessionKey, { title: peer.name, app: 'qq', avatar: peer.avatar ?? null });
    return () => {
      unregisterBgSession(sessionKey);
    };
  }, [peer.name, sessionKey]);

  // 挂载 + 回前台时拉取本会话待达消息（只读拉取，确认投递后 consume 清除），经原投递管线逐条落盘
  //（灵动岛通知/语音频率/未读角标与页面内 AI 回复完全同口径；会话有活跃流/投递时 pull 内部返回空，等下次回前台再拉）
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

  // ---------------- 双向拉黑（用户开关 / 角色申请卡片的同意与拒绝） ----------------

  /** 追加一条系统提示行（拉黑状态变更提示；居中灰字胶囊，不进 AI 上下文） */
  const pushSysMsg = useCallback((text: string) => {
    setMsgs((prev) => [...prev, { id: uid(), role: 'peer' as const, content: '', time: Date.now(), kind: 'sys' as const, sys: { text } }]);
  }, []);

  /** 设置页「拉黑」开关：持久化（kv，按联系人隔离）+ 生成系统消息；角色下一轮起通过 system 感知 */
  const toggleBlockFromSettings = useCallback(
    (v: boolean) => {
      setBlk(setUserBlock('qq', peer.id, v));
      pushSysMsg(v ? `你已拉黑「${peer.name}」` : `你已解除拉黑「${peer.name}」`);
    },
    [peer.id, peer.name, pushSysMsg]
  );

  /** 处理「申请解除拉黑」卡片：同意 → 解除拉黑；拒绝 → 保持并记录拒绝（角色下一轮知道被拒绝）。
   *  两种结果都会立刻注入系统事件触发角色人设化回应，避免「点了没反应」。
   *  37-a：回复中（流式/投递）时事件随补跑回合排队（对齐 chat.tsx resolveBlockReq），不再被占用中的流静默丢弃 */
  const resolveBlockReq = useCallback(
    (m: QQMsg, accept: boolean) => {
      if (m.blkreq?.status !== 'pending') return;
      setMsgs((prev) =>
        prev.map((x) => (x.id === m.id && x.blkreq ? { ...x, blkreq: { ...x.blkreq, status: accept ? ('accepted' as const) : ('rejected' as const) } } : x))
      );
      // AI 邻接事件文案：机主恒真名（me 是展示副本，社交模式下 name=昵称——AI 永不知道昵称）
      const meReal = me.realName || me.name;
      const ev = accept
        ? `（系统事件：${meReal}同意了你的解除拉黑申请，现在已经解除拉黑、恢复正常关系。请用符合人设的一两句话自然回应这件事。）`
        : `（系统事件：${meReal}拒绝了你的解除拉黑申请，拉黑仍然生效。请用符合人设的一两句话自然回应这件事，不要假装已经解除。）`;
      if (accept) {
        setBlk(acceptBlockReq('qq', peer.id));
        pushSysMsg(`你同意了「${peer.name}」的解除拉黑申请`);
      } else {
        setBlk(rejectBlockReq('qq', peer.id));
        pushSysMsg(`你拒绝了「${peer.name}」的解除拉黑申请`);
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        qqQueueAdd(peer.id, ev); // 事件随补跑回合保留，流收尾且投递完毕后自动触发回应
        return;
      }
      runAiTurnRef.current?.(null, [], ev);
    },
    [peer.id, peer.name, me.name, me.realName, pushSysMsg, sessionKey]
  );

  /**
   * 40-a：发送「解除拉黑申请」（用户→角色；被拉黑后唯一放行的发送通道）：
   * 落一张用户发起的申请卡（from:'user'，右侧机主侧）+ 系统事件触发角色决策回合
   *（角色用 [同意解除拉黑]/[拒绝解除拉黑] 标记回复，见 buildReplyMsgs 的决策分支）。
   * applyUserBlockReq 未受理（并发/已达上限）时静默收起面板；回复中（流式/投递）时事件随补跑回合排队。
   */
  const submitUserBlockReq = () => {
    const res = applyUserBlockReq('qq', peer.id, userReqText);
    setUserReqOpen(false);
    setUserReqText('');
    if (!res.created) return;
    setBlk(res.entry);
    setMsgs((prev) => [
      ...prev,
      { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'blockreq' as const, blkreq: { reason: res.entry.userReqReason ?? '', status: 'pending' as const, from: 'user' as const } },
    ]);
    const meReal = me.realName || me.name;
    const ev = `（系统事件：你之前把${meReal}拉黑了，现在${meReal}给你发来一条解除拉黑申请，理由：「${res.entry.userReqReason ?? ''}」。如果你愿意解除拉黑给对方一个机会，请在回复的最开头单独加上标记 [同意解除拉黑]；如果决定拒绝，请在回复的最开头单独加上标记 [拒绝解除拉黑]。先用你的方式自然回应这件事）`;
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      qqQueueAdd(peer.id, ev);
      return;
    }
    runAiTurnRef.current?.(null, [], ev);
  };

  /** 拉黑标记（对照用户截图）：红色 ! 圆点紧贴气泡——拉黑关系存续期间（任一方向），该期间内的
   *  双方气泡都带图标（用户拉黑 AI 后用户气泡也有图标，反之亦然）；
   *  按拉黑区间判定：拉黑前的历史消息不标，拉黑期间发的消息恒标（解除后也不消失），解除后新消息不标；
   *  系统提示行/申请卡片/撤回行不显示 */
  const blockSideOf = (m: QQMsg): 'me' | 'peer' | null => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (!blockCoversAt(blk, 'byUser', m.time) && !blockCoversAt(blk, 'byChar', m.time)) return null;
    return m.role === 'me' ? 'me' : 'peer';
  };

  /** 拉黑图标渲染（红色 ! 圆点）：我的消息在气泡左侧、对方在气泡右侧（流式与落盘共用） */
  const blockIconSpan = (side: 'me' | 'peer', testid: string) => (
    <span
      data-testid={testid}
      aria-label={side === 'me' ? '我被拉黑' : '对方被我拉黑'}
      className="flex h-[20px] w-[20px] shrink-0 self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white"
    >
      !
    </span>
  );

  /** 红色 ! 圆点：紧贴气泡（流式与落盘消息共用同款样式） */
  const blockedIconOf = (m: QQMsg) => {
    const side = blockSideOf(m);
    if (!side) return null;
    return blockIconSpan(side, side === 'me' ? 'qq-block-icon-me' : 'qq-block-icon-peer');
  };

  /** 「消息已发出，但被对方拒收了。」状态行：仅「对方拉黑我」区间内我的消息后面跟随（与图标判定解耦：
   *  用户拉黑 AI 后自己的气泡也有图标，但不显示拒收文案），
   *  居中半透明圆角胶囊（与系统提示行同款） */
  const blockedLineOf = (m: QQMsg) => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (m.role !== 'me' || !blockCoversAt(blk, 'byChar', m.time)) return null;
    return (
      <div className="pt-1 text-center">
        <span
          data-testid="qq-block-line-me"
          className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60"
        >
          消息已发出，但被对方拒收了。
        </span>
      </div>
    );
  };

  /** 文字转语音发送（定义在下方；send 在前引用 → 同 runAiTurnRef 的 ref 模式） */
  const sendTextAsVoiceRef = useRef<(t: string) => void>(() => undefined);

  const send = useCallback(async () => {
    const text = input.trim();
    const staged = pendingImgsRef.current;
    // 40-a 拉黑拦截：被角色拉黑（byChar）后本 App 内不能发送任何消息（toast + 不落库）；
    // 唯一例外是「解除拉黑申请」，走输入区上方独立入口，不在 send 链上
    if (loadBlock('qq', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    // 预览条还有待发图、输入框没文字：只发图（照原 flushPendingImages 口径）
    if (!text) {
      if (staged.length > 0) {
        // 发送提示音（纯图发送也走「发送消息」分类）
        playNotifySound('send');
        flushPendingImages();
      }
      return;
    }
    // 发送提示音（设置 › 通知可配；文字/组合/转语音共用的发送链入口）
    playNotifySound('send');
    // 组合发送：输入框有文字且预览条有待发图 → 文字消息在前、图片在后一起上屏+落盘，只触发一轮 AI 回复
    //（runAiTurnRef(textMsg, created)：上下文按消息数组顺序「文字在前图片在后」，识图收集本轮图片、
    // 请求附带文字取输入框原文；textMsg 已先行上屏 → runAiTurn 的 userMsg 入列按 id 幂等跳过）。
    // 组合时文字按普通文字消息发出（ttsSend 只对纯文字生效：语音气泡异步落屏会让图片/语音顺序颠倒，
    // 且语音消息会截断「从末尾向前收集连续图片」的识图窗口）
    if (staged.length > 0) {
      const textMsg: QQMsg = { id: uid(), role: 'me', content: text, time: Date.now(), quote: quote ?? undefined, unread: true };
      const created: QQMsg[] = staged.map((p) => ({ id: uid(), role: 'me', content: p.src, time: Date.now(), kind: 'image', unread: true }));
      // v40【复制链接→发给AI】同微信：粘贴 X 论坛帖子链接发送 → 文字后跟一张帖子分享卡 + 写记忆
      const linkPost = peer.id !== me.id ? resolveForumLinkPost(text) : null;
      const linkCard = linkPost ? buildForumShareCardMsg(linkPost) : null;
      if (linkPost) void noteForumLinkSharedToChat({ idp: 'qq', contactId: peer.id, post: linkPost });
      pendingImgsRef.current = [];
      setPendingImgs([]);
      setInput('');
      clearChatDraft('qq', peer.id); // Task 40 草稿箱：发送成功清空草稿
      setQuote(null);
      // 显示设置 › 已读回执：append 时把 TA 的未读全部转已读；我的新消息已带 unread: true
      for (const msg of [textMsg, ...(linkCard ? [linkCard] : []), ...created]) setMsgs((prev) => [...qqMarkPeerRead(prev), msg]);
      // 给自己发消息：只记录，不触发 AI 回复，也不计密友值
      if (peer.id === me.id) return;
      // 对方正在回复（流式接收或连发投递未清空）：文字+图片整批走排队补跑口径（与单发文字/图片一致）。
      // #35：整批第一条作投递插入边界，旧回复落库时插到整批之前
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        markDeliverBoundary(sessionKey, textMsg.id);
        qqQueueAdd(peer.id);
        onToast('消息已发出，对方回完这轮就聊');
        return;
      }
      // 分句发送开启：整批入列不触发回复，等输入框为空再点一次「发送」统一触发
      if (sentenceSend) {
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
        return;
      }
      runAiTurnRef.current?.(textMsg, linkCard ? [linkCard, ...created] : created);
      return;
    }
    // 文字转语音发送：合成语音气泡（transcript 带原文，AI 直接读得到内容）；失败只 toast 不发文字
    if (ttsSend) {
      sendTextAsVoiceRef.current(text);
      return;
    }
    const userMsg: QQMsg = { id: uid(), role: 'me', content: text, time: Date.now(), quote: quote ?? undefined, unread: true };
    // v40【复制链接→发给AI】同微信：粘贴 X 论坛帖子链接发送 → 文字后跟一张帖子分享卡
    //（AI 回合读卡即知帖子正文与热门评论，并异步写一条「TA把帖子链接发给了我」记忆）
    const linkPost = peer.id !== me.id ? resolveForumLinkPost(text) : null;
    const linkCard = linkPost ? buildForumShareCardMsg(linkPost) : null;
    if (linkPost) void noteForumLinkSharedToChat({ idp: 'qq', contactId: peer.id, post: linkPost });
    const outbound = [userMsg, ...(linkCard ? [linkCard] : [])];
    // 对方正在回复（流式接收或连发投递未清空，投递可拖到流结束后数秒）：消息照常入列并排队，
    // 「流收尾且投递完毕」后自动补跑回复——不再静默丢弃（旧版直接 return：消息滞留输入框，
    // 看起来像「发了消息没人理」，AI 下一轮自然接不上话）。投递中也排队：否则旧回复尾部
    // 进不了新回合上下文，旧 AI 气泡还会倒挂在用户新消息下面。
    // #35：标记投递插入边界——上一轮还在队列里的回复落库时插到这条新消息之前（时序归属上一轮）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      setInput('');
      clearChatDraft('qq', peer.id); // Task 40 草稿箱：消息已入列即清草稿（重进不回显）
      setQuote(null);
      setMsgs((prev) => [...qqMarkPeerRead(prev), ...outbound]);
      markDeliverBoundary(sessionKey, userMsg.id);
      qqQueueAdd(peer.id);
      // 37-a：按钮流式中不再禁用，排队补跑统一给 toast 反馈（消息已上屏但回复要等上一轮走完）
      onToast('消息已发出，对方回完这轮就聊');
      return;
    }
    setInput('');
    clearChatDraft('qq', peer.id); // Task 40 草稿箱：发送成功清空草稿
    setQuote(null);
    // 给自己发消息：只记录，不触发 AI 回复，也不计密友值
    if (peer.id === me.id) {
      setMsgs((prev) => [...qqMarkPeerRead(prev), ...outbound]);
      return;
    }
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setMsgs((prev) => [...qqMarkPeerRead(prev), ...outbound]);
      setPendingDispatch(true);
      markPendingBatch(sessionKey, true);
      return;
    }
    // 拉黑方向修正：用户说「我要拉黑你」类明确宣言 → 系统直接执行「用户拉黑对方」
    //（此前 AI 会误解成让它拉黑用户，方向反了；现在系统代为执行，AI 回合守卫自动转
    // 「仅申请解除拉黑」口径，AI 按人设反应；拉黑跃迁同时触发跨 App 找人/来电钩子）
    if (peer.id !== me.id && isUserBlockIntent(userMsg.content) && !loadBlock('qq', peer.id).byUser) {
      setBlk(setUserBlock('qq', peer.id, true));
      onToast(`已将「${peer.name}」加入黑名单`);
      const blkSys = { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `你已拉黑「${peer.name}」` } } as unknown as QQMsg;
      setMsgs((prev) => (prev.some((m) => m.id === userMsg.id) ? [...prev, blkSys] : [...prev, ...outbound, blkSys]));
      runAiTurn(userMsg, linkCard ? [linkCard] : undefined);
      return;
    }
    setMsgs((prev) => [...qqMarkPeerRead(prev), ...outbound]);
    // Task 49 定时提醒：用户消息像「定时发消息」指令时先解析（LLM 两级兜底；正则闸未命中零开销）；
    // 落任务后：聊天里落灰色系统行（确定性反馈）+ 本轮 sysEvent 带确认提示（AI 自然确认）
    if (reminderHintHit(userMsg.content)) {
      const label = await parseReminderInstruction('qq', peer.id, userMsg.content);
      if (label) {
        const sys = buildReminderSysMsg('qq', label) as unknown as QQMsg;
        saveMsgs(peer.id, appendWithBoundary(sessionKey, loadMsgs(peer.id), sys));
        setMsgs((prev) => (prev.some((m) => m.id === sys.id) ? prev : [...prev, sys]));
        runAiTurn(userMsg, linkCard ? [linkCard] : undefined, reminderSysHint(label));
        return;
      }
    }
    runAiTurn(userMsg, linkCard ? [linkCard] : undefined);
  }, [flushPendingImages, input, me.id, peer.id, runAiTurn, sessionKey, sentenceSend, quote, ttsSend]);

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」）；
   *  连发投递未清空时同样不开新回合（与流式中的口径一致：等上一轮投递完毕再点一次） */
  const dispatchBatch = useCallback(() => {
    if (!pendingDispatch || isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    runAiTurn(null);
  }, [pendingDispatch, runAiTurn, sessionKey]);

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字 ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音只有 dataURL） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[]; localText?: string };

  /** 语音消息落库：入列 → 直发语音先自动转写（AI 读内容）再触发回复；已有转写直接触发；
   *  presetTranscript = 文字转语音/划转文字/Web Speech 实时结果；selfChat 只记录；回复中排队补跑 */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后语音消息也不能发（按住说话/文字转语音/划转文字共用本入口）
      if (loadBlock('qq', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      const hasText = typeof presetTranscript === 'string' && presetTranscript.trim().length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, stt: 'pending' };
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'voice', voice, unread: true };
      setMsgs((prev) => [...qqMarkPeerRead(prev), msg]);
      // 给自己发消息（「我」详情页入口）：只记录，不触发 AI 回复
      if (peer.id === me.id) return;
      /** 触发 AI 回复（对方正在回复——流式或连发投递中——则排队补跑）；转写完成后再触发，AI 才能读到语音内容 */
      const kickTurn = () => {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          markDeliverBoundary(sessionKey, msg.id); // #35：语音消息也作插入边界，旧回复落库时插到它前面
          qqQueueAdd(peer.id); // 对方正在回复：本轮「流收尾且投递完毕」后自动补跑
          return;
        }
        window.setTimeout(() => runAiTurnRef.current?.(null), 80);
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
        window.setTimeout(kickTurn, 150); // 等重渲染 + runAiTurnRef 回填新闭包（含转写文本）
      });
    },
    [me.id, peer.id, sessionKey],
  );

  /** 「划到转文字」松开后：先识别再预览，由用户决定发送文字 / 发送语音（原始录音）/ 取消 */
  const sttPreview = useSttPreview({
    onSendText: (text) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后不能发送
      if (loadBlock('qq', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      const userMsg: QQMsg = { id: uid(), role: 'me', content: text, time: Date.now(), unread: true };
      if (peer.id === me.id) {
        setMsgs((prev) => [...qqMarkPeerRead(prev), userMsg]);
        return;
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        setMsgs((prev) => [...qqMarkPeerRead(prev), userMsg]);
        markDeliverBoundary(sessionKey, userMsg.id); // #35
        qqQueueAdd(peer.id);
        return;
      }
      if (sentenceSend) {
        setMsgs((prev) => [...qqMarkPeerRead(prev), userMsg]);
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
        return;
      }
      setMsgs((prev) => [...qqMarkPeerRead(prev), userMsg]);
      runAiTurnRef.current?.(userMsg);
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
    [commitVoiceMsg, me.id, onToast, peer.id, sessionKey, sttPreview.open],
  );

  const rec = useVoiceRecorder({ onResult: handleVoiceOutcome, onStartError: (m) => onToast(m) });

  /** 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）；失败只 toast，不当聊天内容 */
  const sendTextAsVoice = useCallback(
    (text: string) => {
      setInput('');
      clearChatDraft('qq', peer.id); // Task 40 草稿箱：转语音发送同样清空草稿
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => onToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, onToast, peer.id],
  );
  sendTextAsVoiceRef.current = sendTextAsVoice;

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成 ----------------

  /** 消息的可复制/引用文本快照（表情/图片/文字图片卡片/语音/位置/卡片/转发都有占位描述） */
  const quoteContentOf = (m: QQMsg): string =>
    m.kind === 'sticker'
      ? m.stk?.meaning
        ? `[表情] ${m.stk.meaning}`
        : '[表情]'
      : m.kind === 'image'
        ? '[图片]'
        : m.kind === 'textcard'
          ? m.card?.text
            ? `[文字图片] ${m.card.text}`
            : '[文字图片]'
          : m.kind === 'voice'
          ? m.voice?.transcript
            ? `[语音] ${m.voice.transcript}`
            : '[语音]'
          : m.kind === 'location'
            ? `[位置] ${m.loc?.name ?? ''}`
            : m.kind === 'song' && m.song
              ? `[歌曲]《${m.song.name}》${m.song.artist}`
              : m.kind === 'redpacket' && m.packet
              ? `[红包] ¥${m.packet.amount} ${m.packet.note}`
              : m.kind === 'transfer' && m.packet
                ? `[转账] ¥${m.packet.amount}${m.packet.note ? ` ${m.packet.note}` : ''}`
                : m.kind === 'family' && m.fam
                  ? '[亲属卡]'
                  : m.kind === 'forward'
                    ? m.fwd?.merged
                      ? `[聊天记录] ${m.fwd.title ?? m.content}`
                      : `[转发] ${m.content}`
                    : m.content;

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: QQMsg): boolean => m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（我的/AI 气泡都可：转文字(语音) 复制 删除 编辑 引用 多选 撤回 转发 收藏；图片多保存，AI 图片多重新生成图片（自填描述）；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: QQMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const isVoice = m.kind === 'voice';
    const isImage = m.kind === 'image';
    const isFrLocked = m.fr === 'apply' || m.fr === 'greet'; // 好友验证消息永久保留：禁删除/撤回/编辑/引用/重新生成
    const items: BubbleMenuItem[] = [];
    // 语音消息首项「转文字」/「取消转文字」（toggle：已转写→取消收起；未转写→识别；失败可重试）
    if (isVoice) items.push({ key: 'stt', label: m.voice?.stt === 'done' && m.voice.transcript ? '取消转文字' : '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    // Task 32 表情包收藏：长按表情气泡 →「添加」（收藏进「我的表情」默认分组）；
    // 同图已在收藏里 → 显示「已添加」（filled 填色态，点击只提示不重复入库）
    if (m.kind === 'sticker' && m.stk?.url) {
      const saved = loadStickers('qq').some((s) => s.url === m.stk!.url);
      items.push({ key: 'addsticker', label: saved ? '已添加' : '添加', icon: B.addsticker, filled: saved });
    }
    // 图片消息：保存到设备（dataURL 直接下载；QQ 图片 dataURL 存 content）
    if (isImage && m.content) items.push({ key: 'saveimg', label: '保存', icon: B.save });
    if (!isFrLocked) items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if ((isText || isVoice) && !isFrLocked) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    // 引用（Task 30 扩展）：文字之外，图片/表情/语音/文字图片/位置/歌曲也能引用——
    // QQ 引用卡按源消息类型显示迷你缩略图/语音图标（无源时退回文字占位，quoteContentOf 兜底）
    const isQuotable = isText || isVoice || isImage || m.kind === 'sticker' || m.kind === 'textcard' || m.kind === 'location' || m.kind === 'song';
    if (isQuotable && !isFrLocked) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    if (!isFrLocked) items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('qq', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('qq', m.id) });
    if (m.role === 'peer' && !isFrLocked) {
      // AI 图片：重新生成图片（自填描述，原地替换）替代整轮重答；文字气泡保留原「重新生成」
      if (isImage) items.push({ key: 'regenimg', label: '重新生成', icon: B.regenimg });
      else items.push({ key: 'regen', label: '重新生成', icon: B.regen });
    } else if (isImage && m.img?.fromCard) {
      // 「文字图片卡片转出的图片」（我的）：重新生成（自填描述，原地替换，不带锁脸）
      items.push({ key: 'regenimg', label: '重新生成', icon: B.regenimg });
    }
    // G2 恢复上一张：重新生成替换前的旧图还留着（prevSrc），长按可换回（再操作一次又换回新图，可来回切换）
    if (isImage && m.img?.prevSrc) items.push({ key: 'restoreimg', label: '恢复上一张', icon: B.recall });
    return items;
  };

  /** 气泡长按手势（fire 里用 data-mid 反查消息；多选模式下不弹菜单改为点选勾选） */
  const bubblePress = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || !isSelectable(msg)) return;
    const items = buildMsgMenuItems(msg);
    if (items.length === 0) return;
    setMsgMenu({ msg, pos: (liquid ? computeBubbleMenuPosLiquid : computeBubbleMenuPos)(el.getBoundingClientRect(), pageRef.current?.getBoundingClientRect() ?? null, items.length) });
  }, !selectMode);

  // ---------------- 拍一拍（Task 30：双击聊天里两侧头像触发；AI 侧由 [拍一拍:文案] 标记发起） ----------------

  /** 对方头像单/双击分流计时器（单击开状态卡延迟 260ms 等待可能的双击；双击拍一拍时取消） */
  const peerAvatarTapRef = useRef<number | null>(null);

  /** 拍一拍：系统行落盘（我拍对方/拍自己，带我在 QQ 设置›头像双击动作里设置的拍一拍文案后缀）+ 触发 AI 回合——
   *  AI 从上下文得知被拍/我拍了拍自己与文案（人设决定怎么反应，也可以用 [拍一拍:文案] 拍回来）。
   *  对方正在回复时不触发回合：拍一拍行照常落盘，下一轮上下文自然带上 */
  const patPeer = (self = false) => {
    const clap = readQqClapText();
    const msg: QQMsg = {
      id: uid(),
      role: 'me',
      content: '',
      time: Date.now(),
      kind: 'sys',
      sys: {
        text: self ? `你拍了拍自己${clap}` : `你拍了拍「${peer.name}」${clap}`,
        pat: { by: 'me', ...(self ? { self: true } : {}), ...(clap ? { text: clap } : {}) },
      },
    };
    setMsgs((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
    saveMsgs(peer.id, [...loadMsgs(peer.id), msg]); // 立即落盘：AI 回合管线与 finalize 合并都能读到
    if (!isChatStreaming(sessionKey) && !isAiDelivering(sessionKey)) {
      window.setTimeout(() => runAiTurnRef.current?.(null, [msg]), 80);
    }
  };

  /** 双击头像统一入口：e.detail >= 2 = 拍一拍；返回 true 表示已按双击处理（调用方跳过单击行为） */
  const onAvatarDoubleTap = (e: { detail: number }, self = false): boolean => {
    if (e.detail < 2) return false;
    patPeer(self);
    return true;
  };

  /** 退出多选模式（同时退出转发流程） */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setFwdFlow(null);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 收藏项快照（单条收藏/批量收藏共用；msgId 用于「每条消息只能收藏一次」去重） */
  const favOf = (m: QQMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: peer.id,
    contactName: peer.name,
    contactAvatar: peer.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: quoteContentOf(m),
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.content : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成：删除该条 AI 回复所在轮次及其后的全部消息（包括我又发出去的消息），
   *  以剩余历史重新发起请求（回复条数按本会话设置重新连发）；任意历史 AI 气泡都可触发。
   *  连发投递中也拒绝：旧回复尾巴还在队列里逐条落盘，此刻截断会把队列尾部拽进新轮上下文 */
  const regenerate = (m: QQMsg) => {
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
      return;
    }
    const idx = msgs.findIndex((x) => x.id === m.id);
    if (idx < 0) return;
    let lastUser = -1;
    for (let k = Math.min(idx, msgs.length - 1); k >= 0; k--) {
      if (msgs[k].role === 'me') {
        lastUser = k;
        break;
      }
    }
    const kept = lastUser >= 0 ? msgs.slice(0, lastUser + 1) : [];
    setMsgs(kept);
    saveMsgs(peer.id, kept); // 立即落盘，避免 finalize 合并时把已删回复带回来
    window.setTimeout(() => runAiTurnRef.current?.(null, [], undefined, kept), 80);
  };

  /** 转发克隆：文本 → 转发卡片；表情/图片/位置 → 同类型消息（新 id、role=me、保留引用）；
   *  合并卡片原样保留记录；红包/转账等卡片消息 → 占位文本卡片（不克隆活卡，不动资金）；
   *  淘宝订单分享卡（tbshare）→ 活卡克隆（渲染按 sid 实时读订单状态）；
   *  淘宝代付请求卡（tbpay）→ 走 forwardTbPayClone 异步转活卡（新建/复用代付请求），终态/转发给自己时回退占位文案 */
  const forwardClone = (m: QQMsg): QQMsg => {
    const id = uid();
    if (m.fwd?.merged) return { id, role: 'me', content: m.content, time: Date.now(), kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { id, role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image') return { id, role: 'me', content: m.content, time: Date.now(), kind: 'image', ...(m.img ? { img: m.img } : {}) };
    if (m.kind === 'location' && m.loc) return { id, role: 'me', content: '', time: Date.now(), kind: 'location', loc: { ...m.loc } };
    // 歌曲卡片可转发（同类型卡片新 id；autoPlay/invite 不随转发保留）
    if (m.kind === 'song' && m.song) return { id, role: 'me', content: `[歌曲]《${m.song.name}》${m.song.artist}`, time: Date.now(), kind: 'song', song: { name: m.song.name, artist: m.song.artist, cover: m.song.cover, songId: m.song.songId } };
    // 语音消息整条克隆（含音频 dataURL），目标会话里照常可播放
    if (m.kind === 'voice' && m.voice) return { id, role: 'me', content: '', time: Date.now(), kind: 'voice', voice: { ...m.voice } };
    // 淘宝订单分享卡：活卡克隆（同 sid 新 id，状态时间线在目标会话里照常实时跟订单走）
    if (m.kind === 'tbshare' && m.tbshare) return { id, role: 'me', content: m.content, time: Date.now(), kind: 'tbshare', tbshare: { sid: m.tbshare.sid } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'textcard' || m.kind === 'tbpay';
    return { id, role: 'me', content: isCard ? quoteContentOf(m) : m.content, time: Date.now(), kind: 'forward', fwd: { from: peer.name }, quote: m.quote };
  };

  /** 淘宝代付请求卡转发（活卡）：tbReshareProxy 为目标好友新建/复用代付请求（投递请求卡 + 调度 AI 决策），
   *  deferCard 模式把新卡随转发批次落盘（防 insertCard 与 saveMsgs 重复投递）。
   *  返回 null = 非待付请求卡/请求已终态/目标是自己 → 回退 forwardClone 占位文案卡 */
  const forwardTbPayClone = async (m: QQMsg, target: FwdSheetTarget): Promise<QQMsg | null> => {
    const p = m.tbpay ? tbGetProxy(m.tbpay.pid) : null;
    if (!m.tbpay || m.tbpay.role !== 'req' || !p || p.direction === 'me' || p.status !== 'pending' || target.self) return null;
    try {
      const res = await tbReshareProxy(p.id, 'qq', target.id, undefined, undefined, me.name, me.avatar, { deferCard: true });
      if (!res.ok) return null;
      return { id: uid(), role: 'me', content: res.card.content, time: Date.now(), kind: 'tbpay', tbpay: { pid: res.pid, role: 'req' } };
    } catch {
      return null;
    }
  };

  /** 转发目标：QQ 好友（排除当前会话）+ 自己 */
  const forwardTargets = useMemo(() => {
    const list = contacts.filter((c) => c.kind !== 'user' && c.id !== peer.id && isFriendIn(c, 'qq'));
    const self = contacts.find((c) => c.id === me.id);
    return self ? [self, ...list] : list;
  }, [contacts, peer.id, me.id]);


  /** 执行转发（逐条/合并）：写入目标会话存储 + 未读角标 + 给目标 AI 排感知事件（打开会话即触发 AI 回应）；
   *  淘宝代付请求卡逐条转发时异步转活卡（tbReshareProxy），其余消息同步克隆 */
  const doForward = async (mode: FwdMode, ids: string[], target: FwdSheetTarget): Promise<void> => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0 || target.id === peer.id) return;
    const nameOf = (m: QQMsg) => (m.role === 'me' ? me.name : peer.name);
    if (mode === 'each') {
      // 逐条转发：按时间顺序每条克隆成独立消息（tbpay 请求卡走活卡转发，失败回退占位文案）
      const clones: QQMsg[] = [];
      for (const m of list) {
        const live = m.kind === 'tbpay' && m.tbpay ? await forwardTbPayClone(m, target) : null;
        clones.push(live ?? forwardClone(m));
      }
      saveMsgs(target.id, [...loadMsgs(target.id), ...clones]);
    } else {
      // 合并转发：合成一张「聊天记录」卡片（标题 = 我与对方，内嵌逐条对话，点击可看全文）
      const title = fwdRecordTitle(me.name, peer.name);
      const card: QQMsg = {
        id: uid(),
        role: 'me',
        content: title,
        time: Date.now(),
        kind: 'forward',
        fwd: {
          from: peer.name,
          merged: true,
          title,
          records: list.map((m) => ({
            name: nameOf(m),
            role: m.role,
            text: quoteContentOf(m),
            quote: m.quote ? `${m.quote.name}：${m.quote.content}` : undefined,
            time: m.time,
            // 记录快照自带头像：定格转发时原说话人的头像，详情页不会错拿转发目标会话的头像
            avatar: m.role === 'me' ? me.avatar : peer.avatar,
            // 富媒体快照：表情包/图片在详情页显示原图；红包/转账/亲属卡/位置只显示文字
            kind: m.kind === 'sticker' ? ('sticker' as const) : m.kind === 'image' ? ('image' as const) : ('text' as const),
            imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.content : undefined,
            stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
          })),
        },
      };
      saveMsgs(target.id, [...loadMsgs(target.id), card]);
    }
    // 逐条转发 N 条 → 角标 +N；合并转发是 1 张卡片 → 角标 +1
    qqUnreads.bump(target.id, mode === 'each' ? list.length : 1);
    if (target.id !== me.id) {
      const lines = list.slice(-8).map((m) => `${nameOf(m)}：${quoteContentOf(m)}`).join(' ／ ').slice(0, 240);
      pushAiEvent(
        target.id,
        `（系统事件：用户把来自「${peer.name}」聊天记录的 ${list.length} 条消息${mode === 'merge' ? '合并转发' : '逐条转发'}给你了：${lines}。请用符合人设的一两句话自然回应这条转发。）`
      );
    }
    setFwdFlow(null);
    exitSelect();
    onToast(target.id === me.id ? '已转发给自己' : `已转发给 ${target.name}`);
  };

  /** 长按菜单动作分发（执行后关闭菜单） */
  const handleMenuAction = (key: string) => {
    const m = msgMenu?.msg ?? null;
    setMsgMenu(null);
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
        if (!v.url && v.localText) {
          const local = v.localText;
          setMsgs((prev) =>
            prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: local, stt: 'done' as const } } : x)),
          );
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
            setMsgs((prev) =>
              prev.map((x) => (x.id === m.id && x.voice ? { ...x, voice: { ...x.voice, transcript: text, stt: 'done' as const } } : x)),
            );
            onToast('已转文字');
          } catch {
            onToast('转文字失败，请重试');
          }
        })();
        break;
      }
      case 'copy':
        copyTextWithToast(quoteContentOf(m), onToast);
        break;
      case 'addsticker': {
        // Task 32 长按表情包 → 添加到「我的表情」（默认分组）：同图已收藏只提示不重复入库；
        // 入库后广播 qq-stickers-changed（表情面板若开着立即刷新，关着下次打开现读）
        if (m.kind !== 'sticker' || !m.stk?.url) break;
        const cur = loadStickers('qq');
        if (cur.some((s) => s.url === m.stk!.url)) {
          onToast('已在「我的表情」');
          break;
        }
        saveStickers('qq', [
          ...cur,
          { id: newStickerId(), url: m.stk.url, meaning: m.stk.meaning ?? '', groupId: DEFAULT_STICKER_GROUP_ID, createdAt: Date.now() },
        ]);
        window.dispatchEvent(new CustomEvent('qq-stickers-changed'));
        onToast('已添加到我的表情');
        break;
      }
      case 'del': {
        // A-4：投递进行中同样拒绝——投递 tick 的 loadMsgs 读旧存储会把被删消息合并回来落盘（消息复活）
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        // 一.5 引用联动：被删消息若被其他消息引用，引用内容改写为「原消息已删除」
        const gone = new Set([m.id]);
        setMsgs((prev) =>
          prev
            .filter((x) => !gone.has(x.id))
            .map((x) => (x.quote?.id && gone.has(x.quote.id) ? { ...x, quote: { ...x.quote, content: '原消息已删除' } } : x))
        );
        onToast('已删除');
        break;
      }
      case 'edit':
        // 语音消息编辑转写/朗读文本；文字消息编辑正文
        setEditMsg(m);
        setEditDraft(m.kind === 'voice' ? m.voice?.transcript ?? m.voice?.localText ?? '' : m.content);
        break;
      case 'quote':
        // id 带上源消息：删除/撤回后引用显示「原消息已删除」；time 供 QQ 引用卡显示时间
        setQuote({ name: m.role === 'me' ? me.name : peer.name, content: quoteContentOf(m), id: m.id, time: m.time });
        break;
      case 'multi':
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        // A-4：投递进行中同样拒绝（同删除：避免投递 tick 把撤回前的内容合并回来）
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        // 二.3：不删原始记录（标记 recalled 渲染居中灰字）；引用联动改写（原内容不再可见）
        setMsgs((prev) =>
          prev.map((x) => {
            if (x.id === m.id) return { ...x, recalled: true };
            if (x.quote?.id && x.quote.id === m.id && !x.recalled) return { ...x, quote: { ...x.quote, content: '原消息已删除' } };
            return x;
          })
        );
        onToast('已撤回');
        // #17 撤回级联撤记忆：该消息若已被提取成记忆碎片，一并清掉（AI 不再引用已撤回内容；异步不阻塞主流程）
        void memPurgeMessageSources(peer.id, m.id);
        break;
      }
      case 'forward':
        // 转发 → 进入聊天内多选勾选（该条预选）；点底栏「分享」图标后才弹出 逐条/合并 转发方式
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
      case 'saveimg': {
        // 图片保存到设备：dataURL 直接以 <a download> 触发下载（QQ 图片 dataURL 存 content）
        const src = m.kind === 'image' ? m.content : '';
        if (src && downloadImageSrc(src)) onToast('已保存到设备');
        else onToast('保存失败');
        break;
      }
      case 'regenimg': {
        // 重新生成图片：未配置生图时提示；否则打开描述编辑弹层（预填原图描述）
        const cfg = useSettings.getState().imgGenConfig;
        if (!cfg.enabled || !imgGenConfigReady(cfg)) {
          onToast('请先在 设置 › 图像生成 完成配置');
          break;
        }
        setRegenImgDesc(m.img?.desc ?? '');
        setRegenImgError('');
        setRegenImgId(m.id);
        break;
      }
      case 'restoreimg': {
        // G2 恢复上一张：当前图与重新生成前的旧图互换（当前 src 存回 prevSrc，可反复换回）；
        // QQ 图片 dataURL 存 content，交换时同步更新（QqImageBubble 读 m.content）
        setMsgs((prev) =>
          prev.map((x) =>
            x.id === m.id && x.kind === 'image' && x.img?.src && x.img.prevSrc
              ? { ...x, content: x.img.prevSrc, img: { ...x.img, src: x.img.prevSrc, prevSrc: x.img.src } }
              : x,
          ),
        );
        onToast('已恢复上一张');
        break;
      }
    }
  };

  /** 重新生成图片提交：按（可编辑的）描述重生成，成功后原地替换该条消息的图片（content 与 img.src 同步更新，自动落盘）；
   *  AI 图片按角色形象锁脸；「文字图片卡片转出的图片」不带锁脸（与首图同口径） */
  const submitImgRegen = async () => {
    const target = regenImgId ? msgs.find((x) => x.id === regenImgId && x.kind === 'image' && (x.role === 'peer' || x.img?.fromCard)) : null;
    // G1：描述 trim 后截 400（与 generateCardImage/imggen 照片标签正则同口径）
    const desc = regenImgDesc.trim().slice(0, 400);
    if (!target || !desc || regenImgBusy) return;
    setRegenImgBusy(true);
    setRegenImgError('');
    try {
      const cfg = useSettings.getState().imgGenConfig;
      const r =
        target.role === 'peer'
          ? await generateCharacterPhoto({ cfg, contactId: peer.id, desc, charName: peer.name, useRef: true })
          : await generateCharacterPhoto({ cfg, contactId: '', desc, charName: '文字图片', useRef: false });
      // B2 挂点：AI 图重新生成成功 → 入角色相册（追加式，相册保留历史版本）；我的卡片转图不加
      if (target.role === 'peer') void addAlbum(peer.id, r.src, { desc, origin: 'ai' });
      // 替换时把旧图存进 prevSrc（G2「恢复上一张」：长按菜单换回，可来回切换）；
      // QQ 图片 dataURL 存 content，img.src 同步更新（desc 同步，fromCard/prevSrc 标记展开保留）
      setMsgs((prev) =>
        prev.map((x) => (x.id === target.id && x.kind === 'image' ? { ...x, content: r.src, img: { ...x.img, src: r.src, desc, prevSrc: x.img?.src } } : x)),
      );
      setRegenImgId(null);
      onToast('已重新生成图片');
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
      onToast('内容不能为空');
      return;
    }
    // A-4：投递进行中同样拒绝（编辑写入的内容会被投递 tick 用旧存储覆盖回去）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
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
      onToast('已修改');
      return;
    }
    setMsgs((prev) => prev.map((x) => (x.id === editMsg.id ? { ...x, content: t } : x)));
    setEditMsg(null);
    onToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    // A-4：投递进行中同样拒绝（同删除：避免投递 tick 读旧存储把被删消息合并回来）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      onToast('对方正在回复，请稍后再试');
      return;
    }
    const ids = new Set(selectedIds);
    // 一.5：批量删除同样触发引用联动（被删消息被引用时改写为「原消息已删除」）
    setMsgs((prev) =>
      prev
        .filter((x) => !ids.has(x.id))
        .map((x) => (x.quote?.id && ids.has(x.quote.id) ? { ...x, quote: { ...x.quote, content: '原消息已删除' } } : x))
    );
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

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次；自己会话除外；37-a 去掉流式禁用） */
  const canDispatch = sentenceSend && pendingDispatch && peer.id !== me.id;

  // 发送表情消息（表情面板点选；AI 通过 stk.meaning 理解表情含义并据此回复）。
  // #35：对方正在回复（流式/连发投递）时与文字发送同一口径——消息入列并排队补跑，
  // 不再直接开新回合（旧回复尾巴会漏出上下文 + 表情气泡在流中会被回滚消失）
  const sendSticker = useCallback(
    (st: Sticker) => {
      setStickerOpen(false);
      setPlusOpen(false);
      // 40-a 拉黑拦截：被角色拉黑（byChar）后表情也发不出
      if (loadBlock('qq', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      // 发送提示音（表情也走「发送消息」分类）
      playNotifySound('send');
      const msg: QQMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: st.url, meaning: st.meaning }, unread: true };
      if (peer.id === me.id) {
        setMsgs((prev) => [...qqMarkPeerRead(prev), msg]);
        return;
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        setMsgs((prev) => [...qqMarkPeerRead(prev), msg]);
        markDeliverBoundary(sessionKey, msg.id);
        qqQueueAdd(peer.id);
        onToast('表情已发出，对方回完这轮就聊');
        return;
      }
      void runAiTurn(msg);
    },
    [me.id, peer.id, runAiTurn, sessionKey, onToast]
  );

  /** 内置表情插入输入框（不直接发送）：真实表情图插到光标处，可与文字混排一起发送（真机 QQ 交互） */
  const insertBuiltinEmoji = (s: Sticker) => {
    richInputRef.current?.insertEmoji(s.meaning, s.url);
  };

  // 加号面板宫格（语音通话/视频通话/红包/转账/位置/文字图片；图片入口已移除）。
  // 第五十八轮：每项携带 retroIcon（RtPlus* 古早实心剪影，古早主题时 QqPlusGrid 选用）
  const plusAllItems: Array<{ key: string; label: string; color: string; icon: React.ReactNode; retroIcon?: React.ReactNode; onClick: () => void }> = [
    {
      key: 'call',
      label: '语音通话',
      color: '#2FBF71',
      icon: <Phone className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusVoice />,
      onClick: () => {
        setPlusOpen(false);
        openVoiceCall('out');
      },
    },
    {
      // Task 22 视频通话：入口接通（原来 toast「暂未开放」）——发起全局视频通话
      key: 'video',
      label: '视频通话',
      color: '#1B9FF0',
      icon: <Video className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusVideo />,
      onClick: () => {
        setPlusOpen(false);
        openVoiceCall('out', { media: 'video' });
      },
    },
    {
      key: 'rp',
      label: '红包',
      color: '#F5455C',
      icon: <RpIcon className="h-[26px] w-[26px]" />,
      retroIcon: <RtPlusRedPacket />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'redpacket' });
      },
    },
    {
      key: 'transfer',
      label: '转账',
      color: '#12B7F5',
      icon: <ArrowLeftRight className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusTransfer />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'transfer' });
      },
    },
    {
      key: 'loc',
      label: '位置',
      color: '#F0605C',
      icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusLocation />,
      onClick: () => {
        setPlusOpen(false);
        setLayer({ view: 'location' });
      },
    },
    {
      key: 'textcard',
      label: '文字图片',
      color: '#0099FF',
      icon: <Sparkles className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusTextCard />,
      onClick: () => {
        // 文字图片（Task 13 卡片版，无生图依赖）：AI 按人设+聊天记录代笔或用户代写，以卡片消息发到聊天
        setPlusOpen(false);
        setStickerOpen(false);
        setCardError('');
        setLayer({ view: 'textcard' });
      },
    },
    {
      // 一起听（第二十四轮）：选一首歌，以邀请卡发进聊天，AI 接受后双方发同意卡并开始一起听
      key: 'together',
      label: '一起听',
      color: '#EC4141',
      icon: <Headphones className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusTogether />,
      onClick: () => {
        setPlusOpen(false);
        if (peer.kind !== 'char') {
          onToast('只有 AI 好友可以一起听');
          return;
        }
        setTgPickOpen(true);
      },
    },
    {
      // 快递（第七十一轮）：加号面板「快递」入口——列出已确认收货的淘宝订单，可分享给当前聊天好友
      key: 'express',
      label: '快递',
      color: '#FF6A1E',
      icon: <Package className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      retroIcon: <RtPlusExpress />,
      onClick: () => {
        setPlusOpen(false);
        setStickerOpen(false);
        setLayer({ view: 'express' });
      },
    },
  ];
  // 输入框上方快捷功能（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面，
  // 点一下直接触发（与点加号面板里那一项同一条 onClick）；未添加 = 不显示；「+」面板本身不受影响。
  // 图标/文案用 QQ_QUICK_META；第五十八轮：古早主题选 retroIcon（RtPlus* 实心剪影，
  // 与加号面板同语言），默认/液态 = 现代线稿（液态在 lg-chip 玻璃胶囊内）；
  // 行为取 plusAllItems 同名项的 onClick（与面板点击完全等效）
  const quickItems: QuickBarItem[] = resolveQuickKeys('qq', chatDecorQq.quickKeys)
    .map((k): QuickBarItem | null => {
      const meta = QQ_QUICK_META[k];
      const panel = plusAllItems.find((it) => it.key === k);
      if (!meta || !panel) return null;
      return { key: k, label: meta.label, icon: retro ? meta.retroIcon : meta.icon, onClick: panel.onClick };
    })
    .filter((x): x is QuickBarItem => x !== null);

  // 聊天设置：置顶 / 免打扰 / 聊天背景 / 查找聊天记录

  const handlePickBgColor = useCallback(
    (c: string) => {
      qqChatFlagsStore.update(peer.id, { bgMode: 'color', bgColor: c, bgV: Date.now() });
    },
    [peer.id]
  );

  const handleResetBg = useCallback(() => {
    void removeChatBgImage('qq', peer.id).catch(() => undefined);
    qqChatFlagsStore.update(peer.id, { bgMode: 'default', bgV: Date.now() });
  }, [peer.id]);

  const handleUploadBg = useCallback(
    async (file: File) => {
      setUploadingBg(true);
      try {
        const data = await compressImageFile(file, 1280);
        if (!data) {
          onToast('图片处理失败，请重试');
          return;
        }
        await setChatBgImage('qq', peer.id, data);
        qqChatFlagsStore.update(peer.id, { bgMode: 'image', bgV: Date.now() });
        onToast('聊天背景已更新');
      } catch {
        onToast('图片处理失败，请重试');
      } finally {
        setUploadingBg(false);
      }
    },
    [peer.id, onToast]
  );

  /** 可搜索聊天记录：各类消息规整成文本摘要（图片消息的 content 是 dataURL，不入搜索） */
  const searchItems = useMemo<ChatSearchItem[]>(
    () =>
      msgs
        .filter((m) => m.kind !== 'image')
        .map((m) => ({
          id: m.id,
          role: m.role,
          text:
            m.kind === 'sticker' && m.stk
              ? m.stk.meaning
                ? `[表情] ${m.stk.meaning}`
                : '[表情]'
              : m.kind === 'redpacket' && m.packet
                ? `[QQ红包] ${m.packet.note}`
                : m.kind === 'transfer' && m.packet
                  ? `[转账] ${m.packet.note}`
                  : m.kind === 'family' && m.fam
                    ? `[亲属卡] 每月额度 ${m.fam.monthlyLimit} 元`
                    : m.kind === 'location' && m.loc
                    ? `[位置] ${m.loc.name}${m.loc.addr ? ` ${m.loc.addr}` : ''}`
                    : m.kind === 'notice' && m.notice
                      ? `${m.notice.pre}${m.notice.accent}`
                      : m.content,
          time: m.time,
        }))
        .filter((it) => it.text.trim().length > 0),
    [msgs]
  );

  /** 搜索结果定位：关闭搜索页与设置页 → 滚动到消息并短暂高亮。
   *  v71 分窗渲染兑底：目标消息若在未渲染的更早窗口里，先扩窗覆盖它再定位（双 rAF 等扩窗渲染提交） */
  const jumpToMessage = useCallback(
    (id: string) => {
      setSearchOpen(false);
      setSettingsOpen(false);
      setHighlightId(id);
      const idx = msgs.findIndex((m) => m.id === id);
      if (idx >= 0 && idx < winStart) setVisibleCount(Math.max(visibleCount, msgs.length - idx + 10));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(id)}"]`);
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      });
      window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000);
    },
    [msgs, winStart, visibleCount],
  );

  return (
    <div
      ref={pageRef}
      data-chat-css={qqCssKey}
      className={`relative flex h-full w-full flex-col overflow-hidden ${liquid ? 'lg-root' : retro ? 'rt-chat-bg' : 'bg-[#F5F6F7] dark:bg-[#111214]'}`}
      onPointerDown={onSwipeStart}
      onPointerMove={onSwipeMove}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onPointerUp={() => {
        swipe.current = null;
      }}
    >
      {/* v1.3 Shizuku：AI 使用技能 → 聊天界面正中的椭圆形胶囊浮层（pointer-events-none 不挡滑动返回等手势） */}
      <SkillUsePill pill={opPill.pill} />
      {/* 自定义 CSS（聊天作用域，按联系人隔离）：只影响本联系人的聊天页；前缀
          [data-phone-shell] [data-chat-css="qq:联系人ID"] 比全局多一级属性 → 特异性压制全局 */}
      {chatCustomCss?.trim() ? <style>{scopeCss(chatCustomCss, chatCssScopeSelector(qqCssKey))}</style> : null}
      {/* 正在输入三点跳动动画 + 面板上浮动画（qqPanelIn：加号面板/表情面板共用） */}
      <style>{'@keyframes qqTypingDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}@keyframes qqPanelIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
      {/* 聊天背景层（聊天设置页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 第四十七轮（用户指定「顶部会逐渐模糊」）：液态主题顶部渐变磨砂带——
          消息滚入顶栏下方被渐进模糊（顶缘全模糊 → 112px 处透明；不拦截交互，顶栏铭件浮于其上） */}
      {liquid && <div aria-hidden="true" data-testid="qq-chat-top-blur" className="lg-top-blur pointer-events-none absolute inset-x-0 top-0 z-[15] h-[112px]" />}
      {/* 顶栏：返回 + 名字/徽章/在线 + 企鹅 + 菜单（对照 QQ 真机；对方回复中名字变「正在输入中…」）。
          状态栏预留收进顶栏内（与顶栏同色同层）：自定义聊天背景不再透到状态栏区域（与微信聊天页同套结构）。
          液态玻璃主题（第四十六轮，用户指定）：顶栏完全透明悬浮（无背景遮罩/模糊带），名字纯文字不包裹胶囊
          （与微信区分：QQ 名字后不需要椭圆形包裹）；空白区 pointer-events-none 穿透点击（按钮经 [&_button]:pointer-events-auto 恢复），
          返回键/右上角菜单键各自单独用 lg-chip 椭圆包裹；消息区顶部让位 pt-[112px]（54+48+10 呼吸）。
          多选模式下变为「取消 + 已选计数」操作栏（保持原生样式） */}
      <div
        className={
          'qq-topbar ' +
          (liquid
            ? 'pointer-events-none absolute inset-x-0 top-0 z-20 shrink-0 bg-transparent pt-[54px]'
            : retro
            ? 'relative z-10 shrink-0 pt-[54px] rt-dark text-white [&_button]:text-white'
            : 'relative z-10 shrink-0 pt-[54px] bg-[#F5F6F7] dark:bg-[#111214]')
        }
      >
        {selectMode ? (
          fwdFlow === 'choose' ? (
            /* 转发勾选模式顶栏：取消 + 已选择计数（对照原生） */
            <div className="flex h-12 items-center gap-1 px-3 [&_button]:pointer-events-auto">
              <button type="button" data-testid="qq-select-cancel" onClick={exitSelect} className="-ml-1 rounded-full p-1.5 text-[15px] active:bg-black/5">
                取消
              </button>
              <div className="ml-1 min-w-0 flex-1">
                <span data-testid="qq-select-count" className="text-[17px] font-semibold leading-tight">已选择 {selectedIds.length} 条消息</span>
              </div>
            </div>
          ) : (
          <div className="flex h-12 items-center gap-1 px-3 [&_button]:pointer-events-auto">
            <button type="button" data-testid="qq-select-cancel" onClick={exitSelect} className="-ml-1 rounded-full p-1.5 text-[15px] active:bg-black/5">
              取消
            </button>
            <div className="ml-1 min-w-0 flex-1">
              <span data-testid="qq-select-count" className="text-[17px] font-semibold leading-tight">已选 {selectedIds.length} 条消息</span>
            </div>
          </div>
          )
        ) : (
        <div className="relative flex h-12 items-center gap-1 px-3 [&_button]:pointer-events-auto">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className={liquid ? 'lg-chip -ml-1 grid h-[36px] w-[36px] place-items-center rounded-full active:opacity-60' : '-ml-1 rounded-full p-1.5 active:bg-black/5'}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
        </button>
        {otherUnread > 0 && (
          <span
            data-testid="qq-chat-back-badge"
            aria-label={`${otherUnread} 条未读`}
          className={`-ml-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-[5px] text-[12px] font-medium leading-none ${
            retro ? 'bg-white/[0.14] text-white/85' : 'bg-black/[0.06] text-black/70 dark:bg-white/[0.14] dark:text-white/85'
          }`}
          >
            {otherUnread > 99 ? '99+' : otherUnread}
          </span>
        )}
        {/* 名字区（用户指定：「名字在屏幕中间，不是按钮中间」）：绝对定位 left-1/2 平移居中（同 IOSNavBar），
            左右按钮宽度不再影响名字位置；w-max 收缩到内容宽 + max-w 限长截断，绝不与两侧按钮重叠 */}
        <div className="absolute left-1/2 top-1/2 flex w-max max-w-[calc(100%-132px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          {liquid && liquidSkinQq.headerMode === 'dualName' ? (
            /* 液态·双头像+名字（本轮用户指定）：我的名字也显示——名字在各自头像下面（两列布局）；
               中间可插自定义文字；正在输入时中间显示「正在输入…」 */
            <div className="flex max-w-full items-center gap-1.5">
              <span
                data-testid="qq-chat-liquid-header"
                className="lg-title flex min-w-0 items-center gap-2 rounded-full py-[4px] pl-[7px] pr-[11px]"
              >
                <span className="flex w-[52px] shrink-0 flex-col items-center gap-[2px]">
                  <QqAvatar src={peer.avatar} alt={peer.name} size={24} />
                  <span className="max-w-[52px] truncate text-[9.5px] font-medium leading-none text-black/65 dark:text-white/70">
                    {peer.name}
                  </span>
                </span>
                {(streaming || delivering || liquidSkinQq.headerMiddleText.trim()) && (
                  <span className="max-w-[86px] truncate text-[12px] font-semibold text-black/70 dark:text-white/75">
                    {streaming || delivering ? '正在输入…' : liquidSkinQq.headerMiddleText.trim()}
                  </span>
                )}
                <span className="flex w-[52px] shrink-0 flex-col items-center gap-[2px]">
                  <QqAvatar src={me.avatar} alt={me.name} size={24} />
                  <span className="max-w-[52px] truncate text-[9.5px] font-medium leading-none text-black/65 dark:text-white/70">
                    {me.name}
                  </span>
                </span>
              </span>
              <CoupleMark contactId={peer.id} size={20} testId="qq-chat-couple-mark" />
              {flags.muted === true && (
                <BellOff
                  className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30"
                  strokeWidth={2}
                  aria-label="消息免打扰"
                />
              )}
            </div>
          ) : liquid && liquidSkinQq.headerMode !== 'text' ? (
            /* 液态玻璃皮肤：头像+名字（名字可关）/ 双头像+中间文字 */
            <div className="flex max-w-full items-center gap-1.5">
              <span
                data-testid="qq-chat-liquid-header"
                className="lg-title flex min-w-0 items-center gap-1.5 truncate rounded-full py-[4px] pl-[5px] pr-[12px] text-[15px] font-semibold"
              >
                <QqAvatar src={peer.avatar} alt={peer.name} size={26} />
                {(liquidSkinQq.headerMode === 'dual' || liquidSkinQq.headerMode === 'dualName') && (
                  <>
                    {liquidSkinQq.headerMiddleText.trim() && (
                      <span className="max-w-[86px] truncate text-[13px] font-semibold text-black/80 dark:text-white/85">
                        {liquidSkinQq.headerMiddleText.trim()}
                      </span>
                    )}
                    <QqAvatar src={me.avatar} alt={me.name} size={26} />
                  </>
                )}
                {liquidSkinQq.headerMode === 'avatarName' && liquidSkinQq.headerShowName ? (
                  <span className="truncate">{streaming || delivering ? '正在输入中…' : peer.name}</span>
                ) : null}
              </span>
              <CoupleMark contactId={peer.id} size={20} testId="qq-chat-couple-mark" />
              {flags.muted === true && (
                <BellOff
                  className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30"
                  strokeWidth={2}
                  aria-label="消息免打扰"
                />
              )}
            </div>
          ) : (
          <div className="flex max-w-full min-w-0 items-center gap-1.5">
            <span
              data-testid="qq-chat-title"
              className={`truncate text-[17px] font-semibold leading-tight ${
                streaming || delivering ? (retro ? 'text-white/45' : 'text-black/45 dark:text-white/45') : ''
              }`}
            >
              {streaming || delivering ? '正在输入中…' : peer.name}
            </span>
            {/* 情侣空间标识（第九/十轮）：开通情侣空间后名字后的徽章+钥匙（用户素材图），解除后即时消失 */}
            <CoupleMark contactId={peer.id} size={20} testId="qq-chat-couple-mark" />
            {flags.muted === true && (
              <BellOff
                className={`h-4 w-4 shrink-0 ${retro ? 'text-white/60' : 'text-black/30 dark:text-white/30'}`}
                strokeWidth={2}
                aria-label="消息免打扰"
              />
            )}
          </div>
          )}
          <button
            type="button"
            onClick={() => onToast('在线状态暂未开放')}
            className="flex items-center gap-1 text-[11px] text-black/40 active:opacity-60 dark:text-white/40"
          >
            <span className="inline-block h-[8px] w-[8px] rounded-full bg-[#26C84D]" aria-hidden="true" />
            在线
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0 flex-1" aria-hidden="true" />
        <button
          type="button"
          aria-label="聊天设置"
          data-testid="qq-chat-menu"
          className={liquid ? 'lg-chip grid h-[36px] w-[36px] place-items-center rounded-full active:opacity-60' : 'grid h-9 w-9 place-items-center rounded-full active:bg-black/5'}
          onClick={() => setSettingsOpen(true)}
        >
          <Menu className={`h-[22px] w-[22px] ${retro ? 'text-white/70' : 'text-black/70 dark:text-white/70'}`} strokeWidth={2.2} />
        </button>
        </div>
        )}
      </div>

      {/* 消息流（页面任意位置左滑 → 好友互动标识页；自定义聊天背景时透出背景层）。
          qq-chat-list：消息区锚点（聊天设置 › 自定义CSS 示例主题可改内边距/字体） */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (winStart <= 0) return;
          const el = e.currentTarget;
          if (el.scrollTop <= 140) {
            topAnchorRef.current = el.scrollHeight - el.scrollTop;
            setVisibleCount((v) => v + WINDOW_STEP);
          }
        }}
        className={`qq-chat-list no-scrollbar relative z-10 flex-1 overflow-y-auto px-3.5 select-none ${liquid ? 'pt-[112px] pb-3' : 'py-3'}`}
        data-testid="qq-chat-list"
        style={{ touchAction: 'pan-y' }}
      >
        {msgs.slice(winStart).map((m, wi) => {
          // 原始全量索引（时间分隔 msgs[i-1] / 组尾角 msgs[i+1] / 七彩序号等按全量索引计算，分窗行为一致）
          const i = winStart + wi;
          // 错误占位消息（旧版失败落库文案）：新版失败改由触发消息上的红色 ! 徽标表达，不再渲染占位文字行
          if (m.error) return null;
          // 显示设置 › 时间开启后每条消息单独显示时间，此间隔条退场（冗余）
          const showTime = (i === 0 || m.time - msgs[i - 1].time > 5 * 60_000) && !chatDisplay.timeEnabled;
          const mine = m.role === 'me';
          // 第十七轮聊天气泡装扮：按消息序号计算本条气泡视觉（七彩=序号递增循环取色；原生默认时零覆盖直通）
          const bvis = bubbleVisual(mine ? 'mine' : 'theirs', bubbleStyle, i, 'qq');
          // 第五十一轮（用户指定：QQ 换色/七彩气泡变成信息 App 同款）：信息式组尾小角判断——
          // 同侧连续消息的最后一条（或下一条换人）时，尾巴侧底角收 5px（与信息 App rounded-bl/br-[5px] 同口径）
          const nextMsg = i < msgs.length - 1 ? msgs[i + 1] : undefined;
          const lastOfGroup = nextMsg === undefined || nextMsg.role !== m.role;
          // #38 拼手气红包（count>1）未领完不算结算：领完/退回/拒收/过期才收起「開」入口（与 cardIsFinal 同口径）
          const rpSettled = m.kind === 'redpacket' && m.packet ? Boolean(m.packet.status) || Boolean(m.packet.expired) || (m.packet.claims ?? []).length >= (m.packet.count ?? 1) : false;
          const rpClaimedByMe = m.kind === 'redpacket' && m.packet ? (m.packet.claims ?? []).some((c) => c.name === me.name) : false;
          // 动作描写视图（仅对方 AI 的纯文本消息；我的消息/其他类型/无星号内容 → null 走原路径）
          const actView = !m.recalled && m.role === 'peer' && (!m.kind || m.kind === 'text') ? actionDescViewOf(m.content, actionDescOn) : null;
          const actLines = actView ? [...actView.before, ...actView.after] : [];
          // 动作描写开启时气泡正文（剥离描写并整理空白；actView 为 null 时保持原文）
          const actBody = actView && actView.text ? actView.text : null;
          const bubbleContent = actBody ?? m.content;
          // 空白气泡防御：对方纯文本消息清洗后没有任何可见内容（历史脏数据/空段/纯不可见字符）
          // → 整行不渲染气泡（与「整条只有动作描写」同分支：多选模式保留勾选圈行，其余渲染为空）
          const bubbleBlank =
            m.role === 'peer' && !m.recalled && (!m.kind || m.kind === 'text') && !cleanBubbleText(bubbleContent);
          const lineOnly = (actView && !actView.text) || bubbleBlank;
          // Task 40 错误提示优化：Fragment 包 key——消息行后可能追加失败提示行（ChatErrorLine）
          return (
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
                  : undefined
              }
              className={`rounded-[12px] transition-colors duration-500 ${
                highlightId === m.id ? 'bg-[#0099FF]/10 ring-1 ring-[#0099FF]/50' : ''
              }`}
            >
              {showTime && (
                <div className="my-2 text-center">
                  {/* qq-time-chip：时间胶囊锚点（聊天设置 › 自定义CSS 示例主题可改它） */}
                  <span className="qq-time-chip inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">{fmtChatTime(m.time)}</span>
                </div>
              )}
              {/* 深度思考思维链卡片：消息行级别（时间分隔下方、气泡行上方，紧凑小卡片与头像左缘对齐）——
                  对方任意消息类型（文本/语音/卡片）都可携带思考过程；开关关闭时直接丢弃不渲染 */}
              {!mine && deepThinkOn && m.thinking && !m.recalled ? (
                <div className="pl-0 pr-1 pb-[2px]">
                  <ThinkCard text={m.thinking} testId={`qq-think-${m.id}`} />
                </div>
              ) : null}
              {lineOnly ? (
                /* 整条只有动作描写（或关闭态过滤后无正文 / 空白脏数据）：渲染为居中灰字行；多选模式给勾选圈行保证可勾选 */
                selectMode && isSelectable(m) ? (
                  <div className="flex items-center gap-2 py-1.5">
                    <span
                      aria-hidden="true"
                      data-testid={`qq-select-${m.id}`}
                      className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border ${
                        selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {actLines.map((a, k) => (
                        <ActionDescLine key={k} text={a} testId={`qq-action-${m.id}-${k}`} />
                      ))}
                    </div>
                  </div>
                ) : (
                  actLines.map((a, k) => <ActionDescLine key={k} text={a} testId={`qq-action-${m.id}-${k}`} />)
                )
              ) : (
                <>
                  {actView?.before.map((a, k) => (
                    <ActionDescLine key={`b${k}`} text={a} testId={`qq-action-${m.id}-${k}`} />
                  ))}
                  {m.recalled ? (
                /* 已撤回：居中半透明胶囊（你撤回了一条消息 / 对方撤回了一条消息） */
                <div data-testid="qq-recall-row" className="mb-3 text-center">
                  <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                    {m.role === 'me' ? '你撤回了一条消息' : '对方撤回了一条消息'}
                  </span>
                </div>
              ) : m.kind === 'notice' && m.notice ? (
                <QQNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
              ) : m.kind === 'sys' && m.sys ? (
                /* 系统提示行（拉黑/解除拉黑等状态变更）：居中半透明胶囊，与撤回行同款 */
                <div data-testid="qq-sys-row" className="mb-3 text-center">
                  <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                    {m.sys.text}
                  </span>
                </div>
              ) : m.kind === 'blockreq' && m.blkreq ? (
                /* 申请解除拉黑卡片：40-a 双向——角色发起（左侧，头像在左，用户点同意/拒绝）/
                   用户发起（右侧机主侧，角色用 [同意/拒绝解除拉黑] 标记决策，仅展示状态不可点） */
                m.blkreq.from === 'user' ? (
                  <div className="mb-3 flex items-end justify-end gap-2">
                    <QqBlockReqCard
                      name={me.name}
                      avatar={me.avatar}
                      reason={m.blkreq.reason}
                      status={m.blkreq.status}
                      from="user"
                      onAccept={() => undefined}
                      onReject={() => undefined}
                    />
                    <QqAvatar src={me.avatar} alt={me.name} size={40} />
                  </div>
                ) : (
                  <div className="mb-3 flex items-end justify-start gap-2">
                    <QqAvatar src={peer.avatar} alt={peer.name} size={40} />
                    <QqBlockReqCard
                      name={peer.name}
                      avatar={peer.avatar}
                      reason={m.blkreq.reason}
                      status={m.blkreq.status}
                      onAccept={() => resolveBlockReq(m, true)}
                      onReject={() => resolveBlockReq(m, false)}
                    />
                  </div>
                )
              ) : (
              <div className={`mb-3 flex ${m.kind === 'voice' ? 'items-start' : 'items-end'} ${
                m.kind === 'image' || m.kind === 'sticker' || m.kind === 'textcard'
                  ? 'gap-[3px]'
                  : /* 第六十轮：古早文本泡带 15px 凸出的喙状 beak——行距加宽到 18px 给尾巴让位
                       （参考图同款：头像与泡身间距 > 尾巴凸出量，尾巴尖不碰头像） */
                    retro && (!m.kind || m.kind === 'text')
                  ? 'gap-[18px]'
                  : 'gap-2'
              } ${mine ? 'justify-end' : 'justify-start'}`}>
                {selectMode && isSelectable(m) && !mine && (
                  /* 多选模式勾选圈（对方消息在行左侧） */
                  <span
                    aria-hidden="true"
                    data-testid={`qq-select-${m.id}`}
                    className={`grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                )}
                {!mine && (
                  /* 单击对方头像：弹出角色状态卡（延迟 260ms 等待可能的双击）；双击 = 拍一拍（取消状态卡）。
                     （多选模式下点击头像仍走勾选，由行级 onClickCapture 拦截）
                     显示设置：外层列容器承载头像 + 头像下方元信息（已读/时间，位置=头像下面时） */
                  <div className="flex w-[40px] shrink-0 flex-col items-center">
                    <button
                      type="button"
                      data-testid="qq-peer-avatar"
                      aria-label={`单击查看${peer.name}的状态，双击拍一拍`}
                      className="shrink-0 cursor-pointer transition-opacity active:opacity-70"
                      onClick={(e) => {
                        if (onAvatarDoubleTap(e)) {
                          if (peerAvatarTapRef.current !== null) {
                            window.clearTimeout(peerAvatarTapRef.current);
                            peerAvatarTapRef.current = null;
                          }
                          return;
                        }
                        if (peerAvatarTapRef.current !== null) window.clearTimeout(peerAvatarTapRef.current);
                        peerAvatarTapRef.current = window.setTimeout(() => {
                          peerAvatarTapRef.current = null;
                          setPeerStatusOpen(true);
                        }, 260);
                      }}
                    >
                      <QqAvatar src={peer.avatar} alt={peer.name} size={40} shape={chatDisplay.avatarShape} />
                    </button>
                    <QqMetaUnderAvatar m={m} cfg={chatDisplay} />
                  </div>
                )}
                {/* 拉黑图标（红色 ! 圆点）：我的消息在气泡左侧；AI 回复失败徽标（点击重试）优先于拉黑图标 */}
                {mine && m.replyFail ? (
                  <button
                    type="button"
                    data-testid={`qq-replyfail-${m.id}`}
                    aria-label="AI 回复失败，点击重试"
                    title="AI 回复失败，点击重试"
                    onClick={() => retryReply(m)}
                    className="flex h-[20px] w-[20px] shrink-0 cursor-pointer self-center items-center justify-center rounded-full bg-[#FA5151] text-[13px] font-bold leading-none text-white transition-opacity active:opacity-70"
                  >
                    !
                  </button>
                ) : (
                  blockedIconOf(m)
                )}
                {m.kind === 'call' && m.call ? (
                  /* 通话卡片（语音/视频，Task 22 按 media 分叉图标与文案；通话结束后插入聊天记录）：整卡可点回拨（已取消（点击重拨）/ 对方未接听 / 已拒绝 / 未接听 / 通话时长）。
                     宽度约束挂在本包装层（卡片内 max-w-full）：挂卡片自身会相对本层（随内容收缩）解析成循环约束，气泡被压窄文字溢出 */
                  <div {...bubblePress} className="max-w-[calc(100%-92px)]">
                    <CallCardBubble
                      variant="qq"
                      state={m.call.state}
                      duration={m.call.duration}
                      direction={m.call.direction ?? (m.role === 'me' ? 'out' : 'in')}
                      media={m.call.media ?? 'voice'}
                      onRedial={() => openVoiceCall('out', { media: m.call?.media ?? 'voice' })}
                    />
                  </div>
                ) : m.kind === 'song' && m.song ? (
                  /* 歌曲卡片（Task 68 音乐 × AI）：封面+歌名+歌手+播放按钮，点击直接播放 */
                  <div {...bubblePress} className="max-w-[236px]">
                    <SongMsgBubble
                      msgId={m.id}
                      role={m.role}
                      name={m.song.name}
                      artist={m.song.artist}
                      invite={m.song.inviteDone}
                      agree={m.song.agree}
                      cover={m.song.cover}
                      songId={m.song.songId}
                      autoPlay={m.song.autoPlay}
                      time={m.time}
                    />
                  </div>
                ) : m.kind === 'redpacket' && m.packet ? (
                  <div {...bubblePress}>
                    <RedPacketBubble
                      packet={m.packet}
                      showOpen={!mine && !rpSettled && !rpClaimedByMe}
                      onClick={() => setLayer({ view: !mine && !rpSettled && !rpClaimedByMe ? 'rp-open' : 'rp-detail', msgId: m.id })}
                    />
                  </div>
                ) : m.kind === 'transfer' && m.packet ? (
                  <div {...bubblePress}>
                    <TransferBubble
                      packet={m.packet}
                      mine={mine}
                      received={m.packet.received === true}
                      onClick={() =>
                        // 对方发来的未收款且未退还/未过期的转账 → 收款页（时钟+待你收款+收款按钮）；其余 → 交易详情
                        setLayer({ view: !mine && m.packet?.received !== true && !m.packet?.status && !m.packet?.expired ? 'tr-receive' : 'tr-detail', msgId: m.id })
                      }
                    />
                  </div>
                ) : m.kind === 'family' && m.fam ? (
                  <div {...bubblePress}>
                    <FamilyBubble
                      fam={m.fam}
                      mine={mine}
                      peerName={peer.name}
                      onClick={() => setLayer({ view: 'fam-detail', msgId: m.id })}
                    />
                  </div>
                ) : m.kind === 'mtpay' && m.mtpay ? (
                  /* 美团找人代付卡片（美团收银台发请求卡；好友代付后完成卡回聊天）；点卡进代付详情 */
                  <div {...bubblePress}>
                    <MtPayBubble pid={m.mtpay.pid} role={m.mtpay.role} onClick={() => setLayer({ view: 'mtpay-detail', pid: m.mtpay!.pid })} />
                  </div>
                ) : m.kind === 'mtshare' && m.mtshare ? (
                  /* 美团订单分享动态卡片（订单详情右上角分享；状态时间线实时跟订单走；AI 请客卡 role peer 箭头指左） */
                  <div {...bubblePress}>
                    <MtShareBubble sid={m.mtshare.sid} side={m.role === 'me' ? 'right' : 'left'} />
                  </div>
                ) : m.kind === 'tbpay' && m.tbpay ? (
                  /* 淘宝找人代付卡片（淘宝收银台发请求卡；好友 AI 代付后完成卡回聊天；AI 请机主代付的请求卡箭头指左）；点卡进代付详情 */
                  <div {...bubblePress}>
                    <TbPayBubble pid={m.tbpay.pid} role={m.tbpay.role} side={m.role === 'me' ? 'right' : 'left'} onClick={() => setLayer({ view: 'tbpay-detail', pid: m.tbpay!.pid })} />
                  </div>
                ) : m.kind === 'tbshare' && m.tbshare ? (
                  /* 淘宝订单分享动态卡片（交易成功/已发货详情分享、快递面板发出；时间线实时跟订单走） */
                  <div {...bubblePress}>
                    <TbShareBubble sid={m.tbshare.sid} side={m.role === 'me' ? 'right' : 'left'} />
                  </div>
                ) : m.kind === 'forumshare' && m.forumshare ? (
                  /* X论坛帖子分享卡片（用户分享给 AI / AI 反向分享给机主；点击卡片进论坛帖子页） */
                  <div {...bubblePress}>
                    <ForumShareBubble pid={m.forumshare.pid} side={m.role === 'me' ? 'right' : 'left'} />
                  </div>
                ) : m.kind === 'tbdraft' && m.tbdraft ? (
                  /* 淘宝 AI 代买草稿卡（AI [帮你买] 生成；机主确认后 AI 立即付款下单） */
                  <div {...bubblePress}>
                    <TbDraftBubble did={m.tbdraft.did} onToast={onToast} />
                  </div>
                ) : m.kind === 'mtdraft' && m.mtdraft ? (
                  /* 美团 AI 代点外卖草稿卡（动作只在微信端接入；QQ 端兜底渲染同款卡片） */
                  <div {...bubblePress}>
                    <MtDraftBubble did={m.mtdraft.did} onToast={onToast} />
                  </div>
                ) : m.kind === 'location' && m.loc ? (
                  <div {...bubblePress}>
                    <LocationBubble loc={m.loc} onClick={() => onToast('位置详情暂未开放')} />
                  </div>
                ) : m.kind === 'image' ? (
                  /* 图片气泡：点击开大图（黑底居中；多选模式下点选勾选不开大图）；长按菜单含保存/重新生成 */
                  <div className={`flex min-w-0 max-w-[calc(100%-96px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      {...bubblePress}
                      onClick={() => {
                        if (!selectMode && m.content) setImgViewer(m.content);
                      }}
                      className="min-w-0"
                    >
                      <QqImageBubble src={m.content} />
                    </div>
                    <QqMetaUnderBubble m={m} cfg={chatDisplay} />
                  </div>
                ) : m.kind === 'textcard' && m.card ? (
                  /* 文字图片卡片（Task 14：以「我」的身份发出/历史角色卡兼容）；
                     长按菜单与图片一致（复制/删除/多选/撤回/转发/收藏，无编辑无引用）；点击弹操作面板（生成图片/复制文字） */
                  <div {...bubblePress}>
                    <TextCardBubble
                      text={m.card.text}
                      signedBy={mine ? me.name : peer.name}
                      variant="qq"
                      onClick={() => {
                        if (!selectMode) setCardActionId(m.id);
                      }}
                    />
                  </div>
                ) : m.kind === 'sticker' && m.stk ? (
                  <div className={`flex min-w-0 max-w-[calc(100%-96px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div className="min-w-0" {...bubblePress}>
                      <QqStickerBubble
                        url={m.stk.url}
                        meaning={m.stk.meaning}
                        onClick={() => onToast(m.stk?.meaning ? `表情：${m.stk.meaning}` : '表情')}
                      />
                    </div>
                    <QqMetaUnderBubble m={m} cfg={chatDisplay} />
                  </div>
                ) : m.kind === 'forward' && m.fwd?.merged ? (
                  /* 合并转发「聊天记录」卡片（原生同款：两面都白底）：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情 */
                  <div
                    {...bubblePress}
                    data-testid="qq-forward-bubble"
                    onClick={() => {
                      if (!selectMode) setFwdDetailId(m.id);
                    }}
                    className="w-fit max-w-[calc(100%-96px)] select-none rounded-[10px] bg-white px-3.5 py-[9px] text-[#1F2329] shadow-sm dark:bg-[#2A2C31] dark:text-white"
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
                ) : m.kind === 'forward' && m.fwd ? (
                  /* 转发卡片：内嵌原消息内容（来源说明已按需求移除） */
                  <div
                    {...bubblePress}
                    data-testid="qq-forward-bubble"
                    className="w-fit max-w-[calc(100%-96px)] select-none rounded-[10px] px-3.5 py-[9px] text-white"
                    style={{ backgroundColor: '#0099FF' }}
                  >
                    <div className="line-clamp-8 whitespace-pre-wrap break-words border-l-2 border-white/40 pl-2 text-[14px] leading-[1.4]">
                      {m.quote && <span className="mb-0.5 block text-[12px] text-white/75">{m.quote.name}：{m.quote.content}</span>}
                      {m.content}
                    </div>
                  </div>
                ) : m.kind === 'groupcard' && m.gcard ? (
                  /* 群聊邀请卡片（AI 主动建群/拉人）：pending 出接受/拒绝；点「接受邀请」才进群，卡片本体不可点 */
                  <div {...bubblePress}>
                    <QqGroupCardBubble
                      card={m.gcard}
                      onAccept={() => decideGroupCard(m, true)}
                      onReject={() => decideGroupCard(m, false)}
                    />
                  </div>
                ) : m.kind === 'relcard' && m.relcard ? (
                  /* 亲密关系卡片（情侣空间邀请卡/成功卡）：对方邀请 pending 出接受/拒绝；卡片本体不可点 */
                  <div {...bubblePress}>
                    <CoupleRelBubble
                      data={m.relcard}
                      mine={m.role === 'me'}
                      testidPrefix="qq"
                      onAccept={() => decideCoupleCard(m, true)}
                      onDecline={() => decideCoupleCard(m, false)}
                    />
                  </div>
                ) : m.kind === 'pactcard' && m.pactcard ? (
                  /* 恋爱协议卡片（第十二轮）：点卡片本体进情侣空间签署界面（导航在气泡组件内） */
                  <div {...bubblePress}>
                    <CouplePactBubble data={m.pactcard} mine={m.role === 'me'} testidPrefix="qq" />
                  </div>
                ) : m.kind === 'examcard' && m.examcard ? (
                  /* 恋爱考试卡片（第十五轮）：点卡片进情侣空间试卷页（导航在气泡组件内） */
                  <div {...bubblePress}>
                    <CoupleExamBubble data={m.examcard} mine={m.role === 'me'} testidPrefix="qq" />
                  </div>
                ) : m.kind === 'lettercard' && m.lettercard ? (
                  /* 情书信封卡片（第十八轮）：点卡片直达情侣空间信件页（导航在气泡组件内） */
                  <div {...bubblePress}>
                    <CoupleLetterBubble data={m.lettercard} mine={m.role === 'me'} testidPrefix="qq" />
                  </div>
                ) : m.kind === 'voice' && m.voice ? (
                  /* 语音消息：播放/暂停 + 波形 + 时长；长按菜单：转文字/复制/…；转写结果显示在气泡下方
                     （我方 QQ 蓝底白字与文本气泡一致，圆角由组件内处理）。
                     第四十七轮（用户指定）：包裹层限宽 calc(100%-96px)（与 QQ 文本气泡同口径）——
                     转文字长面板不再撑满整行、不越过对侧头像区 */
                  /* 显示设置：语音/图片/表情列容器挂气泡下元信息（与文本分支同构） */
                  <div className={`flex min-w-0 max-w-[calc(100%-96px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div {...bubblePress} className="max-w-full">
                      <VoiceMsgBubble
                        msgId={m.id}
                        voice={m.voice}
                        side={m.role}
                        theme="qq"
                        bubbleClassName={bvis.override ? bvis.className : undefined}
                        decorated={bvis.override}
                        style={
                          bvis.override
                            ? bvis.style /* 古早四角统一 12px（retroQqRadius），语音泡无尾巴无需盖角 */
                            : m.role === 'me'
                              ? { backgroundColor: '#0099FF' }
                              : undefined
                        }
                        decorApp="qq"
                        msgIndex={i}
                      />
                    </div>
                    <QqMetaUnderBubble m={m} cfg={chatDisplay} />
                  </div>
                ) : (
                  <div className={`flex min-w-0 max-w-[calc(100%-96px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      {...bubblePress}
                      className={`relative w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[10px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
                        bvis.override
                          ? bvis.className
                          : mine
                          ? // 第六十九轮：qq-bub-mine/theirs 语义锚点 —— 聊天设置的自定义 CSS
                            // 示例主题靠它们把默认气泡整套换色（装扮泡走 bvis.className 不受影响；
                            // 我方默认蓝泡是内联色，示例主题用 !important 覆盖）
                            'qq-bub-mine text-white'
                          : // 错误占位消息红字提示（与 chat.tsx 同款：〔消息发送失败…〕/〔对方暂时没有回复…〕）
                            m.error
                            ? 'bg-white text-[#FF3B30] dark:bg-[#2A2C31] dark:text-[#FF6B6B]'
                            : 'qq-bub-theirs bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                      }`}
                      style={
                        bvis.override
                          ? {
                              ...bvis.style,
                              // 信息式组尾小角：装扮纯色/七彩（im 尾巴）与古早（retro 尾巴）时，
                              // 组尾尾巴侧底角收 5px（inline borderRadius 会盖掉类圆角，故在此一并算好四角；
                              // im 基角 18px / retro 基角 12px=retroQqRadius）；胶囊装扮保持 999px
                              ...(bvis.tail === 'im'
                                ? { borderRadius: lastOfGroup ? (mine ? '18px 18px 5px 18px' : '18px 18px 18px 5px') : '18px' }
                                : bvis.tail === 'retro'
                                  ? { borderRadius: lastOfGroup ? (mine ? '12px 12px 5px 12px' : '12px 12px 12px 5px') : '12px' }
                                  : {}),
                            }
                          : mine
                          ? { backgroundColor: '#0099FF' }
                          : undefined
                      }
                    >
                      {/* 气泡小尾巴（第五十一轮，用户指定：QQ 换色/七彩气泡变成信息 App 同款）：
                          装扮 solid/七彩 = 信息 App 同款底部弯钩剪影尾巴（14×18px，随 tailColor 上色，
                          我方右侧/对方左侧，与头像底端对齐）；毛玻璃/液态胶囊无尾巴。
                          第六十三轮（用户指定「古早气泡小尾巴放下面，跟七彩差不多」）：QQ 古早
                          尾巴从顶部 beak 改为同款底部弯钩剪影（同几何同定位）；非自定义色时颜色
                          走 .rt-beak-* 类（渐变对齐泡身底部色带 + 深色自适应；自定义色时
                          tailColor 平色）。QQ 泡已去描边，定位无补偿 */}
                      {bvis.tail === 'im' && (
                        <span
                          aria-hidden="true"
                          className={`absolute bottom-0 ${mine ? '-right-[6px]' : '-left-[6px]'} h-[18px] w-[14px]`}
                          style={{ clipPath: mine ? TAIL_CLIP_RIGHT : TAIL_CLIP_LEFT, backgroundColor: bvis.tailColor }}
                        />
                      )}
                      {bvis.tail === 'retro' && (
                        <span
                          aria-hidden="true"
                          className={`absolute bottom-0 ${mine ? '-right-[6px]' : '-left-[6px]'} h-[18px] w-[14px] ${
                            bvis.tailColor ? '' : mine ? 'rt-beak-mine' : 'rt-beak-theirs'
                          }`}
                          style={{
                            clipPath: mine ? TAIL_CLIP_RIGHT : TAIL_CLIP_LEFT,
                            ...(bvis.tailColor ? { background: bvis.tailColor } : {}),
                          }}
                        />
                      )}
                      {/* QQ 引用卡（截图样式：气泡内深色圆角卡 —— 上行名字+时间+右角箭头，下行引用内容；回复内容在卡片下方）。
                          第十九轮修订：紧凑化（更小的内边距/字号，引用卡不再占大半个气泡）+ 引用文字用
                          InlineEmojiText 渲染内置表情（[呲牙] 显示为小表情图而非文字代码，且不会被
                          break-all 拆成 [呲 / 牙] 两截）+ 我方引用卡底色加深一档拉开与气泡本体的层次 */}
                      {m.quote && (() => {
                        const qTime = m.quote.time ?? (m.quote.id ? msgs.find((x) => x.id === m.quote?.id)?.time : undefined);
                        // Task 30：引用块按源消息类型加迷你预览——图片/表情=36px 缩略图，语音=图标+时长；
                        // 源消息已删/撤回或图挂掉时退回纯文字（quote.content 已由删除/撤回联动改写）
                        const qSrc = m.quote.id ? msgs.find((x) => x.id === m.quote?.id) ?? null : null;
                        const qThumb = qSrc && !qSrc.recalled ? (qSrc.kind === 'image' ? qSrc.img?.src ?? qSrc.content : qSrc.kind === 'sticker' ? qSrc.stk?.url : null) ?? null : null;
                        const qVoice = qSrc && !qSrc.recalled && qSrc.kind === 'voice' ? qSrc.voice ?? null : null;
                        return (
                          <div
                            data-testid="qq-quote-block"
                            className={`mb-1.5 rounded-[6px] px-2.5 py-[6px] ${mine ? 'bg-black/[0.18]' : 'bg-black/[0.08] dark:bg-white/[0.08]'}`}
                          >
                            <div className={`flex items-center gap-1 text-[12px] leading-[1.35] ${mine ? 'text-white/80' : 'text-black/50 dark:text-white/50'}`}>
                              <span className="min-w-0 flex-1 truncate">
                                {m.quote.name}
                                {qTime ? ` ${qqQuoteTime(qTime)}` : ''}
                              </span>
                              <CornerRightDown className={`h-3 w-3 shrink-0 ${mine ? 'text-white/65' : 'text-black/35 dark:text-white/40'}`} />
                            </div>
                            <div className="mt-[2px] flex items-center gap-2">
                              {qThumb && <QqQuoteThumb src={qThumb} mine={mine} />}
                              <p className={`min-w-0 flex-1 line-clamp-2 whitespace-pre-wrap break-all text-[13.5px] leading-[1.4] ${mine ? 'text-white' : 'text-black/80 dark:text-white/85'}`}>
                                {qVoice ? (
                                  <span className="inline-flex items-center gap-1" data-testid="qq-quote-voice-row">
                                    <AudioLines className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                                    [语音]{qVoice.duration ? ` ${qVoice.duration}"` : ''}
                                  </span>
                                ) : (
                                  <InlineEmojiText app="qq" text={m.quote.content} imgSize={16} />
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      })()}
                      {bubbleContent ? (
                        /* 文字消息：内置表情代码 [微笑] 还原为内联小图（混排小图/纯表情大图，真机同款） */
                        <InlineEmojiText app="qq" text={cleanBubbleText(bubbleContent) || bubbleContent} />
                      ) : (
                        <span className="inline-flex items-center gap-[5px] py-[4px]" role="status" aria-label="对方正在输入">
                          {[0, 1, 2].map((d) => (
                            <span
                              key={d}
                              aria-hidden="true"
                              className="h-[7px] w-[7px] rounded-full bg-black/35 dark:bg-white/45"
                              style={{ animation: `qqTypingDot 1.1s ${d * 0.16}s ease-in-out infinite` }}
                            />
                          ))}
                        </span>
                      )}
                    </div>
                    {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                    {renderTranslations(m.id, m.content)}
                    {/* 显示设置 › 已读未读/时间（位置=气泡下面）：靠气泡末尾（远离头像的一侧），已读在上、时间在下 */}
                    <QqMetaUnderBubble m={m} cfg={chatDisplay} />
                  </div>
                )}
                {mine && (
                  /* Task 30 拍一拍：双击自己的头像 = 拍一拍自己（QQ 同款互动）；单击无动作。
                     显示设置：外层列容器承载头像 + 头像下方元信息（已读/时间，位置=头像下面时） */
                  <div className="flex w-[40px] shrink-0 flex-col items-center">
                    <button
                      type="button"
                      data-testid="qq-me-avatar"
                      aria-label="双击拍一拍自己"
                      className="shrink-0 cursor-pointer"
                      onClick={(e) => onAvatarDoubleTap(e, true)}
                    >
                      <QqAvatar src={me.avatar} alt={me.name} size={40} shape={chatDisplay.avatarShape} />
                    </button>
                    <QqMetaUnderAvatar m={m} cfg={chatDisplay} />
                  </div>
                )}
                {/* 拉黑图标（红色 ! 圆点）：对方的消息在气泡右侧 */}
                {!mine && blockedIconOf(m)}
                {selectMode && isSelectable(m) && mine && (
                  /* 多选模式勾选圈（我的消息在行右侧；转发勾选模式移到最左侧，对照原生） */
                  <span
                    aria-hidden="true"
                    data-testid={`qq-select-${m.id}`}
                    className={`grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      fwdFlow === 'choose' ? 'order-first' : ''
                    } ${
                      selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                )}
              </div>
              )}
                  {actView?.after.map((a, k) => (
                    <ActionDescLine key={`a${k}`} text={a} testId={`qq-action-${m.id}-${k}`} />
                  ))}
                </>
              )}
            {/* 拒收状态行：仅「对方拉黑我」时跟在我的消息后面，居中半透明胶囊；我拉黑对方不显示 */}
            {blockedLineOf(m)}
            {/* 好友验证消息标注（与系统提示同款胶囊：气泡下方居中；验证消息独立保留在聊天记录里） */}
            {m.fr === 'apply' || m.fr === 'greet' ? (
              <div data-testid="qq-fr-note" className="mb-2 text-center">
                <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                  {m.fr === 'apply' ? '以上为验证消息' : '以上是打招呼的内容'}
                </span>
              </div>
            ) : null}
            </div>
            {/* Task 40 错误提示优化：失败消息行后居中灰字提示（点击重试/长按菜单）；「隐藏这条提示」后本会话不再显示 */}
            {mine && m.replyFail && !hiddenFail[m.id] && (
              <ChatErrorLine
                text={m.failReason || CHAT_UNKNOWN_FAIL_TEXT}
                detail={lastChatErrorDetail(sessionKey)}
                cooldownText={cooldownRemainText(sessionKey)}
                onRetry={() => retryReply(m)}
                onHide={() => setHiddenFail((prev) => ({ ...prev, [m.id]: true }))}
                testId={`qq-errline-${m.id}`}
              />
            )}
            </Fragment>
          );
        })}
        {/* 正在输入指示（流式接收 + 逐条投递期间显示）：AI 回复为「边接收边逐条显示」——
            完整分段直接作为真实消息逐条投递上屏（见 runAiTurn 的 onSegment/finalize），
            不再有先全文显示后消失的流式气泡；识图失败系统提示在此一并展示 */}
        {(streaming || delivering) && (() => {
          /* 正在输入指示：与 TA 的消息气泡同一装扮视觉（第四十二轮补齐：装扮后不再固定白底，
             序号取 msgs.length 接续七彩循环；第五十一轮 QQ 装扮尾巴改成信息 App 同款弯钩剪影——
             胶囊装扮无尾巴，纯色/七彩渲染信息式底部尾巴） */
          const tvis = bubbleVisual('theirs', bubbleStyle, msgs.length, 'qq');
          return (
          <div data-testid="qq-stream-typing">
            {stream?.visionNotice && (
              <p data-testid="qq-vision-notice" className="my-1 text-center text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                {stream.visionNotice}
              </p>
            )}
            {/* B2 深度思考实况：流式期间思考增量到达时，输入指示气泡上方先展示「正在深度思考…」
                脉动卡（可展开实时思考）；正文开始流后自动切「已深度思考 (点击展开)」，
                与消息落盘后的 ThinkCard 无缝衔接；深度思考开关关闭时不渲染（思考照常后台进行） */}
            {deepThinkOn && stream?.liveThink ? (
              <div className="pl-0 pr-1 pb-[2px]">
                <ThinkLiveCard text={stream.liveThink} done={stream.thinkDone ?? false} testId="qq-think-live" />
              </div>
            ) : null}
            <div className={`mb-3 flex items-end justify-start ${retro ? 'gap-[15px]' : 'gap-2'}`}>
              <QqAvatar src={peer.avatar} alt={peer.name} size={40} />
              <div
                className={`relative max-w-[calc(100%-96px)] px-3.5 py-[9px] ${
                  tvis.override ? tvis.className : 'rounded-[10px] bg-white dark:bg-[#2A2C31]'
                }`}
                style={
                  tvis.override
                    ? {
                        ...tvis.style,
                        // 信息式尾巴侧底角收 5px（与文本气泡组尾同口径；im 基角 18px /
                        // 古早基角 12px=retroQqRadius；胶囊装扮保持 999px）
                        ...(tvis.tail === 'im'
                          ? { borderRadius: '18px 18px 18px 5px' }
                          : tvis.tail === 'retro'
                            ? { borderRadius: '12px 12px 12px 5px' }
                            : {}),
                      }
                    : undefined
                }
              >
                {tvis.tail === 'im' && (
                  <span
                    aria-hidden="true"
                    className="absolute -left-[6px] bottom-0 h-[18px] w-[14px]"
                    style={{ clipPath: TAIL_CLIP_LEFT, backgroundColor: tvis.tailColor }}
                  />
                )}
                {tvis.tail === 'retro' && (
                  /* 古早底部弯钩尾巴（第六十三轮，用户指定「放下面，跟七彩差不多」）：
                     与文本气泡同款信息式剪影（14×18、凸 6px、贴底）；颜色走 .rt-beak-theirs
                     类（深色自适应；自定义色时 tailColor 平色） */
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 -left-[6px] h-[18px] w-[14px] ${tvis.tailColor ? '' : 'rt-beak-theirs'}`}
                    style={{ clipPath: TAIL_CLIP_LEFT, ...(tvis.tailColor ? { background: tvis.tailColor } : {}) }}
                  />
                )}
                <span className="inline-flex items-center gap-[5px] py-[4px]" role="status" aria-label="对方正在输入">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      aria-hidden="true"
                      className={`h-[7px] w-[7px] rounded-full ${tvis.override ? 'bg-current' : 'bg-black/35 dark:bg-white/45'}`}
                      style={{ animation: `qqTypingDot 1.1s ${d * 0.16}s ease-in-out infinite`, ...(tvis.override ? { opacity: 0.7 } : {}) }}
                    />
                  ))}
                </span>
              </div>
            </div>
          </div>
          );
        })()}
        {/* v1.9.12 「有新消息 ⬇️」轻提示：机主上翻看历史时 AI 来新消息不拽回底部，浮出胶囊点击才回底部 */}
        <ChatNewMsgPill show={showNewMsg} onClick={scrollToBottom} />
      </div>

      {/* 底部：输入行 + 六图标工具栏 + 加号面板（弹出时输入框与工具栏被整体顶起，跟随面板上浮）；多选模式下变为批量操作栏 */}
      {/* qq-inputbar：输入栏锚点（聊天设置 › 自定义CSS 示例主题可改底色/边框） */}
      <div className={`qq-inputbar relative z-10 shrink-0 ${liquid ? 'bg-transparent' : retro ? 'rt-inputbar' : 'bg-white dark:bg-[#1B1C1F]'}`}>
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[22px] pt-3" data-testid="qq-select-bar">
            <button
              type="button"
              data-testid="qq-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#F5455C] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="qq-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="qq-select-fav"
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
        {/* 40-a：被角色拉黑提示条 + 用户发起「解除拉黑申请」入口（pending 或已达拒绝上限时隐藏，
            会话内改用跨 App/电话联系方式不受影响）。展开的小面板 = 理由输入 + 发送/取消 */}
        {blk.byChar === true && blk.userReqStatus !== 'pending' && (blk.userReqRejectedCount ?? 0) < BLOCK_REQ_MAX_REJECTED && (
          userReqOpen ? (
            <div className="px-3 pb-1 pt-2" data-testid="qq-user-blockreq-panel">
              <div className="flex items-center gap-2 rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.07]">
                <input
                  value={userReqText}
                  onChange={(e) => setUserReqText(e.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder={`向「${peer.name}」写一句申请理由…`}
                  aria-label="解除拉黑申请理由"
                  data-testid="qq-user-blockreq-input"
                  className="h-[32px] min-w-0 flex-1 rounded-[8px] bg-white px-2.5 text-[14px] outline-none ring-black/[0.06] placeholder:text-black/30 focus-visible:ring-1 dark:bg-[#1F2125] dark:placeholder:text-white/30"
                />
                <button
                  type="button"
                  data-testid="qq-user-blockreq-cancel"
                  onClick={() => {
                    setUserReqOpen(false);
                    setUserReqText('');
                  }}
                  className="shrink-0 text-[14px] text-black/45 active:opacity-60 dark:text-white/45"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-testid="qq-user-blockreq-send"
                  disabled={!userReqText.trim()}
                  onClick={submitUserBlockReq}
                  className="h-[32px] shrink-0 rounded-full px-3.5 text-[13px] font-medium text-white transition active:opacity-80 disabled:opacity-40"
                  style={{ backgroundColor: '#0099FF' }}
                >
                  发送
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 pb-1 pt-2" data-testid="qq-user-blockreq-bar">
              <div className="flex items-center gap-2 rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] px-2.5 py-1 dark:border-white/[0.08] dark:bg-white/[0.07]">
                <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">你已被「{peer.name}」拉黑，无法发送消息</p>
                <button
                  type="button"
                  data-testid="qq-user-blockreq-open"
                  onClick={() => setUserReqOpen(true)}
                  className="shrink-0 rounded-full bg-[#0099FF]/10 px-3 py-1 text-[12px] font-medium text-[#0099FF] transition active:opacity-70 dark:bg-[#0099FF]/20"
                >
                  发送解除申请
                </button>
              </div>
            </div>
          )
        )}
        {/* 引用条（长按菜单「引用」后显示在输入框上方；发送时挂到新消息上） */}
        {quote && (
          <div className="px-3 pb-1 pt-2" data-testid="qq-quote-bar">
            <div className="flex items-start gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 dark:border-white/25 dark:bg-white/[0.13]">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">
                引用 {quote.name}：{quote.content}
              </p>
              <button
                type="button"
                aria-label="取消引用"
                data-testid="qq-quote-cancel"
                onClick={() => setQuote(null)}
                className="shrink-0 text-black/35 active:opacity-60 dark:text-white/35"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        {/* 输入框上方快捷功能条（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面；
            点一下与点面板里那一项等效；未添加 = 不显示；「+」面板本身不受影响 */}
        {quickItems.length > 0 && (
          <div className="px-3 pt-2">
            <ChatQuickBar items={quickItems} liquid={liquid} retro={retro} testPrefix="qq" />
          </div>
        )}
        {/* 液态玻璃（用户指定）：删除输入行后面的大椭圆胶囊——行本身无包裹，输入框改毛玻璃椭圆（lg-input rounded-full），
            下方六个工具按钮每个单独 lg-chip 椭圆包裹；默认主题原样 */}
        <div className="flex items-end gap-2 px-3 pb-1 pt-3">
          <div className="relative min-w-0 flex-1">
            <ChatRichInput
              app="qq"
              ref={richInputRef}
              value={input}
              onChange={(v) => {
                setInput(v);
                // 感知设置（打字思考感知）：首次键入记起点，发送时算「纯打字」时长
                markTypingStart(sessionKey);
                // Task 40 草稿箱：随输入持久化草稿（防抖合幵落库）；超长截断保存并 5 秒节流提示一次
                if (saveChatDraft('qq', peer.id, v) && draftWarnRef.current <= Date.now() - 5000) {
                  draftWarnRef.current = Date.now();
                  onToast(`草稿过长，仅保留前 ${CHAT_DRAFT_MAX} 字`);
                }
                // 键入 @ 直接唤起 @ 浮层（与群聊同款：点选后替换该 @ 并插入「@名字 」）
                if (v.endsWith('@')) {
                  setPlusOpen(false);
                  setStickerOpen(false);
                  setAtOpen(true);
                }
              }}
              onKeyDown={(e) => {
                // A-6：中文输入法选词回车（isComposing）不发送；「回车键发送消息」开关统一口径（guardEnterToSend）：
                // 开启=Enter 发送（Shift+Enter 仍换行），关闭=回车一律换行、点「发送」按钮才发送
                guardEnterToSend(e, enterSend, () => void send());
              }}
              enterKeyHint={enterSend ? 'send' : undefined}
              placeholder={ttsSend ? '输入文字，发送后转为语音' : chatPlaceholder(chatDecorQq)}
              placeholderClass="absolute inset-0 flex items-center pl-3.5 pr-10 text-[15px] text-black/25 dark:text-white/25"
              ariaLabel={`发送消息给${peer.name}`}
              testId="qq-chat-input"
              className={
                liquid
                  ? 'max-h-[132px] min-h-[40px] w-full overflow-y-auto rounded-full lg-input py-[9px] pl-4 pr-10 text-[15px] leading-[22px] outline-none'
                  : retro
                  ? 'max-h-[132px] min-h-[40px] w-full overflow-y-auto rt-input rounded-[4px] py-[9px] pl-3.5 pr-10 text-[15px] leading-[22px] outline-none text-black'
                  : 'max-h-[132px] min-h-[40px] w-full overflow-y-auto rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] py-[9px] pl-3.5 pr-10 text-[15px] leading-[22px] outline-none dark:border-white/[0.08] dark:bg-white/[0.07]'
              }
            />
            {/* 文字转语音开关（声波图标在输入框内右侧）：开启后输入框文字发送为语音气泡 */}
            <button
              type="button"
              aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
              aria-pressed={ttsSend}
              data-testid="qq-tts-toggle"
              onClick={() => {
                const nv = !ttsSend;
                setTtsSend(nv);
                onToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
              }}
              className={`absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors active:opacity-60 ${ttsSend ? 'text-[#0099FF]' : 'text-black/40 dark:text-white/40'}`}
            >
              <AudioLines className="h-[18px] w-[18px]" strokeWidth={ttsSend ? 2.2 : 1.8} />
            </button>
          </div>
          <button
            type="button"
            data-testid="qq-chat-send"
            aria-label={ttsSend ? '发送（转语音）' : input.trim() ? '发送' : pendingImgs.length > 0 ? '发送图片' : '发送（让对方回复）'}
            disabled={!input.trim() && !canDispatch && pendingImgs.length === 0}
            onClick={() => {
              // 有文字（含与待发图组合发送）或预览条还有待发图都走 send（内部分流：组合发/只发图/只发文字）；
              // 真正空输入才触发分句批次。37-a：去掉流式禁用——AI 回复中点击走 send() 内部的排队补跑分支（与 chat.tsx 口径一致）
              if (input.trim() || pendingImgs.length > 0) void send();
              else dispatchBatch();
            }}
            className={`h-[40px] shrink-0 ${liquid ? 'rounded-full' : retro ? 'rt-send-qq rounded-[4px]' : 'rounded-[12px]'} px-5 text-[16px] ${
              retro ? 'font-semibold text-[#152A42]' : 'font-medium text-white'
            } transition-all duration-150 ${
              (input.trim() || canDispatch || pendingImgs.length > 0) && !streaming
                ? retro
                  ? 'active:scale-[0.97]'
                  : 'shadow-[0_2px_10px_rgba(0,153,255,0.30)] active:scale-[0.97] active:brightness-95'
                : 'opacity-90'
            }`}
            style={retro ? undefined : { backgroundColor: (input.trim() || canDispatch || pendingImgs.length > 0) && !streaming ? QQ_BLUE : '#8AD4F7' }}
          >
            发送
          </button>
        </div>
        {/* 待发图片预览条（发图先预览）：显示在输入行下方，主发送按钮才真正发出（文字与待发图可组合发送）；表情/加号面板打开时隐藏 */}
        {!stickerOpen && !plusOpen && pendingImgs.length > 0 && (
          <div data-testid="qq-img-preview-bar" className="flex items-center gap-2 overflow-x-auto px-3 pb-1 pt-2">
            {pendingImgs.map((p, k) => (
              <div key={p.id} className="relative shrink-0">
                <img
                  src={p.src}
                  alt={`待发送图片 ${k + 1}`}
                  data-testid={`qq-img-preview-item-${k}`}
                  className="h-[62px] w-[62px] rounded-[10px] object-cover ring-1 ring-black/[0.06] dark:ring-white/10"
                />
                <button
                  type="button"
                  aria-label="移除图片"
                  data-testid={`qq-img-preview-remove-${k}`}
                  onClick={() => removePendingImg(p.id)}
                  className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/55 text-white active:opacity-70"
                >
                  <X className="h-[11px] w-[11px]" strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={
            liquid
              ? 'flex items-center justify-between gap-2 px-4 pb-[16px] pt-2.5 text-black/80 dark:text-white/80'
              : 'flex items-center justify-between px-7 pb-[18px] pt-2 text-black/80 dark:text-white/80'
          }
        >
          <button
            type="button"
            aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
            data-testid="qq-voice-toggle"
            aria-expanded={voiceMode}
            onClick={() => {
              if (rec.phase !== 'idle') return; // 录音按住中不允许切换（防止按住中的大圆钮被卸载导致手势丢失）
              setVoiceMode((v) => !v);
              setPlusOpen(false);
              setStickerOpen(false);
            }}
            className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}
          >
            <Mic className={`h-[25px] w-[25px] ${voiceMode ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="图片" data-testid="qq-tool-image" onClick={() => fileRef.current?.click()} className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}>
            <ImageIcon className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="拍摄" data-testid="qq-tool-camera" onClick={() => cameraInputRef.current?.click()} className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}>
            <Camera className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="线下模式"
            data-testid="qq-tool-offline"
            onClick={() => {
              setPlusOpen(false);
              setStickerOpen(false);
              setLayer({ view: 'offline' });
            }}
            className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}
          >
            <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="表情"
            data-testid="qq-chat-sticker"
            aria-expanded={stickerOpen}
            onClick={() => {
              /* 三面板互斥（第五十二轮）：开表情面板时退出语音模式并关加号面板；录音按住中不允许切换 */
              if (rec.phase !== 'idle') return;
              setVoiceMode(false);
              setPlusOpen(false);
              setStickerOpen((v) => !v);
            }}
            className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}
          >
            <Smile className={`h-[25px] w-[25px] ${stickerOpen ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="更多功能"
            data-testid="qq-chat-plus"
            aria-expanded={plusOpen}
            onClick={() => {
              /* 三面板互斥（第五十二轮）：开加号面板时退出语音模式并关表情面板；录音按住中不允许切换 */
              if (rec.phase !== 'idle') return;
              setVoiceMode(false);
              setStickerOpen(false);
              setPlusOpen((v) => !v);
            }}
            className={liquid ? 'lg-chip flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-95' : 'p-2 -m-2 active:opacity-60'}
          >
            <Plus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {/* QQ 语音面板（工具栏下方展开，相当于键盘区）：「按住说话」+ 大圆麦克风（左滑转文字/右滑取消）+ 变声/对讲/录音；
            液态玻璃：面板换乳白强模糊玻璃（lg-sheet），群聊等调用点不传保持默认 */}
        {voiceMode && <QqVoicePanel rec={rec} holdTestId="qq-voice-hold" liquid={liquid} />}
        {/* 第四十五轮（用户指定）：加号面板点击时输入框不再被顶起——液态主题下面板悬浮在输入区上方
            （absolute bottom-full 锚定底部容器顶缘，覆盖消息列表底部）；默认主题保持原展开行为。
            第四十七轮（用户指定）：面板左右太宽——改右锚定固定 248px（与微信聊天面板同宽，悬于加号钮上方） */}
        {plusOpen ? (
          liquid ? (
            <div className="absolute bottom-full right-3 z-30 w-[248px]">
              <div
                data-testid="qq-plus-panel"
                className="lg-sheet mb-2.5 rounded-[20px] py-[4px]"
                style={{ animation: 'qqPanelIn 0.24s ease-out' }}
              >
                <QqPlusGrid items={plusAllItems} liquid={liquid} retro={retro} />
              </div>
            </div>
          ) : (
            <div
              data-testid="qq-plus-panel"
              className="px-5 pt-5 border-t border-black/[0.05] pb-6 dark:border-white/[0.06]"
              style={{ animation: 'qqPanelIn 0.24s ease-out' }}
            >
              <QqPlusGrid items={plusAllItems} retro={retro} />
            </div>
          )
        ) : null}
        {stickerOpen ? (
          <QqStickerPanel
            onPick={sendSticker}
            onPickBuiltin={insertBuiltinEmoji}
            onClose={() => setStickerOpen(false)}
            onToast={onToast}
            liquid={liquid}
          />
        ) : null}
        {/* 一起听选歌弹层（第二十四轮）：选歌 → 我方发邀请卡进聊天，AI 接受后双方发同意卡并建会话 */}
        {tgPickOpen ? (
          <TogetherInviteSheet
            peerName={peer.nickname || peer.name}
            onClose={() => setTgPickOpen(false)}
            onPick={(song) => {
              setTgPickOpen(false);
              sendUserTogetherInvite({
                contact: peer,
                app: 'qq',
                song: { id: song.id, name: song.name, artist: songArtistText(song), cover: songCover(song) || undefined },
                insert: (m: TgCardMsg) => {
                  const qm = m as unknown as QQMsg;
                  saveMsgs(peer.id, [...loadMsgs(peer.id), qm]);
                  setMsgs((prev) => (prev.some((x) => x.id === qm.id) ? prev : [...prev, qm]));
                },
              });
            }}
          />
        ) : null}
        {/* @ 浮层（单聊）：锚定输入区上方，点选后把草稿末尾的 @ 替换为「@名字 」 */}
        {atOpen ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-full left-3 z-40 mb-1 w-[220px] overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2A2C31]">
              <div className="border-b border-black/[0.05] px-3 py-2 text-[11px] text-black/40 dark:border-white/[0.06] dark:text-white/40">
                @ 联系人（被 @ 的优先回复）
              </div>
              <button
                type="button"
                data-testid={`qq-chat-at-${peer.id}`}
                onClick={() => {
                  setAtOpen(false);
                  setInput((v) => {
                    const base = v.endsWith('@') ? v.slice(0, -1) : v;
                    return `${base}${base && !base.endsWith(' ') ? ' ' : ''}@${peer.name} `;
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <QqAvatar src={peer.avatar} alt={peer.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{peer.name}</span>
              </button>
            </div>
          </>
        ) : null}
        </>
        )}
      </div>

      {/* 浮层：发红包 / 转账 / 红包开箱 / 红包详情 / 交易详情 / 发送位置 */}
      {layer?.view === 'redpacket' ? (
        <RedPacketCompose
          wallet={payCtx.wallet}
          cards={payCtx.cards}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => startSend('redpacket', p, methodId)}
        />
      ) : null}
      {layer?.view === 'transfer' ? (
        <TransferCompose
          peer={peer}
          wallet={payCtx.wallet}
          cards={payCtx.cards}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => startSend('transfer', p, methodId)}
        />
      ) : null}
      {layer?.view === 'rp-open'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            if (!m?.packet) return null;
            return (
              <RedPacketOpenModal
                senderName={peer.name}
                avatar={peer.avatar}
                note={m.packet.note}
                onClose={() => setLayer(null)}
                onRefund={() => refundPeerCard(m)}
                onOpen={() => {
                  const claims = m.packet?.claims ?? [];
                  const remaining = round2((m.packet?.amount ?? 0) - claims.reduce((s, c) => s + c.amount, 0));
                  const amt = Math.max(0.01, remaining);
                  gainToWallet(amt, `QQ红包-来自${peer.name}`, { kind: 'redpacket' });
                  // 领取提示行（聊天界面居中灰字）：「你领取了XX的红包」，与对方领取我的红包同款样式
                  const notice: QQMsg = { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你领取了${peer.name}的`, accent: '红包' } };
                  setMsgs((prev) => [
                    ...prev.map((x) =>
                      x.id === m.id && x.packet
                        ? { ...x, packet: { ...x.packet, claims: [...(x.packet.claims ?? []), { name: me.name, avatar: me.avatar, amount: amt, ts: Date.now() }] } }
                        : x
                    ),
                    notice,
                  ]);
                  setLayer({ view: 'rp-detail', msgId: m.id });
                  // 用户领取红包后 AI 不再自动跟发；AI 感知来自聊天历史卡片终态序列化与既有记忆管线
                }}
              />
            );
          })()
        : null}
      {layer?.view === 'rp-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.packet ? <RedPacketDetailPage me={me} peer={peer} msg={m} onBack={() => setLayer(null)} onToast={onToast} /> : null;
          })()
        : null}
      {layer?.view === 'tr-receive'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.packet ? (
              <TransferReceivePage
                peer={peer}
                msg={m}
                onBack={() => setLayer(null)}
                onAccept={(id) => {
                  const p = m.packet;
                  // 收款：标记原卡已收款（receiptOf=peer，我收的） + 入钱包余额 + 追加我的「已收款」接收卡片（与 AI 收我转账时的接收卡片同款、方向相反）
                  patchPacket(id, { received: true, receivedAt: Date.now(), receiptOf: 'peer' });
                  if (p) gainToWallet(p.amount, `转账-来自${peer.name}`, { kind: 'transfer', avatar: peer.avatar });
                  setMsgs((prev) => [
                    ...prev,
                    {
                      id: uid(),
                      role: 'me',
                      content: '',
                      time: Date.now(),
                      kind: 'transfer',
                      packet: { type: 'transfer', amount: p?.amount ?? 0, note: p?.note ?? '', received: true, receivedAt: Date.now(), receiptOf: 'peer' },
                    },
                  ]);
                  onToast(`已收款 ${fmtMoney(p?.amount ?? 0)} 元`);
                  setLayer({ view: 'tr-detail', msgId: id });
                  // 用户收款后 AI 不再自动跟发；AI 感知来自聊天历史卡片终态序列化与既有记忆管线
                }}
                onRefund={() => {
                  // 收款页「退还」：原卡标记已退回（变灰）+ 通知行 + toast（AI 感知走卡片终态序列化/记忆管线，不即时跟发）
                  refundPeerCard(m);
                }}
              />
            ) : null;
          })()
        : null}
      {layer?.view === 'tr-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            if (!m?.packet) return null;
            // 收款人是否为「我」：receiptOf 精准标记优先；旧数据按角色兑底——
            // 我的卡片（receiptOf 缺失）只会是「我发出的原卡（对方收）」；对方卡片且已收款的只会是「我收的旧凭据」
            const p = m.packet;
            let receiverIsMe: boolean;
            if (p.receiptOf) receiverIsMe = p.receiptOf === 'peer';
            else if (m.role === 'me') receiverIsMe = false;
            else receiverIsMe = p.received === true;
            return (
              <TransferDetailPage
                me={me}
                peer={peer}
                msg={m}
                receiverIsMe={receiverIsMe}
                onBack={() => setLayer(null)}
                onToast={onToast}
                onAccept={(id) => {
                  // 详情页收款（兑底路径）：标记 + 入余额 + 追加我的「已收款」接收卡片
                  patchPacket(id, { received: true, receivedAt: Date.now(), receiptOf: 'peer' });
                  if (p) gainToWallet(p.amount, `转账-来自${peer.name}`, { kind: 'transfer', avatar: peer.avatar });
                  setMsgs((prev) => [
                    ...prev,
                    {
                      id: uid(),
                      role: 'me',
                      content: '',
                      time: Date.now(),
                      kind: 'transfer',
                      packet: { type: 'transfer', amount: p?.amount ?? 0, note: p?.note ?? '', received: true, receivedAt: Date.now(), receiptOf: 'peer' },
                    },
                  ]);
                  // 用户兜底收款后 AI 不再自动跟发；AI 感知来自聊天历史卡片终态序列化与既有记忆管线
                }}
              />
            );
          })()
        : null}
      {layer?.view === 'fam-detail'
        ? (() => {
            const m = msgs.find((x) => x.id === layer.msgId);
            return m?.fam ? (
              <FamilyDetailPage
                peer={peer}
                msg={m}
                onBack={() => setLayer(null)}
                onToast={onToast}
                onClaim={claimFam}
                onRefund={m.role !== 'me' ? () => refundPeerCard(m) : undefined}
              />
            ) : null;
          })()
        : null}
      {layer?.view === 'mtpay-detail' ? <MtProxyDetailPage pid={layer.pid} canPay onBack={() => setLayer(null)} onToast={onToast} /> : null}
      {layer?.view === 'tbpay-detail' ? <TbProxyDetailPage pid={layer.pid} canPay onBack={() => setLayer(null)} onToast={onToast} /> : null}
      {/* 快递页（加号面板「快递」入口）：列出已确认收货的淘宝订单 → 分享给当前聊天好友 */}
      {layer?.view === 'express' ? (
        <TbExpressPicker
          onBack={() => setLayer(null)}
          onShare={(order) => {
            void tbCreateOrderShare({ order, idp: 'qq', contactId: peer.id, fromName: me.name })
              .then((res) => {
                if (res.ok) {
                  setLayer(null);
                  onToast(`已把「${order.shopName}」的快递分享给${res.share.contactName}`);
                } else {
                  onToast(res.error);
                }
              })
              .catch(() => onToast('分享失败，请重试'));
          }}
        />
      ) : null}
      {layer?.view === 'location' ? (
        <LocationPickerPage
          onClose={() => setLayer(null)}
          onSend={(loc) => {
            // 40-a 拉黑拦截：被角色拉黑（byChar）后位置也发不出
            if (loadBlock('qq', peer.id).byChar) {
              onToast('对方已将你拉黑，无法发送');
              return;
            }
            setMsgs((prev) => [...prev, { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'location', loc }]);
            setLayer(null);
            onToast('位置已发送');
          }}
        />
      ) : null}
      {/* 线下模式（约会）：从聊天继续，承接最近 N 条线上聊天（五角星入口，与微信/信息共用同一页面组件） */}
      {layer?.view === 'offline' ? (
        <OfflineMeetingPage
          app="qq"
          channel="QQ"
          contactId={peer.id}
          userName={addressNameOf(me, useSettings.getState().addressMode)}
          userRealName={me.realName ?? me.name}
          userAvatar={me.avatar}
          loadRecentMsgs={(n: number): OfflineOnlineMsg[] =>
            msgs
              .slice(-n)
              .map((m): OfflineOnlineMsg | null => {
                if (m.role !== 'me' && m.role !== 'peer') return null;
                const kind = m.kind ?? 'text';
                let text = '';
                if (kind === 'text') text = m.content;
                else if (kind === 'sticker') text = '[表情包]';
                else if (kind === 'image') text = '[图片]';
                else if (kind === 'voice') text = m.voice?.transcript?.trim() || '[语音]';
                else if (kind === 'redpacket') text = '[红包]';
                else if (kind === 'transfer') text = '[转账]';
                else if (kind === 'family') text = '[亲属卡]';
                else if (kind === 'location') text = `[位置] ${m.loc?.name ?? ''}`;
                else if (kind === 'call') text = '[语音通话]';
                else return null; // notice/sys/blockreq/forward/groupcard 不进线下上下文
                if (!text.trim()) return null;
                return { role: m.role, text, time: m.time };
              })
              .filter((m): m is OfflineOnlineMsg => m !== null)
          }
          onBack={() => setLayer(null)}
          onToast={onToast}
        />
      ) : null}
      {/* 文字图片弹层（加号面板「文字图片」入口；Task 14 卡片版，以「我」的身份发出） */}
      {layer?.view === 'textcard' ? (
        <QqTextCardSheet
          charName={peer.name}
          busy={cardBusy}
          error={cardError}
          onClose={() => (cardBusy ? undefined : setLayer(null))}
          onSubmit={(t) => void submitTextCard(t)}
        />
      ) : null}
      {/* 点击「文字图片」卡片弹出的操作面板：用图像生成生成图片 / 复制文字（三端共用组件） */}
      {(() => {
        const am = cardActionId ? msgs.find((x) => x.id === cardActionId && x.card) : null;
        return am?.card ? (
          <TextCardActionSheet
            text={am.card.text}
            busy={cardGenBusy}
            accent="#0099FF"
            onGenerate={(d) => void generateCardImage(am, d)}
            onToast={onToast}
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
            accent="#0099FF"
            onDescChange={setRegenImgDesc}
            onSubmit={() => void submitImgRegen()}
            onClose={() => (regenImgBusy ? undefined : setRegenImgId(null))}
          />
        ) : null;
      })()}
      {/* 图片大图查看器（点图片气泡打开；点任意处关闭）：黑底居中大图，与信息端同款观感 */}
      {imgViewer && (
        <div
          className="absolute inset-0 z-[90] flex items-center justify-center bg-black/90"
          data-testid="qq-img-viewer"
          role="dialog"
          aria-label="图片预览"
          onClick={() => setImgViewer(null)}
        >
          <img src={imgViewer} alt="图片预览" className="max-h-[80%] max-w-[92%] rounded-[6px] object-contain" />
        </div>
      )}
      {/* 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘） */}
      {gate ? (
        <PayPwdGate
          label={`${gate.kind === 'redpacket' ? '发红包' : `向${peer.name}转账`} ${fmtMoney(gate.packet.amount)} 元 · ${methodLabel(gate.methodId)}`}
          onOk={() => {
            const g = gate;
            setGate(null);
            execAndSend(g.kind, g.packet, g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      ) : null}

      {/* 角色状态卡（点击消息行对方头像弹出；关闭不影响聊天，内容不写记忆除非主动存入） */}
      <PeerStatusCard
        open={peerStatusOpen}
        onClose={() => setPeerStatusOpen(false)}
        contact={peer}
        app="qq"
        bondHint={peerStatusOpen ? bondHintTextOf(peer.id) : null}
      />

      {/* 聊天设置页（右上角菜单进入）：信息卡片/置顶聊天/消息免打扰/回复条数/查找聊天记录/聊天背景 */}
      {settingsOpen ? (
        <ChatSettingsPage
          variant="qq"
          title="聊天设置"
          contactId={peer.id}
          peerName={peer.name}
          peerAvatar={peer.avatar}
          idLabel="QQ号"
          idValue={peer.qqId || '未设置'}
          metaLine={[peer.region, peer.occupation].filter((x): x is string => Boolean(x)).join(' · ')}
          remark={remarkForApp(peer, 'qq')}
          relation={relationLocal ?? relationForAccount(peer, 'qq')}
          onSaveRelation={peer.id === me.id ? undefined : (v) => {
            // 多账号关系感知：关系落当前 QQ 账号作用域（大号=全局 relation，小号=relationByAcc）；
            // peer 为快照，保存后乐观更新本地显示值（重进会话/切号后自动重读准确值）
            setRelationLocal(v);
            void setAppRelation('qq', peer.id, v).catch(() => undefined);
          }}
          onSaveRemark={(v) => {
            void onSaveRemark(v);
          }}
          voiceSummary={describeVoiceId(peer.voiceId, myVoicesForSummary)}
          onOpenVoice={() => setVoiceOpen(true)}
          onOpenProactive={peer.id === me.id ? undefined : () => setProactiveOpen(true)}
          onOpenPerception={peer.id === me.id ? undefined : () => setPerceptionOpen(true)}
          perceptionSummary={perceptionSummary(sessionKey)}
          proactiveSummary={proactiveCfgSummary('qq', peer.id)}
          pinned={flags.pinned === true}
          muted={flags.muted === true}
          bg={bg}
          bgImageUrl={bgImageUrl}
          replyCount={replyCount}
          translateSummary={
            transCfg.on
              ? `${translateLangLabel(transCfg.left)} ⇄ ${translateLangLabel(transCfg.right)}`
              : '未开启'
          }
          sentenceSend={sentenceSend}
          timeAware={timeAware}
          stickersOn={stickersOn}
          actionDescOn={actionDescOn}
          // 深度思考（IndexedDB 按联系人隔离）：开关只控制思维链卡片展示，思考指令始终注入
          deepThinkOn={deepThinkOn}
          onToggleDeepThink={(v) => setDeepThinkOn(peer.id, v)}
          enterSend={enterSend}
          onToggleEnterSend={(v) => setEnterSend('qq', v)}
          onToggleActionDesc={(v) => saveActionDescOn(sessionKey, v)}
          onBack={() => setSettingsOpen(false)}
          onTogglePinned={(v) => qqChatFlagsStore.update(peer.id, { pinned: v })}
          onToggleMuted={(v) => qqChatFlagsStore.update(peer.id, { muted: v })}
          blockedByUser={blk.byUser === true}
          onToggleBlock={peer.id === me.id ? undefined : toggleBlockFromSettings}
          onDeleteContact={peer.id === me.id ? undefined : onDeleteContact}
          onOpenReplyCount={() => setReplyOpen(true)}
          onOpenTranslate={() => setTranslateOpen(true)}
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
          onToggleStickers={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）：关闭后 AI 不发表情包也不发 emoji
            saveStickersOn(sessionKey, v);
            setStickersOnState(v);
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenBg={() => setBgOpen(true)}
          onOpenWorldBooks={() => setWbOpen(true)}
          worldBooksSummary={loadBooks()
            .filter((b) => wbBound.includes(b.id))
            .map((b) => b.name)
            .join('、') || '未选择'}
          onOpenPeerProfile={onOpenFriendProfile}
        />
      ) : null}

      {/* 主动发消息设置页（聊天设置二级页）：定时/事件/自主/提醒四类触发（每角色独立） */}
      {proactiveOpen ? <ProactiveMsgPage variant="qq" contactId={peer.id} contactName={peer.name} onBack={() => setProactiveOpen(false)} /> : null}

      {/* 感知设置页（聊天设置二级页）：打字/电量/天气/日历/ActivityWatch 真机感知/看屏（按会话独立） */}
      {perceptionOpen ? <PerceptionSettingsPage variant="qq" sessionKey={sessionKey} peerName={peer.name} onBack={() => setPerceptionOpen(false)} /> : null}

      {/* 世界书挂载页（聊天设置二级页）：为联系人勾选挂载的书籍（按联系人隔离持久化） */}
      {wbOpen ? (
        <WorldBookPickerPage
          variant="qq"
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
            setBoundBookIds(peer.id, ids);
            setWbBound(ids);
          }}
        />
      ) : null}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen ? (
        <ChatTranslatePage
          variant="qq"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      ) : null}

      {/* 回复条数页（聊天设置二级页）：AI 按选定条数连发多条消息（按会话隔离保存） */}
      {replyOpen ? (
        <ChatReplyCountPage
          variant="qq"
          value={replyCount}
          onBack={() => setReplyOpen(false)}
          onSelect={(n) => {
            saveReplyCount(sessionKey, n);
            setReplyCountState(n);
          }}
        />
      ) : null}

      {/* 他的声音页（聊天设置二级页）：角色音色选择（内置/我的/API）+ AI 语音频率入口 */}
      {voiceOpen ? (
        <ChatVoicePage
          variant="qq"
          peerName={peer.name}
          voiceId={peer.voiceId ?? ''}
          voiceFreq={getAiVoiceFreq(sessionKey)}
          onBack={() => setVoiceOpen(false)}
          onSelect={(vid) => {
            void onSaveVoiceId(vid);
            setVoiceOpen(false);
          }}
          onOpenFreq={() => setVoiceFreqOpen(true)}
        />
      ) : null}

      {/* AI 语音频率页（他的声音二级页）：关闭/每条/经常/偶尔/不经常（按会话隔离保存） */}
      {voiceFreqOpen ? (
        <ChatVoiceFreqPage
          variant="qq"
          value={getAiVoiceFreq(sessionKey)}
          onBack={() => setVoiceFreqOpen(false)}
          onSelect={(f) => {
            saveAiVoiceFreq(sessionKey, f);
            setVoiceFreqOpen(false);
          }}
        />
      ) : null}

      {/* 聊天背景页（聊天设置二级页）：预览卡片 + 从手机相册上传 + 内置纯色壁纸 */}
      {bgOpen ? (
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
      ) : null}

      {/* 查找聊天记录页：关键词过滤 → 点击结果定位回聊天页并高亮 */}
      {searchOpen ? (
        <ChatSearchPage
          variant="qq"
          items={searchItems}
          myName={me.name}
          peerName={peer.name}
          myAvatar={me.avatar}
          peerAvatar={peer.avatar}
          onClose={() => setSearchOpen(false)}
          onJumpTo={jumpToMessage}
        />
      ) : null}
      {/* 相册选图隐藏 input（工具栏图片按钮）+ 原生相机隐藏 input（拍摄按钮 capture 直调后置摄像头）：选图先入待发预览条，不直接发出 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="qq-chat-file"
        onChange={(e) => {
          void stageImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="qq-chat-camera"
        onChange={(e) => {
          void stageImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2C31]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="qq-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#1E6FFF] active:bg-black/5 dark:text-[#4AA3FF] dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；点弹层以外任意处关闭不执行） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="qq-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[84px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="qq-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="qq-fwd-each"
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
              data-testid="qq-fwd-merge"
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

      {/* 转发目标选择（转发流程第二步：聊天内勾选完 → 逐条/合并 → 选会话） */}
      {fwdFlow === 'target' && (
        <div className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40" data-testid="qq-fwd-target-layer">
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto">
              {forwardTargets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`qq-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, { id: c.id, name: c.name, avatar: c.avatar, self: c.id === me.id })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">{c.id === me.id ? `${c.name}（我自己）` : c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="qq-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开） */}
      {(() => {
        const d = fwdDetailId ? msgs.find((x) => x.id === fwdDetailId) ?? null : null;
        if (!d || d.kind !== 'forward' || !d.fwd?.merged) return null;
        const records = d.fwd.records ?? [];
        /** 头像实时读取：转发记录里的头像快照 → 联系人/机主还在就显示当前头像
         *  （换头像立即同步）；联系人已删除才回退快照原值，最后按说话人角色兜底 */
        const resolveAvatar = (r: FwdRecord): string | null => {
          if (r.name === me.name) return me.avatar;
          const hit = r.name ? contacts.find((c) => displayNameOf(c) === r.name || c.name === r.name) : undefined;
          if (hit) return hit.avatar;
          if (r.avatar !== undefined) return r.avatar;
          return r.role === 'me' ? me.avatar : peer.avatar;
        };
        return (
          <div className="absolute inset-0 z-[65] flex flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-fwd-detail">
            <div className="shrink-0 bg-white pt-[54px] dark:bg-[#16171A]">
              <div className="flex h-11 items-center px-2">
                <button type="button" aria-label="返回" data-testid="qq-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="active:opacity-60">
                  <ChevronLeft className="h-7 w-7" strokeWidth={2} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              {/* 逐条记录：行间分割线 */}
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <QqAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      {/* 名字在左、时间顶到最右 */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {/* 表情包/图片显示原图；其余类型（文字/红包/转账/亲属卡/位置）显示快照文字 */}
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="qq-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[10px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="qq-fwd-detail-image"
                          className="mt-0.5 max-h-[190px] w-auto max-w-[210px] rounded-[12px] object-cover"
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

      {/* 气泡长按菜单（默认：横向深色卡片；液态：竖排列表乳白玻璃浮层；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="qq-menu"
          liquid={liquid}
        />
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

      {/* 语音通话已迁移到全局通话层（PhoneShell › GlobalCallLayer）：加号面板/通话卡片回拨/AI 来电
          均经 openVoiceCall → startGlobalCall 发起，退出聊天页电话不断；结束时 writeCallCard 落卡片 */}

      {/* 页内 toast（收藏成功/取消收藏/已复制/已转发给 xx 等操作提示） */}
      <LocalToast msg={chatToast} />
    </div>
  );
}
