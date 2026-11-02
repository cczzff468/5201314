'use client';

/**
 * 情侣空间 App（恋人空间，原情侣空间）——白/浅灰定制配色版。
 *
 * 用户规格：按提供的 5 张参考截图 1:1 复刻结构（邀请页 / 首页 / 发现 / 相册 / 我们），
 * 全站配色不用粉色/红色，改用白色 + 浅灰（主强调色为炭灰渐变，深灰白字保证对比）。
 *
 * 页面结构（对应参考图）：
 * - 邀请页（图1）：全屏渐变底 + 装饰圆与浮点 + 恋人头像/昵称 + 「邀请你开通恋人空间」
 *   + 左上角返回键 + 「接受邀请」大按钮 + 底部「在恋人空间你们可以体验这些」三体验卡（情侣相册/爱情树/纪念日）
 * - 首页（图2）：恋人空间大标题 + 双头像虚线连接 + 中间纪念日气泡（点击设置→已相恋 N 天）
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IdCard,
  Image as ImageIcon,
  ImagePlus,
  AlignJustify,
  Info,
  Landmark,
  Lightbulb,
  Loader2,
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
  Sprout,
  Star,
  Trash2,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
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
// 第十六轮：AI 情绪系统（TA 头像下的心情小胶囊）
import { aiMoodOf, MOOD_DISPLAY } from '@/lib/ios/ai-mood';
import { aiAnswerWithMe, aiCommentOnPhoto, aiCommentOnPhotoLazy, aiDecideCouplePhoto, aiReplyPickForLevel, aiReplyVerdict, aiStatusPick, aiTickTrail, aiTrailFeed, aiZodiacReading, coupleMemoryDiff, coupleRemember, genReplyLevels, pokeTaDiary, rememberStatusExam, runCoupleAiTick, scheduleAiReply, scheduleTreeCardReply, syncLocFromContacts, trailSortMs, isGenPhoto, isTextPhoto, photoSrc, type CouplePhotoEntry, type CoupleTextPhoto, type CoupleTrailRec, type DynReplyLevel } from '@/lib/ios/couple-ai';
import { HUNDRED_LIST } from '@/lib/ios/couple-hundred';
import { consumePendingPactOpen, COUPLE_PACT_NAV_EVENT, patchPactCardsWhere, peekPendingPactOpen, scheduleAiPactDecision, sendPactCard } from '@/lib/ios/couple-pact-share';
import { consumePendingExamOpen, COUPLE_EXAM_NAV_EVENT, peekPendingExamOpen, scheduleAiExamAnswer, sendExamCard } from '@/lib/ios/couple-exam-share';
import { consumePendingLetterOpen, COUPLE_LETTER_NAV_EVENT, peekPendingLetterOpen, scheduleAiLetterFeedback, sendLetterCard } from '@/lib/ios/couple-letter-share';
import { setMtPendingPage } from '@/lib/ios/meituan-store';
import CoupleTarotPage from './couple-tarot';
import CoupleHome from './couple-home/CoupleHome';
import type { TarotReadingsMap } from '@/lib/tarot-deck';
import { EnvelopeArt, LETTER_ENVELOPES, petKindOf, PetFace } from './couple-letter-bubble';
import WheelDatePicker from './wheel-date-picker';
import { displayNameOf, isFriendIn, avatarFor, type ContactRecord } from '@/lib/contacts';
import { fileToScaledDataURL, loadProfileCard } from '@/components/ios/ProfileCard';
import { generateCharacterPhoto, imgGenConfigReady } from '@/lib/imggen';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DefaultAvatar } from './default-avatar';
import { LocalToast, useLocalToast } from './page-toast';

// ---------------- 数据模型与持久化 ----------------

/** 恋爱状态测评报告（我和 AI 各一份；第十一轮） */
interface StatusResult {
  score: number; // 0-100
  title: string; // 状态称号
  summary: string; // 总结
  advice: string[]; // 建议
}

/** 相册（四个固定卡 + 用户自建的私密相册通用结构） */
interface CoupleAlbum {
  id: string;
  name: string;
  desc: string;
  photos: CouplePhotoEntry[]; // dataURL（真图）或文字图片卡片（CoupleTextPhoto，第五十六轮）
}

/** 真实地理位置（情侣轨迹）：open-meteo 地理编码返回的地名 + WGS84 坐标 */
interface CouplePlace {
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

/** 许愿树留言卡（第六十轮：爱情小树改许愿树——树上挂卡片，点开看正文+留言） */
export interface TreeCard {
  id: string;
  from: 'me' | 'ta';
  text: string;
  at: number;
  comments: TreeCardComment[];
}

/** 已保存的恋爱协议书（签署生效后自动存档；可多份，可点击回看；第十二轮支持分享/待对方签署） */
interface CouplePactRecord {
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
  treeCards: TreeCard[]; // 许愿树留言卡（第六十轮：最新在前，最多 30 张）
  treeCardDay?: string; // TA（AI）挂卡去重（每天最多一张）
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

const STATE_KEY = 'couple-space:state';

function defaultState(): CoupleState {
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
function normMoodEmoji(emoji: string, text?: string): string {
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
function loadCoupleState(): CoupleState {
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
    return merged;
  } catch {
    return defaultState();
  }
}

// ---------------- 业务常量池 ----------------

/** 甜蜜小问答题库（每日按日期轮换一题） */
const QUIZ_POOL = [
  '你第一次见到我时，对我的第一印象是什么？',
  '如果用一种颜色形容我们的爱情，你会选哪种？为什么？',
  '我们在一起之后，你养成的最大习惯是什么？',
  '你最喜欢我身上的哪三个优点？',
  '如果我们养一只宠物，你想养什么？取什么名字？',
  '你心里最想和我一起去的地方是哪里？',
  '你觉得我们最像哪一对电影情侣？',
  '第一次牵手的时候你在想什么？',
  '如果明天就是世界末日，今天最想和我做什么？',
  '你最近一次偷偷想我是什么时候？',
  '你希望十年后的我们是什么样子？',
  '在我们的小家里，你最想拥有哪一个角落？',
];

/** 100 件小事清单（前 5 项与参考图一致：用情侣头像/一起看电影/第一次合照的照片/互穿对方衣服拍照/连麦睡觉） */

/** 恋爱水平考试·官方模板卷（第十五轮重做，参考图4/5/6：官方推荐题库 + 试卷预览 + 喊他来答题） */
interface ExamTplQ {
  q: string;
  opts: string[];
  best: number; // 标准答案序号（AI 打分优先，本地分兜底）
}
interface ExamTpl {
  id: string;
  title: string;
  usage: string; // 使用人数展示
  notes: string[]; // 注意事项
  questions: ExamTplQ[];
}

const EXAM_TPLS: ExamTpl[] = [
  {
    id: 'tpl-bf',
    title: '2026年恋人空间普通高等男友统一测试卷',
    usage: '18.0W人使用',
    notes: [
      '本试卷为专属男友测评卷，满分100分，考试全程禁止敷衍、作弊、讲道理。',
      '所有标准答案最终解释权归女朋友所有，狡辩一律判零分。',
      '答题态度大于正确率，敷衍作答直接触发"哄女友惩罚机制"。',
      '本试卷长期有效，定期抽查复检，不合格者限期整改。',
    ],
    questions: [
      { q: '打游戏关键时刻，女友发消息说"我无聊了"，你会怎么做？', opts: ['打完这局再说，让她自己刷刷视频', '回一句"乖，等我一会"继续挂机对战', '立刻暂停/退出游戏，主动陪聊天、找话题逗她开心', '甩锅游戏："还不是因为你打扰我"'], best: 2 },
      { q: '异性主动找你深夜聊天求助，你会？', opts: ['热情回复，耐心聊天', '隐瞒女友偷偷回复', '礼貌拒绝、保持距离，主动告知女友', '主动延伸话题闲聊'], best: 2 },
      { q: '纪念日快到了，你的做法是？', opts: ['等到当天再说节日快乐', '忘记就算了', '提前准备惊喜礼物、仪式感拉满', '让女友自己准备'], best: 2 },
      { q: '吵架冷战中，女友主动发消息找你，你应该？', opts: ['摆架子，故意晚回消息', '继续掰道理，争论谁对谁错', '立马破冰，主动低头安抚，结束冷战', '冷漠回复"哦，干嘛"'], best: 2 },
      { q: '下雨天她没带伞等你接，你会？', opts: ['让她打车回来，自己懒得跑', '慢悠悠出门，卡点到达', '带伞过去，全程让她淋雨自己撑伞', '提前赶到等候，把伞全偏向她，自己半边淋雨也无所谓'], best: 3 },
      { q: '她熬夜追剧不肯睡觉，你的正确做法是？', opts: ['温柔催促休息，陪着她一起早睡', '帮她关灯盖被子，叮嘱少熬夜伤身体', '一起熬夜陪她刷手机', '指责她作息不规律，凶她睡觉'], best: 0 },
      { q: '女友心情不好、emo难过时，你会？', opts: ['讲道理、说教，指责她矫情', '耐心倾听吐槽，不打断不反驳，先抱抱她', '让她自己静静，别来烦你', '嫌她想太多，约兄弟打游戏去'], best: 1 },
      { q: '异地恋日常，合格男友需要做到哪些？', opts: ['主动报备行程，不玩消失', '日常分享琐事，事事有回应', '定期规划见面，给足安全感', '以上全部'], best: 3 },
    ],
  },
  {
    id: 'tpl-gf',
    title: '2026年恋人空间普通高等女友统一测试卷',
    usage: '11.2W人使用',
    notes: [
      '本试卷为专属女友测评卷，满分100分，考试全程禁止敷衍、作弊、翻旧账。',
      '所有标准答案最终解释权归男朋友所有，撒娇抵扣不超过10分。',
      '答题态度大于正确率，敷衍作答直接触发"哄男友惩罚机制"。',
      '本试卷长期有效，定期抽查复检，不合格者限期整改。',
    ],
    questions: [
      { q: '男友打游戏大杀四方兴奋地跟你语音，你会？', opts: ['敷衍"哦哦真棒"继续追剧', '吐槽"不就是个游戏"', '凑过去看他操作，夸他好厉害让他教我', '嫌他吵直接挂断'], best: 2 },
      { q: '男友说"兄弟聚会有事晚点回"，你会？', opts: ['连环夺命call查岗', '说好玩完记得报平安，给他空间', '生气并要他半小时内回家', '偷偷跟去"突击检查"'], best: 1 },
      { q: '男友生日快到了，你会？', opts: ['发个红包意思一下', '提前偷偷准备他念很久的球鞋或礼物', '当天再说，忘了就请他吃饭', '让他自己买'], best: 1 },
      { q: '男友工作受挫跟你吐槽，你会？', opts: ['数落他不够努力', '讲一堆大道理', '先抱抱他说"辛苦了，你已经很棒了"，再一起想办法', '嫌他小题大做'], best: 2 },
      { q: '你们吵架后你先消气了，你会？', opts: ['等他来哄，绝不让步', '主动递个台阶："还生气呢？我给你买好吃的了"', '假装什么事都没发生', '趁机翻旧账再吵一轮'], best: 1 },
      { q: '闺蜜当着你面吐槽你男友，你会？', opts: ['跟着一起吐槽', '面无表情不说话', '维护他："他对我挺好的，谢谢关心"', '回家跟男友告状大吵一架'], best: 2 },
      { q: '男友给你拍的照片总是很丑，你会？', opts: ['当场发飙删照片', '笑着教他构图："把我拍好看今晚加鸡腿"', '以后再也不让他拍', '发朋友圈公开处刑他'], best: 1 },
      { q: '异地恋中，合格女友需要做到？', opts: ['每天分享日常，让他放心', '支持他的事业与社交，不无理取闹', '见面之前偷偷打扮给他惊喜', '以上全部'], best: 3 },
    ],
  },
  {
    id: 'tpl-survive',
    title: '对象求生欲考试',
    usage: '6.2W人使用',
    notes: [
      '本试卷为对象求生欲专项测试，满分100分，答错一题扣求生欲10点。',
      '所有标准答案最终解释权归出题人对象所有。',
      '说"你怎么又问这种问题"直接判零分。',
      '本试卷长期有效，求生欲低于60分者自动进入重点观察名单。',
    ],
    questions: [
      { q: '对象问"我和你妈同时掉水里你先救谁"，求生欲满分的回答是？', opts: ['理性分析水流和距离', '"我先救你，我妈会游泳"', '"这种问题有意义吗"', '沉默不语'], best: 1 },
      { q: '对象问"我今天有什么不一样"，你会？', opts: ['"没什么不一样啊"', '认真端详："口红换色了！而且今天特别好看"', '随便猜一个"剪头发了？"', '"你每天不都一样"'], best: 1 },
      { q: '对象说"你前任比我好看多了"，你会？', opts: ['"确实还好吧"', '"谁是前任？我从出生单身到你出现"', '"你为什么会这么想"', '笑而不语'], best: 1 },
      { q: '对象问"游戏和我谁重要"，满分答案是？', opts: ['游戏', '你，游戏随时可以删', '看情况', '为什么非要比较'], best: 1 },
      { q: '对象穿新衣服问"好看吗"，你觉得其实一般，你会？', opts: ['"一般般，别买了"', '"你穿什么都好看，不过我觉得上次那件颜色更衬你"', '沉默', '说"还行吧"然后玩手机'], best: 1 },
      { q: '纪念日你忘了，对象已经黑脸，你会？', opts: ['装作没发生', '当场道歉+立刻补上惊喜和仪式感，保证下不为例', '怪对方没提醒', '说"节日而已至于吗"'], best: 1 },
      { q: '对象深夜发"睡了吗"，其实TA想聊天，你会？', opts: ['"睡了"然后不再理', '回"还没，正想你呢，怎么了宝贝"', '明天再回', '发个"？"'], best: 1 },
      { q: '对象说"我不开心"，你的第一反应？', opts: ['"又怎么了"', '马上问"怎么了？我马上过来，或者打电话给你"', '发个表情包完事', '"你先自己冷静一下"'], best: 1 },
    ],
  },
  {
    id: 'tpl-know',
    title: '恋爱了解程度考试',
    usage: '7.1W人使用',
    notes: [
      '本试卷测测你对对象的了解程度，满分100分。',
      '答错的题请自觉补习：多听、多问、多记。',
      '糊弄作答会被对象一眼看穿。',
      '本试卷长期有效，补考次数不限，但爱是有限的。',
    ],
    questions: [
      { q: '对象随口提过想吃的东西，正确的做法是？', opts: ['听过就忘', '记下来，找机会带TA去吃', '说"想吃自己买"', '等TA再说一遍'], best: 1 },
      { q: '对象的生日、纪念日、喜欢的花，你应该？', opts: ['全靠TA提醒', '都记在心里，日子到了主动安排', '只记得生日', '记在别人手机备忘录里'], best: 1 },
      { q: '聚会上对象被开玩笑冷落了，你会？', opts: ['跟着起哄', '自然地把话题接给TA，帮TA解围', '玩手机不管', '事后说"你太敏感"'], best: 1 },
      { q: 'TA生气时说"我没事"，通常的意思是？', opts: ['真的没事', '有事，很严重，需要你哄', '想让你走开', '在考你'], best: 1 },
      { q: '对象喜欢但你一直没时间陪TA做的事，你会？', opts: ['假装不知道', '这周就把日程空出来，主动安排好', '等TA再提', '认为不重要'], best: 1 },
      { q: '你们吵架后，谁该先低头？', opts: ['谁错谁先低头，对错很重要', '感情比对错重要，我先哄好TA再讲道理', '永远我低头', '永远TA低头'], best: 1 },
      { q: '对象换了新发型或买了新衣服，你会？', opts: ['没注意到', '第一时间注意到并真诚夸TA', '觉得也就那样', '吐槽不如以前'], best: 1 },
      { q: '感情里"事事有回应，件件有着落"的意思是？', opts: ['说每句话都要秒回', '答应的事要做到，做不到提前说，让TA永远安心', '每天必须打够两小时电话', '随便应付一下就行'], best: 1 },
    ],
  },
];

/** 星座名单 */
const ZODIAC_LIST = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'];
/** 星座四元素分组（同元素高契合，相邻元素互补） */
const ZODIAC_GROUP: Record<string, 'fire' | 'earth' | 'air' | 'water'> = {
  白羊座: 'fire', 狮子座: 'fire', 射手座: 'fire',
  金牛座: 'earth', 处女座: 'earth', 摩羯座: 'earth',
  双子座: 'air', 天秤座: 'air', 水瓶座: 'air',
  巨蟹座: 'water', 天蝎座: 'water', 双鱼座: 'water',
};

function zodiacScore(a: string, b: string): number {
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
const STATUS_LIST = ['热恋中 🔥', '稳定陪伴 🫶', '异地思念 ✈️', '老夫老妻 🏡', '暧昧升温 🌡️', '和好如初 🌈'];

/** 回复挑战（第七轮重做，参考图1/2）：12 关高危回复关卡；d=[体面值,觉察值,安抚值,存活率] 增量 */
const REPLY_LEVELS: {
  name: string;
  scene: string;
  quote: string;
  opts: { t: string; d: [number, number, number, number]; v: string }[];
}[] = [
  {
    name: '没事陷阱',
    scene: '你临时忙起来，忘了提前报备。TA 等到情绪已经降温，才回你一句很轻的话。最危险的是：这句话听起来不吵不闹。',
    quote: '没事，你忙吧。',
    opts: [
      { t: '我忙完马上找你，先别难过', d: [2, 2, 4, 2], v: '及格但不满分：TA 要的不是「等」，是「被优先」。' },
      { t: '我刚没交代清楚，让你干等了', d: [5, 6, 6, 5], v: '高情商：先认账再补救，TA 的委屈被看见了。' },
      { t: '我不是不想陪你，只是刚好忙', d: [-3, -2, -2, -4], v: '解释型回复：听起来像辩解，TA 只听到「你不如忙」。' },
      { t: '你先睡，明天我认真补给你', d: [-5, -4, -6, -8], v: '危险发言：「补」字一出，TA 觉得自己在被排期。' },
    ],
  },
  {
    name: '随便考验',
    scene: '你问 TA 晚上吃什么，TA 盯着手机没抬头，轻轻吐出两个字。这两个字是送命题的入口。',
    quote: '随便你。',
    opts: [
      { t: '不随便了，我订你最爱的那家', d: [6, 4, 6, 6], v: '直接给答案，绕过送命题，满分操作。' },
      { t: '那我说了哦：你最想吃的那家', d: [4, 5, 5, 4], v: '「随便」的潜台词是「你猜中我想要的」。' },
      { t: '行，那就随便吃点', d: [-6, -3, -5, -9], v: '把「随便」当真的人，今晚可能要自己吃了。' },
      { t: '你怎么老说随便，烦不烦', d: [-8, -6, -8, -12], v: '把情绪问题升级成人身攻击，火力全开直通败局。' },
    ],
  },
  {
    name: '已读深渊',
    scene: '你发了一长段分享，对话框顶端跳出「已读」。十分钟后，TA 回了一个字。',
    quote: '哦。',
    opts: [
      { t: '看来你今天不太想聊天，晚上我陪你补上', d: [6, 7, 6, 6], v: '给台阶也给自己台阶，晚上的约定让 TA 有盼头。' },
      { t: '发个表情包把气氛拉回来', d: [3, 2, 4, 3], v: '轻处理是对的，但别每次都用表情包躲问题。' },
      { t: '怎么回一个哦，我说的不好笑吗', d: [-2, -1, -2, -4], v: '质问会让 TA 关闭分享欲，下条「哦」已经在路上了。' },
      { t: '（也不回了，开始冷战）', d: [-8, -4, -8, -14], v: '以冷制冷，两败俱伤，存活率直接腰斩。' },
    ],
  },
  {
    name: '在吗迷雾',
    scene: 'TA 发来「在吗」，你回了「在」，然后对方开始打字、停止、又打字。三分钟后什么都没发过来。',
    quote: '在吗？',
    opts: [
      { t: '怎么啦？慢慢说，我都在', d: [5, 4, 6, 5], v: '「我都在」是给安全感的教科书句式。' },
      { t: '在，咋了你说', d: [1, 0, 1, 0], v: '太干了，TA 的欲言又止需要一点推动力。' },
      { t: '有事直接说，别老发在吗', d: [-6, -5, -6, -9], v: '「在吗恐惧症」背后是怕麻烦，但说出来就是刀。' },
      { t: '（假装没看见）', d: [-4, -2, -5, -10], v: '已读不回是会记账的，TA 记性好得很。' },
    ],
  },
  {
    name: '你开心就好',
    scene: '你们为一个周末安排争执了几句，TA 突然不争了，语气平静得可怕。',
    quote: '嗯，你开心就好。',
    opts: [
      { t: '我们先停十分钟，抱一下再慢慢说', d: [6, 6, 7, 6], v: '暂停 + 肢体接触，冲突降温最快的一招。' },
      { t: '我不开心，我想让你也开心', d: [5, 5, 6, 5], v: '接住了潜台词：TA 不是让你开心，是委屈。' },
      { t: '你又来了，至于吗', d: [-7, -6, -7, -11], v: '「至于吗」三个字是冷战助燃剂。' },
      { t: '好，那按我说的来', d: [-9, -5, -8, -15], v: '听不出反话的直球发言，当场暴毙。' },
    ],
  },
  {
    name: '别人家对象',
    scene: 'TA 刷到别人的对象送了限定礼物，语气酸酸地看了你一眼。',
    quote: '你怎么不学学人家对象？',
    opts: [
      { t: '是我疏忽了，下个月给你准备更大的惊喜', d: [7, 5, 7, 7], v: '承认 + 行动方案，把酸味变成期待。' },
      { t: '学不来，我只会对你一个人好', d: [4, 4, 5, 4], v: '油但有效，嫉妒需要一句甜话中和。' },
      { t: '那都是摆拍，有什么好在意的', d: [-3, -2, -3, -6], v: '否定 TA 的感受，酸味会发酵成怨气。' },
      { t: '人家对象好你去找人家啊', d: [-10, -6, -9, -16], v: '送命题标准错误答案，直接原地去世。' },
    ],
  },
  {
    name: '凌晨两点',
    scene: '凌晨两点，TA 突然发来消息，字里行间全是不安。',
    quote: '我是不是特别麻烦？',
    opts: [
      { t: '不麻烦，我就是你的树洞，说说怎么了', d: [7, 6, 7, 7], v: '倾听比解决更重要，TA 需要的是出口。' },
      { t: '麻烦，但我乐意，谁让我喜欢你', d: [6, 5, 7, 6], v: '先接住「麻烦」，再把负担变成宠爱。' },
      { t: '你想多了，早点睡吧', d: [-5, -4, -6, -9], v: '「你想多了」是否定感受四件套之首。' },
      { t: '还行吧，比一般人麻烦点', d: [-8, -5, -8, -13], v: '深夜玩梗等于玩火，玩笑也救不了场。' },
    ],
  },
  {
    name: '翻旧账预警',
    scene: '这次迟到让 TA 想起了上上次、上上上次。旧账本哗啦啦翻开。',
    quote: '你上次也是这么说的。',
    opts: [
      { t: '对不起，这次真的记住了，你看我做的', d: [6, 6, 6, 6], v: '旧账的本质是「信用破产」，用行动续费。' },
      { t: '这次和上次不一样，你听我解释', d: [-2, -1, -3, -5], v: '「你听我解释」是偶像剧里误会加深的开始。' },
      { t: '那我以后都不说了行吧', d: [-6, -4, -6, -10], v: '赌气式承诺，TA 听到的是「你无理取闹」。' },
      { t: '你怎么老翻旧账，累不累', d: [-9, -6, -9, -14], v: '指责翻旧账只会让 TA 更委屈，账本更厚。' },
    ],
  },
  {
    name: '算了吧陷阱',
    scene: '大吵一架后，TA 红着眼说出那四个字。但 TA 的手还紧紧攥着你们的合照。',
    quote: '要不……我们算了吧。',
    opts: [
      { t: '我不算，我们之间不能算', d: [7, 6, 7, 7], v: '假性分手要的是挽留，态度比道理重要。' },
      { t: '我们先都冷静，但我不会放弃我们', d: [5, 5, 6, 6], v: '给空间但不放手，进可攻退可守。' },
      { t: '你又来这套，烦不烦', d: [-8, -5, -8, -13], v: '把求救当威胁，TA 会真的死心。' },
      { t: '算就算了吧', d: [-12, -8, -12, -20], v: '顺着接就是真分手，存活率清零。' },
    ],
  },
  {
    name: '醋意试探',
    scene: 'TA 提到你最近和异性同事走得很近，语气轻描淡写，眼神却在打探。',
    quote: '那个谁对你挺好的呀。',
    opts: [
      { t: '我会注意分寸，也会把界限说清楚', d: [7, 7, 6, 7], v: '给足安全感，行动承诺最有力。' },
      { t: '好是好，但都没你好，你才最特别', d: [5, 4, 6, 5], v: '醋需要甜来化，先哄再划界限。' },
      { t: '你吃醋了？哈哈哈', d: [-4, -2, -3, -7], v: '嘲笑 TA 的醋意，下次 TA 会藏得更深。' },
      { t: '你能不能别疑神疑鬼', d: [-7, -5, -7, -12], v: '「疑神疑鬼」否定了 TA 的不安。' },
    ],
  },
  {
    name: '玩笑收刀',
    scene: 'TA 刚才开了个有点过分的玩笑，你脸都黑了，TA 立刻补了一句。',
    quote: '逗你的，你怎么还当真了。',
    opts: [
      { t: '我知道是玩笑，但这个玩笑我不喜欢', d: [7, 7, 6, 7], v: '温和而坚定地划界，玩笑也要有边界。' },
      { t: '你这玩笑一点都不好笑', d: [-2, -1, -2, -5], v: '对，但太硬，可以再加半句感受。' },
      { t: '（憋着，不说话）', d: [-3, -2, -4, -8], v: '憋住的委屈不会消失，只会过期变质。' },
      { t: '那你继续逗，看你能逗到什么时候', d: [-5, -4, -5, -9], v: '阴阳怪气回击，战火升级。' },
    ],
  },
  {
    name: '终极沉默',
    scene: 'TA 把你的消息全部已读，一个字都没有回。这是最危险的一关：无题可解，只能用心。',
    quote: '（TA 已读不回）',
    opts: [
      { t: '打个电话过去：我想听你说说', d: [8, 7, 8, 8], v: '沉默降级不了矛盾，声音可以。主动破冰是王者操作。' },
      { t: '发一段真诚的长文道歉', d: [5, 6, 5, 5], v: '真诚永远有效，但记得之后当面聊。' },
      { t: '连发十条消息追问怎么了', d: [-6, -2, -5, -10], v: '追问会让 TA 觉得被压迫，沉默更深。' },
      { t: 'TA 不回我也不回，看谁熬得过谁', d: [-9, -6, -9, -16], v: '沉默对决，输的都是感情。' },
    ],
  },
];

/** 恋爱协议随机条款池（随机新增一条；第七轮参考图3/4/5 重做） */
const PACT_RANDOM_POOL = [
  '吵架时先抱十秒再讲道理',
  '每周至少一次正式约会',
  '出门前和回家后都要打招呼',
  '对方说话时不玩手机',
  '好吃的先让对方尝第一口',
  '生病时要第一时间关心',
  '购物车里的心愿偶尔悄悄清空',
  '每天至少夸对方一次',
  '合照时认真配合不敷衍',
  '每月一起解锁一件新事情',
];

/** 恋爱协议标准模板（导入模板编码加载，20 条，参考图3） */
const PACT_TEMPLATE_CLAUSES = [
  '绝不和异性搞暧昧',
  '绝不失联半天找不到人',
  '吵架不能隔夜，要当天解决',
  '吵架不说伤人的话，不骂人',
  '绝不在有异性的情况下过夜',
  '吵架不能不接电话、挂电话',
  '吵完架冷静后要反省和改正',
  '要记得每个纪念日和节日',
  '每天都要问候对方早晚安',
  '不能隐瞒和欺骗对方',
  '信息可以不秒回，但看到了一定要回',
  '遇到开心或难过的事要彼此分享',
  '可以吵架，不能冷战冷暴力',
  '不能轻易说分手',
  '外出或者行事提前互相报备',
  '少喝碳酸饮料少吃垃圾食品按时吃饭睡觉',
  '放下过往旧事不翻旧账一起向前看',
  '分手后不能诋毁不能把对方黑料报出去',
  '要相互包容相互理解这样爱情才长久',
  '有不满要直接告诉对方，不要在心里偷偷扣分',
];

/** 心情选项（含手绘风表情配色：c=脸色 d=描边/细节） */
const MOOD_LIST = [
  { emoji: '😊', label: '开心', c: '#f8d05e', d: '#e2b23c' },
  { emoji: '🥰', label: '甜蜜', c: '#f6bfcb', d: '#e59cad' },
  { emoji: '😴', label: '困困', c: '#cdccdb', d: '#a8a7bf' },
  { emoji: '😤', label: '生气', c: '#f08a78', d: '#d96a58' },
  { emoji: '😢', label: '委屈', c: '#93bbe9', d: '#709bd2' },
  { emoji: '🤔', label: '思考', c: '#eac59b', d: '#d2a774' },
  { emoji: '🤩', label: '兴奋', c: '#f4ab6d', d: '#de8c4c' },
  { emoji: '🥲', label: '想TA', c: '#c6b0e2', d: '#aa90cb' },
];

// ---------------- 小工具 ----------------

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 纪念日 → 在一起天数（含当天，最小 1） */
function daysSince(anniv: string | null): number | null {
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

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成情侣号（s + 9 位大小写字母数字，参考图样式如 sTCS9PFVKL） */
function genCoupleNo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 's';
  for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 'YYYY-MM-DD' → 中文日期 + 星期（如 2006年6月20日 周二） */
function fmtDateCn(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`;
}

/** 时间戳 → 「M-DD HH:mm」（第二十一轮：信箱/信封卡片只显示时间，参考截图「10-26 00:17」） */
function fmtMDHM(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 距离最近一个生日的天数（ MM-DD 重复出现；当天→0，已过→明年） */
function daysToNextMonthDay(md: string): number | null {
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
function PixelHeart({ size = 40 }: { size?: number }) {
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
function MoodFace({ mood, size = 40, className = '' }: { mood: string; size?: number; className?: string }) {
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
function CoupleAvatar({ src, name, size, ring = true }: { src: string | null; name: string; size: number; ring?: boolean }) {
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

type TabKey = 'home' | 'discover' | 'album' | 'us';

type SubPage =
  | 'tree' | 'track' | 'quiz' | 'letters'
  | 'house' | 'mood' | 'tarot' | 'hundred' | 'pact' | 'exam' | 'zodiac'
  | 'chronicle' | 'stone' | 'reply' | 'hotel' | 'status' | 'impress'
  | 'profile' | 'missyou' | 'chapel' | 'support' | 'settings'
  | 'album' | 'anniv';

export default function CoupleSpaceApp() {
  const [toast, showToast] = useLocalToast();
  const [state, setState] = useState<CoupleState>(() => loadCoupleState());
  const [tab, setTab] = useState<TabKey>('home');
  const [sub, setSub] = useState<SubPage | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null); // 打开的私密相册
  const bootFilled = useRef(false);
  // 邀请流（第六轮）：全局邀请元数据同步 + 选人弹层（模式 send=我邀TA / recv=TA邀我）+ 渠道选择
  const [invMeta, setInvMeta] = useState<CoupleInviteMeta>(() => readInviteMeta());
  const [pickSheet, setPickSheet] = useState<'send' | 'recv' | null>(null);
  const [pickChannel, setPickChannel] = useState<CoupleChannel>('wx');
  const [friends, setFriends] = useState<{ id: string; name: string; avatar: string | null }[]>([]);

  /** 全局邀请状态事件同步：couple-invite（AI 接受/关系建立/收到邀请）直写 kv 后广播，
   *  本组件重读全局 kv 刷新（邀请页按钮状态切换 + 关系建立后自动进入主界面）；
   *  顺带触发 AI 主动行为（建立关系后 AI 开始想你/浇树/写日记…） */
  useEffect(() => {
    const sync = () => {
      const meta = readInviteMeta();
      setInvMeta(meta);
      setState(loadCoupleState()); // kv 内存缓存同步权威，读到的总是最新合并值
      if (meta.partnerContactId) runCoupleAiTick(meta.partnerApp ?? 'wx', meta.partnerContactId);
    };
    window.addEventListener(COUPLE_STATE_EVENT, sync);
    return () => window.removeEventListener(COUPLE_STATE_EVENT, sync);
  }, []);

  /** 聊天里的协议卡片点击进来（第十二轮）：切到恋人空间时直接打开协议页（PactPage 挂载后消费具体目标）。
   *  组件可能晚于事件挂载（聊天→恋人空间切换）→ 挂载时也检查一次 pending */
  useEffect(() => {
    const nav = () => {
      if (peekPendingPactOpen()) setSub('pact');
    };
    // 挂载时也检查一次 pending（异步避免同步 setState 触发级联渲染）
    queueMicrotask(() => {
      if (peekPendingPactOpen()) setSub('pact');
    });
    window.addEventListener(COUPLE_PACT_NAV_EVENT, nav);
    return () => window.removeEventListener(COUPLE_PACT_NAV_EVENT, nav);
  }, []);

  /** 聊天里的考试卡片点击进来（第十五轮）：切到恋人空间时直接打开考试页（ExamPage 挂载后消费具体目标） */
  useEffect(() => {
    const nav = () => {
      if (peekPendingExamOpen()) setSub('exam');
    };
    // 挂载时也检查一次 pending（异步避免同步 setState 触发级联渲染）
    queueMicrotask(() => {
      if (peekPendingExamOpen()) setSub('exam');
    });
    window.addEventListener(COUPLE_EXAM_NAV_EVENT, nav);
    return () => window.removeEventListener(COUPLE_EXAM_NAV_EVENT, nav);
  }, []);

  /** 聊天里的情书信封卡片点击进来（第十八轮）：切到恋人空间时直接打开信件页（LettersPage 挂载后消费具体目标，不进主页） */
  useEffect(() => {
    const nav = () => {
      if (peekPendingLetterOpen()) setSub('letters');
    };
    queueMicrotask(() => {
      if (peekPendingLetterOpen()) setSub('letters');
    });
    window.addEventListener(COUPLE_LETTER_NAV_EVENT, nav);
    return () => window.removeEventListener(COUPLE_LETTER_NAV_EVENT, nav);
  }, []);

  /** 全局头像/名字同步（用户要求：用微信邀请→双方身份跟随微信；QQ 邀请→跟随 QQ）：
   *  渠道 = 关系建立渠道（partnerApp）；我 = 该渠道当前账号档案（社交名 + 分 App 头像槽位），
   *  TA = 绑定恋人联系人（展示名 + 分 App 头像槽位）。
   *  挂载时 + 全局状态事件时同步，联系人改名/换头像后打开 App 自动跟随 */
  useEffect(() => {
    let alive = true;
    const syncFromGlobal = async () => {
      try {
        const meta = readInviteMeta();
        const ch: CoupleChannel = meta.partnerApp ?? 'wx';
        const idn = await channelIdentityOf(ch, meta.partnerContactId);
        if (!alive) return;
        setState((prev) => {
          const next: CoupleState = { ...prev };
          let changed = false;
          if (idn.meName && idn.meName !== prev.meName) {
            next.meName = idn.meName;
            changed = true;
          }
          if (idn.meAvatar && idn.meAvatar !== prev.meAvatar) {
            next.meAvatar = idn.meAvatar;
            changed = true;
          }
          if (idn.taName && idn.taName !== prev.taName) {
            next.taName = idn.taName;
            changed = true;
          }
          if (idn.taAvatar && idn.taAvatar !== prev.taAvatar) {
            next.taAvatar = idn.taAvatar;
            changed = true;
          }
          if (!changed) return prev;
          kvSetDebounced(STATE_KEY, next);
          return next;
        });
      } catch {
        /* 同步失败静默（保留本地值） */
      }
    };
    void syncFromGlobal();
    window.addEventListener(COUPLE_STATE_EVENT, syncFromGlobal);
    // 第十九轮需求49：头像/名字实时跟随登录渠道（微信/QQ）——微信/QQ 内换头像、改昵称保存后
    // contacts-store 会广播 contact-avatar-changed / contact-updated，这里同步刷新 meName/meAvatar 等
    window.addEventListener('contact-avatar-changed', syncFromGlobal);
    window.addEventListener('contact-updated', syncFromGlobal);
    return () => {
      alive = false;
      window.removeEventListener(COUPLE_STATE_EVENT, syncFromGlobal);
      window.removeEventListener('contact-avatar-changed', syncFromGlobal);
      window.removeEventListener('contact-updated', syncFromGlobal);
    };
  }, []);

  /** 选人弹层打开/切换渠道时拉取该渠道 AI 好友列表（char/npc，排除机主小号） */
  useEffect(() => {
    if (!pickSheet) return;
    let alive = true;
    void (async () => {
      try {
        const list = await listContacts();
        if (!alive) return;
        setFriends(
          list
            .filter((c) => c.kind !== 'user' && isFriendIn(c, pickChannel))
            .map((c) => ({ id: c.id, name: displayNameOf(c), avatar: c.avatar ?? null })),
        );
      } catch {
        if (alive) setFriends([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pickSheet, pickChannel]);

  /** 选人确认：send=我邀请TA（选微信/QQ + AI 联系人）→ 邀请卡进会话 + AI 延时接受；
   *  recv=让 TA 来邀请你 → AI 延时发邀请卡（邀请页变「接受邀请」） */
  const onPickFriend = useCallback(
    async (contactId: string) => {
      if (!pickSheet) return;
      const mode = pickSheet;
      const ch = pickChannel;
      const r = mode === 'send' ? await sendMyInvite(ch, contactId) : await aiInvitesMe(ch, contactId);
      if (r.ok) {
        setPickSheet(null);
        showToast(mode === 'send' ? `邀请已发送到${ch === 'wx' ? '微信' : 'QQ'}，等 TA 同意 ♡` : '好，TA 稍后会向你发起邀请 ♡');
      } else {
        showToast(r.error);
      }
    },
    [pickSheet, pickChannel, showToast],
  );

  /** 接受邀请（邀请页大按钮；聊天卡片按钮走 couple-invite 同一入口）：
   *  AI 的邀请卡转已同意 → 我回成功卡 → sys 提示行 → 建立关系（全局）→ 事件同步进主界面 */
  const doAcceptInvite = useCallback(async () => {
    const inv = invMeta.pendingInvite;
    if (!inv) return;
    const r = await acceptIncomingInvite(inv.contactId);
    showToast(r.ok ? '欢迎来到你们的小天地 ♡' : r.error);
  }, [invMeta.pendingInvite, showToast]);

  /** 状态更新 + 防抖落盘（支持对象或函数式 updater，供快速连点场景原子更新）。
   *  同时：diff 前后状态，把用户新产生的情侣空间事件自动写进恋人（AI）的记忆（第九轮）。 */
  const invMetaRef = useRef(invMeta);
  useEffect(() => {
    invMetaRef.current = invMeta;
  });
  const patch = useCallback((pOrFn: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => {
    setState((prev) => {
      const inc = typeof pOrFn === 'function' ? pOrFn(prev) : pOrFn;
      const next = { ...prev, ...inc };
      kvSetDebounced(STATE_KEY, next);
      const meta = invMetaRef.current;
      if (meta.partnerContactId) {
        try {
          coupleMemoryDiff(prev, next, meta.partnerContactId, meta.partnerApp ?? 'wx');
        } catch {
          /* 记忆写入失败不阻断界面 */
        }
      }
      return next;
    });
  }, []);

  /** 解除关系：清空全部数据回到邀请页（设置页入口）；广播状态事件——QQ 聊天页/会话列表
   *  的恋人标识（徽章+钥匙）监听该事件即时消失（第九轮） */
  const resetAll = useCallback(() => {
    kvSet(STATE_KEY, defaultState());
    setState(defaultState());
    setSub(null);
    dispatchStateEvent();
  }, []);

  /** 首次进入：预填「我」的信息卡资料 + 联系人第一位 AI 角色作为恋人；记录登录 + 生成情侣号；
   *  已建立关系时触发 AI 主动行为调度（AI 每天想你/浇树/写日记…，内部按天去重） */
  useEffect(() => {
    const meta0 = readInviteMeta();
    if (meta0.partnerContactId) runCoupleAiTick(meta0.partnerApp ?? 'wx', meta0.partnerContactId);
    if (bootFilled.current) return;
    bootFilled.current = true;
    (async () => {
      try {
        const me = loadProfileCard();
        const cur = loadCoupleState();
        const needMe = !cur.meName;
        const needTa = !cur.taName;
        const meta: Partial<CoupleState> = {};
        if (!cur.coupleNo) meta.coupleNo = genCoupleNo();
        // 登录记录：每次会话记一条（去重到分钟），只留最近 20 条
        const last = cur.logins[0];
        if (!last || Date.now() - last > 60_000) meta.logins = [Date.now(), ...cur.logins].slice(0, 20);
        if (needMe || needTa || Object.keys(meta).length > 0) {
          let taName = '';
          let taAvatar: string | null = null;
          if (needTa) {
            try {
              const list = await listContacts();
              const c = list.find((x) => x.kind === 'char');
              if (c) {
                taName = c.nickname || c.remark || c.name || '';
                taAvatar = c.avatar || null;
              }
            } catch {
              /* 联系人拉取失败静默，保留空值 */
            }
          }
          setState((prev) => ({
            ...prev,
            ...meta,
            meName: prev.meName || (needMe ? me.name : prev.meName),
            meAvatar: prev.meAvatar ?? (needMe ? me.avatar : prev.meAvatar),
            taName: prev.taName || taName,
            taAvatar: prev.taAvatar ?? taAvatar,
          }));
        }
      } catch {
        /* 预填失败静默 */
      }
    })();
  }, []);

  const days = daysSince(state.anniversary);
  const homeBgSrc = state.homeBg || '/couple-home-bg.png';
  /** 「想他/想我」天数（第九轮：连续打卡天数——点了每天想那一天才 +1，不点不涨；
   *  首次点击当天起 missSince 非空才展示徽标） */
  const missDays = state.missSince ? missStreakOf(state) : null;

  /** 每天想你 +1（首次点击记录 missSince，之后首页大圆消失改为头像下想念天数） */
  const tapMissYou = useCallback(() => {
    setState((prev) => {
      const k = todayKey();
      const next: CoupleState = {
        ...prev,
        missYou: prev.missYou + 1,
        missSince: prev.missSince || k,
        missYouByDay: { ...prev.missYouByDay, [k]: (prev.missYouByDay[k] || 0) + 1 },
      };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
    showToast('想 TA 的心意 +1 ♡');
  }, [showToast]);

  /** 浇水（爱情树）：成长值 +2，并累计连续浇树天数 */
  const waterTree = useCallback(() => {
    setState((prev) => {
      const k = todayKey();
      const yKey = todayKey(new Date(Date.now() - 86400000));
      const prevStreak = prev.treeStreak || { last: null, n: 0 };
      let n = 1;
      if (prevStreak.last === k) n = Math.max(1, prevStreak.n);
      else if (prevStreak.last === yKey) n = prevStreak.n + 1;
      const next: CoupleState = { ...prev, tree: Math.min(100, prev.tree + 2), treeStreak: { last: k, n } };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
    showToast('浇好水啦，小树茁壮成长 🌱');
  }, [showToast]);

  // ---------- 邀请页（图1；第六轮：按钮按邀请状态切换 + 邀请流） ----------
  if (!state.accepted) {
    const pend = invMeta.pendingInvite;
    const recvInvite = pend?.dir === 'recv' ? pend : null; // 有人邀请我 → 接受邀请
    const sendPend = pend?.dir === 'send' ? pend : null; // 我已发出邀请，等对方同意
    // 头像/名字：TA 邀请我 → 显示邀请人；否则显示预填恋人（兜底）
    const invAvatar = recvInvite?.fromAvatar ?? state.taAvatar;
    const invName = recvInvite?.fromName || state.taName;
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(165deg,#fbfbfc_0%,#f1f1f3_45%,#e3e3e7_100%)] dark:bg-[linear-gradient(165deg,#17171a_0%,#131316_45%,#0f0f12_100%)] text-[#2c2c30] dark:text-zinc-100">
        {/* 装饰大圆（白灰层叠） */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/70 dark:bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 top-40 h-56 w-56 rounded-full bg-white/50 dark:bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-10 bottom-40 h-44 w-44 rounded-full bg-white/40 dark:bg-white/10" />
        {/* 浮动小点（原彩色点改为深浅灰） */}
        <div aria-hidden="true" className="pointer-events-none absolute left-[24%] top-[30%] h-3.5 w-3.5 rounded-full bg-[#c9c9cf] dark:bg-zinc-700" />
        <div aria-hidden="true" className="pointer-events-none absolute left-[7%] top-[38%] h-3 w-3 rounded-full bg-[#dedee2] dark:bg-zinc-600/60" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[13%] top-[41%] h-4 w-4 rounded-full bg-[#c3c3ca] dark:bg-zinc-700" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[7%] top-[54%] h-2.5 w-2.5 rounded-full bg-[#d6d6db] dark:bg-zinc-700/70" />
        <div aria-hidden="true" className="pointer-events-none absolute left-[13%] top-[57%] h-2.5 w-2.5 rounded-full bg-[#bfbfc7] dark:bg-zinc-600" />

        <div className="relative flex flex-1 flex-col items-center px-8 pt-[104px]">
          {/* 左上角返回键（第七轮）：回到手机主界面 */}
          <button
            type="button"
            data-testid="couple-invite-back"
            onClick={() => useUI.getState().closeApp()}
            aria-label="返回主界面"
            className="absolute left-3 top-[58px] flex h-10 w-10 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/85 text-[#3a3a40] dark:text-zinc-200 shadow-[0_2px_10px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity active:opacity-50"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          {/* 恋人头像 + 名字（recv 时为邀请人）；无头像时兜底为恋人空间粉双心图 */}
          <div className="h-[118px] w-[118px] overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80 ring-[6px] ring-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.10)]">
            {invAvatar ? (
              <img src={invAvatar} alt={invName || '恋人'} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <img src="/icons/couple.png" alt="恋人空间" className="h-full w-full object-cover" draggable={false} />
            )}
          </div>
          <div className="mt-8 text-[30px] font-bold leading-none">{invName || '恋人'}</div>
          <div className="mt-7 text-[30px] font-bold leading-tight text-[#3c3c42] dark:text-zinc-200">邀请你开通恋人空间</div>

          {/* 按钮区：有人邀请我 → 接受邀请；我已发出 → 等待对方；没人邀请 → 立即邀请我的另一半 */}
          {recvInvite ? (
            <>
              <div className="mt-5 text-[14px] text-[#6e6e76] dark:text-zinc-300">「{recvInvite.fromName}」想和你建立情侣关系</div>
              <button
                type="button"
                data-testid="couple-accept-btn"
                onClick={() => void doAcceptInvite()}
                className="mt-4 h-[60px] w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[21px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 transition-transform active:scale-[0.98]"
              >
                接受邀请
              </button>
            </>
          ) : sendPend ? (
            <>
              <div className="mt-5 text-[14px] text-[#6e6e76] dark:text-zinc-300">
                已向「{sendPend.toName}」发出{sendPend.app === 'wx' ? '微信' : 'QQ'}邀请
              </div>
              <button
                type="button"
                disabled
                className="mt-4 h-[60px] w-full rounded-2xl bg-[#f1f1f4] dark:bg-zinc-900/70 text-[21px] font-semibold text-[#9a9aa2] dark:text-zinc-400 ring-1 ring-black/[0.04] dark:ring-white/10"
              >
                等待对方接受…
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="couple-invite-btn"
                onClick={() => setPickSheet('send')}
                className="mt-10 h-[60px] w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[21px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 transition-transform active:scale-[0.98]"
              >
                立即邀请我的另一半
              </button>
              <button
                type="button"
                data-testid="couple-recv-btn"
                onClick={() => setPickSheet('recv')}
                className="mt-4 text-[14px] text-[#8e8e96] dark:text-zinc-400 underline-offset-4 transition-opacity active:opacity-60"
              >
                让 TA 来邀请你
              </button>
            </>
          )}
        </div>

        <div className="relative px-6 pb-12">
          <div className="mb-4 text-center text-[16px] text-[#9a9aa2] dark:text-zinc-400">在恋人空间你们可以体验这些</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '情侣相册', icon: <Camera className="h-8 w-8" strokeWidth={1.8} /> },
              { label: '爱情树', icon: <Sprout className="h-8 w-8" strokeWidth={1.8} /> },
              { label: '纪念日', icon: <BadgeCheck className="h-8 w-8" strokeWidth={1.8} /> },
            ].map((it) => (
              <div key={it.label} className="flex h-[110px] flex-col items-center justify-center gap-2.5 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
                <span className="text-[#6e6e76] dark:text-zinc-300">{it.icon}</span>
                <span className="text-[15px] font-medium text-[#4a4a52] dark:text-zinc-200">{it.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 邀请选人弹层：渠道（微信/QQ）+ AI 好友列表（每联系人限一次，已邀请过置灰） */}
        {pickSheet && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/35" onClick={() => setPickSheet(null)}>
            <div className="max-h-[74%] overflow-y-auto rounded-t-3xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-9 pt-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5] dark:bg-zinc-900/80" />
              <div className="mt-3 text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">{pickSheet === 'send' ? '邀请你的另一半' : '让 TA 来邀请你'}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">
                {pickSheet === 'send' ? '选择渠道和要邀请的 AI 好友，TA 会稍后同意你的邀请' : '选择渠道和 AI 好友，TA 会稍后向你发起邀请'}
              </div>

              {/* 渠道分段选择（用户邀请 AI 可选微信还是 QQ） */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(['wx', 'qq'] as CoupleChannel[]).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    data-testid={`couple-channel-${ch}`}
                    onClick={() => setPickChannel(ch)}
                    className={`h-11 rounded-xl text-[14px] font-medium transition-colors ${
                      pickChannel === ch
                        ? 'bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_4px_12px_rgba(242,83,106,0.30)]'
                        : 'bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#4a4a52] dark:text-zinc-200 active:bg-[#ececef] dark:active:bg-zinc-900/80'
                    }`}
                  >
                    {ch === 'wx' ? '通过微信邀请' : '通过QQ邀请'}
                  </button>
                ))}
              </div>

              {/* 该渠道 AI 好友列表 */}
              <div className="mt-4 max-h-72 space-y-1 overflow-y-auto" data-testid="couple-friend-list">
                {friends.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-[#b6b6bd] dark:text-zinc-500">该渠道还没有 AI 好友</div>
                ) : (
                  friends.map((f) => {
                    const invited = invMeta.invitedOnce.some((x) => x.contactId === f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={invited}
                        data-testid={`couple-friend-${f.id}`}
                        onClick={() => void onPickFriend(f.id)}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors active:bg-[#f3f3f5] dark:active:bg-zinc-900/70 disabled:opacity-40"
                      >
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                          {f.avatar ? (
                            <img src={f.avatar} alt={f.name} className="h-full w-full object-cover" draggable={false} />
                          ) : (
                            <DefaultAvatar size={40} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#2c2c30] dark:text-zinc-100">{f.name}</span>
                        {invited && <span className="shrink-0 text-[12px] text-[#b6b6bd] dark:text-zinc-500">已邀请过</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- 已接受邀请：主界面（4 Tab + 子页覆盖层） ----------
  const openSub = (s: SubPage) => setSub(s);
  const closeSub = () => {
    setSub(null);
    setAlbumId(null);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f6f6f8_55%,#ececee_100%)] dark:bg-[linear-gradient(180deg,#141417_0%,#111114_55%,#0d0d10_100%)] text-[#2c2c30] dark:text-zinc-100">
      <LocalToast msg={toast} />

      {/* 全局背景：合影铺满整个 App，所有 Tab 共用。
          首页白纱改为设置页可调（第三十三轮「背景白纱模糊度」滑杆）：0 = 无白纱直接可见（默认），
          拉高则叠加白色纱层 + 背景模糊；其他 Tab（相册/发现/我们/设置）保留白纱保证卡片可读 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <img src={homeBgSrc} alt="" className="h-full w-full object-cover" draggable={false} />
        {tab !== 'home' && <div className="absolute inset-0 bg-white/70 dark:bg-zinc-800/78" />}
        {tab === 'home' && (state.homeVeil ?? 0) > 0 && (
          <HomeVeil level={state.homeVeil ?? 0} />
        )}
      </div>

      {/* 内容区 */}
      <div className="relative z-10 flex-1 overflow-hidden">
        {tab === 'home' && (
          <HomePage
            state={state}
            days={days}
            missDays={missDays}
            tapMissYou={tapMissYou}
            openSub={openSub}
            onClose={() => useUI.getState().closeApp()}
            onPickBg={async (f) => {
              if (!f) return;
              try {
                const url = await fileToScaledDataURL(f, 1080, 0.75);
                patch({ homeBg: url });
                showToast('背景已更换 ♡');
              } catch {
                showToast('图片处理失败，换一张试试');
              }
            }}
          />
        )}
        {tab === 'discover' && <DiscoverPage openSub={openSub} />}
        {tab === 'album' && (
          <AlbumPage
            state={state}
            patch={patch}
            showToast={showToast}
            openAlbum={(id) => {
              setAlbumId(id);
              setSub('album');
            }}
          />
        )}
        {tab === 'us' && <UsPage state={state} days={days} openSub={openSub} />}
      </div>

      {/* 底部 Tab 栏（子页打开时隐藏）——第四十二轮：毛玻璃胶囊悬浮条 */}
      {!sub && (
        <nav aria-label="情侣空间导航" className="relative z-20 shrink-0 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
          <div className="grid grid-cols-4 rounded-[26px] border border-white/60 bg-white/80 dark:bg-zinc-800/85 py-[6px] shadow-[0_10px_36px_rgba(0,0,0,0.16)] backdrop-blur-2xl backdrop-saturate-150">
            {([
              { key: 'home', label: '首页', icon: Heart },
              { key: 'discover', label: '发现', icon: Compass },
              { key: 'album', label: '相册', icon: BookHeart },
              { key: 'us', label: '我们', icon: Smile },
            ] as const).map((t) => {
              const active = tab === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    closeSub();
                  }}
                  aria-label={t.label}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-[42px] flex-col items-center justify-center gap-[2px] rounded-full transition-all active:opacity-60 ${active ? 'bg-[#f2536a]/10' : ''}`}
                >
                  <Icon
                    className="h-[19px] w-[19px]"
                    strokeWidth={active ? 2.5 : 1.9}
                    fill="none"
                    color={active ? '#e0455c' : '#b6b6bd'}
                  />
                  <span className={`text-[10px] leading-none ${active ? 'font-semibold text-[#3a3a40] dark:text-zinc-200' : 'text-[#b6b6bd] dark:text-zinc-500'}`}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* 子页（覆盖整个 App 含 Tab 栏，滑入动画） */}
      {sub && (
        <div className="absolute inset-0 z-30 bg-[#f6f6f8] dark:bg-zinc-900 [animation:couple-sub-in_.26s_cubic-bezier(0.32,0.72,0,1)_both]">
          <SubRouter
            sub={sub}
            state={state}
            patch={patch}
            albumId={albumId}
            days={days}
            tapMissYou={tapMissYou}
            waterTree={waterTree}
            close={closeSub}
            showToast={showToast}
            openSub={openSub}
            onReset={resetAll}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- 首页（图2） ----------------

function HomePage(props: {
  state: CoupleState;
  days: number | null;
  missDays: number | null;
  tapMissYou: () => void;
  openSub: (s: SubPage) => void;
  onPickBg: (f: File | null) => void;
  onClose: () => void;
}) {
  const { state, days, missDays, tapMissYou, openSub, onPickBg, onClose } = props;
  const bgInput = useRef<HTMLInputElement | null>(null);
  const [pulse, setPulse] = useState(0);
  /** 今天是否已打卡（第四十三轮：每天点击一次后大圆消失，次日恢复显示） */
  const missedToday = (state.missYouByDay?.[todayKey()] ?? 0) > 0;

  /** 头像 + 下方想念天数徽标（点击「每天想你」后出现） */
  // 第十六轮：TA 头像下显示 AI 当前心情小胶囊（情绪非平静时才显示，与想念徽章同款白胶囊）
  const taMood = (() => {
    try {
      const pid = readInviteMeta().partnerContactId;
      if (!pid) return null;
      const m = aiMoodOf(pid);
      return m.tag === 'normal' ? null : MOOD_DISPLAY[m.tag];
    } catch {
      return null;
    }
  })();
  const avatarCol = (side: 'me' | 'ta') => {
    const isMe = side === 'me';
    return (
      <div className="flex w-[78px] flex-col items-center">
        <CoupleAvatar src={isMe ? state.meAvatar : state.taAvatar} name={isMe ? state.meName : state.taName} size={52} />
        {!isMe && taMood && (
          <span
            data-testid="couple-ta-mood"
            className="mt-1 rounded-full bg-white/90 dark:bg-zinc-800/92 px-2 py-[3px] text-[10px] font-medium leading-none text-[#5a5a62] dark:text-zinc-300 shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-sm"
          >
            {taMood.emoji} {taMood.label}
          </span>
        )}
        {missDays != null && (
          <button
            type="button"
            onClick={() => openSub('missyou')}
            className="mt-1 rounded-full bg-white/90 dark:bg-zinc-800/92 px-2 py-[3px] text-[10px] font-medium leading-none text-[#5a5a62] dark:text-zinc-300 shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity active:opacity-60"
          >
            {isMe ? '想他' : '想我'} {missDays} 天
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* 可滚动内容区 */}
      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        <div className="px-5 pt-[60px]">
          {/* 点击标题返回手机主界面（第七轮用户要求） */}
          <button
            type="button"
            data-testid="couple-home-title"
            onClick={onClose}
            aria-label="返回主界面"
            className="text-left text-[24px] font-bold leading-tight tracking-tight transition-opacity active:opacity-40"
          >
            恋人空间
          </button>
        </div>

      {/* 双头像 + 纪念日气泡 + 想念天数 */}
        <div className="mt-3 flex items-start justify-between px-4">
          {avatarCol('me')}
          <div className="relative flex-1 px-1.5 pt-1">
            {/* 虚线连接线 */}
            <svg viewBox="0 0 200 40" className="absolute left-1 right-1 top-[22px] h-9 w-[calc(100%-8px)]" aria-hidden="true">
              <path d="M6 14 C 60 -6, 80 40, 100 20 S 150 6, 194 26" fill="none" stroke="#c7c7ce" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
            </svg>
            <button
              type="button"
              onClick={() => openSub('anniv')}
              className="relative mx-auto flex min-h-[54px] w-[164px] items-center justify-center rounded-full border-2 border-white dark:border-white/25 bg-white/90 dark:bg-zinc-800/92 px-3 py-2 text-center shadow-[0_6px_16px_rgba(0,0,0,0.09)] backdrop-blur-sm transition-transform active:scale-[0.97]"
            >
              {days == null ? (
                <span className="text-[12.5px] font-semibold leading-snug text-[#4a4a52] dark:text-zinc-200">
                  点击设置你们
                  <br />
                  相恋的纪念日
                </span>
              ) : (
                <span className="text-[12.5px] font-semibold leading-snug text-[#4a4a52] dark:text-zinc-200">
                  已相恋
                  <br />
                  {days} 天
                </span>
              )}
            </button>
          </div>
          {avatarCol('ta')}
        </div>

      {/* 每天想你大圆（第四十三轮：当天已打卡时隐藏，次日恢复；圆内字样只剩「每天想你」，引号装饰已删） */}
      {!missedToday && (
      <div className="relative mt-3 flex h-[286px] w-full items-start justify-center">
        <button
          type="button"
          data-testid="miss-you-btn"
          onClick={() => {
            tapMissYou();
            setPulse((p) => p + 1);
          }}
          aria-label="每天想你，点击打卡"
          className="group relative top-[36px] flex h-[150px] w-[150px] items-center justify-center rounded-full border border-white/70 bg-white/25 shadow-[0_16px_40px_rgba(70,70,80,0.32)] backdrop-blur-2xl backdrop-saturate-150 transition-transform active:scale-[0.97]"
        >
          <span aria-hidden="true" className="absolute -inset-2.5 rounded-full bg-white/30" />
          <span key={pulse} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-white/40 [animation:couple-ripple-out_.7s_ease-out]" />
          <span key={`t${pulse}`} className="relative block text-[20px] font-bold tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.18)] [animation:couple-pop-heart_.45s_ease-out]">
            每天想你
          </span>
        </button>
      </div>
      )}

        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onPickBg(e.target.files?.[0] ?? null);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {/* 右侧悬浮操作（想念记录 / 换背景）：固定在功能卡上方，不随内容滚动；第四十二轮：毛玻璃胶囊按钮 */}
      <div className="absolute bottom-[116px] right-3 z-20 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => openSub('missyou')}
          aria-label="每天想你记录"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/45 dark:bg-zinc-800/65 text-[#5a5a62] dark:text-zinc-300 shadow-[0_4px_14px_rgba(0,0,0,0.10)] backdrop-blur-2xl backdrop-saturate-150 transition-opacity active:opacity-70"
        >
          <Heart className="h-4 w-4" fill="none" />
        </button>
        <button
          type="button"
          onClick={() => bgInput.current?.click()}
          aria-label="更换背景"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/45 dark:bg-zinc-800/65 text-[#5a5a62] dark:text-zinc-300 shadow-[0_4px_14px_rgba(0,0,0,0.10)] backdrop-blur-2xl backdrop-saturate-150 transition-opacity active:opacity-70"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </div>

      {/* 底部固定四功能卡（不随内容滚动，始终贴在 Tab 栏上方；第二十五轮：浅灰白圆角矩形风） */}
      <div className="relative z-10 grid shrink-0 grid-cols-4 gap-2 px-3 pb-3 pt-2">
        {([
          { key: 'tree', label: '许愿树\n成长记', icon: <Sprout className="h-6 w-6 text-[#3c3c42] dark:text-zinc-200" strokeWidth={1.9} /> },
          { key: 'track', label: '情侣轨迹', icon: <Compass className="h-6 w-6 text-[#3c3c42] dark:text-zinc-200" strokeWidth={1.9} /> },
          { key: 'quiz', label: '甜蜜\n小问答', icon: <MessageCircleHeart className="h-6 w-6 text-[#3c3c42] dark:text-zinc-200" strokeWidth={1.9} /> },
          { key: 'letters', label: '情书', icon: <BookHeart className="h-6 w-6 text-[#3c3c42] dark:text-zinc-200" strokeWidth={1.9} /> },
        ] as const).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => openSub(c.key as SubPage)}
            className="flex h-[86px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#26262b] dark:text-zinc-100 shadow-[0_6px_16px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-transform active:scale-[0.96]"
          >
            {c.icon}
            <span className="whitespace-pre-line text-center text-[11px] font-medium leading-tight">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ---------------- 发现页（图3） ----------------

const DISCOVER_GRID: { key: SubPage; label: string; icon: React.ReactNode }[] = [
  { key: 'mood', label: '心情日记', icon: <NotebookPen className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'tarot', label: '爱情塔罗', icon: <Scale className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'hundred', label: '100件小事', icon: <Heart className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'pact', label: '恋爱协议', icon: <Pencil className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'exam', label: '恋爱水平考试', icon: <CalendarClock className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'zodiac', label: '星座缘分', icon: <Star className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'chronicle', label: '恋爱编年史', icon: <CalendarDays className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'stone', label: '三生石', icon: <Gem className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'reply', label: '回复挑战', icon: <MessageCircleHeart className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'hotel', label: '情侣酒店', icon: <Users className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'status', label: '恋爱状态', icon: <Sparkles className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'impress', label: '情侣印象', icon: <Smile className="h-7 w-7" strokeWidth={1.9} /> },
];

/** 情侣酒店 → 美团「酒店旅行」频道（第十九轮需求48）：写入待打开页并切到美团 App */
function openMeituanTravel(): void {
  setMtPendingPage('travel');
  const ui = useUI.getState();
  if (ui.locked) return;
  if (ui.activeApp && ui.activeApp !== 'meituan') ui.switchToApp('meituan');
  else if (!ui.activeApp || ui.phase === 'closed') ui.openApp('meituan');
}

function DiscoverPage({ openSub }: { openSub: (s: SubPage) => void }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-5">
      <div className="px-5 pt-[60px]">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">发现</h1>
        <p className="mt-0.5 text-[13px] text-[#8e8e96] dark:text-zinc-400">一起玩吧</p>
      </div>

      {/* 两张大卡 */}
      <div className="mt-3.5 grid grid-cols-2 gap-2.5 px-3">
        <button
          type="button"
          onClick={() => openSub('track')}
          className="overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-[0_8px_22px_rgba(0,0,0,0.08)] transition-transform active:scale-[0.98]"
        >
          { }
          <img src="/couple-map.png" alt="情侣轨迹" className="h-[118px] w-full rounded-t-2xl object-cover" draggable={false} />
          <div className="flex h-[44px] items-center justify-center bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 ring-1 ring-black/[0.04] dark:ring-white/10">
            情侣轨迹
          </div>
        </button>
        <button
          type="button"
          onClick={() => openSub('house')}
          className="overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-[0_8px_22px_rgba(0,0,0,0.08)] transition-transform active:scale-[0.98]"
        >
          { }
          <img src="/couple-house.png" alt="情侣小家" className="h-[118px] w-full rounded-t-2xl object-cover" draggable={false} />
          <div className="flex h-[44px] items-center justify-center bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 ring-1 ring-black/[0.04] dark:ring-white/10">
            情侣小家
          </div>
        </button>
      </div>

      {/* 情感升温小技巧 3×4 宫格 */}
      <h2 className="px-4 pb-2.5 pt-5 text-[16px] font-bold">情感升温小技巧</h2>
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2.5 px-3 pb-3">
        {DISCOVER_GRID.map((it, i) => (
          <button
            key={it.key + String(i)}
            type="button"
            onClick={() => (it.key === 'hotel' ? openMeituanTravel() : openSub(it.key))}
            data-testid={it.key === 'hotel' ? 'discover-hotel' : undefined}
            className="flex h-[86px] flex-col items-center justify-center gap-2 rounded-2xl transition-transform active:scale-[0.96]"
            style={{ background: ['#f7f7f9', '#f1f1f4', '#ebebee'][i % 3] }}
          >
            <span className="text-[#5a5a63] dark:text-zinc-300">{it.icon}</span>
            <span className="px-1 text-center text-[12px] font-medium leading-tight text-[#3c3c42] dark:text-zinc-200">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 相册页（图4） ----------------

const ALBUM_TINTS = ['#f5f5f7', '#ededf0', '#f8f8fa', '#eaeaee'];
const FIXED_ALBUM_ICONS: Record<string, React.ReactNode> = {
  ta: <Camera className="h-12 w-12" strokeWidth={1.5} />,
  chat: <MessageCircleHeart className="h-12 w-12" strokeWidth={1.5} />,
  diary: <NotebookPen className="h-12 w-12" strokeWidth={1.5} />,
  anniv: <CalendarDays className="h-12 w-12" strokeWidth={1.5} />,
};

function AlbumPage(props: {
  state: CoupleState;
  patch: (p: Partial<CoupleState>) => void;
  showToast: (m: string) => void;
  openAlbum: (id: string) => void;
}) {
  const { state, patch, showToast, openAlbum } = props;
  const input = useRef<HTMLInputElement | null>(null);
  const targetAlbum = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [manage, setManage] = useState(false);

  const uploadTo = (id: string) => {
    targetAlbum.current = id;
    input.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    const id = targetAlbum.current;
    if (!files || !id) return;
    const album = state.albums.find((a) => a.id === id);
    if (!album) return;
    showToast('正在上传…');
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        urls.push(await fileToScaledDataURL(f, 900, 0.72));
      } catch {
        /* 单张失败跳过 */
      }
    }
    if (urls.length === 0) {
      showToast('图片处理失败');
      return;
    }
    patch({ albums: state.albums.map((a) => (a.id === id ? { ...a, photos: [...a.photos, ...urls] } : a)) });
    showToast(`已上传 ${urls.length} 张 ♡`);
  };

  const createAlbum = () => {
    const name = newName.trim() || `相册 ${state.albums.length - 3}`;
    patch({ albums: [...state.albums, { id: uid(), name, desc: '', photos: [] }] });
    setCreating(false);
    setNewName('');
    showToast('相册已创建 ♡');
  };

  const removeAlbum = (id: string) => {
    if (['ta', 'chat', 'diary', 'anniv'].includes(id)) {
      showToast('固定相册不能删除哦');
      return;
    }
    patch({ albums: state.albums.filter((a) => a.id !== id) });
    setManage(false);
    showToast('相册已删除');
  };

  const custom = state.albums.filter((a) => !['ta', 'chat', 'diary', 'anniv'].includes(a.id));

  return (
    <div className="relative h-full overflow-y-auto overscroll-contain pb-24">
      <div className="px-5 pt-[60px]">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">相册</h1>
      </div>

      {/* 四张固定上传卡 2×2：点击整卡进入独立相册页 */}
      <div className="mt-3.5 grid grid-cols-2 gap-2.5 px-1">
        {state.albums.slice(0, 4).map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openAlbum(a.id)}
            className="relative overflow-hidden rounded-2xl p-3.5 text-left shadow-[0_6px_16px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.98]"
            style={{ background: ALBUM_TINTS[i] }}
          >
            <div className="text-[16px] font-bold text-[#3a3a40] dark:text-zinc-200">{a.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-[#9a9aa2] dark:text-zinc-400">{a.desc}</div>
            <div className="mt-2 flex items-center gap-2">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  uploadTo(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    uploadTo(a.id);
                  }
                }}
                className="rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3 py-1 text-[11.5px] font-medium text-[#4a4a52] dark:text-zinc-200 shadow-sm"
              >
                立即上传
              </span>
              <span className="text-[11px] text-[#b6b6bd] dark:text-zinc-500">{a.photos.length} 张</span>
            </div>
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-1.5 -right-1 text-[#d9d9de] dark:text-zinc-600">
              {FIXED_ALBUM_ICONS[a.id]}
            </span>
          </button>
        ))}
      </div>

      {/* 情侣私密相册 */}
      <div className="mt-6 flex items-center justify-between px-1.5">
        <h2 className="text-[17px] font-bold">情侣私密相册</h2>
        <button
          type="button"
          onClick={() => setManage((v) => !v)}
          aria-label="管理相册"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5a5a62] dark:text-zinc-300 transition-opacity active:opacity-60"
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[2px] w-[18px] rounded bg-current" />
            <span className="block h-[2px] w-[18px] rounded bg-current" />
            <span className="block h-[2px] w-[18px] rounded bg-current" />
          </span>
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5 px-1">
        {/* 新建 tile */}
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="新建相册"
          className="flex h-[140px] items-center justify-center rounded-xl bg-[#f0f0f3]/90 dark:bg-zinc-900/80/90 transition-opacity active:opacity-70"
        >
          <Plus className="h-10 w-10 text-[#c2c2c9] dark:text-zinc-500" strokeWidth={1.6} />
        </button>
        {custom.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openAlbum(a.id)}
            className="relative h-[140px] overflow-hidden rounded-xl bg-[#e6e6ea] dark:bg-zinc-900/80 text-left transition-transform active:scale-[0.98]"
          >
            {a.photos[0] ? (
              isTextPhoto(a.photos[0]) ? (
                // 文字图片封面（第六十轮极简风）：只显示画面（desc），纯白 + 细描边 + 灰字，与瓦片/大图同风格
                <span className="flex h-full w-full items-center justify-center bg-white dark:bg-zinc-600 px-4 ring-1 ring-inset ring-black/[0.06] dark:ring-white/10">
                  <span className="line-clamp-4 w-full text-center text-[11px] leading-[1.75] tracking-[0.01em] text-[#9a9aa2] dark:text-zinc-400">{a.photos[0].desc || a.photos[0].text}</span>
                </span>
              ) : (
                <img src={photoSrc(a.photos[0])} alt={a.name} className="h-full w-full object-cover" draggable={false} />
              )
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[#c2c2c9] dark:text-zinc-500">
                <ImageIcon className="h-9 w-9" strokeWidth={1.4} />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-6 text-[14px] font-medium text-white">
              {a.name}
              <span className="text-[12px] opacity-80">{a.photos.length} 张</span>
            </span>
            {manage && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAlbum(a.id);
                }}
                onKeyDown={(e) => e.key === 'Enter' && removeAlbum(a.id)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white"
                aria-label={`删除${a.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 悬浮新建相册按钮 */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="fixed bottom-[86px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-5 py-2.5 text-[14px] font-semibold text-[#26262b] dark:text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-transform active:scale-[0.97]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.06]">
          <Plus className="h-3.5 w-3.5" />
        </span>
        新建相册
      </button>

      {/* 新建相册弹层 */}
      {creating && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-10" onClick={() => setCreating(false)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-semibold text-[#2c2c30] dark:text-zinc-100">新建相册</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="给相册取个名字吧"
              maxLength={12}
              className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] text-[#2c2c30] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
            />
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">
                取消
              </button>
              <button type="button" onClick={createAlbum} className="h-11 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[15px] font-semibold text-white">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

// ---------------- 我们页（图5） ----------------

/** 灰色小蝴蝶结（蕾丝装饰，白灰主题） */
function LaceBow({ className = '', size = 26 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 30 22" fill="none" aria-hidden="true" className={className}>
      <path d="M14 11 L3.5 4.5 C2 3.6 1 4.6 1.4 6.2 L3.6 13.4 C4 14.9 5.4 15.4 6.6 14.5 Z" fill="#e8e8ec" stroke="#c9c9d0" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M16 11 L26.5 4.5 C28 3.6 29 4.6 28.6 6.2 L26.4 13.4 C26 14.9 24.6 15.4 23.4 14.5 Z" fill="#e8e8ec" stroke="#c9c9d0" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M12.6 12.5 C11.8 15.5 12.4 18.2 13.8 20.2 M17.4 12.5 C18.2 15.5 17.6 18.2 16.2 20.2" stroke="#c9c9d0" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="15" cy="10.6" r="3.1" fill="#dcdce1" stroke="#bdbdc5" strokeWidth="1.1" />
    </svg>
  );
}

/** 蕾丝圆点拱边（一排带圆点的半圆拱，参考图样式） */
function LaceArches({ count = 16 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-[5px]">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="relative block h-[13px] w-[15px] overflow-hidden rounded-t-full bg-[#f1f1f4] dark:bg-zinc-900/70 shadow-[inset_0_0_0_1px_#e4e4e9]">
          <span className="absolute left-1/2 top-[3px] h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#d6d6dc]" />
          <span className="absolute left-[3px] top-[7.5px] h-[2px] w-[2px] rounded-full bg-[#dedee3]" />
          <span className="absolute right-[3px] top-[7.5px] h-[2px] w-[2px] rounded-full bg-[#dedee3]" />
        </span>
      ))}
    </div>
  );
}

function UsPage({ state, days, openSub }: { state: CoupleState; days: number | null; openSub: (s: SubPage) => void }) {
  const rows: { key: SubPage; label: string; icon: React.ReactNode; right?: React.ReactNode }[] = [
    { key: 'profile', label: '恋爱资料', icon: <IdCard className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    {
      key: 'anniv',
      label: '纪念日',
      icon: <CalendarDays className="h-[19px] w-[19px]" strokeWidth={1.8} />,
      right: <span className="max-w-[150px] truncate text-[12px] text-[#b6b6bd] dark:text-zinc-500">{state.anniversary ? `${state.anniversary}` : '还没设置纪念日提醒哦'}</span>,
    },
    { key: 'missyou', label: '每天想你', icon: <Heart className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'quiz', label: '甜蜜小问答', icon: <MessageCircleHeart className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'chapel', label: '小礼堂', icon: <Landmark className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'support', label: '联系客服', icon: <Headphones className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'settings', label: '设置', icon: <SettingsIcon className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
  ];

  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-6">
      <div className="px-3 pt-[62px]">
        {/* 蕾丝装饰日记卡：蝴蝶结 + 圆点拱边 + 方格纸底纹 + 像素心 */}
        <div className="relative overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl pb-4 shadow-[0_8px_22px_rgba(0,0,0,0.06)]">
          {/* 方格纸底纹 */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(#00000007_1px,transparent_1px),linear-gradient(90deg,#00000007_1px,transparent_1px)] bg-[size:14px_14px]" />
          {/* 左右角小蝴蝶结 */}
          <LaceBow className="absolute left-1.5 top-1.5 opacity-80" size={22} />
          <LaceBow className="absolute right-1.5 top-1.5 -scale-x-100 opacity-80" size={22} />
          {/* 顶部蕾丝拱边 + 中心蝴蝶结 */}
          <div className="relative mx-1 mt-1">
            <LaceArches count={16} />
            <LaceBow className="absolute left-1/2 top-[-3px] -translate-x-1/2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.10)]" size={26} />
          </div>

          <div className="relative -mt-0.5 text-center text-[13px] font-bold tracking-[2px] text-[#4a4a52] dark:text-zinc-200">
            <span className="mx-1 text-[#b9b9c1]">+</span>
            <span className="mx-0.5 text-[#b9b9c1]">♡</span>
            <span className="mx-1 text-[#cfcfd6] dark:text-zinc-600">---</span>
            <span className="mx-1 text-[#b9b9c1]">✕</span>
            <span className="mx-1.5">我们の恋爱日记</span>
            <span className="mx-1 text-[#b9b9c1]">✕</span>
            <span className="mx-1 text-[#cfcfd6] dark:text-zinc-600">---</span>
            <span className="mx-0.5 text-[#b9b9c1]">♡</span>
            <span className="mx-1 text-[#b9b9c1]">+</span>
          </div>

          {/* 双头像 + 浅灰爱心 + 进度条 + 天数 */}
          <div className="relative mt-4 flex items-start justify-between px-5">
            <span aria-hidden="true" className="mt-16 text-[13px] text-[#d9d9de] dark:text-zinc-600">♡</span>
            <CoupleAvatar src={state.meAvatar} name={state.meName} size={62} ring={false} />
            <div className="flex flex-col items-center gap-1 pt-1.5">
              <Heart className="h-9 w-9 text-[#d6d6dc] dark:text-zinc-600" fill="#e2e2e7" strokeWidth={1.1} />
              <span className="text-[11px] text-[#8e8e96] dark:text-zinc-400">恋爱进度条</span>
              <div className="h-1.5 w-[80px] overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#8e8e97,#5c5c64)]" style={{ width: `${Math.min(100, ((days ?? 0) % 365) / 3.65 + 20)}%` }} />
              </div>
            </div>
            <CoupleAvatar src={state.taAvatar} name={state.taName} size={62} ring={false} />
            <span aria-hidden="true" className="mt-16 text-[13px] text-[#d9d9de] dark:text-zinc-600">♡</span>
          </div>
          <div className="relative mt-2.5 text-center text-[21px] font-bold text-[#2c2c30] dark:text-zinc-100">{days == null ? '未设置纪念日' : `${days} 天`}</div>
        </div>

        {/* 功能列表 */}
        <div className="mt-3 overflow-hidden rounded-2xl bg-white/95 dark:bg-zinc-800/95 shadow-[0_8px_22px_rgba(0,0,0,0.05)] backdrop-blur-sm">
          {rows.map((r, i) => (
            <button
              key={r.key + r.label}
              type="button"
              onClick={() => openSub(r.key)}
              className={`flex h-[52px] w-full items-center gap-3.5 px-4 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900/70 ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/10' : ''}`}
            >
              <span className="text-[#5a5a63] dark:text-zinc-300">{r.icon}</span>
              <span className="flex-1 text-[15px] font-medium text-[#2c2c30] dark:text-zinc-100">{r.label}</span>
              {r.right}
              <ChevronRight className="h-4 w-4 text-[#c6c6cd] dark:text-zinc-500" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 子页容器 ----------------

function SubShell(props: { title: string; onBack: () => void; children: React.ReactNode; right?: React.ReactNode }) {
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
type PatchFn = (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;

/**
 * 通用留言线程（第十轮 → 第十二轮重做样式）。
 * 样式仿微信朋友圈评论区 + 参考截图（照片留言气泡）：我发消息（粉色右侧）→ AI（TA）根据人设记忆自动回复（左侧，可多轮往返）；
 * 所有留言一律不显示「名字：」前缀（第十二轮用户要求：所有留言删除名字和冒号）；
 * 每条留言带朋友圈式灰色时间（刚刚/x分钟前/1小时前…）；
 * 点击 TA 的留言即可针对那一条回复（引用条可取消，AI 会知道你在回复哪句）；
 * 每一条都进恋人（AI）的记忆（coupleMemoryDiff 统一钩子）。
 */

/** 留言/徽标文本截断（组件内用；超长加省略号） */
function cutText(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 朋友圈式评论时间（刚刚 / N分钟前 / N小时前 / 昨天 / M月D日） */
function fmtCmtTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 172_800_000) return '昨天';
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function CommentThread({
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

function SubRouter(props: {
  sub: SubPage;
  state: CoupleState;
  patch: PatchFn;
  albumId: string | null;
  days: number | null;
  tapMissYou: () => void;
  waterTree: () => void;
  close: () => void;
  showToast: (m: string) => void;
  openSub: (s: SubPage) => void;
  onReset: () => void;
}) {
  const { sub, state, patch, days, tapMissYou, waterTree, close, showToast, openSub, onReset } = props;

  switch (sub) {
    case 'tree':
      return <TreePage state={state} patch={patch} waterTree={waterTree} close={close} showToast={showToast} />;
    case 'track':
      return <TrackPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
    case 'quiz':
      return <QuizPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
    case 'letters':
      return <LettersPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'house':
      // 第五十九轮：情侣小家升级为可交互小家（家具开关/拖拽、摇杆操控小人、视角跟随）
      return <CoupleHome close={close} />;
    case 'mood':
      return <MoodPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'tarot':
      return <CoupleTarotPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'hundred':
      return <HundredPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'pact':
      return <PactPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'exam':
      return <ExamPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'zodiac':
      return <ZodiacPage state={state} patch={patch} close={close} />;
    case 'chronicle':
      return <ChroniclePage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'stone':
      return <StonePage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'reply':
      return <ReplyPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'hotel':
      return <HotelJump close={close} />;
    case 'status':
      return <StatusPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'impress':
      return <ImpressPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'profile':
      return <ProfilePage state={state} patch={patch} showToast={showToast} close={close} onReset={onReset} />;
    case 'missyou':
      return <MissYouPage state={state} patch={patch} tapMissYou={tapMissYou} showToast={showToast} close={close} />;
    case 'chapel':
      return <ChapelPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'support':
      return <SupportPage close={close} />;
    case 'settings':
      return <SettingsPage state={state} patch={patch} showToast={showToast} close={close} onReset={onReset} />;
    case 'album':
      return <AlbumDetail state={state} patch={patch} albumId={props.albumId} showToast={showToast} close={close} />;
    case 'anniv':
      // 纪念日设置页（首页气泡/我们页入口共用）
      return <AnniversaryPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
  }
}

// ---------------- 各子页实现 ----------------

/** 纪念日页（参考图3）：英雄卡 + 纪念日列表 + 添加纪念日 */
const ANNIV_PRESETS: { key: string; label: string; icon: React.ReactNode; mode: 'since' | 'next' }[] = [
  { key: 'myBd', label: '我的生日', icon: <Cake className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'taBd', label: 'TA的生日', icon: <Gift className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'kiss', label: '第一次接吻的日子', icon: <Heart className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'hug', label: '第一次拥抱的日子', icon: <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'travel', label: '第一次携手旅行的日子', icon: <Plane className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'wedding', label: '结婚纪念日', icon: <Landmark className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
];

function AnniversaryPage(props: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; close: () => void; showToast: (m: string) => void }) {
  const { state, patch, days, close, showToast } = props;
  /** 正在编辑的纪念日：love = 在一起纪念日；其余为 annivExtra 键 */
  const [editing, setEditing] = useState<{ key: string; label: string; date: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [dateWheel, setDateWheel] = useState<null | 'edit' | 'add'>(null); // 日期滚轮（第二十轮：所有日期选择改上下滑式）
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');

  const extraOf = (key: string) => state.annivExtra.find((e) => e.key === key);
  const dateOf = (key: string) => extraOf(key)?.date || null;

  const saveEdit = () => {
    if (!editing) return;
    if (!editing.date) {
      showToast('先选一个日期哦');
      return;
    }
    if (editing.key === 'love') {
      patch({ anniversary: editing.date });
    } else {
      const others = state.annivExtra.filter((e) => e.key !== editing.key);
      patch({ annivExtra: [...others, { key: editing.key, label: editing.label, date: editing.date }] });
    }
    showToast('纪念日已保存 ♡');
    setEditing(null);
  };

  const removeEdit = () => {
    if (!editing) return;
    if (editing.key === 'love') {
      patch({ anniversary: null });
    } else {
      patch({ annivExtra: state.annivExtra.filter((e) => e.key !== editing.key) });
    }
    showToast('已清除该纪念日');
    setEditing(null);
  };

  const addCustom = () => {
    const name = newName.trim();
    if (!name || !newDate) {
      showToast('填好名称和日期哦');
      return;
    }
    patch({ annivExtra: [...state.annivExtra, { key: uid(), label: name, date: newDate }] });
    setAdding(false);
    setNewName('');
    setNewDate('');
    showToast('纪念日已添加 ♡');
  };

  const setReminder = state.annivExtra.length > 0;

  return (
    <SubShell title="设置纪念日" onBack={close}>
      {/* 英雄卡：双头像 + 在一起天数 */}
      <div className="relative mt-3 overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#ffffff_0%,#f2f2f5_60%,#e7e7eb_100%)] dark:bg-[linear-gradient(160deg,#1f1f23_0%,#19191d_60%,#141417_100%)] px-5 pb-5 pt-6 text-center shadow-[0_10px_26px_rgba(0,0,0,0.08)]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/70 dark:bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 top-8 h-20 w-20 rounded-full bg-white/50 dark:bg-white/10" />
        <div className="relative mx-auto flex w-fit items-center">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80 ring-2 ring-white shadow-sm">
            {state.meAvatar ? <img src={state.meAvatar} alt={state.meName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
          </div>
          <div className="relative ml-2.5 h-12 w-12 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80 ring-2 ring-white shadow-sm">
            {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
          </div>
        </div>
        <div className="relative mt-1.5 flex items-center justify-center gap-4 text-[11px] text-[#8e8e96] dark:text-zinc-400">
          <span className="max-w-[100px] truncate">{state.meName || '我'}</span>
          <span className="max-w-[100px] truncate">{state.taName || 'TA'}</span>
        </div>
        <div className="relative mt-3 flex items-baseline justify-center gap-1.5 text-[15px] text-[#4a4a52] dark:text-zinc-200">
          我们已经在一起
          <span className="text-[30px] font-extrabold leading-none text-[#2c2c30] dark:text-zinc-100">{days ?? '--'}</span>
          天
        </div>
        {state.anniversary && <div className="relative mt-1.5 text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">起始日期 {fmtDateCn(state.anniversary)}</div>}
      </div>

      {/* 纪念日列表 */}
      <div className="mt-3.5 overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-sm">
        {/* 我们在一起（主纪念日） */}
        <button
          type="button"
          onClick={() => setEditing({ key: 'love', label: '我们在一起', date: state.anniversary || '' })}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#6e6e76] dark:text-zinc-300">
            <Heart className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-[#2c2c30] dark:text-zinc-100">我们在一起</span>
            <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{state.anniversary ? fmtDateCn(state.anniversary) : '点击设置那一天'}</span>
          </span>
          <span className="shrink-0 text-[12px] text-[#8e8e96] dark:text-zinc-400">
            {days != null ? (
              <>
                已经 <span className="text-[20px] font-extrabold text-[#3f3f46] dark:text-zinc-200">{days}</span> 天
              </>
            ) : (
              <Plus className="h-5 w-5 rounded-full border border-[#d9d9de] dark:border-white/10 p-0.5 text-[#8e8e96] dark:text-zinc-400" />
            )}
          </span>
        </button>

        {ANNIV_PRESETS.map((pr) => {
          const date = dateOf(pr.key);
          const extra = extraOf(pr.key);
          return (
            <button
              key={pr.key}
              type="button"
              onClick={() => setEditing({ key: pr.key, label: pr.label, date: date || '' })}
              className="flex w-full items-center gap-3 border-t border-black/[0.04] dark:border-white/10 px-4 py-3 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#6e6e76] dark:text-zinc-300">{pr.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-[#2c2c30] dark:text-zinc-100">{pr.key === 'myBd' ? `${state.meName || '我'}的生日` : pr.key === 'taBd' ? `${state.taName || 'TA'}的生日` : pr.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{date ? fmtDateCn(date) : '点击设置那一天'}</span>
              </span>
              <span className="shrink-0 text-[12px] text-[#8e8e96] dark:text-zinc-400">
                {date ? (
                  pr.mode === 'next' ? (
                    <>
                      还有 <span className="text-[20px] font-extrabold text-[#3f3f46] dark:text-zinc-200">{daysToNextMonthDay(date) ?? '--'}</span> 天
                    </>
                  ) : (
                    <>
                      已经 <span className="text-[20px] font-extrabold text-[#3f3f46] dark:text-zinc-200">{daysSince(date) ?? '--'}</span> 天
                    </>
                  )
                ) : (
                  <Plus className="h-5 w-5 rounded-full border border-[#d9d9de] dark:border-white/10 p-0.5 text-[#8e8e96] dark:text-zinc-400" />
                )}
              </span>
              {extra == null && <span className="hidden" />}
            </button>
          );
        })}

        {/* 自建纪念日 */}
        {state.annivExtra
          .filter((e) => !ANNIV_PRESETS.some((p) => p.key === e.key))
          .map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setEditing({ key: e.key, label: e.label, date: e.date })}
              className="flex w-full items-center gap-3 border-t border-black/[0.04] dark:border-white/10 px-4 py-3 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#6e6e76] dark:text-zinc-300">
                <Star className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-[#2c2c30] dark:text-zinc-100">{e.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{fmtDateCn(e.date)}</span>
              </span>
              <span className="shrink-0 text-[12px] text-[#8e8e96] dark:text-zinc-400">
                已经 <span className="text-[20px] font-extrabold text-[#3f3f46] dark:text-zinc-200">{daysSince(e.date) ?? '--'}</span> 天
              </span>
            </button>
          ))}
      </div>

      {/* 底部：提醒提示 + 添加纪念日 */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <span className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] ${setReminder ? 'border-[#d9d9de] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[#8e8e96] dark:text-zinc-400' : 'border-[#e6e6ea] dark:border-white/10 bg-[#f7f7f9] dark:bg-zinc-900/70 text-[#9a9aa2] dark:text-zinc-400'}`}>
          <Sparkles className="h-3.5 w-3.5" />
          {setReminder ? '纪念日提醒已开启' : '还没设置提醒哦'}
        </span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 py-2 text-[12.5px] font-semibold text-[#26262b] dark:text-zinc-100 shadow-[0_4px_12px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 transition-transform active:scale-[0.97]"
        >
          <Plus className="h-3.5 w-3.5" /> 添加纪念日
        </button>
      </div>

      {/* 编辑纪念日弹层 */}
      {editing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setEditing(null)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">{editing.label}</div>
            <button
              type="button"
              onClick={() => setDateWheel('edit')}
              aria-label="选择日期"
              className="mt-3 flex h-11 w-full items-center justify-between rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] text-[#2c2c30] dark:text-zinc-100"
            >
              <span>{editing.date || '请选择日期'}</span>
              <CalendarDays className="h-4.5 w-4.5 text-[#8e8e96] dark:text-zinc-400" strokeWidth={1.8} />
            </button>
            <div className="mt-4 flex gap-2.5">
              {editing.key !== 'love' && (
                <button type="button" onClick={removeEdit} className="h-10 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 px-4 text-[13.5px] font-medium text-[#8e8e96] dark:text-zinc-400">
                  删除
                </button>
              )}
              <button type="button" onClick={() => setEditing(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300">
                取消
              </button>
              <button type="button" onClick={saveEdit} className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加纪念日弹层 */}
      {adding && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setAdding(false)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">添加纪念日</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="名称，比如「第一次看演唱会」"
              maxLength={14}
              className="mt-3 h-10 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[14px] outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={() => setDateWheel('add')}
              aria-label="选择日期"
              className="mt-2.5 flex h-10 w-full items-center justify-between rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[14px] text-[#2c2c30] dark:text-zinc-100"
            >
              <span className={newDate ? '' : 'text-[#b6b6bd] dark:text-zinc-500'}>{newDate || '请选择日期'}</span>
              <CalendarDays className="h-4.5 w-4.5 text-[#8e8e96] dark:text-zinc-400" strokeWidth={1.8} />
            </button>
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setAdding(false)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300">
                取消
              </button>
              <button type="button" onClick={addCustom} className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 日期滚轮弹窗（第二十轮：上下滑式，编辑/添加共用） */}
      <WheelDatePicker
        open={dateWheel !== null}
        value={dateWheel === 'edit' ? editing?.date || '' : newDate || ''}
        onConfirm={(v) => {
          if (dateWheel === 'edit') setEditing((e) => (e ? { ...e, date: v } : e));
          else setNewDate(v);
          setDateWheel(null);
        }}
        onCancel={() => setDateWheel(null)}
        title="选择日期"
      />
    </SubShell>
  );
}

/** 爱情小树（SVG 手绘风，随成长值 stage 0-4 变化：嫩芽→壮苗→树苗→小树→繁花大树），替代 emoji 图标 */
const LOVE_HEART_PATH = 'M0 2.2 C0 0.6 1.6 -0.6 3 0.4 L4.5 1.5 L6 0.4 C7.4 -0.6 9 0.6 9 2.2 C9 4.6 4.5 7.5 4.5 7.5 C4.5 7.5 0 4.6 0 2.2 Z';
function LoveHeartDot({ x, y, s = 1, fill = '#ff8fae' }: { x: number; y: number; s?: number; fill?: string }) {
  return <path d={LOVE_HEART_PATH} transform={`translate(${x} ${y}) scale(${s}) translate(-4.5 -3.5)`} fill={fill} />;
}

function LoveTree({ stage }: { stage: number }) {
  const s = Math.max(0, Math.min(4, stage));
  return (
    <svg viewBox="0 0 200 240" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="ltLeaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8e063" />
          <stop offset="100%" stopColor="#56ab2f" />
        </linearGradient>
        <linearGradient id="ltLeaf2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c7ee8f" />
          <stop offset="100%" stopColor="#7cc95c" />
        </linearGradient>
        <linearGradient id="ltTrunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a5713d" />
          <stop offset="55%" stopColor="#8a5a2e" />
          <stop offset="100%" stopColor="#6e4520" />
        </linearGradient>
        <radialGradient id="ltGlow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {s >= 3 && <ellipse cx="100" cy="120" rx="86" ry="80" fill="url(#ltGlow)" />}
      <ellipse cx="100" cy="228" rx={40 + s * 5} ry="8" fill="rgba(90,120,50,0.16)" />

      {s === 0 && (
        <g>
          <path d="M100 226 C100 214 99 204 100 192" stroke="#5ea732" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M100 198 C84 194 74 182 76 166 C92 168 102 180 100 198 Z" fill="url(#ltLeaf)" />
          <path d="M100 192 C116 188 126 176 124 160 C108 162 98 174 100 192 Z" fill="url(#ltLeaf2)" />
        </g>
      )}
      {s === 1 && (
        <g>
          <path d="M100 226 C100 208 99 192 100 174" stroke="#5ea732" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M100 202 C82 198 70 184 72 166 C90 170 102 184 100 202 Z" fill="url(#ltLeaf)" />
          <path d="M100 194 C118 190 130 176 128 158 C110 162 98 176 100 194 Z" fill="url(#ltLeaf2)" />
          <path d="M100 180 C88 170 86 156 92 144 C104 152 108 168 100 180 Z" fill="url(#ltLeaf2)" />
          <LoveHeartDot x={116} y={158} s={0.9} fill="#ffb3c6" />
        </g>
      )}
      {s === 2 && (
        <g>
          <path d="M95 226 L96 196 Q97 184 99 176 L103 176 Q104 186 105 196 L106 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="154" r="27" fill="url(#ltLeaf2)" />
          <circle cx="80" cy="168" r="19" fill="url(#ltLeaf)" />
          <circle cx="121" cy="166" r="18" fill="url(#ltLeaf)" />
          <circle cx="93" cy="143" r="15" fill="#c7ee8f" opacity="0.92" />
          <LoveHeartDot x={112} y={150} s={1} />
        </g>
      )}
      {s === 3 && (
        <g>
          <path d="M93 226 L94 196 Q95 178 90 164 L100 154 L110 164 Q105 178 106 196 L107 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="128" r="35" fill="url(#ltLeaf2)" />
          <circle cx="68" cy="150" r="25" fill="url(#ltLeaf)" />
          <circle cx="132" cy="148" r="26" fill="url(#ltLeaf)" />
          <circle cx="100" cy="106" r="21" fill="#c7ee8f" />
          <LoveHeartDot x={82} y={140} s={1.3} />
          <LoveHeartDot x={120} y={122} s={1.1} fill="#ffb3c6" />
          <LoveHeartDot x={100} y={158} s={0.9} fill="#ff8fae" />
        </g>
      )}
      {s === 4 && (
        <g>
          <path d="M88 226 L90 190 Q90 168 76 150 L92 136 L100 128 L108 136 L124 150 Q110 168 110 190 L112 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="100" r="42" fill="url(#ltLeaf2)" />
          <circle cx="58" cy="128" r="31" fill="url(#ltLeaf)" />
          <circle cx="142" cy="126" r="32" fill="url(#ltLeaf)" />
          <circle cx="100" cy="140" r="30" fill="url(#ltLeaf)" opacity="0.95" />
          <circle cx="90" cy="80" r="19" fill="#c7ee8f" />
          <LoveHeartDot x={70} y={104} s={1.5} />
          <LoveHeartDot x={130} y={92} s={1.3} fill="#ffb3c6" />
          <LoveHeartDot x={112} y={148} s={1.2} />
          <LoveHeartDot x={86} y={62} s={1} fill="#ff8fae" />
          <circle cx="64" cy="76" r="2" fill="#fff" opacity="0.9" />
          <circle cx="146" cy="66" r="1.6" fill="#fff" opacity="0.9" />
          <circle cx="156" cy="104" r="1.8" fill="#ffe9a8" opacity="0.95" />
        </g>
      )}
    </svg>
  );
}

/** 许愿树挂卡锚点（树冠上的挂点，百分比定位；可见卡数随成长 stage 增加——越长越能挂） */
const TREE_CARD_SLOTS: { x: number; y: number; r: number }[] = [
  { x: 27, y: 36, r: -7 },
  { x: 70, y: 32, r: 6 },
  { x: 48, y: 19, r: -4 },
  { x: 14, y: 55, r: 8 },
  { x: 85, y: 52, r: -6 },
  { x: 40, y: 64, r: 5 },
  { x: 63, y: 74, r: -8 },
];

/** 许愿树上挂的留言卡小卡（树冠锚点 + 挂绳 + 彩纸；点击进详情看正文+留言） */
function TreeCardChip({ card, x, y, r, onClick }: { card: TreeCard; x: number; y: number; r: number; onClick: () => void }) {
  const mine = card.from === 'me';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`查看${mine ? '我' : 'TA'}挂的留言卡片`}
      className="absolute z-10 transition-transform duration-150 active:scale-90"
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -50%) rotate(${r}deg)` }}
    >
      {/* 挂绳 */}
      <span aria-hidden="true" className="absolute bottom-full left-1/2 mb-[2px] h-[16px] w-[2px] -translate-x-1/2 rounded bg-[#8a5a2e]/70" />
      {/* 卡纸（我=粉 / TA=米黄） */}
      <span
        className="relative flex w-[76px] flex-col gap-[2px] rounded-[6px] border px-[6px] py-[5px] text-left shadow-[0_3px_8px_rgba(80,60,40,0.30)]"
        style={
          mine
            ? { background: 'linear-gradient(180deg,#fff1f5,#ffdce7)', borderColor: '#f2b3c5', color: '#8c4257' }
            : { background: 'linear-gradient(180deg,#fff9e2,#ffefb9)', borderColor: '#e2c05c', color: '#7c5a17' }
        }
      >
        <span className="line-clamp-2 break-all text-[9.5px] font-semibold leading-[1.35]">{card.text}</span>
        <span className="flex items-center justify-between">
          <span className="text-[8px] font-bold leading-none">{mine ? '我挂的' : 'TA挂的'}</span>
          {(card.comments?.length ?? 0) > 0 && (
            <span className="flex items-center gap-[1px] text-[8px] font-bold leading-none opacity-85">
              <MessageSquare className="h-[7px] w-[7px]" strokeWidth={2.6} aria-hidden="true" />
              {card.comments.length}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** 许愿树卡片详情弹层：卡片正文 + 卡片下双向留言区（我留言 → TA 接话；TA 留言 → 我接话） */
function TreeCardDetail({
  card,
  meName,
  taName,
  onClose,
  onSend,
}: {
  card: TreeCard;
  meName: string;
  taName: string;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState('');
  const mine = card.from === 'me';
  const owner = mine ? meName || '我' : taName || 'TA';
  const send = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput('');
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label="留言卡片详情">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div className="relative flex max-h-[80%] w-full max-w-[320px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_18px_50px_rgba(0,0,0,0.35)] dark:bg-zinc-900">
        {/* 卡片正文（彩纸） */}
        <div className="shrink-0 px-4 pb-3 pt-4">
          <div
            className="rounded-2xl border-2 px-4 py-5"
            style={
              mine
                ? { background: 'linear-gradient(180deg,#fff1f5,#ffdbe6)', borderColor: '#f2b3c5', color: '#8c4257' }
                : { background: 'linear-gradient(180deg,#fff9e2,#ffefb9)', borderColor: '#e2c05c', color: '#7c5a17' }
            }
          >
            <p className="break-all text-[15px] font-semibold leading-[1.7]">{card.text}</p>
            <p className="mt-3 text-right text-[11px] font-bold opacity-75">
              {owner} 挂的 · {fmtDate(card.at)}
            </p>
          </div>
        </div>
        {/* 留言区（卡片正文下面的双向留言） */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <p className="sticky top-0 z-[1] bg-white pb-1.5 pt-0.5 text-[11px] font-bold text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
            卡片下的留言 · {(card.comments ?? []).length}
          </p>
          {(card.comments ?? []).length === 0 && (
            <p className="py-5 text-center text-[12.5px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              还没有留言——{mine ? 'TA 会看到你挂的这张卡片，也可能会来下面留言' : '给 TA 挂的这张卡片回一句话吧'}
            </p>
          )}
          {(card.comments ?? []).map((m) => {
            const mMine = m.from === 'me';
            const who = mMine ? meName || '我' : taName || 'TA';
            return (
              <div key={m.id} className="flex items-start gap-2 py-[6px]">
                <span
                  className={`mt-[2px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                    mMine ? 'bg-[#ffdce7] text-[#8c4257]' : 'bg-[#ffefb9] text-[#7c5a17]'
                  }`}
                  aria-hidden="true"
                >
                  {who.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-semibold leading-tight text-zinc-400 dark:text-zinc-500">
                    {who} · {fmtDate(m.at).slice(5)}
                  </p>
                  <p className="mt-[1px] break-all text-[13.5px] leading-relaxed text-zinc-800 dark:text-zinc-100">{m.text}</p>
                </div>
              </div>
            );
          })}
        </div>
        {/* 输入行 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 90))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="在卡片下留一句话…"
            className="min-w-0 flex-1 rounded-full bg-zinc-100 px-3.5 py-2 text-[13.5px] outline-none dark:bg-zinc-800 dark:text-zinc-100"
            aria-label="卡片留言输入"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim()}
            aria-label="发送留言"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_3px_10px_rgba(242,83,106,0.30)] transition-transform active:scale-95 disabled:opacity-40"
          >
            <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 爱情小树成长记 · 许愿树版（第六十轮重做）——顶部悬挂木牌（等级星+进度+连续浇树）+ 许愿大树（树上挂留言卡：TA 会按人设/记忆/上下文自己挂卡与留言）+ 浇水/挂卡/全部卡片底栏 */
function TreePage({
  state,
  patch,
  waterTree,
  close,
  showToast,
}: {
  state: CoupleState;
  patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  waterTree: () => void;
  close: () => void;
  showToast: (m: string) => void;
}) {
  const tree = state.tree;
  const level = Math.max(1, Math.min(5, Math.ceil(tree / 20) || 1));
  const inLevel = tree >= 100 ? 20 : tree - (level - 1) * 20;
  const stage = Math.min(4, Math.floor(tree / 20));
  const streak = state.treeStreak?.n ?? 0;
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  const wateredToday = state.treeStreak?.last === today;
  const brokeStreak = !wateredToday && state.treeStreak?.last === yesterday; // 昨天浇了今天还没浇 → 断签提醒
  // TA（AI）连续浇树（第九轮：AI 会主动照顾小树）
  const taTreeStreak = useMemo(() => {
    let n = 0;
    const start = new Date();
    const hit = (d: Date) => state.taTreeStreak && state.taTreeStreak.n > 0 && state.taTreeStreak.last === todayKey(d);
    // taTreeStreak 只存最近一次：从今天起往回推（last 匹配即连续，再往前无法追溯，取 last 距今天数+1 逻辑简化）
    if (state.taTreeStreak?.last === todayKey(start)) {
      n = state.taTreeStreak.n;
    } else {
      start.setDate(start.getDate() - 1);
      if (state.taTreeStreak?.last === todayKey(start)) n = 0; // TA 昨天浇了今天还没浇
    }
    return n;
  }, [state.taTreeStreak]);
  const taWateredToday = state.taTreeStreak?.last === today;
  const [pop, setPop] = useState(0);

  // ---- 许愿树：卡片与弹层状态 ----
  const cards = state.treeCards ?? [];
  const visibleN = Math.min(2 + stage, TREE_CARD_SLOTS.length); // 成长值越高树上能挂越多（2→6 张）
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const openCard = cards.find((c) => c.id === openId) ?? null;

  /** 挂一张我的许愿卡（写进记忆让 TA 知道；TA 会来卡片下留言回应） */
  const hangCard = () => {
    const text = draft.trim().slice(0, 60);
    if (!text) return;
    const id = `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    patch((prev) => ({
      treeCards: [{ id, from: 'me' as const, text, at: Date.now(), comments: [] }, ...(prev.treeCards ?? [])].slice(0, 30),
    }));
    setComposing(false);
    setDraft('');
    setPop((p) => p + 1);
    showToast('卡片挂上许愿树啦，TA 会看到 ♡');
    scheduleTreeCardReply(id);
  };

  /** 在卡片下留言（TA 会按人设/记忆/上下文接话回复） */
  const commentCard = (cardId: string, text: string) => {
    const c = { id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from: 'me' as const, text: text.slice(0, 90), at: Date.now() };
    patch((prev) => ({
      treeCards: (prev.treeCards ?? []).map((x) => (x.id === cardId ? { ...x, comments: [...x.comments, c] } : x)),
    }));
    scheduleTreeCardReply(cardId);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#bfe9fb_0%,#d8f4fd_38%,#eefaf7_62%,#dff0d0_100%)] dark:bg-[linear-gradient(180deg,#0e1a22_0%,#101d24_38%,#0f1c18_62%,#0f1a12_100%)]">
      {/* ===== 场景层 ===== */}
      {/* 太阳光晕 */}
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0)_70%)]" />
      {/* 云朵（漂移动画） */}
      <div aria-hidden="true" className="absolute left-0 right-0 top-[130px] [animation:couple-cloud-drift_9s_ease-in-out_infinite_alternate]">
        <span className="absolute left-[6%] h-7 w-24 rounded-full bg-white/90 dark:bg-zinc-800/92 blur-[1px]" />
        <span className="absolute left-[10%] top-4 h-6 w-16 rounded-full bg-white/80 dark:bg-zinc-800/85 blur-[1px]" />
        <span className="absolute right-[16%] top-10 h-8 w-28 rounded-full bg-white/85 dark:bg-zinc-800/90 blur-[1px]" />
        <span className="absolute right-[22%] top-16 h-5 w-14 rounded-full bg-white/75 dark:bg-zinc-800/80 blur-[1px]" />
      </div>
      {/* 海鸥 */}
      <svg aria-hidden="true" viewBox="0 0 60 24" className="absolute left-[16%] top-[150px] w-9 opacity-80">
        <path d="M2 16 Q10 4 18 14 Q26 4 34 14" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 60 24" className="absolute right-[24%] top-[210px] w-6 opacity-60">
        <path d="M2 16 Q10 4 18 14 Q26 4 34 14" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {/* 远山 */}
      <span aria-hidden="true" className="absolute -left-16 top-[46%] h-36 w-72 rounded-[50%] bg-[#cfe8c2]/80 blur-[2px]" />
      <span aria-hidden="true" className="absolute -right-20 top-[48%] h-40 w-80 rounded-[50%] bg-[#c4e2b8]/80 blur-[2px]" />
      <span aria-hidden="true" className="absolute left-1/4 top-[50%] h-28 w-64 rounded-[50%] bg-[#d8eed0]/70 blur-[2px]" />
      {/* 草地 */}
      <span aria-hidden="true" className="absolute -bottom-[26%] left-1/2 h-[62%] w-[150%] -translate-x-1/2 rounded-[50%] bg-[linear-gradient(180deg,#b5e07e,#98d15e_60%,#8cc654)] shadow-[inset_0_14px_28px_rgba(255,255,255,0.35)]" />
      <span aria-hidden="true" className="absolute -bottom-[30%] left-1/2 h-[58%] w-[120%] -translate-x-1/2 rounded-[50%] bg-[#a3d96c]/70 blur-[6px]" />
      {/* 草地小花 */}
      {[
        ['6%', '82%'], ['14%', '90%'], ['26%', '78%'], ['70%', '80%'], ['84%', '88%'], ['92%', '76%'], ['46%', '94%'],
      ].map(([l, t], i) => (
        <span key={i} aria-hidden="true" className="absolute select-none text-[10px]" style={{ left: l, top: t }}>
          {i % 2 === 0 ? '✿' : '❀'}
        </span>
      ))}
      {/* 右下角石头 LO */}
      <span aria-hidden="true" className="absolute bottom-[92px] right-3 flex h-9 w-12 rotate-6 items-center justify-center rounded-[45%_55%_50%_50%/55%_50%_50%_45%] bg-[linear-gradient(150deg,#e8e6df,#c9c6bd)] text-[10px] font-bold tracking-wider text-white shadow-[0_3px_8px_rgba(90,90,80,0.25)]">
        LO
      </span>

      {/* ===== 顶部：返回 + 悬挂木牌（整体避开状态栏 54px） ===== */}
      <div className="relative z-20 shrink-0">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[62px] z-30 flex h-10 w-10 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#ffd94d,#ffb62e)] text-white shadow-[0_4px_10px_rgba(220,150,30,0.45)] transition-transform active:scale-95"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={3} />
        </button>
        {/* 悬挂横杆 */}
        <div className="pt-[56px]">
          <span aria-hidden="true" className="mx-auto block h-2.5 w-[240px] rounded-b-md bg-[linear-gradient(180deg,#9c6b35,#7a4e22)] shadow-sm" />
        {/* 木牌主体 */}
        <div className="mx-auto mt-1 w-[236px]">
          <div className="relative rounded-xl border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#c99a55,#b07f3e)] px-3 py-2 shadow-[0_6px_14px_rgba(120,80,30,0.35)]">
            {/* 顶部绿果实 */}
            <span aria-hidden="true" className="absolute -top-2 right-9 h-4 w-4 rounded-full border-2 border-[#5f8f3a] bg-[radial-gradient(circle_at_35%_30%,#b9e877,#7cb84a)] shadow-sm" />
            <div className="flex items-center gap-2">
              {/* 等级星 */}
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                <span aria-hidden="true" className="absolute inset-0 bg-[#ffcf3e] [clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)] drop-shadow-[0_2px_2px_rgba(160,110,20,0.5)]" />
                <b className="relative text-[15px] font-extrabold text-[#7a5200]">{level}</b>
              </span>
              {/* 进度条 */}
              <div className="min-w-0 flex-1">
                <div className="relative h-4 overflow-hidden rounded-full border-2 border-[#7a4e22] bg-[#6e4520]">
                  <div className="h-full rounded-full bg-[linear-gradient(180deg,#ffe98a,#ffc93c)] transition-all duration-500" style={{ width: `${(inLevel / 20) * 100}%` }} />
                </div>
              </div>
              <span className="shrink-0 text-[12px] font-bold text-white drop-shadow-[0_1px_1px_rgba(90,60,20,0.6)]">{inLevel}/20</span>
            </div>
          </div>
          {/* 连续浇树小木牌 */}
          <div className="relative mx-auto -mt-1 w-[196px] rounded-lg border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#bd8d4a,#a5763a)] px-3 py-1.5 shadow-[0_5px_12px_rgba(120,80,30,0.3)]">
            <div className="text-[12.5px] font-bold leading-relaxed text-[#5f3d18]">
              他连续浇树 <b className="mx-1 text-[14px]">{taTreeStreak}</b> 天
            </div>
            <div className="text-[12.5px] font-bold leading-relaxed text-[#5f3d18]">
              我连续浇树 <b className="mx-1 text-[14px]">{streak}</b> 天
            </div>
          </div>
          {/* 断签提醒 */}
          {brokeStreak && (
            <button
              type="button"
              onClick={() => showToast('昨天忘浇水啦，今天补上还不断签！')}
              className="absolute -bottom-14 right-0 flex h-12 w-12 rotate-3 flex-col items-center justify-center rounded-xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl shadow-[0_4px_12px_rgba(0,0,0,0.18)] [animation:couple-float-y_2.4s_ease-in-out_infinite]"
            >
              <span className="text-[8.5px] font-bold leading-none text-[#e0483a]">断签</span>
              <span className="mt-0.5 text-[10px] font-extrabold leading-none text-[#333] dark:text-zinc-100">昨天</span>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#e0483a] text-[9px] font-bold text-white">✕</span>
            </button>
          )}
        </div>
        </div>
      </div>

      {/* TA 也浇过水提示（第九轮：AI 主动照顾小树） */}
      {taWateredToday && (
        <div className="absolute left-1/2 top-[122px] z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 dark:bg-zinc-800/92 px-3.5 py-1.5 text-[11.5px] font-semibold text-[#3f7d4e] shadow-[0_3px_10px_rgba(60,120,70,0.2)] backdrop-blur-sm">
          💧 TA 今天也给小树浇了水
        </div>
      )}

      {/* ===== 中部：许愿树 + 挂卡 ===== */}
      <div className="relative z-10 flex-1">
        {/* 许愿树（SVG 成长树 + 树冠挂卡 + 泥土堆） */}
        <div className="absolute bottom-[104px] left-1/2 -translate-x-1/2">
          <div className="relative h-[290px] w-[330px]">
            {/* 树本体 */}
            <span key={pop} className="absolute bottom-0 left-1/2 -translate-x-1/2 block h-[252px] w-[210px] [animation:couple-pop-heart_.5s_ease-out]">
              <LoveTree stage={stage} />
            </span>
            {/* 泥土堆 */}
            <span aria-hidden="true" className="absolute bottom-[-6px] left-1/2 h-6 w-[92px] -translate-x-1/2 rounded-[50%] bg-[linear-gradient(180deg,#9a6b3d,#7c5227)] shadow-[0_4px_10px_rgba(80,50,20,0.35)]" />
            {/* 挂卡（最新 visibleN 张；点开看正文+留言；小树时卡片挂低、繁茂大树挂高） */}
            {cards.slice(0, visibleN).map((c, i) => {
              const slot = TREE_CARD_SLOTS[i % TREE_CARD_SLOTS.length];
              const sag = (4 - stage) * 5; // 成长值低 → 卡片挂得低（贴着树苗）；满级挂进树冠
              return <TreeCardChip key={c.id} card={c} x={slot.x} y={slot.y + sag} r={slot.r} onClick={() => setOpenId(c.id)} />;
            })}
            {/* 空树提示 */}
            {cards.length === 0 && (
              <div className="absolute left-1/2 top-[6%] z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 dark:bg-zinc-800/92 px-3.5 py-1.5 text-[11.5px] font-semibold text-[#8c4257] shadow-[0_3px_10px_rgba(140,66,87,0.18)] backdrop-blur-sm [animation:couple-float-y_2.6s_ease-in-out_infinite]">
                树上还空着——挂一张卡片，许个愿吧 ♡
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 底部操作栏：浇水 / 挂许愿卡 / 全部卡片 ===== */}
      <div className="relative z-20 flex shrink-0 items-center justify-center gap-5 px-6 pb-[34px] pt-2">
        {/* 水滴浇水按钮 */}
        <button
          type="button"
          onClick={() => {
            waterTree();
            setPop((p) => p + 1);
          }}
          disabled={tree >= 100}
          aria-label="给许愿树浇水"
          className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full bg-white/95 dark:bg-zinc-800/95 shadow-[0_5px_16px_rgba(90,130,60,0.3)] transition-transform active:scale-[0.94] disabled:opacity-60 [animation:couple-float-y_2.6s_ease-in-out_infinite]"
        >
          <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden="true">
            <path d="M12 2.6 C12 2.6 5.2 10.4 5.2 15 A6.8 6.8 0 0 0 18.8 15 C18.8 10.4 12 2.6 12 2.6 Z" fill="url(#dropg)" stroke="#4f9bd2" strokeWidth="1.2" />
            <defs>
              <linearGradient id="dropg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#b5e3fa" />
                <stop offset="1" stopColor="#6cb7e8" />
              </linearGradient>
            </defs>
            <path d="M8.8 15.2 A3.2 3.2 0 0 0 10.8 18" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <circle cx="9.4" cy="12.4" r="0.9" fill="#ffffff" opacity="0.9" />
          </svg>
        </button>
        {/* 挂许愿卡（主按钮） */}
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="挂一张许愿卡"
          className="flex h-[52px] shrink-0 items-center gap-1.5 rounded-full border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#ffd94d,#ffb62e)] px-6 text-[15px] font-extrabold text-[#5f3d18] shadow-[0_6px_16px_rgba(220,150,30,0.5)] transition-transform active:scale-95"
        >
          <Plus className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
          挂许愿卡
        </button>
        {/* 全部卡片 */}
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-label="查看全部留言卡"
          className="relative flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center rounded-2xl border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#c99a55,#b07f3e)] text-white shadow-[0_5px_14px_rgba(120,80,30,0.4)] transition-transform active:scale-95"
        >
          <MessageSquare className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
          <span className="mt-[3px] text-[9px] font-bold leading-none">{cards.length} 张卡</span>
        </button>
      </div>

      {/* ===== 挂卡弹层 ===== */}
      {composing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label="挂一张许愿卡">
          <button type="button" aria-label="取消" onClick={() => setComposing(false)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-[320px] rounded-2xl bg-white p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] dark:bg-zinc-900">
            <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">挂一张许愿卡</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              写一句想对{state.taName || 'TA'}说的话，挂在你们的许愿树上——TA 会看到这张卡片，也会知道你写了什么。
            </p>
            <div className="mt-3 rounded-2xl border-2 border-[#f2b3c5] bg-[linear-gradient(180deg,#fff1f5,#ffdbe6)] px-4 py-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 60))}
                rows={3}
                placeholder="如：希望明年的今天，我们还一起站在这棵树下。"
                className="w-full resize-none bg-transparent text-[15px] font-semibold leading-[1.7] text-[#8c4257] outline-none placeholder:font-normal placeholder:text-[#d49aab]"
                aria-label="许愿卡内容"
              />
              <p className="mt-1 text-right text-[11px] font-bold text-[#c76e8b]">{draft.length}/60</p>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded-full px-4 py-2 text-[13.5px] font-bold text-zinc-500 active:opacity-60 dark:text-zinc-400"
              >
                先不挂了
              </button>
              <button
                type="button"
                onClick={hangCard}
                disabled={!draft.trim()}
                className="rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] px-5 py-2 text-[13.5px] font-bold text-white shadow-[0_4px_12px_rgba(242,83,106,0.35)] transition-transform active:scale-95 disabled:opacity-40"
              >
                挂上许愿树 ♡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 卡片详情弹层（正文 + 卡片下留言） ===== */}
      {openCard && (
        <TreeCardDetail
          card={openCard}
          meName={state.meName}
          taName={state.taName}
          onClose={() => setOpenId(null)}
          onSend={(t) => commentCard(openCard.id, t)}
        />
      )}

      {/* ===== 全部卡片列表弹层 ===== */}
      {listOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="全部留言卡">
          <button type="button" aria-label="关闭" onClick={() => setListOpen(false)} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
          <div className="absolute inset-x-0 bottom-0 max-h-[68%] overflow-y-auto rounded-t-2xl bg-white px-4 pb-[26px] pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.3)] dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-50">全部留言卡 · {cards.length} 张</p>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                aria-label="收起列表"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 active:opacity-60 dark:bg-zinc-800 dark:text-zinc-400"
              >
                <ChevronDown className="h-5 w-5" strokeWidth={2.4} />
              </button>
            </div>
            {cards.length === 0 && <p className="py-8 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">树上还没有卡片</p>}
            <div className="flex flex-col gap-2 pb-2">
              {cards.map((c) => {
                const mine = c.from === 'me';
                const who = mine ? state.meName || '我' : state.taName || 'TA';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setListOpen(false);
                      setOpenId(c.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 text-left transition-transform active:scale-[0.98]"
                    style={
                      mine
                        ? { borderColor: '#f6cbda', background: 'linear-gradient(180deg,#fff5f8,#ffe9f0)' }
                        : { borderColor: '#ecd58a', background: 'linear-gradient(180deg,#fffce8,#fff5c9)' }
                    }
                    aria-label={`查看${who}挂的卡片`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                        mine ? 'bg-[#ffdce7] text-[#8c4257]' : 'bg-[#ffefb9] text-[#7c5a17]'
                      }`}
                      aria-hidden="true"
                    >
                      {who.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold" style={{ color: mine ? '#8c4257' : '#7c5a17' }}>
                        {c.text}
                      </span>
                      <span className="mt-[1px] block text-[10.5px] font-semibold opacity-70" style={{ color: mine ? '#8c4257' : '#7c5a17' }}>
                        {who} 挂的 · {fmtDate(c.at)} · {(c.comments ?? []).length} 条留言
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-40" strokeWidth={2.4} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 情侣轨迹：真实地图（高德瓦片代理 + WGS84→GCJ02 纠偏 + 真实距离） ----------------

const GCJ_A = 6378245;
const GCJ_EE = 0.00669342162296594323;

function gcjTransformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function gcjTransformLng(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

/** WGS84 → GCJ02（高德瓦片按 GCJ02 索引，marker 必须纠偏后才能落在正确位置；境外点原样返回） */
function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng];
  let dLat = gcjTransformLat(lng - 105, lat - 35);
  let dLng = gcjTransformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

/** 球面距离 km（Haversine，WGS84 语义下的真实距离） */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 真实地图（情侣轨迹专用）：高德街道瓦片经 /api/map-tile 代理渲染，可拖动/滚轮/双指缩放；
 *  双方真实位置头像 marker + 相遇地点 📍 + 虚线连线与真实距离标签 */
function RealCoupleMap(props: {
  me: CouplePlace | null;
  ta: CouplePlace | null;
  meet: CouplePlace | null;
  meAvatar: string | null;
  taAvatar: string | null;
  meName: string;
  taName: string;
  fitSignal: number;
}) {
  const { me, ta, meet, meAvatar, taAvatar, meName, taName, fitSignal } = props;
  const holderRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lgRef = useRef<L.LayerGroup | null>(null);
  const viewKeyRef = useRef('');
  const dataRef = useRef(props);
  useEffect(() => {
    dataRef.current = props;
  });

  // 初始化（可拖动/缩放的真实地图）
  useEffect(() => {
    if (!holderRef.current || mapRef.current) return;
    const map = L.map(holderRef.current, {
      center: [36.2, 105.8],
      zoom: 4,
      minZoom: 3,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('/api/map-tile?z={z}&x={x}&y={y}', { minZoom: 3, maxZoom: 17 }).addTo(map);
    lgRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      lgRef.current = null;
      viewKeyRef.current = '';
    };
  }, []);

  // marker/连线/距离标签重绘（位置、头像、名字任一变化）
  useEffect(() => {
    const map = mapRef.current;
    const lg = lgRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    const gcjOf = (p: CouplePlace): [number, number] => wgs84ToGcj02(p.lat, p.lng);

    const avatarIcon = (avatar: string | null, name: string, tag: string) =>
      L.divIcon({
        className: '',
        iconSize: [40, 46],
        iconAnchor: [20, 40],
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:#fff;border:2.5px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,0.22)">${avatar ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover" draggable="false"/>` : ''}</div>
          <span style="max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.94);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;color:#6e6e76;box-shadow:0 2px 8px rgba(0,0,0,0.14)">${escHtml(name || '我')}·${tag}</span>
        </div>`,
      });

    const gMe = me ? gcjOf(me) : null;
    const gTa = ta ? gcjOf(ta) : null;

    if (gMe) L.marker(gMe, { icon: avatarIcon(meAvatar, meName, '我'), keyboard: false, zIndexOffset: 200 }).addTo(lg);
    if (gTa) L.marker(gTa, { icon: avatarIcon(taAvatar, taName, 'TA'), keyboard: false, zIndexOffset: 200 }).addTo(lg);

    if (gMe && gTa && me && ta) {
      L.polyline([gMe, gTa], { color: '#b7bcc4', weight: 2, opacity: 0.9, dashArray: '2 7' }).addTo(lg);
      const km = haversineKm(me.lat, me.lng, ta.lat, ta.lng);
      const mid: [number, number] = [(gMe[0] + gTa[0]) / 2, (gMe[1] + gTa[1]) / 2];
      L.marker(mid, {
        keyboard: false,
        icon: L.divIcon({
          className: '',
          iconSize: [10, 10],
          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:rgba(255,255,255,0.95);color:#6e6e76;font-size:11px;font-weight:600;padding:3px 11px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,0.14);border:1px solid rgba(0,0,0,0.04)">相距 ${fmtKm(km)}</div>`,
        }),
      }).addTo(lg);
    }

    if (meet) {
      L.marker(gcjOf(meet), {
        keyboard: false,
        zIndexOffset: 400,
        icon: L.divIcon({
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          html: `<div style="display:flex;flex-direction:column;align-items:center">
            <div style="font-size:26px;line-height:1;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3))">📍</div>
            <span style="margin-top:1px;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.96);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;color:#3a3a40;box-shadow:0 2px 8px rgba(0,0,0,0.2)">相遇·${escHtml(meet.name)}</span>
          </div>`,
        }),
      }).addTo(lg);
    }

    // 视角自适应：坐标集合变化才移动（拖动/缩放不被打扰）
    const key = `${gMe?.join(',') ?? '-'}#${gTa?.join(',') ?? '-'}#${meet ? gcjOf(meet).join(',') : '-'}`;
    if (key !== viewKeyRef.current) {
      viewKeyRef.current = key;
      const pts = [gMe, gTa].filter(Boolean) as [number, number][];
      if (pts.length === 2) map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: true, maxZoom: 13 });
      else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9), { animate: true });
      else if (meet) map.setView(gcjOf(meet), Math.max(map.getZoom(), 10), { animate: true });
    }
  }, [me, ta, meet, meAvatar, taAvatar, meName, taName]);

  // 十字准星：回到两人中间（或单点/相遇地）
  useEffect(() => {
    if (!fitSignal) return;
    const map = mapRef.current;
    if (!map) return;
    const { me: m, ta: t, meet: mt } = dataRef.current;
    const pts = [m, t].filter(Boolean).map((p) => wgs84ToGcj02(p!.lat, p!.lng)) as [number, number][];
    if (pts.length === 2) map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: true, maxZoom: 13 });
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9), { animate: true });
    else if (mt) map.setView(wgs84ToGcj02(mt.lat, mt.lng), Math.max(map.getZoom(), 10), { animate: true });
  }, [fitSignal]);

  return (
    <div className="absolute inset-0 z-0 csp-map">
      {/* 简约风滤镜：地图瓦片降饱和/提亮（第十八轮美化，不影响头像 marker） */}
      <style dangerouslySetInnerHTML={{ __html: '.csp-map .leaflet-tile-pane{filter:saturate(0.7) brightness(1.045) contrast(0.94)}' }} />
      <div ref={holderRef} className="h-full w-full" style={{ background: '#eef0f2' }} />
    </div>
  );
}

/** 位置搜索行（轨迹设置弹层用）：/api/geocode 搜索 → 点选写入真实位置 */
function PlaceSearchRow({ label, current, onPick, onClear, showToast }: { label: string; current: CouplePlace | null; onPick: (p: CouplePlace) => void; onClear: () => void; showToast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ name: string; lat: number; lng: number; label: string }[] | null>(null);

  const doSearch = async () => {
    const t = q.trim();
    if (!t || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(t)}`);
      const d = (await r.json()) as { results?: { name: string; lat: number; lng: number; label: string }[] };
      const list = Array.isArray(d?.results) ? d.results : [];
      setResults(list);
      if (list.length === 0) showToast('没找到这个地方，换个说法试试');
    } catch {
      showToast('搜索失败，稍后再试');
    }
    setLoading(false);
  };

  return (
    <div className="mt-3 rounded-2xl bg-[#f7f7f9] dark:bg-zinc-900/70 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#4a4a52] dark:text-zinc-200">{label}</span>
        {current ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              setResults(null);
            }}
            className="flex max-w-[70%] items-center gap-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-2.5 py-1 text-[11.5px] text-[#6e6e76] dark:text-zinc-300 shadow-sm"
          >
            <MapPin className="h-3 w-3 shrink-0 text-[#8e8e96] dark:text-zinc-400" />
            <span className="truncate">{current.name}</span>
            <span className="shrink-0 text-[#b6b6bd] dark:text-zinc-500">✕</span>
          </button>
        ) : (
          <span className="text-[11.5px] text-[#b6b6bd] dark:text-zinc-500">未设置</span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSearch();
          }}
          placeholder="搜索城市或地址，如「上海」"
          maxLength={30}
          className="h-10 flex-1 rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3.5 text-[14px] shadow-sm outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={() => void doSearch()}
          className="flex h-10 w-[64px] items-center justify-center rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
        </button>
      </div>
      {results != null && results.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl p-1 shadow-sm">
          {results.map((it, i) => (
            <button
              key={`${it.name}-${i}`}
              type="button"
              onClick={() => {
                onPick({ name: it.name, lat: it.lat, lng: it.lng });
                setResults(null);
                setQ('');
              }}
              className="block w-full rounded-lg px-3 py-2 text-left active:bg-[#f3f3f5] dark:active:bg-zinc-900/70"
            >
              <span className="block text-[13.5px] text-[#2c2c30] dark:text-zinc-100">{it.name}</span>
              {it.label !== it.name && <span className="block truncate text-[11px] text-[#9a9aa2] dark:text-zinc-400">{it.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 位置与轨迹·记录类型图标/颜色（第二十一轮，参考截图：按类型区分，lucide 图标零 emoji） */
const TRAIL_FEED_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  unlock: { icon: <Moon className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#8b7cf0' },
  screen: { icon: <Smartphone className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#3c3c44' },
  app: { icon: <Eye className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#26262b' },
  call: { icon: <PhoneCall className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#34a853' },
  chargeOn: { icon: <BatteryCharging className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#e05a6d' },
  chargeOff: { icon: <BatteryCharging className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#21b357' },
  leave: { icon: <Footprints className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#58b368' },
  arrive: { icon: <MapPin className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#f0a125' },
  offcar: { icon: <CarFront className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#34a853' },
  walkplay: { icon: <PersonStanding className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#f08c3a' },
  stay: { icon: <MapPinned className="h-[18px] w-[18px]" strokeWidth={2} />, color: '#7a8aa0' },
};
const TRAIL_KIND_LABEL: Record<string, string> = {
  unlock: '手机解锁',
  screen: '屏幕使用',
  app: 'App 使用',
  call: '接打电话',
  chargeOn: '开始充电',
  chargeOff: '充电完成',
  leave: '离开某地',
  arrive: '到达某地',
  offcar: '下车',
  walkplay: '边走边玩',
  stay: '地点停留',
};

/** 情侣轨迹（第十八轮美化）：简约地图 + 顶部信息卡可隐藏 + 「位置与轨迹」独立界面（第二十一轮重做：聊天式时间线记录 + 查看记录详情 + 底部聊天） */
function TrackPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [trailPage, setTrailPage] = useState(false); // 「位置与轨迹」独立界面（第十八轮：不再是弹层）
  const [fitSignal, setFitSignal] = useState(0);
  const infoHid = state.trackInfoHid === true; // 顶部头像/距离悬浮卡已隐藏（用户要求可隐藏消失）

  // 第十轮：①位置跟随联系人 APP（TA/机主联系人的「地区」变化时重新 geocode 同步）
  // ②TA 今日行踪（人设记忆生成：今天去了哪里/什么位置/什么店铺，灰色字展示，每日一次）
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    void (async () => {
      try {
        const msgs = await syncLocFromContacts();
        if (msgs.length > 0) showToast(msgs[0]);
      } catch {
        /* 静默 */
      }
      try {
        aiTickTrail();
      } catch {
        /* 静默 */
      }
    })();
  }, [showToast]);

  // 真实距离：双方都设置了真实位置才有
  const distKm = state.myLoc && state.taLoc ? haversineKm(state.myLoc.lat, state.myLoc.lng, state.taLoc.lat, state.taLoc.lng) : null;

  const toolBtn = 'flex h-8 w-8 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#6e6e76] dark:text-zinc-300 shadow-[0_3px_10px_rgba(0,0,0,0.10)] transition-opacity active:opacity-60';

  // —— 位置与轨迹独立界面：聊天区（写进 AI 记忆） ——
  const [trailDraft, setTrailDraft] = useState('');
  const trailMsgs = useMemo(() => state.comments.filter((c) => c.key === 'trail').sort((a, b) => a.at - b.at), [state.comments]);
  /** 「对方正在输入…」：我发过后 12s 内且 TA 还没回出更新的消息 */
  const lastTrail = trailMsgs[trailMsgs.length - 1];
  const trailTyping =
    (state.trailChatsAt ?? 0) > 0 &&
    Date.now() - (state.trailChatsAt ?? 0) < 12000 &&
    !(lastTrail && lastTrail.from === 'ta' && lastTrail.at > (state.trailChatsAt ?? 0));
  const sendTrail = () => {
    const t = trailDraft.trim();
    if (!t) return;
    const c: { id: string; key: string; from: 'me' | 'ta'; text: string; at: number } = { id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: 'trail', from: 'me', text: t, at: Date.now() };
    patch({ comments: [...state.comments, c], trailChatsAt: Date.now() });
    setTrailDraft('');
    scheduleAiReply('trail'); // TA 按人设记忆+上下文回复，并写进 AI 记忆（couple-ai 内部闭环）
    // 第二十六轮：发消息不再随手生成「刚刚」记录——记录是历史，永远排在用户消息上面（TA 回完话后 AI 会按他说的话生成呼应记录）
  };

  // —— 第二十一轮：位置与轨迹时间线（AI 按人设+记忆+真实时间生成；进入页面自动生成今天/昨天，可一直往更早生成） ——
  const [trailDetail, setTrailDetail] = useState<CoupleTrailRec | null>(null);
  const trailEarlyRef = useRef(2); // 更早生成起点（今天+昨天已自动生成）
  const trailFeedInitRef = useRef(false);
  const trailScrollRef = useRef<HTMLDivElement | null>(null);
  const trailJumpRef = useRef(true); // 打开页面时强制滚到底；之后只有贴底时才跟随
  // 第二十五轮：渐进揭示时钟——每 0.8s 驱动一次重渲染，让记录跟着 revealAt 一条条出现
  const [feedTick, setFeedTick] = useState(0);
  useEffect(() => {
    if (!trailPage) return;
    const t = window.setInterval(() => setFeedTick((v) => v + 1), 800);
    return () => window.clearInterval(t);
  }, [trailPage]);
  const trailFeedRecs = useMemo(() => {
    void feedTick; //揭示时钟驱动
    const nowMs = Date.now();
    // 第二十六轮：未到揭示时间的先隐藏；排序时间晚于当前真实时间的记录（含设备时钟被回拨的场景）绝不展示；
    // 且某天用户发过轨迹消息后，那天的记录只保留第一条消息之前的——记录是「历史」，永远排在用户消息上面
    const firstMsgByDay = new Map<string, number>();
    for (const m of trailMsgs) {
      if (m.from === 'ta') continue;
      const d = new Date(m.at);
      const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const cur = firstMsgByDay.get(dk);
      if (cur == null || m.at < cur) firstMsgByDay.set(dk, m.at);
    }
    const recs = (state.trailFeed ?? []).filter((r) => {
      if ((r.revealAt ?? 0) > nowMs) return false;
      const sortMs = r.sortAt ?? trailSortMs(r.dateKey, r.t);
      if (Number.isFinite(sortMs) && sortMs > nowMs + 60000) return false;
      const first = firstMsgByDay.get(r.dateKey);
      if (first != null && Number.isFinite(sortMs) && sortMs > first - 30000) return false;
      return true;
    });
    recs.sort((a, b) => (a.dateKey === b.dateKey ? a.t.localeCompare(b.t) : a.dateKey < b.dateKey ? -1 : 1)); // 升序（老→新，像聊天一样从上往下）
    return recs;
  }, [state.trailFeed, trailMsgs, feedTick]);
  useEffect(() => {
    if (!trailPage || trailFeedInitRef.current) return;
    trailFeedInitRef.current = true;
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    try {
      aiTrailFeed({ mode: 'day', dateKey: key(now), daysAgo: 0 });
      aiTrailFeed({ mode: 'day', dateKey: key(new Date(now.getTime() - 86400000)), daysAgo: 1 });
    } catch {
      /* 静默 */
    }
  }, [trailPage]);

  // 第二十二轮：记录与聊天消息交织成一条时间线（Lookus 风格，老→新，自动滚到底部）
  type TrailLine =
    | { kind: 'day'; key: string; label: string }
    | { kind: 'rec'; key: string; rec: CoupleTrailRec }
    | { kind: 'msg'; key: string; msg: { id: string; from: 'me' | 'ta'; text: string; at: number } };
  const trailLines = useMemo<TrailLine[]>(() => {
    const items: { sort: number; line: TrailLine }[] = [];
    for (const r of trailFeedRecs) {
      // 第二十五轮：优先用落库时的排序时间戳（「刚刚」记录=真实落库时刻，一定排在我刚发的消息后面）；
      // 旧数据/普通记录用解析后的时刻，解析失败兜底用生成时间（绝不再落到最顶上）
      const parsed = trailSortMs(r.dateKey, r.t);
      const ts = r.sortAt ?? (Number.isNaN(parsed) ? r.at : parsed);
      items.push({ sort: ts, line: { kind: 'rec', key: r.id, rec: r } });
    }
    for (const m of trailMsgs) items.push({ sort: m.at, line: { kind: 'msg', key: m.id, msg: m } });
    items.sort((a, b) => a.sort - b.sort);
    const out: TrailLine[] = [];
    let lastDay = '';
    for (const it of items) {
      const d = new Date(it.sort);
      const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (dk !== lastDay) {
        lastDay = dk;
        out.push({ kind: 'day', key: `day-${dk}`, label: fmtDateCn(dk) });
      }
      out.push(it.line);
    }
    return out;
  }, [trailFeedRecs, trailMsgs]);
  useEffect(() => {
    if (!trailPage) return;
    const el = trailScrollRef.current;
    if (!el) return;
    if (trailJumpRef.current) {
      el.scrollTop = el.scrollHeight; // 打开页面时强制到底部
      trailJumpRef.current = false;
      return;
    }
    // 第二十五轮：新记录/新消息出现时，只有用户贴着底部才跟随滚动（正在翻历史时不打扰）
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [trailPage, trailLines.length]);
  /** 顶栏状态行：使用中 + 电量（取最近一条充电记录的百分比，没有则 70）+ 移动网络 */
  const trailBattery = useMemo(() => {
    let v = 70;
    for (const r of trailFeedRecs) {
      if (r.kind === 'chargeOn' || r.kind === 'chargeOff') {
        const m = r.text.match(/(\d+)%/);
        if (m) v = Number(m[1]);
      }
    }
    return v;
  }, [trailFeedRecs]);

  return (
    <div className="relative flex h-full flex-col">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#f6f6f8]/92 dark:bg-zinc-900/92 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={close} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold">情侣轨迹</div>
        </div>
      </div>

      {/* 全屏真实地图（可拖动/缩放） */}
      <div className="relative flex-1 overflow-hidden">
        <RealCoupleMap
          me={state.myLoc}
          ta={state.taLoc}
          meet={state.meetLoc}
          meAvatar={state.meAvatar}
          taAvatar={state.taAvatar}
          meName={state.meName}
          taName={state.taName}
          fitSignal={fitSignal}
        />
        {/* 柔光遮罩，让悬浮卡更突出 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.55),transparent)] dark:bg-[linear-gradient(180deg,rgba(10,16,20,0.55),transparent)]" />

        {/* 顶部悬浮卡：双头像 + 心形天数 + 真实距离（可隐藏消失；隐藏后右上角留小圆钮展开） */}
        {!infoHid ? (
        <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white/88 dark:bg-zinc-800/90 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur-md">
          <button
            type="button"
            onClick={() => patch({ trackInfoHid: true })}
            aria-label="隐藏信息卡"
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/85 text-[#9a9aa2] dark:text-zinc-400 shadow-sm transition-opacity active:opacity-50"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-start justify-between">
            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96] dark:text-zinc-400">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.myLoc?.name || (state.meetPlace ? '' : '设置我的位置')}</span>
              </span>
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-[#ececef] dark:bg-zinc-900/80 shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_4px_12px_rgba(0,0,0,0.12)]">
                {state.meAvatar ? <img src={state.meAvatar} alt={state.meName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
              </div>
              <span className="max-w-full truncate text-[10px] text-[#6e6e76] dark:text-zinc-300">{state.meName || '我'}</span>
            </div>

            <div className="flex flex-1 flex-col items-center px-1">
              <div className="relative flex h-[70px] w-[76px] items-center justify-center">
                <Heart className="absolute h-[70px] w-[70px] text-[#e9e9ee] dark:text-zinc-600" fill="#eceff2" strokeWidth={1.2} />
                <div className="relative -mt-1 text-center">
                  <div className="text-[9px] leading-none text-[#8e8e96] dark:text-zinc-400">在一起</div>
                  <div className="text-[17px] font-extrabold leading-tight text-[#4a4a52] dark:text-zinc-200">{days ?? '--'}</div>
                  <div className="text-[8px] leading-none tracking-[2px] text-[#a9a9b2] dark:text-zinc-400">DAY</div>
                </div>
              </div>
              <div className="relative mt-0.5 h-5 w-full">
                <svg viewBox="0 0 200 20" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <path d="M8 10 C 50 -4, 150 24, 192 10" fill="none" stroke="#c7c7ce" strokeWidth="2.2" strokeDasharray="5 5" strokeLinecap="round" />
                </svg>
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-2.5 py-[3px] text-[10px] text-[#6e6e76] dark:text-zinc-300 shadow-sm ring-1 ring-[#e9e9ee] dark:ring-white/10">
                  {distKm != null
                    ? `相距 ${fmtKm(distKm)}`
                    : state.myLoc || state.taLoc
                      ? '等 TA 也设置真实位置'
                      : days != null
                        ? '去 ⚙ 设置你们的真实位置'
                        : '设置纪念日开启轨迹'}
                </span>
              </div>
            </div>

            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96] dark:text-zinc-400">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.taLoc?.name || (state.meetPlace ? '' : '设置TA的位置')}</span>
              </span>
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-[#ececef] dark:bg-zinc-900/80 shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_4px_12px_rgba(0,0,0,0.12)]">
                {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
              </div>
              <span className="max-w-full truncate text-[10px] text-[#6e6e76] dark:text-zinc-300">{state.taName || 'TA'}</span>
            </div>
          </div>
        </div>
        ) : (
          <button
            type="button"
            onClick={() => patch({ trackInfoHid: false })}
            aria-label="展开信息卡"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 dark:bg-zinc-800/92 text-[#6e6e76] dark:text-zinc-300 shadow-[0_4px_14px_rgba(0,0,0,0.12)] backdrop-blur-md transition-opacity active:opacity-60"
          >
            <Eye className="h-4 w-4" />
          </button>
        )}

        {/* 右侧工具按钮（装饰 + 设置 + 回到两人中间） */}
        <div className="absolute bottom-5 right-3 z-10 flex flex-col gap-2">
          <span className={`${toolBtn} text-[#c9a24b]`}>
            <Crown className="h-4 w-4" />
          </span>
          <span className={toolBtn}>
            <HelpCircle className="h-4 w-4" />
          </span>
          <button type="button" onClick={() => setSheet(true)} aria-label="轨迹设置" className={toolBtn}>
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setFitSignal((s) => s + 1)} aria-label="回到两人中间" className={toolBtn}>
            <Crosshair className="h-4 w-4" />
          </button>
        </div>

        {/* 底部按钮：打开「位置与轨迹」独立界面（第十八轮：不再是弹层） */}
        <button
          type="button"
          onClick={() => {
            setTrailPage(true);
            try {
              aiTickTrail(); // 打开即保底生成当天动态（内部每日去重）
            } catch {
              /* 静默 */
            }
          }}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-6 py-2.5 text-[14px] font-semibold text-[#26262b] dark:text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-transform active:scale-[0.97]"
        >
          <MapPin className="h-4 w-4" fill="rgba(40,40,46,0.12)" />
          位置与轨迹
        </button>

        <span className="pointer-events-none absolute bottom-1.5 right-2 z-10 text-[9px] text-[#8a8f95] dark:text-zinc-400">恋人地图 · 真实位置</span>
      </div>

      {/* 位置与轨迹（第二十二轮 Lookus 风格：顶栏名字+使用状态行；记录与聊天消息交织成一条时间线——白底记录条/绿白头像气泡直接在背景上，无白色圆角大面板；发信息期间也会继续生成记录） */}
      {trailPage && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#f6f6f8] dark:bg-zinc-900">
          {/* 顶栏：返回 + 对方名字/使用状态 + 刷新（生成一条刚刚的记录） */}
          <div className="shrink-0 bg-[#f6f6f8]/95 dark:bg-zinc-900/95 pt-[54px] backdrop-blur-md">
            <div className="relative flex h-12 items-center px-1.5">
              <button type="button" onClick={() => setTrailPage(false)} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50">
                <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
              </button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                <div className="text-[16px] font-bold text-[#26262b] dark:text-zinc-100">{state.taName || 'TA'}</div>
                <div className="mt-0.5 flex items-center gap-2.5 text-[10.5px] text-[#8e8e96] dark:text-zinc-400">
                  <span className="flex items-center gap-0.5">
                    <Smartphone className="h-3 w-3 text-[#4aa3e8]" />
                    使用中
                  </span>
                  <span className="flex items-center gap-0.5">
                    <BatteryCharging className="h-3 w-3 text-[#3dcc7e]" />
                    {trailBattery}%
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Signal className="h-3 w-3 text-[#3dcc7e]" />
                    移动网络
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  aiTrailFeed({ mode: 'now' });
                  showToast('正在更新最新动态…');
                }}
                aria-label="刷新动态"
                data-testid="trail-refresh"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50"
              >
                <RefreshCcw className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* 滚动内容：记录 + 聊天交织时间线（老→新，自动滚到底；无白色面板，记录条/气泡直接在背景上） */}
          <div ref={trailScrollRef} className="flex-1 overflow-y-auto px-3 pb-3" data-testid="trail-feed">
            {/* 更早的记录（一直往前生成，无限回溯；生成后也是一条条跟着出现） */}
            <button
              type="button"
              onClick={() => {
                const d = new Date(Date.now() - trailEarlyRef.current * 86400000);
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                aiTrailFeed({ mode: 'day', dateKey: key, daysAgo: trailEarlyRef.current });
                trailEarlyRef.current += 1;
                showToast('正在生成更早的记录…');
              }}
              className="mx-auto mt-2 block rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-5 py-1.5 text-[11.5px] text-[#8e8e96] dark:text-zinc-400 shadow-[0_1px_4px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.04] dark:ring-white/10"
              data-testid="trail-earlier"
            >
              查看更早的记录
            </button>
            {trailLines.length === 0 && <div className="py-10 text-center text-[12.5px] text-[#b6b6bd] dark:text-zinc-500">正在生成你们的位置与轨迹记录…</div>}
            {trailLines.map((ln) => {
              if (ln.kind === 'day') {
                return (
                  <div key={ln.key} className="py-3 text-center">
                    <span className="rounded-full bg-white/90 dark:bg-zinc-800/92 px-3 py-1 text-[11px] text-[#8e8e96] dark:text-zinc-400 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">{ln.label}</span>
                  </div>
                );
              }
              if (ln.kind === 'rec') {
                const meta = TRAIL_FEED_ICON[ln.rec.kind] ?? TRAIL_FEED_ICON.stay;
                return (
                  <div key={ln.key} className="pb-3.5">
                    <div className="text-center text-[11px] font-semibold tabular-nums text-[#a8a8b2] dark:text-zinc-400">{ln.rec.dateKey.slice(5)} {ln.rec.t}</div>
                    {/* 第二十七轮：白色圆角面板再次删除——记录直接落在背景上（居中时间 + 图标 + 文案 + 查看记录），像系统时间线 */}
                    <div className="mx-auto mt-2 flex w-fit max-w-[88%] items-start justify-center gap-1.5">
                      <span className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center" style={{ color: meta.color }}>
                        {meta.icon}
                      </span>
                      <p className="min-w-0 text-center text-[13px] leading-snug text-[#4a4a52] dark:text-zinc-200">
                        {ln.rec.text}
                        <button type="button" onClick={() => setTrailDetail(ln.rec)} data-testid={`trail-view-${ln.rec.id}`} className="ml-1.5 inline-block whitespace-nowrap font-semibold text-[#26262b] dark:text-zinc-100 underline decoration-black/15 underline-offset-[3px]">
                          查看记录
                        </button>
                      </p>
                    </div>
                  </div>
                );
              }
              const mine = ln.msg.from === 'me';
              return (
                <div key={ln.key} className={`mb-2.5 flex items-start gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  {!mine &&
                    (state.taAvatar ? (
                      <img src={state.taAvatar} alt={state.taName || 'TA'} className="h-8 w-8 shrink-0 rounded-full object-cover" draggable={false} />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef1f5] text-[11px] font-bold text-[#8a97a8] dark:text-zinc-400">{(state.taName || 'TA').slice(0, 1)}</span>
                    ))}
                  <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${mine ? 'rounded-br-md bg-[#ececf1] dark:bg-zinc-900/80 text-[#2c2c30] dark:text-zinc-100' : 'rounded-bl-md bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[#2c2c30] dark:text-zinc-100 shadow-[0_1px_4px_rgba(0,0,0,0.05)]'}`}>{ln.msg.text}</div>
                  {mine &&
                    (state.meAvatar ? (
                      <img src={state.meAvatar} alt={state.meName || '我'} className="h-8 w-8 shrink-0 rounded-full object-cover" draggable={false} />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ececf1] dark:bg-zinc-900/80 text-[11px] font-bold text-[#6e6e76] dark:text-zinc-300">{(state.meName || '我').slice(0, 1)}</span>
                    ))}
                </div>
              );
            })}
            {trailTyping && (
              <div className="mb-2 flex items-start gap-2">
                {state.taAvatar ? (
                  <img src={state.taAvatar} alt={state.taName || 'TA'} className="h-8 w-8 shrink-0 rounded-full object-cover" draggable={false} />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef1f5] text-[11px] font-bold text-[#8a97a8] dark:text-zinc-400">{(state.taName || 'TA').slice(0, 1)}</span>
                )}
                <div className="rounded-2xl rounded-bl-md bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3.5 py-2 text-[12.5px] text-[#9a9aa2] dark:text-zinc-400 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">正在输入…</div>
              </div>
            )}
          </div>

          {/* 底部输入框（固定在页面底部，像聊天一样随时发消息） */}
          <div className="shrink-0 border-t border-[#ececef] dark:border-white/10 bg-[#f6f6f8]/95 dark:bg-zinc-900/95 px-3 pb-6 pt-2.5 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <input
                value={trailDraft}
                onChange={(e) => setTrailDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendTrail();
                }}
                placeholder={`和${state.taName || 'TA'}聊聊今天的行程…`}
                maxLength={120}
                className="h-10 flex-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 text-[13.5px] shadow-[0_2px_8px_rgba(0,0,0,0.05)] outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
                data-testid="trail-input"
              />
              <button
                type="button"
                onClick={sendTrail}
                aria-label="发送"
                disabled={!trailDraft.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2c2c30] text-white shadow-[0_3px_10px_rgba(0,0,0,0.18)] transition-transform active:scale-95 disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
              </button>
            </div>
          </div>

          {/* 查看记录详情弹层 */}
          {trailDetail && (
            <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setTrailDetail(null)}>
              <div className="rounded-t-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-9 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()} data-testid="trail-detail-sheet">
                <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center" style={{ color: (TRAIL_FEED_ICON[trailDetail.kind] ?? TRAIL_FEED_ICON.stay).color }}>
                    {(TRAIL_FEED_ICON[trailDetail.kind] ?? TRAIL_FEED_ICON.stay).icon}
                  </span>
                  <span className="text-[12px] font-semibold text-[#8e8e96] dark:text-zinc-400">
                    {TRAIL_KIND_LABEL[trailDetail.kind] ?? '动态记录'} · {trailDetail.dateKey.slice(5)} {trailDetail.t}
                  </span>
                </div>
                <div className="mt-3 text-[17px] font-bold leading-relaxed text-[#26262b] dark:text-zinc-100">{trailDetail.text}</div>
                {trailDetail.detail ? (
                  <div className="mt-2 rounded-xl bg-[#f7f7f9] dark:bg-zinc-900/70 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">{trailDetail.detail}</div>
                ) : null}
                <div className="mt-3 text-center text-[10.5px] text-[#c9c9cf] dark:text-zinc-500">基于你们的人设、记忆和真实时间生成</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 甜蜜小问答（参考图3/4/5）：问题列表（粉色序号+圆点状态）→ 题目详情（双栏回答）→ 回答编辑；右下角 + 号自定义问题 */
function QuizHeartLine({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-2 ${className}`}>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,#f3b7c6)]" />
      <Heart className="h-3.5 w-3.5 text-[#f8a8bc]" fill="#f8a8bc" strokeWidth={0} />
      <span className="h-px flex-1 bg-[linear-gradient(90deg,#f3b7c6,transparent)]" />
    </div>
  );
}

function QuizPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
  const [view, setView] = useState<'list' | 'detail' | 'answer'>('list');
  const [cur, setCur] = useState(0);
  const [answer, setAnswer] = useState('');
  const [addSheet, setAddSheet] = useState(false);
  const [newQ, setNewQ] = useState('');

  const custom = state.quizCustom || [];
  const questions = useMemo(() => [...custom, ...QUIZ_POOL], [custom]);
  const latestByQ = useMemo(() => {
    const map: Record<string, { a: string; at: number }> = {};
    for (const r of state.quiz) if (!map[r.q] || map[r.q].at < r.at) map[r.q] = { a: r.a, at: r.at };
    return map;
  }, [state.quiz]);
  /** TA（AI）的回答（第九轮主动答 + 第十轮和我一起答，每题取最近一次） */
  const taByQ = useMemo(() => {
    const map: Record<string, { a: string; at: number; withMe?: boolean }> = {};
    for (const r of state.quizTa ?? []) if (!map[r.q] || map[r.q].at < r.at) map[r.q] = { a: r.a, at: r.at, withMe: r.withMe };
    return map;
  }, [state.quizTa]);

  const q = questions[cur] ?? '';
  const my = latestByQ[q];
  const isCustom = cur < custom.length;
  const me = state.meName || '我';
  const ta = state.taName || 'TA';

  const openDetail = (i: number) => {
    setCur(i);
    setView('detail');
  };
  const startAnswer = () => {
    setAnswer(my?.a ?? '');
    setView('answer');
  };
  const saveAnswer = () => {
    const text = answer.trim();
    if (!text) return;
    patch({ quiz: [{ id: uid(), q, a: text, at: Date.now() }, ...state.quiz.filter((r) => r.q !== q)] });
    // 第十轮：TA 和我一起作答（延时出现，呼应我的回答；即使 TA 答过也会重新呼应我的新答案；记忆写入在 aiAnswerWithMe 内）
    aiAnswerWithMe(q, text);
    showToast('回答已记录，TA 也在写 TA 的答案…');
    setView('detail');
  };
  const addCustom = () => {
    const t = newQ.trim();
    if (!t) return;
    patch({ quizCustom: [t, ...custom] });
    setNewQ('');
    setAddSheet(false);
    showToast('问题已添加 ♡');
    setCur(0);
    setView('detail');
  };
  const removeCustom = () => {
    patch({ quizCustom: custom.filter((x) => x !== q) });
    showToast('已删除该问题');
    setView('list');
  };

  /** 顶栏（列表/详情/回答共用）：back 行为随视图变化 */
  const TopBar = (
    <div className="relative flex h-12 shrink-0 items-center px-2">
      <button
        type="button"
        onClick={() => (view === 'list' ? close() : view === 'detail' ? setView('list') : setView('detail'))}
        aria-label="返回"
        className="flex h-9 items-center gap-0.5 rounded-full px-1.5 text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50"
      >
        <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        {view === 'detail' && <span className="text-[15px] font-medium">题目列表</span>}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-bold">甜蜜小问答</div>
    </div>
  );

  /** 题目头（详情/回答共用）：大标题 + 序号信息行 */
  const QuestionHead = (
    <>
      <div className="text-[21px] font-bold leading-snug text-[#26262b] dark:text-zinc-100">{q}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[14px]">
          <span className="text-[#9a9aa2] dark:text-zinc-400"># 第{cur + 1}个问题 </span>
          <span className="font-medium text-[#f78fb0]">在一起{days ?? 0}天</span>
        </div>
        <button
          type="button"
          onClick={() => showToast('小问答打印成册（演示）')}
          className="shrink-0 rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3 py-1.5 text-[12.5px] font-bold text-[#4a4a52] dark:text-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-transform active:scale-95"
        >
          小问答打印成册
        </button>
      </div>
      <QuizHeartLine className="mt-4" />
    </>
  );

  return (
    <div className="relative flex h-full flex-col bg-[#fdfafb] dark:bg-zinc-900">
      <div className="shrink-0 bg-[#fdfafb]/95 dark:bg-zinc-900/95 pt-[54px] backdrop-blur-md">{TopBar}</div>

      {/* ============ 列表视图（参考图3） ============ */}
      {view === 'list' && (
        <>
          <div className="flex shrink-0 items-center px-4 pb-1 pt-1">
            <button
              type="button"
              onClick={() => showToast('小问答打印成册（演示）')}
              className="rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl py-2 pl-5 pr-4 text-[14px] font-bold text-[#4a4a52] dark:text-zinc-200 shadow-[0_3px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-transform active:scale-95"
            >
              打印成册
            </button>
            <QuizHeartLine className="mx-3 flex-1" />
            <button
              type="button"
              onClick={() => showToast('每天一题，把答案留给未来的我们 ♡')}
              aria-label="说明"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#c9c9d0] dark:text-zinc-500 transition-opacity active:opacity-50"
            >
              <Info className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-28 pt-2">
            {questions.map((item, i) => {
              const answered = !!latestByQ[item];
              return (
                <button
                  key={`${item}-${i}`}
                  type="button"
                  onClick={() => openDetail(i)}
                  className="flex w-full items-center gap-3 border-b border-[#f5e7eb] dark:border-white/10 py-4 text-left transition-colors active:bg-[#fdf1f4] dark:active:bg-rose-300/10"
                >
                  <span className="w-9 shrink-0 text-[24px] font-light italic leading-none text-[#f5b8c6]" style={{ fontFamily: 'Georgia, serif' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 text-[16px] font-semibold leading-snug text-[#2c2c30] dark:text-zinc-100">{item}</span>
                  {isCustomIndex(i, custom.length) && (
                    <span className="shrink-0 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-bold text-[#6e6e76] dark:text-zinc-300">自定义</span>
                  )}
                  <span
                    aria-hidden="true"
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
                      answered ? 'border-transparent bg-[linear-gradient(135deg,#ffb9cb,#ff8fae)]' : 'border-[#f3b7c6] bg-transparent'
                    }`}
                  >
                    {answered && <Heart className="h-3 w-3 text-white" fill="#ffffff" strokeWidth={0} />}
                  </span>
                </button>
              );
            })}
            <div className="pt-5 text-center text-[12px] text-[#c9b6bc] dark:text-rose-200/55">— 每天一问 · 把甜蜜记下来 —</div>
          </div>
        </>
      )}

      {/* ============ 详情视图（参考图4） ============ */}
      {view === 'detail' && (
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-28 pt-3">
          {QuestionHead}
          {/* TA 的回答（第九轮主动答 + 第十轮和我一起答） */}
          <div className="mt-6">
            <div className="text-[15px] font-medium text-[#26262b] dark:text-zinc-100">{ta}（TA）</div>
            {taByQ[q] ? (
              <>
                <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#4a4a52] dark:text-zinc-200" data-testid="quiz-ta-answer">
                  {taByQ[q].a}
                </div>
                <div className="mt-1.5 text-[12px] text-[#c9c9d0] dark:text-zinc-500" data-testid="quiz-ta-stamp">
                  {fmtDate(taByQ[q].at)} · {taByQ[q].withMe ? '和你一起答的' : 'TA 自己主动写的'}
                </div>
              </>
            ) : (
              <div className="mt-2 text-[15px] leading-relaxed text-[#b9b9c0] dark:text-zinc-500">还没有回答问题哦</div>
            )}
          </div>
          {/* 我的回答 */}
          <div className="mt-7">
            <div className="text-[15px] font-medium text-[#26262b] dark:text-zinc-100">{me}（我）</div>
            {my ? (
              <>
                <div className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-[#2c2c30] dark:text-zinc-100">{my.a}</div>
                <div className="mt-1.5 text-[12px] text-[#c9c9d0] dark:text-zinc-500">{fmtDate(my.at)}</div>
                <button
                  type="button"
                  onClick={startAnswer}
                  className="mt-4 h-11 w-full rounded-2xl border-[1.5px] border-dashed border-[#3c3c42] dark:border-white/15 text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 transition-colors active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
                >
                  修改我的回答
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startAnswer}
                className="mt-4 h-12 w-full rounded-2xl border-[1.5px] border-dashed border-[#3c3c42] dark:border-white/15 text-[16px] font-semibold text-[#26262b] dark:text-zinc-100 transition-colors active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
              >
                点此回答问题
              </button>
            )}
          </div>
          {isCustom && (
            <button type="button" onClick={removeCustom} className="mx-auto mt-8 block text-[13px] text-[#d3a5b1] dark:text-rose-200/55 underline underline-offset-4">
              删除这个自定义问题
            </button>
          )}
        </div>
      )}

      {/* ============ 回答视图（参考图5） ============ */}
      {view === 'answer' && (
        <div className="flex flex-1 flex-col overflow-hidden px-6 pt-3">
          {QuestionHead}
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="输入你的回答..."
            maxLength={100}
            rows={5}
            autoFocus
            className="mt-5 w-full flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-[#2c2c30] dark:text-zinc-100 outline-none placeholder:text-[#c6c6cd] dark:placeholder:text-zinc-500"
          />
          <div className="pb-2 text-right text-[13px] text-[#c6c6cd] dark:text-zinc-500">{answer.length}/100</div>
          <button
            type="button"
            onClick={saveAnswer}
            disabled={!answer.trim()}
            className="mx-auto mb-8 h-[52px] w-[70%] rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[17px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_6px_18px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 transition-all active:scale-[0.98] disabled:opacity-45 disabled:shadow-none"
          >
            完成
          </button>
        </div>
      )}

      {/* 右下角悬浮 + 号：自定义问题 */}
      {view !== 'answer' && (
        <button
          type="button"
          onClick={() => setAddSheet(true)}
          aria-label="自定义问题"
          className="absolute bottom-7 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_6px_18px_rgba(242,83,106,0.38)] transition-transform active:scale-90"
        >
          <Plus className="h-7 w-7" strokeWidth={2.4} />
        </button>
      )}

      {/* 自定义问题弹层 */}
      {addSheet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-8" onClick={() => setAddSheet(false)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">自定义问题</div>
            <QuizHeartLine className="mt-3" />
            <textarea
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              placeholder="写下你想和 TA 聊的问题…"
              maxLength={50}
              rows={3}
              autoFocus
              className="mt-4 w-full resize-none rounded-xl bg-[#fdf1f4] dark:bg-rose-300/10 p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-[#d8aab6] dark:placeholder:text-rose-200/55"
            />
            <div className="text-right text-[12px] text-[#c9c9d0] dark:text-zinc-500">{newQ.length}/50</div>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={() => setAddSheet(false)} className="h-11 flex-1 rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 text-[15px] font-medium text-[#7a7a82] dark:text-zinc-400">
                取消
              </button>
              <button
                type="button"
                onClick={addCustom}
                disabled={!newQ.trim()}
                className="h-11 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 disabled:opacity-45"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 判断列表序号是否为自定义问题 */
function isCustomIndex(i: number, customLen: number) {
  return i < customLen;
}

/** 信纸样式（编辑器可切换） */
interface LetterPaper {
  key: string;
  name: string;
  bg: string; // 信纸底渐变
  line: string; // 横线颜色
  dashed: boolean; // 横线是否跟随「虚线」开关
  text: string; // 推荐字色（页脚计数等）
  dark: boolean; // 深色信纸（页脚/日期用浅色）
  deco?: string; // 叠加装饰纹理层（backgroundImage）
  decoSize?: string; // 装饰纹理层平铺尺寸
  // —— 第二十八轮新增（参考「衔纸的鸽」「喵汪物语」信纸图）——
  frame?: boolean; // 双线画框（内衬边框，复刻参考图细线框）
  dove?: boolean; // 左上角衔纸信鸽 SVG
  headerQuote?: string; // 顶部题头句（左上，仿参考图「幸福就是~…」）
  headerScript?: string; // 顶部花体题字（右上，仿参考图 A Winged Word）
  headerPets?: string; // 顶部右上角小动物（字符映射 PetFace SVG）
  fishBand?: boolean; // 题头下粉色小鱼骨分隔条
  caption?: string; // 左下角英文小字（仿参考图 LIKE A DOVE…）
  padTop?: number; // 编辑区顶部内边距覆盖（有题头的信纸把正文往下压，避免遮挡）
  grid?: boolean; // 方格稿纸（田字格纹理替代横线；不受虚线开关影响）
}

/** 未来情书信纸样式（编辑器可切换；第二十八轮美化+扩容：12+3 款信纸；新增参考图同款「衔纸的鸽/喵汪物语/粉稿方格」） */
const LETTER_PAPERS: LetterPaper[] = [
  { key: 'default', name: '信笺米黄', bg: 'linear-gradient(180deg,#fdf9ee 0%,#fbf2df 60%,#f8ecd2 100%)', line: 'rgba(196,164,116,0.55)', dashed: true, text: '#5a4a38', dark: false },
  { key: 'white', name: '纯白简约', bg: 'linear-gradient(180deg,#ffffff,#f8f9fb)', line: 'rgba(165,165,175,0.45)', dashed: false, text: '#3a3a40', dark: false },
  { key: 'gray', name: '浅灰格纹', bg: 'linear-gradient(180deg,#f7f7f9,#ececef)', line: 'rgba(150,150,162,0.42)', dashed: false, text: '#4a4a52', dark: false, deco: 'repeating-linear-gradient(90deg, transparent 0 12px, rgba(150,150,162,0.15) 12px 13px), repeating-linear-gradient(180deg, transparent 0 12px, rgba(150,150,162,0.15) 12px 13px)', decoSize: 'auto, auto' },
  { key: 'green', name: '墨绿复古', bg: 'linear-gradient(180deg,#f8f3e4,#efe4c9)', line: 'rgba(122,110,80,0.5)', dashed: true, text: '#4a4232', dark: false },
  { key: 'pink', name: '柔粉蕾丝', bg: 'linear-gradient(180deg,#fdf1f4,#fae5ec)', line: 'rgba(214,150,170,0.5)', dashed: true, text: '#7a4a58', dark: false, deco: 'radial-gradient(circle at 9px 9px, rgba(255,255,255,0.75) 1.5px, transparent 2.4px)', decoSize: '22px 22px' },
  { key: 'sakura', name: '樱花物语', bg: 'linear-gradient(180deg,#fef4f7,#fde9ef)', line: 'rgba(228,152,176,0.45)', dashed: true, text: '#7a4a58', dark: false, deco: 'radial-gradient(circle at 12px 12px, rgba(244,143,177,0.22) 2px, transparent 3px)', decoSize: '30px 30px' },
  { key: 'kraft', name: '牛皮纸', bg: 'linear-gradient(180deg,#f4e8d4,#ebdcc1)', line: 'rgba(154,124,84,0.5)', dashed: true, text: '#5a4632', dark: false, deco: 'repeating-linear-gradient(45deg, rgba(154,124,84,0.045) 0 3px, transparent 3px 7px), repeating-linear-gradient(-45deg, rgba(154,124,84,0.045) 0 3px, transparent 3px 7px)', decoSize: 'auto, auto' },
  { key: 'mint', name: '薄荷苏打', bg: 'linear-gradient(180deg,#f1faf5,#e3f5eb)', line: 'rgba(110,170,140,0.42)', dashed: true, text: '#3f5a4a', dark: false, deco: 'radial-gradient(circle at 11px 11px, rgba(255,255,255,0.85) 1.8px, transparent 2.6px)', decoSize: '26px 26px' },
  { key: 'sky', name: '晴空物语', bg: 'linear-gradient(180deg,#f1f8fe,#e3effa)', line: 'rgba(120,160,200,0.4)', dashed: true, text: '#3f5064', dark: false, deco: 'radial-gradient(circle at 13px 13px, rgba(255,255,255,0.9) 2.2px, transparent 3.2px)', decoSize: '32px 32px' },
  { key: 'lavender', name: '薰衣草', bg: 'linear-gradient(180deg,#f7f3fc,#eee6f9)', line: 'rgba(160,140,200,0.42)', dashed: true, text: '#55446e', dark: false, deco: 'radial-gradient(circle at 10px 10px, rgba(255,255,255,0.7) 1.4px, transparent 2.2px)', decoSize: '24px 24px' },
  { key: 'milktea', name: '莓果奶茶', bg: 'linear-gradient(180deg,#fbf1e9,#f4e4d8)', line: 'rgba(190,140,110,0.45)', dashed: true, text: '#6e4a38', dark: false },
  { key: 'night', name: '星夜蓝', bg: 'linear-gradient(180deg,#232633,#191c27)', line: 'rgba(185,195,225,0.32)', dashed: true, text: '#d8deee', dark: true, deco: 'radial-gradient(circle at 14px 14px, rgba(255,255,255,0.12) 1.1px, transparent 2px)', decoSize: '30px 30px' },
  // —— 第二十八轮新增（参考用户上传的「衔纸的鸽」「喵汪物语」信纸图）——
  { key: 'dove', name: '衔纸的鸽', bg: 'linear-gradient(180deg,#fbf8f0 0%,#f6f0e2 55%,#f1e9d6 100%)', line: 'rgba(150,138,112,0.42)', dashed: true, text: '#5a5044', dark: false, frame: true, dove: true, headerScript: 'A Winged Word', caption: 'LIKE A DOVE ALIGHTING UPON A BLOOM OF PEACE, MAY THIS MESSAGE CARRY THE FRAGRANCE OF HOPE TO YOUR HEART', padTop: 56 },
  { key: 'maowang', name: '喵汪物语', bg: 'linear-gradient(180deg,#ffffff 0%,#fbfbfe 100%)', line: 'rgba(168,168,180,0.4)', dashed: true, text: '#4a4a52', dark: false, headerQuote: '幸福就是~猫吃鱼，狗吃肉，奥特曼打小怪兽~', headerPets: '🐱🐶', fishBand: true, padTop: 62 },
  { key: 'fangge', name: '粉稿方格', bg: 'linear-gradient(180deg,#fdf6f8,#faedf1)', line: 'rgba(214,150,170,0.5)', dashed: false, text: '#7a4a58', dark: false, grid: true, deco: 'repeating-linear-gradient(90deg, transparent 0 21px, rgba(214,150,170,0.22) 21px 22px), repeating-linear-gradient(180deg, transparent 0 21px, rgba(214,150,170,0.22) 21px 22px)', decoSize: 'auto, auto', frame: true },
];

/**
 * 未来情书字体（编辑器字体面板）。
 * 第二十八轮修复「点击其中一个字体没有反应」：行楷/隶书/魏碑/圆体依赖系统字体栈，
 * 在 iOS/Windows 上缺字体时会静默回退到楷体/苹方——点击后渲染完全一样（= 没反应）。
 * 修复方式：删掉不可靠的系统栈字体，改为自托管 webfont（/public/fonts/*，unicode-range 子集，
 * 全平台渲染一致）。
 * 第二十九轮：删除「仿宋」——它在 iOS 上缺字体回退到 Songti SC，和「宋体」渲染完全一样
 * （用户反馈「字体里面有的一样」）；同时删除「宋体」同一原因：iOS/安卓上与楷体回退栈趋同的
 * 概率高，保留渲染稳定的楷体与自托管手写体系即可。剩余每款都渲染独特：苹方（无衬线）/楷体/手写楷/
 * 行书/毛草/龙藏/小薇/快乐/黄油。
 * CSS 由 LETTER_FONT_LINKS 在情书页懒加载（@font-face 仅在用到时才拉子集，零常驻成本）。
 */
const LETTER_FONTS = [
  { key: 'default', name: '苹方 iOS', css: '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif' },
  { key: 'kai', name: '楷体', css: 'KaiTi,"Kaiti SC",STKaiti,"Kaiti TC",serif' },
  { key: 'mashan', name: '手写楷', css: '"Ma Shan Zheng","Kaiti SC",KaiTi,serif' },
  { key: 'zhimang', name: '行书', css: '"Zhi Mang Xing","Kaiti SC",KaiTi,cursive' },
  { key: 'maocao', name: '毛草情书', css: '"Liu Jian Mao Cao","Xingkai SC",KaiTi,cursive' },
  { key: 'longcang', name: '龙藏手写', css: '"Long Cang","Xingkai SC",KaiTi,cursive' },
  { key: 'xiaowei', name: '小薇文艺', css: '"ZCOOL XiaoWei","Songti SC",SimSun,serif' },
  { key: 'kuaile', name: '快乐体', css: '"ZCOOL KuaiLe","Yuanti SC",YouYuan,"PingFang SC",sans-serif' },
  { key: 'huangyou', name: '黄油体', css: '"ZCOOL QingKe HuangYou","Yuanti SC",YouYuan,"PingFang SC",sans-serif' },
];

/** 自托管字体 CSS（情书页挂载时注入 <link>，字体文件按 unicode-range 懒加载） */
const LETTER_FONT_LINKS = [
  '/fonts/mashanzheng/font.css',
  '/fonts/zhimangxing/font.css',
  '/fonts/liujianmaocao/font.css',
  '/fonts/longcang/font.css',
  '/fonts/zcoolxiaowei/font.css',
  '/fonts/zcoolkuaile/font.css',
  '/fonts/zcoolhuangyou/font.css',
];

/** 确保自托管字体 CSS 已注入页面（幂等；情书页挂载时调用） */
function ensureLetterFontLinks() {
  if (typeof document === 'undefined') return;
  for (const href of LETTER_FONT_LINKS) {
    if (!document.querySelector(`link[data-letter-font="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-letter-font', href);
      document.head.appendChild(link);
    }
  }
}

/** 未来情书字色 */
const LETTER_COLORS = ['#4a4238', '#8a8a94', '#a13a52', '#b8860b', '#3f6b4f', '#4a5a7a', '#8a5a2e', '#5f3d8a'];

/** 衔纸信鸽 SVG（参考「A Winged Word」信纸图左上角线稿鸽：白鸽衔信） */
function PaperDove() {
  return (
    <svg viewBox="0 0 48 40" aria-hidden="true" style={{ display: 'block', width: 'clamp(20px, 10cqw, 46px)', height: 'auto', opacity: 0.8 }}>
      <g fill="none" stroke="#a13a52" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 24.5c0-6.2 5.2-11.2 12.2-11.2 3.8 0 6.8 1.9 8.8 4.8l7.6 2-6.6 3.8c-1 5.8-5.8 9.8-12.6 9.8H9l3.8-4.6c-1.2-1.3-1.8-2.9-1.8-4.6Z" fill="rgba(161,58,82,0.07)" />
        <path d="M21.5 13.4c-2.2-3.8-6.4-5.6-11.2-4.6 2 2.9 5.2 4.7 8.6 4.9" />
        <path d="M13.5 30.5 8.5 35h6.5" />
        <circle cx="27.6" cy="16.6" r="0.9" fill="#a13a52" stroke="none" />
      </g>
      <g transform="translate(33.5 21.5) rotate(10)">
        <rect x="0" y="0" width="8.4" height="5.8" rx="0.9" fill="#fffdf6" stroke="#a13a52" strokeWidth="0.8" />
        <path d="M0.5 0.8 4.2 3.4 7.9 0.8" fill="none" stroke="#a13a52" strokeWidth="0.7" />
      </g>
    </svg>
  );
}

/** 小鱼分隔条里的单条小鱼 */
function PaperFish() {
  return (
    <svg viewBox="0 0 16 10" aria-hidden="true" style={{ display: 'block', width: 'clamp(8px, 3cqw, 14px)', height: 'auto', opacity: 0.75 }}>
      <ellipse cx="6.4" cy="5" rx="4.6" ry="2.7" fill="#f2b3c3" />
      <path d="M10.8 5 15 2.4v5.2Z" fill="#f2b3c3" />
      <circle cx="4.6" cy="4.4" r="0.7" fill="#fff" />
    </svg>
  );
}

/**
 * 信纸装饰层（第二十八轮：参考「衔纸的鸽」「喵汪物语」信纸图）——
 * 画框/衔纸鸽/花体题字/题头句/角落小动物/小鱼骨分隔条/左下英文小字。
 * 全部用 % + cqw 定位缩放：编辑页（480px 高）与选择弹层预览（86px）共用同一组件等比渲染，
 * 父容器需设置 containerType: 'inline-size'。
 */
function PaperDeco({ p }: { p: LetterPaper }) {
  const hasAny = p.frame || p.dove || p.headerQuote || p.headerScript || p.headerPets || p.fishBand || p.caption;
  if (!hasAny) return null;
  const petKinds = (p.headerPets ? Array.from(p.headerPets).map(petKindOf).filter((k): k is NonNullable<ReturnType<typeof petKindOf>> => k !== null) : []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 双线画框（复刻参考图细线边框） */}
      {p.frame && (
        <>
          <div className="absolute" style={{ inset: '2.4%', border: `1px solid ${p.line}`, borderRadius: 2, opacity: 0.75 }} />
          <div className="absolute" style={{ inset: '3.6%', border: `1px solid ${p.line}`, borderRadius: 1, opacity: 0.45 }} />
        </>
      )}
      {/* 左上角衔纸信鸽 */}
      {p.dove && (
        <div className="absolute" style={{ left: '5.2%', top: '3.2%' }}>
          <PaperDove />
        </div>
      )}
      {/* 右上角花体题字（仿 A Winged Word） */}
      {p.headerScript && (
        <div
          className="absolute"
          style={{ top: '3.4%', right: '7%', fontFamily: 'KaiTi,"Kaiti SC",STKaiti,"Ma Shan Zheng",serif', fontStyle: 'italic', fontSize: 'clamp(9px, 3.7cqw, 18px)', letterSpacing: '0.1em', color: 'rgba(122,64,80,0.62)' }}
        >
          {p.headerScript}
        </div>
      )}
      {/* 左上题头句（仿「幸福就是~…」） */}
      {p.headerQuote && (
        <div
          className="absolute truncate"
          style={{ top: '2.8%', left: '4.6%', right: p.headerPets ? '26%' : '4.6%', fontSize: 'clamp(8px, 3.2cqw, 15.5px)', letterSpacing: '0.05em', fontWeight: 600, color: '#9a9aa2' }}
        >
          {p.headerQuote}
        </div>
      )}
      {/* 右上角小动物（猫+狗） */}
      {petKinds.length > 0 && (
        <div className="absolute flex items-start" style={{ top: '1.4%', right: '3.2%', gap: '1.2cqw' }}>
          {petKinds.map((k, i) => (
            <PetFace key={i} kind={k} />
          ))}
        </div>
      )}
      {/* 粉色小鱼骨分隔条 */}
      {p.fishBand && (
        <div className="absolute flex items-center justify-around overflow-hidden rounded-[3px]" style={{ top: '8.2%', left: '4.6%', right: '4.6%', height: 'clamp(5px, 2.8cqw, 13px)', background: '#fbe3ea' }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <PaperFish key={i} />
          ))}
        </div>
      )}
      {/* 左下角英文小字（仿 LIKE A DOVE…） */}
      {p.caption && (
        <div
          className="absolute uppercase"
          style={{ bottom: '6%', left: '5.4%', width: '64%', fontSize: 'clamp(4.5px, 1.9cqw, 9.5px)', lineHeight: 1.55, letterSpacing: '0.04em', color: 'rgba(90,74,56,0.4)' }}
        >
          {p.caption}
        </div>
      )}
    </div>
  );
}

/** 星空底（未来情书）：随机星点 + 缓闪 */
function LetterStars({ count = 44 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 70,
        s: Math.random() * 1.8 + 0.6,
        o: Math.random() * 0.45 + 0.25,
        d: Math.random() * 4,
      })),
    [count],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white [animation:couple-twinkle_3.4s_ease-in-out_infinite]"
          style={{ left: `${st.left}%`, top: `${st.top}%`, width: st.s, height: st.s, opacity: st.o, animationDelay: `${st.d}s` }}
        />
      ))}
    </div>
  );
}

/** 深夜信封（主视图插画：斜置信封 + 火漆心 + 星芒；第二十八轮封面美化：暖光晕 + 邮票 + 地址线 + 漂浮小心心） */
function NightEnvelope() {
  return (
    <div className="relative">
      {/* 暖光晕（信封背后的柔光） */}
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[200px] w-[262px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,214,170,0.15),transparent_72%)] blur-[6px]" />
      <svg viewBox="0 0 210 150" className="relative w-[218px] [filter:drop-shadow(0_16px_24px_rgba(0,0,0,0.55))]" aria-hidden="true">
        <defs>
          <linearGradient id="envFace" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3d3d48" />
            <stop offset="1" stopColor="#232329" />
          </linearGradient>
        </defs>
        {/* 底下压着的信封 */}
        <rect x="16" y="30" width="168" height="100" rx="8" fill="#191920" transform="rotate(-5 100 80)" />
        <rect x="22" y="36" width="156" height="88" rx="6" fill="#202027" transform="rotate(-5 100 80)" />
        {/* 主信封 */}
        <g transform="rotate(3 105 84)">
          <rect x="25" y="36" width="160" height="94" rx="7" fill="url(#envFace)" stroke="#4d4d5a" strokeWidth="1.5" />
          <path d="M25 40 L105 94 L185 40" fill="none" stroke="#4d4d5a" strokeWidth="1.5" />
          <path d="M25 128 L88 84 M185 128 L122 84" stroke="#3c3c47" strokeWidth="1.2" opacity="0.8" />
          {/* 邮票（右上角小心心邮票） */}
          <g transform="translate(150 48)">
            <rect x="0" y="0" width="21" height="25" rx="2" fill="#1d1d24" stroke="#63636f" strokeWidth="1" />
            <path d={LOVE_HEART_PATH} transform="translate(10.5 12.5) scale(1.05) translate(-4.5 -3.5)" fill="#8a5a68" />
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={`t${i}`} cx={3 + i * 3.75} cy="1.8" r="0.7" fill="#3a3a44" />
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={`b${i}`} cx={3 + i * 3.75} cy="23.2" r="0.7" fill="#3a3a44" />
            ))}
          </g>
          {/* 地址线 */}
          <line x1="34" y1="108" x2="122" y2="108" stroke="#5a5a66" strokeWidth="1.1" opacity="0.75" strokeLinecap="round" />
          <line x1="34" y1="116" x2="102" y2="116" stroke="#4a4a56" strokeWidth="1" opacity="0.55" strokeLinecap="round" />
          {/* 火漆印 */}
          <circle cx="105" cy="94" r="11.5" fill="#141419" stroke="#5d5d6c" strokeWidth="2" />
          <path d={LOVE_HEART_PATH} transform="translate(105 94) scale(1.15) translate(-4.5 -3.5)" fill="#6e6e7e" />
        </g>
        {/* 星芒 */}
        <g transform="translate(158 24)">
          <path d="M0 -13 L2.2 -2.2 L13 0 L2.2 2.2 L0 13 L-2.2 2.2 L-13 0 L-2.2 -2.2 Z" fill="#ffffff" />
          <circle r="2.6" fill="#ffffff" />
          <path d="M0 0 L34 0 M0 0 L-30 -8 M0 0 L26 -14" stroke="#ffffff" strokeWidth="0.8" opacity="0.55" />
        </g>
        <circle cx="34" cy="18" r="1.4" fill="#8a8a96" />
        <circle cx="196" cy="66" r="1.2" fill="#8a8a96" />
        <circle cx="12" cy="86" r="1.2" fill="#8a8a96" />
      </svg>
      {/* 漂浮小心心 */}
      <span aria-hidden="true" className="absolute -right-1 top-1 text-[13px] text-[#9a6a7a] dark:text-rose-300 [animation:couple-float-y_3.4s_ease-in-out_infinite]">♡</span>
      <span aria-hidden="true" className="absolute left-1 bottom-2 text-[10px] text-[#6e5a64] dark:text-rose-300/80 [animation:couple-float-y_4.2s_ease-in-out_infinite_1.1s]">♡</span>
    </div>
  );
}

/** 订单记录小图标（剪贴板） */
function OrderIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2.4" />
      <rect x="9" y="2.2" width="6" height="3.6" rx="1.2" />
      <path d="M8.6 9.5h6.8M8.6 13h6.8M8.6 16.5h4.2" />
    </svg>
  );
}

/**
 * 通用分享选择器（第十八轮需求41）：所有分享都可以选择 QQ/微信，然后再选择联系人。
 * 第二十六轮：全部分享弹窗统一成「邀请联系人开情侣空间」同款底部弹层——拖拽条 + 左对齐标题/副标题
 * + 渠道双按钮（粉渐变选中）+ 好友列表行，恋人置顶默认选中。
 * 渠道步（微信/QQ 大按钮）→ 联系人步（好友列表）→ 确认发送。
 */
function ShareChannelPicker({ title, hint, onSend, onClose }: { title: string; hint?: string; onSend: (channel: CoupleChannel, contactId: string) => void; onClose: () => void }) {
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
const LETTER_PAGE_CHARS = 300; // 每页信纸字数上限（写满翻下一页；第二十八轮起每页信纸同高同容量：480px · 300 字）
const LETTER_PAGE_HEIGHT = 480; // 每页信纸统一高度（第二十八轮：第一页与后续页一样大）
const LETTER_MAX_PAGES = 6; // 最多页数

function LettersPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
  const [view, setView] = useState<'home' | 'intro' | 'write' | 'send' | 'box' | 'read'>('home');
  // 多页信纸（第十九轮需求44；第二十轮改纵向：下滑即添加第二页，不再左右翻页）
  const [pages, setPages] = useState<string[]>(() => {
    const d = state.letterDraft;
    if (!d) return [''];
    try {
      const j = JSON.parse(d) as unknown;
      if (Array.isArray(j) && j.length > 0 && j.every((x) => typeof x === 'string')) return j as string[];
    } catch {
      /* 旧版纯文本草稿 */
    }
    return [d];
  });
  const [focusPage, setFocusPage] = useState(0); // 当前编辑页（工具栏只浮在这页上）
  const [envKey, setEnvKey] = useState<string>(state.letterEnv || 'pinkbunny'); // 信封样式（第十八轮需求37）
  const [envText, setEnvText] = useState<string>(state.letterEnvText || ''); // 信封收信字样（第二十九轮可自定义）
  const [readId, setReadId] = useState<string | null>(null); // 正在阅读的信 id（第二十轮：信箱点进单独阅读界面）
  const [readFrom, setReadFrom] = useState<'me' | 'ta'>('ta');
  const [readPage, setReadPage] = useState(0); // 阅读页码（当前：第 x/y 页）
  const [shareLetterId, setShareLetterId] = useState<string | null>(null); // 正在分享的信（弹出通用分享选择器）
  const [sendMode, setSendMode] = useState<'now' | 'timed'>('now'); // 寄出方式（第二十轮改名：即时发出 / 定时发出）
  const [after, setAfter] = useState(30);
  const [paper, setPaper] = useState<LetterPaper>(() => LETTER_PAPERS.find((p) => p.key === state.letterPaperKey) ?? LETTER_PAPERS[0]);
  const [font, setFont] = useState<(typeof LETTER_FONTS)[number]>(() => LETTER_FONTS.find((f) => f.key === state.letterFontKey) ?? LETTER_FONTS[0]);
  const [fontSize, setFontSize] = useState(state.letterFontSize ?? 14);
  const [color, setColor] = useState(state.letterColor ?? LETTER_COLORS[0]);
  const [dashed, setDashed] = useState(true);
  const [receipt, setReceipt] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [sheet, setSheet] = useState<null | 'paper' | 'font' | 'env' | 'sender'>(null);
  const [senderName, setSenderName] = useState(''); // 署名设置弹层草稿（第二十轮）
  const [senderAvatarDraft, setSenderAvatarDraft] = useState('');
  const senderFileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null); // 信纸纵向滚动容器
  const fullToastAt = useRef(0); // 页满提示节流
  const now = Date.now();
  const arrived = (l: { at: number; openAfterDays: number }) => now >= l.at + l.openAfterDays * 86400000;
  const arriveDate = new Date(Date.now() + after * 86400000);
  const meName0 = (state.letterSenderName || '').trim() || state.meName || '我'; // 信封署名：自定义 > 微信/QQ 同步
  const senderAvatar = state.letterSenderAvatar || state.meAvatar || null; // 信封头像：自定义 > 微信/QQ 同步

  // 第二十八轮：自托管字体 CSS 懒加载（幂等；@font-face 按 unicode-range 按需拉子集）
  useEffect(() => {
    ensureLetterFontLinks();
  }, []);

  // 第二十八轮：信纸/字体/字号/颜色选择同步持久化（修复重开后丢失导致「看起来没选中」）
  const pickPaper = (p: LetterPaper) => {
    setPaper(p);
    patch({ letterPaperKey: p.key });
  };
  const pickFont = (f: (typeof LETTER_FONTS)[number]) => {
    setFont(f);
    patch({ letterFontKey: f.key });
  };
  const pickFontSize = (n: number) => {
    setFontSize(n);
    patch({ letterFontSize: n });
  };
  const pickColor = (c: string) => {
    setColor(c);
    patch({ letterColor: c });
  };

  /** 指定页写入（上限截断 + 写满提示节流 + 写满自动下滑加下一页；第二十八轮起每页容量一致） */
  const setPageTextAt = (pi: number, v: string) => {
    const cap = LETTER_PAGE_CHARS;
    const capped = v.slice(0, cap);
    const wasFull = (pages[pi] ?? '').length >= cap;
    setPages((ps) => ps.map((p, i) => (i === pi ? capped : p)));
    if (capped.length >= cap && !wasFull && pi === pages.length - 1 && pages.length < LETTER_MAX_PAGES) {
      setPages((ps) => (ps.length < LETTER_MAX_PAGES ? [...ps, ''] : ps));
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 60);
    }
  };

  /** 手动加一页（下滑到信纸末尾的「再添一页」） */
  const addPage = () => {
    if (pages.length >= LETTER_MAX_PAGES) {
      showToast(`最多写 ${LETTER_MAX_PAGES} 页哦`);
      return;
    }
    setPages((ps) => [...ps, '']);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 60);
  };

  /** 打开单独阅读界面（第二十轮：信箱点进的是独立界面，里面是信的内容） */
  const openRead = (id: string, from: 'me' | 'ta') => {
    setReadId(id);
    setReadFrom(from);
    setReadPage(0);
    setView('read');
  };

  /** 多页合并成全文（发送/字数统计用） */
  const fullText = () => pages.map((p) => p.trim()).filter(Boolean).join('\n');

  /** 三个选择弹层（信纸/字体/信封；第十九轮起编辑页与发送设置页共用） */
  const renderSheets = () => (
    <>
      {/* 信纸选择弹层（第二十八轮：12+3 款信纸 + 预览带装饰纹理层/画框/题头，与编辑页等比渲染） */}
      {sheet === 'paper' && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
          <div className="rounded-t-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-4 pb-8 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
            <div className="text-center text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">选择信纸</div>
            <div className="mt-1 text-center text-[11px] text-[#b6b6bd] dark:text-zinc-500">挑一张喜欢的信纸，把心里话写在上面 ♡</div>
            <div className="mt-3 grid max-h-[330px] grid-cols-4 gap-3 overflow-y-auto">
              {LETTER_PAPERS.map((p) => (
                <button key={p.key} type="button" onClick={() => { pickPaper(p); setSheet(null); }} className="flex flex-col items-center gap-1.5">
                  <span className={`relative h-[86px] w-full overflow-hidden rounded-md border-2 shadow-sm ${paper.key === p.key ? 'border-[#2c2c30]' : 'border-transparent'}`} style={{ containerType: 'inline-size' }}>
                    <span aria-hidden="true" className="absolute inset-0" style={{ background: p.bg }} />
                    {p.deco && <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: p.deco, backgroundSize: p.decoSize }} />}
                    {p.grid ? null : <span aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(180deg, transparent 0 12px, ${p.line} 12px 13px)` }} />}
                    <PaperDeco p={p} />
                  </span>
                  <span className={`w-full truncate text-[11.5px] ${paper.key === p.key ? 'font-semibold text-[#26262b] dark:text-zinc-100' : 'text-[#5a5a62] dark:text-zinc-300'}`}>{p.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => showToast('更多信纸即将上架 ♡')} className="h-11 flex-1 rounded-2xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">
                更多信纸
              </button>
              <button type="button" onClick={() => setSheet(null)} className="h-11 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10">
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 字体弹层（字体/字号/颜色；第二十八轮美化：双行预览卡片+金色选中态+圆形色板+实时预览条；全部字体自托管 webfont/全平台系统字体，点击必有效果） */}
      {sheet === 'font' && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
          <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-4 pb-8 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
            <div className="text-center text-[15px] font-bold text-[#2c2c30] dark:text-zinc-100">字体</div>
            <div className="mt-1 text-center text-[11px] text-[#b6b6bd] dark:text-zinc-500">选一种字体，让字也有温度（新增 7 款手写体，点击即生效）</div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {LETTER_FONTS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => pickFont(f)}
                  className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${font.key === f.key ? 'border-[#c9a86a] bg-[#fbf5e8] shadow-[0_2px_10px_rgba(201,168,106,0.22)]' : 'border-[#e8e8ec] dark:border-white/10 bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl active:bg-[#f6f6f8] dark:active:bg-zinc-900/70'}`}
                >
                  <div className="text-[10.5px] font-medium text-[#9a9aa2] dark:text-zinc-400">{f.name}</div>
                  <div className="mt-1 text-[18px] leading-tight text-[#3a3a40] dark:text-zinc-200" style={{ fontFamily: f.css }}>见字如面</div>
                  <div className="mt-0.5 text-[12.5px] text-[#8a8a94] dark:text-zinc-400" style={{ fontFamily: f.css }}>纸短情长</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="shrink-0 text-[14px] font-semibold text-[#3a3a40] dark:text-zinc-200">字号</span>
              <span className="text-[12px] text-[#b6b6bd] dark:text-zinc-500">A</span>
              <input type="range" min={12} max={22} value={fontSize} onChange={(e) => pickFontSize(Number(e.target.value))} className="h-1.5 flex-1 accent-[#2c2c30] dark:accent-zinc-400" aria-label="字号" />
              <span className="text-[18px] font-semibold text-[#3a3a40] dark:text-zinc-200">A</span>
              <span className="w-8 shrink-0 rounded-full bg-[#2c2c30] py-0.5 text-center text-[12px] font-bold text-white">{fontSize}</span>
            </div>
            <div className="mt-4 flex items-start gap-3">
              <span className="shrink-0 pt-2 text-[14px] font-semibold text-[#3a3a40] dark:text-zinc-200">颜色</span>
              <div className="flex flex-wrap gap-2.5">
                {LETTER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`颜色 ${c}`}
                    onClick={() => pickColor(c)}
                    className={`h-9 w-9 rounded-full border-2 shadow-sm ${color === c ? 'border-[#2c2c30]' : 'border-transparent'}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            {/* 实时预览条：当前字体+字号+颜色落在当前信纸上 */}
            <div className="mt-4 overflow-hidden rounded-xl border border-[#e8e8ec] dark:border-white/10 px-4 py-3" style={{ background: paper.bg }}>
              <div className="text-[13px] leading-[24px]" style={{ fontFamily: font.css, fontSize, color }}>
                亲爱的他：<span className="opacity-80">落笔的那一刻，想念就有了形状。</span>
              </div>
            </div>
            <button type="button" onClick={() => setSheet(null)} className="mt-5 h-11 w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10">
              完成
            </button>
          </div>
        </div>
      )}

      {/* 信封样式选择弹层（第十八轮需求37；第十九轮起发送设置页「换信封」也走这里；
          第二十九轮：顶部新增「信封上的字」自定义输入——实时同步到预览与所有我的信封） */}
      {sheet === 'env' && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
          <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-4 pb-8 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()} data-testid="env-picker">
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
            <div className="text-center text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">选择信封</div>
            <div className="mt-1 text-center text-[11px] text-[#b6b6bd] dark:text-zinc-500">挑一个喜欢的信封，把信装进去寄给他（信封上的字在发送设置里填写）</div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {LETTER_ENVELOPES.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => {
                    setEnvKey(e.key);
                    patch({ letterEnv: e.key });
                    setSheet(null);
                  }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span className={`w-full overflow-hidden rounded-lg border-2 shadow-sm ${envKey === e.key ? 'border-[#2c2c30]' : 'border-transparent'}`}>
                    <EnvelopeArt envKey={e.key} className="h-[74px] w-full" faceText={envText} />
                  </span>
                  <span className={`text-[11.5px] ${envKey === e.key ? 'font-semibold text-[#26262b] dark:text-zinc-100' : 'text-[#5a5a62] dark:text-zinc-300'}`}>{e.name}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setSheet(null)} className="mt-5 h-11 w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10">
              完成
            </button>
          </div>
        </div>
      )}
    </>
  );

  /** 聊天里的信封卡片点击进来（第十八轮需求40；第二十轮：直达单独阅读界面） */
  useEffect(() => {
    const p = consumePendingLetterOpen();
    if (!p) return;
    const exists = p.from === 'ta' ? state.aiLetters.some((x) => x.id === p.letterId) : state.letters.some((x) => x.id === p.letterId);
    if (!exists) {
      setView('box');
      return;
    }
    setReadFrom(p.from);
    setReadId(p.letterId);
    setReadPage(0);
    setView('read');
  }, []);

  /** 寄出信件（第十九轮：删除「封存」；第二十轮：寄出方式改叫定时发出/即时发出，寄出后进信箱；第二十九轮：一并持久化信封收信字样） */
  const sendLetter = () => {
    const t = fullText();
    if (!t) return;
    patch({
      letters: [{ id: uid(), text: t, at: Date.now(), openAfterDays: sendMode === 'now' ? 0 : after, envelope: envKey }, ...state.letters],
      letterDraft: '',
      letterEnv: envKey,
      letterEnvText: envText,
    });
    setPages(['']);
    setFocusPage(0);
    setView('box');
    showToast(sendMode === 'now' ? '信已寄出，TA 现在就能拆 ♡' : `信已寄出，${after} 天后送达 ♡`);
  };

  /** 保存信封署名设置（第二十轮：头像/昵称可自定义，留空跟随微信/QQ） */
  const saveSender = () => {
    patch({ letterSenderName: senderName.trim(), letterSenderAvatar: senderAvatarDraft });
    setSheet(null);
    showToast('信封署名已保存 ♡');
  };

  /** 署名设置弹层（头像上传 + 昵称自定义 + 恢复默认） */
  const renderSenderSheet = () =>
    sheet === 'sender' && (
      <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
        <div className="rounded-t-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150 px-5 pb-9 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()} data-testid="sender-sheet">
          <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
          <div className="text-center text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">信封署名</div>
          <div className="mt-1 text-center text-[11px] text-[#b6b6bd] dark:text-zinc-500">自定义信封上的头像与昵称，留空则跟随微信/QQ</div>
          <div className="mt-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => senderFileRef.current?.click()}
              aria-label="更换信封头像"
              className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full border-[3px] border-[#f6dbe2] dark:border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
            >
              <img src={senderAvatarDraft || state.meAvatar || '/icons/couple.png'} alt="信封头像" className="h-full w-full object-cover" draggable={false} />
              <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-[10px] font-medium text-white">更换</span>
            </button>
            <div className="min-w-0 flex-1">
              <label htmlFor="sender-name-input" className="text-[13px] font-semibold text-[#5a5a62] dark:text-zinc-300">
                信封昵称
              </label>
              <input
                id="sender-name-input"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                maxLength={10}
                placeholder={state.meName || '跟随微信/QQ 昵称'}
                className="mt-1.5 h-11 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] text-[#2c2c30] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
                data-testid="sender-name-input"
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                patch({ letterSenderName: '', letterSenderAvatar: '' });
                setSenderName('');
                setSenderAvatarDraft('');
                setSheet(null);
                showToast('已恢复跟随微信/QQ ♡');
              }}
              className="h-11 flex-1 rounded-2xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300"
            >
              恢复默认
            </button>
            <button type="button" onClick={saveSender} className="h-11 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10">
              保存
            </button>
          </div>
        </div>
        <input
          ref={senderFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            e.currentTarget.value = '';
            if (!f) return;
            try {
              setSenderAvatarDraft(await fileToScaledDataURL(f, 600, 0.78));
            } catch {
              showToast('图片处理失败');
            }
          }}
        />
      </div>
    );

  /** 分享给 TA（第十八轮需求38/41）：通用分享选择器选渠道+联系人 → 信封卡片发进会话；恋人才触发 AI 读信留言/回信 */
  const doShareLetter = (channel: CoupleChannel, contactId: string) => {
    const l = state.letters.find((x) => x.id === shareLetterId);
    setShareLetterId(null);
    if (!l) return;
    const meta = readInviteMeta();
    const isPartner = meta.partnerContactId === contactId;
    void (async () => {
      try {
        await sendLetterCard({ channel, contactId, letterId: l.id, envelope: l.envelope ?? envKey, envText: state.letterEnvText, snippet: l.text, dir: 'me' });
      } catch {
        /* 落库失败静默 */
      }
      if (isPartner) {
        // 第十九轮需求46：我写给 TA 的信也要写进 AI 记忆（TA 读信时和之后的对话都能想起信里的内容）
        coupleRemember(contactId, channel, `${meName0}写了一封情书寄给我（开头：${l.text.replace(/\s+/g, ' ').trim().slice(0, 42)}…），把信封卡片发到了${channel === 'wx' ? '微信' : 'QQ'}里`);
        scheduleAiLetterFeedback({ channel, contactId, letterId: l.id, text: l.text, envelope: l.envelope ?? envKey });
        showToast('信已寄出，TA 拆信后会在信下留言、还会给你回信 ♡');
      } else {
        showToast('信已寄出 ♡');
      }
    })();
    patch({ letters: state.letters.map((x) => (x.id === l.id ? { ...x, sharedAt: Date.now() } : x)) });
  };

  /** 顶部栏（深色） */
  const TopBar = ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div className="relative z-30 shrink-0 pt-[54px]">
      <div className="flex h-11 items-center px-1.5">
        <button type="button" onClick={onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-opacity active:opacity-50">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-[54px] flex h-11 -translate-x-1/2 items-center text-[16px] font-bold text-white">{title}</div>
      </div>
    </div>
  );

  // ============ 主视图：信封（第二十八轮封面美化：月亮 + 流星 + 暖光信封 + 呼吸箭头） ============
  if (view === 'home') {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars count={54} />
        {/* 月亮（右上角，带光晕与暗斑） */}
        <div aria-hidden="true" className="pointer-events-none absolute right-[11%] top-[10%] z-[5]">
          <div className="h-[70px] w-[70px] rounded-full bg-[radial-gradient(circle_at_36%_34%,#fff8e8_0%,#f3e2bd_48%,#e6d0a2_100%)] shadow-[0_0_44px_12px_rgba(255,238,200,0.14)]">
            <span className="absolute left-[14%] top-[30%] h-[9px] w-[9px] rounded-full bg-[#ddc79b]/60" />
            <span className="absolute left-[46%] top-[58%] h-[6px] w-[6px] rounded-full bg-[#ddc79b]/50" />
            <span className="absolute left-[62%] top-[24%] h-[4px] w-[4px] rounded-full bg-[#ddc79b]/40" />
          </div>
        </div>
        {/* 流星（缓落） */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[14, 62, 88].map((left, i) => (
            <span key={i} className="absolute h-[3px] w-[3px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] [animation:couple-fall_7s_linear_infinite]" style={{ left: `${left}%`, top: '2%', animationDelay: `${i * 2.6}s` }} />
          ))}
        </div>
        <TopBar title="情书" onBack={close} />
        {/* 信箱入口（第二十轮：原「订单记录」改叫「信箱」） */}
        <button
          type="button"
          onClick={() => setView('box')}
          className="relative z-20 ml-4 mt-2 flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl py-1.5 text-white/90 transition-opacity active:opacity-60"
        >
          <OrderIcon className="h-7 w-7" />
          <span className="text-[11px] font-medium">信箱</span>
        </button>
        {/* 信封 + 文案 */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-9 pb-6">
          <div className="[animation:couple-float-y_5s_ease-in-out_infinite]">
            <NightEnvelope />
          </div>
          <div className="mt-11 w-full text-[20px] font-light leading-[3.4rem] tracking-[0.12em] text-[#8d8d96] dark:text-zinc-400">
            <p>把你想对他说的话</p>
            <p>写成一封信</p>
            <p>现在就寄给他吧</p>
          </div>
          <div aria-hidden="true" className="mt-5 flex items-center gap-2 text-[10px] tracking-[0.5em] text-white/25">
            <span>✦</span>
            <span className="h-px w-16 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <span>✦</span>
          </div>
        </div>
        {/* 底部圆形箭头（呼吸光圈） */}
        <button
          type="button"
          onClick={() => setView('intro')}
          aria-label="下一步"
          className="relative z-20 mx-auto mb-9 flex h-[62px] w-[62px] items-center justify-center rounded-full border border-white/40 transition-transform active:scale-95"
        >
          <span aria-hidden="true" className="absolute inset-[-7px] rounded-full border border-white/15 [animation:couple-twinkle_2.8s_ease-in-out_infinite]" />
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#e8e8ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    );
  }

  // ============ 告白视图：星尘 + 跨越时间的情书 ============
  if (view === 'intro') {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars />
        {/* 星尘飘落 + 星芒爆点 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[18, 32, 55, 70, 84].map((left, i) => (
            <span key={i} className="absolute h-1 w-1 rounded-full bg-white [animation:couple-fall_4.6s_linear_infinite]" style={{ left: `${left}%`, top: '4%', animationDelay: `${i * 1.1}s` }} />
          ))}
          <svg viewBox="0 0 120 120" className="absolute right-[6%] top-[16%] w-44">
            <g transform="translate(66 52)">
              <path d="M0 -17 L3 -3 L17 0 L3 3 L0 17 L-3 3 L-17 0 L-3 -3 Z" fill="#ffffff" />
              <circle r="3.4" fill="#ffffff" />
              <path d="M0 0 L44 6 M0 0 L34 -18 M0 0 L40 22" stroke="#ffffff" strokeWidth="0.9" opacity="0.6" />
              {[[-30, -22], [38, -8], [-24, 26], [30, 30], [10, -30]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.6} fill="#cfcfda" />
              ))}
            </g>
          </svg>
        </div>
        <TopBar title="情书" onBack={() => setView('home')} />
        <div className="relative z-10 flex flex-1 flex-col justify-end px-9 pb-14">
          <div className="text-[20px] font-light leading-[3.4rem] tracking-[0.12em] text-[#9c9ca6] dark:text-zinc-400">
            <p>最浪漫的告白是</p>
            <p>写给他的那封</p>
            <p>装在信封里的手写信</p>
          </div>
          <button
            type="button"
            onClick={() => setView('write')}
            className="mx-auto mt-12 h-[52px] w-[248px] rounded-2xl border border-white/40 text-[16px] text-white/95 shadow-[0_0_24px_rgba(255,255,255,0.07)] transition-transform active:scale-95"
          >
            给他写一封情书
          </button>
          <div className="mt-3.5 text-center text-[12px] text-white/60">(纸质实物情书)</div>
        </div>
      </div>
    );
  }

  // ============ 编辑信件视图（第二十轮重做：纵向连续信纸，下滑即加第二页，不再左右翻页；「xx的来信」页眉标签已删除；第二十八轮：每页信纸同高同容、装饰纹理层、工具栏删手写信+信纸移位；第二十九轮：参考图同款信纸装饰层/画框/题头/方格稿纸，题头信纸正文自动下移避让；
  //  第二十九轮再修「字太往上」：① 无题头信纸顶部内边距 32→52px，字不再顶到日期/画框；
  //  ② 横线周期改为 30px 与行高严格对齐（此前 31px 周期每行漂移 1px），横线基线对齐写字行；
  //  ③ 第四十三轮再修「字太往下」：横线整体下移 3px（padTop-9→padTop-6）；
  //  ④ 第四十四轮再修「日期下整行空置、字低了整整一行」：无题头信纸正文顶部内边距 52→26——正文从日期下第一格横线开始写；
  //  横线只从 y=32（日期下方）起画不再穿过日期；座位 23→24（用户设备字形底部略压线，下移 1px 让字稳稳坐线上）） ============
  if (view === 'write') {
    const padTop = paper.padTop ?? 26; // 无题头信纸：正文从日期下第一格横线开始写（第四十四轮 52→26，删掉浪费的空行；有题头信纸仍用各自 padTop 避让装饰层）
    const lineBg = !paper.grid && dashed && paper.dashed !== undefined
      ? `repeating-linear-gradient(180deg, transparent 0px, transparent 29px, ${paper.line} 29px, ${paper.line} 30px)`
      : undefined;
    const totalChars = pages.reduce((n, p) => n + p.length, 0);
    const focusSafe = Math.min(focusPage, pages.length - 1);
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#101014]">
        <TopBar title="编辑信件" onBack={() => setView('home')} />
        {/* 信纸区：纵向排列多页信纸，写满自动下滑加下一页 / 末尾可手动再添一页 */}
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-3 pb-4 pt-1.5" data-testid="letter-scroll">
          <div className="mx-auto flex w-full max-w-[430px] flex-col gap-3.5">
            {pages.map((ptext, pi) => {
              const pageFull = ptext.length >= LETTER_PAGE_CHARS;
              const isFocus = pi === focusSafe;
              const hasHeader = Boolean(paper.headerQuote || paper.headerScript || paper.headerPets);
              return (
                <div
                  key={pi}
                  className="relative shrink-0 overflow-hidden rounded-md shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
                  style={{ background: paper.bg, height: LETTER_PAGE_HEIGHT, containerType: 'inline-size' }}
                  data-testid={`letter-paper-${pi + 1}`}
                >
                  {/* 横线（方格稿纸信纸用格子纹理替代横线）：只从 y=32（日期下方）起画不穿过日期；座位 24px：第 k 条线 = 正文第 k 行盒顶+24 ≈ 字形底部，文字坐线上（第四十四轮；题头信纸 padTop 56/62 同公式自适应） */}
                  {lineBg && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: 32, backgroundImage: lineBg, backgroundPosition: `0 ${padTop - 37}px` }} />}
                  {/* 信纸自带装饰纹理（第二十八轮：蕾丝点/樱花点/格纹/斜纹等） */}
                  {paper.deco && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: paper.deco, backgroundSize: paper.decoSize }} />}
                  {/* 参考图同款装饰层（画框/衔纸鸽/题头/小鱼骨条/英文小字；第二十九轮） */}
                  <PaperDeco p={paper} />
                  {/* 首页右上角日期（第二十轮：「xx的来信」标签删除，仅留日期；有题头的信纸日期下移避让） */}
                  {pi === 0 && (
                    <div className={`pointer-events-none absolute right-4 z-[5] text-[11.5px] ${hasHeader ? 'top-[7.4%]' : 'top-2.5'}`} style={{ color: paper.dark ? 'rgba(216,222,238,0.5)' : 'rgba(90,74,56,0.5)' }}>
                      {`${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`}
                    </div>
                  )}
                  <textarea
                    value={ptext}
                    onChange={(e) => setPageTextAt(pi, e.target.value)}
                    onFocus={() => setFocusPage(pi)}
                    placeholder={pi === 0 ? '写下你想说的话…' : '这一页接着写…'}
                    className="letter-pad absolute inset-0 h-full w-full resize-none bg-transparent px-5 pb-10 leading-[30px] tracking-[0.5px] outline-none"
                    style={{ fontFamily: font.css, fontSize, color, caretColor: color, paddingTop: padTop }}
                  />
                  {/* 工具开关 chip（只在正在编辑的页显示） */}
                  {isFocus && (
                    <button
                      type="button"
                      onClick={() => setToolsOpen((v) => !v)}
                      className={`absolute right-2 z-10 rounded-md bg-[#2c2c30] px-2.5 py-1 text-[12.5px] font-medium text-white shadow-sm ${hasHeader ? 'top-[13%]' : 'top-10'}`}
                    >
                      工具 {toolsOpen ? '˄' : '˅'}
                    </button>
                  )}
                  {/* 右侧工具栏（第二十八轮：手写信入口删除，「信纸」从底部移到原来手写信的位置；顺序：虚线/信纸/字体/信封/回执） */}
                  {isFocus && toolsOpen && (
                    <div className="absolute right-2.5 top-[64px] z-10 flex flex-col gap-2.5">
                      <button type="button" onClick={() => setDashed((v) => !v)} className={`h-[54px] w-9 rounded-lg text-[12.5px] font-bold leading-[1.15] text-white shadow-md transition-colors ${dashed ? 'bg-[#2c2c30]' : 'bg-[#9a9aa2]'}`} style={{ writingMode: 'vertical-rl' }}>
                        虚线
                      </button>
                      <button type="button" onClick={() => setSheet('paper')} className="relative h-[54px] w-9 rounded-lg border border-[#e8cdb2] bg-[#fdf8ec] text-[12.5px] font-bold leading-[1.15] text-[#2f6b3f] shadow-md" style={{ writingMode: 'vertical-rl' }}>
                        信纸
                        <span aria-hidden="true" className="absolute -top-1 right-1 h-1.5 w-1.5 rounded-full bg-[#e05a6d]" />
                      </button>
                      <button type="button" onClick={() => setSheet('font')} className="h-[54px] w-9 rounded-lg bg-[#9a9aa2] text-[12.5px] font-bold leading-[1.15] text-white shadow-md" style={{ writingMode: 'vertical-rl' }}>
                        字体
                      </button>
                      <button type="button" onClick={() => setSheet('env')} className="relative h-[54px] w-9 overflow-hidden rounded-lg shadow-md" aria-label="选择信封样式">
                        <EnvelopeArt envKey={envKey} className="h-full w-full" pets={false} faceText={envText} />
                        <span className="absolute inset-x-0 bottom-0 bg-black/35 py-px text-center text-[10.5px] font-bold leading-[1.15] text-white" style={{ writingMode: 'vertical-rl' }}>
                          信封
                        </span>
                      </button>
                      <button type="button" onClick={() => { setReceipt((v) => !v); showToast(receipt ? '已关闭回执' : '已开启回执：TA 拆信时会通知你'); }} className={`h-[54px] w-9 rounded-lg text-[12.5px] font-bold leading-[1.15] text-white shadow-md transition-colors ${receipt ? 'bg-[#2c2c30]' : 'bg-[#9a9aa2]'}`} style={{ writingMode: 'vertical-rl' }}>
                        回执
                      </button>
                    </div>
                  )}
                  {/* 页脚：本页计数 + 页码（第二十八轮起每页容量一致） */}
                  <div className="pointer-events-none absolute bottom-2.5 left-4 text-[11.5px]" style={{ color: pageFull ? '#e05a6d' : paper.dark ? 'rgba(216,222,238,0.55)' : 'rgba(90,74,56,0.55)' }}>
                    {`${ptext.length}/${LETTER_PAGE_CHARS}`}
                  </div>
                  <div className="pointer-events-none absolute bottom-2.5 right-4 text-[12px]" style={{ color: paper.dark ? 'rgba(216,222,238,0.55)' : 'rgba(90,74,56,0.55)' }}>
                    {`第 ${pi + 1} 页`}
                  </div>
                </div>
              );
            })}
            {/* 信纸末尾：再添一页（下滑到这里加第二页/第N页） */}
            {pages.length < LETTER_MAX_PAGES && (
              <button
                type="button"
                onClick={addPage}
                data-testid="letter-add-page"
                className="mx-auto mb-1 flex h-10 items-center gap-1.5 rounded-2xl border border-white/20 bg-white/[0.06] px-5 text-[13px] text-white/85 transition-transform active:scale-95"
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                再添一页
              </button>
            )}
          </div>
        </div>
        {/* 底部操作栏：存草稿 · 下一步（第二十轮：页码导航移除，页码显示在每张信纸上；第五十七轮：删「AI 帮我写」——
            情书由 TA 自己根据人设/共享记忆/记忆碎片/最近聊天主动写来寄（couple-ai.ts aiTickLetter）） */}
        <div className="relative z-20 flex shrink-0 items-center gap-2.5 border-t border-white/8 bg-[#141419] px-4 pb-7 pt-3.5">
          <button
            type="button"
            onClick={() => {
              patch({ letterDraft: JSON.stringify(pages) });
              showToast(totalChars > 0 ? '草稿已保存' : '已清空草稿');
            }}
            className="h-[46px] flex-1 rounded-2xl border border-white/25 text-[15.5px] font-medium text-white/90 transition-transform active:scale-[0.97]"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={() => {
              if (!fullText()) {
                showToast('先写点什么吧 ♡');
                return;
              }
              patch({ letterDraft: JSON.stringify(pages) });
              setView('send');
            }}
            className="h-[46px] flex-[1.6] rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.97]"
          >
            下一步
          </button>
        </div>
        {renderSheets()}
        {renderSenderSheet()}
      </div>
    );
  }

  // ============ 发送设置视图（第二十轮调整：信封预览=真实信封样式（头像火漆位居中），「拆信设置」改「寄出方式：定时发出/即时发出」，按钮文字同一行，「设置头像/昵称」可自定义） ============
  if (view === 'send') {
    const timed = sendMode === 'timed';
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars count={26} />
        <TopBar title="发送设置" onBack={() => setView('write')} />
        <div className="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 pb-8">
          {/* 信封预览卡 = 真实信封本身（头像作为火漆印盖在封口尖角正中；点击可设置头像/昵称） */}
          <button
            type="button"
            onClick={() => {
              setSenderName((state.letterSenderName || '').trim());
              setSenderAvatarDraft(state.letterSenderAvatar || '');
              setSheet('sender');
            }}
            aria-label="设置信封头像/昵称"
            className="relative mx-auto mt-2 block w-full overflow-hidden rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.45)] transition-transform active:scale-[0.99]"
            data-testid="send-envelope-preview"
          >
            <EnvelopeArt envKey={envKey} className="h-[196px] w-full" avatar={senderAvatar} faceText={envText} />
          </button>

          {/* 设置行组（信封设置/收信效果/背景音乐/寄出方式） */}
          <div className="mt-4 divide-y divide-white/8 rounded-2xl border border-white/10 bg-white/[0.05]">
            {/* 信封设置（第二十轮：按钮文字不换行，同一行展示） */}
            <div className="flex items-center gap-2 px-4 py-3.5">
              <span className="w-[76px] shrink-0 text-[15px] font-semibold text-white">信封设置</span>
              <div className="flex flex-1 justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSenderName((state.letterSenderName || '').trim());
                    setSenderAvatarDraft(state.letterSenderAvatar || '');
                    setSheet('sender');
                  }}
                  data-testid="sender-open"
                  className="h-9 whitespace-nowrap rounded-lg bg-white/10 px-3 text-[13px] font-medium text-[#4ade80]"
                >
                  设置头像/昵称
                </button>
                <button type="button" onClick={() => setSheet('env')} data-testid="send-set-envelope" className="h-9 whitespace-nowrap rounded-lg bg-white/10 px-3.5 text-[13px] font-medium text-[#4ade80]">
                  换信封
                </button>
              </div>
            </div>
            {/* 信封上的字（第四十三轮：从选择信封弹窗移到这里；实时同步到上方信封预览与寄出的信封） */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-[76px] shrink-0 text-[15px] font-semibold text-white">信封上的字</span>
              <input
                value={envText}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 10);
                  setEnvText(v);
                  patch({ letterEnvText: v });
                }}
                maxLength={10}
                placeholder="致 最爱的你"
                aria-label="信封上的字"
                data-testid="env-text-input"
                className="h-9 min-w-0 flex-1 rounded-lg bg-white/10 px-3 text-[13.5px] text-white outline-none ring-1 ring-white/15 focus:ring-white/40 placeholder:text-white/35"
              />
              {envText && (
                <button
                  type="button"
                  onClick={() => {
                    setEnvText('');
                    patch({ letterEnvText: '' });
                  }}
                  className="shrink-0 text-[12px] font-medium text-[#4ade80]"
                >
                  恢复默认
                </button>
              )}
            </div>
            {/* 收信效果 */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="w-[76px] shrink-0 text-[15px] font-semibold text-white">收信效果</span>
              <span className="flex-1 text-right text-[13px] text-[#87878f] dark:text-zinc-400">飘落 · 音效 · 动画</span>
              <button type="button" onClick={() => showToast('TA 拆信时：信封飘落 + 星光动画 ♡')} className="h-9 shrink-0 whitespace-nowrap rounded-lg bg-white/10 px-3.5 text-[13px] font-medium text-[#4ade80]">
                预览设置
              </button>
            </div>
            {/* 背景音乐 */}
            <button type="button" onClick={() => showToast('背景音乐即将上线 ♡')} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <span className="w-[76px] shrink-0 text-[15px] font-semibold text-white">背景音乐</span>
              <span className="flex flex-1 items-center justify-end gap-1 text-[13.5px] text-[#87878f] dark:text-zinc-400">
                不使用
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 6l6 6-6 6" />
                </svg>
              </span>
            </button>
            {/* 寄出方式（第二十轮：原「拆信设置」改为「定时发出 / 即时发出」） */}
            <div className="px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="w-[76px] shrink-0 text-[15px] font-semibold text-white">寄出方式</span>
                <div className="flex flex-1 justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSendMode('timed')}
                    data-testid="send-mode-timed"
                    className={`h-9 whitespace-nowrap rounded-lg px-4 text-[13.5px] font-semibold transition-colors ${timed ? 'bg-[#2c2c30] text-white' : 'bg-white/10 text-[#b9b9c4]'}`}
                  >
                    定时发出
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendMode('now')}
                    data-testid="send-mode-now"
                    className={`h-9 whitespace-nowrap rounded-lg px-4 text-[13.5px] font-semibold transition-colors ${!timed ? 'bg-[#2c2c30] text-white' : 'bg-white/10 text-[#b9b9c4]'}`}
                  >
                    即时发出
                  </button>
                </div>
              </div>
              {timed && (
                <div className="mt-3.5">
                  <div className="flex gap-2">
                    {[7, 30, 100, 365].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setAfter(d)}
                        className={`h-10 flex-1 whitespace-nowrap rounded-xl border text-[13.5px] transition-colors ${after === d ? 'border-white bg-white/15 font-bold text-white' : 'border-white/15 text-[#9c9ca6]'}`}
                      >
                        {d} 天
                      </button>
                    ))}
                  </div>
                  <div className="mt-2.5 text-center text-[12px] text-[#6e6e78] dark:text-zinc-300">
                    {`${meName0}的这封信将在 ${after} 天后送达 · 预计 ${arriveDate.getFullYear()}年${arriveDate.getMonth() + 1}月${arriveDate.getDate()}日 可拆`}
                  </div>
                </div>
              )}
              {!timed && <div className="mt-2.5 text-right text-[12px] text-[#6e6e78] dark:text-zinc-300">寄出后 TA 打开信箱即可立即拆信</div>}
            </div>
          </div>

          {/* 寄出按钮 */}
          <button
            type="button"
            onClick={sendLetter}
            data-testid="send-letter-btn"
            className="mt-6 h-[50px] w-full shrink-0 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.97]"
          >
            {timed ? `定时寄出（${after} 天后送达）` : '立即寄出这封信'}
          </button>
          <div className="mt-3 text-center text-[12px] text-white/45">
            {timed ? '到时会提醒 TA 拆开，信在路上也会想你 ♡' : '信封会带着今天的日期，飞到 TA 的信箱 ♡'}
          </div>
        </div>
        {renderSheets()}
        {renderSenderSheet()}
      </div>
    );
  }

  // ============ 单独阅读界面（第二十轮：信箱/聊天卡片点进的是独立界面，里面是信的内容；对照参考图「无忧的来信」阅读页：浅粉背景 + 米色信纸 + 日期/页码 + 去写信/回信） ============
  if (view === 'read') {
    const lTa = readFrom === 'ta' ? state.aiLetters.find((x) => x.id === readId) : undefined;
    const lMe = readFrom === 'me' ? state.letters.find((x) => x.id === readId) : undefined;
    if (!lTa && !lMe) {
      return (
        <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
          <LetterStars count={30} />
          <TopBar title="信箱" onBack={() => setView('home')} />
          <div className="flex flex-1 items-center justify-center text-[14px] text-[#6e6e78] dark:text-zinc-300">这封信已经不在信箱里了</div>
        </div>
      );
    }
    // 归一化（TA 的信没有 openAfterDays/sharedAt：视为即时可拆）
    const l = lTa
      ? { id: lTa.id, text: lTa.text, at: lTa.at, envelope: lTa.envelope, openAfterDays: 0, sharedAt: undefined as number | undefined }
      : { id: lMe!.id, text: lMe!.text, at: lMe!.at, envelope: lMe!.envelope, openAfterDays: lMe!.openAfterDays, sharedAt: lMe!.sharedAt };
    // 全文按每页 200 字分页（对照参考图「当前：第1/2页」）
    const readPages: string[] = [];
    for (let i = 0; i < l.text.length; i += LETTER_PAGE_CHARS) readPages.push(l.text.slice(i, i + LETTER_PAGE_CHARS));
    const totalPages = Math.max(1, readPages.length);
    const page = Math.min(readPage, totalPages - 1);
    const locked = readFrom === 'me' && !arrived(l);
    const remainR = Math.max(1, Math.ceil((l.at + l.openAfterDays * 86400000 - now) / 86400000));
    const who = readFrom === 'ta' ? state.taName || 'TA' : meName0;
    const greet = readFrom === 'ta' ? meName0 : state.taName || 'TA';
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#fbeef1_0%,#f8e3e8_55%,#f5d9e0_100%)] dark:bg-[linear-gradient(180deg,#1c1418_0%,#171117_55%,#130f14_100%)]">
        {/* 顶部栏（浅色版）：返回 + 来信标题 + 分享 */}
        <div className="relative z-30 shrink-0 pt-[54px]">
          <div className="flex h-11 items-center px-1.5">
            <button type="button" onClick={() => setView('box')} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#5c4a50] dark:text-rose-300/80 transition-opacity active:opacity-50">
              <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <div className="pointer-events-none absolute left-1/2 top-[54px] flex h-11 -translate-x-1/2 items-center text-[16px] font-bold text-[#4a3a40] dark:text-rose-200/75">{`${who}的来信`}</div>
            {readFrom === 'me' && !l.sharedAt && (
              <button type="button" onClick={() => setShareLetterId(l.id)} className="ml-auto mr-2 flex h-9 items-center gap-1 rounded-xl border border-[#e3e3e8] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3.5 text-[13px] font-medium text-[#4a4a52] dark:text-zinc-200">
                <ArrowUp className="h-3.5 w-3.5" />
                分享
              </button>
            )}
          </div>
          <div className="mt-1 px-5 text-[11.5px] text-[#bb959d] dark:text-rose-200/75">✉ 一封来信，一份心意</div>
        </div>
        {/* 信纸（米色 + 虚线行 + 称呼 + 正文 + 日期/页码；第二十九轮：正文位置下移（字不再顶到纸上沿）+
            横线与行高 30px 对齐 + 应用编辑器选的字体/字号/字色——阅读页与编辑页所见即所得） */}
        <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <div className="relative mx-auto max-w-[430px] overflow-hidden rounded-xl bg-[#fdf9ef] shadow-[0_12px_30px_rgba(140,90,100,0.18)]" data-testid="letter-read-paper">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(180deg, transparent 0px, transparent 29px, rgba(210,180,140,0.5) 29px, rgba(210,180,140,0.5) 30px)`, backgroundPosition: '0 70px' }} />
            <div className="relative px-5 pb-2 pt-8">
              <div className="text-[15.5px] font-semibold text-[#4a3f34]">{`亲爱的${greet}`}</div>
              <div
                className="mt-1.5 whitespace-pre-wrap leading-[30px] tracking-[0.5px] text-[#4a4238]"
                style={{ minHeight: 240, fontFamily: font.css, fontSize, color, paddingTop: 14 }}
                data-testid="letter-read-body"
              >
                {locked ? '' : readPages[page]}
              </div>
            </div>
            {/* 底部：日期 + 页码（对照参考图「当前：第1/2页」） */}
            <div className="relative flex items-center justify-between px-5 pb-3.5">
              <span className="text-[11.5px] text-[#a58f76]">{fmtDate(l.at)}</span>
              <span className="text-[12px] text-[#a58f76]">{`当前：第${page + 1}/${totalPages}页`}</span>
            </div>
            {/* 定时信未到期：遮罩 + 提示 */}
            {locked && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#fdf9ef]/75 backdrop-blur-[3px]" data-testid="read-locked">
                <EnvelopeArt envKey={l.envelope} className="h-[92px] w-[120px]" pets={false} faceText={readFrom === 'me' ? state.letterEnvText : undefined} />
                <p className="mt-4 text-[14px] font-medium text-[#8a6a58]">这封信还在时间的路上</p>
                <p className="mt-1 text-[12px] text-[#b09a84]">{`还剩 ${remainR} 天就能拆开了 ♡`}</p>
              </div>
            )}
          </div>
          {/* 页码切换（多页信） */}
          {totalPages > 1 && !locked && (
            <div className="mx-auto mt-3 flex max-w-[430px] items-center justify-center gap-5 rounded-full bg-white/60 dark:bg-zinc-800/70 py-2">
              <button type="button" onClick={() => setReadPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="上一页" className="flex h-8 w-8 items-center justify-center rounded-full text-[#7a5a50] dark:text-zinc-400 disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14.5 6 8.5 12l6 6" />
                </svg>
              </button>
              <span className="min-w-[56px] text-center text-[13px] font-medium text-[#7a5a50] dark:text-zinc-400">{`${page + 1} / ${totalPages}`}</span>
              <button type="button" onClick={() => setReadPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} aria-label="下一页" className="flex h-8 w-8 items-center justify-center rounded-full text-[#7a5a50] dark:text-zinc-400 disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
          {/* 信下留言（TA 的信 / 已寄给 TA 的信；全部进 AI 记忆） */}
          {(readFrom === 'ta' || (readFrom === 'me' && l.sharedAt)) && (
            <div className="mx-auto mt-3 max-w-[430px] rounded-2xl bg-white/75 dark:bg-zinc-800/80 p-2.5 shadow-[0_6px_18px_rgba(140,90,100,0.12)]">
              <CommentThread state={state} patch={(p) => patch(typeof p === 'function' ? p(state) : p)} threadKey={`letter:${l.id}`} hint="给这封信留一句话" testId="letter-read-comments" />
            </div>
          )}
        </div>
        {/* 底部操作栏（对照参考图：去写信 + 回信） */}
        <div className="relative z-20 flex shrink-0 items-center gap-3 border-t border-black/[0.06] dark:border-white/10 bg-white/85 dark:bg-zinc-800/90 px-4 pb-7 pt-3.5 backdrop-blur">
          <button type="button" onClick={() => setView('write')} className="h-[46px] flex-1 rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[15.5px] font-medium text-[#4a4a52] dark:text-zinc-200">
            去写信
          </button>
          {readFrom === 'me' && !l.sharedAt ? (
            <button type="button" onClick={() => setShareLetterId(l.id)} data-testid="read-share-btn" className="h-[46px] flex-[1.6] rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.97]">
              {`分享给${state.taName || 'TA'}`}
            </button>
          ) : (
            <button type="button" onClick={() => setView('write')} data-testid="read-reply-btn" className="h-[46px] flex-[1.6] rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.97]">
              回信
            </button>
          )}
        </div>
        {shareLetterId && <ShareChannelPicker title="分享这封情书" hint="选择用哪个 App 寄出，再选联系人" onSend={doShareLetter} onClose={() => setShareLetterId(null)} />}
      </div>
    );
  }

  // ============ 信箱（第二十轮改版：列表显示信封样式，点进去是单独的阅读界面） ============
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
      <LetterStars count={30} />
      <TopBar title="信箱" onBack={() => setView('home')} />
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {/* TA 寄给我的信（信封样式卡片；点击进单独阅读界面） */}
        {state.aiLetters.length > 0 && (
          <>
            <div className="px-1 pb-2.5 pt-3 text-[13px] font-semibold text-[#9c9ca6] dark:text-zinc-400">{state.taName || 'TA'} 寄给我的信</div>
            <div className="space-y-4">
              {state.aiLetters.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => openRead(l.id, 'ta')}
                  data-testid={`box-ta-${l.id}`}
                  className="relative block w-full overflow-hidden rounded-2xl text-left shadow-[0_10px_26px_rgba(0,0,0,0.42)] transition-transform active:scale-[0.985]"
                >
                  <EnvelopeArt envKey={l.envelope} className="h-[132px] w-full" avatar={state.taAvatar} />
                  {/* 第二十一轮：左上角「xx的来信」标签删除；底部只显示时间；第二十八轮：角标移到左上角，不再遮住右上角恋人邮局邮戳文字 */}
                  <span className="absolute left-3 top-3 z-10 rounded-full bg-[#2c2c30] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">可拆信</span>
                  <span className="absolute inset-x-0 bottom-0 z-10 block bg-gradient-to-t from-black/60 to-transparent px-3.5 pb-2.5 pt-7">
                    <span className="block truncate text-[12px] font-medium tabular-nums text-white/90">{fmtMDHM(l.at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 我寄出的信（信封样式卡片；未到期显示剩余天数） */}
        <div className="px-1 pb-2.5 pt-4 text-[13px] font-semibold text-[#9c9ca6] dark:text-zinc-400">我寄出的信</div>
        {state.letters.length === 0 && state.aiLetters.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] py-10 text-center">
            <NightEnvelope />
            <p className="mt-6 text-[15px] text-[#87878f] dark:text-zinc-400">还没有寄出的信</p>
            <p className="mt-1.5 text-[13px] text-[#5d5d66] dark:text-zinc-300">去写第一封装进信封的情书吧</p>
            <button type="button" onClick={() => setView('write')} className="mt-6 h-11 rounded-2xl border border-white/35 px-8 text-[14.5px] text-white/90">
              去写信
            </button>
          </div>
        )}
        {state.letters.length === 0 && state.aiLetters.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] py-8 text-center text-[13px] text-[#6e6e78] dark:text-zinc-300">还没写过信，去写第一封吧</div>
        )}
        <div className="space-y-4">
          {state.letters.map((l) => {
            const open = arrived(l);
            const instant = l.openAfterDays === 0;
            const remain = Math.max(1, Math.ceil((l.at + l.openAfterDays * 86400000 - now) / 86400000));
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => openRead(l.id, 'me')}
                data-testid={`box-me-${l.id}`}
                className="relative block w-full overflow-hidden rounded-2xl text-left shadow-[0_10px_26px_rgba(0,0,0,0.42)] transition-transform active:scale-[0.985]"
              >
                <EnvelopeArt envKey={l.envelope ?? envKey} className="h-[132px] w-full" avatar={senderAvatar} faceText={state.letterEnvText} />
                {/* 第二十一轮：左上角署名标签删除；底部只显示时间；第二十八轮：角标移到左上角，不再遮住右上角恋人邮局邮戳文字 */}
                <span className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${open ? 'bg-[#2c2c30] text-white' : 'bg-black/38 text-white/90'}`}>
                  {open ? '可拆信' : instant ? '定时中' : `还剩 ${remain} 天`}
                </span>
                <span className="absolute inset-x-0 bottom-0 z-10 block bg-gradient-to-t from-black/60 to-transparent px-3.5 pb-2.5 pt-7">
                  <span className="block truncate text-[12px] font-medium tabular-nums text-white/90">{fmtMDHM(l.at)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setView('write')}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/25 text-[15px] text-white/90"
        >
          <Plus className="h-4.5 w-4.5" strokeWidth={2} />
          再写一封
        </button>
      </div>

      {/* 通用分享选择器（第十八轮需求41） */}
      {shareLetterId && <ShareChannelPicker title="分享这封情书" hint="选择用哪个 App 寄出，再选联系人" onSend={doShareLetter} onClose={() => setShareLetterId(null)} />}
    </div>
  );
}


/** 心情日记（对照用户截图重做）：大月历心情球视图 + 全部日记列表 + 日记详情 + 写日记编辑页 */
function MoodPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const now0 = new Date();
  const [view, setView] = useState<'cal' | 'write' | 'list' | 'detail'>('cal');
  const [cursor, setCursor] = useState({ y: now0.getFullYear(), m: now0.getMonth() });
  const [selDate, setSelDate] = useState(todayKey());
  const [mood, setMood] = useState('');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const me = state.meName || '我';
  const ta = state.taName || 'TA';
  const todayK = todayKey();

  /** 按日期分组（兼容旧数据：无 dateKey 时从 at 推导）；每天内部我写的排最前（用户要求：我弄了先显示我的，我没弄才显示 TA 的） */
  const byDay = useMemo(() => {
    const map: Record<string, { emoji: string; label: string; id: string; from?: 'me' | 'ta' }[]> = {};
    for (const m of state.moods) {
      const k = m.dateKey || fmtDate(m.at);
      const meta = MOOD_LIST.find((x) => x.emoji === m.emoji);
      (map[k] ||= []).push({ emoji: m.emoji, label: meta?.label || '心情', id: m.id, from: m.from });
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.from === 'ta' ? 1 : 0) - (b.from === 'ta' ? 1 : 0));
    return map;
  }, [state.moods]);

  /** 月历格子（周一起始） */
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const arr: ({ d: number; key: string } | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d++) {
      arr.push({ d, key: `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    return arr;
  }, [cursor]);

  /** 当月日记（列表用；同一天我写的排前面——用户要求：我写了先显示我的，我没写才显示 TA 的） */
  const monthMoods = useMemo(() => {
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    const arr = state.moods.filter((m) => (m.dateKey || fmtDate(m.at)).startsWith(prefix));
    return [...arr].sort((a, b) => {
      const ka = a.dateKey || fmtDate(a.at);
      const kb = b.dateKey || fmtDate(b.at);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return (a.from === 'ta' ? 1 : 0) - (b.from === 'ta' ? 1 : 0);
    });
  }, [state.moods, cursor]);

  /** TA 今天是否已写日记（没写 → 显示「戳一下他」气泡） */
  const taWroteToday = state.moods.some((m) => m.from === 'ta' && (m.dateKey || fmtDate(m.at)) === todayK);
  const detailEntry = detailId ? state.moods.find((m) => m.id === detailId) : null;

  const openWrite = (key: string) => {
    if (key > todayKey()) {
      showToast('不能写未来的日子哦');
      return;
    }
    setSelDate(key);
    setMood('');
    setText('');
    setPhoto(null);
    setView('write');
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setView('detail');
  };

  /** 戳一下 TA：让 TA 现在去写日记（AI 立刻动笔，2~4s 后出现） */
  const pokeTa = () => {
    const ok = pokeTaDiary();
    showToast(ok ? '已戳 TA，TA 这就去写日记啦' : 'TA 今天已经写过日记啦');
  };

  const pickPhoto = async (f: File | null) => {
    if (!f) return;
    try {
      setPhoto(await fileToScaledDataURL(f, 900, 0.72));
    } catch {
      showToast('图片处理失败');
    }
  };

  const saveMood = () => {
    if (!mood) {
      showToast('先选一个心情吧');
      return;
    }
    const d = new Date(`${selDate}T12:00:00`);
    patch({
      moods: [{ id: uid(), emoji: mood, text: text.trim(), at: d.getTime(), photo, dateKey: selDate }, ...state.moods],
    });
    showToast('心情已记录 ♡');
    setView('cal');
  };

  const editEntry = (key: string) => {
    const entry = state.moods.find((m) => (m.dateKey || fmtDate(m.at)) === key);
    if (entry) {
      setSelDate(key);
      setMood(entry.emoji);
      setText(entry.text);
      setPhoto(entry.photo ?? null);
      setView('write');
    } else {
      openWrite(key);
    }
  };

  // ---------- 写日记视图（编辑页沿用；保存按钮改粉渐变与日记主题呼应） ----------
  if (view === 'write') {
    const [sy, sm] = [Number(selDate.slice(0, 4)), Number(selDate.slice(5, 7))];
    const isToday = selDate === todayKey();
    const selLabel = MOOD_LIST.find((m) => m.emoji === mood)?.label;
    return (
      <SubShell title="心情日记" onBack={() => setView('cal')}>
        <div className="mt-3 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 pb-4 pt-4 shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
          {/* 日期头 */}
          <div className="flex items-baseline gap-2 border-b border-black/[0.05] dark:border-white/10 pb-3">
            <span className="text-[22px] font-bold leading-none text-[#2c2c30] dark:text-zinc-100">{isToday ? '今天' : selDate}</span>
            <span className="text-[12px] text-[#9a9aa2] dark:text-zinc-400">{sm}月,{sy}</span>
          </div>

          {/* 当前选中心情大表情（蜡笔涂鸦风） */}
          <div className="mt-4 flex justify-center">
            <MoodFace mood={mood} size={78} className={mood ? 'drop-shadow-[0_6px_14px_rgba(0,0,0,0.12)]' : 'opacity-55'} />
          </div>
          <div className="mt-1.5 text-center text-[11.5px] font-medium text-[#8e8e96] dark:text-zinc-400">{mood ? `今天很${selLabel}` : '选一个心情，开始记录今天'}</div>

          {/* 心情选择圈 */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {MOOD_LIST.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setMood(m.emoji)}
                aria-pressed={mood === m.emoji}
                className={`flex flex-col items-center gap-1 rounded-2xl py-2 transition-all ${mood === m.emoji ? 'bg-[#fdeef1] dark:bg-rose-300/10 shadow-[inset_0_1px_4px_rgba(242,83,106,0.10)]' : 'active:bg-[#f6f6f8] dark:active:bg-zinc-900/70'}`}
              >
                <MoodFace mood={m.emoji} size={38} className={mood === m.emoji ? '[animation:couple-pop-heart_.4s_ease-out]' : 'opacity-90'} />
                <span className={`text-[10px] ${mood === m.emoji ? 'font-semibold text-[#f2536a]' : 'text-[#8e8e96] dark:text-zinc-400'}`}>{m.label}</span>
              </button>
            ))}
          </div>

          {/* 正文（无框直书） */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天想写些什么"
            maxLength={300}
            rows={4}
            className="mt-3 w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-[#c2c2c9] dark:placeholder:text-zinc-500"
          />

          {/* 照片 tile */}
          <div className="mt-1 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => (photo ? setPhoto(null) : photoInput.current?.click())}
              className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#b6b6bd] dark:text-zinc-500 transition-opacity active:opacity-70"
              aria-label={photo ? '移除照片' : '添加照片'}
            >
              {photo ? (
                <>
                  <img src={photo} alt="心情照片" className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white">✕</span>
                </>
              ) : (
                <ImagePlus className="h-6 w-6" strokeWidth={1.6} />
              )}
            </button>
            <span className="text-[11.5px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">{photo ? '点击照片可移除' : '配一张今天的照片吧'}</span>
          </div>

          {/* 位置行 */}
          <div className="mt-3 flex items-center gap-2 rounded-full bg-[#f5f5f7] dark:bg-zinc-900/70 py-2.5 pl-4 pr-3">
            <MapPin className="h-4 w-4 shrink-0 text-[#8e8e96] dark:text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#4a4a52] dark:text-zinc-200">{state.meetPlace || '还没有相遇地点'}</span>
            {state.meetPlace && (
              <button
                type="button"
                onClick={() => {
                  patch({ meetPlace: '' });
                  showToast('已清除地点，可在情侣轨迹重新设置');
                }}
                aria-label="清除地点"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dcdce1] text-[11px] leading-none text-white"
              >
                ✕
              </button>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-[#c2c2c9] dark:text-zinc-500" />
          </div>
        </div>

        {/* 吸底完成按钮 */}
        <button
          type="button"
          onClick={saveMood}
          className="sticky bottom-4 z-10 mb-3 mt-5 h-12 w-full rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[15px] font-semibold text-white shadow-[0_6px_18px_rgba(242,83,106,0.32)] transition-transform active:scale-[0.98]"
        >
          完成
        </button>

        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pickPhoto(e.target.files?.[0] ?? null);
            e.currentTarget.value = '';
          }}
        />
      </SubShell>
    );
  }

  // ---------- 日记详情视图（参考截图3：头像+时间地点 + 大表情 + 正文 + 留言区 + 会员条） ----------
  if (view === 'detail' && detailEntry) {
    const isTa = detailEntry.from === 'ta';
    const author = isTa ? ta : me;
    const avatar = isTa ? state.taAvatar : state.meAvatar;
    const timeLabel = timeAgoLabel(detailEntry.at);
    const loc = (state.myLoc?.name ?? '').trim();
    return (
      <SubShell title="心情日记" onBack={() => setView('list')}>
        {/* 作者行 */}
        <div className="mt-3 flex items-center gap-3 px-1">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80 shadow-sm ring-1 ring-white">
            {avatar ? <img src={avatar} alt={author} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold leading-tight text-[#2c2c30] dark:text-zinc-100">{author}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-[#a9a9b2] dark:text-zinc-400">
              {timeLabel}
              {loc ? `  在${loc}发布` : ''}
            </div>
          </div>
        </div>

        {/* 大表情 + 正文 */}
        <div className="mt-5 flex justify-center">
          <MoodFace mood={detailEntry.emoji} size={92} className="drop-shadow-[0_8px_18px_rgba(0,0,0,0.14)]" />
        </div>
        <div className="mt-4 px-1 text-[16.5px] leading-relaxed text-[#2c2c30] dark:text-zinc-100">{detailEntry.text || '（这一天没说话，就是心情不好不坏）'}</div>
        {detailEntry.photo && <img src={detailEntry.photo} alt="心情照片" className="mt-3 w-full rounded-2xl object-cover" draggable={false} />}

        {/* 操作行（分享/评论/更多，参考截图3 右对齐） */}
        <div className="mt-3 flex items-center justify-end gap-5 px-1 text-[#8e8e96] dark:text-zinc-400">
          <Share2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <MessageSquare className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <MoreVertical className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </div>

        {/* 留言区（双向；TA 回复贴合人设记忆且不用 emoji） */}
        <div className="mt-4 border-t border-dashed border-[#e9e9ee] dark:border-white/10 pt-4">
          <CommentThread
            state={state}
            patch={patch as unknown as PatchFn}
            threadKey={`mood:${detailEntry.id}`}
            hint={isTa ? `在 ${ta} 的日记下留言` : '这篇日记的留言'}
            testId={`mood-comment-${detailEntry.id}`}
          />
        </div>
      </SubShell>
    );
  }

  // ---------- 全部日记列表视图（参考截图2：大日期卡 + 对方未读 + 居中表情 + 作者行） ----------
  if (view === 'list') {
    return (
      <SubShell title="心情日记" onBack={() => setView('cal')}>
        <div className="mt-2 flex items-center justify-between px-1">
          <button type="button" className="flex items-center gap-1 text-[20px] font-extrabold text-[#2c2c30] dark:text-zinc-100" onClick={() => setView('cal')} aria-label="回到月历">
            {cursor.y}.{String(cursor.m + 1).padStart(2, '0')}
            <ChevronDown className="h-4 w-4 text-[#6e6e76] dark:text-zinc-300" />
          </button>
          <span className="text-[13.5px] font-semibold text-[#26262b] dark:text-zinc-100">全部日记</span>
        </div>

        <div className="mt-3 space-y-3 pb-4">
          {monthMoods.length === 0 && <div className="rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl py-10 text-center text-[13px] text-[#b6b6bd] dark:text-zinc-500 shadow-sm">这个月还没有日记，去写一篇吧</div>}
          {monthMoods.map((m) => {
            const d = new Date(`${m.dateKey || fmtDate(m.at)}T12:00:00`);
            const isToday = (m.dateKey || fmtDate(m.at)) === todayK;
            const author = m.from === 'ta' ? ta : me;
            const avatar = m.from === 'ta' ? state.taAvatar : state.meAvatar;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => openDetail(m.id)}
                className={`block w-full rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 text-left shadow-[0_4px_14px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.99] ${isToday ? 'ring-2 ring-[#f5c33c]' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[24px] font-extrabold leading-none text-[#2c2c30] dark:text-zinc-100 ${isToday ? 'underline decoration-[#b9b9c2] decoration-[3px] underline-offset-[6px]' : ''}`}>{isToday ? '今天' : d.getDate()}</span>
                    <span className="text-[11px] text-[#9a9aa2] dark:text-zinc-400">{d.getMonth() + 1}月,{d.getFullYear()}</span>
                  </div>
                  {m.from !== 'ta' ? (
                    <span className="shrink-0 rounded-full border border-[#d9d9de] dark:border-white/10 px-2 py-0.5 text-[10px] text-[#6e6e76] dark:text-zinc-300">对方未读</span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-[#7f96e0]/45 px-2 py-0.5 text-[10px] text-[#7f96e0]">TA 写的</span>
                  )}
                </div>
                <div className="mt-2 flex justify-center">
                  <MoodFace mood={m.emoji} size={80} className="drop-shadow-[0_6px_14px_rgba(0,0,0,0.10)]" />
                </div>
                <div className="mt-2 text-[15px] leading-relaxed text-[#2c2c30] dark:text-zinc-100">{m.text || '（这一天没说话）'}</div>
                {m.photo && <img src={m.photo} alt="心情照片" className="mt-2 max-h-44 w-full rounded-xl object-cover" draggable={false} />}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                      {avatar ? <img src={avatar} alt={author} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={28} />}
                    </span>
                    <span className="truncate text-[12.5px] text-[#8e8e96] dark:text-zinc-400">{author}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3.5 text-[#8e8e96] dark:text-zinc-400">
                    <MessageSquare className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
                    <MoreVertical className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SubShell>
    );
  }

  // ---------- 月历视图（参考截图1：大心情球 + 粉色月份导航 + 戳一戳浮层 + 写日记按钮） ----------
  return (
    <SubShell title="心情日记" onBack={close}>
      {/* 月份导航（红圆 ‹ + 大标题 + 深红圆 ›；右侧星球/菜单） */}
      <div className="mt-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#3c3c44] dark:text-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 active:opacity-80"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.6} />
          </button>
          <span className="min-w-[92px] text-center text-[21px] font-extrabold tracking-wide text-[#2c2c30] dark:text-zinc-100">
            {cursor.y}.{String(cursor.m + 1).padStart(2, '0')}
          </span>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#3c3c44] dark:text-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 active:opacity-80"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2.6} />
          </button>
        </div>
        <div className="flex items-center gap-3 text-[#6e6e76] dark:text-zinc-300">
          <button type="button" aria-label="心情星球" onClick={() => showToast('心情星球整理中，敬请期待')} className="transition-opacity active:opacity-60">
            <Orbit className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="全部日记" onClick={() => setView('list')} className="transition-opacity active:opacity-60">
            <AlignJustify className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 星期表头（周一起始） */}
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] text-[#b9b9c1]">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 大心情球日历（有记录 → 大蜡笔表情+心情字；无记录 → 虚线空圈；今天显示「今天」） */}
      <div className="mt-1.5 grid grid-cols-7 gap-y-1.5">
        {cells.map((cell, i) =>
          cell == null ? (
            <span key={`b${i}`} />
          ) : (
            <button
              key={cell.key}
              type="button"
              onClick={() => {
                const top = byDay[cell.key]?.[0];
                if (top) openDetail(top.id);
                else openWrite(cell.key);
              }}
              className="flex h-[72px] flex-col items-center justify-start pt-1 transition-transform active:scale-[0.94]"
            >
              <span className={`text-[10.5px] leading-none ${cell.key === todayK ? 'font-bold text-[#3c3c42] dark:text-zinc-200' : 'text-[#8e8e96] dark:text-zinc-400'}`}>{cell.key === todayK ? '今天' : cell.d}</span>
              {byDay[cell.key]?.[0] ? (
                <>
                  <MoodFace mood={byDay[cell.key][0].emoji} size={38} className="mt-1 drop-shadow-[0_3px_8px_rgba(0,0,0,0.10)]" />
                  <span className="mt-0.5 max-w-full truncate text-[9px] leading-none text-[#6e6e76] dark:text-zinc-300">{byDay[cell.key][0].label}</span>
                </>
              ) : (
                <span className={`mt-1 h-[38px] w-[38px] rounded-full border-[1.5px] border-dashed ${cell.key === todayK ? 'border-[#c9c9cf] dark:border-white/15 bg-white/60 dark:bg-zinc-800/70' : 'border-[#e4e4e9] dark:border-white/10'}`} />
              )}
            </button>
          ),
        )}
      </div>

      <div className="mt-3 text-center text-[14.5px] font-medium text-[#4a4a52] dark:text-zinc-200">Hi，你那天的心情怎么样？</div>

      {/* 右下角浮层：对方未写日记气泡 + 戳一下他 + 写日记按钮（参考截图1） */}
      <div className="pointer-events-none fixed bottom-[76px] right-4 z-20 flex flex-col items-end gap-1.5">
        {!taWroteToday && (
          <div className="pointer-events-auto flex flex-col items-end">
            <div className="max-w-[150px] rounded-2xl rounded-br-md bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3 py-2 text-[11px] font-medium leading-snug text-[#3c3c42] dark:text-zinc-200 shadow-[0_6px_18px_rgba(0,0,0,0.14)]">
              对方今日还未写日记！快去戳一下 TA 吧
            </div>
            <button type="button" onClick={pokeTa} className="mt-1 rounded-lg bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-2.5 py-1 text-[10px] font-bold text-[#3c3c44] dark:text-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.10)] ring-1 ring-black/[0.06] dark:ring-white/10 active:opacity-80">
              戳一下他
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => openWrite(todayKey())}
          data-testid="mood-write-btn"
          className="pointer-events-auto mt-0.5 flex h-[46px] items-center gap-2 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl pl-4 pr-5 text-[14px] font-bold tracking-wide text-[#26262b] dark:text-zinc-100 shadow-[0_10px_26px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.05] dark:ring-white/10 transition-all active:scale-[0.94]"
        >
          <PencilLine className="h-4 w-4" strokeWidth={2.4} />
          写日记
          <Heart className="h-3 w-3 fill-[#f2536a]/80 text-[#f2536a]/80" aria-hidden="true" />
        </button>
      </div>
    </SubShell>
  );
}

/** 相对时间（日记详情头部用：刚刚 / N分钟前 / N小时前 / N天前 / 日期） */
function timeAgoLabel(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return fmtDate(at);
}

/** 100 件小事（手账拼贴风）：标题牌 + 拍立得卡片 + 待完成/已完成邮戳 */
/** 100 件小事（参考图1/2）：粉色手账拼贴 + 拍立得卡片墙（翻页）+ 待完成印章 + 目录/添加小事 + 编辑详情页 */
const HUNDRED_ROT = ['-rotate-[1.6deg]', 'rotate-[1.1deg]', '-rotate-[0.6deg]', 'rotate-[1.5deg]'];

/** 卡通表情（豆豆眼 + 小嘴 + 腮红） */
function KawaiiFace({ x, y, s = 1, tone = '#8a626e' }: { x: number; y: number; s?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx="-3" cy="0" r="1.05" fill={tone} />
      <circle cx="3" cy="0" r="1.05" fill={tone} />
      <path d="M-1.3 2.4 Q0 3.8 1.3 2.4" stroke={tone} strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <ellipse cx="-5.8" cy="1.8" rx="1.5" ry="0.9" fill="#f7b8c4" opacity="0.75" />
      <ellipse cx="5.8" cy="1.8" rx="1.5" ry="0.9" fill="#f7b8c4" opacity="0.75" />
    </g>
  );
}

/** 手账插画（参考图1风格：软萌 SVG 小插画，替代 emoji；kind 见 HUNDRED_KIND_COUNT） */
const HUNDRED_KIND_COUNT = 54;
function ScrapIllus({ kind, className = '' }: { kind: number; className?: string }) {
  const k = ((kind % HUNDRED_KIND_COUNT) + HUNDRED_KIND_COUNT) % HUNDRED_KIND_COUNT;
  return (
    <svg viewBox="0 0 100 70" className={className} aria-hidden="true">
      {k === 0 && (
        /* 用情侣头像：两颗带脸的爱心 */
        <g>
          <ellipse cx="50" cy="61" rx="36" ry="6" fill="#f3dbe2" opacity="0.7" />
          <path d={LOVE_HEART_PATH} transform="translate(31 24) scale(4.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <KawaiiFace x={31} y={26} s={1.5} />
          <path d={LOVE_HEART_PATH} transform="translate(67 28) scale(3.4) translate(-4.5 -3.5)" fill="#f7c3d0" />
          <KawaiiFace x={67} y={29} s={1.2} />
          <circle cx="18" cy="16" r="1.6" fill="#f3c8d3" />
          <circle cx="84" cy="14" r="1.2" fill="#f3c8d3" />
        </g>
      )}
      {k === 1 && (
        /* 一起看电影：爆米花桶 + 饮料杯 */
        <g>
          <g transform="translate(35 32)">
            <circle cx="-8" cy="-9" r="5" fill="#fbdce4" />
            <circle cx="0" cy="-12" r="6" fill="#fce8ee" />
            <circle cx="8" cy="-9" r="5" fill="#fbdce4" />
            <path d="M-13 -6 L13 -6 L10 26 L-10 26 Z" fill="#fff" stroke="#eec3cf" strokeWidth="1.5" />
            <path d="M-6 -6 L-4.5 26" stroke="#f2a9bc" strokeWidth="3.2" />
            <path d="M6 -6 L4.5 26" stroke="#f2a9bc" strokeWidth="3.2" />
            <KawaiiFace x={0} y={9} s={1.1} />
          </g>
          <g transform="translate(68 34)">
            <rect x="-2.6" y="-19" width="2.6" height="14" rx="1.3" fill="#e8988a" transform="rotate(14 -1 -12)" />
            <path d="M-10 -7 L10 -7 L7.6 25 L-7.6 25 Z" fill="#f9c8a8" stroke="#efb08c" strokeWidth="1.2" />
            <ellipse cx="0" cy="-7" rx="10" ry="2.6" fill="#f4b28a" />
            <KawaiiFace x={0} y={7} s={1} />
          </g>
        </g>
      )}
      {k === 2 && (
        /* 第一次合照的照片：拍立得相框 + 双心 */
        <g transform="rotate(-4 50 35)">
          <rect x="22" y="11" width="54" height="46" rx="3" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="2.4" />
          <rect x="29" y="18" width="40" height="31" rx="2" fill="#fbe3e9" />
          <path d={LOVE_HEART_PATH} transform="translate(44 33) scale(2.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d={LOVE_HEART_PATH} transform="translate(57 36) scale(1.7) translate(-4.5 -3.5)" fill="#f7c3d0" />
          <circle cx="72" cy="13" r="2.6" fill="#f2a9bc" opacity="0.85" />
        </g>
      )}
      {k === 3 && (
        /* 互穿对方衣服拍照：两件小衣服 */
        <g>
          <g transform="translate(32 38)">
            <path d="M-12 -10 L-5 -14 L0 -10.5 L5 -14 L12 -10 L15 -2 L10 -0.5 L10 14 L-10 14 L-10 -0.5 L-15 -2 Z" fill="#fdf3e3" stroke="#ecd9b8" strokeWidth="1.5" />
            <path d="M-5 -14 L0 -10.5 L5 -14" fill="none" stroke="#e8c9a0" strokeWidth="1.2" />
            <KawaiiFace x={0} y={2} s={1} />
          </g>
          <g transform="translate(68 40)">
            <path d="M-8 -13 L8 -13 L10 -7 L7 -7 L11 12 L-11 12 L-7 -7 L-10 -7 Z" fill="#fdeff3" stroke="#f3c6d3" strokeWidth="1.5" />
            <path d="M-8 -13 L8 -13" stroke="#f3c6d3" strokeWidth="3.4" strokeLinecap="round" />
            <KawaiiFace x={0} y={-1} s={0.95} />
          </g>
        </g>
      )}
      {k === 4 && (
        /* 连麦睡觉：小床 + 枕头 + 心 */
        <g>
          <rect x="14" y="30" width="9" height="22" rx="3" fill="#e8cdb2" />
          <rect x="20" y="36" width="62" height="15" rx="4" fill="#fdf0e2" stroke="#ecd5bc" strokeWidth="1.4" />
          <ellipse cx="37" cy="34.5" rx="9" ry="4.6" fill="#fff" stroke="#e8d5c8" strokeWidth="1" />
          <path d="M24 44 Q52 50 80 42 L80 51 L24 51 Z" fill="#f6cdd9" opacity="0.9" />
          <path d={LOVE_HEART_PATH} transform="translate(64 28) scale(1.8) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <text x="74" y="18" fontSize="9" fontWeight="bold" fill="#c9a9b2">z z</text>
        </g>
      )}
      {k === 5 && (
        /* 一起看日出：山间朝阳 */
        <g>
          <circle cx="50" cy="34" r="13" fill="#ffd98a" />
          <path d="M50 21 A13 13 0 0 1 50 47 Z" fill="#ffca6e" opacity="0.7" />
          <path d="M12 47 Q30 34 50 46 Q72 34 88 47 L88 56 L12 56 Z" fill="#f3b8c8" opacity="0.8" />
          <path d="M22 47 L26 42 M50 44 L54 40 M72 46 L76 42" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
        </g>
      )}
      {k === 6 && (
        /* 牵手压马路：脚印与爱心路 */
        <g>
          <path d="M10 52 Q35 40 50 48 Q70 58 88 40" stroke="#eec3cf" strokeWidth="3" strokeDasharray="5 5" fill="none" strokeLinecap="round" />
          <ellipse cx="34" cy="26" rx="4.5" ry="6" fill="#f2a9bc" transform="rotate(-14 34 26)" />
          <circle cx="30.5" cy="34" r="1.8" fill="#f2a9bc" />
          <ellipse cx="56" cy="20" rx="4.5" ry="6" fill="#f7c3d0" transform="rotate(12 56 20)" />
          <circle cx="59.5" cy="28" r="1.8" fill="#f7c3d0" />
          <path d={LOVE_HEART_PATH} transform="translate(70 30) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 7 && (
        /* 雨天共撑一把伞 */
        <g>
          <path d="M22 32 Q50 8 78 32 Z" fill="#f2a9bc" />
          <path d="M36 32 Q50 12 50 12 M64 32 Q50 12 50 12" stroke="#fff" strokeWidth="1.4" opacity="0.6" fill="none" />
          <path d="M50 32 L50 50 Q50 56 44 55" stroke="#d9899d" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M20 44 l-2.4 5 M32 48 l-2.4 5 M74 44 l-2.4 5 M84 50 l-2.4 5" stroke="#a8c8e8" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {k === 8 && (
        /* 一起做一顿晚饭：平底锅 + 爱心蛋 */
        <g>
          <ellipse cx="52" cy="40" rx="30" ry="14" fill="#5f5f66" />
          <ellipse cx="52" cy="38" rx="24" ry="10" fill="#4a4a50" />
          <ellipse cx="52" cy="38" rx="13" ry="7" fill="#fff" />
          <path d={LOVE_HEART_PATH} transform="translate(52 37) scale(1.3) translate(-4.5 -3.5)" fill="#ffd98a" />
          <path d="M82 38 L96 34" stroke="#5f5f66" strokeWidth="5" strokeLinecap="round" />
          <circle cx="24" cy="20" r="1.6" fill="#f3c8d3" />
        </g>
      )}
      {k === 9 && (
        /* 一起唱一首歌：音符与小心心 */
        <g>
          <circle cx="32" cy="50" r="6" fill="#f2a9bc" />
          <rect x="36.4" y="22" width="2.6" height="28" fill="#e88ba4" />
          <path d="M39 22 Q50 24 50 32 Q46 26 39 27 Z" fill="#e88ba4" />
          <circle cx="66" cy="44" r="5" fill="#f7c3d0" />
          <rect x="69.6" y="20" width="2.4" height="24" fill="#efb0c4" />
          <path d={LOVE_HEART_PATH} transform="translate(84 26) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M14 22 Q18 18 22 22" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 10 && (
        /* 互送礼物：礼物盒 */
        <g>
          <rect x="28" y="28" width="44" height="30" rx="3" fill="#fbdce4" stroke="#f2a9bc" strokeWidth="1.6" />
          <rect x="24" y="20" width="52" height="11" rx="3" fill="#f2a9bc" />
          <rect x="47" y="20" width="6" height="38" fill="#fff" opacity="0.85" />
          <path d="M50 20 C42 8 30 12 36 19 C40 23 46 21 50 20 Z" fill="none" stroke="#e88ba4" strokeWidth="2" />
          <path d="M50 20 C58 8 70 12 64 19 C60 23 54 21 50 20 Z" fill="none" stroke="#e88ba4" strokeWidth="2" />
        </g>
      )}
      {k === 11 && (
        /* 一起去看海：海浪小帆船 */
        <g>
          <circle cx="76" cy="18" r="7" fill="#ffd98a" />
          <path d="M44 14 L44 34 L62 34 Z" fill="#fff" stroke="#e8cdb2" strokeWidth="1.2" />
          <path d="M42 14 L42 34" stroke="#d9899d" strokeWidth="2" />
          <path d="M36 36 L52 36 L48 42 L40 42 Z" fill="#f2a9bc" />
          <path d="M8 48 Q20 42 32 48 Q44 54 56 48 Q68 42 80 48 Q88 52 94 49" stroke="#8fc3e8" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M12 56 Q26 51 40 56 Q56 61 70 56 Q82 52 92 56" stroke="#b3d9f2" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 12 && (
        /* 数流星许愿：月亮星星 */
        <g>
          <path d="M62 12 A17 17 0 1 0 78 38 A13.5 13.5 0 0 1 62 12 Z" fill="#ffd98a" />
          <path d="M20 16 L23 24 L31 26 L23 29 L20 37 L17 29 L9 26 L17 24 Z" fill="#f7c3d0" />
          <path d="M38 40 L40 45 L45 46.5 L40 48 L38 53 L36 48 L31 46.5 L36 45 Z" fill="#f2a9bc" />
          <path d="M14 52 l6 -3" stroke="#f3c8d3" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}
      {k === 13 && (
        /* 奶茶约会：两杯奶茶 */
        <g>
          <g transform="translate(36 34)">
            <path d="M-11 -10 L11 -10 L8.5 24 L-8.5 24 Z" fill="#fdf0e2" stroke="#ecd5bc" strokeWidth="1.4" />
            <path d="M-11 -10 L11 -10 L10.4 -2 L-10.4 -2 Z" fill="#f2d8b8" />
            <circle cx="-3" cy="18" r="2.2" fill="#c99a6a" />
            <circle cx="3" cy="21" r="2.2" fill="#c99a6a" />
            <KawaiiFace x={0} y={8} s={0.95} />
          </g>
          <g transform="translate(66 37)">
            <path d="M-9 -8 L9 -8 L7 20 L-7 20 Z" fill="#fdeff3" stroke="#f3c6d3" strokeWidth="1.4" />
            <ellipse cx="0" cy="-8" rx="9" ry="2.2" fill="#f3c6d3" />
            <KawaiiFace x={0} y={5} s={0.85} />
          </g>
        </g>
      )}
      {k === 14 && (
        /* 一起挑戏指环 */
        <g>
          <circle cx="50" cy="42" r="16" fill="none" stroke="#ffd98a" strokeWidth="5" />
          <circle cx="50" cy="42" r="16" fill="none" stroke="#f2c14e" strokeWidth="1.6" opacity="0.7" />
          <path d={LOVE_HEART_PATH} transform="translate(50 20) scale(1.9) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="43" cy="16" r="1.4" fill="#f3c8d3" />
          <circle cx="59" cy="14" r="1" fill="#f3c8d3" />
        </g>
      )}
      {k === 15 && (
        /* 一起种一盆植物：小花盆 */
        <g>
          <path d="M34 40 L66 40 L62 58 L38 58 Z" fill="#f2a9bc" />
          <rect x="32" y="36" width="36" height="7" rx="2.5" fill="#e88ba4" />
          <path d="M50 36 L50 18" stroke="#5ea732" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M50 24 C42 22 38 16 40 10 C48 12 52 18 50 24 Z" fill="#8ed86e" />
          <path d="M50 20 C58 18 62 12 60 6 C52 8 48 14 50 20 Z" fill="#a8e063" />
          <path d={LOVE_HEART_PATH} transform="translate(76 22) scale(1.3) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 16 && (
        /* 洗碗/泡脚：木桶 + 泡泡 */
        <g>
          <path d="M28 30 L72 30 L67 56 Q50 61 33 56 Z" fill="#e8c9a0" stroke="#d3ab7e" strokeWidth="1.6" />
          <path d="M31 40 L69 40 M33 49 L67 49" stroke="#d3ab7e" strokeWidth="1.4" opacity="0.7" />
          <rect x="26" y="25" width="48" height="8" rx="3.5" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <circle cx="34" cy="14" r="4.5" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="48" cy="8" r="5.5" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="62" cy="13" r="4" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="73" cy="20" r="2.6" fill="#fff" stroke="#cfe4ef" strokeWidth="1" />
          <circle cx="22" cy="21" r="2.4" fill="#fff" stroke="#cfe4ef" strokeWidth="1" />
          <path d={LOVE_HEART_PATH} transform="translate(50 45) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 17 && (
        /* 互相喂对方吃水果：双果 */
        <g>
          <circle cx="34" cy="40" r="13" fill="#f2a9bc" />
          <path d="M34 27 Q33 19 40 17" stroke="#5ea732" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M34 27 C28 21 21 23 21 23 C23 29 30 30 34 27 Z" fill="#8ed86e" />
          <KawaiiFace x={34} y={40} s={1.1} />
          <circle cx="66" cy="42" r="11" fill="#ffd98a" />
          <path d="M66 31 L66 53 M55 42 L77 42 M58 34 L74 50 M74 34 L58 50" stroke="#f2b45c" strokeWidth="1.3" />
          <circle cx="66" cy="42" r="11" fill="none" stroke="#f2b45c" strokeWidth="1.4" />
          <path d={LOVE_HEART_PATH} transform="translate(50 16) scale(1.5) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 18 && (
        /* 唱歌/K歌：麦克风 */
        <g>
          <circle cx="46" cy="22" r="12" fill="#c9c9d2" stroke="#9e9ea8" strokeWidth="1.6" />
          <path d="M38 17 h16 M37 22 h18 M39 27 h14" stroke="#8e8e96" strokeWidth="1.3" />
          <rect x="40" y="32" width="12" height="22" rx="6" fill="#e88ba4" />
          <path d="M36 44 Q28 48 30 58 M56 44 Q64 48 62 58" stroke="#f3c8d3" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="74" cy="30" r="3" fill="#f2a9bc" />
          <rect x="75.6" y="14" width="2" height="16" fill="#e88ba4" />
          <path d={LOVE_HEART_PATH} transform="translate(84 14) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 19 && (
        /* 一起敷面膜：脸 + 面膜 */
        <g>
          <ellipse cx="50" cy="38" rx="19" ry="22" fill="#fce4d4" />
          <path d="M31 38 Q31 15 50 15 Q69 15 69 38 L63 42 Q57 35 53 41 Q50 45 47 41 Q43 35 37 42 Z" fill="#ffffff" opacity="0.94" stroke="#e3e3ea" strokeWidth="1" />
          <circle cx="42" cy="33" r="2.2" fill="#5a5a62" />
          <circle cx="58" cy="33" r="2.2" fill="#5a5a62" />
          <path d="M46 46 Q50 49 54 46" stroke="#8a626e" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <ellipse cx="39" cy="42" rx="2.6" ry="1.5" fill="#f7b8c4" opacity="0.8" />
          <ellipse cx="61" cy="42" rx="2.6" ry="1.5" fill="#f7b8c4" opacity="0.8" />
          <path d={LOVE_HEART_PATH} transform="translate(82 20) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 20 && (
        /* 帮对方吹头发：吹风机 */
        <g>
          <rect x="18" y="22" width="32" height="23" rx="10" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <path d="M50 26 L68 21 L68 46 L50 41 Z" fill="#f2a9bc" stroke="#efb0c4" strokeWidth="1.4" />
          <circle cx="32" cy="33" r="6.5" fill="#fff" opacity="0.85" />
          <circle cx="32" cy="33" r="3" fill="#fbdce4" />
          <path d="M72 24 l9 -3 M74 33 l10 0 M72 42 l9 3" stroke="#a8c8e8" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 52 h9 M10 58 h11" stroke="#a8c8e8" strokeWidth="1.8" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(24 56) scale(1.2) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 21 && (
        /* 堆雪人/打雪仗：雪人 */
        <g>
          <circle cx="46" cy="46" r="15" fill="#fff" stroke="#dfe4ec" strokeWidth="1.6" />
          <circle cx="48" cy="24" r="11" fill="#fff" stroke="#dfe4ec" strokeWidth="1.6" />
          <circle cx="44.5" cy="22" r="1.4" fill="#5a5a62" />
          <circle cx="51.5" cy="22" r="1.4" fill="#5a5a62" />
          <path d="M45 27 Q48 30 51 27" stroke="#e88ba4" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <rect x="41" y="11" width="14" height="3.2" rx="1.6" fill="#5a5a62" />
          <rect x="44" y="4" width="8" height="8" rx="1.6" fill="#5a5a62" />
          <path d="M36 42 Q29 44 25 39" stroke="#8a5a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="72" cy="16" r="1.6" fill="#dfe4ec" />
          <circle cx="82" cy="28" r="1.2" fill="#dfe4ec" />
          <circle cx="70" cy="34" r="1.2" fill="#dfe4ec" />
          <path d={LOVE_HEART_PATH} transform="translate(78 50) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 22 && (
        /* 夏天吃冰淇淋：甜筒 */
        <g>
          <path d="M37 30 L63 30 L53 62 Q50 66 47 62 Z" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <path d="M42 37 L57 46 M42 46 L55 37 M45 52 L55 44" stroke="#e3bd90" strokeWidth="1.2" />
          <circle cx="41" cy="24" r="9" fill="#f7c3d0" />
          <circle cx="59" cy="24" r="9" fill="#f2a9bc" />
          <circle cx="50" cy="17" r="8.5" fill="#fce3ea" />
          <circle cx="50" cy="7" r="3" fill="#e8647a" />
          <path d="M50 10 L50 14" stroke="#8a5a2e" strokeWidth="1.2" />
          <circle cx="78" cy="16" r="1.4" fill="#f3c8d3" />
        </g>
      )}
      {k === 23 && (
        /* 一起吃火锅：小锅 + 热气 */
        <g>
          <path d="M50 16 Q47 10 52 7 M62 20 Q59 14 64 11" stroke="#c9c9d2" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.85" />
          <path d="M23 34 L23 48 Q23 53 29 53 L71 53 Q77 53 77 48 L77 34" fill="#e88ba4" />
          <ellipse cx="50" cy="34" rx="27" ry="10" fill="#e88ba4" />
          <ellipse cx="50" cy="33" rx="21" ry="7.5" fill="#fdf0e2" />
          <circle cx="41" cy="32" r="2.8" fill="#8ed86e" />
          <circle cx="54" cy="35" r="2.4" fill="#f2b45c" />
          <circle cx="62" cy="31" r="2.2" fill="#f7c3d0" />
          <path d="M14 58 Q22 54 30 58 Q38 62 46 58" stroke="#8fc3e8" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 24 && (
        /* 跨年/放烟花：烟花 */
        <g>
          <path d="M50 6 L52 20 M26 14 L37 25 M74 14 L63 25 M14 34 L28 36 M86 34 L72 36" stroke="#f2a9bc" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M34 8 L40 18 M66 8 L60 18 M12 22 L24 28" stroke="#a8c8e8" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
          <circle cx="50" cy="33" r="5.5" fill="#ffd98a" />
          <circle cx="30" cy="44" r="2.2" fill="#f7c3d0" />
          <circle cx="70" cy="46" r="2.2" fill="#f7c3d0" />
          <circle cx="50" cy="56" r="2.4" fill="#a8c8e8" />
          <path d="M14 60 l5 -2 M86 58 l-5 -2" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 25 && (
        /* 放孔明灯 */
        <g>
          <path d="M36 32 Q36 14 50 14 Q64 14 64 32 Q64 42 50 48 Q36 42 36 32 Z" fill="#ffd98a" stroke="#f2b45c" strokeWidth="1.6" />
          <path d="M42 46 L42 51 M58 46 L58 51 M42 51 Q50 55 58 51" stroke="#e3a04a" strokeWidth="1.6" fill="none" />
          <circle cx="50" cy="32" r="2.6" fill="#e8647a" />
          <circle cx="24" cy="20" r="1.6" fill="#f7c3d0" />
          <circle cx="76" cy="24" r="1.4" fill="#f7c3d0" />
          <path d="M16 42 Q22 38 26 42" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 26 && (
        /* 捡贝壳：贝壳 + 海星 */
        <g>
          <path d="M28 46 Q28 22 50 22 Q72 22 72 46 Q61 39 50 46 Q39 39 28 46 Z" fill="#fce3ea" stroke="#f2b8c8" strokeWidth="1.6" />
          <path d="M38 26 Q40 36 45 43 M50 22 L50 45 M62 26 Q60 36 55 43" stroke="#f2b8c8" strokeWidth="1.3" fill="none" />
          <path d="M78 28 l2.2 5 5.4 0.6 -4 3.6 1.2 5.4 -4.8 -2.8 -4.8 2.8 1.2 -5.4 -4 -3.6 5.4 -0.6 Z" fill="#ffd98a" />
          <circle cx="18" cy="18" r="1.5" fill="#f3c8d3" />
          <path d="M12 56 Q18 52 24 56" stroke="#8fc3e8" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 27 && (
        /* 爬山看云海：山峰 */
        <g>
          <path d="M8 56 L34 22 L52 48 L64 30 L90 56 Z" fill="#cfd8e6" />
          <path d="M34 22 L41 31 L37.5 31 L45 42" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M64 30 L70 38 L66 38 L74 49" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx="28" cy="54" rx="20" ry="4.6" fill="#fff" opacity="0.92" />
          <ellipse cx="68" cy="58" rx="24" ry="4.6" fill="#fff" opacity="0.85" />
          <circle cx="78" cy="14" r="6" fill="#ffd98a" />
        </g>
      )}
      {k === 28 && (
        /* 露营看星星：帐篷星空 */
        <g>
          <path d="M20 56 L46 24 L72 56 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.4" />
          <path d="M39 56 L46 42 L53 56 Z" fill="#e898a8" />
          <path d="M46 24 L46 42" stroke="#efb0c4" strokeWidth="1.2" />
          <circle cx="20" cy="13" r="1.8" fill="#ffd98a" />
          <circle cx="80" cy="11" r="1.5" fill="#ffd98a" />
          <circle cx="70" cy="22" r="1.2" fill="#ffd98a" />
          <path d="M78 16 A6 6 0 1 0 85 24 A4.8 4.8 0 0 1 78 16 Z" fill="#ffd98a" />
          <path d="M12 30 l6 -3" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 29 && (
        /* 坐摩天轮 */
        <g>
          <circle cx="50" cy="28" r="19" fill="none" stroke="#c9c9d2" strokeWidth="2" />
          <path d="M50 9 L50 47 M31 28 L69 28 M37 15 L63 41 M63 15 L37 41" stroke="#c9c9d2" strokeWidth="1.2" />
          <rect x="34" y="12" width="9" height="7.5" rx="2.4" fill="#f2a9bc" />
          <rect x="57" y="12" width="9" height="7.5" rx="2.4" fill="#a8c8e8" />
          <rect x="34" y="37" width="9" height="7.5" rx="2.4" fill="#ffd98a" />
          <rect x="57" y="37" width="9" height="7.5" rx="2.4" fill="#8ed86e" />
          <circle cx="50" cy="28" r="3" fill="#9e9ea8" />
          <path d="M50 31 L38 60 M50 31 L62 60 M34 60 L66 60" stroke="#9e9ea8" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      {k === 30 && (
        /* 坐旋转木马 */
        <g>
          <path d="M20 26 Q50 10 80 26 Z" fill="#f2a9bc" />
          <circle cx="50" cy="13" r="2.6" fill="#e88ba4" />
          <path d="M34 26 L34 54 M66 26 L66 54" stroke="#c9c9d2" strokeWidth="1.6" />
          <ellipse cx="32" cy="42" rx="9" ry="5.5" fill="#f7c3d0" />
          <circle cx="40" cy="36" r="4" fill="#f7c3d0" />
          <path d="M43 34 l4 -2.5" stroke="#8a5a2e" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="68" cy="44" rx="8" ry="5" fill="#fce3ea" />
          <circle cx="75" cy="38.5" r="3.6" fill="#fce3ea" />
          <rect x="18" y="54" width="64" height="4.5" rx="2.2" fill="#f2d8b8" />
        </g>
      )}
      {k === 31 && (
        /* 游乐园/过山车 */
        <g>
          <path d="M10 56 Q30 56 38 34 Q46 13 62 13 Q80 13 86 34" fill="none" stroke="#c9c9d2" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M38 34 L38 56 M54 20 L54 44 M70 15 L70 40 M86 34 L86 56" stroke="#c9c9d2" strokeWidth="1.2" />
          <g transform="rotate(-26 47 27)">
            <rect x="38" y="23" width="19" height="10" rx="3.5" fill="#f2a9bc" />
            <circle cx="43" cy="33" r="2.2" fill="#5a5a62" />
            <circle cx="53" cy="33" r="2.2" fill="#5a5a62" />
            <circle cx="43" cy="27" r="1.6" fill="#fff" opacity="0.85" />
          </g>
          <circle cx="20" cy="16" r="1.6" fill="#f3c8d3" />
        </g>
      )}
      {k === 32 && (
        /* 美术馆/博物馆/展览：画框 + 调色板 */
        <g>
          <rect x="16" y="16" width="44" height="36" rx="3" fill="#fff" stroke="#d3cfc8" strokeWidth="1.8" />
          <path d="M22 46 L34 30 L42 40 L50 26 L54 46 Z" fill="#fbdce4" />
          <circle cx="27" cy="24" r="2.8" fill="#ffd98a" />
          <ellipse cx="74" cy="38" rx="14" ry="12" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <circle cx="68" cy="33" r="2.4" fill="#f2a9bc" />
          <circle cx="78" cy="32" r="2.4" fill="#a8c8e8" />
          <circle cx="82" cy="42" r="2.4" fill="#8ed86e" />
          <circle cx="72" cy="44" r="2.4" fill="#ffd98a" />
          <path d="M58 54 L70 46" stroke="#8a5a2e" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      {k === 33 && (
        /* 图书馆/书店/母校：书本 */
        <g>
          <path d="M16 20 Q31 13 46 20 L46 54 Q31 47 16 54 Z" fill="#fbdce4" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d="M84 20 Q69 13 54 20 L54 54 Q69 47 84 54 Z" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d="M50 19 L50 54" stroke="#e8b0be" strokeWidth="2.2" />
          <path d="M23 28 Q33 24 41 28 M23 36 Q33 32 41 36" stroke="#f2b8c8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M59 28 Q67 24 77 28 M59 36 Q67 32 77 36" stroke="#f2b8c8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(50 10) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 34 && (
        /* 演唱会/话剧：吉他 */
        <g>
          <circle cx="40" cy="46" r="14" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.6" />
          <circle cx="40" cy="46" r="5" fill="#fdf0e2" stroke="#d3ab7e" strokeWidth="1.2" />
          <path d="M46 35 Q53 25 61 20 L67 14" stroke="#8a5a2e" strokeWidth="5" strokeLinecap="round" />
          <path d="M64 10 l8 8" stroke="#8a5a2e" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M44 43 L62 19" stroke="#5f3d18" strokeWidth="1.1" />
          <circle cx="62" cy="11" r="1.5" fill="#5f3d18" />
          <circle cx="69" cy="9" r="1.5" fill="#5f3d18" />
          <circle cx="20" cy="20" r="3" fill="#e88ba4" />
          <rect x="21.6" y="6" width="1.8" height="14" fill="#e88ba4" />
          <path d={LOVE_HEART_PATH} transform="translate(80 36) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 35 && (
        /* 放风筝 */
        <g>
          <path d="M50 8 L70 28 L50 48 L30 28 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.5" />
          <path d="M50 8 L50 48 M30 28 L70 28" stroke="#fff" strokeWidth="1.4" opacity="0.8" />
          <path d="M50 48 Q46 56 40 58 Q34 60 32 56" stroke="#e88ba4" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M42 55 l5 -2.4 l0 5 Z" fill="#ffd98a" />
          <path d="M35 60 l5 -2.4 l0 5 Z" fill="#a8c8e8" />
          <circle cx="20" cy="12" r="1.6" fill="#f3c8d3" />
          <path d="M78 16 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 36 && (
        /* 双人自行车 */
        <g>
          <circle cx="26" cy="48" r="9" fill="none" stroke="#5a5a62" strokeWidth="2" />
          <circle cx="74" cy="48" r="9" fill="none" stroke="#5a5a62" strokeWidth="2" />
          <path d="M26 48 L40 32 L62 32 M40 32 L36 48 M40 32 L74 48 M62 32 L74 48 M62 32 L58 48" fill="none" stroke="#e88ba4" strokeWidth="2" strokeLinecap="round" />
          <path d="M34 29 h9 M56 29 h9" stroke="#5a5a62" strokeWidth="3" strokeLinecap="round" />
          <path d="M64 29 q6 -4 8 2" stroke="#5a5a62" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M62 30 L62 16" stroke="#5a5a62" strokeWidth="1.4" />
          <path d={LOVE_HEART_PATH} transform="translate(62 12) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 37 && (
        /* 钓鱼 */
        <g>
          <path d="M14 18 Q20 34 34 38" stroke="#8a5a2e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M34 38 Q36 48 34 56" stroke="#9e9ea8" strokeWidth="1.2" fill="none" strokeDasharray="3 3" />
          <path d="M34 56 q3 3 5.5 0" stroke="#9e9ea8" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M8 63 Q16 59 24 63 Q32 67 40 63" stroke="#8fc3e8" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <ellipse cx="64" cy="32" rx="9" ry="5" fill="#a8c8e8" />
          <path d="M72 32 L81 27 L81 37 Z" fill="#a8c8e8" />
          <circle cx="59.5" cy="31" r="1.2" fill="#3a3a40" />
          <path d="M56 46 l-2 4 M63 48 l0 4 M70 46 l2 4" stroke="#8fc3e8" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}
      {k === 38 && (
        /* 看樱花：花枝 */
        <g>
          <path d="M14 60 Q38 48 58 28" stroke="#8a5a2e" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M42 46 Q50 46 56 52" stroke="#8a5a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[[28, 34, 1], [58, 22, 0.9], [62, 52, 0.75]].map(([x, y, s], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 6} cy={Math.sin((a * Math.PI) / 180) * 6} rx="4.6" ry="5.4" fill="#f9cdd8" />
              ))}
              <circle r="3" fill="#f2a9bc" />
            </g>
          ))}
          <circle cx="82" cy="36" r="1.4" fill="#f3c8d3" />
        </g>
      )}
      {k === 39 && (
        /* 踩落叶 */
        <g>
          <path d="M28 20 Q37 11 46 20 Q37 31 28 20 Z" fill="#f2b45c" />
          <path d="M28 20 Q37 23 46 20" stroke="#d99a3e" strokeWidth="1.2" fill="none" />
          <path d="M37 20 L37 29" stroke="#d99a3e" strokeWidth="1" />
          <path d="M58 34 Q64 27 70 34 Q64 43 58 34 Z" fill="#e8935c" />
          <path d="M64 34 L64 43" stroke="#c97a42" strokeWidth="1" />
          <path d="M34 48 Q40 42 46 48 Q40 56 34 48 Z" fill="#ffd98a" />
          <circle cx="76" cy="16" r="1.4" fill="#f3c8d3" />
          <path d="M14 40 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 40 && (
        /* 养宠物：爪印 */
        <g>
          <ellipse cx="38" cy="46" rx="13" ry="10.5" fill="#f2d8b8" />
          <circle cx="26.5" cy="32" r="4.6" fill="#f2d8b8" />
          <circle cx="38" cy="28" r="4.8" fill="#f2d8b8" />
          <circle cx="49.5" cy="32" r="4.6" fill="#f2d8b8" />
          <ellipse cx="66" cy="24" rx="7" ry="5.6" fill="#f7c3d0" transform="rotate(-18 66 24)" />
          <circle cx="60" cy="14.5" r="2.6" fill="#f7c3d0" />
          <circle cx="66" cy="12" r="2.7" fill="#f7c3d0" />
          <circle cx="72" cy="14.5" r="2.6" fill="#f7c3d0" />
          <path d={LOVE_HEART_PATH} transform="translate(80 46) scale(1.5) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 41 && (
        /* 写信/手写信/纸条：信封 */
        <g>
          <rect x="22" y="20" width="56" height="36" rx="3.5" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="1.8" />
          <path d="M22 23 L50 43 L78 23" fill="none" stroke="#e8cdb2" strokeWidth="1.8" />
          <path d={LOVE_HEART_PATH} transform="translate(50 49) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="15" cy="15" r="1.6" fill="#f3c8d3" />
          <circle cx="86" cy="30" r="1.3" fill="#f3c8d3" />
        </g>
      )}
      {k === 42 && (
        /* 生病照顾/剪指甲：护理箱 */
        <g>
          <rect x="26" y="24" width="48" height="32" rx="5" fill="#fff" stroke="#d3cfc8" strokeWidth="1.8" />
          <path d="M42 24 L42 18 Q42 15 45 15 L55 15 Q58 15 58 18 L58 24" fill="none" stroke="#d3cfc8" strokeWidth="1.8" />
          <rect x="45" y="31" width="10" height="18" rx="2" fill="#f2a9bc" />
          <rect x="41" y="35" width="18" height="10" rx="2" fill="#f2a9bc" />
          <circle cx="82" cy="20" r="1.5" fill="#f3c8d3" />
          <path d="M14 62 h8" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 43 && (
        /* 恋爱条约/真心话：纸笔 */
        <g>
          <g transform="rotate(-3 48 37)">
            <rect x="26" y="16" width="44" height="42" rx="3" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="1.8" />
            <path d="M33 26 L61 24 M33 33 L61 31 M33 40 L53 38" stroke="#d8c6a8" strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <path d="M62 52 L80 34 L84 38 L66 56 L60 58 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.3" />
          <path d="M60 58 L55.5 62.5" stroke="#8a5a2e" strokeWidth="2" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(80 18) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 44 && (
        /* 梦想基金：存钱罐 */
        <g>
          <circle cx="49" cy="11" r="4.6" fill="#ffd98a" stroke="#f2b45c" strokeWidth="1.2" />
          <text x="49" y="13.8" fontSize="6.5" fontWeight="bold" fill="#b8860b" textAnchor="middle">¥</text>
          <rect x="42" y="21" width="15" height="3.4" rx="1.7" fill="#d9899d" />
          <ellipse cx="49" cy="41" rx="23" ry="16.5" fill="#f7c3d0" />
          <path d="M62 27 Q69 22 69 29 Q65 31.5 61 29 Z" fill="#f2a9bc" />
          <ellipse cx="27" cy="41" rx="5.5" ry="4.6" fill="#f2a9bc" />
          <circle cx="25.4" cy="41" r="1" fill="#c97a8e" />
          <circle cx="28.6" cy="41" r="1" fill="#c97a8e" />
          <path d="M37 56 L37 60 M59 56 L59 60" stroke="#f2a9bc" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M71 54 Q76 56 75 61" stroke="#f2a9bc" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 45 && (
        /* 攒钱旅行/蜜月：行李箱 */
        <g>
          <rect x="30" y="22" width="40" height="34" rx="6" fill="#b8d4ea" stroke="#9bbcd8" strokeWidth="1.6" />
          <path d="M40 22 L40 56 M60 22 L60 56" stroke="#9bbcd8" strokeWidth="2" />
          <path d="M44 22 L44 15 Q44 13 46 13 L54 13 Q56 13 56 15 L56 22" fill="none" stroke="#9bbcd8" strokeWidth="2.2" />
          <circle cx="38" cy="59" r="2.6" fill="#5a5a62" />
          <circle cx="62" cy="59" r="2.6" fill="#5a5a62" />
          <path d={LOVE_HEART_PATH} transform="translate(50 40) scale(1.7) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M14 20 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 46 && (
        /* 给爸妈打电话：电话 */
        <g>
          <rect x="30" y="16" width="40" height="42" rx="8" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <rect x="36" y="24" width="28" height="21" rx="3" fill="#fff" opacity="0.88" />
          <path d={LOVE_HEART_PATH} transform="translate(50 34) scale(1.5) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="50" cy="52" r="2.8" fill="#fff" />
          <path d="M24 26 q-5 8 0 16 M76 26 q5 8 0 16" stroke="#f3c8d3" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 47 && (
        /* 拍vlog/视频：相机 */
        <g>
          <rect x="24" y="24" width="52" height="32" rx="6" fill="#c9c9d2" stroke="#9e9ea8" strokeWidth="1.6" />
          <path d="M40 24 L44 17 L56 17 L60 24 Z" fill="#9e9ea8" />
          <circle cx="50" cy="40" r="10" fill="#8e8e96" />
          <circle cx="50" cy="40" r="6.5" fill="#dfe4ec" />
          <circle cx="47.5" cy="37.5" r="2" fill="#fff" />
          <circle cx="70" cy="31" r="2.2" fill="#ffd98a" />
          <path d={LOVE_HEART_PATH} transform="translate(28 17) scale(1.2) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 48 && (
        /* 双人游戏：手柄 */
        <g>
          <path d="M26 26 L74 26 Q85 26 85 41 Q85 54 76 54 Q69 54 65 45 L60 45 L40 45 L35 45 Q31 54 24 54 Q15 54 15 41 Q15 26 26 26 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <path d="M32 35.5 h9 M36.5 31 v9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <circle cx="62" cy="33" r="2.8" fill="#a8c8e8" />
          <circle cx="69" cy="39" r="2.8" fill="#8ed86e" />
          <path d={LOVE_HEART_PATH} transform="translate(50 36) scale(1.3) translate(-4.5 -3.5)" fill="#e88ba4" />
        </g>
      )}
      {k === 49 && (
        /* 1000片拼图 */
        <g>
          <path d="M24 24 L48 24 L48 30 Q42 30 42 37 Q42 44 48 44 L48 52 L24 52 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.5" />
          <path d="M52 24 L76 24 L76 52 L52 52 L52 44 Q58 44 58 37 Q58 30 52 30 Z" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d={LOVE_HEART_PATH} transform="translate(64 38) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="17" cy="17" r="1.5" fill="#f3c8d3" />
        </g>
      )}
      {k === 50 && (
        /* 搭积木 */
        <g>
          <rect x="24" y="38" width="25" height="21" rx="2.5" fill="#a8c8e8" stroke="#9bbcd8" strokeWidth="1.4" />
          <rect x="51" y="38" width="25" height="21" rx="2.5" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.4" />
          <rect x="37.5" y="17" width="25" height="21" rx="2.5" fill="#ffd98a" stroke="#f2c14e" strokeWidth="1.4" />
          <circle cx="36.5" cy="48.5" r="4" fill="#fff" opacity="0.85" />
          <path d="M59.5 44.5 h9 M64 40 v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(50 27.5) scale(1.4) translate(-4.5 -3.5)" fill="#fff" opacity="0.92" />
        </g>
      )}
      {k === 51 && (
        /* 晨跑/运动/鞋码：运动鞋 */
        <g>
          <path d="M22 46 Q22 38 30 36 L38 29 Q42 33.5 48 36 Q58 40 70 42 Q80 44 80 50 L80 53 L22 53 Z" fill="#fff" stroke="#c9c9d2" strokeWidth="1.8" />
          <path d="M22 53 L80 53 L80 55.5 Q80 58.5 76 58.5 L26 58.5 Q22 58.5 22 55.5 Z" fill="#f2a9bc" />
          <path d="M36 38 L44 42 M40 34 L48 38" stroke="#c9c9d2" strokeWidth="1.6" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(64 47) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M11 40 h9 M9 48 h9" stroke="#dfe4ec" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {k === 52 && (
        /* 生日快乐/庆祝14号：蛋糕 */
        <g>
          <rect x="48.4" y="15" width="3.2" height="13" rx="1.6" fill="#a8c8e8" />
          <path d="M50 7.5 Q53.2 10.8 50 14.5 Q46.8 10.8 50 7.5 Z" fill="#ffd98a" />
          <path d="M28 44 L28 32 Q28 28 32 28 L68 28 Q72 28 72 32 L72 44 Q61 49.5 50 44 Q39 49.5 28 44 Z" fill="#fce8ee" />
          <rect x="28" y="42" width="44" height="15" rx="3" fill="#f7c3d0" />
          <path d="M28 48 Q39 53.5 50 48 Q61 42.5 72 48" stroke="#f2a9bc" strokeWidth="2" fill="none" />
          <circle cx="36" cy="31" r="2" fill="#e8647a" />
          <circle cx="64" cy="31" r="2" fill="#e8647a" />
        </g>
      )}
      {k === 53 && (
        /* 恋爱日记/年度总结：日记本 */
        <g>
          <rect x="27" y="15" width="48" height="43" rx="4.5" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.6" />
          <rect x="27" y="15" width="11" height="43" rx="4.5" fill="#f2a9bc" />
          {[24, 33, 42].map((y) => (
            <circle key={y} cx="32.5" cy={y} r="1.7" fill="#fff" opacity="0.9" />
          ))}
          <path d={LOVE_HEART_PATH} transform="translate(56 32) scale(2.3) translate(-4.5 -3.5)" fill="#fff" opacity="0.92" />
          <path d="M45 52 L67 52" stroke="#f2b8c8" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M49 58 L63 58" stroke="#f2b8c8" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/** 手账装饰花（SVG 玫瑰） */
function ScrapFlower({ size = 64, className = '', tone = '#f6c3d0' }: { size?: number; className?: string; tone?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <ellipse key={i} cx={32 + Math.cos(a) * 14} cy={32 + Math.sin(a) * 14} rx="12" ry="13" fill={tone} opacity="0.92" />;
      })}
      <circle cx="32" cy="32" r="12" fill={tone} />
      <circle cx="32" cy="32" r="6.5" fill="#eaa4b6" />
    </svg>
  );
}

const HUNDRED_DRAFT_DEFAULT = { img: null as string | null, desc: '', date: '', place: '' };

/** 100 件小事：每件事对应的插画 kind（与 HUNDRED_LIST 顺序一一对应，图标匹配事件内容） */
const HUNDRED_KIND_MAP: number[] = [
  /* 0-4 */ 0, 1, 2, 3, 4,
  /* 5-9 用情侣头像~做晚饭 */ 5, 5, 6, 7, 8,
  /* 10-14 洗碗~给对方唱歌 */ 16, 17, 1, 9, 18,
  /* 15-19 逛街情侣装~敷面膜 */ 3, 3, 2, 47, 19,
  /* 20-24 吹头发~堆雪人 */ 20, 42, 16, 21, 21,
  /* 25-29 冰淇淋~熬夜跨年 */ 22, 23, 13, 8, 24,
  /* 30-34 倒数~踩浪花 */ 24, 24, 25, 11, 11,
  /* 35-39 捡贝壳~看极光 */ 26, 27, 28, 12, 12,
  /* 40-44 摩天轮~逛美术馆 */ 29, 30, 31, 31, 32,
  /* 45-49 博物馆~演唱会 */ 32, 33, 33, 32, 34,
  /* 50-54 话剧~打雪仗 */ 34, 18, 9, 7, 21,
  /* 55-59 风筝~看樱花 */ 35, 36, 11, 37, 38,
  /* 60-64 踩落叶~宠物生日 */ 39, 15, 15, 40, 40,
  /* 65-69 写未来信~藏纸条 */ 41, 41, 10, 10, 41,
  /* 70-74 鞋码~梦想基金 */ 51, 42, 0, 43, 44,
  /* 75-79 攒钱旅行~童年秘密 */ 45, 45, 2, 0, 41,
  /* 80-84 回母校~拍vlog */ 33, 0, 46, 53, 47,
  /* 85-89 剪视频~真心话大冒险 */ 47, 48, 49, 50, 43,
  /* 90-94 猜心情~学技能 */ 0, 51, 51, 33, 33,
  /* 95-99 家乡菜~恋爱日记 */ 8, 24, 52, 52, 53,
  /* 100-104 老地重游~一起白头 */ 6, 2, 14, 0, 12,
];

function HundredPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
  const PER_PAGE = 6;
  const pageCount = Math.ceil(HUNDRED_LIST.length / PER_PAGE);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState(HUNDRED_DRAFT_DEFAULT);
  const [hundredWheel, setHundredWheel] = useState(false); // 日期滚轮（第二十轮：上下滑式）
  const [showIndex, setShowIndex] = useState(false);
  const touchX = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const items = state.hundredItems || {};

  const openEdit = (i: number) => {
    setEditing(i);
    setDraft(items[String(i)] || { ...HUNDRED_DRAFT_DEFAULT });
  };
  /** 保存编辑：有内容自动标记完成，全空则取消完成 */
  const finishEdit = () => {
    if (editing == null) return;
    const key = String(editing);
    const hasContent = !!(draft.img || draft.desc.trim() || draft.date || draft.place.trim());
    const done = state.hundred.includes(editing);
    patch({
      hundredItems: { ...items, [key]: draft },
      hundred: hasContent && !done ? [...state.hundred, editing] : !hasContent && done ? state.hundred.filter((x) => x !== editing) : state.hundred,
    });
    showToast(hasContent ? '已完成这件小事 ♡' : '已保存');
    setEditing(null);
  };
  /** 点击印章切换完成 */
  const toggleDone = (i: number) => {
    const done = state.hundred.includes(i);
    patch({ hundred: done ? state.hundred.filter((x) => x !== i) : [...state.hundred, i] });
    showToast(done ? '已改回待完成' : '已完成这件小事 ♡');
  };
  const onPickImg = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await fileToScaledDataURL(f, 900, 0.72);
      setDraft((d) => ({ ...d, img: url }));
    } catch {
      showToast('图片处理失败，换一张试试');
    }
  };

  // ============ 编辑详情页（参考图2） ============
  if (editing != null) {
    const title = HUNDRED_LIST[editing] || '';
    return (
      <div className="relative flex h-full flex-col bg-[linear-gradient(180deg,#fdf2f5_0%,#fbeaef_100%)] dark:bg-[linear-gradient(180deg,#1c1418_0%,#171117_100%)]">
        {/* 顶栏：返回 + 清空 + 完成 */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[56px]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setEditing(null)}
              aria-label="返回"
              className="text-[#8a6a74] dark:text-rose-300 transition-opacity active:opacity-50"
            >
              <ArrowLeft className="h-6 w-6" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ ...HUNDRED_DRAFT_DEFAULT });
                showToast('已清空这件小事的内容');
              }}
              aria-label="清空内容"
              className="text-[#e0708a] transition-opacity active:opacity-50"
            >
              <Trash2 className="h-6 w-6" strokeWidth={1.8} />
            </button>
          </div>
          <button
            type="button"
            onClick={finishEdit}
            className="rounded-md bg-[linear-gradient(180deg,#f9b7ca,#f49cb6)] px-6 py-1.5 text-[15px] font-bold text-white shadow-[0_3px_10px_rgba(230,130,160,0.4)] transition-transform active:scale-95"
          >
            完成
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {/* 拍立得相框 + 胶带 */}
          <div className="relative mx-auto mt-3 w-full max-w-[300px]">
            <span aria-hidden="true" className="absolute -left-2 -top-2 z-10 h-5 w-16 rotate-[-32deg] rounded-[3px] bg-[#f6c9d6]/80 shadow-sm" />
            <span aria-hidden="true" className="absolute -bottom-2 -right-2 z-10 h-5 w-16 rotate-[-32deg] rounded-[3px] bg-[#f6c9d6]/80 shadow-sm" />
            <div className="rounded-md bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl p-3 shadow-[0_8px_24px_rgba(210,120,150,0.22)]">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label="添加图片"
                className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-[#fdf1f4] dark:bg-rose-300/10"
              >
                {draft.img ? (
                  <img src={draft.img} alt="小事照片" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[30px] font-light text-[#3c3c44] dark:text-zinc-200 shadow-[0_4px_14px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.05] dark:ring-white/10">+</span>
                    <span className="text-[13px] font-medium text-[#6e6e76] dark:text-zinc-300">添加图片</span>
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="mt-4 text-center text-[19px] font-semibold tracking-wide text-[#5c4a44]">{title}</div>

          {/* 表单：描述/日期/地点 */}
          <div className="mt-6 space-y-0">
            {([
              { key: 'desc', label: '添加描述', hint: '（可不填）', type: 'text', placeholder: '' },
              { key: 'date', label: '选择日期', hint: '（可不填）', type: 'date', placeholder: '' },
              { key: 'place', label: '输入地点', hint: '（可不填）', type: 'text', placeholder: '' },
            ] as const).map((row) => (
              <label key={row.key} className="flex items-center gap-2 border-b border-[#e8ccd4] dark:border-white/10 py-3.5">
                {row.type === 'date' ? (
                  <button
                    type="button"
                    onClick={() => setHundredWheel(true)}
                    aria-label="选择日期"
                    className="flex flex-1 items-center justify-between"
                    data-testid="hundred-date-open"
                  >
                    <span className={`text-[15px] ${draft.date ? 'text-[#5c4a44] dark:text-rose-200/75' : 'text-[#c3a8b0] dark:text-rose-200/55'}`}>{draft.date || row.label}</span>
                    <span className="text-[13px] text-[#c3a8b0] dark:text-rose-200/55">{draft.date ? '点击修改' : row.hint}</span>
                  </button>
                ) : (
                  <>
                    <input
                      type="text"
                      value={draft[row.key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                      placeholder={row.label}
                      maxLength={60}
                      className="h-7 flex-1 bg-transparent text-[15px] text-[#5c4a44] outline-none placeholder:text-[#c3a8b0] dark:placeholder:text-rose-200/55"
                    />
                    <span className="shrink-0 text-[15px] text-[#c3a8b0] dark:text-rose-200/55">{row.hint}</span>
                  </>
                )}
              </label>
            ))}
          </div>
        </div>

        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => {
          void onPickImg(e.target.files?.[0] ?? null);
          e.currentTarget.value = '';
        }} />
        {/* 日期滚轮弹窗（第二十轮：上下滑式） */}
        <WheelDatePicker
          open={hundredWheel}
          value={draft.date}
          onConfirm={(v) => {
            setDraft((d) => ({ ...d, date: v }));
            setHundredWheel(false);
          }}
          onCancel={() => setHundredWheel(false)}
          title="选择日期"
        />
      </div>
    );
  }

  // ============ 手账主页（参考图1） ============
  const pageItems = HUNDRED_LIST.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const done = state.hundred.length;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(160deg,#fdeff3_0%,#fadce4_45%,#f6ccd8_100%)] dark:bg-[linear-gradient(160deg,#1d151a_0%,#181119_45%,#140f14_100%)]"
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx < -44) setPage((p) => Math.min(pageCount - 1, p + 1));
        else if (dx > 44) setPage((p) => Math.max(0, p - 1));
        touchX.current = null;
      }}
    >
      {/* 背景装饰：柔光斑 + 花朵 + 丝带 + 回形针 + 花瓣 */}
      <span aria-hidden="true" className="absolute -left-10 top-6 h-40 w-40 rounded-full bg-white/45 blur-xl" />
      <span aria-hidden="true" className="absolute -right-8 top-24 h-36 w-36 rounded-full bg-white/35 blur-xl" />
      <ScrapFlower size={78} tone="#f5bccb" className="absolute -left-5 top-[110px] opacity-90" />
      <ScrapFlower size={56} tone="#f8cfda" className="absolute left-8 top-[170px] opacity-80" />
      <ScrapFlower size={90} tone="#f3b2c3" className="absolute -right-6 top-[150px] opacity-90" />
      <ScrapFlower size={60} tone="#f6c3d0" className="absolute right-10 top-[236px] opacity-75" />
      <ScrapFlower size={70} tone="#f5bccb" className="absolute -left-4 bottom-24 opacity-85" />
      <ScrapFlower size={52} tone="#f8cfda" className="absolute bottom-40 right-4 opacity-70" />
      {/* 花瓣 */}
      {[['12%', '24%', -20], ['30%', '12%', 40], ['70%', '9%', -35], ['86%', '30%', 24], ['8%', '58%', 30], ['90%', '62%', -28], ['22%', '82%', -12], ['64%', '88%', 18]].map(([l, t, r], i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute h-3 w-5 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-[#f4bccb]/80"
          style={{ left: l as string, top: t as string, transform: `rotate(${r}deg)` }}
        />
      ))}
      {/* 回形针 */}
      <svg aria-hidden="true" viewBox="0 0 24 48" className="absolute right-8 top-3 h-11 w-6 rotate-12 opacity-80">
        <path d="M7 14 V36 a5 5 0 0 0 10 0 V10 a7 7 0 0 0 -14 0 v26" fill="none" stroke="#c9909e" strokeWidth="2.6" strokeLinecap="round" />
      </svg>

      {/* 顶部：返回 + 标题牌（避开状态栏） */}
      <div className="relative z-20 shrink-0 pt-[56px]">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[62px] z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f9b7ca,#f29cb6)] text-white shadow-[0_4px_12px_rgba(230,130,160,0.45)] transition-transform active:scale-95"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2.6} />
        </button>
        {/* 标题牌（斜置粉色亚克力牌） */}
        <div className="relative mx-auto w-fit rotate-[-3deg]">
          <div className="relative rounded-xl border-2 border-white/85 bg-[linear-gradient(135deg,#f8c6d4,#f2a9be_60%,#ee9db4)] px-7 py-2.5 shadow-[0_6px_18px_rgba(210,110,140,0.35)]">
            <span aria-hidden="true" className="absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white/85 shadow-inner" />
            <div className="pl-2 text-center">
              <div className="text-[19px] font-extrabold tracking-wide text-[#a13a52] dark:text-rose-300 drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">我们的 100 件小事</div>
              <div className="-mt-0.5 text-right text-[9px] italic tracking-[3px] text-white/95">OurLoveDiary</div>
            </div>
          </div>
          {/* 牌上小花 */}
          <ScrapFlower size={34} tone="#fce3ea" className="absolute -right-4 -top-3" />
        </div>
      </div>

      {/* TA 发起的小事（第九轮：AI 会主动添加 100 件小事里的事件） */}
      {(state.aiHundred ?? []).length > 0 && (
        <div className="relative z-10 mx-5 mt-1 rounded-xl border border-[#f2cdd8] dark:border-white/10 bg-white/85 dark:bg-zinc-800/90 px-3.5 py-2.5 backdrop-blur-sm" data-testid="ai-hundred-banner">
          <div className="text-[12.5px] leading-relaxed text-[#b0506c]">
            <b>{state.taName || 'TA'}</b> 想和你一起做：<b>{state.aiHundred[0].note}</b>
            <span className="ml-1 text-[11.5px] text-[#c58ba0] dark:text-rose-200/75">（{state.aiHundred[0].why}）</span>
          </div>
        </div>
      )}

      {/* 拍立得卡片墙（当前页 6 张） */}
      <div className="relative z-10 flex-1 overflow-hidden px-5 pt-3">
        <div className="grid grid-cols-2 gap-x-4">
          {pageItems.map((item, i) => {
            const idx = page * PER_PAGE + i;
            const checked = state.hundred.includes(idx);
            const it = items[String(idx)];
            return (
              <button
                key={idx}
                type="button"
                onClick={() => openEdit(idx)}
                aria-pressed={checked}
                aria-label={`小事：${item}`}
                className={`relative mb-5 rounded-md bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl px-2 pb-1.5 pt-2 shadow-[0_6px_16px_rgba(200,110,140,0.22)] transition-transform active:scale-[0.96] ${HUNDRED_ROT[idx % 4]} ${i % 2 === 1 ? 'mt-7' : ''}`}
              >
                {/* 胶带 */}
                <span aria-hidden="true" className="absolute -top-2 left-1/2 z-10 h-4 w-12 -translate-x-1/2 rotate-[-5deg] rounded-[3px] bg-[#f6cdd9]/90 shadow-sm" />
                {/* 插画（SVG 手绘风，非 emoji） */}
                <span className="flex h-[74px] items-center justify-center overflow-hidden rounded-sm bg-[#fdf3ec]">
                  {it?.img ? (
                    <img src={it.img} alt={item} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <ScrapIllus kind={HUNDRED_KIND_MAP[idx] ?? idx % 16} className="h-full w-full p-1.5" />
                  )}
                </span>
                <span className={`mt-1 block min-h-[30px] text-center text-[11.5px] leading-snug ${checked ? 'text-[#c3a8b0] dark:text-rose-200/55 line-through' : 'text-[#6b5a52] dark:text-rose-200/75'}`}>{item}</span>
                {/* 序号 */}
                <span className="absolute bottom-0.5 left-2 text-[8px] font-bold tracking-wider text-[#e3ccd3] dark:text-rose-200/55">{String(idx + 1).padStart(2, '0')}</span>
                {/* 待完成/已完成 印章（点击切换，参考图位于左上角） */}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={checked ? '标记待完成' : '标记完成'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(idx);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleDone(idx);
                    }
                  }}
                  className={`absolute -left-1.5 -top-2 z-20 rounded-[4px] border px-[3px] py-[3px] text-[9px] font-extrabold leading-[1.1] shadow-sm ${checked ? 'border-[#b09a90] bg-[#b09a90] text-white' : 'border-[#e05a6d] bg-white/90 dark:bg-zinc-800/95 text-[#e05a6d]'}`}
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {checked ? '已完成' : '待完成'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧固定按钮：目录 + 添加小事 */}
      <div className="absolute bottom-[86px] right-3 z-30 flex flex-col items-end gap-2.5">
        <button
          type="button"
          onClick={() => setShowIndex(true)}
          className="flex items-center gap-1.5 rounded-md bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] px-3.5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(242,83,106,0.30)] transition-transform active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          目录
        </button>
        <button
          type="button"
          onClick={() => {
            const next = HUNDRED_LIST.findIndex((_, i) => !state.hundred.includes(i));
            openEdit(next >= 0 ? next : 0);
          }}
          className="flex items-center gap-1.5 rounded-md bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] px-3.5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(242,83,106,0.30)] transition-transform active:scale-95"
        >
          <span className="text-[16px] font-light leading-none">+</span>
          添加小事
        </button>
      </div>

      {/* 底部：左右滑动提示 + 翻页箭头 */}
      <div className="relative z-20 flex shrink-0 items-center justify-between px-5 pb-4">
        <span className="flex-1 text-center text-[15px] font-medium text-white drop-shadow-[0_1px_3px_rgba(190,90,120,0.55)]">左右滑动 / 点击翻页</span>
        <button
          type="button"
          onClick={() => setPage((p) => (p + 1) % pageCount)}
          aria-label="下一页"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-white/90 bg-white/45 text-white shadow-[0_3px_10px_rgba(200,110,140,0.35)] backdrop-blur-sm transition-transform active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
      {/* 页码 */}
      <span aria-hidden="true" className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-[#d89aab] dark:text-rose-200/55">
        {page + 1} / {pageCount} · 已完成 {done}/100
      </span>

      {/* 目录弹层 */}
      {showIndex && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/35" onClick={() => setShowIndex(false)}>
          <div className="max-h-[76%] w-full overflow-hidden rounded-t-3xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-2xl backdrop-saturate-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.05] dark:border-white/10 px-5 py-3.5">
              <span className="text-[16px] font-bold text-[#3c3c42] dark:text-zinc-200">目录 · 已完成 {done}/100</span>
              <button type="button" onClick={() => setShowIndex(false)} aria-label="关闭目录" className="text-[13px] font-medium text-[#6e6e76] dark:text-zinc-300">
                收起
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto overscroll-contain px-4 pb-8 pt-2">
              {Array.from({ length: 10 }).map((_, g) => (
                <div key={g} className="mb-1">
                  <div className="px-1 pb-1 pt-2 text-[11px] font-bold text-[#c9a9b2] dark:text-rose-200/75">{g * 10 + 1}-{g * 10 + 10}</div>
                  {HUNDRED_LIST.slice(g * 10, g * 10 + 10).map((item, j) => {
                    const i = g * 10 + j;
                    const checked = state.hundred.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setPage(Math.floor(i / PER_PAGE));
                          setShowIndex(false);
                        }}
                        className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors active:bg-[#fdf1f4] dark:active:bg-rose-300/10"
                      >
                        <span className="w-6 shrink-0 text-[11px] font-bold text-[#d8b8c0] dark:text-rose-200/55">{String(i + 1).padStart(2, '0')}</span>
                        <span className={`flex-1 truncate text-[13.5px] ${checked ? 'text-[#c3a8b0] dark:text-rose-200/55 line-through' : 'text-[#4a3f3b] dark:text-rose-200/75'}`}>{item}</span>
                        {checked && <span className="text-[12px] font-bold text-[#e0708a]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 恋爱协议红章（参考图3：恋人空间公证 LOVE SPACE 圆形印章） */
function PactStamp() {
  return (
    <svg viewBox="0 0 120 120" className="h-[98px] w-[98px] -rotate-[14deg] opacity-90" aria-hidden="true">
      <defs>
        <path id="pact-stamp-circ" d="M60 60 m -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0" fill="none" />
      </defs>
      <circle cx="60" cy="60" r="54" fill="rgba(229,70,76,0.05)" stroke="#e5464c" strokeWidth="3.5" />
      <circle cx="60" cy="60" r="29" fill="none" stroke="#e5464c" strokeWidth="1.8" />
      <text fill="#e5464c" fontSize="12.5" fontWeight="700" letterSpacing="2.2">
        <textPath href="#pact-stamp-circ" startOffset="1%">LOVE SPACE · 恋人空间公证</textPath>
      </text>
      <text x="60" y="54" textAnchor="middle" fontSize="14" fontWeight="800" fill="#e5464c">恋人空间</text>
      <text x="60" y="72" textAnchor="middle" fontSize="12" fontWeight="800" fill="#e5464c" letterSpacing="6">公证</text>
      <path d="M60 77 c -3.2 -4.2 -9.5 -3 -9.5 2 c 0 4 5.2 6.8 9.5 9.8 c 4.3 -3 9.5 -5.8 9.5 -9.8 c 0 -5 -6.3 -6.2 -9.5 -2 Z" fill="#e5464c" />
    </svg>
  );
}

/** 协议纸数据（当前草稿 / 已保存协议通用形状） */
interface PactPaperData {
  title: string;
  preamble: string;
  clauses: string[];
  signMe: string | null;
  signTa: string | null;
  meAt: number | null;
  taAt: number | null;
  at: number | null;
}

/** 恋爱协议纸（预览/签署/回看共用）：标题 + 声明 + 条款 + 双签名 + 日期（签署后盖红章） */
function PactPaper({ data, meName, taName }: { data: PactPaperData; meName: string; taName: string }) {
  const signed = data.at != null;
  const kai = { fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" } as const;
  const sig = (side: 'me' | 'ta') => {
    const name = side === 'me' ? data.signMe ?? (signed ? meName || null : null) : data.signTa ?? (signed ? taName || null : null);
    const at = side === 'me' ? data.meAt ?? data.at : data.taAt ?? data.at;
    return { name, at };
  };
  return (
    <div className="relative overflow-hidden rounded-lg border border-[#e9e9ee] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-5 pb-6 pt-6 shadow-[0_4px_18px_rgba(0,0,0,0.05)]">
      <div className="text-center text-[21px] font-bold tracking-[2px] text-[#26262b] dark:text-zinc-100">{data.title || '恋爱协议书'}</div>
      <div className="mt-4 h-[2px] bg-[#2c2c30]" />
      <p className="mt-4 text-justify text-[13.5px] leading-[1.9] text-[#4a4a52] dark:text-zinc-200">{data.preamble}</p>
      <div className="my-4 border-t border-dashed border-[#dcdce1] dark:border-white/10" />
      <ol className="space-y-1.5 px-1" data-testid="pact-paper-clauses">
        {data.clauses.map((c, i) => (
          <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">
            <span className="shrink-0">{i + 1}.</span>
            <span>{c}</span>
          </li>
        ))}
        {data.clauses.length === 0 && <li className="text-[12.5px] text-[#c9c9cf] dark:text-zinc-500">还没有条款，去添加第一条约定吧</li>}
      </ol>
      <div className="my-4 border-t border-dashed border-[#dcdce1] dark:border-white/10" />
      <div className="grid grid-cols-2">
        {(['me', 'ta'] as const).map((side) => {
          const { name, at } = sig(side);
          return (
            <div key={side} className={side === 'me' ? 'border-r border-[#e9e9ee] dark:border-white/10 pr-4' : 'pl-4'}>
              <div className="text-[12px] text-[#6e6e76] dark:text-zinc-300">{side === 'me' ? '你的签名' : '他的签名'}</div>
              <div className="mt-1.5 min-h-[36px] text-[23px] leading-[36px] text-[#26262b] dark:text-zinc-100" style={kai}>
                {name || <span className="text-[14px] tracking-[2px] text-[#c9c9cf] dark:text-zinc-500">＿＿＿＿＿</span>}
              </div>
              <div className="mt-1 text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">日期：{at ? fmtDateCn(fmtDate(at)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
          );
        })}
      </div>
      {signed && (
        <div className="pointer-events-none absolute -right-1 bottom-20">
          <PactStamp />
        </div>
      )}
    </div>
  );
}

/** 恋爱协议（第七轮重做，参考图3/4/5）：预览主页 → 编辑协议 → 签署协议（双方签名后盖章生效） */
function PactPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const [view, setView] = useState<'home' | 'edit' | 'sign' | 'view'>('home');
  const [signFrom, setSignFrom] = useState<'home' | 'edit'>('home');
  const [viewPact, setViewPact] = useState<CouplePactRecord | null>(null);
  const [dlg, setDlg] = useState<null | { type: 'title' | 'preamble' | 'custom' | 'template' } | { type: 'clause'; idx: number }>(null);
  const [draft, setDraft] = useState('');
  const [taProposal, setTaProposal] = useState<{ idx: number; to: string; reason: string } | null>(null); // TA 想改其中一条（他可以不同意或改某一条——用户要求）
  const pendingRecIdRef = useRef<string | null>(null); // 当前待签协议存档 id（TA 改条款后重发复用同一条记录）
  const pactCardRef = useRef<{ msgId?: string; channel?: CoupleChannel; contactId?: string } | null>(null); // 第十六轮：TA 分享的协议卡片定位（我签完后回写「已签署」）
  const [taDeciding, setTaDeciding] = useState(false); // TA 正在决定签不签
  const [pickerOpen, setPickerOpen] = useState(false); // 通用分享选择器（第十八轮需求41：选 QQ/微信 → 选联系人）
  const clauses = state.pactClauses;
  const curPaper: PactPaperData = {
    title: state.pactTitle || '恋爱协议书',
    preamble: state.pactPreamble,
    clauses: state.pactClauses,
    signMe: state.pactSignMe,
    signTa: state.pactSignTa,
    meAt: state.pactMeAt,
    taAt: state.pactTaAt,
    at: state.pactAt,
  };

  /** 聊天里的协议卡片点击进来（第十五轮加固）：TA 分享的 → 优先用 aiPact，没有就直接拿卡片正文填草稿，永远直达签署界面；
   *  第十六轮：TA 分享前已先签名（aiPact.signTa / 卡片 taSigned）→ 签署界面直接带着 TA 的签名等我签；
   *  第十七轮·动态状态：卡片已是「已签署」（卡片标记 or 恋人空间存档里有同题已签协议）→ 点卡片直达已签署页面，不再进签署界面 */
  useEffect(() => {
    const p = consumePendingPactOpen();
    if (!p) return;
    // 记下卡片定位（第十六轮：我签完后把聊天里的协议卡片回写成「已签署」）
    pactCardRef.current = p.msgId && p.channel && p.contactId ? { msgId: p.msgId, channel: p.channel, contactId: p.contactId } : null;
    const pacts = state.pacts ?? [];
    const byId = p.pactId && p.pactId !== 'ai' ? pacts.find((x) => x.id === p.pactId) : undefined;
    // ① 我分享的协议卡片（有记录 id）→ 直接看这份协议的当前状态（待签回签署界面 / 已签或已拒看协议书）
    if (byId) {
      if (byId.status === 'pending' && !byId.signTa) {
        patch({ pactTitle: byId.title, pactPreamble: byId.preamble, pactClauses: [...byId.clauses], pactSignMe: byId.signMe, pactMeAt: byId.meAt, pactSignTa: null, pactTaAt: null, pactAt: null });
        setSignFrom('home');
        setView('sign');
      } else {
        setViewPact(byId);
        setView('view');
      }
      return;
    }
    // ② 已签署的协议卡片（气泡自愈标记 signed）→ 打开已签署页面（回看页，带红章）
    const signedRec = p.title ? pacts.find((x) => x.status === 'signed' && x.title === p.title) : undefined;
    if (p.signed && signedRec) {
      setViewPact(signedRec);
      setView('view');
      return;
    }
    if (p.from === 'ta') {
      const ap = state.aiPact;
      const hasCard = !!p.title && (p.clauses?.length ?? 0) > 0;
      if (ap || hasCard) {
        const title = ap?.title ?? p.title!;
        const cls = ap ? [...ap.clauses] : [...(p.clauses ?? [])];
        const pre = ap ? state.pactPreamble || defaultState().pactPreamble : p.preamble || defaultState().pactPreamble;
        // TA 已先签上自己的名字（第十六轮）→ 保留 TA 签名与签名时间，签完我的即生效
        const taSigned = ap?.signTa || (p.taSigned ? state.taName || 'TA' : null);
        patch({
          pactTitle: title,
          pactPreamble: pre,
          pactClauses: cls,
          pactSignMe: null,
          pactMeAt: null,
          pactSignTa: taSigned ?? null,
          pactTaAt: taSigned ? ap?.at ?? Date.now() : null,
          pactAt: null,
        });
        setSignFrom('edit');
        setView('sign');
      } else {
        setView('home');
      }
    }
  }, []);

  /** 再添加一份协议：重置草稿为默认模板 → 进编辑（已保存的协议书不受影响） */
  const startNewPact = () => {
    const d = defaultState();
    patch({ pactTitle: d.pactTitle, pactPreamble: d.pactPreamble, pactClauses: [...d.pactClauses], pactSignMe: null, pactMeAt: null, pactSignTa: null, pactTaAt: null, pactAt: null });
    setSignFrom('edit');
    setView('edit');
    showToast('新的一份协议，开始编辑吧 ♡');
  };

  // 条款拖拽排序（指针事件：按手柄 → 移动高亮目标行 → 松手落位）
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  const dragToRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    dragFrom.current = i;
    dragToRef.current = i;
    setDragging(i);
    setDragTo(i);
    const onMove = (ev: PointerEvent) => {
      let target: number | null = null;
      rowRefs.current.forEach((el, j) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) target = j;
      });
      if (target != null) {
        dragToRef.current = target;
        setDragTo(target);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = dragFrom.current;
      const to = dragToRef.current;
      dragFrom.current = null;
      dragToRef.current = null;
      setDragging(null);
      setDragTo(null);
      if (from == null || to == null || from === to) return;
      const arr = [...clauses];
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      patch({ pactClauses: arr });
      showToast('条款顺序已调整');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const openDlg = (d: NonNullable<typeof dlg>, initial = '') => {
    setDraft(initial);
    setDlg(d);
  };

  const submitDlg = () => {
    if (!dlg) return;
    const t = draft.trim();
    if (dlg.type === 'title') {
      if (!t) {
        showToast('协议名称不能为空');
        return;
      }
      patch({ pactTitle: t });
      showToast('协议名称已更新 ♡');
    } else if (dlg.type === 'preamble') {
      if (!t) {
        showToast('协议声明不能为空');
        return;
      }
      patch({ pactPreamble: t });
      showToast('协议声明已更新 ♡');
    } else if (dlg.type === 'clause') {
      if (!t) {
        showToast('条款内容不能为空');
        return;
      }
      const arr = [...clauses];
      arr[dlg.idx] = t;
      patch({ pactClauses: arr });
      showToast('条款已更新 ♡');
    } else if (dlg.type === 'custom') {
      if (!t) {
        showToast('先写下你们的约定吧');
        return;
      }
      patch({ pactClauses: [...clauses, t] });
      showToast('已添加一条自定义条款 ♡');
    } else if (dlg.type === 'template') {
      if (!t) {
        showToast('请输入模板编码');
        return;
      }
      patch({ pactClauses: [...PACT_TEMPLATE_CLAUSES], pactTitle: '恋爱协议书' });
      showToast('标准模板导入成功，共 20 条 ♡');
    }
    setDlg(null);
    setDraft('');
  };

  const addRandom = () => {
    const pool = PACT_RANDOM_POOL.filter((p) => !clauses.includes(p));
    if (pool.length === 0) {
      showToast('随机条款库都被你用完啦');
      return;
    }
    patch({ pactClauses: [...clauses, pool[Math.floor(Math.random() * pool.length)]] });
    showToast('已随机新增一条 ♡');
  };

  const removeClause = (idx: number) => {
    patch({ pactClauses: clauses.filter((_, i) => i !== idx) });
    showToast('已删除该条款');
  };

  /** 我的签名（第十六轮：TA 已先签名时，我签完协议立即生效——永久存档 + 聊天卡片回写「已签署」+ 写进 AI 记忆） */
  const signMe = () => {
    if (state.pactSignMe) return;
    const taAlready = !!state.pactSignTa; // TA 已先签（AI 分享前自己签了名）
    patch({ pactSignMe: state.meName || '我', pactMeAt: Date.now(), ...(taAlready ? { pactAt: Date.now() } : {}) });
    if (!taAlready) {
      showToast('签名成功 ♡ 现在点「他的签名」发给他签');
      // 写进 AI 记忆（TA 知道我已经签了名，等他签）
      const meta0 = readInviteMeta();
      if (meta0.partnerContactId) {
        const cid0 = meta0.partnerContactId;
        const ch0: CoupleChannel = meta0.partnerApp ?? 'wx';
        void (async () => {
          try {
            const { coupleRemember } = await import('@/lib/ios/couple-ai');
            coupleRemember(cid0, ch0, `${state.meName || '我'}在恋爱协议《${state.pactTitle || '恋爱协议书'}》上签好了名，等${state.taName || 'TA'}签`);
          } catch {
            /* 静默 */
          }
        })();
      }
      return;
    }
    // 双方签完 → 永久存档到「签署的恋爱协议」第一页
    const title = state.pactTitle || '恋爱协议书';
    const rec: CouplePactRecord = {
      id: uid(),
      title,
      preamble: state.pactPreamble,
      clauses: [...state.pactClauses],
      signMe: state.meName || '我',
      signTa: state.pactSignTa || state.taName || 'TA',
      meAt: Date.now(),
      taAt: state.pactTaAt ?? Date.now(),
      at: Date.now(),
      status: 'signed',
    };
    patchFn((prev) => ({ pacts: [rec, ...(prev.pacts ?? [])], aiPact: null }));
    // 聊天里的协议卡片回写「已签署」（带存档 id；msgId 命中不到时按「TA 发的同题卡」兜底，保证卡片一定变「已签署」）
    const meta = readInviteMeta();
    const card = pactCardRef.current;
    const patchCards = (ch: CoupleChannel, cid: string) => {
      const hit = patchPactCardsWhere(
        ch,
        cid,
        (d) => (card?.msgId ? d.msgId === card.msgId : false) || (d.from === 'ta' && d.status !== 'declined' && d.title === title),
        { status: 'signed', pactId: rec.id },
      );
      if (hit === 0) {
        // 一张都没命中也广播一次：聊天页重载消息后，卡片气泡会按恋人空间存档自愈显示「已签署」
        try {
          window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid, app: ch } }));
        } catch {
          /* 忽略 */
        }
      }
    };
    if (card?.channel && card.contactId) patchCards(card.channel, card.contactId);
    else if (meta.partnerContactId) patchCards(meta.partnerApp ?? 'wx', meta.partnerContactId);
    // 写进 AI 记忆（TA 知道协议正式生效了）
    if (meta.partnerContactId) {
      const cid = meta.partnerContactId;
      const ch = meta.partnerApp ?? 'wx';
      void (async () => {
        try {
          const { coupleRemember } = await import('@/lib/ios/couple-ai');
          coupleRemember(cid, ch, `恋爱协议《${title}》正式生效：${state.meName || '我'}和${state.taName || 'TA'}都签了名（共 ${state.pactClauses.length} 条条款），已永久存档`);
        } catch {
          /* 静默 */
        }
      })();
    }
    showToast('协议生效，已永久保存 ♡');
  };

  /** 点击「他的签名」区 = 把协议分享给他签字（第十五轮用户要求；第十八轮需求41：先选 QQ/微信再选联系人）：
   *  协议卡片发进 TA 的会话 → AI 认真看完决定：签 / 不签 / 想改其中某一条（改成什么样会告诉你） */
  const sendToTa = (chArg?: CoupleChannel, cidArg?: string) => {
    if (!state.pactSignMe || state.pactSignTa || taDeciding) return;
    setTaDeciding(true);
    setTaProposal(null);
    const title = state.pactTitle || '恋爱协议书';
    const cls = [...state.pactClauses];
    const meta = readInviteMeta();
    const cid = cidArg ?? meta.partnerContactId;
    const ch: CoupleChannel = chArg ?? meta.partnerApp ?? 'wx';
    // 存档/复用一条待签记录（列表可见「等 TA 签署」；TA 决定后回填状态；改条款重发时复用同一条）
    const recId = pendingRecIdRef.current && (state.pacts ?? []).some((x) => x.id === pendingRecIdRef.current)
      ? pendingRecIdRef.current
      : uid();
    pendingRecIdRef.current = recId;
    const rec: CouplePactRecord = {
      id: recId,
      title,
      preamble: state.pactPreamble,
      clauses: cls,
      signMe: state.pactSignMe || state.meName || '我',
      signTa: null,
      meAt: state.pactMeAt ?? Date.now(),
      taAt: null,
      at: Date.now(),
      status: 'pending',
    };
    patchFn((prev) => ({
      pacts: (prev.pacts ?? []).some((x) => x.id === recId) ? (prev.pacts ?? []).map((x) => (x.id === recId ? rec : x)) : [rec, ...(prev.pacts ?? [])],
    }));
    /** 写回 AI 的决定（签/拒/想改一条），并同步到签署界面 */
    let cardMsgIdP: Promise<string | null> | null = null; // 卡片消息 id（无绑定联系人时为 null）
    const applyDecision = (r: { agree: boolean; reason: string; say?: string; changeIdx?: number; changeTo?: string }) => {
      if (r.agree) {
        patch({ pactSignTa: state.taName || 'TA', pactTaAt: Date.now(), pactAt: Date.now() });
        patchFn((prev) => ({
          pacts: (prev.pacts ?? []).map((x) => (x.id === recId ? { ...x, signTa: state.taName || 'TA', taAt: Date.now(), at: Date.now(), status: 'signed' as const } : x)),
        }));
        pendingRecIdRef.current = null;
        // 聊天卡片同步「已签署」（第十六轮按 msgId；第十七轮加同题卡兜底 + 回写存档 id）
        void cardMsgIdP?.then((id) => {
          if (id && cid) patchPactCardsWhere(ch, cid, (d) => d.msgId === id, { status: 'signed', pactId: recId });
        });
        if (cid) {
          patchPactCardsWhere(ch, cid, (d) => d.from === 'me' && d.status === 'pending' && d.title === title, { status: 'signed', pactId: recId });
        }
        showToast(`${state.taName || 'TA'} 签好了协议 ♡ 协议正式生效`);
      } else if (typeof r.changeIdx === 'number' && r.changeIdx >= 0 && r.changeIdx < cls.length && r.changeTo) {
        setTaProposal({ idx: r.changeIdx, to: r.changeTo, reason: r.reason });
        patchFn((prev) => ({
          pacts: (prev.pacts ?? []).map((x) => (x.id === recId ? { ...x, status: 'declined' as const, reason: `想改第 ${r.changeIdx! + 1} 条` } : x)),
        }));
      } else {
        patchFn((prev) => ({ pacts: (prev.pacts ?? []).map((x) => (x.id === recId ? { ...x, status: 'declined' as const, reason: r.reason } : x)) }));
        showToast(`${state.taName || 'TA'} 没签：${cutText(r.reason, 30)}（可以改改条款再发一次）`);
      }
      setTaDeciding(false);
    };
    if (!cid) {
      // 没有绑定恋人联系人（未在微信/QQ建立关系）：直接 AI 决定
      showToast(`协议已发给${state.taName || 'TA'}，TA 正在认真看…`);
      void (async () => {
        try {
          const { aiDecidePact } = await import('@/lib/ios/couple-ai');
          applyDecision(await aiDecidePact(title, cls));
        } catch {
          applyDecision({ agree: true, reason: '条款我都喜欢' });
        }
      })();
      return;
    }
    showToast(`协议卡片已发给${state.taName || 'TA'}，TA 正在认真看…`);
    // ① 协议卡片发进 TA 的会话（分享给他；记录卡片消息 id，TA 签完回写「已签署」）
    cardMsgIdP = (async () => {
      try {
        return await sendPactCard({ channel: ch, contactId: cid, title, preamble: state.pactPreamble, clauses: cls, dir: 'me' });
      } catch {
        return null;
      }
    })();
    // ② TA 延时认真读完 → 决定签/不签/改一条（结果回聊天 + 回签署界面）
    scheduleAiPactDecision({
      channel: ch,
      contactId: cid,
      title,
      clauses: cls,
      onDone: applyDecision,
    });
  };

  /** 采纳 TA 想改的条款：更新草稿 → 自动重新发给他签 */
  const adoptTaProposal = () => {
    if (!taProposal) return;
    const arr = [...clauses];
    arr[taProposal.idx] = taProposal.to;
    patch({ pactClauses: arr });
    setTaProposal(null);
    showToast(`第 ${taProposal.idx + 1} 条已按 ${state.taName || 'TA'} 的意思改好，重新发给他…`);
    window.setTimeout(() => sendToTa(), 700);
  };

  const dlgTitle = dlg ? (dlg.type === 'title' ? '编辑协议名称' : dlg.type === 'preamble' ? '编辑协议声明' : dlg.type === 'clause' ? '编辑条款' : dlg.type === 'custom' ? '自定义一条' : '导入模板') : '';

  return (
    <div className="relative h-full">
      {view === 'home' && (
        <SubShell title="恋爱协议" onBack={close}>
          {/* 主标题（参考图3）：一起写一份 / 专属恋爱协议 */}
          <div className="px-1 pt-2">
            <h2 className="text-[27px] font-extrabold leading-[1.3] text-[#26262b] dark:text-zinc-100">
              我们的
              <span className="text-[#26262b] dark:text-zinc-100">专属</span> 恋爱协议
            </h2>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">签一份属于你们的协议，互相分享、互相签名；TA 也会认真看，自己决定签不签。</p>
          </div>

          {/* TA 拟的协议（第九轮：AI 会自己拟协议等我签；点卡片/去签直达签署界面；
           *  第二十三轮：我拒绝后不再消失，卡片显示「已拒绝」，AI 通过记忆知道被拒） */}
          {state.aiPact && (
            <div className={`relative mt-4 rounded-2xl border-2 border-dashed p-4 ${state.aiPact.declined ? 'border-[#d9d9de] dark:border-white/10 bg-[#fafafa] dark:bg-zinc-900/70 opacity-80' : 'border-[#3c3c42] dark:border-white/15 bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl'}`} data-testid="ai-pact-card">
              <div className="flex items-center justify-between pr-16">
                <div className="text-[14.5px] font-bold text-[#26262b] dark:text-zinc-100">
                  {state.taName || 'TA'} {state.aiPact.signTa ? '拟好并签好名的协议' : '拟了一份协议'} <span>《{state.aiPact.title}》</span>
                </div>
              </div>
              {state.aiPact.declined ? (
                <span className="absolute right-3 top-3 shrink-0 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-2 py-0.5 text-[10.5px] font-bold text-[#8e8e96] dark:text-zinc-400" data-testid="ai-pact-declined-badge">已拒绝</span>
              ) : (
                <span className="absolute right-3 top-3 shrink-0 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-2 py-0.5 text-[10.5px] font-bold text-[#4a4a52] dark:text-zinc-200">{state.aiPact.signTa ? 'TA已签 · 等你签' : '等你签'}</span>
              )}
              <div className="mt-2 space-y-1">
                {state.aiPact.clauses.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex gap-1.5 text-[12.5px] leading-relaxed text-[#6e6e76] dark:text-zinc-300">
                    <span className="shrink-0">{i + 1}.</span>
                    <span className="min-w-0">{c}</span>
                  </div>
                ))}
                {state.aiPact.clauses.length > 3 && <div className="text-[11.5px] text-[#b6b6bd] dark:text-zinc-500">…共 {state.aiPact.clauses.length} 条</div>}
              </div>
              {state.aiPact.declined ? (
                <>
                  <div className="mt-2.5 text-[12px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400" data-testid="ai-pact-declined-tip">你拒绝了这份协议，{state.taName || 'TA'} 已经知道了</div>
                  <div className="mt-3 flex gap-2.5">
                    <button
                      type="button"
                      data-testid="ai-pact-declined-delete"
                      onClick={() => {
                        patch({ aiPact: null });
                        showToast('已删除这份被拒绝的协议');
                      }}
                      className="h-10 flex-1 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 text-[14px] font-medium text-[#5a5a62] dark:text-zinc-300"
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      data-testid="ai-pact-declined-reconsider"
                      onClick={() => {
                        patchFn((prev) => (prev.aiPact ? { aiPact: { ...prev.aiPact, declined: false } } : {}));
                        showToast('再看看这份协议，愿意的话随时签名 ♡');
                      }}
                      className="h-10 flex-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[14px] font-semibold text-[#26262b] dark:text-zinc-100 ring-1 ring-[#dcdce2] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
                    >
                      重新考虑
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-3 flex gap-2.5">
                  <button
                    type="button"
                    data-testid="ai-pact-dismiss"
                    onClick={() => {
                      const meta = readInviteMeta();
                      const ap = state.aiPact!;
                      patchFn((prev) => (prev.aiPact ? { aiPact: { ...prev.aiPact, declined: true } } : {}));
                      // 第二十三轮：让 AI 知道我拒绝了（写进恋人记忆）+ 聊天里的协议卡片同步「已拒绝」
                      if (meta.partnerContactId) {
                        const cid = meta.partnerContactId;
                        const ch = meta.partnerApp ?? 'wx';
                        try {
                          coupleRemember(cid, ch, `${state.meName || '我'}拒绝了${state.taName || 'TA'}拟的恋爱协议《${ap.title}》，没有签名（${state.taName || 'TA'} 已经知道被拒绝了）`);
                        } catch {
                          /* 静默 */
                        }
                        patchPactCardsWhere(ch, cid, (d) => d.from === 'ta' && d.status === 'pending' && (d.pactId === 'ai' || d.title === ap.title), { status: 'declined', declinedBy: 'me' });
                      }
                      showToast('已拒绝，TA 会知道你的决定');
                    }}
                    className="h-10 flex-1 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 text-[14px] font-medium text-[#5a5a62] dark:text-zinc-300"
                  >
                    不了谢谢
                  </button>
                <button
                  type="button"
                  data-testid="ai-pact-adopt"
                  onClick={() => {
                    const p = state.aiPact!;
                    patch({ pactTitle: p.title, pactPreamble: state.pactPreamble, pactClauses: [...p.clauses], pactSignMe: null, pactMeAt: null, pactSignTa: p.signTa ?? null, pactTaAt: p.signTa ? p.at : null, pactAt: null, aiPact: null });
                    setSignFrom('edit');
                    setView('sign');
                    showToast(p.signTa ? `TA 已先签好名，签完你的名协议就生效 ♡` : `已换成 ${state.taName || 'TA'} 的版本，签完名发给 TA 确认 ♡`);
                  }}
                  className="h-10 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[14px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85"
                >
                  去签 TA 的协议
                </button>
                </div>
              )}
            </div>
          )}

          {/* 签署的恋爱协议（第一页主体，长方形卡片；右上角分享按钮） */}
          {state.pacts.length > 0 ? (
            <div className="mt-4">
              <div className="px-1 text-[15px] font-bold text-[#26262b] dark:text-zinc-100">
                签署的恋爱协议 <span className="text-[#26262b] dark:text-zinc-100">{state.pacts.length}</span>
              </div>
              <div className="mt-2.5 space-y-2.5">
                {state.pacts.map((p) => {
                  const st = p.status ?? (p.signTa ? 'signed' : 'pending');
                  return (
                    <div key={p.id} className="relative rounded-2xl border border-[#e9e9ee] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_2px_10px_rgba(0,0,0,0.05)]" data-testid="pact-saved-item">
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => {
                          if (st === 'pending' && !p.signTa) {
                            patch({ pactTitle: p.title, pactPreamble: p.preamble, pactClauses: [...p.clauses], pactSignMe: p.signMe, pactMeAt: p.meAt, pactSignTa: null, pactTaAt: null, pactAt: null });
                            setSignFrom('home');
                            setView('sign');
                          } else {
                            setViewPact(p);
                            setView('view');
                          }
                        }}
                      >
                        <span className="flex items-center gap-1.5 pr-14">
                          <Scale className="h-4 w-4 shrink-0 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.9} />
                          <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-[#26262b] dark:text-zinc-100">《{p.title}》</span>
                        </span>
                        <span className="mt-1.5 block truncate text-[12px] text-[#9a9aa2] dark:text-zinc-400">
                          {p.clauses.slice(0, 2).join('；')}
                          {p.clauses.length > 2 ? `…共 ${p.clauses.length} 条` : ''}
                        </span>
                      </button>
                      <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-[#f2dfe3] dark:border-white/10 pt-2.5">
                        <span className="text-[11px] text-[#b6b6bd] dark:text-zinc-500">
                          {p.clauses.length} 条条款 · {fmtDateCn(fmtDate(p.at))}
                          {p.signMe ? ` · ${p.signMe}已签` : ''}
                          {p.signTa ? ` · ${p.signTa}已签` : ''}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            st === 'signed' ? 'bg-[#eaf7ef] dark:bg-emerald-400/10 text-[#3d9a63]' : st === 'declined' ? 'bg-[#f4f4f6] dark:bg-zinc-900/80 text-[#8e8e96] dark:text-zinc-400' : 'bg-[#f0f0f3] dark:bg-zinc-900/80 text-[#4a4a52] dark:text-zinc-200'
                          }`}
                        >
                          {st === 'signed' ? '已生效' : st === 'declined' ? 'TA 婉拒了' : '等 TA 签署'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* 空态：还没有任何协议 */
            <div className="mt-5 rounded-2xl border border-dashed border-[#f2dfe3] dark:border-white/10 bg-white/70 dark:bg-zinc-800/78 px-4 py-7 text-center">
              <Scale className="mx-auto h-9 w-9 text-[#f8a0b4]" strokeWidth={1.6} />
              <div className="mt-2 text-[14px] font-semibold text-[#4a4a52] dark:text-zinc-200">还没有你们的协议</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">点右下角的 + 写下第一条约定，签名后分享给 TA</div>
            </div>
          )}

          {/* 草稿协议入口（当前编辑中的协议，未双方签署） */}
          {state.pactAt == null && (state.pactClauses.length > 0 || state.pactTitle !== '恋爱协议书') && (
            <button
              type="button"
              data-testid="pact-draft-entry"
              onClick={() => {
                setSignFrom('edit');
                setView('edit');
              }}
              className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed border-[#d9d9de] dark:border-white/10 bg-white/70 dark:bg-zinc-800/78 px-4 py-3.5 text-left active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
                <NotebookPen className="h-4.5 w-4.5 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">《{state.pactTitle || '恋爱协议书'}》（草稿）</span>
                <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{state.pactClauses.length} 条条款 · 点此继续编辑/签名</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf] dark:text-zinc-500" />
            </button>
          )}

          {/* 模板导入 + 创建按钮 */}
          <div className="mb-2 mt-4 text-center text-[13px] text-[#9a9aa2] dark:text-zinc-400">
            已有模板编码？
            <button type="button" data-testid="pact-import-btn" onClick={() => openDlg({ type: 'template' })} className="ml-1 font-medium text-[#26262b] dark:text-zinc-100 underline underline-offset-2 active:opacity-60">
              导入模板
            </button>
          </div>

          {/* 右下角加号（FAB）：添加协议（第十二轮用户要求） */}
          <button
            type="button"
            aria-label="添加协议"
            data-testid="pact-fab-add"
            onClick={startNewPact}
            className="fixed bottom-8 right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_6px_18px_rgba(242,83,106,0.38)] transition-transform active:scale-90"
          >
            <Plus className="h-7 w-7" strokeWidth={2.4} />
          </button>
        </SubShell>
      )}

      {view === 'edit' && (
        <SubShell title="编辑协议" onBack={() => setView('home')}>
          {/* 协议名称 */}
          <div className="mt-1 text-[16px] font-bold text-[#26262b] dark:text-zinc-100">协议名称</div>
          <button
            type="button"
            onClick={() => openDlg({ type: 'title' }, state.pactTitle)}
            className="mt-2.5 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-[#e4e4e9] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-4 py-3 text-left active:bg-[#fafafa] dark:active:bg-zinc-900/70"
          >
            <span className="flex-1 truncate text-[15.5px] text-[#26262b] dark:text-zinc-100">{state.pactTitle || '恋爱协议书'}</span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-[#26262b] dark:text-zinc-100">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
            </span>
          </button>

          {/* 协议声明 */}
          <div className="mt-5 text-[16px] font-bold text-[#26262b] dark:text-zinc-100">协议声明</div>
          <button
            type="button"
            onClick={() => openDlg({ type: 'preamble' }, state.pactPreamble)}
            className="mt-2.5 flex w-full items-start justify-between gap-3 rounded-xl border border-[#e4e4e9] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 text-left active:bg-[#fafafa] dark:active:bg-zinc-900/70"
          >
            <span className="flex-1 text-[13.5px] leading-[1.8] text-[#4a4a52] dark:text-zinc-200">{state.pactPreamble}</span>
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[13px] text-[#26262b] dark:text-zinc-100">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
            </span>
          </button>

          {/* 协议条款 */}
          <div className="mt-5 flex items-baseline justify-between">
            <div className="text-[16px] font-bold text-[#26262b] dark:text-zinc-100">协议条款</div>
            <div className="text-[11.5px] text-[#c9c9cf] dark:text-zinc-500">按住右侧手柄排序</div>
          </div>
          <div className="mt-1" data-testid="pact-clause-list">
            {clauses.map((c, i) => (
              <div
                key={i}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`flex items-center gap-1.5 py-3.5 ${
                  dragging === i
                    ? 'rounded-lg bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl px-2 shadow-[0_8px_22px_rgba(0,0,0,0.14)]'
                    : dragTo === i && dragging != null && dragTo !== dragging
                      ? 'border-t-2 border-[#2c2c30] dark:border-white/15'
                      : 'border-b border-dashed border-[#e4e4e9] dark:border-white/10'
                }`}
              >
                <span className="w-6 shrink-0 text-[15px] font-semibold text-[#26262b] dark:text-zinc-100">{i + 1}</span>
                <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#26262b] dark:text-zinc-100">{c}</span>
                <button
                  type="button"
                  aria-label={`编辑条款${i + 1}`}
                  onClick={() => openDlg({ type: 'clause', idx: i }, c)}
                  className="flex shrink-0 items-center gap-1 px-1 text-[12.5px] text-[#4a4a52] dark:text-zinc-200 active:opacity-60"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
                </button>
                <button
                  type="button"
                  aria-label={`删除条款${i + 1}`}
                  onClick={() => removeClause(i)}
                  className="flex shrink-0 items-center gap-1 px-1 text-[12.5px] text-[#4a4a52] dark:text-zinc-200 active:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> 删除
                </button>
                <button type="button" aria-label="拖动排序" onPointerDown={(e) => startDrag(i, e)} className="shrink-0 cursor-grab touch-none px-0.5 text-[#c9c9cf] dark:text-zinc-500 active:text-[#9a9aa2] dark:active:text-zinc-400">
                  <GripVertical className="h-4.5 w-4.5" strokeWidth={2} />
                </button>
              </div>
            ))}
            {clauses.length === 0 && <div className="py-8 text-center text-[13px] text-[#c9c9cf] dark:text-zinc-500">还没有条款，从下面新增一条吧</div>}
          </div>

          {/* 新增 */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" data-testid="pact-random-btn" onClick={addRandom} className="h-12 rounded-xl border-[1.5px] border-dashed border-[#3c3c42] dark:border-white/15 text-[14.5px] font-medium text-[#26262b] dark:text-zinc-100 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70">
              + 随机新增一条
            </button>
            <button type="button" data-testid="pact-custom-btn" onClick={() => openDlg({ type: 'custom' })} className="h-12 rounded-xl border border-[#d9d9de] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[14.5px] font-medium text-[#4a4a52] dark:text-zinc-200 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70">
              + 自定义一条
            </button>
          </div>

          <button
            type="button"
            data-testid="pact-to-sign-btn"
            onClick={() => {
              setSignFrom('edit');
              setView('sign');
            }}
            className="mb-2 mt-6 flex h-[52px] w-full items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98]"
          >
            下一步：预览协议
          </button>
        </SubShell>
      )}

      {view === 'sign' && (
        <SubShell title="签署协议" onBack={() => setView(signFrom)}>
          <div className="mt-1">
            <PactPaper data={curPaper} meName={state.meName} taName={state.taName} />
          </div>

          {/* 双签名区（参考图5）：先我签 → 再发 TA 签 */}
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">你的签名</div>
              <button
                type="button"
                data-testid="pact-sign-me"
                disabled={!!state.pactSignMe}
                onClick={signMe}
                className={`mt-2 flex h-[92px] w-full items-center justify-center rounded-md border-2 border-dashed transition-colors ${
                  state.pactSignMe ? 'border-[#dcdce2] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl' : 'border-[#dcdce2] dark:border-white/10 bg-[#f7f7f9] dark:bg-zinc-900/70 active:bg-[#efeff3] dark:active:bg-zinc-900/80'
                }`}
              >
                {state.pactSignMe ? (
                  <span className="text-[26px] text-[#26262b] dark:text-zinc-100" style={{ fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" }}>
                    {state.pactSignMe}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[14px] text-[#26262b] dark:text-zinc-100">
                    <Pencil className="h-4 w-4" strokeWidth={2} /> {state.pactSignTa ? '点击签名（签完即生效）' : '点击签名'}
                  </span>
                )}
              </button>
              {!state.pactSignMe && <div className="mt-2 rounded-md border border-[#d9d9de] dark:border-white/10 px-2 py-1 text-center text-[11px] leading-snug text-[#6e6e76] dark:text-zinc-300">{state.pactSignTa ? 'TA 已先签好名，你签完协议就生效并永久存档 ♡' : '请先签名，完成后即可生成协议书'}</div>}
              <div className="mt-2.5 text-[12px] text-[#9a9aa2] dark:text-zinc-400">日期：{state.pactMeAt ? fmtDateCn(fmtDate(state.pactMeAt)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">他的签名</div>
              <button
                type="button"
                data-testid="pact-sign-ta"
                disabled={!state.pactSignMe || !!state.pactSignTa || taDeciding}
                onClick={() => setPickerOpen(true)}
                className={`mt-2 flex h-[92px] w-full items-center justify-center rounded-md border-2 border-dashed border-[#d9d9de] dark:border-white/10 transition-colors ${
                  !state.pactSignMe || state.pactSignTa ? 'bg-[#fafafa] dark:bg-zinc-900/70' : 'bg-[#fafafa] dark:bg-zinc-900/70 active:bg-[#f1f1f4] dark:active:bg-zinc-900/80'
                }`}
              >
                {state.pactSignTa ? (
                  <span className="text-[26px] text-[#26262b] dark:text-zinc-100" style={{ fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" }}>
                    {state.pactSignTa}
                  </span>
                ) : taDeciding ? (
                  <span className="flex items-center gap-1.5 text-[13px] text-[#9a9aa2] dark:text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> 等待 TA 签名…
                  </span>
                ) : (
                  <span className={`flex flex-col items-center gap-1 ${state.pactSignMe ? 'text-[#6e6e76] dark:text-zinc-300' : 'text-[#c9c9cf] dark:text-zinc-500'}`}>
                    <span className="text-[14px]">{state.pactSignMe ? '点这里分享给他签名' : state.pactSignTa ? 'TA 已先签好名' : '发送给他签名'}</span>
                    {state.pactSignMe && !state.pactSignTa && <span className="max-w-[120px] text-center text-[10.5px] leading-snug text-[#b6b6bd] dark:text-zinc-500">协议卡片会发到 TA 的聊天，TA 看完自己决定签不签</span>}
                  </span>
                )}
              </button>
              <div className="mt-2 text-center text-[11.5px] text-[#c9c9cf] dark:text-zinc-500">{state.pactSignTa ? 'TA 已签名 ♡' : state.pactSignMe ? '点一下他的签名格，协议就会分享给他' : '请先完成你的签名'}</div>
              <div className="mt-2.5 text-[12px] text-[#9a9aa2] dark:text-zinc-400">日期：{state.pactTaAt ? fmtDateCn(fmtDate(state.pactTaAt)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
          </div>

          {/* TA 想改其中一条（第十五轮：他可以不同意或改某一条；采纳后自动重发） */}
          {taProposal && !state.pactSignTa && (
            <div className="mt-4 rounded-xl border border-[#dcdce2] dark:border-white/10 bg-[#f7f7f9] dark:bg-zinc-900/70 p-3.5" data-testid="pact-ta-proposal">
              <div className="text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">
                {state.taName || 'TA'} 想改第 {taProposal.idx + 1} 条
              </div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-[#6e6e76] dark:text-zinc-300">{taProposal.reason}</div>
              <div className="mt-2 rounded-lg bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3 py-2 text-[13px] leading-relaxed text-[#26262b] dark:text-zinc-100">
                <span className="text-[#9a9aa2] dark:text-zinc-400">原条款：{cutText(clauses[taProposal.idx] ?? '', 40)}</span>
                <span className="mt-1 block">改成：{taProposal.to}</span>
              </div>
              <div className="mt-2.5 flex gap-2.5">
                <button
                  type="button"
                  data-testid="pact-proposal-reject"
                  onClick={() => {
                    setTaProposal(null);
                    showToast('那就保持原条款，你可以再编辑或重发');
                  }}
                  className="h-10 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300"
                >
                  坚持原条款
                </button>
                <button type="button" data-testid="pact-proposal-adopt" onClick={adoptTaProposal} className="h-10 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[13.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85">
                  采纳修改，发他重签
                </button>
              </div>
            </div>
          )}

          {state.pactAt != null ? (
            <div className="mb-2 mt-5 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 py-3.5 text-center text-[14px] font-semibold text-[#26262b] dark:text-zinc-100" data-testid="pact-effective-banner">
              协议书已生成并生效，好好爱 ♡
            </div>
          ) : (
            <p className="mb-2 mt-5 text-center text-[12.5px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">双方都签名后，协议书自动生成并盖上恋人空间公证章</p>
          )}
        </SubShell>
      )}

      {view === 'view' && viewPact && (
        <SubShell title="协议书" onBack={() => setView('home')}>
          <div className="mt-1" data-testid="pact-saved-view">
            <PactPaper
              data={{ title: viewPact.title, preamble: viewPact.preamble, clauses: viewPact.clauses, signMe: viewPact.signMe, signTa: viewPact.signTa, meAt: viewPact.meAt, taAt: viewPact.taAt, at: viewPact.at }}
              meName={state.meName}
              taName={state.taName}
            />
          </div>
          <div className="mt-4 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 py-3 text-center text-[13px] font-semibold text-[#26262b] dark:text-zinc-100">
            {fmtDateCn(fmtDate(viewPact.at))} 生效 · 双方已签名 ♡
          </div>
          <div className="mb-2 mt-4 flex gap-2.5">
            <button
              type="button"
              data-testid="pact-saved-delete"
              onClick={() => {
                patch({ pacts: state.pacts.filter((x) => x.id !== viewPact.id) });
                setViewPact(null);
                setView('home');
                showToast('已删除该份协议书');
              }}
              className="h-11 flex-1 rounded-2xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300"
            >
              删除这份协议
            </button>
            <button type="button" onClick={() => setView('home')} className="h-11 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85">
              返回
            </button>
          </div>
        </SubShell>
      )}

      {/* 编辑弹层：名称/声明/条款/自定义/模板编码 */}
      {dlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 px-6" onClick={() => setDlg(null)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[16.5px] font-bold text-[#26262b] dark:text-zinc-100">{dlgTitle}</div>
            {dlg.type === 'template' ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入模板编码，如 LOVE2026"
                autoFocus
                className="mt-3.5 h-12 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] text-[#26262b] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
              />
            ) : dlg.type === 'preamble' ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                autoFocus
                maxLength={200}
                className="mt-3.5 w-full resize-none rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 p-3.5 text-[14.5px] leading-relaxed text-[#26262b] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
              />
            ) : (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                maxLength={dlg.type === 'title' ? 20 : 50}
                placeholder={dlg.type === 'custom' ? '写一条你们的小约定…' : ''}
                className="mt-3.5 h-12 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] text-[#26262b] dark:text-zinc-100 outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
              />
            )}
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setDlg(null)} className="h-11 flex-1 rounded-2xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">
                取消
              </button>
              <button type="button" data-testid="pact-dlg-save" onClick={submitDlg} className="h-11 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通用分享选择器（第十八轮需求41）：把协议分享给 QQ/微信里的联系人签字 */}
      {pickerOpen && (
        <ShareChannelPicker
          title="把协议分享给 TA 签字"
          hint="选择用哪个 App 发送，再选联系人（TA 看完自己决定签不签）"
          onSend={(ch, cid) => {
            setPickerOpen(false);
            sendToTa(ch, cid);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}


/** 恋爱水平考试（第十五轮重做，参考图4/5/6）：官方推荐题库 → 预览试卷 → 生成试卷作答 → TA 打分+想说的话；
 *  我可以喊 TA 来答题（聊天卡片）；TA 也会自己出卷喊我来答（卡片直达答题页）；TA 批卷知道我答了什么 */
function ExamPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const [view, setView] = useState<'bank' | 'preview' | 'answer' | 'result' | 'tasheet' | 'mine' | 'mineDetail'>('bank');
  const [preview, setPreview] = useState<ExamTpl | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [workTa, setWorkTa] = useState(false); // 正在答的是 TA 出的卷
  const [grading, setGrading] = useState(false); // AI 批卷中
  const [inviting, setInviting] = useState(false); // 喊 TA 答题中
  const [pickerOpen, setPickerOpen] = useState(false); // 通用分享选择器（第十八轮需求41：选 QQ/微信 → 选联系人）
  const [taGradeScore, setTaGradeScore] = useState(85); // 我给 TA 答卷打的分（逐题打分时自动合计）
  const [taGradeText, setTaGradeText] = useState(''); // 我给 TA 的批语
  const [taGrading, setTaGrading] = useState(false); // 提交批改中
  const [taMarks, setTaMarks] = useState<Record<number, { ok: boolean; score: number }>>({}); // 第二十二轮：我给 TA 每题打的对错与分数
  // 第二十一轮：AI 陪答（TA 和我同时答题，每答一题 TA 写下想法）；第二十三轮去掉开关，默认永远开启
  const [compBusy, setCompBusy] = useState<Record<number, boolean>>({}); // 正在生成想法的题
  const [genBusy, setGenBusy] = useState(false); // 题库 AI 出卷中
  const [pickerMode, setPickerMode] = useState<'together' | 'ta'>('together'); // 第二十四轮：分享选择器模式（和他一起答题/让他答题）
  const [mineSel, setMineSel] = useState<CoupleState['examHistory'][number] | null>(null); // 我的卷子·选中的存档
  const genBusyRef = useRef(false);
  const genFailRef = useRef(0); // 连续失败计数（防无限重试刷接口）
  const me = state.meName || '我';
  const ta = state.taName || 'TA';

  /** 聊天里的考试卡片点击进来（第十五轮；第十七轮·动态状态）：
   *  TA 出的卷我已答完 → 直达成绩页；我喊 TA 答的卷 TA 已交卷 → 直达 TA 的答卷页；否则进答题页 */
  useEffect(() => {
    const p = consumePendingExamOpen();
    if (!p) return;
    if (p.from === 'ta') {
      if (state.examTaPaper?.answered && state.examResult && (!p.title || state.examTaPaper.title === p.title)) {
        setWorkTa(true);
        setView('result');
      } else if (state.examTaPaper && !state.examTaPaper.answered) {
        setWorkTa(true);
        setAnswers({});
        setView('answer');
      }
    } else if (p.from === 'me') {
      if (state.examTaSheet && (!p.title || state.examTaSheet.title === p.title)) {
        setWorkTa(false);
        setView('tasheet');
      } else if (state.examPaper) {
        setWorkTa(false);
        setAnswers({});
        setView('answer');
      }
    }
  }, []);

  const paper = workTa ? null : state.examPaper;
  const taPaper = state.examTaPaper;
  const working: { title: string; notes: string[]; questions: { q: string; opts: string[]; best?: number }[] } | null = workTa ? taPaper : paper;

  /** 生成试卷（预览 → 作答）：第二十四轮「答题」按钮 = 激活试卷并进入答题页（我自己答） */
  const makePaper = () => {
    if (!preview) return;
    patch({ examPaper: { id: `p-${Date.now()}`, title: preview.title, notes: preview.notes, questions: preview.questions, source: 'me', at: Date.now(), taLive: { picks: {}, thoughts: {} } } });
    setWorkTa(false);
    setAnswers({});
    setView('answer');
    showToast('开始答题吧');
  };

  /** 第二十一轮：题库上滑/点更新 → AI（用户配置的 API 模型）再出 1~2 套新卷；
   *  追加进 examAiPapers 永不删除——之前生成的卷子不会消失 */
  const genMore = async () => {
    if (genBusyRef.current) return;
    if (genFailRef.current >= 2) return; // 连续失败暂停自动生成（点「更新」或重试按钮可继续）
    genBusyRef.current = true;
    setGenBusy(true);
    try {
      const { genExamPaper } = await import('@/lib/ios/couple-ai');
      const papers: NonNullable<CoupleState['examAiPapers']> = [];
      for (let i = 0; i < 2; i++) {
        const g = await genExamPaper('import');
        if (!g) break;
        papers.push({
          id: `aip-${Date.now()}-${i}`,
          title: g.title,
          notes: g.notes.length > 0 ? g.notes : ['本试卷为 AI 现场出题，满分100分。', '答题态度大于正确率。', '标准答案解释权归出卷人所有。', '本试卷长期有效。'],
          questions: g.questions,
          at: Date.now(),
        });
      }
      if (papers.length > 0) {
        genFailRef.current = 0;
        patchFn((prev) => ({ examAiPapers: [...(prev.examAiPapers ?? []), ...papers] }));
      } else {
        genFailRef.current += 1;
      }
    } finally {
      genBusyRef.current = false;
      setGenBusy(false);
    }
  };

  // 第二十二轮：进入批卷页重置逐题打分草稿（换卷/重进都不残留上一份的标记）
  useEffect(() => {
    if (view !== 'tasheet' || state.examTaSheet?.myScore != null) return;
    setTaMarks({});
  }, [view, state.examTaSheet?.at]);

  // 第二十二轮：题库滑到底再上滑一下松手才生成（不再一滑到底就自动触发）
  const pullRef = useRef<{ startY: number; atBottom: boolean }>({ startY: 0, atBottom: false });
  const onBankTouchStart = (e: React.TouchEvent) => {
    const sc = (e.currentTarget as HTMLElement).closest('.overflow-y-auto') as HTMLElement | null;
    pullRef.current = { startY: e.touches[0]?.clientY ?? 0, atBottom: sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 : false };
  };
  const onBankTouchEnd = (e: React.TouchEvent) => {
    if (!pullRef.current.atBottom || genBusyRef.current) return;
    const endY = e.changedTouches[0]?.clientY ?? 0;
    if (pullRef.current.startY - endY > 60) {
      genFailRef.current = 0;
      void genMore();
    }
  };

  /** 交卷 → TA 批卷（用户配置的 API 模型优先；TA 知道我答了什么）→ 分数下面写 TA 想说的话 */
  const submit = async () => {
    const src = working;
    if (!src || grading) return;
    const n = src.questions.length;
    if (Object.keys(answers).length < n) {
      showToast(`还有 ${n - Object.keys(answers).length} 题没答哦`);
      return;
    }
    setGrading(true);
    let score = Math.round(src.questions.reduce((acc, q, i) => acc + (typeof q.best === 'number' && q.best >= 0 && q.best === answers[i] ? 100 / n : 0), 0));
    let comment = score >= 85 ? '答得不错，看来平时有认真把对方放在心上。' : score >= 60 ? '整体及格，但有几题答得有点敷衍哦。' : '这份答卷需要回炉重造，罚你多爱一点。';
    try {
      const { aiGradeExam } = await import('@/lib/ios/couple-ai');
      const r = await aiGradeExam({ title: src.title, questions: src.questions.map((q) => ({ q: q.q, opts: q.opts })), answers, byTa: workTa });
      if (r) {
        score = r.score;
        comment = r.comment;
      }
    } catch {
      /* 本地兜底 */
    }
    const best = state.examBest == null || score > state.examBest ? score : state.examBest;
    patch({
      examResult: { title: src.title, score, comment, answers: { ...answers } as Record<string, number>, byTa: workTa, at: Date.now() },
      examBest: best,
    });
    // 第二十一轮：做过的卷子进「我的卷子」存档（带题目快照，之后随时可回看）
    patchFn((prev) => ({
      examHistory: [
        {
          id: `h-${Date.now()}`,
          title: src.title,
          score,
          comment,
          answers: { ...answers } as Record<string, number>,
          byTa: workTa,
          questions: src.questions.map((q) => ({ q: q.q, opts: q.opts, best: q.best ?? -1 })),
          at: Date.now(),
        },
        ...(prev.examHistory ?? []),
      ].slice(0, 60),
    }));
    if (workTa) {
      patchFn((prev) => ({ examTaPaper: prev.examTaPaper ? { ...prev.examTaPaper, answered: true } : null }));
      // 第十七轮：聊天里「TA 出卷喊我答」的卡片回写「已答完」，点卡片直达成绩页
      try {
        const meta = readInviteMeta();
        if (meta.partnerContactId) {
          const { patchExamCardsWhere } = await import('@/lib/ios/couple-exam-share');
          patchExamCardsWhere(meta.partnerApp ?? 'wx', meta.partnerContactId, (d) => d.from === 'ta' && d.status !== 'done' && d.title === src.title, { status: 'done' });
        }
      } catch {
        /* 静默 */
      }
    }
    setGrading(false);
    setView('result');
  };

  /** 第二十四轮：把预览卷落成激活卷（examPaper），答题/让TA答共用（TA 的答卷批改页题目从这里读） */
  const ensurePaper = () => {
    if (!preview) return;
    // 第二十四轮（决策修复）：若激活卷是另一套题（旧卷残留），用当前预览卷覆盖——否则 TA 答新卷、批改页却读旧题会错位
    const stale = !paper || paper.title !== preview.title || paper.questions.length !== preview.questions.length;
    if (!stale) return;
    patch({ examPaper: { id: `p-${Date.now()}`, title: preview.title, notes: preview.notes, questions: preview.questions, source: 'me', at: Date.now(), taLive: { picks: {}, thoughts: {} } } });
  };

  const sendExamInvite = async (ch: CoupleChannel, cid: string) => {
    if (!preview) return;
    const qs = preview.questions.map((q) => ({ q: q.q, opts: q.opts }));
    await sendExamCard({ channel: ch, contactId: cid, title: preview.title, count: qs.length, dir: 'me' });
    scheduleAiExamAnswer({ channel: ch, contactId: cid, title: preview.title, questions: qs });
  };

  /** 和他一起答题：发卡片+TA 同时作答，我立即进入答题页一起答 */
  const inviteTogether = async (chArg?: CoupleChannel, cidArg?: string) => {
    if (inviting || !preview) return;
    const meta = readInviteMeta();
    const cid = cidArg ?? meta.partnerContactId;
    const ch: CoupleChannel = chArg ?? meta.partnerApp ?? 'wx';
    if (!cid) {
      showToast('先在微信/QQ 里和 TA 建立关系吧');
      return;
    }
    setInviting(true);
    try {
      ensurePaper();
      await sendExamInvite(ch, cid);
      setWorkTa(false);
      setAnswers({});
      setView('answer');
      showToast(`卷子已发给他，你们同时开始答题吧 ♡`);
    } catch {
      showToast('邀请发送失败，稍后再试试');
    } finally {
      setInviting(false);
    }
  };

  /** 让他答题：发卡片+TA 作答，我不答，回题库等他交卷 */
  const letTaAnswer = async (chArg?: CoupleChannel, cidArg?: string) => {
    if (inviting || !preview) return;
    const meta = readInviteMeta();
    const cid = cidArg ?? meta.partnerContactId;
    const ch: CoupleChannel = chArg ?? meta.partnerApp ?? 'wx';
    if (!cid) {
      showToast('先在微信/QQ 里和 TA 建立关系吧');
      return;
    }
    setInviting(true);
    try {
      ensurePaper();
      await sendExamInvite(ch, cid);
      setView('bank');
      showToast(`已让他答题，他答完会告诉你 ♡`);
    } catch {
      showToast('邀请发送失败，稍后再试试');
    } finally {
      setInviting(false);
    }
  };

  const gradeLabel = (s: number) => (s >= 90 ? '满分恋人' : s >= 75 ? '优秀恋人' : s >= 60 ? '合格恋人' : '需要补课的恋人');

  /** 我答题时的选择处理（第二十三轮从视图里抽出；陪答默认开启不可关）：记录答案 + AI 同时给出他的选择与想法 */
  const onPickAnswer = (qi: number, oi: number) => {
    setAnswers((a) => ({ ...a, [qi]: oi }));
    if (workTa) return;
    const q = working?.questions[qi];
    if (!q || !working) return;
    setCompBusy((b) => ({ ...b, [qi]: true }));
    void (async () => {
      try {
        const { aiExamCompanion } = await import('@/lib/ios/couple-ai');
        // 第二十四轮：把这题之前 TA 已说过的想法传给模型（不重复、口吻连贯，全部由人设+记忆+上下文生成）
        const prevThoughts = Object.values(state.examPaper?.taLive?.thoughts ?? {}).filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
        const r = await aiExamCompanion(working.title, { q: q.q, opts: q.opts }, oi, prevThoughts);
        if (r) {
          patchFn((prev) =>
            prev.examPaper
              ? {
                  examPaper: {
                    ...prev.examPaper,
                    taLive: {
                      picks: { ...(prev.examPaper.taLive?.picks ?? {}), [String(qi)]: r.pick },
                      thoughts: { ...(prev.examPaper.taLive?.thoughts ?? {}), [String(qi)]: r.thought },
                    },
                  },
                }
              : {},
          );
        }
      } catch {
        /* 静默 */
      }
      setCompBusy((b) => {
        const n = { ...b };
        delete n[qi];
        return n;
      });
    })();
  };

  /** 我给 TA 的答卷批改（第二十二轮：逐题打对/错+打分，合计为总分；批语放最后灰色小字）：提交后写进恋人记忆（TA 就知道了）；TA 之后会在批语下留言 */
  const submitTaGrade = async () => {
    const s = state.examTaSheet;
    const qs = state.examPaper?.questions ?? [];
    if (!s || taGrading || s.myScore != null) return;
    if (qs.length > 0 && Object.keys(taMarks).length < qs.length) {
      showToast('还有题没打分哦，每题都要打对/错');
      return;
    }
    const c = taGradeText.trim();
    if (!c) {
      showToast('写一句批语再提交吧');
      return;
    }
    setTaGrading(true);
    const total = qs.length > 0 ? Math.round(Object.values(taMarks).reduce((n, m) => n + (Number(m.score) || 0), 0)) : taGradeScore;
    patchFn((prev) => (prev.examTaSheet ? { examTaSheet: { ...prev.examTaSheet, myScore: total, myComment: c, myMarks: taMarks } } : {}));
    // 写进恋人记忆（TA 知道我批了什么）
    const meta = readInviteMeta();
    if (meta.partnerContactId) {
      const cid = meta.partnerContactId;
      const ch = meta.partnerApp ?? 'wx';
      const okN = Object.values(taMarks).filter((m) => m.ok).length;
      void import('@/lib/ios/couple-ai').then((m) => {
        try {
          m.coupleRemember(cid, ch, `${state.meName || '我'}逐题批改了${state.taName || 'TA'}的答卷《${s.title}》：${total} 分（${okN} 对 ${qs.length - okN} 错），批语：「${c}」`);
        } catch {
          /* 静默 */
        }
      });
      // 第十七轮：TA 看完我的批改后，在「我的批改」下面留言感想（人设 + 记忆 + 最近聊天）
      try {
        const { scheduleTaReact } = await import('@/lib/ios/couple-exam-share');
        scheduleTaReact({ channel: ch, contactId: cid, title: s.title, score: total, comment: c });
      } catch {
        /* 静默 */
      }
    }
    setTaGrading(false);
    showToast('批改完成，TA 已经知道你的批语啦 ♡');
  };

  // ---------- 成绩视图（TA 打的分数 + 分数下面 TA 想说的话 + 逐题回顾） ----------
  if (view === 'result' && state.examResult) {
    const r = state.examResult;
    return (
      <SubShell title="考试成绩" onBack={() => setView('bank')}>
        <div className="mt-3 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-5 text-center shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
          <div className="text-[13px] font-medium text-[#9a9aa2] dark:text-zinc-400">《{r.title}》</div>
          <div className="mt-2 flex items-end justify-center gap-1.5">
            <span className="text-[52px] font-extrabold leading-none text-[#26262b] dark:text-zinc-100">{r.score}</span>
            <span className="pb-1.5 text-[15px] text-[#9a9aa2] dark:text-zinc-400">分</span>
            <Medal className="mb-1.5 h-6 w-6 text-[#f5c33c]" strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="mt-1 text-[15px] font-semibold text-[#4a4a52] dark:text-zinc-200">{gradeLabel(r.score)}</div>
          {/* TA 的批语（分数下面 TA 想说的话——用户要求） */}
          <div className="mt-4 rounded-xl bg-[#f7f7f9] dark:bg-zinc-900/70 px-4 py-3 text-left" data-testid="exam-ta-comment">
            <div className="text-[12px] font-bold text-[#26262b] dark:text-zinc-100">{ta} 的批语</div>
            <div className="mt-1 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">{r.comment}</div>
          </div>
          <div className="mt-2 text-[11px] text-[#c9c9cf] dark:text-zinc-500">{r.byTa ? `这是 ${ta} 出的卷 · ` : ''}批卷时间 {fmtDateCn(fmtDate(r.at))}</div>
        </div>

        {/* 逐题回顾（TA 出的卷没有标准答案，AI 批卷口径） */}
        {r.byTa === false && (
          <div className="mt-4 space-y-2.5">
            <div className="px-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">逐题回顾</div>
            {(state.examPaper ?? EXAM_TPLS[0]).questions.map((q, i) => {
              const my = r.answers[String(i)];
              const best = q.best;
              return (
                <div key={i} className="rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3.5 py-2.5 text-[12.5px] shadow-sm">
                  <div className="font-medium text-[#26262b] dark:text-zinc-100">
                    {i + 1}. {q.q}
                  </div>
                  <div className="mt-1 text-[#6e6e76] dark:text-zinc-300">
                    你答：<span className={my === best ? 'font-semibold text-[#3d9a63]' : 'text-[#e0607e]'}>{my != null && q.opts[my] ? q.opts[my] : '（未答）'}</span>
                  </div>
                  {my !== best && <div className="text-[#3d9a63]">更好：{best != null && q.opts[best] ? q.opts[best] : ''}</div>}
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-2 mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (workTa && state.examTaPaper) {
                setAnswers({});
                setView('answer');
              } else if (state.examPaper) {
                setWorkTa(false);
                setAnswers({});
                setView('answer');
              } else {
                setView('bank');
              }
            }}
            className="h-12 flex-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 ring-1 ring-[#dcdce2] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
          >
            <RefreshCcw className="mr-1 inline h-4 w-4" />
            再考一次
          </button>
          <button type="button" onClick={() => setView('bank')} className="h-12 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85">
            返回题库
          </button>
        </div>
      </SubShell>
    );
  }

  // ---------- TA 的答卷视图（TA 答我出的卷：他的选择 + 我的批改；第十七轮 TA 不再自评——打分批语都由我来给） ----------
  if (view === 'tasheet' && state.examTaSheet) {
    const s = state.examTaSheet;
    const qs = state.examPaper?.questions ?? [];
    const perQ = qs.length > 0 ? 100 / qs.length : 0;
    const fmtScore = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const marksTotal = Object.values(taMarks).reduce((n, m) => n + (Number(m.score) || 0), 0);
    return (
      <SubShell title={`${ta} 的答卷`} onBack={() => setView('bank')}>
        {/* 标题（第二十二轮：扁平展示，无白色圆角面板） */}
        <div className="mt-3 text-center text-[13px] font-medium text-[#9a9aa2] dark:text-zinc-400" data-testid="exam-ta-sheet">
          《{s.title}》
        </div>
        {typeof s.score === 'number' && (
          <div className="mt-1 text-center text-[11.5px] text-[#b6b6bd] dark:text-zinc-500">
            {ta} 自评 {s.score} 分{s.comment ? ` · ${s.comment}` : ''}
          </div>
        )}

        {/* TA 的作答（他选的选项用蓝色边框框住；下面逐题打对/错+打分） */}
        <div className="mt-4">
          <div className="px-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">{ta} 的作答</div>
          <div className="mt-1">
            {qs.map((q, i) => {
              const pick = s.picks[String(i)];
              const savedMark = s.myMarks?.[String(i)];
              const myMark = taMarks[i];
              return (
                <div key={i} className="border-b border-dashed border-[#e9e9ee] dark:border-white/10 py-3 last:border-0">
                  <div className="text-[13.5px] font-medium leading-relaxed text-[#26262b] dark:text-zinc-100">
                    {i + 1}、{q.q}
                    <span className="ml-1 text-[11px] font-normal text-[#9a9aa2] dark:text-zinc-400">（{fmtScore(perQ)}分）</span>
                  </div>
                  {/* 第二十三轮：题的选项全部显示出来（TA 选中的用蓝色边框框住，与陪答同款） */}
                  <div className="mt-1.5 space-y-1">
                    {q.opts.map((o, oi) => {
                      const isTaPick = pick === oi;
                      return (
                        <div
                          key={oi}
                          data-testid={isTaPick ? `exam-ta-pick-${i}` : undefined}
                          className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px] leading-relaxed ${
                            isTaPick ? 'border-[1.5px] border-[#576b95] bg-[#eef2fb] dark:bg-indigo-400/15 font-medium text-[#576b95]' : 'text-[#4a4a52] dark:text-zinc-200'
                          }`}
                        >
                          <span className={`mt-px shrink-0 font-bold ${isTaPick ? 'text-[#576b95]' : 'text-[#9a9aa2] dark:text-zinc-400'}`}>{'ABCD'[oi] ?? oi + 1}.</span>
                          <span className="min-w-0">{o}</span>
                        </div>
                      );
                    })}
                    {pick == null && <span className="text-[12.5px] text-[#b6b6bd] dark:text-zinc-500">（{ta} 跳过了这题）</span>}
                  </div>
                  {/* 未批改：逐题打对/错 + 打几分 */}
                  {s.myScore == null ? (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTaMarks((m) => ({ ...m, [i]: { ok: true, score: Math.round(perQ * 10) / 10 } }))}
                        data-testid={`exam-mark-ok-${i}`}
                        className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                          myMark?.ok === true ? 'bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_2px_8px_rgba(242,83,106,0.28)]' : 'bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[#4a4a52] dark:text-zinc-200 ring-1 ring-[#dcdce2] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70'
                        }`}
                      >
                        对
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaMarks((m) => ({ ...m, [i]: { ok: false, score: 0 } }))}
                        data-testid={`exam-mark-bad-${i}`}
                        className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                          myMark && myMark.ok === false ? 'bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-white shadow-[0_2px_8px_rgba(242,83,106,0.28)]' : 'bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[#4a4a52] dark:text-zinc-200 ring-1 ring-[#dcdce2] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70'
                        }`}
                      >
                        错
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={Math.round(perQ * 10) / 10}
                        step={0.5}
                        value={myMark ? myMark.score : ''}
                        onChange={(e) =>
                          setTaMarks((m) => ({ ...m, [i]: { ok: m[i]?.ok ?? true, score: Math.max(0, Math.min(perQ, Number(e.target.value) || 0)) } }))
                        }
                        aria-label={`第${i + 1}题得分`}
                        className="h-7 w-14 rounded-lg bg-[#f7f7f9] dark:bg-zinc-900/70 px-1.5 text-center text-[12px] tabular-nums text-[#26262b] dark:text-zinc-100 outline-none"
                      />
                      <span className="text-[11px] text-[#b6b6bd] dark:text-zinc-500">/ {fmtScore(perQ)} 分</span>
                    </div>
                  ) : savedMark ? (
                    <div className="mt-1.5 text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">
                      我的批改：{savedMark.ok ? '答对' : '答错'} · {savedMark.score} 分
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* 给他的批语（第二十二轮：放在作答下面；已批改→灰色小字；未批改→输入+提交） */}
        {s.myScore == null ? (
          <div className="mt-4" data-testid="exam-ta-grade">
            <div className="flex items-baseline justify-between px-1">
              <div className="text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">给他的批语</div>
              <div className="text-[12px] text-[#9a9aa2] dark:text-zinc-400">
                合计 <span className="text-[17px] font-extrabold text-[#26262b] dark:text-zinc-100">{Math.round(marksTotal)}</span> 分
              </div>
            </div>
            <textarea
              value={taGradeText}
              onChange={(e) => setTaGradeText(e.target.value)}
              rows={3}
              maxLength={80}
              placeholder={`写句批语，比如「第3题答到我心里了」…`}
              className="mt-2 w-full resize-none rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl p-3 text-[13px] leading-relaxed text-[#26262b] dark:text-zinc-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
              data-testid="exam-ta-grade-text"
            />
            <button
              type="button"
              data-testid="exam-ta-grade-submit"
              onClick={submitTaGrade}
              disabled={taGrading}
              className="mt-3 h-11 w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[14.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              提交批改
            </button>
            <div className="mt-2 text-center text-[11px] leading-relaxed text-[#c9c9cf] dark:text-zinc-500">每题打完对/错再提交，{ta} 会看到你给的每一分</div>
          </div>
        ) : (
          <div className="mt-4" data-testid="exam-ta-graded">
            <div className="px-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">给他的批语</div>
            <div className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">
              {s.myScore} 分 · {gradeLabel(s.myScore)} · {s.myComment}
            </div>
            <div className="mt-1 px-1 text-[11px] text-[#c9c9cf] dark:text-zinc-500">{ta} 已经知道你的批语啦</div>
          </div>
        )}

        {/* TA 在我的批语下面留言（第十七轮：看完分数和批语后的感想，人设 + 记忆生成） */}
        {s.myScore != null && (
          <div className="mt-3" data-testid="exam-ta-reply">
            <div className="px-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">{ta} 的留言</div>
            {s.taReply ? (
              <div className="mt-2 flex items-start gap-2">
                {state.taAvatar ? (
                  <img src={state.taAvatar} alt={ta} className="h-8 w-8 shrink-0 rounded-full object-cover" draggable={false} />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#576b95]/15 text-[11px] font-bold text-[#576b95]">{ta.slice(0, 1)}</span>
                )}
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">{s.taReply}</div>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-[#9a9aa2] dark:text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在写下想说的话…
              </div>
            )}
          </div>
        )}
        <button type="button" onClick={() => setView('bank')} className="mx-auto mb-2 mt-6 block rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-6 py-2 text-[12.5px] text-[#8e8e96] dark:text-zinc-400 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
          返回题库
        </button>
      </SubShell>
    );
  }

  // ---------- 作答视图（第二十三轮：和批改答卷页一样扁平简约——无试卷装饰/无陪答开关/无喊TA按钮/无提示语，只有题目和交卷） ----------
  if (view === 'answer' && working) {
    const answeredN = Object.keys(answers).length;
    const taLiveNow = !workTa ? state.examPaper?.taLive ?? null : null;
    const perScore = working.questions.length > 0 ? 100 / working.questions.length : 0;
    const fmtScore = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    return (
      <SubShell title={workTa ? `${ta} 的考卷` : '恋爱水平考试'} onBack={() => setView('bank')}>
        <div className="mt-3 text-center text-[13px] font-medium text-[#9a9aa2] dark:text-zinc-400" data-testid="exam-answer-sheet">
          《{working.title}》
        </div>
        {/* 题目扁平列表（与批改页同款：虚线分隔，无白面板） */}
        <div className="mt-2">
          {working.questions.map((q, qi) => {
            const picked = answers[qi];
            const taPick = !workTa && picked != null ? taLiveNow?.picks[String(qi)] : undefined;
            return (
              <div key={qi} className="border-b border-dashed border-[#e9e9ee] dark:border-white/10 py-3 last:border-0">
                <div className="text-[13.5px] font-medium leading-relaxed text-[#26262b] dark:text-zinc-100">
                  {qi + 1}、{q.q}
                  <span className="ml-1 whitespace-nowrap text-[11px] font-normal text-[#9a9aa2] dark:text-zinc-400">（{fmtScore(perScore)}分）</span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {q.opts.map((o, oi) => {
                    const isPicked = picked === oi;
                    return (
                      <button
                        key={oi}
                        type="button"
                        onClick={() => onPickAnswer(qi, oi)}
                        className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] leading-relaxed transition-colors ${
                          isPicked
                            ? 'border-[1.5px] border-[#f2536a] bg-[#fdeef1] dark:bg-rose-300/10 font-medium text-[#e0405c]'
                            : taPick === oi
                              ? 'border-[1.5px] border-[#576b95] bg-[#eef2fb] dark:bg-indigo-400/15 text-[#576b95]'
                              : 'text-[#4a4a52] dark:text-zinc-200 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70'
                        }`}
                      >
                        <span className={`mt-px shrink-0 font-bold ${isPicked ? 'text-[#f2536a]' : taPick === oi ? 'text-[#576b95]' : 'text-[#9a9aa2] dark:text-zinc-400'}`}>{'ABCD'[oi] ?? oi + 1}.</span>
                        <span className="min-w-0">{o}</span>
                      </button>
                    );
                  })}
                </div>
                {/* AI 陪答（第二十一轮功能保留，第二十三轮去掉开关默认开启）：TA 的选择+想法灰色小字 */}
                {!workTa && picked != null && (
                  compBusy[qi] ? (
                    <div className="mt-1.5 flex items-center gap-1.5 pl-2 text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> {ta} 正在想这题…
                    </div>
                  ) : taLiveNow?.thoughts[String(qi)] ? (
                    <div className="mt-1.5 pl-2 text-[11.5px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400" data-testid={`exam-ta-thought-${qi}`}>
                      <span className="font-semibold text-[#26262b] dark:text-zinc-100">{ta}：</span>
                      {taLiveNow.thoughts[String(qi)]}
                    </div>
                  ) : null
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          data-testid="exam-submit"
          onClick={() => void submit()}
          disabled={grading}
          className="mb-2 mt-4 h-[52px] w-full rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[16.5px] font-semibold text-white shadow-[0_6px_18px_rgba(242,83,106,0.32)] transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {grading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4.5 w-4.5 animate-spin" /> {ta} 正在批卷…
            </span>
          ) : answeredN < working.questions.length ? (
            `交卷（已答 ${answeredN}/${working.questions.length}）`
          ) : (
            '交卷'
          )}
        </button>
      </SubShell>
    );
  }

  // ---------- 预览视图（第二十四轮：与答题页同款扁平简约——粉色底/白纸卷/装饰全部删除；三按钮：和他一起答题/答题/让他答题） ----------
  if (view === 'preview' && preview) {
    const perScorePrev = preview.questions.length > 0 ? 100 / preview.questions.length : 0;
    const fmtPrevScore = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    return (
      <SubShell title="预览试卷" onBack={() => setView('bank')}>
        <div className="mt-3 text-center text-[13px] font-medium text-[#9a9aa2] dark:text-zinc-400" data-testid="exam-preview-sheet">
          《{preview.title}》
        </div>
        {/* 题目扁平列表（与答题页同款：虚线分隔，无白面板、不可点选） */}
        <div className="mt-2">
          {preview.questions.map((q, qi) => (
            <div key={qi} className="border-b border-dashed border-[#e9e9ee] dark:border-white/10 py-3 last:border-0">
              <div className="text-[13.5px] font-medium leading-relaxed text-[#26262b] dark:text-zinc-100">
                {qi + 1}、{q.q}
                <span className="ml-1 whitespace-nowrap text-[11px] font-normal text-[#9a9aa2] dark:text-zinc-400">（{fmtPrevScore(perScorePrev)}分）</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {q.opts.map((o, oi) => (
                  <div key={oi} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">
                    <span className="mt-px shrink-0 font-bold text-[#9a9aa2] dark:text-zinc-400">{'ABCD'[oi] ?? oi + 1}.</span>
                    <span className="min-w-0">{o}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* 三按钮（第二十四轮）：和他一起答题=发给他同时作答；答题=我自己答；让他答题=发给他答 */}
        <div className="mb-2 mt-4 space-y-2.5">
          <button
            type="button"
            data-testid="exam-invite-together"
            onClick={() => {
              setPickerMode('together');
              setPickerOpen(true);
            }}
            disabled={inviting}
            className="h-12 w-full rounded-2xl border-[1.5px] border-dashed border-[#f2536a]/70 bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl text-[15px] font-semibold text-[#f2536a] active:bg-[#fdf2f5] dark:active:bg-rose-300/10 disabled:opacity-50"
          >
            {inviting && pickerMode === 'together' ? '发送中…' : '和他一起答题'}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-testid="exam-make-paper"
              onClick={makePaper}
              className="h-12 rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[15px] font-semibold text-white shadow-[0_5px_16px_rgba(242,83,106,0.30)] transition-transform active:scale-[0.98]"
            >
              答题
            </button>
            <button
              type="button"
              data-testid="exam-let-ta-answer"
              onClick={() => {
                setPickerMode('ta');
                setPickerOpen(true);
              }}
              disabled={inviting}
              className="h-12 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#f2536a] ring-1 ring-[#f2536a]/45 active:bg-[#fdf2f5] dark:active:bg-rose-300/10 disabled:opacity-50"
            >
              {inviting && pickerMode === 'ta' ? '发送中…' : '让他答题'}
            </button>
          </div>
          <div className="text-center text-[11.5px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">和他一起答题：发给他、你们同时作答；答题：我自己答；让他答题：发给他慢慢答</div>
        </div>
        {pickerOpen && (
          <ShareChannelPicker
            title={pickerMode === 'ta' ? '让他答题' : '和他一起答题'}
            hint="选择用哪个 App 发送试卷邀请，再选联系人"
            onSend={(ch, cid) => {
              setPickerOpen(false);
              if (pickerMode === 'ta') void letTaAnswer(ch, cid);
              else void inviteTogether(ch, cid);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </SubShell>
    );
  }

  // ---------- 我的卷子（第二十一轮：左上角入口；正在答的 + 做过的 + AI 的卷子都放进这里） ----------
  if (view === 'mine') {
    const hist = state.examHistory ?? [];
    const aiPapersDesc = [...(state.examAiPapers ?? [])].reverse();
    return (
      <SubShell title="我的卷子" onBack={() => setView('bank')}>
        {/* 正在答的卷子（第二十二轮：题库页入口精简后，激活卷从这里继续作答） */}
        {state.examPaper && (
          <button
            type="button"
            data-testid="exam-mine-active"
            onClick={() => {
              setWorkTa(false);
              setAnswers({});
              setView('answer');
            }}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-[#e9e9ee] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-4 py-3.5 text-left shadow-sm active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
              <BookOpen className="h-4.5 w-4.5 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">正在答 《{state.examPaper.title}》</span>
              <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{state.examPaper.questions.length} 题 · 点此继续作答</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf] dark:text-zinc-500" />
          </button>
        )}

        {/* 做过的卷子（我的 + TA 出的我答的，交卷即存档） */}
        <div className="mt-3 px-1 text-[14px] font-bold text-[#26262b] dark:text-zinc-100">做过的卷子</div>
        {hist.length === 0 ? (
          <div className="mt-2 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl py-8 text-center text-[12.5px] text-[#b6b6bd] dark:text-zinc-500 shadow-sm" data-testid="exam-mine-empty">还没有做过的卷子，去题库挑一套吧</div>
        ) : (
          <div className="mt-2 space-y-2.5">
            {hist.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setMineSel(h);
                  setView('mineDetail');
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 py-3.5 text-left shadow-sm active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
                data-testid={`exam-mine-${h.id}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f7f4e9]">
                  <Medal className="h-4.5 w-4.5 text-[#8a6d1f]" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">《{h.title}》</span>
                  <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">
                    {h.byTa ? `${ta} 出的卷 · ` : '我出的卷 · '}
                    {h.questions.length} 题 · {fmtDate(h.at)}
                  </span>
                </span>
                <span className={`shrink-0 text-[20px] font-extrabold leading-none ${h.score >= 85 ? 'text-[#3d9a63]' : h.score >= 60 ? 'text-[#e6a23c]' : 'text-[#e0607e]'}`}>
                  {h.score}
                  <span className="ml-0.5 text-[11px] font-normal text-[#9a9aa2] dark:text-zinc-400">分</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* TA 的卷子（出给我的 / TA 的答卷） */}
        <div className="mt-5 px-1 text-[14px] font-bold text-[#26262b] dark:text-zinc-100">{ta} 的卷子</div>
        <div className="mt-2 space-y-2.5">
          {taPaper && (
            <button
              type="button"
              onClick={() => {
                if (taPaper.answered && state.examResult) {
                  setWorkTa(true);
                  setView('result');
                } else if (taPaper.answered) {
                  showToast('这张卷子你答过啦，等 TA 出新卷');
                } else {
                  setWorkTa(true);
                  setAnswers({});
                  setView('answer');
                }
              }}
              className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[#3c3c42]/50 dark:border-white/15 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-4 py-3.5 text-left active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
                <BookOpen className="h-4.5 w-4.5 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">
                  {ta} 给你出了套卷 《{taPaper.title}》
                </span>
                <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{taPaper.answered ? '已答完 · 点此看成绩' : `${taPaper.questions.length} 题 · 点此去答题`}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf] dark:text-zinc-500" />
            </button>
          )}
          {state.examTaSheet && (
            <button type="button" onClick={() => setView('tasheet')} className="flex w-full items-center gap-3 rounded-2xl border border-[#e9e9ee] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-4 py-3.5 text-left active:opacity-80">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
                <PencilLine className="h-4.5 w-4.5 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">
                  {ta} 的答卷 <span className="text-[#576b95]">《{state.examTaSheet.title}》</span>
                </span>
                <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{state.examTaSheet.myScore != null ? `我批了 ${state.examTaSheet.myScore} 分` : '等我批改'}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf] dark:text-zinc-500" />
            </button>
          )}
          {!taPaper && !state.examTaSheet && <div className="rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl py-8 text-center text-[12.5px] text-[#b6b6bd] dark:text-zinc-500 shadow-sm">{ta} 还没出过卷子</div>}
        </div>

        {/* AI 出的卷子（未作答的存档；永不消失） */}
        <div className="mt-5 px-1 text-[14px] font-bold text-[#26262b] dark:text-zinc-100">AI 出的卷子</div>
        {aiPapersDesc.length === 0 ? (
          <div className="mt-2 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl py-8 text-center text-[12.5px] text-[#b6b6bd] dark:text-zinc-500 shadow-sm">还没有 AI 出的卷子，回题库上滑生成</div>
        ) : (
          <div className="mt-2 space-y-2.5">
            {aiPapersDesc.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setPreview({ id: t.id, title: t.title, usage: 'AI 新卷', notes: t.notes, questions: t.questions.map((q) => ({ ...q, best: -1 })) });
                  setView('preview');
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 py-3.5 text-left shadow-sm active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
                  <BookOpen className="h-4.5 w-4.5 text-[#4a4a52] dark:text-zinc-200" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[#26262b] dark:text-zinc-100">《{t.title}》</span>
                  <span className="block text-[11.5px] text-[#9a9aa2] dark:text-zinc-400">{t.questions.length} 题 · {fmtDate(t.at)} · 点此预览作答</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf] dark:text-zinc-500" />
              </button>
            ))}
          </div>
        )}
      </SubShell>
    );
  }

  // ---------- 我的卷子·成绩详情（第二十一轮：随时回看做过的卷子） ----------
  if (view === 'mineDetail' && mineSel) {
    const h = mineSel;
    const perScore = h.questions.length > 0 ? 100 / h.questions.length : 0;
    const fmtScore = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    return (
      <SubShell title="试卷详情" onBack={() => setView('mine')}>
        <div className="mt-3 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-5 text-center shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
          <div className="text-[13px] font-medium text-[#9a9aa2] dark:text-zinc-400">《{h.title}》</div>
          <div className="mt-2 flex items-end justify-center gap-1.5">
            <span className="text-[52px] font-extrabold leading-none text-[#26262b] dark:text-zinc-100">{h.score}</span>
            <span className="pb-1.5 text-[15px] text-[#9a9aa2] dark:text-zinc-400">分</span>
            <Medal className="mb-1.5 h-6 w-6 text-[#f5c33c]" strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="mt-1 text-[15px] font-semibold text-[#4a4a52] dark:text-zinc-200">{gradeLabel(h.score)}</div>
          <div className="mt-4 rounded-xl bg-[#f7f7f9] dark:bg-zinc-900/70 px-4 py-3 text-left">
            <div className="text-[12px] font-bold text-[#26262b] dark:text-zinc-100">{ta} 的批语</div>
            <div className="mt-1 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">{h.comment}</div>
          </div>
          <div className="mt-2 text-[11px] text-[#c9c9cf] dark:text-zinc-500">{h.byTa ? `${ta} 出的卷 · ` : ''}交卷时间 {fmtDateCn(fmtDate(h.at))}</div>
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="px-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100">逐题回顾</div>
          {h.questions.map((q, i) => {
            const my = h.answers[String(i)];
            const best = q.best;
            return (
              <div key={i} className="rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3.5 py-2.5 text-[12.5px] shadow-sm">
                <div className="font-medium text-[#26262b] dark:text-zinc-100">
                  {i + 1}. {q.q}
                  <span className="ml-1 text-[11px] font-normal text-[#9a9aa2] dark:text-zinc-400">（{fmtScore(perScore)}分）</span>
                </div>
                <div className="mt-1 text-[#6e6e76] dark:text-zinc-300">
                  你答：<span className={my === best ? 'font-semibold text-[#3d9a63]' : 'text-[#e0607e]'}>{my != null && q.opts[my] ? q.opts[my] : '（未答）'}</span>
                </div>
                {my !== best && <div className="text-[#3d9a63]">更好：{best >= 0 && q.opts[best] ? q.opts[best] : ''}</div>}
              </div>
            );
          })}
        </div>
        <div className="mb-2 mt-5 flex gap-2.5">
          <button type="button" onClick={() => setView('mine')} className="h-12 flex-1 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 ring-1 ring-[#dcdce2] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70">
            返回我的卷子
          </button>
          <button type="button" onClick={() => setView('bank')} className="h-12 flex-1 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 active:opacity-85">
            返回题库
          </button>
        </div>
      </SubShell>
    );
  }

  // ---------- 题库视图（参考图4：官方推荐题库 + 模板卡 + TA 的邀请/答卷入口） ----------
  return (
    <SubShell title="恋爱水平考试" onBack={close} right={state.examBest != null ? <span className="text-[13px] text-[#9a9aa2] dark:text-zinc-400">最高 {state.examBest} 分</span> : undefined}>
      <h1 className="mt-3 px-1 text-center text-[30px] font-black tracking-[0.06em] text-[#26262b] dark:text-zinc-100">恋爱水平考试</h1>

      {/* 第二十一轮：左上角「我的卷子」+ 右上角「更新」（重新生成更多 AI 卷） */}
      <div className="mt-3 flex items-center justify-between" data-testid="exam-bank-toolbar">
        <button
          type="button"
          data-testid="exam-mine"
          onClick={() => setView('mine')}
          className="flex h-10 items-center gap-1.5 rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 text-[13.5px] font-semibold text-[#26262b] dark:text-zinc-100 shadow-sm ring-1 ring-[#e9e9ee] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
        >
          <Folder className="h-4 w-4 text-[#4a4a52] dark:text-zinc-200" strokeWidth={2} />
          我的卷子
          {(state.examHistory ?? []).length > 0 && (
            <span className="rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-1.5 py-px text-[10.5px] font-bold text-[#6e6e76] dark:text-zinc-300">{(state.examHistory ?? []).length}</span>
          )}
        </button>
        <button
          type="button"
          data-testid="exam-refresh"
          aria-label="更新题库"
          onClick={() => {
            genFailRef.current = 0;
            void genMore();
          }}
          disabled={genBusy}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#6e6e76] dark:text-zinc-300 shadow-sm ring-1 ring-[#e9e9ee] dark:ring-white/10 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70 disabled:opacity-50"
        >
          {genBusy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <RefreshCcw className="h-4.5 w-4.5" strokeWidth={2} />}
        </button>
      </div>

      {/* 题库纸卡（装订圈 + 官方推荐题库 + 模板列表） */}
      <div className="mt-3 overflow-hidden rounded-lg bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="flex">
          <div className="flex w-8 shrink-0 flex-col items-center justify-around border-r border-[#e6e6ea] dark:border-white/10 py-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[#c9c9cf] dark:border-white/10 bg-[#f7f7f9] dark:bg-zinc-900/70" />
            ))}
          </div>
          <div className="min-w-0 flex-1 px-4 pb-5 pt-6">
            <div className="relative inline-block">
              <span className="text-[20px] font-black tracking-wide text-[#26262b] dark:text-zinc-100">官方推荐题库</span>
              <span className="absolute -bottom-0.5 left-0 h-[3px] w-[86%] -rotate-1 rounded-full bg-[#e23b3b]/85" aria-hidden="true" />
              <span className="ml-1.5 align-top text-[13px] text-[#9a9aa2] dark:text-zinc-400" aria-hidden="true">
                ✩
              </span>
            </div>
            <div className="mt-1.5 text-[12.5px] text-[#9a9aa2] dark:text-zinc-400">选一套题，考考另一半</div>

            <div className="mt-4 space-y-3.5">
              {EXAM_TPLS.map((t) => (
                <div key={t.id} className="relative rounded-[4px] border-[1.5px] border-[#3c3c42] dark:border-white/15 p-3.5">
                  {/* 四角装饰点 */}
                  {['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1'].map((pos) => (
                    <span key={pos} className={`absolute ${pos} h-2 w-2 rounded-full bg-white ring-1 ring-[#3c3c42] dark:ring-white/15`} aria-hidden="true" />
                  ))}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-[15.5px] font-bold leading-snug text-[#26262b] dark:text-zinc-100">{t.title}</div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11.5px] text-[#4a4a52] dark:text-zinc-200">
                      <span>共{t.questions.length}题</span>
                      <span className="text-[#d9d9de] dark:text-zinc-600">|</span>
                      <span>满分100分</span>
                      <span className="text-[#d9d9de] dark:text-zinc-600">|</span>
                      <span>{t.usage}</span>
                    </div>
                    <button
                      type="button"
                      data-testid={`exam-use-${t.id}`}
                      onClick={() => {
                        setPreview(t);
                        setView('preview');
                      }}
                      className="shrink-0 rounded-[3px] border-[1.5px] border-[#3c3c42] dark:border-white/15 px-4 py-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
                    >
                      使用
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* AI 出的卷子（第二十二轮：滑到底再上滑一下松手才生成，不再一滑就自动触发；卡片删「AI 新卷」标签；本区块以下内容全部移除） */}
      <div className="mt-4" onTouchStart={onBankTouchStart} onTouchEnd={onBankTouchEnd}>
        <div className="flex items-baseline justify-between px-1">
          <div className="text-[14px] font-bold text-[#26262b] dark:text-zinc-100">AI 出的卷子</div>
          <div className="text-[11px] text-[#9a9aa2] dark:text-zinc-400">滑到底后再上滑一下，松手生成新卷子</div>
        </div>
        {(state.examAiPapers ?? []).length === 0 && !genBusy && (
          <div className="mt-2 rounded-2xl border border-dashed border-[#e9d5da] dark:border-white/10 bg-white/60 dark:bg-zinc-800/70 py-6 text-center text-[12px] text-[#b6b6bd] dark:text-zinc-500">点右上角更新，或滑到底再上滑一下，AI 给你出新卷</div>
        )}
        <div className="mt-2.5 space-y-3">
          {(state.examAiPapers ?? []).map((t, idx) => (
            <div key={t.id} className="relative rounded-[4px] border-[1.5px] border-dashed border-[#3c3c42]/50 dark:border-white/15 bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl p-3.5" data-testid={`exam-ai-paper-${idx}`}>
              <div className="text-[15px] font-bold leading-snug text-[#26262b] dark:text-zinc-100">{t.title}</div>
              <div className="mt-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11.5px] text-[#4a4a52] dark:text-zinc-200">
                  <span>共{t.questions.length}题</span>
                  <span className="text-[#d9d9de] dark:text-zinc-600">|</span>
                  <span>满分100分</span>
                  <span className="text-[#d9d9de] dark:text-zinc-600">|</span>
                  <span>每题{t.questions.length > 0 ? (Number.isInteger(100 / t.questions.length) ? 100 / t.questions.length : (100 / t.questions.length).toFixed(1)) : 0}分</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreview({ id: t.id, title: t.title, usage: 'AI 新卷', notes: t.notes, questions: t.questions.map((q) => ({ ...q, best: -1 })) });
                    setView('preview');
                  }}
                  className="shrink-0 rounded-[3px] border-[1.5px] border-[#3c3c42] dark:border-white/15 px-4 py-1 text-[13.5px] font-bold text-[#26262b] dark:text-zinc-100 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
                >
                  使用
                </button>
              </div>
            </div>
          ))}
        </div>
        {genBusy && (
          <div className="mt-3 flex items-center justify-center gap-2 py-2 text-[12.5px] text-[#9a9aa2] dark:text-zinc-400" data-testid="exam-gen-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> AI 正在出新卷…
          </div>
        )}
        {!genBusy && (state.examAiPapers ?? []).length > 0 && <div className="py-4 text-center text-[11.5px] text-[#b6b6bd] dark:text-zinc-500">— 已经到底了 · 上滑一下松手生成新卷子 —</div>}
        {!genBusy && genFailRef.current >= 2 && (
          <button
            type="button"
            onClick={() => {
              genFailRef.current = 0;
              void genMore();
            }}
            className="mx-auto mb-2 mt-3 block rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-5 py-2 text-[12.5px] text-[#6e6e76] dark:text-zinc-300 ring-1 ring-[#e9e9ee] dark:ring-white/10"
          >
            生成遇到点小问题，点我再试一次
          </button>
        )}
      </div>
    </SubShell>
  );
}

/** 星座符号（占星文字符号，非 emoji）+ 元素色 */
const ZODIAC_GLYPH: Record<string, string> = { 白羊座: '♈', 金牛座: '♉', 双子座: '♊', 巨蟹座: '♋', 狮子座: '♌', 处女座: '♍', 天秤座: '♎', 天蝎座: '♏', 射手座: '♐', 摩羯座: '♑', 水瓶座: '♒', 双鱼座: '♓' };
const ZODIAC_ELEM_COLOR: Record<string, string> = { fire: '#f5a58e', earth: '#a9d0a4', air: '#e8c98a', water: '#9fc9c4' };
const ZODIAC_ELEM_NAME: Record<string, string> = { fire: '火象', earth: '土象', air: '风象', water: '水象' };

/** 星座缘分（第十九轮需求47重做）：用户配置的 API 模型按真实占星 + 人设记忆 + 最近聊天生成解读；星空卡 + 评分环 + 分区展示，结果持久化 */
function ZodiacPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void }) {
  const [me, setMe] = useState(state.zodiac?.me || '');
  const [ta, setTa] = useState(state.zodiac?.ta || '');
  const [loading, setLoading] = useState(false);
  const [errTick, setErrTick] = useState(0); // 生成失败重试钥匙
  const saved = state.zodiacReading;
  // 已保存的解读只在「星座组合一致」时展示（改了组合必须重新测算）
  const reading = saved && saved.me === me && saved.ta === ta ? saved : null;

  const calc = async () => {
    if (!me || !ta || loading) return;
    patch({ zodiac: { me, ta } });
    setLoading(true);
    let r: { score: number; text: string; glow: string; advice: string; watch: string } | null = null;
    try {
      r = await aiZodiacReading(me, ta);
    } catch {
      r = null;
    }
    if (!r) {
      // 本地兜底（LLM 不可用）：四元素相性给分 + 固定文案
      const s = zodiacScore(me, ta);
      r = {
        score: s,
        text: s >= 85 ? `${me}和${ta}相性极佳，天生一对，磁场完美契合。` : s >= 75 ? '互补吸引的一对，元素相生，越处越甜。' : '需要一点磨合，但爱能跨越一切差异。',
        glow: '彼此陪伴时的松弛感',
        advice: '每天留十分钟只聊彼此今天的心情，其它都先放一放。',
        watch: '别把「算了不说」挂在嘴边，小事也要讲开。',
      };
      setErrTick((t) => t + 1);
    }
    patch({ zodiacReading: { me, ta, ...r, at: Date.now() } });
    setLoading(false);
  };

  const score = reading?.score ?? (state.zodiac ? zodiacScore(state.zodiac.me, state.zodiac.ta) : 0);
  const ringLen = 2 * Math.PI * 44;
  const elemOf = (z: string) => ZODIAC_ELEM_COLOR[ZODIAC_GROUP[z] ?? 'air'] ?? '#e8c98a';

  return (
    <SubShell title="星座缘分" onBack={close}>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {[
          { label: '我的星座', v: me, set: setMe },
          { label: 'TA 的星座', v: ta, set: setTa },
        ].map((f) => (
          <div key={f.label}>
            <div className="mb-1.5 text-[13px] text-[#9a9aa2] dark:text-zinc-400">{f.label}</div>
            <select
              value={f.v}
              onChange={(e) => f.set(e.target.value)}
              className="h-11 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3 text-[15px] text-[#2c2c30] dark:text-zinc-100 outline-none"
            >
              <option value="">请选择</option>
              {ZODIAC_LIST.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void calc()}
        disabled={!me || !ta || loading}
        data-testid="zodiac-calc"
        className="mt-4 h-12 w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 disabled:opacity-40"
      >
        {loading ? '正在为你们测算缘分…' : reading ? '重新测算' : '查看缘分指数'}
      </button>

      {/* 星空解读卡 */}
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-[linear-gradient(165deg,#232633,#141722)] p-5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
        {/* 星点装饰 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[
            [12, 18, 1.6],
            [30, 8, 1.1],
            [55, 14, 1.4],
            [78, 6, 1.1],
            [88, 26, 1.6],
            [70, 40, 1],
            [18, 46, 1.1],
            [42, 30, 1],
          ].map(([l, t, s], i) => (
            <span key={i} className="absolute rounded-full bg-white [animation:couple-twinkle_3.4s_ease-in-out_infinite]" style={{ left: `${l}%`, top: `${t}%`, width: s, height: s, opacity: 0.5, animationDelay: `${i * 0.6}s` }} />
          ))}
        </div>

        {/* 头部：双星座徽章 + 评分环 */}
        <div className="relative flex items-center justify-between gap-2">
          {[
            { z: me, label: state.meName || '我' },
            { z: ta, label: state.taName || 'TA' },
          ].map((side, i) => (
            <div key={i} className="flex w-[92px] flex-col items-center gap-1.5">
              <span
                className="flex h-[58px] w-[58px] items-center justify-center rounded-full border-2 text-[26px] font-semibold"
                style={{ borderColor: side.z ? elemOf(side.z) : 'rgba(255,255,255,0.25)', color: side.z ? elemOf(side.z) : 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)' }}
              >
                {side.z ? ZODIAC_GLYPH[side.z] ?? '☆' : '?'}
              </span>
              <span className="text-[12.5px] font-medium text-white/90">{side.label}</span>
              <span className="text-[11px] text-white/55">{side.z ? `${side.z} · ${ZODIAC_ELEM_NAME[ZODIAC_GROUP[side.z]] ?? ''}` : '未选择'}</span>
            </div>
          ))}
          {/* 评分环 */}
          <div className="relative flex h-[104px] w-[104px] shrink-0 items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
              {score > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="url(#zodiac-ring)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={`${(ringLen * score) / 100} ${ringLen}`}
                  className="transition-[stroke-dasharray] duration-700"
                />
              )}
              <defs>
                <linearGradient id="zodiac-ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#c9c9cf" />
                  <stop offset="1" stopColor="#5c5c64" />
                </linearGradient>
              </defs>
            </svg>
            <div className="text-center">
              {loading ? (
                <div className="h-[26px] w-12 animate-pulse rounded bg-white/15" />
              ) : (
                <div className="text-[27px] font-bold leading-none">{score || '--'}</div>
              )}
              <div className="mt-1 text-[10.5px] text-white/55">配对指数</div>
            </div>
          </div>
        </div>

        {/* 加载骨架 */}
        {loading && (
          <div className="relative mt-5 space-y-2.5" data-testid="zodiac-loading">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/12" />
            <div className="h-3.5 w-full animate-pulse rounded bg-white/10" />
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/10" />
            <div className="pt-1 text-center text-[12px] text-white/50">正在结合真实占星与你们的记忆测算…</div>
          </div>
        )}

        {/* 解读正文 */}
        {reading && !loading && (
          <div className="relative mt-5 space-y-3.5" data-testid="zodiac-reading">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#f7b7c5]">
                <Heart className="h-4 w-4" strokeWidth={2.2} />
                缘分总评
              </div>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/88">{reading.text}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#e8c98a]">
                <Sparkles className="h-4 w-4" strokeWidth={2.2} />
                最合拍的一点
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/85">{reading.glow}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#a9d0a4]">
                <Lightbulb className="h-4 w-4" strokeWidth={2.2} />
                相处建议
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/85">{reading.advice}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#9fc9c4]">
                <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
                温柔小提醒
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-white/85">{reading.watch}</p>
            </div>
            {errTick > 0 && reading.at && Date.now() - reading.at < 90_000 && (
              <div className="text-center text-[11px] text-white/35">刚刚这次用了本地速算，点「重新测算」可获得 AI 解读</div>
            )}
          </div>
        )}

        {/* 未测算占位 */}
        {!reading && !loading && (
          <div className="relative mt-5 text-center text-[13px] leading-relaxed text-white/45">
            选好两个人的星座，看看真实的占星怎么说
            <br />
            解读会结合你们的记忆和最近聊过的话题
          </div>
        )}
      </div>
    </SubShell>
  );
}

/** 恋爱编年史状态色（参考图2：暗恋/暧昧/恋爱/分手/复合/结婚 多彩淡色块） */
const CHRON_STATUSES: { key: string; bg: string; fg: string }[] = [
  { key: '暗恋', bg: '#fff3d6', fg: '#c08a1f' },
  { key: '暧昧', bg: '#ffe1e9', fg: '#e0607e' },
  { key: '恋爱', bg: '#ffe6df', fg: '#e06a4a' },
  { key: '分手', bg: '#eae6fb', fg: '#8071cf' },
  { key: '复合', bg: '#ffedd4', fg: '#d68f2c' },
  { key: '结婚', bg: '#e0f2df', fg: '#3f9e54' },
];

/** 恋爱编年史（第八轮重做，参考图2/3）：年×月状态表格 + 关键月份编辑器（自动补全年内月份）+ 恋爱大事记 */
function ChroniclePage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const now = new Date();
  const [editing, setEditing] = useState(false);
  const [showcase, setShowcase] = useState(false); // 生成后的结果展示页（参考图3：保存完整图片/分享给朋友）
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<{ y: number; m: number; status: string }[]>(() => [
    { y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' },
  ]);

  /** 已保存的关键月份（按时间升序） */
  const months = useMemo(() => [...state.chronicleMonths].sort((a, b) => a.ym.localeCompare(b.ym)), [state.chronicleMonths]);

  /** 年份列：出现过的年份 + 当前年（参考图2 起止由用户选择决定） */
  const years = useMemo(() => {
    const set = new Set<number>(months.map((m) => Number(m.ym.slice(0, 4))));
    set.add(now.getFullYear());
    return [...set].sort((a, b) => a - b);
  }, [months]);

  /** 补全规则：某年某月显示「≤ 该月的最近一次关键选择」的状态；之前没有任何选择 → —（跨年同样延续） */
  const statusAt = (y: number, mi: number): string | null => {
    const target = y * 12 + (mi + 1);
    let cur: string | null = null;
    for (const it of months) {
      const k = Number(it.ym.slice(0, 4)) * 12 + Number(it.ym.slice(5, 7));
      if (k <= target) cur = it.status;
    }
    return cur;
  };

  /** 编辑器：年份候选（2016 ~ 当前年+1，参考图3 从 2016 起可选） */
  const yearOpts = useMemo(() => {
    const arr: number[] = [];
    for (let y = 2016; y <= now.getFullYear() + 1; y++) arr.push(y);
    return arr;
  }, []);

  const statusMeta = (s: string) => CHRON_STATUSES.find((x) => x.key === s) ?? CHRON_STATUSES[0];

  const saveDraft = () => {
    const seen = new Set<string>();
    const list = [...draft]
      .sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m))
      .map((it) => ({ ym: `${it.y}-${String(it.m).padStart(2, '0')}`, status: it.status }))
      .filter((it) => {
        if (seen.has(it.ym)) return false;
        seen.add(it.ym);
        return true;
      });
    if (list.length === 0) {
      showToast('先选择至少一个月份');
      return;
    }
    patch({ chronicleMonths: list });
    setEditing(false);
    setShowcase(true);
    showToast('恋爱编年史已生成 ♡');
  };

  /** 年×月状态表格（结果卡与展示页共用；参考图2/3 样式） */
  const chronTable = (
    <table className="border-separate border-spacing-0 text-center" style={{ minWidth: years.length > 3 ? 96 * Math.min(years.length + 1, 7) : 320 }}>
      <thead>
        <tr>
          <th className="sticky left-0 z-10 bg-[#fff7f8] dark:bg-zinc-900/70 px-1.5 py-2 text-[12px] font-semibold text-[#a4889a] dark:text-rose-200/75">月份</th>
          {years.map((y) => (
            <th key={y} className="px-1.5 py-2 text-[13px] font-bold text-[#3c3c42] dark:text-zinc-200">
              {y}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 12 }, (_, mi) => (
          <tr key={mi} className={mi % 2 === 1 ? 'bg-[#fffafb] dark:bg-zinc-900/60' : ''}>
            <td className="sticky left-0 z-10 bg-inherit px-1.5 py-[3px] text-[11.5px] text-[#a4889a] dark:text-rose-200/75">{mi + 1}月</td>
            {years.map((y) => {
              const st = statusAt(y, mi);
              const meta = st ? CHRON_STATUSES.find((s) => s.key === st) : undefined;
              return (
                <td key={y} className="px-[2px] py-[3px]">
                  <span
                    className="mx-auto block w-fit whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-medium"
                    style={meta ? { background: meta.bg, color: meta.fg } : { color: '#cbb8bf' }}
                  >
                    {meta ? meta.key : '—'}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  // ---------------- 编辑视图（参考图3） ----------------
  if (editing) {
    return (
      <SubShell title="恋爱编年史" onBack={() => setEditing(false)}>
        <div className="mt-5 text-center">
          <div className="text-[21px] font-extrabold text-[#26262b] dark:text-zinc-100">选择几个感情变化的月份</div>
          <div className="mt-1.5 text-[12.5px] text-[#9a9aa2] dark:text-zinc-400">系统会自动补全年内月份</div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#f6e3e7] dark:border-white/10 bg-white/70 dark:bg-zinc-800/78 p-3.5" data-testid="chronicle-edit">
          {draft.map((it, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-[#26262b] dark:border-white/15 bg-white" />
              <div className="flex flex-1 items-center gap-1 rounded-xl border border-[#f3d9df] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-2.5 py-2">
                <select
                  value={it.y}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, y: Number(e.target.value) } : x)))}
                  className="bg-transparent text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 outline-none"
                  aria-label="年份"
                >
                  {yearOpts.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="text-[#9a9aa2] dark:text-zinc-400">.</span>
                <select
                  value={it.m}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, m: Number(e.target.value) } : x)))}
                  className="bg-transparent text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 outline-none"
                  aria-label="月份"
                >
                  {Array.from({ length: 12 }, (_, mi) => (
                    <option key={mi + 1} value={mi + 1}>
                      {String(mi + 1).padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <select
                  value={it.status}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}
                  className="ml-auto rounded-full px-2.5 py-1 text-[12.5px] font-semibold outline-none"
                  style={{ background: statusMeta(it.status).bg, color: statusMeta(it.status).fg }}
                  aria-label="状态"
                >
                  {CHRON_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.key}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-label={`删除第${i + 1}条`}
                data-testid="chronicle-remove-row"
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-bold text-[#26262b] dark:text-zinc-100 active:opacity-60"
              >
                −
              </button>
            </div>
          ))}
          <div className="py-2 pl-6">
            <button
              type="button"
              data-testid="chronicle-add-row"
              onClick={() => setDraft((d) => [...d, { y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' }])}
              className="w-full rounded-xl border-2 border-dashed border-[#3c3c42] dark:border-white/15 bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl py-2.5 text-[14px] font-medium text-[#26262b] dark:text-zinc-100 active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
            >
              ＋ 继续添加月份（可选）
            </button>
          </div>
        </div>

        <button
          type="button"
          data-testid="chronicle-generate"
          onClick={saveDraft}
          className="mb-2 mt-6 flex h-[52px] w-full items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98]"
        >
          生成我的编年史
        </button>
      </SubShell>
    );
  }

  // ---------------- 结果展示页（参考图3：白底居中标题 + 横向滑动表格 + 保存/分享） ----------------
  if (showcase) {
    return (
      <SubShell title="恋爱编年史" onBack={() => setShowcase(false)}>
        <div className="mt-5 text-center">
          <div className="text-[22px] font-extrabold tracking-wide text-[#26262b] dark:text-zinc-100">我的恋爱编年史</div>
          <div className="mt-2 text-[13.5px] text-[#9a9aa2] dark:text-zinc-400">每一段经历，都是我们共同的记忆</div>
          <div className="mt-2.5 flex items-center justify-center gap-1 text-[12px] font-medium text-[#26262b] dark:text-zinc-100">
            <span aria-hidden="true">↔</span> 左右滑动查看完整年份
          </div>
        </div>
        <div className="mt-4 overflow-x-auto pb-2" data-testid="chronicle-showcase-table">
          {chronTable}
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="chronicle-save-img"
            onClick={() => showToast('结果图已生成，长按表格即可保存 ♡')}
            className="flex h-[52px] flex-1 items-center justify-center rounded-2xl border-2 border-[#e7dfe2] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[15.5px] font-semibold text-[#3c3c42] dark:text-zinc-200 shadow-sm transition-transform active:scale-[0.98]"
          >
            保存完整图片
          </button>
          <button
            type="button"
            data-testid="chronicle-share"
            onClick={() => showToast('已生成分享卡片，发给那个TA吧 ♡')}
            className="flex h-[52px] flex-1 items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98]"
          >
            分享给朋友
          </button>
        </div>
        <div className="mt-6 pb-4 text-center text-[13.5px]">
          <button type="button" onClick={() => setShowcase(false)} className="text-[#8e8e96] dark:text-zinc-400 underline underline-offset-4 active:opacity-60">
            返回修改
          </button>
          <span className="mx-4 text-[#e5d3d8] dark:text-rose-200/55">|</span>
          <button type="button" onClick={close} className="text-[#26262b] dark:text-zinc-100 underline underline-offset-4 active:opacity-60">
            回到恋人空间
          </button>
        </div>
      </SubShell>
    );
  }

  // ---------------- 结果视图（参考图2：粉色主题 + 表格卡 + 怎么玩 + 开始制作） ----------------
  return (
    <SubShell title="恋爱编年史" onBack={close}>
      <div className="-mx-3.5 -mb-8 min-h-full bg-[#fdf0f3] dark:bg-zinc-900 px-3.5 pb-8 pt-3">
        {/* 头部 */}
        <div className="mt-2 px-1">
          <div className="flex items-start gap-2.5">
            <span className="mt-1 shrink-0">
              <PixelHeart size={30} />
            </span>
            <h2 className="text-[21px] font-extrabold leading-snug text-[#26262b] dark:text-zinc-100">
              记录几个关键月份，
              <br />
              生成你的<span className="text-[#26262b] dark:text-zinc-100">恋爱编年史</span>
            </h2>
          </div>
          <p className="mt-2 pl-[42px] text-[13px] text-[#a4889a] dark:text-rose-200/75">用一张表，记录感情里的重要时刻</p>
        </div>

        {/* 结果表格卡 */}
        <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]" data-testid="chronicle-table-card">
          <div className="flex items-center justify-between">
            <div className="text-[14.5px] font-bold text-[#26262b] dark:text-zinc-100">
              我的恋爱编年史 <span className="text-[12px]">💗</span>
            </div>
            {months.length > 0 && (
              <button
                type="button"
                data-testid="chronicle-view-showcase"
                onClick={() => setShowcase(true)}
                className="text-[12.5px] font-medium text-[#26262b] dark:text-zinc-100 active:opacity-60"
              >
                查看结果图 ›
              </button>
            )}
          </div>
          <div className="mt-3 overflow-x-auto pb-1" data-testid="chronicle-table">
            {chronTable}
          </div>
          {months.length === 0 && <div className="mt-2 text-center text-[12px] text-[#c9aeb6] dark:text-rose-200/55">还没有关键月份，点下方「开始制作」记录第一段感情线吧</div>}
        </div>

        {/* 怎么玩 */}
        <div className="mt-7 text-center text-[17px] font-bold text-[#26262b] dark:text-zinc-100">✦ 怎么玩？ ✦</div>
        <div className="mt-3 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
          {[
            { n: '1', icon: <CalendarDays className="h-6 w-6" strokeWidth={1.8} />, bg: '#fde7ee', fg: '#f0609a', label: '选择关键月份', desc: '记录感情里发生变化的时间点' },
            { n: '2', icon: <Heart className="h-6 w-6" strokeWidth={1.8} />, bg: '#ece6fb', fg: '#8071cf', label: '选择对应状态', desc: '比如暗恋、暧昧、恋爱、分手、复合' },
            { n: '3', icon: <Sparkles className="h-6 w-6" strokeWidth={1.8} />, bg: '#e2f5e2', fg: '#3f9e54', label: '生成结果图', desc: '保存或分享给朋友' },
          ].map((s, i) => (
            <div key={s.n} className={`flex items-center gap-3.5 py-3.5 ${i > 0 ? 'border-t border-[#f6e7ea] dark:border-white/10' : ''}`}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: s.bg, color: s.fg }}>
                {s.icon}
              </span>
              <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[10.5px] font-bold text-white">{s.n}</span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-[#26262b] dark:text-zinc-100">{s.label}</span>
                <span className="block text-[12px] text-[#c0a3ab]">{s.desc}</span>
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          data-testid="chronicle-start"
          onClick={() => {
            setDraft(
              months.length > 0
                ? months.map((it) => ({ y: Number(it.ym.slice(0, 4)), m: Number(it.ym.slice(5, 7)), status: it.status }))
                : [{ y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' }],
            );
            setEditing(true);
          }}
          className="mb-1 mt-6 flex h-[56px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[18px] font-semibold text-white shadow-[0_6px_18px_rgba(242,83,106,0.32)] transition-transform active:scale-[0.98]"
        >
          开始制作 ✨
        </button>

        {/* 恋爱大事记（原编年史事件：情侣轨迹弹层同步引用） */}
        <div className="mt-9">
          <div className="text-[16px] font-bold text-[#26262b] dark:text-zinc-100">恋爱大事记</div>
          <div className="text-[12px] text-[#a4889a] dark:text-rose-200/75">值得记住的时刻，也一条条留在这里</div>
          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) {
                  patch({ chronicle: [{ id: uid(), text: text.trim(), at: Date.now() }, ...state.chronicle] });
                  setText('');
                  showToast('已写入大事记 ✍️');
                }
              }}
              placeholder="记录一件值得记住的小事…"
              maxLength={40}
              className="h-11 flex-1 rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-3.5 text-[15px] shadow-sm outline-none placeholder:text-[#c9aeb6] dark:placeholder:text-rose-200/55"
            />
            <button
              type="button"
              data-testid="chronicle-add-event"
              onClick={() => {
                const t = text.trim();
                if (!t) return;
                patch({ chronicle: [{ id: uid(), text: t, at: Date.now() }, ...state.chronicle] });
                setText('');
                showToast('已写入大事记 ✍️');
              }}
              className="h-11 rounded-xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-5 text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10"
            >
              记录
            </button>
          </div>
          {state.chronicle.length === 0 ? (
            <div className="mt-8 text-center text-[14px] text-[#c9aeb6] dark:text-rose-200/55">时间线还是空的，从今天开始记录吧</div>
          ) : (
            <div className="mt-5 space-y-0">
              {state.chronicle.map((c, i) => (
                <div key={c.id} className="relative flex gap-4 pb-6">
                  {i < state.chronicle.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-5 h-full w-[2px] bg-[#f0dce1] dark:bg-white/10" />}
                  <span className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full border-[3px] border-[#eba7b6] bg-white" />
                  <div className="flex-1 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_6px_18px_rgba(0,0,0,0.07)]">
                    <div className="text-[13px] text-[#a4889a] dark:text-rose-200/75">{fmtDate(c.at)}</div>
                    <div className="mt-1 text-[15px] leading-relaxed text-[#2c2c30] dark:text-zinc-100">{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SubShell>
  );
}

/** 三生石（参考图5）：深蓝星空 + 发光水晶 + 竖排名牌 + 缔结名簿 */
const STONE_NAMES = ['陈文冲', '陆湘玲', '蔡慧欣', '彭书源', '吴艳婷', '曾予彬', '宋嘉萍', '陈嘉佑', '徐梓馨', '蒋东兴', '刘简清', '肖丰初', '袁欣菲', '饶兴国', '何方珊', '徐溢涵', '黄静璐', '谭鑫磊', '黄新连', '蒙金玉', '王鑫雨', '王巍', '周子涵', '玉玲', '薛名言', '艾海洋', '杨春艳', '蔡一晨', '姜睿磊'];

/** 竖排名字牌 */
function NameTag({ name, style, hot = false, delay = 0 }: { name: string; style?: React.CSSProperties; hot?: boolean; delay?: number }) {
  return (
    <span
      className={`pointer-events-none absolute flex items-center justify-center rounded-[7px] px-[3px] py-2 text-[13px] tracking-[3px] ${
        hot
          ? 'z-10 border border-[#ffd9a8]/80 bg-[linear-gradient(180deg,rgba(255,214,150,0.34),rgba(255,170,190,0.22))] text-[#ffe9c8] shadow-[0_0_16px_rgba(255,190,120,0.5)]'
          : 'border border-white/20 bg-white/[0.08] text-white/85 backdrop-blur-[2px]'
      } [writing-mode:vertical-rl] [animation:couple-float-y_4s_ease-in-out_infinite]`}
      style={{ ...style, animationDelay: `${delay}s` }}
    >
      {name}
    </span>
  );
}

function StonePage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [sheet, setSheet] = useState<'none' | 'explain' | 'ours'>('none');
  const engraved = state.stoneEngraved;
  const me = state.meName || '我';
  const ta = state.taName || 'TA';
  /** 名牌布局：左右两列 + 底部一行（参考图散布） */
  const tagSpots: { l: string; t: string; d: number }[] = [
    { l: '4%', t: '17%', d: 0 }, { l: '13%', t: '19%', d: 0.6 },
    { l: '27%', t: '15%', d: 1.1 }, { l: '36%', t: '18%', d: 0.3 },
    { l: '60%', t: '15%', d: 0.8 }, { l: '70%', t: '17%', d: 1.4 },
    { l: '4%', t: '46%', d: 0.5 }, { l: '13%', t: '48%', d: 1.2 },
    { l: '27%', t: '44%', d: 0.2 }, { l: '36%', t: '47%', d: 0.9 },
    { l: '60%', t: '44%', d: 1.5 }, { l: '70%', t: '46%', d: 0.4 },
    { l: '86%', t: '47%', d: 1.0 },
  ];
  const bottomSpots = engraved
    ? [
        { name: me, hot: true, l: '30%', t: '72%', d: 0.2 },
        { name: ta, hot: true, l: '42%', t: '73%', d: 0.7 },
      ]
    : [
        { name: STONE_NAMES[24], hot: false, l: '8%', t: '70%', d: 0.3 },
        { name: STONE_NAMES[25], hot: false, l: '17%', t: '72%', d: 0.8 },
        { name: STONE_NAMES[26], hot: false, l: '30%', t: '70%', d: 0.2 },
        { name: STONE_NAMES[27], hot: false, l: '39%', t: '72%', d: 0.6 },
        { name: STONE_NAMES[28], hot: false, l: '52%', t: '70%', d: 1.1 },
      ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#141f3a_0%,#1d3054_34%,#31507e_62%,#5f82ac_86%,#8aa8c8_100%)]">
      {/* ===== 星空背景 ===== */}
      {[
        ['8%', '8%', 2], ['20%', '5%', 1.4], ['38%', '9%', 1.8], ['55%', '4%', 1.2], ['72%', '10%', 2.2], ['88%', '6%', 1.5],
        ['12%', '30%', 1.3], ['93%', '26%', 1.9], ['6%', '55%', 1.6], ['95%', '62%', 1.4], ['30%', '38%', 1.1], ['66%', '36%', 1.3],
      ].map(([l, t, s], i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute rounded-full bg-white [animation:couple-twinkle_2.6s_ease-in-out_infinite]"
          style={{ left: l as string, top: t as string, width: `${s}px`, height: `${s}px`, animationDelay: `${(i % 5) * 0.5}s` }}
        />
      ))}
      {/* 星轨弧线 */}
      <svg aria-hidden="true" viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-25">
        <circle cx="200" cy="300" r="190" fill="none" stroke="#9fc3e8" strokeWidth="0.8" strokeDasharray="3 7" />
        <circle cx="200" cy="300" r="250" fill="none" stroke="#9fc3e8" strokeWidth="0.6" strokeDasharray="2 9" />
        <circle cx="200" cy="300" r="130" fill="none" stroke="#b8d4ee" strokeWidth="0.7" strokeDasharray="4 8" />
      </svg>
      {/* 流星（周期性划过） */}
      <span aria-hidden="true" className="absolute left-[6%] top-[14%] h-[2px] w-20 rounded-full bg-[linear-gradient(90deg,transparent,#cfe8ff,#fff)] opacity-0 shadow-[0_0_8px_rgba(190,225,255,0.9)] [animation:couple-shoot_6s_ease-in_1.2s_infinite]" />
      <span aria-hidden="true" className="absolute left-[52%] top-[8%] h-[2px] w-14 rounded-full bg-[linear-gradient(90deg,transparent,#ffe9c8,#fff)] opacity-0 shadow-[0_0_8px_rgba(255,225,180,0.9)] [animation:couple-shoot_8s_ease-in_4.5s_infinite]" />
      {/* 星尘飘落 */}
      {[
        ['16%', 0], ['30%', 1.4], ['55%', 2.6], ['70%', 0.8], ['84%', 2], ['44%', 3.4],
      ].map(([l, d], i) => (
        <span
          key={`dust${i}`}
          aria-hidden="true"
          className="absolute top-0 h-1 w-1 rounded-full bg-[#cfe8ff] shadow-[0_0_6px_rgba(170,215,255,0.9)] [animation:couple-fall_9s_linear_infinite]"
          style={{ left: l as string, animationDelay: `${d}s` }}
        />
      ))}
      {/* 底部远山 + 云雾 */}
      <span aria-hidden="true" className="absolute bottom-[13%] -left-10 h-24 w-72 rounded-[50%] bg-[#243b60]/90 blur-[3px]" />
      <span aria-hidden="true" className="absolute bottom-[15%] -right-14 h-28 w-80 rounded-[50%] bg-[#2a4568]/90 blur-[3px]" />
      <span aria-hidden="true" className="absolute bottom-[6%] left-0 right-0 h-24 bg-[linear-gradient(180deg,transparent,rgba(180,205,230,0.35))]" />

      {/* ===== 顶部：返回 + 标题 + 右侧菱形钮（整体避开状态栏） ===== */}
      <div className="relative z-30 shrink-0 pt-[58px]">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[64px] flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-[#9fc3e8]/60 bg-[#2a4a78]/70 shadow-[0_0_12px_rgba(120,180,240,0.35)] transition-transform active:scale-90"
        >
          <ArrowLeft className="h-5 w-5 -rotate-45 text-[#d8e8f8]" strokeWidth={2.4} />
        </button>
        <div className="text-center text-[19px] font-semibold tracking-[2px] text-[#cfe2f5] [text-shadow:0_0_14px_rgba(140,190,240,0.65)]">
          缔<span className="mx-0.5 text-[#7d9cc4]">/</span>结<span className="mx-0.5 text-[#7d9cc4]">/</span>名<span className="mx-0.5 text-[#7d9cc4]">/</span>簿
          <span className="mx-3" />
          缘<span className="mx-0.5 text-[#7d9cc4]">/</span>定<span className="mx-0.5 text-[#7d9cc4]">/</span>三<span className="mx-0.5 text-[#7d9cc4]">/</span>生
        </div>
        {/* 右侧两个菱形按钮 */}
        <div className="absolute right-4 top-[128px] flex flex-col items-center gap-6">
          <button type="button" onClick={() => setSheet('explain')} className="group flex flex-col items-center transition-transform active:scale-90">
            <span className="flex h-11 w-11 rotate-45 items-center justify-center rounded-[12px] border border-[#9fc3e8]/70 bg-[linear-gradient(135deg,rgba(150,190,235,0.4),rgba(70,110,170,0.4))] shadow-[0_0_14px_rgba(120,180,240,0.45)] backdrop-blur-[2px]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-45 text-[#e8f2fc]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
            </span>
            <span className="mt-2 text-[13px] font-medium text-[#dce9f8] [text-shadow:0_0_8px_rgba(140,190,240,0.8)]">说明</span>
          </button>
          <button type="button" onClick={() => setSheet('ours')} className="flex flex-col items-center transition-transform active:scale-90">
            <span className="flex h-11 w-11 rotate-45 items-center justify-center rounded-[12px] border border-[#9fc3e8]/70 bg-[linear-gradient(135deg,rgba(150,190,235,0.4),rgba(70,110,170,0.4))] shadow-[0_0_14px_rgba(120,180,240,0.45)] backdrop-blur-[2px]">
              <Heart className="h-5 w-5 -rotate-45 text-[#e8f2fc]" strokeWidth={2} fill="rgba(232,242,252,0.85)" />
            </span>
            <span className="mt-2 text-[14px] font-medium text-[#e4eefa] [text-shadow:0_0_8px_rgba(140,190,240,0.8)]">我们的名字</span>
          </button>
        </div>
      </div>

      {/* ===== 中部：发光水晶 + 名牌 ===== */}
      <div className="relative z-10 flex-1">
        {/* 名牌（水晶两侧，inline style 定位避免动态类名被裁剪） */}
        {tagSpots.map((s, i) => (
          <NameTag key={i} name={STONE_NAMES[i % STONE_NAMES.length]} style={{ left: s.l, top: s.t }} delay={s.d} />
        ))}
        {bottomSpots.map((s, i) => (
          <NameTag key={`b${i}`} name={s.name} hot={s.hot} style={{ left: s.l, top: s.t }} delay={s.d} />
        ))}

        {/* 水晶主体 */}
        <div className="absolute left-1/2 top-[10%] h-[78%] -translate-x-1/2">
          {/* 外发光 */}
          <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-[110%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(120,190,255,0.5),rgba(120,190,255,0.12)_55%,transparent_75%)] [animation:couple-glow-pulse_3.4s_ease-in-out_infinite]" />
          <svg viewBox="0 0 200 320" className="relative h-full w-auto drop-shadow-[0_0_24px_rgba(110,180,250,0.55)]" aria-hidden="true">
            <defs>
              <linearGradient id="cgTop" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f2fbff" />
                <stop offset="100%" stopColor="#9cccef" />
              </linearGradient>
              <linearGradient id="cgL" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b5d9f4" />
                <stop offset="100%" stopColor="#4d84c4" />
              </linearGradient>
              <linearGradient id="cgR" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8fc0ea" />
                <stop offset="100%" stopColor="#2a5a9a" />
              </linearGradient>
              <linearGradient id="cgCore" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8f6ff" />
                <stop offset="50%" stopColor="#7fb3e6" />
                <stop offset="100%" stopColor="#3a6ca8" />
              </linearGradient>
            </defs>
            <polygon points="100,6 152,84 100,128 48,84" fill="url(#cgTop)" />
            <polygon points="48,84 100,128 74,238 100,314 100,128" fill="url(#cgL)" opacity="0.95" />
            <polygon points="152,84 100,128 100,314 128,236" fill="url(#cgR)" />
            <polygon points="100,128 74,238 100,314" fill="url(#cgCore)" opacity="0.75" />
            <polygon points="100,128 128,236 100,314" fill="#1d4a80" opacity="0.55" />
            <polyline points="48,84 100,128 152,84" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.85" />
            <line x1="100" y1="6" x2="100" y2="314" stroke="#ffffff" strokeWidth="1.1" opacity="0.5" />
            <line x1="48" y1="84" x2="74" y2="238" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
            <line x1="152" y1="84" x2="128" y2="236" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
            <ellipse cx="78" cy="60" rx="16" ry="9" fill="#ffffff" opacity="0.5" transform="rotate(-30 78 60)" />
          </svg>
          {/* 内部闪光粒子 */}
          {[['40%', '22%', 0], ['58%', '34%', 0.8], ['46%', '52%', 1.6], ['55%', '66%', 0.4]].map(([l, t, d], i) => (
            <span key={i} aria-hidden="true" className="absolute h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_#bfe0ff] [animation:couple-twinkle_2.2s_ease-in-out_infinite]" style={{ left: l, top: t, animationDelay: `${d}s` }} />
          ))}
        </div>
        {/* 刻名后：名字浮现于水晶之上（暖光竖排） */}
        {engraved && (
          <div className="absolute left-1/2 top-[34%] z-10 flex -translate-x-1/2 items-start gap-5">
            <span className="rounded-md border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.18)] px-1.5 py-2 text-[15px] font-semibold tracking-[3px] text-[#ffe9c8] shadow-[0_0_14px_rgba(255,190,120,0.4)] backdrop-blur-[1px] [animation:couple-float-y_4s_ease-in-out_infinite] [writing-mode:vertical-rl]">
              {me}
            </span>
            <span aria-hidden="true" className="mt-4 text-[13px] text-[#ffd98a] [animation:couple-twinkle_2.4s_ease-in-out_infinite]">
              ✦
            </span>
            <span className="rounded-md border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.18)] px-1.5 py-2 text-[15px] font-semibold tracking-[3px] text-[#ffe9c8] shadow-[0_0_14px_rgba(255,190,120,0.4)] backdrop-blur-[1px] [animation:couple-float-y_4s_ease-in-out_infinite_0.8s] [writing-mode:vertical-rl]">
              {ta}
            </span>
          </div>
        )}
        {/* 底部倒影光斑 */}
        <span aria-hidden="true" className="absolute bottom-[4%] left-1/2 h-10 w-56 -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(160,210,255,0.4),transparent)]" />
      </div>

      {/* ===== 底部：刻名按钮 + 说明文字 ===== */}
      <div className="relative z-20 shrink-0 px-8 pb-7">
        <button
          type="button"
          onClick={() => {
            if (engraved) {
              setSheet('ours');
              return;
            }
            patch({ stoneEngraved: true });
            showToast('名字已刻上三生石，缘定三生 💍');
          }}
          className={`relative h-[52px] w-full rounded-xl border text-[19px] font-bold tracking-[6px] backdrop-blur-sm transition-transform active:scale-[0.98] ${
            engraved
              ? 'border-[#ffd9a8]/70 bg-[rgba(255,200,130,0.16)] text-[#ffe9c8] shadow-[0_0_18px_rgba(255,190,120,0.35)]'
              : 'border-[#a8ccf0]/70 bg-[rgba(110,160,220,0.28)] text-white shadow-[0_0_20px_rgba(120,180,240,0.45)]'
          }`}
        >
          {engraved ? '已刻上我们的名字' : '立刻刻上我们的名字'}
          <span aria-hidden="true" className="absolute -right-1 -bottom-1 text-[13px] text-[#bfe0ff]">✦</span>
        </button>
        <p className="mt-3 text-center text-[13.5px] leading-relaxed text-[#b8cde4]">
          {me} 和 {ta} 使用 <span className="font-semibold text-[#ffd98a]">姻缘笔</span> 缔结名簿 缘定三生
        </p>
      </div>

      {/* 说明 / 我们的名字 弹层 */}
      {sheet !== 'none' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 px-8" onClick={() => setSheet('none')}>
          <div className="w-full rounded-2xl border border-[#9fc3e8]/40 bg-[#1c2f52] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sheet === 'explain' ? (
              <>
                <div className="text-[16px] font-bold text-[#dce9f8]">三生石·说明</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#a8c0dc]">
                  相传三生石畔，姻缘笔落，名簿留痕——第一生相遇，第二生相知，第三生相守。把两个人的名字刻在一起，从此生生世世，缘定三生。
                </p>
              </>
            ) : (
              <>
                <div className="text-[16px] font-bold text-[#dce9f8]">我们的名字</div>
                <div className="mt-4 flex items-center justify-center gap-4">
                  <span className="rounded-lg border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.14)] px-4 py-2 text-[16px] font-semibold tracking-widest text-[#ffe9c8]">{me}</span>
                  <Heart className="h-5 w-5 text-[#f0a0b8]" fill="#f0a0b8" />
                  <span className="rounded-lg border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.14)] px-4 py-2 text-[16px] font-semibold tracking-widest text-[#ffe9c8]">{ta}</span>
                </div>
                <p className="mt-3 text-center text-[12.5px] text-[#8aa4c4]">{engraved ? '三生石上，已刻下你们的名字 ✦' : '还未刻名，点下方按钮刻上你们的名字吧'}</p>
              </>
            )}
            <button type="button" onClick={() => setSheet('none')} className="mt-4 h-11 w-full rounded-full bg-[rgba(150,190,235,0.25)] text-[15px] font-medium text-[#dce9f8]">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 回复挑战（第七轮重做，参考图1/2）：黑底粉强调；挑战首页 + 12 关高危回复玩法 */
function ReplyPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  // 第十轮双人模式：我发起挑战时 TA（AI）同时开始，每关双方的选择彼此可见（我=粉框 / TA=蓝框），
  // TA 选完在他的选择下面说看法，看法下面的讨论区可以反驳 TA（会进 TA 的记忆）
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const [view, setView] = useState<'home' | 'play' | 'dead' | 'clear'>('home');
  const [lv, setLv] = useState(0);
  const [stats, setStats] = useState({ tm: 72, jc: 42, af: 48, sc: 78 });
  const [picked, setPicked] = useState<number | null>(null);
  const [players, setPlayers] = useState(791662);
  const [settled, setSettled] = useState(false); // 数值已结算（等 TA 的选择/看法看完后手动下一关）
  const [outcome, setOutcome] = useState<null | 'next' | 'final'>(null);
  const [genLoading, setGenLoading] = useState(false); // 动态出题中（第十二轮：每次开题都不一样）
  const [judging, setJudging] = useState(false); // AI 正在判定最终结果

  /** 本次动态题组（第十二轮）：AI 生成，每次开始都不一样；生成失败用内置题洗牌兑底 */
  const runLevels = state.replyRun?.levels?.length ? state.replyRun.levels : null;
  const totalLv = runLevels?.length ?? REPLY_LEVELS.length;

  /** 全网挑战人数：每 2.4s 微涨，模拟全网实时在玩 */
  useEffect(() => {
    const t = window.setInterval(() => setPlayers((p) => p + Math.floor(Math.random() * 4)), 2400);
    return () => window.clearInterval(t);
  }, []);

  const start = async () => {
    setGenLoading(true);
    setLv(0);
    setStats({ tm: 72, jc: 42, af: 48, sc: 78 });
    setPicked(null);
    setSettled(false);
    setOutcome(null);
    // 双人模式：TA 同时开始挑战（coupleMemoryDiff 检测 active false→true 自动写进 TA 的记忆）
    patch({ replyTa: { active: true, picks: {}, mePicks: {}, startedAt: Date.now(), endedAt: null } });
    // 动态出题：用户配置的 API 模型优先 → 内置模型 → 内置题洗牌兑底（每次打开都不一样）
    let levels: DynReplyLevel[] | null = null;
    try {
      levels = await genReplyLevels();
    } catch {
      levels = null;
    }
    if (!levels || levels.length < 3) {
      levels = [...REPLY_LEVELS].sort(() => Math.random() - 0.5).slice(0, 6);
    }
    patchFn({ replyRun: { levels, myPicks: {}, at: Date.now() }, replyVerdict: null });
    setGenLoading(false);
    setView('play');
  };

  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  /** 挑战结束（AI 判定后）：存纪录 + 双人战况归档（endedAt）*/
  const finish = (kind: 'dead' | 'clear', bestLv: number) => {
    patchFn((prev) => ({
      replyBest: Math.max(prev.replyBest ?? 0, bestLv),
      replyTa: prev.replyTa ? { ...prev.replyTa, active: false, endedAt: Date.now() } : prev.replyTa,
    }));
    setView(kind);
  };

  /** 全部答完 → 由 AI 判定成功/失败（第十二轮用户要求：结果 AI 说了算）+ TA 在结算页留言 */
  const judgeFinal = async (finalStats: { sc: number }) => {
    setJudging(true);
    try {
      const levels = runLevels ?? REPLY_LEVELS;
      const myPicksRec = state.replyRun?.myPicks ?? {};
      const myPicks = Object.entries(myPicksRec).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => ({ lv: Number(k), text: levels[Number(k)]?.opts[v]?.t ?? '' }));
      const taPicks = Object.entries(state.replyTa?.picks ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => ({ lv: Number(k), text: levels[Number(k)]?.opts[v.pick]?.t ?? '' }));
      const verdict = await aiReplyVerdict({ me: meName, ta: taName, levels, myPicks, taPicks, survival: Math.max(0, finalStats.sc) });
      patchFn({ replyVerdict: { ...verdict, at: Date.now() } });
      // TA 的话写进留言区（reply:final:<本局>，可继续回复）+ 写进 AI 记忆（AI 知道自己说了什么/我这次的成绩）
      patchFn((prev) => ({ comments: [...(prev.comments ?? []), { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: `reply:final:${String(prev.replyRun?.at ?? 'x')}`, from: 'ta' as const, text: verdict.msg, at: Date.now() }] }));
      rememberStatusExam(`回复挑战结束：AI 判定${verdict.win ? '成功（通关）' : '失败'}。总评：${verdict.comment} ${taName}在结算页对${meName}说：「${verdict.msg}」`);
      finish(verdict.win ? 'clear' : 'dead', verdict.win ? levels.length : myPicks.length);
    } catch {
      // 判定失败兜底：按存活率结算
      const win = finalStats.sc >= 55;
      finish(win ? 'clear' : 'dead', win ? totalLv : lv + 1);
    } finally {
      setJudging(false);
    }
  };

  /** 看完 TA 的选择和看法后手动进下一关（最后一关答完 → AI 判定） */
  const goNext = () => {
    if (outcome === 'final') {
      void judgeFinal(stats);
    } else {
      setLv(lv + 1);
      setPicked(null);
      setSettled(false);
      setOutcome(null);
    }
  };

  /** 选一个反应：亮出点评 → 1.6s 后结算数值；TA 同时作答（0.9~2.4s 后出蓝色选择+看法） */
  const pick = (i: number) => {
    if (picked != null) return;
    setPicked(i);
    const level = (runLevels ?? REPLY_LEVELS)[Math.min(lv, totalLv - 1)];
    // 记录我的选择（TA 能看到），并让 TA 同步作答（写 replyTa.picks[lv] + 看法 + 记忆）
    patchFn((prev) => ({
      replyRun: prev.replyRun ? { ...prev.replyRun, myPicks: { ...prev.replyRun.myPicks, [String(lv)]: i } } : prev.replyRun,
      replyTa: prev.replyTa ? { ...prev.replyTa, active: true, mePicks: { ...prev.replyTa.mePicks, [String(lv)]: { pick: i, text: level.opts[i].t } } } : prev.replyTa,
    }));
    aiReplyPickForLevel(lv, level.scene, level.quote, level.opts.map((o) => o.t), i, level.opts[i].t);
    window.setTimeout(() => {
      const d = level.opts[i].d;
      const ns = { tm: clamp(stats.tm + d[0]), jc: clamp(stats.jc + d[1]), af: clamp(stats.af + d[2]), sc: stats.sc + d[3] };
      setStats(ns);
      // 第十二轮：不再按存活率中途判死——全部答完后由 AI 综合判定成功/失败
      setOutcome(lv >= totalLv - 1 ? 'final' : 'next');
      setSettled(true);
    }, 1600);
  };

  const level = (runLevels ?? REPLY_LEVELS)[Math.min(lv, totalLv - 1)];
  const best = state.replyBest ?? null;
  const taPick = state.replyTa?.picks?.[String(lv)] ?? null;
  const taName = state.taName || 'TA';
  const meName = state.meName || '我';
  // 第十七轮：留言线程按局隔离（每局的题目都不一样，同序号关卡不再是同一个讨论区）
  const runKey = String(state.replyRun?.at ?? 'x');

  /** 深色顶栏（SubShell 是浅色底，这里自绘以贴合黑金参考图） */
  const darkHeader = (onBack: () => void) => (
    <div className="shrink-0 bg-[#050506] pt-[54px]">
      <div className="relative flex h-11 items-center px-1.5">
        <button type="button" onClick={onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-opacity active:opacity-50">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold text-white">回复挑战</div>
      </div>
    </div>
  );

  /** 数值条（体面值/觉察值/安抚值/存活率） */
  const statChip = (label: string, v: number) => (
    <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.05] px-2.5 pb-2.5 pt-2">
      <div className="text-[10.5px] leading-none text-white/40">{label}</div>
      <div className="mt-1 text-[19px] font-bold leading-none text-white">{v}</div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white/85 dark:bg-zinc-800/90 transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-[#050506] text-white">
      {darkHeader(view === 'home' ? close : () => setView('home'))}

      {/* 首页（参考图1）：高危氛围 + 全网数据 + 开始挑战 */}
      {view === 'home' && (
        <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
          {/* 开场对话演示：TA 的轻描淡写 vs 我的心虚 */}
          <div className="space-y-2.5 px-5 pt-4" aria-hidden="true">
            <div className="flex items-end gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#3a3a40] text-[11px] font-semibold text-white">TA</span>
              <span className="rounded-[4px] rounded-tl-none bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl px-3 py-1.5 text-[14px] text-black">没事，你忙吧。</span>
            </div>
            <div className="flex items-end justify-end gap-2">
              <span className="rounded-[4px] rounded-tr-none bg-[#a8e05f] px-3 py-1.5 text-[14px] text-black">那我先不回了?</span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#a8e05f] text-[11px] font-semibold text-black">我</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#3a3a40] text-[11px] font-semibold text-white">TA</span>
              <span className="rounded-[4px] rounded-tl-none bg-white/85 dark:bg-zinc-800/90 backdrop-blur-xl px-3 py-1.5 text-[14px] text-black">随便你。</span>
            </div>
          </div>

          {/* 标签 + 大标题 */}
          <div className="px-5 pt-8">
            <span className="border-b-2 border-white/70 pb-0.5 text-[14px] font-semibold text-white">情绪高压</span>
          </div>
          <h1 className="mt-3 px-5 text-[32px] font-extrabold leading-tight tracking-tight text-white">恋爱高危回复挑战</h1>
          <p className="mt-2 px-5 text-[15px] leading-relaxed text-white/40">对方说&ldquo;没事&rdquo;的时候，你真的听懂了吗？</p>

          {/* 全网数据卡 */}
          <div className="mx-5 mt-6 rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="grid grid-cols-3 items-end">
              <div>
                <div className="text-[24px] font-extrabold leading-none text-white tabular-nums">{players.toLocaleString('en-US')}</div>
                <div className="mt-1.5 text-[11px] text-white/35">全网挑战人数</div>
              </div>
              <div className="text-center">
                <div className="text-[24px] font-extrabold leading-none text-white">0.8%</div>
                <div className="mt-1.5 text-[11px] text-white/35">历史通关率</div>
              </div>
              <div className="text-right">
                <div className="text-[24px] font-extrabold leading-none text-white">{best == null ? '第4关' : best >= 6 ? '通关' : `第${best}关`}</div>
                <div className="mt-1.5 text-[11px] text-white/35">你的最深纪录</div>
              </div>
            </div>
          </div>

          {/* 开始挑战（第十二轮：AI 现场出题，每次都不一样） */}
          <button
            type="button"
            data-testid="reply-start-btn"
            onClick={() => void start()}
            disabled={genLoading}
            className="mx-5 mt-5 flex h-14 w-[calc(100%-40px)] items-center justify-center gap-2 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[20px] font-bold text-[#131316] dark:text-zinc-100 shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform active:scale-[0.98] disabled:opacity-75"
          >
            {genLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> {taName || 'TA'} 正在出题…
              </>
            ) : (
              '开始挑战'
            )}
          </button>
          <p className="mt-5 text-center text-[12.5px] text-white/30">本挑战专治：自以为讲清楚了，实际上把火烧旺了。</p>
          <p className="mt-1.5 text-center text-[12.5px] text-[#8fa4ef]/80" data-testid="reply-duo-hint">
            双人模式：{state.taName || 'TA'} 会和你同时作答，你们互相都能看到彼此的选择
          </p>

          {/* 旧版高情商回复存档 */}
          {state.replies.length > 0 && (
            <div className="mx-5 mt-9">
              <div className="text-[15px] font-bold text-white/85">我的高情商回复</div>
              <div className="mt-3 space-y-2.5">
                {state.replies.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                    <div className="text-[12px] text-white/35">{r.prompt}</div>
                    <div className="mt-1.5 text-[14.5px] leading-relaxed text-white/85">{r.reply}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 关卡中（参考图2）：第 N/12 关 + 四数值条 + 场景卡 + A/B/C/D */}
      {view === 'play' && (
        <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
          <div className="px-5 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold text-white/85">第 {lv + 1}/{totalLv} 关</span>
              {state.replyTa?.active && (
                <span className="rounded-full bg-[#7f96e0]/20 px-2.5 py-1 text-[10.5px] font-bold text-[#8fa4ef]" data-testid="reply-duo-badge">
                  双人挑战 · {taName} 也在作答
                </span>
              )}
            </div>
            <h2 className="mt-1 text-[28px] font-extrabold leading-tight text-white">{level.name}</h2>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 px-4">
            {statChip('体面值', stats.tm)}
            {statChip('觉察值', stats.jc)}
            {statChip('安抚值', stats.af)}
            {statChip('存活率', stats.sc)}
          </div>

          <div className="mx-4 mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-5">
            <div className="text-[12px] text-white/35">真实恋爱场景</div>
            <p className="mt-3 text-[14.5px] leading-[1.8] text-white/55">{level.scene}</p>
            <div className="mt-4 border-t border-white/10" />
            <p className="mt-4 text-[24px] font-bold leading-snug text-white">{level.quote}</p>
          </div>

          <div className="mt-5 flex items-center justify-between px-5">
            <span className="text-[14px] font-bold text-white">你会怎么做</span>
            <span className="text-[12px] text-white/30">{picked == null ? '选择一个反应' : settled ? '看看 TA 怎么选的' : `${taName} 正在等你…`}</span>
          </div>

          <div className="mt-3 space-y-2.5 px-4">
            {level.opts.map((o, i) => {
              const isPicked = picked === i;
              const dim = picked != null && !isPicked;
              return (
                <div key={i}>
                  <button
                    type="button"
                    data-testid={`reply-opt-${i}`}
                    disabled={picked != null}
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                      isPicked ? 'border-white/60 bg-white/[0.14]' : 'border-white/[0.08] bg-white/[0.05] active:bg-white/[0.09]'
                    } ${dim ? 'opacity-35' : ''}`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.12] text-[15px] font-bold text-white">{['A', 'B', 'C', 'D'][i]}</span>
                    <span className="flex-1 text-[15px] leading-snug text-white/90">{o.t}</span>
                  </button>
                  {isPicked && (
                    <p className={`mt-2 px-2 text-[12.5px] leading-relaxed ${o.d[3] >= 0 ? 'text-white/85' : 'text-white/45'}`} data-testid="reply-verdict">
                      {o.v}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* TA 的同步挑战区（第十轮双人模式）：蓝框选择 + 看法 + 反驳聊天 */}
          {picked != null && (
            <div className="mt-4 px-4">
              <div className="rounded-2xl border border-[#7f96e0]/40 bg-[#7f96e0]/[0.07] p-4" data-testid="reply-ta-zone">
                <div className="flex items-center gap-2">
                  {state.taAvatar ? (
                    <img src={state.taAvatar} alt={taName} className="h-8 w-8 rounded-full object-cover" draggable={false} />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#7f96e0]/25 text-[11px] font-bold text-[#8fa4ef]">{taName.slice(0, 1)}</span>
                  )}
                  <span className="text-[13px] font-bold text-white">{taName} 的选择</span>
                  {!taPick && <span className="ml-auto flex items-center gap-1 text-[11.5px] text-white/40"><Loader2 className="h-3 w-3 animate-spin" /> 正在作答…</span>}
                </div>
                {taPick && (
                  <>
                    <div
                      className="mt-3 rounded-xl border-2 border-[#7f96e0]/80 bg-[#7f96e0]/[0.10] p-3 text-[14.5px] font-medium leading-snug text-white"
                      data-testid="reply-ta-pick"
                    >
                      {['A', 'B', 'C', 'D'][taPick.pick]}. {level.opts[taPick.pick]?.t}
                    </div>
                    <div className="mt-2.5 rounded-2xl rounded-bl-sm bg-white/[0.07] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white/85" data-testid="reply-ta-say">
                      <span className="mr-1.5 text-[11px] font-semibold text-white/85">{taName} 的看法</span>
                      {taPick.say}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 看法下面的讨论区：可以反驳 TA（TA 会回，全进记忆）；每题独立，且只属于本局 */}
          {taPick && (
            <div className="mt-3 px-4">
              <CommentThread state={state} patch={patchFn} threadKey={`reply:${runKey}:${lv}`} hint="不服？在下面反驳 TA" testId={`reply-discuss-${lv}`} dark />
            </div>
          )}

          {/* 看完 TA 的选择/看法后手动继续（最后一关交卷等 AI 宣判） */}
          {settled && (
            <button
              type="button"
              data-testid="reply-next"
              onClick={goNext}
              disabled={judging}
              className="mx-5 mt-5 flex h-14 w-[calc(100%-40px)] items-center justify-center gap-2 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[18px] font-bold text-[#131316] dark:text-zinc-100 shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform active:scale-[0.98] disabled:opacity-70"
            >
              {judging ? (
                <>
                  <Loader2 className="h-4.5 w-4.5 animate-spin" /> {taName} 正在判定成绩…
                </>
              ) : outcome === 'final' ? '交卷，等 TA 宣判' : '下一关 →'}
            </button>
          )}
        </div>
      )}

      {/* 挑战失败（AI 判定）——第二十五轮美化：徽章+光晕、宣判胶囊、引言卡、进度条数值、白色主按钮 */}
      {view === 'dead' && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col items-center px-7 pb-10 pt-7">
            <div className="relative" aria-hidden="true">
              <div className="absolute -inset-7 rounded-full bg-white/[0.05] blur-2xl" />
              <div className="relative grid h-[84px] w-[84px] place-items-center rounded-[26px] bg-white/[0.07] text-[40px] ring-1 ring-white/[0.12]">🥀</div>
            </div>
            <div className="mt-5 text-[32px] font-extrabold tracking-wide text-white">挑战失败</div>
            <div className="mt-3 rounded-full bg-white/[0.07] px-4 py-1.5 text-[12.5px] font-semibold text-white/65" data-testid="reply-dead-sub">
              {taName} 宣判：这局没及格
            </div>
            {state.replyVerdict?.comment && (
              <div className="mt-5 w-full border-l-2 border-white/25 pl-3.5 text-left text-[13.5px] leading-relaxed text-white/60" data-testid="reply-verdict-comment">
                {state.replyVerdict.comment}
              </div>
            )}
            {/* AI 的留言：TA 想说的话（可以点击回复，进 TA 的记忆） */}
            {state.replyVerdict?.msg && (
              <div className="mt-5 w-full">
                <div className="flex items-start gap-2.5">
                  {state.taAvatar ? (
                    <img src={state.taAvatar} alt={taName} className="h-9 w-9 shrink-0 rounded-full object-cover" draggable={false} />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#7f96e0]/25 text-[11px] font-bold text-[#8fa4ef]">{taName.slice(0, 1)}</span>
                  )}
                  <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-white/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-white/90 ring-1 ring-white/[0.06]" data-testid="reply-final-msg">{state.replyVerdict.msg}</div>
                </div>
                <CommentThread state={state} patch={patchFn} threadKey={`reply:final:${String(state.replyRun?.at ?? 'x')}`} hint={`听完 ${taName} 的话，想回一句吗`} testId="reply-final-thread" dark />
              </div>
            )}
            <div className="mt-6 grid w-full grid-cols-4 gap-2">
              {statChip('体面值', stats.tm)}
              {statChip('觉察值', stats.jc)}
              {statChip('安抚值', stats.af)}
              {statChip('存活率', Math.max(0, stats.sc))}
            </div>
            <button type="button" onClick={start} className="mt-8 flex h-[52px] w-full items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-bold text-[#131316] dark:text-zinc-100 shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform active:scale-[0.98]" data-testid="reply-retry">
              再挑战一次
            </button>
            <button type="button" onClick={() => setView('home')} className="mt-3 h-12 w-full rounded-2xl bg-white/[0.08] text-[15px] font-medium text-white/70 transition-colors active:bg-white/[0.13]">
              回到首页
            </button>
          </div>
        </div>
      )}

      {/* 通关成功（AI 判定）——第二十五轮美化：徽章+光晕、宣判胶囊、引言卡、进度条数值、白色主按钮 */}
      {view === 'clear' && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-[440px] flex-col items-center px-7 pb-10 pt-7">
            <div className="relative" aria-hidden="true">
              <div className="absolute -inset-7 rounded-full bg-white/[0.07] blur-2xl" />
              <div className="relative grid h-[84px] w-[84px] place-items-center rounded-[26px] bg-white/[0.08] text-[40px] ring-1 ring-white/[0.14]">🎉</div>
            </div>
            <div className="mt-5 text-[32px] font-extrabold tracking-wide text-white">通关成功</div>
            <div className="mt-3 rounded-full bg-white/[0.08] px-4 py-1.5 text-[12.5px] font-semibold text-white/70" data-testid="reply-clear-sub">
              {totalLv} 关全过 · {taName} 宣判你及格了
            </div>
            {state.replyVerdict?.comment && (
              <div className="mt-5 w-full border-l-2 border-white/25 pl-3.5 text-left text-[13.5px] leading-relaxed text-white/60" data-testid="reply-verdict-comment">
                {state.replyVerdict.comment}
              </div>
            )}
            {/* AI 的留言：TA 想说的话（可以点击回复，进 TA 的记忆） */}
            {state.replyVerdict?.msg && (
              <div className="mt-5 w-full">
                <div className="flex items-start gap-2.5">
                  {state.taAvatar ? (
                    <img src={state.taAvatar} alt={taName} className="h-9 w-9 shrink-0 rounded-full object-cover" draggable={false} />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#7f96e0]/25 text-[11px] font-bold text-[#8fa4ef]">{taName.slice(0, 1)}</span>
                  )}
                  <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-white/[0.08] px-4 py-3 text-[13.5px] leading-relaxed text-white/90 ring-1 ring-white/[0.06]" data-testid="reply-final-msg">{state.replyVerdict.msg}</div>
                </div>
                <CommentThread state={state} patch={patchFn} threadKey={`reply:final:${String(state.replyRun?.at ?? 'x')}`} hint={`听完 ${taName} 的话，想回一句吗`} testId="reply-final-thread" dark />
              </div>
            )}
            <div className="mt-6 grid w-full grid-cols-4 gap-2">
              {statChip('体面值', stats.tm)}
              {statChip('觉察值', stats.jc)}
              {statChip('安抚值', stats.af)}
              {statChip('存活率', Math.max(0, stats.sc))}
            </div>
            <button type="button" onClick={start} className="mt-8 flex h-[52px] w-full items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-bold text-[#131316] dark:text-zinc-100 shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition-transform active:scale-[0.98]" data-testid="reply-retry">
              再挑战一次
            </button>
            <button type="button" onClick={() => setView('home')} className="mt-3 h-12 w-full rounded-2xl bg-white/[0.08] text-[15px] font-medium text-white/70 transition-colors active:bg-white/[0.13]">
              回到首页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 情侣酒店（第十九轮需求48）：直达美团「酒店旅行」频道 —— 挂载即跳转，本页仅作过渡占位 */
function HotelJump({ close }: { close: () => void }) {
  useEffect(() => {
    openMeituanTravel();
  }, []);
  return (
    <SubShell title="情侣酒店" onBack={close}>
      <div className="mt-16 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff4d6]">
          <Users className="h-7 w-7 text-[#e2a03e]" strokeWidth={1.9} />
        </div>
        <p className="text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">正在打开美团 · 酒店旅行…</p>
        <p className="text-[12.5px] text-[#9a9aa2] dark:text-zinc-400">为你们挑一间合适的房间</p>
      </div>
    </SubShell>
  );
}

/** 恋爱状态分析 · 18 题题库（斯滕伯格爱情三角理论 + SVR 理论：亲密 7 / 激情 6 / 承诺 5；选项分值 4→0） */
const STATUS_EXAM: { dim: '亲密' | '激情' | '承诺'; q: string; opts: string[] }[] = [
  { dim: '亲密', q: '你们在日常生活中是否愿意分享彼此的内心感受？', opts: ['总是，我们无话不谈', '经常，大部分重要的事情都会分享', '有时，只分享部分内容', '很少，我们更倾向于独立思考', '几乎不，我们很少深入交流'] },
  { dim: '亲密', q: '对方情绪低落时，你能第一时间察觉吗？', opts: ['几乎总能，一眼就能看出来', '经常能，多数时候有感应', '有时能，看当时的状态', '很少，TA 不说我不知道', '几乎不能，总是后知后觉'] },
  { dim: '亲密', q: '你们多久会有一次深入的谈心？', opts: ['几乎每天都会聊聊心里话', '每周固定有那么几次', '偶尔遇到事情才聊', '很少，聊的都是日常琐碎', '几乎从不深聊'] },
  { dim: '亲密', q: '你需要 TA 的时候，TA 通常会出现吗？', opts: ['一直在，随叫随到', '大部分时候都会赶来', '看情况，有时忙顾不上', '经常缺席，让我失望', '几乎指望不上'] },
  { dim: '亲密', q: '你们会互相分享生活的琐碎日常吗？', opts: ['随时分享，秒回彼此', '每天都会聊聊今天的事', '想起来才分享', '很少，各过各的', '几乎没有分享'] },
  { dim: '亲密', q: '吵架之后你们能好好把话说开吗？', opts: ['一定说开，吵架不过夜', '大多能和好并复盘', '拖几天才慢慢缓和', '经常冷战不了了之', '从不沟通，硬扛到底'] },
  { dim: '亲密', q: 'TA 了解你现阶段最大的压力来源吗？', opts: ['非常了解，还常开导我', '比较了解，会安慰我', '大概知道一些', '不太清楚', '完全不了解'] },
  { dim: '激情', q: '见到 TA 或者收到 TA 消息时，你还会心动吗？', opts: ['每次都心动，像刚在一起', '经常心动', '偶尔心动', '很少心动了', '几乎没有感觉'] },
  { dim: '激情', q: '你们之间还有专属的小暧昧和浪漫吗？', opts: ['很多，天天都在撒糖', '偶尔会有小浪漫', '节日才会有', '很少了', '已经完全没有'] },
  { dim: '激情', q: '你想和 TA 有更多独处的时间吗？', opts: ['非常想，一刻都不想分开', '比较想，周末尽量一起', '一般，顺其自然', '不太想，更想自己待着', '完全不想'] },
  { dim: '激情', q: '你们最近一次牵手或拥抱是什么时候？', opts: ['今天或昨天', '最近一周内', '最近一个月内', '记不清了', '已经很久了'] },
  { dim: '激情', q: '拥抱、牵手这些亲密接触让你们感到安心吗？', opts: ['非常安心，像彼此充电', '比较安心', '还好，没什么特别感觉', '有点尴尬', '会刻意回避'] },
  { dim: '激情', q: '你们还会为对方精心打扮或准备惊喜吗？', opts: ['经常，很享受这个过程', '偶尔会准备', '节日才有', '几乎不会了', '从来没有'] },
  { dim: '承诺', q: '你们对未来的长期规划有过认真讨论吗？', opts: ['经常聊，计划很具体', '聊过，有大致共识', '提过但没细聊', '很少提及', '从来不敢聊'] },
  { dim: '承诺', q: '你们相信无论发生什么都会一起面对吗？', opts: ['深信不疑', '比较相信', '说不好', '有点怀疑', '很难相信'] },
  { dim: '承诺', q: '面对外面的诱惑，你们对彼此的忠诚有信心吗？', opts: ['非常有信心', '比较有信心', '一般', '有点担心', '很没有安全感'] },
  { dim: '承诺', q: '你们愿意为这段关系做出让步和改变吗？', opts: ['都非常愿意', '我愿意，TA 也在努力', '偶尔愿意', '都不太想改变', '已经放弃改变'] },
  { dim: '承诺', q: '如果再来一次，你还会选择和 TA 在一起吗？', opts: ['一定会，答案永远是TA', '大概率会', '说不好', '可能会犹豫', '不会了'] },
];

/** 维度得分（0-100）：该维度题目选项分值（4→0）求和 / 满分 */
function statusDimScore(picks: Record<string, number>, dim: string): number {
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
function statusTierTitle(score: number): string {
  if (score >= 88) return '灵魂共振型恋人';
  if (score >= 76) return '热恋进行时';
  if (score >= 62) return '稳定升温期';
  if (score >= 48) return '平稳陪伴期';
  if (score >= 34) return '需要用心的时期';
  return '亟待修复的信号';
}

/** 从 LLM 文本里提取 JSON（容忍代码块包裹） */
function statusExtractJson(text: string): { me?: Partial<StatusResult>; ta?: Partial<StatusResult>; overall?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as { me?: Partial<StatusResult>; ta?: Partial<StatusResult>; overall?: string };
  } catch {
    return null;
  }
}

/** 本地兜底报告：按维度分直接生成（不依赖 LLM） */
function statusLocalReport(myPicks: Record<string, number>, taPicks: Record<string, number>, me: string, ta: string): { me: StatusResult; ta: StatusResult; overall: string } {
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
function StatusPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const me = state.meName || '我';
  const ta = state.taName || 'TA';
  const exam = state.statusExam;
  const myPicks = exam?.my ?? {};
  const taPicks = exam?.ta ?? {};
  const done = exam?.at != null && STATUS_EXAM.every((_, i) => myPicks[String(i)] != null && taPicks[String(i)] != null);

  const [view, setView] = useState<'intro' | 'quiz' | 'result'>(done ? 'result' : 'intro');
  const [qi, setQi] = useState(0);
  const [aiPick, setAiPick] = useState<number | null>(taPicks[String(qi)] ?? null);
  const [aiBusy, setAiBusy] = useState(false);
  const [report, setReport] = useState<{ me: StatusResult; ta: StatusResult; overall: string } | null>(exam?.rep ?? null);
  const [genLoading, setGenLoading] = useState(false);
  const genRef = useRef(false);

  const q = STATUS_EXAM[qi];
  const myCur = myPicks[String(qi)];
  const answeredCount = STATUS_EXAM.filter((_, i) => myPicks[String(i)] != null).length;

  /** 我选一个选项：粉勾立即出现；AI 同时作答（蓝勾延时出现） */
  const pick = (i: number) => {
    if (myCur != null || aiBusy) return;
    patchFn((prev) => ({
      statusExam: { my: { ...(prev.statusExam?.my ?? {}), [String(qi)]: i }, ta: prev.statusExam?.ta ?? {}, at: prev.statusExam?.at ?? null, rep: prev.statusExam?.rep ?? null },
    }));
    setAiBusy(true);
    setAiPick(null);
    void (async () => {
      const p = await aiStatusPick(q.q, q.opts, i, q.opts[i]);
      // 稍作停顿，像 TA 认真想了一下才落下选择
      window.setTimeout(() => {
        const idx = p >= 0 ? p : Math.random() < 0.3 ? i : [0, 1, 2, 3, 4].filter((x) => x !== i)[Math.floor(Math.random() * 4)];
        setAiPick(idx);
        setAiBusy(false);
        // TA 的选择也要持久化（结果页双方维度条 / 重考回显都要用）
        patchFn((prev) => ({
          statusExam: {
            my: prev.statusExam?.my ?? {},
            ta: { ...(prev.statusExam?.ta ?? {}), [String(qi)]: idx },
            at: prev.statusExam?.at ?? null,
            rep: prev.statusExam?.rep ?? null,
          },
        }));
      }, 700 + Math.random() * 1400);
    })();
  };

  /** 下一题 / 完成 */
  const nextQ = () => {
    if (myCur == null || aiPick == null) return;
    if (qi >= STATUS_EXAM.length - 1) {
      setView('result');
      void genReport(true);
    } else {
      const nqi = qi + 1;
      setQi(nqi);
      setAiPick(null);
      setAiBusy(false);
      // TA 可能已经在之前答过这题（重考场景）
      const prev = state.statusExam?.ta?.[String(nqi)];
      if (prev != null) setAiPick(prev);
    }
  };

  /** 结果生成：① 用户配置的 API 模型 ② 内置模型兜底 ③ 本地计算兜底；AI 知道自己的结果（写记忆） */
  const genReport = async (auto = false) => {
    if (genRef.current) return;
    genRef.current = true;
    setGenLoading(true);
    try {
      const local = statusLocalReport(myPicks, taPicks, me, ta);
      const dims = (picks: Record<string, number>) => `亲密${statusDimScore(picks, '亲密')}/激情${statusDimScore(picks, '激情')}/承诺${statusDimScore(picks, '承诺')}`;
      const detail = STATUS_EXAM.map((it, i) => `${i + 1}.【${it.dim}】${it.q}\n   ${me}：「${it.opts[myPicks[String(i)] ?? 2]}」\n   ${ta}：「${it.opts[taPicks[String(i)] ?? 2]}」`).join('\n');
      const sys = `你是一位懂斯滕伯格爱情三角理论与 SVR 理论的恋爱测评分析师。你们的服务对象是一对恋人：${me}（${state.gender === '女' ? '女生' : state.gender === '男' ? '男生' : '用户'}）和${ta}（${state.gender === '女' ? '男生，是她的男朋友' : state.gender === '男' ? '女生，是他的女朋友' : '恋人'}）。他们刚刚各自独立完成了同一份 18 题恋爱状态测评。`;
      const user = `双方作答明细（选项即真实选择）：\n${detail}\n\n本地维度得分——${me}：${dims(myPicks)}；${ta}：${dims(taPicks)}。\n请分别为两人生成测评报告：要紧扣两人的实际选择内容（引用他们选的选项说话），口吻专业又温柔；${me}的报告面向${me}本人，${ta}的报告面向${ta}本人；各配 3 条具体可执行的建议。\n输出 JSON：{"me":{"score":0-100整数,"title":"状态称号（6字内）","summary":"总结（80字内）","advice":["建议1","建议2","建议3"]},"ta":{"score":0-100整数,"title":"状态称号（6字内）","summary":"总结（80字内）","advice":["建议1","建议2","建议3"]},"overall":"一句话点评你们两人的整体状态（60字内，像分析师写给这对恋人的话）"}。只输出 JSON。`;
      let rep: { me: StatusResult; ta: StatusResult; overall: string } | null = null;
      const normalize = (j: { me?: Partial<StatusResult>; ta?: Partial<StatusResult>; overall?: string } | null) => {
        if (!j?.me || !j?.ta) return null;
        const normOne = (o: Partial<StatusResult>, fb: StatusResult): StatusResult => ({
          score: typeof o.score === 'number' && o.score >= 0 && o.score <= 100 ? Math.round(o.score) : fb.score,
          title: typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 12) : fb.title,
          summary: typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim().slice(0, 140) : fb.summary,
          advice: Array.isArray(o.advice) && o.advice.length > 0 ? o.advice.filter((x) => typeof x === 'string').slice(0, 3) : fb.advice,
        });
        return { me: normOne(j.me, local.me), ta: normOne(j.ta, local.ta), overall: typeof j.overall === 'string' && j.overall.trim() ? j.overall.trim().slice(0, 100) : local.overall };
      };
      // ① 用户配置的 API 模型（优先）
      try {
        const c = useSettings.getState().apiConfig;
        if (c && c.baseUrl) {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user },
              ],
              config: { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model },
              temperature: 0.7,
            }),
          });
          if (res.ok) rep = normalize(statusExtractJson(await res.text()));
        }
      } catch {
        /* 走兜底 */
      }
      // ② 内置模型兜底
      if (!rep) {
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user },
              ],
              forceSdk: true,
              temperature: 0.7,
            }),
          });
          if (res.ok) rep = normalize(statusExtractJson(await res.text()));
        } catch {
          /* 走本地兜底 */
        }
      }
      if (!rep) rep = local;
      setReport(rep);
      patchFn((prev) => ({
        statusExam: { my: prev.statusExam?.my ?? {}, ta: prev.statusExam?.ta ?? {}, at: Date.now(), rep },
      }));
      rememberStatusExam(`恋爱状态测评完成：${me}得分${rep.me.score}（${rep.me.title}），${ta}得分${rep.ta.score}（${rep.ta.title}）。分析师点评：${rep.overall}（TA 知道自己的测评结果）`);
      if (!auto) showToast('报告已生成 ♡');
    } finally {
      setGenLoading(false);
      genRef.current = false;
    }
  };

  /** 重新测试 */
  const restart = () => {
    patchFn({ statusExam: { my: {}, ta: {}, at: null, rep: null } });
    setQi(0);
    setAiPick(null);
    setAiBusy(false);
    setReport(null);
    setView('quiz');
  };

  // ---------------- 落地页（参考图4） ----------------
  if (view === 'intro') {
    return (
      <SubShell title="恋爱状态" onBack={close}>
        <div className="-mx-3.5 -mb-8 min-h-full bg-[#fdf0f3] dark:bg-zinc-900 px-3.5 pb-8 pt-3">
          {/* 粉渐变主视觉横幅 */}
          <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#f97362,#f2536a_55%,#e84c8b)] px-5 pb-5 pt-4">
            <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/25" />
            <span aria-hidden="true" className="pointer-events-none absolute -left-7 top-10 h-16 w-16 rounded-full bg-white/20" />
            <span aria-hidden="true" className="pointer-events-none absolute bottom-3 right-10 h-9 w-9 rounded-full bg-white/20" />
            <div className="relative flex items-center gap-1.5">
              <PixelHeart size={16} />
              <span className="text-[12.5px] font-bold text-white/95">恋人空间</span>
            </div>
            <div className="relative mt-2 select-none text-[30px] font-extrabold leading-[1.18] text-white drop-shadow-[0_3px_8px_rgba(200,60,90,0.35)]">
              恋爱
              <br />
              状态分析
            </div>
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 right-4 rotate-12 text-[44px] drop-shadow-[0_4px_10px_rgba(200,60,90,0.3)]">💝</span>
          </div>
          <div className="mt-3 text-center text-[13px] font-medium text-[#a4889a] dark:text-rose-200/75">·18道精选问题 · 多维度专业解析</div>

          {/* 理论说明卡 */}
          <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
            <p className="text-[14.5px] leading-[1.9] text-[#4a4a52] dark:text-zinc-200">
              你们的恋爱正处于怎样的阶段？
              <br />
              关系中的<b className="text-[#26262b] dark:text-zinc-100">亲密</b>、<b className="text-[#26262b] dark:text-zinc-100">激情</b>、<b className="text-[#26262b] dark:text-zinc-100">承诺</b>是否均衡？
              <br />
              本测评基于<b className="text-[#26262b] dark:text-zinc-100">斯滕伯格爱情三角理论</b>与<b className="text-[#26262b] dark:text-zinc-100">SVR理论</b>，科学剖析你们的恋爱现状，帮助你们看清<b className="text-[#26262b] dark:text-zinc-100">情感结构</b>与<b className="text-[#26262b] dark:text-zinc-100">成长空间</b>。
              <br />
              运用人工智能进行深度分析，以数据和洞察，助你们更好地理解彼此，迈向更稳固、更幸福的<b className="text-[#26262b] dark:text-zinc-100">亲密关系</b>。
            </p>
            <div className="mt-3 border-t border-[#f6e7ea] dark:border-white/10 pt-3">
              <div className="flex flex-wrap gap-2">
                {['关系现状', '成长建议', '情感结构', '科学洞察'].map((t) => (
                  <span key={t} className="rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-3 py-1.5 text-[12px] font-medium text-[#4a4a52] dark:text-zinc-200">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 测评亮点 */}
          <div className="mt-6 px-1">
            <div className="flex items-center gap-2">
              <span className="h-4 w-[3px] rounded-full bg-[linear-gradient(180deg,#ff7a9c,#f2536a)]" />
              <span className="text-[16.5px] font-extrabold text-[#26262b] dark:text-zinc-100">测评亮点</span>
            </div>
            <div className="mt-3 space-y-2.5">
              {[
                { t: '关系健康度量化', d: '多维度量化你们的亲密、激情、承诺，全面呈现关系健康状况。', bg: '#fdeef2' },
                { t: '情感沟通画像', d: '剖析你们的沟通模式与互动风格，发现潜在优势与改进空间。', bg: '#fdf3f6' },
                { t: '双人同步测评', d: `${ta}也会在同一时间独立作答，两份报告对比着看，甜度翻倍。`, bg: '#fdeef2' },
              ].map((c) => (
                <div key={c.t} className="rounded-2xl p-3.5" style={{ background: c.bg }}>
                  <div className="text-[14.5px] font-bold text-[#26262b] dark:text-zinc-100">{c.t}</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-[#b58a97] dark:text-rose-200/75">{c.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 开始测试（吸底） */}
          <div className="sticky bottom-0 -mx-3.5 mt-7 bg-[linear-gradient(180deg,rgba(253,240,243,0),#fdf0f3_42%)] px-3.5 pb-6 pt-4">
            <button
              type="button"
              data-testid="status-exam-start"
              onClick={() => {
                if (done) {
                  setView('result');
                } else {
                  // 续答：跳到第一道还没答的题；TA 已答过的题回显蓝勾
                  const idx = Math.max(0, STATUS_EXAM.findIndex((_, i2) => myPicks[String(i2)] == null));
                  setQi(idx);
                  setAiPick(taPicks[String(idx)] ?? null);
                  setAiBusy(false);
                  setView('quiz');
                }
              }}
              className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[17.5px] font-bold text-white shadow-[0_6px_18px_rgba(242,83,106,0.32)] transition-transform active:scale-[0.98]"
            >
              {done ? '查看我们的测评报告' : answeredCount > 0 ? '继续测试' : '开始测试'}
            </button>
          </div>

          {/* 恋爱状态快选（保留原有功能） */}
          <div className="mt-2 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
            <div className="text-[14px] font-bold text-[#3c3c42] dark:text-zinc-200">现在的恋爱状态</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {STATUS_LIST.map((s) => {
                const picked = state.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      patch({ status: s });
                      showToast(`状态已更新为「${s}」`);
                    }}
                    className={`rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors ${picked ? 'bg-[#fdeef1] dark:bg-rose-300/10 text-[#e0405c] ring-2 ring-[#f2536a]/60' : 'bg-[#f4f4f6] dark:bg-zinc-900/80 text-[#4a4a52] dark:text-zinc-200 active:bg-[#ececf0] dark:active:bg-zinc-900'}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SubShell>
    );
  }

  // ---------------- 答题页（参考图5：我粉勾 / TA 蓝勾同步作答） ----------------
  if (view === 'quiz') {
    return (
      <SubShell title="恋爱状态分析" onBack={close}>
        <div className="-mx-3.5 -mb-8 min-h-full bg-[#fdf0f3] dark:bg-zinc-900 px-3.5 pb-8">
          <div className="pt-1 text-center text-[13px] text-[#a4889a] dark:text-rose-200/75" data-testid="status-exam-progress">
            {qi + 1}/{STATUS_EXAM.length}
          </div>
          <div className="mx-auto mt-1.5 h-1 w-[120px] overflow-hidden rounded-full bg-white/80 dark:bg-zinc-800/85">
            <span className="block h-full rounded-full bg-[linear-gradient(90deg,#ff9db4,#f2536a)] transition-all" style={{ width: `${((qi + 1) / STATUS_EXAM.length) * 100}%` }} />
          </div>

          {/* 题目卡 */}
          <div className="mt-4 rounded-3xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl p-5 shadow-[0_10px_30px_rgba(0,0,0,0.08)]" data-testid="status-exam-card">
            <div className="flex gap-2">
              <span className="shrink-0 text-[17px] font-extrabold text-[#26262b] dark:text-zinc-100">Q{qi + 1}</span>
              <span className="text-[16.5px] font-bold leading-relaxed text-[#26262b] dark:text-zinc-100">{q.q}</span>
            </div>
            <div className="mt-4 space-y-2.5">
              {q.opts.map((o, i) => {
                const mine = myCur === i;
                const taHere = aiPick === i;
                const both = mine && taHere;
                return (
                  <button
                    key={o}
                    type="button"
                    data-testid={`status-opt-${i}`}
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                      both
                        ? 'bg-[linear-gradient(135deg,#fdf0f5,#eef2fd)] ring-2 ring-[#f2536a]/70'
                        : mine
                          ? 'bg-[#fdeef1] dark:bg-rose-300/10 ring-2 ring-[#f2536a]/70'
                          : taHere
                            ? 'bg-[#eef2fd] dark:bg-indigo-400/15 ring-2 ring-[#7f96e0]'
                            : 'bg-[#f7f7f9] dark:bg-zinc-900/70 active:bg-[#ececf0] dark:active:bg-zinc-900/80'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <span
                        className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 ${
                          mine ? 'border-[#f2536a] bg-[#f2536a]' : taHere ? 'border-[#7f96e0] bg-[#7f96e0]' : 'border-[#d9d9df] dark:border-white/10 bg-white dark:bg-zinc-800/95'
                        }`}
                      >
                        {(mine || taHere) && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </span>
                      {both && (
                        <span className="absolute -right-1.5 -top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#7f96e0] ring-2 ring-white">
                          <Check className="h-2 w-2 text-white" strokeWidth={4} />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#2c2c30] dark:text-zinc-100">{o}</span>
                    {both && <span className="shrink-0 text-[11px] font-bold text-[#7f96e0]">你们选了同一个</span>}
                    {mine && !taHere && <span className="shrink-0 text-[11px] font-bold text-[#f2536a]">我的选择</span>}
                    {taHere && !mine && <span className="shrink-0 text-[11px] font-bold text-[#7f96e0]">TA 的选择</span>}
                  </button>
                );
              })}
            </div>
            {/* 双方作答状态行 */}
            <div className="mt-3.5 flex items-center justify-between border-t border-[#f6e7ea] dark:border-white/10 pt-3 text-[12px]">
              <span className={`flex items-center gap-1 font-semibold ${myCur != null ? 'text-[#e0405c]' : 'text-[#c9c9cf] dark:text-zinc-500'}`}>
                <span className={`grid h-4 w-4 place-items-center rounded-full ${myCur != null ? 'bg-[#f2536a]' : 'bg-[#e5e5ea] dark:bg-zinc-700'}`}>
                  {myCur != null && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                </span>
                {me}
              </span>
              <span className={`flex items-center gap-1 font-semibold ${aiBusy ? 'text-[#8fa4ef]' : aiPick != null ? 'text-[#7f96e0]' : 'text-[#c9c9cf] dark:text-zinc-500'}`} data-testid="status-ai-state">
                <span className={`grid h-4 w-4 place-items-center rounded-full ${aiBusy ? 'bg-[#aebdf0] [animation:couple-float-y_1s_ease-in-out_infinite]' : aiPick != null ? 'bg-[#7f96e0]' : 'bg-[#e5e5ea] dark:bg-zinc-700'}`}>
                  {aiPick != null && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
                </span>
                {ta}
                {aiBusy && <span className="font-normal text-[#8fa4ef]">正在作答…</span>}
              </span>
            </div>
          </div>

          {/* 下一题 */}
          <div className="mt-6 pb-4 text-center">
            <button
              type="button"
              data-testid="status-exam-next"
              onClick={nextQ}
              disabled={myCur == null || aiPick == null}
              className="mx-auto flex h-[52px] w-[64%] items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-bold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-all active:scale-[0.98] disabled:opacity-45 disabled:shadow-none"
            >
              {qi >= STATUS_EXAM.length - 1 ? '查看我们的结果' : '下一题'}
            </button>
            <div className="mt-2 text-[11.5px] text-[#c9aeb6] dark:text-rose-200/55">你们俩在同一时间各自作答 · 选项互通可见</div>
          </div>
        </div>
      </SubShell>
    );
  }

  // ---------------- 结果页：双方报告（我 = 粉，TA = 蓝） ----------------
  const rep = report ?? (done ? statusLocalReport(myPicks, taPicks, me, ta) : null);
  const dimBars = (picks: Record<string, number>, color: string) => (
    <div className="mt-3 space-y-2">
      {(['亲密', '激情', '承诺'] as const).map((d) => {
        const v = statusDimScore(picks, d);
        return (
          <div key={d} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[11.5px] text-[#8e8e96] dark:text-zinc-400">{d}</span>
            <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80">
              <span className="block h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
            </span>
            <span className="w-8 shrink-0 text-right text-[11.5px] font-semibold text-[#4a4a52] dark:text-zinc-200">{v}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <SubShell title="恋爱状态分析" onBack={close}>
      <div className="-mx-3.5 -mb-8 min-h-full bg-[#fdf0f3] dark:bg-zinc-900 px-3.5 pb-8 pt-3">
        {genLoading && (
          <div className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-white/85 dark:bg-zinc-800/90 py-3 text-[13px] font-medium text-[#6e6e76] dark:text-zinc-300 shadow-sm" data-testid="status-report-loading">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d9d9de] dark:border-white/10 border-t-[#6e6e76]" />
            正在用你配置的 API 模型生成双方报告…
          </div>
        )}
        {rep && (
          <>
            <div className="mt-2 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
              <div className="text-[15px] font-bold text-[#26262b] dark:text-zinc-100">分析师点评</div>
              <div className="mt-1.5 text-[13.5px] leading-relaxed text-[#6e6e76] dark:text-zinc-300">{rep.overall}</div>
            </div>

            {/* 我的报告（粉色） */}
            <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.07)]" data-testid="status-report-me">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2c2c30] text-[11px] font-bold text-white">{me.slice(0, 1)}</span>
                  <span className="text-[15px] font-bold text-[#26262b] dark:text-zinc-100">{me} 的报告</span>
                </div>
                <span className="rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-2.5 py-1 text-[11px] font-bold text-[#4a4a52] dark:text-zinc-200">{rep.me.title}</span>
              </div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-[40px] font-extrabold leading-none text-[#26262b] dark:text-zinc-100">{rep.me.score}</span>
                <span className="pb-1 text-[13px] text-[#c9aeb6] dark:text-rose-200/55">分 / 100</span>
              </div>
              {dimBars(myPicks, 'linear-gradient(90deg,#b9b9c2,#5c5c64)')}
              <div className="mt-3 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">{rep.me.summary}</div>
              <div className="mt-3 space-y-1.5 border-t border-[#f6e7ea] dark:border-white/10 pt-3">
                {rep.me.advice.map((a, i) => (
                  <div key={i} className="flex gap-2 text-[13px] leading-relaxed text-[#6e6e76] dark:text-zinc-300">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2c2c30]" />
                    {a}
                  </div>
                ))}
              </div>
            </div>

            {/* TA 的报告（蓝色） */}
            <div className="mt-4 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-4 shadow-[0_8px_24px_rgba(127,150,224,0.14)]" data-testid="status-report-ta">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#7f96e0] text-[11px] font-bold text-white">{ta.slice(0, 1)}</span>
                  <span className="text-[15px] font-bold text-[#7f96e0]">{ta} 的报告</span>
                </div>
                <span className="rounded-full bg-[#eef2fd] dark:bg-indigo-400/15 px-2.5 py-1 text-[11px] font-bold text-[#7f96e0]">{rep.ta.title}</span>
              </div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-[40px] font-extrabold leading-none text-[#7f96e0]">{rep.ta.score}</span>
                <span className="pb-1 text-[13px] text-[#b6b9d4] dark:text-zinc-400">分 / 100</span>
              </div>
              {dimBars(taPicks, 'linear-gradient(90deg,#b9c6f2,#7f96e0)')}
              <div className="mt-3 text-[13.5px] leading-relaxed text-[#4a4a52] dark:text-zinc-200">{rep.ta.summary}</div>
              <div className="mt-3 space-y-1.5 border-t border-[#e9edfa] dark:border-white/10 pt-3">
                {rep.ta.advice.map((a, i) => (
                  <div key={i} className="flex gap-2 text-[13px] leading-relaxed text-[#6e6e76] dark:text-zinc-300">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#7f96e0]" />
                    {a}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 操作 */}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-testid="status-exam-again"
            onClick={restart}
            className="flex h-[50px] flex-1 items-center justify-center rounded-full border-[1.5px] border-dashed border-[#3c3c42] dark:border-white/15 text-[15px] font-semibold text-[#26262b] dark:text-zinc-100 transition-colors active:bg-[#f7f7f9] dark:active:bg-zinc-900/70"
          >
            重新测试
          </button>
          <button
            type="button"
            data-testid="status-exam-regen"
            onClick={() => void genReport(false)}
            disabled={genLoading}
            className="flex h-[50px] flex-1 items-center justify-center rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[15px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_2px_10px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {report ? 'AI 重新分析' : 'AI 深度分析'}
          </button>
        </div>
        <button type="button" onClick={close} className="mx-auto mt-4 block text-[13px] text-[#8e8e96] dark:text-zinc-400 underline underline-offset-4 active:opacity-60">
          回到恋人空间
        </button>
        <div className="mt-3 pb-2 text-center text-[11px] text-[#c9aeb6]">已答 {answeredCount}/{STATUS_EXAM.length} 题 · 报告由 {useSettings.getState().apiConfig?.baseUrl ? '你配置的 API 模型' : '内置模型'}生成</div>
      </div>
    </SubShell>
  );
}

/** 情侣印象词库（参考图4 风格，换一批轮换） */
const IMPRESSION_POOL = [
  '教科书式的恋爱',
  '男友力max',
  '一生幸福',
  '笔芯',
  '甜蜜暴击',
  '默默吞下这碗狗粮',
  '颜王cp',
  '坐等喝喜酒',
  '国民夫妇',
  '天生一对',
  '双向奔赴',
  '甜甜的恋爱',
  '模范情侣',
  '灵魂伴侣',
  '心动信号站',
  '撒糖机',
  '吵架不过夜',
  '永远的神',
  '每日亲亲',
  '牵手散步',
  '甜到冒泡',
  '惹人羡慕',
  '稳稳的幸福',
  '小两口的快乐',
];

/** 情侣印象（第八轮重做，参考图4）：粉渐变横幅 + 双头像选贴的对象 + 词库点选贴标签（每人最多5个）+ 自定义 + 换一批 + 提交 */
function ImpressPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  // 主 App 传入的 patch 实际支持函数式 updater（运行时是宽化函数），此处取函数式形态用于原子更新
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const [target, setTarget] = useState<'me' | 'ta'>('ta');
  const [custom, setCustom] = useState('');
  const [batch, setBatch] = useState<string[]>(() => IMPRESSION_POOL.slice(0, 9));

  /** 词库性别自适应：用户是女生时，贴给自己的词库里「男友力max」换成「女友力max」（用户是女生，男友力是男性向标签） */
  const effPool = useMemo(() => {
    if (target === 'me' && state.gender === '女') return IMPRESSION_POOL.map((w) => (w === '男友力max' ? '女友力max' : w));
    return IMPRESSION_POOL;
  }, [target, state.gender]);

  // 切换贴的对象/性别变化 → 词库重置（保证性别自适应生效）
  useEffect(() => {
    setBatch(effPool.slice(0, 9));
  }, [effPool]);

  const tags = target === 'me' ? state.impressionsMe : state.impressionsTa;
  const otherTags = target === 'me' ? state.impressionsTa : state.impressionsMe;

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (tags.includes(t)) {
      showToast('这个标签已经贴过啦');
      return;
    }
    if (tags.length >= 5) {
      showToast('最多贴 5 个词，先提交吧');
      return;
    }
    // 函数式更新：快速连点也逐条生效（读 prev 而非 render 快照）
    patchFn((prev) => {
      const cur = target === 'me' ? prev.impressionsMe : prev.impressionsTa;
      if (cur.includes(t) || cur.length >= 5) return {};
      return target === 'me' ? { impressionsMe: [...cur, t] } : { impressionsTa: [...cur, t] };
    });
    showToast('标签已贴上 ♡');
  };

  const removeTag = (t: string) =>
    patchFn((prev) =>
      target === 'me' ? { impressionsMe: prev.impressionsMe.filter((x) => x !== t) } : { impressionsTa: prev.impressionsTa.filter((x) => x !== t) },
    );

  const shuffle = () => {
    const used = new Set([...tags, ...otherTags]);
    const src = effPool.filter((w) => !used.has(w));
    const pool = src.length >= 9 ? src : [...src, ...effPool.filter((w) => !tags.includes(w))];
    const out = [...new Set(pool)];
    // 洗牌取前 9
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    setBatch(out.slice(0, 9));
  };

  const avatarBlock = (side: 'me' | 'ta') => {
    const active = target === side;
    const name = side === 'me' ? state.meName || '我' : state.taName || 'TA';
    const avatar = side === 'me' ? state.meAvatar : state.taAvatar;
    return (
      <button
        type="button"
        data-testid={`impress-target-${side}`}
        onClick={() => setTarget(side)}
        className="flex w-[76px] flex-col items-center gap-1.5"
        aria-label={`贴给${side === 'me' ? '我' : 'TA'}`}
      >
        <span className={`relative h-[64px] w-[64px] overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-800 transition-shadow ${active ? 'shadow-[0_0_0_3px_#fff,0_0_0_6px_#f2536a]' : 'shadow-[0_0_0_3px_#fff,0_4px_12px_rgba(0,0,0,0.10)]'}`}>
          {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={64} />}
          {active && (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[10px] font-bold text-white shadow">✓</span>
          )}
        </span>
        <span className={`max-w-full truncate text-[12.5px] ${active ? 'font-bold text-[#e0405c]' : 'text-[#6e6e76] dark:text-zinc-300'}`}>{name}</span>
      </button>
    );
  };

  return (
    <SubShell title="情侣印象" onBack={close}>
      {/* 粉渐变横幅（参考图4） */}
      <div className="-mx-3.5 -mt-0 select-none bg-[linear-gradient(135deg,#f97362,#f2536a_55%,#e84c8b)] px-5 pb-12 pt-5 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[24px] font-extrabold leading-tight text-white">
          先选
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[21px] font-extrabold text-[#26262b] dark:text-zinc-100 shadow-[0_3px_10px_rgba(0,0,0,0.12)]">5</span>
          个词自评一下你们吧
        </div>
      </div>

      {/* 双头像卡（压在横幅上） */}
      <div className="-mt-9 rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl px-4 pb-5 pt-5 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
        <div className="flex items-start justify-center gap-9">{avatarBlock('me')}{avatarBlock('ta')}</div>
        <div className="mt-4 border-t border-dashed border-[#e9e9ee] dark:border-white/10 pt-3 text-center">
          <div className="text-[12.5px] text-[#9a9aa2] dark:text-zinc-400">
            {target === 'me' ? 'TA 眼中的你' : '你眼中的 TA'} · 已贴 {tags.length}/5
          </div>
          {tags.length === 0 ? (
            <div className="mt-3 rounded-lg border-x-0 border-dashed border-[#f0e3e5] dark:border-white/10 py-3 text-[14px] text-[#c58f9c] dark:text-rose-200/75" data-testid="impress-empty">
              还没有人贴过印象哦
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap justify-center gap-2" data-testid="impress-current-tags">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full bg-[#f0f0f3] dark:bg-zinc-900/80 px-3 py-1.5 text-[13px] text-[#4a4a52] dark:text-zinc-200">
                  {t}
                  {(state.aiImpressions ?? []).includes(t) && target === 'me' && (
                    <span className="rounded-full bg-[#eef2fd] dark:bg-indigo-400/15 px-1.5 py-px text-[9px] font-bold text-[#7f96e0]">TA贴</span>
                  )}
                  <button type="button" onClick={() => removeTag(t)} aria-label={`删除标签${t}`} className="text-[#e5a0b0] active:opacity-60">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 词库标签墙 */}
      <div className="mt-5 flex flex-wrap gap-2.5" data-testid="impress-pool">
        {batch.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => addTag(w)}
            className="rounded-lg border border-[#e9e9ee] dark:border-white/10 bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl px-3.5 py-2 text-[13.5px] text-[#3c3c42] dark:text-zinc-200 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform active:scale-95"
          >
            {w}
          </button>
        ))}
      </div>

      {/* 自定义 + 贴上 + 换一批（第五十六轮：补上「贴上」按钮——此前只能靠回车添加，移动端根本没有入口） */}
      <div className="mt-4 flex items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              addTag(custom);
              setCustom('');
            }
          }}
          placeholder="自定义…"
          maxLength={10}
          enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-xl border-2 border-dashed border-[#f0dfe3] dark:border-white/10 bg-white/70 dark:bg-zinc-800/78 px-3.5 text-[14px] outline-none placeholder:text-[#c9c9cf] dark:placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={() => {
            if (!custom.trim()) return;
            addTag(custom);
            setCustom('');
          }}
          disabled={!custom.trim()}
          data-testid="impress-add"
          aria-label="贴上自定义标签"
          className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] px-3.5 text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(242,83,106,0.35)] transition-transform active:scale-95 disabled:opacity-40"
        >
          <Heart className="h-4 w-4" />
          贴上
        </button>
        <button
          type="button"
          onClick={shuffle}
          data-testid="impress-shuffle"
          aria-label="换一批词库"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[14px] font-medium text-[#26262b] dark:text-zinc-100 active:opacity-60"
        >
          <RefreshCcw className="h-4 w-4" />
          换一批
        </button>
      </div>

      {/* 第十轮：印象下的聊天（TA 根据人设记忆回复；可聊标签、反驳、拌嘴） */}
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[#4a4a52] dark:text-zinc-200">
          <MessageCircleHeart className="h-4 w-4 text-[#4a4a52] dark:text-zinc-200" />
          聊聊这些印象
        </div>
        <CommentThread
          state={state}
          patch={patchFn}
          threadKey="impress"
          hint={`和 ${state.taName || 'TA'} 聊聊你们眼里的彼此`}
          testId="impress-chat"
        />
      </div>

      {/* 底部提交（吸底） */}
      <div className="sticky bottom-0 -mx-3.5 mt-6 bg-[linear-gradient(180deg,rgba(255,255,255,0),#fff_38%)] dark:bg-[linear-gradient(180deg,rgba(13,13,16,0),#0d0d10_38%)] px-3.5 pb-6 pt-4">
        <button
          type="button"
          data-testid="impress-submit"
          onClick={() => showToast(tags.length > 0 ? '印象已提交，甜甜的恋爱值 +1 ♡' : '先选几个词再提交吧')}
          className="h-[50px] w-full rounded-2xl bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[16.5px] font-semibold text-[#1b1b1f] dark:text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.07] dark:ring-white/10 transition-transform active:scale-[0.98]"
        >
          提 交
        </button>
      </div>
    </SubShell>
  );
}

/** 恋爱资料（参考图2）：iOS 分组列表（头像/昵称/性别/情侣号/恋人证书/登录记录/解除关系） */
function ProfilePage({ state, patch, showToast, close, onReset }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void; onReset: () => void }) {
  const meInput = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<null | 'nickname' | 'gender' | 'cert' | 'logins' | 'reset'>(null);
  const [nickDraft, setNickDraft] = useState('');

  const pickAvatar = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await fileToScaledDataURL(f, 360, 0.85);
      patch({ meAvatar: url });
      showToast('头像已更新 ♡');
    } catch {
      showToast('图片处理失败');
    }
  };

  const copyNo = async () => {
    try {
      await navigator.clipboard.writeText(state.coupleNo || '');
      showToast('情侣号已复制 ♡');
    } catch {
      showToast('复制失败，长按手动复制');
    }
  };

  const rowCls = 'flex min-h-[50px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900';
  const labelCls = 'min-w-0 flex-1 text-[14.5px] text-[#2c2c30] dark:text-zinc-100';
  const valCls = 'max-w-[170px] truncate text-[13px] text-[#a9a9b2] dark:text-zinc-400';
  const chev = <ChevronRight className="h-4 w-4 shrink-0 text-[#c6c6cd] dark:text-zinc-500" />;

  return (
    <SubShell title="我的恋爱资料" onBack={close}>
      {/* 第一组：我的资料 */}
      <div className="mt-3 overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-sm">
        <button type="button" onClick={() => meInput.current?.click()} className={rowCls}>
          <span className={labelCls}>头像</span>
          <span className="ml-auto mr-1 h-9 w-9 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
            {state.meAvatar ? <img src={state.meAvatar} alt="我的头像" className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={36} />}
          </span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => {
            setNickDraft(state.meName);
            setDialog('nickname');
          }}
          className={`${rowCls} border-t border-black/[0.04] dark:border-white/10`}
        >
          <span className={labelCls}>昵称</span>
          <span className={valCls}>{state.meName || '未设置'}</span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => setDialog('gender')}
          className={`${rowCls} border-t border-black/[0.04] dark:border-white/10`}
        >
          <span className={labelCls}>性别</span>
          <span className={valCls}>{state.gender || '未设置'}</span>
          {chev}
        </button>
        <button type="button" onClick={copyNo} className={`${rowCls} border-t border-black/[0.04] dark:border-white/10`}>
          <span className={labelCls}>情侣号</span>
          <span className={`${valCls} font-medium tracking-wide text-[#6e6e76] dark:text-zinc-300`}>{state.coupleNo || '--'}</span>
          {chev}
        </button>
        <button type="button" onClick={() => setDialog('cert')} className={`${rowCls} border-t border-black/[0.04] dark:border-white/10`}>
          <span className={labelCls}>恋人证书</span>
          {chev}
        </button>
        <button type="button" onClick={() => setDialog('logins')} className={`${rowCls} border-t border-black/[0.04] dark:border-white/10`}>
          <span className={labelCls}>登录记录</span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => setDialog('reset')}
          className={`${rowCls} border-t border-black/[0.04] dark:border-white/10 text-[#8e8e96] dark:text-zinc-400`}
        >
          <span className="text-[14.5px]">解除关系</span>
          {chev}
        </button>
      </div>

      <p className="mt-4 px-2 text-[12px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">情侣号是你们的小家门牌号，头像、昵称、性别都可以随时修改。</p>

      {/* 隐藏文件选择（我的头像） */}
      <input
        ref={meInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickAvatar(e.target.files?.[0] ?? null);
          e.currentTarget.value = '';
        }}
      />

      {/* 弹层们 */}
      {dialog != null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setDialog(null)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {dialog === 'nickname' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">修改昵称</div>
                <input
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  maxLength={12}
                  className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] dark:bg-zinc-900/70 px-3.5 text-[15px] outline-none"
                />
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300">
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      patch({ meName: nickDraft.trim() || state.meName });
                      setDialog(null);
                      showToast('昵称已保存 ♡');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
                  >
                    保存
                  </button>
                </div>
              </>
            )}

            {dialog === 'gender' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">选择性别</div>
                <div className="mt-3 space-y-2">
                  {['女', '男', '保密'].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        patch({ gender: g });
                        setDialog(null);
                        showToast('性别已保存');
                      }}
                      className={`flex h-11 w-full items-center justify-between rounded-xl px-4 text-[14.5px] ${state.gender === g ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] font-semibold text-white' : 'bg-[#f3f3f5] dark:bg-zinc-900/70 text-[#3c3c42] dark:text-zinc-200'}`}
                    >
                      {g}
                      {state.gender === g && <Check className="h-4 w-4" strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {dialog === 'cert' && (
              <>
                <div className="text-center text-[17px] font-bold tracking-[6px] text-[#2c2c30] dark:text-zinc-100">恋 人 证 书</div>
                <div className="mt-1 text-center text-[10px] tracking-[2px] text-[#b6b6bd] dark:text-zinc-500">LOVER CERTIFICATE</div>
                <div className="mt-4 rounded-xl bg-[#f7f7f9] dark:bg-zinc-900/70 px-4 py-5 text-center">
                  <div className="flex items-center justify-center gap-2.5">
                    <span className="h-8 w-8 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                      {state.meAvatar ? <img src={state.meAvatar} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={32} />}
                    </span>
                    <PixelHeart size={22} />
                    <span className="h-8 w-8 overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80">
                      {state.taAvatar ? <img src={state.taAvatar} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={32} />}
                    </span>
                  </div>
                  <div className="mt-2.5 text-[14px] font-semibold text-[#2c2c30] dark:text-zinc-100">
                    {state.meName || '我'} <span className="mx-1 text-[#a9a9b2] dark:text-zinc-400">♡</span> {state.taName || 'TA'}
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-relaxed text-[#8e8e96] dark:text-zinc-400">
                    兹证明二位已缔结恋人关系
                    <br />
                    {state.anniversary ? `自 ${fmtDateCn(state.anniversary)} 起` : '纪念日期待你们写下'}
                    <br />
                    特此颁发此证，以资纪念。
                  </div>
                </div>
                <button type="button" onClick={() => setDialog(null)} className="mt-4 h-10 w-full rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                  收好证书
                </button>
              </>
            )}

            {dialog === 'logins' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">登录记录</div>
                <div className="mt-3 max-h-[46vh] space-y-1.5 overflow-y-auto">
                  {state.logins.length === 0 && <div className="py-4 text-center text-[13px] text-[#b6b6bd] dark:text-zinc-500">暂无记录</div>}
                  {state.logins.map((t, i) => {
                    const d = new Date(t);
                    return (
                      <div key={`${t}-${i}`} className="flex items-center justify-between rounded-xl bg-[#f7f7f9] dark:bg-zinc-900/70 px-3.5 py-2.5 text-[13px]">
                        <span className="text-[#2c2c30] dark:text-zinc-100">{i === 0 ? '本次登录' : `第 ${state.logins.length - i} 次`}</span>
                        <span className="text-[#8e8e96] dark:text-zinc-400">
                          {fmtDate(t)} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setDialog(null)} className="mt-4 h-10 w-full rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300">
                  关闭
                </button>
              </>
            )}

            {dialog === 'reset' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30] dark:text-zinc-100">确定解除恋人关系吗？</div>
                <p className="mt-2 text-[13px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">将清空恋人空间的全部数据（相册、日记、情书、成长值……），此操作不可恢复。</p>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[13.5px] font-medium text-[#5a5a62] dark:text-zinc-300">
                    再想想
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      onReset();
                      showToast('已解除关系，回到邀请页');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[#3f3f46] text-[13.5px] font-semibold text-white"
                  >
                    确认解除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 每天想你记录页（参考图4）：大粉心 + 我/他连续天数 + 去提醒他 + 心形月历 + 补签卡 */
function MissYouPage({ state, patch, tapMissYou, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; tapMissYou: () => void; showToast: (m: string) => void; close: () => void }) {
  const [monthOff, setMonthOff] = useState(0); // 0=本月，1=上月
  const [sheet, setSheet] = useState<'none' | 'explain' | 'record'>('none');
  const today = todayKey();
  const madeUp = new Set(state.missMadeUp || []);
  const hit = (k: string) => (state.missYouByDay[k] || 0) > 0 || madeUp.has(k);

  /** 我连续想他（第九轮：与首页徽标共用同一计数——连续打卡，点了当天才 +1） */
  const myStreak = useMemo(() => missStreakOf(state), [state.missYouByDay, state.missMadeUp]);
  /** TA（AI）连续想我：从今天（若今天未打卡则从昨天）往回连续计数（第九轮：AI 每天想你） */
  const taHit = (k: string) => (state.taMissYouByDay?.[k] ?? 0) > 0;
  const taStreak = useMemo(() => {
    let n = 0;
    const start = new Date();
    if (!taHit(todayKey(start))) start.setDate(start.getDate() - 1);
    for (;;) {
      if (!taHit(todayKey(start))) break;
      n += 1;
      start.setDate(start.getDate() - 1);
    }
    return n;
  }, [state.taMissYouByDay]);
  const taTodayMiss = state.taMissYouByDay?.[today] ?? 0;
  const taMissTotal = state.taMissYou ?? 0;

  /** 展示月份 */
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() - monthOff, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=周日
  const todayNum = base.getDate();
  const isThisMonth = monthOff === 0;

  /** 本月是否存在断签（missSince 起始之后、今天之前有未打卡日） */
  const sinceStart = state.missSince ? new Date(`${state.missSince}T00:00:00`) : null;
  const hasBreak = useMemo(() => {
    if (!sinceStart) return false;
    for (let d = 1; d <= (isThisMonth ? todayNum : daysInMonth); d++) {
      const dt = new Date(year, month, d);
      if (dt < sinceStart || dt.getTime() >= new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) continue;
      if (!hit(todayKey(dt))) return true;
    }
    return false;
     
  }, [state.missSince, state.missYouByDay, state.missMadeUp, monthOff]);

  /** 补签：消耗一张补签卡 */
  const makeUp = (key: string) => {
    if ((state.missCards || 0) <= 0) return;
    patch({ missCards: (state.missCards || 0) - 1, missMadeUp: [...(state.missMadeUp || []), key] });
    showToast('补签成功，想念不断签 ♡');
  };
  /** 获得补签卡（演示） */
  const gainCard = () => {
    patch({ missCards: (state.missCards || 0) + 1 });
    showToast('获得 1 张想你补签卡 ♡');
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white dark:bg-zinc-900 pt-[54px]">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={close} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200 transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-bold">想你记录</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* 大粉心（点击也能打卡） */}
        <button type="button" onClick={tapMissYou} aria-label="想你 +1" className="mx-auto mt-2 block transition-transform active:scale-95">
          <svg viewBox="0 0 100 100" className="h-[104px] w-[112px]" aria-hidden="true">
            <defs>
              <linearGradient id="missHeartG" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff8fa8" />
                <stop offset="55%" stopColor="#f85e83" />
                <stop offset="100%" stopColor="#ef4a70" />
              </linearGradient>
            </defs>
            <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="url(#missHeartG)" />
            <ellipse cx="32" cy="30" rx="11" ry="7" fill="#ffffff" opacity="0.45" transform="rotate(-24 32 30)" />
          </svg>
        </button>

        {/* 连续天数 */}
        <div className="mt-1 text-center text-[16px] text-[#3c3c42] dark:text-zinc-200">
          我连续想他 <b className="mx-0.5 align-middle text-[27px] font-extrabold text-[#f0436e]">{myStreak}</b> 天 / 他连续想我{' '}
          <b className="mx-0.5 align-middle text-[27px] font-extrabold text-[#4a90f2]">{taStreak}</b> 天
        </div>
        {taMissTotal > 0 && (
          <div className="mt-1 text-center text-[12px] text-[#8fb3e8]">TA 累计想了你 {taMissTotal} 次 · 每天都会想你 ♡</div>
        )}

        {/* 去提醒他 */}
        <div className="mt-3 flex flex-col items-center">
          <button
            type="button"
            onClick={() => showToast('已经去提醒他啦，让他快来想你 ♡')}
            className="h-11 w-[196px] rounded-2xl bg-[linear-gradient(135deg,#ff7a9c,#f2536a)] text-[16px] font-semibold text-white shadow-[0_5px_16px_rgba(242,83,106,0.30)] transition-transform active:scale-[0.97]"
          >
            去提醒他
          </button>
          <span className="mt-2 text-[13px] text-[#b6b6bd] dark:text-zinc-500">{taTodayMiss > 0 ? `TA 今天也想了你 ${taTodayMiss} 次 ♡` : '今天他还没来过哦~'}</span>
        </div>

        {/* 有断签 + 月份切换 */}
        <div className="mt-6 flex items-end justify-between px-4">
          {hasBreak ? (
            <span className="relative -mb-1 rounded-full bg-[#ffc93c] px-2.5 py-[3px] text-[11px] font-bold text-[#7a4e00] shadow-sm">
              ❗有断签
              <span aria-hidden="true" className="absolute -bottom-1 left-3 h-2 w-2 rotate-45 bg-[#ffc93c]" />
            </span>
          ) : (
            <span />
          )}
        </div>
        <div className="relative flex h-11 items-center justify-center bg-[#fdf0f3] dark:bg-rose-300/10">
          <button
            type="button"
            onClick={() => setMonthOff((o) => o + 1)}
            aria-label="上一月"
            className="absolute left-3 flex h-8 w-8 items-center justify-center text-[#8a8a92] dark:text-zinc-400"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <span className="text-[16px] font-semibold text-[#4a4a52] dark:text-zinc-200">
            {year}年{month + 1}月
          </span>
          {monthOff > 0 && (
            <button
              type="button"
              onClick={() => setMonthOff((o) => Math.max(0, o - 1))}
              aria-label="下一月"
              className="absolute right-3 flex h-8 w-8 items-center justify-center text-[#8a8a92] dark:text-zinc-400"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>

        {/* 心形日历 */}
        <div className="grid grid-cols-7 gap-y-2 px-3 py-4">
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isThisMonth && d === todayNum;
            const isFuture = isThisMonth ? d > todayNum : new Date(year, month, d) > base;
            const done = hit(key);
            if (isFuture) {
              return (
                <span key={key} className="flex flex-col items-center">
                  <span className="flex h-[42px] w-[42px] items-center justify-center rounded-2xl bg-[#ececef] dark:bg-zinc-900/80">
                    <svg viewBox="0 0 100 100" className="h-6 w-6 opacity-70">
                      <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="#ffffff" />
                    </svg>
                  </span>
                </span>
              );
            }
            if (done) {
              return (
                <button key={key} type="button" onClick={tapMissYou} aria-label={`${key} 已想你`} className="flex flex-col items-center transition-transform active:scale-90">
                  <span className="relative flex h-[42px] w-[46px] items-center justify-center">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                      <defs>
                        <linearGradient id={`mg${key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ffaebf" />
                          <stop offset="100%" stopColor="#f7738f" />
                        </linearGradient>
                      </defs>
                      <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill={`url(#mg${key})`} />
                    </svg>
                    {isToday ? (
                      <span className="relative text-[10px] font-bold text-white">今日</span>
                    ) : (
                      <span className="relative text-[13px] font-semibold text-white/95">{d}</span>
                    )}
                  </span>
                </button>
              );
            }
            // 过去未打卡（可补签）
            const canMakeUp = isThisMonth && (state.missCards || 0) > 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (!canMakeUp) {
                    showToast('没有补签卡啦，先点下方 + 号获得一张吧');
                    return;
                  }
                  makeUp(key);
                }}
                aria-label={`${key} 未打卡，点击补签`}
                className="flex flex-col items-center transition-transform active:scale-90"
              >
                <span className="relative flex h-[42px] w-[46px] items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                    <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="#ffffff" stroke="#f0a9ba" strokeWidth="5" />
                  </svg>
                  <span className="relative text-[13px] font-semibold text-[#8a5560] dark:text-rose-300">{d}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 补签卡 */}
        <div className="mt-2 flex items-center justify-center gap-1.5 pb-2 text-[15px] text-[#3c3c42] dark:text-zinc-200">
          你们有 <b className="mx-0.5 text-[19px] font-extrabold text-[#f0436e]">{state.missCards || 0}</b>
          <button
            type="button"
            onClick={gainCard}
            aria-label="获得补签卡"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f9a8c0,#f387a7)] text-[15px] font-bold leading-none text-white shadow-sm"
          >
            +
          </button>
          张想你补签卡
        </div>

        {/* 说明/记录链接 */}
        <div className="flex items-center justify-center gap-10 pb-8 pt-2">
          <button type="button" onClick={() => setSheet('explain')} className="flex items-center gap-1 text-[14px] font-medium text-[#f0436e] underline underline-offset-4">
            <HelpCircle className="h-4 w-4" /> 补签卡说明
          </button>
          <button type="button" onClick={() => setSheet('record')} className="flex items-center gap-1 text-[14px] font-medium text-[#f0436e] underline underline-offset-4">
            <Heart className="h-4 w-4" /> 补签卡记录
          </button>
        </div>
      </div>

      {/* 说明 / 记录弹层 */}
      {sheet !== 'none' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-8" onClick={() => setSheet('none')}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sheet === 'explain' ? (
              <>
                <div className="text-[16px] font-bold text-[#2c2c30] dark:text-zinc-100">补签卡说明</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#5a5a62] dark:text-zinc-300">
                  每天回来点一次「想你」即为当天打卡；断签的日子可以用补签卡补上，连续天数就不会断啦。点击日历上空心的日子即可补签，点下方 + 号可获得补签卡（演示）。
                </p>
              </>
            ) : (
              <>
                <div className="text-[16px] font-bold text-[#2c2c30] dark:text-zinc-100">补签卡记录</div>
                <div className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto">
                  {(state.missMadeUp || []).length === 0 ? (
                    <div className="py-8 text-center text-[14px] text-[#b6b6bd] dark:text-zinc-500">还没有补签过哦~</div>
                  ) : (
                    (state.missMadeUp || []).map((k) => (
                      <div key={k} className="flex items-center justify-between rounded-xl bg-[#fdf0f3] dark:bg-rose-300/10 px-4 py-2.5 text-[14px] text-[#5a5a62] dark:text-zinc-300">
                        <span>{fmtDateCn(k)}</span>
                        <span className="text-[12px] font-semibold text-[#f0436e]">已补签 ♡</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            <button type="button" onClick={() => setSheet('none')} className="mt-4 h-11 w-full rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 小礼堂：求婚/结婚证 */
function ChapelPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  return (
    <SubShell title="小礼堂" onBack={close}>
      {state.married ? (
        <div className="mt-6 rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl p-6 text-center shadow-sm">
          <div className="text-[34px]">💒</div>
          <div className="mt-2 text-[22px] font-bold tracking-[4px] text-[#2c2c30] dark:text-zinc-100">结 婚 证</div>
          <div className="mt-4 space-y-2 text-[16px] text-[#4a4a52] dark:text-zinc-200">
            <div>
              {state.meName || '我'} <span className="mx-2 text-[#a9a9b2] dark:text-zinc-400">♡</span> {state.taName || 'TA'}
            </div>
            <div className="text-[13px] text-[#9a9aa2] dark:text-zinc-400">于 {state.marriedAt ? fmtDate(state.marriedAt) : ''} 在小礼堂登记结婚</div>
          </div>
          <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-[#c9502e] text-[11px] font-bold leading-tight text-[#c9502e]">
            结婚证
            <br />
            专用章
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl py-10 shadow-sm">
          <div className="text-[44px]">💍</div>
          <div className="mt-3 text-[18px] font-bold text-[#2c2c30] dark:text-zinc-100">准备一场求婚仪式</div>
          <p className="mt-2 px-8 text-center text-[14px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">在小礼堂，单膝跪地，把余生的每一天都交给对方。</p>
          <button
            type="button"
            onClick={() => {
              patch({ married: true, marriedAt: Date.now() });
              showToast('TA 说「我愿意」💒');
            }}
            className="mt-6 h-12 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-12 text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(60,60,68,0.28)]"
          >
            单膝跪地求婚
          </button>
        </div>
      )}
    </SubShell>
  );
}

/** 联系客服：本地假客服 */
function SupportPage({ close }: { close: () => void }) {
  const [msgs, setMsgs] = useState<{ id: string; me: boolean; text: string }[]>([
    { id: uid(), me: false, text: '您好，这里是恋人空间客服小甜 ♡ 请问有什么可以帮您？' },
  ]);
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { id: uid(), me: true, text: t }]);
    setText('');
    setTimeout(() => {
      setMsgs((m) => [
        ...m,
        {
          id: uid(),
          me: false,
          text: ['收到啦！小甜已经记下来了 ♡', '这个问题交给爱情去解答，会更好的 ♡', '呜呜太甜了，小甜先磕为敬！', '有任何问题都可以随时来找我哦 ♡'][Math.floor(Math.random() * 4)],
        },
      ]);
    }, 700);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-white/90 dark:bg-zinc-800/92 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-12 items-center px-2">
          <button type="button" onClick={close} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full text-[#3a3a40] dark:text-zinc-200">
            <ArrowLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[18px] font-bold">联系客服</div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.me ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-white' : 'bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl text-[#2c2c30] dark:text-zinc-100 shadow-sm'}`}>{m.text}</div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] dark:border-white/10 bg-white/90 dark:bg-zinc-800/92 backdrop-blur-2xl p-3 pb-5">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="说说你遇到的问题…"
            maxLength={100}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            className="h-11 flex-1 rounded-full bg-[#f3f3f5] dark:bg-zinc-900/70 px-4 text-[15px] outline-none placeholder:text-[#b6b6bd] dark:placeholder:text-zinc-500"
          />
          <button type="button" onClick={send} aria-label="发送" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/75 dark:bg-zinc-800/80 backdrop-blur-xl text-[#2c2c30] dark:text-zinc-100 shadow-[0_2px_8px_rgba(0,0,0,0.10)] ring-1 ring-[#e9e9ee] dark:ring-white/10 transition-transform active:scale-95">
            <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 首页背景白纱层（第三十三轮）：半透明白纱 + 背景模糊，强度由设置页「背景白纱模糊度」滑杆控制 */
function HomeVeil({ level }: { level: number }) {
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
function SettingsPage({ state, patch, showToast, close, onReset }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void; onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const bgInput = useRef<HTMLInputElement | null>(null);
  return (
    <SubShell title="设置" onBack={close}>
      <div className="mt-4 overflow-hidden rounded-2xl bg-white/80 dark:bg-zinc-800/85 backdrop-blur-xl shadow-sm">
        <button
          type="button"
          onClick={() => bgInput.current?.click()}
          className="flex h-[58px] w-full items-center justify-between px-5 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
        >
          <span className="text-[16px] font-medium text-[#2c2c30] dark:text-zinc-100">更换首页合影背景</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd] dark:text-zinc-500" />
        </button>
        <button
          type="button"
          onClick={() => {
            patch({ homeBg: null });
            showToast('已恢复默认背景');
          }}
          className="flex h-[58px] w-full items-center justify-between border-t border-black/[0.04] dark:border-white/10 px-5 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
        >
          <span className="text-[16px] font-medium text-[#2c2c30] dark:text-zinc-100">恢复默认背景</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd] dark:text-zinc-500" />
        </button>
        {/* 背景白纱模糊度（第三十三轮）：实时调节首页背景的白纱强度，0 = 无白纱直接可见 */}
        <div className="border-t border-black/[0.04] dark:border-white/10 px-5 pb-5 pt-4" data-testid="couple-home-veil-row">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-medium text-[#2c2c30] dark:text-zinc-100">背景白纱模糊度</span>
            <span className="text-[13px] tabular-nums text-[#9a9aa2] dark:text-zinc-400" data-testid="couple-home-veil-value">{(state.homeVeil ?? 0)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={state.homeVeil ?? 0}
            onChange={(e) => patch({ homeVeil: Number(e.target.value) })}
            className="mt-3.5 w-full accent-[#3f3f46] dark:accent-zinc-400"
            aria-label="背景白纱模糊度"
            data-testid="couple-home-veil-slider"
          />
          <div className="mt-1 flex justify-between text-[11px] text-[#c6c6cd] dark:text-zinc-500">
            <span>清晰</span>
            <span>朦胧</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="flex h-[58px] w-full items-center justify-between border-t border-black/[0.04] dark:border-white/10 px-5 text-left transition-colors active:bg-[#f6f6f8] dark:active:bg-zinc-900"
        >
          <span className="text-[16px] font-medium text-[#8e8e96] dark:text-zinc-400">解除恋人关系（清空数据）</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd] dark:text-zinc-500" />
        </button>
      </div>

      {/* 第三十二轮：「TA 最近在你们的小天地里做的事」区块已按用户要求从设置页删除（AI 行为日志仍在后台记录） */}

      <div className="mt-6 text-center text-[12.5px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">
        恋人空间 v1.0
        <br />
        愿有岁月可回首，且以深情共白头
      </div>
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          try {
            const url = await fileToScaledDataURL(f, 1080, 0.75);
            patch({ homeBg: url });
            showToast('背景已更换 ♡');
          } catch {
            showToast('图片处理失败');
          }
        }}
      />
      {confirmReset && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-10" onClick={() => setConfirmReset(false)}>
          <div className="w-full rounded-2xl bg-white/85 dark:bg-zinc-800/90 backdrop-blur-2xl backdrop-saturate-150 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-semibold text-[#2c2c30] dark:text-zinc-100">确定解除恋人关系吗？</div>
            <p className="mt-2 text-[14px] leading-relaxed text-[#9a9aa2] dark:text-zinc-400">将清空恋人空间的全部数据（相册、日记、情书、成长值……），此操作不可恢复。</p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setConfirmReset(false)} className="h-11 flex-1 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[15px] font-medium text-[#5a5a62] dark:text-zinc-300">
                再想想
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  showToast('已解除关系，回到邀请页');
                }}
                className="h-11 flex-1 rounded-xl bg-[#3f3f46] text-[15px] font-semibold text-white"
              >
                确认解除
              </button>
            </div>
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 相册详情：照片网格 + 上传 + AI 拍（右下角悬浮按钮；配置生图→真图/可改提示词；未配置→文字图片）
 *  + 文字图片大图「生成」升级真图（提示词可改）+ 删除 + 照片留言区（第五十七轮） */
function AlbumDetail({ state, patch, albumId, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void; albumId: string | null; showToast: (m: string) => void; close: () => void }) {
  const album = state.albums.find((a) => a.id === albumId);
  const input = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<number | null>(null);
  // 第五十六轮：AI 拍照弹层（配置了生图模型 → 可编辑提示词生成真图；未配置 → 文字图片兜底）
  const imgCfg = useSettings((s) => s.imgGenConfig);
  const imgReady = Boolean(imgCfg.enabled && imgGenConfigReady(imgCfg));
  const [genOpen, setGenOpen] = useState(false);
  const [genDesc, setGenDesc] = useState('');
  const [genBusy, setGenBusy] = useState<null | 'suggest' | 'gen' | 'text'>(null);
  const [genErr, setGenErr] = useState('');
  const [upgIdx, setUpgIdx] = useState<number | null>(null); // 第五十七轮：文字图片→真图升级模式（大图里点「生成」进入）
  if (!album) {
    return (
      <SubShell title="相册" onBack={close}>
        <div className="mt-10 text-center text-[14px] text-[#9a9aa2] dark:text-zinc-400">相册不存在</div>
      </SubShell>
    );
  }
  const partnerId = readInviteMeta().partnerContactId;
  const taName = state.taName || 'TA';
  const appendPhoto = (entry: CouplePhotoEntry) => {
    patch((prev) => ({ albums: prev.albums.map((a) => (a.id === album.id ? { ...a, photos: [...a.photos, entry] } : a)) }));
  };
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    showToast('正在上传…');
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        urls.push(await fileToScaledDataURL(f, 900, 0.72));
      } catch {
        /* 跳过失败 */
      }
    }
    if (urls.length === 0) {
      showToast('图片处理失败');
      return;
    }
    // 第十轮：TA 知道我传了照片，延时去相册留言；第三十一轮：把第一张新图本体传过去，
    // TA 先识图（看到画面）再留言——留言必须点出照片里的具体内容，不再凭空夸
    patch((prev) => ({ albums: prev.albums.map((a) => (a.id === album.id ? { ...a, photos: [...a.photos, ...urls] } : a)) }));
    aiCommentOnPhoto(album.id, album.name, album.photos.length, urls[0]);
    showToast(`已上传 ${urls.length} 张 ♡`);
  };
  const removePhoto = (idx: number) => {
    // 第六十轮：删照片时同步删掉它名下的留言，并把后面照片的留言 key 整体前移一位——
    // 此前留言按「album:相册id:序号」挂靠，删图后留言残留，之后新补位的照片还会背上旧留言
    patch((prev) => ({
      albums: prev.albums.map((a) => (a.id === album.id ? { ...a, photos: a.photos.filter((_, i) => i !== idx) } : a)),
      comments: (prev.comments ?? [])
        .filter((c) => c.key !== `album:${album.id}:${idx}`)
        .map((c) => {
          const m = /^album:(.+):(\d+)$/.exec(c.key);
          if (m && m[1] === album.id && Number(m[2]) > idx) return { ...c, key: `album:${album.id}:${Number(m[2]) - 1}` };
          return c;
        }),
    }));
    setView(null);
    showToast('已删除');
  };
  /** AI 想一个画面（按人设+记忆+聊天生成画面描述，填进提示词可改） */
  const aiSuggest = async () => {
    if (genBusy) return;
    setGenBusy('suggest');
    setGenErr('');
    try {
      const r = await aiDecideCouplePhoto({ albumId: album.id, hint: genDesc.trim() || undefined });
      if (r) setGenDesc(r.desc);
      else setGenErr('TA 还没想好拍什么，再试一次吧');
    } catch {
      setGenErr('生成失败，请重试');
    }
    setGenBusy(null);
  };
  const openGenSheet = () => {
    setGenOpen(true);
    setUpgIdx(null);
    setGenErr('');
    if (imgReady && !genDesc.trim()) void aiSuggest(); // 打开即让 TA 先想一个画面
  };
  /** 生成真图（锁脸：按 TA 的参考图/外貌生成，提示词可改）。
   *  第五十七轮：普通模式追加新照片；升级模式（upgIdx）替换对应文字图片/旧生成图。
   *  第五十八轮：生成的真图记成卡片（kind:'img' + desc），相册大图右侧可再生成；两种模式 TA 都是拍摄者，留言走拍摄者视角。 */
  const genRealPhoto = async () => {
    const desc = genDesc.trim();
    if (!desc) {
      setGenErr('先写一句画面描述吧');
      return;
    }
    if (!partnerId) {
      setGenErr('先邀请 TA 建立情侣关系吧');
      return;
    }
    setGenBusy('gen');
    setGenErr('');
    try {
      const r = await generateCharacterPhoto({ cfg: imgCfg, contactId: partnerId, desc, charName: taName, useRef: true });
      const idx = upgIdx != null ? upgIdx : album.photos.length;
      const upgrading = upgIdx != null;
      const entry: CouplePhotoEntry = { kind: 'img', src: r.src, desc, byTa: true, at: Date.now() };
      patch((prev) => ({
        albums: prev.albums.map((a) =>
          a.id === album.id ? { ...a, photos: upgrading ? a.photos.map((p, i) => (i === upgIdx ? entry : p)) : [...a.photos, entry] } : a,
        ),
      }));
      setGenOpen(false);
      setGenDesc('');
      setUpgIdx(null);
      showToast(upgrading ? '已生成新照片 ♡' : '照片已放进相册 ♡');
      aiCommentOnPhoto(album.id, album.name, idx, r.src, { byTa: true, knownDesc: desc });
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : '照片生成失败，请重试');
    }
    setGenBusy(null);
  };
  /** 让 TA 拍一张文字图片（未配置生图模型时 / 或想先要文字版时）。
   *  第五十七轮：随照片附的一句话（r.text）作为 TA 的第一条留言写进照片下方（拍摄者视角）。 */
  const genTextPhoto = async () => {
    if (!partnerId) {
      setGenErr('先邀请 TA 建立情侣关系吧');
      return;
    }
    setGenBusy('text');
    setGenErr('');
    try {
      const r = await aiDecideCouplePhoto({ albumId: album.id, hint: genDesc.trim() || undefined });
      if (!r) {
        setGenErr('TA 还没想好拍什么，再试一次吧');
        setGenBusy(null);
        return;
      }
      const idx = album.photos.length;
      appendPhoto({ kind: 'textcard', text: r.text, desc: r.desc, byTa: true, at: Date.now() });
      patch((prev) => ({
        comments: [
          ...(prev.comments ?? []),
          { id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: `album:${album.id}:${idx}`, from: 'ta', text: r.text, at: Date.now() },
        ],
      }));
      setGenOpen(false);
      setGenDesc('');
      showToast('文字图片已放进相册 ♡');
    } catch {
      setGenErr('生成失败，请重试');
    }
    setGenBusy(null);
  };
  const cur = view != null ? album.photos[view] : undefined;
  const curText = cur && isTextPhoto(cur) ? cur : null; // 文字图片卡片（类型收窄后用）
  const curImg = cur && !isTextPhoto(cur) ? cur : null; // 真图（dataURL 字符串或 AI 生成卡片）
  const curGen = curImg && isGenPhoto(curImg) ? curImg : null; // AI 生成的真图卡片（带 desc，重生成时预填提示词用）
  // 第六十轮：大图右侧的重生成按钮对所有照片开放——旧版本生成的真图存的是纯字符串（没有 desc 卡片），
  // 用户反馈「生成图片旁边没有再次生成按钮」；现在文字图片 / AI 真图 / 旧图 / 我上传的都能重生成（提示词可改）
  const canRegen = view != null;
  /** 第五十七轮：文字图片大图里的「生成」——进入升级模式弹层，画面描述可改，用生图模型变成真照片
   *  第五十八轮：AI 生成真图同用此入口再生成（预填当时的提示词，可改），生成后原位替换 */
  const openUpgradeSheet = () => {
    if (genBusy === 'gen') return;
    if (!imgReady) {
      showToast('设置 → 图像生成 配置生图模型后，就能重新生成这张照片');
      return;
    }
    if (!partnerId) {
      showToast('先邀请 TA 建立情侣关系吧');
      return;
    }
    setGenDesc(curText?.desc || curText?.text || curGen?.desc || '');
    setUpgIdx(view);
    setGenErr('');
    setGenOpen(true);
  };
  return (
    <SubShell
      title={album.name}
      onBack={close}
      right={
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-9 items-center gap-1 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-4 text-[13px] font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> 上传
        </button>
      }
    >
      <div className="flex min-h-full flex-col">
        {album.photos.length === 0 ? (
          <div className="mt-20 flex flex-col items-center gap-3 text-[#b6b6bd] dark:text-zinc-500">
            <ImageIcon className="h-12 w-12" strokeWidth={1.3} />
            <div className="text-[14px]">还没有照片，点右上角上传，或点右下角让 TA 拍一张吧</div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {album.photos.map((p, i) => {
              const tp = isTextPhoto(p);
              const gp = !tp && isGenPhoto(p) ? p : null; // AI 生成真图卡片（第五十八轮）
              return (
                <button
                  key={`${i}-${tp ? `t${p.at}` : photoSrc(p).slice(-24)}`}
                  type="button"
                  onClick={() => {
                    setView(i);
                    // 第三十一轮：TA 像正好也翻到这张一样，可能延时来留言（识图画面+人设+记忆，节流防刷屏）
                    // 第五十七轮：文字图片直接把画面（desc）与拍摄者身份带给 TA，不识图
                    // 第五十八轮：AI 生成真图同样带 desc（画面本来就是 TA 定的）
                    const known = tp ? p.desc : gp ? gp.desc : undefined;
                    aiCommentOnPhotoLazy(album.id, album.name, i, tp ? undefined : photoSrc(p) || undefined, tp || gp ? { byTa: true, knownDesc: known } : undefined);
                  }}
                  className="aspect-square overflow-hidden rounded-lg bg-[#ececef] dark:bg-zinc-900/80"
                >
                  {tp ? (
                    // 第六十轮：文字图片瓦片极简风——纯白 + 细描边 + 灰字，和真图并排不花
                    <span className="flex h-full w-full items-center justify-center bg-white dark:bg-zinc-600 px-2 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
                      <span className="line-clamp-4 w-full text-center text-[10px] leading-[1.7] tracking-[0.01em] text-[#9a9aa2] dark:text-zinc-400">{p.desc || p.text}</span>
                    </span>
                  ) : (
                    <img src={photoSrc(p)} alt={`照片${i + 1}`} className="h-full w-full object-cover transition-transform active:scale-[0.97]" draggable={false} />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {/* 第六十一轮：AI 拍悬浮按钮——毛玻璃风格，去掉图标只留「AI拍」文字；打开大图查看时隐藏 */}
        {view == null && (
          <button
            type="button"
            onClick={openGenSheet}
            data-testid="album-ai-shot"
            className="sticky bottom-4 z-30 ml-auto mt-auto flex items-center self-end rounded-full border border-white/70 bg-gradient-to-b from-white/75 to-white/45 px-5 py-3 text-[14px] font-semibold text-[#3c3c42] dark:text-zinc-200 shadow-[0_10px_30px_rgba(70,60,90,0.18)] backdrop-blur-2xl backdrop-saturate-150 transition-all active:scale-95"
          >
            AI拍
          </button>
        )}
      </div>
      {/* 大图查看 + 删除 + 照片留言区（第十轮：TA 会来留言，我可以回复，多轮往返） */}
      {view != null && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/90" onClick={() => setView(null)}>
          {/* 第六十一轮：重生成按钮移到右上角（与删除并排；点开可改提示词再生成）
              第六十二轮：修顶栏布局——原 h-[54px]+pt-[54px] 内容区高度为 0，按钮垂直居中上溢挡住状态栏；改为按钮行整体排在状态栏下方（与返回/标题行同一水平带） */}
          <div className="flex items-center justify-end gap-2.5 px-4 pb-2.5 pt-[54px]">
            {canRegen && (
              <button
                type="button"
                aria-label="重新生成这张照片"
                title="重新生成（提示词可改）"
                disabled={genBusy === 'gen'}
                onClick={(e) => {
                  e.stopPropagation();
                  openUpgradeSheet();
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-transform active:scale-95 disabled:opacity-50"
              >
                {genBusy === 'gen' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removePhoto(view);
              }}
              aria-label="删除照片"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
          {/* 第六十一轮：图片/卡片居中展示（重生成按钮已移右上角，不再贴图右侧） */}
          <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-3">
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
              {curText ? (
                <div className="w-full max-w-[340px] rounded-[22px] bg-white dark:bg-zinc-800/95 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.45)]" onClick={(e) => e.stopPropagation()}>
                  {/* 第六十轮：文字图片极简风——纯白卡面 + 大留白 + 细分割线，只讲画面本身 */}
                  <p className="whitespace-pre-wrap text-[15px] leading-[2] tracking-[0.02em] text-[#2f2f34] dark:text-zinc-100">{curText.desc || curText.text}</p>
                  <div className="mt-5 border-t border-black/[0.06] dark:border-white/10 pt-3">
                    <span className="text-[11px] tracking-[0.05em] text-[#b4b4bc] dark:text-zinc-400">{curText.byTa ? `${taName} 拍的 · 文字图片` : '文字图片'}</span>
                  </div>
                </div>
              ) : curImg ? (
                <img src={photoSrc(curImg)} alt="查看照片" className="max-h-full max-w-full object-contain" draggable={false} onClick={(e) => e.stopPropagation()} />
              ) : null}
            </div>
          </div>
          <div className="max-h-[38%] shrink-0 overflow-y-auto px-3 pb-6" onClick={(e) => e.stopPropagation()}>
            <CommentThread state={state} patch={patch as unknown as PatchFn} threadKey={`album:${album.id}:${view}`} hint={`和 ${taName} 聊聊这张照片`} dark testId={`album-comment-${view}`} />
          </div>
        </div>
      )}
      {/* AI 拍照弹层（第五十六轮 → 第五十七轮：支持文字图片升级模式，提示词可改） */}
      {genOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55"
          onClick={() => {
            if (!genBusy) {
              setGenOpen(false);
              setUpgIdx(null);
            }
          }}
        >
          <div className="rounded-t-2xl bg-white/85 dark:bg-zinc-800/90 px-4 pb-8 pt-3 backdrop-blur-2xl backdrop-saturate-150 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2] dark:bg-zinc-700/60" />
            <div className="text-center text-[17px] font-bold text-[#2c2c30] dark:text-zinc-100">{upgIdx != null ? '生成这张照片' : `让 ${taName} 拍一张`}</div>
            <div className="mt-1 text-center text-[11.5px] leading-relaxed text-[#b6b6bd] dark:text-zinc-500">
              {upgIdx != null
                ? '把画面描述改成你想要的样子（也可以点「AI 想画面」让 TA 重新想），确认后生成新照片替换这张'
                : imgReady
                  ? 'TA 会按你们的记忆拍一张照片，画面描述可以随便改'
                  : '未配置生图模型：TA 先拍一张「文字图片」给你们（设置 → 图像生成 配置后这里可以生成真图）'}
            </div>
            <textarea
              value={genDesc}
              onChange={(e) => setGenDesc(e.target.value)}
              placeholder={genBusy === 'suggest' ? 'TA 正在想拍什么…' : imgReady ? '画面描述（如：傍晚的天台，穿着白色卫衣回头看镜头）' : '想让 TA 拍什么？（可选，如：今天路过的那家花店）'}
              maxLength={300}
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border border-[#e5e5ea] dark:border-white/10 bg-white/90 dark:bg-zinc-800/92 p-3 text-[13.5px] leading-relaxed text-[#3c3c42] dark:text-zinc-200 outline-none placeholder:text-[#c9c9cf] dark:placeholder:text-zinc-500"
            />
            {genErr && <div className="mt-2 text-[12px] text-[#e05a6d]">{genErr}</div>}
            <div className="mt-3 flex gap-2.5">
              {imgReady && (
                <button
                  type="button"
                  onClick={() => void aiSuggest()}
                  disabled={genBusy !== null}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#f0f0f3] dark:bg-zinc-900/80 text-[14px] font-medium text-[#5a5a62] dark:text-zinc-300 disabled:opacity-50"
                >
                  {genBusy === 'suggest' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  AI 想画面
                </button>
              )}
              {imgReady && (
                <button
                  type="button"
                  onClick={() => void genRealPhoto()}
                  disabled={genBusy !== null}
                  className="flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[14.5px] font-semibold text-white disabled:opacity-60"
                >
                  {genBusy === 'gen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {genBusy === 'gen' ? '正在生成…' : '生成照片'}
                </button>
              )}
            </div>
            {upgIdx == null && (
              <button
                type="button"
                onClick={() => void genTextPhoto()}
                disabled={genBusy !== null}
                className="mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[#e9e2f0] dark:border-white/10 bg-white/70 dark:bg-zinc-800/78 text-[14px] font-medium text-[#7b6f88] dark:text-zinc-400 disabled:opacity-50"
              >
                {genBusy === 'text' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircleHeart className="h-4 w-4" />}
                {genBusy === 'text' ? 'TA 正在拍…' : imgReady ? '或让 TA 拍一张文字图片' : '让 TA 拍一张（文字图片）'}
              </button>
            )}
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </SubShell>
  );
}
