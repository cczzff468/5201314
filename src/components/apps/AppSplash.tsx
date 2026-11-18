'use client';

/**
 * App 启动加载屏（iOS app-launch 风格）——修「点击打开界面显示太慢」：
 *
 * 所有 App 组件都是 dynamic 懒加载（registry.tsx），chunk 未就绪期间（外网首开
 * 1~5 秒）dynamic 默认渲染 null——AppWindow 弹出的动画窗里是一块背景色空白，
 * 用户感觉「点了没反应 / 界面出不来」。现在加载期间渲染本启动屏：大图标 +
 * App 名 + iOS 风格菊花转，与打开缩放动画（0.18→1）叠在一起就是真 iOS 的
 * 「图标放大成 App」启动观感。
 *
 * 防闪屏：启动屏内容统一延迟 150ms 才淡入（animation delay）——chunk 已缓存时
 * dynamic 一两帧内就位，启动屏随即被真实内容替换，150ms 内从未可见，不闪；
 * 只有真正慢的加载才看得见启动屏。
 *
 * 深浅色：bg-background / text-foreground 随主题；图标直接复用 APP_MAP 的
 * icon 元素（真实 PNG 图标或磨砂玻璃线条图标，按当前图标样式主题渲染）。
 */
import type { AppId } from '@/lib/ios/store';
import { APP_MAP } from './registry';

export default function AppSplash({ appId }: { appId: AppId }) {
  const meta = APP_MAP[appId];
  if (!meta) return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[24px] bg-background">
      {/* 大图标：84px（主屏 60px 的 1.4 倍），淡入 + 轻微上浮进场 */}
      <div
        className="h-[84px] w-[84px]"
        style={{ animation: 'app-splash-in 0.45s cubic-bezier(0.32,0.72,0,1) 0.15s both' }}
      >
        {meta.icon}
      </div>
      {/* App 名 */}
      <div
        className="text-[17px] font-medium tracking-wide text-foreground/60"
        style={{ animation: 'app-splash-in 0.45s ease 0.15s both' }}
      >
        {meta.name}
      </div>
      {/* iOS 风格菊花转：12 根亮度递减的短棒绕圆心匀速旋转 */}
      <div
        className="relative h-[26px] w-[26px]"
        style={{ animation: 'app-splash-in 0.3s ease 0.15s both' }}
        aria-hidden="true"
      >
        <div className="h-full w-full" style={{ animation: 'app-splash-spin 0.85s linear infinite' }}>
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-0 h-[8px] w-[2.4px] origin-[50%_13px] rounded-full bg-foreground"
              style={{
                transform: `translateX(-50%) rotate(${i * 30}deg)`,
                opacity: Math.max(0.12, 1 - i / 11),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
