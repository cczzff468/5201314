'use client';

// 外观与主题页（第三十八轮新增「App 图标」网格——一键无感换图标；第三十九轮收敛两选一
// +「状态栏模式」选择器；第四十轮四选一；第四十一轮：机主换 3 号原图 + 新增 5 号五选一·3 号默认）。

import {
  Check,
  Eye,
  EyeOff,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import {
  useSettings,
  type StatusBarMode,
  type ThemeMode,
} from '@/lib/ios/store';

import {
  GroupCard,
  DetailShell,
} from './shared';

import { AppIconGrid } from './app-icon-grid';


// ---------------- 外观与主题 ----------------

export function ThemePage({ onBack }: { onBack: () => void }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const appIcon = useSettings((s) => s.appIcon);
  const statusBarMode = useSettings((s) => s.statusBarMode);
  const setStatusBarMode = useSettings((s) => s.setStatusBarMode);

  const options: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'auto', label: '跟随系统', icon: Monitor },
  ];

  // 状态栏模式两选一（第三十九轮新增 → 第四十轮收敛：机主定调「不管透明融合/
  // 完全隐藏都让网页里面的状态栏显示出来」——两模式下自绘状态栏均常驻显示，
  // 模式差异仅原生层历史语义（v2.4.23 起两模式等效：物理系统条均隐藏、自绘唯一））
  const sbModes: { value: StatusBarMode; label: string; desc: string; icon: LucideIcon; recommended?: boolean }[] = [
    {
      value: 'transparent',
      label: '透明融合',
      desc: '状态栏常驻 · 背景透明融入页面顶部',
      icon: Eye,
      recommended: true,
    },
    {
      value: 'hidden',
      label: '完全隐藏',
      desc: '物理系统条彻底隐藏 · 网页状态栏仍常驻',
      icon: EyeOff,
    },
  ];

  return (
    <DetailShell title="显示与亮度" onBack={onBack} gray>
      <GroupCard>
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              className="flex h-[46px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
            >
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="flex-1 text-[16px]">{o.label}</span>
              {theme === o.value && (
                <Check className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2.5} />
              )}
            </button>
          );
        })}
      </GroupCard>

      {/* 状态栏模式（第四十轮收敛：机主定调「不管透明融合/完全隐藏都让网页里的
          状态栏显示出来」）——两模式下自绘状态栏均常驻渲染（时间/电量/WiFi 永远
          在场，透明浮层融入顶部）；v2.4.23+ APK 物理系统条两模式均隐藏（自绘是
          唯一状态栏）。点选即生效并持久化（本地数据库 + localStorage 首帧镜像 +
          原生 SharedPreferences 三写，重启自动应用）。 */}
      <div className="mt-4">
        <p className="mb-2 px-1 text-[12.5px] font-medium text-black/45 dark:text-white/45">状态栏模式</p>
        <div
          role="radiogroup"
          aria-label="状态栏模式"
          data-testid="statusbar-mode-group"
          className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]"
        >
          {sbModes.map((o) => {
            const Icon = o.icon;
            const sel = statusBarMode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={sel}
                aria-label={`${o.label}（${o.desc}）`}
                data-testid={`statusbar-mode-${o.value}`}
                onClick={() => setStatusBarMode(o.value)}
                className="flex min-h-[54px] w-full items-center gap-3 px-4 py-1.5 text-left transition-colors active:bg-muted/50"
              >
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[16px]">{o.label}</span>
                    {o.recommended && (
                      <span className="rounded-full bg-[#007AFF]/[0.1] px-1.5 py-[1px] text-[9.5px] font-medium text-[#007AFF]">
                        推荐
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{o.desc}</span>
                </span>
                {sel && <Check className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          选择即生效并保存到本地数据库，重启后自动应用；两种模式下网页状态栏均常驻显示
          （时间/电量/WiFi），内容按挖孔口径避让顶部安全区。APK 端需 v2.4.23+ 壳生效。
        </p>
      </div>

      {/* App 图标（第四十一轮五选一·3 号情书字标默认）——点选即换：
          APK 端原生 activity-alias 切换（免重装、旧图标消失新图标上桌面、App 退回桌面）；
          浏览器/PWA 端 manifest 动态接口自动跟随（Chrome/Edge 下次打开时生效）。 */}
      <div className="mt-4">
        <p className="mb-2 px-1 text-[12.5px] font-medium text-black/45 dark:text-white/45">App 图标</p>
        <div className="overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <AppIconGrid current={appIcon} size="page" />
        </div>
        <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          点选即换：APK 端免重装一键切换（切换后自动退回桌面）；浏览器安装的 PWA
          桌面图标自动跟随（下次打开时生效，无需重新下载）；iOS 主屏图标需重新添加一次。
        </p>
      </div>

      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        跟随系统将随设备深色模式自动切换，过渡动画平滑。
      </p>
    </DetailShell>
  );
}
