import type { CapacitorConfig } from '@capacitor/cli';

/**
 * AI Phone 原生壳（Capacitor 8）：
 * - 首启加载内置 www/index.html 配置页：输入/选择服务器地址（沙箱预览地址），
 *   存 localStorage 后跳转，WebView 内常驻（allowNavigation 允许任意域导航）；
 * - 原生感知插件（NativePerception）向网页注入 window.Capacitor 桥：
 *   UsageStats 真机感知 + 屏幕抓帧，网页端感知链路优先读原生桥；
 * - allowMixedContent：预览地址可能是 http；
 * - v1.9.46 全屏沉浸：SystemBars 插件 insetsHandling=disable（停掉 Capacitor 默认
 *   给 decor 打的 safe-area padding——就是「WebView 被压到状态栏下 + 顶部条带露
 *   windowBackground 灰/黑底 + 与内容硬分界」的根因）；窗口由 MainActivity 强制
 *   edge-to-edge + 挖孔 ALWAYS，安全区改经 window.AIPhoneNative 原生桥预注入
 *   （首帧即就位、旋转实时推送，见 MainActivity.java 与网页 layout.tsx 内联脚本）。
 */
const config: CapacitorConfig = {
  appId: 'com.z.aiphone',
  appName: 'Cove',
  webDir: 'www',
  server: {
    // 允许 WebView 内导航到任意服务器（配置页 → 用户填的预览地址）
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000',
  },
  plugins: {
    SystemBars: {
      // 'disable'：Capacitor 8 内置 SystemBars 不再给 decor 打 padding / 不注入
      // 它的 --safe-area-inset 变量（旧 APK 上的「条带+分界线」观感来源）。
      // 安全区完全由本项目原生桥（AIPhoneNative）+ 网页 CSS 变量接管。
      insetsHandling: 'disable',
    },
  },
};

export default config;
