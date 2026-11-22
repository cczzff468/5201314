'use client';

/**
 * 分类浏览页（子页）：某分类精选书网格（每分类 50+ 本，全量展示）。
 * - 真实封面：服务端 FeaturedCover 永久缓存，后台自动补齐（全部书都显示封面）
 * - 封面加载失败自动换地址重试一次，仍失败回退渐变占位卡（不显示破图）
 * - 顶部仅保留导航栏（分类横幅已按需求移除）
 * - 点击书籍直达该书聚合搜索（onOpenBook）；未知分类兜底空态提示
 */
import { useMemo, useState } from 'react';
import { useReading } from '@/lib/reading/store';
import { FEATURED, coverPaletteOf, useFeaturedCovers, themeOf } from './shared';
import { SubNavBar } from './ReadingApp';

export function CategoryPage({
  category,
  onBack,
  onOpenBook,
}: {
  category: string;
  onBack: () => void;
  onOpenBook: (name: string, author: string) => void;
}) {
  const settings = useReading((s) => s.settings);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  /** 本分类精选书（未知分类兜底空数组 → 走空态） */
  const books = useMemo(() => FEATURED[category] || [], [category]);
  const { covers, retry: retryCover } = useFeaturedCovers(books.map((b) => b.name));
  /** 加载失败的封面地址（按地址记：重试换新地址后自动重展） */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (name: string, url: string) => {
    setCoverFails((s) => new Set(s).add(url));
    retryCover(name);
  };

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title={category} onBack={onBack} theme={theme} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10">
        {/* 书籍网格：真实封面（服务端缓存补齐，失败重试）/ 渐变占位兜底 */}
        {books.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-5">
            {books.map((b) => {
              const raw = covers[b.name];
              const url = raw && !coverFails.has(raw) ? raw : null;
              const pal = coverPaletteOf(b.name);
              return (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => onOpenBook(b.name, b.author)}
                  className="text-left transition-transform active:scale-95"
                >
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
                      <div
                        className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2"
                        style={{ backgroundImage: `linear-gradient(150deg, ${pal[0]}, ${pal[1]})` }}
                      >
                        <span className="line-clamp-3 text-center text-[13px] font-bold leading-tight text-white">
                          {b.name}
                        </span>
                        <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-medium text-white">{b.tag}</span>
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
              );
            })}
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
      </div>
    </div>
  );
}
