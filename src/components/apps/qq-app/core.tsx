'use client';

/** 类型/常量/消息与空间存储/队列/AI事件/密友值/工具/人设提示词（数据层） —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { X } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { type VoiceMsgData } from '@/components/apps/voice-bubble';
import { type CallCardState } from '../voice-call-screen';
import { locFromRich } from '@/lib/ios/chat-location';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import { type CoupleRelCardData } from '@/lib/ios/couple-invite';
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { beginChatStream } from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { promptGroupParts, promptRule, promptTextOf } from '@/lib/prompt-entries';
import { type NpcPromptExtra } from '@/lib/ios/npc-bond';
import { getMemSettings, memAddEventFragment, memConvoFromRaw } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage, upgradeMomentTextCard, type MomentRepostRef } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { ACTION_DESC_RULE, ACTION_DESC_OFF_RULE } from '@/lib/action-desc';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
import { EMOJI_CODE_RULE } from '@/lib/ios/emoji-codes';
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvSet, kvSetDebounced, kvDel } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { accLs } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { listContactsFor } from '@/lib/ios/contacts-store';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
import { RtBellIcon, RtUsersIcon, RtStarIcon } from '../retro-icons';
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { addressNameOf, withDisplayNames, activeAccountIdOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { loadStickers } from '@/lib/ios/stickers';
import type { Sticker } from '@/lib/ios/stickers';
import { buildRichRules, actionVerb, parseRichParts, type PendingCardInfo, type RichAction, type RichMsg, type RichSong } from '@/lib/chat-rich';
import { triggerInviteFromChat } from '@/lib/ios/together-invite';
import { type GroupCardData } from '@/lib/ios/group-social';
import { decideAiVoiceMessage } from '@/lib/ios/ai-voice';

import { refundToWallet, round2 } from './wallet';

// ---------------- 类型 / 常量 / 工具 ----------------

export interface QQUser {
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

export interface QQMsg {
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
export interface QQNoticeData {
  /** 小图标：rp=红红包 / tr=蓝转账 / fam=金亲属卡 */
  icon: 'rp' | 'tr' | 'fam';
  /** 主体文案（不含尾词），如「晚晴宝领取了你的」 */
  pre: string;
  /** 尾词高亮：「红包」/「转账」/「亲属卡」 */
  accent: string;
}

/** 位置消息：名称 + 详细地址 + 经纬度（AI 可读到“用户在哪”；旧记录无经纬度字段照常兼容） */
export interface MsgLoc {
  name: string;
  addr: string;
  lat?: number;
  lng?: number;
}

/** 亲属卡消息数据（AI 赠送；领取后 claimed=true；被收卡方退还后 rejected=true） */
export interface QQFamData {
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
export function msgPreview(m: QQMsg | undefined): string {
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
export type ChatLayer =
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
export const LS_SESSION = 'qq-session-user-id';
export const lsMsgsKey = (contactId: string) => `qq-chat-msgs:${contactId}`;

// ---------------- 拍一拍文案（Task 30：QQ 设置›头像双击动作里设置，按账号隔离） ----------------

/** 拍一拍文案存储键（accLs 按当前 QQ 账号加作用域后缀：大号无后缀、小号 --{accId}） */
export const qqClapKey = (): string => accLs('qq-clap-text', 'qq');

/** 读取拍一拍文案（未设置返回空串；文案是「拍了拍」的后缀，如「的小脑袋」） */
export function readQqClapText(): string {
  try {
    return (window.localStorage.getItem(qqClapKey()) ?? '').trim().slice(0, 30);
  } catch {
    return '';
  }
}

/** 保存拍一拍文案（空串 = 清除，回退「未设置」） */
export function writeQqClapText(text: string): void {
  try {
    window.localStorage.setItem(qqClapKey(), text.trim().slice(0, 30));
  } catch {
    // 存储异常静默：拍一拍文案退化为默认展示
  }
}

/** 拍一拍系统行的 AI 上下文序列化（Task 30）：按双方名字显式拼接（文案 = 拍一拍后缀，原样拼在句尾），
 *  不用「你/我」代词——assistant 消息里「你」指 AI 本身，混用会造成主语伪造 */
export function qqPatHistoryLine(pat: NonNullable<QQMsg['sys']>['pat'], meName: string, peerName: string): string {
  const suffix = pat?.text ?? '';
  if (pat?.by === 'me') return pat.self ? `[${meName}拍了拍自己${suffix}]` : `[${meName}拍了拍${peerName}${suffix}]`;
  return `[${peerName}拍了拍${meName}${suffix}]`;
}

/** AI 特殊消息标记 → QQ 消息记录（红包/转账/亲属卡/位置/表情包；渲染与交互复用用户手动发送的同款卡片）。
 *  content 存可读摘要：进入 AI 上下文让角色知道自己发过什么；卡片渲染按 kind 走，不显示 content */
export function richToQqMsg(rich: RichMsg, id: string, time: number, peer: ContactRecord): QQMsg {
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
export function songRichToQqMsg(rich: RichSong, id: string, time: number, peer: ContactRecord): QQMsg {
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
export function cardStateLabel(m: QQMsg): string {
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
export function cardIsFinal(m: QQMsg): boolean {
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
export function isTransferReceiptMsg(m: QQMsg): boolean {
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
export function transferReceiptAiText(m: QQMsg, meName: string, peerName: string): string {
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
export function collectPendingCards(msgs: QQMsg[]): PendingCardInfo[] {
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
export function applyAiActions(
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
export let qqSingleCardSweepRunning = false;

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
export async function expireStaleSingleCards(): Promise<boolean> {
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
export const LS_ZONE_POSTS = 'qq-zone-posts';
export const LS_ZONE_LIKES = 'qq-zone-likes';
export const LS_ZONE_COMMENTS = 'qq-zone-comments';
/** 个人中心打卡状态（当日已打卡 + 连续天数，localStorage 持久化） */
export const LS_QQ_CHECKIN = 'qq-checkin';
export const LS_FRIEND_LIKE = (contactId: string) => `qq-friend-likes:${contactId}`;
// QQ 钱包：余额/Q币/小金库、银行卡、账单流水（本地持久化）
export const LS_WALLET = 'qq-wallet';
export const LS_WALLET_CARDS = 'qq-wallet-cards';
export const LS_WALLET_BILLS = 'qq-wallet-bills';

/** 本地日期键（打卡用，避免 toISOString 的 UTC 偏移） */
export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface ZonePost {
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
export interface ZoneComment {
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
export const ZONE_SEEDS: ZonePost[] = [];

export const SEED_DEFAULT_LIKE: Record<string, boolean> = {};

export function loadZonePosts(): ZonePost[] {
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

export function loadZoneComments(): Record<string, ZoneComment[]> {
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
export function maskPhone(p: string | null): string {
  if (!p) return '未绑定';
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}******${p.slice(-2)}`;
}

/** QQ 品牌色 */
export const QQ_BLUE = '#12B7F5';
export const TAB_ACTIVE = 'text-[#1E6FFF] dark:text-[#4AA3FF]';

/** 古早主题（retro）底部 Tab 图标（粗线方角线稿，颜色随宿主 currentColor：
 *  选中态由按钮上的 .rt-tab-on 复古蓝接管；不填充线稿） */
export function RtTabIconOf({ id }: { id: string }) {
  if (id === '消息') return <RtBellIcon className="h-[22px] w-[22px]" />;
  if (id === '联系人') return <RtUsersIcon className="h-[22px] w-[22px]" />;
  return <RtStarIcon className="h-[22px] w-[22px]" />;
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 用户发给 AI 的红包/转账短 ID（AI 动作标记里引用；短小易抄写） */
export function nextCid(prefix: 'rp' | 'tr' | 'fam'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 排队补跑回合：对方正在回复时用户又发了消息 / 在回复中处理了「解除拉黑申请、退还红包转账亲属卡」
 *  等需要 AI 后续回应的事项 —— 本轮流结束后由聊天页自动补跑一轮回复。
 *  #28 localStorage 持久化（key: qq-queued-turns）：模块加载时恢复，增删即同步写回——刷新后排队中的
 *  消息不再丢失（补跑依赖聊天页被打开：刷新后重新进入该会话，kick effect 挂载即自动补跑）。
 *  37-a：队列项扩展 event 字段——回复中触发的系统事件（拉黑申请同意/拒绝、退卡）随补跑回合保留
 *  （原实现直接 runAiTurn：同会话已有流时 beginChatStream 返回 false，事件被静默丢弃、AI 绝口不提） */
export type QqQueuedTurn = { kind: 'kick'; event?: string };
// 多账号 v2（Task 40-2b）：按账号隔离（大号=原键向后兼容；小号 qq-queued-turns--{id}）。
// 切换账号不再整页刷新 → 严禁模块常量固化：每次读写经 queuedTurnsKey() 现算，
// 换号后由 QQApp 根组件的账号切换监听调 qqQueueReload() 重读新账号队列。
export function queuedTurnsKey(): string {
  return accLs('qq-queued-turns', 'qq');
}

/** 读取并规范化排队表（兼容旧格式：contactId 字符串数组 = 纯消息补跑，无事件） */
export function readQqQueuedTurns(): Record<string, QqQueuedTurn[]> {
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

export const qqQueuedTurns = readQqQueuedTurns();

export function qqQueueWrite(): void {
  try {
    window.localStorage.setItem(queuedTurnsKey(), JSON.stringify(qqQueuedTurns));
  } catch {
    // localStorage 异常忽略：内存队列照常工作（仅刷新后丢该条补跑）
  }
}

/** 排队一条补跑回合（event = 系统事件文本，随补跑回合注入上下文；不带事件 = 普通消息补跑） */
export function qqQueueAdd(id: string, event?: string): void {
  const turn: QqQueuedTurn = event ? { kind: 'kick', event } : { kind: 'kick' };
  const list = qqQueuedTurns[id] ?? [];
  list.push(turn);
  qqQueuedTurns[id] = list;
  qqQueueWrite();
}

export function qqQueueDelete(id: string): void {
  if (!qqQueuedTurns[id]) return;
  delete qqQueuedTurns[id];
  qqQueueWrite();
}

/** 多账号 v2（Task 40-2b）：切换 QQ 账号后重读当前账号的排队表（模块缓存随账号显式刷新，不刷新网页） */
export function qqQueueReload(): void {
  for (const k of Object.keys(qqQueuedTurns)) delete qqQueuedTurns[k];
  Object.assign(qqQueuedTurns, readQqQueuedTurns());
}

export function loadMsgs(contactId: string): QQMsg[] {
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

export function saveMsgs(contactId: string, msgs: QQMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步；落盘防抖合并，同微信端）；旧 localStorage 键已由迁移器删除
  // 聊天记录不封顶（用户反馈：以前截 1000 条会挤丢旧聊天记录；kv 在 IndexedDB，纯文本容量可控）
  kvSetDebounced(lsMsgsKey(contactId), msgs);
}

// ---------------- 转发感知：目标会话的 AI 事件队列 ----------------

/** 转发消息落到目标会话时，同时给目标 AI 排一条「感知事件」；对方会话被打开时 drain 并触发一次 AI 回合，
 *  让被分享的 AI 知道收到了什么（与页面是否存活无关） */
export const lsAiEventsKey = (contactId: string) => `qq-ai-events:${contactId}`;

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
export const consumedQqAiEvents = new Map<string, number>();
export const keyOfQqAiEvent = (contactId: string, text: string) => `${contactId}\n${text}`;

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

// ---------------- 密友值 / 好友天数（好友标识页，按 QQ 规则增长） ----------------

/** 密友统计：since=成为好友的时间戳；points=密友值；day/todayGain=当日增量（QQ 每日有上限） */
export interface BondStat {
  since: number;
  points: number;
  day: string;
  todayGain: number;
}

/** QQ 规则：互发一条消息密友值 +2，每日通过聊天最多 +20 分 */
export const BOND_MSG_POINTS = 2;
export const BOND_DAILY_CAP = 20;
export const lsBondKey = (contactId: string) => `qq-bond:${contactId}`;

export function saveBondStat(contactId: string, s: BondStat): void {
  try {
    kvSet(lsBondKey(contactId), s);
  } catch {
    // 持久化失败忽略
  }
}

/** 读取密友统计；首次（或数据缺失）时从 0 开始建档（成为好友天数/密友值初始都是 0） */
export function loadBondStat(contactId: string): BondStat {
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
export function bondDays(s: BondStat): number {
  return Math.max(0, Math.floor((Date.now() - s.since) / 86_400_000));
}

/** 角色状态卡的好感锚定：QQ 密友值/好友天数一行提示（读取失败静默返回 null） */
export function bondHintTextOf(contactId: string): string | null {
  try {
    const s = loadBondStat(contactId);
    return `QQ密友值 ${s.points}，成为好友第 ${bondDays(s)} 天`;
  } catch {
    return null;
  }
}

/** 聊天互动增加密友值（+2/条，每日上限 20，当天隔天自动重置） */
export function addBondPoints(contactId: string, n: number): void {
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
export function compressImageFile(file: File, max = 1280): Promise<string> {
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
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 聊天时间分隔：HH:mm / 昨天 HH:mm / 星期X HH:mm / M月D日 HH:mm */
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

/** QQ 引用卡时间（对照截图）：今天 → HH:MM；昨天 → 昨天HH:MM；一周内 → 星期XHH:MM；更久 → M月D日HH:MM（跨年带年份） */
export function qqQuoteTime(ts: number): string {
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
export const AI_VOICE_DELIVERY_RULE =
  '（你的文字消息有时会以语音条的形式送达对方——这是正常的送达方式，不用在意；但不要在正文里说「我给你发条语音」这类话，也不要主动承诺发语音，用文字自然聊就好。）';

/** 联系人 AI 人设（QQ 聊天语境）：七要素结构化人设由全 App 共用模块组装，从联系人数据读取；
 *  特殊消息规则（红包/转账/亲属卡/位置/表情包标记）随表情包清单一起注入（表情包开关关闭时不下发表情包规则，
 *  并注入禁用 emoji/表情包的显式规则）；
 *  actionDescOn：动作描写开关（开启注入 *...* 格式约定、关闭注入显式禁令，见 @/lib/action-desc）；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况）；
 *  aiVoiceOn：AI 语音频率开关（100-e，开启时告知「文字消息可能以语音条送达」，见 AI_VOICE_DELIVERY_RULE） */
export function buildPersonaPrompt(peer: ContactRecord, me: QQUser, ownerName: string | null, stickers: Sticker[], stickersOn: boolean, actionDescOn: boolean, npcExtra?: NpcPromptExtra | null, aiVoiceOn?: boolean): string {
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


/**
 * QQ 会话纪元（四轮审计 M5/L9/H1 纵深防御）：purgeQqSessionData（换号清库）每次递增。
 * 模块层延迟回调（AI 来电 1.2s 定时器 / 通话尾巴延迟写 / 流分段投递闭包 / finalize 收尾）
 * 在调度时捕获纪元、执行时比对——不一致说明中间发生过换号，本次回调整体作废
 * （旧账号的来电/消息/通话尾巴不写进刚清空的新账号会话）。
 * （v1.9.27 任务10 拆分：声明收进 core，跨模块只读导入 live binding；写方一律走 bumpQqSessionEpoch()）
 */
export let qqSessionEpoch = 0;
/** 换号清库/换号事件统一递增纪元（跨模块不可直接给导入绑定赋值） */
export function bumpQqSessionEpoch(): void {
  qqSessionEpoch += 1;
}
