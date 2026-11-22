'use client';

import { type ChangeEvent, type CSSProperties, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Check, ChevronRight, LayoutGrid, Lock, RotateCcw, Upload, X } from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { ThemesWidgetsPage } from '@/components/ios/WidgetGallery';
import { APPS, AppStylePreview, AppIconTile } from '@/components/apps/registry';
import {
  selectResolvedTheme,
  useSettings,
  useSystemDark,
  WALLPAPER_PRESETS,
  type AppId,
  type IconStyle,
  type ThemeMode,
} from '@/lib/ios/store';

// ---------------- 常量 ----------------

const IOS_RED = '#FF453A';

const APPEARANCE_OPTIONS: { value: ThemeMode; name: string; desc: string }[] = [
  { value: 'light', name: '浅色', desc: '明亮界面' },
  { value: 'dark', name: '深色', desc: '夜间护眼' },
  { value: 'auto', name: '自适应', desc: '跟随系统自动切换' },
];

/** 主屏图标样式三选一（本轮新增）：真实=原始彩色实体图；毛玻璃=磨砂玻璃底座+粗线条；
 *  液态透明=透明液态玻璃泡+高光亮边。预览用微信图标（彩色实体图 App，三态差异最直观） */
const ICON_STYLES: { value: IconStyle; name: string; desc: string }[] = [
  { value: 'real', name: '真实图标', desc: '原始彩色' },
  { value: 'glass', name: '毛玻璃图标', desc: '磨砂粗线条' },
  { value: 'liquid', name: '液态透明', desc: '透明玻璃' },
];

// ---------------- 外观缩略图 ----------------

/** 44px 手机缩略图：mini 手机（2x3 图标点阵 + 底部 dock 条），三种外观各自配色 */
function AppearanceThumb({ variant }: { variant: ThemeMode }) {
  const autoBg = 'linear-gradient(135deg, #F2F2F7 49.5%, #1C1C1E 50.5%)';
  const surface = variant === 'light' ? '#FFFFFF' : variant === 'dark' ? '#1C1C1E' : undefined;
  const dot =
    variant === 'light' ? '#C7C7CC' : variant === 'dark' ? 'rgba(255,255,255,0.55)' : '#8E8E93';

  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white/60 p-1 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
      <span
        className="flex h-full w-full flex-col justify-between rounded-[6px] p-[3px]"
        style={variant === 'auto' ? { backgroundImage: autoBg } : { backgroundColor: surface }}
      >
        <span className="grid flex-1 grid-cols-2 grid-rows-3 place-items-center">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-1 w-1 rounded-full" style={{ backgroundColor: dot }} />
          ))}
        </span>
        <span className="mx-auto h-[3px] w-[58%] shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      </span>
    </span>
  );
}

// ---------------- 壁纸预览样式 ----------------

/** 预览背景样式（与实际壁纸渲染逻辑一致：自定义优先，预设用 background 简写） */
function previewStyle(presetId: string, customUrl: string | null): CSSProperties {
  if (customUrl) {
    return { backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  const preset = WALLPAPER_PRESETS.find((p) => p.id === presetId);
  return { background: preset?.css ?? '#000' };
}

// ---------------- 壁纸卡片（主屏幕 / 锁屏 左右平行，完全独立） ----------------

/**
 * 一张壁纸卡 = 标题 + 小预览 + 当前状态 + 独立上传/移除 + 独立预设网格（紧凑竖排）。
 * 主屏幕与锁屏左右平行并排各一张，互不影响（壁纸分开、上传也分开）。
 */
function WallpaperCard({
  kind,
  presetId,
  customUrl,
  onSelectPreset,
  onUpload,
  onRemoveCustom,
}: {
  kind: 'home' | 'lock';
  presetId: string;
  customUrl: string | null;
  onSelectPreset: (id: string) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveCustom: () => void;
}) {
  const isLock = kind === 'lock';
  const label = isLock ? '锁屏' : '主屏幕';
  const activePreset = WALLPAPER_PRESETS.find((p) => p.id === presetId);

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] bg-white/60 p-3 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
      {/* 标题 */}
      <div className="flex min-h-[20px] items-center gap-1.5">
        {isLock ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
        )}
        <span className="text-[13px] font-semibold leading-tight">{label}壁纸</span>
      </div>

      {/* 预览（居中小手机） */}
      <div className="mt-2.5 flex justify-center">
        <div
          aria-hidden="true"
          className="relative h-[118px] w-[62px] overflow-hidden rounded-[12px] border border-border/70 shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
          style={previewStyle(presetId, customUrl)}
        >
          {isLock ? (
            <span className="absolute inset-x-0 top-2.5 flex flex-col items-center text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
              <Lock className="h-2.5 w-2.5 opacity-90" strokeWidth={2.4} />
              <span className="mt-1 text-[13px] font-semibold leading-none tabular-nums">9:41</span>
            </span>
          ) : (
            <span aria-hidden="true" className="absolute inset-x-1.5 top-2 grid grid-cols-4 gap-[3px]">
              {Array.from({ length: 8 }, (_, i) => (
                <span
                  key={i}
                  className="h-[9px] w-[9px] rounded-[2.5px] border border-white/40 bg-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                />
              ))}
            </span>
          )}
        </div>
      </div>

      {/* 当前状态 */}
      <p className="mt-2 truncate text-center text-[11px] leading-none text-muted-foreground">
        {customUrl ? '自定义壁纸 · 来自上传' : `预设：${activePreset?.name ?? '—'}`}
      </p>

      {/* 独立的上传 / 移除（每张卡各自一份） */}
      <div className="mt-2 divide-y divide-border/60 overflow-hidden rounded-[10px] bg-white/50 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.09]">
        <label className="flex cursor-pointer items-center justify-center gap-1.5 px-2 py-2 transition-colors active:bg-muted/50">
          <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          <span className="text-[12px] leading-none">从手机上传</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onUpload}
            aria-label={`上传${label}壁纸`}
          />
        </label>
        {customUrl && (
          <button
            type="button"
            onClick={onRemoveCustom}
            className="flex w-full items-center justify-center gap-1.5 px-2 py-2 text-left transition-colors active:bg-muted/50"
          >
            <RotateCcw
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
              style={{ color: IOS_RED }}
            />
            <span className="text-[12px] leading-none" style={{ color: IOS_RED }}>
              移除自定义
            </span>
          </button>
        )}
      </div>

      {/* 独立预设网格（2 列小缩略图） */}
      <div role="listbox" aria-label={`${label}壁纸预设`} className="mt-2.5 grid grid-cols-2 gap-2">
        {WALLPAPER_PRESETS.map((p) => {
          const selected = !customUrl && presetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={`${p.name}（设为${label}壁纸）`}
              onClick={() => onSelectPreset(p.id)}
              className="relative h-[40px] overflow-hidden rounded-[10px] border border-border/60 transition active:opacity-70"
              style={{ background: p.css }}
            >
              {selected && (
                <>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[10px] ring-[1.5px] ring-foreground ring-inset"
                  />
                  <span className="absolute right-1 top-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-foreground text-background shadow-sm">
                    <Check className="h-2 w-2" strokeWidth={4} aria-hidden="true" />
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 自定义图标 ----------------

/** 自定义图标统一缩至 192×192（中心正方形裁剪，PNG 保留透明度），控制 IndexedDB 体积 */
async function cropSquareIcon(file: File): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, 192, 192);
    bmp.close?.();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

// ---------------- 主组件 ----------------

export default function ThemesApp() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const customIcons = useSettings((s) => s.customIcons);
  const setCustomIcon = useSettings((s) => s.setCustomIcon);
  const resetAllCustomIcons = useSettings((s) => s.resetAllCustomIcons);
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const setWallpaperPreset = useSettings((s) => s.setWallpaperPreset);
  const setCustomWallpaper = useSettings((s) => s.setCustomWallpaper);
  const lockWallpaperPreset = useSettings((s) => s.lockWallpaperPreset);
  const lockCustomWallpaperUrl = useSettings((s) => s.lockCustomWallpaperUrl);
  const setLockWallpaperPreset = useSettings((s) => s.setLockWallpaperPreset);
  const setLockCustomWallpaper = useSettings((s) => s.setLockCustomWallpaper);
  /** 小组件独立界面（全屏子页：全部小组件 1:1 预览与添加） */
  const [widgetsPageOpen, setWidgetsPageOpen] = useState(false);
  /** 自定义图标区折叠状态（可收缩，用户要求；记忆上次选择，默认展开） */
  const [iconsOpen, setIconsOpen] = useState(() => {
    try {
      return localStorage.getItem('themes.iconSectionCollapsed') !== '1';
    } catch {
      return true;
    }
  });
  /** 全局图标样式（本轮：真实/毛玻璃/液态透明三选一，持久化，主屏/多任务实时跟随） */
  const iconStyle = useSettings((s) => s.iconStyle);
  const setIconStyle = useSettings((s) => s.setIconStyle);

  const systemDark = useSystemDark();
  const resolved = selectResolvedTheme(theme, systemDark);
  const themeName = resolved === 'dark' ? '深色' : '浅色';
  const effectText = theme === 'auto' ? `${themeName}(auto+系统${systemDark ? '暗' : '亮'})` : themeName;

  /** 主屏幕壁纸：从手机上传（与锁屏互不影响） */
  const handleHomeUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCustomWallpaper(file);
    e.target.value = '';
  };

  /** 锁屏壁纸：从手机上传（独立入口，与主屏幕互不影响） */
  const handleLockUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setLockCustomWallpaper(file);
    e.target.value = '';
  };

  /** 上传自定义 App 图标（自动裁成正方形缩至 192px） */
  const handleIconUpload = async (appId: AppId, e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const blob = await cropSquareIcon(file);
    if (blob) setCustomIcon(appId, blob);
  };

  const customIconCount = Object.keys(customIcons).length;

  return (
    <IOSScreen className="relative">
      <IOSNavBar inline title="主题" left={<BackToHome className="static!" />} />
      <div className="no-scrollbar flex-1 overflow-y-auto pb-[40px] pt-1">
        {/* 外观 */}
        <div className="mb-2 px-8 text-[13px] text-muted-foreground">外观</div>
        <div className="mx-4 divide-y divide-border/60 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          {APPEARANCE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors active:bg-muted/50"
            >
              <AppearanceThumb variant={o.value} />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] leading-tight">{o.name}</span>
                <span className="mt-1 block text-[13px] leading-tight text-muted-foreground">{o.desc}</span>
              </span>
              {theme === o.value && (
                <Check className="h-6 w-6 shrink-0 text-foreground" strokeWidth={2.4} />
              )}
            </button>
          ))}
        </div>
        <p className="px-8 pt-2 text-[13px] text-muted-foreground">当前生效：{effectText}</p>

        {/* 壁纸：主屏幕 / 锁屏 左右平行两张独立卡片（预设 / 上传 / 移除各自分开） */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">壁纸</div>
        <div className="mx-4 grid grid-cols-2 items-stretch gap-3">
          <WallpaperCard
            kind="home"
            presetId={wallpaperPreset}
            customUrl={customWallpaperUrl}
            onSelectPreset={setWallpaperPreset}
            onUpload={handleHomeUpload}
            onRemoveCustom={() => setCustomWallpaper(null)}
          />
          <WallpaperCard
            kind="lock"
            presetId={lockWallpaperPreset}
            customUrl={lockCustomWallpaperUrl}
            onSelectPreset={setLockWallpaperPreset}
            onUpload={handleLockUpload}
            onRemoveCustom={() => setLockCustomWallpaper(null)}
          />
        </div>
        <p className="mt-2 px-8 text-[12px] leading-relaxed text-muted-foreground">
          主屏幕与锁屏壁纸完全独立：各自选择预设或从手机上传，互不影响。上传的壁纸保存在本机
          IndexedDB，永久生效，不会上传服务器。
        </p>

        {/* 图标样式（本轮：自定义图标上方新增；全局三选一，主屏/文件夹/Spotlight/多任务实时跟随） */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">图标样式</div>
        <div className="mx-4 overflow-hidden rounded-[20px] bg-white/60 px-4 pb-4 pt-4 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="grid grid-cols-3 gap-2">
            {ICON_STYLES.map((opt) => {
              const selected = iconStyle === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`icon-style-${opt.value}`}
                  aria-pressed={selected}
                  aria-label={`图标样式：${opt.name}`}
                  onClick={() => {
                    setIconStyle(opt.value);
                    navigator.vibrate?.(6);
                  }}
                  className="flex flex-col items-center gap-1.5 transition active:opacity-70"
                >
                  <span
                    className={`relative block h-[56px] w-[56px] overflow-hidden rounded-[14px] bg-muted shadow-[0_2px_6px_rgba(0,0,0,0.25)] transition ${
                      selected ? 'ring-[1.5px] ring-inset ring-foreground' : 'ring-1 ring-inset ring-border/60'
                    }`}
                  >
                    <AppStylePreview id="wechat" style={opt.value} />
                    {selected && (
                      <span className="absolute right-1 top-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-foreground text-background shadow-sm">
                        <Check className="h-2 w-2" strokeWidth={4} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className={`text-[11px] leading-none ${selected ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                    {opt.name}
                  </span>
                  <span className="text-[10px] leading-none text-muted-foreground/70">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 商品图样式选择器已迁出（第六十六轮）：淘宝「我的→原红包位」与美团「我的→原工作兼职位」
            各自三选一（goods-style-sheet.tsx 共用弹层），主题页不再重复提供 */}

        {/* 自定义图标（排在小组件上面；区块可收缩——点标题展开/收起并记忆选择）：
            点图标从手机上传自定义，左上角 × 单独恢复默认，底部恢复全部默认（带确认）；
            图标预览用 AppIconTile 强制「浅磨砂玻璃 + 深灰线」，任何主题/壁纸下都清晰可见
            （修：浅色主题 + 深色壁纸时 LineIcon 白线画在浅色卡片上一片空白） */}
        <button
          type="button"
          data-testid="custom-icons-toggle"
          aria-expanded={iconsOpen}
          onClick={() => {
            const next = !iconsOpen;
            setIconsOpen(next);
            try {
              localStorage.setItem('themes.iconSectionCollapsed', next ? '0' : '1');
            } catch {
              /* 持久化失败仅本次会话生效 */
            }
            navigator.vibrate?.(6);
          }}
          className="mb-2 mt-6 flex w-full items-center justify-between px-8 text-[13px] text-muted-foreground transition-opacity active:opacity-60"
        >
          <span>自定义图标</span>
          <ChevronRight
            aria-hidden="true"
            className={`h-4 w-4 transition-transform duration-300 ${iconsOpen ? 'rotate-90' : ''}`}
            strokeWidth={2.4}
          />
        </button>
        <div
          className={`mx-4 grid transition-[grid-template-rows] duration-300 ease-out ${
            iconsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="overflow-hidden rounded-[20px] bg-white/60 px-4 pb-4 pt-4 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
              <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                {APPS.map((a) => {
                  const customUrl = customIcons[a.id];
                  return (
                    <div key={a.id} className="flex flex-col items-center gap-1.5">
                      <label className="relative block cursor-pointer">
                        <span
                          aria-hidden="true"
                          className="block h-[56px] w-[56px] overflow-hidden rounded-[14px] bg-muted shadow-[0_2px_6px_rgba(0,0,0,0.25)] ring-1 ring-inset ring-border/60 transition active:opacity-70"
                        >
                          {customUrl ? (
                            <img
                              src={customUrl}
                              alt=""
                              draggable={false}
                              className="h-full w-full select-none object-cover"
                            />
                          ) : (
                            <AppIconTile id={a.id} />
                          )}
                        </span>
                        {customUrl && (
                          <button
                            type="button"
                            aria-label={`恢复${a.name}默认图标`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              navigator.vibrate(6);
                              setCustomIcon(a.id, null);
                            }}
                            className="absolute -left-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white shadow-md ring-2 ring-card transition active:scale-90"
                            style={{ backgroundColor: IOS_RED }}
                          >
                            <X className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden="true" />
                          </button>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          aria-label={`上传${a.name}自定义图标`}
                          onChange={(e) => void handleIconUpload(a.id, e)}
                        />
                      </label>
                      <span className="max-w-[64px] truncate text-[11px] leading-none text-muted-foreground">
                        {a.name}
                      </span>
                    </div>
                  );
                })}
              </div>

              {customIconCount > 0 && (
                <div className="mt-4 flex items-center gap-3 rounded-[12px] border border-border/60 bg-muted/40 px-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'rgba(255, 69, 58, 0.12)' }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} style={{ color: IOS_RED }} />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-tight text-muted-foreground">
                    已自定义 <span className="font-medium text-foreground">{customIconCount}</span> 个图标
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 text-[13px] font-medium transition active:opacity-50"
                        style={{ color: IOS_RED }}
                      >
                        恢复全部默认
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
                      <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
                        <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
                          恢复全部默认图标？
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-center text-[13px] leading-snug">
                          全部 {customIconCount} 个自定义图标将恢复为默认图标，此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
                        <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
                          取消
                        </AlertDialogCancel>
                        <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
                        <AlertDialogAction
                          className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
                          style={{ color: IOS_RED }}
                          onClick={() => {
                            navigator.vibrate(10);
                            resetAllCustomIcons();
                          }}
                        >
                          恢复默认
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                点按图标从手机相册选择图片，自动裁剪为正方形；点左上角 ×
                可单独恢复该图标默认。图标保存在本机，不会上传服务器。
              </p>
            </div>
          </div>
        </div>

        {/* 小组件：独立界面（用户要求单独的界面）——入口行打开全屏子页（全部小组件 1:1 预览与添加） */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">小组件</div>
        <div className="mx-4 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <button
            type="button"
            data-testid="themes-widgets-entry"
            aria-haspopup="dialog"
            onClick={() => setWidgetsPageOpen(true)}
            className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-muted/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] leading-tight">小组件界面</span>
              <span className="mt-1 block text-[13px] leading-tight text-muted-foreground">
                全部小组件 1:1 预览 · 点右上角 + 添加到主屏幕
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 小组件独立界面（全屏子页，覆盖整个主题 App） */}
      {widgetsPageOpen && <ThemesWidgetsPage onClose={() => setWidgetsPageOpen(false)} />}
    </IOSScreen>
  );
}
