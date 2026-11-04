'use client';

/**
 * 音乐 App「我的」页 —— 1:1 对标网易云 App「我的」：
 * - 深色渐变头部：菜单(≡)/添加状态/新建(+)/分享(⋮)、大圆头像（游客可从手机上传）、
 *   昵称 + 听歌徽章 + VIP 徽章、签名、状态胶囊、统计行（关注/粉丝/等级/听歌）、
 *   最近 / 本地 / 收藏 / 装扮 / 更多 胶囊入口（装扮 = 换头部主题色）
 * - 白色圆角面板：音乐 / 播客 / 笔记 主 Tab，近期 / 创建 子 Tab，
 *   歌单行（我喜欢的音乐心形块、听歌排行图表块+图钉、创建与收藏的歌单）
 * - 登录态数据来自云端（user/detail + user/playlist）；游客态本地可编辑（签名/关注/粉丝/歌单）
 */

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  BarChart2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Heart,
  ImagePlus,
  LayoutGrid,
  ListMusic,
  Loader2,
  Lock,
  Menu,
  MoreVertical,
  NotebookPen,
  Pin,
  Play,
  Plus,
  Podcast,
  RotateCcw,
  Shirt,
  Smile,
  Star,
  X,
} from 'lucide-react';
import {
  djHot,
  musicUid,
  playlistDelete,
  userDetail,
  userPlaylists,
  vipInfo,
  type NcmDjRadio,
  type NcmPlaylist,
  type NcmSong,
  type NcmUserDetail,
  type VipInfo,
} from '@/lib/ios/music-api';
import {
  useMusic,
  getGuestProfile,
  getGuestAvatar,
  setGuestProfile,
  getLoginAvatarPref,
  setLoginAvatarLocal,
  setLoginAvatarFollowNcm,
  GUEST_DEFAULT_AVATAR,
  GUEST_AVATAR_PRESETS,
  guestPlaylistCreate,
  guestPlaylistDelete,
  getGuestPlaylists,
  type GuestPlaylist,
} from '@/lib/ios/music-store';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { useSettings } from '@/lib/ios/store';
import { CoverImg, LoadingBlock, PlaylistCreateDialog, fmtPlayCount } from './music-shared';
// v59：VIP 徽章抽到 music-vip-badge.tsx 共享（评论区/歌单/弹窗全 App 统一「我的」页同款黑胶唱片胶囊）
import { VipBadge } from './music-vip-badge';

type SheetKind = 'recent' | 'record' | 'liked' | 'local' | 'dress' | 'profile' | null;
type MainTab = 'music' | 'podcast' | 'notes';
type SubTab = 'recent' | 'created';

/** 头部主题（装扮） */
const MINE_THEMES = [
  { name: '曜石黑', from: '#85858c', via: '#414147', to: '#1f1f24' },
  { name: '绯红夜', from: '#9a5a60', via: '#5e2f35', to: '#2a161b' },
  { name: '松涛绿', from: '#5f7f6f', via: '#31493e', to: '#182620' },
  { name: '暖棕调', from: '#96795c', via: '#5c4530', to: '#2b2014' },
];

const statusKeyOf = (scope: string) => `music-mine-status:${scope}`;
const dressKeyOf = (scope: string) => `music-mine-dress:${scope}`;
const dressImgKeyOf = (scope: string) => `music-mine-dress-img:${scope}`;

/** 状态文本是否以表情/符号图标开头（🎧/🌙/💻…）——是则状态胶囊里不再叠笑脸图标 */
function statusStartsWithPict(s: string): boolean {
  if (!s) return false;
  const cp = s.codePointAt(0) ?? 0;
  return (
    cp >= 0x1f000 || // emoji 主区
    (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号/丁贝符
    (cp >= 0x2b00 && cp <= 0x2bff) || // 箭头等符号
    (cp >= 0x2190 && cp <= 0x21ff) || // 箭头
    (cp >= 0xfe00 && cp <= 0xfe0f) || // 变体选择符
    cp === 0x200d
  ); // 零宽连接符
}

/** 从手机选择图片 → 居中裁方 → 压缩为 288px JPEG dataURL（存 IndexedDB 体积可控） */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const S = 288;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const ctx = c.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 不可用'));
          return;
        }
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, S, S);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function MusicMine({ onSettings }: { onSettings: () => void }) {
  const loginUid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const likedIds = useMusic((s) => s.likedIds);
  const listenSec = useMusic((s) => s.listenSec);
  const openPlaylist = useMusic((s) => s.openPlaylist);
  const guestTick = useMusic((s) => s.guestMode); // 游客态切换时重渲染

  const scope = loginUid ? `u${loginUid}` : 'guest';

  const [detail, setDetail] = useState<NcmUserDetail | null>(null);
  const [playlists, setPlaylists] = useState<NcmPlaylist[] | null>(null);
  const [guestLists, setGuestLists] = useState<GuestPlaylist[]>([]);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [mainTab, setMainTab] = useState<MainTab>('music');
  const [subTab, setSubTab] = useState<SubTab>('recent');
  const [statusText, setStatusText] = useState<string>(() => kvGetStr(statusKeyOf(scope)));
  const [themeIdx, setThemeIdx] = useState<number>(() => kvGetIdx(dressKeyOf(scope)));
  const [dressImg, setDressImg] = useState<string>(() => kvGetStr(dressImgKeyOf(scope)));
  // 资料版本号：游客保存资料后 +1 强制重渲染（确保关注/粉丝/头像等立即刷新）
  const [profRev, setProfRev] = useState(0);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  // 添加状态弹窗 / 新建歌单弹窗 / 听歌排行全屏页
  const [statusOpen, setStatusOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  // 登录账号真实 VIP（VIP 是几显示几）
  const [loginVip, setLoginVip] = useState<VipInfo | null>(null);
  // Task 21：登录账号头像来源选择弹层（从手机上传 / 跟随网易云账号）
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 1500);
  };

  const refreshGuest = () => setGuestLists(getGuestPlaylists());

  // 数据加载：登录 = 云端；游客 = 本地 + 红心
  useEffect(() => {
    if (!loginUid) {
      refreshGuest();
      void useMusic.getState().initLiked();
      return;
    }
    void (async () => {
      const d = await userDetail(loginUid);
      setDetail(d);
      // Task 21 头像跟随：跟随模式下用刚拉到的最新网易云头像同步全局 store
      // （播放器/一起听头部等直接读 store 的 loginAvatar，这样真实账号换头像后全 App 同步）
      const fresh = d?.profile?.avatarUrl || '';
      if (fresh && getLoginAvatarPref().mode === 'ncm' && useMusic.getState().loginAvatar !== fresh) {
        useMusic.setState({ loginAvatar: fresh });
      }
    })();
    void (async () => {
      try {
        setPlaylists(await userPlaylists(loginUid));
      } catch {
        setPlaylists([]);
      }
    })();
  }, [loginUid, guestTick]);

  // 切换账号/游客时重读装扮与状态
  useEffect(() => {
    setStatusText(kvGetStr(statusKeyOf(scope)));
    setThemeIdx(kvGetIdx(dressKeyOf(scope)));
  }, [scope]);

  // 登录态拉取真实 VIP 等级（/vip/info：associator=黑胶VIP redplus=黑胶SVIP）
  useEffect(() => {
    if (!loginUid) {
      setLoginVip(null);
      return;
    }
    let on = true;
    void vipInfo()
      .then((v) => {
        if (on) setLoginVip(v);
      })
      .catch(() => {
        if (on) setLoginVip({ isVip: false, type: 'vip', level: 0 });
      });
    return () => {
      on = false;
    };
  }, [loginUid]);

  const guest = getGuestProfile();
  void profRev; // 依赖：保存资料后重读
  const name = loginUid ? loginNickname || detail?.profile.nickname || '…' : guest.nickname;
  // Task 21 头像：登录 = 跟随网易云（每次进页面拉 userDetail 最新头像）或本机上传；游客 = 本地资料
  const avatarPref = getLoginAvatarPref();
  const avatar = loginUid
    ? avatarPref.mode === 'local' && avatarPref.local
      ? avatarPref.local
      : detail?.profile.avatarUrl || loginAvatar
    : getGuestAvatar();
  const signature = loginUid ? detail?.profile.signature || '' : guest.signature;

  const owned = (playlists ?? []).filter((p) => p.creator?.userId === loginUid);
  const likedPl = owned.find((p) => p.specialType === 5) ?? owned[0] ?? null;
  const createdPls = owned.filter((p) => p.id !== likedPl?.id);
  const subPls = (playlists ?? []).filter((p) => p.creator?.userId !== loginUid);
  const createdCount = loginUid ? createdPls.length : guestLists.length;

  const theme = MINE_THEMES[Math.min(Math.max(themeIdx, 0), MINE_THEMES.length - 1)];
  /** 头部图片背景：自定义图只作头部背景（第十八轮反馈：全屏背景已删除，仅保留图片背景） */
  const customDress = themeIdx === -1 && !!dressImg;

  // 新建歌单（弹窗提交；失败抛错由弹窗展示）
  const doCreate = async (name: string, privacy: boolean) => {
    setCreating(true);
    try {
      if (loginUid) {
        const { playlistCreate } = await import('@/lib/ios/music-api');
        await playlistCreate(name, privacy ? 10 : 0);
        setPlaylists(await userPlaylists(loginUid));
      } else {
        guestPlaylistCreate(name);
        refreshGuest();
      }
      showToast('已创建歌单');
    } finally {
      setCreating(false);
    }
  };

  const doDeleteCloud = async (p: NcmPlaylist) => {
    if (!confirm(`确定删除歌单「${p.name}」？`)) return;
    try {
      await playlistDelete(p.id);
      if (loginUid) setPlaylists(await userPlaylists(loginUid));
      showToast('已删除');
    } catch {
      showToast('删除失败');
    }
  };

  const doDeleteGuest = (p: GuestPlaylist) => {
    if (!confirm(`确定删除歌单「${p.name}」？`)) return;
    guestPlaylistDelete(p.id);
    refreshGuest();
    showToast('已删除');
  };

  // 保存状态（添加状态弹窗提交；空串 = 清除）
  const saveStatus = (t: string) => {
    setStatusText(t);
    kvSetStr(statusKeyOf(scope), t);
  };

  const shareProfile = async () => {
    const text = `「${name}」的网易云音乐主页`;
    try {
      if (navigator.share) await navigator.share({ title: text, text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('已复制到剪贴板');
      }
    } catch {
      // 用户取消
    }
  };

  const refreshData = () => {
    if (!loginUid) {
      refreshGuest();
      void useMusic.getState().initLiked();
    } else {
      void (async () => {
        setDetail(await userDetail(loginUid));
        try {
          setPlaylists(await userPlaylists(loginUid));
        } catch {
          /* 保留旧数据 */
        }
      })();
    }
    showToast('已刷新');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F8F8F8] dark:bg-zinc-900" data-testid="music-mine">
      {/* 整页滚动容器：头部随内容一起滚（不再固定） */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="music-mine-scroll">
      {/* ================= 深色头部 ================= */}
      <div
        className="relative text-white"
        style={
          customDress
            ? {
                background: `linear-gradient(180deg, rgba(10,10,12,0.30) 0%, rgba(10,10,12,0.10) 45%, rgba(10,10,12,0.52) 100%), url(${dressImg}) center / cover no-repeat`,
              }
            : { background: `linear-gradient(180deg, ${theme.from} 0%, ${theme.via} 52%, ${theme.to} 100%)` }
        }
      >
        {/* 顶栏（收窄上边距，添加状态胶囊整体上移） */}
        <div className="flex items-center justify-between px-4 pt-[50px]">
          <button
            type="button"
            onClick={onSettings}
            aria-label="菜单"
            data-testid="music-mine-menu"
            className="p-1 active:scale-90"
          >
            <Menu className="h-[26px] w-[26px]" />
          </button>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setCreateOpen(true)} aria-label="新建歌单" className="p-1 active:scale-90">
              <Plus className="h-[26px] w-[26px]" />
            </button>
            <button type="button" onClick={() => void shareProfile()} aria-label="分享主页" className="p-1 active:scale-90">
              <MoreVertical className="h-[24px] w-[24px]" />
            </button>
          </div>
        </div>

        {/* 状态（添加状态/已添加状态）——只让胶囊本身视觉上移（relative -top-2，不参与布局占位），
            头部流式高度保持原样：自定义背景图的 cover 裁剪完全不动（第十五轮反馈「状态上移，不是背景图上移」） */}
        <div className="mt-0 flex justify-center">
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            data-testid="music-mine-add-status"
            className="relative -top-2 flex items-center gap-1 rounded-full bg-white/15 py-[6px] pl-[11px] pr-[13px] text-[12px] leading-none text-white/90 ring-1 ring-white/15 backdrop-blur-xl active:bg-white/25"
          >
            {/* 已有状态且自带表情图标时不再叠加笑脸；无状态时显示加号 */}
            {!statusText ? (
              <Plus className="h-[14px] w-[14px] shrink-0" />
            ) : !statusStartsWithPict(statusText) ? (
              <Smile className="h-[14px] w-[14px] shrink-0" />
            ) : null}
            <span className="max-w-[190px] truncate" data-testid="music-mine-status-text">
              {statusText || '添加状态'}
            </span>
            {/* 第十六轮反馈：删除胶囊下方的菱形装饰（旧「指向头像的小箭头」rotate-45 方块看起来像菱形） */}
          </button>
        </div>

        {/* 头像（游客：点按编辑资料；登录：点按选头像来源——上传/跟随网易云；无编辑图标） */}
        <div className="mt-1.5 flex justify-center">
          <button
            type="button"
            onClick={loginUid ? () => setAvatarSheet(true) : () => setSheet('profile')}
            aria-label={loginUid ? '更换头像' : '编辑资料'}
            data-testid="music-mine-avatar"
            className="relative active:scale-95"
          >
            <CoverImg
              src={avatar}
              className="h-[82px] w-[82px]"
              rounded="rounded-full"
              alt={name}
            />
            <span className="absolute inset-0 rounded-full ring-[3px] ring-white/90" />
          </button>
        </div>

        {/* 昵称 + VIP 徽章（SVIP 昵称变金色——网易云同款：黑胶SVIP 用户名金色展示。
            v58：金色换成柔和香槟金渐变（旧版偏橙黄且顶部近白、发灰发奇怪） */}
        <div className="mt-2 flex items-center justify-center gap-2 px-6">
          <h2
            className={`max-w-[62%] truncate bg-clip-text text-[21px] font-bold ${
              // 登录账号是黑胶SVIP，或游客资料选择了 SVIP → 金色昵称
              (loginUid ? loginVip?.isVip && loginVip.type === 'svip' : guest.vipType === 'svip')
                ? 'text-transparent [background-image:linear-gradient(180deg,#F6E3B4_0%,#E8C583_48%,#CDA25F_100%)]'
                : 'text-white'
            }`}
            data-testid="music-mine-nickname"
          >
            {name}
          </h2>
          {loginUid ? (
            loginVip ? (
              loginVip.isVip ? (
                <VipBadge type={loginVip.type} level={loginVip.level} testId="music-mine-vip" />
              ) : (
                <VipBadge type="vip" level={0} testId="music-mine-vip" />
              )
            ) : null
          ) : (
            // Task 21：游客 VIP 徽章默认隐藏（编辑资料里「主页显示：显示/隐藏」可重新打开）
            !guest.vipHidden && <VipBadge type={guest.vipType} level={guest.vipLevel} testId="music-mine-vip" />
          )}
        </div>

        {/* 签名 */}
        <p className="mt-1 truncate px-10 text-center text-[12px] text-white/60" data-testid="music-mine-signature">
          {signature || (loginUid ? '编辑我的签名~' : '点击头像设置资料')}
        </p>

        {/* 统计行 */}
        <div className="mt-2 flex items-center justify-center gap-7">
          {loginUid ? (
            <>
              <StatV v={detail ? `${detail.profile.follows ?? 0}` : '—'} l="关注" />
              <StatV v={detail ? `${detail.profile.followeds ?? 0}` : '—'} l="粉丝" />
              <StatV v={detail ? `Lv.${detail.level}` : '—'} l="" />
              {/* 等级右面显示累计听歌时长（本地真实累计），不是歌数 */}
              <StatV v={fmtListenDur(listenSec)} l="" />
            </>
          ) : (
            <>
              <button type="button" onClick={() => setSheet('profile')} data-testid="music-mine-edit-stats" className="flex items-baseline gap-1 active:opacity-70">
                <span className="text-[15px] font-bold" data-testid="music-mine-follows">
                  {guest.follows}
                </span>
                <span className="text-[12px] text-white/60">关注</span>
              </button>
              <button type="button" onClick={() => setSheet('profile')} data-testid="music-mine-fans-btn" className="flex items-baseline gap-1 active:opacity-70">
                <span className="text-[15px] font-bold" data-testid="music-mine-fans">
                  {guest.fans}
                </span>
                <span className="text-[12px] text-white/60">粉丝</span>
              </button>
              {/* v59：旧「歌单 X」计数改等级 Lv.X（编辑资料可自定义），与登录态统计行同版式；
                  点按进编辑资料（同关注/粉丝可点） */}
              <button type="button" onClick={() => setSheet('profile')} data-testid="music-mine-level-btn" className="flex items-baseline active:opacity-70">
                <span className="text-[15px] font-bold" data-testid="music-mine-level">
                  Lv.{guest.level}
                </span>
              </button>
              {/* v59：旧「红心 X」计数改累计听歌时长（本地真实累计，不可编辑），与登录态同版式 */}
              <StatV v={fmtListenDur(listenSec)} l="" />
            </>
          )}
        </div>

        {/* 胶囊入口（第四十四轮：等宽网格一行排开——窄屏不再溢出滚动/截断，与网易云原生入口排布一致） */}
        <div className="mt-3 grid grid-cols-5 items-center gap-2 px-4">
          <Pill icon={<Clock3 className="h-[18px] w-[18px]" />} label="最近" onClick={() => setSheet('recent')} testId="music-mine-recent" />
          <Pill icon={<ArrowDownToLine className="h-[18px] w-[18px]" />} label="本地" onClick={() => setSheet('local')} testId="music-mine-local" />
          <Pill icon={<Star className="h-[18px] w-[18px]" />} label="收藏" onClick={() => setSheet('liked')} testId="music-mine-liked" />
          <Pill icon={<Shirt className="h-[18px] w-[18px]" />} label="装扮" onClick={() => setSheet('dress')} testId="music-mine-dress" />
          <button
            type="button"
            onClick={onSettings}
            aria-label="更多"
            data-testid="music-mine-more"
            className="flex h-11 w-full items-center justify-center rounded-xl bg-white/10 text-white/90 backdrop-blur-xl active:bg-white/20"
          >
            <LayoutGrid className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* 白色面板圆角帽（同一底色，形成圆角衔接） */}
        <div className="mt-3 h-[16px] rounded-t-[16px] bg-[#F8F8F8] dark:bg-zinc-900" />
      </div>

      {/* ================= 白色面板 ================= */}
      <div className="bg-[#F8F8F8] dark:bg-zinc-900">
        {/* 主 Tab 行（音乐/播客/笔记）——始终显示，任意 Tab 下都能切换 */}
        <div className="sticky top-0 z-10 border-b border-black/5 bg-[#F8F8F8]/90 px-5 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/90">
          <div className="flex items-center gap-8">
            {(
              [
                { k: 'music', label: '音乐' },
                { k: 'podcast', label: '播客' },
                { k: 'notes', label: '笔记' },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setMainTab(t.k)}
                data-testid={`music-mine-tab-${t.k}`}
                className="relative py-2.5 text-[18px] leading-none"
              >
                <span className={mainTab === t.k ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}>
                  {t.label}
                </span>
                {mainTab === t.k && (
                  <span className="absolute inset-x-0 -bottom-[1px] mx-auto h-[3px] w-7 rounded-full bg-zinc-900 dark:bg-white" />
                )}
              </button>
            ))}
          </div>
        </div>

        {mainTab === 'music' && (
          <>
            {/* 子 Tab 行 */}
            <div className="flex items-center px-5 pb-1 pt-3">
              <button
                type="button"
                onClick={() => setSubTab('recent')}
                data-testid="music-mine-subtab-recent"
                className={`flex items-center gap-1 text-[15px] ${subTab === 'recent' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-400'}`}
              >
                <Lock className="h-3.5 w-3.5" />
                近期
              </button>
              <button
                type="button"
                onClick={() => setSubTab('created')}
                data-testid="music-mine-subtab-created"
                className={`ml-5 text-[15px] ${subTab === 'created' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-400'}`}
              >
                创建<sup className="text-[10px]">{createdCount}</sup>
              </button>
              <div className="ml-auto flex items-center gap-4 text-zinc-400">
                <button type="button" onClick={refreshData} aria-label="刷新" data-testid="music-mine-refresh" className="active:scale-90">
                  <RotateCcw className="h-[18px] w-[18px]" />
                </button>
                <button type="button" onClick={() => setCreateOpen(true)} aria-label="新建歌单" data-testid="music-mine-create-pl" className="active:scale-90">
                  {creating ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <MoreVertical className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>
            {/* 歌单列表 */}
            {subTab === 'recent' ? (
              <div className="pb-[128px]" data-testid="music-mine-list">
                {loginUid ? (
                  playlists === null ? (
                    <LoadingBlock />
                  ) : (
                    <>
                      {likedPl && (
                        <PlRow
                          tile={<HeartTile />}
                          name="我喜欢的音乐"
                          sub={
                            <>
                              <Lock className="h-3 w-3 shrink-0" />
                              {likedPl.trackCount}首{likedPl.playCount ? ` · ${fmtPlayCount(likedPl.playCount)}次播放` : ''}
                            </>
                          }
                          onClick={() => openPlaylist(likedPl.id, 'liked')}
                          testId="music-mine-pl-liked"
                        />
                      )}
                      <PlRow
                        tile={<RankTile />}
                        name="听歌排行"
                        sub={<>累计听歌{detail?.listenSongs ?? '—'}首</>}
                        right={<Pin className="h-4 w-4 shrink-0 rotate-45 text-zinc-300 dark:text-zinc-600" />}
                        onClick={() => setShowRecord(true)}
                        testId="music-mine-pl-record"
                      />
                      {createdPls.map((p) => (
                        <PlRow
                          key={p.id}
                          tile={<CoverImg src={p.coverImgUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />}
                          name={p.name}
                          sub={<>歌单 · {p.trackCount}首{p.creator?.nickname ? ` · ${p.creator.nickname}` : ''}</>}
                          right={
                            <button
                              type="button"
                              onClick={() => void doDeleteCloud(p)}
                              aria-label="删除歌单"
                              className="shrink-0 p-1.5 text-zinc-300 active:scale-90"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          }
                          onClick={() => openPlaylist(p.id)}
                          testId={`music-mine-pl-${p.id}`}
                        />
                      ))}
                      {subPls.map((p) => (
                        <PlRow
                          key={p.id}
                          tile={<CoverImg src={p.coverImgUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />}
                          name={p.name}
                          sub={<>歌单 · {p.trackCount}首{p.creator?.nickname ? ` · ${p.creator.nickname}` : ''}</>}
                          onClick={() => openPlaylist(p.id)}
                          testId={`music-mine-pl-${p.id}`}
                        />
                      ))}
                    </>
                  )
                ) : (
                  <>
                    <PlRow
                      tile={<HeartTile />}
                      name="我的红心"
                      sub={
                        <>
                          <Lock className="h-3 w-3 shrink-0" />
                          {likedIds.size}首
                        </>
                      }
                      onClick={() => setSheet('liked')}
                      testId="music-mine-pl-liked"
                    />
                    {/* 游客也有听歌排行（本地播放记录聚合，单独全屏界面） */}
                    <PlRow
                      tile={<RankTile />}
                      name="听歌排行"
                      sub={<>本地播放记录 · {fmtListenDur(listenSec)}</>}
                      right={<Pin className="h-4 w-4 shrink-0 rotate-45 text-zinc-300 dark:text-zinc-600" />}
                      onClick={() => setShowRecord(true)}
                      testId="music-mine-pl-record"
                    />
                    {guestLists.map((p) => (
                      <PlRow
                        key={p.id}
                        tile={<CoverImg src={p.songs[0]?.album?.picUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />}
                        name={p.name}
                        sub={<>{p.songs.length}首 · 本地歌单</>}
                        right={
                          <button
                            type="button"
                            onClick={() => doDeleteGuest(p)}
                            aria-label="删除歌单"
                            className="shrink-0 p-1.5 text-zinc-300 active:scale-90"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        }
                        onClick={() => useMusic.getState().openGuestPlaylistNav(p.id)}
                        testId={`music-mine-gpl-${p.id}`}
                      />
                    ))}
                    {guestLists.length === 0 && (
                      <p className="px-5 pb-6 pt-2 text-center text-[12px] text-zinc-400">
                        还没有歌单，切到「创建」新建一个吧
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="pb-[128px]" data-testid="music-mine-list-created">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  data-testid="music-mine-create-row"
                  className="flex w-full items-center gap-3 px-5 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-600">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-[15px] text-zinc-500 dark:text-zinc-400">新建歌单</span>
                </button>
                {loginUid
                  ? createdPls.map((p) => (
                      <PlRow
                        key={p.id}
                        tile={<CoverImg src={p.coverImgUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />}
                        name={p.name}
                        sub={<>歌单 · {p.trackCount}首{p.creator?.nickname ? ` · ${p.creator.nickname}` : ''}</>}
                        right={
                          <button
                            type="button"
                            onClick={() => void doDeleteCloud(p)}
                            aria-label="删除歌单"
                            className="shrink-0 p-1.5 text-zinc-300 active:scale-90"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        }
                        onClick={() => openPlaylist(p.id)}
                        testId={`music-mine-pl-${p.id}`}
                      />
                    ))
                  : guestLists.map((p) => (
                      <PlRow
                        key={p.id}
                        tile={<CoverImg src={p.songs[0]?.album?.picUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />}
                        name={p.name}
                        sub={<>{p.songs.length}首 · 本地歌单</>}
                        right={
                          <button
                            type="button"
                            onClick={() => doDeleteGuest(p)}
                            aria-label="删除歌单"
                            className="shrink-0 p-1.5 text-zinc-300 active:scale-90"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        }
                        onClick={() => useMusic.getState().openGuestPlaylistNav(p.id)}
                        testId={`music-mine-gpl-${p.id}`}
                      />
                    ))}
              </div>
            )}
          </>
        )}

        {mainTab === 'podcast' && <PodcastList />}

        {mainTab === 'notes' && <NotesList />}
      </div>
      </div>

      {/* ================= 半屏面板 ================= */}
      {showRecord && <RecordPage onClose={() => setShowRecord(false)} />}
      {/* Task 21：登录账号头像来源选择（点头像弹出） */}
      {avatarSheet && (
        <LoginAvatarSheet
          ncmAvatar={detail?.profile.avatarUrl || loginAvatar || ''}
          busy={avatarBusy}
          onClose={() => setAvatarSheet(false)}
          onPickFile={(f) => {
            setAvatarBusy(true);
            fileToAvatarDataUrl(f)
              .then((d) => {
                setLoginAvatarLocal(d);
                useMusic.setState({ loginAvatar: d }); // 播放器/一起听等直接读 store，立即同步
                setProfRev((r) => r + 1);
                setAvatarSheet(false);
                showToast('头像已更新');
              })
              .catch(() => showToast('图片处理失败'))
              .finally(() => setAvatarBusy(false));
          }}
          onFollow={() => {
            setLoginAvatarFollowNcm();
            const fresh = detail?.profile.avatarUrl || '';
            if (fresh) useMusic.setState({ loginAvatar: fresh });
            setProfRev((r) => r + 1);
            setAvatarSheet(false);
            showToast('已跟随网易云头像');
          }}
        />
      )}
      {sheet === 'profile' && (
        <ProfileEditSheet
          onClose={() => {
            setSheet(null);
            refreshGuest();
            setProfRev((r) => r + 1); // 保存后强制重渲染，关注/粉丝/头像立即生效
          }}
        />
      )}
      {sheet === 'dress' && (
        <DressSheet
          current={themeIdx}
          customImg={dressImg}
          onPick={(i) => {
            setThemeIdx(i);
            kvSetIdx(dressKeyOf(scope), i);
            showToast('已更换装扮');
          }}
          onCustom={(img) => {
            setDressImg(img);
            kvSetStr(dressImgKeyOf(scope), img);
            setThemeIdx(-1);
            kvSetIdx(dressKeyOf(scope), -1);
            showToast('已应用自定义背景');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet && sheet !== 'profile' && sheet !== 'dress' && (
        <MineSheet kind={sheet} onClose={() => setSheet(null)} />
      )}

      {/* 添加状态弹窗 */}
      {statusOpen && (
        <StatusEditSheet
          current={statusText}
          onClose={() => setStatusOpen(false)}
          onSubmit={(t) => {
            saveStatus(t);
            setStatusOpen(false);
          }}
        />
      )}

      {/* 新建歌单弹窗（网易云居中卡片） */}
      {createOpen && (
        <PlaylistCreateDialog
          onClose={() => setCreateOpen(false)}
          onSubmit={(n, privacy) => doCreate(n, privacy)}
        />
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-[12px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- 小件 ----------------

/** 时长格式化：60 分内「X分钟」，以上「X小时Y分」 */
function fmtListenDur(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 1) return '0分钟';
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}小时${rm}分` : `${h}小时`;
}

/** 统计项（值加粗 + 标签） */
function StatV({ v, l }: { v: string; l: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[15px] font-bold">{v}</span>
      {l && <span className="text-[12px] text-white/60">{l}</span>}
    </div>
  );
}

/** 头部胶囊入口 */
function Pill({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex h-11 w-full min-w-0 items-center justify-center gap-1 rounded-xl border border-white/15 bg-white/10 px-1 text-[13px] text-white/90 backdrop-blur-xl active:bg-white/20"
    >
      {icon}
      {label}
    </button>
  );
}

/** 「我喜欢的音乐」心形块 */
function HeartTile() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-400 dark:bg-zinc-700">
      <Heart className="h-6 w-6 text-white" fill="currentColor" />
    </span>
  );
}

/** 「听歌排行」图表块 */
function RankTile() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-600 dark:bg-zinc-800">
      <BarChart2 className="h-6 w-6 text-white" />
    </span>
  );
}

/** 歌单行 */
function PlRow({
  tile,
  name,
  sub,
  right,
  onClick,
  testId,
}: {
  tile: React.ReactNode;
  name: string;
  sub: React.ReactNode;
  right?: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-2 px-5 py-2">
      <button type="button" onClick={onClick} data-testid={testId} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70">
        {tile}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-zinc-400">{sub}</span>
        </span>
      </button>
      {right}
    </div>
  );
}

// ---------------- 登录账号头像来源（Task 21：从手机上传 / 跟随网易云账号，点头像进入） ----------------

/**
 * 登录账号头像设置弹层：
 * - 跟随网易云账号头像：每次进「我的」页拉 userDetail 最新头像并同步全 App——
 *   真实账号换头像后这里自动跟着换（music-store.getLoginAvatarPref/setLoginAvatarFollowNcm）；
 * - 从手机上传：本机裁方压缩后存 dataURL，作为登录头像展示（不改动网易云账号本体）。
 */
function LoginAvatarSheet({
  ncmAvatar,
  busy,
  onClose,
  onPickFile,
  onFollow,
}: {
  /** 网易云账号当前头像（预览用） */
  ncmAvatar: string;
  busy: boolean;
  onClose: () => void;
  onPickFile: (f: File) => void;
  onFollow: () => void;
}) {
  const pref = getLoginAvatarPref();
  const preview = pref.mode === 'local' && pref.local ? pref.local : ncmAvatar || GUEST_DEFAULT_AVATAR;
  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-login-avatar-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-[104px] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">头像设置</p>
          <button type="button" onClick={onClose} className="text-[13px] text-zinc-400">
            取消
          </button>
        </div>
        <div className="mb-4 flex items-center gap-4">
          <CoverImg src={preview} className="h-16 w-16" rounded="rounded-full" alt="当前头像" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
              {pref.mode === 'local' ? '使用手机上传的头像' : '跟随网易云账号头像'}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
              {pref.mode === 'local'
                ? '切回跟随网易云后，真实账号换头像会自动同步'
                : '真实网易云账号换头像后，这里也会同步更新'}
            </p>
          </div>
        </div>
        <div className="space-y-2.5">
          <label
            data-testid="music-login-avatar-upload"
            className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-zinc-900 text-[14px] font-medium text-white active:scale-[0.98] dark:bg-white dark:text-zinc-900"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            从手机上传头像
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // 允许重复选同一张
                if (f) onPickFile(f);
              }}
              data-testid="music-login-avatar-file"
            />
          </label>
          <button
            type="button"
            onClick={onFollow}
            disabled={pref.mode === 'ncm'}
            data-testid="music-login-avatar-follow"
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-black/10 text-[14px] font-medium text-zinc-900 active:scale-[0.98] disabled:opacity-45 dark:border-white/15 dark:text-zinc-100"
          >
            <RotateCcw className="h-4 w-4" />
            跟随网易云账号头像{pref.mode === 'ncm' ? '（当前）' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 游客资料编辑（头像/昵称/签名/关注粉丝/VIP 一站式；无编辑图标，点头像进入） ----------------

function ProfileEditSheet({ onClose }: { onClose: () => void }) {
  const cur = getGuestProfile();
  const globalAvatar = (() => {
    try {
      return useSettings.getState().profile.avatar || '';
    } catch {
      return '';
    }
  })();
  const [nickname, setNickname] = useState(cur.nickname === '游客' ? '' : cur.nickname);
  const [signature, setSignature] = useState(cur.signature);
  // '' = 跟随全局头像
  const [avatar, setAvatar] = useState(cur.avatar);
  const [follows, setFollows] = useState(String(cur.follows));
  const [fans, setFans] = useState(String(cur.fans));
  // v59：等级（游客「我的」页统计行 Lv.X，可自定义）
  const [level, setLevel] = useState(String(cur.level));
  // Task 21：VIP 徽章可整体隐藏（默认隐藏，见 getGuestProfile）
  const [vipHidden, setVipHidden] = useState(cur.vipHidden);
  const [vipType, setVipType] = useState<'vip' | 'svip'>(cur.vipType);
  const [vipLevel, setVipLevel] = useState(String(cur.vipLevel));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一张
    if (!f) return;
    setBusy(true);
    setErr('');
    fileToAvatarDataUrl(f)
      .then((d) => setAvatar(d))
      .catch((er: Error) => setErr(er.message || '图片处理失败'))
      .finally(() => setBusy(false));
  };

  const save = () => {
    setGuestProfile({
      nickname: nickname.trim() || '游客',
      avatar,
      signature: signature.trim().slice(0, 40),
      follows: Math.max(0, Math.min(999999, Number(follows.replace(/\D/g, '')) || 0)),
      fans: Math.max(0, Math.min(999999, Number(fans.replace(/\D/g, '')) || 0)),
      level: Math.max(0, Math.min(99, Number(level.replace(/\D/g, '')) || 0)),
      vipHidden,
      vipType,
      vipLevel: Math.max(1, Math.min(99, Number(vipLevel.replace(/\D/g, '')) || 7)),
    });
    onClose();
  };

  const previewAvatar = avatar || globalAvatar || GUEST_DEFAULT_AVATAR;

  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-profile-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[86%] w-full overflow-y-auto rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-[104px] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">编辑资料</p>
          <button type="button" onClick={onClose} className="text-[13px] text-zinc-400">
            取消
          </button>
        </div>

        {/* 头像：上传 / 跟随全局 / 预设 */}
        <div className="mb-4 flex items-center gap-4">
          <CoverImg src={previewAvatar} className="h-16 w-16" rounded="rounded-full" alt="头像预览" />
          <div className="min-w-0 flex-1 space-y-2">
            {/* 从手机上传头像 */}
            <label
              data-testid="music-avatar-upload"
              className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-zinc-900 text-[13px] font-medium text-white active:scale-[0.98] dark:bg-white dark:text-zinc-900"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4 rotate-180" />}
              从手机上传头像
              <input type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="music-avatar-file" />
            </label>
            <p className="text-[10px] leading-snug text-zinc-400">支持相册/拍摄，自动裁方压缩后保存在本机</p>
          </div>
        </div>
        {err && <p className="mb-2 text-[12px] text-red-500">{err}</p>}
        <p className="mb-2 text-[12px] text-zinc-500">或选一个头像（第一个为全局头像，跟随设置里的机主头像）</p>
        <div className="mb-5 flex flex-wrap gap-2.5">
          {/* 跟随全局头像选项 */}
          <button
            type="button"
            onClick={() => setAvatar('')}
            data-testid="music-avatar-opt-global"
            className={`relative shrink-0 overflow-hidden rounded-full ring-2 ${avatar === '' ? 'ring-[#C20C0C]' : 'ring-black/10 dark:ring-white/15'}`}
            title="跟随全局头像"
          >
            <CoverImg src={globalAvatar || GUEST_DEFAULT_AVATAR} className="h-11 w-11" rounded="rounded-full" alt="全局头像" />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[8px] leading-4 text-white">全局</span>
          </button>
          {GUEST_AVATAR_PRESETS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              className={`overflow-hidden rounded-full ring-2 ${avatar === a ? 'ring-[#C20C0C]' : 'ring-transparent'}`}
              data-testid={`music-avatar-opt-${GUEST_AVATAR_PRESETS.indexOf(a) + 1}`}
            >
              <CoverImg src={a} className="h-11 w-11" rounded="rounded-full" alt="头像" />
            </button>
          ))}
        </div>

        {/* 昵称 / 签名 */}
        <label className="mb-1 block text-[12px] text-zinc-500">昵称</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 16))}
          placeholder="给自己起个名字"
          data-testid="music-profile-nickname"
          className="mb-3 h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
        />
        <label className="mb-1 block text-[12px] text-zinc-500">个性签名</label>
        <input
          value={signature}
          onChange={(e) => setSignature(e.target.value.slice(0, 40))}
          placeholder="写一句签名展示在主页"
          data-testid="music-profile-signature"
          className="mb-4 h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
        />

        {/* 关注 / 粉丝 / 等级（v59：等级三列一排，Lv.X 展示在统计行） */}
        <div className="mb-4 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[12px] text-zinc-500">关注数</label>
            <input
              value={follows}
              onChange={(e) => setFollows(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              data-testid="music-stats-follows"
              className="h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[12px] text-zinc-500">粉丝数</label>
            <input
              value={fans}
              onChange={(e) => setFans(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              data-testid="music-stats-fans"
              className="h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[12px] text-zinc-500">等级</label>
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value.replace(/\D/g, '').slice(0, 2))}
              inputMode="numeric"
              placeholder="0-99"
              data-testid="music-stats-level"
              className="h-10 w-full rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* VIP 徽章自定义（Task 21：可整体隐藏，隐藏后类型/等级仅预览不生效） */}
        <p className="mb-2 text-[12px] text-zinc-500">VIP 徽章</p>
        <div className="mb-3 flex items-center gap-2" data-testid="music-vip-show-toggle">
          <span className="text-[12px] text-zinc-500">主页显示</span>
          <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {([false, true] as const).map((hidden) => (
              <button
                key={String(hidden)}
                type="button"
                onClick={() => setVipHidden(hidden)}
                data-testid={`music-vip-hidden-${hidden ? 'on' : 'off'}`}
                className={`rounded-full px-4 py-1.5 text-[12px] font-medium ${
                  vipHidden === hidden ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white' : 'text-zinc-400'
                }`}
              >
                {hidden ? '隐藏' : '显示'}
              </button>
            ))}
          </div>
        </div>
        <div className={`mb-3 flex items-center gap-3 ${vipHidden ? 'pointer-events-none opacity-40' : ''}`}>
          <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(['vip', 'svip'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVipType(t)}
                data-testid={`music-vip-type-${t}`}
                className={`rounded-full px-4 py-1.5 text-[12px] font-medium ${
                  vipType === t ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white' : 'text-zinc-400'
                }`}
              >
                {t === 'vip' ? 'VIP' : 'SVIP'}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-2">
            <span className="shrink-0 text-[12px] text-zinc-500">等级</span>
            <input
              value={vipLevel}
              onChange={(e) => setVipLevel(e.target.value.replace(/\D/g, '').slice(0, 2))}
              inputMode="numeric"
              data-testid="music-vip-level"
              className="h-10 w-full min-w-0 rounded-lg border border-black/10 bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-zinc-400">预览</span>
            <VipBadge type={vipType} level={Number(vipLevel.replace(/\D/g, '')) || 1} />
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          data-testid="music-profile-save"
          className="h-11 w-full rounded-full bg-[#C20C0C] text-[14px] font-medium text-white active:scale-[0.98]"
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ---------------- 装扮（头部主题色 + 手机上传自定义背景） ----------------

/** 从手机选择图片 → 等比压到宽≤820px → JPEG dataURL（作头部背景，cover 裁剪交给 CSS） */
function fileToDressDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const w = img.width || 800;
        const h = img.height || 800;
        const scale = Math.min(1, 820 / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 不可用'));
          return;
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function DressSheet({
  current,
  customImg,
  onPick,
  onCustom,
  onClose,
}: {
  current: number;
  /** 当前是否使用自定义背景（themeIdx === -1） */
  customImg: string;
  onPick: (i: number) => void;
  /** 上传并应用自定义背景 */
  onCustom: (img: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const usingCustom = current === -1 && !!customImg;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    setErr('');
    fileToDressDataUrl(f)
      .then((d) => onCustom(d))
      .catch((er: Error) => setErr(er.message || '图片处理失败'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-dress-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-[104px] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">主页装扮</p>
          <button type="button" onClick={onClose} className="text-[13px] text-zinc-400">
            关闭
          </button>
        </div>
        {/* 自定义背景（手机上传）——第十八轮反馈：全屏背景选项已删除，自定义图仅作头部图片背景 */}
        <div className="mb-4">
          <div className="flex items-stretch gap-3">
            <button
              type="button"
              onClick={customImg ? onCustom.bind(null, customImg) : undefined}
              data-testid="music-dress-custom-tile"
              disabled={!customImg || busy}
              className={`w-[72px] shrink-0 overflow-hidden rounded-xl ring-2 ${
                usingCustom ? 'ring-[#C20C0C]' : 'ring-black/5 dark:ring-white/10'
              } ${customImg ? '' : 'opacity-60'}`}
              title={customImg ? '应用我的自定义背景' : '先上传一张图片'}
            >
              {customImg ? (
                <span
                  className="block h-16 w-full"
                  style={{ background: `url(${customImg}) center / cover no-repeat` }}
                />
              ) : (
                <span className="flex h-16 w-full items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                  <ImagePlus className="h-5 w-5 text-zinc-400" />
                </span>
              )}
              <span className="block py-1.5 text-center text-[11px] text-zinc-600 dark:text-zinc-300">我的</span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <label
                data-testid="music-dress-upload"
                className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-zinc-900 text-[13px] font-medium text-white active:scale-[0.98] dark:bg-white dark:text-zinc-900"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                从手机上传装扮背景
                <input type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="music-dress-file" />
              </label>
              <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">
                选一张相册里的图片作为主页头部背景，上传后立即生效
              </p>
              {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {MINE_THEMES.map((t, i) => (
            <button
              key={t.name}
              type="button"
              onClick={() => onPick(i)}
              data-testid={`music-dress-${i}`}
              className={`overflow-hidden rounded-xl ring-2 ${current === i ? 'ring-[#C20C0C]' : 'ring-black/5 dark:ring-white/10'}`}
            >
              <span
                className="block h-16 w-full"
                style={{ background: `linear-gradient(180deg, ${t.from} 0%, ${t.via} 52%, ${t.to} 100%)` }}
              />
              <span className="block py-1.5 text-center text-[11px] text-zinc-600 dark:text-zinc-300">{t.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-[10px] text-zinc-400">点击即时生效，装扮保存在本机</p>
      </div>
    </div>
  );
}

// ---------------- 半屏面板（最近播放/听歌排行/红心/本地） ----------------

function MineSheet({ kind, onClose }: { kind: Exclude<SheetKind, 'profile' | 'stats' | 'dress' | null>; onClose: () => void }) {
  const uid = useMusic((s) => s.loginUid) ?? 0;
  const [items, setItems] = useState<
    { key: string; title: string; subtitle: string; pic?: string; play?: () => void }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const playSong = useMusic((s) => s.playSong);

  useEffect(() => {
    void (async () => {
      try {
        if (kind === 'recent') {
          const st = useMusic.getState();
          setItems(
            st.history.map((h) => ({
              key: `h-${h.song.id}`,
              title: h.song.name,
              subtitle: h.song.artists?.map((a) => a.name).join('/') ?? '',
              pic: h.song.album?.picUrl,
              play: () => void playSong(h.song, st.history.map((x) => x.song)),
            })),
          );
        } else if (kind === 'record' && uid) {
          const { userRecord, songArtistText } = await import('@/lib/ios/music-api');
          const rec = await userRecord(uid, 0);
          setItems(
            rec.map((r) => ({
              key: `r-${r.song.id}`,
              title: r.song.name,
              subtitle: `${songArtistText(r.song)} · 播放${r.playCount}次`,
              pic: r.song.album?.picUrl,
              play: () => void playSong(r.song, rec.map((x) => x.song)),
            })),
          );
        } else if (kind === 'liked') {
          const st = useMusic.getState();
          await st.initLiked();
          const songs = [...st.likedIds].map((id) => st.likedSongs[id]).filter(Boolean);
          setItems(
            songs.map((s) => ({
              key: `l-${s.id}`,
              title: s.name,
              subtitle: s.artists?.map((a) => a.name).join('/') ?? '',
              pic: s.album?.picUrl,
              play: () => void playSong(s, songs),
            })),
          );
        }
        // kind === 'local'：本地音乐暂无下载缓存，保持空列表
      } finally {
        setLoading(false);
      }
    })();
  }, [kind, uid, playSong]);

  const title =
    kind === 'recent' ? '最近播放' : kind === 'record' ? '听歌排行（所有时间）' : kind === 'liked' ? '我的红心歌曲' : '本地音乐';

  return (
    <div className="absolute inset-0 z-[80] flex items-end">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[78%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
          <button type="button" onClick={onClose} className="text-[13px] text-zinc-400">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[100px]">
          {loading ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
              <ListMusic className="h-8 w-8 opacity-40" />
              <p className="text-[13px]">{kind === 'local' ? '下载的歌曲会保存在这里' : '这里还是空的'}</p>
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={it.play}
                className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <CoverImg src={it.pic} className="h-11 w-11" rounded="rounded-lg" alt={it.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{it.title}</p>
                  <p className="truncate text-[11px] text-zinc-400">{it.subtitle}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 听歌排行（单独全屏界面：顶栏返回+标题、用户头部、周/总 Tab、排行列表；登录=云端接口，游客=本地播放历史聚合） ----------------

function RecordPage({ onClose }: { onClose: () => void }) {
  const uid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const listenSec = useMusic((s) => s.listenSec);
  const playSong = useMusic((s) => s.playSong);
  const guest = getGuestProfile();
  const headAvatar = uid ? loginAvatar || getGuestAvatar() : getGuestAvatar();
  const headName = uid ? loginNickname || '网易云用户' : guest.nickname;
  const [range, setRange] = useState<'week' | 'all'>('all');
  const [items, setItems] = useState<{ song: NcmSong; count: number }[] | null>(null);

  useEffect(() => {
    setItems(null);
    void (async () => {
      try {
        if (uid) {
          const { userRecord, normalizeSong } = await import('@/lib/ios/music-api');
          const rec = await userRecord(uid, range === 'week' ? 1 : 0);
          setItems(rec.map((r) => ({ song: normalizeSong(r.song), count: r.playCount })));
        } else {
          // 游客：本地播放历史聚合（能显示的都显示）
          const st = useMusic.getState();
          const map = new Map<number, { song: NcmSong; count: number }>();
          for (const h of st.history) {
            const e = map.get(h.song.id) ?? { song: h.song, count: 0 };
            e.count += 1;
            map.set(h.song.id, e);
          }
          setItems([...map.values()].sort((a, b) => b.count - a.count).slice(0, 100));
        }
      } catch {
        setItems([]);
      }
    })();
  }, [uid, range]);

  const maxCount = items?.[0]?.count ?? 1;
  const totalPlays = items?.reduce((n, x) => n + x.count, 0) ?? 0;

  return (
    <div className="absolute inset-0 z-[80] flex flex-col bg-white dark:bg-zinc-900" data-testid="music-record-page">
      {/* 顶栏：返回 + 标题 */}
      <div className="flex items-center px-4 pb-2 pt-[52px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="返回"
          data-testid="music-record-back"
          className="p-1 text-zinc-700 active:scale-90 dark:text-zinc-200"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <p className="min-w-0 flex-1 pr-8 text-center text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
          听歌排行
        </p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {/* 用户头部：头像 + 昵称 + 账号状态 */}
        <div className="flex items-center gap-3 px-5 pt-2">
          <CoverImg src={headAvatar} className="h-14 w-14" rounded="rounded-full" alt={headName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-bold text-zinc-900 dark:text-zinc-100">{headName}</p>
            <p className="mt-0.5 truncate text-[12px] text-zinc-400">
              {uid ? '网易云账号已登录' : '游客模式 · 数据仅保存在本机'}
            </p>
          </div>
        </div>

        {/* 周 / 所有时间 + 累计信息（游客只有本地总数据，仍可切换但数据一致） */}
        <div className="mt-3 flex items-end justify-between border-b border-black/[0.06] px-5 dark:border-white/10">
          <div className="flex gap-5">
            {(
              [
                { k: 'week', label: '最近一周' },
                { k: 'all', label: '所有时间' },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setRange(t.k)}
                data-testid={`music-record-range-${t.k}`}
                className={`relative pb-2 text-[15px] ${
                  range === t.k ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-400'
                }`}
              >
                {t.label}
                {range === t.k && <span className="absolute inset-x-0 -bottom-[1px] h-[3px] rounded-full bg-[#EC4141]" />}
              </button>
            ))}
          </div>
          <p className="pb-2 text-[11px] tabular-nums text-zinc-400">
            累计听歌 {fmtListenDur(listenSec)} · {totalPlays} 次播放
          </p>
        </div>

        {/* 排行列表（整页滚动） */}
        <div className="pb-10 pt-1" data-testid="music-record-list">
          {items === null ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-zinc-400">
              <BarChart2 className="h-8 w-8 opacity-40" />
              <p className="text-[13px]">还没有听歌数据，去听几首吧</p>
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.song.id}
                type="button"
                onClick={() => void playSong(it.song, items.map((x) => x.song))}
                data-testid={`music-record-item-${i}`}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <span
                  className={`w-6 shrink-0 text-center text-[15px] font-bold tabular-nums ${
                    i < 3 ? 'text-[#EC4141]' : 'text-zinc-400'
                  }`}
                >
                  {i + 1}
                </span>
                <CoverImg src={it.song.album?.picUrl} className="h-11 w-11 shrink-0" rounded="rounded-lg" alt={it.song.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-zinc-900 dark:text-zinc-100">{it.song.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
                    {it.song.artists?.map((a) => a.name).join('/')}
                  </span>
                  {/* 播放次数占比条 */}
                  <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <span
                      className="block h-full rounded-full bg-[#EC4141]/70"
                      style={{ width: `${Math.max(6, Math.round((it.count / maxCount) * 100))}%` }}
                    />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="flex items-center gap-1 text-[11px] tabular-nums text-zinc-400">
                    <Play className="h-3 w-3" fill="currentColor" />
                    {it.count}次
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 播客 Tab（网易云热门电台，能显示的都显示） ----------------

function PodcastList() {
  const [list, setList] = useState<NcmDjRadio[] | null>(null);
  const showToastMine = (m: string) => {
    // 简易 toast（挂 body 层级足够）
    const el = document.createElement('div');
    el.textContent = m;
    el.style.cssText =
      'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:999px;font-size:12px;z-index:9999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  };
  useEffect(() => {
    void (async () => {
      try {
        setList(await djHot(20));
      } catch {
        setList([]);
      }
    })();
  }, []);
  if (list === null) {
    return (
      <div className="pb-[128px] pt-4">
        <LoadingBlock />
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 pb-[128px] pt-14 text-zinc-400">
        <Podcast className="h-9 w-9 opacity-40" />
        <p className="text-[13px]">暂无播客内容</p>
      </div>
    );
  }
  return (
    <div className="pb-[128px]" data-testid="music-mine-podcasts">
      {list.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => showToastMine('演示环境：播客播放即将上线')}
          className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
        >
          <CoverImg src={d.picUrl} className="h-12 w-12 shrink-0" rounded="rounded-lg" alt={d.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-zinc-900 dark:text-zinc-100">{d.name}</span>
            <span className="block truncate text-[11px] text-zinc-400">
              {d.rcmdtext || d.dj?.nickname || '网易云播客'} · {d.programCount ?? 0}期
            </span>
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{fmtPlayCount(d.subCount)}订阅</span>
        </button>
      ))}
    </div>
  );
}

// ---------------- 笔记 Tab（音乐 App 自己的笔记，按网易云账号隔离；不与备忘录互通——第十四轮反馈） ----------------

/** 单条音乐笔记 */
interface MusicNote {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

/** 独立存储键：每个网易云账号（含游客）各一份，与备忘录 App 完全无关 */
function musicNotesKey(): string {
  return `music-notes-data:${musicUid()}`;
}

function loadMusicNotes(): MusicNote[] {
  return (kvGet<MusicNote[]>(musicNotesKey()) ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveMusicNotes(list: MusicNote[]): void {
  kvSet(musicNotesKey(), list);
}

function NotesList() {
  const loginUid = useMusic((s) => s.loginUid);
  const [notes, setNotes] = useState<MusicNote[]>(() => loadMusicNotes());
  // 写笔记面板（标题 + 正文）
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  // 切换网易云账号（含登录/登出/游客切换）时重读当前账号的独立笔记（render 期派生重置，React 官方 adjust-state 模式）
  const [prevUid, setPrevUid] = useState(loginUid);
  if (prevUid !== loginUid) {
    setPrevUid(loginUid);
    setNotes(loadMusicNotes());
  }

  const createNote = () => {
    const title = draftTitle.trim();
    const content = draftBody.trim();
    if (!title && !content) return;
    const next = [{ id: `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, title, content, updatedAt: Date.now() }, ...loadMusicNotes()];
    saveMusicNotes(next);
    setNotes(next);
    setDraftTitle('');
    setDraftBody('');
    setComposerOpen(false);
  };

  const removeNote = (id: string) => {
    const next = loadMusicNotes().filter((n) => n.id !== id);
    saveMusicNotes(next);
    setNotes(next);
  };

  return (
    <div className="pb-[128px] pt-3" data-testid="music-mine-notes">
      {/* 写笔记入口（音乐 App 内创建，不进备忘录） */}
      <div className="flex justify-end px-4">
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          data-testid="music-mine-note-add"
          className="flex items-center gap-1 rounded-full bg-zinc-900 px-3.5 py-1.5 text-[12px] font-medium text-white active:scale-95 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Plus className="h-3.5 w-3.5" />
          写笔记
        </button>
      </div>
      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-12 text-zinc-400">
          <NotebookPen className="h-9 w-9 opacity-40" />
          <p className="text-[13px]">还没有笔记</p>
          <p className="text-[11px] text-zinc-300 dark:text-zinc-600">点击右上角「写笔记」，记录你和音乐的故事</p>
        </div>
      ) : (
        <div className="space-y-2 px-4 pt-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className="rounded-xl border border-white/60 bg-white/75 p-3.5 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/75"
              data-testid="music-mine-note-item"
            >
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
                  {n.title || '无标题笔记'}
                </p>
                <span className="shrink-0 text-[10px] text-zinc-400">
                  {new Date(n.updatedAt).getMonth() + 1}月{new Date(n.updatedAt).getDate()}日
                </span>
                <button
                  type="button"
                  onClick={() => removeNote(n.id)}
                  aria-label="删除笔记"
                  data-testid="music-mine-note-del"
                  className="shrink-0 text-zinc-300 active:scale-90 dark:text-zinc-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {n.content && (
                <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {n.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 写笔记面板（底部弹层：标题 + 正文 + 保存） */}
      {composerOpen && (
        <div className="absolute inset-0 z-[72] flex items-end" data-testid="music-mine-note-composer">
          <button type="button" aria-label="关闭" onClick={() => setComposerOpen(false)} className="absolute inset-0 bg-black/45" />
          <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 pb-8 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <div className="flex items-center justify-between px-5 pt-3">
              <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">写笔记</p>
              <button type="button" aria-label="关闭" onClick={() => setComposerOpen(false)} className="text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 pt-3">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="标题"
                data-testid="music-mine-note-title"
                className="w-full rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder="今天听到了什么想记下来的…"
                rows={5}
                data-testid="music-mine-note-body"
                className="mt-2.5 w-full resize-none rounded-xl bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={createNote}
                disabled={!draftTitle.trim() && !draftBody.trim()}
                data-testid="music-mine-note-save"
                className="mt-3 w-full rounded-full bg-[#EC4141] py-2.5 text-[14px] font-medium text-white disabled:opacity-40 active:scale-[0.99]"
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

// ---------------- 添加状态弹窗（网易云式底部面板：预设 + 输入） ----------------

const STATUS_PRESETS = ['🎧 正在听歌', '🌙 晚安中', '💻 工作中', '📖 看书中', '🎮 玩游戏中', '🚶 出门中'];

function StatusEditSheet({
  current,
  onSubmit,
  onClose,
}: {
  current: string;
  onSubmit: (t: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(current);
  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-status-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full rounded-t-2xl border-t border-white/60 bg-white/85 p-5 pb-[104px] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mb-3.5 h-1 w-8 rounded-full bg-black/10 dark:bg-white/20" />
        <p className="mb-4 text-center text-[16px] font-bold text-zinc-900 dark:text-zinc-100">添加状态</p>
        <div className="relative">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 20))}
            placeholder="记录此刻的状态…"
            data-testid="music-status-input"
            className="h-11 w-full rounded-xl border border-black/10 bg-white/70 px-3.5 pr-12 text-[14px] text-zinc-900 outline-none backdrop-blur-xl placeholder:text-zinc-400 focus:border-[#C20C0C]/50 dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-100"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-zinc-400">
            {text.length}/20
          </span>
        </div>
        <p className="mb-2 mt-4 text-[12px] text-zinc-400">挑一个现成的</p>
        <div className="flex flex-wrap gap-2">
          {STATUS_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setText(p.slice(0, 20))}
              data-testid={`music-status-preset-${STATUS_PRESETS.indexOf(p)}`}
              className={`rounded-full px-3 py-1.5 text-[12px] active:scale-95 ${
                text === p
                  ? 'bg-[#C20C0C]/10 text-[#C20C0C] ring-1 ring-[#C20C0C]/40'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onSubmit(text.trim().slice(0, 20))}
          data-testid="music-status-save"
          className="mt-5 h-11 w-full rounded-full bg-[#C20C0C] text-[14px] font-medium text-white active:scale-[0.98]"
        >
          保存
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onSubmit('')}
            data-testid="music-status-clear"
            className="mt-2.5 h-10 w-full rounded-full border border-black/10 text-[13px] text-zinc-500 active:scale-[0.98] dark:border-white/10 dark:text-zinc-400"
          >
            清除状态
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- kv 小工具 ----------------

function kvGetStr(key: string): string {
  return kvGet<string>(key) ?? '';
}

function kvSetStr(key: string, v: string): void {
  kvSet(key, v);
}

function kvGetIdx(key: string): number {
  const n = Number(kvGetStr(key));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function kvSetIdx(key: string, v: number): void {
  kvSetStr(key, String(v));
}
