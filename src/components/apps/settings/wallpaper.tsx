'use client';

// 壁纸页。

import type { ChangeEvent } from 'react';

import {
  Check,
  Upload,
} from 'lucide-react';

import {
  WALLPAPER_PRESETS,
  useSettings,
} from '@/lib/ios/store';

import {
  IOS_RED,
  DetailShell,
} from './shared';


// ---------------- 壁纸 ----------------

export function WallpaperPage({ onBack }: { onBack: () => void }) {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const setWallpaperPreset = useSettings((s) => s.setWallpaperPreset);
  const setCustomWallpaper = useSettings((s) => s.setCustomWallpaper);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCustomWallpaper(file);
    e.target.value = '';
  };

  return (
    <DetailShell title="壁纸" onBack={onBack} gray>
      <div className="flex flex-col gap-6">
        {customWallpaperUrl && (
          <div>
            <div className="relative h-[140px] w-full overflow-hidden rounded-[14px] shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-black/[0.06]">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${customWallpaperUrl})` }}
              />
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                <Check className="h-4 w-4 text-zinc-900" strokeWidth={3} />
              </span>
              <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white">
                自定义壁纸
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCustomWallpaper(null)}
              className="mt-2.5 text-[13px] transition-opacity active:opacity-50"
              style={{ color: IOS_RED }}
            >
              移除自定义壁纸
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {WALLPAPER_PRESETS.map((p) => {
            const selected = !customWallpaperUrl && wallpaperPreset === p.id;
            return (
              <button key={p.id} type="button" onClick={() => setWallpaperPreset(p.id)} className="text-left">
                <div
                  className="relative h-[120px] overflow-hidden rounded-[14px] shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-black/[0.06] transition-transform active:scale-[0.98]"
                  style={{ background: p.css }}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                      <Check className="h-4 w-4 text-zinc-900" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[14px]">{p.name}</div>
              </button>
            );
          })}
        </div>

        <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-white/80 text-[15px] font-medium text-zinc-900 shadow-[0_2px_12px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-2xl transition-all active:scale-[0.96]">
          <Upload className="h-4 w-4" />
          上传自定义壁纸
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>

        <p className="px-1 text-[12px] leading-relaxed text-zinc-500">
          自定义壁纸保存在本机 IndexedDB，不会上传。
        </p>
      </div>
    </DetailShell>
  );
}
