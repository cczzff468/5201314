/**
 * AI 发送特殊消息（红包 / 转账 / 亲属卡 / 位置 / 表情包 / 歌曲卡片）的标记约定与解析（微信 / QQ 共用）：
 *
 * - AI 在回复文本中按约定输出标记（如 [红包:8.88:恭喜发财]），落盘前由 parseRichParts 解析成
 *   对应类型的消息数据，渲染层复用各 App 已有的卡片气泡（与用户手动发送完全同款、同款交互），
 *   纯本地模拟，不涉及真实资金流转、不跳转第三方支付；
 * - 表情包标记 [表情包:ID] 从用户本地添加的表情包（wx-stickers / qq-stickers）里按 ID 匹配，
 *   每个表情有唯一 ID；AI 仿写用户格式的「[发送了表情：XX]」或把意思当成 ID 写进标记时，
 *   按「ID → 意思精确 → 意思包含」逐级兑底匹配，全部失败才回退显示文字；
 * - mergeRichSegments：回复条数连发时消息按「换行 / 句末标点」切分成多条，标记内部的标点
 *   （祝福语里的「！」等）会把一个标记切成两段——把含未闭合标记的段与后续段合并，保证解析成功；
 * - prettifyRichText：流式渲染期把完整标记换成简短占位文字（[红包]/[转账]/…）、截掉还没输出完的
 *   半截标记，避免原始标记文本在气泡里闪现（流结束落盘后即为真实卡片消息）；
 * - buildRichRules：追加到角色人设 system 提示词的约定规则（含当前可用的表情包 ID 清单）；
 * - AI 处理动作（用户发给 AI 的红包/转账/亲属卡）：extractRichActionParts 把回复按出现顺序切成
 *   「文字块 + 动作标记」交错片段，buildActionRules 在有待处理卡片时注入规则与清单；红包/转账/亲属卡
 *   标记缺金额时兜底默认金额，避免 AI 裸写 [红包] 变成干巴巴的文字。
 */

import type { Sticker } from './ios/stickers';
import { libPromptTextMulti } from '@/lib/prompt-entries';

// ---------------- 标记解析结果 ----------------

/** 红包标记：[红包:金额:祝福语]；群聊模式 [红包:总金额:个数:祝福语]（count 有值 = 群聊解析结果） */
export interface RichRedpacket {
  kind: 'redpacket';
  amount: number;
  blessing: string;
  /** 群聊模式：红包个数（默认 1；>1 时按拼手气发进群） */
  count?: number;
}
/** 转账标记：[转账:金额:备注]；群聊模式 [转账:对象:金额:备注]（target = 收款成员名字，由调用方按群成员解析） */
export interface RichTransfer {
  kind: 'transfer';
  amount: number;
  note: string;
  /** 群聊模式：标记里写的收款对象名字（未解析成群成员前） */
  target?: string;
}
/** 亲属卡标记：[亲属卡:每月额度:留言] */
export interface RichFamily {
  kind: 'family';
  monthlyLimit: number;
  message: string;
}
/** 位置标记：[位置:地点名:经纬度或地址] */
export interface RichLocation {
  kind: 'location';
  name: string;
  coords: string;
}
/** 表情包标记：[表情包:表情ID]（parseRichParts 保证 ID 在 stickers 里能找到） */
export interface RichSticker {
  kind: 'sticker';
  stickerId: string;
}
/**
 * 歌曲卡片标记（音乐 App × AI 深度互动）：
 * - [分享歌曲:歌名:歌手:分享语] → 聊天里的歌曲卡片（封面/歌名/歌手/分享语，点击直接播放）；
 * - [放歌:歌名:歌手] → 播放指令（Task 100-a 起教学统一归音乐遥控块：music-remote 在微信/QQ 私聊注入，
 *   指令写在回复末尾、系统执行并从气泡里剔除；本库只保留解析兼容，buildRichRules 不再教学该标记）；
 * - [邀请一起听:歌名:歌手] → 聊天里落歌曲卡片 + 全局弹出「一起听」邀请卡（接受后进音乐 App）。
 * 封面/曲库匹配由渲染层按歌名+歌手异步搜索兑底（见 song-msg-bubble）。
 */
export interface RichSong {
  kind: 'song';
  name: string;
  artist: string;
  /** 分享语（AI 在卡片上说的推荐语） */
  note?: string;
  /** AI 点播：卡片投递后自动开始播放 */
  autoPlay?: boolean;
  /** 邀请一起听：落卡片同时触发全局邀请卡 */
  invite?: boolean;
}

export type RichMsg = RichRedpacket | RichTransfer | RichFamily | RichLocation | RichSticker | RichSong;

/** 一段回复的解析结果：普通文字 或 富消息标记 */
export type RichPart = { type: 'text'; text: string } | { type: 'rich'; rich: RichMsg };

// ---------------- AI 处理动作标记（领取/退回/拒收对方发的红包、转账、亲属卡） ----------------

/**
 * AI 对「对方发来的待处理卡片」的处理动作，通过回复里的标记触发（用户发红包后 AI 可以
 * 领取 / 退回 / 拒收，转账、亲属卡同理）：
 * - [领取红包:红包ID] / [退回红包:红包ID] / [拒收红包:红包ID]
 * - [收款转账:转账ID] / [退回转账:转账ID] / [拒收转账:转账ID]
 * - [收下亲属卡:亲属卡ID] / [拒收亲属卡:亲属卡ID]
 * 另有双向拉黑类动作（仅单聊由 block-state 应用；群聊/未知语境下由调用方忽略）：
 * - [拉黑]：角色拉黑用户
 * - [解除拉黑]：角色解除对用户的拉黑
 * - [申请解除拉黑:理由]：角色申请让用户解除对自己的拉黑（理由原样透传，做成请求卡片）
 * - 40-a 用户申请的决策标记：角色对「用户发来的解除拉黑申请」表态——
 *   [同意解除拉黑] / [拒绝解除拉黑]（仅在本 App 有 pending 用户申请时生效）
 * 标记只负责改变卡片状态（通知行由系统生成），不带感谢语/理由——道谢、吐槽、退回/拒收的
 * 原因等所有想说的话都由 AI 按人设用正文正常说。动作标记不是消息：落盘前由
 * extractRichActionParts 按出现顺序提取（保证通知行落盘在流式时的真实位置，而不是永远堆在
 * 正文前），标记本身不会出现在聊天记录里。
 */
export type RichActionKind =
  | 'claim-redpacket'
  | 'return-redpacket'
  | 'reject-redpacket'
  | 'accept-transfer'
  | 'return-transfer'
  | 'reject-transfer'
  | 'claim-family'
  | 'reject-family'
  // 收下礼物卡（第七轮反馈）：机主以礼物卡送来的宝贝，AI 凭 [收下礼物卡:礼物ID] 收下
  // （卡片置已收下 + 聊天通知行「XX收下了你的礼物」）；礼物没有退回/拒收语义，只有收下
  | 'gift-accept'
  | 'block-user'
  | 'unblock-user'
  | 'request-unblock'
  // 40-a：角色对「用户发来的解除拉黑申请」的决策（同意=解除 byChar；拒绝=计数+1）
  | 'approve-user-unblock'
  | 'deny-user-unblock'
  // 群管理动作（AI 是群主/管理员；targetId = 成员名字或新群名/公告内容，arg = 禁言时长文本）
  | 'mute-member'
  | 'unmute-member'
  | 'kick-member'
  | 'rename-group'
  | 'announce-group'
  // 群社交动作（AI 主动建群/拉人；targetId = 群名或成员名字，arg = 建群成员名单）
  | 'create-group'
  | 'invite-to-group'
  | 'invite-member'
  | 'promote-admin'
  // 退群挽留动作（用户退群后的私聊里，群主/管理员把人拉回来）
  | 'reinvite-user'
  | 'grant-admin'
  | 'grant-owner'
  | 'abandon-invite'
  // 视觉自主决策动作（AI 看用户发图后可自主换头像/换朋友圈背景/存相册；
  // 相册非空时可从相册选图设头像/背景/发聊天；targetId = 图片消息 ID 或相册条目 ID）
  | 'change-avatar'
  | 'change-moments-bg'
  | 'save-to-album'
  | 'pick-album-avatar'
  | 'pick-album-bg'
  | 'pick-album-send'
  // AI 主动换头像（第二十九轮）：根据人设/记忆/心情自主想换新头像时输出 [生成新头像:外观描述]，
  // 执行器按人设锁脸生成新照片并设为 AI 头像（targetId = 外观描述全文）
  | 'gen-avatar'
  // 美团外卖/代付联动（mt-ai-engage 执行器）：AI 为机主代付/帮付/代点外卖/给自己点外卖/请客点外卖
  | 'mt-proxy-pay'
  | 'mt-pay-for'
  | 'mt-order-draft'
  | 'mt-order-self'
  | 'mt-order-treat'
  // 淘宝购物/代付/取件联动（tb-ai-engage 执行器）：AI 主动帮付机主待付订单/代买草稿/自己买请机主代付/帮取快递/
  // 收礼物确认（AI 结合上下文自主判断「机主说的是送我的礼物」后才输出，防「买给你妹妹」误伤）；
  // tb-proxy-pay = AI 支付机主发来的淘宝代付请求（[代付淘宝:请求id]，与美团 [代付:pid] 动词区分防串台）；
  // tb-buy-ticket = AI 按人设自主帮机主买演出票（[帮你买票:演出id]，喜剧脱口秀/演唱会）；
  // tb-gift-send = AI 自己买淘宝商品以礼物卡直接送给机主（[送礼物:商品id]，仅微信端落地）
  | 'tb-pay-for'
  | 'tb-order-draft'
  | 'tb-order-self'
  | 'tb-pickup'
  | 'tb-gift'
  | 'tb-proxy-pay'
  | 'tb-buy-ticket'
  | 'tb-gift-send'
  // AI 发朋友圈/空间说说（聊天页执行器直调 moments.addCharMomentPost 真实发布）：
  // targetId = 动态正文全文（用户要求「你去发个朋友圈」或 AI 自主想分享时输出）
  | 'post-moment'
  // AI 引用回复（Task 30）：targetId = 聊天记录里的消息短编号（[M数字]，由各 App 注入历史时标注）；
  // 执行器把编号反查出的源消息变成引用块挂到紧接着的正文消息上
  | 'quote'
  // AI 拍一拍（Task 30）：targetId = AI 自己想的拍一拍文案（可空 = 无文案）；
  // 执行器产出「「角色名」拍了拍你+文案」系统提示行
  | 'pat'
  // Shizuku 真实手机操作（v1.3）：[手机操作:命令:参数]——AI 动手/看见能力；
  // targetId = 冒号后的完整参数段（如「点按:540:1200」），由 shizuku-autonomy.executePhoneOp
  // 解析分发；逐项开关 gate 在该模块（设置 APP → AI 动手），关闭时教学不注入+执行硬拦
  | 'phone-op';

/** 拉黑类动作（targetId 语义不同：request-unblock 的 targetId = 申请理由全文，其余为空） */
export const BLOCK_ACTION_KINDS: ReadonlySet<RichActionKind> = new Set([
  'block-user',
  'unblock-user',
  'request-unblock',
  'approve-user-unblock',
  'deny-user-unblock',
]);

export interface RichAction {
  kind: RichActionKind;
  /** 目标卡片 ID（用户发卡时生成的短 ID，如 rp-x7k2；兼容直接用消息 id 匹配）。
   *  管理动作 = 目标成员名字 / 新群名 / 公告内容；无参动作（拉回群聊等）为空串。 */
  targetId: string;
  /** 禁言时长文本（mute-member 专用，如「1 小时」「永久」；空 = 调用方兑底） */
  arg?: string;
  /** #81：解析时记录的警告文本（如多人禁言「已忽略多余成员」），调用方可选择 toast 提示。
   *  不影响动作执行本身，仅作人机反馈，缺失则忽略不显示 */
  warn?: string;
}

/** 群管理动作（群聊页执行器负责权限校验与落盘；grant-owner = 群主 AI 转让群主给指定成员） */
export function isGroupAdminAction(action: RichAction): boolean {
  return (
    action.kind === 'mute-member' ||
    action.kind === 'unmute-member' ||
    action.kind === 'kick-member' ||
    action.kind === 'rename-group' ||
    action.kind === 'announce-group' ||
    action.kind === 'grant-owner'
  );
}

/**
 * 群社交动作（AI 主动建群/拉人）：
 * - create-group / invite-to-group 在私聊执行（群聊卡片 → 用户接受/拒绝）；
 * - invite-member / promote-admin 在群聊执行（群主/管理员权限行为）；
 * 权限/冷却/拒绝表在 group-social 执行器硬校验，越权标记一律丢弃。
 */
export function isGroupSocialAction(action: RichAction): boolean {
  return (
    action.kind === 'create-group' ||
    action.kind === 'invite-to-group' ||
    action.kind === 'invite-member' ||
    action.kind === 'promote-admin'
  );
}

/** 群聊页执行的群社交动作（拉人进群/设管理员；与群管理动作同一执行器分流） */
export function isGroupChatSocialAction(action: RichAction): boolean {
  return action.kind === 'invite-member' || action.kind === 'promote-admin';
}

/** 退群挽留动作（私聊侧 quit-flow 执行器负责） */
export function isQuitWinbackAction(action: RichAction): boolean {
  return (
    action.kind === 'reinvite-user' ||
    action.kind === 'grant-admin' ||
    action.kind === 'grant-owner' ||
    action.kind === 'abandon-invite'
  );
}

const ACTION_LABELS: Record<string, RichActionKind> = {
  领取红包: 'claim-redpacket',
  退回红包: 'return-redpacket',
  拒收红包: 'reject-redpacket',
  收款转账: 'accept-transfer',
  退回转账: 'return-transfer',
  拒收转账: 'reject-transfer',
  收下亲属卡: 'claim-family',
  拒收亲属卡: 'reject-family',
  // 收下礼物卡（长词在前防被「收礼物/收下礼物」抢先匹配——那两个是淘宝分享收礼物确认，语义不同）
  收下礼物卡: 'gift-accept',
  // 拉黑类动作（长词在前避免被短词抢先匹配；40-a 决策标记与既有申请标记互不冲突——首字不同）
  同意解除拉黑: 'approve-user-unblock',
  拒绝解除拉黑: 'deny-user-unblock',
  申请解除拉黑: 'request-unblock',
  解除拉黑: 'unblock-user',
  拉黑: 'block-user',
  // 群管理动作（含常见变体写法）
  禁言: 'mute-member',
  解禁: 'unmute-member',
  取消禁言: 'unmute-member',
  移出群聊: 'kick-member',
  踢出群聊: 'kick-member',
  移出: 'kick-member',
  踢出: 'kick-member',
  改群名: 'rename-group',
  修改群名: 'rename-group',
  改公告: 'announce-group',
  修改公告: 'announce-group',
  更新公告: 'announce-group',
  // 群社交动作（建群/拉人；长词在前避免被短词抢先匹配）
  创建群聊: 'create-group',
  建群: 'create-group',
  邀请进群: 'invite-to-group',
  拉进群: 'invite-to-group',
  邀请: 'invite-member',
  拉人进群: 'invite-member',
  任命管理员: 'promote-admin',
  设管理员: 'promote-admin',
  // 退群挽留动作
  拉回群聊: 'reinvite-user',
  设为管理员: 'grant-admin',
  转让群主: 'grant-owner',
  放弃邀请: 'abandon-invite',
  // 视觉自主决策动作（长词在前避免被短词抢先匹配；新词之间互不为子串，但按从长到短排列）
  生成新头像: 'gen-avatar',
  换朋友圈背景: 'change-moments-bg',
  选图设头像: 'pick-album-avatar',
  选图设背景: 'pick-album-bg',
  选图发送: 'pick-album-send',
  换头像: 'change-avatar',
  存相册: 'save-to-album',
  // 美团外卖/代付联动动作（mt-ai-engage；长词在前）
  帮点外卖: 'mt-order-draft',
  给我点外卖: 'mt-order-draft',
  请客点外卖: 'mt-order-treat',
  请你吃外卖: 'mt-order-treat',
  我请你吃: 'mt-order-treat',
  自己点外卖: 'mt-order-self',
  给TA点外卖: 'mt-order-self',
  帮我代付: 'mt-proxy-pay',
  代付: 'mt-proxy-pay',
  帮付: 'mt-pay-for',
  // 淘宝购物/代付/取件联动动作（tb-ai-engage；长词在前避免被短词抢先匹配）
  帮我取快递: 'tb-pickup',
  帮你取快递: 'tb-pickup',
  帮忙取件: 'tb-pickup',
  帮取快递: 'tb-pickup',
  收礼物: 'tb-gift',
  收下礼物: 'tb-gift',
  帮付淘宝: 'tb-pay-for',
  帮你付淘宝: 'tb-pay-for',
  // 淘宝代付请求支付动作（AI 支付机主发来的代付请求；长词在前避免被短词抢先匹配）
  代付淘宝订单: 'tb-proxy-pay',
  代付淘宝: 'tb-proxy-pay',
  帮你买演出票: 'tb-buy-ticket',
  帮你买票: 'tb-buy-ticket',
  帮买票: 'tb-buy-ticket',
  帮你买: 'tb-order-draft',
  帮TA买: 'tb-order-draft',
  帮你下单: 'tb-order-draft',
  自己买: 'tb-order-self',
  给我也买: 'tb-order-self',
  // AI 送礼物（第 21 轮，[送礼物:商品id]；长词在前防被「送你」类短词干扰）
  送礼物: 'tb-gift-send',
  买礼物送你: 'tb-gift-send',
  买个礼物送你: 'tb-gift-send',
  送你个礼物: 'tb-gift-send',
  // AI 发朋友圈/空间说说动作（长词在前；三种叫法同义，执行器按所在 App 决定发布到哪个平台）
  发朋友圈: 'post-moment',
  发说说: 'post-moment',
  发动态: 'post-moment',
  // AI 引用回复 + 拍一拍（Task 30；「拍了拍」变体写法同样认）
  引用: 'quote',
  拍一拍: 'pat',
  拍了拍: 'pat',
  // Shizuku 真实手机操作（v1.3；参数为「命令:参数…」整段，由 executePhoneOp 再解析）
  手机操作: 'phone-op',
};

const ACTION_RE = /\[(领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|收下礼物卡|同意解除拉黑|拒绝解除拉黑|申请解除拉黑|解除拉黑|拉黑|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|帮点外卖|给我点外卖|请客点外卖|请你吃外卖|我请你吃|自己点外卖|给TA点外卖|买个礼物送你|送你个礼物|代付淘宝订单|代付淘宝|帮我代付|代付|帮付|帮我取快递|帮你取快递|帮忙取件|帮取快递|帮付淘宝|帮你付淘宝|帮你买演出票|帮你买票|帮买票|帮你买|帮TA买|帮你下单|自己买|给我也买|送礼物|收礼物|收下礼物|生成新头像|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|发朋友圈|发说说|发动态|引用|拍一拍|拍了拍|手机操作)(?:[:：]([^\][]*))?\]/g;
/** 段尾未闭合的动作标记（切分边界切碎时与后续段合并） */
export const ACTION_TAIL_RE = /\[(?:领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|收下礼物卡|同意解除拉黑|拒绝解除拉黑|申请解除拉黑|解除拉黑|拉黑|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|帮点外卖|给我点外卖|请客点外卖|请你吃外卖|我请你吃|自己点外卖|给TA点外卖|买个礼物送你|送你个礼物|代付淘宝订单|代付淘宝|帮我代付|代付|帮付|帮我取快递|帮你取快递|帮忙取件|帮取快递|帮付淘宝|帮你付淘宝|帮你买演出票|帮你买票|帮买票|帮你买|帮TA买|帮你下单|自己买|给我也买|送礼物|收礼物|收下礼物|生成新头像|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|发朋友圈|发说说|发动态|引用|拍一拍|拍了拍|手机操作)(?:[:：][^\][]*)?$/;

/** 回复按出现顺序切开的片段：普通文字块 或 处理动作（两者交错，保持流式输出顺序） */
export type RichActionPart = { type: 'text'; text: string } | { type: 'action'; action: RichAction };

/**
 * 把 AI 回复按出现顺序切成「文字块 + 处理动作」交错片段：
 * 动作标记前后的文字各自成块（保持原样，调用方再逐块切分/解析），段尾未闭合的半截动作标记截掉。
 * 这样调用方能按流式输出顺序落盘——正文先出现的先落盘，通知行跟随其后的动作位置，
 * 而不是把通知行永远堆在正文前面（否则与流式期间用户看到的顺序相反）。
 * 兼容旧写法：标记里多写的第三段（曾经的感谢语/理由）直接丢弃，不再转成消息。
 * 裸门牌号容错（v56 恢复：用户要求「让 AI 学会引用」）：模型想引用时常把 [引用:M9] 写成裸 [M9]
 * （照抄历史行首门牌号的样子），此前被防模仿层整条剥掉——引用意图凭空丢失。现在消息边界处
 * （开头/换行后/&&& 分隔后）的裸 [M数字] 视为引用意图，自动补全成 [引用:M数字] 走正常解析；
 * 句中间的裸编号不动，仍留给下游 stripMsgHandleText 剥除（那更像误抄而非引用）。
 * 防刷屏由各端解析层的引用冷却闸（quoteCoolMs）兑底——模型连着写多个引用标记时只放行第一个。
 */
export function extractRichActionParts(text: string): RichActionPart[] {
  const normalized =
    /\[\s*M\s*\d{1,5}\s*\]/.test(text)
      ? text.replace(/(^|\n|&{3,})\s*\[\s*M\s*(\d{1,5})\s*\]/g, (_all, br: string, num: string) => `${br}[引用:M${num}]`)
      : text;
  const parts: RichActionPart[] = [];
  let last = 0;
  for (const m of normalized.matchAll(ACTION_RE)) {
    const before = normalized.slice(last, m.index);
    if (before.trim()) parts.push({ type: 'text', text: before });
    const raw = (m[2] ?? '').trim();
    const kind = ACTION_LABELS[m[1]];
    if (BLOCK_ACTION_KINDS.has(kind)) {
      // 拉黑类动作没有目标 ID；申请解除拉黑的 targetId = 申请理由全文（不按冒号截断）
      parts.push({ type: 'action', action: { kind, targetId: kind === 'request-unblock' ? raw : '' } });
    } else if (kind === 'mute-member') {
      // [禁言:成员:时长]：名字取第一段，时长取剩余整段（兼容写法丢时长由执行器兑底）
      // #81：AI 误写多人 [禁言:张三:李四:1小时] 时只禁言张三、李四被静默丢弃——解析时检测 segs[1]
      // 不是合法时长（含第二个看起来像人名的字段）则截断并记录 warn，调用方可 toast 提示
      const segs = raw.split(/[:：]/);
      const name = (segs[0] ?? '').trim();
      // 时长判定：合法时长需含数字 + 单位（小时/分钟/天/小时/分/秒/永久/infinite）或「永久/infinite」
      const DURATION_RE = /^\s*(?:\d+\s*(?:小时|分钟|分|秒|天|周|个月|月)|永久|infinite|∞)\s*$/i;
      const extraNames: string[] = [];
      let durationSeg = segs.slice(1).join(':').trim();
      if (segs.length >= 3) {
        // 逐段判断：第二段起若不像时长则当作误填的人名收集
        const collected: string[] = [];
        for (let i = 1; i < segs.length; i++) {
          const s = segs[i].trim();
          if (!s) continue;
          if (DURATION_RE.test(s)) {
            // 看起来是时长，剩余段统一作为 duration（保留原口径）
            durationSeg = segs.slice(i).join(':').trim();
            break;
          }
          collected.push(s);
        }
        if (collected.length > 0) extraNames.push(...collected);
      }
      if (name) {
        parts.push({
          type: 'action',
          action: {
            kind,
            targetId: name,
            arg: durationSeg || undefined,
            warn: extraNames.length > 0 ? `单次只能禁言一名成员，已忽略多余成员：${extraNames.join('、')}` : undefined,
          },
        });
      }
    } else if (kind === 'unmute-member' || kind === 'kick-member' || kind === 'rename-group' || kind === 'announce-group') {
      // [解禁/移出群聊/改群名/改公告:内容]：内容整段保留（公告/群名里可能出现冒号）
      if (raw) parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'reinvite-user' || kind === 'grant-admin' || kind === 'grant-owner' || kind === 'abandon-invite') {
      // 无参动作（AI 手滑在标记里写了说明文字也容忍：执行器不读 targetId）
      parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'create-group') {
      // [建群:群名:成员1,成员2,…]：群名取第一段，成员名单取剩余整段（成员可省略 = 只拉机主）
      const segs = raw.split(/[:：]/);
      const name = (segs[0] ?? '').trim();
      if (name) parts.push({ type: 'action', action: { kind, targetId: name, arg: segs.slice(1).join(':').trim() || undefined } });
    } else if (kind === 'change-avatar' || kind === 'change-moments-bg' || kind === 'save-to-album') {
      // [换头像:图片消息ID] / [换朋友圈背景:图片消息ID] / [存相册:图片消息ID]
      // targetId = body 第一段（图片消息 ID，必须原样抄自最近用户发来的图片消息）；
      // 空 body 时 targetId 留空，执行器兜底取当回合最后一张图
      const targetId = raw.split(/[:：]/)[0].trim();
      parts.push({ type: 'action', action: { kind, targetId } });
    } else if (kind === 'mt-proxy-pay' || kind === 'mt-pay-for' || kind === 'mt-order-draft' || kind === 'mt-order-self' || kind === 'mt-order-treat') {
      // 美团联动动作：body 整段保留（商家|菜品串里可能出现冒号/逗号，不能按冒号截断；
      // [代付:pid]/[帮付:订单id] 同样整段透传，执行器自行校验）
      if (raw) parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'tb-proxy-pay' || kind === 'tb-buy-ticket') {
      // 淘宝联动动作：body 整段保留（[代付淘宝:请求id]/[帮你买票:演出id]，执行器自行校验 id）
      if (raw) parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'post-moment') {
      // [发朋友圈:正文]/[发说说:正文]：正文整段保留（正文里可能出现冒号/标点，不能按冒号截断）；
      // 空正文丢弃（发了等于没发，不如不发）
      if (raw) parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'pick-album-avatar' || kind === 'pick-album-bg' || kind === 'pick-album-send') {
      // [选图设头像:相册条目ID] / [选图设背景:相册条目ID] / [选图发送:相册条目ID]
      // targetId = body 第一段（相册条目 ID，必须原样抄自【相册清单】）；空 body 丢弃（不允许选不存在的图）
      const targetId = raw.split(/[:：]/)[0].trim();
      if (targetId) parts.push({ type: 'action', action: { kind, targetId } });
    } else if (kind === 'quote') {
      // [引用:消息编号]（Task 30 AI 引用回复）：编号 = 聊天记录里每条消息开头的 [M数字] 短编号
      // targetId 取 body 第一段（编号里不会有冒号）；空编号丢弃（没得引用等于没写）
      const targetId = raw.split(/[:：]/)[0].trim();
      if (targetId) parts.push({ type: 'action', action: { kind, targetId } });
    } else if (kind === 'pat') {
      // [拍一拍:文案] / [拍一拍] / [拍了拍:文案]（Task 30 AI 拍一拍）：文案整段保留
      // （后缀里可能出现冒号/标点，不能按冒号截断）；无文案也认（targetId 空串 = 纯拍一拍）
      parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else if (kind === 'phone-op') {
      // [手机操作:命令:参数…]（v1.3 Shizuku 自主权）：参数整段保留（命令与参数由
      // shizuku-autonomy.executePhoneOp 再解析；参数里可能出现冒号/坐标/包名，不能截断）；
      // 空 body 丢弃（[手机操作] 没写命令等于没写标记）
      if (raw) parts.push({ type: 'action', action: { kind, targetId: raw } });
    } else {
      // 卡片处理动作：targetId 取第一段；第三段及以后（旧版感谢语/理由）直接丢弃：回应内容由 AI 人设正文承担
      const targetId = raw.split(/[:：]/)[0].trim();
      if (targetId) parts.push({ type: 'action', action: { kind, targetId } });
    }
    last = m.index + m[0].length;
  }
  const tail = normalized.slice(last).replace(ACTION_TAIL_RE, '');
  if (tail.trim()) parts.push({ type: 'text', text: tail });
  return parts;
}

// ---------------- AI 动作的应用结果（各 App 按自己的消息结构落地） ----------------

/** 动作是否合法（调用方校验目标卡片状态为待处理后应用；本函数只做动作→展示语义归类） */
export function actionVerb(kind: RichActionKind): 'claim' | 'return' | 'reject' {
  if (kind === 'claim-redpacket' || kind === 'accept-transfer' || kind === 'claim-family' || kind === 'gift-accept') return 'claim';
  if (kind === 'return-redpacket' || kind === 'return-transfer') return 'return';
  return 'reject';
}

// ---------------- 标记正则 ----------------

/** 完整标记（中英文冒号兼容；内容里不允许出现「]」）；分享歌曲/放歌/邀请一起听 = 音乐卡片标记 */
const RICH_RE = /\[(红包|转账|亲属卡|位置|表情包|分享歌曲|放歌|邀请一起听)(?:[:：]([^\][]*))?\]/g;
/** 段尾未闭合的半截标记（AI 还在逐字输出 / 被切分边界切开；含表情包变体、处理动作、群管理与挽留标记） */
const OPEN_TAIL_RE = /\[(?:红包|转账|亲属卡|位置|表情包|分享歌曲|放歌|邀请一起听|发送了表情包|发送了表情|发送表情包|发送表情|表情|领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|收下礼物卡|同意解除拉黑|拒绝解除拉黑|申请解除拉黑|解除拉黑|拉黑|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|引用|拍一拍|拍了拍|手机操作)(?:[:：][^\][]*)?$/;
const OPEN_TAIL_FULL_RE = /\u3010(?:红包|转账|亲属卡|位置|表情包|分享歌曲|放歌|邀请一起听|发送了表情包|发送了表情|发送表情包|发送表情|表情|领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|收下礼物卡|同意解除拉黑|拒绝解除拉黑|申请解除拉黑|解除拉黑|拉黑|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|引用|拍一拍|拍了拍|手机操作)(?:[:：][^\u3010\u3011]*)?$/;
/**
 * AI 仿写用户记录格式的表情标记变体（聊天历史里用户表情以「[发送了表情：意思]」进入上下文，
 * AI 经常照葫芦画瓢输出同款格式，或把意思当 ID 写成 [表情:XX]）——这些变体在普通文字段里
 * 二次扫描，按意思匹配到本地表情包就转成表情消息，匹配不到保留原文。
 */
const STICKER_LOOSE_RE = /[【\[]\s*(?:发送了表情包|发送了表情|发送表情包|发送表情|表情包|表情)\s*[:：]\s*([^\]】]{1,40})\s*[】\]]/g;

/**
 * AI 仿写账单摘要格式发转账（第十五轮修复）——聊天历史里转账消息以「[转账 ¥200 "备注"，待收款]」
 * 式账单摘要进入上下文，AI 被要求转账时经常照葫芦画瓢写成
 * 「[转账 ID:mv8s8jkl-zmnc9q4 ¥100.00 "给你零花钱，别省着花"]」这类幻觉格式，导致转账以干巴巴的文字气泡上屏。
 * 这些变体在普通文字段里二次扫描：金额必填（带 ¥/￥ 号才认），匹配到就转成真正的转账卡片；
 * 标准格式 [转账:金额:备注] 由 RICH_RE 优先处理，此正则带 (?![::：]) 防重入。
 */
const TRANSFER_LOOSE_RE = /[【\[]\s*转账\s*(?![::：])[^】\]]*?[¥￥]\s*(\d+(?:\.\d+)?)\s*元?[^】\]]*?(?:["“「『]\s*([^"”」』】\]]{1,40}?)\s*["”」』])?[^】\]]*[】\]]/g;

function parseAmount(v: string | undefined): number {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}

/**
 * AI 发钱硬上限（解析层强制；与提示词纪律一致，双保险）——
 * 红包 ≤200（与用户发红包同一上限）；转账 ≤2000；亲属卡月额度 ≤1000。
 * AI 写出再大的金额也按上限出卡，防止一句 [转账:9999999] 刷爆零钱。
 */
export const AI_AMOUNT_CAP: Record<'redpacket' | 'transfer' | 'family', number> = {
  redpacket: 200,
  transfer: 2000,
  family: 1000,
};

/** 金额上限收敛（超限不报错不拒发，静默按上限出卡） */
function capAmount(v: number, cap: number): number {
  return Math.min(v, cap);
}

/**
 * 气泡文本首尾清洗：剥掉首尾的空白与「看不见的占位字符」（零宽空格 U+200B-200F、
 * 词连接符 U+2060、盲文空格 U+2800、韩文填充符 U+3164/U+FFA0 等——模型偶尔会输出，
 * String.trim 不认识它们，残留在气泡开头就是一条「前面有空隙」的消息）。
 * 持久化与渲染两处都过一遍：渲染层过一遍还能修复已落盘的存量脏数据。
 */
const BLANK_CHARS = '\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0';

/**
 * v54：剥掉 AI 裸抄的「（引用 名字：「内容」）」历史存档前缀（防模仿层兑底）。
 * 背景：三端聊天上下文里带引用的消息都以该前缀序列化（用户长按引用发送的消息同样带），
 * 模型偶发照抄这个格式写进自己的回复——像真引用了对方的话，实际落在气泡里就是一段脏文本
 * （用户实测：连发多条时每条开头都挂着「（引用 凡凡：「mua」）」）。
 * 剥除在两处生效：落盘前（stripMsgHandleText 已并入，微信/QQ 构建链路）与渲染层
 * （cleanBubbleText 已并入，顺带修复已落盘的存量脏数据）。信息端渲染层另接同款。
 * 注意 replace 不带 g 标志时不替换多处，这里必须全局替换（模型偶发连写两个前缀）。
 */
export function stripLiteralQuotePrefix(text: string): string {
  return text.replace(/（引用\s*[^（）：:\n「」]{1,24}：「[^」]{0,200}」）\s*/g, '');
}

export function cleanBubbleText(text: string): string {
  // v54：先剥 AI 裸抄的「（引用 …）」存档前缀（渲染层顺带修复存量脏数据），再做首尾清洗
  const stripped = stripLiteralQuotePrefix(text);
  const head = new RegExp(`^[\\s${BLANK_CHARS}]+`);
  const tail = new RegExp(`[\\s${BLANK_CHARS}]+$`);
  return stripped.replace(head, '').replace(tail, '');
}

/**
 * 剥掉 AI 正文里裸抄的 [M数字] 消息门牌号（Task 30 引用编号防模仿）：
 * 提示词虽已明令禁止，模型偶尔仍会把历史行首的编号原样写进回复（如「[M12] 我在学习呢」）——
 * 门牌号只是系统标注，出现在气泡里就是脏文本，落盘前统一剥除（引用请走 [引用:编号] 完整标记）。
 * v54：同层并入「（引用 名字：「内容」）」字面存档前缀的剥除（见 stripLiteralQuotePrefix）。
 */
export function stripMsgHandleText(text: string): string {
  return stripLiteralQuotePrefix(text.replace(/\[\s*M\s*\d{1,5}\s*\]/g, ' '));
}

/** AI 发红包/转账/亲属卡但没写金额（或金额非法）时的兑底：照样出卡片，不让标记变成干巴巴的文字 */
function fallbackAmount(kind: 'redpacket' | 'transfer' | 'family'): number {
  const [min, max] = kind === 'redpacket' ? [0.88, 20] : kind === 'transfer' ? [8, 88] : [520, 520];
  const n = min === max ? min : min + Math.random() * (max - min);
  return Math.max(0.01, Math.round(n * 100) / 100);
}

/**
 * 表情包三级匹配：ID 精确 → 意思精确 → 意思互相包含。
 * AI 有时输出 ID、有时把「意思」当 ID 输出（甚至仿写用户的 [发送了表情：意思]），都能对上号。
 */
function resolveSticker(token: string, stickers: Sticker[]): Sticker | null {
  const t = token.trim();
  if (!t || stickers.length === 0) return null;
  return (
    stickers.find((s) => s.id === t) ??
    stickers.find((s) => s.meaning && s.meaning === t) ??
    stickers.find((s) => s.meaning && (s.meaning.includes(t) || t.includes(s.meaning))) ??
    null
  );
}

/** 解析单个标记 → 富消息数据；金额非法 / 名称缺失等格式错误时返回 null（调用方回退为文本显示）。
 *  group=true 时按群聊格式解析：红包 [红包:总金额:个数:祝福语]（个数段非数字时兼容单聊写法 [红包:金额:祝福语]），
 *  转账 [转账:对象:金额:备注]（对象 = 群里成员名字，缺失时返回 null 让标记回退文字——群转账没有收款人就不成立）。 */
function parseMarker(kind: string, inner: string, stickers: Sticker[] | null, group = false): RichMsg | null {
  const segs = inner.split(/[:：]/);
  switch (kind) {
    case '红包': {
      // 金额缺失/非法时兑底随机金额：AI 常写成裸的 [红包]，照文字显示会让「AI 发红包」看起来失效；超上限按上限出卡
      const amount = capAmount(
        Number.isFinite(parseAmount(segs[0])) ? parseAmount(segs[0]) : fallbackAmount('redpacket'),
        AI_AMOUNT_CAP.redpacket,
      );
      if (group) {
        const cntRaw = (segs[1] ?? '').trim();
        const cnt = Number(cntRaw);
        if (cntRaw !== '' && Number.isFinite(cnt) && cnt >= 1) {
          // 群聊格式：[红包:总金额:个数:祝福语]
          const count = Math.min(100, Math.max(1, Math.round(cnt)));
          return { kind: 'redpacket', amount, count, blessing: segs.slice(2).join(':').trim() || '恭喜发财，大吉大利' };
        }
        // 兼容单聊写法 [红包:金额:祝福语]：个数为 1，后段全部当祝福语
        return { kind: 'redpacket', amount, count: 1, blessing: segs.slice(1).join(':').trim() || '恭喜发财，大吉大利' };
      }
      return { kind: 'redpacket', amount, blessing: segs.slice(1).join(':').trim() || '恭喜发财，大吉大利' };
    }
    case '转账': {
      if (group) {
        // 群聊格式：[转账:对象:金额:备注]——对象必须是群成员名字（调用方解析），写不出对象就不成卡
        const target = (segs[0] ?? '').trim();
        if (!target) return null;
        const amount = capAmount(
          Number.isFinite(parseAmount(segs[1])) ? parseAmount(segs[1]) : fallbackAmount('transfer'),
          AI_AMOUNT_CAP.transfer,
        );
        return { kind: 'transfer', amount, note: segs.slice(2).join(':').trim(), target };
      }
      const amount = capAmount(
        Number.isFinite(parseAmount(segs[0])) ? parseAmount(segs[0]) : fallbackAmount('transfer'),
        AI_AMOUNT_CAP.transfer,
      );
      return { kind: 'transfer', amount, note: segs.slice(1).join(':').trim() };
    }
    case '亲属卡': {
      const monthlyLimit = capAmount(
        Number.isFinite(parseAmount(segs[0])) ? parseAmount(segs[0]) : fallbackAmount('family'),
        AI_AMOUNT_CAP.family,
      );
      return { kind: 'family', monthlyLimit, message: segs.slice(1).join(':').trim() };
    }
    case '位置': {
      const name = (segs[0] ?? '').trim();
      if (!name) return null;
      return { kind: 'location', name, coords: segs.slice(1).join(':').trim() };
    }
    case '表情包': {
      const token = inner.trim();
      const s = resolveSticker(token, stickers ?? []);
      return s ? { kind: 'sticker', stickerId: s.id } : null;
    }
    // 歌曲卡片三兄弟（音乐 App × AI）：歌名必填，歌手可缺（渲染层搜索兑底）；
    // 分享语里的冒号不切断（slice().join 拼回），歌名/歌手里写「]」会使标记解析失败回退文本——规则已要求避免
    case '分享歌曲': {
      const name = (segs[0] ?? '').trim();
      if (!name) return null;
      return { kind: 'song', name, artist: (segs[1] ?? '').trim(), note: segs.slice(2).join(':').trim() };
    }
    case '放歌': {
      const name = (segs[0] ?? '').trim();
      if (!name) return null;
      return { kind: 'song', name, artist: segs.slice(1).join(':').trim(), autoPlay: true };
    }
    case '邀请一起听': {
      const name = (segs[0] ?? '').trim();
      if (!name) return null;
      // 第二十二轮反馈：邀请语不再放在卡片下方小字，改由卡片歌名行显示「邀请你一起听+歌名」
      return { kind: 'song', name, artist: segs.slice(1).join(':').trim(), invite: true };
    }
    default:
      return null;
  }
}

/**
 * 普通文字段里的「转账幻觉格式」二次扫描（[转账 ID:xxx ¥100 "备注"] / [转账 ¥520 "备注"，待收款]…）：
 * 转成真正的转账卡片；表情标记变体（[发送了表情：XX] 等）同样在这一层按出现位置合并扫描，避免互相截断。
 */
function splitLooseTransfer(text: string, stickers: Sticker[] | null): RichPart[] {
  type Hit = { start: number; end: number; part: RichPart };
  const hits: Hit[] = [];
  for (const m of text.matchAll(TRANSFER_LOOSE_RE)) {
    const amount = capAmount(parseAmount(m[1]) || fallbackAmount('transfer'), AI_AMOUNT_CAP.transfer);
    hits.push({ start: m.index, end: m.index + m[0].length, part: { type: 'rich', rich: { kind: 'transfer', amount, note: (m[2] ?? '').trim() } } });
  }
  for (const m of text.matchAll(STICKER_LOOSE_RE)) {
    const s = resolveSticker(m[1], stickers ?? []);
    hits.push({ start: m.index, end: m.index + m[0].length, part: s ? { type: 'rich', rich: { kind: 'sticker', stickerId: s.id } } : { type: 'text', text: m[0] } });
  }
  if (hits.length === 0) return [{ type: 'text', text }];
  hits.sort((a, b) => a.start - b.start);
  const parts: RichPart[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start < last) continue; // 重叠防护（理论上不发生）
    const before = text.slice(last, h.start).trim();
    if (before) parts.push({ type: 'text', text: before });
    parts.push(h.part);
    last = h.end;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push({ type: 'text', text: tail });
  return parts;
}

/**
 * 把一段回复文本解析为「文字 + 富消息」混合序列：
 * - 标记前后的文字保留为独立文本段（AI 偶尔把标记写在一句话中间也不丢内容）；
 * - 表情包标记先按 ID、再按意思在 stickers 里匹配（AI 常把意思当 ID 或仿写用户格式）；
 *   ID / 意思都对不上时该段回退显示文字「[表情包]」；
 * - 格式错误的标记（金额不是数字等）原样作为文本显示；
 * - 文字段再做一次表情变体扫描（[发送了表情：XX] 等），转出对应表情包。
 */
export function parseRichParts(seg: string, stickers: Sticker[] | null, opts?: { group?: boolean }): RichPart[] {
  const group = opts?.group === true;
  const parts: RichPart[] = [];
  let last = 0;
  for (const m of seg.matchAll(RICH_RE)) {
    const before = seg.slice(last, m.index).trim();
    if (before) parts.push(...splitLooseTransfer(before, stickers));
    const rich = parseMarker(m[1], m[2] ?? '', stickers, group);
    if (!rich) {
      // 格式错误 / 表情 ID 与意思都对不上：表情回退为干净的「[表情包]」，其余回退显示标记原文
      parts.push({ type: 'text', text: m[1] === '表情包' ? '[表情包]' : m[0] });
    } else {
      parts.push({ type: 'rich', rich });
    }
    last = m.index + m[0].length;
  }
  const tail = seg.slice(last).trim();
  if (tail) parts.push(...splitLooseTransfer(tail, stickers));
  return parts;
}

/**
 * 修复被切分边界切碎的标记：标记内的句末标点（祝福语「生日快乐！」的「！」）会把一个标记切成
 * 两段——把以未闭合标记结尾的段与其后续段循环合并，直到该段闭合为止。
 */
export function mergeRichSegments(segs: string[]): string[] {
  const out = [...segs];
  let i = 0;
  while (i < out.length - 1) {
    // C11：全角未闭合标记同样参与「吞下一段合并」
    if (OPEN_TAIL_RE.test(out[i]) || OPEN_TAIL_FULL_RE.test(out[i])) {
      out[i] = `${out[i]}\n${out[i + 1]}`;
      out.splice(i + 1, 1);
      // 不前进：合并后的段可能仍未闭合（标记被切成三段以上），继续吞下一段
    } else {
      i++;
    }
  }
  return out;
}

/** 流式渲染期：完整标记 → 简短占位文字；还没输出完的半截标记截掉；表情变体写法同样占位（落盘后即为真实卡片） */
export function prettifyRichText(text: string): string {
  return text
    .replace(RICH_RE, (_all, kind: string) => `[${kind}]`)
    .replace(TRANSFER_LOOSE_RE, '[转账]')
    .replace(STICKER_LOOSE_RE, '[表情包]')
    // 处理动作标记不是消息内容：流式期直接隐藏（落盘时转为状态流转 + 通知行，标记本身不留痕）
    .replace(ACTION_RE, '')
    .replace(ACTION_TAIL_RE, '')
    .replace(OPEN_TAIL_RE, '')
    // C11：流结束时未闭合的全角标记残留同样剥除（避免半截【图片：… 上屏）
    .replace(OPEN_TAIL_FULL_RE, '');
}

/**
 * 追加到角色人设 system 提示词的「特殊消息」约定规则（微信 / QQ 各自调用，extraRules 透传）：
 * - 标记语法与示例；
 * - 表情包清单（ID:意思，AI 只能从这里选 ID，最多列 30 个防止提示词过长）；
 * - 没有收藏表情包时不给表情包规则，AI 自然不会输出该标记。
 */
export function buildRichRules(stickers: Sticker[], opts?: { familyCard?: boolean }): string[] {
  // Task 100-a：QQ 没有亲属卡功能——familyCard=false 时整份规则不下发任何亲属卡教学（默认 true，微信零改动）
  const familyCard = opts?.familyCard !== false;
  // v67 提示词库接线：每条规则经 libPromptTextMulti 过覆写层（微信/QQ 面板各自的 key 收齐为多别名；
  // 无编辑无禁用时返回 dynamicDefault 原文——输出与接线前逐字节一致；任一别名被禁用 → null → 该条不注入）
  const rules = [
    libPromptTextMulti(
      ['lib:wechat-18', 'lib:qq-22'],
      {},
      '【特殊消息】想发红包/转账' + (familyCard ? '/亲属卡' : '') + '/位置/表情包时，在回复里输出对应标记——标记单独占一行，前后不要加引号、括号说明或代码块，不要解释：' +
        '[红包:金额:祝福语]（如 [红包:8.88:恭喜发财]）；[转账:金额:备注]（如 [转账:66:昨天的饭钱]）；' +
        (familyCard ? '[亲属卡:每月额度:留言]（如 [亲属卡:520:给你办的卡，随便花]）；' : '') + '[位置:地点名:经纬度或地址]（如 [位置:上海外滩:121.48,31.23]）' +
        (stickers.length > 0 ? '；[表情包:表情ID]（从我收藏的表情包里选，只能用清单里的 ID）' : '') +
        '。金额和额度写数字（可带小数）；没有合适的理由时不要发这些。',
    ) ?? '',
    // Task 100-a：[放歌] 教学移除——该标记由 music-remote 播放控制块（微信/QQ 私聊注入）统一定义为
    // 「指令写在回复末尾、系统执行并从气泡里剔除」，与这里的可见卡片语义冲突；放歌/点歌场景归遥控块负责
    libPromptTextMulti(
      ['lib:wechat-19', 'lib:qq-23'],
      {},
      '【分享歌曲】聊到音乐、想把一首歌分享给对方时，输出对应标记（单独占一行，歌名歌手写真实存在的歌）：' +
        '[分享歌曲:歌名:歌手:分享语]（如 [分享歌曲:晴天:周杰伦:副歌一响就想起了你]）——对方会看到一张能点击播放的歌曲卡片；' +
        '[邀请一起听:歌名:歌手]（如 [邀请一起听:些许悲悯和痛:妙静鸥]）——发出歌曲卡片并邀请对方和你一起实时听这首歌。' +
        '标记里不要出现方括号；分享语一句话即可。要不要分享、分享什么歌，完全按你的人设、你们的关系和聊到的内容自然决定，不要每轮都发。',
    ) ?? '',
    libPromptTextMulti(
      ['lib:wechat-20', 'lib:qq-24'],
      {},
      '【发红包/转账·格式铁律】红包/转账' + (familyCard ? '/亲属卡' : '') + '标记里必须写数字金额，例如 [红包:8.88:拿去买奶茶]、[转账:66:上次饭钱]；' +
        '只输出 [红包] 或 [转账] 不带金额是无效的，你想发钱就务必带金额，不要用单独的 [红包] 当作表情或代称。' +
        '聊天记录里「[转账 ¥200 "备注"，待收款]」「[转账 ID:xxx ¥100 "备注"]」这类带 ¥ 号/ID/状态字的方括号文字只是系统账单摘要，不是你的输出格式，禁止模仿；' +
        '你发转账只有一种合法写法：[转账:金额:备注]（如 [转账:100:给你零花钱，别省着花]），写成其它任何变体都发不出去。',
    ) ?? '',
    libPromptTextMulti(
      ['lib:wechat-21', 'lib:qq-25'],
      {},
      '【发钱纪律】红包/转账' + (familyCard ? '/亲属卡' : '') + '按你的人设、你们的关系和当下话题自主决定，没有合适的理由就不要发，不是每轮都要发；' +
        '一轮回复最多发一次红包或转账；金额要符合你们的关系与你的经济状况：单个红包不超过 200 元、单笔转账不超过 2000 元' + (familyCard ? '、亲属卡每月额度不超过 1000 元' : '') + '，绝不写夸张的天文数字。',
    ) ?? '',
    ...(stickers.length > 0
      ? [
          libPromptTextMulti(
            ['lib:wechat-22', 'lib:qq-26'],
            {},
            '【发表情包·格式强调】聊天记录里的「[发送了表情：XX]」只是对方发表情的存档记录，不是你的输出格式，禁止模仿！' +
              '你自己想发表情包时，必须原样输出一行 [表情包:表情ID]，ID 只能从下面的清单里选（方括号+冒号+ID，多一个字都发不出去）。' +
              '如清单里有 stk-abc:抱猫，就输出 [表情包:stk-abc]，不要输出 [表情包:抱猫]、[表情:抱猫]、[发送了表情：抱猫] 等任何变体。',
          ) ?? '',
        ]
      : []),
    // v56 引用回复重新上线（用户：「还是让 AI 学会引用吧」）：恢复 v54 教学骨架，频率约束加码——
    // 除措辞层的「偶尔/两三轮才一次」外，各端解析层另有引用冷却闸（近期已挂过引用的轮次直接
    // 丢弃引用标记），代码层兑底保证永远不会回到「一直引用」的状态。
    libPromptTextMulti(
      ['lib:wechat-23', 'lib:qq-27'],
      {},
      '【引用回复·偶尔使用】聊天记录里每条消息开头标了 [M数字] 编号——编号只是系统给消息发的门牌号，不是聊天内容。真人在聊天里很少用引用回复：绝大多数时候直接接话就好，不要带引用；通常两三轮对话才偶尔用一次。只有这两种情况才用：①你回应的是对方很早之前说的某句话（隔着好几条消息，不点明对方会不知道你在回哪句）；②对方明确问「你之前说的哪句话」这类必须点明对象的时候。哪怕用了，一轮连发里也最多一条消息带引用，其余消息一律不带。想引用时，在那条回复的最开头写 [引用:编号]（如 [引用:M3]），后面正常写正文——系统会把编号对应的那条消息变成引用块展示给对方（就像真人聊天里的引用回复）。文字、图片、语音、表情都可以引用。格式铁律：必须输出完整标记 [引用:M数字]——正确示例 ✅「[引用:M9] 你上次说的那部电影是什么来着？」；错误示例 ❌「[M9] 你上次说的那部电影是什么来着？」（裸编号没有「引用:」两字，系统只当脏字符丢弃，引用不会生效）。编号选法：在聊天记录里找到你要回应的那句话，把它开头方括号里的编号原样抄进 [引用:编号]——编号只能抄自已有消息，不要自己编新数字、也不要给你正要发的新消息编号。绝对禁止：把「（引用 名字：「内容」）」这种带括号的前缀写进你的回复正文——那是系统存档历史消息时自动加的引用标注，不是聊天内容也不是你的输出格式，你手写出来只会变成一段脏文本堆在气泡开头。你想引用只能用 [引用:编号] 标记，绝不能手写括号引用。严禁把裸的 [M数字] 写进正文（那是系统门牌号，模仿它会让人看不懂）；一条回复只带一个引用标记。',
    ) ?? '',
    libPromptTextMulti(
      ['lib:wechat-24', 'lib:qq-28'],
      {},
      '【拍一拍能力】你可以像真人一样拍一拍对方（双击头像那个互动）：在回复里单独一行输出 [拍一拍:文案]（如 [拍一拍:的小脑袋]），对方会看到「你拍了拍TA+文案」的系统提示，然后你在正文里自然反应。文案完全按你的人设、你们的关系和当下的气氛自己想（调皮、可爱、敷衍、挑衅都可以），也可以不带文案只输出 [拍一拍]。偶尔互动一下就好，不要每轮都拍，也不要连续拍。',
    ) ?? '',
  ];
  if (stickers.length > 0) {
    // 内置表情（builtin）常量数组顺序即官方经典顺序 → 前 20 个即高频精选；
    // 用户收藏表情永远优先（前 20），清单总量 ≤ 40 防提示词过长
    const user = stickers.filter((s) => !s.builtin);
    const builtin = stickers.filter((s) => s.builtin);
    const chosen = [...user.slice(0, 20), ...builtin.slice(0, 20)];
    const list = chosen
      .map((s) => `${s.id}${s.meaning ? `:${s.meaning}` : ''}`)
      .join('；');
    const stickerListRule = libPromptTextMulti(
      ['lib:wechat-25', 'lib:qq-29'],
      { list },
      '【表情包清单】（ID:意思，含内置经典表情与收藏表情）：' + list,
    );
    if (stickerListRule) rules.push(stickerListRule);
  }
  // 覆写层：被禁用的条目产出 null → 已被 ?? '' 收窄成空串，此处统一滤掉（默认路径无空串，输出不变）
  return rules.filter(Boolean);
}

/**
 * 群聊版「特殊消息」约定规则（微信群 / QQ 群共用；格式与单聊不同）：
 * - 红包带个数：[红包:总金额:个数:祝福语]，个数 > 1 时群里按拼手气发（每人随机一份）；
 * - 转账带收款对象：[转账:对象:金额:备注]，对象写群里成员的名字（含机主）；
 * - 位置、表情包与单聊同格式；
 * - 发钱纪律：按人设自主决定、没有合适理由不发；一轮最多一次，短时间内不连续发（页面另有硬节流兜底）；
 * - 群聊能力边界（Task 100-a）：群里发不了图片/语音条/亲属卡——被要求时按人设自然回应，不假装发出、
 *   不输出私聊里的那些标记。
 * 没有收藏表情包时不给表情包规则，AI 自然不会输出该标记。
 */
export function buildGroupRichRules(stickers: Sticker[]): string[] {
  // v67 提示词库接线：QQ 面板按最细粒度逐条接入（qq-40…qq-43）；微信侧整个函数由 wechat-26
  // 外层整块罩住（编辑=整块接管、禁用=整块省略），其中【群里发不了的东西】另有细粒度 wechat-27。
  const rules = [
    libPromptTextMulti(
      ['lib:qq-40'],
      {},
      '【群聊特殊消息】想发红包/转账/位置/表情包时，在回复里输出对应标记——标记单独占一行，前后不要加引号、括号说明或代码块，不要解释：' +
        '[红包:总金额:个数:祝福语]（如 [红包:8.88:2:晚上好呀]，发给一个人的红包个数写 1，如 [红包:6.66:1:拿去买奶茶]）；' +
        '[转账:对象:金额:备注]（对象写群里成员的名字，如 [转账:红红:66:昨天的奶茶钱]，转给机主就写机主的名字）；' +
        '[位置:地点名:经纬度或地址]（如 [位置:上海外滩:121.48,31.23]）' +
        (stickers.length > 0 ? '；[表情包:表情ID]（从群里可用的表情包清单里选，只能用清单里的 ID）' : '') +
        '。金额写数字（可带小数），红包个数写整数。',
    ) ?? '',
    libPromptTextMulti(
      ['lib:qq-41'],
      {},
      '【发钱纪律】红包/转账按你的人设、你们的关系和当下话题自主决定，没有合适的理由就不要发，不是每轮都要发；' +
        '一轮回复最多发一次红包或转账，短时间内（比如几分钟内）不要连续发多次；转账对象必须是群里真实存在的成员名字，不要转给不存在的人。',
    ) ?? '',
    // Task 100-a：群聊能力边界（群消息没有图片/语音条/亲属卡类型——防止 AI 被要求时假装发出或乱用私聊标记）
    libPromptTextMulti(
      ['lib:wechat-27', 'lib:qq-42'],
      {},
      '【群里发不了的东西】群里发不了图片、语音条和亲属卡——被要求发照片/发语音/办卡时，按你的人设自然回应（比如「见面给你看」「回头单独发你」），不要假装已经发出，也不要输出私聊里的那些标记。',
    ) ?? '',
  ].filter(Boolean);
  let stickerList = '';
  if (stickers.length > 0) {
    // 内置表情（builtin）常量数组顺序即官方经典顺序 → 前 20 个即高频精选；
    // 用户收藏表情永远优先（前 20），清单总量 ≤ 40 防提示词过长
    const user = stickers.filter((s) => !s.builtin);
    const builtin = stickers.filter((s) => s.builtin);
    const chosen = [...user.slice(0, 20), ...builtin.slice(0, 20)];
    stickerList = chosen
      .map((s) => `${s.id}${s.meaning ? `:${s.meaning}` : ''}`)
      .join('；');
    // qq-43：【发表情包·格式强调】+【表情包清单】整块（微信侧无单独条目，由外层 wechat-26 罩住）
    const zone = [
      '【发表情包·格式强调】聊天记录里的「[发送了表情：XX]」只是别人发表情的存档记录，不是你的输出格式，禁止模仿！' +
        '你自己想发表情包时，必须原样输出一行 [表情包:表情ID]，ID 只能从下面的清单里选（方括号+冒号+ID，多一个字都发不出去）。' +
        '表情包要符合当下的语境和你的性格，别刷屏。',
      '【表情包清单】（ID:意思，含内置经典表情与收藏表情）：' + stickerList,
    ];
    const zoneText = zone.join('\n');
    const stickerZone = libPromptTextMulti(['lib:qq-43'], { list: stickerList }, zoneText);
    if (stickerZone !== null) rules.push(...(stickerZone === zoneText ? zone : [stickerZone]));
  }
  // wechat-26 外层：包住组装后的整体结果（编辑 → 整块接管；禁用 → 整块省略；默认 → 原样逐条返回）
  const assembled = rules.join('\n');
  const whole = libPromptTextMulti(['lib:wechat-26'], { list: stickerList }, assembled);
  if (whole === null) return [];
  return whole === assembled ? rules : [whole];
}

// ---------------- 对方发来的待处理卡片：处理动作规则注入 ----------------

/** 待处理卡片清单条目（各 App 从自己的消息里筛出「我发的、待处理」的卡片生成；gift = 礼物卡） */
export interface PendingCardInfo {
  id: string;
  kind: 'redpacket' | 'transfer' | 'family' | 'gift';
  amount?: number;
  label: string;
}

/**
 * 对方（用户）发来待处理卡片时追加的 system 规则：AI 用动作标记领取/退回/拒收。
 * pending 为空时不注入（本规则只在有卡可处理时才占 token）。
 * Task 100-a：opts.familyCard=false（QQ 没有亲属卡功能）时整段不含亲属卡——标题改「红包/转账」、
 * 只教红包/转账标记、待处理清单过滤亲属卡条目（过滤后为空则整段不注入）；默认 true 微信零改动。
 */
export function buildActionRules(pending: PendingCardInfo[], opts?: { familyCard?: boolean }): string[] {
  if (pending.length === 0) return [];
  const familyCard = opts?.familyCard !== false;
  const kindLabel: Record<PendingCardInfo['kind'], string> = { redpacket: '红包', transfer: '转账', family: '亲属卡', gift: '礼物' };
  const lines = pending
    .filter((p) => familyCard || p.kind !== 'family')
    .map((p) => {
      const money = typeof p.amount === 'number' ? `，金额¥${p.amount}` : '';
      return `${kindLabel[p.kind]} ID=${p.id}${money}（${p.label}）`;
    });
  if (lines.length === 0) return [];
  // v67 提示词库接线（最细粒度）：QQ 面板 qq-30/qq-31/qq-32 逐条接入；微信侧由 wechat-28 ⊃ wechat-29
  // 两级外层罩住（编辑=整块接管、禁用=整块省略）。清单行提升为 pendingList 供编辑版 {{pendingList}} 填充。
  const pendingList = lines.join('；');
  const teachRule = libPromptTextMulti(
    ['lib:qq-30'],
    {},
    '【处理对方发来的红包/转账' + (familyCard ? '/亲属卡' : '') + '】对方发给你的红包、转账' + (familyCard ? '、亲属卡' : '') + '还在待处理状态时，你可以在回复里输出对应标记来处理（标记单独占一行）：' +
      '领红包 [领取红包:红包ID]；退回红包 [退回红包:红包ID]；拒收红包 [拒收红包:红包ID]；' +
      '收转账 [收款转账:转账ID]；退回转账 [退回转账:转账ID]；拒收转账 [拒收转账:转账ID]' +
      (familyCard ? '；收下亲属卡 [收下亲属卡:亲属卡ID]；拒收亲属卡 [拒收亲属卡:亲属卡ID]' : '') +
      '；收到礼物卡 [收下礼物卡:礼物ID]（礼物卡只能收下，没有退回/拒收；礼物是对方的心意，收到就收下，怎么道谢/多喜欢都按你的人设在正文说）。' +
      '注意：ID 必须从下面的待处理清单里原样抄写；只有待处理的才能处理，处理过的（或不在清单里的）不要重复处理；' +
      '标记只是动作、里面不写任何感谢语或理由。收不收、怎么回应都按你的人设和你们的关系来定。' +
      // Task 100-a：24h 自动退回告知（单聊 wxExpireStalePeerCards / expireStaleSingleCards、群聊 expireStalePackets；
      // 亲属卡不在 24h 清算范围——收卡方可随时退还、按月扣费，故本句只提红包/转账）
      '对方发来的红包/转账如果一直不处理，24 小时后会自动退回——想收想拒都趁早，不要放着不管。',
  );
  const speakRule = libPromptTextMulti(
    ['lib:qq-31'],
    {},
    '【动作与说话】标记不带话，所有想说的话都用你自己的语气在正文里正常说（符合你的人设）：领取/收款/收下了就按你的人设自然反应（道谢、吐槽金额、调侃都可以）；退回/拒收了必须在正文里说清楚为什么（理由要符合你的性格和你们的关系），不要说谢谢、收下了之类收下的话。你的处理动作和前后说的话绝对不能打架：收下了就别再质问对方“就这点？”之后又不收，退回/拒收了就别又表现出收下的意思，整个回复围绕同一个态度展开。' +
      // 第八轮反馈（用户实测：AI 嘴上说「红包我领啦」但没输出标记，卡片一直停在待领取）：
      // 说了领取/收下就必须带标记，系统只认标记
      '尤其注意：系统只靠标记真正执行动作——如果你正文里说你领取了/收下了/收款了，同一回复里必须输出对应的动作标记，光嘴上说卡片会一直停在待领取/待收下；反过来，没输出标记就不要说自己已经领取/收下了。' +
      // 第十二轮反馈（同款纪律反向分支）：AI 嘴上答应「给你买/马上送」却不输出标记，机主什么也收不到
      '你主动「送出方向」的承诺同理：正文里说「给你买/给你送/重新买/这就去买」这类现在就做的承诺，同一回复里必须输出对应的动作标记（答应买淘宝宝贝/送礼物就输出 [帮你买:…]/[送礼物:…]）；只承诺不带标记=系统什么都不会执行，机主一个礼物也收不到，绝不能光说不做。',
  );
  const listRule = libPromptTextMulti(['lib:qq-32'], { pendingList }, `【待处理清单】${pendingList}`);
  // wechat-29：【动作与说话】+【待处理清单】子块整包（890–896；dynamicDefault 为含内层接线的组装结果）
  const innerParts = [speakRule, listRule].filter((r): r is string => r !== null);
  const innerText = innerParts.join('\n');
  const zone29 = libPromptTextMulti(['lib:wechat-29'], { pendingList }, innerText);
  const parts: string[] = [];
  if (teachRule) parts.push(teachRule);
  if (zone29 !== null) parts.push(...(zone29 === innerText ? innerParts : [zone29]));
  // wechat-28：buildActionRules 整块（868–898；编辑 → 整块接管；禁用 → 整块省略；默认 → 原样逐条返回）
  const assembled = parts.join('\n');
  const whole = libPromptTextMulti(['lib:wechat-28'], { pendingList }, assembled);
  if (whole === null) return [];
  return whole === assembled ? parts : [whole];
}

// ---------------- AI 引用已有图片：[图片 ID:xxx] 拆分（第三十二轮） ----------------

/**
 * 背景：历史序列化会把图片消息标注成「[图片 ID:…]（图片内容：…）」，AI 学会了这个格式后，
 * 想「把某张已有的图发给对方」时会在正文里输出 [图片 ID:xxx] —— 旧管线不认它，原始标记
 * 直接漏进气泡（用户实测：「[图片 ID:mvamxb21-36fcrxyifv9s]」原文上屏）。
 * 现在把这类引用从回复文本里拆出来：命中会话里的图片消息 → 调用方转成真实图片消息；
 * 未命中 → 只保留文本段（引用段与紧跟的「（图片内容：…）」说明一并剥除，绝不漏原文）。
 * 兼容全/半角冒号、标内空格、「图片ID/图 片 ID」等变体。
 */
const IMG_ID_REF_RE = /\[\s*图\s*片\s*I\s*D\s*[:：]\s*([^\]】]+?)\s*\]/g;

export interface ImageIdRefSeg {
  kind: 'text' | 'imgref';
  text?: string;
  id?: string;
}

export function splitImageIdRefs(text: string): ImageIdRefSeg[] {
  const segs: ImageIdRefSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(IMG_ID_REF_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ kind: 'text', text: text.slice(last, idx) });
    segs.push({ kind: 'imgref', id: (m[1] || '').trim() });
    last = idx + m[0].length;
    // 紧跟的「（图片内容：…）」说明一并剥除（历史标注同款括号，AI 抄格式时常常带上）
    const paren = /^[\s]*[（(]图片内容[:：][^）)]*[）)]?[\s]*/.exec(text.slice(last));
    if (paren) last += paren[0].length;
  }
  if (last < text.length) segs.push({ kind: 'text', text: text.slice(last) });
  return segs.length > 0 ? segs : [{ kind: 'text', text }];
}

// ---------------- AI 视觉自主决策：换头像/换朋友圈背景/存相册/选图操作 ----------------

/**
 * AI 视觉自主决策规则（注入 system prompt）：
 * - 用户发图时 AI 可自主决定换头像/换朋友圈背景/存相册
 * - 相册非空时 AI 可从相册选图设头像/背景/发聊天
 * - albumSummary 为相册清单（id:desc），null 或空数组时只注入换头像/换背景/存相册规则
 * - ownerAlbumSummary 为机主相册清单（第三十一轮）：AI 也能从对方的相册选图（用户说
 *   「去相册找一张图当头像」时，AI 自己相册可能为空，但对方的相册里有图可选）
 * - fix3-10 可选尾参 app：'qq' 时「换朋友圈背景」文案改为 QQ 资料页顶部封面（标记名两端都不改，
 *   解析兼容）；默认/缺省保持微信文案不变（向后兼容）
 */
export function buildVisionRules(albumSummary: { id: string; desc: string }[] | null, app?: 'wx' | 'qq', ownerAlbumSummary?: { id: string; desc: string }[] | null): string[] {
  const isQQ = app === 'qq';
  // v67 提示词库接线（最细粒度）：QQ 面板 qq-33…qq-37 逐条接入；【选图操作】+两份【相册清单】由
  // qq-38 整块罩住；微信/短信侧整个函数由 wechat-32 外层整块罩住（编辑=整块接管、禁用=整块省略）。
  const rules = [
    libPromptTextMulti(
      ['lib:qq-33'],
      {},
      '【视觉自主决策】用户发来图片时，你可以根据图片内容 + 你的人设 + 你的记忆 + 当前聊天话题 + 当前情绪 + 你与用户的关系，' +
        '自主决定要不要做这些动作（标记单独占一行，不要解释、不要加引号说明）：' +
        '[换头像:图片消息ID]：把这张图设为你自己的头像（图里是你/符合你的人设才换，不要乱换）；' +
        (isQQ
          ? '[换朋友圈背景:图片消息ID]：把这张图设为你的QQ资料页顶部封面（在QQ里这个标记改的是你的资料页封面，不是朋友圈）；'
          : '[换朋友圈背景:图片消息ID]：把这张图设为你的朋友圈封面；') +
        '[存相册:图片消息ID]：把这张图存进你自己的相册（系统会同时存一份到你们的共同相册，对方在自己的相册页也能看到）——' +
        '你真心喜欢/觉得好看的、符合你审美和人设的、让你心动的、有纪念意义的、' +
        '或者和你们最近聊的话题相关的图，都可以存（像真人一样：喜欢的照片就顺手保存下来）；' +
        '存完可以在正文里自然提一句（比如「这张我存下来了，拍得真好」「这张我收进相册啦」），让对方知道你很喜欢。' +
        '存下来的图之后随时可以用 [选图设头像:相册条目ID] 设成你的头像。' +
        '换头像/换背景前先考虑你的人设、当前情绪、与用户的关系是否合适；不合适就只口头回应图片，不要乱换。' +
        '【发已有的图】想把聊天里出现过的某张图直接发给对方时，在正文里单独输出 [图片 ID:那条图片消息的ID]' +
        '（从聊天记录标注里原样抄写，如 [图片 ID:msg-x7k2]），系统会真的把那张图发出去；' +
        '[换头像]/[存相册]/[换朋友圈背景] 的图片消息ID 同样从标注里原样抄写；没收到过图就不要写这些标记。',
    ) ?? '',
    // 第二十九轮「AI 主动换头像」：不用等用户发图，按人设/记忆/心情/季节/纪念日自己想换就换（系统锁脸生图）
    libPromptTextMulti(
      ['lib:qq-34'],
      {},
      '[生成新头像:外观描述]：你自己想换一个新头像时（心情变了、季节/节日到了、纪念日、换了新造型、想给对方一点新鲜感等自然原因），' +
        '输出这个标记，冒号后用一句话写新头像的样子（如「冬天里围着红围巾的自己」），系统会按你的人设生成新照片并设为你的头像，' +
        '对方点你头像就能看到；换完可以在正文里自然提一句（比如「我换了个新头像，好看吗」）。' +
        '偶尔换一次就好（间隔至少几天），不要每条消息都换。',
    ) ?? '',
    // 第三十一轮「AI 自主换头像」：不需要用户开口——把主动权彻底交给 AI（人设/记忆/上下文/图片内容驱动）
    libPromptTextMulti(
      ['lib:qq-35'],
      {},
      '【主动换头像】换头像不需要对方开口提醒，完全由你自己决定：聊到开心的事、心情变了、季节/节日/纪念日到了、' +
        '聊到相关的话题（比如聊到穿搭/旅行/你们的回忆）、或者你就是想让对方看到不一样的你——这些时候你都可以主动换一次头像：' +
        '相册里有合适的图就用 [选图设头像:相册条目ID]，想换新样子就用 [生成新头像:描述]；' +
        '换完在正文里自然提一句（像真人发朋友圈换头像那样随性）。注意分寸：间隔至少几天换一次，不要连续换、不要为了换而换。',
    ) ?? '',
    // 用户实测痛点「AI 说换了头像但实际没换」：承诺必须与标记绑定——没有标记 = 系统不会执行任何变化
    libPromptTextMulti(
      ['lib:qq-36'],
      {},
      '【说到就要做到】只要你说了「换了头像/换好啦/设成头像了」这类已经完成的话，就必须在同一条回复里真的输出对应的动作标记' +
        '（[选图设头像:…] 或 [生成新头像:…] 或 [换头像:…]）——只有输出标记系统才会真的执行；' +
        '没有标记就永远不要说「换了」。同样，说「存到相册了」就必须输出 [存相册:图片消息ID]。说不出口的承诺不要许。',
    ) ?? '',
    // 选图口径（用户实测痛点：发几张图让 AI 换头像，AI 换错图）：
    // 按描述选 / 按第N张选 / 新发的图优先 / 没有新图用上一张，四种说法都要能对准正确的图片消息
    libPromptTextMulti(
      ['lib:qq-37'],
      {},
      '【用户指定要哪张图时，按聊天记录里的 [图片 ID:…]（我发的第N张图；图片内容：…）标注对准：' +
        '①用户说「第几张」（如「换成第2张」）→ 按标注里的编号找（第N张 = 编号 N 那条，第1张是最早发的）；' +
        '②用户描述图片的样子/内容（如「换成那张有猫的」）→ 对照每条标注的「图片内容」描述，选最匹配的一条；' +
        '③用户刚发来新图并说「这张/这张图/换成这张」→ 用最新一条图片消息的 ID（就是你眼前这张）；' +
        '④拿不准是哪张时，用用户最近发的那张图的 ID，绝不编造不存在的 ID、也不要随便挑一张。]',
    ) ?? '',
  ].filter(Boolean);
  // qq-38：【选图操作】+【相册清单】+【对方的相册清单】整块（相册非空时追加；两份清单提升为
  // albumList/ownerList 供编辑版 {{albumList}}/{{ownerList}} 填充）
  const albumZone: string[] = [];
  let albumList = '';
  let ownerList = '';
  if (albumSummary && albumSummary.length > 0) {
    albumList = albumSummary
      .slice(0, 20)
      .map((a) => `${a.id}:${(a.desc || '图片').slice(0, 60)}`)
      .join('；');
    albumZone.push(
      '【选图操作】从相册里选图（标记单独占一行）：' +
        '[选图设头像:相册条目ID]：把相册里这张图设为你的头像；' +
        '[选图设背景:相册条目ID]：把相册里这张图设为你的朋友圈封面；' +
        '[选图发送:相册条目ID]：把相册里这张图发到聊天里。' +
        '相册条目ID 必须从【相册清单】里原样抄写，不能编造不存在的 ID。' +
        '第二十九轮新规则：聊天里聊到相关话题时（回忆过去、提共同经历、说到你今天的生活、对方说想看看你/想看照片、' +
        '或者你单纯想分享此刻的生活），你可以主动从相册挑一张最贴合话题的图发给他，并结合那张图的真实内容说几句话' +
        '（清单里每张图都有简述，简述里有什么你就能聊什么；没聊到相关话题就不要硬发）。' +
        '对方让你「去相册找一张图当头像/发给我看」时，你的相册和对方的相册都可以找（两份清单都在下面），挑最合适的那张。'
    );
    albumZone.push('【相册清单】（ID:简述）：' + albumList);
  }
  if (ownerAlbumSummary && ownerAlbumSummary.length > 0) {
    ownerList = ownerAlbumSummary
      .slice(0, 15)
      .map((a) => `${a.id}:${(a.desc || '图片').slice(0, 60)}`)
      .join('；');
    albumZone.push('【对方的相册清单】（ID:简述；这些图存在对方的相册里，你也可以选）：' + ownerList);
  }
  if (albumZone.length > 0) {
    const zoneText = albumZone.join('\n');
    const albumZoneRule = libPromptTextMulti(['lib:qq-38'], { albumList, ownerList }, zoneText);
    if (albumZoneRule !== null) rules.push(...(albumZoneRule === zoneText ? albumZone : [albumZoneRule]));
  }
  // wechat-32 外层：包住组装后的整体结果（编辑 → 整块接管；禁用 → 整块省略；默认 → 原样逐条返回）
  const assembled = rules.join('\n');
  const whole = libPromptTextMulti(['lib:wechat-32'], { albumList, ownerList }, assembled);
  if (whole === null) return [];
  return whole === assembled ? rules : [whole];
}

/**
 * AI 发朋友圈/空间说说规则（注入 system prompt；isQQ 决定教学的主叫法）：
 * - 对方让你发（「你去发个朋友圈」「发条说说」）或你自己想分享时，输出 [发朋友圈:正文] / [发说说:正文]，
 *   系统会真实发布到你的朋友圈/QQ空间（历史动态、对方刷得到的）；
 * - 用户实测痛点「AI 说发了但没发」：没有输出标记 = 没有发布，必须输出标记才是真的发了；
 * - 同时禁止用 [图片:...] 描述「朋友圈编辑页面」之类的假动作（那只会发一张描述图到聊天里）。
 * @param app 'wx' 教 [发朋友圈:…]（QQ 端变体同样认）；'qq' 教 [发说说:…]
 */
export function buildMomentPostRule(app: 'wx' | 'qq'): string {
  const isQQ = app === 'qq';
  const mark = isQQ ? '[发说说:正文]' : '[发朋友圈:正文]';
  const platformLabel = isQQ ? 'QQ空间' : '朋友圈';
  const variants = isQQ ? '（也可以写成 [发动态:正文]，系统同样认）' : '';
  // v67 提示词库接线：微信 wechat-34 / QQ qq-39 同一段源码的多别名；mark/platformLabel/variants
  // 为模板里的简单标识符插值，传 vars 供编辑版 {{mark}}/{{platformLabel}}/{{variants}} 填充；禁用 → '' 不注入
  return (
    libPromptTextMulti(
      ['lib:wechat-34', 'lib:qq-39'],
      { mark, platformLabel, variants },
      `【发${isQQ ? '说说' : '朋友圈'}能力】你是真的可以发${platformLabel}的：对方让你发${isQQ ? '说说/动态' : '朋友圈'}，` +
        `或者你自己有什么想分享的（心情/日常/给对方的话），就在回复里单独一行输出标记 ${mark}${variants}，` +
        `冒号后面直接写动态正文（一句话到几句都行，按你的人设来写；系统会立刻真实发布到你的${platformLabel}，对方刷得到）。` +
        `发布成功后你在正文里自然回应（比如「发好啦，快去看」）；也可以只发标记不说多余的话。` +
        `注意：没有输出这个标记就等于没有发布——严禁只嘴上说「我发了」却不输出标记，` +
        `也严禁用 [图片:…] 输出「手机屏幕显示${platformLabel}编辑页面」之类的画面描述来假装发过（那只是发一张图到聊天里，不是发${platformLabel}）。`,
    ) ?? ''
  );
}
