'use client';

/**
 * 音乐小组件（主屏 4×2 通栏，iOS「音乐」小组件样式，用户参考图 1:1）：
 * - 左上专辑封面 + 歌名（粗体截断）/歌手 + 右上角声波条（播放中错峰律动，暂停静止）；
 * - 真实进度条：已播时间 / 进度 / 剩余时间（-m:ss），直连音乐 store 的 position/duration
 *   （audio timeupdate 驱动，与播放页同一状态源，自动跟随）；
 * - 控制键：爱心收藏（Heart，红色实心=已喜欢）+ 上一首/播放暂停/下一首，直接调 useMusic 的
 *   toggle/next/prev/toggleLike（游客态红心走本地持久化，安全）；无歌时爱心/切歌安全 no-op，
 *   播放键可点（有快照队列时直接恢复播放）；控制键为无底色粗壮字形（实心 + 2px 同色
 *   描边外扩 + 圆角接缝），圆形按压高亮 + 200ms 缓动 + 按压缩放；
 * - 无歌时显示「默认态」：与正常布局完全同构（音符占位封面 + 「音乐」标题 + 空进度条），
 *   不再显示「尚未播放音乐」文案（用户要求）；
 * - 点击小组件空白处打开音乐 App（HomeScreen 的 WIDGET_META.openApp 驱动）；
 *   控制键 pointerdown/click 双重 stopPropagation——既不触发开 App，也不参与主屏
 *   长按编辑/拖拽手势（与 MusicGlobalMini 的按钮拦截同思路）；
 * - 深浅主题自适应（dark: 变体；PhoneShell 壳上有 dark class）。
 */

import { Heart, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useMusic } from '@/lib/ios/music-store';
import { songArtistText, songCover, songDurationMs } from '@/lib/ios/music-api';

/** 秒 → m:ss（进度条两侧时间） */
const fmt = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/** 声波装饰条高度序列（固定值，避免随机数导致水合不一致） */
const WAVE_BARS = [10, 16, 24, 18, 11];

export function MusicWidget() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const liked = useMusic((s) => (s.current ? s.likedIds.has(s.current.id) : false));

  /** 时长：engine durationchange 之前回退歌曲元数据时长 */
  const dur = duration > 0 ? duration : current ? songDurationMs(current) / 1000 : 0;
  const pos = Math.min(position, dur > 0 ? dur : position);
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  /** 控制键拦截：pointerdown 阻断主屏长按编辑/拖拽武装，click 阻断「点小组件开 App」 */
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      data-testid="music-widget"
      className="flex h-[168px] w-full select-none flex-col rounded-[24px] bg-white px-[15px] py-[12px] ring-1 ring-black/[0.05] dark:bg-[#232327] dark:ring-white/[0.08]"
    >
      {/* 封面 + 歌名/歌手 + 声波装饰（无歌 = 音符占位封面 + 「音乐」默认态） */}
      <div className="flex items-center gap-[12px]">
        {current ? (
          <img
            src={songCover(current)}
            alt={current.name}
            draggable={false}
            className="h-[64px] w-[64px] shrink-0 rounded-[12px] bg-black/[0.06] object-cover dark:bg-white/10"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-[12px] bg-black/[0.06] dark:bg-white/10"
          >
            <Music2 className="h-[27px] w-[27px] text-black/25 dark:text-white/30" strokeWidth={1.8} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-[20px] tracking-tight text-[#0c0c0e] dark:text-[#f2f2f4]">
            {current ? current.name : '音乐'}
          </p>
          {current && (
            <p className="mt-[3px] truncate text-[12.5px] leading-[16px] text-black/40 dark:text-white/45">
              {songArtistText(current)}
            </p>
          )}
        </div>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-[2.5px]">
          {WAVE_BARS.map((h, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-full transition-colors duration-300 ${
                playing
                  ? 'animate-[music-wave_0.9s_ease-in-out_infinite] bg-black/30 dark:bg-white/40'
                  : 'bg-black/[0.16] dark:bg-white/20'
              }`}
              style={{ height: `${h}px`, transformOrigin: 'center', animationDelay: playing ? `${i * -0.13}s` : undefined }}
            />
          ))}
        </span>
      </div>

      {/* 进度条：已播 / 进度 / 剩余（无歌时自然为 0:00 / 空条 / -0:00） */}
      <div className="mt-auto flex items-center gap-[10px]">
        <span className="w-[34px] shrink-0 text-right text-[12px] font-medium leading-none tabular-nums text-black/70 dark:text-white/70">
          {fmt(pos)}
        </span>
        <span className="relative h-[4px] flex-1 rounded-full bg-black/[0.12] dark:bg-white/[0.18]">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-black/45 dark:bg-white/70 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="w-[42px] shrink-0 text-[12px] font-medium leading-none tabular-nums text-black/70 dark:text-white/70">
          -{fmt(Math.max(0, dur - pos))}
        </span>
      </div>

      {/* 控制键：爱心（左）+ 上一首/播放暂停/下一首（居中三连；无歌时爱心/切歌 no-op）
          无底色纯字形（用户要求去掉黑圆主按钮），图标用「实心 + 2px 同色描边外扩 +
          圆角接缝」加粗（与播放页同风格）；圆形按压高亮 + 200ms 缓动 + 按压缩放 */}
      <div className="mt-auto grid grid-cols-3 items-center">
        <button
          type="button"
          aria-label={liked ? '取消喜欢' : '喜欢'}
          data-testid="music-widget-like"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            if (current) void useMusic.getState().toggleLike(current);
          }}
          className={`-ml-[5px] flex h-[34px] w-[34px] shrink-0 items-center justify-center justify-self-start rounded-full transition-all duration-200 ease-out active:scale-90 active:bg-black/[0.06] dark:active:bg-white/[0.12] ${
            liked ? 'text-[#FF3B30] dark:text-[#FF453A]' : 'text-black/25 dark:text-white/30'
          }`}
        >
          <Heart className="h-[23px] w-[23px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
        </button>
        <div className="flex items-center justify-center gap-[22px]">
          <button
            type="button"
            aria-label="上一首"
            data-testid="music-widget-prev"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              if (current) void useMusic.getState().prev();
            }}
            className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-[#0c0c0e] transition-all duration-200 ease-out active:scale-90 active:bg-black/[0.06] dark:text-white dark:active:bg-white/[0.12]"
          >
            <SkipBack className="h-[23px] w-[23px]" fill="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            data-testid="music-widget-toggle"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              useMusic.getState().toggle();
            }}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full text-[#0c0c0e] transition-all duration-200 ease-out active:scale-90 active:bg-black/[0.06] dark:text-white dark:active:bg-white/[0.12]"
          >
            {playing ? (
              <Pause className="h-[26px] w-[26px]" fill="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />
            ) : (
              <Play className="ml-[1px] h-[26px] w-[26px]" fill="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="下一首"
            data-testid="music-widget-next"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              if (current) void useMusic.getState().next();
            }}
            className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full text-[#0c0c0e] transition-all duration-200 ease-out active:scale-90 active:bg-black/[0.06] dark:text-white dark:active:bg-white/[0.12]"
          >
            <SkipForward className="h-[23px] w-[23px]" fill="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />
          </button>
        </div>
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
