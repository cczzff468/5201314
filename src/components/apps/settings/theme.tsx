'use client';

// 外观与主题页。

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


// ---------------- 外观与主题 ----------------

export function ThemePage({ onBack }: { onBack: () => void }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

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
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        跟随系统将随设备深色模式自动切换，过渡动画平滑。
      </p>
    </DetailShell>
  );
}
