'use client';

// 设置 App 主列表页（RootPage）：各子页入口行 + 全局开关（状态栏 / 灵动岛 / 后台保活 / 悬浮工具）。

import {
  useEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { Check } from 'lucide-react';

import {
  Activity,
  AudioLines,
  BatteryCharging,
  Bell,
  Bluetooth,
  Box,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Layers,
  Lock,
  Mic,
  PanelTop,
  Plane,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Type,
  User,
  UsersRound,
  Wifi,
  Wrench,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { useUI } from '@/lib/ios/store';

import { localDB } from '@/lib/ios/db';

import {
  WALLPAPER_PRESETS,
  useSettings,
  type BatteryPercentMode,
  type ThemeMode,
  type CoveSplashTheme,
} from '@/lib/ios/store';

// v2.4.10 电量百分比预览：状态栏同款电池组件（三种显示方式实时小预览）
import { BatteryIcon } from '@/components/ios/StatusBar';

// 第三十四轮「立马生效」：选完开屏主题即整屏播放一遍预览（BootSplash 自带退场/自卸载）
import BootSplash from '@/components/ios/BootSplash';

import { imgGenConfigReady } from '@/lib/imggen';

import { ownerRealName } from '@/lib/ios/contacts-store';

// v1.3 AI 动手（真机自主权）+ APP 更新：设置页新入口；v1.9.36 重命名为「权限给予」；
// v1.9.38 AI 动手能力恒开（开关全部下线）：这里只保留动手范围的读写
import { getAiActionTarget } from '@/lib/ios/device-autonomy';

// C1 语音唤起智能体（v1.9.3 独立设置页：唤醒名 / 悬浮球 / 连续监听）
import {
  DEFAULT_WAKE_NAME,
  useAgentVoice,
} from '@/lib/ios/agent-voice';

// v2.4.11 原生壳自诊断（还看得到系统状态栏 = 手机上是旧 APK，一眼分辨）
import { readShellInfo } from '@/lib/ios/shell-info';
import { isNativePerception } from '@/lib/ios/native-perception';

// v1.4.2 APP 更新：自动检查 + 红点 + 版本历史
import { useAppUpdate } from '@/lib/ios/app-update';

import { BUILTIN_APP_FONTS } from '@/lib/ios/fonts';

import {
  type Page,
  TONE_ORANGE,
  TONE_BLUE,
  TONE_GREEN,
  TONE_RED,
  TONE_GRAY,
  TONE_CYAN,
  TONE_PURPLE,
  TONE_PINK,
  RowIcon,
  MainRow,
  useOwnerAvatar,
} from './shared';


/** 主列表"显示与亮度"右侧的主题短名 */
export const THEME_SHORT: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  auto: '自动',
};
// ---------------- 主列表 ----------------

export function RootPage({ onOpen }: { onOpen: (page: Page) => void }) {
  const theme = useSettings((s) => s.theme);
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const apiKey = useSettings((s) => s.apiConfig.apiKey);
  const apiModel = useSettings((s) => s.apiConfig.model);
  const visionConfigured = useSettings((s) => Boolean(s.visionConfig.baseUrl.trim()));
  const visionModel = useSettings((s) => s.visionConfig.model);
  const ttsProvider = useSettings((s) => s.ttsConfig.provider);
  const ttsConfigured = useSettings((s) =>
    s.ttsConfig.provider === 'builtin' ? true : Boolean(s.ttsConfig.apiKey.trim() && s.ttsConfig.baseUrl.trim())
  );
  const ttsModel = useSettings((s) => s.ttsConfig.model);
  const imgGenConfig = useSettings((s) => s.imgGenConfig);
  const imgGenReady = imgGenConfigReady(imgGenConfig);
  const profile = useSettings((s) => s.profile);
  const ownerAvatar = useOwnerAvatar();
  const appFontId = useSettings((s) => s.appFontId);
  // 状态栏显示开关（Task 36）：控制顶部时间/信号/电量状态栏是否显示
  const statusBarVisible = useSettings((s) => s.statusBarVisible);
  const setStatusBarVisible = useSettings((s) => s.setStatusBarVisible);
  // v2.4.10 电量百分比显示方式（三选一：不显示 / 图标外部 / 图标内部 iOS 16+ 风格）
  const batteryPercent = useSettings((s) => s.batteryPercent);
  const setBatteryPercent = useSettings((s) => s.setBatteryPercent);
  // 第三十轮：电量百分比显示方式弹窗开关（点行打开，选完/点背板关闭）
  const [batteryModeOpen, setBatteryModeOpen] = useState(false);
  // 第三十一轮：App 图标三选一（App 改名 Cove；开屏/设置预览即时跟随 + 同步服务器 manifest）
  const appIcon = useSettings((s) => s.appIcon);
  const splashTheme = useSettings((s) => s.splashTheme);
  const setSplashTheme = useSettings((s) => s.setSplashTheme);
  const [splashThemeOpen, setSplashThemeOpen] = useState(false);
  // 第三十四轮「立马生效」：选中开屏主题后立即整屏播放一遍（BootSplash 自退场自卸载）
  const [splashPreview, setSplashPreview] = useState<CoveSplashTheme | null>(null);
  const setAppIcon = useSettings((s) => s.setAppIcon);
  const [appIconOpen, setAppIconOpen] = useState(false);
  // 灵动岛常驻开关（用户需求）：关闭后隐藏顶部黑色胶囊基础灵动岛，只显示 APP 灵动岛
  const islandPersistent = useSettings((s) => s.islandPersistent);
  const setIslandPersistent = useSettings((s) => s.setIslandPersistent);
  // 后台保活开关（v80）：开启后切后台/锁屏时尽量保持网页运行——主动消息与轮询不中断
  const bgKeepAlive = useSettings((s) => s.bgKeepAlive);
  const setBgKeepAlive = useSettings((s) => s.setBgKeepAlive);
  // 全局悬浮工具（v72）：提示词查看器 / 快捷操作——开启后手机右下角出现可拖拽悬浮球
  const assistViewer = useSettings((s) => s.assistViewer);
  const setAssistViewer = useSettings((s) => s.setAssistViewer);
  const assistQuickOps = useSettings((s) => s.assistQuickOps);
  const setAssistQuickOps = useSettings((s) => s.setAssistQuickOps);
  // v1.4.2 APP 更新：版本清单 + 有新版红点（开机 6s 自动检查未到/失败时，打开设置补拉一次）
  const updInfo = useAppUpdate((s) => s.info);
  const updHas = useAppUpdate((s) => s.hasUpdate);
  // v2.4.11 壳自检（同步桥只读一次）：APK 里读不到壳版本 → 旧壳，系统状态栏没隐藏等修复都不在
  const shellInfo = readShellInfo();
  const shellOld = isNativePerception() && !shellInfo;
  const updCheck = useAppUpdate((s) => s.check);
  useEffect(() => {
    if (useAppUpdate.getState().info === null) void updCheck(true);
  }, [updCheck]);

  const [airplane, setAirplane] = useState(false);

  // v1.9.38 AI 动手恒开（无开关）：主列表入口右侧改显动手范围（localStorage 现场读取；
  // 从子页切换后返回时 RootPage 重挂载，状态自动刷新）
  const autonomyTarget = getAiActionTarget() === 'device' ? '真机' : '网站里面';
  // v1.9.3 语音唤起智能体（独立设置页入口）：右侧状态（悬浮球/监听任一开=已开启，显示唤醒名）
  const agentVoiceCfg = useAgentVoice((s) => s.cfg);
  const agentVoiceOn = agentVoiceCfg.ball || agentVoiceCfg.listen;

  // 挂载读取持久化的飞行模式开关（演示项）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rec = await localDB.get('settings', 'radios');
        if (!cancelled && rec && typeof rec.value === 'object' && rec.value !== null) {
          const v = rec.value as { airplane?: unknown };
          setAirplane(v.airplane === true);
        }
      } catch {
        // IndexedDB 不可用时保持默认关闭
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAirplane = (v: boolean) => {
    setAirplane(v);
    void localDB.put('settings', { key: 'radios', value: { airplane: v } });
  };

  // 「切换账号」行右侧值：恒机主名（多账号 v2 无全局当前账号——微信/QQ/信息/电话
  // 分别在各自 App 内切换，这里固定显示机主身份）。
  const [accountName, setAccountName] = useState('机主');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const name = await ownerRealName();
        if (!cancelled && name.trim()) setAccountName(name.trim());
      } catch {
        // 资料不可用时保持回退「机主」
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const wallpaperName = customWallpaperUrl
    ? '自定义'
    : (WALLPAPER_PRESETS.find((p) => p.id === wallpaperPreset)?.name ?? '自定义');

  /** 「字体」行右侧摘要：内置字体名 / 自定义 / 默认（appFontId='' 表示跟随系统默认） */
  const fontRowValue =
    BUILTIN_APP_FONTS.find((f) => f.id === appFontId)?.name ?? (appFontId.startsWith('custom:') ? '自定义' : '默认');

  return (
    <>
      {/* 顶部：返回主屏幕箭头 + 大标题「设置」（用户要求补上标签；返回键处不显示文字） */}
      <div className="sticky top-0 z-20 shrink-0 bg-background/80 pt-[54px] backdrop-blur-xl">
        <div className="flex h-11 items-center gap-1.5 px-4">
          <button
            type="button"
            onClick={useUI.getState().closeApp}
            aria-label="返回主屏幕"
            className="flex h-11 w-11 items-center justify-center rounded-full text-foreground transition-colors active:bg-muted/60"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <span className="truncate text-[19px] font-bold leading-none tracking-tight">设置</span>
        </div>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-5">
        {/* 个人资料卡（点击进入个人信息：头像/名字/标签）+ 切换账号入口行（同一分组） */}
        <div className="mx-4 mt-2 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <button
            type="button"
            onClick={() => onOpen('profile')}
            className="flex w-full items-center gap-4 p-4 text-left transition-colors active:bg-muted/50"
          >
            {(profile.avatar || ownerAvatar) ? (
              <img
                src={profile.avatar || ownerAvatar || ''}
                alt="头像"
                className="h-[56px] w-[56px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8]">
                <User className="h-7 w-7 text-[#7C7C84]" strokeWidth={1.8} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[22px] font-semibold leading-tight">
                {profile.name.trim() || 'iPhone 用户'}
              </span>
              <span className="mt-1 block truncate text-[13px] text-muted-foreground">
                {profile.tag.trim() || 'Apple 账户、iCloud'}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
          {/* 账号管理入口（Task 40-C / v2 适配）：右侧值 = 恒机主名（无全局当前账号） */}
          <MainRow
            icon={UsersRound}
            tone={TONE_CYAN}
            label="账号管理"
            value={accountName}
            onClick={() => onOpen('account')}
            testId="settings-account-entry"
          />
        </div>

        {/* 无线控制（演示项） */}
        <div className="mx-4 mt-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={Plane} tone={TONE_ORANGE} />
            <span className="min-w-0 flex-1 truncate text-[16px]">飞行模式</span>
            {/* 用户要求：绿色大开关（iOS 原生 51×31 规格，开启态 #34C759 绿） */}
            <button
              type="button"
              role="switch"
              aria-checked={airplane}
              aria-label="飞行模式"
              data-testid="settings-airplane-switch"
              onClick={() => toggleAirplane(!airplane)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                airplane ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  airplane ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <MainRow icon={Wifi} tone={TONE_BLUE} label="无线局域网" value="我爱你" chevron />
          <MainRow icon={Bluetooth} tone={TONE_BLUE} label="蓝牙" value="love" chevron />
        </div>

        {/* 锁屏与密码（按用户要求不显示开启状态提示） */}
        <div className="mx-4 mt-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow icon={Lock} tone={TONE_RED} label="锁屏与密码" onClick={() => onOpen('lock')} />
        </div>

        {/* 显示与亮度 / 壁纸 / 通知 */}
        <div className="mx-4 mt-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow
            icon={Sun}
            tone={TONE_BLUE}
            label="显示与亮度"
            value={THEME_SHORT[theme]}
            onClick={() => onOpen('theme')}
          />
          <MainRow
            icon={ImageIcon}
            tone={TONE_CYAN}
            label="壁纸"
            value={wallpaperName}
            onClick={() => onOpen('wallpaper')}
          />
          <MainRow icon={Bell} tone={TONE_RED} label="通知" onClick={() => onOpen('notification')} />
          <MainRow
            icon={Type}
            tone={TONE_CYAN}
            label="字体"
            value={fontRowValue}
            onClick={() => onOpen('font')}
          />
          {/* 状态栏开关（Task 36；Task 37 换绿色大开关；v58 行为更新）：关闭后隐藏顶部时间/信号/电量状态栏
              与黑色胶囊基础灵动岛；APP 灵动岛（音乐岛、美团/淘宝配送岛、灵动岛通知卡、来电胶囊）照常显示。
              与飞行模式同款 iOS 原生 51×31 大开关，开启态 #34C759 绿 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={PanelTop} tone={TONE_GRAY} />
            <span className="min-w-0 flex-1 truncate text-[16px]">状态栏</span>
            <button
              type="button"
              role="switch"
              aria-checked={statusBarVisible}
              aria-label="状态栏"
              data-testid="settings-statusbar-switch"
              onClick={() => setStatusBarVisible(!statusBarVisible)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                statusBarVisible ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  statusBarVisible ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {/* 灵动岛常驻开关（用户需求）：关闭后顶部黑色胶囊灵动岛不显示，
              但 APP 灵动岛（音乐岛大/小窗、外卖/快递配送岛、灵动岛通知卡、来电胶囊）照常显示。
              与飞行模式同款 iOS 原生 51×31 大开关，开启态 #34C759 绿 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={Smartphone} tone={TONE_GRAY} />
            <span className="min-w-0 flex-1 truncate text-[16px]">灵动岛常驻</span>
            <button
              type="button"
              role="switch"
              aria-checked={islandPersistent}
              aria-label="灵动岛常驻"
              data-testid="settings-island-persistent-switch"
              onClick={() => setIslandPersistent(!islandPersistent)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                islandPersistent ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  islandPersistent ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {/* v80 后台保活开关：Worker 心跳 + 无声音频双通道——切到后台/锁屏时尽量保持
              网页运行（防定时器节流/防冻结），AI 主动消息与后台接力轮询不中断；代价是略更耗电。
              与飞行模式同款 iOS 原生 51×31 大开关，默认关（省电），开启态 #34C759 绿 */}
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={Activity} tone={TONE_GRAY} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">后台保活</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">切后台保持网页运行，主动消息与轮询不中断</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={bgKeepAlive}
              aria-label="后台保活"
              data-testid="settings-keepalive-switch"
              onClick={() => setBgKeepAlive(!bgKeepAlive)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                bgKeepAlive ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  bgKeepAlive ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 第三十轮：电量百分比显示方式改为【点行弹窗选择】（机主需求：设置里的百分比显示选择要弹窗）。
            第三十三轮：入口行左侧图标改为与其他行一致的 RowIcon（机主要求「前面的图标变成跟其他的图标一样」，
            弃用第三十二轮的状态栏仿真预览条）；当前模式名 + ›，点开 iOS 居中弹窗：三选项各带状态栏同款
            实时小预览（固定 67%），点选即时生效并持久化；点背板/Esc 关闭。
            第三十五轮：入口行下方说明文字按机主要求删除（保持卡片列表干净）。 */}
        <div className="mx-4 mt-4 overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={batteryModeOpen}
            data-testid="settings-battery-mode-row"
            onClick={() => setBatteryModeOpen(true)}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={BatteryCharging} tone={TONE_GREEN} />
            <span className="min-w-0 flex-1 truncate text-[16px]">电量百分比</span>
            <span className="shrink-0 text-[13px] text-muted-foreground">{batteryModeLabel(batteryPercent)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2.2} />
          </button>
        </div>
        {batteryModeOpen && (
          <BatteryModeDialog
            current={batteryPercent}
            onPick={setBatteryPercent}
            onClose={() => setBatteryModeOpen(false)}
          />
        )}

        {/* 悬浮工具（v72）：两个开关控制手机右下角的可拖拽悬浮球——
            提示词查看器（下一轮完整 Prompt 只读预览）与快捷操作（API/世界书一键切换）。
            两个开关全关时不显示悬浮球；与状态栏/灵动岛同款 iOS 原生 51×31 大开关。
            v1.9.13：默认预设入口移到「提示词查看器」上方（机主要求的排序） */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">悬浮工具</div>
        <div className="mx-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow
            icon={Layers}
            tone={TONE_PURPLE}
            label="默认预设（内置）"
            value="按 App 整理 · 501 条 · 模块 12 组"
            onClick={() => onOpen('prompts')}
            testId="settings-prompts-row"
          />
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={Eye} tone={TONE_CYAN} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">提示词查看器</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">悬浮球菜单里预览下一轮完整 Prompt</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={assistViewer}
              aria-label="提示词查看器"
              data-testid="settings-assist-viewer-switch"
              onClick={() => setAssistViewer(!assistViewer)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                assistViewer ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  assistViewer ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RowIcon icon={SlidersHorizontal} tone={TONE_GREEN} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">快捷操作</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">悬浮球菜单里快速切换 API 与世界书</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={assistQuickOps}
              aria-label="快捷操作"
              data-testid="settings-assist-quickops-switch"
              onClick={() => setAssistQuickOps(!assistQuickOps)}
              className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                assistQuickOps ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/25'
              }`}
            >
              <span
                className={`pointer-events-none absolute left-[2px] top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
                  assistQuickOps ? 'translate-x-[20px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* AI 感知与操控：v1.9.36「AI 动手」入口改为「权限给予」——系统权限（v2.3.0 权限中心 16 项，
            原生系统 API + 无障碍服务，无 Shizuku）/时长数据源/AI 动手范围（真机 vs 网站）一页全管；
            v1.9.38 AI 动手能力恒开（能力开关组下线）；
            v1.9.3 语音唤起智能体拆出为独立设置页（同分组独立入口） */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">AI 感知与操控</div>
        <div className="mx-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <button
            type="button"
            data-testid="settings-autonomy-entry"
            onClick={() => onOpen('autonomy')}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={ShieldCheck} tone={TONE_GREEN} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">权限给予</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">无障碍/使用情况/悬浮窗/短信/位置…系统权限 · AI 动手范围</span>
            </span>
            <span className="max-w-[50%] shrink-0 truncate text-[15px] text-muted-foreground">
              AI 已开启 · {autonomyTarget}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
          <button
            type="button"
            data-testid="settings-agentvoice-entry"
            onClick={() => onOpen('voiceagent')}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={Mic} tone={TONE_CYAN} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">语音助手</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">喊唤醒名/点悬浮球唤起 · 能聊也能办</span>
            </span>
            <span className="max-w-[50%] shrink-0 truncate text-[15px] text-muted-foreground">
              {agentVoiceOn ? `「${agentVoiceCfg.name || DEFAULT_WAKE_NAME}」已开启` : '已关闭'}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
        </div>

        {/* 开发者 */}
        <div className="mb-2 mt-6 px-8 text-[13px] text-muted-foreground">开发者</div>
        <div className="mx-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow
            icon={Wrench}
            tone={TONE_GRAY}
            label="API 配置"
            value={apiKey.trim() ? `已配置 · ${apiModel}` : '未配置'}
            onClick={() => onOpen('api')}
          />
          <MainRow
            icon={Eye}
            tone={TONE_PURPLE}
            label="识图模型"
            value={visionConfigured ? `已配置 · ${visionModel.trim() || '未填模型名'}` : '未配置'}
            onClick={() => onOpen('vision')}
          />
          <button
            type="button"
            data-testid="settings-imggen-row"
            onClick={() => onOpen('imggen')}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={ImagePlus} tone={TONE_PINK} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">图像生成</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                自动生图 · 锁脸 · OpenAI 兼容
              </span>
            </span>
            <span className="max-w-[50%] shrink-0 truncate text-[15px] text-muted-foreground">
              {imgGenConfig.enabled && imgGenReady
                ? `已开启 · ${imgGenConfig.model.trim() || '未填模型名'}`
                : imgGenReady
                  ? '已配置'
                  : '未配置'}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
          <MainRow
            icon={AudioLines}
            tone={TONE_CYAN}
            label="语音 API"
            value={
              ttsProvider === 'builtin'
                ? '内置语音 · 免费'
                : ttsConfigured
                  ? `已配置 · ${ttsModel.trim() || '未填模型名'}`
                  : '未配置'
            }
            onClick={() => onOpen('voice')}
          />
          {/* ClawBox（v24）：放在语音 API 下面（机主定调）——云端助手 + 真机接入两个页签 */}
          <button
            type="button"
            data-testid="settings-cloud-entry"
            onClick={() => onOpen('cloud')}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={Box} tone={TONE_ORANGE} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">ClawBox</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                云端助手 · 真机接入 · 7×24 自动回复
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
          </button>
          <MainRow icon={Database} tone={TONE_GREEN} label="存储" onClick={() => onOpen('storage')} />
        </div>

        {/* 关于本机 + APP 图标 + APP 更新（v1.3：APK 下载入口从感知设置提升到系统设置）；v1.9.22 新增添加到主屏幕 */}
        <div className="mx-4 mt-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow icon={Info} tone={TONE_GRAY} label="关于本机" onClick={() => onOpen('about')} />
          {/* 第三十一轮：App 图标三选一（改名 Cove 后机主要求可选图标）——行内预览当前图标 */}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={appIconOpen}
            data-testid="settings-app-icon-row"
            onClick={() => setAppIconOpen(true)}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
          >
            <span className="grid h-[31px] w-[31px] shrink-0 place-items-center">
              {/* 当前 App 图标小预览（ squircle 圆角 + 细描边） */}
              <img
                src={`/icons/app/icon-${appIcon}-192.png`}
                alt="当前 App 图标"
                className="h-[29px] w-[29px] rounded-[6.8px] object-cover ring-[0.5px] ring-black/10"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">App 图标</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">Cove 三选一 · 开屏与桌面图标即时跟随</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2.2} />
          </button>
          <MainRow
            icon={Download}
            tone={TONE_CYAN}
            label="APP 更新"
            value={shellOld ? '旧壳·需重装' : shellInfo ? `壳 v${shellInfo.versionName}` : updHas ? '有新版' : updInfo ? `v${updInfo.version}` : undefined}
            badge={updHas || shellOld}
            onClick={() => onOpen('appupdate')}
            testId="settings-appupdate-entry"
          />
          <MainRow
            icon={Smartphone}
            tone={TONE_PINK}
            label="添加到主屏幕"
            onClick={() => onOpen('pwa')}
            testId="settings-pwa-entry"
          />
        </div>
        {appIconOpen && (
          <AppIconDialog
            current={appIcon}
            onPick={setAppIcon}
            onClose={() => setAppIconOpen(false)}
          />
        )}

        {/* 第三十三轮：开屏动画三主题（机主要求「灰白雾底变成星空月球什么的，做三个可以选」）——
            行入口预览当前主题微缩场景 + 名称，点开四选一弹窗（星空月夜/雾中远山/雨落成诗/对话），
            点选【立马生效】：选完即整屏播放一遍预览 + 本会话下次冷启动/下次打开即播放所选主题 */}
        <div className="mx-4 mt-4 overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={splashThemeOpen}
            data-testid="settings-splash-theme-row"
            onClick={() => setSplashThemeOpen(true)}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
          >
            <RowIcon icon={Sparkles} tone={TONE_PURPLE} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px]">开屏动画</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                四款主题 · 选择后立即播放预览
              </span>
            </span>
            <span className="shrink-0 text-[13px] text-muted-foreground">{splashThemeName(splashTheme)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2.2} />
          </button>
        </div>
        {splashThemeOpen && (
          <SplashThemeDialog
            current={splashTheme}
            onPick={(t) => {
              setSplashTheme(t);
              // 立马生效：选完即整屏预览一遍（同时 localStorage 已写，下次冷启动也是它）
              setSplashPreview(t);
            }}
            onClose={() => setSplashThemeOpen(false)}
          />
        )}
        {splashPreview && <BootSplash forceTheme={splashPreview} />}

        <p className="py-6 text-center text-[12px] text-muted-foreground">
          iOS Web · 本地优先架构 · 数据仅存于你的浏览器
        </p>
      </div>
    </>
  );
}
/** 电量百分比模式中文名（入口行右侧 value 展示） */
function batteryModeLabel(mode: BatteryPercentMode): string {
  return mode === 'inside' ? '电池图标内部' : mode === 'outside' ? '电池图标外部' : '不显示';
}

/** 三张备选图标（第三十四轮：机主要求再美化重新生成——韩系满幅插画风；
 *  拱门静湾=暖调拱门框日出、雾中远山=三层灰阶山影+淡日盘、静月港湾=夜空新月映水带 Cove 字） */
const APP_ICON_OPTIONS: { id: '1' | '2' | '3'; name: string; desc: string }[] = [
  { id: '1', name: '拱门静湾', desc: '拱门框日 · 暖调静水' },
  { id: '2', name: '雾中远山', desc: '层叠山影 · 淡日灰阶' },
  { id: '3', name: '静月港湾', desc: '新月映水 · 带 Cove 字' },
];

/** 第三十一轮：App 图标三选一弹窗（iOS 居中卡）：
 *  三张大图预览（64px squircle，选中态蓝描边+角标），点选即时生效：
 *  开屏动画/设置预览即时跟随；同时异步同步服务器（PWA manifest 动态图标，
 *  「添加到主屏幕/安装」时浏览器拉取所选图标）。点背板/Esc/好 关闭。 */
function AppIconDialog({
  current,
  onPick,
  onClose,
}: {
  current: '1' | '2' | '3';
  onPick: (id: '1' | '2' | '3') => void;
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭 App 图标弹窗"
        data-testid="app-icon-backdrop"
        className="fixed inset-0 z-[300] cursor-default bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="App 图标"
        data-testid="app-icon-dialog"
        className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-8"
      >
        <div
          className={`pointer-events-auto w-full max-w-[320px] overflow-hidden rounded-[24px] bg-white/90 shadow-[0_18px_48px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.06] backdrop-blur-2xl transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1.2)] dark:bg-zinc-900/[0.92] dark:ring-white/[0.09] ${
            entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.92] opacity-0'
          }`}
        >
          {/* 标题区 */}
          <div className="border-b border-black/[0.06] px-5 pb-3 pt-4 text-center dark:border-white/[0.08]">
            <p className="text-[16px] font-semibold text-black dark:text-white">App 图标</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Cove · 选一个喜欢的样子</p>
          </div>
          {/* 三张图标大预览（横排三列） */}
          <div className="grid grid-cols-3 gap-2 px-4 py-4">
            {APP_ICON_OPTIONS.map((o) => {
              const sel = current === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sel}
                  aria-label={`${o.name}（${o.desc}）`}
                  data-testid={`app-icon-option-${o.id}`}
                  onClick={() => {
                    onPick(o.id);
                    onClose();
                  }}
                  className={`flex flex-col items-center gap-2 rounded-[16px] px-1 py-3 transition-all active:scale-[0.97] ${
                    sel ? 'bg-[#007AFF]/[0.08] ring-[1.5px] ring-[#007AFF]/60' : 'ring-[1.5px] ring-transparent'
                  }`}
                >
                  <span className="relative">
                    <img
                      src={`/icons/app/icon-${o.id}-192.png`}
                      alt={o.name}
                      className={`h-[64px] w-[64px] rounded-[15px] object-cover shadow-[0_6px_16px_rgba(0,0,0,0.14)] ${sel ? '' : 'opacity-95'}`}
                    />
                    {sel && (
                      <span className="absolute -right-[6px] -top-[6px] grid h-[18px] w-[18px] place-items-center rounded-full bg-[#007AFF] shadow-[0_2px_6px_rgba(0,122,255,0.5)] ring-2 ring-white">
                        <Check className="h-[12px] w-[12px] text-white" strokeWidth={3.2} />
                      </span>
                    )}
                  </span>
                  <span className="text-center leading-tight">
                    <span className={`block text-[12.5px] ${sel ? 'font-semibold text-[#007AFF]' : 'text-black/85 dark:text-white/85'}`}>{o.name}</span>
                    <span className="mt-0.5 block text-[9.5px] text-muted-foreground">{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="px-6 pb-2 text-center text-[10.5px] leading-relaxed text-muted-foreground">
            开屏动画即时跟随；已安装到桌面的图标需重新添加一次才会换新
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full border-t border-black/[0.06] py-3 text-[16px] font-medium text-[#007AFF] transition-colors active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            好
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 第三十一轮：电量百分比显示方式弹窗美化（iOS 居中卡）：
 * - 每个选项带【状态栏仿真预览条】：深浅两张壁纸样条上呈现 9:41 + 信号/WiFi + 三种电池样式，
 *   所见即所得（原来只有一个孤零零的图标，机主要求美化）；
 * - 毛玻璃卡体 + 弹性入场 + 选中态高亮描边；点选即时生效持久化；点背板/Esc 关闭；
 * - portal 到 body 不受卡片层叠限制 */
function BatteryModeDialog({
  current,
  onPick,
  onClose,
}: {
  current: BatteryPercentMode;
  onPick: (m: BatteryPercentMode) => void;
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const options: { value: BatteryPercentMode; label: string; desc: string }[] = [
    { value: 'none', label: '不显示', desc: '只有电池图标' },
    { value: 'outside', label: '电池图标外部', desc: '数字+% 在电池左侧' },
    { value: 'inside', label: '电池图标内部', desc: 'iOS 16.1+ 同款 · 数字嵌电池内' },
  ];

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭电量百分比弹窗"
        data-testid="battery-mode-backdrop"
        className="fixed inset-0 z-[300] cursor-default bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="电量百分比显示方式"
        data-testid="battery-mode-dialog"
        className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-8"
      >
        <div
          className={`pointer-events-auto w-full max-w-[320px] overflow-hidden rounded-[24px] bg-white/90 shadow-[0_18px_48px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.06] backdrop-blur-2xl transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1.2)] dark:bg-zinc-900/[0.92] dark:ring-white/[0.09] ${
            entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.92] opacity-0'
          }`}
        >
          {/* 标题区（iOS 弹窗标题 + 说明） */}
          <div className="border-b border-black/[0.06] px-5 pb-3 pt-4 text-center dark:border-white/[0.08]">
            <p className="text-[16px] font-semibold text-black dark:text-white">电量百分比</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">状态栏电量的显示方式</p>
          </div>
          <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={current === o.value}
                data-testid={`battery-mode-${o.value}`}
                onClick={() => {
                  onPick(o.value);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  current === o.value ? 'bg-[#007AFF]/[0.06]' : ''
                }`}
              >
                {/* 状态栏仿真预览条：浅色壁纸样条上「9:41 + 电池」所见即所得 */}
                <span
                  className="relative flex h-[30px] w-[92px] shrink-0 items-center justify-between overflow-hidden rounded-[9px] bg-gradient-to-br from-[#E8E4DC] via-[#EFEBE4] to-[#E2D9CC] px-[7px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.06]"
                  data-testid={`battery-mode-preview-${o.value}`}
                >
                  <span className="text-[10.5px] font-semibold leading-none tabular-nums tracking-tight text-black">
                    9:41
                  </span>
                  <span className="flex items-center text-black">
                    <BatteryIcon level={67} charging={false} low={false} mode={o.value} light={false} />
                  </span>
                  {/* 选中态右上角小对勾角标 */}
                  {current === o.value && (
                    <span className="absolute right-[3px] top-[3px] grid h-[13px] w-[13px] place-items-center rounded-full bg-[#007AFF] shadow-sm">
                      <Check className="h-[9px] w-[9px] text-white" strokeWidth={3.2} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px]">{o.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full border-t border-black/[0.06] py-3 text-[16px] font-medium text-[#007AFF] transition-colors active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            好
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 开屏动画主题中文名（入口行右侧 value 展示；第三十四轮：moon 重做为雨落成诗 + 新增 chat 对话） */
function splashThemeName(t: CoveSplashTheme): string {
  return t === 'star' ? '星空月夜' : t === 'mist' ? '雾中远山' : t === 'moon' ? '雨落成诗' : '对话';
}

/** 四主题微缩场景底（弹窗预览卡背景——CSS 渐变近似还原各主题第一眼观感） */
const SPLASH_THEME_PREVIEW: Record<
  CoveSplashTheme,
  { bg: string; fg: string; accent: string; desc: string }
> = {
  star: {
    bg: 'linear-gradient(176deg, #15161B 0%, #1C1E26 46%, #23252F 78%, #1A1B22 100%)',
    fg: '#E9E9E4',
    accent: 'radial-gradient(circle at 30% 28%, #F4F4EF 0%, #E4E4DE 62%, #D4D4CE 100%)',
    desc: '星点 · 新月 · 深夜',
  },
  mist: {
    bg: 'linear-gradient(168deg, #F6F6F4 0%, #EDEDEB 52%, #E7E7E4 100%)',
    fg: '#3A3A38',
    accent: 'linear-gradient(180deg, #D8D8D3 0%, #AFAFAA 60%, #8A8A86 100%)',
    desc: '雾面 · 山影 · 灰白',
  },
  moon: {
    bg: 'linear-gradient(166deg, #C4CEDA 0%, #A9B6C5 34%, #93A2B4 62%, #7E8DA1 100%)',
    fg: '#FBFCFE',
    accent: 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.28) 48%, rgba(105,122,142,0.16) 100%)',
    desc: '雨丝 · 水珠 · 诗行',
  },
  chat: {
    bg: 'linear-gradient(178deg, #FDFDFE 0%, #FAFAFC 60%, #F6F6F9 100%)',
    fg: '#1C1C1E',
    accent: '#1E1E24',
    desc: '气泡 · 情话 · 已读',
  },
};

/** 第三十四轮：开屏动画四选一弹窗（iOS 居中卡，与 App 图标弹窗同规格）：
 *  四张 76×76 微缩场景预览（CSS 渐变近似还原主题观感：星空=深底+月、
 *  远山=灰白+山影渐变、雨窗=蓝灰+水珠、对话=白底+气泡），点选【立马生效】——
 *  选完即整屏播放一遍（BootSplash forceTheme 预览）+ localStorage 已同步写，
 *  下次冷启动 BootSplash 首帧即新主题；点背板/Esc/好 关闭。 */
function SplashThemeDialog({
  current,
  onPick,
  onClose,
}: {
  current: CoveSplashTheme;
  onPick: (t: CoveSplashTheme) => void;
  onClose: () => void;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const options: CoveSplashTheme[] = ['star', 'mist', 'moon', 'chat'];

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭开屏动画弹窗"
        data-testid="splash-theme-backdrop"
        className="fixed inset-0 z-[300] cursor-default bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="开屏动画"
        data-testid="splash-theme-dialog"
        className="pointer-events-none fixed inset-0 z-[310] flex items-center justify-center p-8"
      >
        <div
          className={`pointer-events-auto w-full max-w-[320px] overflow-hidden rounded-[24px] bg-white/90 shadow-[0_18px_48px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.06] backdrop-blur-2xl transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1.2)] dark:bg-zinc-900/[0.92] dark:ring-white/[0.09] ${
            entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.92] opacity-0'
          }`}
        >
          <div className="border-b border-black/[0.06] px-5 pb-3 pt-4 text-center dark:border-white/[0.08]">
            <p className="text-[16px] font-semibold text-black dark:text-white">开屏动画</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Cove · 四款主题任选</p>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 py-4">
            {options.map((t) => {
              const sel = current === t;
              const pv = SPLASH_THEME_PREVIEW[t];
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sel}
                  aria-label={`${splashThemeName(t)}（${pv.desc}）`}
                  data-testid={`splash-theme-option-${t}`}
                  onClick={() => {
                    onPick(t);
                    onClose();
                  }}
                  className={`flex flex-col items-center gap-2 rounded-[16px] px-1 py-3 transition-all active:scale-[0.97] ${
                    sel ? 'bg-[#007AFF]/[0.08] ring-[1.5px] ring-[#007AFF]/60' : 'ring-[1.5px] ring-transparent'
                  }`}
                >
                  <span className="relative">
                    {/* 微缩场景卡：CSS 渐变近似各主题 */}
                    <span
                      className={`flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-[16px] shadow-[0_6px_16px_rgba(0,0,0,0.14)] ${sel ? '' : 'opacity-95'}`}
                      style={{ background: pv.bg }}
                      aria-hidden="true"
                    >
                      {t === 'mist' ? (
                        // 远山：山形渐变块
                        <span
                          className="absolute inset-x-[10%] bottom-0 block h-[38%]"
                          style={{ background: pv.accent, clipPath: 'polygon(0% 100%, 12% 42%, 30% 68%, 48% 22%, 66% 62%, 84% 34%, 100% 78%, 100% 100%)' }}
                        />
                      ) : t === 'chat' ? (
                        // 对话：两枚气泡（右上深灰 + 左下浅灰）
                        <>
                          <span
                            className="absolute right-[10%] top-[16%] block h-[16px] w-[46%] rounded-[8px] rounded-br-[3px]"
                            style={{ background: '#1E1E24' }}
                          />
                          <span
                            className="absolute bottom-[18%] left-[10%] block h-[16px] w-[38%] rounded-[8px] rounded-bl-[3px] bg-[#E9E9EE]"
                          />
                        </>
                      ) : t === 'moon' ? (
                        // 雨窗：蓝灰底 + 三颗高光水珠 + 斜雨丝 + 手写 cove 意象
                        <>
                          <span
                            className="absolute left-[16%] top-[18%] block h-[10px] w-[10px] rounded-full"
                            style={{ background: pv.accent }}
                          />
                          <span
                            className="absolute left-[58%] top-[34%] block h-[7px] w-[7px] rounded-full"
                            style={{ background: pv.accent, opacity: 0.9 }}
                          />
                          <span
                            className="absolute left-[30%] bottom-[22%] block h-[8px] w-[8px] rounded-full"
                            style={{ background: pv.accent, opacity: 0.8 }}
                          />
                          <span
                            className="absolute left-[18%] top-0 block h-[30px] w-[1.5px] rotate-[9deg] rounded-full"
                            style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 55%, rgba(255,255,255,0) 100%)' }}
                          />
                          <span
                            className="absolute left-[64%] top-[8%] block h-[26px] w-[1.5px] rotate-[9deg] rounded-full"
                            style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 55%, rgba(255,255,255,0) 100%)' }}
                          />
                          <span
                            className="absolute left-1/2 top-[62%] -translate-x-1/2 text-[15px] leading-none text-white"
                            style={{ fontFamily: "'Zhi Mang Xing', 'Kaiti SC', serif", textShadow: '0 1px 3px rgba(58,72,92,0.4)' }}
                          >
                            cove
                          </span>
                        </>
                      ) : (
                        // 星空：新月（渐变圆 + 缺口圆）
                        <>
                          <span
                            className="absolute left-[22%] top-[20%] block h-[20px] w-[20px] rounded-full"
                            style={{ background: pv.accent }}
                          />
                          <span
                            className="absolute left-[27%] top-[16%] block h-[19px] w-[19px] rounded-full"
                            style={{ background: '#1C1E26' }}
                          />
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span
                              key={i}
                              className="absolute rounded-full"
                              style={{
                                left: `${58 + (i % 3) * 12}%`,
                                top: `${18 + i * 15}%`,
                                width: 2,
                                height: 2,
                                background: '#E9E9E4',
                                opacity: 0.8,
                              }}
                            />
                          ))}
                        </>
                      )}
                    </span>
                    {sel && (
                      <span className="absolute -right-[6px] -top-[6px] grid h-[18px] w-[18px] place-items-center rounded-full bg-[#007AFF] shadow-[0_2px_6px_rgba(0,122,255,0.5)] ring-2 ring-white">
                        <Check className="h-[12px] w-[12px] text-white" strokeWidth={3.2} />
                      </span>
                    )}
                  </span>
                  <span className="text-center leading-tight">
                    <span className={`block text-[12.5px] ${sel ? 'font-semibold text-[#007AFF]' : 'text-black/85 dark:text-white/85'}`}>
                      {splashThemeName(t)}
                    </span>
                    <span className="mt-0.5 block text-[9.5px] text-muted-foreground">{pv.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="px-6 pb-2 text-center text-[10.5px] leading-relaxed text-muted-foreground">
            点选立马生效 · 立即播放预览 + 下次打开 Cove 时播放所选主题
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full border-t border-black/[0.06] py-3 text-[16px] font-medium text-[#007AFF] transition-colors active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            好
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
