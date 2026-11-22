'use client';

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

import { StatusResult, CoupleAlbum, CouplePlace, TreeCardComment, TreeCard, BoardNote, CouplePactRecord, CoupleState, STATE_KEY, LOVE_HEART_PATH, defaultState, normMoodEmoji, MOOD_LIST, loadCoupleState, ExamTplQ, ExamTpl, ZODIAC_GROUP, zodiacScore, todayKey, daysSince, missStreakOf, fmtDate, uid, genCoupleNo, fmtDateCn, fmtMDHM, daysToNextMonthDay, PixelHeart, MoodFace, CoupleAvatar, TabKey, SubPage, SubShell, PatchFn, cutText, fmtCmtTime, CommentThread, noteColorOf, fmtCountdown, wallStyleOf, noteFaceStyle, noteHasOwnDecor, timeAgoLabel, ShareChannelPicker, statusDimScore, statusTierTitle, statusExtractJson, statusLocalReport, HomeVeil } from './couple-space/shared';
import { NoteClip, BoardAvatar, BoardNoteCard, NoteDetail, CapsulePending, BoardPage, CAPSULE_PRESETS, BOARD_BGS, GCJ_A, GCJ_EE, gcjTransformLat, gcjTransformLng, wgs84ToGcj02, haversineKm, fmtKm, escHtml, RealCoupleMap, PlaceSearchRow, TRAIL_FEED_ICON, TRAIL_KIND_LABEL, TrackPage } from './couple-space/board';
import { ANNIV_PRESETS, AnniversaryPage, QuizHeartLine, QUIZ_POOL, QuizPage, isCustomIndex, LetterPaper, LETTER_PAPERS, LETTER_FONTS, LETTER_FONT_LINKS, LETTER_COLORS, ensureLetterFontLinks, PaperDove, PaperFish, PaperDeco, LetterStars, NightEnvelope, OrderIcon, LETTER_PAGE_CHARS, LETTER_PAGE_HEIGHT, LETTER_MAX_PAGES, LettersPage, MoodPage } from './couple-space/letters';
import { KawaiiFace, ScrapIllus, ScrapFlower, HUNDRED_ROT, HUNDRED_KIND_COUNT, HUNDRED_DRAFT_DEFAULT, HUNDRED_KIND_MAP, HundredPage, PACT_RANDOM_POOL, PACT_TEMPLATE_CLAUSES, PactStamp, PactPaperData, PactPaper, PactPage, EXAM_TPLS, ExamPage, ZODIAC_LIST, ZODIAC_GLYPH, ZODIAC_ELEM_COLOR, ZODIAC_ELEM_NAME, ZodiacPage, CHRON_STATUSES, ChroniclePage, STONE_NAMES, NameTag, StonePage, REPLY_LEVELS, ReplyPage, HotelJump, STATUS_LIST, STATUS_EXAM, StatusPage, IMPRESSION_POOL, ImpressPage, ProfilePage, MissYouPage, ChapelPage, SupportPage, SettingsPage, AlbumDetail } from './couple-space/more';
export type { CoupleState, TreeCard, TreeCardComment, BoardNote } from './couple-space/shared';
export { missStreakOf } from './couple-space/shared';


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

  /** 聊天里的协议卡片点击进来（第十二轮）：切到情侣空间时直接打开协议页（PactPage 挂载后消费具体目标）。
   *  组件可能晚于事件挂载（聊天→情侣空间切换）→ 挂载时也检查一次 pending */
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

  /** 聊天里的考试卡片点击进来（第十五轮）：切到情侣空间时直接打开考试页（ExamPage 挂载后消费具体目标） */
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

  /** 聊天里的情书信封卡片点击进来（第十八轮）：切到情侣空间时直接打开信件页（LettersPage 挂载后消费具体目标，不进主页） */
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
          {/* 恋人头像 + 名字（recv 时为邀请人）；无头像时兜底为情侣空间粉双心图 */}
          <div className="h-[118px] w-[118px] overflow-hidden rounded-full bg-[#ececef] dark:bg-zinc-900/80 ring-[6px] ring-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.10)]">
            {invAvatar ? (
              <img src={invAvatar} alt={invName || '恋人'} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <img src="/icons/couple.png" alt="情侣空间" className="h-full w-full object-cover" draggable={false} />
            )}
          </div>
          <div className="mt-8 text-[30px] font-bold leading-none">{invName || '恋人'}</div>
          <div className="mt-7 text-[30px] font-bold leading-tight text-[#3c3c42] dark:text-zinc-200">邀请你开通情侣空间</div>

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
          <div className="mb-4 text-center text-[16px] text-[#9a9aa2] dark:text-zinc-400">在情侣空间你们可以体验这些</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '情侣相册', icon: <Camera className="h-8 w-8" strokeWidth={1.8} /> },
              { label: '留言板', icon: <Pin className="h-8 w-8" strokeWidth={1.8} /> },
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

  /** 头像 + 下方想念天数徽标（点击「每天想你」后出现）
   *  v61：TA 头像下的 AI 心情小胶囊已删（用户要求只删显示不删功能——情绪引擎照常运转并注入提示词，
   *  只是首页不再展示；「我的」侧从未有过心情胶囊，无需处理） */
  const avatarCol = (side: 'me' | 'ta') => {
    const isMe = side === 'me';
    return (
      <div className="flex w-[78px] flex-col items-center">
        <CoupleAvatar src={isMe ? state.meAvatar : state.taAvatar} name={isMe ? state.meName : state.taName} size={52} />
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
            情侣空间
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
          { key: 'board', label: '留言板', icon: <Pin className="h-6 w-6 text-[#3c3c42] dark:text-zinc-200" strokeWidth={1.9} /> },
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

export function openMeituanTravel(): void {
  setMtPendingPage('travel');
  const ui = useUI.getState();
  if (ui.locked) return;
  if (ui.activeApp && ui.activeApp !== 'meituan') ui.switchToApp('meituan');
  else if (!ui.activeApp || ui.phase === 'closed') ui.openApp('meituan');
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

export const FIXED_ALBUM_ICONS: Record<string, React.ReactNode> = {
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

export function LaceBow({ className = '', size = 26 }: { className?: string; size?: number }) {
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

export function LaceArches({ count = 16 }: { count?: number }) {
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


function SubRouter(props: {
  sub: SubPage;
  state: CoupleState;
  patch: PatchFn;
  albumId: string | null;
  days: number | null;
  tapMissYou: () => void;
  close: () => void;
  showToast: (m: string) => void;
  openSub: (s: SubPage) => void;
  onReset: () => void;
}) {
  const { sub, state, patch, days, tapMissYou, close, showToast, openSub, onReset } = props;

  switch (sub) {
    case 'board':
      return <BoardPage state={state} patch={patch} close={close} showToast={showToast} />;
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
