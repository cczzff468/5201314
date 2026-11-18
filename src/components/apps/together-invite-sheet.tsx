'use client';

/**
 * 聊天加号面板「一起听」选歌弹层（第二十四轮）：
 * 从微信/QQ 聊天底部「+」发起一起听 → 选一首歌 → 我方发「邀请你一起听」卡片进当前聊天，
 * AI 接受后双方发同意卡并建会话（链路在 together-flow.sendUserTogetherInvite）。
 * 选歌：最近播放（空搜索时）+ 真实曲库搜索（防抖 350ms），按歌曲 ID 复用 lyric/search 缓存。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { search, songArtistText, songCover, type NcmSong } from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { CoverImg } from './music-shared';

export function TogetherInviteSheet({
  peerName,
  onPick,
  onClose,
}: {
  /** 当前聊天对象名（标题用） */
  peerName: string;
  onPick: (song: NcmSong) => void;
  onClose: () => void;
}) {
  const history = useMusic((s) => s.history);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NcmSong[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const seqRef = useRef(0);

  // 最近播放去重前 12（空搜索时展示）
  const recents = useMemo(() => {
    const seen = new Set<number>();
    const out: NcmSong[] = [];
    for (const h of history) {
      if (seen.has(h.song.id)) continue;
      seen.add(h.song.id);
      out.push(h.song);
      if (out.length >= 12) break;
    }
    return out;
  }, [history]);

  // 搜索防抖（setState 全部在回调/超时内，不在 effect 体同步调用）
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      seqRef.current += 1; // 作废在途搜索回调
      return;
    }
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      setSearching(true);
      setErr('');
      void (async () => {
        try {
          const r = await search(q, 1, 10);
          if (seqRef.current !== seq) return;
          setResults(r.songs);
          setSearching(false);
        } catch {
          if (seqRef.current !== seq) return;
          setResults([]);
          setErr('搜索失败，稍后再试');
          setSearching(false);
        }
      })();
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const list = query.trim() ? results : recents;
  const loading = query.trim() ? searching : false;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="together-invite-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white pb-[max(14px,env(safe-area-inset-bottom))] pt-3 dark:bg-[#1C1C1E]">
        <div className="mb-2 flex items-center justify-between px-4">
          <div>
            <p className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-100">邀请 {peerName} 一起听</p>
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">选一首歌，以邀请卡发进聊天，TA 同意后开始</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            data-testid="together-invite-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 dark:bg-white/[0.08] dark:text-white/60"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <div className="px-4 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-full bg-black/[0.05] px-3 dark:bg-white/[0.07]">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索歌名 / 歌手"
              data-testid="together-invite-search"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            {query && (
              <button type="button" aria-label="清空" onClick={() => setQuery('')} className="shrink-0 text-zinc-400">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[46vh] min-h-[180px] overflow-y-auto px-2 pb-1 no-scrollbar">
          {!query.trim() && recents.length === 0 && (
            <p className="py-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">还没有最近播放，搜一首歌吧</p>
          )}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          )}
          {err && <p className="py-4 text-center text-[12px] text-red-400">{err}</p>}
          {!loading &&
            (list ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`together-invite-song-${s.id}`}
                onClick={() => onPick(s)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <CoverImg src={songCover(s)} className="h-10 w-10 shrink-0" rounded="rounded-md" alt={s.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-zinc-900 dark:text-zinc-100">{s.name}</span>
                  <span className="block truncate text-[11px] text-zinc-400">{songArtistText(s)}</span>
                </span>
              </button>
            ))}
          {query.trim() && !loading && results && results.length === 0 && !err && (
            <p className="py-8 text-center text-[13px] text-zinc-400 dark:text-zinc-500">没搜到这首歌，换一个关键词试试</p>
          )}
        </div>
      </div>
    </div>
  );
}
