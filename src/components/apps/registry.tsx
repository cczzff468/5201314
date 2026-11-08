'use client';

import { cloneElement, isValidElement, useId, type ComponentType, type ReactElement, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  AudioLines,
  BookMarked,
  BrainCircuit,
  Calculator as CalculatorIcon,
  CalendarDays,
  Camera,
  CircleCheck,
  Clock as ClockIcon,
  CloudSun,
  Compass,
  FileText,
  Folder,
  Ghost,
  Heart as HeartIcon,
  House as HouseIcon,
  Image as ImageIcon,
  MessageCircle,
  Music2,
  Palette,
  Phone as PhoneGlyph,
  Settings as SettingsIcon,
  ShoppingBag,
  Store,
  UtensilsCrossed,
  Users as UsersIcon,
} from 'lucide-react';
import type { AppId, IconStyle } from '@/lib/ios/store';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { useHomeWallpaperLight } from '@/lib/ios/foreground';
import AppSplash from './AppSplash';

// App 组件全部懒加载：主屏/锁屏只需图标，App 代码在点开时才拉取
// （首屏包体积大幅下降，网页打开/水合明显变快）
// loading=AppSplash：chunk 未就绪期间显示 iOS 风格启动屏（大图标+名+菊花转，
// 延迟 150ms 淡入不闪屏）——修「点击打开界面一块空白等好几秒」的观感问题
const ChatApp = dynamic(() => import('./chat'), { ssr: false, loading: () => <AppSplash appId="chat" /> });
const PhotosApp = dynamic(() => import('./photos'), { ssr: false, loading: () => <AppSplash appId="photos" /> });
const CameraApp = dynamic(() => import('./camera'), {
  ssr: false,
  loading: () => <AppSplash appId="camera" />,
}) as ComponentType;
const MusicApp = dynamic(() => import('./music'), { ssr: false, loading: () => <AppSplash appId="music" /> });
const BrowserApp = dynamic(() => import('./browser'), { ssr: false, loading: () => <AppSplash appId="browser" /> });
const WeatherApp = dynamic(() => import('./weather'), { ssr: false, loading: () => <AppSplash appId="weather" /> });
const ClockApp = dynamic(() => import('./clock'), { ssr: false, loading: () => <AppSplash appId="clock" /> });
const ThemesApp = dynamic(() => import('./themes'), { ssr: false, loading: () => <AppSplash appId="themes" /> });
const FilesApp = dynamic(() => import('./files'), { ssr: false, loading: () => <AppSplash appId="files" /> });
const RemindersApp = dynamic(() => import('./reminders'), {
  ssr: false,
  loading: () => <AppSplash appId="reminders" />,
});
const CalculatorApp = dynamic(() => import('./calculator'), {
  ssr: false,
  loading: () => <AppSplash appId="calculator" />,
});
const NotesApp = dynamic(() => import('./notes'), { ssr: false, loading: () => <AppSplash appId="notes" /> });
const CalendarApp = dynamic(() => import('./calendar'), {
  ssr: false,
  loading: () => <AppSplash appId="calendar" />,
});
const RecorderApp = dynamic(() => import('./recorder'), {
  ssr: false,
  loading: () => <AppSplash appId="recorder" />,
});
const SettingsApp = dynamic(() => import('./settings'), {
  ssr: false,
  loading: () => <AppSplash appId="settings" />,
});
const ContactsApp = dynamic(() => import('./contacts'), {
  ssr: false,
  loading: () => <AppSplash appId="contacts" />,
});
const PhoneApp = dynamic(() => import('./phone'), { ssr: false, loading: () => <AppSplash appId="phone" /> });
const WeChatApp = dynamic(() => import('./wechat'), { ssr: false, loading: () => <AppSplash appId="wechat" /> });
const QQApp = dynamic(() => import('./qq'), { ssr: false, loading: () => <AppSplash appId="qq" /> });
const AppStoreApp = dynamic(() => import('./appstore'), {
  ssr: false,
  loading: () => <AppSplash appId="appstore" />,
});
const MemoryBankApp = dynamic(() => import('./memory-bank'), {
  ssr: false,
  loading: () => <AppSplash appId="memory" />,
});
const WorldBookApp = dynamic(() => import('./worldbook'), {
  ssr: false,
  loading: () => <AppSplash appId="worldbook" />,
});
const MeituanApp = dynamic(() => import('./meituan'), {
  ssr: false,
  loading: () => <AppSplash appId="meituan" />,
});
const TaobaoApp = dynamic(() => import('./taobao'), {
  ssr: false,
  loading: () => <AppSplash appId="taobao" />,
});
const CoupleSpaceApp = dynamic(() => import('./couple-space'), {
  ssr: false,
  loading: () => <AppSplash appId="couple" />,
});
const CottageApp = dynamic(() => import('./cottage'), {
  ssr: false,
  loading: () => <AppSplash appId="cottage" />,
});
const ForumApp = dynamic(() => import('./forum/forum'), { ssr: false, loading: () => <AppSplash appId="forum" /> });

export interface AppMeta {
  id: AppId;
  name: string;
  icon: ReactNode;
  component: ComponentType;
  /** 状态栏强制白字（App 顶部背景非背景色系时用：天气蓝天/相机黑底）；缺省=跟随主题明暗 */
  statusBarLight?: boolean;
  /** App 自管屏幕级基调（音乐 App 各页面按背景明暗自行 push/pop）；
   *  true 时自动基调探针不介入（双方都推栈会互相打架） */
  statusBarToneSelfManaged?: boolean;
}

function IconTile({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={`flex h-full w-full items-center justify-center ${className}`}>{children}</div>;
}

/** 线条样式图标（用户参考图：iOS 磨砂玻璃风）——满槽半透明磨砂圆角方形底座
 *  （backdrop-blur 模糊底下壁纸，磨砂质感）+ 粗线条图标，无虚线边框；
 *  深色主题统一「深色烟熏玻璃 + 白色粗线条」（适配深色模式，与壁纸明暗无关）；
 *  浅色主题按主屏幕壁纸明暗自适应（图标画在壁纸上）：深色壁纸上淡白磨砂 + 白线、
 *  浅色壁纸上高白磨砂 + 深灰线保证可见；
 *  壁纸明暗与标签文字同源（useHomeWallpaperLight：图片/自定义壁纸逐像素实测亮度，
 *  静态预设标记仅作测量前兜底）——修「浅色主题 + 自定义白色背景图」时底座/边框/
 *  线条全是白色画在白纸上看不见的问题；自定义壁纸不再硬编码按深色处理；
 *  内缘顶部一道细高光（玻璃质感）；线条加粗（用户要求「里面的变粗一点」）；
 *  variant="card"：卡片底色场景（主题页预览等）强制浅磨砂玻璃 + 深灰线，
 *  不随壁纸/主题翻转（修浅色主题 + 深色壁纸时白线画在浅卡上一片空白） */
function LineIcon({ children, variant = 'auto' }: { children: ReactNode; variant?: 'auto' | 'card' }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = variant === 'card' ? false : selectResolvedTheme(themeMode, systemDark) === 'dark';
  // 壁纸实测亮度（hooks 无条件调用；card 场景不消费结果）
  const lightWallpaper = useHomeWallpaperLight();
  // 卡片场景强制高白磨砂深灰线；壁纸场景：浅色主题 + 浅色壁纸 → 高白磨砂深灰线，
  // 其余（深色主题任意壁纸 / 浅色主题深壁纸）→ 深玻璃白线
  const lightGlass = variant === 'card' ? true : lightWallpaper;
  return (
    <IconTile className={lightGlass ? 'text-[#48484e]' : 'text-[#f6f6f8]'}>
      <span
        aria-hidden="true"
        className={`flex h-full w-full items-center justify-center rounded-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ring-1 backdrop-blur-[8px] ${
          lightGlass
            ? 'bg-white/60 ring-black/[0.06]'
            : dark
              ? 'bg-black/[0.32] ring-white/[0.14]'
              : 'bg-white/[0.16] ring-white/[0.12]'
        }`}
      >
        {children}
      </span>
    </IconTile>
  );
}

/** 液态透明图标（图标样式第三选）：比毛玻璃更透的「液态玻璃泡」——
 *  底座近乎全透明（轻模糊只留一点折射感）+ 上下渐变模拟玻璃顶部高光/底部反光 + 亮边 ring；
 *  与 LineIcon 同一套明暗口径：浅色主题 + 浅色壁纸 → 深灰线保证可见，
 *  深色主题 / 深色壁纸 → 白线 + 白高光；第六十六轮液态透明适配深色模式：
 *  深色主题专属「烟熏暗玻璃」分支（深色微透底 + 减弱白高光 + 白/18 ring），
 *  与浅色主题画在深壁纸上的「亮玻璃白线」区分开；variant="card"：卡片底色场景强制
 *  烟熏玻璃白线不随壁纸翻转（同 LineIcon card 口径，主题页预览用） */
function LiquidIcon({ children, variant = 'auto' }: { children: ReactNode; variant?: 'auto' | 'card' }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = variant === 'card' ? false : selectResolvedTheme(themeMode, systemDark) === 'dark';
  const lightWallpaper = useHomeWallpaperLight();
  const lightGlass = variant === 'card' ? false : lightWallpaper;
  return (
    <IconTile className={lightGlass ? 'text-[#4b4b53]' : 'text-[#f8f8fb]'}>
      <span
        aria-hidden="true"
        className={`flex h-full w-full items-center justify-center rounded-[15px] ring-1 backdrop-blur-[2px] ${
          lightGlass
            ? 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.52),rgba(255,255,255,0.16)_45%,rgba(0,0,0,0.03))] shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_8px_rgba(0,0,0,0.08)] ring-black/[0.10]'
            : variant === 'card'
              ? 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.34),rgba(120,120,128,0.18)_45%,rgba(60,60,67,0.30))] shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.40),0_2px_8px_rgba(0,0,0,0.14)] ring-white/[0.35]'
              : dark
                ? 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_45%,rgba(0,0,0,0.22))] shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.22),0_2px_10px_rgba(0,0,0,0.38)] ring-white/[0.20]'
                : 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.28),rgba(255,255,255,0.06)_45%,rgba(255,255,255,0.13))] shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.44),0_2px_10px_rgba(0,0,0,0.11)] ring-white/[0.36]'
        }`}
      >
        {children}
      </span>
    </IconTile>
  );
}

/** 真实 iOS 图标（public/icons 的 PNG：自带彩色圆角底），满槽铺满图标位。
 *  图片自带透明圆角（约 22%），稍微放大 1.07 让自身圆角越过容器边被裁掉，
 *  最终圆角完全由容器 rounded-[15px] 决定，十枚图标圆角绝对一致；
 *  附极淡描边 + 柔和投影——备忘录/照片/文件/提醒事项这类白底图标在白色
 *  壁纸/卡片上也有清晰边界（修之前线条图标在白纸上「隐身」的痛点）。
 *  彩色实体底不随壁纸/主题翻转，任何背景下都醒目（第六十七轮：用户要求真实图标
 *  不用适配深色模式——旧版深色主题切 /icons-dark 专属变体已废弃，始终用原图）；
 *  variant="card"：卡片底色场景（主题页预览等固定浅色卡底），同一张原图 */

function RealIconTile({ src }: { src: string; variant?: 'auto' | 'card' }) {
  return (
    <IconTile>
      <span
        aria-hidden="true"
        className="relative block h-full w-full overflow-hidden rounded-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.06]"
      >
        {/* v79 预览提速：改用原生 <img> 直连静态文件——dev 下 next/image 优化器
            强制 max-age=0，预览走外网网关时每次刷新都要逐张重验证（每张一个 RTT，
            观感是图标慢慢冒出来）；源图已压到 ≤83KB 且静态路径带 24h 强缓存，
            原生 <img> 冷加载更快、二次加载零请求。lazy 保留：非当前页图标
            推迟到滑动接近时再拉 */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-full w-full scale-[1.07] select-none object-cover"
        />
      </span>
    </IconTile>
  );
}

const GLYPH_CLASS = 'h-[30px] w-[30px]';
const GLYPH_STROKE = 2.2;

/** 微信图标：经典双气泡线稿，与其他 App 图标完全同规格——同一磨砂底座（LineIcon 统一
 *  包装）、同 30px 尺寸（GLYPH_CLASS）、同粗线条（GLYPH_STROKE）；大气泡左上、小气泡
 *  右下带一圈留白缝的前后遮挡（SVG mask 挖断大气泡描边，useId 保证多实例不撞 id），
 *  弧线尾巴 + 2+2 实心眼点 */
function WeChatGlyph() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `wx-${uid}`;
  return (
    <svg
      viewBox="0 0 24 24"
      className={GLYPH_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        {/* 大气泡描边在小气泡（外扩一圈留白缝）处干净断开 */}
        <mask id={maskId}>
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <circle cx="16.6" cy="14.4" r="5.6" fill="#000" />
        </mask>
      </defs>
      {/* 大气泡（左上）+ 左下弧线尾巴 */}
      <g mask={`url(#${maskId})`}>
        <ellipse cx="9.8" cy="8.6" rx="6.6" ry="5.7" />
        <path d="M5.2 12.4C4.4 14 3.3 15.3 2 16.2c2.2-.2 4.1-1 5.7-2.4" />
      </g>
      {/* 小气泡（右下，叠在大气泡前，留白缝隔开）+ 右下弧线尾巴 */}
      <circle cx="16.6" cy="14.4" r="4.7" />
      <path d="M19.4 18c.6 1.4 1.5 2.6 2.7 3.5-1.9-.1-3.6-.9-5-2.2" />
      {/* 2+2 实心眼点 */}
      <circle cx="7.4" cy="7.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.2" cy="7.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.9" cy="13.2" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="18.3" cy="13.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** X论坛品牌图标：X 官方 wordmark 𝕏（currentColor 实心填充）——毛玻璃/液态样式的线条图 */
function ForumGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={GLYPH_CLASS} fill="currentColor" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

/** X论坛真实图标改用用户提供的官方 PNG（public/icons/forum.png） */

/** App 定义表：glyph 为裸线条图（不含磨砂底座）；image 为真实图标图片（public 下
 *  路径，满槽实体图标），两者可并存，icon 生成时优先用 image */
interface AppDef {
  id: AppId;
  name: string;
  glyph: ReactNode;
  image?: string;
  component: ComponentType;
  statusBarLight?: boolean;
  statusBarToneSelfManaged?: boolean;
}

const APP_DEFS: AppDef[] = [
  {
    id: 'photos',
    name: '照片',
    image: '/icons/photos.png',
    glyph: <ImageIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: PhotosApp,
  },
  {
    id: 'weather',
    name: '天气',
    image: '/icons/weather.png',
    glyph: <CloudSun className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: WeatherApp,
    statusBarLight: true,
  },
  {
    id: 'clock',
    name: '时钟',
    image: '/icons/clock.png',
    glyph: <ClockIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ClockApp,
  },
  {
    id: 'calculator',
    name: '计算器',
    image: '/icons/calculator.png',
    glyph: <CalculatorIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CalculatorApp,
  },
  {
    id: 'notes',
    name: '备忘录',
    image: '/icons/notes.png',
    glyph: <FileText className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: NotesApp,
  },
  {
    id: 'calendar',
    name: '日历',
    image: '/icons/calendar.png',
    glyph: <CalendarDays className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CalendarApp,
  },
  {
    id: 'recorder',
    name: '语音备忘录',
    image: '/icons/recorder.png',
    glyph: <AudioLines className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: RecorderApp,
  },
  {
    id: 'reminders',
    name: '提醒事项',
    image: '/icons/reminders.png',
    glyph: <CircleCheck className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: RemindersApp,
  },
  {
    id: 'files',
    name: '文件',
    image: '/icons/files.png',
    glyph: <Folder className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: FilesApp,
  },
  {
    id: 'wechat',
    name: '微信',
    image: '/icons/wechat.png',
    glyph: <WeChatGlyph />,
    component: WeChatApp,
  },
  {
    id: 'qq',
    name: 'QQ',
    image: '/icons/qq.png',
    // 备用线条图（有 image 时不会展示）：幽灵轮廓贴近 QQ 企鹅剪影
    glyph: <Ghost className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: QQApp,
  },
  {
    id: 'contacts',
    name: '联系人',
    image: '/icons/contacts.png',
    glyph: <UsersIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ContactsApp,
  },
  {
    id: 'phone',
    name: '电话',
    image: '/icons/phone.png',
    glyph: <PhoneGlyph className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: PhoneApp,
  },
  {
    id: 'settings',
    name: '设置',
    image: '/icons/settings.png',
    glyph: <SettingsIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: SettingsApp,
  },
  {
    id: 'themes',
    name: '主题',
    image: '/icons/themes.png',
    glyph: <Palette className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ThemesApp,
  },
  {
    id: 'chat',
    name: '信息',
    image: '/icons/chat.png',
    glyph: <MessageCircle className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ChatApp,
  },
  {
    id: 'browser',
    name: '浏览器',
    image: '/icons/browser.png',
    glyph: <Compass className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: BrowserApp,
  },
  {
    id: 'music',
    name: '音乐',
    image: '/icons/music.png',
    glyph: <Music2 className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: MusicApp,
    // 音乐 App 各页面（白底首页/搜索 ⇄ 深色播放页）自行 push/pop 基调（第三十三轮），
    // 自动基调探针不介入（statusBarToneSelfManaged），否则双方推栈互相打架
    statusBarToneSelfManaged: true,
  },
  {
    id: 'camera',
    name: '相机',
    image: '/icons/camera.png',
    glyph: <Camera className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CameraApp,
    statusBarLight: true,
  },
  {
    id: 'appstore',
    name: 'App Store',
    image: '/icons/appstore.png',
    glyph: <Store className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: AppStoreApp,
  },
  {
    id: 'memory',
    name: '记忆库',
    image: '/icons/memory-helper.png',
    glyph: <BrainCircuit className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: MemoryBankApp,
  },
  {
    id: 'worldbook',
    name: '世界书',
    image: '/icons/worldbook.png',
    // 备用线条图（有 image 时不会展示）：书本图案贴近用户提供的实体图标
    glyph: <BookMarked className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: WorldBookApp,
  },
  {
    id: 'meituan',
    name: '美团',
    image: '/icons/meituan-app.png',
    // 备用线条图（有 image 时不会展示）：外卖袋贴近美团黄袋形象
    glyph: <UtensilsCrossed className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: MeituanApp,
  },
  {
    id: 'taobao',
    name: '淘宝',
    // 真实图标：用户提供的天猫双11版淘宝 App 图标（真实图标样式/卡片底色/Spotlight 生效）
    image: '/icons/taobao.png',
    // 备用线条图（毛玻璃/液态样式时展示）：用户指定恢复以前的购物袋线条「以前的那个就好」
    glyph: <ShoppingBag className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: TaobaoApp,
  },
  {
    id: 'couple',
    name: '情侣空间',
    // 真实图标：白灰双心定制版（用户指定白/浅灰配色，不用粉红）；v49 按用户要求定名「情侣空间」
    image: '/icons/couple.png',
    // 备用线条图（毛玻璃/液态样式时展示）：双心轮廓
    glyph: <HeartIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CoupleSpaceApp,
  },
  {
    id: 'cottage',
    name: '拾光小屋',
    // 真实图标：用户提供的双猫看海图标（卡普喔风）——原「情侣小家」独立成 App（用户指定命名）
    image: '/icons/cottage.png',
    // 备用线条图（毛玻璃/液态样式时展示）：小屋轮廓
    glyph: <HouseIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CottageApp,
  },
  {
    id: 'forum',
    name: 'X论坛',
    // 真实图标：用户提供的 X（前身为 Twitter）官方 App 图标（1024×1024 透明底 PNG）
    image: '/icons/forum.png',
    // 线条图（毛玻璃/液态样式时展示）：X wordmark 实心
    glyph: <ForumGlyph />,
    component: ForumApp,
  },
];

/** appId → 真实图标原图路径（有 image 字段的 App），供卡片底色场景（AppIconTile）复用 */
const IMAGES = Object.fromEntries(
  APP_DEFS.filter((d) => d.image).map((d) => [d.id, d.image]),
) as Partial<Record<AppId, string>>;

/** appId → 图标原图路径（无则 null）。文件夹迷你缩略图等需要绕过 60px 图标壳
 *  （RealIconTile 自带 rounded-[15px] 裁切，缩到 14px 会被钳制成圆形裁切，
 *  与外层裁切、PNG 自带圆角叠加把四角削成八边形）直接平铺原图的场景使用 */
export function appImage(id: AppId): string | null {
  return IMAGES[id] ?? null;
}

/** 壁纸上的图标（主屏网格 / Dock / Spotlight / 多任务）：真实 iOS 图标满槽铺满；
 *  其余磨砂玻璃底座随壁纸明暗自适应 */
export const APPS: AppMeta[] = APP_DEFS.map(({ glyph, image, id, ...rest }) => ({
  ...rest,
  id,
  icon: image ? <RealIconTile src={image} /> : <LineIcon>{glyph}</LineIcon>,
}));

/** 各 App 裸线条图（appId → glyph），供卡片底色场景（AppIconTile）重组使用 */
const GLYPHS = Object.fromEntries(APP_DEFS.map((d) => [d.id, d.glyph])) as Record<AppId, ReactNode>;

/** 卡片底色上的图标预览（主题页「自定义图标」区、App Store 列表等）：真实 iOS 图标
 *  原样展示（自带彩色底任何卡片上都清晰）；线条图标 App 强制「浅磨砂玻璃底座 +
 *  深灰线条」不随壁纸/主题翻转——修复浅色主题 + 深色壁纸时预览一片空白 */
export function AppIconTile({ id }: { id: AppId }) {
  const image = IMAGES[id];
  if (image) return <RealIconTile src={image} variant="card" />;
  return <LineIcon variant="card">{GLYPHS[id]}</LineIcon>;
}

/** 按全局「图标样式」渲染的动态 App 图标（主屏/文件夹/Spotlight/多任务等壁纸场景）：
 *  real=真实图标（有 image 用实体 PNG，无则磨砂线条）；glass=毛玻璃图标（全部磨砂
 *  玻璃底座 + 粗线条，忽略实体图——「把图标变成毛玻璃粗线条」）；liquid=液态透明。
 *  自定义图标（主题页上传）由调用方优先处理，不经过这里。
 *  variant='card'：卡片底色场景（主题页「图标样式」预览），毛玻璃/液态强制
 *  「浅磨砂/烟熏玻璃 + 白线/深灰线」不随壁纸翻转 */
export function AppIconById({ id, variant = 'auto' }: { id: AppId; variant?: 'auto' | 'card' }) {
  const style = useSettings((s) => s.iconStyle);
  if (style === 'liquid') return <LiquidIcon variant={variant}>{GLYPHS[id]}</LiquidIcon>;
  if (style === 'glass') return <LineIcon variant={variant}>{GLYPHS[id]}</LineIcon>;
  const image = IMAGES[id];
  if (image) return <RealIconTile src={image} />;
  return <LineIcon variant={variant}>{GLYPHS[id]}</LineIcon>;
}

/** 图标样式选择器的固定预览（主题页「图标样式」三选一）：每张预览永远按自己代表的
 *  样式渲染（不随全局 iconStyle 翻转），用户在任意选中态下都能对比三种样式的真实长相 */
export function AppStylePreview({ id, style }: { id: AppId; style: IconStyle }) {
  if (style === 'liquid') return <LiquidIcon variant="card">{GLYPHS[id]}</LiquidIcon>;
  if (style === 'glass') return <LineIcon variant="card">{GLYPHS[id]}</LineIcon>;
  const image = IMAGES[id];
  if (image) return <RealIconTile src={image} variant="card" />;
  return <LineIcon variant="card">{GLYPHS[id]}</LineIcon>;
}

/** 文件夹迷你缩略图（HomeScreen folderIconNode 用，14px 级别）——跟随全局「图标样式」三态
 *  （Task 43：旧版永远直铺实体 PNG，主屏换成毛玻璃/液态后文件夹预览不跟着变，用户实测反馈）：
 *  ① custom（主题页上传的自定义图标）永远最优先，直铺原图；
 *  ② real=直铺实体 PNG 原图——继续绕过 60px 图标壳（RealIconTile 的 rounded-[15px]
 *     缩到 14px 会被钟制成圆形裁切，与外层裁切叠加把四角削成八边形），且不再 scale-1.3
 *     放大（会把 PNG 边缘内容/文字裁掉，用户实测），PNG 自带圆角半径 ≈22% 与容器
 *     rounded-[3.5px] 几乎重合，四角干净；
 *  ③ glass/liquid=迷你玻璃底座 + 粗线条（不能复用 LineIcon/LiquidIcon——它们内层
 *     rounded-[15px] 在 14px 下会被钟制成胶囊；这里按同套明暗口径收成迷你圆角方），
 *     glyph 用 cloneElement 缩到 46% 并加粗线宽（视觉 ≈0.9px，14px 下仍清晰）；
 *  real 无实体图的 App 同样走线条底座（与 AppIconById 口径一致） */
export function AppMiniIcon({ id, custom }: { id: AppId; custom?: string | null }) {
  const style = useSettings((s) => s.iconStyle);
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  // 壁纸实测亮度（文件夹迷你图标同样画在壁纸上，与主屏图标同源明暗）
  const lightWallpaper = useHomeWallpaperLight();
  if (custom) {
    return <img src={custom} alt="" draggable={false} className="block h-full w-full select-none object-cover" />;
  }
  const image = IMAGES[id];
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  if (style === 'real' && image) {
    // 真实图标不再适配深色模式（第六十七轮）：始终直铺原图，与主屏 RealIconTile 同源
    return <img src={image} alt="" draggable={false} className="block h-full w-full select-none object-cover" />;
  }
  // 迷你玻璃缩略图同样画在壁纸上：明暗跟壁纸走（第六十七轮，同 LineIcon/LiquidIcon 口径）
  const lightGlass = lightWallpaper;
  const raw = GLYPHS[id];
  const glyph = isValidElement(raw)
    ? cloneElement(raw as ReactElement<{ className?: string; strokeWidth?: number }>, {
        className: undefined,
        strokeWidth: 3.4,
      })
    : raw;
  const tile =
    style === 'liquid'
      ? lightGlass
        ? 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.52),rgba(255,255,255,0.16)_45%,rgba(0,0,0,0.03))] shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_1px_3px_rgba(0,0,0,0.06)] ring-black/[0.10] text-[#4b4b53]'
        : dark
          ? 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_45%,rgba(0,0,0,0.22))] shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.22),0_1px_4px_rgba(0,0,0,0.3)] ring-white/[0.20] text-[#f8f8fb]'
          : 'bg-[linear-gradient(to_bottom,rgba(255,255,255,0.28),rgba(255,255,255,0.06)_45%,rgba(255,255,255,0.13))] shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.44),0_1px_4px_rgba(0,0,0,0.09)] ring-white/[0.36] text-[#f8f8fb]'
      : lightGlass
        ? 'bg-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ring-black/[0.06] text-[#48484e]'
        : dark
          ? 'bg-black/[0.32] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ring-white/[0.14] text-[#f6f6f8]'
          : 'bg-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ring-white/[0.12] text-[#f6f6f8]';
  return (
    <span
      aria-hidden="true"
      className={`flex h-full w-full items-center justify-center rounded-[3.5px] ring-1 backdrop-blur-[3px] [&>svg]:h-[46%] [&>svg]:w-[46%] ${tile}`}
    >
      {glyph}
    </span>
  );
}

export const APP_MAP: Record<AppId, AppMeta> = Object.fromEntries(APPS.map((a) => [a.id, a])) as Record<AppId, AppMeta>;

/** 底部 Dock（用户指定：信息 / 联系人 / 电话 / 设置） */
const DOCK_IDS: AppId[] = ['chat', 'contacts', 'phone', 'settings'];

/** 主屏幕网格 App（除 Dock 外全部 14 个；具体分页排布见 HomeScreen 的 defaultLayout） */
export const GRID_APPS: AppMeta[] = APPS.filter((a) => !DOCK_IDS.includes(a.id));

/** 底部 Dock（4 个） */
export const DOCK_APPS: AppMeta[] = DOCK_IDS.map((id) => APP_MAP[id]);

/** 按下即预载：appId → chunk 预载器（与上方 dynamic 同一模块引用，重复调用幂等）。
 * 挂在图标 pointerdown/悬停上（PhoneShell 全局捕获监听），比 click 提前 100~300ms
 * 开始拉 chunk——外网首开时这段抢跑与打开缩放动画重叠，实际等待明显变短 */
const APP_IMPORTERS: Record<AppId, () => Promise<unknown>> = {
  chat: () => import('./chat'),
  photos: () => import('./photos'),
  camera: () => import('./camera'),
  music: () => import('./music'),
  browser: () => import('./browser'),
  weather: () => import('./weather'),
  clock: () => import('./clock'),
  themes: () => import('./themes'),
  files: () => import('./files'),
  reminders: () => import('./reminders'),
  calculator: () => import('./calculator'),
  notes: () => import('./notes'),
  calendar: () => import('./calendar'),
  recorder: () => import('./recorder'),
  settings: () => import('./settings'),
  contacts: () => import('./contacts'),
  phone: () => import('./phone'),
  wechat: () => import('./wechat'),
  qq: () => import('./qq'),
  appstore: () => import('./appstore'),
  memory: () => import('./memory-bank'),
  worldbook: () => import('./worldbook'),
  meituan: () => import('./meituan'),
  taobao: () => import('./taobao'),
  couple: () => import('./couple-space'),
  cottage: () => import('./cottage'),
  forum: () => import('./forum/forum'),
};

/** 预载指定 App 的 chunk（幂等、失败静默）：图标按下/悬停时调用 */
export function preloadApp(id: AppId): void {
  const fn = APP_IMPORTERS[id];
  if (fn) void fn().catch(() => undefined);
}

/**
 * 解锁后预热「高频 App」（解决「点击进入界面要等一会」）：
 * 所有 App 组件都是 dynamic 懒加载，chunk 只在首次点开时才拉取——dev 下未压缩
 * chunk 高达 2~3MB（QQ/微信/美团/情侣空间），每次代码改动后 hash 变化还要重新
 * 下载+解析+执行，用户点开要干等 1~3 秒。
 *
 * v77.3 收敛：此前预热全部 29 个 App（首屏后台拉 190+ chunk / 6.6MB JS），把网络与
 * 主线程打满——锁屏动画/上滑手势发卡、「锁屏加载慢」的直接元凶。现改为：
 * ① 只预热高频 5 个（信息/微信/QQ/音乐/美团，覆盖绝大多数点击）；
 * ② 仅在「解锁进入主屏后」由 PhoneShell 调度（锁屏期间零后台拉取，锁屏百分百流畅）；
 * ③ 低频 App 不预热——靠图标 pointerdown/hover 抢跑（preloadApp）+ AppSplash
 *    启动屏兑底，点啥拉啥，不再首屏全量预载。
 */
export function preloadHeavyApps(): void {
  // 高频 App（从重到轻；只列真正常点开的，其余一律不预热）
  const heavyImports: Array<() => Promise<unknown>> = [
    () => import('./wechat'),
    () => import('./qq'),
    () => import('./meituan'),
    () => import('./chat'),
    () => import('./music'),
  ];
  // 空闲串行调度：只在浏览器空闲帧里预载下一个（每次让出主线程，不与首帧/
  // 主屏滑动/用户点击抢资源）；页面隐藏时 idle 回调暂停，回前台自动续上。
  // 失败静默——点开 App 时 dynamic 会正常重试。Safari 无 requestIdleCallback 时退化为 1s 定时
  const schedule = (fn: () => void) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: 4000 });
    } else {
      window.setTimeout(fn, 1000);
    }
  };
  const next = (i: number): void => {
    if (i >= heavyImports.length) return;
    schedule(() => {
      heavyImports[i]()
        .catch(() => undefined)
        .finally(() => next(i + 1));
    });
  };
  next(0);
  void import('@/lib/ios/music-store')
    .then((m) => {
      try {
        void m.useMusic.getState().boot();
      } catch {
        /* 预热失败静默（App 打开时 boot 会重试） */
      }
    })
    .catch(() => undefined);
  void import('@/lib/ios/music-ai')
    .then((m) => void m.bootMusicAi())
    .catch(() => undefined);
}
