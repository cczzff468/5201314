'use client';

/**
 * 阅读 App · 共享常量与工具（客户端）
 * - App 主题（蓝色玻璃毛玻璃主调 + 可切换）
 * - 阅读背景（内置 + 自定义上传）
 * - 内置字体（+ 自定义上传）
 * - 精选书单（首页分类推荐）
 * - API 薄封装
 */
import { clsx } from 'clsx';

// ---------------------------------------------------------------------------
// 全局常量：手机状态栏高度（StatusBar 覆盖层高 54px，页面顶部需预留）
// ---------------------------------------------------------------------------
export const SB_H = 54;

// ---------------------------------------------------------------------------
// 排版设置类型（与 /api/reading/settings 对齐）
// ---------------------------------------------------------------------------
export interface ReaderSettings {
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold' | 'light';
  bgTheme: string;
  bgCustom: string | null;
  fontCustom: string | null;
  appTheme: string;
  letterSpacing: number;
  lineSpacing: number;
  paraSpacing: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  titlePosition: 'left' | 'center' | 'hidden';
  justify: boolean;
  bottomAlign: boolean;
  underline: boolean;
  /** 阅读页脚：显示时间 */
  showTime: boolean;
  /** 阅读页脚：显示电量 */
  showBattery: boolean;
  /** 排版预设（保存的排版方案） */
  presets: ReaderPreset[];
  /** 我的资料：昵称 / 自定义 ID / 头像 */
  profileName: string | null;
  profileId: string | null;
  profileAvatar: string | null;
  /** 书架自定义分组名列表 */
  customGroups: string[];
}

/** 排版预设（「保存排版」一键回切） */
export interface ReaderPreset {
  id: string;
  name: string;
  data: Pick<
    ReaderSettings,
    | 'fontSize'
    | 'fontFamily'
    | 'fontWeight'
    | 'letterSpacing'
    | 'lineSpacing'
    | 'paraSpacing'
    | 'marginLeft'
    | 'marginRight'
    | 'marginTop'
    | 'marginBottom'
    | 'titlePosition'
    | 'justify'
    | 'underline'
  >;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 20,
  fontFamily: 'system',
  fontWeight: 'normal',
  bgTheme: 'paper',
  bgCustom: null,
  fontCustom: null,
  appTheme: 'ocean',
  letterSpacing: 0,
  lineSpacing: 1.9,
  paraSpacing: 0.9,
  marginLeft: 5,
  marginRight: 5,
  marginTop: 4,
  marginBottom: 4,
  titlePosition: 'left',
  justify: true,
  bottomAlign: false,
  underline: false,
  showTime: true,
  showBattery: true,
  presets: [],
  profileName: null,
  profileId: null,
  profileAvatar: null,
  customGroups: [],
};

// ---------------------------------------------------------------------------
// App 主题（玻璃毛玻璃风格：磨砂胶囊 + 主色点缀）
// ---------------------------------------------------------------------------
export interface AppTheme {
  key: string;
  name: string;
  /** 主色 */
  accent: string;
  /** 主色浅底（图标容器/胶囊选中底） */
  accentSoft: string;
  /** 渐变（banner/按钮） */
  gradFrom: string;
  gradTo: string;
  /** 页面底色 */
  pageBg: string;
  /** 卡片底（半透玻璃） */
  cardBg: string;
  /** 卡片描边 */
  cardRing: string;
  /** TabBar 玻璃底 */
  barBg: string;
  /** 文本主色 */
  textMain: string;
  /** 文本次色 */
  textSub: string;
}

export const APP_THEMES: Record<string, AppTheme> = {
  ocean: {
    key: 'ocean',
    name: '海洋蓝',
    accent: '#2274F0',
    accentSoft: 'rgba(34,116,240,0.12)',
    gradFrom: '#7EC3FF',
    gradTo: '#2274F0',
    pageBg: '#F2F5FA',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(34,116,240,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#1A1D26',
    textSub: '#8A909C',
  },
  aurora: {
    key: 'aurora',
    name: '极光紫',
    accent: '#7C5CFC',
    accentSoft: 'rgba(124,92,252,0.12)',
    gradFrom: '#B9A4FF',
    gradTo: '#7C5CFC',
    pageBg: '#F4F2FB',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(124,92,252,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#1B1A26',
    textSub: '#8B889C',
  },
  midnight: {
    key: 'midnight',
    name: '暗夜黑',
    accent: '#5B8DEF',
    accentSoft: 'rgba(91,141,239,0.16)',
    gradFrom: '#3A4A6B',
    gradTo: '#1E2740',
    pageBg: '#12141C',
    cardBg: 'rgba(30,33,46,0.66)',
    cardRing: 'rgba(255,255,255,0.07)',
    barBg: 'rgba(22,24,34,0.72)',
    textMain: '#E8EAF2',
    textSub: '#7A7F90',
  },
  sakura: {
    key: 'sakura',
    name: '樱花粉',
    accent: '#EC5E9C',
    accentSoft: 'rgba(236,94,156,0.12)',
    gradFrom: '#FFB6D2',
    gradTo: '#EC5E9C',
    pageBg: '#FBF3F7',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(236,94,156,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#261A22',
    textSub: '#9C8894',
  },
  jade: {
    key: 'jade',
    name: '翡翠绿',
    accent: '#10A37F',
    accentSoft: 'rgba(16,163,127,0.12)',
    gradFrom: '#7DDFC0',
    gradTo: '#10A37F',
    pageBg: '#F1F8F5',
    cardBg: 'rgba(255,255,255,0.58)',
    cardRing: 'rgba(16,163,127,0.10)',
    barBg: 'rgba(255,255,255,0.62)',
    textMain: '#182521',
    textSub: '#87968F',
  },
};

export function themeOf(key: string): AppTheme {
  return APP_THEMES[key] || APP_THEMES.ocean;
}

// ---------------------------------------------------------------------------
// 阅读背景（内置 + 自定义）
// ---------------------------------------------------------------------------
export interface ReadBg {
  key: string;
  name: string;
  bg: string;
  text: string;
  sub: string;
  dark?: boolean;
}

export const READ_BGS: ReadBg[] = [
  { key: 'paper', name: '纸张', bg: '#F7F3E8', text: '#3B3A36', sub: '#8A867A' },
  { key: 'white', name: '纯白', bg: '#FFFFFF', text: '#26262A', sub: '#8A8A90' },
  { key: 'green', name: '护眼', bg: '#CBE6C7', text: '#2D3B2E', sub: '#6E8470' },
  { key: 'cream', name: '米黄', bg: '#F5E9D0', text: '#4A4234', sub: '#94886E' },
  { key: 'gray', name: '浅灰', bg: '#E8E8EC', text: '#33343A', sub: '#82838C' },
  { key: 'night', name: '夜间', bg: '#15161B', text: '#B8BAC4', sub: '#63656F', dark: true },
];

export function bgOf(s: ReaderSettings): { bg: string; text: string; sub: string; dark: boolean } {
  if (s.bgTheme === 'custom' && s.bgCustom) {
    // 自定义背景按亮度猜文字色（dataURL 图片无法同步取亮度，默认深字）
    return { bg: `center/cover no-repeat url(${s.bgCustom}) #f3f3f3`, text: '#333', sub: '#888', dark: false };
  }
  const b = READ_BGS.find((x) => x.key === s.bgTheme) || READ_BGS[0];
  return { bg: b.bg, text: b.text, sub: b.sub, dark: !!b.dark };
}

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------
export interface FontOpt {
  key: string;
  name: string;
  css: string;
}

export const BUILTIN_FONTS: FontOpt[] = [
  { key: 'system', name: '默认', css: 'inherit' },
  { key: 'songti', name: '宋体', css: '"Songti SC","STSong","SimSun",serif' },
  { key: 'kaiti', name: '楷体', css: '"Kaiti SC","STKaiti","KaiTi",serif' },
  { key: 'heiti', name: '黑体', css: '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif' },
  { key: 'fangsong', name: '仿宋', css: '"Fangsong","STFangsong","FangSong",serif' },
];

export function fontCss(s: ReaderSettings): string {
  if (s.fontFamily === 'custom' && s.fontCustom) return `"ReadingCustomFont","${s.fontFamily}"`;
  return (BUILTIN_FONTS.find((f) => f.key === s.fontFamily) || BUILTIN_FONTS[0]).css;
}

export const FONT_WEIGHTS: { key: ReaderSettings['fontWeight']; name: string; css: number }[] = [
  { key: 'light', name: '细体', css: 300 },
  { key: 'normal', name: '常规', css: 400 },
  { key: 'bold', name: '粗体', css: 700 },
];

// ---------------------------------------------------------------------------
// 精选书单（首页/分类页推荐：点击直达聚合搜索）
// ---------------------------------------------------------------------------
export interface FeaturedBook {
  name: string;
  author: string;
  tag: string;
}
export const FEATURED: Record<string, FeaturedBook[]> = {
  热门: [
    { name: '诡秘之主', author: '爱潜水的乌贼', tag: '玄幻' },
    { name: '斗破苍穹', author: '天蚕土豆', tag: '玄幻' },
    { name: '凡人修仙传', author: '忘语', tag: '仙侠' },
    { name: '庆余年', author: '猫腻', tag: '古装' },
    { name: '盗墓笔记', author: '南派三叔', tag: '悬疑' },
    { name: '三体', author: '刘慈欣', tag: '科幻' },
    { name: '赘婿', author: '愤怒的香蕉', tag: '都市' },
    { name: '全职高手', author: '蝴蝶蓝', tag: '都市' },
  ],
  玄幻: [
    { name: '斗破苍穹', author: '天蚕土豆', tag: '玄幻' },
    { name: '遮天', author: '辰东', tag: '玄幻' },
    { name: '完美世界', author: '辰东', tag: '玄幻' },
    { name: '一念永恒', author: '耳根', tag: '仙侠' },
    { name: '斗罗大陆', author: '唐家三少', tag: '玄幻' },
    { name: '雪中悍刀行', author: '烽火戏诸侯', tag: '武侠' },
    { name: '大奉打更人', author: '卖报小郎君', tag: '玄幻' },
    { name: '万相之王', author: '天蚕土豆', tag: '玄幻' },
  ],
  都市: [
    { name: '赘婿', author: '愤怒的香蕉', tag: '都市' },
    { name: '大医凌然', author: '志鸟村', tag: '都市' },
    { name: '全职高手', author: '蝴蝶蓝', tag: '都市' },
    { name: '校花的贴身高手', author: '鱼人二代', tag: '都市' },
    { name: '都市极品医神', author: '风会笑', tag: '都市' },
    { name: '警察荣誉', author: '.dis', tag: '都市' },
    { name: '大江东去', author: '阿耐', tag: '都市' },
    { name: '欢乐颂', author: '阿耐', tag: '都市' },
  ],
  悬疑: [
    { name: '盗墓笔记', author: '南派三叔', tag: '悬疑' },
    { name: '鬼吹灯', author: '天下霸唱', tag: '悬疑' },
    { name: '法医秦明', author: '秦明', tag: '悬疑' },
    { name: '十宗罪', author: '蜘蛛', tag: '悬疑' },
    { name: '白夜追凶', author: '指纹', tag: '悬疑' },
    { name: '坏小孩', author: '紫金陈', tag: '悬疑' },
    { name: '无证之罪', author: '紫金陈', tag: '悬疑' },
    { name: '长夜难明', author: '紫金陈', tag: '悬疑' },
  ],
  科幻: [
    { name: '三体', author: '刘慈欣', tag: '科幻' },
    { name: '球状闪电', author: '刘慈欣', tag: '科幻' },
    { name: '超新星纪元', author: '刘慈欣', tag: '科幻' },
    { name: '流浪地球', author: '刘慈欣', tag: '科幻' },
    { name: '北京折叠', author: '郝景芳', tag: '科幻' },
    { name: '银河帝国', author: '艾萨克·阿西莫夫', tag: '科幻' },
    { name: '沙丘', author: '弗兰克·赫伯特', tag: '科幻' },
    { name: '安德的游戏', author: '奥森·斯科特·卡德', tag: '科幻' },
  ],
  耽美: [
    { name: '天官赐福', author: '墨香铜臭', tag: '耽美' },
    { name: '魔道祖师', author: '墨香铜臭', tag: '耽美' },
    { name: '人渣反派自救系统', author: '墨香铜臭', tag: '耽美' },
    { name: '二哈和他的白猫师尊', author: '肉包不吃肉', tag: '耽美' },
    { name: '默读', author: 'priest', tag: '耽美' },
    { name: '杀破狼', author: 'priest', tag: '耽美' },
    { name: '残次品', author: 'priest', tag: '耽美' },
    { name: '撒野', author: '巫哲', tag: '耽美' },
    { name: '伪装学渣', author: '木瓜黄', tag: '耽美' },
    { name: '某某', author: '木苏里', tag: '耽美' },
    { name: '全球高考', author: '木苏里', tag: '耽美' },
    { name: '小蘑菇', author: '一十四洲', tag: '耽美' },
  ],
  轻小说: [
    { name: '刀剑神域', author: '川原砾', tag: '轻小说' },
    { name: '无职转生', author: '理不尽な孙の手', tag: '轻小说' },
    { name: '为美好的世界献上祝福', author: '晓夏目', tag: '轻小说' },
    { name: '关于我转生变成史莱姆这件事', author: '伏濑', tag: '轻小说' },
    { name: 'overload不死者之王', author: '丸山くがね', tag: '轻小说' },
    { name: '幼女战记', author: 'カルロ・ゼン', tag: '轻小说' },
    { name: 'Re:从零开始的异世界生活', author: '長月達平', tag: '轻小说' },
    { name: '漆黑的子弹', author: '神崎紫电', tag: '轻小说' },
  ],
};

// ---------------------------------------------------------------------------
// 数据类型
// ---------------------------------------------------------------------------
export interface SourceItem {
  id: string;
  name: string;
  url: string;
  group: string;
  enabled: boolean;
  isBuiltin: boolean;
  checkStatus: string | null;
}
export interface SearchBookItem {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  sourceName: string;
  sourceUrl: string;
  sourceId?: string;
}
export interface ShelfBookItem {
  id: string;
  name: string;
  author: string | null;
  coverUrl: string | null;
  intro: string | null;
  sourceId: string;
  sourceName: string | null;
  bookUrl: string;
  /** 自定义分组（空 = 未分组） */
  customGroup: string | null;
  totalChapters: number;
  lastChapterTitle: string | null;
  lastReadChapter: number;
  /** 章内页码（分页模式记忆） */
  lastPage: number;
  lastReadAt: string;
}
/** 阅读历史条目（历史 Tab） */
export interface ReadHistoryItem {
  id: string;
  name: string;
  author: string | null;
  coverUrl: string | null;
  sourceId: string;
  sourceName: string | null;
  bookUrl: string;
  totalChapters: number;
  lastReadChapter: number;
  lastPage: number;
  lastChapterTitle: string | null;
  lastReadAt: string;
}
export interface TocItem {
  title: string;
  url: string;
}
export interface BookDetailData {
  name: string;
  author: string;
  coverUrl: string;
  intro: string;
  lastChapter: string;
  chapters: TocItem[];
  total: number;
  inShelf: boolean;
  lastReadChapter: number;
  /** 章内页码（分页模式续读） */
  lastPage: number;
}

// ---------------------------------------------------------------------------
// API 薄封装（非 JSON 响应——如网关超时 HTML——给出友好报错而不是裸解析错误）
// ---------------------------------------------------------------------------
async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  let d: (T & { error?: string }) | null = null;
  try {
    d = JSON.parse(text) as T & { error?: string };
  } catch {
    // 拿到 HTML/空响应（常见：网关超时 / 服务异常），给出可读错误
    throw new Error('网络超时或服务异常，请稍后重试');
  }
  if (!res.ok && d && typeof d === 'object' && 'error' in d && d.error) throw new Error(String(d.error));
  return d as T;
}

export const api = {
  listSources: (enabledOnly = false) =>
    fetch(`/api/reading/sources${enabledOnly ? '?enabled=1' : ''}`).then((r) => j<{ sources: SourceItem[] }>(r)),
  sourceAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  searchOne: (keyword: string, sourceId: string, signal?: AbortSignal) =>
    fetch('/api/reading/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, sourceId }),
      signal,
    }).then((r) => j<{ books?: SearchBookItem[]; ms?: number; sourceName?: string }>(r)),
  bookDetail: (sourceId: string, bookUrl: string, name: string, author: string) =>
    fetch(
      `/api/reading/book?${new URLSearchParams({ sourceId, bookUrl, name, author })}`,
    ).then((r) => j<BookDetailData>(r)),
  chapter: (sourceId: string, chapterUrl: string, bookUrl: string, index: number, title: string, refresh = false) =>
    fetch(
      `/api/reading/chapter?${new URLSearchParams({ sourceId, chapterUrl, bookUrl, index: String(index), title, ...(refresh ? { refresh: '1' } : {}) })}`,
    ).then((r) => j<{ title: string; content: string; summary: string; cached: boolean }>(r)),
  shelfList: () => fetch('/api/reading/shelf').then((r) => j<{ books: ShelfBookItem[] }>(r)),
  shelfAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/shelf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  getSettings: () => fetch('/api/reading/settings').then((r) => j<{ settings: ReaderSettings }>(r)),
  saveSettings: (patch: Partial<ReaderSettings>) =>
    fetch('/api/reading/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => j<{ ok: boolean }>(r)),
  chat: (body: Record<string, unknown>) =>
    fetch('/api/reading/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ reply: string }>(r)),
  history: (bookUrl?: string) =>
    fetch(`/api/reading/history${bookUrl ? `?bookUrl=${encodeURIComponent(bookUrl)}` : ''}`).then((r) =>
      j<Record<string, unknown>>(r),
    ),
  historyAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  /** 阅读历史（历史 Tab）：读过书的列表 / 移除 / 清空 */
  readlogList: () => fetch('/api/reading/readlog').then((r) => j<{ reads: ReadHistoryItem[] }>(r)),
  readlogAction: (body: Record<string, unknown>) =>
    fetch('/api/reading/readlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<Record<string, unknown>>(r)),
  /** 阅读时长（秒）：获取累计 / 阅读中每 15s 上报 */
  readTimeGet: () => fetch('/api/reading/readtime').then((r) => j<{ seconds: number }>(r)),
  readTimeAdd: (seconds: number) =>
    fetch('/api/reading/readtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    }).then((r) => j<{ ok: boolean; seconds: number }>(r)),
  /** 本地导入（txt / epub）：上传解析入库并自动入书架 */
  localUpload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/reading/local', { method: 'POST', body: fd }).then((r) =>
      j<{ ok: boolean; id: string; name: string; chapters: number }>(r),
    );
  },
};

/** 秒数 → 「x小时y分钟 / y分钟」展示 */
export function formatReadTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0分钟';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h <= 0) return `${m}分钟`;
  if (m <= 0) return `${h}小时`;
  return `${h}小时${m}分钟`;
}

/** 封面代理：防盗链/跨域封面统一走服务端抓取（/api/reading/cover），带书源头 Referer */
export function coverSrc(url?: string | null, sid?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  const q = new URLSearchParams({ u: url });
  if (sid) q.set('sid', sid);
  return `/api/reading/cover?${q.toString()}`;
}

/** 封面占位（书脊风：渐变底 + 书脊高光 + 书名竖排区） */
export function CoverPlaceholder({ name, author, className, radius = 'rounded-[10px]' }: { name: string; author?: string | null; className?: string; radius?: string }) {
  return (
    <div
      className={clsx('relative flex overflow-hidden bg-gradient-to-br from-[#9CC3F8] via-[#6E9BEE] to-[#3E6FD9]', radius, className)}
      aria-hidden="true"
    >
      {/* 书脊高光 */}
      <span className="absolute inset-y-0 left-0 w-[14%] bg-gradient-to-r from-black/25 to-transparent" />
      <span className="absolute inset-y-0 left-[14%] w-px bg-white/30" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 py-2">
        <span className="line-clamp-3 text-center text-[13px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
          {name}
        </span>
        {author && <span className="line-clamp-1 text-center text-[10px] font-medium text-white/80">{author}</span>}
      </div>
      <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent" />
    </div>
  );
}

/** 智能定位第一章（目录头部可能有公告/最新块） */
export function findStartIndex(chapters: TocItem[]): number {
  const re = /^第\s*[一1]\s*章|^[楔序]章|^[楔序]言|^正文/;
  for (let i = 0; i < Math.min(chapters.length, 25); i++) {
    if (re.test(chapters[i].title.trim())) return i;
  }
  return 0;
}

/** 章节标题归一化（去空格/全角符号，用于换源后的进度映射） */
function normTitle(t: string): string {
  return t.replace(/[\s·、，。：:，·\-—_=+*/\\|.,!?！？"'“”‘’()（）\[\]【】<>《》~～#@%^&$]/g, '').toLowerCase();
}

/** 换源后进度映射：旧章节标题 → 新目录下标（精确 → 包含 → 原下标截断） */
export function matchChapterIndex(newChapters: TocItem[], oldTitle: string | null | undefined, oldIdx: number): number {
  if (!newChapters.length) return 0;
  if (!oldTitle) return Math.min(oldIdx, newChapters.length - 1);
  const nt = normTitle(oldTitle);
  let hit = newChapters.findIndex((c) => normTitle(c.title) === nt);
  if (hit < 0) hit = newChapters.findIndex((c) => normTitle(c.title).includes(nt) || nt.includes(normTitle(c.title)));
  return hit >= 0 ? hit : Math.min(oldIdx, newChapters.length - 1);
}

// ---------------------------------------------------------------------------
// 首页精选书单 · 真实封面（搜索书源取封面图，localStorage 缓存 7 天）
// ---------------------------------------------------------------------------
const FEATURED_COVER_KEY = 'rd-featured-cover-v1';
const FEATURED_COVER_TTL = 7 * 24 * 3600_000;

interface CoverEntry {
  url: string;
  sid: string;
  t: number;
}
type CoverCache = Record<string, CoverEntry>;

function readCoverCache(): CoverCache {
  try {
    return JSON.parse(localStorage.getItem(FEATURED_COVER_KEY) || '{}') as CoverCache;
  } catch {
    return {};
  }
}
function writeCoverEntry(name: string, e: CoverEntry) {
  try {
    const c = readCoverCache();
    c[name] = e;
    localStorage.setItem(FEATURED_COVER_KEY, JSON.stringify(c));
  } catch {
    /* 忽略 */
  }
}

/** 最近成功供图的源（优先再试，避开死源反复超时） */
let goodCoverSourceId = '';
/** 已确认无结果的源（本轮会话内不再首发尝试） */
const deadCoverSources = new Set<string>();

/** 为一本书取真实封面：并发试前几个启用书源，谁先返回带封面的结果用谁 */
export async function fetchBookCover(
  name: string,
  author: string,
  sources: SourceItem[],
  timeoutMs = 6000,
): Promise<{ url: string; sid: string } | null> {
  const ranked = [
    ...sources.filter((s) => s.id === goodCoverSourceId),
    ...sources.filter((s) => s.id !== goodCoverSourceId && !deadCoverSources.has(s.id)),
  ];
  const cands = ranked.slice(0, 5);
  if (!cands.length) return null;
  return new Promise((resolve) => {
    let settled = false;
    let pending = cands.length;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    for (const src of cands) {
      api
        .searchOne(name, src.id)
        .then((r) => {
          if (settled) return;
          const books = r.books || [];
          const norm = (s: string) => s.replace(/\s+/g, '');
          const hit =
            books.find((b) => norm(b.name) === norm(name) && b.coverUrl) ||
            books.find((b) => norm(b.name).includes(norm(name)) && b.coverUrl) ||
            books.find((b) => b.coverUrl);
          if (hit?.coverUrl) {
            settled = true;
            clearTimeout(timer);
            goodCoverSourceId = hit.sourceId || src.id;
            writeCoverEntry(name, { url: hit.coverUrl, sid: hit.sourceId || src.id, t: Date.now() });
            resolve({ url: hit.coverUrl, sid: hit.sourceId || src.id });
          } else {
            deadCoverSources.add(src.id);
            if (--pending <= 0) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
          }
        })
        .catch(() => {
          deadCoverSources.add(src.id);
          if (!settled && --pending <= 0) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        });
    }
    void author;
  });
}

/** 读缓存的有效封面（无网络场景秒开） */
export function cachedCover(name: string): { url: string; sid: string } | null {
  const e = readCoverCache()[name];
  if (e && Date.now() - e.t < FEATURED_COVER_TTL) return { url: e.url, sid: e.sid };
  return null;
}

/** 压缩图片为 dataURL（自定义背景上传用） */
export function fileToDataUrl(file: File, maxSize = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('图片解析失败'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
