import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import SwRegister from "@/components/ios/SwRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <SwRegister />
        <Toaster />
      </body>
    </html>
  );
}
