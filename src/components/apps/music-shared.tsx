'use client';

/**
 * 音乐 App 共用 UI 小件：封面图（http 直链走同源代理）、歌曲行、格式化、
 * 底部 TabBar、迷你播放条、区块标题、加载/空态。
 */

import { useEffect, useState } from 'react';
import {
  Disc3,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import {
  mediaProxyUrl,
  useMusic,
  getGuestPlaylists,
  getGuestAvatar,
  guestPlaylistAddSong,
  guestPlaylistCreate,
  type MusicNav,
} from '@/lib/ios/music-store';
import { useTogetherLive } from '@/lib/ios/music-ai';
import {
  songAlbumText,
  songArtistText,
  songCover,
  getMusicLogin,
  userPlaylists,
  playlistAddTracks,
  playlistCreate,
  NcmError,
  type NcmSong,
} from '@/lib/ios/music-api';
import { VipSongBadge } from './music-vip-badge'; // v59：歌单 VIP 角标统一「我的」页同款黑胶唱片胶囊

// ---------------- 格式化 ----------------

export function fmtPlayCount(n?: number): string {
  if (!n || n <= 0) return '';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  return `${n}`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---------------- 封面 ----------------

export function coverSrc(picUrl?: string): string {
  if (!picUrl) return '';
  if (picUrl.startsWith('http://')) return mediaProxyUrl(picUrl);
  return picUrl;
}

export function CoverImg({
  src,
  className = '',
  rounded = '',
  alt = '',
}: {
  src?: string;
  className?: string;
  rounded?: string;
  alt?: string;
}) {
  const url = coverSrc(src);
  // 失败态与 url 绑定存一起，url 变化在渲染期重置（React「无需 Effect」模式，
  // 避免 effect 里 setState；换头像/封面后重新尝试加载）
  const [state, setState] = useState({ url, failed: false });
  if (state.url !== url) setState({ url, failed: false });
  const failed = state.url === url && state.failed;
  // 无图或加载失败（外链失效/网络不可达）都不显示浏览器破图：
  // 有名字 → 首字占位（头像破了仍能认出是谁）；无名字 → 唱片图标占位
  if (!url || failed) {
    const ch = (alt || '').trim().slice(0, 1);
    if (ch) {
      return (
        <div
          role="img"
          aria-label={alt}
          className={`flex items-center justify-center bg-zinc-300 text-[13px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 ${rounded} ${className}`}
        >
          {ch}
        </div>
      );
    }
    return (
      <div
        className={`flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 ${rounded} ${className}`}
      >
        <Disc3 className="h-5 w-5 text-zinc-400 dark:text-zinc-600" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt || '封面'}
      loading="lazy"
      className={`object-cover bg-zinc-200 dark:bg-zinc-800 ${rounded} ${className}`}
      draggable={false}
      onError={() => setState({ url, failed: true })}
    />
  );
}

// ---------------- 歌曲行 ----------------

export function SongRow({
  song,
  queue,
  index,
  showAlbum = false,
  onMore,
}: {
  song: NcmSong;
  queue: NcmSong[];
  index?: number;
  showAlbum?: boolean;
  onMore?: (song: NcmSong) => void;
}) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const playSong = useMusic((s) => s.playSong);
  const [addOpen, setAddOpen] = useState(false);
  const active = current?.id === song.id;
  return (
    <>
      <button
        type="button"
        onClick={() => void playSong(song, queue)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-black/5 dark:active:bg-white/10"
      >
        {typeof index === 'number' && (
          <span
            className={`w-6 shrink-0 text-center text-[15px] tabular-nums ${
              active ? 'text-[#C20C0C]' : 'text-zinc-400'
            }`}
          >
            {index + 1}
          </span>
        )}
        <div className="relative shrink-0">
          <CoverImg src={songCover(song)} className="h-11 w-11" rounded="rounded-lg" alt={song.name} />
          {active && (
            <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
              {playing ? (
                <Pause className="h-4 w-4 text-white" fill="currentColor" />
              ) : (
                <Play className="h-4 w-4 text-white" fill="currentColor" />
              )}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[15px] leading-tight ${active ? 'text-[#C20C0C]' : 'text-zinc-900 dark:text-zinc-100'}`}
          >
            {song.name}
          </div>
          <div className="mt-0.5 truncate text-[12px] leading-tight text-zinc-500">
            {songArtistText(song)}
            {showAlbum && songAlbumText(song) ? ` · ${songAlbumText(song)}` : ''}
          </div>
        </div>
        {song.fee === 1 && <VipSongBadge />}
        {onMore ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onMore(song);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onMore(song);
              }
            }}
            className="shrink-0 px-2 py-1 text-zinc-400"
          >
            ⋯
          </span>
        ) : (
          <span
            role="button"
            tabIndex={0}
            aria-label="收藏到歌单"
            onClick={(e) => {
              e.stopPropagation();
              setAddOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                setAddOpen(true);
              }
            }}
            data-testid={`music-song-add-${song.id}`}
            className="shrink-0 px-2 py-1 text-zinc-400"
          >
            <ListPlus className="h-4 w-4" />
          </span>
        )}
      </button>
      {addOpen && <AddToSongSheet song={song} onClose={() => setAddOpen(false)} />}
    </>
  );
}

// ---------------- 收藏到歌单面板（仿网易云：网格封面 + 新建歌单） ----------------

export function AddToSongSheet({ song, onClose }: { song: NcmSong; onClose: () => void }) {
  const loginUid = useMusic((s) => s.loginUid);
  const likedIds = useMusic((s) => s.likedIds);
  const toggleLike = useMusic((s) => s.toggleLike);
  const [lists, setLists] = useState<{ id: string | number; name: string; count: number; pic?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 1400);
  };

  useEffect(() => {
    void (async () => {
      try {
        if (loginUid) {
          const pls = await userPlaylists(loginUid);
          setLists(
            pls
              .filter((p) => p.creator?.userId === loginUid && p.specialType !== 5)
              .slice(0, 20)
              .map((p) => ({ id: p.id, name: p.name, count: p.trackCount, pic: p.coverImgUrl })),
          );
        } else {
          setLists(
            getGuestPlaylists().map((p) => ({
              id: p.id,
              name: p.name,
              count: p.songs.length,
              pic: p.songs[0]?.album?.picUrl,
            })),
          );
        }
      } catch {
        setLists([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loginUid]);

  const addTo = async (id: string | number, name: string) => {
    try {
      if (loginUid && typeof id === 'number') {
        await playlistAddTracks(id, [song.id]);
      } else {
        if (!guestPlaylistAddSong(String(id), song)) {
          showToast('已在这个歌单里啦');
          return;
        }
      }
      showToast(`已加入「${name}」`);
      setTimeout(onClose, 700);
    } catch (e) {
      // v58：网易云重复添加（code 512）→ 友好提示；其余真实错误消息优先于笼统的「加入失败」
      if (e instanceof NcmError && e.code === 512) {
        showToast('这首歌已经在歌单里啦');
        setTimeout(onClose, 700);
        return;
      }
      showToast(e instanceof Error && e.message ? `加入失败：${e.message}` : '加入失败');
    }
  };

  const liked = likedIds.has(song.id);

  return (
    <div className="absolute inset-0 z-[80] flex items-end" data-testid="music-addto-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[72%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
        <div className="mx-auto mt-2.5 h-1 w-8 shrink-0 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">添加到歌单</p>
          <button
            type="button"
            onClick={() => showToast('长按封面可拖动排序')}
            className="text-[13px] text-zinc-400 active:opacity-70"
          >
            管理
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[100px] pt-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              {/* 新建歌单 */}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                data-testid="music-addto-new"
                className="flex flex-col items-center gap-1.5"
              >
                <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/60">
                  <Plus className="h-6 w-6 text-[#C20C0C]" />
                </span>
                <span className="w-full truncate text-center text-[11px] text-zinc-500 dark:text-zinc-400">新建歌单</span>
              </button>
              {/* 我喜欢的音乐（红心） */}
              <button
                type="button"
                onClick={() => {
                  void toggleLike(song);
                  showToast(liked ? '已取消红心' : '已加入红心歌曲');
                }}
                data-testid="music-addto-like"
                className="flex flex-col items-center gap-1.5"
              >
                <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-zinc-400 dark:bg-zinc-700">
                  <Heart className="h-7 w-7 text-white" fill="currentColor" />
                  {liked && <span className="absolute inset-0 bg-black/25" />}
                </span>
                <span className="w-full truncate text-center text-[11px] text-zinc-500 dark:text-zinc-400">我喜欢的音乐</span>
              </button>
              {/* 我的歌单 */}
              {lists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void addTo(l.id, l.name)}
                  data-testid={`music-addto-pl-${l.id}`}
                  className="flex flex-col items-center gap-1.5"
                >
                  <CoverImg src={l.pic} className="aspect-square w-full" rounded="rounded-lg" alt={l.name} />
                  <span className="w-full truncate text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                    {l.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {toast && (
          <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-[12px] text-white">
            {toast}
          </div>
        )}
      </div>
      {createOpen && (
        <PlaylistCreateDialog
          onClose={() => setCreateOpen(false)}
          onSubmit={async (name, privacy) => {
            if (loginUid) {
              const id = await playlistCreate(name, privacy ? 10 : 0);
              await addTo(id, name);
            } else {
              const pl = guestPlaylistCreate(name);
              guestPlaylistAddSong(pl.id, song);
              showToast(`已加入「${pl.name}」`);
              setTimeout(onClose, 700);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------- 新建歌单弹窗（仿网易云居中卡片：输入 + 隐私 + 取消/创建） ----------------

export function PlaylistCreateDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  /** 创建（失败请抛错，弹窗内展示）；成功后弹窗自动关闭 */
  onSubmit: (name: string, privacy: boolean) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSubmit(n, privacy);
      onClose();
    } catch (e) {
      setErr((e as Error).message || '创建失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[82] flex items-center justify-center px-9" data-testid="music-pl-create-dialog">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-[310px] overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/85">
        <p className="pt-5 text-center text-[16px] font-bold text-zinc-900 dark:text-zinc-100">新建歌单</p>
        <div className="px-5 pt-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="输入歌单名字"
            data-testid="music-pl-create-name"
            className="h-10 w-full rounded-lg bg-white/70 px-3 text-[14px] text-zinc-900 outline-none backdrop-blur-xl placeholder:text-zinc-400 dark:bg-zinc-700/80 dark:text-zinc-100"
          />
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
              data-testid="music-pl-create-privacy"
              className="h-[15px] w-[15px] accent-[#C20C0C]"
            />
            设为隐私歌单
          </label>
          {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
        </div>
        <div className="mt-5 flex border-t border-black/5 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            data-testid="music-pl-create-cancel"
            className="flex-1 border-r border-black/5 py-[13px] text-[15px] text-zinc-500 active:bg-black/5 dark:border-white/10 dark:text-zinc-400 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || busy}
            data-testid="music-pl-create-submit"
            className="flex flex-1 items-center justify-center gap-1.5 py-[13px] text-[15px] font-medium text-[#C20C0C] active:bg-[#C20C0C]/5 disabled:text-zinc-300 dark:disabled:text-zinc-600"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 区块标题 ----------------

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-5">
      <h2 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100">{children}</h2>
      {right}
    </div>
  );
}

// ---------------- 加载/空态 ----------------

export function LoadingBlock({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-zinc-400">
      <Disc3 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
      <Disc3 className="h-8 w-8 opacity-40" />
      <p className="text-[13px]">{text}</p>
    </div>
  );
}

// ---------------- 底部 TabBar ----------------

const TABS: { key: MusicNav['tab']; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'heart', label: '心动' },
  { key: 'search', label: '搜索' },
  { key: 'mine', label: '我的' },
];

/** 底部 TabBar：毛玻璃悬浮胶囊（第四十三轮，样式对齐 couple-space/淘宝/美团胶囊条）：
 *  纯文字（无图标），激活项加浅红胶囊底 + 品牌红字，未激活灰；胶囊壳自带磨砂 + 柔影 */
export function MusicTabBar() {
  const tab = useMusic((s) => s.nav.tab);
  const setTab = useMusic((s) => s.setTab);
  return (
    <nav
      className="pointer-events-auto flex h-[46px] shrink-0 items-stretch rounded-[24px] border border-white/60 bg-white/80 shadow-[0_10px_36px_rgba(0,0,0,0.16)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/75"
      data-testid="music-tabbar"
    >
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`music-tab-${t.key}`}
            className={`mx-1 my-1.5 flex flex-1 items-center justify-center rounded-full transition-all active:opacity-70 ${
              active
                ? 'bg-[#C20C0C]/10 font-bold text-[#C20C0C] dark:bg-[#FF5A5A]/15 dark:text-[#FF6B6B]'
                : 'font-medium text-zinc-400 dark:text-zinc-500'
            }`}
          >
            <span className="text-[16px] leading-none">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------- 迷你播放条（白色圆角胶囊包裹；一起听时左侧双头像） ----------------

export function MiniBar() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const toggle = useMusic((s) => s.toggle);
  const openPlayer = useMusic((s) => s.openPlayer);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  // 一起听会话（跟随全局联系人资料）
  const live = useTogetherLive();
  // 播放进度（圆环用）：深色=已播，浅灰=未播，从 12 点方向顺时针
  const progress = current && duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const CIRC = 2 * Math.PI * 12.5;
  if (!current) return null;
  return (
    <div
      className="pointer-events-auto mx-3 mb-1.5 flex h-[42px] shrink-0 items-center rounded-full border border-white/60 bg-white/80 pl-1 pr-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-800/80 dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
      data-testid="music-minibar"
    >
      <button
        type="button"
        onClick={openPlayer}
        data-testid="music-minibar-open"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {live ? (
          // 一起听：前面显示两个人的头像（重叠）
          <span className="flex shrink-0 items-center" data-testid="music-minibar-tg-avatars">
            <CoverImg
              src={live.avatar}
              className="h-[34px] w-[34px]"
              rounded="rounded-full"
              alt={live.name}
            />
            <CoverImg
              src={loginUid ? loginAvatar : getGuestAvatar()}
              className="-ml-2.5 h-[34px] w-[34px] ring-2 ring-white/80 dark:ring-zinc-800/80"
              rounded="rounded-full"
              alt="我"
            />
          </span>
        ) : (
          <CoverImg src={songCover(current)} className="h-[34px] w-[34px]" rounded="rounded-full" alt={current.name} />
        )}
        {/* 单行：歌名加粗 + 「 - 歌手」灰字（按截图）；第三十五轮内容整体缩小一号 */}
        <span className="min-w-0 flex-1 truncate text-[12px] leading-none">
          <span className="font-bold text-zinc-900 dark:text-zinc-100">{current.name}</span>
          <span className="text-zinc-400 dark:text-zinc-500"> - {songArtistText(current)}</span>
        </span>
      </button>
      {/* 圆环暂停键（按截图：进度环包裹 + 实心暂停/播放图标——深色弧段=已播进度，
          浅灰整圆=未播轨道，从 12 点方向顺时针；无歌/未知时长时退化为纯灰描边圈） */}
      <button
        type="button"
        onClick={toggle}
        data-testid="music-minibar-toggle"
        className="relative mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-zinc-800 active:scale-95 dark:text-zinc-100"
        aria-label={playing ? '暂停' : '播放'}
      >
        <svg viewBox="0 0 28 28" aria-hidden="true" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="14" cy="14" r="12.5" fill="none" strokeWidth="2.5" className="stroke-zinc-300 dark:stroke-zinc-600" />
          {progress > 0 && (
            <circle
              cx="14"
              cy="14"
              r="12.5"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              className="stroke-zinc-800 transition-[stroke-dashoffset] duration-300 dark:stroke-zinc-100"
            />
          )}
        </svg>
        {playing ? (
          <Pause className="h-3 w-3" fill="currentColor" />
        ) : (
          <Play className="ml-0.5 h-3 w-3" fill="currentColor" />
        )}
      </button>
      {/* 播放列表入口 */}
      <button
        type="button"
        onClick={openPlayer}
        aria-label="播放列表"
        data-testid="music-minibar-queue"
        className="flex h-7 w-6 shrink-0 items-center justify-center text-zinc-800 active:scale-95 dark:text-zinc-100"
      >
        <ListMusic className="h-[17px] w-[17px]" />
      </button>
    </div>
  );
}

// ---------------- 时间轴 hook（一起听时长等用） ----------------

export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function LikeIcon({ liked, className = '' }: { liked: boolean; className?: string }) {
  return (
    <Heart
      className={`${className} ${liked ? 'text-[#C20C0C]' : 'text-zinc-400 dark:text-zinc-500'}`}
      fill={liked ? 'currentColor' : 'none'}
    />
  );
}
