'use client';

/**
 * 黑胶唱片小组件（第四页 2×3 方格，用户参考图样式）：
 * 一张大黑胶唱片 + 右上角唱针（枢轴圆点 + 弯臂 + 唱头落在盘面纹路上），
 * 盘面缓慢旋转表示播放中；纯装饰浮在壁纸上（无边框无卡体无投影）。
 * 黑胶黑盘 + 浅盘标深浅主题两态通用（黑胶本体的质感）。
 * 点击打开音乐 App（WIDGET_META.openApp 驱动）。
 *
 * 真实播放适配（音乐小组件同轮需求）——直连音乐 store（与播放页同一状态源）：
 * - 有歌时：盘标实时显示当前歌曲封面（随盘旋转）、唱片仅播放中旋转（暂停即停转）、
 *   唱片下方显示歌名 - 歌手（白字深描边 / light=true 壁纸偏浅时改黑字白描边）；
 * - 无歌时保持原装饰态（浅盘标 + 恒旋转）。
 */

import { useMusic } from '@/lib/ios/music-store';
import { songArtistText, songCover } from '@/lib/ios/music-api';

export function VinylCardWidget({ light = false }: { light?: boolean }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);

  const titleColor = light
    ? 'text-[#1c1c1e] [text-shadow:0_1px_4px_rgba(255,255,255,0.7)]'
    : 'text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]';

  return (
    <div className="relative h-[260px] w-full select-none">
      {/* 大黑胶唱片（播放中缓慢旋转）：黑色盘体 + 细密纹路 + 盘标（有歌时=当前封面）+ 中心孔 */}
      <div className="absolute left-1/2 top-[22px] h-[150px] w-[150px] -translate-x-1/2">
        <div
          aria-hidden={!current}
          className="h-full w-full rounded-full bg-[#141416] animate-[netease-spin_16s_linear_infinite]"
          style={{ animationPlayState: playing ? 'running' : 'paused' }}
        >
          {/* 纹路（同心细圈，由外向内） */}
          <span className="absolute inset-[6px] rounded-full border border-white/[0.07]" />
          <span className="absolute inset-[12px] rounded-full border border-white/[0.06]" />
          <span className="absolute inset-[18px] rounded-full border border-white/[0.055]" />
          <span className="absolute inset-[24px] rounded-full border border-white/[0.05]" />
          <span className="absolute inset-[30px] rounded-full border border-white/[0.045]" />
          {/* 盘标（有歌时显示当前歌曲封面）+ 中心孔 */}
          <span className="absolute left-1/2 top-1/2 h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-[#f0f0f2]">
            {current && (
              <img
                src={songCover(current)}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
                data-testid="vinyl-widget-cover"
              />
            )}
          </span>
          <span className="absolute left-1/2 top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#141416]" />
        </div>
      </div>

      {/* 唱针：右上角枢轴 → 弯臂探向盘面（唱头落在唱片纹路上） */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-[2px] top-[6px] h-[74px] w-[88px]"
        viewBox="0 0 88 74"
        fill="none"
      >
        <path d="M76 12 L36 56" stroke="#f4f4f6" strokeWidth="4.4" strokeLinecap="round" />
        <path d="M36 56 L27 66" stroke="#f4f4f6" strokeWidth="8" strokeLinecap="round" />
        <circle cx="76" cy="12" r="9" fill="#f4f4f6" />
        <circle cx="76" cy="12" r="3.4" fill="#9a9aa0" />
      </svg>

      {/* 正在播放的歌名 - 歌手（有歌时显示；颜色随壁纸明暗自适应保证可读） */}
      {current && (
        <div className={`absolute inset-x-[6px] bottom-[6px] text-center`} data-testid="vinyl-widget-now">
          <p className={`truncate text-[12px] font-semibold leading-[16px] ${titleColor}`}>{current.name}</p>
          <p className={`mt-[1px] truncate text-[10px] leading-[13px] ${light ? 'text-[#1c1c1e]/60' : 'text-white/65'}`}>
            {songArtistText(current)}
          </p>
        </div>
      )}
    </div>
  );
}
