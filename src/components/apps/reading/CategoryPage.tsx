'use client';

/**
 * 分类浏览页（子页）：某分类精选书网格（每分类 50+ 本，全量展示）。
 * - 真实封面：服务端 FeaturedCover 永久缓存，后台自动补齐（全部书都显示封面）
 * - 封面加载失败自动换地址重试一次，仍失败回退渐变占位卡（不显示破图）
 * - 顶部仅保留导航栏（分类横幅已按需求移除）
 * - 导航栏下方：iOS 分段控件风格「全部 / 已完结 / 连载中」筛选胶囊 +
 *   右侧「N 本」数量小字（筛选不持久化，切页/切分类重置为「全部」）
 * - 点击书籍直达该书聚合搜索（onOpenBook）；未知分类兜底空态提示
 */
import { useMemo, useState } from 'react';
import { useReading } from '@/lib/reading/store';
import { FEATURED, coverPaletteOf, useFeaturedCovers, themeOf } from './shared';
import { SubNavBar } from './ReadingApp';

/** 完结状态筛选选项（数组顺序即展示顺序） */
const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完结' },
  { key: 'ongoing', label: '连载中' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['key'];

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

  /** 完结状态筛选（不持久化：父级按分类 key 重挂载本组件，切页/切分类自动回「全部」） */
  const [filter, setFilter] = useState<StatusFilter>('all');
  /** 筛选结果：已完结 = done !== 0（缺省视为已完结）；连载中 = done === 0 */
  const filtered = useMemo(() => {
    if (filter === 'done') return books.filter((b) => b.done !== 0);
    if (filter === 'ongoing') return books.filter((b) => b.done === 0);
    return books;
  }, [books, filter]);

  // 封面按全量书名获取（服务端缓存），切换筛选不重复请求
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
        {books.length > 0 && (
          /* iOS 分段控件风格筛选胶囊：玻璃容器内三个等宽选项，选中项主题色实心 */
          <div className="mt-3 flex items-center gap-2.5">
            <div className="flex min-w-0 flex-1 gap-1 rounded-full p-1 backdrop-blur-xl" style={glass}>
              {STATUS_FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(f.key)}
                    className={
                      'flex-1 truncate rounded-full py-1.5 text-center text-[12px] font-semibold transition-all active:scale-95' +
                      (active ? ' text-white' : '')
                    }
                    style={
                      active
                        ? { background: theme.accent, boxShadow: '0 2px 8px ' + theme.accentSoft }
                        : { color: theme.textSub }
                    }
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            {/* 当前筛选后的数量小字 */}
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums"
              style={{ ...glass, color: theme.textSub }}
            >
              {filtered.length} 本
            </span>
          </div>
        )}
        {/* 书籍网格：真实封面（服务端缓存补齐，失败重试）/ 渐变占位兜底 */}
        {filtered.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5">
            {filtered.map((b) => {
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
        ) : books.length > 0 ? (
          /* 筛选空态：本分类有书，但当前筛选下无匹配 */
          <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-3xl p-8 backdrop-blur-xl" style={glass}>
            <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
              该筛选下暂无书籍
            </p>
            <p className="text-center text-[12px]" style={{ color: theme.textSub }}>
              切回「全部」看看本分类的其他好书吧
            </p>
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
