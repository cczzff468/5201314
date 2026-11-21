'use client';

/**
 * 首页 Tab：胶囊搜索条 + 分类胶囊标签 + 精选书单横滑卡 + 继续阅读卡
 * 风格参照截图：白/浅底大留白、全圆角胶囊、蓝色主色点缀
 */
import { useMemo } from 'react';
import { Search, Clock3, ChevronRight } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { FEATURED, themeOf, type ShelfBookItem } from './shared';
import type { SubPage } from './ReadingApp';

const CATEGORIES = Object.keys(FEATURED);

export function HomeTab({
  onSearch,
  onOpenShelfBook,
}: {
  onSearch: (kw?: string) => void;
  onOpenShelfBook: (b: ShelfBookItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const recent = shelf[0];

  return (
    <div className="px-4 pb-8">
      {/* 搜索胶囊 */}
      <button
        type="button"
        onClick={() => onSearch()}
        className="flex h-11 w-full items-center gap-2 rounded-full px-4 text-left backdrop-blur-xl ring-1 transition-transform active:scale-[0.98]"
        style={{ background: theme.cardBg, color: theme.textSub, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)', ['--tw-ring-color' as string]: theme.cardRing }}
      >
        <Search className="h-[18px] w-[18px]" strokeWidth={2.2} />
        <span className="text-[15px]">搜索书名、作者…</span>
      </button>

      {/* Banner：渐变玻璃横幅 */}
      <div
        className="relative mt-4 overflow-hidden rounded-3xl p-5 shadow-[0_10px_30px_rgba(34,116,240,0.18)]"
        style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
      >
        <div className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-white/25 blur-2xl" aria-hidden="true" />
        <div className="absolute -bottom-10 left-10 h-24 w-24 rounded-full bg-white/20 blur-xl" aria-hidden="true" />
        <div className="relative">
          <p className="text-[13px] font-medium tracking-wide text-white/85">免费书源聚合阅读</p>
          <p className="mt-1 text-[22px] font-bold leading-snug text-white">
            全网好书 一搜即得
          </p>
          <p className="mt-1 text-[12px] text-white/75">AI 伴读 · 换源追更 · 排版随心</p>
          <button
            type="button"
            onClick={() => onSearch()}
            className="mt-3 rounded-full bg-white/90 px-4 py-1.5 text-[13px] font-semibold shadow-sm active:scale-95"
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
          className="mt-4 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left ring-1 backdrop-blur-xl active:scale-[0.99]"
          style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
        >
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
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
            className="h-8 shrink-0 rounded-full px-4 text-[13px] font-medium ring-1 backdrop-blur-xl active:scale-95"
            style={{ background: c === '热门' ? theme.accent : theme.cardBg, color: c === '热门' ? '#fff' : theme.textMain, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 精选书单 */}
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
                <div
                  className="flex h-[122px] w-[86px] flex-col items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br p-2 ring-1 ring-black/5"
                  style={{ backgroundImage: `linear-gradient(140deg, ${theme.gradFrom}44, ${theme.gradTo}88)` }}
                >
                  <span className="line-clamp-3 text-center text-[13px] font-bold leading-tight" style={{ color: theme.textMain }}>
                    {b.name}
                  </span>
                  <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-medium" style={{ color: theme.accent }}>
                    {b.tag}
                  </span>
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
