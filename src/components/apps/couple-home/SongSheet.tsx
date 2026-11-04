'use client';

/**
 * 小屋点歌（v6.0 重构）—— 音箱/黑胶/八音盒共用的点歌面板
 *
 * - 标题不带图标（用户要求删除 🔊 图标）；
 * - 三个页签：搜歌（网易云云搜索 + 最近在听）/ 歌单（我添加的歌单）/ 队列（播放队列管理）；
 * - 点歌全屋响起（ambient:true，家具播放中不弹灵动岛）；「+队列」不打断当前播放；
 * - 队列页：点行切歌 / 单曲移除 / 一键清空，当前播放高亮 + 音符动效。
 */

import { AnimatePresence, motion } from 'framer-motion';
import { AudioLines, ListMusic, ListPlus, Loader2, Music, Pause, Play, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  search,
  songsDetail,
  songCover,
  playlistDetail,
  userPlaylists,
  type NcmPlaylist,
  type NcmSong,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';

type Tab = 'search' | 'pls' | 'queue';

export function SongSheet({
  open,
  onClose,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onToast?: (msg: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('search');
  // —— 播放态（store 直读） ——
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const queue = useMusic((s) => s.queue);
  const qIndex = useMusic((s) => s.qIndex);
  const history = useMusic((s) => s.history);
  const liked = useMusic((s) => s.likedSongs);
  const loginUid = useMusic((s) => s.loginUid);

  // —— 搜索 ——
  const [kw, setKw] = useState('');
  const [results, setResults] = useState<NcmSong[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  useEffect(() => {
    const q = kw.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const r = await search(q, 1, 20);
        if (seqRef.current === seq) setResults(r.songs);
      } catch {
        if (seqRef.current === seq) setResults([]);
      } finally {
        if (seqRef.current === seq) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [kw]);

  // —— 歌单 ——
  const [pls, setPls] = useState<NcmPlaylist[]>([]);
  const [plsBusy, setPlsBusy] = useState(false);
  const [openPl, setOpenPl] = useState<{ name: string; cover: string; songs: NcmSong[] } | null>(null);
  const [plLoading, setPlLoading] = useState(false);
  useEffect(() => {
    if (tab !== 'pls' || !loginUid || pls.length) return;
    setPlsBusy(true);
    userPlaylists(loginUid)
      .then(setPls)
      .catch(() => setPls([]))
      .finally(() => setPlsBusy(false));
  }, [tab, loginUid, pls.length]);

  const loadPl = async (p: NcmPlaylist) => {
    if (plLoading) return;
    setPlLoading(true);
    try {
      const d = await playlistDetail(p.id);
      const ids = (d.trackIds ?? []).map((t) => t.id).slice(0, 200);
      const songs: NcmSong[] = [];
      for (let i = 0; i < ids.length; i += 300) songs.push(...(await songsDetail(ids.slice(i, i + 300))));
      setOpenPl({ name: d.name ?? p.name ?? '歌单', cover: d.coverImgUrl ?? '', songs });
    } catch {
      onToast?.('歌单加载失败，再试一次？');
    } finally {
      setPlLoading(false);
    }
  };

  // —— 最近在听（history + 红心，去重） ——
  const recent = useMemo(() => {
    const seen = new Set<number>();
    const out: NcmSong[] = [];
    for (const h of history.slice(0, 10)) {
      if (h.song && !seen.has(h.song.id)) {
        seen.add(h.song.id);
        out.push(h.song);
      }
    }
    for (const s of Object.values(liked)) {
      if (s && !seen.has(s.id) && out.length < 14) {
        seen.add(s.id);
        out.push(s);
      }
    }
    return out;
  }, [history, liked]);

  // —— 动作 ——
  /** 点歌全屋响起（ambient：不弹灵动岛）；传 list = 以整份歌单/搜索结果作队列 */
  const play = (song: NcmSong, list?: NcmSong[]) => {
    void useMusic.getState().playSong(song, list?.length ? list : undefined, { ambient: true });
    onToast?.(`《${song.name}》正在小屋响起`);
  };
  /** 加进队列（不打断当前播放） */
  const enqueue = (song: NcmSong) => {
    useMusic.getState().addToQueue([song]);
    onToast?.(`已把《${song.name}》排进队列`);
  };
  /** 队列切歌（保持 ambient） */
  const jump = (i: number) => {
    useMusic.setState({ ambient: true });
    void useMusic.getState().playQueueAt(i);
  };

  const list = kw.trim() ? results : recent;
  const listLabel = kw.trim() ? `找到 ${results.length} 首 · 点封面播放` : '最近在听 · 点一首全屋响起';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex items-end justify-center bg-black/25 pb-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0.8 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="pointer-events-auto flex max-h-[76vh] w-full max-w-[320px] flex-col rounded-3xl bg-white/96 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题（无图标） */}
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="text-[15px] font-semibold text-[#3a3a3e]">小屋点歌</span>
                <p className="mt-0.5 text-[11px] text-[#9a9a96]">搜歌 · 我的歌单 · 播放队列</p>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭点歌面板"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 当前播放卡 */}
            {current && (
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#fdf3e4] to-[#fbe9e2] p-3">
                <span className="relative shrink-0">
                  <img src={songCover(current)} alt="" className="h-11 w-11 rounded-xl object-cover shadow-sm" />
                  {playing && (
                    <motion.span
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#8fce9e] ring-2 ring-white"
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ repeat: Infinity, duration: 1.4 }}
                    >
                      <Music className="h-2.5 w-2.5 text-white" />
                    </motion.span>
                  )}
                </span>
                <button onClick={() => void useMusic.getState().toggle()} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13px] font-semibold text-[#3a3a3e]">{current.name}</span>
                  <span className="block truncate text-[11px] text-[#9a9a96]">
                    {current.artists?.map((a) => a.name).join('/') ?? ''}
                  </span>
                </button>
                <button
                  onClick={() => void useMusic.getState().toggle()}
                  aria-label={playing ? '暂停' : '播放'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#e08a9a] shadow-sm transition active:scale-90"
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                </button>
              </div>
            )}

            {/* 页签 */}
            <div className="mb-2 flex gap-1.5 rounded-full bg-[#f5f3ef] p-1">
              {(
                [
                  ['search', '搜歌'],
                  ['pls', '歌单'],
                  ['queue', `队列${queue.length ? ` ${queue.length}` : ''}`],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-full text-[12px] font-semibold transition active:scale-95 ${
                    tab === k ? 'bg-white text-[#e08a9a] shadow-sm' : 'text-[#9a9a96]'
                  }`}
                >
                  {k === 'queue' && <ListMusic className="h-3.5 w-3.5" />}
                  {label}
                </button>
              ))}
            </div>

            {/* —— 搜歌 —— */}
            {tab === 'search' && (
              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 flex h-10 items-center gap-2 rounded-full bg-[#f5f3ef] px-4">
                  <Search className="h-4 w-4 shrink-0 text-[#b0aea8]" />
                  <input
                    value={kw}
                    onChange={(e) => setKw(e.target.value)}
                    placeholder="搜首歌，全屋一起听"
                    aria-label="搜索歌曲"
                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#3a3a3e] outline-none placeholder:text-[#c0beb8]"
                  />
                  {kw && (
                    <button onClick={() => setKw('')} aria-label="清空搜索" className="shrink-0 text-[#b0aea8]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#a8a8a4]">
                    <Loader2 className="h-4 w-4 animate-spin" /> 搜着呢…
                  </div>
                ) : list.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-[#a8a8a4]">
                    {kw.trim() ? '没找到这首歌，换个关键词试试' : '去音乐 App 听几首歌，这里就能点播啦'}
                  </p>
                ) : (
                  <>
                    <p className="mb-1 px-1 text-[10.5px] text-[#c0beb8]">{listLabel}</p>
                    <div className="scrollbar-none max-h-[34vh] overflow-y-auto">
                      {list.map((song) => (
                        <SongRow
                          key={song.id}
                          song={song}
                          active={current?.id === song.id}
                          onPlay={() => play(song, kw.trim() ? results : undefined)}
                          onEnqueue={() => enqueue(song)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* —— 歌单 —— */}
            {tab === 'pls' && (
              <div className="flex min-h-0 flex-col">
                {!loginUid ? (
                  <p className="py-8 text-center text-[12px] leading-relaxed text-[#a8a8a4]">
                    先去音乐 App 登录网易云账号
                    <br />
                    就能选你添加的歌单啦
                  </p>
                ) : plLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#a8a8a4]">
                    <Loader2 className="h-4 w-4 animate-spin" /> 歌单装订中…
                  </div>
                ) : openPl ? (
                  <>
                    <button
                      onClick={() => setOpenPl(null)}
                      className="mb-1.5 flex items-center gap-1.5 self-start rounded-full bg-[#f5f3ef] px-3 py-1.5 text-[11px] font-medium text-[#8a8a90] transition active:scale-95"
                    >
                      ‹ 全部歌单
                    </button>
                    <p className="mb-1 px-1 truncate text-[10.5px] text-[#c0beb8]">
                      {openPl.name} · {openPl.songs.length} 首 · 点一首连播整张歌单
                    </p>
                    <div className="scrollbar-none max-h-[36vh] overflow-y-auto">
                      {openPl.songs.map((song, i) => (
                        <SongRow
                          key={`${song.id}-${i}`}
                          song={song}
                          active={current?.id === song.id}
                          onPlay={() => play(song, openPl.songs)}
                          onEnqueue={() => enqueue(song)}
                        />
                      ))}
                      {openPl.songs.length === 0 && (
                        <p className="py-6 text-center text-[12px] text-[#a8a8a4]">这张歌单还没有歌</p>
                      )}
                    </div>
                  </>
                ) : plsBusy ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#a8a8a4]">
                    <Loader2 className="h-4 w-4 animate-spin" /> 歌单架取表中…
                  </div>
                ) : pls.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-[#a8a8a4]">还没有歌单，去音乐 App 创建一个吧</p>
                ) : (
                  <div className="scrollbar-none max-h-[42vh] overflow-y-auto">
                    {pls.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => void loadPl(p)}
                        className="flex w-full items-center gap-3 rounded-2xl px-1.5 py-2 text-left transition active:scale-[0.98] active:bg-[#f6f4ef]"
                      >
                        <img
                          src={(p.coverImgUrl ?? '').replace(/^http:/, 'https:')}
                          alt=""
                          className="h-11 w-11 rounded-xl object-cover shadow-sm"
                          loading="lazy"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[#3a3a3e]">{p.name}</span>
                          <span className="block text-[10.5px] text-[#9a9a96]">{p.trackCount ?? 0} 首</span>
                        </span>
                        <Play className="h-4 w-4 shrink-0 text-[#d9a0ac]" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* —— 队列 —— */}
            {tab === 'queue' && (
              <div className="flex min-h-0 flex-col">
                {queue.length === 0 ? (
                  <p className="py-8 text-center text-[12px] text-[#a8a8a4]">
                    队列空空的
                    <br />
                    去搜歌或歌单里「+队列」排几首吧
                  </p>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between px-1">
                      <p className="text-[10.5px] text-[#c0beb8]">正在排队 · 点一首马上唱</p>
                      <button
                        onClick={() => {
                          useMusic.getState().clearQueue();
                          onToast?.('队列清空啦');
                        }}
                        className="flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium text-[#c29090] transition active:scale-95"
                      >
                        <Trash2 className="h-3 w-3" /> 清空
                      </button>
                    </div>
                    <div className="scrollbar-none max-h-[38vh] overflow-y-auto">
                      {queue.map((song, i) => {
                        const cur = i === qIndex;
                        return (
                          <button
                            key={`${song.id}-${i}`}
                            onClick={() => jump(i)}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition active:scale-[0.98] ${
                              cur ? 'bg-[#fdf3e4]' : 'active:bg-[#f6f4ef]'
                            }`}
                          >
                            <span className="w-5 shrink-0 text-center">
                              {cur && playing ? (
                                <AudioLines className="mx-auto h-3.5 w-3.5 animate-pulse text-[#e08a9a]" />
                              ) : (
                                <span className={`text-[11px] font-semibold ${cur ? 'text-[#e08a9a]' : 'text-[#c0beb8]'}`}>
                                  {i + 1}
                                </span>
                              )}
                            </span>
                            <img src={songCover(song)} alt="" className="h-8 w-8 rounded-lg object-cover" loading="lazy" />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[12.5px] font-medium ${cur ? 'text-[#e08a9a]' : 'text-[#3a3a3e]'}`}
                              >
                                {song.name}
                              </span>
                              <span className="block truncate text-[10.5px] text-[#9a9a96]">
                                {song.artists?.map((a) => a.name).join('/') ?? ''}
                              </span>
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`把${song.name}移出队列`}
                              onClick={(e) => {
                                e.stopPropagation();
                                useMusic.getState().removeFromQueue(i);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  useMusic.getState().removeFromQueue(i);
                                }
                              }}
                              className="shrink-0 rounded-full p-1 text-[#c5c3bd] transition hover:bg-[#f0eff1] active:scale-90"
                            >
                              <X className="h-3.5 w-3.5" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 歌行：封面 + 名字 + 播放 / 排队两个动作 */
function SongRow({
  song,
  active,
  onPlay,
  onEnqueue,
}: {
  song: NcmSong;
  active: boolean;
  onPlay: () => void;
  onEnqueue: () => void;
}) {
  return (
    <div
      className={`flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition ${active ? 'bg-[#fdf3e4]' : ''}`}
    >
      <button onClick={onPlay} className="relative shrink-0" aria-label={`播放${song.name}`}>
        <img src={songCover(song)} alt="" className="h-9 w-9 rounded-lg object-cover" loading="lazy" />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25 opacity-0 transition hover:opacity-100">
          <Play className="h-3.5 w-3.5 text-white" />
        </span>
      </button>
      <button onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[12.5px] font-medium ${active ? 'text-[#e08a9a]' : 'text-[#3a3a3e]'}`}>
          {song.name}
        </span>
        <span className="block truncate text-[10.5px] text-[#9a9a96]">
          {song.artists?.map((a) => a.name).join('/') ?? ''}
        </span>
      </button>
      <button
        onClick={onEnqueue}
        aria-label={`把${song.name}加入队列`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#f5f3ef] px-2.5 text-[10.5px] font-semibold text-[#8a8a90] transition active:scale-90"
      >
        <ListPlus className="h-3 w-3" /> 排队
      </button>
    </div>
  );
}
