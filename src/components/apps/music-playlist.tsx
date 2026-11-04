'use client';

/**
 * 音乐 App 歌单详情页：封面/信息/收藏与删除（自己创建的）/播放全部/曲目列表。
 * 支持特殊 kind：daily（每日推荐 /recommend/songs）、liked（我的红心云端）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Download,
  Loader2,
  Play,
  Plus,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import {
  dailyRecommendSongs,
  getMusicLogin,
  likeList,
  playlistDelete,
  playlistDetail,
  playlistSubscribe,
  songUrl,
  songsDetail,
  songArtistText,
  type NcmPlaylist,
  type NcmSong,
} from '@/lib/ios/music-api';
import { mediaProxyUrl, useMusic, getGuestPlaylists, guestPlaylistDelete, guestPlaylistRemoveSong } from '@/lib/ios/music-store';
import { CoverImg, EmptyBlock, LoadingBlock, SongRow, fmtPlayCount } from './music-shared';

export function MusicPlaylist() {
  const nav = useMusic((s) => s.nav);
  const closePlaylist = useMusic((s) => s.closePlaylist);
  const openPlayer = useMusic((s) => s.openPlayer);
  const playQueueAt = useMusic((s) => s.playQueueAt);
  const addToQueue = useMusic((s) => s.addToQueue);
  const queue = useMusic((s) => s.queue);
  const [info, setInfo] = useState<NcmPlaylist | null>(null);
  const [songs, setSongs] = useState<NcmSong[] | null>(null);
  const [subbed, setSubed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const current = useMusic((s) => s.current);

  const isDaily = nav.playlistKind === 'daily';
  const isLikedAll = nav.playlistKind === 'liked';
  const isGuestLocal = nav.playlistKind === 'guestLocal';

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      if (isGuestLocal) {
        // 游客本地歌单：kv 直读，同步加载
        const gid = nav.guestPlId;
        const pl = getGuestPlaylists().find((p) => p.id === gid);
        if (!pl) throw new Error('歌单不存在或已删除');
        const list = pl.songs;
        setSongs(list);
        setInfo({
          id: 0,
          name: pl.name,
          coverImgUrl: list[0]?.album?.picUrl ?? '',
          trackCount: list.length,
          copywriter: '本地歌单 · 数据保存在本机',
        });
      } else if (isDaily) {
        const list = await dailyRecommendSongs();
        setSongs(list);
        setInfo({
          id: 0,
          name: '每日推荐',
          coverImgUrl: list[0]?.album?.picUrl ?? '',
          trackCount: list.length,
          copywriter: '根据你的音乐口味生成 · 每日 6:00 更新',
        });
      } else if (isLikedAll) {
        const uid = useMusic.getState().loginUid;
        if (!uid) throw new Error('请先登录');
        const ids = await likeList(uid);
        const list: NcmSong[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const part = await songsDetail(ids.slice(i, i + 200));
          list.push(...part);
        }
        setSongs(list);
        setInfo({
          id: 0,
          name: '我的红心歌曲',
          coverImgUrl: list[0]?.album?.picUrl ?? '',
          trackCount: list.length,
          copywriter: '喜欢的音乐都在这里',
        });
      } else if (nav.playlistId) {
        const p = await playlistDetail(nav.playlistId);
        setInfo(p);
        setSubed(!!p.subscribed);
        const ids = (p.trackIds ?? []).map((t) => t.id);
        const list: NcmSong[] = [];
        for (let i = 0; i < ids.length; i += 300) {
          const part = await songsDetail(ids.slice(i, i + 300));
          list.push(...part);
        }
        setSongs(list);
      }
    } catch (e) {
      setErr((e as Error).message || '加载失败');
      setSongs([]);
    } finally {
      setBusy(false);
    }
  }, [isDaily, isLikedAll, isGuestLocal, nav.playlistId, nav.guestPlId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSub = async () => {
    if (!info?.id || !getMusicLogin()) return;
    try {
      await playlistSubscribe(info.id, subbed ? 2 : 1);
      setSubed(!subbed);
    } catch {
      // 保持
    }
  };

  const doDelete = async () => {
    if (isGuestLocal) {
      if (!confirm(`确定删除歌单「${info?.name}」？`)) return;
      guestPlaylistDelete(nav.guestPlId ?? '');
      closePlaylist();
      return;
    }
    if (!info?.id || !confirm(`确定删除歌单「${info.name}」？`)) return;
    try {
      await playlistDelete(info.id);
      closePlaylist();
    } catch {
      alert('删除失败');
    }
  };

  const removeLocalSong = (songId: number) => {
    if (!confirm('从歌单移除这首歌？')) return;
    guestPlaylistRemoveSong(nav.guestPlId ?? '', songId);
    void load(); // 重读本地歌单
  };

  const playAll = () => {
    if (!songs?.length) return;
    // 队列已包含本歌单且正播其中一首 → 直接回播放页
    const ids = new Set(songs.map((s) => s.id));
    const cur = useMusic.getState().current;
    if (cur && ids.has(cur.id)) {
      openPlayer();
      return;
    }
    addToQueue(songs);
    void playQueueAt(queue.length); // 从追加处开始播
    openPlayer();
  };

  const share = async () => {
    const text = info ? `「${info.name}」- 网易云歌单分享` : '歌单分享';
    try {
      if (navigator.share) await navigator.share({ title: text });
      else await navigator.clipboard.writeText(text);
    } catch {
      // 用户取消
    }
  };

  const download = async () => {
    const cur = useMusic.getState().current;
    if (!cur) {
      alert('先播放一首歌再下载');
      return;
    }
    try {
      const r = await songUrl(cur.id);
      if (!r.url) throw new Error('无法获取下载链接');
      const a = document.createElement('a');
      a.href = mediaProxyUrl(r.url);
      a.download = `${cur.name} - ${songArtistText(cur)}.mp3`;
      a.target = '_blank';
      a.click();
    } catch {
      alert('下载失败');
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F8F8F8] dark:bg-black">
      {/* 头部 */}
      <div className="relative z-10 flex items-center gap-2 px-4 pb-2 pt-[58px]">
        <button
          type="button"
          onClick={closePlaylist}
          data-testid="music-pl-back"
          aria-label="返回"
          className="text-zinc-700 dark:text-zinc-200"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-100">
          {info?.name ?? '歌单'}
        </span>
        <div className="ml-auto flex items-center gap-4">
          <button type="button" onClick={() => void share()} aria-label="分享">
            <Share2 className="h-[18px] w-[18px] text-zinc-600 dark:text-zinc-300" />
          </button>
          {!isDaily && !isLikedAll && info?.id ? (
            <button
              type="button"
              onClick={() => void toggleSub()}
              data-testid="music-pl-sub"
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[11px] ${
                subbed ? 'border-zinc-300 text-zinc-500' : 'border-[#C20C0C] text-[#C20C0C]'
              }`}
            >
              {/* 横向胶囊（第二十九轮反馈）：图标 + 文字左右排列，仿网易云「＋收藏 / ✓已收藏」 */}
              {subbed ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {subbed ? '已收藏' : '收藏'}
            </button>
          ) : null}
          {!isDaily && !isLikedAll && info && (isGuestLocal || (info.creator?.userId === useMusic.getState().loginUid && info.specialType !== 5)) ? (
            <button type="button" onClick={() => void doDelete()} aria-label="删除歌单" data-testid="music-pl-del">
              <Trash2 className="h-[18px] w-[18px] text-red-500" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[76px]">
        {/* 信息区 */}
        <div className="flex items-start gap-4 px-4 pb-3">
          <CoverImg
            src={info?.coverImgUrl}
            className="h-[110px] w-[110px] shadow-sm"
            rounded="rounded-xl"
            alt={info?.name ?? '歌单封面'}
          />
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-[16px] font-bold leading-snug text-zinc-900 dark:text-zinc-100">
              {info?.name ?? '…'}
            </p>
            {info?.copywriter && (
              <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">
                {info.copywriter}
              </p>
            )}
            {info?.creator?.nickname && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-400">
                <Users className="h-3 w-3" />
                {info.creator.nickname}
              </p>
            )}
            <p className="mt-1 text-[11px] text-zinc-400">
              {songs ? `${songs.length} 首` : ''} {info?.playCount ? `· ${fmtPlayCount(info.playCount)}次播放` : ''}
            </p>
          </div>
        </div>

        {/* 播放全部 */}
        <div className="mx-4 mb-1 flex items-center gap-2.5">
          <button
            type="button"
            onClick={playAll}
            disabled={!songs?.length}
            data-testid="music-pl-playall"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#C20C0C] py-2.5 text-[14px] font-medium text-white disabled:opacity-40 active:scale-[0.98]"
          >
            <Play className="h-4 w-4" fill="currentColor" />
            播放全部
          </button>
          <button
            type="button"
            onClick={() => void download()}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white/75 text-zinc-600 shadow-[0_4px_16px_rgba(0,0,0,0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-800/70 dark:text-zinc-300"
            aria-label="下载当前歌曲"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>

        {err && <p className="px-4 py-3 text-center text-[12px] text-red-500">{err}</p>}
        {busy && songs === null && <LoadingBlock />}
        {songs && songs.length === 0 && !busy && <EmptyBlock text={err ? '加载失败' : '歌单是空的'} />}
        {songs && songs.length > 0 && (
          <div className="pt-1" data-testid="music-pl-songs">
            {songs.map((s, i) => (
              <SongRow
                key={`${s.id}-${i}`}
                song={s}
                queue={songs}
                index={i}
                showAlbum
                onMore={isGuestLocal ? () => removeLocalSong(s.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* （原右下角红色「当前播放」悬浮球已按反馈删除：迷你播放条已全局常驻，功能重复且挡内容） */}

      {busy && (
        <div className="pointer-events-none absolute left-1/2 top-[70px] z-20 -translate-x-1/2">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      )}

      {/* 底部留白（home indicator） */}
      <div className="h-[20px] shrink-0" />
    </div>
  );
}
