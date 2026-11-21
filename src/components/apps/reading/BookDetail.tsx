'use client';

/**
 * 书籍详情页：封面+信息+简介+操作按钮（开始阅读/加入书架/换源）
 * + 目录抽屉（章节列表，当前进度高亮，正序/倒序切换）
 * 加入书架时缓存目录；「换源」回聚合搜索页
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Check, ArrowDownUp, RefreshCw, Loader2 } from 'lucide-react';
import {
  api,
  CoverPlaceholder,
  findStartIndex,
  themeOf,
  type BookDetailData,
  type SearchBookItem,
} from './shared';
import { SubNavBar, type SubPage } from './ReadingApp';
import { useReading } from '@/lib/reading/store';

type ReaderPage = Extract<SubPage, { kind: 'reader' }>;

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
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [data, setData] = useState<BookDetailData | null>(null);
  const [err, setErr] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [tocReverse, setTocReverse] = useState(false);
  const [inShelf, setInShelf] = useState(false);
  const book = page.book;
  const sourceId = page.sourceId || book.sourceId || '';

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(sourceId, book.bookUrl, book.name, book.author || '')
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
  }, [sourceId, book.bookUrl, book.name, book.author, reloadKey]);

  const shelfEntry = shelf.find((b) => b.bookUrl === book.bookUrl);
  const readIdx = data?.lastReadChapter ?? shelfEntry?.lastReadChapter ?? 0;

  const startReading = () => {
    if (!data || data.chapters.length === 0) return;
    const idx = readIdx > 0 ? readIdx : findStartIndex(data.chapters);
    onRead({
      kind: 'reader',
      sourceId,
      bookUrl: book.bookUrl,
      name: data.name || book.name,
      author: data.author || book.author || '',
      coverUrl: book.coverUrl,
      startIndex: idx,
    });
  };

  const toggleShelf = async () => {
    if (!data) return;
    if (inShelf) {
      await api.shelfAction({ action: 'remove', bookUrl: book.bookUrl }).catch(() => null);
      setInShelf(false);
    } else {
      await api
        .shelfAction({
          action: 'add',
          book: {
            name: data.name || book.name,
            author: data.author || book.author,
            coverUrl: book.coverUrl,
            intro: data.intro,
            sourceId,
            sourceName: book.sourceName,
            bookUrl: book.bookUrl,
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

  return (
    <div className="flex h-full flex-col">
      <SubNavBar
        title={data?.name || book.name}
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
            onClick={() => onSwitchSource(book)}
            className="rounded-full px-5 py-2 text-[13px] font-semibold text-white"
            style={{ background: theme.accent }}
          >
            换个书源试试
          </button>
        </div>
      )}
      {data && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
          {/* 信息头卡 */}
          <div className="flex gap-4">
            {data.coverUrl || book.coverUrl ? (
              <img
                src={data.coverUrl || book.coverUrl}
                alt=""
                className="h-[136px] w-[100px] shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-black/5"
                referrerPolicy="no-referrer"
              />
            ) : (
              <CoverPlaceholder name={data.name || book.name} className="h-[136px] w-[100px] shrink-0 shadow-lg" />
            )}
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-[20px] font-bold leading-snug" style={{ color: theme.textMain }}>
                {data.name || book.name}
              </h1>
              <p className="mt-1 text-[13px]" style={{ color: theme.textSub }}>
                {data.author || book.author || '佚名'}
              </p>
              <p className="mt-2 text-[12px]" style={{ color: theme.textSub }}>
                共 {data.total} 章{data.lastChapter ? ` · 最新：${data.lastChapter.slice(0, 16)}` : ''}
              </p>
              <span
                className="mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ background: theme.accentSoft, color: theme.accent }}
              >
                {book.sourceName}
              </span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              onClick={startReading}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-white shadow-lg active:scale-95"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
            >
              <BookOpen className="h-[18px] w-[18px]" />
              {readIdx > 0 ? `继续读 · 第${readIdx + 1}章` : '开始阅读'}
            </button>
            <button
              type="button"
              onClick={() => void toggleShelf()}
              aria-label={inShelf ? '移出书架' : '加入书架'}
              className="flex h-12 w-12 items-center justify-center rounded-2xl ring-1 backdrop-blur-xl active:scale-90"
              style={{ background: theme.cardBg, color: inShelf ? theme.accent : theme.textMain, ['--tw-ring-color' as string]: theme.cardRing }}
            >
              {inShelf ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>

          {/* 简介卡 */}
          {data.intro && (
            <div className="mt-4 rounded-2xl p-4 ring-1 backdrop-blur-xl" style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}>
              <p className="text-[13px] leading-relaxed" style={{ color: theme.textSub }}>
                {data.intro.length > 160 ? `${data.intro.slice(0, 160)}…` : data.intro}
              </p>
            </div>
          )}

          {/* 目录卡 */}
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl p-4 ring-1 backdrop-blur-xl active:scale-[0.99]"
            style={{ background: theme.cardBg, ['--tw-ring-color' as string]: theme.cardRing }}
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

          {/* 前5章预览 */}
          <div className="mt-3 space-y-1">
            {data.chapters.slice(findStartIndex(data.chapters), findStartIndex(data.chapters) + 6).map((c, i) => (
              <button
                key={c.url + i}
                type="button"
                onClick={() =>
                  onRead({
                    kind: 'reader',
                    sourceId,
                    bookUrl: book.bookUrl,
                    name: data.name || book.name,
                    author: data.author || book.author || '',
                    coverUrl: book.coverUrl,
                    startIndex: findStartIndex(data.chapters) + i,
                  })
                }
                className="flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left active:scale-[0.99]"
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

      {/* 目录抽屉 */}
      {tocOpen && data && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="目录">
          <button type="button" aria-label="关闭目录" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setTocOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[78%] flex-col rounded-t-3xl shadow-2xl"
            style={{ background: theme.pageBg }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
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
                        sourceId,
                        bookUrl: book.bookUrl,
                        name: data.name || book.name,
                        author: data.author || book.author || '',
                        coverUrl: book.coverUrl,
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
                      <span className="shrink-0 text-[11px] font-medium" style={{ color: theme.accent }}>
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
