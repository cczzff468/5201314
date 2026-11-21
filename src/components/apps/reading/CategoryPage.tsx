'use client';

/**
 * 分类浏览页（子页）：某分类精选书网格（真实封面：缓存秒显 + 后台逐本补齐，
 * 并发 2 避免压垮书源）+ 紧凑渐变横幅 + 底部「搜索更多」跨书源入口。
 * 点击书籍直达该书聚合搜索（onOpenBook）；未知分类兜底空态提示。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { FEATURED, cachedCover, coverSrc, fetchBookCover, themeOf } from './shared';
import { SubNavBar } from './ReadingApp';

export function CategoryPage({
  category,
  onBack,
  onOpenBook,
  onSearchMore,
}: {
  category: string;
  onBack: () => void;
  onOpenBook: (name: string, author: string) => void;
  onSearchMore: (kw: string) => void;
}) {
  const settings = useReading((s) => s.settings);
  const sources = useReading((s) => s.sources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  /** 本分类精选书（未知分类兜底空数组 → 走空态） */
  const books = useMemo(() => FEATURED[category] || [], [category]);

  // 精选书真实封面：先读 localStorage 缓存秒显，缺的后台逐本补齐（并发 2）
  const initCovers = (): Record<string, string> => {
    const init: Record<string, string> = {};
    for (const b of FEATURED[category] || []) {
      const c = cachedCover(b.name);
      if (c) init[b.name] = coverSrc(c.url, c.sid) as string;
    }
    return init;
  };
  const [covers, setCovers] = useState<Record<string, string>>(initCovers);

  /** 分类切换（组件复用场景）时，渲染期重置为本分类的缓存封面（官方推荐写法，避免 effect 级联渲染） */
  const [prevCat, setPrevCat] = useState(category);
  if (prevCat !== category) {
    setPrevCat(category);
    setCovers(initCovers());
  }

  /** 封面加载失败：从映射移除，回退渐变占位卡 */
  const onCoverError = (name: string) => {
    setCovers((c) => {
      const n = { ...c };
      delete n[name];
      return n;
    });
  };

  // 后台补齐缺失封面：两个 worker 逐本「缓存 || 搜书源」，卸载时置 alive=false 中断
  useEffect(() => {
    let alive = true;
    const enabled = sources.filter((s) => s.enabled);
    if (!enabled.length) return;
    const missing = books.filter((b) => !cachedCover(b.name));
    if (!missing.length) return;
    let i = 0;
    const worker = async () => {
      while (i < missing.length && alive) {
        const b = missing[i++];
        const got = cachedCover(b.name) || (await fetchBookCover(b.name, b.author, enabled));
        if (got && alive) setCovers((prev) => ({ ...prev, [b.name]: coverSrc(got.url, got.sid) as string }));
      }
    };
    void worker();
    void worker();
    return () => {
      alive = false;
    };
  }, [sources, books]);

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title={category} onBack={onBack} theme={theme} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10">
        {/* 分类横幅：紧凑渐变卡 + 装饰光斑 */}
        <div
          className="relative mt-3 overflow-hidden rounded-3xl p-4"
          style={{
            background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`,
            boxShadow: `0 12px 32px ${theme.accent}33`,
          }}
        >
          <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/25 blur-2xl" aria-hidden="true" />
          <div className="absolute -bottom-10 left-10 h-20 w-20 rounded-full bg-white/20 blur-xl" aria-hidden="true" />
          <div className="relative">
            <p className="text-[20px] font-bold leading-snug text-white">{category}</p>
            <p className="mt-0.5 text-[12px] text-white/75">共 {books.length} 本精选好书</p>
          </div>
        </div>

        {/* 书籍网格：真实封面 / 渐变占位兜底 */}
        {books.length > 0 ? (
          <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-5">
            {books.map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => onOpenBook(b.name, b.author)}
                className="text-left transition-transform active:scale-95"
              >
                <div className="relative aspect-[3/4.2] w-full overflow-hidden rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.14)] ring-1 ring-black/5">
                  {covers[b.name] ? (
                    <img
                      src={covers[b.name]}
                      alt={`${b.name} 封面`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => onCoverError(b.name)}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2"
                      style={{ backgroundImage: `linear-gradient(150deg, ${theme.gradFrom}55, ${theme.gradTo}99)` }}
                    >
                      <span className="line-clamp-3 text-center text-[13px] font-bold leading-tight" style={{ color: '#fff' }}>
                        {b.name}
                      </span>
                      <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-medium" style={{ color: theme.accent }}>
                        {b.tag}
                      </span>
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/25 to-transparent" aria-hidden="true" />
                </div>
                <p className="mt-1.5 truncate text-[13px] font-semibold" style={{ color: theme.textMain }}>
                  {b.name}
                </p>
                <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
                  {b.author}
                </p>
              </button>
            ))}
          </div>
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

        {/* 底部入口：跨书源搜索本分类关键词 */}
        <div className="mt-5 flex items-center gap-3 rounded-3xl p-4 backdrop-blur-xl" style={glass}>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
              没找到想看的？
            </p>
            <p className="mt-0.5 truncate text-[12px]" style={{ color: theme.textSub }}>
              搜索「{category}」分类的更多书
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSearchMore(category)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-transform active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`,
              boxShadow: `0 4px 14px ${theme.accent}44`,
            }}
          >
            <Search className="h-4 w-4" strokeWidth={2.2} />
            搜索更多
          </button>
        </div>
      </div>
    </div>
  );
}
