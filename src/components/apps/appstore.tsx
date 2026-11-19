'use client';

/**
 * App Store App（仿 iOS App Store 视觉重制版）
 * - 底部三个标签：App（分组列表）/ 已移除（恢复入口）/ 搜索
 * - 「打开」蓝色胶囊真正启动 App（useUI.openApp）；已移除的 App 行内是 iCloud 风格
 *   蓝色云下载图标（同真实商店「重新下载」语义），点击恢复回主屏（hidden 写回 +
 *   home-layout-updated 事件，HomeScreen 自动补位）
 * - 详情页：大图标 + 打开/恢复、四栏数据（评分/年龄分级/排行榜/开发者）、
 *   「新功能」版本说明（用户圈过的那句"喝了太多的咖啡"在内）、「预览」渐变截图卡
 * - 每个 App 的评分/版本/文案由 id 哈希确定性生成（刷新不变、各 App 不同）
 * - App Store 自身在主屏编辑模式不可删除（HomeScreen 保护），避免恢复入口死锁
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  LayoutGrid,
  Search,
  Share,
  Star,
  User as UserIcon,
} from 'lucide-react';
import { localDB } from '@/lib/ios/db';
import { useSettings, useUI, type AppId } from '@/lib/ios/store';
import { IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { APPS, AppIconTile } from './registry';

/** 与 HomeScreen/WidgetGallery 共用的布局 key 与同步事件 */
const LAYOUT_DB_KEY = 'homeLayout';
const LAYOUT_EVENT = 'home-layout-updated';

/* ----------------------------- 装饰性元数据（确定性哈希） ----------------------------- */

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 每个 App 的一句话简介（列表副标题/详情页副标题/搜索关键字） */
const TAGLINES: Record<AppId, string> = {
  photos: '图库与美好回忆',
  weather: '实时天气与预报',
  clock: '世界时钟与闹钟',
  calculator: '快速计算器',
  notes: '随手记下每个想法',
  calendar: '日程与节日提醒',
  recorder: '录音与语音转写',
  reminders: '待办事项与提醒',
  files: '文件管理',
  wechat: '与好友保持联系',
  qq: 'QQ，乐在沟通',
  contacts: '联系人管理',
  phone: '拨号与通话记录',
  settings: '系统设置',
  themes: '壁纸与个性化',
  chat: '信息与短信',
  browser: '快速安全的浏览器',
  music: '音乐播放器',
  camera: '拍照与录像',
  appstore: '发现、安装与恢复 App',
  memory: '跨应用 AI 记忆互通',
  worldbook: '关键词触发的 AI 设定库',
  meituan: '外卖团购，吃喝玩乐',
  taobao: '淘好货，要淘宝',
  couple: '情侣空间，两个人的小天地',
  cottage: '拾光小屋，把日常装进小家',
  forum: 'X论坛，大家都在聊什么',
};

/** 分类（排行榜副标题 & 搜索关键字） */
const CATEGORY: Record<AppId, string> = {
  photos: '摄影与录像',
  weather: '天气',
  clock: '实用工具',
  calculator: '实用工具',
  notes: '效率',
  calendar: '效率',
  recorder: '效率',
  reminders: '效率',
  files: '实用工具',
  wechat: '社交',
  qq: '社交',
  contacts: '实用工具',
  phone: '社交',
  settings: '实用工具',
  themes: '个性化',
  chat: '社交',
  browser: '工具',
  music: '音乐',
  camera: '摄影与录像',
  appstore: '商店',
  memory: '效率',
  worldbook: '效率',
  meituan: '生活服务',
  taobao: '购物',
  couple: '社交',
  cottage: '生活',
  forum: '社交',
};

/** App 标签页分组 */
const GROUPS: { title: string; ids: AppId[] }[] = [
  { title: '必装 App', ids: ['wechat', 'qq', 'chat', 'photos', 'camera', 'music', 'browser', 'weather'] },
  {
    title: '实用工具',
    ids: ['clock', 'calculator', 'notes', 'reminders', 'calendar', 'files', 'recorder', 'contacts', 'phone', 'worldbook'],
  },
  { title: '个性定制', ids: ['themes', 'settings', 'appstore'] },
];

const RELEASE_NOTES = [
  '修正了一些错误、提升了性能、喝了太多的咖啡。',
  '修复了偶发的崩溃，顺便给图标打了一层蜡。',
  '新版本来了！这次我们没有加入任何新 Bug。（大概）',
  '让它变得更快、更稳、更安静，像一只训练有素的猫。',
  '感谢你的支持！我们倾听了一些建议，然后修好了它们。',
  '小更新：压缩了安装包体积，现在它比昨天轻了 3 克。',
  '修复了在某些平行宇宙无法启动的问题。',
  '提升了速度、降低了功耗，还学会了说"请"和"谢谢"。',
];

const DAYS_AGO = ['6 天前', '3 天前', '1 周前', '2 周前', '上个月'];
const AGE_RATINGS = ['4+', '4+', '9+', '12+', '12+', '17+'];

/** 详情页「预览」截图卡渐变（成对取，保证两卡不撞色） */
const GRADS = [
  'linear-gradient(165deg,#5ac8fa 0%,#007aff 100%)',
  'linear-gradient(165deg,#ffd60a 0%,#ff9f0a 100%)',
  'linear-gradient(165deg,#ff375f 0%,#ff2d55 100%)',
  'linear-gradient(165deg,#30d158 0%,#00c7be 100%)',
  'linear-gradient(165deg,#bf5af2 0%,#da70f6 100%)',
  'linear-gradient(165deg,#ff9f0a 0%,#ff375f 100%)',
];

interface StoreMeta {
  rating: string;
  count: number;
  age: string;
  rank: number;
  version: string;
  days: string;
  note: string;
  g1: string;
  g2: string;
}

function metaFor(id: AppId): StoreMeta {
  const h = hashStr(id);
  return {
    rating: ((42 + (h % 8)) / 10).toFixed(1),
    count: 1 + (h % 260),
    age: AGE_RATINGS[h % AGE_RATINGS.length],
    rank: 1 + (h % 25),
    version: `${10 + (h % 15)}.${h % 40}.${(h >> 3) % 10}`,
    days: DAYS_AGO[h % DAYS_AGO.length],
    note: RELEASE_NOTES[h % RELEASE_NOTES.length],
    g1: GRADS[h % GRADS.length],
    g2: GRADS[(h >> 2) % GRADS.length],
  };
}

/* --------------------------------- 小组件 --------------------------------- */

/** 蓝色链接/按钮主色（浅 #007aff / 深 #0a84ff，随主题） */
const BLUE = 'text-[#007aff] dark:text-[#409cff]';

/** 列表行右侧「打开」胶囊（浅蓝底蓝字，同真实商店「获取」样式） */
function OpenPill({ onClick, testid, label = '打开' }: { onClick: () => void; testid?: string; label?: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`shrink-0 rounded-full bg-[#007aff]/[0.09] px-[18px] py-[6px] text-[14px] font-semibold leading-none ${BLUE} shadow-sm ring-1 ring-[#007aff]/20 backdrop-blur-xl transition-transform active:scale-95 dark:bg-[#409cff]/[0.22] dark:ring-[#409cff]/30`}
    >
      {label}
    </button>
  );
}

/** 已移除 App 的「重新下载」云图标按钮（iCloud 风格） */
function CloudRestoreButton({ onClick, testid, name }: { onClick: () => void; testid: string; name: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={`恢复${name}到主屏幕`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`shrink-0 transition-transform active:scale-90 ${BLUE}`}
    >
      <CloudDownload className="h-[26px] w-[26px]" strokeWidth={2} />
    </button>
  );
}

/** 五角星评分（灰色底 + 琥珀色按百分比裁剪覆盖） */
function Stars({ value }: { value: number }) {
  const row = (filled: boolean) => (
    <span className={`flex gap-[1.5px] ${filled ? 'text-[#ff9f0a]' : 'text-muted-foreground/35'}`} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-[11px] w-[11px]" strokeWidth={0} fill="currentColor" />
      ))}
    </span>
  );
  return (
    <span className="relative inline-block leading-none" role="img" aria-label={`评分 ${value} / 5`}>
      {row(false)}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${(value / 5) * 100}%` }}>
        {row(true)}
      </span>
    </span>
  );
}

/** 列表行：图标 + 名称 + 简介 + 右侧动作（整行可点进详情） */
function AppRow({
  id,
  name,
  tagline,
  removed,
  onDetail,
  onOpen,
  onRestore,
  restoreTestid,
}: {
  id: AppId;
  name: string;
  tagline: string;
  removed: boolean;
  onDetail: () => void;
  onOpen: () => void;
  onRestore: () => void;
  restoreTestid: string;
}) {
  return (
    <li className="relative">
      <div className="flex items-center gap-3 px-4 py-[9px]">
        <button
          type="button"
          onClick={onDetail}
          aria-label={`查看${name}详情`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity active:opacity-60"
        >
          <span className="block h-[56px] w-[56px] shrink-0 overflow-hidden rounded-[14px]">
            <AppIconTile id={id} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-tight">{name}</span>
            <span className="mt-[3px] block truncate text-[12px] leading-tight text-muted-foreground">{tagline}</span>
          </span>
        </button>
        <div className="flex w-[74px] shrink-0 items-center justify-end">
          {removed ? (
            <CloudRestoreButton onClick={onRestore} testid={restoreTestid} name={name} />
          ) : (
            <OpenPill onClick={onOpen} />
          )}
        </div>
      </div>
      <span aria-hidden="true" className="absolute bottom-0 left-[74px] right-0 h-px bg-border/40" />
    </li>
  );
}

/* --------------------------------- 主组件 --------------------------------- */

type TabKey = 'app' | 'removed' | 'search';

const TABS: { key: TabKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'app', label: 'App', icon: LayoutGrid },
  { key: 'removed', label: '已移除', icon: ArchiveRestore },
  { key: 'search', label: '搜索', icon: Search },
];

export default function AppStoreApp() {
  const switchToApp = useUI((s) => s.switchToApp);
  /** 设置「个人信息」卡片的资料（头像/名字）——右上角账户头像与它同源 */
  const profile = useSettings((s) => s.profile);

  /** 布局 hidden 里的 App id（小组件记录 'widget:*' 不属于本 App 管辖） */
  const [hiddenApps, setHiddenApps] = useState<AppId[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabKey>('app');
  const [detailId, setDetailId] = useState<AppId | null>(null);
  const [query, setQuery] = useState('');

  const readHidden = useCallback(async (): Promise<AppId[]> => {
    try {
      const rec = await localDB.get('settings', LAYOUT_DB_KEY);
      const raw = rec?.value as { hidden?: unknown } | undefined;
      const hidden = Array.isArray(raw?.hidden) ? (raw.hidden as unknown[]) : [];
      return APPS.map((a) => a.id).filter((id) => hidden.includes(id));
    } catch {
      return [];
    }
  }, []);

  /** 首次加载 + 主屏编辑删除/恢复期间事件同步（async IIFE：setState 均在 await 之后） */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const hidden = await readHidden();
      if (alive) setHiddenApps(hidden);
      if (alive) setLoaded(true);
    })();
    const onExternal = () =>
      void (async () => {
        const hidden = await readHidden();
        if (alive) setHiddenApps(hidden);
      })();
    window.addEventListener(LAYOUT_EVENT, onExternal);
    return () => {
      alive = false;
      window.removeEventListener(LAYOUT_EVENT, onExternal);
    };
  }, [readHidden]);

  /** 恢复 App 到主屏：hidden 移除该 id → 写回 DB → 通知 HomeScreen 重读（自动补位） */
  const restore = useCallback(async (id: AppId) => {
    try {
      const rec = await localDB.get('settings', LAYOUT_DB_KEY);
      const value = (rec?.value as Record<string, unknown> | undefined) ?? {};
      const hidden = Array.isArray(value.hidden) ? (value.hidden as unknown[]).filter((h) => h !== id) : [];
      await localDB.put('settings', { key: LAYOUT_DB_KEY, value: { ...value, hidden } });
      window.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
    } catch {
      /* 写库失败：保持原状 */
    }
  }, []);

  const removed = useMemo(() => APPS.filter((a) => hiddenApps.includes(a.id)), [hiddenApps]);
  const removedSet = useMemo(() => new Set(removed.map((a) => a.id)), [removed]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return APPS;
    return APPS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        TAGLINES[a.id].toLowerCase().includes(q) ||
        CATEGORY[a.id].toLowerCase().includes(q),
    );
  }, [query]);

  /* ------------------------------- 详情页 ------------------------------- */

  if (detailId) {
    const app = APPS.find((a) => a.id === detailId);
    if (app) {
      const isRemoved = removedSet.has(app.id);
      const meta = metaFor(app.id);
      return (
        <IOSScreen>
          <div className="no-scrollbar flex-1 overflow-y-auto" data-testid="appstore-detail">
            {/* 顶部：圆形玻璃返回/分享按钮（同真实商店） */}
            <div className="sticky top-0 z-20 bg-background/80 pt-[54px] backdrop-blur-xl">
              <div className="flex h-12 items-center justify-between px-4">
                <button
                  type="button"
                  data-testid="appstore-detail-back"
                  aria-label="返回"
                  onClick={() => setDetailId(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-transform active:scale-90 dark:bg-white/[0.08] dark:ring-white/[0.1]"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  aria-label="分享"
                  onClick={() => {
                    try {
                      navigator.vibrate?.(8);
                    } catch {
                      /* 忽略 */
                    }
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-transform active:scale-90 dark:bg-white/[0.08] dark:ring-white/[0.1]"
                >
                  <Share className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </button>
              </div>
            </div>

            {/* 图标 + 名称 + 动作 */}
            <div className="mt-1 flex items-start gap-4 px-5">
              <span className="block h-[100px] w-[100px] shrink-0 overflow-hidden rounded-[24px] shadow-[0_10px_28px_rgba(0,0,0,0.18)] [&_svg]:h-14 [&_svg]:w-14">
                <AppIconTile id={app.id} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col pt-1">
                <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight">{app.name}</h1>
                <p className="mt-1 truncate text-[14px] leading-snug text-muted-foreground">{TAGLINES[app.id]}</p>
                {isRemoved ? (
                  <button
                    type="button"
                    data-testid={`appstore-detail-restore-${app.id}`}
                    aria-label={`恢复${app.name}到主屏幕`}
                    onClick={() => void restore(app.id)}
                    className="mt-5 flex w-fit items-center gap-1.5 rounded-full bg-[#007aff] px-6 py-[9px] text-[15px] font-semibold leading-none text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition-transform active:scale-95 dark:bg-[#0a84ff]"
                  >
                    <CloudDownload className="h-4 w-4" strokeWidth={2.4} />
                    恢复
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`打开${app.name}`}
                    onClick={() => switchToApp(app.id)}
                    className="mt-5 w-fit rounded-full bg-[#007aff] px-7 py-[9px] text-[15px] font-semibold leading-none text-white shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition-transform active:scale-95 dark:bg-[#0a84ff]"
                  >
                    打开
                  </button>
                )}
              </div>
            </div>

            {/* 四栏数据：评分 / 年龄分级 / 排行榜 / 开发者 */}
            <div className="mt-6 grid grid-cols-4 divide-x divide-border/40 overflow-hidden rounded-[16px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
              <div className="flex flex-col items-center gap-1 px-1 py-3.5">
                <span className="text-[11px] text-muted-foreground">{meta.count} 万个评分</span>
                <span className="text-[19px] font-semibold leading-none">{meta.rating}</span>
                <Stars value={parseFloat(meta.rating)} />
              </div>
              <div className="flex flex-col items-center gap-1 px-1 py-3.5">
                <span className="text-[11px] text-muted-foreground">年龄分级</span>
                <span className="text-[19px] font-semibold leading-none">{meta.age}</span>
                <span className="text-[11px] text-muted-foreground">App 内控制</span>
              </div>
              <div className="flex flex-col items-center gap-1 px-1 py-3.5">
                <span className="text-[11px] text-muted-foreground">排行榜</span>
                <span className="text-[19px] font-semibold leading-none">#{meta.rank}</span>
                <span className="truncate text-[11px] text-muted-foreground">{CATEGORY[app.id]}</span>
              </div>
              <div className="flex flex-col items-center gap-1 px-1 py-3.5">
                <span className="text-[11px] text-muted-foreground">开发者</span>
                <span
                  aria-hidden="true"
                  className="grid h-[26px] w-[26px] place-items-center rounded-[8px] text-[14px] font-bold text-white"
                  style={{ background: meta.g1 }}
                >
                  天
                </span>
                <span className="text-[11px] text-muted-foreground">天使</span>
              </div>
            </div>

            {/* 新功能（版本说明） */}
            <section className="mt-6 px-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[20px] font-bold tracking-tight">新功能</h2>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" strokeWidth={2.4} />
              </div>
              <div className="mt-1.5 flex items-baseline justify-between text-[13px] text-muted-foreground">
                <span>版本 {meta.version}</span>
                <span>{meta.days}</span>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed">{meta.note}</p>
            </section>

            {/* 预览（渐变截图卡横滑） */}
            <section className="mt-7">
              <h2 className="px-5 text-[20px] font-bold tracking-tight">预览</h2>
              <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
                {[
                  { g: meta.g1, title: `${app.name}，触手可及`, sub: '打开即用，毫无学习成本' },
                  { g: meta.g2, title: '更快、更省电', sub: '为这部 iPhone 深度优化' },
                ].map((card) => (
                  <div
                    key={card.title}
                    className="relative flex h-[330px] w-[190px] shrink-0 flex-col overflow-hidden rounded-[18px] p-4 text-white shadow-sm"
                    style={{ background: card.g }}
                  >
                    <span className="block h-12 w-12 overflow-hidden rounded-[12px] shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                      <AppIconTile id={app.id} />
                    </span>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 grid place-items-center opacity-20 [&_svg]:h-24 [&_svg]:w-24"
                    >
                      <AppIconTile id={app.id} />
                    </span>
                    <div className="mt-auto">
                      <p className="text-[17px] font-bold leading-snug">{card.title}</p>
                      <p className="mt-1 text-[12px] leading-snug text-white/85">{card.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <p className="mt-8 px-5 text-[12px] leading-relaxed text-muted-foreground">
              {isRemoved
                ? '该 App 已从主屏幕移除，点上方「恢复」即可放回主屏幕有空位的页面。'
                : '该 App 已在主屏幕。长按图标进入编辑模式，点 × 可将其移除并收进 App Store。'}
            </p>
          </div>
        </IOSScreen>
      );
    }
  }

  /* ------------------------------- 浏览视图 ------------------------------- */

  return (
    <IOSScreen>
      {/* 顶栏：返回键（回主屏，与其他 App 根页一致）+ 大标题 + 账户头像（跟随设置
        * 「个人信息」卡片的头像——传了自定义头像显示图片，没传显示同款灰渐变人形占位） */}
      <header className="shrink-0 bg-background/85 pt-[54px] backdrop-blur-xl">
        <div className="flex h-11 items-center gap-1 pl-2 pr-5">
          <BackToHome className="static! shrink-0" />
          <h1 className="ml-1 flex-1 text-[28px] font-bold leading-none tracking-tight">
            {TABS.find((t) => t.key === tab)?.label}
          </h1>
          {profile?.avatar ? (
            <img
              src={profile.avatar}
              alt="账户头像"
              className="h-9 w-9 shrink-0 rounded-full object-cover shadow-[0_1px_4px_rgba(0,0,0,0.12)] ring-1 ring-border/40"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#D8D8DD] to-[#AEB0B8] shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
            >
              <UserIcon className="h-[18px] w-[18px] text-[#7C7C84]" strokeWidth={1.8} />
            </span>
          )}
        </div>
      </header>

      <div key={`${tab}-${detailId ?? 'browse'}`} className="no-scrollbar flex-1 overflow-y-auto pb-4" data-testid={`appstore-tab-page-${tab}`}>
        {/* ------------------------------- App ------------------------------- */}
        {tab === 'app' && (
          <div className="pt-1">
            {GROUPS.map((group) => (
              <section key={group.title} className="mt-4">
                <h2 className="px-4 text-[22px] font-bold tracking-tight">{group.title}</h2>
                <ul className="mt-1">
                  {group.ids.map((id) => {
                    const app = APPS.find((a) => a.id === id);
                    if (!app) return null;
                    const isRemoved = removedSet.has(id);
                    return (
                      <AppRow
                        key={id}
                        id={id}
                        name={app.name}
                        tagline={TAGLINES[id]}
                        removed={isRemoved}
                        onDetail={() => setDetailId(id)}
                        onOpen={() => switchToApp(id)}
                        onRestore={() => void restore(id)}
                        restoreTestid={`appstore-grid-restore-${id}`}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
            <p className="mt-5 px-4 text-[12px] leading-relaxed text-muted-foreground">
              {APPS.length} 个系统 App · 已移除 {removed.length} 个 · 点蓝色云图标即可恢复回主屏幕
            </p>
          </div>
        )}

        {/* ------------------------------ 已移除 ------------------------------ */}
        {tab === 'removed' && (
          <div className="px-5 pt-3">
            <p className="text-[13px] text-muted-foreground">{loaded ? `${removed.length} 个 App 等待恢复` : '正在读取…'}</p>
            {!loaded ? (
              <div className="mt-3 space-y-2" aria-hidden="true">
                <div className="h-[74px] animate-pulse rounded-[16px] bg-muted/60" />
                <div className="h-[74px] animate-pulse rounded-[16px] bg-muted/60" />
              </div>
            ) : removed.length === 0 ? (
              <div className="mt-20 flex flex-col items-center" data-testid="appstore-empty">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
                  <CloudDownload className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
                </span>
                <p className="mt-4 text-[16px] font-semibold">没有已移除的 App</p>
                <p className="mt-1.5 max-w-[240px] text-center text-[13px] leading-relaxed text-muted-foreground">
                  长按主屏幕进入编辑模式，点 × 移除的 App 会出现在这里，随时可恢复
                </p>
              </div>
            ) : (
              <ul className="-mx-5 mt-1">
                {removed.map((a) => (
                  <AppRow
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    tagline="已从主屏幕移除"
                    removed
                    onDetail={() => setDetailId(a.id)}
                    onOpen={() => switchToApp(a.id)}
                    onRestore={() => void restore(a.id)}
                    restoreTestid={`appstore-restore-${a.id}`}
                  />
                ))}
              </ul>
            )}
            {removed.length > 0 && (
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                恢复后会自动放回主屏幕有空位的页面；蓝色云图标与真实商店「重新下载」同义。
              </p>
            )}
          </div>
        )}

        {/* ------------------------------- 搜索 ------------------------------- */}
        {tab === 'search' && (
          <div className="pt-3">
            <div className="relative px-4">
              <Search className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" strokeWidth={2.2} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名称、功能或分类"
                aria-label="搜索 App"
                data-testid="appstore-search-input"
                className="w-full rounded-[14px] bg-white/60 py-[8px] pl-9 pr-3 text-[15px] shadow-sm outline-none ring-1 ring-white/70 backdrop-blur-xl placeholder:text-muted-foreground/70 focus:ring-[#007aff]/40 dark:bg-white/[0.08] dark:ring-white/[0.1] dark:focus:ring-[#409cff]/40"
              />
            </div>
            <p className="mt-4 px-4 text-[13px] text-muted-foreground">
              {query.trim() ? `“${query.trim()}” 的搜索结果 · ${searchResults.length} 个` : `全部 App · ${APPS.length} 个`}
            </p>
            <ul className="-mx-0 mt-1">
              {searchResults.map((a) => {
                const isRemoved = removedSet.has(a.id);
                return (
                  <AppRow
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    tagline={TAGLINES[a.id]}
                    removed={isRemoved}
                    onDetail={() => setDetailId(a.id)}
                    onOpen={() => switchToApp(a.id)}
                    onRestore={() => void restore(a.id)}
                    restoreTestid={`appstore-search-restore-${a.id}`}
                  />
                );
              })}
            </ul>
            {searchResults.length === 0 && (
              <div className="mt-20 flex flex-col items-center">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
                  <Search className="h-8 w-8 text-muted-foreground" strokeWidth={1.8} />
                </span>
                <p className="mt-4 text-[16px] font-semibold">没有找到相关 App</p>
                <p className="mt-1.5 text-[13px] text-muted-foreground">换个关键词试试，比如「音乐」或「工具」</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部标签栏（玻璃磨砂 + 蓝色选中态 + 已移除角标） */}
      <nav
        aria-label="App Store 标签"
        className="z-20 shrink-0 border-t border-border/40 bg-background/85 pb-[24px] pt-[7px] backdrop-blur-xl"
      >
        <div className="grid grid-cols-3">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`appstore-tab-${key}`}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setTab(key);
                  setDetailId(null);
                }}
                className={`relative flex flex-col items-center gap-[3px] py-[2px] transition-colors ${
                  active ? BLUE : 'text-muted-foreground/80'
                }`}
              >
                <span className="relative">
                  <Icon className="h-[26px] w-[26px]" strokeWidth={active ? 2.1 : 1.8} />
                  {key === 'removed' && loaded && removed.length > 0 && (
                    <span
                      aria-label={`${removed.length} 个待恢复`}
                      className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background"
                    >
                      {removed.length}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </IOSScreen>
  );
}
