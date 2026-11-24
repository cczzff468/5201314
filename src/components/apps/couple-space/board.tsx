'use client';

/** 情侣空间心愿墙与轨迹域（第十八轮 #8 拆分）：留言板（便利贴/图钉/胶囊时间轴）+ 情侣地图（GCJ-02 纠偏/真实地图/地点搜索）+ 足迹页。 */

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

import { StatusResult, CoupleAlbum, CouplePlace, TreeCardComment, TreeCard, BoardNote, CouplePactRecord, CoupleState, STATE_KEY, LOVE_HEART_PATH, defaultState, normMoodEmoji, MOOD_LIST, loadCoupleState, ExamTplQ, ExamTpl, ZODIAC_GROUP, zodiacScore, todayKey, daysSince, missStreakOf, fmtDate, uid, genCoupleNo, fmtDateCn, fmtMDHM, daysToNextMonthDay, PixelHeart, MoodFace, CoupleAvatar, TabKey, SubPage, SubShell, PatchFn, cutText, fmtCmtTime, CommentThread, noteColorOf, fmtCountdown, wallStyleOf, noteFaceStyle, noteHasOwnDecor, timeAgoLabel, ShareChannelPicker, statusDimScore, statusTierTitle, statusExtractJson, statusLocalReport, HomeVeil } from './shared';

export function NoteClip() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-[9px] left-1/2 block h-[30px] w-[20px] -translate-x-1/2"
    >
      <svg viewBox="0 0 20 32" className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="note-clip-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fafaf8" />
            <stop offset="0.42" stopColor="#b8bdc5" />
            <stop offset="0.68" stopColor="#eceef2" />
            <stop offset="1" stopColor="#8d939d" />
          </linearGradient>
        </defs>
        {/* 投影：针身在纸上落下的淡淡影子（右下偏移，垂直拉伸） */}
        <g transform="translate(1.4 1.6)" opacity="0.28">
          <path
            d="M5 5.5 V24 a5 5 0 0 0 10 0 V4.5 a2.9 2.9 0 0 0 -5.8 0 V17.5 a1.15 1.15 0 0 0 2.3 0 V6.5"
            fill="none"
            stroke="#4a3a28"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </g>
        {/* 针身：左外丝→底弧→右丝→顶弧→中丝→内底小弧→回丝，两端都在顶部（真实回形针结构） */}
        <path
          d="M5 5.5 V24 a5 5 0 0 0 10 0 V4.5 a2.9 2.9 0 0 0 -5.8 0 V17.5 a1.15 1.15 0 0 0 2.3 0 V6.5"
          fill="none"
          stroke="url(#note-clip-grad)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* 顶部高光：沿顶弧的一小段亮线，让金属有反光层次 */}
        <path
          d="M13.4 5.1 a2.2 2.2 0 0 0 -3.4 -0.2"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="0.7"
          strokeLinecap="round"
        />
        {/* 左丝内侧高光 */}
        <path d="M5.9 8.5 V21" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.55" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 留言板小头像（跟随情侣空间全局头像；没设置时用默认头像兜底） */

export function BoardAvatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  return (
    <span className="block shrink-0 overflow-hidden rounded-full bg-[#ececef]" style={{ width: size, height: size }} aria-hidden="true">
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={size} />}
    </span>
  );
}

/** 墙上的一张便签（卡面最前面是头像+名字 + 正文 + 日期 + 右下角留言数徽章；留言点开详情看；图案卡多大就是多大（含自定义上传卡；横幅卡跨栏铺满可缩、small 卡缩小居中）；胶囊锁着时内容封存只显倒计时；
 *  长按（触屏按住 ~0.5s / 鼠标右键）弹出操作菜单（置顶/删除/多选）；多选模式下点按=勾选/取消勾选（右上角圆勾徽章） */

export function BoardNoteCard({
  note,
  now,
  flash,
  onClick,
  onLongPress,
  selecting,
  selected,
  meName,
  taName,
  meAvatar,
  taAvatar,
  cardCustoms,
  colW,
  fullW,
}: {
  note: BoardNote;
  now: number;
  flash: boolean;
  onClick: () => void;
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
  meName: string;
  taName: string;
  meAvatar: string | null;
  taAvatar: string | null;
  cardCustoms: BoardCardCustom[];
  colW: number;
  fullW: number;
}) {
  const isCapsule = !!note.unlockAt;
  const locked = isCapsule && (note.unlockAt ?? 0) > now;
  // ---- 长按检测（触屏：按住 480ms 触发，滑动/抬手取消；鼠标：右键即触发；触发后吞掉随后的 click 防误开详情） ----
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => clearPress, []); // 卸载兜底清定时器
  const startPress = () => {
    if (!onLongPress) return;
    longFired.current = false;
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longFired.current = true;
      try {
        navigator.vibrate?.(12); // 轻触感反馈（不支持的手机静默忽略）
      } catch {
        /* 无振动能力忽略 */
      }
      onLongPress();
    }, 480);
  };
  // 图案卡（内置/自定义统一皮肤）：多大就是多大（按卡面原始宽高比给最小高度，字多时自然长高）；横幅卡跨栏铺满（small 再缩到 82% 居中）；small 卡宽度 82% 居中
  const skin = !locked && (note.card ?? 0) > 0 ? boardCardSkinOf(note.card ?? 0, cardCustoms) : null;
  const clamp = skin ? (skin.span ? 'line-clamp-4' : skin.ar >= 1 ? 'line-clamp-3' : 'line-clamp-5') : 'line-clamp-6';
  // 由 id 决定的轻微角度（-4°~4°，稳定不闪；--rot 供落钉动画保持同一角度）
  const rot = ((note.id.charCodeAt(note.id.length - 1) * 7 + note.id.length * 3) % 9) - 4;
  const face: CSSProperties = locked
    ? { background: 'linear-gradient(180deg,#ececec,#e3e3e3)', color: '#52525b', border: '1.5px dashed #a8a8a8' }
    : noteFaceStyle(note, cardCustoms);
  if (skin) {
    // v44：缩放系数——scale 优先（样式五用户要求再小一点 → 0.62），缺省沿用 small 的 82%
    const factor = skin.scale ?? (skin.small ? 0.82 : 1);
    const w = skin.span ? fullW * factor : colW * factor;
    if (w > 0) {
      face.minHeight = Math.round(w / skin.ar); // 原始比例的最小高度（字多时自然长高）
      // 顶部插画避让区：按卡面自然高度的比例折算成像素（多栏里 % 基准不可控，直接算像素）
      if (skin.padTop) face.paddingTop = Math.round((w / skin.ar) * skin.padTop);
      // 缩小卡：宽度按系数居中（横幅卡在整墙宽度内缩，普通卡在单栏内缩）
      if (factor < 1) {
        face.width = `${Math.round(factor * 100)}%`;
        face.marginInline = 'auto';
      }
    }
  }
  const mine = note.from === 'me';
  const who = mine ? meName || '我' : taName || 'TA';
  const cCount = (note.comments ?? []).length;
  return (
    <button
      type="button"
      onClick={() => {
        if (longFired.current) {
          longFired.current = false;
          return; // 长按菜单刚触发：吞掉这次 click，防误开便签详情
        }
        onClick();
      }}
      onContextMenu={(e) => {
        if (!onLongPress) return;
        e.preventDefault(); // 桌面右键 = 长按：弹操作菜单（阻止浏览器默认菜单）
        onLongPress();
      }}
      onTouchStart={startPress}
      onTouchMove={clearPress}
      onTouchCancel={clearPress}
      onTouchEnd={(e) => {
        // 长按已触发：阻止浏览器在抬手处合成 click（否则会打在刚弹出的菜单遮罩上，菜单闪现即关——Android Chromium 实测）
        if (longFired.current) e.preventDefault();
        clearPress();
      }}
      aria-label={selecting ? (locked ? '一颗还没开启的时间胶囊' : '勾选这张便签') : locked ? '一颗还没开启的时间胶囊' : '查看这张便签'}
      className={`relative mb-2.5 flex w-full select-none flex-col justify-start break-inside-avoid rounded-[10px] px-3.5 pb-2.5 pt-[17px] text-left shadow-[0_3px_10px_rgba(0,0,0,0.22)] transition-transform duration-150 active:scale-[0.96] ${flash ? '[animation:board-pin-in_.45s_ease-out]' : ''} ${selecting && selected ? 'ring-[3px] ring-black/70 brightness-[0.96]' : ''}`}
      style={{ ...face, transform: `rotate(${rot}deg)`, '--rot': `${rot}deg`, ...(skin?.span ? { columnSpan: 'all' as const } : {}) } as CSSProperties}
    >
      {/* v44：自带胶带装饰的卡面（便签纸）不再叠金属别针 */}
      {!skin?.noPin && <NoteClip />}
      {/* 多选模式：右上角圆勾徽章（选中=黑底白勾；未选=白透圆圈） */}
      {selecting && (
        <span
          aria-hidden="true"
          className={`absolute right-2 top-2 z-10 flex h-[19px] w-[19px] items-center justify-center rounded-full border transition-colors ${selected ? 'border-black bg-black text-white' : 'border-black/35 bg-white/75 text-transparent backdrop-blur-[1px]'}`}
        >
          <Check className="h-3 w-3" strokeWidth={3.6} />
        </span>
      )}
      {locked ? (
        <>
          <span className="flex items-center gap-1 text-[10.5px] font-bold tracking-wide opacity-90">
            <Hourglass className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
            时间胶囊 · 封存中
          </span>
          {/* 打码的字句（封存中谁也看不到） */}
          <span className="mt-1.5 block" aria-hidden="true">
            <span className="block h-[5px] w-[86%] rounded-full bg-black/15" />
            <span className="mt-[5px] block h-[5px] w-[64%] rounded-full bg-black/10" />
            <span className="mt-[5px] block h-[5px] w-[38%] rounded-full bg-black/10" />
          </span>
          <p className="mt-2 text-[10.5px] font-bold opacity-80">{fmtCountdown((note.unlockAt ?? 0) - now)}开启</p>
        </>
      ) : (
        <>
          {isCapsule && (
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/30 px-2 py-[2px] text-[9.5px] font-bold tracking-wide backdrop-blur-[1px]">
              <LockOpen className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
              胶囊已开启
            </span>
          )}
          {/* 卡面最前面：头像 + 名字（跟随情侣空间全局头像） */}
          <span className="flex items-center gap-1.5">
            <BoardAvatar src={mine ? meAvatar : taAvatar} name={who} size={20} />
            <span className="min-w-0 truncate text-[11px] font-bold opacity-80">{who}</span>
          </span>
          {/* 正文 */}
          <p className={`mt-1.5 break-all text-[12.5px] font-semibold leading-[1.55] ${clamp}`}>{note.text}</p>
          {/* 日期（左；置顶的带小别针徽章） + 右下角留言数徽章（有几条留言；封存中的胶囊不显） */}
          <p className="mt-2 flex items-center gap-1.5 text-[10px] font-bold">
            {note.pinned && (
              <span className="inline-flex items-center gap-[3px] rounded-full bg-black/12 px-1.5 py-[1px] text-[9px] font-bold tracking-tight">
                <Pin className="h-[8.5px] w-[8.5px]" strokeWidth={3} aria-hidden="true" />
                置顶
              </span>
            )}
            <span className="opacity-60">{fmtDate(note.at).slice(5)}</span>
            {cCount > 0 && (
              <span className="ml-auto inline-flex items-center gap-[3px] rounded-full bg-black/10 px-1.5 py-[1px] text-[9px] font-bold tracking-tight" title={`${cCount} 条留言`}>
                <MessageSquare className="h-[9px] w-[9px]" strokeWidth={2.6} aria-hidden="true" />
                {cCount > 99 ? '99+' : cCount}
              </span>
            )}
          </p>
        </>
      )}
    </button>
  );
}

/** 便签详情弹层（卡面头像名字 + 正文大卡 + 便签下双向留言区（头像跟随全局） + 输入行；不限字数；自定义上传卡也在这里渲染） */

export function NoteDetail({
  note,
  meName,
  taName,
  meAvatar,
  taAvatar,
  cardCustoms,
  onClose,
  onSend,
}: {
  note: BoardNote;
  meName: string;
  taName: string;
  meAvatar: string | null;
  taAvatar: string | null;
  cardCustoms: BoardCardCustom[];
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState('');
  const send = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput('');
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label="便签详情">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
      <div className="relative flex max-h-[80%] w-full max-w-[320px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_44px_rgba(0,0,0,0.18)]">
        {/* v59 修复「长便签划不动」：正文 + 留言区放进同一个滚动区——此前正文块 shrink-0 不可滚，长文自己就撑满 80% 上限，留言区被压成 0、输入行被裁出屏外，整卡哪里都划不动；现在输入行固定底部，往上整体可滑 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* 便签正文（图案卡纸/自选色大卡 + 金属别针） */}
          <div className="px-4 pb-3 pt-5">
            <div
              className="relative rounded-xl px-4 py-5 pt-6 shadow-[0_4px_14px_rgba(0,0,0,0.15)]"
              style={noteFaceStyle(note, cardCustoms)}
            >
              {/* v44：自带胶带装饰的卡面（便签纸）不再叠金属别针 */}
              {!noteHasOwnDecor(note, cardCustoms) && <NoteClip />}
              {note.unlockAt && (
                <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/30 px-2 py-[2px] text-[9.5px] font-bold tracking-wide backdrop-blur-[1px]">
                  <LockOpen className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                  胶囊 · {fmtMDHM(note.unlockAt)} 已开启
                </p>
              )}
              {/* 谁钉的：头像 + 名字（跟随情侣空间全局头像） */}
              <span className="flex items-center gap-1.5">
                <BoardAvatar src={note.from === 'me' ? meAvatar : taAvatar} name={note.from === 'me' ? meName || '我' : taName || 'TA'} size={22} />
                <span className="text-[12px] font-bold opacity-80">{note.from === 'me' ? meName || '我' : taName || 'TA'}</span>
              </span>
              <p className="mt-1.5 break-all text-[15px] font-semibold leading-[1.7]">{note.text}</p>
              <p className="mt-3 text-right text-[11px] font-bold opacity-75">{fmtMDHM(note.at)}</p>
            </div>
          </div>
          {/* 留言区（便签下的双向留言；与正文同滚动区，置顶小标题滑到顶时吸顶） */}
          <div className="px-4 pb-2">
            <p className="sticky top-0 z-[1] bg-white pb-1.5 pt-0.5 text-[11px] font-bold text-[#a3a3a3]">
              便签下的留言 · {(note.comments ?? []).length}
            </p>
            {(note.comments ?? []).length === 0 && (
              <p className="py-5 text-center text-[12.5px] leading-relaxed text-[#b3b3b3]">还没有留言——给这张便签回一句话吧</p>
            )}
            {(note.comments ?? []).map((m) => {
              const mMine = m.from === 'me';
              const who = mMine ? meName || '我' : taName || 'TA';
              return (
                <div key={m.id} className="flex items-start gap-2 py-[6px]">
                  <BoardAvatar src={mMine ? meAvatar : taAvatar} name={who} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-semibold leading-tight text-[#a3a3a3]">
                      {who} · {fmtMDHM(m.at)}
                    </p>
                    <p className="mt-[1px] break-all text-[13.5px] leading-relaxed text-[#262626]">{m.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* 输入行 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-neutral-200 px-3 py-2.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="在便签下留一句话…（不限字数）"
            className="min-w-0 flex-1 rounded-full bg-neutral-100 px-3.5 py-2 text-[13.5px] text-[#262626] outline-none placeholder:text-[#b3b3b3]"
            aria-label="便签下留言输入"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim()}
            aria-label="发送留言"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white shadow-[0_3px_10px_rgba(0,0,0,0.25)] transition-transform active:scale-95 disabled:opacity-40"
          >
            <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 胶囊封存中弹层（大锁 + 倒计时 + 开启时间；内容谁也看不到） */

export function CapsulePending({ note, now, onClose }: { note: BoardNote; now: number; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label="时间胶囊">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-[320px] rounded-2xl border border-neutral-200 bg-white p-5 text-center shadow-[0_16px_44px_rgba(0,0,0,0.2)]">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          <Hourglass className="h-7 w-7" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <p className="mt-3 text-[15px] font-bold text-[#1a1a1a]">这颗时间胶囊还封存着</p>
        <p className="mt-1.5 text-[23px] font-extrabold tracking-wide text-black">{fmtCountdown((note.unlockAt ?? 0) - now)}</p>
        <p className="mt-1 text-[12px] font-semibold text-[#a3a3a3]">{fmtMDHM(note.unlockAt ?? 0)} · 到点自动开启</p>
        <p className="mt-3 rounded-xl bg-neutral-100 px-3 py-2.5 text-[11.5px] leading-relaxed text-[#a3a3a3]">
          写下它的那一刻就被封存了——到点之前谁都看不到，急不来也改不了。
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-full bg-black py-2.5 text-[13.5px] font-bold text-white active:opacity-70"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

/** 留言板页（简约留言墙 + 手写便签 + 时间胶囊彩蛋；替代许愿树） */

export function BoardPage({
  state,
  patch,
  close,
  showToast,
}: {
  state: CoupleState;
  patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  close: () => void;
  showToast: (m: string) => void;
}) {
  const notes = state.boardNotes ?? [];

  // 倒计时每 30s 刷新（胶囊到点自动变为已开启）
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  // 测量瀑布流实际宽度（图案卡‘多大就是多大’需要：按卡面原始宽高比算最小高度，横幅卡跨栏铺满）
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [colW, setColW] = useState(0); // 单栏卡宽
  const [fullW, setFullW] = useState(0); // 跨栏卡宽
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setFullW(w);
      setColW((w - 10) / 2); // columns-2 + gap-2.5(10px)
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- 弹层与草稿状态 ----
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState(0); // 素白卡的调色盘选中色
  const [draftCard, setDraftCard] = useState(0); // 卡纸样式（0=素白，1-7=图案卡）
  const [capsuleOn, setCapsuleOn] = useState(false); // 时间胶囊开关
  const [unlockChoice, setUnlockChoice] = useState(0); // 0-4 预设 / 5 自定义
  const [customUnlock, setCustomUnlock] = useState(''); // 'YYYY-MM-DDTHH:mm'
  const [openId, setOpenId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null); // 刚钉上墙的便签（落钉动画）
  const [bgPicker, setBgPicker] = useState(false); // 背景选择弹层
  // ---- 长按操作菜单 + 多选模式 ----
  const [menuId, setMenuId] = useState<string | null>(null); // 长按弹菜单的便签
  const [menuDel, setMenuDel] = useState(false); // 菜单里「删除」的二次确认态
  const [multi, setMulti] = useState(false); // 多选模式（点便签=勾选）
  const [picked, setPicked] = useState<string[]>([]); // 多选勾选中的便签 id
  const curBg = state.boardBg ?? 0; // 当前背景索引（0-5=内置，100+=手机上传的自定义）
  const customs = state.boardBgCustom ?? [];
  const cardCustoms = state.boardCardCustom ?? []; // 自定义上传的便签卡纸（card=100+下标）
  const openNote = notes.find((n) => n.id === openId) ?? null;
  const openLocked = !!(openNote?.unlockAt && openNote.unlockAt > now);
  const previewCol = NOTE_COLORS[draftColor % NOTE_COLORS.length]; // 书写区实时预览色

  // 墙上便签展示顺序：置顶的排最前（组内保持原「最新在前」顺序；稳定排序不乱跳）
  const shown = useMemo(() => [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), [notes]);
  const menuNote = notes.find((n) => n.id === menuId) ?? null; // 长按菜单对应便签
  const pickedNotes = notes.filter((n) => picked.includes(n.id));
  const allPinned = picked.length > 0 && pickedNotes.every((n) => n.pinned); // 所选是否全部已置顶（决定底栏按钮=取消置顶/置顶）

  /** 打开长按操作菜单（触屏按住 480ms / 桌面右键触发）；记录打开时刻——初期 ~350ms 内忽略遮罩点击，防个别浏览器长按抬手后仍合成的 click 秒关菜单 */
  const menuOpenedAt = useRef(0);
  const openMenu = (id: string) => {
    setMenuDel(false);
    setMenuId(id);
    menuOpenedAt.current = Date.now();
  };
  const closeMenu = () => {
    setMenuId(null);
    setMenuDel(false);
  };
  /** 菜单弹开后初期的点击一律忽略（长按抬手合成 click 兼容层；正常人手点遮罩不可能 <350ms） */
  const menuYoung = () => Date.now() - menuOpenedAt.current < 350;
  /** 退出多选模式 */
  const exitMulti = () => {
    setMulti(false);
    setPicked([]);
  };
  /** 多选模式里勾选/取消勾选一张 */
  const togglePick = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  /** 置顶/取消置顶一张（长按菜单） */
  const togglePinOne = (id: string) => {
    const n = notes.find((x) => x.id === id);
    const toPin = !n?.pinned;
    patch((prev) => ({
      boardNotes: (prev.boardNotes ?? []).map((x) => (x.id === id ? { ...x, pinned: toPin ? true : undefined } : x)),
    }));
    closeMenu();
    showToast(toPin ? '便签置顶了，钉在墙最前面 ♡' : '取消置顶');
  };
  /** 删除便签（连着便签下的留言一起删；单张/批量共用） */
  const deleteNotes = (ids: string[]) => {
    if (ids.length === 0) return;
    patch((prev) => ({
      boardNotes: (prev.boardNotes ?? []).filter((x) => !ids.includes(x.id)),
    }));
  };
  /** 多选批量置顶/取消置顶（全选中的都已置顶 → 取消置顶，否则置顶） */
  const pinPicked = () => {
    if (picked.length === 0) return;
    const toPin = !allPinned;
    patch((prev) => ({
      boardNotes: (prev.boardNotes ?? []).map((x) => (picked.includes(x.id) ? { ...x, pinned: toPin ? true : undefined } : x)),
    }));
    showToast(toPin ? `置顶了 ${picked.length} 张便签 ♡` : `取消了 ${picked.length} 张的置顶`);
    exitMulti();
  };
  /** 多选批量删除 */
  const deletePicked = () => {
    if (picked.length === 0) return;
    const cnt = picked.length;
    deleteNotes(picked);
    exitMulti();
    showToast(`取下了 ${cnt} 张便签`);
  };

  // 计划解锁时间（胶囊模式）：预设毫秒或自定义 datetime-local
  const customMs = customUnlock ? new Date(customUnlock).getTime() : 0;
  const plannedUnlock = !capsuleOn ? 0 : unlockChoice === 5 ? customMs : CAPSULE_PRESETS[unlockChoice].ms();
  const unlockOk = !capsuleOn || plannedUnlock > Date.now() + 60000; // 至少 1 分钟后

  const openCompose = (capsule: boolean) => {
    setCapsuleOn(capsule);
    setDraftCard(0); // 默认素白卡；想用图案再从卡纸里挑
    setDraftColor(7); // 素白卡默认云白
    setComposing(true);
  };
  const closeCompose = () => {
    setComposing(false);
    setDraft('');
    setCapsuleOn(false);
    setUnlockChoice(0);
    setCustomUnlock('');
  };

  /** 钉一张便签（普通 or 时间胶囊；不限字数；胶囊封存不上报内容，普通便签 TA 会来留言回应） */
  const pinNote = () => {
    const text = draft.trim();
    if (!text || !unlockOk) return;
    let unlockAt: number | undefined;
    if (capsuleOn && plannedUnlock) unlockAt = plannedUnlock;
    const id = `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    patch((prev) => ({
      boardNotes: [{ id, from: 'me' as const, text, at: Date.now(), comments: [], ...(draftCard > 0 ? { card: draftCard } : { color: draftColor }), ...(unlockAt ? { unlockAt } : {}) }, ...(prev.boardNotes ?? [])].slice(0, 60),
    }));
    closeCompose();
    setFlashId(id);
    window.setTimeout(() => setFlashId(null), 900);
    showToast(unlockAt ? '时间胶囊封存好啦，到点自动开启' : '便签钉上墙啦，TA 会看到 ♡');
    if (!unlockAt) scheduleBoardNoteReply(id);
  };

  /** 在便签下留言（不限字数；TA 会按人设/记忆/上下文接话回复；封存中的胶囊不出声） */
  const commentNote = (noteId: string, text: string) => {
    const c = { id: `me-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, from: 'me' as const, text, at: Date.now() };
    patch((prev) => ({
      boardNotes: (prev.boardNotes ?? []).map((x) => (x.id === noteId ? { ...x, comments: [...(x.comments ?? []), c] } : x)),
    }));
    const note = notes.find((n) => n.id === noteId);
    if (!(note?.unlockAt && note.unlockAt > Date.now())) scheduleBoardNoteReply(noteId);
  };

  /** 手机上传自定义卡纸：读文件 → 白底合成 + canvas 压到 720 宽 JPEG → 像素分析顶部避让 → 存进自定义卡纸（最多 4 张，满了挤掉最旧）并选中 */
  const uploadCardImg = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 720 / (img.naturalWidth || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) {
        showToast('这张图读不出来，换一张试试');
        return;
      }
      ctx.fillStyle = '#fff'; // 白底合成（透明 PNG 直接转 JPEG 会发黑）
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const src = cv.toDataURL('image/jpeg', 0.86);
      const padTop = detectCardPadTop(ctx, w, h); // 顶部有显著插画 → 文字避让比例
      patch((prev) => ({
        boardCardCustom: [...(prev.boardCardCustom ?? []), { src, ar: w / h, ...(padTop ? { padTop } : {}) }].slice(-4),
      }));
      setDraftCard(100 + Math.min(4, cardCustoms.length + 1) - 1); // 选中新传的那张（满 4 张时新卡在最末）
      showToast('卡纸传好啦 ♡');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('这张图读不出来，换一张试试');
    };
    img.src = url;
  };

  /** 删掉一张自定义卡纸：引用它的旧便签归素白，后面的自定义卡索引前移；选中态同步归位 */
  const delCustomCard = (i: number) => {
    patch((prev) => ({
      boardCardCustom: (prev.boardCardCustom ?? []).filter((_, k) => k !== i),
      boardNotes: (prev.boardNotes ?? []).map((n) => {
        const c = n.card ?? 0;
        if (c < 100) return n;
        const nc = c === 100 + i ? 0 : c > 100 + i ? c - 1 : c;
        return nc === c ? n : nc === 0 ? { ...n, card: undefined } : { ...n, card: nc };
      }),
    }));
    setDraftCard((c) => (c === 100 + i ? 0 : c > 100 + i ? c - 1 : c));
    showToast('自定义卡纸删掉了');
  };

  /** 手机上传背景：读文件 → canvas 压到 1080 宽 JPEG → 按中部亮度定纱罩 → 存进自定义背景（最多 4 张）并选中 */
  const uploadBg = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1080 / (img.naturalWidth || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (!ctx) {
        showToast('这张图读不出来，换一张试试');
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      // 中部采样平均亮度（便签覆盖区）→ 纱罩浓度，保证便签/文字可读
      let sum = 0;
      let cnt = 0;
      try {
        const d = ctx.getImageData(0, Math.floor(h * 0.3), w, Math.max(1, Math.floor(h * 0.45))).data;
        for (let i = 0; i < d.length; i += 244) {
          sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          cnt++;
        }
      } catch {
        /* 采样失败用中亮纱罩 */
      }
      const b = cnt ? sum / cnt : 200;
      const veil = b >= 230 ? 0.05 : b >= 195 ? 0.16 : b >= 160 ? 0.26 : 0.36;
      const src = cv.toDataURL('image/jpeg', 0.82);
      patch((prev) => {
        const arr = [...(prev.boardBgCustom ?? []), { src, veil }].slice(-4);
        return { boardBgCustom: arr, boardBg: 100 + arr.length - 1 };
      });
      showToast('背景传好啦 ♡');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('这张图读不出来，换一张试试');
    };
    img.src = url;
  };

  return (
    // 背景图直接铺满整个界面（顶部图标与右下角悬浮加号都浮在背景上）
    <div className="relative flex h-full flex-col overflow-hidden" style={wallStyleOf(state.boardBg, state.boardBgCustom)}>
      {/* ===== 顶部：返回键（裸图标） + 小标题 + 背景切换（裸图标·三个点；白色柔光保证任何背景上可见） ===== */}
      <div className="relative z-20 shrink-0">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[54px] z-30 flex h-10 w-10 items-center justify-center text-[#1a1a1a] transition-transform active:scale-90"
        >
          <ArrowLeft className="h-[23px] w-[23px] drop-shadow-[0_0_5px_rgba(255,255,255,0.95)]" strokeWidth={2.4} />
        </button>
        <p
          className="absolute left-1/2 top-[54px] flex h-10 -translate-x-1/2 items-center pl-[0.35em] text-[13px] font-semibold tracking-[0.35em] text-[#3c3c42]/75"
          style={{ textShadow: '0 1px 4px rgba(255,255,255,0.65)' }}
        >
          留言板
        </p>
        {/* 背景切换（右上角·三个点；与返回键对称） */}
        <button
          type="button"
          onClick={() => setBgPicker(true)}
          aria-label="选择背景"
          className="absolute right-3 top-[54px] z-30 flex h-10 w-10 items-center justify-center text-[#1a1a1a] transition-transform active:scale-90"
        >
          <MoreVertical className="h-[21px] w-[21px] drop-shadow-[0_0_5px_rgba(255,255,255,0.95)]" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      {/* ===== 多选模式顶部工具栏（盖在原头部同一位置：取消 + 已选 N 张 + 全选/全不选） ===== */}
      {multi && (
        <div className="absolute left-0 right-0 top-[54px] z-40 flex h-10 items-center justify-between px-3" role="toolbar" aria-label="便签多选">
          <button
            type="button"
            onClick={exitMulti}
            aria-label="退出多选"
            className="flex h-10 items-center pl-1 pr-2 text-[14px] font-semibold text-[#1a1a1a] transition-transform active:scale-90"
            style={{ textShadow: '0 1px 5px rgba(255,255,255,0.9)' }}
          >
            <X className="h-[19px] w-[19px] drop-shadow-[0_0_5px_rgba(255,255,255,0.95)]" strokeWidth={2.6} aria-hidden="true" />
            取消
          </button>
          <p className="text-[13px] font-bold text-[#1a1a1a]/85" style={{ textShadow: '0 1px 4px rgba(255,255,255,0.7)' }}>
            已选 {picked.length} 张
          </p>
          <button
            type="button"
            onClick={() => setPicked(picked.length > 0 && picked.length === shown.length ? [] : shown.map((n) => n.id))}
            disabled={shown.length === 0}
            className="flex h-10 items-center pl-2 pr-1 text-[13.5px] font-semibold text-[#1a1a1a] transition-transform active:scale-90 disabled:opacity-40"
            style={{ textShadow: '0 1px 5px rgba(255,255,255,0.9)' }}
          >
            {picked.length > 0 && picked.length === shown.length ? '全不选' : '全选'}
          </button>
        </div>
      )}

      {/* ===== 便签瀑布流（直接铺在整面背景上；两列，横幅图案卡跨栏铺满；置顶的排最前；底部留出悬浮加号的高度） ===== */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div ref={wallRef} className="columns-2 gap-2.5 px-3.5 pb-[120px] pt-[106px]">
          {shown.map((n) => (
            <BoardNoteCard
              key={n.id}
              note={n}
              now={now}
              flash={flashId === n.id}
              onClick={() => (multi ? togglePick(n.id) : setOpenId(n.id))}
              onLongPress={multi ? undefined : () => openMenu(n.id)}
              selecting={multi}
              selected={picked.includes(n.id)}
              meName={state.meName}
              taName={state.taName}
              meAvatar={state.meAvatar}
              taAvatar={state.taAvatar}
              cardCustoms={cardCustoms}
              colW={colW}
              fullW={fullW}
            />
          ))}
        </div>
        {/* 空墙提示 */}
        {notes.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-10 pb-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/70 text-neutral-500 backdrop-blur-sm">
              <Pin className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
            </span>
            <p className="text-[13.5px] font-bold text-[#3c3c42]">墙上还空着</p>
            <p className="text-[11.5px] leading-relaxed text-[#3c3c42]/55">钉下第一张手写便签，或者塞一颗慢一点的时间胶囊</p>
          </div>
        )}
      </div>

      {/* ===== 背景选择弹层（内置 6 张 + 手机上传的自定义背景（最多 4 张）+ 上传入口） ===== */}
      {bgPicker && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label="选择背景">
          <button type="button" aria-label="关闭" onClick={() => setBgPicker(false)} className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
          <div className="relative max-h-[82%] w-full max-w-[320px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_16px_44px_rgba(0,0,0,0.2)]">
            <p className="text-[15px] font-bold text-[#1a1a1a]">选择背景</p>
            <p className="mt-0.5 text-[12px] text-[#a3a3a3]">挑一张喜欢的图，或从手机上传</p>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {BOARD_BGS.map((b, i) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => {
                    patch({ boardBg: i });
                    setBgPicker(false);
                    showToast('背景换好啦 ♡');
                  }}
                  aria-label={b.label}
                  aria-pressed={curBg === i}
                  className="relative overflow-hidden rounded-xl transition-transform active:scale-95"
                >
                  {/* 缩略图：背景图 + 同款纱罩 */}
                  <span
                    className="block aspect-[3/4] w-full"
                    style={{ backgroundImage: `linear-gradient(rgba(250,247,240,${b.veil}),rgba(250,247,240,${b.veil})),url(/board-bg/bg-${i}.jpg)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  />
                  <span className={`absolute inset-0 rounded-xl ${curBg === i ? 'shadow-[inset_0_0_0_2px_#000]' : 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]'}`} aria-hidden="true" />
                  {curBg === i && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white shadow">
                      <Check className="h-3 w-3" strokeWidth={3.2} aria-hidden="true" />
                    </span>
                  )}
                  <span className="block pb-1 pt-1.5 text-center text-[11px] font-bold text-[#3c3c42]">{b.label}</span>
                </button>
              ))}
              {/* 手机上传的自定义背景 */}
              {customs.map((c, i) => (
                <button
                  key={'custom-' + i}
                  type="button"
                  onClick={() => {
                    patch({ boardBg: 100 + i });
                    setBgPicker(false);
                    showToast('背景换好啦 ♡');
                  }}
                  aria-label={'上传背景' + (i + 1)}
                  aria-pressed={curBg === 100 + i}
                  className="relative overflow-hidden rounded-xl transition-transform active:scale-95"
                >
                  <span
                    className="block aspect-[3/4] w-full"
                    style={{ backgroundImage: `linear-gradient(rgba(250,247,240,${c.veil}),rgba(250,247,240,${c.veil})),url("${c.src}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  />
                  <span className={`absolute inset-0 rounded-xl ${curBg === 100 + i ? 'shadow-[inset_0_0_0_2px_#000]' : 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]'}`} aria-hidden="true" />
                  {curBg === 100 + i && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white shadow">
                      <Check className="h-3 w-3" strokeWidth={3.2} aria-hidden="true" />
                    </span>
                  )}
                  <span className="block pb-1 pt-1.5 text-center text-[11px] font-bold text-[#3c3c42]">上传{['一', '二', '三', '四'][i] ?? i + 1}</span>
                </button>
              ))}
              {/* 从手机上传（最多存 4 张） */}
              <label className="relative block cursor-pointer overflow-hidden rounded-xl border border-dashed border-neutral-300 transition-transform active:scale-95" aria-label="从手机上传背景">
                <span className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 bg-neutral-50 text-neutral-400">
                  <Plus className="h-7 w-7" strokeWidth={2.2} aria-hidden="true" />
                  <span className="text-[11px] font-bold">手机上传</span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="上传背景图"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) uploadBg(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ===== 右下角悬浮加号（钉一张便签；浅灰色融入墙面；时间胶囊在弹层里设；多选模式下隐藏） ===== */}
      {!multi && (
        <button
          type="button"
          onClick={() => openCompose(false)}
          aria-label="钉一张便签"
          className="absolute bottom-[44px] right-4 z-30 flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#ececec] text-[#8a8a8a] shadow-[0_6px_18px_rgba(0,0,0,0.22)] ring-1 ring-black/10 transition-transform active:scale-90"
        >
          <Plus className="h-[26px] w-[26px]" strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}

      {/* ===== 多选模式底部操作栏（置顶所选 / 删除所选；未选中时置灰） ===== */}
      {multi && (
        <div className="absolute inset-x-3 bottom-[44px] z-40 flex items-stretch overflow-hidden rounded-2xl bg-white/95 shadow-[0_10px_30px_rgba(0,0,0,0.25)] ring-1 ring-black/5 backdrop-blur-md" role="toolbar" aria-label="便签批量操作">
          <button
            type="button"
            onClick={pinPicked}
            disabled={picked.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 py-3.5 text-[14px] font-bold text-[#1a1a1a] transition-opacity active:bg-black/5 disabled:opacity-35"
          >
            <Pin className="h-[15px] w-[15px]" strokeWidth={2.6} aria-hidden="true" />
            {allPinned ? `取消置顶${picked.length > 1 ? ` ${picked.length} 张` : ''}` : `置顶${picked.length > 1 ? ` ${picked.length} 张` : ''}`}
          </button>
          <span className="my-2 w-px bg-black/10" aria-hidden="true" />
          <button
            type="button"
            onClick={deletePicked}
            disabled={picked.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 py-3.5 text-[14px] font-bold text-[#d93025] transition-opacity active:bg-red-50 disabled:opacity-35"
          >
            <Trash2 className="h-[15px] w-[15px]" strokeWidth={2.6} aria-hidden="true" />
            删除{picked.length > 1 ? ` ${picked.length} 张` : ''}
          </button>
        </div>
      )}

      {/* ===== 长按操作菜单（iOS 风格底部动作面板：置顶/多选/删除（删除带二次确认）） ===== */}
      {menuNote && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-end px-3 pb-4" role="dialog" aria-label="便签操作">
          <button type="button" aria-label="关闭菜单" onClick={() => { if (!menuYoung()) closeMenu(); }} className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-[320px] overflow-hidden rounded-2xl bg-white shadow-[0_16px_44px_rgba(0,0,0,0.22)]">
            {/* 便签预览（菜单顶部一行摘要；封存中的胶囊只说是一颗胶囊） */}
            <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
              {menuNote.unlockAt && menuNote.unlockAt > now ? (
                <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-[#a3a3a3]">一颗封存中的时间胶囊 · {fmtCountdown(menuNote.unlockAt - now)}开启</p>
              ) : (
                <p className="line-clamp-2 min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-[#262626]">{menuNote.text}</p>
              )}
            </div>
            {menuDel ? (
              /* 删除二次确认 */
              <div role="alertdialog" aria-label="确认删除">
                <p className="px-4 py-4 text-center text-[13px] leading-relaxed text-[#52525b]">
                  删除后便签和下面的留言都没有了
                  <br />
                  <span className="text-[12px] text-[#a3a3a3]">确定取下这张便签吗？</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    deleteNotes([menuNote.id]);
                    closeMenu();
                    showToast('便签取下来了');
                  }}
                  className="w-full border-t border-black/5 py-3.5 text-[15px] font-bold text-[#d93025] transition-colors active:bg-red-50"
                >
                  删除
                </button>
                <button type="button" onClick={() => setMenuDel(false)} className="w-full border-t border-black/5 py-3.5 text-[15px] font-semibold text-[#3c3c42] transition-colors active:bg-black/5">
                  再想想
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => togglePinOne(menuNote.id)}
                  className="flex w-full items-center justify-center gap-2 border-b border-black/5 py-3.5 text-[15px] font-semibold text-[#3c3c42] transition-colors active:bg-black/5"
                >
                  <Pin className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                  {menuNote.pinned ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = menuNote.id;
                    closeMenu();
                    setMulti(true);
                    setPicked([id]); // 进入多选时先勾上长按的这张（微信同款交互）
                  }}
                  className="flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-semibold text-[#3c3c42] transition-colors active:bg-black/5"
                >
                  <Check className="h-4 w-4" strokeWidth={2.8} aria-hidden="true" />
                  多选
                </button>
                <button
                  type="button"
                  onClick={() => setMenuDel(true)}
                  className="flex w-full items-center justify-center gap-2 border-t border-black/5 py-3.5 text-[15px] font-semibold text-[#d93025] transition-colors active:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                  删除
                </button>
              </>
            )}
          </div>
          {/* 取消（独立卡片，iOS 动作面板惯例） */}
          <button type="button" onClick={closeMenu} className="relative mt-2 w-full max-w-[320px] rounded-2xl bg-white py-3.5 text-[15.5px] font-bold text-[#3c3c42] shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition-colors active:bg-neutral-100">
            取消
          </button>
        </div>
      )}

      {/* ===== 钉便签/塞胶囊弹层（书写 + 卡纸选择 + 调色盘 + 胶囊开关 + 解锁时间） ===== */}
      {composing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center px-6" role="dialog" aria-label={capsuleOn ? '塞一颗时间胶囊' : '钉一张便签'}>
          <button type="button" aria-label="取消" onClick={closeCompose} className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
          <div className="relative max-h-[86%] w-full max-w-[320px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_16px_44px_rgba(0,0,0,0.2)]">
            <p className="text-[15px] font-bold text-[#1a1a1a]">{capsuleOn ? '塞一颗时间胶囊' : '钉一张便签'}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[#a3a3a3]">
              {capsuleOn ? '写下的那一刻就被封存——到点之前，连你自己也看不到。' : '随手写一句想说的，钉在你们的留言墙上——TA 会看到。'}
            </p>
            {/* 书写区（随卡纸/颜色实时变化；胶囊模式为浅灰封存卡；自定义上传卡按原始宽高比给最小高度） */}
            <div
              className="relative mt-3 rounded-xl px-4 py-4 pt-5 shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
              style={
                capsuleOn
                  ? { background: 'linear-gradient(180deg,#ececec,#e6e6e6)', color: '#52525b', border: '1.5px dashed #a8a8a8' }
                  : draftCard >= 100
                    ? {
                        backgroundImage: `url("${cardCustoms[draftCard - 100]?.src ?? ''}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        color: '#3a3a3a',
                        ...(cardCustoms[draftCard - 100] ? { minHeight: Math.round(280 / cardCustoms[draftCard - 100].ar), ...(cardCustoms[draftCard - 100].padTop ? { paddingTop: Math.round((280 / cardCustoms[draftCard - 100].ar) * cardCustoms[draftCard - 100].padTop!) } : {}) } : {}),
                      }
                    : draftCard > 0
                      ? {
                          backgroundImage: `url(/board-cards/${BOARD_CARDS[draftCard - 1].file})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          color: BOARD_CARDS[draftCard - 1].text,
                          // v44：便签纸卡自带顶部胶带 → 预览写字区下移避让（约 36px 对应卡面顶部 13%）
                          // v45：带顶部插画的内置卡（手绘涂鸦 padTop 0.32）按比例给预览避让，与墙面渲染同口径
                          ...(BOARD_CARDS[draftCard - 1].noPin
                            ? { paddingTop: 36 }
                            : BOARD_CARDS[draftCard - 1].padTop
                              ? { paddingTop: Math.round((280 / BOARD_CARDS[draftCard - 1].ar) * BOARD_CARDS[draftCard - 1].padTop!) }
                              : {}),
                        }
                      : { background: previewCol.bg, color: previewCol.text }
              }
            >
              {/* v44：便签纸卡自带胶带 → 预览不叠金属别针；内置卡 padTop 避让顶部装饰 */}
              {!(draftCard >= 1 && draftCard <= BOARD_CARDS.length && BOARD_CARDS[draftCard - 1].noPin) && <NoteClip />}
              {capsuleOn && (
                <span className="mb-1.5 inline-flex items-center gap-1 text-[10.5px] font-bold tracking-wide opacity-80">
                  <Lock className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
                  封存后锁着倒计时贴在墙上
                </span>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder={capsuleOn ? '写给未来的你们的一句话…' : '如：今天的晚霞很好看，想你。（不限字数）'}
                className="w-full resize-none bg-transparent text-[15px] font-semibold leading-[1.7] outline-none placeholder:font-normal placeholder:opacity-60"
                aria-label="便签内容"
              />
            </div>
            {/* 卡纸选择（素白 + 内置图案卡（v45：样式一/样式五/便签纸 + 用户参考图 5 张：手绘涂鸦/水彩蝴蝶/蕾丝乐谱/枝头双兔/朦胧少女） + 手机上传的自定义卡（最多 4 张，可删） + 上传入口） */}
            <div className="mt-3">
              <p className="text-[11.5px] font-bold text-[#a3a3a3]">
                {capsuleOn ? '开启后的便签卡纸' : '选卡纸'}
                <span className="ml-1 text-[#52525b]">· {draftCard >= 100 ? `自定义卡${draftCard - 99}` : draftCard > 0 ? BOARD_CARDS[draftCard - 1].label : '素白'}</span>
              </p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDraftCard(0)}
                  aria-label="素白"
                  aria-pressed={draftCard === 0}
                  className="relative overflow-hidden rounded-lg transition-transform active:scale-90"
                >
                  <span className="block aspect-[3/4] w-full rounded-lg bg-[#faf8f2] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]" />
                  {draftCard === 0 && <span className="absolute inset-0 rounded-lg shadow-[inset_0_0_0_2px_#000]" aria-hidden="true" />}
                  {draftCard === 0 && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden="true" />
                    </span>
                  )}
                </button>
                {BOARD_CARDS.map((c, i) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setDraftCard(i + 1)}
                    aria-label={c.label}
                    aria-pressed={draftCard === i + 1}
                    className="relative overflow-hidden rounded-lg transition-transform active:scale-90"
                  >
                    <span
                      className="block aspect-[3/4] w-full rounded-lg"
                      style={{ backgroundImage: `url(/board-cards/${c.file})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    />
                    <span className={`absolute inset-0 rounded-lg ${draftCard === i + 1 ? 'shadow-[inset_0_0_0_2px_#000]' : 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]'}`} aria-hidden="true" />
                    {draftCard === i + 1 && (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-white">
                        <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                ))}
                {/* 手机上传的自定义卡纸（最多 4 张；左上角 × 删除） */}
                {cardCustoms.map((c, i) => (
                  <div key={'ccard-' + i} className="relative">
                    <button
                      type="button"
                      onClick={() => setDraftCard(100 + i)}
                      aria-label={`自定义卡${i + 1}`}
                      aria-pressed={draftCard === 100 + i}
                      className="relative block w-full overflow-hidden rounded-lg transition-transform active:scale-90"
                    >
                      <span
                        className="block aspect-[3/4] w-full rounded-lg"
                        style={{ backgroundImage: `url("${c.src}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                      />
                      <span className={`absolute inset-0 rounded-lg ${draftCard === 100 + i ? 'shadow-[inset_0_0_0_2px_#000]' : 'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]'}`} aria-hidden="true" />
                      {draftCard === 100 + i && (
                        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black text-white">
                          <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden="true" />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => delCustomCard(i)}
                      aria-label={`删除自定义卡${i + 1}`}
                      className="absolute -left-1 -top-1 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-neutral-500 shadow-[0_1px_5px_rgba(0,0,0,0.3)] transition-transform active:scale-90"
                    >
                      <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {/* 上传自定义卡纸（最多存 4 张，满了挤掉最旧） */}
                <label className="relative block cursor-pointer overflow-hidden rounded-lg border border-dashed border-neutral-300 transition-transform active:scale-90" aria-label="上传自定义卡纸">
                  <span className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 bg-neutral-50 text-neutral-400">
                    <Plus className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
                    <span className="text-[9.5px] font-bold leading-none">上传</span>
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="上传卡纸图"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f) uploadCardImg(f);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            {/* 调色盘（素白卡时才可选颜色；16 色两行八列） */}
            {draftCard === 0 && (
              <div className="mt-3">
                <p className="text-[11.5px] font-bold text-[#a3a3a3]">
                  {capsuleOn ? '开启后的便签颜色' : '选颜色'}
                  <span className="ml-1 text-[#52525b]">· {NOTE_COLORS[draftColor % NOTE_COLORS.length].name}</span>
                </p>
                <div className="mt-2 grid grid-cols-8 gap-1.5">
                  {NOTE_COLORS.map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setDraftColor(i)}
                      aria-label={c.name}
                      aria-pressed={draftColor === i}
                      className={`flex aspect-square w-full items-center justify-center rounded-full transition-transform active:scale-90 ${
                        draftColor === i ? 'scale-110 shadow-[0_0_0_2px_#fff,0_0_0_3.5px_#1a1a1a]' : 'shadow-[0_1px_4px_rgba(0,0,0,0.15)]'
                      }`}
                      style={{ background: c.swatch }}
                    >
                      {draftColor === i && <Check className="h-3.5 w-3.5" strokeWidth={3.2} style={{ color: c.text }} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* 时间胶囊开关 */}
            <button
              type="button"
              onClick={() => setCapsuleOn((v) => !v)}
              aria-pressed={capsuleOn}
              aria-label="设为时间胶囊"
              className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-left active:opacity-70"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${capsuleOn ? 'bg-black text-white' : 'bg-neutral-200 text-neutral-500'}`}>
                <Hourglass className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-[#1a1a1a]">设为时间胶囊</span>
                <span className="mt-[1px] block text-[10.5px] leading-tight text-[#a3a3a3]">到点自动开启，期间谁都看不到</span>
              </span>
              <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${capsuleOn ? 'bg-black' : 'bg-neutral-300'}`}>
                <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${capsuleOn ? 'left-[21px]' : 'left-[3px]'}`} />
              </span>
            </button>
            {/* 解锁时间选择（胶囊模式） */}
            {capsuleOn && (
              <div className="mt-2.5">
                <p className="text-[11.5px] font-bold text-[#a3a3a3]">什么时候开启</p>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {CAPSULE_PRESETS.map((p, i) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setUnlockChoice(i)}
                      aria-pressed={unlockChoice === i}
                      className={`rounded-xl border px-2 py-2 text-center transition-transform active:scale-95 ${
                        unlockChoice === i ? 'border-black bg-neutral-100 text-black' : 'border-neutral-200 bg-neutral-50 text-[#52525b]'
                      }`}
                    >
                      <span className="block text-[12.5px] font-bold">{p.label}</span>
                      <span className="mt-[1px] block text-[9.5px] leading-tight opacity-75">{p.hint}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUnlockChoice(5)}
                    aria-pressed={unlockChoice === 5}
                    className={`rounded-xl border px-2 py-2 text-center transition-transform active:scale-95 ${
                      unlockChoice === 5 ? 'border-black bg-neutral-100 text-black' : 'border-neutral-200 bg-neutral-50 text-[#52525b]'
                    }`}
                  >
                    <span className="block text-[12.5px] font-bold">自定义</span>
                    <span className="mt-[1px] block text-[9.5px] leading-tight opacity-75">有意义的日子</span>
                  </button>
                </div>
                {unlockChoice === 5 && (
                  <input
                    type="datetime-local"
                    value={customUnlock}
                    min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)}
                    onChange={(e) => setCustomUnlock(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[13px] text-[#262626] outline-none"
                    aria-label="自定义开启时间"
                  />
                )}
                {capsuleOn && !unlockOk && <p className="mt-1.5 text-[11px] font-semibold text-black">开启时间至少要在 1 分钟之后</p>}
                {capsuleOn && unlockOk && plannedUnlock > 0 && (
                  <p className="mt-1.5 text-[11px] font-semibold text-[#52525b]">
                    将于 {fmtMDHM(plannedUnlock)} 开启 · {fmtCountdown(plannedUnlock - Date.now())}
                  </p>
                )}
              </div>
            )}
            {/* 操作按钮 */}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeCompose}
                className="rounded-full px-4 py-2 text-[13.5px] font-bold text-[#a3a3a3] active:opacity-60"
              >
                先不钉了
              </button>
              <button
                type="button"
                onClick={pinNote}
                disabled={!draft.trim() || !unlockOk}
                className="rounded-full bg-black px-5 py-2 text-[13.5px] font-bold text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)] transition-transform active:scale-95 disabled:opacity-40"
              >
                {capsuleOn ? '封存起来 ♡' : '钉上留言墙 ♡'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 详情/胶囊弹层 ===== */}
      {openNote &&
        (openLocked ? (
          <CapsulePending note={openNote} now={now} onClose={() => setOpenId(null)} />
        ) : (
          <NoteDetail
            note={openNote}
            meName={state.meName}
            taName={state.taName}
            meAvatar={state.meAvatar}
            taAvatar={state.taAvatar}
            cardCustoms={cardCustoms}
            onClose={() => setOpenId(null)}
            onSend={(t) => commentNote(openNote.id, t)}
          />
        ))}
    </div>
  );
}

export const CAPSULE_PRESETS: { label: string; hint: string; ms: () => number }[] = [
  {
    label: '明早 8 点',
    hint: '睡一觉醒来开启',
    ms: () => {
      const d = new Date();
      d.setHours(8, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d.getTime();
    },
  },
  { label: '3 天后', hint: '小小的一颗期待', ms: () => Date.now() + 3 * 86400000 },
  { label: '7 天后', hint: '一周后的惊喜', ms: () => Date.now() + 7 * 86400000 },
  { label: '30 天后', hint: '一个月后的礼物', ms: () => Date.now() + 30 * 86400000 },
  { label: '1 年后', hint: '跨过四季再相见', ms: () => Date.now() + 365 * 86400000 },
];

/** 封存倒计时文本（天/时/分） */

export const BOARD_BGS: { label: string; veil: number }[] = [
  { label: '雾青', veil: 0.22 }, // bg-0：用户上传的第一张图（中部亮 182、左下亮右上传暗）
  { label: '素灰', veil: 0.2 }, // bg-1：亮灰调（亮度 197）
  { label: '黛灰', veil: 0.26 }, // bg-2：中灰调（亮度 172）
  { label: '雾蓝', veil: 0.34 }, // bg-3：淡蓝调（亮度 153）
  { label: '云白', veil: 0.04 }, // bg-4：极亮白（亮度 251）
  { label: '暖褐', veil: 0.38 }, // bg-5：暖棕调（亮度 142）
];

/** 留言墙实际样式（背景图 cover 铺满整个界面 + 暖白纱罩统一可读性；100+=手机上传的自定义背景） */


// ---------------- 情侣轨迹：真实地图（高德瓦片代理 + WGS84→GCJ02 纠偏 + 真实距离） ----------------

export const GCJ_A = 6378245;

export const GCJ_EE = 0.00669342162296594323;


export function gcjTransformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}


export function gcjTransformLng(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

/** WGS84 → GCJ02（高德瓦片按 GCJ02 索引，marker 必须纠偏后才能落在正确位置；境外点原样返回） */

export function wgs84ToGcj02(lat: number, lng: number): [number, number] {
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

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}


export function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}


export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 真实地图（情侣轨迹专用）：高德街道瓦片经 /api/map-tile 代理渲染，可拖动/滚轮/双指缩放；
 *  双方真实位置头像 marker + 相遇地点 📍 + 虚线连线与真实距离标签 */

export function RealCoupleMap(props: {
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

export function PlaceSearchRow({ label, current, onPick, onClear, showToast }: { label: string; current: CouplePlace | null; onPick: (p: CouplePlace) => void; onClear: () => void; showToast: (m: string) => void }) {
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

export const TRAIL_FEED_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
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

export const TRAIL_KIND_LABEL: Record<string, string> = {
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

export function TrackPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
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
