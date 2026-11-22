'use client';

/**
 * 分类浏览页（用户截图同款 · 排行榜式改版）：
 * - 顶部固定区（上下滚动不跟随）：返回键 + 分类名标题（左上角粗体大字，无居中）→
 *   排序筛选胶囊（最热/好评/字数最多/连载中/已完结，横向滚动）→ 搜索框（点击进搜索页）
 * - 单列排行榜列表：左侧大排名数字（1-3 主题色实心、4-9 浅主题色、10+ 灰）+ 封面 +
 *   书名粗体 + 完结/连载小标 + 「作者 · 分类」+ 字数信息行（确定性生成，同书恒定）
 * - 无限更新：本分类书池刷完后接「为你推荐」分隔线，全分类轮转洗牌无限追加
 * - 已按需求移除「N 本」数量标签
 * - 点击书籍直达该书聚合搜索（onOpenBook）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Search, Loader2, Sparkles } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { SB_H } from './shared';
import { FEATURED, coverPaletteOf, useFeaturedCovers, themeOf, type FeaturedBook } from './shared';

/** 排序选项（数组顺序即展示顺序；「最热」= 精选编辑顺序） */
const SORTS = [
  { key: 'hot', label: '最热' },
  { key: 'rating', label: '好评' },
  { key: 'words', label: '字数最多' },
  { key: 'ongoing', label: '连载中' },
  { key: 'done', label: '已完结' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

/** 列表条目（分类书 + 确定性生成的指标） */
interface Row {
  b: FeaturedBook;
  /** 字数（万字，确定性） */
  words: number;
  /** 评分（确定性） */
  rating: number;
  /** 是否来自推荐区（本分类刷完后的无限流补充） */
  rec?: boolean;
}

/** 书名 → 稳定正整数哈希（同一本书永远同值，刷新/换端一致） */
function hashOf(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return h;
}
/** 确定性字数（万字）：80 ~ 860 */
function wordsOf(name: string): number {
  const h = hashOf(name);
  return 80 + (h % 781);
}
/** 确定性评分：8.0 ~ 9.9 */
function ratingOf(name: string): number {
  const h = hashOf(name + '~r');
  return 8.0 + (h % 20) / 10;
}

/** 确定性洗牌（seed 变 → 顺序变；同 seed 稳定；与首页同款算法） */
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

const BATCH = 15;

export function CategoryPage({
  category,
  onBack,
  onOpenBook,
  onSearch,
}: {
  category: string;
  onBack: () => void;
  onOpenBook: (name: string, author: string) => void;
  /** 点击搜索框 → 进入聚合搜索页 */
  onSearch: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  /** 本分类精选书（未知分类兜底空数组 → 走空态） */
  const books = useMemo(() => FEATURED[category] || [], [category]);

  /** 排序（不持久化：父级按分类 key 重挂载，切页/切分类自动回「最热」） */
  const [sort, setSort] = useState<SortKey>('hot');

  /** 本分类行（含确定性指标；按排序键重排） */
  const catRows = useMemo<Row[]>(() => {
    const rows: Row[] = books.map((b) => ({ b, words: wordsOf(b.name), rating: ratingOf(b.name) }));
    const key = (r: Row) => hashOf(r.b.name) % 1000; // 「最热」也用确定性热度，保证顺序稳定
    switch (sort) {
      case 'hot':
        return rows.sort((a, b2) => key(b2) - key(a));
      case 'rating':
        return rows.sort((a, b2) => b2.rating - a.rating);
      case 'words':
        return rows.sort((a, b2) => b2.words - a.words);
      case 'ongoing':
        return rows.sort((a, b2) => (a.b.done === 0 ? 0 : 1) - (b2.b.done === 0 ? 0 : 1) || key(b2) - key(a));
      case 'done':
        return rows.sort((a, b2) => (a.b.done === 0 ? 1 : 0) - (b2.b.done === 0 ? 1 : 0) || key(b2) - key(a));
      default:
        return rows;
    }
  }, [books, sort]);

  // ------------------------------------------------------------------
  // 无限更新：本分类 → 「为你推荐」全分类轮转池（刷完一轮换 seed 再洗，永远刷不完）
  // ------------------------------------------------------------------
  /** 全分类去重书池（不含本分类的书，避免重复） */
  const recPool = useMemo(() => {
    const seen = new Set(books.map((b) => b.name));
    const arr: FeaturedBook[] = [];
    for (const cat of Object.keys(FEATURED))
      for (const b of FEATURED[cat]) {
        if (!seen.has(b.name)) {
          seen.add(b.name);
          arr.push(b);
        }
      }
    return arr;
  }, [books]);

  const [rows, setRows] = useState<Row[]>([]);
  const cursorRef = useRef(0);
  const roundRef = useRef(0);
  const orderRef = useRef<Row[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  /** 重建无限流（排序变化/组件挂载时）：本分类全部 + 推荐池洗牌待追加 */
  const rebuild = useCallback(() => {
    orderRef.current = [
      ...catRows,
      ...seededShuffle(recPool, hashOf(category) + 1).map((b) => ({ b, words: wordsOf(b.name), rating: ratingOf(b.name), rec: true })),
    ];
    roundRef.current = 1;
    cursorRef.current = Math.min(BATCH, orderRef.current.length);
    setRows(orderRef.current.slice(0, cursorRef.current));
  }, [catRows, recPool, category]);
  useEffect(() => {
    rebuild();
  }, [rebuild]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setTimeout(() => {
      const order = orderRef.current;
      if (cursorRef.current >= order.length) {
        // 一轮刷完 → 换 seed 再洗一轮接着刷（真·无限）
        roundRef.current += 1;
        const extra = seededShuffle(recPool, hashOf(category) + roundRef.current * 97).map(
          (b) => ({ b, words: wordsOf(b.name), rating: ratingOf(b.name), rec: true }) as Row,
        );
        orderRef.current = [...order, ...extra];
      }
      cursorRef.current = Math.min(cursorRef.current + BATCH, orderRef.current.length);
      setRows(orderRef.current.slice(0, cursorRef.current));
      setLoadingMore(false);
    }, 120);
  }, [recPool, category]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 420) loadMore();
  };

  // 封面（全量书名请求服务端缓存；失败自动换地址重试）
  const { covers, retry: retryCover } = useFeaturedCovers(rows.map((r) => r.b.name));
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (name: string, url: string) => {
    setCoverFails((s) => new Set(s).add(url));
    retryCover(name);
  };

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  /** 排行榜单行：大排名数字 + 封面 + 三行文字（截图同款） */
  const renderRow = (r: Row, i: number) => {
    const raw = covers[r.b.name];
    const url = raw && !coverFails.has(raw) ? raw : null;
    const pal = coverPaletteOf(r.b.name);
    const top3 = i < 3;
    const mid = i >= 3 && i < 10;
    return (
      <button
        key={`${r.b.name}-${i}`}
        type="button"
        onClick={() => onOpenBook(r.b.name, r.b.author)}
        className="flex w-full items-start gap-3 py-3 text-left transition-transform active:scale-[0.99]"
      >
        {/* 排名数字：1-3 主题色实心大字、4-9 浅主题色、10+ 灰色（截图同款层级） */}
        <span
          className={`w-7 shrink-0 text-center text-[24px] font-black italic leading-none tabular-nums ${top3 ? '' : ''}`}
          style={{
            color: top3 ? theme.accent : mid ? theme.accent + '99' : theme.textSub + '66',
            fontFamily: 'Georgia, "Times New Roman", serif',
            marginTop: 22,
          }}
          aria-hidden="true"
        >
          {i + 1}
        </span>
        {/* 封面 */}
        <div className="h-[96px] w-[72px] shrink-0 overflow-hidden rounded-xl shadow-[0_4px_14px_rgba(0,0,0,0.13)] ring-1 ring-black/5">
          {url ? (
            <img
              key={url}
              src={url}
              alt={`${r.b.name} 封面`}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => onCoverError(r.b.name, url)}
            />
          ) : (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2"
              style={{ backgroundImage: `linear-gradient(150deg, ${pal[0]}, ${pal[1]})` }}
            >
              <span className="line-clamp-3 text-center text-[12px] font-bold leading-tight text-white">{r.b.name}</span>
            </div>
          )}
        </div>
        {/* 文字区：书名 + 作者·分类 + 字数/评分 */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 shrink truncate text-[16px] font-bold leading-tight" style={{ color: theme.textMain }}>
              {r.b.name}
            </span>
            <span
              className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: r.b.done === 0 ? theme.accentSoft : 'rgba(0,0,0,0.05)',
                color: r.b.done === 0 ? theme.accent : theme.textSub,
              }}
            >
              {r.b.done === 0 ? '连载' : '完结'}
            </span>
          </div>
          <p className="mt-1 truncate text-[12px]" style={{ color: theme.textSub }}>
            {r.b.author} · {r.b.tag}
          </p>
          <p className="mt-1.5 truncate text-[12px] tabular-nums" style={{ color: theme.textSub }}>
            {r.words}万字 · 评分 {r.rating.toFixed(1)}
          </p>
        </div>
      </button>
    );
  };

  /** 首个推荐条目位置（分隔线插在本分类最后一行之后） */
  const recStart = rows.findIndex((r) => r.rec);

  return (
    <div className="flex h-full flex-col">
      {/* ============ 顶部固定区（上下滚动不跟随） ============ */}
      <div className="shrink-0" style={{ paddingTop: SB_H }}>
        {/* 导航行：返回键 + 分类名标题（左上角，截图同款；标题不居中） */}
        <div className="flex h-[52px] items-center gap-1 px-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
            style={{ color: theme.textMain }}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <h1 className="min-w-0 shrink truncate pl-0.5 text-[22px] font-bold leading-none" style={{ color: theme.textMain }}>
            {category}榜
          </h1>
        </div>
        {/* 排序筛选胶囊（横向滚动；选中项主题色实心，截图同款） */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-4 pb-2.5 no-scrollbar">
          {SORTS.map((s) => {
            const active = sort === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSort(s.key)}
                className="h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-medium active:scale-95"
                style={
                  active
                    ? { background: theme.accent, color: '#fff', boxShadow: `0 3px 10px ${theme.accent}44` }
                    : { ...glass, color: theme.textMain }
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {/* 搜索框（点击进入聚合搜索页） */}
        <button
          type="button"
          onClick={onSearch}
          className="mx-4 mb-2.5 flex h-10 w-[calc(100%-2rem)] items-center gap-2 rounded-full px-4 text-left backdrop-blur-xl active:scale-[0.99]"
          style={glass}
        >
          <Search className="h-[17px] w-[17px] shrink-0" strokeWidth={2.2} style={{ color: theme.textSub }} />
          <span className="truncate text-[14px]" style={{ color: theme.textSub }}>
            搜索书名、作者…
          </span>
        </button>
      </div>

      {/* ============ 滚动区：排行榜列表（无限更新） ============ */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-12">
        {books.length > 0 ? (
          <>
            {rows.map((r, i) => (
              <div key={`${r.b.name}-${i}`}>
                {/* 本分类刷完 → 推荐区分隔线（一次） */}
                {r.rec && i === recStart && (
                  <div className="mb-1 mt-2 flex items-center gap-2" aria-hidden="true">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: theme.accent }} />
                    <span className="shrink-0 text-[13px] font-semibold" style={{ color: theme.textMain }}>
                      为你推荐
                    </span>
                    <span className="h-px flex-1" style={{ background: theme.cardRing }} />
                  </div>
                )}
                {renderRow(r, i)}
              </div>
            ))}
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
          </>
        ) : (
          /* 未知分类空态：提示 + 引导搜索 */
          <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-3xl p-8 backdrop-blur-xl" style={glass}>
            <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
              该分类暂无精选书目
            </p>
            <p className="text-center text-[12px]" style={{ color: theme.textSub }}>
              试试搜索「{category}」相关好书
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
