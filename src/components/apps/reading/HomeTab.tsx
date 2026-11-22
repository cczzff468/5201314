'use client';

/**
 * 首页 Tab（下拉刷新 + 无限加载）：
 * - 搜索胶囊 + 分类胶囊（搜索框下方）+ 继续阅读卡 + 书架推荐横滑 + 各分类精选横滑
 * - 「为你推荐」无限信息流：滚动到底自动追加（精选书池轮转洗牌，永远刷不完）
 * - 下拉刷新：顶部 iOS 风格指示器；重拉继续阅读 + 重洗信息流 + 补齐封面
 * - 全部书籍显示真实封面（服务端 FeaturedCover 永久缓存，后台自动补齐）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Clock3, ChevronRight, RefreshCw, Loader2, Sparkles, Trophy, ChevronLeft } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { useUI } from '@/lib/ios/store';
import {
  FEATURED,
  CoverPlaceholder,
  SB_H,
  featuredCategoryOf,
  useFeaturedCovers,
  recommendBooks,
  themeOf,
  type FeaturedBook,
  type ReadHistoryItem,
} from './shared';

const CATEGORIES = Object.keys(FEATURED);

/** 确定性洗牌（seed 变 → 顺序变；同 seed 稳定） */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = (seed * 2654435761) % 4294967296;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function HomeTab({
  onSearch,
  onOpenCategory,
  onOpenShelfBook,
  onOpenRank,
}: {
  onSearch: (kw?: string) => void;
  onOpenCategory: (category: string) => void;
  onOpenShelfBook: (b: ReadHistoryItem) => void;
  /** 排行榜入口 */
  onOpenRank: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const closeApp = useUI((s) => s.closeApp);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  /** 继续阅读：优先阅读历史；历史空则兜底书架（全部历史留存供偏好分析） */
  const [recent, setRecent] = useState<ReadHistoryItem | null>(null);
  const [reads, setReads] = useState<ReadHistoryItem[]>([]);
  const loadRecent = useCallback(() => {
    api_readlog()
      .then((d) => {
        setReads(d.reads || []);
        setRecent(d.reads[0] || null);
      })
      .catch(() => {
        setReads([]);
        setRecent(null);
      });
  }, []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // ------------------------------------------------------------------
  // 无限信息流：精选书池（全分类去重合并）→ 洗牌轮转 → 12 本一批追加
  // ------------------------------------------------------------------
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const arr: FeaturedBook[] = [];
    for (const cat of CATEGORIES)
      for (const b of FEATURED[cat]) {
        if (!seen.has(b.name)) {
          seen.add(b.name);
          arr.push(b);
        }
      }
    return arr;
  }, []);

  /** 无限流刷新 tick（下拉刷新 +1 → 重洗信息流） */
  const [feedTick, setFeedTick] = useState(0);

  /** 阅读偏好：书架（在架×2）+ 历史读过（×1）→ 分类权重（读玄幻多就多推玄幻） */
  const catAffinity = useMemo(() => {
    const w = new Map<string, number>();
    const add = (name: string, weight: number) => {
      const cat = featuredCategoryOf(name);
      if (cat) w.set(cat, (w.get(cat) || 0) + weight);
    };
    for (const b of shelf) add(b.name, 2);
    for (const r of reads) add(r.name, 1);
    return w;
  }, [shelf, reads]);

  /** 个性化推荐池：有偏好时各分类独立洗牌 → 组内序号 / 分类权重 → 加权交错排序
   *  （偏好分类密度更高但与其它分类交错，不会整段同分类刷屏）；无偏好纯洗牌 */
  const poolOrdered = useMemo(() => {
    if (!catAffinity.size) return seededShuffle(pool, feedTick + 1);
    const seen = new Set<string>();
    const flat: { b: FeaturedBook; key: number }[] = [];
    CATEGORIES.forEach((cat, ci) => {
      const w = catAffinity.get(cat) || 0;
      seededShuffle(FEATURED[cat] || [], feedTick + ci + 1).forEach((b, i) => {
        if (seen.has(b.name)) return;
        seen.add(b.name);
        flat.push({ b, key: i / (1 + w * 0.8) + ((i % 7) * 0.001) });
      });
    });
    flat.sort((x, y) => x.key - y.key);
    return flat.map((x) => x.b);
    // catAffinity 变化时重排（读书行为变化 → 推荐跟着变）
  }, [pool, catAffinity, feedTick]);

  const orderRef = useRef<FeaturedBook[]>([]);
  const cursorRef = useRef(0);
  const roundRef = useRef(0);
  const [feed, setFeed] = useState<FeaturedBook[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const rebuildFeed = useCallback(() => {
    orderRef.current = [...poolOrdered];
    roundRef.current = 1;
    cursorRef.current = 12;
    setFeed(orderRef.current.slice(0, 12));
  }, [poolOrdered]);
  // 初始 + 刷新 tick 变化时重建
  useEffect(() => {
    rebuildFeed();
  }, [rebuildFeed]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setTimeout(() => {
      const order = orderRef.current;
      if (cursorRef.current >= order.length) {
        // 一轮刷完 → 换 seed 再洗一轮接着刷（真·无限）
        roundRef.current += 1;
        orderRef.current = [...order, ...seededShuffle(poolOrdered, feedTick + roundRef.current * 97)];
      }
      const next = cursorRef.current + 12;
      setFeed(orderRef.current.slice(0, next));
      cursorRef.current = next;
      setLoadingMore(false);
    }, 120);
  }, [poolOrdered, feedTick]);

  // ------------------------------------------------------------------
  // 封面（服务端缓存；feed / 推荐增量补齐；图片加载失败自动换地址重试一次）
  // ------------------------------------------------------------------
  /** 基于书架的相似书推荐（同作者 > 书名相似 > 同分类；空书架不显示） */
  const recForYou = useMemo(
    () =>
      shelf.length
        ? recommendBooks(
            shelf.slice(0, 12).map((b) => ({ name: b.name, author: b.author })),
            shelf.map((b) => b.name),
            8,
          )
        : [],
    [shelf],
  );
  const coverNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of CATEGORIES.slice(1)) for (const b of FEATURED[c].slice(0, 6)) names.add(b.name);
    for (const b of feed) names.add(b.name);
    // 书架推荐的书名也要请求（否则该板块永远占位图）
    for (const b of recForYou) names.add(b.name);
    return [...names];
  }, [feed, recForYou]);
  const { covers, retry: retryCover } = useFeaturedCovers(coverNames);
  /** 加载失败的封面地址集合（按地址记：服务端重试换新地址后自动重新展示；同地址二次失败回退渐变卡） */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (name: string, url: string) => {
    setCoverFails((s) => new Set(s).add(url));
    retryCover(name); // 服务端删旧缓存换一个封面地址（每本书仅一次）
  };

  // ------------------------------------------------------------------
  // 下拉刷新（iOS 风格：顶部指示器 + 最少 650ms 刷新态）
  // ------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullY0 = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    const t0 = Date.now();
    loadRecent();
    setFeedTick((k) => k + 1);
    Promise.all([
      // 封面缺口再补一轮
      fetch('/api/reading/featured-covers?fill=1&names=' + encodeURIComponent(coverNames.join(','))).catch(() => null),
    ]).finally(() => {
      setTimeout(() => setRefreshing(false), Math.max(0, 650 - (Date.now() - t0)));
    });
  }, [refreshing, loadRecent, coverNames]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing || e.touches.length !== 1) return;
    const el = scrollRef.current;
    if (el && el.scrollTop <= 0) pullY0.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const y0 = pullY0.current;
    if (y0 === null || refreshing || e.touches.length !== 1) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) {
      pullY0.current = null;
      setPull(0);
      return;
    }
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) setPull(Math.min(84, dy * 0.45));
  };
  const onTouchEnd = () => {
    const wasPulling = pullY0.current !== null;
    pullY0.current = null;
    if (refreshing) {
      setPull(0);
      return;
    }
    if (wasPulling && pull >= 56) doRefresh();
    setPull(0);
  };

  // ------------------------------------------------------------------
  // 无限加载：滚动接近底部 480px 时追加一批
  // ------------------------------------------------------------------
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 480) loadMore();
  };

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  /** 封面卡片（真实封面 / 「暂无封面」灰底占位；feed 与横滑通用；加载失败自动换地址重试） */
  const CoverCard = ({ b, subtitle }: { b: FeaturedBook; subtitle?: string }) => {
    const raw = covers[b.name];
    const url = raw && !coverFails.has(raw) ? raw : null;
    return (
      <>
        <div className="relative aspect-[3/4.2] w-full overflow-hidden rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.14)] ring-1 ring-black/5">
          {url ? (
            <img
              key={url}
              src={url}
              alt={`${b.name} 封面`}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => onCoverError(b.name, url)}
            />
          ) : (
            <CoverPlaceholder name={b.name} radius="rounded-xl" className="h-full w-full" />
          )}
          <span className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/25 to-transparent" aria-hidden="true" />
        </div>
        <p className="mt-1.5 truncate text-[13px] font-semibold" style={{ color: theme.textMain }}>
          {b.name}
        </p>
        <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
          {subtitle || b.author}
        </p>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* ============ 顶部固定区（不跟随滚动）：返回键 + 搜索胶囊 + 分类胶囊行 ============ */}
      <div className="shrink-0" style={{ paddingTop: SB_H }}>
        <div className="px-4">
          {/* 顶部行：返回键（回手机主界面）+ 搜索胶囊（点击进搜索页） */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={closeApp}
              aria-label="返回主界面"
              title="返回主界面"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full backdrop-blur-xl transition-transform active:scale-90"
              style={glass}
            >
              <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} style={{ color: theme.textMain }} />
            </button>
            <button
              type="button"
              onClick={() => onSearch()}
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4 text-left backdrop-blur-xl transition-transform active:scale-[0.98]"
              style={glass}
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2.2} style={{ color: theme.textSub }} />
              <span className="truncate text-[15px]" style={{ color: theme.textSub }}>
                搜索书名、作者…
              </span>
            </button>
          </div>
          {/* 分类胶囊 + 排行榜入口（搜索框下方；点击进入分类浏览页；iOS 式单行横滑，无滚动条） */}
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            <button
              type="button"
              onClick={onOpenRank}
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium backdrop-blur-xl active:scale-95"
              style={{ ...glass, color: '#E0A13A', boxShadow: `inset 0 0 0 1px rgba(224,161,58,0.35)` }}
            >
              <Trophy className="h-3.5 w-3.5" strokeWidth={2.4} /> 排行榜
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onOpenCategory(c)}
                className="h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-medium backdrop-blur-xl active:scale-95"
                style={
                  c === '热门'
                    ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 4px 14px ${theme.accent}44`, color: '#fff' }
                    : { ...glass, color: theme.textMain }
                }
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ============ 滚动区（下拉刷新 + 无限加载） ============ */}
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[130px]"
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* 下拉刷新指示器（滚动区顶部居中；跟随拉动位移 / 刷新时旋转） */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1 z-20 flex justify-center"
          style={{ transform: `translateY(${pull}px)`, opacity: pull > 4 || refreshing ? 1 : 0, transition: pull ? 'none' : 'transform 0.25s ease, opacity 0.25s ease' }}
          aria-hidden="true"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-xl"
            style={{ background: theme.barBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 4px 14px rgba(0,0,0,0.08)` }}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
            ) : (
              <RefreshCw className="h-4 w-4" style={{ color: pull >= 56 ? theme.accent : theme.textSub, transform: `rotate(${Math.min(180, pull * 2.4)}deg)` }} />
            )}
          </span>
        </div>

        <div className="px-4">
          {/* 继续阅读 */}
          {recent && (
            <button
              type="button"
              onClick={() => onOpenShelfBook(recent)}
              className="mt-4 flex w-full items-center gap-3 rounded-3xl p-3.5 text-left backdrop-blur-xl active:scale-[0.99]"
              style={glass}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                style={{ background: theme.accentSoft, color: theme.accent }}
              >
                <Clock3 className="h-5 w-5" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold" style={{ color: theme.textMain }}>
                  {recent.name}
                </p>
                <p className="mt-0.5 truncate text-[12px]" style={{ color: theme.textSub }}>
                  读到 {recent.lastReadChapter + 1}/{recent.totalChapters} 章 · {recent.lastChapterTitle || ''}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0" style={{ color: theme.textSub }} />
            </button>
          )}

          {/* 基于书架的相似书推荐 */}
          {recForYou.length > 0 && (
            <section className="mt-5">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[17px] font-bold" style={{ color: theme.textMain }}>
                  根据书架推荐
                </h2>
              </div>
              {/* 横向滚动封面卡（原来的横向滚动；no-scrollbar 无滚动条） */}
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
                {recForYou.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => onSearch(b.name)}
                    className="w-[86px] shrink-0 text-left active:scale-95"
                  >
                    <CoverCard b={{ name: b.name, author: b.author, tag: b.tag }} subtitle={b.reason} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 分类精选（真实封面；「全部」进分类页） */}
          {CATEGORIES.slice(1).map((cat) => (
            <section key={cat} className="mt-5">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[17px] font-bold" style={{ color: theme.textMain }}>
                  {cat}精选
                </h2>
                <button
                  type="button"
                  onClick={() => onOpenCategory(cat)}
                  className="text-[12px] font-medium"
                  style={{ color: theme.accent }}
                >
                  全部 ›
                </button>
              </div>
              {/* 横向滚动封面卡（原来的横向滚动；no-scrollbar 无滚动条） */}
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
                {FEATURED[cat].slice(0, 6).map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => onSearch(b.name)}
                    className="w-[86px] shrink-0 text-left active:scale-95"
                  >
                    <CoverCard b={b} />
                  </button>
                ))}
              </div>
            </section>
          ))}

          {/* 为你推荐 · 无限信息流（滚动到底自动加载；有阅读历史时按偏好加权排序） */}
          <section className="mt-6">
            <div className="mb-2.5 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" style={{ color: theme.accent }} />
              <h2 className="text-[17px] font-bold" style={{ color: theme.textMain }}>
                为你推荐
              </h2>
              {catAffinity.size > 0 && (
                <span
                  className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: theme.accentSoft, color: theme.accent }}
                >
                  已按阅读偏好排序
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              {feed.map((b, i) => (
                <button
                  key={`${b.name}-${i}`}
                  type="button"
                  onClick={() => onSearch(b.name)}
                  className="text-left transition-transform active:scale-95"
                >
                  <CoverCard b={b} />
                </button>
              ))}
            </div>
            {/* 底部加载提示 */}
            <div className="flex items-center justify-center gap-2 py-4">
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
                  <span className="text-[12px]" style={{ color: theme.textSub }}>
                    正在加载更多…
                  </span>
                </>
              ) : (
                <span className="text-[11px]" style={{ color: theme.textSub }}>
                  下滑加载更多好书
                </span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 阅读历史（拉继续阅读用；薄封装避免顶层 import 循环） */
async function api_readlog(): Promise<{ reads: ReadHistoryItem[] }> {
  const r = await fetch('/api/reading/readlog');
  const d = (await r.json()) as { reads?: ReadHistoryItem[] };
  return { reads: d.reads || [] };
}
