'use client';

/**
 * 首页 Tab：胶囊搜索条 + 分类胶囊标签 + 精选书单横滑卡（真实封面，懒加载+缓存）
 * + 继续阅读卡。玻璃毛玻璃风格：磨砂卡片 + 主题光斑透出 + 全圆角胶囊。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Clock3, ChevronRight, Flame } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  FEATURED,
  api,
  cachedCover,
  coverSrc,
  fetchBookCover,
  themeOf,
  type ReadHistoryItem,
  type SourceItem,
} from './shared';

const CATEGORIES = Object.keys(FEATURED);

export function HomeTab({
  onSearch,
  onOpenShelfBook,
}: {
  onSearch: (kw?: string) => void;
  onOpenShelfBook: (b: ReadHistoryItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const sources = useReading((s) => s.sources);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  /** 继续阅读：优先阅读历史（看过的书都往这进）；历史空则兑底书架 */
  const [recent, setRecent] = useState<ReadHistoryItem | null>(null);
  useEffect(() => {
    api
      .readlogList()
      .then((d) => setRecent(d.reads[0] || null))
      .catch(() => setRecent(null));
  }, []);

  // 精选书真实封面（缓存秒显 + 后台逐本补齐；并发 2，避免压垮书源）
  const [covers, setCovers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const cat of CATEGORIES) for (const b of FEATURED[cat]) {
      const c = cachedCover(b.name);
      if (c) init[b.name] = coverSrc(c.url, c.sid) as string;
    }
    return init;
  });
  /** 加载失败的书名（回退到占位卡） */
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());
  const onCoverError = (name: string) => {
    setCoverFails((s) => new Set(s).add(name));
    setCovers((c) => {
      const n = { ...c };
      delete n[name];
      return n;
    });
  };

  useEffect(() => {
    let alive = true;
    const enabled = sources.filter((s) => s.enabled);
    if (!enabled.length) return;
    const all = CATEGORIES.flatMap((cat) => FEATURED[cat]);
    const missing = all.filter((b) => !cachedCover(b.name));
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
  }, [sources]);

  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  return (
    <div className="px-4 pb-8">
      {/* 搜索胶囊 */}
      <button
        type="button"
        onClick={() => onSearch()}
        className="flex h-11 w-full items-center gap-2 rounded-full px-4 text-left backdrop-blur-xl transition-transform active:scale-[0.98]"
        style={glass}
      >
        <Search className="h-[18px] w-[18px]" strokeWidth={2.2} style={{ color: theme.textSub }} />
        <span className="text-[15px]" style={{ color: theme.textSub }}>
          搜索书名、作者…
        </span>
      </button>

      {/* Banner：渐变玻璃横幅 */}
      <div
        className="relative mt-4 overflow-hidden rounded-3xl p-5"
        style={{
          background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`,
          boxShadow: `0 12px 32px ${theme.accent}33`,
        }}
      >
        <div className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-white/25 blur-2xl" aria-hidden="true" />
        <div className="absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-white/20 blur-xl" aria-hidden="true" />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-[13px] font-medium tracking-wide text-white/85">
            <Flame className="h-3.5 w-3.5" /> 免费书源聚合阅读
          </p>
          <p className="mt-1 text-[22px] font-bold leading-snug text-white">全网好书 一搜即得</p>
          <p className="mt-1 text-[12px] text-white/75">AI 伴读 · 换源追更 · 排版随心</p>
          <button
            type="button"
            onClick={() => onSearch()}
            className="mt-3 rounded-full bg-white/90 px-4 py-1.5 text-[13px] font-semibold shadow-sm backdrop-blur active:scale-95"
            style={{ color: theme.accent }}
          >
            开始找书
          </button>
        </div>
      </div>

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

      {/* 分类胶囊 */}
      <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onSearch(FEATURED[c][0]?.name)}
            className={`h-8 shrink-0 rounded-full px-4 text-[13px] font-medium backdrop-blur-xl active:scale-95 ${c === '热门' ? 'text-white' : ''}`}
            style={
              c === '热门'
                ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 4px 14px ${theme.accent}44` }
                : { ...glass, color: theme.textMain }
            }
          >
            {c}
          </button>
        ))}
      </div>

      {/* 精选书单（真实封面） */}
      {CATEGORIES.slice(1).map((cat) => (
        <section key={cat} className="mt-5">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[17px] font-bold" style={{ color: theme.textMain }}>
              {cat}精选
            </h2>
            <button
              type="button"
              onClick={() => onSearch(FEATURED[cat][0]?.name)}
              className="text-[12px] font-medium"
              style={{ color: theme.accent }}
            >
              换一批 ›
            </button>
          </div>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FEATURED[cat].map((b) => (
              <button
                key={b.name}
                type="button"
                onClick={() => onSearch(b.name)}
                className="w-[86px] shrink-0 text-left active:scale-95"
              >
                <div className="relative aspect-[3/4.2] w-full overflow-hidden rounded-xl shadow-[0_6px_18px_rgba(0,0,0,0.14)] ring-1 ring-black/5">
                  {covers[b.name] && !coverFails.has(b.name) ? (
                    <img src={covers[b.name]} alt={`${b.name} 封面`} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => onCoverError(b.name)} />
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
        </section>
      ))}
    </div>
  );
}
