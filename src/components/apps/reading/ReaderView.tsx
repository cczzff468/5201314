'use client';

/**
 * 阅读器 · 左右分页模式（真机小说 App 体验）
 * ---------------------------------------------------------------------------
 * - 分页：DOM 逐行测量法（非 CSS 多列）——隐藏测量容器与正文同排版，
 *   用 Range.getClientRects 二分找每行行首边界；按「整行」贪心装页：
 *   · 每页首尾一定是完整的字/行，绝不出现半行截断的「虚线」假象
 *   · 段落跨页续片无首行缩进，避免底部大片空白
 *   · 页宽取整（floor）——页/轨道/测量容器全部整数像素，翻页无亚像素缝隙
 *     （修复：翻页时左右边缘出现「被切开」的空白）
 * - 翻页动画（阅读设置可选）：平移 slide（整排跟手移动）/ 覆盖 cover（新页带阴影盖过
 *   旧页）/ 仿真 curl（3D 翻页）/ 淡入 fade / 滚动 scroll（纵向连续阅读）/ 无动画 none
 * - 翻页方式：跟手横滑 + 点按分区（左1/3上一页·中间菜单·右1/3下一页，可在更多设置关闭）
 *   + 音量键翻页（APK 原生壳直通；预览环境等价方向键/PageUp/Down）
 * - 逐字选选：长按文字进入逐字选择模式（蓝色拖拽手柄 + 复制/划线/查询/搜索工具条，
 *   拖手柄一个字一个字地扩选）；点已有划线可查看笔记·改样式·删除
 * - 书签：上滑手势快速加书签；顶部工具栏书签图标打开书签/划线列表
 * - 自动换源：章节/目录加载失败时自动搜索其他书源并切换（进度按章节映射）
 * - 页脚：页码左下角；章节号默认右下角（开时间/电量后移左下，时间电量占右下）
 * - 沉浸模式：状态栏与灵动岛整体隐藏，退出恢复
 * - 进度记忆：翻页防抖、翻章立即保存（章节 + 章内页码）
 * - 阅读时长：每 15s 上报一次，「我」页展示累计时间
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
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  Bookmark,
  Headphones,
  Copy,
  Trash2,
  StickyNote,
  Underline,
  Search as SearchIcon,
  Globe,
} from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { setImmersive } from '@/lib/ios/immersive-store';
import { localSizeOf, viewportToLocal } from '@/lib/ios/shell-scale';
import { convertLang } from '@/lib/reading/lang-convert';
import {
  api,
  bgOf,
  fontCss,
  FONT_WEIGHTS,
  themeOf,
  matchChapterIndex,
  type ReaderNoteItem,
  type ReaderSettings,
  type TocItem,
} from './shared';
import { ReaderSettingsSheet } from './ReaderSettingsSheet';
import { AIChatSheet } from './AIChatSheet';
import type { SubPage } from './ReadingApp';

type ReaderPage = Extract<SubPage, { kind: 'reader' }>;

/** 换源候选 */
interface SwitchCand {
  sourceId: string;
  sourceName: string;
  name: string;
  author: string;
  bookUrl: string;
}

/** 一页里的一块内容（标题 / 段落切片 / 章末块） */
interface PageSlice {
  kind: 'title' | 'para' | 'end';
  text: string;
  /** 段首缩进（段落第一片 true，跨页续片 false） */
  indent: boolean;
  /** 跨页切断的行 → 末行两端对齐（和真书一致） */
  justifyLast: boolean;
  /** 段落下标（title/end 为 -1；划线定位用） */
  pi: number;
  /** 切片在原段落中的起始字符偏移（划线定位用） */
  off: number;
}

/** 覆盖动画状态：page=即将进来的页，x=当前位移，settle=松手动画中，mode=动画类型 */
interface CoverState {
  page: number;
  x: number;
  settle: boolean;
  commit: boolean;
  mode: 'cover' | 'fade' | 'curl';
}

/** 划线样式 → CSS */
function hlStyleOf(style: string | null | undefined, accent: string): React.CSSProperties {
  if (style === 'box')
    return {
      background: `${accent}30`,
      borderRadius: '3px',
      padding: '1px 1px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    };
  if (style === 'wavy')
    return {
      textDecoration: 'underline wavy',
      textDecorationColor: accent,
      textDecorationThickness: '1.5px',
      textUnderlineOffset: '4px',
    };
  return {
    textDecoration: 'underline',
    textDecorationColor: accent,
    textDecorationThickness: '2px',
    textUnderlineOffset: '4px',
  };
}

// ---------------------------------------------------------------------------
// 小工具：时钟 / 电量
// ---------------------------------------------------------------------------
/** 文本节点内偏移 → 元素内偏移（跨高亮 span 累计） */
function offsetInElement(el: Element, node: Node, off: number): number {
  if (node.nodeType !== 3) return -1;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let cum = 0;
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return cum + off;
    cum += cur.textContent?.length || 0;
    cur = walker.nextNode();
  }
  return -1;
}

/** 元素内全部文本长度 */
function textLenOf(el: Element): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let cum = 0;
  let cur = walker.nextNode();
  while (cur) {
    cum += cur.textContent?.length || 0;
    cur = walker.nextNode();
  }
  return cum;
}

function useClock30s(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const upd = () => setNow(new Date());
    // rAF 异步初始化（避免 effect 内同步 setState）
    const raf = requestAnimationFrame(upd);
    const t = setInterval(upd, 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  return now;
}

interface BatteryInfo {
  level: number;
  charging: boolean;
}
function useBattery(): BatteryInfo | null {
  const [b, setB] = useState<BatteryInfo | null>(null);
  useEffect(() => {
    interface BM {
      level: number;
      charging: boolean;
      addEventListener: (t: string, l: () => void) => void;
      removeEventListener: (t: string, l: () => void) => void;
    }
    const nav = navigator as Navigator & { getBattery?: () => Promise<BM> };
    if (!nav.getBattery) return;
    let bm: BM | null = null;
    let alive = true;
    const upd = () => {
      if (bm) setB({ level: Math.round(bm.level * 100), charging: bm.charging });
    };
    nav
      .getBattery()
      .then((x) => {
        if (!alive) return;
        bm = x;
        upd();
        bm.addEventListener('levelchange', upd);
        bm.addEventListener('chargingchange', upd);
      })
      .catch(() => null);
    return () => {
      alive = false;
      bm?.removeEventListener('levelchange', upd);
      bm?.removeEventListener('chargingchange', upd);
    };
  }, []);
  return b;
}

function BatteryIcon({ info }: { info: BatteryInfo | null }) {
  if (!info) return null;
  if (info.charging) return <BatteryCharging className="h-3 w-3" strokeWidth={2.2} />;
  if (info.level >= 90) return <BatteryFull className="h-3 w-3" strokeWidth={2.2} />;
  if (info.level >= 40) return <BatteryMedium className="h-3 w-3" strokeWidth={2.2} />;
  return <BatteryLow className="h-3 w-3" strokeWidth={2.2} />;
}

// ---------------------------------------------------------------------------
// 标题块 / 章末块（测量容器与真实页面复用同一组件，保证高度一致）
// ---------------------------------------------------------------------------
function TitleBlock({ text, center }: { text: string; center: boolean }) {
  return (
    // pb（非 mb）：padding 计入父容器 rect 高度，测量容器能直接量准
    <div className="pb-5">
      <h2
        className={`text-[1.12em] font-bold leading-snug ${center ? 'text-center' : 'text-left'}`}
        style={{ letterSpacing: undefined }}
      >
        {text}
      </h2>
    </div>
  );
}

function EndBlock({
  remain,
  accent,
  bgText,
  subColor,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  inert,
}: {
  remain: number;
  accent: string;
  bgText: string;
  subColor: string;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** 测量克隆：纯静态不响应点击 */
  inert?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4" style={{ paddingTop: 46, paddingBottom: 14 }}>
      <span className="text-[11px]" style={{ color: subColor }}>
        本章完 · 还剩 {remain} 章
      </span>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={inert ? undefined : onPrev}
          disabled={!inert && !hasPrev}
          className={`flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-medium backdrop-blur-xl disabled:opacity-35 ${inert ? 'pointer-events-none' : 'pointer-events-auto'}`}
          style={{ background: 'rgba(128,128,128,0.13)', color: bgText }}
          tabIndex={inert ? -1 : 0}
        >
          <ChevronLeft className="h-4 w-4" /> 上一章
        </button>
        <button
          type="button"
          onClick={inert ? undefined : onNext}
          disabled={!inert && !hasNext}
          className={`flex items-center gap-1 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-md disabled:opacity-35 ${inert ? 'pointer-events-none' : 'pointer-events-auto'}`}
          style={{ background: accent, boxShadow: `0 4px 14px ${accent}44` }}
          tabIndex={inert ? -1 : 0}
        >
          下一章 <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 阅读器主体
// ---------------------------------------------------------------------------
export function ReaderView({ page, onBack }: { page: ReaderPage; onBack: () => void }) {
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
  /** 翻页动画（scroll=纵向连续阅读；fade/curl 走覆盖动画机制） */
  const animMode: 'slide' | 'cover' | 'none' | 'fade' | 'curl' | 'scroll' = settings.pageAnim || 'slide';
  const coverLike = animMode === 'cover' || animMode === 'fade' || animMode === 'curl';

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
  /** 重试当前章：临时切走 loadedIdx 再触发 effect 重跑；同时重拉目录（TOC 失败场景） */
  const [retryFlip, setRetryFlip] = useState(false);
  /** 目录重拉 tick（目录加载失败→重试按钮触发） */
  const [tocTick, setTocTick] = useState(0);
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

  // ---- 批注（书签 + 划线笔记） ----
  const [notes, setNotes] = useState<ReaderNoteItem[]>([]);
  const [notesVer, setNotesVer] = useState(0);
  /** 长按选中的段落（-1=无；与 notePopup 同生命周期，派生展示） */
  /** 逐字选择状态（pi=段落下标，start/end=段内字符区间 [start,end)，chIdx=归属章） */
  const [sel, setSel] = useState<{ pi: number; start: number; end: number; chIdx: number } | null>(null);
  /** 选择手柄位置（root 内相对坐标；null=隐藏） */
  const [selRects, setSelRects] = useState<{ startX: number; startY: number; endX: number; endY: number; rootW: number } | null>(null);
  /** 滚动模式容器 */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** curPage 镜像（滚动模式恢复位置用；effect 见 curPage 声明之后） */
  const curPageRef = useRef(0);
  /** 划线操作弹窗（含定位；chIdx 归属章——换章自动失效不渲染） */
  const [notePopup, setNotePopup] = useState<{
    pi: number;
    x: number;
    y: number;
    rootW: number;
    rootH: number;
    chIdx: number;
    range?: { start: number; end: number } | null;
  } | null>(null);
  /** 笔记输入框内容（null=未编辑） */
  const [noteInput, setNoteInput] = useState<string | null>(null);
  /** 书签/划线列表抽屉 */
  const [bmOpen, setBmOpen] = useState(false);
  /** 查询（AI 伴读）预置问题 */
  const [chatAsk, setChatAsk] = useState<string | undefined>(undefined);

  /** 当前章的划线 */
  const chHighlights = useMemo(
    () => notes.filter((n) => n.kind === 'highlight' && n.chapterIndex === idx),
    [notes, idx],
  );
  /** 当前书的书签 */
  const bookmarks = useMemo(() => notes.filter((n) => n.kind === 'bookmark'), [notes]);
  const bumpNotes = useCallback(() => setNotesVer((v) => v + 1), []);

  // ---- 自动换源 ----
  const [autoSwitching, setAutoSwitching] = useState(false);
  const autoBusyRef = useRef(false);
  /** 已试过失败的源（防循环；手动刷新/换源时清空） */
  const triedSourcesRef = useRef<Set<string>>(new Set());

  const notify = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? '' : cur)), 2200);
  }, []);

  // ---- 分页状态 ----
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  /** 隐藏测量容器（与正文同宽同排版） */
  const measureRef = useRef<HTMLDivElement>(null);
  const mParaRef = useRef<HTMLParagraphElement>(null);
  const mTitleRef = useRef<HTMLDivElement>(null);
  const mEndRef = useRef<HTMLDivElement>(null);
  /** 视口尺寸（宽度取整 → 页/轨道全整数像素，无亚像素缝隙） */
  const [vp, setVp] = useState({ w: 0, h: 0 });
  /** 分页结果（pages[i] = 第 i 页的切片数组） */
  const [pageList, setPageList] = useState<PageSlice[][]>([]);
  /** 章内页码（0-based） */
  const [curPage, setCurPage] = useState(page.startPage || 0);
  /** 翻到上一章时回退到最后一页（等分页算好后落位） */
  const pendingLastRef = useRef(false);
  /** curPage 镜像（滚动模式恢复位置用） */
  useEffect(() => {
    curPageRef.current = curPage;
  }, [curPage]);
  /** 字体异步就绪 → 重算分页 */
  const [fontsTick, setFontsTick] = useState(0);
  /** 行切分缓存（key 含字体参数与段落内容指纹） */
  const segCacheRef = useRef<{ key: string; map: Map<string, number[]> }>({ key: '', map: new Map() });
  /** 滑动跟手位移（px；ref 供事件闭包读实时值，state 供渲染） */
  const [swipeDx, setSwipeDx] = useState(0);
  const swipeDxRef = useRef(0);
  const touchRef = useRef<{ x: number; y: number; t: number; horiz: boolean; lastY: number } | null>(null);
  /** 滑动后抑制点按（防松手误触翻页分区） */
  const suppressClickRef = useRef(false);
  /** 覆盖动画状态 */
  const [coverState, setCoverState] = useState<CoverState | null>(null);
  const coverRef = useRef<CoverState | null>(null);
  useEffect(() => {
    coverRef.current = coverState;
  }, [coverState]);
  /** 长按定时器 */
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 本次触摸是否已触发长按（触发后拖动=扩选选区而不是翻页） */
  const lpFiredRef = useRef(false);
  /** suppressClick 自动复位定时器（长按后的释放 click 吞掉一次即可，之后正常响应） */
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 短暂吞掉下一次点击（400ms 内或被吞后自动复位），避免长按释放误触翻页/菜单 */
  const armSuppress = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, 400);
  }, []);
  useEffect(
    () => () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    },
    [],
  );
  /** 弹层全开时禁用翻页键/长按 */
  const uiBlockedRef = useRef(false);
  useEffect(() => {
    uiBlockedRef.current =
      barsOn || settingsOpen || chatOpen || tocOpen || chSearchOpen || srcOpen || bmOpen || !!notePopup || !!sel;
  }, [barsOn, settingsOpen, chatOpen, tocOpen, chSearchOpen, srcOpen, bmOpen, notePopup, sel]);

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

  // 批注：随书拉取（换源 migrate 后 bookUrl 变化自动重拉）
  useEffect(() => {
    let alive = true;
    api
      .notesList(src.bookUrl)
      .then((d) => {
        if (alive) setNotes(d.notes || []);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, [src.bookUrl, notesVer]);

  // ------------------------------------------------------------------
  // 自动换源：当前源目录/正文失败 → 依序试其他源（同名书 + 章节可读）
  // ------------------------------------------------------------------
  const tryAutoSwitch = useCallback(async (): Promise<boolean> => {
    if (isLocal || autoBusyRef.current) return false;
    autoBusyRef.current = true;
    setAutoSwitching(true);
    try {
      const norm = (x: string) => x.replace(/\s+/g, '');
      const pool = sourcesList
        .filter((s) => s.enabled && !triedSourcesRef.current.has(s.id))
        .sort((a, b) => (a.checkStatus === 'ok' ? 0 : 1) - (b.checkStatus === 'ok' ? 0 : 1))
        .slice(0, 10);
      for (const s of pool) {
        try {
          const r = await api.searchOne(src.name, s.id);
          const hit = (r.books || []).find((b) => norm(b.name) === norm(src.name));
          if (!hit) continue;
          const d = await api.bookDetail(s.id, hit.bookUrl, src.name, src.author);
          // 目录需覆盖当前进度（残缺目录的源直接跳过）
          if (d.chapters.length < Math.max(10, idx + 2)) continue;
          const oldTitle = chapters[idx]?.title || null;
          const newIdx = matchChapterIndex(d.chapters, oldTitle, idx);
          const chap = d.chapters[newIdx];
          if (!chap) continue;
          const cd = await api
            .chapter(s.id, chap.url, hit.bookUrl, newIdx, chap.title)
            .catch(() => null);
          if (!cd || !cd.content || cd.content.trim().length < 50) continue;
          // 提交换源（在架迁移书架记录；批注迁移到新 bookUrl）
          const inShelf = shelf.some((b) => b.bookUrl === src.bookUrl);
          if (inShelf) {
            await api
              .shelfAction({
                action: 'switchSource',
                name: src.name,
                author: src.author,
                book: {
                  sourceId: s.id,
                  sourceName: s.name,
                  bookUrl: hit.bookUrl,
                  coverUrl: src.coverUrl,
                  intro: d.intro,
                  chapters: d.chapters,
                },
              })
              .catch(() => null);
          }
          await api.notesAction({ action: 'migrate', from: src.bookUrl, to: hit.bookUrl }).catch(() => null);
          triedSourcesRef.current.add(s.id);
          setChapters(d.chapters);
          setFlipDir(newIdx >= idx ? 1 : -1);
          setIdx(newIdx);
          setCurPage(0);
          setLoadedIdx(-1);
          setContent('');
          setErr('');
          setSrc((old) => ({
            ...old,
            sourceId: s.id,
            bookUrl: hit.bookUrl,
            name: d.name || old.name,
            author: d.author || old.author,
          }));
          notify(`当前源失败，已自动换源：${s.name}`);
          void loadShelf();
          return true;
        } catch {
          /* 试下一个源 */
        }
      }
      return false;
    } finally {
      autoBusyRef.current = false;
      setAutoSwitching(false);
    }
  }, [isLocal, sourcesList, src.name, src.author, src.bookUrl, src.coverUrl, chapters, idx, shelf, loadShelf, notify]);
  const tryAutoSwitchRef = useRef(tryAutoSwitch);
  useEffect(() => {
    tryAutoSwitchRef.current = tryAutoSwitch;
  }, [tryAutoSwitch]);

  // 拉目录（书架已缓存则秒开；换源后 src 变化重拉；tocTick 重试）
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(src.sourceId, src.bookUrl, src.name, src.author)
      .then((d) => {
        if (!alive) return;
        if (!d.chapters.length) {
          setErr('该源目录为空，正在尝试其他书源…');
          setLoadedIdx(idx);
          triedSourcesRef.current.add(src.sourceId);
          void tryAutoSwitchRef.current().then((ok) => {
            if (!ok && alive) setErr('该源目录为空，试试刷新或换源');
          });
          return;
        }
        setChapters((prev) => (prev.length === d.chapters.length ? prev : d.chapters));
      })
      .catch(() => {
        if (!alive) return;
        setErr('目录加载失败，正在尝试其他书源…');
        setLoadedIdx(idx);
        triedSourcesRef.current.add(src.sourceId);
        void tryAutoSwitchRef.current().then((ok) => {
          if (!ok && alive) setErr('目录加载失败，请检查网络后重试');
        });
      });
    return () => {
      alive = false;
    };
  }, [src.sourceId, src.bookUrl, src.name, src.author, tocTick, idx]);

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
    if (!chapter) return; // 目录未到：由目录 effect 兜底报错，此处等待
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
      .catch(() => {
        if (!alive) return;
        // 自动换源：先试其他源，全失败再报错
        triedSourcesRef.current.add(src.sourceId);
        setLoadedIdx(idx);
        setContent('');
        setErr('章节加载失败，正在尝试其他书源…');
        void tryAutoSwitchRef.current().then((ok) => {
          if (!ok && alive) setErr('章节加载失败，请检查网络或换个书源');
        });
      });
    return () => {
      alive = false;
    };
  }, [idx, chapters, src.sourceId, src.bookUrl, retryFlip]);

  // ------------------------------------------------------------------
  // 视口尺寸（ResizeObserver；宽度取整——所有页/轨道均为整数像素，
  // 消除翻页时左右边缘的亚像素空白「切割线」）。
  // 注意用 clientWidth/clientHeight（布局尺寸）：预览面板是横屏时机身整体
  // rotate(90°) 缩放，getBoundingClientRect 会返回变换后的宽高互换值，
  // 导致分页用错维度、正文排版溢出可视区（白屏正文）。
  // ------------------------------------------------------------------
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(0, Math.floor(el.clientWidth || 0));
      const h = Math.max(0, el.clientHeight || 0);
      setVp((v) =>
        Math.abs(v.w - w) < 0.5 && Math.abs(v.h - h) < 0.5 ? v : { w, h },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 正文预处理：繁简转换（用户设置）→ 按行拆段；specialTags 时识别 [newpage] 强制分页标记 */
  const content2 = useMemo(() => convertLang(content, settings.s2t), [content, settings.s2t]);
  const paragraphs = useMemo(() => {
    const raw = content2.split('\n').map((p) => p.trim()).filter(Boolean);
    if (!settings.specialTags) return raw.map((t) => ({ text: t, brk: false }));
    const out: { text: string; brk: boolean }[] = [];
    for (const line of raw) {
      if (/\[newpage\]/i.test(line)) {
        const parts = line.split(/\[newpage\]/i);
        let pushed = false;
        parts.forEach((p, i) => {
          const t = p.trim();
          if (t) {
            out.push({ text: t, brk: i > 0 });
            pushed = true;
          }
        });
        if (!pushed) out.push({ text: '　', brk: out.length > 0 });
      } else {
        out.push({ text: line, brk: false });
      }
    }
    return out;
  }, [content2, settings.specialTags]);
  const titleVisible = settings.titlePosition !== 'hidden';
  const remain = Math.max(0, chapters.length - idx - 1);

  /** 段落排版（测量与渲染共用同一份 → 行切分必然一致） */
  const paraTypo = useMemo<React.CSSProperties>(
    () => ({
      fontFamily: fontCssVal,
      fontWeight: weightCss,
      fontSize: `${settings.fontSize}px`,
      lineHeight: settings.lineSpacing,
      letterSpacing: `${settings.letterSpacing}px`,
      textAlign: settings.justify ? 'justify' : 'start',
      textJustify: settings.cjkOptimize ? 'inter-character' : undefined,
      textDecoration: settings.underline ? 'underline' : 'none',
      textDecorationThickness: settings.underline ? '1px' : undefined,
      textUnderlineOffset: settings.underline ? '0.25em' : undefined,
      margin: 0,
    }),
    [fontCssVal, weightCss, settings.fontSize, settings.lineSpacing, settings.letterSpacing, settings.justify, settings.cjkOptimize, settings.underline],
  );

  /**
   * 行切分：把一段文字按渲染后的「行」切成边界数组（二分 + Range.getClientRects）
   * 返回 bounds，bounds[i] = 第 i 行首字符下标，bounds[lines] = text.length
   */
  const segmentLines = useCallback(
    (text: string, indent: boolean, cacheKey: string): number[] => {
      const el = mParaRef.current;
      if (!el) return [0, text.length];
      const cache = segCacheRef.current;
      const k = `${cacheKey}|${indent ? 1 : 0}`;
      const hit = cache.map.get(k);
      if (hit) return hit;
      el.style.textIndent = indent ? `${settings.textIndent}em` : '0';
      el.textContent = text;
      const range = document.createRange();
      const node = el.firstChild;
      let total = 1;
      if (node) {
        range.selectNodeContents(el);
        const rects = range.getClientRects().length;
        if (rects > 0) total = rects;
      }
      const bounds: number[] = [0];
      for (let li = 1; li < total; li++) {
        let lo = bounds[li - 1] + 1;
        let hi = text.length;
        let ans = text.length;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (!node) break;
          range.setStart(node, 0);
          range.setEnd(node, mid);
          if (range.getClientRects().length > li) {
            ans = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        // 关键：range [0, mid) 不含下标 mid 的字符 ——
        // 最小的 mid 使 [0, mid) 跨 li+1 行 ⟹ 字符 mid-1 是第 li 行首字符。
        let start = ans - 1;
        // 防御：行首必须严格大于上一行首（每行至少 1 个字符）
        if (start <= bounds[li - 1]) start = Math.min(text.length, bounds[li - 1] + 1);
        bounds.push(start);
      }
      bounds.push(text.length);
      cache.map.set(k, bounds);
      return bounds;
    },
    [],
  );

  // ------------------------------------------------------------------
  // 分页计算：内容/排版/视口变化 → 逐行贪心装页（useLayoutEffect 同步布局后执行）
  // ------------------------------------------------------------------
  const repaginate = useCallback(() => {
    if (!content || loading || err || autoSwitching || !vp.w || !vp.h || !mParaRef.current || !measureRef.current) {
      return null;
    }
    // 测量参数
    const mPara = mParaRef.current;
    const cs = getComputedStyle(mPara);
    let lineH = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineH) || lineH <= 0) lineH = settings.fontSize * settings.lineSpacing;
    const paraMb = settings.paraSpacing * settings.fontSize;
    const availH = vp.h;
    // 标题块高度（含 mb-5=20px）
    let titleH = 0;
    if (titleVisible && mTitleRef.current) {
      const t = mTitleRef.current;
      const tc = getComputedStyle(t.firstElementChild as Element || t);
      titleH = t.getBoundingClientRect().height + (parseFloat(tc.marginBottom) || 0);
    }
    // 章末块高度
    let endH = 90;
    if (mEndRef.current) endH = mEndRef.current.getBoundingClientRect().height;

    // 行切分缓存 key（影响断行的全部因素）
    const segKey = [
      vp.w.toFixed(2),
      settings.fontSize,
      fontCssVal,
      weightCss,
      settings.letterSpacing,
      settings.cjkOptimize ? 'cjkon' : 'cjkoff',
      settings.textIndent,
      content2.length,
      idx,
    ].join('|');
    if (segCacheRef.current.key !== segKey) {
      segCacheRef.current = { key: segKey, map: new Map() };
    }

    const pages: PageSlice[][] = [];
    let cur: PageSlice[] = [];
    let used = 0;
    const flush = () => {
      if (cur.length) pages.push(cur);
      cur = [];
      used = 0;
    };

    // 标题（只在第一页）
    if (titleVisible) {
      if (used + titleH > availH + 0.5 && cur.length) flush();
      cur.push({ kind: 'title', text: ch?.title || `第${idx + 1}章`, indent: false, justifyLast: false, pi: -1, off: 0 });
      used += titleH;
    }

    // 段落（整行装页；跨页续片无缩进；[newpage] 标记段落强制开新页）
    paragraphs.forEach((para, bi) => {
      const text = para.text;
      if (para.brk && cur.length) flush();
      let off = 0;
      let indent = true;
      let guard = 0;
      while (off < text.length && guard++ < 500) {
        const rest = text.slice(off);
        const bounds = segmentLines(rest, indent, `${bi}|${off}`);
        const lines = Math.max(1, bounds.length - 1);
        // 整段放得下（含段后距）
        if (used + lines * lineH + paraMb <= availH + 0.5) {
          cur.push({ kind: 'para', text: rest, indent, justifyLast: false, pi: bi, off });
          used += lines * lineH + paraMb;
          off = text.length;
        } else {
          // 还能塞几整行
          const n = Math.floor((availH - used) / lineH);
          if (n >= 1) {
            const cut = bounds[Math.min(n, lines)];
            cur.push({
              kind: 'para',
              text: rest.slice(0, cut),
              indent,
              pi: bi,
              off,
              // 仅当段落被真正截断（还有剩余）才让末行两端对齐
              justifyLast: settings.justify && cut < rest.length,
            });
            off += cut;
            indent = false;
            flush();
          } else if (cur.length) {
            flush();
          } else {
            // 页面为空且不足一行 → 强制一行（防死循环）
            const cut = lines >= 2 ? bounds[1] : rest.length;
            const take = Math.max(1, cut);
            cur.push({
              kind: 'para',
              text: rest.slice(0, take),
              indent,
              pi: bi,
              off,
              justifyLast: settings.justify && take < rest.length,
            });
            off += take;
            indent = false;
            flush();
          }
        }
      }
    });

    // 章末块
    if (used + endH > availH + 0.5 && cur.length) flush();
    cur.push({ kind: 'end', text: '', indent: false, justifyLast: false, pi: -1, off: 0 });
    flush();
    if (!pages.length) pages.push([{ kind: 'end', text: '', indent: false, justifyLast: false, pi: -1, off: 0 }]);
    return pages;
  }, [content2, loading, err, autoSwitching, vp.w, vp.h, paragraphs, titleVisible, settings.fontSize, settings.lineSpacing, settings.paraSpacing, settings.letterSpacing, settings.justify, settings.cjkOptimize, settings.textIndent, settings.specialTags, fontCssVal, weightCss, ch, idx, segmentLines]);

  useLayoutEffect(() => {
    // 测量驱动分页：布局后同步算页（React 标准测量模式，规则误报需局部豁免）
    const pages = repaginate();
    if (!pages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPageList((old) => (old.length ? [] : old));
      return;
    }
    setPageList(pages);
    if (pendingLastRef.current) {
      pendingLastRef.current = false;
      setCurPage(Math.max(0, pages.length - 1));
    } else {
      setCurPage((p) => Math.min(p, pages.length - 1));
    }
  }, [repaginate, fontsTick]);

  // 字体晚到（自定义字体加载完成）→ 重算一次
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) setFontsTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [settings.fontCustom, settings.fontFamily]);

  /** 翻页后延迟保存进度 */
  useEffect(() => {
    if (loading) return;
    saveProgress(idx, curPage, ch?.title || '', false);
  }, [idx, curPage]);

  // 换章弹窗失效：notePopup 带 chIdx，渲染时派生（不在 effect 里 setState）
  const activePopup = notePopup && notePopup.chIdx === idx && !loading && !err ? notePopup : null;
  const selParaActive = activePopup ? activePopup.pi : -1;

  // ------------------------------------------------------------------
  // 导航：页/章（ref 镜像当前值，快速连滑不踩 stale state 竞态）
  // ------------------------------------------------------------------
  const navRef = useRef({ page: 0, pages: 1, idx: 0, total: 0 });
  useEffect(() => {
    navRef.current = { page: curPage, pages: Math.max(1, pageList.length), idx, total: chapters.length };
  }, [curPage, pageList.length, idx, chapters.length]);

  /** 翻章：atPage='last' 时回退到上一章最后一页（等分页算好落位） */
  const goChapter = useCallback((delta: number, atPage: 'first' | 'last' = 'first') => {
    const s = navRef.current;
    const next = s.idx + delta;
    if (next < 0 || next >= s.total) return false;
    navRef.current = { ...s, idx: next, page: 0 };
    setFlipDir(delta);
    setIdx(next);
    setCoverState(null);
    if (atPage === 'last') pendingLastRef.current = true;
    setCurPage(0);
    return true;
  }, []);

  /** 翻页：dir=+1 下一页（前进：左滑/点右区），dir=-1 上一页（后退：右滑/点左区）
   *  滚动模式：整屏滚动；fade/curl 走覆盖机制（淡入/3D 翻页） */
  const turnPage = useCallback(
    (dir: 1 | -1) => {
      const s = navRef.current;
      if (animMode === 'scroll') {
        const el = scrollRef.current;
        if (el) {
          const step = Math.max(200, Math.round((vp.h || 400) * 0.92));
          const near = Math.round(el.scrollTop / step);
          const target = Math.max(0, (near + dir) * step);
          el.scrollTo({ top: Math.min(target, el.scrollHeight - el.clientHeight), behavior: 'smooth' });
          return true;
        }
        return goChapter(dir, dir < 0 ? 'last' : 'first');
      }
      const np = s.page + dir;
      if (np >= 0 && np < s.pages) {
        if (coverLike) {
          if (coverRef.current) return true; // 动画进行中忽略
          const start = dir * (vp.w || 1);
          setCoverState({ page: np, x: animMode === 'fade' ? 0 : start, settle: false, commit: true, mode: animMode as CoverState['mode'] });
          // 双 rAF 确保初始位置先提交，再启用过渡滑入
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              setCoverState((cs) => (cs && cs.page === np && !cs.settle ? { ...cs, x: 0, settle: true } : cs));
            }),
          );
        } else {
          navRef.current = { ...s, page: np };
          setCurPage(np);
        }
        return true;
      }
      return goChapter(dir, dir < 0 ? 'last' : 'first');
    },
    [animMode, coverLike, vp.w, vp.h, goChapter],
  );

  /** 覆盖动画落位：settle 结束后提交页码（或取消回弹） */
  useEffect(() => {
    const cs = coverState;
    if (!cs || !cs.settle) return;
    const t = setTimeout(() => {
      if (cs.commit && cs.x === 0) {
        navRef.current = { ...navRef.current, page: cs.page };
        setCurPage(cs.page);
      }
      setCoverState(null);
    }, 300);
    return () => clearTimeout(t);
  }, [coverState]);

  // ------------------------------------------------------------------
  // 音量键翻页：APK 原生壳直通（VolumeUp=上一页，VolumeDown=下一页）
  // + 键盘方向键/PageUp/Down（预览环境等价物；音量键在纯浏览器里被系统拦截，
  //   APK 内经 MainActivity 拦截后派发 __nativeVolTurn）
  // ------------------------------------------------------------------
  // 原生壳：通知开关状态（阅读器挂载/开关变化/退出时同步）
  useEffect(() => {
    const w = window as unknown as {
      Capacitor?: { Plugins?: { NativePerception?: { setVolumeKeyTurn?: (o: { enabled: boolean }) => void } } };
    };
    const plug = w.Capacitor?.Plugins?.NativePerception;
    if (!plug?.setVolumeKeyTurn) return;
    try {
      plug.setVolumeKeyTurn({ enabled: settings.keyTurn });
    } catch {
      /* 旧 APK 无此方法，静默降级 */
    }
    return () => {
      try {
        plug.setVolumeKeyTurn?.({ enabled: false });
      } catch {
        /* 忽略 */
      }
    };
  }, [settings.keyTurn]);

  // 原生音量键回调（MainActivity 派发）
  useEffect(() => {
    const w = window as unknown as Record<string, ((dir: number) => void) | undefined>;
    w.__nativeVolTurn = (dir: number) => {
      if (settings.keyTurn && !uiBlockedRef.current) turnPage(dir > 0 ? 1 : -1);
    };
    return () => {
      w.__nativeVolTurn = undefined;
    };
  }, [settings.keyTurn, turnPage]);

  useEffect(() => {
    if (!settings.keyTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (uiBlockedRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const c = e.keyCode;
      // 音量键（部分安卓 WebView 派发 24/25；蓝牙耳机 174/175）
      if (c === 24 || c === 25 || c === 174 || c === 175) {
        e.preventDefault();
        turnPage(c === 24 || c === 175 ? -1 : 1);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        turnPage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        turnPage(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.keyTurn, turnPage]);

  // ------------------------------------------------------------------
  // 自动阅读：每 N 秒自动翻一页（菜单/设置打开时暂停）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!settings.autoReadSec) return;
    const t = setInterval(() => {
      if (!uiBlockedRef.current) turnPage(1);
    }, settings.autoReadSec * 1000);
    return () => clearInterval(t);
  }, [settings.autoReadSec, turnPage]);

  // ------------------------------------------------------------------
  // 屏幕常亮（Wake Lock；不支持的环境静默降级）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!settings.keepScreenOn) return;
    type WakeLock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } };
    let lock: WakeLock | null = null;
    let alive = true;
    nav.wakeLock
      ?.request('screen')
      .then((l) => {
        if (alive) lock = l;
        else void l.release().catch(() => null);
      })
      .catch(() => null);
    return () => {
      alive = false;
      lock?.release().catch(() => null);
    };
  }, [settings.keepScreenOn]);

  // ------------------------------------------------------------------
  // 滚动模式：滚动位置 ↔ curPage 同步（分页重算后恢复位置）
  // ------------------------------------------------------------------
  useEffect(() => {
    if (animMode !== 'scroll') return;
    const el = scrollRef.current;
    if (!el || !vp.h || !pageList.length) return;
    el.scrollTop = Math.max(0, Math.min(curPageRef.current, pageList.length - 1)) * vp.h;
  }, [animMode, pageList, vp.h]);

  const onScrollModeScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !vp.h) return;
    const p = Math.round(el.scrollTop / vp.h);
    setCurPage((c) => (c === p ? c : Math.max(0, p)));
  }, [vp.h]);

  // 翻页后清逐字选择（选区不跨页保留；导航重置属合法 setState 场景）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 翻页/换章后必须清选区，防止手柄错位
    setSel(null);
  }, [curPage, idx]);

  // ------------------------------------------------------------------
  // 长按逐字选择：caretRangeFromPoint 定位字符 → 进入选区模式
  // ------------------------------------------------------------------
  const clearLongPress = useCallback(() => {
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }
  }, []);

  const handleLongPress = useCallback(
    (clientX: number, clientY: number) => {
      if (uiBlockedRef.current || loading || err || !paragraphs.length) return;
      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      };
      let node: Node | null = null;
      let caret = 0;
      try {
        if (doc.caretRangeFromPoint) {
          const r = doc.caretRangeFromPoint(clientX, clientY);
          node = r?.startContainer || null;
          caret = r?.startOffset || 0;
        } else if (doc.caretPositionFromPoint) {
          const p = doc.caretPositionFromPoint(clientX, clientY);
          node = p?.offsetNode || null;
          caret = p?.offset || 0;
        }
      } catch {
        node = null;
      }
      if (!node) return;
      let el: HTMLElement | null = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
      let pEl: HTMLElement | null = null;
      while (el && el !== wrapRef.current) {
        if (el instanceof HTMLParagraphElement && el.dataset.pi !== undefined && el.dataset.off !== undefined) {
          pEl = el;
          break;
        }
        el = el.parentElement;
      }
      if (!pEl) return;
      const pi = Number(pEl.dataset.pi);
      if (pi < 0 || pi >= paragraphs.length) return;
      const sOff = Number(pEl.dataset.off);
      const textLen = textLenOf(pEl);
      let local = offsetInElement(pEl, node, caret);
      if (local < 0 || local >= textLen) local = Math.max(0, textLen - 1);
      const abs = sOff + local;
      armSuppress();
      lpFiredRef.current = true;
      setNoteInput(null);
      setNotePopup(null);
      setSel({ pi, start: abs, end: Math.min(abs + 1, paragraphs[pi].text.length), chIdx: idx });
      if ('vibrate' in navigator) navigator.vibrate?.(12);
    },
    [loading, err, paragraphs, idx, armSuppress],
  );

  // ------------------------------------------------------------------
  // 触摸：跟手横滑 + 点按分区 + 长按划线 + 上滑加书签
  // ------------------------------------------------------------------
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      clearLongPress();
      return;
    }
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    touchRef.current = { x, y, t: Date.now(), horiz: false, lastY: y };
    lpFiredRef.current = false;
    // 长按检测（500ms 内移动超阈值会取消）
    clearLongPress();
    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null;
      handleLongPress(x, y);
    }, 500);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touchRef.current;
    if (!t || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    // 长按已触发：拖动 = 逐字扩选选区（原生阅读器体验），不再进入翻页滑动。
    // 注：不能检查 uiBlockedRef——它含「sel 激活」，会把扩选手势一起拦掉
    if (lpFiredRef.current) {
      updateSelFromPoint(x, y, 'end');
      t.lastY = y;
      return;
    }
    const dx = x - t.x;
    const dy = y - t.y;
    t.lastY = y;
    // 未定向：横滑 → 进入翻页；位移超阈值 → 取消长按（滚动模式下纵向交给原生滚动）
    if (!t.horiz) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        t.horiz = true;
        clearLongPress();
        if (notePopup) {
          setNotePopup(null);
        }
        if (sel) {
          setSel(null);
        }
      } else if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
        clearLongPress();
      }
    }
    if (t.horiz) {
      if (animMode === 'scroll') return;
      // 阻尼跟手：越界最多拖出一页
      const clamp = (v: number) => Math.max(-vp.w, Math.min(vp.w, v));
      swipeDxRef.current = clamp(dx);
      setSwipeDx(clamp(dx));
      if (coverLike) {
        const dir = dx < 0 ? 1 : -1;
        const s = navRef.current;
        const np = s.page + dir;
        if (np >= 0 && np < s.pages) {
          // 淡入模式跟手无位移（松手超过阈值才淡入）；覆盖/仿真跟手拖动
          const cx = animMode === 'fade' ? 0 : dir * (vp.w || 1) + clamp(dx);
          setCoverState({ page: np, x: cx, settle: false, commit: false, mode: animMode as CoverState['mode'] });
        } else if (coverRef.current) {
          setCoverState(null);
        }
      }
    }
  };
  const onTouchEnd = () => {
    const t = touchRef.current;
    touchRef.current = null;
    clearLongPress();
    // 长按后释放：不进入翻页判定（释放 click 已由 armSuppress 吞掉）
    if (lpFiredRef.current) {
      lpFiredRef.current = false;
      setSwipeDx(0);
      swipeDxRef.current = 0;
      return;
    }
    const dx = swipeDxRef.current;
    swipeDxRef.current = 0;
    setSwipeDx(0);
    if (t?.horiz && Math.abs(dx) > 8) suppressClickRef.current = true;
    // 上滑手势 → 快速加书签（非横向、快速、明显上滑）
    if (t && !t.horiz) {
      const dy = t.lastY - t.y;
      if (dy < -70 && Math.abs(dy) > Math.abs(dx) * 1.5 && Date.now() - t.t < 700) {
        void addBookmark();
        return;
      }
    }
    if (coverLike) {
      const cs = coverRef.current;
      if (cs && !cs.settle) {
        const dir = cs.page > navRef.current.page ? 1 : -1;
        const commit = Math.abs(dx) > 58;
        if (commit) setCoverState({ ...cs, x: 0, settle: true, commit: true });
        else if (cs.mode === 'fade') setCoverState(null); // 淡入模式取消：直接消失
        else setCoverState({ ...cs, x: dir * (vp.w || 1), settle: true, commit: false });
        return;
      }
      if (t?.horiz && Math.abs(dx) > 58) turnPage(dx < 0 ? 1 : -1);
      return;
    }
    if (t?.horiz && Math.abs(dx) > 58) {
      turnPage(dx < 0 ? 1 : -1);
    }
  };
  const onZoneClick = (zone: 'prev' | 'menu' | 'next') => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (sel) {
      setSel(null);
      return;
    }
    if (notePopup) {
      setNotePopup(null);
      setNoteInput(null);
      return;
    }
    // 点击翻页关闭后：点屏幕任意处只弹菜单
    const zone2 = settings.clickTurn ? zone : 'menu';
    if (zone2 === 'menu') setBarsOn((v) => !v);
    else if (zone2 === 'next') turnPage(1);
    else turnPage(-1);
  };
  /** 段落点击（段落可命中后接管分区逻辑：左1/3上一页·中菜单·右1/3下一页） */
  const onParaClick = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (sel) {
      setSel(null);
      return;
    }
    if (notePopup) {
      setNotePopup(null);
      setNoteInput(null);
      return;
    }
    if (!settings.clickTurn) {
      setBarsOn((v) => !v);
      return;
    }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left;
    if (x < r.width / 3) turnPage(-1);
    else if (x > (r.width * 2) / 3) turnPage(1);
    else setBarsOn((v) => !v);
  };

  const pages = Math.max(1, pageList.length);
  const colW = vp.w || 1;
  const dragging = swipeDx !== 0 || (!!coverState && !coverState.settle);
  /** 基础轨道位移：cover 模式固定当前页；slide 跟手 */
  const translateX = animMode === 'cover' ? -(curPage * colW) : -(curPage * colW) + swipeDx;
  const trackTransition =
    animMode === 'cover' || animMode === 'none'
      ? 'none'
      : swipeDx !== 0
        ? 'none'
        : 'transform 0.30s cubic-bezier(0.22, 0.61, 0.36, 1)';
  /** 滑动提示（章边界显示翻章） */
  const swipeHint = !dragging
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
  // 页脚：页码（左下）· 章节号（右下；开时间/电量后移左下）· 时间+电量（右下）
  // ------------------------------------------------------------------
  const now = useClock30s();
  const battery = useBattery();
  const showStatus = settings.showTime || settings.showBattery;
  const chapterLabel = `第 ${idx + 1}/${chapters.length || '?'} 章`;

  // ------------------------------------------------------------------
  // 批注动作
  // ------------------------------------------------------------------
  /** 弹窗目标区间内的已有划线（点已有划线/划线选区时用） */
  const rangeHighlight = useCallback(
    (pi: number, start: number, end: number) =>
      chHighlights.find((h) => h.paraIndex === pi && h.startOff < end && h.endOff > start),
    [chHighlights],
  );
  const addBookmark = useCallback(async () => {
    try {
      await api.notesAction({
        action: 'add',
        note: {
          bookUrl: src.bookUrl,
          name: src.name,
          kind: 'bookmark',
          chapterIndex: idx,
          chapterTitle: ch?.title || `第${idx + 1}章`,
          pageIndex: curPage,
          text: ch?.title || `第${idx + 1}章`,
        },
      });
      bumpNotes();
      notify(`已加书签：${ch?.title || `第${idx + 1}章`} · 第${curPage + 1}页`);
    } catch {
      notify('书签保存失败');
    }
  }, [src.bookUrl, src.name, idx, ch, curPage, bumpNotes, notify]);

  /** 划线（按弹窗目标区间；点已有划线则改样式） */
  const highlightPara = useCallback(
    async (pi: number, style: 'line' | 'wavy' | 'box', range?: { start: number; end: number } | null) => {
      const text = paragraphs[pi]?.text || '';
      if (!text) return;
      const startOff = Math.max(0, Math.min(range?.start ?? 0, text.length - 1));
      const endOff = Math.max(startOff + 1, Math.min(range?.end ?? text.length, text.length));
      const existing = rangeHighlight(pi, startOff, endOff);
      try {
        if (existing) {
          await api.notesAction({ action: 'updateNote', id: existing.id, style });
        } else {
          await api.notesAction({
            action: 'add',
            note: {
              bookUrl: src.bookUrl,
              name: src.name,
              kind: 'highlight',
              chapterIndex: idx,
              chapterTitle: ch?.title || null,
              paraIndex: pi,
              startOff,
              endOff,
              text: text.slice(startOff, endOff).slice(0, 600),
              style,
            },
          });
        }
        bumpNotes();
        setSel(null);
        setNotePopup(null);
        notify(existing ? '划线样式已更新' : '已划线');
      } catch {
        notify('保存失败，请重试');
      }
    },
    [paragraphs, rangeHighlight, src.bookUrl, src.name, idx, ch, bumpNotes, notify],
  );

  const removeHighlightsOf = useCallback(
    async (pi: number, range?: { start: number; end: number } | null) => {
      const targets = chHighlights.filter(
        (h) => h.paraIndex === pi && (!range || (h.startOff < range.end && h.endOff > range.start)),
      );
      for (const h of targets) {
        await api.notesAction({ action: 'remove', id: h.id }).catch(() => null);
      }
      bumpNotes();
      setNotePopup(null);
      setSel(null);
      notify('已删除划线');
    },
    [chHighlights, bumpNotes, notify],
  );

  const saveNote = useCallback(
    async (pi: number, note: string, range?: { start: number; end: number } | null) => {
      const text = paragraphs[pi]?.text || '';
      if (!text) return;
      const startOff = Math.max(0, Math.min(range?.start ?? 0, text.length - 1));
      const endOff = Math.max(startOff + 1, Math.min(range?.end ?? text.length, text.length));
      const existing = rangeHighlight(pi, startOff, endOff);
      try {
        if (existing) {
          await api.notesAction({ action: 'updateNote', id: existing.id, note });
        } else {
          await api.notesAction({
            action: 'add',
            note: {
              bookUrl: src.bookUrl,
              name: src.name,
              kind: 'highlight',
              chapterIndex: idx,
              chapterTitle: ch?.title || null,
              paraIndex: pi,
              startOff,
              endOff,
              text: text.slice(startOff, endOff).slice(0, 600),
              style: 'wavy',
              note,
            },
          });
        }
        bumpNotes();
        setNotePopup(null);
        setNoteInput(null);
        setSel(null);
        notify('笔记已保存');
      } catch {
        notify('保存失败，请重试');
      }
    },
    [paragraphs, rangeHighlight, src.bookUrl, src.name, idx, ch, bumpNotes, notify],
  );

  /** 从本段听：从第 pi 段朗读到本章末 */
  const speakFromPara = useCallback(
    (pi: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        notify('当前浏览器不支持朗读');
        return;
      }
      window.speechSynthesis.cancel();
      const text = paragraphs.slice(pi).map((p) => p.text).join('\n');
      if (!text) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1;
      u.onend = () => setTtsOn(false);
      u.onerror = () => setTtsOn(false);
      window.speechSynthesis.speak(u);
      setTtsOn(true);
      setNotePopup(null);
      notify(`从第 ${pi + 1} 段开始朗读`);
    },
    [paragraphs, notify],
  );

  const copyPara = useCallback(
    async (pi: number, range?: { start: number; end: number } | null) => {
      const para = paragraphs[pi]?.text || '';
      const text = range ? para.slice(range.start, range.end) : para;
      try {
        await navigator.clipboard.writeText(text);
        notify(text ? '已复制选中文字' : '没有可复制的文字');
      } catch {
        notify('复制失败，请重试');
      }
      setNotePopup(null);
    },
    [paragraphs, notify],
  );

  const lookupPara = useCallback(
    (pi: number, range?: { start: number; end: number } | null) => {
      const para = paragraphs[pi]?.text || '';
      const text = (range ? para.slice(range.start, range.end) : para).slice(0, 140);
      setChatAsk(`请帮我解读这段内容：「${text}」`);
      setNotePopup(null);
      setSel(null);
      setChatOpen(true);
    },
    [paragraphs],
  );

  /** 选中文字 → 逐字选择工具条动作 */
  const selText = useCallback(
    () => {
      if (!sel) return '';
      return (paragraphs[sel.pi]?.text || '').slice(sel.start, sel.end);
    },
    [sel, paragraphs],
  );

  const selCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(selText());
      notify('已复制选中文字');
    } catch {
      notify('复制失败');
    }
    setSel(null);
  }, [selText, notify]);

  const selLookup = useCallback(() => {
    if (!sel) return;
    lookupPara(sel.pi, { start: sel.start, end: sel.end });
  }, [sel, lookupPara]);

  const selSearch = useCallback(() => {
    const t = selText().slice(0, 120);
    if (!t) return;
    setChatAsk(`帮我联网搜索一下：「${t}」的出处与背景`);
    setSel(null);
    setChatOpen(true);
  }, [selText]);

  /** 划线选区 → 打开样式/笔记弹窗（定位到选区下方） */
  const selHighlightPopup = useCallback(() => {
    if (!sel || !selRects) return;
    const root = rootRef.current?.getBoundingClientRect();
    if (!root) return;
    const sz = localSizeOf(root);
    setSel(null);
    setNoteInput(null);
    setNotePopup({
      pi: sel.pi,
      x: (selRects.startX + selRects.endX) / 2,
      y: selRects.startY,
      rootW: sz.w,
      rootH: sz.h,
      chIdx: idx,
      range: { start: sel.start, end: sel.end },
    });
  }, [sel, selRects, idx]);

  // ------------------------------------------------------------------
  // 顶部工具：换源 / 缓存 / 章节搜索 / 书签 / 刷新
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
      .filter((s) => s.enabled && s.id !== src.sourceId && !triedSourcesRef.current.has(s.id))
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
      // 批注（书签/划线）随书迁移到新 bookUrl
      await api.notesAction({ action: 'migrate', from: src.bookUrl, to: c.bookUrl }).catch(() => null);
      triedSourcesRef.current.clear();
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

  /** 刷新：跳过缓存重抓当前章（顺带重拉目录） */
  const refreshChapter = () => {
    triedSourcesRef.current.clear();
    refreshReqRef.current = true;
    setLoadedIdx(-1);
    setChapters([]);
    setTocTick((t) => t + 1);
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

  /** 段内划线分段渲染（重叠划线按最先一条样式）+ 逐字选区灰色高亮 */
  const renderParaSegments = useCallback(
    (s: PageSlice) => {
      const hits = chHighlights
        .filter((h) => h.paraIndex === s.pi && h.endOff > s.off && h.startOff < s.off + s.text.length)
        .sort((a, b) => a.startOff - b.startOff);
      const activeSel = sel && sel.chIdx === idx && sel.pi === s.pi
        ? {
            hs: Math.max(sel.start - s.off, 0),
            he: Math.min(sel.end - s.off, s.text.length),
          }
        : null;
      const hasSel = !!activeSel && activeSel.hs < activeSel.he;
      if (!hits.length && !hasSel) return s.text;
      const segs: { t: string; h?: ReaderNoteItem; isSel?: boolean }[] = [];
      let cursor = 0;
      const pushSel = (from: number, to: number) => {
        if (from > cursor) segs.push({ t: s.text.slice(cursor, from) });
        if (to > from) segs.push({ t: s.text.slice(from, to), isSel: true });
        cursor = Math.max(cursor, to);
      };
      if (hasSel && activeSel) {
        // 选区与划线重叠时：先划线区间，再灰色选区盖在其上（简化为分段拼接）
        for (const h of hits) {
          const hs = Math.max(h.startOff - s.off, 0);
          const he = Math.min(h.endOff - s.off, s.text.length);
          if (he <= hs) continue;
          // 选区与该划线相交 → 交叠段同时标划线+选区
          if (he <= activeSel.hs || hs >= activeSel.he) {
            if (hs > cursor) segs.push({ t: s.text.slice(cursor, hs) });
            if (he > hs) segs.push({ t: s.text.slice(hs, he), h });
            cursor = Math.max(cursor, he);
          } else {
            const a = Math.max(hs, cursor);
            const b = Math.min(he, activeSel.hs);
            if (b > a) {
              if (a > cursor) segs.push({ t: s.text.slice(cursor, a) });
              segs.push({ t: s.text.slice(a, b), h });
              cursor = Math.max(cursor, b);
            }
            const c = Math.max(activeSel.hs, cursor);
            const d = Math.min(activeSel.he, he);
            if (d > c) {
              if (c > cursor) segs.push({ t: s.text.slice(cursor, c) });
              segs.push({ t: s.text.slice(c, d), h, isSel: true });
              cursor = Math.max(cursor, d);
            }
            const e = Math.max(he, cursor);
            const f = activeSel.he;
            if (f > e) {
              pushSel(e, f);
            } else if (he > cursor) {
              segs.push({ t: s.text.slice(cursor, he), h });
              cursor = he;
            }
          }
        }
        // 选区剩余部分
        const a = Math.max(activeSel.hs, cursor);
        if (activeSel.he > a) pushSel(a, activeSel.he);
      } else {
        for (const h of hits) {
          const hs = Math.max(h.startOff - s.off, 0);
          const he = Math.min(h.endOff - s.off, s.text.length);
          if (hs > cursor) segs.push({ t: s.text.slice(cursor, hs) });
          if (he > hs) segs.push({ t: s.text.slice(hs, he), h });
          cursor = Math.max(cursor, he);
        }
      }
      if (cursor < s.text.length) segs.push({ t: s.text.slice(cursor) });
      return segs.map((seg, i) =>
        seg.h ? (
          <span
            key={i}
            style={{ ...hlStyleOf(seg.h.style, theme.accent), cursor: 'pointer', ...(seg.isSel ? { background: 'rgba(90,110,150,0.35)', borderRadius: 2 } : {}) }}
            onClick={(e) => {
              e.stopPropagation();
              const root = rootRef.current?.getBoundingClientRect();
              if (!root) return;
              armSuppress();
              // 视口坐标 → 阅读器内部坐标（横屏旋转/缩放兼容）
              const p = viewportToLocal(e.clientX, e.clientY, root);
              const sz = localSizeOf(root);
              setNoteInput(null);
              setNotePopup({
                pi: seg.h!.paraIndex,
                x: p.x,
                y: p.y,
                rootW: sz.w,
                rootH: sz.h,
                chIdx: idx,
                range: { start: seg.h!.startOff, end: seg.h!.endOff },
              });
            }}
          >
            {seg.t}
          </span>
        ) : (
          <span key={i} style={seg.isSel ? { background: 'rgba(90,110,150,0.35)', borderRadius: 2 } : undefined}>
            {seg.t}
          </span>
        ),
      );
    },
    [chHighlights, theme.accent, sel, idx, armSuppress],
  );

  /** 渲染一页（forScroll=滚动模式：固定像素高度） */
  const renderPage = useCallback(
    (slices: PageSlice[], pageNum: number, forScroll = false) => (
      <div
        key={pageNum}
        style={{
          width: vp.w || '100%',
          height: forScroll ? vp.h || '100%' : '100%',
          flex: '0 0 auto',
          overflow: 'hidden',
          ...paraTypo,
        }}
      >
        {slices.map((s, si) => {
          if (s.kind === 'title') {
            return (
              <div key={si} style={{ letterSpacing: `${settings.letterSpacing * 0.6}px` }}>
                <TitleBlock text={s.text} center={settings.titlePosition === 'center'} />
              </div>
            );
          }
          if (s.kind === 'end') {
            return (
              <EndBlock
                key={si}
                remain={remain}
                accent={theme.accent}
                bgText={bg.text}
                subColor={bg.sub}
                onPrev={() => goChapter(-1)}
                onNext={() => goChapter(1)}
                hasPrev={idx > 0}
                hasNext={idx < chapters.length - 1}
              />
            );
          }
          return (
            <p
              key={si}
              data-pi={s.pi}
              data-off={s.off}
              onClick={onParaClick}
              style={{
                marginBottom: `${settings.paraSpacing}em`,
                textIndent: s.indent ? `${settings.textIndent}em` : 0,
                textAlignLast: s.justifyLast ? 'justify' : undefined,
                minHeight: '1em',
                pointerEvents: 'auto',
                transition: 'background 0.15s',
                ...(s.pi === selParaActive ? { background: `${theme.accent}1E`, borderRadius: '4px' } : {}),
              }}
            >
              {renderParaSegments(s)}
            </p>
          );
        })}
      </div>
    ),
    [vp.w, vp.h, paraTypo, settings.letterSpacing, settings.titlePosition, settings.paraSpacing, settings.textIndent, remain, theme.accent, bg.text, bg.sub, idx, chapters.length, goChapter, selParaActive, onParaClick, renderParaSegments],
  );

  /** 逐字选区手柄位置测量（选区/页码/排版变化后重算；拖手柄时实时刷新） */
  useLayoutEffect(() => {
    if (!sel || sel.chIdx !== idx) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 测量驱动，同 repaginate 模式
      setSelRects(null);
      return;
    }
    const root = rootRef.current;
    if (!root) {
      setSelRects(null);
      return;
    }
    const rootR = root.getBoundingClientRect();
    const measureAt = (absOff: number): { x: number; y: number } | null => {
      const pEls = root.querySelectorAll('p[data-pi][data-off]');
      for (let i = 0; i < pEls.length; i++) {
        const pEl = pEls[i] as HTMLElement;
        if (Number(pEl.dataset.pi) !== sel.pi) continue;
        const sOff = Number(pEl.dataset.off);
        const textLen = textLenOf(pEl);
        const local = absOff - sOff;
        if (local < 0 || local > textLen) continue;
        // 找到包含 local 的文本节点
        const walker = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT);
        let cum = 0;
        let node = walker.nextNode();
        let target: Node | null = null;
        let tOff = 0;
        while (node) {
          const len = node.textContent?.length || 0;
          if (local <= cum + len) {
            target = node;
            tOff = local - cum;
            break;
          }
          cum += len;
          node = walker.nextNode();
        }
        if (!target || target.nodeType !== 3) return null;
        const range = document.createRange();
        const len = target.textContent?.length || 0;
        range.setStart(target, Math.min(tOff, len));
        range.setEnd(target, Math.min(tOff + 1, len));
        const rects = range.getClientRects();
        if (!rects.length) return null;
        const r = rects[0];
        // 视口坐标 → 阅读器内部坐标（横屏旋转/缩放兼容）
        const p = viewportToLocal(r.left + r.width / 2, r.bottom, rootR);
        return { x: p.x, y: p.y };
      }
      return null;
    };
    const s = measureAt(Math.min(sel.start, sel.end - 1));
    const e = measureAt(Math.max(sel.end - 1, sel.start));
    if (s && e) {
      const sz = localSizeOf(rootR);
      setSelRects({ startX: s.x, startY: s.y, endX: e.x, endY: e.y, rootW: sz.w });
    } else setSelRects(null);
  }, [sel, idx, pageList, vp.w, vp.h, curPage]);

  /** 拖手柄：一个字一个字地扩选（同段内） */
  const updateSelFromPoint = useCallback(
    (clientX: number, clientY: number, which: 'start' | 'end') => {
      setSel((prev) => {
        if (!prev) return prev;
        const doc = document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        let node: Node | null = null;
        let caret = 0;
        try {
          if (doc.caretRangeFromPoint) {
            const r = doc.caretRangeFromPoint(clientX, clientY);
            node = r?.startContainer || null;
            caret = r?.startOffset || 0;
          } else if (doc.caretPositionFromPoint) {
            const p = doc.caretPositionFromPoint(clientX, clientY);
            node = p?.offsetNode || null;
            caret = p?.offset || 0;
          }
        } catch {
          return prev;
        }
        if (!node) return prev;
        let el: HTMLElement | null = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
        let pEl: HTMLElement | null = null;
        while (el && el !== wrapRef.current) {
          if (el instanceof HTMLParagraphElement && el.dataset.pi !== undefined && el.dataset.off !== undefined) {
            pEl = el;
            break;
          }
          el = el.parentElement;
        }
        if (!pEl || Number(pEl.dataset.pi) !== prev.pi) return prev;
        const sOff = Number(pEl.dataset.off);
        const local = offsetInElement(pEl, node, caret);
        if (local < 0) return prev;
        const abs = sOff + local;
        if (which === 'start') {
          const start = Math.max(0, Math.min(abs, prev.end - 1));
          return start === prev.start ? prev : { ...prev, start };
        }
        const end = Math.min((paragraphs[prev.pi]?.text.length) || abs + 1, Math.max(abs + 1, prev.start + 1));
        return end === prev.end ? prev : { ...prev, end };
      });
    },
    [paragraphs],
  );

  const onHandlePointerDown = (e: React.PointerEvent, which: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: PointerEvent) => updateSelFromPoint(ev.clientX, ev.clientY, which);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 划线弹窗定位（固定宽 288；下方优先，底部空间不足放上方）
  const existingNote = activePopup
    ? rangeHighlight(activePopup.pi, activePopup.range?.start ?? 0, activePopup.range?.end ?? Number.MAX_SAFE_INTEGER)
    : undefined;
  const popupRange = activePopup?.range ?? null;
  const popup = (() => {
    if (!notePopup) return null;
    const W = 288;
    const estH = noteInput !== null ? 168 : existingNote?.note ? 148 : 116;
    const left = Math.max(10, Math.min(notePopup.x - W / 2, notePopup.rootW - W - 10));
    const below = notePopup.y + estH + 24 < notePopup.rootH;
    const top = below ? notePopup.y + 18 : Math.max(10, notePopup.y - estH - 14);
    const arrowLeft = Math.max(14, Math.min(notePopup.x - left - 7, W - 28));
    return { left, top, below, arrowLeft, W };
  })();

  return (
    <div
      ref={rootRef}
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{
        background: bg.bg,
        color: bg.text,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      onContextMenu={(e) => {
        // 桌面右键 = 长按（划线菜单）
        if (!uiBlockedRef.current && !loading && !err) {
          e.preventDefault();
          handleLongPress(e.clientX, e.clientY);
        }
      }}
    >
      {/* 翻章动画 keyframes */}
      <style>{`@keyframes rd-flip-l{from{opacity:.35;transform:translateX(26px)}to{opacity:1;transform:none}}
      @keyframes rd-flip-r{from{opacity:.35;transform:translateX(-26px)}to{opacity:1;transform:none}}`}</style>

      {/* 正文视口（padding 定页边距；点按分区在最底层，正文容器不拦截点击）
          注：横向基础边距从 18px 降到 3px——边距滑块完全由用户掌控（0 即真 0），
          翻页时页面接缝两侧不再有大片“被切割”的空白 */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          paddingLeft: `calc(3px + ${settings.marginLeft}vw)`,
          paddingRight: `calc(3px + ${settings.marginRight}vw)`,
          paddingTop: `calc(22px + ${settings.marginTop}vh)`,
          paddingBottom: `calc(64px + ${settings.marginBottom}vh)`,
        }}
      >
        {/* 点按分区层（透明；位于正文之下，正文里的章末按钮可点击） */}
        <div className={`absolute inset-0 z-0 flex ${dragging ? 'pointer-events-none' : ''}`} aria-hidden="false">
          <button type="button" aria-label="上一页" className="h-full w-1/3" onClick={() => onZoneClick('prev')} />
          <button type="button" aria-label="菜单" className="h-full w-1/3" onClick={() => onZoneClick('menu')} />
          <button type="button" aria-label="下一页" className="h-full w-1/3" onClick={() => onZoneClick('next')} />
        </div>

        {/* 裁切层：宽 = 整数页宽（只露出当前页；分页模式 pointer-events 不拦截；滚动模式接管触摸） */}
        <div
          ref={clipRef}
          className={`relative z-10 h-full overflow-hidden ${animMode === 'scroll' ? '' : 'pointer-events-none'}`}
          style={{ width: vp.w ? `${vp.w}px` : '100%' }}
        >
          {/* 隐藏测量容器（与页面同宽同排版；分页引擎用） */}
          <div
            ref={measureRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              visibility: 'hidden',
              pointerEvents: 'none',
              width: vp.w || '100%',
              ...paraTypo,
            }}
          >
            <div ref={mTitleRef}>
              {titleVisible && (
                <div style={{ letterSpacing: `${settings.letterSpacing * 0.6}px` }}>
                  <TitleBlock text={ch?.title || `第${idx + 1}章`} center={settings.titlePosition === 'center'} />
                </div>
              )}
            </div>
            <p ref={mParaRef} style={{ ...paraTypo, textIndent: '2em' }} />
            <div ref={mEndRef}>
              <EndBlock
                remain={remain}
                accent={theme.accent}
                bgText={bg.text}
                subColor={bg.sub}
                hasPrev={idx > 0}
                hasNext={idx < chapters.length - 1}
                inert
              />
            </div>
          </div>

          {/* 正文/加载/错误 */}
          {loading || autoSwitching || err ? (
            <div className="pointer-events-none flex h-full w-full items-start justify-center">
              {(loading || autoSwitching) && (
                <div className="flex items-center justify-center gap-2 py-16" style={{ color: bg.sub }}>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-[13px]">
                    {autoSwitching ? '当前源失败，正在自动尝试其他书源…' : '正在抓取正文…'}
                  </span>
                </div>
              )}
              {err && !loading && !autoSwitching && (
                <div className="flex w-full flex-col items-center gap-3 py-14 text-center">
                  <p className="px-6 text-[14px]" style={{ color: bg.sub }}>
                    {err}
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={refreshChapter}
                      className="pointer-events-auto rounded-full px-4 py-1.5 text-[13px] font-semibold text-white shadow-md"
                      style={{ background: theme.accent }}
                    >
                      重试
                    </button>
                    {!isLocal && (
                      <button
                        type="button"
                        onClick={() => void openSwitch()}
                        className="pointer-events-auto rounded-full px-4 py-1.5 text-[13px] font-medium backdrop-blur-xl"
                        style={{ background: 'rgba(128,128,128,0.16)', color: bg.text }}
                      >
                        换源
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => goChapter(1)}
                      className="pointer-events-auto rounded-full px-4 py-1.5 text-[13px] font-medium backdrop-blur-xl"
                      style={{ background: 'rgba(128,128,128,0.16)', color: bg.text }}
                    >
                      下一章
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : animMode === 'scroll' ? (
            /* 滚动模式：页面纵向堆叠，原生滚动；tap 分区由段落点击接管 */
            <div
              ref={scrollRef}
              className="h-full w-full overflow-y-auto overscroll-contain"
              onScroll={onScrollModeScroll}
              style={{ scrollbarWidth: 'none' }}
            >
              <div className="flex flex-col" style={{ width: vp.w || '100%' }}>
                {/* eslint-disable-next-line react-hooks/refs -- 回调期访问 */}
                {pageList.map((slices, n) => renderPage(slices, n, true))}
              </div>
            </div>
          ) : (
            <>
              {/* 分页轨道：所有页常驻（前后页预渲染）；cover 模式下固定当前页作底 */}
              <div
                key={idx}
                className={`h-full ${flipDir > 0 ? '[animation:rd-flip-l_.28s_ease]' : '[animation:rd-flip-r_.28s_ease]'}`}
                style={{
                  display: 'flex',
                  width: pageList.length * (vp.w || 1),
                  transform: `translateX(${translateX}px)`,
                  transition: trackTransition,
                  willChange: 'transform',
                }}
              >
                {/* renderPage 内的 ref 读取全部位于点击回调里（事件期执行，非渲染期） */}
                {/* eslint-disable-next-line react-hooks/refs -- 误报：回调中的 navRef/suppressClickRef 仅事件期访问 */}
                {pageList.map(renderPage)}
              </div>
              {/* 覆盖/仿真/淡入动画层：新页从边缘滑入盖住旧页（边缘锐利阴影+1px 描边，
                  翻页前沿像真实书页而不是“被切割”） */}
              {coverLike && coverState && pageList[coverState.page] && (
                <div
                  className="absolute inset-y-0 left-0 z-20 overflow-hidden"
                  style={{
                    width: vp.w || '100%',
                    background: bg.bg,
                    transform:
                      coverState.mode === 'fade'
                        ? 'none'
                        : coverState.mode === 'curl'
                          ? `perspective(1200px) rotateY(${(
                              (coverState.page > curPage ? -1 : 1) *
                              ((Math.abs(coverState.x) / (vp.w || 1)) * 88)
                            ).toFixed(2)}deg)`
                          : `translateX(${coverState.x}px)`,
                    transformOrigin:
                      coverState.mode === 'curl' ? (coverState.page > curPage ? 'left center' : 'right center') : undefined,
                    opacity: coverState.mode === 'fade' ? (coverState.settle ? 1 : 0) : 1,
                    transition: coverState.settle
                      ? coverState.mode === 'fade'
                        ? 'opacity 0.26s ease'
                        : 'transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1)'
                      : 'none',
                    willChange: 'transform, opacity',
                    boxShadow:
                      coverState.mode === 'fade'
                        ? 'none'
                        : coverState.mode === 'curl'
                          ? '-2px 0 6px rgba(0,0,0,0.14), -10px 0 28px rgba(0,0,0,0.18)'
                          : coverState.page > curPage
                            ? '-1px 0 2px rgba(0,0,0,0.10), -8px 0 22px rgba(0,0,0,0.20)'
                            : '1px 0 2px rgba(0,0,0,0.10), 8px 0 22px rgba(0,0,0,0.20)',
                    ...(coverState.mode === 'cover'
                      ? coverState.page > curPage
                        ? { borderLeft: '1px solid rgba(0,0,0,0.07)' }
                        : { borderRight: '1px solid rgba(0,0,0,0.07)' }
                      : {}),
                  }}
                >
                  {/* eslint-disable-next-line react-hooks/refs -- 误报：同上，回调期访问 */}
                  {renderPage(pageList[coverState.page], coverState.page)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 自定义亮度遮罩（跟随系统亮度关闭时生效；盖住正文但不拦点击） */}
      {!settings.brightnessAuto && settings.brightness < 100 && (
        <div
          className="pointer-events-none absolute inset-0 z-[15]"
          style={{ background: '#000', opacity: ((100 - settings.brightness) / 100) * 0.55 }}
          aria-hidden="true"
        />
      )}

      {/* 亮度遮罩结束 */}

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

      {/* 页脚指示：页码左下 · 章节号右下（开时间/电量后章节号移左下，时间电量占右下） */}
      {!loading && !err && !autoSwitching && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-[max(16px,calc(env(safe-area-inset-bottom)+8px))] z-10 flex items-center justify-between text-[10px] tabular-nums"
          style={{
            color: bg.sub,
            paddingLeft: `calc(3px + ${settings.marginLeft}vw)`,
            paddingRight: `calc(3px + ${settings.marginRight}vw)`,
          }}
          aria-hidden="true"
        >
          <span className="min-w-0 truncate">
            {curPage + 1}/{pages}
            {showStatus ? ` · ${chapterLabel}` : ''}
          </span>
          {showStatus ? (
            <span className="flex shrink-0 items-center gap-2.5">
              {settings.showTime && now && (
                <span>
                  {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                </span>
              )}
              {settings.showBattery && battery && (
                <span className="flex items-center gap-1">
                  <BatteryIcon info={battery} />
                  {battery.level}%
                </span>
              )}
            </span>
          ) : (
            <span className="shrink-0">{chapterLabel}</span>
          )}
        </div>
      )}

      {/* ============ 逐字选择：灰色高亮 + 蓝色拖拽手柄 + 工具条（复制/划线/查询/搜索） ============ */}
      {sel && sel.chIdx === idx && !loading && !err && !notePopup && (
        <>
          {/* 两个拖拽手柄（起始蓝圆点；pointer 拖拽逐字扩选） */}
          {selRects && (
            <>
              <button
                type="button"
                aria-label="起始手柄"
                onPointerDown={(e) => onHandlePointerDown(e, 'start')}
                className="absolute z-[62] h-[22px] w-[22px] rounded-full shadow-lg"
                style={{
                  left: selRects.startX - 11,
                  top: selRects.startY - 20,
                  background: '#1E6FFF',
                  border: '2.5px solid #fff',
                  touchAction: 'none',
                }}
              />
              <button
                type="button"
                aria-label="结束手柄"
                onPointerDown={(e) => onHandlePointerDown(e, 'end')}
                className="absolute z-[62] h-[22px] w-[22px] rounded-full shadow-lg"
                style={{
                  left: selRects.endX - 11,
                  top: selRects.endY - 20,
                  background: '#1E6FFF',
                  border: '2.5px solid #fff',
                  touchAction: 'none',
                }}
              />
            </>
          )}
          {/* 浮动工具条（白色胶囊；位于选区上方） */}
          <div
            className="absolute z-[61] flex items-center rounded-[10px] py-1.5 shadow-2xl"
            style={{
              left: Math.max(10, Math.min((selRects?.startX ?? 195) - 132, (selRects?.rootW ?? 390) - 276)),
              top: Math.max(10, (selRects?.startY ?? 300) - 56),
              background: '#FFFFFF',
              boxShadow: '0 6px 24px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(0,0,0,0.05)',
            }}
            role="toolbar"
            aria-label="选中文字操作"
          >
            <button
              type="button"
              onClick={() => void selCopy()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium active:bg-black/5"
              style={{ color: '#1A1D26' }}
            >
              <Copy className="h-[17px] w-[17px]" style={{ color: '#1E6FFF' }} /> 复制
            </button>
            <span className="mx-0.5 h-5 w-px" style={{ background: 'rgba(0,0,0,0.10)' }} aria-hidden="true" />
            <button
              type="button"
              onClick={selHighlightPopup}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium active:bg-black/5"
              style={{ color: '#1A1D26' }}
            >
              <Underline className="h-[17px] w-[17px]" style={{ color: '#1E6FFF' }} /> 划线
            </button>
            <span className="mx-0.5 h-5 w-px" style={{ background: 'rgba(0,0,0,0.10)' }} aria-hidden="true" />
            <button
              type="button"
              onClick={selLookup}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium active:bg-black/5"
              style={{ color: '#1A1D26' }}
            >
              <SearchIcon className="h-[17px] w-[17px]" style={{ color: '#1E6FFF' }} /> 查询
            </button>
            <span className="mx-0.5 h-5 w-px" style={{ background: 'rgba(0,0,0,0.10)' }} aria-hidden="true" />
            <button
              type="button"
              onClick={selSearch}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium active:bg-black/5"
              style={{ color: '#1A1D26' }}
            >
              <Globe className="h-[17px] w-[17px]" style={{ color: '#1E6FFF' }} /> 搜索
            </button>
          </div>
        </>
      )}

      {/* ============ 划线长按菜单 ============ */}
      {activePopup && popup && paragraphs[activePopup.pi] && (
        <div
          className="absolute z-[60]"
          style={{ left: popup.left, top: popup.top, width: popup.W }}
          role="menu"
          aria-label="划线菜单"
        >
          <div
            className="relative rounded-2xl p-2.5 shadow-2xl backdrop-blur-2xl"
            style={{
              background: barCard.background,
              color: barCard.color,
              boxShadow: `inset 0 0 0 1px ${barCard.ring}, 0 14px 44px rgba(0,0,0,0.30)`,
            }}
          >
            {/* 已有笔记 */}
            {existingNote?.note && (
              <div
                className="mb-2 flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-[12px] leading-relaxed"
                style={{ background: pillBg }}
              >
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: theme.accent }} />
                <span className="min-w-0 break-all">{existingNote?.note}</span>
              </div>
            )}
            {/* 行1：从本段听 · 复制 · 查询 · 删除划线 */}
            <div className="flex items-center gap-1">
              {[
                { key: 'listen', label: '从本段听', icon: <Headphones className="h-[17px] w-[17px]" />, onClick: () => speakFromPara(activePopup.pi) },
                { key: 'copy', label: '复制', icon: <Copy className="h-[16px] w-[16px]" />, onClick: () => void copyPara(activePopup.pi, popupRange) },
                { key: 'lookup', label: '查询', icon: <Search className="h-[16px] w-[16px]" />, onClick: () => lookupPara(activePopup.pi, popupRange) },
                ...(existingNote
                  ? [{ key: 'del', label: '删除划线', icon: <Trash2 className="h-[16px] w-[16px]" />, onClick: () => void removeHighlightsOf(activePopup.pi, popupRange) }]
                  : []),
              ].map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={b.onClick}
                  className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 active:scale-95"
                  style={{ background: pillBg }}
                >
                  {b.icon}
                  <span className="text-[10px] font-medium">{b.label}</span>
                </button>
              ))}
            </div>
            {/* 行2：划线样式（直线/波浪/框选）+ 写笔记 */}
            <div
              className="mt-1.5 flex items-center gap-1.5 border-t pt-1.5"
              style={{ borderColor: bg.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            >
              {([
                { key: 'line', label: '直线', a: <span style={{ textDecoration: 'underline', textDecorationThickness: '2px', textDecorationColor: theme.accent }}>A</span> },
                { key: 'wavy', label: '波浪', a: <span style={{ textDecoration: 'underline wavy', textDecorationColor: theme.accent, textDecorationThickness: '1.5px' }}>A</span> },
                { key: 'box', label: '框选', a: <span style={{ background: `${theme.accent}30`, borderRadius: 3, padding: '0 3px' }}>A</span> },
              ] as const).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => void highlightPara(activePopup.pi, s.key, popupRange)}
                  aria-label={`划线样式：${s.label}`}
                  className="flex h-9 w-11 items-center justify-center rounded-xl text-[15px] font-semibold active:scale-90"
                  style={{
                    background: existingNote?.style === s.key ? theme.accent : pillBg,
                    color: existingNote?.style === s.key ? '#fff' : barCard.color,
                  }}
                >
                  {s.a}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNoteInput(existingNote?.note || '')}
                className="ml-auto flex h-9 items-center gap-1 rounded-xl px-3 text-[12px] font-semibold active:scale-95"
                style={{ background: pillBg, color: theme.accent }}
              >
                <StickyNote className="h-[15px] w-[15px]" /> {existingNote?.note ? '改笔记' : '写笔记'}
              </button>
            </div>
            {/* 笔记输入 */}
            {noteInput !== null && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteInput.trim()) void saveNote(activePopup.pi, noteInput.trim(), popupRange);
                  }}
                  placeholder="写下这一段的想法…"
                  maxLength={200}
                  autoFocus
                  className="h-9 min-w-0 flex-1 rounded-xl px-3 text-[13px] outline-none"
                  style={{ background: pillBg, color: barCard.color }}
                  aria-label="笔记内容"
                />
                <button
                  type="button"
                  disabled={!noteInput.trim()}
                  onClick={() => void saveNote(activePopup.pi, noteInput.trim(), popupRange)}
                  className="h-9 shrink-0 rounded-xl px-4 text-[12px] font-semibold text-white disabled:opacity-40"
                  style={{ background: theme.accent }}
                >
                  保存
                </button>
              </div>
            )}
            {/* 小箭头（指向按压点） */}
            <span
              className="absolute h-2.5 w-2.5 rotate-45"
              style={{
                left: popup.arrowLeft,
                ...(popup.below
                  ? { top: -5, background: barCard.background }
                  : { bottom: -5, background: barCard.background }),
              }}
              aria-hidden="true"
            />
          </div>
        </div>
      )}

      {/* ============ 顶部浮动工具卡（返回 + 书名/章节 + 书签/换源/缓存/搜索/刷新） ============ */}
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
          {/* 书签 */}
          <button type="button" onClick={() => setBmOpen(true)} aria-label="书签与划线" className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full active:scale-90">
            <Bookmark className="h-[19px] w-[19px]" strokeWidth={2.1} />
          </button>
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
                onClick: () => {
                  setChatAsk(undefined);
                  setChatOpen(true);
                },
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

      {/* 书签 / 划线列表抽屉 */}
      {bmOpen && (
        <div className="absolute inset-0 z-40" role="dialog" aria-label="书签与划线">
          <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={() => setBmOpen(false)} />
          <div
            className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] max-h-[68%] overflow-y-auto rounded-3xl p-4 shadow-2xl backdrop-blur-2xl"
            style={{ background: theme.pageBg, boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 -8px 40px rgba(0,0,0,0.16)` }}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[14px] font-bold" style={{ color: theme.textMain }}>
                书签 · {bookmarks.length}
              </p>
              <button
                type="button"
                onClick={() => void addBookmark()}
                className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white active:scale-95"
                style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
              >
                <Bookmark className="h-3.5 w-3.5" /> 加当前页书签
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="pb-2 text-center text-[12px]" style={{ color: theme.textSub }}>
                还没有书签 · 阅读时上滑可快速加书签
              </p>
            ) : (
              <div className="space-y-1 pb-2">
                {bookmarks.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                    style={{ background: b.chapterIndex === idx ? theme.accentSoft : 'transparent' }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setBmOpen(false);
                        setFlipDir(b.chapterIndex > idx ? 1 : -1);
                        setIdx(b.chapterIndex);
                        setCurPage(b.pageIndex);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[14px]" style={{ color: b.chapterIndex === idx ? theme.accent : theme.textMain }}>
                        {b.chapterTitle || `第${b.chapterIndex + 1}章`}
                      </span>
                      <span className="block text-[11px]" style={{ color: theme.textSub }}>
                        第{b.pageIndex + 1}页 · {new Date(b.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="删除书签"
                      onClick={() => {
                        void api.notesAction({ action: 'remove', id: b.id }).then(() => bumpNotes());
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:scale-90"
                      style={{ color: theme.textSub }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="my-2 h-px w-full" style={{ background: theme.cardRing }} />
            <p className="mb-1 text-[14px] font-bold" style={{ color: theme.textMain }}>
              划线笔记 · {notes.filter((n) => n.kind === 'highlight').length}
            </p>
            {notes.filter((n) => n.kind === 'highlight').length === 0 ? (
              <p className="pb-3 text-center text-[12px]" style={{ color: theme.textSub }}>
                长按正文可划线、写笔记
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto pb-3">
                {notes
                  .filter((n) => n.kind === 'highlight')
                  .map((h) => (
                    <div key={h.id} className="flex items-start gap-2 rounded-xl px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setBmOpen(false);
                          if (h.chapterIndex !== idx) {
                            setFlipDir(h.chapterIndex > idx ? 1 : -1);
                            setIdx(h.chapterIndex);
                            setCurPage(0);
                          }
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="line-clamp-2 text-[13px] leading-snug" style={{ color: theme.textMain, ...hlStyleOf(h.style, theme.accent) }}>
                          {h.text}
                        </span>
                        <span className="mt-0.5 block text-[11px]" style={{ color: theme.textSub }}>
                          第{h.chapterIndex + 1}章{h.note ? ` · 笔记：${h.note.slice(0, 30)}` : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="删除划线"
                        onClick={() => {
                          void api.notesAction({ action: 'remove', id: h.id }).then(() => bumpNotes());
                        }}
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:scale-90"
                        style={{ color: theme.textSub }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
              </div>
            )}
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

      {/* 排版设置（实时预览；分页实时重算） */}
      {settingsOpen && <ReaderSettingsSheet onClose={() => setSettingsOpen(false)} />}

      {/* AI 伴读（先选联系人再陪读；「查询」带预置问题） */}
      {chatOpen && (
        <AIChatSheet
          bookUrl={src.bookUrl}
          name={src.name}
          author={src.author}
          totalChapters={chapters.length}
          currentChapter={idx}
          currentChapterTitle={ch?.title || ''}
          summary={summary}
          initialAsk={chatAsk}
          onClose={() => {
            setChatOpen(false);
            setChatAsk(undefined);
          }}
        />
      )}
    </div>
  );
}

/** 导出类型（排版设置面板保存预设时用） */
export type { ReaderSettings };
