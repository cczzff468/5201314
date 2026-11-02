'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  AudioLines,
  Bell,
  Bluetooth,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  Download,
  Eye,
  EyeOff,
  Heart,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  MessageSquareText,
  Minus,
  Monitor,
  Moon,
  Plane,
  PenLine,
  Plus,
  RefreshCw,
  Layers,
  PanelTop,
  ScanEye,
  ScanFace,
  Smartphone,
  Star,
  Sun,
  Trash2,
  Type,
  Upload,
  User,
  UsersRound,
  Vibrate,
  Volume2,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import PasscodePad from '@/components/ios/PasscodePad';
import { APPS, AppIconTile } from './registry';
import { useUI } from '@/lib/ios/store';
import { genId, formatDuration, localDB, type IOSStoreName } from '@/lib/ios/db';
import {
  DEFAULT_API_CONFIG,
  WALLPAPER_PRESETS,
  useSettings,
  type ApiPreset,
  type AppId,
  type ImgGenConfig,
  type ImgGenPreset,
  type ThemeMode,
  type VisionConfig,
  type VisionPreset,
} from '@/lib/ios/store';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { directFetchModels, directTest, isPrivateApiUrl } from '@/lib/ios/direct-api';
import { exportBackupToDownload, restoreBackup } from '@/lib/ios/backup';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
import {
  compressImageSrc,
  extractImgGenError,
  getAppearanceNote,
  getFaceRef,
  imgGenConfigReady,
  imggenEndpoints,
  pickImageFromResponse,
  setAppearanceNote,
  setFaceRef,
  type ImgGenFaceRef,
} from '@/lib/imggen';
import { listContacts, mainOwnerContact, ownerRealName } from '@/lib/ios/contacts-store';
import {
  accountDisplayName,
  accountUsedBy,
  createAccount,
  deleteAccount,
  getAccounts,
  MAIN_ACCOUNT_ID,
  type AccountApp,
  type PhoneAccount,
} from '@/lib/ios/accounts';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { isWebSpeechSupported } from '@/lib/ios/web-speech';
import { lastPushStatus, setupPushSubscription, teardownPushSubscription } from '@/lib/ios/push-client';
import { showSystemNotification } from '@/lib/ios/system-notify';
import { deleteOfflineModel, initOfflineAsr, useOfflineAsr } from '@/lib/ios/offline-asr';
import { isSysNotifyEnabled, setSysNotifyEnabled } from '@/lib/ios/island-notify';
import {
  addCustomRingtone,
  BUILTIN_NOTIFY_TONES,
  deleteCustomRingtone,
  inDndWindow,
  NOTIFY_SOUND_CATEGORY_META,
  playTone,
  toneDisplayName,
  useNotifySound,
  type NotifySoundCategory,
  type RingtoneMeta,
} from '@/lib/ios/notify-sound';
import { LocalToast, useLocalToast } from './page-toast';
import { describeImages } from '@/lib/vision-client';
import { BUILTIN_TTS_VOICES, isBuiltinVoiceId, isBuiltinVoiceSupported, speakBuiltin, stopBuiltinSpeech } from '@/lib/ios/builtin-voices';
import { useMyVoices } from '@/lib/ios/my-voices';
import {
  applyAppFont,
  BUILTIN_APP_FONTS,
  customFontFamilyOf,
  deleteCustomFont,
  listCustomFonts,
  loadCustomFontFace,
  saveCustomFont,
  applyAppFontScale,
  applyAppFontWeight,
  FONT_SCALE_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  type AppFontMeta,
} from '@/lib/ios/fonts';

// ---------------- 常量与类型 ----------------

type Page = 'root' | 'account' | 'profile' | 'theme' | 'notification' | 'storage' | 'wallpaper' | 'font' | 'api' | 'vision' | 'imggen' | 'voice' | 'about' | 'lock';

const IOS_RED = '#FF453A';

/** 主列表"显示与亮度"右侧的主题短名 */
const THEME_SHORT: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  auto: '自动',
};

/** 内置预设：OpenAI + 国内可直连三家。海外厂商服务器出口有地区限制，但拉模型/测连接/聊天流式
 *  均已内置「服务端失败 → 浏览器直连」自动回退（directOnly），OpenAI 兼容中转/反代地址同样适用 */
const BUILTIN_API_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
];

/** 内置识图预设：均为支持图片输入的模型（识图模型与聊天模型可同厂不同款） */
const BUILTIN_VISION_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
];

/** 内置生图预设：OpenAI 官方（预设列表第一项、不可删除；Key 需自行填写） */
const BUILTIN_IMGGEN_PRESET: ImgGenPreset = {
  id: 'builtin-openai',
  name: 'OpenAI 官方',
  config: {
    enabled: false,
    mode: 'proxy',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'auto',
    extraPrompt: '',
  },
};

// ---------------- 模块级工具 ----------------

async function readStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    }
  } catch {
    // 忽略，返回 0
  }
  return { usage: 0, quota: 0 };
}

// ---------------- 通用小组件 ----------------

/** iOS 分组卡片（子页用）：GrayCard 同款毛玻璃配方但无内边距（divide-y 行列表用，分隔线贴边） */
function GroupCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">{children}</div>
  );
}

/** iOS 系统设置图标色板（参照用户截图：纯色圆角方块 + 白色图标） */
const TONE_ORANGE = '#FF9500';
const TONE_BLUE = '#007AFF';
const TONE_GREEN = '#34C759';
const TONE_RED = '#FF3B30';
const TONE_GRAY = '#8E8E93';
const TONE_CYAN = '#32ADE6';
const TONE_PURPLE = '#AF52FF';
const TONE_PINK = '#FF2D55';

/** 主列表行图标：纯色圆角方块 + 白色线性图标（iOS 设置风） */
function RowIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
      style={{ backgroundColor: tone }}
    >
      <Icon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
    </span>
  );
}

/** 主列表行：左彩色方块图标 + 标签，右侧可选值 / ChevronRight（testId：需要 E2E 定位的行传入） */
function MainRow({
  icon,
  tone,
  label,
  value,
  onClick,
  chevron,
  testId,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value?: string;
  onClick?: () => void;
  chevron?: boolean;
  testId?: string;
}) {
  const showChevron = chevron ?? onClick !== undefined;
  const inner = (
    <>
      <RowIcon icon={icon} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      {value !== undefined && (
        <span className="max-w-[50%] shrink-0 truncate text-[15px] text-muted-foreground">{value}</span>
      )}
      {showChevron && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />}
    </>
  );

  if (onClick === undefined) {
    return <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">{inner}</div>;
  }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50"
    >
      {inner}
    </button>
  );
}

/** 详情页外壳：居中标题导航 + 返回按钮 + 右滑进入动画；
 *  gray=true 时整页浅灰背景（#F2F2F7，iOS 设置子页风），暗色主题保持原背景（无氛围光斑） */
function DetailShell({
  title,
  onBack,
  children,
  gray = false,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
  gray?: boolean;
}) {
  return (
    <div className={`relative flex h-full w-full flex-col ${gray ? 'bg-[#F2F2F7] dark:bg-transparent' : ''}`}>
      <IOSNavBar
        title={title}
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className={gray ? 'bg-transparent! backdrop-blur-none!' : ''}
      />
      <div className="no-scrollbar relative flex-1 overflow-y-auto">
        <div
          key={title}
          className="animate-in slide-in-from-right-6 fade-in duration-300 px-4 pb-[40px] pt-2"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">{children}</div>;
}

/** 配置页分组标题：小色块图标 + 灰字标签（iOS 设置风），右侧可选自定义内容 */
function SectionLabel({
  icon: Icon,
  tone,
  children,
  right,
}: {
  icon: LucideIcon;
  tone: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]"
          style={{ backgroundColor: `${tone}1F` }}
        >
          <Icon className="h-[11px] w-[11px]" style={{ color: tone }} strokeWidth={2.6} />
        </span>
        {children}
      </div>
      {right}
    </div>
  );
}

/** 毛玻璃分组卡片（glassmorphism）：半透明白 + backdrop-blur + 高光描边 + 柔和投影 */
function GrayCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09] ${className}`}
    >
      {children}
    </div>
  );
}

// ---------------- 主列表 ----------------

/** 全局头像（联系人 App 机主）：设置侧头像为空时跟随它；contact-updated 实时刷新 */
function useOwnerAvatar(): string | null {
  const [ownerAvatar, setOwnerAvatar] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void mainOwnerContact()
        .then((o) => {
          if (alive) setOwnerAvatar(o?.avatar ?? null);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener('contact-updated', load);
    window.addEventListener('contact-avatar-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('contact-updated', load);
      window.removeEventListener('contact-avatar-changed', load);
    };
  }, []);
  return ownerAvatar;
}

function RootPage({ onOpen }: { onOpen: (page: Page) => void }) {
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
  // 灵动岛常驻开关（用户需求）：关闭后隐藏顶部黑色胶囊基础灵动岛，只显示 APP 灵动岛
  const islandPersistent = useSettings((s) => s.islandPersistent);
  const setIslandPersistent = useSettings((s) => s.setIslandPersistent);

  const [airplane, setAirplane] = useState(false);

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
          <MainRow icon={Bluetooth} tone={TONE_BLUE} label="蓝牙" value="打开" chevron />
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
          {/* 状态栏开关（Task 36；Task 37 换绿色大开关）：关闭后顶部时间/信号/电量状态栏与灵动岛都隐藏。
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
          <MainRow icon={Database} tone={TONE_GREEN} label="存储" onClick={() => onOpen('storage')} />
        </div>

        {/* 关于本机 */}
        <div className="mx-4 mt-4 divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <MainRow icon={Info} tone={TONE_GRAY} label="关于本机" onClick={() => onOpen('about')} />
        </div>

        <p className="py-6 text-center text-[12px] text-muted-foreground">
          iOS Web · 本地优先架构 · 数据仅存于你的浏览器
        </p>
      </div>
    </>
  );
}

// ---------------- 外观与主题 ----------------

function ThemePage({ onBack }: { onBack: () => void }) {
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

// ---------------- 通知 ----------------

/** 推送订阅状态 → 中文描述（null = 状态未知/未尝试） */
function pushStatusText(state: string, detail?: string): string {
  switch (state) {
    case 'subscribed':
      return '推送已订阅：页面关闭后，新回复会以系统通知送达。';
    case 'unsupported':
      return `当前浏览器不支持后台推送${detail ? `（${detail}）` : ''}。`;
    case 'no-permission':
      return detail || '尚未开启通知权限。';
    case 'sw-failed':
      return `后台服务注册失败${detail ? `（${detail}）` : ''}。`;
    case 'key-failed':
      return `推送密钥获取失败${detail ? `（${detail}）` : ''}。`;
    case 'subscribe-failed':
      // 推送服务连不上（AbortError: Registration failed - push service error）：
      // 国内网络访问 Chrome/Firefox 境外推送服务失败，属常见现象且不影响页面内通知——不显示，避免吓用户
      if (/aborterror|push service error|registration failed/i.test(detail ?? '')) return '';
      return `推送订阅未完成${detail ? `（${detail}）` : ''}。`;
    default:
      return '';
  }
}

function NotificationPage({ onBack }: { onBack: () => void }) {
  // 开关 = 持久化的「系统级通知总闸」（localStorage ios-sys-notify-enabled，缺省开）。
  // 修复：原实现是组件局部 state，退出页面再进来又显示「开」，关掉后 Web Notification 照弹。
  // 该开关只管系统级通道（Web Notification / Web Push）；应用内灵动岛弹窗不受影响。
  const [enabled, setEnabled] = useState<boolean>(() => isSysNotifyEnabled());
  const [denied, setDenied] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof Notification !== 'undefined'
      ? Notification.permission === 'denied'
      : false
  );
  // 测试通知结果：ok=已弹出 / fail=构造失败（iframe 权限策略拦截）
  const [testResult, setTestResult] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  // 预览面板 iframe 提示：iframe 里系统通知/推送常被浏览器权限策略拦截
  // （本页在客户端交互后才挂载，惰性初始化读 window 安全；跨域访问 window.top 抛错 → 必在 iframe）
  const [inIframe] = useState<boolean>(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });
  // 推送订阅诊断（真实环境失败原因，不再静默）：setupPushSubscription 每次尝试后都会落盘
  const [pushState, setPushState] = useState<string>(() => lastPushStatus()?.state ?? '');
  const [pushDetail, setPushDetail] = useState<string>(() => lastPushStatus()?.detail ?? '');
  // 页内 toast（关闭开关后的说明）
  const [toastMsg, showToast] = useLocalToast();

  /** 权限就绪后立即尝试订阅（并把诊断结果回显）。用户主动入口一律 force=true：
   *  重置单次锁重跑订阅链路，首次订阅瞬时失败后不再被锁死到刷新整页 */
  const ensureSubscription = async (): Promise<void> => {
    const s = await setupPushSubscription({ force: true });
    setPushState(s.state);
    setPushDetail(s.detail ?? '');
  };

  const handleToggle = async (checked: boolean) => {
    // 先持久化用户意图（无论环境是否支持，退出页面/下次进来都保持本次选择）
    setSysNotifyEnabled(checked);
    if (!checked) {
      setEnabled(false);
      showToast('已关闭系统通知，应用内提醒不受影响');
      // 关闭系统级通知的同时退订 Web Push（服务端离线不再向本浏览器推送）
      const s = await teardownPushSubscription();
      setPushState(s.state);
      setPushDetail(s.detail ?? '');
      return;
    }
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setEnabled(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setEnabled(true);
      setDenied(false);
      void ensureSubscription();
      return;
    }
    if (Notification.permission === 'denied') {
      setEnabled(false);
      setDenied(true);
      return;
    }
    // 'default'：向浏览器请求授权
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setEnabled(true);
      setDenied(false);
      void ensureSubscription();
    } else {
      setEnabled(false);
      setDenied(result === 'denied');
    }
  };

  /** 测试系统通知：走 SW showNotification 优先（Android Chrome 页面里无 Notification 构造器，
   *  直接 new 会抛 Illegal constructor——必须走 Service Worker 通道），桌面无 SW 时落到页面构造器 */
  const fireTestNotification = async (): Promise<void> => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setTestResult('fail');
      return;
    }
    // 系统级通知总闸：开关关闭时测试通知同样不投递（与真实通知同口径）
    if (!enabled || !isSysNotifyEnabled()) {
      setTestResult('fail');
      return;
    }
    if (Notification.permission !== 'granted') {
      setTestResult('fail');
      return;
    }
    setTestResult('busy');
    const channel = await showSystemNotification('测试通知', {
      body: '系统通知通道正常：切走标签页 / 最小化时，AI 的新消息会像这样弹出。',
      tag: `test-${Date.now()}`,
      icon: '/icons/chat.png',
      badge: '/icons/chat.png',
      onclick: () => window.focus(),
    });
    setTestResult(channel ? 'ok' : 'fail');
  };

  return (
    <DetailShell title="通知" onBack={onBack} gray>
      <GroupCard>
        <div className="flex h-[46px] items-center justify-between px-4">
          <span className="text-[16px]">允许通知</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void handleToggle(v)}
            aria-label="允许通知"
          />
        </div>
      </GroupCard>
      {denied && (
        <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }}>
          通知已被浏览器拒绝，请在浏览器设置中恢复。
        </p>
      )}
      {inIframe && (
        <p className="mt-3 rounded-[14px] bg-white/55 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          当前页面嵌在预览面板（iframe）里，部分浏览器会在这里拦截系统通知与后台推送。
          点预览面板右上角「在新标签页打开」后重新开启通知，切走/关闭页面也能收到。
        </p>
      )}
      <div className="mt-3">
        <GroupCard>
          <button
            type="button"
            onClick={() => void fireTestNotification()}
            disabled={testResult === 'busy' || !enabled}
            className="flex h-[46px] w-full items-center justify-between px-4 text-left disabled:opacity-50"
          >
            <span className="text-[16px]">发送测试通知</span>
            {testResult === 'busy' ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </GroupCard>
      </div>
      {testResult === 'ok' && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          已发送：如果没看到弹窗，检查系统/浏览器是否开了「勿扰」或隐藏了通知横幅。
        </p>
      )}
      {testResult === 'fail' && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed" style={{ color: IOS_RED }}>
          系统通知未能弹出：页面构造与 Service Worker 两条通道都被拦截。若在预览面板里请用新标签页打开；
          独立部署时多为浏览器策略限制（Android 需允许站点通知）。
        </p>
      )}
      {pushState && pushStatusText(pushState, pushDetail) && (
        <p
          className={`mt-2 px-1 text-[12px] leading-relaxed ${pushState === 'subscribed' ? 'text-muted-foreground' : ''}`}
          style={pushState === 'subscribed' ? undefined : { color: IOS_RED }}
        >
          {pushStatusText(pushState, pushDetail)}
        </p>
      )}
      {/* 订阅失败重试入口（force 重跑订阅链路，不再被单次锁锁死到刷新整页） */}
      {enabled && pushState && pushState !== 'subscribed' && (
        <button
          type="button"
          onClick={() => void ensureSubscription()}
          className="mt-1.5 px-1 text-[12px] text-foreground underline underline-offset-2 transition-opacity active:opacity-50"
        >
          重新尝试订阅后台推送
        </button>
      )}
      <NotifySoundSection />
      <LocalToast msg={toastMsg} />
    </DetailShell>
  );
}

// ---------------- 通知 · 声音与铃声 ----------------

/** 免打扰时段显示文案（from/to 任一为空 = 关闭） */
function soundDndLabel(from: string, to: string): string {
  return from && to ? `${from} – ${to}` : '关闭';
}

/** 免打扰时段编辑（原生 time 输入对；支持跨夜如 22:00–08:00） */
function DndTimeEditor({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3 pt-0.5">
      <input
        type="time"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label="免打扰开始时间"
        className="h-9 rounded-[10px] bg-white/70 px-3 text-[15px] tabular-nums outline-none ring-1 ring-black/10 dark:bg-white/[0.08] dark:ring-white/15"
      />
      <span className="text-[13px] text-muted-foreground">至</span>
      <input
        type="time"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label="免打扰结束时间"
        className="h-9 rounded-[10px] bg-white/70 px-3 text-[15px] tabular-nums outline-none ring-1 ring-black/10 dark:bg-white/[0.08] dark:ring-white/15"
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => onChange('', '')}
          className="ml-auto text-[13px] text-muted-foreground underline underline-offset-2 transition-opacity active:opacity-50"
        >
          清除
        </button>
      )}
    </div>
  );
}

/** 五分类的 iOS 设置风行首图标（纯色圆角方块 + 白色线性图标） */
const CATEGORY_ICON: Record<NotifySoundCategory, { icon: LucideIcon; tone: string }> = {
  receive: { icon: ArrowDownLeft, tone: TONE_GREEN },
  send: { icon: ArrowUpRight, tone: TONE_BLUE },
  moments: { icon: Heart, tone: TONE_PINK },
  qzone: { icon: Star, tone: TONE_ORANGE },
  group: { icon: UsersRound, tone: TONE_PURPLE },
};

/** 底部弹窗内容：铃声列表（内置 8 个 + 我的铃声；每项可试听；上传入口；已选打勾） */
function ToneSheetContent({
  value,
  ringtones,
  uploading,
  previewingId,
  onPick,
  onPreview,
  onUpload,
  onRequestDelete,
}: {
  value: string;
  ringtones: RingtoneMeta[];
  uploading: boolean;
  /** 正在试听的铃声 id（喇叭图标变为绿色音波动画） */
  previewingId: string | null;
  onPick: (id: string) => void;
  onPreview: (id: string) => void;
  onUpload: () => void;
  onRequestDelete: (r: RingtoneMeta) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="pb-1.5 pl-1 text-[13px] font-medium text-muted-foreground">内置铃声</p>
        <GroupCard>
          {BUILTIN_NOTIFY_TONES.map((t) => {
            const active = value === t.id;
            const playing = previewingId === t.id;
            return (
              <div key={t.id} className="flex h-[46px] items-center px-2">
                <button
                  type="button"
                  onClick={() => onPreview(t.id)}
                  aria-label={`试听${t.name}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted/70 ${
                    playing ? 'text-[#34C759]' : 'text-muted-foreground'
                  }`}
                >
                  {playing ? (
                    <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                  ) : (
                    <Volume2 className="h-[18px] w-[18px]" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onPick(t.id)}
                  className="flex min-w-0 flex-1 items-center justify-between pl-1.5 pr-1 text-left"
                >
                  <span className="truncate text-[16px]">{t.name}</span>
                  {active && <Check className="h-[18px] w-[18px] shrink-0 text-[#34C759]" aria-label="已选中" />}
                </button>
              </div>
            );
          })}
        </GroupCard>
      </div>
      {ringtones.length > 0 && (
        <div>
          <p className="pb-1.5 pl-1 text-[13px] font-medium text-muted-foreground">我的铃声</p>
          <GroupCard>
            {ringtones.map((r) => {
              const id = `custom:${r.id}`;
              const active = value === id;
              const playing = previewingId === id;
              return (
                <div key={r.id} className="flex h-[46px] items-center px-2">
                  <button
                    type="button"
                    onClick={() => onPreview(id)}
                    aria-label={`试听${r.name}`}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted/70 ${
                      playing ? 'text-[#34C759]' : 'text-muted-foreground'
                    }`}
                  >
                    {playing ? (
                      <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                    ) : (
                      <Volume2 className="h-[18px] w-[18px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    className="flex min-w-0 flex-1 items-center justify-between pl-1.5 pr-1 text-left"
                  >
                    <span className="min-w-0 truncate text-[16px]">
                      {r.name}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {r.duration > 0 ? formatDuration(r.duration) : '—'}
                      </span>
                    </span>
                    {active && <Check className="h-[18px] w-[18px] shrink-0 text-[#34C759]" aria-label="已选中" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestDelete(r)}
                    aria-label={`删除${r.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </GroupCard>
        </div>
      )}
      <div>
        <p className="pb-1.5 pl-1 text-[13px] font-medium text-muted-foreground">更多</p>
        <GroupCard>
          <button
            type="button"
            onClick={onUpload}
            disabled={uploading}
            className="flex h-[48px] w-full items-center gap-3 px-4 text-left disabled:opacity-60"
          >
            <RowIcon icon={Upload} tone={TONE_BLUE} />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">{uploading ? '正在保存…' : '上传自定义铃声'}</span>
              <span className="block text-[11px] text-muted-foreground">音频文件 · ≤8MB · 永久保存</span>
            </span>
            {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </button>
        </GroupCard>
      </div>
    </div>
  );
}

/**
 * iOS 风格底部弹窗：从屏幕底部滑入的铃声选择面板（抓手 + 居中标题 + 右上「完成」）。
 * fixed 定位在 PhoneShell 内（壳 transform 使 fixed 相对机身定位，天然只覆盖手机屏）；
 * 点遮罩 / 「完成」/ Esc 关闭；内容超长时内部滚动。
 */
function ToneSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  // 挂载期间 Esc 关闭（桌面端键盘友好）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title}>
      {/* 遮罩：点击空白关闭 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 animate-in fade-in duration-200"
      />
      {/* 面板：从底部滑入 */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[18px] bg-[#F7F7F8]/95 shadow-[0_-10px_44px_rgba(0,0,0,0.28)] ring-1 ring-white/60 backdrop-blur-2xl animate-in slide-in-from-bottom-10 fade-in duration-300 dark:bg-[#1C1C1E]/95 dark:ring-white/10">
        <div className="mx-auto mt-2.5 h-[5px] w-10 shrink-0 rounded-full bg-black/15 dark:bg-white/25" aria-hidden="true" />
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <span className="w-14" aria-hidden="true" />
          <span className="text-[17px] font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-14 text-right text-[17px] text-[#007AFF] transition-opacity active:opacity-40"
          >
            完成
          </button>
        </div>
        <div className="no-scrollbar max-h-[540px] overflow-y-auto px-4 pb-8 pt-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * 声音与铃声完整配置区（通知页内嵌）:
 * 全局（提示音总开关/总音量/震动/免打扰）+ 五分类（铃声/试听/音量/开关/免打扰）+ 我的铃声管理。
 * 所有改动即时持久化生效（useNotifySound.update* 内部写 IndexedDB）。
 */
function NotifySoundSection() {
  const settings = useNotifySound((s) => s.settings);
  const ringtones = useNotifySound((s) => s.ringtones);
  const update = useNotifySound((s) => s.update);
  const updateCategory = useNotifySound((s) => s.updateCategory);
  const [openCat, setOpenCat] = useState<NotifySoundCategory | null>(null);
  /** 底部弹窗当前选择铃声的分类 */
  const [sheetCat, setSheetCat] = useState<NotifySoundCategory | null>(null);
  const [globalDndOpen, setGlobalDndOpen] = useState(false);
  const [catDndOpen, setCatDndOpen] = useState<NotifySoundCategory | null>(null);
  const [uploading, setUploading] = useState(false);
  const [delTarget, setDelTarget] = useState<RingtoneMeta | null>(null);
  /** 正在试听的铃声 id（喇叭图标变绿色音波，播完自动恢复） */
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toastMsg, showToast] = useLocalToast();

  // 分类独立开关已从界面移除（总开关 + 音量/免打扰已足够，界面更简洁）：
  // 历史数据里手动关过的分类一次性恢复，避免「无声且无处再开启」的死角
  useEffect(() => {
    const cats = settings.categories;
    const off = (Object.keys(cats) as NotifySoundCategory[]).filter((k) => !cats[k].enabled);
    if (off.length === 0) return;
    const next = { ...settings, categories: { ...cats } };
    for (const k of off) next.categories[k] = { ...next.categories[k], enabled: true };
    update(next);
  }, [settings, update]);

  // 卸载清理试听状态计时器
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    []
  );

  /** 分类实际音量（总音量 × 分类音量，试听同口径） */
  const categoryVolume = (key: NotifySoundCategory): number =>
    Math.max(0, Math.min(1, settings.masterVolume * settings.categories[key].volume));

  /** 试听（音量为 0 时提示，不白点；播放中喇叭变音波，播完自动恢复） */
  const preview = (toneId: string, vol: number): void => {
    if (vol <= 0.001) {
      showToast('音量为 0，请先调高音量');
      return;
    }
    setPreviewingId(toneId);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    void playTone(toneId, vol)
      .catch(() => undefined)
      .finally(() => {
        previewTimer.current = setTimeout(
          () => setPreviewingId((cur) => (cur === toneId ? null : cur)),
          260
        );
      });
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const meta = await addCustomRingtone(file);
      showToast(`已保存「${meta.name}」，可在各分类提示音里选用`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传失败，请换一个音频文件');
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const t = delTarget;
    setDelTarget(null);
    if (!t) return;
    try {
      await deleteCustomRingtone(t.id);
      showToast('已删除');
    } catch {
      showToast('删除失败，请重试');
    }
  };

  const categoryKeys = Object.keys(NOTIFY_SOUND_CATEGORY_META) as NotifySoundCategory[];

  return (
    <div>
      {/* ---------- 全局 ---------- */}
      <p className="mt-6 px-1 pb-1.5 text-[13px] font-medium text-muted-foreground">声音与铃声</p>
      <GroupCard>
        <div className="flex h-[48px] items-center gap-3 px-4">
          <RowIcon icon={Bell} tone={TONE_RED} />
          <span className="min-w-0 flex-1 text-[16px]">提示音</span>
          <Switch
            checked={settings.master}
            onCheckedChange={(v) => update({ master: v })}
            aria-label="提示音总开关"
          />
        </div>
        <div className="pb-3.5 pt-1">
          <div className="flex items-center gap-3 px-4">
            <RowIcon icon={Volume2} tone={TONE_BLUE} />
            <span className="min-w-0 flex-1 text-[16px]">总音量</span>
            <span className="text-[15px] tabular-nums text-muted-foreground">
              {Math.round(settings.masterVolume * 100)}%
            </span>
          </div>
          <div className="px-4 pt-3">
            <Slider
              className="ios-slider"
              value={[Math.round(settings.masterVolume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => update({ masterVolume: (v[0] ?? 90) / 100 })}
              aria-label="总音量"
            />
          </div>
        </div>
        <div className="flex h-[48px] items-center gap-3 px-4">
          <RowIcon icon={Vibrate} tone={TONE_PURPLE} />
          <span className="min-w-0 flex-1 text-[16px]">响铃时震动</span>
          <Switch
            checked={settings.vibrate}
            onCheckedChange={(v) => update({ vibrate: v })}
            aria-label="响铃时震动"
          />
        </div>
        <button
          type="button"
          onClick={() => setGlobalDndOpen((v) => !v)}
          className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left"
          aria-expanded={globalDndOpen}
        >
          <RowIcon icon={Moon} tone={TONE_CYAN} />
          <span className="min-w-0 flex-1 text-[16px]">免打扰时段</span>
          <span className="shrink-0 text-[15px] text-muted-foreground">
            {soundDndLabel(settings.dndFrom, settings.dndTo)}
          </span>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform ${globalDndOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {globalDndOpen && (
          <DndTimeEditor
            from={settings.dndFrom}
            to={settings.dndTo}
            onChange={(f, t) => update({ dndFrom: f, dndTo: t })}
          />
        )}
      </GroupCard>
      {!settings.master && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          已一键静音：各类提示音都不响，配置保留，重新打开即恢复。
        </p>
      )}
      {settings.master && inDndWindow(settings.dndFrom, settings.dndTo) && (
        <p className="mt-2 px-1 text-[12px] leading-relaxed" style={{ color: TONE_GREEN }}>
          当前处于免打扰时段（{settings.dndFrom} – {settings.dndTo}）：通知照常，只是不响铃。
        </p>
      )}

      {/* ---------- 五分类（无独立开关：总开关 + 音量/免打扰已足够，界面更简洁） ---------- */}
      <p className="mt-4 px-1 pb-1.5 text-[13px] font-medium text-muted-foreground">按类型配置</p>
      <GroupCard>
        {categoryKeys.map((key) => {
          const meta = NOTIFY_SOUND_CATEGORY_META[key];
          const cfg = settings.categories[key];
          const ic = CATEGORY_ICON[key];
          const open = openCat === key;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setOpenCat(open ? null : key)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/40"
                aria-expanded={open}
              >
                <RowIcon icon={ic.icon} tone={ic.tone} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px]">{meta.label}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{meta.desc}</span>
                </span>
                <span className="max-w-[96px] shrink-0 truncate text-[14px] text-muted-foreground">
                  {toneDisplayName(cfg.toneId, ringtones)}
                </span>
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform ${open ? 'rotate-90' : ''}`}
                />
              </button>
              {open && (
                <div className="animate-in fade-in slide-in-from-top-1 pb-3.5 duration-200">
                  {/* 提示音 → 底部弹窗选择 */}
                  <button
                    type="button"
                    onClick={() => setSheetCat(key)}
                    className="flex h-[44px] w-full items-center justify-between px-4 text-left"
                  >
                    <span className="text-[15px]">提示音</span>
                    <span className="flex items-center gap-1 text-[15px] text-muted-foreground">
                      {toneDisplayName(cfg.toneId, ringtones)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                    </span>
                  </button>
                  {/* 试听 */}
                  <div className="flex h-[44px] items-center justify-between px-4">
                    <span className="text-[15px] text-muted-foreground">
                      试听（实际音量 {Math.round(categoryVolume(key) * 100)}%）
                    </span>
                    <button
                      type="button"
                      onClick={() => preview(cfg.toneId, categoryVolume(key))}
                      aria-label={`试听${meta.label}`}
                      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                        previewingId === cfg.toneId
                          ? 'bg-[#34C759]/15 text-[#34C759]'
                          : 'bg-black/[0.05] text-foreground/80 active:bg-black/10 dark:bg-white/10 dark:text-white/85 dark:active:bg-white/20'
                      }`}
                    >
                      {previewingId === cfg.toneId ? (
                        <AudioLines className="h-5 w-5 animate-pulse" />
                      ) : (
                        <Volume2 className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  {/* 分类音量 */}
                  <div className="px-4 py-1.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[14px] text-muted-foreground">音量</span>
                      <span className="text-[13px] tabular-nums text-muted-foreground">
                        {Math.round(cfg.volume * 100)}%
                      </span>
                    </div>
                    <Slider
                      className="ios-slider"
                      value={[Math.round(cfg.volume * 100)]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={(v) => updateCategory(key, { volume: (v[0] ?? 80) / 100 })}
                      aria-label={`${meta.label}音量`}
                    />
                  </div>
                  {/* 分类免打扰 */}
                  <button
                    type="button"
                    onClick={() => setCatDndOpen(catDndOpen === key ? null : key)}
                    className="flex h-[44px] w-full items-center justify-between px-4 text-left"
                    aria-expanded={catDndOpen === key}
                  >
                    <span className="text-[15px]">免打扰时段</span>
                    <span className="flex items-center gap-1 text-[14px] text-muted-foreground">
                      {soundDndLabel(cfg.dndFrom, cfg.dndTo)}
                      <ChevronRight
                        className={`h-4 w-4 text-muted-foreground/60 transition-transform ${catDndOpen === key ? 'rotate-90' : ''}`}
                      />
                    </span>
                  </button>
                  {catDndOpen === key && (
                    <DndTimeEditor
                      from={cfg.dndFrom}
                      to={cfg.dndTo}
                      onChange={(f, t) => updateCategory(key, { dndFrom: f, dndTo: t })}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </GroupCard>

      {/* ---------- 我的铃声管理 ---------- */}
      <p className="mt-4 px-1 pb-1.5 text-[13px] font-medium text-muted-foreground">我的铃声</p>
      <GroupCard>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex h-[48px] w-full items-center gap-3 px-4 text-left disabled:opacity-60"
        >
          <RowIcon icon={Upload} tone={TONE_GREEN} />
          <span className="min-w-0 flex-1 text-[16px]">{uploading ? '正在保存…' : '上传自定义铃声'}</span>
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-[12px] text-muted-foreground">音频 · ≤8MB</span>
          )}
        </button>
        {ringtones.length > 0 ? (
          <div>
            {ringtones.map((r) => (
              <div key={r.id} className="flex h-[48px] items-center gap-2.5 px-4">
                <button
                  type="button"
                  onClick={() => preview(`custom:${r.id}`, Math.max(settings.masterVolume, 0.25))}
                  aria-label={`试听${r.name}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                    previewingId === `custom:${r.id}`
                      ? 'bg-[#34C759]/15 text-[#34C759]'
                      : 'bg-black/[0.05] text-foreground/80 active:bg-black/10 dark:bg-white/10 dark:text-white/85 dark:active:bg-white/20'
                  }`}
                >
                  {previewingId === `custom:${r.id}` ? (
                    <AudioLines className="h-[18px] w-[18px] animate-pulse" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{r.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.duration > 0 ? formatDuration(r.duration) : '时长未知'} · 已永久保存
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setDelTarget(r)}
                  aria-label={`删除${r.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted/70"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
            还没有上传的铃声；上传后永久保存在本机，可在任意分类的「提示音」里选用、删除。
          </p>
        )}
      </GroupCard>

      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        设置保存后立即生效，无需重启。免打扰时段内通知照常送达、记录照常保留，只是不响铃不震动。
        声音设置为整机共享，切换聊天账号不受影响。
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleUploadFile(e)}
      />

      {/* ---------- 提示音选择底部弹窗 ---------- */}
      {sheetCat && (
        <ToneSheet title="选择提示音" onClose={() => setSheetCat(null)}>
          <ToneSheetContent
            value={settings.categories[sheetCat].toneId}
            ringtones={ringtones}
            uploading={uploading}
            previewingId={previewingId}
            onUpload={() => fileRef.current?.click()}
            onPreview={(id) => preview(id, categoryVolume(sheetCat))}
            onPick={(id) => {
              updateCategory(sheetCat, { toneId: id });
              // 选完立即试听；分类音量为 0 时给最低可闻度（纯选铃声场景）
              preview(id, Math.max(categoryVolume(sheetCat), 0.25));
            }}
            onRequestDelete={(r) => {
              // 先收弹窗再确认删除（确认框层级在弹窗之上）
              setSheetCat(null);
              setDelTarget(r);
            }}
          />
        </ToneSheet>
      )}

      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{delTarget?.name ?? ''}」？</AlertDialogTitle>
            <AlertDialogDescription>
              使用这个铃声的分类会自动改回默认提示音；删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toastMsg} />
    </div>
  );
}

// ---------------- 存储空间（真实用量实测 + 毛玻璃胶囊风） ----------------

/** 分类配色（红=应用程序 / 橙=照片 / 浅灰=系统数据） */
const CAT_APPS_COLOR = '#FF3B30';
const CAT_PHOTOS_COLOR = '#FF9500';

/** 图例胶囊：圆点 + 标签的毛玻璃小药丸 */
function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/55 px-3 py-1 text-[12px] ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.07] dark:ring-white/[0.1]">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

let _te: TextEncoder | null = null;
function strBytes(s: string): number {
  if (!_te) _te = new TextEncoder();
  return _te.encode(s).length;
}

/** 递归估算任意记录的真实字节：Blob 取 size、字符串取 UTF-8 字节数、对象/数组逐字段累加 */
function valueBytes(v: unknown, depth = 0): number {
  if (v == null) return 4;
  if (typeof v === 'string') return strBytes(v);
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 4;
  if (v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (depth >= 5) return 0;
  if (Array.isArray(v)) {
    let s = 0;
    for (const item of v) s += valueBytes(item, depth + 1);
    return s;
  }
  if (typeof v === 'object') {
    let s = 0;
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      s += k.length + valueBytes(item, depth + 1);
    }
    return s;
  }
  return 0;
}

interface StoreStat {
  bytes: number;
  /** 组内最新一条数据的时间戳（无时间字段 = null） */
  lastAt: number | null;
}

const EMPTY_STAT: StoreStat = { bytes: 0, lastAt: null };

function mergeStats(...stats: StoreStat[]): StoreStat {
  let bytes = 0;
  let lastAt: number | null = null;
  for (const s of stats) {
    bytes += s.bytes;
    if (s.lastAt != null && (lastAt == null || s.lastAt > lastAt)) lastAt = s.lastAt;
  }
  return { bytes, lastAt };
}

/** 扫描一个对象 store：累加真实字节 + 取最新时间戳 */
async function statStore<K extends IOSStoreName>(
  store: K,
  tsField: 'createdAt' | 'updatedAt' = 'createdAt',
): Promise<StoreStat> {
  try {
    const rows = (await localDB.getAll(store)) as unknown as Record<string, unknown>[];
    let bytes = 0;
    let lastAt: number | null = null;
    for (const r of rows) {
      bytes += valueBytes(r);
      const ts = r[tsField];
      if (typeof ts === 'number' && ts > (lastAt ?? 0)) lastAt = ts;
    }
    return { bytes, lastAt };
  } catch {
    return { bytes: 0, lastAt: null };
  }
}

/** kv 键 → 所属 App 桶（键名前缀规则，与 idb-kv 迁移清单一致） */
function kvBucketOf(key: string): 'wx' | 'qq' | 'chat' | 'memory' | 'worldbook' | 'music' | 'system' {
  if (key.startsWith('wx')) return 'wx';
  if (key.startsWith('qq')) return 'qq';
  if (key.startsWith('ios-chat') || key.startsWith('sms-chat') || key.startsWith('chat-translate')) return 'chat';
  if (key.startsWith('mem-')) return 'memory';
  if (key.startsWith('worldbook') || key.startsWith('wb-bind')) return 'worldbook';
  if (key.startsWith('music')) return 'music';
  return 'system';
}

type KvBuckets = Record<ReturnType<typeof kvBucketOf>, StoreStat>;

/** 扫描 kv store：按键前缀分组归属（wx-*→微信、qq-*→QQ、mem-*→记忆库…） */
async function statKv(): Promise<KvBuckets> {
  const buckets: KvBuckets = {
    wx: { ...EMPTY_STAT },
    qq: { ...EMPTY_STAT },
    chat: { ...EMPTY_STAT },
    memory: { ...EMPTY_STAT },
    worldbook: { ...EMPTY_STAT },
    music: { ...EMPTY_STAT },
    system: { ...EMPTY_STAT },
  };
  try {
    const rows = await localDB.getAll('kv');
    for (const r of rows) {
      const b = buckets[kvBucketOf(r.key)];
      b.bytes += valueBytes(r.value) + strBytes(r.key);
    }
  } catch {
    // IndexedDB 不可用时全 0
  }
  return buckets;
}

/** 相对时间文案：今天 / 昨天 / N 天前 / YYYY/M/D（iOS「上次使用」同款） */
function lastUsedFromTs(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** iOS 风容量格式：字节 / KB / MB / GB 自适应 */
function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 字节';
  if (b < 1024) return `${Math.round(b)} 字节`;
  const kb = b / 1024;
  if (kb < 1024) return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface AppUsage {
  id: AppId;
  name: string;
  stat: StoreStat;
}

function StoragePage({ onBack }: { onBack: () => void }) {
  const recentApps = useUI((s) => s.recentApps);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [appUsage, setAppUsage] = useState<AppUsage[] | null>(null);
  const [systemStat, setSystemStat] = useState<StoreStat>({ ...EMPTY_STAT });
  const [sortDesc, setSortDesc] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState('');
  // 备份与恢复（Task 14：全量下载/整库恢复）
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupMsgOk, setBackupMsgOk] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; file: File } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const loadStats = useCallback(async () => {
    const est = await readStorageEstimate();
    setEstimate(est);
    try {
      const [photos, albums, recordings, music, notes, events, reminders, sessions, messages, callLogs, voicemails, contacts, alarms, cities, settingsRows, kv] =
        await Promise.all([
          statStore('photos'),
          statStore('albums'),
          statStore('recordings'),
          statStore('music'),
          statStore('notes', 'updatedAt'),
          statStore('events'),
          statStore('reminders'),
          statStore('chat-sessions'),
          statStore('chat-messages'),
          statStore('call-logs'),
          statStore('voicemails'),
          statStore('contacts'),
          statStore('alarms'),
          statStore('cities'),
          statStore('settings'),
          statKv(),
        ]);
      const byId: Partial<Record<AppId, StoreStat>> = {
        photos: mergeStats(photos, albums),
        recorder: recordings,
        music: mergeStats(music, kv.music),
        chat: mergeStats(sessions, messages, kv.chat),
        phone: mergeStats(callLogs, voicemails),
        contacts,
        notes,
        calendar: events,
        reminders,
        clock: alarms,
        weather: cities,
        settings: settingsRows,
        wechat: kv.wx,
        qq: kv.qq,
        memory: kv.memory,
        worldbook: kv.worldbook,
      };
      setAppUsage(APPS.map((a) => ({ id: a.id, name: a.name, stat: byId[a.id] ?? { ...EMPTY_STAT } })));
      setSystemStat(kv.system);
    } catch {
      setAppUsage(APPS.map((a) => ({ id: a.id, name: a.name, stat: { ...EMPTY_STAT } })));
      setSystemStat({ ...EMPTY_STAT });
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleExportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    setBackupMsg('');
    try {
      const r = await exportBackupToDownload();
      setBackupMsgOk(true);
      setBackupMsg(
        `已导出 ${r.records} 条记录（${r.stores} 个模块 · ${(r.bytes / 1024 / 1024).toFixed(2)} MB）—「${r.filename}」已开始下载`,
      );
    } catch (err) {
      setBackupMsgOk(false);
      setBackupMsg(err instanceof Error ? `导出失败：${err.message}` : '导出失败，请稍后重试');
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (backupBusy) return;
    setBackupBusy('import');
    setBackupMsg('');
    try {
      const r = await restoreBackup(file);
      setBackupMsgOk(true);
      const skip = r.skippedStores.length > 0 ? `（跳过 ${r.skippedStores.length} 个未知模块）` : '';
      setBackupMsg(`恢复完成：${r.records} 条记录 · ${r.stores} 个模块 · ${r.lsKeys} 项本地设置${skip} — 正在重启…`);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      setBackupMsgOk(false);
      setBackupMsg(err instanceof Error ? err.message : '恢复失败，请重试');
    } finally {
      setBackupBusy(null);
      setPendingRestore(null);
    }
  };

  const handleClean = async () => {
    if (cleaning) return;
    if (!window.confirm('确定清理全部媒体缓存吗？照片、录音和音乐将被删除。')) return;
    setCleaning(true);
    setCleanMsg('');
    try {
      await Promise.all([localDB.clear('photos'), localDB.clear('recordings'), localDB.clear('music')]);
      await loadStats();
      setCleanMsg('已清理媒体缓存，空间已释放');
      window.setTimeout(() => setCleanMsg(''), 3000);
    } catch {
      setCleanMsg('清理失败，请重试');
    } finally {
      setCleaning(false);
    }
  };

  const appsTotal = (appUsage ?? []).reduce((acc, r) => acc + r.stat.bytes, 0);
  const photosBytes = appUsage?.find((r) => r.id === 'photos')?.stat.bytes ?? 0;
  const appsBytes = appsTotal - photosBytes;
  /** 系统数据 = 浏览器总用量 − 已归属 App 的部分（杂项 kv / 缓存等真实余量）；
   *  estimate 不可用时退回 kv 未归属桶 */
  const systemBytes =
    estimate && estimate.usage > 0 ? Math.max(0, estimate.usage - appsTotal) : Math.max(systemStat.bytes, 0);
  const usedBytes = estimate && estimate.usage > 0 ? estimate.usage : appsTotal + systemBytes;
  const quotaBytes = estimate?.quota ?? 0;
  const freeBytes = quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) : 0;
  const segPct = (b: number) => `${((b / Math.max(usedBytes, 1)) * 100).toFixed(3)}%`;

  const sortedRows = useMemo(() => {
    const rows = [...(appUsage ?? [])];
    rows.sort((a, b) => (sortDesc ? b.stat.bytes - a.stat.bytes : a.stat.bytes - b.stat.bytes));
    return rows;
  }, [appUsage, sortDesc]);

  /** 「上次使用」：多任务里还留着的 = 今天；有数据取真实最新时间；只有无时间戳的存量数据 = 早前；否则从未使用 */
  const lastUsedText = (id: AppId, stat: StoreStat): string => {
    if (recentApps.includes(id)) return '今天';
    if (stat.lastAt != null) return lastUsedFromTs(stat.lastAt);
    if (stat.bytes > 0) return '早前';
    return '从未使用';
  };

  return (
    <DetailShell title="储存空间" onBack={onBack} gray>
      <GroupCard>
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1.5 text-[14px] font-semibold ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.12]">
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              iPhone
            </span>
            <span className="max-w-[62%] truncate rounded-full bg-white/60 px-3 py-1.5 text-[12.5px] tabular-nums text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.12]">
              {estimate === null
                ? '统计中…'
                : quotaBytes > 0
                  ? `已使用 ${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`
                  : `已使用 ${formatBytes(usedBytes)}`}
            </span>
          </div>

          <div className="mt-3.5 flex h-[18px] gap-[3px] overflow-hidden rounded-full bg-white/50 ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.1]">
            <div className="h-full" style={{ width: segPct(appsBytes), background: CAT_APPS_COLOR }} />
            <div className="h-full" style={{ width: segPct(photosBytes), background: CAT_PHOTOS_COLOR }} />
            <div className="h-full bg-[#C7C7CC] dark:bg-[#636366]" style={{ width: segPct(systemBytes) }} />
            {quotaBytes > 0 && (
              <div className="flex h-full min-w-0 flex-1 items-center justify-end pr-3 text-[11px] tabular-nums text-muted-foreground">
                可用 {formatBytes(freeBytes)}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <LegendChip color={CAT_APPS_COLOR} label="应用程序" />
            <LegendChip color={CAT_PHOTOS_COLOR} label="照片" />
            <LegendChip color="#C7C7CC" label="系统数据" />
          </div>
        </div>
      </GroupCard>

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setSortDesc((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full bg-white/60 px-3.5 py-1.5 text-[13px] ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.12]"
          style={{ color: TONE_BLUE }}
        >
          大小
          <ChevronsUpDown
            className={`h-3.5 w-3.5 transition-transform ${sortDesc ? '' : 'rotate-180'}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="mt-2.5">
        <GroupCard>
          {appUsage === null ? (
            <div className="flex h-[64px] items-center justify-center gap-2 text-[14px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              正在统计各 App 真实占用…
            </div>
          ) : (
            sortedRows.map((r) => (
              <div key={r.id} className="flex h-[64px] items-center gap-3 px-4">
                <div className="relative h-[46px] w-[46px] shrink-0 overflow-hidden rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] dark:ring-white/[0.1]">
                  <AppIconTile id={r.id} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] leading-tight">{r.name}</div>
                  <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    上次使用：{lastUsedText(r.id, r.stat)}
                  </div>
                </div>
                <span className="shrink-0 text-[14.5px] font-medium tabular-nums text-foreground/80">
                  {formatBytes(r.stat.bytes)}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              </div>
            ))
          )}
        </GroupCard>
      </div>

      {/* 备份与恢复（全量下载 / 整库恢复） */}
      <div className="mt-4">
        <GroupCard>
          <button
            type="button"
            data-testid="settings-backup-export"
            onClick={() => void handleExportBackup()}
            disabled={backupBusy !== null}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50 disabled:opacity-50"
          >
            {backupBusy === 'export' ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-5 w-5 shrink-0" style={{ color: TONE_GREEN }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-tight">
                {backupBusy === 'export' ? '正在导出…' : '导出全部数据'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                聊天 · 联系人 · 记忆 · 照片录音 · 设置 → 下载一个 JSON 备份文件
              </span>
            </span>
          </button>
          <button
            type="button"
            data-testid="settings-backup-import"
            onClick={() => restoreInputRef.current?.click()}
            disabled={backupBusy !== null}
            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/50 disabled:opacity-50"
          >
            {backupBusy === 'import' ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 shrink-0" style={{ color: TONE_ORANGE }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-tight">
                {backupBusy === 'import' ? '正在恢复…' : '导入备份'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                用备份文件整库恢复（覆盖当前数据），可跨设备 / 浏览器搬家
              </span>
            </span>
          </button>
        </GroupCard>
        <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-muted-foreground">
          备份含全部数据（API Key 会解密写入备份文件，请妥善保管）。清除浏览器数据、换浏览器或换设备前，先导出备份即可原样搬回。
        </p>

        {pendingRestore && (
          <div
            data-testid="settings-backup-confirm"
            className="mt-2.5 rounded-[16px] border px-4 py-3"
            style={{ borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.1)' }}
          >
            <p className="text-[13px] leading-relaxed" style={{ color: '#B45309' }}>
              将用「{pendingRestore.name}」覆盖当前全部数据（聊天/照片/设置等先清空再恢复），确定吗？
            </p>
            <div className="mt-2.5 flex gap-2.5">
              <button
                type="button"
                onClick={() => void handleRestoreFile(pendingRestore.file)}
                disabled={backupBusy !== null}
                className="h-9 flex-1 rounded-full text-[14px] font-medium text-white transition-all active:scale-[0.97] disabled:opacity-50"
                style={{ backgroundColor: IOS_RED }}
              >
                确认恢复
              </button>
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                disabled={backupBusy !== null}
                className="h-9 flex-1 rounded-full bg-white/70 text-[14px] font-medium ring-1 ring-white/80 backdrop-blur-xl transition-all active:scale-[0.97] disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12]"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {backupMsg && (
          <p
            data-testid="settings-backup-msg"
            className={`mt-2.5 px-1 text-[13px] leading-relaxed ${
              backupMsgOk ? 'text-emerald-600 dark:text-emerald-400' : ''
            }`}
            style={backupMsgOk ? undefined : { color: IOS_RED }}
          >
            {backupMsgOk ? '✅ ' : '❌ '}
            {backupMsg}
          </p>
        )}

        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setPendingRestore({ name: f.name, file: f });
          }}
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void handleClean()}
          disabled={cleaning}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/60 text-[15px] font-medium ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:ring-white/[0.12]"
          style={{ color: IOS_RED }}
        >
          {cleaning && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          清理媒体缓存
        </button>
      </div>

      {cleanMsg && (
        <p
          className={`mt-3 px-1 text-[13px] leading-relaxed ${
            cleanMsg.startsWith('已清理') ? 'text-emerald-600 dark:text-emerald-400' : ''
          }`}
          style={cleanMsg.startsWith('已清理') ? undefined : { color: IOS_RED }}
        >
          {cleanMsg}
        </p>
      )}
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        以上为各 App 在本机的真实数据占用（IndexedDB 实测）。清理将删除全部照片、录音与音乐文件，备忘录和日程不受影响。
      </p>
    </DetailShell>
  );
}

// ---------------- 壁纸 ----------------

function WallpaperPage({ onBack }: { onBack: () => void }) {
  const wallpaperPreset = useSettings((s) => s.wallpaperPreset);
  const customWallpaperUrl = useSettings((s) => s.customWallpaperUrl);
  const setWallpaperPreset = useSettings((s) => s.setWallpaperPreset);
  const setCustomWallpaper = useSettings((s) => s.setCustomWallpaper);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCustomWallpaper(file);
    e.target.value = '';
  };

  return (
    <DetailShell title="壁纸" onBack={onBack} gray>
      <div className="flex flex-col gap-6">
        {customWallpaperUrl && (
          <div>
            <div className="relative h-[140px] w-full overflow-hidden rounded-[14px] shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-white/70 dark:ring-white/[0.09]">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${customWallpaperUrl})` }}
              />
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                <Check className="h-4 w-4 text-foreground" strokeWidth={3} />
              </span>
              <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[12px] text-white">
                自定义壁纸
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCustomWallpaper(null)}
              className="mt-2.5 text-[13px] transition-opacity active:opacity-50"
              style={{ color: IOS_RED }}
            >
              移除自定义壁纸
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {WALLPAPER_PRESETS.map((p) => {
            const selected = !customWallpaperUrl && wallpaperPreset === p.id;
            return (
              <button key={p.id} type="button" onClick={() => setWallpaperPreset(p.id)} className="text-left">
                <div
                  className="relative h-[120px] overflow-hidden rounded-[14px] shadow-[0_8px_28px_rgba(17,24,39,0.08)] ring-1 ring-white/70 transition-transform active:scale-[0.98] dark:ring-white/[0.09]"
                  style={{ background: p.css }}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-md">
                      <Check className="h-4 w-4 text-foreground" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[14px]">{p.name}</div>
              </button>
            );
          })}
        </div>

        <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-white/60 text-[15px] font-medium shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]">
          <Upload className="h-4 w-4" />
          上传自定义壁纸
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>

        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          自定义壁纸保存在本机 IndexedDB，不会上传。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- API 设置 ----------------

function ApiPage({ onBack }: { onBack: () => void }) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiPresets = useSettings((s) => s.apiPresets);
  const updateApiConfig = useSettings((s) => s.updateApiConfig);
  const setApiPresets = useSettings((s) => s.setApiPresets);

  const [showKey, setShowKey] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [testOk, setTestOk] = useState<{ latencyMs: number; model: string; viaDirect?: boolean } | null>(null);
  const [testError, setTestError] = useState('');
  const [testConnected, setTestConnected] = useState(false);
  const [testUrl, setTestUrl] = useState('');

  const [maxText, setMaxText] = useState(() => String(apiConfig.maxTokens));

  const clearTestResult = () => {
    setTestOk(null);
    setTestError('');
    setTestConnected(false);
    setTestUrl('');
  };

  const applyBuiltin = (p: (typeof BUILTIN_API_PRESETS)[number]) => {
    updateApiConfig({ baseUrl: p.baseUrl, model: p.model });
    clearTestResult();
  };

  const applyUserPreset = (p: ApiPreset) => {
    updateApiConfig(p.config);
    setMaxText(String(p.config.maxTokens));
    clearTestResult();
  };

  const deletePreset = (id: string) => {
    setApiPresets(apiPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setApiPresets([...apiPresets, { id: genId(), name, config: { ...apiConfig } }]);
    setPresetName('');
    setSaveOpen(false);
  };

  const fetchModels = async () => {
    if (!apiConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; url?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(apiConfig.baseUrl))) {
        const direct = await directFetchModels(apiConfig.baseUrl, apiConfig.apiKey);
        if (direct.error) {
          const serverMsg = typeof data?.error === 'string' ? data.error : '';
          setModelsError(
            serverMsg && !isPrivateApiUrl(apiConfig.baseUrl)
              ? `${serverMsg}；浏览器直连也不可用：${direct.error}`
              : direct.error
          );
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(direct.hint);
          return;
        }
        setModels(direct.models);
        setModelQuery('');
        setModelPanelOpen(true);
        return;
      }
      if (!res.ok || !data || data.error) {
        const base = data?.error ?? '拉取模型失败，请稍后重试';
        setModelsError(data?.url ? `${base}（实际请求：${data.url}）` : base);
      } else if (data.hint && (data.models ?? []).length === 0) {
        // 反代等无模型列表接口：优雅降级，提示手动输入
        setModelsHint(data.hint);
      } else {
        setModels(data.models ?? []);
        setModelQuery('');
        setModelPanelOpen(true);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const runTest = async () => {
    if (!apiConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    setTestLoading(true);
    clearTestResult();
    try {
      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiConfig.baseUrl,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          temperature: apiConfig.temperature,
          maxTokens: apiConfig.maxTokens,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            latencyMs?: number;
            model?: string;
            error?: string;
            connected?: boolean;
            url?: string;
            directOnly?: boolean;
          }
        | null;
      setTestUrl(typeof data?.url === 'string' ? data.url : '');
      if (data?.ok) {
        setTestOk({ latencyMs: data.latencyMs ?? 0, model: data.model ?? apiConfig.model });
        return;
      }
      // 私有地址（云端服务器必然不可达）或服务器明确建议直连（地区限制/网络不可达/限流）：
      // 改用浏览器直连兑底；服务器返回非 JSON（网关错误页等 data=null）时私有地址同样兑底，
      // 避免误报「测试失败」
      const serverError = data?.error ?? '测试失败，请稍后重试';
      if (data?.directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
        const direct = await directTest(apiConfig);
        if (direct.ok) {
          setTestOk({ latencyMs: direct.latencyMs, model: direct.model, viaDirect: true });
          return;
        }
        setTestUrl(apiConfig.baseUrl);
        setTestError(
          isPrivateApiUrl(apiConfig.baseUrl)
            ? direct.error ?? '浏览器直连失败'
            : `${serverError}；浏览器直连也不可用：${direct.error ?? '请确认该 API 允许跨域访问（CORS）'}`
        );
        return;
      }
      setTestError(serverError);
      setTestConnected(Boolean(data?.connected));
    } catch {
      setTestError('无法连接到服务器');
    } finally {
      setTestLoading(false);
    }
  };

  const handleMaxChange = (v: string) => {
    setMaxText(v);
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n >= 64) updateApiConfig({ maxTokens: n });
  };

  const handleMaxBlur = () => {
    const n = Number.parseInt(maxText, 10);
    if (!Number.isFinite(n) || n < 64) {
      setMaxText(String(apiConfig.maxTokens));
    } else {
      setMaxText(String(n));
      updateApiConfig({ maxTokens: n });
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  return (
    <DetailShell title="API 设置" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预设区 */}
        <section>
          <SectionLabel icon={Layers} tone={TONE_CYAN}>预设</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_API_PRESETS.map((p) => {
              const active = apiConfig.baseUrl === p.baseUrl;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyBuiltin(p)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            {apiPresets.map((p) => {
              const active =
                apiConfig.baseUrl === p.config.baseUrl && apiConfig.model === p.config.model;
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1]'
                  }`}
                >
                  <button type="button" onClick={() => applyUserPreset(p)} className="max-w-[120px] truncate">
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    aria-label={`删除预设 ${p.name}`}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-white/55 px-3.5 py-1.5 text-[13px] text-muted-foreground ring-1 ring-black/[0.06] backdrop-blur-xl transition-all hover:bg-white/80 active:scale-[0.97] dark:bg-white/[0.07] dark:ring-white/[0.1] dark:hover:bg-white/[0.14]"
            >
              <Plus className="h-3.5 w-3.5" />
              存为预设
            </button>
          </div>
          {saveOpen && (
            <div className="mt-3 flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="预设名称，如 我的GPT"
                autoFocus
                className="h-10 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={!presetName.trim()}
                className="h-10 shrink-0 rounded-[14px] bg-white/60 px-5 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-40 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                保存
              </button>
            </div>
          )}
        </section>

        {/* 配置表单 */}
        <section>
          <SectionLabel
            icon={Wrench}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={apiConfig.baseUrl}
                onChange={(e) => updateApiConfig({ baseUrl: e.target.value })}
                placeholder={DEFAULT_API_CONFIG.baseUrl}
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiConfig.apiKey}
                  onChange={(e) => updateApiConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                    apiConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {/* 清空 Key（仅在有内容时显示） */}
                {apiConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      updateApiConfig({ apiKey: '' });
                      clearTestResult();
                    }}
                    aria-label="清空 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 模型 */}
            <div className="relative">
              <FieldLabel>模型</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={apiConfig.model}
                  onChange={(e) => updateApiConfig({ model: e.target.value })}
                  placeholder={DEFAULT_API_CONFIG.model}
                  className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  拉取模型
                </button>
              </div>
              {modelsError && (
                <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <div className="mt-1.5 rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                  {modelsHint}
                </div>
              )}

              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85">
                    <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 32k / turbo"
                        autoFocus
                        className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                          没有匹配的模型
                        </div>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              updateApiConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {apiConfig.model === m && (
                              <Check
                                className="h-4 w-4 shrink-0 text-foreground"
                                strokeWidth={2.5}
                              />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 温度 */}
            <div>
              <div className="mb-2.5 text-[13px] font-medium text-muted-foreground">温度</div>
              <div className="flex items-center gap-3">
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  value={[apiConfig.temperature]}
                  onValueChange={(v) => updateApiConfig({ temperature: v[0] ?? 0.7 })}
                  className="flex-1"
                  aria-label="温度"
                />
                <span className="min-w-[48px] rounded-full bg-white/65 px-2.5 py-1 text-center text-[13px] tabular-nums shadow-sm ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.1] dark:ring-white/[0.1]">
                  {apiConfig.temperature.toFixed(1)}
                </span>
              </div>
            </div>

            {/* 最大 Token */}
            <div>
              <FieldLabel>最大 Token</FieldLabel>
              <Input
                type="number"
                min={64}
                step={64}
                value={maxText}
                onChange={(e) => handleMaxChange(e.target.value)}
                onBlur={handleMaxBlur}
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* 未配置 Key 提示 */}
            {!apiConfig.apiKey.trim() && (
              <div className="rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                未配置 API Key 时，AI 助手无法回复；请填写 OpenAI 兼容接口地址与 API Key 后再聊天。
              </div>
            )}
          </div>
        </section>

        {/* 测试连接 */}
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testLoading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-white/60 text-[15px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
          >
            {testLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            测试连接
          </button>
          {testOk && (
            <div className="rounded-[16px] border border-emerald-500/30 bg-emerald-400/15 px-4 py-3 text-[13px] leading-relaxed text-emerald-700 backdrop-blur-xl dark:bg-emerald-300/[0.08] dark:text-emerald-300">
              ✅ 连接成功{testOk.viaDirect ? '（浏览器直连）' : ''} · 延迟 {testOk.latencyMs}ms · 模型 {testOk.model}
            </div>
          )}
          {testError && (
            <div
              className="rounded-[12px] border px-4 py-3 text-[13px] leading-relaxed"
              style={
                testConnected
                  ? {
                      borderColor: 'rgba(245,158,11,0.35)',
                      backgroundColor: 'rgba(245,158,11,0.1)',
                      color: '#B45309',
                    }
                  : { borderColor: 'rgba(255,69,58,0.3)', backgroundColor: 'rgba(255,69,58,0.1)', color: IOS_RED }
              }
            >
              {testConnected ? '⚠️ ' : '❌ '}
              {testError}
              {testConnected && (
                <span className="mt-1 block text-[12px] opacity-80">
                  接口本身可达，问题出在配置而不是连接；按提示修正后即可聊天。
                </span>
              )}
            </div>
          )}
          {testUrl && (
            <div className="break-all px-1 text-[11px] leading-relaxed text-muted-foreground/80">
              实际请求：{testUrl}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            预设保存后下次打开网站依然可用（数据保存在本机 IndexedDB）。
          </p>
        </section>
      </div>
    </DetailShell>
  );
}

// ---------------- 识图模型设置 ----------------

/**
 * 识图模型配置页（与「API 配置」并列、互相独立）：
 * 预设（内置 4 家 + 用户自存）/ API 地址 / API Key / 模型名（可拉取模型列表）/ 存为预设 / 测试（发送内置测试图，走与聊天完全相同的识图管线验证连通与效果）；
 * 更改自动保存、聊天发送时现场读取（保存后自动生效，无需重启）；使用说明放页尾。
 * 未配置时聊天发图不触发识图，文字聊天完全不受影响。
 */
function VisionPage({ onBack }: { onBack: () => void }) {
  const visionConfig = useSettings((s) => s.visionConfig);
  const visionPresets = useSettings((s) => s.visionPresets);
  const updateVisionConfig = useSettings((s) => s.updateVisionConfig);
  const setVisionPresets = useSettings((s) => s.setVisionPresets);

  const [showKey, setShowKey] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  // 识图测试（内置测试图 → describeImages 同款管线）
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState('');

  /** 配置变更统一入口：自动保存 + 清掉过期的测试结果 */
  const patchVisionConfig = (patch: Partial<VisionConfig>) => {
    updateVisionConfig(patch);
    setTestError('');
    setTestResult('');
  };

  const applyBuiltin = (p: (typeof BUILTIN_VISION_PRESETS)[number]) => {
    patchVisionConfig({ baseUrl: p.baseUrl, model: p.model });
    setModelsError('');
    setModelsHint('');
  };

  const applyUserPreset = (p: VisionPreset) => {
    patchVisionConfig(p.config);
    setModelsError('');
    setModelsHint('');
  };

  const deletePreset = (id: string) => {
    setVisionPresets(visionPresets.filter((p) => p.id !== id));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setVisionPresets([...visionPresets, { id: genId(), name, config: { ...visionConfig } }]);
    setPresetName('');
    setSaveOpen(false);
  };

  const fetchModels = async () => {
    if (!visionConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: visionConfig.baseUrl, apiKey: visionConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(visionConfig.baseUrl))) {
        const direct = await directFetchModels(visionConfig.baseUrl, visionConfig.apiKey);
        if (direct.error) {
          setModelsError(direct.error);
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(direct.hint);
          return;
        }
        setModels(direct.models);
        setModelQuery('');
        setModelPanelOpen(true);
        return;
      }
      if (!res.ok || !data || data.error) {
        setModelsError(data?.error ?? '拉取模型失败，请稍后重试');
      } else if (data.hint && (data.models ?? []).length === 0) {
        // 反代等无模型列表接口：优雅降级，提示手动输入
        setModelsHint(data.hint);
      } else {
        setModels(data.models ?? []);
        setModelQuery('');
        setModelPanelOpen(true);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  /** 程序化画一张内容可识别的测试图（户外小屋场景），用于验证识图模型真的「看懂」了图片 */
  const buildTestImage = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const sky = ctx.createLinearGradient(0, 0, 0, 240);
    sky.addColorStop(0, '#6FBBF5');
    sky.addColorStop(1, '#D8F0FF');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#FFD60A';
    ctx.beginPath();
    ctx.arc(262, 48, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#79C86E';
    ctx.fillRect(0, 158, 320, 82);
    ctx.fillStyle = '#F4F4F8';
    ctx.fillRect(56, 112, 92, 62);
    ctx.fillStyle = '#FF9F0A';
    ctx.beginPath();
    ctx.moveTo(46, 114);
    ctx.lineTo(102, 68);
    ctx.lineTo(158, 114);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8A6248';
    ctx.fillRect(90, 136, 26, 38);
    ctx.fillStyle = '#1C1C1E';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('测试图片', 176, 196);
    ctx.font = '13px sans-serif';
    ctx.fillText('VISION TEST', 177, 216);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  /** 连接测试：走与聊天发图完全相同的 describeImages 管线，成功展示描述、失败展示错误 */
  const runVisionTest = async () => {
    if (!visionConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    if (!visionConfig.model.trim()) {
      setTestError('请先填写模型名');
      return;
    }
    const testImage = buildTestImage();
    if (!testImage) {
      setTestError('无法生成测试图片，请直接在聊天里发图验证');
      return;
    }
    setTesting(true);
    setTestError('');
    setTestResult('');
    try {
      const desc = await describeImages(visionConfig, {
        images: [testImage],
        text: '连接测试：请用一句话描述这张图片',
      });
      if (desc) {
        setTestResult(desc);
      } else {
        setTestError('识图模型没有返回描述内容，请确认模型是否支持图片输入');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试失败，请稍后重试');
    } finally {
      setTesting(false);
    }
  };

  return (
    <DetailShell title="识图模型" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预设区 */}
        <section>
          <SectionLabel icon={ScanEye} tone={TONE_CYAN}>预设</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {BUILTIN_VISION_PRESETS.map((p) => {
              const active = visionConfig.baseUrl === p.baseUrl;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyBuiltin(p)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
            {visionPresets.map((p) => {
              const active =
                visionConfig.baseUrl === p.config.baseUrl && visionConfig.model === p.config.model;
              return (
                <span
                  key={p.id}
                  className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-all active:scale-[0.97] ${
                    active
                      ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                      : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1]'
                  }`}
                >
                  <button type="button" onClick={() => applyUserPreset(p)} className="max-w-[120px] truncate">
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(p.id)}
                    aria-label={`删除识图预设 ${p.name}`}
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-white/55 px-3.5 py-1.5 text-[13px] text-muted-foreground ring-1 ring-black/[0.06] backdrop-blur-xl transition-all hover:bg-white/80 active:scale-[0.97] dark:bg-white/[0.07] dark:ring-white/[0.1] dark:hover:bg-white/[0.14]"
            >
              <Plus className="h-3.5 w-3.5" />
              存为预设
            </button>
          </div>
          {saveOpen && (
            <div className="mt-3 flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="预设名称，如 本地视觉模型"
                autoFocus
                className="h-10 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={!presetName.trim()}
                className="h-10 shrink-0 rounded-[14px] bg-white/60 px-5 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-40 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                保存
              </button>
            </div>
          )}
        </section>

        {/* 配置表单 */}
        <section>
          <SectionLabel
            icon={Wrench}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* API 地址 */}
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={visionConfig.baseUrl}
                onChange={(e) => patchVisionConfig({ baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1/chat/completions"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* API Key */}
            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={visionConfig.apiKey}
                  onChange={(e) => patchVisionConfig({ apiKey: e.target.value })}
                  placeholder="sk-...（免 Key 接口可留空）"
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                    visionConfig.apiKey ? 'pr-16' : 'pr-10'
                  }`}
                />
                {visionConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => updateVisionConfig({ apiKey: '' })}
                    aria-label="清空识图 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏识图 Key' : '显示识图 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 模型名 */}
            <div className="relative">
              <FieldLabel>模型名</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={visionConfig.model}
                  onChange={(e) => patchVisionConfig({ model: e.target.value })}
                  placeholder="如 gpt-4o-mini / qwen-vl-plus / glm-4v-flash"
                  className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  拉取模型
                </button>
              </div>
              {modelsError && (
                <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <div className="mt-1.5 rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                  {modelsHint}
                </div>
              )}

              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85">
                    <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 vl / vision"
                        autoFocus
                        className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                          没有匹配的模型
                        </div>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              patchVisionConfig({ model: m });
                              setModelPanelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="truncate text-[14px]">{m}</span>
                            {visionConfig.model === m && (
                              <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 未配置提示（精简） */}
            {!visionConfig.baseUrl.trim() && (
              <div className="rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                未配置：聊天发图不会触发识图（不影响文字聊天）。
              </div>
            )}

            {/* 识图测试：与聊天发图同一条管线（/api/vision 代理 → 私有地址浏览器直连兜底） */}
            <div>
              <button
                type="button"
                onClick={() => void runVisionTest()}
                disabled={testing}
                data-testid="vision-test-btn"
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[13px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanEye className="h-3.5 w-3.5" />}
                {testing ? '正在识图…' : '测试识图'}
              </button>
              {testError && (
                <div
                  data-testid="vision-test-error"
                  className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-relaxed"
                  style={{ color: IOS_RED }}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{testError}</span>
                </div>
              )}
              {testResult && (
                <div
                  data-testid="vision-test-result"
                  className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-relaxed text-emerald-600 dark:text-emerald-400/90"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                  <span>{testResult}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 使用说明（精简为一段） */}
        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          识图模型只负责「看图」：发图先转文字描述再交给聊天模型；图片仅传给你自己配置的接口，预设存本机。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- 图像生成（生图） ----------------

/**
 * 图像生成配置页（浅灰底 iOS 设置子页风）：与识图模型页（VisionPage）同构。
 * - 「启用自动生图」总开关：关闭时 AI 不会自动生图（手动触发不受影响），配置始终可见可先填；
 * - 请求方式：服务端转发（/api/imggen，免跨域，推荐）或浏览器直连（需接口允许 CORS）；
 * - 连接配置：OpenAI 兼容基地址 + Key（密文持久化）+ 模型名（可拉取列表选择）+ 尺寸/质量/补充提示词；
 * - 预设管理：内置「OpenAI 官方」（列表第一项、不可删除）+ 用户预设（应用 / 更新 / 删除）；
 * - 测试生图：按当前配置真实生成一张，验证连通性（成功展示图片，失败展示上游错误）；
 * - 形象锁定（锁脸）区（FaceLockSection，页尾）：按角色上传生图参考图 + 外貌描述兜底
 *   （原三端聊天设置里的形象锁定页迁移至此，按 contactId 隔离，数据与三端聊天共用）。
 * 所有变更经 updateImgGenConfig 即时保存，下一次生图现场读取 → 自动生效，无需重启。
 */
function ImageGenPage({ onBack }: { onBack: () => void }) {
  const imgGenConfig = useSettings((s) => s.imgGenConfig);
  const imgGenPresets = useSettings((s) => s.imgGenPresets);
  const updateImgGenConfig = useSettings((s) => s.updateImgGenConfig);
  const setImgGenPresets = useSettings((s) => s.setImgGenPresets);

  // Tab：连接配置 / 形象锁定（预设区下方，用户需求）
  const [imgTab, setImgTab] = useState<'conn' | 'face'>('conn');

  const [showKey, setShowKey] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const [models, setModels] = useState<string[]>([]);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');

  // 测试生图（真实生成一张：成功展示图片、失败展示错误）
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testSrc, setTestSrc] = useState('');

  /** 配置变更统一入口：自动保存 + 清掉过期的测试结果 */
  const patchImgGenConfig = (patch: Partial<ImgGenConfig>) => {
    updateImgGenConfig(patch);
    setTestError('');
    setTestSrc('');
  };

  // 自动开启总开关（用户需求「配置了以后开关自动打开，不需要手动打开」）：
  // 监听配置完整性（地址+模型名都已填），只在「不完整 → 完整」的临界沿自动置 enabled=true；
  // 已完整后用户手动关闭不会被强制重开（无临界沿），保留手动控制权
  const cfgComplete = Boolean(imgGenConfig.baseUrl.trim() && imgGenConfig.model.trim());
  const wasCompleteRef = useRef(cfgComplete);
  useEffect(() => {
    const prev = wasCompleteRef.current;
    wasCompleteRef.current = cfgComplete;
    if (cfgComplete && !prev && !useSettings.getState().imgGenConfig.enabled) {
      updateImgGenConfig({ enabled: true });
    }
  }, [cfgComplete, updateImgGenConfig]);

  // —— 预设管理 ——
  const allPresets: ImgGenPreset[] = [BUILTIN_IMGGEN_PRESET, ...imgGenPresets];

  /** 应用预设：覆盖连接相关字段；不改动「启用自动生图」开关（开关是全局行为，不属于某家服务商） */
  const applyPreset = (p: ImgGenPreset) => {
    patchImgGenConfig({
      mode: p.config.mode,
      baseUrl: p.config.baseUrl,
      apiKey: p.config.apiKey,
      model: p.config.model,
      size: p.config.size,
      quality: p.config.quality,
      extraPrompt: p.config.extraPrompt,
    });
    setModelsError('');
    setModelsHint('');
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    setImgGenPresets([...imgGenPresets, { id: genId(), name, config: { ...imgGenConfig } }]);
    setPresetName('');
    setSaveOpen(false);
  };

  /** 把当前配置写回指定预设 */
  const updatePreset = (id: string) => {
    setImgGenPresets(imgGenPresets.map((p) => (p.id === id ? { ...p, config: { ...imgGenConfig } } : p)));
  };

  const deletePreset = (id: string) => {
    setImgGenPresets(imgGenPresets.filter((p) => p.id !== id));
  };

  // —— 拉取模型列表（与识图/语音页同款：服务端拉取，内网地址/不可达时浏览器直连兜底） ——
  const fetchModels = async () => {
    if (!imgGenConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: imgGenConfig.baseUrl, apiKey: imgGenConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(imgGenConfig.baseUrl))) {
        const direct = await directFetchModels(imgGenConfig.baseUrl, imgGenConfig.apiKey);
        if (direct.error) {
          setModelsError(direct.error);
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(direct.hint);
          return;
        }
        setModels(direct.models);
        setModelQuery('');
        setModelPanelOpen(true);
        return;
      }
      if (!res.ok || !data || data.error) {
        setModelsError(data?.error ?? '拉取模型失败，请稍后重试');
      } else if (data.hint && (data.models ?? []).length === 0) {
        // 反代等无模型列表接口：优雅降级，提示手动输入
        setModelsHint(data.hint);
      } else {
        setModels(data.models ?? []);
        setModelQuery('');
        setModelPanelOpen(true);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  const q = modelQuery.trim().toLowerCase();
  const filteredModels = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;

  /** 测试生图：按当前配置真实生成一张（proxy 走 /api/imggen 转发；direct 浏览器直连 /images/generations） */
  const runImgGenTest = async () => {
    if (!imgGenConfig.baseUrl.trim()) {
      setTestError('请先填写 API 地址');
      return;
    }
    if (!imgGenConfig.apiKey.trim()) {
      setTestError('请先填写 API Key');
      return;
    }
    if (!imgGenConfig.model.trim()) {
      setTestError('请先填写模型名');
      return;
    }
    const basePrompt =
      'test prompt: a young woman taking a selfie in a warm cafe, natural light, realistic photo';
    const extra = imgGenConfig.extraPrompt.trim();
    const prompt = extra ? `${basePrompt}，${extra}` : basePrompt;
    const size = imgGenConfig.size.trim() || '1024x1024';
    const quality = imgGenConfig.quality.trim();
    setTesting(true);
    setTestError('');
    setTestSrc('');
    try {
      if (imgGenConfig.mode === 'direct') {
        // 浏览器直连：需接口允许跨域（CORS）
        const eps = imggenEndpoints(imgGenConfig.baseUrl);
        let lastErr = '生图失败';
        for (const ep of eps.generations) {
          try {
            const res = await fetch(ep, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imgGenConfig.apiKey}` },
              body: JSON.stringify({
                model: imgGenConfig.model,
                prompt,
                n: 1,
                ...(size && size !== 'auto' ? { size } : {}),
                ...(quality && quality !== 'auto' ? { quality } : {}),
              }),
            });
            const payload = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
              lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
              continue;
            }
            const src = await pickImageFromResponse(payload);
            if (src) {
              setTestSrc(src);
              return;
            }
            lastErr = '接口没有返回图片';
          } catch (e) {
            lastErr = e instanceof Error ? e.message : '网络错误（检查接口是否允许跨域 CORS）';
          }
        }
        throw new Error(lastErr);
      }
      // 服务端转发：/api/imggen
      const res = await fetch('/api/imggen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: imgGenConfig.baseUrl,
          apiKey: imgGenConfig.apiKey,
          model: imgGenConfig.model,
          prompt,
          size,
          quality,
        }),
      });
      const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
      if (!res.ok || !data?.src) {
        throw new Error(extractImgGenError(data, data?.error || `生图接口错误（${res.status}）`));
      }
      setTestSrc(data.src);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试失败，请稍后重试');
    } finally {
      setTesting(false);
    }
  };

  return (
    <DetailShell title="图像生成" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 启用自动生图（总开关） */}
        <section>
          <SectionLabel icon={ImagePlus} tone={TONE_GREEN}>自动生图</SectionLabel>
          <GrayCard className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">启用自动生图</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  开启后 AI 回复里的照片标签会自动生成真实照片（支持锁脸保持人物一致）
                </p>
              </div>
              <Switch
                checked={imgGenConfig.enabled}
                onCheckedChange={(v) => patchImgGenConfig({ enabled: v })}
                aria-label="启用自动生图"
                data-testid="imggen-enabled"
                className="data-[state=checked]:bg-[#34C759]"
              />
            </div>
            {imgGenConfig.enabled ? null : (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                关闭后 AI 不会自动生成照片，仍可在聊天里手动触发「生成照片」；下方配置请先填好（手动触发生图也依赖这些配置）。
              </p>
            )}
          </GrayCard>
        </section>

        {/* 预设区 */}
            <section>
              <SectionLabel icon={Layers} tone={TONE_CYAN}>预设</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {allPresets.map((p) => {
                  const isBuiltin = p.id === BUILTIN_IMGGEN_PRESET.id;
                  const active =
                    imgGenConfig.baseUrl === p.config.baseUrl && imgGenConfig.model === p.config.model;
                  return (
                    <span
                      key={p.id}
                      className={`flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-all active:scale-[0.97] ${
                        active
                          ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                          : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1]'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`imggen-preset-apply-${p.id}`}
                        onClick={() => applyPreset(p)}
                        className="max-w-[120px] truncate"
                      >
                        {p.name}
                      </button>
                      {!isBuiltin && (
                        <>
                          <button
                            type="button"
                            data-testid={`imggen-preset-update-${p.id}`}
                            onClick={() => updatePreset(p.id)}
                            aria-label={`用当前配置更新预设 ${p.name}`}
                            className="opacity-60 transition-opacity hover:opacity-100"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            data-testid={`imggen-preset-del-${p.id}`}
                            onClick={() => deletePreset(p.id)}
                            aria-label={`删除生图预设 ${p.name}`}
                            className="opacity-60 transition-opacity hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </span>
                  );
                })}
                <button
                  type="button"
                  data-testid="imggen-preset-save"
                  onClick={() => setSaveOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-full bg-white/55 px-3.5 py-1.5 text-[13px] text-muted-foreground ring-1 ring-black/[0.06] backdrop-blur-xl transition-all hover:bg-white/80 active:scale-[0.97] dark:bg-white/[0.07] dark:ring-white/[0.1] dark:hover:bg-white/[0.14]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  存为预设
                </button>
              </div>
              {saveOpen && (
                <div className="mt-3 flex gap-2">
                  <Input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="预设名称，如 本地生图模型"
                    autoFocus
                    className="h-10 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') savePreset();
                    }}
                  />
                  <button
                    type="button"
                    onClick={savePreset}
                    disabled={!presetName.trim()}
                    className="h-10 shrink-0 rounded-[14px] bg-white/60 px-5 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-40 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                  >
                    保存
                  </button>
                </div>
              )}
            </section>

            {/* Tab（用户需求）：连接配置 / 形象锁定（预设下方、连接配置上方，iOS 分段控件风） */}
            <div
              className="flex rounded-[12px] bg-white/40 p-1 ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.08]"
              role="tablist"
              aria-label="图像生成设置分区"
            >
              <button
                type="button"
                role="tab"
                aria-selected={imgTab === 'conn'}
                data-testid="imggen-tab-conn"
                onClick={() => setImgTab('conn')}
                className={`h-9 flex-1 rounded-[9px] text-[13.5px] font-medium transition-all ${
                  imgTab === 'conn'
                    ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                连接配置
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={imgTab === 'face'}
                data-testid="imggen-tab-face"
                onClick={() => setImgTab('face')}
                className={`h-9 flex-1 rounded-[9px] text-[13.5px] font-medium transition-all ${
                  imgTab === 'face'
                    ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                形象锁定
              </button>
            </div>

            {/* 配置表单（连接配置 tab） */}
            {imgTab === 'conn' && (
            <section>
              <SectionLabel
                icon={Wrench}
                tone={TONE_BLUE}
                right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
              >
                连接配置
              </SectionLabel>
              <GrayCard className="flex flex-col gap-4">
                {/* 请求方式（iOS 分段控件风） */}
                <div>
                  <FieldLabel>请求方式</FieldLabel>
                  <div className="flex rounded-[12px] bg-white/40 p-1 ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.05] dark:ring-white/[0.08]" role="group" aria-label="请求方式">
                    <button
                      type="button"
                      data-testid="imggen-mode-proxy"
                      onClick={() => patchImgGenConfig({ mode: 'proxy' })}
                      className={`h-8 flex-1 rounded-[9px] text-[13px] font-medium transition-all ${
                        imgGenConfig.mode === 'proxy'
                          ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      服务端转发（推荐）
                    </button>
                    <button
                      type="button"
                      data-testid="imggen-mode-direct"
                      onClick={() => patchImgGenConfig({ mode: 'direct' })}
                      className={`h-8 flex-1 rounded-[9px] text-[13px] font-medium transition-all ${
                        imgGenConfig.mode === 'direct'
                          ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.16]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      浏览器直连
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground/70">
                    {imgGenConfig.mode === 'direct'
                      ? '浏览器直接请求生图接口，需接口允许跨域（CORS）。'
                      : '由本站服务器转发生图请求，免跨域、Key 不暴露给页面。'}
                  </p>
                </div>

                {/* API 地址 */}
                <div>
                  <FieldLabel>API 地址</FieldLabel>
                  <Input
                    value={imgGenConfig.baseUrl}
                    onChange={(e) => patchImgGenConfig({ baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-baseurl"
                  />
                </div>

                {/* API Key */}
                <div>
                  <FieldLabel>API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={imgGenConfig.apiKey}
                      onChange={(e) => patchImgGenConfig({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      autoComplete="off"
                      className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${
                        imgGenConfig.apiKey ? 'pr-16' : 'pr-10'
                      }`}
                      data-testid="imggen-apikey"
                    />
                    {imgGenConfig.apiKey && (
                      <button
                        type="button"
                        onClick={() => updateImgGenConfig({ apiKey: '' })}
                        aria-label="清空生图 API Key"
                        className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? '隐藏生图 Key' : '显示生图 Key'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* 模型名 + 拉取 */}
                <div className="relative">
                  <FieldLabel>模型名</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      value={imgGenConfig.model}
                      onChange={(e) => patchImgGenConfig({ model: e.target.value })}
                      placeholder="如 gpt-image-2 / flux-pro"
                      className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                      data-testid="imggen-model"
                    />
                    <button
                      type="button"
                      data-testid="imggen-fetch-models"
                      onClick={() => void fetchModels()}
                      disabled={fetchingModels}
                      className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                    >
                      {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      拉取模型
                    </button>
                  </div>
                  {modelsError && (
                    <p className="mt-1.5 text-[12px]" style={{ color: IOS_RED }}>
                      {modelsError}
                    </p>
                  )}
                  {modelsHint && (
                    <div className="mt-1.5 rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                      {modelsHint}
                    </div>
                  )}

                  {modelPanelOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setModelPanelOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85">
                        <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                          <Input
                            value={modelQuery}
                            onChange={(e) => setModelQuery(e.target.value)}
                            placeholder="搜索模型，如 image / flux"
                            autoFocus
                            className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                          />
                        </div>
                        <div className="thin-scrollbar max-h-64 overflow-y-auto">
                          {filteredModels.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                              没有匹配的模型
                            </div>
                          ) : (
                            filteredModels.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  patchImgGenConfig({ model: m });
                                  setModelPanelOpen(false);
                                }}
                                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                              >
                                <span className="truncate text-[14px]">{m}</span>
                                {imgGenConfig.model === m && (
                                  <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 尺寸 */}
                <div>
                  <FieldLabel>尺寸</FieldLabel>
                  <Input
                    value={imgGenConfig.size}
                    onChange={(e) => patchImgGenConfig({ size: e.target.value })}
                    placeholder="1024x1024 / auto"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-size"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['1024x1024', '1024x1536', '1536x1024', 'auto'].map((sv) => (
                      <button
                        key={sv}
                        type="button"
                        onClick={() => patchImgGenConfig({ size: sv })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          imgGenConfig.size.trim() === sv
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`}
                      >
                        {sv}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 质量 */}
                <div>
                  <FieldLabel>质量</FieldLabel>
                  <Input
                    value={imgGenConfig.quality}
                    onChange={(e) => patchImgGenConfig({ quality: e.target.value })}
                    placeholder="auto / low / medium / high"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-quality"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['auto', 'low', 'medium', 'high'].map((qv) => (
                      <button
                        key={qv}
                        type="button"
                        onClick={() => patchImgGenConfig({ quality: qv })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          imgGenConfig.quality.trim() === qv
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`}
                      >
                        {qv}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 补充提示词 */}
                <div>
                  <FieldLabel>补充提示词（拼在每个生图提示词末尾的风格要求）</FieldLabel>
                  <Textarea
                    value={imgGenConfig.extraPrompt}
                    onChange={(e) => patchImgGenConfig({ extraPrompt: e.target.value })}
                    placeholder="如：写实风格，自然光线，手机自拍质感"
                    rows={3}
                    className="min-h-[72px] rounded-[14px] border-black/[0.05] bg-white/55 py-2.5 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    data-testid="imggen-extra"
                  />
                </div>

                {/* 未配置提示 */}
                {!imgGenConfig.baseUrl.trim() && (
                  <div className="rounded-[16px] border border-amber-500/30 bg-amber-300/15 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-700 backdrop-blur-xl dark:border-amber-400/25 dark:bg-amber-300/[0.08] dark:text-amber-200/90">
                    还没有配置生图接口：填写 OpenAI 兼容的生图地址与模型名后，AI 回复里的照片标签才能生成真实照片。
                  </div>
                )}

                {/* 测试生图 */}
                <div>
                  <button
                    type="button"
                    data-testid="imggen-test"
                    onClick={() => void runImgGenTest()}
                    disabled={testing}
                    className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[13.5px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                    {testing ? '正在生图…（约 10-60 秒）' : '测试生图'}
                  </button>
                  <p className="mt-1.5 text-center text-[11px] leading-snug text-muted-foreground/70">
                    按当前配置真实生成一张，验证接口连通与生图效果
                  </p>
                  {testError && (
                    <div
                      data-testid="imggen-test-error"
                      className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-[#FF453A]/[0.06] px-3 py-2 text-[12px] leading-relaxed"
                      style={{ color: IOS_RED }}
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{testError}</span>
                    </div>
                  )}
                  {testing && (
                    <div className="mx-auto mt-3 grid aspect-square w-full max-w-[220px] place-items-center rounded-[14px] border border-dashed border-border bg-muted/40">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-[12px]">正在生成照片…</span>
                      </div>
                    </div>
                  )}
                  {testSrc && (
                    <div className="mt-3">
                      <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-[14px] shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10">
                        <img
                          src={testSrc}
                          alt="测试生成的图片"
                          data-testid="imggen-test-result"
                          className="block aspect-square w-full object-cover"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px] leading-relaxed text-emerald-600 dark:text-emerald-400/90">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                        <span>测试成功</span>
                      </div>
                    </div>
                  )}
                </div>
              </GrayCard>
            </section>
            )}

            {/* 形象锁定 tab：按角色设置生图参考图 + 外貌描述（原聊天设置入口迁移至此） */}
            {imgTab === 'face' && <FaceLockSection />}

            {/* 使用说明（页尾） */}
            <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
              图像生成与聊天/识图配置相互独立、互不覆盖。开启后 AI 回复里出现照片标签会自动生成照片并发进聊天、存入角色相册；在「形象锁定」标签页为角色上传参考图即可锁脸，让照片里的人物长相保持一致。
            </p>

            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              服务端转发模式由本站代理请求你配置的生图接口，免跨域；配置与预设保存在本机 IndexedDB（API Key 加密存储），保存即生效、无需重启。
            </p>
      </div>
    </DetailShell>
  );
}

// ---------------- 形象锁定（锁脸）区（图像生成页下方） ----------------

/**
 * 形象锁定（锁脸）区（原微信 / QQ / 信息三端聊天设置里的形象锁定页迁移至此，数据完全兼容）：
 * - 角色选择：横向滚动头像胶囊（绿点徽标 = 已设参考图），数据来自 listContacts()（排除机主）；
 * - 选中角色：参考图上传/替换/删除（compressImageSrc 压到 512px）+ 外貌描述兜底文案（onBlur 即时保存）；
 * - 存储沿用 @/lib/imggen 按 contactId 隔离的 kv（imggen-ref:* / imggen-appearance:*），
 *   与三端聊天里的自动 / 手动生图共用同一份数据，互不覆盖。
 */
function FaceLockSection() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selId, setSelId] = useState('');
  const [refImg, setRefImg] = useState<ImgGenFaceRef | null>(null);
  const [appearDraft, setAppearDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [refVersion, setRefVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, showToast] = useLocalToast();

  // 联系人列表（IndexedDB 异步；排除机主 kind='user'），默认选中第一个
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listContacts();
        if (cancelled) return;
        const chars = list.filter((c) => c.kind !== 'user');
        setContacts(chars);
        setSelId((prev) => (prev && chars.some((c) => c.id === prev) ? prev : chars[0]?.id ?? ''));
      } catch {
        // IndexedDB 不可用时保持空列表
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换角色：渲染期同步重读该角色的参考图与外貌描述（React 官方 "adjust state on prop change" 模式，kv 同步读）
  const [loadedFor, setLoadedFor] = useState('');
  if (loadedFor !== selId) {
    setLoadedFor(selId);
    setRefImg(selId ? getFaceRef(selId) : null);
    setAppearDraft(selId ? getAppearanceNote(selId) : '');
  }

  /** chip 徽标读取：依赖 refVersion，上传/删除参考图后回调换新 → 徽标即时刷新 */
  const hasRefOf = useCallback((id: string) => Boolean(getFaceRef(id)), [refVersion]);

  /** 选图 → FileReader 读 dataURL → 压缩 512px → 存参考图 → 刷新预览/徽标 + toast */
  const onPickFile = (file: File | undefined) => {
    if (!file || uploading || !selId) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件');
      return;
    }
    setUploading(true);
    const fr = new FileReader();
    fr.onload = () => {
      const raw = typeof fr.result === 'string' ? fr.result : '';
      if (!raw.startsWith('data:image/')) {
        setUploading(false);
        showToast('图片读取失败，请换一张试试');
        return;
      }
      void compressImageSrc(raw, 512).then((src) => {
        setFaceRef(selId, src);
        setRefImg(getFaceRef(selId));
        setRefVersion((v) => v + 1);
        setUploading(false);
        showToast('已更新参考图');
      });
    };
    fr.onerror = () => {
      setUploading(false);
      showToast('图片读取失败，请换一张试试');
    };
    fr.readAsDataURL(file);
  };

  /** 删除参考图（外貌描述保留继续兜底） */
  const onDeleteRef = () => {
    if (!selId) return;
    setFaceRef(selId, null);
    setRefImg(null);
    setRefVersion((v) => v + 1);
    showToast('已删除参考图');
  };

  const sel = contacts.find((c) => c.id === selId) ?? null;
  const selLabel = sel ? displayNameOf(sel) : '';

  return (
    <section data-testid="imggen-face-section">
      <SectionLabel icon={ScanFace} tone={TONE_PURPLE}>形象锁定（锁脸）</SectionLabel>

      {/* 角色选择（横向滚动头像胶囊；绿点 = 已设参考图） */}
      {contacts.length === 0 ? (
        <GrayCard>
          <div className="flex flex-col items-center gap-2.5 py-5 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/[0.04] dark:bg-white/[0.07]">
              <ScanFace className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              还没有角色：先到联系人 App 添加角色，再回来为 TA 设置参考图。
            </p>
          </div>
        </GrayCard>
      ) : (
        <>
          <div className="no-scrollbar -mx-1 flex gap-3.5 overflow-x-auto px-1 py-0.5" role="listbox" aria-label="选择角色">
            {contacts.map((c) => {
              const active = c.id === selId;
              const hasRef = hasRefOf(c.id);
              const label = displayNameOf(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`imggen-face-chip-${c.id}`}
                  onClick={() => setSelId(c.id)}
                  className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 rounded-[14px] py-1 transition-all active:scale-95"
                >
                  <span className="relative">
                    {c.avatar ? (
                      <img
                        src={c.avatar}
                        alt={label}
                        draggable={false}
                        className={`h-12 w-12 rounded-full object-cover transition-all ${
                          active ? 'ring-2 ring-foreground/60 dark:ring-white/60' : 'opacity-75'
                        }`}
                      />
                    ) : (
                      <span
                        className={`grid h-12 w-12 place-items-center rounded-full bg-muted text-[15px] font-medium text-muted-foreground transition-all ${
                          active ? 'ring-2 ring-foreground/60 dark:ring-white/60' : 'opacity-75'
                        }`}
                      >
                        {label.slice(0, 1)}
                      </span>
                    )}
                    {hasRef && (
                      <span
                        aria-label="已设置参考图"
                        className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#F2F2F7] bg-[#34C759] dark:border-background"
                      />
                    )}
                  </span>
                  <span
                    className={`w-full truncate px-1 text-center text-[11px] leading-none ${
                      active ? 'font-medium text-foreground' : 'text-foreground/60'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 选中角色：参考图 + 外貌描述 */}
          {sel && (
            <GrayCard className="mt-3">
              {/* 角色头部：名字 + 三态锁脸状态徽标（已锁脸 / 仅外貌描述 / 未设置） */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {sel.avatar ? (
                    <img
                      src={sel.avatar}
                      alt={selLabel}
                      draggable={false}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-black/[0.06] dark:ring-white/10"
                    />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-[14px] font-medium text-muted-foreground">
                      {selLabel.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[15.5px] font-semibold text-foreground">{selLabel}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">按角色独立保存</div>
                  </div>
                </div>
                {refImg ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#34C759]/[0.12] px-2.5 py-1 text-[11px] font-medium text-[#1E9E4A] dark:text-[#34C759]">
                    <ScanFace className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                    已锁脸
                  </span>
                ) : appearDraft.trim() ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#FF9500]/[0.14] px-2.5 py-1 text-[11px] font-medium text-[#B26A00] dark:text-[#FFB340]">
                    <PenLine className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
                    仅外貌描述
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:bg-white/[0.08]">
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" aria-hidden="true" />
                    未设置
                  </span>
                )}
              </div>

              {/* 参考图预览（干净细描边装裱；空态虚线占位） */}
              <div className="mx-auto mt-4 w-full max-w-[210px]">
                {refImg ? (
                  <div className="overflow-hidden rounded-[18px] shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.1]">
                    <img
                      data-testid="imggen-face-ref-img"
                      src={refImg.src}
                      alt={`${selLabel}的生图参考图`}
                      draggable={false}
                      className="aspect-square w-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    aria-hidden="true"
                    className="grid aspect-square w-full place-items-center rounded-[18px] border border-dashed border-black/10 bg-black/[0.02] px-5 dark:border-white/15 dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <ScanFace className="h-8 w-8 text-black/25 dark:text-white/30" strokeWidth={1.5} />
                      <span className="text-[11.5px] leading-relaxed text-muted-foreground/80">
                        上传一张正脸照
                        <br />
                        生图时锁定 TA 的长相
                      </span>
                    </div>
                  </div>
                )}
                <p className="pt-2.5 text-center text-[11.5px] leading-[1.6] text-muted-foreground">
                  参考图会作为生图输入，保证 TA 每次照片里的脸一致
                </p>
              </div>

              {/* 上传 / 替换 / 删除（浅灰按钮，删除红字示警） */}
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  data-testid="imggen-face-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-white/60 py-2.5 text-[14px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-60 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  {uploading ? (
                    <Loader2 className="h-[16px] w-[16px] animate-spin" aria-hidden="true" />
                  ) : (
                    <ImageIcon className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
                  )}
                  {uploading ? '正在处理…' : refImg ? '替换参考图' : '上传参考图'}
                </button>
                {refImg && (
                  <button
                    type="button"
                    data-testid="imggen-face-delete"
                    onClick={onDeleteRef}
                    className="flex-1 rounded-[14px] bg-white/60 py-2.5 text-[14px] font-medium text-[#FF3B30] shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-[#FF453A]/10 dark:bg-white/[0.1] dark:ring-white/[0.12]"
                  >
                    删除参考图
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                data-testid="imggen-face-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  onPickFile(f);
                }}
              />

              {/* 外貌描述（onBlur 即时保存；带字数计数） */}
              <div className="mt-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.07]">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[13px] font-medium text-muted-foreground">
                    外貌描述（锁脸兜底）
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground/60">{appearDraft.length}/300</span>
                </div>
                <Textarea
                  data-testid="imggen-face-appear"
                  value={appearDraft}
                  onChange={(e) => setAppearDraft(e.target.value)}
                  onBlur={() => {
                    if (selId) setAppearanceNote(selId, appearDraft);
                  }}
                  placeholder="20岁女生，黑色长直发，杏眼，皮肤白皙，身材苗条"
                  rows={3}
                  maxLength={300}
                  aria-label="外貌描述"
                  className="min-h-[64px] rounded-[14px] border-black/[0.05] bg-white/55 py-2.5 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                <p className="pt-2 text-[12px] leading-[1.6] text-muted-foreground/80">
                  未上传参考图或生图模型不支持参考图时，会把这段外貌描述拼进提示词兜底；每个角色独立设置，互不影响。
                </p>
              </div>
            </GrayCard>
          )}
        </>
      )}
      <LocalToast msg={toast} />
    </section>
  );
}

// ---------------- 锁屏密码 ----------------

type LockStage = 'menu' | 'verifyOff' | 'verifyChange' | 'setNew' | 'confirmNew';

const LOCK_STAGE_TITLE: Record<Exclude<LockStage, 'menu'>, string> = {
  verifyOff: '输入密码',
  verifyChange: '输入密码',
  setNew: '输入新密码',
  confirmNew: '再输入一次',
};

/**
 * 锁屏密码管理：开启/关闭（需验证原密码）、修改密码（原密码 → 新密码两次）、
 * 密码类型（4/6 位，未开启时可切换）、立即锁定。
 */
function LockPage({ onBack }: { onBack: () => void }) {
  const lockConfig = useSettings((s) => s.lockConfig);
  const applyLockConfig = useSettings((s) => s.applyLockConfig);
  const setLockScreen = useSettings((s) => s.setLockScreen);

  const [stage, setStage] = useState<LockStage>('menu');
  const [tempCode, setTempCode] = useState('');
  const [errText, setErrText] = useState('');
  const [errSignal, setErrSignal] = useState(0);
  // #63：关锁屏总开关前弹确认框（仅在 enabled && code 已设时，避免误关丢失已设密码）
  const [confirmLockOff, setConfirmLockOff] = useState(false);

  const fail = (msg: string) => {
    setErrSignal((s) => s + 1);
    setErrText(msg);
  };

  const cancelSub = () => {
    setStage('menu');
    setTempCode('');
    setErrText('');
  };

  // ---------------- 菜单 ----------------
  if (stage === 'menu') {
    return (
      <DetailShell title="锁屏与密码" onBack={onBack} gray>
        <GroupCard>
          <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {/* 锁屏总开关：关掉后不再出现锁屏界面 */}
            <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 text-[16px]">锁屏</span>
              <Switch
                checked={lockConfig.lockScreen}
                onCheckedChange={(v) => {
                  setErrText('');
                  // #63：关锁屏总开关时若已设密码（enabled && code），先弹确认框——
                  // store.setLockScreen(false) 会静默清空 enabled/code，误关会丢失已设密码。
                  // 仅打开或未设密码时直接走原逻辑。
                  if (!v && lockConfig.enabled && lockConfig.code) {
                    setConfirmLockOff(true);
                    return;
                  }
                  setLockScreen(v);
                }}
                aria-label="锁屏开关"
              />
            </div>
            {/* 锁屏密码开关（仅在锁屏开启时可用） */}
            <div
              className={`flex min-h-[52px] items-center gap-3 px-4 py-2 ${
                lockConfig.lockScreen ? '' : 'pointer-events-none opacity-40'
              }`}
            >
              <span className="min-w-0 flex-1 text-[16px]">锁屏密码</span>
              <Switch
                checked={lockConfig.enabled}
                onCheckedChange={(v) => {
                  setErrText('');
                  if (v) {
                    setTempCode('');
                    setStage('setNew');
                  } else if (lockConfig.code) {
                    setStage('verifyOff');
                  } else {
                    applyLockConfig({ lockScreen: true, enabled: false, code: '', len: lockConfig.len });
                  }
                }}
                aria-label="锁屏密码开关"
              />
            </div>
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          {lockConfig.lockScreen
            ? '开启后，锁屏上滑解锁需要输入密码；关闭浏览器再打开或按下电源键都会回到锁屏。'
            : '锁屏已关闭：开机和按下电源键都会直接进入主屏幕。'}
        </p>

        {lockConfig.lockScreen && (
          <div className="mt-4">
            <GroupCard>
              {lockConfig.enabled && (
                <button
                  type="button"
                  onClick={() => {
                    setErrText('');
                    setTempCode('');
                    setStage('verifyChange');
                  }}
                  className="flex h-[46px] w-full items-center justify-between px-4 text-left transition-colors active:bg-muted/50"
                >
                  <span className="text-[16px]">更改密码</span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
                </button>
              )}
              <div className="flex min-h-[52px] items-center justify-between px-4 py-2">
                <span className="text-[16px]">密码类型</span>
                {lockConfig.enabled ? (
                  <span className="text-[15px] text-muted-foreground">
                    {lockConfig.len === 6 ? '6 位数字' : '4 位数字'}
                  </span>
                ) : (
                  <div className="flex rounded-full bg-white/50 p-0.5 ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/[0.08]" role="radiogroup" aria-label="密码位数">
                    {([4, 6] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={lockConfig.len === n}
                        onClick={() => applyLockConfig({ lockScreen: true, enabled: false, code: '', len: n })}
                        className={`h-8 w-[68px] rounded-full text-[14px] transition ${
                          lockConfig.len === n
                            ? 'bg-white/95 font-medium text-foreground shadow-sm dark:bg-white/[0.2]'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {n} 位
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </GroupCard>
          </div>
        )}

        {errText && (
          <p className="mt-3 px-1 text-[13px] leading-relaxed" style={{ color: IOS_RED }} role="alert">
            {errText}
          </p>
        )}

        {/* #63：关闭锁屏总开关前确认（仿 themes.tsx「恢复全部默认图标」对话框） */}
        <AlertDialog open={confirmLockOff} onOpenChange={setConfirmLockOff}>
          <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
            <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
              <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
                关闭锁屏？
              </AlertDialogTitle>
              <AlertDialogDescription className="text-center text-[13px] leading-snug">
                已设置的锁屏密码将被清除，下次开启锁屏后需重新设置密码。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
              <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
                取消
              </AlertDialogCancel>
              <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
              <AlertDialogAction
                className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
                style={{ color: IOS_RED }}
                onClick={() => {
                  try {
                    navigator.vibrate?.(10);
                  } catch {
                    /* 震动不可用 */
                  }
                  setLockScreen(false);
                  setConfirmLockOff(false);
                }}
              >
                关闭锁屏
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DetailShell>
    );
  }

  // ---------------- 密码输入子页 ----------------

  const handleComplete = (code: string) => {
    if (stage === 'verifyOff') {
      if (code === lockConfig.code) {
        applyLockConfig({ ...lockConfig, enabled: false, code: '' });
        setErrText('');
        setStage('menu');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'verifyChange') {
      if (code === lockConfig.code) {
        setErrText('');
        setTempCode('');
        setStage('setNew');
      } else {
        fail('密码错误，请重试');
      }
    } else if (stage === 'setNew') {
      setTempCode(code);
      setErrText('');
      setStage('confirmNew');
    } else if (stage === 'confirmNew') {
      if (code === tempCode) {
        applyLockConfig({ ...lockConfig, enabled: true, code });
        setErrText('');
        setTempCode('');
        setStage('menu');
      } else {
        setTempCode('');
        setStage('setNew');
        fail('两次输入不一致，请重新设置');
      }
    }
  };

  return (
    <DetailShell title="锁屏与密码" onBack={cancelSub} gray>
      <div className="flex flex-col items-center pt-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
          <Lock className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
        </div>
        <p className="mt-3 text-[17px] font-semibold">{LOCK_STAGE_TITLE[stage]}</p>
        {stage === 'confirmNew' && (
          <p className="mt-1 text-[13px] text-muted-foreground">请再次输入相同的密码</p>
        )}
        <PasscodePad
          length={lockConfig.len}
          onComplete={handleComplete}
          errorSignal={errSignal}
          className="mt-6"
        />
        <p className="mt-4 min-h-[20px] text-[13px] font-medium" style={{ color: IOS_RED }} role="alert">
          {errText}
        </p>
        <button
          type="button"
          onClick={cancelSub}
          className="mt-2 rounded-full bg-white/60 px-6 py-2 text-[15px] text-muted-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
        >
          取消
        </button>
      </div>
    </DetailShell>
  );
}

// ---------------- 关于本机 ----------------

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
      <span className="shrink-0 text-[16px]">{label}</span>
      <span className="text-right text-[15px] text-muted-foreground">{value}</span>
    </div>
  );
}

// ---------------- 个人信息 ----------------

/** 个人信息页：从手机上传头像（设置侧独立头像，不写入微信/QQ/联系人全局）、修改名字与标签（即改即存） */
function ProfilePage({ onBack }: { onBack: () => void }) {
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  const ownerAvatar = useOwnerAvatar();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一张图
    if (!file) return;
    void fileToAvatarDataUrl(file)
      .then((dataUrl) => setProfile({ avatar: dataUrl }))
      .catch(() => undefined);
  };

  return (
    <DetailShell title="个人信息" onBack={onBack} gray>
      {/* 头像：点击从手机相册/文件选择 */}
      <div className="flex flex-col items-center pt-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="更换头像"
          className="relative rounded-full transition-transform active:scale-95"
        >
          {(profile.avatar || ownerAvatar) ? (
            <img
              src={profile.avatar || ownerAvatar || ''}
              alt="头像"
              className="h-[88px] w-[88px] rounded-full object-cover"
            />
          ) : (
            <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8]">
              <User className="h-11 w-11 text-[#7C7C84]" strokeWidth={1.8} />
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-[3px] border-background bg-white/70 shadow-sm backdrop-blur-xl dark:bg-white/[0.14]">
            <Camera className="h-[15px] w-[15px] text-foreground" strokeWidth={2.2} />
          </span>
        </button>
        <p className="mt-2.5 text-[12px] text-muted-foreground">轻点头像，从手机相册选择照片（未设置时跟随联系人资料头像）</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      </div>

      {/* 名字 / 标签（即改即存） */}
      <div className="mt-6">
        <GroupCard>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-muted-foreground">名字</span>
            <Input
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              placeholder="iPhone 用户"
              maxLength={20}
              aria-label="名字"
              className="h-11 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-[64px] shrink-0 text-[15px] text-muted-foreground">标签</span>
            <Input
              value={profile.tag}
              onChange={(e) => setProfile({ tag: e.target.value })}
              placeholder="Apple 账户、iCloud"
              maxLength={30}
              aria-label="标签"
              className="h-11 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </GroupCard>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted-foreground">
          名字将显示在锁屏「×××的iPhone」小组件上；头像、名字与标签自动保存。此头像仅用于设置侧（与微信/QQ 各自独立、互不影响）；微信/QQ 请在各自 App 的个人资料页更换。
        </p>
      </div>
    </DetailShell>
  );
}

// ---------------- 账号管理 ----------------

/** 账号首字母圆配色：小号=蓝绿系、匿名号=深灰系（深浅色各配一版） */
const ACCOUNT_AVATAR_TONE: Record<'alt' | 'anon', string> = {
  alt: 'bg-[#D5F0EC] text-[#0E7C6B] dark:bg-[#0E7C6B]/30 dark:text-[#8FDCCE]',
  anon: 'bg-[#E4E4E9] text-[#55555C] dark:bg-white/[0.14] dark:text-[#C7C7CC]',
};

/** accountUsedBy 的 App 中文名映射（「使用中：微信·QQ」副行用） */
const ACCOUNT_APP_NAMES: Record<AccountApp, string> = { wx: '微信', qq: 'QQ', sms: '信息', phone: '电话', cabin: '拾光小屋', forum: 'X论坛' };

/**
 * 账号管理页（多账号系统 Task 40-C，v2 per-app 账号适配；Task 40-R 流程修正）：
 * - 账号列表：大号 = 机主资料（mainOwnerContact 实时资料），小号/匿名号 = 注册名 + 虚拟号；
 *   副行标注「使用中：微信·QQ」（该账号正被哪些 App 使用，accountUsedBy，空 = 不显示）；
 * - v2 无全局切换：行点击不再切换账号（微信/QQ/信息/电话在各自 App 内切换，互相独立）；
 * - 小号创建入口在联系人 App 「小号」tab（本页不再创建小号）；匿名号无人设档案，
 *   保留受控命名小弹窗（可留空用默认名）→ createAccount('anon')（不自动切换）；
 * - 非大号行右侧常驻 ⊖ 圆钮（iOS 订阅管理风）→ 确认弹窗（写明清除全部数据）→ deleteAccount()（async），
 *   正在使用中的账号删除时自动切回大号（退出该账号），不再拦截。
 */
function AccountSwitchPage({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => getAccounts());
  // 机主实时资料（大号显示名/号码/头像）：跨账号直读大号库（mainOwnerContact），
  // 避免在小号视角下误用当前库的机主联系人
  const [owner, setOwner] = useState<{ name: string; phone: string; avatar: string | null }>({
    name: '',
    phone: '',
    avatar: null,
  });
  // 命名小弹窗：null=关闭；'anon'=正在创建匿名号码（小号创建入口在联系人 App，不再提供）
  const [namingKind, setNamingKind] = useState<'anon' | null>(null);
  const [namingInput, setNamingInput] = useState('');
  // 待删除账号 id（确认弹窗）
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 删除时是否保留数据（规则：删除账号后数据是否保留由用户决定；默认不保留）
  const [delKeepData, setDelKeepData] = useState(false);
  const [toast, showToast] = useLocalToast();

  // 机主资料异步加载（跨账号读大号库；失败回退「机主」+ 注册表字段）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await mainOwnerContact();
        if (cancelled) return;
        setOwner({
          name: me?.name?.trim() ?? '',
          phone: me?.phone?.trim() ?? '',
          avatar: me?.avatar ?? null,
        });
      } catch {
        // IndexedDB 不可用时保持空资料：显示名回退「机主」，号码回退注册表
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 账号显示名：大号 = 机主联系人名回退「机主」；小号/匿名号 = 注册名 */
  const displayName = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) return owner.name || accountDisplayName(acc);
    return acc.name;
  };

  /** 副行小字：kind 徽标文案 + 号码（大号用实时机主号码，回退注册表号码）+ 使用中的 App（空 = 不显示） */
  const subline = (acc: PhoneAccount): string => {
    const badge = acc.kind === 'main' ? '大号' : acc.kind === 'alt' ? '小号' : '匿名号码';
    const phone = (acc.id === MAIN_ACCOUNT_ID ? owner.phone || acc.phone : acc.phone).trim();
    const base = phone ? `${badge} · ${phone}` : badge;
    const usedBy = accountUsedBy(acc.id)
      .map((a) => ACCOUNT_APP_NAMES[a])
      .join('·');
    return usedBy ? `${base} · 使用中：${usedBy}` : base;
  };

  /** 头像圆：大号 = 机主头像回退首字母中性圆；小号/匿名号 = 首字母彩色圆（蓝绿系/深灰系） */
  const renderAvatar = (acc: PhoneAccount) => {
    const name = displayName(acc);
    const initial = [...name.trim()][0]?.toUpperCase() || '?';
    if (acc.id === MAIN_ACCOUNT_ID) {
      if (owner.avatar) {
        return <img src={owner.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
      }
      return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8] text-[16px] font-medium text-[#7C7C84]">
          {initial}
        </span>
      );
    }
    return (
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[16px] font-medium ${ACCOUNT_AVATAR_TONE[acc.kind]}`}
      >
        {initial}
      </span>
    );
  };

  const deletingAccount = accounts.find((a) => a.id === deletingId) ?? null;

  return (
    <DetailShell title="账号管理" onBack={onBack} gray>
      {/* 账号列表：v2 无全局切换——行不再可点击切换；副行标注该账号正被哪些 App 使用 */}
      <GroupCard>
        {accounts.map((acc) => {
          const name = displayName(acc);
          const deletable = acc.id !== MAIN_ACCOUNT_ID;
          return (
            <div key={acc.id} className="flex min-h-[64px] items-center gap-3 py-1 pl-4 pr-3" data-testid={`settings-account-row-${acc.id}`}>
              {renderAvatar(acc)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] leading-snug">{name}</span>
                <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{subline(acc)}</span>
              </span>
              {deletable && (
                <button
                  type="button"
                  data-testid={`settings-account-delete-${acc.id}`}
                  aria-label={`删除 ${name}`}
                  onClick={() => setDeletingId(acc.id)}
                  className="mr-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[#FF453A]/45 text-[#FF453A] transition-colors active:bg-[#FF453A]/10"
                >
                  <Minus className="h-[14px] w-[14px]" strokeWidth={2.8} />
                </button>
              )}
            </div>
          );
        })}
      </GroupCard>

      {/* 添加匿名号码（小号创建入口在联系人 App 「小号」tab，此处不再提供） */}
      <div className="mt-5">
        <GroupCard>
          <button
            type="button"
            data-testid="settings-account-add-anon"
            onClick={() => {
              setNamingInput('');
              setNamingKind('anon');
            }}
            className="flex h-[50px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/50"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#34C759]">
              <Plus className="h-[14px] w-[14px] text-white" strokeWidth={3} />
            </span>
            <span className="flex-1 text-[16px]">新建匿名号码</span>
          </button>
        </GroupCard>
        <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
          新建小号：打开联系人 App → 「小号」，创建后可在微信 / QQ / 信息 / 电话的切换账号处登录使用。
          四个 App 切换账号互相独立，切换不刷新页面；在联系人 App 删除小号后，正在使用它的 App 会自动退出该账号。
          其他 App 数据（照片、备忘录等）为整机共享，不随账号变化。
        </p>
      </div>

      {/* 命名小弹窗（匿名号码）：输入可留空（默认名「匿名账号」），创建后不自动切换 */}
      <AlertDialog
        open={namingKind !== null}
        onOpenChange={(open) => {
          if (!open) setNamingKind(null);
        }}
      >
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-3 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">新建匿名号码</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug">
              给这个身份起个名字，留空则默认「匿名账号」；创建后可在微信 / QQ / 信息 / 电话中切换使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-5 pb-4">
            <Input
              data-testid="settings-account-name-input"
              value={namingInput}
              onChange={(e) => setNamingInput(e.target.value)}
              placeholder="匿名账号"
              maxLength={20}
              aria-label="账号名称"
            />
          </div>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
              取消
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
            <AlertDialogAction
              data-testid="settings-account-create-confirm"
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium text-[#0A84FF] shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              onClick={() => {
                const kind = namingKind;
                setNamingKind(null);
                if (!kind) return;
                const acc = createAccount(kind, namingInput);
                // v2 不自动切换：在各 App（微信/QQ/信息/电话）内自行切换使用
                setAccounts(getAccounts());
                showToast(`已创建「${accountDisplayName(acc)}」，可在微信 / QQ / 信息 / 电话中切换使用`);
              }}
            >
              创建
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认：写明将清除该账号全部数据；正在使用中的账号删除时自动切回大号（退出该账号） */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent className="w-[270px] gap-0 rounded-[14px] p-0 sm:w-[270px] sm:max-w-[270px]">
          <AlertDialogHeader className="gap-1.5 px-5 pb-4 pt-5 sm:text-center">
            <AlertDialogTitle className="text-center text-[17px] font-semibold leading-snug">
              删除「{deletingAccount ? displayName(deletingAccount) : ''}」？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[13px] leading-snug">
              将删除该账号及登录态；正在使用它的微信 / QQ 等会自动退出并回到大号。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label
            data-testid="settings-account-delete-keep"
            className="mx-5 mb-1 flex cursor-pointer items-start gap-2.5 rounded-[8px] bg-muted/60 px-3 py-2.5"
          >
            <input
              type="checkbox"
              checked={delKeepData}
              onChange={(e) => setDelKeepData(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#FF3B30]"
            />
            <span className="text-left text-[12.5px] leading-[1.55] text-muted-foreground">保留该账号的数据（聊天记录、记忆、朋友圈等；数据不可见也无法恢复登录）</span>
          </label>
          <AlertDialogFooter className="flex-row gap-0 border-t border-border sm:flex-row">
            <AlertDialogCancel className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-normal text-foreground shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0">
              取消
            </AlertDialogCancel>
            <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-border" />
            <AlertDialogAction
              data-testid="settings-account-delete-confirm"
              className="h-12 flex-1 rounded-none border-0 bg-transparent text-[16px] font-medium shadow-none hover:bg-transparent focus-visible:ring-0 active:bg-muted/60 sm:mt-0"
              style={{ color: IOS_RED }}
              onClick={() => {
                const id = deletingId;
                const keep = delKeepData;
                setDeletingId(null);
                setDelKeepData(false);
                if (!id) return;
                void deleteAccount(id, { keepData: keep }).then((result) => {
                  if (result.ok) {
                    setAccounts(getAccounts());
                    showToast(keep ? '已删除该账号（数据已保留）' : '已删除该账号');
                  } else {
                    showToast(result.error ?? '删除失败');
                  }
                });
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LocalToast msg={toast} />
    </DetailShell>
  );
}

function AboutPage({ onBack }: { onBack: () => void }) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const uaShort = ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;

  return (
    <DetailShell title="关于本机" onBack={onBack} gray>
      <GroupCard>
        <AboutRow label="名称" value="iPhone" />
        <AboutRow label="系统版本" value="iOS Web 1.0.0" />
        <AboutRow label="架构" value="本地优先（IndexedDB）" />
        <div className="flex min-h-[46px] items-center justify-between gap-3 px-4 py-2">
          <span className="shrink-0 text-[16px]">浏览器</span>
          <span className="truncate text-right text-[13px] text-muted-foreground" title={ua || undefined}>
            {uaShort || '—'}
          </span>
        </div>
      </GroupCard>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted-foreground">
        照片、备忘录、日程、聊天与全部设置均保存在浏览器 IndexedDB 中，可随时清理，不会上传服务器。
      </p>
    </DetailShell>
  );
}

// ---------------- 语音 API（TTS） ----------------

/** 服务商预设值（切换服务商时地址/模型名联动，用户仍可改）；模型 chips 含常见第三方 OpenAI 兼容 TTS 模型，拉不到列表时也可直接点选；
 *  Fish Audio 无需模型名（reference_id 即音色），modelChips 留空 */
const TTS_PROVIDER_PRESETS = {
  minimax: { baseUrl: 'https://api.minimax.chat', model: 'speech-01-turbo', modelChips: ['speech-01-turbo', 'speech-01-hd', 'speech-02-turbo', 'speech-02-hd'] },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'tts-1', modelChips: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'qwen-tts-latest', 'FunAudioLLM/CosyVoice2-0.5B'] },
  fishaudio: { baseUrl: 'https://fishaudio.org/v1', model: '', modelChips: [] as readonly string[] },
} as const;

/** 拉取不到模型列表时的降级提示（语音合成语境，区别于聊天 API 的提示文案） */
const TTS_MODEL_MANUAL_HINT = '该服务商未提供模型列表接口；不需要模型的服务商留空即可，需要的可从下方常用模型点选或手动填写。';

/**
 * 语音 API 设置页（与聊天 API / 识图 API 相互独立、互不覆盖）：
 * - 服务商：内置语音（免费）/ MiniMax / OpenAI 兼容 / Fish Audio；连接配置即改即存（更改自动保存，下一次播放即生效，无需重启）
 * - 多服务商分槽（Task 29）：切换服务商时快照当前家、恢复目标家（MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖）
 * - 内置语音：浏览器本地引擎（Web Speech），内置 3 女 3 男共 6 个声线，零配置免 API、离线可用，逐个可试听
 * - 全局默认音色（并入连接配置卡片，无独立区块）：角色未设独立 voiceId 时使用（聊天设置「他的声音」可给角色单独设音色；音色 ID 手动填写）
 * - 试听：用当前配置合成一句样例直接播放
 */
function VoicePage({ onBack }: { onBack: () => void }) {
  const ttsConfig = useSettings((s) => s.ttsConfig);
  const updateTtsConfig = useSettings((s) => s.updateTtsConfig);
  const switchTtsProvider = useSettings((s) => s.switchTtsProvider);
  // 语音识别（STT）独立配置：与 TTS 互不覆盖
  const sttConfig = useSettings((s) => s.sttConfig);
  const updateSttConfig = useSettings((s) => s.updateSttConfig);
  // Web Speech API 支持检测：只在客户端测一次（避免 SSR 水合不一致）
  const [wsSupport, setWsSupport] = useState<boolean | null>(null);
  useEffect(() => {
    setWsSupport(isWebSpeechSupported());
  }, []);

  const [showKey, setShowKey] = useState(false);
  const [showSttKey, setShowSttKey] = useState(false);

  // 模型列表拉取（与聊天/识图 API 的「拉取模型」同款体验）
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelsHint, setModelsHint] = useState('');
  const [ttsModels, setTtsModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelPanelOpen, setModelPanelOpen] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  /** 试听 ObjectURL 回收（内存：原先每次试听都 new Audio(URL.createObjectURL(blob))
   *  且从不 revoke——听一次泄漏一个 blob URL；改从 audio.src 取回统一回收） */
  const revokePreviewSrc = (audio: HTMLAudioElement | null): void => {
    const src = audio?.src;
    if (src && src.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(src);
      } catch {
        /* 忽略 */
      }
    }
  };

  const isMinimax = ttsConfig.provider === 'minimax';
  const isFish = ttsConfig.provider === 'fishaudio';
  const isTtsOpenai = ttsConfig.provider === 'openai';
  const isBuiltin = ttsConfig.provider === 'builtin';
  const preset = TTS_PROVIDER_PRESETS[ttsConfig.provider as 'minimax' | 'openai' | 'fishaudio'];

  // 内置声线逐个试听状态（在播的声线 id）
  const [previewingBuiltinId, setPreviewingBuiltinId] = useState<string | null>(null);
  // 内置引擎支持检测（客户端一次性）
  const [builtinSupport, setBuiltinSupport] = useState<boolean | null>(null);
  useEffect(() => {
    setBuiltinSupport(isBuiltinVoiceSupported());
  }, []);

  // 页面卸载：停掉试听音频并释放
  useEffect(
    () => () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        revokePreviewSrc(previewAudioRef.current);
        previewAudioRef.current = null;
      }
      stopBuiltinSpeech();
    },
    []
  );

  const switchProvider = (p: 'builtin' | 'minimax' | 'openai' | 'fishaudio') => {
    if (p === ttsConfig.provider) return;
    // 多服务商分槽（Task 29）：store 内快照当前家连接配置进本家槽位 → 恢复目标家槽位
    // （MiniMax 等已有 Key/GroupId/模型/默认音色互不覆盖；首次切换填该家默认值）
    switchTtsProvider(p);
    stopBuiltinSpeech();
    setPreviewingBuiltinId(null);
    setModelsError('');
    setModelsHint('');
    setModelPanelOpen(false);
    setProviderTestError('');
    setProviderTestOk(false);
  };

  /** TTS 相关模型排前（tts/speech/audio/voice 命中），其余模型排后仍可选 */
  const applyTtsModels = (list: string[]) => {
    const isTts = (m: string) => /tts|speech|audio|voice/i.test(m);
    const sorted = [...list].sort((a, b) => Number(isTts(b)) - Number(isTts(a)) || a.localeCompare(b));
    setTtsModels(sorted);
    setModelQuery('');
    setModelPanelOpen(true);
  };

  const fetchTtsModels = async () => {
    if (!ttsConfig.baseUrl.trim()) {
      setModelsError('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setModelsHint('');
    try {
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: ttsConfig.baseUrl, apiKey: ttsConfig.apiKey }),
      });
      const data = (await res.json().catch(() => null)) as
        | { models?: string[]; hint?: string; error?: string; url?: string; directOnly?: boolean }
        | null;
      // 内网地址或服务器不可达/地区限制（directOnly）：改用浏览器直连拉取
      if (!data || data.directOnly || (data.error && isPrivateApiUrl(ttsConfig.baseUrl))) {
        const direct = await directFetchModels(ttsConfig.baseUrl, ttsConfig.apiKey);
        if (direct.error) {
          const serverMsg = typeof data?.error === 'string' ? data.error : '';
          setModelsError(
            serverMsg && !isPrivateApiUrl(ttsConfig.baseUrl)
              ? `${serverMsg}；浏览器直连也不可用：${direct.error}`
              : direct.error
          );
          return;
        }
        if (direct.hint && direct.models.length === 0) {
          setModelsHint(TTS_MODEL_MANUAL_HINT);
          return;
        }
        applyTtsModels(direct.models);
        return;
      }
      if (!res.ok || !data || data.error) {
        const base = data?.error ?? '拉取模型失败，请稍后重试';
        setModelsError(data?.url ? `${base}（实际请求：${data.url}）` : base);
      } else if (data.hint && (data.models ?? []).length === 0) {
        // MiniMax 等无模型列表接口：优雅降级，可用常用模型 chips 或手动填写
        setModelsHint(TTS_MODEL_MANUAL_HINT);
      } else {
        applyTtsModels(data.models ?? []);
      }
    } catch {
      setModelsError('无法连接到服务器');
    } finally {
      setFetchingModels(false);
    }
  };

  /** 内置声线逐个试听 */
  const previewBuiltinVoice = (voiceId: string) => {
    if (previewingBuiltinId) {
      stopBuiltinSpeech();
      stopPreviewAudio();
      setPreviewingBuiltinId(null);
      if (previewingBuiltinId === voiceId) return;
    }
    stopBuiltinSpeech();
    setPreviewingBuiltinId(voiceId);
    void speakBuiltin({
      text: '你好，这是内置声线，很高兴认识你。',
      voiceId,
      onStart: () => setPreviewingBuiltinId(voiceId),
      onEnd: () => setPreviewingBuiltinId(null),
      onError: () => setPreviewingBuiltinId(null),
    }).catch(() => setPreviewingBuiltinId(null));
  };

  /** 停掉试听中的 Audio（云端/我的音色试听用） */
  const stopPreviewAudio = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      revokePreviewSrc(previewAudioRef.current);
      previewAudioRef.current = null;
    }
  };

  const runPreview = async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    setPreviewError('');
    // 内置语音：浏览器本地引擎直接朗读，不走 API
    if (isBuiltin) {
      stopBuiltinSpeech();
      try {
        await speakBuiltin({
          text: '你好，这是当前的语音音色，很高兴见到你。',
          voiceId: ttsConfig.defaultVoiceId,
          onStart: () => setPreviewingBuiltinId('preview'),
        });
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : '内置语音播放失败');
      } finally {
        setPreviewingBuiltinId(null);
        setPreviewLoading(false);
      }
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      revokePreviewSrc(previewAudioRef.current);
      previewAudioRef.current = null;
    }
    try {
      const voiceId = ttsConfig.defaultVoiceId.trim() || (isMinimax ? 'female-shaonv' : isFish ? '' : 'alloy');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId, text: '你好，这是当前的语音音色，很高兴见到你。' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setPreviewError(data?.error ?? '语音生成失败');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      };
      await audio.play().catch(() => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      });
    } catch {
      setPreviewError('语音生成失败，请检查配置');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ---- 服务商连接测试（测试填写的语音服务商是否可用：按当前连接配置合成一句样例验证连通性并播放） ----
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerTestError, setProviderTestError] = useState('');
  const [providerTestOk, setProviderTestOk] = useState(false);

  /** 测试服务商：合成一句样例；成功播放音频并标记可用，失败展示服务端返回的错误信息 */
  const testProvider = async () => {
    if (testingProvider) return;
    setTestingProvider(true);
    setProviderTestError('');
    setProviderTestOk(false);
    try {
      const voiceId = ttsConfig.defaultVoiceId.trim() || (isMinimax ? 'female-shaonv' : isFish ? '' : 'alloy');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId, text: '你好，这是服务商连接测试。' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setProviderTestError(data?.error ?? `测试失败（HTTP ${res.status}）`);
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        setProviderTestError('服务商返回了空音频，请检查模型名与音色 ID');
        return;
      }
      setProviderTestOk(true);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        revokePreviewSrc(previewAudioRef.current);
        previewAudioRef.current = null;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      };
      await audio.play().catch(() => {});
    } catch {
      setProviderTestError('无法连接到服务器');
    } finally {
      setTestingProvider(false);
    }
  };

  const mq = modelQuery.trim().toLowerCase();
  const filteredTtsModels = mq ? ttsModels.filter((m) => m.toLowerCase().includes(mq)) : ttsModels;

  // ---- 我的音色（用户自建音色库，永久保存在本机；联系人/聊天设置「他的声音」可选用） ----
  const myVoices = useMyVoices((s) => s.voices);
  const addMyVoice = useMyVoices((s) => s.add);
  const removeMyVoice = useMyVoices((s) => s.remove);
  const [myVoiceName, setMyVoiceName] = useState('');
  const [myVoiceId, setMyVoiceId] = useState('');
  const [myVoiceError, setMyVoiceError] = useState('');
  const [previewingMyId, setPreviewingMyId] = useState<string | null>(null);

  const submitMyVoice = () => {
    setMyVoiceError('');
    const rec = addMyVoice(myVoiceName, myVoiceId);
    if (!rec) {
      setMyVoiceError('请填写音色名字与音色 ID（完全重复的音色不会重复保存）');
      return;
    }
    setMyVoiceName('');
    setMyVoiceId('');
  };

  /** 我的音色试听：内置声线 id / 内置服务商 → 浏览器引擎本地朗读；其它走当前语音 API */
  const previewMyVoice = async (v: { id: string; voiceId: string }) => {
    if (previewingMyId) {
      stopBuiltinSpeech();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewingMyId(null);
      if (previewingMyId === v.id) return;
    }
    if (isBuiltinVoiceId(v.voiceId) || isBuiltin) {
      setPreviewingMyId(v.id);
      void speakBuiltin({
        text: '你好，这是保存的音色，很高兴认识你。',
        voiceId: isBuiltinVoiceId(v.voiceId) ? v.voiceId : undefined,
        onEnd: () => setPreviewingMyId(null),
        onError: () => setPreviewingMyId(null),
      }).catch(() => setPreviewingMyId(null));
      return;
    }
    setPreviewingMyId(v.id);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: ttsConfig, voiceId: v.voiceId, text: '你好，这是保存的音色，很高兴认识你。' }),
      });
      if (!res.ok) {
        setPreviewingMyId(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        revokePreviewSrc(audio);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
        setPreviewingMyId(null);
      };
      audio.onerror = () => {
        revokePreviewSrc(audio);
        setPreviewingMyId(null);
      };
      await audio.play().catch(() => setPreviewingMyId(null));
    } catch {
      setPreviewingMyId(null);
    }
  };

  return (
    <DetailShell title="语音 API" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 服务商 */}
        <section>
          <SectionLabel icon={Volume2} tone={TONE_CYAN}>服务商</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="tts-provider-builtin"
              onClick={() => switchProvider('builtin')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isBuiltin ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              内置语音（免费）
            </button>
            <button
              type="button"
              data-testid="tts-provider-minimax"
              onClick={() => switchProvider('minimax')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isMinimax ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              MiniMax
            </button>
            <button
              type="button"
              data-testid="tts-provider-openai"
              onClick={() => switchProvider('openai')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isTtsOpenai ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              OpenAI 兼容
            </button>
            <button
              type="button"
              data-testid="tts-provider-fishaudio"
              onClick={() => switchProvider('fishaudio')}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition-all active:scale-[0.97] ${
                isFish ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]' : 'bg-white/55 text-foreground/75 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/75 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
              }`}
            >
              Fish Audio
            </button>
          </div>
        </section>

        {/* 内置语音：免费零配置，男女声线网格 + 逐个试听（提示精简：一行说明 + 不支持时一行警告） */}
        {isBuiltin && (
          <>
            <section>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] text-muted-foreground">本地合成 · 免费 · 离线可用 · 点卡片设为默认</p>
                {builtinSupport === false && (
                  <p className="flex shrink-0 items-center gap-1 text-[12px] text-[#FF3B30]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    浏览器不支持，将回退服务端语音
                  </p>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {BUILTIN_TTS_VOICES.map((v) => {
                  const active = ttsConfig.defaultVoiceId.trim() === v.id;
                  const playing = previewingBuiltinId === v.id;
                  return (
                    <div
                      key={v.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      data-testid={`builtin-voice-${v.id}`}
                      onClick={() => updateTtsConfig({ defaultVoiceId: v.id })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          updateTtsConfig({ defaultVoiceId: v.id });
                        }
                      }}
                      className={`flex flex-col gap-1.5 rounded-[18px] p-3 backdrop-blur-2xl transition-all ${
                        active
                          ? 'bg-white/85 shadow-[0_8px_22px_rgba(17,24,39,0.1)] ring-1 ring-white/80 dark:bg-white/[0.14] dark:ring-white/[0.16]'
                          : 'bg-white/45 shadow-[0_2px_10px_rgba(17,24,39,0.04)] ring-1 ring-white/60 dark:bg-white/[0.05] dark:ring-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-medium">{v.name}</span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              v.gender === 'female' ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            }`}
                          >
                            {v.gender === 'female' ? '女' : '男'}
                          </span>
                        </span>
                        {active && <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                      </div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-[11px] text-muted-foreground">{v.label}</span>
                        <button
                          type="button"
                          aria-label={`试听声线${v.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            previewBuiltinVoice(v.id);
                          }}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
                            playing ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.22]' : 'bg-white/60 text-muted-foreground ring-1 ring-black/[0.05] active:bg-white/85 dark:bg-white/[0.08] dark:ring-white/[0.1]'
                          }`}
                        >
                          <AudioLines className={`h-3.5 w-3.5 ${playing ? 'animate-pulse' : ''}`} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 试听（提示精简：去掉页尾长说明） */}
            <section>
              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={previewLoading}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                试听当前声线
              </button>
              {previewError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {previewError}
                </p>
              )}
            </section>
          </>
        )}

        {/* 连接配置 + 全局默认音色（更改自动保存；内置语音无连接配置） */}
        {!isBuiltin && (
        <>
        <section>
          <SectionLabel
            icon={Wrench}
            tone={TONE_BLUE}
            right={<span className="text-[11px] text-muted-foreground/70">更改自动保存 · 即时生效</span>}
          >
            连接配置
          </SectionLabel>
          <div className="flex flex-col gap-4 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <div>
              <FieldLabel>API 地址</FieldLabel>
              <Input
                value={ttsConfig.baseUrl}
                onChange={(e) => updateTtsConfig({ baseUrl: e.target.value })}
                placeholder={preset.baseUrl}
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            <div>
              <FieldLabel>API Key</FieldLabel>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={ttsConfig.apiKey}
                  onChange={(e) => updateTtsConfig({ apiKey: e.target.value })}
                  placeholder={isMinimax ? 'eyJhbGciOi...' : isFish ? 'Fish Audio 的 API Key（fishaudio.org 控制台获取）' : 'sk-...'}
                  autoComplete="off"
                  className={`h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)] ${ttsConfig.apiKey ? 'pr-16' : 'pr-10'}`}
                />
                {ttsConfig.apiKey && (
                  <button
                    type="button"
                    onClick={() => updateTtsConfig({ apiKey: '' })}
                    aria-label="清空 API Key"
                    className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-opacity hover:opacity-80"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isMinimax && (
              <div>
                <FieldLabel>GroupId</FieldLabel>
                <Input
                  value={ttsConfig.groupId}
                  onChange={(e) => updateTtsConfig({ groupId: e.target.value })}
                  placeholder="MiniMax 控制台「账户管理」里的 GroupId"
                  autoComplete="off"
                  className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
              </div>
            )}

            <div className="relative">
              <FieldLabel>
                模型名{!isMinimax && <span className="ml-1 font-normal text-muted-foreground/70">（选填{isFish ? '，Fish Audio 以音色 ID 定位声线' : ''}）</span>}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={ttsConfig.model}
                  onChange={(e) => updateTtsConfig({ model: e.target.value })}
                  placeholder={isMinimax ? preset.model : isFish ? 'Fish Audio 无需模型名，留空即可' : `如 ${preset.model}，不需要模型可留空`}
                  className="h-11 flex-1 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                />
                {!isFish && (
                  <button
                    type="button"
                    onClick={() => void fetchTtsModels()}
                    disabled={fetchingModels}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-white/60 px-4 text-[13px] font-medium text-foreground shadow-[0_4px_14px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.97] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                  >
                    {fetchingModels && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    拉取模型
                  </button>
                )}
              </div>
              {modelsError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {modelsError}
                </p>
              )}
              {modelsHint && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{modelsHint}</p>
              )}

              {/* 模型列表面板（拉取成功后展开；TTS 相关模型排前） */}
              {modelPanelOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setModelPanelOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute -left-4 -right-4 top-full z-30 mt-1 overflow-hidden rounded-[20px] border border-white/60 bg-white/85 shadow-2xl ring-1 ring-black/[0.05] backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1C1C1E]/85">
                    <div className="border-b border-black/[0.05] p-2 dark:border-white/[0.06]">
                      <Input
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型，如 tts / speech"
                        autoFocus
                        className="h-10 rounded-[12px] border-black/[0.05] bg-white/70 text-[13px] shadow-sm backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.09]"
                      />
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto">
                      {filteredTtsModels.length === 0 ? (
                        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">没有匹配的模型</div>
                      ) : (
                        filteredTtsModels.map((m) => {
                          const isTts = /tts|speech|audio|voice/i.test(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                updateTtsConfig({ model: m });
                                setModelPanelOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[14px]">{m}</span>
                                {isTts && (
                                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    语音
                                  </span>
                                )}
                              </span>
                              {ttsConfig.model.trim() === m && (
                                <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2.5} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {!isMinimax && !isFish && (
                  <button
                    type="button"
                    onClick={() => updateTtsConfig({ model: '' })}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                      !ttsConfig.model.trim()
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    不需要模型（留空）
                  </button>
                )}
                {preset.modelChips.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateTtsConfig({ model: m })}
                    className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                      ttsConfig.model.trim() === m
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* 全局默认音色（并入连接配置卡片：角色未设独立音色时使用，音色 ID 手动填写） */}
            <div>
              <FieldLabel>全局默认音色</FieldLabel>
              <Input
                value={ttsConfig.defaultVoiceId}
                onChange={(e) => updateTtsConfig({ defaultVoiceId: e.target.value })}
                placeholder={isMinimax ? '如 female-shaonv（留空用系统默认）' : isFish ? '如 Fish Audio 音色 ID（留空用平台默认音色）' : '如 alloy（留空用系统默认）'}
                className="h-11 w-full rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
            </div>

            {/* 试听 */}
            <div>
              <button
                type="button"
                onClick={runPreview}
                disabled={previewLoading}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                试听当前音色
              </button>
              {previewError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {previewError}
                </p>
              )}
            </div>

            {/* 测试服务商连接：按当前连接配置合成一句样例，验证填写的服务商能不能用（紧跟试听按钮下方） */}
            <div>
              <button
                type="button"
                data-testid="tts-provider-test"
                onClick={() => void testProvider()}
                disabled={testingProvider}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
              >
                {testingProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {testingProvider ? '测试中…' : '测试服务商连接'}
              </button>
              {providerTestOk && !providerTestError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-green-600 dark:text-green-400">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  服务商可用，测试音频已播放。
                </p>
              )}
              {providerTestError && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {providerTestError}
                </p>
              )}
            </div>
          </div>
        </section>
        </>
        )}

        {/* 我的音色：自建音色库（名字 + 音色 ID，永久保存；联系人/聊天设置「他的声音」可选用）；紧跟连接配置下方 */}
        <section>
          <SectionLabel icon={AudioLines} tone={TONE_ORANGE}>我的音色</SectionLabel>
          <div className="flex flex-col gap-3 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            <p className="text-[12px] leading-relaxed text-muted-foreground/80">
              常用音色存成 preset（名字 + 音色 ID），联系人/聊天设置「他的声音」可点选使用。
            </p>
            {myVoices.length > 0 && (
              <div className="flex flex-col gap-2">
                {myVoices.map((v) => (
                  <div
                    key={v.id}
                    data-testid={`my-voice-item-${v.id}`}
                    className="flex items-center gap-2 rounded-[14px] border border-white/60 bg-white/50 px-4 py-2.5 shadow-[0_3px_12px_rgba(17,24,39,0.05)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.06]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{v.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{v.voiceId}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`试听音色${v.name}`}
                      data-testid={`my-voice-preview-${v.id}`}
                      onClick={() => void previewMyVoice(v)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                        previewingMyId === v.id ? 'bg-white/90 text-foreground shadow-sm dark:bg-white/[0.22]' : 'bg-white/60 text-muted-foreground ring-1 ring-black/[0.05] active:bg-white/85 dark:bg-white/[0.08] dark:ring-white/[0.1]'
                      }`}
                    >
                      <AudioLines className={`h-4 w-4 ${previewingMyId === v.id ? 'animate-pulse' : ''}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除音色${v.name}`}
                      data-testid={`my-voice-delete-${v.id}`}
                      onClick={() => removeMyVoice(v.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[#FF3B30]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Input
                value={myVoiceName}
                onChange={(e) => setMyVoiceName(e.target.value)}
                placeholder="音色名字，如 温柔御姐"
                maxLength={20}
                data-testid="my-voice-name"
                aria-label="我的音色名字"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
              <Input
                value={myVoiceId}
                onChange={(e) => setMyVoiceId(e.target.value)}
                placeholder="音色 ID，如 female-shaonv / alloy / builtin:xiaoyue"
                data-testid="my-voice-id"
                aria-label="我的音色 ID"
                className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
              />
              <div className="flex flex-wrap gap-1.5">
                {BUILTIN_TTS_VOICES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setMyVoiceId(b.id)}
                    className={`rounded-full px-2 py-0.5 text-[11px] transition-all active:scale-[0.97] ${
                      myVoiceId.trim() === b.id
                        ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                        : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                    }`}
                  >
                    {b.name}·{b.gender === 'female' ? '女' : '男'}
                  </button>
                ))}
              </div>
              {myVoiceError && (
                <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[#FF3B30]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {myVoiceError}
                </p>
              )}
              <div className="flex gap-2">
                {/* 测试：不保存直接试听当前填写的音色（内置声线本地朗读，其它走当前语音 API） */}
                <button
                  type="button"
                  data-testid="my-voice-test"
                  aria-label="测试当前填写的音色"
                  onClick={() => void previewMyVoice({ id: '__draft__', voiceId: myVoiceId.trim() })}
                  disabled={!myVoiceId.trim()}
                  className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 disabled:opacity-50 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16] ${
                    previewingMyId === '__draft__' ? 'ring-2 ring-black/[0.15] dark:ring-white/[0.25]' : ''
                  }`}
                >
                  {previewingMyId === '__draft__' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
                  {previewingMyId === '__draft__' ? '测试中…' : '测试'}
                </button>
                <button
                  type="button"
                  data-testid="my-voice-add"
                  onClick={submitMyVoice}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-white/60 text-[14px] font-medium text-foreground shadow-[0_6px_20px_rgba(17,24,39,0.08)] ring-1 ring-white/70 backdrop-blur-2xl transition-all active:scale-[0.98] active:bg-white/85 dark:bg-white/[0.1] dark:ring-white/[0.12] dark:active:bg-white/[0.16]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  保存音色
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 语音识别 STT（转文字）：识别主通道 = Web Speech（浏览器原生实时识别）；内置识别模型已移除，
            服务端仅作可选兑底（OpenAI 兼容，配置后启用） */}
        <section>
          <SectionLabel icon={MessageSquareText} tone={TONE_GREEN}>语音识别 STT（转文字）</SectionLabel>
          <div className="flex flex-col gap-3 rounded-[22px] bg-white/55 p-4 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {/* 识别主通道：Web Speech（浏览器原生实时识别）——提示精简为一行 */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">浏览器实时识别（Web Speech）</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  通话免提与语音消息转写的主通道（免配置）；关闭后直发语音只有音频。
                  {wsSupport === null ? '' : wsSupport ? '当前浏览器：支持。' : '当前浏览器：不支持。'}
                </p>
              </div>
              <Switch
                checked={sttConfig.webSpeech}
                onCheckedChange={(v) => updateSttConfig({ webSpeech: v })}
                aria-label="浏览器实时识别（Web Speech）"
              />
            </div>

            {/* 离线识别（端侧模型，可选）：SenseVoice WASM 本地推理，下载后断网可用，
                按住说话/转文字优先本地，失败静默降级云端 */}
            <OfflineAsrSection />

            {/* 服务端兑底（可选）：提示精简为一行 */}
            <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
              <div className="text-[14px] font-medium text-foreground">服务端兑底（OpenAI 兼容，可选）</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
                浏览器识别不可用时的兑底；留空则只用浏览器实时识别。
                {sttConfig.provider === 'openai' && sttConfig.apiKey.trim() && sttConfig.baseUrl.trim()
                  ? '当前：已启用。'
                  : '当前：未启用。'}
              </p>
            </div>
            <>
                <div>
                  <FieldLabel>API 地址</FieldLabel>
                  <Input
                    value={sttConfig.baseUrl}
                    onChange={(e) => updateSttConfig({ provider: 'openai', baseUrl: e.target.value })}
                    placeholder="如 https://api.openai.com/v1"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                  />
                </div>
                <div>
                  <FieldLabel>API Key</FieldLabel>
                  <div className="relative">
                    <Input
                      type={showSttKey ? 'text' : 'password'}
                      value={sttConfig.apiKey}
                      onChange={(e) => updateSttConfig({ provider: 'openai', apiKey: e.target.value })}
                      placeholder="sk-…"
                      className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 pr-16 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSttKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground"
                    >
                      {showSttKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </div>
                <div>
                  <FieldLabel>识别模型（选填）</FieldLabel>
                  <Input
                    value={sttConfig.model}
                    onChange={(e) => updateSttConfig({ provider: 'openai', model: e.target.value })}
                    placeholder="如 whisper-1（留空用默认 whisper-1）"
                    className="h-11 rounded-[14px] border-black/[0.05] bg-white/55 text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_3px_10px_rgba(17,24,39,0.05)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_3px_10px_rgba(0,0,0,0.2)]"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['whisper-1', 'whisper-large-v3', 'SenseVoiceSmall'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateSttConfig({ provider: 'openai', model: m })}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] ${
                          sttConfig.model.trim() === m
                            ? 'bg-foreground font-medium text-background shadow-[0_4px_14px_rgba(17,24,39,0.18)]'
                            : 'bg-white/55 text-foreground/70 ring-1 ring-black/[0.06] backdrop-blur-xl hover:bg-white/80 dark:bg-white/[0.07] dark:text-foreground/70 dark:ring-white/[0.1] dark:hover:bg-white/[0.14]'
                        }`
                      }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </>
          </div>
        </section>

      </div>
    </DetailShell>
  );
}

// ---------------- 字体 ----------------

/**
 * 离线识别（端侧模型，可选）下载模块：
 * - 模型：SenseVoice int8（约 229 MB）+ tokens，阿里云 ModelScope 直链（国内直连不走 HF）；
 * - 缓存：浏览器 Cache API 持久化，只需下载一次；进度条实时更新（流式读取 Content-Length）；
 * - 主源失败自动切换备用源；下载完成自动注入 WASM 引擎（MEMFS），状态置「已就绪」；
 * - 就绪后按住说话/转文字优先本地识别（断网可用），失败静默降级云端 STT（stt-client 已接）。
 */
function OfflineAsrSection() {
  const { status, progress, sourceIndex, error } = useOfflineAsr();
  const [busy, setBusy] = useState(false);
  const [toastMsg, showToast] = useLocalToast();

  const totalMb = progress ? progress.total / 1048576 : 229;
  const loadedMb = progress ? progress.loaded / 1048576 : 0;

  const startDownload = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    useOfflineAsr.getState().set({
      status: 'downloading',
      error: null,
      progress: { loaded: 0, total: Math.round(totalMb * 1048576), pct: 0 },
    });
    try {
      await initOfflineAsr(); // 内部：下载（进度实时写 store）→ 注入 → ready 状态
      showToast('离线识别模型已就绪，按住说话优先本地识别');
    } catch {
      // 错误状态已由 offline-asr 内部写入（store.error），UI 展示
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async (): Promise<void> => {
    setBusy(true);
    try {
      await deleteOfflineModel();
      showToast('已删除端侧模型与本地缓存');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">离线识别（端侧模型，可选）</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/70">
            SenseVoice 中文端侧模型（约 229MB，仅下载一次）：断网也可识别。
          </p>
        </div>
      </div>

      {/* 状态区 */}
      {status === 'checking' && (
        <p className="mt-2 text-[12px] text-muted-foreground">正在检查本地缓存…</p>
      )}

      {(status === 'not-downloaded' || (status === 'error' && !busy)) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void startDownload()}
            disabled={busy}
            className="whitespace-nowrap rounded-xl bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-all active:scale-[0.97] disabled:opacity-50"
          >
            {status === 'error' ? '重试下载模型（约 229 MB）' : '下载模型（约 229 MB）'}
          </button>
          <p className="mt-1.5 text-[12px] text-muted-foreground/70">阿里云 ModelScope 直链，国内不绕墙</p>
        </div>
      )}

      {status === 'error' && error && (
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: IOS_RED }}>
          {error}
        </p>
      )}

      {status === 'downloading' && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.12]">
            <div
              className="h-full rounded-full bg-[#07C160] transition-[width] duration-300"
              style={{ width: `${Math.max(2, progress?.pct ?? 0)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              下载中 {progress ? `${progress.pct.toFixed(1)}%` : '准备中…'}
              {progress ? ` · ${loadedMb.toFixed(1)}/${totalMb.toFixed(0)} MB` : ''}
            </span>
            <span>{sourceIndex === 0 ? '主源' : '备用源'}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground/60">下载完成后自动注入引擎，可离开本页（下次进入续传整包）。</p>
        </div>
      )}

      {status === 'ready' && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[12px] text-[#07C160]">✓ 已就绪：按住说话优先本地识别（断网可用）</p>
          <button
            type="button"
            onClick={() => void removeModel()}
            disabled={busy}
            className="shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-[12px] text-muted-foreground ring-1 ring-black/[0.08] transition-all active:scale-[0.97] disabled:opacity-50 dark:ring-white/[0.12]"
          >
            删除模型
          </button>
        </div>
      )}
      <LocalToast msg={toastMsg} />
    </div>
  );
}

/** 字体列表玻璃卡：GrayCard 同款毛玻璃配方但无内边距（divide-y 行列表用，分隔线贴边） */
function FontListCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[22px] bg-white/55 shadow-[0_8px_28px_rgba(17,24,39,0.06)] ring-1 ring-white/70 backdrop-blur-2xl dark:divide-white/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.09]">
      {children}
    </div>
  );
}

/**
 * 字体设置页（Task 33-d）：
 * - 内置 10 款「纯 CSS 栈」字体（借用系统已有字体，无需字体文件），点选即全局实时生效；
 * - 顶部预览卡实时展示当前字体的中英文/数字/标点效果；
 * - 支持导入 .ttf/.otf/.woff/.woff2 字体文件：仅存本机独立 IndexedDB（ios-phone-fonts，绝不上传服务器），
 *   通过 FontFace API 动态注册后立即可用；
 * - 全局生效原理：把字体栈写入 documentElement 的 --app-font-family CSS 变量，
 *   body 的 font-family 引用该变量（globals.css）；重启后由 PhoneShell 调 ensureAppFontApplied() 恢复。
 */
function FontPage({ onBack }: { onBack: () => void }) {
  const appFontId = useSettings((s) => s.appFontId);
  const setAppFont = useSettings((s) => s.setAppFont);
  const appFontScale = useSettings((s) => s.appFontScale);
  const setAppFontScale = useSettings((s) => s.setAppFontScale);
  const appFontWeight = useSettings((s) => s.appFontWeight);
  const setAppFontWeight = useSettings((s) => s.setAppFontWeight);
  const [toast, showToast] = useLocalToast();
  const [customFonts, setCustomFonts] = useState<AppFontMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  // 两步删除确认：首点变红待确认，3 秒内再点才真删（超时自动复位）
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 自定义字体 FontFace 异步加载完成后 +1 触发重渲（否则预览/示例字样要等下一次渲染才能换新字体）
  const [previewLoadedTick, setPreviewLoadedTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挂载：读自定义字体列表 + 逐个预注册 FontFace（fire-and-forget，仅为预览提前就绪）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listCustomFonts();
        if (!alive) return;
        setCustomFonts(list);
        for (const f of list) {
          void loadCustomFontFace(f.id)
            .then(() => {
              if (alive) setPreviewLoadedTick((t) => t + 1);
            })
            .catch(() => undefined); // 预载失败静默：选中该字体时 applyAppFont 会再报错提示
        }
      } catch {
        // IndexedDB 不可用：列表保持为空
      }
    })();
    return () => {
      alive = false;
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
    };
  }, []);

  /** 点选字体：立即持久化 + 全局应用（不 toast，预览与界面即时可见）；失败才提示 */
  const pickFont = (id: string) => {
    setAppFont(id);
    void applyAppFont(id).catch((e) => {
      showToast(e instanceof Error ? e.message : '字体加载失败，请重试');
    });
  };

  /** 导入字体文件：校验扩展名 → 存本机 IndexedDB → 刷新列表（文件绝不上传服务器） */
  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) {
      showToast('仅支持 .ttf / .otf / .woff / .woff2 字体文件');
      return;
    }
    setUploading(true);
    try {
      const meta = await saveCustomFont(file.name, file);
      setCustomFonts(await listCustomFonts());
      // 后台预注册 FontFace：成功后预览/示例字样立即用上新字体
      void loadCustomFontFace(meta.id)
        .then(() => setPreviewLoadedTick((t) => t + 1))
        .catch(() => undefined);
      showToast(`已导入「${meta.name}」，点列表即可应用`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  /** 删除自定义字体：两步确认（首点变红，3 秒内再点执行；删的是当前字体则一并回默认） */
  const handleDeleteClick = (id: string) => {
    if (deletingId !== id) {
      setDeletingId(id);
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeletingId(null), 3000);
      return;
    }
    if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
    setDeletingId(null);
    void (async () => {
      try {
        await deleteCustomFont(id);
        setCustomFonts(await listCustomFonts());
        if (appFontId === id) {
          // 删的是正在使用的字体：回默认系统字体
          setAppFont('');
          try {
            await applyAppFont('');
          } catch {
            // removeProperty 不会失败，稳妥起见吞掉
          }
          showToast('已删除');
        } else {
          showToast('已从本机删除');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : '删除失败，请重试');
      }
    })();
  };

  // 当前字体的名字与预览栈（appFontId='' → 默认系统字体 = 内置第一项的栈）
  const currentBuiltin = BUILTIN_APP_FONTS.find((f) => f.id === appFontId);
  const currentCustom = appFontId.startsWith('custom:') ? customFonts.find((f) => f.id === appFontId) : undefined;
  const currentName = currentBuiltin?.name ?? currentCustom?.name ?? (appFontId ? '自定义字体' : 'iOS 系统字体（默认）');
  const previewStack = currentBuiltin?.stack ?? currentCustom?.stack ?? BUILTIN_APP_FONTS[0].stack;

  return (
    <DetailShell title="字体" onBack={onBack} gray>
      <div className="flex flex-col gap-5">
        {/* 预览卡片（当前字体实时预览） */}
        <GrayCard>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{currentName}</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">点下方任意字体立即全局生效</p>
            </div>
            <span className="shrink-0 rounded-full bg-foreground/90 px-2.5 py-1 text-[11px] font-medium text-background">
              当前使用
            </span>
          </div>
          <div
            key={previewLoadedTick}
            data-testid="font-page-preview"
            className="mt-3 rounded-[16px] bg-white/45 px-4 py-3 ring-1 ring-white/70 dark:bg-white/[0.05] dark:ring-white/[0.08]"
            style={{ fontFamily: previewStack }}
          >
            <p className="text-[24px] leading-relaxed">字体预览 Aa Bb Cc 123</p>
            <p className="text-[24px] leading-relaxed">你好，世界！Hello, World! 永东国爱</p>
            <p className="text-[24px] leading-relaxed">0123456789 ，。？！：；「」《》～</p>
          </div>
        </GrayCard>

        {/* 字体大小（Task 36：calc 只缩放文字、界面框架尺寸不变，全 App 实时生效） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">字体大小</div>
          <GrayCard>
            <div className="flex flex-wrap items-center gap-2" data-testid="font-scale-group">
              {FONT_SCALE_OPTIONS.map((o) => {
                const active = Math.abs(appFontScale - o.scale) < 0.001;
                return (
                  <button
                    key={o.scale}
                    type="button"
                    data-testid={`font-scale-${o.scale}`}
                    aria-pressed={active}
                    onClick={() => {
                      setAppFontScale(o.scale);
                      applyAppFontScale(o.scale);
                    }}
                    className={`rounded-full px-4 py-2 text-[13.5px] shadow-[0_2px_10px_rgba(17,24,39,0.05)] backdrop-blur-xl transition-all active:scale-[0.95] ${
                      active
                        ? 'bg-foreground text-background shadow-[0_4px_14px_rgba(0,0,0,0.16)]'
                        : 'bg-white/55 text-black/75 ring-1 ring-white/70 hover:bg-white/80 dark:bg-white/[0.08] dark:text-white/80 dark:ring-white/[0.1] dark:hover:bg-white/[0.13]'
                    }`}
                  >
                    {o.label}
                    <span className="ml-1 text-[11px] opacity-60">{Math.round(o.scale * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </GrayCard>
        </section>

        {/* 字体粗细（body font-weight 变量；标题等显式字重不受影响） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">字体粗细</div>
          <GrayCard>
            <div className="flex flex-wrap items-center gap-2" data-testid="font-weight-group">
              {FONT_WEIGHT_OPTIONS.map((o) => {
                const active = appFontWeight === o.weight;
                return (
                  <button
                    key={o.weight}
                    type="button"
                    data-testid={`font-weight-${o.weight}`}
                    aria-pressed={active}
                    onClick={() => {
                      setAppFontWeight(o.weight);
                      applyAppFontWeight(o.weight);
                    }}
                    style={{ fontWeight: o.weight }}
                    className={`rounded-full px-4 py-2 text-[13.5px] shadow-[0_2px_10px_rgba(17,24,39,0.05)] backdrop-blur-xl transition-all active:scale-[0.95] ${
                      active
                        ? 'bg-foreground text-background shadow-[0_4px_14px_rgba(0,0,0,0.16)]'
                        : 'bg-white/55 text-black/75 ring-1 ring-white/70 hover:bg-white/80 dark:bg-white/[0.08] dark:text-white/80 dark:ring-white/[0.1] dark:hover:bg-white/[0.13]'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
              大小全局生效（含以后新增的界面）；粗细对正文生效，标题/按钮等已加粗的文字保持原样。
            </p>
          </GrayCard>
        </section>

        {/* 内置字体（纯 CSS 栈，点击即应用） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">内置字体</div>
          <FontListCard>
            {BUILTIN_APP_FONTS.map((f) => {
              const selected = appFontId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  data-testid={`font-builtin-${f.id.replace('builtin:', '')}`}
                  onClick={() => pickFont(f.id)}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px]">{f.name}</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground" style={{ fontFamily: f.stack }}>
                    Aa 永东 123
                  </span>
                  {selected && <Check className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2.6} />}
                </button>
              );
            })}
          </FontListCard>
        </section>

        {/* 我的字体（本机保存，绝不上传） */}
        <section>
          <div className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">我的字体（本机保存）</div>
          <GrayCard>
            <div className="flex flex-col gap-1">
              {customFonts.map((f) => {
                const selected = appFontId === f.id;
                const confirming = deletingId === f.id;
                return (
                  <div key={f.id} className="flex min-h-[52px] items-center gap-2 py-2">
                    <button
                      type="button"
                      data-testid={`font-custom-${f.id.replace('custom:', '')}`}
                      onClick={() => pickFont(f.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{f.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{f.fileName}</span>
                      </span>
                      <span
                        className="shrink-0 text-[13px] text-muted-foreground"
                        style={{ fontFamily: `'${customFontFamilyOf(f.id)}', -apple-system, sans-serif` }}
                      >
                        Aa 永东 123
                      </span>
                      {selected && <Check className="h-5 w-5 shrink-0 text-foreground" strokeWidth={2.6} />}
                    </button>
                    <button
                      type="button"
                      data-testid={`font-delete-${f.id.replace('custom:', '')}`}
                      onClick={() => handleDeleteClick(f.id)}
                      aria-label={confirming ? `再次点击确认删除「${f.name}」` : `删除「${f.name}」`}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all active:scale-[0.94] ${
                        confirming
                          ? 'bg-[#FF3B30]/15 text-[#FF3B30] ring-1 ring-[#FF3B30]/40'
                          : 'bg-white/60 text-muted-foreground ring-1 ring-black/[0.06] hover:text-[#FF3B30] dark:bg-white/[0.08] dark:ring-white/[0.1]'
                      }`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              {customFonts.length === 0 && (
                <p className="py-2 text-center text-[13px] text-muted-foreground">还没有导入字体，点下方按钮从文件导入</p>
              )}

              {/* 导入按钮 + 隐藏文件选择器 */}
              <div className="pt-1.5">
                <button
                  type="button"
                  data-testid="font-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 rounded-[14px] bg-white/55 px-4 py-2.5 text-[14px] shadow-[0_2px_10px_rgba(17,24,39,0.05)] ring-1 ring-white/70 backdrop-blur-xl transition-all active:scale-[0.97] disabled:opacity-60 dark:bg-white/[0.08] dark:ring-white/[0.1]"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? '导入中…' : '导入字体文件（.ttf / .otf / .woff / .woff2）'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  data-testid="font-upload-input"
                  className="hidden"
                  onChange={(e) => void handleUpload(e)}
                />
              </div>
            </div>
          </GrayCard>
        </section>

        <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
          字体文件仅保存在本机浏览器（IndexedDB），不会上传服务器；清除浏览器数据会一并删除。
        </p>
      </div>
      <LocalToast msg={toast} />
    </DetailShell>
  );
}

// ---------------- 根组件 ----------------

export default function SettingsApp() {
  // 跨 App 跳转（X 论坛「生图模型」入口等）：别的 App switchToApp('settings') 前写入
  // pendingSettingsPage，这里挂载时读取直接进对应设置页（如 imggen 图像生成）。
  // 消费清空放到挂载后的 effect 里——渲染期间写 store 会触发「渲染中更新其它组件」告警。
  const [page, setPage] = useState<Page>(() => {
    const pending = useUI.getState().pendingSettingsPage;
    if (pending && ['root', 'account', 'profile', 'theme', 'notification', 'storage', 'wallpaper', 'font', 'api', 'vision', 'imggen', 'voice', 'about', 'lock'].includes(pending)) {
      return pending as Page;
    }
    return 'root';
  });
  useEffect(() => {
    if (useUI.getState().pendingSettingsPage) useUI.getState().setPendingSettingsPage(null);
  }, []);

  return (
    <IOSScreen className="relative">
      {page === 'root' && <RootPage onOpen={setPage} />}
      {page === 'account' && <AccountSwitchPage onBack={() => setPage('root')} />}
      {page === 'profile' && <ProfilePage onBack={() => setPage('root')} />}
      {page === 'theme' && <ThemePage onBack={() => setPage('root')} />}
      {page === 'notification' && <NotificationPage onBack={() => setPage('root')} />}
      {page === 'storage' && <StoragePage onBack={() => setPage('root')} />}
      {page === 'wallpaper' && <WallpaperPage onBack={() => setPage('root')} />}
      {page === 'api' && <ApiPage onBack={() => setPage('root')} />}
      {page === 'vision' && <VisionPage onBack={() => setPage('root')} />}
      {page === 'imggen' && <ImageGenPage onBack={() => setPage('root')} />}
      {page === 'voice' && <VoicePage onBack={() => setPage('root')} />}
      {page === 'font' && <FontPage onBack={() => setPage('root')} />}
      {page === 'lock' && <LockPage onBack={() => setPage('root')} />}
      {page === 'about' && <AboutPage onBack={() => setPage('root')} />}
    </IOSScreen>
  );
}
