'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  Globe,
  House,
  Info,
  Loader2,
  Lock,
  PawPrint,
  RotateCw,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BackToHome } from '@/components/ios/BackToHome';
import { useUI } from '@/lib/ios/store';

/** localStorage 键：记住上次选择的搜索引擎 */
const ENGINE_STORAGE_KEY = 'ios-browser-engine';
/** #28：书签数据 localStorage 键（书签数组：{name, url, createdAt}） */
const BOOKMARKS_KEY = 'ios-browser-bookmarks';
/** iframe 加载超时：超过仍未触发 onLoad 则提示可能被禁止内嵌 */
const LOAD_TIMEOUT_MS = 6000;

const ENGINES = [
  { id: 'baidu', name: '百度', search: 'https://www.baidu.com/s?wd=' },
  { id: 'sogou', name: '搜狗', search: 'https://www.sogou.com/web?query=' },
  { id: 'bing', name: '必应', search: 'https://www.bing.com/search?q=' },
] as const;

type EngineId = (typeof ENGINES)[number]['id'];

/** #28：书签记录（localStorage 持久化） */
interface Bookmark {
  url: string;
  name: string;
  createdAt: number;
}

function readBookmarks(): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (b): b is Bookmark =>
          typeof b === 'object' && b !== null && typeof (b as Bookmark).url === 'string' && typeof (b as Bookmark).name === 'string'
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function writeBookmarks(list: Bookmark[]): void {
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 从 URL 提取显示名（主机名去掉 www.；非法 URL 返回原字符串） */
function bookmarkNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

const QUICK_LINKS: { name: string; host: string; icon: LucideIcon }[] = [
  { name: '维基百科', host: 'zh.wikipedia.org', icon: BookOpen },
  { name: '必应', host: 'www.bing.com', icon: Globe },
  { name: '百度', host: 'www.baidu.com', icon: PawPrint },
  { name: '搜狗', host: 'www.sogou.com', icon: Search },
];

/**
 * 自有历史栈：iframe 跨域无法操控其内部 history，
 * 后退/前进 = 移动栈指针并重设 iframe src（key 变化强制重载）。index = -1 表示主页视图。
 */
interface HistoryState {
  urls: string[];
  index: number;
}

function readStoredEngine(): EngineId {
  if (typeof window === 'undefined') return 'baidu';
  try {
    const raw = window.localStorage.getItem(ENGINE_STORAGE_KEY);
    if (raw === 'baidu' || raw === 'sogou' || raw === 'bing') return raw;
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return 'baidu';
}

/** 刷新时给 URL 附加时间戳参数，避免命中缓存（key 变化同时强制重挂载 iframe） */
function withCacheBust(url: string, nonce: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('_ts', String(nonce));
    return parsed.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}_ts=${nonce}`;
  }
}

/**
 * 输入解析：
 * - 含空格或不含 '.' → 用当前搜索引擎搜索
 * - 已带 http/https → 直接使用
 * - 带其他协议（javascript: / data: 等）→ 返回 null 忽略（安全）
 * - 其余（含 '.' 且无空格）→ 补 https://
 */
function resolveTarget(raw: string, engine: EngineId): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (/\s/.test(text) || !text.includes('.')) {
    const base = ENGINES.find((item) => item.id === engine)?.search ?? ENGINES[0].search;
    return base + encodeURIComponent(text);
  }
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return null;
  return `https://${text}`;
}

/** 主页视图：线性黑白灰罗盘 + 线性图标磁贴 + 提示卡（入场阶梯动画） */
function HomeView({ onNavigate }: { onNavigate: (url: string) => void }) {
  return (
    <div className="thin-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-6 pb-8 pt-14">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
        className="flex flex-col items-center gap-3.5"
      >
        <div className="flex h-[64px] w-[64px] items-center justify-center rounded-[22%] bg-white/60 shadow-[0_10px_24px_-14px_rgba(17,24,39,0.25)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <Compass className="h-8 w-8 text-foreground/75" strokeWidth={1.4} aria-hidden="true" />
        </div>
        <div className="text-[28px] font-bold tracking-tight">浏览器</div>
        <div className="text-[13px] text-muted-foreground">搜索或输入网址，开始畅游网络</div>
      </motion.div>

      <motion.nav
        aria-label="快速访问"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
        className="mt-9 w-full max-w-[320px]"
      >
        <p className="mb-3 px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">快速访问</p>
        <div className="grid grid-cols-4 gap-3">
          {QUICK_LINKS.map((link) => (
            <button
              key={link.host}
              type="button"
              onClick={() => onNavigate(`https://${link.host}`)}
              className="flex min-h-[44px] flex-col items-center gap-1.5 rounded-[12px] transition-transform active:scale-95"
            >
              <span
                aria-hidden="true"
                className="flex h-[54px] w-[54px] items-center justify-center rounded-[16px] bg-white/60 shadow-[0_6px_14px_-8px_rgba(17,24,39,0.18)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]"
              >
                <link.icon className="h-[22px] w-[22px] text-foreground/70" strokeWidth={1.6} />
              </span>
              <span className="max-w-full truncate text-[11px] text-foreground">{link.name}</span>
            </button>
          ))}
        </div>
      </motion.nav>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.16, duration: 0.45 }}
        className="mt-8 flex w-full max-w-[340px] items-start gap-2.5 rounded-[14px] bg-white/60 p-3.5 text-[12px] leading-relaxed text-muted-foreground shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]"
      >
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span>提示：部分网站（如百度/搜狗）为防钓鱼禁止内嵌显示，页面空白时请点击底部『新窗口』按钮打开。</span>
      </motion.div>
    </div>
  );
}

/** 底部工具栏按钮：线性黑白灰风格——可用时前景色（深浅主题自适应），禁用态灰 */
function ToolButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-[opacity,transform] duration-150 active:scale-90 active:opacity-50 ${
        disabled ? 'text-foreground/35' : 'text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

/** 内置浏览器 App（仿 iOS Safari 简化版） */
export default function BrowserApp() {
  // 跨 App 跳转：微信搜索页点网络结果 → setPendingBrowserUrl(url) + switchToApp('browser')。
  // 本 App 每次打开都重新挂载（AppWindow 不保活），在此初始化器里直接消费 pending URL 并作为首屏历史，
  // 无需 effect（也避免在 effect 体内同步 setState）。
  const [history, setHistory] = useState<HistoryState>(() => {
    const pending = useUI.getState().pendingBrowserUrl;
    if (pending && /^https?:\/\//i.test(pending)) {
      useUI.getState().setPendingBrowserUrl(null);
      return { urls: [pending], index: 0 };
    }
    return { urls: [], index: -1 };
  });
  const [engine, setEngine] = useState<EngineId>(readStoredEngine);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [nonce, setNonce] = useState(0);
  // #28：书签面板 + 书签列表
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  /** 标记当前 iframe 是否已触发 onLoad（供超时检测读取） */
  const loadedRef = useRef(false);

  const currentUrl = history.index >= 0 ? (history.urls[history.index] ?? null) : null;
  const displayValue = currentUrl ?? '';
  const srcUrl = currentUrl ? (nonce > 0 ? withCacheBust(currentUrl, nonce) : currentUrl) : null;

  /** 任意导航 / 刷新前的公共动作 */
  const startLoad = () => {
    setLoading(true);
    setBlocked(false);
  };

  /** 刷新：重设 iframe key（时间戳参数避免缓存） */
  const refresh = () => {
    if (!currentUrl) return;
    setNonce(Date.now());
    startLoad();
  };

  /** 入栈导航：截断当前指针之后的记录再压入 */
  const navigate = (url: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    if (url === currentUrl && history.index >= 0) {
      refresh();
      return;
    }
    setHistory((prev) => {
      const urls = [...prev.urls.slice(0, prev.index + 1), url];
      return { urls, index: urls.length - 1 };
    });
    setNonce(0);
    startLoad();
  };

  const goBack = () => {
    if (history.index <= 0) return;
    setHistory((prev) => ({ ...prev, index: prev.index - 1 }));
    setNonce(0);
    startLoad();
  };

  const goForward = () => {
    if (history.index >= history.urls.length - 1) return;
    setHistory((prev) => ({ ...prev, index: prev.index + 1 }));
    setNonce(0);
    startLoad();
  };

  /** 回主页视图（保留历史栈，前进可回到之前的页面） */
  const goHome = () => {
    if (history.index < 0) return;
    setHistory((prev) => ({ ...prev, index: -1 }));
    setLoading(false);
    setBlocked(false);
  };

  const openInNewWindow = () => {
    if (!currentUrl) return;
    // #28：不再调 window.open 跳出到系统浏览器；同 App 内重新 navigate 当前页（强制刷新一次）
    refresh();
  };

  // #28：书签 CRUD
  const addBookmark = () => {
    if (!currentUrl) return;
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.url !== currentUrl);
      next.unshift({ url: currentUrl, name: bookmarkNameFromUrl(currentUrl), createdAt: Date.now() });
      writeBookmarks(next);
      return next;
    });
  };
  const removeBookmark = (url: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.url !== url);
      writeBookmarks(next);
      return next;
    });
  };
  const openBookmark = (url: string) => {
    setBookmarksOpen(false);
    navigate(url);
  };

  const chooseEngine = (id: EngineId) => {
    setEngine(id);
    try {
      window.localStorage.setItem(ENGINE_STORAGE_KEY, id);
    } catch {
      /* 隐私模式等场景忽略 */
    }
  };

  // ---------------- 地址栏编辑 ----------------

  const startEditing = () => {
    setDraft(displayValue);
    setEditing(true);
    // #87：聚焦时选中全部文本，用户可直接输入新 URL 覆盖原值
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  };

  /** 取消：恢复原值并 blur（onMouseDown preventDefault 防止按钮先于点击被卸载） */
  const cancelEditing = () => {
    setDraft(displayValue);
    setEditing(false);
    inputRef.current?.blur();
  };

  const submitEditing = () => {
    const target = resolveTarget(draft, engine);
    setEditing(false);
    inputRef.current?.blur();
    if (!target) {
      setDraft(displayValue);
      return;
    }
    navigate(target);
  };

  const handleIframeLoad = () => {
    loadedRef.current = true;
    setLoading(false);
    setBlocked(false);
  };

  // 加载超时检测：LOAD_TIMEOUT_MS 内未触发 onLoad → 提示可能禁止内嵌
  useEffect(() => {
    if (!srcUrl) return;
    loadedRef.current = false;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) {
        setLoading(false);
        setBlocked(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [srcUrl]);

  // #28：首次挂载时从 localStorage 载入书签列表
  useEffect(() => {
    setBookmarks(readBookmarks());
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* 顶部地址栏区（54px 为状态栏预留） */}
      <header className="shrink-0 border-b border-white/60 bg-white/60 pt-[54px] shadow-[0_8px_28px_rgba(17,24,39,0.07)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]">
        <div className="flex items-center gap-2 px-4 pt-2">
          <BackToHome className="static! shrink-0" />
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/60 px-3.5 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition-shadow focus-within:ring-2 focus-within:ring-foreground/25 dark:bg-white/[0.08] dark:ring-white/[0.1]">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2.5} aria-hidden="true" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={editing ? draft : displayValue}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={startEditing}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitEditing();
              }}
              placeholder="搜索或输入网站名称"
              aria-label="地址栏"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {/* Safari 风：非编辑态在胶囊内右侧内嵌刷新钮 */}
            {currentUrl && !editing && !loading && (
              <button
                type="button"
                aria-label="刷新页面"
                title="刷新"
                onClick={refresh}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground active:opacity-60"
              >
                <RotateCw className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            )}
          </div>
          {editing && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancelEditing}
              className="shrink-0 text-[15px] text-foreground transition-opacity active:opacity-50"
            >
              取消
            </button>
          )}
        </div>

        {/* 搜索引擎 iOS 分段控件（居中） */}
        <div role="group" aria-label="搜索引擎" className="flex justify-center pb-3 pt-2">
          <div className="flex rounded-full bg-white/60 p-[3px] shadow-sm ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
            {ENGINES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => chooseEngine(item.id)}
                aria-pressed={engine === item.id}
                className={`rounded-full px-4 py-[5px] text-[12px] font-medium leading-none transition-all active:opacity-70 ${
                  engine === item.id
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 内容区 */}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div
            className="absolute inset-x-0 top-0 z-20 h-[2px] animate-pulse bg-foreground/60"
            aria-hidden="true"
          />
        )}
        {blocked && currentUrl && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/60 bg-white/70 px-4 py-2.5 backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.08]">
            <span className="truncate text-[12px] text-muted-foreground">该网站可能禁止内嵌显示</span>
            <button
              type="button"
              onClick={() => window.open(currentUrl, '_blank', 'noopener')}
              className="shrink-0 rounded-full bg-white/60 px-3 py-1 text-[12px] leading-none text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              在新窗口打开
            </button>
          </div>
        )}
        {srcUrl ? (
          <iframe
            key={srcUrl}
            src={srcUrl}
            title="网页内容"
            onLoad={handleIframeLoad}
            referrerPolicy="no-referrer"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <HomeView onNavigate={navigate} />
        )}
      </main>

      {/* 底部工具栏（pb-[12px] 贴近屏幕底部，Home 指示条悬浮其上；均匀五键布局） */}
      <footer className="shrink-0 border-t border-white/60 bg-white/60 pb-[12px] shadow-[0_-12px_32px_-22px_rgba(17,24,39,0.22)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-white/[0.06]">
        <div className="flex h-[62px] items-center justify-between px-9">
          <ToolButton label="后退" onClick={goBack} disabled={history.index <= 0}>
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="前进"
            onClick={goForward}
            disabled={history.index >= history.urls.length - 1}
          >
            <ChevronRight className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton label="刷新" onClick={refresh} disabled={!currentUrl}>
            <RotateCw className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton label="主页" onClick={goHome} disabled={history.index < 0}>
            <House className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton label="书签" onClick={() => setBookmarksOpen(true)}>
            <BookOpen className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
          {/* #28：原“新窗口”调 window.open 跳出本 App，现改为同 App 内重新 navigate 当前页（与刷新等价） */}
          <ToolButton label="重载" onClick={openInNewWindow} disabled={!currentUrl}>
            <ArrowUpRight className="h-6 w-6" strokeWidth={2.2} />
          </ToolButton>
        </div>
      </footer>

      {/* #28：书签面板（同 App 内弹出层） */}
      {bookmarksOpen && (
        <div className="absolute inset-0 z-50 flex flex-col bg-background">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4 pt-[54px]">
            <button
              type="button"
              onClick={() => setBookmarksOpen(false)}
              className="text-[15px] text-foreground active:opacity-60"
            >
              完成
            </button>
            <span className="text-[15px] font-semibold">书签</span>
            <button
              type="button"
              onClick={addBookmark}
              disabled={!currentUrl}
              className={`text-[15px] font-medium active:opacity-60 ${currentUrl ? 'text-[#007aff]' : 'text-muted-foreground/40'}`}
            >
              添加
            </button>
          </div>
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-3">
            {bookmarks.length === 0 ? (
              <div className="flex flex-col items-center gap-3 pt-20 text-muted-foreground">
                <BookOpen className="h-10 w-10 opacity-40" strokeWidth={1.2} />
                <div className="text-[15px] font-medium text-foreground/70">没有书签</div>
                <div className="text-[13px]">在地址栏访问任意页面后点「添加」可收藏</div>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {bookmarks.map((b) => (
                  <li
                    key={b.url}
                    className="flex items-center gap-3 rounded-[14px] bg-white/60 px-3 py-2.5 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]"
                  >
                    <button
                      type="button"
                      onClick={() => openBookmark(b.url)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white/70 ring-1 ring-white/70 dark:bg-white/[0.1] dark:ring-white/[0.1]">
                        <Globe className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] leading-snug text-foreground">{b.name}</span>
                        <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted-foreground">{b.url}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除书签 ${b.name}`}
                      onClick={() => removeBookmark(b.url)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground/70 active:opacity-50"
                    >
                      <X className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
