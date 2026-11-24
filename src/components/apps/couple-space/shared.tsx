'use client';

/** 情侣空间共享层（第十八轮 #8 拆分）：CoupleState 数据模型与持久化 + 日期/距离/状态工具函数 + 通用 UI 原子（心情脸/头像/爱心像素画/SubShell 子页壳/评论线程/分享渠道选择器）+ 恋爱状态测评推导。 */

/**
 * 情侣空间 App（情侣空间，原情侣空间）——白/浅灰定制配色版。
 *
 * 用户规格：按提供的 5 张参考截图 1:1 复刻结构（邀请页 / 首页 / 发现 / 相册 / 我们），
 * 全站配色不用粉色/红色，改用白色 + 浅灰（主强调色为炭灰渐变，深灰白字保证对比）。
 *
 * 页面结构（对应参考图）：
 * - 邀请页（图1）：全屏渐变底 + 装饰圆与浮点 + 恋人头像/昵称 + 「邀请你开通情侣空间」
 *   + 左上角返回键 + 「接受邀请」大按钮 + 底部「在情侣空间你们可以体验这些」三体验卡（情侣相册/爱情树/纪念日）
 * - 首页（图2）：情侣空间大标题 + 双头像虚线连接 + 中间纪念日气泡（点击设置→已相恋 N 天）
 *   + 背景合影图上叠「每天想你」大圆（可点击打卡，两侧引号装饰）+ 右侧悬浮心形/换背景按钮
 *   + 底部四功能卡（爱情小树成长记/情侣轨迹/甜蜜小问答/未来情书）
 * - 发现（图3）：一起玩吧两张大卡（情侣轨迹/情侣小家）+「情感升温小技巧」3×4 宫格 12 项
 * - 相册（图4）：拍给TA看/聊天记录/日记相册/纪念日相册 四张上传卡 + 情侣私密相册宫格（可新建）
 *   + 悬浮「新建相册」按钮
 * - 我们（图5）：蕾丝装饰「我们の恋爱日记」卡（双头像+像素心+恋爱进度条+在一起天数）
 *   + 功能列表（恋爱资料/纪念日/每天想你/甜蜜小问答/小礼堂/联系客服/设置）
 *
 * 全部子功能页均为可用的轻量实现（数据 IndexedDB 持久化，键 couple-space:state）：
 * 恋人资料默认从「我的信息卡 + 联系人第一位 AI 角色」预填，可在恋爱资料页修改。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  BatteryCharging,
  BookHeart,
  Cake,
  CalendarClock,
  CalendarDays,
  Camera,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Crown,
  Eye,
  EyeOff,
  Folder,
  Footprints,
  Gem,
  Gift,
  GripVertical,
  Heart,
  Headphones,
  HelpCircle,
  Hourglass,
  IdCard,
  Image as ImageIcon,
  ImagePlus,
  AlignJustify,
  Info,
  Landmark,
  Lightbulb,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  MapPinned,
  MessageCircleHeart,
  MessageSquare,
  Moon,
  MoreVertical,
  NotebookPen,
  Pencil,
  PencilLine,
  BookOpen,
  Medal,
  ShieldCheck,
  Orbit,
  Phone,
  PhoneCall,
  Pin,
  PersonStanding,
  Plane,
  Plus,
  RefreshCcw,
  Scale,
  Settings as SettingsIcon,
  Share2,
  Signal,
  Smartphone,
  Smile,
  Sparkles,
  Star,
  Trash2,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { BOARD_CARDS, NOTE_COLORS, boardCardSkinOf, detectCardPadTop, type BoardCardCustom } from '@/lib/ios/couple-board-cards';
import { useSettings, useUI } from '@/lib/ios/store';
import { listContacts } from '@/lib/ios/contacts-store';
import {
  COUPLE_STATE_EVENT,
  channelIdentityOf,
  emptyInviteMeta,
  readInviteMeta,
  sendMyInvite,
  aiInvitesMe,
  acceptIncomingInvite,
  dispatchStateEvent,
  COUPLE_CARD_EVENT,
  type CoupleChannel,
  type CoupleInviteMeta,
} from '@/lib/ios/couple-invite';
// 第十六轮：AI 情绪系统——v61 头像下的心情小胶囊已不再展示（仅删显示，情绪引擎/提示词注入等功能全保留）
import { aiAnswerWithMe, aiCommentOnPhoto, aiCommentOnPhotoLazy, aiDecideCouplePhoto, aiReplyPickForLevel, aiReplyVerdict, aiStatusPick, aiTickTrail, aiTrailFeed, aiZodiacReading, coupleMemoryDiff, coupleRemember, genReplyLevels, pokeTaDiary, rememberStatusExam, runCoupleAiTick, scheduleAiReply, scheduleBoardNoteReply, syncLocFromContacts, trailSortMs, isGenPhoto, isTextPhoto, photoSrc, type CouplePhotoEntry, type CoupleTextPhoto, type CoupleTrailRec, type DynReplyLevel } from '@/lib/ios/couple-ai';
import { HUNDRED_LIST } from '@/lib/ios/couple-hundred';
import { consumePendingPactOpen, COUPLE_PACT_NAV_EVENT, patchPactCardsWhere, peekPendingPactOpen, scheduleAiPactDecision, sendPactCard } from '@/lib/ios/couple-pact-share';
import { consumePendingExamOpen, COUPLE_EXAM_NAV_EVENT, peekPendingExamOpen, scheduleAiExamAnswer, sendExamCard } from '@/lib/ios/couple-exam-share';
import { consumePendingLetterOpen, COUPLE_LETTER_NAV_EVENT, peekPendingLetterOpen, scheduleAiLetterFeedback, sendLetterCard } from '@/lib/ios/couple-letter-share';
import { setMtPendingPage } from '@/lib/ios/meituan-store';
import CoupleTarotPage from '../couple-tarot';
import CoupleHome from '../couple-home/CoupleHome';
import type { TarotReadingsMap } from '@/lib/tarot-deck';
import { EnvelopeArt, LETTER_ENVELOPES, petKindOf, PetFace } from '../couple-letter-bubble';
import WheelDatePicker from '../wheel-date-picker';
import { displayNameOf, isFriendIn, avatarFor, type ContactRecord } from '@/lib/contacts';
import { fileToScaledDataURL, loadProfileCard } from '@/components/ios/ProfileCard';
import { generateCharacterPhoto, imgGenConfigReady } from '@/lib/imggen';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DefaultAvatar } from '../default-avatar';
import { LocalToast, useLocalToast } from '../page-toast';



export interface StatusResult {
  score: number; // 0-100
  title: string; // 状态称号
  summary: string; // 总结
  advice: string[]; // 建议
}

/** 相册（四个固定卡 + 用户自建的私密相册通用结构） */

export interface CoupleAlbum {
  id: string;
  name: string;
  desc: string;
  photos: CouplePhotoEntry[]; // dataURL（真图）或文字图片卡片（CoupleTextPhoto，第五十六轮）
}

/** 真实地理位置（情侣轨迹）：open-meteo 地理编码返回的地名 + WGS84 坐标 */

export interface CouplePlace {
  name: string; // 展示名（如「北京市」）
  lat: number;
  lng: number;
}

/** 许愿树卡片下的留言（第六十轮：卡片正文 + 卡片下双向留言区） */

export interface TreeCardComment {
  id: string;
  from: 'me' | 'ta';
  text: string;
  at: number;
}

/** 许愿树留言卡（晴天版：挂签时自选颜色 color = WISH_COLORS 调色盘索引；旧数据缺省兼容） */

export interface TreeCard {
  id: string;
  from: 'me' | 'ta';
  text: string;
  at: number;
  comments: TreeCardComment[];
  color?: number; // 调色盘索引（0-7）；缺省时按挂签人兼容（我=红 / TA=奶油白）
}

/** 留言板便签（留言墙上钉的手写便签；card = BOARD_CARDS 图案卡纸 1-7，缺省 = 素白色卡；color = 素白卡时的调色盘索引；unlockAt 非空 = 时间胶囊；pinned = 置顶（长按菜单可置顶/取消，置顶的排在墙最前面） */

export interface BoardNote {
  id: string;
  from: 'me' | 'ta';
  text: string;
  at: number;
  card?: number; // 图案卡纸样式（1-7 = 卡面清单 BOARD_CARDS；缺省 = 素白卡走调色盘配色）
  color?: number; // 素白卡的调色盘索引；缺省 = 云白
  unlockAt?: number; // 时间胶囊解锁时间戳；缺省 = 普通便签；封存中内容对双方都不可见
  pinned?: boolean; // 置顶（排序时排最前；缺省 = 未置顶，JSON 序列化时自动省略保持数据干净）
  comments: TreeCardComment[]; // 便签下的双向留言
}

/** 已保存的恋爱协议书（签署生效后自动存档；可多份，可点击回看；第十二轮支持分享/待对方签署） */

export interface CouplePactRecord {
  id: string;
  title: string;
  preamble: string;
  clauses: string[];
  signMe: string | null;
  signTa: string | null;
  meAt: number | null;
  taAt: number | null;
  at: number; // 生效时间（双方签完）
  status?: 'signed' | 'pending' | 'declined'; // 第十二轮：signed=已生效 pending=等TA签 declined=TA婉拒（缺省视为 signed——旧数据）
  reason?: string; // declined 时 TA 的理由
}


export interface CoupleState {
  v: 1;
  accepted: boolean; // 是否已接受邀请
  anniversary: string | null; // 纪念日 'YYYY-MM-DD'
  meName: string;
  meAvatar: string | null;
  taName: string;
  taAvatar: string | null;
  signature: string;
  homeBg: string | null; // 首页合影背景 dataURL；null = 内置默认图
  homeVeil: number; // 首页背景白纱模糊度 0-100（设置页可调；0 = 无白纱背景直接可见，100 = 最朦胧）
  missYou: number; // 每天想你累计次数
  missYouByDay: Record<string, number>; // 'YYYY-MM-DD' → 当日次数
  missSince: string | null; // 首次点击「每天想你」的日期；非空后首页大圆消失、头像下显示想念天数
  gender: string; // 我的性别（恋爱资料页）
  coupleNo: string; // 情侣号（自动生成）
  logins: number[]; // 登录记录（时间戳）
  annivExtra: { key: string; label: string; date: string }[]; // 纪念日列表（预设 + 自建）
  tree: number; // 爱情树成长值（浇水次数）
  letters: { id: string; text: string; at: number; openAfterDays: number; envelope?: string; sharedAt?: number }[]; // 情书（原未来情书；envelope=信封样式；sharedAt=分享给 TA 时间）
  letterDraft: string; // 情书草稿（存草稿按钮）
  letterEnv: string; // 当前选中的信封样式 key（第十八轮）
  letterSenderName?: string; // 信封自定义署名（第二十轮：设置头像/昵称可自定义；空=跟随微信/QQ 同步的 meName）
  letterSenderAvatar?: string; // 信封自定义头像 dataURL（第二十轮；空=跟随 meAvatar）
  letterFontKey?: string; // 情书编辑器当前字体 key（第二十八轮持久化：重开不丢）
  letterPaperKey?: string; // 情书编辑器当前信纸 key（第二十八轮持久化）
  letterFontSize?: number; // 情书编辑器当前字号（第二十八轮持久化）
  letterColor?: string; // 情书编辑器当前字色（第二十八轮持久化）
  letterEnvText?: string; // 信封收信字样（第二十九轮可自定义；空 = 默认「致 最爱的你」）
  aiLetters: { id: string; text: string; envelope?: string; replyToId?: string; at: number }[]; // TA 写给我的信（AI 回信/主动写信）
  albums: CoupleAlbum[];
  moods: { id: string; emoji: string; text: string; at: number; photo?: string | null; dateKey?: string; from?: 'me' | 'ta' }[]; // 心情日记（from='ta' = AI 写的）
  chronicle: { id: string; text: string; at: number }[]; // 恋爱编年史
  impressionsMe: string[]; // TA 眼中的我（标签）
  impressionsTa: string[]; // 我眼中的 TA（标签）
  hundred: number[]; // 100 件小事已勾选索引
  hundredItems: Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>; // 100 件小事编辑数据（key=索引；byTa=AI 发起）
  missCards: number; // 想你补签卡数量
  missMadeUp: string[]; // 已补签的日期 key
  stoneEngraved: boolean; // 三生石已刻名
  quiz: { id: string; q: string; a: string; at: number }[]; // 甜蜜小问答记录
  quizCustom: string[]; // 甜蜜小问答自定义问题
  examBest: number | null; // 恋爱水平考试最高分
  status: string; // 恋爱状态
  pactAt: number | null; // 恋爱协议签署时间（双方签完生效）
  pactTitle: string; // 协议名称（可编辑）
  pactPreamble: string; // 协议声明（可编辑）
  pactClauses: string[]; // 协议条款（可编辑/排序/增删）
  pactSignMe: string | null; // 我的签名
  pactSignTa: string | null; // TA 的签名
  pactMeAt: number | null; // 我签名时间
  pactTaAt: number | null; // TA 签名时间
  zodiac: { me: string; ta: string } | null; // 星座缘分选择
  zodiacReading: { me: string; ta: string; score: number; text: string; glow: string; advice: string; watch: string; at: number } | null; // 星座缘分解读（第十九轮：用户 API 模型按真实占星生成，可重测覆盖）
  tarotReadings: TarotReadingsMap; // 爱情塔罗占卜记录（contactId → 记录，按角色 ID 隔离；第四十五轮重做）
  married: boolean; // 小礼堂：是否已婚
  marriedAt: number | null;
  meetPlace: string; // 情侣轨迹：相遇地点
  myLoc: CouplePlace | null; // 情侣轨迹：我的真实位置（第八轮）
  taLoc: CouplePlace | null; // 情侣轨迹：TA 的真实位置（第八轮）
  meetLoc: CouplePlace | null; // 情侣轨迹：相遇地点定位（第八轮）
  trackInfoHid?: boolean; // 情侣轨迹：地图顶部头像/距离悬浮卡已隐藏（第十八轮）
  trailChatsAt?: number | null; // 位置与轨迹聊天：我最后一条消息时间（显示“对方正在输入…”用）
  chronicleMonths: { ym: string; status: string }[]; // 恋爱编年史：关键月份状态（ym='YYYY-MM'；第八轮重做）
  pacts: CouplePactRecord[]; // 已保存的协议书（第八轮：可多份/可回看）
  replies: { id: string; prompt: string; reply: string; at: number }[]; // 回复挑战（旧版自由回复存档）
  replyBest: number | null; // 回复挑战历史最佳（到达关数，12=通关；第七轮玩法）
  treeStreak: { last: string | null; n: number }; // 爱情树：我连续浇树（last=最近浇水日）
  treeCards: TreeCard[]; // 许愿树留言卡（最新在前，最多 30 张；已下线，仅作迁移源保留）
  treeCardDay?: string; // TA（AI）挂卡去重（每天最多一张）
  boardNotes: BoardNote[]; // 留言板便签（最新在前，最多 60 张；unlockAt 非空 = 时间胶囊）
  boardNoteDay?: string; // TA（AI）钉便签去重（每天最多一张）
  boardBg?: number; // 留言板背景：0-5=内置 6 张背景图，100+=手机上传的自定义背景（boardBgCustom 下标 + 100）
  boardBgCustom?: { src: string; veil: number }[]; // 手机上传的自定义背景（canvas 压缩后的 dataURL + 按亮度定的纱罩；最多 4 张）
  boardCardCustom?: BoardCardCustom[]; // 手机上传的自定义便签卡纸（canvas 压缩 dataURL + 宽高比 + 自动检测的顶部避让；最多 4 张；card=100+下标）
  boardCardSlim?: boolean; // 卡纸清单精简迁移已做过（样式二三四六/小熊兔兔猫猫下线 → 旧索引归一）
  boardCardSlim2?: boolean; // v44 第二轮精简（被窝小熊/水墨/乐谱/云雾/撑伞下线，只留样式一/样式五 + 新便签纸卡）
  taMissYou: number; // TA（AI）想你累计（第九轮：AI 每天想你）
  taMissYouByDay: Record<string, number>; // TA 每日想你
  taTreeStreak: { last: string | null; n: number }; // TA 连续浇树
  quizTa: { q: string; a: string; at: number; withMe?: boolean }[]; // AI 的问答回答（每题保留最近一次；withMe=和我一起答的）
  aiImpressions: string[]; // AI 贴给我的印象标签
  aiImpressAt: number | null; // AI 上次贴印象时间
  aiPhotoDay?: string; // AI 往相册放照片去重（每 2 天最多一张，第五十六轮；可选字段旧数据无）
  aiAnnivKeys: string[]; // AI 添加的纪念日 key
  aiHundred: { idx: number; note: string; why: string; at: number }[]; // AI 发起的 100 件小事
  aiPact: { title: string; preamble: string; clauses: string[]; at: number; signTa?: string | null; declined?: boolean } | null; // AI 拟的协议草稿（第十六轮起 TA 会先签上自己的名字再分享，等我签；declined=我拒绝了，第二十三轮）
  aiLog: { id: string; text: string; at: number }[]; // AI 行为日志
  invite: CoupleInviteMeta; // 邀请元数据（全局唯一：恋人绑定/待处理邀请/每联系人限一次历史）
  comments: { id: string; key: string; from: 'me' | 'ta'; text: string; at: number; rt?: string }[]; // 通用留言线程（第十轮）：相册照片/日记/印象/挑战讨论下的双向留言；rt=所回复的 TA 留言 id（第十二轮点击回复）
  taTrail: { dateKey: string; items: { t: string; place: string; note: string; icon?: string; who?: 'me' | 'ta'; text?: string }[]; at: number } | null; // TA 今天去过的地方 + 我的手机动态（人设记忆+上下文+真实时间生成；第十八轮带图标/who，独立界面时间线展示）
  replyTa: { active: boolean; picks: Record<string, { pick: number; say: string; at: number }>; mePicks: Record<string, { pick: number; text: string }>; startedAt: number; endedAt: number | null } | null; // 回复挑战双人闯关（TA 同时作答）
  replyRun: { levels: DynReplyLevel[]; myPicks: Record<string, number>; at: number } | null; // 回复挑战本次动态出题（第十二轮：每次开题都不一样，AI 生成）
  replyVerdict: { win: boolean; comment: string; msg: string; at: number } | null; // 回复挑战结算：AI 判定的胜负 + 总评 + TA 想说的话
  locFollow: { me?: string | null; ta?: string | null }; // 轨迹位置跟随联系人 APP：上次同步的 region 文本
  statusExam: { my: Record<string, number>; ta: Record<string, number>; at: number | null; rep?: { me: StatusResult; ta: StatusResult; overall: string } | null } | null; // 恋爱状态测评：双方答题记录 + 生成过的报告（我和 AI 同步答）
  examPaper: { id: string; title: string; notes: string[]; questions: { q: string; opts: string[]; best?: number }[]; source: 'me' | 'ta'; at: number; taLive?: { picks: Record<string, number>; thoughts: Record<string, string> } | null } | null; // 恋爱水平考试：当前激活的试卷（可反复作答；source='ta'=TA 出卷喊我答；taLive=第二十一轮陪答：TA 的同步选择与想法）
  examTaPaper: { id: string; title: string; notes: string[]; questions: { q: string; opts: string[] }[]; at: number; answered?: boolean } | null; // 恋爱水平考试：TA 出卷喊我答的卷子（点聊天卡片直达答题）
  examTaSheet: { title: string; picks: Record<string, number>; score?: number; comment?: string; at: number; myScore?: number | null; myComment?: string; taReply?: string; myMarks?: Record<string, { ok: boolean; score: number }> } | null; // 恋爱水平考试：TA 的答卷（第十七轮：TA 只作答交卷不自评；myScore/myComment=我给 TA 的批改与批语；myMarks=第二十二轮：我给每题打的对错与分数；taReply=TA 在我批语下的留言）
  examResult: { title: string; score: number; comment: string; answers: Record<string, number>; byTa: boolean; at: number } | null; // 恋爱水平考试：我最近一次被改卷的成绩（分数下面是 TA 想说的话）
  examAiPapers: { id: string; title: string; notes: string[]; questions: { q: string; opts: string[] }[]; at: number }[]; // 恋爱水平考试：AI 出的卷子库（第二十一轮：上滑无限追加、永不消失；10~30 题）
  examHistory: { id: string; title: string; score: number; comment: string; answers: Record<string, number>; byTa: boolean; questions: { q: string; opts: string[]; best: number }[]; at: number }[]; // 恋爱水平考试：做过的卷子存档（第二十一轮「我的卷子」；我的+TA 的都进）
  trailFeed: { id: string; dateKey: string; t: string; kind: string; text: string; detail?: string; at: number; revealAt?: number; sortAt?: number }[]; // 位置与轨迹：动态记录流（第二十一轮：AI 按人设+记忆+真实时间生成；第二十五轮：revealAt 渐进揭示一条条出现、sortAt 排序时间戳）
}


export const STATE_KEY = 'couple-space:state';

/** 9×7 小爱心 path（局部坐标包围盒 0≤x≤9 / 0≤y≤7，中心恰为 (4.5,3.5)），
 * 配套 transform="translate(x y) scale(s) translate(-4.5 -3.5)" 定位——平移坐标即爱心中心 */

export const LOVE_HEART_PATH =
  'M4.5 7 C4.5 7 0 4.2 0 1.75 C0 0.78 0.9 0 2 0 C3 0 3.95 0.57 4.5 1.45 C5.05 0.57 6 0 7 0 C8.1 0 9 0.78 9 1.75 C9 4.2 4.5 7 4.5 7 Z';


export function defaultState(): CoupleState {
  return {
    v: 1,
    accepted: false,
    anniversary: null,
    meName: '',
    meAvatar: null,
    taName: '',
    taAvatar: null,
    signature: '',
    homeBg: null,
    homeVeil: 0,
    missYou: 0,
    missYouByDay: {},
    missSince: null,
    gender: '',
    coupleNo: '',
    logins: [],
    annivExtra: [],
    tree: 0,
    letters: [],
    letterDraft: '',
    letterEnv: 'pinkbunny',
    letterEnvText: '',
    letterSenderName: '',
    letterSenderAvatar: '',
    aiLetters: [],
    albums: [
      { id: 'ta', name: '拍给TA看', desc: '想看看你每天的样子', photos: [] },
      { id: 'chat', name: '聊天记录', desc: '上传好玩的甜蜜聊天记录', photos: [] },
      { id: 'diary', name: '日记相册', desc: '记录每天的心情', photos: [] },
      { id: 'anniv', name: '纪念日相册', desc: '记录重要的日子', photos: [] },
    ],
    moods: [],
    chronicle: [],
    impressionsMe: [],
    impressionsTa: [],
    hundred: [],
    hundredItems: {},
    missCards: 0,
    missMadeUp: [],
    stoneEngraved: false,
    statusExam: null,
    quiz: [],
    quizCustom: [],
    examBest: null,
    status: '',
    pactAt: null,
    pactTitle: '恋爱协议书',
    pactPreamble: '为维护双方的感情与信任，促进彼此理解与成长，建立健康、稳定、真诚的亲密关系，双方经友好协商，达成如下协议，共同遵守：',
    pactClauses: [
      '做错事情要认真道歉，并用实际行动改正',
      '即使意见不同，也要尊重对方的选择和感受',
      '每天睡前都要通电话或者视频',
      '爱屋及乌，尊重并融入对方的圈子',
      '不能轻易说分手',
      '少喝碳酸饮料少吃垃圾食品按时吃饭睡觉',
    ],
    pactSignMe: null,
    pactSignTa: null,
    pactMeAt: null,
    pactTaAt: null,
    zodiac: null,
    zodiacReading: null,
    tarotReadings: {},
    married: false,
    marriedAt: null,
    meetPlace: '',
    myLoc: null,
    taLoc: null,
    meetLoc: null,
    chronicleMonths: [],
    pacts: [],
    replies: [],
    replyBest: null,
    treeStreak: { last: null, n: 0 },
    treeCards: [],
    treeCardDay: undefined,
    boardNotes: [],
    boardNoteDay: undefined,
    taMissYou: 0,
    taMissYouByDay: {},
    taTreeStreak: { last: null, n: 0 },
    quizTa: [],
    aiImpressions: [],
    aiImpressAt: null,
    aiAnnivKeys: [],
    aiHundred: [],
    aiPact: null,
    aiLog: [],
    invite: emptyInviteMeta(),
    comments: [],
    taTrail: null,
    replyTa: null,
    replyRun: null,
    replyVerdict: null,
    locFollow: {},
    examPaper: null,
    examTaPaper: null,
    examTaSheet: null,
    examResult: null,
    examAiPapers: [],
    examHistory: [],
    trailFeed: [],
  };
}

/**
 * 心情 emoji 合法化：旧数据/AI 早期写入可能存了 MOOD_LIST 之外的值（空串/🫶等）→ 映射回有效心情（修复“AI 表情不显示”）
 * 依据日记正文关键词推断；推不出时空串（本意是爱心）回 🥰，其余回 🤔。
 */

export function normMoodEmoji(emoji: string, text?: string): string {
  if (MOOD_LIST.some((m) => m.emoji === emoji)) return emoji;
  const t = text ?? '';
  const has = (arr: string[]) => arr.some((k) => t.includes(k));
  if (has(['累', '困', '睡', '熬夜'])) return '😴';
  if (has(['哭', '难过', '伤心', '委屈', '失落'])) return '😢';
  if (has(['气', '烦', '怒', '吵'])) return '😤';
  if (has(['甜', '爱', '亲', '抱', '喜欢你'])) return '🥰';
  if (has(['开心', '笑', '玩', '快乐', '哈哈'])) return '😊';
  if (has(['想', '念'])) return '🥲';
  return emoji === '' ? '🥰' : '🤔';
}

/** 读取持久化状态（缺失字段用默认值补齐，防旧数据缺键；含旧数据修复） */

export const MOOD_LIST = [
  { emoji: '😊', label: '开心', c: '#f8d05e', d: '#e2b23c' },
  { emoji: '🥰', label: '甜蜜', c: '#f6bfcb', d: '#e59cad' },
  { emoji: '😴', label: '困困', c: '#cdccdb', d: '#a8a7bf' },
  { emoji: '😤', label: '生气', c: '#f08a78', d: '#d96a58' },
  { emoji: '😢', label: '委屈', c: '#93bbe9', d: '#709bd2' },
  { emoji: '🤔', label: '思考', c: '#eac59b', d: '#d2a774' },
  { emoji: '🤩', label: '兴奋', c: '#f4ab6d', d: '#de8c4c' },
  { emoji: '🥲', label: '想TA', c: '#c6b0e2', d: '#aa90cb' },
];

export function loadCoupleState(): CoupleState {
  try {
    const raw = kvGet<Partial<CoupleState>>(STATE_KEY);
    if (!raw) return defaultState();
    const merged: CoupleState = {
      ...defaultState(),
      ...raw,
      // invite 子对象深合并（旧数据无 invite 键 → 默认；存在但缺字段 → 逐字段兜底）
      invite: { ...emptyInviteMeta(), ...(raw.invite ?? {}) },
      v: 1,
    };
    // 修复一：AI 早期写的日记 emoji 为空串/🫶 → MoodFace 找不到对应心情导致不显示；映射回有效表情
    if (Array.isArray(merged.moods)) {
      merged.moods = merged.moods.map((m) => ({ ...m, emoji: normMoodEmoji(m.emoji, m.text) }));
    }
    // 修复二：用户是女生 → 「男友力max」标签改为「女友力max」（AI 贴的和手动的都修正）
    if (merged.gender === '女') {
      const swap = (arr: string[]) => arr.map((t) => (t === '男友力max' ? '女友力max' : t));
      if (Array.isArray(merged.impressionsMe)) merged.impressionsMe = swap(merged.impressionsMe);
      if (Array.isArray(merged.aiImpressions)) merged.aiImpressions = swap(merged.aiImpressions);
    }
    // 修复三：许愿树下线 → 留言板一次性迁移（旧 treeCards 转成第一批便签；颜色/留言原样保留）
    if ((merged.boardNotes ?? []).length === 0 && (merged.treeCards ?? []).length > 0) {
      merged.boardNotes = merged.treeCards.map((c) => ({
        id: c.id,
        from: c.from,
        text: c.text,
        at: c.at,
        color: c.color,
        comments: c.comments ?? [],
      }));
    }
    // 修复四：卡纸清单精简（只留样式一/样式五 + 五张新便签卡）→ 旧便签的卡索引一次性归一
    // （旧 1=样式一不变；旧 5=样式五→新 2；旧 2/3/4/6/7/8/9 已下线 → 归样式一；仅首次执行，靠 boardCardSlim 落盘标记防重跑）
    if (!raw.boardCardSlim) {
      merged.boardCardSlim = true;
      if (Array.isArray(merged.boardNotes) && merged.boardNotes.length > 0) {
        merged.boardNotes = merged.boardNotes.map((n) => {
          const c = n.card ?? 0;
          if (c <= 0) return n;
          const mapped = c === 5 ? 2 : 1;
          return mapped === c ? n : { ...n, card: mapped };
        });
      }
    }
    // v44 修复五：第二轮卡纸精简（用户要求只留样式一/样式五 + 新增便签纸卡）→
    // 上轮留下的五张图案卡（旧 3-7：被窝小熊/水墨/乐谱/云雾/撑伞）归样式一；
    // 新「便签纸」占用新索引 3（此迁移后重新可选）；仅首次执行，靠 boardCardSlim2 落盘标记防重跑
    if (!raw.boardCardSlim2) {
      merged.boardCardSlim2 = true;
      if (Array.isArray(merged.boardNotes) && merged.boardNotes.length > 0) {
        merged.boardNotes = merged.boardNotes.map((n) => {
          const c = n.card ?? 0;
          if (c >= 3 && c < 100) return { ...n, card: 1 };
          return n;
        });
      }
    }
    return merged;
  } catch {
    return defaultState();
  }
}

// ---------------- 业务常量池 ----------------

/** 甜蜜小问答题库（每日按日期轮换一题） */

export interface ExamTplQ {
  q: string;
  opts: string[];
  best: number; // 标准答案序号（AI 打分优先，本地分兜底）
}

export interface ExamTpl {
  id: string;
  title: string;
  usage: string; // 使用人数展示
  notes: string[]; // 注意事项
  questions: ExamTplQ[];
}

export const ZODIAC_GROUP: Record<string, 'fire' | 'earth' | 'air' | 'water'> = {
  白羊座: 'fire', 狮子座: 'fire', 射手座: 'fire',
  金牛座: 'earth', 处女座: 'earth', 摩羯座: 'earth',
  双子座: 'air', 天秤座: 'air', 水瓶座: 'air',
  巨蟹座: 'water', 天蝎座: 'water', 双鱼座: 'water',
};


export function zodiacScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 92;
  const ga = ZODIAC_GROUP[a];
  const gb = ZODIAC_GROUP[b];
  if (ga === gb) return 88;
  const fireAir = (ga === 'fire' && gb === 'air') || (ga === 'air' && gb === 'fire');
  const earthWater = (ga === 'earth' && gb === 'water') || (ga === 'water' && gb === 'earth');
  if (fireAir || earthWater) return 85;
  // 同名固定基数 + 星座名长度做扰动（确定性，同组合每次结果一致）
  return 70 + ((a.length * 7 + b.length * 5) % 8);
}

/** 恋爱状态选项 */


// ---------------- 小工具 ----------------

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 纪念日 → 在一起天数（含当天，最小 1） */

export function daysSince(anniv: string | null): number | null {
  if (!anniv) return null;
  const t = new Date(`${anniv}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((base.getTime() - t.getTime()) / 86400000) + 1;
  return diff >= 1 ? diff : 1;
}

/** 每天想你连续打卡天数（第九轮：点击「每天想你」当天才 +1，不点不涨、断签清零重计）：
 *  从今天往回逐日数 missYouByDay>0 或 missMadeUp 的连续天数；今天还没打卡则从昨天起算
 *  （避免早上打开归零——昨天的连续还成立，今天点一下就会涨到新连续） */

export function missStreakOf(s: Pick<CoupleState, 'missYouByDay' | 'missMadeUp'>): number {
  const madeUp = new Set(s.missMadeUp || []);
  const hit = (k: string) => (s.missYouByDay?.[k] || 0) > 0 || madeUp.has(k);
  const d = new Date();
  if (!hit(todayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  for (;;) {
    if (!hit(todayKey(d))) break;
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}


export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成情侣号（s + 9 位大小写字母数字，参考图样式如 sTCS9PFVKL） */

export function genCoupleNo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 's';
  for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 'YYYY-MM-DD' → 中文日期 + 星期（如 2006年6月20日 周二） */

export function fmtDateCn(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`;
}

/** 时间戳 → 「M-DD HH:mm」（第二十一轮：信箱/信封卡片只显示时间，参考截图「10-26 00:17」） */

export function fmtMDHM(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 距离最近一个生日的天数（ MM-DD 重复出现；当天→0，已过→明年） */

export function daysToNextMonthDay(md: string): number | null {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(md);
  if (!m) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(`${now.getFullYear()}-${m[1]}T00:00:00`);
  if (Number.isNaN(next.getTime())) return null;
  if (next.getTime() < base.getTime()) next = new Date(next.getTime() + 365 * 86400000 + 6 * 3600000);
  return Math.round((next.getTime() - base.getTime()) / 86400000);
}

/** 像素爱心（参考图「我们」页双头像之间的小像素心，白灰配色） */

export function PixelHeart({ size = 40 }: { size?: number }) {
  const px = size / 7;
  const cells: [number, number][] = [
    [1, 0], [2, 0], [4, 0], [5, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
    [1, 3], [2, 3], [3, 3], [4, 3], [5, 3],
    [2, 4], [3, 4], [4, 4],
    [3, 5],
  ];
  return (
    <svg width={size} height={size * 0.9} viewBox={`0 0 7 ${7 * 0.9}`} aria-hidden="true">
      {cells.map(([x, y], i) => (
        <rect key={i} x={x * px} y={y * px} width={px * 1.02} height={px * 1.02} rx={px * 0.22} fill={i % 3 === 0 ? '#b9b9c1' : '#8e8e97'} />
      ))}
    </svg>
  );
}

/**
 * 手绘蜡笔风心情表情（参考截图的圆脸涂鸦风）：
 * 不规则圆脸 + 各心情专属五官/装饰（口水笑/星星眼/泪滴/怒气线/思考泡/zzz…）
 */

export function MoodFace({ mood, size = 40, className = '' }: { mood: string; size?: number; className?: string }) {
  const meta = MOOD_LIST.find((m) => m.emoji === mood);
  if (!meta) {
    return (
      <span className={`flex items-center justify-center rounded-full bg-[#ececef] dark:bg-zinc-900/80 ${className}`} style={{ width: size, height: size }}>
        <Smile className="h-1/2 w-1/2 text-[#b6b6bd] dark:text-zinc-500" strokeWidth={1.6} />
      </span>
    );
  }
  const ink = '#4a3d33';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      {/* 不规则蜡笔圆脸 */}
      <path
        d="M50 6 C73 4 94 23 93 49 C92 75 73 94 48 93 C24 92 7 75 7 49 C7 24 27 8 50 6 Z"
        fill={meta.c}
        stroke={meta.d}
        strokeWidth="2.6"
      />
      {meta.emoji === '😊' && (
        <>
          <circle cx="36" cy="43" r="3.4" fill={ink} />
          <circle cx="64" cy="43" r="3.4" fill={ink} />
          <path d="M31 56 Q50 82 69 56 Q50 65 31 56 Z" fill={ink} />
        </>
      )}
      {meta.emoji === '🥰' && (
        <>
          <path d="M29 45 Q36 37 43 45" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M57 45 Q64 37 71 45" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <ellipse cx="27" cy="55" rx="6" ry="3.6" fill="#ffffff" opacity="0.55" />
          <ellipse cx="73" cy="55" rx="6" ry="3.6" fill="#ffffff" opacity="0.55" />
          <path d="M40 59 Q50 69 60 59" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M22 24 c2-4.5 8.5-3.2 8.5 1.2 c0 3.4-4.6 6.2-8.5 9.4 c-3.9-3.2-8.5-6-8.5-9.4 c0-4.4 6.5-5.7 8.5-1.2 Z" fill={meta.d} opacity="0.9" />
        </>
      )}
      {meta.emoji === '😴' && (
        <>
          <path d="M29 44 Q36 50 43 44" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M57 44 Q64 50 71 44" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="63" r="3.4" fill={ink} />
          <text x="68" y="30" fontSize="17" fontWeight="bold" fill={ink} transform="rotate(14 68 30)">z</text>
          <text x="79" y="19" fontSize="11" fontWeight="bold" fill={ink} transform="rotate(14 79 19)">z</text>
        </>
      )}
      {meta.emoji === '😤' && (
        <>
          <path d="M28 35 L42 42" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M72 35 L58 42" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="37" cy="49" r="3" fill={ink} />
          <circle cx="63" cy="49" r="3" fill={ink} />
          <path d="M40 67 Q50 58 60 67" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M63 14 l7 7 M74 10 l2.6 10.4 M84 17 l-7.4 5.6" stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </>
      )}
      {meta.emoji === '😢' && (
        <>
          <path d="M29 34 Q36 31 43 35" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M71 34 Q64 31 57 35" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="36" cy="45" r="3.2" fill={ink} />
          <circle cx="64" cy="45" r="3.2" fill={ink} />
          <path d="M32 53 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#b7d4f4" stroke={meta.d} strokeWidth="1.4" />
          <path d="M68 53 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#b7d4f4" stroke={meta.d} strokeWidth="1.4" />
          <path d="M41 68 Q45.5 63.5 50 68 Q54.5 72.5 59 68" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      )}
      {meta.emoji === '🤔' && (
        <>
          <path d="M29 32 Q36 28.5 43 33" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M57 38 Q64 35.5 71 39" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="36" cy="45" r="3.2" fill={ink} />
          <circle cx="64" cy="47" r="3.2" fill={ink} />
          <path d="M43 66 L58 62" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="73" cy="27" r="3.4" fill={ink} opacity="0.85" />
          <circle cx="81" cy="18" r="2.4" fill={ink} opacity="0.7" />
          <circle cx="88" cy="11" r="1.6" fill={ink} opacity="0.55" />
        </>
      )}
      {meta.emoji === '🤩' && (
        <>
          <path d="M0 -7.5 L2.2 -2.2 7.5 0 2.2 2.2 0 7.5 -2.2 2.2 -7.5 0 -2.2 -2.2 Z" transform="translate(36 43)" fill={ink} />
          <path d="M0 -7.5 L2.2 -2.2 7.5 0 2.2 2.2 0 7.5 -2.2 2.2 -7.5 0 -2.2 -2.2 Z" transform="translate(64 43)" fill={ink} />
          <path d="M31 58 Q50 82 69 58 Q50 66 31 58 Z" fill={ink} />
        </>
      )}
      {meta.emoji === '🥲' && (
        <>
          <path d="M36 38 c2.6-4.6 9.2-3.2 9.2 1.4 c0 3.6-5 6.6-9.2 10 c-4.2-3.4-9.2-6.4-9.2-10 c0-4.6 6.6-6 9.2-1.4 Z" transform="translate(0 -1) scale(0.62) translate(22 26)" fill={meta.d} />
          <path d="M64 38 c2.6-4.6 9.2-3.2 9.2 1.4 c0 3.6-5 6.6-9.2 10 c-4.2-3.4-9.2-6.4-9.2-10 c0-4.6 6.6-6 9.2-1.4 Z" transform="translate(0 -1) scale(0.62) translate(41 26)" fill={meta.d} />
          <path d="M41 62 Q50 70 59 62" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M71 52 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#cdbdf0" stroke={meta.d} strokeWidth="1.3" />
        </>
      )}
    </svg>
  );
}

/** 头像：有图显示图，无图显示灰底剪影 */

export function CoupleAvatar({ src, name, size, ring = true }: { src: string | null; name: string; size: number; ring?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative shrink-0 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-800 ${ring ? 'ring-2 ring-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]' : ''}`}
        style={{ width: size, height: size }}
      >
        {src ? (
           
          <img src={src} alt={name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <DefaultAvatar size={size} />
        )}
      </div>
      <span className="max-w-[88px] truncate text-[13px] font-medium text-[#5a5a62] dark:text-zinc-300">{name || '…'}</span>
    </div>
  );
}


// ---------------- 主组件 ----------------

export type TabKey = 'home' | 'discover' | 'album' | 'us';


export type SubPage =
  | 'board' | 'track' | 'quiz' | 'letters'
  | 'house' | 'mood' | 'tarot' | 'hundred' | 'pact' | 'exam' | 'zodiac'
  | 'chronicle' | 'stone' | 'reply' | 'hotel' | 'status' | 'impress'
  | 'profile' | 'missyou' | 'chapel' | 'support' | 'settings'
  | 'album' | 'anniv';


// ---------------- 子页容器 ----------------

export function SubShell(props: { title: string; onBack: () => void; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-[#f6f6f8]/92 dark:bg-zinc-900/92 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={props.onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold">{props.title}</div>
          <div className="ml-auto flex items-center gap-2.5 pr-1.5">{props.right}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-3.5 pb-8">{props.children}</div>
    </div>
  );
}

// ---------------- 子页路由 ----------------

/** 主组件 patch 的宽化签名（支持函数式 updater；运行时总是宽化的） */

export type PatchFn = (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;

/**
 * 通用留言线程（第十轮 → 第十二轮重做样式）。
 * 样式仿微信朋友圈评论区 + 参考截图（照片留言气泡）：我发消息（粉色右侧）→ AI（TA）根据人设记忆自动回复（左侧，可多轮往返）；
 * 所有留言一律不显示「名字：」前缀（第十二轮用户要求：所有留言删除名字和冒号）；
 * 每条留言带朋友圈式灰色时间（刚刚/x分钟前/1小时前…）；
 * 点击 TA 的留言即可针对那一条回复（引用条可取消，AI 会知道你在回复哪句）；
 * 每一条都进恋人（AI）的记忆（coupleMemoryDiff 统一钩子）。
 */

/** 留言/徽标文本截断（组件内用；超长加省略号） */

export function cutText(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 朋友圈式评论时间（刚刚 / N分钟前 / N小时前 / 昨天 / M月D日） */

export function fmtCmtTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 172_800_000) return '昨天';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}


export function CommentThread({
  state,
  patch,
  threadKey,
  hint,
  dark = false, // 深色背景（相册大图查看）适配
  testId,
}: {
  state: CoupleState;
  patch: PatchFn;
  threadKey: string;
  hint?: string;
  dark?: boolean; // 深色背景（相册大图查看）适配
  testId?: string;
}) {
  const list = useMemo(() => (state.comments ?? []).filter((c) => c.key === threadKey), [state.comments, threadKey]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; text: string } | null>(null); // 点击某条留言 → 针对性回复（朋友圈评论区交互）
  const me = state.meName || '我';
  const ta = state.taName || 'TA';
  /** 历史留言文本里的「名字：」前缀统一剥掉（新版样式自带名字前缀，旧数据兼容防重复） */
  const stripNamePrefix = (t: string) => {
    for (const n of [ta, me, 'TA', '我']) {
      if (n && t.startsWith(`${n}：`)) return t.slice(n.length + 1).trim();
    }
    return t;
  };
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const c = { id: uid(), key: threadKey, from: 'me' as const, text: t, at: Date.now(), ...(replyTo ? { rt: replyTo.id } : {}) };
    patch((prev) => ({ comments: [...(prev.comments ?? []), c] }));
    setText('');
    setReplyTo(null);
    scheduleAiReply(threadKey); // AI（TA）延时回复（fire-and-forget）
  };
  const inputCls = dark
    ? 'h-10 flex-1 rounded-full bg-white/10 px-4 text-[13.5px] text-white outline-none placeholder:text-white/35'
    : 'h-10 flex-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 text-[13.5px] text-[#2c2c30] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500';
  // 名字配色（朋友圈评论区：名字是一个颜色、正文一个颜色）——TA 用微信链蓝、我用主题粉，一眼分清谁说的
  const taNameCls = dark ? 'text-white' : 'text-[#26262b] dark:text-zinc-100';
  const meNameCls = dark ? 'text-white' : 'text-[#26262b] dark:text-zinc-100';
  return (
    <div data-testid={testId} className={dark ? 'rounded-2xl bg-white/[0.06] p-3.5' : 'rounded-2xl bg-[#f7f7f9] dark:bg-zinc-900/70 p-3.5'}>
      <div className={dark ? 'text-[12.5px] font-semibold text-white/60' : 'text-[12.5px] font-semibold text-[#6e6e76] dark:text-zinc-300'}>
        {hint || `和 ${ta} 聊聊`}
        {list.length > 0 && <span className="ml-1.5 font-normal opacity-60">· {list.length} 条留言</span>}
      </div>
      {list.length > 0 && (
        <div className={dark ? '' : ''}>
          {list.map((c, i) => {
            const body = stripNamePrefix(c.text);
            const isTa = c.from === 'ta';
            const name = isTa ? ta : me;
            const nameCls = isTa ? taNameCls : meNameCls;
            // 被回复的留言名（朋友圈式「回复XX：」前缀）
            const rtName = c.rt ? (list.find((x) => x.id === c.rt)?.from === 'me' ? me : ta) : null;
            return (
              <div
                key={c.id}
                role={isTa ? 'button' : undefined}
                tabIndex={isTa ? 0 : undefined}
                onClick={isTa ? () => setReplyTo({ id: c.id, name, text: body }) : undefined}
                onKeyDown={isTa ? (e) => e.key === 'Enter' && setReplyTo({ id: c.id, name, text: body }) : undefined}
                className={`flex items-start justify-between gap-3 py-2.5 ${i < list.length - 1 ? (dark ? 'border-b border-white/10' : 'border-b border-black/[0.07] dark:border-white/10') : ''} ${
                  isTa ? 'cursor-pointer text-left transition-opacity active:opacity-60' : ''
                }`}
              >
                <span className={`min-w-0 text-[14px] leading-[1.55] ${dark ? 'text-white/90' : 'text-[#2c2c30] dark:text-zinc-100'}`}>
                  {rtName && (
                    <>
                      <span className={rtName === ta ? taNameCls : meNameCls}>回复{rtName}</span>
                      <span>：</span>
                    </>
                  )}
                  <span className={nameCls}>{name}</span>
                  <span>：{body}</span>
                </span>
                <span className={`shrink-0 pt-0.5 text-[12px] leading-none ${dark ? 'text-white/35' : 'text-[#b0b0b8] dark:text-zinc-500'}`}>{fmtCmtTime(c.at)}</span>
              </div>
            );
          })}
        </div>
      )}
      {replyTo && (
        <div className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] ${dark ? 'bg-white/[0.07] text-white/55' : 'bg-white dark:bg-zinc-800/95 text-[#8e8e96] dark:text-zinc-400'}`}>
          <span className="min-w-0 flex-1 truncate">
            回复 {replyTo.name}：{cutText(replyTo.text, 24)}
          </span>
          <button type="button" aria-label="取消回复" onClick={() => setReplyTo(null)} className={`shrink-0 text-[13px] leading-none ${dark ? 'text-white/40' : 'text-[#b6b6bd] dark:text-zinc-500'}`}>
            ×
          </button>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={replyTo ? `回复 ${replyTo.name}…` : `想对 ${ta} 说什么…`}
          maxLength={80}
          className={inputCls}
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          aria-label="发送留言"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_3px_10px_rgba(242,83,106,0.30)] transition-transform active:scale-95 disabled:opacity-40"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

export const noteColorOf = (n: BoardNote) => NOTE_COLORS[(n.color ?? 7) % NOTE_COLORS.length];

/** 时间胶囊解锁时间预设（chips；ms = 解锁时间戳） */

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '可以开启了';
  const m = Math.floor(ms / 60000);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `还有 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `还有 ${hours} 小时 ${mins} 分`;
  return `还有 ${mins} 分`;
}

/** 留言墙背景图清单（用户上传的 6 张图全部铺满；veil = 按各图中部亮度定制的暖白纱罩浓度，保证便签/文字可读） */

export function wallStyleOf(bg: number | undefined, customs?: { src: string; veil: number }[]): CSSProperties {
  const v = bg ?? 0;
  if (v >= 100) {
    const c = customs?.[v - 100];
    if (c) {
      return {
        backgroundImage: `linear-gradient(rgba(250,247,240,${c.veil}),rgba(250,247,240,${c.veil})),url("${c.src}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
  }
  const i = Math.max(0, Math.min(BOARD_BGS.length - 1, v));
  const veil = BOARD_BGS[i].veil;
  return {
    backgroundImage: `linear-gradient(rgba(250,247,240,${veil}),rgba(250,247,240,${veil})),url(/board-bg/bg-${i}.jpg)`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

/** 便签图案卡纸清单（v44：只留样式一/样式五 + 新便签纸卡；v45：用户参考图 5 张全部加入——
 *  手绘涂鸦/水彩蝴蝶/蕾丝乐谱/枝头双兔/朦胧少女；清单在 @/lib/ios/couple-board-cards，与 AI 选卡共用） */

/** 便签的卡面样式（图案卡 = 图 cover 铺满无白边（含自定义上传卡）；素白卡 = 调色盘纯色）
 *  v45：带顶部插画的图案卡（手绘涂鸦/便签纸）附 proportional paddingTop——
 *  详情大卡（NoteDetail）与书写预览共用此让位；墙上（BoardNoteCard）会按实际渲染
 *  宽度重算覆盖同名字段，不会双算。 */

export function noteFaceStyle(note: BoardNote, customs?: BoardCardCustom[]): CSSProperties {
  const card = note.card ?? 0;
  if (card > 0) {
    const skin = boardCardSkinOf(card, customs);
    if (skin) {
      const face: CSSProperties = { backgroundImage: skin.bgImage, backgroundSize: 'cover', backgroundPosition: 'center', color: skin.text };
      if (skin.padTop) face.paddingTop = Math.round((280 / skin.ar) * skin.padTop);
      return face;
    }
  }
  const col = noteColorOf(note);
  return { background: col.bg, color: col.text };
}

/** v44：这张便签的卡面是否自带固定装饰（胶带）→ 不再叠金属别针（便签纸卡） */

export function noteHasOwnDecor(note: BoardNote, customs?: BoardCardCustom[]): boolean {
  const card = note.card ?? 0;
  return card > 0 && boardCardSkinOf(card, customs)?.noPin === true;
}

/** 金属别针/回形针（夹在便签顶上；银色金属渐变 + 高光 + 投影，立体质感） */

export function timeAgoLabel(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return fmtDate(at);
}

/** 100 件小事（手账拼贴风）：标题牌 + 拍立得卡片 + 待完成/已完成邮戳 */
/** 100 件小事（参考图1/2）：粉色手账拼贴 + 拍立得卡片墙（翻页）+ 待完成印章 + 目录/添加小事 + 编辑详情页 */

export function ShareChannelPicker({ title, hint, onSend, onClose }: { title: string; hint?: string; onSend: (channel: CoupleChannel, contactId: string) => void; onClose: () => void }) {
  const [step, setStep] = useState<'app' | 'contact'>('app');
  const [ch, setCh] = useState<CoupleChannel | null>(null);
  const [list, setList] = useState<ContactRecord[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const meta = readInviteMeta();

  useEffect(() => {
    void (async () => {
      try {
        const all = await listContacts();
        const friends = all.filter((c) => (c.isFriend || c.friendWx || c.friendQq) && c.id !== meta.partnerContactId);
        const partner = all.find((c) => c.id === meta.partnerContactId);
        setList(partner ? [partner, ...friends] : friends);
        if (partner) setPicked(partner.id); // 恋人默认选中
      } catch {
        setList([]);
      }
    })();
  }, [meta.partnerContactId]);

  const pickedName = list?.find((c) => c.id === picked);

  return (
    <div className="absolute inset-0 z-[80] flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div
        className="max-h-[78%] overflow-y-auto rounded-t-3xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-9 pt-4 shadow-2xl [animation:couple-sub-in_.24s_ease-out]"
        onClick={(e) => e.stopPropagation()}
        data-testid="share-picker"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5] dark:bg-zinc-900/80" />
        <div className="mt-3 text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">{step === 'contact' && ch ? `发送到${ch === 'wx' ? '微信' : 'QQ'}` : title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">
          {step === 'app' ? hint || '选择渠道和要发送的 AI 好友' : `从${ch === 'wx' ? '微信' : 'QQ'}好友里选一位，恋人会置顶并默认选中`}
        </div>

        {step === 'app' && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {([
              { key: 'wx' as const, name: '通过微信发送', img: '/icons/wechat.png' },
              { key: 'qq' as const, name: '通过QQ发送', img: '/icons/qq.png' },
            ]).map((a) => (
              <button
                key={a.key}
                type="button"
                data-testid={`share-channel-${a.key}`}
                onClick={() => {
                  setCh(a.key);
                  setStep('contact');
                }}
                className="flex h-14 items-center justify-center gap-2 rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 text-[14px] font-medium text-[#4a4a52] dark:text-zinc-200 transition-colors active:bg-[#ececef] dark:active:bg-zinc-900/80"
              >
                <img src={a.img} alt="" aria-hidden="true" className="h-6 w-6 rounded-md object-cover" draggable={false} />
                {a.name}
              </button>
            ))}
          </div>
        )}

        {step === 'contact' && (
          <>
            <div className="mt-4 max-h-72 space-y-1 overflow-y-auto" data-testid="share-friend-list">
              {list === null ? (
                <div className="py-8 text-center text-[13px] text-[#b6b6bd] dark:text-zinc-500">加载中…</div>
              ) : list.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-[#b6b6bd] dark:text-zinc-500">这个 App 里还没有好友</div>
              ) : (
                list.map((c) => {
                  const isPartner = c.id === meta.partnerContactId;
                  const active = picked === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`share-friend-${c.id}`}
                      onClick={() => setPicked(c.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${active ? 'bg-[#fdeef1] dark:bg-rose-300/10' : 'active:bg-[#f3f3f5] dark:active:bg-zinc-900/70'}`}
                    >
                      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                        {avatarFor(c, ch ?? 'wx') ? <img src={avatarFor(c, ch ?? 'wx') ?? ''} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] text-[#2c2c30] dark:text-zinc-100">{displayNameOf(c)}</span>
                        {isPartner && <span className="mt-0.5 inline-block rounded-full bg-[#fdeef1] dark:bg-rose-300/10 px-1.5 py-px text-[10px] font-medium text-[#f2536a] ring-1 ring-[#f2536a]/25">恋人</span>}
                      </span>
                      <span className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border-2 ${active ? 'border-[#f2536a] bg-[#f2536a]' : 'border-[#d9d9de] dark:border-white/10'}`}>
                        {active && <Check className="h-3 w-3 text-white" strokeWidth={3.2} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setStep('app')} className="h-11 flex-1 rounded-2xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300 active:bg-[#e8e8ec] dark:active:bg-zinc-900/80">
                上一步
              </button>
              <button
                type="button"
                data-testid="share-send"
                disabled={!picked}
                onClick={() => {
                  if (picked && ch) onSend(ch, picked);
                }}
                className="h-11 flex-1 rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[15px] font-bold text-white shadow-[0_5px_14px_rgba(242,83,106,0.30)] disabled:opacity-40"
              >
                发送{pickedName ? `给 ${displayNameOf(pickedName)}` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 情书（原未来情书，参考截图：黑色星空治愈风）—— 主视图（信封）→ 告白页 → 编辑信件（信纸/字体/信封/虚线工具栏/多页翻页）→ 发送设置（即时/定时拆信，参照「慢邮邮」截图重做）→ 信箱（TA 的信 + 我的信 + 信下留言 + 分享给 TA） */

export function statusDimScore(picks: Record<string, number>, dim: string): number {
  const items = STATUS_EXAM.map((it, i) => ({ it, i })).filter((x) => x.it.dim === dim);
  let got = 0;
  let full = 0;
  for (const { it, i } of items) {
    const p = picks[String(i)];
    full += 4;
    if (p != null) got += Math.max(0, Math.min(4, 4 - p));
  }
  if (full === 0) return 0;
  return Math.round((got / full) * 100);
}

/** 本地兜底称号（LLM 不可用时） */

export function statusTierTitle(score: number): string {
  if (score >= 88) return '灵魂共振型恋人';
  if (score >= 76) return '热恋进行时';
  if (score >= 62) return '稳定升温期';
  if (score >= 48) return '平稳陪伴期';
  if (score >= 34) return '需要用心的时期';
  return '亟待修复的信号';
}

/** 从 LLM 文本里提取 JSON（容忍代码块包裹） */

export function statusExtractJson(text: string): { me?: Partial<StatusResult>; ta?: Partial<StatusResult>; overall?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as { me?: Partial<StatusResult>; ta?: Partial<StatusResult>; overall?: string };
  } catch {
    return null;
  }
}

/** 本地兜底报告：按维度分直接生成（不依赖 LLM） */

export function statusLocalReport(myPicks: Record<string, number>, taPicks: Record<string, number>, me: string, ta: string): { me: StatusResult; ta: StatusResult; overall: string } {
  const one = (picks: Record<string, number>, name: string): StatusResult => {
    const score = Math.round((statusDimScore(picks, '亲密') + statusDimScore(picks, '激情') + statusDimScore(picks, '承诺')) / 3);
    const title = statusTierTitle(score);
    const low = (['亲密', '激情', '承诺'] as const).map((d) => ({ d, v: statusDimScore(picks, d) })).sort((a, b) => a.v - b.v)[0];
    const advice =
      score >= 76
        ? ['保持现在的相处节奏，把甜蜜延续下去', '定期给彼此制造一点小惊喜', '继续认真回应对方的每一次分享']
        : [`多花点心思在「${low.d}」上，这是你们目前最需要滋养的部分`, '每周留一段只属于两个人的谈心时间', '把「想对方」说出口，别只放在心里'];
    return { score, title, summary: `${name}在这段关系里的投入度约为 ${score} 分，当前处于「${title}」阶段，${low.d}维度相对薄弱。`, advice };
  };
  const meR = one(myPicks, me);
  const taR = one(taPicks, ta);
  const overall = `你们一个 ${meR.score} 分、一个 ${taR.score} 分，${Math.abs(meR.score - taR.score) <= 8 ? '对这段感情的感受高度一致，节奏很合拍' : '感受有些温差，多聊聊彼此的期待会更甜'}。`;
  return { me: meR, ta: taR, overall };
}

/** 恋爱状态分析（第十一轮重做，参考图4/5）：粉渐变落地页 + 18 题双人对答（我粉勾/TA蓝勾）+ 双报告（用户配置 API 模型生成） */

export function HomeVeil({ level }: { level: number }) {
  const v = Math.max(0, Math.min(100, level)) / 100;
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ backdropFilter: `blur(${(v * 10).toFixed(1)}px)`, WebkitBackdropFilter: `blur(${(v * 10).toFixed(1)}px)` }}
      />
      <div className="absolute inset-0 bg-white dark:bg-zinc-800/95" style={{ opacity: v * 0.72 }} />
    </>
  );
}

/** 设置：换背景 / 白纱模糊度 / 解除关系（重置） / 关于 */
