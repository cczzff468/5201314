'use client';

/** 情侣空间纪念日与信件域（第十八轮 #8 拆分）：纪念日页 + 恋爱考卷 + 信纸全家桶（信纸/鸽子/鱼/星星/夜空信封）+ 慢递信 + AI 日记心情页。 */

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

export const ANNIV_PRESETS: { key: string; label: string; icon: React.ReactNode; mode: 'since' | 'next' }[] = [
  { key: 'myBd', label: '我的生日', icon: <Cake className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'taBd', label: 'TA的生日', icon: <Gift className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'kiss', label: '第一次接吻的日子', icon: <Heart className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'hug', label: '第一次拥抱的日子', icon: <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'travel', label: '第一次携手旅行的日子', icon: <Plane className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'wedding', label: '结婚纪念日', icon: <Landmark className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
];


export function AnniversaryPage(props: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; close: () => void; showToast: (m: string) => void }) {
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

/**
 * ================= 留言板（简约留言墙 + 手写便签 + 时间胶囊彩蛋） =================
 * 按需求以「留言板为主 + 时间胶囊彩蛋」重建（替代许愿树）：
 * - 一面简约留言墙：两人随手钉便签（16 色调色盘自选颜色），点开可回一句，成小对话串；
 * - 时间胶囊：写下即封存（到点前连自己也看不到），锁着倒计时钉在墙上，到点自动开启；
 * - 数据契约：boardNotes（最新在前，最多 60 张）+ boardNoteDay（TA 钉便签去重）；
 *   旧许愿树 treeCards 由 loadCoupleState 一次性迁移为第一批便签；
 * - AI（TA）自主钉便签（couple-ai.ts 'boardnote' 行为）与便签下留言回复全链路保留。
 */

/** 便签调色盘与图案卡纸清单已迁至 @/lib/ios/couple-board-cards（与 couple-ai TA 选卡共用唯一清单） */

/** 便签显示色（旧数据无 color：默认云白，兼容历史数据） */

export function QuizHeartLine({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-2 ${className}`}>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,#f3b7c6)]" />
      <Heart className="h-3.5 w-3.5 text-[#f8a8bc]" fill="#f8a8bc" strokeWidth={0} />
      <span className="h-px flex-1 bg-[linear-gradient(90deg,#f3b7c6,transparent)]" />
    </div>
  );
}

export const QUIZ_POOL = [
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


export function QuizPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
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

export function isCustomIndex(i: number, customLen: number) {
  return i < customLen;
}

/** 信纸样式（编辑器可切换） */

export interface LetterPaper {
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

export const LETTER_PAPERS: LetterPaper[] = [
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

export const LETTER_FONTS = [
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

export const LETTER_FONT_LINKS = [
  '/fonts/mashanzheng/font.css',
  '/fonts/zhimangxing/font.css',
  '/fonts/liujianmaocao/font.css',
  '/fonts/longcang/font.css',
  '/fonts/zcoolxiaowei/font.css',
  '/fonts/zcoolkuaile/font.css',
  '/fonts/zcoolhuangyou/font.css',
];

/** 确保自托管字体 CSS 已注入页面（幂等；情书页挂载时调用） */

export const LETTER_COLORS = ['#4a4238', '#8a8a94', '#a13a52', '#b8860b', '#3f6b4f', '#4a5a7a', '#8a5a2e', '#5f3d8a'];

/** 衔纸信鸽 SVG（参考「A Winged Word」信纸图左上角线稿鸽：白鸽衔信） */

export function ensureLetterFontLinks() {
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

export function PaperDove() {
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

export function PaperFish() {
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

export function PaperDeco({ p }: { p: LetterPaper }) {
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

export function LetterStars({ count = 44 }: { count?: number }) {
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

export function NightEnvelope() {
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

export function OrderIcon({ className = '' }: { className?: string }) {
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

export const LETTER_PAGE_CHARS = 300; // 每页信纸字数上限（写满翻下一页；第二十八轮起每页信纸同高同容量：480px · 300 字）

export const LETTER_PAGE_HEIGHT = 480; // 每页信纸统一高度（第二十八轮：第一页与后续页一样大）

export const LETTER_MAX_PAGES = 6; // 最多页数


export function LettersPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
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

export function MoodPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
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
