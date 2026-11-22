'use client';

/**
 * 聚合搜索页：多书源并行搜索、可暂停/继续、结果按书名+作者聚合「N 个源」徽标。
 * - 空态：搜索历史（localStorage，最多 12 条，单条可删/一键清空）+ 热门搜索（精选书单）
 * - 实现：客户端逐源调 POST /api/reading/search（并发4），AbortController 暂停。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Pause, Play, Loader2, Clock3, Flame, Trash2 } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  HOT_SEARCHES,
  api,
  coverSrc,
  CoverPlaceholder,
  themeOf,
  useFeaturedCovers,
  type SearchBookItem,
  type SourceItem,
} from './shared';
import { SubNavBar } from './ReadingApp';

interface Group {
  key: string;
  name: string;
  author: string;
  covers: (SearchBookItem | undefined)[];
  books: SearchBookItem[];
}

function groupKey(b: SearchBookItem) {
  return `${b.name}::${b.author}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// 搜索历史（localStorage，最多 12 条）
// ---------------------------------------------------------------------------
const HISTORY_KEY = 'rd-search-history-v1';
const HISTORY_MAX = 12;

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as unknown;
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_MAX);
  } catch {
    /* 忽略 */
  }
  return [];
}
function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* 忽略 */
  }
}

export function SearchPage({
  page,
  onBack,
  onOpenBook,
}: {
  page: { kind: 'search'; keyword?: string; autoRun?: boolean };
  onBack: () => void;
  onOpenBook: (book: SearchBookItem, sourceId: string) => void;
}) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [kw, setKw] = useState(page.keyword || '');
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(0);
  const [searched, setSearched] = useState(0);
  const [groups, setGroups] = useState<Map<string, Group>>(new Map());
  /** 兼容重命名：groupsMap 即 groups（分区排序时统一读它） */
  const groupsMap = groups;
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SourceItem[]>([]);
  const startedRef = useRef(false);
  /** 搜索历史（惰性初始化：该页仅在客户端导航后渲染，localStorage 可直接读） */
  const [history, setHistory] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadHistory()));

  /** 启用源：实测可用（checkStatus=ok）的排最前——几百源时好源先出结果，死源垫底 */
  const enabledSources = useMemo(
    () =>
      sources
        .filter((s) => s.enabled)
        .sort((a, b) => (a.checkStatus === 'ok' ? 0 : 1) - (b.checkStatus === 'ok' ? 0 : 1)),
    [sources],
  );

  const recordHistory = useCallback((k: string) => {
    const key = k.trim();
    if (!key) return;
    setHistory((prev) => {
      const next = [key, ...prev.filter((x) => x !== key)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }, []);

  const removeHistory = (k: string) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== k);
      saveHistory(next);
      return next;
    });
  };
  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const runSearch = useCallback(
    async (keyword: string) => {
      const k = keyword.trim();
      if (!k || enabledSources.length === 0) return;
      recordHistory(k);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      queueRef.current = [...enabledSources];
      setRunning(true);
      setFound(0);
      setSearched(0);
      setGroups(new Map());
      const queue = queueRef.current;
      const worker = async () => {
        while (queue.length && !ctrl.signal.aborted) {
          const src = queue.shift()!;
          try {
            const r = await api.searchOne(k, src.id, ctrl.signal);
            const books = r.books || [];
            if (books.length) {
              setGroups((prev) => {
                const next = new Map(prev);
                for (const b of books) {
                  const gk = groupKey(b);
                  const g = next.get(gk) || { key: gk, name: b.name, author: b.author, covers: [], books: [] };
                  if (!g.books.some((x) => x.sourceName === b.sourceName)) g.books.push(b);
                  next.set(gk, g);
                }
                return next;
              });
              setFound((n) => n + books.length);
            }
          } catch {
            /* 单源失败/中止静默 */
          }
          setSearched((n) => n + 1);
        }
      };
      void Promise.all(Array.from({ length: Math.min(4, enabledSources.length) }, worker)).then(() => {
        if (!ctrl.signal.aborted) setRunning(false);
      });
    },
    [enabledSources, recordHistory],
  );

  useEffect(() => {
    if (page.autoRun && page.keyword && !startedRef.current) {
      startedRef.current = true;
      void runSearch(page.keyword);
    }
  }, [page.autoRun, page.keyword, runSearch]);

  const pause = () => {
    abortRef.current?.abort();
    queueRef.current = [];
    setRunning(false);
  };
  const resume = () => {
    if (kw.trim()) void runSearch(kw);
  };

  /** 结果排序：精确匹配在前（按书名→源数），相关书籍在后（按源数）——合并为一个列表不再分区标注 */
  const resultList = useMemo(() => {
    const k = kw.trim().replace(/\s+/g, '');
    const groups = [...new Map([...groupsMap.values()].map((g) => [g.key, { ...g, books: [...g.books] }])).values()];
    for (const g of groups) g.books.sort((a, b) => a.sourceName.localeCompare(b.sourceName, 'zh'));
    const exact: typeof groups = [];
    const related: typeof groups = [];
    for (const g of groups) {
      (g.name.replace(/\s+/g, '') === k ? exact : related).push(g);
    }
    exact.sort((a, b) => a.name.localeCompare(b.name, 'zh') || b.books.length - a.books.length);
    related.sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name, 'zh'));
    return [...exact, ...related];
  }, [groupsMap, kw]);

  /* 搜索结果封面（第七轮）：多数书源的搜索接口不返回封面地址——接入精选封面
     服务端缓存（按书名跨源找封面 + 落库永久缓存），结果列表不再只有占位图。
     只拉前 30 组（服务端有补齐退避，名单再多也只会压慢首批） */
  const coverNames = useMemo(() => resultList.slice(0, 30).map((g) => g.name), [resultList]);
  const { covers: hookedCovers, retry: retryCover } = useFeaturedCovers(coverNames);
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  /** 搜索结果封面加载失败（死链/防盗链）→ 回退书脊风占位图，不显示破图图标 */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (url: string, name?: string) => {
    setCoverFails((s) => new Set(s).add(url));
    if (name) retryCover(name); // 挂钩封面失败 → 服务端换地址重搜一次（每本仅一次）
  };

  /** 单个书籍组卡片 */
  const renderGroup = (g: Group) => {
    // 封面优先级：组内第一个带封面的源（书源有封面就用那个封面）> 跨源封面缓存 > 占位图
    const b0 = g.books.find((b) => b.coverUrl) || g.books[0];
    const hooked = hookedCovers[g.name];
    const cover = b0.coverUrl ? coverSrc(b0.coverUrl, b0.sourceId) : hooked && !coverFails.has(hooked) ? hooked : undefined;
    const coverFromHook = !b0.coverUrl && !!hooked;
    return (
      <button
        key={g.key}
        type="button"
        onClick={() => onOpenBook(b0, b0.sourceId || '')}
        className="mb-2.5 flex w-full items-center gap-3 rounded-3xl p-3 text-left backdrop-blur-xl active:scale-[0.99]"
        style={glass}
      >
        {cover && !coverFails.has(cover) ? (
          <img
            src={cover}
            alt=""
            className="h-[68px] w-[50px] shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/5"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => onCoverError(cover, coverFromHook ? g.name : undefined)}
          />
        ) : (
          <CoverPlaceholder name={g.name} author={g.author} className="h-[68px] w-[50px] shrink-0 shadow-sm" radius="rounded-lg" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-bold" style={{ color: theme.textMain }}>
              {g.name}
            </span>
            {g.books.length > 1 && (
              <span
                className="shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: theme.accentSoft, color: theme.accent }}
              >
                {g.books.length} 个源
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px]" style={{ color: theme.textSub }}>
            {g.author || '佚名'}
          </p>
          {b0.intro && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug" style={{ color: theme.textSub }}>
              {b0.intro}
            </p>
          )}
        </div>
      </button>
    );
  };

  const hasResults = resultList.length > 0;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title="聚合搜索" onBack={onBack} theme={theme} />
      {/* 搜索条 */}
      <div className="flex gap-2 px-4 pb-3">
        <div
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4 backdrop-blur-xl"
          style={glass}
        >
          <Search className="h-[18px] w-[18px] shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch(kw);
            }}
            placeholder="书名 / 作者"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: theme.textMain }}
            aria-label="搜索关键词"
          />
          {kw && (
            <button type="button" onClick={() => setKw('')} aria-label="清空" className="shrink-0" style={{ color: theme.textSub }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runSearch(kw)}
          className="h-11 shrink-0 rounded-full px-5 text-[14px] font-semibold text-white shadow-md active:scale-95"
          style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 6px 18px ${theme.accent}44` }}
        >
          搜索
        </button>
      </div>

      {/* 结果列表 / 空态（搜索历史 + 热门搜索）；底部状态胶囊显示时预留空间不遮挡 */}
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${running || searched > 0 ? 'pb-24' : 'pb-10'}`}>
        {/* 搜索历史 */}
        {!running && !hasResults && history.length > 0 && (
          <section className="mt-1">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                <Clock3 className="h-3.5 w-3.5" style={{ color: theme.textSub }} /> 搜索历史
              </p>
              <button type="button" onClick={clearHistory} className="flex items-center gap-1 text-[11px] active:scale-95" style={{ color: theme.textSub }} aria-label="清空搜索历史">
                <Trash2 className="h-3 w-3" /> 清空
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((h) => (
                <span
                  key={h}
                  className="flex items-center gap-1 rounded-full py-1.5 pl-3.5 pr-2 text-[13px] backdrop-blur-xl"
                  style={glass}
                >
                  <button type="button" className="max-w-[180px] truncate active:scale-95" onClick={() => void runSearch(h)} style={{ color: theme.textMain }}>
                    {h}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeHistory(h)}
                    aria-label={`删除历史 ${h}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full active:scale-90"
                    style={{ color: theme.textSub }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 热门搜索 */}
        {!running && !hasResults && (
          <section className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.textMain }}>
              <Flame className="h-3.5 w-3.5" style={{ color: '#F0713A' }} /> 热门搜索
            </p>
            <div className="flex flex-wrap gap-2">
              {HOT_SEARCHES.map((h, i) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => void runSearch(h)}
                  className="flex items-center gap-1.5 rounded-full py-1.5 pl-2.5 pr-3.5 text-[13px] backdrop-blur-xl active:scale-95"
                  style={glass}
                >
                  <span
                    className="flex items-center justify-center rounded-[5px] text-[10px] font-bold"
                    style={{
                      minWidth: 18,
                      height: 18,
                      background: i < 3 ? `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` : theme.accentSoft,
                      color: i < 3 ? '#fff' : theme.textSub,
                    }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: theme.textMain }}>{h}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 搜完无结果提示 */}
        {!running && !hasResults && searched > 0 && (
          <p className="mt-8 text-center text-[13px]" style={{ color: theme.textSub }}>
            没有找到相关书籍，换个关键词试试
          </p>
        )}

        {/* 搜索中骨架 */}
        {running && !hasResults && (
          <div className="mt-2 space-y-2.5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-3xl p-3" style={glass}>
                <div className="h-[68px] w-[50px] shrink-0 animate-pulse rounded-lg" style={{ background: theme.accentSoft }} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-2/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                  <div className="h-3 w-3/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                  <div className="h-3 w-4/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {resultList.map((g) => renderGroup(g))}
      </div>

      {/* 底部状态胶囊（搜索中/暂停后显示；文字不换行：窄屏自动缩短文案） */}
      {(running || searched > 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
          <div
            className="pointer-events-auto flex h-11 max-w-full items-center gap-2.5 whitespace-nowrap rounded-full px-4 backdrop-blur-2xl"
            style={{ background: theme.barBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 8px 24px rgba(0,0,0,0.12)` }}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: theme.accent }} />
                <span className='shrink-0 text-[13px] tabular-nums' style={{ color: theme.textMain }}>
                  {searched}/{enabledSources.length} 源 · {found} 条
                </span>
                <button type="button" onClick={pause} className="flex shrink-0 items-center gap-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                  <Pause className="h-4 w-4" /> 暂停
                </button>
              </>
            ) : (
              <>
                <span className='shrink-0 text-[13px] tabular-nums' style={{ color: theme.textMain }}>
                  已停止 · {found} 条
                </span>
                {searched < enabledSources.length && (
                  <button type="button" onClick={resume} className="flex shrink-0 items-center gap-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                    <Play className="h-4 w-4" /> 继续
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
