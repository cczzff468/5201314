'use client';

import { useUI, useSettings, useSystemDark, selectResolvedTheme } from '@/lib/ios/store';
import { APP_MAP } from '../apps/registry';
import StatusBarToneProbe from './StatusBarToneProbe';

/**
 * App 窗口容器：iOS 风格的打开/关闭缩放动画。
 * Home 指示条由 PhoneShell 统一常显渲染（所有界面一致，按背景明暗选黑/白）。
 * 容器内末尾挂自动基调探针（Task 100-f）：非自管基调的 App，状态栏前景实时跟随
 * 实际渲染背景明暗（深底白字/浅底黑字）；音乐 App 自管基调不挂（避免推栈打架）。
 *
 * 深色模式适配（第六十七轮）：淘宝/美团两个购物 App 界面体量大（数千行、写死浅色
 * 表面色），逐类改 dark: 变体不现实——全局深色时给容器挂 shop-dark 作用域类，
 * 由 shop-dark.css（构建期脚本从两个 App 的源码提取色值生成）按选择器覆盖：
 * 白面/浅灰面 → 深色表面、黑字 → 白字、粉彩贴片 → 深色同色调贴片；
 * 品牌色（淘宝橙/美团黄）与压暗遮罩保持原样。其余 App 不挂作用域，零影响。
 */
const SHOP_DARK_APPS = new Set(['taobao', 'meituan']);

export default function AppWindow() {
  const activeApp = useUI((s) => s.activeApp);
  const phase = useUI((s) => s.phase);
  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(theme, systemDark) === 'dark';

  if (!activeApp) return null;
  const meta = APP_MAP[activeApp];
  if (!meta) return null;
  const App = meta.component;
  const shopDark = dark && SHOP_DARK_APPS.has(activeApp);

  return (
    <div
      role="dialog"
      aria-label={meta.name}
      className={`absolute inset-0 z-40 overflow-hidden bg-background will-change-[transform,opacity] transition-all duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
        phase === 'open' ? 'scale-100 rounded-none opacity-100' : 'scale-[0.18] rounded-[48px] opacity-0'
      } ${shopDark ? 'shop-dark' : ''}`}
    >
      <App />
      {!meta.statusBarToneSelfManaged && <StatusBarToneProbe />}
    </div>
  );
}
