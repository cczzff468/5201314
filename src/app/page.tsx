import { cookies } from 'next/headers';
import PhoneShell from '@/components/ios/PhoneShell';
// 第三十一轮：Cove 韩系开屏动画（冷启动播 ~1.8s 后自动卸载；fixed 全屏盖住一切）
import BootSplash from '@/components/ios/BootSplash';
// 第三十五轮：开屏主题 cookie 服务端直读——修「刚打开先显示另一个开屏、几秒后才变
// 所选的」：APK WebView 冷启动时 SSR HTML 先于 JS 水合绘制（网络慢时缺口数秒），
// 之前 SSR 恒按默认 star 渲染 → 水合前用户看到错误主题。现在 page（server component）
// 同步读 cookie 把 initialTheme 烤进 SSR HTML，水合前首屏就是所选主题；
// 水合后 BootSplash 再按 localStorage 校准 + 自愈 cookie（老用户首启补写）。
import { SPLASH_THEME_COOKIE, validateSplashTheme, type CoveSplashTheme } from '@/lib/ios/splash-theme';

export default async function Home() {
  let initialTheme: CoveSplashTheme | undefined;
  try {
    initialTheme = validateSplashTheme((await cookies()).get(SPLASH_THEME_COOKIE)?.value) ?? undefined;
  } catch {
    /* cookie 读取异常（极端环境）：回退默认 star 路径 */
  }
  return (
    <>
      <BootSplash initialTheme={initialTheme} />
      <PhoneShell />
    </>
  );
}
