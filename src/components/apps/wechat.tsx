'use client';

/**
 * 微信 App：
 * - 登录：账号数据来自「联系人 App」中 kind = user 的联系人
 *   ① 手机号 + 微信密码 ② 微信号 / QQ 号 + 对应密码（本地 IndexedDB 联系人校验，不调服务端）
 * - 登录后：微信 / 通讯录 / 发现 / 我 四个 tab + 好友 AI 聊天 + 朋友圈（发布/点赞/评论）+ 好友朋友圈 + 添加朋友 + 设置（退出登录）
 * - 通讯录与「信息」App 一致：只有添加过的微信好友（friendWx，独立于 QQ/信息）才显示；首次登录只有「我」自己
 * - char / npc 账号暂不支持登录（本地校验拦截）
 */

import { Fragment, useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AtSign,
  AudioLines,
  Banknote,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  AppWindow,
  CirclePlus,
  Clock,
  EyeOff,
  Forward,
  Gift,
  Globe,
  Heart,
  Headphones,
  Image as ImageIcon,
  Loader2,
  MailOpen,
  MapPin,
  MessageCircle,
  Mic,
  Newspaper,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Package,
  Plus,
  QrCode,
  Radar,
  ScanLine,
  Search,
  Smartphone,
  Smile,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Undo2,
  User,
  UserPlus,
  Users,
  Video,
  Wallet,
  X,
  Bell,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { addFavorite, isMsgFavorited, loadFavorites, removeFavorite, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { useSettings, useUI } from '@/lib/ios/store';
import { ScanOverlayWhen, openScan } from './mt-scan';
import { pushChatNotification, notifyPreviewText, takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, markDeliverBoundary, peekPendingMsgs, purgeDeliveryQueueByPrefix, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { cleanTextForTts, stopSpeaking } from '@/lib/ios/tts-client';
import { decideAiVoiceMessage, synthesizeAiVoice, getAiVoiceFreq, saveAiVoiceFreq, aiVoiceFreqLabel, undoLastAiVoiceDecision } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { RecordOverlayWx, SttPreviewOverlay, VoiceHoldBar, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildImagePlaceholderRule, buildVoicePlaceholderRule } from '@/lib/chat-media-rules';
import { splitVisionDesc } from '@/lib/vision-client';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback, VOICE_PLAY_ERROR_EVENT } from '@/lib/ios/voice-player';
import { groupPreview, getGroup, listGroups, loadGroupMsgs, updateGroup as updateGroupRecord, dissolveGroup as dissolveGroupRecord, quitGroup as quitGroupRecord, effectiveInterop, type ChatGroup } from '@/lib/ios/groups';
import { WxGroupChatPage, WxGroupCreatePage, WxGroupInfoPage, WxGroupListPage, GroupAvatar, groupRowId } from './wx-group';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, computeBubbleMenuPosLiquid, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';
import { WxPhotoStack, WxPhotoViewer, findPhotoStackSpans, type PhotoStackItem } from './photo-stack';
import { LocalToast, useLocalToast } from './page-toast';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { CHAT_PARSE_FAIL_TEXT, CHAT_UNKNOWN_FAIL_TEXT, classifyChatError, cooldownRemainText, lastChatErrorDetail, recordChatFail, recordChatSuccess } from '@/lib/chat-errors';
import { CHAT_DRAFT_MAX, clearChatDraft, getChatDraft, saveChatDraft } from '@/lib/ios/chat-drafts';
import { ChatErrorLine } from './chat-error-line';
import { MtPayBubble, MtProxyDetailPage } from './mt-proxy-detail';
import { MT_PROXY_CARD_EVENT } from '@/lib/ios/mt-proxy-pay';
import { MT_SHARE_CARD_EVENT } from '@/lib/ios/mt-order-share';
import { MtShareBubble } from './mt-share-card';
import { TbPayBubble, TbProxyDetailPage, TbShareBubble } from './tb-share-cards';
import { WxGiftCardBubble, WxGiftPicker, WxGiftReceiveSheet, type WxGiftData } from './wx-gift';
import { TB_PROXY_CARD_EVENT, TB_SHARE_CARD_EVENT, tbGetProxy, tbProxyHistoryLine, tbProxyMeHistoryLine, tbReshareProxy, tbCreateOrderShare, stripTbEchoText } from '@/lib/ios/tb-share-proxy';
import { FORUM_SHARE_CARD_EVENT, buildForumShareCardMsg, forumShareHistoryLine, noteForumLinkSharedToChat, resolveForumLinkPost } from '@/lib/ios/forum-share';
import { ForumShareBubble } from './forum/share-card';
import { tbShareHistoryLine } from '@/lib/ios/tb-share-proxy';
import { TbDraftBubble } from './tb-draft-card';
import { applyTbEngageAction, buildTbEngageCtx, isTbEngageActionKind, tbCustomProductFromText, tbDraftHistoryLine, tbFallbackCardId, tbFallbackShouldFire, tbPickProductForText } from '@/lib/ios/tb-ai-engage';
import { tbMarkOrderGifted } from '@/lib/ios/taobao-store';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import {
  abortStreamsByPrefix,
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  subscribeChatStreamFinalized,
  useChatStream,
  useChatStreamFinalized,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import {
  WxIcMoments,
  WxIcChannels,
  WxIcScan,
  WxIcListen,
  WxIcStories,
  WxIcSearch,
  WxIcGames,
  WxIcServices,
  WxIcFavorites,
  WxIcWorks,
  WxIcSticker,
  WxIcTheme,
  WxIcSettings,
  WxTabCompassIcon,
} from './wx-icons';
import {
  RtChatIcon,
  RtContactsIcon,
  RtDiscoverIcon,
  RtMeIcon,
  RetroIc,
  RETRO_ICON_TONES,
  RtWMoments,
  RtWChannels,
  RtWScan,
  RtWListen,
  RtWStories,
  RtWSearch,
  RtWGames,
  RtWTheme,
  RtWWallet,
  RtWFavorites,
  RtWWorks,
  RtWSticker,
  RtWSettings,
  RtWShop,
  RtPlusCamera,
  RtPlusImage,
  RtPlusVoice,
  RtPlusRedPacket,
  RtPlusTransfer,
  RtPlusLocation,
  RtPlusOffline,
  RtPlusTextCard,
  RtPlusTogether,
  RtPlusGift,
  RtPlusVideo,
} from './retro-icons';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import {
  buildRichRules,
  buildActionRules,
  buildMomentPostRule,
  buildVisionRules,
  cleanBubbleText,
  stripMsgHandleText,
  extractRichActionParts,
  actionVerb,
  mergeRichSegments,
  parseRichParts,
  prettifyRichText,
  splitImageIdRefs,
  isQuitWinbackAction,
  isGroupSocialAction,
  type PendingCardInfo,
  type RichAction,
  type RichMsg,
  type RichSong,
} from '@/lib/chat-rich';
import SongMsgBubble from './song-msg-bubble';
import { triggerInviteFromChat } from '@/lib/ios/together-invite';
import { sendUserTogetherInvite, TG_CARD_INSERTED_EVENT, type TgCardMsg } from '@/lib/ios/together-flow';
import { TogetherInviteSheet } from './together-invite-sheet';
import { songArtistText, songCover } from '@/lib/ios/music-api';
import { useMusic, mediaProxyUrl } from '@/lib/ios/music-store';
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
import {
  applyGroupCardDecision,
  applyGroupSocialAction,
  buildGroupSocialRules,
  buildKickNoticeSection,
  ensureGroupSocialHooks,
  setGroupSocialContacts,
  type GroupCardData,
} from '@/lib/ios/group-social';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
import { applyMtEngageAction, buildMtEngageCtx, isMtEngageActionKind, mtDraftHistoryLine, mtOrderShareHistoryLine, mtProxyHistoryLine, parseMtAskFromText, stripMtEchoText } from '@/lib/ios/mt-ai-engage';
import { MtDraftBubble } from './mt-draft-card';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
import { getStickersOn, saveStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { getActionDescOn, saveActionDescOn, useActionDescOn, ACTION_DESC_RULE, ACTION_DESC_OFF_RULE, actionDescViewOf } from '@/lib/action-desc';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
import { DEEP_THINK_RULE, extractThinkBlocks, setDeepThinkOn, useDeepThinkOn } from '@/lib/deep-think';
import { ThinkCard, ThinkLiveCard } from './think-card';
import { ActionDescLine } from './action-desc-line';
import { stripEmojiCodes, EMOJI_CODE_RULE } from '@/lib/ios/emoji-codes';
import { InlineEmojiText } from './inline-emoji';
import { ChatRichInput, type ChatRichInputHandle } from './chat-rich-input';
import { stripEmojiText } from '@/lib/emoji';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { useEnterSend, setEnterSend, guardEnterToSend } from '@/lib/enter-send';
import { kvGet, kvGetRaw, kvSet, kvSetDebounced, kvDel } from '@/lib/ios/idb-kv';
import { getMemSettings, memAddEventFragment, memAfterAiTurn, memChatRecallBlock, memConvoFromRaw, memPurgeMessageSources, memResetConvoCounters, setMemScopeForApp } from '@/lib/memory';
import { aiWriteLetterOnRequest, coupleChatBlock, coupleLetterAskHit } from '@/lib/ios/couple-ai';
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
import { buildDynamicStateBlocks, noteMoodEvent } from '@/lib/ios/ai-mood';
import {
  addCharMomentPost,
  addUserMomentComment,
  addUserMomentPost,
  aiPostMoment,
  buildMomentsChatBlock,
  deleteMomentComment,
  deleteMomentPost,
  emitMomentsChanged,
  enqueuePostInteractions,
  isPostByPeer,
  listMomentNotices,
  listMomentPosts,
  markAllMomentNoticesRead,
  regenerateMomentImage,
  subscribeMomentsChanged,
  toggleUserMomentLike,
  upgradeMomentTextCard,
  updateMomentPostContent,
  type MomentNotice,
  type MomentRepostRef,
  markMomentAutoAttempt } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { buildForumChatBlock } from '@/lib/forum/social';
import { isPostMemoryOn } from '@/lib/forum/core';
import { AskPostSheet, BilingualTranslation, CommentDeleteDialog, EditPostDialog, MomentAutoCfgSheet, MomentInteractionsPage, MomentsEmojiPanel, insertEmojiAtCursor, momentFriendsOf } from './moments-shared';
import { MomentsSettingsPage } from './moments-settings';
import { ThemeStylePage } from './bubble-style-settings';
import { liquidTabLabel, LIQUID_TABS, type LiquidTabKey } from '@/lib/ios/liquid-skin';
import { fmtMsgTime, readTextOf, useChatDisplay, type ChatDisplayConfig } from '@/lib/ios/chat-display';
import { BubbleTail } from './bubble-tail';
import { bubbleVisual, isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
import { chatContactKey, chatCssScopeSelector, scopeCss } from '@/lib/ios/custom-css';
import { ChatSkinProvider, useChatSkin } from '@/lib/ios/chat-skin';
import { chatPlaceholder, resolveQuickKeys } from '@/lib/ios/chat-decor';
import { ChatQuickBar, type QuickBarItem } from './chat-quick-bar';
import { StackFitText } from './shrink-text';
import { getMomentsSettings } from '@/lib/ios/moments-settings';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accountLoginHistory, accLs, clearForceLoginWall, createAccount, deleteAccount, getAccounts, getActiveAccountFor, getActiveAccountIdFor, isForceLoginWallActive, markAccountLoginHistory, requestForceLoginWall, switchAccountFor, type PhoneAccount } from '@/lib/ios/accounts';
import { loginAltSlot, loginWechat, listContacts, getWxBg, setWxBg, getChatBgImage, setChatBgImage, removeChatBgImage, listContactsFor, mainOwnerContact, ownerRealNameFor, contactRealName, updateContact, getPeerBg, setPeerBg, removePeerBg, setAppRelation, cachedOwnerName } from '@/lib/ios/contacts-store';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
import { listAlbums, listAlbumsForChat, addAlbum, getAlbum, addVisionDecision } from '@/lib/ios/album-store';
import { ensureAlbumDescs } from '@/lib/ios/album-vision';
import { buildAvatarBlock, ensureAvatarDesc, noteAvatarChanged } from '@/lib/ios/avatar-ai';
import { buildPhotoDescHistory, buildPhotoTagRule, downloadImageSrc, extractPhotoTags, generateCharacterPhoto, imgGenConfigReady, notePhotoMemory, splitUnfinishedPhotoTag, stripUnfinishedPhotoTag, type PhotoTag } from '@/lib/imggen';
import { autoCardText } from '@/lib/textcard';
import { TextCardActionSheet, TextCardBubble } from '@/components/apps/text-card-bubble';
import { ImageRegenSheet } from '@/components/apps/image-regen-sheet';
import type { AlbumRecord } from '@/lib/ios/db';
import AlbumPage from './album';
import OfflineMeetingPage from '@/components/apps/offline-meeting';
import type { OfflineOnlineMsg } from '@/lib/offline-meet';
import { addressNameOf, avatarFor, contactByRef, displayNameOf, isFriendIn, liveAvatarOf, withDisplayNames, activeAccountIdOf, relationForAccount, remarkForApp, socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import {
  addFriendReq,
  deletedFriendIds,
  friendDelStateOf,
  isFriendDeleted,
  loadFriendReqs,
  rejectFriendReq,
  removeFriendByUser,
  restoreFriendship,
  runFriendReqCatchUp,
  saveFriendReqs,
  setFriendReqStatus,
  SOURCE_SEARCH_WX,
  subscribeFriendReqs,
  updateFriendReq,
  appendReqThread,
  genCharThreadReply,
  charWelcomeReplyToApply,
  processAltFriendReq,
  shouldUseAltDecisionFlow,
  clearFriendDelState,
  FRIEND_STATE_APPLIED_EVENT,
  type FriendReqEntry,
  type FriendReqExtras,
  type FriendReqThreadMsg,
} from '@/lib/ios/friend-state';
import PeerStatusCard from '@/components/apps/peer-status-card';
import CoupleRelBubble from '@/components/apps/couple-rel-bubble';
import CouplePactBubble from '@/components/apps/couple-pact-bubble';
import CoupleExamBubble from '@/components/apps/couple-exam-bubble';
import CoupleLetterBubble from '@/components/apps/couple-letter-bubble';
import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import {
  COUPLE_CARD_EVENT,
  decideCoupleCard as decideCoupleCardAction,
  type CoupleRelCardData,
} from '@/lib/ios/couple-invite';
import { AI_PRODUCT_IMG_EVENT } from '@/lib/ios/ai-product-img';
import {
  DEFAULT_STICKER_GROUP_ID,
  extractMeaningFromUrl,
  fileNameMeaning,
  isImageUrl,
  loadStickerGroups,
  loadStickers,
  newStickerId,
  saveStickerGroups,
  saveStickers,
  stickerGroupOf,
} from '@/lib/ios/stickers';
import type { Sticker, StickerGroup } from '@/lib/ios/stickers';
import { useUnreadMap, wxUnreads as wxUnreadStore } from '@/lib/unread-store';
import { consumeBgPending, onBgPageVisible, peekBgBadgeCounts, pullBgPending, registerBgSession, unregisterBgSession, type BgPendingItem } from '@/lib/ios/bg-turn';
import { useChatFlags, NO_FLAGS, wxChatFlags as wxChatFlagsStore } from '@/lib/chat-flags';
import {
  ChatBgPage,
  ChatReplyCountPage,
  ChatSearchPage,
  ChatSettingsPage,
  ChatTranslatePage,
  ChatVoiceFreqPage,
  ChatVoicePage,
  FriendDeleteConfirmDialog,
  WorldBookPickerPage,
  ChatToggle,
  chatBgLayerStyle,
  type ChatSearchItem,
  type ChatSettingsBg,
} from './chat-settings';
import { ProactiveMsgPage } from './proactive-msg-page';
import { proactiveCfgSummary, parseReminderInstruction, reminderHintHit, reminderSysHint, buildReminderSysMsg, setActiveProactiveChat } from '@/lib/ios/proactive-msg';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { buildBranchPromptBlock, deleteCharacterBranch, formatBranchDate, getBranchMeta } from '@/lib/ios/branch';
import { BranchDeleteConfirmDialog, BranchDialog } from './branch-dialog';
import { BatchStickerSheet, makeStickerGroup, StickerGroupBar, StickerGroupManageSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import { StickerSearchSheet } from './sticker-search-sheet';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';
import {
  WxServices,
  fmtMoney,
  loadJSON,
  saveJSON,
  LS_WALLET,
  LS_BILLS,
  loadCards,
  BankDot,
  loadFamilyCards,
  loadFamilyCardsIn,
  resetFamilyCardsInMonth,
  saveFamilyCards,
  saveFamilyCardsIn,
  wxLoadPayPwd,
  WxPayPwdGate,
  recordFcSpend,
  type WxCard,
  type WxFamilyCard,
  type WxFamilyCardIn,
  type WxFcPayPart,
  type WxFcPayResult,
} from './wechat-wallet';
import { CallCardBubble, callResultToCardState, callCardAiText, type CallCardState } from './voice-call-screen';
import { hasVideoCallMark, hasVoiceCallMark, stripVideoCallMark, stripVoiceCallMark, type ChatCallResult, type ChatCallTurnMsg } from '@/lib/ios/chat-call';
import { startGlobalCall, useGlobalCall } from '@/lib/ios/global-call';
import { triggerIncomingCall, useIncomingCall } from '@/lib/ios/incoming-call';
import { buildLocationBlock, locationAiText, locDataOf, locFromRich, type ChatLocData } from '@/lib/ios/chat-location';

// ---------------- 类型 / 常量 / 工具 ----------------

interface WxUser {
  id: string;
  /** 微信内显示名（备注/昵称优先；非真实姓名） */
  name: string;
  /** 真实姓名（联系人 name 字段；AI 称呼与记忆统一用它，展示不用） */
  realName?: string | null;
  /** 昵称（联系人 nickname 字段；只是昵称，不是另一个人也不是正式名字） */
  nickname?: string | null;
  avatar: string | null;
  wechatId: string | null;
  phone: string | null;
  qqId: string | null;
  /** 多账号 Task 41：非空 = 登录身份是小号/匿名号档案（注册表账号 id），handleLogin 据此切账号作用域 */
  altOf?: string | null;
}

interface WxRpData {
  amount: number;
  blessing: string;
  /** 是否已被領取（領取后金额存入零钱） */
  opened: boolean;
  openedAt?: number;
  /** 领取人名字（我领 AI 的→我；AI 领我发的→对方）；仅单人群场景 */
  openedBy?: string;
  /** 退还/拒收终态（我退回 AI 发的红包，或 AI 退回/拒收我发的红包；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** AI 处理动作用的短 ID（我发给 AI 的红包才有；AI 在动作标记里引用它） */
  cid?: string;
}

interface WxTrData {
  amount: number;
  note: string;
  /** 对方是否已收款（打开详情时模拟对方确认） */
  received: boolean;
  receivedAt?: number;
  /** 接收卡片凭据：'me'=这张卡是对方收我转账的凭据；'peer'=这张卡是我收对方转账的凭据（详情页文案按此区分「××已收款 / 你已收款」） */
  receiptOf?: 'me' | 'peer';
  /** 退还/拒收终态（我退回 AI 发的转账，或 AI 退回/拒收我发的转账；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** 退款时间（退还后写入；详情页「退款时间」行） */
  refundedAt?: number;
  /** 退还凭据卡专用：原转账发生时间（详情页「转账时间」行显示原转账时间） */
  originTime?: number;
  /** 退还凭据卡专用：退还人（'me'=我退的→详情显示「你已退还」；'peer'=对方退的→「对方已退还」）；原卡省略时按消息角色反推 */
  refundedBy?: 'me' | 'peer';
  /** AI 处理动作用的短 ID（我发给 AI 的转账才有） */
  cid?: string;
}

/** 聊天中的系统通知行（对方领取/退回/拒收了你的红包/转账/亲属卡、收下了你的礼物）：居中灰字 + 彩色尾词 */
interface WxNoticeData {
  /** 小图标：rp=红红包 / tr=橙转账 / fam=金亲属卡 / gift=蓝金礼物（第七轮反馈新增） */
  icon: 'rp' | 'tr' | 'fam' | 'gift';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 亲属卡消息数据（我赠送 / 好友赠送共用；点卡片进详情） */
interface WxFamData {
  /** 每月消费上限（元） */
  monthlyLimit: number;
  /** 关系（女朋友/爸爸…） */
  relation: string;
  /** 赠卡留言 */
  message: string;
  /** 是否已被领取（我发的→对方领；对方发的→我领） */
  claimed: boolean;
  claimedAt?: number;
  /** 本月已用额度（展示用） */
  used: number;
  /** 优先扣款方式（我发的卡展示） */
  method?: string;
  /** 被收卡方退还/拒收（终态，卡片变灰） */
  rejected?: boolean;
  /** AI 处理动作用的短 ID（我发给 AI 的亲属卡才有） */
  cid?: string;
}

interface WxMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  /** 已读未读回执（显示设置）：发送/投递时 true，对方回话时转 false；undefined = 旧数据，视为已读 */
  unread?: boolean;
  /** 消息类型：默认 text；红包/转账/亲属卡为卡片消息；image 图片；location 位置卡片；sticker 表情包；notice = 红包领取通知；forward = 转发卡片；groupcard = 群聊邀请卡片；relcard = 亲密关系卡片（情侣空间邀请卡/成功卡）；
   *  sys = 拉黑等系统提示（居中灰字胶囊，不进 AI 上下文）；blockreq = 角色发起的「申请解除拉黑」卡片；voice = 语音消息（voice 字段存音频/波形/时长/转写）；call = 语音通话卡片（call 字段存状态/时长/方向）；textcard = 文字图片卡片；mtpay = 美团找人代付卡片（请求/完成）；mtshare = 美团订单分享动态卡片；tbpay = 淘宝代付卡片（请求/完成）；tbshare = 淘宝订单分享动态卡片 */
  kind?: 'text' | 'redpacket' | 'transfer' | 'notice' | 'family' | 'image' | 'location' | 'sticker' | 'forward' | 'groupcard' | 'sys' | 'blockreq' | 'voice' | 'call' | 'textcard' | 'song' | 'mtpay' | 'mtshare' | 'mtdraft' | 'tbpay' | 'tbshare' | 'tbdraft' | 'relcard' | 'pactcard' | 'examcard' | 'lettercard' | 'giftcard' | 'forumshare';
  rp?: WxRpData;
  /** 礼物卡片数据（kind='giftcard'，第 20 轮替代原「快递」入口）：礼物快照随消息落库，
   *  accepted = 收礼弹窗里已点「收下礼物」（持久化，重开弹窗仍显示已收下） */
  gift?: WxGiftData;
  tr?: WxTrData;
  notice?: WxNoticeData;
  fam?: WxFamData;
  /** 歌曲卡片（kind='song'，Task 68 音乐 × AI）：name/artist 必填，cover/songId 落库时已知可带（免搜索），
   *  note = 分享语，autoPlay = AI 点播（投递后自动播放），invite = 同时触发过全局一起听邀请（防重复触发） */
  song?: { name: string; artist: string; cover?: string; songId?: number; note?: string; autoPlay?: boolean; inviteDone?: boolean; agree?: boolean };
  /** 图片消息（kind='image'）：src = 压缩 dataURL；desc = 识图描述（AI 历史可读「[图片]（图片内容：…）」，旧记录无此字段照常兼容）；
   *  fromCard = 文字图片卡片转出的图（长按可重新生成；AI 卡片转图带角色锁脸，我的卡片不带）；
   *  prevSrc = 「重新生成」替换前保留的旧图（长按菜单「恢复上一张」换回，可来回切换） */
  img?: { src: string; desc?: string; fromCard?: boolean; prevSrc?: string };
  /** 文字图片卡片数据（kind='textcard'）：印在卡片上的文字（AI 代笔/用户代写），无生图依赖 */
  card?: { text: string };
  loc?: { name: string; address: string; lat?: number; lng?: number };
  /** 系统提示行数据（kind = 'sys' 时有值）：拉黑/解除拉黑等状态变更提示。
   *  pat = 拍一拍事件（Task 30）：by='me' 我拍对方（self=我拍了自己）/ by='peer' 对方拍我，
   *  text = 拍一拍文案后缀——带 pat 的系统行进 AI 上下文（按双方真名序列化），让 AI 知道被拍/拍过谁与文案 */
  sys?: { text: string; pat?: { by: 'me' | 'peer'; self?: boolean; text?: string } };
  /** 申请解除拉黑卡片数据（kind = 'blockreq' 时有值）：status pending=待处理 accepted=已同意 rejected=已拒绝；
   *  40-a 起双向——from 缺省视为 'char'（角色发起，用户点同意/拒绝）；from='user'（用户发起，角色用标记决策） */
  blkreq?: { reason: string; status: 'pending' | 'accepted' | 'rejected'; from?: 'char' | 'user' };
  /** 表情消息（stk.url 图片，stk.meaning 意思，stk.sid 本地表情包唯一 ID——AI 上下文回写 [表情包:ID] 示范格式） */
  stk?: { url: string; meaning: string; sid?: string };
  /** 引用回复（长按菜单「引用」后发送时带上；气泡内嵌小引用块；AI 上下文带引用前缀）；
   *  id = 被引用源消息 ID（原消息删除/撤回后引用显示「原消息已删除」） */
  quote?: { name: string; content: string; id?: string; time?: number };
  /** 已撤回（渲染为居中灰字「你撤回一条消息 / 对方撤回一条消息」，不再参与上下文） */
  recalled?: boolean;
  /** 错误占位消息（历史遗留数据：旧版流失败/空回复落库的错误文案）：新版失败不再落占位消息，
   *  改为在触发的用户消息上打 replyFail 红色 ! 徽标；渲染层直接跳过 error 消息，
   *  记忆提取（memConvoFromRaw）仍按 error===true 剔除（防错误文案被当成 AI 发言参与记忆抽取） */
  error?: boolean;
  /** AI 回复失败标记（红色 ! 徽标）：流失败/空回复且本轮无任何产出时打在触发的我的消息上；
   *  点击徽标重试（runAiTurn），成功后 finalize 清除，仍失败可再点。不进 AI 上下文（消息本体照常参与） */
  replyFail?: boolean;
  /** Task 40 失败分类的友好文案（与 replyFail 同时打/清；渲染消息行下方居中灰字提示行用）：
   *  分类归一后的文案（网络不稳定/API Key 无效/请求太频繁/服务暂时不可用/请求超时/回复解析失败），
   *  非原始报错——原始错误只留内存供「复制错误详情」，不落库不进上下文/记忆 */
  failReason?: string;
  /** 转发卡片（kind='forward'；fwd.from = 来源会话联系人名；merged=true 为合并转发的「聊天记录」卡片，records 存原始对话） */
  fwd?: { from: string; merged?: boolean; title?: string; records?: { name: string; role: 'me' | 'peer'; text: string; quote?: string; time: number; avatar?: string | null; kind?: 'text' | 'sticker' | 'image'; imgSrc?: string; stkMeaning?: string }[] };
  /** 群聊邀请卡片（kind='groupcard'；AI 主动建群/拉人时发出，用户可接受/拒绝） */
  gcard?: GroupCardData;
  /** 亲密关系卡片（kind='relcard'；情侣空间邀请卡/成功卡，AI 邀我或我邀 AI 时由 couple-invite 落库，可接受/拒绝） */
  relcard?: CoupleRelCardData;
  /** 恋爱协议卡片（kind='pactcard'；第十二轮：协议分享/签署卡，由 couple-pact-share 落库，点击进情侣空间签署界面） */
  pactcard?: CouplePactCardData;
  /** 恋爱考试卡片（kind='examcard'；第十五轮：我喊TA答题/TA出卷喊我答，由 couple-exam-share 落库，点击进情侣空间试卷页） */
  examcard?: CoupleExamCardData;
  /** 情书信封卡片（kind='lettercard'；第十八轮：我分享情书给TA/TA寄信给我，由 couple-letter-share 落库，点击进情侣空间信件页） */
  lettercard?: CoupleLetterCardData;
  /** 语音消息（kind='voice'）：音频 dataURL 持久化在聊天记录里，重启后仍可播放 */
  voice?: VoiceMsgData;
  /** 语音通话卡片（kind='call'）：state 卡片状态 / duration 接通秒数 / direction 主叫方向（me=我拨打）；
   *  media（Task 22 视频通话）：视频通话卡片显示摄像机图标与「视频通话时长」文案；缺省语音（向后兼容） */
  call?: { state: CallCardState; duration: number; direction: 'out' | 'in'; media?: 'voice' | 'video' };
  /** 好友添加过程标记：apply = 用户发出的验证消息（气泡下胶囊标注「以上为验证消息」）；
   *  greet = AI 发起的验证消息（气泡下胶囊标注「以上是打招呼的内容」）；
   *  added = 加好友成功提示（kind='sys' 携带文案，落入普通 sys 胶囊分支与其他系统提示同款包裹；不进 AI 上下文走 sys 既有口径） */
  fr?: 'apply' | 'greet' | 'added';
  /** 深度思考：本轮回复 [思考]…[/思考] 块剥离出的思考过程（挂在回合第一条 AI 文本消息上，
   *  渲染为气泡上方可折叠的思维链卡片；深度思考开关关闭时渲染层直接丢弃不显示。
   *  仅展示层字段：历史序列化/记忆/翻译/语音合成均不读它） */
  thinking?: string;
  /** 美团找人代付卡片（kind='mtpay'）：pid = 代付请求（mt-proxy:<pid>），role req=请求卡/done=完成卡 */
  mtpay?: { pid: string; role: 'req' | 'done' };
  /** 美团订单分享动态卡片（kind='mtshare'）：sid = 分享快照（mt-share:<sid>），状态时间线实时跟订单走 */
  mtshare?: { sid: string };
  /** 淘宝找人代付卡片（kind='tbpay'）：pid = 代付请求（tb-proxy:<pid>），role req=请求卡/done=完成卡 */
  tbpay?: { pid: string; role: 'req' | 'done' };
  /** 淘宝订单分享动态卡片（kind='tbshare'）：sid = 分享快照（tb-share:<sid>），状态时间线实时跟订单走 */
  tbshare?: { sid: string };
  /** X论坛帖子分享卡片（kind='forumshare'）：pid = 帖子 id，卡片实时读论坛 store（正文/互动数跟帖走） */
  forumshare?: { pid: string };
  /** 美团 AI 代点外卖草稿卡（kind='mtdraft'）：did = 草稿（mt-draft:<did>），确认后创建待支付订单 */
  mtdraft?: { did: string };
  /** 淘宝 AI 代买草稿卡（kind='tbdraft'）：did = 草稿（tb-draft:<did>），确认后 AI 付款下单 */
  tbdraft?: { did: string };
}

/** 朋友圈评论（replyTo = 「回复某人」的名字） */
interface WxMomentComment {
  id: string;
  author: string;
  text: string;
  /** AI 双语译文（中文译文；空串 = 无译文）；48-6 渲染折叠块 */
  contentZh?: string;
  time: number;
  replyTo: string | null;
}

/** 朋友圈动态（localStorage 持久化，新动态在最前） */
interface WxMoment {
  id: string;
  authorName: string;
  avatar: string | null;
  /** 动态引擎写入的作者类型（'user' 自己 / 'char' 角色；legacy 数据缺省，读时按 peerId 归因） */
  author?: 'user' | 'char';
  text: string;
  /** AI 双语译文（中文译文；空串 = 无译文）；48-6 渲染折叠块 */
  contentZh?: string;
  images: string[];
  /** 发动态时附的位置名（可选） */
  location?: string;
  /** 「文字图片」卡片文字（AI 配图降级产物；点击卡片可升级为真图） */
  textCard?: string;
  /** 引擎写入：卡片已升级为真图（长按该图出现「重新生成」入口；用户手动发的图无此标记无此入口） */
  textCardUpgraded?: boolean;
  /** 引擎写入：升级/重新生成实际使用的画面描述（重新生成弹层预填用） */
  textCardDesc?: string;
  /** 转发引用（QQ 空间转发用；微信引擎层支持，UI 不发） */
  repostOf?: MomentRepostRef;
  time: number;
  likes: string[];
  comments: WxMomentComment[];
  /** 引擎写入：char 动态 = 联系人 id（头像实时读取按 id 精确命中；legacy/用户动态可能缺失） */
  peerId?: string;
}

/** 新的朋友通知（添加好友成功 / AI 申请加回后写入；结构与 QQ 共用，见 friend-state.ts） */
type WxFriendReq = FriendReqEntry;

const LS_SESSION = 'wx-session-user-id';
const LS_MOMENTS = 'wx-moments';
const lsMsgsKey = (contactId: string) => `wx-chat-msgs:${contactId}`;

// ---------------- 拍一拍文案（Task 30：微信个人资料页「拍一拍」行设置，按账号隔离） ----------------

/** 拍一拍文案存储键（accLs 按当前微信账号加作用域后缀：大号无后缀、小号 --{accId}） */
const wxClapKey = (): string => accLs('wx-clap-text', 'wx');

/** 读取拍一拍文案（未设置返回空串；文案是「拍了拍」的后缀，如「的小脑袋」） */
function readWxClapText(): string {
  try {
    return (window.localStorage.getItem(wxClapKey()) ?? '').trim().slice(0, 30);
  } catch {
    return '';
  }
}

/** 保存拍一拍文案（空串 = 清除，回退「未设置」） */
function writeWxClapText(text: string): void {
  try {
    window.localStorage.setItem(wxClapKey(), text.trim().slice(0, 30));
  } catch {
    // 存储异常静默：拍一拍文案退化为默认展示
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 当前正在查看的微信聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 */
let wxActiveChatId: string | null = null;
/** 排队补跑回合：对方正在回复时用户又发了消息 / 在回复中处理了「解除拉黑申请、退还红包转账亲属卡」
 *  等需要 AI 后续回应的事项 —— 本轮流结束后由聊天页自动补跑一轮回复。
 *  #28 localStorage 持久化（key: wx-queued-turns）：模块加载时恢复，增删即同步写回——刷新后排队中的
 *  消息不再丢失（补跑依赖聊天页被打开：刷新后重新进入该会话，kick effect 挂载即自动补跑）。
 *  37-a：队列项扩展 event 字段——回复中触发的系统事件（拉黑申请同意/拒绝、退卡）随补跑回合保留
 *  （原实现直接 runAiTurn：同会话已有流时 beginChatStream 返回 false，事件被静默丢弃、AI 绝口不提） */
type WxQueuedTurn = { kind: 'kick'; event?: string };
// 多账号 v2（Task 40-2a）：键在每次读写时按微信当前账号现算 accLs（大号=原键向后兼容；小号 wx-queued-turns--{id}）。
// 切换账号不再刷新网页，严禁模块常量固化作用域；切换瞬间由根组件调 wxQueueReload() 把内存队列换仓到新账号快照。
const queuedTurnsKey = () => accLs('wx-queued-turns', 'wx');

/** 读取并规范化排队表（兼容旧格式：contactId 字符串数组 = 纯消息补跑，无事件） */
function readWxQueuedTurns(): Record<string, WxQueuedTurn[]> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(queuedTurnsKey()) ?? '{}');
    const out: Record<string, WxQueuedTurn[]> = {};
    if (Array.isArray(raw)) {
      // 旧版 Set 序列化（contactId 数组）：逐条迁移为无事件的补跑回合
      for (const x of raw) if (typeof x === 'string') out[x] = [{ kind: 'kick' }];
      return out;
    }
    if (!raw || typeof raw !== 'object') return {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k !== 'string') continue;
      if (typeof v === 'string') {
        out[k] = [{ kind: 'kick' }];
        continue;
      }
      if (!Array.isArray(v)) continue;
      const turns = v
        .filter((x): x is WxQueuedTurn => Boolean(x) && typeof x === 'object' && (x as WxQueuedTurn).kind === 'kick')
        .map((x) => (typeof x.event === 'string' && x.event.trim() ? { kind: 'kick' as const, event: x.event } : { kind: 'kick' as const }));
      if (turns.length > 0) out[k] = turns;
    }
    return out;
  } catch {
    return {};
  }
}

const wxQueuedTurns = readWxQueuedTurns();

function wxQueueWrite(): void {
  try {
    window.localStorage.setItem(queuedTurnsKey(), JSON.stringify(wxQueuedTurns));
  } catch {
    // localStorage 异常忽略：内存队列照常工作（仅刷新后丢该条补跑）
  }
}

/** 排队一条补跑回合（event = 系统事件文本，随补跑回合注入上下文；不带事件 = 普通消息补跑） */
function wxQueueAdd(id: string, event?: string): void {
  const turn: WxQueuedTurn = event ? { kind: 'kick', event } : { kind: 'kick' };
  const list = wxQueuedTurns[id] ?? [];
  list.push(turn);
  wxQueuedTurns[id] = list;
  wxQueueWrite();
}

function wxQueueDelete(id: string): void {
  if (!wxQueuedTurns[id]) return;
  delete wxQueuedTurns[id];
  wxQueueWrite();
}

/** 多账号 v2（Task 40-2a）：切换微信账号时由根组件调用——内存队列整体换仓为新账号作用域键的
 *  持久化快照（旧账号的排队原样留在旧键下，切回时自动恢复）。调用时机在 switchAccountFor 写完
 *  per-app 标记之后，readWxQueuedTurns 内部 accLs 现算即得新账号键。不刷新网页后内存队列不能
 *  跨账号沿用，否则旧账号的排队补跑会写进新账号的键。 */
function wxQueueReload(): void {
  for (const k of Object.keys(wxQueuedTurns)) delete wxQueuedTurns[k];
  Object.assign(wxQueuedTurns, readWxQueuedTurns());
}

function loadMsgs(contactId: string): WxMsg[] {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const raw = kvGet<WxMsg[]>(lsMsgsKey(contactId));
    if (!Array.isArray(raw)) return [];
    const parsed: unknown = raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is WxMsg =>
          Boolean(m) &&
          typeof (m as WxMsg).content === 'string' &&
          ((m as WxMsg).role === 'me' || (m as WxMsg).role === 'peer')
      )
      // 引用/撤回/转发字段规范化（旧记录无这些字段时补默认值）
      .map((m) => ({
        ...m,
        // 深度思考字段收窄（展示层字段；脏数据/空串清为 undefined，旧记录天然无此字段）
        thinking: typeof m.thinking === 'string' && m.thinking.trim() ? m.thinking : undefined,
        quote:
          m.quote && typeof m.quote.name === 'string' && typeof m.quote.content === 'string'
            ? { name: m.quote.name, content: m.quote.content, id: typeof m.quote.id === 'string' ? m.quote.id : undefined }
            : undefined,
        recalled: m.recalled === true || undefined,
        fwd:
          m.fwd && typeof m.fwd.from === 'string'
            ? {
                from: m.fwd.from,
                merged: m.fwd.merged === true || undefined,
                title: typeof m.fwd.title === 'string' ? m.fwd.title : undefined,
                records: Array.isArray(m.fwd.records)
                  ? m.fwd.records
                      .filter((r) => Boolean(r) && typeof r.name === 'string' && typeof r.text === 'string')
                      .map((r) => ({
                        name: r.name,
                        role: r.role === 'me' ? ('me' as const) : ('peer' as const),
                        text: r.text,
                        quote: typeof r.quote === 'string' ? r.quote : undefined,
                        time: typeof r.time === 'number' ? r.time : 0,
                        // 保留记录快照头像（undefined = 旧数据无此字段，详情页回退按角色取）
                        avatar: typeof r.avatar === 'string' ? r.avatar : r.avatar === null ? null : undefined,
                        // 富媒体快照：表情包/图片详情页显示原图（旧数据无此字段 → 按纯文字渲染）
                        kind: r.kind === 'sticker' || r.kind === 'image' ? r.kind : undefined,
                        imgSrc: typeof r.imgSrc === 'string' ? r.imgSrc : undefined,
                        stkMeaning: typeof r.stkMeaning === 'string' ? r.stkMeaning : undefined,
                      }))
                  : undefined,
              }
            : undefined,
      }))
      .map((m) => {
        if (m.kind === 'redpacket' && m.rp && typeof m.rp.amount === 'number') {
          return {
            ...m,
            rp: {
              amount: m.rp.amount,
              blessing: typeof m.rp.blessing === 'string' ? m.rp.blessing : '恭喜发财，大吉大利',
              opened: m.rp.opened === true,
              openedAt: typeof m.rp.openedAt === 'number' ? m.rp.openedAt : undefined,
              openedBy: typeof m.rp.openedBy === 'string' ? m.rp.openedBy : undefined,
              status: m.rp.status === 'returned' || m.rp.status === 'rejected' ? m.rp.status : undefined,
              cid: typeof m.rp.cid === 'string' ? m.rp.cid : undefined,
            },
          };
        }
        if (m.kind === 'transfer' && m.tr && typeof m.tr.amount === 'number') {
          return {
            ...m,
            tr: {
              amount: m.tr.amount,
              note: typeof m.tr.note === 'string' ? m.tr.note : '',
              received: m.tr.received === true,
              receivedAt: typeof m.tr.receivedAt === 'number' ? m.tr.receivedAt : undefined,
              status: m.tr.status === 'returned' || m.tr.status === 'rejected' ? m.tr.status : undefined,
              cid: typeof m.tr.cid === 'string' ? m.tr.cid : undefined,
              // 收款方向标记（详情页文案「你已收款 / ××已收款」）：必须在规范化中保留，否则落盘回读后丢失
              receiptOf: m.tr.receiptOf === 'me' || m.tr.receiptOf === 'peer' ? m.tr.receiptOf : undefined,
              // 退还链路字段（退款时间/原转账时间/退还人）：退还凭据卡与详情页退还态依赖，落盘回读必须保留
              refundedAt: typeof m.tr.refundedAt === 'number' ? m.tr.refundedAt : undefined,
              originTime: typeof m.tr.originTime === 'number' ? m.tr.originTime : undefined,
              refundedBy: m.tr.refundedBy === 'me' || m.tr.refundedBy === 'peer' ? m.tr.refundedBy : undefined,
            },
          };
        }
        if (m.kind === 'family' && m.fam && typeof m.fam.monthlyLimit === 'number') {
          return {
            ...m,
            fam: {
              monthlyLimit: m.fam.monthlyLimit,
              relation: typeof m.fam.relation === 'string' ? m.fam.relation : '家人',
              message: typeof m.fam.message === 'string' ? m.fam.message : '我为你准备了亲属卡，你消费我买单',
              claimed: m.fam.claimed === true,
              claimedAt: typeof m.fam.claimedAt === 'number' ? m.fam.claimedAt : undefined,
              used: typeof m.fam.used === 'number' ? m.fam.used : 0,
              method: typeof m.fam.method === 'string' ? m.fam.method : '零钱',
              rejected: m.fam.rejected === true,
              cid: typeof m.fam.cid === 'string' ? m.fam.cid : undefined,
            },
          };
        }
        if (m.kind === 'image' && m.img && typeof m.img.src === 'string') {
          return m;
        }
        if (m.kind === 'voice' && m.voice && typeof m.voice.url === 'string') {
          // 语音消息规范化（旧记录/损坏记录兼容；url 为空串但带 localText 的是文字转语音本地仿真消息，保留可静音重播）
          return {
            ...m,
            voice: {
              url: m.voice.url,
              duration: typeof m.voice.duration === 'number' && m.voice.duration > 0 ? m.voice.duration : 1,
              wave: Array.isArray(m.voice.wave) ? m.voice.wave.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1) : [],
              localText: typeof m.voice.localText === 'string' && m.voice.localText.trim() ? m.voice.localText : undefined,
              transcript: typeof m.voice.transcript === 'string' && m.voice.transcript ? m.voice.transcript : undefined,
              stt: m.voice.stt === 'pending' || m.voice.stt === 'done' || m.voice.stt === 'failed' ? m.voice.stt : undefined,
              // AI 语音消息字段（synth 合成通道 / contactId 朗读音色归属）：落盘回读必须保留，否则丢失通道信息
              synth: m.voice.synth === 'builtin' || m.voice.synth === 'api' ? m.voice.synth : undefined,
              contactId: typeof m.voice.contactId === 'string' ? m.voice.contactId : undefined,
            },
          };
        }
        if (m.kind === 'call' && m.call && typeof m.call.duration === 'number') {
          // 通话卡片规范化（旧记录兼容；state/direction 非法值回退）
          // media 同 QQ 端口径（仅认 'voice'|'video'，其余丢弃走缺省语音）——
          // fix(Task 24)：此前规范化重建 call 对象时漏掉 media，视频通话卡片重新进会话后被降级成语音卡片
          const st = m.call.state;
          return {
            ...m,
            call: {
              state: st === 'cancelled' || st === 'no-answer' || st === 'rejected' || st === 'missed-in' || st === 'ended' ? st : 'ended',
              duration: m.call.duration,
              direction: m.call.direction === 'in' ? ('in' as const) : ('out' as const),
              media: m.call.media === 'video' ? ('video' as const) : m.call.media === 'voice' ? ('voice' as const) : undefined,
            },
          };
        }
        if (m.kind === 'location' && m.loc && typeof m.loc.name === 'string') {
          // 位置消息规范化：保留地点名/地址/经纬度（旧记录无经纬度字段时照常兼容）
          const locD = locDataOf(m.loc);
          return { ...m, loc: { name: m.loc.name, address: typeof m.loc.address === 'string' ? m.loc.address : '', lat: locD.lat, lng: locD.lng } };
        }
        if (m.kind === 'sticker' && m.stk && typeof m.stk.url === 'string') {
          return { ...m, stk: { url: m.stk.url, meaning: typeof m.stk.meaning === 'string' ? m.stk.meaning : '' } };
        }
        if (m.kind === 'groupcard' && m.gcard && typeof m.gcard.gid === 'string') {
          const c = m.gcard;
          return {
            ...m,
            gcard: {
              gid: c.gid,
              name: typeof c.name === 'string' ? c.name : '群聊',
              inviterId: typeof c.inviterId === 'string' ? c.inviterId : '',
              inviterName: typeof c.inviterName === 'string' ? c.inviterName : '',
              memberNames: Array.isArray(c.memberNames) ? c.memberNames.filter((x): x is string => typeof x === 'string') : [],
              status: c.status === 'accepted' || c.status === 'rejected' ? c.status : 'pending',
            },
          };
        }
        return m;
      });
  } catch {
    return [];
  }
}

function saveMsgs(contactId: string, msgs: WxMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步；落盘防抖合并——AI 连发分段/双写路径下同一键
  // 400ms 内只落盘一次，长会话写放大从 O(条数×全量) 降到 O(1)；pagehide 自动冲刷）
  // 聊天记录不封顶（用户反馈：以前截 1000 条会挤丢旧聊天记录；kv 在 IndexedDB，纯文本容量可控）
  kvSetDebounced(lsMsgsKey(contactId), msgs);
  // 新消息自动恢复被「删除/不显示」的会话（真微信行为）
  try {
    const hid = loadStrList(LS_CHAT_HIDDEN);
    if (hid.includes(contactId)) saveStrList(LS_CHAT_HIDDEN, hid.filter((x) => x !== contactId));
  } catch {
    // 忽略
  }
}

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
const lsAiEventsKey = (contactId: string) => `wx-ai-events:${contactId}`;

function pushAiEvent(contactId: string, text: string): void {
  try {
    const parsed: unknown = kvGet<string[]>(lsAiEventsKey(contactId));
    const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    arr.push(text);
    kvSet(lsAiEventsKey(contactId), arr.slice(-10));
  } catch {
    // 忽略
  }
}

/** 37-a：已消费转发事件登记（内存，按「联系人\n事件文本」计数）——drain 取走即在内存标记已消费，
 *  存储里的事件延迟约 1s 再清。修复 dev StrictMode 双挂载吞事件：旧实现 drain 取走即清，
 *  首跑消费后 400ms 回合定时器被卸载 cleanup 清掉，重挂载的第二次 drain 返回空 → 「回应转发」回合丢失。
 *  现在重挂载 drain 到的已消费事件被本登记过滤（不双跑），首跑的回合定时器不随卸载取消（不丢）；
 *  生产环境（单次挂载单次消费）行为不变。 */
const consumedWxAiEvents = new Map<string, number>();
const keyOfWxAiEvent = (contactId: string, text: string) => `${contactId}\n${text}`;

function drainAiEvents(contactId: string): string[] {
  try {
    const parsed: unknown = kvGet<string[]>(lsAiEventsKey(contactId));
    if (!Array.isArray(parsed)) return [];
    const all = parsed.filter((x): x is string => typeof x === 'string');
    if (all.length === 0) return [];
    const out: string[] = [];
    // 同文多条目：本地影子额度每键只初始化一次（快照登记值），仅被「跳过已消费条目」递减；
    // 返回新条目时只递增登记本身、不动影子——否则第二条同文事件会被第一条的登记误过滤
    const localBudget = new Map<string, number>();
    for (const text of all) {
      const key = keyOfWxAiEvent(contactId, text);
      if (!localBudget.has(key)) localBudget.set(key, consumedWxAiEvents.get(key) ?? 0);
      const budget = localBudget.get(key) ?? 0;
      if (budget > 0) {
        localBudget.set(key, budget - 1);
        continue;
      }
      out.push(text);
      consumedWxAiEvents.set(key, (consumedWxAiEvents.get(key) ?? 0) + 1);
    }
    if (out.length === 0) return [];
    // 延迟清除（约 1s）：只移除已消费条目——期间新推入的事件保留，不被误删（模块级定时器，不随组件卸载取消）
    window.setTimeout(() => {
      const touched: string[] = [];
      try {
        const cur: unknown = kvGet<string[]>(lsAiEventsKey(contactId));
        if (!Array.isArray(cur)) return;
        const rest = (cur as unknown[]).filter((x) => {
          if (typeof x !== 'string') return false;
          const key = keyOfWxAiEvent(contactId, x);
          if (!touched.includes(key)) touched.push(key);
          const used = consumedWxAiEvents.get(key) ?? 0;
          if (used > 0) {
            consumedWxAiEvents.set(key, used - 1);
            return false;
          }
          return true;
        });
        if (rest.length === 0) kvDel(lsAiEventsKey(contactId));
        else kvSet(lsAiEventsKey(contactId), rest.slice(-10));
      } catch {
        // 清除失败：释放登记（宁可极端情况下重复回应一次，不让登记卡死后续同文事件）
        for (const key of touched) consumedWxAiEvents.delete(key);
      }
    }, 1000);
    return out;
  } catch {
    return [];
  }
}

/** 剪贴板复制（clipboard API 不可用时回退 execCommand） */
function copyTextWithToast(text: string, onToast: (m: string) => void): void {
  const done = () => onToast('已复制');
  const fallback = () => {
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
  };
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
      return;
    }
  } catch {
    // 回退
  }
  fallback();
}

/** 聊天列表长按菜单状态（置顶迁移至 @/lib/chat-flags 的 wxChatFlags 表；未读/已隐藏仍存 localStorage） */
const LS_CHAT_HIDDEN = 'wx-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
const wxUnreads = wxUnreadStore;

function loadStrList(key: string): string[] {
  try {
    // 多账号 v2（Task 40-2a）：键按微信当前账号作用域、调用时现算（wx-chat-hidden / wx-search-history 等）
    const raw = window.localStorage.getItem(accLs(key, 'wx'));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function saveStrList(key: string, list: string[]): void {
  try {
    // 多账号 v2（Task 40-2a）：同 loadStrList，写入也按微信当前账号现算作用域
    window.localStorage.setItem(accLs(key, 'wx'), JSON.stringify(list));
  } catch {
    // 忽略
  }
}

function loadMoments(): WxMoment[] {
  try {
    const parsed: unknown = kvGet<WxMoment[]>(LS_MOMENTS);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is WxMoment => Boolean(p) && typeof (p as WxMoment).id === 'string' && typeof (p as WxMoment).time === 'number')
      .map((p) => ({
        ...p,
        text: typeof p.text === 'string' ? p.text : '',
        contentZh: typeof p.contentZh === 'string' ? p.contentZh : undefined,
        avatar: typeof p.avatar === 'string' ? p.avatar : null,
        authorName: typeof p.authorName === 'string' ? p.authorName : '微信用户',
        images: Array.isArray(p.images) ? p.images.filter((i) => typeof i === 'string') : [],
        likes: Array.isArray(p.likes) ? p.likes.filter((i) => typeof i === 'string') : [],
        comments: Array.isArray(p.comments)
          ? p.comments
              .filter(
                (c): c is WxMomentComment =>
                  Boolean(c) &&
                  typeof (c as WxMomentComment).author === 'string' &&
                  typeof (c as WxMomentComment).text === 'string' &&
                  typeof (c as WxMomentComment).time === 'number'
              )
              .map((c) => {
                // 旧版遗留修复：AI「回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char）读时摘掉错误指向
                const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
                const selfReplyBug =
                  rawReplyTo !== null && rawReplyTo === c.author && (c as { authorKind?: unknown }).authorKind === 'char';
                return {
                  id: typeof c.id === 'string' ? c.id : uid(),
                  author: c.author,
                  text: c.text,
                  contentZh: typeof c.contentZh === 'string' ? c.contentZh : undefined,
                  time: c.time,
                  replyTo: selfReplyBug ? null : rawReplyTo,
                };
              })
          : [],
      }));
  } catch {
    return [];
  }
}

/** 好友朋友圈示例动态（首次进入该好友的朋友圈时补齐，走动态引擎写入：writeMemory=false 不入记忆） */
const FRIEND_POST_TEMPLATES: ReadonlyArray<{ text: string; agoMs: number }> = [
  { text: '今天天气不错，出去走了走', agoMs: 2 * 3_600_000 },
  { text: '忙完这个项目，终于可以休息一下了', agoMs: 26 * 3_600_000 },
  { text: '新的开始，加油！', agoMs: 3 * 86_400_000 },
];

function loadReqs(): WxFriendReq[] {
  // 存储在 friend-state（同键 wx-friend-reqs）：旧数据无 status 归一化为 accepted；QQ/微信共用一套读写逻辑
  return loadFriendReqs('wx');
}

function saveReqs(list: WxFriendReq[]): void {
  saveFriendReqs('wx', list);
}

/** 图片压缩（申请添加朋友页「添加图片」用；与 qq.tsx 同款实现，两端共用同一逻辑） */
function compressImageFile(file: File, max = 1280): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      if (!raw) {
        resolve('');
        return;
      }
      if (file.type === 'image/gif' || /^data:image\/gif/i.test(raw)) {
        resolve(raw);
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/** 由 WxUser 构造兜底 ContactRecord（联系人列表里找不到自己时用于进入自己聊天） */
function meAsContact(me: WxUser): ContactRecord {
  return {
    id: me.id,
    kind: 'user',
    ownerId: null,
    name: me.name,
    nickname: me.nickname ?? null,
    realName: me.realName ?? null,
    gender: null,
    age: null,
    height: null,
    weight: null,
    persona: null,
    background: null,
    occupation: null,
    company: null,
    region: null,
    relation: null,
    phone: me.phone,
    wechatId: me.wechatId,
    wechatPassword: null,
    qqId: me.qqId,
    qqPassword: null,
    avatar: me.avatar,
    isFriend: true,
    createdAt: '',
  };
}

/** 会话列表预览（最后一条非通知/系统提示消息 + 时间）；撤回的消息显示「你/对方撤回一条消息」 */
function readPreview(contactId: string): { text: string; time: number } {
  // 性能：会话列表每次重算对每个联系人各调一次——直接从 kv 内存缓存读原始数组尾部扫描，
  // 不再走 loadMsgs 的全量规范化克隆 + reverse 再克隆（长会话 O(N)×2 是列表卡顿主因；
  // 预览只用 kind/role/time/content/recalled/call/fwd 等原始记录就有的字段）
  const raw = kvGetRaw<WxMsg[]>(lsMsgsKey(contactId));
  const msgs = Array.isArray(raw) ? raw : [];
  let last: WxMsg | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && m.error !== true) {
      last = m;
      break;
    }
  }
  if (!last) return { text: '', time: 0 };
  if (last.recalled) return { text: last.role === 'me' ? '你撤回一条消息' : '对方撤回一条消息', time: last.time };
  if (last.kind === 'redpacket') return { text: '[微信红包]', time: last.time };
  if (last.kind === 'giftcard') return { text: '[礼物]', time: last.time };
  if (last.kind === 'transfer') return { text: '[转账]', time: last.time };
  if (last.kind === 'family') return { text: '[亲属卡]', time: last.time };
  if (last.kind === 'image') return { text: '[图片]', time: last.time };
  if (last.kind === 'textcard') return { text: '[文字图片]', time: last.time };
  if (last.kind === 'voice') return { text: '[语音]', time: last.time };
  // Task 22 视频通话：通话卡片按媒体显示预览（last 是 WxMsg，call 字段直接可取；缺省语音向后兼容）
  if (last.kind === 'call') return { text: last.call?.media === 'video' ? '[视频通话]' : '[语音通话]', time: last.time };
  if (last.kind === 'location') return { text: '[位置]', time: last.time };
  if (last.kind === 'sticker') return { text: '[表情]', time: last.time };
  if (last.kind === 'forward') return { text: last.fwd?.merged ? '[聊天记录]' : last.content, time: last.time };
  if (last.kind === 'groupcard') return { text: '[群聊邀请]', time: last.time };
  if (last.kind === 'relcard') return { text: '[亲密关系]', time: last.time };
  if (last.kind === 'pactcard') return { text: '[恋爱协议]', time: last.time };
  if (last.kind === 'examcard') return { text: '[恋爱考试]', time: last.time };
  if (last.kind === 'lettercard') return { text: '[情书]', time: last.time };
  if (last.kind === 'forumshare') return { text: '[X论坛帖子]', time: last.time };
  return { text: last.content, time: last.time };
}

/** 微信零钱余额（与「服务」钱包共用 wx-wallet 存储） */
function wxLoadBalance(): number {
  const w = loadJSON<{ balance?: number }>(LS_WALLET, {});
  return typeof w.balance === 'number' && w.balance >= 0 ? w.balance : 0;
}

const LS_CARDS = 'wx-wallet-cards';

/** 账单条目附加信息（对方名/头像；转账条目账单页显示对方头像） */
interface WxBillMeta {
  peer?: string;
  avatar?: string | null;
}

/** 零钱增减 + 可选写一条零钱明细账单；余额不足返回 false（单聊/群聊共用；'淘宝购物' = 淘宝 App 支付/退款入账） */
export function wxPatchBalance(delta: number, bill?: { kind: '红包' | '转账' | '亲属卡付款' | '红包退款' | '转账退款' | '美团外卖' | '淘宝购物'; amount: number } & WxBillMeta): boolean {
  const next = Math.round((wxLoadBalance() + delta) * 100) / 100;
  if (next < 0) return false;
  saveJSON(LS_WALLET, { balance: next });
  if (bill) wxPushBill(bill.kind, bill.amount, { peer: bill.peer, avatar: bill.avatar });
  return true;
}

/** 退款入账时给最近一条同场景未退款的支出条目标 refunded（账单页原条目下红字「已退回」；不新增收入条目，对齐真机） */
function wxMarkLatestBillRefund(kind: '红包' | '转账', amount: number): void {
  const bills = loadJSON<{ id?: string; kind?: string; amount?: number; time?: number; refunded?: boolean }[]>(LS_BILLS, []).filter(
    (b) => Boolean(b) && typeof b.kind === 'string' && typeof b.amount === 'number' && typeof b.time === 'number'
  );
  const idx = bills.findIndex((b) => b.kind === kind && b.amount === -amount && b.refunded !== true);
  if (idx < 0) return;
  saveJSON(
    LS_BILLS,
    bills.map((b, i) => (i === idx ? { ...b, refunded: true } : b))
  );
}

/** 追加一条零钱明细账单（新的在前，最多 100 条；退款类同时标注原支出条目） */
function wxPushBill(kind: '红包' | '转账' | '亲属卡付款' | '红包退款' | '转账退款' | '美团外卖' | '淘宝购物', amount: number, meta?: WxBillMeta): void {
  const bills = loadJSON<{ id?: string; kind?: string; amount?: number; time?: number; peer?: string; avatar?: string | null; refunded?: boolean }[]>(LS_BILLS, []).filter(
    (b) => Boolean(b) && typeof b.kind === 'string' && typeof b.amount === 'number' && typeof b.time === 'number'
  );
  if (kind === '红包退款') wxMarkLatestBillRefund('红包', Math.abs(amount));
  if (kind === '转账退款') wxMarkLatestBillRefund('转账', Math.abs(amount));
  saveJSON(LS_BILLS, [{ id: uid(), kind, amount, time: Date.now(), peer: meta?.peer, avatar: meta?.avatar }, ...bills].slice(0, 100));
}

// ---- #22 亲属卡多卡聚合：同一赠卡人（friendId）名下可有多张收到的亲属卡（每张卡消息独立入表）----
// 可用额度按赠卡人聚合（全部卡「月额度-已用」求和），扣款依序分摊到各卡；
// 分组键缺失（旧数据无 friendId）时以卡自身 id 为组，退化为单卡行为。
function wxFcGroupKey(f: WxFamilyCardIn): string {
  return f.friendId ?? f.id;
}

function wxFcGroups(list: WxFamilyCardIn[]): Map<string, WxFamilyCardIn[]> {
  const groups = new Map<string, WxFamilyCardIn[]>();
  for (const f of list) {
    const k = wxFcGroupKey(f);
    const arr = groups.get(k);
    if (arr) arr.push(f);
    else groups.set(k, [f]);
  }
  return groups;
}

/** methodId（fcin-<卡 id>，组内任一张）→ 该赠卡人名下全部卡 + 聚合可用额度 */
function wxFcGroupOf(list: WxFamilyCardIn[], methodId: string): { cards: WxFamilyCardIn[]; available: number } {
  const anchor = list.find((f) => f.id === methodId);
  if (!anchor) return { cards: [], available: 0 };
  const cards = wxFcGroups(list).get(wxFcGroupKey(anchor)) ?? [anchor];
  return { cards, available: cards.reduce((s, f) => s + Math.max(0, f.monthlyLimit - f.used), 0) };
}

/** 支付方式可用性预检：零钱 / 银行卡 / 我收到的亲属卡（本月剩余额度）；单聊/群聊共用 */
export function wxCanPay(methodId: string, amount: number): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return wxLoadBalance() >= amount;
  if (methodId.startsWith('fcin-')) {
    // 审计 #6：读取可用额度前先做跨月惰性重置（跨月后额度恢复再预检）；#22：按赠卡人聚合名下全部卡
    const g = wxFcGroupOf(resetFamilyCardsInMonth(), methodId);
    return g.cards.length > 0 && g.available >= amount;
  }
  const c = loadCards().find((x) => x.id === methodId);
  return Boolean(c) && (c?.balance ?? 0) >= amount;
}

/** 按所选支付方式扣款（零钱 / 银行卡 / 亲属卡额度；亲属卡不动零钱不写账单，其余写零钱明细）；单聊/群聊共用。
 *  成功返回 { ok:true, fc? }：fc 存在 = 本次用亲属卡扣款（含分摊明细，调用方据此插通知行 + 落消费流水/赠卡人记忆）；
 *  金额非法 / 额度不足 / 卡不存在等失败一律返回 null。meta 传对方名/头像（账单条目展示用） */
export function wxExecutePayment(methodId: string, amount: number, kind: '红包' | '转账' | '亲属卡付款' | '美团外卖' | '淘宝购物', meta?: WxBillMeta): WxFcPayResult | null {
  if (!(amount > 0)) return null;
  if (methodId === 'balance') return wxPatchBalance(-amount, { kind, amount: -amount, ...meta }) ? { ok: true } : null;
  if (methodId.startsWith('fcin-')) {
    // 审计 #6：扣款前先做跨月惰性重置（重置后额度足够才扣）；写回时保留 lastResetMonth 字段。
    // #22：额度按赠卡人聚合，扣款依序分摊到名下各卡（先扣第一张剩余，扣完顺延下一张；金额均两位小数，无残差）；
    // 分摊明细收集为 parts（take>0 才记），供亲属卡消费感知用
    const list = resetFamilyCardsInMonth();
    const g = wxFcGroupOf(list, methodId);
    if (g.cards.length === 0 || g.available < amount) return null;
    let remain = Math.round(amount * 100) / 100;
    const ids = new Set(g.cards.map((f) => f.id));
    const parts: WxFcPayPart[] = [];
    saveFamilyCardsIn(
      list.map((f) => {
        if (!ids.has(f.id) || remain <= 0) return f;
        const take = Math.min(Math.max(0, f.monthlyLimit - f.used), remain);
        remain = Math.round((remain - take) * 100) / 100;
        if (take > 0) parts.push({ cardInId: f.id, giverId: f.friendId ?? null, giverName: f.fromName, amount: take });
        return { ...f, used: Math.round((f.used + take) * 100) / 100 };
      })
    );
    return { ok: true, fc: { total: amount, parts } };
  }
  const list = loadCards();
  const c = list.find((x) => x.id === methodId);
  if (!c || c.balance < amount) return null;
  saveJSON(
    LS_CARDS,
    list.map((x) => (x.id === methodId ? { ...x, balance: Math.round((x.balance - amount) * 100) / 100 } : x))
  );
  // 零钱/银行卡不产生亲属卡明细，只写账单
  wxPushBill(kind, -amount, meta);
  return { ok: true };
}

/** 退款原路退回到微信银行卡：卡余额回补 + 零钱明细写一条退款收入（与支付侧「银行卡也写零钱明细」同口径对称——
 *  此前退款只回补卡余额不写账单，用户看到支出有记录、退款无记录，误以为退款丢失）。失败（卡不存在）返回 false */
export function wxRefundToBankCard(methodId: string, amount: number, kind: '美团外卖' | '淘宝购物', meta?: WxBillMeta): boolean {
  if (!(amount > 0)) return false;
  const list = loadCards();
  if (!list.some((x) => x.id === methodId)) return false;
  saveJSON(
    LS_CARDS,
    list.map((x) => (x.id === methodId ? { ...x, balance: Math.round((x.balance + amount) * 100) / 100 } : x))
  );
  wxPushBill(kind, amount, meta);
  return true;
}

/** 支付方式展示名（发送页支付方式行 / 支付密码验证浮层副标题用）；单聊/群聊共用 */
export function wxMethodLabel(methodId: string): string {
  if (methodId === 'balance') return `零钱（可用 ${fmtMoney(wxLoadBalance())} 元）`;
  if (methodId.startsWith('fcin-')) {
    // 审计 #6：展示「本月可用」前先做跨月惰性重置（跨月后不再显示上月剩余）；#22：聚合名下全部卡总额度
    const g = wxFcGroupOf(resetFamilyCardsInMonth(), methodId);
    if (g.cards.length === 0) return '亲属卡';
    return `${g.cards[0].fromName}的亲属卡${g.cards.length > 1 ? `×${g.cards.length}` : ''}（本月可用 ${fmtMoney(g.available)} 元）`;
  }
  const c = loadCards().find((x) => x.id === methodId);
  return c ? `${c.bank}（尾号${c.tail}）` : '支付方式';
}

/** 金额输入通用约束：最多 7 位整数 + 2 位小数（单聊/群聊共用） */
export function sanitizeAmount(v: string): string {
  return /^\d{0,7}(\.\d{0,2})?$/.test(v) ? v : v.slice(0, -1);
}

/** 完整时间：2026年09月07日 20:32:28（转账详情页用） */
/** 完整日期（2026年9月14日，不带时间；亲属卡领取时间等用） */
function fmtFullDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtFullTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时间展示：今天 HH:mm / 昨天 / 周X / M/D */
function fmtListTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  if (now.getTime() - ts < 7 * 86400000) return `周${'日一二三四五六'[d.getDay()]}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 聊天时间分隔（同微信）：今天 HH:mm / 昨天 HH:mm / 一周内 星期X HH:mm / 一周前 M月D日 HH:mm */
function fmtChatTime(ts: number): string {
  const d = new Date(ts);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
  if (now.getTime() - ts < 7 * 86400000) return `星期${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 手机号打码（同微信「个人资料」）：18300000033 → 183******33（前3后2，中间打码） */
function maskPhone(p: string | null): string {
  const digits = (p ?? '').replace(/\s/g, '');
  if (!digits) return '未绑定';
  if (digits.length < 7) return digits;
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(4, digits.length - 5))}${digits.slice(-2)}`;
}

/** 朋友圈时间：刚刚 / n分钟前 / HH:mm / 昨天 / M月D日 */
function fmtMomentsTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 新的朋友分组标签：今天 / 昨天 / n天前 / M月D日 */
function fmtReqDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((dayStart - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 3) return `${diffDays}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const PINYIN_ANCHORS: Array<[string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'],
  ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'],
  ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'],
  ['Y', '压'], ['Z', '匝'],
];

/** 名字首字母分组：英文取首字母；中文按拼音锚点归组；其余进 # */
function initialOf(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (/[\u4e00-\u9fff]/.test(name.trim().charAt(0))) {
    const c = name.trim().charAt(0);
    for (let i = PINYIN_ANCHORS.length - 1; i >= 0; i--) {
      if (c.localeCompare(PINYIN_ANCHORS[i][1], 'zh-Hans-CN-u-co-pinyin') >= 0) return PINYIN_ANCHORS[i][0];
    }
  }
  return '#';
}

/** AI 特殊消息标记 → 微信消息记录（红包/转账/亲属卡/位置/表情包；渲染与交互复用用户手动发送的同款卡片）。
 *  content 存可读摘要：进入 AI 上下文让角色知道自己发过什么；卡片渲染按 kind 走，不显示 content */
function richToWxMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): WxMsg {
  switch (rich.kind) {
    case 'redpacket':
      return { id, role: 'peer', content: '[微信红包]', time, kind: 'redpacket', rp: { amount: rich.amount, blessing: rich.blessing, opened: false } };
    case 'transfer':
      return { id, role: 'peer', content: '[转账]', time, kind: 'transfer', tr: { amount: rich.amount, note: rich.note, received: false } };
    case 'family':
      return {
        id,
        role: 'peer',
        content: '[亲属卡]',
        time,
        kind: 'family',
        fam: {
          monthlyLimit: rich.monthlyLimit,
          relation: peer.relation?.trim() || '家人',
          message: rich.message || '我为你准备了亲属卡，你消费我买单',
          claimed: false,
          used: 0,
        },
      };
    case 'location': {
      const d = locFromRich(rich.name, rich.coords);
      return { id, role: 'peer', content: '[位置]', time, kind: 'location', loc: { name: d.name, address: d.address || '地图上的一个位置', lat: d.lat, lng: d.lng } };
    }
    case 'sticker': {
      // parseRichParts 已保证 ID/意思能匹配上；取不到时兜底为文字
      const s = loadStickers('wx').find((x) => x.id === rich.stickerId);
      return s
        ? { id, role: 'peer', content: '', time, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } }
        : { id, role: 'peer', content: '[表情包]', time };
    }
    case 'song':
      return songRichToWxMsg(rich, id, time, peer);
  }
}

/**
 * 歌曲卡片标记 → 微信消息（Task 68 音乐 × AI）：卡片可点击播放；
 * - 分享/点播写入角色记忆（你分享了《X》，AI 后续能接住话题）；
 * - invite（[邀请一起听:...]）：同时弹全局邀请卡（去重：消息落库前只在首次解析时触发）。
 */
function songRichToWxMsg(rich: RichSong, id: string, time: number, peer: ContactRecord): WxMsg {
  const label = rich.artist ? `《${rich.name}》（${rich.artist}）` : `《${rich.name}》`;
  try {
    if (rich.autoPlay) {
      // AI 点播：给机主放歌 → 记忆
      memAddEventFragment(peer.id, 'wx', `你给机主放了${label}，点卡片就能听`, {
        eventTime: time,
        sourceTag: 'music-share',
      });
    } else if (rich.invite) {
      memAddEventFragment(peer.id, 'wx', `你想邀请机主一起听${label}`, {
        eventTime: time,
        sourceTag: 'music-share',
      });
    } else {
      memAddEventFragment(peer.id, 'wx', `你分享了${label}给机主${rich.note ? `，说：${rich.note}` : ''}`, {
        eventTime: time,
        sourceTag: 'music-share',
      });
    }
  } catch {
    // 记忆失败不影响消息
  }
  if (rich.invite) {
    try {
      triggerInviteFromChat({ id: peer.id, name: peer.nickname || peer.name, avatar: peer.avatar }, rich.name, rich.artist);
    } catch {
      // 邀请卡失败不影响卡片消息
    }
  }
  return {
    id,
    role: 'peer',
    content: rich.autoPlay ? `[点播]${label}` : `[歌曲]${label}`,
    time,
    kind: 'song',
    song: { name: rich.name, artist: rich.artist, note: rich.note || undefined, autoPlay: rich.autoPlay || undefined, inviteDone: rich.invite || undefined },
  };
}

/** 100-e AI 文字升级语音条的告知规则（aiVoiceOn=true 时随 buildPersonaPrompt extraRules 注入）：
 *  AI 语音频率开关开启（非「关闭」档）的会话里，AI 的普通文字消息在投递时会按频率静默升级成语音条
 *  （deliverAiMsg → decideAiVoiceMessage，见 @/lib/ios/ai-voice）——规则不告知的话，AI 说
 *  「我给你发条语音」时系统并不会真的发语音条。开关关闭（off，永不升级）时零注入 */
const AI_VOICE_DELIVERY_RULE =
  '（你的文字消息有时会以语音条的形式送达对方——这是正常的送达方式，不用在意；但不要在正文里说「我给你发条语音」这类话，也不要主动承诺发语音，用文字自然聊就好。）';

/** 联系人 AI 人设（微信聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  actionDescOn：动作描写开关（开启注入 *...* 格式约定、关闭注入显式禁令，见 @/lib/action-desc）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况）；
 *  aiVoiceOn：AI 语音频率开关（100-e，开启时告知「文字消息可能以语音条送达」，见 AI_VOICE_DELIVERY_RULE） */
function buildPersonaPrompt(peer: ContactRecord, me: WxUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, actionDescOn: boolean, npcExtra?: NpcPromptExtra | null, aiVoiceOn?: boolean): string {
  // 名字/昵称区分：AI 称呼用户按全局设置（默认用名字「凡凡」，用户选「用昵称称呼」才用「凑凑」）；
  // 用户规则：AI 永远不知道机主的昵称——人设只注入真称呼名（真名），不注入任何昵称信息
  const mode = useSettings.getState().addressMode;
  // 多账号（用户规则二.2）：小号/匿名号侧不再注入任何大号身份/关系信息（【用户的另一个身份】段已移除）
  const accId = activeAccountIdOf('wx');
  return buildPersonaSystemPrompt(peer, {
    channel: '微信',
    userName: addressNameOf(me, mode),
    ownerName,
    accountId: accId,
    // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取）
    multiApp: getMemSettings(peer.id).share,
    ...npcExtra,
    extraRules: [
      // fix3-c #3：规则限定主语——只解释「对方（用户）消息里」出现的标记；AI 自己发的表情另有 [表情包:ID]/[你发送了表情：XX] 序列化，不与规则冲突
      '出现在对方（用户）消息里的「[发送了表情：XX]」表示对方发来一张含义为「XX」的表情包，你要理解并自然回应表情的含义（可以调侃或接住情绪），不要字面复述括号内容。',
      // 内置小表情 [微笑] 代码约定（开关开启才注入；用户点面板内置表情即以此格式入历史，AI 也可同格式回复）
      ...(stickersOn ? [EMOJI_CODE_RULE] : []),
      ...buildRichRules(stickersOn ? stickers : []),
      ...(stickersOn ? [] : [STICKER_OFF_RULE]),
      ...(actionDescOn ? [ACTION_DESC_RULE] : [ACTION_DESC_OFF_RULE]),
      // 100-e 文字升级语音条告知（开关开启才注入，off 零注入）
      ...(aiVoiceOn ? [AI_VOICE_DELIVERY_RULE] : []),
    ],
  });
}

/** 用户发给 AI 的红包/转账/亲属卡短 ID（AI 动作标记里引用；短小易抄写） */
function nextWxCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** fix3-c #2：终态执行者名字来源（可选）——仅 AI 上下文序列化处传入；内部状态比较（wxCardIsFinal 等）不传，
 *  标签保持原文案，比较逻辑零影响。me=机主名字（me.name/称呼均可）、peer=AI 角色名字 */
interface WxCardActorNames {
  me?: string;
  peer?: string;
}

/** 红包/转账/亲属卡消息的状态标签（卡片文案 + AI 上下文摘要共用）：
 *  fix3-c #2 终态补执行者后缀（归属清晰：谁领取/谁退还/谁拒收/超24h自动退回）——
 *  名字来源：红包 openedBy 落库时已存真名，直接用；其余执行者按「原卡角色反推（我发的→对方执行，
 *  对方发的→机主执行）」从 names 取；转账过期清算以「原卡带 refundedBy 且无凭据卡专有字段」识别。
 *  names 缺省或对应字段缺失时保持原文案 */
function wxCardStateLabel(m: WxMsg, names?: WxCardActorNames): string {
  const actorOf = (side: 'me' | 'peer'): string => (side === 'me' ? names?.me : names?.peer) ?? '';
  // 原卡（非凭据卡）的执行者与消息角色相反：执行者只能操作发给 TA 的卡
  const inverseActor = (): string => actorOf(m.role === 'me' ? 'peer' : 'me');
  if (m.kind === 'redpacket' && m.rp) {
    if (m.rp.status === 'returned') return '已退回'; // 红包退回无执行者/过期标记（手动退回与24h清算同形），保持原文案
    if (m.rp.status === 'rejected') {
      const actor = inverseActor();
      return actor ? `已拒收（${actor}拒收）` : '已拒收';
    }
    if (m.rp.opened) return m.rp.openedBy ? `已领取（${m.rp.openedBy}领取）` : '已领取';
    return '待领取';
  }
  if (m.kind === 'transfer' && m.tr) {
    if (m.tr.status === 'returned') {
      // fix3-c #2：过期清算标记——24h 清算是唯一给原卡写 refundedBy 的路径（手动退回不写；
      // 凭据退回卡带 originTime 走下方按 refundedBy 正推的分支，不会误入此分支）
      if (m.tr.refundedBy && !m.tr.originTime && !m.tr.receiptOf) return '已退回（超24小时自动退回）';
      const actor = m.tr.refundedBy ? actorOf(m.tr.refundedBy) : inverseActor();
      return actor ? `已退回（${actor}退还）` : '已退回';
    }
    if (m.tr.status === 'rejected') {
      const actor = inverseActor();
      return actor ? `已拒收（${actor}拒收）` : '已拒收';
    }
    if (m.tr.received) {
      const actor = inverseActor();
      return actor ? `已收款（${actor}已收款）` : '已收款';
    }
    return '待收款';
  }
  if (m.kind === 'family' && m.fam) {
    if (m.fam.rejected) {
      const actor = inverseActor();
      return actor ? `已退回（${actor}退还）` : '已退回';
    }
    if (m.fam.claimed) {
      const actor = inverseActor();
      return actor ? `已领取（${actor}领取）` : '已领取';
    }
    return '待领取';
  }
  // 礼物卡（第七轮反馈）：待收下/已收下——终态判定与待处理清单、AI 收下动作共用
  if (m.kind === 'giftcard' && m.gift) {
    return m.gift.accepted ? '已收下' : '待收下';
  }
  return '';
}

/** 卡片是否已到终态（领取/收款/退还/拒收/礼物收下都算；终态后不可重复处理；礼物「待收下」不算终态） */
function wxCardIsFinal(m: WxMsg): boolean {
  const label = wxCardStateLabel(m);
  return label !== '待领取' && label !== '待收款' && label !== '待收下';
}

/** 拍一拍系统行的 AI 上下文序列化（Task 30）：按双方名字显式拼接（文案 = 拍一拍后缀，原样拼在句尾），
 *  不用「你/我」代词——assistant 消息里「你」指 AI 本身，混用会造成主语伪造 */
function wxPatHistoryLine(pat: NonNullable<WxMsg['sys']>['pat'], meName: string, peerName: string): string {
  const suffix = pat?.text ?? '';
  if (pat?.by === 'me') return pat.self ? `[${meName}拍了拍自己${suffix}]` : `[${meName}拍了拍${peerName}${suffix}]`;
  return `[${peerName}拍了拍${meName}${suffix}]`;
}

/** 收集「我发给 AI 的、待处理」的红包/转账/亲属卡/礼物卡（生成 system 待处理清单） */
function wxCollectPendingCards(msgs: WxMsg[]): PendingCardInfo[] {
  return msgs
    // 审计 #19：已撤回的待领取卡不进 AI 待处理清单（撤回即用户收回，AI 不应再领取/收款/拒收）
    .filter((m) => m.role === 'me' && !m.recalled && !wxCardIsFinal(m))
    .map<PendingCardInfo | null>((m) => {
      if (m.kind === 'redpacket' && m.rp) {
        return { id: m.rp.cid ?? m.id, kind: 'redpacket', amount: m.rp.amount, label: `祝福语"${m.rp.blessing}"` };
      }
      if (m.kind === 'transfer' && m.tr) {
        return { id: m.tr.cid ?? m.id, kind: 'transfer', amount: m.tr.amount, label: m.tr.note ? `备注"${m.tr.note}"` : '无备注' };
      }
      if (m.kind === 'family' && m.fam) {
        return { id: m.fam.cid ?? m.id, kind: 'family', amount: m.fam.monthlyLimit, label: `每月额度，${m.fam.message || '无留言'}` };
      }
      // 礼物卡（第七轮反馈）：未收下的进待处理清单，AI 用 [收下礼物卡:礼物ID] 收下
      if (m.kind === 'giftcard' && m.gift) {
        return { id: m.gift.id, kind: 'gift', label: `礼物「${m.gift.name}」${m.gift.countLabel}` };
      }
      return null;
    })
    .filter((x): x is PendingCardInfo => x !== null);
}

/**
 * 单聊红包/转账 24h 过期清算（群聊 expireStalePackets 的单聊版，审计 #5）：
 * 扫描所有单聊会话里「超过 24h 未领取/未收款」的红包与转账，双向清算：
 * - AI 发出的卡（role='peer'）：原卡置终态（status='returned'，气泡变灰显示「已退回」、不可再领取/收款），
 *   通知行「XX的红包/转账已过期，X元已退回」。资金退回发起人（AI）：AI 没有零钱账户（钱包/账单只记
 *   机主收支，与群聊口径一致——群聊也只在发起人是机主时才写零钱账单），故退回只改卡片状态、不写余额与账单。
 * - 用户发出的卡（role='me'，审计 #5：此前只清 AI 侧，用户发卡扣款后 AI 不处理就永久悬挂）：原卡置
 *   returned 终态 + 金额退回零钱（发卡时 wxExecutePayment 扣过款，退回写收入账单，对齐群聊「机主发起 →
 *   退回零钱+写账单」口径）+ 通知行「你发给XX的红包/转账已过期退回，X元已退回零钱」。
 * 亲属卡不在清算范围（双向均排除）：收卡方可随时退还、按月扣费，没有「未领取悬挂」的资金语义。
 * 返回发生变更的会话 id 列表（调用方据此把落盘变更合并进已打开会话的本地 state）；
 * wxSweepCardsRunning 防重入（挂载清算与回合结算清算可能重叠，重入直接跳过本轮）。
 */
let wxSweepCardsRunning = false;
async function wxExpireStalePeerCards(): Promise<string[]> {
  if (wxSweepCardsRunning) return [];
  wxSweepCardsRunning = true;
  try {
    const now = Date.now();
    const changed: string[] = [];
    // 过期清算的通知行文案用联系人展示名 → 同样走 wx 投影（头像隔离不影响其余字段）
    const contacts = await listContactsFor('wx').catch(() => [] as ContactRecord[]);
    for (const c of contacts) {
      const msgs = loadMsgs(c.id);
      if (msgs.length === 0) continue;
      const notices: WxMsg[] = [];
      const next = msgs.map((m) => {
        // 未到期或已是终态：幂等跳过（终态卡不重复清算，退款不双计）
        if (now - m.time < 24 * 3600_000 || wxCardIsFinal(m)) return m;
        if (m.role === 'peer') {
          // AI 发的卡 → 退回 AI（AI 无零钱账户，不写余额与账单）
          if (m.kind === 'redpacket' && m.rp) {
            notices.push({
              id: uid(),
              role: 'peer',
              content: '',
              time: now + notices.length,
              kind: 'notice',
              notice: { icon: 'rp', pre: `${displayNameOf(c)}的红包已过期，`, accent: `${fmtMoney(m.rp.amount)}元已退回` },
            });
            return { ...m, content: '[微信红包]（已退回）', rp: { ...m.rp, status: 'returned' as const } };
          }
          if (m.kind === 'transfer' && m.tr) {
            notices.push({
              id: uid(),
              role: 'peer',
              content: '',
              time: now + notices.length,
              kind: 'notice',
              notice: { icon: 'tr', pre: `${displayNameOf(c)}的转账已过期，`, accent: `${fmtMoney(m.tr.amount)}元已退回` },
            });
            // refundedBy='peer'：资金退回 AI 侧，详情页按既有退还语义显示「对方已退还」+ 退款时间
            return { ...m, content: '[转账]（已退回）', tr: { ...m.tr, status: 'returned' as const, refundedAt: now, refundedBy: 'peer' as const } };
          }
          return m; // 亲属卡不在清算范围
        }
        if (m.role === 'me') {
          // 用户发的卡 → 退回用户零钱（发卡时已扣款；退回=收入，写账单；已撤回的卡同样清算，避免金额永久悬挂）
          if (m.kind === 'redpacket' && m.rp) {
            wxPatchBalance(m.rp.amount, { kind: '红包退款', amount: m.rp.amount, peer: displayNameOf(c) });
            notices.push({
              id: uid(),
              role: 'peer',
              content: '',
              time: now + notices.length,
              kind: 'notice',
              notice: { icon: 'rp', pre: `你发给${displayNameOf(c)}的红包已过期退回，`, accent: `${fmtMoney(m.rp.amount)}元已退回零钱` },
            });
            return { ...m, content: '[微信红包]（已退回）', rp: { ...m.rp, status: 'returned' as const } };
          }
          if (m.kind === 'transfer' && m.tr) {
            wxPatchBalance(m.tr.amount, { kind: '转账退款', amount: m.tr.amount, peer: displayNameOf(c) });
            notices.push({
              id: uid(),
              role: 'peer',
              content: '',
              time: now + notices.length,
              kind: 'notice',
              notice: { icon: 'tr', pre: `你发给${displayNameOf(c)}的转账已过期退回，`, accent: `${fmtMoney(m.tr.amount)}元已退回零钱` },
            });
            // 对方超 24h 未收款自动退回：详情页沿用「对方已退还」语义 + 退款时间
            return { ...m, content: '[转账]（已退回）', tr: { ...m.tr, status: 'returned' as const, refundedAt: now, refundedBy: 'peer' as const } };
          }
          return m; // 亲属卡不在清算范围
        }
        return m;
      });
      if (notices.length > 0) {
        saveMsgs(c.id, [...next, ...notices]);
        changed.push(c.id);
      }
    }
    return changed;
  } finally {
    wxSweepCardsRunning = false;
  }
}

/**
 * 应用 AI 的处理动作（领取/退回/拒收我发的红包/转账/收下/拒收亲属卡）：只处理「待处理」状态的目标（幂等），
 * 返回更新后的消息数组 + 动作产生的通知行/接收凭据卡（extras），由调用方按
 * 流式输出顺序插在动作发生位置。标记不带感谢语/理由，回应内容由 AI 人设正文承担。纯本地模拟：
 * 领取 → 记入领取人；退回/拒收 → 金额退回零钱（写账单；审计 #3：拒收同退回均退款，仅卡面状态不同）；
 * 亲属卡收下 → claimed + 钱包「我送出的」卡补写 status='active'（审计 #4：不再写「我收到的亲属卡」）。
 */
function wxApplyAiActions(
  actions: RichAction[],
  msgs: WxMsg[],
  peer: ContactRecord,
  timeBase = Date.now()
): { msgs: WxMsg[]; notices: WxMsg[]; extras: WxMsg[] } {
  const next = msgs.map((m) => ({ ...m }));
  const notices: WxMsg[] = [];
  const extras: WxMsg[] = [];
  const matchIdx = (a: RichAction): number =>
    next.findIndex(
      (m) =>
        m.role === 'me' &&
        ((m.kind === 'redpacket' && (m.rp?.cid === a.targetId || m.id === a.targetId)) ||
          (m.kind === 'transfer' && (m.tr?.cid === a.targetId || m.id === a.targetId)) ||
          (m.kind === 'family' && (m.fam?.cid === a.targetId || m.id === a.targetId)) ||
          // 礼物卡（第七轮反馈）：[收下礼物卡:礼物ID]——礼物 id 随消息落库，兼容消息 id 匹配
          (m.kind === 'giftcard' && !!m.gift && (m.gift.id === a.targetId || m.id === a.targetId)))
    );
  for (const a of actions) {
    const idx = matchIdx(a);
    if (idx < 0) continue;
    const m = next[idx];
    if (wxCardIsFinal(m)) continue; // 只处理待处理状态
    const verb = actionVerb(a.kind);
    const time = timeBase + notices.length + extras.length;
    if (m.kind === 'redpacket' && m.rp) {
      const rp = m.rp;
      if (verb === 'claim') {
        next[idx] = { ...m, content: `[微信红包]（${peer.name}已领取）`, rp: { ...rp, opened: true, openedAt: Date.now(), openedBy: peer.name } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}领取了你的`, accent: '红包' } });
      } else if (verb === 'return') {
        next[idx] = { ...m, content: '[微信红包]（已退回）', rp: { ...rp, status: 'returned' } };
        wxPatchBalance(rp.amount, { kind: '红包退款', amount: rp.amount, peer: peer.name });
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}退回了你的`, accent: '红包' } });
      } else {
        // 审计 #3：拒收=资金退回发起人（本函数只处理 role='me' 的卡，即用户发的卡）——与退回分支同款
        // 退款+账单（此前只置终态不退款，金额永久悬挂）；通知行带「已退回」
        next[idx] = { ...m, content: '[微信红包]（已拒收）', rp: { ...rp, status: 'rejected' } };
        wxPatchBalance(rp.amount, { kind: '红包退款', amount: rp.amount, peer: peer.name });
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}拒收了你的`, accent: '红包（已退回）' } });
      }
    } else if (m.kind === 'transfer' && m.tr) {
      const tr = m.tr;
      if (verb === 'claim') {
        // AI 收款：原卡标记已收款 + receiptOf='me'（详情页显示「XX已收款」）+ 「已收款」接收凭据卡——
        // 凭据卡放 extras，由调用方插在动作发生位置（而不是旧代码里永远排在所有新消息之前）
        next[idx] = { ...m, content: '[转账]（已收款）', tr: { ...tr, received: true, receivedAt: Date.now(), receiptOf: 'me' as const } };
        extras.push({ id: uid(), role: 'peer', content: '', time, kind: 'transfer', tr: { amount: tr.amount, note: tr.note, received: true, receivedAt: Date.now(), receiptOf: 'me' } });
      } else if (verb === 'return') {
        // AI 退回我发的转账：原卡标记终态（变灰）+ 「对方」发出的退还凭据卡放 extras（灰卡↩+已退还，详情页「对方已退还」）
        const refundedAt = Date.now();
        next[idx] = { ...m, content: '[转账]（已退回）', tr: { ...tr, status: 'returned', refundedAt } };
        wxPatchBalance(tr.amount, { kind: '转账退款', amount: tr.amount, peer: peer.name });
        extras.push({
          id: uid(),
          role: 'peer',
          content: '',
          time,
          kind: 'transfer',
          tr: { amount: tr.amount, note: tr.note, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'peer' as const },
        });
      } else {
        // 审计 #3：拒收=资金退回发起人（同红包拒收分支）
        next[idx] = { ...m, content: '[转账]（已拒收）', tr: { ...tr, status: 'rejected' } };
        wxPatchBalance(tr.amount, { kind: '转账退款', amount: tr.amount, peer: peer.name });
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'tr', pre: `${peer.name}拒收了你的`, accent: '转账（已退回）' } });
      }
    } else if (m.kind === 'family' && m.fam) {
      const fam = m.fam;
      if (verb === 'claim') {
        next[idx] = { ...m, content: `[亲属卡]（${peer.name}已收下）`, fam: { ...fam, claimed: true, claimedAt: Date.now() } };
        // 审计 #4：AI 收下亲属卡只置发出卡终态，不再写入「我收到的亲属卡」——用户是赠予方、收卡方是 AI，
        // 机主侧没有收到任何卡（旧实现方向反转：机主白得一张可支付的亲属卡且无人出资）。
        // 补写钱包「我送出的」亲属卡 status='active'（存储为权威读改写；此前全库无 'active' 写入点，状态永不翻转）：
        // 优先精确匹配同额度卡，退而取该联系人第一张待领取卡
        const fcOut = loadFamilyCards();
        let fcIdx = fcOut.findIndex((f) => f.friendId === peer.id && f.status === 'pending' && f.monthlyLimit === fam.monthlyLimit);
        if (fcIdx < 0) fcIdx = fcOut.findIndex((f) => f.friendId === peer.id && f.status === 'pending');
        if (fcIdx >= 0) saveFamilyCards(fcOut.map((f, i) => (i === fcIdx ? { ...f, status: 'active' as const } : f)));
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'fam', pre: `${peer.name}收下了你的`, accent: '亲属卡' } });
      } else {
        next[idx] = { ...m, content: '[亲属卡]（已退回）', fam: { ...fam, rejected: true } };
        // #23：AI 退回/拒收亲属卡 → 钱包「我送出的」卡同步置 returned 终态（此前无该状态，
        // 管理页「待对方领取」永挂）。定位对齐上方 claim 分支：同额度精确匹配 → 退而该联系人第一张待领取卡
        const fcOut = loadFamilyCards();
        let fcIdx = fcOut.findIndex((f) => f.friendId === peer.id && f.status === 'pending' && f.monthlyLimit === fam.monthlyLimit);
        if (fcIdx < 0) fcIdx = fcOut.findIndex((f) => f.friendId === peer.id && f.status === 'pending');
        if (fcIdx >= 0) saveFamilyCards(fcOut.map((f, i) => (i === fcIdx ? { ...f, status: 'returned' as const } : f)));
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'fam', pre: `${peer.name}拒收了你的`, accent: '亲属卡' } });
      }
    } else if (m.kind === 'giftcard' && m.gift) {
      // 礼物卡（第七轮反馈）：AI 用 [收下礼物卡:礼物ID] 收下机主送的礼物——卡片置已收下
      // （持久化在消息上，重开收礼弹窗按钮变「已收下」）+ 通知行「XX收下了你的礼物」（与红包/亲属卡同款）
      const gift = m.gift;
      if (verb === 'claim') {
        next[idx] = { ...m, content: `[礼物卡片]（${peer.name}已收下）`, gift: { ...gift, accepted: true } };
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'gift', pre: `${peer.name}收下了你的`, accent: '礼物' } });
      }
    } else {
      continue;
    }
  }
  return { msgs: next, notices, extras };
}

/** 读取用户选择的图片：压缩为最长边 max（默认 720，背景图传 1280）px 的 JPEG dataURL；
 *  GIF 动图直通原始 dataURL（canvas 重绘会丢帧变静态图）；群聊发图复用同一套压缩逻辑。
 *  第二十九轮修复「发不了图」：canvas 解码失败（HEIC/冷门格式）时回退原始 dataURL，
 *  不再把整张图直接丢弃（发出去的图总比发不出好；AI 看不了原始 HEIC 时识图兜底再处理） */
export function readImageFile(file: File, max = 720): Promise<string> {
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
      const viaRaw = () => {
        // 兜底：原始 dataURL——仅当浏览器已证明能解码（Image 成功但 canvas 失败）时才值得保存
        if (result.startsWith('data:image/')) resolve(result);
        else reject(new Error('图片解析失败'));
      };
      // 第三十轮「上传的图片不显示」同款修复（与 album.tsx readImageFile 同步）：
      // Image 解码失败（HEIC 等）时此前会原样保存 → 存进去的是永远显示不出来的死图。
      // 现改为先试 createImageBitmap（支持面更广，部分平台能解 HEIC），仍失败才明确 reject。
      const viaBitmap = () => {
        if (typeof createImageBitmap !== 'function') {
          reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG'));
          return;
        }
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then((bmp) => {
            try {
              const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
              const w = Math.max(1, Math.round(bmp.width * scale));
              const h = Math.max(1, Math.round(bmp.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('图片解析失败'));
                return;
              }
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              ctx.drawImage(bmp, 0, 0, w, h);
              try {
                bmp.close();
              } catch {
                /* close 失败不影响 */
              }
              const out = canvas.toDataURL('image/jpeg', 0.72);
              if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
              else reject(new Error('图片解析失败'));
            } catch {
              reject(new Error('图片解析失败'));
            }
          })
          .catch(() => reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG')));
      };
      const img = new Image();
      img.onerror = () => viaBitmap();
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
            viaRaw();
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL('image/jpeg', 0.72);
          if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
          else viaRaw();
        } catch {
          viaRaw();
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------- 通用小部件 ----------------

/** 微信行内图标方块（功能行用） */
function WxTileIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <div
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[8px] text-white shadow-sm"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/** 头像：默认微信风格「正方形圆角」（有图用图，无图用灰底剪影）；shape='circle' = 圆形
 *  （显示设置 › 头像样式，仅聊天页传入；其余调用点保持微信原生圆角方形） */
export function WxAvatar({
  src,
  alt,
  size = 44,
  shape,
}: {
  src: string | null;
  alt: string;
  size?: number;
  shape?: 'rounded' | 'circle';
}) {
  const radius = shape === 'circle' ? size / 2 : Math.max(4, Math.round(size * 0.11));
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  if (src) {
    return <img src={src} alt={alt} className="shrink-0 bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#C9C9CE] text-white dark:bg-[#3C3C42]"
      style={style}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}

/** 显示设置元信息适用性：系统类胶囊（sys/notice/拉黑申请）与已撤回消息不参与已读/时间显示 */
const wxMetaOk = (m: WxMsg) => !m.recalled && m.kind !== 'sys' && m.kind !== 'notice' && m.kind !== 'blockreq';

/** 显示设置 › 已读回执：我发消息 = 我读了 TA 的全部未读消息（append 前统一走这里，纯函数） */
const markPeerRead = (list: WxMsg[]): WxMsg[] =>
  list.map((x) => (x.role === 'peer' && x.unread ? { ...x, unread: false } : x));

/** 元信息小字统一样式（已读未读 / 时间；颜色由 style 覆盖未读态）。
 *  头像下：超宽先缩字、放不下按自然断点堆叠（StackFitText）；气泡下：nowrap 单行不内部折行 */
const wxMetaText = 'text-[10px] leading-[1.35] text-black/40 dark:text-white/40';

/** 元信息小字：已读浅灰 / 未读深灰（用户指定：未读弃品牌色，灰色系双阶区分） */
const wxMetaReadCls = 'text-black/35 dark:text-white/40';
const wxMetaUnreadCls = 'text-black/60 dark:text-white/75';

/** 显示设置 › 已读未读 + 时间：头像下方上下两行（已读未读在上、时间在下）。
 *  用户指定：文字超宽时字号自动变小、不向屏幕内侧延伸；对齐沿袭原锚定边（我的右对齐、TA 的左对齐）。
 *  长日期模板（yyyy/MM/dd HH:mm 等）缩到下限仍放不下时改用 StackFitText——
 *  按空格/自然断点拆行堆叠（日期一行、时间一行），每行独立缩字，绝不裁字「显示不全」 */
function WxMetaUnderAvatar({ m, cfg }: { m: WxMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'avatar' && wxMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'avatar' && wxMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col gap-y-[1px] leading-none self-stretch ${
        m.role === 'me' ? 'text-right' : 'text-left'
      }`}
    >
      {showRead && (
        <StackFitText
          testId={`wx-read-${m.id}`}
          className={`block w-full ${wxMetaText} ${m.unread ? wxMetaUnreadCls : wxMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </StackFitText>
      )}
      {showTime && (
        <StackFitText testId={`wx-time-${m.id}`} className={`block w-full ${wxMetaText}`}>
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </StackFitText>
      )}
    </span>
  );
}

/** 显示设置 › 已读未读 + 时间：气泡下方上下两行——靠气泡末尾（远离头像的一侧：我的=左下、TA的=右下，
 *  原生样式）；同显时上下堆叠（用户指定：已读未读在上、时间在下）。
 *  子项 nowrap：日期模板（yyyy/MM/dd HH:mm）等长格式也不内部折行。
 *  仅挂在文本气泡列（最常见消息形态） */
function WxMetaUnderBubble({ m, cfg }: { m: WxMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'bubble' && wxMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'bubble' && wxMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col self-stretch gap-y-[1px] leading-none ${
        m.role === 'me' ? 'items-start' : 'items-end'
      }`}
    >
      {showRead && (
        <span
          data-testid={`wx-read-${m.id}`}
          className={`whitespace-nowrap ${wxMetaText} ${m.unread ? wxMetaUnreadCls : wxMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </span>
      )}
      {showTime && (
        <span data-testid={`wx-time-${m.id}`} className={`whitespace-nowrap ${wxMetaText}`}>
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </span>
      )}
    </span>
  );
}

/** 引用块迷你缩略图（Task 30）：被引用的图片/表情在引用胶囊里显示 36px 小图——
 *  加载失败自动隐藏（引用块退回纯文字行，quote.content 兜底可读） */
function WxQuoteThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      data-testid="wx-quote-thumb"
      className="h-9 w-9 shrink-0 rounded-[3px] bg-black/[0.05] object-cover dark:bg-white/10"
      onError={() => setFailed(true)}
    />
  );
}

/** 微信引用胶囊（Task 30；从文本气泡抽出复用）：挂在气泡下方「名字：内容」半透明胶囊——
 *  文字/语音/图片/表情各类气泡统一用它渲染 m.quote（语音条升级不吞引用块）；
 *  图片/表情源显示迷你缩略图、语音源显示语音图标+时长；源消息已删/撤回或图挂掉退回纯文字 */
function WxQuoteBlock({ quote, srcMsg }: { quote: NonNullable<WxMsg['quote']>; srcMsg: WxMsg | null }) {
  const qThumb = srcMsg && !srcMsg.recalled ? ((srcMsg.kind === 'image' ? srcMsg.img?.src : srcMsg.kind === 'sticker' ? srcMsg.stk?.url : null) ?? null) : null;
  const qVoice = srcMsg && !srcMsg.recalled && srcMsg.kind === 'voice' ? (srcMsg.voice ?? null) : null;
  return (
    <div
      data-testid="wx-quote-block"
      className="mt-[3px] max-w-full overflow-hidden rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60"
    >
      {qThumb ? (
        <div className="flex items-center gap-2" data-testid="wx-quote-thumb-row">
          <span className="min-w-0 flex-1 truncate">{quote.name}：{quote.content}</span>
          <WxQuoteThumb src={qThumb} alt="引用图片" />
        </div>
      ) : qVoice ? (
        <div className="flex items-center gap-1.5" data-testid="wx-quote-voice-row">
          <AudioLines className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">{quote.name}：[语音]{qVoice.duration ? ` ${qVoice.duration}"` : ''}</span>
        </div>
      ) : (
        <p className="line-clamp-2 whitespace-pre-wrap break-all">{quote.name}：{quote.content}</p>
      )}
    </div>
  );
}

/** 微信风格功能行：白色卡片内，分隔线与文字对齐（左缩进 66px） */
function WxMenuRow({
  label,
  icon,
  onClick,
  first = false,
  right,
  redDot = false,
  badge,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  first?: boolean;
  right?: React.ReactNode;
  redDot?: boolean;
  /** 未读数角标（红色圆点数字，紧随标题之后；同真机「发现→朋友圈 3」样式） */
  badge?: number;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      /* wx-menu-row：发现/我/通讯录的菜单行锚点（自定义 CSS 示例模板可改行底/分割线/文字） */
      className="wx-menu-row relative flex w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      {!first && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
      {icon}
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          data-testid={testId ? `${testId}-badge` : undefined}
          aria-label={`${badge} 条新消息`}
          className="mr-0.5 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[10.5px] font-semibold leading-none text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {redDot && <span className="mr-0.5 h-2 w-2 shrink-0 rounded-full bg-[#FA5151]" aria-hidden="true" />}
      {right ?? <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />}
    </button>
  );
}

/** 「···」更多图标（微信风格） */
function EllipsisGlyph() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
    </span>
  );
}

/** 语音声波图标（聊天输入栏左侧圆钮用，单色细线：一个点 + 三道渐展声波弧，微信风格） */
function VoiceWaveGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="12" r="1.35" fill="currentColor" stroke="none" />
      {/* 三道弧 = 以圆点为圆心的同心圆弧段，半径渐增、张角渐收，弧线更流畅对称 */}
      <path d="M9.03 8.38A4.6 4.6 0 0 1 9.03 15.62" />
      <path d="M11.69 5.91A8.2 8.2 0 0 1 11.69 18.09" />
      <path d="M14.68 3.8A11.8 11.8 0 0 1 14.68 20.2" />
    </svg>
  );
}

/** 键盘图标（语音模式圆钮用：六枚圆角键 + 空格条，点按切回键盘输入） */
function KeyboardGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {[0, 1].map((row) =>
        [0, 1, 2].map((col) => (
          <rect key={`${row}-${col}`} x={3.4 + col * 6.9} y={4.8 + row * 6.4} width={4.5} height={4.5} rx={1.25} />
        )),
      )}
      <rect x={3.4} y={17.6} width={18.2} height={2.7} rx={1.35} />
    </svg>
  );
}

/** 伪二维码（确定性花纹，种子 = 微信号）：加我微信的名片码 */
function PseudoQR({ seed, size = 176 }: { seed: string; size?: number }) {
  const { cells, n } = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) / 4294967296;
    };
    const n = 25;
    const inFinder = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      cells[r] = [];
      for (let c = 0; c < n; c++) cells[r][c] = !inFinder(r, c) && rand() > 0.52;
    }
    return { cells, n };
  }, [seed]);
  const s = size / n;
  const finder = (x: number, y: number, key: string) => (
    <g key={key}>
      <rect x={x * s} y={y * s} width={7 * s} height={7 * s} rx={s} fill="currentColor" />
      <rect x={(x + 1) * s} y={(y + 1) * s} width={5 * s} height={5 * s} rx={s * 0.55} fill="#fff" />
      <rect x={(x + 2) * s} y={(y + 2) * s} width={3 * s} height={3 * s} rx={s * 0.35} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="text-[#07C160]" aria-hidden="true">
      {cells.flatMap((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect key={`${r}-${c}`} x={c * s + s * 0.12} y={r * s + s * 0.12} width={s * 0.76} height={s * 0.76} rx={s * 0.16} fill="currentColor" />
          ) : null
        )
      )}
      {finder(0, 0, 'tl')}
      {finder(n - 7, 0, 'tr')}
      {finder(0, n - 7, 'bl')}
    </svg>
  );
}

// ---------------- 登录页 ----------------

function LoginScreen({ onLogin, slot, onBack }: { onLogin: (u: WxUser) => void; slot?: PhoneAccount | null; /** 提供时（切换账号页「登录小号」入口）：左上角变返回而非关闭整个微信 */ onBack?: () => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode phone：手机号 + 微信密码；account：微信号 / QQ号 / 邮箱 + 密码（后端自动识别）
  const [mode, setMode] = useState<'phone' | 'account'>('phone');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 小号/匿名号槽位（Task 40 修正）：登录墙绑定当前槽位——预填该账号档案的登录账号（用户只需输密码），
  // 避免在 A 小号的登录墙里误登 B 的账号密码导致登录态串槽（切号页显示错账号/再切回要求重登）
  const [slotIdShown, setSlotIdShown] = useState('');
  // 槽位显示名（Task 40-S）：与登录后微信内的名字同口径（档案展示名，昵称优先）
  const [slotNameShown, setSlotNameShown] = useState('');
  useEffect(() => {
    if (!slot) return;
    let alive = true;
    void (async () => {
      const all = await listContacts().catch(() => [] as ContactRecord[]);
      if (!alive) return;
      const profile = all.find(
        (c) => c.kind === 'user' && (c.altOf === slot.id || c.id === slot.ownerContactId),
      );
      if (profile && socialNameOf(profile).trim()) setSlotNameShown(socialNameOf(profile).trim());
      const id = profile?.phone?.trim() || profile?.wechatId?.trim() || profile?.qqId?.trim() || '';
      if (alive && id) {
        setSlotIdShown(id);
        setAccount((a) => (a.trim() ? a : id));
      }
    })();
    return () => {
      alive = false;
    };
  }, [slot]);

  const canSubmit = account.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      // 小号/匿名号槽位：绑定登录——只认本槽位档案的账号密码（Task 40 修正）
      if (slot) {
        const alt = await loginAltSlot('wx', slot, account.trim(), password);
        if (alt.ok) {
          onLogin({
            id: alt.user.id,
            name: alt.user.name,
            realName: alt.user.realName,
            nickname: alt.user.nickname,
            avatar: alt.user.avatar,
            wechatId: alt.user.wechatId,
            phone: alt.user.phone,
            qqId: alt.user.qqId,
            // Task 41：altOf 必须透传——根组件据此切账号作用域 + 记登录历史
            altOf: alt.user.altOf,
          });
          return;
        }
        setError(alt.error);
        return;
      }
      // 本地校验：联系人存本地 IndexedDB，不再调服务端
      const rec = await loginWechat(mode === 'phone' ? 'phone' : 'wechat', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          realName: rec.user.realName,
          nickname: rec.user.nickname,
          avatar: rec.user.avatar,
          wechatId: rec.user.wechatId,
          phone: rec.user.phone,
          qqId: rec.user.qqId,
          // Task 41：自由登录命中小号档案时 altOf 非空——根组件据此切作用域（缺失会串槽）
          altOf: rec.user.altOf,
        });
        return;
      }
      setError(rec.error);
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#EDEDED] pt-[54px] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶部关闭/返回（切换账号页内嵌时为返回） */}
      <div className="flex h-11 items-center px-4">
        <button
          type="button"
          aria-label={onBack ? '返回' : '关闭微信'}
          data-testid={onBack ? 'wx-login-back' : 'wx-login-close'}
          onClick={() => (onBack ? onBack() : closeApp())}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          {onBack ? <ChevronLeft className="h-6 w-6" strokeWidth={1.8} /> : <X className="h-6 w-6" strokeWidth={1.8} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7">
        <h1 className="mt-8 text-center text-[26px] font-semibold tracking-wide">
          {mode === 'phone' ? '手机号登录' : '微信账号登录'}
        </h1>

        {/* 小号/匿名号槽位：明示当前登录身份 + 档案账号（Task 40 修正）；退出后的自由登录墙无槽位不显示（Task 41） */}
        {slot && (
          <p data-testid="wx-login-slot" className="mt-2.5 text-center text-[13px] leading-relaxed text-black/45 dark:text-white/45">
            当前账号：{slotNameShown || slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号')}
            {slotIdShown ? `（${slotIdShown}）` : ''}
          </p>
        )}

        <div className="mt-10 space-y-0">
          {mode === 'phone' && (
            <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
              <span className="w-[104px] shrink-0 text-[17px]">国家/地区</span>
              <span className="text-[17px] text-black/45 dark:text-white/45">中国大陆（+86）</span>
            </div>
          )}
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">{mode === 'phone' ? '手机号' : '账号'}</span>
            <input
              data-testid="wx-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'phone' ? '请填写手机号码' : '微信号 / QQ号 / 邮箱'}
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-14 items-center border-b border-black/10 dark:border-white/10">
            <span className="w-[104px] shrink-0 text-[17px]">密码</span>
            <input
              data-testid="wx-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'phone' ? '请填写微信密码' : '请填写密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'phone' && (
          <p className="mt-3 text-[13px] text-black/35 dark:text-white/35">上述手机号仅用于登录验证</p>
        )}

        <button
          type="button"
          data-testid="wx-login-switch"
          onClick={() => {
            setMode(mode === 'phone' ? 'account' : 'phone');
            setError('');
          }}
          className="mt-3 text-[15px] font-medium text-[#576B95] active:opacity-60"
        >
          {mode === 'phone' ? '用微信号/QQ号/邮箱登录' : '用手机号登录'}
        </button>

        {error && (
          <p data-testid="wx-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="wx-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mx-auto mt-10 block h-[46px] w-full max-w-[300px] rounded-[8px] text-[17px] font-medium transition-colors ${
            canSubmit
              ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
              : 'bg-black/10 text-black/35 dark:bg-white/10 dark:text-white/35'
          }`}
        >
          {busy ? '正在登录…' : '同意并继续'}
        </button>
      </div>

      <div className="flex items-center justify-center gap-4 pb-8 pt-4 text-[15px] text-[#576B95]">
        <button type="button" className="active:opacity-60" onClick={() => setError('密码找回暂未开放，请到「联系人」App 查看账号密码')}>
          找回密码
        </button>
        <span className="h-3.5 w-px bg-black/15 dark:bg-white/15" />
        <span className="text-black/40 dark:text-white/40">更多</span>
      </div>
    </div>
  );
}

// ---------------- 位置 + 亲属卡聊天卡片 ----------------

/** 位置页内置地点（点击直接发送位置卡片；经纬度随消息落盘，AI 可读到“用户在哪”） */
const WX_LOCATIONS: Array<ChatLocData> = [
  { name: '广州塔', address: '广东省广州市海珠区阅江西路222号', lat: 23.1066, lng: 113.3245 },
  { name: '天安门广场', address: '北京市东城区东长安街', lat: 39.9032, lng: 116.3916 },
  { name: '外滩', address: '上海市黄浦区中山东一路', lat: 31.2336, lng: 121.4903 },
  { name: '深圳湾公园', address: '广东省深圳市南山区滨海大道', lat: 22.5178, lng: 113.9367 },
  { name: '西湖风景区', address: '浙江省杭州市西湖区龙井路1号', lat: 30.2429, lng: 120.1476 },
  { name: '春熙路', address: '四川省成都市锦江区', lat: 30.657, lng: 104.081 },
];

/** 简易地图艺术块（位置卡片 / 位置页 / 位置详情复用：米色底 + 道路线网 + 绿地水域 + 红色定位针） */
function LocMapArt({ className = '', pinSize = 22 }: { className?: string; pinSize?: number }) {
  return (
    <span className={`relative block overflow-hidden bg-[#EAE7DE] dark:bg-[#26261F] ${className}`} aria-hidden="true">
      <span className="absolute left-0 top-[38%] h-[7px] w-full bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[30%] top-0 h-full w-[6px] bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[-10%] top-[8%] h-[4px] w-[75%] rotate-[24deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute left-[42%] top-[30%] h-[4px] w-[70%] rotate-[38deg] bg-[#F6D98A]/80 dark:bg-[#5A5142]" />
      <span className="absolute left-[8%] top-[62%] h-[5px] w-[60%] rotate-[-16deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute right-[6%] top-[8%] h-[26%] w-[22%] rounded-[6px] bg-[#CDE3C1]/80 dark:bg-[#2C3526]" />
      <span className="absolute bottom-[8%] left-[6%] h-[22%] w-[20%] rounded-[6px] bg-[#BFD9EA]/80 dark:bg-[#22303A]" />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <span
          className="relative block rotate-45 rounded-full rounded-br-full bg-[#E64340] shadow-[0_2px_4px_rgba(0,0,0,0.28)]"
          style={{ width: pinSize, height: pinSize }}
        >
          <span className="absolute inset-[26%] rounded-full bg-white" />
        </span>
      </span>
    </span>
  );
}

/** 亲属卡黄色圆标（白色卡片 + 环绕轨道 + 小心，对照微信亲属卡图标） */
function FamGlyph({ size = 42 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
      aria-hidden="true"
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
        <rect x="5.8" y="8.4" width="12" height="8" rx="1.5" transform="rotate(-14 11.8 12.4)" fill="#fff" />
        <path d="M3 12.8c1.1 3.7 6.2 6.3 11.6 5.4 4.3-.7 7.2-3.2 7.5-6.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        <path
          d="M19.1 3.4c.42-.5 1.22-.5 1.64 0 .42-.5 1.22-.5 1.64 0 .48.55.34 1.4-.24 1.9l-1.4 1.2-1.4-1.2c-.58-.5-.72-1.35-.24-1.9z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

/** 亲属卡聊天卡片（图①：白底 + 黄圆图标 + 「给C的亲属卡/待对方领取」+ 右侧淡黄星球轨道装饰 + 左下「亲属卡」；领取/退回后卡片颜色变灰） */
export function FamilyBubble({ title, sub, settled, fromMe, onClick }: { title: string; sub: string; settled: boolean; fromMe?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-fc-bubble"
      onClick={onClick}
      className="chat-card chat-card-fam relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-[0.97]"
      style={{ filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined }}
      aria-label={`${title}（${sub}）`}
    >
      {/* 小尾巴：白卡同色菱形（与红包/转账/礼物卡同轮统一），尖角处带一点圆弧 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-white dark:bg-[#1E1E1E] ${fromMe === false ? '-left-[3px]' : '-right-[3px]'}`}
        style={{ borderRadius: fromMe === false ? '2px 2px 2px 3px' : '2px 3px 2px 2px' }}
      />
      <span className="chat-card-body relative block overflow-hidden rounded-[4px] bg-white dark:bg-[#1E1E1E]">
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-[#FBF0C4] dark:bg-[#3B3722]" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 top-4 h-[82px] w-[150px] -rotate-[24deg] rounded-[50%] border-[3px] border-[#F6DFA2] dark:border-[#4A4426]"
        />
        <span className="relative flex items-center gap-2.5 px-3 pb-1.5 pt-3">
          <FamGlyph size={42} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-medium leading-snug text-[#574423] dark:text-[#E6D6AE]" data-testid="wx-fc-bubble-title">
              {title}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-[#BCA678] dark:text-[#9A8B62]" data-testid="wx-fc-bubble-status">
              {sub}
            </span>
          </span>
        </span>
        <span className="chat-card-label relative block px-3 pb-2 pt-2 text-[12px] text-black/30 dark:text-white/30">亲属卡</span>
      </span>
    </button>
  );
}

/** 位置聊天卡片（微信同款：上部名称/地址白底 + 下方小地图 + 红色定位针；群聊复用同一套组件） */
export function LocBubble({ name, address, onClick }: { name: string; address: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-loc-bubble"
      onClick={onClick}
      className="block w-[206px] overflow-hidden rounded-[8px] bg-white text-left shadow-sm active:brightness-95 dark:bg-[#1E1E1E]"
    >
      <span className="block px-3 pb-2 pt-2.5">
        <span className="block truncate text-[15px] leading-snug">{name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{address}</span>
      </span>
      <LocMapArt className="h-[64px] w-full" pinSize={24} />
    </button>
  );
}

/** 图片消息气泡（圆角直出，点开全屏预览）：中等尺寸（用户反馈过大 → 从 250×330 收敛）。
 *  img 用固定像素上限（max-w/max-h 均为绝对值，按比例缩放互不冲突；百分比在 flex 包裹层内会循环解析导致尺寸失真）；群聊复用同一套组件 */
export function ImageMsgBubble({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-img-bubble"
      onClick={onClick}
      className="block overflow-hidden rounded-[6px] active:opacity-80"
    >
      <img src={src} alt="图片消息" className="block max-h-[220px] w-auto min-w-[110px] max-w-[168px] object-cover" loading="lazy" />
    </button>
  );
}

/** 位置页（大地图 + 内置地点列表 + 自定义位置；选中即发送位置卡片；群聊复用同一套组件） */
export function LocationPickerPage({
  onClose,
  onSend,
  onToast,
}: {
  onClose: () => void;
  onSend: (name: string, address: string, coords?: { lat?: number; lng?: number }) => void;
  onToast: (m: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const submitCustom = () => {
    const n = name.trim();
    if (!n) {
      onToast('请输入位置名称');
      return;
    }
    onSend(n, address.trim() || n);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-picker">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-loc-back" onClick={onClose} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">{custom ? '自定义位置' : '位置'}</div>
          <span className="w-[46px]" />
        </div>
      </div>
      {custom ? (
        <div className="min-h-0 flex-1 px-4 pt-4">
          <div className="rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
            <input
              data-testid="wx-loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="位置名称"
              autoFocus
              className="h-[52px] w-full border-b border-black/[0.06] bg-transparent text-[16px] outline-none placeholder:text-black/30 dark:border-white/[0.08] dark:placeholder:text-white/30"
            />
            <input
              data-testid="wx-loc-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="详细地址（可选）"
              className="h-[52px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            data-testid="wx-loc-send"
            onClick={submitCustom}
            className="mt-6 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
          >
            发送位置
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <LocMapArt className="mx-4 mt-3 h-[170px] rounded-[10px]" pinSize={34} />
          <div className="mt-3 bg-white dark:bg-[#1A1A1A]">
            {WX_LOCATIONS.map((l, i) => (
              <button
                key={l.name}
                type="button"
                data-testid={`wx-loc-item-${i}`}
                onClick={() => onSend(l.name, l.address, { lat: l.lat, lng: l.lng })}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px]">{l.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{l.address}</span>
                </span>
                <MapPin className="h-[18px] w-[18px] shrink-0 text-[#E64340]" strokeWidth={1.8} />
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="wx-loc-custom"
            onClick={() => setCustom(true)}
            className="mt-3 flex w-full items-center justify-between bg-white px-4 py-3.5 text-left text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
          >
            自定义位置
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 位置详情页（点聊天中的位置卡片进入：大地图 + 名称地址；群聊复用同一套组件） */
export function LocViewLayer({ name, address, onClose }: { name: string; address: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-view">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="关闭" data-testid="wx-loc-view-close" onClick={onClose} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[16px] font-medium">位置</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 px-4 pt-3">
        <LocMapArt className="h-[44vh] rounded-[10px]" pinSize={40} />
        <div className="mt-3 rounded-[10px] bg-white px-4 py-3 dark:bg-[#1A1A1A]">
          <p className="text-[17px]">{name}</p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">{address}</p>
        </div>
      </div>
    </div>
  );
}

/** 表情消息气泡（点开全屏预览 + 意思提示；群聊复用同一套组件）。
 *  builtinWx：微信内置经典表情（/wechat-emojis/ 资源）——真微信同款：表情包在颜色气泡里（我方绿/对方白），
 *  尺寸与文字行高接近；用户收藏的大表情包保持原全宽无气泡样式 */
export function StickerMsgBubble({
  src,
  meaning,
  onClick,
  me,
}: {
  src: string;
  meaning: string;
  onClick: () => void;
  /** 消息角色：内置表情气泡配色（true=绿 #95EC69 / false=白） */
  me?: boolean;
}) {
  const builtin = src.startsWith('/wechat-emojis/');
  if (builtin) {
    return (
      <button
        type="button"
        data-testid="wx-sticker-bubble"
        onClick={onClick}
        className={
          'flex items-center justify-center rounded-[8px] px-2 py-1.5 active:opacity-80 ' +
          (me === false ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:bg-[#1E1E1E]' : 'bg-[#95EC69] dark:bg-[#3EB575]')
        }
        title={meaning || '表情'}
      >
        <img
          src={src}
          alt={meaning ? `表情：${meaning}` : '表情'}
          className="h-[52px] w-[52px] object-contain"
          loading="lazy"
        />
      </button>
    );
  }
  return (
    <button type="button" data-testid="wx-sticker-bubble" onClick={onClick} className="block active:opacity-80" title={meaning || '表情'}>
      <img
        src={src}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[10px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 表情添加表单（面板与管理页共用渲染逻辑抽出的内部组件） */
function StickerAddForm({
  tab,
  onTab,
  preview,
  url,
  meaning,
  onUrl,
  onMeaning,
  onPickFile,
  onSave,
  onCancel,
  saveLabel = '保存',
}: {
  tab: 'file' | 'url';
  onTab: (t: 'file' | 'url') => void;
  preview: string | null;
  url: string;
  meaning: string;
  onUrl: (v: string) => void;
  onMeaning: (v: string) => void;
  onPickFile: (files: FileList | null) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex gap-2">
        {(
          [
            ['file', '手机图片'],
            ['url', '图片 URL'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onTab(k)}
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'bg-[#07C160] text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-white text-[13px] text-black/40 active:bg-black/[0.03] dark:border-white/20 dark:bg-[#1A1A1A] dark:text-white/40"
        >
          {preview ? (
            <img src={preview} alt="表情预览" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <span className="text-[26px] leading-none">＋</span>
              从手机选择表情图片
            </span>
          )}
        </button>
      ) : (
        <input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="粘贴表情图片 URL（含中文可自动识别意思）"
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[8px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 聊天表情面板（表情按钮弹出：网格点选 + 内嵌添加[手机图片/URL+意思] + 管理删除）。
 *  内置表情（微信表情分组）点选不直接发送：走 onPickBuiltin 把 [微笑] 文字代码插入输入框，可与文字混排一起发
 *  （对照真实微信交互，用户截图参考）；用户收藏的大表情贴纸仍点选直发（onPick） */
export function WxStickerPanel({
  onPick,
  onPickBuiltin,
  onClose,
  onToast,
  liquid = false,
}: {
  onPick: (s: Sticker) => void;
  /** 内置表情点选回调（插入输入框；面板保持展开可连续点选） */
  onPickBuiltin?: (s: Sticker) => void;
  onClose: () => void;
  onToast: (m: string) => void;
  /** 液态玻璃主题（单聊传入；群聊等调用点不传保持默认白底面板） */
  liquid?: boolean;
}) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('wx'));
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [mode, setMode] = useState<'grid' | 'add'>('grid');
  /** 网上表情搜索面板（Task 28 替换式：打开时替换面板本体，占面板原位同高，关闭恢复） */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 面板容器 ref + 打开搜索瞬间实测的面板高度（offsetHeight 即壳本地 px，transform 不影响它） */
  const panelRef = useRef<HTMLDivElement>(null);
  const [searchH, setSearchH] = useState(0);
  const openSearch = () => {
    const h = panelRef.current?.offsetHeight ?? 0;
    if (h > 100) setSearchH(h);
    setSearchOpen(true);
  };
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [editMode, setEditMode] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftMeaning, setDraftMeaning] = useState('');

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };
  // Task 32：聊天页长按表情「添加到表情」后面板同步刷新（面板开着也能立即看到新表情）
  useEffect(() => {
    const syncStickers = () => {
      setList(loadStickers('wx'));
      setGroups(loadStickerGroups('wx'));
    };
    window.addEventListener('wx-stickers-changed', syncStickers);
    return () => window.removeEventListener('wx-stickers-changed', syncStickers);
  }, []);
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  /** 新建分组（分组栏「＋」胶囊）：持久化 + 自动选中新分组（新组为空，接着点「添加」即归入该组） */
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    const next = [...groups, g];
    setGroups(next);
    saveStickerGroups('wx', next);
    setActiveGroupId(g.id);
    onToast(`已新建分组「${g.name}」`);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await readImageFile(f, 240));
      setDraftMeaning(fileNameMeaning(f.name));
    } catch {
      onToast('图片读取失败');
    }
  };
  const save = () => {
    const url = tab === 'file' ? preview : draftUrl.trim();
    if (!url || !isImageUrl(url)) {
      onToast(tab === 'file' ? '请先选择图片' : '请输入正确的图片 URL');
      return;
    }
    const meaning = draftMeaning.trim();
    commit([{ id: newStickerId(), url, meaning, groupId: activeGroupId, createdAt: Date.now() }, ...list]);
    onToast(meaning ? `已添加表情（${meaning}）` : '已添加表情');
    setPreview(null);
    setDraftUrl('');
    setDraftMeaning('');
    setMode('grid');
  };

  /** 点表情下方的意思标签 → 弹出意思选择 UI（预设胶囊 + 自定义 + 可不设置） */
  const [meaningFor, setMeaningFor] = useState<Sticker | null>(null);

  /** 长按表情 → 预览卡（真微信同款：大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
  const [pressSticker, setPressSticker] = useState<Sticker | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const suppressPickRef = useRef(false);
  const clearStickerPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  useEffect(() => () => clearStickerPress(), []);
  const onStickerPointerDown = (s: Sticker) => (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearStickerPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setPressSticker(s);
      suppressPickRef.current = true;
    }, 480);
  };
  const onStickerPointerMove = (e: React.PointerEvent) => {
    if (!pressTimerRef.current) return;
    const t = e.currentTarget as HTMLElement;
    const r = t.getBoundingClientRect();
    if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) clearStickerPress();
  };
  const closeStickerPreview = () => {
    setPressSticker(null);
    suppressPickRef.current = false;
  };

  return (
    <div
      ref={panelRef}
      className={
        liquid
          ? /* 液态玻璃（用户指定）：去实底与上边框，乳白强模糊玻璃面板 */
            'lg-sheet relative shrink-0 mx-2.5 mb-2.5 rounded-[24px]'
          : 'relative shrink-0 border-t border-black/[0.05] bg-[#F7F7F7] dark:border-white/[0.06] dark:bg-[#161616]'
      }
      style={searchOpen ? { height: searchH > 0 ? searchH : 380 } : undefined}
      data-testid="wx-sticker-panel"
    >
      {searchOpen ? (
        /* 网上表情搜索面板（替换式）：整体替换面板本体占面板原位，关闭/选中后恢复原面板 */
        <StickerSearchSheet
          app="wx"
          onClose={() => setSearchOpen(false)}
          onSend={onPick}
          onAdd={(s) => commit([s, ...list])}
          isSaved={(url) => list.some((x) => x.url === url)}
          onToast={onToast}
        />
      ) : (
        <>
      <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
        <p className="text-[15px] font-medium">表情</p>
        <div className="flex items-center gap-4">
          {mode === 'grid' && (
            <button
              type="button"
              aria-label="搜索表情"
              data-testid="wx-sticker-panel-search"
              onClick={openSearch}
              className="text-black/45 active:opacity-60 dark:text-white/45"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          {mode === 'grid' && activeGroupId !== 'builtin' && list.some((s) => !s.builtin) && (
            <button
              type="button"
              data-testid="wx-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronLeft className="h-5 w-5 -rotate-90" strokeWidth={2} />
          </button>
        </div>
      </div>
      {/* 分组栏：毛玻璃胶囊分组名字（点选切换下方网格）+「＋」新建分组 */}
      <StickerGroupBar testPrefix="wx" groups={groups} activeId={activeGroupId} onSelect={setActiveGroupId} onCreate={createGroup} />
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-4 pt-1">
          {/* 内置表情=真机同款小表情（8列小尺寸）；用户收藏贴纸=大瓦片（4列） */}
          <div className={`grid ${activeGroupId === 'builtin' ? 'grid-cols-8 gap-1' : 'grid-cols-4 gap-2'}`}>
            {visible.map((s, i) => (
              <div key={s.id} className="relative">
                <button
                  type="button"
                  data-testid={`wx-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (editMode) return;
                    if (s.builtin) onPickBuiltin?.(s);
                    else onPick(s);
                  }}
                  onPointerDown={onStickerPointerDown(s)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className={
                    s.builtin
                      ? `flex h-10 w-full items-center justify-center overflow-hidden rounded-[8px] p-[3px] active:bg-black/[0.05]`
                      : `aspect-square w-full overflow-hidden rounded-[10px] active:bg-black/[0.05] p-1.5`
                  }
                  title={s.meaning || '表情'}
                >
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                {!s.builtin && (
                  <button
                    type="button"
                    data-testid={`wx-sticker-meaning-${i}`}
                    onClick={() => setMeaningFor(s)}
                    className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    {s.meaning || '＋意思'}
                  </button>
                )}
                {editMode && !s.builtin && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`wx-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== s.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {/* 内置分组不可添加（静态常量）；空占位保持网格末尾对齐 */}
            {activeGroupId === 'builtin' ? (
              <span aria-hidden="true" className="h-10 w-full" />
            ) : (
              <button
                type="button"
                data-testid="wx-sticker-panel-add"
                onClick={() => setMode('add')}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-black/20 text-black/35 active:bg-black/[0.04] dark:border-white/20 dark:text-white/35"
              >
                <span className="text-[24px] leading-none">＋</span>
                <span className="text-[11px]">添加</span>
              </button>
            )}
            <span aria-hidden="true" className="mt-0.5 h-4" />
          </div>
          {visible.length === 0 && (
            <p className="pb-2 pt-3 text-center text-[13px] text-black/35 dark:text-white/35">
              {list.length === 0 ? '还没有表情，点「＋」添加一张' : '该分组还没有表情，点「＋」添加一张'}
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 pb-4 pt-1">
          <StickerAddForm
            tab={tab}
            onTab={setTab}
            preview={preview}
            url={draftUrl}
            meaning={draftMeaning}
            onUrl={(v) => {
              setDraftUrl(v);
              const m = extractMeaningFromUrl(v);
              if (m) setDraftMeaning(m);
            }}
            onMeaning={setDraftMeaning}
            onPickFile={(files) => void pickFile(files)}
            onSave={save}
            onCancel={() => setMode('grid')}
          />
        </div>
      )}

      {/* 意思选择 UI（预设胶囊 + 自定义 + 不设置） */}
      {meaningFor && (
        <StickerMeaningPicker
          testPrefix="wx"
          url={meaningFor.url}
          value={meaningFor.meaning}
          onConfirm={(v) => {
            commit(list.map((x) => (x.id === meaningFor.id ? { ...x, meaning: v } : x)));
            onToast(v ? `意思已设为「${v}」` : '已清除意思');
            setMeaningFor(null);
          }}
          onClose={() => setMeaningFor(null)}
        />
      )}

      {/* 长按表情预览卡（真微信同款：白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="wx-sticker-preview"
          onClick={closeStickerPreview}
        >
          <div
            className="w-[220px] overflow-hidden rounded-[16px] bg-white shadow-2xl dark:bg-[#2A2A2E]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-[150px] items-center justify-center p-3">
              <img src={pressSticker.url} alt={pressSticker.meaning || '表情'} className="max-h-full max-w-full object-contain" />
            </div>
            <p className="pb-2.5 text-center text-[13px] text-black/45 dark:text-white/45">{pressSticker.meaning || '未命名表情'}</p>
            {pressSticker.builtin ? (
              <p className="pb-2.5 text-center text-[11px] text-black/30 dark:text-white/30">内置表情 · 不可删除</p>
            ) : (
              <button
                type="button"
                data-testid="wx-sticker-preview-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== pressSticker.id));
                  closeStickerPreview();
                  onToast('已删除表情');
                }}
                className="flex h-12 w-full items-center justify-center border-t border-black/[0.06] text-[15px] text-[#FA5151] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
              >
                删除
              </button>
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/** 表情管理页（「我」→表情：网格管理 + 单张编辑[改意思/删除] + 批量导入手机图片 + URL 添加自动识别意思） */
function WxStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('wx'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('wx'));
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  /** 编辑弹层里的所属分组（保存时随意思一起写入） */
  const [editGroupId, setEditGroupId] = useState<string>(DEFAULT_STICKER_GROUP_ID);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchDraftItem[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const commit = (next: Sticker[]) => {
    setList(next);
    saveStickers('wx', next);
  };
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  const applyGroups = (next: StickerGroup[]) => {
    setGroups(next);
    saveStickerGroups('wx', next);
  };
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    applyGroups([...groups, g]);
    onToast(`已新建分组「${g.name}」`);
  };

  /** FileList → 批量草稿项（压缩预览 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await readImageFile(f, 240);
        if (!url) continue;
        const stem = f.name.replace(/\.[a-z0-9]+$/i, '');
        const cn = fileNameMeaning(f.name);
        drafts.push({ key: newStickerId(), preview: url, name: cn || stem, fallbackName: stem, source: 'file' });
      } catch {
        // 单张失败跳过
      }
    }
    return drafts;
  };

  /** 批量导入：选完先进入预览确认弹窗（可改名/删除/继续选择），点「全部添加」才入库 */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const drafts = await filesToDrafts(files);
    if (drafts.length === 0) {
      onToast('没有可导入的图片');
      return;
    }
    setBatchItems(drafts);
    setBatchOpen(true);
  };

  /** 确认批量添加：草稿项转正式表情入库（插到最前，归入当前选中分组） */
  const confirmBatch = (items: BatchDraftItem[]) => {
    const added: Sticker[] = items.map((it) => ({ id: newStickerId(), url: it.preview, meaning: it.name.trim(), groupId: activeGroupId, createdAt: Date.now() }));
    commit([...added, ...list]);
    setBatchOpen(false);
    setBatchItems([]);
    onToast(`已添加 ${added.length} 张表情`);
  };

  const saveEdit = () => {
    if (!editing) return;
    commit(list.map((s) => (s.id === editing.id ? { ...s, meaning: editMeaning.trim(), groupId: editGroupId || DEFAULT_STICKER_GROUP_ID } : s)));
    setEditing(null);
    onToast('已保存');
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (s: Sticker) => {
    commit(list.filter((x) => x.id !== s.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-stickers-page">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="wx-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              {delMode ? '完成' : '管理'}
            </button>
          ) : (
            <span className="w-[46px]" />
          )}
        </div>
      </div>
      {/* 分组栏：毛玻璃胶囊分组名字（点选切换下方网格）+「＋」新建 +「管理分组」弹层入口 */}
      <StickerGroupBar
        testPrefix="wx"
        groups={groups}
        activeId={activeGroupId}
        onSelect={setActiveGroupId}
        onCreate={createGroup}
        onManage={() => setGroupManageOpen(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        {list.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-black/35 dark:text-white/35">
            还没有表情包
            <br />
            从下方添加，或批量导入手机图片
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-[13px] text-black/35 dark:text-white/35">
            该分组还没有表情
            <br />
            从下方添加，或切换到其他分组
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {visible.map((s, i) => (
              <button
                key={s.id}
                type="button"
                data-testid={`wx-stickers-item-${i}`}
                onClick={() => {
                  if (s.builtin) return; // 内置表情不可编辑/删除
                  if (delMode) {
                    delSticker(s);
                    return;
                  }
                  setEditing(s);
                  setEditMeaning(s.meaning);
                  setEditGroupId(s.groupId ?? DEFAULT_STICKER_GROUP_ID);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={s.url} alt={s.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{s.meaning || '点此写意思'}</span>
                {delMode && !s.builtin && (
                  <span
                    aria-hidden="true"
                    data-testid={`wx-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#FA5151] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1A1A1A]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="wx-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="wx-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[8px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
          >
            添加 URL
          </button>
        </div>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 单张编辑弹层（改意思 / 删除） */}
      {editing && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="wx-stickers-edit">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 dark:bg-[#1A1A1A]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情的意思（AI 会据此理解并回复）"
              data-testid="wx-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1A1A1A] dark:placeholder:text-white/30"
            />
            {/* 所属分组：胶囊点选，保存时生效 */}
            <p className="pb-1.5 pt-2.5 text-[12px] text-black/40 dark:text-white/40">所属分组</p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const on = (editGroupId || DEFAULT_STICKER_GROUP_ID) === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`wx-stickers-edit-group-${g.id === DEFAULT_STICKER_GROUP_ID ? 'my' : g.id}`}
                    onClick={() => setEditGroupId(g.id)}
                    className={`h-7 rounded-full border px-3 text-[12.5px] ${
                      on
                        ? 'border-[#07C160]/40 bg-[#07C160]/10 font-medium text-[#07C160]'
                        : 'border-black/[0.07] bg-white/60 text-black/50 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/50'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="wx-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[8px] bg-[#FA5151]/10 px-5 text-[15px] text-[#FA5151] active:bg-[#FA5151]/20 dark:bg-[#FA5151]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="wx-stickers-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 rounded-[8px] bg-[#07C160] text-[15px] font-medium text-white active:bg-[#06AD56]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量添加确认弹窗（预览 + 改名 + 删除 + 从链接导入 + 确认添加 N）；「添加 URL」也走同一弹窗（批量 URL 逐行解析） */}
      <BatchStickerSheet
        open={batchOpen}
        items={batchItems}
        onItemsChange={setBatchItems}
        onCancel={() => {
          setBatchOpen(false);
          setBatchItems([]);
        }}
        onConfirm={confirmBatch}
        onToast={onToast}
        testPrefix="wx"
      />

      {/* 分组管理弹层：重命名/删除自定义分组（组内表情移回默认组），底部新建分组 */}
      {groupManageOpen && (
        <StickerGroupManageSheet
          testPrefix="wx"
          groups={groups}
          stickers={list}
          onRename={(id, name) => {
            applyGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
            onToast('分组已重命名');
          }}
          onDelete={(id) => {
            applyGroups(groups.filter((g) => g.id !== id));
            commit(list.map((s) => (stickerGroupOf(s, groupIds) === id ? { ...s, groupId: DEFAULT_STICKER_GROUP_ID } : s)));
            if (activeGroupId === id) setActiveGroupId(DEFAULT_STICKER_GROUP_ID);
            onToast('分组已删除，表情移回「我的表情」');
          }}
          onCreate={createGroup}
          onClose={() => setGroupManageOpen(false)}
        />
      )}
    </div>
  );
}

/** 亲属卡领取页（图②：好友发我的——对方名 + 赠语 + 每月额度 + 说明 + 黄卡「X送的亲属卡」 + 对方头像 + 领取/退还按钮 + 财付通脚注） */
function WxFcClaimPage({
  peerName,
  peerAvatar,
  limit,
  message,
  claimed,
  claimedAt,
  rejected,
  onBack,
  onClaim,
  onRefund,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  message: string;
  claimed: boolean;
  claimedAt?: number;
  /** 被退还/拒收（终态，显示已退回） */
  rejected?: boolean;
  onBack: () => void;
  onClaim: () => void;
  /** 退还（拒收）该亲属卡 */
  onRefund: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-claim">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-claim-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium">亲属卡</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
        <p className="mt-8 text-[26px] font-medium" data-testid="wx-fc-claim-name">
          {peerName}
        </p>
        <p className="mt-7 text-[16px] leading-relaxed">{message}</p>
        <p className="mt-2 text-[16px]" data-testid="wx-fc-claim-limit">
          每月可用额度¥{fmtMoney(limit)}
        </p>
        {rejected ? (
          <p className="mt-3 text-[13px] text-black/45 dark:text-white/45" data-testid="wx-fc-claim-rejected">已退回该亲属卡</p>
        ) : claimed && typeof claimedAt === 'number' ? (
          <p className="mt-3 text-[13px] text-[#06AE56]" data-testid="wx-fc-claim-done">
            已于 {fmtFullDate(claimedAt)} 领取
          </p>
        ) : null}
        <p className="mt-6 text-[13px] leading-relaxed text-black/40 dark:text-white/40">
          领取后优先使用该卡支付，赠送方承担费用并收到通知，1天内未领取则自动作废。
          <button type="button" onClick={() => onToast('使用说明暂未开放')} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
            使用说明
          </button>
        </p>
        <div
          className="relative mt-6 overflow-hidden rounded-[10px] px-4 py-4"
          style={{ background: 'linear-gradient(135deg, #FDF3CE 0%, #FAE7A8 100%)' }}
          data-testid="wx-fc-claim-card"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-[#F7E39A]/70" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-6 h-[64px] w-[120px] -rotate-[22deg] rounded-[50%] border-[3px] border-[#EFCE74]/80"
          />
          <div className="relative flex items-center gap-3">
            <FamGlyph size={40} />
            <span className="text-[17px] font-medium text-[#C08A3A]">{peerName}送的亲属卡</span>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2.5 pb-4">
          <WxAvatar src={peerAvatar} alt={peerName} size={44} />
          <span className="text-[15px]">{peerName}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center px-5 pb-7">
        {rejected ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已退回
          </div>
        ) : claimed ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已领取
          </div>
        ) : (
          <div className="flex w-[68%] flex-col gap-2.5">
            <button
              type="button"
              data-testid="wx-fc-claim-btn"
              onClick={onClaim}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-[#06AE56] shadow-sm active:bg-black/[0.03]"
            >
              领取
            </button>
            <button
              type="button"
              data-testid="wx-fc-refund-btn"
              onClick={onRefund}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/55 shadow-sm active:bg-black/[0.03] dark:text-white/60"
            >
              退还
            </button>
          </div>
        )}
        <p className="mt-8 text-[13px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
      </div>
    </div>
  );
}

/** 亲属卡管理详情页（图③：我送的——对方头像 + 本月已用 + 每月消费上限[修改] + 对方领取时间 + 优先扣款方式 + 消费记录） */
function WxFcManagePage({
  peerName,
  peerAvatar,
  limit,
  used,
  claimed,
  claimedAt,
  method,
  onBack,
  onEditLimit,
  onPickMethod,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  used: number;
  claimed: boolean;
  claimedAt?: number;
  method: string;
  onBack: () => void;
  onEditLimit: (v: number) => void;
  onPickMethod: (m: string) => void;
  onToast: (m: string) => void;
}) {
  const [limitSheet, setLimitSheet] = useState(false);
  const [methodSheet, setMethodSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const cards = loadCards();
  const monthLabel = `${new Date().getMonth() + 1}月`;
  const saveLimit = () => {
    const n = Number(draft);
    if (!draft || Number.isNaN(n) || n <= 0) {
      onToast('请输入正确的金额');
      return;
    }
    onEditLimit(Math.round(n * 100) / 100);
    setLimitSheet(false);
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-detail">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-detail-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')} className="px-3 active:opacity-60">
          <EllipsisGlyph />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-8 pt-5">
          <WxAvatar src={peerAvatar} alt={peerName} size={72} />
          <p className="mt-5 text-center text-[16px]" data-testid="wx-fc-detail-title">
            给{peerName}的亲属卡，本月已用额度
          </p>
          <p className="mt-3 font-semibold" data-testid="wx-fc-detail-used">
            <span className="text-[22px]">¥ </span>
            <span className="text-[44px] leading-none">{fmtMoney(used)}</span>
          </p>
          <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
            每月消费上限 ¥{fmtMoney(limit)}
            <button
              type="button"
              data-testid="wx-fc-edit-limit"
              onClick={() => {
                setDraft(String(limit));
                setLimitSheet(true);
              }}
              className="ml-2 text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              修改
            </button>
          </p>
        </div>
        <div className="mt-9 border-t border-black/[0.06] px-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-4 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">对方领取时间</span>
            <span data-testid="wx-fc-detail-claimtime">{claimed && claimedAt ? fmtFullDate(claimedAt) : '待对方领取'}</span>
          </div>
          <button
            type="button"
            data-testid="wx-fc-method"
            onClick={() => setMethodSheet(true)}
            className="flex w-full items-center justify-between gap-3 border-t border-black/[0.06] py-4 text-left text-[15px] active:opacity-70 dark:border-white/[0.08]"
          >
            <span className="shrink-0 text-black/45 dark:text-white/45">优先扣款方式</span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
              >
                ¥
              </span>
              <span className="truncate">{method}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>
        <div className="h-[10px] bg-[#EDEDED] dark:bg-[#161616]" />
        <div className="px-5">
          <div className="flex items-center justify-between py-4">
            <span className="text-[17px]">消费记录</span>
            <button
              type="button"
              onClick={() => onToast(used > 0 ? '消费记录详情暂未开放' : '本月暂无消费')}
              className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              详情
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.06] py-4 text-[15px] dark:border-white/[0.08]">
            <span>{monthLabel}</span>
            <span data-testid="wx-fc-detail-month">¥{fmtMoney(used)}</span>
          </div>
        </div>
      </div>

      {/* 修改每月消费上限弹层 */}
      {limitSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setLimitSheet(false)} data-testid="wx-fc-limit-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-3 text-center text-[15px] font-medium">修改每月消费上限</p>
            <div className="flex items-center gap-2 rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
              <span className="text-[18px] font-semibold">¥</span>
              <input
                data-testid="wx-fc-limit-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(sanitizeAmount(e.target.value))}
                inputMode="decimal"
                placeholder="0.00"
                className="h-[52px] w-full bg-transparent text-[18px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            </div>
            <button
              type="button"
              data-testid="wx-fc-limit-ok"
              onClick={saveLimit}
              className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {/* 优先扣款方式弹层（零钱 / 银行卡） */}
      {methodSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setMethodSheet(false)} data-testid="wx-fc-method-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-2 text-center text-[15px] font-medium">优先扣款方式</p>
            <div className="rounded-[10px] bg-white dark:bg-[#1A1A1A]">
              {['零钱', ...cards.map((c) => `${c.bank} 储蓄卡`)].map((m, i) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`wx-fc-method-${i}`}
                  onClick={() => {
                    onPickMethod(m);
                    setMethodSheet(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-[13px] text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                    i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                  }`}
                >
                  {i === 0 ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[14px] font-semibold text-white">¥</span>
                  ) : (
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                      style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
                    >
                      ¥
                    </span>
                  )}
                  <span className="flex-1">{m}</span>
                  {method === m && <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMethodSheet(false)}
              className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 聊天页 ----------------

// ---------------- 聊天加号面板 + 红包/转账（对照用户微信截图 1:1） ----------------

type PlusAction = 'camera' | 'image' | 'voicecall' | 'videocall' | 'redpacket' | 'transfer' | 'location' | 'offline' | 'textcard' | 'together' | 'gift';

/**
 * 「文字图片」弹层（加号面板「文字图片」入口；Task 13 卡片版，无生图依赖）。
 * 输入可空——留空时 AI 按人设+最近聊天记录代笔（/api/textcard）；输入非空 = 用户代笔直接上卡。
 * 生成中状态 + 失败错误（留在弹层可重试）。
 */
function WxTextCardSheet({
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="wx-textcard-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1C1C1E]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold">写一张文字图片发给{charName}</p>
          <button
            type="button"
            aria-label="关闭文字图片"
            data-testid="wx-textcard-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60"
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
          data-testid="wx-textcard-input"
          placeholder="写点想印在卡片上的字（留空 = AI 结合 TA 的人设和你们的聊天记录帮你写）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] outline-none placeholder:text-black/30 focus:border-[#07C160]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="wx-textcard-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="wx-textcard-submit"
          onClick={submit}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#07C160] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
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

/** 红包图标（线描红信封：矩形 + 封口弧 + 圆形封印，替换与「礼物」撞形的 Gift 图标） */
function RedPacketIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 6.5 C7.5 9.5, 16.5 9.5, 20 6.5" />
      <circle cx="12" cy="13.5" r="2.6" />
    </svg>
  );
}

/** 加号面板（输入栏下方弹出，输入框跟随保留在面板上方）。
 *  液态玻璃主题（用户指定）：竖向乳白玻璃列表（图标左 + 文字右，lg-menu-row）。
 *  古早主题（第五十五轮，图1 同款）：白底平铺灰色图标（无彩色瓷贴）。
 *  第五十八轮（用户指定「视频聊天变成和其他一样」）：视频通话从底部深色宽按钮
 *  移回宫格，与其他项同一布局同一图标语言（RtPlusVideo）。
 *  面板保持原生全部功能（用户指定「加号面板里面的功能不要动」）；自定义只影响输入框上方快捷条 */
function PlusPanel({ onAction, liquid, retro }: { onAction: (a: PlusAction) => void; liquid?: boolean; retro?: boolean }) {
  // 第五十六轮（参考图2 同款）：古早加号面板用深灰实心剪影图标（白镂空细节）——
  // 相机实心机身白镜头 / 图片描边山形太阳 / 实心地图针白环 / 实心圆白 ¥ 等老微信 5.0 语言；
  // 默认/液态面板继续用彩色瓷贴 + lucide 线稿（功能与项集不变，用户指定「面板功能不要动」）
  const all: Array<{ key: PlusAction; label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = [
    { key: 'camera', label: '相机', icon: <Camera className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusCamera /> },
    { key: 'image', label: '图片', icon: <ImageIcon className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusImage /> },
    { key: 'voicecall', label: '语音通话', icon: <Phone className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusVoice /> },
    { key: 'videocall', label: '视频通话', icon: <Video className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusVideo /> },
    { key: 'redpacket', label: '红包', icon: <RedPacketIcon />, retroIcon: <RtPlusRedPacket /> },
    { key: 'transfer', label: '转账', icon: <ArrowLeftRight className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTransfer /> },
    { key: 'location', label: '位置', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusLocation /> },
    { key: 'offline', label: '线下', icon: <Star className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusOffline /> },
    { key: 'textcard', label: '文字图片', icon: <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTextCard /> },
    { key: 'together', label: '一起听', icon: <Headphones className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTogether /> },
    { key: 'gift', label: '礼物', icon: <Gift className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusGift /> },
  ];
  return (
    <div
      className={`shrink-0 ${
        liquid
          ? /* 液态玻璃（第四十六轮变小：行 44/字 14.5/图标 20/圆角 20；第四十七轮删 mx 横向外边距——
             宽度由外层包裹容器右锚定 248px 控制）竖向乳白玻璃列表 */
            'lg-sheet mb-2.5 rounded-[20px] py-[4px]'
          : retro
          ? /* 古早（图1）：白底 + 硬边顶线，无彩色瓷贴 */
            'border-t border-[#C9CBD2] bg-[#F5F5F7] px-2 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:border-[#3A3A44] dark:bg-[#232329]'
          : 'px-2 pt-4 border-t border-black/[0.05] bg-[#F7F7F7] pb-[max(16px,env(safe-area-inset-bottom))] dark:border-white/[0.06] dark:bg-[#161616]'
      }`}
      data-testid="wx-plus-panel"
    >
      {liquid ? (
        <div className="flex flex-col">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="lg-menu-row flex h-[44px] w-full items-center gap-3.5 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
            >
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-black/80 dark:text-white/85 [&_svg]:h-[20px] [&_svg]:w-[20px]">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      ) : retro ? (
        <div className="grid grid-cols-4">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="flex flex-col items-center gap-[9px] py-2.5 active:bg-black/[0.05] dark:active:bg-white/[0.06]"
            >
              {/* 图2 同款：无瓷贴的深灰实心剪影图标（白镂空细节）+ 深灰小字；
                  视频通话同在宫格（第五十八轮用户指定「变成和其他一样」） */}
              <span className="flex h-[42px] w-[42px] items-center justify-center">{it.retroIcon}</span>
              <span className="text-[12px] text-[#6A6E78] dark:text-white/60">{it.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="flex flex-col items-center gap-[7px] py-2 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="flex h-[57px] w-[57px] items-center justify-center rounded-[14px] bg-white text-black/70 shadow-[0_1px_5px_rgba(0,0,0,0.05)] dark:bg-[#242428] dark:text-white/75">
                {it.icon}
              </span>
              <span className="text-[12px] text-black/60 dark:text-white/60">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 输入框上方快捷功能条的图标/文案（与加号面板同源同文案；点击直接走 handlePlusAction，
 *  与点加号面板里那一项完全等效；面板本身不动）。
 *  第五十八轮（用户指定「输入框上面的功能图标变成古早主题图标」）：每项携带三主题图标——
 *  icon = 默认/液态玻璃共用现代线稿（液态在玻璃胶囊内），retroIcon = 古早实心剪影
 *  （与加号面板同语言，颜色走 --rt-ic-* 深浅自适应）；快捷条按主题选用 */
const WX_QUICK_META: Record<string, { label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = {
  camera: { label: '相机', icon: <Camera className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusCamera /> },
  image: { label: '图片', icon: <ImageIcon className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusImage /> },
  voicecall: { label: '语音通话', icon: <Phone className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVoice /> },
  videocall: { label: '视频通话', icon: <Video className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVideo /> },
  redpacket: { label: '红包', icon: <RedPacketIcon />, retroIcon: <RtPlusRedPacket /> },
  transfer: { label: '转账', icon: <ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTransfer /> },
  location: { label: '位置', icon: <MapPin className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusLocation /> },
  offline: { label: '线下', icon: <Star className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusOffline /> },
  textcard: { label: '文字图片', icon: <Sparkles className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTextCard /> },
  together: { label: '一起听', icon: <Headphones className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTogether /> },
  gift: { label: '礼物', icon: <Gift className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusGift /> },
};

/** 支付方式选择底部弹层（零钱 / 银行卡 / 我收到的亲属卡；发红包/转账页用；单聊/群聊共用） */
export function WxPayMethodSheet({
  cards,
  familyIn,
  selectedId,
  onClose,
  onPick,
}: {
  cards: WxCard[];
  familyIn: WxFamilyCardIn[];
  selectedId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const rows: Array<{ id: string; name: string; sub: string; icon: React.ReactNode }> = [
    {
      id: 'balance',
      name: '零钱',
      sub: `可用 ${fmtMoney(wxLoadBalance())} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[16px] font-semibold text-white" aria-hidden="true">
          ¥
        </span>
      ),
    },
    ...cards.map((c) => ({
      id: c.id,
      name: `${c.bank} 储蓄卡`,
      sub: `尾号${c.tail} · 可用 ${fmtMoney(c.balance)} 元`,
      icon: <BankDot bank={c.bank} size={36} />,
    })),
    // #22：同一赠卡人名下多张收到的亲属卡聚合为一行（行 id 取组内第一张卡，额度求和）；旧数据无 friendId 各自成行
    ...[...wxFcGroups(familyIn).values()].map((g) => ({
      id: g[0].id,
      name: `${g[0].fromName}的亲属卡${g.length > 1 ? `×${g.length}` : ''}`,
      sub: `${g[0].relation} · 本月可用 ${fmtMoney(g.reduce((s, f) => s + Math.max(0, f.monthlyLimit - f.used), 0))} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F7B500] to-[#F79C00] text-white" aria-hidden="true">
          <Heart className="h-[17px] w-[17px]" strokeWidth={2} />
        </span>
      ),
    })),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose} data-testid="wx-pay-method-sheet">
      <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="pb-2 text-center text-[15px] font-medium">选择支付方式</p>
        <div className="max-h-[340px] overflow-y-auto rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              data-testid={`wx-pay-method-${r.id === 'balance' ? 'balance' : r.id.startsWith('fcin-') ? 'fc' : cards.find((c) => c.id === r.id)?.tail ?? r.id}`}
              onClick={() => onPick(r.id)}
              className={`relative flex w-full items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
              }`}
            >
              {r.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 发红包页：金额/祝福语输入 + 支付方式行 + 底部「塞钱进红包」发送按钮（无数字键盘） */
function RedPacketCompose({
  onBack,
  onSubmit,
  onToast,
}: {
  onBack: () => void;
  onSubmit: (amount: number, blessing: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [blessing, setBlessing] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = resetFamilyCardsInMonth(); // 审计 #6：进入发送页先做跨月惰性重置，支付方式行「本月可用」即本月真实额度
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const denyToast = () => {
    if (methodId === 'balance') onToast('零钱不足，请先充值');
    else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
    else onToast('卡内余额不足，请更换支付方式');
  };
  const submit = () => {
    if (!ok) {
      onToast('请输入金额');
      return;
    }
    if (num > 200) {
      onToast('单个红包金额不可超过 200 元');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      denyToast();
      return;
    }
    onSubmit(num, blessing.trim() || '恭喜发财，大吉大利', methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">发红包</div>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="absolute right-4">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center justify-between rounded-[10px] bg-white px-4 py-[13px] dark:bg-[#1A1A1A]">
          <span className="text-[16px]">金额</span>
          <span className="flex items-center gap-1 text-[15px]">
            <span className="text-black/50 dark:text-white/50">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="wx-rp-amount-input"
              className="w-[96px] bg-transparent text-right text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
            />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-white px-4 py-[14px] dark:bg-[#1A1A1A]">
          <input
            value={blessing}
            onChange={(e) => setBlessing(e.target.value.slice(0, 25))}
            placeholder="恭喜发财，大吉大利"
            data-testid="wx-rp-blessing"
            className="h-8 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <button type="button" aria-label="表情" onClick={() => onToast('表情暂未开放')} className="shrink-0 active:opacity-60">
            <Smile className="h-[22px] w-[22px] text-black/35 dark:text-white/35" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onToast('红包封面暂未开放')}
          className="mt-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-[18px] active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <span className="text-[16px]">红包封面</span>
          <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-rp-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-10 text-center">
          <p className="font-semibold" data-testid="wx-rp-big">
            <span className="text-[28px]">¥</span>
            <span className="ml-2 text-[48px] leading-none">{val || '0.00'}</span>
          </p>
          <button
            type="button"
            data-testid="wx-rp-send"
            onClick={submit}
            className={`mt-8 h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
              ok ? 'bg-[#F04A3A]' : 'bg-[#F04A3A]/45'
            }`}
          >
            塞钱进红包
          </button>
        </div>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 转账页：转账给 xx + 金额输入卡 + 转账说明 + 支付方式行 + 底部「转账」发送按钮（无数字键盘）。
 *  单聊/群聊共用（群聊传入被选中的群成员） */
export function TransferCompose({
  peer,
  onBack,
  onSubmit,
  onToast,
}: {
  peer: ContactRecord;
  onBack: () => void;
  onSubmit: (amount: number, note: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = resetFamilyCardsInMonth(); // 审计 #6：进入发送页先做跨月惰性重置，支付方式行「本月可用」即本月真实额度
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const submit = () => {
    if (!ok) {
      onToast('请输入转账金额');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      if (methodId === 'balance') onToast('零钱不足，请先充值');
      else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
      else onToast('卡内余额不足，请更换支付方式');
      return;
    }
    onSubmit(num, note.trim(), methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        <div className="flex items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="text-[21px] font-semibold" data-testid="wx-tr-peer-name">
              转账给 {peer.name}
            </p>
            <p className="mt-1 truncate text-[14px] text-black/40 dark:text-white/40">微信号：{peer.wechatId || '未设置'}</p>
          </div>
          <WxAvatar src={peer.avatar} alt={peer.name} size={54} />
        </div>
        <div className="mt-5 rounded-[14px] bg-white px-5 pb-5 pt-5 dark:bg-[#1A1A1A]">
          <p className="text-[15px] text-black/70 dark:text-white/70">转账金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.06] pb-4 dark:border-white/[0.08]" data-testid="wx-tr-amount-big">
            <span className="text-[30px] font-semibold leading-none">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="转账金额"
              data-testid="wx-tr-amount-input"
              className="min-w-0 flex-1 bg-transparent text-[38px] font-semibold leading-none outline-none placeholder:text-black/20 dark:placeholder:text-white/20"
            />
          </div>
          <div className="mt-4">
            {noteOpen ? (
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 10))}
                placeholder="转账说明（10 字以内）"
                data-testid="wx-tr-note"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            ) : (
              <button type="button" data-testid="wx-tr-note-add" onClick={() => setNoteOpen(true)} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
                添加转账说明
              </button>
            )}
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[14px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-tr-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          data-testid="wx-tr-send"
          onClick={submit}
          disabled={!ok}
          className={`mx-auto mt-9 block h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white ${
            ok ? 'bg-[#07C160] active:brightness-95' : 'bg-[#07C160]/45'
          }`}
        >
          转账
        </button>
        <p className="pb-6 pt-4 text-center text-[12px] text-black/35 dark:text-white/35">请确认好收款人，谨防电信诈骗</p>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 红包聊天卡片（红橙渐变，底部「红包」条；与转账卡同宽 206px；未领取点击弹「開」，已领取进详情）。
 *  单聊/群聊共用同一套卡片组件（群聊传入群红包的祝福语/进度文案） */
export function RpBubble({ blessing, sub, settled, fromMe, onClick }: { blessing: string; sub: string; settled: boolean; fromMe?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-rp-bubble"
      onClick={onClick}
      className="chat-card chat-card-rp relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        // 领取/退还/拒收后卡片颜色变灰（对照真实微信：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`红包 ${blessing}（${sub}）`}
    >
      {/* 小尾巴：菱形凸出卡外（不被裁剪，与转账卡同款双层结构），尖角处带一点圆弧，颜色取卡身右上同段渐变 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-[#EC5A42] ${fromMe === false ? '-left-[3px]' : '-right-[3px]'}`}
        style={{ borderRadius: fromMe === false ? '2px 2px 2px 3px' : '2px 3px 2px 2px' }}
      />
      {/* 卡身：圆角 + overflow-hidden 只裁内容层（渐变/高光/底部标签），不再裁掉尾巴 */}
      <span className="chat-card-body relative block overflow-hidden rounded-[4px]" style={{ background: 'linear-gradient(135deg, #F2694C, #E94E38)' }}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full bg-white/10" />
        <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90 bg-white/15" aria-hidden="true">
            <span className="text-[20px] font-semibold leading-none text-white">¥</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-snug text-white">{blessing}</span>
            <span className="mt-0.5 block text-[11px] text-white/85">{sub}</span>
          </span>
        </span>
        {/* 「红包」标签：背景与卡身同色（去掉黑蒙层，仅保留文字，与转账卡同轮处理） */}
        <span className="chat-card-label relative block px-3 py-[5px] text-[12px] text-white/90">红包</span>
      </span>
    </button>
  );
}

/** 转账聊天卡片（橙色渐变 + 白描边圆⇆/对勾/退还↩ + 金额 + 状态文案 + 左下「转账」+ 朝向角标；紧凑尺寸；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入零钱」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（用户需求：退还接收以后不要显示留言）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实微信：终态卡褪色），退还卡圆图标换成↩。
 *  单聊/群聊共用同一套卡片组件（群聊传入群转账的状态文案）
 *  第 22 轮（用户反馈）：①**小尾巴真正露出来**——旧版尾巴画在 overflow-hidden 容器内被整片裁掉，
 *  现改为「外层无裁剪 + 内层内容圆角裁剪」双层结构，菱形尾巴凸出卡外（真机同款）；
 *  ②尾巴尖尖**不要那么尖**——尖角那颗圆角 3px（rotate(45deg) 后 TR=右侧尖 / BL=左侧尖）；
 *  ③底部「转账」标签背景改**与卡身同色**（去掉黑色蒙层） */
export function TrBubble({ amount, status, received, refunded, fromMe, note, settled, onClick }: { amount: number; status: string; received: boolean; refunded: boolean; fromMe: boolean; note?: string; settled?: boolean; onClick: () => void }) {
  // 终态（已收款/已退还/已拒收）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const line = !settled && note && note.trim() ? note : status;
  return (
    <button
      type="button"
      data-testid="wx-tr-bubble"
      onClick={onClick}
      className="chat-card chat-card-tr relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        // 收款/退还/拒收后卡片颜色变灰（对照真实微信：已收款与已退还的转账卡都褪色）
        filter: received || refunded ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ¥${fmtMoney(amount)}${received ? '（已收款）' : refunded ? '（已退还）' : ''}`}
    >
      {/* 小尾巴：菱形凸出卡外（不被裁剪），尖角处带一点点圆弧（3px），颜色取卡身右上同段渐变 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-[#F2A233] ${fromMe ? '-right-[3px]' : '-left-[3px]'}`}
        style={{ borderRadius: fromMe ? '2px 3px 2px 2px' : '2px 2px 2px 3px' }}
      />
      {/* 卡身：圆角 + overflow-hidden 只裁内容层（渐变/高光/底部标签），不再裁掉尾巴 */}
      <span className="chat-card-body relative block overflow-hidden rounded-[4px]" style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}>
        <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90" aria-hidden="true">
            {refunded ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.2} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.4} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-tight text-white">¥{fmtMoney(amount)}</span>
            <span className="mt-0.5 block truncate text-[13px] text-white/95" data-testid="wx-tr-bubble-status">
              {line}
            </span>
          </span>
        </span>
        {/* 「转账」标签：背景与卡身同色（第 22 轮去掉黑蒙层，仅保留文字） */}
        <span className="chat-card-label relative block px-3 py-[4px] text-[12px] text-white/90">转账</span>
      </span>
    </button>
  );
}

/**
 * 群聊邀请卡片（AI 主动建群/拉人时发出；对照真微信「邀请你加入群聊」卡片）：
 * pending = 副文案 + 接受/拒绝按钮（点「接受邀请」才进群）；accepted/rejected = 状态行（卡片本体不可点，不进群）。
 */
export function WxGroupCardBubble({
  card,
  onAccept,
  onReject,
}: {
  card: GroupCardData;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rejected = card.status === 'rejected';
  return (
    <div
      data-testid="wx-group-card"
      className={`w-[248px] select-none overflow-hidden rounded-[8px] bg-white shadow-sm dark:bg-[#1E1E1E] ${rejected ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体不可点击进群（需求：点卡片不进群，点「接受邀请」才算进群）；进群入口只有接受按钮 */}
      <div className="flex w-full items-center gap-2.5 px-3 pb-2.5 pt-3 text-left">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] bg-[#07C160]/10 dark:bg-[#07C160]/15"
        >
          <Users className="h-5 w-5 text-[#07C160]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-[1.3] text-black dark:text-white">{card.name}</span>
          <span className="mt-0.5 block truncate text-[12px] leading-[1.3] text-black/45 dark:text-white/45">
            {card.inviterName}邀请你加入群聊{card.memberNames.length > 1 ? `（${card.memberNames.slice(0, 3).join('、')}${card.memberNames.length > 3 ? '等' : ''}）` : ''}
          </span>
        </span>
      </div>
      {card.status === 'pending' ? (
        <div className="flex border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            data-testid="wx-group-card-reject"
            onClick={onReject}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="wx-group-card-accept"
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#07C160] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            接受邀请
          </button>
        </div>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-center text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">
          {rejected ? '已拒绝' : '已加入群聊'}
        </div>
      )}
    </div>
  );
}

/** 聊天系统通知行（截图参考：居中小图标 + 灰字 + 金色尾词，如「xx领取了你的红包」；单聊/群聊共用）。
 *  第七轮反馈新增 gift 图标（蓝金礼物盒）：「XX收下了你的礼物 / 你收下了XX送的礼物」 */
export function WxNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam' | 'gift'; pre: string; accent: string }) {
  return (
    <div className="flex justify-center py-1.5" data-testid="wx-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[13px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(180deg, #F2694C, #E94E38)' }}
          >
            <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[#F9DCA8]" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : icon === 'gift' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #4467B4, #2C4E92)' }}
          >
            <Gift className="h-[10px] w-[10px] text-[#F2D9A6]" strokeWidth={2.4} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #FDF3CE, #FAE7A8)' }}
          >
            <Heart className="h-[10px] w-[10px] text-[#E0A94C]" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0 text-[#D8A244]">{accent}</span>
      </span>
    </div>
  );
}

/**
 * 开红包弹窗（对照真实微信：半透明黑底遮罩透出聊天，居中一张圆角红包封面卡，
 * 金色描边 + 头像/「XX的红包」/祝福语 + 底部亮红大弧上金色呼吸光晕「開」钮，卡片下方金色 X 关闭）；
 * 单聊/群聊共用（群聊里成员发的红包同样先开箱）
 */
export function RpOpenLayer({
  senderName,
  senderAvatar,
  blessing,
  onOpen,
  onClose,
  onRefund,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  onOpen: () => void;
  onClose: () => void;
  /** 退还该红包（仅对方发来的未领取红包传入） */
  onRefund?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包" data-testid="wx-rp-open">
      <style>{
        '@keyframes wxrp-in{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}' +
        '@keyframes wxrp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}' +
        '@keyframes wxrp-glow{0%,100%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 0 rgba(249,208,120,.5)}70%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 18px rgba(249,208,120,0)}}'
      }</style>
      <div className="relative w-full max-w-[330px]" style={{ animation: 'wxrp-in 0.26s ease-out' }}>
        {/* 红包封面卡 */}
        <div
          className="relative h-[420px] overflow-hidden rounded-[20px] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
          style={{ background: 'linear-gradient(170deg, #F8755C 0%, #EF5340 55%, #E84434 100%)' }}
        >
          {/* 封面装饰：卡内光斑 + 浮动金点 + 卡顶金色饰线（红包封面专属设计元素，非毛玻璃氛围层，Task 38 误删后还原） */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-14 -top-16 h-44 w-44 rounded-full bg-white/[0.07]" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 top-1/3 h-52 w-52 rounded-full bg-white/[0.05]" />
          {[
            { left: '16%', top: '20%', s: 6, d: '0s' },
            { left: '80%', top: '28%', s: 5, d: '.6s' },
            { left: '22%', top: '58%', s: 5, d: '1.1s' },
            { left: '78%', top: '62%', s: 6, d: '.3s' },
          ].map((p, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-[#F9D08A]/70"
              style={{ left: p.left, top: p.top, width: p.s, height: p.s, animation: `wxrp-float 3.2s ease-in-out ${p.d} infinite` }}
            />
          ))}
          <span aria-hidden="true" className="absolute inset-x-9 top-0 h-[3px] rounded-b bg-gradient-to-r from-transparent via-[#F0C87E]/75 to-transparent" />

          <div className="relative flex h-full flex-col items-center">
            <div className="h-[21%] shrink-0" aria-hidden="true" />
            <span className="rounded-full border-2 border-[#F0C87E]/85 p-[3px] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
              <WxAvatar src={senderAvatar} alt={senderName} size={46} />
            </span>
            <p className="mt-3.5 text-[18px] font-medium tracking-wide text-[#F9DCA8]" data-testid="wx-rp-open-sender">
              {senderName}的红包
            </p>
            <p className="mt-7 max-w-[86%] text-center text-[24px] font-medium leading-relaxed text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(170,30,25,0.3)]" data-testid="wx-rp-open-blessing">
              {blessing}
            </p>
            <div className="flex-1" aria-hidden="true" />
            {/* 底部亮红大弧 + 開 */}
            <div className="relative h-[150px] w-full shrink-0">
              <span className="absolute left-1/2 top-[46px] h-[240px] w-[480px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF7A5F' }} aria-hidden="true" />
              <button
                type="button"
                data-testid="wx-rp-open-btn"
                onClick={onOpen}
                className="absolute left-1/2 top-[22px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full text-[40px] font-semibold text-[#A8671F] transition-transform active:scale-95"
                style={{
                  fontFamily: 'Georgia, serif',
                  background: 'linear-gradient(180deg, #FCEBC0 0%, #F3CB72 55%, #E0A94C 100%)',
                  animation: 'wxrp-glow 1.9s ease-out infinite',
                }}
                aria-label="开红包"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-full border-[1.5px] border-[#C08A3A]/60" />
                開
              </button>
            </div>
          </div>
        </div>

        {/* 卡片下方：退还 + 金色 X 关闭（退还可把对方发的红包原路退回） */}
        <div className="absolute -bottom-[68px] left-1/2 flex -translate-x-1/2 items-center gap-5">
          {onRefund ? (
            <button
              type="button"
              data-testid="wx-rp-refund"
              onClick={onRefund}
              className="flex h-[50px] items-center rounded-full border-2 border-[#EFC266]/90 bg-black/25 px-6 text-[16px] font-medium text-[#EFC266] active:opacity-70"
            >
              退还
            </button>
          ) : null}
          <button
            type="button"
            aria-label="关闭"
            data-testid="wx-rp-open-close"
            onClick={onClose}
            className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#EFC266]/90 text-[#EFC266] active:opacity-70"
          >
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 红包详情页（红色弧形头 + 头像/名字 + 祝福语 + 金色金额 + 领取详情[谁领取的] + 回复表情） */
function RpDetailPage({
  senderName,
  senderAvatar,
  blessing,
  amount,
  opened,
  statusLabel,
  claimerName,
  claimerAvatar,
  claimedAt,
  onBack,
  onToast,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  amount: number;
  opened: boolean;
  /** 退还/拒收状态文案（未终态时不传） */
  statusLabel?: string;
  claimerName: string;
  claimerAvatar: string | null;
  claimedAt?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-detail">
      <div className="relative shrink-0 bg-[#F25844] pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7 text-[#F6CE93]" strokeWidth={2.2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
        {/* 弧形底（金色描边） */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[30px] w-[140%] -translate-x-1/2 rounded-[50%] bg-white dark:bg-[#111111]"
          style={{ boxShadow: '0 -3px 0 #E9C880' }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[8vh]">
        <div className="flex items-center gap-2.5">
          <WxAvatar src={senderAvatar} alt={senderName} size={36} />
          <span className="text-[20px] font-medium" data-testid="wx-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2.5 text-[15px] text-black/40 dark:text-white/40">{blessing}</p>
        {statusLabel ? (
          <p className="mt-2 text-[13px] text-[#D8A244]" data-testid="wx-rp-detail-status">{statusLabel}</p>
        ) : null}
        <p className="mt-8 font-semibold text-[#D8A244]" data-testid="wx-rp-detail-amount">
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          <span className="ml-1.5 text-[20px]">元</span>
        </p>

        {/* 领取详情（谁领取的） */}
        <div className="mt-9 w-[87%] max-w-[350px]" data-testid="wx-rp-claim">
          <p className="text-[12px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-caption">
            1个红包共{fmtMoney(amount)}元，已领取{opened ? 1 : 0}/1
          </p>
          {opened ? (
            <div className="mt-1.5 flex items-center gap-3 border-t border-black/[0.06] py-3.5 dark:border-white/[0.08]">
              <WxAvatar src={claimerAvatar} alt={claimerName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]" data-testid="wx-rp-claim-name">
                  {claimerName}
                </span>
                <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-time">
                  {fmtFullTime(claimedAt ?? Date.now())}
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-medium text-[#D8A244]" data-testid="wx-rp-claim-amount">
                ¥{fmtMoney(amount)}
              </span>
            </div>
          ) : (
            <p className="mt-7 text-center text-[13px] text-black/30 dark:text-white/30">等待领取…</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToast('表情暂未开放')}
          className="mt-11 flex items-center gap-2 rounded-[10px] bg-black/[0.04] px-7 py-3.5 text-[16px] text-black/50 active:bg-black/[0.08] dark:bg-white/[0.08] dark:text-white/50"
        >
          <Smile className="h-5 w-5" strokeWidth={1.8} />
          回复表情到聊天
        </button>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账进入，对照截图：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 绿色收款按钮 + 退还提示） */
function WxTrReceivePage({
  peerName,
  amount,
  note,
  payTime,
  onBack,
  onAccept,
  onRefund,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  onBack: () => void;
  onAccept: () => void;
  onRefund: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-receive">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-receive-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
        <div className="mt-[9vh] flex flex-col items-center">
          <Clock className="h-[74px] w-[74px] text-[#4D9CF8]" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-7 text-[19px]" data-testid="wx-tr-receive-status">
            {peerName}向你转账，待你收款
          </p>
          <p className="mt-4 font-semibold" data-testid="wx-tr-receive-amount">
            <span className="text-[30px]">¥ </span>
            <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          </p>
        </div>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(payTime)}</span>
          </div>
          {note ? (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-14 pb-9">
        <button
          type="button"
          data-testid="wx-tr-receive-accept"
          onClick={onAccept}
          className="mx-auto block h-12 w-full rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: '#07C160' }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/45 dark:text-white/45">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]" data-testid="wx-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 转账详情页（截图⑥：绿勾大圆 + 已收款 + 金额 + 转账/收款时间 + 账单详情）。
 *  退还态（截图⑦）：黄圈↩ + 「你已退还/对方已退还」+ 金额 + 转账时间/退款时间 */
function TrDetailPage({
  peerName,
  amount,
  note,
  payTime,
  received,
  receivedAt,
  receiverIsMe,
  returned,
  refundedBy,
  refundedAt,
  originTime,
  onBack,
  onToast,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  received: boolean;
  receivedAt?: number;
  /** 收款人是否为「我」（原卡按消息角色判断 + 凭据卡按 receiptOf 判断）：文案区分「你已收款 / XX已收款」 */
  receiverIsMe: boolean;
  /** 退还终态（status==='returned' 时 true）：整页切换为退还详情 */
  returned?: boolean;
  /** 退还人（'me'=我退的→「你已退还」；'peer'=对方退的→「对方已退还」） */
  refundedBy?: 'me' | 'peer';
  /** 退款时间（详情页「退款时间」行） */
  refundedAt?: number;
  /** 原转账时间（退还凭据卡专用；缺省回退 payTime） */
  originTime?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const isReturned = returned === true;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-detail">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pt-[9vh]">
        <span
          className={`flex h-[74px] w-[74px] items-center justify-center rounded-full ${isReturned ? 'bg-[#F6AC3D]' : received ? 'bg-[#07C160]' : 'bg-[#F6AC3D]'}`}
          aria-hidden="true"
        >
          {isReturned ? <Undo2 className="h-11 w-11 text-white" strokeWidth={2.6} /> : <Check className="h-11 w-11 text-white" strokeWidth={3} />}
        </span>
        <p className="mt-7 text-[19px]" data-testid="wx-tr-status">
          {isReturned
            ? refundedBy === 'peer'
              ? '对方已退还'
              : '你已退还'
            : received
              ? receiverIsMe
                ? '你已收款，资金已存入零钱'
                : `${peerName}已收款`
              : '对方确认后到账'}
        </p>
        <p className="mt-4 font-semibold" data-testid="wx-tr-detail-amount">
          <span className="text-[30px]">¥ </span>
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
        </p>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(isReturned ? (originTime ?? payTime) : payTime)}</span>
          </div>
          {isReturned && typeof refundedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">退款时间</span>
              <span className="text-right" data-testid="wx-tr-refund-time">
                {fmtFullTime(refundedAt)}
              </span>
            </div>
          )}
          {!isReturned && received && typeof receivedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">收款时间</span>
              <span className="text-right" data-testid="wx-tr-received-time">
                {fmtFullTime(receivedAt)}
              </span>
            </div>
          )}
          {note && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          )}
        </div>
      </div>
      <button type="button" onClick={() => onToast('账单详情暂未开放')} className="shrink-0 pb-10 pt-4 text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
        账单详情
      </button>
    </div>
  );
}

/** 申请解除拉黑卡片（40-a 双向：from='char' 角色发起（用户点同意/拒绝）；from='user' 用户发起（角色 AI 决策，仅展示状态）；iOS 黑白灰风） */
function WxBlockReqCard({
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
      data-testid={mine ? 'wx-blockreq-card-mine' : 'wx-blockreq-card'}
      className="w-fit max-w-[calc(100%-40px)] rounded-[5px] bg-white px-3 py-2.5 shadow-sm dark:bg-[#1E1E1E]"
      aria-label={`${name}申请解除拉黑`}
    >
      <div className="flex items-center gap-2">
        <WxAvatar src={avatar} alt={name} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium leading-tight text-black dark:text-white">{name}</p>
          <p className="mt-0.5 text-[12px] leading-tight text-black/45 dark:text-white/45">申请解除拉黑</p>
        </div>
      </div>
      {reason && (
        <p className="mt-2 rounded-[4px] bg-black/[0.04] px-2 py-1.5 text-[13px] leading-[1.5] text-black/70 dark:bg-white/[0.08] dark:text-white/70">「{reason}」</p>
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
            data-testid="wx-blockreq-reject"
            aria-label={`拒绝${name}的解除拉黑申请`}
            onClick={onReject}
            className="h-8 flex-1 rounded-[4px] bg-black/[0.05] text-[13px] text-black/70 transition active:opacity-70 dark:bg-white/10 dark:text-white/70"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="wx-blockreq-accept"
            aria-label={`同意${name}的解除拉黑申请`}
            onClick={onAccept}
            className="h-8 flex-1 rounded-[4px] bg-[#07C160] text-[13px] font-medium text-white transition active:opacity-80"
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

/**
 * 一轮 AI 回复的投递上下文（runAiTurn 与「退出网页后继续回复」的拉取投递共用）：
 * aiId/msgIdx 生成回复消息 id 序列；batchStarted 控制首批立即上屏（后续批按打字节奏停顿）；
 * wantCallSeen 记录 [语音通话] 标记是否出现过（finalize/拉取投递收尾时触起来电）；
 * wantVideoCallSeen 记录 [视频通话] 标记是否出现过，与 wantCallSeen 同口径（收尾时触发视频来电） */
interface WxTurnCtx {
  aiId: string;
  msgIdx: number;
  batchStarted: boolean;
  wantCallSeen: boolean;
  /** [视频通话] 标记是否出现过，与 wantCallSeen 同口径（Task 22 视频通话） */
  wantVideoCallSeen: boolean;
  /** 一起听遥控（第三十七轮）：本轮回复里剥出并执行过播控指令（纯指令回复不再落「暂无回复」兑底） */
  musicActed: boolean;
  /** Task 30 AI 引用：[引用:M编号] 标记剥出后暂存的编号——挂到紧随其后的第一条正文消息上；
   *  标记与正文跨流式分段时靠它跨段接力（buildReplyMsgs 各次调用共享同一 ctx） */
  pendingQuote?: string;
  /** Task 30 AI 引用：本轮上下文窗口内的消息编号 → 源消息映射（runAiTurn 构建注入）；
   *  后台接力投递（deliverBgItems）自建 ctx 无映射 → [引用:…] 标记静默丢弃，正文照常 */
  quoteMap?: Map<string, WxMsg>;
}

function ChatPage({
  me,
  peer,
  contacts,
  ownerName,
  otherUnread,
  onBack,
  onOpenFriendDetail,
  onSaveRemark,
  onSaveVoiceId,
  onOpenGroup,
  onContactsChanged,
  onDeleteContact,
  pendingCall,
  onConsumePendingCall,
  onSwitchChat,
}: {
  me: WxUser;
  peer: ContactRecord;
  /** 全部联系人（长按菜单「转发」选择目标会话用） */
  contacts: ContactRecord[];
  ownerName: string | null;
  /** 除当前会话外的未读总数（他人在你聊天时来信 → 返回键旁灰圆数字） */
  otherUnread: number;
  onBack: () => void;
  /** 聊天设置页点信息卡片 → 进入该好友的详情页 */
  onOpenFriendDetail: (c: ContactRecord) => void;
  /** 保存备注（空串 = 清除；宿主持久化 + 刷新联系人展示名） */
  onSaveRemark: (v: string) => void | Promise<void>;
  /** 保存「他的声音」音色（空串 = 恢复默认；宿主持久化到联系人 voiceId + 刷新联系人） */
  onSaveVoiceId: (vid: string) => void | Promise<void>;
  /** 群聊卡片「接受邀请」后进入群聊（宿主刷新群列表并打开群页） */
  onOpenGroup?: (gid: string) => void;
  /** App 根部 toast（在聊天分支不渲染，页内用 useLocalToast 自带 toast） */
  onToast?: (m: string) => void;
  /** 47-b 联系人刷新回调（宿主 reloadContacts）：buildReplyMsgs 的 change-avatar/pick-album-avatar
   *  IIFE 调 updateContact 落库后，调用此回调刷新 MainScreen 的 contacts state，让顶栏/会话列表头像即时更新 */
  onContactsChanged?: () => Promise<unknown>;
  /** 聊天设置「删除联系人」→ 宿主弹二次确认（确认后关聊天 + 删除好友关系）；不传/自己会话不显示 */
  onDeleteContact?: () => void;
  /** Task 28-b 详情页通话桥：联系人详情页「音视频通话」ActionSheet 选语音/视频后，宿主关详情页并打开
   *  本聊天页时下发 { contactId, media }；这里只消费 contactId 对准当前会话的下发（拨号逻辑见下方 effect） */
  pendingCall?: { contactId: string; media: 'voice' | 'video' } | null;
  /** 消费完 pendingCall 通知宿主清空（防同一次下发被重复消费） */
  onConsumePendingCall?: () => void;
  /** Task 37 角色分支：分支创建成功 → 宿主切换进分支聊天页（setChatPeer + toast） */
  onSwitchChat?: (c: ContactRecord) => void;
}) {
  // 聊天页自带 toast（App 根 toast 在聊天分支提前 return 不渲染——收藏成功等提示靠它显示）
  const [chatToast, onToast] = useLocalToast();
  // 退出聊天页/切换会话：停止语音播放与 TTS 朗读并释放播放器（单例，防跨会话串音）
  useEffect(() => () => {
    stopSpeaking();
    stopVoicePlayback();
  }, [peer.id]);
  // Task 40：语音播放失败 → 页内 toast（voice-player 播放出错统一派发事件，本端监听展示；
  // onToast 为 useLocalToast 的稳定引用，effect 只挂载/卸载各一次）
  useEffect(() => {
    const onErr = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (m) onToast(m);
    };
    window.addEventListener(VOICE_PLAY_ERROR_EVENT, onErr);
    return () => window.removeEventListener(VOICE_PLAY_ERROR_EVENT, onErr);
  }, [onToast]);
  const apiConfig = useSettings((s) => s.apiConfig);
  // 第十七轮聊天气泡装扮：订阅全局配置（装扮页修改 → 聊天气泡实时跟随）
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  // 聊天显示设置（聊天信息 › 显示设置，按联系人隔离）：头像形状 / 已读未读回执 / 时间显示（修改 → 实时跟随）
  const chatDisplay = useChatDisplay('wx', peer.id);
  // 液态玻璃主题（气泡样式设置 › 界面主题）：只接管页面铭件（根底色/顶栏胶囊/输入胶囊/输入框），
  // 气泡仍由上方 bubbleStyle 装扮系统管、聊天背景层一行不动；默认主题全部走原类（像素级保持现状）
  const liquid = isLiquidTheme(bubbleStyle, 'wx');
  // 古早主题（第五十四轮）：2012-2014 拟物风——聊天页深灰安卓顶栏 + 灰底 + 拟物输入条；气泡由 bubbleVisual 接管
  const retro = isRetroTheme(bubbleStyle, 'wx');
  // 液态玻璃皮肤（本轮新增）：顶栏名字区显示模式（text/avatarName/dual/dualName；仅液态主题生效）
  const liquidSkinWx = useSettings((s) => s.liquidSkin.wx);
  // 聊天输入框自定义（本轮新增）：输入框占位文字 + 加号面板功能（默认/液态两种主题都生效）
  const chatDecorWx = useSettings((s) => s.chatDecor.wx);
  // 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）：聊天作用域 —— 只作用于当前联系人的
  // 微信聊天页（根节点挂 data-chat-css="wx:联系人ID"，选择器经 scopeCss 自动加前缀，
  // 且前缀比全局多一级属性 → 特异性压制全局 CSS；不会泄漏到聊天页以外/其他联系人）
  const wxCssKey = chatContactKey('wx', peer.id);
  const chatCustomCss = useSettings((s) => s.customCss.chats[wxCssKey]);
  const [msgs, setMsgs] = useState<WxMsg[]>(() => loadMsgs(peer.id));
  // 40-b 跨 App 环境感知：会话打开即预热（其他三个 App 最近原始消息 + 共同群近况），
  // 每轮 AI 回合开头再异步刷新一次；回合内同步读最近一次构建结果（systemFull 拼装是同步的）——
  // 首轮流通常发生在打开会话数秒后，预热必已就绪；空结果时对应块不注入，不阻断发送
  const crossCtxRef = useRef<{ crossAppBlock: string; groupBlock: string }>({ crossAppBlock: '', groupBlock: '' });
  useEffect(() => {
    let alive = true;
    // AI 视角统一真名指代用户（跨 App 块里的「{me}：」行标签/环境行）；展示名只用于 UI 显示
    buildCrossContextBlocks(peer.id, 'wx', me.realName || me.name)
      .then((b) => {
        if (alive) crossCtxRef.current = b;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peer.id, me.name, me.realName]);
  /** 视觉相册缓存（按 peer.id 隔离的 AlbumRecord[]）：会话打开即预热，每轮 AI 回合开头异步刷新；
   *  buildVisionRules 据此注入「视觉自主决策 + 相册清单」system 规则；buildReplyMsgs 据此同步查
   *  pick-album-* 标记的目标图 src（buildReplyMsgs 是同步函数，无法 await getAlbum）。
   *  第三十一轮：改为「peer 相册 + 机主相册」合并视图（listAlbumsForChat）——AI 存图双写后
   *  两边相册都有内容，选图/清单/兕底统一用合并缓存（contactId 区分归属） */
  const albumCacheRef = useRef<AlbumRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listAlbumsForChat(peer.id, me.id)
      .then((list) => {
        if (alive) albumCacheRef.current = list;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peer.id, me.id]);
  // Task 37 角色分支：平行分支认知块预热（分支侧/本体侧互提提示；挂载/切换会话时构建一次，
  // runAiTurn 同步拼装 systemFull 时直接读 ref，与 crossCtxRef 同款模式）
  const branchBlockRef = useRef('');
  useEffect(() => {
    let alive = true;
    void buildBranchPromptBlock(peer.id)
      .then((b) => {
        if (alive) branchBlockRef.current = b;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peer.id]);
  /** 双向拉黑状态（kv 持久化，按联系人隔离；气泡图标/设置开关/AI 感知共用） */
  const [blk, setBlk] = useState<BlockEntry>(() => loadBlock('wx', peer.id));
  // 40-a：用户发起「解除拉黑申请」的展开面板与理由输入（仅被角色拉黑时显示；ChatPage 按 peer.id keyed 重挂载，会话切换自然复位）
  const [userReqOpen, setUserReqOpen] = useState(false);
  const [userReqText, setUserReqText] = useState('');
  // Task 40 草稿箱：输入框惰性初始化为该会话草稿（wx 前缀键自动按账号隔离；ChatPage 按 peer.id keyed
  // 重挂载，切会话自然重读）；发送/清空由 clearChatDraft 显式清除，输入过程 onChange 即时存
  const [input, setInput] = useState(() => getChatDraft('wx', peer.id));
  /** 富文本输入框（contentEditable）：内置表情在框内显示真实表情图，发送时序列化回 [微笑] 代码 */
  const richInputRef = useRef<ChatRichInputHandle | null>(null);
  /** 语音输入模式：输入框替换为「按住 说话」胶囊（左侧圆钮切换） */
  const [voiceMode, setVoiceMode] = useState(false);
  /** 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用） */
  const [ttsSend, setTtsSend] = useState(false);
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `wx:${peer.id}`;
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 加号面板展开（输入框保持在面板上方） */
  const [plusOpen, setPlusOpen] = useState(false);
  /** 一起听选歌弹层（加号面板「一起听」入口；选歌后我方发邀请卡进聊天，AI 接受后双方发同意卡） */
  const [tgPickOpen, setTgPickOpen] = useState(false);
  /** 单聊 @ 提及：键入 @ 唤起联系人浮层，点选后替换该 @ 并插入「@名字 」（与群聊同款交互） */
  const [atOpen, setAtOpen] = useState(false);
  /** 红包/转账发送页 + 位置/文字图片功能页（相机/图片直接调起手机原生能力） */
  const [compose, setCompose] = useState<'redpacket' | 'transfer' | 'location' | 'textcard' | 'gift' | null>(null);
  /** 手动「文字图片」状态（Task 14 卡片版，以「我」的身份发出）：loading / 错误信息（弹层内展示，失败不影响聊天） */
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
  // Task 37 角色分支：待创建分支的分支点消息（长按菜单「分支」打开弹层；preview 用 quoteContentOf 摘要）
  const [branchDlg, setBranchDlg] = useState<null | { msg: WxMsg; preview: string }>(null);
  // Task 40：失败灰字行「隐藏这条提示」的内存态（仅本会话挂载期间生效，重挂载/刷新后恢复显示）
  const [hiddenFail, setHiddenFail] = useState<Record<string, boolean>>({});
  /** Task 40：草稿超长截断提示节流（上次提示时间戳，5 秒内最多提示一次） */
  const draftTruncTipAt = useRef(0);

  /**
   * 手动触发「文字图片」（Task 14 起方向反转）：文字图片是「我」发给 TA 的卡片——
   * 输入留空时让 AI 按人设+最近聊天记录代笔（/api/textcard，用户上游优先、服务端内置模型兑底）；
   * 输入非空 = 用户自己写。成功 → 弹层关闭 + role='me' 的卡片消息上屏（msgs 持久化 effect 落盘）
   * 并触发 AI 回合（卡片文字以「[文字图片]（卡片上写着：…）」进上下文，TA 能读到并回应）；
   * 失败 → 错误留在弹层内（不关弹窗，可重试或取消）。
   */
  const submitTextCard = async (text: string) => {
    // 40-a 拉黑拦截：被角色拉黑（byChar）后不能发送任何消息
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      setCompose(null);
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
          channel: '微信',
          persona: peer.persona ?? '',
          history: buildPhotoDescHistory(msgs, '我', peer.name),
        });
      }
      const cardMsg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'textcard' as const, card: { text: finalText } };
      setCompose(null);
      // 给自己发消息（「我」详情页「发消息」入口）：只记录，不触发 AI 回复
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
        wxQueueAdd(peer.id);
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
  };

  /**
   * 点击「文字图片」卡片 → 用图像生成把卡片文字生成图片（设置 › 图像生成 配置）：
   * 卡片是「我」发的，生图不带角色锁脸（contactId 空，画面描述可在操作面板里改）；
   * 成功 → 卡片消息**原位**变成图片消息（文字图片消失，生成的图显示在原来卡片的位置），
   * 不新增消息、不触发 AI 回合（不是发图给 AI），持久化 effect 自动落盘；
   * 失败 → 只 toast，面板留在原地可重试。
   */
  const generateCardImage = async (m: WxMsg, descInput: string) => {
    const desc = descInput.trim().slice(0, 400); // G1：描述截 400（与 imggen 照片标签描述上限同宽）
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
      // 原位替换：卡片 → 图片（同一条消息位置不变；fromCard 标记让长按菜单出现「重新生成」）
      setMsgs((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, kind: 'image' as const, card: undefined, img: { src: r.src, desc, fromCard: true } } : x)),
      );
      if (m.role === 'peer') {
        // B1 与 flushPhotoJobs 自动生成同口径的挂点：真图入 AI 相册 + 决策日志 + 照片记忆 + 相册缓存
        // 刷新（下一轮 AI 可用 [选图发送] 再把这张图发出来）；我的卡转图是纯视觉转换，不进这些挂点
        void addAlbum(peer.id, r.src, { desc, origin: 'ai' });
        void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'imggen', targetId: '', imgSrc: r.src, reason: desc });
        notePhotoMemory(peer.id, 'wx', desc);
        void listAlbumsForChat(peer.id, me.id)
          .then((list) => {
            albumCacheRef.current = list;
          })
          .catch(() => {});
      }
      setCardActionId(null);
      onToast('图片已生成');
    } catch (e) {
      onToast(e instanceof Error ? e.message : '图片生成失败');
    } finally {
      setCardGenBusy(false);
    }
  };
  /** 线下模式（约会）：加号面板「线下」入口打开的见面页（与 QQ/信息共用） */
  const [offlineOpen, setOfflineOpen] = useState(false);
  /** 原生相机 / 相册隐藏 input：加号面板「相机」「图片」直接调用手机能力（无自建页面） */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  // 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘）
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; amount: number; blessing?: string; note?: string; methodId: string }>(null);
  /** 正在「開」的红包消息 id */
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** 待收款的转账消息 id（收款页：时钟 + 待你收款 + 收款按钮） */
  const [receiveId, setReceiveId] = useState<string | null>(null);
  /** 正在查看详情的红包/转账/亲属卡消息 id */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 大图查看器（urls=本轮可翻页的全部图片、index=当前下标；单图/表情包入口 urls 长度为 1） */
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);
  /** 已展开的照片堆叠（堆叠头消息 id 集合；展开后恢复逐条平铺且不收回，同原生微信） */
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  /** 待发送图片预览（需求2：选图后先入输入框下方预览条，点「发送」才真正上屏） */
  const [pendingImgs, setPendingImgs] = useState<PhotoStackItem[]>([]);
  /** 表情面板展开（与加号面板互斥） */
  const [stickerOpen, setStickerOpen] = useState(false);
  /** 正在查看详情的位置消息 id */
  const [locViewId, setLocViewId] = useState<string | null>(null);
  /** 收礼弹窗正在查看的礼物消息 id（第 20 轮，点礼物卡片唤起） */
  const [giftViewId, setGiftViewId] = useState<string | null>(null);
  /** runAiTurn 的稳定引用：发红包/转账（execRedPacket 等定义在 runAiTurn 之前）也要触发 AI 回复，用 ref 中转 */
  const runAiTurnRef = useRef<((userMsg: WxMsg | null, extra?: WxMsg[], sysEvent?: string, baseMsgs?: WxMsg[]) => void) | null>(null);
  /** 聊天设置页（右上角 ··· 进入）：信息卡片/置顶/免打扰/查找聊天记录/回复条数/聊天背景 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 角色状态卡（点击消息行对方头像弹出：心情/好感度/心声/动作/穿着/位置/时间，实时生成不影响聊天） */
  const [peerStatusOpen, setPeerStatusOpen] = useState(false);
  /** 查找聊天记录页 */
  const [searchOpen, setSearchOpen] = useState(false);
  /** 聊天背景页（设置页「聊天背景」进入的独立二级页） */
  const [bgOpen, setBgOpen] = useState(false);
  /** 回复条数页（设置页「回复条数」进入的独立二级页，按会话隔离） */
  const [replyOpen, setReplyOpen] = useState(false);
  /** 他的声音页（设置页「他的声音」进入）：角色音色选择 + AI 语音频率入口 */
  const [voiceOpen, setVoiceOpen] = useState(false);
  /** AI 语音频率页（他的声音页入口进入，按会话隔离保存） */
  const [voiceFreqOpen, setVoiceFreqOpen] = useState(false);
  /** 我的音色库（「他的声音」入口行摘要展示名用；zustand 响应式） */
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
  // 动作描写开关（渲染订阅版）：设置页切换后经事件即时刷新，历史消息显示同步生效
  const actionDescOn = useActionDescOn(sessionKey);
  // 深度思考开关（渲染订阅版，IndexedDB 按联系人隔离）：关闭时思维链卡片整体丢弃不渲染（思考指令仍注入）
  const deepThinkOn = useDeepThinkOn(peer.id);
  /** 深度思考本轮上下文（runAiTurn 开头重置）：firstMsgId = 本回合第一条 AI 文本消息 id（投递完回填思考用），
   *  text = 流层剥离 + buildReplyMsgs 兜底剥离合并的思考过程 */
  const turnThinkRef = useRef<{ firstMsgId: string | null; text: string }>({ firstMsgId: null, text: '' });
  // 「回车键发送消息」开关（微信 App 级、按账号隔离，单聊+群聊共用；默认开启=回车发送，关闭=回车换行）
  const enterSend = useEnterSend('wx');
  /** 世界书挂载页（设置页「世界书」进入）：为联系人勾选挂载的书籍（见 @/lib/ios/worldbook） */
  const [wbOpen, setWbOpen] = useState(false);
  /** 主动发消息设置页（聊天设置二级页：定时/事件/自主/提醒四类触发） */
  const [proactiveOpen, setProactiveOpen] = useState(false);
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
    wxActiveChatId = peer.id;
    // 主动发消息角标守卫同步登记：用户正看着该会话时主动消息不涨角标（消息实时可见）
    setActiveProactiveChat('wx', peer.id);
    return () => {
      if (wxActiveChatId === peer.id) wxActiveChatId = null;
      setActiveProactiveChat('wx', null);
    };
  }, [peer.id]);
  /** 搜索定位命中的消息 id（短暂高亮） */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 气泡长按菜单（微信/QQ 同款横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: WxMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<WxMsg | null>(null);
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
  /** 美团找人代付详情（点代付卡片打开；好友视角可代付） */
  const [proxyPid, setProxyPid] = useState<string | null>(null);
  /** 淘宝代付卡详情（kind='tbpay' 点卡进入；好友 AI 代付状态实时跟随） */
  const [tbProxyPid, setTbProxyPid] = useState<string | null>(null);
  /** 聊天页根元素（长按菜单定位参照） */
  const pageRef = useRef<HTMLDivElement>(null);
  /** 聊天背景（本会话）：置顶/免打扰/背景在 chat-flags 总线，图片本体在 IndexedDB */
  const flags = useChatFlags(wxChatFlagsStore)[peer.id] ?? NO_FLAGS;
  const bg: ChatSettingsBg = { mode: flags.bgMode ?? 'default', color: flags.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  const openingMsg = openingId ? msgs.find((m) => m.id === openingId) ?? null : null;
  const receiveMsg = receiveId ? msgs.find((m) => m.id === receiveId) ?? null : null;
  const detailMsg = detailId ? msgs.find((m) => m.id === detailId) ?? null : null;
  const locViewMsg = locViewId ? msgs.find((m) => m.id === locViewId) ?? null : null;
  /** 收礼弹窗（第 20 轮）：点礼物卡片唤起，收下状态随消息持久化 */
  const giftViewMsg = giftViewId ? msgs.find((m) => m.id === giftViewId && m.gift) ?? null : null;

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(peer.id, msgs);
  }, [msgs, peer.id]);

  /** 群聊卡片：接受/拒绝（状态随消息持久化；接受后宿主打开群聊）。
   *  groupcard 消息 content 为空、不进多选/长按菜单，无需 patch 其它字段。 */
  const decideGroupCard = useCallback(
    (m: WxMsg, accept: boolean) => {
      if (!m.gcard || m.gcard.status !== 'pending') return;
      const r = applyGroupCardDecision('wx', peer.id, m.id, accept);
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
    (m: WxMsg, accept: boolean) => {
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
      void getChatBgImage('wx', peer.id).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bg.mode, flags.bgV, peer.id]);

  // 滚底签名守卫：仅结构性变化（条数/末条 id/流式内容）才滚底；
  // 转文字等原地更新（msgs 引用变但结构不变）不触发滚动，避免转写面板出现时气泡被拽上移
  // 性能+体验：仅当用户本就停在底部附近（距底 ≤160px）或首次进入时才跟随滚底——
  // 上翻历史阅读时 AI 分段投递不再把视口拽走；滚动放入 rAF，scrollHeight 读取
  // （强制 layout，长会话数千节点）不再随每条分段同步发生，同帧多次触发也合并成一次
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
    const isErrText = (s: string) => s.startsWith('〔') || s.startsWith('（AI') || s.startsWith('（对方暂时');
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
    if (!content.trim() || content.startsWith('〔') || content.startsWith('（AI') || content.startsWith('（对方暂时')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="wx-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-black/45 dark:text-white/45"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑。
   *  同 id 消息用落盘的 rp/tr/fam 覆盖本地（finalize 里 AI 领取/退回/拒收动作已更新卡片状态） */
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
            ...(s.rp ? { rp: s.rp } : {}),
            ...(s.tr ? { tr: s.tr } : {}),
            ...(s.fam ? { fam: s.fam } : {}),
            ...(s.content && !m.content ? { content: s.content } : {}),
          };
        });
        // 按 id 合并：本地新增的保留，落盘新增的只会是 AI 回复
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
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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

  /** X论坛帖子分享卡落库监听：论坛分享/ AI 回应直写 kv 后广播 FORUM_SHARE_CARD_EVENT，
   *  聊天页在场时实时合并落库消息（新卡片立即上屏），不用重开聊天 */
  useEffect(() => {
    const onForumCard = (e: Event) => {
      const d = (e as CustomEvent<{ cid?: string; app?: string }>).detail;
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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
      if (!d || d.cid !== peer.id || d.app !== 'wx') return;
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

  /** AI 自创商品真图生成完成监听（第十四轮）：礼物卡/代买草稿卡的图片渲染时实时解析
   *  最新图覆盖（tbProductImgOverride/tbGiftLiveImg），生图落库后广播事件 → 这里浅拷贝
   *  消息数组触发一次轻量重渲染，打开中的聊天卡片立即从卡通图升级成真图（不改写消息） */
  useEffect(() => {
    const fn = () => setMsgs((prev) => [...prev]);
    window.addEventListener(AI_PRODUCT_IMG_EVENT, fn);
    return () => window.removeEventListener(AI_PRODUCT_IMG_EVENT, fn);
  }, []);

  /** 过期清算后的落盘合并（存储为权威）：既有消息以落盘版本覆盖（卡片过期终态），落盘新增的
   *  过期通知行追加进来；按创建时间排序。与上方投递 tick 同一套合并模式，不丢本地新消息 */
  const mergeExpiredSweep = useCallback(() => {
    setMsgs((prev) => {
      const saved = loadMsgs(peer.id);
      const savedMap = new Map(saved.map((m) => [m.id, m]));
      const ids = new Set(prev.map((m) => m.id));
      return sortMsgsByTime([
        ...prev.map((m) => savedMap.get(m.id) ?? m),
        ...saved.filter((m) => !ids.has(m.id)),
      ]);
    });
  }, [peer.id]);

  // 单聊红包/转账 24h 过期清算（红包/转账卡片所在页面挂载时触发一）：扫全部单聊会话，
  // 命中本会话（有 AI 发出的卡被置为过期终态 + 通知行）就把落盘变更合并进本地 state。
  // ChatPage 按 peer.id keyed 重挂载，切换会话时随新会话再跑一次
  useEffect(() => {
    let alive = true;
    void wxExpireStalePeerCards().then((changed) => {
      if (alive && changed.includes(peer.id)) mergeExpiredSweep();
    });
    return () => {
      alive = false;
    };
  }, [peer.id, mergeExpiredSweep]);

  /** 投递进行中（含排队批次）：标题维持「正在输入中…」，直到最后一条消息发出 */
  const [delivering, setDelivering] = useState(() => isAiDelivering(sessionKey));
  useEffect(() => {
    setDelivering(isAiDelivering(sessionKey));
    return subscribeAiDeliveryActive(() => setDelivering(isAiDelivering(sessionKey)));
  }, [sessionKey]);

  /** 排队补跑：流进行中/连发投递中发来的消息（wxQueuedTurns）在「流收尾且投递队列清空」后自动触发回复。
   *  页面存活时监听流结束广播与投递状态变化；离开后流才收尾的，重进页面时补跑（消息已落盘不丢）。
   *  投递未清空时不能开新回合：上一轮的尾部消息还卡在投递队列里逐条落盘，此刻开新流——
   *  旧回复尾巴进不了新回合上下文（AI 新回复自相矛盾），旧气泡也会倒挂在用户新消息下面。 */
  useEffect(() => {
    const kick = () => {
      const turns = wxQueuedTurns[peer.id];
      if (!turns || turns.length === 0) return;
      if (isChatStreaming(sessionKey)) return; // 本轮流还没收尾：等结束广播再跑
      if (isAiDelivering(sessionKey)) return; // 上一轮连发还在投递：等投递完成事件再跑
      wxQueueDelete(peer.id);
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
        // #21：wxQueueDelete 与本回调之间的 260ms 窗口内可能出现新流/新投递（窗口内新事件会直接
        // runAiTurn 抢流，本回合 beginChatStream 必失败）——到点先复查忙闲，已忙则把系统事件重新
        // 入队（消息本体已落盘不丢，事件随下一轮补跑回合注入），不再静默丢弃；与排队补跑重试口径一致
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          wxQueueAdd(peer.id, sysEvent);
          return;
        }
        runAiTurnRef.current?.(null, [], sysEvent, saved);
      }, 260);
    };
    const unsub = subscribeChatStreamFinalized((sKey) => {
      if (sKey === sessionKey) kick();
    });
    // 投递状态变化（本会话批次开跑/投递完毕）也尝试补跑：finalize 广播到达时最后一批常常才刚入队，
    // 投递完毕的 emitActive 才是「上一轮彻底写完」的可靠触发点（subscribeAiDeliveryActive 是全局广播，
    // kick 自带 wxQueuedTurns 门控，其他会话的事件空跑即返回）
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
          sessionKey: `wx:${peer.id}`,
          app: 'wechat',
          title: peer.name,
          avatar: peer.avatar ?? null,
          body,
          target: { app: 'wechat', contactId: peer.id },
        });
      }
      if (wxActiveChatId !== peer.id) wxUnreads.bump(peer.id, 1);
    },
    [peer],
  );

  /** Task 22 视频通话：记录本次通话媒体（voice/video）——引擎 onEnd 的 ChatCallResult 不携带 media，
   *  宿主在 openVoiceCall 发起时写入，writeCallCard 落卡片时读回（视频卡片显示摄像机图标与视频文案） */
  const lastCallMediaRef = useRef<'voice' | 'video'>('voice');

  /** 通话结束（恰好一次，可能发生在聊天页已退出时）：通话卡片直写持久化 + 在场时同步本地 state。
   *  全局通话层负责渲染通话页与悬浮小窗，宿主只关心把结果落成消息。 */
  const writeCallCard = useCallback(
    (r: ChatCallResult) => {
      // 40-a 拉黑拦截：用户拉黑了该角色（byUser）后，通话结束卡片不再落库（AI 侧产物不进聊天记录）
      if (loadBlock('wx', peer.id).byUser) return;
      const st = callResultToCardState(r);
      const card: WxMsg = {
        id: uid(),
        role: r.direction === 'out' ? 'me' : 'peer',
        content: callCardAiText(st, r.duration, lastCallMediaRef.current),
        time: Date.now(),
        kind: 'call' as const,
        call: { state: st, duration: r.duration, direction: r.direction, media: lastCallMediaRef.current },
      };
      // 通话对话全程落聊天记录（用户要求「全部对话显示在聊天界面，不光打的字」）：
      // 引擎 onEnd 回传全程转写（语音轮次+文字轮次），按普通文字消息逐条落库（时间用轮次真实时间，
      // 我说的在右/AI 说的在左），通话卡片垫在最后作为这通电话的收尾标记；挂断续聊文字经
      // onFollowup 另行落库（引擎转写快照不含续聊，不会重复）；未接通/无对话时只有卡片，行为不变。
      // 消息本身不推通知（只有卡片按原口径通知），历史时间戳保证后续排序稳定
      const turnMsgs: WxMsg[] = (r.transcript ?? []).map((t) => ({
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
        window.setTimeout(() => {
          // 40-a 拉黑拦截：落库前再核一次（等待窗口内用户可能已拉黑）
          if (loadBlock('wx', peer.id).byUser) return;
          const msg: WxMsg = { id: uid(), role: 'peer', content: after, time: Date.now() };
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
      if (loadBlock('wx', peer.id).byUser) return;
      texts.forEach((t, i) => {
        window.setTimeout(
          () => {
            // 40-a 拉黑拦截：落库前再核一次（连发间隔内用户可能已拉黑）
            if (loadBlock('wx', peer.id).byUser) return;
            const msg: WxMsg = { id: uid(), role: 'peer', content: t, time: Date.now() };
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

  /** 发起全局语音/视频通话（加号面板「语音通话/视频通话」/ 通话卡片回拨 / AI 来电共用）：打开瞬间快照最近上下文；
   *  通话页与小窗由 PhoneShell 的全局通话层渲染，退出聊天页/切 App 电话不断。
   *  opts.hiddenView：AI 来电用——响铃期间不显示全屏通话页（view='hidden'），只留全局来电弹窗，
   *  点弹窗非按钮区域才展开全屏来电页；弹窗接听则收成悬浮小窗。
   *  opts.media（Task 22）：通话媒体——video 时 GlobalCallLayer 渲染视频通话页、来电弹窗显示视频接听图标；缺省语音 */
  const openVoiceCall = useCallback(
    (direction: 'out' | 'in', opts?: { hiddenView?: boolean; media?: 'voice' | 'video' }) => {
      // B-1 通话中防御：已有全局通话（通话中/拨号中/AI 来电响铃中）时不发起新通话——
      // startGlobalCall 会直接替换旧 session，旧通话的卡片/记录/续聊/记忆总结全部静默丢失。
      // AI 来电（direction='in'，hiddenView）由触发处先行双查后放行，这里只拦手动拨出
      if (useGlobalCall.getState().session) {
        if (direction === 'out') onToast('已在通话中，请先挂断再拨');
        return;
      }
      // 手动拨出（加号面板「语音通话」/通话卡片回拨）：有来电正在响铃（微信/电话来电弹窗）同样不叠加
      if (direction === 'out' && useIncomingCall.getState().call) {
        onToast('有来电正在响铃，请先处理');
        return;
      }
      const base = msgs;
      const history: ChatCallTurnMsg[] = base
        .filter((m) => !m.recalled && (m.content.trim().length > 0 || m.kind === 'location' || (m.kind === 'image' && m.img?.desc)) && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))
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
                : m.kind === 'image' && m.img?.desc
                  ? `[图片 ID:${m.id}]（图片内容：${m.img.desc}）`
                  : m.content),
        }));
      const memContext = history.map((h) => h.content).join(' ');
      // 世界书注入通话（与文字聊天同一套 collectWbBlocks：全局常驻 + 局部/专属按触发词命中）：
      // 六个位置块 + 使用规则拼成一个块随人设注入（优先级：人设/世界设定 > 记忆）
      // fix3-c #7：世界书锚点——labels 契约已合并（collectWbBlocks 尾参 WbLabels）：锚点块头注标注「文中的『你』指{角色名}」
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
        memChatRecallBlock(peer.id, 'wx', wbScanText([userText, ...history.slice(-4).map((h) => h.content)]), {
          interopOn: effectiveInterop,
          disclosureText: [userText ?? '', ...history.slice(-4).filter((h) => h.role === 'user').map((h) => h.content)].filter(Boolean).join(' '),
          altMainName: cachedOwnerName(),
          altMainRelation: peer.relation?.trim() || '',
        }) || undefined;
      // Task 22 视频通话：记录本次媒体（引擎 onEnd 不回传，挂断落卡片时读回）；缺省语音
      lastCallMediaRef.current = opts?.media ?? 'voice';
      startGlobalCall({
        variant: 'wx',
        name: peer.name,
        avatar: peer.avatar ?? null,
        // Task 27：用户自己的头像——视频通话关摄像头时显示它（不再显示「摄像头已关」占位）
        myAvatar: me.avatar ?? null,
        contact: peer,
        direction,
        // video：全局层渲染视频通话页（主画面角色动态画面 + 用户摄像头小窗 + 识图循环）
        media: opts?.media ?? 'voice',
        initialHistory: history,
        memoryBlock:
          memChatRecallBlock(peer.id, 'wx', memContext, {
            interopOn: effectiveInterop,
            disclosureText: history.filter((h) => h.role === 'user').map((h) => h.content).join(' '),
            altMainName: cachedOwnerName(),
            altMainRelation: peer.relation?.trim() || '',
          }) || undefined,
        memoryBlockFn,
        worldbookBlock,
        momentsBlock: buildMomentsChatBlock({ contactId: peer.id, app: 'wx', userName: me.name, userRealName: me.realName || me.name, peer }) || undefined,
        timeBlock: getTimeAware(sessionKey)
          ? buildTimeAwareBlock({ lastMsgTime: base.length > 0 ? base[base.length - 1].time : null, regionHint: peer.region || null })
          : '',
        // 位置块与文字聊天同一套 buildLocationBlock：通话里 AI 同样知道“用户在哪”；
        // fix3-c #5：补传 peerLabel（契约已合并）——AI 自己发的位置被库标注为
        // 「{角色名}（AI角色本人，就是你自己）发的你自己所在的位置，不是机主的位置」，防主语伪造
        locBlock: buildLocationBlock(base, { userLabel: me.realName || me.name, peerLabel: `「${peer.name}」` }) || undefined,
        multiApp: getMemSettings(peer.id).share,
        onEnd: writeCallCard,
        onFollowup: sendCallFollowup,
      }, opts?.hiddenView ? 'hidden' : 'full');
    },
    [msgs, peer, me.name, me.avatar, sessionKey, writeCallCard, sendCallFollowup, onToast],
  );

  // Task 28-b 详情页通话桥：消费宿主下发的 pendingCall（详情页 ActionSheet 选了语音/视频，
  // 宿主已关详情页并打开本聊天页）——复用 openVoiceCall 全链路（B-1 守卫 / 上下文快照 /
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

  // ---------------- AI 回复投递管线（runAiTurn 与「退出网页后继续回复」的拉取投递共用同一套，见 deliverBgItems） ----------------

  /** 挂载/存活标记：接力拉取是异步的，回调只在聊天页仍挂载时投递（卸载后置 false，避免写进已离开的会话） */
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  /** 单条 AI 消息投递：落盘 + 灵动岛通知 + 语音频率判定/合成 + 未读角标（模块层调用，与页面是否存活无关） */
  const deliverAiMsg = (raw: WxMsg) => {
    // 显示设置 › 已读回执：AI 消息本身未读（我回话时转已读）；
    // AI 回复落地 = TA 读了我说的话——我的全部未读消息转已读（磁盘为权威，UI 由投递订阅同步）
    const m: WxMsg = { ...raw, unread: true };
    const base = loadMsgs(peer.id);
    const cleared = base.some((x) => x.role === 'me' && x.unread)
      ? base.map((x) => (x.role === 'me' && x.unread ? { ...x, unread: false } : x))
      : base;
    // #35：有插入边界时（用户在上一轮投递中插话）插到边界用户消息之前，落库顺序即对话时序
    saveMsgs(peer.id, appendWithBoundary(sessionKey, cleared, m));
    // 语音频率：每条文字消息独立判定（命中 → 通知直接显示[语音]；未命中 → 常规文字预览）
    const voiceTurn =
      (m.kind === undefined || m.kind === 'text') &&
      m.content.trim().length > 0 &&
      // 审计 #20：错误/兑底占位（error 标记或〔〕占位文案）不升级成语音条——占位文本会被 TTS 念出来，
      // 且升级后 voice.localText（=占位原文）会回流进 AI 上下文（与下方历史构建的占位过滤同口径）
      !m.error &&
      !m.content.startsWith('〔') &&
      // B6：TTS 清洗后为空的内容（纯 *动作描写* 行/纯标记行）跳过判定——此前会命中计数并推进/
      // 重置周期，但合成必失败保持文字（动作行「白吃」一个语音名额，节奏漂移）
      cleanTextForTts(m.content).trim().length > 0 &&
      decideAiVoiceMessage(sessionKey);
    const body = voiceTurn
      ? '[语音]'
      : notifyPreviewText({
          kind: m.kind,
          content: m.content,
          voiceText: m.voice?.transcript || m.voice?.localText || null,
          amount: m.rp?.amount ?? m.tr?.amount ?? null,
          blessing: m.rp?.blessing ?? null,
          note: m.tr?.note ?? null,
          mergedFwd: m.fwd?.merged ?? false,
        });
    if (body !== null) {
      pushChatNotification({
        sessionKey: `wx:${peer.id}`,
        app: 'wechat',
        title: peer.name,
        avatar: peer.avatar ?? null,
        body,
        target: { app: 'wechat', contactId: peer.id },
      });
    }
    if (voiceTurn) {
      // 异步合成，失败保持文字自动降级，不影响聊天
      const targetId = m.id;
      void synthesizeAiVoice(m.content, peer.id)
        .then((clip) => {
          if (!clip) {
            undoLastAiVoiceDecision(); // B6：合成失败回滚计数（周期不被 TTS 故障永久后移）
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
          const upgrade = (list: WxMsg[]): WxMsg[] =>
            list.map((x) => (x.id === targetId ? { ...x, content: '', kind: 'voice' as const, voice } : x));
          setMsgs(upgrade);
          saveMsgs(peer.id, upgrade(loadMsgs(peer.id)));
        })
        .catch(() => {});
    }
    // 用户已退出该聊天才计数（在聊天页内实时可见，不重复计）：AI 发了几条消息角标就是几
    if (wxActiveChatId !== peer.id) wxUnreads.bump(peer.id, 1);
  };

  /** 排队投递一批：首批立即上屏（边接收边显示），后续批先按打字节奏停顿（逐条冒出来）；
   *  batchStarted 记在轮次上下文 ctx 里（runAiTurn 每轮新建、接力投递单独建，互不影响） */
  const enqueueBatch = (built: WxMsg[], ctx: WxTurnCtx) => {
    if (built.length === 0) return;
    void scheduleAiDelivery<WxMsg>(
      sessionKey,
      built,
      deliverAiMsg,
      {
        initialDelay: ctx.batchStarted ? typingDelayOf(built[0].content ?? '') : 0,
        delay: (i) => (i + 1 < built.length ? typingDelayOf(built[i + 1].content ?? '') : 0),
      },
    );
    ctx.batchStarted = true;
  };

  // ---- 生图（锁脸）：buildReplyMsgs 从回复文本剥出的 [照片:描述] 标签攒进队列，flush 统一异步生成 ----
  /** 本轮待生成的照片任务（buildReplyMsgs 同步解析时入队；flushPhotoJobs 消费并清空） */
  const photoJobsRef = useRef<PhotoTag[]>([]);
  /** F1 流式分段 carry-over：上一段尾部未闭合的半截照片标签（如「[图片:黄昏的咖」），拼回下一段开头再走管线；回合开始清空、收尾丢弃 */
  const carryTextRef = useRef('');
  // 一起听遥控（第三十七轮）：流式分段尾部未闭合的半截播控指令（如「[快进:」），下一段拼回（照片标签 carry 同款机制）
  const musicHoldRef = useRef('');

  /**
   * 消费照片任务：配置完整时每条先生「正在拍照…」系统行，异步生成成功后落照片消息 + 存相册（origin 'ai'）+
   * 决策日志 + 记忆（30 分钟节流不刷屏）；未配置/生成失败自动降级为「文字图片」卡片（不影响聊天）。
   * 单轮最多 2 张防刷屏。
   */
  const flushPhotoJobs = (ctx: WxTurnCtx) => {
    const jobs = photoJobsRef.current;
    photoJobsRef.current = [];
    if (jobs.length === 0) return;
    // F3 持久化：任务已被本轮消费，快照删除（恢复 effect 只在快照仍存在时补做，不重复生成）
    kvDel(`wx-photo-jobs:${sessionKey}`);
    // D：模型异常连发 >2 个标签时第 3 个起丢弃（单轮最多 2 张防刷屏）——补一行系统提示，
    // 不让多余任务静默消失（对齐信息端口径；未配置/配置完整两个分支都走这里，只提示一次）
    if (jobs.length > 2) {
      enqueueBatch(
        [{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `还有 ${jobs.length - 2} 张图片没有生成出来` } }],
        ctx,
      );
    }
    const cfg = useSettings.getState().imgGenConfig;
    if (!cfg.enabled || !imgGenConfigReady(cfg)) {
      // 未配置生图：降级为「文字图片」卡片（无「正在拍照…」行，卡片即最终形态）
      for (const job of jobs.slice(0, 2)) {
        enqueueBatch([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } }], ctx);
      }
      return;
    }
    for (const job of jobs.slice(0, 2)) {
      enqueueBatch([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `「${peer.name}」正在拍照…` } }], ctx);
      void (async () => {
        try {
          const r = await generateCharacterPhoto({ cfg, contactId: peer.id, desc: job.desc, charName: peer.name, useRef: job.useRef });
          void addAlbum(peer.id, r.src, { desc: job.desc, origin: 'ai' });
          void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'imggen', targetId: '', imgSrc: r.src, reason: job.desc });
          notePhotoMemory(peer.id, 'wx', job.desc);
          enqueueBatch([{ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'image', img: { src: r.src, desc: job.desc } }], ctx);
          // 相册缓存刷新：下一轮 AI 可用 [选图发送] 把这张照片再发出来
          void listAlbumsForChat(peer.id, me.id).then((list) => {
            albumCacheRef.current = list;
          });
        } catch {
          // 生成失败：降级为文字图片卡片（先落一行系统提示说明状态，不阻塞聊天）
          enqueueBatch(
            [
              { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: '照片生成失败，已改为文字图片' } },
              { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'textcard', card: { text: job.desc } },
            ],
            ctx,
          );
        }
      })();
    }
  };

  // F3 遗留任务恢复：会话中途退出/进程被杀时，还没 flush 的照片任务快照留在 kv；挂载（ChatPage 按
  // peer.id 重挂载，切会话即重新挂载）时读回 → JSON 校验 → 清快照 → 用同一套后台管线补做生成
  //（flushPhotoJobs 内部走 enqueueBatch/scheduleAiDelivery 全局队列，页面随后被关也不中断）
  useEffect(() => {
    const kvKey = `wx-photo-jobs:${sessionKey}`;
    const saved: unknown = kvGet<PhotoTag[]>(kvKey);
    kvDel(kvKey);
    if (!Array.isArray(saved)) return;
    const jobs = saved.filter((j): j is PhotoTag => Boolean(j) && typeof (j as PhotoTag).desc === 'string');
    if (jobs.length === 0) return;
    photoJobsRef.current = [...photoJobsRef.current, ...jobs];
    flushPhotoJobs({ aiId: uid(), msgIdx: 0, batchStarted: false, wantCallSeen: false, wantVideoCallSeen: false, musicActed: false });
  }, [peer.id, sessionKey]);

  /** AI 主动发起语音通话（[语音通话] 标记出现在回复任一分段/整条，标记原文已剥除）：按 5 分钟冷却弹出来电浮层
   *  （全局来电弹窗 = 微信大窗 5 秒→胶囊；响铃期间不显示全屏通话页/来电界面（view='hidden'），
   *  点弹窗非按钮区域才展开全屏来电页；QQ 侧同结构但不弹窗）。finalize 与接力拉取投递共用 */
  const triggerAiVoiceCall = () => {
    // 审计 #8：电话 App 通话全屏层进行中（useUI.callActive）不叠加 AI 来电——其他端通话中不被打断
    if (useUI.getState().callActive) return;
    // 40-a 拉黑拦截（审计破口二）：用户拉黑 AI（byUser）后 [语音通话] 不弹真实来电——
    // request-only 模式下正文都被丢弃，来电邀请更不能送达；入口直接 return（wantCallSeen 处另有双保险）
    if (loadBlock('wx', peer.id).byUser) return;
    // C3：用户关闭「AI 主动来电」档位（off）时标记来电也不再真的拨出；距上次任意通道 AI 来电
    // 不足 3 分钟同样让路（防与主动来电/另一标记贴脸连打——两套冷却体系此前互不感知）
    if (isProactiveCallOff()) return;
    if (recentAiCallWithin(peer.id)) return;
    try {
      const lastCallAt = Number(window.localStorage.getItem(`wx-vc-last:${peer.id}`) ?? '0');
      if (Number.isFinite(lastCallAt) && Date.now() - lastCallAt > 5 * 60 * 1000) {
        window.localStorage.setItem(`wx-vc-last:${peer.id}`, String(Date.now()));
        markAiCall(peer.id);
        window.setTimeout(() => {
          // B-1 幂等防御：上一通还没处理完时不再叠加新会话（openVoiceCall 会替换已有全局会话，
          // 旧通话的卡片/记录/续聊/记忆总结全部静默丢失）——来电弹窗还在响或已有全局通话进行中就整跳取消
          if (useIncomingCall.getState().call) return;
          if (useGlobalCall.getState().session) return;
          triggerIncomingCall({
            source: 'wx',
            name: displayNameOf(peer) || peer.name,
            avatar: peer.avatar ?? null,
            contact: peer,
            bannerStage: 'big',
          });
          openVoiceCall('in', { hiddenView: true });
        }, 1200);
      }
    } catch {
      // localStorage 异常忽略
    }
  };

  /** Task 22 AI 主动发起视频通话（[视频通话] 标记出现在回复任一分段/整条，标记原文已剥除）：
   *  与 triggerAiVoiceCall 同构——入口守卫（callActive/拉黑）、5 分钟冷却（独立 localStorage 键
   *  wx-videocall-last，不与语音互挤冷却）、setTimeout 内 B-1 幂等防御双查；
   *  来电快照与全局通话会话都带 media:'video'（弹窗「邀请你视频通话」+视频接听图标，全局层渲染视频通话页）。finalize 与接力拉取投递共用 */
  const triggerAiVideoCall = () => {
    // 审计 #8：电话 App 通话全屏层进行中（useUI.callActive）不叠加 AI 来电——其他端通话中不被打断
    if (useUI.getState().callActive) return;
    // 40-a 拉黑拦截：用户拉黑 AI（byUser）后 [视频通话] 不弹真实来电——request-only 模式下正文都被
    // 丢弃，视频邀请更不能送达；入口直接 return（wantVideoCallSeen 处另有双保险）
    if (loadBlock('wx', peer.id).byUser) return;
    // C3：off 档拦截 + 统一来电守卫互查（同 triggerAiVoiceCall 口径）
    if (isProactiveCallOff()) return;
    if (recentAiCallWithin(peer.id)) return;
    try {
      const lastCallAt = Number(window.localStorage.getItem(`wx-videocall-last:${peer.id}`) ?? '0');
      if (Number.isFinite(lastCallAt) && Date.now() - lastCallAt > 5 * 60 * 1000) {
        window.localStorage.setItem(`wx-videocall-last:${peer.id}`, String(Date.now()));
        markAiCall(peer.id);
        window.setTimeout(() => {
          // B-1 幂等防御：来电弹窗还在响或已有全局通话进行中就整跳取消（openVoiceCall 会替换已有会话，
          // 旧通话的卡片/记录/续聊/记忆总结全部静默丢失）
          if (useIncomingCall.getState().call) return;
          if (useGlobalCall.getState().session) return;
          triggerIncomingCall({
            source: 'wx',
            name: displayNameOf(peer) || peer.name,
            avatar: peer.avatar ?? null,
            contact: peer,
            media: 'video',
            bannerStage: 'big',
          });
          openVoiceCall('in', { hiddenView: true, media: 'video' });
        }, 1200);
      }
    } catch {
      // localStorage 异常忽略
    }
  };

  /**
   * 把一段回复文本解析成待投递消息（流中分段、finalize 最后一段与接力拉取投递共用同一套管线，不重不漏）：
   * 动作标记就地应用（状态流转 + 通知行/凭据卡随正文顺序产出）；asSingle=true（单条模式，
   * 回复条数=1）时文字块只按「&&&」标记切分；false（多条模式）时每段再按「换行/句末标点/
   * 动作描写」稳定细切 —— 一句一条、动作描写独立成条，流中分段/finalize 尾段/接力整段
   * 都不会把多句话挤进同一个气泡。
   * ctx 承载本轮 aiId/msgIdx（回复消息 id 序列）与 wantCallSeen/wantVideoCallSeen（[语音通话]/[视频通话] 标记收集）。
   */
  /** 40-a：把「用户发起的解除拉黑申请卡」置为终态（存储 + 本地 state 同步；无 pending 卡时空操作）。
   *  buildReplyMsgs 内部使用（角色决策/角色主动解除拉黑时调用）——声明须在其之前 */
  const settleUserBlockReq = (status: 'accepted' | 'rejected') => {
    const saved = loadMsgs(peer.id).map((x) =>
      x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
    );
    saveMsgs(peer.id, saved);
    setMsgs((prev) =>
      prev.map((x) =>
        x.blkreq?.from === 'user' && x.blkreq.status === 'pending' ? { ...x, blkreq: { ...x.blkreq, status } } : x,
      ),
    );
  };

  const buildReplyMsgs = (
    rawText: string,
    asSingle: boolean,
    baseTime: number,
    ctx: WxTurnCtx,
  ): { msgs: WxMsg[]; cur: WxMsg[]; dirty: boolean } => {
    // 聊天端音乐遥控（第三十八轮）：剥出回复里的播控指令（[切歌]/[暂停]/[放歌:歌:歌手]…）并真实执行；
    // 私聊全部生效（system 已注入音乐实时情境块，AI 才有指令能力），指令不出现在任何气泡里
    const mrRemote = takeMusicRemote(rawText);
    if (mrRemote.controls.length > 0) {
      void runMusicRemote(mrRemote.controls);
      ctx.musicActed = true; // 本轮执行过播控：正文被剔空时 finalize 不落「暂无回复」兑底
    }
    rawText = mrRemote.text;
    // 深度思考兜底剥离（bg 关页接力等绕过流总线的路径拿到整段原文时，[思考]块就地剥掉防泄漏进气泡；
    // 流式路径正文早已在 chat-stream-store 剥过，这里天然为 no-op）：思考内容累积到本轮上下文，投递完回填
    const tkParts = extractThinkBlocks(rawText);
    if (tkParts.thinking) {
      turnThinkRef.current.text = turnThinkRef.current.text ? `${turnThinkRef.current.text}\n${tkParts.thinking}` : tkParts.thinking;
    }
    rawText = tkParts.text;
    // 表情包清单/开关（本会话独立，投递时现场读取；关闭后 AI 发的表情包卡片丢弃、emoji 硬性剥除）
    const stickers = loadStickers('wx');
    const stickersOn = getStickersOn(sessionKey);
    // 触发标记全/半角括号变体都认（[语音通话]【语音通话】〔语音通话〕（语音通话）(语音通话)）：
    // 只认半角会导致模型输出全角变体时不来电、且标记原文漏进气泡；剥除用同一套兼容正则
    const wantCall = hasVoiceCallMark(rawText);
    // 40-a 拉黑拦截（仅申请卡模式）：byUser 时标记不进 wantCallSeen——finalize/接力拉取不再弹来电
    //（与 triggerAiVoiceCall 入口守卫双保险；剥除标记照常，request-only 下正文反正整段丢弃）
    if (wantCall && !loadBlock('wx', peer.id).byUser) ctx.wantCallSeen = true;
    // Task 22 视频通话：[视频通话] 标记检测（全/半角括号变体都认），与语音通话标记同口径
    const wantVideoCall = hasVideoCallMark(rawText);
    if (wantVideoCall && !loadBlock('wx', peer.id).byUser) ctx.wantVideoCallSeen = true;
    // 两种触发标记都剥干净再进解析管线（先剥视频再剥语音，顺序无所谓；模型输出两种标记时气泡不漏原文）
    const text = wantCall || wantVideoCall ? stripVoiceCallMark(stripVideoCallMark(rawText)) : rawText;
    const latest = loadMsgs(peer.id);
    let cur = latest;
    const out: WxMsg[] = [];
    let t = baseTime;
    // 第十二轮反馈兜底追踪：本轮是否真实执行过代买/送礼标记（兜底块防重复触发用）
    let mtActionDone = false;
    let tbBuyActionDone = false;
    for (const part of extractRichActionParts(text)) {
      if (part.type === 'action') {
        // 40-a 拉黑拦截（审计破口一）：仅申请卡模式（byUser）下回复正文会在下方被整段丢弃，动作标记同样
        // 只放行拉黑类（bk/uk：拉黑/解除拉黑/申请解除拉黑 + 同意/拒绝解除拉黑）——资金（领取红包/收款/
        // 退回/亲属卡）、建群邀请、退群挽留、视觉等标记一律丢弃不执行，否则拉黑期间 AI 仍能真实改卡
        // 状态、写零钱账单、建群。先算好标记类型再按模式分流（bk/uk 下方直接复用）
        const bk = blockActionKindOf(part.action);
        const uk = userReqActionKindOf(part.action);
        if (!bk && !uk && loadBlock('wx', peer.id).byUser) continue;
        // 双向拉黑类动作（[拉黑]/[解除拉黑]/[申请解除拉黑:理由]）：改状态 + 生成系统消息/申请卡片，
        // 不走红包/转账处理；幂等——状态没变化（重复拉黑/没被拉黑就申请等）不产出任何消息
        if (bk) {
          const res = applyCharBlockAction('wx', peer.id, bk, part.action.targetId);
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
        // 40-a：角色对「用户发来的解除拉黑申请」的决策（[同意解除拉黑]/[拒绝解除拉黑]；uk 已在分支入口算好）
        if (uk) {
          const res = resolveUserReqByChar('wx', peer.id, uk === 'approve');
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
        // 退群挽留动作（[拉回群聊]/[设为管理员]/[转让群主]/[放弃邀请]）优先分流给 quit-flow 执行
        //（权限/配额在 quit-flow 内硬校验；返回 false 说明没有活跃流程，继续走卡片动作）
        if (isQuitWinbackAction(part.action)) {
          applyQuitWinbackAction(peer.id, part.action);
          continue;
        }
        // 群社交动作（[建群:群名:成员] 等）：建群 → 卡片消息随本回复落盘（权限/冷却/拒绝表在执行器硬校验）
        if (isGroupSocialAction(part.action)) {
          const card = applyGroupSocialAction(peer, 'wx', part.action.kind, part.action.targetId, part.action.arg);
          if (card) {
            out.push({ id: ctx.msgIdx === 0 ? ctx.aiId : `${ctx.aiId}-${ctx.msgIdx}`, role: 'peer', content: '', time: t, kind: 'groupcard', gcard: card });
            ctx.msgIdx += 1;
            t += 600 + Math.floor(Math.random() * 600);
          }
          continue;
        }
        // Task 30 AI 引用（[引用:M编号]）：编号暂存 ctx，挂到紧随其后的第一条正文消息上
        //（见下方文字分支；标记与正文跨流式分段/切分边界时靠 ctx 跨段接力）
        if (part.action.kind === 'quote') {
          ctx.pendingQuote = part.action.targetId.trim();
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
        // 46-e 视觉自主决策动作（[换头像]/[换朋友圈背景]/[存相册] 取用户当回合发的图；[选图设头像]/
        // [选图设背景]/[选图发送] 从相册缓存挑图）：sys 通知行同步入列（队列投递时按 t 排序），
        // 异步写入（updateContact/setPeerBg/addAlbum + addVisionDecision）fire-and-forget；
        // save-to-album 落盘后刷新 albumCacheRef，下一轮 pick-album-* 才能命中新加入的图。
        const vKind = part.action.kind;
        if (vKind === 'gen-avatar') {
          // 第二十九轮「AI 主动换头像」：[生成新头像:外观描述] → 系统按人设锁脸生成新照片 →
          // 设为 AI 的微信头像 + 头像描述落库（AI 之后记得自己头像长什么样）+ 决策日志；
          // 未配置生图时静默丢弃（教学规则只在配置完整时下发，这里只是保险）
          const genDesc = part.action.targetId.trim().slice(0, 60);
          const genCfg = useSettings.getState().imgGenConfig;
          if (genDesc && genCfg.enabled && imgGenConfigReady(genCfg)) {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」换了一个新头像` } });
            t += 1;
            void (async () => {
              try {
                const r = await generateCharacterPhoto({ cfg: genCfg, contactId: peer.id, desc: genDesc, charName: peer.name, useRef: true });
                await updateContact(peer.id, { avatars: { wx: r.src } });
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'gen-avatar', targetId: '', imgSrc: r.src, reason: genDesc });
                noteAvatarChanged(peer.id, 'wx', r.src, 'peer', genDesc);
                await onContactsChanged?.();
              } catch {
                /* 生图/写入失败不阻塞主流程 */
              }
            })();
          }
          continue;
        }
        if (vKind === 'change-avatar' || vKind === 'change-moments-bg' || vKind === 'save-to-album') {
          // 找图片消息：targetId 非空按 id 找；「第N张」按编号映射（AI 把「第2张」原样写进标记时，
          // 第N张 = 会话内我发的第 N 张图片，与历史序列化「我发的第N张图」同口径，防换错图）；
          // 都没命中兜底取会话里最后一条「我」发的图片消息（当轮有新图=新发的图；没有=上一张发过的图，
          // 正是用户口径「以我新发的图为准；没有新发图片就以我上一次发的图片为准」）
          let imgMsg: WxMsg | null = null;
          if (part.action.targetId) {
            imgMsg = cur.find((m) => m.id === part.action.targetId && m.kind === 'image') ?? null;
            if (!imgMsg) {
              const mSeq = /^(?:第)?(\d{1,3})\s*(?:张|张图|图片|张照片)?$/.exec(part.action.targetId.trim());
              if (mSeq) {
                const n = Math.max(1, parseInt(mSeq[1], 10));
                let k = 0;
                for (const m of cur) {
                  if (!m.recalled && m.role === 'me' && m.kind === 'image' && m.img?.src) {
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
              const m = cur[i];
              if (m.kind === 'image' && m.role === 'me' && m.img?.src) {
                imgMsg = m;
                break;
              }
            }
          }
          if (!imgMsg || !imgMsg.img?.src) continue; // 无图静默丢弃
          const src = imgMsg.img.src;
          const imgDesc = imgMsg.img.desc;
          const imgMsgId = imgMsg.id;
          if (vKind === 'change-avatar') {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」换了头像` } });
            t += 1;
            void (async () => {
              try {
                // 头像按 App 隔离：AI 换头像只写微信槽位（合并语义），不影响 QQ/信息/电话的全局头像
                await updateContact(peer.id, { avatars: { wx: src } });
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'change-avatar', targetId: imgMsgId, imgSrc: src });
                // 第二十九轮：头像描述落库——AI 之后知道自己现在的头像长什么样
                noteAvatarChanged(peer.id, 'wx', src, 'peer', imgDesc);
                // 47-b：刷新 MainScreen 的 contacts state，让顶栏 peer.avatar 与会话列表头像即时更新
                await onContactsChanged?.();
              } catch {
                /* 写入失败不阻塞主流程 */
              }
            })();
          } else if (vKind === 'change-moments-bg') {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」更换了朋友圈封面` } });
            t += 1;
            void (async () => {
              try {
                await setPeerBg('wx', peer.id, src);
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'change-moments-bg', targetId: imgMsgId, imgSrc: src });
              } catch {
                /* 写入失败不阻塞主流程 */
              }
            })();
          } else {
            // save-to-album（第三十一轮双写）：AI 说「存到相册」必须真的在用户的「我的相册」页能看到——
            // 写两份：peer 相册（TA 自己的收藏，供 TA 之后 [选图设头像/发送]）+ 机主相册（用户打开
            // 「我的相册」直接看到，标 origin 'ai' + 备注来源）；决策日志 + 刷新合并缓存供下一轮选图
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」存了一张图到相册` } });
            t += 1;
            void (async () => {
              try {
                const rec = await addAlbum(peer.id, src, { origin: 'ai', desc: imgDesc });
                const ownerRec = me.id && me.id !== peer.id
                  ? await addAlbum(me.id, src, { origin: 'ai', desc: imgDesc, name: `${peer.name}存的` })
                  : null;
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'save-to-album', targetId: imgMsgId, imgSrc: src });
                albumCacheRef.current = [...albumCacheRef.current, rec, ...(ownerRec ? [ownerRec] : [])];
              } catch {
                /* 写入失败不阻塞主流程 */
              }
            })();
          }
          continue;
        }
        if (vKind === 'pick-album-avatar' || vKind === 'pick-album-bg' || vKind === 'pick-album-send') {
          // [选图设头像/背景/发送:相册条目ID]：targetId 应原样抄自【相册清单】。
          // 第三十一轮：①归属校验放宽到「peer 或机主」的相册（合并缓存两边的都能选，用户说
          // 「去相册找一张」时 AI 自己相册可能为空）；②ID 未命中/漏抄时不再静默丢弃——
          // 从缓存里兜底取最新一张（优先 peer 相册、其次机主相册），修复「AI 说换了头像实际没换」
          // （编造 ID / 漏写 ID 都会导致说了没做，有图可选时兜底执行保证言行一致）
          let albumRec =
            albumCacheRef.current.find((a) => a.id === part.action.targetId && (a.contactId === peer.id || a.contactId === me.id)) ?? null;
          if (!albumRec) {
            const minePool = albumCacheRef.current.filter((a) => a.contactId === peer.id);
            const ownerPool = albumCacheRef.current.filter((a) => a.contactId === me.id);
            albumRec = minePool[minePool.length - 1] ?? ownerPool[ownerPool.length - 1] ?? null;
          }
          if (!albumRec) continue; // 两边相册都为空：真无图可选，静默丢弃
          const aSrc = albumRec.src;
          const aDesc = albumRec.desc;
          const aId = albumRec.id;
          if (vKind === 'pick-album-avatar') {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」从相册选了张图换头像` } });
            t += 1;
            void (async () => {
              try {
                // 头像按 App 隔离：AI 从相册选图换头像只写微信槽位（合并语义），不影响 QQ/信息/电话的全局头像
                await updateContact(peer.id, { avatars: { wx: aSrc } });
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'pick-album-avatar', targetId: aId, imgSrc: aSrc });
                // 第二十九轮：头像描述落库（相册图自带 desc 则直接用，无描述异步识图补）
                noteAvatarChanged(peer.id, 'wx', aSrc, 'peer', aDesc);
                // 47-b：刷新 MainScreen 的 contacts state，让顶栏 peer.avatar 与会话列表头像即时更新
                await onContactsChanged?.();
              } catch {
                /* 写入失败不阻塞主流程 */
              }
            })();
          } else if (vKind === 'pick-album-bg') {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」从相册选了张图换朋友圈封面` } });
            t += 1;
            void (async () => {
              try {
                await setPeerBg('wx', peer.id, aSrc);
                void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'pick-album-bg', targetId: aId, imgSrc: aSrc });
              } catch {
                /* 写入失败不阻塞主流程 */
              }
            })();
          } else {
            // pick-album-send：相册图作为 peer 图片消息发到聊天（无 sys 通知行；队列按 t 投递）
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'image', img: { src: aSrc, desc: aDesc } });
            t += 600 + Math.floor(Math.random() * 600);
            void addVisionDecision({ contactId: peer.id, app: 'wx', action: 'pick-album-send', targetId: aId, imgSrc: aSrc });
          }
          continue;
        }
        // 美团外卖/代付联动动作（[代付:pid]/[帮付:订单id]/[帮点外卖:...]/[自己点外卖:...]）：
        // 同步执行（代付立即生效/草稿生成），产出的卡片随本回复队列投递；异步流（自己点外卖）
        // fire-and-forget，卡片经 MT_PROXY_CARD_EVENT 实时合并；角色记忆由执行器直写
        if (isMtEngageActionKind(part.action.kind)) {
          mtActionDone = true;
          const mtRes = applyMtEngageAction(part.action, peer, {
            app: 'wx',
            meName: addressNameOf(me, useSettings.getState().addressMode),
            // B6：最近几条文本用于大额请客/帮付的「对方已明确同意」判定
            recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
          });
          for (const cm of mtRes.msgs) {
            out.push(cm as WxMsg);
            t += 600 + Math.floor(Math.random() * 400);
          }
          if (mtRes.sys) {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: mtRes.sys } });
            t += 1;
          }
          continue;
        }
        // 淘宝购物/代付/取件联动动作（[帮付淘宝:订单id]/[帮你买:商品id]/[自己买:商品id]/[帮取快递:订单id]）：
        // 同步执行（帮付立即生效/草稿卡生成），产出卡片随回复队列投递；异步流（自己买/帮取快递）
        // fire-and-forget，卡片经 TB_PROXY_CARD_EVENT 实时合并；角色记忆由执行器直写
        if (isTbEngageActionKind(part.action.kind)) {
          if (part.action.kind === 'tb-order-draft' || part.action.kind === 'tb-gift-send') tbBuyActionDone = true;
          const tbRes = applyTbEngageAction(part.action, peer, {
            app: 'wx',
            meName: addressNameOf(me, useSettings.getState().addressMode),
            // 大额帮付/代买的「对方已明确同意」判定
            recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
          });
          for (const cm of tbRes.msgs) {
            out.push(cm as WxMsg);
            t += 600 + Math.floor(Math.random() * 400);
          }
          if (tbRes.sys) {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: tbRes.sys } });
            t += 1;
          }
          continue;
        }
        // AI 发朋友圈动作（[发朋友圈:正文]，用户实测「AI 说发了但没发」根除）：
        // addCharMomentPost 真实落库（写角色记忆「你发了一条动态」，后续轮次 AI 自己也知道发过）
        // + emitMomentsChanged 广播动态页实时刷新；sys 通知行随回复队列投递；空正文丢弃
        if (part.action.kind === 'post-moment') {
          const momentText = part.action.targetId.trim().slice(0, 500);
          if (momentText) {
            try {
              const posted = addCharMomentPost('wx', { peer, userName: me.name, content: momentText });
              emitMomentsChanged('wx');
              // C4：聊天路径发动态补齐自动发布同款后续——①好友/NPC 互动队列（此前聊天发的动态
              // 永远没有点赞评论）；②登记自动发帖尝试标记（10 分钟内调度器不再自动发，防同刻双帖）
              try {
                enqueuePostInteractions('wx', posted.id);
                markMomentAutoAttempt('wx', peer.id);
              } catch {
                /* 互动队列失败不影响发帖本身 */
              }
            } catch {
              // 落盘失败静默：AI 正文照常上屏，不阻塞聊天
            }
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」发布了一条朋友圈` } });
            t += 1;
          }
          continue;
        }
        const applied = wxApplyAiActions([part.action], cur, peer, t);
        cur = applied.msgs;
        out.push(...applied.notices, ...applied.extras);
        continue;
      }
      // 40-a：仅申请卡模式（用户拉黑了角色）——AI 的正文/表情一律丢弃，只有上面动作分支产出的
      // 申请卡片与系统行能落盘（入口守卫已保证：能走到这里的 byUser 回合必然处于可申请状态）
      if (loadBlock('wx', peer.id).byUser) continue;
      // #42：下方 segs/stripEmojiText 仅正常模式（byUser=false）执行——byUser continue 上面已拦，
      // 不再在三元里再判 byUser；保留 stickersOn 三元用于表情开关关闭时剥 emoji
      const segs = mergeRichSegments(splitReplySegments(part.text, !asSingle));
      for (const seg of segs) {
        for (const p of parseRichParts(seg, stickersOn ? stickers : [])) {
          const id = ctx.msgIdx === 0 ? ctx.aiId : `${ctx.aiId}-${ctx.msgIdx}`;
          if (p.type === 'rich') {
            // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/亲属卡/位置卡片不受影响）
            if (!stickersOn && p.rich.kind === 'sticker') continue;
            out.push(richToWxMsg(p.rich, id, t, peer));
          } else {
            // 生图（锁脸）：先从文本剥出 [照片:描述] 标签（入队 photoJobsRef，flushPhotoJobs 异步生成），
            // 剥不干净的旧标签（生图关闭时）留在原文里可读性更差，统一剥除
            const { text: photoFreeText, tags: photoTags } = extractPhotoTags(p.text);
            if (photoTags.length > 0) {
              photoJobsRef.current.push(...photoTags);
              // F3 持久化：任务快照落 kv——会话中途退出/进程被杀时，挂载 effect 据此补做生成
              kvSet(`wx-photo-jobs:${sessionKey}`, photoJobsRef.current);
            }
            // F1 兜底：尾部未闭合的半截照片标签剥掉不投递（后台接力整段直入本管线时防「[图片:黄昏的咖」
            // 半截上屏；流式路径上游已用 splitUnfinishedPhotoTag 提前切走尾段，此处通常为空操作）
            // 美团回显剥除：AI 照抄历史里的卡片序列化行（[美团代付/代点…]（…））当正文时整行剥掉
            const safePhotoText2 = stripTbEchoText(stripMtEchoText(stripUnfinishedPhotoTag(photoFreeText)));
            // 表情包开关关闭：文字里的 emoji 与内置表情代码硬性剥除（prompt 禁令之外的双保险），残留的表情占位一并去掉；
            // 首尾清洗：剥掉零宽/盲文空格等「看不见的占位字符」，避免气泡开头出现空隙；
            // 门牌号剥除（Task 30）：模型偶尔裸抄历史行首的 [M数字] 编号进正文，统一剥掉
            const clean = cleanBubbleText(stripMsgHandleText(stickersOn ? safePhotoText2 : stripEmojiCodes('wx', stripEmojiText(safePhotoText2.replace(/\[表情包\]|\[表情\]/g, ' ')))));
            if (!clean) continue;
            // 第三十二轮：AI 模仿历史标注输出 [图片 ID:xxx]（想发那张图）→ 拆分处理：
            // 命中会话里的图片消息 → 转成真实图片消息（真的把那张图发出来）；
            // 未命中/跨会话 ID → 剥除标记（含「（图片内容：…）」说明），绝不把原始标注漏进气泡
            const refSegs = splitImageIdRefs(clean);
            const refBodies = refSegs.filter((s) => s.kind === 'text').map((s) => (s.text || '').trim()).filter(Boolean);
            const refIds = refSegs.filter((s) => s.kind === 'imgref' && s.id).map((s) => s.id!) ;
            const body = refBodies.join(' ').replace(/\s{2,}/g, ' ').trim();
            // Task 30 AI 引用：此前剥出过 [引用:M编号] → 挂到这第一条正文消息上（引用块随气泡展示）；
            // 编号查不到时分两档：①跨回合编号漂移/后台接力无映射（旧容忍）→ 静默丢弃；
            // ②编号越界（用户实测根因：模型把 [M(N)] 当成「给自己新消息编号」在写，N=最后一条+1，
            //   解析层补全成 [引用:M(N)] 后 quoteMap 里根本没有这条）→ 引用意图是真的（它正在回应对方
            //   刚发来的话），回退引用本轮触发回复的那条用户消息，不让引用凭空消失
            let attachQuote: WxMsg['quote'] | null = null;
            if (ctx.pendingQuote) {
              let qSrc = ctx.quoteMap?.get(ctx.pendingQuote) ?? null;
              if (!qSrc) {
                const n = parseInt(ctx.pendingQuote.replace(/\D/g, ''), 10);
                if (Number.isFinite(n) && n > 0 && (!ctx.quoteMap || n > ctx.quoteMap.size)) {
                  // 越界自编号：兜底引用最近一条用户消息（本轮触发源，正是模型想回应的对象）。
                  // 从 quoteMap（与 AI 所见历史同源，含刚发出的这条）倒序找，不受落盘时序影响
                  qSrc = [...(ctx.quoteMap?.values() ?? [])].reverse().find((x) => x.role === 'me' && !x.recalled) ?? null;
                }
              }
              if (qSrc && !qSrc.recalled) {
                attachQuote = { name: qSrc.role === 'me' ? me.name : peer.name, content: quoteContentOf(qSrc), id: qSrc.id, time: qSrc.time };
              }
              ctx.pendingQuote = undefined;
            }
            if (body) {
              out.push({ id, role: 'peer', content: body, time: t, ...(attachQuote ? { quote: attachQuote } : {}) });
            }
            for (const refId of refIds) {
              const refMsg = cur.find((m) => m.id === refId && m.kind === 'image' && !m.recalled) ?? null;
              const rsrc = refMsg ? refMsg.img?.src || (typeof refMsg.content === 'string' && refMsg.content.startsWith('data:image/') ? refMsg.content : '') : '';
              if (!rsrc) continue; // 未命中：引用段已在文本里剥除，静默降级为纯文字
              out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'image', img: { src: rsrc, desc: refMsg?.img?.desc } });
            }
          }
          ctx.msgIdx += 1;
          t += 600 + Math.floor(Math.random() * 600);
        }
      }
    }
    // —— 第十二轮反馈运行时兜底（冷却已删，这里保证「要就送到」）——
    // 机主这轮明确让买/让送，但 AI 只嘴上答应（没输出 [帮你买]/[送礼物] 标记，也没输出任何代付/买票
    // 标记；提示词已禁但仍偶发）→ 按聊天文本匹配淘宝商品，直接合成 [帮你买] 执行——礼物卡照常送进聊天。
    // 反向守卫：AI 明确婉拒/给理由改期时不强买；本轮已执行过代买标记时不重复。
    if (!tbBuyActionDone) {
      const lastMe = [...cur].reverse().find((m) => m.role === 'me' && typeof m.content === 'string' && m.content.trim());
      const ask = lastMe?.content ?? '';
      // 第十三轮：补充自创宝贝相关口吻（直接送我/买好了/给我弄/安排一个…）
      const wantsBuy = /(给我买|帮我买|再买|重新买|重买|换一个|换个|再送|买一个|买个|买份|送我一个|送我个|送我一份|直接送我|买好|送我吧|给我弄|弄一个|整一个|安排一个|买了吧)/.test(ask);
      const refused = /(不给你买|不能买|先不买|先不送|下次再|以后再|等你生日|等你过节|别急|没有合适的|没找到合适的|没找到贴合|换个话题|换个别的|聊点别的|说点别的|换个风格|先看看|让我想想)/.test(text);
      if (wantsBuy && !refused) {
        // 第十三轮：放宽触发——机主明确开口要买/要送（且 AI 没有明确婉拒）就保证送到，
        // 不再依赖 AI 嘴上是否承诺（实测「好的老婆我马上弄」/纯语音回复都可能漏标记）。
        // 同回合管线可能对同一段回复二次构建（文本同 id 会去重，但两次构建的 AI 回复原文可能有差异）：
        // 兜底 key 只用会话+机主原话（两次构建间稳定）→ 90s 幂等守卫 + 确定性卡片 id 防双投递。
        const fbKey = `${peer.id}|${ask.slice(0, 100)}`;
        if (!tbFallbackShouldFire(fbKey)) return { msgs: out, cur, dirty: cur !== latest };
        // 第十三轮：目录选不到贴合宝贝时，从聊天文本提取宝贝名 → AI 自主创建上架再买（[帮你买:*名字] 同链路）
        const pid = tbPickProductForText(`${ask} ${text}`) ?? (() => {
          const custom = tbCustomProductFromText(`${ask} ${text}`);
          return custom ? `*${custom}` : null;
        })();
        if (pid) {
          const tbRes = applyTbEngageAction({ kind: 'tb-order-draft', targetId: pid }, peer, {
            app: 'wx',
            meName: addressNameOf(me, useSettings.getState().addressMode),
            recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
          });
          for (const cm of tbRes.msgs) {
            out.push({ ...(cm as WxMsg), id: tbFallbackCardId(fbKey) });
            t += 600 + Math.floor(Math.random() * 400);
          }
          if (tbRes.sys) {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: tbRes.sys } });
            t += 1;
          }
        }
      }
    }
    // —— 第十三轮反馈美团运行时兜底（冷却已删，说点就点）——
    // 机主明确让点外卖/请客，但 AI 只嘴上答应（没输出 [请客点外卖]/[帮点外卖] 标记；
    // 实测纯语音/口语回复都可能漏标记）→ 从机主原话解析「商家+菜品」，直接合成请客/代点动作执行。
    // 反向守卫：AI 明确婉拒时不强点；本轮已执行过美团标记时不重复；同一把机主原话 90s 幂等。
    if (!mtActionDone) {
      const lastMeMt = [...cur].reverse().find((m) => m.role === 'me' && typeof m.content === 'string' && m.content.trim());
      const askMt = lastMeMt?.content ?? '';
      const wantsOrder = /(请你点|请客|给我点|帮我点|点一份|点外卖|点个外卖|来一份)/.test(askMt);
      const refusedMt = /(不点|先不点|下次再|吃过了|不饿|别点|点不了|没法点)/.test(text);
      if (wantsOrder && !refusedMt && tbFallbackShouldFire(`mt|${peer.id}|${askMt.slice(0, 100)}`)) {
        const parsed = parseMtAskFromText(askMt);
        if (parsed) {
          const mtRes = applyMtEngageAction(
            { kind: parsed.treat ? 'mt-order-treat' : 'mt-order-draft', targetId: `${parsed.merchantId}|${parsed.items.map((i) => `${i.name}x${i.qty}`).join(',')}` },
            peer,
            {
              app: 'wx',
              meName: addressNameOf(me, useSettings.getState().addressMode),
              recentTexts: cur.slice(-8).map((mm) => (typeof mm.content === 'string' ? mm.content : '')),
            },
          );
          for (const cm of mtRes.msgs) {
            out.push(cm as WxMsg);
            t += 600 + Math.floor(Math.random() * 400);
          }
          if (mtRes.sys) {
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: mtRes.sys } });
            t += 1;
          }
        }
      }
    }
    // 深度思考：记录本回合第一条 AI 文本消息 id（??= 只记第一次——流中首个分段的产出即本轮第一条；
    // 卡片/系统行等非文本消息不承载思维链卡片，跳过）
    if (!turnThinkRef.current.firstMsgId) {
      const firstText = out.find((x) => x.role === 'peer' && (!x.kind || x.kind === 'text') && !x.recalled);
      if (firstText) turnThinkRef.current.firstMsgId = firstText.id;
    }
    return { msgs: out, cur, dirty: cur !== latest };
  };

  /** 退出网页后继续回复（服务端接力）：把拉取到的待达消息按与正常回复完全一致的管线投递
   *  （buildReplyMsgs 解析动作标记/&&& 分段/表情包 → enqueueBatch 排队逐条落盘+灵动岛通知+语音频率判定）。
   *  single=true：texts[0] 是一次完整回复原文（generate 模式，与 finalize 单条模式同管线）；
   *  single=false：每项就是一条独立消息文本（deliver 模式，一段一条不再二次切分） */
  const deliverBgItems = (items: BgPendingItem[]) => {
    if (items.length === 0) return;
    const ctx: WxTurnCtx = { aiId: uid(), msgIdx: 0, batchStarted: false, wantCallSeen: false, wantVideoCallSeen: false, musicActed: false };
    // Task 30：接力回复同样带消息编号映射——落盘记录按绝对位置重算（与生成侧同口径），
    // 生成时 AI 看到的 [引用:M编号] 在投递侧能对上同一条消息（中途删消息才可能漂移，罕见可容忍）
    {
      let n = 0;
      const map = new Map<string, WxMsg>();
      for (const m of loadMsgs(peer.id)) {
        if (m.recalled || m.error || m.kind === 'notice' || m.kind === 'blockreq') continue;
        n += 1;
        map.set(`M${n}`, m);
      }
      ctx.quoteMap = map;
    }
    let queuedAny = false;
    // 接力 generate 存的是完整回复原文：按该会话自己的回复条数决定解析模式（与页面内
    // finalize 同语义）——单条(N=1)整条解析，多条(N>1)走稳定细切，不把整段挤成一个气泡
    const bgAsSingle = getReplyCount(sessionKey) <= 1;
    const deliverOne = (rawText: string, asSingle: boolean) => {
      // 与 finalize 同写法：动作标记可能已改状态（cur 变化先落盘），解析出的消息排队投递
      const { msgs: built, cur, dirty } = buildReplyMsgs(rawText, asSingle, Date.now(), ctx);
      if (dirty) saveMsgs(peer.id, cur);
      if (built.length === 0) return; // 纯动作标记等解析不出消息：只落盘状态变化，不造占位消息
      queuedAny = true;
      enqueueBatch(built, ctx);
      flushPhotoJobs(ctx); // 生图（锁脸）：接力回复里的照片标签同样异步生成投递
    };
    for (const item of items) {
      if (item.single) {
        deliverOne(item.texts.join(''), bgAsSingle);
      } else {
        for (const t of item.texts) deliverOne(t, false);
      }
    }
    // 空段保护：整批拉取都没解析出任何消息 → 静默收尾（新版不再落兜底占位文案：失败统一由
    // 红色 ! 徽标承担，接力拉取无对应触发消息可标记，保持静默即可；40-a 仅申请卡模式本就静默）
    // if (!queuedAny && !ctx.musicActed && !loadBlock('wx', peer.id).byUser) {
    //   enqueueBatch([{ id: ctx.aiId, role: 'peer', content: '〔对方暂时没有回复，请稍后再试〕', time: Date.now(), error: true }], ctx);
    // }
    // 回复原文名带 [语音通话] 标记（剥除后不在气泡里）：同样按 5 分钟冷却弹出来电邀请
    if (ctx.wantCallSeen) triggerAiVoiceCall();
    // Task 22 AI 主动视频通话（[视频通话] 标记）：同冷却与守卫口径，弹视频来电邀请
    if (ctx.wantVideoCallSeen) triggerAiVideoCall();
  };
  /** 稳定引用（同 runAiTurnRef 模式）：挂载拉取 effect 经此调用最新闭包的投递函数 */
  const deliverBgRef = useRef<((items: BgPendingItem[]) => void) | null>(null);
  deliverBgRef.current = deliverBgItems;

  /** AI 回合：插入用户消息并把整轮流式请求交给全局 store（文本/表情共用；表情以 [发送了表情：意思] 进入对话历史，AI 据此理解表情）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容。
   *  extra：发红包/转账随消息触发回复时，刚入列还没进 state 的消息。
   *  sysEvent：用户退还 AI 的红包/转账/亲属卡后注入的系统事件说明（只进本轮上下文，不落盘） */
  const runAiTurn = useCallback(
    (userMsg: WxMsg | null, extra?: WxMsg[], sysEvent?: string, baseMsgs?: WxMsg[]) => {
    // 40-a 拉黑拦截（第一层）：用户拉黑角色（byUser）后，本 App 内 AI 不能发任何消息——回合静默取消。
    // 唯一例外=「解除拉黑申请卡片」仍可发起（charRequestOnlyOf 放行模式：回合照常请求，但回复中
    // 除申请卡片/系统行外的正文由 buildReplyMsgs 丢弃）；申请同意后的回应回合因 byUser 已清自然放行。
    const blkEntry = loadBlock('wx', peer.id);
    if (blkEntry.byUser && !charRequestOnlyOf(blkEntry)) return;
    // 40-b：跨 App/群聊近况刷新（fire-and-forget，供下一轮使用；本轮用预热缓存）
    void buildCrossContextBlocks(peer.id, 'wx', me.realName || me.name)
      .then((b) => {
        crossCtxRef.current = b;
      })
      .catch(() => {});
    // 46-e：相册缓存刷新（fire-and-forget）：上一轮 save-to-album 落盘后下一轮才能选图；
    // 本轮用预热缓存（同 crossCtxRef 模式），首轮可能为空数组；
    // 第三十一轮：改用「peer + 机主」合并视图（listAlbumsForChat），AI 存图双写后两边都能选；
    // 懒补缺失的图片描述（每轮最多 2 张）——desc 是【相册清单】与「AI 主动分享相册照片」的依据
    void listAlbumsForChat(peer.id, me.id)
      .then(async (list) => {
        albumCacheRef.current = list;
        const patched = (await ensureAlbumDescs(peer.id, 2).catch(() => 0)) + (await ensureAlbumDescs(me.id, 2).catch(() => 0));
        if (patched > 0) {
          const fresh = await listAlbumsForChat(peer.id, me.id).catch(() => null);
          if (fresh) albumCacheRef.current = fresh;
        }
      })
      .catch(() => {});
    // 第二十九轮「头像感知」：AI 头像描述懒补（换过头像但识图还没成功时补一次；fire-and-forget）
    const peerAvatarSrc = avatarFor(peer, 'wx');
    if (peerAvatarSrc) ensureAvatarDesc(peer.id, 'wx', peerAvatarSrc, 'peer');
    // 40-a：本轮是否处于「仅申请卡」放行模式（byUser 命中且守卫放行）——finalize 不落兑底占位
    const requestOnly = blkEntry.byUser === true;
    // base 按 id 去重（保留后出现者）：extra/userMsg 里的消息通常已先一步进了 msgs state，
    // 不去重会把同一条消息算两遍——多图识图时重复 id 污染 turnImageMsgIds 映射，描述回写错位（#25）
    // #35 上下文补投递尾巴（群聊 #22 已修，单聊同款）：上一轮的回复还在打字节奏投递队列里（未落盘）时，
    // 只读 msgs state 会漏看——AI 看不到自己刚说的话，把旧话题再答一遍（自言自语/像没读到用户最新消息）。
    // 队列尾巴按序拼进 base（时序上属于上一轮，排在最新用户消息之前）；同一消息要么已落盘/进 state、
    // 要么还在队列里（deliveredIndex 逐条同步推进），不会重复。
    const pendingTail = peekPendingMsgs<WxMsg>(sessionKey);
    const baseRaw = [...(baseMsgs ?? msgs), ...pendingTail, ...(userMsg ? [userMsg] : []), ...(extra ?? [])];
    const baseSeen = new Set<string>();
    const base = baseRaw
      .reverse()
      .filter((m) => (baseSeen.has(m.id) ? false : (baseSeen.add(m.id), true)))
      .reverse()
      // #35 时序兜底：历史数据/合并竞态可能把上一轮未投递完的回复排在用户新消息之后（旧气泡倒挂），
      // 按创建时间稳定排序还原对话时序（正常数据 time 单调，排序为空操作），保证上下文顺序正确
      .sort((a, b) => a.time - b.time);
    // 情侣空间×情书（第五十八轮）：我在聊天里让 TA 写情书/写信 → TA 稍后真的提笔写一封寄到本会话
    //（只对恋人绑定的联系人生效；TA 先在聊天里自然应声，几秒后信封卡片寄到；90 秒冷却防重复）
    {
      const lastMine = [...base].reverse().find((m) => m.role === 'me' && typeof m.content === 'string' && m.content.trim());
      if (lastMine && coupleLetterAskHit(String(lastMine.content))) aiWriteLetterOnRequest(peer.id, 'wx');
    }
    // fix3-c #1/#2：AI 历史序列化用的机主称呼与角色名（meAddrName 声明自下方上移至此，供凭据卡句式与卡片终态执行者后缀使用）
    const meAddrName = addressNameOf(me, useSettings.getState().addressMode);
    const actorNames: WxCardActorNames = { me: meAddrName, peer: peer.name };
    // fix3-c #1：收款/退还凭据卡（content='' 的转账凭据消息，tr 带 receiptOf/refundedBy）→ 显式主语句式。
    // 字段取值域（rg 实测）：receiptOf=原转账发送方（'me'=机主/'peer'=AI）；refundedBy=退回方（同值域）；
    // 接收方按卡片 role（'me'=机主/'peer'=AI）。退还凭据不带 receiptOf，原发送方=退回方的对方（只能退自己收到的款）；
    // 字段全缺失时回退保守文案，不编造资金方向
    const credentialTransferText = (m: WxMsg): string => {
      const tr = m.tr;
      if (!tr) return '[转账凭据：一笔转账]';
      const nameOf = (side: 'me' | 'peer'): string => (side === 'me' ? meAddrName : peer.name);
      const note = tr.note ? ` "${tr.note}"` : '';
      if (tr.receiptOf) {
        // 收款凭据：{原发送方}转给{接收方} ¥金额「note」，已收款
        return `[转账凭据：${nameOf(tr.receiptOf)}转给${nameOf(m.role)} ¥${tr.amount}${note}，已收款]`;
      }
      if (tr.refundedBy) {
        // 退还凭据：{原发送方}转的 ¥金额「note」已由{退回方}退回
        return `[转账凭据：${nameOf(tr.refundedBy === 'me' ? 'peer' : 'me')}转的 ¥${tr.amount}${note}已由${nameOf(tr.refundedBy)}退回]`;
      }
      return `[转账凭据：一笔转账已${tr.status === 'returned' ? '退回' : '收款'}]`;
    };
    // 图片编号（用户要求：发多张图让 AI 换头像时可以说「第几张图片」，也能按样子/内容指定）：
    // 用户（me）发的图片消息在会话内按时间先后编号（第1张=最早发的），编号随历史序列化进上下文，
    // AI 说「第N张」时直接对照编号取图片消息 ID；在 slice(-20) 之前的完整 base 上计数，
    // 保证编号与会话全量一致（不随上下文窗口滑动漂移）；撤回的图片不计数（用户感知里它已不存在）。
    const userImgSeq = new Map<string, number>();
    {
      let seq = 0;
      for (const m of base) {
        if (!m.recalled && m.role === 'me' && m.kind === 'image' && m.img) userImgSeq.set(m.id, ++seq);
      }
    }
    // Task 30 AI 引用编号：会话内每条消息的绝对位置编号（M1..Mn；撤回/错误/通知行/申请卡不占号）——
    // 历史行前缀 [M数字] 与 [引用:编号] 反查共用同一映射；绝对位置跨回合稳定（对话增长不漂移，
    // 后台接力投递按落盘记录重算也能对上同一编号）
    const quoteMap = new Map<string, WxMsg>();
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
    const history = base
      .filter(
        (m) =>
          // 图片以 [图片] 占位、语音以转写文本/占位、位置以完整位置文本进入历史（本轮图片实际内容由识图模型描述追加在末尾）；
          // 拍一拍系统行（Task 30）也进历史：AI 要知道被拍/拍过谁与文案（按双方名字序列化，无主语歧义）
          (!m.recalled && ((m.content || m.kind === 'sticker' || m.kind === 'image' || m.kind === 'textcard' || m.kind === 'voice' || m.kind === 'call' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'groupcard' || m.kind === 'relcard' || m.kind === 'pactcard' || m.kind === 'examcard' || m.kind === 'lettercard' || m.kind === 'giftcard' || m.kind === 'location' || m.kind === 'song' || (m.kind === 'sys' && !!m.sys?.pat)) && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))) as boolean
      )
      .slice(-20)
      .map((m) => {
        // 引用/转发让 AI 感知来源：引用 → 前缀说明引用的是谁说的什么；转发卡片 → 前缀说明来自哪个会话；
        // 合并转发的「聊天记录」卡片 → 完整注入逐条对话（说话人：内容），被分享的 AI 知道转发了什么；
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
              ? `[合并转发的聊天记录「${m.fwd.title ?? '聊天记录'}」] `
              : `[转发自「${m.fwd.from}」的消息] `
            : ''
        }`;
        return {
        role: m.role === 'me' ? ('user' as const) : ('assistant' as const),
        // 行首 [M数字] = 消息编号（AI 用 [引用:编号] 引用它）；我的表情以 [发送了表情：意思] 进入历史（AI 理解含义）；
        // AI 自己发的表情回写成 [表情包:ID] 示范正确输出格式（意思靠 system 清单反查），避免它模仿我的记录格式导致发表情变文字
        // 深度思考：AI 自己的历史回复带思考过程时还原 [思考]…[/思考] 前缀——模型看到自己一直按此格式输出
        //（in-context 自我一致），新回复的思考块遵循度大幅提升；标签展示前已被流层剥离，不进任何气泡
        content:
          (m.role === 'peer' && m.thinking ? `[思考]${m.thinking}[/思考]\n` : '') +
          (quoteIdOf.has(m.id) ? `[${quoteIdOf.get(m.id)}] ` : '') +
          pre +
          (m.kind === 'forward' && m.fwd?.merged
            ? `[聊天记录：${(m.fwd.records ?? []).slice(-8).map((r) => `${r.name}：${r.text}`).join(' ／ ')}]`
            : m.kind === 'image'
            ? // 图片消息：全部带消息 ID 进上下文（视觉自主决策规则要求 AI 原样抄写图片消息 ID 来
              // [换头像:ID]/[换背景:ID]/[存入相册:ID]——此前无描述的图片不带 ID，AI 只能编造或换错图）。
              // 我发的图带会话内编号（用户说「第N张」时对照编号）；有识图描述附内容，无描述标「未识图」
              //（防编造规则由 system 注入：无描述的图不许编内容）
              m.role === 'me' && userImgSeq.has(m.id)
              ? `[图片 ID:${m.id}]（我发的第${userImgSeq.get(m.id)}张图${m.img?.desc ? `；图片内容：${m.img.desc}）` : '；未识图，暂无内容描述）'}`
              : m.img?.desc
                ? `[图片 ID:${m.id}]（图片内容：${m.img.desc}）`
                : `[图片 ID:${m.id}]（未识图，暂无内容描述）`
            : m.kind === 'song' && m.song
            ? // 歌曲卡片（Task 68）：AI 发的回写成示范格式（自己知道发过什么歌）；我发的用占位描述
              m.role === 'me'
              ? `[歌曲卡片]《${m.song.name}》${m.song.artist}`
              : m.song.autoPlay
                ? `[放歌:${m.song.name}:${m.song.artist}]`
                : `[分享歌曲:${m.song.name}:${m.song.artist}]`
            : m.kind === 'textcard' && m.card
            ? // 文字图片卡片：AI 知道发过什么卡片（历史可回看，避免接不上话题）
              `[文字图片]（卡片上写着：${m.card.text}）`
            : m.kind === 'voice'
            ? // 语音消息：AI 直接读转写文本（自然对话）；未识别时读本地原文（AI 语音/文字转语音），再退回占位
              // 审计 #20：错误占位升级来的语音条（历史遗留数据）localText 是错误文案——改读占位标记不进上下文
              m.error
              ? '[语音]'
              : m.voice?.transcript || m.voice?.localText || '[语音]'
            : m.kind === 'location'
            ? // 位置消息：AI 读到完整位置文本（名称/地址/经纬度/发送时间），问“我在哪”能直接答出地点名
              locationAiText(m.loc, m.time)
            : m.kind === 'sticker' && m.stk
            ? m.role === 'me'
              ? `[发送了表情：${m.stk.meaning || '无描述'}]`
              : m.stk.sid
                ? `[表情包:${m.stk.sid}]`
                : // fix3-c #3：AI 自己发的无 sid 表情带显式主语（assistant 消息里「你」=AI 本身），不再与「对方（用户）消息」的规则文案冲突
                  `[你发送了表情：${m.stk.meaning || '无描述'}]`
            : m.kind === 'redpacket' && m.rp
              ? // 第八轮反馈：序列化带显式方向（名字，不用代词）——此前「待领取」分不清谁发的，
                // AI 会把机主发的红包说成自己发的/自己领的（用户实测复读「你给我发的红包我领啦」主语混乱）
                `[红包 ID:${m.rp.cid ?? m.id} ¥${m.rp.amount} "${m.rp.blessing}"（${m.role === 'me' ? `${meAddrName}发给${peer.name}` : `${peer.name}发给${meAddrName}`}），${wxCardStateLabel(m, actorNames)}]`
              : m.kind === 'transfer' && m.tr && !m.content && (m.tr.receiptOf || m.tr.refundedBy)
              ? // fix3-c #1：凭据卡不能按普通转账卡序列化——role=assistant 会让 AI 把「对方收了我的款」
                // 读成「我转账已到账」、把「我退了对方的款」读成「我发的款被退回」（资金方向伪造），改显式主语句式
                credentialTransferText(m)
              : m.kind === 'transfer' && m.tr
                ? `[转账 ID:${m.tr.cid ?? m.id} ¥${m.tr.amount}${m.tr.note ? ` "${m.tr.note}"` : ''}（${m.role === 'me' ? `${meAddrName}转给${peer.name}` : `${peer.name}转给${meAddrName}`}），${wxCardStateLabel(m, actorNames)}]`
                : m.kind === 'family' && m.fam
                  ? `[亲属卡 ID:${m.fam.cid ?? m.id} 每月额度¥${m.fam.monthlyLimit}（${m.role === 'me' ? `${meAddrName}送给${peer.name}` : `${peer.name}送给${meAddrName}`}），${wxCardStateLabel(m, actorNames)}]`
                  : m.kind === 'groupcard' && m.gcard
                    ? `[群聊邀请卡片：${m.gcard.name}（${m.gcard.inviterName || '群友'}邀请${m.gcard.memberNames?.length ? `，成员：${m.gcard.memberNames.join('、')}` : ''}），${m.gcard.status === 'pending' ? '待处理' : m.gcard.status === 'accepted' ? '已接受' : '已拒绝'}]`
                    : m.kind === 'mtpay' && m.mtpay
                      ? // 美团代付卡：AI 读到结构化信息（pid/商家/金额/状态），待付请求可凭 id 用 [代付:pid] 处理
                        mtProxyHistoryLine(m.mtpay.pid, m.mtpay.role, m.role === 'me' ? meAddrName : peer.name)
                      : m.kind === 'mtshare' && m.mtshare
                        ? mtOrderShareHistoryLine(m.mtshare.sid)
                        : m.kind === 'mtdraft' && m.mtdraft
                          ? mtDraftHistoryLine(m.mtdraft.did, peer.name)
                          : m.kind === 'tbpay' && m.tbpay
                            ? // 淘宝代付卡：AI 读到结构化信息（请求人/店铺/金额/状态），待付请求凭 pid 决策；
                              // direction 'me' 请求卡（AI 请机主代付）用专属句式，防主语伪造
                              m.tbpay.role === 'req' && m.role === 'peer'
                                ? tbProxyMeHistoryLine(m.tbpay.pid)
                                : tbProxyHistoryLine(m.tbpay.pid, m.tbpay.role, m.role === 'me' ? meAddrName : peer.name)
                            : m.kind === 'tbshare' && m.tbshare
                              ? tbShareHistoryLine(m.tbshare.sid)
                              : m.kind === 'forumshare' && m.forumshare
                                ? forumShareHistoryLine(m.forumshare.pid, peer.id)
                                : m.kind === 'tbdraft' && m.tbdraft
                                ? tbDraftHistoryLine(m.tbdraft.did)
                                : m.kind === 'relcard' && m.relcard
                                  ? `[亲密关系卡片：${m.relcard.stage === 'invite' ? `${m.relcard.fromName}邀请${m.relcard.toName}建立情侣关系` : `${m.relcard.fromName}已同意，双方成功建立情侣关系`}，${m.relcard.status === 'pending' ? '待处理' : m.relcard.status === 'accepted' ? '已接受' : '已拒绝'}]`
                                // 礼物卡片（第七轮反馈重写主语，修「AI 把机主送的礼物说成自己送的」）：
                                // me 消息进 user 角色（「我」=机主、「你」=AI）→ 用机主称呼名做主语：「XX送你「…」」=
                                // 机主把礼物送给 AI；peer 消息进 assistant 角色（「你」=AI 自己）→ 「你送出…」。
                                // 两侧都带礼物 ID（待处理清单同源），AI 凭 [收下礼物卡:ID] 收下机主送的礼物
                                : m.kind === 'giftcard' && m.gift
                                  ? m.role === 'me'
                                    ? `[礼物卡片 ID:${m.gift.id}]（${meAddrName}送你「${m.gift.name}」${m.gift.countLabel}，${m.gift.accepted ? '你已收下' : '待你收下'}）`
                                    : `[礼物卡片 ID:${m.gift.id}]（你送出「${m.gift.name}」${m.gift.countLabel}，${m.gift.accepted ? `${meAddrName}已收下` : `待${meAddrName}收下`}）`
                                // 拍一拍系统行（Task 30）：按双方名字显式序列化（文案后缀原样拼接），AI 无主语歧义——
                                // 「凡凡拍了拍小柚的小脑袋」= 对方拍了你；「小柚拍了拍凡凡的小脸蛋」= 你（AI）拍过对方
                                : m.kind === 'sys' && m.sys?.pat
                                  ? wxPatHistoryLine(m.sys.pat, meAddrName, peer.name)
                                  : m.content),
        };
      });

    // 本轮投递上下文（投递管线与接力拉取共用，见组件层 deliverAiMsg/enqueueBatch/buildReplyMsgs）
    const ctx: WxTurnCtx = { aiId: uid(), msgIdx: 0, batchStarted: false, wantCallSeen: false, wantVideoCallSeen: false, musicActed: false, quoteMap };
    carryTextRef.current = ''; // F1 回合开始清 carry：跨段残留只可能属于上一回合，不复用
    musicHoldRef.current = ''; // 一起听遥控：同款回合开始清留存（半截播控指令不串回合）
    // 用户消息立即入列（保存 effect 随即落盘）；AI 回复在全局 store 流式接收，
    // 结束/失败后由 finalize 写入本角色的聊天记录（与页面是否存活无关）。
    // userMsg 为 null = 分句发送批次触发（消息早已入列，只发起 AI 回复）；
    // 组合发送（文字+图片一起发）时 userMsg 已随图片一并上屏——按 id 判重，不重复入列
    if (userMsg) setMsgs((prev) => (prev.some((m) => m.id === userMsg.id) ? prev : [...prev, userMsg]));
    // 深度思考：重置本轮上下文（重试/新回合互不串台；firstMsgId 由 buildReplyMsgs 首次产出时记录）
    turnThinkRef.current = { firstMsgId: null, text: '' };

    // 回复条数（本会话独立设置，发送时现场读取）：>1 时在人设后追加多条消息指令；
    // 特殊消息规则（红包/转账/亲属卡/位置/表情包标记 + 表情包 ID 清单）随表情包清单一起注入；
    // 我发给 AI 的待处理红包/转账/亲属卡 → 注入处理动作规则与待处理清单（AI 用 [领取红包:ID:…] 等标记处理）
    const replyCount = getReplyCount(sessionKey);
    const stickers = loadStickers('wx');
    // 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji）
    const stickersOn = getStickersOn(sessionKey);
    // 动作描写开关（发送时现场读取）：开启注入格式约定、关闭注入显式禁令（见 @/lib/action-desc）
    const actionDescOn = getActionDescOn(sessionKey);
    // B8 作用域竞态修复：buildNpcPromptExtra→bondNotesFor 读碎片依赖模块级账号作用域，
    // 而作用域此前在下方 memChatRecallBlock 才设定——人设组装提前显式落位（否则首轮发送
    // NPC 近况可能沿用上一次聊天的作用域读错账号的记忆库）
    setMemScopeForApp('wx');
    const system = buildPersonaPrompt(peer, me, ownerName, stickers, stickersOn, actionDescOn, buildNpcPromptExtra(peer, contacts), getAiVoiceFreq(sessionKey) !== 'off');
    // 40-a 拉黑拦截（仅申请卡模式）：待处理卡清单不注入（buildActionRules 空清单返回空数组）——
    // 否则 AI 照提示词输出 [领取红包:ID]/[收款转账:ID] 等标记；动作分支虽已拦截，提示词层面也不该给。
    // 拉黑类动作说明由 blkBlock（buildBlockPromptBlock）单独注入，与此处无关
    const actionRules = requestOnly ? [] : buildActionRules(wxCollectPendingCards(base));
    // 退群挽留背景（需求二）：该联系人所在的某个群存在活跃的退群流程时，注入退群事件、群内近况与
    // 拉回群/给权限标记说明（AI 按人设决定是否提起、是否拉回；每次退群最多一次，拒绝后不再提）
    const quitCtx = activeQuitFlowFor(peer.id);
    // 名字/昵称区分：AI 侧统一用称呼名（默认真名「凡凡」）指代用户；展示层（朋友圈等）仍用显示名
    //（meAddrName 声明已上移至历史构建前，供凭据卡句式/终态执行者后缀共用，fix3-c #1/#2）
    // 被踢感知（需求一）：TA 被移出过群聊（未回群/刚回群）→ 私聊里记得并按人设自然提起
    const kickSection = buildKickNoticeSection(peer.id, meAddrName);
    // 建群能力（需求二/四）：关系到位、话题合适时可主动建群（冷却/拒绝表硬校验，提示词同步约束）
    const socialRules = buildGroupSocialRules(peer, 'wx', contacts, meAddrName);
    // 记忆库：召回该联系人（互通开关限定范围）的记忆注入 system，让 AI 带着记忆回复；
    // 相关性上下文用本轮触发消息（用户消息/系统事件）+ 最近几条，没记忆时返回空串不注入
    // 扫描文本口径：语音取转写、位置取完整位置文本（名称/地址/经纬度/时间）、图片取识图描述，
    // 无文本内容的卡片也能参与记忆召回（位置消息也能参与记忆召回）
    const scanTextOf = (m: WxMsg): string =>
      m.kind === 'voice'
        ? m.voice?.transcript || ''
        : m.kind === 'location'
          ? locationAiText(m.loc, m.time)
          : m.kind === 'image'
            ? m.img?.desc || ''
            : m.kind === 'textcard'
              ? m.card?.text || ''
              : m.content;
    const memContext = [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ');
    // 记忆召回（私聊）：跨 App 互通开关照旧；群聊来源记忆按群级互通开关判断可见性
    //（effectiveInterop 只跟群开关；用户和角色 A 的私聊记忆默认不对角色 B 开放——
    //  存储键即隔离边界，这里只影响该角色自己的召回范围）
    const memoryBlock = memChatRecallBlock(peer.id, 'wx', memContext, {
      interopOn: effectiveInterop,
      // 小号披露门控（用户最新规则）：仅用户侧发言参与检测——默认纯陌生人，亮明身份才解锁大号记忆
      disclosureText: [userMsg?.content ?? '', ...base.slice(-8).filter((m) => m.role === 'me').map(scanTextOf)].filter(Boolean).join(' '),
      altMainName: cachedOwnerName(),
      altMainRelation: peer.relation?.trim() || '',
      // v42【帖子记忆·金鱼】：开关关时 forum 来源碎片零召回——过往帖子/评论绝不提起
      excludeFragmentSources: isPostMemoryOn() ? undefined : ['forum'],
    });
    // 朋友圈动态感知（四）：把「最近的动态 + 相关互动」注入 system（互通开关关闭时只看朋友圈平台的动态），
    // AI 能像真人一样自然提起；用户广播动态首次被看到时懒写入该角色记忆（动态 → 记忆双向打通）
    // userName=展示名（动态存储检索口径）；userRealName=真名（标签/归属说明用真名称呼用户）
    const momentsBlock = buildMomentsChatBlock({ contactId: peer.id, app: 'wx', userName: me.name, userRealName: me.realName || me.name, peer });
    // v33【AI 真人社交】：X论坛近况感知（TA 发的帖/我发的帖/评论互动）——AI 私聊时能自然提起论坛的事
    // v44【AI 关注者】：带上 TA 刚发的这句——「你去x论坛关注我」会被感知并稍后自主决策
    const forumBlock = buildForumChatBlock(peer.id, userMsg?.content);
    // 情侣空间×AI（第九轮）：对方是恋人绑定的联系人时，注入你们在情侣空间里的一切（纪念日/想你/小树/问答/心情/100件小事/协议/编年史/印象/轨迹）
    const coupleBlock = coupleChatBlock(peer.id, 'wx', meAddrName);
    // 美团×AI 联动（外卖/代付）：实时订单动态 + 本聊天的待处理代付请求/待付订单 +
    // 食物话题命中时的商家目录与点外卖动作教学（全同步 kv 读，状态实时）
    const mtEngage = buildMtEngageCtx(peer.id, 'wx', [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]);
    // 淘宝×AI 联动（购物/代付/取件）：机主淘宝订单实时动态 + 待付订单帮付/在途快递帮取/
    // 礼物自动标记 + 购物话题时的商品目录与代买教学（全同步 kv 读，状态实时）
    const tbEngage = buildTbEngageCtx(peer.id, 'wx', [userMsg?.content, sysEvent, ...base.slice(-6).map(scanTextOf)]);
    // 时间感知（本会话独立开关，发送时现场读取；关闭时不注入任何时间信息，恢复普通聊天）：
    // 上次聊天间隔 = 该会话上一条消息时间戳（不含本轮刚发的消息）与当前时间的差值，按角色隔离不串台
    const priorMsgs = baseMsgs ?? msgs;
    const timeBlock = getTimeAware(sessionKey)
      ? buildTimeAwareBlock({
          lastMsgTime: priorMsgs.length > 0 ? priorMsgs[priorMsgs.length - 1].time : null,
          regionHint: peer.region || null,
        })
      : '';
    // 世界书：扫描「最新用户消息 + 最近 8 条上下文」，命中触发词的条目按插入位置分组注入
    //（每本书独立包裹成【世界设定开始】/【世界设定结束】块；系统/角色定义前后进 system，
    // 用户消息前后包裹最后一条 user 消息；未命中不发送；有内容时 system 末尾附带使用规则）
    // fix3-c #7：世界书锚点——labels 契约已合并（collectWbBlocks 尾参 WbLabels）：锚点块头注标注角色/机主名
    const wbBlocks = collectWbBlocks(peer.id, wbScanText([userMsg?.content, sysEvent, ...base.slice(-8).map(scanTextOf)]), { charName: peer.name, userName: meAddrName });
    // 位置感知：用户最近发过的位置消息（名称/地址/经纬度/发送时间）注入 system——
    // AI 被问“我在哪/你知道我在哪吗”时直接说出地点名；解析失败时诚实说无法识别，不编造；
    // fix3-c #5：补传 peerLabel（契约已合并）——AI 自己发的位置被库标注为
    // 「{角色名}（AI角色本人，就是你自己）发的你自己所在的位置，不是机主的位置」，防主语伪造
    const locBlock = buildLocationBlock(base, { userLabel: meAddrName, peerLabel: `「${peer.name}」` });
    // 双向拉黑感知：当前会话的拉黑关系注入 system（无拉黑状态时为空串；40-a 重构后拉黑会拦截本 App
    // 内的消息发送——byUser 时本回合早已被入口守卫取消；能走到这里的被拉黑回合=仅申请卡放行模式）
    const blkBlock = buildBlockPromptBlock('wx', peer.id, meAddrName);
    // 占位防编造（AI 感知审计修复）：最近消息里有听不到内容的语音 / 看不到内容的图片时注入——
    // AI 不得假装听过/看过并编造细节（本轮正在识图的图片排除：描述随后作为独立消息追加）
    const turnImageIds = new Set<string>();
    for (let i = base.length - 1; i >= 0 && turnImageIds.size < 3; i--) {
      const m = base[i];
      if (m.role !== 'me') break;
      if (m.kind === 'image') turnImageIds.add(m.id);
    }
    const mediaRules = [
      // fix3-c #6：占位规则按发送者区分文案（MediaRuleMsg 新增 role?: 'me'|'peer' 契约）——
      // 微信消息 role 本就是 me/peer，传入 base 即已携带该字段，契约合并后库即按发送者区分文案
      buildVoicePlaceholderRule(base),
      buildImagePlaceholderRule(base, { excludeIds: turnImageIds }),
    ].filter(Boolean);
    // 46-e：AI 视觉自主决策规则（换头像/换朋友圈背景/存相册；相册非空时附「选图操作 + 相册清单」）。
    // albumCacheRef 由挂载/peer 切换 effect 预热 + 本轮开头 fire-and-forget 刷新（同 crossCtxRef 模式）；
    // 47-b：清单取最近 20 张（升序末尾为最新），desc/name 缺失兜底「图片」。
    // 第三十一轮：①规则恒注入（不再要求会话有图/相册非空）——「自主换头像/存相册」是 AI 的常驻能力，
    // 没图也能 [生成新头像]，按需注入会让 AI 根本不知道自己能换（拉黑仅申请卡模式除外）；
    // ②清单按归属拆两份：peer 的进【相册清单】、机主的进【对方的相册清单】（buildVisionRules 新参）
    const albumSummary = albumCacheRef.current.length > 0
      ? albumCacheRef.current.filter((a) => a.contactId === peer.id).slice(-20).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
      : null;
    const ownerAlbumSummary = albumCacheRef.current.some((a) => a.contactId === me.id)
      ? albumCacheRef.current.filter((a) => a.contactId === me.id).slice(-15).map((a) => ({ id: a.id, desc: a.desc || a.name || '图片' }))
      : null;
    const visionRules = requestOnly ? [] : buildVisionRules(albumSummary, undefined, ownerAlbumSummary);
    // 发图片能力常开：注入照片标签规则（配置完整时发真图；未配置/生成失败自动降级为文字图片卡片，AI 无需关心）
    const photoRule = buildPhotoTagRule(peer.name);
    // AI 发朋友圈能力（用户要求「你去发个朋友圈」或自主想分享时真发）：[发朋友圈:正文] 标记 →
    // buildReplyMsgs 执行器 addCharMomentPost 真实落库；教学规则恒注入（单聊都有朋友圈，不等动态块非空）；
    // requestOnly（仅申请卡模式）下 AI 只能输出拉黑类动作，与 actionRules 同口径不下发
    const momentPostRule = requestOnly ? '' : buildMomentPostRule('wx');
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
      // v33【AI 真人社交】：论坛近况（紧随朋友圈感知块；空串时零成本）
      forumBlock,
      coupleBlock,
      locBlock,
      // 第二十九轮「头像感知」：AI 知道自己头像长什么样、用户头像长什么样/什么时候换的；
      // 用户换头像时 AI 会像真人一样自然注意到。同时懒补缺失的头像描述（识图失败过的）
      buildAvatarBlock(peer.id, me.id, meAddrName),
      [...actionRules, ...mtEngage.rules, ...tbEngage.rules].length > 0 ? [...actionRules, ...mtEngage.rules, ...tbEngage.rules].join('\n\n') : '',
      blkBlock,
      quitCtx?.section ?? '',
      kickSection,
      socialRules,
      // Task 37 角色分支：平行分支认知（分支侧身份说明/本体侧分支清单；无分支关系为空串不注入）
      branchBlockRef.current,
      ...(mediaRules.length > 0 ? [mediaRules.join('\n\n')] : []),
      // 46-e 视觉自主决策规则（在语音通话能力之前；让 AI 看图后可自主换头像/换背景/存相册/挑相册发聊天）
      ...(visionRules.length > 0 ? [visionRules.join('\n\n')] : []),
      // 生图（锁脸）：照片标签规则（自动生图开启时；AI 输出 [照片:描述] 系统自动生图并以图片消息投递）
      ...(photoRule ? [photoRule] : []),
      // AI 发朋友圈能力（[发朋友圈:正文] 真实发布；在照片规则后：先把「图片描述」的用法钉死再教发动态标记，
      // 防 AI 用 [图片:朋友圈编辑页面] 假装发了）
      momentPostRule,
      '【语音通话能力】如果你此刻非常想和对方马上说话（想TA了、有急事、聊到特别开心等自然原因），可以在回复的最开头单独加上标记 [语音通话] 发起一次语音通话邀请，对方手机会弹出你的来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。',
      '【视频通话能力】如果你此刻很想看看对方（想TA了、有值得分享的时刻、对方说想见你/想看看你等自然原因），可以在回复的最开头单独加上标记 [视频通话] 发起一次视频通话邀请，对方手机会弹出你的视频来电邀请；平时聊天不要加这个标记，最多偶尔一次，连续使用会很烦人。注意：标记必须是单独四个字 [视频通话]，严禁模仿聊天记录里「[视频通话：时长/内容摘要]」这类卡片描述文字的格式（那是系统卡片不是标记），不要输出带冒号的 [视频通话：……]。',
      timeBlock,
      wbBlocks.afterSystem,
      wbRulesBlock(wbBlocks),
    ]
      .filter(Boolean)
      .join('\n\n');
    const payloadMsgs: ChatPayloadMessage[] = applyWbUserBlocks(
      [
        { role: 'system' as const, content: replyCount > 1 ? `${systemFull}\n\n${buildReplyCountPrompt(replyCount)}\n\n${DEEP_THINK_RULE}` : `${systemFull}\n\n${DEEP_THINK_RULE}` },
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
      if (m.kind === 'image' && m.img?.src) {
        turnImages.unshift(m.img.src);
        turnImageMsgIds.unshift(m.id);
      }
    }
    // 回看兜底（用户实测：发图让 AI 看，AI 第一次没看懂，再让它看第二遍时不应要求重新发图）：
    // 本轮没有新图时，若用户最新消息带「看图」意图（看/图/照片/识别…），回退取会话里最近的「我」发的
    // 图片（最多 3 张，可跨过 AI 的回复取到）——AI 自己就能看到之前发的图，识图描述回写后历史永久可读。
    // 全会话扫描而非仅当轮：用户发图 → AI 回复 → 用户「你再看看」的场景（中间隔了 AI 消息）也要能取到图。
    if (turnImages.length === 0 && /看|图|照片|识/.test(userMsg?.content ?? '')) {
      for (let i = base.length - 1; i >= 0 && turnImages.length < 3; i--) {
        const m = base[i];
        if (m.role === 'me' && m.kind === 'image' && m.img?.src) {
          turnImages.unshift(m.img.src);
          turnImageMsgIds.unshift(m.id);
        }
      }
    }

    // ---- 边接收边逐条投递（分段流式核心）----
    // 流中每凑齐一条完整消息（分段器回调 onSegment）立刻解析并排队投递上屏；
    // 流结束后 finalize 只处理剩余的最后一条（N 条上限的第 N 条）——
    // 不再有「先全文显示、消失、再逐条重放」的流式气泡，流式与分条也不改同一块展示状态。
    let deliveredAny = false; // 本轮是否已有分段消息排队投递（决定兜底文案）
    //（batchStarted/msgIdx/wantCallSeen 移入本轮投递上下文 ctx：投递管线与接力拉取投递共用，见组件层）

    /** 流中分段投递：分段器每凑齐一条完整消息回调一次，立刻解析并排队上屏（边接收边逐条显示） */
    const deliverSegment = (seg: string) => {
      // F1 carry-over：上一段尾部未闭合的半截照片标签拼回本段开头，再切出本段尾部仍处未闭合的部分存回
      //（「[图片:黄昏的咖」跨段被切开后，两段各自都不再含半截标签；下一段到达后拼成完整标签正常剥出生图）
      const merged = carryTextRef.current + seg;
      const { send, carry } = splitUnfinishedPhotoTag(merged);
      carryTextRef.current = carry;
      // 一起听遥控：上一段尾部未闭合的半截播控指令拼回本段开头，再留住本段尾部新的半截（防「[快进:」被分段器切一半）
      const musicMerged = musicHoldRef.current + send;
      musicHoldRef.current = '';
      const musicCut = cutUnfinishedMusicTag(musicMerged);
      musicHoldRef.current = musicCut.held;
      const { msgs: built, cur, dirty } = buildReplyMsgs(musicCut.text, false, Date.now(), ctx);
      if (dirty) saveMsgs(peer.id, cur);
      if (built.length === 0) return;
      deliveredAny = true;
      enqueueBatch(built, ctx);
      flushPhotoJobs(ctx); // 生图（锁脸）：流中分段剥出的照片标签统一异步生成投递
    };

    const started = beginChatStream({
      sessionKey,
      aiMsgId: ctx.aiId,
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
                  prev.map((x) => (x.id === targetId && x.img ? { ...x, img: { ...x.img, desc: part } } : x)),
                );
              });
            },
          }
        : {}),
      // 边接收边逐条显示：分段器每凑齐一条完整消息立刻解析投递（多条模式）
      onSegment: deliverSegment,
      finalize: ({ content, error, tail, thinking }) => {
        // 深度思考：合并流层收集的思考过程（buildReplyMsgs 兜底剥离的已累积在 ref 里，流层的在此并入）
        if (thinking && thinking.trim()) {
          const prevTk = turnThinkRef.current.text;
          turnThinkRef.current.text = prevTk ? `${prevTk}\n${thinking.trim()}` : thinking.trim();
        }
        // F1 收尾：先把跨段 carry 取走并清空——流已结束，残留的半截照片标签不再投递
        //（拼回最后一段一起走管线，闭合则正常生图/降级，仍闭合不上则由 buildReplyMsgs 内兜底剥除）
        const carry = carryTextRef.current;
        carryTextRef.current = '';
        // 一起听遥控：收尾把留存的半截播控指令拼回（流已结束，不再留；未闭合的残留括号由 buildReplyMsgs 原文透传不执行）
        const musicHold = musicHoldRef.current;
        musicHoldRef.current = '';
        // 失败标记触发的我的消息（userMsg 为 null 时取 base 里最后一条我的消息；批次触发的消息早已入列）：
        // 新版失败不再落错误占位消息——在本条消息气泡前打红色 ! 徽标（点击重试），成功后在下方清除
        const failTargetId = userMsg?.id ?? [...base].reverse().find((m) => m.role === 'me' && !m.recalled)?.id ?? null;
        /** 落库 + 同步 state：给触发消息打/清 replyFail 标记（红色 ! 徽标）；
         *  Task 40：同步写/清 failReason（失败分类的友好文案，非原始报错——渲染消息行下方居中灰字行用；
         *  打标时缺省带兜底文案，清标时与 replyFail 一并移除；loadMsgs/saveMsgs/setMsgs 三处同步模式不变） */
        const setReplyFail = (fail: boolean, reason?: string) => {
          if (!failTargetId) return;
          const cur = loadMsgs(peer.id);
          if (!cur.some((m) => m.id === failTargetId)) return;
          const patchOf = (m: WxMsg) => {
            const nextReason = fail ? reason ?? m.failReason ?? CHAT_UNKNOWN_FAIL_TEXT : undefined;
            if (Boolean(m.replyFail) === fail && (m.failReason ?? undefined) === nextReason) return m;
            return { ...m, replyFail: fail || undefined, failReason: nextReason };
          };
          saveMsgs(peer.id, cur.map((m) => (m.id === failTargetId ? patchOf(m) : m)));
          setMsgs((prev) => prev.map((m) => (m.id === failTargetId ? patchOf(m) : m)));
        };
        if (error) {
          // A-3：流中已投递出分段时不再打失败徽标——分段已作为真实回复逐条上屏（本轮并非无回应）；
          // 投递队列无取消路径，已排队分段必然逐条落盘，此刻静默收尾即可。
          // Task 40：不打徽标但仍记一次失败（连续失败冷却计数 + 原始错误留作「复制错误详情」素材）
          if (deliveredAny) {
            recordChatFail(sessionKey, error);
            return;
          }
          // 仍未投递出任何分段（完全无回应）→ 触发消息打 replyFail 红色 ! 徽标，不再落错误占位文案；
          // Task 40：同步写入分类后的友好文案（网络/鉴权/限频/服务/超时…），渲染为消息行下方居中灰字行
          setReplyFail(true, classifyChatError(error).text);
          recordChatFail(sessionKey, error);
          return;
        }
        // 多条模式：流中分段已通过 onSegment 逐条解析投递上屏（边接收边逐条显示），
        // 这里只处理剩余的最后一条（N 条上限的第 N 条，可能含溢出合并的句子；F1：carry 拼回开头）；
        // 单条模式：整条回复在此按旧管线（&&& 标记切分）落盘 —— 两种模式都不重放已投递的分段
        const { msgs: built, cur, dirty } = buildReplyMsgs(musicHold + carry + (replyCount > 1 ? tail : content), replyCount <= 1, Date.now(), ctx);
        if (dirty) saveMsgs(peer.id, cur);
        // 剩余为空且流中也没有任何分段/动作产出时不算有效回复 → 触发消息打红色 ! 徽标（不再落兜底占位文案）；
        //（40-a：仅申请卡模式正文已被丢弃，静默收尾不打标）
        const finalBatch: WxMsg[] =
          built.length > 0
            ? built
            : deliveredAny || ctx.musicActed
              ? []
              : requestOnly
                ? []
                : (setReplyFail(true, CHAT_PARSE_FAIL_TEXT), recordChatFail(sessionKey, '空回复'), []);
        // 有任何产出（分段投递/动作/本轮落盘消息）：清除触发消息上的失败徽标（重试成功场景）；
        // Task 40：本轮有产出 = 成功 → 连续失败冷却计数清零（空回复失败分支不进这里，刚记的失败不会被误清）
        if (built.length > 0 || deliveredAny || ctx.musicActed) {
          setReplyFail(false);
          recordChatSuccess(sessionKey);
        }
        // 排队投递（模拟真人连发）：每条到达时才落盘 + 弹灵动岛通知 + 判定语音频率，停顿按内容长度
        // 模拟打字节奏；空批仅作占位，记忆库等「一轮结束」动作挂在全部消息投递完之后；
        // 调度器在模块层运行，与聊天页是否存活无关（退出页面后继续接收/投递）
        flushPhotoJobs(ctx); // 生图（锁脸）：finalize 剩余段剥出的照片标签统一异步生成投递
        void scheduleAiDelivery<WxMsg>(
          sessionKey,
          finalBatch,
          deliverAiMsg,
          {
            initialDelay: finalBatch.length > 0 ? (ctx.batchStarted ? typingDelayOf(finalBatch[0].content ?? '') : 0) : 0,
            delay: (i) => (i + 1 < finalBatch.length ? typingDelayOf(finalBatch[i + 1].content ?? '') : 0),
          },
        ).then(() => {
          // 深度思考回填：本轮全部消息投递完落库后，把思考过程写到本回合第一条 AI 文本消息的
          // thinking 字段（此刻 firstMsgId 对应消息必然已落盘；深度思考开关关闭时渲染层不显示，
          // 字段照存——重开开关即可回看，思考内容不丢）
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
          // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片（全部消息投递完后执行；后台异步，失败静默不打断聊天）；
          // names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人 name，均非昵称——
          // 展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）；
          // 多账号 v2：机主名按微信当前账号取 ownerRealNameFor('wx')（大号=机主；小号/匿名号=其档案联系人名）
          void Promise.all([ownerRealNameFor('wx'), contactRealName(peer.id)])
            .then(([owner, peerReal]) =>
              memAfterAiTurn(
                peer.id,
                'wx',
                apiConfig,
                () => memConvoFromRaw(loadMsgs(peer.id), peer.name),
                () => loadMsgs(peer.id),
                { user: owner || me.realName || me.name, peer: peerReal || displayNameOf(peer) || peer.name }
              )
            );
          // 单聊红包/转账 24h 过期清算（每轮 AI 回合结算后触发二）：全部消息投递完再扫，
          // 覆盖「聊天页一直开着、卡片跨天悬挂」的场景；命中本会话则把落盘变更合并进本地
          void wxExpireStalePeerCards().then((changed) => {
            if (mountedRef.current && changed.includes(peer.id)) mergeExpiredSweep();
          });
        });
        // AI 主动发起语音通话（标记可能出现在流中任一分段）：剥除后按 5 分钟冷却弹出来电浮层
        //（与接力拉取投递共用 triggerAiVoiceCall，见组件层）
        if (ctx.wantCallSeen) triggerAiVoiceCall();
        // Task 22 AI 主动视频通话（标记可能出现在流中任一分段）：同冷却与守卫口径弹视频来电浮层
        //（与接力拉取投递共用 triggerAiVideoCall，见组件层）
        if (ctx.wantVideoCallSeen) triggerAiVideoCall();
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started && userMsg) {
      setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
    }
    },
    [apiConfig, msgs, me, ownerName, peer, contacts, sessionKey, openVoiceCall]
  );

  /** 红色 ! 徽标重试：AI 回复失败的消息点击后重发同一回合（流/投递占用时静默，徽标保留可再点；
   *  消息本体已在 state 与存储里，runAiTurn 按 id 去重不会重复入列；成功在 finalize 清除标记） */
  const retryReply = useCallback(
    (m: WxMsg) => {
      // Task 40：连续失败冷却拦截——冷却中只 toast 提示不重发（红色徽标/灰字行重试都走这里）；
      // 冷却只拦「重试」，用户新消息发送入口不经过 retryReply，不受影响
      const cd = cooldownRemainText(sessionKey);
      if (cd) {
        onToast(cd);
        return;
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
      runAiTurnRef.current?.(m);
    },
    [sessionKey, onToast]
  );
  // 发红包/转账时通过 ref 触发（runAiTurn 定义在 execRedPacket 之后，见 runAiTurnRef 注释）
  runAiTurnRef.current = runAiTurn;

  // 退出网页后继续回复（服务端接力）：挂载时注册会话显示名（pagehide beacon 携带，Web Push 标题用联系人名）
  // 并拉取本会话待达消息（关页前没跑完的回复，服务端生成/暂存后在这里送达）；回前台/重新聚焦再拉一次。
  // 拉取走 deliverBgRef → 与正常回复完全一致的投递管线（逐条落盘 + 灵动岛通知 + 语音频率判定）
  useEffect(() => {
    registerBgSession(sessionKey, { title: peer.name, app: 'wechat', avatar: peer.avatar ?? null });
    const pull = () => {
      void pullBgPending(sessionKey).then((items) => {
        if (!mountedRef.current || items.length === 0) return;
        // mounted 校验通过才消费：StrictMode 双挂载/快速切会话时先拉到的实例被卸载丢弃，
        // pending 未清，重挂载的实例重新拉取投递（读拉/写清分离防吞消息）
        consumeBgPending(sessionKey);
        deliverBgRef.current?.(items);
      });
    };
    void pull(); // 挂载时立即拉（内部已防重入：会话有活跃流/投递时返回 []，等回前台再拉）
    const offVisible = onBgPageVisible(pull);
    return () => {
      offVisible();
      unregisterBgSession(sessionKey);
    };
  }, [sessionKey, peer.name]);


  /** 退还 AI 发来的红包/转账/亲属卡（红包弹窗「退还」、转账收款页「退还」、亲属卡领取页「退还」共用）：
   *  原卡标记终态（变灰）+ 聊天里追加通知行。
   *  退还后 AI 不再被注入系统事件自动跟发回应（用户不希望退回动作立刻招来一串 AI 消息）；
   *  AI 对卡片终态的感知来自聊天历史序列化（wxCardStateLabel 带「（{名}退还）」执行者）与既有记忆管线，
   *  下一轮对话自然可见「卡已被退回」，无需即时打断 */
  const refundPeerCard = useCallback(
    (m: WxMsg) => {
      if (m.kind === 'redpacket' && m.rp) {
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.rp ? { ...x, rp: { ...x.rp, status: 'returned' as const } } : x)),
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你退回了${peer.name}的`, accent: '红包' } },
        ]);
        setOpeningId(null);
        setReceiveId(null);
        setDetailId(null);
        onToast('红包已退还给对方');
      } else if (m.kind === 'transfer' && m.tr) {
        const refundedAt = Date.now();
        const trAmt = m.tr.amount;
        const trNote = m.tr.note;
        // 我退还 AI 发的转账：原卡标记终态（变灰）+ 追加「我」发出的退还凭据卡（灰卡↩+已退还，详情页「你已退还」）
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.tr ? { ...x, tr: { ...x.tr, status: 'returned' as const, refundedAt } } : x)),
          {
            id: uid(),
            role: 'me',
            content: '',
            time: refundedAt,
            kind: 'transfer',
            tr: { amount: trAmt, note: trNote, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'me' as const },
          },
        ]);
        setReceiveId(null);
        setDetailId(null);
        onToast('转账已退还给对方');
      } else if (m.kind === 'family' && m.fam) {
        setMsgs((prev) => [
          ...prev.map((x) => (x.id === m.id && x.fam ? { ...x, fam: { ...x.fam, rejected: true } } : x)),
          { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'fam', pre: `你退回了${peer.name}的`, accent: '亲属卡' } },
        ]);
        // 审计4-M4：已领取过的卡同步从「我收到的亲属卡」摘除（镜像 wallet 侧解除的存储同步，
        // 对称 wallet onUnbindReceived：写回 LS_FC_IN + 本函数已做的聊天卡标记 + 通知行）——
        // 此前只改聊天卡，钱包侧仍「使用中」、支付方式行仍计入其全额额度。领取时按来源卡消息 id
        // 入表（claimFamily msgId），按 id 精确摘除；未领取的卡本就无入表记录（filter 无匹配，幂等）
        const inList = loadFamilyCardsIn();
        const nextIn = inList.filter((f) => f.msgId !== m.id);
        if (nextIn.length !== inList.length) saveFamilyCardsIn(nextIn);
        setDetailId(null);
        onToast('亲属卡已退还');
      }
    },
    [peer.id, peer.name, onToast]
  );

  // ---------------- 双向拉黑（用户开关 / 角色申请卡片的同意与拒绝） ----------------

  /** 追加一条系统提示行（拉黑状态变更提示；居中灰字胶囊，不进 AI 上下文） */
  const pushSysMsg = useCallback((text: string) => {
    setMsgs((prev) => [...prev, { id: uid(), role: 'peer' as const, content: '', time: Date.now(), kind: 'sys' as const, sys: { text } }]);
  }, []);

  /** 设置页「拉黑」开关：持久化（kv，按联系人隔离）+ 生成系统消息；角色下一轮起通过 system 感知 */
  const toggleBlockFromSettings = useCallback(
    (v: boolean) => {
      setBlk(setUserBlock('wx', peer.id, v));
      pushSysMsg(v ? `你已拉黑「${peer.name}」` : `你已解除拉黑「${peer.name}」`);
    },
    [peer.id, peer.name, pushSysMsg]
  );

  /** 处理「申请解除拉黑」卡片：同意 → 解除拉黑；拒绝 → 保持并记录拒绝（角色下一轮知道被拒绝）。
   *  两种结果都会立刻注入系统事件触发角色人设化回应，避免「点了没反应」。
   *  37-a：回复中（流式/投递）时事件随补跑回合排队（对齐 chat.tsx resolveBlockReq），不再被占用中的流静默丢弃 */
  const resolveBlockReq = useCallback(
    (m: WxMsg, accept: boolean) => {
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
        setBlk(acceptBlockReq('wx', peer.id));
        pushSysMsg(`你同意了「${peer.name}」的解除拉黑申请`);
      } else {
        setBlk(rejectBlockReq('wx', peer.id));
        pushSysMsg(`你拒绝了「${peer.name}」的解除拉黑申请`);
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        wxQueueAdd(peer.id, ev); // 事件随补跑回合保留，流收尾且投递完毕后自动触发回应
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
    const res = applyUserBlockReq('wx', peer.id, userReqText);
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
      wxQueueAdd(peer.id, ev);
      return;
    }
    runAiTurnRef.current?.(null, [], ev);
  };

  /** 拉黑标记（对照用户截图）：红色 ! 圆点紧贴气泡——拉黑关系存续期间（任一方向），该期间内的
   *  双方气泡都带图标（用户拉黑 AI 后用户气泡也有图标，反之亦然）；
   *  按拉黑区间判定：拉黑前的历史消息不标，拉黑期间发的消息恒标（解除后也不消失），解除后新消息不标；
   *  系统提示行/申请卡片/撤回行不显示 */
  const blockSideOf = (m: WxMsg): 'me' | 'peer' | null => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (!blockCoversAt(blk, 'byUser', m.time) && !blockCoversAt(blk, 'byChar', m.time)) return null;
    return m.role === 'me' ? 'me' : 'peer';
  };

  /** 拉黑图标渲染（红色 ! 圆点，微信发送失败图标同位）：我的消息在气泡左侧、对方在气泡右侧 */
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
  const blockedIconOf = (m: WxMsg) => {
    const side = blockSideOf(m);
    if (!side) return null;
    return blockIconSpan(side, side === 'me' ? 'wx-block-icon-me' : 'wx-block-icon-peer');
  };

  /** 「消息已发出，但被对方拒收了。」状态行：仅「对方拉黑我」区间内我的消息后面跟随（与图标判定解耦：
   *  用户拉黑 AI 后自己的气泡也有图标，但不显示拒收文案），
   *  居中半透明圆角胶囊（与系统提示行同款） */
  const blockedLineOf = (m: WxMsg) => {
    if (m.recalled || m.kind === 'notice' || m.kind === 'sys' || m.kind === 'blockreq') return null;
    if (m.role !== 'me' || !blockCoversAt(blk, 'byChar', m.time)) return null;
    return (
      <div className="py-1.5 text-center">
        <span
          data-testid="wx-block-line-me"
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
    if (!text && pendingImgs.length === 0) return;
    // 40-a 拉黑拦截：被角色拉黑（byChar）后本 App 内不能发送任何消息（toast + 不落库）；
    // 唯一例外是「解除拉黑申请」，走输入区上方独立入口，不在 send 链上
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    // 发送提示音（设置 › 通知可配；文字/图片/转语音共用的发送链入口）
    playNotifySound('send');
    // 文字转语音发送：合成语音气泡（transcript 带原文，AI 直接读得到内容）；失败只 toast 不发文字。
    // 开着转语音时文字优先走语音（待发图片留在预览条，再点一次「发送」走纯图路径）
    if (ttsSend && text) {
      sendTextAsVoiceRef.current(text);
      return;
    }
    // 组合发送（输入框文字 + 待发图片一起发）：文字消息在前、图片在后全部上屏+落盘，只触发一轮 AI 回复
    //（runAiTurn 的 base 按 id 去重，(userMsg, created) 两个都进上下文——文字、图片同一轮被 AI 读到）
    const userMsg: WxMsg | null = text
      ? { id: uid(), role: 'me', content: text, time: Date.now(), quote: quote ?? undefined, unread: true }
      : null;
    const created: WxMsg[] = pendingImgs.map((p) => ({ id: uid(), role: 'me', content: '', time: Date.now(), kind: 'image' as const, img: { src: p.src }, unread: true }));
    // v40【复制链接→发给AI】粘贴 X 论坛帖子链接发送：链接文字照发，后面自动跟一张帖子分享卡——
    // AI 回合把卡片序列化成「帖子正文＋热门评论」的上下文（forumShareHistoryLine），并异步写一条
    // 「TA把帖子链接发给了我」记忆；点卡片可深链回论坛打开帖子（删帖后卡片自动失效）
    const linkPost = text && peer.id !== me.id ? resolveForumLinkPost(text) : null;
    const linkCard = linkPost ? buildForumShareCardMsg(linkPost) : null;
    if (linkPost) void noteForumLinkSharedToChat({ idp: 'wx', contactId: peer.id, post: linkPost });
    const batch = [...(userMsg ? [userMsg] : []), ...(linkCard ? [linkCard] : []), ...created];
    // 显示设置 › 已读回执：markPeerRead（模块级）—— append 时把 TA 的未读全部转已读；
    // 我的新消息已带 unread: true（TA 回复落地时转已读）
    // 拉黑方向修正：用户说「我要拉黑你」类明确宣言 → 系统直接执行「用户拉黑对方」
    //（此前 AI 会误解成让它拉黑用户，方向反了；现在系统代为执行，AI 回合守卫自动转
    // 「仅申请解除拉黑」口径，AI 按人设反应；拉黑跃迁同时触发跨 App 找人/来电钩子）
    if (userMsg && peer.id !== me.id && isUserBlockIntent(userMsg.content) && !loadBlock('wx', peer.id).byUser) {
      setBlk(setUserBlock('wx', peer.id, true));
      onToast(`已将「${peer.name}」加入黑名单`);
      batch.push({ id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text: `你已拉黑「${peer.name}」` } });
    }
    const clearComposer = () => {
      setInput('');
      // Task 40：发送（排队补跑分支同样先走这里）即清草稿；clearChatDraft 内建取消防抖写，防旧值写回
      clearChatDraft('wx', peer.id);
      setQuote(null);
      setPendingImgs([]);
    };
    // 对方正在回复（流式接收或连发投递未清空，投递可拖到流结束后数秒）：消息照常入列并排队，
    // 「流收尾且投递完毕」后自动补跑回复——不再静默丢弃（旧版直接 return：消息滞留输入框，
    // 看起来像「发了消息没人理」，AI 下一轮自然接不上话）。投递中也排队：否则旧回复尾部
    // 进不了新回合上下文，旧 AI 气泡还会倒挂在用户新消息下面。组合发送遇排队整批走同一口径。
    // #35：标记投递插入边界——上一轮还在队列里的回复落库时插到这条新消息之前（时序归属上一轮）
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      clearComposer();
      setMsgs((prev) => [...markPeerRead(prev), ...batch]);
      markDeliverBoundary(sessionKey, batch[0].id);
      wxQueueAdd(peer.id);
      // 37-a：按钮流式中不再禁用，排队补跑统一给 toast 反馈（消息已上屏但回复要等上一轮走完）
      onToast('消息已发出，对方回完这轮就聊');
      return;
    }
    clearComposer();
    // 给自己发消息（「我」详情页「发消息」入口）：只记录，不触发 AI 回复
    if (peer.id === me.id) {
      setMsgs((prev) => [...markPeerRead(prev), ...batch]);
      return;
    }
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setMsgs((prev) => [...markPeerRead(prev), ...batch]);
      setPendingDispatch(true);
      markPendingBatch(sessionKey, true);
      return;
    }
    setMsgs((prev) => [...markPeerRead(prev), ...batch]);
    // Task 49 定时提醒：用户消息像「定时发消息」指令时先解析（LLM 两级兜底；正则闸未命中零开销）；
    // 落任务后：聊天里落灰色系统行（确定性反馈）+ 本轮 sysEvent 带确认提示（AI 自然确认）
    if (userMsg && reminderHintHit(userMsg.content)) {
      const label = await parseReminderInstruction('wx', peer.id, userMsg.content);
      if (label) {
        const sys = buildReminderSysMsg('wx', label) as unknown as WxMsg;
        saveMsgs(peer.id, appendWithBoundary(sessionKey, loadMsgs(peer.id), sys));
        setMsgs((prev) => (prev.some((m) => m.id === sys.id) ? prev : [...prev, sys]));
        runAiTurnRef.current?.(userMsg, linkCard ? [linkCard, ...created] : created, reminderSysHint(label));
        return;
      }
    }
    runAiTurnRef.current?.(userMsg, linkCard ? [linkCard, ...created] : created);
  }, [input, me, peer, sessionKey, sentenceSend, quote, ttsSend, pendingImgs, onToast]);

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」）；
   *  连发投递未清空时同样不开新回合（与流式中的口径一致：等上一轮投递完毕再点一次） */
  const dispatchBatch = useCallback(() => {
    if (!pendingDispatch || isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    runAiTurn(null);
  }, [pendingDispatch, runAiTurn, sessionKey]);

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字 ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音为本地仿真 localText，无音频） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[]; localText?: string };

  /** 语音消息落库：入列 → 直发语音先自动转写（AI 读内容）再触发回复；已有转写直接触发；
   *  presetTranscript = 文字转语音/划转文字/Web Speech 实时结果；selfChat 只记录；回复中排队补跑 */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      // 40-a 拉黑拦截：被角色拉黑（byChar）后语音消息也不能发（按住说话/文字转语音/划转文字共用本入口）
      if (loadBlock('wx', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      const hasText = typeof presetTranscript === 'string' && presetTranscript.trim().length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, localText: clip.localText, stt: 'pending' };
      const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'voice', voice, unread: true };
      setMsgs((prev) => [...markPeerRead(prev), msg]);
      // 给自己发消息（「我」详情页入口）：只记录，不触发 AI 回复
      if (peer.id === me.id) return;
      /** 触发 AI 回复（对方正在回复——流式或连发投递中——则排队补跑）；转写完成后再触发，AI 才能读到语音内容 */
      const kickTurn = () => {
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          markDeliverBoundary(sessionKey, msg.id); // #35：语音消息也作插入边界，旧回复落库时插到它前面
          wxQueueAdd(peer.id); // 对方正在回复：本轮「流收尾且投递完毕」后自动补跑
          return;
        }
        window.setTimeout(() => runAiTurnRef.current?.(null), 80);
      };
      if (hasText) {
        // 已带转写（文字转语音 / 划到转文字后发语音 / Web Speech 实时结果）：直接触发
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
      if (loadBlock('wx', peer.id).byChar) {
        onToast('对方已将你拉黑，无法发送');
        return;
      }
      const userMsg: WxMsg = { id: uid(), role: 'me', content: text, time: Date.now(), unread: true };
      if (peer.id === me.id) {
        setMsgs((prev) => [...markPeerRead(prev), userMsg]);
        return;
      }
      if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
        setMsgs((prev) => [...markPeerRead(prev), userMsg]);
        markDeliverBoundary(sessionKey, userMsg.id); // #35
        wxQueueAdd(peer.id);
        return;
      }
      if (sentenceSend) {
        setMsgs((prev) => [...markPeerRead(prev), userMsg]);
        setPendingDispatch(true);
        markPendingBatch(sessionKey, true);
        return;
      }
      setMsgs((prev) => [...markPeerRead(prev), userMsg]);
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
      // Task 40：转语音发送与文字发送同口径——发出即清草稿（发送失败保留草稿，重进不丢）
      clearChatDraft('wx', peer.id);
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => onToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, onToast],
  );
  sendTextAsVoiceRef.current = sendTextAsVoice;

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成 ----------------

  /** 消息的可复制/引用文本快照（表情/图片/文字图片卡片/位置/卡片/转发都有占位描述） */
  const quoteContentOf = (m: WxMsg): string =>
    m.kind === 'sticker'
      ? m.stk?.meaning
        ? `[表情] ${m.stk.meaning}`
        : '[表情]'
      : m.kind === 'image'
        ? m.img?.desc
          ? `[图片] ${m.img.desc}`
          : '[图片]'
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
          : m.kind === 'redpacket' && m.rp
            ? `[红包] ¥${m.rp.amount} ${m.rp.blessing}`
            : m.kind === 'transfer' && m.tr
              ? `[转账] ¥${m.tr.amount}${m.tr.note ? ` ${m.tr.note}` : ''}`
              : m.kind === 'family' && m.fam
                ? '[亲属卡]'
                : m.kind === 'forward'
                  ? m.fwd?.merged
                    ? `[聊天记录] ${m.fwd.title ?? m.content}`
                    : `[转发] ${m.content}`
                  : m.content;

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: WxMsg): boolean => m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（我的/AI 气泡都可：复制 删除 编辑 引用 多选 撤回 转发 收藏；图片多保存，AI 图片多重新生成图片（自填描述）；已收藏的消息显示「已收藏」；
   *  好友验证消息（fr=apply/greet）永久保留在聊天记录：禁删除/撤回/编辑/引用/重新生成） */
  const buildMsgMenuItems = (m: WxMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const isVoice = m.kind === 'voice';
    const isImage = m.kind === 'image';
    const isFrLocked = m.fr === 'apply' || m.fr === 'greet';
    const items: BubbleMenuItem[] = [];
    // 语音消息首项「转文字」/「取消转文字」（toggle：已转写→取消收起；未转写→识别；失败可重试）
    if (isVoice) items.push({ key: 'stt', label: m.voice?.stt === 'done' && m.voice.transcript ? '取消转文字' : '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    // Task 32 表情包收藏：长按表情气泡 →「添加」（收藏进「我的表情」默认分组）；
    // 同图已在收藏里 → 显示「已添加」置灰态（filled，点了只提示不重复入库）
    if (m.kind === 'sticker' && m.stk?.url) {
      const saved = loadStickers('wx').some((s) => s.url === m.stk!.url);
      items.push({ key: 'addsticker', label: saved ? '已添加' : '添加', icon: B.addsticker, filled: saved });
    }
    // 图片消息：保存到设备（dataURL 直接下载）
    if (isImage && m.img?.src) items.push({ key: 'saveimg', label: '保存', icon: B.save });
    // G2 恢复上一张：重新生成前的旧图还留着（prevSrc），长按可换回（再操作一次又换回新图，来回切换）
    if (isImage && m.img?.prevSrc) items.push({ key: 'restoreimg', label: '恢复上一张', icon: B.recall });
    if (!isFrLocked) items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if ((isText || isVoice) && !isFrLocked) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    // 引用（Task 30 扩展）：文字之外，图片/表情/语音/文字图片/位置/歌曲也能引用——
    // 引用块按源消息类型显示迷你缩略图/语音图标（无源时退回文字占位，quoteContentOf 兜底）
    const isQuotable = isText || isVoice || isImage || m.kind === 'sticker' || m.kind === 'textcard' || m.kind === 'location' || m.kind === 'song';
    if (isQuotable && !isFrLocked) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    if (!isFrLocked) items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('wx', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('wx', m.id) });
    // 角色分支（Task 37）：以这条消息为分支点，把该角色克隆成独立平行联系人（自己会话/好友验证行不显示）
    if (peer.kind !== 'user' && !isFrLocked) items.push({ key: 'branch', label: '分支', icon: B.branch });
    if (m.role === 'peer' && !isFrLocked) {
      // AI 图片：重新生成图片（自填描述，原地替换）替代整轮重答；文字气泡保留原「重新生成」
      if (isImage) items.push({ key: 'regenimg', label: '重新生成', icon: B.regenimg });
      else items.push({ key: 'regen', label: '重新生成', icon: B.regen });
    } else if (isImage && m.img?.fromCard) {
      // 「文字图片卡片转出的图片」（我的）：重新生成（自填描述，原地替换，不带锁脸）
      items.push({ key: 'regenimg', label: '重新生成', icon: B.regenimg });
    }
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

  /** 拍一拍：系统行落盘（我拍对方/拍自己，带我在个人资料页设置的拍一拍文案后缀）+ 触发 AI 回合——
   *  AI 从上下文得知被拍/我拍了拍自己与文案（人设决定怎么反应，也可以用 [拍一拍:文案] 拍回来）。
   *  对方正在回复时不触发回合：拍一拍行照常落盘，下一轮上下文自然带上 */
  const patPeer = (self = false) => {
    const clap = readWxClapText();
    const msg: WxMsg = {
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
  const favOf = (m: WxMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: peer.id,
    contactName: peer.name,
    contactAvatar: peer.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: quoteContentOf(m),
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.img?.src : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成：删除该条 AI 回复所在轮次及其后的全部消息（包括我又发出去的消息），
   *  以剩余历史重新发起请求（回复条数按本会话设置重新连发）；任意历史 AI 气泡都可触发。
   *  连发投递中也拒绝：旧回复尾巴还在队列里逐条落盘，此刻截断会把队列尾部拽进新轮上下文 */
  const regenerate = (m: WxMsg) => {
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
  const forwardClone = (m: WxMsg): WxMsg => {
    const id = uid();
    if (m.fwd?.merged) return { id, role: 'me', content: m.content, time: Date.now(), kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { id, role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { id, role: 'me', content: '', time: Date.now(), kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { id, role: 'me', content: '', time: Date.now(), kind: 'location', loc: { ...m.loc } };
    // 歌曲卡片可转发（同类型卡片新 id；autoPlay/invite 不随转发保留——转发后不自动播/不再弹邀请）
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
  const forwardTbPayClone = async (m: WxMsg, target: FwdSheetTarget): Promise<WxMsg | null> => {
    const p = m.tbpay ? tbGetProxy(m.tbpay.pid) : null;
    if (!m.tbpay || m.tbpay.role !== 'req' || !p || p.direction === 'me' || p.status !== 'pending' || target.self) return null;
    try {
      const res = await tbReshareProxy(p.id, 'wx', target.id, undefined, undefined, me.name, me.avatar, { deferCard: true });
      if (!res.ok) return null;
      return { id: uid(), role: 'me', content: res.card.content, time: Date.now(), kind: 'tbpay', tbpay: { pid: res.pid, role: 'req' } };
    } catch {
      return null;
    }
  };

  /** 转发目标：微信好友（排除当前会话）+ 自己（文件传输助手式入口） */
  const forwardTargets = useMemo(() => {
    const list = contacts.filter((c) => c.kind !== 'user' && c.id !== peer.id && isFriendIn(c, 'wx'));
    const self = contacts.find((c) => c.id === me.id);
    return self ? [self, ...list] : list;
  }, [contacts, peer.id, me.id]);

  /** 执行转发（逐条/合并）：写入目标会话存储 + 未读角标 + 给目标 AI 排感知事件（打开会话即触发 AI 回应）；
   *  淘宝代付请求卡逐条转发时异步转活卡（tbReshareProxy），其余消息同步克隆 */
  const doForward = async (mode: FwdMode, ids: string[], target: FwdSheetTarget): Promise<void> => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0 || target.id === peer.id) return;
    const nameOf = (m: WxMsg) => (m.role === 'me' ? me.name : peer.name);
    if (mode === 'each') {
      // 逐条转发：按时间顺序每条克隆成独立消息（tbpay 请求卡走活卡转发，失败回退占位文案）
      const clones: WxMsg[] = [];
      for (const m of list) {
        const live = m.kind === 'tbpay' && m.tbpay ? await forwardTbPayClone(m, target) : null;
        clones.push(live ?? forwardClone(m));
      }
      saveMsgs(target.id, [...loadMsgs(target.id), ...clones]);
    } else {
      // 合并转发：合成一张「聊天记录」卡片（标题 = 我与对方，内嵌逐条对话，点击可看全文）
      const title = fwdRecordTitle(me.name, peer.name);
      const card: WxMsg = {
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
            imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.img?.src : undefined,
            stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
          })),
        },
      };
      saveMsgs(target.id, [...loadMsgs(target.id), card]);
    }
    // 逐条转发 N 条 → 角标 +N；合并转发是 1 张卡片 → 角标 +1
    wxUnreads.bump(target.id, mode === 'each' ? list.length : 1);
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
        // 审计 #37：投递进行中拒绝转文字（与删除/撤回同口径双查守卫）——投递 tick 的 loadMsgs 读旧存储，
        // 转写结果会被投递落盘的旧内容覆盖回去
        if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
          onToast('对方正在回复，请稍后再试');
          return;
        }
        // 语音消息「转文字」：已有结果 → 再点一次=取消转文字（收起结果）；否则现场识别（builtin 免配置），失败可重试
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
        // 入库后广播 wx-stickers-changed（表情面板若开着立即刷新，关着下次打开现读）
        if (m.kind !== 'sticker' || !m.stk?.url) break;
        const cur = loadStickers('wx');
        if (cur.some((s) => s.url === m.stk!.url)) {
          onToast('已在「我的表情」');
          break;
        }
        saveStickers('wx', [
          ...cur,
          { id: newStickerId(), url: m.stk.url, meaning: m.stk.meaning ?? '', groupId: DEFAULT_STICKER_GROUP_ID, createdAt: Date.now() },
        ]);
        window.dispatchEvent(new CustomEvent('wx-stickers-changed'));
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
        // id 带上源消息：删除/撤回后引用显示「原消息已删除」
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
        // 审计 #17：撤回同步清除该消息的记忆素材（原文片段/向量来源），不留在记忆检索结果里
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
        if (isMsgFavorited('wx', m.id)) {
          unfavoriteMsg('wx', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('wx', favOf(m));
        onToast('收藏成功');
        break;
      case 'branch':
        // Task 37 角色分支：打开创建弹层（分支点 = 长按的这条消息；复制在弹层确认后全量执行）
        setBranchDlg({ msg: m, preview: quoteContentOf(m) });
        break;
      case 'regen':
        regenerate(m);
        break;
      case 'saveimg': {
        // 图片保存到设备：dataURL 直接以 <a download> 触发下载
        const src = m.kind === 'image' ? m.img?.src ?? '' : '';
        if (src && downloadImageSrc(src)) onToast('已保存到设备');
        else onToast('保存失败');
        break;
      }
      case 'restoreimg': {
        // G2 恢复上一张：交换当前图与重新生成前的旧图（原地替换自动落盘；再长按一次即换回新图）
        setMsgs((prev) =>
          prev.map((x) =>
            x.id === m.id && x.kind === 'image' && x.img?.src && x.img.prevSrc
              ? { ...x, img: { ...x.img, src: x.img.prevSrc, prevSrc: x.img.src } }
              : x,
          ),
        );
        onToast('已恢复上一张');
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
    }
  };

  /** 重新生成图片提交：按（可编辑的）描述重生成，成功后原地替换该条消息的图片（自动落盘）；
   *  AI 图片按角色形象锁脸；「文字图片卡片转出的图片」不带锁脸（与首图同口径） */
  const submitImgRegen = async () => {
    const target = regenImgId ? msgs.find((x) => x.id === regenImgId && x.kind === 'image' && (x.role === 'peer' || x.img?.fromCard)) : null;
    const desc = regenImgDesc.trim().slice(0, 400); // G1：描述截 400（与 imggen 照片标签描述上限同宽）
    if (!target || !desc || regenImgBusy) return;
    setRegenImgBusy(true);
    setRegenImgError('');
    try {
      const cfg = useSettings.getState().imgGenConfig;
      const r =
        target.role === 'peer'
          ? await generateCharacterPhoto({ cfg, contactId: peer.id, desc, charName: peer.name, useRef: true })
          : await generateCharacterPhoto({ cfg, contactId: '', desc, charName: '文字图片', useRef: false });
      // 替换时把旧图存进 prevSrc（G2「恢复上一张」：长按菜单换回，可来回切换）；desc 同步更新
      setMsgs((prev) => prev.map((x) => (x.id === target.id && x.kind === 'image' ? { ...x, img: { ...x.img, src: r.src, desc, prevSrc: x.img?.src } } : x)));
      // B2 与自动生成同口径：AI 图片重新生成成功入角色相册（我的图/卡片转图不入）
      if (target.role === 'peer') void addAlbum(peer.id, r.src, { desc, origin: 'ai' });
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
    const fresh = list.filter((m) => !isMsgFavorited('wx', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('wx', favOf(m));
    onToast(fresh.length === list.length ? `已收藏 ${fresh.length} 条消息` : `已收藏 ${fresh.length} 条（${list.length - fresh.length} 条已收藏过）`);
    exitSelect();
  };

  /** 多选批量转发（进入聊天内勾选模式，可继续增删、选逐条/合并） */
  const batchForward = () => {
    if (selectedIds.length === 0) return;
    setFwdFlow('choose');
  };

  const selfChat = peer.id === me.id;

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次；37-a 去掉流式禁用：回复中点击走排队口径） */
  const canDispatch = sentenceSend && pendingDispatch && !selfChat;

  /** 发红包提交：校验 → 开启支付密码先验证 → 扣款（按支付方式）并插卡消息 */
  const submitRedPacket = (amount: number, blessing: string, methodId: string) => {
    if (!wxCanPay(methodId, amount)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'redpacket', amount, blessing, methodId });
      return;
    }
    execRedPacket(amount, blessing, methodId);
  };

  const execRedPacket = (amount: number, blessing: string, methodId: string) => {
    // 40-a 拉黑拦截：被角色拉黑（byChar）后红包也发不出（扣款前拦截，不落库不触发 AI）
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    const pay = wxExecutePayment(methodId, amount, '红包', { peer: peer.name, avatar: peer.avatar });
    if (!pay) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    // 生成 AI 可引用的短 ID；发出后立即触发 AI 回复（红包进待处理清单，AI 按人设决定领取/退回/拒收）
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'redpacket', rp: { amount, blessing, opened: false, cid: nextWxCid('rp') } };
    // 第七十四轮（用户指定）：亲属卡付款不再往聊天里插「你用X送的亲属卡支付了¥N」提示行——
    // 消费感知照常落库（流水 + 按赠卡人的记忆碎片，recordFcSpend 绝不触发 AI 回合），只是界面不显示；
    // 自聊（发给自己）无感知对象：不落流水
    setMsgs((prev) => [...prev, msg]);
    if (pay.fc && peer.id !== me.id) {
      recordFcSpend({ total: pay.fc.total, scene: '红包', where: `发给「${peer.name}」的红包`, note: blessing || undefined, parts: pay.fc.parts, ownerName: me.realName || me.name });
    }
    setCompose(null);
    if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
  };

  /** 发转账提交：校验 → 开启支付密码先验证 → 扣款（按支付方式）并插卡消息；对方打开详情时确认收款 */
  const submitTransfer = (amount: number, note: string, methodId: string) => {
    if (!wxCanPay(methodId, amount)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'transfer', amount, note, methodId });
      return;
    }
    execTransfer(amount, note, methodId);
  };

  const execTransfer = (amount: number, note: string, methodId: string) => {
    // 40-a 拉黑拦截：被角色拉黑（byChar）后转账也发不出（扣款前拦截，不落库不触发 AI）
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    const pay = wxExecutePayment(methodId, amount, '转账', { peer: peer.name, avatar: peer.avatar });
    if (!pay) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    // 生成 AI 可引用的短 ID；发出后立即触发 AI 回复（AI 按人设决定收款/退回/拒收）
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'transfer', tr: { amount, note, received: false, cid: nextWxCid('tr') } };
    // 第七十四轮（用户指定）：亲属卡付款不再往聊天里插「你用X送的亲属卡支付了¥N」提示行——
    // 消费感知照常落库（流水 + 按赠卡人的记忆碎片，recordFcSpend 绝不触发 AI 回合），只是界面不显示；
    // 自聊（发给自己）无感知对象：不落流水
    setMsgs((prev) => [...prev, msg]);
    if (pay.fc && peer.id !== me.id) {
      recordFcSpend({ total: pay.fc.total, scene: '转账', where: `转给「${peer.name}」的转账`, note: note || undefined, parts: pay.fc.parts, ownerName: me.realName || me.name });
    }
    setCompose(null);
    if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
  };

  /** 領红包（仅限对方发的）：金额存入零钱 + 记收入账单 + 聊天里发「你领取了XX的红包」提示行 → 进详情；自己发的红包不能自己领 */
  const openRedPacket = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m?.rp || m.rp.opened || m.rp.status || m.role !== 'peer') return;
    wxPatchBalance(m.rp.amount, { kind: '红包', amount: m.rp.amount, peer: peer.name });
    // 领取提示行（居中灰字 + 金色尾词）：与对方领取我的红包同款样式
    const notice: WxMsg = { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'rp', pre: `你领取了${peer.name}的`, accent: '红包' } };
    setMsgs((prev) => [
      ...prev.map((x) => (x.id === id && x.rp ? { ...x, rp: { ...x.rp, opened: true, openedAt: Date.now(), openedBy: me.name } } : x)),
      notice,
    ]);
    setOpeningId(null);
    setDetailId(id);
  };

  /** 打开红包详情（我发的红包由 AI 用动作标记处理，这里只看详情） */
  const openRedPacketDetail = (id: string) => {
    setDetailId(id);
  };

  /** 打开转账详情（我发的转账由 AI 用动作标记决定收款/退回/拒收，这里只看详情） */
  const openTransferDetail = (id: string) => {
    setDetailId(id);
  };

  /** 收款（对方发来的转账，收款页点「收款」）：原卡标记已收款 + 金额入零钱 + 记收入账单
   *  + 追加我的「已收款」接收卡片（receiptOf=peer，详情页显示「你已收款」）——与 AI 收我转账的凭据卡同款、方向相反 */
  const acceptTransfer = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    // #24：终态复核（对照 openRedPacket 的 opened/status/role 三查）——已收款/已退回/已拒收/已撤回/
    // 非对方发的卡一律拦截。24h 过期清算会把未收款转账置 returned，但已开着的收款浮层不会自动感知，
    // 旧代码只查 received，浮层里再点「收款」会凭空多得一笔资金
    if (!m?.tr || m.tr.received || m.tr.status || m.recalled || m.role !== 'peer') {
      if (m?.tr && !m.tr.received && m.tr.status === 'returned') onToast('该转账已退回');
      return;
    }
    wxPatchBalance(m.tr.amount, { kind: '转账', amount: m.tr.amount, peer: peer.name, avatar: peer.avatar });
    const receipt: WxMsg = {
      id: uid(),
      role: 'me',
      content: '',
      time: Date.now(),
      kind: 'transfer',
      tr: { amount: m.tr.amount, note: m.tr.note, received: true, receivedAt: Date.now(), receiptOf: 'peer' },
    };
    setMsgs((prev) => [
      // 原卡也标记 receiptOf='peer'（我收的款）：打开原卡详情显示「你已收款」而非「XX已收款」
      ...prev.map((x) => (x.id === id && x.tr ? { ...x, tr: { ...x.tr, received: true, receivedAt: Date.now(), receiptOf: 'peer' as const } } : x)),
      receipt,
    ]);
    setReceiveId(null);
    setDetailId(id);
    onToast(`已收款 ¥${fmtMoney(m.tr.amount)}`);
  };

  /** 原生相机/相册选到的图片（需求2）：只读图入输入框下方预览条，不上屏也不触发 AI；
   *  点主发送按钮/输入框回车才真正发出（可与输入框文字一起发送，组合发送见 send）。压缩 dataURL，累计最多 9 张 */
  const stageImageFiles = async (files: FileList) => {
    const staged: PhotoStackItem[] = [];
    for (const f of Array.from(files).slice(0, Math.max(0, 9 - pendingImgs.length))) {
      try {
        const d = await readImageFile(f);
        staged.push({ id: uid(), src: d });
      } catch {
        onToast('图片读取失败');
      }
    }
    if (pendingImgs.length >= 9) onToast('一次最多发 9 张图片');
    if (staged.length > 0) setPendingImgs((prev) => [...prev, ...staged].slice(0, 9));
  };

  /** 发送位置卡片消息（内置地点 / 自定义位置；经纬度随消息落盘供 AI 感知“用户在哪”）。
   *  审计 #36：与表情消息同口径触发 AI 回合（此前只落盘不触发，AI 对位置消息永远无回应） */
  const sendLocation = (name: string, address: string, coords?: { lat?: number; lng?: number }) => {
    // 40-a 拉黑拦截：被角色拉黑（byChar）后位置也发不出
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    setPlusOpen(false);
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'location', loc: { name, address, lat: coords?.lat, lng: coords?.lng } };
    setMsgs((prev) => [...prev, msg]);
    setCompose(null);
    if (peer.id === me.id) return;
    // #35 排队口径（与 sendSticker 一致）：对方正在回复（流式/连发投递）时入列，这轮结束后自动补跑
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      markDeliverBoundary(sessionKey, msg.id);
      wxQueueAdd(peer.id);
      onToast('位置已发出，对方回完这轮就聊');
      return;
    }
    runAiTurnRef.current?.(null, [msg]);
  };

  /** 发送表情消息（表情面板点选；AI 通过 stk.meaning 理解表情含义并据此回复）。
   *  #35：对方正在回复（流式/连发投递）时与文字发送同一口径——消息入列并排队补跑，
   *  不再直接开新回合（旧回复尾巴会漏出上下文 + 表情气泡在流中会被回滚消失） */
  const sendSticker = (s: Sticker) => {
    setStickerOpen(false);
    // 40-a 拉黑拦截：被角色拉黑（byChar）后表情也发不出
    if (loadBlock('wx', peer.id).byChar) {
      onToast('对方已将你拉黑，无法发送');
      return;
    }
    // 发送提示音（表情也走「发送消息」分类）
    playNotifySound('send');
    const msg: WxMsg = { id: uid(), role: 'me', content: '', time: Date.now(), kind: 'sticker', stk: { url: s.url, meaning: s.meaning }, unread: true };
    if (peer.id === me.id) {
      setMsgs((prev) => [...markPeerRead(prev), msg]);
      return;
    }
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) {
      setMsgs((prev) => [...markPeerRead(prev), msg]);
      markDeliverBoundary(sessionKey, msg.id);
      wxQueueAdd(peer.id);
      onToast('表情已发出，对方回完这轮就聊');
      return;
    }
    void runAiTurn(msg);
  };

  /** 内置表情插入输入框（不直接发送）：真实表情图插到光标处，可与文字混排一起发送（真机微信交互） */
  const insertBuiltinEmoji = (s: Sticker) => {
    richInputRef.current?.insertEmoji(s.meaning, s.url);
  };

  /** 打开亲属卡详情（我发的卡由 AI 用动作标记决定收下/拒收，这里只看详情） */
  const openFamilyDetail = (id: string) => {
    setDetailId(id);
  };

  /** 领取好友发来的亲属卡：claimed=true + 存入「我收到的亲属卡」（发红包/转账可用它支付）。
   *  #22：入表按「同一条卡消息」幂等（卡消息 id 唯一），同一联系人多张卡各自独立成卡、
   *  同名不同人也不再串卡——旧实现按 fromName 查重，同一联系人第二张卡会被静默吞掉；
   *  msgId 随卡记录，钱包解除时可精确反查对应聊天卡片。可用额度按赠卡人聚合，见 wxFcGroupOf */
  const claimFamily = (id: string) => {
    const m = msgs.find((x) => x.id === id);
    if (!m?.fam || m.fam.claimed) return;
    const now = Date.now();
    // 领取提示行（第七轮反馈：此前领取后无任何聊天内提示，只有 toast）——与红包领取同款居中通知行
    const notice: WxMsg = { id: uid(), role: 'peer', content: '', time: now, kind: 'notice', notice: { icon: 'fam', pre: `你收下了${peer.name}的`, accent: '亲属卡' } };
    setMsgs((prev) => [
      ...prev.map((x) => (x.id === id && x.fam ? { ...x, fam: { ...x.fam, claimed: true, claimedAt: now } } : x)),
      notice,
    ]);
    const list = loadFamilyCardsIn();
    if (!list.some((f) => f.msgId === m.id)) {
      saveFamilyCardsIn([
        ...list,
        {
          id: `fcin-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          friendId: peer.id,
          fromName: peer.name,
          fromAvatar: peer.avatar,
          relation: m.fam.relation,
          monthlyLimit: m.fam.monthlyLimit,
          used: 0,
          msgId: m.id,
          createdAt: now,
        },
      ]);
    }
    onToast('已领取，发红包/转账时可用它支付');
  };

  const handlePlusAction = (a: PlusAction) => {
    if (a === 'redpacket') {
      setPlusOpen(false);
      setStickerOpen(false);
      setCompose('redpacket');
      return;
    }
    if (a === 'transfer') {
      setPlusOpen(false);
      setCompose('transfer');
      return;
    }
    if (a === 'camera') {
      // 直接调用手机原生相机（input capture 调起后置摄像头），不再使用自建取景页
      setPlusOpen(false);
      setStickerOpen(false);
      cameraInputRef.current?.click();
      return;
    }
    if (a === 'image') {
      // 直接调用手机原生相册（系统图片选择器，可多选），不再使用自建相册页
      setPlusOpen(false);
      setStickerOpen(false);
      photoInputRef.current?.click();
      return;
    }
    if (a === 'location') {
      setPlusOpen(false);
      setCompose('location');
      return;
    }
    if (a === 'voicecall') {
      setPlusOpen(false);
      setStickerOpen(false);
      openVoiceCall('out');
      return;
    }
    if (a === 'videocall') {
      // Task 22 视频通话：加号面板视频入口接通（openVoiceCall 带 media:'video'，全局层渲染视频通话页）
      setPlusOpen(false);
      setStickerOpen(false);
      openVoiceCall('out', { media: 'video' });
      return;
    }
    if (a === 'offline') {
      // 线下模式（约会）：原「收藏」占位改为线下入口，与 QQ/信息共用同一见面页
      setPlusOpen(false);
      setStickerOpen(false);
      setOfflineOpen(true);
      return;
    }
    if (a === 'textcard') {
      // 文字图片（Task 13 卡片版，无生图依赖）：AI 按人设+聊天记录代笔或用户代写，以卡片消息发到聊天
      setPlusOpen(false);
      setStickerOpen(false);
      setCardError('');
      setCompose('textcard');
      return;
    }
    if (a === 'together') {
      // 一起听（第二十四轮）：选一首歌，以邀请卡发进聊天，AI 接受后双方发同意卡并开始一起听
      setPlusOpen(false);
      setStickerOpen(false);
      if (peer.kind !== 'char') {
        onToast('只有 AI 好友可以一起听');
        return;
      }
      setTgPickOpen(true);
      return;
    }
    if (a === 'gift') {
      // 礼物（第 20 轮，替代原「快递」入口）：选一份礼物，以蓝金星空礼物卡发进当前聊天
      setPlusOpen(false);
      setStickerOpen(false);
      setCompose('gift');
      return;
    }
    const label: Record<string, string> = {};
    onToast(`${label[a] ?? '该功能'}暂未开放`);
  };

  /** 输入框上方快捷功能条（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面，
   *  点一下直接触发（与点面板里那一项等效）；未添加 = 不显示；「+」面板本身不受影响。
   *  第五十八轮：图标跟随主题——古早 = RtPlus* 实心剪影（与加号面板同语言），
   *  默认/液态 = 现代线稿（液态在 lg-chip 玻璃胶囊内） */
  const quickItems: QuickBarItem[] = resolveQuickKeys('wx', chatDecorWx.quickKeys)
    .map((k): QuickBarItem | null => {
      const meta = WX_QUICK_META[k];
      if (!meta) return null;
      return { key: k, label: meta.label, icon: retro ? meta.retroIcon : meta.icon, onClick: () => handlePlusAction(k as PlusAction) };
    })
    .filter((x): x is QuickBarItem => x !== null);

  // ---- 聊天设置：置顶 / 免打扰 / 聊天背景 / 查找聊天记录 ----

  const handlePickBgColor = useCallback(
    (c: string) => {
      wxChatFlagsStore.update(peer.id, { bgMode: 'color', bgColor: c, bgV: Date.now() });
    },
    [peer.id]
  );

  const handleResetBg = useCallback(() => {
    void removeChatBgImage('wx', peer.id).catch(() => undefined);
    wxChatFlagsStore.update(peer.id, { bgMode: 'default', bgV: Date.now() });
  }, [peer.id]);

  const handleUploadBg = useCallback(
    async (file: File) => {
      setUploadingBg(true);
      try {
        const data = await readImageFile(file, 1280);
        await setChatBgImage('wx', peer.id, data);
        wxChatFlagsStore.update(peer.id, { bgMode: 'image', bgV: Date.now() });
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
              : m.kind === 'redpacket' && m.rp
                ? `[红包] ${m.rp.blessing}`
                : m.kind === 'transfer' && m.tr
                  ? `[转账] ${m.tr.note}`
                  : m.kind === 'family'
                    ? '[亲属卡]'
                    : m.kind === 'location' && m.loc
                      ? `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`
                      : m.kind === 'notice' && m.notice
                        ? `${m.notice.pre}${m.notice.accent}`
                        : m.content,
          time: m.time,
        }))
        .filter((it) => it.text.trim().length > 0),
    [msgs]
  );

  /** 搜索结果定位：关闭搜索页与设置页 → 滚动到消息并短暂高亮 */
  const jumpToMessage = useCallback((id: string) => {
    setSearchOpen(false);
    setSettingsOpen(false);
    setHighlightId(id);
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000);
  }, []);

  // ---- 照片堆叠分组（需求3）：连续照片 ≥4 张（同发送者 + 间隔 ≤5 分钟，与时间分隔行同口径）折叠成堆叠卡片 ----
  const photoSpans = selectMode
    ? [] // 多选转发模式全部逐条平铺，便于逐条勾选
    : findPhotoStackSpans(
        msgs.length,
        (i) => {
          const m = msgs[i];
          return m.kind === 'image' && !!m.img?.src && !m.recalled;
        },
        (a, b) => msgs[a].role === msgs[b].role && msgs[b].time - msgs[a].time <= 5 * 60_000,
      );
  /** 堆叠头下标 → 该组全部照片；stackMemberIdx = 组内成员下标 → 头部下标（折叠态整行跳过并入堆叠卡，展开后恢复平铺，与群聊同口径） */
  const stackHead = new Map<number, PhotoStackItem[]>();
  const stackMemberIdx = new Map<number, number>();
  for (const [a, b] of photoSpans) {
    stackHead.set(a, msgs.slice(a, b + 1).map((m) => ({ id: m.id, src: m.img!.src })));
    for (let k = a + 1; k <= b; k++) stackMemberIdx.set(k, a);
  }

  return (
    <div
      ref={pageRef}
      data-liquid-theme={liquid ? 'true' : 'false'}
      data-rt-theme={retro ? 'true' : 'false'}
      data-chat-css={wxCssKey}
      className={
        liquid
          ? 'lg-root absolute inset-0 z-20 flex h-full w-full flex-col text-black dark:text-white'
          : retro
          ? 'rt-chat-bg absolute inset-0 z-20 flex h-full w-full flex-col text-black dark:text-white'
          : 'absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white'
      }
    >
      {/* 自定义 CSS（聊天作用域，按联系人隔离）：只影响本联系人的聊天页；前缀
          [data-phone-shell] [data-chat-css="wx:联系人ID"] 比全局多一级属性 → 特异性压制全局 */}
      {chatCustomCss?.trim() ? <style>{scopeCss(chatCustomCss, chatCssScopeSelector(wxCssKey))}</style> : null}
      {/* 聊天背景层（聊天设置页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 第四十七轮（用户指定「顶部会逐渐模糊」）：液态主题顶部渐变磨砂带——
          消息滚入顶栏下方被渐进模糊（顶缘全模糊 → 96px 处透明；不拦截交互，顶栏铭件浮于其上） */}
      {liquid && <div aria-hidden="true" data-testid="wx-chat-top-blur" className="lg-top-blur pointer-events-none absolute inset-x-0 top-0 z-[15] h-[96px]" />}
      {/* 顶栏：与消息区/底部输入栏同色（微信灰，非白）；多选模式下变为「取消 + 已选计数」操作栏
          第三十四轮：pt-54→pt-48（顶部再往上移一点，仍避开 54px 状态栏内容区不重叠）
          第三十六轮：pt-48→pt-42（再上移 6px，灵动岛/状态栏下方留白更紧凑；群聊会话页同步） */}
      <div
        className={
          'wx-topbar ' +
          (liquid
            ? /* 液态（第四十五轮，用户指定）：删背景遮罩模糊带——顶栏完全透明悬浮，
                名字改椭圆形玻璃胶囊包裹（参考图「永恩」同款） */
              'pointer-events-none absolute inset-x-0 top-0 z-20 shrink-0 bg-transparent pt-[42px]'
            : retro
            ? /* 古早（第五十四轮）：深灰安卓顶栏渐变 + 白字（lucide 图标继承 currentColor） */
              'rt-dark relative z-10 shrink-0 pt-[42px] text-white [&_button]:text-white'
            : 'relative z-10 shrink-0 bg-[#EDEDED] pt-[42px] dark:bg-[#111111]')
        }
      >
        {selectMode ? (
          fwdFlow === 'choose' ? (
            /* 转发勾选模式顶栏（对照原生微信多选转发：取消 + 已选择计数 + 搜索） */
            <div className="flex h-11 items-center px-2 [&_button]:pointer-events-auto">
              <button
                type="button"
                data-testid="wx-select-cancel"
                onClick={exitSelect}
                className="flex items-center px-1 text-[16px] active:opacity-50"
              >
                取消
              </button>
              <div className="flex flex-1 items-center justify-center">
                <span data-testid="wx-select-count" className="text-[17px] font-medium">已选择 {selectedIds.length} 条消息</span>
              </div>
              <button
                type="button"
                aria-label="搜索"
                data-testid="wx-fwd-search"
                onClick={() => onToast('搜索转发消息暂未开放')}
                className="flex w-[68px] justify-end px-2 active:opacity-50"
              >
                <Search className="h-[19px] w-[19px]" strokeWidth={2} />
              </button>
            </div>
          ) : (
          <div className="flex h-11 items-center px-2 [&_button]:pointer-events-auto">
            <button
              type="button"
              data-testid="wx-select-cancel"
              onClick={exitSelect}
              className="flex items-center px-1 text-[16px] active:opacity-50"
            >
              取消
            </button>
            <div className="flex flex-1 items-center justify-center">
              <span data-testid="wx-select-count" className="text-[17px] font-medium">已选 {selectedIds.length} 条消息</span>
            </div>
            <div className="w-[68px]" />
          </div>
          )
        ) : (
        <div className="flex h-11 items-center px-2 [&_button]:pointer-events-auto">
          {/* 液态顶栏（第四十五轮，用户指定）：删模糊带后名字改椭圆形玻璃胶囊包裹；返回/更多独立玻璃圆钮 */}
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-chat-back"
            onClick={onBack}
            className={
              liquid
                ? 'lg-chip flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full active:opacity-60'
                : 'flex items-center px-1 active:opacity-50'
            }
          >
            <ChevronLeft className={liquid ? 'h-[22px] w-[22px]' : 'h-7 w-7'} strokeWidth={2} />
          </button>
          {otherUnread > 0 && (
            <span
              data-testid="wx-chat-back-badge"
              aria-label={`${otherUnread} 条未读`}
              className={
                liquid
                  ? 'lg-chip -ml-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-[5px] text-[11px] font-medium leading-none text-black/75 dark:text-white/85'
                  : retro
                  ? '-ml-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-white/20 px-[5px] text-[12px] font-medium leading-none text-white'
                  : '-ml-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-black/[0.08] px-[5px] text-[12px] font-medium leading-none text-black/75 dark:bg-white/[0.16] dark:text-white/85'
              }
            >
              {otherUnread > 99 ? '99+' : otherUnread}
            </span>
          )}
          <div className="flex min-w-0 flex-1 items-center justify-center" data-testid="wx-chat-peer-name">
            {liquid && liquidSkinWx.headerMode === 'dualName' ? (
              /* 液态·双头像+名字（本轮用户指定）：我的名字也显示——名字在各自头像下面（两列布局）；
                 中间可插自定义文字；正在输入时中间显示「正在输入…」 */
              <span
                data-testid="wx-chat-liquid-header"
                className="lg-title flex min-w-0 items-center gap-2 rounded-full py-[4px] pl-[7px] pr-[11px]"
              >
                <span className="flex w-[52px] shrink-0 flex-col items-center gap-[2px]">
                  <WxAvatar src={peer.avatar} alt={peer.name} size={24} shape="circle" />
                  <span className="max-w-[52px] truncate text-[9.5px] font-medium leading-none text-black/65 dark:text-white/70">
                    {peer.name}
                  </span>
                </span>
                {(streaming || delivering || liquidSkinWx.headerMiddleText.trim()) && (
                  <span className="max-w-[86px] truncate text-[12px] font-semibold text-black/70 dark:text-white/75">
                    {streaming || delivering ? '正在输入…' : liquidSkinWx.headerMiddleText.trim()}
                  </span>
                )}
                <span className="flex w-[52px] shrink-0 flex-col items-center gap-[2px]">
                  <WxAvatar src={me.avatar} alt={me.name} size={24} shape="circle" />
                  <span className="max-w-[52px] truncate text-[9.5px] font-medium leading-none text-black/65 dark:text-white/70">
                    {me.name}
                  </span>
                </span>
                {flags.muted === true && (
                  <BellOff
                    className={`h-4 w-4 shrink-0 ${retro ? 'text-white/60' : 'text-black/30 dark:text-white/30'}`}
                    strokeWidth={2}
                    aria-label="消息免打扰"
                  />
                )}
              </span>
            ) : liquid && liquidSkinWx.headerMode !== 'text' ? (
              /* 液态玻璃皮肤：头像+名字（名字可关）/ 双头像+中间文字；
                 群聊（peer 侧另有页面）不走此分支；selfChat 也能用（两个头像都是自己） */
              <span
                data-testid="wx-chat-liquid-header"
                className="lg-title flex min-w-0 items-center gap-1.5 truncate rounded-full py-[4px] pl-[5px] pr-[12px] text-[15px] font-semibold"
              >
                <WxAvatar src={peer.avatar} alt={peer.name} size={26} shape="circle" />
                {(liquidSkinWx.headerMode === 'dual' || liquidSkinWx.headerMode === 'dualName') && (
                  <>
                    {liquidSkinWx.headerMiddleText.trim() && (
                      <span className="max-w-[86px] truncate text-[13px] font-semibold text-black/80 dark:text-white/85">
                        {liquidSkinWx.headerMiddleText.trim()}
                      </span>
                    )}
                    <WxAvatar src={me.avatar} alt={me.name} size={26} shape="circle" />
                  </>
                )}
                {liquidSkinWx.headerMode === 'avatarName' && liquidSkinWx.headerShowName ? (
                  <span className="truncate">{streaming || delivering ? '正在输入中…' : peer.name}</span>
                ) : null}
                {flags.muted === true && (
                  <BellOff
                    className={`h-4 w-4 shrink-0 ${retro ? 'text-white/60' : 'text-black/30 dark:text-white/30'}`}
                    strokeWidth={2}
                    aria-label="消息免打扰"
                  />
                )}
              </span>
            ) : (
              <span
                className={
                  liquid
                    ? /* 液态（第四十五轮，参考图）：名字椭圆形玻璃胶囊包裹（黑色粗体字） */
                      'lg-title flex min-w-0 items-center gap-1.5 truncate rounded-full px-[16px] py-[6px] text-[16px] font-semibold'
                    : 'flex items-center gap-1.5 truncate text-[17px] font-medium'
                }
              >
                <span className="truncate">{streaming || delivering ? '正在输入中…' : peer.name}</span>
                {flags.muted === true && (
                  <BellOff
                    className={`h-4 w-4 shrink-0 ${retro ? 'text-white/60' : 'text-black/30 dark:text-white/30'}`}
                    strokeWidth={2}
                    aria-label="消息免打扰"
                  />
                )}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="聊天信息"
            data-testid="wx-chat-settings-entry"
            className={
              liquid
                ? 'lg-chip flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full active:opacity-60'
                : 'px-2 active:opacity-50'
            }
            onClick={() => setSettingsOpen(true)}
          >
            <EllipsisGlyph />
          </button>
        </div>
        )}
      </div>

      {/* 消息列表：浅灰背景（同微信），自定义聊天背景时透出背景层。
          wx-chat-list：消息区锚点（聊天设置 › 自定义CSS 示例主题可改内边距/字体） */}
      <div ref={scrollRef} className={`wx-chat-list no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-3 ${liquid ? 'pb-3 pt-[96px]' : 'py-3'}`}>
        {msgs.length === 0 && (
          <p className="mt-16 text-center text-[13px] text-black/35 dark:text-white/35">
            {selfChat ? '给自己发条消息吧' : `和 ${peer.name} 打个招呼吧`}
          </p>
        )}
        {msgs.map((m, i) => {
          // 错误占位消息（旧版失败落库文案）：新版失败改由触发消息上的红色 ! 徽标表达，不再渲染占位文字行
          if (m.error) return null;
          // 照片堆叠成员行：折叠态已并入堆叠卡片渲染，整行跳过（组内 joined 保证无时间分隔行穿插）；
          // 该组被「展开」后（头部 id 记入 expandedStacks）成员恢复逐条平铺（与群聊 wx-group 同口径）
          const memberHeadIdx = stackMemberIdx.get(i);
          if (memberHeadIdx !== undefined && !expandedStacks.has(msgs[memberHeadIdx]?.id ?? '')) return null;
          // 动作描写视图（仅对方 AI 的纯文本消息；我的消息/其他类型/无星号内容 → null 走原路径）
          const actView = !m.recalled && m.role === 'peer' && (!m.kind || m.kind === 'text') ? actionDescViewOf(m.content, actionDescOn) : null;
          const actLines = actView ? [...actView.before, ...actView.after] : [];
          // 动作描写开启时气泡正文（剥离描写并整理空白；actView 为 null 时保持原文）
          const actBody = actView && actView.text ? actView.text : null;
          const bubbleContent = actBody ?? m.content;
          // 第十七轮聊天气泡装扮：按消息序号计算本条气泡视觉（七彩=序号递增循环取色；原生默认时零覆盖直通）
          const bvis = bubbleVisual(m.role === 'me' ? 'mine' : 'theirs', bubbleStyle, i, 'wx');
          // 空白气泡防御：对方纯文本消息清洗后没有任何可见内容（历史脏数据/空段/纯不可见字符）
          // → 整行不渲染气泡（与「整条只有动作描写」同分支：多选模式保留勾选圈行，其余渲染为空）
          const bubbleBlank =
            m.role === 'peer' && !m.recalled && (!m.kind || m.kind === 'text') && !cleanBubbleText(bubbleContent);
          const lineOnly = (actView && !actView.text) || bubbleBlank;
          return (
          // Task 40：key 从消息行移到 Fragment——消息行之后可条件渲染失败灰字提示行（Fragment 不产生 DOM，
          // 滚动定位/highlight 等依赖 data-mid 的逻辑不受影响）
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
            className={`rounded-[10px] transition-colors duration-500 ${
              highlightId === m.id ? 'bg-[#07C160]/15 ring-1 ring-[#07C160]/50' : ''
            }`}
          >
            {/* 时间分隔（截图样式：居中半透明胶囊；液态主题 = 参考图纯文字浮层）；
                显示设置 › 时间开启后每条消息单独显示时间，此间隔条退场（冗余） */}
            {(i === 0 || m.time - msgs[i - 1].time > 5 * 60_000) && !chatDisplay.timeEnabled && (
              <div className="py-2 text-center">
                {/* wx-time-chip：时间胶囊锚点（聊天设置 › 自定义CSS 示例主题可改它） */}
                <span
                  className={
                    liquid
                      ? 'wx-time-chip text-[11.5px] font-medium leading-[1.4] text-black/45 dark:text-white/50'
                      : 'wx-time-chip inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60'
                  }
                >
                  {fmtChatTime(m.time)}
                </span>
              </div>
            )}
            {/* 深度思考思维链卡片：消息行级别（时间分隔下方、气泡行上方，紧凑小卡片与头像左缘对齐）——
                对方任意消息类型（文本/语音/卡片）都可携带思考过程；开关关闭时直接丢弃不渲染 */}
            {m.role === 'peer' && deepThinkOn && m.thinking && !m.recalled ? (
              <div className="pl-0 pr-1 pb-[2px]">
                <ThinkCard text={m.thinking} testId={`wx-think-${m.id}`} />
              </div>
            ) : null}
            {lineOnly ? (
              /* 整条只有动作描写（或关闭态过滤后无正文 / 空白脏数据）：渲染为居中灰字行；多选模式给勾选圈行保证可勾选 */
              selectMode && isSelectable(m) ? (
                <div className={`flex items-center gap-2 py-1.5 ${m.role === 'me' ? 'flex-row-reverse' : ''}`}>
                  <span
                    aria-hidden="true"
                    data-testid={`wx-select-${m.id}`}
                    className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border ${
                      fwdFlow === 'choose' && m.role === 'me' ? 'order-last' : ''
                    } ${selectedIds.includes(m.id) ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-black/25 dark:border-white/35'}`}
                  >
                    {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    {actLines.map((a, k) => (
                      <ActionDescLine key={k} text={a} testId={`wx-action-${m.id}-${k}`} />
                    ))}
                  </div>
                </div>
              ) : (
                actLines.map((a, k) => <ActionDescLine key={k} text={a} testId={`wx-action-${m.id}-${k}`} />)
              )
            ) : (
              <>
                {actView?.before.map((a, k) => (
                  <ActionDescLine key={`b${k}`} text={a} testId={`wx-action-${m.id}-${k}`} />
                ))}
                {m.recalled ? (
              /* 已撤回：居中半透明胶囊（你撤回了一条消息 / 对方撤回了一条消息） */
              <div data-testid="wx-recall-row" className="py-1.5 text-center">
                <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                  {m.role === 'me' ? '你撤回了一条消息' : '对方撤回了一条消息'}
                </span>
              </div>
            ) : m.kind === 'notice' && m.notice ? (
              <WxNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
            ) : m.kind === 'sys' && m.sys ? (
              /* 系统提示行（拉黑/解除拉黑等状态变更）：居中半透明胶囊，与撤回行同款 */
              <div data-testid="wx-sys-row" className="py-1.5 text-center">
                <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                  {m.sys.text}
                </span>
              </div>
            ) : m.kind === 'blockreq' && m.blkreq ? (
              /* 申请解除拉黑卡片：40-a 双向——角色发起（左侧，头像在左，用户点同意/拒绝）/
                 用户发起（右侧机主侧，角色用 [同意/拒绝解除拉黑] 标记决策，仅展示状态不可点） */
              m.blkreq.from === 'user' ? (
                <div className="flex items-start justify-end gap-2 py-1.5">
                  <WxBlockReqCard
                    name={me.name}
                    avatar={me.avatar}
                    reason={m.blkreq.reason}
                    status={m.blkreq.status}
                    from="user"
                    onAccept={() => undefined}
                    onReject={() => undefined}
                  />
                  <WxAvatar src={me.avatar} alt={me.name} size={38} />
                </div>
              ) : (
                <div className="flex items-start gap-2 py-1.5">
                  <WxAvatar src={peer.avatar} alt={peer.name} size={38} />
                  <WxBlockReqCard
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
            <div className={`flex items-start py-1.5 ${m.kind === 'image' || m.kind === 'sticker' || m.kind === 'textcard' ? 'gap-[3px]' : 'gap-2'} ${m.role === 'me' ? 'flex-row-reverse' : ''}`}>
              {selectMode && isSelectable(m) && (
                /* 多选模式勾选圈（我的消息在行右侧、对方在行左侧；转发勾选模式全部放左侧，对照原生微信） */
                <span
                  aria-hidden="true"
                  data-testid={`wx-select-${m.id}`}
                  className={`mt-2 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border ${
                    fwdFlow === 'choose' && m.role === 'me' ? 'order-last' : ''
                  } ${
                    selectedIds.includes(m.id) ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-black/25 dark:border-white/35'
                  }`}
                >
                  {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                </span>
              )}
              {m.role === 'me' ? (
                /* Task 30 拍一拍：双击自己的头像 = 拍一拍自己（微信同款彩蛋）；单击无动作。
                    显示设置：外层列容器承载头像 + 头像下方元信息（已读/时间，位置=头像下面时） */
                <div className="flex w-[38px] shrink-0 flex-col items-center">
                  <button
                    type="button"
                    data-testid="wx-me-avatar"
                    aria-label="双击拍一拍自己"
                    className="shrink-0 cursor-pointer"
                    onClick={(e) => onAvatarDoubleTap(e, true)}
                  >
                    <WxAvatar src={me.avatar} alt={me.name} size={38} shape={chatDisplay.avatarShape} />
                  </button>
                  <WxMetaUnderAvatar m={m} cfg={chatDisplay} />
                </div>
              ) : (
                /* 单击对方头像：弹出角色状态卡（延迟 260ms 等待可能的双击）；双击 = 拍一拍（取消状态卡）。
                   （多选模式下点击头像仍走勾选，由行级 onClickCapture 拦截） */
                <div className="flex w-[38px] shrink-0 flex-col items-center">
                  <button
                    type="button"
                    data-testid="wx-peer-avatar"
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
                    <WxAvatar src={peer.avatar} alt={peer.name} size={38} shape={chatDisplay.avatarShape} />
                  </button>
                  <WxMetaUnderAvatar m={m} cfg={chatDisplay} />
                </div>
              )}
              {m.kind === 'song' && m.song ? (
                /* 歌曲卡片（Task 68 音乐 × AI）：封面+歌名+歌手+播放按钮，点击直接播放；
                   行容器自带 bubblePress 长按（复制/删除/转发走通用菜单，内容快照见 quoteContentOf） */
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
              ) : m.kind === 'redpacket' && m.rp ? (
                <RpBubble
                  blessing={m.rp.blessing}
                  sub={m.rp.status === 'returned' ? '已退回' : m.rp.status === 'rejected' ? '已拒收' : m.rp.opened ? '已领取' : '待领取'}
                  settled={m.rp.opened || Boolean(m.rp.status)}
                  fromMe={m.role === 'me'}
                  onClick={() => {
                    // 自己发的红包不能领：直接进详情；已到终态进详情；对方发的未处理弹「開」
                    if (m.rp?.opened || m.rp?.status) setDetailId(m.id);
                    else if (m.role === 'me') openRedPacketDetail(m.id);
                    else setOpeningId(m.id);
                  }}
                />
              ) : m.kind === 'transfer' && m.tr ? (
                <TrBubble
                  amount={m.tr.amount}
                  note={m.tr.note}
                  settled={m.tr.received === true || Boolean(m.tr.status)}
                  status={
                    m.tr.status === 'returned'
                      ? '已退还'
                      : m.tr.status === 'rejected'
                        ? '已拒收'
                        : m.tr.received
                          ? m.tr.receiptOf
                            ? // 收款凭据卡（ receiptOf='peer'=我收对方的款 / 'me'=对方收我的款）：都显示「已收款」——
                              // 用户反馈：AI 转给我的钱，我收款后的凭据卡不能显示「已转入对方零钱」（方向反了）
                              '已收款'
                            : m.role === 'me'
                              ? '已转入对方零钱'
                              : '已收款'
                          : m.role === 'me'
                            ? '待对方收款'
                            : '向你转账'
                  }
                  received={m.tr.received === true}
                  refunded={m.tr.status === 'returned'}
                  fromMe={m.role === 'me'}
                  onClick={() =>
                    // 对方发来的未收款且未退还的转账 → 收款页（时钟+待你收款+收款）；其余 → 交易详情
                    m.role === 'peer' && m.tr?.received !== true && !m.tr?.status ? setReceiveId(m.id) : openTransferDetail(m.id)
                  }
                />
              ) : m.kind === 'family' && m.fam ? (
                <FamilyBubble
                  title={`给${m.role === 'me' ? peer.name : me.name}的亲属卡`}
                  sub={m.fam.rejected ? '已退回' : m.fam.claimed ? (m.role === 'me' ? '对方已领取' : '已领取') : m.role === 'me' ? '待对方领取' : '待你领取'}
                  settled={m.fam.claimed === true || m.fam.rejected === true}
                  fromMe={m.role === 'me'}
                  onClick={() => (m.role === 'me' ? openFamilyDetail(m.id) : setDetailId(m.id))}
                />
              ) : m.kind === 'mtpay' && m.mtpay ? (
                /* 美团找人代付卡片（美团收银台发请求卡；好友代付后完成卡回聊天）；点卡进代付详情 */
                <div {...bubblePress}>
                  <MtPayBubble pid={m.mtpay.pid} role={m.mtpay.role} onClick={() => setProxyPid(m.mtpay!.pid)} />
                </div>
              ) : m.kind === 'mtshare' && m.mtshare ? (
                /* 美团订单分享动态卡片（订单详情右上角分享；状态时间线实时跟订单走；AI 请客卡 role peer 箭头指左） */
                <div {...bubblePress}>
                  <MtShareBubble sid={m.mtshare.sid} side={m.role === 'me' ? 'right' : 'left'} />
                </div>
              ) : m.kind === 'tbpay' && m.tbpay ? (
                /* 淘宝找人代付卡片（淘宝收银台发请求卡；好友 AI 代付后完成卡回聊天；AI 请机主代付的请求卡箭头指左）；点卡进代付详情 */
                <div {...bubblePress}>
                  <TbPayBubble pid={m.tbpay.pid} role={m.tbpay.role} side={m.role === 'me' ? 'right' : 'left'} onClick={() => setTbProxyPid(m.tbpay!.pid)} />
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
                /* 美团 AI 代点外卖草稿卡（AI [帮点外卖] 生成；机主确认后创建待支付订单并跳收银台） */
                <div {...bubblePress}>
                  <MtDraftBubble did={m.mtdraft.did} onToast={onToast} />
                </div>
              ) : m.kind === 'giftcard' && m.gift ? (
                /* 礼物卡片（加号面板「礼物」发出，第 20 轮）：蓝金星空卡，点卡开收礼弹窗（收下后按钮置已收下） */
                <div {...bubblePress}>
                  <WxGiftCardBubble gift={m.gift} side={m.role === 'me' ? 'right' : 'left'} onClick={() => setGiftViewId(m.id)} />
                </div>
              ) : m.kind === 'image' && m.img && stackHead.has(i) && !expandedStacks.has(m.id) ? (
                /* 照片堆叠卡片（连续 ≥4 张的折叠态）：左「展开 N」胶囊 + 主图右侧扇形露边；左滑下一张/右滑上一张、点击开大图。
                   不套 {...bubblePress} 长按——展开后逐条平铺的每张照片仍带长按菜单 */
                <WxPhotoStack
                  items={stackHead.get(i)!}
                  onOpenAt={(k) => {
                    const items = stackHead.get(i);
                    if (items) setViewer({ urls: items.map((p) => p.src), index: k });
                  }}
                  onExpand={() => setExpandedStacks((prev) => new Set(prev).add(m.id))}
                />
              ) : m.kind === 'image' && m.img && stackHead.has(i) && expandedStacks.has(m.id) ? (
                /* 照片堆叠展开态的头图（第一张）：左侧「收起」胶囊（点回堆叠折叠态）+ 原图（保留长按菜单与大图）。
                   与折叠态的「展开 N」同位（图左侧垂直居中），展开/收起互换不跳版 */
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    data-testid="wx-photo-stack-collapse"
                    aria-label="收起照片堆叠"
                    onClick={() =>
                      setExpandedStacks((prev) => {
                        const next = new Set(prev);
                        next.delete(m.id);
                        return next;
                      })
                    }
                    className="shrink-0 rounded-full bg-black/[0.055] px-3 py-[7px] text-[13.5px] leading-none text-black/55 backdrop-blur-sm transition-opacity active:opacity-60 dark:bg-white/[0.12] dark:text-white/65"
                  >
                    收起
                  </button>
                  <div {...bubblePress}>
                    <ImageMsgBubble
                      src={m.img.src}
                      onClick={() => {
                        // 展开态头图点击大图：带整组图片（可左右滑动切换），与折叠态堆叠卡点击行为一致
                        const items = stackHead.get(i);
                        if (items) setViewer({ urls: items.map((p) => p.src), index: 0 });
                      }}
                    />
                  </div>
                </div>
              ) : m.kind === 'image' && m.img ? (
                /* 显示设置：图片/语音/表情列容器挂气泡下元信息（与文本分支同构） */
                <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${m.role === 'me' ? 'items-end' : 'items-start'}`}>
                  <div className="min-w-0">
                    <ImageMsgBubble src={m.img.src} onClick={() => {
                      const src = m.img?.src;
                      if (src) setViewer({ urls: [src], index: 0 }); // 空串保护：无 src 不打开
                    }} />
                  </div>
                  <WxMetaUnderBubble m={m} cfg={chatDisplay} />
                </div>
              ) : m.kind === 'textcard' && m.card ? (
                /* 文字图片卡片（Task 14：以「我」的身份发出/历史角色卡兼容）；
                   长按菜单与图片一致（复制/删除/多选/撤回/转发/收藏，无编辑无引用）；点击弹操作面板（生成图片/复制文字） */
                <div {...bubblePress}>
                  <TextCardBubble
                    text={m.card.text}
                    signedBy={m.role === 'me' ? me.name : peer.name}
                    variant="wx"
                    onClick={() => {
                      if (!selectMode) setCardActionId(m.id);
                    }}
                  />
                </div>
              ) : m.kind === 'voice' && m.voice ? (
                /* 语音消息：播放/暂停 + 波形 + 时长；长按菜单：转文字/复制/…；转写结果显示在气泡下方
                   （第十八轮：语音气泡跟随装扮 —— 纯色/七彩原生尾巴随色，毛玻璃/液态胶囊无尾巴）。
                   第四十七轮（用户指定）：包裹层限宽 calc(100%-92px)（与文本气泡同口径）——
                   转文字长面板不再撑满整行、不越过对侧头像区；
                   AI 回复带引用时同样在语音气泡下方渲染引用胶囊（语音升级不吞引用块） */
                <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${m.role === 'me' ? 'items-end' : 'items-start'}`}>
                  <div {...bubblePress} className="max-w-full">
                    <VoiceMsgBubble
                      msgId={m.id}
                      voice={m.voice}
                      side={m.role}
                      theme="wx"
                      bubbleClassName={bvis.override ? bvis.className : undefined}
                      decorated={bvis.override}
                      hideTail={bvis.override && bvis.tail === 'none'}
                      style={bvis.override ? bvis.style : undefined}
                      decorApp="wx"
                      msgIndex={i}
                    />
                  </div>
                  {m.quote && <WxQuoteBlock quote={m.quote} srcMsg={m.quote.id ? msgs.find((x) => x.id === m.quote?.id) ?? null : null} />}
                  <WxMetaUnderBubble m={m} cfg={chatDisplay} />
                </div>
              ) : m.kind === 'call' && m.call ? (
                /* 语音通话卡片：微信配色电话卡；整卡可点回拨（用户需求：点击通话卡片就能回拨电话）；长按菜单复制/删除等默认项。
                   宽度约束挂在本包装层（卡片内 max-w-full）：挂卡片自身会相对本层（随内容收缩）解析成循环约束，气泡被压窄文字溢出 */
                <div {...bubblePress} className="max-w-[calc(100%-92px)]">
                  <CallCardBubble
                    variant="wx"
                    state={m.call.state}
                    duration={m.call.duration}
                    direction={m.call.direction ?? (m.role === 'me' ? 'out' : 'in')}
                    media={m.call.media ?? 'voice'}
                    onRedial={() => openVoiceCall('out', { media: m.call?.media ?? 'voice' })}
                  />
                </div>
              ) : m.kind === 'location' && m.loc ? (
                <div {...bubblePress}>
                  <LocBubble name={m.loc.name} address={m.loc.address} onClick={() => setLocViewId(m.id)} />
                </div>
              ) : m.kind === 'sticker' && m.stk ? (
                <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${m.role === 'me' ? 'items-end' : 'items-start'}`}>
                  <div className="min-w-0">
                    <StickerMsgBubble
                      src={m.stk.url}
                      meaning={m.stk.meaning}
                      me={m.role === 'me'}
                      onClick={() => {
                        const url = m.stk?.url;
                        if (url) setViewer({ urls: [url], index: 0 }); // 空串保护：无 url 不打开
                        if (m.stk?.meaning) onToast(`表情：${m.stk.meaning}`);
                      }}
                    />
                  </div>
                  <WxMetaUnderBubble m={m} cfg={chatDisplay} />
                </div>
              ) : m.kind === 'forward' && m.fwd?.merged ? (
                /* 合并转发「聊天记录」卡片（原生微信同款：两面都白底）：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情 */
                <div
                  {...bubblePress}
                  data-testid="wx-forward-bubble"
                  onClick={() => {
                    if (!selectMode) setFwdDetailId(m.id);
                  }}
                  className="relative w-fit max-w-[calc(100%-92px)] select-none rounded-[5px] bg-white px-3 py-2 text-black dark:bg-[#1E1E1E] dark:text-white"
                >
                  <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                  <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-black/55 dark:text-white/60">
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
                  data-testid="wx-forward-bubble"
                  className={`relative w-fit max-w-[calc(100%-92px)] select-none rounded-[5px] px-3 py-2 ${
                    m.role === 'me'
                      ? 'bg-[#95EC69] text-black dark:bg-[#3EB575]'
                      : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                  }`}
                >
                  <div className="line-clamp-8 whitespace-pre-wrap break-words border-l-2 border-black/25 pl-2 text-[14px] leading-[1.4]">
                    {m.quote && (
                      <span className="mb-0.5 block text-[12px] text-black/50 dark:text-black/55">
                        {m.quote.name}：{m.quote.content}
                      </span>
                    )}
                    {m.content}
                  </div>
                </div>
              ) : m.kind === 'groupcard' && m.gcard ? (
                /* 群聊邀请卡片（AI 主动建群/拉人）：pending 出接受/拒绝；点「接受邀请」才进群，卡片本体不可点 */
                <div {...bubblePress}>
                  <WxGroupCardBubble
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
                    testidPrefix="wx"
                    onAccept={() => decideCoupleCard(m, true)}
                    onDecline={() => decideCoupleCard(m, false)}
                  />
                </div>
              ) : m.kind === 'pactcard' && m.pactcard ? (
                /* 恋爱协议卡片（第十二轮）：点卡片本体进情侣空间签署界面（导航在气泡组件内） */
                <div {...bubblePress}>
                  <CouplePactBubble data={m.pactcard} mine={m.role === 'me'} testidPrefix="wx" />
                </div>
              ) : m.kind === 'examcard' && m.examcard ? (
                /* 恋爱考试卡片（第十五轮）：点卡片进情侣空间试卷页（导航在气泡组件内） */
                <div {...bubblePress}>
                  <CoupleExamBubble data={m.examcard} mine={m.role === 'me'} testidPrefix="wx" />
                </div>
              ) : m.kind === 'lettercard' && m.lettercard ? (
                /* 情书信封卡片（第十八轮）：点卡片直达情侣空间信件页（导航在气泡组件内） */
                <div {...bubblePress}>
                  <CoupleLetterBubble data={m.lettercard} mine={m.role === 'me'} testidPrefix="wx" />
                </div>
              ) : (
                <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${m.role === 'me' ? 'items-end' : 'items-start'}`}>
                  <div
                    {...bubblePress}
                    className={`relative w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[5px] px-3 py-2 text-[16px] leading-[1.45] ${
                      bvis.override
                        ? bvis.className
                        : m.role === 'me'
                        ? // 第六十九轮：wx-bub-mine/theirs 语义锚点 —— 聊天设置的自定义 CSS
                          // 示例主题靠它们把默认气泡整套换色（装扮泡走 bvis.className 不受影响）
                          'wx-bub-mine bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black'
                        : 'wx-bub-theirs bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                    }`}
                    style={bvis.override ? bvis.style : undefined}
                  >
                    {/* 气泡小尾巴：装扮纯色/七彩 = 微信原生小三角随色（用户指定不变）；
                        QQ 弯钩在 qq.tsx；毛玻璃/液态胶囊无尾巴；无装扮 = 原生绿/白三角。
                        第五十八轮（用户指定「古早小尾巴变成默认气泡样式的」）：古早 = 同款默认
                        小三角，颜色走 tailClass（.rt-tail-*，古早色板深浅自适应）。
                        第五十九轮（用户指定「和默认气泡小尾巴一样大」）：.bub-retro 带 1px 描边，
                        绝对定位以 padding box 为基准 → 古早尾巴外移/上移 1px 补偿描边厚度，
                        露出量与默认气泡尾巴完全一致（默认 3px 露出，古早原来只露 2px 显小） */}
                    {bvis.tail === 'hook' ? (
                      /* 防御分支：微信装扮永不返回 hook（原生小三角），仅类型完备性保留
                         （第二十轮与 qq.tsx 同步：尾巴中心与头像顶端平行） */
                      <BubbleTail side={m.role === 'me' ? 'mine' : 'theirs'} color={bvis.tailColor} top="max(4px, calc(100% - 46.5px))" />
                    ) : bvis.tail === 'native' ? (
                      (() => {
                        /* 古早气泡（含自定义色）都带 .bub-retro 的 1px 描边——绝对定位以
                           padding box 为基准，尾巴统一外移/上移 1px 补偿，露出量与默认一致 */
                        const retro = bvis.override && bvis.className.includes('bub-retro');
                        return (
                          <span
                            aria-hidden="true"
                            className={`absolute h-[8px] w-[8px] rotate-45 ${
                              retro
                                ? `top-[10px] ${m.role === 'me' ? '-right-[4px]' : '-left-[4px]'}${bvis.tailClass ? ` ${bvis.tailClass}` : ''}`
                                : `top-[11px] ${m.role === 'me' ? '-right-[3px]' : '-left-[3px]'} ${
                                    bvis.tailColor
                                      ? ''
                                      : m.role === 'me'
                                      ? // 第六十九轮：wx-bub-tail-* 尾巴锚点 —— 示例主题让小三角跟气泡同色
                                        'wx-bub-tail-mine bg-[#95EC69] dark:bg-[#3EB575]'
                                      : 'wx-bub-tail-theirs bg-white dark:bg-[#1E1E1E]'
                                  }`
                            }`}
                            style={bvis.tailColor && !bvis.tailClass ? { backgroundColor: bvis.tailColor } : undefined}
                          />
                        );
                      })()
                    ) : null}
                    {bubbleContent ? (
                      /* 文字消息：内置表情代码 [微笑] 还原为内联小图（混排小图/纯表情大图，真机同款） */
                      <InlineEmojiText app="wx" text={cleanBubbleText(bubbleContent) || bubbleContent} />
                    ) : (
                      <span className="flex h-[23px] items-center gap-1" aria-label="对方正在输入">
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:150ms] dark:bg-white/35" />
                        <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:300ms] dark:bg-white/35" />
                      </span>
                    )}
                  </div>
                  {/* 微信引用（截图样式）：独立半透明胶囊挂在气泡下方「名字：内容」（小圆角 + 细黑边框）；
                      Task 30 扩展——图片/表情源显示迷你缩略图、语音源显示语音图标+时长（还原截图的「Z：[图]」形态），
                      源消息已被删/撤回或图挂掉时退回纯文字（quote.content 已由删除/撤回联动改写） */}
                  {m.quote && <WxQuoteBlock quote={m.quote} srcMsg={m.quote.id ? msgs.find((x) => x.id === m.quote?.id) ?? null : null} />}
                  {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                  {renderTranslations(m.id, m.content)}
                  {/* 显示设置 › 已读未读/时间（位置=气泡下面）：靠气泡末尾（远离头像的一侧），已读在上、时间在下 */}
                  <WxMetaUnderBubble m={m} cfg={chatDisplay} />
                </div>
              )}
              {/* AI 回复失败徽标（红色 !，点击重试）优先于拉黑图标：旧版失败落库的占位行已不再渲染 */}
              {m.role === 'me' && m.replyFail ? (
                <button
                  type="button"
                  data-testid={`wx-replyfail-${m.id}`}
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
            </div>
            )}
                {actView?.after.map((a, k) => (
                  <ActionDescLine key={`a${k}`} text={a} testId={`wx-action-${m.id}-${k}`} />
                ))}
              </>
            )}
            {/* 拒收状态行：仅「对方拉黑我」时跟在我的消息后面，居中半透明胶囊；我拉黑对方不显示 */}
            {blockedLineOf(m)}
            {/* 好友验证消息标注（与系统提示同款胶囊：气泡下方居中；验证消息独立保留在聊天记录里） */}
            {m.fr === 'apply' || m.fr === 'greet' ? (
              <div data-testid="wx-fr-note" className="py-1 text-center">
                <span className="inline-block rounded-[4px] border border-black/15 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/15 dark:bg-white/[0.13] dark:text-white/60">
                  {m.fr === 'apply' ? '以上为验证消息' : '以上是打招呼的内容'}
                </span>
              </div>
            ) : null}
          </div>
          {/* Task 40：失败消息下方居中灰字提示行（点击重试；长按菜单：重新发送/复制错误详情/隐藏这条提示）；
              不进气泡不写聊天记录，隐藏为会话内存态；detail 取会话最近一次失败的原始错误（仅复制用，界面不展示） */}
          {m.replyFail && !hiddenFail[m.id] && (
            <ChatErrorLine
              text={m.failReason || CHAT_UNKNOWN_FAIL_TEXT}
              detail={lastChatErrorDetail(sessionKey)}
              cooldownText={cooldownRemainText(sessionKey)}
              onRetry={() => retryReply(m)}
              onHide={() => setHiddenFail((p) => ({ ...p, [m.id]: true }))}
              testId={`wx-errline-${m.id}`}
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
             序号取 msgs.length 接续七彩循环；尾巴随装扮策略——胶囊装扮无尾巴） */
          const tvis = bubbleVisual('theirs', bubbleStyle, msgs.length, 'wx');
          return (
          <div data-testid="wx-stream-typing">
            {stream?.visionNotice && (
              <p data-testid="wx-vision-notice" className="py-1 text-center text-[12px] leading-relaxed text-black/40 dark:text-white/40">
                {stream.visionNotice}
              </p>
            )}
            {/* B2 深度思考实况：流式期间思考增量到达时，输入指示气泡上方先展示「正在深度思考…」
                脉动卡（可展开实时思考）；正文开始流后自动切「已深度思考 (点击展开)」，
                与消息落盘后的 ThinkCard 无缝衔接；深度思考开关关闭时不渲染（思考照常后台进行） */}
            {deepThinkOn && stream?.liveThink ? (
              <div className="pl-0 pr-1 pb-[2px]">
                <ThinkLiveCard text={stream.liveThink} done={stream.thinkDone ?? false} testId="wx-think-live" />
              </div>
            ) : null}
            <div className="flex items-start gap-2 py-1.5">
              <WxAvatar src={peer.avatar} alt={peer.name} size={38} />
              <div
                className={`relative max-w-[calc(100%-92px)] px-3 py-2 ${
                  tvis.override ? tvis.className : 'rounded-[5px] bg-white dark:bg-[#1E1E1E]'
                }`}
                style={tvis.override ? tvis.style : undefined}
              >
                {tvis.tail === 'native' && (() => {
                  /* 与正文气泡尾巴同口径：古早（含自定义色）补 1px 描边偏移 + 颜色走古早色板 */
                  const retro = tvis.override && tvis.className.includes('bub-retro');
                  return (
                    <span
                      aria-hidden="true"
                      className={`absolute h-[8px] w-[8px] rotate-45 ${
                        retro
                          ? `top-[10px] -left-[4px]${tvis.tailClass ? ` ${tvis.tailClass}` : ''}`
                          : `top-[11px] -left-[3px] ${tvis.tailColor ? '' : 'bg-white dark:bg-[#1E1E1E]'}`
                      }`}
                      style={tvis.tailColor && !tvis.tailClass ? { backgroundColor: tvis.tailColor } : undefined}
                    />
                  );
                })()}
                <span className="flex h-[23px] items-center gap-1" aria-label="对方正在输入">
                  <span className={`h-[6px] w-[6px] animate-bounce rounded-full ${tvis.override ? 'bg-current' : 'bg-black/25 dark:bg-white/35'}`} />
                  <span className={`h-[6px] w-[6px] animate-bounce rounded-full ${tvis.override ? 'bg-current' : 'bg-black/25 dark:bg-white/35'} [animation-delay:150ms]`} />
                  <span className={`h-[6px] w-[6px] animate-bounce rounded-full ${tvis.override ? 'bg-current' : 'bg-black/25 dark:bg-white/35'} [animation-delay:300ms]`} />
                </span>
              </div>
            </div>
          </div>
          );
        })()}
      </div>

      {/* 底部：输入栏 + 加号面板（面板展开时输入栏保持在上方）；多选模式下变为批量删除/分享/收藏操作栏。
          wx-inputbar：输入栏锚点（聊天设置 › 自定义CSS 示例主题可改底色/边框） */}
      <div className={`wx-inputbar ${liquid ? 'relative z-10 shrink-0 bg-transparent' : retro ? 'rt-inputbar relative z-10 shrink-0' : 'relative z-10 shrink-0 border-t border-black/[0.07] bg-[#EDEDED] dark:border-white/[0.06] dark:bg-[#111111]'}`}>
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[26px] pt-3" data-testid="wx-select-bar">
            <button
              type="button"
              data-testid="wx-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#FA5151] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="wx-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="wx-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
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
            <div className="px-2.5 pb-1 pt-2" data-testid="wx-user-blockreq-panel">
              <div className="flex items-center gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1.5 dark:border-white/25 dark:bg-white/[0.13]">
                <input
                  value={userReqText}
                  onChange={(e) => setUserReqText(e.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder={`向「${peer.name}」写一句申请理由…`}
                  aria-label="解除拉黑申请理由"
                  data-testid="wx-user-blockreq-input"
                  className="h-[30px] min-w-0 flex-1 rounded-[4px] bg-white px-2.5 text-[14px] outline-none ring-black/[0.06] placeholder:text-black/30 focus-visible:ring-1 dark:bg-[#232323] dark:placeholder:text-white/30"
                />
                <button
                  type="button"
                  data-testid="wx-user-blockreq-cancel"
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
                  data-testid="wx-user-blockreq-send"
                  disabled={!userReqText.trim()}
                  onClick={submitUserBlockReq}
                  className="h-[30px] shrink-0 rounded-[4px] bg-[#07C160] px-3.5 text-[13px] font-medium text-white transition active:opacity-80 disabled:opacity-40"
                >
                  发送
                </button>
              </div>
            </div>
          ) : (
            <div className="px-2.5 pb-1 pt-2" data-testid="wx-user-blockreq-bar">
              <div className="flex items-center gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 dark:border-white/25 dark:bg-white/[0.13]">
                <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">你已被「{peer.name}」拉黑，无法发送消息</p>
                <button
                  type="button"
                  data-testid="wx-user-blockreq-open"
                  onClick={() => setUserReqOpen(true)}
                  className="shrink-0 rounded-[4px] bg-[#07C160]/10 px-3 py-1 text-[12px] font-medium text-[#07C160] transition active:opacity-70 dark:bg-[#07C160]/20"
                >
                  发送解除申请
                </button>
              </div>
            </div>
          )
        )}
        {/* 引用条（长按菜单「引用」后显示在输入框上方；发送时挂到新消息上） */}
        {quote && (
          <div className="px-2.5 pt-2" data-testid="wx-quote-bar">
            <div className="flex items-start gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 dark:border-white/25 dark:bg-white/[0.13]">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">
                引用 {quote.name}：{quote.content}
              </p>
              <button
                type="button"
                aria-label="取消引用"
                data-testid="wx-quote-cancel"
                onClick={() => setQuote(null)}
                className="shrink-0 text-black/35 active:opacity-60 dark:text-white/35"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        {/* 第三十三轮：pt-2→pt-1（顶部上移一点）；items-end→items-center（图标和输入框对齐）
            第三十四轮：gap-2.5→gap-2（输入框往右延伸）
            第四十七轮（用户指定）：液态底距 pb-2→pb-[13px]——输入框整体再往上提一点 */}
        <div className={liquid ? 'px-2.5 pb-[13px] pt-1' : 'px-2.5 pb-[18px] pt-1'}>
          {/* 输入框上方快捷功能条（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面；
              点一下与点面板里那一项等效；未添加 = 不显示；「+」面板本身不受影响 */}
          {quickItems.length > 0 && (
            <div className="mb-1.5">
              <ChatQuickBar items={quickItems} liquid={liquid} retro={retro} testPrefix="wx" />
            </div>
          )}
          {/* 液态输入栏（第四十四轮，用户指定）：删除大椭圆包裹——语音钮 = 玻璃圆圈内嵌黑圈、
              输入框毛玻璃椭圆、表情+加号共用一个玻璃椭圆；默认主题原样 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
              data-testid="wx-voice-toggle"
              onClick={() => {
                if (rec.phase !== 'idle') return; // 录音按住中不允许切换（防止按住中的胶囊被卸载导致手势丢失）
                setVoiceMode((v) => !v);
                setPlusOpen(false);
                setStickerOpen(false);
              }}
              className="shrink-0 active:opacity-70"
            >
              <span
                className={
                  liquid
                    ? /* 液态（用户指定）：玻璃圆圈包裹黑圈语音钮 */ 'lg-chip flex h-[40px] w-[40px] items-center justify-center rounded-full transition-transform active:scale-95'
                    : retro
                    ? /* 古早（第五十四轮）：拟物方角按钮（rt-btn 材质） */
                      'rt-btn flex h-[32px] w-[32px] items-center justify-center text-[#3A3E4C] active:opacity-70'
                    : 'flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 transition-colors active:bg-black/[0.05] dark:border-white/70 dark:text-white/90 dark:active:bg-white/10'
                }
              >
                {liquid ? (
                  <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 dark:border-white/70 dark:text-white/90">
                    {/* 键盘模式 → 声波图标（点按进语音）；语音模式 → 键盘图标（点按切回键盘） */}
                    {voiceMode ? <KeyboardGlyph size={17} /> : <VoiceWaveGlyph size={19} />}
                  </span>
                ) : (
                  <>
                    {/* 键盘模式 → 声波图标（点按进语音）；语音模式 → 键盘图标（点按切回键盘） */}
                    {voiceMode ? <KeyboardGlyph size={17} /> : <VoiceWaveGlyph size={19} />}
                  </>
                )}
              </span>
            </button>
            {voiceMode ? (
              /* 语音输入模式：按住说话（上滑/左滑取消，右滑转文字，松开发送） */
              <VoiceHoldBar rec={rec} testId="wx-voice-hold" glass={liquid} />
            ) : (
              <div className="relative min-w-0 flex-1">
                <ChatRichInput
                  app="wx"
                  ref={richInputRef}
                  value={input}
                  onChange={(v) => {
                    setInput(v);
                    // Task 40 草稿箱：输入即存（400ms 防抖落库内建，刷新/切会话/重进不丢）；
                    // 超长截断保存时返回 true → 节流提示一次（5 秒内只提示，输入框本身不限长不受干扰）
                    if (saveChatDraft('wx', peer.id, v) && Date.now() - draftTruncTipAt.current > 5000) {
                      draftTruncTipAt.current = Date.now();
                      onToast(`草稿过长，仅保留前 ${CHAT_DRAFT_MAX} 字`);
                    }
                    // 键入 @ 直接唤起 @ 浮层（与群聊同款：点选后替换该 @ 并插入「@名字 」）
                    if (!selfChat && v.endsWith('@')) {
                      setPlusOpen(false);
                      setStickerOpen(false);
                      setAtOpen(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    // A-6：中文输入法选词回车（isComposing）不发送，避免半截拼音被当消息发出；
                    // 「回车键发送消息」开关统一口径（guardEnterToSend）：开启=Enter 发送（Shift+Enter 仍换行），关闭=回车一律换行、点「发送」按钮才发送
                    guardEnterToSend(e, enterSend, () => void send());
                  }}
                  enterKeyHint={enterSend ? 'send' : undefined}
                  placeholder={ttsSend ? '输入文字，发送后转为语音' : chatPlaceholder(chatDecorWx)}
                  placeholderClass="absolute inset-0 flex items-center pl-3.5 pr-11 text-[16px] text-black/30 dark:text-white/30"
                  testId="wx-chat-input"
                  className={`block max-h-[132px] w-full overflow-y-auto py-[8px] pl-3.5 pr-11 text-[16px] leading-[22px] caret-[#07C160] outline-none transition-all duration-200 selection:bg-[#07C160]/20 ${
                    liquid
                      ? /* 液态：毛玻璃椭圆输入胶囊（比背景稍深一档 + 内阴影下陷感） */ 'lg-input min-h-[36px] rounded-full shadow-[inset_0_1px_3px_rgba(31,38,135,0.10)]'
                      : retro
                      ? /* 古早（第五十四轮）：白底内凹硬边输入框 */ 'rt-input min-h-[34px] rounded-[4px] text-black'
                      : 'min-h-[34px] rounded-[4px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_5px_14px_rgba(0,0,0,0.05)] dark:bg-[#232323] dark:shadow-none'
                  }`}
                />
                {/* 文字转语音开关（第三十二轮：图标改麦克风——与微信参考图一致的输入框内右侧灰麦克风；
                    开启后输入文字发送为语音气泡（本地仿真）；切到「按住说话」模式时随输入框一起隐藏） */}
                <button
                  type="button"
                  aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
                  aria-pressed={ttsSend}
                  data-testid="wx-tts-toggle"
                  onClick={() => {
                    const nv = !ttsSend;
                    setTtsSend(nv);
                    onToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
                  }}
                  className={`absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors active:opacity-60 ${ttsSend ? 'text-[#07C160]' : 'text-black/40 dark:text-white/40'}`}
                >
                  <Mic className="h-[21px] w-[21px]" strokeWidth={ttsSend ? 2.1 : 1.8} />
                </button>
              </div>
            )}
            {/* 表情 + 加号（液态，用户指定）：共用一个玻璃椭圆包裹，无内容时加号在内、有内容时移出换发送键；
                默认：表情常驻独立钮（真机微信同款排版），有内容时加号位换发送键 */}
            {liquid ? (
              <div className="lg-chip flex shrink-0 items-center gap-1 rounded-full p-[4px]">
                <button
                  type="button"
                  aria-label="表情"
                  data-testid="wx-chat-sticker"
                  aria-expanded={stickerOpen}
                  onClick={() => {
                    /* 第五十二轮（用户指定）：表情/加号/语音三面板互斥——录音按住中不允许切换，
                       开表情面板时退出语音模式（按住说话条卸载回键盘），并关加号面板 */
                    if (rec.phase !== 'idle') return;
                    setVoiceMode(false);
                    setPlusOpen(false);
                    setStickerOpen((v) => !v);
                  }}
                  className="flex h-[30px] w-[30px] items-center justify-center active:opacity-60"
                >
                  <Smile
                    className={`h-[21px] w-[21px] ${stickerOpen ? 'text-[#07C160]' : 'text-black/85 dark:text-white/85'}`}
                    strokeWidth={2}
                  />
                </button>
                {!(input.trim() || canDispatch || pendingImgs.length > 0) && (
                  <button
                    type="button"
                    aria-label="更多功能"
                    data-testid="wx-chat-plus"
                    onClick={() => {
                      /* 三面板互斥（第五十二轮）：开加号面板时退出语音模式并关表情面板 */
                      if (rec.phase !== 'idle') return;
                      setVoiceMode(false);
                      setStickerOpen(false);
                      setPlusOpen((v) => !v);
                    }}
                    className="flex h-[30px] w-[30px] items-center justify-center active:opacity-60"
                  >
                    <CirclePlus
                      className={`h-[22px] w-[22px] text-black/85 dark:text-white/85 transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`}
                      strokeWidth={1.8}
                    />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                aria-label="表情"
                data-testid="wx-chat-sticker"
                aria-expanded={stickerOpen}
                onClick={() => {
                  /* 三面板互斥（第五十二轮）：开表情面板时退出语音模式并关加号面板 */
                  if (rec.phase !== 'idle') return;
                  setVoiceMode(false);
                  setPlusOpen(false);
                  setStickerOpen((v) => !v);
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center active:opacity-60"
              >
                <Smile className="h-[25px] w-[25px]" strokeWidth={2} />
              </button>
            )}
            {(input.trim() || canDispatch || pendingImgs.length > 0) ? (
              <button
                type="button"
                aria-label={ttsSend && input.trim() ? '发送（转语音）' : pendingImgs.length > 0 ? (input.trim() ? `发送文字和 ${pendingImgs.length} 张图片` : `发送 ${pendingImgs.length} 张图片`) : input.trim() ? '发送' : '发送（让对方回复）'}
                data-testid="wx-chat-send"
                onClick={() => {
                  // 有文字或待发图 → send()（内部处理组合/纯文字/纯图）；否则分句批次兜底。
                  // 37-a：去掉 disabled={streaming}——AI 回复中点击走 send() 内部的排队补跑分支（与 chat.tsx 口径一致），不再死按无反馈
                  if (input.trim() || pendingImgs.length) void send();
                  else dispatchBatch();
                }}
                className={
                  liquid
                    ? 'flex h-[34px] shrink-0 items-center justify-center rounded-full bg-[#07C160] px-[18px] text-[14px] font-medium text-white shadow-[0_3px_10px_rgba(7,193,96,0.35)] transition-transform active:scale-95 active:bg-[#06AD56] disabled:opacity-50'
                    : retro
                    ? /* 古早（第五十四轮）：复古绿渐变拟物发送键 */
                      'rt-send flex h-9 shrink-0 items-center justify-center px-4 text-[14px] font-semibold text-[#1E3A0C] active:opacity-80 disabled:opacity-50'
                    : 'flex h-9 shrink-0 items-center justify-center rounded-[4px] bg-[#07C160] px-4 text-[14px] font-medium text-white active:bg-[#06AD56] disabled:opacity-50'
                }
              >
                发送
              </button>
            ) : !liquid ? (
              <button
                type="button"
                aria-label="更多功能"
                data-testid="wx-chat-plus"
                onClick={() => {
                  /* 三面板互斥（第五十二轮）：开加号面板时退出语音模式并关表情面板 */
                  if (rec.phase !== 'idle') return;
                  setVoiceMode(false);
                  setStickerOpen(false);
                  setPlusOpen((v) => !v);
                }}
                className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center active:opacity-60"
              >
                <CirclePlus
                  className={`h-[28px] w-[28px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`}
                  strokeWidth={1.8}
                />
              </button>
            ) : null}
          </div>
          {/* 待发送图片预览条（需求2：选图后先显示在输入框下面，点主发送按钮才真正发出；面板展开时隐藏避免遮挡） */}
          {pendingImgs.length > 0 && !plusOpen && !stickerOpen && (
            <div
              className={liquid ? 'mt-2 flex items-center gap-2 overflow-x-auto px-2.5 pb-0.5' : 'mt-2 flex items-center gap-2 overflow-x-auto pb-0.5'}
              data-testid="wx-img-preview-bar"
            >
              {pendingImgs.map((p, k) => (
                <div key={p.id} className="relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-[8px] ring-1 ring-black/[0.06] dark:ring-white/10">
                  <img src={p.src} alt={`待发送图片 ${k + 1}`} className="h-full w-full object-cover" />
                  <button type="button" aria-label="移除图片" data-testid={`wx-img-preview-remove-${k}`}
                    onClick={() => setPendingImgs((prev) => prev.filter((x) => x.id !== p.id))}
                    className="absolute right-0.5 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-black/55 text-white active:opacity-70">
                    <X className="h-[11px] w-[11px]" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {stickerOpen && <WxStickerPanel onPick={sendSticker} onPickBuiltin={insertBuiltinEmoji} onClose={() => setStickerOpen(false)} onToast={onToast} liquid={liquid} />}
        {/* 第四十五轮（用户指定）：加号面板点击时输入框不再被顶起——液态主题下面板悬浮在输入区上方
            （absolute bottom-full 锚定底部容器顶缘，覆盖消息列表底部）；默认主题保持原展开行为。
            第四十七轮（用户指定）：面板左右太宽——改右锚定固定 248px（与主页加号菜单同宽，悬于加号钮上方） */}
        {plusOpen && (
          liquid ? (
            <div className="absolute bottom-full right-2.5 z-30 w-[248px]">
              <PlusPanel onAction={handlePlusAction} liquid={liquid} retro={retro} />
            </div>
          ) : (
            <PlusPanel onAction={handlePlusAction} retro={retro} />
          )
        )}
        {/* @ 浮层（单聊）：锚定输入区上方，点选后把草稿末尾的 @ 替换为「@名字 」 */}
        {atOpen && !selfChat && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-full left-3 z-40 mb-1 w-[220px] overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]">
              <div className="border-b border-black/[0.05] px-3 py-2 text-[11px] text-black/40 dark:border-white/[0.06] dark:text-white/40">
                @ 联系人（被 @ 的优先回复）
              </div>
              <button
                type="button"
                data-testid={`wx-chat-at-${peer.id}`}
                onClick={() => {
                  setAtOpen(false);
                  setInput((v) => {
                    const base = v.endsWith('@') ? v.slice(0, -1) : v;
                    const next = `${base}${base && !base.endsWith(' ') ? ' ' : ''}@${peer.name} `;
                    // Task 40：@ 选人插入同样同步进草稿（与 onChange 同源，防抖落库幂等）
                    saveChatDraft('wx', peer.id, next);
                    return next;
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <WxAvatar src={peer.avatar} alt={peer.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{peer.name}</span>
              </button>
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* 红包/转账发送页 + 位置功能页（相机/图片由加号面板直接调起手机原生相机/相册，无自建页面） */}
      {compose === 'redpacket' && <RedPacketCompose onBack={() => setCompose(null)} onSubmit={submitRedPacket} onToast={onToast} />}
      {compose === 'transfer' && <TransferCompose peer={peer} onBack={() => setCompose(null)} onSubmit={submitTransfer} onToast={onToast} />}
      {compose === 'location' && <LocationPickerPage onClose={() => setCompose(null)} onSend={sendLocation} onToast={onToast} />}
      {compose === 'textcard' && (
        <WxTextCardSheet
          charName={peer.name}
          busy={cardBusy}
          error={cardError}
          onClose={() => (cardBusy ? undefined : setCompose(null))}
          onSubmit={(t) => void submitTextCard(t)}
        />
      )}
      {/* 礼物页（加号面板「礼物」入口）：**淘宝已确认收货订单**作为礼物（用户：收到货的东西放在礼物界面）
          → 挑一件以蓝金星空礼物卡发给 AI；AI 也可买淘宝商品送回礼物卡（tb-ai-engage [送礼物:商品id]） */}
      {compose === 'gift' && (
        <WxGiftPicker
          onBack={() => setCompose(null)}
          onSend={(order) => {
            // 拉黑拦截（与红包同口径）：被角色拉黑后礼物发不出（不落库不触发 AI）
            if (loadBlock('wx', peer.id).byChar) {
              onToast('对方已将你拉黑，无法发送');
              return;
            }
            const first = order.items[0];
            const qty = order.items.reduce((n, it) => n + it.qty, 0);
            // 第七轮反馈：送出即从礼物页消失（订单打 giftedAt 标记，列表过滤；不能同一件宝贝送两次）
            tbMarkOrderGifted(order.id);
            const msg: WxMsg = {
              id: uid(),
              role: 'me',
              content: '',
              time: Date.now(),
              kind: 'giftcard',
              gift: {
                id: order.id,
                name: first?.title ?? order.shopName,
                countLabel: qty > 1 ? `共 ${qty} 件` : '共 1 件',
                image: first?.img ?? '/goods/shop-gift.webp',
                shop: order.shopName,
                accepted: false,
              },
            };
            setMsgs((prev) => [...prev, msg]);
            setCompose(null);
            onToast(`已把「${msg.gift?.name ?? '礼物'}」送给${peer.name}`);
            // 第十六轮：送礼物 → AI 情绪变甜蜜（收到礼物的 TA 会特别开心）
            try {
              noteMoodEvent(peer.id, 'gift');
            } catch {
              /* 情绪打点失败不影响送礼 */
            }
            if (peer.id !== me.id) runAiTurnRef.current?.(null, [msg]);
          }}
        />
      )}
      {/* 收礼弹窗（第 20 轮，真机同款）：点礼物卡片唤起——奶油金面板（送礼物/礼物大图/金色祝福语/收下礼物）+ 下方 ✕；
          收下后写回消息（gift.accepted 持久化），重开弹窗按钮仍显示已收下 */}
      {giftViewMsg?.gift && (
        <WxGiftReceiveSheet
          gift={giftViewMsg.gift}
          senderName={giftViewMsg.role === 'me' ? me.realName || me.name : peer.nickname || peer.name}
          onAccept={() => {
            // 第七轮反馈：收下礼物 → 聊天通知行「你收下了XX送的礼物」（与红包领取同款）+ toast
            setMsgs((prev) => [
              ...prev.map((x) => (x.id === giftViewMsg.id && x.gift ? { ...x, gift: { ...x.gift, accepted: true } } : x)),
              { id: uid(), role: 'peer', content: '', time: Date.now(), kind: 'notice', notice: { icon: 'gift', pre: `你收下了${peer.nickname || peer.name}送的`, accent: '礼物' } } as WxMsg,
            ]);
            onToast('已收下礼物');
          }}
          onClose={() => setGiftViewId(null)}
        />
      )}
      {/* 一起听选歌弹层（第二十四轮）：选歌 → 我方发邀请卡进聊天，AI 接受后双方发同意卡并建会话 */}
      {tgPickOpen && (
        <TogetherInviteSheet
          peerName={peer.nickname || peer.name}
          onClose={() => setTgPickOpen(false)}
          onPick={(song) => {
            setTgPickOpen(false);
            sendUserTogetherInvite({
              contact: peer,
              app: 'wx',
              song: { id: song.id, name: song.name, artist: songArtistText(song), cover: songCover(song) || undefined },
              insert: (m: TgCardMsg) => {
                const wx = m as unknown as WxMsg;
                saveMsgs(peer.id, [...loadMsgs(peer.id), wx]);
                setMsgs((prev) => (prev.some((x) => x.id === wx.id) ? prev : [...prev, wx]));
              },
            });
          }}
        />
      )}
      {/* 点击「文字图片」卡片弹出的操作面板：用图像生成生成图片 / 复制文字（三端共用组件） */}
      {(() => {
        const am = cardActionId ? msgs.find((x) => x.id === cardActionId && x.card) : null;
        return am?.card ? (
          <TextCardActionSheet
            text={am.card.text}
            busy={cardGenBusy}
            accent="#07C160"
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
            accent="#07C160"
            onDescChange={setRegenImgDesc}
            onSubmit={() => void submitImgRegen()}
            onClose={() => (regenImgBusy ? undefined : setRegenImgId(null))}
          />
        ) : null;
      })()}
      {/* 线下模式（约会）：从聊天继续，承接最近 N 条线上聊天（加号面板「线下」入口，与 QQ/信息共用同一页面组件） */}
      {offlineOpen ? (
        <OfflineMeetingPage
          app="wx"
          channel="微信"
          contactId={peer.id}
          userName={addressNameOf(me, useSettings.getState().addressMode)}
          userRealName={me.realName ?? me.name}
          userAvatar={me.avatar}
          loadRecentMsgs={(n: number): OfflineOnlineMsg[] =>
            msgs
              .slice(-n)
              .map((m): OfflineOnlineMsg | null => {
                const kind = m.kind ?? 'text';
                let text = '';
                if (kind === 'text') text = m.content;
                else if (kind === 'sticker') text = '[表情包]';
                else if (kind === 'image') text = '[图片]';
                else if (kind === 'voice') text = m.voice?.transcript?.trim() || '[语音]';
                else if (kind === 'redpacket') text = '[红包]';
                else if (kind === 'transfer') text = '[转账]';
                else if (kind === 'giftcard') text = '[礼物]';
                else if (kind === 'family') text = '[亲属卡]';
                else if (kind === 'location') text = `[位置] ${m.loc?.name ?? ''}`;
                else if (kind === 'call') text = '[语音通话]';
                else return null; // sys/blockreq/notice/forward/groupcard 不进线下上下文
                if (!text.trim()) return null;
                return { role: m.role === 'me' ? 'me' : 'peer', text, time: m.time };
              })
              .filter((m): m is OfflineOnlineMsg => m !== null)
          }
          onBack={() => setOfflineOpen(false)}
          onToast={onToast}
        />
      ) : null}
      {/* 原生相机/相册隐藏 input：相机单张（capture 调起后置摄像头）、图片可多选 */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
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
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void stageImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 支付密码验证浮层（开启支付密码后红包/转账发送前弹出自绘键盘） */}
      {gate && (
        <WxPayPwdGate
          label={`${gate.kind === 'redpacket' ? '发红包' : '转账'} ¥${fmtMoney(gate.amount)} 元`}
          onOk={() => {
            const g = gate;
            setGate(null);
            if (g.kind === 'redpacket') execRedPacket(g.amount, g.blessing ?? '恭喜发财，大吉大利', g.methodId);
            else execTransfer(g.amount, g.note ?? '', g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      )}

      {/* 角色状态卡（点击消息行对方头像弹出；关闭不影响聊天，内容不写记忆除非主动存入） */}
      <PeerStatusCard open={peerStatusOpen} onClose={() => setPeerStatusOpen(false)} contact={peer} app="wx" />

      {/* 聊天设置页（右上角 ··· 进入）：信息卡片/置顶聊天/消息免打扰/回复条数/查找聊天记录/聊天背景 */}
      {settingsOpen && (
        <ChatSettingsPage
          variant="wx"
          title="聊天信息"
          contactId={peer.id}
          peerName={peer.name}
          peerAvatar={peer.avatar}
          idLabel="微信号"
          idValue={peer.wechatId || peer.qqId || '未设置'}
          metaLine={[peer.region, peer.occupation].filter((x): x is string => Boolean(x)).join(' · ')}
          remark={remarkForApp(peer, 'wx')}
          relation={relationForAccount(peer, 'wx')}
          onSaveRelation={selfChat ? undefined : (v) => {
            // 多账号关系感知：关系落当前微信账号作用域（大号=全局 relation，小号=relationByAcc），重拉联系人刷新 peer
            void (async () => {
              try {
                await setAppRelation('wx', peer.id, v);
                await onContactsChanged?.();
              } catch {
                // 保存失败静默（弹窗已关闭，下次打开显示旧值）
              }
            })();
          }}
          onSaveRemark={(v) => {
            void onSaveRemark(v);
          }}
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
          onToggleEnterSend={(v) => setEnterSend('wx', v)}
          onToggleActionDesc={(v) => saveActionDescOn(sessionKey, v)}
          voiceSummary={describeVoiceId(peer.voiceId, myVoicesForSummary)}
          onOpenVoice={() => setVoiceOpen(true)}
          onOpenProactive={selfChat ? undefined : () => setProactiveOpen(true)}
          proactiveSummary={proactiveCfgSummary('wx', peer.id)}
          onBack={() => setSettingsOpen(false)}
          onTogglePinned={(v) => wxChatFlagsStore.update(peer.id, { pinned: v })}
          onToggleMuted={(v) => wxChatFlagsStore.update(peer.id, { muted: v })}
          blockedByUser={blk.byUser === true}
          onToggleBlock={selfChat ? undefined : toggleBlockFromSettings}
          onDeleteContact={selfChat ? undefined : onDeleteContact}
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
          onOpenPeerProfile={() => onOpenFriendDetail(peer)}
          // 47-b：删 chat-settings 4 个视觉管理入口（相册/决策日志/恢复默认头像/恢复默认封面）。
          // chat-settings.tsx 的 4 个 prop 仍可选（未传则入口行不渲染），由 47-a 决定是否彻底删 prop；
          // 容器层的 4 个 handler 已删，新需求改为「进他朋友圈点击封面上传换封面」（MomentsPage !isMine 分支）。
        />
      )}

      {/* 主动发消息设置页（聊天设置二级页）：定时/事件/自主/提醒四类触发（每角色独立） */}
      {proactiveOpen && (
        <ProactiveMsgPage variant="wx" contactId={peer.id} contactName={peer.name} onBack={() => setProactiveOpen(false)} />
      )}

      {/* 世界书挂载页（聊天设置二级页）：为联系人勾选挂载的书籍（按联系人隔离持久化） */}
      {wbOpen && (
        <WorldBookPickerPage
          variant="wx"
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
      )}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen && (
        <ChatTranslatePage
          variant="wx"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      )}

      {/* 回复条数页（聊天设置二级页）：AI 按选定条数连发多条消息（按会话隔离保存） */}
      {replyOpen && (
        <ChatReplyCountPage
          variant="wx"
          value={replyCount}
          onBack={() => setReplyOpen(false)}
          onSelect={(n) => {
            saveReplyCount(sessionKey, n);
            setReplyCountState(n);
          }}
        />
      )}

      {/* 他的声音页（聊天设置二级页）：角色音色选择（内置/我的音色）+ AI 语音频率入口 */}
      {voiceOpen && (
        <ChatVoicePage
          variant="wx"
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
      )}

      {/* AI 语音频率页（他的声音二级页）：按会话独立保存；选完关频率页回「他的声音」页 */}
      {voiceFreqOpen && (
        <ChatVoiceFreqPage
          variant="wx"
          value={getAiVoiceFreq(sessionKey)}
          onBack={() => setVoiceFreqOpen(false)}
          onSelect={(f) => {
            saveAiVoiceFreq(sessionKey, f);
            setVoiceFreqOpen(false);
          }}
        />
      )}

      {/* 聊天背景页（聊天设置二级页）：预览卡片 + 从手机相册上传 + 内置纯色壁纸 */}
      {bgOpen && (
        <ChatBgPage
          variant="wx"
          bg={bg}
          bgImageUrl={bgImageUrl}
          uploading={uploadingBg}
          onBack={() => setBgOpen(false)}
          onPickColor={handlePickBgColor}
          onPickImageFile={(f) => void handleUploadBg(f)}
          onResetBg={handleResetBg}
        />
      )}

      {/* 查找聊天记录页：关键词过滤 → 点击结果定位回聊天页并高亮 */}
      {searchOpen && (
        <ChatSearchPage
          variant="wx"
          items={searchItems}
          myName={me.name}
          peerName={peer.name}
          myAvatar={me.avatar}
          peerAvatar={peer.avatar}
          onClose={() => setSearchOpen(false)}
          onJumpTo={jumpToMessage}
        />
      )}

      {/* 收款页（对方发来的未收款转账）；#24：24h 过期清算把卡置 returned 后浮层自动关闭（清算落盘会合并进 msgs） */}
      {receiveMsg?.tr && !receiveMsg.tr.status && (
        <WxTrReceivePage
          peerName={peer.name}
          amount={receiveMsg.tr.amount}
          note={receiveMsg.tr.note}
          payTime={receiveMsg.time}
          onBack={() => setReceiveId(null)}
          onAccept={() => acceptTransfer(receiveMsg.id)}
          onRefund={() => refundPeerCard(receiveMsg)}
        />
      )}

      {/* 開红包弹层；审计4-L7：#24 同款终态派生关闭——24h 过期清算把红包置 returned 后浮层自动
          关闭（清算落盘会合并进 msgs），点「開」不再被 openRedPacket 守卫静默拦截成纯显示残留；
          领取/退还路径本就自带 setOpeningId(null)，不受此条件影响 */}
      {openingMsg?.rp && !openingMsg.rp.status && (
        <RpOpenLayer
          senderName={openingMsg.role === 'me' ? me.name : peer.name}
          senderAvatar={openingMsg.role === 'me' ? me.avatar : peer.avatar}
          blessing={openingMsg.rp.blessing}
          onOpen={() => openRedPacket(openingMsg.id)}
          onClose={() => setOpeningId(null)}
          onRefund={openingMsg.role === 'peer' ? () => refundPeerCard(openingMsg) : undefined}
        />
      )}

      {/* 红包详情页 */}
      {detailMsg?.kind === 'redpacket' && detailMsg.rp && (() => {
        const claimer = detailMsg.rp.openedBy ?? (detailMsg.role === 'me' ? peer.name : me.name);
        return (
          <RpDetailPage
            senderName={detailMsg.role === 'me' ? me.name : peer.name}
            senderAvatar={detailMsg.role === 'me' ? me.avatar : peer.avatar}
            blessing={detailMsg.rp.blessing}
            amount={detailMsg.rp.amount}
            opened={detailMsg.rp.opened}
            statusLabel={detailMsg.rp.status === 'returned' ? '该红包已退回，金额已存入零钱' : detailMsg.rp.status === 'rejected' ? '对方拒收了该红包' : undefined}
            claimerName={claimer}
            claimerAvatar={claimer === me.name ? me.avatar : peer.avatar}
            claimedAt={detailMsg.rp.openedAt}
            onBack={() => setDetailId(null)}
            onToast={onToast}
          />
        );
      })()}

      {/* 转账详情页 */}
      {detailMsg?.kind === 'transfer' && detailMsg.tr && (
        <TrDetailPage
          peerName={peer.name}
          amount={detailMsg.tr.amount}
          note={detailMsg.tr.note}
          payTime={detailMsg.time}
          received={detailMsg.tr.received}
          receivedAt={detailMsg.tr.receivedAt}
          receiverIsMe={(() => {
            // 收款人是否为「我」：receiptOf 精准标记优先；
            // 旧数据（receiptOf 被旧版规范化丢弃）兑底：对方已收款卡片，若此前有我发的同额同言且已收款的转账 →
            // 它是 AI 收我转账后生成的「已收款」接收凭据卡（对方收）；否则是 AI 发给我的原卡被我收（我收）
            const t = detailMsg.tr;
            if (t.receiptOf) return t.receiptOf === 'peer';
            if (detailMsg.role === 'me') return false;
            if (t.received !== true) return false;
            const idx = msgs.findIndex((x) => x.id === detailMsg.id);
            return !msgs.slice(0, Math.max(idx, 0)).some((x) => x.role === 'me' && x.tr && x.tr.received === true && x.tr.amount === t.amount && (x.tr.note || '') === (t.note || ''));
          })()}
          returned={detailMsg.tr.status === 'returned'}
          // 退还人：退还凭据卡自带 refundedBy 标记；原卡按消息角色反推（我发的→对方退的；对方发的→我退的）
          refundedBy={detailMsg.tr.refundedBy ?? (detailMsg.role === 'me' ? 'peer' : 'me')}
          refundedAt={detailMsg.tr.refundedAt}
          originTime={detailMsg.tr.originTime}
          onBack={() => setDetailId(null)}
          onToast={onToast}
        />
      )}

      {/* 美团找人代付详情页（聊天内打开：好友视角可立即代付） */}
      {proxyPid && <MtProxyDetailPage pid={proxyPid} canPay onBack={() => setProxyPid(null)} onToast={onToast} />}
      {tbProxyPid && <TbProxyDetailPage pid={tbProxyPid} canPay onBack={() => setTbProxyPid(null)} onToast={onToast} />}

      {/* 亲属卡详情页：我发的 → 管理详情（图③）；对方发的 → 领取页（图②） */}
      {detailMsg?.kind === 'family' && detailMsg.fam && (detailMsg.role === 'me' ? (
        <WxFcManagePage
          peerName={peer.name}
          peerAvatar={peer.avatar}
          limit={detailMsg.fam.monthlyLimit}
          used={detailMsg.fam.used}
          claimed={detailMsg.fam.claimed}
          claimedAt={detailMsg.fam.claimedAt}
          method={detailMsg.fam.method ?? '零钱'}
          onBack={() => setDetailId(null)}
          onEditLimit={(v) => {
            setMsgs((prev) => prev.map((x) => (x.id === detailMsg.id && x.fam ? { ...x, fam: { ...x.fam, monthlyLimit: v } } : x)));
            // 审计4-L4：钱包侧只改「正在编辑的这一张」——赠送时卡消息 id 已同步记入钱包卡 msgId
            // （钱包 onGift），按 msgId 精确匹配；旧数据无 msgId 匹配不到时退回 friendId 匹配（原行为）
            const list = loadFamilyCards();
            const byMsg = list.some((c) => c.msgId === detailMsg.id);
            saveFamilyCards(
              byMsg
                ? list.map((c) => (c.msgId === detailMsg.id ? { ...c, monthlyLimit: v } : c))
                : list.map((c) => (c.friendId === peer.id ? { ...c, monthlyLimit: v } : c))
            );
            onToast('已修改每月消费上限');
          }}
          onPickMethod={(mth) => {
            setMsgs((prev) => prev.map((x) => (x.id === detailMsg.id && x.fam ? { ...x, fam: { ...x.fam, method: mth } } : x)));
            onToast(`优先扣款方式：${mth}`);
          }}
          onToast={onToast}
        />
      ) : (
        <WxFcClaimPage
          peerName={peer.name}
          peerAvatar={peer.avatar}
          limit={detailMsg.fam.monthlyLimit}
          message={detailMsg.fam.message}
          claimed={detailMsg.fam.claimed}
          claimedAt={detailMsg.fam.claimedAt}
          rejected={detailMsg.fam.rejected}
          onBack={() => setDetailId(null)}
          onClaim={() => claimFamily(detailMsg.id)}
          onRefund={() => refundPeerCard(detailMsg)}
          onToast={onToast}
        />
      ))}

      {/* 图片大图查看器（多图可左右滑翻页 + 键盘翻页；单图/表情包入口只有一张） */}
      {viewer && (
        <WxPhotoViewer
          urls={viewer.urls}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
        />
      )}

      {/* 位置详情页（点聊天位置卡片） */}
      {locViewMsg?.loc && <LocViewLayer name={locViewMsg.loc.name} address={locViewMsg.loc.address} onClose={() => setLocViewId(null)} />}

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="wx-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
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
                data-testid="wx-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#07C160] dark:border-white/15 dark:bg-white/[0.06]"
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
                data-testid="wx-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；点弹层以外任意处关闭不执行，对照原生微信） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="wx-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[88px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="wx-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="wx-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="wx-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（转发流程第二步：聊天内勾选完 → 逐条/合并 → 选会话；对照原生微信选人页） */}
      {fwdFlow === 'target' && (
        <div
          className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
          data-testid="wx-fwd-target-layer"
        >
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto">
              {forwardTargets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`wx-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, { id: c.id, name: c.name, avatar: c.avatar, self: c.id === me.id })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <WxAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">{c.id === me.id ? `${c.name}（我自己）` : c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="wx-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开；对照微信合并转发详情） */}
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
          <div className="absolute inset-0 z-[65] flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fwd-detail">
            <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
              <div className="flex h-11 items-center px-2">
                <button type="button" aria-label="返回" data-testid="wx-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="active:opacity-60">
                  <ChevronLeft className="h-7 w-7" strokeWidth={2} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              {/* 逐条记录：行间分割线（对照原生微信聊天记录详情） */}
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <WxAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      {/* 名字在左、时间顶到最右（对照原生微信聊天记录详情） */}
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {/* 表情包/图片显示原图；其余类型（文字/红包/转账/亲属卡/位置）显示快照文字 */}
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="wx-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[8px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="wx-fwd-detail-image"
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

      {/* 气泡长按菜单（默认：微信/QQ 同款深色横向卡片；液态：竖排列表乳白玻璃浮层；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="wx-menu"
          liquid={liquid}
        />
      )}

      {/* Task 37 角色分支创建弹层：以长按的消息为分支点克隆平行联系人，成功后宿主切进分支聊天 */}
      {branchDlg && (
        <BranchDialog
          sourceId={peer.id}
          sourceName={peer.name}
          point={{ id: branchDlg.msg.id, role: branchDlg.msg.role, preview: branchDlg.preview, time: branchDlg.msg.time }}
          onCancel={() => setBranchDlg(null)}
          onCreated={(c) => {
            setBranchDlg(null);
            onSwitchChat?.(c);
          }}
        />
      )}

      {/* 录音浮层（按住说话期间：计时 + 实时波形 + 取消/转文字手势区） */}
      {rec.phase !== 'idle' && <RecordOverlayWx rec={rec} />}
      {sttPreview.state && (
        <SttPreviewOverlay
          state={sttPreview.state}
          accent="#07C160"
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

// ---------------- 朋友圈页 ----------------

/** A1/A2 朋友圈「生成图片」弹层（iOS 风格底部小弹层，样式对齐 WxTextCardSheet/ImageRegenSheet）：
 *  文字图片卡片升级真图（A1）与升级图重新生成（A2）共用——描述预填可改（无硬限，提交时 trim + 截 400）、
 *  主按钮 busy 时「生成中…」禁用、错误信息显示在弹层内（失败留在弹层可重试）、取消关闭（busy 时不可关） */
function MomentImageGenSheet({
  title,
  initialDesc,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  initialDesc: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (desc: string) => void;
}) {
  const [desc, setDesc] = useState(initialDesc);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="wx-moment-imggen-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1C1C1E]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold">{title}</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid="wx-moment-imggen-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          disabled={busy}
          rows={3}
          data-testid="wx-moment-imggen-input"
          placeholder="画面描述（可修改后再生成）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] outline-none placeholder:text-black/30 focus:border-[#07C160]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="wx-moment-imggen-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="wx-moment-imggen-submit"
          onClick={() => onSubmit(desc)}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#07C160] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              生成中…
            </>
          ) : (
            '生成图片'
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-black/35 dark:text-white/35">生成成功后照片会替换原位置（需在 设置 › 图像生成 完成配置）</p>
      </div>
    </div>
  );
}

/** 单条动态 */
function MomentRow({
  post,
  meName,
  menuOpen,
  onToggleMenu,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
  onUpgradeCard,
  onRegenImage,
  cardBusy,
}: {
  post: WxMoment;
  /** 机主展示名（点赞高亮用） */
  meName: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleLike: () => void;
  onComment: (text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: () => void;
  /** 长按评论删除（任何人的评论都可删，其下回复一并删；好友朋友圈页不传） */
  onDeleteComment?: (commentId: string) => void;
  /** 编辑动态正文（自己的和 AI 的都可以编辑；好友朋友圈页不传） */
  onEditRequest?: () => void;
  /** 点击「文字图片」卡片（AI 配图降级产物）→ 打开「生成图片」弹层（描述可改）升级为真图；不传 = 不可点击 */
  onUpgradeCard?: () => void;
  /** A2 长按升级图 → 打开「重新生成图片」弹层（仅引擎升级过的图有入口，用户手动发的图不传） */
  onRegenImage?: () => void;
  /** 卡片正在生成真图（点击防重） */
  cardBusy?: boolean;
}) {
  /** 48-6：朋友圈设置·折叠中文译文（组件挂载时读一次，避免每次 render 读 kv；用户改设置后跳回本页重新挂载可生效）。
   *  feat-64：设置按平台独立（只读微信朋友圈这一份） */
  const [foldByDefault] = useState(() => getMomentsSettings('wx').foldChineseTranslation);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /** 回复目标：点某条评论设置（再点一次取消），带评论 id（回复 AI 评论可触发多轮） */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; name: string } | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delTarget, setDelTarget] = useState<{ id: string; author: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  /** 长按计时器 + 起点坐标（移动超阈值视为滚动取消）+ 长按后拦截紧随的 click */
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);

  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  useEffect(() => clearPress, []);

  const startCommentPress = (c: WxMomentComment) => (e: React.PointerEvent) => {
    if (!onDeleteComment) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelTarget({ id: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  /** A2 升级图长按 → 打开「重新生成图片」弹层（复用评论长按同款计时器/移动取消/抑制 click 模式） */
  const startImagePress = (e: React.PointerEvent) => {
    if (!onRegenImage) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      onRegenImage();
    }, 480);
  };
  const onImagePointerMove = (e: React.PointerEvent) => {
    if (!onRegenImage) return;
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  useEffect(() => {
    if (composerOpen) inputRef.current?.focus();
  }, [composerOpen, replyTarget]);

  /** 评论框打开时，点击输入框以外的任意位置自动收起（不想评论了点别处即可关闭） */
  useEffect(() => {
    if (!composerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (composerRef.current && target && composerRef.current.contains(target)) return;
      setComposerOpen(false);
      setReplyTarget(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [composerOpen]);

  const sendComment = () => {
    const text = draft.trim();
    if (!text) return;
    onComment(text, replyTarget);
    setDraft('');
    setReplyTarget(null);
    setComposerOpen(false);
  };

  return (
    /* wx-moments-post：朋友圈动态卡锚点（自定义 CSS 示例模板可改卡底/分割线/内距） */
    <div className="wx-moments-post flex gap-3 border-b border-black/[0.06] px-4 py-3 last:border-b-0 dark:border-white/[0.08]">
      <WxAvatar src={post.avatar} alt={post.authorName} size={44} />
      <div className="min-w-0 flex-1">
        <p className="wx-moments-name text-[15px] font-medium text-[#576B95] dark:text-[#8FA5C9]">{post.authorName}</p>
        {post.text && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-[1.5]">{post.text}</p>
        )}
        <BilingualTranslation zh={post.contentZh ?? ''} foldByDefault={foldByDefault} />
        {/* 「文字图片」卡片（AI 配图降级产物）：韩系简约卡片直接当配图，点击可升级为真图 */}
        {post.textCard && post.images.length === 0 && (
          <div className="mt-2">
            <TextCardBubble
              text={post.textCard}
              signedBy={post.authorName}
              variant="wx"
              onClick={onUpgradeCard}
            />
            {cardBusy && <p className="mt-1 text-[12px] text-black/35 dark:text-white/35">正在生成图片…</p>}
          </div>
        )}
        {post.images.length === 1 && (
          <img
            src={post.images[0]}
            alt="配图"
            className="mt-2 max-h-[280px] w-auto max-w-[200px] rounded-[4px] border border-black/5 object-cover dark:border-white/10"
            {...(onRegenImage
              ? {
                  // A2 长按升级图 →「重新生成图片」弹层（桌面端右键同入口；仅 textCardUpgraded 图有此 handler）
                  onPointerDown: startImagePress,
                  onPointerMove: onImagePointerMove,
                  onPointerUp: clearPress,
                  onPointerLeave: clearPress,
                  onPointerCancel: clearPress,
                  onContextMenu: (e: React.MouseEvent) => {
                    e.preventDefault();
                    onRegenImage();
                  },
                }
              : {})}
          />
        )}
        {post.images.length > 1 && (
          <div className="mt-2 grid max-w-[237px] grid-cols-3 gap-1">
            {post.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`配图${i + 1}`}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded-[3px] object-cover"
              />
            ))}
          </div>
        )}

        {/* 转发引用卡（引擎层支持；QQ 空间转发，微信侧仅兼容展示） */}
        {post.repostOf && (
          <div className="mt-2 rounded-[4px] bg-[#F7F7F7] px-2.5 py-2 dark:bg-[#242424]">
            <p className="text-[13.5px] leading-[1.5]">
              <span className="text-[#576B95] dark:text-[#8FA5C9]">{post.repostOf.authorName}：</span>
              <span className="text-black/70 dark:text-white/70">{post.repostOf.content}</span>
            </p>
            {post.repostOf.images.length > 0 && (
              <div className="mt-1.5 flex gap-1">
                {post.repostOf.images.slice(0, 3).map((src, i) => (
                  <img key={i} src={src} alt="转发配图" className="h-14 w-14 rounded-[3px] object-cover" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 位置行（发动态时选了「所在位置」才显示，微信同款蓝字） */}
        {post.location && (
          <p className="mt-1.5 flex items-center gap-1 text-[13px] text-[#576B95] dark:text-[#8FA5C9]" data-testid={`wx-moment-location-${post.id}`}>
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            <span className="truncate">{post.location}</span>
          </p>
        )}

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[12.5px] text-black/35 dark:text-white/35">{fmtMomentsTime(post.time)}</span>
          <button
            type="button"
            aria-label="赞与评论"
            data-testid={`wx-moment-menu-${post.id}`}
            onClick={onToggleMenu}
            className="wx-moments-act flex items-center gap-[3px] rounded-[4px] bg-[#F2F2F2] px-2.5 py-1 active:bg-black/10 dark:bg-[#2A2A2A] dark:active:bg-white/10"
          >
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
            <span className="h-[4px] w-[4px] rounded-full bg-[#576B95] dark:bg-[#8FA5C9]" />
          </button>
        </div>

        {menuOpen && (
          <div className="mt-2 flex justify-end" data-testid={`wx-moment-actions-${post.id}`}>
            {/* 第七十四轮（用户指定：菜单文字要横向平行）：四个按钮 + 分隔线在内容列宽内放不下 →
                按钮收紧内距/字号并加 whitespace-nowrap shrink-0（CJK 逐字换行是 min-width:auto
                把按钮压到一字宽导致的）；总宽 ≈ 260px < 内容列 ≈ 302px，完整显示不裁切 */}
            <div className="flex overflow-hidden rounded-[6px] bg-[#4C4C4C] text-white shadow-md dark:bg-[#383838]">
              <button
                type="button"
                data-testid={`wx-moment-like-${post.id}`}
                onClick={onToggleLike}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
              >
                <Heart className={`h-4 w-4 ${post.likes.includes(meName) ? 'fill-[#FA5151] text-[#FA5151]' : ''}`} strokeWidth={1.8} />
                {post.likes.includes(meName) ? '取消' : '赞'}
              </button>
              <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-comment-open-${post.id}`}
                onClick={() => {
                  setComposerOpen(true);
                  onToggleMenu();
                }}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
                评论
              </button>
              {onEditRequest && (
                <>
                  <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
                  <button
                    type="button"
                    data-testid={`wx-moment-edit-${post.id}`}
                    onClick={onEditRequest}
                    className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] active:bg-white/10"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.8} />
                    编辑
                  </button>
                </>
              )}
              <span className="my-1.5 w-px shrink-0 bg-white/25" aria-hidden="true" />
              <button
                type="button"
                data-testid={`wx-moment-delete-${post.id}`}
                onClick={onDelete}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-[12.5px] text-[#FF9C9C] active:bg-white/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                删除
              </button>
            </div>
          </div>
        )}

        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="relative mt-2">
            <span
              className="absolute -top-[4px] left-[12px] h-2 w-2 rotate-45 rounded-[1px] bg-[#F7F7F7] dark:bg-[#242424]"
              aria-hidden="true"
            />
            <div className="relative rounded-[4px] bg-[#F7F7F7] px-2 py-1.5 text-[13px] dark:bg-[#242424]">
              {post.likes.length > 0 && (
                <div className="flex items-center gap-1.5 text-[#576B95] dark:text-[#8FA5C9]">
                  <Heart className="h-3.5 w-3.5 shrink-0 fill-[#576B95] dark:fill-[#8FA5C9]" strokeWidth={0} aria-hidden="true" />
                  <span className="min-w-0 truncate">{post.likes.join('、')}</span>
                </div>
              )}
              {post.likes.length > 0 && post.comments.length > 0 && (
                <span className="my-1.5 block h-px bg-black/[0.06] dark:bg-white/[0.08]" aria-hidden="true" />
              )}
              {post.comments.length > 0 && (
                <div className="min-w-0">
                  {post.comments.map((c) => (
                    <div key={c.id}>
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          data-testid={`wx-moment-comment-${post.id}-${c.id}`}
                          title={`回复 ${c.author}（长按删除）`}
                          onPointerDown={startCommentPress(c)}
                          onPointerUp={clearPress}
                          onPointerLeave={clearPress}
                          onPointerCancel={clearPress}
                          onPointerMove={onCommentPointerMove}
                          onClick={() => {
                            // 长按后拦截紧随的 click（不弹出回复框）
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            setComposerOpen(true);
                            setReplyTarget((r) => (r && r.commentId === c.id ? null : { commentId: c.id, name: c.author }));
                          }}
                          className="min-w-0 flex-1 text-left text-[13px] leading-[1.6] active:opacity-70"
                        >
                          <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.author}</span>
                          {c.replyTo && (
                            <>
                              <span className="text-black/85 dark:text-white/85"> 回复 </span>
                              <span className="text-[#576B95] dark:text-[#8FA5C9]">{c.replyTo}</span>
                            </>
                          )}
                          <span className="text-black/85 dark:text-white/85">：{c.text}</span>
                        </button>
                      </div>
                      <BilingualTranslation zh={c.contentZh ?? ''} foldByDefault={foldByDefault} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {composerOpen && (
          <div ref={composerRef} className="mt-2 flex items-center gap-2" data-testid={`wx-moment-commentbar-${post.id}`}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendComment();
                }
              }}
              placeholder={replyTarget ? `回复 ${replyTarget.name}：` : '评论'}
              aria-label={replyTarget ? `回复 ${replyTarget.name}` : '写评论'}
              data-testid={`wx-moment-comment-input-${post.id}`}
              className="h-8 min-w-0 flex-1 rounded-[4px] bg-[#F7F7F7] px-2.5 text-[13.5px] outline-none placeholder:text-black/30 focus:bg-white focus:ring-1 focus:ring-black/15 dark:bg-[#242424] dark:placeholder:text-white/30 dark:focus:bg-[#1F1F1F] dark:focus:ring-white/20"
            />
            <button
              type="button"
              data-testid={`wx-moment-comment-send-${post.id}`}
              onClick={sendComment}
              disabled={!draft.trim()}
              className="shrink-0 rounded-[4px] bg-[#07C160] px-3.5 py-[7px] text-[13px] font-medium text-white disabled:opacity-40 active:opacity-80"
            >
              发送
            </button>
          </div>
        )}

        {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
        {delTarget && onDeleteComment && (
          <CommentDeleteDialog
            author={delTarget.author}
            onCancel={() => setDelTarget(null)}
            onDelete={() => {
              onDeleteComment(delTarget.id);
              setDelTarget(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function MomentsPage({
  me,
  owner,
  peerId,
  posts,
  onBack,
  onCompose,
  onToggleLike,
  onComment,
  onDelete,
  onDeleteComment,
  onEditRequest,
  onToast,
  noticeBadge,
  onOpenNotices,
}: {
  me: WxUser;
  /** 传入 = 好友的朋友圈：界面同款，但名字/头像换好友、无发布与换封面入口 */
  owner?: { name: string; avatar: string | null } | null;
  /** 好友的联系人 ID（owner 非空时用于读/重置 peer 专属朋友圈封面） */
  peerId?: string;
  posts: WxMoment[];
  onBack: () => void;
  onCompose: () => void;
  onToggleLike: (id: string) => void;
  onComment: (id: string, text: string, reply: { commentId: string; name: string } | null) => void;
  onDelete: (id: string) => void;
  /** 删除自己的评论（好友朋友圈页不传） */
  onDeleteComment?: (postId: string, commentId: string) => void;
  /** 编辑动态正文（仅自己的动态；好友朋友圈页不传） */
  onEditRequest?: (post: WxMoment) => void;
  onToast: (m: string) => void;
  /** 互动消息未读数 + 最新一条消息人的头像（「1条新消息」气泡；好友朋友圈不显示） */
  noticeBadge: { count: number; avatar: string | null };
  /** 打开「与我的互动消息」页（气泡/铃铛入口） */
  onOpenNotices: () => void;
}) {
  const isMine = !owner;
  const shownName = owner?.name ?? me.name;
  const shownAvatar = owner ? owner.avatar : me.avatar;
  /** 「文字图片」卡片点击升级为真图：busy 的动态 id（卡片行「正在生成图片…」提示 + 防重入，与旧口径一致） */
  const [upgradingCardId, setUpgradingCardId] = useState<string | null>(null);
  /** A1/A2「生成图片」弹层（微信朋友圈同款小弹层）：upgrade = 文字图片卡片升级 / regen = 升级图重新生成 */
  const [genSheet, setGenSheet] = useState<null | { mode: 'upgrade' | 'regen'; postId: string; desc: string }>(null);
  const [genSheetBusy, setGenSheetBusy] = useState(false);
  const [genSheetError, setGenSheetError] = useState('');
  /** A1 描述可改升级：点击文字图片卡片打开「生成图片」弹层（预填卡片文字，可改），确认后才真正生图 */
  const handleUpgradeCard = (post: WxMoment) => {
    if (upgradingCardId) return; // 保留原 busy 防重入
    setGenSheet({ mode: 'upgrade', postId: post.id, desc: post.textCard ?? '' });
  };
  /** A1/A2 弹层确认：按 mode 调引擎升级/重新生成；成功关弹层 + toast（列表由引擎广播
   *  moments-changed → 宿主 reloadMoments 自动刷新）；失败留在弹层显示 error（可改后重试） */
  const submitMomentGen = async (descInput: string) => {
    if (!genSheet || genSheetBusy) return;
    const desc = descInput.trim().slice(0, 400); // 提交时 trim + 截 400（与聊天端同口径）
    setGenSheetBusy(true);
    setGenSheetError('');
    if (genSheet.mode === 'upgrade') setUpgradingCardId(genSheet.postId);
    try {
      const r =
        genSheet.mode === 'upgrade'
          ? await upgradeMomentTextCard('wx', genSheet.postId, me.name, desc || undefined) // 描述留空 → 引擎回落卡片文字
          : await regenerateMomentImage('wx', genSheet.postId, me.name, desc); // 描述留空 → 引擎回落上次描述
      if (r.ok) {
        setGenSheet(null);
        onToast(genSheet.mode === 'upgrade' ? '已生成照片，卡片已换成真图' : '已重新生成');
      } else {
        setGenSheetError(r.error || '生成失败，请稍后再试');
      }
    } catch (e) {
      setGenSheetError(e instanceof Error ? e.message : '生成失败，请稍后再试');
    } finally {
      setUpgradingCardId(null);
      setGenSheetBusy(false);
    }
  };
  const [menuId, setMenuId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  /** 封面（本地 IndexedDB settings 存 data URL；迁移时从服务端一次性搬入） */
  const [cover, setCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  /** 47-b peer 朋友圈封面专属文件 input 引用（与自己的 coverRef 分开避免 onChange 混淆） */
  const peerCoverRef = useRef<HTMLInputElement>(null);

  // 启动读取本地封面（自己的朋友圈用 getWxBg('moments')；好友的用 getPeerBg('wx', peerId)）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (isMine) {
          const bg = await getWxBg('moments');
          if (alive && bg) setCover(bg.data);
        } else if (peerId) {
          const bg = await getPeerBg('wx', peerId);
          if (alive && bg) setCover(bg);
        }
      } catch {
        // 忽略，用默认封面
      }
    })();
    return () => {
      alive = false;
    };
  }, [isMine, peerId]);

  /** 好友朋友圈「恢复默认封面」：清掉 peer 专属背景 → 刷新 cover state */
  const resetPeerCover = async () => {
    if (!peerId) return;
    if (!window.confirm('确定恢复该好友的默认朋友圈封面？')) return;
    setCoverBusy(true);
    try {
      await removePeerBg('wx', peerId);
      setCover(null);
      onToast('已恢复默认封面');
    } catch {
      onToast('恢复失败');
    } finally {
      setCoverBusy(false);
    }
  };

  /** 从手机相册选图换封面：压缩 → 存本地 IndexedDB → 立即生效 */
  const pickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCoverBusy(true);
    try {
      const dataUrl = await readImageFile(file, 1280);
      const rec = await setWxBg('moments', dataUrl);
      setCover(rec.data);
      onToast('封面已更换');
    } catch (e) {
      onToast(e instanceof Error ? e.message : '封面保存失败');
    } finally {
      setCoverBusy(false);
      if (coverRef.current) coverRef.current.value = '';
    }
  };

  /** 47-b 进他朋友圈点击封面上传：压缩 → setPeerBg('wx', peerId) → 刷新 cover state → toast。
   *  新需求取代了 chat-settings 的「恢复默认朋友圈封面」入口（恢复默认按钮仍保留在顶部右侧）。 */
  const pickPeerCover = async (files: FileList | null) => {
    if (!peerId) return;
    const file = files?.[0];
    if (!file) return;
    setCoverBusy(true);
    try {
      const dataUrl = await readImageFile(file, 1280);
      await setPeerBg('wx', peerId, dataUrl);
      setCover(dataUrl);
      onToast(`已为${shownName}更换朋友圈封面`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : '封面保存失败');
    } finally {
      setCoverBusy(false);
      if (peerCoverRef.current) peerCoverRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 滚动容器：封面 + 动态列表（封面随内容滚动，同微信） */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="wx-moments-list"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 230)}
      >
        {/* 封面：自定义上传图（无则默认风景照）+ 底部渐晕；点击封面图直接换（从手机上传，永久保存）。
         *  47-b：!isMine（进他朋友圈）也支持点击封面图上传换封面（新需求，替代 chat-settings 的「恢复默认朋友圈封面」入口） */}
        <div className="relative h-[300px]">
          {isMine ? (
            <button
              type="button"
              data-testid="wx-cover-change"
              aria-label="更换封面"
              title="点击更换封面"
              onClick={() => coverRef.current?.click()}
              disabled={coverBusy}
              className="absolute inset-0 block h-full w-full cursor-pointer disabled:cursor-default"
            >
              <img
                src={cover ?? '/wx/moments-cover.png'}
                alt="朋友圈封面，点击可更换"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
          ) : (
            <button
              type="button"
              data-testid="wx-moments-peer-cover-change"
              aria-label={`更换${shownName}的朋友圈封面`}
              title="点击上传封面"
              onClick={() => peerCoverRef.current?.click()}
              disabled={coverBusy || !peerId}
              className="absolute inset-0 block h-full w-full cursor-pointer disabled:cursor-default"
            >
              <img
                src={cover ?? '/wx/moments-cover.png'}
                alt={`${shownName}的朋友圈封面，点击可更换`}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {/* 47-b 视觉提示徽标：左上角相机图标 + 「点击更换」文案，让用户知道封面可点击上传。
               *  pointer-events-none 让点击穿透到 button 本身触发文件选择 */}
              {peerId && (
                <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 backdrop-blur">
                  <Camera className="h-4 w-4 text-white" strokeWidth={1.8} />
                  <span className="text-[11px] text-white">点击更换</span>
                </div>
              )}
            </button>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent"
            aria-hidden="true"
          />
          {/* 昵称 + 头像：微信同款，头像一半探出封面下沿 */}
          <div className="absolute -bottom-[30px] right-4 flex items-end gap-3">
            <span className="pb-2 text-[17px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {shownName}
            </span>
            <span className="block rounded-[8px] shadow-lg ring-[2.5px] ring-white">
              <WxAvatar src={shownAvatar} alt={shownName} size={68} />
            </span>
          </div>
        </div>

        {/* 「1条新消息」气泡（微信同款深色胶囊：最新互动人头像 + 条数；点开互动消息页并全部已读）。
            放在封面之下、动态列表之前，与真机一致 */}
        {isMine && noticeBadge.count > 0 && (
          <div className="flex justify-center pb-1 pt-10">
            <button
              type="button"
              data-testid="wx-moments-pill"
              aria-label={`${noticeBadge.count}条新消息`}
              onClick={onOpenNotices}
              className="flex items-center gap-2.5 rounded-[4px] bg-black/70 px-3 py-2 text-white shadow-md backdrop-blur active:bg-black/80 dark:bg-white/20"
            >
              <WxAvatar src={noticeBadge.avatar} alt="" size={26} />
              <span className="text-[14px]">{noticeBadge.count}条新消息</span>
            </button>
          </div>
        )}

        {posts.length === 0 ? (
          <div className="flex flex-col items-center pt-[88px] text-black/35 dark:text-white/35">
            <Camera className="h-9 w-9" strokeWidth={1.2} />
            <p className="mt-3 text-[14px]">{owner ? 'TA 还没有发过动态' : '还没有动态'}</p>
            {!owner && <p className="mt-1 text-[12.5px]">点右上角相机，发布第一条朋友圈吧</p>}
          </div>
        ) : (
          <div className="pt-[40px]">
            {posts.map((p) => (
              <MomentRow
                key={p.id}
                post={p}
                meName={me.name}
                menuOpen={menuId === p.id}
                onToggleMenu={() => setMenuId(menuId === p.id ? null : p.id)}
                onToggleLike={() => {
                  onToggleLike(p.id);
                  setMenuId(null);
                }}
                onComment={(text, reply) => onComment(p.id, text, reply)}
                onDelete={() => {
                  onDelete(p.id);
                  setMenuId(null);
                }}
                onDeleteComment={onDeleteComment ? (commentId) => onDeleteComment(p.id, commentId) : undefined}
                onEditRequest={onEditRequest ? () => onEditRequest(p) : undefined}
                onUpgradeCard={p.textCard ? () => void handleUpgradeCard(p) : undefined}
                onRegenImage={
                  // A2 重新生成入口：仅引擎升级过的图（textCardUpgraded === true）有；用户手动发的图无此入口
                  p.textCardUpgraded === true && p.images.length > 0
                    ? () => setGenSheet({ mode: 'regen', postId: p.id, desc: p.textCardDesc ?? '' })
                    : undefined
                }
                cardBusy={upgradingCardId === p.id}
              />
            ))}
            <p className="py-6 text-center text-[12px] text-black/25 dark:text-white/25">没有更多了</p>
          </div>
        )}
        {isMine && (
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickCover(e.target.files)}
          />
        )}
        {/* 47-b 进他朋友圈点击封面上传：peer 专属文件 input（与 coverRef 分开，避免 onChange 混淆）。
         *  无 peerId 时（owner 但无 peerId 的兜底场景）不渲染，按钮 disabled 已保险 */}
        {!isMine && peerId && (
          <input
            ref={peerCoverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void pickPeerCover(e.target.files)}
          />
        )}
      </div>

      {/* 顶部导航（悬浮在封面上）：滚过封面后切换为白底黑字并显示「朋友圈」标题
          wx-moments-nav：朋友圈顶部导航锚点（自定义 CSS 示例模板可改导航底色） */}
      <div
        className={`wx-moments-nav absolute inset-x-0 top-0 z-10 pt-[54px] transition-colors duration-200 ${
          scrolled
            ? 'bg-white/95 shadow-[0_0.5px_0_rgba(0,0,0,0.1)] backdrop-blur dark:bg-[#111111]/95 dark:shadow-[0_0.5px_0_rgba(255,255,255,0.12)]'
            : ''
        }`}
      >
        <div className="flex h-11 items-center justify-between px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-moments-back"
            onClick={onBack}
            className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
              scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
            }`}
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <span className={`text-[17px] font-medium ${scrolled ? '' : 'hidden'}`}>朋友圈</span>
          {isMine ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="互动消息"
                title="与我的互动消息"
                data-testid="wx-moments-notices"
                onClick={onOpenNotices}
                className={`relative rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                  scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                }`}
              >
                <Bell className="h-[21px] w-[21px]" strokeWidth={1.8} />
                {noticeBadge.count > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#FA5151]" aria-hidden="true" />}
              </button>
              <button
                type="button"
                aria-label="发布朋友圈"
                data-testid="wx-moments-compose"
                onClick={onCompose}
                className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                  scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                }`}
              >
                <Camera className="h-[22px] w-[22px]" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center justify-end gap-1" style={{ minWidth: 60 }}>
              {peerId && cover && (
                <button
                  type="button"
                  aria-label="恢复默认封面"
                  title="恢复默认封面"
                  data-testid="wx-moments-reset-cover"
                  onClick={() => void resetPeerCover()}
                  disabled={coverBusy}
                  className={`rounded-full p-1 active:bg-black/10 dark:active:bg-white/10 ${
                    scrolled ? 'text-black/75 dark:text-white/75' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
                  }`}
                >
                  <Undo2 className="h-[20px] w-[20px]" strokeWidth={1.8} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* A1/A2「生成图片」弹层：文字图片卡片升级真图 / 升级图重新生成（同款弹层，描述预填可改） */}
      {genSheet && (
        <MomentImageGenSheet
          title={genSheet.mode === 'upgrade' ? '生成图片' : '重新生成图片'}
          initialDesc={genSheet.desc}
          busy={genSheetBusy}
          error={genSheetError}
          onClose={() => (genSheetBusy ? undefined : setGenSheet(null))}
          onSubmit={(d) => void submitMomentGen(d)}
        />
      )}
    </div>
  );
}

// ---------------- 发布朋友圈页 ----------------

function ComposeMomentsPage({
  onCancel,
  onPublish,
  onToast,
}: {
  onCancel: () => void;
  /** 发表：正文 + 配图 + 位置名（可选；入库/互动队列由动态引擎统一处理） */
  onPublish: (text: string, images: string[], location?: string) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [showLoc, setShowLoc] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const canPost = (text.trim().length > 0 || images.length > 0) && !busy;

  const pick = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    setErr('');
    try {
      const room = 9 - images.length;
      const list = Array.from(files).slice(0, Math.max(0, room));
      const urls: string[] = [];
      for (const f of list) urls.push(await readImageFile(f));
      setImages((prev) => [...prev, ...urls].slice(0, 9));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片读取失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：取消 / 发表 */}
      <div className="pt-[54px]">
        <div className="flex h-12 items-center justify-between px-4">
          <button
            type="button"
            data-testid="wx-compose-cancel"
            onClick={onCancel}
            className="text-[16px] active:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="wx-compose-submit"
            disabled={!canPost}
            onClick={() => onPublish(text.trim(), images, location.trim() || undefined)}
            className={`rounded-[5px] px-4 py-1.5 text-[15px] font-medium transition-colors ${
              canPost
                ? 'bg-[#07C160] text-white active:bg-[#06AD56]'
                : 'bg-black/[0.06] text-black/25 dark:bg-white/10 dark:text-white/30'
            }`}
          >
            发表
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <textarea
          ref={textRef}
          data-testid="wx-compose-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="这一刻的想法..."
          rows={5}
          autoFocus
          className="w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
        />

        {/* 图片选择网格 */}
        <div className="mt-2 grid max-w-[268px] grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative aspect-square">
              <img src={src} alt={`已选图片${i + 1}`} className="h-full w-full rounded-[4px] object-cover" />
              <button
                type="button"
                aria-label={`移除图片${i + 1}`}
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {images.length < 9 && (
            <button
              type="button"
              aria-label="添加图片"
              data-testid="wx-compose-add-img"
              onClick={() => fileRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-[4px] border border-dashed border-black/15 bg-[#F7F7F7] text-black/30 active:bg-black/10 dark:border-white/15 dark:bg-[#1E1E1E] dark:text-white/30"
            >
              {busy ? (
                <Loader2 className="h-7 w-7 animate-spin" strokeWidth={1.6} />
              ) : (
                <Plus className="h-8 w-8" strokeWidth={1.1} />
              )}
            </button>
          )}
        </div>
        {busy && <p className="mt-2 text-[13px] text-black/40 dark:text-white/40">正在处理图片…</p>}
        {err && <p className="mt-2 text-[13px] text-red-500">{err}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void pick(e.target.files)}
        />
      </div>

      {/* 底部：表情面板 + 所在位置 / 表情 / 提醒谁看 / 谁可以看（预留底部横杠安全区） */}
      <div className="shrink-0 border-t border-black/[0.06] pb-[14px] dark:border-white/[0.08]">
        {showEmoji && (
          <div className="px-3 pt-2">
            <MomentsEmojiPanel
              onPick={(e) => insertEmojiAtCursor(textRef, text, e, setText)}
              onClose={() => setShowEmoji(false)}
            />
          </div>
        )}
        {(
          [
            ['所在位置', location, 'loc', <MapPin key="l" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['表情', '', 'emoji', <Smile key="e" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['提醒谁看', '', 'todo', <AtSign key="a" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
            ['谁可以看', '公开', 'todo', <User key="u" className="h-[19px] w-[19px]" strokeWidth={1.8} />],
          ] as Array<[string, string, string, React.ReactNode]>
        ).map(([label, value, act, icon], i) => (
          <div key={label} className="relative">
            {i > 0 && <span className="absolute left-0 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
            <button
              type="button"
              data-testid={`wx-compose-${label}`}
              onClick={() => {
                if (act === 'loc') setShowLoc(true);
                else if (act === 'emoji') setShowEmoji((v) => !v);
                else if (label === '谁可以看') onToast('谁可以看：公开');
                else onToast(`「${label}」暂未开放`);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="text-black/55 dark:text-white/55">{icon}</span>
              <span className="min-w-0 flex-1 text-[15.5px]">{label}</span>
              {value && act === 'loc' && (
                <>
                  <span className="max-w-[160px] truncate text-[15px] text-black/45 dark:text-white/45" data-testid="wx-compose-location-value">{value}</span>
                  <span
                    role="button"
                    aria-label="清除位置"
                    data-testid="wx-compose-location-clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation('');
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/25 text-white active:bg-black/40 dark:bg-white/25"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </span>
                </>
              )}
              {!value && <ChevronRight className="h-4 w-4 shrink-0 text-black/20 dark:text-white/20" strokeWidth={2} />}
            </button>
          </div>
        ))}
      </div>

      {/* 位置选择（复用聊天发送位置的内置地点/自定义位置页；选中即回填位置名） */}
      {showLoc && (
        <div className="absolute inset-0 z-30">
          <LocationPickerPage
            onClose={() => setShowLoc(false)}
            onSend={(name) => {
              setLocation(name);
              setShowLoc(false);
            }}
            onToast={onToast}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- 新的朋友页（按时间分组；待处理申请点「查看」进详情；AI 加回申请同列表展示） ----------------

function NewFriendsPage({
  reqs,
  onBack,
  onGoAdd,
  onOpenReq,
}: {
  reqs: WxFriendReq[];
  onBack: () => void;
  onGoAdd: () => void;
  /** 点申请行/查看 → 好友申请详情页 */
  onOpenReq: (r: WxFriendReq) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WxFriendReq[]>();
    for (const r of reqs) {
      const k = fmtReqDayLabel(r.time);
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [reqs]);

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-newfriends-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">新的朋友</div>
          <button
            type="button"
            data-testid="wx-newfriends-add"
            onClick={onGoAdd}
            className="text-[15px] active:opacity-50"
          >
            添加朋友
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 搜索框（点击进入添加朋友） */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mx-3 mt-1 flex h-[38px] w-[calc(100%-24px)] items-center justify-center gap-1.5 rounded-[6px] bg-white text-[14px] text-black/30 active:bg-black/5 dark:bg-[#1E1E1E] dark:text-white/30"
        >
          <Search className="h-4 w-4" strokeWidth={2} />
          搜索 账号/手机号
        </button>

        {/* 添加手机联系人 */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mt-2 flex w-full items-center gap-3 border-y border-black/[0.05] bg-white px-4 py-3 text-left active:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <Phone className="h-[26px] w-[26px] text-[#07C160]" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[16px]">添加手机联系人</span>
          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>

        {reqs.length === 0 ? (
          <p className="py-14 text-center text-[13.5px] text-black/35 dark:text-white/35">
            暂无新的朋友通知，去「添加朋友」认识新朋友吧
          </p>
        ) : (
          groups.map(([label, list]) => (
            <div key={label}>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/45 dark:text-white/45">{label}</p>
              <div className="bg-white dark:bg-[#1A1A1A]">
                {list.map((r) => {
                  const status = r.status ?? 'accepted';
                  return (
                    <button
                      type="button"
                      key={`${r.id}-${r.time}`}
                      data-testid={`wx-req-${r.name}`}
                      onClick={() => onOpenReq(r)}
                      className="flex w-full items-center gap-3 border-b border-black/[0.05] px-4 py-2.5 text-left last:border-b-0 active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                    >
                      <WxAvatar src={r.avatar} alt={r.name} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px]">{r.name}</p>
                        <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{r.message}</p>
                      </div>
                      {status === 'pending' ? (
                        <span
                          className="shrink-0 rounded-[4px] border border-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-[#07C160] active:bg-[#07C160]/10"
                          data-testid={`wx-req-status-${r.name}`}
                        >
                          查看
                        </span>
                      ) : (
                        <span className="shrink-0 text-[14px] text-black/35 dark:text-white/35" data-testid={`wx-req-status-${r.name}`}>
                          {status === 'rejected' ? '已拒绝' : '已添加'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------- 好友申请详情页（新的朋友点申请 / 搜索结果点人进入；req=null = 搜索资料预览模式） ----------------

function FriendReqDetailPage({
  req,
  contact,
  liveAvatar,
  onBack,
  onAccept,
  onReject,
  onBlock,
  onVerify,
  onToast,
}: {
  /** 好友申请（null = 搜索结果资料预览：还没有申请，走「前往验证」发申请） */
  req: WxFriendReq | null;
  /** 申请对应的联系人（被彻底删除时为 null：展示快照，验证按钮置灰） */
  contact: ContactRecord | null;
  /** 头像实时解析（换头像后历史申请/快照立即显示当前头像） */
  liveAvatar: (snapshot: string | null | undefined, ref: { peerId?: string | null; name?: string | null }) => string | null;
  onBack: () => void;
  /** 同意申请（前往验证，pending AI 申请）：宿主恢复好友关系 + 状态流转 + 刷新 */
  onAccept: (r: WxFriendReq) => void;
  /** 拒绝申请：AI 停止再申请 */
  onReject: (r: WxFriendReq) => void;
  /** 加入黑名单 */
  onBlock: (r: WxFriendReq | ContactRecord) => void;
  /** 资料预览模式「前往验证」：进申请添加朋友页 */
  onVerify: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const status = req?.status ?? 'accepted';
  const pending = req != null && status === 'pending';
  const peerName = req?.name ?? (contact ? displayNameOf(contact) : '对方');
  const peerId = req?.contactId ?? contact?.id ?? null;
  const avatar = liveAvatar(req?.avatar ?? contact?.avatar ?? null, { peerId, name: peerName });

  // 验证消息线程：旧数据（无 thread）由单条 message 起始展开；资料预览模式无卡片区
  const thread: FriendReqThreadMsg[] =
    req?.thread && req.thread.length > 0
      ? req.thread
      : req && req.message.trim()
        ? [{ who: req.fromChar ? 'peer' : 'me', text: req.message, time: req.time }]
        : [];

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const canReply = req != null && contact != null;
  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !req || replyBusy) return;
    const msg: FriendReqThreadMsg = { who: 'me', text, time: Date.now() };
    appendReqThread('wx', req.id, msg);
    setReplyText('');
    setReplyOpen(false);
    if (contact && (contact.persona ?? '').trim()) {
      setReplyBusy(true);
      try {
        if (shouldUseAltDecisionFlow('wx', req)) {
          // 小号发起的申请：每条回复都触发 AI 重新决策（同意/拒绝/先回复，按人设随时可以同意）
          await processAltFriendReq('wx', req.id, contact.id);
        } else {
          const reply = await genCharThreadReply('wx', contact, [...thread, msg], 'reply');
          if (reply) appendReqThread('wx', req.id, { who: 'peer', text: reply, time: Date.now() });
        }
      } catch {
        // 生成失败静默：用户消息已在线程里
      } finally {
        setReplyBusy(false);
      }
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-req-detail">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-reqdetail-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('资料设置暂未开放')}
            className="px-3 active:opacity-50"
          >
            <EllipsisGlyph />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 头部：头像 + 昵称 + 性别 + 备注名/朋友权限（对照微信好友申请详情） */}
        <div className="bg-white px-4 pb-5 pt-2 dark:bg-[#1A1A1A]">
          <div className="flex items-start gap-4">
            <WxAvatar src={avatar} alt={peerName} size={76} />
            <div className="min-w-0 flex-1 pt-1.5">
              <p className="flex items-center gap-1.5 text-[22px] font-semibold leading-tight">
                <span className="truncate">{peerName}</span>
                {contact?.gender === '男' && <User className="h-[19px] w-[19px] shrink-0 text-[#4D9CF8]" aria-hidden="true" strokeWidth={2} />}
                {contact?.gender === '女' && <User className="h-[19px] w-[19px] shrink-0 text-[#FF6B81]" aria-hidden="true" strokeWidth={2} />}
              </p>
              {/* 备注名 / 朋友权限（微信样式蓝字链接；入口暂未开放） */}
              <p className="mt-3 flex gap-6 text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
                <button type="button" onClick={() => onToast('设置备注名暂未开放')}>备注名</button>
                <button type="button" onClick={() => onToast('朋友权限暂未开放')}>朋友权限</button>
              </p>
              {contact?.region && <p className="mt-1.5 truncate text-[13px] text-black/40 dark:text-white/40">地区：{contact.region}</p>}
            </div>
          </div>
        </div>

        {/* 验证消息记录（我/对方 多轮对话 + 附图 + 回复） */}
        {thread.length > 0 && (
          <div className="bg-white px-4 pb-5 dark:bg-[#1A1A1A]">
            <div className="rounded-[8px] border border-black/10 p-4 dark:border-white/15" data-testid="wx-reqdetail-thread">
              {thread.map((m, i) => (
                <p key={`${m.time}-${i}`} className="break-words text-[15.5px] leading-[1.9]">
                  {m.who === 'me' ? '我: ' : `${peerName}: `}
                  {m.text}
                </p>
              ))}
              {req?.extras?.photos && req.extras.photos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {req.extras.photos.map((p, i) => (
                    <img key={i} src={p} alt={`照片${i + 1}`} className="h-16 w-16 rounded-[6px] object-cover" />
                  ))}
                </div>
              )}
              {req?.extras?.image && (
                <img src={req.extras.image} alt="申请附图" className="mt-3 max-h-[180px] w-auto max-w-full rounded-[6px] object-cover" />
              )}
              {replyBusy ? (
                <p className="mt-1 text-[15px] text-black/35 dark:text-white/35" data-testid="wx-reqdetail-reply-busy">
                  对方正在回复…
                </p>
              ) : canReply ? (
                replyOpen ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value.slice(0, 60))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void sendReply();
                        }
                      }}
                      placeholder={`回复 ${peerName}`}
                      autoFocus
                      data-testid="wx-reqdetail-reply-input"
                      className="h-9 min-w-0 flex-1 rounded-[6px] bg-black/[0.04] px-3 text-[14.5px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      data-testid="wx-reqdetail-reply-send"
                      onClick={() => void sendReply()}
                      className="shrink-0 rounded-[6px] bg-[#07C160] px-4 py-1.5 text-[14px] font-medium text-white active:bg-[#06AD56]"
                    >
                      发送
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="wx-reqdetail-reply"
                    onClick={() => setReplyOpen(true)}
                    className="mt-1 block text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
                  >
                    回复
                  </button>
                )
              ) : null}
            </div>
          </div>
        )}

        {/* 来源（资料预览模式附微信号，便于确认搜索到的人） */}
        <div className="mt-3 bg-white dark:bg-[#1A1A1A]">
          <div className="flex items-center gap-8 px-4 py-4">
            <span className="w-[64px] shrink-0 text-[17px]">来源</span>
            <span className="min-w-0 flex-1 text-[16px] text-black/40 dark:text-white/40" data-testid="wx-reqdetail-source">
              {req?.source || (req ? '朋友验证消息' : SOURCE_SEARCH_WX)}
            </span>
          </div>
          {!req && contact && (
            <div className="flex items-center gap-8 border-t border-black/[0.05] px-4 py-4 dark:border-white/[0.08]">
              <span className="w-[64px] shrink-0 text-[17px]">微信号</span>
              <span className="min-w-0 flex-1 truncate text-[16px] text-black/40 dark:text-white/40">
                {contact.wechatId || contact.qqId || contact.phone || '未设置'}
              </span>
            </div>
          )}
        </div>

        {/* 前往验证（同意）/ 拒绝 / 状态 */}
        {req == null ? (
          <button
            type="button"
            data-testid="wx-reqdetail-accept"
            onClick={() => contact && onVerify(contact)}
            disabled={!contact}
            className="mt-3 w-full bg-white py-[17px] text-center text-[17px] text-[#576B95] active:bg-black/[0.04] disabled:opacity-40 dark:bg-[#1A1A1A] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
          >
            前往验证
          </button>
        ) : pending ? (
          req.fromChar ? (
            <div className="mt-3 flex gap-px">
              <button
                type="button"
                onClick={() => onAccept(req)}
                disabled={!contact}
                className="flex-1 bg-white py-[17px] text-center text-[17px] text-[#576B95] active:bg-black/[0.04] disabled:opacity-40 dark:bg-[#1A1A1A] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
              >
                前往验证
              </button>
              <button
                type="button"
                data-testid="wx-reqdetail-reject"
                onClick={() => onReject(req)}
                className="flex-1 bg-white py-[17px] text-center text-[17px] text-red-500 active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
              >
                拒绝
              </button>
            </div>
          ) : (
            // 小号发起、等待 AI 决策的申请：无同意/拒绝按钮（决策在对方手里），可继续回复验证消息
            <p
              className="mt-3 bg-white py-[17px] text-center text-[16px] text-black/35 dark:bg-[#1A1A1A] dark:text-white/35"
              data-testid="wx-reqdetail-waiting"
            >
              等待对方验证
            </p>
          )
        ) : (
          <p className="mt-3 bg-white py-[17px] text-center text-[16px] text-black/35 dark:bg-[#1A1A1A] dark:text-white/35" data-testid="wx-reqdetail-done">
            {status === 'rejected' ? '已拒绝该申请' : '已添加'}
          </p>
        )}
      </div>

      {/* 底部：加入黑名单 | 投诉 */}
      <div className="flex shrink-0 items-center justify-center gap-4 pb-[30px] pt-3">
        <button type="button" data-testid="wx-reqdetail-block" onClick={() => req ? onBlock(req) : contact && onBlock(contact)} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
          加入黑名单
        </button>
        <span className="h-4 w-px bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <button type="button" onClick={() => onToast('投诉暂未开放')} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
          投诉
        </button>
      </div>
    </div>
  );
}

// ---------------- 申请添加朋友页（添加朋友搜索结果点人进入；发送 = 记录申请 + 加为好友） ----------------

const WX_COMMON_GREETING_KEY = 'wx-common-greeting';

function ApplyFriendPage({
  me,
  target,
  onBack,
  onSend,
  onToast,
}: {
  me: WxUser;
  /** 要添加的联系人（搜索结果） */
  target: ContactRecord;
  onBack: () => void;
  /** 发送申请：宿主加好友 + 写「新的朋友」+ 恢复被删状态 */
  onSend: (payload: { greeting: string; extras: FriendReqExtras }) => void;
  onToast: (m: string) => void;
}) {
  const [greeting, setGreeting] = useState(() => {
    try {
      // 多账号 v2（Task 40-2a）：常用招呼语按微信当前账号作用域（调用时现算）
      // 招呼语会进对方 AI 的上下文：恒用真名（用户规则：AI 永不知道机主昵称）
      const saved = window.localStorage.getItem(accLs(WX_COMMON_GREETING_KEY, 'wx'));
      return saved?.trim() || `我是${me.realName || me.name}`;
    } catch {
      return `我是${me.realName || me.name}`;
    }
  });
  const [image, setImage] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [permOpen, setPermOpen] = useState(false);
  const [permChat, setPermChat] = useState(true);
  const [permMoments, setPermMoments] = useState(true);
  const [permExercise, setPermExercise] = useState(true);
  const [hideMine, setHideMine] = useState(false);
  const [hideTheirs, setHideTheirs] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  const handleFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const src = await compressImageFile(f, 720);
    if (!src) {
      onToast('图片读取失败');
      return;
    }
    setImage(src);
  };

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = 4 - photos.length;
    if (room <= 0) {
      onToast('最多添加 4 张照片');
      return;
    }
    const picked = [...files].slice(0, room);
    const out: string[] = [];
    for (const f of picked) {
      const src = await compressImageFile(f, 720);
      if (src) out.push(src);
    }
    if (out.length === 0) {
      onToast('图片读取失败');
      return;
    }
    setPhotos((prev) => [...prev, ...out].slice(0, 4));
  };

  /** 灰色圆角卡（对照申请添加朋友页：打招呼内容/备注等输入区） */
  const cardCls = 'mx-4 rounded-[10px] bg-[#F6F6F6] dark:bg-[#242424]';
  /** 蓝字选择行（标签/备忘/照片/朋友权限） */
  const cellRow = 'flex h-[56px] w-full items-center justify-between px-4 text-left active:opacity-70';

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-3">
          <button type="button" aria-label="返回" data-testid="wx-apply-close" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-semibold">申请添加朋友</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 打招呼内容（灰卡：多行输入 + 分隔线 + 添加图片） */}
        <p className="px-6 pb-2 pt-4 text-[15px] text-black/45 dark:text-white/45">打招呼内容</p>
        <div className={`${cardCls} px-4 py-3`}>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value.slice(0, 100))}
            rows={4}
            data-testid="wx-apply-greeting"
            className="w-full resize-none bg-transparent text-[16px] leading-[1.7] caret-[#07C160] outline-none"
          />
          <div className="h-px bg-black/[0.07] dark:bg-white/[0.09]" aria-hidden="true" />
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" data-testid="wx-apply-image" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-[15px] text-black/40 active:opacity-60 dark:text-white/40">
              <ImageIcon className="h-[19px] w-[19px]" strokeWidth={1.8} />
              {image ? '重新添加图片' : '添加图片'}
            </button>
            {image && (
              <span className="ml-auto flex items-center gap-2">
                <img src={image} alt="打招呼附图" className="h-11 w-11 rounded-[6px] object-cover" />
                <button type="button" onClick={() => setImage(null)} aria-label="移除图片" className="text-[13px] text-black/40 active:opacity-60 dark:text-white/40">
                  移除
                </button>
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <button
          type="button"
          data-testid="wx-apply-common-greeting"
          onClick={() => {
            try {
              window.localStorage.setItem(accLs(WX_COMMON_GREETING_KEY, 'wx'), greeting.trim());
            } catch {
              // 忽略
            }
            onToast('已设为常用打招呼内容');
          }}
          className="mt-3 block px-6 text-[15.5px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
        >
          设为常用打招呼内容
        </button>

        {/* 备注（灰卡输入 + 自己昵称一键填入建议） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">备注</p>
        <div className={`${cardCls} flex h-[56px] items-center px-4`}>
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, 30))}
            placeholder="添加备注"
            data-testid="wx-apply-remark"
            className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>
        <button
          type="button"
          data-testid="wx-apply-remark-suggest"
          onClick={() => setRemark(me.name.slice(0, 30))}
          className="mt-3 block px-6 text-[15.5px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
        >
          {me.name} <span aria-hidden="true">↖</span>
        </button>

        {/* 标签 */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">标签</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-tags" onClick={() => setTagOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              {tags.length > 0 ? tags.join('、') : '添加标签'}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 备忘 */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">备忘</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-memo" onClick={() => setMemoOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">{memo || '添加备忘'}</span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 照片（≤4 张，随申请存档，详情页展示） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">照片</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-photos" onClick={() => photosRef.current?.click()} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              {photos.length > 0 ? `已添加 ${photos.length} 张` : '添加照片'}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {photos.map((p, i) => (
                <span key={i} className="relative">
                  <img src={p} alt={`照片${i + 1}`} className="h-16 w-16 rounded-[6px] object-cover" />
                  <button
                    type="button"
                    aria-label={`移除照片${i + 1}`}
                    onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={photosRef}
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              void handlePhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* 朋友权限（聊天/朋友圈/微信运动） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">朋友权限</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-perm" onClick={() => setPermOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              聊天、朋友圈{permExercise ? '、微信运动' : ''}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 朋友圈可见性（双向开关） */}
        <div className={`${cardCls} mt-4`}>
          <div className={cellRow}>
            <span className="text-[15.5px]">不让他看我的朋友圈和状态</span>
            <ChatToggle on={hideMine} onChange={setHideMine} accent="#07C160" testId="wx-apply-hide-mine" label="不让他看我的朋友圈和状态" />
          </div>
          <div className="h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
          <div className={cellRow}>
            <span className="text-[15.5px]">不看他(她)的朋友圈和状态</span>
            <ChatToggle on={hideTheirs} onChange={setHideTheirs} accent="#07C160" testId="wx-apply-hide-theirs" label="不看他(她)的朋友圈和状态" />
          </div>
        </div>

        <button
          type="button"
          data-testid="wx-apply-send"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onSend({
              greeting: greeting.trim() || `我是${me.realName || me.name}`,
              extras: { image, remark: remark.trim() || null, tags, memo: memo.trim() || null, photos, permChat, permMoments, permExercise, hideMine, hideTheirs },
            });
          }}
          className="mx-auto mt-10 block h-12 w-[240px] max-w-[72%] rounded-[14px] bg-[#07C160] text-[17px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
        >
          发送
        </button>
      </div>

      {/* 标签编辑弹窗 */}
      {tagOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setTagOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">添加标签</p>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="多个标签用逗号分隔"
              autoFocus
              className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
            />
            {tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded-[4px] bg-black/[0.05] px-2 py-1 text-[12.5px] dark:bg-white/10">
                    {t}
                    <button type="button" aria-label={`删除标签${t}`} onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
                      <X className="h-3 w-3" strokeWidth={2.4} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setTagOpen(false)} className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = tagDraft
                    .split(/[,,、\s]+/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 6);
                  if (next.length) setTags((prev) => [...new Set([...prev, ...next])].slice(0, 6));
                  setTagDraft('');
                  setTagOpen(false);
                }}
                className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 备忘编辑弹窗 */}
      {memoOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setMemoOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">添加备忘</p>
            <textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value.slice(0, 100))}
              placeholder="写点备忘（仅自己可见）"
              rows={3}
              autoFocus
              className="mt-3 w-full resize-none rounded-[8px] bg-black/[0.05] p-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
            />
            <div className="mt-3 flex gap-2.5">
              <button type="button" onClick={() => setMemoOpen(false)} className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemo(memoDraft.trim());
                  setMemoOpen(false);
                }}
                className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 朋友权限弹窗（聊天/朋友圈/微信运动） */}
      {permOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setPermOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">朋友权限</p>
            <div className="mt-2">
              {([['聊天', permChat, setPermChat], ['朋友圈', permMoments, setPermMoments], ['微信运动', permExercise, setPermExercise]] as const).map(
                ([label, on, set]) => (
                  <div key={label} className="flex h-12 items-center justify-between">
                    <span className="text-[15px]">{label}</span>
                    <ChatToggle on={on} onChange={set} accent="#07C160" label={label} />
                  </div>
                ),
              )}
            </div>
            <button type="button" onClick={() => setPermOpen(false)} className="mt-3 h-10 w-full rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80">
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 添加朋友页 ----------------

function AddFriendPage({
  contacts,
  me,
  onBack,
  onOpenReqDetail,
  onOpenChat,
  onToast,
}: {
  contacts: ContactRecord[];
  me: WxUser;
  onBack: () => void;
  /** 点搜索结果（非好友）→ 好友申请详情页（资料预览）→ 前往验证 → 申请添加朋友页 */
  onOpenReqDetail: (c: ContactRecord) => void;
  /** 点「发消息」：直接打开与该好友的聊天 */
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  const query = q.trim().toLowerCase();
  const searched = query.length > 0;
  const results = useMemo(() => {
    if (!query) return [];
    return contacts.filter(
      (c) =>
        c.kind !== 'user' &&
        ((c.phone ?? '').toLowerCase().includes(query) ||
          (c.wechatId ?? '').toLowerCase().includes(query) ||
          (c.qqId ?? '').toLowerCase().includes(query))
    );
  }, [contacts, query]);

  const options: Array<[string, string, string, React.ReactNode]> = [
    ['扫一扫', '扫描二维码名片', '#5A9CF8', <ScanLine key="1" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['手机联系人', '添加通讯录中的朋友', '#07C160', <Smartphone key="2" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['雷达', '添加身边的朋友', '#7B68EE', <Radar key="3" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['面对面建群', '与身边的朋友进入同一个群聊', '#07C160', <Users key="5" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['公众号', '获取更多资讯', '#5A9CF8', <Newspaper key="6" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['服务号', '获取更多购物信息和服务', '#F26D6D', <Wallet key="7" className="h-[21px] w-[21px]" strokeWidth={2} />],
  ];

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-addfriend-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">添加朋友</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 搜索框 */}
        <div className="px-3 pb-2 pt-1">
          <div className="flex h-[38px] items-center gap-2 rounded-[6px] bg-[#F2F2F2] px-3 dark:bg-[#1E1E1E]">
            <Search className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} />
            <input
              data-testid="wx-addfriend-query"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setErr('');
              }}
              placeholder="搜索 账号/手机号"
              aria-label="搜索微信号或手机号添加朋友"
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          {err && (
            <p className="mt-1.5 px-1 text-[12.5px] text-red-500" role="alert">
              {err}
            </p>
          )}
        </div>

        {searched ? (
          results.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[15px] text-black/45 dark:text-white/45">该用户不存在</p>
              <p className="mt-1.5 text-[12.5px] text-black/30 dark:text-white/30">
                换个手机号 / 微信号 / QQ号 试试，或先到「联系人」App 创建
              </p>
            </div>
          ) : (
            <div>
              {results.map((c) => {
                const added = isFriendIn(c, 'wx');
                return added ? (
                  <button
                    type="button"
                    key={c.id}
                    data-testid={`wx-add-result-${c.name}`}
                    onClick={() => onOpenChat(c)}
                    className="flex w-full items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 text-left active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                  >
                    <WxAvatar src={c.avatar} alt={c.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{c.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-black/40 dark:text-white/40">
                        微信号：{c.wechatId || c.qqId || c.phone || '未设置'}
                      </p>
                    </div>
                    <span
                      data-testid={`wx-add-chat-${c.name}`}
                      className="shrink-0 rounded-[5px] border border-[#07C160] px-3 py-1.5 text-[13.5px] font-medium text-[#07C160]"
                    >
                      发消息
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    key={c.id}
                    data-testid={`wx-add-result-${c.name}`}
                    onClick={() => onOpenReqDetail(c)}
                    className="flex w-full items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 text-left active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                  >
                    <WxAvatar src={c.avatar} alt={c.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{c.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-black/40 dark:text-white/40">
                        微信号：{c.wechatId || c.qqId || c.phone || '未设置'}
                      </p>
                    </div>
                    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
                  </button>
                );
              })}
              <p className="px-4 pt-2.5 text-[12.5px] leading-relaxed text-black/35 dark:text-white/35">
                该账号来自「联系人」App；点击搜索结果可查看资料并发送好友申请，已是好友的可直接发消息
              </p>
            </div>
          )
        ) : (
          <>
            {/* 功能入口列表 */}
            <div className="bg-white dark:bg-[#1A1A1A]">
              {options.map(([label, sub, color, icon], i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onToast(`「${label}」暂未开放`)}
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  {i > 0 && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
                  <WxTileIcon bg={color}>{icon}</WxTileIcon>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]">{label}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-black/35 dark:text-white/35">{sub}</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
                </button>
              ))}
            </div>

            {/* 我的二维码名片 */}
            <div className="flex flex-col items-center pb-6 pt-10">
              <div className="rounded-[12px] bg-white p-3.5 shadow-[0_3px_18px_rgba(0,0,0,0.09)] ring-1 ring-black/5 dark:ring-white/10">
                <PseudoQR seed={me.wechatId || me.id} size={172} />
              </div>
              <p className="mt-3 text-[12.5px] text-black/35 dark:text-white/35">扫一扫上面的二维码图案，加我微信</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 好友详情页（通讯录点好友进入，同微信） ----------------

function FriendDetailPage({
  friend,
  onBack,
  onOpenChat,
  onOpenMoments,
  onCall,
  onToast,
  onDeleteContact,
  branchInfo,
  onDeleteBranch,
}: {
  friend: ContactRecord;
  onBack: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenMoments: (c: ContactRecord) => void;
  /** Task 28-b 「音视频通话」ActionSheet 选项回调（voice/video）：宿主关详情页并经聊天页拨号（openVoiceCall 全链路） */
  onCall: (media: 'voice' | 'video') => void;
  onToast: (m: string) => void;
  /** 删除联系人（删除好友关系）：宿主弹二次确认；不传 = 隐藏（自己资料页） */
  onDeleteContact?: () => void;
  /** Task 37 角色分支：分支身份信息（仅分支角色传入；展示「X 的平行分支」说明） */
  branchInfo?: { parentName: string; createdAt: number } | null;
  /** Task 37 角色分支：删除该分支（宿主弹二次确认后真删）；不传 = 隐藏 */
  onDeleteBranch?: () => void;
}) {
  // 跨 App 跳转：点「朋友资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  // Task 28-b 「音视频通话」底部 ActionSheet（语音通话/视频通话 + 取消；点遮罩也可取消）
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  return (
    <div className="wx-fdetail-page absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：返回 + ··· */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fdetail-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('资料设置暂未开放')}
            className="px-3 active:opacity-50"
          >
            <EllipsisGlyph />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 头部：头像 + 名字 + 性别 + 微信号 */}
        <div className="bg-white px-4 py-5 dark:bg-[#1A1A1A]">
          <div className="flex items-start gap-4">
            <WxAvatar src={friend.avatar} alt={friend.name} size={64} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex items-center gap-1.5 text-[21px] font-semibold leading-tight">
                <span className="truncate">{friend.name}</span>
                {friend.gender === '男' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#4D9CF8]" aria-hidden="true" strokeWidth={2} />
                )}
                {friend.gender === '女' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#FF6B81]" aria-hidden="true" strokeWidth={2} />
                )}
              </p>
              <p className="mt-2 truncate text-[14px] text-black/45 dark:text-white/45">
                微信号：{friend.wechatId || friend.qqId || friend.phone || '未设置'}
              </p>
            </div>
          </div>
        </div>

        {/* 朋友资料（点击 → 联系人 App 对应联系人的编辑界面） */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-edit"
            onClick={() => {
              setPendingContactEdit(friend.id);
              switchToApp('contacts');
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">朋友资料</span>
              <span className="mt-1 block text-[13px] leading-[1.55] text-black/35 dark:text-white/35">
                添加朋友的备注名、电话、标签、备忘、照片等，并设置朋友权限。
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* Task 37 分支身份说明（仅分支角色可见） */}
        {branchInfo && (
          <div className="mt-2 bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <p className="flex items-center gap-1.5 text-[15px] font-medium">
              分支角色
              <span className="rounded-[3px] bg-[#07C160]/10 px-[5px] py-px text-[10px] font-normal leading-[14px] text-[#07C160]">分支</span>
            </p>
            <p className="mt-1 text-[13px] leading-[1.65] text-black/45 dark:text-white/45">
              「{branchInfo.parentName}」的平行分支 · {formatBranchDate(branchInfo.createdAt)}创建。与原角色从分支点起各自独立发展，聊天、记忆、朋友圈互不同步。
            </p>
          </div>
        )}

        {/* 朋友圈 / 视频号 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <WxMenuRow
            first
            label="朋友圈"
            testId="wx-fdetail-moments"
            onClick={() => onOpenMoments(friend)}
            icon={<span />}
          />
          <WxMenuRow
            label="视频号"
            onClick={() => onToast('视频号暂未开放')}
            icon={<span />}
          />
        </div>

        {/* 发消息 / 音视频通话 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-chat"
            onClick={() => onOpenChat(friend)}
            className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
          >
            <MessageCircle className="h-[21px] w-[21px]" strokeWidth={1.8} />
            发消息
          </button>
          <div className="relative">
            <span className="absolute inset-x-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
            <button
              type="button"
              data-testid="wx-fdetail-call"
              onClick={() => setCallSheetOpen(true)}
              className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
            >
              <Phone className="h-[21px] w-[21px]" strokeWidth={1.8} />
              音视频通话
            </button>
          </div>
        </div>

        {/* Task 37 删除该分支（真删：聊天/记忆/朋友圈一并清空且不可恢复；二次确认在宿主层） */}
        {onDeleteBranch && (
          <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
            <button
              type="button"
              data-testid="wx-fdetail-delbranch"
              onClick={onDeleteBranch}
              className="flex w-full items-center justify-center py-[15px] text-[16px] text-red-500 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              删除该分支
            </button>
          </div>
        )}

        {/* 删除联系人（删除好友关系；二次确认弹窗在宿主层，确认后从列表移除并关闭详情） */}
        {onDeleteContact && (
          <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
            <button
              type="button"
              data-testid="wx-fdetail-delete"
              onClick={onDeleteContact}
              className="flex w-full items-center justify-center py-[15px] text-[16px] text-red-500 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              删除联系人
            </button>
          </div>
        )}
      </div>

      {/* Task 28-b 音视频通话 ActionSheet：底部滑出卡片（容器样式与 WxPayMethodSheet 同款：黑色半透明遮罩
          + 底部圆角卡片滑入，选项行白底黑字、绿色图标；点遮罩/取消关闭。先关卡片再回调拨号，避免弹层叠在全局通话层上） */}
      {callSheetOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45"
          role="dialog"
          aria-label="音视频通话"
          data-testid="wx-fdetail-call-sheet"
          onClick={() => setCallSheetOpen(false)}
        >
          <style>{'@keyframes wxFdCallIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
          <div
            className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]"
            style={{ animation: 'wxFdCallIn 0.24s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
              <button
                type="button"
                data-testid="wx-fdetail-call-voice"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('voice');
                }}
                className="flex h-14 w-full items-center gap-3 px-4 text-left text-[17px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Phone className="h-[19px] w-[19px] shrink-0 text-[#07C160]" strokeWidth={1.9} aria-hidden="true" />
                语音通话
              </button>
              <div className="h-px bg-black/[0.05] dark:bg-white/[0.07]" aria-hidden="true" />
              <button
                type="button"
                data-testid="wx-fdetail-call-video"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('video');
                }}
                className="flex h-14 w-full items-center gap-3 px-4 text-left text-[17px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Video className="h-[19px] w-[19px] shrink-0 text-[#07C160]" strokeWidth={1.9} aria-hidden="true" />
                视频通话
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCallSheetOpen(false)}
              className="mt-3 h-14 w-full rounded-[10px] bg-white text-[17px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 我的资料页（个人资料，微信同款） ----------------

function ProfilePage({
  me,
  record,
  onBack,
  onToast,
}: {
  me: WxUser;
  /** 自己在「联系人 App」里的完整资料（性别 / 地区用） */
  record: ContactRecord | null;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  // 头像按 App 隔离：微信个人资料页换头像只写机主的 avatars.wx 槽位（合并语义），
  // 不影响 QQ/信息/电话/联系人全局头像；未设置过则 avatarFor 投影自动回退全局头像
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    void fileToAvatarDataUrl(f)
      .then((data) => updateContact(me.id, { avatars: { wx: data } }).then((rec) => ({ rec, data })))
      .then(({ rec, data }) => {
        // 第二十九轮「让 AI 知道我换头像了」：头像描述落库（异步识图）+ 给恋人角色写事件记忆
        if (rec) {
          noteAvatarChanged(me.id, 'wx', data, 'me');
          onToast('头像已更新');
        } else onToast('头像保存失败');
      })
      .catch(() => onToast('头像保存失败'));
  };
  // Task 30 资料编辑：名字/性别/地区/手机号/微信号点行弹修改框——统一写回机主联系人档案
  //（updateContact 全端广播：联系人 App/微信/QQ/信息/电话 + 设置个人信息（名字经 owner-profile-sync 镜像））；
  // 头像（按 App 槽位）与拍一拍文案（按 App 独立存储）是仅有的两个非全局项
  const [editRow, setEditRow] = useState<null | { key: string; label: string }>(null);
  const [editDraft, setEditDraft] = useState('');
  // 拍一拍文案（微信侧独立于 QQ）：本页挂载时读一次，保存后即时回显
  const [clapText, setClapText] = useState<string>(() => readWxClapText());
  const openEdit = (key: string, label: string, initial: string) => {
    setEditRow({ key, label });
    setEditDraft(initial);
  };
  const saveEdit = () => {
    const row = editRow;
    setEditRow(null);
    if (!row) return;
    const t = editDraft.trim();
    if (row.key === 'clap') {
      // 拍一拍文案：微信本地按账号隔离存储（「拍了拍」后缀，如「的小脑袋」；空 = 清除回退未设置）
      writeWxClapText(t);
      setClapText(t);
      onToast('拍一拍已保存');
      return;
    }
    if (!t) {
      onToast('内容不能为空');
      return;
    }
    // 全局写回：updateContact 触发 contact-updated 广播，微信 me 快照/联系人 App/设置个人信息同步刷新
    // 名字行 = 微信昵称（Task 32）：社交 App 里我显示的名字就是联系人 App 的「昵称」字段
    //（展示层 socialNameOf：昵称 ?? 真名；改这里立即生效）；真名在联系人 App 里改；
    // 昵称永不进 AI（人设/决策链路只传真名）。清空昵称 = 回退显示真实名字（normalizeText 空串 → null）
    const patch: Partial<ContactRecord> | null =
      row.key === 'name'
        ? { nickname: t }
        : row.key === 'gender'
          ? { gender: t }
          : row.key === 'region'
            ? { region: t }
            : row.key === 'phone'
              ? { phone: t }
              : row.key === 'wechat'
                ? { wechatId: t }
                : null;
    if (!patch) return;
    void updateContact(me.id, patch)
      .then((rec) => onToast(rec ? '已保存' : '保存失败'))
      .catch(() => onToast('保存失败'));
  };
  const clapShown = clapText ? `拍了拍${clapText}` : '未设置';
  const rows: Array<{ key: string; label: string; value: React.ReactNode }> = [
    { key: 'name', label: '名字', value: <span className="block max-w-[190px] truncate">{me.name}</span> },
    { key: 'gender', label: '性别', value: <span className="block max-w-[190px] truncate">{record?.gender || '未设置'}</span> },
    { key: 'region', label: '地区', value: <span className="block max-w-[210px] truncate">{record?.region || '美国边远小岛'}</span> },
    { key: 'phone', label: '手机号', value: <span className="block max-w-[190px] truncate">{maskPhone(me.phone)}</span> },
    { key: 'wechat', label: '微信号', value: <span className="block max-w-[190px] truncate">{me.wechatId || '未设置'}</span> },
    {
      key: 'qr',
      label: '我的二维码',
      value: <QrCode className="h-[20px] w-[20px] text-black/45 dark:text-white/45" strokeWidth={1.7} />,
    },
    { key: 'clap', label: '拍一拍', value: <span className="block max-w-[190px] truncate">{clapShown}</span> },
  ];
  /** 行点击 → 弹修改框（二维码行 toast 占位；其余按 key 取当前值预填） */
  const onRowClick = (key: string, label: string) => {
    if (key === 'qr') {
      onToast('我的二维码暂未开放');
      return;
    }
    if (key === 'clap') {
      openEdit('clap', '拍一拍', clapText);
      return;
    }
    const initial =
      key === 'name'
        ? me.name
        : key === 'gender'
          ? record?.gender || ''
          : key === 'region'
            ? record?.region || ''
            : key === 'phone'
              ? me.phone ?? ''
              : me.wechatId ?? '';
    openEdit(key, label, initial);
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-profile-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">个人资料</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="bg-white dark:bg-[#1A1A1A]">
          {/* 头像行：点击换头像（写 avatars.wx 槽位，仅微信生效；未设置时跟随全局头像） */}
          <button
            type="button"
            data-testid="wx-profile-avatar"
            aria-label="更换头像"
            onClick={() => avatarFileRef.current?.click()}
            className="flex w-full items-center px-4 py-[9px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1 text-[17px]">头像</span>
            <WxAvatar src={me.avatar} alt={me.name} size={60} />
            <ChevronRight className="ml-2 h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={onAvatarFile} />
          {/* 资料 / 二维码 / 拍一拍行（除二维码外点行均可修改：资料项全局写回，拍一拍文案微信独立） */}
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              data-testid={`wx-profile-${r.key}`}
              onClick={() => onRowClick(r.key, r.label)}
              className="relative flex w-full items-center px-4 py-[15px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="absolute left-4 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[17px]">{r.label}</span>
              <span className="mr-2 flex min-w-0 items-center justify-end text-right text-[15.5px] text-black/45 dark:text-white/45">
                {r.value}
              </span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          ))}
        </div>

      </div>
      {/* 资料修改弹窗（名字/性别/地区/手机号/微信号/拍一拍文案）：编辑消息弹窗同款样式 */}
      {editRow && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="wx-profile-edit-layer" onClick={() => setEditRow(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">修改{editRow.label}</p>
            <div className="px-4 pb-3 pt-2">
              <input
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                maxLength={editRow.key === 'clap' ? 30 : 30}
                autoFocus
                data-testid="wx-profile-edit-input"
                placeholder={editRow.key === 'clap' ? '如：的小脑袋（留空清除）' : `输入新的${editRow.label}`}
                className="w-full rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#07C160] dark:border-white/15 dark:bg-white/[0.06]"
              />
              {editRow.key === 'clap' && (
                <p className="pt-1.5 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">朋友双击你的头像拍一拍时会显示这个后缀</p>
              )}
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditRow(null)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-profile-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 微信设置页（含退出登录） ----------------

function WxSettingsPage({
  onBack,
  onLogout,
  onOpenAccountSwitch,
}: {
  onBack: () => void;
  onLogout: () => void;
  /** 多账号（Task 40-D）：「切换账号」行 → 打开切换子页 */
  onOpenAccountSwitch: () => void;
}) {
  const rows: { label: string; onClick?: () => void; testid?: string }[] = [
    { label: '账号与安全' },
    { label: '青少年模式' },
    { label: '关怀模式' },
    { label: '消息通知' },
    { label: '隐私' },
    { label: '通用' },
    { label: '关于微信' },
  ];
  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-settings-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">设置</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              data-testid={r.testid}
              onClick={r.onClick}
              className={`flex w-full items-center justify-between px-4 py-3 text-[16px] active:bg-black/5 ${
                i > 0 ? 'border-t border-black/5 dark:border-white/10' : ''
              }`}
            >
              <span>{r.label}</span>
              <ChevronRight className="h-4 w-4 opacity-30" strokeWidth={2} />
            </button>
          ))}
        </div>
        {/* 第三十四轮：「AI 主动消息」全局总开关删除（每角色独立设置入口保留在聊天设置里） */}
        {/* 切换账号：独立卡片行（设置列表外，退出登录上方；用户要求对照截图样式） */}
        <button
          type="button"
          data-testid="wx-account-entry"
          onClick={onOpenAccountSwitch}
          className="mt-4 w-full rounded-[10px] bg-white py-3 text-center text-[16px] active:bg-black/5 dark:bg-[#1A1A1A]"
        >
          切换账号
        </button>
        <button
          type="button"
          data-testid="wx-logout"
          onClick={onLogout}
          className="mt-2.5 w-full rounded-[10px] bg-white py-3 text-center text-[16px] text-red-500 active:bg-black/5 dark:bg-[#1A1A1A]"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}

// ---------------- 切换账号页（多账号 Task 40-D：灰底 + 顶部大标题区 + 账号卡列表 + 添加 + 管理） ----------------

/**
 * 可切换账号列表（Task 41）：大号恒在；小号只显示「登录过」的——登录历史标记 或 存量会话
 * （升级兼容：老用户已登录的小号即使还没历史标记也照常显示）；当前账号保底不消失。
 * 匿名号只属于电话/信息，不进微信。联系人 App 刚创建、从未登录过的小号不出现在这里，
 * 用「登录小号」登录成功后（markAccountLoginHistory）才出现。
 */
function readSwitchableAccounts(activeId: string): PhoneAccount[] {
  const hist = new Set(accountLoginHistory('wx'));
  return getAccounts().filter((a) => {
    if (a.kind === 'anon') return false;
    if (a.id === MAIN_ACCOUNT_ID) return true;
    if (a.id === activeId) return true;
    if (hist.has(a.id)) return true;
    // 存量兼容：该账号作用域下已有登录会话 = 登录过
    try {
      const key = a.id === MAIN_ACCOUNT_ID ? LS_SESSION : `${LS_SESSION}--${a.id}`;
      return !!window.localStorage.getItem(key);
    } catch {
      return false;
    }
  });
}

/** 小号/匿名号首字母圆：小号暖色系 / 匿名号灰黑系，深色模式降饱和变体（与 QQ 端同规则） */
function WxAccountBubble({ name, kind, size = 52 }: { name: string; kind: 'alt' | 'anon'; size?: number }) {
  const first = name.trim().charAt(0) || (kind === 'anon' ? '匿' : '小');
  const letter = /[a-z]/i.test(first) ? first.toUpperCase() : first;
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        kind === 'anon'
          ? 'bg-gradient-to-br from-[#A9AEB6] to-[#5C6167] dark:from-[#767B82] dark:to-[#41454B]'
          : 'bg-gradient-to-br from-[#FFB56E] to-[#EE7A4B] dark:from-[#A96B3F] dark:to-[#84502C]'
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {letter}
    </div>
  );
}

/** 微信双气泡 logo（切换账号页顶部灰 logo，第三十三轮对照参考截图：两只带眼睛的对话气泡，evenodd 挖孔） */
function WxSwitchLogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" className={className} aria-hidden="true">
      {/* 大气泡（左上）+ 两只眼睛挖孔 */}
      <path
        fillRule="evenodd"
        d="M25 9C13.4 9 4 16.6 4 26c0 5.3 3 10 7.7 13.1l-2.1 6.5a.9.9 0 0 0 1.3 1l7.9-4.2c2 .5 4 .7 6.2.7h.4a17.4 17.4 0 0 1-.9-5.6c0-8.5 8-15.4 17.9-15.4h.6C40.8 13.9 33.6 9 25 9zm-7 11.2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm14 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
      />
      {/* 小气泡（右下，尾巴右上）+ 两只眼睛挖孔 */}
      <path
        fillRule="evenodd"
        d="M41.2 24.2c-9.8 0-17.8 6.5-17.8 14.5s8 14.5 17.8 14.5c1.9 0 3.8-.2 5.5-.7l6.9 3.7a.9.9 0 0 0 1.3-1l-1.9-5.7c3.7-2.7 6-6.5 6-10.8 0-8-8-14.5-17.8-14.5zm-5.6 9a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm11.2 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z"
      />
    </svg>
  );
}

function WxAccountSwitchPage({ me, onBack, onLoginOther }: { me: WxUser; onBack: () => void; /** 「登录小号」自由登录成功 → 根组件 handleLogin（切作用域 + 记登录历史） */ onLoginOther: (u: WxUser) => void }) {
  // 页内 toast（App 根 toast 在提前 return 分支不渲染，同收藏页口径）
  const [toast, showToast] = useLocalToast();
  // 注册表账号列表：切换不刷新网页（v2 事件驱动）；删除成功后本地同步移除
  //（当前账号/大号不可删；正在被其他 App 使用的账号删除时自动切回大号 = 自动退出）
  // 匿名号不进微信（只属于电话/信息）：列表与切换一律排除。
  // 多账号 Task 41：只显示「登录过」的小号（登录历史 / 存量会话兼容 / 当前账号保底）——
  // 联系人 App 刚创建、从未登录过的小号不进列表，用下方「登录小号」登录后才出现。
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readSwitchableAccounts(getActiveAccountIdFor('wx')));
  // 当前微信账号 id（per-app）：切换事件到达时刷新快照（页面会随 MainScreen 复位跳回主界面，
  // 监听仅作兜底同步，绿点在跳转前一瞬已是新账号）
  const [activeId, setActiveId] = useState(() => getActiveAccountIdFor('wx'));
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      setAccounts(readSwitchableAccounts(getActiveAccountIdFor('wx')));
      setActiveId(getActiveAccountIdFor('wx'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);
  /** 「登录小号」自由登录墙（覆盖全页；slot=null 不绑定槽位，用任意小号账密登录）
   *  第三十四轮：「添加账号」也走这里——不再有新建账号弹层，添加账号 = 用账号密码登录 */
  const [loginOpen, setLoginOpen] = useState(false);
  /** 大号机主资料（跨账号直读大号库；不能用 me——小号视角下 me 是小号身份，Task 40-F 修正） */
  const [mainOwner, setMainOwner] = useState<{ name: string; wechatId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', wechatId: o.wechatId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 账号卡显示名（Task 40-S）：与登录后 App 内的展示口径一致——档案联系人展示名（备注>昵称>名字）优先，
  // 注册表名兼底。否则小号设了昵称后「切换账号以后名字跟切换账号那里不一样」。
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContacts()
      .then((all) => {
        if (alive) setProfiles(all);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const profileOf = (acc: PhoneAccount): ContactRecord | null =>
    profiles.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId)) ?? null;
  /** 管理模式：非当前、非大号的卡片左上出现 ⊖ 删除钮 */
  const [managing, setManaging] = useState(false);
  /** 删除二次确认目标（受控弹窗，禁 window.confirm） */
  const [delTarget, setDelTarget] = useState<PhoneAccount | null>(null);
  /** 删除时是否保留数据（规则：删除账号后数据是否保留由用户决定；默认不保留） */
  const [delKeepData, setDelKeepData] = useState(false);

  const confirmDelete = async () => {
    const target = delTarget;
    if (!target) return;
    setDelTarget(null);
    // v2 deleteAccount 为 async：正在使用中的账号删除时自动切回大号（退出该账号），不拦截；
    // keepData：保留该账号的聊天/记忆等本地数据（孤儿化不可见）
    const res = await deleteAccount(target.id, { keepData: delKeepData });
    setDelKeepData(false);
    if (res.ok) {
      setAccounts(getAccounts());
      setManaging(false);
      showToast(delKeepData ? '已删除该账号（数据已保留）' : '已删除该账号');
    } else {
      showToast(res.error || '删除失败');
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：返回 + 管理/完成（第三十三轮对照参考图：去居中标题，管理改黑色；有多个账号才显示管理） */}
      <div className="pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-account-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          {accounts.length > 1 && (
            <button
              type="button"
              data-testid="wx-account-manage"
              onClick={() => {
                setDelTarget(null);
                setManaging((v) => !v);
              }}
              className="ml-auto mr-1 min-w-[44px] text-right text-[16px] text-black/85 active:opacity-60 dark:text-white/85"
            >
              {managing ? '完成' : '管理'}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-7">
        {/* 顶部：微信双气泡灰 logo + 大字 + 短分隔线（第三十三轮对照参考截图重做） */}
        <div className="flex flex-col items-center" data-testid="wx-account-header">
          <WxSwitchLogoGlyph className="h-[58px] w-[58px] text-black/[0.15] dark:text-white/[0.15]" />
          <p className="mt-[58px] text-[24px] font-semibold tracking-[0.5px] text-black/90 dark:text-white/90">轻触头像以切换账号</p>
          <span className="mb-8 mt-7 h-px w-[190px] bg-black/[0.12] dark:bg-white/[0.14]" />
        </div>

        {/* 账号卡列表：白卡（深色深灰卡）；当前账号绿点 +「当前使用」；点其他卡 → switchAccountFor('wx') */}
        <div className="space-y-3.5">
          {accounts.map((acc) => {
            const isCurrent = acc.id === activeId;
            const isMain = acc.id === MAIN_ACCOUNT_ID;
            // 显示名与登录后一致（Task 40-S）：大号=机主联系人展示名（昵称优先），小号=档案展示名，回退注册表
            const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
            const name = isMain
              ? (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主'
              : (profileOf(acc) ? socialNameOf(profileOf(acc)!) : '') || acc.name;
            const wxid = isMain ? mainOwner?.wechatId || acc.wechatId : acc.kind === 'anon' ? acc.phone : acc.wechatId;
            const showDelete = managing && !isCurrent && !isMain;
            return (
              <div key={acc.id} className="relative">
                {showDelete && (
                  <button
                    type="button"
                    aria-label={`删除账号${name}`}
                    data-testid={`wx-account-delete-${acc.id}`}
                    onClick={() => setDelTarget(acc)}
                    className="absolute -left-3 -top-3 z-10 grid h-11 w-11 place-items-center active:opacity-70"
                  >
                    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#FA5151] shadow-sm" aria-hidden="true">
                      <span className="block h-[2px] w-[10px] rounded-full bg-white" />
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`wx-account-card-${acc.id}`}
                  onClick={() => {
                    if (managing || isCurrent) return;
                    // v2 不刷新：写 per-app 标记 + 派发事件；本页监听刷新绿点，根组件重读数据/登录态
                    switchAccountFor('wx', acc.id);
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[16px] bg-white px-4 py-[18px] text-left active:bg-black/[0.04] dark:bg-[#1A1A1A]"
                >
                  {(() => {
                    // 第三十二轮：切换账号页头像跟随微信——每个账号显示自己档案的微信槽位头像（avatars.wx），
                    // 没设过微信头像时：大号回退机主全局头像，小号/匿名号回退首字母彩色圆
                    const prof = isMain ? mainProfile : profileOf(acc);
                    const accAvatar = prof?.avatars?.wx ?? (isMain ? mainOwner?.avatar ?? null : null);
                    return accAvatar ? (
                      <WxAvatar src={accAvatar} alt={name} size={52} />
                    ) : (
                      <WxAccountBubble name={name} kind={acc.kind === 'anon' ? 'anon' : 'alt'} size={52} />
                    );
                  })()}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-[17px] font-medium">{name}</span>
                      {/* 第三十二轮：「大号/小号」徽标删除——列表里都是可登录的账号，不再分档位 */}
                    </span>
                    <span className="mt-1 block truncate text-[13px] text-black/35 dark:text-white/35">{wxid || '未设置'}</span>
                  </span>
                  {isCurrent && (
                    <span className="flex shrink-0 items-center gap-1.5" aria-label="当前使用">
                      <span className="h-2 w-2 rounded-full bg-[#07C160]" aria-hidden="true" />
                      <span className="text-[14px] text-black/85 dark:text-white/85">当前使用</span>
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          {/* 添加账号（第三十四轮：弹层删除，点击直接打开账号密码登录墙；账号在联系人 App 创建，
              登录成功后出现在上面的列表）：保留参考图白卡 + 虚线圆角方块样式 */}
          <button
            type="button"
            data-testid="wx-account-add"
            onClick={() => setLoginOpen(true)}
            className="flex h-[76px] w-full items-center gap-3.5 rounded-[16px] bg-white px-4 text-left active:bg-black/[0.04] dark:bg-[#1A1A1A]"
          >
            <span
              className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-[10px] border-[1.5px] border-dashed border-black/20 text-black/35 dark:border-white/25 dark:text-white/35"
              aria-hidden="true"
            >
              <Plus className="h-[22px] w-[22px]" strokeWidth={1.6} />
            </span>
            <span className="text-[15.5px] text-black/80 dark:text-white/80">添加账号</span>
          </button>

          {/* 第三十四轮：「登录账号」入口卡删除——「添加账号」本身就是账号密码登录，不再重复 */}
        </div>
      </div>

      {/* 登录小号：自由登录墙覆盖层（slot=null 不绑定槽位；返回关闭不退出微信）；「添加账号」同用此登录墙 */}
      {loginOpen && (
        <div className="absolute inset-0 z-30">
          <LoginScreen
            onLogin={(u) => {
              setLoginOpen(false);
              onLoginOther(u);
            }}
            onBack={() => setLoginOpen(false)}
          />
        </div>
      )}

      {/* 删除二次确认（微信风受控弹窗）：默认清数据；可勾选「保留数据」由用户决定（规则六） */}
      {delTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-8" onClick={() => setDelTarget(null)}>
          <div
            role="dialog"
            aria-label={`删除账号${delTarget.name}`}
            className="w-full max-w-[320px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[16px] font-medium">删除账号</p>
            <p className="mt-2.5 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
              将删除「{delTarget.name}」的账号与登录态；若微信、QQ 等正在使用该账号，会自动退出并回到大号。此操作不可恢复。
            </p>
            <label
              data-testid="wx-account-delete-keep"
              className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[8px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]"
            >
              <input
                type="checkbox"
                checked={delKeepData}
                onChange={(e) => setDelKeepData(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#07C160]"
              />
              <span className="text-[13px] leading-[1.6] text-black/70 dark:text-white/70">保留该账号的数据（聊天记录、记忆、朋友圈等；数据不可见也无法恢复登录）</span>
            </label>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                data-testid="wx-account-delete-cancel"
                onClick={() => setDelTarget(null)}
                className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-account-delete-confirm"
                onClick={confirmDelete}
                className="h-10 flex-1 rounded-[8px] bg-[#FA5151] text-[14px] font-medium text-white active:opacity-80"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <LocalToast msg={toast} />
    </div>
  );
}

// ---------------- 收藏页（「我」tab 收藏入口；数据在 @/lib/msg-favorites） ----------------

function WxFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在 App 根提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('wx'));

  const del = (id: string) => {
    removeFavorite('wx', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏（微信灰同聊天页） */}
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fav-back"
            onClick={onBack}
            className="flex items-center px-1 active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex flex-1 items-center justify-center pr-9">
            <span className="text-[17px] font-medium">收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="wx-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="wx-fav-item" className="rounded-[10px] bg-white p-3 dark:bg-[#1A1A1A]">
                <div className="flex items-center gap-2">
                  <WxAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/60 dark:text-white/60">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="wx-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[6px] bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.05]">
                  {f.stkUrl ? (
                    <img src={f.stkUrl} alt={f.content} className="max-h-[110px] w-auto max-w-full rounded object-contain" />
                  ) : f.imgSrc ? (
                    <img src={f.imgSrc} alt="收藏图片" className="max-h-[160px] w-auto max-w-full rounded object-cover" />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.45]">{f.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 页内 toast（已删除收藏等提示） */}
      <LocalToast msg={toast} />
    </div>
  );
}

// ---------------- 主界面（四 tab） ----------------

type Tab = 'chats' | 'contacts' | 'discover' | 'me';
type Page =
  | 'main'
  | 'moments'
  | 'compose'
  | 'momentNotices'
  | 'newFriends'
  | 'addFriend'
  | 'applyFriend'
  | 'friendReqDetail'
  | 'friendDetail'
  | 'friendMoments'
  | 'profile'
  | 'settings'
  | 'services'
  | 'stickers'
  | 'favorites'
  | 'album'
  | 'search'
  | 'momentsSettings'
  | 'accountSwitch'
  | 'look'
  | 'dress';

// ---------------- 看一看页（发现页 › 看一看：轻量内容流） ----------------

/** 看一看轻量内容流（标题 + 来源 + 阅读量） */
const LOOK_FEED: { title: string; source: string; reads: string }[] = [
  { title: '两个人最舒服的相处方式，是「分享欲」一直在', source: '情感研究所', reads: '12.6万' },
  { title: '把日常拍成电影感：手机光影小技巧合集', source: '摄影日记', reads: '8.3万' },
  { title: '今天也要好好吃饭：一周家常菜单灵感', source: '下厨房生活家', reads: '23.1万' },
  { title: '那些藏在聊天记录里的小心动', source: '夜谈心', reads: '5.7万' },
];

/** 看一看页（第二十二轮美化）：玻璃卡 22px + 胶囊控件 + 弱标题，
 *  space-y-7 统一节奏、纯色底（无底层光斑）。装扮入口已移至「发现」页 › 主题（末尾，原小程序位）。 */
function WxLookPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#F6F7F9] text-black dark:bg-[#111214] dark:text-white" data-testid="wx-look-page">
      {/* 顶部玻璃条：同色半透 + blur，滚动时内容从底下晕开 */}
      <div className="shrink-0 bg-[#F6F7F9]/75 pt-[54px] backdrop-blur-xl dark:bg-[#111214]/75">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-look-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">看一看</div>
        </div>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pb-10 pt-3">
        {/* 轻量内容流：独立玻璃卡 · 标题 + 来源胶囊 + 阅读量 */}
        <section aria-label="大家都在看">
          <p className="px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">大家都在看</p>
          <div className="mt-2.5 space-y-2.5">
            {LOOK_FEED.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onToast('内容即将上线')}
                className="flex w-full items-center gap-3 rounded-[22px] bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl ring-1 ring-white/70 transition-transform active:scale-[0.98] dark:bg-white/[0.06] dark:ring-white/[0.12]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium leading-snug">{f.title}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[10.5px] font-medium text-black/50 dark:bg-white/[0.08] dark:text-white/50">{f.source}</span>
                    <span className="text-[10.5px] text-black/35 dark:text-white/35">{f.reads}阅读</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/20 dark:text-white/20" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


// ---------------- 搜索页（对照微信真机：返回 + 搜索框「搜索本地或网络结果」+ 最近在搜 + 本地/网络结果） ----------------

/** 搜索历史持久化键（最近 10 条，新搜在前去重） */
const WX_SEARCH_HISTORY_KEY = 'wx-search-history';
const WX_SEARCH_HISTORY_MAX = 10;

/** 网络结果条目（GET /api/search 返回） */
interface WebSearchResult {
  name: string;
  url: string;
  snippet: string;
  host_name: string;
  date: string;
  favicon: string;
}

/** 聊天记录搜索命中（含所属会话，点击跳回对应聊天） */
interface MsgSearchHit {
  key: string;
  title: string;
  avatar: string | null;
  isGroup: boolean;
  group: ChatGroup | null;
  contact: ContactRecord | null;
  senderLabel: string;
  text: string;
  time: number;
}

/** 各类消息规整成可搜索文本（图片/撤回不入搜索，与聊天页 ChatSearchItem 同口径） */
function wxMsgSearchText(m: WxMsg): string {
  if (m.kind === 'sticker' && m.stk) return m.stk.meaning ? `[表情] ${m.stk.meaning}` : '[表情]';
  if (m.kind === 'redpacket' && m.rp) return `[红包] ${m.rp.blessing}`;
  if (m.kind === 'transfer' && m.tr) return `[转账] ${m.tr.note}`;
  if (m.kind === 'family') return '[亲属卡]';
  if (m.kind === 'location' && m.loc) return `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`;
  if (m.kind === 'notice' && m.notice) return `${m.notice.pre}${m.notice.accent}`;
  if (m.kind === 'voice') return m.voice?.transcript || m.voice?.localText ? `[语音] ${m.voice?.transcript || m.voice?.localText}` : '[语音]';
  return m.content;
}

function WxSearchPage({
  me,
  friends,
  groups,
  moments,
  onBack,
  onOpenChat,
  onOpenGroup,
  onOpenMoments,
  onToast,
}: {
  me: WxUser;
  friends: ContactRecord[];
  groups: ChatGroup[];
  moments: WxMoment[];
  onBack: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenGroup: (g: ChatGroup) => void;
  onOpenMoments: () => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const [hist, setHist] = useState<string[]>(() => loadStrList(WX_SEARCH_HISTORY_KEY));
  /** 网络结果：null = 未请求；配合 webState 渲染加载/失败/空态 */
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [webState, setWebState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const reqSeqRef = useRef(0);
  // 第五十六轮：古早/液态皮肤（搜索页是用户点名的「未应用界面」之一）——
  // 古早 = 复古纸底 + 银灰导航条 + 白底内凹搜索框；液态 = 玻璃搜索胶囊
  const skin = useChatSkin();
  // 跨 App：点网络结果 → 打开浏览器 App 导航到该网页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingBrowserUrl = useUI((s) => s.setPendingBrowserUrl);

  const key = kw.trim().toLowerCase();

  /** 网络结果：关键词变化防抖 600ms 请求 /api/search（竞态用序号守卫；setState 均在定时器/异步回调内） */
  useEffect(() => {
    const q = kw.trim();
    const seq = ++reqSeqRef.current;
    const timer = window.setTimeout(() => {
      if (!q) {
        setWebState('idle');
        setWebResults([]);
        return;
      }
      setWebState('loading');
      fetch(`/api/search?q=${encodeURIComponent(q)}&num=5`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { results?: WebSearchResult[] }) => {
          if (seq !== reqSeqRef.current) return;
          setWebResults(Array.isArray(data.results) ? data.results : []);
          setWebState('done');
        })
        .catch(() => {
          if (seq !== reqSeqRef.current) return;
          setWebResults([]);
          setWebState('error');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [kw]);

  /** 命中联系人：备注/昵称/名字/微信号匹配（微信好友） */
  const hitContacts = useMemo<ContactRecord[]>(() => {
    if (!key) return [];
    return friends
      .filter(
        (c) =>
          displayNameOf(c).toLowerCase().includes(key) ||
          c.name.toLowerCase().includes(key) ||
          (c.wechatId ?? '').toLowerCase().includes(key)
      )
      .slice(0, 5);
  }, [friends, key]);

  /** 命中群聊：群备注/群名匹配 */
  const hitGroups = useMemo<ChatGroup[]>(() => {
    if (!key) return [];
    return groups.filter((g) => (g.remark || g.name).toLowerCase().includes(key)).slice(0, 5);
  }, [groups, key]);

  /** 命中聊天记录：全量会话（好友 + 群）按摘要文本匹配，最新在前取 6 条 */
  const hitMsgs = useMemo<MsgSearchHit[]>(() => {
    if (!key) return [];
    const hits: MsgSearchHit[] = [];
    for (const c of friends) {
      for (const m of loadMsgs(c.id)) {
        if (m.kind === 'image' || m.recalled) continue;
        const text = wxMsgSearchText(m);
        if (!text || !text.toLowerCase().includes(key)) continue;
        hits.push({
          key: c.id,
          title: displayNameOf(c) || c.name,
          avatar: c.avatar,
          isGroup: false,
          group: null,
          contact: c,
          senderLabel: m.role === 'me' ? '我' : '',
          text,
          time: m.time,
        });
      }
    }
    for (const g of groups) {
      for (const m of loadGroupMsgs(g.id)) {
        if (m.kind === 'image' || m.kind === 'notice') continue;
        const text = (m.content ?? '').trim();
        if (!text || !text.toLowerCase().includes(key)) continue;
        hits.push({
          key: groupRowId(g.id),
          title: g.remark || g.name,
          avatar: g.avatar,
          isGroup: true,
          group: g,
          contact: null,
          senderLabel: m.role === 'me' ? '我' : m.senderName,
          text,
          time: m.time,
        });
      }
    }
    hits.sort((a, b) => b.time - a.time);
    return hits.slice(0, 6);
    // key 变化才重算（loadMsgs 同步读缓存，不进依赖）
     
  }, [key, friends, groups]);

  /** 命中朋友圈：正文/作者匹配取 3 条 */
  const hitMoments = useMemo<WxMoment[]>(() => {
    if (!key) return [];
    return moments
      .filter((p) => p.text.toLowerCase().includes(key) || p.authorName.toLowerCase().includes(key))
      .slice(0, 3);
  }, [moments, key]);

  /** 记录搜索词：去重后置顶，最多保留 10 条。
   *  注意直接同步写 localStorage（不走 setHist updater）——点网页结果会立刻切到浏览器 App、
   *  本页随之卸载，updater 会被 React 丢弃导致历史丢失 */
  const pushHist = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const next = [t, ...hist.filter((x) => x !== t)].slice(0, WX_SEARCH_HISTORY_MAX);
    saveStrList(WX_SEARCH_HISTORY_KEY, next);
    setHist(next);
  };
  const clearHist = () => {
    saveStrList(WX_SEARCH_HISTORY_KEY, []);
    setHist([]);
    onToast('已清空搜索历史');
  };
  const openWeb = (url: string) => {
    setPendingBrowserUrl(url);
    switchToApp('browser');
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const hasLocal = hitContacts.length + hitGroups.length + hitMsgs.length + hitMoments.length > 0;
  // 输入被清空时立即隐藏「网页」分区（webState 复位在防抖回调里，渲染层先拉住不闪旧结果）
  const showWeb = kw.trim() !== '' && webState !== 'idle';

  return (
    <div
      className={`absolute inset-0 z-40 flex h-full w-full flex-col text-black dark:text-white ${
        skin.retro
          ? /* 古早：复古纸底（白卡交给下方分区行自带） */ 'rt-root'
          : skin.liquid
            ? /* 液态：液态根渐变 */ 'lg-root'
            : 'bg-white dark:bg-[#111111]'
      }`}
    >
      {/* 顶栏：返回 + 搜索框（对照截图 1）；古早 = 银灰拟物导航条 + 白底内凹搜索框 */}
      <div className={`shrink-0 pt-[54px] ${skin.retro ? 'rt-bar' : ''}`}>
        <div className="flex h-12 items-center gap-1.5 px-2 pb-1">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-search-back"
            onClick={onBack}
            className={`shrink-0 active:opacity-50 ${skin.retro ? 'text-[#3A3E4C]' : 'rounded-full p-1'}`}
          >
            <ChevronLeft className={`h-[23px] w-[23px] ${skin.retro ? 'font-bold' : ''}`} strokeWidth={skin.retro ? 2.4 : 2.2} />
          </button>
          <div
            className={`flex h-[34px] min-w-0 flex-1 items-center gap-2 px-3 ${
              skin.retro
                ? /* 古早：白底内凹硬边搜索框 */ 'rt-search'
                : skin.liquid
                  ? /* 液态：玻璃搜索胶囊 */ 'lg-search rounded-full'
                  : 'rounded-[8px] bg-black/[0.05] dark:bg-white/[0.08]'
            }`}
          >
            <Search className={`h-4 w-4 shrink-0 ${skin.retro ? 'text-[#6A6E78]' : 'text-black/30 dark:text-white/30'}`} strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') pushHist(kw);
              }}
              placeholder="搜索本地或网络结果"
              data-testid="wx-search-input"
              aria-label="搜索本地或网络结果"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" data-testid="wx-search-clear" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {!key ? (
          /* 最近在搜（对照截图 1：标题 + 垃圾桶清空 + 时钟历史项） */
          hist.length > 0 && (
            <div className="px-4 pt-3" data-testid="wx-search-history">
              <div className="flex items-center justify-between">
                <span className="text-[15px] text-black/45 dark:text-white/45">最近在搜</span>
                <button
                  type="button"
                  aria-label="清空搜索历史"
                  data-testid="wx-search-history-clear"
                  onClick={clearHist}
                  className="p-1 text-black/35 active:opacity-60 dark:text-white/35"
                >
                  <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              </div>
              <div className="mt-1">
                {hist.map((h) => (
                  <button
                    key={h}
                    type="button"
                    data-testid="wx-search-history-item"
                    onClick={() => setKw(h)}
                    className="flex h-[46px] w-full items-center gap-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                  >
                    <Clock className="h-[18px] w-[18px] shrink-0 text-black/30 dark:text-white/30" strokeWidth={1.8} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{h}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <>
            {!hasLocal && !showWeb && (
              <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35" data-testid="wx-search-empty">
                暂无搜索结果
              </p>
            )}

            {/* 联系人 */}
            {hitContacts.length > 0 && (
              <section data-testid="wx-search-contacts">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">联系人</p>
                {hitContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`wx-search-contact-${c.id}`}
                    onClick={() => {
                      pushHist(kw);
                      onOpenChat(c);
                    }}
                    className="flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <WxAvatar src={c.avatar} alt={displayNameOf(c) || c.name} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">{displayNameOf(c) || c.name}</span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">发消息</span>
                  </button>
                ))}
              </section>
            )}

            {/* 群聊 */}
            {hitGroups.length > 0 && (
              <section data-testid="wx-search-groups">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">群聊</p>
                {hitGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`wx-search-group-${g.id}`}
                    onClick={() => {
                      pushHist(kw);
                      onOpenGroup(g);
                    }}
                    className="flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <GroupAvatar group={g} contacts={friends} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">{g.remark || g.name}</span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                ))}
              </section>
            )}

            {/* 聊天记录 */}
            {hitMsgs.length > 0 && (
              <section data-testid="wx-search-msgs">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">聊天记录</p>
                {hitMsgs.map((h, i) => (
                  <button
                    key={`${h.key}-${h.time}-${i}`}
                    type="button"
                    data-testid="wx-search-msg-item"
                    onClick={() => {
                      pushHist(kw);
                      if (h.isGroup && h.group) onOpenGroup(h.group);
                      else if (h.contact) onOpenChat(h.contact);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    {h.isGroup && h.group ? (
                      <span className="shrink-0">
                        <GroupAvatar group={h.group} contacts={friends} size={38} />
                      </span>
                    ) : (
                      <WxAvatar src={h.avatar} alt={h.title} size={38} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-black/45 dark:text-white/45">
                          {h.senderLabel ? `${h.title} · ${h.senderLabel}` : h.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-black/25 dark:text-white/25">{fmtTime(h.time)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[14.5px] leading-snug">{h.text}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {/* 朋友圈 */}
            {hitMoments.length > 0 && (
              <section data-testid="wx-search-moments">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">朋友圈</p>
                {hitMoments.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="wx-search-moment-item"
                    onClick={() => {
                      pushHist(kw);
                      onOpenMoments();
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <WxAvatar src={p.avatar} alt={p.authorName} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-black/45 dark:text-white/45">{p.authorName}</span>
                        <span className="shrink-0 text-[11px] text-black/25 dark:text-white/25">{fmtTime(p.time)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[14.5px] leading-snug">{p.text}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {/* 网页（网络结果） */}
            {showWeb && (
              <section data-testid="wx-search-web">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">网页</p>
                {webState === 'loading' && (
                  <div className="px-4 py-4" data-testid="wx-search-web-loading">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="mb-4 animate-pulse">
                        <div className="h-[14px] w-3/4 rounded bg-black/10 dark:bg-white/10" />
                        <div className="mt-2 h-[12px] w-full rounded bg-black/[0.06] dark:bg-white/[0.06]" />
                        <div className="mt-1.5 h-[12px] w-2/3 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
                      </div>
                    ))}
                  </div>
                )}
                {webState === 'error' && (
                  <p className="px-4 py-3 text-[13px] text-black/35 dark:text-white/35">网络搜索失败，请稍后重试</p>
                )}
                {webState === 'done' && webResults.length === 0 && (
                  <p className="px-4 py-3 text-[13px] text-black/35 dark:text-white/35">没有相关网页</p>
                )}
                {webState === 'done' &&
                  webResults.map((r) => (
                    <button
                      key={r.url}
                      type="button"
                      data-testid="wx-search-web-item"
                      onClick={() => {
                        pushHist(kw);
                        openWeb(r.url);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                    >
                      <span className="mt-0.5 grid h-[38px] w-[38px] shrink-0 place-items-center overflow-hidden rounded-[8px] bg-black/[0.05] dark:bg-white/[0.08]">
                        {r.favicon ? (
                          <img src={r.favicon} alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
                        ) : (
                          <Globe className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={1.8} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 block text-[15px] font-medium leading-snug">{r.name || r.host_name}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-black/50 dark:text-white/50">{r.snippet}</span>
                        <span className="mt-1 block truncate text-[11px] text-black/30 dark:text-white/30">
                          {r.host_name}
                          {r.date ? ` · ${r.date}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
              </section>
            )}
          </>
        )}
      </div>
      <span className="sr-only">{me.name}的微信搜索</span>
    </div>
  );
}

// ---------------- 液态玻璃主题 · 会话列表小组件（搜索框下面；设置见 主题页›液态玻璃设置） ----------------

/** 秒数 → mm:ss */
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 网易云音乐小组件（连接音乐 App）：真实读取全局播放器状态（当前歌/进度/播放暂停），
 *  预览/切歌/暂停直接驱动音乐引擎，点歌曲区跳进音乐 App 播放页；
 *  顶部身份（头像+昵称）可跟随微信登录账号，也可在 主题›液态玻璃设置 里自定义。
 *  用户后续要求：右上角「网易云音乐」品牌角标与「正在听」呼吸标识已删除；
 *  无歌时保持与播放态同尺寸的占位版式（占位不缩水），控制键空队列时安全 no-op */
function WxWidgetMusic({ me }: { me: WxUser }) {
  const skin = useSettings((s) => s.liquidSkin.wx);
  const switchToApp = useUI((s) => s.switchToApp);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const buffering = useMusic((s) => s.buffering);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const playError = useMusic((s) => s.playError);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const openPlayer = useMusic((s) => s.openPlayer);
  const setMusicTab = useMusic((s) => s.setTab);

  /* 顶部身份：跟随微信登录账号（me）或自定义（液态玻璃设置；头像空 = 灰底占位） */
  const follow = skin.musicFollowWx;
  const dispName = follow ? me.name : skin.musicName.trim() || '我';
  const dispAvatar = follow ? me.avatar : skin.musicAvatar || null;

  /* 时长：优先 audio 汇报，缺失时回退歌曲元数据（毫秒）；进度按真实 position 驱动 */
  const dur = duration > 0 ? duration : current?.duration ? current.duration / 1000 : 0;
  const pct = dur > 0 ? Math.min(100, (position / dur) * 100) : 0;

  /* 跳转音乐 App：有歌直进播放器页，没歌回首页 */
  const openMusic = () => {
    if (current) openPlayer();
    else setMusicTab('home');
    switchToApp('music');
  };

  /* 封面（http 直链过同源代理，防混合内容拦截；无封面用渐变示意） */
  const cover = current ? songCover(current) : '';
  const coverUrl = cover ? (cover.startsWith('http://') ? mediaProxyUrl(cover) : cover) : '';
  /* 歌手行：过长截断为前 2 位 + …（联名单曲一长串名字挤在小卡片里） */
  const artistLine = (() => {
    const names = (current?.artists ?? []).map((a) => a.name).filter(Boolean);
    if (!names.length) return '未知歌手';
    return names.length > 2 ? `${names.slice(0, 2).join('/')} 等` : names.join('/');
  })();

  return (
    <div data-testid="wx-widget-music" className="lg-card relative overflow-hidden rounded-[22px] p-3">
      {/* 顶部身份行：头像 + 昵称（跟随微信/自定义；品牌角标已按用户要求删除） */}
      <div className="flex items-center gap-2">
        <WxAvatar src={dispAvatar} alt={dispName} size={26} shape="circle" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-black/75 dark:text-white/80">{dispName}</span>
      </div>

      {current ? (
        <>
          {/* 歌曲区：左信息右旋转唱片；点按 → 音乐 App 播放页 */}
          <button
            type="button"
            data-testid="wx-widget-music-open"
            onClick={openMusic}
            className="mt-2.5 flex w-full items-center gap-3.5 text-left active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span data-testid="wx-widget-music-song" className="block truncate text-[17px] font-bold leading-tight text-black/90 dark:text-white/95">
                {current.name}
              </span>
              <span className="mt-1 block truncate text-[12px] font-medium leading-tight text-black/45 dark:text-white/45">
                {buffering ? '缓冲中…' : playError || artistLine}
              </span>
            </span>
            {/* 黑胶唱片：播放中旋转，中心 = 真实封面 */}
            <span className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center" aria-hidden="true">
              <span
                className="relative block h-full w-full rounded-full shadow-[0_5px_16px_rgba(0,0,0,0.30)]"
                style={{
                  animation: playing ? 'wxWidgetSpin 7s linear infinite' : undefined,
                  background: 'repeating-radial-gradient(circle at center, #17171A 0px, #1F1F24 1.5px, #17171A 3px)',
                }}
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt=""
                    className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full object-cover shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                  />
                ) : (
                  <span className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#F6D9E5] via-[#DCC7EC] to-[#B9C7F2]" />
                )}
                <span className="absolute left-1/2 top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0D0D0F] ring-1 ring-white/30" />
              </span>
              {/* 唱针（静态装饰） */}
              <span className="absolute -right-0.5 -top-1 h-[32px] w-[2px] origin-top rotate-[28deg] rounded-full bg-black/45 dark:bg-white/50" />
            </span>
          </button>

          {/* 进度条（真实 position/duration） */}
          <div className="mt-2">
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.14]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#C20C0C] to-[#FF6B6B] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-black/35 dark:text-white/40">
              <span>{mmss(position)}</span>
              <span>{dur > 0 ? mmss(dur) : '--:--'}</span>
            </div>
          </div>

          {/* 控制行：上一首 / 播放暂停（玻璃圆钮） / 下一首（真实驱动音乐引擎） */}
          <div className="mt-1.5 flex items-center justify-center gap-8 text-black/80 dark:text-white/90">
            <button type="button" aria-label="上一首" onClick={() => void prev()} className="p-1 active:opacity-50">
              <SkipBack className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-label={playing ? '暂停' : '播放'}
              data-testid="wx-widget-music-toggle"
              onClick={toggle}
              className="grid h-[38px] w-[38px] place-items-center rounded-full bg-black/[0.06] ring-1 ring-black/[0.06] transition-transform active:scale-95 dark:bg-white/[0.12] dark:ring-white/[0.12]"
            >
              {playing ? (
                <Pause className="h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
              ) : (
                <Play className="ml-[2px] h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
              )}
            </button>
            <button type="button" aria-label="下一首" onClick={() => void next()} className="p-1 active:opacity-50">
              <SkipForward className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
          </div>
        </>
      ) : (
        /* 空态占位（用户要求：无歌时同样占位，不缩水）——与播放态同版式同尺寸：
           灰显占位歌名 + 引导副行 + 静态黑胶唱片 + 0% 进度条 + 三键控制行
           （控制键直连音乐引擎，空队列时安全 no-op） */
        <>
          <button
            type="button"
            data-testid="wx-widget-music-open"
            onClick={openMusic}
            className="mt-2.5 flex w-full items-center gap-3.5 text-left active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold leading-tight text-black/30 dark:text-white/30">还没有在听的歌</span>
              <span className="mt-1 block truncate text-[12px] font-medium leading-tight text-black/30 dark:text-white/30">
                去音乐 App 挑一首，这里同步显示
              </span>
            </span>
            {/* 黑胶唱片占位：静态渐变盘心 + 唱针（无歌不旋转） */}
            <span className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center" aria-hidden="true">
              <span
                className="relative block h-full w-full rounded-full opacity-50 shadow-[0_5px_16px_rgba(0,0,0,0.30)]"
                style={{ background: 'repeating-radial-gradient(circle at center, #17171A 0px, #1F1F24 1.5px, #17171A 3px)' }}
              >
                <span className="absolute left-1/2 top-1/2 h-[42px] w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#F6D9E5] via-[#DCC7EC] to-[#B9C7F2]" />
                <span className="absolute left-1/2 top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0D0D0F] ring-1 ring-white/30" />
              </span>
              {/* 唱针（静态装饰） */}
              <span className="absolute -right-0.5 -top-1 h-[32px] w-[2px] origin-top rotate-[28deg] rounded-full bg-black/45 dark:bg-white/50" />
            </span>
          </button>

          {/* 进度条占位：0% + --:-- */}
          <div className="mt-2">
            <div className="h-[4px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.14]" />
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-black/35 dark:text-white/40">
              <span>--:--</span>
              <span>--:--</span>
            </div>
          </div>

          {/* 控制行占位：三键同款（真实驱动；空队列时安全 no-op） */}
          <div className="mt-1.5 flex items-center justify-center gap-8 text-black/80 dark:text-white/90">
            <button type="button" aria-label="上一首" onClick={() => void prev()} className="p-1 active:opacity-50">
              <SkipBack className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-label="播放"
              data-testid="wx-widget-music-toggle"
              onClick={toggle}
              className="grid h-[38px] w-[38px] place-items-center rounded-full bg-black/[0.06] ring-1 ring-black/[0.06] transition-transform active:scale-95 dark:bg-white/[0.12] dark:ring-white/[0.12]"
            >
              <Play className="ml-[2px] h-[18px] w-[18px]" strokeWidth={2.2} fill="currentColor" />
            </button>
            <button type="button" aria-label="下一首" onClick={() => void next()} className="p-1 active:opacity-50">
              <SkipForward className="h-[19px] w-[19px]" strokeWidth={2.2} fill="currentColor" />
            </button>
          </div>
        </>
      )}
      <style>{'@keyframes wxWidgetSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

/** 日历小组件：iOS 日历风——年月标题 + 真实当月网格（今天红圈、周末红字、前后月补齐灰显）；
 *  右上角「今天 N」胶囊已按用户要求删除（今天日期仍在网格里红圈标出） */
function WxWidgetCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0 基
  const today = now.getDate();
  /* 当月天数 / 上月天数 / 一号是周几（周日 = 0） */
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  /* 网格单元：前后月补齐成整周，其他月日期灰显 */
  const cells: { d: number; other: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ d: prevDays - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, other: false });
  for (let n = 1; cells.length % 7 !== 0; n++) cells.push({ d: n, other: true });

  return (
    <div data-testid="wx-widget-calendar" className="lg-card overflow-hidden rounded-[22px] px-3.5 pb-2.5 pt-3">
      {/* 头部：年月标题（「今天 N」胶囊已按用户要求删除） */}
      <div className="flex items-center px-1">
        <p className="text-[14px] font-bold leading-none text-black/85 dark:text-white/90">
          {year}年{month + 1}月
        </p>
      </div>
      {/* 周标题行 */}
      <div className="mt-2.5 grid grid-cols-7 text-center" aria-hidden="true">
        {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
          <span
            key={d}
            className={`text-[10px] font-semibold leading-none ${
              i === 0 || i === 6 ? 'text-[#FF453A]/75' : 'text-black/35 dark:text-white/35'
            }`}
          >
            {d}
          </span>
        ))}
      </div>
      {/* 日期网格：今天红圆白字，周末红字，其他月灰显 */}
      <div className="mt-1.5 grid grid-cols-7 text-center">
        {cells.map((c, i) => {
          const weekend = i % 7 === 0 || i % 7 === 6;
          const isToday = !c.other && c.d === today;
          return (
            <span key={i} className="flex h-[21px] items-center justify-center">
              <span
                className={`grid h-[19px] min-w-[19px] place-items-center rounded-full px-[2px] text-[11px] font-medium leading-none tabular-nums ${
                  isToday
                    ? 'bg-[#FF453A] font-bold text-white'
                    : c.other
                      ? 'text-black/20 dark:text-white/20'
                      : weekend
                        ? 'text-[#FF453A]/90 dark:text-[#FF6B6B]/90'
                        : 'text-black/70 dark:text-white/75'
                }`}
              >
                {c.d}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 自定义 CSS/HTML 小组件：渲染用户内容（内容里可带 <style>；纯本机自用） */
function WxWidgetCustom({ html }: { html: string }) {
  if (!html.trim()) {
    return (
      <div
        data-testid="wx-widget-custom"
        className="lg-card rounded-[22px] px-4 py-5 text-center text-[12.5px] text-black/35 dark:text-white/35"
      >
        自定义小组件 · 去 主题 › 液态玻璃设置 写点内容，或点「插入示例」
      </div>
    );
  }
  return (
    <div
      data-testid="wx-widget-custom"
      className="wx-custom-widget overflow-hidden rounded-[22px]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 小组件区（搜索框下、分类标签上）：按设置开关逐个渲染 */
function WxLiquidWidgets({ me }: { me: WxUser }) {
  const skin = useSettings((s) => s.liquidSkin.wx);
  if (!skin.widgetMusic && !skin.widgetCalendar && !skin.widgetCustom) return null;
  return (
    <div className="mb-2.5 flex flex-col gap-2.5">
      {skin.widgetMusic && <WxWidgetMusic me={me} />}
      {skin.widgetCalendar && <WxWidgetCalendar />}
      {skin.widgetCustom && <WxWidgetCustom html={skin.customHtml} />}
    </div>
  );
}

function MainScreen({
  me,
  contacts,
  myRealName,
  ownerName,
  reloadContacts,
  onLogout,
  onExit,
  onLoginAccount,
}: {
  me: WxUser;
  contacts: ContactRecord[];
  /** 当前登录用户的真实姓名（钱包持卡人用，非昵称） */
  myRealName: string;
  /** NPC 归属者名字查询（按聊天对端计算，供人设 prompt 使用） */
  ownerName: (peer: ContactRecord) => string | null;
  reloadContacts: () => Promise<ContactRecord[]>;
  onLogout: () => void;
  onExit: () => void;
  /** 切换账号页「登录小号」自由登录成功 → 根组件 handleLogin（Task 41） */
  onLoginAccount: (u: WxUser) => void;
}) {
  const [tab, setTab] = useState<Tab>('chats');
  const [chatPeer, setChatPeer] = useState<ContactRecord | null>(null);
  /** 群聊：群列表缓存 / 正在聊的群 / 群子页（create=发起群聊、list=通讯录群聊列表）/ 群聊信息页 */
  const [wxGroups, setWxGroups] = useState<ChatGroup[]>(() => listGroups('wx'));
  const [groupPeer, setGroupPeer] = useState<ChatGroup | null>(null);
  const [groupPage, setGroupPage] = useState<null | 'create' | 'list'>(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const refreshGroups = useCallback(() => setWxGroups(listGroups('wx')), []);
  // 群社交：把联系人快照喂给 group-social（建群/拉人名单、被踢通知的宿主侧数据源）
  useEffect(() => {
    setGroupSocialContacts(contacts);
  }, [contacts]);
  // 退群挽留：AI 把机主拉回群后（quit-flow 恢复群记录并广播事件）立即刷新群列表，恢复的群回到会话列表
  useEffect(() => {
    const fn = () => refreshGroups();
    window.addEventListener('quit-flow:group-restored', fn);
    return () => window.removeEventListener('quit-flow:group-restored', fn);
  }, [refreshGroups]);
  /** 详情页（联系人详细界面）：从聊天设置信息卡片 / 通讯录进入；返回与朋友圈回退链见渲染分支 */
  const [detail, setDetail] = useState<ContactRecord | null>(null);
  /** Task 28-b 详情页通话桥：详情页「音视频通话」ActionSheet 选语音/视频后暂存待拨通话——
   *  宿主关详情页并打开对应聊天页时下发，ChatPage 挂载后消费拨号（openVoiceCall 全链路） */
  const [pendingCall, setPendingCall] = useState<{ contactId: string; media: 'voice' | 'video' } | null>(null);
  /** Task 37 角色分支：待确认删除的分支角色（详情页「删除该分支」→ 二次确认 → 真删） */
  const [branchDelTarget, setBranchDelTarget] = useState<ContactRecord | null>(null);
  /** 正在浏览其朋友圈的好友（page = 'friendMoments'） */
  const [friendMoments, setFriendMoments] = useState<ContactRecord | null>(null);
  const [page, setPage] = useState<Page>('main');
  /** 朋友圈页内容范围：all = 全部动态（发现页入口）；mine = 只看我发的（「我」页/自己详情页入口） */
  const [momentsScope, setMomentsScope] = useState<'all' | 'mine'>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [moments, setMoments] = useState<WxMoment[]>(() => loadMoments());
  /**
   * 头像实时读取（换头像后所有历史展示位立即同步）：朋友圈等历史数据里存的是写入当时的头像快照，
   * 渲染前统一过 liveAvatarOf —— 联系人还在就显示当前头像（App 槽位优先、回退全局），
   * 联系人已删除才回退快照原值（宁旧勿丢）。QQ/微信/信息共用同一套解析（contacts.ts）。
   */
  const liveWxAvatar = useCallback(
    (snapshot: string | null | undefined, ref: { peerId?: string | null; name?: string | null }) =>
      liveAvatarOf(snapshot, ref, contacts, 'wx'),
    [contacts]
  );
  /**
   * 删好友可见性门控（朋友圈/互动消息）：被删好友（wx 端存在 friend-del 状态）的动态与互动
   * 不再展示——数据本体保留，重新加回好友（删除状态清除）后自动恢复可见。
   * contacts 变化（删除/加回都会 reloadContacts）即重算，无需额外事件。
   */
  const isAuthorHidden = useCallback(
    (ref: { peerId?: string | null; name?: string | null }): boolean => {
      const hit = contactByRef(ref, contacts);
      return !!hit && hit.kind !== 'user' && isFriendDeleted('wx', hit.id);
    },
    [contacts]
  );
  const momentsLive = useMemo(
    () => {
      // 自己发的动态（author='user'，peerId=null 仅名字归因）：改名/换头像后按机主联系人实时解析
      // 名字与头像——避免改名后旧帖回退到落库时的旧快照（机主身份随联系人最新资料展示）
      const owner = contacts.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return moments
        .filter((p) => !isAuthorHidden({ peerId: p.peerId, name: p.authorName }))
        .map((p) =>
          p.author === 'user' && owner
            ? { ...p, authorName: displayNameOf(owner) || p.authorName, avatar: owner.avatar ?? p.avatar }
            : { ...p, avatar: liveWxAvatar(p.avatar, { peerId: p.peerId, name: p.authorName }) }
        );
    },
    [moments, liveWxAvatar, isAuthorHidden, contacts]
  );
  /** 用户 API 配置（让 AI 发动态时按人设生成内容用） */
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 液态玻璃主题（气泡样式设置 › 界面主题）：四 tab 页面铭件（列表玻璃卡/悬浮 TabBar）切换玻璃视觉；
   *  默认主题全部走原类（像素级保持现状），主题只接管页面铭件、不动气泡与功能逻辑 */
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const liquid = isLiquidTheme(bubbleStyle, 'wx');
  /** 古早主题（第五十四轮）：四 tab 页面铭件（淡青灰底/银灰导航/白硬边分组卡/拟物 TabBar）切换拟物复古视觉 */
  const retro = isRetroTheme(bubbleStyle, 'wx');
  /** 液态玻璃皮肤（本轮新增）：分类标签自定义文字 / 列表小组件开关（液态主题下生效） */
  const liquidSkinWx = useSettings((s) => s.liquidSkin.wx);
  /** 「让好友发一条」弹层与生成中的联系人 id */
  const [askOpen, setAskOpen] = useState(false);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  /** 正在配置自动发动态的好友（每角色 × 朋友圈） */
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 正在编辑的动态（id + 当前正文） */
  const [editingPost, setEditingPost] = useState<{ id: string; text: string } | null>(null);
  const [reqs, setReqs] = useState<WxFriendReq[]>(() => loadReqs());
  // AI 加回申请 / 手动添加 / 验证消息线程回复由 friend-state 落盘后广播：订阅刷新列表 + 打开中的详情页
  useEffect(
    () =>
      subscribeFriendReqs(() => {
        setReqs(loadReqs());
        setReqDetail((cur) => (cur ? loadReqs().find((x) => x.id === cur.id) ?? cur : cur));
      }),
    [],
  );
  /** 新的朋友通知头像也实时读取（通知里存的快照 → 联系人在就显示当前头像） */
  const reqsLive = useMemo(
    () =>
      reqs.map((r) => {
        const hit = r.contactId ? contacts.find((c) => c.id === r.contactId) : undefined;
        return { ...r, avatar: liveWxAvatar(r.avatar, { peerId: r.contactId ?? null, name: hit?.name ?? r.name }) };
      }),
    [reqs, liveWxAvatar, contacts]
  );
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /** 聊天列表管理（真微信同款）：置顶排序、消息免打扰铃铛（chat-flags 总线）、标为未读红点、不显示/删除（新消息自动恢复） */
  const flagsMap = useChatFlags(wxChatFlagsStore);
  const unreads = useUnreadMap(wxUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(LS_CHAT_HIDDEN));
  // 好友来信 / 未读变化 tick：会话预览与排序派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => wxUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('wx:', () => setMsgTick((t) => t + 1));
  // 退出网页后继续回复（服务端接力）：挂载时拉各会话「待达消息」条数点亮未读角标
  //（同一批条目只在第一次查询时提示，正式拉取投递后自动解除；群聊会话不上报接力，天然无待达）
  useEffect(() => {
    void peekBgBadgeCounts().then((counts) => {
      for (const [key, n] of Object.entries(counts)) {
        if (!key.startsWith('wx:') || key.startsWith('wx:group:')) continue;
        wxUnreads.bump(key.slice(3), n);
      }
    });
  }, []);
  /** 长按菜单（QQ 同款竖向卡片：标为未读/置顶该聊天/不显示该聊天/删除该聊天；浅色白底黑字/深色深底白字） */
  const [ctx, setCtx] = useState<null | { contact: ContactRecord; x: number; y: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );

  /** 返回列表：从聊天页/详情页回来时重同步隐藏列表（saveMsgs 收到新消息会把联系人从隐藏中移除） */
  const backToList = () => {
    setHidden(loadStrList(LS_CHAT_HIDDEN));
    setChatPeer(null);
  };

  // 灵动岛通知点击跳转：打开通知对应的单聊/群聊（App 已打开时由事件驱动，未打开时挂载后自动消费 pending）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('wechat');
      if (!t) return;
      if (t.groupId) {
        const g = getGroup(t.groupId);
        if (!g) return;
        setTab('chats');
        setPage('main');
        setDetail(null);
        setGroupPage(null);
        setHidden(loadStrList(LS_CHAT_HIDDEN));
        setChatPeer(null);
        setGroupPeer(g);
      } else if (t.contactId) {
        const c = contacts.find((x) => x.id === t.contactId);
        if (!c) return;
        setTab('chats');
        setPage('main');
        setDetail(null);
        setGroupPage(null);
        setHidden(loadStrList(LS_CHAT_HIDDEN));
        setGroupPeer(null);
        setChatPeer(c);
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, [contacts]);

  /** 好友（可聊天对象）：CHAR / NPC 中已添加微信好友的（微信好友独立，QQ/信息里添加的不算） */
  const friends = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx')),
    [contacts]
  );

  /** 自己的完整联系人资料（个人资料页的性别 / 地区用） */
  const meRecord = useMemo(() => contacts.find((c) => c.id === me.id) ?? null, [contacts, me.id]);

  /** 会话列表：置顶优先，其余按最后消息时间倒序；已删除/不显示的隐藏（新消息自动恢复）；跟自己的会话有消息时也显示（同文件传输助手）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  const sessions = useMemo<{ key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[]>(() => {
    const hiddenSet = new Set(hidden);
    const items: { key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[] = friends
      .filter((c) => !hiddenSet.has(c.id))
      .map((c) => {
        const p = readPreview(c.id);
        return { key: c.id, contact: c, group: null, preview: p.text, time: p.time };
      });
    const mine = readPreview(me.id);
    if (mine.text && !hiddenSet.has(me.id)) {
      const meContact = contacts.find((c) => c.id === me.id) ?? meAsContact(me);
      items.push({ key: meContact.id, contact: meContact, group: null, preview: mine.text, time: mine.time });
    }
    for (const g of wxGroups) {
      if (hiddenSet.has(groupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      items.push({ key: groupRowId(g.id), contact: null, group: g, preview: p.text, time: p.time });
    }
    items.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.time || 0) - (a.time || 0);
    });
    return items;
    // chatPeer 入依赖：从聊天返回（或进入聊天）时重算预览，红包/转账/新消息即时反映到列表；msgTick：好友来信时重算；groups：群数据变更时重算
  }, [contacts, friends, me, chatPeer, pinSet, hidden, msgTick, wxGroups]);

  /** 液态主题分类标签栏（第四十三轮建立·第四十五轮精简，参考图）：全部/好友/群聊/服务号 过滤会话列表（默认主题不渲染该栏） */
  const [cat, setCat] = useState<'all' | 'friends' | 'work' | 'family' | 'groups' | 'officials'>('all');
  /** 分类过滤后的会话（仅液态主题使用；all = 不过滤） */
  const visibleSessions = useMemo(() => {
    if (!liquid || cat === 'all') return sessions;
    if (cat === 'groups') return sessions.filter((s) => s.group);
    if (cat === 'officials') return sessions.filter((s) => !s.group && s.contact && s.contact.id === me.id);
    // 好友 / 工作 / 家人：非群会话
    return sessions.filter((s) => {
      if (s.group || !s.contact) return false;
      if (s.contact.id === me.id) return false; // 自己的会话归「服务号」
      if (cat === 'friends') return true;
      if (cat === 'work') return Boolean(s.contact.occupation || s.contact.company);
      if (cat === 'family') return /家人|父母|父亲|母亲|爸爸|妈妈|哥哥|姐姐|弟弟|妹妹|亲戚|儿子|女儿/.test(s.contact.relation ?? '');
      return false;
    });
  }, [sessions, liquid, cat, me.id]);

  /** 液态列表分组（第四十四轮，用户指定）：置顶会话一张白色面板、非置顶会话一张白色面板（组内细分割线，卡间间隙）。
   *  注意：必须挂在所有早退 return 之前（hooks 顺序不可随 page 变化） */
  const liquidGroups = useMemo(() => {
    const pinned: typeof sessions = [];
    const rest: typeof sessions = [];
    for (const r of visibleSessions) {
      if (pinSet.has(r.key)) pinned.push(r);
      else rest.push(r);
    }
    const out: Array<typeof sessions> = [];
    for (const g of [pinned, rest]) if (g.length) out.push(g);
    return out;
  }, [visibleSessions, pinSet]);

  /** 幽灵未读清理：只保留当前可见会话的未读（不显示该聊天/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 sessions 重算触发） */
  useEffect(() => {
    wxUnreads.prune(sessions.map((s) => s.key));
  }, [sessions]);

  /** 长按会话 → 弹出 QQ 同款竖向卡片菜单（480ms 触发，移动超 12px 视为滚动取消） */
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, c: ContactRecord) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      const rect = rootRef.current?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      // 竖向卡片（4 项，约 176×190）：水平居中于触点，上下钳制不溢出页面
      const rootW = rootRef.current?.clientWidth ?? 390;
      const rootH = rootRef.current?.clientHeight ?? 700;
      // 液态 = 横向 2×2 玻璃网格（320×118）；默认 = 竖向卡片（176×190）
      const MENU_W = liquid ? 320 : 176;
      const MENU_H = liquid ? 118 : 190;
      const x = Math.min(Math.max(px - MENU_W / 2, 10), Math.max(rootW - MENU_W - 10, 10));
      const y = Math.min(py, Math.max(rootH - MENU_H - 10, 10));
      setCtx({ contact: c, x, y });
      // 长按后拦截紧随的 click（不进入会话）
      suppressClickRef.current = true;
    }, 480);
  };
  const onSessionPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 12 || Math.abs(e.clientY - t.y) > 12) clearPress();
  };

  // 关闭长按菜单并解除 click 拦截（避免菜单操作后下一次点击被吞掉）
  const closeCtx = () => {
    setCtx(null);
    suppressClickRef.current = false;
  };

  // 菜单操作（置顶/未读/不显示/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    wxChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => wxUnreads.toggle(id);
  const markRead = (id: string) => wxUnreads.clear(id);
  const hideSession = (id: string) => {
    if (!hidden.includes(id)) {
      const next = [...hidden, id];
      saveStrList(LS_CHAT_HIDDEN, next);
      setHidden(next);
    }
    showToast('已不显示该聊天');
  };
  const deleteSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    // 审计 #18：同步清记忆轮次计数/锚点（mem-msgcount:/mem-anchor:/mem-round: 该联系人全部键，不动碎片），
    // 避免旧锚点残留让清空后的新会话「凭空续旧记忆」
    void memResetConvoCounters(id);
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(LS_CHAT_HIDDEN, nextHidden);
    setHidden(nextHidden);
    wxChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    if (unreads[id]) wxUnreads.clear(id);
    showToast('已删除该聊天');
  };

  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!chatPeer) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== chatPeer.id && n > 0) sum += n;
    }
    return sum;
  }, [unreads, chatPeer]);

  /** 底部「微信」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  /** 通讯录字母分组 */
  const groups = useMemo(() => {
    const map = new Map<string, ContactRecord[]>();
    for (const c of friends) {
      const key = initialOf(c.name);
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([letter, list]) => ({
        letter,
        list: list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')),
      }))
      .sort((a, b) => {
        if (a.letter === '#') return 1;
        if (b.letter === '#') return -1;
        return a.letter.localeCompare(b.letter);
      });
  }, [friends]);

  /** 朋友圈更新：改由动态引擎写入，这里只从存储重读刷新视图（引擎每次落盘也广播 moments-changed） */
  const reloadMoments = useCallback(() => setMoments(loadMoments()), []);

  // ---------------- 互动消息（与我的互动消息：谁赞了我/评论了我/回复了我） ----------------
  const [wxNotices, setWxNotices] = useState<MomentNotice[]>(() => listMomentNotices('wx'));
  const refreshWxNotices = useCallback(() => setWxNotices(listMomentNotices('wx')), []);
  /** 互动消息头像实时读取（actorAvatar 快照 → 联系人在就显示当前头像）；被删好友的互动同口径隐藏 */
  const wxNoticesLive = useMemo(
    () =>
      wxNotices
        .filter((n) => !isAuthorHidden({ peerId: n.actorPeerId, name: n.actorName }))
        .map((n) => ({
          ...n,
          actorAvatar: liveWxAvatar(n.actorAvatar, { peerId: n.actorPeerId, name: n.actorName }),
        })),
    [wxNotices, liveWxAvatar, isAuthorHidden]
  );
  /** 气泡角标：未读条数 + 最新一条消息人的头像（「1条新消息」气泡展示用） */
  const wxNoticeBadge = useMemo(
    () => ({
      count: wxNoticesLive.filter((n) => !n.read).length,
      avatar: wxNoticesLive.find((n) => !n.read)?.actorAvatar ?? null,
    }),
    [wxNoticesLive]
  );
  /** 打开互动消息页：全部标记已读（气泡随之消失）+ 刷新列表 */
  const openWxNotices = useCallback(() => {
    markAllMomentNoticesRead('wx');
    refreshWxNotices();
    setPage('momentNotices');
  }, [refreshWxNotices]);
  /** 从互动消息页回复一条评论/回复（走引擎：AI 会自动再回复，新回复会进收件箱） */
  const replyToWxNotice = useCallback(
    (n: MomentNotice, text: string) => {
      if (!n.postId) {
        showToast('原动态已删除，无法回复');
        return;
      }
      const added = addUserMomentComment('wx', n.postId, {
        userName: me.name,
        content: text,
        replyTo: n.commentId ? { commentId: n.commentId, name: n.actorName } : undefined,
      });
      if (!added) {
        showToast('原动态已删除，无法回复');
        return;
      }
      refreshWxNotices();
      reloadMoments();
      showToast('已回复');
    },
    [me.name, refreshWxNotices, reloadMoments, showToast]
  );

  // 引擎（调度器/AI）在别处写入动态后同步本地视图（点赞/评论/新动态实时出现）
  useEffect(
    () =>
      subscribeMomentsChanged((platform) => {
        if (platform && platform !== 'wx') return;
        reloadMoments();
        refreshWxNotices();
      }),
    [reloadMoments, refreshWxNotices]
  );

  const publishMoment = useCallback(
    (text: string, images: string[], location?: string) => {
      // 统一走动态引擎：入库（含位置）+ 写看到它的角色记忆（聊天时懒入库）+ 排 AI 互动队列（8~18s 后好友点赞/评论）
      const post = addUserMomentPost('wx', { userName: me.name, avatar: me.avatar, content: text, images, location });
      enqueuePostInteractions('wx', post.id);
      reloadMoments();
      setMomentsScope('mine');
      setPage('moments');
      showToast('已发表到朋友圈');
    },
    [me.avatar, me.name, reloadMoments, showToast]
  );

  const toggleLike = useCallback(
    (id: string) => {
      toggleUserMomentLike('wx', id, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 发表评论（reply = 回复目标的评论 id + 名字；回复 AI 评论会自动排一条 AI 的再回复，多轮） */
  const addComment = useCallback(
    (id: string, text: string, reply: { commentId: string; name: string } | null) => {
      addUserMomentComment('wx', id, {
        userName: me.name,
        content: text,
        replyTo: reply ? { commentId: reply.commentId, name: reply.name } : undefined,
      });
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 进入好友朋友圈：首次自动补三条示例动态（示例动态不入记忆），界面与自己朋友圈同款 */
  const openFriendMoments = useCallback(
    (c: ContactRecord) => {
      const known = listMomentPosts('wx', me.name, contacts);
      if (!known.some((p) => isPostByPeer(p, c))) {
        const now = Date.now();
        for (const t of FRIEND_POST_TEMPLATES) {
          addCharMomentPost('wx', {
            peer: c,
            userName: me.name,
            content: t.text,
            writeMemory: false,
            createdAt: now - t.agoMs,
          });
        }
      }
      reloadMoments();
      setFriendMoments(c);
      setPage('friendMoments');
    },
    [contacts, me.name, reloadMoments]
  );

  const deleteMoment = useCallback(
    (id: string) => {
      deleteMomentPost('wx', id, me.name);
      reloadMoments();
      showToast('已删除动态');
    },
    [me.name, reloadMoments, showToast]
  );

  /** 删除评论（自己的评论；其下的回复一并删，AI 未结算的回复一并撤掉） */
  const deleteComment = useCallback(
    (postId: string, commentId: string) => {
      deleteMomentComment('wx', postId, commentId, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 编辑动态正文（自己的动态） */
  const editMomentPost = useCallback(
    (id: string, text: string) => {
      if (!updateMomentPostContent('wx', id, me.name, text)) showToast('动态内容不能为空');
      reloadMoments();
    },
    [me.name, reloadMoments, showToast]
  );

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = useCallback(
    async (c: ContactRecord) => {
      setAskBusyId(c.id);
      try {
        await aiPostMoment({ apiConfig, platform: 'wx', peer: c, userName: me.name });
        reloadMoments();
        showToast(`已让「${displayNameOf(c)}」发了一条动态`);
        setAskOpen(false);
      } catch (e) {
        showToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
      } finally {
        setAskBusyId(null);
      }
    },
    [apiConfig, me.name, reloadMoments, showToast]
  );

  // ---------------- 删除联系人 / 好友申请 / 申请添加朋友（微信 × QQ 共用 friend-state 状态机） ----------------
  /** 待确认删除的联系人（弹 FriendDeleteConfirmDialog；after = 确认后关闭的页面栈） */
  const [delTarget, setDelTarget] = useState<{ contact: ContactRecord; after: () => void } | null>(null);
  /** 好友申请详情页当前申请（page='friendReqDetail'；null = 资料预览模式） */
  const [reqDetail, setReqDetail] = useState<WxFriendReq | null>(null);
  /** 详情页返回目标：newfriends（新的朋友进入）/ addfriend（搜索或发送后进入） */
  const [reqDetailFrom, setReqDetailFrom] = useState<'newfriends' | 'addfriend'>('newfriends');
  /** 资料预览模式目标（搜索结果点人进入；无申请数据） */
  const [searchProfile, setSearchProfile] = useState<ContactRecord | null>(null);
  /** 申请添加朋友页目标（page='applyFriend'） */
  const [applyTarget, setApplyTarget] = useState<ContactRecord | null>(null);

  // ---------------- 多账号 v2（Task 40-2a）：微信账号切换不刷新——本组件负责 UI 复位与数据重读 ----------------
  // 中断在途流/清理投递队列/排队补跑换仓由根组件 WeChatApp 处理；这里把界面复位回主列表并按新账号
  // 作用域重读全部列表数据（会话预览经 msgTick 重算；隐藏会话/群/朋友圈/互动消息/新的朋友重读）。
  // 切换/登录成功后自动跳回微信主界面（用户要求：切完就能用，不留在切号页）+ toast 提示身份。
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      setPage('main');
      // toast 报告切到了哪个身份（档案展示名优先，大号回退机主）
      const acc = getActiveAccountFor('wx');
      const prof = contacts.find((c) => c.altOf === acc.id || (acc.ownerContactId ? c.id === acc.ownerContactId : false));
      showToast(`已切换到 ${prof ? displayNameOf(prof) : acc.name || '机主'}`);
      setTab('chats');
      setChatPeer(null);
      setGroupPeer(null);
      setGroupPage(null);
      setGroupInfoOpen(false);
      setDetail(null);
      setFriendMoments(null);
      setPendingCall(null);
      setMenuOpen(false);
      setCtx(null);
      setAskOpen(false);
      setAskBusyId(null);
      setCfgPeer(null);
      setEditingPost(null);
      setDelTarget(null);
      setReqDetail(null);
      setReqDetailFrom('newfriends');
      setSearchProfile(null);
      setApplyTarget(null);
      setMomentsScope('all');
      reloadMoments();
      refreshWxNotices();
      setReqs(loadReqs());
      setHidden(loadStrList(LS_CHAT_HIDDEN));
      refreshGroups();
      setMsgTick((t) => t + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, [reloadMoments, refreshWxNotices, refreshGroups, contacts, showToast]);

  const openDeleteConfirm = useCallback((c: ContactRecord, after: () => void) => {
    setDelTarget({ contact: c, after });
  }, []);

  /** Task 37 确认删除分支角色：真删（聊天/记忆/朋友圈副本经 deleteContact 级联清空），原角色不受影响 */
  const confirmDeleteBranch = async () => {
    const target = branchDelTarget;
    if (!target) return;
    const label = displayNameOf(target);
    setBranchDelTarget(null);
    try {
      const ok = await deleteCharacterBranch(target.id);
      if (!ok) {
        showToast('删除失败：该联系人不是分支角色');
        return;
      }
      setDetail(null);
      setChatPeer(null);
      setHidden(loadStrList(LS_CHAT_HIDDEN));
      setPage('main');
      await reloadContacts();
      showToast(`已删除分支「${label}」`);
    } catch {
      showToast('删除失败，请重试');
    }
  };

  /** 确认删除联系人：删除好友关系（记录/记忆/朋友圈/通话保留不可见，AI 稍后可能申请加回） */
  const confirmRemoveFriend = useCallback(async () => {
    if (!delTarget) return;
    const { contact, after } = delTarget;
    setDelTarget(null);
    after();
    await removeFriendByUser('wx', contact.id);
    await reloadContacts();
    setReqs(loadReqs());
    showToast(`已删除「${displayNameOf(contact)}」`);
  }, [delTarget, reloadContacts, showToast]);

  /** 申请添加朋友「发送」：
   *  - 大号：加好友（被删好友重新加回时同路径恢复历史数据可见）+ 写「新的朋友」（status=accepted）
   *    + AI 在线程里回一句欢迎（一次性）——「发送即通过」，保持既有体验；
   *  - 小号：AI 决策模式（2025）——不置好友标记（联系人界面不出现该联系人）、条目 status=pending，
   *    由 AI 按人设+大号关系+记忆+验证消息决定同意/拒绝/先回复；用户可在验证消息线程里继续回复，
   *    每条回复再次触发 AI 决策（按人设随时可以同意）。返回新建条目供导航。 */
  const handleApplySent = useCallback(
    async (target: ContactRecord, payload: { greeting: string; extras: FriendReqExtras }): Promise<WxFriendReq | null> => {
      const altFlow = !!me.altOf && (target.persona ?? '').trim().length > 0; // 无人设角色无法决策：保持直接通过
      try {
        if (payload.extras.remark) await updateContact(target.id, { remarks: { wx: payload.extras.remark } });
        if (altFlow) {
          // 小号：不置好友标记；清删除状态（重新加回场景，防止 catch-up 再发一条 AI 申请打架）
          clearFriendDelState('wx', target.id);
        } else {
          await restoreFriendship('wx', target.id); // 未删过 = friendWx=true；删过 = 清删除状态并恢复好友
        }
      } catch {
        showToast('添加失败，请重试');
        return null;
      }
      const entry: WxFriendReq = {
        id: uid(),
        contactId: target.id,
        name: displayNameOf(target),
        avatar: target.avatar,
        message: payload.greeting,
        time: Date.now(),
        status: altFlow ? 'pending' : 'accepted',
        source: SOURCE_SEARCH_WX,
        fromChar: false,
        extras: payload.extras,
        thread: [{ who: 'me', text: payload.greeting, time: Date.now() }],
      };
      addFriendReq('wx', entry);
      // 加好友过程落聊天记录：我的验证消息（fr=apply）永久保留，重启不丢；
      // 小号模式下不加「已成功添加」提示（AI 同意后由 processAltFriendReq 补写）
      try {
        const now = Date.now();
        const msgs: WxMsg[] = [
          ...loadMsgs(target.id),
          { id: uid(), role: 'me' as const, content: payload.greeting, time: now, kind: 'text' as const, fr: 'apply' as const },
        ];
        if (!altFlow) {
          msgs.push({
            id: uid(),
            role: 'peer' as const,
            content: '',
            time: now + 1,
            kind: 'sys' as const,
            sys: { text: '我们已成功添加为好友，现在可以开始聊天啦～' },
            fr: 'added' as const,
          });
        }
        saveMsgs(target.id, msgs);
      } catch {
        // 聊天记录写入失败不影响添加流程
      }
      setReqs(loadReqs());
      await reloadContacts();
      showToast(altFlow ? '验证消息已发送，等待对方处理' : '已发送添加申请');
      if (altFlow) {
        // AI 决策（fire-and-forget）：同意/拒绝/先回复；落盘后经 FRIEND_REQS_EVENT / FRIEND_STATE_APPLIED_EVENT 刷新
        void processAltFriendReq('wx', entry.id, target.id).catch(() => {});
      } else {
        // AI 欢迎回复（一次性；fire-and-forget，生成完成经 FRIEND_REQS_EVENT 刷新）
        void charWelcomeReplyToApply('wx', entry.id, target.id, payload.greeting).catch(() => {});
      }
      return loadReqs().find((x) => x.id === entry.id) ?? entry;
    },
    [reloadContacts, showToast, me.altOf]
  );

  /** 同意好友申请（前往验证 / AI 加回申请）：恢复好友关系 + 状态流转 + 刷新 */
  const acceptFriendReqAction = useCallback(
    async (r: WxFriendReq) => {
      const cid = r.contactId ?? r.id;
      await restoreFriendship('wx', cid);
      setFriendReqStatus('wx', r.id, 'accepted');
      // 加好友成功提示落聊天记录（AI 加回申请场景：居中灰字「你已添加了…」，此前 AI 的验证消息保留）
      try {
        saveMsgs(cid, [
          ...loadMsgs(cid),
          {
            id: uid(),
            role: 'peer' as const,
            content: '',
            time: Date.now(),
            kind: 'sys' as const,
            sys: { text: `你已添加了${r.name}，现在可以开始聊天了。` },
            fr: 'added' as const,
          },
        ]);
      } catch {
        // 忽略
      }
      const fresh = loadReqs().find((x) => x.id === r.id) ?? null;
      setReqs(loadReqs());
      if (reqDetail) setReqDetail(fresh);
      await reloadContacts();
      showToast(`已添加「${r.name}」`);
    },
    [reloadContacts, showToast, reqDetail]
  );

  /** 拒绝好友申请：AI 彻底停止申请（重新加回好友后重置） */
  const rejectFriendReqAction = useCallback(
    (r: WxFriendReq) => {
      rejectFriendReq('wx', r.id);
      const fresh = loadReqs().find((x) => x.id === r.id) ?? null;
      setReqs(loadReqs());
      if (reqDetail) setReqDetail(fresh);
      showToast(`已拒绝「${r.name}」的申请`);
    },
    [showToast, reqDetail]
  );

  /** 申请详情「加入黑名单」：写双向拉黑 byUser（拦截对方消息，走既有拉黑链路；资料预览模式传联系人） */
  const blockFriendReqAction = useCallback(
    (r: WxFriendReq | ContactRecord) => {
      const isReq = (x: WxFriendReq | ContactRecord): x is WxFriendReq => 'status' in x || 'time' in x;
      const cid = isReq(r) ? r.contactId ?? r.id : r.id;
      const name = isReq(r) ? r.name : displayNameOf(r);
      setUserBlock('wx', cid, true);
      showToast(`已将「${name}」加入黑名单`);
    },
    [showToast]
  );

  /** 打开好友详情页（fromChat 参数仅保留调用点兼容；页面退回逻辑已统一） */
  const openFriendDetail = useCallback((c: ContactRecord) => {
    setDetail(c);
    setPage('friendDetail');
  }, []);

  if (page === 'friendDetail' && detail) {
    // Task 37 角色分支：详情页展示分支身份 + 提供删除入口（仅分支角色可见）
    const branchMeta = getBranchMeta(detail.id);
    const branchParentName = branchMeta ? contacts.find((c) => c.id === branchMeta.parentId)?.name ?? '' : '';
    return (
      <>
        <FriendDetailPage
          friend={detail}
          branchInfo={branchMeta && branchParentName ? { parentName: branchParentName, createdAt: branchMeta.createdAt } : null}
          onDeleteBranch={branchMeta ? () => setBranchDelTarget(detail) : undefined}
          onBack={() => {
            // 从聊天设置进入：chatPeer 仍保留，回到聊天页；否则回主列表
            setDetail(null);
            setPage('main');
          }}
          onDeleteContact={
            detail.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(detail, () => {
                    // 删除后聊天页/详情都关闭，回主列表
                    setDetail(null);
                    setChatPeer(null);
                    setHidden(loadStrList(LS_CHAT_HIDDEN));
                    setPage('main');
                  })
          }
        onOpenChat={(c) => {
          // 详情页发消息：退回 page 并打开聊天（chatPeer 渲染聊天页）。
          // 从聊天进入的详情页：chatPeer 已是此人，退回 page 即回聊天；从通讯录进入的：直接进聊天。
          setPage('main');
          setChatPeer(c);
        }}
        onCall={(media) => {
          // Task 28-b 详情页「音视频通话」：关详情页 → 打开该联系人聊天页 → pendingCall 下发，
          // ChatPage 挂载后消费拨号（全局通话层盖在聊天页上，视觉为「详情页关闭 → 弹出通话」）
          setPendingCall({ contactId: detail.id, media });
          setPage('main');
          setChatPeer(detail);
        }}
        onOpenMoments={(c) => {
          // 自己的详情页：「朋友圈」进自己的朋友圈（只看我发的动态）；好友才自动补示例动态
          if (c.id === me.id) {
            setMomentsScope('mine');
            setPage('moments');
          } else openFriendMoments(c);
        }}
        onToast={showToast}
        />
        {/* 删除确认弹窗在详情页之上（分支提前 return，根部的弹窗不渲染） */}
        {delTarget && (
          <FriendDeleteConfirmDialog
            variant="wx"
            peerName={displayNameOf(delTarget.contact)}
            onCancel={() => setDelTarget(null)}
            onConfirm={() => void confirmRemoveFriend()}
          />
        )}
        {/* Task 37 分支删除二次确认（真删：聊天/记忆/朋友圈一并清空，原角色不受影响） */}
        {branchDelTarget && (
          <BranchDeleteConfirmDialog
            branchName={displayNameOf(branchDelTarget)}
            onCancel={() => setBranchDelTarget(null)}
            onConfirm={() => void confirmDeleteBranch()}
          />
        )}
      </>
    );
  }
  // 朋友圈三页（自己的朋友圈 / 发布页 / 好友朋友圈）必须渲染在 chat 之前：
  // 从聊天 → 联系人详情 → 朋友圈进入时 chatPeer 仍保留（返回时还要回聊天），
  // 若 chat 判断在前会错误地直接渲染聊天页，退出聊天后才看到朋友圈（导航栈错乱）。
  if (page === 'moments') {
    return (
      <>
        <MomentsPage
          me={me}
          posts={momentsScope === 'mine' ? momentsLive.filter((p) => p.authorName === me.name) : momentsLive}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onDeleteComment={deleteComment}
          onEditRequest={(p) => setEditingPost({ id: p.id, text: p.text })}
          onToast={showToast}
          noticeBadge={wxNoticeBadge}
          onOpenNotices={openWxNotices}
        />
        {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑动态（六.4） */}
        {askOpen && (
          <AskPostSheet
            title="让好友发一条"
            friends={momentFriendsOf(contacts, 'wx')}
            busyId={askBusyId}
            onClose={() => setAskOpen(false)}
            onAsk={(c) => void askMomentPost(c)}
            onOpenCfg={(c) => setCfgPeer(c)}
            renderAvatar={(c, size) => <WxAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
          />
        )}
        {cfgPeer && (
          <MomentAutoCfgSheet
            contact={cfgPeer}
            platform="wx"
            platformLabel="朋友圈"
            onClose={() => setCfgPeer(null)}
            onToast={showToast}
          />
        )}
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (page === 'compose') {
    return (
      <ComposeMomentsPage
        onCancel={() => setPage('moments')}
        onPublish={publishMoment}
        onToast={showToast}
      />
    );
  }
  if (page === 'momentNotices') {
    return (
      <MomentInteractionsPage
        platform="wx"
        title="与我的互动消息"
        notices={wxNoticesLive}
        onBack={() => setPage('moments')}
        onReply={replyToWxNotice}
        renderAvatar={(src, name, size) => <WxAvatar src={src} alt={name} size={size} />}
      />
    );
  }
  if (page === 'friendMoments' && friendMoments) {
    return (
      <>
        <MomentsPage
          me={me}
          owner={{ name: friendMoments.name, avatar: friendMoments.avatar }}
          peerId={friendMoments.id}
          posts={momentsLive.filter((p) => p.authorName === friendMoments.name)}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onToast={showToast}
          noticeBadge={{ count: 0, avatar: null }}
          onOpenNotices={openWxNotices}
        />
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (groupPage === 'create') {
    return (
      <WxGroupCreatePage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onToast={showToast}
        onCreated={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
      />
    );
  }
  if (groupPage === 'list') {
    return (
      <WxGroupListPage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onOpen={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
        onCreate={() => setGroupPage('create')}
      />
    );
  }
  if (groupPeer && groupInfoOpen) {
    return (
      <WxGroupInfoPage
        key={`info-${groupPeer.id}`}
        group={groupPeer}
        contacts={contacts}
        onBack={() => setGroupInfoOpen(false)}
        onUpdate={(patch) => {
          updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          // 始终以存储现场为准（群被 AI 移出群聊删除时 getGroup 返回 null → 关闭群页/回列表）
          setGroupPeer(getGroup(groupPeer.id));
        }}
        onQuit={() => {
          quitGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          setGroupInfoOpen(false);
          showToast('已退出群聊');
        }}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          setGroupInfoOpen(false);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (groupPeer) {
    return (
      <WxGroupChatPage
        key={groupPeer.id}
        group={groupPeer}
        me={me}
        contacts={contacts}
        ownerLabelOf={(p) => ownerName(p)}
        onBack={() => {
          refreshGroups();
          setGroupPeer(null);
        }}
        onUpdate={(patch) => {
          updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          // 始终以存储现场为准（群被 AI 移出群聊删除时 getGroup 返回 null → 关闭群页/回列表）
          setGroupPeer(getGroup(groupPeer.id));
        }}
        onOpenInfo={() => setGroupInfoOpen(true)}
        onQuit={() => {
          quitGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          showToast('已退出群聊');
        }}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (chatPeer) {
    return (
      <>
        <ChatPage
          key={chatPeer.id}
          me={me}
          peer={contacts.find((c) => c.id === chatPeer.id) ?? chatPeer}
          contacts={contacts}
          ownerName={ownerName(chatPeer)}
          otherUnread={chatOtherUnread}
          onBack={backToList}
          onOpenFriendDetail={(c) => openFriendDetail(c)}
          onOpenGroup={(gid) => {
            const g = getGroup(gid);
            if (!g) return;
            refreshGroups();
            setHidden(loadStrList(LS_CHAT_HIDDEN));
            setChatPeer(null);
            setGroupPeer(g);
          }}
          onSaveRemark={async (v) => {
            try {
              // 第四十八轮：备注按 App 隔离——微信里的备注只写 wx 槽位，QQ/信息不受影响
              await updateContact(chatPeer.id, { remarks: { wx: v || null } });
              await reloadContacts();
              showToast(v ? '备注已保存' : '备注已清除');
            } catch {
              showToast('备注保存失败');
            }
          }}
          onSaveVoiceId={async (vid) => {
            try {
              // 与备注同一条持久化路径：写入联系人库 voiceId → 重拉联系人（ChatPage 的 peer 由 contacts 反查，随之一并刷新）
              await updateContact(chatPeer.id, { voiceId: vid || null });
              await reloadContacts();
              showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
            } catch {
              showToast('声音保存失败');
            }
          }}
          // 47-b 联系人刷新回调：ChatPage 内 AI 换头像/选图设头像后调此回调让顶栏/会话列表头像即时刷新
          onContactsChanged={reloadContacts}
          onDeleteContact={
            chatPeer.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(chatPeer, () => {
                    // 删除后聊天页关闭回列表（会话随好友关系消失）；历史记录保留不可见
                    setChatPeer(null);
                    setHidden(loadStrList(LS_CHAT_HIDDEN));
                  })
          }
          onToast={showToast}
          // Task 28-b 详情页通话桥：详情页发起的语音/视频通话经此下发到聊天页拨号
          pendingCall={pendingCall}
          onConsumePendingCall={() => setPendingCall(null)}
          onSwitchChat={(c) => {
            // Task 37 角色分支：创建成功直接切进分支聊天（contacts 稍后经 contact-updated 事件刷新，peer 兜底传入）
            setChatPeer(c);
            showToast(`已创建分支「${displayNameOf(c)}」，与原角色记忆独立`);
          }}
        />
        {/* 删除确认弹窗在聊天页之上（分支提前 return，根部的弹窗不渲染） */}
        {delTarget && (
          <FriendDeleteConfirmDialog
            variant="wx"
            peerName={displayNameOf(delTarget.contact)}
            onCancel={() => setDelTarget(null)}
            onConfirm={() => void confirmRemoveFriend()}
          />
        )}
      </>
    );
  }
  if (page === 'newFriends') {
    return (
      <NewFriendsPage
        reqs={reqsLive}
        onBack={() => setPage('main')}
        onGoAdd={() => setPage('addFriend')}
        onOpenReq={(r) => {
          setReqDetailFrom('newfriends');
          setReqDetail(r);
          setSearchProfile(null);
          setPage('friendReqDetail');
        }}
      />
    );
  }
  if (page === 'friendReqDetail' && (reqDetail || searchProfile)) {
    const req = reqDetail;
    const reqContact = req
      ? contacts.find((c) => c.id === (req.contactId ?? req.id)) ?? null
      : searchProfile;
    return (
      <FriendReqDetailPage
        req={req}
        contact={reqContact}
        liveAvatar={liveWxAvatar}
        onBack={() => {
          setReqDetail(null);
          setSearchProfile(null);
          setPage(req ? (reqDetailFrom === 'addfriend' ? 'addFriend' : 'newFriends') : 'addFriend');
        }}
        onAccept={(r) => void acceptFriendReqAction(r)}
        onReject={rejectFriendReqAction}
        onBlock={blockFriendReqAction}
        onVerify={(c) => {
          setSearchProfile(null);
          setApplyTarget(c);
          setPage('applyFriend');
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'addFriend') {
    return (
      <AddFriendPage
        contacts={contacts}
        me={me}
        onBack={() => setPage('main')}
        onOpenReqDetail={(c) => {
          setSearchProfile(c);
          setReqDetail(null);
          setPage('friendReqDetail');
        }}
        onOpenChat={(c) => setChatPeer(c)}
        onToast={showToast}
      />
    );
  }
  if (page === 'applyFriend' && applyTarget) {
    return (
      <ApplyFriendPage
        me={me}
        target={applyTarget}
        onBack={() => {
          setApplyTarget(null);
          setPage('addFriend');
        }}
        onSend={(payload) => {
          const t = applyTarget;
          setApplyTarget(null);
          void (async () => {
            const fresh = await handleApplySent(t, payload);
            if (fresh) {
              // 发送后进申请详情（已添加 + 验证消息线程，AI 欢迎回复稍后到达）
              setReqDetailFrom('addfriend');
              setReqDetail(fresh);
              setSearchProfile(null);
              setPage('friendReqDetail');
            } else {
              setPage('addFriend');
            }
          })();
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'search') {
    return (
      <WxSearchPage
        me={me}
        friends={friends}
        groups={wxGroups}
        moments={moments}
        onBack={() => setPage('main')}
        onOpenChat={(c) => {
          setPage('main');
          setChatPeer(c);
        }}
        onOpenGroup={(g) => {
          setPage('main');
          setTab('chats');
          setHidden(loadStrList(LS_CHAT_HIDDEN));
          setGroupPeer(g);
        }}
        onOpenMoments={() => {
          setMomentsScope('all');
          setPage('moments');
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'profile')
    return <ProfilePage me={me} record={meRecord} onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'settings')
    return <WxSettingsPage onBack={() => setPage('main')} onLogout={onLogout} onOpenAccountSwitch={() => setPage('accountSwitch')} />;
  // 切换账号子页（Task 40-D）：注册表账号卡 + 添加 + 管理；登录/切换成功后自动跳回主界面
  if (page === 'accountSwitch')
    return (
      <WxAccountSwitchPage
        me={me}
        onBack={() => setPage('settings')}
        onLoginOther={(u) => {
          onLoginAccount(u);
          setPage('main');
        }}
      />
    );
  if (page === 'services') return <WxServices friends={friends} myRealName={myRealName} onExit={() => setPage('main')} />;
  if (page === 'stickers') return <WxStickersPage onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'look') return <WxLookPage onBack={() => setPage('main')} onToast={showToast} />;
  // 主题界面（「发现」页 › 主题，原小程序位进入）：顶部毛玻璃胶囊两个选择——主题 / 气泡
  if (page === 'dress')
    return (
      <ThemeStylePage
        app="wx"
        onBack={() => setPage('main')}
        onToast={showToast}
        wxMe={{ name: me.name, avatar: me.avatar }}
      />
    );
  if (page === 'favorites') return <WxFavoritesPage onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'album') {
    // 我的主页「相册」入口：当前用户自己的相册（可增删改）
    return <AlbumPage contactId={me.id} title="我的相册" onClose={() => setPage('main')} allowEdit onToast={showToast} />;
  }
  if (page === 'momentsSettings') {
    // 48-6：朋友圈设置页（替换原「小店与卡包」入口）；onOpenPostNow 复用 moments 页 AskPostSheet
    return (
      <MomentsSettingsPage
        app="wx"
        onBack={() => setPage('main')}
        onToast={showToast}
        onOpenPostNow={() => {
          setAskOpen(true);
          // 让好友发的动态要在信息流里看见：打开全量动态页
          setMomentsScope('all');
          setPage('moments');
        }}
      />
    );
  }

  const TITLES: Record<Tab, string> = { chats: '微信', contacts: '通讯录', discover: '发现', me: '我' };

  /** 会话行渲染（chats tab：群会话分支 + 好友会话分支；divider = 行底细分割线——液态组内非末行 / 默认主题恒有） */
  const renderSessionRow = (
    row: { key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number },
    divider: boolean,
  ) => {
    const pinned = pinSet.has(row.key);
    const unreadCount = unreads[row.key] ?? 0;
    if (row.group) {
      // 群会话行（无长按菜单；点开进群聊页）
      const g = row.group;
      const gid = groupRowId(g.id);
      return (
        <button
          key={g.id}
          type="button"
          data-testid={`wx-chat-item-group-${g.id}`}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            markRead(gid);
            setGroupPeer(g);
          }}
          className={
            liquid
              ? `wx-session-row flex w-full select-none items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  divider ? 'border-b border-black/[0.06] dark:border-white/[0.08]' : ''
                } ${pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''}`
              : `wx-session-row flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                  pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
                }`
          }
        >
          <span className="relative shrink-0">
            <GroupAvatar group={g} contacts={contacts} size={44} />
            {unreadCount > 0 && (
              <span
                data-testid={`wx-unread-badge-${gid}`}
                aria-label={`${unreadCount} 条未读`}
                className={
                  flagsMap[gid]?.muted === true
                    ? 'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                    : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
                }
              >
                {flagsMap[gid]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[16px]">{g.remark?.trim() || g.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                {flagsMap[gid]?.muted === true && (
                  <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                )}
                <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{row.preview || '群聊已创建'}</p>
          </div>
        </button>
      );
    }
    const contact = row.contact;
    if (!contact) return null;
    return (
      <button
        key={contact.id}
        type="button"
        data-testid={`wx-chat-item-${contact.name}`}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          markRead(contact.id);
          setChatPeer(contact);
        }}
        onPointerDown={(e) => onSessionPointerDown(e, contact)}
        onPointerMove={onSessionPointerMove}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        className={
          liquid
            ? `wx-session-row flex w-full select-none items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                divider ? 'border-b border-black/[0.06] dark:border-white/[0.08]' : ''
              } ${pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''}`
            : `wx-session-row flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
              }`
        }
      >
        <span className="relative shrink-0">
          <WxAvatar src={contact.avatar} alt={contact.name} size={44} />
          {unreadCount > 0 && (
            <span
              data-testid={`wx-unread-badge-${contact.id}`}
              aria-label={`${unreadCount} 条未读`}
              className={
                flagsMap[contact.id]?.muted === true
                  ? /* 免打扰：不显示数字，只显示小红点（原生微信同款） */
                    'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                  : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
              }
            >
              {flagsMap[contact.id]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[16px]">
              {contact.name}
              {getBranchMeta(contact.id) && (
                <span className="ml-1.5 inline-block translate-y-[-1px] rounded-[3px] bg-black/[0.06] px-[4px] py-px align-middle text-[10px] font-normal leading-[14px] text-black/40 dark:bg-white/10 dark:text-white/40">
                  分支
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {flagsMap[contact.id]?.muted === true && (
                <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
              )}
              <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">
            {row.preview || '开始聊天吧'}
          </p>
        </div>
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      data-liquid-theme={liquid ? 'true' : 'false'}
      data-rt-theme={retro ? 'true' : 'false'}
      className={`relative flex h-full w-full flex-col ${retro ? 'rt-root' : 'bg-[#EDEDED] dark:bg-[#111111]'} text-black dark:text-white`}
    >
      {/* 顶栏：默认 =（微信：返回+搜索+＋；通讯录：＋；发现/我：无图标；左侧返回键退出微信回主屏）
          液态（第四十四轮，用户指定）：左上头像+名字无椭圆包裹、只在「微信」tab 显示；标题纯文字居中；右＝圆形玻璃＋钮
          wx-nav：主界面顶部导航锚点（自定义 CSS 示例模板可改导航底色） */}
      <div className={`wx-nav shrink-0 pt-[54px] ${retro ? 'rt-bar' : ''}`}>
        {liquid ? (
        <div className="relative flex h-12 items-center gap-2 px-2.5">
          {tab === 'chats' && (
            <button
              type="button"
              aria-label="返回主屏幕"
              data-testid="wx-exit"
              onClick={onExit}
              className="flex min-w-0 max-w-[46%] flex-1 items-center gap-2.5 px-1 py-1.5 active:opacity-60"
            >
              <WxAvatar src={me.avatar} alt={me.name} size={34} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[14.5px] font-semibold leading-tight">{me.name}</span>
                <span className="mt-[3px] flex items-center gap-1 text-[10.5px] leading-none">
                  <span className="h-[6.5px] w-[6.5px] rounded-full bg-[#07C160]" aria-hidden="true" />
                  <span className="font-medium text-[#07C160]">在线</span>
                </span>
              </span>
            </button>
          )}
          {/* 右侧配重占位：与左侧头像区等分剩余空间，标题真正居中 */}
          <div className="flex flex-1 justify-end">
            {(tab === 'chats' || tab === 'contacts') ? (
              <button
                type="button"
                aria-label={tab === 'chats' ? '更多功能' : '添加朋友'}
                data-testid="wx-plus"
                onClick={() => {
                  if (tab === 'contacts') {
                    setPage('addFriend');
                    return;
                  }
                  setMenuOpen(true);
                }}
                className="lg-chip flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full active:opacity-60"
              >
                {/* 第四十五轮（用户指定）：玻璃圆圈内嵌黑色圆圈（同语音钮样式）；
                    第四十八轮（用户指定）：按钮变小一点 42→36px（内圈 31→26、图标 19→16） */}
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 dark:border-white/70 dark:text-white/90">
                  <Plus className="h-[16px] w-[16px]" strokeWidth={2.1} />
                </span>
              </button>
            ) : null}
          </div>
          {/* 标题绝对居中：纯文字无胶囊（参考图 WeChat 同款） */}
          <div className="absolute left-1/2 top-1/2 flex h-[42px] max-w-[42%] -translate-x-1/2 -translate-y-1/2 items-center justify-center px-4 text-[16.5px] font-semibold">
            {TITLES[tab]}
          </div>
        </div>
        ) : (
        <div className="flex h-11 items-center px-4">
          <div className="flex flex-1 items-center justify-start">
            <button
              type="button"
              aria-label="返回主屏幕"
              data-testid="wx-exit"
              onClick={onExit}
              className={`-ml-1.5 p-1 ${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
            >
              <ChevronLeft className="h-[23px] w-[23px]" strokeWidth={2.2} />
            </button>
          </div>
          <div className={`text-[17px] ${retro ? 'font-bold text-[#3A3E4C]' : 'font-medium'}`}>{TITLES[tab]}</div>
          <div className="flex flex-1 items-center justify-end gap-5">
            {tab === 'chats' && (
              <button
                type="button"
                aria-label="搜索"
                data-testid="wx-search-entry"
                onClick={() => setPage('search')}
                className={`${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
              >
                <Search className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
            )}
            {(tab === 'chats' || tab === 'contacts') && (
              <button
                type="button"
                aria-label={tab === 'chats' ? '更多功能' : '添加朋友'}
                data-testid="wx-plus"
                onClick={() => {
                  if (tab === 'contacts') {
                    setPage('addFriend');
                    return;
                  }
                  setMenuOpen(true);
                }}
                className={`${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
              >
                <Plus className="h-[22px] w-[22px]" strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {/* 右上角 + 菜单：默认 = 深色下拉；液态 = 参考图乳白玻璃竖列面板（第四十六轮变小：宽 248/行 44/字 14.5/图标 19） */}
      {menuOpen && (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          {liquid ? (
            <div
              data-testid="wx-plus-menu"
              className="lg-sheet absolute right-2.5 top-[104px] z-40 w-[min(80%,248px)] overflow-hidden rounded-[20px] py-[4px]"
              role="menu"
            >
              {(
                [
                  ['group', '发起群聊', <Users key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); setGroupPage('create'); }],
                  ['addfriend', '添加朋友', <UserPlus key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); setPage('addFriend'); }],
                  ['scan', '扫一扫', <ScanLine key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); openScan('wechat'); }],
                  ['pay', '收付款', <Banknote key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); showToast('「收付款」暂未开放'); }],
                  ['mini', '小程序', <AppWindow key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); showToast('「小程序」暂未开放'); }],
                  ['readall', '一键已读', <CheckCheck key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); sessions.forEach((s) => wxUnreads.clear(s.key)); showToast('已一键清除全部未读'); }],
                ] as Array<[string, string, React.ReactNode, () => void]>
              ).map(([key, label, icon, act]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  data-testid={`wx-menu-${key}`}
                  onClick={act}
                  className="lg-menu-row flex h-[44px] w-full items-center gap-3 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          ) : (
          <div className={`absolute right-3 top-[94px] z-40 w-[152px] overflow-hidden rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.25)] ${retro ? 'border border-[#9A9CA6] bg-white text-[#2E2E33]' : 'rounded-[8px] bg-[#4C4C4C] text-white shadow-xl dark:bg-[#383838]'}`}>
            <button
              type="button"
              data-testid="wx-menu-addfriend"
              onClick={() => {
                setMenuOpen(false);
                setPage('addFriend');
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-[11px] text-left text-[15.5px] ${retro ? 'active:bg-black/[0.06]' : 'active:bg-white/10'}`}
            >
              <UserPlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
              添加朋友
            </button>
            <button
              type="button"
              data-testid="wx-menu-group"
              onClick={() => {
                setMenuOpen(false);
                setGroupPage('create');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />
              发起群聊
            </button>
            <button
              type="button"
              data-testid="wx-menu-scan"
              onClick={() => {
                setMenuOpen(false);
                openScan('wechat');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <ScanLine className="h-[18px] w-[18px]" strokeWidth={1.9} />
              扫一扫
            </button>
            <button
              type="button"
              data-testid="wx-menu-pay"
              onClick={() => {
                setMenuOpen(false);
                showToast('「收付款」暂未开放');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <Banknote className="h-[18px] w-[18px]" strokeWidth={1.9} />
              收付款
            </button>
          </div>
          )}
        </>
      )}

      {/* 内容区（液态主题：底部多留 88px——悬浮胶囊 TabBar 覆盖在滚动流上，内容从玻璃底下穿过） */}
      <div className={liquid ? 'min-h-0 flex-1 overflow-y-auto pb-[88px]' : 'min-h-0 flex-1 overflow-y-auto'}>
        {tab === 'chats' && (
          <>
            {liquid && (
              /* 液态（参考图）：搜索胶囊 + 小组件区（网易云/日历/自定义 CSS，可开关） + 分类标签栏（分段控件）；搜索点按进搜索页，分类过滤下方会话卡片 */
              <div className="px-2.5 pt-1">
                <button
                  type="button"
                  data-testid="wx-search-capsule"
                  onClick={() => setPage('search')}
                  className="lg-search mb-2.5 flex h-[40px] w-full items-center justify-center gap-1.5 rounded-full text-black/40 active:opacity-60 dark:text-white/40"
                >
                  <Search className="h-[16px] w-[16px]" strokeWidth={2.1} aria-hidden="true" />
                  <span className="text-[14px]">搜索</span>
                </button>
                {/* 小组件区：搜索框下、分类标签上，在 主题页›液态玻璃设置 里开关（网易云已连接音乐 App） */}
                <WxLiquidWidgets me={me} />
                <div
                  className="lg-seg mb-2.5 flex items-center gap-1 overflow-x-auto rounded-[17px] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="tablist"
                  aria-label="会话分类"
                  data-testid="wx-cat-bar"
                >
                  {(
                    [
                      /* 第四十六轮（用户指定）：加回「工作」分类（全部/好友/工作/群聊/服务号）；
                         本轮：五个标签文字可在 主题页›液态玻璃设置 自定义（空 = 默认文字） */
                      ...LIQUID_TABS.map((t) => [t.key, liquidTabLabel(liquidSkinWx, t.key)] as const),
                    ] as Array<['all' | 'friends' | 'work' | 'groups' | 'officials', string]>
                  ).map(([id, label]) => {
                    const active = cat === id;
                    /* 分类标签红点角标（参考图）：全部 = 总未读数；好友 = 非群会话未读数 */
                    const catUnread =
                      id === 'all' ? totalUnread : id === 'friends'
                        ? sessions.reduce((acc, s) => (s.group ? acc : acc + (unreads[s.key] ?? 0)), 0)
                        : 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-testid={`wx-cat-${id}`}
                        onClick={() => setCat(id)}
                        /* 第四十七轮（用户指定「位置调整」）：五个标签 flex-1 均分铺满容器——
                           消除原先靠左堆叠、右侧大段空白的失衡（VLM 采证确认） */
                        className={`relative flex h-[32px] min-w-0 flex-1 basis-0 items-center justify-center px-1 text-[13.5px] transition-colors ${
                          active
                            ? /* 第四十六轮（用户指定，参考图）：选中 = 绿色文字 + 底部绿色横线（删胶囊背景） */
                              'font-semibold text-[#07C160] dark:text-[#3DDC84]'
                            : 'font-medium text-black/55 active:opacity-60 dark:text-white/55'
                        }`}
                      >
                        {label}
                        {active && (
                          <span
                            className="absolute inset-x-[9px] bottom-[2px] h-[2.5px] rounded-full bg-[#07C160] dark:bg-[#3DDC84]"
                            aria-hidden="true"
                          />
                        )}
                        {!active && catUnread > 0 && (
                          <span
                            className="absolute right-[7px] top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[9.5px] font-semibold leading-none text-white"
                            aria-label={`${catUnread} 条未读`}
                          >
                            {catUnread > 99 ? '99+' : catUnread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 古早（第五十九轮，用户指定「白色面板太长，弄到联系人那里」）：去掉 min-h-full——
                白色分组卡高度贴合会话行数（iOS 6 分组表格同款），底部露出淡青灰纸感底；
                默认主题保持 min-h-full 整幅白底不变 */}
            <div className={liquid ? 'px-2.5 pb-2' : retro ? 'mx-2 rounded-[8px] bg-white shadow-[inset_0_0_0_1px_#C3C5CC]' : 'min-h-full bg-white dark:bg-[#1A1A1A]'}>
              {(liquid ? visibleSessions : sessions).length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-[14px] text-black/35 dark:text-white/35">{liquid && cat !== 'all' ? '该分类下暂无会话' : '还没有会话'}</p>
                  <p className="mt-1 text-[12.5px] text-black/30 dark:text-white/30">{liquid && cat !== 'all' ? '换个分类看看吧' : '添加好友后，在这里和 TA 聊天'}</p>
                </div>
              )}
            {liquid ? (
              /* 液态（用户指定）：置顶会话一张白色面板、非置顶会话一张白色面板（组内细分割线，卡间间隙） */
              liquidGroups.map((g, gi) => (
                <div key={gi} className="lg-panel mb-2.5 overflow-hidden">
                  {g.map((row, ri) => renderSessionRow(row, ri < g.length - 1))}
                </div>
              ))
            ) : (
              sessions.map((row) => renderSessionRow(row, true))
            )}
            </div>
          </>
        )}

        {tab === 'contacts' && (
          <div className="relative min-h-full pb-4">
            {/* 功能入口（古早：全幅白列表首段，旧微信通讯录无分组卡片） */}
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'rt-plain' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="新的朋友"
                testId="wx-newfriends-entry"
                onClick={() => setPage('newFriends')}
                icon={
                  <WxTileIcon bg="#F5A623">
                    <UserPlus className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="群聊"
                onClick={() => setGroupPage('list')}
                icon={
                  <WxTileIcon bg="#07C160">
                    <Users className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="标签"
                onClick={() => showToast('「标签」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Tag className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="公众号"
                onClick={() => showToast('「公众号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Newspaper className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="服务号"
                onClick={() => showToast('「服务号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Wallet className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
            </div>

            {/* 我（本人）—— 首次登录通讯录只有这一位；点击进入与好友同款的详情页 */}
            <div className={liquid ? 'mx-2.5 mt-2.5 lg-panel' : retro ? 'mt-2 rt-plain' : 'mt-2 bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label={me.name}
                testId="wx-contact-me"
                onClick={() => {
                  openFriendDetail(contacts.find((c) => c.id === me.id) ?? meAsContact(me));
                }}
                icon={<WxAvatar src={me.avatar} alt={me.name} size={38} />}
              />
            </div>

            {/* 好友（添加过才会出现，和信息 App 一致） */}
            {friends.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13.5px] leading-relaxed text-black/35 dark:text-white/35">
                还没有好友
                <br />
                点右上角 ＋ ›「添加朋友」认识新朋友
              </p>
            ) : (
              <div className="relative">
                {groups.map((g) => (
                  <div key={g.letter} id={`wx-letter-${g.letter}`}>
                    <p className="wx-letter-bar sticky top-0 bg-[#EDEDED] px-4 py-1 text-[13px] text-black/50 dark:bg-[#111111] dark:text-white/50">
                      {g.letter}
                    </p>
                    {/* 古早：字母分组也是全幅白列表段（与上方连续，仅字母条隔开） */}
                    <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'rt-plain' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
                      {g.list.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          data-testid={`wx-contact-${c.name}`}
                          onClick={() => openFriendDetail(c)}
                          className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5"
                        >
                          <WxAvatar src={c.avatar} alt={c.name} size={40} />
                          <span className="flex-1 truncate text-[16px]">
                            {c.name}
                            {getBranchMeta(c.id) && (
                              <span className="ml-1.5 inline-block translate-y-[-1px] rounded-[3px] bg-black/[0.06] px-[4px] py-px align-middle text-[10px] font-normal leading-[14px] text-black/40 dark:bg-white/10 dark:text-white/40">
                                分支
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* 字母索引条（只在好友列表区域悬浮） */}
                <div className="absolute right-1 top-2 flex flex-col items-center gap-[1px] text-[10px] text-black/45 dark:text-white/45">
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((ch) => (
                    <span
                      key={ch}
                      className={`px-1 ${groups.some((g) => g.letter === ch) ? '' : 'opacity-30'}`}
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'discover' && (
          <div className={liquid ? 'space-y-2.5 pb-6' : 'space-y-2 pb-6'}>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="朋友圈"
                testId="wx-moments-entry"
                badge={wxNoticeBadge.count}
                onClick={() => {
                  // 发现页入口：全量朋友圈信息流（自己+好友的动态）
                  setMomentsScope('all');
                  setPage('moments');
                }}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.moments}><RtWMoments /></RetroIc> : <WxIcMoments small />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="视频号"
                onClick={() => showToast('「视频号」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.channels}><RtWChannels /></RetroIc> : <WxIcChannels />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="扫一扫"
                onClick={() => openScan('wechat')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.scan}><RtWScan /></RetroIc> : <WxIcScan />}
              />
              <WxMenuRow
                label="听一听"
                onClick={() => showToast('「听一听」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.listen}><RtWListen /></RetroIc> : <WxIcListen />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="看一看"
                onClick={() => setPage('look')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.stories}><RtWStories /></RetroIc> : <WxIcStories />}
              />
              <WxMenuRow
                label="搜一搜"
                onClick={() => showToast('「搜一搜」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.search}><RtWSearch /></RetroIc> : <WxIcSearch />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="游戏"
                onClick={() => showToast('「游戏」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.games}><RtWGames /></RetroIc> : <WxIcGames />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              {/* 主题（发现页入口；界面内毛玻璃胶囊提供主题/气泡两个选择） */}
              <WxMenuRow
                first
                label="主题"
                testId="wx-discover-theme"
                onClick={() => setPage('dress')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.theme}><RtWTheme /></RetroIc> : <WxIcTheme />}
              />
            </div>
          </div>
        )}

        {tab === 'me' && (
          <div className={liquid ? 'space-y-2.5 pb-6' : 'space-y-2 pb-6'}>
            {/* 名片：默认 = 头像+名字+微信号左对齐（微信原生白底样式，点击进个人信息页）；
                液态 = 参考图居中名片（大头像居中 + 名字下方 + 「+ 状态 / N 个朋友」胶囊标签） */}
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              {liquid ? (
                <button
                  type="button"
                  data-testid="wx-me-profile"
                  onClick={() => setPage('profile')}
                  className="flex w-full flex-col items-center px-4 pb-5 pt-6 text-center active:opacity-70"
                >
                  <span className="block shrink-0">
                    <WxAvatar src={me.avatar} alt={me.name} size={72} />
                  </span>
                  <span className="mt-3 block max-w-full truncate text-[21px] font-semibold leading-tight">{me.name}</span>
                  <span
                    data-testid="wx-me-wxid"
                    className="mt-1 block max-w-full truncate text-[12.5px] text-black/40 dark:text-white/40"
                  >
                    微信号：{me.wechatId || me.phone || '未设置'}
                  </span>
                  <span className="mt-3.5 flex items-center gap-2">
                    <span className="lg-search flex h-[30px] items-center gap-1 rounded-full px-3.5 text-[12.5px] font-medium text-black/60 dark:text-white/60">
                      <Plus className="h-[13px] w-[13px]" strokeWidth={2.2} aria-hidden="true" />
                      状态
                    </span>
                    <span className="lg-search flex h-[30px] items-center rounded-full px-3.5 text-[12.5px] font-medium text-black/60 dark:text-white/60">
                      {friends.length} 个朋友
                    </span>
                  </span>
                </button>
              ) : (
              <button
                type="button"
                data-testid="wx-me-profile"
                onClick={() => setPage('profile')}
                className="flex w-full items-center gap-4 px-4 py-5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="block shrink-0">
                  <WxAvatar src={me.avatar} alt={me.name} size={64} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[21px] font-semibold leading-tight">{me.name}</span>
                  <span
                    data-testid="wx-me-wxid"
                    className="mt-1.5 block truncate text-[13.5px] text-black/45 dark:text-white/45"
                  >
                    微信号：{me.wechatId || me.phone || '未设置'}
                  </span>
                </span>
                <QrCode className="h-5 w-5 shrink-0 text-black/50 dark:text-white/50" strokeWidth={1.8} />
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </button>
              )}
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="服务"
                testId="wx-services-entry"
                onClick={() => setPage('services')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.wallet}><RtWWallet /></RetroIc> : <WxIcServices />}
              />
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="收藏"
                testId="wx-me-favorites"
                onClick={() => setPage('favorites')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.favorites}><RtWFavorites /></RetroIc> : <WxIcFavorites />}
              />
              <WxMenuRow
                label="朋友圈"
                testId="wx-me-moments"
                onClick={() => {
                  // 「我」页入口：我的朋友圈（只显示我发的动态）
                  setMomentsScope('mine');
                  setPage('moments');
                }}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.moments}><RtWMoments /></RetroIc> : <WxIcMoments small />}
              />
              <WxMenuRow
                label="相册"
                testId="wx-me-album"
                onClick={() => setPage('album')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.works}><RtWWorks /></RetroIc> : <WxIcWorks />}
              />
              <WxMenuRow
                label="朋友圈设置"
                testId="wx-me-moments-settings"
                onClick={() => setPage('momentsSettings')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.settings}><RtWSettings /></RetroIc> : <WxIcSettings />}
              />
              <WxMenuRow
                label="表情"
                testId="wx-me-stickers"
                onClick={() => setPage('stickers')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.sticker}><RtWSticker /></RetroIc> : <WxIcSticker />}
              />
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="设置"
                testId="wx-me-settings"
                onClick={() => setPage('settings')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.settings}><RtWSettings /></RetroIc> : <WxIcSettings />}
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部 TabBar（上移预留底部横杠安全区）；第三十四轮：上下变小 h-52→46、图标 26→23
          液态玻璃主题（参考图）：悬浮胶囊 Dock——纯图标（无文字标签），选中图标包裹微信绿液态玻璃圆泡
          wx-tabbar：底部标签栏锚点（自定义 CSS 示例模板可改底色/顶线） */}
      <div
        className={
          liquid
            ? 'wx-tabbar lg-tabbar absolute inset-x-3 bottom-[12px] z-30'
            : retro
            ? /* 古早（第五十四轮）：银灰拟物 TabBar */ 'wx-tabbar rt-tabbar shrink-0 pb-[16px]'
            : 'wx-tabbar shrink-0 border-t border-black/10 bg-[#F7F7F7] pb-[16px] dark:border-white/10 dark:bg-[#1A1A1A]'
        }
      >
        <div className={liquid ? 'flex h-[54px] items-stretch px-1' : retro ? 'flex h-[48px] items-stretch' : 'flex h-[46px] items-stretch'}>
          {(
            [
              ['chats', '微信', retro ? <RtChatIcon key="i" className="h-[23px] w-[23px]" /> : <MessageCircle key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, true],
              ['contacts', '通讯录', retro ? <RtContactsIcon key="i" className="h-[23px] w-[23px]" /> : <Users key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
              ['discover', '发现', retro ? <RtDiscoverIcon key="i" className="h-[23px] w-[23px]" /> : <WxTabCompassIcon key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
              ['me', '我', retro ? <RtMeIcon key="i" className="h-[23px] w-[23px]" /> : <User key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
            ] as Array<[Tab, string, React.ReactNode, boolean]>
          ).map(([id, label, icon, fillActive]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`wx-tab-${id}`}
                onClick={() => setTab(id)}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
                  active ? (retro ? 'rt-tab-on' : 'text-[#07C160]') : retro ? 'text-[#6A6E7C]' : 'text-black/55 dark:text-white/55'
                }`}
                aria-label={label}
              >
                {liquid ? (
                  /* 液态（第四十五轮，参考图）：纯图标模式；选中 = 浅色半透明胶囊底 + 微信绿填充图标（全部 tab 填充态） */
                  <span className="relative flex h-full w-full items-center justify-center">
                    <span
                      className={`flex h-[38px] w-[68px] items-center justify-center rounded-full transition-colors duration-200 ${
                        active
                          ? 'bg-black/[0.07] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.55)] dark:bg-white/[0.14] dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.16)]'
                          : ''
                      }`}
                    >
                      <span
                        className={`${
                          active
                            ? 'text-[#07C160] [&>svg]:fill-current dark:text-[#3DDC84]'
                            : 'text-black/60 dark:text-white/60'
                        }`}
                      >
                        {icon}
                      </span>
                    </span>
                    {id === 'chats' && totalUnread > 0 && (
                      <span
                        data-testid="wx-tab-badge-chats"
                        aria-label={`${totalUnread} 条未读`}
                        className="absolute right-[26%] -top-[1px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ring-white/85 dark:ring-white/25"
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                    {id === 'discover' && wxNoticeBadge.count > 0 && (
                      <span
                        data-testid="wx-tab-badge-discover"
                        aria-label={`朋友圈 ${wxNoticeBadge.count} 条新消息`}
                        className="absolute right-[26%] -top-[1px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ring-white/85 dark:ring-white/25"
                      >
                        {wxNoticeBadge.count > 99 ? '99+' : wxNoticeBadge.count}
                      </span>
                    )}
                  </span>
                ) : (
                <span className={`relative ${active && fillActive && !retro ? '[&>svg]:fill-current' : ''}`}>
                  {icon}
                  {id === 'chats' && totalUnread > 0 && (
                    <span
                      data-testid="wx-tab-badge-chats"
                      aria-label={`${totalUnread} 条未读`}
                      className={`absolute -right-[8px] -top-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                        liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-[#F7F7F7] dark:ring-[#1A1A1A]'
                      }`}
                    >
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                  {id === 'discover' && wxNoticeBadge.count > 0 && (
                    <span
                      data-testid="wx-tab-badge-discover"
                      aria-label={`朋友圈 ${wxNoticeBadge.count} 条新消息`}
                      className={`absolute -right-[8px] -top-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                        liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-[#F7F7F7] dark:ring-[#1A1A1A]'
                      }`}
                    >
                      {wxNoticeBadge.count > 99 ? '99+' : wxNoticeBadge.count}
                    </span>
                  )}
                </span>
                )}
                {!liquid && <span className={`text-[10px] ${retro ? 'font-semibold' : ''}`}>{label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 长按会话菜单（标为未读/置顶/不显示/删除；默认 = 浅色白底卡片，液态 = 横向 2×2 玻璃网格，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="wx-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menu"
            aria-label="会话操作"
            data-testid="wx-session-ctx"
            className={
              liquid
                ? /* 液态（用户指定）：横向 2×2 玻璃网格浮层 */ 'lg-sheet absolute z-50 grid w-[min(84%,320px)] grid-cols-2 overflow-hidden rounded-[24px] p-[5px] text-[#1C1C1E] dark:text-white/90'
                : 'absolute z-50 min-w-[176px] overflow-hidden rounded-[12px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]'
            }
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-unread"
              onClick={() => {
                toggleUnread(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              <MailOpen className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              {unreads[ctx.contact.id] ? '标为已读' : '标为未读'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-pin"
              onClick={() => {
                togglePin(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              {pinSet.has(ctx.contact.id) ? (
                <PinOff className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Pin className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              )}
              {pinSet.has(ctx.contact.id) ? '取消置顶' : '置顶该聊天'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-hide"
              onClick={() => {
                hideSession(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              <EyeOff className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              不显示该聊天
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-delete"
              onClick={() => {
                deleteSession(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold text-[#E5484D]'
                  : 'flex h-[46px] w-full items-center gap-2.5 px-4 text-left text-[15px] text-[#FA5151] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10'
              }
            >
              <Trash2 className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              删除该聊天
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
          {toast}
        </div>
      )}

      {/* 删除联系人二次确认（聊天设置 / 好友详情页共用；明确告知删什么/留什么） */}
      {delTarget && (
        <FriendDeleteConfirmDialog
          variant="wx"
          peerName={displayNameOf(delTarget.contact)}
          onCancel={() => setDelTarget(null)}
          onConfirm={() => void confirmRemoveFriend()}
        />
      )}
    </div>
  );
}

// ---------------- App 入口 ----------------

export default function WeChatApp() {
  const closeApp = useUI((s) => s.closeApp);
  // 第五十五轮（用户指定「所有界面都变化」）：主题作用域挂到 App 根 wrapper——
  // data-rt-theme / data-liquid-theme 触发 globals.css 里的 scoped 批量接管，
  // 覆盖主界面/聊天页/全部子页与弹层（页面底/白色卡/按钮/菜单），子页无需逐个改 JSX
  const bubbleStyleRoot = useSettings((s) => s.bubbleStyle);
  const retroRoot = isRetroTheme(bubbleStyleRoot, 'wx');
  const liquidRoot = isLiquidTheme(bubbleStyleRoot, 'wx');
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<WxUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  /** id → 真实名字（钱包持卡人用；微信内显示的是昵称，昵称不是真实名字） */
  const [realNameById, setRealNameById] = useState<Record<string, string>>({});

  const toWxUser = useCallback((c: ContactRecord): WxUser => {
    return {
      id: c.id,
      name: displayNameOf(c),
      // 真名/昵称随会话携带：AI 称呼（persona/group prompt）与群成员解析要用，展示仍用 name。
      // contacts 是 withDisplayNames 后的展示副本（name 已被昵称替换）→ 真名必须取 realName 字段
      realName: c.realName ?? c.name,
      nickname: c.nickname ?? null,
      avatar: c.avatar,
      wechatId: c.wechatId,
      phone: c.phone,
      qqId: c.qqId,
      // 2025（小号加好友 AI 决策）：会话恢复也必须带 altOf——登录时 handleLogin 存入的
      // altOf 会被账号切换事件触发的 boot 重跑（此处）覆盖，丢失后小号加好友会走错「发送即通过」旧链路
      altOf: c.altOf ?? null,
    };
  }, []);

  /** NPC 归属者名字（聊天人设用） */
  const ownerName = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c.name]));
    const npcOwner = (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return byId.get(c.ownerId) ?? null;
    };
    return npcOwner;
  }, [contacts]);

  const loadContacts = useCallback(async (): Promise<ContactRecord[]> => {
    // 微信内显示昵称（昵称优先于真实名字，机主本人同规则——社交展示名 socialNameOf；副本 realName 存真名，
    // AI 链路统一走 addressNameOf/ownerRealNameFor 取真名，永不接触机主昵称）。
    // 头像按 App 隔离：读 wx 投影（App 槽位优先、回退全局 avatar），微信里看到的头像独立于 QQ/信息/电话。
    // 备注按 App 隔离（第四十八轮）：微信里设置的备注只写 remarks.wx——微信显示它，QQ/信息不受影响
    const raw = await listContactsFor('wx');
    setRealNameById(Object.fromEntries(raw.map((c) => [c.id, c.name])));
    return withDisplayNames(raw, { social: true, app: 'wx' });
  }, []);

  /** 重新拉取联系人（添加好友后调用，列表即时生效）；返回新列表供「我」快照同步复用 */
  const reloadContacts = useCallback(async (): Promise<ContactRecord[]> => {
    const list = await loadContacts().catch(() => [] as ContactRecord[]);
    setContacts(list);
    return list;
  }, [loadContacts]);

  // 换头像跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，渲染端 liveAvatarOf 实时解析；
  // 其他 App（联系人/信息/电话/QQ）改了头像时刷新本端联系人缓存，打开中的朋友圈/聊天页立刻显示新头像。
  // contact-updated：任意资料字段（名字/手机号/昵称/人设…）变更也刷新——编辑联系人不换头像时
  // 微信端不再持旧快照（会话列表/资料页/登录解析保持最新）。
  // 「我」快照同步（编辑自己修复）：user 是开机/登录时 from 联系人的快照——机主在联系人 App
  // 改了自己头像/名字后，朋友圈发帖署名、聊天气泡我的头像等仍持旧值；这里随重载按最新联系人重派生
  useEffect(() => {
    const fn = () =>
      void reloadContacts().then((list) => {
        setUser((prev) => {
          if (!prev) return prev;
          const hit = list.find((c) => c.id === prev.id && c.kind === 'user');
          return hit ? toWxUser(hit) : prev;
        });
      });
    window.addEventListener('contact-avatar-changed', fn);
    window.addEventListener('contact-updated', fn);
    return () => {
      window.removeEventListener('contact-avatar-changed', fn);
      window.removeEventListener('contact-updated', fn);
    };
  }, [reloadContacts, toWxUser]);

  // 小号加好友 AI 决策落盘（2025）：同意 = 好友标记变化 → 刷新联系人（通讯录/会话列表即时出现）；
  // 拒绝/先回复不改变好友标记，刷新无副作用
  useEffect(() => {
    const fn = () => void reloadContacts();
    window.addEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
    return () => window.removeEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
  }, [reloadContacts]);

  // 删好友后 AI 主动申请加回：定时器不跨刷新，微信挂载时扫描删除状态按冷却补跑
  useEffect(() => {
    runFriendReqCatchUp();
  }, []);

  // 多账号 v2（Task 40-2a）：微信账号切换不刷新网页——监听切换事件：①中断 wx 在途流（已收尾不再落盘）
  // ②清理 wx 投递队列 ③排队补跑内存队列换仓到新账号快照；④bump reloadKey → 启动加载 effect 重跑
  //（联系人重读 + 按新账号作用域恢复登录态，无登录态 → 登录墙）。列表数据的复位与重读在 MainScreen 内监听同一事件。
  const [accReloadKey, setAccReloadKey] = useState(0);
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      abortStreamsByPrefix('wx:');
      purgeDeliveryQueueByPrefix('wx:');
      wxQueueReload();
      setAccReloadKey((k) => k + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);

  // 启动 / 账号切换重跑：拉联系人 + 恢复登录态（联系人被删则自动登出）。
  // 登录态键按微信当前账号作用域（Task 40-2a：accLs 调用时现算，大号=原键旧登录态不丢）；
  // 切换账号（accReloadKey 变化）重跑时：无登录态/联系人缺失 → 显式回登录墙，杜绝上一账号的界面残留。
  useEffect(() => {
    let alive = true;
    (async () => {
      // 匿名号只属于电话/信息（Task 40-S）：历史遗留的微信匿名号槽位开机自愈切回大号
      //（switchAccountFor 派发事件 → 下方监听器 bump accReloadKey 重跑本 effect）
      if (getActiveAccountFor('wx').kind === 'anon') {
        switchAccountFor('wx', MAIN_ACCOUNT_ID);
        return;
      }
      // 多账号 Task 41：退出登录后的自由登录墙——本次启动不恢复任何会话，
      // 直接进自由登录（不显示/不锁定「当前账号」，想登哪个登哪个）。
      // 2025 补充（登录态保持）：只检查不消费——标记持续到下一次登录成功（handleLogin 清除），
      // 「退出 → 关掉 App → 再打开」仍是自由登录墙；登录过一次后所有账号免登录切换。
      if (isForceLoginWallActive('wx')) {
        if (!alive) return;
        setUser(null);
        setBooting(false);
        return;
      }
      const list = await loadContacts().catch(() => [] as ContactRecord[]);
      if (!alive) return;
      setContacts(list);
      try {
        const sKey = accLs(LS_SESSION, 'wx');
        const savedId = window.localStorage.getItem(sKey);
        // Task 40 修正：小号/匿名号槽位的会话必须指向本槽位档案联系人——
        // 历史串槽登录态（在 A 小号槽位登了 B 的账密）在此自愈清除，避免切号页显示错账号
        const acc = getActiveAccountFor('wx');
        // Task 41 补强：大号作用域的会话指向了小号/匿名号档案（历史串槽残留）→ 清除回自由登录
        if (savedId && acc.kind === 'main') {
          const saved = list.find((c) => c.id === savedId && c.kind === 'user');
          if (saved?.altOf) {
            window.localStorage.removeItem(sKey);
            setUser(null);
            setBooting(false);
            return;
          }
        }
        const slotProfile =
          acc.kind !== 'main' && savedId
            ? list.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId))
            : null;
        if (savedId && acc.kind !== 'main' && (!slotProfile || slotProfile.id !== savedId)) {
          window.localStorage.removeItem(sKey);
          setUser(null);
        } else if (savedId) {
          const u = list.find((c) => c.id === savedId && c.kind === 'user');
          if (u) setUser(toWxUser(u));
          else {
            window.localStorage.removeItem(sKey);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadContacts, toWxUser, accReloadKey]);

  const handleLogin = useCallback((u: WxUser) => {
    // 多账号 Task 41：登录身份落到对应账号作用域——自由登录可能是某个小号（档案 altOf），
    // 槽位登录已是本槽位（switchAccountFor 同 id no-op）；大号机主档案回 main。
    // 必须在写会话前切：事件驱动 boot 重跑时读到的已是新作用域的会话键。
    const accId = u.altOf || MAIN_ACCOUNT_ID;
    switchAccountFor('wx', accId);
    try {
      // 登录历史：切换账号列表只显示登录过的账号（Task 41）
      markAccountLoginHistory('wx', accId);
      // 登录成功 = 退出后的自由登录墙使命完成（标记在下次退出前不再出现）
      clearForceLoginWall('wx');
      window.localStorage.setItem(accLs(LS_SESSION, 'wx'), u.id);
    } catch {
      // 忽略
    }
    setUser(u);
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    // 登录态保持（2025）：退出只退「当前身份」，不删任何账号的会话键——
    // 其他已登录账号（含刚退出的这个）在切换账号页点击仍直接进入，无需重新输密码；
    // 退出后的自由登录墙持续到下一次登录成功（isForceLoginWallActive + handleLogin 清除）。
    // 多账号 Task 41：退出后回大号身份 + 自由登录墙——不显示「当前账号」、不锁定登录身份。
    requestForceLoginWall('wx');
    switchAccountFor('wx', MAIN_ACCOUNT_ID);
  }, []);

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#EDEDED] dark:bg-[#111111]">
        <svg viewBox="0 0 40 40" className="h-16 w-16 opacity-90" aria-hidden="true">
          <path
            d="M15.5 6.5C9.1 6.5 4 10.8 4 16.1c0 3 1.7 5.7 4.4 7.5l-1.1 3.9 4.3-2.3c1.2.3 2.5.5 3.9.5h.8c-.2-.9-.3-1.8-.3-2.7 0-5.6 5.2-10.1 11.7-10.1.3 0 .5 0 .8.1C26.9 9.2 21.6 6.5 15.5 6.5z"
            fill="#3ECB5C"
          />
          <path
            d="M27.5 14.5c-5.6 0-10.2 3.9-10.2 8.7s4.6 8.7 10.2 8.7c1.1 0 2.2-.2 3.2-.4l3.8 2-1-3.5c2.2-1.6 3.6-4 3.6-6.8 0-4.8-4.6-8.7-9.6-8.7z"
            fill="#07C160"
          />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">微信</p>
      </div>
    );
  }

  if (!user) {
    // 小号/匿名号槽位：登录墙绑定当前槽位（显示账号名/预填账号/只认本槽位账密）；大号保持原自由登录
    const acc = getActiveAccountFor('wx');
    return <LoginScreen onLogin={handleLogin} slot={acc.kind === 'main' ? null : acc} />;
  }

  return (
    <div
      className="relative h-full w-full"
      data-rt-theme={retroRoot ? 'true' : 'false'}
      data-liquid-theme={liquidRoot ? 'true' : 'false'}
    >
      {/* 第五十六轮：古早/液态皮肤下发到共享子页（chat-settings 二级页 / 主动发消息 / 搜索页等） */}
      <ChatSkinProvider retro={retroRoot} liquid={liquidRoot}>
      <MainScreen
        me={user}
        contacts={contacts}
        myRealName={realNameById[user.id] ?? user.name}
        ownerName={ownerName}
        reloadContacts={reloadContacts}
        onLogout={handleLogout}
        onExit={closeApp}
        onLoginAccount={handleLogin}
      />
      {/* 扫一扫（+菜单 / 发现页入口；识别网页/文本/名片，演示语义） */}
      <ScanOverlayWhen flavor="wechat" />
      </ChatSkinProvider>
    </div>
  );
}
