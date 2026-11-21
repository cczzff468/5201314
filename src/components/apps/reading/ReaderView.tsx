'use client';

/**
 * 阅读器 · 左右分页模式（真机小说 App 体验）
 * ---------------------------------------------------------------------------
 * - 分页：CSS 多列布局（每列一页宽，固定高度 → 溢出列横向排布），translateX 翻页；
 *         字号/行距/边距变化自动重算页数（实时预览）
 * - 翻页手势：跟手位移 + 松手动画。手指左滑（dx<0）下一页 / 右滑（dx>0）上一页；
 *         章内页翻尽后继续滑 → 翻章（提示胶囊显示「下一章 / 上一章」），不再跳章
 * - 点按分区：左 1/3 上一页 · 中间唤出工具 · 右 1/3 下一页
 * - 沉浸模式：打开期间状态栏与灵动岛整体隐藏（PhoneShell 层），退出自动恢复
 * - 工具：顶部/底部悬浮毛玻璃胶囊 Dock（返回+书名+目录 / 进度滑杆+AI伴读+排版）
 * - 进度记忆：翻页防抖、翻章立即保存（章节 + 章内页码），从书架/历史/详情打开时续读
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Type, Loader2, List } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { setImmersive } from '@/lib/ios/immersive-store';
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

/** 页间距（跟手滑动时可见下一页边缘，增强翻页手感） */
const PAGE_GAP = 28;

export function ReaderView({
  page,
  onBack,
}: {
  page: ReaderPage;
  onBack: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const loadShelf = useReading((s) => s.loadShelf);
  const sourcesList = useReading((s) => s.sources);
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
  /** 翻章方向动画（1=前进，-1=后退） */
  const [flipDir, setFlipDir] = useState(1);
  /** 重试当前章：临时切走 loadedIdx 再触发 effect 重跑 */
  const [retryFlip, setRetryFlip] = useState(false);

  // ---- 分页状态 ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  /** 视口尺寸（页宽/页高，来自 wrapRef 实测） */
  const [vp, setVp] = useState({ w: 0, h: 0 });
  /** 本章总页数（内容布局后实测） */
  const [pages, setPages] = useState(1);
  /** 章内页码（0-based） */
  const [curPage, setCurPage] = useState(page.startPage || 0);
  /** 翻到上一章时回退到最后一页（等 pages 算好后落位） */
  const pendingLastRef = useRef(false);
  /** 滑动跟手位移（px；ref 供事件闭包读实时值，state 供渲染） */
  const [swipeDx, setSwipeDx] = useState(0);
  const swipeDxRef = useRef(0);
  const touchRef = useRef<{ x: number; y: number; t: number; horiz: boolean } | null>(null);
  /** 滑动后抑制点按（防松手误触翻页分区） */
  const suppressClickRef = useRef(false);

  // 沉浸模式：打开阅读器隐藏状态栏 + 灵动岛，退出恢复
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, []);

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
  const sourceName = useMemo(
    () => sourcesList.find((s) => s.id === page.sourceId)?.name || '',
    [sourcesList, page.sourceId],
  );

  // ------------------------------------------------------------------
  // 进度保存（章节+页码；翻页防抖 900ms，翻章立即）
  // ------------------------------------------------------------------
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgress = useCallback(
    (chapterIdx: number, pageNum: number, chapterTitle: string, immediate: boolean) => {
      if (saveRef.current) clearTimeout(saveRef.current);
      const doSave = () => {
        void api
          .shelfAction({
            action: 'progress',
            bookUrl: page.bookUrl,
            chapter: chapterIdx,
            page: pageNum,
            chapterTitle,
            book: {
              name: page.name,
              author: page.author,
              coverUrl: page.coverUrl,
              sourceId: page.sourceId,
              sourceName,
              totalChapters: chapters.length,
            },
          })
          .then(() => loadShelf())
          .catch(() => null);
      };
      if (immediate) doSave();
      else saveRef.current = setTimeout(doSave, 900);
    },
    [page.bookUrl, page.name, page.author, page.coverUrl, page.sourceId, sourceName, chapters.length, loadShelf],
  );

  // 拉正文（idx/章节变化自动触发；loading 由 loadedIdx!==idx 推导）
  useEffect(() => {
    const chapter = chapters[idx];
    if (!chapter) return;
    let alive = true;
    api
      .chapter(page.sourceId, chapter.url, page.bookUrl, idx, chapter.title)
      .then((d) => {
        if (!alive) return;
        setContent(d.content);
        setSummary(d.summary);
        setErr('');
        setLoadedIdx(idx);
        saveProgress(idx, curPage, chapter.title, false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, chapters, page.sourceId, page.bookUrl, retryFlip]);

  // ------------------------------------------------------------------
  // 视口尺寸（ResizeObserver；旋转/窗口变化时重算分页）
  // 内容区宽 = wrap.clientWidth - 左右 padding（列宽必须等于内容区宽，
  // 否则多列横向溢出的每列步长与 translateX 不一致 → 翻页错位看到双栏）
  // ------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setVp((v) => (Math.abs(v.w - w) < 0.5 ? v : { ...v, w: Math.max(0, w) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------
  // 分页计算：内容/排版/视口变化 → 重算总页数（多列 scrollWidth 实测）
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!colRef.current || !vp.w || !content || loading) return;
    // 核对内容区宽（边距设置变化时 sync；列宽=内容区宽 → 每列正好一页）
    const wrap = wrapRef.current;
    if (wrap) {
      const cs = getComputedStyle(wrap);
      const w = wrap.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (Math.abs(w - vp.w) >= 0.5) {
        setVp({ ...vp, w: Math.max(0, w) });
        return; // 先修正列宽，下一轮再算页数
      }
    }
    const recompute = () => {
      const el = colRef.current;
      if (!el) return;
      const sw = el.scrollWidth;
      const n = Math.max(1, Math.round((sw + PAGE_GAP) / (vp.w + PAGE_GAP)));
      setPages(n);
      if (pendingLastRef.current) {
        // 从下一章往回翻：落位到上一章最后一页
        pendingLastRef.current = false;
        setCurPage(Math.max(0, n - 1));
      } else {
        setCurPage((p) => Math.min(p, n - 1));
      }
    };
    recompute();
    // 字体晚到会改变布局：字体就绪后再核一次
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        requestAnimationFrame(recompute);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, vp.w, vp.h, settings.fontSize, settings.lineSpacing, settings.paraSpacing, settings.letterSpacing, settings.marginLeft, settings.marginRight, settings.marginTop, settings.marginBottom, settings.fontFamily, settings.fontCustom, settings.fontWeight, settings.titlePosition, settings.justify, settings.underline]);

  /** 翻页后延迟保存进度 */
  useEffect(() => {
    if (loading) return;
    saveProgress(idx, curPage, ch?.title || '', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, curPage]);

  // ------------------------------------------------------------------
  // 导航：页/章（ref 镜像当前值，快速连滑不踩 stale state 竞态）
  // ------------------------------------------------------------------
  const navRef = useRef({ page: 0, pages: 1, idx: 0, total: 0 });
  // ref 镜像 state（commit 后同步；连滑时 handler 已先行更新，此处兜底纠偏）
  useEffect(() => {
    navRef.current = { page: curPage, pages, idx, total: chapters.length };
  }, [curPage, pages, idx, chapters.length]);

  /** 翻章：atPage='last' 时回退到上一章最后一页（等分页算好落位） */
  const goChapter = useCallback((delta: number, atPage: 'first' | 'last' = 'first') => {
    const s = navRef.current;
    const next = s.idx + delta;
    if (next < 0 || next >= s.total) return false;
    navRef.current = { ...s, idx: next, page: 0 };
    setFlipDir(delta);
    setIdx(next);
    if (atPage === 'last') pendingLastRef.current = true;
    setCurPage(0);
    return true;
  }, []);

  /** 翻页：dir=+1 下一页（前进：左滑/点右区），dir=-1 上一页（后退：右滑/点左区）；
   *  章末继续前进 → 下一章；章首继续后退 → 上一章末页 */
  const turnPage = useCallback(
    (dir: 1 | -1) => {
      const s = navRef.current;
      const np = s.page + dir;
      if (np >= 0 && np < s.pages) {
        navRef.current = { ...s, page: np };
        setCurPage(np);
        return true;
      }
      return goChapter(dir, dir < 0 ? 'last' : 'first');
    },
    [goChapter],
  );

  // ------------------------------------------------------------------
  // 触摸：跟手横滑（左滑下一页 / 右滑上一页；章边界继续滑翻章）+ 点按分区
  // ------------------------------------------------------------------
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), horiz: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touchRef.current;
    if (!t || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (!t.horiz && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) t.horiz = true;
    if (t.horiz) {
      swipeDxRef.current = dx;
      setSwipeDx(dx);
    }
  };
  const onTouchEnd = () => {
    const t = touchRef.current;
    touchRef.current = null;
    const dx = swipeDxRef.current;
    swipeDxRef.current = 0;
    setSwipeDx(0);
    if (t?.horiz && Math.abs(dx) > 8) suppressClickRef.current = true;
    if (t?.horiz && Math.abs(dx) > 58) {
      // 手指左滑（dx<0）= 下一页（前进）；右滑（dx>0）= 上一页（后退）
      turnPage(dx < 0 ? 1 : -1);
    }
  };
  const onZoneClick = (zone: 'prev' | 'menu' | 'next') => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (zone === 'menu') setBarsOn((v) => !v);
    else if (zone === 'next') turnPage(1);
    else turnPage(-1);
  };

  const paragraphs = useMemo(() => content.split('\n').filter((p) => p.trim()), [content]);
  const titleVisible = settings.titlePosition !== 'hidden';
  const remain = Math.max(0, chapters.length - idx - 1);
  const colW = vp.w || 1;
  /** 当前位移：基准页位 + 跟手偏移 */
  const translateX = -(curPage * (colW + PAGE_GAP)) + swipeDx;
  const swiping = swipeDx !== 0;
  /** 滑动提示（章边界显示翻章） */
  const swipeHint = !swiping
    ? ''
    : swipeDx < -58
      ? curPage >= pages - 1
        ? '下一章'
        : '下一页'
      : swipeDx > 58
        ? curPage <= 0
          ? '上一章'
          : '上一页'
        : Math.abs(swipeDx) > 14
          ? swipeDx > 0
            ? '继续右滑'
            : '继续左滑'
          : '';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: bg.bg, color: bg.text }}>
      {/* 翻章动画 keyframes */}
      <style>{`@keyframes rd-flip-l{from{opacity:.3;transform:translateX(30px)}to{opacity:1;transform:none}}
      @keyframes rd-flip-r{from{opacity:.3;transform:translateX(-30px)}to{opacity:1;transform:none}}`}</style>

      {/* 正文视口（padding 定页边距；内层 clipper 严格按内容区裁切，相邻页不漏边） */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          paddingLeft: `calc(18px + ${settings.marginLeft}vw)`,
          paddingRight: `calc(18px + ${settings.marginRight}vw)`,
          paddingTop: `calc(22px + ${settings.marginTop}vh)`,
          paddingBottom: `calc(64px + ${settings.marginBottom}vh)`,
        }}
      >
        {/* 点按分区层（透明；横滑中禁点） */}
        <div className={`absolute inset-0 z-10 flex ${swiping ? 'pointer-events-none' : ''}`} aria-hidden="false">
          <button type="button" aria-label="上一页" className="h-full w-1/3" onClick={() => onZoneClick('prev')} />
          <button type="button" aria-label="菜单" className="h-full w-1/3" onClick={() => onZoneClick('menu')} />
          <button type="button" aria-label="下一页" className="h-full w-1/3" onClick={() => onZoneClick('next')} />
        </div>

        {/* 裁切层：宽高 = wrap 内容区（多列横向溢出只露出当前页） */}
        <div className="h-full w-full overflow-hidden">
        {/* 多列分页内容（每列一页；translateX 翻页 + 跟手） */}
        <div
          key={idx}
          ref={colRef}
          className={`h-full ${flipDir > 0 ? '[animation:rd-flip-l_.3s_ease]' : '[animation:rd-flip-r_.3s_ease]'}`}
          style={{
            columnWidth: `${colW}px`,
            columnGap: `${PAGE_GAP}px`,
            columnFill: 'auto',
            transform: `translateX(${translateX}px)`,
            transition: swiping ? 'none' : 'transform 0.30s cubic-bezier(0.22, 0.61, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16" style={{ color: bg.sub }}>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[13px]">正在抓取正文…</span>
            </div>
          )}
          {err && !loading && (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <p className="px-6 text-[14px]" style={{ color: bg.sub }}>
                {err}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setLoadedIdx(-1);
                    setRetryFlip((f) => !f);
                  }}
                  className="rounded-full px-4 py-1.5 text-[13px] font-semibold text-white shadow-md"
                  style={{ background: theme.accent }}
                >
                  重试
                </button>
                <button type="button" onClick={() => goChapter(1)} className="rounded-full px-4 py-1.5 text-[13px] font-medium backdrop-blur-xl" style={{ background: 'rgba(128,128,128,0.16)', color: bg.text }}>
                  下一章
                </button>
              </div>
            </div>
          )}
          {!loading && !err && (
            <article
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
              {titleVisible && (
                <div className={`mb-5 ${settings.titlePosition === 'center' ? 'flex flex-col items-center' : ''}`}>
                  <h2
                    className={`text-[1.12em] font-bold ${settings.titlePosition === 'center' ? 'text-center' : 'text-left'}`}
                    style={{ letterSpacing: `${settings.letterSpacing * 0.6}px` }}
                  >
                    {ch?.title || `第${idx + 1}章`}
                  </h2>
                  <span className="mt-2 flex items-center gap-1.5" aria-hidden="true">
                    <span className="h-px w-5" style={{ background: bg.sub, opacity: 0.5 }} />
                    <span className="text-[10px]" style={{ color: bg.sub, opacity: 0.85 }}>
                      {idx + 1}/{chapters.length}
                    </span>
                    <span className="h-px w-5" style={{ background: bg.sub, opacity: 0.5 }} />
                  </span>
                </div>
              )}
              {paragraphs.map((p, i) => (
                <p key={i} className="min-h-[1em]" style={{ marginBottom: `${settings.paraSpacing}em`, textIndent: '2em' }}>
                  {p}
                </p>
              ))}
              {/* 章末：本章完 + 上下章胶囊（跟随流内容，出现在最后一页） */}
              <div className="mt-10 flex flex-col items-center gap-4 pb-6">
                <span className="flex items-center gap-2 text-[11px]" style={{ color: bg.sub }}>
                  <span className="h-px w-8" style={{ background: bg.sub, opacity: 0.4 }} />
                  本章完 · 还剩 {remain} 章
                  <span className="h-px w-8" style={{ background: bg.sub, opacity: 0.4 }} />
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => goChapter(-1)}
                    disabled={idx <= 0}
                    className="flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-medium backdrop-blur-xl disabled:opacity-35"
                    style={{ background: 'rgba(128,128,128,0.13)', color: bg.text }}
                  >
                    <ChevronLeft className="h-4 w-4" /> 上一章
                  </button>
                  <button
                    type="button"
                    onClick={() => goChapter(1)}
                    disabled={idx >= chapters.length - 1}
                    className="flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-md disabled:opacity-35"
                    style={{ background: theme.accent, boxShadow: `0 4px 14px ${theme.accent}44` }}
                  >
                    下一章 <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          )}
        </div>
        </div>
      </div>

      {/* 滑动提示胶囊（跟手） */}
      {swipeHint && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white shadow-xl backdrop-blur-xl"
          style={{ background: 'rgba(0,0,0,0.45)' }}
        >
          {swipeHint}
        </div>
      )}

      {/* 页码指示（沉浸小字，底部居中；避开 Home 横杆） */}
      {!loading && !err && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-[max(28px,calc(env(safe-area-inset-bottom)+16px))] z-10 flex justify-center"
          aria-hidden="true"
        >
          <span className="text-[10px] tabular-nums" style={{ color: bg.sub, opacity: 0.9 }}>
            {curPage + 1}/{pages} 页 · 第 {idx + 1}/{chapters.length || '?'} 章
          </span>
        </div>
      )}

      {/* 顶部悬浮毛玻璃胶囊（沉浸模式下贴近屏幕顶） */}
      {barsOn && (
        <div
          className="absolute inset-x-3 z-20 flex h-[52px] items-center gap-1 rounded-full px-2 backdrop-blur-2xl"
          style={{
            top: 'max(10px, env(safe-area-inset-top))',
            background: 'rgba(255,255,255,0.78)',
            color: '#1A1D26',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.12)',
          }}
        >
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

      {/* 底部悬浮毛玻璃胶囊 Dock */}
      {barsOn && (
        <div
          className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-20 rounded-[26px] px-4 pb-2 pt-3 backdrop-blur-2xl"
          style={{
            background: 'rgba(255,255,255,0.80)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05), 0 12px 36px rgba(0,0,0,0.14)',
          }}
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
              onChange={(e) => {
                setFlipDir(parseInt(e.target.value, 10) > idx ? 1 : -1);
                setIdx(parseInt(e.target.value, 10));
                setCurPage(0);
              }}
              aria-label="章节进度"
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-black/10 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2274F0]"
              style={{ accentColor: theme.accent }}
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

      {/* 目录抽屉（毛玻璃） */}
      {tocOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="目录">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setTocOpen(false)} />
          <div
            className="absolute inset-y-0 left-0 flex w-[82%] flex-col rounded-r-3xl shadow-2xl backdrop-blur-2xl"
            style={{
              background: theme.pageBg,
              boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 12px 0 40px rgba(0,0,0,0.2)`,
            }}
          >
            <p className="px-5 pb-2 pt-[max(20px,calc(env(safe-area-inset-top)+24px))] text-[16px] font-bold" style={{ color: theme.textMain }}>
              {page.name} · {chapters.length} 章
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              {chapters.map((c, i) => (
                <button
                  key={c.url + i}
                  type="button"
                  onClick={() => {
                    setTocOpen(false);
                    setFlipDir(i > idx ? 1 : -1);
                    setIdx(i);
                    setCurPage(0);
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

      {/* 排版设置（实时预览；分页模式下底部对齐选项不再适用，由面板内部隐藏） */}
      {settingsOpen && <ReaderSettingsSheet onClose={() => setSettingsOpen(false)} />}

      {/* AI 伴读（先选联系人再陪读） */}
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
