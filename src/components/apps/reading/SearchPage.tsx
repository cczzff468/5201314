'use client';

/**
 * 聚合搜索页（多书源共同搜索）：
 * - 顶栏一体化：返回 + 搜索框 + 蓝色「搜索」按钮 + 筛选（搜索范围）图标（无「聚合搜索」标题）
 * - 点击搜索历史 / 热门搜索 → 关键词同步写入搜索框再发起搜索（搜索框始终显示当前书名）
 * - 结果行：封面（72×96 圆角描边）｜书名 + 作者 + 右侧「N 个源」浅蓝徽章
 *   ｜分类小徽章 + 最新章节信息｜简介两行截断（纯数字时间戳标签已过滤）
 * - 多源共同搜索：所有启用源 8 路并发（Promise.allSettled 语义：单源失败静默跳过），
 *   哪个源先返回就先渲染（流式渐进）；顶部状态行「正在搜索中 (已找到 N 个结果)…」
 * - 防卡死：结果分组分批渲染（首屏 20 组，滚动到底追加），数百源返回海量数据不卡 UI
 * - 空态：搜索历史（localStorage，最多 12 条）+ 热门搜索（精选书单）
 * - 筛选：全部启用源 / 仅实测可用源（可用源优先出结果，几百源不用等太久）
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Pause, Play, Loader2, Clock3, Flame, Trash2, ChevronLeft, SlidersHorizontal, Check } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  HOT_SEARCHES,
  SB_H,
  api,
  coverSrc,
  themeOf,
  useFeaturedCovers,
  type SearchBookItem,
  type SourceItem,
} from './shared';

interface Group {
  key: string;
  name: string;
  author: string;
  books: SearchBookItem[];
}

function groupKey(b: SearchBookItem) {
  return `${b.name}::${b.author}`.toLowerCase();
}

// ---------------------------------------------------------------------------
// 搜索状态快照（返回不丢结果）：模块级缓存，跨组件卸载/重挂保留。
// 进入详情页再返回时（SubPage restore 标记）从快照整体恢复，
// 关键词/结果列表/进度/滚动位置都与离开时一模一样。
// ---------------------------------------------------------------------------
interface SearchSnapshot {
  keyword: string;
  groups: [string, Group][];
  found: number;
  searched: number;
  scope: 'all' | 'ok';
  scrollTop: number;
  at: number;
}
let lastSnapshot: SearchSnapshot | null = null;

// ---------------------------------------------------------------------------
// 搜索历史（localStorage，最多 12 条）
// ---------------------------------------------------------------------------
const HISTORY_KEY = 'rd-search-history-v1';
const HISTORY_MAX = 12;
/** 搜索范围偏好：all=全部启用源 ok=仅实测可用源 */
const SCOPE_KEY = 'rd-search-scope-v1';

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

/** 无封面占位（设计图同款）：浅灰圆角块 + 白字「暂无/封面」两行居中 */
function NoCoverBlock({ radius = 'rounded-xl' }: { radius?: string }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-0.5 ${radius}`}
      style={{ background: '#DDE0E7' }}
      aria-label="暂无封面"
    >
      <span
        className="text-[15px] font-bold leading-tight text-white"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.38), 0 0 1px rgba(0,0,0,0.4)' }}
      >
        暂无
      </span>
      <span
        className="text-[15px] font-bold leading-tight text-white"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.38), 0 0 1px rgba(0,0,0,0.4)' }}
      >
        封面
      </span>
    </div>
  );
}

/** 分类徽章（kind 常为「都市:言情」冒号分隔，取前 2 段；时间戳/日期段过滤，如 1597757169、19-04-02） */
function kindTags(kind?: string): string[] {
  if (!kind) return [];
  return kind
    .split(/[:：/、|,，]/)
    .map((x) => x.trim())
    .filter((x) => x && !/^\d+$/.test(x) && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(x))
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// 结果分批渲染（防卡死）：数百源并发返回可能带来几百个分组，一次性渲染会卡 UI；
// 首屏只渲染前 20 组，滚动到底部自动追加下一批。
// ---------------------------------------------------------------------------
const INITIAL_BATCH = 20;
const BATCH_STEP = 20;

export function SearchPage({
  page,
  onBack,
  onOpenBook,
}: {
  page: { kind: 'search'; keyword?: string; autoRun?: boolean; restore?: boolean };
  onBack: () => void;
  onOpenBook: (book: SearchBookItem, sourceId: string) => void;
}) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  /** 返回恢复：优先用快照初始化（关键词/结果/进度/滚动位置）；新搜索从 page.keyword 开始 */
  const restored =
    page.restore && lastSnapshot && lastSnapshot.groups.length > 0 && Date.now() - lastSnapshot.at < 10 * 60_000
      ? lastSnapshot
      : null;
  const [kw, setKw] = useState(restored ? restored.keyword : page.keyword || '');
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(restored ? restored.found : 0);
  const [searched, setSearched] = useState(restored ? restored.searched : 0);
  const [groups, setGroups] = useState<Map<string, Group>>(
    () => (restored ? new Map(restored.groups) : new Map()),
  );
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SourceItem[]>([]);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 滚动位置实时记录（onScroll 写 ref，不触发重渲染；卸载时 ref 已脱挂，从这里取值） */
  const scrollTopRef = useRef(0);
  /** 搜索历史（惰性初始化：该页仅在客户端导航后渲染，localStorage 可直接读） */
  const [history, setHistory] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadHistory()));
  /** 搜索范围（持久化；返回恢复时用快照值） */
  const [scope, setScope] = useState<'all' | 'ok'>(
    restored
      ? restored.scope
      : typeof window === 'undefined'
        ? 'all'
        : localStorage.getItem(SCOPE_KEY) === 'ok'
          ? 'ok'
          : 'all',
  );
  const [scopeOpen, setScopeOpen] = useState(false);

  /** 返回恢复：滚动位置回到离开时的地方 */
  useLayoutEffect(() => {
    if (restored && scrollRef.current) scrollRef.current.scrollTop = restored.scrollTop;
     
  }, []);

  /** 状态变化持续写快照；卸载时（进详情页/离开）补写——拿到离开瞬间的滚动位置 */
  useEffect(() => {
    const save = () => {
      if (!kw.trim() && groups.size === 0) return;
      lastSnapshot = {
        keyword: kw,
        groups: [...groups.entries()],
        found,
        searched,
        scope,
        scrollTop: scrollTopRef.current,
        at: Date.now(),
      };
    };
    save();
    return save;
  }, [kw, groups, found, searched, scope]);

  /** 参与搜索的源：范围筛选（全部启用 / 仅实测可用）+ 可用源排前（好源先出结果） */
  const enabledSources = useMemo(() => {
    const list = scope === 'ok' ? sources.filter((s) => s.enabled && s.checkStatus === 'ok') : sources.filter((s) => s.enabled);
    return [...list].sort((a, b) => (a.checkStatus === 'ok' ? 0 : 1) - (b.checkStatus === 'ok' ? 0 : 1));
  }, [sources, scope]);

  const applyScope = (v: 'all' | 'ok') => {
    setScope(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* 忽略 */
    }
    setScopeOpen(false);
  };

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

  /** 分批渲染状态（提前声明：runSearch 重置用）：首屏 20 组，滚动到底追加 */
  const [shownCount, setShownCount] = useState(INITIAL_BATCH);

  const runSearch = useCallback(
    async (keyword: string) => {
      const k = keyword.trim();
      if (!k || enabledSources.length === 0) return;
      setKw(k); // 关键词同步写入搜索框（点历史/热门/书名卡片时也能看到当前书名）
      recordHistory(k);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      queueRef.current = [...enabledSources];
      setRunning(true);
      setFound(0);
      setSearched(0);
      setGroups(new Map());
      setShownCount(INITIAL_BATCH);
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
                  const g = next.get(gk) || { key: gk, name: b.name, author: b.author, books: [] };
                  if (!g.books.some((x) => x.sourceName === b.sourceName)) g.books.push(b);
                  next.set(gk, g);
                }
                return next;
              });
              setFound((n) => n + books.length);
            }
          } catch {
            /* 单源失败/中止静默（Promise.allSettled 语义：不崩溃不影响其他源） */
          }
          setSearched((n) => n + 1);
        }
      };
      void Promise.all(Array.from({ length: Math.min(8, enabledSources.length) }, worker)).then(() => {
        if (!ctrl.signal.aborted) setRunning(false);
      });
    },
    [enabledSources, recordHistory],
  );

  useEffect(() => {
    if (page.autoRun && page.keyword && !startedRef.current && !restored) {
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

  /** 结果排序：精确匹配在前（按书名→源数），相关书籍在后（按源数） */
  const resultList = useMemo(() => {
    const k = kw.trim().replace(/\s+/g, '');
    const list = [...new Map([...groups.values()].map((g) => [g.key, { ...g, books: [...g.books] }])).values()];
    for (const g of list) g.books.sort((a, b) => a.sourceName.localeCompare(b.sourceName, 'zh'));
    const exact: typeof list = [];
    const related: typeof list = [];
    for (const g of list) {
      (g.name.replace(/\s+/g, '') === k ? exact : related).push(g);
    }
    exact.sort((a, b) => a.name.localeCompare(b.name, 'zh') || b.books.length - a.books.length);
    related.sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name, 'zh'));
    return [...exact, ...related];
  }, [groups, kw]);

  /** 分批渲染：当前可见分组数（滚动到底追加 BATCH_STEP；结果更新时自动扩容保证新结果可见） */
  const visibleList = useMemo(() => resultList.slice(0, shownCount), [resultList, shownCount]);
  const hasMore = resultList.length > shownCount;
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    scrollTopRef.current = el.scrollTop;
    if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      setShownCount((n) => n + BATCH_STEP);
    }
  };

  /* 搜索结果封面：多数书源搜索不返回封面——接入精选封面服务端缓存（按书名跨源找封面） */
  const coverNames = useMemo(() => resultList.slice(0, 30).map((g) => g.name), [resultList]);
  const { covers: hookedCovers, retry: retryCover } = useFeaturedCovers(coverNames);
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  /** 封面加载失败（死链/防盗链）→ 记地址；挂钩封面失败 → 服务端换地址重试一次 */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (url: string, name?: string) => {
    setCoverFails((s) => new Set(s).add(url));
    if (name) retryCover(name);
  };

  /** 单个书籍组卡片（设计图样式） */
  const renderGroup = (g: Group) => {
    // 封面优先级：组内第一个带封面的源 > 跨源封面缓存 > 「暂无封面」占位块
    const b0 = g.books.find((b) => b.coverUrl) || g.books[0];
    const hooked = hookedCovers[g.name];
    const cover = b0.coverUrl ? coverSrc(b0.coverUrl, b0.sourceId) : hooked && !coverFails.has(hooked) ? hooked : undefined;
    const coverFromHook = !b0.coverUrl && !!hooked;
    const tags = kindTags(b0.kind);
    const latest = b0.lastChapter || '';
    return (
      <button
        key={g.key}
        type="button"
        onClick={() => onOpenBook(b0, b0.sourceId || '')}
        className="mb-2.5 flex w-full items-start gap-3 rounded-2xl p-3 text-left backdrop-blur-xl active:scale-[0.99]"
        style={glass}
      >
        {/* 封面：72×96 圆角 + 细描边阴影 */}
        <div className="h-[96px] w-[72px] shrink-0 overflow-hidden rounded-xl shadow-[0_4px_14px_rgba(0,0,0,0.13)] ring-1 ring-black/5">
          {cover && !coverFails.has(cover) ? (
            <img
              src={cover}
              alt={`${g.name} 封面`}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => onCoverError(cover, coverFromHook ? g.name : undefined)}
            />
          ) : (
            <NoCoverBlock />
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          {/* 第一行：书名 + 作者 + 「N 个源」徽章 */}
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 shrink truncate text-[16px] font-bold leading-tight" style={{ color: theme.textMain }}>
              {g.name}
            </span>
            <span className="min-w-0 shrink truncate text-[12px]" style={{ color: theme.textSub }}>
              {g.author || '佚名'}
            </span>
            <span
              className="ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: theme.accentSoft, color: theme.accent }}
            >
              {g.books.length} 个源
            </span>
          </div>
          {/* 第二行：分类徽章 + 最新章节 */}
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="shrink-0 whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: theme.accentSoft, color: theme.accent }}
              >
                {t}
              </span>
            ))}
            {(latest || b0.sourceName) && (
              <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: theme.textSub }}>
                {latest ? `最新 ${latest}` : b0.sourceName}
              </span>
            )}
          </div>
          {/* 第三行：简介两行截断 */}
          {b0.intro && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug" style={{ color: theme.textSub }}>
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
      {/* 顶栏一体化：返回 + 搜索框 + 搜索按钮 + 筛选（无「聚合搜索」标题） */}
      <div className="sticky top-0 z-20 shrink-0 backdrop-blur-xl" style={{ paddingTop: SB_H, background: 'transparent' }}>
        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
            style={{ color: theme.textMain }}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 backdrop-blur-xl"
            style={glass}
          >
            <Search className="h-[17px] w-[17px] shrink-0" style={{ color: theme.textSub }} strokeWidth={2.2} />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch(kw);
              }}
              placeholder="书名 / 作者"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              style={{ color: theme.textMain }}
              aria-label="搜索关键词"
            />
            {kw && (
              <button
                type="button"
                onClick={() => setKw('')}
                aria-label="清空"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full active:scale-90"
                style={{ background: 'rgba(0,0,0,0.08)', color: theme.textSub }}
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void runSearch(kw)}
            className="h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold text-white active:scale-95"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 4px 14px ${theme.accent}40` }}
          >
            搜索
          </button>
          <button
            type="button"
            onClick={() => setScopeOpen(true)}
            aria-label="筛选书源范围"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
            style={{ color: scope === 'ok' ? theme.accent : theme.textMain, ...(scope === 'ok' ? { background: theme.accentSoft } : {}) }}
          >
            <SlidersHorizontal className="h-[19px] w-[19px]" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* 顶部搜索状态行（多源共同搜索进度：哪个源先返回就先展示；不遮挡结果） */}
      {(running || (searched > 0 && found > 0)) && (
        <div className="z-10 flex shrink-0 items-center gap-2 px-4 pb-2 pt-0.5">
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: theme.accent }} />
              <span className="min-w-0 truncate text-[12px] tabular-nums" style={{ color: theme.textSub }}>
                正在搜索中 (已找到 {found} 个结果) · {searched}/{enabledSources.length} 源
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate text-[12px] tabular-nums" style={{ color: theme.textSub }}>
              搜索完成 · 共 {found} 个结果 · {resultList.length} 本书（{resultList.length > 0 ? `平均 ${Math.max(1, Math.round(found / resultList.length))} 个源` : '0 源'}）
            </span>
          )}
        </div>
      )}

      {/* 结果列表 / 空态（搜索历史 + 热门搜索）；底部状态胶囊显示时预留空间不遮挡 */}
      <div
        ref={scrollRef}
        onScroll={onListScroll}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 ${running || searched > 0 ? 'pb-24' : 'pb-10'}`}
      >
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
              <div key={i} className="flex items-start gap-3 rounded-2xl p-3" style={glass}>
                <div className="h-[96px] w-[72px] shrink-0 animate-pulse rounded-xl" style={{ background: theme.accentSoft }} />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <div className="h-4 w-2/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                  <div className="h-3 w-3/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                  <div className="h-3 w-4/5 animate-pulse rounded-full" style={{ background: theme.accentSoft }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {visibleList.map((g) => renderGroup(g))}

        {/* 分批渲染：滚动到底自动追加下一批（防海量数据卡死）；搜索中实时提示已展示数量 */}
        {hasResults && hasMore && (
          <button
            type="button"
            onClick={() => setShownCount((n) => n + BATCH_STEP)}
            className="mx-auto mb-2 mt-1 flex h-9 items-center gap-1.5 rounded-full px-5 text-[12px] font-medium backdrop-blur-xl active:scale-95"
            style={{ ...glass, color: theme.accent }}
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 已展示 {visibleList.length}/{resultList.length} 本，正在接收更多…
              </>
            ) : (
              <>展开更多 · 还有 {resultList.length - visibleList.length} 本</>
            )}
          </button>
        )}
        {hasResults && !hasMore && resultList.length > INITIAL_BATCH && (
          <p className="pb-1 pt-2 text-center text-[11px]" style={{ color: theme.textSub }}>
            已展示全部 {resultList.length} 本书
          </p>
        )}
      </div>

      {/* 搜索范围筛选抽屉（底部玻璃） */}
      {scopeOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="搜索范围">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setScopeOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <p className="mb-3 text-[16px] font-bold" style={{ color: theme.textMain }}>
              搜索范围
            </p>
            {(
              [
                { key: 'all', title: '全部启用源', desc: `${sources.filter((s) => s.enabled).length} 个 · 覆盖最全，耗时较长` },
                { key: 'ok', title: '仅实测可用源', desc: `${sources.filter((s) => s.enabled && s.checkStatus === 'ok').length} 个 · 速度快，好源优先` },
              ] as const
            ).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => applyScope(o.key)}
                className="mb-1.5 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left backdrop-blur-xl active:scale-[0.98]"
                style={{
                  background: scope === o.key ? theme.accentSoft : 'rgba(0,0,0,0.03)',
                  boxShadow: `inset 0 0 0 1px ${scope === o.key ? theme.accent + '44' : 'transparent'}`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold" style={{ color: theme.textMain }}>
                    {o.title}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: theme.textSub }}>
                    {o.desc}
                  </p>
                </div>
                {scope === o.key && <Check className="h-4 w-4 shrink-0" style={{ color: theme.accent }} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 底部状态胶囊（搜索中/暂停后显示；白色磨砂 + 暂停按钮，设计图同款） */}
      {(running || searched > 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
          <div
            className="pointer-events-auto flex h-11 max-w-full items-center gap-2.5 whitespace-nowrap rounded-full px-4 backdrop-blur-2xl"
            style={{ background: theme.barBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 8px 24px rgba(0,0,0,0.12)` }}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: theme.accent }} />
                <span className="shrink-0 text-[13px] tabular-nums" style={{ color: theme.textMain }}>
                  搜索中 {searched}/{enabledSources.length} · {found} 条
                </span>
                <button type="button" onClick={pause} className="flex shrink-0 items-center gap-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                  <Pause className="h-4 w-4" /> 暂停
                </button>
              </>
            ) : (
              <>
                <span className="shrink-0 text-[13px] tabular-nums" style={{ color: theme.textMain }}>
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
