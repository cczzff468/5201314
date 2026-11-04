'use client';

/**
 * 小组件画廊（主屏全部 14 种小组件 1:1 预览，点击右上角 + 添加到主屏幕）：
 * - 编辑模式顶栏「+」：主屏内弹出画廊浮层（时钟/天气/信息卡片/气泡/日记/一起听/音乐/
 *   网易云/对话气泡/黑胶/日历/iCity/表盘时钟/拍立得，全部平铺不分组——用户要求不显示「第几页」），
 *   已添加的显示「已添加」角标不可重复添加；
 *   × 删除过的小组件从 hidden 找回（与「恢复默认」同一数据链路）；
 * - 主题 App「小组件」独立界面（ThemesWidgetsPage）：同一套 1:1 画廊放在
 *   深色壁纸质感的底板上（浅色主题下白字小组件预览同样清晰），增删直接写
 *   IndexedDB 布局并广播 'home-layout-updated' 事件，主屏监听后重读布局即时同步
 *   （本模块只派发不监听，无回环）。
 * 预览与主屏渲染同一批小组件组件（同一数据源 localStorage），所见即所得；
 * 画廊网格与主屏同规格（326px / 4 列 / 同跨度），跨度与尺寸完全 1:1。
 */

import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Check, ChevronLeft, Plus } from 'lucide-react';
import { localDB } from '@/lib/ios/db';
import { DiaryCardWidget, loadDiaryCard, type DiaryCardData } from './DiaryCard';
import { CalendarCardWidget } from './CalendarCard';
import { TickClockCardWidget } from './TickClockCard';
import { ListenCardWidget, loadListenCard, type ListenCardData } from './ListenCard';
import { DialogCardWidget, loadDialogCard, type DialogCardData } from './DialogCard';
import { NeteaseCardWidget } from './NeteaseCard';
import { VinylCardWidget } from './VinylCard';
import { MusicWidget } from './MusicWidget';
import { ProfileCardWidget, loadProfileCard, type ProfileCardData } from './ProfileCard';
import { BubbleCardWidget, loadBubbleCard, type BubbleCardData } from './BubbleCard';
import { ICityCardWidget, loadICityCard, type ICityCardData } from './ICityCard';
import { PolaroidCardWidget, loadPolaroidCard, type PolaroidCardData } from './PolaroidCard';

// 天气小组件懒加载（与主屏同一模块 chunk，首帧不拖慢）
const WeatherWidget = dynamic(() => import('@/components/apps/weather').then((m) => m.WeatherWidget), {
  ssr: false,
  loading: () => (
    <div className="mx-auto h-[152px] w-[152px] animate-pulse rounded-[24px] bg-white/10 backdrop-blur-md" aria-hidden="true" />
  ),
});

/** 画廊内可添加的小组件种类（主屏全部 14 种，与 HomeScreen 的 WidgetKind 一一对应） */
export type GalleryKind =
  | 'weather'
  | 'clock'
  | 'profile'
  | 'bubble'
  | 'diary'
  | 'listen'
  | 'music'
  | 'netease'
  | 'dialog'
  | 'vinyl'
  | 'calendar'
  | 'icity'
  | 'tickclock'
  | 'polaroid';
export const GALLERY_KINDS: GalleryKind[] = [
  'weather',
  'clock',
  'profile',
  'bubble',
  'diary',
  'listen',
  'music',
  'netease',
  'dialog',
  'vinyl',
  'calendar',
  'icity',
  'tickclock',
  'polaroid',
];

/** 画廊项：跨度与主屏 WIDGET_SPAN 一致（1:1），全部平铺展示（不按页分组） */
const GALLERY_ITEMS: { kind: GalleryKind; span: string; label: string }[] = [
  { kind: 'clock', span: 'col-span-4 row-span-2', label: '时钟' },
  { kind: 'weather', span: 'col-span-2 row-span-2 self-center', label: '天气' },
  { kind: 'profile', span: 'col-span-4 row-span-3', label: '信息卡片' },
  { kind: 'bubble', span: 'col-span-2 row-span-2 self-center', label: '气泡' },
  { kind: 'diary', span: 'col-span-4 row-span-2', label: '日记' },
  { kind: 'listen', span: 'col-span-2 row-span-3', label: '一起听' },
  { kind: 'music', span: 'col-span-4 row-span-2', label: '音乐' },
  { kind: 'netease', span: 'col-span-2 row-span-3', label: '网易云' },
  { kind: 'dialog', span: 'col-span-4 row-span-2', label: '对话气泡' },
  { kind: 'vinyl', span: 'col-span-2 row-span-3', label: '黑胶' },
  { kind: 'calendar', span: 'col-span-4 row-span-2', label: '日历' },
  { kind: 'icity', span: 'col-span-2 row-span-2 self-center', label: 'iCity' },
  { kind: 'tickclock', span: 'col-span-2 row-span-2 self-center', label: '表盘时钟' },
  { kind: 'polaroid', span: 'col-span-4 row-span-2', label: '拍立得' },
];

/** IndexedDB 布局 key（与 HomeScreen 的 LAYOUT_KEY 保持一致） */
const LAYOUT_DB_KEY = 'homeLayout';
/** 布局变更广播事件名（主题页写入 → 主屏监听重读） */
const LAYOUT_EVENT = 'home-layout-updated';

/** 持久化布局的轻量类型（pages 里 tile 保留 kind/widget/id：写回时不能丢 App id，
 *  否则主屏 sanitize 会把无 id 的 App 判无效删掉、再堆到末页） */
interface StoredTile {
  kind?: unknown;
  widget?: unknown;
  id?: unknown;
}
interface StoredLayout {
  v?: unknown;
  pages?: unknown;
  dock?: unknown;
  hidden?: unknown;
}

const parsePages = (raw: StoredLayout | undefined): { kind: string; widget?: string; id?: string }[][] => {
  if (!raw || !Array.isArray(raw.pages)) return [[], [], [], []];
  return (raw.pages as unknown[]).map((p) =>
    Array.isArray(p)
      ? (p as StoredTile[])
          .filter((t) => t && typeof t === 'object' && typeof t.kind === 'string')
          .map((t) => ({
            kind: t.kind as string,
            widget: typeof t.widget === 'string' ? t.widget : undefined,
            id: typeof t.id === 'string' ? t.id : undefined,
          }))
      : []
  );
};

/** 主题页：把小组件添加回主屏布局（unhide + 从最后一页往前找第一张装得下的页追加——
 *  小组件聚落在第 3/4 页，不会落到前面的 App 页；都满则新建一页接住；
 *  写回保留原有 tile 全部字段（App id 不能丢） */
async function addGalleryWidget(kind: GalleryKind): Promise<boolean> {
  try {
    const rec = await localDB.get('settings', LAYOUT_DB_KEY);
    const raw = rec?.value as StoredLayout | undefined;
    const pages = parsePages(raw);
    if (pages.some((p) => p.some((t) => t.kind === 'widget' && t.widget === kind))) return false;
    let target = -1;
    for (let i = pages.length - 1; i >= 0; i--) {
      const cap = pages[i].some((t) => t.kind === 'widget') ? 14 : 20;
      if (pages[i].length < cap) {
        target = i;
        break;
      }
    }
    if (target === -1) {
      pages.push([]);
      target = pages.length - 1;
    }
    pages[target].push({ kind: 'widget', widget: kind });
    const hidden = Array.isArray(raw?.hidden)
      ? (raw.hidden as unknown[]).filter((h) => typeof h === 'string' && h !== `widget:${kind}`)
      : [];
    const value = { ...(raw ?? {}), pages, hidden };
    await localDB.put('settings', { key: LAYOUT_DB_KEY, value });
    window.dispatchEvent(new CustomEvent(LAYOUT_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** 网格时钟小组件：顶部通栏（4 列整行）无边框大数字钟——粗体白字直接浮在壁纸上，
 *  仅带轻投影保证可读性（用户要求去掉外边框、变大、居顶中）。
 *  light=true（主屏传入：壁纸实测偏浅，如自定义白色背景图）→ 深色字 + 白色投影，
 *  修「浅色主题 + 白壁纸时大时钟/日期白字画在白纸上看不见」；
 *  缺省（画廊 1:1 预览，深色壁纸质底板）保持白字。
 *  主屏与画廊共用（1:1 预览）；SSR/首帧不渲染时间避免水合不一致，挂载后立即
 *  填充，每 10s 对齐刷新。testId 仅主屏传入（画廊内不重复注册同一 testid）。 */
export function ClockGridWidget({ testId, light = false }: { testId?: string; light?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const iv = window.setInterval(tick, 10_000);
    return () => window.clearInterval(iv);
  }, []);
  const hh = now ? String(now.getHours()).padStart(2, '0') : '';
  const mm = now ? String(now.getMinutes()).padStart(2, '0') : '';
  const date = now ? `${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]}` : '';
  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      className="flex h-[168px] w-full flex-col items-center justify-center gap-[10px]"
    >
      <time
        className={`text-[64px] font-bold leading-none tracking-tight tabular-nums ${
          light
            ? 'text-[#1c1c1e] [text-shadow:0_2px_14px_rgba(255,255,255,0.6)]'
            : 'text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.45)]'
        }`}
      >
        {now ? `${hh}:${mm}` : ''}
      </time>
      <span
        className={`text-[14px] font-medium leading-none ${
          light
            ? 'text-[#1c1c1e]/85 [text-shadow:0_1px_6px_rgba(255,255,255,0.65)]'
            : 'text-white/90 [text-shadow:0_1px_6px_rgba(0,0,0,0.5)]'
        }`}
      >
        {date}
      </span>
    </div>
  );
}

/** 画廊单元格：1:1 预览 + 角标（未添加 = 绿色 +，已添加 = 灰色「已添加」不可点） */
function GalleryCell({
  kind,
  label,
  span,
  added,
  onAdd,
  children,
}: {
  kind: GalleryKind;
  label: string;
  span: string;
  added: boolean;
  onAdd: (kind: GalleryKind) => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={`gallery-widget-${kind}`} className={`relative ${span}`}>
      <div
        role={added ? undefined : 'button'}
        tabIndex={added ? -1 : 0}
        aria-label={added ? `${label}小组件（已添加到主屏幕）` : `添加${label}小组件到主屏幕`}
        aria-disabled={added || undefined}
        onClick={() => {
          if (!added) onAdd(kind);
        }}
        onKeyDown={(e) => {
          if (!added && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onAdd(kind);
          }
        }}
        className={`relative h-full w-full rounded-[20px] ${
          added ? '' : 'cursor-pointer outline-[1.5px] outline-dashed outline-white/30 -outline-offset-[6px] transition-opacity active:opacity-80'
        }`}
      >
        {children}
        {added ? (
          <span className="absolute right-[8px] top-[8px] z-10 flex items-center gap-[3px] rounded-full bg-black/55 px-[8px] py-[3px] text-[10px] font-medium text-white backdrop-blur-sm">
            <Check className="h-[11px] w-[11px]" strokeWidth={3} aria-hidden="true" />
            已添加
          </span>
        ) : (
          <span
            aria-hidden="true"
            data-testid={`gallery-add-${kind}`}
            className="absolute right-[6px] top-[6px] z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#34c759] text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          >
            <Plus className="h-[15px] w-[15px]" strokeWidth={3} />
          </span>
        )}
      </div>
    </div>
  );
}

/** 画廊内容（编辑模式浮层与主题页共用）：全部 14 种小组件平铺 1:1 排布（不分组），点击添加 */
export function WidgetGalleryContent({
  profileData,
  bubbleData,
  diaryData,
  listenData,
  dialogData,
  icityData,
  polaroidData,
  added,
  onAdd,
}: {
  profileData: ProfileCardData;
  bubbleData: BubbleCardData;
  diaryData: DiaryCardData;
  listenData: ListenCardData;
  dialogData: DialogCardData;
  icityData: ICityCardData;
  polaroidData: PolaroidCardData;
  added: Record<GalleryKind, boolean>;
  onAdd: (kind: GalleryKind) => void;
}) {
  const node = (kind: GalleryKind) => {
    switch (kind) {
      case 'clock':
        return <ClockGridWidget />;
      case 'weather':
        return <WeatherWidget />;
      case 'profile':
        return <ProfileCardWidget data={profileData} />;
      case 'bubble':
        return <BubbleCardWidget data={bubbleData} />;
      case 'diary':
        return <DiaryCardWidget data={diaryData} />;
      case 'listen':
        return <ListenCardWidget data={listenData} />;
      case 'music':
        return <MusicWidget />;
      case 'netease':
        return <NeteaseCardWidget />;
      case 'dialog':
        return <DialogCardWidget data={dialogData} />;
      case 'calendar':
        return <CalendarCardWidget />;
      case 'icity':
        return <ICityCardWidget data={icityData} />;
      case 'tickclock':
        return <TickClockCardWidget />;
      case 'polaroid':
        return <PolaroidCardWidget data={polaroidData} />;
      default:
        return <VinylCardWidget />;
    }
  };
  return (
    <div className="mx-auto w-[326px]" data-testid="widget-gallery">
      <div className="grid grid-cols-4 items-start gap-x-2 gap-y-[16px]">
        {GALLERY_ITEMS.map((item) => (
          <GalleryCell
            key={item.kind}
            kind={item.kind}
            label={item.label}
            span={item.span}
            added={added[item.kind]}
            onAdd={onAdd}
          >
            {node(item.kind)}
          </GalleryCell>
        ))}
      </div>
    </div>
  );
}

/** 主题 App「小组件」独立界面：全屏子页（深色壁纸质底板 + 全部小组件 1:1 画廊），
 *  添加直接写持久化布局并广播事件，主屏实时同步；返回按钮关闭子页 */
export function ThemesWidgetsPage({ onClose }: { onClose: () => void }) {
  /** 预览数据：主题 App 为纯客户端组件（registry 动态 ssr:false），可直接同步读 localStorage；
   *  挂载期间数据不可变（编辑器只在主屏），冻结一份即可 */
  const [cards] = useState(() => ({
    profile: loadProfileCard(),
    bubble: loadBubbleCard(),
    diary: loadDiaryCard(),
    listen: loadListenCard(),
    dialog: loadDialogCard(),
    icity: loadICityCard(),
    polaroid: loadPolaroidCard(),
  }));
  /** 主屏布局里已存在的小组件（null = 布局未读到，视作全部已添加防误加重复） */
  const [present, setPresent] = useState<Set<GalleryKind> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const rec = await localDB.get('settings', LAYOUT_DB_KEY);
        const pages = parsePages(rec?.value as StoredLayout | undefined);
        const set = new Set<GalleryKind>();
        for (const p of pages) {
          for (const t of p) {
            if (t.kind === 'widget' && typeof t.widget === 'string' && (GALLERY_KINDS as string[]).includes(t.widget))
              set.add(t.widget as GalleryKind);
          }
        }
        setPresent(set);
      } catch {
        /* 读不到布局时保持 null（全部按已添加处理） */
      }
    })();
  }, []);

  const handleAdd = (kind: GalleryKind) => {
    void addGalleryWidget(kind).then((ok) => {
      if (ok) {
        try {
          navigator.vibrate?.(10);
        } catch {
          /* 震动不可用 */
        }
        setPresent((s) => new Set(s ?? []).add(kind));
      }
    });
  };

  const added = Object.fromEntries(
    GALLERY_KINDS.map((k) => [k, present ? present.has(k) : true])
  ) as Record<GalleryKind, boolean>;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background" data-testid="themes-widgets-page">
      {/* 顶栏（自带状态栏避让；独立界面 = 自己的标题与返回） */}
      <div className="flex shrink-0 items-center gap-1 px-4 pb-2 pt-[54px]">
        <button
          type="button"
          aria-label="返回主题设置"
          data-testid="themes-widgets-back"
          onClick={onClose}
          className="-ml-1 flex items-center text-[17px] text-foreground transition-opacity active:opacity-50"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
          返回
        </button>
        <p className="pointer-events-none absolute left-1/2 top-[58px] -translate-x-1/2 text-[17px] font-bold leading-none tracking-tight">
          小组件
        </p>
      </div>

      {/* 深色壁纸质底板：全部小组件 1:1 预览（与主屏同宽 326px） */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        <div className="mx-auto mt-2 w-[326px] max-w-full rounded-[18px] bg-gradient-to-b from-[#3b3b3f] to-[#1b1b1e] py-4">
          <WidgetGalleryContent
            profileData={cards.profile}
            bubbleData={cards.bubble}
            diaryData={cards.diary}
            listenData={cards.listen}
            dialogData={cards.dialog}
            icityData={cards.icity}
            polaroidData={cards.polaroid}
            added={added}
            onAdd={handleAdd}
          />
        </div>
        <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-muted-foreground">
          全部小组件 1:1 预览：点右上角 + 添加到主屏幕（设置即时生效，主屏自动同步）；删除在主屏编辑模式点 × 即可。
        </p>
      </div>
    </div>
  );
}
