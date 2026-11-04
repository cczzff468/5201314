'use client';

/**
 * 音乐 App 播放页（仿网易云黑胶）：
 * - 封面模糊背景 + 黑胶唱片（旋转动画；仿用户参考图：细密纹路/外缘光环/大封面占比；
 *   白色轴承与针杆均已整体删除、盘面斜向高光已移除（泛白块根因），第三十二轮）
 * - 封面区点击切换歌词视图（LRC 滚动 + 翻译，当前行高亮自动居中；胶囊仅手动滚动浏览时
 *   显示且跟随滚动位置——滚到哪句亮哪句，第三十一轮；点歌词以外的任何位置回唱片）
 * - 进度条拖拽 / 循环模式 / 播放暂停 / 上下首 / 播放列表
 * - 右上角更多：仿网易云歌曲面板（为TA心动/收藏/下载/分享/一起听/评论/相似漫游/音质）
 * - 一起听态：顶部双头像 + 累计时长（跨会话永久保存） + 音乐/聊天胶囊切换
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlarmClock,
  ChevronDown,
  ClipboardList,
  Disc2,
  DiscAlbum,
  Disc3,
  Download,
  FolderPlus,
  Forward,
  Heart,
  ImageUp,
  ImageIcon,
  Info,
  ListMusic,
  Loader2,
  LogOut,
  MessageCircle,
  MessageCircleMore,
  MicVocal,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  SendHorizonal,
  Shuffle,
  SlidersHorizontal,
  ShoppingCart,
  Check,
  ChevronLeft,
  ChevronRight,
  Gift,
  SkipBack,
  SkipForward,
  TriangleAlert,
  UserRound,
  UserRoundPlus,
  UserRoundSearch,
  X,
} from 'lucide-react';
import {
  artistSub,
  artistSublist,
  commentsOf,
  simiSong,
  songArtistText,
  songCover,
  type NcmSong,
} from '@/lib/ios/music-api';
import {
  useMusic,
  getGuestAvatar,
  QUALITY_LABELS,
  QUALITY_ORDER,
  type QualityLevel,
  type RepeatMode,
  type PlayerStyle,
  type TogetherSessionLike,
  type TogetherMsgLike,
} from '@/lib/ios/music-store';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { memAddEventFragment } from '@/lib/memory';
import {
  fmtTogetherDur,
  listTogetherCandidates,
  sendTogetherText,
  setTogetherDistance,
  startTogether,
  stopTogether,
  togetherRecommend,
  useTogetherLive,
} from '@/lib/ios/music-ai';
import { lastChatAppOf, sendUserTogetherInvite } from '@/lib/ios/together-flow';
import type { ContactRecord } from '@/lib/contacts';
import { MINI_MODE_LABELS, useMiniPlayer } from '@/components/ios/MusicGlobalMini';
import { AddToSongSheet, CoverImg, fmtClock } from './music-shared';
import { TogetherChat, TogetherChatInput } from './music-together';
// v59：音质行 VIP 小胶囊换「我的」页同款黑胶唱片胶囊（用户要求全 App 统一）
import { VipBadge } from './music-vip-badge';

// ---------------- 底部控制键自绘图标（第三十五轮，按用户参考截图美化） ----------------

/** 播放模式名（第三十七轮：切换时浮层提示用，让每次点击都有明确反馈） */
const MODE_LABELS: Record<RepeatMode, string> = {
  order: '顺序播放',
  repeat: '列表循环',
  one: '单曲循环',
  shuffle: '随机播放',
};

/** 循环圆环箭头（one=true 圆心带「1」= 单曲循环）：圆环右上留缺口 + 顺时针箭头，仿参考截图。
 *  第三十八轮再美化：线宽加粗到 2（更饱满）、箭头加大更醒目、单曲「1」字号加大，
 *  缺口收紧让弧尾与箭头几乎衔接成完整圆环 */
function LoopArrowIcon({ one = false, className }: { one?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      {/* 圆环弧：从右上缺口处顺时针画一整圈到顶部偏左，缺口由实心箭头补上形成连续循环感 */}
      <path
        d="M16.93 6 A8 8 0 1 1 13.11 4.38"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* 箭头（实心小三角，指向顺时针切线方向，与弧尾同向衔接） */}
      <polygon points="16.9,4.75 12.55,6.55 13.2,1.85" fill="currentColor" />
      {one && (
        <text
          x="12"
          y="15.8"
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          1
        </text>
      )}
    </svg>
  );
}

/** 顺序播放专属图标（第三十七轮新增）：此前「顺序播放」和「列表循环」共用同一枚圆环箭头、
 *  只差颜色（白/红），点一下看不出变了——用户反馈「为什么需要点两下才能变成循环」的根因。
 *  顺序播放改为独立的向右箭头，四种模式四种图形，一眼可辨 */
function OrderPlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M4 12 H17.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <polygon points="17,8.4 21.4,12 17,15.6" fill="currentColor" />
    </svg>
  );
}

/** 暂停：两条圆角竖条（无外圈，仿参考截图） */
function PauseBarsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <rect x="5.4" y="3.4" width="5.4" height="17.2" rx="2.7" />
      <rect x="13.2" y="3.4" width="5.4" height="17.2" rx="2.7" />
    </svg>
  );
}

/** 播放：大圆角三角（描边圆角技巧，无外圈，仿参考截图） */
function PlayTriIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M8.9 6.6 L17.2 12 L8.9 17.4 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 播放列表：三角 + 三横线（仿参考截图队列图标） */
function QueueListIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4.6 5.2 L10.6 8 L4.6 10.8 Z" fill="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M13.9 8 H20.4" />
      <path d="M4.6 14 H20.4" />
      <path d="M4.6 18.6 H16.4" />
    </svg>
  );
}

export function MusicPlayer() {
  const close = useMusic((s) => s.closePlayer);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const buffering = useMusic((s) => s.buffering);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const mode = useMusic((s) => s.mode);
  const playError = useMusic((s) => s.playError);
  const freeTrial = useMusic((s) => s.freeTrial);
  const together = useMusic((s) => s.together);
  const togetherMsgs = useMusic((s) => s.togetherMsgs);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const likedIds = useMusic((s) => s.likedIds);
  const toggleLike = useMusic((s) => s.toggleLike);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const seek = useMusic((s) => s.seek);
  const setMode = useMusic((s) => s.setMode);
  const openComments = useMusic((s) => s.openComments);
  const loadLyric = useMusic((s) => s.loadLyric);

  const [showLyric, setShowLyric] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // 一起听设置菜单（重新匹配/查看记录/匹配偏好/举报/退出一起听）——顶栏⋮入口
  const [showTgMenu, setShowTgMenu] = useState(false);
  // 音乐界面底部快聊输入条（点信息图标弹出，可直接打字发送，不切聊天视图）
  const [showQuickInput, setShowQuickInput] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [showTgRecord, setShowTgRecord] = useState(false);
  // 重新匹配入口打开时，邀请面板标题切换
  const [inviteTitle, setInviteTitle] = useState('邀请一起听');
  // 一起听进入时默认显示音乐界面；用户手动切换后以手动值为准（chatOverride=null 表示跟随默认）
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const showChat = chatOverride ?? false;
  // 新会话开始/换人时回到默认（音乐界面）——render 期派生重置（React 官方 adjust-state 模式）
  const tgKey = together ? `${together.contactId}:${together.since}` : '';
  const [prevTgKey, setPrevTgKey] = useState(tgKey);
  if (tgKey !== prevTgKey) {
    setPrevTgKey(tgKey);
    if (chatOverride !== null) setChatOverride(null);
  }
  const [moreToast, setMoreToast] = useState('');
  // 播放模式浮层提示（第三十七轮）：切换时报出模式名，1.4 秒后淡出
  const [modeTip, setModeTip] = useState('');
  const modeTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleMode = () => {
    const order: RepeatMode[] = ['order', 'repeat', 'one', 'shuffle'];
    const nm = order[(order.indexOf(mode) + 1) % order.length];
    setMode(nm);
    setModeTip(MODE_LABELS[nm]);
    if (modeTipTimer.current) clearTimeout(modeTipTimer.current);
    modeTipTimer.current = setTimeout(() => setModeTip(''), 1400);
  };
  // 提示 3 秒自动消失（第十五轮反馈；此前会一直停留在屏幕上）
  useEffect(() => {
    if (!moreToast) return;
    const t = setTimeout(() => setMoreToast(''), 3000);
    return () => clearTimeout(t);
  }, [moreToast]);
  // 播放器自定义背景（手机上传；空 = 默认封面模糊）
  const playerBg = useMusic((s) => s.playerBg);
  // 播放器版式（经典黑胶/全屏封面/唱片封面，第三十四轮）
  const playerStyle = useMusic((s) => s.playerStyle);
  // 对方信息跟随全局（联系人库里最新头像/昵称）
  const togetherLive = useTogetherLive();

  useEffect(() => {
    if (current) void loadLyric(current.id);
  }, [current, loadLyric]);

  // 评论总数（真实接口，仅用于底部数字展示）——render 期派生重置避免 effect 同步 setState
  const curId = current?.id ?? 0;
  const [cmtState, setCmtState] = useState<{ id: number; total: number | null }>({ id: 0, total: null });
  if (cmtState.id !== curId) setCmtState({ id: curId, total: null });
  useEffect(() => {
    if (!curId) return;
    let on = true;
    void (async () => {
      try {
        const p = await commentsOf(curId, 1, 0);
        if (on) setCmtState((s) => (s.id === curId ? { id: curId, total: p.total } : s));
      } catch {
        // 数量获取失败不展示数字
      }
    })();
    return () => {
      on = false;
    };
  }, [curId]);

  if (!current) {
    return (
      <div className="relative flex h-full flex-col bg-[#101010]">
        <PlayerTopBar onClose={close} title="播放器" light />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
          <Music2 className="h-12 w-12 opacity-30" />
          <p className="text-[13px]">队列是空的，去挑几首歌吧</p>
          <button
            type="button"
            onClick={close}
            className="rounded-full border border-white/15 bg-white/10 px-5 py-1.5 text-[12px] text-zinc-300 backdrop-blur-xl"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const liked = likedIds.has(current.id);
  const chatMode = !!(together && showChat);

  // 快聊发送（不切视图，直接发 → 气泡显示在头像下 5 秒）
  const sendQuick = () => {
    const t = quickText.trim();
    if (!t || !together) return;
    sendTogetherText(t);
    setQuickText('');
  };

  // 设置菜单动作（顶栏⋮ / 底部三个点共用）
  const openTgMenu = () => {
    setShowTgMenu(true);
  };

  // 一起听底部（仅音乐唱片视图显示）：音乐/聊天方形圆角胶囊居中；三个点贴最右开歌曲操作面板；自己一个人时右上角顶栏显示「一起听」
  const modeCapsule = together ? (
    <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-1">
      <span className="h-8 w-8 shrink-0" aria-hidden />
      <div className="flex items-center gap-1 rounded-[10px] bg-white/10 p-1">
        <button
          type="button"
          onClick={() => setChatOverride(false)}
          data-testid="music-tg-tab-music"
          aria-label="音乐视图"
          className={`flex h-8 w-11 items-center justify-center rounded-[6px] ${
            !showChat ? 'bg-white/25 text-white' : 'text-white/55'
          }`}
        >
          <Music2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setChatOverride(true)}
          data-testid="music-tg-open-chat"
          aria-label="聊天视图"
          className={`flex h-8 w-11 items-center justify-center rounded-[6px] ${
            showChat ? 'bg-white/25 text-white' : 'text-white/55'
          }`}
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowMore(true)}
        data-testid="music-tg-dots"
        aria-label="歌曲操作面板"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-white/85 active:scale-95"
      >
        <MoreVertical className="h-[19px] w-[19px]" />
      </button>
    </div>
  ) : (
    // 自己一个人听：「一起听」在顶栏右上角（第二十六轮从底部移入，第二十八轮文案精简），底部只留歌曲操作面板三个点
    <div className="flex shrink-0 items-center justify-end px-6 pb-4 pt-1">
      <button
        type="button"
        onClick={() => setShowMore(true)}
        data-testid="music-solo-dots"
        aria-label="歌曲操作面板"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-white/85 active:scale-95"
      >
        <MoreVertical className="h-[19px] w-[19px]" />
      </button>
    </div>
  );

  const togetherHead = together ? (
    <TogetherHead session={togetherLive ?? together} msgs={togetherMsgs} showBubbles={!showChat} />
  ) : null;
  // 歌曲操作面板「正在一起听」格子展示的双头像（在一起听时才传）
  const tgAvatars = together
    ? { peer: (togetherLive ?? together).avatar, mine: myAvatarOf(loginUid, loginAvatar) }
    : null;

  // 结束一起听（⋮ 菜单内）
  const endTogether = () => {
    void (async () => {
      await stopTogether();
      setChatOverride(false);
    })();
  };

  const menuRematch = () => {
    setShowTgMenu(false);
    setInviteTitle('重新匹配');
    setShowInvite(true);
  };
  const menuRecords = () => {
    setShowTgMenu(false);
    setShowTgRecord(true);
  };
  const menuPref = () => {
    setShowTgMenu(false);
    setMoreToast('已按你们的听歌口味自动匹配~');
  };
  const menuReport = () => {
    setShowTgMenu(false);
    if (confirm('确定举报 TA 在一起听中的行为吗？')) setMoreToast('已提交举报，感谢反馈');
  };
  const menuExit = () => {
    setShowTgMenu(false);
    if (together) endTogether();
    else setMoreToast('还没有开始一起听');
  };

  // 聊天态：全屏独立布局（顶栏+双头像+歌名行+消息流+输入条+底部胶囊），仿网易云一起听聊天界面
  if (chatMode) {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#101010] text-white" data-testid="music-player">
        {/* 背景：自定义背景图（手机上传）优先，否则封面模糊 */}
        {playerBg ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${playerBg})` }}
            />
            <div className="absolute inset-0 bg-black/45" />
          </>
        ) : (
          <>
            <div
              className="absolute inset-0 scale-150 bg-cover bg-center opacity-40 blur-3xl"
              style={{ backgroundImage: `url(${songCover(current)})` }}
            />
            <div className="absolute inset-0 bg-black/35" />
          </>
        )}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* 顶部不再有「音乐界面」胶囊（第十四轮反馈）：切回音乐视图走底部 tab */}
          <PlayerTopBar onClose={close} light onMenu={openTgMenu} dense />
          {/* 双头像 + 相距/累计时长（红色计时徽章已按第十五轮反馈删除） */}
          <TogetherHead session={togetherLive ?? together} msgs={togetherMsgs} showBubbles={false} />
          {/* 正在听的歌：歌名+歌手+关注 | 红心热度 + 播放列表（参考截图样式） */}
          <div className="flex items-end justify-between gap-3 px-5 pb-2.5 pt-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[22px] font-bold leading-tight" data-testid="music-tg-chat-song">
                {current.name}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 truncate text-[13px] text-white/60">{songArtistText(current)}</p>
                <FollowPill song={current} onToast={setMoreToast} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-5 pb-0.5">
              <button
                type="button"
                onClick={() => void toggleLike(current)}
                aria-label="红心"
                data-testid="music-tg-chat-like"
                className="relative active:scale-90"
              >
                <Heart
                  className={`h-[26px] w-[26px] ${liked ? 'text-[#EC4141]' : 'text-white/75'}`}
                  fill={liked ? 'currentColor' : 'none'}
                />
                {/* 热度数挂图标右上角（第二十七轮改左锚伸出式；第三十八轮：默认白色半透明，
                    点击爱心点赞后才变红——用户「点击爱心了以后才变红色」） */}
                <span className={`absolute -top-[6px] left-[calc(100%-6px)] whitespace-nowrap text-[10px] font-medium leading-none tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.45)] ${liked ? 'text-[#EC4141]' : 'text-white/70'}`}>
                  {fmtCountW(fakeHotCount(current.id))}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowQueue(true)}
                aria-label="播放列表"
                data-testid="music-tg-chat-queue"
                className="active:scale-90"
              >
                <ListMusic className="h-6 w-6 text-white/85" />
              </button>
            </div>
          </div>
          <div className="mx-5 shrink-0 border-t border-white/10" />
          {/* 消息流（双方同色气泡 + AI 回复三个跳动点） */}
          <div className="flex min-h-0 flex-1 flex-col" data-testid="music-player-chat-mode">
            <TogetherChat />
          </div>
          <TogetherChatInput onToast={setMoreToast} />
          {/* 底部：礼物 | 音乐/聊天胶囊（常驻） | 歌曲操作面板 */}
          <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-1">
            <button
              type="button"
              onClick={() => setMoreToast('礼物功能即将上线')}
              aria-label="礼物"
              data-testid="music-tg-chat-gift"
              className="flex h-8 w-8 items-center justify-center text-white/80 active:scale-95"
            >
              <Gift className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-1 rounded-[10px] bg-white/10 p-1">
              <button
                type="button"
                onClick={() => setChatOverride(false)}
                data-testid="music-tg-chat-tab-music"
                aria-label="切到音乐视图"
                className="flex h-8 w-11 items-center justify-center rounded-[6px] text-white/55 active:scale-95"
              >
                <Music2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setChatOverride(true)}
                data-testid="music-tg-chat-tab-chat"
                aria-label="聊天视图"
                className="flex h-8 w-11 items-center justify-center rounded-[6px] bg-white/25 text-white"
              >
                <MessageCircle className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowMore(true)}
              aria-label="歌曲操作面板"
              data-testid="music-tg-chat-dots"
              className="flex h-8 w-8 items-center justify-center text-white/85 active:scale-95"
            >
              <MoreVertical className="h-[19px] w-[19px]" />
            </button>
          </div>
        </div>
        {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}
        {showInvite && (
          <InviteSheet
            title={inviteTitle}
            onClose={() => setShowInvite(false)}
            onInvited={(n) => setMoreToast(`已向 ${n} 发送一起听邀请`)}
          />
        )}

        {/* 更多面板（聊天态也可用） */}
        {showMore && (
          <MoreSheet
            song={current}
            liked={liked}
            tg={tgAvatars}
            onClose={() => setShowMore(false)}
            onToast={(m) => setMoreToast(m)}
            onInvite={() => {
              setShowMore(false);
              setShowInvite(true);
            }}
          />
        )}

        {/* 一起听设置菜单（聊天态） */}
        {showTgMenu && (
          <TogetherMenu
            onClose={() => setShowTgMenu(false)}
            onRematch={menuRematch}
            onRecords={menuRecords}
            onPref={menuPref}
            onReport={menuReport}
            onExit={menuExit}
          />
        )}

        {/* 查看一起听记录（聊天态） */}
        {showTgRecord && (
          <TgRecordSheet session={together!} msgs={togetherMsgs} onClose={() => setShowTgRecord(false)} />
        )}

        {moreToast && (
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-white/20 px-4 py-1.5 text-[12px] text-white backdrop-blur">
            {moreToast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#101010] text-white" data-testid="music-player">
      {/* 背景：自定义背景图（手机上传）优先，否则封面模糊 */}
      {playerBg ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${playerBg})` }}
          />
          <div className="absolute inset-0 bg-black/45" />
        </>
      ) : (
        <>
          <div
            className="absolute inset-0 scale-150 bg-cover bg-center opacity-40 blur-3xl"
            style={{ backgroundImage: `url(${songCover(current)})` }}
          />
          <div className="absolute inset-0 bg-black/35" />
        </>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 歌词视图顶栏隐藏：歌名/歌手头部即顶栏（第二十六轮，标题提到最上一行、与右上三点同行对齐） */}
        {!showLyric && (
          <PlayerTopBar
            onClose={close}
            light
            dense={!!together}
            // 右上角 ⋮ 仅一起听显示（自己听不显示：用户第十三轮反馈）；聊天视图为一起听专属恒显示
            onMenu={together ? openTgMenu : undefined}
            // 自己听：一起听胶囊移到顶栏右上角（第二十六轮反馈）
            onInviteSolo={!together ? () => setShowInvite(true) : undefined}
          />
        )}

        {/* 歌词界面隐藏双头像；黑胶界面才展示 */}
        {!showLyric && togetherHead}

      {/* 封面/歌词切换区（歌词视图加宽到近全宽，仿网易云歌词页） */}
        <div
          className={`relative flex min-h-0 flex-1 items-center justify-center pt-4 ${showLyric ? 'px-3' : 'px-8'}`}
          // 歌词视图：点歌词区以外（左右留白/顶部空隙）也返回唱片界面（第二十六轮反馈）
          onClick={showLyric ? () => setShowLyric(false) : undefined}
        >
          {showLyric ? (
            <LyricView
              song={current}
              onSwitch={() => setShowLyric(false)}
              onClose={close}
              onMore={() => setShowMore(true)}
              onToast={setMoreToast}
              topInset={together ? 46 : 58}
            />
          ) : (
            <VinylView
              song={current}
              playing={playing}
              onSwitch={() => setShowLyric(true)}
              style={playerStyle}
            />
          )}
        </div>

        {/* 歌名行 + 操作图标（信息/爱心/评论；数字挂在各自图标右上角角标位，第二十五轮） */}
        <div className="flex items-end justify-between gap-2 pl-5 pr-8 pb-1">
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[19px] font-bold" data-testid="music-player-name">
                {current.name}
              </h2>
              {freeTrial && (
                <span className="shrink-0 rounded-[3px] border border-white/50 px-1 text-[9px] leading-[14px]">
                  试听
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/60" data-testid="music-player-artist">
              {songArtistText(current)}
            </p>
          </div>
          {/* 信息图标：一起听时点击底部弹出输入框（气泡显示在头像下）；自己听不显示；纯图标无底色 */}
          <div className="flex shrink-0 items-center gap-7 pt-4">
            {together && (
              // 聊天按钮（第二十六轮按用户截图美化）：半透明圆底 + 实色镂空点气泡（暖白色）
              <button
                type="button"
                onClick={() => setShowQuickInput((v) => !v)}
                data-testid="music-player-chat"
                aria-label="发消息"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 active:scale-95 ${
                  showQuickInput ? 'text-white' : 'text-[#EFE8D8]'
                }`}
              >
                <TgChatGlyph className="h-[22px] w-[22px]" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleLike(current)}
              data-testid="music-player-like"
              aria-label="红心"
              className="relative shrink-0 p-0.5 active:scale-90"
            >
              <Heart
                className={`h-[25px] w-[25px] ${liked ? 'text-[#EC4141]' : 'text-white/75'}`}
                fill={liked ? 'currentColor' : 'none'}
              />
              {/* 热度数挂图标右上角（第二十七轮改左锚伸出式：数字从爱心右缘向右上伸出，
                  之前 -right 锚定导致长数字盖在爱心正上方、看着不在角上）；
                  第三十八轮：默认白色半透明，点赞后才变红 */}
              <span
                className={`absolute -top-[6px] left-[calc(100%-6px)] whitespace-nowrap text-[10px] font-medium leading-none tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.45)] ${liked ? 'text-[#EC4141]' : 'text-white/70'}`}
                data-testid="music-player-like-count"
              >
                {fmtCountW(fakeHotCount(current.id))}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openComments(current)}
              aria-label="评论"
              data-testid="music-player-comment"
              className="relative shrink-0 p-0.5 active:scale-90"
            >
              <MessageCircleMore className="h-[25px] w-[25px] text-white/75" />
              <span
                className="absolute -top-[6px] left-[calc(100%-6px)] whitespace-nowrap text-[10px] font-medium leading-none tabular-nums text-white/55 [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]"
                data-testid="music-player-comment-count"
              >
                {cmtState.total === null ? '' : fmtCountW(cmtState.total)}
              </span>
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="px-6 pt-2">
          <SeekBar position={position} duration={duration || 1} onSeek={seek} />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/50">
            <span>{fmtClock(position)}</span>
            <span>{fmtClock(duration)}</span>
          </div>
          {playError && (
            <p className="mt-0.5 text-center text-[11px] text-red-300" data-testid="music-player-error">
              {playError}
            </p>
          )}
        </div>

        {/* 控制区（歌词视图整体上移一点：第二十六轮反馈底部暂停键太贴底）
            第三十五轮按参考截图美化：圆环循环箭头 / 圆角双条暂停 / 大圆角三角播放 / 三角+线队列
            第三十七轮：顺序播放改独立箭头图标（不再与列表循环共形）+ 切换时浮层提示模式名 */}
        <div className={`flex items-center justify-between px-8 pt-3 ${showLyric ? 'pb-5' : 'pb-2'}`}>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={cycleMode}
              data-testid="music-player-mode"
              aria-label="播放模式"
              className="block p-1 text-white/80 active:scale-90"
            >
              {/* 模式图标切换动画（第三十八轮）：每次点击图标带旋转+缩放进场，让「点一下就变了」
                  有明确的视觉反馈（配合浮层模式名，从感知层面根治「点两下才发现变了」） */}
              <motion.span
                key={mode}
                className="flex"
                initial={{ rotate: -120, opacity: 0, scale: 0.55 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              >
                {mode === 'order' && <OrderPlayIcon className="h-[23px] w-[23px]" />}
                {mode === 'repeat' && <LoopArrowIcon className="h-[23px] w-[23px] text-[#EC4141]" />}
                {mode === 'one' && <LoopArrowIcon one className="h-[23px] w-[23px] text-[#EC4141]" />}
                {mode === 'shuffle' && <Shuffle className="h-[23px] w-[23px] text-[#EC4141]" />}
              </motion.span>
            </button>
            {/* 模式浮层提示：每次切换立刻报出模式名（修复「点两下才发现变了」的感知问题），1.4 秒后淡出 */}
            <span
              data-testid="music-player-mode-tip"
              className={`pointer-events-none absolute -top-[26px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2.5 py-[5px] text-[11px] leading-none text-white shadow-sm backdrop-blur-sm transition-all duration-200 ${
                modeTip ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
              }`}
            >
              {modeTip || MODE_LABELS[mode]}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void prev()}
            aria-label="上一首"
            className="p-1 text-white/90 active:scale-90"
          >
            <SkipBack className="h-8 w-8" fill="currentColor" strokeLinejoin="round" />
          </button>
          <button
            type="button"
            onClick={toggle}
            data-testid="music-player-toggle"
            aria-label={playing ? '暂停' : '播放'}
            className="flex h-[62px] w-[62px] items-center justify-center text-white active:scale-95"
          >
            {buffering ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : playing ? (
              <PauseBarsIcon className="h-[38px] w-[38px]" />
            ) : (
              <PlayTriIcon className="h-[38px] w-[38px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void next(false)}
            data-testid="music-player-next"
            aria-label="下一首"
            className="p-1 text-white/90 active:scale-90"
          >
            <SkipForward className="h-8 w-8" fill="currentColor" strokeLinejoin="round" />
          </button>
          <button
            type="button"
            onClick={() => setShowQueue(true)}
            aria-label="播放列表"
            className="p-1 text-white/80 active:scale-90"
          >
            <QueueListIcon className="h-[23px] w-[23px]" />
          </button>
        </div>

        {/* 一起听底部胶囊只在音乐唱片视图显示（歌词/聊天视图不重复展示） */}
        {!showLyric && modeCapsule}

        {/* 音乐界面快聊输入条（一起听时点信息图标弹出；发送后气泡显示在头像下 5 秒） */}
        {together && showQuickInput && !showLyric && (
          <QuickInputBar
            value={quickText}
            onChange={setQuickText}
            onSend={sendQuick}
            onClose={() => setShowQuickInput(false)}
          />
        )}
      </div>

      {/* 更多面板（仿网易云歌曲操作面板；三个点入口，正在一起听格子显示双方头像） */}
      {showMore && (
        <MoreSheet
          song={current}
          liked={liked}
          tg={tgAvatars}
          onClose={() => setShowMore(false)}
          onToast={(m) => setMoreToast(m)}
          onInvite={() => {
            setShowMore(false);
            setShowInvite(true);
          }}
        />
      )}

      {/* 播放列表 */}
      {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}

      {/* 邀请/重新匹配一起听 */}
      {showInvite && (
        <InviteSheet
          title={inviteTitle}
          onClose={() => setShowInvite(false)}
          onInvited={(n) => setMoreToast(`已向 ${n} 发送一起听邀请`)}
        />
      )}

      {/* 一起听设置菜单（顶栏⋮；自己听也能打开：重新匹配/查看记录可用，退出时提示未在一起听） */}
      {showTgMenu && (
        <TogetherMenu
          onClose={() => setShowTgMenu(false)}
          onRematch={menuRematch}
          onRecords={menuRecords}
          onPref={menuPref}
          onReport={menuReport}
          onExit={menuExit}
        />
      )}

      {/* 查看一起听记录（自己听无会话 → 空态） */}
      {showTgRecord && (
        <TgRecordSheet session={together} msgs={togetherMsgs} onClose={() => setShowTgRecord(false)} />
      )}

      {moreToast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-white/20 px-4 py-1.5 text-[12px] text-white backdrop-blur">
          {moreToast}
        </div>
      )}
    </div>
  );
}

// ---------------- 顶栏 ----------------

function PlayerTopBar({
  onClose,
  title,
  light,
  onMenu,
  dense,
  onInviteSolo,
}: {
  onClose: () => void;
  /** 顶部标题（可选；一起听/播放模式默认不展示） */
  title?: string;
  light?: boolean;
  /** 右上角 ⋮ 菜单（一起听：重新匹配/查看记录/匹配偏好设置/举报/退出一起听） */
  onMenu?: () => void;
  /** 紧凑顶栏（一起听：双头像更贴顶） */
  dense?: boolean;
  /** 自己听：右上角「一起听」（第二十六轮从底部移到顶栏右上角；第二十八轮文案由「邀请好友一起听」精简） */
  onInviteSolo?: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 pb-1 ${dense ? 'pt-[46px]' : 'pt-[58px]'}`}>
      <button type="button" onClick={onClose} aria-label="收起" data-testid="music-player-close">
        <ChevronDown className={`h-7 w-7 ${light ? 'text-white/85' : 'text-zinc-600'}`} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {title ? (
          <p className={`truncate text-[13px] ${light ? 'text-white/90' : 'text-zinc-700'}`}>{title}</p>
        ) : null}
      </div>
      {onMenu ? (
        <button
          type="button"
          onClick={onMenu}
          aria-label="一起听菜单"
          data-testid="music-tg-menu-btn"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/30 active:scale-95"
        >
          <MoreVertical className="h-[19px] w-[19px] text-white/90" />
        </button>
      ) : onInviteSolo ? (
        // 自己听：一起听胶囊（顶栏右上角；第二十八轮文案精简）
        <button
          type="button"
          onClick={onInviteSolo}
          data-testid="music-tg-invite-solo"
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-[7px] text-[12px] text-white/85 active:scale-95"
        >
          <UserRoundPlus className="h-3.5 w-3.5" />
          一起听
        </button>
      ) : (
        <span className="w-6" />
      )}
    </div>
  );
}

/** 一起听聊天按钮图标（第二十六轮按用户截图美化）：实色圆气泡 + 三个镂空点（evenodd 挖孔，暖白色） */
function TgChatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.8c-5.1 0-9.2 3.5-9.2 7.9 0 2.5 1.3 4.7 3.4 6.1l-.9 3.6c-.14.5.35.92.8.68l3.9-2.1c.65.12 1.32.18 2 .18 5.1 0 9.2-3.5 9.2-7.9S17.1 2.8 12 2.8zM8.2 9.4a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3zm3.8 0a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3zm3.8 0a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3z"
      />
    </svg>
  );
}

// ---------------- 黑胶视图（第三十一轮按用户参考图再美化：
// 细密同心纹路 + 纹路明暗带 + 外缘悬浮光环 + 大封面占比；
// 第三十二轮：白色圆轴承整体删除（用户要求）、盘面斜向高光层删除（泛白块根因）；
// 第三十四轮：播放器版式可选——经典黑胶（原样式）/ 全屏封面 / 唱片封面（整张封面作旋转唱片面）） ----------------

function VinylView({
  song,
  playing,
  onSwitch,
  style = 'vinyl',
}: {
  song: NcmSong;
  playing: boolean;
  onSwitch: () => void;
  /** 播放器版式（设置弹窗可选，第三十四轮） */
  style: PlayerStyle;
}) {
  const spinState = { animationPlayState: playing ? ('running' as const) : ('paused' as const) };
  return (
    <div className="relative flex h-full w-full flex-col items-center">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {style === 'coverFull' ? (
          /* 全屏封面：大圆角方形封面居中铺满（无唱片，第三十四轮） */
          <button
            type="button"
            onClick={onSwitch}
            data-testid="music-cover-full"
            aria-label="切换到歌词"
            className="relative aspect-square h-full max-h-[300px] max-w-full shrink-0 overflow-hidden rounded-[18px] shadow-[0_24px_64px_rgba(0,0,0,0.6),0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-white/15"
          >
            <CoverImg src={songCover(song)} className="h-full w-full" alt={song.name} />
          </button>
        ) : style === 'discCover' ? (
          /* 唱片封面：整张封面作唱片面（图纹唱片），外缘深黑胶圈 + 悬浮光环，随播放旋转（第三十四轮） */
          <button
            type="button"
            onClick={onSwitch}
            data-testid="music-disc-cover"
            aria-label="切换到歌词"
            className="relative aspect-square h-full max-h-[256px] max-w-full shrink-0"
          >
            <div className="absolute inset-[-7%] rounded-full bg-black/30 blur-2xl" aria-hidden />
            <div
              className="absolute inset-[-2.5%] rounded-full"
              style={{
                background:
                  'radial-gradient(circle, transparent 0%, transparent 88%, rgba(255,255,255,0.07) 94%, rgba(255,255,255,0.02) 100%)',
                boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
              }}
              aria-hidden
            />
            {/* 盘体外缘（深黑圈，不随旋转） */}
            <div className="absolute inset-0 rounded-full bg-[#060606] shadow-[0_24px_64px_rgba(0,0,0,0.6),0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-white/10" />
            {/* 唱片面 = 整张封面（旋转），内阴影压出胶片厚度感 */}
            <div
              className="absolute inset-[2.2%] animate-[spin_20s_linear_infinite] overflow-hidden rounded-full"
              style={spinState}
            >
              <CoverImg src={songCover(song)} className="h-full w-full" alt={song.name} />
              <div
                className="absolute inset-0 rounded-full shadow-[inset_0_2px_6px_rgba(255,255,255,0.12),inset_0_-6px_16px_rgba(0,0,0,0.55),inset_0_0_50px_rgba(0,0,0,0.35)]"
                aria-hidden
              />
            </div>
          </button>
        ) : (
          /* 经典黑胶（原样式，第三十一轮定版） */
          <button
            type="button"
            onClick={onSwitch}
            data-testid="music-vinyl"
            aria-label="切换到歌词"
            className="relative aspect-square h-full max-h-[256px] max-w-full shrink-0"
          >
          {/* 盘后氛围光晕（悬浮立体感） */}
          <div className="absolute inset-[-7%] rounded-full bg-black/30 blur-2xl" />
          {/* 外缘悬浮光环（仿参考图盘缘外一圈微光，与盘面留出细缝） */}
          <div
            className="absolute inset-[-2.5%] rounded-full"
            style={{
              background:
                'radial-gradient(circle, transparent 0%, transparent 88%, rgba(255,255,255,0.07) 94%, rgba(255,255,255,0.02) 100%)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
            }}
          />
          {/* 盘体外缘（深黑圈，立体边缘，不随旋转） */}
          <div className="absolute inset-0 rounded-full bg-[#060606] shadow-[0_24px_64px_rgba(0,0,0,0.6),0_4px_14px_rgba(0,0,0,0.5)] ring-1 ring-white/10" />
          {/* 胶片主体（旋转）：细密同心纹路 + 三圈明暗带分組（仿参考图纹路带） */}
          <div
            className="absolute inset-[1.8%] animate-[spin_20s_linear_infinite] overflow-hidden rounded-full"
            style={
              playing
                ? {
                    background:
                      'repeating-radial-gradient(circle at 50% 50%, #101010 0px, #1f1f1f 0.8px, #0a0a0a 1.6px, #161616 2.4px), radial-gradient(circle, transparent 0%, transparent 38.5%, rgba(255,255,255,0.045) 39.3%, transparent 40.2%, transparent 53.5%, rgba(255,255,255,0.035) 54.3%, transparent 55.2%, transparent 69.5%, rgba(255,255,255,0.03) 70.3%, transparent 71.2%, transparent 83.5%, rgba(255,255,255,0.028) 84.3%, transparent 85.2%), radial-gradient(circle, #191919 0%, #131313 36%, #171717 60%, #0e0e0e 82%, #181818 100%)',
                    boxShadow:
                      'inset 0 1px 3px rgba(255,255,255,0.09), inset 0 -3px 8px rgba(0,0,0,0.85), inset 0 0 30px rgba(0,0,0,0.5)',
                  }
                : {
                    background:
                      'repeating-radial-gradient(circle at 50% 50%, #101010 0px, #1f1f1f 0.8px, #0a0a0a 1.6px, #161616 2.4px), radial-gradient(circle, transparent 0%, transparent 38.5%, rgba(255,255,255,0.045) 39.3%, transparent 40.2%, transparent 53.5%, rgba(255,255,255,0.035) 54.3%, transparent 55.2%, transparent 69.5%, rgba(255,255,255,0.03) 70.3%, transparent 71.2%, transparent 83.5%, rgba(255,255,255,0.028) 84.3%, transparent 85.2%), radial-gradient(circle, #191919 0%, #131313 36%, #171717 60%, #0e0e0e 82%, #181818 100%)',
                    boxShadow:
                      'inset 0 1px 3px rgba(255,255,255,0.09), inset 0 -3px 8px rgba(0,0,0,0.85), inset 0 0 30px rgba(0,0,0,0.5)',
                    animationPlayState: 'paused',
                  }
            }
          >
            {/* 斜向高光已整体删除（第三十二轮：conic 高光在盘面左下形成一块楔形泛白，用户反馈去除） */}
            {/* 封面（大占比仿参考图：盘径 ~59%，细黑圈与纹路分隔） */}
            <div className="absolute inset-[20.5%] overflow-hidden rounded-full ring-[3px] ring-black/80">
              <CoverImg src={songCover(song)} className="h-full w-full" alt={song.name} />
            </div>
          </div>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- 歌词视图（第二十四轮重做：仿网易云歌词页——
// 当前行胶囊高亮（行时间+播放键）仅手动滚动浏览时显示（第二十七轮，自动跟随不显示），
// 且高亮跟随滚动位置——滚到哪句就亮在哪句（第三十一轮，focusIdx 跟随视口中线最近行），
// 上下行淡出聚焦，逐行滚动；
// 第二十八轮：点歌词不再跳播（点歌词界面任何位置都回唱片）、行时间默认隐藏
// 仅自己滚动时显示（悬浮件绝对定位，文字全宽常居中，修复滚动时歌词右移）；
// 第二十九轮：头部底衬删黑渐变只留渐进模糊（背景无黑色块）、
// 左上角箭头改「退出听歌界面」并上移、右上角 ⋮ 上移右移；
// 长按复制、手动滑动浏览松手 3 秒后回当前行、拖进度条歌词跟随；
// 顶部歌名/歌手头部即顶栏（标题与右上三点同行，第二十六轮） ----------------

/** 剪贴板写入（clipboard API 失败回退 execCommand） */
async function copyLyricText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // 回退方案
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function LyricView({
  song,
  onSwitch,
  onClose,
  onMore,
  onToast,
  topInset = 58,
}: {
  song: NcmSong;
  onSwitch: () => void;
  /** 左上角箭头：退出听歌界面（收起播放器，第二十九轮反馈，原为回唱片） */
  onClose: () => void;
  /** 右上角更多钮 → 歌曲操作面板（MoreSheet） */
  onMore: () => void;
  onToast: (m: string) => void;
  /** 顶部安全区高度（一起听 46 / 自己听 58，与 PlayerTopBar 一致；歌词态顶栏隐藏，头部自担） */
  topInset?: number;
}) {
  const lyricLines = useMusic((s) => s.lyricLines);
  const loading = useMusic((s) => s.lyricLoading);
  const showTr = useMusic((s) => s.lyricShowTr);
  const setShowTr = useMusic((s) => s.setLyricShowTr);
  const position = useMusic((s) => s.position);
  const playing = useMusic((s) => s.playing);
  const toggle = useMusic((s) => s.toggle);
  const seek = useMusic((s) => s.seek);
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 手动浏览中：暂停自动跟随；松手 3 秒无操作回当前行（需求三.3）
  const manualRef = useRef(false);
  const manualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 长按复制后吞掉随后的 click（避免复制时误跳进度）
  const suppressClickRef = useRef(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= position + 0.2) idx = i;
      else break;
    }
    return idx;
  }, [lyricLines, position]);
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  // 当前行胶囊高亮只在「自己手动滚动浏览」时显示（第二十七轮反馈：自动跟随播放/拖进度条
  // 时不显示胶囊，自己滑过歌词才亮起）；松手 3 秒无操作自动回当前行并熄灭；
  // 胶囊隐藏后行文字仍保持高亮白，仅背景/时间/播放键淡出（占位不变不跳动）；
  // 第三十一轮：手动滚动时高亮跟随滚动位置——滚到哪句亮在哪句（viewIdx = 视口中线最近行）
  const [capsuleOn, setCapsuleOn] = useState(false);
  const [viewIdx, setViewIdx] = useState(-1);
  const viewIdxRef = useRef(-1);
  // 高亮目标行：手动浏览中 = 滚动位置所在行；其余 = 播放当前行
  const focusIdx = capsuleOn && viewIdx >= 0 ? viewIdx : activeIdx;

  const scrollToLine = (idx: number, behavior: ScrollBehavior) => {
    const box = boxRef.current;
    const el = lineRefs.current[idx];
    if (!box || !el || idx < 0) return;
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior });
  };

  // 挂载：立即定位到当前行（不动画）
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (activeIdxRef.current >= 0) scrollToLine(activeIdxRef.current, 'auto');
    return () => {
      if (manualTimerRef.current) clearTimeout(manualTimerRef.current);
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // 进度跳变（拖进度条/点行跳播/切歌）→ 立即跟随当前行（需求二.3）
  const prevPosRef = useRef(position);
  useEffect(() => {
    const jumped = Math.abs(position - prevPosRef.current) > 1.2;
    prevPosRef.current = position;
    if (!jumped) return;
    manualRef.current = false;
    if (manualTimerRef.current) {
      clearTimeout(manualTimerRef.current);
      manualTimerRef.current = null;
    }
    // 拖进度条/点行跳播不算手动浏览：胶囊一并熄灭（第二十七轮），滚动高亮同步复位。
    // queueMicrotask：lint（set-state-in-effect）合规，且微任务在绘制前执行、无可视闪烁
    viewIdxRef.current = -1;
    queueMicrotask(() => {
      setCapsuleOn(false);
      setViewIdx(-1);
    });
    scrollToLine(activeIdxRef.current, 'smooth');
  }, [position]);

  // 当前行变化自动滚动（手动浏览中不抢滚动；暂停时 activeIdx 不变自然停住，需求二.4）
  useEffect(() => {
    if (manualRef.current) return;
    if (activeIdx >= 0) scrollToLine(activeIdx, 'smooth');
  }, [activeIdx]);

  // 手动浏览标记（触摸/滚轮都算）：亮起胶囊（起点先亮在播放当前行）+ 刷新 5 秒回跳计时器
  // （第三十四轮：停止 5 秒后才回当前行，原 3 秒）
  const markManual = () => {
    manualRef.current = true;
    viewIdxRef.current = activeIdxRef.current;
    setViewIdx(activeIdxRef.current);
    setCapsuleOn(true);
    if (manualTimerRef.current) clearTimeout(manualTimerRef.current);
    manualTimerRef.current = setTimeout(() => {
      manualTimerRef.current = null;
      manualRef.current = false;
      setCapsuleOn(false);
      viewIdxRef.current = -1;
      setViewIdx(-1);
      scrollToLine(activeIdxRef.current, 'smooth');
    }, 5000);
  };

  // 滚动中高亮跟随（第三十一轮）：算视口中线最近的歌词行，滚到哪句胶囊亮在哪句；
  // 仅手动浏览中生效（自动跟播时 focusIdx 恒为 activeIdx，无需计算）
  const handleScroll = () => {
    if (!manualRef.current || !capsuleOn) return;
    const box = boxRef.current;
    if (!box) return;
    const mid = box.scrollTop + box.clientHeight / 2;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < lineRefs.current.length; i++) {
      const el = lineRefs.current[i];
      if (!el) continue;
      const d = Math.abs(el.offsetTop + el.clientHeight / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && best !== viewIdxRef.current) {
      viewIdxRef.current = best;
      setViewIdx(best);
    }
  };

  const flashCopied = (msg: string) => {
    setCopied(msg);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(''), 1600);
  };

  const clearPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  // 长按行 500ms → 复制该句歌词（含翻译，需求三.2）
  const startPress = (l: { text: string; tr: string }) => {
    clearPress();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      suppressClickRef.current = true;
      void copyLyricText(l.tr ? `${l.text}\n${l.tr}` : l.text).then((ok) =>
        flashCopied(ok ? '已复制歌词' : '复制失败'),
      );
    }, 500);
  };

  return (
    <div className="relative h-full w-full" data-testid="music-lyric-view" onClick={onSwitch}>
      {/* 头部底衬（第二十八轮引入；第二十九轮反馈「背景图为什么有黑色」）——删黑色渐变层，
          只留 backdrop-blur 渐进模糊：歌词滚入标题区被模糊至看不见（模糊不产生黑色），
          背景保持封面主色调，与网易云歌词页观感一致；
          pointer-events-none 不挡点击回唱片 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[170px] backdrop-blur-2xl backdrop-saturate-150"
        aria-hidden="true"
        style={{
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 48%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, black 0%, black 48%, transparent 100%)',
        }}
      />
      {/* 顶部歌名/歌手头部（第二十五轮按用户截图；第二十六轮：标题提到最上一行、
          与右上角三点垂直居中对齐，头部自身承担顶部安全区；点头部空白处也回唱片） */}
      <div
        className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4"
        style={{ paddingTop: topInset }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="退出听歌界面"
          data-testid="music-lyric-back"
          className="-ml-1 -translate-y-1.5 p-1 text-white/85 active:scale-95"
        >
          <ChevronDown className="h-7 w-7" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex max-w-full items-center gap-1.5">
            {song.fee === 1 && (
              <span
                className="shrink-0 rounded-[4px] border border-white/60 px-[5px] text-[10px] leading-[15px] text-white/85"
                data-testid="music-lyric-vip"
              >
                VIP
              </span>
            )}
            <h2
              className="truncate text-[20px] font-bold leading-tight text-white"
              data-testid="music-lyric-song-name"
            >
              {song.name}
            </h2>
          </div>
          <div className="mt-1 flex max-w-full items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 truncate text-[13px] text-white/65" data-testid="music-lyric-artist">
              {songArtistText(song)}
            </p>
            <FollowPill song={song} onToast={onToast} />
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
          aria-label="歌曲操作面板"
          data-testid="music-lyric-more"
          className="flex h-9 w-9 shrink-0 -translate-y-1.5 translate-x-1 items-center justify-center rounded-full bg-white/10 active:scale-95"
        >
          <MoreVertical className="h-[17px] w-[17px] text-white/90" />
        </button>
      </div>
      {/* 翻译开关（头部下方右侧悬浮，不占头部一行；中英对照能力保留） */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowTr(!showTr);
        }}
        aria-label="翻译开关"
        data-testid="music-lyric-tr-toggle"
        className={`absolute right-3 z-20 rounded-full px-2.5 py-1 text-[10px] ${
          showTr ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'
        }`}
        style={{ top: topInset + 52 }}
      >
        译
      </button>
      {/* 复制反馈（浮在歌词区顶部，不打断布局） */}
      {copied && (
        <div
          className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded-full bg-white/20 px-3 py-1 text-[11px] text-white backdrop-blur"
          data-testid="music-lyric-copy-toast"
        >
          {copied}
        </div>
      )}
      <div
        ref={boxRef}
        onClick={onSwitch}
        data-testid="music-lyric-backdrop"
        className="relative h-full overflow-y-auto py-[42%] no-scrollbar"
        style={{
          // 上下淡出（聚焦效果，需求一.3）
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        }}
        onTouchStart={markManual}
        onTouchMove={markManual}
        onTouchEnd={markManual}
        onTouchCancel={markManual}
        onWheel={markManual}
        onScroll={handleScroll}
      >
        {loading && (
          <div className="flex h-[60%] items-center justify-center">
            <p className="text-[13px] text-white/40">歌词加载中…</p>
          </div>
        )}
        {!loading && lyricLines.length === 0 && (
          <div className="flex h-[60%] items-center justify-center">
            <p className="text-[13px] text-white/40">暂无歌词</p>
          </div>
        )}
        {lyricLines.map((l, i) => {
          // 高亮/胶囊目标行：手动滚动时跟随滚动位置（滚到哪句亮哪句），否则为播放当前行
          const isActive = i === focusIdx;
          const dist = Math.abs(i - focusIdx);
          const dimCls = dist === 1 ? 'opacity-[0.62]' : dist === 2 ? 'opacity-[0.42]' : dist === 3 ? 'opacity-[0.28]' : 'opacity-[0.18]';
          return (
            <div
              key={`${i}-${l.t}`}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              data-testid={isActive ? 'music-lyric-active' : undefined}
              onClick={(e) => {
                // 长按复制后吞掉随后的 click（避免复制完歌词页立即消失）
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  e.stopPropagation();
                  return;
                }
                // 第三十四轮反馈：点当前行胶囊高亮本身不返回唱片界面
                if (isActive && capsuleOn) e.stopPropagation();
                // 其余点击自然冒泡到根节点/滚动容器的 onSwitch（回唱片）
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                startPress(l);
              }}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onContextMenu={(e) => e.preventDefault()}
              className={`relative select-none px-2 py-2.5 text-center ${isActive ? '' : `transition-all duration-300 ${dimCls}`}`}
            >
              {isActive && (
                <>
                  {/* 胶囊背景：绝对铺满，仅手动滚动浏览（capsuleOn）时亮起且跟随滚动行，悬浮件不占布局 */}
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-[12px] bg-white/[0.08] transition-opacity duration-500 ${
                      capsuleOn ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                  {/* 行时间（左侧悬浮，显示所在行时间）：默认隐藏，自己滚动时才显示（第二十八轮反馈）——
                      绝对定位不占布局，文字永远全宽居中（修复滚动时歌词「往右移」） */}
                  <span
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] leading-none tabular-nums text-white/75 transition-opacity duration-500 ${
                      capsuleOn ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {fmtClock(l.t)}
                  </span>
                </>
              )}
              <span className={`relative block ${isActive ? 'text-[16px] font-semibold leading-relaxed text-white' : 'text-[15px] font-medium leading-relaxed text-white'}`}>
                {l.text}
              </span>
              {showTr && l.tr && (
                <span className={`relative mt-0.5 block text-[12px] leading-relaxed ${isActive ? 'text-white/70' : 'text-white/60'}`}>{l.tr}</span>
              )}
              {i === focusIdx && (
                /* 行播放小键（右侧悬浮）：只在当前高亮行（focusIdx）渲染——手动浏览到没播的行
                    =三角播放键（点击=从这一句开始播）、播放行=暂停双条键；其余行一律不渲染
                    （第三十六轮反馈：不是每一句歌词后面都有三角形，按键跟随高亮行走）；
                    胶囊亮起（手动滚动浏览）时才可见可点（stopPropagation 防误触返回唱片）；
                    播这一句语义沿用第三十三轮：该行时间段（l.t→下一行起点）不在播放时
                    seek 到该行起点播放（seek 后胶囊按进度跳变语义熄灭、歌词跟随新播放行），
                    已在播该段则维持播放/暂停切换 */
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextT = lyricLines[i + 1]?.t;
                    const inSegment = i === activeIdx && position >= l.t - 0.3 && (nextT === undefined || position < nextT);
                    if (inSegment) {
                      toggle();
                    } else {
                      seek(Math.max(0, l.t - 0.2));
                      if (!playing) toggle();
                    }
                  }}
                  aria-label={i === activeIdx && playing ? '暂停' : '播放'}
                  data-testid={i === activeIdx ? 'music-lyric-play-toggle' : 'music-lyric-row-play'}
                  className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-white/85 transition-opacity duration-500 active:scale-90 ${
                    capsuleOn ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  {i === activeIdx && playing ? (
                    <Pause className="h-[14px] w-[14px]" fill="currentColor" strokeWidth={0} />
                  ) : (
                    <Play className="h-[14px] w-[14px]" fill="currentColor" strokeWidth={0} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 进度条 ----------------

function SeekBar({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, (position / (duration || 1)) * 100));
  return (
    <div className="relative h-5 w-full">
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/20" />
      <div
        className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#EC4141]"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        step={1}
        value={Math.floor(position)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="播放进度"
        data-testid="music-player-seek"
      />
    </div>
  );
}

// ---------------- 数字格式化（按截图：150w+ / 2w+） ----------------

/** 数量格式化：≥1w 显示「Nw+」，否则原数 */
function fmtCountW(n: number): string {
  if (n >= 10_000) return `${Math.floor(n / 10_000)}w+`;
  return `${n}`;
}

/** 歌曲热度（演示：按歌曲 id 稳定生成 40w~1100w+） */
function fakeHotCount(id: number): number {
  const n = Math.abs(id) || 1;
  return 400_000 + (n % 350) * 30_000 + (n % 13) * 5_000;
}

// ---------------- 一起听头部 ----------------

/** 气泡展示时长（毫秒）：Task 21 改为 10 秒，逐条各自到期（不同时消失） */
const BUBBLE_TTL = 10_000;
/** 用户反馈：气泡不再限制每侧 3 条——10 秒 TTL 内的全部消息（含 AI 回复拆出的所有短气泡）都显示 */

function TogetherHead({
  session,
  msgs,
  showBubbles = false,
}: {
  session: TogetherSessionLike;
  /** 一起听消息（音乐视图下取 TTL 内双方全部消息，头像下堆叠气泡，每条 10 秒后各自消失） */
  msgs?: TogetherMsgLike[];
  showBubbles?: boolean;
}) {
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  // 双方消息堆（Task 21 引入、后按用户需求取消每侧 3 条上限：TTL 内全部显示，最新在最上）
  const [, tickNow] = useState(0);
  const nowMs = Date.now();
  const mineStack: TogetherMsgLike[] = [];
  const peerStack: TogetherMsgLike[] = [];
  if (showBubbles && msgs) {
    // 消息按时间升序追加，从尾往头扫：超出 TTL 的更早消息直接停（全部更旧）
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (nowMs - m.time >= BUBBLE_TTL) break;
      if (m.role === 'me') {
        mineStack.push(m);
      } else if (m.role === 'peer' || m.role === 'recs') {
        peerStack.push(m);
      }
    }
  }
  // 逐条错峰消失：在「最早到期的那条」时刻触发一次重渲染抹掉它，剩下的继续各自计时
  const nextExpiry = [...mineStack, ...peerStack].reduce(
    (min, m) => Math.min(min, m.time + BUBBLE_TTL - nowMs),
    Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!showBubbles || !Number.isFinite(nextExpiry) || nextExpiry <= 0) return;
    const t = setTimeout(() => tickNow((n) => n + 1), nextExpiry + 60);
    return () => clearTimeout(t);
  }, [nextExpiry, showBubbles]);
  const hasBubble = mineStack.length > 0 || peerStack.length > 0;
  // 累计时长（跨会话永久保存：since 锚点 = 现在 - 历史累计）
  const durText = fmtTogetherDur(nowMs - session.since);
  // 自定义距离（第三十八轮）：点击「相距 N 公里」的数字进入行内编辑，确认后写回活跃会话 + 按角色持久化
  const [distEditing, setDistEditing] = useState(false);
  const [distDraft, setDistDraft] = useState('');
  const distInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!distEditing) return;
    const el = distInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [distEditing]);
  const commitDist = () => {
    const n = parseInt(distDraft.replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) setTogetherDistance(Math.min(9_999_999, n));
    setDistEditing(false);
  };
  return (
    <div className="relative flex flex-col items-center pt-1 pb-0.5" data-testid="music-tg-head">
      {/* 双头像 + 耳机线（第三十一轮：在第三十轮形状基础上下段缩短——线尾从时长行上方 ~12px
          提前到 ~26px 处渐隐，垂坠感更短更利落）；两根细线分别从左头像左缘/右头像右缘
          （约圆心高度）钻出，先贴着圆弧外侧垂下，再自然下垂微微向内，尾端渐隐；
          头像（relative）盖在线上方 */}
      <div className="relative z-10 flex items-center" data-testid="music-tg-avatars">
        <svg
          viewBox="0 0 118 48"
          className="pointer-events-none absolute inset-x-0 top-[32px] z-0 h-[48px] w-full"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            {/* 尾端渐隐：从头像下缘附近开始变淡，下段提前消失（第三十八轮 y2 43→40：
                时长行再上移后线尾渐隐段同步提前，保证不相交） */}
            <linearGradient id="tg-wire-fade" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="40">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 左线：左头像左缘（圆心高度）出发、贴弧垂下微向内；右线镜像（右头像右缘） */}
          <path
            d="M 0 1 C 1 9, 3 18, 6.5 26 C 9.5 33, 11.5 38, 12.5 43"
            stroke="url(#tg-wire-fade)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M 118 1 C 117 9, 115 18, 111.5 26 C 108.5 33, 106.5 38, 105.5 43"
            stroke="url(#tg-wire-fade)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <CoverImg src={session.avatar} className="relative h-16 w-16" rounded="rounded-full" alt={session.name} />
        <CoverImg src={myAvatarOf(loginUid, loginAvatar)} className="relative -ml-2.5 h-16 w-16" rounded="rounded-full" alt="我" />
      </div>
      {/* 时长行常驻占位（有气泡时隐形但保留高度）：气泡出现/消失唱片高度恒定不跳动；
          第三十八轮 mt-[14px]→mt-[8px] 再上移 6px（用户「往上移一点点」），
          耳机线尾渐变同步收紧（y2 43→40，容器 y≈72 已完全透明），时长行上缘（y≈76）不相交 */}
      <p className={`mt-[8px] text-[11px] text-white/70 ${hasBubble ? 'invisible' : 'visible'}`}>
        相距{' '}
        {distEditing ? (
          <input
            ref={distInputRef}
            value={distDraft}
            onChange={(e) => setDistDraft(e.target.value)}
            onBlur={commitDist}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDist();
              if (e.key === 'Escape') setDistEditing(false);
            }}
            inputMode="numeric"
            aria-label="自定义距离（公里）"
            data-testid="music-tg-dist-input"
            className="w-14 rounded-[4px] border border-white/30 bg-white/15 px-1 text-center text-[11px] tabular-nums text-white outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDistDraft(String(session.distanceKm));
              setDistEditing(true);
            }}
            aria-label="点击自定义距离"
            title="点击自定义距离"
            data-testid="music-tg-dist"
            className="leading-none tabular-nums active:opacity-60"
          >
            {session.distanceKm}
          </button>
        )}{' '}
        公里 · 一起听了 {durText}
      </p>
      {/* 头像下气泡（音乐视图）：绝对定位悬浮在唱片上方，不挤动任何布局——
          TTL 内双方全部消息都堆叠显示（用户反馈：不要只显示 3 条，当前回复的全部显示），
          最新在最上依次排序，每条 10 秒后各自消失（不同时消失）；
          双头像交叠居中（对方在左/我在右，交叠 10px，各自圆心距中线 ±27px）：
          对方气泡右缘锚在对方头像圆心 +8px（尾巴在气泡右上，指向对方头像）；
          我的气泡左缘锚在我头像圆心 -8px（尾巴在气泡左上，指向我头像）——
          尾巴只画在最新一条（堆顶）上，避免整组尾巴重复显乱 */}
      {showBubbles && hasBubble && (
        <div className="pointer-events-none absolute inset-x-0 top-[78px] z-20 h-0">
          <div className="absolute right-[calc(50%+19px)] top-0 flex max-w-[46%] flex-col items-end gap-1.5">
            {peerStack.map((m, i) => (
              <HeadBubble key={m.id} text={m.text} mine={false} tail={i === 0} />
            ))}
          </div>
          <div className="absolute left-[calc(50%+19px)] top-0 flex max-w-[46%] flex-col items-start gap-1.5">
            {mineStack.map((m, i) => (
              <HeadBubble key={m.id} text={m.text} mine tail={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 我的头像（登录 > 游客自定义/全局） */
function myAvatarOf(loginUid: number | null, loginAvatar: string): string {
  return loginUid ? loginAvatar : getGuestAvatar();
}

// ---------------- 音乐界面底部快聊输入条（点信息图标弹出） ----------------

function QuickInputBar({
  value,
  onChange,
  onSend,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  // 键盘偏移只在输入框聚焦时计算，失焦立即归零（防止键盘已收起但 visualViewport 事件残留导致输入条浮顶）
  const [focused, setFocused] = useState(false);
  const [kb, setKb] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 挂载即聚焦：必须用 focus({ preventScroll: true })——autoFocus 默认会把页面/容器滚动到输入框
  // （浏览器 scrollIntoView 行为），整个界面跟着抖动；preventScroll 后只有输入条跟键盘抬起，界面纹丝不动
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!focused) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => {
      // iOS overlay 键盘：布局视口不变、可视视口变小；overlap ≈ 键盘高度。Android resize 模式 overlap≈0 天然贴底
      setKb(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    upd();
    return () => {
      vv.removeEventListener('resize', upd);
      vv.removeEventListener('scroll', upd);
    };
  }, [focused]);
  // 聚焦时浏览器会把页面往上推（scrollIntoView）——立即滚回原位，保证界面不动，只有输入条跟键盘抬起
  const keepViewport = () => {
    const y = window.scrollY;
    const x = window.scrollX;
    requestAnimationFrame(() => window.scrollTo(x, y));
    setTimeout(() => window.scrollTo(x, y), 120);
    setTimeout(() => window.scrollTo(x, y), 320);
  };
  return (
    <>
      {/* 点击输入条以外的任何地方 → 收起输入条（透明遮罩，不改变背景观感） */}
      <button
        type="button"
        aria-label="收起输入框"
        onClick={onClose}
        data-testid="music-quick-input-backdrop"
        className="absolute inset-0 z-[39] cursor-default"
        style={{ backgroundColor: 'transparent' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-[40] flex items-center gap-2 border-t border-white/10 bg-black/45 px-4 pb-7 pt-3 backdrop-blur-2xl"
        data-testid="music-quick-input"
        style={{
          animation: 'quick-in-up 0.22s ease-out',
          transform: kb > 0 ? `translateY(-${kb}px)` : undefined,
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setFocused(true);
            keepViewport();
          }}
          onBlur={() => {
            setFocused(false);
            setKb(0); // 失焦立即归零（键盘收起后不再保留上移偏移）
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          placeholder="和 TA 聊聊这首歌…"
          data-testid="music-quick-input-field"
          className="h-9 min-w-0 flex-1 rounded-full bg-white/12 px-4 text-[13px] text-white outline-none placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!value.trim()}
          data-testid="music-quick-input-send"
          aria-label="发送"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EC4141] text-white disabled:opacity-40 active:scale-95"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起输入框"
          data-testid="music-quick-input-close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 active:scale-95"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

/** 头像下的小气泡（实色深灰，尾巴从气泡顶部指向发送者头像：对方尾巴在右上/我的尾巴在左上，最宽 165px） */
function HeadBubble({ text, mine, tail = true }: { text: string; mine: boolean; tail?: boolean }) {
  return (
    <div
      className="relative max-w-[165px] min-w-0 rounded-[16px] bg-[#5a5a5f] px-3 py-1.5"
      data-testid={mine ? 'music-tg-bubble-me' : 'music-tg-bubble-peer'}
    >
      {/* 尾巴只画在最新一条（堆顶）上：整组只保留一个指向发送者头像的尾巴 */}
      {tail && (
        <span
          className={`absolute -top-[5px] h-3 w-3 rotate-45 rounded-[3px] bg-[#5a5a5f] ${mine ? 'left-2' : 'right-2'}`}
        />
      )}
      <p className="relative break-words text-[12px] leading-snug text-white/95">{text}</p>
    </div>
  );
}

// ---------------- 一起听设置菜单（仿网易云：右上角⋮ 弹出深色菜单；无头像头部，纯五项操作） ----------------

function TogetherMenu({
  onClose,
  onRematch,
  onRecords,
  onPref,
  onReport,
  onExit,
}: {
  onClose: () => void;
  onRematch: () => void;
  onRecords: () => void;
  onPref: () => void;
  onReport: () => void;
  onExit: () => void;
}) {
  const rows = [
    { k: 'rematch', label: '重新匹配', icon: <UserRoundSearch className="h-[20px] w-[20px]" /> , on: onRematch },
    { k: 'records', label: '查看记录', icon: <ClipboardList className="h-[20px] w-[20px]" />, on: onRecords },
    { k: 'pref', label: '匹配偏好设置', icon: <SlidersHorizontal className="h-[20px] w-[20px]" />, on: onPref },
    { k: 'report', label: '举报', icon: <TriangleAlert className="h-[20px] w-[20px]" />, on: onReport },
    { k: 'exit', label: '退出一起听', icon: <LogOut className="h-[20px] w-[20px]" />, on: onExit },
  ];
  return (
    <div className="absolute inset-0 z-[62]" data-testid="music-tg-menu">
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="absolute right-4 top-[100px] w-[200px]">
        {/* 指向入口按钮的小箭头 */}
        <div className="absolute right-[22px] h-3 w-3 rotate-45 rounded-[2px] bg-zinc-800 -top-[6px]" />
        <div className="relative overflow-hidden rounded-[16px] border border-white/10 bg-zinc-900/70 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          {rows.map((r, i) => (
            <button
              key={r.k}
              type="button"
              onClick={r.on}
              data-testid={`music-tg-menu-${r.k}`}
              className={`flex w-full items-center gap-4 px-5 py-[15px] text-left text-[15px] font-medium text-white/95 active:bg-white/10 ${
                i > 0 ? 'border-t border-white/[0.07]' : ''
              }`}
            >
              {r.icon}
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 查看一起听记录 ----------------

function TgRecordSheet({
  session,
  msgs,
  onClose,
}: {
  /** 当前一起听会话；自己听（还没匹配）时为 null → 空态 */
  session: TogetherSessionLike | null;
  msgs: TogetherMsgLike[];
  onClose: () => void;
}) {
  const history = useMusic((s) => s.history);
  // 本次一起听（segStart 之后）听过的歌（去重、新在前）；时长展示用累计锚点；自己听无会话 → 空
  const segStart = session ? session.segStart ?? session.since : 0;
  const songs = useMemo(() => {
    if (!session) return [];
    const seen = new Set<number>();
    const out: NcmSong[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.playedAt >= segStart && !seen.has(h.song.id)) {
        seen.add(h.song.id);
        out.push(h.song);
      }
    }
    return out;
  }, [history, segStart, session]);
  const durText = session ? fmtTogetherDur(Date.now() - session.since) : '';
  const chatCount = msgs.filter((m) => m.role !== 'recs').length;
  return (
    <div className="absolute inset-0 z-[63] flex items-end" data-testid="music-tg-record">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[68%] w-full flex-col rounded-t-2xl border-t border-white/10 bg-zinc-900/70 backdrop-blur-2xl">
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="text-[15px] font-bold text-white">一起听记录</p>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5 text-white/60" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {session ? (
            <>
              <div className="flex items-center gap-3 px-5 py-2">
                <CoverImg src={session.avatar} className="h-11 w-11" rounded="rounded-full" alt={session.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-white/95">和 {session.name} 一起听</p>
                  <p className="text-[11px] text-white/45">
                    已一起听 {durText} · 聊了 {chatCount} 条消息
                  </p>
                </div>
              </div>
              <p className="px-5 pb-1 pt-3 text-[12px] text-white/40">这次一起听过的歌（{songs.length}）</p>
              {songs.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-white/40">还没一起听过歌</p>
              ) : (
                songs.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-2">
                    <CoverImg src={songCover(s)} className="h-10 w-10" rounded="rounded-md" alt={s.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-white/90">{s.name}</p>
                      <p className="truncate text-[11px] text-white/40">{songArtistText(s)}</p>
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center" data-testid="music-tg-record-empty">
              <p className="text-[14px] text-white/85">还没有一起听的记录</p>
              <p className="text-[11px] leading-relaxed text-white/45">
                邀请好友一起听后，听过的歌和聊天都会记在这里
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 更多面板（仿网易云歌曲操作面板） ----------------

/** 关注/取关歌手（真实接口；状态写 music-store.followedArtists，
 *  设置弹窗/一起听聊天胶囊同步显示「关注/已关注」；游客态提示需登录） */
async function toggleArtistFollow(
  artistId: number,
  artistName: string,
  onToast: (m: string) => void,
): Promise<void> {
  const on = useMusic.getState().followedArtists[artistId] ?? false;
  try {
    await artistSub(artistId, on ? 2 : 1);
    useMusic.getState().setArtistFollowed(artistId, !on);
    onToast(on ? `已取消关注 ${artistName}` : `已关注 ${artistName}`);
  } catch {
    onToast('登录网易云账号后才能关注歌手');
  }
}

/** 关注歌手胶囊（一起听聊天视图歌名行）：读 store 关注状态，点击关注/取关 */
function FollowPill({ song, onToast }: { song: NcmSong; onToast: (m: string) => void }) {
  const artist = song.artists?.[0];
  const followed = useMusic((s) => (artist ? (s.followedArtists[artist.id] ?? false) : false));
  return (
    <button
      type="button"
      data-testid="music-tg-chat-follow"
      onClick={() => {
        if (artist) void toggleArtistFollow(artist.id, artist.name, onToast);
      }}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/12 px-2.5 py-[3px] text-[11px] leading-none active:scale-95"
      style={{ color: followed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)' }}
    >
      {followed ? (
        <>
          <Check className="h-3 w-3" />
          已关注
        </>
      ) : (
        '关注'
      )}
    </button>
  );
}

function MoreSheet({
  song,
  liked,
  tg,
  onClose,
  onToast,
  onInvite,
}: {
  song: NcmSong;
  liked: boolean;
  /** 在一起听时「正在一起听」格子显示双方真实头像 */
  tg?: { peer: string; mine: string } | null;
  onClose: () => void;
  onToast: (m: string) => void;
  onInvite: () => void;
}) {
  const openComments = useMusic((s) => s.openComments);
  const toggleLike = useMusic((s) => s.toggleLike);
  const playSong = useMusic((s) => s.playSong);
  // 音质/定时关闭（store 持久化，第十五轮反馈完善；第二十八轮：3D 环绕开关已整体移除）
  const quality = useMusic((s) => s.quality);
  const setQuality = useMusic((s) => s.setQuality);
  const sleepAt = useMusic((s) => s.sleepAt);
  const setSleepAt = useMusic((s) => s.setSleepAt);
  // 全局迷你播放器形态（第十六轮反馈；第二十一轮：隐藏形态移除，唱片可滑入屏幕边缘只露边框）
  const miniMode = useMiniPlayer((s) => s.mode);
  const miniCycle = useMiniPlayer((s) => s.cycle);
  const [showAdd, setShowAdd] = useState(false);
  const [showShareChat, setShowShareChat] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [cmtTotal, setCmtTotal] = useState<number | null>(null);

  // 评论数（真实接口，只取总数）
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const p = await commentsOf(song.id, 1, 0);
        if (on) setCmtTotal(p.total);
      } catch {
        // 数量获取失败不影响面板
      }
    })();
    return () => {
      on = false;
    };
  }, [song.id]);

  // 关注状态与服务端对齐（第十九轮反馈：打开面板时拉一次已关注歌手列表，
  // 关注过的歌手显示「已关注」；游客/接口失败时保持本地缓存状态）
  useEffect(() => {
    const artist = song.artists?.[0];
    if (!artist) return;
    let on = true;
    void (async () => {
      try {
        const list = await artistSublist();
        if (!on) return;
        useMusic.getState().setArtistFollowed(artist.id, list.some((a) => a.id === artist.id));
      } catch {
        // 未登录/接口失败：保持本地缓存状态
      }
    })();
    return () => {
      on = false;
    };
  }, [song.id]);

  const download = async () => {
    try {
      const { songUrl } = await import('@/lib/ios/music-api');
      const { mediaProxyUrl } = await import('@/lib/ios/music-store');
      const r = await songUrl(song.id);
      if (!r.url) throw new Error('no url');
      const a = document.createElement('a');
      a.href = mediaProxyUrl(r.url);
      a.download = `${song.name} - ${songArtistText(song)}.mp3`;
      a.target = '_blank';
      a.click();
      onToast('已开始下载');
    } catch {
      onToast('下载失败（可能需要 VIP）');
    }
  };

  // 关注/取关歌手（真实接口；点击已关注 = 取关，状态写 store 供各界面同步）
  const artist0 = song.artists?.[0];
  const followed = useMusic((s) => (artist0 ? (s.followedArtists[artist0.id] ?? false) : false));
  const followArtist = async () => {
    if (!artist0) return;
    void toggleArtistFollow(artist0.id, artist0.name, onToast);
  };

  // 相似歌曲漫游：以当前歌的相似歌开播
  const roam = async () => {
    try {
      const list = await simiSong(song.id, 20);
      if (!list.length) {
        onToast('暂时没有找到相似歌曲');
        return;
      }
      onClose();
      void playSong(list[0], list);
      onToast('已开始相似歌曲漫游');
    } catch {
      onToast('漫游启动失败，稍后再试');
    }
  };

  const artistName = songArtistText(song);

  return (
    <div className="absolute inset-0 z-[66] flex items-end" data-testid="music-player-more-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative flex max-h-[82%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 pb-6 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {/* 歌曲信息 + 为TA心动 */}
          <div className="flex items-center gap-3 px-5 pt-4">
            <CoverImg src={songCover(song)} className="h-12 w-12 shrink-0" rounded="rounded-lg" alt={song.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-[16px] font-bold text-zinc-900 dark:text-zinc-100">{song.name}</p>
                {song.fee === 1 && (
                  <span className="shrink-0 rounded-[3px] border border-[#EC4141]/50 px-1 text-[9px] leading-[14px] text-[#EC4141]">
                    VIP
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[12px] text-zinc-400">{artistName}</p>
            </div>
            <button
              type="button"
              onClick={() => void toggleLike(song)}
              data-testid="music-more-heart"
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] active:scale-95 ${
                liked
                  ? 'border-[#EC4141]/40 text-[#EC4141]'
                  : 'border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200'
              }`}
            >
              <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} />
              {liked ? '已心动' : '为TA心动'}
            </button>
          </div>

          <div className="mx-5 mt-4 border-t border-black/5 dark:border-white/10" />

          {/* 收藏 / 下载 / 分享 / 正在一起听 */}
          <div className="grid grid-cols-4 gap-y-2 px-3 py-4">
            {[
              {
                k: 'collect',
                label: '收藏',
                icon: <FolderPlus className="h-[22px] w-[22px]" />,
                on: () => setShowAdd(true),
              },
              {
                k: 'download',
                label: '下载',
                icon: (
                  <span className="relative">
                    <Download className="h-[22px] w-[22px]" />
                    <span className="absolute -bottom-1.5 -right-2.5 rounded-full bg-zinc-800 px-[3px] text-[7px] font-bold leading-[10px] text-[#F0D9A6] dark:bg-zinc-600">
                      VIP
                    </span>
                  </span>
                ),
                on: () => void download(),
              },
              {
                k: 'share',
                label: '分享',
                icon: <Forward className="h-[22px] w-[22px]" />,
                // 分享 = 把这首歌发给联系人（两步：先选微信/QQ → 再选联系人，Task 68 歌曲卡片链路）
                on: () => setShowShareChat(true),
              },
              {
                k: 'together',
                label: '正在一起听',
                icon: tg ? (
                  // 在一起听：显示双方真实头像（交叠，仿网易云）
                  <span className="flex items-center" data-testid="music-more-tg-avatars">
                    <CoverImg src={tg.peer} className="h-[26px] w-[26px]" rounded="rounded-full" alt="TA" />
                    <CoverImg
                      src={tg.mine}
                      className="relative -ml-2 h-[26px] w-[26px] ring-2 ring-white dark:ring-zinc-900"
                      rounded="rounded-full"
                      alt="我"
                    />
                  </span>
                ) : (
                  <span className="relative flex h-[22px] w-[32px] items-center justify-center">
                    <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-zinc-300 ring-2 ring-white dark:bg-zinc-600 dark:ring-zinc-900">
                      <UserRound className="h-2.5 w-2.5 text-white dark:text-zinc-300" fill="currentColor" />
                    </span>
                    <span className="-ml-1.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-zinc-800 ring-2 ring-white dark:bg-zinc-300 dark:ring-zinc-900">
                      <UserRound className="h-2.5 w-2.5 text-zinc-600" fill="currentColor" />
                    </span>
                  </span>
                ),
                on: onInvite,
              },
            ].map((it) => (
              <button
                key={it.k}
                type="button"
                onClick={it.on}
                data-testid={`music-more-${it.k}`}
                className="flex flex-col items-center gap-1.5 text-zinc-700 active:scale-95 dark:text-zinc-200"
              >
                {it.icon}
                <span className="text-[11px]">{it.label}</span>
              </button>
            ))}
          </div>

          {/* 信息与功能行 */}
          <div className="px-5">
            <MoreRow
              icon={<MessageCircle className="h-[19px] w-[19px]" />}
              testid="music-more-comment"
              onClick={() => {
                onClose();
                openComments(song);
              }}
            >
              {cmtTotal === null ? '评论' : `评论(${cmtTotal})`}
            </MoreRow>
            {song.album?.name && (
              <MoreRow icon={<DiscAlbum className="h-[19px] w-[19px]" />}>专辑：{song.album.name}</MoreRow>
            )}
            <MoreRow
              icon={<MicVocal className="h-[19px] w-[19px]" />}
              testid="music-more-follow"
              onClick={() => void followArtist()}
            >
              <span className="inline-flex items-center gap-2">
                歌手：{artistName}
                {followed ? (
                  <span
                    data-testid="music-more-follow-state"
                    className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.06] px-2 py-[3px] text-[10px] font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-400"
                  >
                    <Check className="h-3 w-3" />
                    已关注
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-[#EC4141] px-2 py-[3px] text-[10px] font-medium text-white">
                    <Plus className="h-3 w-3" />
                    关注
                  </span>
                )}
              </span>
            </MoreRow>
            <MoreRow icon={<Info className="h-[19px] w-[19px]" />} testid="music-more-info" onClick={() => setShowInfo(true)}>
              查看歌曲百科
            </MoreRow>
            <MoreRow icon={<Radio className="h-[19px] w-[19px]" />} testid="music-more-roam" onClick={() => void roam()}>
              开始相似歌曲漫游
            </MoreRow>
            <MoreRow icon={<ShoppingCart className="h-[19px] w-[19px]" />} onClick={() => onToast('演示环境暂不支持单曲购买')}>
              单曲购买
            </MoreRow>
          </div>

          <div className="mx-5 mt-2 border-t border-black/5 dark:border-white/10" />

          <div className="px-5">
            <MoreRow
              icon={<Disc3 className="h-[19px] w-[19px]" />}
              testid="music-more-quality"
              onClick={() => {
                // 音质真实生效（第十五轮反馈）：写 store 持久化，下一次起播传给 songUrl level
                const nx = QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length];
                setQuality(nx);
                onToast(`音质已设为${QUALITY_LABELS[nx]}，从下一首起生效`);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                音质：{QUALITY_LABELS[quality]}
                <VipBadge type="vip" level={0} />
              </span>
            </MoreRow>
            <MoreRow
              icon={<AlarmClock className="h-[19px] w-[19px]" />}
              testid="music-more-sleep"
              onClick={() => setShowSleep(true)}
            >
              定时关闭{sleepAt ? `（剩 ${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))} 分钟）` : ''}
            </MoreRow>
            <MoreRow
              icon={<Disc2 className="h-[19px] w-[19px]" />}
              testid="music-more-style"
              onClick={() => setShowStyle(true)}
            >
              播放器样式
            </MoreRow>
            <MoreRow
              icon={<ListMusic className="h-[19px] w-[19px]" />}
              testid="music-more-mini"
              onClick={() => {
                const nx = miniCycle();
                onToast(`迷你播放器：${MINI_MODE_LABELS[nx]}`);
              }}
            >
              迷你播放器：{MINI_MODE_LABELS[miniMode]}
            </MoreRow>
          </div>
        </div>

        {/* 收藏到歌单（复用全局组件） */}
        {showAdd && <AddToSongSheet song={song} onClose={() => setShowAdd(false)} />}
        {/* 分享给好友（歌曲卡片进聊天，Task 68） */}
        {showShareChat && <ShareToChatSheet song={song} onClose={() => setShowShareChat(false)} onToast={onToast} />}
        {/* 播放器样式（含手机上传听歌背景图，第十五轮反馈） */}
        {showStyle && <PlayerStyleSheet onClose={() => setShowStyle(false)} onToast={onToast} />}
        {/* 歌曲百科（真实歌曲信息） */}
        {showInfo && <SongInfoSheet song={song} onClose={() => setShowInfo(false)} />}
        {/* 定时关闭（到点真实自动暂停） */}
        {showSleep && <SleepSheet onClose={() => setShowSleep(false)} onToast={onToast} />}
      </div>
    </div>
  );
}

// ---------------- 播放器样式 / 歌曲百科 / 定时关闭（第十五轮反馈完善设置弹窗） ----------------

/** 从手机相册选图 → 等比压到宽 ≤1280px → JPEG dataURL（cover 裁剪交给 CSS） */
function compressPlayerBg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const maxW = 1280;
        const scale = Math.min(1, maxW / Math.max(1, img.width));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}

/** 播放器样式面板：版式三选（经典黑胶/全屏封面/唱片封面，第三十四轮）+ 默认封面模糊背景 / 从手机上传听歌界面背景图 / 恢复默认（按网易云账号持久化） */
function PlayerStyleSheet({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const playerBg = useMusic((s) => s.playerBg);
  const setPlayerBg = useMusic((s) => s.setPlayerBg);
  // 播放器版式（第三十四轮）：经典黑胶 / 全屏封面 / 唱片封面
  const playerStyle = useMusic((s) => s.playerStyle);
  const setPlayerStyle = useMusic((s) => s.setPlayerStyle);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const STYLE_ROWS: { key: PlayerStyle; label: string; desc: string; testid: string; icon: ReactNode }[] = [
    {
      key: 'vinyl',
      label: '经典黑胶',
      desc: '旋转唱片 · 中心小封面',
      testid: 'music-style-vinyl',
      icon: <Disc2 className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />,
    },
    {
      key: 'coverFull',
      label: '全屏封面',
      desc: '大幅圆角方形封面铺满听歌界面',
      testid: 'music-style-cover-full',
      icon: <ImageIcon className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />,
    },
    {
      key: 'discCover',
      label: '唱片封面',
      desc: '整张封面作旋转唱片面（图纹唱片）',
      testid: 'music-style-disc-cover',
      icon: <Disc3 className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />,
    },
  ];

  const pick = async (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      onToast('请选择图片文件');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compressPlayerBg(f);
      setPlayerBg(dataUrl);
      onToast('已应用自定义背景');
      onClose();
    } catch {
      onToast('图片处理失败，请换一张试试');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 z-[70] flex items-end" data-testid="music-player-style-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 pb-7 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <p className="mt-3 text-center text-[15px] font-bold text-zinc-900 dark:text-zinc-100">播放器样式</p>
        <div className="mt-2 px-3">
          {/* 版式（第三十四轮）：经典黑胶 / 全屏封面 / 唱片封面 */}
          <p className="px-3.5 pb-1 pt-1.5 text-[11px] font-medium text-zinc-400">版式</p>
          {STYLE_ROWS.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                setPlayerStyle(row.key);
                onToast(`播放器版式：${row.label}`);
                onClose();
              }}
              data-testid={row.testid}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left text-[14px] text-zinc-800 active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-800"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{row.label}</span>
                <span className="block text-[11px] text-zinc-400">{row.desc}</span>
              </span>
              {playerStyle === row.key && <Check className="h-[18px] w-[18px] shrink-0 text-[#EC4141]" />}
            </button>
          ))}
          {/* 背景（第十五轮）：默认封面模糊 / 上传自定义图 */}
          <p className="px-3.5 pb-1 pt-2 text-[11px] font-medium text-zinc-400">背景</p>
          <button
            type="button"
            onClick={() => {
              setPlayerBg('');
              onToast('已恢复默认封面背景');
              onClose();
            }}
            data-testid="music-style-default"
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left text-[14px] text-zinc-800 active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-800"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Disc2 className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">默认背景</span>
              <span className="block text-[11px] text-zinc-400">封面模糊背景（各版式通用）</span>
            </span>
            {!playerBg && <Check className="h-[18px] w-[18px] shrink-0 text-[#EC4141]" />}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            data-testid="music-style-upload"
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left text-[14px] text-zinc-800 active:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:active:bg-zinc-800"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin text-zinc-500" /> : <ImageUp className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">从手机上传听歌背景图</span>
              <span className="block text-[11px] text-zinc-400">选一张相册图片作为听歌界面背景</span>
            </span>
            {playerBg && !busy && (
              <span className="flex shrink-0 items-center gap-1.5">
                <img src={playerBg} alt="当前背景" className="h-8 w-8 rounded-md object-cover" />
                <Check className="h-[18px] w-[18px] text-[#EC4141]" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
        <p className="px-6 pt-2 text-center text-[11px] leading-relaxed text-zinc-400">
          上传后立即生效，按网易云账号分别保存
        </p>
      </div>
    </div>
  );
}

/** 歌曲百科：当前歌曲的真实信息（歌手/专辑/时长/热度/音质/ID） */
function SongInfoSheet({ song, onClose }: { song: NcmSong; onClose: () => void }) {
  const duration = useMusic((s) => s.duration);
  const quality = useMusic((s) => s.quality);
  const durSec = duration > 0 ? duration : (song.duration ?? song.dt ?? 0) / 1000;
  const rows: [string, string][] = [
    ['歌手', songArtistText(song)],
    ...(song.album?.name ? ([['专辑', song.album.name]] as [string, string][]) : []),
    ['时长', fmtClock(durSec)],
    ['热度', `${fmtCountW(fakeHotCount(song.id))} 次播放`],
    ['音质', `${QUALITY_LABELS[quality]}${song.fee === 1 ? '（VIP 歌曲可能只播试听片段）' : ''}`],
    ['歌曲 ID', String(song.id)],
  ];
  return (
    <div className="absolute inset-0 z-[70] flex items-end" data-testid="music-player-info-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 pb-7 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <p className="mt-3 text-center text-[15px] font-bold text-zinc-900 dark:text-zinc-100">歌曲百科</p>
        <div className="flex items-center gap-3 px-5 pt-4">
          <CoverImg src={songCover(song)} className="h-14 w-14 shrink-0" rounded="rounded-lg" alt={song.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold text-zinc-900 dark:text-zinc-100">{song.name}</p>
            <p className="mt-0.5 truncate text-[12px] text-zinc-400">{songArtistText(song)}</p>
          </div>
          {song.fee === 1 && (
            <span className="shrink-0 rounded-[3px] border border-[#EC4141]/50 px-1 text-[9px] leading-[14px] text-[#EC4141]">
              VIP
            </span>
          )}
        </div>
        <div className="mt-3 space-y-2.5 px-6">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start gap-3 text-[13px]">
              <span className="w-14 shrink-0 text-zinc-400">{k}</span>
              <span className="min-w-0 flex-1 break-words text-zinc-800 dark:text-zinc-200">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 定时关闭：到点真实自动暂停播放（会话级） */
function SleepSheet({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const sleepAt = useMusic((s) => s.sleepAt);
  const setSleepAt = useMusic((s) => s.setSleepAt);
  const options = [15, 30, 60, 90];
  const pick = (min: number | null) => {
    setSleepAt(min);
    onToast(min ? `将在 ${min} 分钟后自动暂停播放` : '已取消定时关闭');
    onClose();
  };
  return (
    <div className="absolute inset-0 z-[70] flex items-end" data-testid="music-player-sleep-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 pb-7 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <p className="mt-3 text-center text-[15px] font-bold text-zinc-900 dark:text-zinc-100">定时关闭</p>
        <div className="mt-2 px-3">
          {sleepAt && (
            <button
              type="button"
              onClick={() => pick(null)}
              data-testid="music-sleep-cancel"
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-3 text-left text-[14px] text-[#EC4141] active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <span className="inline-flex items-center gap-3">
                <X className="h-[16px] w-[16px]" />
                取消定时
              </span>
              <span className="text-[12px] tabular-nums text-zinc-400">
                剩 {Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))} 分钟
              </span>
            </button>
          )}
          {options.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              data-testid={`music-sleep-${m}`}
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-3 text-left text-[14px] text-zinc-800 active:bg-zinc-100 dark:text-zinc-200 dark:active:bg-zinc-800"
            >
              <span className="inline-flex items-center gap-3">
                <AlarmClock className="h-[16px] w-[16px] text-zinc-400" />
                {m} 分钟后暂停
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 分享给好友（Task 68 引入，第十三轮反馈改两步流程）：把当前歌曲以「歌曲卡片」消息写进微信/QQ 的私聊记录（role=me），
 * 用户切回聊天 App 就能看到可点击播放的卡片；同时给角色写一条分享记忆（AI 能接住话题）。
 * 流程 = 先选分享到微信还是 QQ → 再选该 App 里的联系人发送；发完打勾可继续选其他人，左上角返回可换 App。
 */
function ShareToChatSheet({
  song,
  onClose,
  onToast,
}: {
  song: NcmSong;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [chars, setChars] = useState<ContactRecord[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // 两步流程：step='app' 选微信/QQ；step='contact' 选该 App 下的联系人
  const [step, setStep] = useState<'app' | 'contact'>('app');
  const [app, setApp] = useState<'wx' | 'qq'>('wx');
  const appLabel = app === 'wx' ? '微信' : 'QQ';
  const appColor = app === 'wx' ? '#07C160' : '#12B7F5';

  useEffect(() => {
    let on = true;
    void listTogetherCandidates()
      .then((cs) => {
        if (on) setChars(cs);
      })
      .catch(() => {})
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, []);

  const send = (target: 'wx' | 'qq', c: ContactRecord) => {
    const artist = songArtistText(song);
    const cover = songCover(song) || undefined;
    const msg = {
      id: `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'me' as const,
      content: `[歌曲]《${song.name}》${artist}`,
      time: Date.now(),
      kind: 'song' as const,
      song: { name: song.name, artist, cover, songId: song.id },
    };
    const key = target === 'wx' ? `wx-chat-msgs:${c.id}` : `qq-chat-msgs:${c.id}`;
    try {
      const cur = kvGet<unknown[]>(key) ?? [];
      kvSet(key, [...cur, msg]); // 聊天记录不封顶（用户反馈：以前截到 100 条会把旧记录挤丢）
    } catch {
      onToast('分享失败，稍后再试');
      return;
    }
    try {
      memAddEventFragment(c.id, target, `机主分享了一首《${song.name}》（${artist}）给你`, {
        eventTime: Date.now(),
        sourceTag: 'music-share',
      });
    } catch {
      // 记忆失败不影响分享
    }
    setSent((prev) => new Set(prev).add(`${target}:${c.id}`));
    onToast(`已把《${song.name}》分享给${c.nickname || c.name}（${target === 'wx' ? '微信' : 'QQ'}）`);
  };

  return (
    <div className="absolute inset-0 z-[72] flex items-end" data-testid="music-share-chat-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative flex max-h-[70%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 pb-6 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />

        {step === 'app' ? (
          <>
            {/* 第一步：选择分享到微信还是 QQ */}
            <div className="flex items-center justify-between px-5 pt-3">
              <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">分享给好友</p>
              <button type="button" aria-label="关闭" onClick={onClose} className="text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-1 text-[12px] text-zinc-400">
              《{song.name}》 {songArtistText(song)} · 以歌曲卡片发进聊天
            </p>
            <p className="px-5 pb-1 pt-4 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">选择分享到的 App</p>
            <div className="px-3 pb-2">
              <button
                type="button"
                data-testid="music-share-app-wx"
                onClick={() => {
                  setApp('wx');
                  setStep('contact');
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#07C160] text-white">
                  <MessageCircle className="h-6 w-6" fill="currentColor" strokeWidth={0} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-zinc-800 dark:text-zinc-200">微信</span>
                  <span className="block text-[11px] text-zinc-400">发给微信好友</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 dark:text-zinc-600" />
              </button>
              <button
                type="button"
                data-testid="music-share-app-qq"
                onClick={() => {
                  setApp('qq');
                  setStep('contact');
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#12B7F5] text-white">
                  <span className="text-[15px] font-bold leading-none">QQ</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-zinc-800 dark:text-zinc-200">QQ</span>
                  <span className="block text-[11px] text-zinc-400">发给 QQ 好友</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 dark:text-zinc-600" />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 第二步：选择该 App 下的联系人发送 */}
            <div className="flex items-center gap-1.5 px-3 pt-3">
              <button
                type="button"
                aria-label="返回选择 App"
                data-testid="music-share-back"
                onClick={() => setStep('app')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-black/5 dark:active:bg-white/10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-zinc-900 dark:text-zinc-100">
                分享到{appLabel}
              </p>
              <button type="button" aria-label="关闭" onClick={onClose} className="shrink-0 text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="px-5 pt-1 text-[12px] text-zinc-400">
              《{song.name}》 · 点击好友即发送歌曲卡片
            </p>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto no-scrollbar px-2 pb-2">
              {loading ? (
                <p className="py-8 text-center text-[13px] text-zinc-400">加载中…</p>
              ) : chars.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-zinc-400">还没有可以分享的 AI 好友</p>
              ) : (
                chars.map((c) => {
                  const done = sent.has(`${app}:${c.id}`);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`music-share-${app}-${c.id}`}
                      onClick={() => send(app, c)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-black/5 dark:active:bg-white/10"
                    >
                      <CoverImg
                        src={c.avatar || ''}
                        className="h-10 w-10 shrink-0"
                        rounded="rounded-full"
                        alt={c.nickname || c.name}
                      />
                      <p className="min-w-0 flex-1 truncate text-[14px] text-zinc-800 dark:text-zinc-200">
                        {c.nickname || c.name}
                      </p>
                      {done ? (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1.5 text-[12px] text-zinc-400 dark:bg-zinc-800">
                          <Check className="h-3.5 w-3.5" />
                          已分享
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-white active:scale-95"
                          style={{ backgroundColor: appColor }}
                        >
                          发送
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 更多面板列表行（左侧图标 + 文案；无 onClick 时纯展示） */
function MoreRow({
  icon,
  children,
  onClick,
  testid,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      disabled={!onClick}
      className={`flex w-full items-center gap-4 py-[13px] text-left ${
        onClick ? 'active:bg-black/5 dark:active:bg-white/10' : 'cursor-default'
      }`}
    >
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-zinc-800 dark:text-zinc-200">{children}</span>
    </button>
  );
}

// ---------------- 播放列表 ----------------

function QueueSheet({ onClose }: { onClose: () => void }) {
  const queue = useMusic((s) => s.queue);
  const qIndex = useMusic((s) => s.qIndex);
  const playQueueAt = useMusic((s) => s.playQueueAt);
  const removeFromQueue = useMusic((s) => s.removeFromQueue);
  const clearQueue = useMusic((s) => s.clearQueue);
  return (
    <div className="absolute inset-0 z-[66] flex items-end" data-testid="music-queue-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[65%] w-full flex-col rounded-t-2xl border-t border-white/10 bg-zinc-900/70 backdrop-blur-2xl">
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="text-[14px] font-bold text-white">
            当前播放 <span className="text-[11px] font-normal text-white/40">({queue.length})</span>
          </p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={clearQueue} className="text-[12px] text-white/50">
              清空
            </button>
            <button type="button" onClick={onClose} aria-label="关闭">
              <X className="h-5 w-5 text-white/60" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {queue.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-white/40">队列是空的</p>
          ) : (
            queue.map((s, i) => (
              <div
                key={`${s.id}-${i}`}
                className={`flex items-center gap-3 px-5 py-2 ${i === qIndex ? 'bg-white/5' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    void playQueueAt(i);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CoverImg src={songCover(s)} className="h-9 w-9" rounded="rounded-md" alt={s.name} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] ${i === qIndex ? 'text-[#EC4141]' : 'text-white/90'}`}>
                      {s.name}
                    </p>
                    <p className="truncate text-[11px] text-white/40">{songArtistText(s)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => removeFromQueue(i)}
                  aria-label="移除"
                  className="shrink-0 p-1 text-white/30 active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 邀请一起听 ----------------

function InviteSheet({
  title = '邀请一起听',
  onClose,
  onInvited,
}: {
  title?: string;
  onClose: () => void;
  /** 邀请卡已发出（第二十四轮：邀请也走聊天卡片 + AI 接受后双方同意卡） */
  onInvited?: (name: string) => void;
}) {
  const [list, setList] = useState<ContactRecord[] | null>(null);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setList(await listTogetherCandidates());
      } catch {
        setList([]);
      }
    })();
  }, []);

  const invite = (cid: string) => {
    setBusyId(cid);
    void (async () => {
      const candidates = (await listTogetherCandidates()) ?? [];
      const c = candidates.find((x) => x.id === cid);
      if (c) {
        const song = useMusic.getState().current;
        if (song) {
          // 第二十四轮：我邀请也发「邀请你一起听」卡片 → AI 接受后双方各发同意卡 → 建会话
          const app = await lastChatAppOf(c.id);
          sendUserTogetherInvite({
            contact: c,
            app,
            song: { id: song.id, name: song.name, artist: songArtistText(song), cover: songCover(song) || undefined },
          });
          onInvited?.(c.nickname || c.name);
        } else {
          startTogether(c); // 无在播歌时退回直接开始
        }
      }
      onClose();
    })();
  };

  return (
    <div className="absolute inset-0 z-[67] flex items-end" data-testid="music-invite-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[70%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
            <p className="text-[11px] text-zinc-400">选一位 AI 好友，和 TA 实时听歌聊天</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {list === null ? (
            <LoadingInline />
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-zinc-400">还没有 AI 角色，先去微信/QQ 创建一个</p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => invite(c.id)}
                disabled={!!busyId}
                data-testid={`music-invite-${c.id}`}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left active:bg-black/5 disabled:opacity-50 dark:active:bg-white/10"
              >
                <CoverImg src={c.avatar ?? undefined} className="h-11 w-11" rounded="rounded-full" alt={c.nickname || c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{c.nickname || c.name}</p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {c.relation || '好友'} {c.region ? `· ${c.region}` : ''}
                  </p>
                </div>
                {busyId === c.id && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingInline() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

// AI 推荐入口（聊天视图里用，这里 re-export 保持依赖单向）
export { togetherRecommend };
