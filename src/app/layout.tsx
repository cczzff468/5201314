import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Phone — 仿 iOS 智能助手",
  description:
    "高还原度 iOS 风格 AI 聊天手机：灵动岛状态栏、真实电量、相册、相机、计算器、时钟、音乐、天气、备忘录、日历、录音机、浏览器、设置。本地优先，数据存于 IndexedDB。",
  keywords: ["iOS", "AI聊天", "仿苹果", "PWA", "IndexedDB", "Next.js"],
  // PWA 可安装：manifest + 本地图标（去掉外网 CDN logo 依赖）
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/pwa/apple-touch-icon.png",
  },
  // iOS 添加到主屏幕：全屏独立窗口 + 沉浸式状态栏 + 桌面图标名
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Phone",
  },
};

/** 手机模拟器禁用页面捏合缩放（双指缩放交给 3D 场景/系统手势，不缩放页面） */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // v1.9.12 键盘弹起时收缩布局视口（而非覆盖）：聊天输入条/底部消息不被软键盘遮挡
  //（配合 useChatAutoScroll 的 visualViewport 贴底跟随，键盘弹出后最新消息仍在可视范围）
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geistSans.variable} antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
        {/* v80 预览提速：启动即注册 Service Worker（资源 SWR 缓存 + v1.9.22 离线壳）。
            原先只有开启通知权限才会注册（push-client），大多数会话享受不到静态资源缓存。
            register 幂等（同 URL 同 scope），与 push-client 的注册不冲突；iframe/不支持环境静默失败。
            v1.9.22：同一脚本尽早捕获 beforeinstallprompt（Chrome 在页面加载早期就可能派发，
            React 挂载后再监听会错过）——preventDefault 收下事件存 window.__pwaInstallEvt，
            设置 › 添加到主屏幕 页的「立即安装」按钮消费它；appinstalled 后清空并广播。
            v2.2：dev 模式不注册 SW——Turbopack dev 重启后 chunk 内容变但 SW 的 SWR 缓存返回旧
            chunk，导致 next/dynamic 组件「module factory is not available」运行时错误。
            SW 缓存只对生产环境（稳定 chunk）有意义；dev 模式 chunks 是 no-cache，SW 反而干扰。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if('serviceWorker' in navigator){if(${process.env.NODE_ENV === 'production'}){navigator.serviceWorker.register('/sw.js').catch(function(){});}else{navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});if(window.caches){window.caches.keys().then(function(ks){ks.forEach(function(k){window.caches.delete(k);});}).catch(function(){});}}}}catch(e){}
try{window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaInstallEvt=e;window.dispatchEvent(new CustomEvent('pwa-installable'));});
window.addEventListener('appinstalled',function(){window.__pwaInstallEvt=null;window.dispatchEvent(new CustomEvent('pwa-installed'));});}catch(e){}`,
          }}
        />
      </body>
    </html>
  );
}
