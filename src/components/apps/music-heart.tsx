'use client';

/**
 * 音乐 App 心动模式页（底部 TabBar「心动」，第六十三轮；第六十四轮全面美化——对标用户参考图
 * 的网易云心动模式沉浸式深色版式）：
 * 根据平时喜欢听的（红心/最近播放/常听）与收藏的生成个性化推荐：
 * - 种子 = 最近红心的 3 首 + 本地最近播放 2 首 + 登录用户服务端听歌周榜（补位）
 * - 每个种子拉相似歌（游客 simiSong 返回空 → 兜底同歌手热门歌），交错合并去重
 *   （同一批不扎堆在一种口味，理由文案跟种子走：因为你收藏的/听过的/常听的《X》）
 * - 种子缺失或结果不足 8 首 → 新歌速递兜底 + 引导文案
 * - 版式（第六十四轮）：整页深色沉浸（深灰渐变 #3A3A3E→#141416，与参考图同款），
 *   大盘黑胶（220px，白色圆润唱针从右上落下、盘标红环、播放中旋转）+「心动模式」红徽章；
 *   歌名区左侧大号白字标题/歌手 + 右侧白玻璃大圆播放钮（参考图同款）；
 *   细白进度条带圆点游标 + 双端时间；下方推荐列表延续深色（当前播放高亮红）；
 *   状态栏前景切白字（music.tsx tone 联动）
 * - 下拉刷新重新生成一批（种子轮换）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronsDown,
  Heart,
  Loader2,
  Pause,
  Play,
} from 'lucide-react';
import {
  artistSongs,
  personalizedNewSongs,
  simiSong,
  songArtistText,
  songCover,
  userRecord,
  type NcmSong,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { CoverImg, EmptyBlock, fmtClock } from './music-shared';
import { VipSongBadge } from './music-vip-badge'; // v59：歌单 VIP 角标统一「我的」页同款黑胶唱片胶囊

/** 推荐结果项：歌 + 推荐理由（跟种子走） */
interface HeartSong {
  song: NcmSong;
  reason: string;
}

/** 洗牌（Fisher–Yates）——刷新时轮换种子与结果顺序 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function MusicHeart() {
  const loginUid = useMusic((s) => s.loginUid);
  const likedIds = useMusic((s) => s.likedIds);
  const likedSongs = useMusic((s) => s.likedSongs);
  const history = useMusic((s) => s.history);
  const playSong = useMusic((s) => s.playSong);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const toggle = useMusic((s) => s.toggle);

  const [list, setList] = useState<HeartSong[] | null>(null);
  const [hasSeeds, setHasSeeds] = useState(false);
  /** 刷新代次：下拉刷新 +1（重拉并轮换种子） */
  const [nonce, setNonce] = useState(0);

  // 口味数据（红心/历史/登录态）用 ref 快照：只在进页/下拉刷新时取值。
  // 若直接作依赖，播放任一首歌都会写历史 → load 重建 → 列表被重新生成（头卡跳歌、滚动位置丢失）
  const tasteRef = useRef({ likedIds, likedSongs, history, loginUid });
  tasteRef.current = { likedIds, likedSongs, history, loginUid };

  // ---------------- 推荐生成 ----------------

  const load = useCallback(async () => {
    const { likedIds: lids, likedSongs: lSongs, history: hist, loginUid: uid } = tasteRef.current;
    setList(null);
    // 1. 收集种子（收藏优先，其次常听/最近播放）
    const seeds: { song: NcmSong; why: string }[] = [];
    const likedArr = shuffle([...lids]).slice(0, 3); // 每次刷新换一批红心种子
    for (const id of likedArr) {
      const s = lSongs[id];
      if (s) seeds.push({ song: s, why: `因为你收藏的《${s.name}》` });
    }
    for (const h of shuffle(hist).slice(0, 2)) {
      if (lids.has(h.song.id)) continue;
      if (seeds.some((x) => x.song.id === h.song.id)) continue;
      seeds.push({ song: h.song, why: `因为你听过《${h.song.name}》` });
    }
    if (uid && seeds.length < 3) {
      try {
        const rec = await userRecord(uid, 1); // 服务端周听歌榜
        for (const r of rec) {
          if (seeds.length >= 3) break;
          if (lids.has(r.song.id) || seeds.some((x) => x.song.id === r.song.id)) continue;
          seeds.push({ song: r.song, why: `因为你常听《${r.song.name}》` });
        }
      } catch {
        // 拉不到服务端记录就用本地种子
      }
    }
    setHasSeeds(seeds.length > 0);

    // 2. 每个种子拉相似歌（游客 simiSong 返回空 → 兜底同歌手热门歌）
    const groups = await Promise.all(
      seeds.map(async (sd) => {
        try {
          const simi = await simiSong(sd.song.id, 10);
          if (simi.length) {
            return simi.map((s) => ({ song: s, reason: sd.why }));
          }
          const artistId = sd.song.artists?.[0]?.id;
          if (artistId) {
            const r = await artistSongs(artistId, 12);
            // 理由跟种子动词走（收藏的/听过的/常听的），旧版写死「收藏的」与种子类型不符
            const verb = sd.why.includes('收藏') ? '收藏' : sd.why.includes('常听') ? '常听' : '听过';
            return r.songs
              .filter((s) => s.id !== sd.song.id)
              .slice(0, 10)
              .map((s) => ({ song: s, reason: `和你${verb}的《${sd.song.name}》是同一位歌手` }));
          }
          return [];
        } catch {
          return [];
        }
      }),
    );

    // 3. 交错合并去重（各种子轮流出歌，推荐不扎堆；红心已有的不再推）
    const out: HeartSong[] = [];
    const seen = new Set<number>();
    const push = (it: HeartSong) => {
      if (seen.has(it.song.id) || lids.has(it.song.id)) return;
      seen.add(it.song.id);
      out.push(it);
    };
    const maxLen = Math.max(0, ...groups.map((g) => g.length));
    for (let i = 0; i < maxLen && out.length < 30; i++) {
      for (const g of groups) {
        if (g[i]) push(g[i]);
        if (out.length >= 30) break;
      }
    }

    // 4. 兜底：无种子或结果不足 → 新歌速递
    if (out.length < 8) {
      try {
        const ns = await personalizedNewSongs(20);
        for (const s of shuffle(ns)) {
          if (out.length >= 12) break;
          push({ song: s, reason: '新歌速递 · 可能合你口味' });
        }
      } catch {
        // 空态由 EmptyBlock 处理
      }
    }
    setList(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  // ---------------- 下拉刷新（与首页同款手势：顶部下拉重生成一批） ----------------

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'loading' | 'done'>('idle');
  const [pullDist, setPullDist] = useState(0);
  const gestureRef = useRef<{ startY: number; fromTop: boolean; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const PULL_THRESHOLD = 64;

  const atTopNow = () => (scrollRef.current ? scrollRef.current.scrollTop <= 0 : false);

  const beginPull = (y: number) => {
    if (pullState === 'loading' || pullState === 'done') return;
    gestureRef.current = { startY: y, fromTop: atTopNow(), moved: false };
  };

  const movePull = (y: number) => {
    const g = gestureRef.current;
    if (!g || pullState === 'loading' || pullState === 'done' || !g.fromTop) return;
    const dist = y - g.startY;
    if (dist <= 0) {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    if (dist > 12) g.moved = true;
    setPullDist(Math.min(dist, 120));
    setPullState(dist > PULL_THRESHOLD ? 'ready' : 'pulling');
  };

  const endPull = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
    }
    if (!g || !g.fromTop) return;
    if (pullState !== 'ready') {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    setPullState('loading');
    setPullDist(44);
    setNonce((n) => n + 1); // 触发重拉（种子轮换）
  };

  // 拉取中 → 完成 → 复位（nonce 驱动 load，这里只管指示器状态）
  useEffect(() => {
    if (pullState !== 'loading') return;
    if (list === null) return; // 还没拉完
    setPullState('done');
    setPullDist(0);
    const t = setTimeout(() => setPullState('idle'), 1200);
    return () => clearTimeout(t);
  }, [list, pullState]);

  const pullHintText =
    pullState === 'ready'
      ? '松开换一批'
      : pullState === 'loading'
        ? '正在生成心动歌单…'
        : pullState === 'done'
          ? '已更新 ✓'
          : '下拉换一批';

  // ---------------- 头卡当前歌 ----------------

  const songs = (list ?? []).map((x) => x.song);
  // 心动队列中的歌在播 → 头卡显示它；否则显示队列首（即将播放）
  const heroSong = current && songs.some((s) => s.id === current.id) ? current : songs[0];
  const heroPlaying = !!heroSong && playing && current?.id === heroSong.id;
  const heroProgress = heroPlaying && duration > 0 ? Math.min(1, position / duration) : 0;
  const playHero = () => {
    if (!songs.length) return;
    if (current && songs.some((s) => s.id === current.id)) toggle();
    else void playSong(songs[0], songs);
  };

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overscroll-contain bg-gradient-to-b from-[#3C3C41] via-[#26262A] to-[#101012] pb-[126px]"
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        suppressClickRef.current = false;
      }}
      onTouchStart={(e) => beginPull(e.touches[0]?.clientY ?? 0)}
      onTouchMove={(e) => movePull(e.touches[0]?.clientY ?? 0)}
      onTouchEnd={endPull}
      onTouchCancel={endPull}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') beginPull(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') movePull(e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') endPull();
      }}
      onPointerCancel={(e) => {
        if (e.pointerType === 'mouse') endPull();
      }}
    >
      {/* 顶栏（深色版：白字居中标题；用户反馈：三条杠删除、标题居中且不可点退出） */}
      <div className="sticky top-0 z-20 flex items-center justify-center px-4 pb-2 pt-[60px]">
        <span data-testid="music-heart-title" className="text-[19px] font-bold text-white">
          心动
        </span>
      </div>

      {/* 下拉刷新指示区（深色版） */}
      <div
        className="flex items-end justify-center gap-1.5 overflow-hidden text-[11px] text-white/40 transition-[height] duration-150"
        style={{
          height:
            pullState === 'loading' || pullState === 'done'
              ? 36
              : pullDist > 0
                ? Math.min(pullDist * 0.5, 56)
                : 0,
        }}
        data-testid="music-heart-pull-hint"
        aria-live="polite"
      >
        {pullState === 'loading' ? (
          <Loader2 className="mb-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ChevronsDown className={`mb-2 h-3.5 w-3.5 ${pullState === 'ready' ? 'text-[#FF5A5A]' : ''}`} />
        )}
        <span className={`mb-2 ${pullState === 'ready' ? 'font-medium text-[#FF5A5A]' : ''}`}>{pullHintText}</span>
      </div>

      {/* 引导条（还没有任何口味数据时；深色版） */}
      {!hasSeeds && list !== null && list.length > 0 && (
        <div
          className="mx-4 mb-1 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[11px] leading-snug text-white/70 ring-1 ring-white/15 backdrop-blur-2xl"
          data-testid="music-heart-hint"
        >
          <Heart className="h-3.5 w-3.5 shrink-0 text-[#FF5A5A]" fill="currentColor" />
          先去听听歌、给喜欢的歌点亮红心，心动模式会更懂你
        </div>
      )}

      {/* ============ 黑胶沉浸头卡（参考图同款版式） ============ */}
      {heroSong && (
        <div className="relative flex flex-col items-center px-5 pb-3 pt-2">
          {/* 「心动模式」红徽章 */}
          <span
            className="mb-1 flex items-center gap-1 rounded-full bg-[#C20C0C] px-2.5 py-[3px] text-[10px] font-medium text-white shadow-[0_2px_10px_rgba(194,12,12,0.45)]"
            data-testid="music-heart-badge"
          >
            <Heart className="h-2.5 w-2.5" fill="currentColor" />
            心动模式
          </span>

          {/* 黑胶唱片区：背后白色微光晕 + 大盘 + 白色圆润唱针（播放中旋转） */}
          <div className="relative mt-2 flex h-[248px] w-full items-center justify-center">
            {/* 背后光晕 */}
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[252px] w-[252px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 45%, transparent 68%)' }}
            />
            {/* 黑胶盘（参考图：黑盘+细密纹路+白色盘标环） */}
            <div
              className="relative h-[224px] w-[224px] rounded-full bg-[#17171A] shadow-[0_18px_44px_rgba(0,0,0,0.55)] animate-[netease-spin_16s_linear_infinite]"
              style={{ animationPlayState: heroPlaying ? 'running' : 'paused' }}
              data-testid="music-heart-vinyl"
            >
              {/* 盘缘高光 + 纹路 */}
              <span aria-hidden="true" className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/[0.09]" />
              <span className="absolute inset-[9px] rounded-full border border-white/[0.07]" />
              <span className="absolute inset-[17px] rounded-full border border-white/[0.06]" />
              <span className="absolute inset-[25px] rounded-full border border-white/[0.05]" />
              <span className="absolute inset-[33px] rounded-full border border-white/[0.045]" />
              <span className="absolute inset-[41px] rounded-full border border-white/[0.04]" />
              <span className="absolute inset-[49px] rounded-full border border-white/[0.035]" />
              {/* 盘标：封面 + 红环 + 白色衬圈 + 中心孔（参考图大盘标比例 ~52%） */}
              <span className="absolute left-1/2 top-1/2 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F5F1E8] p-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                <span className="relative block h-full w-full overflow-hidden rounded-full ring-2 ring-[#C20C0C]/80">
                  <CoverImg src={songCover(heroSong)} className="h-full w-full" rounded="rounded-full" alt={heroSong.name} />
                </span>
              </span>
              <span className="absolute left-1/2 top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#17171A] ring-2 ring-white/80" />
            </div>
            {/* 白色圆润唱针（参考图同款：枢轴圆点 + 弯臂 + 唱头落在盘面右上） */}
            <svg aria-hidden="true" viewBox="0 0 140 140" className="pointer-events-none absolute -top-4 right-2 h-[128px] w-[128px]">
              {/* 弯臂（白色粗线，圆头） */}
              <path
                d="M96 26 C 86 46, 74 62, 66 84"
                stroke="#F2F2F4"
                strokeWidth="7"
                fill="none"
                strokeLinecap="round"
              />
              {/* 臂管细节 */}
              <path d="M92 31 C 85 46, 76 60, 70 78" stroke="#D8D8DC" strokeWidth="2" fill="none" strokeLinecap="round" />
              {/* 唱头（白色圆角块落在盘面） */}
              <g transform="rotate(38 64 88)">
                <rect x="55" y="82" width="20" height="12" rx="4" fill="#F2F2F4" />
                <rect x="58" y="85" width="8" height="6" rx="2" fill="#C9C9CF" />
              </g>
              {/* 枢轴（外圈白盘 + 中心圆点） */}
              <circle cx="98" cy="22" r="12" fill="#F2F2F4" />
              <circle cx="98" cy="22" r="5" fill="#B9B9C0" />
              <circle cx="98" cy="22" r="2" fill="#7C7C84" />
            </svg>
          </div>

          {/* 歌名 + 歌手 + 大圆播放钮（参考图同款排版） */}
          <div className="mt-3 flex w-full items-center gap-3">
            <button
              type="button"
              onClick={() => current && songs.some((s) => s.id === current.id) && useMusic.getState().openPlayer()}
              data-testid="music-heart-hero-song"
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-[24px] font-bold leading-tight text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.4)]">
                {heroSong.name}
              </p>
              <p className="mt-1 flex items-center gap-0.5 truncate text-[15px] text-white/55">
                {songArtistText(heroSong)}
                <ChevronRight className="h-4 w-4 shrink-0 text-white/40" />
              </p>
            </button>
            <button
              type="button"
              onClick={playHero}
              data-testid="music-heart-play"
              aria-label={heroPlaying ? '暂停' : '播放心动歌单'}
              className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/15 backdrop-blur-xl transition active:scale-95 active:bg-white/20"
            >
              {heroPlaying ? (
                <Pause className="h-7 w-7" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-1 h-7 w-7" fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </div>

          {/* 细白进度条 + 圆点游标 + 双端时间（播心动队列中的歌才显示） */}
          {current && songs.some((s) => s.id === current.id) && (
            <div className="mt-4 w-full" data-testid="music-heart-progress">
              <div className="relative h-[3px] w-full rounded-full bg-white/20">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/85"
                  style={{ width: `${heroProgress * 100}%` }}
                />
                <span
                  className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)] transition-[left] duration-500"
                  style={{ left: `${heroProgress * 100}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-white/45">
                <span>{fmtClock(position)}</span>
                <span>{fmtClock(duration)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 推荐列表（深色版） */}
      {list === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/45">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在根据你的口味挑歌…
        </div>
      ) : list.length === 0 ? (
        <div className="pt-2">
          <EmptyBlock text="暂时没挑出合心意的歌，下拉再试一次" />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pb-1 pt-5">
            <h2 className="text-[16px] font-bold text-white">
              心动歌单 <span className="text-[12px] font-normal text-white/40">{list.length} 首</span>
            </h2>
            <button
              type="button"
              onClick={() => songs.length > 0 && void playSong(songs[0], songs)}
              data-testid="music-heart-play-all"
              className="flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] text-white/85 backdrop-blur-xl active:scale-95"
            >
              <Play className="h-3 w-3" fill="currentColor" strokeWidth={0} />
              播放全部
            </button>
          </div>
          <div className="space-y-0.5 px-1 pb-2" data-testid="music-heart-list">
            {list.map((it, i) => (
              <button
                key={it.song.id}
                type="button"
                onClick={() => void playSong(it.song, songs)}
                data-testid={`music-heart-song-${it.song.id}`}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-white/10"
              >
                <CoverImg src={songCover(it.song)} className="h-11 w-11 shrink-0" rounded="rounded-lg" alt={it.song.name} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[14px] leading-tight ${
                      current?.id === it.song.id ? 'text-[#FF6B6B]' : 'text-white/92'
                    }`}
                  >
                    {it.song.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] leading-tight text-white/45">
                    {songArtistText(it.song)} · {it.reason}
                  </p>
                </div>
                {it.song.fee === 1 && <VipSongBadge />}
                <span className="w-6 shrink-0 text-center text-[13px] tabular-nums text-white/25">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
