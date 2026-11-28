'use client';

// 设置 App 瘦入口（W4-E2 模块化拆分）：本文件只保留 SettingsApp 根调度器（Page 路由状态机）
// 与 ./settings/* 各域模块的桶导出。原 10398 行单文件的 20+ 个页面组件已按域原样迁至
// src/components/apps/settings/ 目录（纯结构搬运，组件本体逻辑/JSX/文案/样式零改动）。
// 对外契约不变：registry 等外部仍按 `import('./settings')` 取 default SettingsApp；
// 各子模块具名导出统一从本入口再导出，供外部按需引用。

import { useEffect, useState, type CSSProperties } from 'react';
import { IOSScreen } from '@/components/ios/IOSNavBar';
import { useUI } from '@/lib/ios/store';

import { type Page } from './settings/shared';
import { RootPage } from './settings/root-page';
import { AgentVoicePage } from './settings/agent-voice';
import { PermissionHubPage } from './settings/permission';
import { AppUpdatePage } from './settings/updates';
import { ThemePage } from './settings/theme';
import { NotificationPage } from './settings/notifications';
import { WallpaperPage } from './settings/wallpaper';
import { ApiPage } from './settings/api';
import { VisionPage } from './settings/vision';
import { ImageGenPage } from './settings/imagegen';
import { LockPage } from './settings/lock';
import { PwaInstallPage } from './settings/pwa';
import { AboutPage, AccountSwitchPage, ProfilePage } from './settings/profile';
import { VoicePage } from './settings/voice';
import { FontPage } from './settings/fonts';
import { PromptEntriesPage } from './settings/prompts';
import { ClawBoxPage } from './settings/cloud';

// 桶导出：各域子模块的具名导出（组件/类型/常量）统一从本入口对外再导出
export * from './settings/shared';
export * from './settings/root-page';
export * from './settings/agent-voice';
export * from './settings/permission';
export * from './settings/updates';
export * from './settings/theme';
export * from './settings/notifications';
export * from './settings/wallpaper';
export * from './settings/api';
export * from './settings/vision';
export * from './settings/imagegen';
export * from './settings/lock';
export * from './settings/pwa';
export * from './settings/profile';
export * from './settings/voice';
export * from './settings/fonts';
export * from './settings/prompts';
export * from './settings/cloud';

// ---------------- 根组件 ----------------

/**
 * SETTINGS-THEME：设置 App 全域强制浅色 token。
 * 机主要求设置子界面恒呈现「绿/白/灰/蓝」清爽浅色风，不随系统深色主题变黑。
 * Tailwind 语义色（bg-background / text-foreground / text-muted-foreground / bg-muted /
 * bg-popover 等）的取值来自 :root 与 .dark 两套 CSS 变量的级联——这里在最外层用
 * inline CSS 变量把整套值钉死为浅色（页面底 #F3F6F3、卡片白、次文字 zinc-500、
 * 主色蓝 #007AFF、破坏性红 #FF3B30），深色主题下设置 App（含不可修改的 IOSNavBar
 * 与 ui/ 内 Input、Textarea、alert-dialog、Slider 等共享件）也整体呈现浅色。
 * 包装层用 display:contents，不产生布局盒子，IOSScreen 仍作为唯一 flex 子级填满 App 窗口。
 */
const SETTINGS_LIGHT_TOKENS = {
  '--background': '#F3F6F3',
  '--foreground': '#18181B',
  '--card': '#FFFFFF',
  '--card-foreground': '#18181B',
  '--popover': '#FFFFFF',
  '--popover-foreground': '#18181B',
  '--primary': '#007AFF',
  '--primary-foreground': '#FFFFFF',
  '--secondary': '#F4F4F5',
  '--secondary-foreground': '#18181B',
  '--muted': '#F4F4F5',
  '--muted-foreground': '#71717A',
  '--accent': '#F4F4F5',
  '--accent-foreground': '#18181B',
  '--destructive': '#FF3B30',
  '--border': '#E4E4E7',
  '--input': '#E4E4E7',
  '--ring': '#007AFF',
} as CSSProperties;

export default function SettingsApp() {
  // 跨 App 跳转（X 论坛「生图模型」入口等）：别的 App switchToApp('settings') 前写入
  // pendingSettingsPage，这里挂载时读取直接进对应设置页（如 imggen 图像生成）。
  // 消费清空放到挂载后的 effect 里——渲染期间写 store 会触发「渲染中更新其它组件」告警。
  const [page, setPage] = useState<Page>(() => {
    const pending = useUI.getState().pendingSettingsPage;
    if (pending && ['root', 'account', 'profile', 'theme', 'notification', 'wallpaper', 'font', 'api', 'vision', 'imggen', 'voice', 'about', 'lock', 'prompts', 'autonomy', 'voiceagent', 'appupdate', 'cloud'].includes(pending)) {
      return pending as Page;
    }
    return 'root';
  });
  useEffect(() => {
    if (useUI.getState().pendingSettingsPage) useUI.getState().setPendingSettingsPage(null);
  }, []);

  return (
    <div className="contents" style={SETTINGS_LIGHT_TOKENS}>
      <IOSScreen className="relative">
        {page === 'root' && <RootPage onOpen={setPage} />}
        {page === 'account' && <AccountSwitchPage onBack={() => setPage('root')} />}
        {page === 'profile' && <ProfilePage onBack={() => setPage('root')} />}
        {page === 'theme' && <ThemePage onBack={() => setPage('root')} />}
        {page === 'notification' && <NotificationPage onBack={() => setPage('root')} />}
        {page === 'wallpaper' && <WallpaperPage onBack={() => setPage('root')} />}
        {page === 'api' && <ApiPage onBack={() => setPage('root')} />}
        {page === 'cloud' && <ClawBoxPage onBack={() => setPage('root')} />}
        {page === 'vision' && <VisionPage onBack={() => setPage('root')} />}
        {page === 'imggen' && <ImageGenPage onBack={() => setPage('root')} />}
        {page === 'voice' && <VoicePage onBack={() => setPage('root')} />}
        {page === 'font' && <FontPage onBack={() => setPage('root')} />}
        {page === 'lock' && <LockPage onBack={() => setPage('root')} />}
        {page === 'prompts' && <PromptEntriesPage onBack={() => setPage('root')} />}
        {page === 'about' && <AboutPage onBack={() => setPage('root')} />}
        {page === 'autonomy' && <PermissionHubPage onBack={() => setPage('root')} />}
        {page === 'voiceagent' && <AgentVoicePage onBack={() => setPage('root')} />}
        {page === 'appupdate' && <AppUpdatePage onBack={() => setPage('root')} />}
        {page === 'pwa' && <PwaInstallPage onBack={() => setPage('root')} />}
      </IOSScreen>
    </div>
  );
}
