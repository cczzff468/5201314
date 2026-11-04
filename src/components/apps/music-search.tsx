'use client';

/**
 * 音乐 App 搜索页（1:1 对标网易云搜索首屏）：
 * - 返回 + 胶囊搜索框（放大镜 + 热词轮播 placeholder + 「搜索」钮）
 * - 五宫格分类：歌手 / 曲风 / 专区 / 识曲 / 听书
 * - 搜索历史（可清空、可收起）→ 猜你喜欢（可换一批）→ 热搜榜 / 热歌榜 横滑卡片
 * 搜索后进入结果 tab（单曲/歌手/歌单/专辑）；歌手/专辑点开半屏面板。
 * 搜索历史按账号/角色隔离存 IndexedDB。
 */

import { useEffect, useRef, useState } from 'react';
import { classifyChatError } from '@/lib/chat-errors';
import {
  ArrowUp,
  AudioLines,
  BookOpenText,
  ChevronDown,
  ChevronLeft,
  LayoutGrid,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  artistSongs,
  artistSub,
  albumDetail,
  albumSub,
  hotSearch,
  search,
  getMusicLogin,
  toplist,
  toplistTracks,
  type HotSearchItem,
  type NcmAlbum,
  type NcmArtist,
  type NcmSong,
  type NcmToplist,
  type SearchType,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  CoverImg,
  EmptyBlock,
  LoadingBlock,
  SongRow,
  fmtPlayCount,
} from './music-shared';

type ResultTab = 'song' | 'artist' | 'playlist' | 'album';

const TABS: { key: ResultTab; label: string; type: SearchType }[] = [
  { key: 'song', label: '单曲', type: 1 },
  { key: 'artist', label: '歌手', type: 10 },
  { key: 'playlist', label: '歌单', type: 1000 },
  { key: 'album', label: '专辑', type: 100 },
];

/** 猜你喜欢兜底词（热搜不足时补位） */
const GUESS_FALLBACK = ['孙燕姿', '洱海', '梦幻诛仙', '许嵩', '同花顺', '同手同脚', '告五人', '唯一', '爱人的眼睛', '汪苏泷'];

const histKeyOf = (scope: string) => `music-search-hist:${scope}`;

export function MusicSearch() {
  const loginUid = useMusic((s) => s.loginUid);
  const guestMode = useMusic((s) => s.guestMode);
  const setTab = useMusic((s) => s.setTab);
  const openPlaylist = useMusic((s) => s.openPlaylist);
  const scope = loginUid ? `u${loginUid}` : `guest${guestMode ? '' : '-anon'}`;

  const [input, setInput] = useState('');
  const [hot, setHot] = useState<HotSearchItem[]>([]);
  const [hotSongsTop, setHotSongsTop] = useState<NcmToplist | null>(null);
  const [tab, setRtab] = useState<ResultTab>('song');
  const [loading, setLoading] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [histOpen, setHistOpen] = useState(true);
  const [guessSeed, setGuessSeed] = useState(0);
  const [toast, setToast] = useState('');
  const [results, setResults] = useState<{
    songs: NcmSong[];
    artists: NcmArtist[];
    playlists: { id: number; name: string; coverImgUrl: string; playCount?: number }[];
    albums: NcmAlbum[];
  } | null>(null);
  const [sheet, setSheet] = useState<
    | { kind: 'artist'; artist: NcmArtist; songs: NcmSong[]; subed: boolean }
    | { kind: 'album'; album: NcmAlbum; songs: NcmSong[]; subed: boolean }
    | null
  >(null);
  const lastQueryRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 热词轮播 placeholder
  const [phIdx, setPhIdx] = useState(0);
  const hotWords = hot.map((h) => h.searchWord);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 1400);
  };

  // Task 40：网络类失败的统一友好文案（不发原始报错）
  const netFailToast = (err: unknown) => {
    showToast(classifyChatError(err instanceof Error && err.message ? err.message : String(err ?? '')).text);
  };

  // 首屏数据：热搜 + 热歌榜
  useEffect(() => {
    void (async () => {
      try {
        setHot((await hotSearch()).slice(0, 10));
      } catch (err) {
        setHot([]);
        netFailToast(err); // Task 40：热搜拉取失败不再静默置空
      }
      // 热歌榜：/toplist 的 tracks 已被网易置空（恒 null）→ 拿到榜单后用 playlist/detail+song/detail 补曲目；
      // toplist 整体失败时也直接走兜底通道拉热歌榜（3778678）
      try {
        const tops = await toplist();
        const board = tops.find((t) => t.id === 3778678 || t.name === '热歌榜') ?? tops[0] ?? null;
        if (board) {
          if (!board.tracks?.length) board.tracks = await toplistTracks(board.id, 8);
          setHotSongsTop(board);
        } else {
          setHotSongsTop({ id: 3778678, name: '热歌榜', tracks: await toplistTracks(3778678, 8) });
        }
      } catch {
        try {
          setHotSongsTop({ id: 3778678, name: '热歌榜', tracks: await toplistTracks(3778678, 8) });
        } catch {
          setHotSongsTop(null);
        }
      }
    })();
  }, []);

  // 读搜索历史（账号/游客隔离）
  useEffect(() => {
    setHist((kvGet<string[]>(histKeyOf(scope)) ?? []).slice(0, 10));
  }, [scope]);

  // 热搜轮播
  useEffect(() => {
    if (hot.length < 2) return;
    const t = setInterval(() => setPhIdx((i) => (i + 1) % Math.min(5, hot.length)), 5000);
    return () => clearInterval(t);
  }, [hot.length]);

  const saveHist = (kw: string) => {
    const next = [kw, ...hist.filter((h) => h !== kw)].slice(0, 10);
    setHist(next);
    kvSet(histKeyOf(scope), next);
  };

  const doSearch = async (kw: string, t: ResultTab) => {
    if (!kw.trim()) return;
    lastQueryRef.current = kw;
    setLoading(true);
    setResults(null);
    try {
      const conf = TABS.find((x) => x.key === t)!;
      const r = await search(kw, conf.type, 30);
      setResults({ songs: r.songs, artists: r.artists, playlists: r.playlists, albums: r.albums });
    } catch (err) {
      setResults({ songs: [], artists: [], playlists: [], albums: [] });
      netFailToast(err); // Task 40：搜索失败不再静默置空
    } finally {
      setLoading(false);
    }
  };

  const submit = (kw?: string) => {
    const q = (kw ?? input).trim();
    if (!q) return;
    setInput(q);
    saveHist(q);
    void doSearch(q, tab);
  };

  const changeTab = (t: ResultTab) => {
    setRtab(t);
    if (lastQueryRef.current) void doSearch(lastQueryRef.current, t);
  };

  const openArtist = async (a: NcmArtist) => {
    setSheet({ kind: 'artist', artist: a, songs: [], subed: false });
    try {
      const r = await artistSongs(a.id);
      setSheet({ kind: 'artist', artist: r.artist, songs: r.songs, subed: false });
    } catch (err) {
      setSheet((s) => (s && s.kind === 'artist' ? { ...s, songs: [] } : s));
      netFailToast(err); // Task 40：歌手热门歌曲加载失败提示
    }
  };

  const openAlbum = async (a: NcmAlbum) => {
    setSheet({ kind: 'album', album: a, songs: [], subed: false });
    try {
      const r = await albumDetail(a.id);
      setSheet({ kind: 'album', album: r.album, songs: r.songs, subed: false });
    } catch (err) {
      setSheet((s) => (s && s.kind === 'album' ? { ...s, songs: [] } : s));
      netFailToast(err); // Task 40：专辑详情加载失败提示
    }
  };

  const toggleSub = async () => {
    if (!sheet) return;
    if (!getMusicLogin()) {
      // 游客：仅本地切换（不持久化到云端）
      setSheet((s) => (s ? { ...s, subed: !s.subed } : s));
      return;
    }
    try {
      if (sheet.kind === 'artist') {
        await artistSub(sheet.artist.id, sheet.subed ? 2 : 1);
      } else {
        await albumSub(sheet.album.id, sheet.subed ? 2 : 1);
      }
      setSheet((s) => (s ? { ...s, subed: !s.subed } : s));
    } catch {
      // 失败保持
    }
  };

  // 猜你喜欢：热搜池轮换取 6 个
  const guessPool = hotWords.length >= 6 ? hotWords : GUESS_FALLBACK;
  const guess = Array.from({ length: Math.min(6, guessPool.length) }, (_, i) => guessPool[(guessSeed * 2 + i) % guessPool.length]);

  const categories = [
    { key: 'artist', label: '歌手', icon: <UserRound className="h-[24px] w-[24px]" />, on: () => inputRef.current?.focus() },
    { key: 'genre', label: '曲风', icon: <AudioLines className="h-[24px] w-[24px]" />, on: () => showToast('曲风专区上线中，敬请期待') },
    { key: 'zone', label: '专区', icon: <LayoutGrid className="h-[24px] w-[24px]" />, on: () => showToast('专区上线中，敬请期待') },
    { key: 'recognize', label: '识曲', icon: <Mic className="h-[24px] w-[24px]" />, on: () => showToast('播放一段旋律即可识别歌曲（演示）') },
    { key: 'audiobook', label: '听书', icon: <BookOpenText className="h-[24px] w-[24px]" />, on: () => showToast('听书专区上线中，敬请期待') },
  ];

  const hotSongs = hotSongsTop?.tracks?.slice(0, 8) ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* 搜索栏：胶囊框（放大镜 + 热词轮播 + 搜索钮）；返回键已删除（第三十三轮反馈） */}
      <div className="sticky top-0 z-20 bg-[#F8F8F8]/95 px-4 pb-2 pt-[54px] backdrop-blur-xl dark:bg-black/95">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[38px] min-w-0 flex-1 items-center rounded-full border border-white/60 bg-white/75 px-3 ring-1 ring-black/[0.06] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/75 dark:ring-white/10">
            <Search className="h-[17px] w-[17px] shrink-0 text-zinc-500 dark:text-zinc-400" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={input ? '' : hotWords[phIdx] || '搜索歌曲、歌手、歌单、专辑'}
              data-testid="music-search-input"
              className="ml-2 min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            {input && (
              <button type="button" onClick={() => setInput('')} aria-label="清空" className="shrink-0">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            )}
            <span className="mx-2 h-[14px] w-px shrink-0 bg-black/10 dark:bg-white/15" />
            <button
              type="button"
              onClick={() => submit()}
              data-testid="music-search-go"
              className="shrink-0 text-[14px] font-semibold text-zinc-900 active:scale-95 dark:text-zinc-100"
            >
              搜索
            </button>
          </div>
        </div>
        {/* 结果 tab（搜索后出现） */}
        {results && (
          <div className="mt-2 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => changeTab(t.key)}
                className={`rounded-full px-3.5 py-1 text-[12px] ${
                  tab === t.key
                    ? 'bg-[#C20C0C] text-white'
                    : 'bg-black/5 text-zinc-500 dark:bg-white/10 dark:text-zinc-400'
                }`}
                data-testid={`music-search-tab-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[126px]">
        {/* ============ 搜索前：发现页（分类/历史/猜你喜欢/榜单卡） ============ */}
        {!results && !loading && (
          <>
            {/* 五宫格分类 */}
            <div className="grid grid-cols-5 px-4 pb-1 pt-4" data-testid="music-search-cats">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.on}
                  data-testid={`music-search-cat-${c.key}`}
                  className="flex flex-col items-center gap-1.5 active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-zinc-800 dark:text-zinc-200">
                    {c.icon}
                  </span>
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-400">{c.label}</span>
                </button>
              ))}
            </div>

            {/* 搜索历史 */}
            <div className="px-4 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">搜索历史</p>
                <div className="flex items-center gap-2">
                  {hist.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setHist([]);
                        kvSet(histKeyOf(scope), []);
                      }}
                      aria-label="清空搜索历史"
                      data-testid="music-search-hist-clear"
                      className="text-zinc-400 active:scale-90"
                    >
                      <Trash2 className="h-[17px] w-[17px]" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setHistOpen((v) => !v)}
                    aria-label={histOpen ? '收起' : '展开'}
                    className="text-zinc-400 active:scale-90"
                  >
                    <ChevronDown className={`h-[17px] w-[17px] transition-transform ${histOpen ? '' : '-rotate-90'}`} />
                  </button>
                </div>
              </div>
              {hist.length === 0 ? (
                <p className="py-1 text-[12px] text-zinc-400">还没有搜索记录</p>
              ) : (
                <div
                  className={`flex gap-2 overflow-hidden ${histOpen ? 'flex-wrap' : 'h-[32px] flex-nowrap'}`}
                  data-testid="music-search-hist"
                >
                  {hist.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => submit(h)}
                      className="shrink-0 rounded-full bg-black/[0.05] px-3.5 py-1.5 text-[13px] text-zinc-700 active:scale-95 dark:bg-white/10 dark:text-zinc-300"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 猜你喜欢 */}
            <div className="px-4 pt-5">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">猜你喜欢</p>
                <button
                  type="button"
                  onClick={() => setGuessSeed((s) => s + 1)}
                  aria-label="换一批"
                  data-testid="music-search-guess-refresh"
                  className="text-zinc-400 active:rotate-90 active:scale-90 transition-transform"
                >
                  <RefreshCw className="h-[16px] w-[16px]" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4" data-testid="music-search-guess">
                {guess.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => submit(g)}
                    className="truncate py-2 text-left text-[15px] text-zinc-800 active:opacity-60 dark:text-zinc-200"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* 热搜榜 / 热歌榜 横滑卡片 */}
            <div className="no-scrollbar mt-2 flex gap-3 overflow-x-auto px-4" data-testid="music-search-boards">
              {/* 热搜榜 */}
              <div className="w-[82%] shrink-0 rounded-2xl border border-white/60 bg-white/75 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/75" data-testid="music-search-hotboard">
                <div className="flex items-center gap-2.5 border-b border-black/[0.06] pb-3 dark:border-white/10">
                  <p className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100">热搜榜</p>
                  <button
                    type="button"
                    onClick={() => hotWords[0] && submit(hotWords[0])}
                    className="flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-zinc-600 active:scale-95 dark:bg-white/10 dark:text-zinc-300"
                  >
                    <Play className="h-3 w-3" fill="currentColor" />
                    播放
                  </button>
                </div>
                {hot.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-zinc-400">热搜获取失败</p>
                ) : (
                  hot.slice(0, 8).map((h, i) => (
                    <button
                      key={h.searchWord}
                      type="button"
                      onClick={() => submit(h.searchWord)}
                      data-testid={`music-search-hot-${i}`}
                      className="flex w-full items-center gap-3 py-[9px] text-left active:opacity-60"
                    >
                      <span
                        className={`w-[18px] shrink-0 text-center text-[15px] tabular-nums ${
                          i < 3 ? 'font-bold text-[#EC4141]' : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
                        {h.searchWord}
                      </span>
                      {i === 0 && (
                        <span className="shrink-0 rounded-[3px] bg-[#EC4141] px-[3px] text-[9px] font-bold leading-[14px] text-white">爆</span>
                      )}
                      {i === 2 && <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[#EC4141]" />}
                    </button>
                  ))
                )}
              </div>

              {/* 热歌榜 */}
              <div className="w-[82%] shrink-0 rounded-2xl border border-white/60 bg-white/75 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/75" data-testid="music-search-songboard">
                <div className="flex items-center gap-2.5 border-b border-black/[0.06] pb-3 dark:border-white/10">
                  <p className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100">{hotSongsTop?.name ?? '热歌榜'}</p>
                  <button
                    type="button"
                    onClick={() => hotSongsTop && openPlaylist(hotSongsTop.id)}
                    className="flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-zinc-600 active:scale-95 dark:bg-white/10 dark:text-zinc-300"
                  >
                    <Play className="h-3 w-3" fill="currentColor" />
                    播放
                  </button>
                </div>
                {hotSongs.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-zinc-400">榜单获取失败</p>
                ) : (
                  hotSongs.map((t, i) => (
                    <button
                      key={`${t.first}-${i}`}
                      type="button"
                      onClick={() => submit(t.first)}
                      className="flex w-full items-center gap-3 py-[9px] text-left active:opacity-60"
                    >
                      <span
                        className={`w-[18px] shrink-0 text-center text-[15px] tabular-nums ${
                          i < 3 ? 'font-bold text-[#EC4141]' : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
                        {t.first}
                      </span>
                      <span className="max-w-[80px] shrink-0 truncate text-[11px] text-zinc-400">{t.second}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {loading && <LoadingBlock />}

        {/* 单曲 */}
        {results && tab === 'song' && (
          <div className="pt-1" data-testid="music-search-songs">
            {results.songs.length === 0 ? <EmptyBlock text="没有找到相关歌曲" /> : results.songs.map((s, i) => <SongRow key={s.id} song={s} queue={results.songs} index={i} showAlbum />)}
          </div>
        )}

        {/* 歌手 */}
        {results && tab === 'artist' && (
          <div className="px-4 pt-2" data-testid="music-search-artists">
            {results.artists.length === 0 ? (
              <EmptyBlock text="没有找到相关歌手" />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {results.artists.map((a) => (
                  <button key={a.id} type="button" onClick={() => void openArtist(a)} className="text-left active:scale-[0.98]">
                    <CoverImg src={a.img1v1Url || a.picUrl} className="aspect-square w-full" rounded="rounded-full" alt={a.name} />
                    <p className="mt-1 truncate text-center text-[12px] text-zinc-800 dark:text-zinc-200">{a.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 歌单 */}
        {results && tab === 'playlist' && (
          <div className="px-4 pt-2" data-testid="music-search-playlists">
            {results.playlists.length === 0 ? (
              <EmptyBlock text="没有找到相关歌单" />
            ) : (
              <div className="space-y-2.5">
                {results.playlists.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openPlaylist(p.id)}
                    className="flex w-full items-center gap-3 text-left active:opacity-80"
                  >
                    <CoverImg src={p.coverImgUrl} className="h-14 w-14" rounded="rounded-lg" alt={p.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {fmtPlayCount(p.playCount)}次播放
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 专辑 */}
        {results && tab === 'album' && (
          <div className="px-4 pt-2" data-testid="music-search-albums">
            {results.albums.length === 0 ? (
              <EmptyBlock text="没有找到相关专辑" />
            ) : (
              <div className="space-y-2.5">
                {results.albums.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => void openAlbum(a)}
                    className="flex w-full items-center gap-3 text-left active:opacity-80"
                  >
                    <CoverImg src={a.picUrl} className="h-14 w-14" rounded="rounded-lg" alt={a.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{a.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                        {a.artist?.name ?? ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 歌手/专辑半屏面板 */}
      {sheet && (
        <div className="absolute inset-0 z-[80] flex items-end">
          <button type="button" aria-label="关闭" onClick={() => setSheet(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[75%] w-full flex-col rounded-t-2xl border-t border-white/60 bg-white/85 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-zinc-900/85">
            <div className="flex items-center gap-3 p-4 pb-2">
              <button type="button" onClick={() => setSheet(null)} aria-label="返回">
                <ChevronLeft className="h-5 w-5 text-zinc-500" />
              </button>
              <CoverImg
                src={sheet.kind === 'artist' ? sheet.artist.img1v1Url || sheet.artist.picUrl : sheet.album.picUrl}
                className="h-12 w-12"
                rounded={sheet.kind === 'artist' ? 'rounded-full' : 'rounded-lg'}
                alt={sheet.kind === 'artist' ? sheet.artist.name : sheet.album.name}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                  {sheet.kind === 'artist' ? sheet.artist.name : sheet.album.name}
                </p>
                <p className="truncate text-[11px] text-zinc-400">
                  {sheet.kind === 'artist' ? '歌手' : sheet.album.artist?.name ?? '专辑'} · {sheet.songs.length} 首
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleSub()}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] ${
                  sheet.subed
                    ? 'border-zinc-300 text-zinc-500'
                    : 'border-[#C20C0C] text-[#C20C0C]'
                }`}
              >
                {sheet.subed ? '已收藏' : '收藏'}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {sheet.songs.length === 0 ? (
                <LoadingBlock />
              ) : (
                sheet.songs.map((s, i) => (
                  <SongRow key={`${s.id}-${i}`} song={s} queue={sheet.songs} index={i} onMore={() => {}} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 加载中遮罩 */}
      {loading && (
        <div className="pointer-events-none absolute right-4 top-[120px]">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="pointer-events-none absolute bottom-[130px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-[12px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
