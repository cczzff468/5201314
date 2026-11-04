'use client';

/**
 * 聊天里的歌曲分享卡片（Task 68 音乐 App × AI 深度互动，微信 / QQ 共用）：
 *
 * - 仿用户参考截图：左侧正方形封面、右侧歌名（粗）+ 歌手（灰）、右侧播放按钮；
 * - 封面/曲库按需解析：落库带 songId/cover 直接用；AI 标记只有歌名+歌手时，
 *   首次渲染异步 search 匹配真实曲库（模块级缓存，同歌只搜一次，失败显示占位封面）；
 * - 点击卡片 → useMusic.playSong 直接播放（后台播，不打断聊天；正在播时按钮变暂停可点击暂停）；
 * - autoPlay（AI 点播 [放歌:...]）：卡片投递后自动开始播放——模块级已播 Set 去重 +
 *   90 秒时间窗（历史消息重渲染/重开聊天页不重复触发）；播放失败静默（卡片仍可手点）。
 * - invite（[邀请一起听:...]，第二十二轮反馈）：歌名行改为「邀请你一起听歌名」；
 *   卡片下方的分享语/邀请语小字已按用户要求整体移除（卡片本身干净无附注）。
 * - 第二十三轮反馈：卡片圆角调小（10→6px，之前太圆）；邀请卡的「邀请你一起听」
 *   从歌名同行拆出，单独放到歌名的上方一行（邀请语小字 / 歌名粗体 / 歌手）。
 * - 第二十四轮：agree（同意一起听卡片）——歌名上方小字，点击同样播放该歌；
 *   第二十五轮修正：同意卡只有「接受方」发一张（我邀请 → 只有 TA 发；TA 邀请被接受 → 只有我发）；
 *   第二十六轮的方向文案（你接受了TA的邀请/TA接受了你的邀请）按第二十七轮反馈回退，
 *   统一固定为「已同意一起听」。
 */

import { useEffect, useState } from 'react';
import { Pause } from 'lucide-react';
import { useMusic } from '@/lib/ios/music-store';
import { search, songCover, type NcmSong } from '@/lib/ios/music-api';

/** 曲库解析缓存：key = `${name}::${artist}` → 解析结果（同歌只搜一次） */
const resolveCache = new Map<string, { song: NcmSong | null }>();

/** autoPlay 已触发去重（会话级内存即可；时间窗防历史消息重渲染误触发） */
const autoPlayed = new Set<string>();
const AUTO_PLAY_WINDOW_MS = 90_000;

async function resolveSong(name: string, artist: string): Promise<NcmSong | null> {
  const key = `${name}::${artist}`;
  const hit = resolveCache.get(key);
  if (hit) return hit.song;
  try {
    const r = await search(`${name} ${artist}`.trim(), 1, 1);
    const song = r.songs[0] ?? null;
    resolveCache.set(key, { song });
    return song;
  } catch {
    resolveCache.set(key, { song: null });
    return null;
  }
}

export interface SongMsgBubbleProps {
  msgId: string;
  role: 'me' | 'peer';
  name: string;
  artist: string;
  /** 邀请一起听卡：歌名行显示「邀请你一起听歌名」（第二十二轮反馈，不再用卡片下方小字） */
  invite?: boolean;
  /** 同意一起听卡：歌名上方固定小字「已同意一起听」（第二十七轮回退方向文案） */
  agree?: boolean;
  /** 落库时已知的封面（音乐 App 分享带；AI 标记无则异步解析） */
  cover?: string;
  /** 落库时已知的曲库 id（有则免搜索） */
  songId?: number;
  /** AI 点播：投递后自动播放 */
  autoPlay?: boolean;
  /** 消息时间（autoPlay 时间窗用） */
  time: number;
}

export default function SongMsgBubble({ msgId, role, name, artist, invite, agree, cover, songId, autoPlay, time }: SongMsgBubbleProps) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const playSong = useMusic((s) => s.playSong);
  const toggle = useMusic((s) => s.toggle);
  const [resolved, setResolved] = useState<NcmSong | null>(songId ? ({ id: songId, name, fee: 0 } as NcmSong) : null);
  const [coverUrl, setCoverUrl] = useState<string>(cover || '');
  const [miss, setMiss] = useState(false);

  const isThisPlaying = Boolean(current && resolved && current.id === resolved.id && playing);

  // 曲库解析（搜索拿真实 song + 封面）
  useEffect(() => {
    if (resolved && (coverUrl || !resolved.id)) return;
    let on = true;
    void (async () => {
      const song = resolved ?? (await resolveSong(name, artist));
      if (!on) return;
      if (!song) {
        setMiss(true);
        return;
      }
      setResolved(song);
      const c = songCover(song);
      if (c) setCoverUrl(c);
    })();
    return () => {
      on = false;
    };
  }, [msgId]);

  const doPlay = (song: NcmSong) => {
    if (current?.id === song.id) {
      toggle();
      return;
    }
    void playSong(song, [song]);
  };

  // AI 点播自动播放（投递后首渲染触发一次；90s 时间窗 + 去重防历史重渲染）
  useEffect(() => {
    if (!autoPlay || role !== 'peer' || miss) return;
    if (autoPlayed.has(msgId)) return;
    if (Date.now() - time > AUTO_PLAY_WINDOW_MS) return;
    autoPlayed.add(msgId);
    let cancelled = false;
    void (async () => {
      const song = resolved ?? (await resolveSong(name, artist));
      if (!cancelled && song) doPlay(song);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved, miss, msgId]);

  return (
    <div className="w-[236px]" data-testid={`song-card-${msgId}`}>
      <button
        type="button"
        data-testid={`song-bubble-${role}`}
        onClick={() => resolved && doPlay(resolved)}
        className="flex w-full items-stretch overflow-hidden rounded-[6px] bg-[#F3F1EC] text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:opacity-80 dark:bg-zinc-800"
        aria-label={`播放《${name}》${artist}`}
      >
        {/* 封面 */}
        <span className="relative block h-[88px] w-[88px] shrink-0 overflow-hidden bg-zinc-300 dark:bg-zinc-700">
          {coverUrl ? (
            <img src={coverUrl} alt={`${name} 封面`} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500 dark:text-zinc-400">
              {miss ? '无封面' : '…'}
            </span>
          )}
        </span>
        {/* 歌名 / 歌手 / 播放钮。invite/agree 卡：小字单独放歌名上方一行
            （邀请你一起听 / 同意卡固定「已同意一起听」，第二十七轮回退方向文案） */}
        <span className="flex min-w-0 flex-1 items-center gap-1 px-2.5">
          <span className="min-w-0 flex-1">
            {(invite || agree) && (
              <span className="block truncate text-[11px] leading-[14px] text-zinc-400">
                {agree ? '已同意一起听' : '邀请你一起听'}
              </span>
            )}
            <span className={`block truncate text-[14px] font-bold leading-snug text-zinc-900 dark:text-zinc-100 ${invite || agree ? 'mt-[1px]' : ''}`}>
              {name}
            </span>
            <span className={`block truncate text-[12px] text-zinc-400 ${invite || agree ? 'mt-[1px]' : 'mt-0.5'}`}>{artist || '未知歌手'}</span>
          </span>
          <span
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full ${
              isThisPlaying ? 'bg-[#EC4141]/10 text-[#EC4141]' : 'text-zinc-700 dark:text-zinc-200'
            }`}
          >
            {isThisPlaying ? (
              <Pause className="h-5 w-5" fill="currentColor" strokeWidth={0} />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5z" />
              </svg>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}
