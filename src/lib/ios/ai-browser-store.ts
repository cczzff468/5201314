'use client';

/**
 * AI 专属分屏浏览器（全局共享 store）。
 *
 * 「AI 系统感知工具包 + AI 专属分屏浏览器」配套（第二十九轮）：
 * - 底部半屏分屏面板（上半屏聊天保持可见可互动、下半屏内置浏览器）；
 * - 屏幕侧边常驻「浏览器悬浮球」，点击随时唤起；
 * - AI 工具（openWebBrowser / searchWeb）与非组件代码经 openAIBrowser() 唤起面板。
 *
 * 状态口径（与 chat-float-store 同款 zustand 全局单例范式）：
 * - mode：'web' = iframe 直接加载（保真浏览）；'reader' = 阅读模式（服务端抽取的纯正文，
 *   可被 AI 高亮工具点亮——跨域 iframe 无法注入脚本，阅读模式是高亮的落地载体）
 * - page：当前加载页（url + 抽取的标题/摘要/正文 + favicon）
 * - highlight：AI 高亮指令（阅读模式滚动到首个匹配段并点亮；null = 无）
 * - origin：谁唤起的（'ai' = 工具调用自动弹 / 'ball' = 悬浮球 / 'link' = 聊天卡片点击 /
 *   'user' = 搜索框），供「AI 感知网页加载位置」的 system prompt 注入描述来源
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

/** 悬浮球位置（归一化 y：0=壳顶 1=壳底；localStorage 持久化） */
export interface BallPos {
  y: number;
}

const BALL_POS_KEY = 'ai-browser-ball-pos';

export function loadBallPos(): BallPos | null {
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
  try {
    localStorage.setItem(BALL_POS_KEY, JSON.stringify(p));
  } catch {
    /* 存储不可用时静默 */
  }
}

interface AIBrowserState {
  /** 面板是否展开（悬浮球常驻，与面板开合独立） */
  open: boolean;
  /** 唤起来源 */
  origin: 'ai' | 'ball' | 'link' | 'user';
  mode: AIBrowserMode;
  page: AIBrowserPage | null;
  /** 历史栈（简单字符串数组；后退即 pop） */
  history: string[];
  /** AI 高亮文本（阅读模式点亮；每次设置带递增 seq 触发重渲染） */
  highlight: { text: string; seq: number } | null;
  /** 阅读模式加载中 */
  reading: boolean;
  openPanel: (opts?: { url?: string; query?: string; origin?: 'ai' | 'ball' | 'link' | 'user'; mode?: AIBrowserMode }) => void;
  closePanel: () => void;
  setMode: (m: AIBrowserMode) => void;
  /** 加载完成回填（fetchRead 结果写入 page；进 history 栈） */
  setPage: (p: AIBrowserPage) => void;
  setLoading: (v: boolean) => void;
  /** AI 高亮（工具调用写入；面板阅读模式消费） */
  requestHighlight: (text: string) => void;
  clearHighlight: () => void;
  goBack: () => string | null;
}

/** 搜索词 → 搜索引擎 URL（与浏览器 App 同款 bing 移动版，iframe 友好度最高） */
export function searchEngineUrl(query: string): string {
  const q = encodeURIComponent(query);
  return `https://www.bing.com/search?q=${q}&form=QBLH`;
}

export const useAIBrowser = create<AIBrowserState>()((set, get) => ({
  open: false,
  origin: 'user',
  mode: 'web',
  page: null,
  history: [],
  highlight: null,
  reading: false,
  openPanel: (opts) => {
    const url = opts?.url || (opts?.query ? searchEngineUrl(opts.query) : '');
    const prev = get().page?.url;
    set((s) => ({
      open: true,
      origin: opts?.origin ?? 'user',
      mode: opts?.mode ?? 'web',
      ...(url && url !== prev
        ? {
            page: { url, title: '', desc: '', favicon: '', text: '', readAt: 0, truncated: false },
            history: [...s.history.filter((h) => h !== url), url].slice(-20),
          }
        : {}),
    }));
  },
  closePanel: () => set({ open: false }),
  setMode: (m) => set({ mode: m }),
  setPage: (p) => set((s) => ({ page: p, history: s.history.includes(p.url) ? s.history : [...s.history, p.url].slice(-20) })),
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
    return url;
  },
}));

/** 非组件入口（工具执行器/聊天链路调用）：唤起分屏浏览器 */
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

/** 非组件入口：当前面板状态快照（system prompt 注入「AI 感知浏览器加载位置」用） */
export function aiBrowserSnapshot(): { open: boolean; url: string; title: string; mode: AIBrowserMode } | null {
  const s = useAIBrowser.getState();
  if (!s.open || !s.page) return null;
  return { open: true, url: s.page.url, title: s.page.title, mode: s.mode };
}
