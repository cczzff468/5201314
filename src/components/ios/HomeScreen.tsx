'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { kvSet } from '@/lib/ios/idb-kv';
import dynamic from 'next/dynamic';
import { Plus, Search, X } from 'lucide-react';
import { useUI, useSettings, useSystemDark, selectResolvedTheme, type AppId } from '@/lib/ios/store';
import { shellScale } from '@/lib/ios/shell-scale';
import { useHomeWallpaperLight } from '@/lib/ios/foreground';
import { localDB } from '@/lib/ios/db';
import { useUnreadTotal, useBadge, wxUnreads, qqUnreads, chatBadge, phoneBadge } from '@/lib/unread-store';
import { DOCK_APPS, APPS, APP_MAP, AppIconById, AppMiniIcon } from '../apps/registry';
import {
  ProfileCardEditor,
  ProfileCardWidget,
  DEFAULT_PROFILE_CARD,
  PROFILE_CARD_KEY,
  loadProfileCard,
  type ProfileCardData,
} from './ProfileCard';
import {
  BubbleCardEditor,
  BubbleCardWidget,
  DEFAULT_BUBBLE_CARD,
  BUBBLE_CARD_KEY,
  loadBubbleCard,
  type BubbleCardData,
} from './BubbleCard';
import {
  DiaryCardEditor,
  DiaryCardWidget,
  DEFAULT_DIARY_CARD,
  DIARY_CARD_KEY,
  loadDiaryCard,
  type DiaryCardData,
} from './DiaryCard';
import {
  ListenCardEditor,
  ListenCardWidget,
  DEFAULT_LISTEN_CARD,
  LISTEN_CARD_KEY,
  loadListenCard,
  type ListenCardData,
} from './ListenCard';
import {
  DialogCardEditor,
  DialogCardWidget,
  DEFAULT_DIALOG_CARD,
  DIALOG_CARD_KEY,
  loadDialogCard,
  type DialogCardData,
} from './DialogCard';
import { NeteaseCardWidget } from './NeteaseCard';
import { VinylCardWidget } from './VinylCard';
import { MusicWidget } from './MusicWidget';
import { WidgetGalleryContent, GALLERY_KINDS, ClockGridWidget, type GalleryKind } from './WidgetGallery';
import { CalendarCardWidget } from './CalendarCard';
import { ICityCardWidget, ICityCardEditor, loadICityCard, type ICityCardData, DEFAULT_ICITY_CARD, ICITY_CARD_KEY } from './ICityCard';
import { TickClockCardWidget } from './TickClockCard';
import { PolaroidCardWidget, PolaroidCardEditor, loadPolaroidCard, type PolaroidCardData, DEFAULT_POLAROID_CARD, POLAROID_CARD_KEY } from './PolaroidCard';

// 天气小组件懒加载：主屏首帧先显示同尺寸占位，避免千行天气 App UI 拖慢首屏
const WeatherWidget = dynamic(() => import('@/components/apps/weather').then((m) => m.WeatherWidget), {
  ssr: false,
  loading: () => (
    <div className="mx-auto h-[152px] w-[152px] animate-pulse rounded-[24px] bg-white/10 backdrop-blur-md" aria-hidden="true" />
  ),
});

/**
 * iOS 主屏幕（多分页）：六类网格小组件（时钟/天气/信息卡片/气泡/日记/一起听，均可长按拖拽换位）
 * + App 图标网格 + 页点 + 搜索胶囊 + Dock。
 *
 * 分页：
 * - 网格拆成多页横向滑动：跟手拖动（手指带页走，首页/末页橡皮筋阻尼），松手按位移/甩速
 *   吸附翻页——轻轻一甩即翻页；跟手期间吞掉 click，不会误开 App；
 *   编辑模式同样可以从空白处左右轻扫翻页（图标上起手=拖拽换位，空白处起手=翻页）；
 * - 默认三页（其余小组件默认收起）：第 1 页 = 时钟小组件（顶部通栏整行、无边框大数字浮在壁纸上）
 *   + 天气小组件（152×152，占 2×2 格）+ 天气/主题/浏览器/备忘录/相机/照片/文件/计算器
 *   （用户指定顺序）；
 *   第 2 页 = 信息卡片小组件（顶部通栏大名片）+ 气泡小组件（双头像 + 各自头顶气泡，无边框浮在壁纸上）
 *   + 提醒事项/语音备忘录/日历/时钟（用户指定顺序）；
 *   第 3 页 = 网易云小组件（黑胶唱片播放器卡，点击开音乐 App）+ 音乐/微信/App Store/QQ/记忆/世界书
 *   （用户指定顺序，世界书自 v9 起纳入页尾）；
 *   日记/一起听/对话气泡/黑胶/iCity/日历/表盘时钟/拍立得八枚小组件默认收起（hidden 记录，不占页；
 *   v9 起 widgets-7 新加的四个不上屏——用户要求新添加的小组件不显示），
 *   需要时从编辑模式「+」画廊或主题 App「小组件」界面一键找回（默认落到末尾装得下的页）；
 *   （v6 起：存量旧版本布局直接重置为新默认，保留 hidden 删除记录（网易云旧收起记录除外，
 *   迁移时放行上屏）；旧数据缺小组件时按默认位置补回：时钟补到第 1 页头、天气补到时钟旁、
 *   信息卡片补到第 2 页头、气泡补到信息卡片后；收起的八枚不自动复活）；
 * - 信息卡片/气泡/日记/一起听小组件：点击弹出编辑器（换头像/换背景图/改文字 / 换头像改气泡文字 /
 *   改日记头像与文字 / 换头像改气泡与歌曲文案），数据经 idb-kv 写穿 IndexedDB（本地持久化）；
 * - 指示器互换（同一位置交叉淡入淡出）：静止时显示「搜索」胶囊，滑动中/翻页后短暂显示
 *   页点（点页点可跳页）；编辑模式页点常显；
 * - 添加界面的方式：编辑模式把 App 拖到屏幕左右边缘停留 ~320ms 翻到相邻页（可连续翻）；
 *   在最后一页继续贴住右缘 → 自动新建一页接住 App（页数无上限，每次拖拽限建一页）；
 *   退出编辑时自动清掉空白页（末尾连续的与中间空页都回收，至少保留 1 页）；
 * - 页容量：格数上限（含小组件的页 14 格、普通页 20 格）+ 行数硬上限 6 行（主屏永不上下滚动，
 *   App 不落到页点/Dock 下方的可视区外），超员拒绝落入；
 * - 布局持久化到 IndexedDB（settings store，key = 'homeLayout'），兼容旧单页格式
 *   （旧 grid 迁移为第 1 页；v6 起旧版本整体重置为新排布）。
 *
 * - 文件夹（iOS 同款）：编辑模式把 App 拖到另一 App/文件夹上，两种合入方式：
 *   ① 快捷压上松手：被拖图标压在目标上（重叠 ≥ 三成图标面积）直接建夹/入夹/并夹，
 *   不必等预览（用户反馈建夹太难）；② 悬停预览：指针压在目标槽位内且重叠任意，
 *   静止 ~180ms 弹预览（目标保持原样，原地轻微缩放脉动 + 外圈呼吸圆角方边框，
 *   被拖 App 不显示在里面）后松手合入；拖开即取消。轻放/擦过（重叠小）照常落位。
 *   只有重叠 ≥ 三成才暂停挤位换位（轻微擦过照常换位）——App 拖到下面/旁边/底部都能
 *   顺畅移过去、随时可换位；移动中永不弹预览，快速放到目标上松手 = 正常落位不是建夹；
 *   文件夹图标 = 毛玻璃圆角方（前 6 个 App 缩略图 3×2 + 超额数量角标）+ 名称；
 *   点按弹出全屏毛玻璃面板（点名称改名/分页滑动/点外部收起/点 App 打开；非编辑态长按
 *   面板任意处进入面板编辑——App 抖动、长按 320ms 拖出 App 到桌面），
 *   编辑模式轻点文件夹同样能打开面板；编辑模式可 × 整夹删除（App 退回主屏）、
 *   面板 × 从主屏移除单个 App（App 隐藏不回到桌面——用户要求回主屏一律长按拖出，
 *   App Store 可找回）；夹内 App 全部拖出或只剩 1 个时文件夹自动解体；
 *   文件夹结构持久化（layout.folders，App 实体存在夹内，从主网格移除）。
 * 编辑模式（长按任意图标/小组件或长按空白处进入）：
 * - 全部图标/小组件抖动，左上角出现深色「删除」× 角标；
 * - 左上角「+」→ 小组件画廊浮层（全部 14 种小组件 1:1 预览，点 + 添加回主屏，
 *   × 删除过的项从 hidden 找回；与主题 App「小组件」界面同一套画廊）
 *   + 右上角「恢复默认」与白色「完成」胶囊按钮；
 * - 编辑中点按空白处直接退出编辑（用户要求）；
 * - 长按住拖拽可自由放置：App↔App、小组件↔小组件、小组件↔App（小组件不能进 Dock）、跨页拖拽；
 *   插入语义——放到哪格就落哪格，其余项顺移让位（不要求先与目标换位，旁边没 App 也能放）；
 *   Dock 是连续插入轨道（按指针 x 决定插入点，空位直接放入）；
 * - 矮视口（手机分屏/自由小窗）：网格行数按实测壳高收敛（GRID_ROW_CAP 3~6 行），
 *   页点带/Dock 容器 pointer-events-none 穿透（底行图标不被浮层挡住按压），
 *   拖到底部空白只落到最后一条可视行（不会落进屏幕外「消失」）；
 * - 拖拽动画：被拖项为 fixed 浮动副本（挂在根层级，绝不落入带 backdrop-filter 的
 *   Dock 容器内——否则 fixed 会被当成本容器定位，图标拖起来就“消失”），
 *   原位置留占位槽（尺寸取目标区真实槽位，避免跨区拖拽时 Dock 拉高/网格行压缩），
 *   兄弟项用 FLIP 补间平滑让位（采样前先结束进行中的动画，避免动画中态污染起点），
 *   松手后浮动副本动画落回网格槽位；
 * - × 删除的项记入 hidden 持久化（刷新不复活），「恢复默认」可找回。
 */

/** 桌面小组件种类：时钟（大数字卡）/ 天气 / 信息卡片（个人名片）/ 气泡（双头像+各自头顶气泡）/ 日记（日记卡）/ 一起听（双人气泡+迷你播放器）/ 音乐（封面+进度+控制键，真实播放状态）/ 网易云（黑胶播放器卡）/ 对话气泡（双头像+交错双气泡）/ 黑胶（大唱片+唱针）/ 日历（月历横版）/ iCity（名字+日期+头像胶囊）/ 表盘时钟（刻度表圈）/ 拍立得（三张胶片照） */
export type WidgetKind = 'weather' | 'clock' | 'profile' | 'bubble' | 'diary' | 'listen' | 'music' | 'netease' | 'dialog' | 'vinyl' | 'calendar' | 'icity' | 'tickclock' | 'polaroid';
/** 桌面文件夹：名称 + 内部 App 序列（App 从主网格移入；全部拖出或只剩 1 个时文件夹自动解体） */
type FolderData = { id: string; name: string; apps: AppId[] };
type Tile = { kind: 'widget'; widget: WidgetKind } | { kind: 'app'; id: AppId } | { kind: 'folder'; id: string } | { kind: 'empty' };
type Zone = 'grid' | 'dock';

const WIDGET_KINDS: WidgetKind[] = ['weather', 'clock', 'profile', 'bubble', 'diary', 'listen', 'music', 'netease', 'dialog', 'vinyl', 'calendar', 'icity', 'tickclock', 'polaroid'];
/** 小组件元信息：× 删除角标文案 + 点击行为（openApp=null 的点击开对应编辑器） */
const WIDGET_META: Record<WidgetKind, { label: string; openApp: AppId | null }> = {
  weather: { label: '天气小组件', openApp: 'weather' },
  clock: { label: '时钟小组件', openApp: 'clock' },
  profile: { label: '信息卡片小组件', openApp: null },
  bubble: { label: '气泡小组件', openApp: null },
  diary: { label: '日记小组件', openApp: null },
  listen: { label: '一起听小组件', openApp: null },
  music: { label: '音乐小组件', openApp: 'music' },
  netease: { label: '网易云小组件', openApp: 'music' },
  dialog: { label: '对话气泡小组件', openApp: null },
  vinyl: { label: '黑胶小组件', openApp: 'music' },
  calendar: { label: '日历小组件', openApp: 'calendar' },
  icity: { label: 'iCity小组件', openApp: null },
  tickclock: { label: '表盘时钟小组件', openApp: 'clock' },
  polaroid: { label: '拍立得小组件', openApp: null },
};
/** 小组件网格跨度：时钟/日记/对话气泡（2 行）/信息卡片（3 行）= 顶部通栏整行，天气/气泡 = 2×2 方格，
 *  一起听/网易云/黑胶 = 2×3 竖版方格（App 环绕） */
const WIDGET_SPAN: Record<WidgetKind, string> = {
  clock: 'col-span-4 row-span-2',
  profile: 'col-span-4 row-span-3',
  weather: 'col-span-2 row-span-2 self-center',
  bubble: 'col-span-2 row-span-2 self-center',
  diary: 'col-span-4 row-span-2',
  listen: 'col-span-2 row-span-3',
  music: 'col-span-4 row-span-2',
  netease: 'col-span-2 row-span-3',
  dialog: 'col-span-4 row-span-2',
  vinyl: 'col-span-2 row-span-3',
  calendar: 'col-span-4 row-span-2',
  icity: 'col-span-2 row-span-2 self-center',
  tickclock: 'col-span-2 row-span-2 self-center',
  polaroid: 'col-span-4 row-span-2',
};

/** 小组件网格跨度（数值版）：flow 模拟 / 空白位行列线拟合（槽宽反推单列宽、槽高反推行距）用 */
const WIDGET_SPAN_SIZE: Record<WidgetKind, { c: number; r: number }> = {
  clock: { c: 4, r: 2 },
  profile: { c: 4, r: 3 },
  weather: { c: 2, r: 2 },
  bubble: { c: 2, r: 2 },
  diary: { c: 4, r: 2 },
  listen: { c: 2, r: 3 },
  music: { c: 4, r: 2 },
  netease: { c: 2, r: 3 },
  dialog: { c: 4, r: 2 },
  vinyl: { c: 2, r: 3 },
  calendar: { c: 4, r: 2 },
  icity: { c: 2, r: 2 },
  tickclock: { c: 2, r: 2 },
  polaroid: { c: 4, r: 2 },
};

/** 小组件稳定键（data-id / hidden / 拖拽 id 用）：带前缀避免与同名 App id（weather）冲突 */
const widgetKey = (w: WidgetKind): string => `widget:${w}`;
const isWidgetKey = (id: string): boolean => id.startsWith('widget:');
const widgetOfKey = (id: string): WidgetKind => {
  const k = id.slice('widget:'.length);
  return (WIDGET_KINDS as string[]).includes(k) ? (k as WidgetKind) : 'weather';
};
/** 文件夹稳定键（data-id / 拖拽 id 用）：带前缀避免与同名 App id 冲突 */
const folderKey = (id: string): string => `folder:${id}`;
const isFolderKey = (id: string): boolean => id.startsWith('folder:');
const folderIdOfKey = (id: string): string => id.slice('folder:'.length);
/** 新建文件夹 id（时间戳+序号，重启后不重复） */
let folderSeq = 0;
const newFolderId = (): string => `f${Date.now().toString(36)}${(folderSeq++).toString(36)}`;
/** tile 唯一键（小组件/文件夹用带前缀键，App 用自身 id，空占位格不参与交互用常量键） */
const tileKey = (t: Tile): string => (t.kind === 'widget' ? widgetKey(t.widget) : t.kind === 'empty' ? 'empty' : t.kind === 'folder' ? folderKey(t.id) : t.id);

const GRID_GAP_X = 8;

/** 模拟网格 auto-flow（sparse 不回填）：依次摆放 tiles，记录每个 tile 的 flow 起点
 *  与摆完后的游标。用于空白位放置时把指针位置（行,列）换算成插入下标与需要垫的
 *  空占位格数——「指针压哪格，App 就落到哪格」。 */
function flowPositions(tiles: Tile[]): {
  /** 每个 tile 摆放时的起点格（行,列） */
  starts: { r: number; c: number }[];
  /** 摆完第 i 个 tile 后的游标（after[i] = 第 i+1 个 tile 的理论起点） */
  after: { r: number; c: number }[];
  /** 全部摆完后的游标（= 第一个空闲格） */
  end: { r: number; c: number };
} {
  const occupied = new Set<string>();
  let cr = 0;
  let cc = 0;
  const starts: { r: number; c: number }[] = [];
  const after: { r: number; c: number }[] = [];
  const spanOf = (t: Tile): { c: number; r: number } => (t.kind === 'widget' ? WIDGET_SPAN_SIZE[t.widget] : { c: 1, r: 1 });
  const fits = (r: number, c: number, cs: number, rs: number): boolean => {
    if (c + cs > 4) return false;
    for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (occupied.has(`${r + i}:${c + j}`)) return false;
    return true;
  };
  const advance = (n: number) => {
    cc += n;
    while (cc >= 4) {
      cc -= 4;
      cr++;
    }
  };
  for (const t of tiles) {
    if (t.kind === 'empty') {
      starts.push({ r: cr, c: cc });
      occupied.add(`${cr}:${cc}`);
      advance(1);
      after.push({ r: cr, c: cc });
      continue;
    }
    const s = spanOf(t);
    while (!fits(cr, cc, s.c, s.r)) {
      advance(1);
    }
    starts.push({ r: cr, c: cc });
    for (let i = 0; i < s.r; i++) for (let j = 0; j < s.c; j++) occupied.add(`${cr + i}:${cc + j}`);
    advance(s.c);
    after.push({ r: cr, c: cc });
  }
  return { starts, after, end: { r: cr, c: cc } };
}

/** 拖拽命中位置：grid 带页号（index 为页内下标，padEmpty 为插入前需补的空占位格数，
 *  overId 为矩形命中时所指的原槽位 tile 键——悬停建夹/入夹用），dock 只有下标；
 *  folder 仅作拖拽源（从文件夹里拖出 App 时 zoneIndexOf 的返回），不是落点 */
type Hit =
  | { zone: 'grid'; page: number; index: number; padEmpty?: number; overId?: string }
  | { zone: 'dock'; index: number }
  | { zone: 'folder'; folderId: string; index: number };

interface HomeLayout {
  /** 布局版本（v2 = 微信/音乐/文件/提醒事项在第二页、音乐移出 Dock）；旧版自动迁移 */
  v?: number;
  /** 多页网格：每页一组 tile（小组件全布局唯一，跟随所在页；时钟/信息卡片通栏整行、天气 2×2 格） */
  pages: Tile[][];
  dock: AppId[];
  /** 用户删除过的项（'widget:weather'/'widget:clock' 或 AppId）：重新加载时不自动补回 */
  hidden: string[];
  /** 桌面文件夹（页内以 {kind:'folder', id} tile 引用；App 实体存在这里） */
  folders?: FolderData[];
}

const LAYOUT_KEY = 'homeLayout';
const DOCK_CAPACITY = 4;
const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 10;
/** 页容量：含小组件的页（小组件行 + 3 行 App）/ 普通页 20 App */
const PAGE_WIDGET_CAP = 14;
const PAGE_CAP = 20;
/** 轻扫跟手判定：总位移超过该值且横向占优 → 进入跟手翻页 */
const SWIPE_CLAIM_PX = 8;
/** 松手翻页阈值：位移超过页宽的比例 / 甩动速度（px/ms） */
const FLIP_PROGRESS = 0.22;
const FLIP_VELOCITY = 0.35;
/** 编辑模式拖拽贴近屏幕边缘后自动翻页的停留时长 */
const EDGE_FLIP_MS = 320;
/** 编辑模式拖拽的屏幕边缘感应区宽度（收窄：避开最后一列 App 槽位，
 *  48px 时覆盖右缘整列——用户往最后一列放 App 停留超时会被误翻页/建页） */
const EDGE_ZONE_PX = 22;
/** 拖拽命中：槽位矩形命中时四周外扩（px）——贴边/格间小空隙也能命中；
 *  网格列间隙 8px，外扩 6px 相邻格仅轻微重叠（重叠时取中心最近者，插入点相邻可忽略） */
const HIT_PAD_PX = 6;
/** 拖拽命中：Dock 槽位外扩（px）——Dock 图标间隙 18px，需要更大的感应范围才能
 *  顺畅地插入/排序 Dock（同时避免拖到 Dock 上方空白时误入网格兜底） */
const DOCK_HIT_PAD_PX = 30;
/** 悬停建夹/入夹的判定：指针停在某个可合并目标（App/文件夹）的槽位内且被拖图标与其
 *  有任意重叠（hit.overId === 扫描目标）→ 视为「压在目标上」——暂停挤位换位（目标不挪窝
 *  才能稳定悬停），指针基本静止 MERGE_DWELL_MS 后弹出合并预览，松手才建夹/入夹/并夹，
 *  拖出目标槽位即取消并恢复挤位换位。
 *  关键：只有「指针压在目标槽位内」才暂停换位——拖到目标的下方/旁边/穿过/进 Dock 都
 *  照常换位（旧版任意重叠就全局冻结换位，密集网格里拖到哪都被卡死，用户实测
 *  「移到下面移不动/不能换位」已修）；移动中永不弹预览，快速放到目标上松手 =
 *  快捷建夹/入夹（重叠 ≥ MERGE_DROP_RATIO）或正常落位（重叠小） */
const MERGE_DWELL_MS = 180;
/** 快捷合并阈值：松手时被拖图标与可合并目标的重叠 ≥ 图标面积的该比例 → 直接建夹/
 *  入夹/并夹（不必等悬停预览；用户反馈合成文件夹太难）。相邻槽位图标零重叠、
 *  槽间隙投放重叠 < 两成，都不会误触发；三成以上已经是明确「压在目标上」 */
const MERGE_DROP_RATIO = 0.3;
/** 图标可视尺寸（网格/Dock 槽位顶部居中的方形图标区；槽位矩形还包含下方标签） */
const ICON_SIZE = 60;
/** 文件夹展开面板每页 App 数（3 列 × 4 行） */
const FOLDER_PANEL_PAGE = 12;
/** 翻页后页点保持显示的时长（之后淡出回搜索胶囊） */
const DOTS_LINGER_MS = 1100;
/** 页网格行间距（gap-y-[16px]，与渲染处保持一致；行距拟合用） */
const GRID_GAP_Y = 16;

/** 当前布局版本：v10 = 音乐小组件（封面+进度+控制键，真实播放状态）默认上屏第 3 页顶部
 *  （网易云小组件上方，与音乐 App 同页聚落）——存量旧版本布局直接重置为新默认（保留 hidden 删除记录）；
 *  v9 = widgets-7 的四个新小组件（iCity/日历/表盘时钟/拍立得）改为默认收起不上屏
 *  （用户要求：新添加的小组件不显示；需要时从「+」画廊或主题 App「小组件」界面一键找回）；
 *  世界书 App 纳入第 3 页默认排布；日记/一起听/对话气泡/黑胶/iCity/日历/表盘时钟/拍立得均默认收起 */
const LAYOUT_VERSION = 10;
/** 第 1 页 App（用户指定顺序；时钟/天气小组件在其上方；App Store 已移至第 3 页——仍是已移除 App 的唯一恢复入口） */
const PAGE1_APP_IDS: AppId[] = ['weather', 'themes', 'browser', 'notes', 'camera', 'photos', 'files', 'calculator'];
/** 第 2 页 App（用户指定顺序；信息卡片/气泡小组件在其上方；音乐/微信移至第 3 页） */
const PAGE2_APP_IDS: AppId[] = ['reminders', 'recorder', 'calendar', 'clock'];
/** 第 3 页 App（用户指定：音乐/微信/App Store[在 QQ 左侧]/QQ；网易云小组件在其上方；
 *  世界书自 v9 起纳入页尾——否则 v9 重置路径提前 return 不会走 App 补位逻辑，世界书会从主屏消失；
 *  美团自 v10 起纳入页尾——存量布局走 sanitize 的「缺失 App 补位」自动上屏；
 *  情侣空间随后纳入页尾（不升版：存量布局同样走「缺失 App 补位」自动上屏））；
 *  拾光小屋（原「情侣小家」独立 App）纳入页尾（不升版：存量布局自动补位上屏） */
const PAGE3_APP_IDS: AppId[] = ['music', 'wechat', 'appstore', 'qq', 'memory', 'worldbook', 'meituan', 'couple', 'cottage', 'forum'];
/** 其余小组件（默认收起不显示：写入 hidden，需要时从「+」画廊/主题小组件页找回；
 *  网易云小组件自 v6 起默认上屏第 3 页，不再收起；
 *  v9 起 widgets-7 的四个新小组件 iCity/日历/表盘时钟/拍立得也默认收起——用户要求新添加的小组件不显示） */
const DEFAULT_HIDDEN_WIDGETS: WidgetKind[] = ['diary', 'listen', 'dialog', 'vinyl', 'icity', 'calendar', 'tickclock', 'polaroid'];

function defaultLayout(): HomeLayout {
  return {
    v: LAYOUT_VERSION,
    pages: [
      [
        { kind: 'widget', widget: 'clock' },
        { kind: 'widget', widget: 'weather' },
        ...PAGE1_APP_IDS.map((id) => ({ kind: 'app' as const, id })),
      ],
      [
        { kind: 'widget', widget: 'profile' },
        { kind: 'widget', widget: 'bubble' },
        ...PAGE2_APP_IDS.map((id) => ({ kind: 'app' as const, id })),
      ],
      [
        { kind: 'widget', widget: 'music' },
        { kind: 'widget', widget: 'netease' },
        ...PAGE3_APP_IDS.map((id) => ({ kind: 'app' as const, id })),
      ],
    ],
    dock: DOCK_APPS.map((a) => a.id),
    hidden: DEFAULT_HIDDEN_WIDGETS.map(widgetKey),
  };
}

/** 某页容量：页内有小组件则 14 格，否则 20 格（插入小组件时按插入后计算） */
function pageCap(page: Tile[], insertingWidget = false): number {
  return page.some((t) => t.kind === 'widget') || insertingWidget ? PAGE_WIDGET_CAP : PAGE_CAP;
}

/** 主屏网格最大行数（用户要求：主屏不上下滑动、App 不放到可视区下方；Dock 不受影响）：
 *  页网格从顶部内边距 72px（编辑模式 120px）到页点上方的可视边界（844−164=680px）共 608px，
 *  行高 76px+行距 16px → 6 行（536px）完整可见、7 行（628px）会顶进页点/Dock 区域。
 *  页面已改为 overflow-hidden 永不滚动，所有落点/补位/加小组件入口都按 6 行封顶 */
const MAX_PAGE_ROWS = 6;
/** 行数上限的运行时值：默认 = MAX_PAGE_ROWS（390×844 满高壳）。矮视口（手机分屏/自由小窗，
 *  移动端壳高 =100svh 可低至 ~500px）由 HomeScreen 挂载后按真实壳高收紧（3~6 行）——
 *  否则 6 行网格会顶进 z-10 的页点带/Dock（底行 App 被盖住按住拖不动，用户实测），
 *  且拖到底部空白会落到屏幕外第 5/6 行「移到底部消失」（用户实测）。
 *  纯函数（pageHasRoom/rowsOf 校验、hitTest 空白兜底、sanitize 重排）都读这里，
 *  保证「布局允许的行」与「屏幕上摸得到的行」永远一致 */
let GRID_ROW_CAP = MAX_PAGE_ROWS;

/** 一页 tiles 顺序摆放占用的总行数（含小组件跨行与空占位格；空页=0） */
function rowsOf(tiles: Tile[]): number {
  if (tiles.length === 0) return 0;
  const { end } = flowPositions(tiles);
  return end.c === 0 ? end.r : end.r + 1;
}

/** 页内还能否容纳 extra 一批 tile：把「现内容 + extra」整体模拟摆放后校验——
 *  行数 ≤ GRID_ROW_CAP（硬约束：超出即顶进页点/Dock 被裁/屏幕外，页面又不可滚动；
 *  矮视口下由组件实测收敛，见 GRID_ROW_CAP 注释）
 *  且格数 ≤ 页容量。extra 会按顺序接在页尾摆放，与各入口的追加语义一致 */
function pageHasRoom(page: Tile[], extra: Tile[] = [], insertingWidget = false): boolean {
  if (page.length + extra.length > pageCap(page, insertingWidget)) return false;
  return rowsOf([...page, ...extra]) <= GRID_ROW_CAP;
}

/**
 * 校验/修复持久化布局：
 * - 兼容旧单页 {grid}：迁移为第 1 页；
 * - v6 起布局重排：旧版本直接重置为新默认（保留 hidden 删除记录）；
 * - 小组件全布局唯一、App 去重、Dock ≤4、缺失 App 按容量补到末尾有空间的页（hidden 的除外）。
 */
function sanitizeLayout(raw: unknown): HomeLayout {
  const allIds = APPS.map((a) => a.id);
  const def = defaultLayout();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as { v?: unknown; pages?: unknown; grid?: unknown; dock?: unknown; hidden?: unknown; folders?: unknown };

  const hidden = new Set<string>();
  if (Array.isArray(r.hidden)) {
    for (const h of r.hidden) {
      if (typeof h !== 'string') continue;
      // 旧格式 'widget'（全布局唯一时代）→ 天气小组件；小组件键需为已知种类
      if (h === 'widget' || h === widgetKey('weather')) hidden.add(widgetKey('weather'));
      else if (isWidgetKey(h) && (WIDGET_KINDS as string[]).includes(h.slice('widget:'.length))) hidden.add(h);
      else if (!isWidgetKey(h) && (allIds as string[]).includes(h)) hidden.add(h);
    }
  }

  // 布局版本升级（v6/v7 重排等）：旧版本布局直接重置为新默认（App 全部按用户指定的新排布落位）。
  // hidden 合并「默认收起的第三/四页其余小组件」与存量删除记录，并从默认页里滤掉 hidden 项
  // （否则被删过的 App/小组件会随默认页短暂重现，直到下一次 sanitize 才被剔除）；
  // 网易云旧收起记录放行——v5 及更早它是「默认收起」而非「用户删除」，v6 要上屏第 3 页
  if ((typeof r.v === 'number' ? r.v : 1) < LAYOUT_VERSION) {
    const merged = new Set([...def.hidden, ...hidden]);
    merged.delete(widgetKey('netease'));
    const pages = def.pages.map((p) =>
      p.filter((t) => (t.kind === 'widget' ? !merged.has(widgetKey(t.widget)) : t.kind === 'app' ? !merged.has(t.id) : true))
    );
    return { v: LAYOUT_VERSION, pages, dock: def.dock, hidden: Array.from(merged) };
  }

  const dock: AppId[] = [];
  if (Array.isArray(r.dock)) {
    for (const id of r.dock) {
      if (typeof id === 'string' && (allIds as string[]).includes(id) && !dock.includes(id as AppId) && !hidden.has(id)) {
        if (dock.length < DOCK_CAPACITY) dock.push(id as AppId);
      }
    }
  }

  // 解析页列表：新格式 {pages}；旧格式 {grid} → 第 1 页（语音备忘录挪出）+ 第 2 页（语音备忘录）
  let rawPages: unknown[][] = [];
  if (Array.isArray(r.pages)) {
    rawPages = (r.pages as unknown[]).map((p) => (Array.isArray(p) ? p : []));
  } else if (Array.isArray(r.grid)) {
    const page0 = (r.grid as unknown[]).filter((t) => {
      const o = t as { kind?: unknown; id?: unknown } | null;
      return !(o && typeof o === 'object' && o.kind === 'app' && o.id === 'recorder');
    });
    rawPages = [page0];
    if (!hidden.has('recorder') && !dock.includes('recorder')) {
      rawPages.push([{ kind: 'app', id: 'recorder' as AppId }]);
    }
  }

  const pages: Tile[][] = [];
  const widgetSeen: Record<WidgetKind, boolean> = {
    weather: hidden.has(widgetKey('weather')),
    clock: hidden.has(widgetKey('clock')),
    profile: hidden.has(widgetKey('profile')),
    bubble: hidden.has(widgetKey('bubble')),
    diary: hidden.has(widgetKey('diary')),
    listen: hidden.has(widgetKey('listen')),
    music: hidden.has(widgetKey('music')),
    netease: hidden.has(widgetKey('netease')),
    dialog: hidden.has(widgetKey('dialog')),
    vinyl: hidden.has(widgetKey('vinyl')),
    calendar: hidden.has(widgetKey('calendar')),
    icity: hidden.has(widgetKey('icity')),
    tickclock: hidden.has(widgetKey('tickclock')),
    polaroid: hidden.has(widgetKey('polaroid')),
  };
  const placed = new Set<AppId>(dock);
  for (const list of rawPages) {
    const page: Tile[] = [];
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const o = t as { kind?: unknown; id?: unknown; widget?: unknown };
      if (o.kind === 'empty') {
        // 空占位格（拖到行尾空位/空列时补齐列位）：原样保留，否则重排会让 App 位置漂移
        page.push({ kind: 'empty' });
        continue;
      }
      if (o.kind === 'widget') {
        // 已知种类（未知/无 widget 字段 → 天气，兼容最老格式）；每种全布局唯一，重复丢弃
        const w = typeof o.widget === 'string' && (WIDGET_KINDS as string[]).includes(o.widget) ? (o.widget as WidgetKind) : 'weather';
        if (widgetSeen[w]) continue;
        widgetSeen[w] = true;
        page.push({ kind: 'widget', widget: w });
      } else if (o.kind === 'folder' && typeof o.id === 'string' && o.id) {
        // 文件夹 tile：先原样保留，等 folders 解析后统一剔除无效/重复项（校验需要 folders 数据）
        page.push({ kind: 'folder', id: o.id });
      } else if (o.kind === 'app' && typeof o.id === 'string' && (allIds as string[]).includes(o.id)) {
        const id = o.id as AppId;
        if (hidden.has(id) || placed.has(id)) continue;
        placed.add(id);
        page.push({ kind: 'app', id });
      }
    }
    pages.push(page);
  }
  if (pages.length === 0) pages.push([]);

  // 文件夹解析：校验 id/名称/App 合法性（App 去重、不与网格/Dock 重复、hidden 剔除），
  // 空文件夹与无 tile 的孤儿文件夹剔除；文件夹里的 App 计入 placed（缺失 App 补位时不会重复入网格）
  const validFolderIds = new Set<string>();
  const foldersOut: FolderData[] = [];
  if (Array.isArray(r.folders)) {
    for (const f of r.folders) {
      if (!f || typeof f !== 'object') continue;
      const fo = f as { id?: unknown; name?: unknown; apps?: unknown };
      if (typeof fo.id !== 'string' || !fo.id || validFolderIds.has(fo.id)) continue;
      const apps: AppId[] = [];
      if (Array.isArray(fo.apps)) {
        for (const a of fo.apps) {
          if (typeof a !== 'string' || !(allIds as string[]).includes(a)) continue;
          if (hidden.has(a as AppId) || placed.has(a as AppId) || apps.includes(a as AppId)) continue;
          apps.push(a as AppId);
          placed.add(a as AppId);
        }
      }
      validFolderIds.add(fo.id);
      foldersOut.push({ id: fo.id, name: typeof fo.name === 'string' && fo.name.trim() ? fo.name.trim().slice(0, 30) : '文件夹', apps });
    }
  }
  const seenFolderTiles = new Set<string>();
  for (const pg of pages) {
    for (let i = pg.length - 1; i >= 0; i--) {
      const t = pg[i];
      if (t.kind !== 'folder') continue;
      const ok = validFolderIds.has(t.id) && !seenFolderTiles.has(t.id) && (foldersOut.find((f) => f.id === t.id)?.apps.length ?? 0) > 0;
      if (ok) seenFolderTiles.add(t.id);
      else pg.splice(i, 1);
    }
  }
  let folders = foldersOut.filter((f) => seenFolderTiles.has(f.id));
  // 文件夹只剩 ≤1 个 App 时自动解体（新规则，存量数据同样生效）：1 个 → 剩余 App 原位
  // 变普通图标；0 个 → tile 剔除；1 个但无 tile 的孤儿从 placed 移除，交给下方缺失
  // App 补位兑底，避免 App 凭空丢失
  const dyingIds = new Set(folders.filter((f) => f.apps.length <= 1).map((f) => f.id));
  if (dyingIds.size > 0) {
    for (const pg of pages) {
      for (let i = pg.length - 1; i >= 0; i--) {
        const t = pg[i];
        if (t.kind !== 'folder' || !dyingIds.has(t.id)) continue;
        const f = folders.find((x) => x.id === t.id);
        if (f && f.apps.length === 1) pg[i] = { kind: 'app', id: f.apps[0] };
        else pg.splice(i, 1);
      }
    }
    for (const f of folders) {
      if (f.apps.length !== 1) continue;
      if (!pages.some((pg) => pg.some((t) => t.kind === 'app' && t.id === f.apps[0]))) placed.delete(f.apps[0]);
    }
    folders = folders.filter((f) => f.apps.length > 1);
  }
  // 缺失的小组件按默认位置补回（hidden 的不补——默认收起的第 3/4 页小组件与被删除的
  // 小组件都在 hidden 里，不会自动复活；用户主动加回后此处不再介入）：时钟→第 1 页头、
  // 天气→时钟旁、信息卡片→第 2 页头、气泡→信息卡片后、日记/一起听/网易云→第 3 页、
  // 对话气泡/黑胶→第 4 页（存量布局不足时新建页）
  if (!widgetSeen.clock) pages[0].unshift({ kind: 'widget', widget: 'clock' });
  if (!widgetSeen.weather) {
    const at = pages[0].length > 0 && pages[0][0].kind === 'widget' && pages[0][0].widget === 'clock' ? 1 : 0;
    pages[0].splice(at, 0, { kind: 'widget', widget: 'weather' });
  }
  if (!widgetSeen.profile) {
    while (pages.length < 2) pages.push([]);
    pages[1].unshift({ kind: 'widget', widget: 'profile' });
  }
  if (!widgetSeen.bubble) {
    while (pages.length < 2) pages.push([]);
    const p2 = pages[1];
    const pi = p2.findIndex((t) => t.kind === 'widget' && t.widget === 'profile');
    p2.splice(pi >= 0 ? pi + 1 : p2.length, 0, { kind: 'widget', widget: 'bubble' });
  }
  if (!widgetSeen.diary) {
    while (pages.length < 3) pages.push([]);
    pages[2].unshift({ kind: 'widget', widget: 'diary' });
  }
  if (!widgetSeen.listen) {
    while (pages.length < 3) pages.push([]);
    const p3 = pages[2];
    const di = p3.findIndex((t) => t.kind === 'widget' && t.widget === 'diary');
    p3.splice(di >= 0 ? di + 1 : p3.length, 0, { kind: 'widget', widget: 'listen' });
  }
  if (!widgetSeen.netease) {
    while (pages.length < 3) pages.push([]);
    const p3 = pages[2];
    const li = p3.findIndex((t) => t.kind === 'widget' && t.widget === 'listen');
    p3.splice(li >= 0 ? li + 1 : p3.length, 0, { kind: 'widget', widget: 'netease' });
  }
  // 第四页（用户要求）：对话气泡 → 第 4 页头（不足四页新建）、黑胶 → 对话气泡后
  if (!widgetSeen.dialog) {
    while (pages.length < 4) pages.push([]);
    pages[3].unshift({ kind: 'widget', widget: 'dialog' });
  }
  if (!widgetSeen.vinyl) {
    while (pages.length < 4) pages.push([]);
    const p4 = pages[3];
    const di = p4.findIndex((t) => t.kind === 'widget' && t.widget === 'dialog');
    p4.splice(di >= 0 ? di + 1 : p4.length, 0, { kind: 'widget', widget: 'vinyl' });
  }
  // widgets-7 四个新小组件缺失时的默认落位：iCity→第 2 页气泡后、日历→第 3 页头、
  // 表盘时钟→第 4 页头、拍立得→表盘时钟后（hidden 里的不补——v9 起默认收起，存量布局已在
  // hidden 里，不会自动复活；用户从画廊主动加回后此处不再介入）
  if (!widgetSeen.icity) {
    while (pages.length < 2) pages.push([]);
    const p2 = pages[1];
    const bi = p2.findIndex((t) => t.kind === 'widget' && t.widget === 'bubble');
    p2.splice(bi >= 0 ? bi + 1 : p2.length, 0, { kind: 'widget', widget: 'icity' });
  }
  if (!widgetSeen.calendar) {
    while (pages.length < 3) pages.push([]);
    pages[2].unshift({ kind: 'widget', widget: 'calendar' });
  }
  if (!widgetSeen.tickclock) {
    while (pages.length < 4) pages.push([]);
    pages[3].unshift({ kind: 'widget', widget: 'tickclock' });
  }
  if (!widgetSeen.polaroid) {
    while (pages.length < 4) pages.push([]);
    const p4 = pages[3];
    const ti = p4.findIndex((t) => t.kind === 'widget' && t.widget === 'tickclock');
    p4.splice(ti >= 0 ? ti + 1 : p4.length, 0, { kind: 'widget', widget: 'polaroid' });
  }

  // 存量超行页一次性归位（用户要求主屏不上下滚动、App 不放到可视区下方；本步必须
  // 在小组件补回之后——unshift 通栏小组件可能把存量页顶超 6 行）：逐页把 6 行装不下的
  // 尾部 tile 摘出（优先摘 App/文件夹，页内只剩小组件仍超行才摘小组件），按原顺序
  // 回填到来源页之后第一张装得下的页（都不满则新建页；小组件按跨行占位校验）
  const carry: { t: Tile; from: number }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const overflow: Tile[] = [];
    while (rowsOf(pg) > GRID_ROW_CAP && pg.length > 0) {
      let cut = -1;
      for (let j = pg.length - 1; j >= 0; j--) {
        if (pg[j].kind !== 'widget') {
          cut = j;
          break;
        }
      }
      if (cut < 0) cut = pg.length - 1;
      overflow.unshift(...pg.splice(cut));
    }
    carry.push(...overflow.map((t) => ({ t, from: i })));
  }
  for (const { t, from } of carry) {
    let target = -1;
    for (let i = Math.min(from + 1, pages.length - 1); i < pages.length; i++) {
      if (pageHasRoom(pages[i], [t], t.kind === 'widget')) {
        target = i;
        break;
      }
    }
    if (target === -1) {
      pages.push([]);
      target = pages.length - 1;
    }
    pages[target].push(t);
  }

  // 缺失的 App：从末尾往前找还有容量的页补入，都满了就开新页（同样受 6 行封顶约束）
  for (const id of allIds) {
    if (hidden.has(id) || placed.has(id)) continue;
    let target = -1;
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pageHasRoom(pages[i], [{ kind: 'app', id: id as AppId }])) {
        target = i;
        break;
      }
    }
    if (target === -1) {
      pages.push([]);
      target = pages.length - 1;
    }
    pages[target].push({ kind: 'app', id });
    placed.add(id);
  }
  return { v: LAYOUT_VERSION, pages, dock, hidden: Array.from(hidden), folders };
}

/** 布局持久化（模块级：初始加载迁移回写与组件内拖拽/删除等共用同一写入口） */
const persist = (l: HomeLayout) => {
  void localDB
    .put('settings', { key: LAYOUT_KEY, value: { v: l.v ?? LAYOUT_VERSION, pages: l.pages, dock: l.dock, hidden: l.hidden, folders: l.folders ?? [] } })
    .then(() => {
      // 落库成功后广播：App Store「已移除」等跨组件视图据此刷新（App Store 窗口保活，
      // 只靠 mount 时读一次会漏掉编辑模式里的删除/恢复）
      window.dispatchEvent(new CustomEvent('home-layout-updated'));
    })
    .catch(() => undefined);
};

/**
 * 把拖拽项移动到目标区/目标页/目标索引（跨区、跨页可搬；小组件/文件夹不可进 Dock；
 * Dock 超员时挤出最后一个回网格；目标页超容量/超 6 行则整体放弃）。
 * 命中索引来自拖拽开始时捕获的静态几何，先移除被拖项再插入目标索引即可。
 * 拖拽源支持文件夹（zone:'folder'）：把 App 从文件夹里移出；
 * 文件夹解体由调用方处理（dissolveSmallFolders：全部拖出或只剩 1 个 App 时消失）。
 */
function reorder(layout: HomeLayout, id: string, to: Hit): HomeLayout {
  const pages = layout.pages.map((p) => p.slice());
  const dock = layout.dock.slice();
  const folders = (layout.folders ?? []).map((f) => ({ ...f, apps: f.apps.slice() }));

  const isWidget = isWidgetKey(id);
  const isFolder = isFolderKey(id);
  let fromZone: Zone | 'folder' | null = null;
  let fromPage = -1;
  let fromIndex = -1;
  let fromFolderId: string | null = null;
  for (let p = 0; p < pages.length; p++) {
    const i = pages[p].findIndex((t) => tileKey(t) === id);
    if (i >= 0) {
      fromZone = 'grid';
      fromPage = p;
      fromIndex = i;
      break;
    }
  }
  if (fromZone === null) {
    const di = dock.indexOf(id as AppId);
    if (di >= 0) {
      fromZone = 'dock';
      fromIndex = di;
    } else if (!isFolder) {
      // App 可能从文件夹里拖出（面板拖拽）
      const fi = folders.findIndex((f) => f.apps.includes(id as AppId));
      if (fi >= 0) {
        fromZone = 'folder';
        fromFolderId = folders[fi].id;
        fromIndex = folders[fi].apps.indexOf(id as AppId);
      } else {
        return layout;
      }
    } else {
      return layout;
    }
  }

  // 取出被拖项
  if (fromZone === 'grid') pages[fromPage].splice(fromIndex, 1);
  else if (fromZone === 'dock') dock.splice(fromIndex, 1);
  else {
    const fi = folders.findIndex((f) => f.id === fromFolderId);
    if (fi >= 0) {
      const ai = folders[fi].apps.indexOf(id as AppId);
      if (ai >= 0) folders[fi].apps.splice(ai, 1);
    }
  }

  if (to.zone === 'dock') {
    if (isWidget || isFolder) {
      // 小组件/文件夹不可进 Dock：放回原位
      const tile: Tile = isFolder ? { kind: 'folder', id: folderIdOfKey(id) } : { kind: 'widget', widget: widgetOfKey(id) };
      pages[fromZone === 'grid' ? fromPage : Math.max(0, pages.length - 1)].splice(
        Math.max(0, Math.min(pages[fromZone === 'grid' ? fromPage : pages.length - 1].length, fromIndex)),
        0,
        tile
      );
      return { ...layout, pages, dock, folders };
    }
    dock.splice(Math.max(0, Math.min(dock.length, to.index)), 0, id as AppId);
    if (dock.length > DOCK_CAPACITY) {
      const moved = dock.pop() as AppId;
      const homePage = fromZone === 'grid' ? fromPage : pages.length - 1;
      const insertAt = fromZone === 'grid' ? Math.max(0, Math.min(pages[homePage].length, fromIndex)) : pages[homePage].length;
      pages[homePage].splice(insertAt, 0, { kind: 'app', id: moved });
    }
    return { ...layout, pages, dock, folders };
  }

  // 落入网格某页：超容量/超 6 行则整体放弃（放回原位）；行数是硬约束（含同页换位——
  // 垫空占位格可能新开行），主屏页面不可滚动，超出即顶进页点/Dock 被裁
  //（folder 仅作拖拽源永不作为落点，见 Hit 注释——此处收窄类型）
  if (to.zone !== 'grid') return layout;
  const target = pages[Math.min(to.page, pages.length - 1)];
  const samePageMove = fromZone === 'grid' && fromPage === to.page;
  const padEmpty = to.zone === 'grid' ? Math.max(0, Math.min(8, to.padEmpty ?? 0)) : 0;
  const idx0 = Math.max(0, Math.min(target.length, to.index));
  // 空占位格：把新项从自然落点推到指针所指的（行,列）（拖到行尾空位/任意空白格的精确定位）
  const empties: Tile[] = Array.from({ length: padEmpty }, () => ({ kind: 'empty' as const }));
  const tile: Tile = isWidget
    ? { kind: 'widget', widget: widgetOfKey(id) }
    : isFolder
      ? { kind: 'folder', id: folderIdOfKey(id) }
      : { kind: 'app', id: id as AppId };
  if (!pageHasRoom(target, [...empties, tile], isWidget)) {
    if (fromZone === 'grid' || fromZone === 'folder') {
      const homePage = fromZone === 'grid' ? fromPage : Math.max(0, pages.length - 1);
      pages[homePage].splice(Math.max(0, Math.min(pages[homePage].length, fromIndex)), 0, tile);
    } else {
      dock.splice(fromIndex, 0, id as AppId);
    }
    return { ...layout, pages, dock, folders };
  }
  target.splice(idx0, 0, ...empties, tile);
  return { ...layout, pages, dock, folders };
}

/** 文件夹自动解体（用户要求）：夹内 App 全部移出（0 个）或只剩 1 个时文件夹消失——
 *  0 个：tile 直接剔除；1 个：剩余 App 落回文件夹 tile 原格（原位变回普通 App 图标）。
 *  无 tile 的孤儿文件夹（异常数据兑底）把剩余 App 补到末尾第一张装得下的页（都不满则开新页） */
function dissolveSmallFolders(l: HomeLayout): HomeLayout {
  const folders = l.folders ?? [];
  const dying = folders.filter((f) => f.apps.length <= 1);
  if (dying.length === 0) return l;
  const deadIds = new Set(dying.map((f) => f.id));
  const pages = l.pages.map((p) => p.slice());
  for (const pg of pages) {
    for (let i = pg.length - 1; i >= 0; i--) {
      const t = pg[i];
      if (t.kind !== 'folder' || !deadIds.has(t.id)) continue;
      const f = dying.find((x) => x.id === t.id);
      if (f && f.apps.length === 1) pg[i] = { kind: 'app', id: f.apps[0] };
      else pg.splice(i, 1);
    }
  }
  for (const f of dying) {
    if (f.apps.length !== 1) continue;
    const id = f.apps[0];
    if (pages.some((p) => p.some((t) => t.kind === 'app' && t.id === id))) continue;
    let target = -1;
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pageHasRoom(pages[i], [{ kind: 'app', id }])) {
        target = i;
        break;
      }
    }
    if (target === -1) {
      pages.push([]);
      target = pages.length - 1;
    }
    pages[target].push({ kind: 'app', id });
  }
  return { ...l, pages, folders: folders.filter((f) => f.apps.length > 1) };
}

function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (!a || !b) return false;
  if (a.zone !== b.zone) return false;
  if (a.zone === 'dock' && b.zone === 'dock') return a.index === b.index;
  if (a.zone === 'folder' && b.zone === 'folder') return a.folderId === b.folderId && a.index === b.index;
  if (a.zone === 'grid' && b.zone === 'grid')
    // padEmpty 也要比：拖到自己紧后方的空白位时 index 与原位相同但需要垫空占位格，
    // 若只比 page/index 会被误判为「拖回原位」而放弃（预览/松手都弹回，用户实测）
    return a.page === b.page && a.index === b.index && (a.padEmpty ?? 0) === (b.padEmpty ?? 0);
  return false;
}

/** 悬停合并预览数据：targetKey = 目标 tile 键；targetPos = 目标被移除前的页/下标（建夹落点兑底用） */
type MergePreviewData =
  | { targetKey: string; kind: 'app'; appId: AppId; targetPos: { page: number; index: number } }
  | { targetKey: string; kind: 'folder'; folderId: string; targetPos: { page: number; index: number } };

/** 编辑模式 × 删除角标（深色圆底白叉，位于图标/小组件左上角） */
function DeleteBadge({
  label,
  onRemove,
  className = '',
}: {
  label: string;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`删除${label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className={`absolute z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#3a3a3c]/90 text-white shadow-[0_1px_5px_rgba(0,0,0,0.4)] backdrop-blur-sm transition-transform active:scale-90 ${className}`}
    >
      <X className="h-[13px] w-[13px]" strokeWidth={3.2} aria-hidden="true" />
    </button>
  );
}

/** 网格时钟小组件：主屏与画廊共用的通栏大数字钟（实现在 WidgetGallery.tsx，此处引入） */

/** 主屏 App 未读角标（iOS 同款：图标右上角红底白字数字，微信/QQ 会话未读 + 信息/电话未读实时同步） */
function AppUnreadBadge({
  appId,
  count,
  size = 'grid',
}: {
  appId: AppId;
  count: number;
  /** grid = 主屏/Spotlight 60px 图标；dock = Dock 58px 图标 */
  size?: 'grid' | 'dock';
}) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={`home-unread-badge-${appId}`}
      aria-label={`${count} 条未读`}
      className={`absolute z-10 flex items-center justify-center rounded-full bg-[#FF3B30] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${
        size === 'grid'
          ? '-right-[6px] -top-[6px] h-[21px] min-w-[21px] px-[6px] text-[13px]'
          : '-right-[5px] -top-[5px] h-[20px] min-w-[20px] px-[5px] text-[12px]'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/**
 * 文件夹展开面板：全屏毛玻璃（iOS 风格：壁纸重模糊+暗化，内容从中心弹出）。
 * - 顶部文件夹名：点按进入改名（回车/失焦提交，Esc 取消）；
 * - App 网格：3 列 × 4 行 = 每页 12 个，多页时左右滑动（跟手 + 阈值翻页）+ 页点；
 * - 点面板外部收起；点 App 打开 App（面板同步关闭）；
 * - 编辑态：主屏编辑态带入，或非编辑态长按面板任意处 420ms 进入面板本地编辑
 *   （App 抖动 + × 从主屏移除——App 隐藏不回到桌面，回主屏一律长按拖出；
 *   点面板内空白退出本地编辑；点面板外仍收起整个面板）；
 * - 编辑态按住 320ms 起拖（拖出即关面板，进入桌面级拖拽，可落到网格任意格/
 *   其他文件夹/Dock）。
 */
function FolderPanel({
  folder,
  edit,
  appIconNode,
  appUnreadOf,
  onClose,
  onOpenApp,
  onRename,
  onRemoveApp,
  onDragOut,
}: {
  folder: FolderData;
  edit: boolean;
  appIconNode: (id: AppId) => ReactNode;
  appUnreadOf: (id: AppId) => number;
  onClose: () => void;
  onOpenApp: (id: AppId) => void;
  onRename: (name: string) => void;
  onRemoveApp: (id: AppId) => void;
  onDragOut: (id: AppId, x: number, y: number) => void;
}) {
  const chunks: AppId[][] = [];
  for (let i = 0; i < folder.apps.length; i += FOLDER_PANEL_PAGE) chunks.push(folder.apps.slice(i, i + FOLDER_PANEL_PAGE));
  const [pi, setPi] = useState(0);
  const safePi = Math.min(pi, Math.max(0, chunks.length - 1));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  /** 面板本地编辑态：非编辑态长按面板任意处 420ms 进入（主屏编辑态也能带入，二者取或） */
  const [localEdit, setLocalEdit] = useState(false);
  const eEdit = edit || localEdit;
  // 深色模式（第六十七轮：文件夹适配深色）——展开面板暗化加深
  const themeMode = useSettings((s) => s.theme);
  const dark = selectResolvedTheme(themeMode, useSystemDark()) === 'dark';
  const trackRef = useRef<HTMLDivElement | null>(null);
  const swipeP = useRef<{ x: number; y: number; claimed: boolean; dx: number } | null>(null);
  const pressT = useRef<number | null>(null);
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  /** 非编辑态长按进编辑的计时器（面板空白处与 App 图标共用，与主屏同款 420ms） */
  const lpT = useRef<number | null>(null);
  const lpPos = useRef<{ x: number; y: number } | null>(null);
  /** 本次指针手势的按下时刻：长按（进编辑）后的 click 不再视为点按——桌面端鼠标长按
   *  松手会补发 click，不拦会被根 onClick 立刻退出编辑/收起面板（移动端无 click 不受影响） */
  const rootDownAt = useRef(0);

  const commitRename = () => {
    setRenaming(false);
    const n = draft.trim();
    if (n && n !== folder.name) onRename(n);
    else if (!n) setDraft(folder.name);
  };

  const clearPress = () => {
    if (pressT.current !== null) {
      window.clearTimeout(pressT.current);
      pressT.current = null;
    }
    pressPos.current = null;
  };

  /** 非编辑态：长按 420ms 进入面板本地编辑（与主屏进编辑的手感一致） */
  const clearLp = () => {
    if (lpT.current !== null) {
      window.clearTimeout(lpT.current);
      lpT.current = null;
    }
    lpPos.current = null;
  };
  const armLp = (x: number, y: number) => {
    clearLp();
    lpPos.current = { x, y };
    lpT.current = window.setTimeout(() => {
      lpT.current = null;
      lpPos.current = null;
      setLocalEdit(true);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
    }, LONG_PRESS_MS);
  };

  /** 编辑态面板内 App：按住 320ms 起拖（轻点不误拖，拖出即关面板交给桌面级拖拽）；
   *  非编辑态：长按 420ms 进入面板编辑 */
  const cellDown = (id: AppId) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!eEdit) {
      // 不 stopPropagation：面板根的空白长按/翻页轻扫照常工作（双计时器都进编辑，幂等）
      armLp(e.clientX, e.clientY);
      return;
    }
    e.stopPropagation();
    clearLp();
    pressPos.current = { x: e.clientX, y: e.clientY };
    pressT.current = window.setTimeout(() => {
      pressT.current = null;
      const p = pressPos.current;
      pressPos.current = null;
      if (p) onDragOut(id, p.x, p.y);
    }, 320);
  };
  const cellMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = pressPos.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearPress();
    const l = lpPos.current;
    if (l && Math.hypot(e.clientX - l.x, e.clientY - l.y) > 10) clearLp();
  };
  const cellUp = () => {
    clearPress();
    clearLp();
  };

  /** 面板分页跟手（首页/末页橡皮筋阻尼） */
  const trackFollow = (dx: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rb = (safePi === 0 && dx > 0) || (safePi === chunks.length - 1 && dx < 0) ? dx * 0.32 : dx;
    track.style.transform = `translateX(calc(${-safePi * 100}% + ${rb}px))`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`文件夹${folder.name}`}
      data-testid="folder-panel"
      className={`folder-fade absolute inset-0 z-40 flex flex-col items-center pb-[120px] pt-[96px] backdrop-blur-2xl ${
        dark ? 'bg-black/55' : 'bg-black/30'
      }`}
      onPointerDown={(e) => {
        // 面板分页滑动起手（阻断向主屏冒泡，避免误触主屏手势）；
        // 非编辑态长按面板任意处（除按钮/输入框）→ 进入面板本地编辑
        rootDownAt.current = performance.now();
        swipeP.current = { x: e.clientX, y: e.clientY, claimed: false, dx: 0 };
        if (!eEdit) {
          const t = e.target as HTMLElement;
          if (!t.closest('button') && !t.closest('input')) armLp(e.clientX, e.clientY);
        }
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        const l = lpPos.current;
        if (l && Math.hypot(e.clientX - l.x, e.clientY - l.y) > 10) clearLp();
        const s = swipeP.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.claimed && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          s.claimed = true;
          const track = trackRef.current;
          if (track) track.style.transition = 'none';
        }
        if (s.claimed) {
          s.dx = dx;
          trackFollow(dx);
        }
      }}
      onPointerUp={() => {
        clearLp();
        const s = swipeP.current;
        swipeP.current = null;
        if (!s?.claimed) return;
        const track = trackRef.current;
        if (track) {
          track.style.transition = '';
          const np = Math.max(0, Math.min(chunks.length - 1, s.dx < -40 ? safePi + 1 : s.dx > 40 ? safePi - 1 : safePi));
          track.style.transform = `translateX(-${np * 100}%)`;
          setPi(np);
        }
      }}
      onPointerCancel={() => {
        clearLp();
        swipeP.current = null;
      }}
      onClick={() => {
        // 长按（≥350ms，如长按进编辑）后的 click 不视为点按——否则桌面端长按进编辑
        // 后松手补发的 click 会立刻退出编辑/收起面板
        if (performance.now() - rootDownAt.current >= 350) return;
        // 编辑态点面板内空白 = 退出面板本地编辑；其余情况点面板外（含主屏编辑态）= 收起面板
        if (localEdit) {
          setLocalEdit(false);
          return;
        }
        onClose();
      }}
    >
      <div className="folder-pop flex w-full max-w-[312px] flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* 名称：点按进入改名 */}
        <div className="mb-5 flex h-[36px] items-center justify-center" data-testid="folder-name-bar">
          {renaming ? (
            <input
              autoFocus
              data-testid="folder-name-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(folder.name);
                  setRenaming(false);
                }
              }}
              aria-label="文件夹名称"
              className="w-[190px] rounded-[10px] bg-white/15 px-3 py-1 text-center text-[20px] font-semibold text-white outline-none ring-2 ring-white/40"
            />
          ) : (
            <button
              type="button"
              data-testid="folder-name"
              onClick={() => setRenaming(true)}
              className="max-w-[240px] truncate rounded-[10px] px-3 py-1 text-[22px] font-semibold text-white [text-shadow:0_1px_6px_rgba(0,0,0,0.45)] transition-colors active:bg-white/10"
            >
              {folder.name}
            </button>
          )}
        </div>
        {/* 分页轨道：每页 3 列 × 4 行 = 12 个 App */}
        <div className="w-full overflow-hidden" data-testid="folder-pages">
          <div
            ref={trackRef}
            className="flex transition-transform duration-300"
            style={{ transform: `translateX(-${safePi * 100}%)`, transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
          >
            {chunks.map((apps, ci) => (
              <div key={ci} className="grid w-full shrink-0 grid-cols-3 gap-y-[18px] px-2 py-2" aria-hidden={ci !== safePi}>
                {apps.map((id) => (
                  <div
                    key={id}
                    data-testid={`folder-app-${id}`}
                    data-fdrag={eEdit ? id : undefined}
                    className="flex touch-none select-none flex-col items-center gap-[6px]"
                    onPointerDown={cellDown(id)}
                    onPointerMove={cellMove}
                    onPointerUp={cellUp}
                    onPointerCancel={cellUp}
                    onClick={(e) => {
                      if (!eEdit) onOpenApp(id);
                      else e.stopPropagation(); // 编辑态轻点 App 不退出本地编辑/不收面板
                    }}
                  >
                    <span className="relative block h-[64px] w-[64px]">
                      <span className={`block h-full w-full overflow-hidden rounded-[15px] ${eEdit ? 'home-jiggle' : 'transition-transform duration-150 active:scale-90'}`}>
                        {appIconNode(id)}
                      </span>
                      <AppUnreadBadge appId={id} count={appUnreadOf(id)} size="grid" />
                      {eEdit && <DeleteBadge label={APP_MAP[id].name} onRemove={() => onRemoveApp(id)} className="-left-[7px] -top-[7px]" />}
                    </span>
                    <span className="max-w-[78px] truncate text-center text-[11px] font-medium leading-none text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
                      {APP_MAP[id].name}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* 页点（多页时显示） */}
        {chunks.length > 1 && (
          <div className="mt-4 flex items-center justify-center gap-[7px]">
            {chunks.map((_, i) => (
              <span key={i} className={`h-[7px] rounded-full transition-all duration-200 ${i === safePi ? 'w-[20px] bg-white' : 'w-[7px] bg-white/40'}`} />
            ))}
          </div>
        )}
        <p className="mt-5 text-[12px] text-white/60">{eEdit ? '长按 App 拖出到桌面 · × 从主屏移除' : '长按可整理 · 点按名称改名 · 点面板外收起'}</p>
      </div>
    </div>
  );
}

export default function HomeScreen() {
  const openApp = useUI((s) => s.openApp);
  const activeApp = useUI((s) => s.activeApp);
  // 主屏壁纸整体亮度：浅色壁纸（如白图）时图标标签/页点自动改深色，保证可读
  const wallpaperLight = useHomeWallpaperLight();
  // 深色模式（第六十七轮：文件夹 tile 适配深色——深色烟熏玻璃，与图标深色分支同源）
  const dark = selectResolvedTheme(useSettings((s) => s.theme), useSystemDark()) === 'dark';
  // 主题页设置的自定义 App 图标（无则用默认 icon）
  const customIcons = useSettings((s) => s.customIcons);
  // 微信/QQ 会话未读总数（与 App 内未读总线实时同步 → 主屏图标红角标）
  const wxUnreadTotal = useUnreadTotal(wxUnreads);
  const qqUnreadTotal = useUnreadTotal(qqUnreads);
  // 信息/电话 App 角标（App 内未读状态镜像总线，挂载时下方 effect 会从真实数据源校准一次）
  const chatUnread = useBadge(chatBadge);
  const phoneUnread = useBadge(phoneBadge);
  /** App 图标未读角标数（微信/QQ 会话未读 + 信息小助手未读 + 电话未读留言） */
  const appUnreadOf = (id: AppId) =>
    id === 'wechat'
      ? wxUnreadTotal
      : id === 'qq'
        ? qqUnreadTotal
        : id === 'chat'
          ? chatUnread
          : id === 'phone'
            ? phoneUnread
            : 0;
  // 挂载校准：信息 App 未读态（ios-chat-assistant-read）与电话未读留言（IndexedDB voicemarks）直接读源，
  // 保证还没打开过 App 时角标也是准的（App 内打开后会经总线 set() 持续同步）
  useEffect(() => {
    let alive = true;
    try {
      // 信息未读校准：优先读未读条数（AI 发了几条角标就是几）；旧数据只有已读布尔 → 未读时至少 1
      let n = 0;
      const raw = Number(window.localStorage.getItem('ios-chat-assistant-unread-n'));
      if (Number.isFinite(raw) && raw > 0) n = Math.min(Math.floor(raw), 99);
      if (window.localStorage.getItem('ios-chat-assistant-read') !== '1') n = Math.max(n, 1);
      chatBadge.set(n);
    } catch {
      // 存储不可用时跳过
    }
    void localDB
      .getAll('voicemails')
      .then((vms) => {
        if (alive) phoneBadge.set(vms.filter((v) => !v.read).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [spotlight, setSpotlight] = useState(false);
  const [query, setQuery] = useState('');

  // ---------------- 信息卡片小组件（第二页顶部） ----------------
  const [profileCard, setProfileCard] = useState<ProfileCardData>(DEFAULT_PROFILE_CARD);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  // ---------------- 气泡小组件（第二页，双头像 + 各自头顶可改文字的聊天泡） ----------------
  const [bubbleCard, setBubbleCard] = useState<BubbleCardData>(DEFAULT_BUBBLE_CARD);
  const [bubbleEditorOpen, setBubbleEditorOpen] = useState(false);
  // ---------------- 日记小组件（第三页，头像/名字/ID/文案可改） ----------------
  const [diaryCard, setDiaryCard] = useState<DiaryCardData>(DEFAULT_DIARY_CARD);
  const [diaryEditorOpen, setDiaryEditorOpen] = useState(false);
  // ---------------- 一起听小组件（第三页，双头像/气泡/歌名/歌词/状态文案可改） ----------------
  const [listenCard, setListenCard] = useState<ListenCardData>(DEFAULT_LISTEN_CARD);
  const [listenEditorOpen, setListenEditorOpen] = useState(false);
  // ---------------- 对话气泡小组件（第四页，双头像/双气泡可改） ----------------
  const [dialogCard, setDialogCard] = useState<DialogCardData>(DEFAULT_DIALOG_CARD);
  const [dialogEditorOpen, setDialogEditorOpen] = useState(false);
  // ---------------- iCity 小组件（第二页，名字/头像/胶囊一句话可改） ----------------
  const [icityCard, setIcityCard] = useState<ICityCardData>(DEFAULT_ICITY_CARD);
  const [icityEditorOpen, setIcityEditorOpen] = useState(false);
  // ---------------- 拍立得小组件（第四页，三张照片可换） ----------------
  const [polaroidCard, setPolaroidCard] = useState<PolaroidCardData>(DEFAULT_POLAROID_CARD);
  const [polaroidEditorOpen, setPolaroidEditorOpen] = useState(false);
  // 挂载后读 localStorage（SSR 首帧先渲染默认内容，避免水合不一致）
  useEffect(() => {
    setProfileCard(loadProfileCard());
    setBubbleCard(loadBubbleCard());
    setDiaryCard(loadDiaryCard());
    setListenCard(loadListenCard());
    setDialogCard(loadDialogCard());
    setIcityCard(loadICityCard());
    setPolaroidCard(loadPolaroidCard());
  }, []);
  const saveProfileCard = (d: ProfileCardData) => {
    setProfileCard(d);
    try {
      kvSet(PROFILE_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const saveBubbleCard = (d: BubbleCardData) => {
    setBubbleCard(d);
    try {
      kvSet(BUBBLE_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const saveDiaryCard = (d: DiaryCardData) => {
    setDiaryCard(d);
    try {
      kvSet(DIARY_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const saveListenCard = (d: ListenCardData) => {
    setListenCard(d);
    try {
      kvSet(LISTEN_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const saveDialogCard = (d: DialogCardData) => {
    setDialogCard(d);
    try {
      kvSet(DIALOG_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const saveIcityCard = (d: ICityCardData) => {
    setIcityCard(d);
    try {
      kvSet(ICITY_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };
  const savePolaroidCard = (d: PolaroidCardData) => {
    setPolaroidCard(d);
    try {
      kvSet(POLAROID_CARD_KEY, d);
    } catch {
      /* 存储满时忽略 */
    }
  };

  // ---------------- 布局（编辑模式数据） ----------------
  const [layout, setLayout] = useState<HomeLayout>(() => defaultLayout());
  /** 当前页（0 起）；翻页 = track 平移 */
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState(false);
  /** 编辑模式「+」小组件画廊浮层（第三/四页小组件 1:1 预览，点 + 添加回主屏） */
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** 已展开的文件夹 id（null = 无；展开面板为全屏毛玻璃浮层，点外部收起） */
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  /** 悬停合并预览（App 拖到另一 App/文件夹上停留后出现；松手建夹/入夹/并夹） */
  const [mergePreview, setMergePreview] = useState<MergePreviewData | null>(null);
  /** 页点是否显示（滑动中/翻页后短暂显示；编辑模式常显；平时该位置显示搜索胶囊） */
  const [dotsShown, setDotsShown] = useState(false);
  /** 正在拖拽的项 id（null = 未拖拽；用 state 而非 ref 以便渲染期读取） */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState({ dx: 0, dy: 0 });
  /** 浮动副本的基准位置/尺寸（拖拽开始时被拖项的视口矩形） */
  const [dragVisual, setDragVisual] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragging = dragId !== null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 分页轨道（宽度 = 单页宽，跨页命中检测的平移基准） */
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tileEls = useRef(new Map<string, HTMLElement>());
  /** FLIP 起点：上一次布局里各项的位置 */
  const rectsRef = useRef(new Map<string, { left: number; top: number }>());
  /** 松手落位动画的起点（浮动副本最后视觉位置） */
  const pendingSettle = useRef<{ id: string; x: number; y: number } | null>(null);

  const layoutRef = useRef(layout);
  const pageRef = useRef(page);
  const dragMeta = useRef<{ id: string; startX: number; startY: number } | null>(null);
  /** 拖拽起点：开始拖时的命中位置 + 完整布局快照（拖回原位松手时整布局复原） */
  const dragOrigin = useRef<{ hit: Hit; layout: HomeLayout } | null>(null);
  /** 拖拽开始时捕获的静态网格几何（槽位→矩形+尺寸+类型+页号）：拖拽全程用几何判定命中，
   *  不受 FLIP 动画/React 渲染时序影响（WAAPI transform 会参与 DOM 命中测试，不可用）；
   *  非当前页的槽位按 (自身页 - 当前页) × 页宽 动态平移后参与命中 → 翻页后无需重采几何 */
  const dragGeo = useRef<
    { id: string; zone: Zone; page: number; index: number; kind: 'widget' | 'app'; left: number; top: number; w: number; h: number }[]
  >([]);
  /** 拖拽期间的主屏矩形 + 页宽（边缘自动翻页/跨页平移用） */
  const dragRootRect = useRef<DOMRect | null>(null);
  /** Dock 容器矩形（beginDrag 时捕获）：拖到 Dock 图标右侧空位也能落入 Dock */
  const dragDockRect = useRef<DOMRect | null>(null);
  const dragPageW = useRef(0);
  /** 上一次拖拽预览的命中位置（sameHit 去重）：预览垫格后被拖项的实际下标与命中下标
   *  永不相等（命中定义在摘除垫格的序列上），必须靠 lastHit 去重，否则同一指针位置
   *  每帧重做 reorder（布局值等价但 setState 不断触发） */
  const lastDragHit = useRef<Hit | null>(null);
  const edgeFlip = useRef<-1 | 0 | 1>(0);
  const flipTimer = useRef<number | null>(null);
  /** 边缘翻页：最近一次指针位置（翻页后原地重新计时用） */
  const edgePointer = useRef<{ x: number } | null>(null);
  /** 本次拖拽是否已新建过页面（最后一页贴右缘拖拽建页；一次拖拽限建一页防连建） */
  const pageCreated = useRef(false);
  const dragDeltaRef = useRef({ dx: 0, dy: 0 });
  const dragVisualRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef<number | null>(null);
  /** 非编辑模式轻扫跟手翻页：一次指针手势的完整状态（起点/接管标记/甩速…） */
  const swipe = useRef<{
    startX: number;
    startY: number;
    claimed: boolean;
    dead: boolean;
    moved: boolean;
    lastX: number;
    lastT: number;
    v: number;
    w: number;
  } | null>(null);
  /** 页点显示的自动淡出计时器 */
  const dotsTimer = useRef<number | null>(null);
  /** 悬停合并预览（非响应式镜像，事件处理里读） */
  const mergeRef = useRef<MergePreviewData | null>(null);
  /** 合并预览的静止压住计时器：压住目标 ≥240ms 才弹预览（移动中永不弹，快速放下=正常换位） */
  const mergeDwellT = useRef<number | null>(null);
  /** 计时器起点的指针位置：大幅移动（>6px）重置计时，轻微手抖不重置 */
  const mergeDwellPos = useRef<{ x: number; y: number } | null>(null);
  /** 拖拽开始时的壳缩放系数（桌面端机身可能被等比缩小；窗口 resize 中途变化忽略，下次拖拽重捕）。
   *  壳 transform 后 fixed 层用「壳本地坐标」渲染：viewport px ÷ scale = 本地 px */
  const scaleRef = useRef(1);

  // ref 与 state 同步（render 期间禁止写 ref，故放 effect）
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // 编辑模式同步到全局 UI store：PhoneShell 底部边缘上滑手势据此跳过多任务切换器
  // （编辑模式下上滑不应进多任务，用户要求）；卸载时兜底复位
  useEffect(() => {
    useUI.setState({ homeEdit: edit });
    return () => useUI.setState({ homeEdit: false });
  }, [edit]);

  // 页数变少（删 App/恢复默认）时把当前页夹回有效范围
  useEffect(() => {
    const last = Math.max(0, layout.pages.length - 1);
    if (page > last) setPage(last);
  }, [layout.pages.length, page]);

  /** 翻页（非编辑轻扫 / 编辑边缘滞留共用）：夹紧到有效页范围 */
  const flipTo = (next: number) => {
    const last = Math.max(0, layoutRef.current.pages.length - 1);
    const np = Math.max(0, Math.min(last, next));
    if (np === pageRef.current) return;
    pageRef.current = np;
    setPage(np);
  };

  // ---------------- 页点/搜索互换 ----------------
  /** 滑动跟手中：显示页点且不自动隐藏（松手后由 showDots 接管淡出） */
  const holdDots = () => {
    if (dotsTimer.current !== null) {
      window.clearTimeout(dotsTimer.current);
      dotsTimer.current = null;
    }
    setDotsShown(true);
  };
  /** 显示页点并在 DOTS_LINGER_MS 后淡出回搜索胶囊 */
  const showDots = (linger = DOTS_LINGER_MS) => {
    setDotsShown(true);
    if (dotsTimer.current !== null) window.clearTimeout(dotsTimer.current);
    dotsTimer.current = window.setTimeout(() => {
      dotsTimer.current = null;
      setDotsShown(false);
    }, linger);
  };
  useEffect(() => {
    return () => {
      if (dotsTimer.current !== null) window.clearTimeout(dotsTimer.current);
    };
  }, []);

  // ---------------- 非编辑模式：跟手翻页 ----------------
  /** 跟手平移轨道：首页右拖/末页左拖给橡皮筋阻尼。
   *  位移取自 clientX 差（视口 px）；轨道 transform 在壳本地坐标系（壳可能被等比缩小）
   *  → 先 ÷ 壳缩放换算成本地 px，跟手速度才与手指一致 */
  const setTrackFollow = (dx: number) => {
    const track = trackRef.current;
    if (!track) return;
    const last = Math.max(0, layoutRef.current.pages.length - 1);
    const p = pageRef.current;
    const local = dx / (shellScale.value || 1);
    const off = (p === 0 && local > 0) || (p === last && local < 0) ? local * 0.32 : local;
    track.style.transform = `translateX(calc(${-p * 100}% + ${off}px))`;
  };

  /** 手势接管为翻页：轨道改为跟手（关缓动）、显示页点、吞 click、取消长按计时 */
  const claimSwipe = () => {
    const s = swipe.current;
    if (!s) return;
    s.claimed = true;
    s.moved = true;
    const track = trackRef.current;
    if (track) {
      track.style.transition = 'none';
      // 横屏旋转后 getBoundingClientRect 返回旋转后 bbox：前进轴对应屏募高度而非宽度
      const rect = track.getBoundingClientRect();
      s.w = (shellScale.rotated ? rect.height : rect.width) || 1;
    }
    holdDots();
    clearBlankPress();
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  /** 结束轻扫：按位移/甩速吸附到目标页并恢复缓动；flipAllowed=false（pointercancel）直接弹回 */
  const endSwipe = (flipAllowed: boolean, clientX?: number) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !s.claimed) return;
    if (typeof clientX === 'number') s.lastX = clientX;
    const track = trackRef.current;
    const last = Math.max(0, layoutRef.current.pages.length - 1);
    let target = pageRef.current;
    if (flipAllowed && track) {
      const dx = s.lastX - s.startX;
      const progress = -dx / s.w;
      if (progress > FLIP_PROGRESS || s.v < -FLIP_VELOCITY) target = pageRef.current + 1;
      else if (progress < -FLIP_PROGRESS || s.v > FLIP_VELOCITY) target = pageRef.current - 1;
    }
    target = Math.max(0, Math.min(last, target));
    if (track) {
      track.style.transition = '';
      track.style.transform = `translateX(-${target * 100}%)`;
    }
    if (target !== pageRef.current) {
      try {
        navigator.vibrate?.(6);
      } catch {
        /* 震动不可用 */
      }
    }
    pageRef.current = target;
    setPage(target);
    if (s.moved) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 400);
      dragMeta.current = null;
    }
    // Dock 矩形同理：松手落位 hitTestAt 全部结束后再清（beginDrag 每次重新捕获）
    showDots();
  };

  /** 横屏旋转时壳本地系相对视口转了 90°：翻页手势的「前进轴」从视口 x 换到视口 y
   *  （clientX↔clientY 互换后，用户在屏幕上沿页面平铺方向滑动才能翻页） */
  const swipeX = (e: { clientX: number; clientY: number }) => (shellScale.rotated ? e.clientY : e.clientX);
  /** 副轴（判定斜向手势用）：横屏时与前进轴互换 */
  const swipeY = (e: { clientX: number; clientY: number }) => (shellScale.rotated ? e.clientX : e.clientY);

  // ---------------- 矮视口网格行数收敛 ----------------
  // 用户实测（手机分屏/自由小窗，壳高仅 ~500px）：①编辑模式下底部行 App 按住拖不动——
  // 底行图标被 z-10 的页点带/Dock 盖住，按压全落在浮层上；②文件夹拖到底部空白会
  // 「移到底部消失」——空白兜底夹到静态 6 行上限，第 5/6 行在屏幕外。
  // 这里按真实壳高把 GRID_ROW_CAP 收敛到「最后一行图标底边不越过页点带顶边」：
  // 桌面壳逻辑高恒 844（fit 缩放只影响视觉不改内部布局）→ 恒 6 行、行为不变；
  // 移动端 scale 恒 1，root 实测高即壳本地高（100svh，URL 栏显隐不影响）。
  const [rowCap, setRowCap] = useState(MAX_PAGE_ROWS);
  const dockCount = layout.dock.length;
  useLayoutEffect(() => {
    const measure = () => {
      let shellH = 844;
      if (!window.matchMedia('(min-width: 640px)').matches) {
        const root = rootRef.current;
        if (!root) return;
        // 横屏旋转后壳 bbox 宽高互换：本地高 = 旋转后 bbox 宽 ÷ 缩放
        const r = root.getBoundingClientRect();
        shellH = (shellScale.rotated ? r.width : r.height) / (shellScale.value || 1);
      }
      // 页点带顶边 = 壳高 − 根容器 pb-38 − Dock 高（有 App 84 / 空 26）− 页点带 34（与渲染处常量一致）
      const dockH = layoutRef.current.dock.length > 0 ? 84 : 26;
      const bandTop = shellH - 38 - dockH - 34;
      // 首行图标顶 = 网格 pt-72；行距 = 行高 76（图标 60+间距 5+标签 11）+ 行间隙 16 = 92
      const cap = Math.floor((bandTop - 72 - ICON_SIZE) / (ICON_SIZE + 5 + 11 + GRID_GAP_Y)) + 1;
      const next = Math.max(3, Math.min(MAX_PAGE_ROWS, cap));
      GRID_ROW_CAP = next;
      setRowCap((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [dockCount]);
  // 行数上限收紧（窗口缩放/Dock 满空切换）后，把存量超行布局重排到后续页并回写
  useEffect(() => {
    const cur = layoutRef.current;
    if (!cur.pages.some((pg) => rowsOf(pg) > GRID_ROW_CAP)) return;
    const next = sanitizeLayout(cur);
    layoutRef.current = next;
    setLayout(next);
    persist(next);
  }, [rowCap]);

  // 首次加载：读取持久化布局（兼容旧单页格式）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rec = await localDB.get('settings', LAYOUT_KEY);
        if (alive) {
          const raw = rec?.value as { v?: number; pages?: unknown } | undefined;
          const next = sanitizeLayout(raw);
          layoutRef.current = next;
          setLayout(next);
          // 迁移回写：旧版本布局经 sanitize 升级后立即持久化——否则主题 App「小组件」
          // 界面等直读 DB 的场景会看到旧布局，且每次加载都要重跑迁移；
          // 存量超行页被重排（6 行封顶）时同样回写，保持 DB 与屏上布局一致
          if (raw?.v !== LAYOUT_VERSION || JSON.stringify(next.pages) !== JSON.stringify(raw?.pages ?? null)) persist(next);
        }
      } catch {
        /* IndexedDB 不可用时保持默认 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 主题 App「小组件」界面添加后同步：重读持久化布局（本组件只监听不派发，无回环）
  useEffect(() => {
    let alive = true;
    const onExternalLayout = () => {
      void (async () => {
        try {
          const rec = await localDB.get('settings', LAYOUT_KEY);
          if (!alive) return;
          const raw = rec?.value as { v?: number } | undefined;
          const next = sanitizeLayout(raw);
          layoutRef.current = next;
          setLayout(next);
          // 外部写入的是旧版本格式时同样回写升级结果，保持 DB 与内存一致
          if (raw?.v !== LAYOUT_VERSION) persist(next);
        } catch {
          /* IndexedDB 不可用时忽略 */
        }
      })();
    };
    window.addEventListener('home-layout-updated', onExternalLayout);
    return () => {
      alive = false;
      window.removeEventListener('home-layout-updated', onExternalLayout);
    };
  }, []);

  const setTileRef = (id: string) => (el: HTMLElement | null) => {
    if (el) tileEls.current.set(id, el);
    else tileEls.current.delete(id);
  };

  /** 结束所有格子上的 WAAPI 动画（FLIP/落位）：动画 transform 会参与 getBoundingClientRect，
   *  不先结束会让 FLIP 起点/拖拽几何采到动画中态，表现为换位时图标跳动/乱飞 */
  const finishTileAnimations = () => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
      el.getAnimations().forEach((a) => {
        try {
          a.finish();
        } catch {
          /* 无限动画无法 finish（抖动动画在内层元素上，不会出现在这里） */
        }
      });
    });
  };

  /** 当前 DOM 里所有普通槽位的位置（跳过占位/浮动副本） */
  const captureRects = () => {
    const map = new Map<string, { left: number; top: number }>();
    rootRef.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
      if (el.dataset.dragging === 'true') return;
      const id = el.dataset.id;
      if (!id) return;
      const r = el.getBoundingClientRect();
      map.set(id, { left: r.left, top: r.top });
    });
    return map;
  };

  /** 编辑模式：× 删除图标/小组件/文件夹（记入 hidden，刷新不复活；文件夹 → App 退回主屏） */
  const removeTile = (id: string) => {
    if (isFolderKey(id)) {
      removeFolderReturnApps(folderIdOfKey(id));
      return;
    }
    const cur = layoutRef.current;
    const next: HomeLayout = {
      ...cur,
      pages: cur.pages.map((p) => p.filter((t) => tileKey(t) !== id)),
      dock: cur.dock.filter((a) => a !== id),
      hidden: Array.from(new Set([...cur.hidden, id])),
    };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 按 tileKey 找布局里的 tile（含所在页/下标）；悬停合并判定/激活用 */
  const findTileInLayout = (l: HomeLayout, key: string): { tile: Tile; page: number; index: number } | null => {
    for (let p = 0; p < l.pages.length; p++) {
      const i = l.pages[p].findIndex((t) => tileKey(t) === key);
      if (i >= 0) return { tile: l.pages[p][i], page: p, index: i };
    }
    return null;
  };

  /** 悬停合并预览激活（纯视觉，不改布局）：预览数据只是标记 + 目标当前落位，
   *  目标原地轻微缩放脉动 + 外圈一圈呼吸的圆角方边框（渲染层处理）；
   *  松手才真正建夹/入夹/并夹（用户要求：预览阶段 App 不放进去） */
  const showMergePreview = (data: MergePreviewData) => {
    mergeRef.current = data;
    setMergePreview(data);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 清除悬停合并预览（纯视觉）：布局本来就未被预览改动，无需复原 */
  const clearMergePreview = () => {
    if (!mergeRef.current) return;
    mergeRef.current = null;
    setMergePreview(null);
    // 预览期间挤位换位被暂停，取消后强制下一帧重新评估落点
    lastDragHit.current = null;
  };

  /** 清除合并预览的静止压住计时器（endDrag/beginDrag/拖出重叠区时调用） */
  const clearMergeDwell = () => {
    if (mergeDwellT.current !== null) {
      window.clearTimeout(mergeDwellT.current);
      mergeDwellT.current = null;
    }
    mergeDwellPos.current = null;
  };

  /** 入夹飞入动画（iOS 同款）：松手合并后，被拖 App 图标从松手位置缩小飞进目标文件夹。
   *  纯视觉浮层——布局在 applyMerge 已一次性提交，这里只补「飞进去」的过程感 */
  const [flyIn, setFlyIn] = useState<{ appId: AppId; fx: number; fy: number; tx: number; ty: number } | null>(null);
  const flyInEl = useRef<HTMLSpanElement | null>(null);

  /**
   * 即时合并扫描：在当前页上找「与被拖图标矩形重叠最大」的可合并 tile。
   * - 纯几何判定：遍历当前布局的 App/文件夹 tile，取其「当前槽位」（数组下标即流式槽位，
   *   槽位矩形来自 beginDrag 捕获的静态网格几何）顶部居中的 60×60 图标区，与被拖浮动
   *   副本顶部居中的 60×60 图标区求重叠面积——压在谁身上就是谁，与指针命中无关，
   *   也不受挤位换位把目标推走的影响（追赶问题免疫）；
   * - 可合并组合：App→App（建夹）、App→文件夹（入夹）、文件夹→文件夹（并夹）；
   *   小组件不可合并、文件夹不能并入单个 App。
   */
  const mergeScan = (draggedId: string, d: { dx: number; dy: number }): { data: MergePreviewData; area: number } | null => {
    if (isWidgetKey(draggedId)) return null;
    const dv = dragVisualRef.current;
    if (!dv) return null;
    // 图标逻辑尺寸 60px 是壳本地 px；重叠比较在视口矩形（已缩放）上做 → 同比放大后口径一致
    const IS = ICON_SIZE * (scaleRef.current || 1);
    const dl = dv.x + d.dx + dv.w / 2 - IS / 2;
    const dt = dv.y + d.dy;
    const p = pageRef.current;
    const tiles = layoutRef.current.pages[p] ?? [];
    let best: { data: MergePreviewData; area: number } | null = null;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.kind !== 'app' && t.kind !== 'folder') continue;
      const key = tileKey(t);
      if (key === draggedId) continue;
      if (t.kind === 'app' && isFolderKey(draggedId)) continue;
      const g = dragGeo.current.find((gg) => gg.zone === 'grid' && gg.page === p && gg.index === i);
      if (!g) continue;
      const tl = g.left + g.w / 2 - IS / 2;
      const ix = Math.max(0, Math.min(dl + IS, tl + IS) - Math.max(dl, tl));
      const iy = Math.max(0, Math.min(dt + IS, g.top + IS) - Math.max(dt, g.top));
      const area = ix * iy;
      if (area <= (best?.area ?? 0)) continue;
      best = {
        area,
        data:
          t.kind === 'folder'
            ? { targetKey: key, kind: 'folder', folderId: t.id, targetPos: { page: p, index: i } }
            : { targetKey: key, kind: 'app', appId: t.id, targetPos: { page: p, index: i } },
      };
    }
    return best;
  };

  /** 松手快捷合并扫描：拖拽中挤位换位会让 beginDrag 捕获的静态槽位矩形过期，
   *  这里用松手瞬间的实时 tile 矩形重算——找与被拖图标重叠最大的可合并目标
   *  （App→App 建夹 / App→文件夹 入夹 / 文件夹→文件夹 并夹），重叠 ≥
   *  MERGE_DROP_RATIO × 图标面积才算「压在目标上」，否则返回 null 照常落位 */
  const mergeScanLive = (draggedId: string): MergePreviewData | null => {
    if (isWidgetKey(draggedId)) return null;
    const v = dragVisualRef.current;
    if (!v) return null;
    const sc = scaleRef.current || 1;
    const IS = ICON_SIZE * sc;
    const d = dragDeltaRef.current;
    const dl = v.x + d.dx + v.w / 2 - IS / 2;
    const dt = v.y + d.dy;
    const p = pageRef.current;
    const tiles = layoutRef.current.pages[p] ?? [];
    let best: { data: MergePreviewData; area: number } | null = null;
    const els = rootRef.current?.querySelectorAll<HTMLElement>('[data-tile][data-zone="grid"][data-page="' + p + '"]') ?? [];
    for (const t of Array.from(els)) {
      const key = t.dataset.id ?? '';
      if (!key || key === draggedId) continue;
      const idx = Number(t.dataset.index);
      if (!Number.isFinite(idx)) continue;
      const tile = tiles[idx];
      if (!tile || (tile.kind !== 'app' && tile.kind !== 'folder')) continue;
      if (tile.kind === 'app' && isFolderKey(draggedId)) continue; // 文件夹不能并入单个 App
      if (tile.kind === 'folder' && key !== folderKey(tile.id)) continue; // data-id 必须与 tile 对上
      const tr = t.getBoundingClientRect();
      const tl = tr.left + tr.width / 2 - IS / 2;
      const ix = Math.max(0, Math.min(dl + IS, tl + IS) - Math.max(dl, tl));
      const iy = Math.max(0, Math.min(dt + IS, tr.top + IS) - Math.max(dt, tr.top));
      const area = ix * iy;
      if (area <= (best?.area ?? 0)) continue;
      best = {
        area,
        data:
          tile.kind === 'folder'
            ? { targetKey: key, kind: 'folder', folderId: tile.id, targetPos: { page: p, index: idx } }
            : { targetKey: key, kind: 'app', appId: tile.id, targetPos: { page: p, index: idx } },
      };
    }
    if (!best || best.area < IS * IS * MERGE_DROP_RATIO) return null;
    return best.data;
  };

  /** 悬停合并落手：建夹（App→App）/ 入夹（App→文件夹）/ 并夹（文件夹→文件夹）。
   *  预览是纯视觉——此刻目标仍在原位、被拖项也未被消费，这里一次性完成：
   *  摘除被拖项（网格/Dock/来源文件夹——面板拖出时被拖项还在夹里），再按合并语义落子。
   *  返回合并后文件夹 tile 的 key（飞入动画落点/接住弹一下用；无合并语义时返回 null） */
  const applyMerge = (merge: MergePreviewData, draggedId: string): string | null => {
    const cur = layoutRef.current;
    const pages = cur.pages.map((p) => p.slice());
    const dock = cur.dock.slice();
    const folders = (cur.folders ?? []).map((f) => ({ ...f, apps: f.apps.slice() }));
    let dragPos: { page: number; index: number } | null = null;
    for (let p = 0; p < pages.length; p++) {
      const i = pages[p].findIndex((t) => tileKey(t) === draggedId);
      if (i >= 0) {
        pages[p].splice(i, 1);
        dragPos = { page: p, index: i };
        break;
      }
    }
    if (!dragPos) {
      const di = dock.indexOf(draggedId as AppId);
      if (di >= 0) dock.splice(di, 1);
    }
    if (!dragPos && !isFolderKey(draggedId)) {
      // 被拖 App 可能来自文件夹（面板拖出、悬停合并期间未经过挤位换位）
      for (const f of folders) {
        const ai = f.apps.indexOf(draggedId as AppId);
        if (ai >= 0) {
          f.apps.splice(ai, 1);
          break;
        }
      }
    }
    let resKey: string | null = null;
    if (merge.kind === 'app' && !isFolderKey(draggedId)) {
      // App→App：目标 App 原地变新文件夹（目标 App 在前、被拖 App 在后），默认名「文件夹」
      const fid = newFolderId();
      folders.push({ id: fid, name: '文件夹', apps: [merge.appId, draggedId as AppId] });
      const pg = Math.min(merge.targetPos.page, pages.length - 1);
      const ti = pages[pg].findIndex((t) => tileKey(t) === merge.targetKey);
      if (ti >= 0) pages[pg].splice(ti, 1);
      pages[pg].splice(Math.max(0, Math.min(pages[pg].length, ti >= 0 ? ti : merge.targetPos.index)), 0, { kind: 'folder', id: fid });
      resKey = folderKey(fid);
    } else if (merge.kind === 'folder') {
      const dst = folders.find((f) => f.id === merge.folderId);
      if (dst) {
        if (isFolderKey(draggedId)) {
          // 文件夹→文件夹：并入目标后自身消失（tile 已在上方被摘除）
          const src = folders.find((f) => folderKey(f.id) === draggedId);
          if (src && src.id !== dst.id) {
            for (const a of src.apps) if (!dst.apps.includes(a)) dst.apps.push(a);
            folders.splice(folders.indexOf(src), 1);
          }
        } else if (!dst.apps.includes(draggedId as AppId)) {
          dst.apps.push(draggedId as AppId);
        }
        resKey = folderKey(dst.id);
      }
    } else {
      // 防御兜底：无合并语义时被拖项原样放回目标位
      const pg = Math.min(merge.targetPos.page, pages.length - 1);
      pages[pg].splice(
        Math.max(0, Math.min(pages[pg].length, merge.targetPos.index)),
        0,
        isFolderKey(draggedId) ? { kind: 'folder', id: folderIdOfKey(draggedId) } : { kind: 'app', id: draggedId as AppId }
      );
    }
    const next = dissolveSmallFolders({ ...cur, pages, dock, folders });
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    try {
      navigator.vibrate?.(15);
    } catch {
      /* 震动不可用 */
    }
    return resKey;
  };

  /** 编辑模式 × 删除文件夹：夹内 App 全部退回主屏（从文件夹原位置起顺延；页满顺延到
   *  后面的页/新开页），文件夹消失 */
  const removeFolderReturnApps = (folderId: string) => {
    const cur = layoutRef.current;
    const folder = (cur.folders ?? []).find((f) => f.id === folderId);
    if (!folder) return;
    const pages = cur.pages.map((p) => p.slice());
    let pg = -1;
    let idx = -1;
    for (let p = 0; p < pages.length; p++) {
      const i = pages[p].findIndex((t) => t.kind === 'folder' && t.id === folderId);
      if (i >= 0) {
        pg = p;
        idx = i;
        break;
      }
    }
    if (idx >= 0) pages[pg].splice(idx, 1);
    const queue = [...folder.apps];
    let cur2 = pg;
    let at = Math.max(0, idx);
    const roomForNext = (pi: number): boolean =>
      queue.length > 0 && pageHasRoom(pages[pi], [{ kind: 'app', id: queue[0] as AppId }]);
    while (queue.length) {
      if (cur2 < 0 || cur2 >= pages.length) {
        for (let i = pages.length - 1; i >= 0; i--) {
          if (roomForNext(i)) {
            cur2 = i;
            break;
          }
        }
        if (cur2 < 0 || cur2 >= pages.length) {
          pages.push([]);
          cur2 = pages.length - 1;
        }
        at = pages[cur2].length;
      }
      while (roomForNext(cur2)) {
        pages[cur2].splice(Math.min(at, pages[cur2].length), 0, { kind: 'app', id: queue.shift() as AppId });
        at++;
      }
      if (!queue.length) break;
      let next2 = -1;
      for (let i = cur2 + 1; i < pages.length; i++) {
        if (roomForNext(i)) {
          next2 = i;
          break;
        }
      }
      if (next2 === -1) {
        pages.push([]);
        next2 = pages.length - 1;
      }
      cur2 = next2;
      at = pages[cur2].length;
    }
    const next: HomeLayout = { ...cur, pages, folders: (cur.folders ?? []).filter((f) => f.id !== folderId) };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 面板 × 移除（用户要求）：App 从文件夹移除并记入 hidden——直接从主界面消失，
   *  不再退回桌面（回主屏一律用长按拖出；App Store 可找回）；夹内剩 ≤1 个 App 时
   *  文件夹自动解体（剩余 App 原位变普通图标），面板随之关闭 */
  const removeAppFromFolder = (folderId: string, appId: AppId) => {
    const cur = layoutRef.current;
    if (!(cur.folders ?? []).some((f) => f.id === folderId && f.apps.includes(appId))) return;
    const pages = cur.pages.map((p) => p.slice());
    const folders = (cur.folders ?? []).map((f) => (f.id === folderId ? { ...f, apps: f.apps.filter((a) => a !== appId) } : { ...f, apps: f.apps.slice() }));
    const next = dissolveSmallFolders({ ...cur, pages, folders, hidden: Array.from(new Set([...cur.hidden, appId])) });
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    if (openFolderId === folderId && (next.folders ?? []).every((f) => f.id !== folderId)) setOpenFolderId(null);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 面板改名：更新文件夹名称并持久化（空名忽略） */
  const renameFolder = (folderId: string, name: string) => {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    const cur = layoutRef.current;
    if (!(cur.folders ?? []).some((f) => f.id === folderId)) return;
    const next: HomeLayout = { ...cur, folders: (cur.folders ?? []).map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)) };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
  };
  const restoreDefault = () => {
    const def = defaultLayout();
    layoutRef.current = def;
    setLayout(def);
    persist(def);
    pageRef.current = 0;
    setPage(0);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 编辑模式：末尾追加一页空白页并跳过去（页数无上限；拖拽贴右缘建页用） */
  const addPage = () => {
    const cur = layoutRef.current;
    const next: HomeLayout = { ...cur, pages: [...cur.pages.map((p) => p.slice()), []] };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    pageRef.current = next.pages.length - 1;
    setPage(next.pages.length - 1);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* 震动不可用 */
    }
  };

  /** 编辑模式「+」画廊：把全部 9 种小组件添加回主屏（× 删除后在此找回；已在屏上则忽略）。
   *  落点 = 当前编辑页起第一张装得下的页（格数按 14、行数按 6 行封顶——小组件按跨行占位
   *  校验，装不下会顺延到后面的页/新建页接住） */
  const addWidgetFromGallery = (kind: WidgetKind) => {
    const cur = layoutRef.current;
    if (cur.pages.some((p) => p.some((t) => t.kind === 'widget' && t.widget === kind))) return;
    const pages = cur.pages.map((p) => p.slice());
    let target = -1;
    const start = Math.min(pageRef.current, pages.length - 1);
    for (let off = 0; off < pages.length; off++) {
      const pi = (start + off) % pages.length;
      if (pageHasRoom(pages[pi], [{ kind: 'widget', widget: kind }], true)) {
        target = pi;
        break;
      }
    }
    if (target === -1) {
      pages.push([]);
      target = pages.length - 1;
    }
    pages[target].push({ kind: 'widget', widget: kind });
    const next: HomeLayout = { ...cur, pages, hidden: cur.hidden.filter((h) => h !== widgetKey(kind)) };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    if (pageRef.current !== target) {
      pageRef.current = target;
      setPage(target);
    }
    try {
      navigator.vibrate?.(10);
    } catch {
      /* 震动不可用 */
    }
  };
  /** 退出编辑模式：顺带回收空白页（拖拽建页的副产品），并夹回当前页（顺带关掉 + 画廊） */
  /** 进编辑模式前压平布局：清掉历史拖拽垫入的隐形空占位格（洞不可见却占格，
   *  会挡住后续把 App 放到洞位——「App 放小组件边上放不了」的元凶），顺带回收空页。
   *  布局无变化时不落盘（避免无谓写入） */
  const compactPages = () => {
    const cur = layoutRef.current;
    if (!cur.pages.some((p) => p.length === 0 || p.some((t) => t.kind === 'empty'))) return;
    const pages = cur.pages.map((p) => p.filter((t) => t.kind !== 'empty')).filter((p) => p.length > 0);
    if (pages.length === 0) pages.push([]);
    const next: HomeLayout = { ...cur, pages };
    layoutRef.current = next;
    setLayout(next);
    persist(next);
    const last = Math.max(0, pages.length - 1);
    if (pageRef.current > last) {
      pageRef.current = last;
      setPage(last);
    }
  };

  const exitEdit = () => {
    setEdit(false);
    setGalleryOpen(false);
    const cur = layoutRef.current;
    const pages = cur.pages.filter((p) => p.length > 0);
    if (pages.length === 0) pages.push([]);
    if (pages.length !== cur.pages.length) {
      const next: HomeLayout = { ...cur, pages };
      layoutRef.current = next;
      setLayout(next);
      persist(next);
    }
    const last = Math.max(0, pages.length - 1);
    if (pageRef.current > last) {
      pageRef.current = last;
      setPage(last);
    }
  };

  /** 打开 App（顺带退出编辑模式，并清掉可能残留的长按计时器） */
  const openWith = (id: AppId) => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
    clearBlankPress();
    exitEdit();
    openApp(id);
  };

  const zoneIndexOf = (id: string): Hit | null => {
    const { pages, dock } = layoutRef.current;
    for (let p = 0; p < pages.length; p++) {
      const i = pages[p].findIndex((t) => tileKey(t) === id);
      if (i >= 0) return { zone: 'grid', page: p, index: i };
    }
    const di = dock.indexOf(id as AppId);
    if (di >= 0) return { zone: 'dock', index: di };
    if (!isWidgetKey(id) && !isFolderKey(id)) {
      // App 可能在文件夹里（面板拖拽源）
      for (const f of layoutRef.current.folders ?? []) {
        const ai = f.apps.indexOf(id as AppId);
        if (ai >= 0) return { zone: 'folder', folderId: f.id, index: ai };
      }
    }
    return null;
  };

  /** 命中检测（静态网格几何版）：返回指针所指的落位。
   *  用拖拽开始时捕获的格子矩形/行列线判定，与动画/渲染状态完全无关：
   *  ① Dock：指针在 Dock 条内（App）→ 按指针 x 与各图标中心线推导插入下标——
   *     压在图标上=以其中心为界插到前/后，压在空位=按中心线计数；整条 Dock 是
   *     连续插入轨道，不再要求「先与某个 Dock App 换位」；
   *  ② 矩形命中：指针落在某网格槽位矩形（外扩 HIT_PAD_PX）内 → 插入到该槽位
   *     （插入语义：被拖项落在此格，其余项顺移让位；被拖项自己当前格 → hit === cur，
   *     reorder 自然跳过）；
   *  ③ 空白位兜底：未命中任何槽位且指针在主屏内 → 按静态槽位几何拟合「行列线」
   *     （列 = App 槽宽 + 列间隙；行 = 槽位 top 按行距聚类），把指针换算成目标格
   *     （行,列），再在「当前布局 − 被拖项 − 本次预览垫格」上模拟 flow：插入点 =
   *     第一个 flow 起点 ≥ 目标格的 tile 之前，不足目标行/列则垫空占位格（受页容量
   *     约束）——指针压哪格 App 就落哪格，目标旁边有没有 App 都能直接放入
   *     （用户实测：目标旁有 App 只能换位、没 App 就放不进去）。
   *  跨页只走边缘滞留翻页：非当前页槽位一律不参与命中——邻页槽位平移后紧贴视口
   *  左右缘，贴边放置时会抓到邻页槽位，把 App 弹回另一页
   *  （用户实测：第二页 App 拖到第一页右缘，松手又回到第二页）。 */
  const hitTestAt = (x: number, y: number): Hit | null => {
    const W = dragPageW.current;
    const dragId0 = dragMeta.current?.id;
    // ① Dock 连续插入轨道：指针在 Dock 条内（略上探 24px 兼容从网格拖入的过渡区）且
    //    被拖项是 App → 插入下标 = 中心线在指针左侧的（非被拖项）图标数。
    //    下标基于「去掉被拖项后的序列」，停在自己当前位置时自然得到原位（防抖动）。
    const dockRect = dragDockRect.current;
    if (
      dockRect &&
      dragId0 !== undefined &&
      !isWidgetKey(dragId0) &&
      !isFolderKey(dragId0) &&
      x >= dockRect.left - 8 &&
      x <= dockRect.right + 8 &&
      y >= dockRect.top - 24 &&
      y <= dockRect.bottom
    ) {
      const dockSlots = dragGeo.current
        .filter((g) => g.zone === 'dock' && g.id !== dragId0)
        .sort((a, b) => a.index - b.index);
      let idx = 0;
      for (const s of dockSlots) {
        if (s.left + s.w / 2 < x) idx++;
      }
      const cur = zoneIndexOf(dragId0);
      if (cur && cur.zone === 'dock' && cur.index === idx) return cur;
      // 满员 Dock 末端：从网格来的 App 插到 capacity 位置会在 reorder 里挤出自己
      // （追加了又 pop 回去 = 原地不动，用户实测「App 移到下面移不进 Dock」）——
      // 这里把插入下标夹到 capacity-1，改为挤走最后一个 Dock 图标回网格
      if (cur && cur.zone !== 'dock') idx = Math.min(idx, DOCK_CAPACITY - 1);
      return { zone: 'dock', index: idx };
    }
    // ② 矩形命中（网格槽位；Dock 图标矩形仅用于小组件——App 已走上面的轨道）
    let best: Hit | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const g of dragGeo.current) {
      if (g.zone === 'grid' && g.page !== pageRef.current) continue;
      const gx = g.zone === 'grid' ? g.left + (g.page - pageRef.current) * W : g.left;
      const pad = g.zone === 'dock' ? DOCK_HIT_PAD_PX : HIT_PAD_PX;
      if (x < gx - pad || x > gx + g.w + pad || y < g.top - pad || y > g.top + g.h + pad) continue;
      const ddx = gx + g.w / 2 - x;
      const ddy = g.top + g.h / 2 - y;
      const d = ddx * ddx + ddy * ddy;
      if (d < bestDist) {
        bestDist = d;
        // overId = 矩形命中所指的原槽位 tile 键（悬停建夹/入夹判定用；空白兜底 ③ 无此字段）
        best = g.zone === 'grid' ? { zone: 'grid', page: g.page, index: g.index, overId: g.id } : { zone: 'dock', index: g.index };
      }
    }
    if (best) return best;
    // ③ 空白位兜底（行+列双定位）。
    //  槽位矩形是视口 px（已随壳缩放），行/列几何常量是壳本地 px → 同比放大后口径一致
    const rect = dragRootRect.current;
    if (rect && x > rect.left && x < rect.right && y > rect.top && y < rect.bottom) {
      const sc = scaleRef.current || 1;
      const GAPX = GRID_GAP_X * sc;
      const GAPY = GRID_GAP_Y * sc;
      const p = Math.min(pageRef.current, layoutRef.current.pages.length - 1);
      const cur = dragId0 !== undefined ? zoneIndexOf(dragId0) : null;
      const isW = dragId0 !== undefined && isWidgetKey(dragId0);
      const slots = dragGeo.current.filter((g) => g.zone === 'grid' && g.page === p);
      if (slots.length === 0) {
        // 空页：直接放到页首
        if (cur && cur.zone === 'grid' && cur.page === p && cur.index === 0) return cur;
        return { zone: 'grid', page: p, index: 0 };
      }
      // 列线：优先 App 槽宽；无 App 槽的页用小组件槽宽反推单列宽
      const appSlot = slots.find((s) => s.kind === 'app');
      const refSlot = appSlot ?? slots[0];
      const refSpanC = refSlot.kind === 'widget' ? WIDGET_SPAN_SIZE[widgetOfKey(refSlot.id)].c : 1;
      const colW = (refSlot.w - (refSpanC - 1) * GAPX) / refSpanC;
      const minLeft = Math.min(...slots.map((s) => s.left));
      const targetCol = Math.max(0, Math.min(3, Math.round((x - colW / 2 - minLeft) / (colW + GAPX))));
      // 行线：槽位 top 聚类（相邻 >12px 视为新行）；行距 = App 槽高 + 行间隙
      //（无 App 槽时从通栏/方格小组件槽高反推；self-center 的方格小组件高度不含行间隙，跳过）
      const sortedTops = slots.map((s) => s.top).sort((a, b) => a - b);
      const rowTops: number[] = [];
      for (const t of sortedTops) {
        if (rowTops.length === 0 || t - rowTops[rowTops.length - 1] > 12 * sc) rowTops.push(t);
      }
      const pitchSrc = appSlot ?? slots.find((s) => !(s.kind === 'widget' && ['weather', 'bubble'].includes(widgetOfKey(s.id)))) ?? slots[0];
      const pitchSrcR = pitchSrc.kind === 'widget' ? WIDGET_SPAN_SIZE[widgetOfKey(pitchSrc.id)].r : 1;
      const pitch = pitchSrc.h / pitchSrcR + GAPY;
      const top0 = rowTops[0];
      // 行边界取行间隙中点：round(f - 0.41)（行高 ≈76、行距 ≈92 → 间隙中点在 0.913 行距处）
      const gridRow = Math.max(0, Math.round((y - top0) / pitch - 0.41));
      // 在「当前布局 − 被拖项 − 全部空占位格」上模拟 flow（紧凑序列，整个拖拽中恒定，
      // 判定结果与预览状态无关、停同一指针位置恒得同一落点）。历史垫格（隐形洞）不参与：
      // 否则多轮预览的洞会逐点累积污染落点，把 App 推到洞后的错位格
      const pageTiles = layoutRef.current.pages[p] ?? [];
      const sim = pageTiles.filter((t) => {
        if (dragId0 !== undefined && tileKey(t) === dragId0) return false;
        return t.kind !== 'empty';
      });
      const { starts, after, end } = flowPositions(sim);
      // 目标行夹到 flow 末行与 GRID_ROW_CAP（矮视口实测收敛，默认 6）之内：内容下方空白不
      // 新开行，落到 flow 末行并按列定位；主屏不可滚动，落点行不得使总行数超上限
      // （超出会被 reorder 整体弹回；夹到可视行内——矮视口下第 5/6 行在屏幕外，落进去=「移到底部消失」）
      const targetRow = Math.min(gridRow, end.r, GRID_ROW_CAP - 1);
      // 插入点：第一个 flow 起点 ≥ 目标格（行主序）的 tile 之前；没有则页尾
      let idx = sim.length;
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        if (s.r > targetRow || (s.r === targetRow && s.c >= targetCol)) {
          idx = i;
          break;
        }
      }
      // 垫格：从插入点游标推进到目标格（跨行时垫完整空行）
      const cb = idx === 0 ? { r: 0, c: 0 } : after[idx - 1];
      let padEmpty = 0;
      if (cb.r < targetRow) padEmpty = 4 - cb.c + (targetRow - cb.r - 1) * 4 + targetCol;
      else if (cb.r === targetRow && cb.c < targetCol) padEmpty = targetCol - cb.c;
      // 页容量约束：sim 项 + 垫格 + 被拖项 ≤ 页容量
      padEmpty = Math.max(0, Math.min(padEmpty, pageCap(pageTiles, isW) - sim.length - 1, 8));
      // 被拖项本来就停在该插入位置 → 返回其当前位置，避免无意义的换位抖动
      if (padEmpty === 0 && cur && cur.zone === 'grid' && cur.page === p && cur.index === idx) return cur;
      return { zone: 'grid', page: p, index: idx, padEmpty };
    }
    return null;
  };

  /** 拖拽预览专用 reorder：先把各页的空占位格全部压平（历史垫格洞是隐形占位，
   *  留在序列里会污染后续 hitTest 的 flow 模拟，洞后 App 错位、洞位永久放不进东西；
   *  洞只在松手落定位存在，下次拖拽预览开始时自动吸收归位）再按命中换位；
   *  顺带解体只剩 ≤1 个 App 的文件夹（拖出后夹内剩余 App 原位落回桌面）。
   *  垫格按 hit.padEmpty 重新垫（reorder 内部），与 hitTest 的紧凑 flow 模拟保持同构 */
  const reorderForDrag = (id: string, hit: Hit) => {
    const cur = layoutRef.current;
    const pages = cur.pages.map((p) => p.filter((t) => t.kind !== 'empty'));
    const next = dissolveSmallFolders(reorder({ ...cur, pages }, id, hit));
    layoutRef.current = next;
    return next;
  };

  /** 拖拽中贴近屏幕左右边缘 → 停留 EDGE_FLIP_MS 后自动翻页（手指仍停在边缘则原地重新计时，
   *  可连续翻，跨页拖拽用）；已在最后一页仍贴住右缘 → 新建一页接住被拖 App
   *  （添加界面的方式，每次拖拽限建一页防止连建） */
  const updateEdgeFlip = (cx: number) => {
    edgePointer.current = { x: cx };
    const rect = dragRootRect.current;
    const ez = EDGE_ZONE_PX * (scaleRef.current || 1);
    let dir: -1 | 0 | 1 = 0;
    if (rect) {
      if (cx - rect.left < ez) dir = -1;
      else if (rect.right - cx < ez) dir = 1;
    }
    if (dir !== edgeFlip.current) {
      edgeFlip.current = dir;
      if (flipTimer.current !== null) {
        window.clearTimeout(flipTimer.current);
        flipTimer.current = null;
      }
      if (dir !== 0) {
        flipTimer.current = window.setTimeout(() => {
          flipTimer.current = null;
          const d = edgeFlip.current;
          edgeFlip.current = 0;
          const from = pageRef.current;
          const last = Math.max(0, layoutRef.current.pages.length - 1);
          if (d === 1 && from === last) {
            if (!pageCreated.current) {
              pageCreated.current = true;
              addPage();
            }
          } else {
            flipTo(from + d);
          }
          if (pageRef.current !== from) {
            try {
              navigator.vibrate?.(8);
            } catch {
              /* 震动不可用 */
            }
            showDots();
            // 翻页后把被拖项主动带到新当前页末尾（手指静止时没有 move 事件，
            // 不主动搬的话松手后 App 会留在原页）
            moveDraggedToPageEnd();
            // 手指仍停在边缘 → 原地重新计时，可连续翻页
            const p = edgePointer.current;
            if (p) updateEdgeFlip(p.x);
          }
        }, EDGE_FLIP_MS);
      }
    }
  };

  /** 翻页后把被拖项搬到新当前页末尾（页满/6 行装不下时不搬，保留在原页） */
  const moveDraggedToPageEnd = () => {
    const m = dragMeta.current;
    if (!m) return;
    const p = Math.min(pageRef.current, layoutRef.current.pages.length - 1);
    const tiles = layoutRef.current.pages[p] ?? [];
    const isWidget = isWidgetKey(m.id);
    const tile: Tile = isWidget
      ? { kind: 'widget', widget: widgetOfKey(m.id) }
      : isFolderKey(m.id)
        ? { kind: 'folder', id: folderIdOfKey(m.id) }
        : { kind: 'app', id: m.id as AppId };
    if (!pageHasRoom(tiles, [tile], isWidget)) return;
    const cur = zoneIndexOf(m.id);
    if (cur && cur.zone === 'grid' && cur.page === p && cur.index === tiles.length - 1) return;
    setLayout(reorderForDrag(m.id, { zone: 'grid', page: p, index: tiles.length }));
  };

  const clearFlipTimer = () => {
    if (flipTimer.current !== null) {
      window.clearTimeout(flipTimer.current);
      flipTimer.current = null;
    }
    edgeFlip.current = 0;
  };

  const beginDrag = (id: string, x: number, y: number) => {
    if (dragMeta.current) {
      // 保险丝：上一轮拖拽未正常收尾（丢 pointerup/异常残留）→ 先静默复位，
      // 防止两轮拖拽状态叠加（浮动副本冻结在半空、命中错乱）
      dragMeta.current = null;
      dragVisualRef.current = null;
      mergeRef.current = null;
      setDragId(null);
      setDragVisual(null);
      setMergePreview(null);
    }
    const loc = zoneIndexOf(id);
    if (!loc) return;
    // 面板拖拽源（App 在文件夹里）不在 tileEls 里：从面板 cell 的 data-fdrag 兑底取元素
    const el = tileEls.current.get(id) ?? rootRef.current?.querySelector<HTMLElement>(`[data-fdrag="${id}"]`) ?? null;
    if (!el) return;
    // 先结束上一轮落位/FLIP 残留动画，保证 rect/几何采样干净
    finishTileAnimations();
    const r = el.getBoundingClientRect();
    // 捕获本轮拖拽用的壳缩放系数（壳本地坐标换算基准，见 floatingCopy/flyIn/FLIP）
    scaleRef.current = shellScale.value || 1;
    rectsRef.current = captureRects();
    dragRootRect.current = rootRef.current?.getBoundingClientRect() ?? null;
    dragPageW.current = trackRef.current?.getBoundingClientRect().width || dragRootRect.current?.width || 0;
    dragDockRect.current = rootRef.current?.querySelector<HTMLElement>('[data-dock]')?.getBoundingClientRect() ?? null;
    // 捕获静态网格几何（此时 DOM 尚无占位槽/浮动副本，矩形即真实槽位位置；页号随槽位记录）
    const geo: typeof dragGeo.current = [];
    rootRef.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((t) => {
      const z = t.dataset.zone as Zone | undefined;
      const i = Number(t.dataset.index);
      if ((z !== 'grid' && z !== 'dock') || !Number.isFinite(i)) return;
      const tr = t.getBoundingClientRect();
      geo.push({
        id: t.dataset.id ?? '',
        zone: z,
        page: z === 'grid' ? Number(t.dataset.page ?? 0) : 0,
        index: i,
        kind: t.dataset.id !== undefined && isWidgetKey(t.dataset.id) ? 'widget' : 'app',
        left: tr.left,
        top: tr.top,
        w: tr.width,
        h: tr.height,
      });
    });
    dragGeo.current = geo;
    const visual = { x: r.left, y: r.top, w: r.width, h: r.height };
    dragVisualRef.current = visual;
    dragDeltaRef.current = { dx: 0, dy: 0 };
    setDragVisual(visual);
    setDragDelta({ dx: 0, dy: 0 });
    dragMeta.current = { id, startX: x, startY: y };
    pageCreated.current = false;
    lastDragHit.current = null;
    // 拖拽总是从干净状态开始（清掉上一轮合并预览/静止压住计时残留）
    mergeRef.current = null;
    setMergePreview(null);
    clearMergeDwell();
    dragOrigin.current = { hit: loc, layout: structuredClone(layoutRef.current) };
    setDragId(id);
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 震动不可用 */
    }
  };

  const endDrag = (e?: PointerEvent) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    clearFlipTimer();
    clearMergeDwell();
    lastDragHit.current = null;
    if (!dragMeta.current) {
      // 无拖拽元数据（重复收尾/异常后残留调用）：直接返回，只清矩形缓存
      dragDockRect.current = null;
      return;
    }
    try {
      const m = dragMeta.current;
      // 松手瞬间的真实位移：最后几个 pointermove 可能被 rAF 帧节流丢弃（快速拖动时
      // dragDeltaRef 滞后一帧甚至几帧）——以指针终点为准同步，快捷合并的重叠扫描、
      // 飞入动画起点、落位动画起点才准确
      if (e) {
        dragDeltaRef.current = { dx: e.clientX - m.startX, dy: e.clientY - m.startY };
      }
      // 注意：dragMeta.current 此处不能提前清空——下方松手落位的 hitTestAt 依赖它
      // （Dock 连续轨道分支与空白兑底的 dragId0 都从 dragMeta 读；提前清空会让拖到
      //   Dock 条上松手时命中永远失配、App 被弹回网格——用户实测「移到下面移不进」），
      //   统一挪到函数末尾清理
      // 拖回原位松手 → 整布局复原（撤销拖拽过程中的一切中间换位）。
      // 命中判定用「最近 tile 兜底」，落在格子间隙也能正确还原。
      const dwellMerge = mergeRef.current;
      mergeRef.current = null;
      let merged = false;
      /** 合并落手（悬停预览后松手 / 快捷压上松手共用）：建夹/入夹/并夹 +
       *  入夹飞入动画 + 文件夹接住弹一下（被拖项已被合并消费，不做落位动画） */
      const runMerge = (mg: MergePreviewData) => {
        setMergePreview(null);
        merged = true;
        // 目标 tile 的实时矩形（预览期已静止 / 松手瞬间 FLIP 必已结束 → 即最终落点）
        const tEl = rootRef.current?.querySelector<HTMLElement>(`[data-tile][data-zone="grid"][data-id="${mg.targetKey}"]`);
        const tRect = tEl?.getBoundingClientRect() ?? null;
        const resKey = applyMerge(mg, m.id);
        const v = dragVisualRef.current;
        if (v && !isFolderKey(m.id) && tRect) {
          // 入夹飞入动画（iOS 同款）：App 图标从松手位置缩小飞进文件夹。
          // flyIn 层是 fixed（壳 transform 下用壳本地坐标渲染）→ 视口坐标先换算成本地
          const rr = dragRootRect.current;
          const sc = scaleRef.current || 1;
          const ox = rr?.left ?? 0;
          const oy = rr?.top ?? 0;
          setFlyIn({
            appId: m.id as AppId,
            fx: (v.x + dragDeltaRef.current.dx + (v.w - ICON_SIZE) / 2 - ox) / sc,
            fy: (v.y + dragDeltaRef.current.dy - oy) / sc,
            tx: (tRect.left + tRect.width / 2 - ICON_SIZE / 2 - ox) / sc,
            ty: (tRect.top - oy) / sc,
          });
        }
        if (resKey) {
          // 文件夹接住 App 后弹一下（回弹曲线）
          requestAnimationFrame(() => {
            tileEls.current.get(resKey)?.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], {
              duration: 300,
              easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            });
          });
        }
      };
      if (dwellMerge && e) {
        // 悬停合并落手：预览已弹，松手直接建夹/入夹/并夹
        runMerge(dwellMerge);
      } else if (e) {
        const origin = dragOrigin.current;
        const moved = Math.hypot(e.clientX - m.startX, e.clientY - m.startY);
        if (origin && moved < 12 && isFolderKey(m.id)) {
          // 编辑模式轻点文件夹（位移 < 12px，容纳触摸轻点抖动）= 复原布局并打开面板
          layoutRef.current = origin.layout;
          setLayout(origin.layout);
          setOpenFolderId(folderIdOfKey(m.id));
        } else if (origin) {
          if (moved < 6) {
            // 轻点 App/小组件：防手抖误换位，复原即可
            layoutRef.current = origin.layout;
            setLayout(origin.layout);
          } else {
            // 快捷合并（用户反馈合成文件夹太难）：不必等悬停预览——松手时被拖图标
            // 压在可合并目标上（重叠 ≥ MERGE_DROP_RATIO）直接建夹/入夹/并夹；
            // 轻放/擦过（重叠小）照常落位换位，不会误合
            const hit = hitTestAt(e.clientX, e.clientY);
            const dropMerge = hit && hit.zone === 'grid' ? mergeScanLive(m.id) : null;
            if (dropMerge) {
              runMerge(dropMerge);
            } else {
              const cur = zoneIndexOf(m.id);
              if (sameHit(hit, origin.hit)) {
                layoutRef.current = origin.layout;
                setLayout(origin.layout);
              } else if (!hit && origin.hit.zone === 'folder') {
                // 从文件夹拖出的 App 没找到落点 → 退回文件夹
                layoutRef.current = origin.layout;
                setLayout(origin.layout);
              } else if (hit && (!cur || !sameHit(cur, hit))) {
                // 悬停/压住期间挤位被冻结（重叠在目标上）——松手按当前指针位置
                // 补一次落位，避免 App 落在悬停前的旧位置
                const next = reorderForDrag(m.id, hit);
                layoutRef.current = next;
                setLayout(next);
              }
            }
          }
        }
      }
      const v = dragVisualRef.current;
      if (v && !merged) {
        // 记录浮动副本最后视觉位置，落位动画从这里滑回网格槽位
        pendingSettle.current = { id: m.id, x: v.x + dragDeltaRef.current.dx, y: v.y + dragDeltaRef.current.dy };
      }
    } finally {
      // 保险丝：无论上方是否抛异常，拖拽状态必须完全复位——否则浮动副本会永久冻结在
      // 半空（App「卡」在屏幕任意位置动不了），后续拖拽也全部失灵（用户实测截图元凶）
      setDragId(null);
      setDragVisual(null);
      setMergePreview(null);
      setDragDelta({ dx: 0, dy: 0 });
      dragDeltaRef.current = { dx: 0, dy: 0 };
      dragVisualRef.current = null;
      mergeRef.current = null;
      persist(layoutRef.current);
      // 吞掉拖拽结束后的 click，避免误触打开 App
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 400);
      dragMeta.current = null;
      // Dock 矩形在命中检测（含松手落位）全部结束后再清——之前在 endDrag 开头就清空，
      // 导致松手时 hitTestAt 的 Dock 分支永远失配、拖到 Dock 条上松手被弹回网格
      dragDockRect.current = null;
      if (pressTimer.current !== null) {
        window.clearTimeout(pressTimer.current);
        pressTimer.current = null;
      }
      pressStart.current = null;
    }
  };

  // 拖拽中：窗口级指针监听（跟随 + 边缘翻页 + 命中检测 + 实时换位）
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const m = dragMeta.current;
      if (!m) return;
      if (frame.current !== null) return;
      const cx = e.clientX;
      const cy = e.clientY;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (!dragMeta.current) return;
        const d = { dx: cx - m.startX, dy: cy - m.startY };
        dragDeltaRef.current = d;
        setDragDelta(d);
        // 合并检测（iOS 同款「压住出预览」）——只有「指针压在重叠目标的槽位内」才暂停换位：
        // - 指针压在可合并目标（App/文件夹）槽位内且有重叠 → 暂停挤位换位（目标不挪窝，
        //   才能稳定悬停），静止 MERGE_DWELL_MS 后弹合并预览，松手入夹；直接松手 = 落到
        //   该格正常换位；
        // - 拖到目标的下方/旁边/穿过/进 Dock（指针不在目标槽位内）→ 换位照常，绝不卡住
        //   （旧版任意重叠就全局冻结换位，密集网格里拖到哪都被卡死，既到不了底部也没法
        //   换位——用户实测已修）；
        // - 预览已弹时拖出目标槽位 → 取消预览并恢复换位。
        const scan = mergeScan(m.id, d);
        const hit = hitTestAt(cx, cy);
        if (scan && scan.area > 0 && hit && hit.zone === 'grid' && hit.overId === scan.data.targetKey) {
          // 悬停入夹手势：指针压在重叠的可合并目标槽位内
          clearFlipTimer();
          lastDragHit.current = null;
          if (mergeRef.current) {
            // 预览已弹：压住对象换成另一个 → 预览切过去；仍是原目标 → 保持
            if (scan.data.targetKey !== mergeRef.current.targetKey) showMergePreview(scan.data);
            return;
          }
          // 未弹预览：静止压住 ~180ms 后弹出（大幅移动重置计时，轻微手抖≤10px 不重置）
          const prev = mergeDwellPos.current;
          if (mergeDwellT.current === null || !prev || Math.hypot(cx - prev.x, cy - prev.y) > 10) {
            clearMergeDwell();
            mergeDwellPos.current = { x: cx, y: cy };
            mergeDwellT.current = window.setTimeout(() => {
              mergeDwellT.current = null;
              mergeDwellPos.current = null;
              const m2 = dragMeta.current;
              if (!m2) return;
              const s2 = mergeScan(m2.id, dragDeltaRef.current);
              if (s2 && s2.area > 0) showMergePreview(s2.data);
            }, MERGE_DWELL_MS);
          }
          return;
        }
        // 其余一切情况（未重叠/轻微擦过/压着但指针不在目标槽位/拖到目标下方或 Dock）：
        // 挤位换位照常——App 拖到下面/旁边/底部都能顺畅移过去、随时可与其他 App 换位
        if (mergeRef.current) clearMergePreview();
        clearMergeDwell();
        updateEdgeFlip(cx);
        if (!hit) {
          lastDragHit.current = null;
          return;
        }
        if (sameHit(lastDragHit.current, hit)) return;
        lastDragHit.current = hit;
        const cur = zoneIndexOf(m.id);
        if (!cur || sameHit(cur, hit)) return;
        // rectsRef 保持着上一轮提交后的自然位置（FLIP effect 采样前已结束动画），
        // 这里不再重新采样——动画中态采样会污染 FLIP 起点
        setLayout(reorderForDrag(m.id, hit));
      });
    };
    const onUp = (e: PointerEvent) => endDrag(e);
    // 窗口失焦（切标签页/弹窗抢焦点）时强制收尾，防止拖拽状态悬挂
    const onBlur = () => endDrag();

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      clearFlipTimer();
      clearMergeDwell();
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [dragging]);

  // FLIP：布局提交后，让位项从旧位置平滑滑到新位置（被拖项是 fixed 副本，不参与）。
  // 位移采样自视口矩形；tile 动画在壳本地坐标系（壳可能被等比缩小）→ ÷ 缩放换算
  useLayoutEffect(() => {
    if (!dragging) return;
    // 先结束上一轮 FLIP（若仍在进行）：其 transform 会污染 fresh 采样
    finishTileAnimations();
    const fresh = captureRects();
    const sc = scaleRef.current || 1;
    rectsRef.current.forEach((old, id) => {
      const now = fresh.get(id);
      if (!now) return;
      const dx = (old.left - now.left) / sc;
      const dy = (old.top - now.top) / sc;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      tileEls.current.get(id)?.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
        { duration: 230, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    });
    rectsRef.current = fresh;
  }, [layout, dragging]);

  // 落位动画：松手后浮动副本从最后视觉位置滑回网格槽位
  useLayoutEffect(() => {
    if (dragging) return;
    const s = pendingSettle.current;
    pendingSettle.current = null;
    if (!s) return;
    const el = tileEls.current.get(s.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sc = scaleRef.current || 1;
    el.animate(
      [
        { transform: `translate(${(s.x - r.left) / sc}px, ${(s.y - r.top) / sc}px) scale(1.06)` },
        { transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration: 270, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    );
  }, [dragging]);

  // 入夹飞入动画：合并落手后，App 图标从松手位置缩小飞进目标文件夹（360ms iOS 曲线）
  useLayoutEffect(() => {
    if (!flyIn) return;
    const el = flyInEl.current;
    if (!el) return;
    el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        { transform: `translate(${flyIn.tx - flyIn.fx}px, ${flyIn.ty - flyIn.fy}px) scale(0.4)`, opacity: 0 },
      ],
      { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }
    );
  }, [flyIn]);
  useEffect(() => {
    if (!flyIn) return;
    const t = window.setTimeout(() => setFlyIn(null), 380);
    return () => window.clearTimeout(t);
  }, [flyIn]);

  // ---------------- 单元格手势 ----------------
  const cellPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (edit) {
      e.preventDefault();
      beginDrag(id, e.clientX, e.clientY);
      return;
    }
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressStart.current = null;
      suppressClick.current = true;
      compactPages();
      setEdit(true);
      beginDrag(id, e.clientX, e.clientY);
    }, LONG_PRESS_MS);
  };

  const cellPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (pressTimer.current === null || !pressStart.current) return;
    const dx = e.clientX - pressStart.current.x;
    const dy = e.clientY - pressStart.current.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      pressStart.current = null;
    }
  };

  const cellPointerUp = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const swallowClick = (e: React.MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  // ---------------- 空白处手势：非编辑长按进入，编辑中点按退出；轻扫翻页 ----------------
  const blankTimer = useRef<number | null>(null);
  const blankStart = useRef<{ x: number; y: number } | null>(null);
  const blankDownAt = useRef(0);

  const clearBlankPress = () => {
    if (blankTimer.current !== null) {
      window.clearTimeout(blankTimer.current);
      blankTimer.current = null;
    }
    blankStart.current = null;
  };

  /** 空白处（非图标/小组件/按钮）按下：
   *  - 未编辑：按住 420ms → 进入编辑模式；
   *  - 编辑中：快速点按（≤350ms 且未移动）→ 退出编辑模式（用户要求点击空白取消编辑）；
   *  - 轻扫翻页：非编辑模式任意位置起手；编辑模式仅空白处起手（图标上起手 = 拖拽换位），
   *    保证编辑模式下也能左右滑动切换页面 */
  const rootPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (spotlight || dragging) return;
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('input')) return;
    const onTile = !!t.closest('[data-tile]');
    if (!dragging && !spotlight && (!edit || !onTile)) {
      swipe.current = {
        startX: swipeX(e),
        startY: swipeY(e),
        claimed: false,
        dead: false,
        moved: false,
        lastX: swipeX(e),
        lastT: performance.now(),
        v: 0,
        w: 0,
      };
    }
    if (onTile) return;
    blankStart.current = { x: e.clientX, y: e.clientY };
    blankDownAt.current = performance.now();
    if (edit) return;
    blankTimer.current = window.setTimeout(() => {
      blankTimer.current = null;
      blankStart.current = null;
      compactPages();
      setEdit(true);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
    }, LONG_PRESS_MS);
  };

  const rootPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // 轻扫 → 跟手翻页（编辑模式从空白处起手同样生效；手指带页走，松手按位移/甩速吸附）
    const s = swipe.current;
    if (s && !dragging && !spotlight) {
      const px = swipeX(e);
      const dx = px - s.startX;
      const dy = swipeY(e) - s.startY;
      if (!s.claimed && !s.dead && Math.hypot(dx, dy) > SWIPE_CLAIM_PX) {
        if (Math.abs(dx) > Math.abs(dy)) claimSwipe();
        else s.dead = true;
      }
      if (s.claimed) {
        const now = performance.now();
        const dt = now - s.lastT;
        if (dt > 0) {
          s.v = 0.8 * s.v + (0.2 * (px - s.lastX)) / dt;
          s.lastX = px;
          s.lastT = now;
        }
        if (frame.current === null) {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const cur = swipe.current;
            if (cur?.claimed) setTrackFollow(cur.lastX - cur.startX);
          });
        }
        return;
      }
    }
    if (blankTimer.current === null || !blankStart.current) return;
    const dx = e.clientX - blankStart.current.x;
    const dy = e.clientY - blankStart.current.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clearBlankPress();
  };

  const rootPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    endSwipe(true, swipeX(e));
    const start = blankStart.current;
    const downAt = blankDownAt.current;
    clearBlankPress();
    if (!edit || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) return;
    if (performance.now() - downAt >= 350) return;
    exitEdit();
  };

  const rootPointerCancel = () => {
    endSwipe(false);
    clearBlankPress();
  };

  // ---------------- 渲染 ----------------
  const results = APPS; // Spotlight 全量列表
  const folders = layout.folders ?? [];
  const openFolder = openFolderId ? (folders.find((f) => f.id === openFolderId) ?? null) : null;
  /** 页点可见性：编辑模式常显；平时滑动中/翻页后短暂显示，静止时同位置显示搜索胶囊 */
  const dotsVisible = edit || dotsShown;

  /** App 图标内容：有自定义图标（主题页上传）则显示图片；否则按全局「图标样式」
   *  （真实/毛玻璃/液态透明，主题页三选一）渲染默认图标 */
  const appIconNode = (id: AppId) => {
    const url = customIcons[id];
    if (url) {
      return <img src={url} alt="" draggable={false} className="h-full w-full select-none object-cover" />;
    }
    return <AppIconById id={id} />;
  };

  /** 画廊内各小组件是否已在主屏上（+ 浮层用；已在屏上的不可重复添加） */
  const galleryAdded = Object.fromEntries(
    GALLERY_KINDS.map((k) => [k, layout.pages.some((p) => p.some((t) => t.kind === 'widget' && t.widget === k))])
  ) as Record<GalleryKind, boolean>;

  /** 从拖拽开始时捕获的静态几何里取某区某类型槽位的尺寸（传 id 则优先精确匹配该 tile）。
   *  跨区拖拽时占位槽必须用目标区的真实槽位尺寸（而不是被拖项起点尺寸），
   *  否则网格 App 拖到 Dock 会把 Dock 拉高、Dock App 拖到网格会把行压矮，产生跳动；
   *  小组件跨度互不相同（时钟/信息卡片通栏、天气 2×2），故占位槽按 id 精确取尺寸。 */
  const slotSize = (kind: 'widget' | 'app', zone: Zone, id?: string): { w: number; h: number } | null => {
    if (id) {
      const exact = dragGeo.current.find((g) => g.zone === zone && g.id === id);
      if (exact) return { w: exact.w, h: exact.h };
    }
    for (const g of dragGeo.current) {
      if (g.kind === kind && g.zone === zone) return { w: g.w, h: g.h };
    }
    return null;
  };

  /** 正在拖拽的项（浮动副本内容，挂在根层级渲染） */
  const floatingTile: Tile | null = dragId
    ? isWidgetKey(dragId)
      ? { kind: 'widget', widget: widgetOfKey(dragId) }
      : isFolderKey(dragId)
        ? { kind: 'folder', id: folderIdOfKey(dragId) }
        : { kind: 'app', id: dragId as AppId }
    : null;

  /** 文件夹样式的毛玻璃缩略图（迷你图标网格）：文件夹图标与拖拽浮动副本共用；
   *  合并预览阶段目标文件夹保持原样（不混入被拖 App 的缩略图——用户要求被拖 App
   *  不显示在里面）；
   *  排布（第六十三轮反馈）：从左上角开始依次排序、每行固定 3 个（1-3 个第 1 行、
   *  4-6 个第 1/2 行，行内左对齐——旧版居中排、4 个挤 2×2 与要求不符）；
   *  迷你图标走 registry 的 AppMiniIcon：跟随全局图标样式（真实/毛玻璃/液态），不放大不裁切 */
  const folderIconNode = (apps: AppId[]) => {
    const list = apps.slice(0, 6);
    const rows: AppId[][] = [list.slice(0, 3), list.slice(3, 6)].filter((r) => r.length > 0);
    return (
      <span className="flex h-full w-full flex-col items-start justify-start gap-[2px]">
        {rows.map((row, ri) => (
          <span key={ri} className="flex items-center justify-start gap-[2px]">
            {row.map((id) => (
              <span key={id} className="block h-[14px] w-[14px] overflow-hidden rounded-[3.5px] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.25)]">
                <AppMiniIcon id={id} custom={customIcons[id]} />
              </span>
            ))}
          </span>
        ))}
      </span>
    );
  };

  const handlersFor = (id: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => cellPointerDown(e, id),
    onPointerMove: cellPointerMove,
    onPointerUp: cellPointerUp,
    onPointerCancel: cellPointerUp,
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => e.preventDefault(),
    onClickCapture: swallowClick,
  });

  /** 图标/小组件的可见内容（含抖动包裹），普通槽位与浮动副本共用 */
  const renderTileContent = (tile: Tile, i: number) => {
    if (tile.kind === 'widget') {
      return (
        <div
          className={`rounded-[22px] ${edit && dragId !== widgetKey(tile.widget) ? 'home-jiggle' : ''}`}
          style={edit ? { animationDelay: '-0.12s' } : undefined}
        >
          {tile.widget === 'clock' ? (
            <ClockGridWidget testId="home-clock" light={wallpaperLight} />
          ) : tile.widget === 'profile' ? (
            <ProfileCardWidget data={profileCard} />
          ) : tile.widget === 'bubble' ? (
            <BubbleCardWidget data={bubbleCard} />
          ) : tile.widget === 'diary' ? (
            <DiaryCardWidget data={diaryCard} />
          ) : tile.widget === 'listen' ? (
            <ListenCardWidget data={listenCard} />
          ) : tile.widget === 'music' ? (
            <MusicWidget />
          ) : tile.widget === 'netease' ? (
            <NeteaseCardWidget />
          ) : tile.widget === 'dialog' ? (
            <DialogCardWidget data={dialogCard} />
          ) : tile.widget === 'vinyl' ? (
            <VinylCardWidget light={wallpaperLight} />
          ) : tile.widget === 'calendar' ? (
            <CalendarCardWidget />
          ) : tile.widget === 'icity' ? (
            <ICityCardWidget data={icityCard} />
          ) : tile.widget === 'tickclock' ? (
            <TickClockCardWidget />
          ) : tile.widget === 'polaroid' ? (
            <PolaroidCardWidget data={polaroidCard} />
          ) : (
            <WeatherWidget />
          )}
        </div>
      );
    }
    if (tile.kind === 'empty') return null; // 空占位格无内容（调用方不会以 empty 调用，此处仅为类型收窄）
    if (tile.kind === 'folder') {
      const f = folders.find((x) => x.id === tile.id);
      const key = folderKey(tile.id);
      const merging = mergePreview?.kind === 'folder' && mergePreview.targetKey === key;
      // 预览保持文件夹原样（不把被拖 App 的缩略图混进迷你网格——用户要求被拖 App 不显示在里面）
      const apps6 = (f?.apps ?? []).slice(0, 6);
      const appCount = f?.apps.length ?? 0;
      return (
        <div
          className={`flex w-[68px] flex-col items-center gap-[5px] ${edit && dragId !== key ? 'home-jiggle' : 'transition-transform duration-150 active:scale-90'}`}
          style={edit ? { animationDelay: `${(i % 5) * -0.06}s` } : undefined}
        >
          <span
            className={`relative block h-[60px] w-[60px] rounded-[13px] p-[5px] shadow-[0_1px_6px_rgba(0,0,0,0.14)] ring-1 backdrop-blur-md transition-transform duration-200 ${
              dark ? 'bg-black/[0.28] ring-white/[0.14]' : 'bg-white/[0.22] ring-white/25'
            } ${merging ? 'merge-target-pulse' : ''}`}
          >
            {folderIconNode(apps6)}
            {appCount > 6 && (
              <span
                aria-label={`共 ${appCount} 个App`}
                data-testid="folder-count-badge"
                className="absolute -bottom-[3px] -right-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#8E8E93] px-[3px] text-[9px] font-semibold leading-none text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
              >
                {appCount}
              </span>
            )}
            {merging && <span aria-hidden="true" className="merge-target-ring" />}
          </span>
          <span
            className={`max-w-[74px] truncate text-center text-[11px] font-medium leading-none ${
              wallpaperLight ? 'text-[#1c1c1e] [text-shadow:0_1px_3px_rgba(255,255,255,0.75)]' : 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)]'
            }`}
          >
            {f?.name ?? '文件夹'}
          </span>
        </div>
      );
    }
    const app = APP_MAP[tile.id];
    // App→App 悬停合并预览：目标 App 保持原样，仅原地轻微缩放脉动 + 外圈一圈呼吸的
    // 圆角方边框（iOS 同款）；被拖 App 不显示进目标里（用户要求），松手才真正建夹
    const mergingHere = mergePreview?.kind === 'app' && mergePreview.targetKey === tile.id;
    return (
      <div
        className={`flex w-[68px] flex-col items-center gap-[5px] ${edit && dragId !== tile.id ? 'home-jiggle' : 'transition-transform duration-150 active:scale-90'}`}
        style={edit ? { animationDelay: `${(i % 5) * -0.06}s` } : undefined}
      >
        <span className={`relative block h-[60px] w-[60px] ${mergingHere ? 'merge-target-pulse' : ''}`}>
          <span className="block h-full w-full overflow-hidden rounded-[15px]">{appIconNode(tile.id)}</span>
          <AppUnreadBadge appId={tile.id} count={appUnreadOf(tile.id)} />
          {mergingHere && <span aria-hidden="true" className="merge-target-ring" />}
        </span>
        <span
          className={`max-w-[74px] truncate text-center text-[11px] font-medium leading-none ${
            wallpaperLight
              ? 'text-[#1c1c1e] [text-shadow:0_1px_3px_rgba(255,255,255,0.75)]'
              : 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)]'
          }`}
        >
          {app.name}
        </span>
      </div>
    );
  };

  /** 浮动副本（fixed + 跟随指针，挂在根层级渲染，绝不落入带 backdrop-filter 的容器内）。
   *  壳 transform 后 fixed 以壳为包含块（壳本地坐标、缩放前坐标系）→ 拖拽逻辑给的
   *  视口矩形/位移先 ÷ 壳缩放并平移到壳原点，副本才与手指重合 */
  const floatingCopy = (tile: Tile | null) => {
    if (!dragVisual || !tile) return null;
    const rr = dragRootRect.current;
    const sc = scaleRef.current || 1;
    const lx = (dragVisual.x - (rr?.left ?? 0)) / sc;
    const ly = (dragVisual.y - (rr?.top ?? 0)) / sc;
    const lw = dragVisual.w / sc;
    const lh = dragVisual.h / sc;
    const ldx = dragDelta.dx / sc;
    const ldy = dragDelta.dy / sc;
    // 合并预览中：被拖 App/文件夹轻微收拢（iOS 同款「即将入夹」）；
    // 目标图标原地轻微缩放脉动 + 外圈一圈呼吸的圆角方边框（槽位渲染层处理）
    if (mergePreview && (tile.kind === 'app' || tile.kind === 'folder')) {
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80]"
          style={{
            left: lx,
            top: ly,
            width: lw,
            height: lh,
            transform: `translate(${ldx}px, ${ldy}px)`,
            transition: 'none',
            filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.5))',
          }}
        >
          <div className="flex w-[68px] flex-col items-center gap-[5px]">
            <span className="merge-copy-shrink flex h-[68px] w-[68px] items-center justify-center">
              {tile.kind === 'app' ? (
                <span className="block h-[60px] w-[60px] overflow-hidden rounded-[15px]">{appIconNode(tile.id)}</span>
              ) : (
                <span className="block h-[60px] w-[60px] overflow-hidden rounded-[13px] bg-white/[0.22] p-[5px] ring-1 ring-white/25 backdrop-blur-md">
                  {folderIconNode((folders.find((f) => f.id === tile.id)?.apps ?? []).slice(0, 6))}
                </span>
              )}
            </span>
            <span className="max-w-[74px] truncate text-center text-[11px] font-medium leading-none text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)]">
              {tile.kind === 'app' ? APP_MAP[tile.id].name : (folders.find((f) => f.id === tile.id)?.name ?? '文件夹')}
            </span>
          </div>
        </div>
      );
    }
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[80]"
        style={{
          left: lx,
          top: ly,
          width: lw,
          height: lh,
          transform: `translate(${ldx}px, ${ldy}px) scale(1.08)`,
          transition: 'none',
          filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.5))',
        }}
      >
        {renderTileContent(tile, 0)}
      </div>
    );
  };

  /** 网格页内单个 tile（空占位格 / 占位槽 / 小组件 / App 图标），data-page 记录所在页 */
  const renderGridTile = (tile: Tile, i: number, p: number) => {
    const id = tileKey(tile);
    if (tile.kind === 'empty') {
      // 空占位格：只参与 grid 流式占位（保持拖放时留下的列位），无交互、不参与命中/动画采样
      return <div key={`empty#${i}`} aria-hidden="true" className="col-span-1" />;
    }
    if (dragId === id) {
      // 占位槽：保持原位置网格空位，尺寸/跨度取该 tile 真实槽位（跨区拖拽时不压缩行高）；
      // 合并预览期间同样保持空槽（预览是纯视觉，目标原地显示合并缩略图）
      const slot = slotSize(tile.kind === 'widget' ? 'widget' : 'app', 'grid', id);
      return (
        <div
          key={id}
          data-tile
          data-zone="grid"
          data-page={p}
          data-index={i}
          data-id={id}
          data-dragging="true"
          aria-hidden="true"
          className={`${tile.kind === 'widget' ? WIDGET_SPAN[tile.widget] : 'col-span-1'}`}
          style={slot ? { height: slot.h } : undefined}
        />
      );
    }
    if (tile.kind === 'widget') {
      const meta = WIDGET_META[tile.widget];
      return (
        <div
          key={id}
          ref={setTileRef(id)}
          data-tile
          data-zone="grid"
          data-page={p}
          data-index={i}
          data-id={id}
          className={`relative ${WIDGET_SPAN[tile.widget]} select-none ${edit ? 'touch-none' : '[touch-action:pan-y]'}`}
          role="button"
          tabIndex={0}
          aria-label={meta.openApp ? `打开${APP_MAP[meta.openApp].name}应用` : `编辑${meta.label}`}
          onClick={() => {
            if (!edit) {
              if (meta.openApp) openWith(meta.openApp);
              else if (tile.widget === 'profile') setProfileEditorOpen(true);
              else if (tile.widget === 'diary') setDiaryEditorOpen(true);
              else if (tile.widget === 'listen') setListenEditorOpen(true);
              else if (tile.widget === 'dialog') setDialogEditorOpen(true);
              else if (tile.widget === 'icity') setIcityEditorOpen(true);
              else if (tile.widget === 'polaroid') setPolaroidEditorOpen(true);
              else setBubbleEditorOpen(true);
            }
          }}
          {...handlersFor(id)}
        >
          {renderTileContent(tile, i)}
          {edit && <DeleteBadge label={meta.label} onRemove={() => removeTile(id)} className="left-[4px] top-[4px]" />}
        </div>
      );
    }
    if (tile.kind === 'folder') {
      const f = folders.find((x) => x.id === tile.id);
      return (
        <div
          key={id}
          ref={setTileRef(id)}
          data-testid="folder-tile"
          data-folder-id={tile.id}
          data-tile
          data-zone="grid"
          data-page={p}
          data-index={i}
          data-id={id}
          className={`relative col-span-1 flex select-none justify-center ${edit ? 'touch-none' : '[touch-action:pan-y]'}`}
          role="button"
          tabIndex={0}
          aria-label={`打开文件夹${f?.name ?? '文件夹'}`}
          onClick={() => {
            if (!edit) setOpenFolderId(tile.id);
          }}
          {...handlersFor(id)}
        >
          {renderTileContent(tile, i)}
          {edit && <DeleteBadge label={f?.name ?? '文件夹'} onRemove={() => removeTile(id)} className="left-[2px] top-[2px]" />}
        </div>
      );
    }
    const app = APP_MAP[tile.id];
    return (
      <div
        key={tile.id}
        ref={setTileRef(tile.id)}
        data-tile
        data-zone="grid"
        data-page={p}
        data-index={i}
        data-id={tile.id}
        className={`relative col-span-1 flex select-none justify-center ${edit ? 'touch-none' : '[touch-action:pan-y]'}`}
        role="button"
        tabIndex={0}
        aria-label={`打开${app.name}`}
        onClick={() => {
          if (!edit) openWith(tile.id);
        }}
        {...handlersFor(tile.id)}
      >
        {renderTileContent(tile, i)}
        {edit && tile.id !== 'appstore' && (
          // App Store 是已移除 App 的唯一恢复入口，编辑模式不给 ×（防死锁）
          <DeleteBadge
            label={app.name}
            onRemove={() => removeTile(tile.id)}
            className="left-[2px] top-[2px]"
          />
        )}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 z-10 flex select-none flex-col pb-[38px] transition-[padding-top,opacity] duration-300 [touch-action:pan-y] ${
        edit ? 'pt-[112px]' : 'pt-[64px]'
      } ${activeApp ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      onPointerDown={rootPointerDown}
      onPointerMove={rootPointerMove}
      onPointerUp={rootPointerUp}
      onPointerCancel={rootPointerCancel}
      onPointerLeave={rootPointerCancel}
    >
      {/* 编辑模式顶栏：左「+」小组件画廊 + 右「恢复默认」「完成」（紧凑胶囊放行指针事件；
          编辑模式内容区整体下移 48px（pt-64→112，见根容器），顶栏独占 64~112px 条带，
          页首小组件（时钟/信息卡片/网易云等）左上角 × 不会被顶栏按钮遮挡） */}
      {edit && (
        <div className="pointer-events-none absolute inset-x-0 top-[64px] z-30 flex items-center justify-between px-4">
          <button
            type="button"
            data-testid="edit-add-widget"
            aria-label="添加小组件"
            aria-haspopup="dialog"
            onClick={() => {
              try {
                navigator.vibrate?.(8);
              } catch {
                /* 震动不可用 */
              }
              setGalleryOpen(true);
            }}
            className="pointer-events-auto flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#48484c]/60 text-white backdrop-blur-xl transition-transform active:scale-95"
          >
            <Plus className="h-[19px] w-[19px]" strokeWidth={2.6} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              onClick={restoreDefault}
              className="pointer-events-auto h-[34px] rounded-full bg-[#48484c]/60 px-3.5 text-[14px] font-medium text-white backdrop-blur-xl transition-transform active:scale-95"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={exitEdit}
              className="pointer-events-auto h-[34px] rounded-full bg-white px-4 text-[15px] font-semibold text-black shadow-[0_3px_12px_rgba(0,0,0,0.28)] transition-transform active:scale-95"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {/* 分页视口：绝对定位铺满整块屏幕（横竖都全屏——用户要求把这个「扩展到全局」）。
          横向：视口占满全屏宽，翻页裁切发生在屏幕真实边缘（水平内边距由每页 px-5 承担，
          否则滑动时内容在离边缘 20px 处被硬裁、两侧露壁纸条——D2 修复）；纵向：页面
          overflow-hidden 永不上下滚动（用户要求：APP 放到下面时主屏会跟着竖向滑动，已废）——
          页内容按行封顶（GRID_ROW_CAP：满高壳 6 行，矮视口实测收敛 3~6 行），全部落在页点上方可视区内，存量超行布局加载时
          由 sanitizeLayout 摘出重排到后续页；页点与 Dock（relative z-10）悬浮在页面之上 */}
      <div className="absolute inset-0">
        <div
          ref={trackRef}
          data-testid="pages-track"
          className="flex h-full w-full transition-transform duration-300"
          style={{ transform: `translateX(-${page * 100}%)`, transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
        >
          {layout.pages.map((tiles, p) => (
            <div
              key={p}
              data-testid={`home-page-${p}`}
              aria-hidden={p !== page}
              inert={p !== page}
              className="no-scrollbar h-full w-full shrink-0 overflow-hidden"
            >
              <div
                className={`grid h-fit w-full grid-cols-4 items-start gap-x-2 gap-y-[16px] px-5 pb-[164px] transition-[padding-top] duration-300 ${
                  edit ? 'pt-[120px]' : 'pt-[72px]'
                }`}
              >
                {tiles.map((tile, i) => renderGridTile(tile, i, p))}
                {tiles.length === 0 && (
                  <p className={`col-span-4 pt-10 text-center text-[13px] ${wallpaperLight ? 'text-black/45' : 'text-white/45'}`}>空白页 · 可把 App 拖到这里</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 弹性占位：分页视口改为绝对定位后，由它把页点/Dock 撑回屏幕底部 */}
      <div className="flex-1" />

      {/* 页点/搜索互换区：滑动中或编辑模式显示页点（点按跳页），静止时同位置淡入搜索胶囊
          （整体上移 6px：pb-12px 让内容在 34px 高度带内偏上，用户要求搜索往上移一点点）。
          容器 pointer-events-none：矮视口下网格底行图标会伸进这条带（z-10 在网格之上），
          不穿透的话按压全被带子截胡、底行 App 按住拖不动（用户实测）；只有页点/搜索钮可点 */}
      <div className="pointer-events-none relative z-10 h-[34px] w-full shrink-0" data-testid="page-indicator">
        <div
          aria-hidden={!dotsVisible}
          className={`absolute inset-0 flex items-center justify-center gap-[7px] pb-[12px] transition-all duration-200 ${
            dotsVisible ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
          }`}
        >
          {layout.pages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 页`}
              aria-current={i === page}
              data-testid={`page-dot-${i}`}
              onClick={() => {
                flipTo(i);
                showDots();
              }}
              className={`pointer-events-auto h-[7px] rounded-full transition-all duration-200 ${
                i === page
                  ? wallpaperLight
                    ? 'w-[20px] bg-black'
                    : 'w-[20px] bg-white'
                  : wallpaperLight
                    ? 'w-[7px] bg-black/30'
                    : 'w-[7px] bg-white/40'
              }`}
            />
          ))}
        </div>
        {!edit && (
          <div
            aria-hidden={dotsVisible}
            className={`absolute inset-0 flex items-center justify-center pb-[12px] transition-all duration-200 ${
              dotsVisible ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100'
            }`}
          >
            <button
              onClick={() => setSpotlight(true)}
              className="pointer-events-auto flex items-center gap-[6px] rounded-full bg-black/45 px-[16px] py-[7px] text-[13px] font-medium text-white backdrop-blur-xl transition-transform duration-150 active:scale-95"
              aria-label="搜索应用"
            >
              <Search className="h-[13px] w-[13px]" aria-hidden="true" />
              搜索
            </button>
          </div>
        )}
      </div>

      {/* Dock（hairline 轮廓随壁纸明暗：浅色壁纸白底座画不出边界 → 淡黑描边，
          深色壁纸 → 淡白描边与半透明白底座呼应）；mx-5 保持原根容器 px-5 时的水平内缩；
          relative z-10 悬浮在绝对定位的分页视口之上（页面竖向滚动时内容从 Dock 下方穿过）。
          容器 pointer-events-none：矮视口下网格底行图标会伸进 Dock 背板（z-10 在网格之上），
          不穿透的话底行 App 按压全被 Dock 截胡、按住拖不动（用户实测）；只有 Dock 图标可点 */}
      <div
        data-dock
        className={`pointer-events-none relative z-10 mx-5 flex items-center gap-[18px] rounded-[32px] bg-white/[0.16] ring-1 ${
          wallpaperLight ? 'ring-black/[0.08]' : 'ring-white/[0.12]'
        } px-[14px] py-[13px] shadow-[0_4px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:bg-white/[0.10] ${
          edit ? 'touch-none select-none' : ''
        }`}
      >
          {layout.dock.map((id, i) => {
            const app = APP_MAP[id];
            if (!app) return null;
            if (dragId === id) {
              // 占位槽：Dock 真实槽位尺寸（网格 App 拖进来时不会把 Dock 拉高）
              const slot = slotSize('app', 'dock') ?? { w: 58, h: 58 };
              return (
                <div
                  key={id}
                  data-tile
                  data-zone="dock"
                  data-index={i}
                  data-id={id}
                  data-dragging="true"
                  aria-hidden="true"
                  className="block shrink-0"
                  style={{ width: slot.w, height: slot.h }}
                />
              );
            }
            return (
              <div
                key={id}
                ref={setTileRef(id)}
                data-tile
                data-zone="dock"
                data-index={i}
                data-id={id}
                className="pointer-events-auto relative block h-[58px] w-[58px] touch-none select-none"
                role="button"
                tabIndex={0}
                aria-label={`打开${app.name}`}
                onClick={() => {
                  if (!edit) openWith(id);
                }}
                {...handlersFor(id)}
              >
                <span
                  className={`block h-full w-full overflow-hidden rounded-[14px] ${
                    edit ? 'home-jiggle' : 'transition-transform duration-150 active:scale-90'
                  }`}
                  style={edit ? { animationDelay: `${(i % 4) * -0.08}s` } : undefined}
                >
                  {appIconNode(id)}
                </span>
                {!edit && <AppUnreadBadge appId={id} count={appUnreadOf(id)} size="dock" />}
                {edit && id !== 'appstore' && (
                  // App Store 拖进 Dock 同样不给 ×（恢复入口保护）
                  <DeleteBadge label={app.name} onRemove={() => removeTile(id)} className="-left-[7px] -top-[7px]" />
                )}
              </div>
            );
          })}
      </div>

      {/* 浮动副本：挂在根层级（根元素无 transform/filter/backdrop-filter，副本的 fixed
          包含块 = 手机壳；壳被等比缩小时用壳本地坐标渲染，见 floatingCopy 开头的换算）。
          之前渲染在 Dock 容器内，Dock 的 backdrop-blur-2xl 使其成为 fixed 后代的包含块，
          坐标被解释为相对 Dock → 副本飞出手机壳被裁掉，从 Dock 拖 App 时图标“消失”。 */}
      {floatingCopy(floatingTile)}

      {/* 入夹飞入动画层：合并落手后 App 图标从松手点缩小飞进文件夹（纯视觉，挂在根层级） */}
      {flyIn && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[85]"
          style={{ left: flyIn.fx, top: flyIn.fy, width: ICON_SIZE, height: ICON_SIZE }}
        >
          <span
            ref={flyInEl}
            className="block h-full w-full overflow-hidden rounded-[15px] shadow-[0_12px_26px_rgba(0,0,0,0.4)]"
          >
            {appIconNode(flyIn.appId)}
          </span>
        </div>
      )}

      {/* 信息卡片小组件编辑器（底部弹窗：换头像/换背景图/改文字；打开时才挂载） */}
      {profileEditorOpen && (
        <ProfileCardEditor
          data={profileCard}
          onClose={() => setProfileEditorOpen(false)}
          onSave={(d) => {
            saveProfileCard(d);
            setProfileEditorOpen(false);
          }}
        />
      )}

      {/* 气泡小组件编辑器（底部弹窗：改左右气泡文字；打开时才挂载） */}
      {bubbleEditorOpen && (
        <BubbleCardEditor
          data={bubbleCard}
          onClose={() => setBubbleEditorOpen(false)}
          onSave={(d) => {
            saveBubbleCard(d);
            setBubbleEditorOpen(false);
          }}
        />
      )}

      {/* 日记小组件编辑器（底部弹窗：换头像/改名字/ID/文案；打开时才挂载） */}
      {diaryEditorOpen && (
        <DiaryCardEditor
          data={diaryCard}
          onClose={() => setDiaryEditorOpen(false)}
          onSave={(d) => {
            saveDiaryCard(d);
            setDiaryEditorOpen(false);
          }}
        />
      )}

      {/* 一起听小组件编辑器（底部弹窗：换双头像/改气泡/歌名/歌词/状态文案；打开时才挂载） */}
      {listenEditorOpen && (
        <ListenCardEditor
          data={listenCard}
          onClose={() => setListenEditorOpen(false)}
          onSave={(d) => {
            saveListenCard(d);
            setListenEditorOpen(false);
          }}
        />
      )}

      {/* 对话气泡小组件编辑器（底部弹窗：换双头像/改双气泡文字；打开时才挂载） */}
      {dialogEditorOpen && (
        <DialogCardEditor
          data={dialogCard}
          onClose={() => setDialogEditorOpen(false)}
          onSave={(d) => {
            saveDialogCard(d);
            setDialogEditorOpen(false);
          }}
        />
      )}

      {/* iCity 小组件编辑器（底部弹窗：改名字/换头像/改胶囊文字；打开时才挂载） */}
      {icityEditorOpen && (
        <ICityCardEditor
          data={icityCard}
          onClose={() => setIcityEditorOpen(false)}
          onSave={(d) => {
            saveIcityCard(d);
            setIcityEditorOpen(false);
          }}
        />
      )}

      {/* 拍立得小组件编辑器（底部弹窗：三张照片逐张更换/恢复默认；打开时才挂载） */}
      {polaroidEditorOpen && (
        <PolaroidCardEditor
          data={polaroidCard}
          onClose={() => setPolaroidEditorOpen(false)}
          onSave={(d) => {
            savePolaroidCard(d);
            setPolaroidEditorOpen(false);
          }}
        />
      )}

      {/* 文件夹展开面板（全屏毛玻璃；打开时才挂载；点外部收起，编辑模式可拖出/退回 App） */}
      {openFolder && (
        <FolderPanel
          key={openFolder.id}
          folder={openFolder}
          edit={edit}
          appIconNode={appIconNode}
          appUnreadOf={appUnreadOf}
          onClose={() => setOpenFolderId(null)}
          onOpenApp={(id) => {
            setOpenFolderId(null);
            openWith(id);
          }}
          onRename={(name) => renameFolder(openFolder.id, name)}
          onRemoveApp={(id) => removeAppFromFolder(openFolder.id, id)}
          onDragOut={(id, x, y) => {
            setOpenFolderId(null);
            beginDrag(id, x, y);
          }}
        />
      )}

      {/* 编辑模式「+」小组件画廊浮层：全部小组件 1:1 预览（平铺不分组），点 + 添加回主屏（遮罩点按关闭） */}
      {edit && galleryOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="添加小组件"
          data-testid="widget-gallery-overlay"
          className="absolute inset-0 z-30 flex flex-col bg-black/60 px-5 pb-5 pt-[74px] backdrop-blur-2xl"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setGalleryOpen(false)}
        >
          <div className="mb-3 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-semibold text-white">添加小组件</p>
            <button
              type="button"
              aria-label="关闭小组件画廊"
              data-testid="gallery-close"
              onClick={() => setGalleryOpen(false)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/15 text-white transition-transform active:scale-90"
            >
              <X className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto pb-1" onClick={(e) => e.stopPropagation()}>
            <WidgetGalleryContent
              profileData={profileCard}
              bubbleData={bubbleCard}
              diaryData={diaryCard}
              listenData={listenCard}
              dialogData={dialogCard}
              icityData={icityCard}
              polaroidData={polaroidCard}
              added={galleryAdded}
              onAdd={addWidgetFromGallery}
            />
          </div>
          <p className="pt-2 text-center text-[12px] leading-none text-white/55">全部小组件 1:1 预览 · 点右上角 + 添加到主屏 · 遮罩处点按关闭</p>
        </div>
      )}

      {/* Spotlight 应用搜索覆盖层 */}
      {spotlight && (
        <div
          className="absolute inset-0 z-30 flex flex-col bg-black/55 px-5 pt-[70px] [touch-action:pan-y] backdrop-blur-2xl"
          role="dialog"
          aria-label="搜索"
          onClick={() => {
            setSpotlight(false);
            setQuery('');
          }}
        >
          <div
            className="flex items-center gap-2 rounded-[12px] bg-white/15 px-3 py-[9px]"
            onClick={(e) => e.stopPropagation()}
          >
            <Search className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用"
              className="w-full bg-transparent text-[16px] text-white outline-none placeholder:text-white/50"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="清除搜索"
                className="shrink-0 rounded-full bg-white/25 p-[2px]"
              >
                <X className="h-3 w-3 text-white" aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            className="no-scrollbar mt-4 grid max-h-[520px] grid-cols-4 gap-y-[16px] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {results.map((app) => (
              <button
                key={app.id}
                onClick={() => {
                  setSpotlight(false);
                  setQuery('');
                  openWith(app.id);
                }}
                className="flex w-[68px] flex-col items-center gap-[5px] transition-transform duration-150 active:scale-90"
                aria-label={`打开${app.name}`}
              >
                <span className="relative block h-[60px] w-[60px]">
                  <span className="block h-full w-full overflow-hidden rounded-[15px]">
                    {appIconNode(app.id)}
                  </span>
                  <AppUnreadBadge appId={app.id} count={appUnreadOf(app.id)} />
                </span>
                <span className="max-w-[74px] truncate text-center text-[11px] font-medium leading-none text-white">
                  {app.name}
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <p className="col-span-4 mt-8 text-center text-[14px] text-white/60">没有找到应用</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
