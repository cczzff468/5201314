'use client';

/**
 * 书籍详情页：封面+信息+简介+操作按钮（开始阅读/加入书架）+ 目录抽屉
 * + 【换源】同书多源切换：后台并行搜出本书在各书源的结果，底部玻璃抽屉列出，
 *   点按即切换（进度按章节标题映射保留；书架记录同步迁移到新源，不丢进度）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plus, Check, ArrowDownUp, RefreshCw, Loader2, Repeat2, Wifi } from 'lucide-react';
import {
  api,
  CoverPlaceholder,
  coverSrc,
  findStartIndex,
  matchChapterIndex,
  themeOf,
  type BookDetailData,
  type SearchBookItem,
} from './shared';
import { SubNavBar, type SubPage } from './ReadingApp';
import { useReading } from '@/lib/reading/store';

type ReaderPage = Extract<SubPage, { kind: 'reader' }>;

/** 换源候选 */
interface SourceCandidate {
  sourceId: string;
  sourceName: string;
  book: SearchBookItem;
}

export function BookDetail({
  page,
  onBack,
  onRead,
  onSwitchSource,
}: {
  page: { kind: 'detail'; sourceId: string; book: SearchBookItem };
  onBack: () => void;
  onRead: (p: ReaderPage) => void;
  onSwitchSource: (book: SearchBookItem) => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const sources = useReading((s) => s.sources);
  const loadShelf = useReading((s) => s.loadShelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  // 当前源（换源后本地更新，不回搜索页）
  const [curSourceId, setCurSourceId] = useState(page.sourceId || page.book.sourceId || '');
  const [curBook, setCurBook] = useState<SearchBookItem>(page.book);

  const [data, setData] = useState<BookDetailData | null>(null);
  const [err, setErr] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [tocReverse, setTocReverse] = useState(false);
  const [inShelf, setInShelf] = useState(false);
  const [switching, setSwitching] = useState(false);

  // 换源抽屉
  const [srcOpen, setSrcOpen] = useState(false);
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [srcSearching, setSrcSearching] = useState(false);
  const srcSearchedRef = useRef(false);

  const name = data?.name || curBook.name;
  const author = data?.author || curBook.author || '';

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(curSourceId, curBook.bookUrl, curBook.name, curBook.author || '')
      .then((d) => {
        if (!alive) return;
        setData(d);
        setInShelf(d.inShelf);
        setErr('');
      })
      .catch((e: Error) => {
        if (alive) setErr(e.message || '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [curSourceId, curBook.bookUrl, curBook.name, curBook.author, reloadKey]);

  const shelfEntry = shelf.find((b) => b.bookUrl === curBook.bookUrl);
  const readIdx = data?.lastReadChapter ?? shelfEntry?.lastReadChapter ?? 0;

  // ------------------------------------------------------------------
  // 换源候选发现：打开换源抽屉时后台并行搜（书名+作者），仅收同名结果
  // ------------------------------------------------------------------
  const findCandidates = useCallback(async () => {
    if (srcSearching) return;
    setSrcSearching(true);
    setCandidates([]);
    const enabled = sources.filter((s) => s.enabled && s.id !== curSourceId).slice(0, 14);
    const norm = (s: string) => s.replace(/\s+/g, '');
    const found: SourceCandidate[] = [];
    const queue = [...enabled];
    const worker = async () => {
      while (queue.length && found.length < 10) {
        const src = queue.shift()!;
        try {
          const r = await api.searchOne(curBook.name, src.id);
          for (const b of r.books || []) {
            if (norm(b.name) === norm(curBook.name)) {
              found.push({ sourceId: b.sourceId || src.id, sourceName: b.sourceName, book: b });
              break;
            }
          }
          setCandidates([...found]);
        } catch {
          /* 单源失败静默 */
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, enabled.length) }, worker)).then(() => {
      setSrcSearching(false);
    });
  }, [sources, curSourceId, curBook.name, srcSearching]);

  useEffect(() => {
    if (srcOpen && !srcSearchedRef.current) {
      srcSearchedRef.current = true;
      void findCandidates();
    }
  }, [srcOpen, findCandidates]);

  /** 切换到候选源：重拉详情 + 进度按章节标题映射 + 书架记录迁移 */
  const switchTo = async (c: SourceCandidate) => {
    if (switching) return;
    setSwitching(true);
    try {
      const d = await api.bookDetail(c.sourceId, c.book.bookUrl, name, author);
      if (!d.chapters.length) throw new Error('该源目录为空');
      const oldTitle = data?.chapters?.[readIdx]?.title || null;
      const newIdx = matchChapterIndex(d.chapters, oldTitle, readIdx);
      // 书架在架则迁移（保留进度），并同步本地
      if (inShelf || shelfEntry) {
        await api
          .shelfAction({
            action: 'switchSource',
            name,
            author,
            book: {
              sourceId: c.sourceId,
              sourceName: c.sourceName,
              bookUrl: c.book.bookUrl,
              coverUrl: c.book.coverUrl || curBook.coverUrl,
              intro: d.intro,
              chapters: d.chapters,
            },
          })
          .catch(() => null);
        await loadShelf().catch(() => null);
      }
      setCurSourceId(c.sourceId);
      setCurBook({ ...c.book, name: d.name || name, author: d.author || author });
      setData({ ...d, lastReadChapter: newIdx });
      setSrcOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '换源失败，换一个试试');
    }
    setSwitching(false);
  };

  const startReading = () => {
    if (!data || data.chapters.length === 0) return;
    const idx = readIdx > 0 ? readIdx : findStartIndex(data.chapters);
    onRead({
      kind: 'reader',
      sourceId: curSourceId,
      bookUrl: curBook.bookUrl,
      name: data.name || name,
      author: data.author || author,
      coverUrl: curBook.coverUrl,
      startIndex: idx,
    });
  };

  const toggleShelf = async () => {
    if (!data) return;
    if (inShelf) {
      await api.shelfAction({ action: 'remove', bookUrl: curBook.bookUrl }).catch(() => null);
      setInShelf(false);
    } else {
      await api
        .shelfAction({
          action: 'add',
          book: {
            name: data.name || name,
            author: data.author || author,
            coverUrl: curBook.coverUrl,
            intro: data.intro,
            sourceId: curSourceId,
            sourceName: curBook.sourceName,
            bookUrl: curBook.bookUrl,
            chapters: data.chapters,
          },
        })
        .catch(() => null);
      setInShelf(true);
    }
  };

  const tocList = useMemo(() => {
    if (!data) return [];
    return tocReverse ? [...data.chapters].reverse() : data.chapters;
  }, [data, tocReverse]);

  const cover = coverSrc(data?.coverUrl || curBook.coverUrl, curSourceId);
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  return (
    <div className="flex h-full flex-col">
      <SubNavBar
        title={name}
        onBack={onBack}
        theme={theme}
        right={
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="刷新"
            className="flex h-10 w-10 items-center justify-center rounded-full active:scale-90"
            style={{ color: theme.textMain }}
          >
            <RefreshCw className="h-[18px] w-[18px]" />
          </button>
        }
      />
      {!data && !err && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: theme.accent }} />
        </div>
      )}
      {err && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-[14px]" style={{ color: theme.textSub }}>
            {err}
          </p>
          <button
            type="button"
            onClick={() => onSwitchSource(curBook)}
            className="rounded-full px-5 py-2 text-[13px] font-semibold text-white shadow-md"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
          >
            换个书源试试
          </button>
        </div>
      )}
      {data && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
          {/* 信息头卡 */}
          <div className="flex gap-4 rounded-3xl p-4 ring-1 backdrop-blur-xl" style={glass}>
            {cover ? (
              <img
                src={cover}
                alt={`${name} 封面`}
                className="h-[136px] w-[100px] shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-black/5"
                referrerPolicy="no-referrer"
              />
            ) : (
              <CoverPlaceholder name={name} author={author} className="h-[136px] w-[100px] shrink-0 shadow-lg" />
            )}
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-[20px] font-bold leading-snug" style={{ color: theme.textMain }}>
                {name}
              </h1>
              <p className="mt-1 text-[13px]" style={{ color: theme.textSub }}>
                {author || '佚名'}
              </p>
              <p className="mt-2 text-[12px]" style={{ color: theme.textSub }}>
                共 {data.total} 章{data.lastChapter ? ` · 最新：${data.lastChapter.slice(0, 14)}` : ''}
              </p>
              <span
                className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ background: theme.accentSoft, color: theme.accent }}
              >
                <Wifi className="h-3 w-3" /> {curBook.sourceName}
              </span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={startReading}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-white shadow-lg active:scale-95"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 8px 24px ${theme.accent}44` }}
            >
              <BookOpen className="h-[18px] w-[18px]" />
              {readIdx > 0 ? `继续读 · 第${readIdx + 1}章` : '开始阅读'}
            </button>
            <button
              type="button"
              onClick={() => void toggleShelf()}
              aria-label={inShelf ? '移出书架' : '加入书架'}
              className="flex h-12 w-12 items-center justify-center rounded-full ring-1 backdrop-blur-xl active:scale-90"
              style={{ ...glass, color: inShelf ? theme.accent : theme.textMain }}
            >
              {inShelf ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>

          {/* 简介卡 */}
          {data.intro && (
            <div className="mt-3 rounded-3xl p-4 ring-1 backdrop-blur-xl" style={glass}>
              <p className="text-[13px] leading-relaxed" style={{ color: theme.textSub }}>
                {data.intro.length > 160 ? `${data.intro.slice(0, 160)}…` : data.intro}
              </p>
            </div>
          )}

          {/* 换源卡（同书切换书源，进度保留） */}
          <button
            type="button"
            onClick={() => setSrcOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-3xl p-4 text-left ring-1 backdrop-blur-xl active:scale-[0.99]"
            style={glass}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: theme.accentSoft, color: theme.accent }}>
              <Repeat2 className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold" style={{ color: theme.textMain }}>
                切换书源
              </span>
              <span className="mt-0.5 block truncate text-[12px]" style={{ color: theme.textSub }}>
                当前「{curBook.sourceName}」· 换个源速度更快，进度不丢
              </span>
            </span>
            <ArrowDownUp className="h-4 w-4 shrink-0" style={{ color: theme.textSub }} />
          </button>

          {/* 目录卡 */}
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            className="mt-3 flex w-full items-center justify-between rounded-3xl p-4 ring-1 backdrop-blur-xl active:scale-[0.99]"
            style={glass}
          >
            <div className="text-left">
              <p className="text-[15px] font-semibold" style={{ color: theme.textMain }}>
                目录
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: theme.textSub }}>
                共 {data.total} 章 · 点击查看全部
              </p>
            </div>
            <ArrowDownUp className="h-5 w-5" style={{ color: theme.textSub }} />
          </button>

          {/* 前6章预览 */}
          <div className="mt-3 space-y-1 rounded-3xl p-2 ring-1 backdrop-blur-xl" style={glass}>
            {data.chapters.slice(findStartIndex(data.chapters), findStartIndex(data.chapters) + 6).map((c, i) => (
              <button
                key={c.url + i}
                type="button"
                onClick={() =>
                  onRead({
                    kind: 'reader',
                    sourceId: curSourceId,
                    bookUrl: curBook.bookUrl,
                    name: data.name || name,
                    author: data.author || author,
                    coverUrl: curBook.coverUrl,
                    startIndex: findStartIndex(data.chapters) + i,
                  })
                }
                className="flex w-full items-center justify-between rounded-2xl px-4 py-2.5 text-left active:scale-[0.99]"
                style={{ background: i === readIdx ? theme.accentSoft : 'transparent' }}
              >
                <span className="truncate text-[14px]" style={{ color: theme.textMain }}>
                  {c.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 换源抽屉（毛玻璃） */}
      {srcOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="切换书源">
          <button type="button" aria-label="关闭换源" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setSrcOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[74%] flex-col rounded-t-3xl shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <div className="flex shrink-0 justify-center pb-1 pt-2.5">
              <span className="h-1 w-10 rounded-full bg-black/10" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-1">
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                切换书源 · 《{name}》
              </p>
              <button
                type="button"
                onClick={() => void findCandidates()}
                className="flex items-center gap-1 text-[13px]"
                style={{ color: theme.accent }}
              >
                {srcSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                重新找源
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              {/* 当前源 */}
              <div className="mb-2 flex items-center gap-3 rounded-2xl p-3 ring-1 backdrop-blur-xl" style={{ ...glass, background: theme.accentSoft }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: theme.accent, color: '#fff' }}>
                  {(curBook.sourceName || '源').slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                    {curBook.sourceName}
                  </span>
                  <span className="block text-[11px]" style={{ color: theme.textSub }}>
                    当前书源 · {data?.total || '—'} 章
                  </span>
                </span>
                <Check className="h-5 w-5 shrink-0" style={{ color: theme.accent }} />
              </div>
              {srcSearching && candidates.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-8" style={{ color: theme.textSub }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-[13px]">正在并行搜索各书源…</span>
                </div>
              )}
              {candidates.map((c) => (
                <button
                  key={c.sourceId + c.book.bookUrl}
                  type="button"
                  disabled={switching}
                  onClick={() => void switchTo(c)}
                  className="mb-2 flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 backdrop-blur-xl active:scale-[0.98] disabled:opacity-50"
                  style={glass}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
                    {c.sourceName.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                      {c.sourceName}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: theme.textSub }}>
                      {c.book.kind ? `${c.book.kind} · ` : ''}
                      {c.book.lastChapter ? `最新：${c.book.lastChapter.slice(0, 14)}` : c.book.bookUrl.replace(/^https?:\/\//, '').slice(0, 22)}
                    </span>
                  </span>
                  {switching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: theme.accent }} /> : <span className="shrink-0 text-[12px] font-medium" style={{ color: theme.accent }}>切换</span>}
                </button>
              ))}
              {!srcSearching && candidates.length === 0 && (
                <p className="py-4 text-center text-[12px]" style={{ color: theme.textSub }}>
                  暂时没搜到其他源，去聚合搜索里看看更多结果吧
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setSrcOpen(false);
                  onSwitchSource(curBook);
                }}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full text-[13px] font-semibold ring-1 backdrop-blur-xl active:scale-[0.99]"
                style={{ ...glass, color: theme.accent }}
              >
                <RefreshCw className="h-4 w-4" /> 去聚合搜索找更多源
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 目录抽屉（毛玻璃） */}
      {tocOpen && data && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="目录">
          <button type="button" aria-label="关闭目录" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setTocOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[78%] flex-col rounded-t-3xl shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -12px 48px rgba(0,0,0,0.18)` }}
          >
            <div className="flex shrink-0 justify-center pb-1 pt-2.5">
              <span className="h-1 w-10 rounded-full bg-black/10" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-1">
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                目录 · {data.total} 章
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTocReverse((r) => !r)}
                  className="flex items-center gap-1 text-[13px]"
                  style={{ color: theme.accent }}
                >
                  <ArrowDownUp className="h-4 w-4" />
                  {tocReverse ? '倒序' : '正序'}
                </button>
                <button type="button" onClick={() => setTocOpen(false)} className="text-[13px]" style={{ color: theme.textSub }}>
                  收起
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              {tocList.map((c, i) => {
                const realIdx = tocReverse ? data.total - 1 - i : i;
                return (
                  <button
                    key={c.url + i}
                    type="button"
                    onClick={() => {
                      setTocOpen(false);
                      onRead({
                        kind: 'reader',
                        sourceId: curSourceId,
                        bookUrl: curBook.bookUrl,
                        name: data.name || name,
                        author: data.author || author,
                        coverUrl: curBook.coverUrl,
                        startIndex: realIdx,
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left"
                    style={{ background: realIdx === readIdx ? theme.accentSoft : 'transparent' }}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: theme.textMain }}>
                      {c.title}
                    </span>
                    {realIdx === readIdx && (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                        当前
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
