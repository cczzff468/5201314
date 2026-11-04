'use client';

/**
 * 网易云音乐小组件（第三页 2×3 方格，用户参考图样式）：
 * 圆角卡片上方叠一只黑胶唱片（唱臂从右上角探到盘面，盘面缓慢旋转表示播放中），
 * 卡片内为右上角投播徽标、进度条（已播 / -剩余）、退带/暂停/快进控制键、
 * 底部「一起听」语音胶囊（播放三角 + 声波条）。
 * 盘缘装饰徽标（爱心/声波）已按用户要求删除。
 * 点击卡片空白处打开音乐 App（WIDGET_META.openApp 驱动）；无投影，仅轻描边
 * （与其它小组件一致，用户要求小组件无阴影）。
 * 深浅主题自适应（用户要求小组件适配深色）：浅色=浅灰卡黑字，深色=炭黑卡白字；
 * 黑胶唱片本体黑盘 + 浅盘标两态通用（黑胶本来就更适合深色）。
 *
 * 真实播放适配（音乐小组件同轮需求）——直连音乐 store（与播放页同一状态源）：
 * - 有歌时：盘标实时显示当前歌曲封面（随盘旋转）、唱片仅播放中旋转（暂停即停转）、
 *   进度条与两侧时间显示真实 position/duration、三个控制键真实可用
 *   （上一首/播放暂停/下一首，同 MusicWidget）；
 * - 无歌时保持原装饰态（55% 进度 + 1:15/-2:38 占位），控制键点按是安全 no-op；
 * - 控制键 pointerdown/click 双重 stopPropagation——既不触发开 App，也不参与
 *   主屏长按编辑/拖拽手势（与 MusicGlobalMini 的按钮拦截同思路）。
 */

import { Airplay, FastForward, Pause, Play, Rewind } from 'lucide-react';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { useMusic } from '@/lib/ios/music-store';
import { songCover, songDurationMs } from '@/lib/ios/music-api';

/** 底部胶囊里的声波条高度序列（固定值，避免随机数导致水合不一致） */
const WAVE_BARS = [7, 11, 15, 9, 17, 12, 8, 16, 10, 18, 9, 14, 7, 12, 16, 8, 10, 6];

/** 秒 → m:ss（进度条两侧时间） */
const fmtTime = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export function NeteaseCardWidget() {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);

  /** 时长：engine durationchange 之前回退歌曲元数据时长；无歌时走装饰占位 */
  const dur = duration > 0 ? duration : current ? songDurationMs(current) / 1000 : 0;
  const pos = Math.min(position, dur > 0 ? dur : position);
  const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 55;
  const curText = current && dur > 0 ? fmtTime(pos) : '1:15';
  const remText = current && dur > 0 ? `-${fmtTime(Math.max(0, dur - pos))}` : '-2:38';

  /** 控制键拦截：pointerdown 阻断主屏长按编辑/拖拽武装，click 阻断「点小组件开 App」 */
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="relative h-[260px] w-full select-none">
      {/* 黑胶唱片（播放中缓慢旋转）：黑色盘体 + 细密纹路 + 盘标（有歌时=当前封面）+ 中心孔 */}
      <div className="absolute left-1/2 top-[10px] z-[1] h-[104px] w-[104px] -translate-x-1/2">
        <div
          aria-hidden={!current}
          className="h-full w-full rounded-full bg-[#17171a] animate-[netease-spin_16s_linear_infinite]"
          style={{ animationPlayState: playing ? 'running' : 'paused' }}
        >
          {/* 纹路（同心细圈） */}
          <span className="absolute inset-[5px] rounded-full border border-white/[0.07]" />
          <span className="absolute inset-[13px] rounded-full border border-white/[0.06]" />
          <span className="absolute inset-[21px] rounded-full border border-white/[0.05]" />
          {/* 盘标（有歌时显示当前歌曲封面）+ 中心孔 */}
          <span className={`absolute left-1/2 top-1/2 h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full ${dark ? 'bg-[#34343a]' : 'bg-[#ececef]'}`}>
            {current && (
              <img
                src={songCover(current)}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
                data-testid="netease-widget-cover"
              />
            )}
          </span>
          <span className="absolute left-1/2 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#17171a]" />
        </div>
      </div>

      {/* 唱臂：右上角枢轴 → 弯臂探向盘面（唱头落在唱片纹路上；白臂深浅两态均可见） */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-[6px] top-[2px] z-[2] h-[48px] w-[64px]"
        viewBox="0 0 64 48"
        fill="none"
      >
        <path d="M56 10 L28 40" stroke="#f2f2f4" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M28 40 L21 47" stroke="#f2f2f4" strokeWidth="6" strokeLinecap="round" />
        <circle cx="56" cy="10" r="7" fill="#f2f2f4" />
        <circle cx="56" cy="10" r="2.6" fill="#9a9aa0" />
      </svg>

      {/* 卡片主体（上缘被唱片压住；深浅主题自适应） */}
      <div className={`absolute inset-x-0 bottom-0 top-[84px] rounded-[24px] ring-1 ${dark ? 'bg-[#232327] ring-white/[0.08]' : 'bg-[#e9e9ec] ring-black/[0.06]'}`}>
        {/* 投播徽标（右上） */}
        <span className={`absolute right-[10px] top-[12px] flex h-[24px] w-[24px] items-center justify-center rounded-full ${dark ? 'bg-[#3a3a41]' : 'bg-[#d6d6da]'}`}>
          <Airplay className={`h-[12px] w-[12px] ${dark ? 'text-[#eaeaec]' : 'text-[#2c2c30]'}`} strokeWidth={2.2} aria-hidden="true" />
        </span>

        {/* 进度条（真实进度，无歌时 55% 装饰位）+ 时间 */}
        <div className="absolute inset-x-[18px] top-[64px]">
          <span className={`relative block h-[2.5px] rounded-full ${dark ? 'bg-[#48484e]' : 'bg-[#c6c6cb]'}`}>
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${dark ? 'bg-[#f0f0f2]' : 'bg-[#232327]'}`}
              style={{ width: `${pct}%` }}
            />
            <span
              className={`absolute -top-[3px] h-[9px] w-[9px] rounded-full transition-[right] duration-300 ${dark ? 'bg-[#f0f0f2]' : 'bg-[#232327]'}`}
              style={{ right: `calc(${pct}% - 4px)` }}
            />
          </span>
          <div className={`mt-[5px] flex items-center justify-between text-[11px] leading-none tabular-nums ${dark ? 'text-[#a0a0a6]' : 'text-[#77777d]'}`}>
            <span data-testid="netease-widget-pos">{curText}</span>
            <span data-testid="netease-widget-rem">{remText}</span>
          </div>
        </div>

        {/* 控制键（实心：退带 / 暂停播放 / 快进——真实可用，直连音乐 store） */}
        <div className={`absolute inset-x-0 top-[104px] flex items-center justify-center gap-[24px] ${dark ? 'text-[#ececef]' : 'text-[#1d1d21]'}`}>
          <button
            type="button"
            aria-label="上一首"
            data-testid="netease-widget-prev"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              void useMusic.getState().prev();
            }}
            className="transition-transform active:scale-90"
          >
            <Rewind className="h-[19px] w-[19px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            data-testid="netease-widget-toggle"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              useMusic.getState().toggle();
            }}
            className="transition-transform active:scale-90"
          >
            {playing ? (
              <Pause className="h-[22px] w-[22px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
            ) : (
              <Play className="ml-[1px] h-[22px] w-[22px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="下一首"
            data-testid="netease-widget-next"
            onPointerDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              void useMusic.getState().next();
            }}
            className="transition-transform active:scale-90"
          >
            <FastForward className="h-[19px] w-[19px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
          </button>
        </div>

        {/* 「一起听」语音胶囊（播放三角 + 白色声波条） */}
        <div className={`absolute bottom-[10px] left-1/2 flex h-[34px] w-[126px] -translate-x-1/2 items-center gap-[7px] rounded-full pl-[12px] pr-[10px] ${dark ? 'bg-[#3d3d44]' : 'bg-[#cfcfd4]'}`}>
          <Play className="h-[13px] w-[13px] shrink-0 fill-white text-white" aria-hidden="true" />
          <span className="flex flex-1 items-center gap-[2.5px]" aria-hidden="true">
            {WAVE_BARS.map((h, i) => (
              <span key={i} className="w-[2px] rounded-full bg-white" style={{ height: `${h}px` }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
