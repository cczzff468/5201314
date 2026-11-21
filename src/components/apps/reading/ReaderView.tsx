'use client';

/**
 * 阅读器：滚动阅读模式
 * - 点按分区：左1/3 上一章、中间唤出/隐藏工具栏、右1/3 下一章
 * - 顶部/底部毛玻璃工具栏（自动隐藏）：书名+章节 / 进度滑杆+前后章+AI伴读+排版
 * - 排版设置实时生效（zustand 本地即时 + 防抖落库）
 * - 翻章自动保存进度（书架记录）并后台生成 AI 章节摘要
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Type, Loader2, List } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  api,
  bgOf,
  fontCss,
  FONT_WEIGHTS,
  themeOf,
  type TocItem,
} from './shared';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { AIChatSheet } from './AIChatSheet';
import type { SubPage } from './ReadingApp';

type ReaderPage = Extract<SubPage, { kind: 'reader' }>;

export function ReaderView({
  page,
  onBack,
  onOpenBook,
}: {
  page: ReaderPage;
  onBack: () => void;
  onOpenBook: (p: ReaderPage) => void;
}) {
  const settings = useReading((s) => s.settings);
  const loadShelf = useReading((s) => s.loadShelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const bg = useMemo(() => bgOf(settings), [settings]);
  const fontCssVal = useMemo(() => fontCss(settings), [settings]);
  const weightCss = useMemo(
    () => (FONT_WEIGHTS.find((w) => w.key === settings.fontWeight) || FONT_WEIGHTS[1]).css,
    [settings.fontWeight],
  );

  const [chapters, setChapters] = useState<TocItem[]>([]);
  const [idx, setIdx] = useState(page.startIndex || 0);
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [loadedIdx, setLoadedIdx] = useState(-1);
  const [err, setErr] = useState('');
  const [barsOn, setBarsOn] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  /** 重试当前章：临时切走 loadedIdx 再触发 effect 重跑 */
  const [retryFlip, setRetryFlip] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自定义字体注入（@font-face dataURL）
  useEffect(() => {
    if (!settings.fontCustom) return;
    let style = document.getElementById('reading-custom-font') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'reading-custom-font';
      document.head.appendChild(style);
    }
    style.textContent = `@font-face{font-family:"ReadingCustomFont";src:url(${settings.fontCustom});font-display:swap;}`;
    return () => {
      style?.remove();
    };
  }, [settings.fontCustom]);

  // 拉目录（书架已缓存则秒开）
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(page.sourceId, page.bookUrl, page.name, page.author)
      .then((d) => {
        if (!alive) return;
        setChapters(d.chapters);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [page.sourceId, page.bookUrl, page.name, page.author]);

  const ch = chapters[idx];
  const loading = loadedIdx !== idx;

  // 拉正文（idx/章节变化自动触发；loading 由 loadedIdx!==idx 推导，首个 setState 都在异步回调里）
  useEffect(() => {
    const chapter = chapters[idx];
    if (!chapter) return;
    let alive = true;
    scrollRef.current?.scrollTo({ top: 0 });
    api
      .chapter(page.sourceId, chapter.url, page.bookUrl, idx, chapter.title)
      .then((d) => {
        if (!alive) return;
        setContent(d.content);
        setSummary(d.summary);
        setErr('');
        setLoadedIdx(idx);
        // 翻章即存进度；不在书架则自动入架（读过的书自动进书架）
        void api
          .shelfAction({
            action: 'progress',
            bookUrl: page.bookUrl,
            chapter: idx,
            chapterTitle: chapter.title,
            book: {
              name: page.name,
              author: page.author,
              coverUrl: page.coverUrl,
              sourceId: page.sourceId,
              sourceName: chapters.length ? undefined : undefined,
              chapters,
            },
          })
          .then(() => loadShelf())
          .catch(() => null);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setErr(e.message || '章节加载失败');
        setContent('');
        setLoadedIdx(idx);
      });
    return () => {
      alive = false;
    };
  }, [idx, chapters, page.sourceId, page.bookUrl, retryFlip]);

  const go = useCallback(
    (delta: number) => {
      const next = idx + delta;
      if (next < 0 || next >= chapters.length) return;
      setIdx(next);
    },
    [idx, chapters.length],
  );

  const paragraphs = useMemo(() => content.split('\n').filter((p) => p.trim()), [content]);
  const titleVisible = settings.titlePosition !== 'hidden';
  const remain = Math.max(0, chapters.length - idx - 1);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: bg.bg, color: bg.text }}>
      {/* 正文滚动区 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{
          paddingLeft: `calc(16px + ${settings.marginLeft}vw)`,
          paddingRight: `calc(16px + ${settings.marginRight}vw)`,
          paddingTop: `calc(46px + ${settings.marginTop}vh)`,
          paddingBottom: `calc(52px + ${settings.marginBottom}vh)`,
        }}
      >
        {/* 点按分区层（覆盖正文之上，透明） */}
        <div className="absolute inset-0 z-10 flex" aria-hidden="false">
          <button type="button" aria-label="上一章" className="h-full w-1/3" onClick={() => go(-1)} />
          <button type="button" aria-label="菜单" className="h-full w-1/3" onClick={() => setBarsOn((v) => !v)} />
          <button type="button" aria-label="下一章" className="h-full w-1/3" onClick={() => go(1)} />
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16" style={{ color: bg.sub }}>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[13px]">正在抓取正文…</span>
          </div>
        )}
        {err && !loading && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <p className="text-[14px]" style={{ color: bg.sub }}>
              {err}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setLoadedIdx(-1);
                  setRetryFlip((f) => !f);
                }}
                className="rounded-full px-4 py-1.5 text-[13px] font-semibold"
                style={{ background: theme.accent, color: '#fff' }}
              >
                重试
              </button>
              <button type="button" onClick={() => go(1)} className="rounded-full px-4 py-1.5 text-[13px] font-medium" style={{ background: 'rgba(128,128,128,0.14)', color: bg.text }}>
                下一章
              </button>
            </div>
          </div>
        )}
        {!loading && !err && (
          <article>
            {titleVisible && (
              <h2
                className={`mb-4 text-[1.12em] font-bold ${settings.titlePosition === 'center' ? 'text-center' : 'text-left'}`}
                style={{ letterSpacing: `${settings.letterSpacing * 0.6}px` }}
              >
                {ch?.title || `第${idx + 1}章`}
              </h2>
            )}
            <div
              style={{
                fontFamily: fontCssVal,
                fontWeight: weightCss,
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineSpacing,
                letterSpacing: `${settings.letterSpacing}px`,
                textAlign: settings.justify ? 'justify' : 'start',
                textDecoration: settings.underline ? 'underline' : 'none',
                textDecorationThickness: settings.underline ? '1px' : undefined,
                textUnderlineOffset: settings.underline ? '0.25em' : undefined,
              }}
            >
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  className="min-h-[1em]"
                  style={{
                    marginBottom: `${settings.paraSpacing}em`,
                    textIndent: '2em',
                    display: settings.bottomAlign && i === paragraphs.length - 1 ? 'flex' : undefined,
                    alignItems: settings.bottomAlign && i === paragraphs.length - 1 ? 'flex-end' : undefined,
                    minHeight: settings.bottomAlign && i === paragraphs.length - 1 ? undefined : undefined,
                  }}
                >
                  {p}
                </p>
              ))}
            </div>
            {/* 章末导航 */}
            <div className="mt-10 flex items-center justify-between pb-8">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={idx <= 0}
                className="flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-35"
                style={{ background: 'rgba(128,128,128,0.12)', color: bg.text }}
              >
                <ChevronLeft className="h-4 w-4" /> 上一章
              </button>
              <span className="text-[11px]" style={{ color: bg.sub }}>
                还剩 {remain} 章
              </span>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={idx >= chapters.length - 1}
                className="flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-35"
                style={{ background: theme.accent }}
              >
                下一章 <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </article>
        )}
      </div>

      {/* 顶部毛玻璃栏 */}
      {barsOn && (
        <div className="absolute inset-x-0 top-0 z-20 flex h-[54px] items-center gap-1 px-2 backdrop-blur-2xl" style={{ background: 'rgba(255,255,255,0.72)', color: '#1A1D26', boxShadow: '0 1px 0 rgba(0,0,0,0.06)' }}>
          <button type="button" onClick={onBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full active:scale-90">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[14px] font-semibold">{page.name}</p>
            <p className="truncate text-[11px] opacity-60">{ch?.title}</p>
          </div>
          <button
            type="button"
            onClick={() => setTocOpen(true)}
            aria-label="目录"
            className="flex h-10 w-10 items-center justify-center rounded-full active:scale-90"
          >
            <List className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* 底部毛玻璃工具栏 */}
      {barsOn && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl"
          style={{ background: 'rgba(255,255,255,0.75)', boxShadow: '0 -1px 0 rgba(0,0,0,0.06)' }}
        >
          <div className="flex items-center gap-2 text-[#1A1D26]">
            <span className="w-[52px] shrink-0 text-[11px] tabular-nums opacity-70">
              {idx + 1}/{chapters.length}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, chapters.length - 1)}
              value={idx}
              onChange={(e) => setIdx(parseInt(e.target.value, 10))}
              aria-label="章节进度"
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-black/10 accent-[#2274F0] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2274F0]"
            />
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              aria-label="AI 伴读"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
              style={{ color: theme.accent }}
            >
              <Sparkles className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="排版设置"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
              style={{ color: theme.accent }}
            >
              <Type className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* 目录抽屉 */}
      {tocOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="目录">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35" onClick={() => setTocOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[82%] flex-col rounded-r-3xl shadow-2xl" style={{ background: theme.pageBg }}>
            <p className="px-5 pb-2 pt-5 text-[16px] font-bold" style={{ color: theme.textMain }}>
              {page.name} · {chapters.length} 章
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              {chapters.map((c, i) => (
                <button
                  key={c.url + i}
                  type="button"
                  onClick={() => {
                    setTocOpen(false);
                    setIdx(i);
                  }}
                  className="flex w-full items-center rounded-xl px-3 py-2.5 text-left"
                  style={{ background: i === idx ? theme.accentSoft : 'transparent' }}
                >
                  <span className="truncate text-[14px]" style={{ color: i === idx ? theme.accent : theme.textMain }}>
                    {c.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 排版设置（实时预览） */}
      {settingsOpen && <ReaderSettingsSheet onClose={() => setSettingsOpen(false)} />}

      {/* AI 伴读 */}
      {chatOpen && (
        <AIChatSheet
          bookUrl={page.bookUrl}
          name={page.name}
          author={page.author}
          totalChapters={chapters.length}
          currentChapter={idx}
          currentChapterTitle={ch?.title || ''}
          summary={summary}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}
