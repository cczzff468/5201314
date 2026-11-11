'use client';

/** 类型/常量/消息存储/小窗共享源/钱包函数/工具/人设提示词（数据层） —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { X } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { sortMsgsByTime } from '@/lib/ios/ai-delivery';
import { decideAiVoiceMessage } from '@/lib/ios/ai-voice';
import { type VoiceMsgData } from '@/components/apps/voice-bubble';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { type WxGiftData } from '../wx-gift';
import { beginChatStream } from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { promptGroupParts, promptRule, promptTextOf } from '@/lib/prompt-entries';
import { type NpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildRichRules, actionVerb, parseRichParts, type PendingCardInfo, type RichAction, type RichMsg, type RichSong } from '@/lib/chat-rich';
import { triggerInviteFromChat } from '@/lib/ios/together-invite';
import { type GroupCardData } from '@/lib/ios/group-social';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
import { STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { ACTION_DESC_RULE, ACTION_DESC_OFF_RULE } from '@/lib/action-desc';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
import { EMOJI_CODE_RULE } from '@/lib/ios/emoji-codes';
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
import { kvGet, kvGetRaw, kvSet, kvSetDebounced, kvDel } from '@/lib/ios/idb-kv';
import { getMemSettings, memAddEventFragment, memConvoFromRaw } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
import { type MomentRepostRef } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { accLs, switchAccountFor } from '@/lib/ios/accounts';
import { listContactsFor } from '@/lib/ios/contacts-store';
import { addressNameOf, displayNameOf, activeAccountIdOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { loadFriendReqs, saveFriendReqs, type FriendReqEntry } from '@/lib/ios/friend-state';
import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import { type CoupleRelCardData } from '@/lib/ios/couple-invite';
import { loadStickers } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
import { wxUnreads as wxUnreadStore } from '@/lib/unread-store';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { fmtMoney, loadJSON, saveJSON, LS_WALLET, LS_BILLS, loadCards, loadFamilyCards, resetFamilyCardsInMonth, saveFamilyCards, saveFamilyCardsIn, type WxFamilyCardIn, type WxFcPayPart, type WxFcPayResult } from '../wechat-wallet';
import { type CallCardState } from '../voice-call-screen';
import { locDataOf, locFromRich } from '@/lib/ios/chat-location';


// ---------------- 类型 / 常量 / 工具 ----------------

export interface WxUser {
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

export interface WxRpData {
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

export interface WxTrData {
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
export interface WxNoticeData {
  /** 小图标：rp=红红包 / tr=橙转账 / fam=金亲属卡 / gift=蓝金礼物（第七轮反馈新增） */
  icon: 'rp' | 'tr' | 'fam' | 'gift';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 亲属卡消息数据（我赠送 / 好友赠送共用；点卡片进详情） */
export interface WxFamData {
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

export interface WxMsg {
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
  sys?: { text: string; pat?: { by: 'me' | 'peer'; self?: boolean; text?: string }; op?: boolean };
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
export interface WxMomentComment {
  id: string;
  author: string;
  text: string;
  /** AI 双语译文（中文译文；空串 = 无译文）；48-6 渲染折叠块 */
  contentZh?: string;
  time: number;
  replyTo: string | null;
}

/** 朋友圈动态（localStorage 持久化，新动态在最前） */
export interface WxMoment {
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
export type WxFriendReq = FriendReqEntry;

export const LS_SESSION = 'wx-session-user-id';
export const LS_MOMENTS = 'wx-moments';
export const lsMsgsKey = (contactId: string) => `wx-chat-msgs:${contactId}`;

// ---------------- 拍一拍文案（Task 30：微信个人资料页「拍一拍」行设置，按账号隔离） ----------------

/** 拍一拍文案存储键（accLs 按当前微信账号加作用域后缀：大号无后缀、小号 --{accId}） */
export const wxClapKey = (): string => accLs('wx-clap-text', 'wx');

/** 读取拍一拍文案（未设置返回空串；文案是「拍了拍」的后缀，如「的小脑袋」） */
export function readWxClapText(): string {
  try {
    return (window.localStorage.getItem(wxClapKey()) ?? '').trim().slice(0, 30);
  } catch {
    return '';
  }
}

/** 保存拍一拍文案（空串 = 清除，回退「未设置」） */
export function writeWxClapText(text: string): void {
  try {
    window.localStorage.setItem(wxClapKey(), text.trim().slice(0, 30));
  } catch {
    // 存储异常静默：拍一拍文案退化为默认展示
  }
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** v73 同会话并发打开的 ChatPage 实例数（全屏 + 聊天小窗可双开）：最后一个实例卸载才清 active 标记，
 *  避免小窗先卸载时把仍在前台的全屏聊天「已读状态」误清（主动消息角标守卫误判） */
export const wxActiveInstances = new Map<string, number>();
/** 排队补跑回合：对方正在回复时用户又发了消息 / 在回复中处理了「解除拉黑申请、退还红包转账亲属卡」
 *  等需要 AI 后续回应的事项 —— 本轮流结束后由聊天页自动补跑一轮回复。
 *  #28 localStorage 持久化（key: wx-queued-turns）：模块加载时恢复，增删即同步写回——刷新后排队中的
 *  消息不再丢失（补跑依赖聊天页被打开：刷新后重新进入该会话，kick effect 挂载即自动补跑）。
 *  37-a：队列项扩展 event 字段——回复中触发的系统事件（拉黑申请同意/拒绝、退卡）随补跑回合保留
 *  （原实现直接 runAiTurn：同会话已有流时 beginChatStream 返回 false，事件被静默丢弃、AI 绝口不提） */
export type WxQueuedTurn = { kind: 'kick'; event?: string };
// 多账号 v2（Task 40-2a）：键在每次读写时按微信当前账号现算 accLs（大号=原键向后兼容；小号 wx-queued-turns--{id}）。
// 切换账号不再刷新网页，严禁模块常量固化作用域；切换瞬间由根组件调 wxQueueReload() 把内存队列换仓到新账号快照。
export const queuedTurnsKey = () => accLs('wx-queued-turns', 'wx');

/** 读取并规范化排队表（兼容旧格式：contactId 字符串数组 = 纯消息补跑，无事件） */
export function readWxQueuedTurns(): Record<string, WxQueuedTurn[]> {
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

export const wxQueuedTurns = readWxQueuedTurns();

export function wxQueueWrite(): void {
  try {
    window.localStorage.setItem(queuedTurnsKey(), JSON.stringify(wxQueuedTurns));
  } catch {
    // localStorage 异常忽略：内存队列照常工作（仅刷新后丢该条补跑）
  }
}

/** 排队一条补跑回合（event = 系统事件文本，随补跑回合注入上下文；不带事件 = 普通消息补跑） */
export function wxQueueAdd(id: string, event?: string): void {
  const turn: WxQueuedTurn = event ? { kind: 'kick', event } : { kind: 'kick' };
  const list = wxQueuedTurns[id] ?? [];
  list.push(turn);
  wxQueuedTurns[id] = list;
  wxQueueWrite();
}

export function wxQueueDelete(id: string): void {
  if (!wxQueuedTurns[id]) return;
  delete wxQueuedTurns[id];
  wxQueueWrite();
}

/** 多账号 v2（Task 40-2a）：切换微信账号时由根组件调用——内存队列整体换仓为新账号作用域键的
 *  持久化快照（旧账号的排队原样留在旧键下，切回时自动恢复）。调用时机在 switchAccountFor 写完
 *  per-app 标记之后，readWxQueuedTurns 内部 accLs 现算即得新账号键。不刷新网页后内存队列不能
 *  跨账号沿用，否则旧账号的排队补跑会写进新账号的键。 */
export function wxQueueReload(): void {
  for (const k of Object.keys(wxQueuedTurns)) delete wxQueuedTurns[k];
  Object.assign(wxQueuedTurns, readWxQueuedTurns());
}

export function loadMsgs(contactId: string): WxMsg[] {
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

export function saveMsgs(contactId: string, msgs: WxMsg[]): void {
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

// ---------------- v73 聊天小窗：会话消息共享源（同一会话全屏 + 小窗双开实时互通） ----------------

/**
 * 每会话的权威消息列表（模块级，React 外）：ChatPage 的 msgs 状态升级为共享源镜像——
 * 全屏聊天页与 PhoneShell 层的聊天小窗（同会话）双开时，任一侧发送/接收/撤回都即时同步到另一侧。
 * 无实例存活时保留缓存（纯内存），下次挂载 init() 与磁盘记录按 id 合并去重，双向兜底：
 *  · 外部直写磁盘的写入（主动消息/接力投递）不会被旧缓存掩盖；
 *  · 上一实例 400ms 防抖窗口内未落盘的尾巴不会因重挂载丢失。
 */
export const wxSessionMsgsMap = new Map<string, WxMsg[]>();
export const wxSessionSubs = new Map<string, Set<(m: WxMsg[]) => void>>();

/** 磁盘 ∥ 内存共享源按 id 合并（overlay 同 id 覆盖、独有追加），结果按时间稳定排序 */
export function mergeMsgLists(base: WxMsg[], overlay: WxMsg[]): WxMsg[] {
  if (overlay.length === 0) return base;
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const m of overlay) byId.set(m.id, m);
  return sortMsgsByTime(Array.from(byId.values()));
}

export const wxSessionMsgs = {
  init(cid: string): WxMsg[] {
    const merged = mergeMsgLists(loadMsgs(cid), wxSessionMsgsMap.get(cid) ?? []);
    wxSessionMsgsMap.set(cid, merged);
    return merged;
  },
  get(cid: string): WxMsg[] | null {
    return wxSessionMsgsMap.get(cid) ?? null;
  },
  commit(cid: string, next: WxMsg[] | ((prev: WxMsg[]) => WxMsg[])) {
    const value = typeof next === 'function' ? next(wxSessionMsgsMap.get(cid) ?? []) : next;
    wxSessionMsgsMap.set(cid, value);
    const subs = wxSessionSubs.get(cid);
    if (subs) for (const fn of subs) fn(value);
  },
  subscribe(cid: string, fn: (m: WxMsg[]) => void): () => void {
    let set = wxSessionSubs.get(cid);
    if (!set) {
      set = new Set();
      wxSessionSubs.set(cid, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) wxSessionSubs.delete(cid);
    };
  },
};

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
export const lsAiEventsKey = (contactId: string) => `wx-ai-events:${contactId}`;

export function pushAiEvent(contactId: string, text: string): void {
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
export const consumedWxAiEvents = new Map<string, number>();
export const keyOfWxAiEvent = (contactId: string, text: string) => `${contactId}\n${text}`;

export function drainAiEvents(contactId: string): string[] {
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
export function copyTextWithToast(text: string, onToast: (m: string) => void): void {
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
export const LS_CHAT_HIDDEN = 'wx-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
export const wxUnreads = wxUnreadStore;

export function loadStrList(key: string): string[] {
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

export function saveStrList(key: string, list: string[]): void {
  try {
    // 多账号 v2（Task 40-2a）：同 loadStrList，写入也按微信当前账号现算作用域
    window.localStorage.setItem(accLs(key, 'wx'), JSON.stringify(list));
  } catch {
    // 忽略
  }
}

export function loadMoments(): WxMoment[] {
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
export const FRIEND_POST_TEMPLATES: ReadonlyArray<{ text: string; agoMs: number }> = [
  { text: '今天天气不错，出去走了走', agoMs: 2 * 3_600_000 },
  { text: '忙完这个项目，终于可以休息一下了', agoMs: 26 * 3_600_000 },
  { text: '新的开始，加油！', agoMs: 3 * 86_400_000 },
];

export function loadReqs(): WxFriendReq[] {
  // 存储在 friend-state（同键 wx-friend-reqs）：旧数据无 status 归一化为 accepted；QQ/微信共用一套读写逻辑
  return loadFriendReqs('wx');
}

export function saveReqs(list: WxFriendReq[]): void {
  saveFriendReqs('wx', list);
}

/** 图片压缩（申请添加朋友页「添加图片」用；与 qq.tsx 同款实现，两端共用同一逻辑） */
export function compressImageFile(file: File, max = 1280): Promise<string> {
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
export function meAsContact(me: WxUser): ContactRecord {
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
export function readPreview(contactId: string): { text: string; time: number } {
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
export function wxLoadBalance(): number {
  const w = loadJSON<{ balance?: number }>(LS_WALLET, {});
  return typeof w.balance === 'number' && w.balance >= 0 ? w.balance : 0;
}

export const LS_CARDS = 'wx-wallet-cards';

/** 账单条目附加信息（对方名/头像；转账条目账单页显示对方头像） */
export interface WxBillMeta {
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
export function wxMarkLatestBillRefund(kind: '红包' | '转账', amount: number): void {
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
export function wxPushBill(kind: '红包' | '转账' | '亲属卡付款' | '红包退款' | '转账退款' | '美团外卖' | '淘宝购物', amount: number, meta?: WxBillMeta): void {
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
export function wxFcGroupKey(f: WxFamilyCardIn): string {
  return f.friendId ?? f.id;
}

export function wxFcGroups(list: WxFamilyCardIn[]): Map<string, WxFamilyCardIn[]> {
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
export function wxFcGroupOf(list: WxFamilyCardIn[], methodId: string): { cards: WxFamilyCardIn[]; available: number } {
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
export function fmtFullDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtFullTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 时间展示：今天 HH:mm / 昨天 / 周X / M/D */
export function fmtListTime(ts: number): string {
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
export function fmtChatTime(ts: number): string {
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
export function maskPhone(p: string | null): string {
  const digits = (p ?? '').replace(/\s/g, '');
  if (!digits) return '未绑定';
  if (digits.length < 7) return digits;
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(4, digits.length - 5))}${digits.slice(-2)}`;
}

/** 朋友圈时间：刚刚 / n分钟前 / HH:mm / 昨天 / M月D日 */
export function fmtMomentsTime(ts: number): string {
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
export function fmtReqDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((dayStart - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 3) return `${diffDays}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export const PINYIN_ANCHORS: Array<[string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'],
  ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'],
  ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'],
  ['Y', '压'], ['Z', '匝'],
];

/** 名字首字母分组：英文取首字母；中文按拼音锚点归组；其余进 # */
export function initialOf(name: string): string {
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
export function richToWxMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): WxMsg {
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
export function songRichToWxMsg(rich: RichSong, id: string, time: number, peer: ContactRecord): WxMsg {
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
export const AI_VOICE_DELIVERY_RULE =
  '（你的文字消息有时会以语音条的形式送达对方——这是正常的送达方式，不用在意；但不要在正文里说「我给你发条语音」这类话，也不要主动承诺发语音，用文字自然聊就好。）';

/** 联系人 AI 人设（微信聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  actionDescOn：动作描写开关（开启注入 *...* 格式约定、关闭注入显式禁令，见 @/lib/action-desc）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况）；
 *  aiVoiceOn：AI 语音频率开关（100-e，开启时告知「文字消息可能以语音条送达」，见 AI_VOICE_DELIVERY_RULE） */
export function buildPersonaPrompt(peer: ContactRecord, me: WxUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, actionDescOn: boolean, npcExtra?: NpcPromptExtra | null, aiVoiceOn?: boolean): string {
  // 名字/昵称区分：AI 称呼用户按全局设置（默认用名字「凡凡」，用户选「用昵称称呼」才用「凑凑」）；
  // 用户规则：AI 永远不知道机主的昵称——人设只注入真称呼名（真名），不注入任何昵称信息
  const mode = useSettings.getState().addressMode;
  // 多账号（用户规则二.2）：小号/匿名号侧不再注入任何大号身份/关系信息（【用户的另一个身份】段已移除）
  const accId = activeAccountIdOf('wx');
  // v63 全局预设管理器：微信沉浸规则全部接入注册表（可开关/可编辑，下次发送即生效）。
  // 静态规则传原文本作 dynamicDefault（零破坏）；红包/转账/表情包清单等动态规则整块包成一条
  const richBlock = (() => {
    const rich = buildRichRules(stickersOn ? stickers : []);
    if (rich.length === 0) return '';
    return promptTextOf('wx-rich-rules', {}, rich.join('\n')) ?? '';
  })();
  // v65：微信沉浸规则整块走 wx-rules 合并组——组关闭=微信不再注入任何沉浸规则；
  // 组编辑=编辑版大模板整块接管（{{richRules}} 填入当前表情包动态规则）；
  // 默认=原逐条组装（零破坏，成员级开关/编辑照旧）
  const wxRuleParts = promptGroupParts('wx-rules', { richRules: richBlock }, () => [
      // v71：wx-sticker-recv（对方表情包回应规则）按用户要求整条移除，不再注入
      // 内置小表情 [微笑] 代码约定（开关开启才注入；用户点面板内置表情即以此格式入历史，AI 也可同格式回复）
      ...(stickersOn ? [promptRule('wx-emoji-code', EMOJI_CODE_RULE) ?? ''] : []),
      ...richBlock.split('\n'),
      ...(stickersOn ? [] : [promptRule('wx-sticker-off', STICKER_OFF_RULE) ?? '']),
      ...(actionDescOn
        ? [promptRule('wx-action-desc', ACTION_DESC_RULE) ?? '']
        : [promptRule('wx-action-desc-off', ACTION_DESC_OFF_RULE) ?? '']),
      // 100-e 文字升级语音条告知（开关开启才注入，off 零注入）
      ...(aiVoiceOn ? [promptRule('wx-ai-voice', AI_VOICE_DELIVERY_RULE) ?? ''] : []),
    ].filter(Boolean));
  return buildPersonaSystemPrompt(peer, {
    channel: '微信',
    userName: addressNameOf(me, mode),
    ownerName,
    accountId: accId,
    // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取）
    multiApp: getMemSettings(peer.id).share,
    ...npcExtra,
    extraRules: wxRuleParts ?? [],
  });
}

/** 用户发给 AI 的红包/转账/亲属卡短 ID（AI 动作标记里引用；短小易抄写） */
export function nextWxCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** fix3-c #2：终态执行者名字来源（可选）——仅 AI 上下文序列化处传入；内部状态比较（wxCardIsFinal 等）不传，
 *  标签保持原文案，比较逻辑零影响。me=机主名字（me.name/称呼均可）、peer=AI 角色名字 */
export interface WxCardActorNames {
  me?: string;
  peer?: string;
}

/** 红包/转账/亲属卡消息的状态标签（卡片文案 + AI 上下文摘要共用）：
 *  fix3-c #2 终态补执行者后缀（归属清晰：谁领取/谁退还/谁拒收/超24h自动退回）——
 *  名字来源：红包 openedBy 落库时已存真名，直接用；其余执行者按「原卡角色反推（我发的→对方执行，
 *  对方发的→机主执行）」从 names 取；转账过期清算以「原卡带 refundedBy 且无凭据卡专有字段」识别。
 *  names 缺省或对应字段缺失时保持原文案 */
export function wxCardStateLabel(m: WxMsg, names?: WxCardActorNames): string {
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
export function wxCardIsFinal(m: WxMsg): boolean {
  const label = wxCardStateLabel(m);
  return label !== '待领取' && label !== '待收款' && label !== '待收下';
}

/** 拍一拍系统行的 AI 上下文序列化（Task 30）：按双方名字显式拼接（文案 = 拍一拍后缀，原样拼在句尾），
 *  不用「你/我」代词——assistant 消息里「你」指 AI 本身，混用会造成主语伪造 */
export function wxPatHistoryLine(pat: NonNullable<WxMsg['sys']>['pat'], meName: string, peerName: string): string {
  const suffix = pat?.text ?? '';
  if (pat?.by === 'me') return pat.self ? `[${meName}拍了拍自己${suffix}]` : `[${meName}拍了拍${peerName}${suffix}]`;
  return `[${peerName}拍了拍${meName}${suffix}]`;
}

/** 收集「我发给 AI 的、待处理」的红包/转账/亲属卡/礼物卡（生成 system 待处理清单） */
export function wxCollectPendingCards(msgs: WxMsg[]): PendingCardInfo[] {
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
export let wxSweepCardsRunning = false;
export async function wxExpireStalePeerCards(): Promise<string[]> {
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
export function wxApplyAiActions(
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
