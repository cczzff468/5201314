'use client';

/** 单聊 ChatPage（流式管线/气泡渲染/输入区/卡片交互） —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { Fragment, useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Check, CirclePlus, Forward, Mic, PictureInPicture2, Search, Smile, Star, Trash2, X, ChevronLeft } from 'lucide-react';
import { addFavorite, isMsgFavorited, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { useSettings, useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { ChatNewMsgPill, useChatAutoScroll } from '@/hooks/use-chat-autoscroll';
import { pushChatNotification, notifyPreviewText } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, markDeliverBoundary, peekPendingMsgs, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { cleanTextForTts, stopSpeaking } from '@/lib/ios/tts-client';
import { decideAiVoiceMessage, synthesizeAiVoice, getAiVoiceFreq, saveAiVoiceFreq, undoLastAiVoiceDecision } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { RecordOverlayWx, SttPreviewOverlay, VoiceHoldBar, useSttPreview, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { autoTranscribeForAi, transcribeAudioBlob } from '@/lib/ios/stt-client';
import { buildImagePlaceholderRule, buildVoicePlaceholderRule } from '@/lib/chat-media-rules';
import { splitVisionDesc } from '@/lib/vision-client';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback, VOICE_PLAY_ERROR_EVENT } from '@/lib/ios/voice-player';
import { effectiveInterop } from '@/lib/ios/groups';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, computeBubbleMenuPosLiquid, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from '../bubble-menu';
import { WxPhotoStack, WxPhotoViewer, findPhotoStackSpans, type PhotoStackItem } from '../photo-stack';
import { LocalToast, useLocalToast } from '../page-toast';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { CHAT_PARSE_FAIL_TEXT, CHAT_UNKNOWN_FAIL_TEXT, classifyChatError, cooldownRemainText, lastChatErrorDetail, recordChatFail, recordChatSuccess } from '@/lib/chat-errors';
import { CHAT_DRAFT_MAX, clearChatDraft, getChatDraft, saveChatDraft } from '@/lib/ios/chat-drafts';
import { ChatErrorLine } from '../chat-error-line';
import { MtPayBubble, MtProxyDetailPage } from '../mt-proxy-detail';
import { MT_PROXY_CARD_EVENT } from '@/lib/ios/mt-proxy-pay';
import { MT_SHARE_CARD_EVENT } from '@/lib/ios/mt-order-share';
import { MtShareBubble } from '../mt-share-card';
import { TbPayBubble, TbProxyDetailPage, TbShareBubble } from '../tb-share-cards';
import { WxGiftCardBubble, WxGiftPicker, WxGiftReceiveSheet } from '../wx-gift';
import { TB_PROXY_CARD_EVENT, TB_SHARE_CARD_EVENT, tbGetProxy, tbProxyHistoryLine, tbProxyMeHistoryLine, tbReshareProxy, stripTbEchoText } from '@/lib/ios/tb-share-proxy';
import { FORUM_SHARE_CARD_EVENT, buildForumShareCardMsg, forumShareHistoryLine, noteForumLinkSharedToChat, resolveForumLinkPost } from '@/lib/ios/forum-share';
import { ForumShareBubble } from '../forum/share-card';
import { tbShareHistoryLine } from '@/lib/ios/tb-share-proxy';
import { TbDraftBubble } from '../tb-draft-card';
import { applyTbEngageAction, buildTbEngageCtx, isTbEngageActionKind, tbCustomProductFromText, tbDraftHistoryLine, tbFallbackCardId, tbFallbackShouldFire, tbPickProductForText } from '@/lib/ios/tb-ai-engage';
import { tbMarkOrderGifted } from '@/lib/ios/taobao-store';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from '../forward-sheet';
import { beginChatStream, clearChatStream, isChatStreaming, subscribeChatStreamFinalized, useChatStream, type ChatPayloadMessage } from '@/lib/chat-stream-store';
import { promptRule } from '@/lib/prompt-entries';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
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
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
import { applyMtEngageAction, buildMtEngageCtx, isMtEngageActionKind, mtDraftHistoryLine, mtOrderShareHistoryLine, mtProxyHistoryLine, parseMtAskFromText, stripMtEchoText } from '@/lib/ios/mt-ai-engage';
import { MtDraftBubble } from '../mt-draft-card';
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
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
import { buildShizukuAutonomyRules, enqueuePhoneOp } from '@/lib/ios/shizuku-autonomy';
import { useOpPill, SkillUsePill } from '../skill-use-pill';
import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import { getMemSettings, memAfterAiTurn, memChatRecallBlock, memConvoFromRaw, memPurgeMessageSources, setMemScopeForApp } from '@/lib/memory';
import { aiWriteLetterOnRequest, coupleChatBlock, coupleLetterAskHit } from '@/lib/ios/couple-ai';
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
import { buildDynamicStateBlocks, noteMoodEvent } from '@/lib/ios/ai-mood';
import { addCharMomentPost, buildMomentsChatBlock, emitMomentsChanged, enqueuePostInteractions, markMomentAutoAttempt } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { buildForumChatBlock } from '@/lib/forum/social';
import { isPostMemoryOn } from '@/lib/forum/core';
import { useChatDisplay } from '@/lib/ios/chat-display';
import { BubbleTail } from '../bubble-tail';
import { bubbleVisual, isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
import { chatContactKey, chatCssScopeSelector, scopeCss } from '@/lib/ios/custom-css';
import { chatPlaceholder, resolveQuickKeys } from '@/lib/ios/chat-decor';
import { ChatQuickBar, type QuickBarItem } from '../chat-quick-bar';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { getChatBgImage, setChatBgImage, removeChatBgImage, ownerRealNameFor, contactRealName, updateContact, setPeerBg, setAppRelation, cachedOwnerName } from '@/lib/ios/contacts-store';
import { listAlbumsForChat, addAlbum, getAlbum, addVisionDecision } from '@/lib/ios/album-store';
import { ensureAlbumDescs } from '@/lib/ios/album-vision';
import { buildAvatarBlock, ensureAvatarDesc, noteAvatarChanged } from '@/lib/ios/avatar-ai';
import { buildPhotoDescHistory, buildPhotoTagRule, downloadImageSrc, extractPhotoTags, generateCharacterPhoto, imgGenConfigReady, notePhotoMemory, splitUnfinishedPhotoTag, stripUnfinishedPhotoTag, type PhotoTag } from '@/lib/imggen';
import { autoCardText } from '@/lib/textcard';
import { TextCardActionSheet, TextCardBubble } from '@/components/apps/text-card-bubble';
import { ImageRegenSheet } from '@/components/apps/image-regen-sheet';
import type { AlbumRecord } from '@/lib/ios/db';
import OfflineMeetingPage from '@/components/apps/offline-meeting';
import type { OfflineOnlineMsg } from '@/lib/offline-meet';
import { addressNameOf, avatarFor, displayNameOf, isFriendIn, withDisplayNames, relationForAccount, remarkForApp } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import PeerStatusCard from '@/components/apps/peer-status-card';
import CoupleRelBubble from '@/components/apps/couple-rel-bubble';
import CouplePactBubble from '@/components/apps/couple-pact-bubble';
import CoupleExamBubble from '@/components/apps/couple-exam-bubble';
import CoupleLetterBubble from '@/components/apps/couple-letter-bubble';
import { COUPLE_CARD_EVENT, decideCoupleCard as decideCoupleCardAction } from '@/lib/ios/couple-invite';
import { AI_PRODUCT_IMG_EVENT } from '@/lib/ios/ai-product-img';
import { DEFAULT_STICKER_GROUP_ID, loadStickers, newStickerId, saveStickers } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { openChatFloat } from '@/lib/ios/chat-float-store';
import { consumeBgPending, onBgPageVisible, pullBgPending, registerBgSession, unregisterBgSession, type BgPendingItem } from '@/lib/ios/bg-turn';
import { useChatFlags, NO_FLAGS, wxChatFlags as wxChatFlagsStore } from '@/lib/chat-flags';
import { ChatBgPage, ChatReplyCountPage, ChatSearchPage, ChatSettingsPage, ChatTranslatePage, ChatVoiceFreqPage, ChatVoicePage, WorldBookPickerPage, chatBgLayerStyle, type ChatSearchItem, type ChatSettingsBg } from '../chat-settings';
import { ProactiveMsgPage } from '../proactive-msg-page';
import { PerceptionSettingsPage } from '../perception-settings';
import { proactiveCfgSummary, parseReminderInstruction, reminderHintHit, reminderSysHint, buildReminderSysMsg, setActiveProactiveChat } from '@/lib/ios/proactive-msg';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { buildBranchPromptBlock } from '@/lib/ios/branch';
import { BranchDialog } from '../branch-dialog';
import { fmtMoney, loadFamilyCards, loadFamilyCardsIn, saveFamilyCards, saveFamilyCardsIn, wxLoadPayPwd, WxPayPwdGate, recordFcSpend } from '../wechat-wallet';
import { CallCardBubble, callResultToCardState, callCardAiText } from '../voice-call-screen';
import { hasVideoCallMark, hasVoiceCallMark, stripVideoCallMark, stripVoiceCallMark, type ChatCallResult, type ChatCallTurnMsg } from '@/lib/ios/chat-call';
import { startGlobalCall, useGlobalCall } from '@/lib/ios/global-call';
import { triggerIncomingCall, useIncomingCall } from '@/lib/ios/incoming-call';
import { buildLocationBlock, locationAiText } from '@/lib/ios/chat-location';

import { FamilyBubble, ImageMsgBubble, LocBubble, LocViewLayer, LocationPickerPage, PlusAction, PlusPanel, RedPacketCompose, RpBubble, RpDetailPage, RpOpenLayer, TrBubble, TrDetailPage, TransferCompose, WX_QUICK_META, WxBlockReqCard, WxFcClaimPage, WxFcManagePage, WxGroupCardBubble, WxNoticeRow, WxTextCardSheet, WxTrReceivePage } from './cards';
import { WxCardActorNames, WxMsg, WxUser, buildPersonaPrompt, copyTextWithToast, drainAiEvents, fmtChatTime, loadMsgs, nextWxCid, pushAiEvent, readImageFile, readWxClapText, richToWxMsg, saveMsgs, uid, wxActiveInstances, wxApplyAiActions, wxCanPay, wxCardStateLabel, wxCollectPendingCards, wxExecutePayment, wxExpireStalePeerCards, wxPatHistoryLine, wxPatchBalance, wxQueueAdd, wxQueueDelete, wxQueuedTurns, wxSessionMsgs, wxUnreads } from './core';
import { StickerMsgBubble, WxStickerPanel } from './stickers';
import { EllipsisGlyph, KeyboardGlyph, VoiceWaveGlyph, WxAvatar, WxMetaUnderAvatar, WxMetaUnderBubble, WxQuoteBlock, markPeerRead } from './widgets';

/** 当前正在查看的微信聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 
 * （v1.9.27 任务10 拆分：全部读写都在 ChatPage 内，声明随迁至此） */
let wxActiveChatId: string | null = null;

/**
 * 一轮 AI 回复的投递上下文（runAiTurn 与「退出网页后继续回复」的拉取投递共用）：
 * aiId/msgIdx 生成回复消息 id 序列；batchStarted 控制首批立即上屏（后续批按打字节奏停顿）；
 * wantCallSeen 记录 [语音通话] 标记是否出现过（finalize/拉取投递收尾时触起来电）；
 * wantVideoCallSeen 记录 [视频通话] 标记是否出现过，与 wantCallSeen 同口径（收尾时触发视频来电） */
export interface WxTurnCtx {
  aiId: string;
  msgIdx: number;
  batchStarted: boolean;
  wantCallSeen: boolean;
  /** [视频通话] 标记是否出现过，与 wantCallSeen 同口径（Task 22 视频通话） */
  wantVideoCallSeen: boolean;
  /** 一起听遥控（第三十七轮）：本轮回复里剥出并执行过播控指令（纯指令回复不再落「暂无回复」兑底） */
  musicActed: boolean;
  /** v1.3 Shizuku 自主权：本轮执行过 [手机操作:…]（纯动作回复不落空回复失败徽标，与 musicActed 同口径） */
  phoneActed?: boolean;
  /** Task 30 AI 引用（v56 恢复）：[引用:M编号] 标记剥出后暂存的编号——挂到紧随其后的第一条正文消息上；
 *  标记与正文跨流式分段时靠它跨段接力（buildReplyMsgs 各次调用共享同一 ctx） */
  pendingQuote?: string;
  /** Task 30 AI 引用（v56 恢复）：本轮上下文窗口内的消息编号 → 源消息映射（runAiTurn 构建注入）；
 *  后台接力投递（deliverBgItems）自建 ctx 无映射 → [引用:…] 标记静默丢弃，正文照常 */
  quoteMap?: Map<string, WxMsg>;
  /** v56 引用冷却：本轮是否已成功挂载过引用块（一轮连发最多一条带引用，挂过即丢弃后续引用标记） */
  turnQuoted?: boolean;
}

/** v56 引用冷却窗口：距上次成功挂载引用不足该时长的轮次一律丢弃引用标记——用户要「学会引用」
 *  而非「一直引用」，措辞约束之外由代码层兜底，永远不会回到 v53 那种每轮必挂的状态 */
export const AI_QUOTE_COOL_MS = 5 * 60_000;

/** v71 分窗渲染：聊天页初始只渲染最近 WINDOW_FIRST 条消息，上滑到顶按 WINDOW_STEP 向前扩——
 *  长会话几千条一次性 map 渲染是「点进聊天界面卡顿」的主因，分窗后首屏只建百级 DOM；
 *  扩窗配合 topAnchorRef 锚定（视口停在原消息上，iOS 原生同款体验），时间分隔/照片堆叠
 *  等按消息原始索引计算的逻辑全部带原索引渲染，行为与全量渲染完全一致 */
export const WINDOW_FIRST = 120;
export const WINDOW_STEP = 160;

export function ChatPage({
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
  float,
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
  /** v73 聊天小窗变体：渲染在悬浮小窗内（窄容器）——隐藏自带顶栏（外框标题条代替）、
   *  多选模式仍渲染紧凑工具栏；发送/投递/流式管线与全屏完全同一套 */
  float?: boolean;
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
  // v73 聊天小窗：msgs 升级为「会话共享源镜像」——同会话双开（全屏 + 小窗）时实时互通。
  // 初始化 = 磁盘 ∥ 共享源合并（见 wxSessionMsgs.init）；setMsgs 保持旧签名（值/函数式），
  // 函数式改读共享源计算（任一侧的写入都立即对两侧生效），订阅把 commit 广播回本实例 state
  const [msgs, setMsgsState] = useState<WxMsg[]>(() => wxSessionMsgs.init(peer.id));
  // v1.3 Shizuku：AI 使用技能时聊天界面正中的椭圆形胶囊浮层（start/finish 稳定引用，异步闭包里安全调用）
  const opPill = useOpPill();
  const setMsgs = useCallback(
    (next: WxMsg[] | ((prev: WxMsg[]) => WxMsg[])) => {
      wxSessionMsgs.commit(peer.id, next);
    },
    [peer.id],
  );
  useEffect(() => wxSessionMsgs.subscribe(peer.id, setMsgsState), [peer.id]);
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
  // 长会话几千条消息一次性 map 是点进聊天卡顿的主因；分窗后首屏只建百级 DOM，
  // 上翻历史时按 WINDOW_STEP 步进补更早的（配合下方锚定 effect 保持视口不跳）。
  const [visibleCount, setVisibleCount] = useState(WINDOW_FIRST);
  const winStart = Math.max(0, msgs.length - visibleCount);
  /** 向前扩窗时记录「加载前内容底缘到视口顶的距离」，渲染提交后把 scrollTop 顶回，
   *  用户视口停留在原来的消息上（iOS 原生上翻加载同款体验） */
  const topAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (topAnchorRef.current != null && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = Math.max(0, el.scrollHeight - topAnchorRef.current);
      topAnchorRef.current = null;
    }
  });
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
    // v73 引用计数：同会话可能双开（全屏 + 小窗）——最后一个实例卸载才清 active 标记
    const cid = peer.id;
    const n = (wxActiveInstances.get(cid) ?? 0) + 1;
    wxActiveInstances.set(cid, n);
    if (n === 1) {
      wxActiveChatId = cid;
      // 主动发消息角标守卫同步登记：用户正看着该会话时主动消息不涨角标（消息实时可见）
      setActiveProactiveChat('wx', cid);
    }
    return () => {
      const left = (wxActiveInstances.get(cid) ?? 1) - 1;
      if (left <= 0) {
        wxActiveInstances.delete(cid);
        if (wxActiveChatId === cid) wxActiveChatId = null;
        setActiveProactiveChat('wx', null);
      } else {
        wxActiveInstances.set(cid, left);
      }
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

  /** 气泡下方译文（翻译开启时按消息语言显示对侧语言的译文）——第八十九轮（用户指定截图样式）：
   *  独立白色圆角气泡挂在原气泡正下方（微信原生翻译气泡同款），译文与正文同字号，
   *  气泡底部一行灰色小字「由微信提供翻译支持」；不再显示语言名前缀 */
  const renderTranslations = (msgId: string, content: string) => {
    if (!transCfg.on) return null;
    if (!content.trim() || content.startsWith('〔') || content.startsWith('（AI') || content.startsWith('（对方暂时')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <div
        data-testid="wx-translate-row"
        data-wx-tr-bubble=""
        className="mt-[6px] w-fit max-w-full select-none rounded-[5px] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:bg-[#1E1E1E] dark:shadow-none"
      >
        <p className="whitespace-pre-wrap break-words text-[16px] leading-[1.45] text-black dark:text-white">{text}</p>
        <p className="mt-[3px] text-[11px] leading-[1.35] text-black/35 dark:text-white/35">✓ 由微信提供翻译支持</p>
      </div>
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

  /** 逐条投递进行中（含排队批次）：标题维持「正在输入中…」，直到最后一条消息发出 */
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
  // Task 30 AI 引用（v56 恢复）：上次成功挂载引用块的时刻（跨回合冷却闸，与 AI_QUOTE_COOL_MS 配合——
  // 一轮最多一条 + 5 分钟内不重复，代码层保证「偶尔引用」而非「一直引用」）
  const quoteLastAtRef = useRef(0);

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
        // Task 30 AI 引用（[引用:M编号]，v56 恢复）：编号暂存 ctx，挂到紧随其后的第一条正文消息上
        //（见下方文字分支；标记与正文跨流式分段/切分边界时靠 ctx 跨段接力）。
        // v56 冷却闸：本轮已挂过引用、或距上次挂载不足 AI_QUOTE_COOL_MS → 静默丢弃（正文照常）
        if (part.action.kind === 'quote') {
          if (!ctx.turnQuoted && Date.now() - quoteLastAtRef.current >= AI_QUOTE_COOL_MS) {
            ctx.pendingQuote = part.action.targetId.trim();
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
        // 执行是异步的（Shizuku 通道 1~3s）：结果不占正文，完成后以系统行落盘——下一轮 AI 天然看到
        // （成功才说成功、失败如实报）。开关 gate 在 executePhoneOp 内（系统设置 → AI 动手，关了直接拒）；
        // 拉黑（仅申请卡模式）下与资金/视觉标记同口径拦截——拉黑期间 AI 不许动手机。
        if (part.action.kind === 'phone-op') {
          const argText = part.action.targetId.trim();
          if (argText && !loadBlock('wx', peer.id).byUser) {
            ctx.phoneActed = true; // 纯动作回复（无正文）不落空回复失败徽标
            const cmdName = argText.split(/[:：]/)[0] ?? '';
            out.push({ id: uid(), role: 'peer', content: '', time: t, kind: 'sys', sys: { text: `「${peer.name}」正在操作手机（${cmdName}）…` } });
            t += 1;
            void (async () => {
              // 串行队列：多步指令（打开→播放→切歌）按书写顺序逐个执行，轮到本条才亮技能胶囊
              const res = await enqueuePhoneOp(argText, () => opPill.start(peer.name, cmdName));
              opPill.finish(res.ok, res.text);
              const sysMsg: WxMsg = {
                id: uid(),
                role: 'peer',
                content: '',
                time: Date.now(),
                kind: 'sys',
                sys: { text: `手机操作${res.ok ? '成功' : '失败'}：${res.text}`, op: true },
              };
              saveMsgs(peer.id, appendWithBoundary(sessionKey, loadMsgs(peer.id), sysMsg));
              setMsgs((prev) => (prev.some((m) => m.id === sysMsg.id) ? prev : [...prev, sysMsg]));
            })();
          }
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
            // Task 30 AI 引用（v56 恢复）：此前剥出过 [引用:M编号] → 挂到这第一条正文消息上（引用块随气泡展示）；
            // 编号查不到时分两档：①跨回合编号漂移/后台接力无映射（旧容忍）→ 静默丢弃；
            // ②编号越界（模型把 [M(N)] 当成「给自己新消息编号」在写，N=最后一条+1）→ 引用意图是真的
            //（它正在回应对方刚发来的话），回退引用本轮触发回复的那条用户消息，不让引用凭空消失。
            // 冷却闸在标记剥出处已拦（本处能走到 = 冷却已过）；挂载成功后 turnQuoted 置位 + 记录时刻
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
                ctx.turnQuoted = true;
                quoteLastAtRef.current = Date.now();
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
    // Task 30（v56 恢复）：接力回复同样带消息编号映射——落盘记录按绝对位置重算（与生成侧同口径），
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
    // Task 30 AI 引用编号（v56 恢复）：会话内每条消息的绝对位置编号（M1..Mn；撤回/错误/通知行/申请卡不占号）——
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
          (!m.recalled && ((m.content || m.kind === 'sticker' || m.kind === 'image' || m.kind === 'textcard' || m.kind === 'voice' || m.kind === 'call' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'groupcard' || m.kind === 'relcard' || m.kind === 'pactcard' || m.kind === 'examcard' || m.kind === 'lettercard' || m.kind === 'giftcard' || m.kind === 'location' || m.kind === 'song' || (m.kind === 'sys' && (m.sys?.pat || m.sys?.op))) && !m.content.startsWith('〔') && !m.content.startsWith('（AI'))) as boolean
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
        // v75：携带源消息 ID——noteEngagement 靠它区分「用户真实新回复」与「旧消息重放/系统事件合成注入」，
        // 防止系统触发回合把旧消息当成用户刚回复（焦虑引擎 lastUserAt 被污染 → AI 幻觉「你终于回我了」）
        id: m.id,
        // 行首 [M数字] = 消息编号（v56 恢复：AI 用 [引用:编号] 引用它，教学见 chat-rich.ts）；我的表情以 [发送了表情：意思] 进入历史（AI 理解含义）；
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
                                  // v1.3 Shizuku：手机操作结果行（sys.op）回给 AI——下一轮它知道自己刚才干了什么、成没成。
                                  // 圆括号+显式“勿复述”指引：防 AI 把反馈原文抄给机主（曾出现复述「手机操作成功：已拉起…」）
                                  : m.kind === 'sys' && m.sys?.op
                                    ? `（内部反馈：你刚才的手机操作结果——${m.sys.text}。这是只给你看的，用你自己的话告诉机主结果即可，严禁复述本行）`
                                    : m.content),
        };
      });

    // 本轮投递上下文（投递管线与接力拉取共用，见组件层 deliverAiMsg/enqueueBatch/buildReplyMsgs）。
    // v56 恢复：带上 quoteMap（本轮历史窗口的编号映射——[引用:M编号] 反查挂引用块用）
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
    // 感知设置（第七十四轮）：打字耗时/电量/天气/日历 + ActivityWatch 真机感知 + VLM 看屏 ——
    // 预热缓存+现场读取范式（runAiTurn 是同步函数不能 await）：本轮同步读缓存构建块，
    // 同时 fire-and-forget 刷新供下一轮；聊天页挂载时已预热（见感知预热 effect）
    const perceptionBlock = buildPerceptionBlock(sessionKey, {
      lastMsgTime: priorMsgs.length > 0 ? priorMsgs[priorMsgs.length - 1].time : null,
    });
    void prewarmPerception(sessionKey);
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
      perceptionBlock,
      // v1.3 Shizuku 自主权：[手机操作:…] 教学规则按当前开关注入（总开关关/非手机APP环境 → 空，零 token）
      ...buildShizukuAutonomyRules(),
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
        // 感知设置：AI 回复落地时刻 = 用户下一轮「思考+打字」计时的基线（打字感知开关用）
        markAiReplyEnd(sessionKey);
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
            : deliveredAny || ctx.musicActed || ctx.phoneActed
              ? []
              : requestOnly
                ? []
                : (setReplyFail(true, CHAT_PARSE_FAIL_TEXT), recordChatFail(sessionKey, '空回复'), []);
        // 有任何产出（分段投递/动作/本轮落盘消息）：清除触发消息上的失败徽标（重试成功场景）；
        // Task 40：本轮有产出 = 成功 → 连续失败冷却计数清零（空回复失败分支不进这里，刚记的失败不会被误清）
        if (built.length > 0 || deliveredAny || ctx.musicActed || ctx.phoneActed) {
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

  /** 搜索结果定位：关闭搜索页与设置页 → 滚动到消息并短暂高亮。
   *  v71 分窗渲染兜底：目标消息若在未渲染的更早窗口里，先扩窗覆盖它再定位（双 rAF 等扩窗渲染提交） */
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
      {/* v1.3 Shizuku：AI 使用技能 → 聊天界面正中的椭圆形胶囊浮层（pointer-events-none 不挡交互） */}
      <SkillUsePill pill={opPill.pill} />
      {/* 自定义 CSS（聊天作用域，按联系人隔离）：只影响本联系人的聊天页；前缀
          [data-phone-shell] [data-chat-css="wx:联系人ID"] 比全局多一级属性 → 特异性压制全局 */}
      {chatCustomCss?.trim() ? <style>{scopeCss(chatCustomCss, chatCssScopeSelector(wxCssKey))}</style> : null}
      {/* 聊天背景层（聊天设置页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 第四十七轮（用户指定「顶部会逐渐模糊」）：液态主题顶部渐变磨砂带——
          消息滚入顶栏下方被渐进模糊（顶缘全模糊 → 96px 处透明；不拦截交互，顶栏铭件浮于其上） */}
      {liquid && !float && <div aria-hidden="true" data-testid="wx-chat-top-blur" className="lg-top-blur pointer-events-none absolute inset-x-0 top-0 z-[15] h-[96px]" />}
      {/* 顶栏：与消息区/底部输入栏同色（微信灰，非白）；多选模式下变为「取消 + 已选计数」操作栏
          第三十四轮：pt-54→pt-48（顶部再往上移一点，仍避开 54px 状态栏内容区不重叠）
          第三十六轮：pt-48→pt-42（再上移 6px，灵动岛/状态栏下方留白更紧凑；群聊会话页同步）
          v73 小窗变体：常规顶栏隐藏（小窗外框标题条代替：拖拽把手 + 关闭/最小化/最大化），
          仅多选模式渲染紧凑工具栏（pt-0——小窗内没有状态栏让位） */}
      {float && !selectMode ? null : (
      <div
        className={
          float
            ? 'wx-topbar relative z-10 shrink-0 bg-[#EDEDED] pt-0 dark:bg-[#111111]'
            : 'wx-topbar ' +
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
        <div className="relative flex h-11 items-center px-2 [&_button]:pointer-events-auto">
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
          {/* 名字区（用户指定：「名字在屏幕中间，不是按钮中间」）：绝对定位 left-1/2 平移居中（同 IOSNavBar/QQ 同款），
              右侧两个按钮较宽不再把名字挤偏；w-max 收缩到内容宽 + max-w 限长截断，绝不与两侧按钮重叠 */}
          <div className="absolute left-1/2 top-1/2 flex w-max max-w-[calc(100%-150px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center" data-testid="wx-chat-peer-name">
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
          {/* 占位：名字区改绝对定位后不再占 flex 空间，用弹性占位把右侧按钮推到最右 */}
          <div className="min-w-0 flex-1" aria-hidden="true" />
          {/* v73 小窗模式：当前聊天缩小为全局悬浮小窗（切 App 不断、与全屏实时互通）——
              点击即开小窗并退出全屏聊天（返回会话列表）；小窗顶栏不再显示本按钮 */}
          {!float && (
            <button
              type="button"
              aria-label="小窗模式"
              title="小窗模式"
              data-testid="wx-chat-float-btn"
              onClick={() => {
                openChatFloat(peer.id);
                onBack();
              }}
              className={
                liquid
                  ? 'lg-chip flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full active:opacity-60'
                  : 'px-2 active:opacity-50'
              }
            >
              <PictureInPicture2 className={liquid ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'} strokeWidth={2} />
            </button>
          )}
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
      )}

      {/* 消息列表：浅灰背景（同微信），自定义聊天背景时透出背景层。
          wx-chat-list：消息区锚点（聊天设置 › 自定义CSS 示例主题可改内边距/字体）。
          v71 分窗渲染：onScroll 里滚到顶部 140px 内且前面还有未渲染的更早消息 → 记锚扩窗 */}
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
        className={`wx-chat-list no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-3 ${liquid ? 'pb-3 pt-[96px]' : 'py-3'}`}
      >
        {msgs.length === 0 && (
          <p className="mt-16 text-center text-[13px] text-black/35 dark:text-white/35">
            {selfChat ? '给自己发条消息吧' : `和 ${peer.name} 打个招呼吧`}
          </p>
        )}
        {msgs.slice(winStart).map((m, wi) => {
          // 原始全量索引（时间分隔 msgs[i-1] / 照片堆叠 stackMemberIdx / 七彩序号等
          // 都按全量索引计算，分窗渲染也带原索引 → 行为与全量渲染完全一致）
          const i = winStart + wi;
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
        {/* v1.9.12 「有新消息 ⬇️」轻提示：机主上翻看历史时 AI 来新消息不拽回底部，浮出胶囊点击才回底部 */}
        <ChatNewMsgPill show={showNewMsg} onClick={scrollToBottom} />
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
            第四十七轮（用户指定）：液态底距 pb-2→pb-[13px]——输入框整体再往上提一点
            第八十九轮（用户指定）：默认主题右内边距 pr-2.5→pr-2，表情/加号更贴右缘 */}
        <div className={liquid ? 'px-2.5 pb-[13px] pt-1' : 'pl-2.5 pr-2 pb-[18px] pt-1'}>
          {/* 输入框上方快捷功能条（输入框自定义 › 输入框上方功能）：把加号面板里的功能放到输入框上面；
              点一下与点面板里那一项等效；未添加 = 不显示；「+」面板本身不受影响 */}
          {quickItems.length > 0 && (
            <div className="mb-1.5">
              <ChatQuickBar items={quickItems} liquid={liquid} retro={retro} testPrefix="wx" />
            </div>
          )}
          {/* 液态输入栏（第四十四轮，用户指定）：删除大椭圆包裹——语音钮 = 玻璃圆圈内嵌黑圈、
              输入框毛玻璃椭圆、表情+加号共用一个玻璃椭圆；默认主题原样
              第八十九轮（用户指定）：默认主题 gap-2→gap-1.5（图标与输入框更紧凑） */}
          <div className={liquid ? 'flex items-center gap-2' : 'flex items-center gap-1.5'}>
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
                    // 感知设置（打字思考感知）：首次键入记起点，发送时算「纯打字」时长
                    markTypingStart(sessionKey);
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
                  placeholderClass={`absolute inset-0 flex items-center pl-3.5 text-[16px] text-black/30 dark:text-white/30 ${input.trim() ? 'pr-4' : 'pr-11'}`}
                  testId="wx-chat-input"
                  className={`block max-h-[132px] w-full overflow-y-auto py-[8px] pl-3.5 text-[16px] leading-[22px] caret-[#07C160] outline-none transition-all duration-200 selection:bg-[#07C160]/20 ${
                    input.trim() ? 'pr-4' : 'pr-11'
                  } ${
                    liquid
                      ? /* 液态：毛玻璃椭圆输入胶囊（比背景稍深一档 + 内阴影下陷感） */ 'lg-input min-h-[36px] rounded-full shadow-[inset_0_1px_3px_rgba(31,38,135,0.10)]'
                      : retro
                      ? /* 古早（第五十四轮）：白底内凹硬边输入框 */ 'rt-input min-h-[34px] rounded-[4px] text-black'
                      : /* 第八十九轮（用户指定美化）：软圆角 + 加高一档 + 单层柔影，更接近真机微信的干净观感 */ 'min-h-[36px] rounded-[8px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#232323] dark:shadow-none'
                  }`}
                />
                {/* 文字转语音开关（第三十二轮：输入框内右侧灰麦克风；开启后输入文字发送为语音气泡）；
                    第八十九轮（用户指定，真机微信同款）：输入框有文字时麦克风图标隐藏（语音输入入口只在空框时出现），
                    切到「按住说话」模式时随输入框一起隐藏 */}
                {!input.trim() && (
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
                )}
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
              /* 第八十九轮（用户指定）：表情钮窄体化（40→34px），图标与加号挨得更近更贴右缘 */
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
                className="flex h-10 w-[34px] shrink-0 items-center justify-center active:opacity-60"
              >
                <Smile className="h-[24px] w-[24px]" strokeWidth={2} />
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
                    : /* 第八十九轮：软圆角与输入框同步 */ 'flex h-[34px] shrink-0 items-center justify-center rounded-[6px] bg-[#07C160] px-4 text-[14px] font-medium text-white active:bg-[#06AD56] disabled:opacity-50'
                }
              >
                发送
              </button>
            ) : !liquid ? (
              /* 第八十九轮（用户指定）：加号钮窄体化 + 负边距收紧与表情的间距（图标间距 17.5→约 7px） */
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
                className="-ml-2 flex h-10 w-[34px] shrink-0 items-center justify-center active:opacity-60"
              >
                <CirclePlus
                  className={`h-[27px] w-[27px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`}
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
          onOpenPerception={selfChat ? undefined : () => setPerceptionOpen(true)}
          perceptionSummary={perceptionSummary(sessionKey)}
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

      {/* 感知设置页（聊天设置二级页）：打字/电量/天气/日历/ActivityWatch 真机感知/看屏（按会话独立） */}
      {perceptionOpen && (
        <PerceptionSettingsPage variant="wx" sessionKey={sessionKey} peerName={peer.name} onBack={() => setPerceptionOpen(false)} />
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
