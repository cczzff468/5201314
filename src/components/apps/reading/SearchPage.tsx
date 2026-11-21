'use client';

/**
 * 聚合搜索页（参照截图4）：多书源并行搜索、可暂停/继续、结果按书名+作者
 * 聚合显示「N 个源」徽标；单源失败静默跳过。
 * 实现：客户端逐源调 POST /api/reading/search（并发4），AbortController 暂停。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Pause, Play, Loader2 } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  api,
  CoverPlaceholder,
  themeOf,
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
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<SourceItem[]>([]);
  const startedRef = useRef(false);

  const enabledSources = useMemo(() => sources.filter((s) => s.enabled), [sources]);

  const runSearch = useCallback(
    async (keyword: string) => {
      const k = keyword.trim();
      if (!k || enabledSources.length === 0) return;
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
    [enabledSources],
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

  const list = useMemo(() => [...groups.values()].sort((a, b) => b.books.length - a.books.length), [groups]);

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title="聚合搜索" onBack={onBack} theme={theme} />
      {/* 搜索条 */}
      <div className="flex gap-2 px-4 pb-3">
        <div
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-4 ring-1 backdrop-blur-xl"
          style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
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
          style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
        >
          搜索
        </button>
      </div>

      {/* 结果列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24">
        {list.length === 0 && !running && (
          <div className="mt-28 flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: theme.accentSoft, color: theme.accent }}>
              <Search className="h-7 w-7" strokeWidth={2} />
            </div>
            <p className="text-[14px]" style={{ color: theme.textSub }}>
              {searched > 0 ? '没有找到相关书籍，换个关键词试试' : `输入书名，同时搜索 ${enabledSources.length} 个免费书源`}
            </p>
          </div>
        )}
        {list.map((g) => {
          const b0 = g.books[0];
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onOpenBook(b0, b0.sourceId || '')}
              className="mb-2.5 flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.99]"
              style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
            >
              {b0.coverUrl ? (
                <img src={b0.coverUrl} alt="" className="h-[68px] w-[50px] shrink-0 rounded-lg object-cover ring-1 ring-black/5" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <CoverPlaceholder name={g.name} className="h-[68px] w-[50px] shrink-0" radius="rounded-lg" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-bold" style={{ color: theme.textMain }}>
                    {g.name}
                  </span>
                  {g.books.length > 1 && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: theme.accentSoft, color: theme.accent }}
                    >
                      {g.books.length} 个源
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[12px]" style={{ color: theme.textSub }}>
                  {g.author || '佚名'}
                  {b0.kind ? ` · ${b0.kind.replace('分类：', '')}` : ''}
                </p>
                {b0.intro && (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-snug" style={{ color: theme.textSub }}>
                    {b0.intro}
                  </p>
                )}
                <p className="mt-1 truncate text-[11px]" style={{ color: theme.textSub }}>
                  来源：{g.books.map((x) => x.sourceName).slice(0, 3).join(' / ')}
                  {g.books.length > 3 ? ' 等' : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* 底部状态胶囊（搜索中/暂停后显示） */}
      {(running || searched > 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-6">
          <div
            className="pointer-events-auto flex h-11 items-center gap-3 rounded-full px-5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] ring-1 backdrop-blur-2xl"
            style={{ background: theme.barBg, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accent }} />
                <span className="text-[13px]" style={{ color: theme.textMain }}>
                  搜索中 {searched}/{enabledSources.length} 源 · 已找到 {found} 条
                </span>
                <button type="button" onClick={pause} className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                  <Pause className="h-4 w-4" /> 暂停
                </button>
              </>
            ) : (
              <>
                <span className="text-[13px]" style={{ color: theme.textMain }}>
                  已停止 · 共找到 {found} 条
                </span>
                {searched < enabledSources.length && (
                  <button type="button" onClick={resume} className="flex items-center gap-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                    <Play className="h-4 w-4" /> 继续搜索
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
