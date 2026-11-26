'use client';

// 外观与主题页（第三十八轮新增「App 图标」四选一网格——一键无感换图标；
// 第三十九轮：机主删除暗黑版/二次元版，图标网格收敛回两选一，并新增「状态栏模式」选择器）。

import {
  Check,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

import {
  useSettings,
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

  const options: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'auto', label: '跟随系统', icon: Monitor },
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

      {/* App 图标（第三十八轮：机主要求「设置→外观」放图标网格）——四选一点选即换：
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
