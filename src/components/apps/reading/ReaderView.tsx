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
 * - 工具（参照主流阅读器设计）：
 *   顶部浮动卡片：返回 + 书名/章节 + 换源 · 缓存 · 章节搜索 · 刷新
 *   底部浮动面板：上一章 | 章节进度条 | 下一章 ／ 目录 · 夜间 · AI伴读 · 排版 · 朗读
 *   夜间一键切换阅读背景；朗读为 Web Speech 全章 TTS；换源在架时自动迁移书架记录
 * - 进度记忆：翻页防抖、翻章立即保存（章节 + 章内页码），从书架/历史/详情打开时续读
 * - 阅读时长：每 15s 上报一次（页面可见时），「我」页展示累计时间
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  SlidersHorizontal,
  Loader2,
  List,
  Moon,
  Sun,
  Volume2,
  ArrowDownUp,
  Download,
  Search,
  RotateCw,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { setImmersive } from '@/lib/ios/immersive-store';
import {
  api,
  bgOf,
  fontCss,
  FONT_WEIGHTS,
  themeOf,
  matchChapterIndex,
  type TocItem,
} from './shared';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { AIChatSheet } from './AIChatSheet';
import type { SubPage } from './ReadingApp';

type ReaderPage = Extract<SubPage, { kind: 'reader' }>;

/** 页间距（跟手滑动时可见下一页边缘，增强翻页手感） */
const PAGE_GAP = 28;

/** 换源候选 */
interface SwitchCand {
  sourceId: string;
  sourceName: string;
  name: string;
  author: string;
  bookUrl: string;
}

export function ReaderView({
  page,
  onBack,
}: {
  page: ReaderPage;
  onBack: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const patch = useReading((s) => s.patchSettings);
  const loadShelf = useReading((s) => s.loadShelf);
  const sourcesList = useReading((s) => s.sources);
  const shelf = useReading((s) => s.shelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const bg = useMemo(() => bgOf(settings), [settings]);
  const fontCssVal = useMemo(() => fontCss(settings), [settings]);
  const weightCss = useMemo(
    () => (FONT_WEIGHTS.find((w) => w.key === settings.fontWeight) || FONT_WEIGHTS[1]).css,
    [settings.fontWeight],
  );

  // 当前书源/地址（换源时在本地切换，不动导航栈）
  const [src, setSrc] = useState({
    sourceId: page.sourceId,
    bookUrl: page.bookUrl,
    name: page.name,
    author: page.author,
    coverUrl: page.coverUrl || '',
  });
  /** 本地导入书（无在线源操作） */
  const isLocal = src.sourceId === 'local' || src.bookUrl.startsWith('local:');

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
  /** 本次抓取是否强制刷新（跳过缓存） */
  const refreshReqRef = useRef(false);

  // 换源 / 章节搜索 / 朗读 / 轻提示
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcCands, setSrcCands] = useState<SwitchCand[]>([]);
  const [srcBusy, setSrcBusy] = useState(false);
  const [chSearchOpen, setChSearchOpen] = useState(false);
  const [chSearchKw, setChSearchKw] = useState('');
  const [ttsOn, setTtsOn] = useState(false);
  const [toast, setToast] = useState('');

  const notify = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? '' : cur)), 2200);
  }, []);

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

  // 阅读时长：每 15s 上报一次（页面不可见时不计）
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void api.readTimeAdd(15).catch(() => null);
      }
    }, 15_000);
    return () => clearInterval(t);
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

  // 拉目录（书架已缓存则秒开；换源后 src 变化重拉）
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(src.sourceId, src.bookUrl, src.name, src.author)
      .then((d) => {
        if (!alive) return;
        setChapters((prev) => (prev.length === d.chapters.length ? prev : d.chapters));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [src.sourceId, src.bookUrl, src.name, src.author]);

  const ch = chapters[idx];
  const loading = loadedIdx !== idx;
  const sourceName = useMemo(
    () => sourcesList.find((s) => s.id === src.sourceId)?.name || (isLocal ? '本地导入' : ''),
    [sourcesList, src.sourceId, isLocal],
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
            bookUrl: src.bookUrl,
            chapter: chapterIdx,
            page: pageNum,
            chapterTitle,
            book: {
              name: src.name,
              author: src.author,
              coverUrl: src.coverUrl,
              sourceId: src.sourceId,
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
    [src.bookUrl, src.name, src.author, src.coverUrl, src.sourceId, sourceName, chapters.length, loadShelf],
  );

  // 拉正文（idx/章节变化自动触发；loading 由 loadedIdx!==idx 推导）
  useEffect(() => {
    const chapter = chapters[idx];
    if (!chapter) return;
    let alive = true;
    const isRefresh = refreshReqRef.current;
    refreshReqRef.current = false;
    api
      .chapter(src.sourceId, chapter.url, src.bookUrl, idx, chapter.title, isRefresh)
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
  }, [idx, chapters, src.sourceId, src.bookUrl, retryFlip]);

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
  }, [content, vp.w, vp.h, settings.fontSize, settings.lineSpacing, settings.paraSpacing, settings.letterSpacing, settings.marginLeft, settings.marginRight, settings.marginTop, settings.marginBottom, settings.fontFamily, settings.fontCustom, settings.fontWeight, settings.titlePosition, settings.justify, settings.underline]);

  /** 翻页后延迟保存进度 */
  useEffect(() => {
    if (loading) return;
    saveProgress(idx, curPage, ch?.title || '', false);
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

  // ------------------------------------------------------------------
  // 顶部工具：换源 / 缓存 / 章节搜索 / 刷新
  // ------------------------------------------------------------------
  const norm = (x: string) => x.replace(/\s+/g, '');
  const openSwitch = async () => {
    if (isLocal) {
      notify('本地书籍不支持换源');
      return;
    }
    setSrcOpen(true);
    setSrcBusy(true);
    setSrcCands([]);
    const pool = sourcesList
      .filter((s) => s.enabled && s.id !== src.sourceId)
      .sort((a, b) => (a.checkStatus === 'ok' ? -1 : 0) - (b.checkStatus === 'ok' ? -1 : 0))
      .slice(0, 8);
    if (!pool.length) {
      setSrcBusy(false);
      return;
    }
    await Promise.all(
      pool.map(async (s) => {
        try {
          const r = await api.searchOne(src.name, s.id);
          const books = r.books || [];
          const hit =
            books.find((b) => norm(b.name) === norm(src.name)) ||
            books.find((b) => norm(b.name).includes(norm(src.name)) || norm(src.name).includes(norm(b.name)));
          if (hit) {
            setSrcCands((prev) => [
              ...prev,
              { sourceId: s.id, sourceName: s.name, name: hit.name, author: hit.author, bookUrl: hit.bookUrl },
            ]);
          }
        } catch {
          /* 单源失败忽略 */
        }
      }),
    );
    setSrcBusy(false);
  };

  const switchTo = async (c: SwitchCand) => {
    if (srcBusy) return;
    setSrcBusy(true);
    try {
      const d = await api.bookDetail(c.sourceId, c.bookUrl, src.name, src.author);
      if (!d.chapters.length) throw new Error('该源目录为空');
      const oldTitle = ch?.title || null;
      const newIdx = matchChapterIndex(d.chapters, oldTitle, idx);
      // 在架才迁移书架记录（保留进度）；历史随阅读进度自动更新
      const inShelf = shelf.some((b) => b.bookUrl === src.bookUrl);
      if (inShelf) {
        await api
          .shelfAction({
            action: 'switchSource',
            name: src.name,
            author: src.author,
            book: {
              sourceId: c.sourceId,
              sourceName: c.sourceName,
              bookUrl: c.bookUrl,
              coverUrl: src.coverUrl,
              intro: d.intro,
              chapters: d.chapters,
            },
          })
          .catch(() => null);
      }
      setChapters(d.chapters);
      setFlipDir(newIdx >= idx ? 1 : -1);
      setIdx(newIdx);
      setCurPage(0);
      setLoadedIdx(-1);
      setContent('');
      setSrc((s) => ({
        ...s,
        sourceId: c.sourceId,
        bookUrl: c.bookUrl,
        name: d.name || s.name,
        author: d.author || s.author,
      }));
      setSrcOpen(false);
      notify(`已换源：${c.sourceName}`);
      void loadShelf();
    } catch {
      notify('换源失败，换一个试试');
    }
    setSrcBusy(false);
  };

  /** 缓存：预取当前章之后 20 章正文（ChapterCache 落库，离线可读） */
  const cacheNext = async () => {
    if (isLocal) {
      notify('本地书籍无需缓存');
      return;
    }
    notify('正在后台缓存之后 20 章…');
    let ok = 0;
    for (let i = idx + 1; i < Math.min(chapters.length, idx + 21); i++) {
      const c = chapters[i];
      if (!c) break;
      try {
        await api.chapter(src.sourceId, c.url, src.bookUrl, i, c.title);
        ok++;
      } catch {
        /* 单章失败继续 */
      }
    }
    notify(`缓存完成：${ok} 章（离线可读）`);
  };

  /** 刷新：跳过缓存重抓当前章 */
  const refreshChapter = () => {
    refreshReqRef.current = true;
    setLoadedIdx(-1);
    setRetryFlip((f) => !f);
  };

  /** 夜间切换（记住之前的日间背景，切回时恢复） */
  const [prevDayBg, setPrevDayBg] = useState('paper');
  const isNight = settings.bgTheme === 'night';
  const toggleNight = () => {
    if (isNight) {
      patch({ bgTheme: prevDayBg !== 'night' ? prevDayBg : 'paper' });
    } else {
      setPrevDayBg(settings.bgTheme);
      patch({ bgTheme: 'night' });
    }
  };

  /** 朗读：Web Speech 全章 TTS（切章/退出自动停） */
  const speakChapter = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      notify('当前浏览器不支持朗读');
      return;
    }
    window.speechSynthesis.cancel();
    if (ttsOn) {
      setTtsOn(false);
      return;
    }
    if (!content) return;
    const u = new SpeechSynthesisUtterance(`${ch?.title || ''}。${content}`);
    u.lang = 'zh-CN';
    u.rate = 1;
    u.onend = () => setTtsOn(false);
    u.onerror = () => setTtsOn(false);
    window.speechSynthesis.speak(u);
    setTtsOn(true);
  };
  // 切章/卸载停止朗读（cancel 会触发 onend/onerror 回调异步复位 ttsOn）
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [idx]);

  /** 章节搜索结果（标题匹配） */
  const chSearchHits = useMemo(() => {
    const k = chSearchKw.trim();
    if (!k) return [];
    const hits: { i: number; title: string }[] = [];
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].title.includes(k)) hits.push({ i, title: chapters[i].title });
      if (hits.length >= 80) break;
    }
    return hits;
  }, [chSearchKw, chapters]);

  // 工具栏配色（日/夜阅读背景自适应）
  const barCard = bg.dark
    ? { background: 'rgba(30,32,40,0.94)', color: '#E8EAF2', ring: 'rgba(255,255,255,0.08)' }
    : { background: 'rgba(255,255,255,0.94)', color: '#1A1D26', ring: 'rgba(0,0,0,0.05)' };
  const barSub = bg.dark ? 'rgba(232,234,242,0.55)' : 'rgba(26,29,38,0.55)';
  const pillBg = bg.dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.055)';
  const pillDis = bg.dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';

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
                  onClick={refreshChapter}
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

      {/* 轻提示 */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-24 z-[70] flex justify-center px-8">
          <span className="rounded-full bg-black/75 px-4 py-2 text-center text-[13px] text-white backdrop-blur">{toast}</span>
        </div>
      )}

      {/* 朗读中指示 */}
      {ttsOn && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-10 flex justify-center">
          <span
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-xl"
            style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}
          >
            <Volume2 className="h-3 w-3" /> 朗读中 · 再次点击朗读可停止
          </span>
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

      {/* ============ 顶部浮动工具卡（返回 + 书名/章节 + 换源/缓存/搜索/刷新） ============ */}
      {barsOn && (
        <div
          className="absolute inset-x-3 z-20 flex items-center gap-1 rounded-[22px] px-2.5 py-2 backdrop-blur-2xl"
          style={{
            top: 'max(10px, env(safe-area-inset-top))',
            background: barCard.background,
            color: barCard.color,
            boxShadow: `inset 0 0 0 1px ${barCard.ring}, 0 10px 30px rgba(0,0,0,0.14)`,
          }}
          role="toolbar"
          aria-label="阅读工具栏"
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="min-w-0 flex-1 px-0.5">
            <p className="truncate text-[14px] font-semibold leading-tight">{src.name}</p>
            <p className="truncate text-[11px] leading-tight" style={{ color: barSub }}>
              {ch?.title || '加载中…'}
            </p>
          </div>
          {/* 换源 */}
          {!isLocal && (
            <button type="button" onClick={() => void openSwitch()} aria-label="换源" className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full active:scale-90">
              <ArrowDownUp className="h-[19px] w-[19px]" strokeWidth={2.1} />
            </button>
          )}
          {/* 缓存 */}
          {!isLocal && (
            <button type="button" onClick={() => void cacheNext()} aria-label="缓存后续章节" className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full active:scale-90">
              <Download className="h-[19px] w-[19px]" strokeWidth={2.1} />
            </button>
          )}
          {/* 章节搜索 */}
          <button type="button" onClick={() => setChSearchOpen(true)} aria-label="搜索章节" className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full active:scale-90">
            <Search className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </button>
          {/* 刷新 */}
          {!isLocal && (
            <button type="button" onClick={refreshChapter} aria-label="刷新本章" className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full active:scale-90">
              <RotateCw className="h-[18px] w-[18px]" strokeWidth={2.1} />
            </button>
          )}
        </div>
      )}

      {/* ============ 底部浮动工具面板（章节切换条 + 功能按钮排） ============ */}
      {barsOn && (
        <div
          className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-20 rounded-[24px] px-4 pb-2.5 pt-3 backdrop-blur-2xl"
          style={{
            background: barCard.background,
            color: barCard.color,
            boxShadow: `inset 0 0 0 1px ${barCard.ring}, 0 12px 36px rgba(0,0,0,0.16)`,
          }}
        >
          {/* 行1：上一章 | 章节进度 | 下一章 */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => goChapter(-1)}
              disabled={idx <= 0}
              className="h-9 shrink-0 rounded-full px-3.5 text-[12px] font-medium active:scale-95 disabled:opacity-35"
              style={{ background: pillBg, color: barCard.color }}
            >
              上一章
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, chapters.length - 1)}
              value={idx}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setFlipDir(v > idx ? 1 : -1);
                setIdx(v);
                setCurPage(0);
              }}
              aria-label="章节进度"
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full disabled:opacity-40"
              style={{ background: pillBg, accentColor: theme.accent }}
            />
            <button
              type="button"
              onClick={() => goChapter(1)}
              disabled={idx >= chapters.length - 1}
              className="h-9 shrink-0 rounded-full px-3.5 text-[12px] font-medium active:scale-95 disabled:opacity-35"
              style={{ background: pillBg, color: barCard.color }}
            >
              下一章
            </button>
          </div>
          {/* 分隔线 */}
          <div className="my-2 h-px w-full" style={{ background: bg.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }} />
          {/* 行2：目录 · 夜间 · AI伴读 · 排版 · 朗读 */}
          <div className="flex items-stretch justify-between gap-1">
            {[
              {
                key: 'toc',
                label: '目录',
                icon: <List className="h-[21px] w-[21px]" strokeWidth={2} />,
                onClick: () => setTocOpen(true),
              },
              {
                key: 'night',
                label: isNight ? '日间' : '夜间',
                icon: isNight ? <Sun className="h-[21px] w-[21px]" strokeWidth={2} /> : <Moon className="h-[21px] w-[21px]" strokeWidth={2} />,
                onClick: toggleNight,
              },
              {
                key: 'ai',
                label: '伴读',
                icon: <Sparkles className="h-[21px] w-[21px]" strokeWidth={2} />,
                onClick: () => setChatOpen(true),
                accent: true,
              },
              {
                key: 'type',
                label: '排版',
                icon: <SlidersHorizontal className="h-[21px] w-[21px]" strokeWidth={2} />,
                onClick: () => setSettingsOpen(true),
              },
              {
                key: 'tts',
                label: ttsOn ? '停止' : '朗读',
                icon: <Volume2 className="h-[21px] w-[21px]" strokeWidth={2} />,
                onClick: speakChapter,
                accent: ttsOn,
              },
            ].map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                className="flex flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 active:scale-90"
                style={{ color: b.accent ? theme.accent : barCard.color }}
              >
                {b.icon}
                <span className="text-[10px] font-medium" style={{ color: b.accent ? theme.accent : barSub }}>
                  {b.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 换源抽屉（底部玻璃列表） */}
      {srcOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="换源">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setSrcOpen(false)} />
          <div
            className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] max-h-[60%] overflow-y-auto rounded-3xl p-2 shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
          >
            <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-[13px] font-semibold" style={{ color: theme.textSub }}>
              {srcBusy ? '正在搜索其他书源…' : `《${src.name}》的其他书源`}
              {srcBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </p>
            {!srcBusy && srcCands.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px]" style={{ color: theme.textSub }}>
                没有找到其他可用书源
              </p>
            )}
            {srcCands.map((c) => (
              <button
                key={c.sourceId + c.bookUrl}
                type="button"
                disabled={srcBusy}
                onClick={() => void switchTo(c)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-black/[0.03] disabled:opacity-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: theme.accentSoft, color: theme.accent }}>
                  {c.sourceName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium" style={{ color: theme.textMain }}>
                    {c.sourceName}
                  </span>
                  <span className="block truncate text-[11px]" style={{ color: theme.textSub }}>
                    {c.name} · {c.author || '佚名'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 章节搜索抽屉 */}
      {chSearchOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="搜索章节">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setChSearchOpen(false)} />
          <div
            className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] max-h-[68%] rounded-3xl p-4 shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
          >
            <p className="mb-2 text-[14px] font-bold" style={{ color: theme.textMain }}>
              搜索章节
            </p>
            <input
              value={chSearchKw}
              onChange={(e) => setChSearchKw(e.target.value)}
              placeholder="输入章节名关键词，如「决战」"
              className="h-11 w-full rounded-xl bg-black/[0.05] px-3 text-[14px] outline-none"
              style={{ color: theme.textMain }}
              autoFocus
            />
            <div className="mt-3 max-h-[46vh] space-y-1 overflow-y-auto">
              {chSearchKw.trim() && chSearchHits.length === 0 && (
                <p className="py-4 text-center text-[13px]" style={{ color: theme.textSub }}>
                  没有匹配的章节
                </p>
              )}
              {chSearchHits.map((h) => (
                <button
                  key={h.i}
                  type="button"
                  onClick={() => {
                    setChSearchOpen(false);
                    setFlipDir(h.i > idx ? 1 : -1);
                    setIdx(h.i);
                    setCurPage(0);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left"
                  style={{ background: h.i === idx ? theme.accentSoft : 'transparent' }}
                >
                  <span className="shrink-0 text-[11px] tabular-nums" style={{ color: theme.textSub }}>
                    {h.i + 1}
                  </span>
                  <span className="truncate text-[14px]" style={{ color: h.i === idx ? theme.accent : theme.textMain }}>
                    {h.title}
                  </span>
                </button>
              ))}
            </div>
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
              {src.name} · {chapters.length} 章
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
          bookUrl={src.bookUrl}
          name={src.name}
          author={src.author}
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
