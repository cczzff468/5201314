'use client';

/**
 * QQ App：
 * - 登录（对照真实 QQ 登录页）：① 账号密码登录（QQ号/QID/邮箱 + QQ密码）② 手机号登录（+86 手机号 + QQ密码，
 *   实际校验密码仍用联系人 qqPassword 字段）；账号数据来自「联系人 App」本地 IndexedDB
 * - 仅 kind='user' 的联系人可登录；char / npc 账号一律拦截（「该账号类型暂不支持登录」），
 *   未注册账号 / 密码错误分别给出提示
 * - 登录后：消息 / 联系人 / 动态 三个 tab（对照 QQ 新版首页）
 *   ① 消息：会话列表（已加好友的联系人）+ AI 聊天（蓝/白气泡，流式回复）
 *   ② 联系人：新朋友 / 群通知 + 分组(特别关心/我的好友折叠) / 好友 / 群聊… 多 tab；右上人+ 进添加好友页（找人/找群 + 推荐）
 *   ③ 动态：空间动态（QQ空间信息流，可发帖/点赞）/ 游戏中心 / 小游戏 / QQ经典农场 / 结伴与附近 / 小说与动漫 / 意见反馈
 * - 左上头像 → 个人中心抽屉（顶部封面图与资料页同一张背景图，深色玻璃打卡/状态 pills 叠加封面；
 *   切换账号/个签/相册收藏…/设置入口；点击封面空白处关闭）
 *   抽屉头像 → 个人资料页（QQ号/可编辑个签/徽章/资料完成度/QQ空间/发消息；背景图可上传（IndexedDB 永久保存））
 *   抽屉「钱包」→ QQ钱包（对照真机：主页四宫格余额/Q币/领福利/微粒贷 + 金融理财/游戏娱乐/生活服务宫格；
 *   余额页（可用余额/转到微信/微信转入 + 充值/提现/银行卡 + 账单 + 支付设置）/小金库（金色渐变，转入转出联动余额；
 *   收益每日按七日年化 1.5120% 结算：累计收益/昨日收益/收益详情页[万份收益/近7日柱状图/每日收益记录]）/
 *   支付设置（支付密码开启/关闭/修改，微信风格 6 位自绘数字键盘；开启后红包/转账/充值/提现/小金库变动均先弹键盘验证）/
 *   我的银行卡（品牌渐变卡列表[芯片/闪付波纹/卡号分组] + 添加银行卡：持卡人预填 QQ 昵称、卡号一键生成
 *   [Luhn 校验、BIN 跟随银行]、金额自定义、卡类型/银行选择，仅存本机；点击卡片进银行卡详情：
 *   卡内余额/持卡人/卡号复制/银行/类型/添加时间）/提现（余额→可选到账银行卡）/充值（可选付款银行卡→余额，卡内余额校验）/账单流水；localStorage 持久化）
 *   设置 → 账号与安全（账号管理切换账号/账号关联/安全管理）；设置底部「退出当前账号」回登录页
 * - 聊天页对照 QQ 真机美化（名字+在线、蓝白圆气泡带头像、
 *   底部六图标工具栏：图片=相册选图、拍摄=input capture 直调手机原生相机（对齐微信，无自建取景）——
 *   选图先压缩进输入框下方待发预览条（最多 9 张可移除），点「发送」才真正发出并触发 AI 回复（发图先预览）；
 *   加号 → 底部弹出面板（语音通话/视频通话/红包/转账/位置），输入行跟随上浮；
 *   位置 → 发送位置页（内置常用地点 + 自定义位置表单，发送后聊天内出现位置卡片气泡）；
 *   红包 → 发红包页（普通/拼手气/专属 tab、祝福语、支付方式[余额/银行卡]、塞钱进红包）→ 聊天内红色 QQ红包卡片
 *   （企鹅+祝福语+開）→ 点击进红包详情（全屏沉浸红头直达状态栏+金色金额+手气最佳+领取列表）；
 *   转账 → 向好友转账页（头像/QQ号/金额/留言 0/12/支付方式）→ 蓝色转账卡片（已转入好友余额）→ 点击进交易详情
 *   （蓝圈对勾/金额/留言/时间）；开启支付密码后红包/转账/充值/提现/小金库变动先弹自绘数字键盘验证；
 *   红包/转账/位置消息随会话 localStorage 持久化，会话列表预览显示 [QQ红包]/[转账]/[图片]/[位置]）；
 *   页面任意位置水平左滑 → 好友标识页（成为好友N天/密友值/双头像心跳线/去绑定专属关系/我们的DNA：聊天小结/共同属性/友谊时间线三弹窗/幸运字符）；
 *   成为好友天数与密友值从 0 开始，按 QQ 规则增长：互发一条消息密友值 +2（每日上限 20），天数每日 +1
 * - 联系人点击 → 好友个人资料页（头像/QQ号/点赞/徽章/互动标识/他的QQ空间 + 音视频通话/送礼物/发消息）
 * - 添加好友页（找人/找群 + 七宫格 + 可能想认识的人）与「新朋友」页（同步通讯录/好友通知/可能想认识的人）
 *   为两个独立页面；搜索仅按 QQ 号匹配出联系人
 * - 空间动态全屏（顶部渐变区随页面滚动）；写说说页支持文字 + 照片（压缩后）发表
 * - 会话、空间帖子、评论、密友值、登录态 localStorage 持久化
 */

import { Fragment, useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AudioLines,
  Banknote,
  Bell,
  BellOff,
  BellRing,
  BookOpen,
  Bus,
  CalendarDays,
  Camera,
  Cat,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUser,
  ClipboardList,
  Clock,
  Compass,
  CloudSun,
  CornerRightDown,
  CreditCard,
  Delete,
  Eye,
  EyeOff,
  Feather,
  FileText,
  Fingerprint,
  Flame,
  Flower2,
  Folder,
  Forward,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Headphones,
  Image as ImageIcon,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  LayoutGrid,
  Link2,
  Loader2,
  LockKeyhole,
  LogOut,
  MailOpen,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MonitorSmartphone,
  Moon,
  MoreHorizontal,
  Download,
  Phone,
  PiggyBank,
  Pin,
  PinOff,
  Package,
  Plus,
  FolderOutput,
  Hash,
  JapaneseYen,
  QrCode,
  Radio,
  ScanLine,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Smartphone,
  Smile,
  SmilePlus,
  Sparkles,
  Sprout,
  SquarePen,
  Star,
  Tag,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Undo2,
  User,
  UserPlus,
  Users,
  Video,
  Volume2,
  Wallet,
  X,
} from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
import { ScanOverlayWhen, openScan } from './mt-scan';
import { pushChatNotification, notifyPreviewText, takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { playNotifySound } from '@/lib/ios/notify-sound';
import { appendWithBoundary, markDeliverBoundary, peekPendingMsgs, purgeDeliveryQueueByPrefix, sortMsgsByTime, scheduleAiDelivery, subscribeAiDelivery, subscribeAiDeliveryActive, isAiDelivering, typingDelayOf } from '@/lib/ios/ai-delivery';
import { consumeBgPending, onBgPageVisible, peekBgBadgeCounts, pullBgPending, registerBgSession, unregisterBgSession, type BgPendingItem } from '@/lib/ios/bg-turn';
import { cleanTextForTts, stopSpeaking } from '@/lib/ios/tts-client';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { CallCardBubble, callResultToCardState, callCardAiText, type CallCardState } from './voice-call-screen';
import { hasVoiceCallMark, stripVoiceCallMark, hasVideoCallMark, stripVideoCallMark, type ChatCallResult, type ChatCallTurnMsg } from '@/lib/ios/chat-call';
import { startGlobalCall, useGlobalCall } from '@/lib/ios/global-call';
import { triggerIncomingCall, useIncomingCall, type IncomingCallSnapshot } from '@/lib/ios/incoming-call';
import { buildLocationBlock, locationAiText, locDataOf, locFromRich } from '@/lib/ios/chat-location';
import { MtPayBubble, MtProxyDetailPage } from './mt-proxy-detail';
import { MT_PROXY_CARD_EVENT } from '@/lib/ios/mt-proxy-pay';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
import { applyMtEngageAction, buildMtEngageCtx, isMtEngageActionKind, mtDraftHistoryLine, mtOrderShareHistoryLine, mtProxyHistoryLine, stripMtEchoText } from '@/lib/ios/mt-ai-engage';
import { MtDraftBubble } from './mt-draft-card';
import { MT_SHARE_CARD_EVENT } from '@/lib/ios/mt-order-share';
import { MtShareBubble } from './mt-share-card';
import { TbPayBubble, TbProxyDetailPage, TbShareBubble, TbExpressPicker } from './tb-share-cards';
import { tbCreateOrderShare, tbGetProxy, tbProxyHistoryLine, tbProxyMeHistoryLine, tbReshareProxy, tbShareHistoryLine, stripTbEchoText, TB_PROXY_CARD_EVENT, TB_SHARE_CARD_EVENT } from '@/lib/ios/tb-share-proxy';
import { FORUM_SHARE_CARD_EVENT, buildForumShareCardMsg, forumShareHistoryLine, noteForumLinkSharedToChat, resolveForumLinkPost } from '@/lib/ios/forum-share';
import { ForumShareBubble } from './forum/share-card';
import CoupleRelBubble from '@/components/apps/couple-rel-bubble';
import CouplePactBubble from '@/components/apps/couple-pact-bubble';
import CoupleExamBubble from '@/components/apps/couple-exam-bubble';
import CoupleLetterBubble from '@/components/apps/couple-letter-bubble';
import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import {
  COUPLE_CARD_EVENT,
  COUPLE_STATE_EVENT,
  decideCoupleCard as decideCoupleCardAction,
  readInviteMeta,
  sendMyInvite,
  type CoupleRelCardData,
} from '@/lib/ios/couple-invite';
import { TbDraftBubble } from './tb-draft-card';
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
import { ChatErrorLine } from './chat-error-line';
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
import { promptGroupParts, promptRule, promptTextOf } from '@/lib/prompt-entries';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import OfflineMeetingPage from '@/components/apps/offline-meeting';
import type { OfflineOnlineMsg } from '@/lib/offline-meet';
import PeerStatusCard from '@/components/apps/peer-status-card';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplySegments } from '@/lib/reply-count';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getMemSettings, memAddEventFragment, memAfterAiTurn, memChatRecallBlock, memConvoFromRaw, memPurgeMessageSources, memResetConvoCounters, setMemScopeForApp } from '@/lib/memory';
import { aiWriteLetterOnRequest, coupleChatBlock, coupleLetterAskHit } from '@/lib/ios/couple-ai';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { buildDynamicStateBlocks } from '@/lib/ios/ai-mood';
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
  listMomentNotices,
  // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts,
  markAllMomentNoticesRead,
  // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage,
  repairLegacyMomentData,
  subscribeMomentsChanged,
  toggleUserMomentLike,
  updateMomentPostContent,
  upgradeMomentTextCard,
  type MomentNotice,
  type MomentRepostRef, markMomentAutoAttempt } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { buildForumChatBlock } from '@/lib/forum/social';
import { isPostMemoryOn } from '@/lib/forum/core';
import { AskPostSheet, BilingualTranslation, CommentDeleteDialog, EditPostDialog, MomentAutoCfgSheet, MomentInteractionsPage, MomentsEmojiPanel, PostMoreMenu, insertEmojiAtCursor, momentFriendsOf } from './moments-shared';
import { MomentsSettingsPage } from './moments-settings';
import { ThemeStylePage } from './bubble-style-settings';
import { fmtMsgTime, readTextOf, useChatDisplay, type ChatDisplayConfig } from '@/lib/ios/chat-display';
import { bubbleVisual, isLiquidTheme, isRetroTheme, TAIL_CLIP_LEFT, TAIL_CLIP_RIGHT } from '@/lib/ios/bubble-style';
import { chatContactKey, chatCssScopeSelector, scopeCss } from '@/lib/ios/custom-css';
import { ChatSkinProvider } from '@/lib/ios/chat-skin';
import { chatPlaceholder, resolveQuickKeys } from '@/lib/ios/chat-decor';
import { ChatQuickBar, type QuickBarItem } from './chat-quick-bar';
import { StackFitText } from './shrink-text';
import { getMomentsSettings } from '@/lib/ios/moments-settings';
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
import {
  buildPerceptionBlock,
  prewarmPerception,
  perceptionSummary,
  markTypingStart,
  markAiReplyEnd,
} from '@/lib/perception';
import { useEnterSend, setEnterSend, guardEnterToSend } from '@/lib/enter-send';
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvGetRaw, kvSet, kvSetDebounced, kvDel, kvDelRaw, kvKeysByPrefix } from '@/lib/ios/idb-kv';
import { AccountAddSheet } from './account-add-sheet';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accountLoginHistory, accLs, clearForceLoginWall, createAccount, getAccounts, getActiveAccountFor, getActiveAccountIdFor, isForceLoginWallActive, markAccountLoginHistory, parseScopedKey, requestForceLoginWall, switchAccountFor, type PhoneAccount } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { getQqProfileBg, loginAltSlot, loginQQ, listContactsFor, mainOwnerContact, ownerRealNameFor, contactRealName, createContact, setQqProfileBg, getChatBgImage, setChatBgImage, removeChatBgImage, updateContact, getPeerBg, setPeerBg, setAppRelation, cachedOwnerName } from '@/lib/ios/contacts-store';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
import {
  RtBellIcon,
  RtUsersIcon,
  RtStarIcon,
  RetroIc,
  RETRO_ICON_TONES,
  RtPlusVoice,
  RtPlusVideo,
  RtPlusRedPacket,
  RtPlusTransfer,
  RtPlusLocation,
  RtPlusTextCard,
  RtPlusTogether,
  RtPlusExpress,
} from './retro-icons';
import { listAlbums, listAlbumsForChat, addAlbum, getAlbum, addVisionDecision } from '@/lib/ios/album-store';
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
import { genId } from '@/lib/ios/db';
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
  setFriendReqStatus,
  SOURCE_SEARCH_QQ,
  subscribeFriendReqs,
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
import {
  DEFAULT_STICKER_GROUP_ID,
  extractMeaningFromUrl,
  fileNameMeaning,
  isBuiltinGroupId,
  isImageUrl,
  isOfficialEmojiSticker,
  loadStickerGroups,
  loadStickers,
  newStickerId,
  saveStickerGroups,
  saveStickers,
  stickerGroupOf,
} from '@/lib/ios/stickers';
import { BUILTIN_STICKER_GROUP_ID } from '@/lib/ios/builtin-stickers';
import type { Sticker, StickerGroup } from '@/lib/ios/stickers';
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
  setGroupSocialContacts,
  type GroupCardData,
} from '@/lib/ios/group-social';
import { BatchStickerSheet, makeStickerGroup, StickerGroupBar, StickerGroupManageSheet, StickerMeaningPicker } from '@/components/apps/sticker-batch';
import { StickerSearchSheet } from './sticker-search-sheet';
import { useWeatherSnapshot, weatherCodeInfo } from './weather-core';
import type { BatchDraftItem } from '@/components/apps/sticker-batch';
import { useUnreadMap, qqUnreads as qqUnreadStore } from '@/lib/unread-store';
import { useChatFlags, NO_FLAGS, qqChatFlags as qqChatFlagsStore } from '@/lib/chat-flags';
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
import { PerceptionSettingsPage } from './perception-settings';
import { proactiveCfgSummary, parseReminderInstruction, reminderHintHit, reminderSysHint, buildReminderSysMsg, setActiveProactiveChat } from '@/lib/ios/proactive-msg';
import { decideAiVoiceMessage, getAiVoiceFreq, saveAiVoiceFreq, synthesizeAiVoice, undoLastAiVoiceDecision } from '@/lib/ios/ai-voice';
import { describeVoiceId, useMyVoices } from '@/lib/ios/my-voices';
import { applyWbUserBlocks, collectWbBlocks, getBoundBookIds, loadBooks, setBoundBookIds, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { addFavorite, isMsgFavorited, loadFavorites, removeFavorite, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, computeBubbleMenuPosLiquid, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';
import { LocalToast, useLocalToast } from './page-toast';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import { QqGroupChatPage, QqGroupCreatePage, QqGroupInfoPage, QqGroupAvatar, qqGroupRowId } from './qq-group';
import { CoupleMark } from './couple-mark';
import AlbumPage from './album';
import VisionLogPage from './vision-log';
import { buildCrossContextBlocks } from '@/lib/ios/cross-app-context';
import {
  dissolveGroup as dissolveGroupRecord,
  quitGroup as quitGroupRecord,
  effectiveInterop,
  getGroup,
  groupPreview,
  listGroups as listChatGroups,
  loadGroupMsgs,
  updateGroup as updateGroupRecord,
  type ChatGroup,
} from '@/lib/ios/groups';

// ---------------- 类型 / 常量 / 工具 ----------------

interface QQUser {
  id: string;
  /** QQ 内显示名（备注/昵称优先；非真实姓名） */
  name: string;
  /** 真实姓名（联系人 name 字段；AI 称呼与记忆统一用它，展示不用） */
  realName?: string | null;
  /** 昵称（联系人 nickname 字段；只是昵称，不是另一个人也不是正式名字） */
  nickname?: string | null;
  avatar: string | null;
  qqId: string | null;
  phone: string | null;
  persona: string | null;
  /** 多账号 Task 41：非空 = 登录身份是小号/匿名号档案（注册表账号 id），handleLogin 据此切账号作用域 */
  altOf?: string | null;
}

interface QQMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  /** 已读未读回执（显示设置）：发送/投递时 true，对方回话时转 false；undefined = 旧数据，视为已读 */
  unread?: boolean;
  /** 消息种类：缺省 = 文本；image = 图片（content 为 dataURL）；location = 位置（loc 有值）；红包/转账消息 content 为空串（转账接收卡片也是 transfer）；family = 亲属卡（fam 有值）；notice = 红包领取通知；forward = 转发卡片；groupcard = 群聊邀请卡片；relcard = 亲密关系卡片（情侣空间邀请卡/成功卡）；
   *  voice = 语音消息（voice 有值，content 保持空串）；sys = 拉黑等系统提示（居中灰字胶囊，不进 AI 上下文）；blockreq = 角色发起的「申请解除拉黑」卡片；textcard = 文字图片卡片（card 有值，无生图依赖）；mtpay = 美团找人代付卡片（请求/完成）；mtshare = 美团订单分享动态卡片；tbpay = 淘宝代付卡片（请求/完成）；tbshare = 淘宝订单分享动态卡片 */
  kind?: 'text' | 'image' | 'voice' | 'redpacket' | 'transfer' | 'location' | 'notice' | 'sticker' | 'family' | 'forward' | 'groupcard' | 'sys' | 'blockreq' | 'call' | 'textcard' | 'song' | 'mtpay' | 'mtshare' | 'mtdraft' | 'tbpay' | 'tbshare' | 'tbdraft' | 'relcard' | 'pactcard' | 'examcard' | 'lettercard' | 'forumshare';
  /** 恋爱协议卡片（kind='pactcard'；第十二轮：协议分享/签署卡，由 couple-pact-share 落库，点击进情侣空间签署界面） */
  pactcard?: CouplePactCardData;
  /** 恋爱考试卡片（kind='examcard'；第十五轮：我喊TA答题/TA出卷喊我答，由 couple-exam-share 落库，点击进情侣空间试卷页） */
  examcard?: CoupleExamCardData;
  /** 情书信封卡片（kind='lettercard'；第十八轮：我分享情书给TA/TA寄信给我，由 couple-letter-share 落库，点击进情侣空间信件页） */
  lettercard?: CoupleLetterCardData;
  /** 歌曲卡片（kind='song'，Task 68 音乐 × AI）：结构同微信端 */
  song?: { name: string; artist: string; cover?: string; songId?: number; note?: string; autoPlay?: boolean; inviteDone?: boolean; agree?: boolean };
  /** 语音消息数据（kind='voice'；音频 dataURL + 时长 + 波形 + 转写，与微信端共用 VoiceMsgData 结构） */
  voice?: VoiceMsgData;
  /** 语音通话卡片（kind='call'）：state 卡片状态 / duration 接通秒数 / direction 主叫方向（me=我拨打）；
   *  media = 通话媒体（Task 22 视频通话）：'video' 显示摄像机图标与「视频通话时长」文案，缺省语音 */
  call?: { state: CallCardState; duration: number; direction: 'out' | 'in'; media?: 'voice' | 'video' };
  /** 图片消息附加数据：desc = 识图描述（AI 历史可读「[图片]（图片内容：…）」；旧记录图片只存 content=dataURL，无此字段照常兼容）；
   *  fromCard = 文字图片卡片转出的图（长按可重新生成；AI 卡片转图带角色锁脸，我的卡片不带）；
   *  prevSrc = 重新生成替换前保留的旧图（G2「恢复上一张」长按换回，再操作一次又换回新图，可来回切换） */
  img?: { src?: string; desc?: string; fromCard?: boolean; prevSrc?: string };
  /** 文字图片卡片数据（kind='textcard'）：印在卡片上的文字（AI 代笔/用户代写），无生图依赖 */
  card?: { text: string };
  /** 红包/转账消息附加数据（随消息一并 localStorage 持久化） */
  packet?: MsgPacket;
  /** 位置消息附加数据 */
  loc?: MsgLoc;
  /** 亲属卡消息附加数据（AI 赠送 / 领取状态） */
  fam?: QQFamData;
  /** 通知行数据（kind = notice 时有值） */
  notice?: QQNoticeData;
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
   *  记忆提取（memConvoFromRaw）仍按 error===true 滤除（防错误文案混进 AI 发言素材） */
  error?: boolean;
  /** AI 回复失败标记（红色 ! 徽标）：流失败/空回复且本轮无任何产出时打在触发的我的消息上；
   *  点击徽标重试（runAiTurn），成功后 finalize 清除，仍失败可再点。不进 AI 上下文（消息本体照常参与） */
  replyFail?: boolean;
  /** Task 40 错误提示优化：失败分类文案（气泡下方居中灰字提示行显示；不落原始报错，详情走「复制错误详情」） */
  failReason?: string;
  /** 转发卡片（kind='forward'；fwd.from = 来源会话联系人名；merged=true 为合并转发的「聊天记录」卡片，records 存原始对话） */
  fwd?: { from: string; merged?: boolean; title?: string; records?: { name: string; role: 'me' | 'peer'; text: string; quote?: string; time: number; avatar?: string | null; kind?: 'text' | 'sticker' | 'image'; imgSrc?: string; stkMeaning?: string }[] };
  /** 群聊邀请卡片（kind='groupcard'；AI 主动建群/拉人时发出，用户可接受/拒绝） */
  gcard?: GroupCardData;
  /** 亲密关系卡片（kind='relcard'；情侣空间邀请卡/成功卡，AI 邀我或我邀 AI 时由 couple-invite 落库，可接受/拒绝） */
  relcard?: CoupleRelCardData;
  /** 好友添加过程标记（同 WxMsg.fr）：apply = 用户验证消息（胶囊标注「以上为验证消息」）/ greet = AI 验证消息（胶囊标注「以上是打招呼的内容」）/ added = 加好友成功提示（kind='sys' 携带文案，落入普通 sys 胶囊分支与其他系统提示同款包裹） */
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
  /** 美团 AI 代点外卖草稿卡（kind='mtdraft'）：did = 草稿（mt-draft:<did>）；QQ 端仅历史序列化，卡片渲染在微信端 */
  mtdraft?: { did: string };
  /** 淘宝 AI 代买草稿卡（kind='tbdraft'）：did = 草稿（tb-draft:<did>），确认后 AI 付款下单 */
  tbdraft?: { did: string };
}

/** 聊天中的系统通知行（对方领取/退回/拒收了你的红包/转账；转账收款改用接收卡片消息）：居中灰字 + 彩色尾词 */
interface QQNoticeData {
  /** 小图标：rp=红红包 / tr=蓝转账 / fam=金亲属卡 */
  icon: 'rp' | 'tr' | 'fam';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 位置消息：名称 + 详细地址 + 经纬度（AI 可读到“用户在哪”；旧记录无经纬度字段照常兼容） */
interface MsgLoc {
  name: string;
  addr: string;
  lat?: number;
  lng?: number;
}

/** 亲属卡消息数据（AI 赠送；领取后 claimed=true；被收卡方退还后 rejected=true） */
interface QQFamData {
  /** 每月消费上限（元） */
  monthlyLimit: number;
  /** 关系（好朋友/爸爸…，取自联系人关系） */
  relation: string;
  /** 赠卡留言 */
  message: string;
  /** 是否已被领取 */
  claimed: boolean;
  claimedAt?: number;
  /** 被收卡方退还/拒收（终态，卡片变灰） */
  rejected?: boolean;
  /** AI 处理动作用的短 ID（我发给 AI 的卡片才有；格式如 rp-x7k2 / tr-x7k2） */
  cid?: string;
}

export interface MsgPacket {
  type: 'redpacket' | 'transfer';
  /** 金额（元）：普通/专属红包 = 单个金额；拼手气红包 = 总金额 */
  amount: number;
  /** 祝福语 / 转账留言 */
  note: string;
  /** 拼手气红包个数 */
  count?: number;
  /** 红包类型：普通 / 拼手气 / 专属 */
  mode?: 'normal' | 'lucky' | 'dedicated';
  /** 专属红包指定收款成员（群聊专属红包用；单聊不需要：对方即收款人） */
  toId?: string;
  toName?: string;
  /** 领取记录（领取后写入） */
  claims?: Array<{ name: string; avatar: string | null; amount: number; ts: number }>;
  /** 转账是否已被对方收款（发出后延迟自动收款） */
  received?: boolean;
  receivedAt?: number;
  /** 接收卡片凭据：'me'=这张卡是对方收我转账的凭据；'peer'=这张卡是我收对方转账的凭据（详情页文案按此区分「××已收款 / 你已收款」） */
  receiptOf?: 'me' | 'peer';
  /** 退还/拒收终态（我发给 AI 的卡被退回/拒收，或我退回 AI 发的卡；终态后不能重复处理） */
  status?: 'returned' | 'rejected';
  /** 24h 过期清算终态（单聊与群聊 expireStalePackets 同口径）：AI 发出的红包/转账超 24h
   *  未领取/未收款 → 置过期、剩余金额退回发起人（卡片变灰，不可再领取/收款，cardIsFinal = true） */
  expired?: boolean;
  /** 过期清算时间（详情页「退款时间」展示用） */
  expiredAt?: number;
  /** 退款时间（退还后写入；详情页「退款时间」行） */
  refundedAt?: number;
  /** 退还凭据卡专用：原转账发生时间（详情页「转账时间」行显示原转账时间） */
  originTime?: number;
  /** 退还凭据卡专用：退还人（'me'=我退的→详情显示「你已退还」；'peer'=对方退的→「对方已退还」）；原卡省略时按消息角色反推 */
  refundedBy?: 'me' | 'peer';
  /** AI 处理动作用的短 ID（我发给 AI 的红包/转账才有；AI 在动作标记里引用它） */
  cid?: string;
}

/** 会话列表预览：非文本消息显示摘要 */
function msgPreview(m: QQMsg | undefined): string {
  if (!m) return '';
  // 撤回的消息在会话列表预览显示「你/对方撤回一条消息」
  if (m.recalled) return m.role === 'me' ? '你撤回一条消息' : '对方撤回一条消息';
  if (m.kind === 'redpacket') return '[QQ红包]';
  if (m.kind === 'transfer') return '[转账]';
  if (m.kind === 'family') return '[亲属卡]';
  if (m.kind === 'notice') return m.notice ? `${m.notice.pre}${m.notice.accent}` : '';
  if (m.kind === 'image') return '[图片]';
  if (m.kind === 'textcard') return '[文字图片]';
  if (m.kind === 'voice') return '[语音]';
  // Task 22 视频通话：媒体感知——视频通话卡片在会话列表/通知预览显示 [视频通话]
  if (m.kind === 'call') return m.call?.media === 'video' ? '[视频通话]' : '[语音通话]';
  if (m.kind === 'location') return '[位置]';
  if (m.kind === 'sticker') return '[表情]';
  if (m.kind === 'forward') return m.fwd?.merged ? '[聊天记录]' : m.content;
  if (m.kind === 'groupcard') return '[群聊邀请]';
  if (m.kind === 'relcard') return '[亲密关系]';
  if (m.kind === 'pactcard') return '[恋爱协议]';
  if (m.kind === 'examcard') return '[恋爱考试]';
  if (m.kind === 'lettercard') return '[情书]';
  if (m.kind === 'forumshare') return '[X论坛帖子]';
  return m.content;
}

/** 聊天内部浮层：发红包/转账页、红包开箱、红包详情、交易详情、收款页、亲属卡详情、发送位置、线下见面、生成照片、快递页、淘宝代付详情 */
type ChatLayer =
  | null
  | { view: 'redpacket' }
  | { view: 'transfer' }
  | { view: 'location' }
  | { view: 'offline' }
  | { view: 'textcard' }
  | { view: 'express' }
  | { view: 'rp-open' | 'rp-detail' | 'tr-detail' | 'tr-receive' | 'fam-detail'; msgId: string }
  | { view: 'mtpay-detail'; pid: string }
  | { view: 'tbpay-detail'; pid: string };

/** QQ 登录态存的是本机联系人 id；读写一律经 accLs(key, 'qq') 现算按账号隔离（大号=原键，旧登录不丢） */
const LS_SESSION = 'qq-session-user-id';
const lsMsgsKey = (contactId: string) => `qq-chat-msgs:${contactId}`;

// ---------------- 拍一拍文案（Task 30：QQ 设置›头像双击动作里设置，按账号隔离） ----------------

/** 拍一拍文案存储键（accLs 按当前 QQ 账号加作用域后缀：大号无后缀、小号 --{accId}） */
const qqClapKey = (): string => accLs('qq-clap-text', 'qq');

/** 读取拍一拍文案（未设置返回空串；文案是「拍了拍」的后缀，如「的小脑袋」） */
function readQqClapText(): string {
  try {
    return (window.localStorage.getItem(qqClapKey()) ?? '').trim().slice(0, 30);
  } catch {
    return '';
  }
}

/** 保存拍一拍文案（空串 = 清除，回退「未设置」） */
function writeQqClapText(text: string): void {
  try {
    window.localStorage.setItem(qqClapKey(), text.trim().slice(0, 30));
  } catch {
    // 存储异常静默：拍一拍文案退化为默认展示
  }
}

/** 拍一拍系统行的 AI 上下文序列化（Task 30）：按双方名字显式拼接（文案 = 拍一拍后缀，原样拼在句尾），
 *  不用「你/我」代词——assistant 消息里「你」指 AI 本身，混用会造成主语伪造 */
function qqPatHistoryLine(pat: NonNullable<QQMsg['sys']>['pat'], meName: string, peerName: string): string {
  const suffix = pat?.text ?? '';
  if (pat?.by === 'me') return pat.self ? `[${meName}拍了拍自己${suffix}]` : `[${meName}拍了拍${peerName}${suffix}]`;
  return `[${peerName}拍了拍${meName}${suffix}]`;
}

/** AI 特殊消息标记 → QQ 消息记录（红包/转账/亲属卡/位置/表情包；渲染与交互复用用户手动发送的同款卡片）。
 *  content 存可读摘要：进入 AI 上下文让角色知道自己发过什么；卡片渲染按 kind 走，不显示 content */
function richToQqMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): QQMsg {
  switch (rich.kind) {
    case 'redpacket':
      return { id, role: 'peer', content: '[QQ红包]', time, kind: 'redpacket', packet: { type: 'redpacket', amount: rich.amount, note: rich.blessing } };
    case 'transfer':
      return { id, role: 'peer', content: '[转账]', time, kind: 'transfer', packet: { type: 'transfer', amount: rich.amount, note: rich.note, received: false } };
    case 'family':
      return {
        id,
        role: 'peer',
        content: '[亲属卡]',
        time,
        kind: 'family',
        fam: {
          monthlyLimit: rich.monthlyLimit,
          relation: peer.relation?.trim() || '好朋友',
          message: rich.message || '给你办的亲属卡，每个月都能用',
          claimed: false,
        },
      };
    case 'location': {
      const d = locFromRich(rich.name, rich.coords);
      return { id, role: 'peer', content: '[位置]', time, kind: 'location', loc: { name: d.name, addr: d.address || '地图上的一个位置', lat: d.lat, lng: d.lng } };
    }
    case 'sticker': {
      // parseRichParts 已保证 ID/意思能匹配上；取不到时兑底为文字
      // 100-e 兑底占位统一为微信同款「[表情包]」（此前 QQ 写「[表情]」，两端漂移；
      // 表情包开关关闭时的剥除正则 /\[表情包\]|\[表情\]/g 两种都覆盖，旧数据兼容不受影响）
      const s = loadStickers('qq').find((x) => x.id === rich.stickerId);
      return s
        ? { id, role: 'peer', content: '', time, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } }
        : { id, role: 'peer', content: '[表情包]', time };
    }
    case 'song':
      return songRichToQqMsg(rich, id, time, peer);
  }
}

/**
 * 歌曲卡片标记 → QQ 消息（Task 68 音乐 × AI，同微信端）：卡片可点击播放；
 * 分享/点播/邀约写角色记忆（sourceTag='music-share'）；invite 同时弹全局邀请卡。
 */
function songRichToQqMsg(rich: RichSong, id: string, time: number, peer: ContactRecord): QQMsg {
  const label = rich.artist ? `《${rich.name}》（${rich.artist}）` : `《${rich.name}》`;
  try {
    if (rich.autoPlay) {
      memAddEventFragment(peer.id, 'qq', `你给机主放了${label}，点卡片就能听`, { eventTime: time, sourceTag: 'music-share' });
    } else if (rich.invite) {
      memAddEventFragment(peer.id, 'qq', `你想邀请机主一起听${label}`, { eventTime: time, sourceTag: 'music-share' });
    } else {
      memAddEventFragment(peer.id, 'qq', `你分享了${label}给机主${rich.note ? `，说：${rich.note}` : ''}`, { eventTime: time, sourceTag: 'music-share' });
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

/** 红包/转账/亲属卡消息的状态标签（卡片文案 + AI 上下文摘要共用） */
function cardStateLabel(m: QQMsg): string {
  if (m.kind === 'redpacket' && m.packet) {
    if (m.packet.expired) return '已过期';
    if (m.packet.status === 'returned') return '已退回';
    if (m.packet.status === 'rejected') return '已拒收';
    // 100-e 拼手气红包（多份）部分领取：状态区分三档——全部领完「已领取」、领了一部分
    // 「已领取（n/m份）」、一份没领「待领取」；旧逻辑部分领取也写「已领取」，与 cardIsFinal
    // （未领完非终态）和待处理清单自相矛盾，AI 看到上下文里「已领取」+「待处理」不敢再领剩余份额；
    // 历史序列化（[红包 ID:…，已领取（n/m份）]）与待处理清单共用本函数，修复自动传播
    const claimedN = (m.packet.claims ?? []).length;
    const totalCount = m.packet.count ?? 1;
    if (totalCount > 1 && claimedN > 0 && claimedN < totalCount) return `已领取（${claimedN}/${totalCount}份）`;
    return claimedN > 0 ? '已领取' : '待领取';
  }
  if (m.kind === 'transfer' && m.packet) {
    if (m.packet.expired) return '已过期';
    if (m.packet.status === 'returned') return '已退回';
    if (m.packet.status === 'rejected') return '已拒收';
    return m.packet.received ? '已收款' : '待收款';
  }
  if (m.kind === 'family' && m.fam) {
    if (m.fam.rejected) return '已退回';
    return m.fam.claimed ? '已领取' : '待领取';
  }
  return '';
}

/** 卡片是否已到终态（领取完/收款/退还/拒收/过期都算；终态后不再出现在待处理清单、不可重复处理） */
function cardIsFinal(m: QQMsg): boolean {
  const p = m.kind === 'redpacket' ? m.packet : undefined;
  // #38 拼手气红包（多份）在未被退回/拒收/过期时：全部份额领完才算终态——
  // 旧逻辑「首领即终态」会让剩余份额永远悬着（AI 不再处理、24h 清算也跳过，钱死悬在中间态）
  if (p && (p.count ?? 1) > 1 && !p.expired && !p.status) {
    return (p.claims ?? []).length >= (p.count ?? 1);
  }
  const label = cardStateLabel(m);
  return label !== '待领取' && label !== '待收款';
}

/** 【fix3-d-1】转账「凭据卡」判定（收款凭据 / 退还凭据）：
 *  凭据卡与真实转账卡的区分依据——凭据卡 content 恒为空串且不带 cid（我发的原卡有 cid、
 *  AI 发的原卡 content='[转账]'；原卡收款/退还后补写的 receiptOf/refundedBy 不影响原卡
 *  content/cid 特征），不会误伤原卡序列化；
 *  旧数据兜底与 tr-detail 详情页的 receiverIsMe 推断同口径：对方卡片且已收款、无 receiptOf 的
 *  只会是「我收对方转账的旧凭据」（对方原卡 content 非空已被上面排除）。 */
function isTransferReceiptMsg(m: QQMsg): boolean {
  if (m.kind !== 'transfer' || !m.packet || m.content || m.packet.cid) return false;
  const p = m.packet;
  if (p.receiptOf != null || p.refundedBy != null) return true;
  return p.received === true && m.role === 'peer';
}

/** 【fix3-d-1】转账凭据卡 → AI 历史显式主语句子（修复「凭据卡混进 AI 历史伪造资金方向」：
 *  旧序列化把凭据卡也写成「[转账 ID:xxx ¥n，已收款]」，在 assistant/user 槽位里读起来像
 *  持卡人又发了一笔转账——AI 收我转账的凭据被当成 AI 发的转账，我收 AI 转账的凭据被当成我发的）。
 *  QQ 端字段取值域（两处创建点实证，applyAiActions / refundPeerCard / 收款页 onAccept）：
 *  - 收款凭据：received=true + receiptOf（'me'=对方收我的转账 / 'peer'=我收对方的转账），
 *    卡片 role 即收款人（AI 收款凭据 role='peer'、我收款凭据 role='me'）；
 *  - 退还凭据：status='returned' + refundedBy（'me'=我退的 / 'peer'=对方退的），不写 receiptOf——
 *    原发送方=退回方的另一侧（AI 退我发的卡 refundedBy='peer'→原发送方是我；我退 AI 发的卡反之）；
 *  - 旧数据兜底：对方卡片已收款但缺 receiptOf → 按详情页同款推断「我收对方的旧凭据」；
 *  - 其余关键字段缺失（未知形态）→ 回退中性句「一笔转账已{状态}」，不暴露资金方向。 */
function transferReceiptAiText(m: QQMsg, meName: string, peerName: string): string {
  const p = m.packet;
  if (!p) return '[转账凭据：一笔转账]';
  const nameOf = (r: 'me' | 'peer') => (r === 'me' ? meName : peerName);
  if (p.receiptOf) {
    // 收款凭据：原发送方按 receiptOf、接收方按卡片 role
    return `[转账凭据：${nameOf(p.receiptOf)}转给${nameOf(m.role)} ¥${p.amount}${p.note ? `「${p.note}」` : ''}，已收款]`;
  }
  if (p.refundedBy) {
    // 退还凭据：退回方按 refundedBy，原发送方取其另一侧
    return `[转账凭据：${nameOf(p.refundedBy === 'me' ? 'peer' : 'me')}转的 ¥${p.amount}已由${nameOf(p.refundedBy)}退回]`;
  }
  if (p.received && m.role === 'peer') {
    // 旧数据兜底：对方卡片已收款、无 receiptOf → 我收对方转账的旧凭据（发送方=对方、接收方=我）
    return `[转账凭据：${peerName}转给${meName} ¥${p.amount}${p.note ? `「${p.note}」` : ''}，已收款]`;
  }
  const label = cardStateLabel(m);
  return `[转账凭据：一笔转账${label || '已处理'}]`;
}

/** 收集「我发给 AI 的、待处理」的红包/转账（生成 system 待处理清单，AI 用动作标记处理）。
 *  #19 已撤回的卡不进清单（用户撤回即收回处理权，AI 不应再对它做出领取/退回/拒收动作） */
function collectPendingCards(msgs: QQMsg[]): PendingCardInfo[] {
  return msgs
    .filter((m) => m.role === 'me' && !m.recalled && !cardIsFinal(m))
    .map<PendingCardInfo | null>((m) => {
      if (m.kind === 'redpacket' && m.packet) {
        // 100-e 拼手气红包（count>1）在清单里标注总份数，AI 知道还有剩余份额可领；普通红包 label 不变
        const shareSuffix = (m.packet.count ?? 1) > 1 ? `（共${m.packet.count}份）` : '';
        return { id: m.packet.cid ?? m.id, kind: 'redpacket', amount: m.packet.amount, label: `拼手气红包${shareSuffix}，祝福语"${m.packet.note}"` };
      }
      if (m.kind === 'transfer' && m.packet) {
        return { id: m.packet.cid ?? m.id, kind: 'transfer', amount: m.packet.amount, label: m.packet.note ? `备注"${m.packet.note}"` : '无备注' };
      }
      return null;
    })
    .filter((x): x is PendingCardInfo => x !== null);
}

/**
 * 应用 AI 的处理动作（领取/退回/拒收我发的红包/转账）：只处理「待处理」状态的目标（幂等，重复标记忽略），
 * 返回更新后的消息数组 + 动作产生的通知行/接收凭据卡（extras=接收凭据卡等需要
 * 插在动作发生位置的卡片，调用方按流式顺序与通知行一起落盘）。标记不带感谢语/理由，
 * 回应内容由 AI 人设正文承担。纯本地模拟：
 * 领取 → 记入领取记录；退回 → 金额退回我的钱包（写账单）；拒收 → 终态标记 + 金额退回钱包
 *（#3：用户发卡时已扣款，AI 拒收即原路退回，否则这笔钱凭空消失）。
 */
function applyAiActions(
  actions: RichAction[],
  msgs: QQMsg[],
  peer: ContactRecord,
  timeBase = Date.now()
): { msgs: QQMsg[]; notices: QQMsg[]; extras: QQMsg[] } {
  const next = msgs.map((m) => ({ ...m, packet: m.packet ? { ...m.packet } : undefined }));
  const notices: QQMsg[] = [];
  const extras: QQMsg[] = [];
  for (const a of actions) {
    // #19 recalled 防御：已撤回的卡即使被标记引用也跳过（清单入口已过滤，这里兑底防历史数据/竞态）
    const idx = next.findIndex((m) => m.role === 'me' && !m.recalled && (m.packet?.cid === a.targetId || m.id === a.targetId));
    if (idx < 0) continue;
    const m = next[idx];
    if (!m.packet || m.recalled || cardIsFinal(m)) continue; // 只处理待处理状态（已领取/已退回/已拒收/已撤回的忽略）
    const verb = actionVerb(a.kind);
    const time = timeBase + notices.length + extras.length;
    if (m.kind === 'redpacket') {
      const p = m.packet;
      const claims = p.claims ?? [];
      const count = p.count ?? 1;
      if (verb === 'claim') {
        // AI 领取：单人群按现有自动领取规则（普通领全额；拼手气随机拆一份），写入领取记录 + 通知行
        if (claims.length < count) {
          const remaining = round2(p.amount - claims.reduce((s, c) => s + c.amount, 0));
          // #27 剩余额度已拿空（<0.01）时跳过该份额不记账：旧实现 Math.max(0.01,…) 会在拿空后
          // 仍虚记 0.01 份额（连领累积虚增）；随机拆分同时用 remaining 封顶防四舍五入越界。
          // 拿空后不再追加 claims：卡保持非终态，后续领取同跳过，24h 后走过期清算（总额-已领=0）
          if (remaining >= 0.01) {
            const amt = p.mode === 'lucky' && count > 1 ? Math.min(remaining, Math.max(0.01, round2(Math.random() * remaining))) : remaining;
            next[idx] = { ...m, content: `[QQ红包]（${peer.name}已领取）`, packet: { ...p, claims: [...claims, { name: peer.name, avatar: peer.avatar, amount: amt, ts: Date.now() }] } };
            notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}领取了你的`, accent: '红包' } });
          }
        }
      } else {
        // #32 拼手气（多份）部分领取后退回/拒收：按「总额-已领」退剩余并清空 claims（对齐过期清算
        // expireStaleSingleCards 的「总额-已领」口径），详情页不再出现「已领 X 元 + 已退回全额」矛盾展示；
        // 单份红包不存在部分领取，保持全额退（行为不变）
        const refund = count > 1 ? round2(p.amount - claims.reduce((s, c) => s + c.amount, 0)) : p.amount;
        next[idx] = { ...m, content: `[QQ红包]（${verb === 'return' ? '已退回' : '已拒收'}）`, packet: { ...p, status: verb === 'return' ? 'returned' : 'rejected', ...(count > 1 ? { claims: [] } : {}) } };
        if (refund > 0) refundToWallet(refund, 'redpacket');
        if (verb === 'return') {
          notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}退回了你的`, accent: '红包' } });
        } else {
          // #3 AI 拒收我发的红包：拒收即原路退回（发卡时已扣款，不退则钱凭空消失）
          notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'rp', pre: `${peer.name}拒收了你的红包，已`, accent: '退回' } });
        }
      }
    } else if (m.kind === 'transfer') {
      const p = m.packet;
      if (verb === 'claim') {
        // AI 收款：原卡标记已收款 + receiptOf='me'（详情页显示「XX已收款」）+ 「已收款」接收凭据卡——
        // 凭据卡放 extras，由调用方插在动作发生位置（而不是旧代码里永远排在所有新消息之前）
        next[idx] = { ...m, content: '[转账]（已收款）', packet: { ...p, received: true, receivedAt: Date.now(), receiptOf: 'me' as const } };
        extras.push({ id: uid(), role: 'peer', content: '', time, kind: 'transfer', packet: { type: 'transfer', amount: p.amount, note: p.note, received: true, receivedAt: Date.now(), receiptOf: 'me' } });
      } else if (verb === 'return') {
        // AI 退回我发的转账：原卡标记终态（变灰）+ 「对方」发出的退还凭据卡放 extras（灰卡↩+已退还，详情页「对方已退还」）
        const refundedAt = Date.now();
        next[idx] = { ...m, content: '[转账]（已退回）', packet: { ...p, status: 'returned', refundedAt } };
        refundToWallet(p.amount, 'transfer');
        extras.push({
          id: uid(),
          role: 'peer',
          content: '',
          time,
          kind: 'transfer',
          packet: { type: 'transfer', amount: p.amount, note: p.note, received: false, status: 'returned' as const, refundedAt, originTime: m.time, refundedBy: 'peer' as const },
        });
      } else {
        next[idx] = { ...m, content: '[转账]（已拒收）', packet: { ...p, status: 'rejected' } };
        // #3 AI 拒收我发的转账：拒收即原路退回（发卡时已扣款，不退则钱凭空消失）
        refundToWallet(p.amount, 'transfer');
        notices.push({ id: uid(), role: 'peer', content: '', time, kind: 'notice', notice: { icon: 'tr', pre: `${peer.name}拒收了你的转账，已`, accent: '退回' } });
      }
    } else {
      continue;
    }
  }
  return { msgs: next, notices, extras };
}

// ---------------- 单聊红包/转账 24h 过期清算（与群聊 expireStalePackets 同口径） ----------------

/** 防重入：清算进行中标记（QQ App 挂载 / 进聊天页 / AI 回合结算多入口并发时同刻只跑一次） */
let qqSingleCardSweepRunning = false;

/**
 * 单聊 24h 过期清算：扫描所有 QQ 单聊会话中「超 24h 未领取/未收款」的红包（剩余金额）与转账，
 * 置过期终态（packet.expired，卡片变灰、不可再领取/收款、collectPendingCards/cardIsFinal 不再计）
 * + 追加系统提示行（「XX的红包已过期退回」/「你发给XX的红包已过期退回」，居中灰字不进 AI 上下文）。
 * 退回发起人（#5 扩展双向）：
 * - role='peer'（AI 发出）：角色侧没有钱包/账单存储，发卡时也不扣任何款（资金退回无需入账，
 *   与群聊口径一致：群聊也只有机主发起的红包才退钱包），资金层面仅卡片置终态 + 提示行。
 * - role='me'（我发给 AI）：发卡时已扣款（executePayment），过期按「总额-已领」退剩余到我的钱包
 *   + 写账单（与群聊 expireStalePackets 的 senderId==='me' 退款写法同口径）。
 * 返回是否有变更，供调用方（聊天页）决定是否把落盘记录同步回本地视图。
 */
async function expireStaleSingleCards(): Promise<boolean> {
  if (qqSingleCardSweepRunning) return false;
  qqSingleCardSweepRunning = true;
  try {
    const now = Date.now();
    let raw: ContactRecord[];
    try {
      // 头像按 App 隔离：QQ 侧读 qq 槽位投影（过期提示行里的展示名/头像与聊天页同源）
      raw = await listContactsFor('qq');
    } catch {
      return false;
    }
    let changed = false;
    // 展示名与聊天页一致（昵称优先，机主本人同规则——社交展示名），提示行里的名字才能对得上气泡头像旁的称呼
    for (const c of withDisplayNames(raw, { social: true, app: 'qq' })) {
      const msgs = loadMsgs(c.id);
      if (msgs.length === 0) continue;
      let next = msgs;
      let dirty = false;
      const notices: QQMsg[] = [];
      for (const m of msgs) {
        if (!m.packet || m.packet.expired) continue; // 幂等：已清算过的过期卡直接跳过，不重复提示/退款
        if (cardIsFinal(m)) continue; // 已领取完/已收款/已退回/已拒收的终态卡不参与清算
        if (now - m.time < 24 * 3600_000) continue;
        const p = m.packet;
        const idx = next.findIndex((x) => x.id === m.id);
        if (idx < 0) continue;
        // #5 role='me'（我发给 AI 的卡）过期退回：发卡时已扣款，按「总额-已领」退剩余到我的钱包（写账单）；
        // 拼手气红包多份部分领取时同理（#38 后此类卡不再首领即终态，能走到这里被清算）
        const mine = m.role === 'me';
        const kindLabel = p.type === 'redpacket' ? '红包' : '转账';
        const remaining = p.type === 'redpacket' ? round2(p.amount - (p.claims ?? []).reduce((s, c) => s + c.amount, 0)) : p.amount;
        next = [...next];
        next[idx] = {
          ...m,
          content: p.type === 'redpacket' ? '[QQ红包]（已过期退回）' : '[转账]（已过期退回）',
          packet: { ...p, expired: true, expiredAt: now },
        };
        dirty = true;
        changed = true;
        if (mine && remaining > 0) refundToWallet(remaining, p.type === 'redpacket' ? 'redpacket' : 'transfer');
        notices.push({
          id: uid(),
          role: 'peer',
          content: '',
          time: now + notices.length,
          kind: 'notice',
          notice: {
            icon: p.type === 'redpacket' ? 'rp' : 'tr',
            pre: mine ? `你发给${c.name}的${kindLabel}已过期` : `${c.name}的${kindLabel}已过期`,
            accent: '退回',
          },
        });
      }
      if (dirty) saveMsgs(c.id, [...next, ...notices]);
    }
    return changed;
  } finally {
    qqSingleCardSweepRunning = false;
  }
}

/** QQ空间：用户发的帖子 / 种子帖点赞状态（localStorage 持久化） */
const LS_ZONE_POSTS = 'qq-zone-posts';
const LS_ZONE_LIKES = 'qq-zone-likes';
const LS_ZONE_COMMENTS = 'qq-zone-comments';
/** 个人中心打卡状态（当日已打卡 + 连续天数，localStorage 持久化） */
const LS_QQ_CHECKIN = 'qq-checkin';
const LS_FRIEND_LIKE = (contactId: string) => `qq-friend-likes:${contactId}`;
// QQ 钱包：余额/Q币/小金库、银行卡、账单流水（本地持久化）
const LS_WALLET = 'qq-wallet';
const LS_WALLET_CARDS = 'qq-wallet-cards';
const LS_WALLET_BILLS = 'qq-wallet-bills';

/** 本地日期键（打卡用，避免 toISOString 的 UTC 偏移） */
function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

interface ZonePost {
  id: string;
  authorName: string;
  avatar: string | null;
  /** 动态引擎写入的作者类型（'user' 自己 / 'char' 角色；legacy 数据缺省，读时按 peerId 归因） */
  author?: 'user' | 'char';
  /** 角色发的动态 = 该角色联系人 id（引擎写入；用户帖/legacy 缺省）——头像实时解析的身份引用 */
  peerId?: string | null;
  content: string;
  time: string;
  likedBy: string[];
  /** 说说配图（压缩后的 dataURL，最多 9 张） */
  images?: string[];
  /** 「文字图片」卡片文字（AI 配图降级产物；点击卡片可升级为真图） */
  textCard?: string;
  /** 卡片已升级为真实照片（引擎 upgradeMomentTextCard 写入；升级图长按/右键可「重新生成」，A2 资格判定） */
  textCardUpgraded?: boolean;
  /** 最近一次生成/升级这张照片实际使用的画面描述（重新生成弹层预填；legacy 帖子缺省） */
  textCardDesc?: string;
  /** 发说说时附的位置名（可选） */
  location?: string;
  /** 转发引用（转发是「理由 + 原动态摘要卡」） */
  repostOf?: MomentRepostRef;
  /** 引擎写入的双语译文（中文），渲染时折叠展示 */
  contentZh?: string;
}

/** QQ空间帖子评论（种子帖/用户帖统一按 postId 存 map，localStorage 持久化） */
interface ZoneComment {
  id: string;
  author: string;
  content: string;
  time: string;
  /** 回复的目标评论作者（回复评论功能） */
  replyTo?: string;
  /** 作者类型（引擎写入；legacy 数据可能缺失，读时按名字推断） */
  authorKind?: 'user' | 'char';
  /** 引擎写入的双语译文（中文），渲染时折叠展示 */
  contentZh?: string;
}

/** 空间种子动态（原「卖萌磕到牙」示例帖已按需求移除，空间仅显示用户自己发布的动态） */
const ZONE_SEEDS: ZonePost[] = [];

const SEED_DEFAULT_LIKE: Record<string, boolean> = {};

function loadZonePosts(): ZonePost[] {
  try {
    const parsed: unknown = kvGet<ZonePost[]>(LS_ZONE_POSTS);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ZonePost =>
        Boolean(p) &&
        typeof (p as ZonePost).id === 'string' &&
        typeof (p as ZonePost).content === 'string' &&
        typeof (p as ZonePost).authorName === 'string'
    );
  } catch {
    return [];
  }
}

function loadZoneComments(): Record<string, ZoneComment[]> {
  try {
    const parsed: unknown = kvGet<Record<string, ZoneComment[]>>(LS_ZONE_COMMENTS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ZoneComment[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const list = v
        .filter(
          (x): x is ZoneComment =>
            Boolean(x) && typeof (x as ZoneComment).author === 'string' && typeof (x as ZoneComment).content === 'string'
        )
        .map((x) => {
          // 旧版遗留修复：AI「回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char）读时摘掉错误指向
          if (x.authorKind === 'char' && typeof x.replyTo === 'string' && x.replyTo === x.author) {
            return { ...x, replyTo: undefined };
          }
          return x;
        });
      if (list.length) out[k] = list;
    }
    return out;
  } catch {
    return {};
  }
}

/** 手机号打码：183******33 */
function maskPhone(p: string | null): string {
  if (!p) return '未绑定';
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}******${p.slice(-2)}`;
}

/** QQ 品牌色 */
const QQ_BLUE = '#12B7F5';
const TAB_ACTIVE = 'text-[#1E6FFF] dark:text-[#4AA3FF]';

/** 古早主题（retro）底部 Tab 图标（粗线方角线稿，颜色随宿主 currentColor：
 *  选中态由按钮上的 .rt-tab-on 复古蓝接管；不填充线稿） */
function RtTabIconOf({ id }: { id: string }) {
  if (id === '消息') return <RtBellIcon className="h-[22px] w-[22px]" />;
  if (id === '联系人') return <RtUsersIcon className="h-[22px] w-[22px]" />;
  return <RtStarIcon className="h-[22px] w-[22px]" />;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 用户发给 AI 的红包/转账短 ID（AI 动作标记里引用；短小易抄写） */
function nextCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 当前正在查看的 QQ 聊天（ChatPage 挂载时写入/卸载时清除）：AI 回复落盘时不在该会话 → 未读角标 +1 */
let qqActiveChatId: string | null = null;
/** 排队补跑回合：对方正在回复时用户又发了消息 / 在回复中处理了「解除拉黑申请、退还红包转账亲属卡」
 *  等需要 AI 后续回应的事项 —— 本轮流结束后由聊天页自动补跑一轮回复。
 *  #28 localStorage 持久化（key: qq-queued-turns）：模块加载时恢复，增删即同步写回——刷新后排队中的
 *  消息不再丢失（补跑依赖聊天页被打开：刷新后重新进入该会话，kick effect 挂载即自动补跑）。
 *  37-a：队列项扩展 event 字段——回复中触发的系统事件（拉黑申请同意/拒绝、退卡）随补跑回合保留
 *  （原实现直接 runAiTurn：同会话已有流时 beginChatStream 返回 false，事件被静默丢弃、AI 绝口不提） */
type QqQueuedTurn = { kind: 'kick'; event?: string };
// 多账号 v2（Task 40-2b）：按账号隔离（大号=原键向后兼容；小号 qq-queued-turns--{id}）。
// 切换账号不再整页刷新 → 严禁模块常量固化：每次读写经 queuedTurnsKey() 现算，
// 换号后由 QQApp 根组件的账号切换监听调 qqQueueReload() 重读新账号队列。
function queuedTurnsKey(): string {
  return accLs('qq-queued-turns', 'qq');
}

/** 读取并规范化排队表（兼容旧格式：contactId 字符串数组 = 纯消息补跑，无事件） */
function readQqQueuedTurns(): Record<string, QqQueuedTurn[]> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(queuedTurnsKey()) ?? '{}');
    const out: Record<string, QqQueuedTurn[]> = {};
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
        .filter((x): x is QqQueuedTurn => Boolean(x) && typeof x === 'object' && (x as QqQueuedTurn).kind === 'kick')
        .map((x) => (typeof x.event === 'string' && x.event.trim() ? { kind: 'kick' as const, event: x.event } : { kind: 'kick' as const }));
      if (turns.length > 0) out[k] = turns;
    }
    return out;
  } catch {
    return {};
  }
}

const qqQueuedTurns = readQqQueuedTurns();

function qqQueueWrite(): void {
  try {
    window.localStorage.setItem(queuedTurnsKey(), JSON.stringify(qqQueuedTurns));
  } catch {
    // localStorage 异常忽略：内存队列照常工作（仅刷新后丢该条补跑）
  }
}

/** 排队一条补跑回合（event = 系统事件文本，随补跑回合注入上下文；不带事件 = 普通消息补跑） */
function qqQueueAdd(id: string, event?: string): void {
  const turn: QqQueuedTurn = event ? { kind: 'kick', event } : { kind: 'kick' };
  const list = qqQueuedTurns[id] ?? [];
  list.push(turn);
  qqQueuedTurns[id] = list;
  qqQueueWrite();
}

function qqQueueDelete(id: string): void {
  if (!qqQueuedTurns[id]) return;
  delete qqQueuedTurns[id];
  qqQueueWrite();
}

/** 多账号 v2（Task 40-2b）：切换 QQ 账号后重读当前账号的排队表（模块缓存随账号显式刷新，不刷新网页） */
function qqQueueReload(): void {
  for (const k of Object.keys(qqQueuedTurns)) delete qqQueuedTurns[k];
  Object.assign(qqQueuedTurns, readQqQueuedTurns());
}

function loadMsgs(contactId: string): QQMsg[] {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const parsed: unknown = kvGet<QQMsg[]>(lsMsgsKey(contactId));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is QQMsg =>
          Boolean(m) &&
          typeof (m as QQMsg).content === 'string' &&
          ((m as QQMsg).role === 'me' || (m as QQMsg).role === 'peer')
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
        // 语音消息规范化（旧记录/损坏记录兼容；url 为空串但带 localText 的是文字转语音本地仿真消息，保留可静音重播）
        voice:
          m.kind === 'voice' && m.voice && typeof m.voice.url === 'string'
            ? {
                url: m.voice.url,
                duration: typeof m.voice.duration === 'number' && m.voice.duration > 0 ? m.voice.duration : 1,
                wave: Array.isArray(m.voice.wave) ? m.voice.wave.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 1) : [],
                localText: typeof m.voice.localText === 'string' && m.voice.localText.trim() ? m.voice.localText : undefined,
                // AI 语音消息：合成通道（builtin=内置引擎实时朗读）与发送者联系人 id（朗读时解析角色音色）
                synth: m.voice.synth === 'builtin' || m.voice.synth === 'api' ? m.voice.synth : undefined,
                contactId: typeof m.voice.contactId === 'string' && m.voice.contactId ? m.voice.contactId : undefined,
                transcript: typeof m.voice.transcript === 'string' && m.voice.transcript ? m.voice.transcript : undefined,
                stt: m.voice.stt === 'pending' || m.voice.stt === 'done' || m.voice.stt === 'failed' ? m.voice.stt : undefined,
              }
            : undefined,
        // 语音通话卡片规范化（kind='call'）：state 白名单外一律回退 ended，direction 仅认 in/out；
        // media 仅认 'voice'|'video'（Task 22 视频通话），其余丢弃走缺省语音
        call:
          m.kind === 'call' && m.call && typeof m.call.duration === 'number'
            ? {
                state:
                  m.call.state === 'cancelled' ||
                  m.call.state === 'no-answer' ||
                  m.call.state === 'rejected' ||
                  m.call.state === 'missed-in' ||
                  m.call.state === 'ended'
                    ? m.call.state
                    : ('ended' as const),
                duration: m.call.duration,
                direction: m.call.direction === 'in' ? ('in' as const) : ('out' as const),
                media: m.call.media === 'video' ? ('video' as const) : m.call.media === 'voice' ? ('voice' as const) : undefined,
              }
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
      }));
  } catch {
    return [];
  }
}

function saveMsgs(contactId: string, msgs: QQMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步；落盘防抖合并，同微信端）；旧 localStorage 键已由迁移器删除
  // 聊天记录不封顶（用户反馈：以前截 1000 条会挤丢旧聊天记录；kv 在 IndexedDB，纯文本容量可控）
  kvSetDebounced(lsMsgsKey(contactId), msgs);
}

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
const lsAiEventsKey = (contactId: string) => `qq-ai-events:${contactId}`;

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
const consumedQqAiEvents = new Map<string, number>();
const keyOfQqAiEvent = (contactId: string, text: string) => `${contactId}\n${text}`;

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
      const key = keyOfQqAiEvent(contactId, text);
      if (!localBudget.has(key)) localBudget.set(key, consumedQqAiEvents.get(key) ?? 0);
      const budget = localBudget.get(key) ?? 0;
      if (budget > 0) {
        localBudget.set(key, budget - 1);
        continue;
      }
      out.push(text);
      consumedQqAiEvents.set(key, (consumedQqAiEvents.get(key) ?? 0) + 1);
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
          const key = keyOfQqAiEvent(contactId, x);
          if (!touched.includes(key)) touched.push(key);
          const used = consumedQqAiEvents.get(key) ?? 0;
          if (used > 0) {
            consumedQqAiEvents.set(key, used - 1);
            return false;
          }
          return true;
        });
        if (rest.length === 0) kvDel(lsAiEventsKey(contactId));
        else kvSet(lsAiEventsKey(contactId), rest.slice(-10));
      } catch {
        // 清除失败：释放登记（宁可极端情况下重复回应一次，不让登记卡死后续同文事件）
        for (const key of touched) consumedQqAiEvents.delete(key);
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

// ---------------- 密友值 / 好友天数（好友标识页，按 QQ 规则增长） ----------------

/** 密友统计：since=成为好友的时间戳；points=密友值；day/todayGain=当日增量（QQ 每日有上限） */
interface BondStat {
  since: number;
  points: number;
  day: string;
  todayGain: number;
}

/** QQ 规则：互发一条消息密友值 +2，每日通过聊天最多 +20 分 */
const BOND_MSG_POINTS = 2;
const BOND_DAILY_CAP = 20;
const lsBondKey = (contactId: string) => `qq-bond:${contactId}`;

function saveBondStat(contactId: string, s: BondStat): void {
  try {
    kvSet(lsBondKey(contactId), s);
  } catch {
    // 持久化失败忽略
  }
}

/** 读取密友统计；首次（或数据缺失）时从 0 开始建档（成为好友天数/密友值初始都是 0） */
function loadBondStat(contactId: string): BondStat {
  try {
    const p = kvGet<Partial<BondStat>>(lsBondKey(contactId));
    if (p && typeof p === 'object') {
      if (typeof p.since === 'number' && typeof p.points === 'number') {
        return { since: p.since, points: p.points, day: p.day ?? '', todayGain: p.todayGain ?? 0 };
      }
    }
  } catch {
    // 忽略损坏数据，重新建档
  }
  const fresh: BondStat = { since: Date.now(), points: 0, day: '', todayGain: 0 };
  saveBondStat(contactId, fresh);
  return fresh;
}

/** 成为好友天数：建档当天为第 0 天，之后每天 +1（与 QQ 一致） */
function bondDays(s: BondStat): number {
  return Math.max(0, Math.floor((Date.now() - s.since) / 86_400_000));
}

/** 角色状态卡的好感锚定：QQ 密友值/好友天数一行提示（读取失败静默返回 null） */
function bondHintTextOf(contactId: string): string | null {
  try {
    const s = loadBondStat(contactId);
    return `QQ密友值 ${s.points}，成为好友第 ${bondDays(s)} 天`;
  } catch {
    return null;
  }
}

/** 聊天互动增加密友值（+2/条，每日上限 20，当天隔天自动重置） */
function addBondPoints(contactId: string, n: number): void {
  const s = loadBondStat(contactId);
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today) {
    s.day = today;
    s.todayGain = 0;
  }
  if (s.todayGain >= BOND_DAILY_CAP) return;
  const gain = Math.min(n, BOND_DAILY_CAP - s.todayGain);
  s.todayGain += gain;
  s.points += gain;
  saveBondStat(contactId, s);
}

/** 选择说说/背景图片：读文件 → 压缩到最长边 max 的 JPEG dataURL（避免 localStorage 超限，默认 1280，表情用 240）；
 *  GIF 动图直通原始 dataURL（canvas 重绘会丢帧变静态图）。
 *  第二十九轮修复「上传不了图片」：解码/压缩失败时回退原始 dataURL（不再静默返回空串/原图硬塞），
 *  完全失败才 reject——上层 stageImageFiles 会 toast 提示，不再毫无反应 */
function compressImageFile(file: File, max = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      if (!raw) {
        reject(new Error('图片读取失败'));
        return;
      }
      // GIF 动图直通：不经 canvas（重绘会只保留第一帧）
      if (file.type === 'image/gif' || /^data:image\/gif/i.test(raw)) {
        resolve(raw);
        return;
      }
      const viaRaw = () => {
        // 兑底：仅当浏览器已证明能解码（Image 成功但 canvas 失败）时才存原始 dataURL
        if (raw.startsWith('data:image/')) resolve(raw);
        else reject(new Error('不支持的图片格式'));
      };
      // 第三十轮「上传的图片不显示」同款修复（与 album.tsx/wechat.tsx 同步）：
      // Image 解码失败（HEIC 等）不再原样保存死图，先试 createImageBitmap，仍失败明确 reject
      const viaBitmap = () => {
        if (typeof createImageBitmap !== 'function') {
          reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG'));
          return;
        }
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .then((bmp) => {
            try {
              const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(bmp.width * scale));
              canvas.height = Math.max(1, Math.round(bmp.height * scale));
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('图片解析失败'));
                return;
              }
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
              try {
                bmp.close();
              } catch {
                /* close 失败不影响 */
              }
              const out = canvas.toDataURL('image/jpeg', 0.82);
              if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
              else reject(new Error('图片解析失败'));
            } catch {
              reject(new Error('图片解析失败'));
            }
          })
          .catch(() => reject(new Error('该图片格式无法显示（如 HEIC），请改用 JPG/PNG')));
      };
      const img = new window.Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            viaRaw();
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', 0.82);
          if (typeof out === 'string' && out.startsWith('data:image/') && out.length > 22) resolve(out);
          else viaRaw();
        } catch {
          viaRaw();
        }
      };
      img.onerror = () => viaBitmap();
      img.src = raw;
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 会话列表时间：HH:mm / 昨天 / 周X / M/D / YYYY/M/D（QQ 列表样式，久远显示完整年） */
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
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 聊天时间分隔：HH:mm / 昨天 HH:mm / 星期X HH:mm / M月D日 HH:mm */
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
  if (ts >= weekAgo.getTime()) return `星期${'日一二三四五六'[d.getDay()]}${hm}`;
  const y = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日${hm}`;
}

/** 100-e AI 文字升级语音条的告知规则（aiVoiceOn=true 时随 buildPersonaPrompt extraRules 注入）：
 *  AI 语音频率开关开启（非「关闭」档）的会话里，AI 的普通文字消息在投递时会按频率静默升级成语音条
 *  （deliverAiMsg → decideAiVoiceMessage，见 @/lib/ios/ai-voice）——规则不告知的话，AI 说
 *  「我给你发条语音」时系统并不会真的发语音条。开关关闭（off，永不升级）时零注入 */
const AI_VOICE_DELIVERY_RULE =
  '（你的文字消息有时会以语音条的形式送达对方——这是正常的送达方式，不用在意；但不要在正文里说「我给你发条语音」这类话，也不要主动承诺发语音，用文字自然聊就好。）';

/** 联系人 AI 人设（QQ 聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  actionDescOn：动作描写开关（开启注入 *...* 格式约定、关闭注入显式禁令，见 @/lib/action-desc）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况）；
 *  aiVoiceOn：AI 语音频率开关（100-e，开启时告知「文字消息可能以语音条送达」，见 AI_VOICE_DELIVERY_RULE） */
function buildPersonaPrompt(peer: ContactRecord, me: QQUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, actionDescOn: boolean, npcExtra?: NpcPromptExtra | null, aiVoiceOn?: boolean): string {
  // 名字/昵称区分：AI 称呼用户按全局设置（默认用名字「凡凡」，用户选「用昵称称呼」才用「凑凑」）；
  // 用户规则：AI 永远不知道机主的昵称——人设只注入真称呼名（真名），不注入任何昵称信息
  const mode = useSettings.getState().addressMode;
  // 多账号（用户规则二.2）：小号/匿名号侧不再注入任何大号身份/关系信息（【用户的另一个身份】段已移除）
  const accId = activeAccountIdOf('qq');
  // v63 全局预设管理器：QQ 沉浸规则接入注册表（可开关/可编辑；亲属卡教学仍按 familyCard=false 区分）
  const richBlock = (() => {
    const rich = buildRichRules(stickersOn ? stickers : [], { familyCard: false });
    if (rich.length === 0) return '';
    return promptTextOf('qq-rich-rules', {}, rich.join('\n')) ?? '';
  })();
  // v65：QQ 沉浸规则整块走 qq-rules 合并组（与微信同构）——组关闭=QQ 不再注入任何沉浸规则；
  // 组编辑=编辑版大模板整块接管（{{richRules}} 填入当前表情包动态规则）；默认=原逐条组装（零破坏）
  const qqRuleParts = promptGroupParts('qq-rules', { richRules: richBlock }, () => [
      // v71：qq-sticker-recv（对方表情包回应规则）按用户要求整条移除，不再注入
      // 内置小表情 [微笑] 代码约定（开关开启才注入；用户点面板内置表情即以此格式入历史，AI 也可同格式回复）
      ...(stickersOn ? [promptRule('qq-emoji-code', EMOJI_CODE_RULE) ?? ''] : []),
      // 100-e QQ 没有亲属卡功能：亲属卡教学不下发（opts.familyCard=false，与微信区分）
      ...richBlock.split('\n'),
      ...(stickersOn ? [] : [promptRule('qq-sticker-off', STICKER_OFF_RULE) ?? '']),
      ...(actionDescOn
        ? [promptRule('qq-action-desc', ACTION_DESC_RULE) ?? '']
        : [promptRule('qq-action-desc-off', ACTION_DESC_OFF_RULE) ?? '']),
      // 100-e 文字升级语音条告知（开关开启才注入，off 零注入）
      ...(aiVoiceOn ? [promptRule('qq-ai-voice', AI_VOICE_DELIVERY_RULE) ?? ''] : []),
    ].filter(Boolean));
  return buildPersonaSystemPrompt(peer, {
    channel: 'QQ',
    userName: addressNameOf(me, mode),
    ownerName,
    accountId: accId,
    // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取）
    multiApp: getMemSettings(peer.id).share,
    ...npcExtra,
    extraRules: qqRuleParts ?? [],
  });
}

// ---------------- 通用小部件 ----------------

/** QQ 头像：默认圆形（有图用图，无图蓝底「Q」字兜底）；shape='rounded' = 圆角方形
 *  （显示设置 › 头像样式，仅聊天页传入；其余调用点保持 QQ 原生圆形） */
function QqAvatar({
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
  const radius = shape === 'rounded' ? Math.max(4, Math.round(size * 0.11)) : size / 2;
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius };
  if (src) {
    // draggable=false：防止按住头像拖动触发原生图片拖拽，避免打断聊天页右滑手势
    return <img src={src} alt={alt} draggable={false} className="shrink-0 bg-muted object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#B9D9F3] font-semibold text-white"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      Q
    </div>
  );
}

/** 显示设置元信息适用性：系统类胶囊（sys/notice/拉黑申请）与已撤回消息不参与已读/时间显示 */
const qqMetaOk = (m: QQMsg) => !m.recalled && m.kind !== 'sys' && m.kind !== 'notice' && m.kind !== 'blockreq';

/** 显示设置 › 已读回执：我发消息 = 我读了 TA 的全部未读消息（append 前统一走这里，纯函数） */
const qqMarkPeerRead = (list: QQMsg[]): QQMsg[] =>
  list.map((x) => (x.role === 'peer' && x.unread ? { ...x, unread: false } : x));

/** 元信息小字统一样式（已读未读 / 时间）；已读浅灰 / 未读深灰（用户指定：未读弃品牌色），
 *  时间同样灰色（用户指定：弃继承正文黑）——与已读同浅灰，深色模式自适应。
 *  气泡下：nowrap 单行永不内部折行；头像下用 avatar 版（无 nowrap——StackFitText 兜底换行需要），
 *  超宽先缩字、放不下按空格/自然断点堆叠（日期一行、时间一行），绝不裁字 */
const qqMetaText = 'whitespace-nowrap text-[10px] leading-[1.35]';
const qqMetaAvatarText = 'text-[10px] leading-[1.35]';
const qqMetaReadCls = 'text-black/35 dark:text-white/40';
const qqMetaUnreadCls = 'text-black/60 dark:text-white/75';
const qqMetaTimeCls = 'text-black/35 dark:text-white/40';

/** 显示设置 › 已读未读 + 时间：头像下方上下两行（已读未读在上、时间在下）。
 *  用户指定：文字超宽时字号自动变小、不向屏幕内侧延伸；对齐沿袭原锚定边（我的右对齐、TA 的左对齐）。
 *  长日期模板（yyyy/MM/dd HH:mm 等）缩到下限仍放不下时按空格/自然断点拆行堆叠，绝不裁字 */
function QqMetaUnderAvatar({ m, cfg }: { m: QQMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'avatar' && qqMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'avatar' && qqMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col gap-y-[1px] leading-none self-stretch ${
        m.role === 'me' ? 'text-right' : 'text-left'
      }`}
    >
      {showRead && (
        <StackFitText
          testId={`qq-read-${m.id}`}
          className={`block w-full ${qqMetaAvatarText} ${m.unread ? qqMetaUnreadCls : qqMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </StackFitText>
      )}
      {showTime && (
        <StackFitText
          testId={`qq-time-${m.id}`}
          className={`block w-full ${qqMetaAvatarText} ${qqMetaTimeCls}`}
        >
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
function QqMetaUnderBubble({ m, cfg }: { m: QQMsg; cfg: ChatDisplayConfig }) {
  const showRead = cfg.readEnabled && cfg.readPosition === 'bubble' && qqMetaOk(m);
  const showTime = cfg.timeEnabled && cfg.timePosition === 'bubble' && qqMetaOk(m);
  if (!showRead && !showTime) return null;
  return (
    <span
      className={`mt-[3px] flex flex-col self-stretch gap-y-[1px] leading-none ${
        m.role === 'me' ? 'items-start' : 'items-end'
      }`}
    >
      {showRead && (
        <span
          data-testid={`qq-read-${m.id}`}
          className={`${qqMetaText} ${m.unread ? qqMetaUnreadCls : qqMetaReadCls}`}
        >
          {readTextOf(cfg, m.unread === true)}
        </span>
      )}
      {showTime && (
        <span data-testid={`qq-time-${m.id}`} className={`${qqMetaText} ${qqMetaTimeCls}`}>
          {fmtMsgTime(m.time, cfg.timeFormat)}
        </span>
      )}
    </span>
  );
}

/** 引用卡迷你缩略图（Task 30）：被引用的图片/表情在 QQ 引用卡里显示 36px 小图——
 *  加载失败自动隐藏（引用卡退回纯文字行，quote.content 兜底可读） */
function QqQuoteThumb({ src, mine }: { src: string; mine: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt="引用图片"
      data-testid="qq-quote-thumb"
      draggable={false}
      className={`h-9 w-9 shrink-0 rounded-[6px] object-cover ${mine ? 'bg-white/15' : 'bg-black/[0.06] dark:bg-white/10'}`}
      onError={() => setFailed(true)}
    />
  );
}

/** 居中 Toast（自动消失） */
function QqToast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
      {text}
    </div>
  );
}

/** 页头（消息/联系人/动态共用）：左圆头像 + 标题（消息页带在线状态），右侧动作 */
function QqHeader({
  user,
  title,
  subtitle,
  onAvatar,
  action,
  retro = false,
}: {
  user: QQUser;
  title: string;
  subtitle?: React.ReactNode;
  onAvatar: () => void;
  action?: React.ReactNode;
  /** 古早主题（MainScreen 下发）：头部容器换银灰拟物导航条（rt-bar） */
  retro?: boolean;
}) {
  return (
    /* qq-head：QQ 页面头部（头像+大标题+右上按钮）锚点 */
    <div className={`qq-head flex items-center gap-3 px-4 pb-2 pt-1 ${retro ? 'rt-bar' : ''}`}>
      <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-70">
        <QqAvatar src={user.avatar} alt={user.name} size={44} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[20px] font-semibold leading-tight">{title}</div>
        {subtitle ?? null}
      </div>
      {action ?? null}
    </div>
  );
}

/** 打卡 + 状态 pills（深色半透明玻璃、白字、缩小版；个人中心抽屉与联系人页封面共用，打卡状态 localStorage 共享） */
function QqCheckinPills({ testidPrefix, onToast }: { testidPrefix: string; onToast: (m: string) => void }) {
  const [checkin, setCheckin] = useState<{ last: string; streak: number }>(() => {
    try {
      const p: unknown = kvGet(LS_QQ_CHECKIN);
      if (p && typeof p === 'object') {
        const rec = p as { last?: unknown; streak?: unknown };
        if (typeof rec.last === 'string' && typeof rec.streak === 'number') return { last: rec.last, streak: rec.streak };
      }
    } catch {
      // 忽略
    }
    return { last: '', streak: 0 };
  });
  const checkedToday = checkin.last === localDateKey();
  // 当天首次点击记为已打卡并累计连续天数；断签重新从 1 开始
  const doCheckin = () => {
    if (checkedToday) {
      onToast('今天已经打过卡啦');
      return;
    }
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const streak = checkin.last === localDateKey(yest) ? checkin.streak + 1 : 1;
    const next = { last: localDateKey(), streak };
    setCheckin(next);
    try {
      kvSet(LS_QQ_CHECKIN, next);
    } catch {
      // 忽略
    }
    onToast(`打卡成功，已连续 ${streak} 天`);
  };
  return (
    <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid={`${testidPrefix}-checkin`}
        onClick={doCheckin}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        {checkedToday ? (
          <Flame className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <CalendarDays className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        )}
        {checkedToday ? `已打卡 ${checkin.streak}天` : '打卡'}
      </button>
      <button
        type="button"
        data-testid={`${testidPrefix}-status`}
        onClick={() => onToast('状态暂未开放')}
        className="flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3.5 text-[13px] font-medium text-white backdrop-blur-md transition-transform active:scale-95"
      >
        <SmilePlus className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
        状态
      </button>
    </div>
  );
}

/** 在线状态行（消息页头像旁：绿点 + 在线 - WiFi） */
function OnlineBadge() {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[12px] text-black/45 dark:text-white/45">
      <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#26C84D]" aria-hidden="true" />
      在线 - WiFi
    </div>
  );
}

/** 搜索框（QQ 灰色胶囊） */
function QqSearch({
  value,
  onChange,
  placeholder = '搜索',
  liquid = false,
  retro = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 液态玻璃主题：搜索胶囊换 .lg-search 玻璃质感（tabs 页传入；设置页等不传保持原样） */
  liquid?: boolean;
  /** 古早主题：搜索胶囊换 .rt-search 白底内凹（6px 圆角） */
  retro?: boolean;
}) {
  return (
    /* qq-search：QQ 搜索框锚点（自定义 CSS 示例模板可改胶囊底色/圆角） */
    <div
      className={
        liquid
          ? 'qq-search flex h-[36px] items-center gap-1.5 rounded-full lg-search px-3'
          : retro
          ? 'qq-search flex h-[36px] items-center gap-1.5 rt-search px-3'
          : 'qq-search flex h-[36px] items-center gap-1.5 rounded-full bg-black/[0.05] px-3 dark:bg-white/[0.08]'
      }
    >
      <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
      />
    </div>
  );
}

// ---------------- 登录页 ----------------

function LoginScreen({ onLogin, slot, onBack }: { onLogin: (u: QQUser) => void; slot?: PhoneAccount | null; /** 提供时（账号与安全页「登录小号」入口）：左上角变返回而非退出 QQ */ onBack?: () => void }) {
  const closeApp = useUI((s) => s.closeApp);
  // mode account：账号密码登录（QQ号/QID/邮箱 + QQ密码）；phone：手机号登录（+86 + QQ密码）
  const [mode, setMode] = useState<'account' | 'phone'>('account');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  // 小号/匿名号槽位（Task 40 修正）：登录墙绑定当前槽位——预填该账号档案的登录账号（用户只需输密码），
  // 避免在 A 小号的登录墙里误登 B 的账号密码导致登录态串槽（切号页显示错账号/再切回要求重登）
  const [slotIdShown, setSlotIdShown] = useState('');
  // 槽位显示名（Task 40-S）：与登录后 QQ 内的名字同口径（档案展示名，昵称优先）
  const [slotNameShown, setSlotNameShown] = useState('');
  useEffect(() => {
    if (!slot) return;
    let alive = true;
    void (async () => {
      const all = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
      if (!alive) return;
      const profile = all.find(
        (c) => c.kind === 'user' && (c.altOf === slot.id || c.id === slot.ownerContactId),
      );
      if (profile && socialNameOf(profile).trim()) setSlotNameShown(socialNameOf(profile).trim());
      const id = profile?.qqId?.trim() || profile?.phone?.trim() || profile?.wechatId?.trim() || '';
      if (alive && id) {
        setSlotIdShown(id);
        setAccount((a) => (a.trim() ? a : id));
      }
    })();
    return () => {
      alive = false;
    };
  }, [slot]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const canSubmit = account.trim().length > 0 && password.length > 0 && agreed && !busy;

  const submit = async () => {
    if (!agreed) {
      setError('请先勾选同意服务协议和隐私政策');
      return;
    }
    if (account.trim().length === 0 || password.length === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      // 小号/匿名号槽位：绑定登录——只认本槽位档案的账号密码（Task 40 修正）
      if (slot) {
        const alt = await loginAltSlot('qq', slot, account.trim(), password);
        if (alt.ok) {
          onLogin({
            id: alt.user.id,
            name: alt.user.name,
            realName: alt.user.realName,
            nickname: alt.user.nickname,
            avatar: alt.user.avatar,
            qqId: alt.user.qqId,
            phone: alt.user.phone,
            persona: alt.user.persona,
            // Task 41：altOf 必须透传——根组件据此切账号作用域 + 记登录历史
            altOf: alt.user.altOf,
          });
          return;
        }
        setError(alt.error);
        return;
      }
      const rec = await loginQQ(mode === 'phone' ? 'phone' : 'account', account.trim(), password);
      if (rec.ok) {
        onLogin({
          id: rec.user.id,
          name: rec.user.name,
          realName: rec.user.realName,
          nickname: rec.user.nickname,
          avatar: rec.user.avatar,
          qqId: rec.user.qqId,
          phone: rec.user.phone,
          persona: rec.user.persona,
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

  const bottomEntries =
    mode === 'account'
      ? [
          { key: 'phone', label: '手机号登录', icon: <Smartphone className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('phone') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ]
      : [
          { key: 'account', label: '账密登录', icon: <CircleUser className="h-6 w-6" strokeWidth={1.8} />, action: () => setMode('account') },
          { key: 'other', label: '其他登录方式', icon: <User className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('其他登录方式暂未开放') },
          { key: 'reg', label: '注册账号', icon: <Plus className="h-6 w-6" strokeWidth={1.8} />, action: () => showToast('注册账号暂未开放，请在「联系人」App 配置账号') },
        ];

  return (
    <div className="relative flex h-full w-full flex-col bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] pt-[54px] text-[#1F2329] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38] dark:text-white">
      {/* 顶部：关闭/返回 + 帮助（内嵌登录小号时为返回） */}
      <div className="flex h-11 items-center justify-between px-4">
        <button
          type="button"
          aria-label={onBack ? '返回' : '关闭QQ'}
          data-testid={onBack ? 'qq-login-back' : 'qq-login-close'}
          onClick={() => (onBack ? onBack() : closeApp())}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="text-[16px] text-black/70 active:opacity-60 dark:text-white/70"
          onClick={() => showToast('帮助暂未开放')}
        >
          帮助
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8">
        <h1 className="mt-12 text-center text-[30px] font-bold tracking-wide">
          {mode === 'account' ? '账号密码登录' : '手机号登录'}
        </h1>

        {/* 小号/匿名号槽位：明示当前登录身份 + 档案账号（Task 40 修正）；退出后的自由登录墙无槽位不显示（Task 41） */}
        {slot && (
          <p data-testid="qq-login-slot" className="mt-2.5 text-center text-[13.5px] leading-relaxed text-black/45 dark:text-white/45">
            当前账号：{slotNameShown || slot.name?.trim() || (slot.kind === 'anon' ? '匿名账号' : '小号')}
            {slotIdShown ? `（${slotIdShown}）` : ''}
          </p>
        )}
        {mode === 'phone' && (
          <p className="mt-4 text-center text-[15px] text-black/40 dark:text-white/40">未注册手机号通过验证后将自动注册</p>
        )}

        {/* 输入卡（白色胶囊） */}
        <div className="mt-12 space-y-4">
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            {mode === 'phone' && (
              <span className="mr-3 flex shrink-0 items-center gap-1 text-[20px] font-semibold">
                +86
                <svg viewBox="0 0 12 8" className="h-2.5 w-3.5 text-black/50 dark:text-white/50" aria-hidden="true">
                  <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
            )}
            <input
              data-testid="qq-login-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={mode === 'account' ? '输入QQ号/QID/邮箱' : '输入手机号码'}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode={mode === 'phone' ? 'tel' : 'text'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
          <div className="flex h-[56px] items-center rounded-[16px] bg-white px-5 shadow-[0_2px_10px_rgba(31,35,41,0.04)] dark:bg-white/[0.12]">
            <input
              data-testid="qq-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder={mode === 'account' ? '输入QQ密码' : '输入QQ密码'}
              className="h-full w-full bg-transparent text-[17px] outline-none placeholder:text-black/25 dark:placeholder:text-white/30"
            />
          </div>
        </div>

        {mode === 'account' && (
          <button
            type="button"
            className="mt-5 text-[15px] font-medium text-[#1E6FFF] active:opacity-60"
            onClick={() => showToast('密码找回暂未开放，请到「联系人」App 查看账号密码')}
          >
            找回密码
          </button>
        )}

        {error && (
          <p data-testid="qq-login-error" className="mt-4 text-center text-[13px] text-red-500">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="qq-login-submit"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mt-8 block h-[52px] w-full rounded-full text-[18px] font-medium text-white transition-colors ${
            canSubmit ? 'active:brightness-95' : 'opacity-45'
          }`}
          style={{ backgroundColor: canSubmit ? QQ_BLUE : '#7FCDF8' }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              正在登录…
            </span>
          ) : mode === 'account' ? (
            '登 录'
          ) : (
            '验证并登录'
          )}
        </button>

        {/* 协议勾选 */}
        <button
          type="button"
          data-testid="qq-login-agree"
          aria-pressed={agreed}
          onClick={() => {
            setAgreed((v) => !v);
            setError('');
          }}
          className="mx-auto mt-5 flex max-w-[300px] items-start gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${
              agreed ? 'border-transparent' : 'border-black/25 dark:border-white/35'
            }`}
            style={agreed ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {agreed && (
              <svg viewBox="0 0 12 10" className="h-2.5 w-3 text-white" aria-hidden="true">
                <path d="M1 5.2 4.2 8.4 11 1.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="text-[13px] leading-[18px] text-black/45 dark:text-white/45">
            已阅读并同意<span className="text-[#1E6FFF]">服务协议</span>和
            <span className="text-[#1E6FFF]">隐私政策</span>
            {mode === 'phone' ? '及' : ''}
            {mode === 'phone' && <span className="text-[#1E6FFF]">运营商服务条款</span>}
          </span>
        </button>
      </div>

      {/* 底部三个圆圈入口 */}
      <div className="flex items-start justify-center gap-10 pb-9 pt-4">
        {bottomEntries.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={e.action}
            data-testid={`qq-login-entry-${e.key}`}
            className="flex w-[80px] flex-col items-center gap-2"
          >
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full border border-black/12 text-black/60 dark:border-white/20 dark:text-white/60">
              {e.icon}
            </span>
            <span className="whitespace-nowrap text-[12px] text-black/60 dark:text-white/60">{e.label}</span>
          </button>
        ))}
      </div>

      {toast && <QqToast text={toast} />}
    </div>
  );
}

// ---------------- 表情：聊天面板 + 表情管理页（qq-stickers 存储，微信端同构） ----------------

/** QQ 表情添加表单（面板/管理页共用；蓝色主题） */
function QqStickerAddForm({
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
            className={`h-8 rounded-full px-4 text-[13px] ${tab === k ? 'text-white' : 'bg-black/[0.05] text-black/60 dark:bg-white/10 dark:text-white/60'}`}
            style={tab === k ? { backgroundColor: QQ_BLUE } : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 flex h-[96px] w-full items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-black/20 bg-[#F6F7F8] text-[13px] text-black/40 active:bg-black/[0.05] dark:border-white/20 dark:bg-white/[0.06] dark:text-white/40"
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
          className="mt-3 h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
        />
      )}
      <input
        value={meaning}
        onChange={(e) => onMeaning(e.target.value)}
        placeholder="表情包的意思（AI 会据此理解并回复）"
        maxLength={20}
        className="mt-2 h-[44px] w-full rounded-[10px] border border-black/[0.08] bg-[#F6F7F8] px-3 text-[14px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.07] dark:placeholder:text-white/30"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="h-10 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-[10px] bg-black/[0.05] px-5 text-[15px] text-black/60 active:bg-black/[0.09] dark:bg-white/10 dark:text-white/60"
        >
          取消
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onPickFile(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** 图片消息气泡（单聊/群聊共用：固定像素上限，圆角同气泡） */
export function QqImageBubble({ src, testId }: { src: string; testId?: string }) {
  return (
    <img
      src={src}
      alt="图片消息"
      data-testid={testId}
      loading="lazy"
      decoding="async"
      className="max-h-[210px] w-auto max-w-[160px] rounded-[10px] object-cover"
    />
  );
}

/** 表情包消息气泡（单聊/群聊共用：点按提示表情含义） */
export function QqStickerBubble({
  url,
  meaning,
  onClick,
  testId = 'qq-sticker-bubble',
}: {
  url: string;
  meaning: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="active:opacity-80"
      title={meaning || '表情'}
    >
      <img
        src={url}
        alt={meaning ? `表情：${meaning}` : '表情'}
        className="max-h-[110px] w-auto max-w-[118px] rounded-[14px] object-contain"
        loading="lazy"
      />
    </button>
  );
}

/** 加号面板宫格（单聊/群聊共用：彩色圆角瓷贴 + 白色图标，对照新版 QQ 更多面板）。
 *  液态玻璃主题（liquid）：竖向单列列表——图标左 + 文字右，黑图标黑字（参考图同款）；群聊不传保持彩色宫格。
 *  古早主题（retro，第五十五轮）：无彩色瓷贴的平铺灰色图标 + 灰字（微信图1 同款语言）。
 *  第五十八轮（用户指定「加号面板功能图标变成古早主题图标」）：古早改用 RtPlus*
 *  实心剪影图标（与微信加号面板同语言，颜色走 --rt-ic-* 深浅自适应） */
export function QqPlusGrid({
  items,
  liquid = false,
  retro = false,
}: {
  items: Array<{ key: string; label: string; color: string; icon: React.ReactNode; retroIcon?: React.ReactNode; onClick: () => void }>;
  liquid?: boolean;
  retro?: boolean;
}) {
  if (liquid) {
    return (
      <div className="flex flex-col">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`qq-plus-${it.key}`}
            onClick={it.onClick}
            className="lg-menu-row flex h-[44px] w-full items-center gap-3.5 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
          >
            <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-black/80 dark:text-white/85 [&_svg]:h-[20px] [&_svg]:w-[20px]">{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>
    );
  }
  if (retro) {
    return (
      <div className="grid grid-cols-3 gap-y-6">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`qq-plus-${it.key}`}
            onClick={it.onClick}
            className="flex flex-col items-center gap-2 transition-transform active:scale-95"
          >
            {/* 古早（第五十八轮）：RtPlus* 实心剪影（白镂空细节，深浅自适应）；群聊等未提供时回退原线稿 */}
            <span className="flex h-[52px] w-[52px] items-center justify-center" aria-hidden="true">
              {retro ? (it.retroIcon ?? it.icon) : it.icon}
            </span>
            <span className="text-[12px] text-[#6A6E78] dark:text-white/60">{it.label}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-y-6">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-testid={`qq-plus-${it.key}`}
          onClick={it.onClick}
          className="flex flex-col items-center gap-2 transition-transform active:scale-95"
        >
          <span
            className="grid h-[52px] w-[52px] place-items-center rounded-[15px] text-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]"
            style={{ backgroundColor: it.color }}
            aria-hidden="true"
          >
            {it.icon}
          </span>
          <span className="text-[12px] text-[#1F2329] dark:text-white/85">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 输入框上方快捷功能条（QQ 端）图标/文案（用户指定「图标再美化，变成黑白色」）：
 * 黑白单色 lucide 线描（currentColor，浅色黑 / 深色白，尺寸由快捷条容器统一压 14px）；
 * 行为不在此定义——点击取加号面板同名项的 onClick（与面板完全等效，面板本身不动）。
 * 第五十八轮（用户指定「输入框上面的功能图标变成古早主题图标」）：每项携带
 * retroIcon 古早实心剪影（与加号面板同语言），古早主题时由快捷条选用。
 * 单聊与群聊共用（qq-group 仅命中其面板实际有的功能，其余自动排除）。
 */
export const QQ_QUICK_META: Record<string, { label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = {
  call: { label: '语音通话', icon: <Phone className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVoice /> },
  video: { label: '视频通话', icon: <Video className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVideo /> },
  rp: { label: '红包', icon: <Gift className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusRedPacket /> },
  transfer: { label: '转账', icon: <ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTransfer /> },
  loc: { label: '位置', icon: <MapPin className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusLocation /> },
  textcard: { label: '文字图片', icon: <Sparkles className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTextCard /> },
  together: { label: '一起听', icon: <Headphones className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTogether /> },
  express: { label: '快递', icon: <Package className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusExpress /> },
};

/**
 * 「文字图片」弹层（加号面板「文字图片」入口；Task 13 卡片版，无生图依赖，微信端 WxTextCardSheet 的 QQ 主题版）。
 * 输入可空——留空时 AI 按人设+最近聊天记录代笔（/api/textcard）；输入非空 = 用户代笔直接上卡；
 * 生成中状态 + 失败错误（留在弹层可重试）。
 */
function QqTextCardSheet({
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="qq-textcard-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#232529]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">写一张文字图片发给{charName}</p>
          <button
            type="button"
            aria-label="关闭文字图片"
            data-testid="qq-textcard-close"
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
          data-testid="qq-textcard-input"
          placeholder="写点想印在卡片上的字（留空 = AI 结合 TA 的人设和你们的聊天记录帮你写）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] text-[#1F2329] outline-none placeholder:text-black/30 focus:border-[#0099FF]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="qq-textcard-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="qq-textcard-submit"
          onClick={submit}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0099FF] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
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

/** QQ 聊天表情面板（点选 + 内嵌添加 + 管理删除；数据 qq-stickers；单聊/群聊共用同一套）。
 *  分组栏移到网格下方（对照真机 QQ：面板标签在下）；内置表情（QQ表情分组）点选不直接发送：
 *  走 onPickBuiltin 把 [微笑] 文字代码插入输入框，可与文字混排一起发；用户收藏贴纸仍点选直发 */
export function QqStickerPanel({
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
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('qq'));
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
    saveStickers('qq', next);
  };
  // Task 32：聊天页长按表情「添加到表情」后面板同步刷新（面板开着也能立即看到新表情）
  useEffect(() => {
    const syncStickers = () => {
      setList(loadStickers('qq'));
      setGroups(loadStickerGroups('qq'));
    };
    window.addEventListener('qq-stickers-changed', syncStickers);
    return () => window.removeEventListener('qq-stickers-changed', syncStickers);
  }, []);
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  /** 新建分组（分组栏「＋」胶囊）：持久化 + 自动选中新分组 */
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    const next = [...groups, g];
    setGroups(next);
    saveStickerGroups('qq', next);
    setActiveGroupId(g.id);
    onToast(`已新建分组「${g.name}」`);
  };
  const pickFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setPreview(await compressImageFile(f));
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

  /** 长按表情 → 预览卡（大图 + 名称 + 删除/取消），无需进管理模式即可删除 */
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
          ? /* 液态玻璃（用户指定）：去实底白与上边框，乳白强模糊玻璃面板（.dark 变体 CSS 内建） */
            'lg-sheet relative shrink-0 mx-2.5 mb-2.5 rounded-[24px]'
          : 'relative shrink-0 border-t border-black/[0.05] bg-white dark:border-white/[0.06] dark:bg-[#1B1C1F]'
      }
      style={{ animation: 'qqPanelIn 0.24s ease-out', ...(searchOpen ? { height: searchH > 0 ? searchH : 380 } : {}) }}
      data-testid="qq-sticker-panel"
    >
      {searchOpen ? (
        /* 网上表情搜索面板（替换式）：整体替换面板本体占面板原位，关闭/选中后恢复原面板 */
        <StickerSearchSheet
          app="qq"
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
              data-testid="qq-sticker-panel-search"
              onClick={openSearch}
              className="text-black/45 active:opacity-60 dark:text-white/45"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}
          {mode === 'grid' && !isBuiltinGroupId(activeGroupId) && list.some((s) => !s.builtin) && (
            <button
              type="button"
              data-testid="qq-sticker-panel-manage"
              onClick={() => setEditMode((v) => !v)}
              className="text-[13px] active:opacity-60"
              style={{ color: QQ_BLUE }}
            >
              {editMode ? '完成' : '管理'}
            </button>
          )}
          <button type="button" aria-label="收起表情面板" onClick={onClose} className="text-black/40 active:opacity-60 dark:text-white/40">
            <ChevronDown className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>
      {mode === 'grid' ? (
        <div className="h-[280px] overflow-y-auto px-3 pb-3 pt-1">
          {/* 内置表情=真机同款小表情（8列小尺寸）；用户收藏贴纸=大瓦片（4列） */}
          <div className={`grid ${activeGroupId === 'builtin' ? 'grid-cols-8 gap-1' : 'grid-cols-4 gap-2'}`}>
            {visible.map((st, i) => (
              <div key={st.id} className="relative">
                <button
                  type="button"
                  data-testid={`qq-sticker-panel-item-${i}`}
                  onClick={() => {
                    if (suppressPickRef.current) {
                      suppressPickRef.current = false;
                      return;
                    }
                    if (editMode) return;
                    // v62：官方小表情插入 [代码] 混排；内置包大贴纸与用户表情一样点选直接发送
                    if (isOfficialEmojiSticker(st)) onPickBuiltin?.(st);
                    else onPick(st);
                  }}
                  onPointerDown={onStickerPointerDown(st)}
                  onPointerMove={onStickerPointerMove}
                  onPointerUp={clearStickerPress}
                  onPointerCancel={clearStickerPress}
                  onPointerLeave={clearStickerPress}
                  className={
                    isOfficialEmojiSticker(st)
                      ? `flex h-10 w-full items-center justify-center overflow-hidden rounded-[8px] p-[3px] active:bg-black/[0.06]`
                      : `aspect-square w-full overflow-hidden rounded-[10px] active:bg-black/[0.06] p-1.5`
                  }
                  title={st.meaning || '表情'}
                >
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </button>
                {/* v62：用户表情=可点改意思的按钮；内置包贴纸=纯文本标签（常量不可改）；官方小表情不显 */}
                {!st.builtin && (
                  <button
                    type="button"
                    data-testid={`qq-sticker-meaning-${i}`}
                    onClick={() => setMeaningFor(st)}
                    className="mt-0.5 block h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 active:opacity-60 dark:text-white/40"
                  >
                    {st.meaning || '＋意思'}
                  </button>
                )}
                {st.builtin && st.groupId !== BUILTIN_STICKER_GROUP_ID && (
                  <p className="mt-0.5 h-4 w-full truncate text-center text-[10px] leading-4 text-black/40 dark:text-white/40">{st.meaning}</p>
                )}
                {editMode && !st.builtin && (
                  <button
                    type="button"
                    aria-label="删除表情"
                    data-testid={`qq-sticker-panel-del-${i}`}
                    onClick={() => commit(list.filter((x) => x.id !== st.id))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {/* 内置分组（官方小表情 + v62 内置表情包）不可添加（静态常量）；空占位与各自网格尺寸对齐 */}
            {isBuiltinGroupId(activeGroupId) ? (
              <span aria-hidden="true" className={activeGroupId === 'builtin' ? 'h-10 w-full' : 'aspect-square w-full'} />
            ) : (
              <button
                type="button"
                data-testid="qq-sticker-panel-add"
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
        <div className="px-4 pb-3 pt-1">
          <QqStickerAddForm
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
      {/* 分组栏（真机 QQ 同款：面板标签在网格下方）：毛玻璃胶囊分组名字 +「＋」新建分组 */}
      <StickerGroupBar testPrefix="qq" groups={groups} activeId={activeGroupId} onSelect={setActiveGroupId} onCreate={createGroup} />

      {/* 意思选择 UI（预设胶囊 + 自定义 + 不设置） */}
      {meaningFor && (
        <StickerMeaningPicker
          testPrefix="qq"
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

      {/* 长按表情预览卡（白卡大图 + 名称 + 红色删除；点遮罩取消） */}
      {pressSticker && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/45"
          data-testid="qq-sticker-preview"
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
                data-testid="qq-sticker-preview-del"
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

/** QQ 表情管理页（个人中心抽屉「表情」入口：网格 + 单张编辑[改意思/所属分组/删除] + 批量导入手机图片 + URL 添加自动识别意思 + 分组管理） */
function QqStickersPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [list, setList] = useState<Sticker[]>(() => loadStickers('qq'));
  const [groups, setGroups] = useState<StickerGroup[]>(() => loadStickerGroups('qq'));
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
    saveStickers('qq', next);
  };
  /** 当前分组下的表情（groupId 缺失/指向已删分组 → 归默认分组，防孤儿不可见） */
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const visible = useMemo(() => list.filter((s) => stickerGroupOf(s, groupIds) === activeGroupId), [list, groupIds, activeGroupId]);
  const applyGroups = (next: StickerGroup[]) => {
    setGroups(next);
    saveStickerGroups('qq', next);
  };
  const createGroup = (name: string) => {
    const g = makeStickerGroup(name);
    applyGroups([...groups, g]);
    onToast(`已新建分组「${g.name}」`);
  };

  /** 右上角「管理」：进入删除模式，点表情上的红色 × 直接删除（再点完成退出） */
  const [delMode, setDelMode] = useState(false);
  const delSticker = (st: Sticker) => {
    commit(list.filter((x) => x.id !== st.id));
    onToast('已删除表情');
    if (list.length <= 1) setDelMode(false);
  };

  /** FileList → 批量草稿项（压缩到 240 + 默认名：文件名中文优先，否则文件名去扩展名） */
  const filesToDrafts = async (files: FileList): Promise<BatchDraftItem[]> => {
    const drafts: BatchDraftItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const url = await compressImageFile(f, 240);
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

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#FAFAFC] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-stickers-page">
      <div className="shrink-0 bg-[#FAFAFC] pt-[54px] dark:bg-[#16171A]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-stickers-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">表情</div>
          {list.length > 0 ? (
            <button
              type="button"
              data-testid="qq-stickers-manage"
              onClick={() => setDelMode((v) => !v)}
              className="w-[46px] text-center text-[15px] text-[#0099FF] active:opacity-60 dark:text-[#4DB8FF]"
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
        testPrefix="qq"
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
            {visible.map((st, i) => (
              <button
                key={st.id}
                type="button"
                data-testid={`qq-stickers-item-${i}`}
                onClick={() => {
                  if (st.builtin) return; // 内置表情不可编辑/删除
                  if (delMode) {
                    delSticker(st);
                    return;
                  }
                  setEditing(st);
                  setEditMeaning(st.meaning);
                  setEditGroupId(st.groupId ?? DEFAULT_STICKER_GROUP_ID);
                }}
                className="relative rounded-[12px] p-1 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
              >
                <span className="flex aspect-square items-center justify-center overflow-hidden rounded-[8px]">
                  <img src={st.url} alt={st.meaning || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-black/55 dark:text-white/55">{st.meaning || '点此写意思'}</span>
                {delMode && !st.builtin && (
                  <span
                    aria-hidden="true"
                    data-testid={`qq-stickers-del-${i}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5455C] text-[11px] font-semibold text-white shadow"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:border-white/[0.06] dark:bg-[#1B1C1F]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="qq-stickers-upload"
            onClick={() => uploadRef.current?.click()}
            className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            从手机添加（可批量）
          </button>
          <button
            type="button"
            data-testid="qq-stickers-add-url"
            onClick={() => setBatchOpen(true)}
            className="h-11 rounded-[10px] bg-black/[0.06] px-5 text-[15px] text-black/70 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/70"
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
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setEditing(null)} data-testid="qq-stickers-edit">
          <div className="rounded-t-[14px] bg-[#FAFAFC] px-4 pb-8 pt-4 dark:bg-[#1C1D21]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[12px] bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.05)] dark:bg-[#1F2125]">
              <img src={editing.url} alt={editing.meaning || '表情'} className="h-full w-full object-contain" />
            </div>
            <input
              value={editMeaning}
              onChange={(e) => setEditMeaning(e.target.value)}
              maxLength={20}
              placeholder="表情包的意思（AI 会据此理解并回复）"
              data-testid="qq-stickers-edit-meaning"
              className="h-[46px] w-full rounded-[10px] border border-black/[0.08] bg-white px-3 text-[15px] outline-none placeholder:text-black/30 dark:border-white/10 dark:bg-[#1F2125] dark:placeholder:text-white/30"
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
                    data-testid={`qq-stickers-edit-group-${g.id === DEFAULT_STICKER_GROUP_ID ? 'my' : g.id}`}
                    onClick={() => setEditGroupId(g.id)}
                    className={`h-7 rounded-full border px-3 text-[12.5px] ${
                      on
                        ? 'border-[#0099FF]/40 bg-[#0099FF]/10 font-medium text-[#0099FF]'
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
                data-testid="qq-stickers-edit-del"
                onClick={() => {
                  commit(list.filter((x) => x.id !== editing.id));
                  setEditing(null);
                  onToast('已删除');
                }}
                className="h-11 rounded-[10px] bg-[#F5455C]/10 px-5 text-[15px] text-[#F5455C] active:bg-[#F5455C]/20 dark:bg-[#F5455C]/20"
              >
                删除
              </button>
              <button
                type="button"
                data-testid="qq-stickers-edit-save"
                onClick={() => {
                  if (!editing) return;
                  commit(list.map((x) => (x.id === editing.id ? { ...x, meaning: editMeaning.trim(), groupId: editGroupId || DEFAULT_STICKER_GROUP_ID } : x)));
                  setEditing(null);
                  onToast('已保存');
                }}
                className="h-11 flex-1 rounded-[10px] text-[15px] font-medium text-white active:brightness-95"
                style={{ backgroundColor: QQ_BLUE }}
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
        testPrefix="qq"
      />

      {/* 分组管理弹层：重命名/删除自定义分组（组内表情移回默认组），底部新建分组 */}
      {groupManageOpen && (
        <StickerGroupManageSheet
          testPrefix="qq"
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

// ---------------- 聊天页 ----------------

/** 申请解除拉黑卡片（40-a 双向：from='char' 角色发起（用户点同意/拒绝）；from='user' 用户发起（角色 AI 决策，仅展示状态）） */
function QqBlockReqCard({
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
const AI_QUOTE_COOL_MS = 5 * 60_000;

/** v71 分窗渲染（与微信同款）：初始只渲染最近 WINDOW_FIRST 条，上滑到顶按 WINDOW_STEP 向前扩——
 *  长会话几千条一次性 map 渲染是「点进聊天界面卡顿」的主因；时间分隔/组尾角/七彩序号
 *  都按消息原始索引计算，分窗渲染带原索引 → 行为与全量渲染完全一致 */
const WINDOW_FIRST = 120;
const WINDOW_STEP = 160;

function ChatPage({
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
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
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
          // 拍一拍系统行（Task 30）也进历史：AI 要知道被拍/拍过谁与文案（按双方名字序列化，无主语歧义）
          (!m.recalled && ((m.content || m.kind === 'image' || m.kind === 'textcard' || m.kind === 'voice' || m.kind === 'sticker' || m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'family' || m.kind === 'groupcard' || m.kind === 'relcard' || m.kind === 'pactcard' || m.kind === 'examcard' || m.kind === 'lettercard' || m.kind === 'call' || m.kind === 'location' || m.kind === 'song' || (m.kind === 'sys' && !!m.sys?.pat)) && !m.content.startsWith('〔') && !m.content.startsWith('（AI')))
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
        <div className="flex h-12 items-center gap-1 px-3 [&_button]:pointer-events-auto">
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
        {/* 名字区（本轮用户指定「名字在中间」）：flex-col items-center 让名字行与在线状态整体水平居中
            （原版 QQ 为左对齐；居中后与微信/信息聊天页同款视觉锚点） */}
        <div className="ml-1 flex min-w-0 flex-1 flex-col items-center">
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

// ---------------- 红包 / 转账（聊天加号面板 → 发送卡片 → 点击进详情） ----------------

/** 红包小图标（加号面板用，红色信封；单聊/群聊共用） */
export function RpIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 7.5c5 3.4 11 3.4 16 0" />
      <circle cx="12" cy="12.6" r="2.1" />
    </svg>
  );
}

/** 红包卡片上的奶油色企鹅剪影（对照 QQ 红包封面） */
function RpPenguin({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="#FBE7B2" />
      <ellipse cx="20" cy="22" rx="6.4" ry="7.6" fill="#E85B54" opacity="0.55" />
      <circle cx="15.9" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="24.1" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="16.4" cy="14" r="1.1" fill="#C9402F" />
      <circle cx="23.6" cy="14" r="1.1" fill="#C9402F" />
      <path d="M16 17.8c1.5 1.5 6.5 1.5 8 0 .8 1.3-1.5 3.6-4 3.6s-4.8-2.3-4-3.6z" fill="#E8912D" />
    </svg>
  );
}

/** 红包封面大企鹅剪影暗纹（纯剪影，供封面纹样层用） */
function RpPenguinSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="rgba(196,32,48,0.16)" />
      <ellipse cx="20" cy="23" rx="6.6" ry="8" fill="rgba(196,32,48,0.10)" />
      <path d="M11.5 29.5c1.6 2.8 5 4.7 8.5 4.7s6.9-1.9 8.5-4.7c-1.1 4.9-4.5 8.1-8.5 8.1s-7.4-3.2-8.5-8.1z" fill="rgba(196,32,48,0.16)" />
    </svg>
  );
}

/** 红包封面纹样层（对照真机封面：右侧细密斜线纹理 + 左上圆弧线 + 菱形描边 + 大企鹅剪影暗纹），绝对定位铺满父容器 */
function RpCoverPattern() {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* 右侧竖向斜线纹理区 */}
      <span
        className="absolute inset-y-0 right-0 w-[36%] opacity-75"
        style={{ backgroundImage: 'repeating-linear-gradient(112deg, rgba(255,235,200,0.13) 0px, rgba(255,235,200,0.13) 1.5px, transparent 1.5px, transparent 6.5px)' }}
      />
      {/* 左上大圆弧线 */}
      <span className="absolute -left-12 -top-16 h-48 w-48 rounded-full border-[3px] border-white/[0.09]" />
      {/* 中左菱形描边 */}
      <span className="absolute -left-3 top-[42%] h-20 w-20 rotate-45 rounded-[16%] border-[3px] border-white/[0.08]" />
      {/* 右侧大企鹅剪影暗纹 */}
      <RpPenguinSilhouette className="absolute -right-7 top-[24%] h-44 w-40" />
    </span>
  );
}

/** 聊天中的红包卡片（对照真机封面：企鹅+QQ字样+祝福语+右侧斜线纹理/圆弧/菱形/企鹅暗纹+底部亮红大弧+開/QQ红包；自己发的点开进详情，对方的先开箱） */
export function RedPacketBubble({ packet, showOpen, onClick }: { packet: MsgPacket; showOpen: boolean; onClick: () => void }) {
  const claimed = (packet.claims ?? []).length > 0;
  // 终态：已领取/已退回/已拒收/已过期（24h 未领取清算，剩余金额退回发起人）
  const settled = claimed || packet.status === 'returned' || packet.status === 'rejected' || packet.expired;
  // 终态（已领取/已退回/已拒收/已过期）→ 显示原状态文案；待领取中 → 有祝福语显示祝福语、没写祝福语显示「待领取」（与转账卡留言规则一致）
  const rpNote = settled
    ? packet.expired
      ? '已过期'
      : packet.status === 'returned'
      ? '已退回'
      : packet.status === 'rejected'
        ? '已拒收'
        : '已领取'
    : packet.note && packet.note.trim()
      ? packet.note
      : '待领取';
  return (
    <button
      type="button"
      data-testid="qq-rp-bubble"
      onClick={onClick}
      className="chat-card chat-card-rp chat-card-body relative block w-[176px] overflow-hidden rounded-[14px] text-left shadow-lg shadow-black/15 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)',
        // 领取/退还/拒收后卡片颜色变灰（对照真实 QQ：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`QQ红包 ${rpNote}${settled ? '（已处理）' : ''}`}
    >
      {/* 封面纹样 */}
      <RpCoverPattern />
      <div className="relative flex flex-col items-center px-3 pt-[18px]">
        <RpPenguin size={34} />
        <span className="mt-0.5 text-[10px] font-semibold tracking-[0.32em] text-[#FBE7B2]/90" aria-hidden="true">QQ</span>
        <p className="mt-3 line-clamp-2 min-h-[26px] text-center text-[16px] font-medium leading-snug text-[#FFF3D6] [text-shadow:0_1px_2px_rgba(180,30,40,0.28)]">{rpNote}</p>
      </div>
      {/* 底部亮红大弧形（椭圆上缘成拱）+ 開 / QQ红包 */}
      <div className="relative mt-2 h-[64px]">
        <span className="absolute left-1/2 top-[18px] h-[130px] w-[280px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
        {showOpen ? (
          <span className="absolute left-1/2 top-[13px] grid h-11 w-11 -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-md shadow-black/10" aria-hidden="true">
            <span className="text-[19px] font-bold leading-none text-[#D8332F]">開</span>
          </span>
        ) : (
          <span className="chat-card-label absolute inset-x-0 bottom-[9px] text-center text-[11px] font-medium tracking-[0.25em] text-[#FFE3C2]">QQ红包</span>
        )}
      </div>
    </button>
  );
}

/** 聊天中的转账卡片（蓝卡 圈↔/对勾/退还↩ + ¥金额 + 状态文案 + 底部「转账」；206px 与微信转账卡同宽；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入好友余额」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案，与微信端同规则）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（与微信端同规则）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实 QQ：终态卡褪色），退还卡圆图标换成↩ */
export function TransferBubble({ packet, mine, received, onClick }: { packet: MsgPacket; mine: boolean; received: boolean; onClick: () => void }) {
  const refunded = packet.status === 'returned';
  // 终态：已收款/已退还/已拒收/已过期（24h 未收款清算，退回发起人）
  const expired = packet.expired === true;
  // 终态（已收款/已退还/已拒收/已过期）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const settled = received || Boolean(packet.status) || expired;
  // 收款凭据卡（packet.receiptOf 有值）一律显示「已收款」——用户反馈：AI 转给我的钱，
  // 我收款后的凭据卡不能显示「已转入好友余额」（方向反了，微信端同步修）
  const status = expired
    ? '已过期'
    : refunded
      ? '已退还'
      : packet.status === 'rejected'
        ? '已拒收'
        : received
          ? packet.receiptOf
            ? '已收款'
            : mine
              ? '已转入好友余额'
              : '已收款'
          : mine
            ? '待对方收款'
            : '待你收款';
  return (
    <button
      type="button"
      data-testid="qq-transfer-bubble"
      onClick={onClick}
      className="chat-card chat-card-tr chat-card-body block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #29ABF2 0%, #0099FF 100%)',
        // 收款/退还/拒收/过期后卡片颜色变灰（对照真实 QQ：终态卡褪色）
        filter: received || packet.status || packet.expired ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ${fmtMoney(packet.amount)} 元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          {refunded || expired ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.4} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.6} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2.2} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[20px] font-semibold leading-tight text-white">¥{fmtMoney(packet.amount)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-transfer-bubble-status">{!settled && packet.note && packet.note.trim() ? packet.note : status}</span>
        </span>
      </div>
      <div className="chat-card-label border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">转账</div>
    </button>
  );
}

/** 聊天中的亲属卡卡片（金卡 礼物图标 + 标题/状态 + 底部「亲属卡」；AI 赠送 / 领取状态展示） */
function FamilyBubble({ fam, mine, peerName, onClick }: { fam: QQFamData; mine: boolean; peerName: string; onClick: () => void }) {
  const status = fam.rejected ? '已退回' : fam.claimed ? (mine ? '对方已领取' : '已领取') : mine ? '待对方领取' : '待你领取';
  return (
    <button
      type="button"
      data-testid="qq-family-bubble"
      onClick={onClick}
      className="chat-card chat-card-fam chat-card-body block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #F7D488 0%, #EDB95E 100%)',
        // 领取/退回后卡片颜色变灰（与微信亲属卡一致）
        filter: fam.claimed || fam.rejected ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`亲属卡 每月额度${fam.monthlyLimit}元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          <Gift className="h-5 w-5 text-white" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold leading-tight text-white">{mine ? `给${peerName}的亲属卡` : '收到一张亲属卡'}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-family-bubble-status">{status}</span>
        </span>
      </div>
      <div className="chat-card-label border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">亲属卡</div>
    </button>
  );
}

/**
 * 群聊邀请卡片（AI 主动建群/拉人时发出；QQ 蓝样式）：
 * pending = 副文案 + 接受/拒绝按钮（点「接受邀请」才进群）；accepted/rejected = 状态行（卡片本体不可点，不进群）。
 */
export function QqGroupCardBubble({
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
      data-testid="qq-group-card"
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#232426] ${rejected ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体不可点击进群（需求：点卡片不进群，点「接受邀请」才算进群）；进群入口只有接受按钮 */}
      <div className="flex w-full items-center gap-2.5 px-3 pb-2.5 pt-3 text-left">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[#0099FF]/10 dark:bg-[#0099FF]/20"
        >
          <Users className="h-5 w-5 text-[#0099FF]" strokeWidth={1.8} />
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
            data-testid="qq-group-card-reject"
            onClick={onReject}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="qq-group-card-accept"
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#0099FF] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
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

/** 聊天系统通知行（居中小图标 + 灰字 + 彩色尾词，如「xx领取了你的红包」） */
export function QQNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam'; pre: string; accent: string }) {
  return (
    <div className="mb-3 flex justify-center" data-testid="qq-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[12.5px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(168deg, #FC8163, #F2394E)' }}
          >
            <RpIcon className="h-[11px] w-[11px] text-white" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #29ABF2, #0099FF)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F7D488, #EDB95E)' }}
          >
            <Gift className="h-[10px] w-[10px] text-white" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0" style={{ color: icon === 'rp' ? '#F5455C' : icon === 'tr' ? '#0099FF' : '#E8912D' }}>
          {accent}
        </span>
      </span>
    </div>
  );
}

/** 发红包页（对照截图②：普通/拼手气/专属 tab + 单个金额 + 祝福语 + 封面 + 支付方式[余额/银行卡] + 大金额 + 塞钱进红包）。
 *  单聊/群聊共用：传入 members（群成员清单）即启用群模式 —— 普通红包支持多个个数、专属红包需从群成员里选收款人
 *  （packet 带上 toId/toName；群模式普通红包 count>1 时实际扣款 = 单个金额×个数，由调用方计） */
export function RedPacketCompose({ wallet, cards, onToast, onClose, onSend, members }: { wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void; members?: ContactRecord[] }) {
  const [tab, setTab] = useState<'normal' | 'lucky' | 'dedicated'>('normal');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('恭喜发财');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const [target, setTarget] = useState<ContactRecord | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const cnt = Math.min(100, Math.max(1, Math.round(parseFloat(count) || 1)));
  const total = num;
  const groupMode = Array.isArray(members) && members.length > 0;
  const ok = num > 0 && (tab !== 'lucky' || cnt >= 1) && (tab !== 'dedicated' || !groupMode || target != null);
  const tabLabel = (t: 'normal' | 'lucky' | 'dedicated'): string => (t === 'normal' ? '普通' : t === 'lucky' ? '拼手气红包' : '专属红包');
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="发红包" onBack={onClose} />
      {/* tab 行 */}
      <div className="flex shrink-0 items-center gap-7 px-6 pt-1">
        {(['normal', 'lucky', 'dedicated'] as const).map((t) => (
          <button key={t} type="button" data-testid={`qq-rp-tab-${t}`} onClick={() => setTab(t)} className="relative pb-2.5">
            <span className={`text-[16px] ${tab === t ? 'font-medium text-[#1F2329] dark:text-white' : 'text-black/45 dark:text-white/45'}`}>{tabLabel(t)}</span>
            {tab === t ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#F5455C]" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {/* 金额卡 */}
        <div className="flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <span className="text-[16px] text-[#1F2329] dark:text-white">{tab === 'lucky' ? '总金额' : '单个金额'}</span>
          <span className="flex items-center gap-2">
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="qq-rp-amount"
              className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="text-[16px] text-[#1F2329] dark:text-white">元</span>
          </span>
        </div>
        {(tab === 'lucky' || (groupMode && tab === 'normal')) ? (
          <div className="mt-2.5 flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
            <span className="text-[16px] text-[#1F2329] dark:text-white">红包个数</span>
            <span className="flex items-center gap-2">
              <input
                value={count}
                inputMode="numeric"
                onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                aria-label="红包个数"
                data-testid="qq-rp-count"
                className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none dark:text-white"
              />
              <span className="text-[16px] text-[#1F2329] dark:text-white">个</span>
            </span>
          </div>
        ) : null}
        {/* 专属红包收款成员（群模式限定：从群成员里选一个人领） */}
        {groupMode && tab === 'dedicated' ? (
          <button
            type="button"
            data-testid="qq-rp-target"
            onClick={() => setPickOpen(true)}
            className="mt-2.5 flex h-[62px] w-full items-center justify-between rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
          >
            <span className="text-[16px] text-[#1F2329] dark:text-white">指定成员</span>
            <span className="flex items-center gap-2">
              {target ? (
                <span className="flex items-center gap-1.5">
                  <QqAvatar src={target.avatar} alt={target.name} size={26} />
                  <span className="text-[15px] text-[#1F2329] dark:text-white">{target.name}</span>
                </span>
              ) : (
                <span className="text-[14px] text-black/35 dark:text-white/35">选择群成员</span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </span>
          </button>
        ) : null}
        {/* 祝福语 */}
        <div className="mt-2.5 flex h-[62px] items-center gap-3 rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 20))}
            placeholder="恭喜发财"
            aria-label="红包祝福语"
            data-testid="qq-rp-note"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        {/* 封面 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" onClick={() => onToast('红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">红包封面</span>
              <span className="mt-0.5 block text-[13px] text-black/35 dark:text-white/35">默认</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="border-t border-black/[0.04] dark:border-white/[0.06]" />
          <button type="button" onClick={() => onToast('领取更多红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">领取更多红包封面</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-rp-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 大金额 + 按钮 */}
        <div className="mt-10 text-center">
          <p className="text-[52px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white">
            <span className="mr-1 text-[30px] font-semibold align-[6px]" aria-hidden="true">¥</span>
            {num.toFixed(2)}
          </p>
          <button
            type="button"
            disabled={!ok}
            data-testid="qq-rp-send"
            onClick={() => {
              if (!ok) return;
              onSend({
                type: 'redpacket',
                amount: total,
                note: note.trim() || '恭喜发财',
                count: tab === 'lucky' || (groupMode && tab === 'normal') ? cnt : 1,
                mode: tab,
                claims: [],
                ...(groupMode && tab === 'dedicated' && target ? { toId: target.id, toName: target.name } : {}),
              }, methodId);
            }}
            style={{ backgroundColor: ok ? '#F5455C' : '#F8B9BE' }}
            className="mx-auto mt-6 block h-12 w-[240px] rounded-full text-[17px] font-medium text-white transition-colors duration-200 active:brightness-95"
          >
            塞钱进红包
          </button>
        </div>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[13px] text-black/30 dark:text-white/30">未领取的红包，将于24小时后发起退款</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
      {/* 指定成员选择 sheet（群模式专属红包：只有被选中的成员能领） */}
      {pickOpen && members ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setPickOpen(false)} data-testid="qq-rp-target-sheet">
          <div className="max-h-[62%] overflow-hidden rounded-t-[16px] bg-white dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-2 pt-4 text-[15px] font-medium text-[#1F2329] dark:text-white">选择指定成员（只有 TA 能领这个红包）</div>
            <div className="max-h-[52vh] overflow-y-auto pb-6">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-rp-target-${m.id}`}
                  onClick={() => {
                    setTarget(m);
                    setPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={m.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#1F2329] dark:text-white">{m.name}</span>
                  {target?.id === m.id ? <Check className="h-5 w-5 shrink-0 text-[#0099FF]" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 向好友转账页（对照截图①：转账给 头像/QQ号 + 金额卡 + 留言 0/12 + 支付方式[余额/银行卡] + 转账按钮 + 防诈提示） */
export function TransferCompose({ peer, wallet, cards, onToast, onClose, onSend }: { peer: ContactRecord; wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const ok = num > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="向好友转账" onBack={onClose} />
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center gap-3 px-1 py-2">
          <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-medium text-[#1F2329] dark:text-white">转账给 {peer.name}</p>
            <p className="mt-0.5 truncate text-[14px] text-black/40 dark:text-white/40">QQ号：{peer.qqId ?? '暂无'}</p>
          </div>
        </div>
        <div className="mt-3 rounded-[16px] bg-white px-5 pb-4 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">转账金额</p>
          <div className="mt-4 flex items-center gap-2 border-b border-black/[0.08] pb-5 dark:border-white/10">
            <span className="text-[40px] font-medium leading-none text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              aria-label="转账金额"
              data-testid="qq-transfer-amount"
              className="w-full bg-transparent text-[40px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <div className="mt-3.5 flex items-center gap-3 pb-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 12))}
              placeholder="添加转账留言"
              aria-label="转账留言"
              data-testid="qq-transfer-note"
              className="min-w-0 flex-1 bg-transparent text-[17px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="shrink-0 text-[15px] text-black/35 dark:text-white/35">{note.length}/12</span>
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-transfer-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-transfer-send"
          onClick={() => ok && onSend({ type: 'transfer', amount: num, note: note.trim() }, methodId)}
          className={`mx-auto mt-9 block h-[52px] w-[220px] rounded-[16px] text-[17px] font-medium text-white ${ok ? 'active:brightness-95' : ''}`}
          style={{ backgroundColor: ok ? QQ_BLUE : '#8AD4F7' }}
        >
          转账
        </button>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[14px] text-black/30 dark:text-white/30">请务必确认对方真实身份，警惕电信网络诈骗</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
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

/** 红包开箱弹窗（对照截图②：近全屏大红卡 + 封面纹样 + 发红包人 + 祝福语 + 大「開」+ 弹窗外关闭） */
export function RedPacketOpenModal({ senderName, avatar, note, onOpen, onClose, onRefund }: { senderName: string; avatar: string | null; note: string; onOpen: () => void; onClose: () => void; onRefund?: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包">
      <style>{'@keyframes qqRpModalIn{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}'}</style>
      <div
        className="relative h-[64vh] max-h-[600px] min-h-[430px] w-full max-w-[340px] overflow-hidden rounded-[22px] shadow-2xl"
        style={{ backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)', animation: 'qqRpModalIn 0.26s ease-out' }}
      >
        {/* 封面纹样 */}
        <RpCoverPattern />
        <div className="relative flex h-full flex-col items-center">
          <div className="h-[31%] shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={28} />
            <p className="text-[16px] text-[#FFEFD2]">{senderName}发出的红包</p>
          </div>
          <p className="mt-8 text-[32px] font-medium tracking-wide text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(180,30,40,0.3)]">{note}</p>
          <div className="flex-1" aria-hidden="true" />
          {/* 底部亮红大弧 + 開 */}
          <div className="relative h-[150px] w-full shrink-0">
            <span className="absolute left-1/2 top-[48px] h-[230px] w-[440px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
            <button
              type="button"
              data-testid="qq-rp-open"
              onClick={onOpen}
              className="absolute left-1/2 top-[24px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-lg shadow-black/15 transition-transform active:scale-95"
              aria-label="开红包"
            >
              <span className="text-[40px] font-bold leading-none text-[#D8332F]">開</span>
            </button>
          </div>
        </div>
      </div>
      {/* 卡片下方：退还 + 关闭（退还可把对方发的红包原路退回） */}
      <div className="absolute bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {onRefund ? (
          <button
            type="button"
            data-testid="qq-rp-refund"
            onClick={onRefund}
            className="flex h-11 items-center rounded-full border-2 border-white/70 bg-black/20 px-6 text-[15px] font-medium text-white/90 active:opacity-70"
          >
            退还
          </button>
        ) : null}
        <button type="button" aria-label="关闭" data-testid="qq-rp-close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border-2 border-white/70 text-white/90 active:opacity-60">
          <X className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/** 红包详情页（对照真机：全屏沉浸红头直达状态栏[导航+封面纹样+金色封套标+发送人+祝福语+金色金额] + 下方领取统计与列表，拼手气含手气最佳） */
function RedPacketDetailPage({ me, peer, msg, onBack, onToast }: { me: QQUser; peer: ContactRecord; msg: QQMsg; onBack: () => void; onToast: (m: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const senderName = mine ? me.name : peer.name;
  const avatar = mine ? me.avatar : peer.avatar;
  const claims = p.claims ?? [];
  const claimedTotal = claims.reduce((s, c) => s + c.amount, 0);
  const count = p.count ?? 1;
  const myClaim = claims.find((c) => c.name === me.name);
  const best = claims.length > 1 ? Math.max(...claims.map((c) => c.amount)) : -1;
  const fmtT = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 全屏沉浸红色头部（含状态栏区）：导航 + 封套标 + 发送人 + 祝福语 + 金额 */}
      <div
        className="relative shrink-0 px-3 pb-20 pt-[54px]"
        style={{ borderBottomLeftRadius: '46% 54px', borderBottomRightRadius: '46% 54px', backgroundImage: 'linear-gradient(172deg, #FD8A67 0%, #F5455C 58%, #EE3A50 100%)', boxShadow: '0 12px 26px rgba(214,52,66,0.25)' }}
      >
        <RpCoverPattern />
        <div className="relative flex h-11 items-center px-1">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium text-white">QQ红包</span>
          <button type="button" onClick={() => onToast('红包记录暂未开放')} className="ml-auto mr-1 text-[15px] text-white/95 active:opacity-60">红包记录</button>
        </div>
        <div className="relative mt-4 flex flex-col items-center" data-testid="qq-rp-detail-head">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#FBE7B2]/20 px-3 py-1 text-[12px] tracking-[0.2em] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/40" aria-hidden="true">
            <RpIcon className="h-3.5 w-3.5" />
            QQ红包
          </span>
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={34} />
            <p className="text-[18px] font-medium text-[#FFF3D6]">{senderName}发送的红包</p>
          </div>
          <p className="mt-2 text-[15px] text-[#FFE3C2]/85">{p.note}</p>
          <p className="mt-6 text-[48px] font-bold leading-none tracking-tight text-[#FFE9B8] [text-shadow:0_2px_8px_rgba(170,25,40,0.4)]" data-testid="qq-rp-detail-amount">
            <span className="mr-1 align-[6px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}
          </p>
          {myClaim ? (
            <span className="mt-3 rounded-full bg-[#FBE7B2]/20 px-3.5 py-1.5 text-[14px] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/35">收到的红包已存入余额</span>
          ) : p.expired ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-expired">红包已过期，剩余金额已退回</p>
          ) : p.status === 'returned' ? (
            /* L12：拼手气（count>1）被 AI 退回时 claims 已按 #32 清空（只退「总额-已领」），
               不能按全额宣称「已存入钱包」；单份退回才是全额入账；对方发的卡被退回则资金归对方 */
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-refunded">
              {mine
                ? count > 1
                  ? '红包已退回，未领取金额已退回钱包'
                  : '红包已退回，金额已存入钱包余额'
                : '红包已退回，金额已退还给对方'}
            </p>
          ) : p.status === 'rejected' ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-rejected">对方拒收了该红包</p>
          ) : mine && claims.length > 0 ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/75">好友领取后自动存入其余额</p>
          ) : null}
        </div>
      </div>
      <div className="relative -mt-10 flex-1 overflow-y-auto px-4 pb-8">
        <div className="rounded-[12px] bg-[#EDEEF0] px-4 py-2.5 dark:bg-white/[0.06]">
          <p className="text-[14px] text-black/45 dark:text-white/45" data-testid="qq-rp-detail-stat">
            {count}个红包，
            {p.expired
              ? '已过期'
              : p.status === 'returned'
              ? '已退回'
              : p.status === 'rejected'
                ? '已拒收'
                : claims.length >= count
                  ? '已领完'
                  : claims.length > 0
                    ? `已领${claims.length}个`
                    : '等待领取'}
            ，共{fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}元
          </p>
        </div>
        <div className="mt-2 overflow-hidden rounded-[14px] bg-white shadow-sm shadow-black/[0.04] dark:bg-[#232529]">
          {claims.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-black/35 dark:text-white/35">好友领取后将展示在这里</p>
          ) : (
            claims.map((c, i) => {
              const isBest = p.mode === 'lucky' && claims.length > 1 && c.amount === best;
              return (
                <div key={`${c.name}-${c.ts}-${i}`} className={`flex h-[64px] items-center gap-3 px-4 ${i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''}`}>
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[16px] text-[#1F2329] dark:text-white">
                      {c.name}
                      {isBest ? <span className="shrink-0 rounded bg-gradient-to-r from-[#F5B96A] to-[#E8912D] px-1.5 py-0.5 text-[10px] font-medium text-white" aria-hidden="true">手气最佳</span> : null}
                    </p>
                    <p className="text-[13px] text-black/35 dark:text-white/35">{fmtT(c.ts)}</p>
                  </div>
                  <span className={`shrink-0 text-[16px] ${isBest ? 'font-semibold text-[#E8912D] dark:text-[#F0B25E]' : 'text-[#1F2329] dark:text-white'}`}>{fmtMoney(c.amount)}元</span>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-black/35 dark:text-white/35">未领取的红包，将于24小时后发起退款；红包金额仅在本机演示环境流转。</p>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账卡片进入，对照微信收款页：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 收款按钮 + 退还提示） */
function TransferReceivePage({
  peer,
  msg,
  onBack,
  onAccept,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onAccept: (msgId: string) => void;
  onRefund: () => void;
}) {
  const p = msg.packet;
  if (!p) return null;
  const d = new Date(msg.time);
  const fmtFull = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]" data-testid="qq-tr-receive">
      {/* 顶部：仅返回键（对照收款页） */}
      <div className="flex h-11 shrink-0 items-center px-2">
        <button type="button" aria-label="返回" data-testid="qq-tr-receive-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-[#1F2329] active:bg-black/[0.06] dark:text-white">
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8">
        <div className="mt-[10vh] flex flex-col items-center">
          <Clock className="h-[76px] w-[76px] text-[#12B7F5]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-7 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-status">
            {peer.name}向你转账，待你收款
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-amount">
            <span className="mr-1 align-[5px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
        </div>
        <div className="mt-12 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
          </div>
          {p.note ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
              <span className="min-w-0 truncate text-[16px] text-[#1F2329] dark:text-white">{p.note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-12 pb-9">
        <button
          type="button"
          data-testid="qq-tr-receive-accept"
          onClick={() => onAccept(msg.id)}
          className="mx-auto block h-11 w-[62%] rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/40 dark:text-white/40">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#12B7F5] active:opacity-60" data-testid="qq-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 交易详情页（对照截图⑥：蓝圈对勾 + 收款文案 + 金额 + 查看余额 + 留言/时间）。
 *  退还态：琥珀圈↩ + 「你已退还/对方已退还」+ 退款时间行。
 *  receiverIsMe 由调用方按消息角色 + receiptOf + 旧数据配对推导：文案区分「你已收款 / XX已收款」；
 *  退还人：退还凭据卡自带 refundedBy，原卡按消息角色反推（我发的→对方退的；对方发的→我退的） */
function TransferDetailPage({ me, peer, msg, receiverIsMe, onBack, onToast, onAccept }: { me: QQUser; peer: ContactRecord; msg: QQMsg; receiverIsMe: boolean; onBack: () => void; onToast: (m: string) => void; onAccept: (msgId: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const incoming = !mine;
  const returned = p.status === 'returned';
  // 24h 过期清算终态：不可再收款，资金已退回发起人
  const expired = p.expired === true;
  const fmtFull = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="交易详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div className="mt-14 flex flex-col items-center">
          <span className={`grid h-[72px] w-[72px] place-items-center rounded-full border-[4px] ${returned || expired ? 'border-[#F6AC3D]' : 'border-[#12B7F5]'}`} aria-hidden="true">
            {returned || expired ? <Undo2 className="h-9 w-9 text-[#F6AC3D]" strokeWidth={2.6} /> : <Check className="h-9 w-9 text-[#12B7F5]" strokeWidth={3} />}
          </span>
          <p className="mt-6 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-line">
            {expired
              ? '转账已过期，资金已退回'
              : returned
              ? (p.refundedBy ?? (mine ? 'peer' : 'me')) === 'peer'
                ? '对方已退还'
                : '你已退还'
              : receiverIsMe
                ? '你已收款，资金已存入钱包余额'
                : mine
                  ? p.status === 'rejected'
                    ? '对方已拒收'
                    : p.received
                      ? `${peer.name}已收款`
                      : '转账成功，等待对方收款'
                  : incoming && !p.received && !p.status
                    ? `${peer.name}向你转账，待收款`
                    : `${peer.name}已收款`}
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-amount">
            <span className="mr-1 text-[26px] font-semibold align-[5px]" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
          {incoming && !p.received && !p.status && !expired ? (
            <button
              type="button"
              data-testid="qq-tr-detail-accept"
              onClick={() => {
                // 收款全部由父级 onAccept 完成（标记 received + 入钱包余额 + 追加接收卡片，与收款页主路径同一处理器）。
                // #28 这里不得再本地 gainToWallet：旧实现按钮内重复入账一次（潜伏双计）；当前详情页兑底入口
                // 只在收款后可达、本按钮不可达，仍按父级路径收敛并注释防未来接线回归
                onAccept(msg.id);
                onToast(`已收款 ${fmtMoney(p.amount)} 元`);
              }}
              className="mt-4 h-10 w-[140px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              收款
            </button>
          ) : (
            <button type="button" onClick={() => onToast('余额请前往钱包-余额查看')} className="mt-4 text-[16px] text-[#12B7F5] active:opacity-60">
              查看余额
            </button>
          )}
        </div>
        <div className="mt-10 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
            <span className="truncate text-[16px] text-[#1F2329] dark:text-white">{p.note || 'QQ转账'}</span>
          </div>
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            {/* 退还凭据卡显示原转账发生时间（originTime），原卡显示消息自身时间 */}
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(returned ? (p.originTime ?? msg.time) : msg.time)}</span>
          </div>
          {returned && typeof p.refundedAt === 'number' && (
            <div className="flex min-h-[54px] items-center justify-between gap-4" data-testid="qq-tr-refund-time-row">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">退款时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(p.refundedAt)}</span>
            </div>
          )}
          {expired && typeof p.expiredAt === 'number' && (
            <div className="flex min-h-[54px] items-center justify-between gap-4" data-testid="qq-tr-expired-time-row">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">退款时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(p.expiredAt)}</span>
            </div>
          )}
          {!mine ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">对方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}（QQ号 {peer.qqId ?? '暂无'}）</span>
            </div>
          ) : (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">收款方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 亲属卡详情页（AI 赠送 / 状态展示）：金卡 + 关系/每月额度/留言 + 领取/退还按钮（对方发的未领取时） */
function FamilyDetailPage({
  peer,
  msg,
  onBack,
  onToast,
  onClaim,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onToast: (m: string) => void;
  onClaim: (msgId: string) => void;
  /** 退还（拒收）对方送的亲属卡（仅对方发的未领取卡片传入） */
  onRefund?: (msgId: string) => void;
}) {
  const f = msg.fam;
  if (!f) return null;
  const mine = msg.role === 'me';
  const d = msg.fam?.claimedAt ? new Date(msg.fam.claimedAt) : null;
  const fmtFull = d
    ? `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
    : '';
  const claimable = !mine && !f.claimed && !f.rejected;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="亲属卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div
          className="mt-8 overflow-hidden rounded-[16px] shadow-lg shadow-black/10"
          style={{ backgroundImage: 'linear-gradient(150deg, #F7D488 0%, #EDB95E 60%, #E3A94B 100%)' }}
          data-testid="qq-family-detail-card"
        >
          <div className="flex items-center gap-3 px-5 pb-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
              <Gift className="h-6 w-6 text-white" strokeWidth={2.1} />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-tight text-white">{mine ? `给${peer.name}的亲属卡` : `${peer.name}送给你的亲属卡`}</p>
              <p className="mt-0.5 text-[12.5px] text-white/90">关系：{f.relation}</p>
            </div>
          </div>
          <div className="mx-5 mb-4 rounded-[12px] bg-white/22 px-4 py-3">
            <p className="text-[12.5px] text-white/90">每月消费上限</p>
            <p className="mt-0.5 text-[30px] font-bold leading-none text-white" data-testid="qq-family-detail-limit">
              ¥{fmtMoney(f.monthlyLimit)}
            </p>
            {f.message && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-white/95">“{f.message}”</p>}
          </div>
          <div className="border-t border-white/25 px-5 py-2 text-[12px] text-white/95">亲属卡 · 消费由赠卡方代付（模拟）</div>
        </div>

        <div className="mt-5 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[52px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">状态</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white" data-testid="qq-family-detail-status">
              {f.rejected ? '已退回' : f.claimed ? '已领取' : mine ? '待对方领取' : '待你领取'}
            </span>
          </div>
          {f.claimed && fmtFull && (
            <div className="flex min-h-[52px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">领取时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
            </div>
          )}
        </div>

        {claimable && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              data-testid="qq-family-detail-claim"
              onClick={() => {
                onClaim(msg.id);
                onToast('已领取亲属卡，对方为你买单（模拟）');
              }}
              className="block h-11 w-[150px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              领取
            </button>
            {onRefund ? (
              <button
                type="button"
                data-testid="qq-family-detail-refund"
                onClick={() => onRefund(msg.id)}
                className="block h-11 w-[150px] rounded-full border border-black/15 bg-white text-[16px] font-medium text-[#1F2329] active:bg-black/[0.04] dark:border-white/15 dark:bg-transparent dark:text-white"
              >
                退还
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 位置（发送位置页 + 聊天位置卡片） ----------------

/** 位置卡片假地图（位置气泡 / 发送位置页顶部预览复用；CSS 路网 + 大头针） */
function MapPreview({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`relative block overflow-hidden bg-[#E9F1E6] ${className}`} aria-hidden="true">
      {/* 路网纹理 */}
      <span
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.85) 2px, transparent 2px), linear-gradient(0deg, rgba(255,255,255,0.85) 2px, transparent 2px)',
          backgroundSize: '56px 44px',
        }}
      />
      <span className="absolute inset-x-0 top-[46%] h-[10px] -rotate-6 bg-[#FBD7A8]/90" />
      <span className="absolute inset-y-0 left-[38%] w-[8px] rotate-3 bg-[#CBE3F8]/90" />
      <span className="absolute right-[12%] top-[16%] h-10 w-16 rounded-[10px] bg-[#C8E6C1]/90" />
      <span className="absolute bottom-[12%] left-[8%] h-8 w-12 rounded-[8px] bg-[#C8E6C1]/80" />
      {/* 中心大头针 */}
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
        <MapPin className="h-7 w-7 drop-shadow" strokeWidth={2.2} style={{ color: '#F0605C' }} />
        <span className="-mt-0.5 h-1.5 w-1.5 rounded-full bg-black/20" />
      </span>
      {label ? <span className="absolute bottom-2 left-2 rounded-md bg-white/95 px-2 py-1 text-[11px] text-[#1F2329] shadow-sm">{label}</span> : null}
    </span>
  );
}

/** 聊天中的位置卡片（上地图下信息，对照 QQ 位置消息；单聊/群聊共用） */
export function LocationBubble({ loc, onClick }: { loc: MsgLoc; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="qq-loc-bubble"
      onClick={onClick}
      className="block w-[228px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-transform active:scale-[0.97]"
      aria-label={`位置 ${loc.name}`}
    >
      <MapPreview className="h-[104px] w-full" label={loc.name} />
      <span className="block bg-white px-3 py-2.5 dark:bg-[#2A2C31]">
        <span className="block truncate text-[15px] font-medium text-[#1F2329] dark:text-white">{loc.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{loc.addr}</span>
      </span>
    </button>
  );
}

/** 内置常用位置（发送位置页；与用户资料地域杭州呼应） */
const LOC_PRESETS: Array<{ name: string; addr: string; lat?: number; lng?: number; dist: string }> = [
  { name: '东方通信大厦', addr: '浙江省杭州市西湖区文三路398号', lat: 30.2787, lng: 120.1244, dist: '172米' },
  { name: '西湖风景名胜区', addr: '浙江省杭州市西湖区龙井路1号', lat: 30.2429, lng: 120.1476, dist: '3.6公里' },
  { name: '湖滨银泰in77', addr: '浙江省杭州市上城区延安路98号', lat: 30.253, lng: 120.163, dist: '5.4公里' },
  { name: '钱江新城城市阳台', addr: '浙江省杭州市上城区之江路888号', lat: 30.248, lng: 120.214, dist: '8.2公里' },
  { name: '滨江宝龙城', addr: '浙江省杭州市滨江区滨盛路3822号', lat: 30.185, lng: 120.195, dist: '9.8公里' },
  { name: '三里屯太古里', addr: '北京市朝阳区三里屯路19号', lat: 39.9368, lng: 116.4472, dist: '1200公里' },
  { name: '陆家嘴环球金融中心', addr: '上海市浦东新区世纪大道100号', lat: 31.2354, lng: 121.5057, dist: '1640公里' },
];

/** 发送位置页（内置地点一键发送 + 自定义位置表单，发送后聊天内出现位置卡片；单聊/群聊共用） */
export function LocationPickerPage({ onClose, onSend }: { onClose: () => void; onSend: (loc: MsgLoc) => void }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const ok = name.trim().length > 0 && addr.trim().length > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]" data-testid="qq-loc-page">
      <WalletNavHeader title="发送位置" onBack={onClose} />
      {custom ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 pt-4">
            <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
              <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
                <p className="text-[12px] text-black/40 dark:text-white/40">位置名称</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 20))}
                  placeholder="如：公司、家、学校"
                  aria-label="位置名称"
                  data-testid="qq-loc-name"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
              <div className="px-4 py-3">
                <p className="text-[12px] text-black/40 dark:text-white/40">详细地址</p>
                <input
                  value={addr}
                  onChange={(e) => setAddr(e.target.value.slice(0, 40))}
                  placeholder="街道、门牌号等"
                  aria-label="详细地址"
                  data-testid="qq-loc-addr"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
            </div>
            <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">位置信息仅在本机演示环境使用，发送后以卡片形式出现在聊天中。</p>
          </div>
          <div className="px-4 pb-[30px] pt-3">
            <button
              type="button"
              disabled={!ok}
              data-testid="qq-loc-custom-send"
              onClick={() => ok && onSend({ name: name.trim(), addr: addr.trim() })}
              className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
            >
              发送位置
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-6">
            <div className="px-4 pt-3">
              <MapPreview className="h-[168px] w-full rounded-[14px] shadow-sm" label="当前所在位置" />
            </div>
            <button
              type="button"
              data-testid="qq-loc-custom"
              onClick={() => setCustom(true)}
              className="mt-3 flex h-14 w-full items-center gap-3 bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#1B9FF0]/10 text-[#1B9FF0]" aria-hidden="true">
                <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">自定义位置</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
            <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">附近位置</p>
            <div className="overflow-hidden bg-white dark:bg-[#232529]">
              {LOC_PRESETS.map((l, i) => (
                <button
                  key={l.name}
                  type="button"
                  data-testid={`qq-loc-item-${i}`}
                  onClick={() => onSend({ name: l.name, addr: l.addr, lat: l.lat, lng: l.lng })}
                  className={`flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-[#1F2329] dark:text-white">{l.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-black/40 dark:text-white/40">{l.addr}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-black/35 dark:text-white/35">{l.dist}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 支付方式 / 支付密码（红包/转账付款 + 微信风格自绘键盘） ----------------

/** 支付方式选择底部弹层（QQ钱包余额 / 银行卡，发红包/转账页用） */
export function PayMethodSheet({ wallet, cards, selectedId, onClose, onPick }: { wallet: WalletData; cards: BankCard[]; selectedId: string; onClose: () => void; onPick: (id: string) => void }) {
  const rows: Array<{ id: string; name: string; sub: string; node: React.ReactNode }> = [
    {
      id: 'balance',
      name: 'QQ钱包余额',
      sub: `可用 ${fmtMoney(wallet.balance)} 元`,
      node: (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1B9FF0] text-white" aria-hidden="true">
          <Wallet className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
      ),
    },
    ...cards.map((c) => {
      const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
      return {
        id: c.id,
        name: `${c.bank} ${c.type ?? '储蓄卡'}`,
        sub: `尾号${c.last4} · 可用 ${fmtMoney(c.balance ?? 0)} 元`,
        node: (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
            {c.bank.slice(0, 1)}
          </span>
        ),
      };
    }),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">选择支付方式</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              data-testid={`qq-pay-method-${r.id === 'balance' ? 'balance' : (cards.find((c) => c.id === r.id)?.last4 ?? r.id)}`}
              onClick={() => onPick(r.id)}
              className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              {r.node}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 微信风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验逻辑由父级完成，errorKey 变化时父级重挂载本组件 → 清空并抖动） */
function PayPwdSheet({ title, sub, hint, errorKey, locked = false, onComplete, onClose }: { title: string; sub?: string; hint?: string; errorKey: number; locked?: boolean; onComplete: (pwd: string) => void; onClose: () => void }) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    if (locked) return;
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn =
    'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-[#1F2329] active:bg-black/[0.07] dark:bg-[#2A2C31] dark:text-white dark:active:bg-white/10';
  return (
    <div className="rounded-t-[18px] bg-[#F2F3F5] pb-7 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()} data-testid="qq-keypad">
      <style>{'@keyframes qqShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
      <div className="relative flex h-12 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
        <button type="button" aria-label="关闭" data-testid="qq-keypad-close" onClick={onClose} className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
      </div>
      {sub ? <p className="pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'qqShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="grid h-11 w-10 place-items-center rounded-[8px] border border-black/15 bg-white dark:border-white/20 dark:bg-white/[0.06]" aria-hidden="true">
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-[#1F2329] dark:bg-white" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[13px] text-[#F5455C]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className={`grid grid-cols-3 gap-[1px] border-t border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10 ${locked ? 'opacity-40 pointer-events-none' : ''}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`qq-keypad-${k}`} onClick={() => push(k)} className={keyBtn} disabled={locked}>
            {k}
          </button>
        ))}
        <span className="bg-white dark:bg-[#2A2C31]" aria-hidden="true" />
        <button type="button" data-testid="qq-keypad-0" onClick={() => push('0')} className={keyBtn} disabled={locked}>
          0
        </button>
        <button type="button" aria-label="删除" data-testid="qq-keypad-del" onClick={() => { if (!locked) { acc.current = acc.current.slice(0, -1); setDigits(acc.current); } }} className={keyBtn} disabled={locked}>
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 支付密码验证浮层（红包/转账/充值/提现/小金库支付前调用；正确回调 onOk，错误清空重输）。
 *  #97：5 次失败 30s 锁定——锁定期间禁用输入并显示倒计时，防止暴力试错 */
export function PayPwdGate({ label, onOk, onClose }: { label: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  const [lock, setLock] = useState<QqPayPwdLockData>(() => qqLoadPayPwdLock());
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        const cleared = { fails: 0, lockedUntil: 0 };
        qqSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={isLocked ? undefined : onClose}>
      <PayPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
        errorKey={errKey}
        locked={isLocked}
        onClose={onClose}
        onComplete={(pwd) => {
          if (isLocked) return;
          const d = loadPayPwd();
          if (d.pwd && pwd === d.pwd) {
            qqClearPayPwdLock();
            onOk();
          } else {
            const next = qqRecordPayPwdFail();
            setLock(next);
            setErrKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

/** 支付设置页（支付密码开启/关闭/修改；微信风格自绘 6 位数字键盘） */
function PaySettingsPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [data, setData] = useState(() => loadPayPwd());
  const [flow, setFlow] = useState<null | { mode: 'set' | 'confirm' | 'verify-off' | 'verify-change'; first?: string }>(null);
  const [errKey, setErrKey] = useState(0);
  // #97 锁定状态（verify-off/verify-change 失败累加，成功清零；5 次 30s 锁定）
  const [lock, setLock] = useState<QqPayPwdLockData>(() => qqLoadPayPwdLock());
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        const cleared = { fails: 0, lockedUntil: 0 };
        qqSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  const enabled = data.enabled && !!data.pwd;
  const meta = flow
    ? flow.mode === 'set'
      ? { title: '设置支付密码', sub: '请输入 6 位数字' }
      : flow.mode === 'confirm'
        ? { title: '确认支付密码', sub: '请再次输入' }
        : flow.mode === 'verify-off'
          ? { title: '关闭支付密码', sub: '验证后即可关闭' }
          : { title: '修改支付密码', sub: '请输入原支付密码' }
    : null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="支付设置" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-center gap-3 rounded-[14px] bg-[#FFF7E8] px-4 py-3.5 text-[13px] leading-relaxed text-[#8A6A3F] dark:bg-[#3A3222]/60 dark:text-[#E3C893]">
          <Fingerprint className="h-6 w-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          开启后，发红包、转账、充值、提现与小金库转入转出都需要先验证支付密码
        </div>
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="flex min-h-[58px] items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 dark:border-white/[0.06]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">支付密码</span>
              <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">{enabled ? '已开启 · 支付时需验证' : '未开启'}</span>
            </span>
            <button
              type="button"
              data-testid="qq-pay-toggle"
              aria-label={enabled ? '关闭支付密码' : '开启支付密码'}
              aria-pressed={enabled}
              onClick={() => {
                setErrKey(0);
                setFlow(enabled ? { mode: 'verify-off' } : { mode: 'set' });
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#0099FF]' : 'bg-black/20 dark:bg-white/25'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} aria-hidden="true" />
            </button>
          </div>
          {enabled ? (
            <button
              type="button"
              data-testid="qq-pay-change"
              onClick={() => {
                setErrKey(0);
                setFlow({ mode: 'verify-change' });
              }}
              className="flex min-h-[54px] w-full items-center px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">修改支付密码</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">支付密码为 6 位数字，仅保存在本机浏览器（localStorage），用于本机演示支付验证。</p>
      </div>
      {flow && meta ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55" role="dialog" aria-label={meta.title} onClick={() => setFlow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PayPwdSheet
              key={`${flow.mode}-${errKey}`}
              title={meta.title}
              sub={meta.sub}
              hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
              errorKey={errKey}
              locked={isLocked}
              onClose={() => setFlow(null)}
              onComplete={(pwd) => {
                if (isLocked) return;
                if (flow.mode === 'set') {
                  setErrKey(0);
                  setFlow({ mode: 'confirm', first: pwd });
                } else if (flow.mode === 'confirm') {
                  if (pwd === flow.first) {
                    savePayPwd({ enabled: true, pwd });
                    setData(loadPayPwd());
                    qqClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已开启');
                  } else {
                    onToast('两次输入不一致，请重新设置');
                    setErrKey((k) => k + 1);
                    setFlow({ mode: 'set' });
                  }
                } else if (flow.mode === 'verify-off') {
                  if (pwd === data.pwd) {
                    savePayPwd({ enabled: false, pwd: null });
                    setData(loadPayPwd());
                    qqClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已关闭');
                  } else {
                    setLock(qqRecordPayPwdFail());
                    setErrKey((k) => k + 1);
                  }
                } else if (pwd === data.pwd) {
                  setErrKey(0);
                  qqClearPayPwdLock();
                  setFlow({ mode: 'set' });
                } else {
                  setLock(qqRecordPayPwdFail());
                  setErrKey((k) => k + 1);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------- 好友标识页（聊天页消息区左滑进入） ----------------

/** 情侣卡等级阶梯（密友值 → Lv；5000 分对应 Lv3，对照真机截图） */
const COUPLE_LV_STEPS = [0, 1500, 5000, 12000, 25000, 50000, 100000, 200000, 500000];

function coupleLvOf(points: number): { lv: number; pct: number; need: number } {
  let lv = 1;
  for (let i = 0; i < COUPLE_LV_STEPS.length; i++) {
    if (points >= COUPLE_LV_STEPS[i]) lv = i + 1;
  }
  const lo = COUPLE_LV_STEPS[lv - 1] ?? 0;
  const hi = COUPLE_LV_STEPS[lv] ?? lo * 2 + 10000;
  const pct = Math.max(3, Math.min(100, Math.round(((points - lo) / (hi - lo)) * 100)));
  const need = Math.max(1, hi - points);
  return { lv, pct, need };
}

/** 情侣空间纪念日 → 已绑定天数（含当天，最小 1） */
function coupleBoundDays(anniv: string | null): number {
  if (!anniv) return 1;
  const t = new Date(`${anniv}T00:00:00`);
  if (Number.isNaN(t.getTime())) return 1;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((base.getTime() - t.getTime()) / 86400000) + 1;
  return diff >= 1 ? diff : 1;
}

/** 读情侣空间全局状态里与该好友的绑定情况（bound=已绑定 days=已绑定天数 pending=邀请待接受） */
function readCoupleBondInfo(peerId: string): { bound: boolean; days: number; pending: boolean } {
  try {
    const s = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    const meta = readInviteMeta();
    const bound = s.accepted === true && meta.partnerContactId === peerId;
    const pending = !bound && !!meta.pendingInvite && meta.pendingInvite.contactId === peerId;
    return { bound, days: bound ? coupleBoundDays(typeof s.anniversary === 'string' ? s.anniversary : null) : 0, pending };
  } catch {
    return { bound: false, days: 0, pending: false };
  }
}

function FriendBondPage({
  me,
  peer,
  onBack,
  onOpenProfile,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenProfile: () => void;
  onToast: (m: string) => void;
}) {
  // 密友统计：成为好友时间戳用于友谊时间线；天数/密友值仍在后台按 QQ 规则增长（loadBondStat/addBondPoints）
  const [stat] = useState(() => loadBondStat(peer.id));
  const days = bondDays(stat);
  // 我们的DNA弹窗（summary=聊天小结 / common=共同属性 / timeline=友谊时间线，对照 QQ 真机）
  const [dnaModal, setDnaModal] = useState<null | 'summary' | 'common' | 'timeline'>(null);
  // 用户第九轮：情侣空间绑定状态（邀请卡同意后本页上半部分变情侣关系卡；AI 在别处接受时实时刷新）
  const [bondTick, setBondTick] = useState(0);
  const [bindBusy, setBindBusy] = useState(false);
  useEffect(() => {
    const h = () => setBondTick((t) => t + 1);
    window.addEventListener(COUPLE_STATE_EVENT, h);
    return () => window.removeEventListener(COUPLE_STATE_EVENT, h);
  }, []);
  const couple = useMemo(() => readCoupleBondInfo(peer.id), [peer.id, bondTick]);
  const coupleLv = coupleLvOf(stat.points);
  /** 点「去绑定专属关系」→ 给 TA 发情侣空间邀请卡（couple-invite 管线：AI 延时接受 → 回成功卡 → 建立关系） */
  const onBindRelation = async () => {
    if (bindBusy) return;
    setBindBusy(true);
    try {
      const r = await sendMyInvite('qq', peer.id);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onToast(`邀请已发送，等${peer.name}回应`);
      setBondTick((t) => t + 1);
      // 回聊天页看邀请卡（TA 稍后回成功卡，再左滑回来上半部分就是情侣卡）
      window.setTimeout(() => onBack(), 700);
    } finally {
      setBindBusy(false);
    }
  };
  /** 「情侣空间 >」入口 → 切到情侣空间 App（与考试卡/情书卡同款导航） */
  const openCoupleSpace = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };
  const sinceDate = new Date(stat.since);
  const nowDate = new Date();
  const fmtMY = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sinceLabel = `${sinceDate.getFullYear()}/${sinceDate.getMonth() + 1}/${sinceDate.getDate()}`;
  const totalDays = Math.max(days, 1);
  // 聊天小结：取双方最近在会话里发过的表情（没发过用默认，对照真机文案）
  const lastEmoji = (role: 'me' | 'peer') => {
    const msgs = loadMsgs(peer.id).filter((m) => m.role === role);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i].content.match(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic})*/gu);
      if (m && m.length) return m[m.length - 1];
    }
    return role === 'me' ? '🥱' : '🐶';
  };
  const meEmoji = lastEmoji('me');
  const peerEmoji = lastEmoji('peer');

  return (
    <div className="relative flex h-full w-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 更多 */}
      <div className="flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button
          type="button"
          aria-label="返回聊天"
          data-testid="qq-bond-back"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="更多"
          onClick={() => onToast('更多暂未开放')}
          className="ml-auto rounded-full p-1.5 active:bg-black/5"
        >
          <Menu className="h-[22px] w-[22px] text-black/70 dark:text-white/70" strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8" data-testid="qq-bond-body">
        {/* 用户第十三轮：邀请卡同意后 → 上半部分换情侣关系卡，对照最新参考图 1:1 重制
            （参考图 1080px 截图实测 ÷2.78 缩放：紫粉渐变 #D28AE0→#FEC6CF、标题 23px+白描边 Lv 徽章、
            玫红胶囊「情侣空间 >」、左对齐双头像 26px 白环、密友值、白轨紫芯进度条 + 右端 mini 爱心徽章） */}
        {couple.bound ? (
          <div
            data-testid="qq-bond-couple-card"
            className="relative mt-1 overflow-hidden rounded-[16px] px-[27px] pb-3 pt-[26px]"
            style={{
              background:
                'linear-gradient(105deg, #D28AE0 0%, #E999D9 38%, #F4AFD4 68%, #FEC9D0 100%)',
            }}
          >
            {/* 右侧情侣徽章（用户第十四轮：跟随聊天界面名字右面的徽章图标，放大版——
                public/qq-couple-badge-lg.png 554×560 高清抠自用户素材图，与聊天气泡旁 CoupleMark 同源同设计；
                尺寸 158×160 蓝底座收在进度条上方 7px，不压条） */}
            <img
              src="/qq-couple-badge-lg.png"
              alt=""
              draggable={false}
              className="pointer-events-none absolute right-[10px] top-[24px] select-none"
              style={{ width: 158, height: 160 }}
            />

            {/* 左列内容（宽度让开右侧图标区） */}
            <div className="relative w-[160px]">
              <div className="flex items-center gap-1.5">
                <p className="text-[23px] font-bold leading-none text-white drop-shadow-[0_1px_3px_rgba(160,40,110,0.25)]">神仙眷侣</p>
                <span
                  data-testid="qq-bond-couple-lv"
                  className="rounded-[5px] border border-white/85 px-[5px] py-[3.5px] text-[11px] font-semibold leading-none text-white"
                >
                  Lv{coupleLv.lv}
                </span>
              </div>
              <p className="mt-[13px] text-[13px] leading-none text-white/85" data-testid="qq-bond-couple-days">
                已绑定 {couple.days} 天
              </p>
              {/* 第十七轮反馈：胶囊（rounded-full）→ 方形圆角 rounded-[7px] */}
              <button
                type="button"
                data-testid="qq-bond-couple-space"
                onClick={openCoupleSpace}
                className="mt-[7px] flex h-[26px] items-center gap-[1px] rounded-[7px] bg-[#F255D7] pl-[11px] pr-[8px] text-[11.5px] font-medium leading-none text-white shadow-[0_3px_9px_rgba(214,45,180,0.38)] transition active:scale-95 active:bg-[#E040C4]"
              >
                情侣空间
                <ChevronRight className="h-[13px] w-[13px]" aria-hidden="true" />
              </button>

              {/* 双头像（左前右后、白环、重叠约 1/3，左对齐——对照参考图） */}
              <div className="mt-[24px] flex items-center">
                <span className="z-10 -mr-[9px] grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full bg-white/40 shadow-[0_2px_6px_rgba(120,30,90,0.25)] ring-[2.5px] ring-white">
                  <QqAvatar src={me.avatar} alt={me.name} size={26} />
                </span>
                <span className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full bg-white/40 shadow-[0_2px_6px_rgba(120,30,90,0.25)] ring-[2.5px] ring-white">
                  <QqAvatar src={peer.avatar} alt={peer.name} size={26} />
                </span>
              </div>
              <p className="mt-[8px] text-[12px] font-semibold leading-none text-white" data-testid="qq-bond-couple-points">
                密友值 {stat.points} 分
              </p>
            </div>

            {/* 底部升级进度条：白轨 + 紫芯（上下留 1px 白边）+ 右端 mini 爱心徽章（对照参考图） */}
            <div className="relative mt-[13px] flex items-center gap-[13px]">
              <div className="relative h-[8.5px] flex-1 rounded-full bg-white/60">
                <div
                  className="absolute inset-y-[1px] left-[1px] rounded-full"
                  style={{
                    width: `calc(${Math.max(4, Math.min(100, coupleLv.pct))}% - 2px)`,
                    background: 'linear-gradient(90deg, #DC8AE6 0%, #EFA6DC 100%)',
                  }}
                />
              </div>
              <img
                src="/qq-couple-badge-lg.png"
                alt=""
                draggable={false}
                className="h-[24px] w-[24px] shrink-0 select-none drop-shadow-[0_2px_4px_rgba(180,60,140,0.35)]"
              />
            </div>
            <p className="relative mt-[7px] text-[9.5px] leading-none text-white/75">
              再得 {coupleLv.need} 分升级 Lv{coupleLv.lv + 1}
            </p>
          </div>
        ) : (
        // 密友卡（对照真机截图再缩小一档：左上成为好友N天+密友值，中央同心圆波纹+双头像+蓝心跳线，底部去绑定专属关系；四周幸运物图标不要）
        <div
          className="relative mt-1 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#EAE6FB] via-[#F3E1F6] to-[#DCE3FB] px-4 pb-5 pt-5 dark:from-[#38304A] dark:via-[#3B2E43] dark:to-[#26314B]"
          data-testid="qq-bond-card"
        >
          {/* 柔光斑（粉/蓝营造真机渐变氛围）：密友卡专属设计元素，非毛玻璃氛围层，Task 38 误删后还原 */}
          <div aria-hidden="true" className="absolute -right-9 -top-10 h-32 w-32 rounded-full bg-[#F8CDE9]/70 blur-3xl dark:bg-[#8E4E86]/25" />
          <div aria-hidden="true" className="absolute -left-10 top-1/3 h-28 w-28 rounded-full bg-[#F5D5EE]/60 blur-3xl dark:bg-[#7A4E8C]/20" />
          <div aria-hidden="true" className="absolute -bottom-12 right-1/4 h-32 w-32 rounded-full bg-[#CBD8FB]/70 blur-3xl dark:bg-[#3D5392]/25" />

          {/* 左上：成为好友 N天 + 密友值 pill（真实数据） */}
          <div className="relative">
            <p className="text-[16px] font-medium leading-none text-black/85 dark:text-white/90">成为好友</p>
            <p className="mt-1.5 flex items-baseline gap-1" data-testid="qq-bond-days">
              <span className="text-[36px] font-semibold leading-none tracking-tight text-[#23222B] dark:text-white">{days}</span>
              <span className="text-[15px] font-medium text-black/85 dark:text-white/90">天</span>
            </p>
            <p
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[#6B6680]/10 px-2.5 py-[3px] text-[13px] text-black/60 dark:bg-white/10 dark:text-white/60"
              data-testid="qq-bond-points"
            >
              密友值
              <span aria-hidden="true" className="h-3 w-px bg-black/15 dark:bg-white/20" />
              <span>{stat.points}分</span>
            </p>
          </div>

          {/* 中央：同心圆波纹 + 双头像 + 蓝色心跳线（整体再缩小一档） */}
          <div className="relative mt-1.5 flex justify-center">
            <div className="relative grid h-[140px] w-[140px] place-items-center">
              <span aria-hidden="true" className="absolute h-[140px] w-[140px] rounded-full bg-white/20 dark:bg-white/[0.07]" />
              <span aria-hidden="true" className="absolute h-[101px] w-[101px] rounded-full bg-white/25 dark:bg-white/[0.09]" />
              <span aria-hidden="true" className="absolute h-[66px] w-[66px] rounded-full bg-white/30 dark:bg-white/[0.11]" />
              <span className="relative flex items-center gap-0.5">
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-me"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={52} />
                </span>
                <svg viewBox="0 0 48 28" className="h-[23px] w-[40px] shrink-0" aria-hidden="true">
                  <defs>
                    <linearGradient id="qq-pulse-g" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#7FB0FF" />
                      <stop offset="1" stopColor="#3D6EF6" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M2 16.5h7.5l3.5-8.5 6 17 4-12.5 2.5 4h22.5"
                    fill="none"
                    stroke="url(#qq-pulse-g)"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-peer"
                >
                  <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
                </span>
              </span>
            </div>
          </div>

          {/* 底部：去绑定专属关系（蓝色文字链接；用户第九轮：真发情侣空间邀请卡，AI 同意后本卡升级为情侣关系卡） */}
          <div className="relative flex justify-center">
            {couple.pending ? (
              <div
                data-testid="qq-bond-bind-pending"
                className="mt-0.5 flex items-center gap-1.5 text-[15px] font-medium text-black/40 dark:text-white/40"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3D6EF6]" aria-hidden="true" />
                邀请已发出，等TA接受…
              </div>
            ) : (
              <button
                type="button"
                data-testid="qq-bond-bind"
                onClick={() => void onBindRelation()}
                disabled={bindBusy}
                className="mt-0.5 flex items-center text-[16px] font-medium text-[#3D6EF6] active:opacity-70 disabled:opacity-50 dark:text-[#7FA0FF]"
              >
                {bindBusy ? '正在发送邀请…' : '去绑定专属关系'}
                <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        )}

        {/* 我们的DNA（对照 QQ 真机截图：聊天小结 / 共同属性 / 友谊时间线 三卡；整体缩小一档） */}
        <p className="px-1 pb-1.5 pt-3 text-[14px] font-medium text-black/75 dark:text-white/75">我们的DNA</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            data-testid="qq-bond-dna-chat"
            onClick={() => setDnaModal('summary')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              聊天小结
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              友谊
              <br />
              持续升温
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-common"
            onClick={() => setDnaModal('common')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              共同属性
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              0个
              <br />
              共同好友
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-timeline"
            onClick={() => setDnaModal('timeline')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              友谊时间线
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              {sinceLabel}
              <br />
              我们成为好友
            </span>
          </button>
        </div>

        {/* 我们的幸运物种 */}
        <p className="px-1 pb-2 pt-4 text-[14px] text-black/40 dark:text-white/40">我们的幸运物种</p>
        <div className="rounded-[20px] bg-white px-4 py-4 dark:bg-[#1B1C1F]">
          <p className="text-[15px] font-medium">幸运字符</p>
          <div className="mt-3 h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('幸运字符暂未开放')}
            className="flex w-full items-center gap-3 pt-3 text-left active:opacity-70"
          >
            <span
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#33271C] via-[#17120E] to-[#0B0806] text-[20px] font-bold text-[#E7C873] shadow-[0_4px_14px_rgba(231,200,115,0.28)] ring-1 ring-[#E7C873]/45"
              aria-hidden="true"
            >
              X
              <span className="absolute -right-0.5 -top-0.5 text-[9px] text-[#FFE9B8]">✦</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium">幸运字符</span>
              <span className="block text-[13px] text-black/35 dark:text-white/35">抽取专属字符</span>
            </span>
            <span className="text-[15px] text-black/45 dark:text-white/45">开启</span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#F5455C]" aria-hidden="true" />
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 我们的DNA弹窗（聊天小结 / 共同属性 / 友谊时间线，对照 QQ 真机：白卡 + 蓝按钮 + 圆形关闭钮） */}
      {dnaModal && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/45 px-6"
          role="dialog"
          aria-label="我们的DNA"
          data-testid="qq-bond-dna-modal"
        >
          <div className="w-full rounded-[24px] bg-white px-6 pb-9 pt-7 dark:bg-[#1E1F23]">
            {dnaModal === 'summary' && (
              <>
                <p className="text-[22px] font-bold">聊天小结</p>
                <p className="mt-7 text-[15px] leading-relaxed">
                  本周，
                  <br />
                  我们的<b>友谊持续升温</b>。
                </p>
                <p className="mt-4 text-[15px] leading-relaxed">
                  我最近使用的表情是 <span className="align-middle text-[26px] leading-none">{meEmoji}</span>
                </p>
                <p className="mt-3 text-[15px] leading-relaxed">
                  好友最近使用的表情是 <span className="align-middle text-[26px] leading-none">{peerEmoji}</span>
                </p>
              </>
            )}
            {dnaModal === 'common' && (
              <>
                <p className="text-[22px] font-bold">共同属性</p>
                <div className="mt-7 flex items-center gap-9">
                  <span className="text-[15px] text-black/35 dark:text-white/35">共同好友</span>
                  <span className="text-[17px] font-bold" data-testid="qq-bond-dna-common-count">
                    0个
                  </span>
                </div>
              </>
            )}
            {dnaModal === 'timeline' && (
              <>
                <p className="text-[22px] font-bold">友谊时间线</p>
                <div className="mt-8 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{sinceDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(sinceDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    通过<b>QQ号查找</b>我们成为了好友。
                  </p>
                </div>
                <div className="mt-7 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{nowDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(nowDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    今天，
                    <br />
                    是我们成为好友的<b>{totalDays}天</b>。
                  </p>
                </div>
              </>
            )}
            <button
              type="button"
              data-testid="qq-bond-dna-cta"
              onClick={() => {
                const which = dnaModal;
                setDnaModal(null);
                if (which === 'common') onOpenProfile();
                else onBack();
              }}
              className="mx-auto mt-10 flex h-12 w-[76%] items-center justify-center rounded-[10px] bg-[#3BA0FF] text-[17px] font-medium text-white shadow-[0_6px_18px_rgba(59,160,255,0.35)] active:brightness-95"
            >
              {dnaModal === 'common' ? '完善资料' : '去聊一聊'}
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭"
            data-testid="qq-bond-dna-close"
            onClick={() => setDnaModal(null)}
            className="mt-8 grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border-2 border-white/85 text-white active:bg-white/10"
          >
            <X className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- 资料页徽章（SVIP8 / QQ等级图标 / 勋章 / LV，对照真机截图） ----------------

/** 公用 defs（同页多个 SVG 引用同一渐变，路由互斥无 id 冲突） */
function QqGoldDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <linearGradient id="qq-gold-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A" />
          <stop offset="1" stopColor="#F0A711" />
        </linearGradient>
        <linearGradient id="qq-gold-deep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD76A" />
          <stop offset="1" stopColor="#DE8F0A" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** QQ 等级图标组：皇冠（三顶珠+三红宝石）+ 太阳（三角光芒）+ 月亮（金系简约新月，共用金色渐变靠剪影区分）+ 星星×3，对照 QQ 真机 */
function QqLevelIcons() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <circle cx="4.2" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="4.2" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="19.8" cy="6.8" r="1.7" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <path
          d="M4.2 8.6l4.3 3.3 3.5-5.2 3.5 5.2 4.3-3.3-1.7 8.9H5.9z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <rect x="5.4" y="17.7" width="13.2" height="2.6" rx="1.3" fill="url(#qq-gold-deep)" stroke="#C8880A" strokeWidth="0.5" />
        <circle cx="12" cy="13.6" r="1.4" fill="#F5455C" stroke="#C43A4C" strokeWidth="0.4" />
        <circle cx="7.6" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
        <circle cx="16.4" cy="15" r="0.85" fill="#F5455C" opacity="0.9" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]">
        <g fill="url(#qq-gold-deep)">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M12 1.2l1.7 3.8h-3.4z" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
        <circle cx="12" cy="12" r="5.4" fill="url(#qq-gold-g)" stroke="#C8880A" strokeWidth="0.8" />
        <circle cx="12" cy="12" r="3.2" fill="#FFE9A8" opacity="0.55" />
      </svg>
      <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]">
        {/* 月亮：金系简约新月——与皇冠/太阳/星星共用同一金色渐变（qq-gold-g），仅靠月牙剪影区分；无月晕/星芒/圆底等繁饰；尺寸略小（20px，用户要求月亮小一点） */}
        <path
          d="M20.8 13A9 9 0 1 1 11 3.2A7 7 0 0 0 20.8 13z"
          fill="url(#qq-gold-g)"
          stroke="#C8880A"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* 内缘一道柔光，呼应太阳内圈细节 */}
        <path d="M11 3.2A7 7 0 0 0 20.8 13" fill="none" stroke="#FFE9A8" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
      </svg>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-[21px] w-[21px]">
          <path
            d="M12 2.8l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z"
            fill="url(#qq-gold-g)"
            stroke="#C8880A"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

/** 资料页徽章行（QQ 等级图标：皇冠+太阳+月亮+星星×3；SVIP8/勋章/LV8/LV3 徽章已按需求删除；padClass 控制左缩进） */
function QqBadgeWall({ onOpen, mtClass, testid, padClass = '' }: { onOpen: () => void; mtClass: string; testid: string; padClass?: string }) {
  return (
    <div className={mtClass} data-testid={testid}>
      <QqGoldDefs />
      <button type="button" onClick={onOpen} className={`flex w-full items-center text-left active:opacity-70 ${padClass}`}>
        <span className="flex min-w-0 flex-1 items-center">
          <QqLevelIcons />
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------- 好友个人资料页（联系人列表点击进入，对照 QQ 真机） ----------------

function FriendProfilePage({
  me,
  peer,
  onBack,
  onOpenChat,
  onOpenBond,
  onOpenZone,
  onCall,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenBond: () => void;
  /** 他的QQ空间：进该好友的空间动态页（只显示 TA 发的动态） */
  onOpenZone: () => void;
  /** Task 28-b 「音视频通话」ActionSheet 选项回调（voice/video）：宿主关资料页并经聊天页拨号（openVoiceCall 全链路） */
  onCall: (media: 'voice' | 'video') => void;
  onToast: (m: string) => void;
}) {
  // 跨 App 跳转：点「编辑资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  // Task 28-b 「音视频通话」底部 ActionSheet（语音通话/视频通话 + 取消；点遮罩也可取消）
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  // 46-f：好友资料页顶部封面 banner——getPeerBg 读出该联系人专属背景（按 peer.id 隔离）；
  // 无则渐变兜底（QQ 蓝紫色调）；右上角"恢复默认"按钮调 removePeerBg 后刷新本组件 + toast
  const [peerBg, setPeerBgState] = useState<string | null>(null);
  const reloadPeerBg = useCallback(() => {
    void getPeerBg('qq', peer.id).then((bg) => setPeerBgState(bg ?? null));
  }, [peer.id]);
  useEffect(() => {
    reloadPeerBg();
  }, [reloadPeerBg]);
  // 47-c 改动 4：好友资料页封面点击上传——点 banner 弹文件选择 → 压缩 → setPeerBg 持久化 + 刷新本组件 banner state → toast
  // 56：恢复默认按钮已删除（用户要求），handleResetBanner 一并移除
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const handleUploadBanner = useCallback(() => {
    if (bannerBusy) return;
    bannerFileRef.current?.click();
  }, [bannerBusy]);
  const handleBannerFile = useCallback(
    async (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      setBannerBusy(true);
      try {
        const src = await compressImageFile(f);
        if (!src) {
          onToast('图片读取失败');
          return;
        }
        await setPeerBg('qq', peer.id, src);
        setPeerBgState(src);
        onToast('已设置封面');
      } catch {
        onToast('上传失败');
      } finally {
        setBannerBusy(false);
      }
    },
    [peer.id, onToast]
  );
  // 点赞数：本地持久化，点击 +1（对照 QQ 资料卡点赞）
  const [likes, setLikes] = useState<number>(() => {
    try {
      const n = Number(kvGet<number>(LS_FRIEND_LIKE(peer.id)) ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  });
  const giveLike = () => {
    const next = likes + 1;
    setLikes(next);
    try {
      kvSet(LS_FRIEND_LIKE(peer.id), next);
    } catch {
      // 忽略
    }
    onToast(`已点赞 ${peer.name}`);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-[#1B1C1F]">
      {/* 56：背景图 absolute 铺顶（对齐个人资料页真机 QQ 风格，高 320px） */}
      <div
        role="button"
        aria-label="点击更换封面"
        data-testid="qq-fprofile-upload-banner"
        title="点击更换封面"
        onClick={handleUploadBanner}
        className="absolute inset-x-0 top-0 h-[320px] cursor-pointer"
      >
        {peerBg ? (
          <img src={peerBg} alt="封面" className="h-full w-full object-cover" />
        ) : peer.avatar ? (
          <img
            src={peer.avatar}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-125 object-cover blur-2xl brightness-[0.62]"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'linear-gradient(180deg, #93A9CC 0%, #5E6D88 100%)' }}
            aria-hidden="true"
          />
        )}
        {/* 底部渐变过渡到白色（消除背景图与主卡衔接处的边缘空白） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white dark:from-[#1B1C1F] to-transparent" aria-hidden="true" />
        <input
          ref={bannerFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="qq-fprofile-banner-file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void handleBannerFile(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {/* 顶部浮钮：返回 / 个人资料标题（叠在背景图上，避开状态栏 pt-[50px]，深色玻璃圆钮；
          右上角设置图标已按需求删除，用同宽占位保持标题居中） */}
      <div className="relative z-10 flex items-center justify-between px-3 pt-[50px] pb-2">
        <button
          type="button"
          aria-label="返回"
          data-testid="qq-fprofile-back"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white shadow-sm backdrop-blur-md transition-transform active:scale-90 active:bg-black/50"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="pointer-events-none text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
          个人资料
        </span>
        <span aria-hidden="true" className="h-9 w-9 shrink-0" />
      </div>

      {/* 白色圆角主卡（从背景图中间叠上来：mt-[125px] 露出顶部约 195px 背景，rounded-t-[22px] 圆角顶） */}
      <div className="relative z-10 mt-[125px] flex-1 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-4 pt-6 dark:bg-[#1B1C1F]" data-testid="qq-fprofile-body">
        {/* 头像 + 名字/QQ号 + 点赞（卡片内，对齐个人资料页布局） */}
        <div className="flex items-start gap-4">
          <QqAvatar src={peer.avatar} alt={peer.name} size={84} />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[20px] font-bold leading-tight">{peer.name}</span>
            </div>
            <div className="mt-1.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-fprofile-qqid">
              QQ:{peer.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            data-testid="qq-fprofile-like"
            onClick={giveLike}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/65 active:opacity-60 dark:text-white/65"
          >
            <ThumbsUp className="h-5 w-5" strokeWidth={1.9} />
            <span className="text-[12px]" data-testid="qq-fprofile-like-count">
              {likes}
            </span>
          </button>
        </div>

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除；与卡片其他行同一 20px 内边距，不再二次缩进） */}
        <QqBadgeWall testid="qq-fprofile-badges" mtClass="mt-5" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 你们的互动标识 → 好友互动标识页（分隔条 -mx-5 贴满屏宽，与个人资料页一致） */}
        <div className="-mx-5 mt-5 h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-fprofile-bond"
          onClick={onOpenBond}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <span className="shrink-0 text-[15px]">你们的互动标识</span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[13px] text-black/40 dark:text-white/40">
            <span className="truncate">点亮你们的第一个标识</span>
            <span aria-hidden="true">🌸</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* 他的QQ空间（分隔条 -mx-5 贴满屏宽） */}
        <div className="-mx-5 h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-fprofile-zone"
          onClick={onOpenZone}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <Star className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" strokeWidth={1.9} aria-hidden="true" />
          <span className="flex-1 text-[15px]">他的QQ空间</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮：音视频通话 / 编辑资料（跳联系人 App 编辑页）/ 发消息
          底色与主卡一致（深色 #1B1C1F），消除主卡与按钮区衔接处的色差边缘 */}
      <div className="flex shrink-0 flex-col gap-2.5 bg-white px-4 pb-[40px] pt-3 dark:bg-[#1B1C1F]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="qq-fdetail-call"
            onClick={() => setCallSheetOpen(true)}
            className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
          >
            音视频通话
          </button>
          <button
            type="button"
            data-testid="qq-fprofile-edit"
            onClick={() => {
              setPendingContactEdit(peer.id);
              switchToApp('contacts');
            }}
            className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
          >
            编辑资料
          </button>
          <button
            type="button"
            data-testid="qq-fprofile-message"
            onClick={onOpenChat}
            className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            发消息
          </button>
        </div>
      </div>

      {/* Task 28-b 音视频通话 ActionSheet：底部滑出卡片（容器样式与 PayMethodSheet 同款：黑色半透明遮罩
          + 底部圆角卡片滑入，选项行白底黑字、QQ 蓝图标；点遮罩/取消关闭。先关卡片再回调拨号，避免弹层叠在全局通话层上） */}
      {callSheetOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45"
          role="dialog"
          aria-label="音视频通话"
          data-testid="qq-fdetail-call-sheet"
          onClick={() => setCallSheetOpen(false)}
        >
          <style>{'@keyframes qqFdCallIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
          <div
            className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]"
            style={{ animation: 'qqFdCallIn 0.24s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
            <div className="mt-1 overflow-hidden rounded-[12px]">
              <button
                type="button"
                data-testid="qq-fdetail-call-voice"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('voice');
                }}
                className="flex h-14 w-full items-center gap-3 bg-black/[0.03] px-4 text-left text-[17px] active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
              >
                <Phone className="h-[19px] w-[19px] shrink-0" style={{ color: QQ_BLUE }} strokeWidth={1.9} aria-hidden="true" />
                语音通话
              </button>
              <div className="h-2" aria-hidden="true" />
              <button
                type="button"
                data-testid="qq-fdetail-call-video"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('video');
                }}
                className="flex h-14 w-full items-center gap-3 bg-black/[0.03] px-4 text-left text-[17px] active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
              >
                <Video className="h-[19px] w-[19px] shrink-0" style={{ color: QQ_BLUE }} strokeWidth={1.9} aria-hidden="true" />
                视频通话
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCallSheetOpen(false)}
              className="mt-3 h-14 w-full rounded-full bg-black/[0.05] text-[17px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white"
            >
              取消
            </button>
          </div>
        </div>
      )}
      <span className="sr-only">{me.name}查看{peer.name}的个人资料</span>
    </div>
  );
}

// ---------------- 搜索页（对照 QQ 真机：搜索框 + 取消 + 搜索指定内容 + 本地结果） ----------------

/** 各类消息规整成可搜索文本（图片/撤回不入搜索，与聊天页 ChatSearchItem 同口径） */
function qqMsgSearchText(m: QQMsg): string {
  if (m.kind === 'sticker' && m.stk) return m.stk.meaning ? `[表情] ${m.stk.meaning}` : '[表情]';
  if (m.kind === 'redpacket' && m.packet) return `[QQ红包] ${m.packet.note}`;
  if (m.kind === 'transfer' && m.packet) return `[转账] ${m.packet.note}`;
  if (m.kind === 'family' && m.fam) return `[亲属卡] 每月额度 ${m.fam.monthlyLimit} 元`;
  if (m.kind === 'location' && m.loc) return `[位置] ${m.loc.name}${m.loc.addr ? ` ${m.loc.addr}` : ''}`;
  if (m.kind === 'notice' && m.notice) return `${m.notice.pre}${m.notice.accent}`;
  if (m.kind === 'voice') return m.voice?.transcript || m.voice?.localText ? `[语音] ${m.voice?.transcript || m.voice?.localText}` : '[语音]';
  return m.content;
}

/** 关键词命中高亮（QQ 蓝色，对照真 QQ 搜索结果） */
function QqHighlight({ text, kw }: { text: string; kw: string }) {
  const k = kw.trim().toLowerCase();
  const idx = k ? text.toLowerCase().indexOf(k) : -1;
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[#0099FF]" data-testid="qq-search-hit-mark">
        {text.slice(idx, idx + k.length)}
      </span>
      {text.slice(idx + k.length)}
    </>
  );
}

function QqSearchPage({
  me,
  contacts,
  groups,
  onClose,
  onOpenChat,
  onOpenGroup,
  onAddFriend,
  onOpenStickers,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  groups: ChatGroup[];
  /** 取消 / 返回键：回消息 tab */
  onClose: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenGroup: (g: ChatGroup) => void;
  /** 快捷入口「找人/群」→ 加好友/群页 */
  onAddFriend: () => void;
  /** 快捷入口「表情」→ 表情商城 */
  onOpenStickers: () => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const key = kw.trim().toLowerCase();

  /** QQ 好友（与消息页会话同口径；自己也在内） */
  const friends = useMemo(
    () => contacts.filter((c) => (isFriendIn(c, 'qq') && c.kind !== 'user') || c.id === me.id),
    [contacts, me.id]
  );

  /** 命中联系人：名字/备注/QQ号匹配 */
  const hitContacts = useMemo<ContactRecord[]>(() => {
    if (!key) return [];
    return friends
      .filter(
        (c) =>
          displayNameOf(c).toLowerCase().includes(key) ||
          c.name.toLowerCase().includes(key) ||
          (c.qqId ?? '').includes(key)
      )
      .slice(0, 8);
  }, [friends, key]);

  /** 命中群聊：群备注/群名匹配 */
  const hitGroups = useMemo<ChatGroup[]>(() => {
    if (!key) return [];
    return groups.filter((g) => (g.remark || g.name).toLowerCase().includes(key)).slice(0, 5);
  }, [groups, key]);

  /** 命中聊天记录：全量会话（好友 + 群）按摘要文本匹配，最新在前取 6 条 */
  const hitMsgs = useMemo<Array<{ key: string; title: string; avatar: string | null; isGroup: boolean; group: ChatGroup | null; contact: ContactRecord | null; senderLabel: string; text: string; time: number }>>(() => {
    if (!key) return [];
    const hits: Array<{ key: string; title: string; avatar: string | null; isGroup: boolean; group: ChatGroup | null; contact: ContactRecord | null; senderLabel: string; text: string; time: number }> = [];
    for (const c of friends) {
      if (c.id === me.id) continue; // 自己的会话没有聊天记录分区入口（从联系人进）
      for (const m of loadMsgs(c.id)) {
        if (m.kind === 'image' || m.recalled) continue;
        const text = qqMsgSearchText(m);
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
          key: qqGroupRowId(g.id),
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
     
  }, [key, friends, groups, me.id]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const hasResults = hitContacts.length + hitGroups.length + hitMsgs.length > 0;

  return (
    <div className="absolute inset-0 z-40 flex h-full w-full flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white">
      {/* 顶栏：搜索框 + 取消（对照截图 2） */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-12 items-center gap-3 px-3 pb-1">
          <div className="flex h-[36px] min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-[#EEF1F6] px-3 dark:bg-white/[0.08]">
            <Search className="h-[17px] w-[17px] shrink-0 text-black/30 dark:text-white/30" strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索"
              data-testid="qq-search-input"
              aria-label="搜索"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" data-testid="qq-search-clear" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
          <button
            type="button"
            data-testid="qq-search-cancel"
            onClick={onClose}
            className="shrink-0 text-[16px] text-[#0099FF] active:opacity-60"
          >
            取消
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {!key ? (
          /* 搜索指定内容（对照截图 2：标题 + 找人/群、表情、小程序三个快捷入口） */
          <div data-testid="qq-search-shortcuts">
            <p className="border-b border-black/[0.06] px-4 pb-3 pt-5 text-[15px] text-black/45 dark:border-white/[0.07] dark:text-white/45">
              搜索指定内容
            </p>
            <div className="flex items-start px-2 pt-5">
              {(
                [
                  { label: '找人/群', icon: <UserPlus className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-find', action: onAddFriend },
                  { label: '表情', icon: <Smile className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-sticker', action: onOpenStickers },
                  { label: '小程序', icon: <Compass className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-miniapp', action: () => onToast('小程序暂未开放') },
                ] as const
              ).map((it) => (
                <button
                  key={it.label}
                  type="button"
                  data-testid={it.testid}
                  onClick={it.action}
                  className="flex flex-1 flex-col items-center gap-2 rounded-[12px] py-2 text-black/60 active:bg-black/[0.04] dark:text-white/60 dark:active:bg-white/[0.06]"
                >
                  {it.icon}
                  <span className="text-[13px]">{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {!hasResults && (
              <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35" data-testid="qq-search-empty">
                暂无搜索结果
              </p>
            )}

            {/* 联系人 */}
            {hitContacts.length > 0 && (
              <section data-testid="qq-search-contacts">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">联系人</p>
                {hitContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`qq-search-contact-${c.id}`}
                    onClick={() => onOpenChat(c)}
                    className="flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqAvatar src={c.avatar} alt={displayNameOf(c) || c.name} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px]">
                        <QqHighlight text={displayNameOf(c) || c.name} kw={kw} />
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-black/35 dark:text-white/35">QQ:{c.qqId || '未设置'}</span>
                    </span>
                    {c.id !== me.id && (
                      <span
                        className="shrink-0 rounded-full px-3.5 py-[5px] text-[12px] text-white"
                        style={{ backgroundColor: QQ_BLUE }}
                        aria-hidden="true"
                      >
                        发消息
                      </span>
                    )}
                  </button>
                ))}
              </section>
            )}

            {/* 群聊 */}
            {hitGroups.length > 0 && (
              <section data-testid="qq-search-groups">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">群聊</p>
                {hitGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`qq-search-group-${g.id}`}
                    onClick={() => onOpenGroup(g)}
                    className="flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqGroupAvatar group={g} contacts={contacts} size={40} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">
                      <QqHighlight text={g.remark || g.name} kw={kw} />
                    </span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                ))}
              </section>
            )}

            {/* 聊天记录 */}
            {hitMsgs.length > 0 && (
              <section data-testid="qq-search-msgs">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">聊天记录</p>
                {hitMsgs.map((h, i) => (
                  <button
                    key={`${h.key}-${h.time}-${i}`}
                    type="button"
                    data-testid="qq-search-msg-item"
                    onClick={() => {
                      if (h.isGroup && h.group) onOpenGroup(h.group);
                      else if (h.contact) onOpenChat(h.contact);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    {h.isGroup && h.group ? (
                      <span className="shrink-0">
                        <QqGroupAvatar group={h.group} contacts={contacts} size={40} />
                      </span>
                    ) : (
                      <QqAvatar src={h.avatar} alt={h.title} size={40} />
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
          </>
        )}
      </div>
      <span className="sr-only">{me.name}的QQ搜索</span>
    </div>
  );
}

// ---------------- 消息页 ----------------

/** 会话长按操作持久化（置顶迁移至 @/lib/chat-flags 的 qqChatFlags 表；已删除会话后有新消息自动重新出现）。
 *  多账号 v2（Task 40-2b）：读写现算 accLs(key,'qq') 按账号隔离（大号=原键，各账号隐藏会话互不串） */
const LS_CHAT_HIDDEN = 'qq-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
const qqUnreads = qqUnreadStore;

function loadStrList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function saveStrList(key: string, list: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 忽略
  }
}

function MessagesPage({
  me,
  contacts,
  liquid = false,
  retro = false,
  onOpenChat,
  onOpenGroup,
  onOpenDrawer,
  onAvatar,
  onAddFriend,
  onCreateGroup,
  onOpenSearch,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊玻璃化 + 会话列表玻璃卡 + 滚动底部为悬浮 TabBar 让位 */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 会话列表白色硬边分组卡 */
  retro?: boolean;
  onOpenChat: (c: ContactRecord) => void;
  /** 打开某个 QQ 群聊（群会话行） */
  onOpenGroup: (g: ChatGroup) => void;
  onOpenDrawer: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  /** 发起群聊（建群页）——入口在消息页右上角加号菜单 */
  onCreateGroup: () => void;
  /** 点击搜索框：进全屏搜索页（对照真 QQ，搜索在独立页里做） */
  onOpenSearch: () => void;
  onToast: (m: string) => void;
}) {
  // 右上角加号菜单（对照真 QQ：创建群聊/创建频道/加好友/群/扫一扫/传文件/收付款）
  const [plusMenu, setPlusMenu] = useState(false);
  // 右滑手势：页面任意位置（输入控件除外）水平右滑 → 个人中心抽屉
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  // 会话管理：置顶 / 免打扰（chat-flags 总线）/ 未读 / 已删除（长按菜单操作，localStorage 持久化）
  const flagsMap = useChatFlags(qqChatFlagsStore);
  const unreads = useUnreadMap(qqUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(accLs(LS_CHAT_HIDDEN, 'qq')));
  // 好友来信 / 未读变化 tick：会话预览派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => qqUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('qq:', () => setMsgTick((t) => t + 1));
  // 长按菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字/深色深底白字；位置在长按触发时计算好，render 不读 ref）
  const [ctx, setCtx] = useState<null | { row: SessionRow; x: number; y: number; arrow: 'down' | 'up'; arrowX: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx > 50 && Math.abs(dy) < 80) {
      t.fired = true;
      onOpenDrawer();
      return;
    }
    if (dx < -30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };
  // 会话 = 已加好友的 char/npc + 自己（自我会话也显示；已删除会话隐藏，收到新消息自动恢复；置顶优先）
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );
  /** 会话行：私聊（contact）或群聊（group）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  interface SessionRow {
    key: string;
    name: string;
    contact: ContactRecord | null;
    group: ChatGroup | null;
    text: string;
    time: number;
  }
  // QQ 群聊（与私聊同列表展示但各自独立会话；tab 切换重挂载时现场读取即最新）
  // 退群挽留：AI 把机主拉回群后（quit-flow 广播恢复事件）立刻重读群池，恢复的群即时回到列表
  const [groupsTick, setGroupsTick] = useState(0);
  useEffect(() => {
    const fn = () => setGroupsTick((v) => v + 1);
    window.addEventListener('quit-flow:group-restored', fn);
    return () => window.removeEventListener('quit-flow:group-restored', fn);
  }, []);
  const chatGroups = useMemo(() => {
    void groupsTick;
    return listChatGroups('qq');
  }, [groupsTick]);
  /** 全量会话（未套搜索过滤）：幽灵未读清理必须以全量列表为准，否则搜索时会把列表外会话的未读误删 */
  const baseConversations = useMemo<SessionRow[]>(() => {
    // 性能：原实现对每个联系人调 2 次 loadMsgs（filter 判空 + map 取预览），每次全量克隆
    // + reverse 再克隆；改为 kv 内存缓存直读原始数组：判空只看 length，预览从尾部扫描
    // 最后一条实质消息（预览只用 kind/recalled/notice/call/fwd/content 等原始记录就有的字段）
    const rawCountOf = (id: string): number => {
      const r = kvGetRaw<QQMsg[]>(lsMsgsKey(id));
      return Array.isArray(r) ? r.length : 0;
    };
    const lastRealMsgOf = (id: string): QQMsg | undefined => {
      const r = kvGetRaw<QQMsg[]>(lsMsgsKey(id));
      if (!Array.isArray(r)) return undefined;
      for (let i = r.length - 1; i >= 0; i--) {
        const m = r[i];
        if (m && m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && m.error !== true) return m;
      }
      return undefined;
    };
    const rows: SessionRow[] = contacts
      .filter(
        (c) => ((isFriendIn(c, 'qq') && c.kind !== 'user') || c.id === me.id) && !(hiddenSet.has(c.id) && rawCountOf(c.id) === 0)
      )
      .map((c) => {
        // 通知行/系统提示行/申请卡片/错误占位（旧版失败落库文案）不作为会话预览，回退到最后一条实质消息
        const last = lastRealMsgOf(c.id);
        return { key: c.id, name: c.name, contact: c, group: null, text: msgPreview(last), time: last?.time ?? 0 };
      });
    // 群会话行（群聊与私聊是两类会话，各自独立显示；隐藏后不再出现，可从联系人 › 群聊 再进）
    for (const g of chatGroups) {
      if (hiddenSet.has(qqGroupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      rows.push({ key: qqGroupRowId(g.id), name: g.remark?.trim() || g.name, contact: null, group: g, text: p.text, time: p.time });
    }
    rows.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.time !== b.time) return b.time - a.time;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return rows;
  }, [contacts, me.id, hiddenSet, pinSet, msgTick, chatGroups]);
  const conversations = baseConversations;

  /** 幽灵未读清理：只保留当前会话列表里的未读（已删除会话/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 baseConversations 重算触发） */
  useEffect(() => {
    qqUnreads.prune(baseConversations.map((row) => row.key));
  }, [baseConversations]);

  // 退出网页接力：服务端代跑的回复已待达的会话 → 未读角标（同一批条目只在第一次查询时提示，
  // peek 内部 localStorage 去重；进聊天页正式拉取投递后自动解除）。只认 QQ 私聊会话键
  //（qq:<联系人 id>，bump 用未读表的真实键 = 联系人 id）；群聊没有会话页拉取，qq:group: 键过滤兜底
  useEffect(() => {
    void peekBgBadgeCounts().then((counts) => {
      for (const [key, n] of Object.entries(counts)) {
        if (!key.startsWith('qq:') || key.startsWith('qq:group:')) continue;
        qqUnreads.bump(key.slice(3), n);
      }
    });
  }, []);

  // 长按检测：按住 480ms 弹出会话操作菜单；移动超 12px 视为滚动取消
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, row: SessionRow) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      // 横向单行条（3 项，约 234×64）：默认在触点上方（箭头朝下指向会话行），上方放不下翻到下方
      const root = rootRef.current;
      const rect = root?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      const rootW = root?.clientWidth ?? 360;
      const rootH = root?.clientHeight ?? 600;
      const MENU_W = 234;
      const MENU_H = 64;
      const x = Math.min(Math.max(px - MENU_W / 2, 6), Math.max(rootW - MENU_W - 6, 6));
      let y = py - MENU_H - 14;
      let arrow: 'down' | 'up' = 'down';
      if (y < 6) {
        y = py + 16;
        arrow = 'up';
      }
      y = Math.min(y, Math.max(rootH - MENU_H - 12, 6));
      const arrowX = Math.min(Math.max(px - x, 24), MENU_W - 24);
      setCtx({ row, x, y, arrow, arrowX });
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

  // 菜单操作（置顶/未读/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    qqChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => qqUnreads.toggle(id);
  const markRead = (id: string) => qqUnreads.clear(id);
  const removeSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    qqQueueDelete(id); // #30 排队补跑一并清除：旧实现留着，流空闲后会对已删除会话凭空补跑一轮 AI 回复
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(accLs(LS_CHAT_HIDDEN, 'qq'), nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    qqUnreads.clear(id);
    // #18 记忆锚点一并重置：消息计数/增量锚点清零，下次开聊记忆提取从干净状态重新计数
    //（记忆碎片本体保留：删除会话 ≠ 删除记忆；异步不阻塞主流程）
    void memResetConvoCounters(id);
  };
  /** 群会话删除：只从消息列表移除该行（群本体与聊天记录保留，可从联系人 › 群聊 再进） */
  const removeGroupSession = (key: string) => {
    const nextHidden = hidden.includes(key) ? hidden : [...hidden, key];
    saveStrList(accLs(LS_CHAT_HIDDEN, 'qq'), nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(key);
    qqUnreads.clear(key);
    onToast('已从列表移除，群聊保留在联系人 › 群聊');
  };

  /** 消息页右上角加号下拉菜单项（默认白色卡与液态玻璃竖列两个分支共用；图标 21px，液态分支用 CSS 缩到 18px 保默认主题零变化） */
  const plusMenuItems = [
    { key: 'create-group', label: '创建群聊', icon: <MessageSquarePlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onCreateGroup(); } },
    { key: 'create-channel', label: '创建频道', icon: <Hash className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('创建频道暂未开放'); } },
    { key: 'add-friend', label: '加好友/群', icon: <UserPlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onAddFriend(); } },
    { key: 'scan', label: '扫一扫', icon: <ScanLine className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); openScan('qq'); } },
    { key: 'send-file', label: '传文件', icon: <FolderOutput className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('传文件暂未开放'); } },
    { key: 'pay', label: '收付款', icon: <JapaneseYen className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('收付款暂未开放'); } },
  ] as const;

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col"
      onPointerDown={onSwipeStart}
      onPointerMove={onSwipeMove}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onPointerUp={() => {
        // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
        window.setTimeout(() => {
          swipe.current = null;
        }, 0);
      }}
      onClickCapture={(e) => {
        if (swipe.current?.fired) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <QqHeader
        user={me}
        title={me.name}
        subtitle={<OnlineBadge />}
        retro={retro}
        onAvatar={onAvatar}
        action={
          <div className="relative">
            <button
              type="button"
              aria-label="添加"
              aria-expanded={plusMenu}
              data-testid="qq-msgs-add"
              className={
                liquid
                  ? /* 液态（第四十五轮，用户指定）：玻璃圆圈内嵌黑色圆圈（同微信语音钮样式）；
                     第四十八轮（用户指定）：按钮变小一点 38→34px（内圈 28→24、图标 18→15） */
                    'lg-chip flex h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-60'
                  : 'rounded-full p-1.5 active:bg-black/5'
              }
              onClick={() => setPlusMenu((v) => !v)}
            >
              {liquid ? (
                <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 dark:border-white/70 dark:text-white/90">
                  <Plus className={`h-[15px] w-[15px] transition-transform duration-200 ${plusMenu ? 'rotate-45' : ''}`} strokeWidth={2.1} />
                </span>
              ) : (
                <Plus className={`h-6 w-6 transition-transform duration-200 ${plusMenu ? 'rotate-45' : ''}`} strokeWidth={2} />
              )}
            </button>
            {/* 加号下拉菜单：默认 = 白色圆角面板 + 指向箭头（对照需求截图）；液态 = 乳白强模糊玻璃竖列（lg-sheet 无箭头）；点击面板外关闭 */}
            {plusMenu && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPlusMenu(false)} />
                {liquid ? (
                  <div
                    data-testid="qq-msgs-plus-menu"
                    className="lg-sheet absolute right-0 top-[calc(100%+8px)] z-50 w-[208px] overflow-hidden rounded-[18px] py-[4px]"
                    role="menu"
                  >
                    {plusMenuItems.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        role="menuitem"
                        data-testid={`qq-plus-${it.key}`}
                        onClick={it.action}
                        className="lg-menu-row flex h-[40px] w-full items-center gap-3 px-4 text-left text-[13.5px] font-semibold text-[#1C1C1E] dark:text-white/90 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                      >
                        <span className="shrink-0 text-black/80 dark:text-white/85">{it.icon}</span>
                        {it.label}
                      </button>
                    ))}
                  </div>
                ) : (
                <div
                  data-testid="qq-msgs-plus-menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[172px] rounded-[14px] bg-white p-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.16)] dark:bg-[#2A2C31] dark:shadow-[0_6px_28px_rgba(0,0,0,0.5)]"
                >
                  <span aria-hidden="true" className="absolute -top-[5px] right-[13px] block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white dark:bg-[#2A2C31]" />
                  {plusMenuItems.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      data-testid={`qq-plus-${it.key}`}
                      onClick={it.action}
                      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-[9px] text-left active:bg-black/5 dark:active:bg-white/10"
                    >
                      <span className="shrink-0 text-black/70 dark:text-white/70">{it.icon}</span>
                      <span className="text-[15px]">{it.label}</span>
                    </button>
                  ))}
                </div>
                )}
              </>
            )}
          </div>
        }
      />
      <div className="px-4 pb-2 pt-1">
        {/* 搜索框（点击进全屏搜索页，对照真 QQ 与需求截图 2） */}
        <button
          type="button"
          data-testid="qq-search-entry"
          aria-label="搜索"
          onClick={onOpenSearch}
          className={
            liquid
              ? 'flex h-[36px] w-full items-center gap-1.5 rounded-full lg-search px-3 text-left'
              : retro
              ? 'flex h-[36px] w-full items-center gap-1.5 rt-search px-3 text-left'
              : 'flex h-[36px] w-full items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-left active:bg-black/[0.08] dark:bg-white/[0.08] dark:active:bg-white/[0.12]'
          }
        >
          <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
          <span className="text-[15px] text-black/30 dark:text-white/30">搜索</span>
        </button>
      </div>
      <div className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto'} style={{ touchAction: 'pan-y' }}>
        {conversations.length === 0 && (
          <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">
            还没有会话，去「联系人」App 添加好友吧
          </p>
        )}
        {/* 液态玻璃（用户指定）：背景跟真实 App 一致（与默认同底色）——置顶会话/非置顶会话各自包一张白色面板（lg-panel），
            卡间 mt-2.5；默认主题无包裹层零变化（空态提示仍在最前，无会话不渲染空面板） */}
        {(liquid
          ? [conversations.filter((r) => pinSet.has(r.key)), conversations.filter((r) => !pinSet.has(r.key))]
          : [conversations]
        ).map((group, gi) =>
          group.length > 0 || !liquid ? (
            <div key={gi} className={liquid ? `lg-panel mx-2.5 overflow-hidden ${gi > 0 ? 'mt-2.5' : ''}` : retro ? 'mx-2 rt-panel overflow-hidden' : ''}>
              {group.map((row) => {
          const pinned = pinSet.has(row.key);
          const unreadCount = unreads[row.key] ?? 0;
          return (
            <button
              key={row.key}
              type="button"
              data-testid={`qq-session-${row.key}`}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                markRead(row.key);
                if (row.contact) onOpenChat(row.contact);
                else if (row.group) onOpenGroup(row.group);
              }}
              onPointerDown={(e) => onSessionPointerDown(e, row)}
              onPointerMove={onSessionPointerMove}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onPointerLeave={clearPress}
              /* qq-session-row：会话行锚点（自定义 CSS 示例模板可改行底/置顶色） */
              className={`qq-session-row flex w-full select-none items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05] ${
                pinned ? 'bg-[#F0F1F5] dark:bg-white/[0.06]' : ''
              }`}
            >
              <span className="relative shrink-0">
                {row.contact ? (
                  <QqAvatar src={row.contact.avatar} alt={row.contact.name} size={52} />
                ) : (
                  row.group && <QqGroupAvatar group={row.group} contacts={contacts} size={52} />
                )}
                {unreadCount > 0 && (
                  <span
                    data-testid={`qq-unread-badge-${row.key}`}
                    aria-label={`${unreadCount} 条未读`}
                    className={
                      flagsMap[row.key]?.muted === true
                        ? /* 免打扰：不显示数字，只显示小红点 */
                          'absolute -right-[2px] -top-[2px] block h-[10px] w-[10px] rounded-full bg-[#F5455C] ring-2 ring-white dark:ring-[#111214]'
                        : 'absolute -right-2 -top-2 flex h-[21px] min-w-[21px] items-center justify-center rounded-full bg-[#F5455C] px-[6px] text-[12px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.28)] ring-2 ring-white dark:ring-[#111214]'
                    }
                  >
                    {flagsMap[row.key]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[16px] font-medium leading-snug">{row.name}</div>
                  {/* 情侣空间标识（第十轮）：会话列表名字后也显示徽章+钥匙，与聊天页同源同显隐 */}
                  <CoupleMark contactId={row.contact?.id ?? null} size={20} testId={`qq-list-couple-mark-${row.key}`} />
                  {flagsMap[row.key]?.muted === true && (
                    <BellOff className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                  )}
                </div>
                <div className="truncate text-[13px] text-black/35 dark:text-white/35">{row.text}</div>
              </div>
              <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{fmtListTime(row.time)}</span>
            </button>
          );
              })}
            </div>
          ) : null,
        )}
      </div>

      {/* 长按会话菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="qq-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute z-50" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {/* 小箭头：指向长按的会话行（菜单在上方时朝下，在下方时朝上） */}
              <span
                aria-hidden="true"
                className={`absolute z-10 h-[12px] w-[12px] rotate-45 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-[#4C4C4C] ${
                  ctx.arrow === 'down' ? '-bottom-[5px]' : '-top-[5px]'
                }`}
                style={{ left: ctx.arrowX - 6 }}
              />
              <div
                role="menu"
                aria-label="会话操作"
                data-testid="qq-session-ctx"
                className="relative flex w-[234px] divide-x divide-black/[0.08] overflow-hidden rounded-[10px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:divide-white/15 dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-pin"
                  onClick={() => {
                    togglePin(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  {pinSet.has(ctx.row.key) ? (
                    <PinOff className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <Pin className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  )}
                  {pinSet.has(ctx.row.key) ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-unread"
                  onClick={() => {
                    toggleUnread(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  <MailOpen className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {unreads[ctx.row.key] ? '标为已读' : '标为未读'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-delete"
                  onClick={() => {
                    if (ctx.row.group) removeGroupSession(ctx.row.key);
                    else removeSession(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] text-[#F5455C] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10"
                >
                  <Trash2 className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {ctx.row.group ? '移除会话' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 联系人页 ----------------

const CT_TABS = ['分组', '好友', '群聊', '频道', '机器人', '设备'] as const;
type CtTab = (typeof CT_TABS)[number];

function ContactsPage({
  me,
  contacts,
  liquid = false,
  retro = false,
  onOpenProfile,
  onOpenMeProfile,
  onAvatar,
  onAddFriend,
  onOpenNewFriends,
  onOpenGroup,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊/列表分组玻璃化 + 滚动底部为悬浮 TabBar 让位 */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 列表白色硬边分组卡 */
  retro?: boolean;
  onOpenProfile: (c: ContactRecord) => void;
  onOpenMeProfile: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  onOpenNewFriends: () => void;
  /** 打开某个 QQ 群聊 */
  onOpenGroup: (g: ChatGroup) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<CtTab>('分组');
  const [expandSpecial, setExpandSpecial] = useState(false);
  const [expandFriends, setExpandFriends] = useState(true);
  // QQ 群聊（联系人 › 群聊 tab；tab 切换会重挂载本页，现场读取即最新）
  const chatGroups = useMemo(() => listChatGroups('qq'), []);
  const filteredGroups = useMemo(() => {
    const kw2 = q.trim().toLowerCase();
    return kw2 ? chatGroups.filter((g) => g.name.toLowerCase().includes(kw2) || (g.remark ?? '').toLowerCase().includes(kw2)) : chatGroups;
  }, [chatGroups, q]);

  const friends = useMemo(() => contacts.filter((c) => isFriendIn(c, 'qq') && c.kind !== 'user'), [contacts]);
  const special = useMemo(() => friends.filter((c) => c.relation?.includes('特别') || c.relation?.includes('关心')), [friends]);
  const normalFriends = useMemo(() => friends.filter((c) => !special.includes(c)), [friends, special]);

  const kw = q.trim().toLowerCase();
  const filteredFriends = useMemo(
    () => (kw ? friends.filter((c) => c.name.toLowerCase().includes(kw) || (c.qqId ?? '').includes(kw)) : friends),
    [friends, kw]
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：简洁头部（背景封面图与打卡/状态 pills 已按需求删除），头像 + 标题 + 加好友；古早主题 = 银灰拟物导航条 */}
      <div className={`flex shrink-0 items-center gap-3 px-4 pb-1 pt-3 ${retro ? 'rt-bar' : ''}`}>
        <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-80">
          <QqAvatar src={me.avatar} alt={me.name} size={44} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[20px] font-semibold text-black dark:text-white">联系人</div>
        <button
          type="button"
          aria-label="加好友"
          data-testid="qq-contacts-add"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-black/60 active:bg-black/5 dark:text-white/60 dark:active:bg-white/10"
          onClick={onAddFriend}
        >
          <UserPlus className="h-[17px] w-[17px]" strokeWidth={2} />
        </button>
      </div>
      <div className="px-4 pb-2 pt-3">
        <QqSearch value={q} onChange={setQ} liquid={liquid} retro={retro} />
      </div>

      <div className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto'} data-testid="qq-contacts-list">
        {/* 新朋友 / 群通知（液态玻璃主题：合成一张玻璃卡；古早主题：白色硬边分组卡；默认主题无包裹层零变化） */}
        <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
        <button
          type="button"
          data-testid="qq-contacts-newfriends"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={onOpenNewFriends}
        >
          <span className="text-[16px]">新朋友</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={() => onToast('群通知暂未开放')}
        >
          <span className="text-[16px]">群通知</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
        </div>

        {/* 分组 tab 行（液态玻璃：半透磨砂底，滚动时列表从底下穿过） */}
        <div
          className={
            liquid
              ? 'sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-black/[0.05] bg-[#F4F4F8]/85 px-4 py-2.5 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#101014]/85'
              : 'sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-black/[0.05] bg-[#FAFAFC]/95 px-4 py-2.5 backdrop-blur dark:border-white/[0.06] dark:bg-[#16171A]/95'
          }
        >
          {CT_TABS.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`qq-ct-tab-${t}`}
              onClick={() => setTab(t)}
              className={`relative shrink-0 pb-1.5 text-[15px] ${tab === t ? `font-semibold ${TAB_ACTIVE}` : 'text-black/55 dark:text-white/55'}`}
            >
              {t}
              {tab === t && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#1E6FFF] dark:bg-[#4AA3FF]" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {tab === '分组' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 特别关心 */}
            <button
              type="button"
              onClick={() => setExpandSpecial((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-special"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandSpecial ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">特别关心</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{special.length}/0</span>
            </button>
            {expandSpecial &&
              special.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenProfile(c)}
                  className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={42} />
                  <span className="truncate text-[15px]">{c.name}</span>
                </button>
              ))}
            {/* 我的好友 */}
            <button
              type="button"
              onClick={() => setExpandFriends((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-friends"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandFriends ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">我的好友</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{friends.length}/{friends.length}</span>
            </button>
            {expandFriends && (
              <>
                {/* 我：好友列表首位（点击进自己的资料页） */}
                <button
                  type="button"
                  data-testid="qq-contacts-me"
                  onClick={onOpenMeProfile}
                  className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={42} />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px]">{me.name}</span>
                    <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                  </span>
                </button>
                {normalFriends.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenProfile(c)}
                    className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                  >
                    <QqAvatar src={c.avatar} alt={c.name} size={42} />
                    <span className="truncate text-[15px]">{c.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {tab === '好友' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 我：好友列表首位（搜索时仅名字命中才显示） */}
            {(!kw || me.name.toLowerCase().includes(kw)) && (
              <button
                type="button"
                data-testid="qq-contacts-me-friend"
                onClick={onOpenMeProfile}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={me.avatar} alt={me.name} size={42} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px]">{me.name}</span>
                  <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                </span>
              </button>
            )}
            {filteredFriends.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无好友</p>
            )}
            {filteredFriends.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenProfile(c)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={c.avatar} alt={c.name} size={42} />
                <span className="truncate text-[15px]">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === '群聊' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 发起群聊入口已迁移至消息页右上角「+」菜单（对照需求：创建群聊移到加号里面） */}
            {filteredGroups.length === 0 ? (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无群聊，点消息页右上角「+」创建</p>
            ) : (
              filteredGroups.map((g) => {
                const p = groupPreview(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`qq-contacts-group-${g.id}`}
                    onClick={() => onOpenGroup(g)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
                  >
                    <QqGroupAvatar group={g} contacts={contacts} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{g.remark?.trim() || g.name}</span>
                      {p.text && <span className="block truncate text-[12px] text-black/35 dark:text-white/35">{p.text}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {(tab === '频道' || tab === '机器人' || tab === '设备') && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无{tab}</p>
        )}
      </div>
    </div>
  );
}

// ---------------- 动态页 ----------------

const DISCOVER_ITEMS: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'zone', label: '空间动态', icon: <Star className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FFC300' },
  { key: 'game', label: '游戏中心', icon: <Gamepad2 className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'moments-settings', label: '空间动态设置', icon: <Settings className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'farm', label: 'QQ经典农场', icon: <Sprout className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#34C759' },
  { key: 'nearby', label: '结伴与附近', icon: <Users className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#7D5FFF' },
  { key: 'novel', label: '小说与动漫', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FF9F0A' },
  { key: 'feedback', label: '意见反馈', icon: <MessageSquarePlus className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
];

/** 古早主题动态页图标配色（DISCOVER_ITEMS.key → RetroIc tone；任务指定：zone/game/settings/farm 对应 + 其余 search/zone 兑底） */
const RETRO_DISCOVER_TONES: Record<string, string> = {
  zone: RETRO_ICON_TONES.zone,
  game: RETRO_ICON_TONES.games,
  'moments-settings': RETRO_ICON_TONES.settings,
  farm: RETRO_ICON_TONES.farm,
  nearby: RETRO_ICON_TONES.search,
  novel: RETRO_ICON_TONES.zone,
  feedback: RETRO_ICON_TONES.search,
};

function DiscoverPage({
  me,
  liquid = false,
  retro = false,
  onAvatar,
  onZone,
  onOpenMomentsSettings,
  zoneBadge = 0,
  onToast,
}: {
  me: QQUser;
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊玻璃化 + 每行独立玻璃卡（参考图 2 发现页同款） */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 彩色图标套拟物底座 */
  retro?: boolean;
  onAvatar: () => void;
  onZone: () => void;
  onOpenMomentsSettings: () => void;
  /** 空间动态未读互动消息数（红色数字角标，同真机「空间动态 1」样式） */
  zoneBadge?: number;
  onToast: (m: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <QqHeader
        user={me}
        title="动态"
        retro={retro}
        onAvatar={onAvatar}
        action={
          <button type="button" aria-label="动态管理" className="rounded-full p-1.5 active:bg-black/5" onClick={() => onToast('动态管理暂未开放')}>
            <LayoutGrid className="h-6 w-6" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-2 pt-1">
        <QqSearch value="" onChange={() => undefined} liquid={liquid} retro={retro} />
      </div>
      <div
        className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto pb-4'}
        data-testid="qq-discover-list"
      >
        {DISCOVER_ITEMS.map((it, idx) => (
          <div key={it.key} className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {!liquid && !retro && (idx === 1 || idx === 5 || idx === 6) && (
              <div className="h-2 bg-black/[0.03] dark:bg-white/[0.04]" aria-hidden="true" />
            )}
            <button
              type="button"
              data-testid={`qq-discover-${it.key}`}
              onClick={() => {
                if (it.key === 'zone') onZone();
                else if (it.key === 'moments-settings') onOpenMomentsSettings();
                else onToast(`${it.label}暂未开放`);
              }}
              className="flex w-full items-center gap-4 bg-transparent px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
            >
              {retro ? (
                /* 古早主题：彩色图标套 RetroIc 拟物底座（复古渐变 tone + 白色线稿，iOS 6 设置页风） */
                <RetroIc tone={RETRO_DISCOVER_TONES[it.key] ?? RETRO_ICON_TONES.search} size={38} radius={10}>
                  <span className="grid place-items-center text-white" aria-hidden="true">{it.icon}</span>
                </RetroIc>
              ) : (
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]" style={{ color: it.color }} aria-hidden="true">
                  {it.icon}
                </span>
              )}
              <span className="flex-1 truncate text-[16px]">{it.label}</span>
              {it.key === 'zone' && zoneBadge > 0 && (
                <span
                  data-testid="qq-discover-zone-badge"
                  aria-label={`空间动态 ${zoneBadge} 条新消息`}
                  className="mr-0.5 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#F5455C] px-[5px] text-[10.5px] font-semibold leading-none text-white"
                >
                  {zoneBadge > 99 ? '99+' : zoneBadge}
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 个人资料页 ----------------

function ProfilePage({
  me,
  onBack,
  onOpenZone,
  onOpenSettings,
  onOpenChat,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenZone: () => void;
  onOpenSettings: () => void;
  onOpenChat: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  // 头像按 App 隔离：QQ 个人资料页点头像换头像只写机主的 avatars.qq 槽位（合并语义），
  // 不影响微信/信息/电话/联系人全局头像；未设置过则 avatarFor 投影自动回退全局头像
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    void fileToAvatarDataUrl(f)
      .then((data) => updateContact(me.id, { avatars: { qq: data } }).then((rec) => ({ rec, data })))
      .then(({ rec, data }) => {
        // 第二十九轮「让 AI 知道我换头像了」：头像描述落库（异步识图）+ 给恋人角色写事件记忆
        if (rec) {
          noteAvatarChanged(me.id, 'qq', data, 'me');
          onToast('头像已更新');
        } else onToast('头像保存失败');
      })
      .catch(() => onToast('头像保存失败'));
  };
  // 跨 App 跳转：点「资料完成度/编辑资料」→ 打开联系人 App 后直接进入机主（user）的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  const openEditProfile = useCallback(() => {
    setPendingContactEdit(me.id);
    switchToApp('contacts');
  }, [me.id, setPendingContactEdit, switchToApp]);

  // 背景图：IndexedDB 永久保存，进页时恢复
  useEffect(() => {
    let alive = true;
    getQqProfileBg()
      .then((data) => {
        if (alive && data) setBgUrl(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const onBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : '';
      if (!data) return;
      setBgUrl(data);
      void setQqProfileBg(data).catch(() => onToast('背景保存失败'));
      onToast('背景已更新');
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 背景图：上传的自定义图（永久保存）> 头像模糊放大 > 蓝灰渐变；高度 320px（轨迹 280→…→290→320，用户要求「上下变大一点」），点击背景任意位置即可更换（无相机按钮） */}
      <div
        role="button"
        aria-label="更换背景"
        data-testid="qq-profile-bg-upload"
        onClick={() => bgFileRef.current?.click()}
        className="absolute inset-x-0 top-0 h-[320px] cursor-pointer"
      >
        {bgUrl ? (
          <img src={bgUrl} alt="个人资料背景" className="h-full w-full object-cover" />
        ) : me.avatar ? (
          <img
            src={me.avatar}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-125 object-cover blur-2xl brightness-[0.62]"
          />
        ) : (
          <div aria-hidden="true" className="h-full w-full bg-gradient-to-b from-[#93A9CC] to-[#5E6D88]" />
        )}
        <input ref={bgFileRef} type="file" accept="image/*" onChange={onBgFile} className="hidden" tabIndex={-1} aria-hidden="true" />
      </div>

      {/* 顶部浮钮：返回 + 宫格/铃铛/设置 */}
      <div className="relative z-10 flex items-center justify-between px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('更多暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="通知"
            onClick={() => onToast('通知暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="设置"
            data-testid="qq-profile-settings"
            onClick={onOpenSettings}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 白色圆角主卡（与背景图叠压：卡顶 215px，露出 215px 背景，叠压 105px） */}
      <div className="relative z-10 mt-[125px] flex-1 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-4 pt-6 dark:bg-[#1B1C1F]">
        {/* 头像 + 昵称/状态 + QQ号 + 点赞（点头像换头像：写 avatars.qq 槽位，仅 QQ 生效） */}
        <div className="flex items-start gap-4">
          <button
            type="button"
            aria-label="更换头像"
            data-testid="qq-profile-avatar"
            onClick={() => avatarFileRef.current?.click()}
            className="shrink-0 rounded-full transition-transform active:scale-95"
          >
            <QqAvatar src={me.avatar} alt={me.name} size={84} />
          </button>
          <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={onAvatarFile} />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <span className="max-w-[130px] truncate text-[20px] font-bold leading-tight">{me.name}</span>
              <button
                type="button"
                onClick={() => onToast('状态暂未开放')}
                className="flex h-[26px] shrink-0 items-center gap-1 rounded-full border border-black/12 px-2.5 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                状态
              </button>
            </div>
            <div className="mt-1.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-profile-qqid">
              QQ:{me.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            onClick={() => onToast('点赞暂未开放')}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/65 active:opacity-60 dark:text-white/65"
          >
            <ThumbsUp className="h-5 w-5" strokeWidth={1.9} />
            <span className="text-[12px]">60</span>
          </button>
        </div>

        {/* 个签（点击就地编辑，保存到联系人库） */}
        {editSign ? (
          <input
            data-testid="qq-profile-sign-input"
            value={signDraft}
            autoFocus
            onChange={(e) => setSignDraft(e.target.value)}
            onBlur={commitSign}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSign();
              if (e.key === 'Escape') {
                setSignDraft(me.persona ?? '');
                setEditSign(false);
              }
            }}
            maxLength={60}
            placeholder="编辑个签，展示我的独特态度。"
            aria-label="编辑个性签名"
            className="mt-5 h-9 w-full rounded-[8px] bg-black/[0.05] px-3 text-[15px] outline-none dark:bg-white/[0.08]"
          />
        ) : (
          <button
            type="button"
            data-testid="qq-profile-sign"
            onClick={() => {
              setSignDraft(me.persona ?? '');
              setEditSign(true);
            }}
            className="mt-5 flex w-full items-center justify-between gap-3 text-left active:opacity-70"
          >
            <span className="truncate text-[15px]">{me.persona || '编辑个签，展示我的独特态度。'}</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        )}

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除） */}
        <QqBadgeWall testid="qq-profile-badges" mtClass="mt-4" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 添加标签 */}
        <button
          type="button"
          onClick={() => onToast('标签暂未开放')}
          className="mt-5 flex h-8 items-center gap-1.5 rounded-[8px] bg-black/[0.045] px-3 text-[13px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
        >
          添加标签
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* 资料完成度（点击 → 联系人 App 机主编辑页） */}
        <div className="-mx-5 mt-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-profile-completion"
          onClick={openEditProfile}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <FileText className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">资料完成度60%</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">去完善</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* QQ空间 */}
        <div className="-mx-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-profile-zone"
          onClick={onOpenZone}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <Star className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">QQ空间</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">分享新鲜事</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮 */}
      <div className="relative z-10 flex shrink-0 gap-3 bg-white px-4 pb-[40px] pt-3 dark:bg-[#1B1C1F]">
        <button
          type="button"
          onClick={() => onToast('个性名片暂未开放')}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          个性名片
        </button>
        <button
          type="button"
          data-testid="qq-profile-edit"
          onClick={openEditProfile}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          编辑资料
        </button>
        <button
          type="button"
          data-testid="qq-profile-message"
          onClick={onOpenChat}
          className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发消息
        </button>
      </div>
    </div>
  );
}

// ---------------- 个人中心抽屉（消息/联系人/动态页左上头像打开） ----------------

function MeDrawer({
  me,
  onClose,
  onOpenProfile,
  onOpenWallet,
  onOpenStickers,
  onOpenFavorites,
  onOpenSettings,
  onOpenDress,
  onOpenAlbum,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenWallet: () => void;
  onOpenStickers: () => void;
  onOpenFavorites: () => void;
  onOpenSettings: () => void;
  /** 个性装扮 → 主题界面（毛玻璃胶囊：主题/气泡两个选择） */
  onOpenDress: () => void;
  onOpenAlbum: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  /** 切换账号弹出卡片（对照截图样式）：胶囊按钮点开，点外面/再点关闭 */
  const [accCardOpen, setAccCardOpen] = useState(false);
  /** 用户第九轮：天气城市按钮跟随天气 App（城市名/温度/实况图标，与天气 App 共享快照） */
  const weather = useWeatherSnapshot();
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = () => {
    setShown(false);
    window.setTimeout(onClose, 240);
  };

  // 左滑手势：面板任意位置（输入控件除外）水平左滑 → 关闭抽屉（配合右滑打开）
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx < -50 && Math.abs(dy) < 80) {
      t.fired = true;
      close();
      return;
    }
    if (dx > 30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const listRows: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }[] = [
    { icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '相册', onClick: () => { close(); window.setTimeout(onOpenAlbum, 240); } },
    { icon: <Star className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '收藏', onClick: () => { close(); window.setTimeout(onOpenFavorites, 240); } },
    { icon: <Smile className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '表情', onClick: () => { close(); window.setTimeout(onOpenStickers, 240); } },
    { icon: <Wallet className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '钱包', onClick: () => { close(); window.setTimeout(onOpenWallet, 240); } },
    { icon: <Shirt className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '个性装扮', onClick: () => { close(); window.setTimeout(onOpenDress, 240); } },
  ];
  const rowColors = ['#F5B90F', '#3BA0FF', '#3BA0FF', '#3BA0FF', '#F0479C'];

  return (
    <div className="absolute inset-0 z-40 overflow-hidden" role="dialog" aria-label="个人中心">
      {/* 全屏独立页：整页白底 + 从左往右滑入（translate-x 从 -100% 到 0） */}
      <div
        className={`relative flex h-full flex-col overflow-hidden bg-white transition-transform duration-300 ease-out dark:bg-[#17181C] ${
          shown ? 'translate-x-0' : '-translate-x-full'
        }`}
        onPointerDown={onSwipeStart}
        onPointerMove={onSwipeMove}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerUp={() => {
          // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
          window.setTimeout(() => {
            swipe.current = null;
          }, 0);
        }}
        onClickCapture={(e) => {
          if (swipe.current?.fired) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {/* 切换账号弹出卡片（对照真实 QQ 截图：头像+名字+号码+当前蓝勾；匿名号不在此展示——
            匿名号码只属于电话/信息，2025 需求移除卡片内的匿名账号行） */}
        {accCardOpen && (
          <QqDrawerAccountCard
            onPick={(id) => {
              setAccCardOpen(false);
              switchAccountFor('qq', id);
            }}
            onClose={() => setAccCardOpen(false)}
          />
        )}
        {/* 整页滚动：顶部（打卡/头像/昵称）随内容一起滚动，不再固定 */}
        <div className="relative flex-1 overflow-y-auto">
        {/* 顶部（无背景图）：打卡/状态 pills 缩小行置顶，其下头像/昵称/切换账号；点击行间空白处关闭抽屉 */}
        <div className="relative w-full px-4 pb-1 pt-[62px]" onClick={close}>
          <div className="relative z-10" onClick={(e) => e.stopPropagation()}>
            <QqCheckinPills testidPrefix="qq-drawer" onToast={onToast} />
          </div>
          {/* 头像 + 昵称 + 切换账号 + 关闭（打卡/状态 pills 正下方） */}
          <div className="relative z-10 mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="查看个人资料" data-testid="qq-drawer-avatar" onClick={onOpenProfile} className="rounded-full active:opacity-80">
              <QqAvatar src={me.avatar} alt={me.name} size={64} />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-label="查看个人资料"
                data-testid="qq-drawer-name"
                onClick={onOpenProfile}
                className="block max-w-full truncate text-left text-[20px] font-bold leading-tight active:opacity-70"
              >
                {me.name}
              </button>
              <button
                type="button"
                data-testid="qq-drawer-switch"
                onClick={() => setAccCardOpen(true)}
                className="mt-1.5 flex h-7 items-center rounded-full border border-black/12 px-3 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                切换账号
              </button>
            </div>
            <button
              type="button"
              aria-label="关闭个人中心"
              data-testid="qq-drawer-close"
              onClick={close}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              <X className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 白色主卡（整页白底；无背景图，内容从个签开始紧随顶部） */}
        <div className="relative px-5 pb-2 pt-3">
          {/* 个签（可编辑） */}
          <div className="mt-3 flex items-center gap-2">
            <SquarePen className="h-4 w-4 shrink-0 text-black/45 dark:text-white/45" aria-hidden="true" />
            {editSign ? (
              <input
                data-testid="qq-drawer-sign-input"
                value={signDraft}
                autoFocus
                onChange={(e) => setSignDraft(e.target.value)}
                onBlur={commitSign}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSign();
                  if (e.key === 'Escape') {
                    setSignDraft(me.persona ?? '');
                    setEditSign(false);
                  }
                }}
                maxLength={60}
                placeholder="编辑个签，展示我的独特态度。"
                className="h-8 w-full rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none dark:bg-white/[0.08]"
              />
            ) : (
              <button
                type="button"
                data-testid="qq-drawer-sign"
                onClick={() => {
                  setSignDraft(me.persona ?? '');
                  setEditSign(true);
                }}
                className="truncate text-left text-[15px] text-black/60 active:opacity-60 dark:text-white/60"
              >
                {me.persona || '编辑个签，展示我的独特态度。'}
              </button>
            )}
          </div>

          {/* 天气 + 添加标签 */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[18px]" aria-hidden="true">
              🌤️
            </span>
            <button
              type="button"
              onClick={() => onToast('标签暂未开放')}
              className="flex h-8 items-center gap-1 rounded-full border border-black/12 px-3 text-[13px] text-black/55 active:opacity-60 dark:border-white/20 dark:text-white/55"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              添加标签
            </button>
          </div>

          {/* 通知 | 赞 + 创建QQ秀 */}
          <div className="mt-5 flex items-center text-[14px] text-black/65 dark:text-white/65">
            <button type="button" onClick={() => onToast('通知暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <Bell className="h-4 w-4" aria-hidden="true" />
              通知
            </button>
            <span className="mx-3 h-3.5 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
            <button type="button" onClick={() => onToast('赞暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />60
            </button>
            <button
              type="button"
              onClick={() => onToast('QQ秀暂未开放')}
              className="ml-auto flex h-8 items-center gap-1 rounded-full bg-black/[0.05] px-3 text-[13px] active:opacity-60 dark:bg-white/[0.08]"
            >
              🐧 创建QQ秀
            </button>
          </div>

          {/* 功能列表 */}
          <div className="mt-4">
            {listRows.map((r, i) => (
              <button
                key={r.label}
                type="button"
                onClick={r.onClick}
                className="flex h-[54px] w-full items-center gap-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center" style={{ color: rowColors[i] }} aria-hidden="true">
                  {r.icon}
                </span>
                <span className="flex-1 truncate text-[16px]">{r.label}</span>
                {r.hint && <span className="text-[13px] text-black/30 dark:text-white/30">{r.hint}</span>}
                <ChevronRight className="h-5 w-5 shrink-0 text-black/22 dark:text-white/25" aria-hidden="true" />
              </button>
            ))}
          </div>

        </div>
        </div>

        {/* 底部：设置 / 夜间 / 天气城市（固定在抽屉底部；用户第九轮：按钮上下变小+城市跟随天气 App；
            用户第十三轮：三个按钮再往下移（pb 34→20px，贴近抽屉底缘）） */}
        <div className="shrink-0 px-5 pb-[20px] pt-4">
          <div className="flex items-start justify-around border-t border-black/[0.05] pt-3.5 dark:border-white/[0.06]">
            {[
              { icon: <Settings className="h-[19px] w-[19px]" strokeWidth={1.9} />, label: '设置', sub: null, fn: onOpenSettings, testid: 'qq-drawer-settings' },
              { icon: <Moon className="h-[19px] w-[19px]" strokeWidth={1.9} />, label: '夜间', sub: null, fn: () => onToast('夜间模式跟随系统设置'), testid: 'qq-drawer-night' },
              {
                icon: weather ? (
                  (() => {
                    const WxIcon = weatherCodeInfo(weather.current.code).Icon;
                    return <WxIcon className="h-[19px] w-[19px]" strokeWidth={1.9} />;
                  })()
                ) : (
                  <CloudSun className="h-[19px] w-[19px]" strokeWidth={1.9} />
                ),
                label: weather?.name?.trim() || '天气',
                sub: weather ? `${Math.round(weather.current.temperature)}° ${weatherCodeInfo(weather.current.code).label}` : null,
                fn: () => onToast('天气详见「天气」App'),
                testid: 'qq-drawer-weather',
              },
            ].map((b) => (
              <button
                key={b.testid}
                type="button"
                data-testid={b.testid}
                onClick={() => {
                  if (b.label === '设置') {
                    close();
                    window.setTimeout(b.fn, 240);
                  } else {
                    b.fn();
                  }
                }}
                className="flex w-16 flex-col items-center gap-[3px] text-black/60 active:opacity-60 dark:text-white/60"
              >
                {b.icon}
                <span className="text-[11px] leading-none">{b.label}</span>
                <span className="h-[13px] text-[10px] leading-[13px] text-black/40 dark:text-white/40">
                  {b.sub ?? '\u00A0'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 添加好友页（找人/找群 + 七宫格 + 推荐） / 新朋友页（可能想认识的人） ----------------

function AddPersonRow({
  c,
  busy,
  onAdd,
  onOpen,
}: {
  c: ContactRecord;
  busy: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" aria-label={`查看${c.name}`} onClick={onOpen} className="rounded-full active:opacity-80">
        <QqAvatar src={c.avatar} alt={c.name} size={56} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[16px] font-medium">{c.name}</span>
        </div>
        {(c.age || c.region) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c.age && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.gender === '男' ? '♂' : c.gender === '女' ? '♀' : ''}
                {c.age}岁
              </span>
            )}
            {c.region && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.region}
              </span>
            )}
          </div>
        )}
        <div className="mt-0.5 truncate text-[12px] text-black/35 dark:text-white/35">有共同好友</div>
      </div>
      <button
        type="button"
        data-testid={`qq-add-btn-${c.id}`}
        disabled={busy}
        onClick={onAdd}
        className="h-10 shrink-0 rounded-full border border-black/15 px-6 text-[15px] text-black/70 active:bg-black/5 disabled:opacity-50 dark:border-white/25 dark:text-white/70"
      >
        添加
      </button>
    </div>
  );
}

function AddFriendPage({
  me,
  contacts,
  onBack,
  onOpenApply,
  onOpenReqDetail,
  onOpenChat,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onBack: () => void;
  /** 推荐位点「添加」→ 申请添加朋友页（验证信息/备注/分组/权限） */
  onOpenApply: (c: ContactRecord) => void;
  /** 搜索结果点人（非好友）→ 好友申请详情页（资料预览）→ 前往验证 → 申请添加朋友页 */
  onOpenReqDetail: (c: ContactRecord) => void;
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const [tab, setTab] = useState<'找人' | '找群'>('找人');

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);
  // 搜索：仅按 QQ 号匹配（输入 QQ 号才出现联系人）
  const results = useMemo(() => {
    const k = kw.trim();
    if (!k) return null;
    return contacts.filter((c) => c.id !== me.id && (c.qqId ?? '').includes(k));
  }, [contacts, kw, me.id]);

  // 七宫格（对照 QQ 真机添加好友页：第一行 4 个 + 第二行 3 个）
  const gridTop: { label: string; icon: React.ReactNode }[] = [
    { label: '手机联系人', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '扫一扫', icon: <QrCode className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '面对面添加', icon: <Radio className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '条件查找', icon: <Search className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBottom: { label: string; icon: React.ReactNode }[] = [
    { label: '面对面建群', icon: <Plus className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '附近的人', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '结伴交友', icon: <Users className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBtn = (g: { label: string; icon: React.ReactNode }) => (
    <button
      key={g.label}
      type="button"
      onClick={() => (g.label === '扫一扫' ? openScan('qq') : onToast(`${g.label}暂未开放`))}
      className="flex w-full flex-col items-center gap-2 py-2.5 text-black/85 active:opacity-60 dark:text-white/85"
    >
      {g.icon}
      <span className="text-[13px]">{g.label}</span>
    </button>
  );

  const resultRows = (list: ContactRecord[]) =>
    list.map((c) =>
      isFriendIn(c, 'qq') ? (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpenChat(c)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <QqAvatar src={c.avatar} alt={c.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium">{c.name}</div>
            <div className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{c.qqId ? `QQ:${c.qqId}` : '已是好友'}</div>
          </div>
          <span
            className="h-9 shrink-0 rounded-full px-5 text-[14px] font-medium leading-9 text-white"
            style={{ backgroundColor: QQ_BLUE }}
          >
            发消息
          </span>
        </button>
      ) : (
        <button
          key={c.id}
          type="button"
          data-testid={`qq-add-result-${c.name}`}
          onClick={() => onOpenReqDetail(c)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <QqAvatar src={c.avatar} alt={c.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium">{c.name}</div>
            <div className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{c.qqId ? `QQ:${c.qqId}` : '点击查看资料并发送好友申请'}</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      ),
    );

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 找人/找群 分段（对照 QQ 真机添加好友页） */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]"
          role="tablist"
          aria-label="找人找群"
        >
          {(['找人', '找群'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`qq-addfriend-tab-${t}`}
              onClick={() => setTab(t)}
              className={`h-8 rounded-full px-6 text-[15px] ${
                tab === t
                  ? 'bg-white font-medium text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] dark:bg-[#3A3C42] dark:text-white'
                  : 'text-black/60 dark:text-white/60'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 搜索：仅输入 QQ 号才出现联系人（placeholder 居中对照真机） */}
      <div className="px-4 pb-3 pt-2">
        <div className="relative flex h-[42px] items-center rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            data-testid="qq-addfriend-search"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="QQ号/QID/手机号/群"
            aria-label="QQ号/QID/手机号/群"
            autoCapitalize="off"
            autoCorrect="off"
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-transparent dark:placeholder:text-transparent"
          />
          {!kw && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[15px] text-black/30 dark:text-white/30">
              <Search className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
              QQ号/QID/手机号/群
            </span>
          )}
          {kw && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setKw('')}
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/20 text-white dark:bg-white/25"
            >
              <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-addfriend-body">
        {tab === '找群' ? (
          kw.trim() ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的群</p>
          ) : (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">暂无群推荐</p>
          )
        ) : results ? (
          results.length === 0 ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的人</p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/35 dark:text-white/35">找到 {results.length} 人</p>
              {resultRows(results)}
            </>
          )
        ) : (
          <>
            {/* 七宫格：第一行 4 个 + 第二行 3 个（与第一行前三列对齐，对照真机） */}
            <div className="grid grid-cols-4 px-1 pb-1 pt-4">{gridTop.map(gridBtn)}</div>
            <div className="grid grid-cols-4 px-1 pb-4">{gridBottom.map(gridBtn)}</div>

            {/* 可能想认识的人 */}
            <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
              <span className="text-[17px] font-semibold">可能想认识的人</span>
              <button
                type="button"
                onClick={() => onToast('查看更多暂未开放')}
                className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
              >
                查看更多
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {suggestions.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
            )}
            {suggestions.map((c) => (
              <AddPersonRow key={c.id} c={c} busy={false} onAdd={() => onOpenApply(c)} onOpen={() => onOpenChat(c)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 申请添加朋友页（QQ 风格：验证信息/对方备注/分组/权限 → 发送） ----------------

function ApplyFriendPage({
  me,
  target,
  onBack,
  onSend,
  onToast,
}: {
  me: QQUser;
  /** 要添加的联系人（搜索/推荐结果） */
  target: ContactRecord;
  onBack: () => void;
  /** 发送申请：宿主加好友 + 写「好友通知」+ 恢复被删状态 */
  onSend: (payload: { greeting: string; extras: FriendReqExtras }) => void;
  onToast: (m: string) => void;
}) {
  // 招呼语会进对方 AI 的上下文：恒用真名（用户规则：AI 永不知道机主昵称）
  const [greeting, setGreeting] = useState(`我是${me.realName || me.name}`);
  const [remark, setRemark] = useState('');
  const [hideMine, setHideMine] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：取消 + 添加好友 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="取消" data-testid="qq-apply-close" onClick={onBack} className="-ml-1 rounded-full p-1.5 text-[16px] active:bg-black/5 dark:text-white/85">
          取消
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">添加好友</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" data-testid="qq-apply-body">
        {/* 对方信息 */}
        <div className="flex items-center gap-3 py-4">
          <QqAvatar src={target.avatar} alt={target.name} size={64} />
          <span className="min-w-0 truncate text-[19px] font-semibold">{target.name}</span>
        </div>

        <p className="pb-2 text-[13px] text-black/40 dark:text-white/40">填写验证信息</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value.slice(0, 100))}
            data-testid="qq-apply-greeting"
            className="h-[46px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">设置对方备注</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, 30))}
            placeholder="输入备注"
            data-testid="qq-apply-remark"
            className="h-[46px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">分组设置</p>
        <button
          type="button"
          onClick={() => onToast('分组暂未开放')}
          className="flex h-[46px] w-full items-center justify-between rounded-[12px] bg-[#F2F3F5] px-3.5 active:opacity-70 dark:bg-white/[0.08]"
        >
          <span className="text-[15px]">我的好友</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">权限设置</p>
        <div className="flex h-[46px] items-center justify-between rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <span className="text-[15px]">不让他看我的动态</span>
          <ChatToggle on={hideMine} onChange={setHideMine} accent="#0099FF" testId="qq-apply-hide-mine" label="不让他看我的动态" />
        </div>

        <button
          type="button"
          data-testid="qq-apply-send"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onSend({
              greeting: greeting.trim() || `我是${me.realName || me.name}`,
              extras: { remark: remark.trim() || null, hideMine },
            });
          }}
          className="mb-8 mt-10 h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-60"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

// ---------------- 新朋友页（联系人页「新朋友」进入；右上「添加」→ 添加好友页） ----------------

function NewFriendsPage({
  me,
  contacts,
  reqs,
  onBack,
  onOpenAdd,
  onOpenChat,
  onOpenApply,
  onOpenReq,
  onAccept,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 好友通知列表（friend-state 落盘；AI 加回申请/手动添加共用） */
  reqs: FriendReqEntry[];
  onBack: () => void;
  onOpenAdd: () => void;
  onOpenChat: (c: ContactRecord) => void;
  /** 推荐位点「添加」→ 申请添加朋友页 */
  onOpenApply: (c: ContactRecord) => void;
  /** 点通知行 → 好友申请详情页 */
  onOpenReq: (r: FriendReqEntry) => void;
  /** 直接同意（列表内「同意」按钮） */
  onAccept: (r: FriendReqEntry) => void;
  onToast: (m: string) => void;
}) {
  const [showSync, setShowSync] = useState(true);

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 新朋友 + 添加 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">新朋友</span>
        <button
          type="button"
          data-testid="qq-newfriends-add"
          onClick={onOpenAdd}
          className="ml-auto text-[16px] text-black/75 active:opacity-60 dark:text-white/75"
        >
          添加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-newfriends-body">
        {/* 同步通讯录横幅 */}
        {showSync && (
          <div className="flex h-[58px] items-center gap-3 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
            <span className="flex-1 text-[16px]">开启通讯录，快速找到好友</span>
            <button
              type="button"
              data-testid="qq-newfriends-sync"
              onClick={() => onToast('通讯录同步已启用')}
              className="h-9 shrink-0 rounded-full px-5 text-[15px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              启用
            </button>
            <button
              type="button"
              aria-label="关闭同步通讯录"
              data-testid="qq-newfriends-sync-close"
              onClick={() => setShowSync(false)}
              className="shrink-0 rounded-full p-1.5 text-black/35 active:bg-black/5 dark:text-white/35"
            >
              <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="h-2.5 bg-black/[0.035] dark:bg-white/[0.05]" aria-hidden="true" />

        {/* 好友通知（AI 加回申请 / 手动添加记录）：待处理可同意，点行进详情 */}
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-[17px] font-semibold">好友通知</span>
          <button type="button" onClick={() => onToast('过滤通知暂未开放')} className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40">
            过滤通知
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {reqs.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-black/30 dark:text-white/30" data-testid="qq-newfriends-empty">
            暂无好友通知，去「添加」认识新朋友吧
          </p>
        ) : (
          <div className="pb-2">
            {reqs.map((r) => {
              const status = r.status ?? 'accepted';
              return (
                <button
                  type="button"
                  key={`${r.id}-${r.time}`}
                  data-testid={`qq-req-${r.name}`}
                  onClick={() => onOpenReq(r)}
                  className="flex w-full items-center gap-3 border-b border-black/[0.05] px-4 py-3 text-left active:bg-black/[0.03] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
                >
                  <QqAvatar src={r.avatar} alt={r.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium">{r.name}</p>
                    <p className="mt-0.5 truncate text-[13.5px] text-black/60 dark:text-white/60">{r.message}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-black/35 dark:text-white/35">来源：{r.source || '好友验证消息'}</p>
                  </div>
                  {status === 'pending' ? (
                    r.fromChar ? (
                      <span
                        role="button"
                        tabIndex={0}
                        data-testid={`qq-req-accept-${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAccept(r);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            onAccept(r);
                          }
                        }}
                        className="shrink-0 rounded-[6px] border border-black/15 px-4 py-1.5 text-[14px] active:bg-black/5 dark:border-white/25"
                      >
                        同意
                      </span>
                    ) : (
                      // 小号发起、等待 AI 决策的申请：无「同意」按钮（决策在对方手里）
                      <span
                        className="shrink-0 text-[13.5px] text-black/35 dark:text-white/35"
                        data-testid={`qq-req-waiting-${r.name}`}
                      >
                        等待验证
                      </span>
                    )
                  ) : (
                    <span className="shrink-0 text-[13.5px] text-black/35 dark:text-white/35" data-testid={`qq-req-status-${r.name}`}>
                      {status === 'rejected' ? '已拒绝' : '已同意'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="h-2.5 bg-black/[0.035] dark:bg-white/[0.05]" aria-hidden="true" />

        {/* 可能想认识的人 */}
        <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
          <span className="text-[17px] font-semibold">可能想认识的人</span>
          <button
            type="button"
            onClick={() => onToast('查看更多暂未开放')}
            className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
          >
            查看更多
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {suggestions.length === 0 && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
        )}
        {suggestions.map((c) => (
          <AddPersonRow key={c.id} c={c} busy={false} onAdd={() => onOpenApply(c)} onOpen={() => onOpenChat(c)} />
        ))}
      </div>
    </div>
  );
}

// ---------------- 好友申请详情页（QQ 风格：对方留言/来源/同意/设为黑名单） ----------------

function FriendReqDetailPage({
  req,
  contact,
  onBack,
  onAccept,
  onReject,
  onBlock,
  onVerify,
  onToast,
}: {
  /** 好友申请（null = 搜索结果资料预览：还没有申请，走「前往验证」发申请） */
  req: FriendReqEntry | null;
  /** 申请对应的联系人（被彻底删除时为 null：展示快照，同意按钮置灰） */
  contact: ContactRecord | null;
  onBack: () => void;
  /** 同意申请：宿主恢复好友关系 + 状态流转 + 刷新 */
  onAccept: (r: FriendReqEntry) => void;
  /** 拒绝申请：AI 停止再申请 */
  onReject: (r: FriendReqEntry) => void;
  /** 设为黑名单 */
  onBlock: (r: FriendReqEntry | ContactRecord) => void;
  /** 资料预览模式「前往验证」：进申请添加朋友页 */
  onVerify: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const status = req?.status ?? 'accepted';
  const pending = req != null && status === 'pending';
  const peerName = req?.name ?? (contact ? displayNameOf(contact) : '对方');

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
    appendReqThread('qq', req.id, msg);
    setReplyText('');
    setReplyOpen(false);
    if (contact && (contact.persona ?? '').trim()) {
      setReplyBusy(true);
      try {
        if (shouldUseAltDecisionFlow('qq', req)) {
          // 小号发起的申请：每条回复都触发 AI 重新决策（同意/拒绝/先回复，按人设随时可以同意）
          await processAltFriendReq('qq', req.id, contact.id);
        } else {
          const reply = await genCharThreadReply('qq', contact, [...thread, msg], 'reply');
          if (reply) appendReqThread('qq', req.id, { who: 'peer', text: reply, time: Date.now() });
        }
      } catch {
        // 生成失败静默：用户消息已在线程里
      } finally {
        setReplyBusy(false);
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 好友申请 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" data-testid="qq-reqdetail-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">好友申请</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" data-testid="qq-reqdetail-body">
        {/* 申请人卡片（头像 + 名字/QQ号） */}
        <div className="flex w-full items-center gap-3 py-4">
          <QqAvatar src={req?.avatar ?? contact?.avatar ?? null} alt={peerName} size={64} />
          <span className="min-w-0 flex-1 truncate text-[19px] font-semibold">
            {peerName}
            {contact?.qqId ? `（${contact.qqId}）` : ''}
          </span>
        </div>

        {/* 验证消息线程（我/对方 多轮对话 + 回复） */}
        {thread.length > 0 && (
          <>
            <p className="pb-2 text-[13px] text-black/40 dark:text-white/40">验证消息</p>
            <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 py-3.5 dark:bg-white/[0.08]" data-testid="qq-reqdetail-thread">
              {thread.map((m, i) => (
                <p key={`${m.time}-${i}`} className="break-words text-[15px] leading-[1.8]">
                  {m.who === 'me' ? '我: ' : `${peerName}: `}
                  {m.text}
                </p>
              ))}
              {replyBusy ? (
                <p className="mt-1 text-[14.5px] text-black/35 dark:text-white/35" data-testid="qq-reqdetail-reply-busy">
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
                      data-testid="qq-reqdetail-reply-input"
                      className="h-9 min-w-0 flex-1 rounded-[8px] bg-white px-3 text-[14.5px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      data-testid="qq-reqdetail-reply-send"
                      onClick={() => void sendReply()}
                      className="h-9 shrink-0 rounded-full px-4 text-[14px] font-medium text-white active:brightness-95"
                      style={{ backgroundColor: QQ_BLUE }}
                    >
                      发送
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="qq-reqdetail-reply"
                    onClick={() => setReplyOpen(true)}
                    className="mt-1 block text-[14.5px] active:opacity-60"
                    style={{ color: QQ_BLUE }}
                  >
                    回复
                  </button>
                )
              ) : null}
            </div>
          </>
        )}

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">来源</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 py-3.5 text-[15px] dark:bg-white/[0.08]">
          <span data-testid="qq-reqdetail-source">{req?.source || (req ? '好友验证消息' : SOURCE_SEARCH_QQ)}</span>
          {!req && contact && (
            <span className="ml-3 text-black/40 dark:text-white/40">
              {contact.qqId ? `QQ:${contact.qqId}` : contact.phone ? `手机:${contact.phone}` : ''}
            </span>
          )}
        </div>

        {/* 同意 / 拒绝 / 前往验证 / 状态 */}
        {req == null ? (
          <button
            type="button"
            data-testid="qq-reqdetail-accept"
            onClick={() => contact && onVerify(contact)}
            disabled={!contact}
            className="mb-6 mt-8 h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-50"
            style={{ backgroundColor: QQ_BLUE }}
          >
            前往验证
          </button>
        ) : pending ? (
          req.fromChar ? (
            <div className="mb-6 mt-8 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onAccept(req)}
                disabled={!contact}
                className="h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-50"
                style={{ backgroundColor: QQ_BLUE }}
              >
                同意
              </button>
              <button
                type="button"
                data-testid="qq-reqdetail-reject"
                onClick={() => onReject(req)}
                className="h-12 w-full rounded-full bg-black/[0.05] text-[16px] text-red-500 active:opacity-70 dark:bg-white/[0.08]"
              >
                拒绝
              </button>
            </div>
          ) : (
            // 小号发起、等待 AI 决策的申请：无同意/拒绝按钮（决策在对方手里），可继续回复验证消息
            <p
              className="mb-6 mt-8 text-center text-[15px] text-black/35 dark:text-white/35"
              data-testid="qq-reqdetail-waiting"
            >
              等待对方验证
            </p>
          )
        ) : (
          <p className="mt-8 text-center text-[15px] text-black/35 dark:text-white/35" data-testid="qq-reqdetail-done">
            {status === 'rejected' ? '已拒绝该申请' : '已同意'}
          </p>
        )}
      </div>

      {/* 底部：设为黑名单 | 举报用户 */}
      <div className="flex shrink-0 items-center justify-center gap-4 pb-[30px] pt-3">
        <button
          type="button"
          data-testid="qq-reqdetail-block"
          onClick={() => (req ? onBlock(req) : contact ? onBlock(contact) : undefined)}
          className="text-[15px] active:opacity-60"
          style={{ color: QQ_BLUE }}
        >
          设为黑名单
        </button>
        <span className="h-4 w-px bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <button type="button" onClick={() => onToast('举报暂未开放')} className="text-[15px] active:opacity-60" style={{ color: QQ_BLUE }}>
          举报用户
        </button>
      </div>
    </div>
  );
}

// ---------------- QQ空间动态流（动态 tab - 空间动态） ----------------

/** #41c TA 的空间首访播种模板：新好友空间一条动态都没有时补 3 条通用模板说说（
 *  writeMemory=false 不入记忆；与角色人设无关的中性口吻、无 emoji，对照微信 openFriendMoments 的示例动态） */
const ZONE_OWNER_POST_TEMPLATES: ReadonlyArray<{ text: string; agoMs: number }> = [
  { text: '今天天气不错，出门走了走，顺便买了杯咖啡', agoMs: 2 * 3_600_000 },
  { text: '忙了好一阵子，总算把手里的事情收尾了', agoMs: 26 * 3_600_000 },
  { text: '晚上早点睡，明天开始按计划做事', agoMs: 3 * 86_400_000 },
];

/** A1/A2 QQ空间「生成图片」弹层（iOS 风格底部小弹层，样式对齐转发弹层/聊天 qq-textcard-sheet：
 *  absolute 底部圆角 16 底板 + QQ 蓝 #0099FF 主按钮）：textarea 预填画面描述可改，
 *  主按钮「生成图片」（busy 转圈禁用），错误显示在弹层内（可改后重试）；busy 中不可关闭 */
function ZoneImageGenSheet({
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
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={title} data-testid="qq-moment-imggen-sheet">
      <div className="rounded-t-[16px] bg-white p-4 pb-[max(18px,env(safe-area-inset-bottom))] dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">{title}</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid="qq-moment-imggen-close"
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
          data-testid="qq-moment-imggen-input"
          placeholder="画面描述（可修改后再生成）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] text-[#1F2329] outline-none placeholder:text-black/30 focus:border-[#0099FF]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="qq-moment-imggen-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="qq-moment-imggen-submit"
          onClick={() => onSubmit(desc)}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#0099FF] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
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

function ZonePage({
  me,
  contacts,
  onBack,
  onCompose,
  onToast,
  askOpen,
  setAskOpen,
  /** 传入 = 该好友的QQ空间（个人卡换成 TA；只显示 TA 发的动态；隐藏发布入口/让好友发一条） */
  owner,
  /** true = 只显示机主自己发的动态（个人资料页 QQ空间进入「我的空间动态」） */
  mineOnly,
  /** 互动消息未读数 + 最新一条消息人的头像（「1条新消息」气泡） */
  noticeBadge,
  /** 打开「空间消息」页（铃铛/气泡入口） */
  onOpenNotices,
}: {
  me: QQUser;
  /** 联系人列表（「让好友发一条」候选 + 平台好友过滤） */
  contacts: ContactRecord[];
  onBack: () => void;
  onCompose: () => void;
  onToast: (m: string) => void;
  /** 「让好友发一条」开关（lift 到 MainScreen，供「空间动态设置 → 立即发帖」复用） */
  askOpen: boolean;
  setAskOpen: (b: boolean) => void;
  owner?: ContactRecord;
  mineOnly?: boolean;
  noticeBadge: { count: number; avatar: string | null };
  onOpenNotices: () => void;
}) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const [userPosts, setUserPosts] = useState<ZonePost[]>(loadZonePosts);
  const [seedLiked, setSeedLiked] = useState<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = kvGet<Record<string, boolean>>(LS_ZONE_LIKES);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [commentsMap, setCommentsMap] = useState<Record<string, ZoneComment[]>>(loadZoneComments);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  /** 回复目标：评论 id + 名字（带 id 才能支持回复 AI 评论后 AI 再回复的多轮链） */
  const [replyTarget, setReplyTarget] = useState<Record<string, { id: string; name: string } | undefined>>({});
  const commentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** 「…」操作菜单 / 编辑说说 / 让好友发一条 / 自动发布设置 */
  const [menuPostId, setMenuPostId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<{ id: string; content: string } | null>(null);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  /** 「文字图片」卡片升级/升级图重新生成：busy 的动态 id（卡片行「正在生成图片…」提示 + 防重入，与旧口径一致） */
  const [upgradingCardId, setUpgradingCardId] = useState<string | null>(null);
  /** A1/A2「生成图片」弹层：upgrade = 文字图片卡片升级 / regen = 升级图重新生成（同款弹层，描述预填可改） */
  const [genSheet, setGenSheet] = useState<null | { mode: 'upgrade' | 'regen'; postId: string; desc: string }>(null);
  const [genSheetBusy, setGenSheetBusy] = useState(false);
  const [genSheetError, setGenSheetError] = useState('');
  /** A1 描述可改升级：点击文字图片卡片打开「生成图片」弹层（预填卡片文字，可改），确认后才真正生图 */
  const handleUpgradeCard = (post: ZonePost) => {
    if (upgradingCardId) return; // 保留原 busy 防重入
    setGenSheet({ mode: 'upgrade', postId: post.id, desc: post.textCard ?? '' });
  };
  /** A2 升级图重新生成（长按/右键）：弹层预填上次实际使用的画面描述（legacy 缺省回落空串） */
  const openRegenSheet = (post: ZonePost) => {
    setGenSheet({ mode: 'regen', postId: post.id, desc: post.textCardDesc ?? '' });
  };
  /** A1/A2 弹层确认：按 mode 调引擎升级/重新生成；成功关弹层 + toast（列表由引擎广播
   *  moments-changed → ZonePage 订阅自动刷新）；失败留在弹层显示 error（可改后重试） */
  const submitZoneGen = async (descInput: string) => {
    if (!genSheet || genSheetBusy) return;
    const desc = descInput.trim().slice(0, 400); // 提交时 trim + 截 400（与聊天端同口径）
    setGenSheetBusy(true);
    setGenSheetError('');
    if (genSheet.mode === 'upgrade') setUpgradingCardId(genSheet.postId);
    try {
      const r =
        genSheet.mode === 'upgrade'
          ? await upgradeMomentTextCard('qq', genSheet.postId, me.name, desc || undefined) // 描述留空 → 引擎回落卡片文字
          : await regenerateMomentImage('qq', genSheet.postId, me.name, desc); // 描述留空 → 引擎回落上次描述
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
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 长按删除的评论（确认弹层） */
  const [delComment, setDelComment] = useState<{ postId: string; commentId: string; author: string } | null>(null);
  /** 转发目标动态（转发弹层；转发 = 新说说（理由）+ 原动态摘要卡） */
  const [repostTarget, setRepostTarget] = useState<ZonePost | null>(null);
  const [repostDraft, setRepostDraft] = useState('');
  /** 朋友圈/空间动态设置缓存（mount 时读一次 kv，避免每次 render 重读）。
   *  feat-64：设置按平台独立（只读 QQ 空间这一份） */
  const [momentsSettings] = useState(() => getMomentsSettings('qq'));
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
  // 离开空间动态页时关闭「让好友发一条」弹层（防止 lift 状态在下次进页时残留）
  useEffect(() => () => setAskOpen(false), [setAskOpen]);

  /** 长按评论（480ms）→ 删除确认；移动超 10px 视为滚动取消 */
  const startCommentPress = (p: ZonePost, c: ZoneComment) => (e: React.PointerEvent) => {
    if (p.id.startsWith('seed-')) return; // 示例动态的评论不支持删除
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      setDelComment({ postId: p.id, commentId: c.id, author: c.author });
    }, 480);
  };
  const onCommentPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  /** A2 升级图长按 → 打开「重新生成图片」弹层（复用评论长按同款计时器/移动取消/抑制 click 模式） */
  const startZoneImagePress = (post: ZonePost) => (e: React.PointerEvent) => {
    if (post.textCardUpgraded !== true) return; // 仅引擎升级过的图有入口；用户手动发的图无入口
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      suppressClickRef.current = true;
      openRegenSheet(post);
    }, 480);
  };
  const onZoneImagePointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 10 || Math.abs(e.clientY - t.y) > 10) clearPress();
  };

  // 旧版遗留修复 + 订阅引擎刷新（AI 点赞/评论/新动态实时出现）
  useEffect(() => {
    repairLegacyMomentData();
    return subscribeMomentsChanged((platform) => {
      if (platform && platform !== 'qq') return;
      setUserPosts(loadZonePosts());
      setCommentsMap(loadZoneComments());
    });
  }, []);

  // #41c TA 的空间首访播种：该好友空间一条动态都没有时补 3 条通用模板说说（动态引擎写入、
  // writeMemory=false 不入记忆，与微信 openFriendMoments 同口径；有动态后不再补，删光后下次进页重播）
  useEffect(() => {
    if (!owner) return;
    const dn = displayNameOf(owner);
    if (loadZonePosts().some((p) => p.authorName === dn || p.authorName === owner.name)) return;
    const now = Date.now();
    for (const t of ZONE_OWNER_POST_TEMPLATES) {
      addCharMomentPost('qq', {
        peer: owner,
        userName: me.name,
        content: t.text,
        writeMemory: false,
        createdAt: now - t.agoMs,
      });
    }
    setUserPosts(loadZonePosts());
  }, [owner, me.name]);

  /** 动态过滤：TA 的空间（owner）→ 只看 TA 发的；我的空间（mineOnly）→ 只看我发的；默认全量。
   *  头像实时读取：动态只存身份引用（peerId），渲染时经 liveAvatarOf 实时取联系人当前头像
   *  （换头像立即同步；QQ/微信共用 liveAvatarOf；legacy 无 peerId 数据按名字兜底）。
   *  删好友门控：被删好友（qq 端 friend-del 状态）的动态隐藏（数据保留，加回后恢复） */
  const posts: ZonePost[] = useMemo(() => {
    const all = [...userPosts, ...ZONE_SEEDS];
    const scoped = owner
      ? all.filter((p) => p.authorName === displayNameOf(owner) || p.authorName === owner.name)
      : mineOnly
        ? all.filter((p) => p.authorName === me.name)
        : all.filter((p) => {
            const hit = contactByRef({ peerId: p.peerId, name: p.authorName }, contacts);
            return !(hit && hit.kind !== 'user' && isFriendDeleted('qq', hit.id));
          });
    // 自己发的动态（author='user'，peerId=null 仅名字归因）：改名/换头像后按机主联系人实时解析
    // 名字与头像——避免改名后旧帖回退到落库时的旧快照（与微信朋友圈同口径）
    const meOwner = contacts.find((c) => c.kind === 'user' && !c.altOf) ?? null;
    return scoped.map((p) =>
      p.author === 'user' && meOwner
        ? { ...p, authorName: displayNameOf(meOwner) || p.authorName, avatar: meOwner.avatar ?? p.avatar }
        : { ...p, avatar: liveAvatarOf(p.avatar, { peerId: p.peerId, name: p.authorName }, contacts, 'qq') }
    );
  }, [userPosts, owner, mineOnly, me.name, contacts]);

  /** 空间页头展示的用户（TA 的空间换头像/名字） */
  const shownUser = owner
    ? { name: displayNameOf(owner), avatar: owner.avatar }
    : { name: me.name, avatar: me.avatar };

  const addComment = (p: ZonePost) => {
    const t = (commentDrafts[p.id] ?? '').trim();
    if (!t) return;
    // 统一走动态引擎：回复 AI 的评论会自动排一条 AI 的再回复（多轮）；评论角色的动态会写入该角色记忆
    const rt = replyTarget[p.id];
    addUserMomentComment('qq', p.id, {
      userName: me.name,
      content: t,
      replyTo: rt ? { commentId: rt.id, name: rt.name } : undefined,
    });
    setCommentDrafts((d) => ({ ...d, [p.id]: '' }));
    setReplyTarget((r) => ({ ...r, [p.id]: undefined }));
  };

  const likedOf = (p: ZonePost): boolean =>
    p.id.startsWith('seed-') ? (seedLiked[p.id] ?? SEED_DEFAULT_LIKE[p.id] ?? false) : p.likedBy.includes(me.name);

  const namesOf = (p: ZonePost): string[] => {
    if (p.id.startsWith('seed-')) {
      const base = p.likedBy.map((n) => (n === 'ME' ? me.name : n)).filter((n) => n !== me.name);
      return likedOf(p) ? [me.name, ...base] : base;
    }
    return p.likedBy;
  };

  const toggleLike = (p: ZonePost) => {
    if (p.id.startsWith('seed-')) {
      const next = { ...seedLiked, [p.id]: !likedOf(p) };
      setSeedLiked(next);
      try {
        kvSet(LS_ZONE_LIKES, next);
      } catch {
        // 忽略
      }
      return;
    }
    // 统一走动态引擎（写入点赞名，评论区的 AI 可见）
    toggleUserMomentLike('qq', p.id, me.name);
  };

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = async (c: ContactRecord) => {
    setAskBusyId(c.id);
    try {
      await aiPostMoment({ apiConfig, platform: 'qq', peer: c, userName: me.name });
      onToast(`已让「${displayNameOf(c)}」发了一条动态`);
      setAskOpen(false);
    } catch (e) {
      onToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
    } finally {
      setAskBusyId(null);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-[#111214]">
      {/* 全屏：整个页面（含顶部渐变区）在同一滚动容器里，头部随内容一起滚走 */}
      <div className="flex-1 overflow-y-auto" data-testid="qq-zone-feed">
      {/* 顶部渐变区：导航 + 个人卡 + 宫格 + 发布框（随页面滚动） */}
      <div className="bg-gradient-to-b from-[#D8E4F8] via-[#E9EEFA] to-white pb-3 pt-[54px] dark:from-[#242B3E] dark:via-[#1D2331] dark:to-[#111214]">
        <div className="flex items-center gap-2 px-3">
          <button
            type="button"
            aria-label="返回"
            onClick={onBack}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            aria-label="空间消息"
            data-testid="qq-zone-bell"
            onClick={onOpenNotices}
            className="relative ml-auto grid h-9 w-9 place-items-center rounded-full bg-white/70 text-black/75 backdrop-blur active:bg-white dark:bg-white/10 dark:text-white/80"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
            {noticeBadge.count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#FA5151]" aria-hidden="true" />}
          </button>
        </div>

        {/* 个人卡（TA 的空间时换成 TA 的头像/名字） */}
        <div className="mt-3 flex items-center gap-3 px-4">
          <QqAvatar src={shownUser.avatar} alt={shownUser.name} size={60} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[19px] font-semibold">{shownUser.name}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[13px] text-black/50 dark:text-white/50">
              <Eye className="h-4 w-4" aria-hidden="true" />
              总量 <span className="font-semibold">195</span> · <span className="font-semibold">+2</span>
            </div>
          </div>
        </div>

        {/* 宫格：说说/日志/相册/留言/更多（说说 → 写说说页）；TA 的空间隐藏发布类入口 */}
        {!owner && (
        <div className="mt-3 flex px-1">
          {[
            { label: '说说', icon: <MessageSquare className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: onCompose, testid: 'qq-zone-shuoshuo' },
            { label: '日志', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('日志暂未开放'), testid: undefined },
            { label: '相册', icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('相册暂未开放'), testid: undefined },
            { label: '留言', icon: <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('留言暂未开放'), testid: undefined },
            { label: '更多', icon: <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={1.8} />, fn: () => onToast('更多暂未开放'), testid: undefined },
          ].map((g) => (
            <button
              key={g.label}
              type="button"
              data-testid={g.testid}
              onClick={g.fn}
              className="flex flex-1 flex-col items-center gap-1 text-[#3E7BCC] active:opacity-60 dark:text-[#6FA0DE]"
            >
              {g.icon}
              <span className="text-[12px] text-black/60 dark:text-white/60">{g.label}</span>
            </button>
          ))}
        </div>
        )}

        {/* 分享新鲜事：点击进入「写说说」页（TA 的空间不显示） */}
        {!owner && (
        <div className="mx-4 mt-3">
          <button
            type="button"
            data-testid="qq-zone-input"
            onClick={onCompose}
            className="w-full rounded-[14px] border border-black/10 bg-white/60 px-3 py-2.5 text-left backdrop-blur active:bg-white/85 dark:border-white/10 dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
          >
            <span className="block text-[15px] text-black/30 dark:text-white/30">分享新鲜事…</span>
            <span className="mt-2 flex items-center text-black/45 dark:text-white/45">
              <ImageIcon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
              <span className="mx-2.5 h-4 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
              <Star className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            </span>
          </button>
        </div>
        )}
      </div>

      {/* 「1条新消息」气泡（QQ 同款白色胶囊：头像 + 条数 + 箭头；点开空间消息页并全部已读） */}
      {!owner && !mineOnly && noticeBadge.count > 0 && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            data-testid="qq-zone-pill"
            aria-label={`${noticeBadge.count}条新消息`}
            onClick={onOpenNotices}
            className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-[0_1px_5px_rgba(0,0,0,0.08)] active:bg-black/[0.04] dark:bg-[#2A2C33]"
          >
            <QqAvatar src={noticeBadge.avatar} alt="" size={24} />
            <span className="text-[14px]">{noticeBadge.count}条新消息</span>
            <ChevronRight className="h-4 w-4 text-black/35 dark:text-white/35" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 动态流（与头部同一滚动容器） */}
        {posts.map((p) => {
          const liked = likedOf(p);
          const names = namesOf(p);
          const rt = replyTarget[p.id];
          return (
            <div key={p.id} className="border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06]">
              <div className="flex items-start gap-3">
                <QqAvatar src={p.avatar} alt={p.authorName} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[16px] font-semibold text-[#4A78B8] dark:text-[#7FA8D9]">{p.authorName}</span>
                    <button
                      type="button"
                      aria-label="更多操作"
                      data-testid={`qq-zone-more-${p.id}`}
                      onClick={() => setMenuPostId(menuPostId === p.id ? null : p.id)}
                      className="shrink-0 px-1 text-[18px] leading-none text-black/40 active:opacity-60 dark:text-white/40"
                    >
                      …
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[15px] leading-[1.55]">{p.content}</p>
                  <BilingualTranslation zh={p.contentZh ?? ''} foldByDefault={momentsSettings.foldChineseTranslation} />

                  {/* 转发引用卡：原动态摘要（作者 + 内容 + 最多 3 张配图快照） */}
                  {p.repostOf && (
                    <div className="mt-2 rounded-[10px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.05]" data-testid={`qq-zone-repost-${p.id}`}>
                      <p className="text-[14px] leading-[1.5]">
                        <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{p.repostOf.authorName}</span>
                        <span className="text-black/75 dark:text-white/75">：{p.repostOf.content}</span>
                      </p>
                      {p.repostOf.images.length > 0 && (
                        <div className="mt-2 flex gap-1.5">
                          {p.repostOf.images.slice(0, 3).map((src, i) => (
                            <img key={i} src={src} alt="转发配图" loading="lazy" decoding="async" className="h-16 w-16 rounded-[6px] object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 「文字图片」卡片（AI 配图降级产物）：韩系简约卡片直接当配图，点击打开「生成图片」弹层（描述可改）升级为真图 */}
                  {p.textCard && !(p.images && p.images.length > 0) && (
                    <div className="mt-2" data-testid={`qq-zone-textcard-${p.id}`}>
                      <TextCardBubble
                        text={p.textCard}
                        signedBy={p.authorName}
                        variant="qq"
                        onClick={() => handleUpgradeCard(p)}
                      />
                      {upgradingCardId === p.id && (
                        <p className="mt-1 text-[12px] text-black/35 dark:text-white/35">正在生成图片…</p>
                      )}
                    </div>
                  )}

                  {p.images && p.images.length > 0 && (
                    <div className={`mt-2 grid gap-1.5 ${p.images.length === 1 ? 'max-w-[240px]' : 'grid-cols-3'}`}>
                      {p.images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="动态配图"
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full rounded-[8px] object-cover"
                          {...(p.textCardUpgraded === true
                            ? {
                                // A2 长按升级图 →「重新生成图片」弹层（桌面端右键同入口；仅引擎升级过的图有入口）
                                onPointerDown: startZoneImagePress(p),
                                onPointerMove: onZoneImagePointerMove,
                                onPointerUp: clearPress,
                                onPointerLeave: clearPress,
                                onPointerCancel: clearPress,
                                onContextMenu: (e: React.MouseEvent) => {
                                  e.preventDefault();
                                  openRegenSheet(p);
                                },
                              }
                            : {})}
                        />
                      ))}
                    </div>
                  )}

                  {/* 位置行（发说说时选了「所在位置」才显示） */}
                  {p.location && (
                    <p className="mt-1.5 flex items-center gap-1 text-[13px] text-[#4A78B8] dark:text-[#7FA8D9]" data-testid={`qq-zone-location-${p.id}`}>
                      <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                      <span className="truncate">{p.location}</span>
                    </p>
                  )}

                  <div className="mt-2 flex items-center">
                    <span className="text-[12px] text-black/35 dark:text-white/35">{p.time}</span>
                    <div className="ml-auto flex items-center gap-7 text-black/55 dark:text-white/55">
                      <button
                        type="button"
                        aria-label={liked ? '取消赞' : '赞'}
                        data-testid={`qq-zone-like-${p.id}`}
                        onClick={() => toggleLike(p)}
                        className={`active:opacity-60 ${liked ? 'text-[#1E6FFF] dark:text-[#4AA3FF]' : ''}`}
                      >
                        <ThumbsUp className={`h-[18px] w-[18px] ${liked ? 'fill-current' : ''}`} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="评论"
                        data-testid={`qq-zone-comment-btn-${p.id}`}
                        onClick={() => commentInputRefs.current[p.id]?.focus()}
                        className="active:opacity-60"
                      >
                        <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="转发"
                        data-testid={`qq-zone-repost-btn-${p.id}`}
                        onClick={() => {
                          if (p.repostOf) {
                            onToast('转发动态不可再转发');
                            return;
                          }
                          setRepostDraft('');
                          setRepostTarget(p);
                        }}
                        className="active:opacity-60"
                      >
                        <Share2 className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {names.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[#4A78B8] dark:text-[#7FA8D9]">
                      <ThumbsUp className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      {names.join('、')} 赞了
                    </div>
                  )}

                  {(commentsMap[p.id]?.length ?? 0) > 0 && (
                    <div
                      className="mt-2 space-y-1.5 rounded-[10px] bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                      data-testid={`qq-zone-comments-${p.id}`}
                    >
                      {(commentsMap[p.id] ?? []).map((c) => (
                        <div key={c.id} className="text-[14px] leading-[1.5]">
                          <div className="flex items-start gap-2">
                            <p
                              className="min-w-0 flex-1 active:opacity-70"
                              title="点击回复，长按删除"
                              onPointerDown={startCommentPress(p, c)}
                              onPointerUp={clearPress}
                              onPointerLeave={clearPress}
                              onPointerCancel={clearPress}
                              onPointerMove={onCommentPointerMove}
                              onClick={() => {
                                // 长按后拦截紧随的 click（不设置回复目标）
                                if (suppressClickRef.current) {
                                  suppressClickRef.current = false;
                                  return;
                                }
                                setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                                commentInputRefs.current[p.id]?.focus();
                              }}
                            >
                              <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.author}</span>
                              {c.replyTo && (
                                <>
                                  <span className="mx-0.5 text-black/40 dark:text-white/40">回复</span>
                                  <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">{c.replyTo}</span>
                                </>
                              )}
                              <span className="text-black/80 dark:text-white/80">：{c.content}</span>
                              <span className="ml-2 text-[11px] text-black/30 dark:text-white/30">{c.time}</span>
                            </p>
                            <button
                              type="button"
                              aria-label={`回复${c.author}的评论`}
                              data-testid={`qq-zone-reply-${p.id}-${c.id}`}
                              onClick={() => {
                                setReplyTarget((r) => ({ ...r, [p.id]: { id: c.id, name: c.author } }));
                                commentInputRefs.current[p.id]?.focus();
                              }}
                              className="shrink-0 pt-0.5 text-[12px] text-black/40 active:opacity-60 dark:text-white/40"
                            >
                              回复
                            </button>
                          </div>
                          <BilingualTranslation zh={c.contentZh ?? ''} foldByDefault={momentsSettings.foldChineseTranslation} />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]">
                    <QqAvatar src={me.avatar} alt={me.name} size={22} />
                    {rt && (
                      <button
                        type="button"
                        aria-label={`取消回复${rt.name}`}
                        data-testid={`qq-zone-reply-cancel-${p.id}`}
                        onClick={() => setReplyTarget((r) => ({ ...r, [p.id]: undefined }))}
                        className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
                      >
                        回复{rt.name}
                        <X className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    )}
                    <input
                      ref={(el) => {
                        commentInputRefs.current[p.id] = el;
                      }}
                      data-testid={`qq-zone-comment-input-${p.id}`}
                      aria-label={`评论${p.authorName}的动态`}
                      placeholder={rt ? `回复 ${rt.name}：` : '说点什么吧...'}
                      value={commentDrafts[p.id] ?? ''}
                      onChange={(e) => setCommentDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addComment(p);
                      }}
                      className="h-5 w-full bg-transparent text-[13px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
                    />
                    {(commentDrafts[p.id] ?? '').trim() && (
                      <button
                        type="button"
                        aria-label="发送评论"
                        data-testid={`qq-zone-comment-send-${p.id}`}
                        onClick={() => addComment(p)}
                        className="shrink-0 text-[13px] font-medium text-[#1E6FFF] active:opacity-60 dark:text-[#4AA3FF]"
                      >
                        发送
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {posts.length === 0 && <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">还没有动态</p>}
      </div>

      {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑/删除说说（六.4）；TA 的空间不显示 */}
      {askOpen && !owner && (
        <AskPostSheet
          title="让好友发一条"
          friends={momentFriendsOf(contacts, 'qq')}
          busyId={askBusyId}
          onClose={() => setAskOpen(false)}
          onAsk={(c) => void askMomentPost(c)}
          onOpenCfg={(c) => setCfgPeer(c)}
          renderAvatar={(c, size) => <QqAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
        />
      )}
      {cfgPeer && (
        <MomentAutoCfgSheet
          contact={cfgPeer}
          platform="qq"
          platformLabel="QQ动态"
          onClose={() => setCfgPeer(null)}
          onToast={onToast}
        />
      )}
      {menuPostId && (
        <PostMoreMenu
          onEdit={() => {
            const hit = posts.find((x) => x.id === menuPostId);
            if (hit) setEditingPost({ id: hit.id, content: hit.content });
            setMenuPostId(null);
          }}
          onDelete={() => {
            deleteMomentPost('qq', menuPostId, me.name);
            setMenuPostId(null);
            onToast('已删除动态');
          }}
          onClose={() => setMenuPostId(null)}
        />
      )}
      {editingPost && (
        <EditPostDialog
          key={editingPost.id}
          initial={editingPost.content}
          busy={false}
          onCancel={() => setEditingPost(null)}
          onSave={(text) => {
            if (!updateMomentPostContent('qq', editingPost.id, me.name, text)) onToast('动态内容不能为空');
            setEditingPost(null);
          }}
        />
      )}
      {/* 长按评论 → 删除确认（任何人的评论都可删；其下回复一并删） */}
      {delComment && (
        <CommentDeleteDialog
          author={delComment.author}
          onCancel={() => setDelComment(null)}
          onDelete={() => {
            deleteMomentComment('qq', delComment.postId, delComment.commentId, me.name);
            setDelComment(null);
          }}
        />
      )}
      {/* 转发弹层：理由输入 + 原动态预览；发表后进我的空间（好友会收到转发互动） */}
      {repostTarget && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="转发到我的空间" onClick={() => setRepostTarget(null)}>
          <div className="rounded-t-[16px] bg-white p-4 pb-8 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <button type="button" data-testid="qq-repost-cancel" onClick={() => setRepostTarget(null)} className="text-[15px] text-black/55 active:opacity-60 dark:text-white/55">
                取消
              </button>
              <span className="text-[15.5px] font-medium">转发到我的空间</span>
              <button
                type="button"
                data-testid="qq-repost-confirm"
                onClick={() => {
                  // 【fix3-d-4】原作者归属优先取引擎统一视图的显式 author（post.id 同源于 qq-zone-posts 键，
                  // id 精确匹配不误判）；引擎查不到（刚落库竞态等）才回退旧的按名字推断
                  const enginePost = listMomentPosts('qq', me.name, contacts).find((p) => p.id === repostTarget.id);
                  const post = addUserMomentPost('qq', {
                    userName: me.name,
                    avatar: me.avatar,
                    content: repostDraft.trim() || '转发动态',
                    repostOf: {
                      postId: repostTarget.id,
                      author: enginePost?.author ?? (repostTarget.authorName === me.name ? 'user' : 'char'),
                      authorName: repostTarget.authorName,
                      content: repostTarget.content.slice(0, 80),
                      images: (repostTarget.images ?? []).slice(0, 3),
                    },
                  });
                  // 转发的动态与原创说说同口径排 AI 互动队列：好友才会赞/评/转发这条转发
                  //（此前漏入队，好友永远不会互动用户的转发动态）
                  enqueuePostInteractions('qq', post.id);
                  setRepostTarget(null);
                  onToast('已转发到空间');
                }}
                className="h-9 rounded-[10px] bg-[#1B9FF0] px-4 text-[14px] font-medium text-white active:brightness-95"
              >
                发表
              </button>
            </div>
            <input
              value={repostDraft}
              onChange={(e) => setRepostDraft(e.target.value.slice(0, 200))}
              placeholder="说点什么吧…（可不填）"
              aria-label="转发理由"
              data-testid="qq-repost-input"
              autoFocus
              className="mt-4 h-10 w-full rounded-full bg-black/[0.04] px-4 text-[14.5px] outline-none placeholder:text-black/30 focus:bg-black/[0.06] dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-white/[0.1]"
            />
            <div className="mt-3 rounded-[10px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.05]">
              <p className="text-[14px] leading-[1.5]">
                <span className="font-medium text-[#4A78B8] dark:text-[#7FA8D9]">@{repostTarget.authorName}</span>
                <span className="text-black/75 dark:text-white/75">：{repostTarget.content.slice(0, 60)}</span>
              </p>
              {(repostTarget.images ?? []).length > 0 && (
                <div className="mt-2 flex gap-1.5">
                  {(repostTarget.images ?? []).slice(0, 3).map((src, i) => (
                    <img key={i} src={src} alt="原动态配图" className="h-14 w-14 rounded-[6px] object-cover" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* A1/A2「生成图片」弹层：文字图片卡片升级真图 / 升级图重新生成（同款弹层，描述预填可改） */}
      {genSheet && (
        <ZoneImageGenSheet
          title={genSheet.mode === 'upgrade' ? '生成图片' : '重新生成图片'}
          initialDesc={genSheet.desc}
          busy={genSheetBusy}
          error={genSheetError}
          onClose={() => (genSheetBusy ? undefined : setGenSheet(null))}
          onSubmit={(d) => void submitZoneGen(d)}
        />
      )}
    </div>
  );
}

// ---------------- 写说说页（空间动态「分享新鲜事」进入；对照 QQ 真机） ----------------

function WritePostPage({
  me,
  onBack,
  onPublish,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  /** 发表：正文 + 配图 + 位置名（可选；入库/记忆/互动队列由动态引擎统一处理） */
  onPublish: (text: string, images: string[], location?: string) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [showLoc, setShowLoc] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const canPost = text.trim().length > 0 || images.length > 0;

  const pickImages = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    try {
      const room = Math.max(0, 9 - images.length);
      const picked = Array.from(files).slice(0, room);
      const datas = await Promise.all(picked.map((f) => compressImageFile(f).catch(() => '')));
      setImages((prev) => [...prev, ...datas.filter(Boolean)]);
      if (files.length > room) onToast('最多选择 9 张图片');
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    if (!canPost || busy) return;
    onPublish(text.trim(), images, location.trim() || undefined);
    onToast('已发表到空间');
    onBack();
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F2F3F5] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：取消 / 写说说 / 发表 */}
      <div className="relative flex h-12 shrink-0 items-center px-4">
        <button type="button" data-testid="qq-compose-cancel" onClick={onBack} className="text-[16px] active:opacity-60">
          取消
        </button>
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
          写说说
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="qq-compose-publish"
            disabled={!canPost || busy}
            onClick={publish}
            className="h-9 rounded-[10px] px-4 text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: canPost && !busy ? QQ_BLUE : '#8AD4F7' }}
          >
            发表
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {/* 内容卡：文字 + 照片/视频 + pills */}
        <div className="rounded-[14px] bg-white px-3 pb-4 pt-4 dark:bg-[#1B1C1F]">
          <textarea
            ref={textRef}
            data-testid="qq-compose-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="分享新鲜事..."
            rows={7}
            aria-label="说说内容"
            className="w-full resize-none bg-transparent text-[17px] leading-[1.6] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <div className="mt-1 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={`${i}-${src.slice(-12)}`} className="relative h-[86px] w-[86px] overflow-hidden rounded-[8px]">
                <img src={src} alt={`配图${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={`移除配图${i + 1}`}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white"
                >
                  <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                </button>
              </div>
            ))}
            {images.length < 9 && (
              <button
                type="button"
                data-testid="qq-compose-addimg"
                onClick={() => fileRef.current?.click()}
                className="grid h-[86px] w-[86px] place-items-center rounded-[8px] bg-black/[0.04] text-black/35 active:bg-black/[0.08] dark:bg-white/[0.06] dark:text-white/35"
              >
                <span className="flex flex-col items-center gap-1">
                  <ImageIcon className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
                  <span className="text-[12px]">照片/视频</span>
                </span>
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              void pickImages(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />
          {/* 已选位置 chip（可移除） */}
          {location && (
            <div className="mt-3 flex w-fit items-center gap-1 rounded-full bg-[#1B9FF0]/10 px-2.5 py-1 text-[12.5px] text-[#1B9FF0]" data-testid="qq-compose-location-value">
              <MapPin className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
              <span className="max-w-[180px] truncate">{location}</span>
              <button
                type="button"
                aria-label="清除位置"
                data-testid="qq-compose-location-clear"
                onClick={() => setLocation('')}
                className="ml-0.5 rounded-full p-0.5 active:bg-black/10"
              >
                <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="mt-3 flex items-center gap-1">
            {[
              { label: '@好友', icon: null, toast: '@好友暂未开放' },
              { label: '添加标签', icon: <Tag className="h-3 w-3" strokeWidth={2} aria-hidden="true" />, toast: '添加标签暂未开放' },
            ].map((x) => (
              <button
                key={x.label}
                type="button"
                onClick={() => onToast(x.toast)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
              >
                {x.icon}
                {x.label}
              </button>
            ))}
            {/* 所在位置（可选内置地点/自定义位置） */}
            <button
              type="button"
              data-testid="qq-compose-location"
              onClick={() => setShowLoc(true)}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
            >
              <MapPin className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              所在位置
            </button>
            {/* 表情（unicode 表情面板，插入光标处） */}
            <button
              type="button"
              data-testid="qq-compose-emoji"
              onClick={() => setShowEmoji((v) => !v)}
              className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] whitespace-nowrap active:opacity-60 ${showEmoji ? 'bg-[#1B9FF0]/15 text-[#1B9FF0]' : 'bg-black/[0.045] text-black/55 dark:bg-white/[0.08] dark:text-white/55'}`}
            >
              <Smile className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              表情
            </button>
            <button
              type="button"
              onClick={() => onToast('AI配文暂未开放')}
              className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] whitespace-nowrap text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
            >
              <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              AI配文
            </button>
          </div>
          {showEmoji && (
            <div className="mt-3">
              <MomentsEmojiPanel
                onPick={(e) => insertEmojiAtCursor(textRef, text, e, setText)}
                onClose={() => setShowEmoji(false)}
              />
            </div>
          )}
        </div>

        {/* 权限/发表设置卡 */}
        <div className="mt-3 rounded-[14px] bg-white px-4 dark:bg-[#1B1C1F]">
          <button
            type="button"
            onClick={() => onToast('权限设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Eye className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">权限设置</span>
            <span className="text-[14px] text-black/35 dark:text-white/35">所有人可见</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('发表设置暂未开放')}
            className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
          >
            <Settings className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
            <span className="flex-1 text-[15px]">发表设置</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 位置选择（复用聊天发送位置的内置地点/自定义位置页；选中即回填位置名） */}
      {showLoc && (
        <div className="absolute inset-0 z-40">
          <LocationPickerPage
            onClose={() => setShowLoc(false)}
            onSend={(loc) => {
              setLocation(loc.name);
              setShowLoc(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- 设置页 / 账号与安全页 ----------------

function SettingsPage({
  me,
  onBack,
  onOpenSecurity,
  onOpenDress,
  onLogout,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenSecurity: () => void;
  /** 个性装扮与特权外显 → 主题界面（毛玻璃胶囊：主题/气泡两个选择） */
  onOpenDress: () => void;
  onLogout: () => void;
  onToast: (m: string) => void;
}) {
  // Task 30 头像双击动作：拍一拍文案编辑（QQ 侧独立于微信；按账号隔离存储）
  const [clapOpen, setClapOpen] = useState(false);
  const [clapDraft, setClapDraft] = useState('');
  const [clapText, setClapText] = useState<string>(() => readQqClapText());
  const openClap = () => {
    setClapDraft(clapText);
    setClapOpen(true);
  };
  const saveClap = () => {
    setClapOpen(false);
    const t = clapDraft.trim();
    writeQqClapText(t);
    setClapText(t);
    onToast('拍一拍已保存');
  };
  const clapShown = clapText ? `拍了拍${clapText}` : '未设置';
  const rows: { icon: React.ReactNode; color: string; label: string; hint?: string; onClick?: () => void; testid?: string }[] = [
    { icon: <Bell className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '消息通知', onClick: () => onToast('消息通知暂未开放') },
    { icon: <SlidersHorizontal className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '模式选择', hint: '普通模式', onClick: () => onToast('模式选择暂未开放') },
    { icon: <Shirt className="h-5 w-5" strokeWidth={1.9} />, color: '#F0479C', label: '个性装扮与特权外显', onClick: onOpenDress },
    { icon: <Sparkles className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '头像双击动作', hint: clapShown, onClick: openClap, testid: 'qq-settings-clap' },
    { icon: <Settings className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '通用', onClick: () => onToast('通用设置暂未开放') },
  ];
  const privacyRows: { icon: React.ReactNode; label: string }[] = [
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '隐私设置' },
    { icon: <FileText className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息收集清单' },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '第三方个人信息共享清单' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息保护设置' },
  ];

  return (
    <div className="flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">设置</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        <QqSearch value="" onChange={() => undefined} />

        {/* 账号与安全 */}
        <button
          type="button"
          data-testid="qq-settings-security"
          onClick={onOpenSecurity}
          className="mt-3 flex h-[60px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <User className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">账号与安全</span>
          <QqAvatar src={me.avatar} alt={me.name} size={30} />
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">功能</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
          {/* 第三十四轮：「AI 主动消息」全局总开关删除（每角色独立设置入口保留在聊天设置里） */}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">隐私</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {privacyRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onToast('关于QQ暂未开放')}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <Info className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">关于QQ与帮助</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="qq-settings-logout"
          onClick={onLogout}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <LogOut className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">退出当前账号</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 头像双击动作设置弹窗（Task 30）：编辑拍一拍文案——好友双击我的头像拍一拍时会显示这个后缀 */}
      {clapOpen && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-clap-edit-layer" onClick={() => setClapOpen(false)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2C31]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">头像双击动作</p>
            <p className="pb-1 text-center text-[12px] text-black/40 dark:text-white/40">好友双击你的头像拍一拍时会看到「拍了拍+后缀」</p>
            <div className="px-4 pb-3 pt-1">
              <input
                value={clapDraft}
                onChange={(e) => setClapDraft(e.target.value)}
                maxLength={30}
                autoFocus
                data-testid="qq-clap-edit-input"
                placeholder="如：的小脑袋（留空清除）"
                className="w-full rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setClapOpen(false)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-clap-edit-save"
                onClick={saveClap}
                className="h-11 flex-1 text-[16px] font-medium text-[#0099FF] active:bg-black/5 dark:active:bg-white/10"
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

function PenguinMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" style={{ width: size, height: size }} className={className} aria-hidden="true">
      <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
      <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
      <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
      <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
      <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
      <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
    </svg>
  );
}

/** 多账号小号/匿名号首字母圆（Task 40-D）：小号暖色系 / 匿名号灰黑系，深色模式降饱和变体 */
function QqAccountBubble({ name, kind, size = 44 }: { name: string; kind: 'alt' | 'anon'; size?: number }) {
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

/**
 * 可切换账号列表（Task 41）：大号恒在；小号只显示「登录过」的——登录历史标记 或 存量会话
 * （升级兼容：老用户已登录的小号即使还没历史标记也照常显示）；当前账号保底不消失。
 * 匿名号只属于电话/信息，不进 QQ。联系人 App 刚创建、从未登录过的小号不出现在这里，
 * 用「登录小号」登录成功后（markAccountLoginHistory）才出现。
 */
function readQqSwitchableAccounts(activeId: string): PhoneAccount[] {
  const hist = new Set(accountLoginHistory('qq'));
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

/**
 * 抽屉「切换账号」弹出卡片（对照真实 QQ 截图样式）：
 * 白色圆角卡 + 上箭头小三角；每行 头像 + 名字 + 号码，当前账号右侧蓝勾。
 * 匿名号码不在此展示（2025 需求：匿名号只属于电话/信息，与切换账号无关）。
 * 数据口径与 SecurityPage 一致：登录过的账号（登录历史/存量会话/当前保底）+ 档案展示名。
 */
function QqDrawerAccountCard({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
  const [activeId, setActiveId] = useState<string>(() => getActiveAccountIdFor('qq'));
  /** 「添加账号」弹层：新建大号/小号，创建后直接登录进入 */
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const refresh = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string }>).detail;
      if (detail && detail.app !== 'qq') return;
      setAccounts(readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
      setActiveId(getActiveAccountIdFor('qq'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refresh);
  }, []);
  const [mainOwner, setMainOwner] = useState<{ name: string; qqId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', qqId: o.qqId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContactsFor('qq')
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
  const accNameOf = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) {
      const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主';
    }
    const profile = profileOf(acc);
    return (profile ? socialNameOf(profile) : '') || acc.name;
  };
  const accNoOf = (acc: PhoneAccount): string =>
    acc.id === MAIN_ACCOUNT_ID ? mainOwner?.qqId || acc.qqId || '' : acc.qqId;

  return (
    <div className="absolute inset-0 z-50" onClick={onClose} data-testid="qq-drawer-acc-card-backdrop">
      <div
        className="absolute left-5 top-[212px] w-[270px] overflow-visible rounded-[10px] bg-white shadow-[0_10px_38px_rgba(0,0,0,0.22)] dark:bg-[#232529]"
        onClick={(e) => e.stopPropagation()}
        data-testid="qq-drawer-acc-card"
      >
        {/* 上箭头小三角（指向抽屉「切换账号」胶囊按钮） */}
        <div aria-hidden="true" className="absolute -top-[6px] left-9 h-3 w-3 rotate-45 rounded-[2px] bg-white dark:bg-[#232529]" />
        <div className="overflow-hidden rounded-[10px]">
          {accounts.map((acc, idx) => {
            const isCurrent = acc.id === activeId;
            const name = accNameOf(acc);
            return (
              <button
                key={acc.id}
                type="button"
                data-testid={`qq-drawer-acc-row-${acc.id}`}
                onClick={isCurrent ? onClose : () => onPick(acc.id)}
                className={`flex h-[64px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  idx > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''
                }`}
              >
                {(() => {
                  // 第三十二轮：切换账号卡片头像跟随 QQ——每个账号显示自己档案的 QQ 槽位头像（avatars.qq），
                  // 没设过 QQ 头像时：大号回退机主全局头像，小号回退首字母彩色圆
                  const prof = profileOf(acc);
                  const accAvatar = prof?.avatars?.qq ?? (acc.id === MAIN_ACCOUNT_ID ? mainOwner?.avatar ?? null : null);
                  return accAvatar ? (
                    <QqAvatar src={accAvatar} alt={name} size={44} />
                  ) : (
                    <QqAccountBubble name={name} kind="alt" size={44} />
                  );
                })()}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block truncate text-[16px] font-medium leading-tight">{name}</span>
                    {/* 第三十二轮：「大号/小号」徽标删除——列表里都是可登录的账号，不再分档位 */}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-black/35 dark:text-white/35">{accNoOf(acc)}</span>
                </span>
                {isCurrent && <Check className="h-5 w-5 shrink-0 text-[#1E6FFF] dark:text-[#4AA3FF]" aria-hidden="true" />}
              </button>
            );
          })}
          {/* 添加账号：新建大号/小号（弹层见下），创建后自动登录并出现在列表 */}
          <button
            type="button"
            data-testid="qq-drawer-acc-add"
            onClick={() => setAddOpen(true)}
            className={`flex h-[56px] w-full items-center justify-center gap-1.5 text-[14px] text-black/60 active:bg-black/[0.04] dark:text-white/60 dark:active:bg-white/[0.06] ${
              accounts.length > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''
            }`}
          >
            <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-[#1E6FFF] text-[12px] leading-none text-white dark:bg-[#4AA3FF]" aria-hidden="true">＋</span>
            添加账号
          </button>
        </div>

        {/* 添加账号弹层：创建成功 → 写 QQ 登录态（会话 + 登录历史）→ 切到新账号（根组件事件驱动重读登录态，全程不刷新） */}
        {addOpen && (
          <AccountAddSheet
            onClose={() => setAddOpen(false)}
            onCreated={(acc, rec) => {
              setAddOpen(false);
              try {
                markAccountLoginHistory('qq', acc.id);
                clearForceLoginWall('qq');
                // 先切作用域再写会话：accLs 按当前账号现算，切换后写入的是新账号作用域的会话键
                switchAccountFor('qq', acc.id);
                window.localStorage.setItem(accLs(LS_SESSION, 'qq'), rec.id);
              } catch {
                // 存储异常忽略
              }
              onPick(acc.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

function SecurityPage({
  me,
  onBack,
  onToast,
  onLoginOther,
}: {
  me: QQUser;
  onBack: () => void;
  onToast: (m: string) => void;
  /** 「登录小号」自由登录成功 → 根组件 handleLogin（切作用域 + 记登录历史，Task 41） */
  onLoginOther: (u: QQUser) => void;
}) {
  // 多账号 v2（Task 40-2b）：账号管理区改读注册表（大号 + 小号；匿名号只属于电话/信息，不进 QQ）。
  // 切换账号不再整页刷新（switchAccountFor 事件驱动）→ 账号快照入组件 state 并订阅事件刷新（当前行蓝勾实时移动）
  // 多账号 Task 41：只显示「登录过」的小号（登录历史 / 存量会话兼容 / 当前账号保底）——
  // 联系人 App 刚创建、从未登录过的小号不进列表，用下方「登录小号」登录后才出现。
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
  const [activeId, setActiveId] = useState<string>(() => getActiveAccountIdFor('qq'));
  useEffect(() => {
    const refresh = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string }>).detail;
      if (detail && detail.app !== 'qq') return; // 其他 App 的账号切换与 QQ 账号列表无关
      setAccounts(readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
      setActiveId(getActiveAccountIdFor('qq'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refresh);
  }, []);
  /** 「登录小号」自由登录墙（覆盖全页；slot=null 不绑定槽位，用任意小号账密登录） */
  const [loginOpen, setLoginOpen] = useState(false);
  // 大号行显示资料（单库直读大号机主联系人 mainOwnerContact；Task 40-F 修正）:
  // 不能用 me（登录用户）——在小号视角下 me 是小号的登录身份，会把大号行显示成小号资料
  const [mainOwner, setMainOwner] = useState<{ name: string; qqId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', qqId: o.qqId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 账号显示名（Task 40-S）：与登录后 App 内展示口径一致——档案联系人展示名（备注>昵称>名字）优先，
  // 注册表名兼底。否则小号设了昵称后「切换账号页的名字和登录后的名字对不上」。
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContactsFor('qq')
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
  const accNameOf = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) {
      const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主';
    }
    const profile = profileOf(acc);
    return (profile ? socialNameOf(profile) : '') || acc.name;
  };
  const accNoOf = (acc: PhoneAccount): string =>
    acc.id === MAIN_ACCOUNT_ID
      ? mainOwner?.qqId || acc.qqId || ''
      : acc.kind === 'anon'
        ? acc.phone
        : acc.qqId;

  const linkRows: { icon: React.ReactNode; label: string; hint?: string; tail?: React.ReactNode }[] = [
    { icon: <PenguinMark size={22} className="text-[#3BA0FF]" />, label: '关联QQ号', tail: <QqAvatar src={me.avatar} alt={me.name} size={30} /> },
    { icon: <QrCode className="h-5 w-5" strokeWidth={1.9} />, label: 'QID', hint: '已开启' },
    { icon: <Smartphone className="h-5 w-5" strokeWidth={1.9} />, label: '手机号', hint: maskPhone(me.phone) },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '账号绑定与授权管理' },
  ];
  const safeRows: { icon: React.ReactNode; label: string; hint?: string }[] = [
    { icon: <KeyRound className="h-5 w-5" strokeWidth={1.9} />, label: '修改密码' },
    { icon: <MonitorSmartphone className="h-5 w-5" strokeWidth={1.9} />, label: '登录设备管理' },
    { icon: <LockKeyhole className="h-5 w-5" strokeWidth={1.9} />, label: '手势解锁', hint: '未设置' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '更多安全设置' },
  ];

  return (
    <div className="relative flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">账号与安全</span>
        <button type="button" className="ml-auto text-[16px] text-black/70 active:opacity-60 dark:text-white/70" onClick={() => onToast('编辑暂未开放')}>
          编辑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        {/* 关联账号横幅 */}
        <button
          type="button"
          onClick={() => onToast('关联账号暂未开放')}
          className="flex w-full items-center gap-3 rounded-[14px] bg-white px-4 py-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <PenguinMark size={26} className="shrink-0" />
          <span className="flex-1 text-[14px] leading-snug">点击添加关联账号，同时接收多个账号消息。</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]" data-testid="qq-security-accounts">
          {/* 注册表账号列表：当前账号蓝勾；点其他账号 → switchAccountFor('qq', id)（事件驱动不刷新，快照经事件订阅刷新） */}
          {accounts.map((acc, idx) => {
            const isCurrent = acc.id === activeId;
            const name = accNameOf(acc);
            return (
              <button
                key={acc.id}
                type="button"
                data-testid={`qq-account-row-${acc.id}`}
                onClick={isCurrent ? undefined : () => switchAccountFor('qq', acc.id)}
                className={`flex h-[64px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                  idx > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
                }`}
              >
                {acc.id === MAIN_ACCOUNT_ID ? (
                  <QqAvatar src={mainOwner?.avatar ?? null} alt={name} size={44} />
                ) : (
                  <QqAccountBubble name={name} kind={acc.kind === 'anon' ? 'anon' : 'alt'} size={44} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-medium">{name}</div>
                  <div className="truncate text-[13px] text-black/35 dark:text-white/35">{accNoOf(acc)}</div>
                </div>
                {isCurrent ? (
                  <Check className="h-5 w-5 shrink-0 text-[#1E6FFF] dark:text-[#4AA3FF]" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
                )}
              </button>
            );
          })}

          {/* 登录小号入口（Task 41）：小号统一在联系人 App 「小号」tab 创建；创建后不直接出现在列表，
              在这里用小号账密登录成功后才出现（登录历史），登录过的小号切换不再需要登录 */}
          <button
            type="button"
            data-testid="qq-account-login-alt"
            onClick={() => setLoginOpen(true)}
            className="flex h-[64px] w-full items-center gap-3 border-t border-black/[0.04] px-4 text-left active:bg-black/[0.03] dark:border-white/[0.05] dark:active:bg-white/[0.06]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/30 dark:bg-white/[0.08] dark:text-white/30">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-black/45 dark:text-white/45">登录小号</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/25 dark:text-white/25">新建小号：打开联系人 App → 「小号」；登录后出现在上面的列表</span>
            </span>
          </button>
        </div>
        <p className="px-1 pt-2 text-[12px] leading-snug text-black/30 dark:text-white/30">切换仅作用于 QQ，不影响微信 / 信息 / 电话的账号；在联系人 App 删除小号后，正在使用它的 App 会自动退出该账号。</p>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号关联</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {linkRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              {r.tail ?? null}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">安全管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {safeRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* 登录小号：自由登录墙覆盖层（slot=null 不绑定槽位；返回关闭不退出 QQ） */}
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
    </div>
  );
}

// ---------------- QQ 钱包（个人中心抽屉「钱包」入口；对照真机：主页/余额/小金库/银行卡/提现/充值/账单） ----------------

export interface WalletData {
  /** 余额（元） */
  balance: number;
  /** Q币 */
  qb: number;
  /** 小金库（元） */
  vault: number;
}

export interface BankCard {
  id: string;
  /** 持卡人 */
  holder: string;
  /** 卡号尾号 4 位（仅本机保存，不上传） */
  last4: string;
  /** 银行名 */
  bank: string;
  /** 完整卡号（自生成卡号无隐私问题；旧版本卡片可能缺失，展示时兜底为星号分组） */
  no?: string;
  /** 卡内金额（元，添加时自定义） */
  balance?: number;
  /** 卡类型：储蓄卡 / 信用卡 */
  type?: string;
  /** 添加时间戳 */
  createdAt?: number;
}

/** 预设银行品牌元数据：卡片渐变品牌色 + 发卡行 BIN 前缀（卡号生成用） */
const BANK_META: Record<string, { from: string; to: string; bin: string }> = {
  工商银行: { from: '#D62E36', to: '#A3121A', bin: '62220' },
  建设银行: { from: '#0A6EBD', to: '#094E85', bin: '62172' },
  农业银行: { from: '#0DA45F', to: '#087A45', bin: '62284' },
  中国银行: { from: '#B4232C', to: '#821720', bin: '62166' },
  交通银行: { from: '#1263A0', to: '#0B3F6B', bin: '62226' },
  招商银行: { from: '#D2302F', to: '#96191C', bin: '62258' },
  邮储银行: { from: '#0E8A50', to: '#096A3B', bin: '62179' },
};
/** 未识别银行的兜底配色 */
const BANK_FALLBACK = { from: '#4C6B8A', to: '#2E4A66' };

/** Luhn 校验位：由前 n-1 位算出第 n 位（生成的卡号可通过标准银行卡校验） */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

/** 生成符合 Luhn 校验的银行卡号：储蓄卡 19 位 / 信用卡 16 位，BIN 前缀跟随所选银行 */
function genCardNo(bank: string, type: string): string {
  const bin = BANK_META[bank]?.bin ?? '6222';
  const len = type === '信用卡' ? 16 : 19;
  let body = bin;
  while (body.length < len - 1) body += Math.floor(Math.random() * 10).toString();
  return body + luhnCheckDigit(body);
}

/** 卡号展示：4 位一组空格分组；无完整卡号的旧数据兜底为 **** **** **** 尾号 */
function formatCardNo(card: Pick<BankCard, 'no' | 'last4'>): string {
  const src = card.no && /^\d{15,19}$/.test(card.no) ? card.no : `****${card.last4}`;
  return src.replace(/(\d{4})(?=\d)/g, '$1 ');
}

interface WalletBill {
  id: string;
  title: string;
  /** 正=收入 负=支出 */
  amount: number;
  ts: number;
  /** 账单类型（美化版账单页筛选/图标用；旧数据缺省按标题推断） */
  kind?: 'redpacket' | 'transfer' | 'topup' | 'withdraw' | 'vault' | 'refund';
  /** 对方头像（转账条目显示对方头像；旧数据/群场景缺省用图标兕底） */
  avatar?: string | null;
  /** 已退款金额（原支出条目下方红色「已退款X元」标注） */
  refund?: number;
}

/** 默认钱包（对照真机演示数据：余额 1.03 / Q币 0.10 / 小金库 0.00） */
const DEFAULT_WALLET: WalletData = { balance: 1.03, qb: 0.1, vault: 0 };

export function loadWallet(): WalletData {
  try {
    const p: unknown = kvGet(LS_WALLET);
    if (p && typeof p === 'object') {
      const d = p as Partial<WalletData>;
      return {
        balance: typeof d.balance === 'number' && d.balance >= 0 ? d.balance : DEFAULT_WALLET.balance,
        qb: typeof d.qb === 'number' && d.qb >= 0 ? d.qb : DEFAULT_WALLET.qb,
        vault: typeof d.vault === 'number' && d.vault >= 0 ? d.vault : DEFAULT_WALLET.vault,
      };
    }
  } catch {
    // 忽略
  }
  return { ...DEFAULT_WALLET };
}

function saveWallet(d: WalletData): void {
  try {
    kvSet(LS_WALLET, d);
  } catch {
    // 忽略
  }
}

export function loadBankCards(): BankCard[] {
  try {
    const p: unknown = kvGet<BankCard[]>(LS_WALLET_CARDS);
    if (Array.isArray(p)) return p.filter((c) => c && typeof c === 'object' && typeof (c as BankCard).last4 === 'string');
  } catch {
    // 忽略
  }
  return [];
}

function saveBankCards(list: BankCard[]): void {
  try {
    kvSet(LS_WALLET_CARDS, list);
  } catch {
    // 忽略
  }
}

function loadWalletBills(): WalletBill[] {
  try {
    const p: unknown = kvGet<WalletBill[]>(LS_WALLET_BILLS);
    if (Array.isArray(p)) return p.filter((b) => b && typeof b === 'object' && typeof (b as WalletBill).amount === 'number');
  } catch {
    // 忽略
  }
  return [];
}

function saveWalletBills(list: WalletBill[]): void {
  try {
    kvSet(LS_WALLET_BILLS, list);
  } catch {
    // 忽略
  }
}

/** 从钱包余额扣款（发红包/转账用）：成功返回 true；余额不足返回 false；同步写账单 */
function payFromWallet(amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  const w = loadWallet();
  if (!(amount > 0) || w.balance < amount) return false;
  saveWallet({ ...w, balance: round2(w.balance - amount) });
  saveWalletBills([
    { id: uid(), title: billTitle, amount: -amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 收款入钱包余额（领取红包用），同步写账单 */
export function gainToWallet(amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): void {
  const w = loadWallet();
  saveWallet({ ...w, balance: round2(w.balance + amount) });
  saveWalletBills([
    { id: uid(), title: billTitle, amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
}

/** 退款入钱包余额（红包/转账被退回/拒收/过期）：余额照常增加；账单侧不给收入条目，
 *  而是给最近一条同场景未退款的支出条目标注 refund（美化账单页原条目下红字「已退款X元」，对齐真机） */
function refundToWallet(amount: number, kind: 'redpacket' | 'transfer'): void {
  if (!(amount > 0)) return;
  const w = loadWallet();
  saveWallet({ ...w, balance: round2(w.balance + amount) });
  const bills = loadWalletBills();
  const idx = bills.findIndex((b) => b.kind === kind && b.amount === -amount && b.refund === undefined);
  if (idx >= 0) {
    saveWalletBills(bills.map((b, i) => (i === idx ? { ...b, refund: amount } : b)));
  } else {
    // 找不到原条目（可能是旧数据/群聊）：兑底写一条退款收入条目，保证资金可追溯
    const fallback: WalletBill = { id: uid(), title: kind === 'redpacket' ? 'QQ红包-退回' : '转账-退回', amount, ts: Date.now(), kind: 'refund' };
    saveWalletBills([fallback, ...bills].slice(0, 100));
  }
}

// ---------------- 支付密码 / 支付方式（红包/转账可选余额或银行卡支付） ----------------

interface PayPwdData {
  enabled: boolean;
  /** 6 位数字密码（仅本机 localStorage 保存） */
  pwd: string | null;
}

const LS_PAY_PWD = 'qq-pay-pwd';

export function loadPayPwd(): PayPwdData {
  try {
    const p: unknown = kvGet(LS_PAY_PWD);
    if (p && typeof p === 'object') {
      const d = p as Partial<PayPwdData>;
      const pwd = typeof d.pwd === 'string' && /^\d{6}$/.test(d.pwd) ? d.pwd : null;
      return { enabled: d.enabled === true && pwd !== null, pwd };
    }
  } catch {
    // 忽略
  }
  return { enabled: false, pwd: null };
}

function savePayPwd(d: PayPwdData): void {
  try {
    kvSet(LS_PAY_PWD, d);
  } catch {
    // 忽略
  }
}

// #97 支付密码暴力试错保护——照搬微信 #48 同款：5 次失败 30s 锁定（localStorage 跨组件共享）
export const QQ_LS_PAY_PWD_LOCK = 'qq-pay-pwd-lock';
export const QQ_PAY_PWD_MAX_FAIL = 5;
export const QQ_PAY_PWD_LOCK_MS = 30 * 1000;

interface QqPayPwdLockData {
  fails: number;
  lockedUntil: number;
}

export function qqLoadPayPwdLock(): QqPayPwdLockData {
  try {
    const raw = window.localStorage.getItem(QQ_LS_PAY_PWD_LOCK);
    if (!raw) return { fails: 0, lockedUntil: 0 };
    const p = JSON.parse(raw) as Partial<QqPayPwdLockData>;
    return {
      fails: typeof p.fails === 'number' && p.fails >= 0 ? p.fails : 0,
      lockedUntil: typeof p.lockedUntil === 'number' && p.lockedUntil > 0 ? p.lockedUntil : 0,
    };
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

export function qqSavePayPwdLock(d: QqPayPwdLockData): void {
  try {
    window.localStorage.setItem(QQ_LS_PAY_PWD_LOCK, JSON.stringify(d));
  } catch {
    // 忽略
  }
}

/** 清零失败次数与锁定（成功支付/修改密码成功/关闭支付密码时调用） */
export function qqClearPayPwdLock(): void {
  qqSavePayPwdLock({ fails: 0, lockedUntil: 0 });
}

/** 记录一次失败：累加 fails，达到 5 次设 lockedUntil = now + 30s；返回更新后的状态 */
export function qqRecordPayPwdFail(): QqPayPwdLockData {
  const cur = qqLoadPayPwdLock();
  const fails = cur.fails + 1;
  const lockedUntil = fails >= QQ_PAY_PWD_MAX_FAIL ? Date.now() + QQ_PAY_PWD_LOCK_MS : cur.lockedUntil;
  const next = { fails, lockedUntil };
  qqSavePayPwdLock(next);
  return next;
}

/** 从指定银行卡扣款（红包/转账选卡支付用），同步写账单；卡不存在或余额不足返回 false */
function payFromCard(cardId: string, amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  if (!(amount > 0)) return false;
  const list = loadBankCards();
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx < 0) return false;
  const card = list[idx];
  if ((card.balance ?? 0) < amount) return false;
  list[idx] = { ...card, balance: round2((card.balance ?? 0) - amount) };
  saveBankCards(list);
  saveWalletBills([
    { id: uid(), title: `${billTitle}（${card.bank}尾号${card.last4}）`, amount: -amount, ts: Date.now(), kind: meta?.kind, avatar: meta?.avatar },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 支付前预检：所选支付方式（余额/银行卡）余额是否充足 */
export function canPay(methodId: string, amount: number): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return loadWallet().balance >= amount;
  const c = loadBankCards().find((x) => x.id === methodId);
  return Boolean(c) && (c?.balance ?? 0) >= amount;
}

/** 按所选支付方式扣款（余额 / 银行卡），同步写账单；meta 传对方名/头像（账单条目展示用） */
export function executePayment(methodId: string, amount: number, billTitle: string, meta?: { kind?: WalletBill['kind']; avatar?: string | null }): boolean {
  if (!(amount > 0)) return false;
  if (methodId === 'balance') return payFromWallet(amount, billTitle, meta);
  return payFromCard(methodId, amount, billTitle, meta);
}

/** 退款原路退回银行卡（美团退款用）：卡余额回补 + 写一条收入账单（kind=refund） */
export function refundToBankCard(cardId: string, amount: number, billTitle = '美团外卖-退款'): boolean {
  if (!(amount > 0)) return false;
  const list = loadBankCards();
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx < 0) return false;
  const card = list[idx];
  list[idx] = { ...card, balance: round2((card.balance ?? 0) + amount) };
  saveBankCards(list);
  saveWalletBills([
    { id: uid(), title: `${billTitle}（${card.bank}尾号${card.last4}）`, amount, ts: Date.now(), kind: 'refund' as const },
    ...loadWalletBills(),
  ].slice(0, 100));
  return true;
}

/** 支付方式展示名（支付密码验证浮层副标题用） */
function methodLabel(methodId: string): string {
  if (methodId === 'balance') return 'QQ钱包余额';
  const c = loadBankCards().find((x) => x.id === methodId);
  return c ? `${c.bank}（尾号${c.last4}）` : '支付方式';
}

// ---------------- 小金库收益（按七日年化每日结算，localStorage 持久化） ----------------

/** 演示利率：最高七日年化 1.5120% */
const VAULT_RATE = 0.015120;
const VAULT_DAILY_RATE = VAULT_RATE / 365;

interface VaultEarnEntry {
  /** 本地日期键（2026-2-4） */
  date: string;
  /** 当日收益（元） */
  amount: number;
}

interface VaultEarnData {
  /** 上次结算日期（本地日期键） */
  lastDate: string;
  log: VaultEarnEntry[];
}

const LS_VAULT_EARN = 'qq-vault-earn';

function loadVaultEarn(): VaultEarnData {
  try {
    const p: unknown = kvGet(LS_VAULT_EARN);
    if (p && typeof p === 'object') {
      const d = p as Partial<VaultEarnData>;
      if (typeof d.lastDate === 'string' && Array.isArray(d.log)) {
        return { lastDate: d.lastDate, log: d.log.filter((e) => Boolean(e) && typeof e.date === 'string' && typeof e.amount === 'number') };
      }
    }
  } catch {
    // 忽略
  }
  return { lastDate: '', log: [] };
}

function saveVaultEarn(d: VaultEarnData): void {
  try {
    kvSet(LS_VAULT_EARN, d);
  } catch {
    // 忽略
  }
}

/** 本地日期键转 Date（避免 'Y-M-D' 非 ISO 串的解析差异） */
function parseDateKey(key: string): Date | null {
  const parts = key.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 结算小金库收益：从上次结算日（首次回溯到最早一笔小金库账单日）逐日补记到今天，按当前余额近似；同日重复调用直接返回缓存 */
function settleVaultEarn(vault: number): VaultEarnData {
  const today = localDateKey();
  const prev = loadVaultEarn();
  if (prev.lastDate === today) return prev;
  let start = prev.lastDate;
  if (!start) {
    const vaultBills = loadWalletBills().filter((b) => b.title === '转入小金库' || b.title === '小金库转出');
    start = vaultBills.length ? localDateKey(new Date(Math.min(...vaultBills.map((b) => b.ts)))) : today;
  }
  const log = [...prev.log];
  const cur = parseDateKey(start) ?? parseDateKey(today);
  const end = parseDateKey(today);
  if (cur && end) {
    let it = cur <= end ? new Date(cur) : new Date(end); // 时钟回拨兜底：从今天起算
    let guard = 0;
    while (guard < 400) {
      guard += 1;
      const key = localDateKey(it);
      const amt = Math.round(vault * VAULT_DAILY_RATE * 10000) / 10000;
      if (amt > 0 && !log.some((e) => e.date === key)) log.push({ date: key, amount: amt });
      if (key === today) break;
      it.setDate(it.getDate() + 1);
    }
  }
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  const next: VaultEarnData = { lastDate: today, log: log.slice(-90) };
  saveVaultEarn(next);
  return next;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 金额大数字：整数大号 + 两位小数小号（对照真机余额/Q币「1.03」排版） */
function MoneyDigits({ value, className = '', fracClassName = '' }: { value: number; className?: string; fracClassName?: string }) {
  const [int, frac] = Math.abs(value).toFixed(2).split('.');
  return (
    <span className={className}>
      {value < 0 ? '-' : ''}
      {int}
      <span className={fracClassName}>.{frac}</span>
    </span>
  );
}

/** 金额输入通用约束：最多 7 位整数 + 2 位小数 */
export function sanitizeAmount(v: string): string {
  return /^\d{0,7}(\.\d{0,2})?$/.test(v) ? v : v.slice(0, -1);
}

/** 钱包子页导航头（tone 决定配色：plain 白底黑字 / blue 蓝底白字 / gold 金底白字） */
function WalletNavHeader({ title, tone = 'plain', onBack, right }: { title: string; tone?: 'plain' | 'blue' | 'gold'; onBack: () => void; right?: React.ReactNode }) {
  const toneCls =
    tone === 'blue' ? 'text-white' : tone === 'gold' ? 'text-white' : 'text-[#1F2329] dark:text-white';
  const btnCls = tone === 'plain' ? 'text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10' : 'text-white/90 active:bg-white/15';
  return (
    <div className={`relative flex h-11 shrink-0 items-center px-2 ${toneCls}`}>
      <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className={`grid h-9 w-9 place-items-center rounded-full ${btnCls}`}>
        <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
      </button>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">{title}</span>
      {right ?? null}
    </div>
  );
}

/** 钱包主页（对照截图①：蓝色头部四宫格 + 金融理财/游戏娱乐/生活服务三分区宫格；右上齿轮进支付设置） */
function WalletHomePage({
  wallet,
  onBack,
  onToast,
  onOpenBalance,
  onOpenVault,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenBalance: () => void;
  onOpenVault: () => void;
  onOpenPaySettings: () => void;
}) {
  const topCells: { key: string; label: string; dot?: boolean; node: React.ReactNode; onClick: () => void }[] = [
    {
      key: 'balance',
      label: '余额',
      node: <MoneyDigits value={wallet.balance} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: onOpenBalance,
    },
    {
      key: 'qb',
      label: 'Q币',
      node: <MoneyDigits value={wallet.qb} className="text-[28px] font-bold leading-none" fracClassName="text-[15px] font-bold" />,
      onClick: () => onToast('Q币充值暂未开放'),
    },
    { key: 'gift', label: '领福利', dot: true, node: <Gift className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('领福利暂未开放') },
    { key: 'loan', label: '微粒贷', dot: true, node: <CreditCard className="h-8 w-8" strokeWidth={1.7} />, onClick: () => onToast('微粒贷暂未开放') },
  ];

  const groups: { label: string; items: { label: string; color: string; icon: React.ReactNode; onClick: () => void }[] }[] = [
    {
      label: '金融理财',
      items: [
        { label: '小金库', color: '#F5A623', icon: <PiggyBank className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: onOpenVault },
        { label: '申信用卡', color: '#F0605C', icon: <CreditCard className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('申信用卡暂未开放') },
        { label: '还信用卡', color: '#2FBF71', icon: <Landmark className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('还信用卡暂未开放') },
      ],
    },
    {
      label: '游戏娱乐',
      items: [
        { label: '游戏充值', color: '#2FBF71', icon: <Gamepad2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏充值暂未开放') },
        { label: '会员充值', color: '#F5A623', icon: <Gem className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('会员充值暂未开放') },
        { label: '鹅毛市集', color: '#3BA0FF', icon: <Feather className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('鹅毛市集暂未开放') },
        { label: '游戏赚Q币', color: '#F5A623', icon: <BellRing className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('游戏赚Q币暂未开放') },
      ],
    },
    {
      label: '生活服务',
      items: [
        { label: '手机充值', color: '#F5A623', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('手机充值暂未开放') },
        { label: '高校权益', color: '#3BA0FF', icon: <GraduationCap className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('高校权益暂未开放') },
        { label: '火车票机票', color: '#2FBF71', icon: <Bus className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('火车票机票暂未开放') },
        { label: '猫眼电影', color: '#F0605C', icon: <Cat className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('猫眼电影暂未开放') },
        { label: '腾讯公益', color: '#F0605C', icon: <Flower2 className="h-[26px] w-[26px]" strokeWidth={1.8} />, onClick: () => onToast('腾讯公益暂未开放') },
      ],
    },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 蓝色头部：导航 + 四宫格（余额/Q币 数字、领福利/微粒贷 图标带红点） */}
      <div className="shrink-0 bg-gradient-to-b from-[#2CB3F8] to-[#1B9FF0] px-4 pb-8 pt-[54px]">
        <div className="relative flex h-10 items-center text-white">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[18px] font-medium">QQ钱包</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="收付款" onClick={() => onToast('收付款暂未开放')} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <QrCode className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
            <button type="button" aria-label="支付设置" onClick={onOpenPaySettings} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
              <Settings className="h-[21px] w-[21px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 pt-7">
          {topCells.map((c) => (
            <button key={c.key} type="button" data-testid={`qq-wallet-cell-${c.key}`} onClick={c.onClick} className="flex flex-col items-center gap-2.5 text-white active:opacity-70">
              {c.key === 'gift' || c.key === 'loan' ? (
                <span className="relative grid h-9 place-items-center">
                  {c.node}
                  {c.dot && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-[#F5455C]" aria-hidden="true" />}
                </span>
              ) : (
                <span className="grid h-9 place-items-center">{c.node}</span>
              )}
              <span className="text-[15px]">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 白色圆角主区（叠压蓝底）：三分区彩色描边宫格 */}
      <div className="relative -mt-5 flex-1 overflow-y-auto rounded-t-[20px] bg-white px-4 pb-8 dark:bg-[#1B1C1F]">
        {groups.map((g) => (
          <section key={g.label}>
            <p className="px-1 pb-1 pt-5 text-[13px] text-black/40 dark:text-white/40">{g.label}</p>
            <div className="grid grid-cols-4 gap-y-6 pt-3">
              {g.items.map((item) => (
                <button key={item.label} type="button" onClick={item.onClick} className="flex flex-col items-center gap-2 active:opacity-60">
                  <span className="grid h-11 w-11 place-items-center" style={{ color: item.color }} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="text-[14px] text-[#1F2329] dark:text-white">{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** 余额页（对照截图②：蓝渐变 + 大白卡余额 + 转到微信/微信转入 + 充值/提现/银行卡列表 + 支付设置/财付通页脚） */
function BalancePage({
  wallet,
  cards,
  onBack,
  onToast,
  onOpenTopUp,
  onOpenWithdraw,
  onOpenCards,
  onOpenBills,
  onOpenPaySettings,
}: {
  wallet: WalletData;
  cards: BankCard[];
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenTopUp: () => void;
  onOpenWithdraw: () => void;
  onOpenCards: () => void;
  onOpenBills: () => void;
  onOpenPaySettings: () => void;
}) {
  const rows = [
    { key: 'topup', label: '充值', sub: undefined as string | undefined, icon: <PiggyBank className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#F5A623', onClick: onOpenTopUp },
    { key: 'withdraw', label: '提现', sub: undefined as string | undefined, icon: <Banknote className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenWithdraw },
    { key: 'cards', label: '银行卡', sub: cards.length > 0 ? `已绑定 ${cards.length} 张` : '添加银行卡', icon: <Landmark className="h-[22px] w-[22px]" strokeWidth={1.8} />, color: '#1F2329', onClick: onOpenCards },
  ];
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#1B9FF0] via-[#9FD4F8] to-[#F5F6F8] pt-[54px] dark:from-[#0F5E97] dark:via-[#14486E] dark:to-[#16171A]">
      <WalletNavHeader title="余额" tone="blue" onBack={onBack} right={
        <button type="button" data-testid="qq-wallet-bills" onClick={onOpenBills} className="ml-auto mr-1 text-[16px] text-white active:opacity-60">账单</button>
      } />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="mt-2 rounded-[16px] bg-white px-6 pb-8 pt-8 dark:bg-[#232529]">
          <p className="text-center text-[15px] text-black/55 dark:text-white/55">可用余额 (元)</p>
          <div className="mt-2 text-center text-[#1F2329] dark:text-white">
            <MoneyDigits value={wallet.balance} className="text-[54px] font-semibold leading-tight tracking-tight" fracClassName="text-[28px] font-semibold" />
          </div>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button type="button" data-testid="qq-wallet-to-wx" onClick={() => onToast('请先安装微信')} className="h-11 w-[210px] rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">转到微信</button>
            <button type="button" onClick={() => onToast('微信转入暂未开放')} className="h-11 w-[210px] rounded-full border border-black/15 text-[16px] text-[#1F2329] active:opacity-60 dark:border-white/20 dark:text-white">微信转入</button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[16px] bg-white dark:bg-[#232529]">
          {rows.map((r, i) => (
            <button key={r.key} type="button" data-testid={`qq-wallet-row-${r.key}`} onClick={r.onClick} className={`flex h-14 w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''}`}>
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">
                {r.label}
                {r.sub ? <span className="ml-2 text-[12px] text-black/35 dark:text-white/35">{r.sub}</span> : null}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="mt-9 text-center">
          <p className="text-[14px] text-[#1B9FF0]">
            <button type="button" onClick={() => onToast('身份信息暂未开放')}>身份信息</button>
            <span className="mx-2 text-black/20 dark:text-white/25" aria-hidden="true">|</span>
            <button type="button" data-testid="qq-pay-settings" onClick={onOpenPaySettings}>支付设置</button>
          </p>
          <p className="mt-2.5 text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
        </div>
      </div>
    </div>
  );
}

/** 小金库转入/转出金额弹层（半屏底部面板） */
function VaultAmountSheet({ mode, max, onClose, onConfirm }: { mode: 'in' | 'out'; max: number; onClose: () => void; onConfirm: (n: number) => void }) {
  const [val, setVal] = useState('');
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= max;
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={mode === 'in' ? '转入小金库' : '转出小金库'} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-5 pb-9 pt-5 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-semibold text-[#1F2329] dark:text-white">{mode === 'in' ? '转入小金库' : '转出小金库'}</p>
        <div className="mt-4 flex items-center gap-2 border-b border-black/10 pb-3 dark:border-white/15">
          <span className="text-[28px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
          <input
            value={val}
            autoFocus
            inputMode="decimal"
            onChange={(e) => setVal(sanitizeAmount(e.target.value))}
            placeholder="0.00"
            aria-label="金额"
            data-testid="qq-vault-amount-input"
            className="w-full bg-transparent text-[28px] font-medium text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        <p className="mt-3 text-[13px] text-black/45 dark:text-white/45">
          {mode === 'in' ? `余额可用 ${fmtMoney(max)} 元` : `小金库可用 ${fmtMoney(max)} 元`}
          <button type="button" className="ml-2 text-[#B8803F]" onClick={() => setVal(max.toFixed(2))}>
            {mode === 'in' ? '全部转入' : '全部转出'}
          </button>
        </p>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-vault-amount-ok"
          onClick={() => ok && onConfirm(num)}
          className={`mt-6 h-12 w-full rounded-[12px] text-[16px] font-medium text-white ${ok ? 'bg-gradient-to-r from-[#C99B58] to-[#D9B27C] active:opacity-85' : 'bg-[#E4CEA4]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 小金库收益详情页（金色渐变累计收益卡 + 产品利率 + 近7日柱状图 + 每日收益记录） */
function VaultEarnPage({ earn, onBack }: { earn: VaultEarnData; onBack: () => void }) {
  const todayKey = localDateKey();
  const entries = [...earn.log].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const today = earn.log.find((e) => e.date === todayKey)?.amount ?? 0;
  const yesterday = entries.find((e) => e.date !== todayKey)?.amount ?? 0;
  const last7 = earn.log.slice(-7);
  const max = Math.max(...last7.map((e) => e.amount), 0.0001);
  const dayLabel = (d: string): string => {
    const parts = d.split('-');
    return `${parts[1] ?? d}/${parts[2] ?? ''}`;
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F6F4EF] pt-[54px] dark:bg-[#1B1A15]" data-testid="qq-vault-earn-page">
      <WalletNavHeader title="收益详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {/* 累计收益金卡 */}
        <div className="mt-3 rounded-[16px] bg-gradient-to-br from-[#C99B58] to-[#D9B27C] px-5 pb-5 pt-5 text-white shadow-md shadow-black/10">
          <div className="flex items-center gap-1.5 text-[14px] text-white/90">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            累计收益 (元)
          </div>
          <p className="mt-1.5 text-[40px] font-bold leading-none tracking-tight" data-testid="qq-vault-earn-total">{fmtMoney(total)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">昨日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(yesterday)}</p>
            </div>
            <div className="rounded-[10px] bg-white/15 px-3 py-2.5">
              <p className="text-[12px] text-white/85">今日收益</p>
              <p className="mt-1 text-[18px] font-semibold leading-none">{fmtMoney(today)}</p>
            </div>
          </div>
        </div>
        {/* 产品与利率 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">农银汇理红利日结货币A</p>
            <span className="rounded-full bg-[#C99B58]/15 px-2 py-1 text-[11px] text-[#B8803F] dark:bg-[#C99B58]/25 dark:text-[#D9AC6C]">货币基金 · 低风险</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">最高七日年化</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#B8803F] dark:text-[#D9AC6C]">+{(VAULT_RATE * 100).toFixed(4)}%</p>
            </div>
            <div className="rounded-[10px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]">
              <p className="text-[12px] text-black/45 dark:text-white/45">万份收益(元)</p>
              <p className="mt-1 text-[18px] font-semibold leading-none text-[#1F2329] dark:text-white">{(10000 * VAULT_DAILY_RATE).toFixed(4)}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-black/40 dark:text-white/40">收益 = 前一日小金库余额 × 七日年化利率 ÷ 365，每日自动结算发放。</p>
        </div>
        {/* 近7日柱状图 */}
        {last7.length > 0 ? (
          <div className="mt-4 rounded-[16px] bg-white px-4 py-4 dark:bg-[#232529]">
            <p className="text-[15px] font-medium text-[#1F2329] dark:text-white">近7日收益</p>
            <div className="mt-4 flex h-[110px] items-end gap-2.5">
              {last7.map((e) => (
                <div key={e.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-black/45 dark:text-white/45">{e.amount > 0 ? e.amount.toFixed(2) : ''}</span>
                  <span className="w-full max-w-[26px] rounded-t-[6px] bg-gradient-to-t from-[#C99B58] to-[#EBCB96]" style={{ height: `${Math.max(6, (e.amount / max) * 82)}px` }} aria-hidden="true" />
                  <span className="text-[10px] text-black/40 dark:text-white/40">{dayLabel(e.date)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {/* 每日收益记录 */}
        <div className="mt-4 rounded-[16px] bg-white px-4 py-2 dark:bg-[#232529]">
          <p className="border-b border-black/[0.04] py-2.5 text-[15px] font-medium text-[#1F2329] dark:border-white/[0.06] dark:text-white">收益记录</p>
          {entries.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-black/35 dark:text-white/35">暂无收益，转入小金库后开始产生收益</p>
          ) : (
            entries.map((e, i) => (
              <div key={e.date} className={`flex h-[52px] items-center justify-between ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}>
                <span className="text-[14px] text-black/55 dark:text-white/55">{e.date} 收益</span>
                <span className="text-[15px] font-medium text-[#B8803F] dark:text-[#D9AC6C]">+{fmtMoney(e.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 小金库页（对照截图③：金色渐变 + 攒钱还能享收益 + 余额/七日年化/累计收益 + 转入/转出 + 收益详情） */
function VaultPage({
  wallet,
  onBack,
  onToast,
  onMove,
}: {
  wallet: WalletData;
  onBack: () => void;
  onToast: (m: string) => void;
  onMove: (mode: 'in' | 'out', n: number) => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [sheet, setSheet] = useState<'in' | 'out' | null>(null);
  // 收益：每次进入小金库页时结算（同日幂返回缓存），累计/昨日收益持久化在 localStorage
  const [earn] = useState(() => settleVaultEarn(wallet.vault));
  const [earnOpen, setEarnOpen] = useState(false);
  const earnTotal = round2(earn.log.reduce((s, e) => s + e.amount, 0));
  const earnYesterday = earn.log.length >= 2 ? earn.log[earn.log.length - 2].amount : 0;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#EDD8B9] via-[#F4E8D5] to-[#F5F6F8] pt-[54px] dark:from-[#3A3222] dark:via-[#2C271D] dark:to-[#16171A]">
      {/* 整页滚动：小金库导航头部随内容一起滚动，不再固定 */}
      <div className="flex-1 overflow-y-auto">
      <WalletNavHeader
        title="小金库"
        tone="gold"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-8">
        <h1 className="mt-4 flex items-start text-[32px] font-black leading-tight">
          <span className="bg-gradient-to-r from-[#A9702E] via-[#D6A45E] to-[#B8803F] bg-clip-text text-transparent dark:from-[#D9AC6C] dark:via-[#EBCB96] dark:to-[#D2A365]">攒钱还能享收益</span>
          <Sparkles className="ml-1 mt-0.5 h-4 w-4 shrink-0 text-white/90 dark:text-[#EBCB96]" aria-hidden="true" />
        </h1>
        <div className="mt-3.5 flex h-9 items-center gap-1.5 rounded-full bg-[#8A6A3F]/15 px-3 text-[13px] text-[#7A5C30] dark:bg-[#8A6A3F]/25 dark:text-[#E3C893]">
          <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">利率下行，闲钱躺卡每日贬值，试试理财享收益</span>
        </div>

        <div className="mt-4 rounded-[16px] bg-white px-6 pb-6 pt-7 dark:bg-[#232529]">
          <div className="flex items-center justify-center gap-1.5 text-[15px] text-black/55 dark:text-white/55">
            账户余额(元)
            <button type="button" aria-label={hidden ? '显示余额' : '隐藏余额'} data-testid="qq-vault-eye" onClick={() => setHidden(!hidden)} className="active:opacity-60">
              {hidden ? <EyeOff className="h-4.5 w-4.5" strokeWidth={1.8} /> : <Eye className="h-4.5 w-4.5" strokeWidth={1.8} />}
            </button>
          </div>
          <p className="mt-2 text-center text-[48px] font-semibold leading-tight text-[#1F2329] dark:text-white" data-testid="qq-vault-balance">
            {hidden ? '****' : fmtMoney(wallet.vault)}
          </p>
          <p className="mt-1 flex items-center justify-center gap-1 text-[13px] text-[#B8803F] dark:text-[#D9AC6C]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            资金安全保障中
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </p>

          <div className="mt-8 grid grid-cols-2 gap-4 text-[#1F2329] dark:text-white">
            <div>
              <button type="button" onClick={() => onToast('产品详情暂未开放')} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                最高七日年化
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">+1.5120%</p>
              <span className="mt-2.5 inline-block max-w-full truncate rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">农银汇理红利日结货币A</span>
            </div>
            <div>
              <button type="button" data-testid="qq-vault-earn-total" onClick={() => setEarnOpen(true)} className="flex items-center text-[14px] text-black/50 dark:text-white/50">
                累计收益(元)
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <p className="mt-2 text-[24px] font-semibold leading-none">{fmtMoney(earnTotal)}</p>
              <span className="mt-2.5 inline-block rounded bg-black/[0.04] px-1.5 py-1 text-[11px] text-black/45 dark:bg-white/[0.08] dark:text-white/45">昨日: {fmtMoney(earnYesterday)}</span>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3.5">
            <button type="button" data-testid="qq-vault-in" onClick={() => setSheet('in')} className="h-12 w-full rounded-[12px] bg-gradient-to-r from-[#C99B58] to-[#D9B27C] text-[16px] font-medium text-white active:opacity-85">转入</button>
            <button type="button" data-testid="qq-vault-out" onClick={() => setSheet('out')} className="h-12 w-full rounded-[12px] border border-[#C9A063] text-[16px] font-medium text-[#B8803F] active:opacity-60 dark:text-[#D9AC6C]">转出</button>
          </div>

          <div className="mt-7 flex items-center gap-2 border-t border-black/[0.06] pt-4 text-[13px] text-black/45 dark:border-white/[0.08] dark:text-white/45">
            了解更多
            <span className="rounded bg-black/[0.04] px-2 py-1.5 text-[12px] dark:bg-white/[0.08]">资金安全有保障吗?</span>
            <button type="button" onClick={() => onToast('更多暂未开放')} className="ml-auto flex items-center text-[#B8803F] dark:text-[#D9AC6C]">
              更多
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] text-black/35 dark:text-white/35">基金销售服务由腾安基金销售（深圳）有限公司提供</p>
      </div>
      </div>

      {sheet && (
        <VaultAmountSheet
          mode={sheet}
          max={sheet === 'in' ? wallet.balance : wallet.vault}
          onClose={() => setSheet(null)}
          onConfirm={(n) => {
            onMove(sheet, n);
            setSheet(null);
          }}
        />
      )}
      {/* 收益详情（全屏浮层） */}
      {earnOpen ? <VaultEarnPage earn={earn} onBack={() => setEarnOpen(false)} /> : null}
    </div>
  );
}

/** 银行卡视觉组件（列表/详情复用：真实银行卡 85.6:54 比例 + 银行品牌渐变 + 圆标 + 金色芯片 + 闪付波纹） */
function BankCardVisual({ card, className = '' }: { card: BankCard; className?: string }) {
  const meta = BANK_META[card.bank] ?? BANK_FALLBACK;
  return (
    <div
      className={`relative overflow-hidden rounded-[16px] shadow-lg shadow-black/15 ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }}
    >
      {/* 高光装饰 */}
      <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <span className="pointer-events-none absolute -right-20 top-10 h-28 w-28 rounded-full bg-white/[0.07]" aria-hidden="true" />
      <div className="relative flex h-full flex-col justify-between p-4">
        {/* 银行圆标 + 名称 + 卡类型 */}
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[15px] font-semibold text-white backdrop-blur-sm" aria-hidden="true">
            {card.bank.slice(0, 1)}
          </span>
          <span className="truncate text-[16px] font-semibold text-white">{card.bank}</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] leading-4 text-white/95">{card.type ?? '储蓄卡'}</span>
        </div>
        {/* 金色芯片 + 闪付波纹 */}
        <div className="mt-2 flex items-center gap-2.5">
          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#F3D47C] to-[#C9962E]" aria-hidden="true">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/15" />
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
          </span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <path d="M7 9a7.5 7.5 0 0 1 0 6" />
            <path d="M11 6.8a11.5 11.5 0 0 1 0 10.4" />
            <path d="M15 4.6a15.5 15.5 0 0 1 0 14.8" />
          </svg>
        </div>
        {/* 卡号 + 持卡人 + 卡内金额 */}
        <div>
          <p className="text-[17px] font-medium tracking-[0.1em] text-white [font-variant-numeric:tabular-nums]">{formatCardNo(card)}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="truncate text-[12px] text-white/85">持卡人 {card.holder}</p>
            {typeof card.balance === 'number' ? <p className="shrink-0 text-[12px] font-medium text-white/95">¥{fmtMoney(card.balance)}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 我的银行卡页（空状态收纳盒 + 添加按钮；有卡时品牌渐变卡列表，点击卡片进详情） */
function BankCardsPage({ cards, onBack, onToast, onAdd, onOpenCard }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onAdd: () => void; onOpenCard: (c: BankCard) => void }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="我的银行卡"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="relative flex-1 overflow-y-auto px-4 pb-4">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-10">
            <span className="grid h-[118px] w-[118px] place-items-center rounded-full border-[3px] border-black/65 dark:border-white/65" aria-hidden="true">
              <Inbox className="h-12 w-12" strokeWidth={1.5} />
            </span>
            <p className="text-[19px] text-[#1F2329] dark:text-white">暂未绑定银行卡</p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {cards.map((c) => (
              <button key={c.id} type="button" data-testid="qq-bank-card-item" onClick={() => onOpenCard(c)} className="block w-full text-left transition-transform active:scale-[0.985]">
                <BankCardVisual card={c} className="aspect-[85.6/54] w-full" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-[30px] pt-2">
        <button type="button" data-testid="qq-wallet-addcard" onClick={onAdd} className="h-12 w-full rounded-full bg-[#1B9FF0] text-[16px] font-medium text-white active:opacity-85">添加银行卡</button>
      </div>
    </div>
  );
}

/** 添加银行卡（持卡人预填 QQ 昵称 + 卡号一键生成[Luhn 校验，BIN 跟随银行] + 自定义卡内金额 + 卡类型；仅存本机 localStorage） */
function AddCardPage({ defaultHolder, onBack, onSave }: { defaultHolder: string; onBack: () => void; onSave: (c: Omit<BankCard, 'id'>) => void }) {
  const [holder, setHolder] = useState(defaultHolder);
  const [no, setNo] = useState('');
  const [amt, setAmt] = useState('');
  const [bank, setBank] = useState('工商银行');
  const [type, setType] = useState('储蓄卡');
  const noDigits = no.replace(/\s/g, '');
  const balance = Math.round((parseFloat(amt) || 0) * 100) / 100;
  const ok = holder.trim().length > 0 && /^\d{15,19}$/.test(noDigits);
  const banks = Object.keys(BANK_META);
  const gen = () => {
    const raw = genCardNo(bank, type);
    setNo(raw.replace(/(\d{4})(?=\d)/g, '$1 '));
  };
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="添加银行卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">持卡人</p>
            <input value={holder} onChange={(e) => setHolder(e.target.value.slice(0, 20))} placeholder="请输入持卡人姓名" aria-label="持卡人姓名" data-testid="qq-card-holder" className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25" />
          </div>
          <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
            <p className="text-[12px] text-black/40 dark:text-white/40">银行卡号</p>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={no}
                inputMode="numeric"
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
                  setNo(digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
                }}
                placeholder="请输入或点击生成"
                aria-label="银行卡号"
                data-testid="qq-card-no"
                className="h-7 min-w-0 flex-1 bg-transparent text-[16px] tracking-wider text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
              <button type="button" data-testid="qq-card-gen" onClick={gen} className="h-8 shrink-0 rounded-full bg-[#E8F6FF] px-3.5 text-[13px] font-medium text-[#1B9FF0] active:opacity-60 dark:bg-[#17324A]">
                生成卡号
              </button>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-[12px] text-black/40 dark:text-white/40">卡内金额（元）</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[16px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
              <input
                value={amt}
                inputMode="decimal"
                onChange={(e) => setAmt(sanitizeAmount(e.target.value))}
                placeholder="0.00"
                aria-label="卡内金额"
                data-testid="qq-card-amt"
                className="h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
              />
            </div>
          </div>
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">卡类型</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {['储蓄卡', '信用卡'].map((t) => (
            <button key={t} type="button" data-testid={`qq-card-type-${t}`} onClick={() => setType(t)} className={`h-9 rounded-full px-4 text-[13px] ${type === t ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {t}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[13px] text-black/40 dark:text-white/40">选择银行</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {banks.map((b) => (
            <button key={b} type="button" onClick={() => setBank(b)} className={`h-9 rounded-full px-3.5 text-[13px] ${bank === b ? 'bg-[#1B9FF0] text-white' : 'bg-white text-[#1F2329] active:opacity-60 dark:bg-[#232529] dark:text-white'}`}>
              {b}
            </button>
          ))}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">卡号由本机随机生成（符合 Luhn 校验），金额自定义；银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-card-save"
          onClick={() => {
            if (!ok) return;
            onSave({ holder: holder.trim(), last4: noDigits.slice(-4), bank, no: noDigits, balance, type, createdAt: Date.now() });
          }}
          className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
    </div>
  );
}

/** 银行卡详情页（点击列表卡片进入：大卡视觉 + 卡内余额 + 持卡人/卡号/银行/类型/时间信息 + 解除绑定） */
function CardDetailPage({ card, onBack, onToast, onUnbind }: { card: BankCard; onBack: () => void; onToast: (m: string) => void; onUnbind: () => void }) {
  // 两步确认解绑：第一次点击变红提示，3 秒内再点确认（避免误触）
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );
  const tapUnbind = () => {
    if (armed) {
      onUnbind();
      return;
    }
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };
  const rows: Array<{ k: string; v: React.ReactNode }> = [
    { k: '卡类型', v: card.type ?? '储蓄卡' },
    { k: '持卡人', v: card.holder },
    { k: '所属银行', v: card.bank },
    { k: '银行卡号', v: <span className="tracking-wider">{formatCardNo(card)}</span> },
  ];
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="银行卡详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <BankCardVisual card={card} className="aspect-[85.6/54] w-full" />
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="border-b border-black/[0.04] px-4 pb-4 pt-5 text-center dark:border-white/[0.06]">
            <p className="text-[13px] text-black/40 dark:text-white/40">卡内余额 (元)</p>
            <div className="mt-1 text-[#1F2329] dark:text-white">
              <MoneyDigits value={card.balance ?? 0} className="text-[36px] font-semibold leading-tight tracking-tight" fracClassName="text-[19px] font-semibold" />
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.k} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-black/[0.04] px-4 py-2.5 last:border-b-0 dark:border-white/[0.06]">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">{r.k}</span>
              <span className="min-w-0 truncate text-right text-[15px] text-[#1F2329] dark:text-white">{r.v}</span>
            </div>
          ))}
          {typeof card.createdAt === 'number' ? (
            <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">添加时间</span>
              <span className="text-right text-[15px] text-[#1F2329] dark:text-white">{fmtTime(card.createdAt)}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="qq-card-unbind"
          onClick={tapUnbind}
          className={`mt-5 h-12 w-full rounded-full text-[16px] font-medium text-white active:opacity-85 ${armed ? 'bg-[#D6453C]' : 'bg-[#FA5151]/85'}`}
        >
          {armed ? '再点一次确认解除绑定' : '解除绑定'}
        </button>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">银行卡信息仅保存在本机浏览器（localStorage），不会上传到任何服务器。</p>
      </div>
    </div>
  );
}

/** 提现页：余额转到银行卡（可选到账卡，扣钱包余额入卡） */
function WithdrawPage({ wallet, cards, onBack, onToast, onSubmit }: { wallet: WalletData; cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onSubmit: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && num <= wallet.balance && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="提现"
        onBack={onBack}
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto mr-1 grid h-9 w-9 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-withdraw-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">到账银行卡</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4}）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-5 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">提现金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.08] pb-4 dark:border-white/10">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="提现金额"
              data-testid="qq-withdraw-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <p className="mt-3.5 text-[14px] text-black/40 dark:text-white/40">
            当前钱包余额{fmtMoney(wallet.balance)}元，
            <button type="button" data-testid="qq-withdraw-all" onClick={() => setVal(wallet.balance.toFixed(2))} className="text-[#1B9FF0]">
              全部提现
            </button>
          </p>
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-withdraw-ok"
          onClick={() => {
            if (!ok || !card) return;
            onSubmit(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择到账银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 银行卡选择底部弹层（充值选付款卡 / 提现选到账卡） */
function CardPickerSheet({ title, cards, selectedId, onClose, onPick }: { title: string; cards: BankCard[]; selectedId: string | null; onClose: () => void; onPick: (c: BankCard) => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label={title} onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {cards.map((c) => {
            const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
            return (
              <button key={c.id} type="button" data-testid={`qq-card-pick-${c.last4}`} onClick={() => onPick(c)} className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
                  {c.bank.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{c.bank} {c.type ?? '储蓄卡'}</span>
                  <span className="block text-[12px] text-black/40 dark:text-white/40">尾号{c.last4} · 余额 {fmtMoney(c.balance ?? 0)} 元</span>
                </span>
                {selectedId === c.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 充值页：从银行卡转入余额（可选付款卡，扣卡内金额入钱包余额） */
function TopUpPage({ cards, onBack, onToast, onCharge }: { cards: BankCard[]; onBack: () => void; onToast: (m: string) => void; onCharge: (cardId: string, n: number) => void }) {
  const [val, setVal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cardId, setCardId] = useState<string | null>(cards[0]?.id ?? null);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const num = Math.round((parseFloat(val) || 0) * 100) / 100;
  const ok = num > 0 && card !== null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="充值" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <button
          type="button"
          data-testid="qq-topup-card"
          className="flex w-full items-center px-1 py-2.5 text-[#1F2329] active:opacity-60 dark:text-white"
          onClick={() => (cards.length > 0 ? setPickerOpen(true) : onToast('请先在银行卡页添加银行卡'))}
        >
          <span className="text-[16px]">充值方式</span>
          {card ? (
            <span className="ml-9 flex items-center gap-2 text-[16px] font-semibold">
              {card.bank}
              <span className="text-[14px] font-normal text-black/40 dark:text-white/40">（尾号{card.last4} · {fmtMoney(card.balance ?? 0)}元）</span>
            </span>
          ) : (
            <span className="ml-9 text-[16px] font-semibold">请先添加银行卡</span>
          )}
          <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-black/30 dark:text-white/30" aria-hidden="true" />
        </button>
        <div className="mt-1.5 rounded-[14px] bg-white px-5 pb-6 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">充值金额</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[30px] font-medium text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder=""
              aria-label="充值金额"
              data-testid="qq-topup-amount"
              className="w-full bg-transparent text-[30px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          {card ? <p className="mt-2 text-[13px] text-black/35 dark:text-white/35">从 {card.bank} 尾号{card.last4} 转入，卡内余额 {fmtMoney(card.balance ?? 0)} 元</p> : null}
        </div>
      </div>
      <div className="px-4 pb-[30px] pt-3">
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-topup-ok"
          onClick={() => {
            if (!ok || !card) return;
            if (num > (card.balance ?? 0)) {
              onToast('卡内余额不足');
              return;
            }
            onCharge(card.id, num);
          }}
          className={`mx-auto block h-12 w-[220px] rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
        >
          确定
        </button>
      </div>
      {pickerOpen ? (
        <CardPickerSheet
          title="选择付款银行卡"
          cards={cards}
          selectedId={cardId}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setCardId(c.id);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 账单类型筛选（「选择账单类型」弹层 chips；消费/群收款/理财/代付/自动代付本机无数据源，选中即空） */
const QQ_BILL_TYPES = ['全部', '红包', '转账', '消费', '充值', '提现', '群收款', '退款', '理财', '代付', '自动代付'] as const;
type QQBillType = (typeof QQ_BILL_TYPES)[number];

/** 账单条目左侧圆形图标：红包=红色红包封；转账=对方头像（缺省蓝色箭头）；退款=绿色；充值/提现/小金库=各色 */
function QQBillEntryIcon({ b }: { b: WalletBill }) {
  const kind = b.kind ?? (b.title.includes('红包') ? 'redpacket' : b.title.includes('转账') ? 'transfer' : b.title.includes('提现') ? 'withdraw' : b.title.includes('充值') || b.title.includes('Q币') ? 'topup' : b.title.includes('小金库') ? 'vault' : undefined);
  if (kind === 'redpacket') {
    return (
      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[#F25543]" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-[24px] w-[24px]">
          <rect x="4.5" y="3" width="15" height="18" rx="2.4" fill="#fff" />
          <path d="M4.5 7.2c4.4 3.6 10.6 3.6 15 0" stroke="#F25543" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle cx="12" cy="11.6" r="1.8" fill="#F25543" />
        </svg>
      </span>
    );
  }
  if (kind === 'transfer' && b.avatar) {
    return b.avatar ? (
      <img src={b.avatar} alt="对方头像" className="h-[46px] w-[46px] shrink-0 rounded-full bg-black/[0.06] object-cover dark:bg-white/[0.08]" />
    ) : null;
  }
  const tone: Record<string, string> = { transfer: '#4D9CF8', topup: '#F7B500', withdraw: '#4D9CF8', vault: '#F7B500', refund: '#2FBF71' };
  const color = kind ? tone[kind] ?? '#8E8E93' : '#8E8E93';
  return (
    <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22`, color }} aria-hidden="true">
      {kind === 'topup' || kind === 'vault' ? <QbGlyph /> : kind === 'refund' ? <Undo2 className="h-[20px] w-[20px]" strokeWidth={2} /> : <ArrowLeftRight className="h-[20px] w-[20px]" strokeWidth={2} />}
    </span>
  );
}

/** Q币小图标（黄色圆底白色 Q 币袋） */
function QbGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" aria-hidden="true">
      <path d="M7 4h10l2.2 4.4a7.6 7.6 0 1 1-14.4 0L7 4z" fill="#fff" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="9" fontWeight="700" fill="#F7B500">
        Q
      </text>
    </svg>
  );
}

/** 账单明细页（余额页「账单」入口；对齐真机：月份/类型过滤栏 + 下载 + 按月分组列表 + 选择账单类型弹层） */
function BillsPage({ bills, onBack, onToast }: { bills: WalletBill[]; onBack: () => void; onToast: (m: string) => void }) {
  const fmtTime = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  /** 类型过滤（点过滤栏「全部 ▾」弹出选择账单类型） */
  const [billType, setBillType] = useState<QQBillType>('全部');
  const [typeSheet, setTypeSheet] = useState(false);
  /** 月份过滤（'all'=全部；默认全部，下拉可切换，文案对齐真机显示最新月份） */
  const monthKeys = Array.from(new Set(bills.map((b) => `${new Date(b.ts).getFullYear()}-${new Date(b.ts).getMonth()}`))).sort((a, b) => b.localeCompare(a));
  const [month, setMonth] = useState<string>('all');
  const [monthSheet, setMonthSheet] = useState(false);

  const typeFilter = (b: WalletBill): boolean => {
    switch (billType) {
      case '全部':
        return true;
      case '红包':
        return b.kind === 'redpacket' || (!b.kind && b.title.includes('红包'));
      case '转账':
        return b.kind === 'transfer' || (!b.kind && b.title.includes('转账'));
      case '退款':
        return b.refund !== undefined || b.kind === 'refund' || (!b.kind && b.title.includes('退回'));
      case '充值':
        return b.kind === 'topup' || (!b.kind && (b.title.includes('充值') || b.title.includes('Q币')));
      case '提现':
        return b.kind === 'withdraw' || (!b.kind && b.title.includes('提现'));
      default:
        return false; // 消费/群收款/理财/代付/自动代付：本机无此数据源
    }
  };
  const monthFilter = (b: WalletBill): boolean => month === 'all' || `${new Date(b.ts).getFullYear()}-${new Date(b.ts).getMonth()}` === month;

  const shown = bills.filter((b) => typeFilter(b) && monthFilter(b));
  /** 按月分组（倒序：组头「9月 2026年」） */
  const groups = (() => {
    const map = new Map<string, WalletBill[]>();
    for (const b of shown) {
      const d = new Date(b.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  /** 过滤栏年月文案（对齐真机截图：「2026年9月」带年份；全部=最新有账单月份） */
  const monthCaret =
    month === 'all'
      ? monthKeys.length > 0
        ? `${monthKeys[0].split('-')[0]}年${Number(monthKeys[0].split('-')[1]) + 1}月`
        : '全部'
      : `${month.split('-')[0]}年${Number(month.split('-')[1]) + 1}月`;
  const monthOptions = ['全部', ...monthKeys.map((k) => `${k.split('-')[0]}年${Number(k.split('-')[1]) + 1}月`)];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader
        title="账单明细"
        onBack={onBack}
        right={
          <button
            type="button"
            data-testid="qq-bills-qb-detail"
            onClick={() => onToast('Q币明细暂未开放')}
            className="absolute right-3 text-[15.5px] text-[#1F2329] active:opacity-50 dark:text-white"
          >
            Q币明细
          </button>
        }
      />
      {/* 过滤栏：年月 ▾ + 类型 ▾ + 下载 */}
      <div className="flex h-[54px] shrink-0 items-center gap-6 bg-[#EFEFF4] px-4 dark:bg-[#1D1E22]">
        <button type="button" data-testid="qq-bills-month" onClick={() => setMonthSheet(true)} className="flex items-center gap-1.5 text-[16px] text-black/55 dark:text-white/60">
          {monthCaret}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" data-testid="qq-bills-type" onClick={() => setTypeSheet(true)} className="flex items-center gap-1.5 text-[16px] text-black/55 dark:text-white/60">
          {billType}
          <svg viewBox="0 0 12 8" className="h-2 w-3" aria-hidden="true">
            <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="flex-1" />
        <button type="button" data-testid="qq-bills-download" onClick={() => onToast('账单已保存')} className="flex items-center gap-1 text-[16px] text-black/55 dark:text-white/60">
          下载
          <Download className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-black/35 dark:text-white/35">
            <ClipboardList className="h-12 w-12" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-[15px]">暂无账单</p>
          </div>
        ) : (
          groups.map(([key, list]) => {
            const [y, m] = key.split('-');
            return (
              <div key={key}>
                {/* 月分隔带 + 组头 */}
                <div className="h-[10px] bg-[#EFEFF4] dark:bg-[#1D1E22]" aria-hidden="true" />
                <div className="flex items-baseline gap-2 bg-white px-4 pb-1 pt-4 dark:bg-[#232529]">
                  <span className="text-[26px] font-semibold leading-none text-[#1F2329] dark:text-white">{Number(m) + 1}月</span>
                  <span className="text-[14px] text-black/40 dark:text-white/45">{y}年</span>
                </div>
                <div className="bg-white dark:bg-[#232529]">
                  {list.map((b, i) => (
                    <div
                      key={b.id}
                      data-testid="qq-bill-item"
                      className={`relative ml-[74px] flex items-center gap-3 py-[13px] pr-4 ${i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''}`}
                    >
                      {/* 左侧圆形图标（头像/红包/Q币），绝对定位在缩进区（与真机一致：分隔线不穿过图标） */}
                      <span className="absolute -left-[74px] top-1/2 flex h-[46px] w-[74px] -translate-y-1/2 items-center justify-center pl-4" aria-hidden="true">
                        <QQBillEntryIcon b={b} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16.5px] text-[#1F2329] dark:text-white">{b.title}</p>
                        <p className="mt-1 text-[13.5px] text-black/35 dark:text-white/40">{fmtTime(b.ts)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-[16.5px] font-semibold ${b.amount >= 0 ? 'text-[#2FBF71]' : 'text-[#1F2329] dark:text-white'}`}>
                          {b.amount >= 0 ? '+' : '-'}
                          {fmtMoney(Math.abs(b.amount))}元
                        </p>
                        {b.refund !== undefined && <p className="mt-0.5 text-[12.5px] leading-none text-[#F5544D]">已退款{fmtMoney(b.refund)}元</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 选择账单类型底部弹层 */}
      {typeSheet && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择账单类型" onClick={() => setTypeSheet(false)}>
          <div className="rounded-t-[16px] bg-white px-4 pb-8 pt-4 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()} data-testid="qq-bills-type-sheet">
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setTypeSheet(false)}
                className="absolute left-1 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.08]"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
              <p className="text-[18px] font-medium">选择账单类型</p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {QQ_BILL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`qq-bills-type-${t}`}
                  onClick={() => {
                    setBillType(t);
                    setTypeSheet(false);
                  }}
                  className={`grid h-[54px] place-items-center rounded-[14px] border text-[16px] ${
                    billType === t ? 'border-[#1B9FF0] bg-[#1B9FF0] text-white' : 'border-black/[0.08] bg-white text-[#1F2329] dark:border-white/[0.1] dark:bg-[#2A2C31] dark:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 月份选择底部弹层 */}
      {monthSheet && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择月份" onClick={() => setMonthSheet(false)}>
          <div className="max-h-[55%] overflow-y-auto rounded-t-[16px] bg-white px-3 pb-8 pt-4 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-2 text-center text-[17px] font-medium">选择月份</p>
            {monthOptions.map((label) => {
              const key = label === '全部' ? 'all' : (monthKeys.find((k) => `${k.split('-')[0]}年${Number(k.split('-')[1]) + 1}月` === label) ?? 'all');
              const selected = (month === 'all' && label === '全部') || month === key;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setMonth(key);
                    setMonthSheet(false);
                  }}
                  className={`flex h-12 w-full items-center justify-between rounded-[8px] px-4 text-[16px] active:bg-black/[0.05] ${selected ? 'text-[#1B9FF0]' : 'text-[#1F2329] dark:text-white'}`}
                >
                  {label}
                  {selected && <Check className="h-5 w-5" strokeWidth={2.2} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 钱包容器（内部子路由；数据 localStorage 持久化，入口：个人中心抽屉「钱包」；开启支付密码后资金操作先验证） */
function WalletPage({ me, onBack, onToast }: { me: QQUser; onBack: () => void; onToast: (m: string) => void }) {
  const [wallet, setWallet] = useState<WalletData>(() => loadWallet());
  const [cards, setCards] = useState<BankCard[]>(() => loadBankCards());
  const [bills, setBills] = useState<WalletBill[]>(() => loadWalletBills());
  const [route, setRoute] = useState<'home' | 'balance' | 'vault' | 'cards' | 'addcard' | 'carddetail' | 'withdraw' | 'topup' | 'bills' | 'paysettings'>('home');
  const [payFrom, setPayFrom] = useState<'home' | 'balance'>('balance');
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  // 支付密码验证浮层（开启后充值/提现/小金库转入转出先验证再执行）
  const [pendingPay, setPendingPay] = useState<null | { label: string; fn: () => void }>(null);
  const requirePay = useCallback((label: string, fn: () => void) => {
    const pp = loadPayPwd();
    if (pp.enabled && pp.pwd) setPendingPay({ label, fn });
    else fn();
  }, []);
  const openPaySettings = useCallback((from: 'home' | 'balance') => {
    setPayFrom(from);
    setRoute('paysettings');
  }, []);

  const patchWallet = useCallback((patch: Partial<WalletData>) => {
    setWallet((prev) => {
      const next = { ...prev, ...patch };
      saveWallet(next);
      return next;
    });
  }, []);

  const appendBill = useCallback((title: string, amount: number) => {
    setBills((prev) => {
      const next = [{ id: uid(), title, amount, ts: Date.now() }, ...prev].slice(0, 100);
      saveWalletBills(next);
      return next;
    });
  }, []);

  const moveVault = useCallback(
    (mode: 'in' | 'out', n: number) => {
      setWallet((prev) => {
        const next =
          mode === 'in'
            ? { ...prev, balance: round2(prev.balance - n), vault: round2(prev.vault + n) }
            : { ...prev, balance: round2(prev.balance + n), vault: round2(prev.vault - n) };
        saveWallet(next);
        return next;
      });
      appendBill(mode === 'in' ? '转入小金库' : '小金库转出', mode === 'in' ? -n : n);
      onToast(mode === 'in' ? `已转入小金库 ${fmtMoney(n)} 元` : `已从金库转出 ${fmtMoney(n)} 元`);
    },
    [appendBill, onToast]
  );

  let page: React.ReactNode;
  switch (route) {
    case 'balance':
      page = (
        <BalancePage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onOpenTopUp={() => setRoute('topup')}
          onOpenWithdraw={() => setRoute('withdraw')}
          onOpenCards={() => setRoute('cards')}
          onOpenBills={() => setRoute('bills')}
          onOpenPaySettings={() => openPaySettings('balance')}
        />
      );
      break;
    case 'vault':
      page = (
        <VaultPage
          wallet={wallet}
          onBack={() => setRoute('home')}
          onToast={onToast}
          onMove={(mode, n) => requirePay(`${mode === 'in' ? '转入' : '转出'}小金库 ${fmtMoney(n)} 元`, () => moveVault(mode, n))}
        />
      );
      break;
    case 'cards':
      page = <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />;
      break;
    case 'carddetail': {
      const detailCard = cards.find((c) => c.id === detailCardId);
      page = detailCard ? (
        <CardDetailPage
          card={detailCard}
          onBack={() => setRoute('cards')}
          onToast={onToast}
          onUnbind={() => {
            setCards((prev) => {
              const next = prev.filter((c) => c.id !== detailCardId);
              saveBankCards(next);
              return next;
            });
            onToast('已解除绑定');
            setRoute('cards');
          }}
        />
      ) : (
        <BankCardsPage cards={cards} onBack={() => setRoute('balance')} onToast={onToast} onAdd={() => setRoute('addcard')} onOpenCard={(c) => { setDetailCardId(c.id); setRoute('carddetail'); }} />
      );
      break;
    }
    case 'addcard':
      page = (
        <AddCardPage
          defaultHolder={me.name || '持卡人'}
          onBack={() => setRoute('cards')}
          onSave={(c) => {
            setCards((prev) => {
              const next = [{ ...c, id: uid() }, ...prev];
              saveBankCards(next);
              return next;
            });
            onToast('银行卡添加成功');
            setRoute('cards');
          }}
        />
      );
      break;
    case 'withdraw':
      page = (
        <WithdrawPage
          wallet={wallet}
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onSubmit={(cardId, n) =>
            requirePay(`提现 ${fmtMoney(n)} 元 · 到账${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) + n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance - n) });
              appendBill('提现', -n);
              onToast(`已提现 ${fmtMoney(n)} 元到银行卡`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'topup':
      page = (
        <TopUpPage
          cards={cards}
          onBack={() => setRoute('balance')}
          onToast={onToast}
          onCharge={(cardId, n) =>
            requirePay(`充值 ${fmtMoney(n)} 元 · 从${cards.find((c) => c.id === cardId)?.bank ?? '银行卡'}`, () => {
              setCards((prev) => {
                const next = prev.map((c) => (c.id === cardId ? { ...c, balance: round2((c.balance ?? 0) - n) } : c));
                saveBankCards(next);
                return next;
              });
              patchWallet({ balance: round2(wallet.balance + n) });
              appendBill('充值', n);
              onToast(`充值成功 ${fmtMoney(n)} 元`);
              setRoute('balance');
            })
          }
        />
      );
      break;
    case 'bills':
      page = <BillsPage bills={bills} onBack={() => setRoute('balance')} onToast={onToast} />;
      break;
    case 'paysettings':
      page = <PaySettingsPage onBack={() => setRoute(payFrom)} onToast={onToast} />;
      break;
    case 'home':
    default:
      page = <WalletHomePage wallet={wallet} onBack={onBack} onToast={onToast} onOpenBalance={() => setRoute('balance')} onOpenVault={() => setRoute('vault')} onOpenPaySettings={() => openPaySettings('home')} />;
  }

  return (
    <>
      {page}
      {pendingPay ? (
        <PayPwdGate
          label={pendingPay.label}
          onOk={() => {
            const fn = pendingPay.fn;
            setPendingPay(null);
            fn();
          }}
          onClose={() => setPendingPay(null)}
        />
      ) : null}
    </>
  );
}

// ---------------- 收藏页（个人抽屉「收藏」入口；数据在 @/lib/msg-favorites） ----------------

function QqFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('qq'));

  const del = (id: string) => {
    removeFavorite('qq', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F5F6F7] text-[#1F2329] dark:bg-[#111214] dark:text-white">
      {/* 顶栏（QQ 风格返回 + 标题） */}
      <div className="shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        <div className="flex h-12 items-center gap-1 px-3">
          <button type="button" aria-label="返回" data-testid="qq-fav-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="ml-1 flex flex-1 items-center">
            <span className="text-[17px] font-semibold leading-tight">我的收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="qq-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="qq-fav-item" className="rounded-[12px] bg-white p-3 dark:bg-[#1E1F23]">
                <div className="flex items-center gap-2">
                  <QqAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/55 dark:text-white/55">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="qq-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[8px] bg-[#F6F7F8] px-2.5 py-2 dark:bg-white/[0.06]">
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

// ---------------- 主界面（三 tab + 路由） ----------------

type MainRoute =
  | { page: 'tabs'; tab: '消息' | '联系人' | '动态' }
  | { page: 'profile' }
  | { page: 'search' }
  | { page: 'wallet' }
  | { page: 'chat'; contactId: string }
  | { page: 'bond'; contactId: string }
  | { page: 'friend-profile'; contactId: string }
  | { page: 'addfriend' }
  | { page: 'newfriends' }
  | { page: 'apply-friend'; contactId: string }
  | { page: 'friend-req'; reqId: string }
  | { page: 'friend-req-profile'; contactId: string }
  | { page: 'zone'; /** mine = 只看自己发的动态（个人资料页 QQ空间进入） */ scope?: 'mine'; /** 从哪进入（决定返回键去向） */ from?: 'profile' }
  | { page: 'zone-peer'; contactId: string }
  | { page: 'zone-compose'; /** 与 zone 同源（写说说返回时保留「我的空间」语境） */ scope?: 'mine'; from?: 'profile' }
  | { page: 'zone-notices' }
  | { page: 'momentsSettings' }
  | { page: 'dress' }
  | { page: 'settings' }
  | { page: 'security' }
  | { page: 'stickers' }
  | { page: 'favorites' }
  | { page: 'group-create' }
  | { page: 'group-chat'; groupId: string }
  | { page: 'group-info'; groupId: string }
  | { page: 'album'; albumContactId: string; albumTitle: string }
  | { page: 'vision-log'; logContactId: string; logTitle: string };

function MainScreen({
  me,
  contacts,
  onLogout,
  onPatchUser,
  refreshContacts,
  onLoginAccount,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onLogout: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  refreshContacts: () => Promise<ContactRecord[]>;
  /** 账号与安全页「登录小号」自由登录成功 → 根组件 handleLogin（Task 41） */
  onLoginAccount: (u: QQUser) => void;
}) {
  const [route, setRoute] = useState<MainRoute>({ page: 'tabs', tab: '消息' });
  /** Task 28-b 资料页通话桥：好友资料页「音视频通话」ActionSheet 选语音/视频后暂存待拨通话——
   *  宿主关资料页并路由到对应聊天页时下发，ChatPage 挂载后消费拨号（openVoiceCall 全链路） */
  const [pendingCall, setPendingCall] = useState<{ contactId: string; media: 'voice' | 'video' } | null>(null);
  /** 「让好友发一条」开关：lift 到 MainScreen，供「空间动态设置 → 立即发帖」复用 ZonePage 的 AskPostSheet */
  const [askOpen, setAskOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  // 消息页左上头像：退出 QQ 回手机主屏幕（不再打开个人中心抽屉）
  const closeApp = useUI((s) => s.closeApp);
  // 未读总线订阅：底部「消息」tab 角标 + 聊天页返回键角标实时同步
  const unreads = useUnreadMap(qqUnreads);
  // 液态玻璃主题（个性装扮 › 气泡样式 › 界面主题）：tabs 三页玻璃卡 + 底部悬浮胶囊 TabBar +
  // 聊天页铬件（ChatPage 内自算）；默认主题时所有分支回退原类，像素级保持现状
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const liquid = isLiquidTheme(bubbleStyle, 'qq');
  // 古早主题（retro，第五十四轮）：tabs 三页白硬边分组卡 + 银灰拟物 TabBar/导航（ChatPage 铬件自算）
  const retro = isRetroTheme(bubbleStyle, 'qq');

  // 单聊卡片过期清算（QQ App 打开挂载即扫一遍）：AI 发的红包/转账超 24h 未领取/未收款 →
  // 过期退回（卡片置终态 + 「XX的红包/转账已过期退回」提示行；各聊天页挂载时还会再触发，模块层防重入）
  useEffect(() => {
    void expireStaleSingleCards();
  }, []);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // ---------------- 好友通知 / 删除联系人 / 申请添加朋友（与微信共用 friend-state 状态机） ----------------
  /** 好友通知列表（AI 加回申请 + 手动添加记录；friend-state 落盘广播订阅刷新） */
  const [qqReqs, setQqReqs] = useState<FriendReqEntry[]>(() => loadFriendReqs('qq'));
  useEffect(() => subscribeFriendReqs(() => setQqReqs(loadFriendReqs('qq'))), []);
  /** 待确认删除的联系人（弹 FriendDeleteConfirmDialog；after = 确认后关闭的页面栈） */
  const [delTarget, setDelTarget] = useState<{ contact: ContactRecord; after: () => void } | null>(null);

  const openDeleteConfirm = useCallback(
    (c: ContactRecord, after: () => void) => {
      setDelTarget({ contact: c, after });
    },
    []
  );

  /** 确认删除联系人：删除好友关系（记录/记忆/空间/通话保留不可见，AI 稍后可能申请加回） */
  const confirmRemoveFriend = useCallback(async () => {
    if (!delTarget) return;
    const { contact, after } = delTarget;
    setDelTarget(null);
    after();
    await removeFriendByUser('qq', contact.id);
    await refreshContacts();
    setQqReqs(loadFriendReqs('qq'));
    showToast(`已删除「${displayNameOf(contact)}」`);
  }, [delTarget, refreshContacts, showToast]);

  /** 申请添加朋友「发送」：
   *  - 大号：加好友（被删好友重新加回时同路径恢复历史数据可见）+ 写「好友通知」（status=accepted）
   *    + AI 在线程里回一句欢迎（一次性）——「发送即通过」，保持既有体验；
   *  - 小号：AI 决策模式（2025）——不置好友标记（联系人界面不出现该联系人）、条目 status=pending，
   *    由 AI 按人设+大号关系+记忆+验证消息决定同意/拒绝/先回复；用户可在验证消息线程里继续回复，
   *    每条回复再次触发 AI 决策（按人设随时可以同意）。返回新建条目供导航。 */
  const handleApplySent = useCallback(
    async (target: ContactRecord, payload: { greeting: string; extras: FriendReqExtras }): Promise<FriendReqEntry | null> => {
      const altFlow = !!me.altOf && (target.persona ?? '').trim().length > 0; // 无人设角色无法决策：保持直接通过
      try {
        if (payload.extras.remark) await updateContact(target.id, { remarks: { qq: payload.extras.remark } });
        if (altFlow) {
          // 小号：不置好友标记；清删除状态（重新加回场景，防止 catch-up 再发一条 AI 申请打架）
          clearFriendDelState('qq', target.id);
        } else {
          await restoreFriendship('qq', target.id); // 未删过 = friendQq=true；删过 = 清删除状态并恢复好友
        }
      } catch {
        showToast('添加失败，请重试');
        return null;
      }
      const entry: FriendReqEntry = {
        id: genId(),
        contactId: target.id,
        name: displayNameOf(target),
        avatar: target.avatar,
        message: payload.greeting,
        time: Date.now(),
        status: altFlow ? 'pending' : 'accepted',
        source: SOURCE_SEARCH_QQ,
        fromChar: false,
        extras: payload.extras,
        thread: [{ who: 'me', text: payload.greeting, time: Date.now() }],
      };
      addFriendReq('qq', entry);
      // 加好友过程落聊天记录：我的验证消息（fr=apply）永久保留，重启不丢；
      // 小号模式下不加「已成功添加」提示（AI 同意后由 processAltFriendReq 补写）
      try {
        const now = Date.now();
        const msgs = [
          ...loadMsgs(target.id),
          { id: genId(), role: 'me' as const, content: payload.greeting, time: now, kind: 'text' as const, fr: 'apply' as const },
        ];
        if (!altFlow) {
          msgs.push({
            id: genId(),
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
      setQqReqs(loadFriendReqs('qq'));
      await refreshContacts();
      showToast(altFlow ? '验证消息已发送，等待对方处理' : '已发送添加申请');
      if (altFlow) {
        // AI 决策（fire-and-forget）：同意/拒绝/先回复；落盘后经 FRIEND_REQS_EVENT / FRIEND_STATE_APPLIED_EVENT 刷新
        void processAltFriendReq('qq', entry.id, target.id).catch(() => {});
      } else {
        // AI 欢迎回复（一次性；fire-and-forget，生成完成经 FRIEND_REQS_EVENT 刷新）
        void charWelcomeReplyToApply('qq', entry.id, target.id, payload.greeting).catch(() => {});
      }
      return loadFriendReqs('qq').find((x) => x.id === entry.id) ?? entry;
    },
    [refreshContacts, showToast, me.altOf]
  );

  /** 同意好友申请（AI 加回申请）：恢复好友关系 + 状态流转 + 刷新 */
  const acceptFriendReqAction = useCallback(
    async (r: FriendReqEntry) => {
      const cid = r.contactId ?? r.id;
      await restoreFriendship('qq', cid);
      setFriendReqStatus('qq', r.id, 'accepted');
      // 加好友成功提示落聊天记录（AI 加回申请场景：居中灰字「你已添加了…」，此前 AI 的验证消息保留）
      try {
        saveMsgs(cid, [
          ...loadMsgs(cid),
          {
            id: genId(),
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
      setQqReqs(loadFriendReqs('qq'));
      await refreshContacts();
      showToast(`已添加「${r.name}」`);
    },
    [refreshContacts, showToast]
  );

  /** 拒绝好友申请：AI 彻底停止申请（重新加回好友后重置） */
  const rejectFriendReqAction = useCallback(
    (r: FriendReqEntry) => {
      rejectFriendReq('qq', r.id);
      setQqReqs(loadFriendReqs('qq'));
      showToast(`已拒绝「${r.name}」的申请`);
    },
    [showToast]
  );

  /** 好友申请详情「设为黑名单」：写双向拉黑 byUser（拦截对方消息，走既有拉黑链路；资料预览模式传联系人） */
  const blockFriendReqAction = useCallback(
    (r: FriendReqEntry | ContactRecord) => {
      const isReq = (x: FriendReqEntry | ContactRecord): x is FriendReqEntry => 'status' in x || 'time' in x;
      const cid = isReq(r) ? r.contactId ?? r.id : r.id;
      const name = isReq(r) ? r.name : displayNameOf(r);
      setUserBlock('qq', cid, true);
      showToast(`已将「${name}」设为黑名单`);
    },
    [showToast]
  );

  const ownerNameOf = useCallback(
    (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return contacts.find((x) => x.id === c.ownerId)?.name ?? null;
    },
    [contacts]
  );

  const openTabs = useCallback((tab: '消息' | '联系人' | '动态') => setRoute({ page: 'tabs', tab }), []);
  const openChatOf = useCallback((c: ContactRecord) => setRoute({ page: 'chat', contactId: c.id }), []);
  const openGroupOf = useCallback((g: ChatGroup) => setRoute({ page: 'group-chat', groupId: g.id }), []);

  // 灵动岛通知点击跳转：打开通知对应的单聊/群聊（QQ 已打开时由事件驱动，未打开时挂载后自动消费 pending）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('qq');
      if (!t) return;
      if (t.groupId) {
        const g = getGroup(t.groupId);
        if (g) setRoute({ page: 'group-chat', groupId: g.id });
      } else if (t.contactId) {
        setRoute({ page: 'chat', contactId: t.contactId });
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, []);
  /** 群数据版本：updateGroupRecord 落盘后 bump，让当前打开的群页拿到最新群对象 */
  const [groupVersion, setGroupVersion] = useState(0);
  const patchGroup = useCallback(
    (groupId: string, patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => {
      updateGroupRecord(groupId, patch);
      setGroupVersion((v) => v + 1);
    },
    []
  );
  /** 当前打开的群（从存储现场读取；groupVersion 变化后重算） */
  const groupPeer = useMemo(
    () => (route.page === 'group-chat' || route.page === 'group-info' ? getGroup(route.groupId) : null),
    [route, groupVersion]
  );
  // 群路由但群已不在（被 AI 移出群聊 / 群已解散）：渲染期按消息 tab 兜底，避免空页面
  const staleGroupRoute = !groupPeer && (route.page === 'group-chat' || route.page === 'group-info');
  /** 当前打开的「TA的QQ空间」联系人（zone-peer 路由；联系人被删时回 tab 兜底） */
  const zonePeer = route.page === 'zone-peer' ? contacts.find((c) => c.id === route.contactId) ?? null : null;
  const staleZonePeer = route.page === 'zone-peer' && !zonePeer;
  /** zone 路由的 scope/from（供 zone ↔ zone-compose 往返保留「我的空间」语境） */
  const zoneScope = route.page === 'zone' ? route.scope : route.page === 'zone-compose' ? route.scope : undefined;
  const zoneFrom = route.page === 'zone' ? route.from : route.page === 'zone-compose' ? route.from : undefined;
  const activeTab: '消息' | '联系人' | '动态' = route.page === 'tabs' ? route.tab : '消息';
  // 写说说发表：统一走动态引擎（入库含位置 + 记忆 + 排 AI 互动队列），回空间动态流（ZonePage 订阅 moments-changed 自动刷新）
  const handlePublishZonePost = useCallback(
    (text: string, images: string[], location?: string) => {
      const post = addUserMomentPost('qq', { userName: me.name, avatar: me.avatar, content: text, images, location });
      enqueuePostInteractions('qq', post.id);
    },
    [me.avatar, me.name]
  );

  // ---------------- 互动消息（空间消息：赞和推/评论和@/转发/官方） ----------------
  const [qqNotices, setQqNotices] = useState<MomentNotice[]>(() => listMomentNotices('qq'));
  const refreshQqNotices = useCallback(() => setQqNotices(listMomentNotices('qq')), []);
  /** 互动消息头像实时读取（actorAvatar 快照 → 联系人在就显示当前头像；换头像立即同步）；
   *  被删好友（qq 端 friend-del 状态）的互动同口径隐藏（数据保留，加回后恢复） */
  const qqNoticesLive = useMemo(
    () =>
      qqNotices
        .filter((n) => {
          const hit = contactByRef({ peerId: n.actorPeerId, name: n.actorName }, contacts);
          return !(hit && hit.kind !== 'user' && isFriendDeleted('qq', hit.id));
        })
        .map((n) => ({
          ...n,
          actorAvatar: liveAvatarOf(n.actorAvatar, { peerId: n.actorPeerId, name: n.actorName }, contacts, 'qq'),
        })),
    [qqNotices, contacts]
  );
  /** 气泡角标：未读条数 + 最新一条消息人的头像（「1条新消息」气泡展示用） */
  const qqNoticeBadge = useMemo(
    () => ({
      count: qqNoticesLive.filter((n) => !n.read).length,
      avatar: qqNoticesLive.find((n) => !n.read)?.actorAvatar ?? null,
    }),
    [qqNoticesLive]
  );
  // 引擎（调度器/AI）在别处写入互动消息后同步本地视图：AI 回复/点赞落盘会广播 moments-changed，
  // 这里刷新 qqNotices → 未读数实时更新 →「N条新消息」气泡实时出现（与微信朋友圈订阅对称；
  // 修复：旧版只在本组件挂载/打开消息页时读一次，用户停留在 QQ 里 AI 互动了气泡也不出现）
  useEffect(
    () =>
      subscribeMomentsChanged((platform) => {
        if (platform && platform !== 'qq') return;
        refreshQqNotices();
      }),
    [refreshQqNotices]
  );
  /** 打开空间消息页：全部标记已读（气泡随之消失）+ 刷新列表 */
  const openQqNotices = useCallback(() => {
    markAllMomentNoticesRead('qq');
    refreshQqNotices();
    setRoute({ page: 'zone-notices' });
  }, [refreshQqNotices]);
  /** 从空间消息页回复一条评论/回复（走引擎：AI 会自动再回复，新回复会进收件箱） */
  const replyToQqNotice = useCallback(
    (n: MomentNotice, text: string) => {
      if (!n.postId) {
        showToast('原动态已删除，无法回复');
        return;
      }
      const added = addUserMomentComment('qq', n.postId, {
        userName: me.name,
        content: text,
        replyTo: n.commentId ? { commentId: n.commentId, name: n.actorName } : undefined,
      });
      if (!added) {
        showToast('原动态已删除，无法回复');
        return;
      }
      refreshQqNotices();
      showToast('已回复');
    },
    [me.name, refreshQqNotices, showToast]
  );

  const chatPeer =
    route.page === 'chat' || route.page === 'bond' || route.page === 'friend-profile'
      ? (contacts.find((c) => c.id === route.contactId) ?? null)
      : null;
  const meContact = contacts.find((c) => c.id === me.id) ?? null;

  /** 当前打开的聊天对象 id（仅在聊天页时有值） */
  const currentChatId = route.page === 'chat' ? route.contactId : null;
  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!currentChatId) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== currentChatId && n > 0) sum += n;
    }
    return sum;
  }, [unreads, currentChatId]);
  /** 底部「消息」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  const TAB_DEFS: { id: '消息' | '联系人' | '动态'; label: string; icon: React.ReactNode }[] = [
    { id: '消息', label: '消息', icon: <Bell className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '联系人', label: '联系人', icon: <User className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '动态', label: '动态', icon: <Star className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
  ];

  return (
    /* qq-root：QQ 主界面根锚点（自定义 CSS 示例模板可改页面底色） */
    <div
      className={`qq-root relative flex h-full w-full flex-col ${retro ? 'rt-root' : 'bg-[#FAFAFC] dark:bg-[#16171A]'} text-[#1F2329] dark:text-white`}
      data-liquid-theme={liquid ? 'true' : 'false'}
      data-rt-theme={retro ? 'true' : 'false'}
    >
      {/* 古早主题状态栏银灰条（第五十五轮，用户指定「状态栏后面的背景也变化」）：
          三 tab 主界面顶部 54px 空档铺拟物导航条；子页由各自的页面底接管（scoped CSS），
          聊天页顶栏自带 rt-dark 覆盖本条 */}
      {retro && (route.page === 'tabs' || route.page === 'chat' || route.page === 'group-chat') && (
        <div aria-hidden="true" className="rt-bar pointer-events-none absolute inset-x-0 top-0 z-[5] h-[54px]" />
      )}
      {route.page === 'chat' && chatPeer ? (
        <ChatPage
          key={chatPeer.id}
          me={me}
          peer={chatPeer}
          contacts={contacts}
          ownerName={ownerNameOf(chatPeer)}
          otherUnread={chatOtherUnread}
          onBack={() => openTabs('消息')}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onOpenFriendProfile={() => setRoute({ page: 'friend-profile', contactId: chatPeer.id })}
          onOpenGroup={(gid) => {
            const g = getGroup(gid);
            if (!g) return;
            setRoute({ page: 'group-chat', groupId: g.id });
          }}
          onSaveRemark={async (v) => {
            try {
              // 第四十八轮：备注按 App 隔离——QQ 里的备注只写 qq 槽位，微信/信息不受影响
              await updateContact(chatPeer.id, { remarks: { qq: v || null } });
              await refreshContacts();
              showToast(v ? '备注已保存' : '备注已清除');
            } catch {
              showToast('备注保存失败');
            }
          }}
          onSaveVoiceId={async (vid) => {
            try {
              await updateContact(chatPeer.id, { voiceId: vid || null });
              await refreshContacts();
              showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
            } catch {
              showToast('声音保存失败');
            }
          }}
          refreshContacts={refreshContacts}
          onToast={showToast}
          onDeleteContact={
            chatPeer.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(chatPeer, () => {
                    // 删除后聊天页关闭回列表（会话随好友关系消失）；历史记录保留不可见
                    openTabs('消息');
                  })
          }
          // Task 28-b 资料页通话桥：资料页发起的语音/视频通话经此下发到聊天页拨号
          pendingCall={pendingCall}
          onConsumePendingCall={() => setPendingCall(null)}
        />
      ) : route.page === 'bond' && chatPeer ? (
        <FriendBondPage
          me={me}
          peer={chatPeer}
          onBack={() => openChatOf(chatPeer)}
          onOpenProfile={() => setRoute({ page: 'profile' })}
          onToast={showToast}
        />
      ) : route.page === 'friend-profile' && chatPeer ? (
        <FriendProfilePage
          me={me}
          peer={chatPeer}
          onBack={() => openTabs('联系人')}
          onOpenChat={() => openChatOf(chatPeer)}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onOpenZone={() => setRoute({ page: 'zone-peer', contactId: chatPeer.id })}
          onCall={(media) => {
            // Task 28-b 资料页「音视频通话」：关资料页 → 路由到该好友聊天页 → pendingCall 下发，
            // ChatPage 挂载后消费拨号（全局通话层盖在聊天页上，视觉为「资料页关闭 → 弹出通话」）
            setPendingCall({ contactId: chatPeer.id, media });
            openChatOf(chatPeer);
          }}
          onToast={showToast}
        />
      ) : route.page === 'search' ? (
        <QqSearchPage
          me={me}
          contacts={contacts}
          groups={listChatGroups('qq')}
          onClose={() => openTabs('消息')}
          onOpenChat={openChatOf}
          onOpenGroup={openGroupOf}
          onAddFriend={() => setRoute({ page: 'addfriend' })}
          onOpenStickers={() => setRoute({ page: 'stickers' })}
          onToast={showToast}
        />
      ) : route.page === 'profile' ? (
        <ProfilePage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenZone={() => setRoute({ page: 'zone', scope: 'mine', from: 'profile' })}
          onOpenSettings={() => setRoute({ page: 'settings' })}
          onOpenChat={meContact ? () => openChatOf(meContact) : () => showToast('找不到当前账号的联系人资料')}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      ) : route.page === 'addfriend' ? (
        <AddFriendPage
          me={me}
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onOpenApply={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
          onOpenReqDetail={(c) => setRoute({ page: 'friend-req-profile', contactId: c.id })}
          onOpenChat={openChatOf}
          onToast={showToast}
        />
      ) : route.page === 'friend-req-profile' ? (
        (() => {
          const target = contacts.find((c) => c.id === route.contactId) ?? null;
          if (!target) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该联系人不存在</p>
              </div>
            );
          }
          return (
            <FriendReqDetailPage
              req={null}
              contact={target}
              onBack={() => setRoute({ page: 'addfriend' })}
              onAccept={(r) => void acceptFriendReqAction(r)}
              onReject={rejectFriendReqAction}
              onBlock={blockFriendReqAction}
              onVerify={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'apply-friend' ? (
        (() => {
          const target = contacts.find((c) => c.id === route.contactId) ?? null;
          if (!target) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该联系人不存在</p>
              </div>
            );
          }
          return (
            <ApplyFriendPage
              me={me}
              target={target}
              onBack={() => setRoute({ page: 'addfriend' })}
              onSend={(payload) => {
                void (async () => {
                  const fresh = await handleApplySent(target, payload);
                  if (fresh) {
                    // 发送后进申请详情（已同意 + 验证消息线程，AI 欢迎回复稍后到达）
                    setRoute({ page: 'friend-req', reqId: fresh.id });
                  } else {
                    setRoute({ page: 'addfriend' });
                  }
                })();
              }}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'friend-req' ? (
        (() => {
          const req = qqReqs.find((r) => r.id === route.reqId) ?? null;
          if (!req) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该申请不存在或已被处理</p>
              </div>
            );
          }
          const reqContact = contacts.find((c) => c.id === (req.contactId ?? req.id)) ?? null;
          return (
            <FriendReqDetailPage
              req={req}
              contact={reqContact}
              onBack={() => setRoute({ page: 'newfriends' })}
              onAccept={(r) => void acceptFriendReqAction(r)}
              onReject={rejectFriendReqAction}
              onBlock={blockFriendReqAction}
              onVerify={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'newfriends' ? (
        <NewFriendsPage
          me={me}
          contacts={contacts}
          reqs={qqReqs}
          onBack={() => openTabs('联系人')}
          onOpenAdd={() => setRoute({ page: 'addfriend' })}
          onOpenChat={openChatOf}
          onOpenApply={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
          onOpenReq={(r) => setRoute({ page: 'friend-req', reqId: r.id })}
          onAccept={(r) => void acceptFriendReqAction(r)}
          onToast={showToast}
        />
      ) : route.page === 'zone' ? (
        <ZonePage
          me={me}
          contacts={contacts}
          mineOnly={route.scope === 'mine'}
          onBack={route.from === 'profile' ? () => setRoute({ page: 'profile' }) : () => openTabs('动态')}
          onCompose={() => setRoute({ page: 'zone-compose', scope: route.scope, from: route.from })}
          onToast={showToast}
          askOpen={askOpen}
          setAskOpen={setAskOpen}
          noticeBadge={qqNoticeBadge}
          onOpenNotices={openQqNotices}
        />
      ) : route.page === 'zone-peer' && zonePeer ? (
        <ZonePage
          key={`zone-peer-${zonePeer.id}`}
          me={me}
          contacts={contacts}
          owner={zonePeer}
          onBack={() => setRoute({ page: 'friend-profile', contactId: zonePeer.id })}
          onCompose={() => setRoute({ page: 'zone-compose' })}
          onToast={showToast}
          askOpen={false}
          setAskOpen={setAskOpen}
          noticeBadge={qqNoticeBadge}
          onOpenNotices={openQqNotices}
        />
      ) : route.page === 'zone-compose' ? (
        <WritePostPage
          me={me}
          onBack={() => setRoute({ page: 'zone', scope: zoneScope, from: zoneFrom })}
          onPublish={handlePublishZonePost}
          onToast={showToast}
        />
      ) : route.page === 'zone-notices' ? (
        <MomentInteractionsPage
          platform="qq"
          title="空间消息"
          notices={qqNoticesLive}
          onBack={() => openTabs('动态')}
          onReply={replyToQqNotice}
          renderAvatar={(src, name, size) => <QqAvatar src={src} alt={name} size={size} />}
        />
      ) : route.page === 'dress' ? (
        // 主题界面（个性装扮：顶部毛玻璃胶囊两个选择——主题 / 气泡）
        <ThemeStylePage app="qq" title="个性装扮" onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'momentsSettings' ? (
        <MomentsSettingsPage
          app="qq"
          onBack={() => openTabs('动态')}
          onToast={showToast}
          onOpenPostNow={() => {
            setAskOpen(true);
            setRoute({ page: 'zone' });
          }}
        />
      ) : route.page === 'wallet' ? (
        <WalletPage me={me} onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'stickers' ? (
        <QqStickersPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'favorites' ? (
        <QqFavoritesPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'settings' ? (
        <SettingsPage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenSecurity={() => setRoute({ page: 'security' })}
          onOpenDress={() => setRoute({ page: 'dress' })}
          onLogout={onLogout}
          onToast={showToast}
        />
      ) : route.page === 'security' ? (
        <SecurityPage me={me} onBack={() => setRoute({ page: 'settings' })} onToast={showToast} onLoginOther={onLoginAccount} />
      ) : route.page === 'group-create' ? (
        <QqGroupCreatePage
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onCreated={(g) => setRoute({ page: 'group-chat', groupId: g.id })}
        />
      ) : route.page === 'group-info' && groupPeer ? (
        <QqGroupInfoPage
          key={`ginfo-${groupPeer.id}`}
          group={groupPeer}
          contacts={contacts}
          onBack={() => setRoute({ page: 'group-chat', groupId: groupPeer.id })}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('联系人');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('联系人');
          }}
          onToast={showToast}
        />
      ) : route.page === 'group-chat' && groupPeer ? (
        <QqGroupChatPage
          key={groupPeer.id}
          group={groupPeer}
          me={{ id: me.id, name: me.name, avatar: me.avatar, realName: me.realName, nickname: me.nickname }}
          contacts={contacts}
          ownerLabelOf={ownerNameOf}
          onBack={() => openTabs('消息')}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onOpenInfo={() => setRoute({ page: 'group-info', groupId: groupPeer.id })}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('消息');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('消息');
          }}
          onToast={showToast}
        />
      ) : route.page === 'album' ? (
        <AlbumPage
          contactId={route.albumContactId}
          title={route.albumTitle}
          onClose={() => openTabs('消息')}
          allowEdit={route.albumContactId === me.id}
          onToast={showToast}
        />
      ) : route.page === 'vision-log' ? (
        <VisionLogPage
          contactId={route.logContactId}
          title={route.logTitle}
          onClose={() => openTabs('消息')}
        />
      ) : route.page === 'tabs' || staleGroupRoute || staleZonePeer ? (
        <>
          <div className="min-h-0 flex-1 overflow-hidden pt-[54px]">
            {activeTab === '消息' && (
              <MessagesPage
                me={me}
                contacts={contacts}
                liquid={liquid}
                retro={retro}
                onOpenChat={openChatOf}
                onOpenGroup={openGroupOf}
                onOpenDrawer={() => setDrawerOpen(true)}
                onAvatar={closeApp}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onCreateGroup={() => setRoute({ page: 'group-create' })}
                onOpenSearch={() => setRoute({ page: 'search' })}
                onToast={showToast}
              />
            )}
            {activeTab === '联系人' && (
              <ContactsPage
                me={me}
                contacts={contacts}
                liquid={liquid}
                retro={retro}
                onOpenProfile={(c) => setRoute({ page: 'friend-profile', contactId: c.id })}
                onOpenMeProfile={() => setRoute({ page: 'profile' })}
                onAvatar={() => setDrawerOpen(true)}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onOpenNewFriends={() => setRoute({ page: 'newfriends' })}
                onOpenGroup={openGroupOf}
                onToast={showToast}
              />
            )}
            {activeTab === '动态' && (
              <DiscoverPage
                me={me}
                liquid={liquid}
                retro={retro}
                onAvatar={() => setDrawerOpen(true)}
                onZone={() => setRoute({ page: 'zone' })}
                onOpenMomentsSettings={() => setRoute({ page: 'momentsSettings' })}
                zoneBadge={qqNoticeBadge.count}
                onToast={showToast}
              />
            )}
          </div>

          {/* 底部 tab：默认主题 = 白底细线同现状（pb 预留底部横杠安全区，同微信 TabBar；用户第九轮：上下收紧变小一档）；
              液态玻璃主题 = 悬浮胶囊（脱流 absolute，内容从玻璃胶囊底下穿过，滚动容器 pb-[88px] 让位）
              qq-tabbar：底部标签栏锚点（自定义 CSS 示例模板可改底色/顶线） */}
          <div
            className={
              liquid
                ? 'qq-tabbar lg-tabbar absolute inset-x-3 bottom-[12px] z-30'
                : retro
                ? 'qq-tabbar rt-tabbar shrink-0 pb-[12px]'
                : 'qq-tabbar shrink-0 border-t border-black/[0.05] bg-white pb-[12px] dark:border-white/[0.06] dark:bg-[#1B1C1F]'
            }
          >
          <nav className={liquid ? 'flex h-[50px] items-stretch px-1' : retro ? 'flex h-[46px] items-stretch' : 'flex h-[44px] items-stretch'} aria-label="QQ 标签">
            {TAB_DEFS.map((t) => {
              const active = !staleGroupRoute && route.page === 'tabs' && route.tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`qq-tab-${t.id}`}
                  onClick={() => setRoute({ page: 'tabs', tab: t.id })}
                  aria-label={t.label}
                  className={`flex flex-1 flex-col items-center justify-center gap-[3px] ${
                    active ? (retro ? 'rt-tab-on' : TAB_ACTIVE) : retro ? 'text-[#6A6E7C]' : 'text-black/55 dark:text-white/55'
                  }`}
                >
                  <span className={`relative ${active && !retro ? '[&>svg]:fill-current' : ''}`}>
                    {retro ? <RtTabIconOf id={t.id} /> : t.icon}
                    {t.id === '消息' && totalUnread > 0 && (
                      <span
                        data-testid="qq-tab-badge-消息"
                        aria-label={`${totalUnread} 条未读`}
                        className={`absolute -right-[10px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F5455C] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                          liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-white dark:ring-[#1B1C1F]'
                        }`}
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                    {t.id === '动态' && qqNoticeBadge.count > 0 && (
                      <span
                        data-testid="qq-tab-badge-动态"
                        aria-label={`空间动态 ${qqNoticeBadge.count} 条新消息`}
                        className={`absolute -right-[10px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F5455C] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                          liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-white dark:ring-[#1B1C1F]'
                        }`}
                      >
                        {qqNoticeBadge.count > 99 ? '99+' : qqNoticeBadge.count}
                      </span>
                    )}
                  </span>
                  <span className={`text-[10px] ${retro ? 'font-semibold' : ''}`}>{t.label}</span>
                </button>
              );
            })}
          </nav>
          </div>
        </>
      ) : null}

      {/* 个人中心抽屉（左上头像打开） */}
      {drawerOpen && (
        <MeDrawer
          me={me}
          onClose={() => setDrawerOpen(false)}
          onOpenProfile={() => {
            setDrawerOpen(false);
            setRoute({ page: 'profile' });
          }}
          onOpenWallet={() => setRoute({ page: 'wallet' })}
          onOpenStickers={() => setRoute({ page: 'stickers' })}
          onOpenFavorites={() => setRoute({ page: 'favorites' })}
          onOpenDress={() => {
            setDrawerOpen(false);
            setRoute({ page: 'dress' });
          }}
          onOpenAlbum={() => {
            setDrawerOpen(false);
            setRoute({ page: 'album', albumContactId: me.id, albumTitle: '我的相册' });
          }}
          onOpenSettings={() => {
            setDrawerOpen(false);
            setRoute({ page: 'settings' });
          }}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      )}

      {toast && <QqToast text={toast} />}

      {/* 删除联系人二次确认（聊天设置入口；明确告知删什么/留什么） */}
      {delTarget && (
        <FriendDeleteConfirmDialog
          variant="qq"
          peerName={displayNameOf(delTarget.contact)}
          onCancel={() => setDelTarget(null)}
          onConfirm={() => void confirmRemoveFriend()}
        />
      )}
    </div>
  );
}

// ---------------- #11 换账号登录防串号：上一账号的 QQ 会话态数据清理 ----------------

/** QQ 上一登录账号 id（kv 持久化；登出不清——重登不同账号时据此判定换号） */
const QQ_LAST_LOGIN_ID_KEY = 'qq-last-login-id';

/**
 * #31 会话级设置键（localStorage 单键 JSON map，键 = sessionKey）：按 'qq:' 前缀剔除本 App 条目。
 * 这些键是多端混存的整键 JSON（wx:/qq:/sms: 同存一 map），不能整键删除——只剔除 qq: 条目
 *（含 qq:group: 群会话条目，与群消息同批清理），保留微信/信息等其他端的设置。
 * 键名与各设置模块的真实存储键逐一核对：
 * chat-reply-counts（reply-count.ts）/ chat-sentence-send、chat-sentence-pending（sentence-send.ts）/
 * chat-sticker-on（sticker-toggle.ts）/ chat-time-aware（time-aware.ts）/ chat-translate-cfg（chat-translate.ts）/
 * ai-voice-freq、ai-voice-counters（ai-voice.ts，单聊键 = 会话键、群聊键 = 会话键#成员 id）。
 * 注意不碰聊天消息/收藏等已单独列的键（qq-chat-msgs:、qq-favorites 等）；
 * chat-translate-cache 是 IndexedDB kv 且键为「语言|文本」哈希（不含会话键），不在本清单。
 */
const QQ_SESSION_SETTING_MAP_KEYS = [
  'chat-reply-counts',
  'chat-sentence-send',
  'chat-sentence-pending',
  'chat-sticker-on',
  'chat-time-aware',
  'chat-translate-cfg',
  'ai-voice-freq',
  'ai-voice-counters',
] as const;

function pruneQqSessionSettingMaps(): void {
  for (const storeKey of QQ_SESSION_SETTING_MAP_KEYS) {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const map = parsed as Record<string, unknown>;
      let changed = false;
      for (const k of Object.keys(map)) {
        if (k.startsWith('qq:')) {
          delete map[k];
          changed = true;
        }
      }
      if (changed) window.localStorage.setItem(storeKey, JSON.stringify(map));
    } catch {
      // 单键解析失败不影响其他键
    }
  }
}

/**
 * QQ 会话纪元（四轮审计 M5/L9/H1 纵深防御）：purgeQqSessionData（换号清库）每次递增。
 * 模块层延迟回调（AI 来电 1.2s 定时器 / 通话尾巴延迟写 / 流分段投递闭包 / finalize 收尾）
 * 在调度时捕获纪元、执行时比对——不一致说明中间发生过换号，本次回调整体作废
 * （旧账号的来电/消息/通话尾巴不写进刚清空的新账号会话）。
 */
let qqSessionEpoch = 0;

/**
 * 清理全部 QQ 会话态数据（#11 换号登录防串号：同一账号内上次登录的是另一个人时，
 * 进入新身份前清掉上一人的聊天记录/空间动态/钱包余额/未读角标等）。
 * 多账号 v2（Task 40-2b）关键修正：**只清当前 qq 账号作用域的数据**——kvDelByPrefix 现在
 * 跨全部账号（前缀匹配含各账号后缀键），直接用会误删其他账号的 QQ 数据（切回时记录必须原样恢复）。
 * 逐前缀改 kvKeysByPrefix 列原始键（含各账号后缀键）→ 过滤「属于当前账号的键」→ 逐键 kvDelRaw：
 * 大号只删无后缀键（parseScopedKey 为 null），小号只删以 --{id} 结尾的键。
 * 覆盖 IndexedDB kv 与 localStorage 双层 + 内存单例总线（未读表/会话 flags/排队补跑表）：
 * 只清存储不清内存会导致 UI 残留旧身份角标，刷新后才恢复。
 * 保留设备级数据：表情包库、支付密码、登录会话键（qq-session-user-id 由登录流程自管）；
 * 跨平台键（moments-queue / moments-auto-cfg 等 wx+qq 混存）不动，避免误伤微信侧数据。
 */
function purgeQqSessionData(): void {
  // 会话纪元递增：此后所有已调度未执行的模块层延迟回调（来电定时器/通话尾巴/分段投递闭包）
  // 按纪元失配自行作废（见 qqSessionEpoch 注释）
  qqSessionEpoch += 1;
  // #3 换号时在途流式/投递尾巴一并作废：旧账号会话（qq:<id> 单聊与 qq:group:<id> 群聊同前缀）
  // 的活跃流不再 finalize 落盘、待投递批次清空——否则换号后旧账号回复仍会写进刚清空的
  // qq-chat-msgs:* / qq-group-msgs:*（新账号看到旧账号的对话尾巴）。只影响 qq: 前缀，wx:/sms: 不受影响
  try {
    abortStreamsByPrefix('qq:');
  } catch {
    // 忽略
  }
  try {
    purgeDeliveryQueueByPrefix('qq:');
  } catch {
    // 忽略
  }
  // 当前账号 id 与「原始键是否属于当前账号」判定（多账号 v2：只清当前账号，其他账号键不动）
  const accId = getActiveAccountIdFor('qq');
  const keyBelongsToAccount = (rawKey: string): boolean => {
    const scoped = parseScopedKey(rawKey);
    return accId === MAIN_ACCOUNT_ID ? scoped === null : scoped?.accId === accId;
  };
  // IndexedDB kv：按前缀清（聊天消息 / 群聊消息 / 转发 AI 事件 / 密友值 / 好友点赞数——均含会话 id 后缀；
  // #9 补 qq-group-msgs:：群聊消息与单聊同批清（防串号），群本体（qq-groups 表）按保守处理不清——
  // 只清消息不清群定义，新身份打开群聊历史为空但群仍可从联系人 › 群聊 进入。
  // 多账号 v2：kvKeysByPrefix 列原始键 → 只删当前账号的键（kvDelByPrefix 会跨全部账号误删，弃用）
  for (const prefix of ['qq-chat-msgs:', 'qq-group-msgs:', 'qq-ai-events:', 'qq-bond:', 'qq-friend-likes:']) {
    try {
      for (const rawKey of kvKeysByPrefix(prefix)) {
        if (keyBelongsToAccount(rawKey)) kvDelRaw(rawKey);
      }
    } catch {
      // 忽略
    }
  }
  // IndexedDB kv：整键清（空间动态/评论/点赞、打卡、钱包余额/银行卡/账单、小金库收益、空间互动收件箱、
  // #10 消息收藏 qq-favorites——旧身份收藏残留会出现在新身份收藏页）。
  // 多账号 v2：kvDel 裸键自动按当前 qq 账号作用域（大号原键/小号 --{id}），其他账号数据不动 ✓
  for (const key of [LS_ZONE_POSTS, LS_ZONE_COMMENTS, LS_ZONE_LIKES, LS_QQ_CHECKIN, LS_WALLET, LS_WALLET_CARDS, LS_WALLET_BILLS, LS_VAULT_EARN, 'qq-moments-inbox', 'moments-inbox:qq', 'qq-favorites']) {
    try {
      kvDel(key);
    } catch {
      // 忽略
    }
  }
  // localStorage：整键清（未读角标/会话 flags（含旧版置顶迁移键）/隐藏会话/排队补跑/支付密码锁定）
  // 多账号 v2：裸键现算 accLs(key,'qq')（大号=原键；小号=--{id} 后缀键），只清当前账号的键
  try {
    window.localStorage.removeItem(accLs('qq-chat-unreads', 'qq'));
    window.localStorage.removeItem(accLs('qq-chat-flags', 'qq'));
    window.localStorage.removeItem(accLs('qq-chat-pins', 'qq'));
    window.localStorage.removeItem(accLs(LS_CHAT_HIDDEN, 'qq'));
    window.localStorage.removeItem(queuedTurnsKey());
    window.localStorage.removeItem(accLs(QQ_LS_PAY_PWD_LOCK, 'qq'));
  } catch {
    // 忽略
  }
  // localStorage：按前缀清（每会话 AI 来电冷却时间戳 qq-vc-last:<contactId>）
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('qq-vc-last:')) stale.push(k);
    }
    for (const k of stale) window.localStorage.removeItem(k);
  } catch {
    // 忽略
  }
  // 内存单例总线同步清空（否则残留旧账号角标/flags 到刷新）
  try {
    qqUnreadStore.prune([]);
  } catch {
    // 忽略
  }
  try {
    for (const fid of Object.keys(qqChatFlagsStore.get())) qqChatFlagsStore.reset(fid);
  } catch {
    // 忽略
  }
  try {
    for (const qid of Object.keys(qqQueuedTurns)) delete qqQueuedTurns[qid];
  } catch {
    // 忽略
  }
  // #31 会话级设置键（localStorage 混存 map）：按 qq: 前缀剔除旧账号的回复条数/分句/表情包/时间感知/翻译/语音频率与计数
  try {
    pruneQqSessionSettingMaps();
  } catch {
    // 忽略
  }
  // #33 转发事件已消费登记（内存单例 Map）一并清空：旧账号的登记会把新账号同文事件误判为已消费而吞掉回应
  try {
    consumedQqAiEvents.clear();
  } catch {
    // 忽略
  }
}

// ---------------- App 入口 ----------------

export default function QQApp() {
  // 第五十五轮（用户指定「所有界面都变化」）：主题作用域挂到 App 根 wrapper——
  // data-rt-theme / data-liquid-theme 触发 globals.css 里的 scoped 批量接管，
  // 覆盖主界面/聊天页/全部子页与弹层（页面底/白色卡/按钮/菜单），子页无需逐个改 JSX
  const bubbleStyleRoot = useSettings((s) => s.bubbleStyle);
  const retroRoot = isRetroTheme(bubbleStyleRoot, 'qq');
  const liquidRoot = isLiquidTheme(bubbleStyleRoot, 'qq');
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<QQUser | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);

  // 群社交：把联系人快照喂给 group-social（建群/拉人名单、被踢通知的宿主侧数据源）
  useEffect(() => {
    setGroupSocialContacts(contacts);
  }, [contacts]);

  // 删好友后 AI 主动申请加回：定时器不跨刷新，QQ 挂载时扫描删除状态按冷却补跑
  useEffect(() => {
    runFriendReqCatchUp();
  }, []);

  // 多账号 v2（Task 40-2b，不刷新的关键）：切换 QQ 账号不刷新网页——监听切换事件：
  // ① 会话纪元递增，旧账号已调度的延迟回调（来电定时器/通话尾巴/分段投递闭包）整体作废；
  // ② 中断 qq 在途流 + 清投递队列（旧账号回复不再落盘）；
  // ③（Task 42 起移除）未读/flags 总线已按账号作用域化并自带切换重载，无需再清
  // ④ 已消费转发事件登记清空（旧账号登记会吞新账号同文事件的回应）；
  // ⑤ 排队补跑内存队列重读新账号快照；
  // ⑥ bump accReloadKey → 启动加载 effect 重跑（联系人重读 + 按新账号作用域恢复登录态，无登录态 → 登录页）
  //   + remount 主界面回到消息列表主 tab（子页全关、各页挂载重读当前账号数据）。
  // wx/sms/phone 的账号切换与本 App 无关，忽略
  const [accReloadKey, setAccReloadKey] = useState(0);
  // 账号切换 toast（规则五.1：切换要有 UI 提示）：挂在根组件上，remount 后仍能看到
  const [switchToast, setSwitchToast] = useState<string | null>(null);
  const switchToastTimer = useRef<number | null>(null);
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'qq') return;
      qqSessionEpoch += 1;
      abortStreamsByPrefix('qq:');
      purgeDeliveryQueueByPrefix('qq:');
      try {
        consumedQqAiEvents.clear();
      } catch {
        // 忽略
      }
      qqQueueReload();
      // 切换提示：档案展示名优先，大号回退「机主」（登录成功/删除自动切回也一并提示）
      try {
        const acc = getActiveAccountFor('qq');
        setSwitchToast(`已切换到 ${acc.id === MAIN_ACCOUNT_ID ? '机主' : acc.name || '新账号'}`);
        if (switchToastTimer.current) window.clearTimeout(switchToastTimer.current);
        switchToastTimer.current = window.setTimeout(() => setSwitchToast(null), 1800);
      } catch {
        // 忽略
      }
      setAccReloadKey((k) => k + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);

  // 启动 / 账号切换重跑：拉联系人 + 恢复登录态（联系人被删则自动登出；QQ 内显示昵称，昵称优先于真实名字）。
  // 登录态键按 QQ 当前账号作用域（Task 40-2b：accLs 调用时现算，大号=原键旧登录态不丢）；
  // 切换账号（accReloadKey 变化）重跑时：无登录态/联系人缺失 → 显式回登录页，杜绝上一账号的界面残留。
  useEffect(() => {
    let alive = true;
    (async () => {
      // 匿名号只属于电话/信息（Task 40-S）：历史遗留的 QQ 匿名号槽位开机自愈切回大号
      //（switchAccountFor 派发事件 → 上方监听器 bump accReloadKey 重跑本 effect）
      if (getActiveAccountFor('qq').kind === 'anon') {
        switchAccountFor('qq', MAIN_ACCOUNT_ID);
        return;
      }
      // 多账号 Task 41：退出登录后的自由登录墙——本次启动不恢复任何会话，
      // 直接进自由登录（不显示/不锁定「当前账号」，想登哪个登哪个）。
      // 2025 补充（登录态保持）：只检查不消费——标记持续到下一次登录成功（handleLogin 清除），
      // 「退出 → 关掉 App → 再打开」仍是自由登录墙；登录过一次后所有账号免登录切换。
      if (isForceLoginWallActive('qq')) {
        if (!alive) return;
        setUser(null);
        setBooting(false);
        return;
      }
      // 头像按 App 隔离：加载读 qq 槽位投影（登录恢复/账号信息展示均用该头像）
      const raw = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
      if (!alive) return;
      // 备注按 App 隔离（第四十八轮）：QQ 里设置的备注只写 remarks.qq——展示名解析走 qq 槽位，微信/信息不受影响
      const list = withDisplayNames(raw, { social: true, app: 'qq' });
      setContacts(list);
      try {
        const savedId = window.localStorage.getItem(accLs(LS_SESSION, 'qq'));
        // Task 40 修正：小号/匿名号槽位的会话必须指向本槽位档案联系人——
        // 历史串槽登录态（在 A 小号槽位登了 B 的账密）在此自愈清除，避免切号页显示错账号
        const acc = getActiveAccountFor('qq');
        // Task 41 补强：大号作用域的会话指向了小号/匿名号档案（历史串槽残留）→ 清除回自由登录
        if (savedId && acc.kind === 'main') {
          const saved = raw.find((c) => c.id === savedId && c.kind === 'user');
          if (saved?.altOf) {
            window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
            setUser(null);
            setBooting(false);
            return;
          }
        }
        const slotProfile =
          acc.kind !== 'main' && savedId
            ? raw.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId))
            : null;
        if (savedId && acc.kind !== 'main' && (!slotProfile || slotProfile.id !== savedId)) {
          window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
          setUser(null);
        } else {
          const u = savedId ? raw.find((c) => c.id === savedId && c.kind === 'user') : undefined;
          if (u) {
            // 2025（小号加好友 AI 决策）：会话恢复必须带 altOf——登录时存入的 altOf 会被
            // 账号切换事件触发的 boot 重跑（此处）覆盖，丢失后小号加好友会走错「发送即通过」旧链路
            setUser({ id: u.id, name: displayNameOf(u), realName: u.name, nickname: u.nickname ?? null, avatar: u.avatar, qqId: u.qqId, phone: u.phone, persona: u.persona, altOf: u.altOf ?? null });
          } else {
            if (savedId) window.localStorage.removeItem(accLs(LS_SESSION, 'qq'));
            setUser(null);
          }
        }
      } catch {
        setUser(null);
      }
      setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [accReloadKey]);

  const handleLogin = useCallback((u: QQUser) => {
    // 多账号 Task 41：登录身份先落到对应账号作用域——自由登录可能是某个小号（档案 altOf），
    // 槽位登录已是本槽位（no-op）；大号机主档案回 main。必须先切再 purge：
    // purgeQqSessionData 只清「当前作用域」的键，切号后正确落新账号（不会误清前一账号数据）。
    const accId = u.altOf || MAIN_ACCOUNT_ID;
    switchAccountFor('qq', accId);
    // #11 换账号登录防串号：当前作用域上次登录的是另一个账号时，先清掉该作用域的全部 QQ 会话态数据
    //（聊天记录/空间动态/钱包/未读角标等，见 purgeQqSessionData）再进入新身份；
    // 首次登录（无存储 id）只记录不清；同一账号重登不清（登出本就不删数据，重登应恢复）
    try {
      const lastId = kvGet<string>(QQ_LAST_LOGIN_ID_KEY);
      if (lastId && lastId !== u.id) purgeQqSessionData();
    } catch {
      // 忽略
    }
    try {
      kvSet(QQ_LAST_LOGIN_ID_KEY, u.id);
    } catch {
      // 忽略
    }
    setUser(u);
    try {
      // 登录历史：切换账号列表只显示登录过的账号（Task 41）
      markAccountLoginHistory('qq', accId);
      // 登录成功 = 退出后的自由登录墙使命完成（标记在下次退出前不再出现）
      clearForceLoginWall('qq');
      window.localStorage.setItem(accLs(LS_SESSION, 'qq'), u.id);
    } catch {
      // 忽略
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    // 登录态保持（2025）：退出只退「当前身份」，不删任何账号的会话键——
    // 其他已登录账号（含刚退出的这个）在切换账号界面点击仍直接进入，无需重新输密码；
    // 退出后的自由登录墙持续到下一次登录成功（isForceLoginWallActive + handleLogin 清除）。
    // 多账号 Task 41：退出后回大号身份 + 自由登录墙——不显示「当前账号」、不锁定登录身份。
    requestForceLoginWall('qq');
    switchAccountFor('qq', MAIN_ACCOUNT_ID);
  }, []);

  // 添加好友后刷新联系人列表（同步换成昵称展示名——机主同规则 socialNameOf；头像按 App 隔离读 qq 槽位投影；
  // 备注按 App 隔离读 qq 槽位——第四十八轮）；返回投影列表供「我」快照同步复用
  const refreshContacts = useCallback(async (): Promise<ContactRecord[]> => {
    const raw = await listContactsFor('qq').catch(() => [] as ContactRecord[]);
    setContacts(withDisplayNames(raw, { social: true, app: 'qq' }));
    return raw;
  }, []);

  // 换头像跨 App 即时生效（引用式架构）：头像只在联系人资料存一份，渲染端 liveAvatarOf 实时解析；
  // 其他 App（联系人/微信/信息/电话）改了头像时刷新本端联系人缓存，打开中的空间/聊天页立刻显示新头像。
  // contact-updated：任意资料字段（名字/手机号/昵称/人设…）变更也刷新——编辑联系人不换头像时
  // QQ 端不再持旧快照（会话列表/资料页/登录解析保持最新）。
  // 「我」快照同步（编辑自己修复）：user 是开机/登录时 from 联系人的快照——机主在联系人 App
  // 改了自己头像/名字后，聊天/空间等处的「我」仍持旧值；这里随重载按最新联系人重派生
  useEffect(() => {
    const fn = () =>
      void refreshContacts().then((raw) => {
        setUser((prev) => {
          if (!prev) return prev;
          const u = raw.find((c) => c.id === prev.id && c.kind === 'user');
          return u
            ? { id: u.id, name: displayNameOf(u), realName: u.name, nickname: u.nickname ?? null, avatar: u.avatar, qqId: u.qqId, phone: u.phone, persona: u.persona, altOf: u.altOf ?? null }
            : prev;
        });
      });
    window.addEventListener('contact-avatar-changed', fn);
    window.addEventListener('contact-updated', fn);
    return () => {
      window.removeEventListener('contact-avatar-changed', fn);
      window.removeEventListener('contact-updated', fn);
    };
  }, [refreshContacts]);

  // 小号加好友 AI 决策落盘（2025）：同意 = 好友标记变化 → 刷新联系人（联系人列表即时出现）；
  // 拒绝/先回复不改变好友标记，刷新无副作用
  useEffect(() => {
    const fn = () => void refreshContacts();
    window.addEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
    return () => window.removeEventListener(FRIEND_STATE_APPLIED_EVENT, fn);
  }, [refreshContacts]);

  // 个签等本地资料更新（同步到 QQUser，落库在调用方完成）
  const handlePatchUser = useCallback((patch: Partial<QQUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (booting) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#EAE6F6] via-[#E4EBF7] to-[#E7F0F9] dark:from-[#23253A] dark:via-[#20293A] dark:to-[#1E2A38]">
        <svg viewBox="0 0 40 40" className="h-16 w-16" aria-hidden="true">
          {/* 简化 QQ 企鹅（启动图） */}
          <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
          <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
          <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
          <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
          <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
          <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
          <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
        </svg>
        <p className="mt-4 text-[13px] text-black/40 dark:text-white/40">QQ</p>
      </div>
    );
  }

  if (!user) {
    // 小号/匿名号槽位：登录墙绑定当前槽位（显示账号名/预填账号/只认本槽位账密）；大号保持原自由登录
    const acc = getActiveAccountFor('qq');
    return (
      <>
        <LoginScreen onLogin={handleLogin} slot={acc.kind === 'main' ? null : acc} />
        {switchToast && <QqToast text={switchToast} />}
      </>
    );
  }

  // key={accReloadKey}：切换 QQ 账号后 remount 主界面——route 归位消息 tab、子页全关、各页挂载重读当前账号数据
  return (
    <div
      className="relative h-full w-full"
      data-rt-theme={retroRoot ? 'true' : 'false'}
      data-liquid-theme={liquidRoot ? 'true' : 'false'}
    >
      {/* 第五十六轮：古早/液态皮肤下发到共享子页（chat-settings 二级页 / 主动发消息等） */}
      <ChatSkinProvider retro={retroRoot} liquid={liquidRoot}>
        <MainScreen key={accReloadKey} me={user} contacts={contacts} onLogout={handleLogout} onPatchUser={handlePatchUser} refreshContacts={refreshContacts} onLoginAccount={handleLogin} />
        {/* 账号切换提示（规则五.1）：挂在根组件，remount 后依然可见 */}
        {switchToast && <QqToast text={switchToast} />}
        {/* 扫一扫（+菜单 / 加好友页入口；识别网页/文本/群二维码，演示语义） */}
        <ScanOverlayWhen flavor="qq" />
      </ChatSkinProvider>
    </div>
  );
}
