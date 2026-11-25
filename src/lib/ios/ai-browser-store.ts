'use client';

/**
 * AI 专属分屏浏览器（全局共享 store）。
 *
 * 第三十轮升级（机主需求）：
 * - 面板从固定底部半屏改为【可移动小窗】（AIBrowserWindow：标题条拖拽换位、位置持久化）；
 * - 内置六搜索引擎：百度（主用）/360/淘宝/搜狗/抖音/快手（engine 状态 + 持久化）；
 * - 悬浮球记忆：上次看的页面（url/标题/模式）持久化在 localStorage——点球即恢复上次内容；
 * - 悬浮球出现时机：仅当 AI 浏览器被用过（有历史页面）或窗口正开着时显示（首次未用不显示）。
 *
 * 状态口径（zustand 全局单例，与 chat-float-store 同范式）：
 * - mode：'web' = iframe 直接加载（保真）；'reader' = 阅读模式（服务端抽取正文，AI 高亮载体）
 * - page：当前加载页（url + 抽取的标题/摘要/正文 + favicon）
 * - highlight：AI 高亮指令（阅读模式点亮）
 * - engine：当前搜索引擎（默认 baidu 主用）
 */

import { create } from 'zustand';

export interface AIBrowserPage {
  /** 正在加载/已加载的 URL */
  url: string;
  /** 阅读模式抽取的标题（web 模式仅作地址栏展示兜底；空 = 未抽取） */
  title: string;
  desc: string;
  favicon: string;
  text: string;
  /** 抽取时间戳（0 = 尚未抽取） */
  readAt: number;
  truncated: boolean;
}

export type AIBrowserMode = 'web' | 'reader';

/* ---------------- 内置搜索引擎（机主规格：百度/360/淘宝/搜狗/抖音/快手，主用百度） ---------------- */

export type SearchEngineId = 'baidu' | '360' | 'taobao' | 'sogou' | 'douyin' | 'kuaishou';

export const SEARCH_ENGINES: { id: SearchEngineId; name: string; build: (q: string) => string }[] = [
  { id: 'baidu', name: '百度', build: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
  { id: '360', name: '360', build: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}` },
  { id: 'taobao', name: '淘宝', build: (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}&commend=all&ssid=s5-e&search_type=item&sourceId=tb.index` },
  { id: 'sogou', name: '搜狗', build: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}` },
  { id: 'douyin', name: '抖音', build: (q) => `https://www.douyin.com/search/${encodeURIComponent(q)}?publish_time=0&sort_type=0&source=web_search` },
  { id: 'kuaishou', name: '快手', build: (q) => `https://www.kuaishou.com/search/video?searchQuery=${encodeURIComponent(q)}` },
];

/** 搜索词 → 当前引擎的搜索 URL（百度主用） */
export function searchEngineUrl(query: string, engine: SearchEngineId = 'baidu'): string {
  const e = SEARCH_ENGINES.find((x) => x.id === engine) ?? SEARCH_ENGINES[0];
  return e.build(query);
}

/* ---------------- 持久化（悬浮球记忆 + 窗口位置 + 引擎偏好） ---------------- */

const STATE_KEY = 'ai-browser-state-v2';

interface PersistedState {
  page: AIBrowserPage | null;
  mode: AIBrowserMode;
  engine: SearchEngineId;
  /** 小窗位置（归一化 0~1：x 左、y 顶；null = 默认右下） */
  winPos: { x: number; y: number } | null;
  /** 悬浮球位置（归一化 y） */
  ballPos: { y: number } | null;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Partial<PersistedState>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function persist(patch: Partial<PersistedState>): void {
  try {
    const cur = { ...loadPersisted(), ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(cur));
  } catch {
    /* 存储不可用时静默 */
  }
}

/* ---------------- 悬浮球位置（旧键兼容读取） ---------------- */

const BALL_POS_KEY = 'ai-browser-ball-pos';

export interface BallPos {
  y: number;
}

export function loadBallPos(): BallPos | null {
  const p = loadPersisted();
  if (p.ballPos && typeof p.ballPos.y === 'number') return p.ballPos;
  try {
    const raw = localStorage.getItem(BALL_POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { y?: unknown };
    if (typeof v.y === 'number' && v.y > 0 && v.y < 1) return { y: v.y };
  } catch {
    /* 静默 */
  }
  return null;
}

export function saveBallPos(p: BallPos): void {
  persist({ ballPos: p });
}

/** 悬浮球是否该显示（机主需求：AI 浏览器用过之后/窗口开着才出现；首次未用不显示） */
export function isBrowserUsed(): boolean {
  const p = loadPersisted();
  return Boolean(p.page?.url);
}

interface AIBrowserState {
  /** 窗口是否展开 */
  open: boolean;
  /** 唤起来源 */
  origin: 'ai' | 'ball' | 'link' | 'user';
  mode: AIBrowserMode;
  page: AIBrowserPage | null;
  /** 搜索引擎（百度主用，可切） */
  engine: SearchEngineId;
  /** 引擎选择弹层开关（工具栏里的引擎名按钮） */
  enginePickerOpen: boolean;
  /** 历史栈（简单字符串数组；后退即 pop） */
  history: string[];
  /** AI 高亮文本（阅读模式点亮；每次设置带递增 seq 触发重渲染） */
  highlight: { text: string; seq: number } | null;
  /** 阅读模式加载中 */
  reading: boolean;
  /** 小窗位置（归一化 x/y；null = 默认右下角） */
  winPos: { x: number; y: number } | null;
  /** 浏览器被用过（控制悬浮球出现） */
  used: boolean;
  openPanel: (opts?: { url?: string; query?: string; origin?: 'ai' | 'ball' | 'link' | 'user'; mode?: AIBrowserMode }) => void;
  closePanel: () => void;
  setMode: (m: AIBrowserMode) => void;
  setEngine: (e: SearchEngineId) => void;
  setEnginePicker: (open: boolean) => void;
  /** 加载完成回填（fetchRead 结果写入 page；进 history 栈） */
  setPage: (p: AIBrowserPage) => void;
  setLoading: (v: boolean) => void;
  /** AI 高亮（工具调用写入；窗口阅读模式消费） */
  requestHighlight: (text: string) => void;
  clearHighlight: () => void;
  goBack: () => string | null;
  setWinPos: (p: { x: number; y: number }) => void;
}

const boot = loadPersisted();

export const useAIBrowser = create<AIBrowserState>()((set, get) => ({
  open: false,
  origin: 'user',
  mode: boot.mode === 'reader' ? 'reader' : 'web',
  page: boot.page ?? null,
  engine: boot.engine ?? 'baidu',
  enginePickerOpen: false,
  history: boot.page?.url ? [boot.page.url] : [],
  highlight: null,
  reading: false,
  winPos: boot.winPos ?? null,
  used: Boolean(boot.page?.url),
  openPanel: (opts) => {
    const url = opts?.url || (opts?.query ? searchEngineUrl(opts.query, get().engine) : '');
    const prev = get().page?.url;
    set((s) => ({
      open: true,
      origin: opts?.origin ?? 'user',
      mode: opts?.mode ?? s.mode,
      ...(url && url !== prev
        ? {
            page: { url, title: '', desc: '', favicon: '', text: '', readAt: 0, truncated: false },
            history: [...s.history.filter((h) => h !== url), url].slice(-20),
            used: true,
          }
        : {}),
    }));
    const after = get();
    persist({ page: after.page, mode: after.mode, engine: after.engine });
  },
  closePanel: () => set({ open: false, enginePickerOpen: false }),
  setMode: (m) => {
    set({ mode: m });
    persist({ mode: m });
  },
  setEngine: (e) => {
    set({ engine: e, enginePickerOpen: false });
    persist({ engine: e });
  },
  setEnginePicker: (open) => set({ enginePickerOpen: open }),
  setPage: (p) => {
    set((s) => ({ page: p, used: true, history: s.history.includes(p.url) ? s.history : [...s.history, p.url].slice(-20) }));
    persist({ page: p });
  },
  setLoading: (v) => set({ reading: v }),
  requestHighlight: (text) => set((s) => ({ highlight: { text, seq: (s.highlight?.seq ?? 0) + 1 } })),
  clearHighlight: () => set({ highlight: null }),
  goBack: () => {
    const { history, page } = get();
    if (history.length < 2 || !page) return null;
    const rest = history.slice(0, -1);
    const url = rest[rest.length - 1];
    set({
      history: rest,
      page: { url, title: '', desc: '', favicon: '', text: '', readAt: 0, truncated: false },
      highlight: null,
    });
    persist({ page: get().page });
    return url;
  },
  setWinPos: (p) => {
    set({ winPos: p });
    persist({ winPos: p });
  },
}));

/** 非组件入口（工具执行器/聊天链路调用）：唤起 AI 浏览器小窗 */
export function openAIBrowser(opts?: {
  url?: string;
  query?: string;
  origin?: 'ai' | 'ball' | 'link' | 'user';
  mode?: AIBrowserMode;
}) {
  useAIBrowser.getState().openPanel(opts);
}

/** 非组件入口：AI 高亮网页文本（阅读模式点亮） */
export function highlightAIBrowserText(text: string) {
  useAIBrowser.getState().requestHighlight(text);
}

/** 非组件入口：当前窗口状态快照（system prompt 注入「AI 感知浏览器加载位置」用） */
export function aiBrowserSnapshot(): { open: boolean; url: string; title: string; mode: AIBrowserMode } | null {
  const s = useAIBrowser.getState();
  if (!s.open || !s.page) return null;
  return { open: true, url: s.page.url, title: s.page.title, mode: s.mode };
}
