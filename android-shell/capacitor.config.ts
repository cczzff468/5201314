import type { CapacitorConfig } from '@capacitor/cli';

/**
 * AI Phone 原生壳（Capacitor 8）：
 * - 首启加载内置 www/index.html 配置页：输入/选择服务器地址（沙箱预览地址），
 *   存 localStorage 后跳转，WebView 内常驻（allowNavigation 允许任意域导航）；
 * - 原生感知插件（NativePerception）向网页注入 window.Capacitor 桥：
 *   UsageStats 真机感知 + 屏幕抓帧，网页端感知链路优先读原生桥；
 * - allowMixedContent：预览地址可能是 http。
 */
const config: CapacitorConfig = {
  appId: 'com.z.aiphone',
  appName: 'AI Phone',
  webDir: 'www',
  server: {
    // 允许 WebView 内导航到任意服务器（配置页 → 用户填的预览地址）
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#000000',
  },
};

export default config;
