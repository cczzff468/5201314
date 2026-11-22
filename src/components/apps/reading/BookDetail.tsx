'use client';

/**
 * 书籍详情页（iOS 现代阅读 App 风格，参照用户设计图）：
 * - 顶部：封面模糊放大背景 + 渐变淡出到页面底色；半透明圆形返回按钮
 * - 头区：封面（大圆角）+ 书名/作者/分类胶囊（共N章 · 读到第x章/未开始 · 换源）
 * - 功能卡：缓存（预取后 20 章正文）/ 换源 / 听书（Web Speech 朗读）/ 分享
 * - 目录卡：最新章节（「最新」胶囊）+ 最近章节 + 查看完整目录
 * - 简介卡（可展开收起）
 * - 底部固定操作栏：加入书架（点击才入架）+ 开始阅读/继续阅读（续读到章节+页码）
 * - 【换源】同书多源切换：并行搜出各书源结果，底部玻璃抽屉点按切换（进度按章节标题映射）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Plus,
  Check,
  ArrowDownUp,
  RefreshCw,
  Loader2,
  Repeat2,
  ChevronLeft,
  Download,
  Headphones,
  Share2,
  Square,
} from 'lucide-react';
import {
  SB_H,
  api,
  CoverPlaceholder,
  coverSrc,
  featuredCategoryOf,
  featuredOfCategory,
  findStartIndex,
  matchChapterIndex,
  recommendBooks,
  themeOf,
  type BookDetailData,
  type SearchBookItem,
} from './shared';
import type { SubPage } from './ReadingApp';
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
  const [introOpen, setIntroOpen] = useState(false);
  const [toast, setToast] = useState('');

  // 换源抽屉
  const [srcOpen, setSrcOpen] = useState(false);
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [srcSearching, setSrcSearching] = useState(false);
  const srcSearchedRef = useRef(false);

  // 自动换源（详情加载失败时）
  const [autoTrying, setAutoTrying] = useState(false);
  const autoRef = useRef(false);

  // 听书（Web Speech）
  const [speaking, setSpeaking] = useState(false);

  const name = data?.name || curBook.name;
  const author = data?.author || curBook.author || '';

  const [reloadKey, setReloadKey] = useState(0);
  /** 自动换源回调（定义在下方；effect 里经 ref 调用避免前置引用） */
  const tryAutoRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    let alive = true;
    api
      .bookDetail(curSourceId, curBook.bookUrl, curBook.name, curBook.author || '')
      .then((d) => {
        if (!alive) return;
        if (!d.chapters.length) {
          // 目录为空视为该源不可用 → 自动换源
          setData(null);
          setErr('该源目录为空');
          void tryAutoRef.current().then((ok) => {
            if (!ok && alive) setErr((cur) => cur || '该源目录为空，请换个书源试试');
          });
          return;
        }
        setData(d);
        setInShelf(d.inShelf);
        setErr('');
      })
      .catch((e: Error) => {
        if (!alive) return;
        setErr(e.message || '加载失败');
        // 自动换源：失败后依次试其他源，第一个能拉到目录的自动切过去
        void tryAutoRef.current().then((ok) => {
          if (!ok && alive) setErr((cur) => cur || '加载失败，请换个书源试试');
        });
      });
    return () => {
      alive = false;
    };
  }, [curSourceId, curBook.bookUrl, curBook.name, curBook.author, reloadKey]);

  const shelfEntry = shelf.find((b) => b.bookUrl === curBook.bookUrl);
  const readIdx = data?.lastReadChapter ?? shelfEntry?.lastReadChapter ?? 0;
  const readPage = data?.lastPage ?? shelfEntry?.lastPage ?? 0;
  const started = readIdx > 0 || readPage > 0;

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 2200);
  };

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

  /** 详情加载失败 → 自动换源：依次试其他源，能拉到目录的自动切过去 */
  const tryAutoSwitchDetail = useCallback(async (): Promise<boolean> => {
    if (autoRef.current) return false;
    autoRef.current = true;
    setAutoTrying(true);
    try {
      const enabled = sources.filter((s) => s.enabled && s.id !== curSourceId).slice(0, 12);
      const nm = (s: string) => s.replace(/\s+/g, '');
      for (const src of enabled) {
        try {
          const r = await api.searchOne(curBook.name, src.id);
          const hit = (r.books || []).find((b) => nm(b.name) === nm(curBook.name));
          if (!hit) continue;
          const d = await api.bookDetail(src.id, hit.bookUrl, curBook.name, curBook.author || '');
          // 目录过少视为残缺源（百章书只有几条目录的直接跳过）
          if (d.chapters.length < 10) continue;
          if (inShelf || shelfEntry) {
            await api
              .shelfAction({
                action: 'switchSource',
                name,
                author,
                book: {
                  sourceId: src.id,
                  sourceName: src.name,
                  bookUrl: hit.bookUrl,
                  coverUrl: hit.coverUrl || curBook.coverUrl,
                  intro: d.intro,
                  chapters: d.chapters,
                },
              })
              .catch(() => null);
            await loadShelf().catch(() => null);
          }
          await api.notesAction({ action: 'migrate', from: curBook.bookUrl, to: hit.bookUrl }).catch(() => null);
          setCurSourceId(src.id);
          setCurBook({ ...hit, name: d.name || name, author: d.author || author });
          setData({ ...d, lastReadChapter: 0 });
          setInShelf(d.inShelf);
          setErr('');
          notify(`已自动切换书源：${src.name}`);
          return true;
        } catch {
          /* 试下一个源 */
        }
      }
      return false;
    } finally {
      autoRef.current = false;
      setAutoTrying(false);
    }
  }, [sources, curSourceId, curBook, name, author, inShelf, shelfEntry, loadShelf]);
  useEffect(() => {
    tryAutoRef.current = tryAutoSwitchDetail;
  }, [tryAutoSwitchDetail]);

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
      // 批注（书签/划线）随书迁移到新 bookUrl
      await api.notesAction({ action: 'migrate', from: curBook.bookUrl, to: c.book.bookUrl }).catch(() => null);
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
      startPage: idx === readIdx ? readPage : 0,
    });
  };

  const toggleShelf = async () => {
    if (!data) return;
    if (inShelf) {
      await api.shelfAction({ action: 'remove', bookUrl: curBook.bookUrl }).catch(() => null);
      setInShelf(false);
      notify('已移出书架');
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
      notify('已加入书架');
    }
    void loadShelf();
  };

  /** 缓存：预取当前章之后 20 章正文（后台静默，ChapterCache 落库） */
  const cacheChapters = async () => {
    if (!data) return;
    notify('正在后台缓存后续 20 章…');
    const from = readIdx > 0 ? readIdx : findStartIndex(data.chapters);
    const to = Math.min(data.total, from + 20);
    let ok = 0;
    for (let i = from; i < to; i++) {
      const c = data.chapters[i];
      if (!c) break;
      try {
        await api.chapter(curSourceId, c.url, curBook.bookUrl, i, c.title);
        ok++;
      } catch {
        /* 单章失败继续 */
      }
    }
    notify(`缓存完成：${ok} 章（离线可读）`);
  };

  /** 听书：Web Speech 朗读简介 + 前两段（简单可用；再点停止） */
  const toggleSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      notify('当前浏览器不支持听书');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const paras = (data?.intro || `${name}，${author} 著。`).split(/\s+/).slice(0, 6).join('。');
    const u = new SpeechSynthesisUtterance(`${name}。${paras}`);
    u.lang = 'zh-CN';
    u.rate = 1;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
    notify('开始朗读简介（进正文后可继续用）');
  };

  /** 分享：优先系统分享，降级剪贴板 */
  const shareBook = async () => {
    const text = `《${name}》${author ? ` - ${author}` : ''} · 来自阅读App（书源：${curBook.sourceName}）`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      notify('书摘已复制到剪贴板');
    } catch {
      notify('分享取消');
    }
  };

  const tocList = useMemo(() => {
    if (!data) return [];
    return tocReverse ? [...data.chapters].reverse() : data.chapters;
  }, [data, tocReverse]);

  /** 相似书推荐（同作者 > 书名相似 > 同分类；无命中时回退到同分类精选） */
  const similar = useMemo(() => {
    const scored = recommendBooks([{ name, author, tag: (curBook.kind || '').replace('分类：', '') }], [name], 8);
    if (scored.length) return scored;
    const cat = featuredCategoryOf(name);
    return cat ? featuredOfCategory(cat, [name], 8) : [];
  }, [name, author, curBook.kind]);

  const cover = coverSrc(data?.coverUrl || curBook.coverUrl, curSourceId);
  /** 封面加载失败地址（死链/防盗链）→ 回退书脊风占位图（按地址记，换源自动重置） */
  const [coverFailUrls, setCoverFailUrls] = useState<Set<string>>(new Set());
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;
  /** 最近 3 章（倒序显示） */
  const recentChapters = useMemo(() => {
    if (!data) return [];
    const start = findStartIndex(data.chapters);
    const arr: { c: (typeof data.chapters)[number]; i: number }[] = [];
    for (let i = Math.min(data.total - 1, start + Math.max(readIdx, 0) + 2); i >= start && arr.length < 3; i--) {
      const c = data.chapters[i];
      if (c) arr.push({ c, i });
    }
    return arr.reverse();
  }, [data, readIdx]);

  return (
    <div className="relative flex h-full flex-col" style={{ background: 'transparent' }}>
      {/* 顶部封面模糊放大背景（渐变淡出到页面底色） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42%] overflow-hidden" aria-hidden="true">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full scale-125 object-cover blur-2xl" referrerPolicy="no-referrer" />
        ) : (
          <div className="h-full w-full" style={{ background: `linear-gradient(150deg, ${theme.gradFrom}, ${theme.gradTo})` }} />
        )}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.05) 42%, ${theme.pageBg}ec 88%, ${theme.pageBg}00 100%)` }}
        />
      </div>

      {/* 顶栏：半透明圆形返回按钮 + 刷新（毛玻璃胶囊；状态栏下方标准高度，不再与内容重叠） */}
      <div className="relative z-20 shrink-0" style={{ paddingTop: SB_H }}>
        <div className="flex h-[52px] items-center justify-between px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ background: 'rgba(0,0,0,0.28)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="刷新"
            className="flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-xl active:scale-90"
            style={{ background: 'rgba(0,0,0,0.28)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }}
          >
            <RefreshCw className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>

      {!data && !err && !autoTrying && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: theme.accent }} />
        </div>
      )}
      {!data && autoTrying && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: theme.accent }} />
          <p className="text-[13px]" style={{ color: theme.textSub }}>
            当前源加载失败，正在自动尝试其他书源…
          </p>
        </div>
      )}
      {err && !autoTrying && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-[14px]" style={{ color: theme.textSub }}>
            {err}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-full px-5 py-2 text-[13px] font-medium backdrop-blur-xl"
              style={{ background: 'rgba(120,128,140,0.14)', color: theme.textMain }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => onSwitchSource(curBook)}
              className="rounded-full px-5 py-2 text-[13px] font-semibold text-white shadow-md"
              style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }}
            >
              换个书源试试
            </button>
          </div>
        </div>
      )}
      {data && (
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[118px]">
          {/* 头区：封面 + 书籍信息（压在模糊背景上） */}
          <div className="flex gap-4 pt-2">
            {(() => {
              return cover && !coverFailUrls.has(cover) ? (
                <img
                  src={cover}
                  alt={`${name} 封面`}
                  className="h-[150px] w-[110px] shrink-0 rounded-2xl object-cover shadow-[0_14px_36px_rgba(0,0,0,0.28)] ring-1 ring-white/25"
                  referrerPolicy="no-referrer"
                  onError={() => setCoverFailUrls((s) => new Set(s).add(cover))}
                />
              ) : (
                <CoverPlaceholder name={name} author={author} className="h-[150px] w-[110px] shrink-0 shadow-[0_14px_36px_rgba(0,0,0,0.28)]" radius="rounded-2xl" />
              );
            })()}
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-[21px] font-bold leading-snug text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)]">
                {name}
              </h1>
              <p className="mt-1 text-[13px] font-medium text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
                {author || '佚名'}
              </p>
              <p className="mt-1 text-[12px] text-white/75 drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
                {curBook.kind ? curBook.kind.replace('分类：', '') : '小说'}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">共 {data.total} 章</span>
                <span className="rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                  {started ? `读到第 ${readIdx + 1} 章` : '未开始'}
                </span>
              </div>
              {/* 换源胶囊（同书多源） */}
              <button
                type="button"
                onClick={() => setSrcOpen(true)}
                className="mt-2 flex items-center gap-1.5 rounded-full bg-white/25 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md active:scale-95"
              >
                <Repeat2 className="h-3.5 w-3.5" /> {curBook.sourceName} · 换源
              </button>
            </div>
          </div>

          {/* 功能卡：缓存 / 换源 / 听书 / 分享 */}
          <div className="mt-5 rounded-3xl p-4 backdrop-blur-xl" style={glass}>
            <div className="grid grid-cols-4 gap-1">
              {[
                { icon: <Download className="h-[21px] w-[21px]" />, label: '缓存', onClick: () => void cacheChapters() },
                { icon: <Repeat2 className="h-[21px] w-[21px]" />, label: '换源', onClick: () => setSrcOpen(true) },
                {
                  icon: speaking ? <Square className="h-[19px] w-[19px]" /> : <Headphones className="h-[21px] w-[21px]" />,
                  label: speaking ? '停止' : '听书',
                  onClick: toggleSpeech,
                },
                { icon: <Share2 className="h-[21px] w-[21px]" />, label: '分享', onClick: () => void shareBook() },
              ].map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={a.onClick}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-1.5 active:scale-95"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'rgba(120,128,140,0.10)', color: theme.textMain }}>
                    {a.icon}
                  </span>
                  <span className="text-[12px] font-medium" style={{ color: theme.textSub }}>
                    {a.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 目录卡：最新 + 最近章节 + 查看完整目录（外层 div 避免嵌套 button） */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setTocOpen(true)}
            onKeyDown={(e) => e.key === 'Enter' && setTocOpen(true)}
            className="mt-3.5 block w-full cursor-pointer rounded-3xl p-4 text-left backdrop-blur-xl active:scale-[0.99]"
            style={glass}
          >
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                目录
                <span className="ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
                  共 {data.total} 章
                </span>
              </p>
              <span className="flex items-center gap-0.5 text-[13px] font-medium" style={{ color: theme.accent }}>
                完整目录 <ArrowDownUp className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {/* 最新章 */}
              {data.chapters[data.total - 1] && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTocOpen(false);
                    onRead({
                      kind: 'reader',
                      sourceId: curSourceId,
                      bookUrl: curBook.bookUrl,
                      name: data.name || name,
                      author: data.author || author,
                      coverUrl: curBook.coverUrl,
                      startIndex: data.total - 1,
                    });
                  }}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: theme.accentSoft, color: theme.accent }}>
                    最新
                  </span>
                  <span className="truncate text-[14px] font-semibold" style={{ color: theme.textMain }}>
                    {data.chapters[data.total - 1].title}
                  </span>
                </button>
              )}
              {recentChapters.map(({ c, i }) => (
                <button
                  key={c.url + i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTocOpen(false);
                    onRead({
                      kind: 'reader',
                      sourceId: curSourceId,
                      bookUrl: curBook.bookUrl,
                      name: data.name || name,
                      author: data.author || author,
                      coverUrl: curBook.coverUrl,
                      startIndex: i,
                    });
                  }}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: theme.textSub, opacity: 0.5 }} />
                  <span className="truncate text-[13px]" style={{ color: theme.textSub }}>
                    {c.title}
                  </span>
                  {i === readIdx && (
                    <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium" style={{ background: theme.accentSoft, color: theme.accent }}>
                      当前
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 简介卡（可展开；详情页简介为空时用搜索结果简介兜底） */}
          {(data.intro || curBook.intro) && (
            <div className="mt-3.5 rounded-3xl p-4 backdrop-blur-xl" style={glass}>
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                简介
              </p>
              <p
                className={`mt-2 text-[14px] leading-[1.75] ${introOpen ? '' : 'line-clamp-3'}`}
                style={{ color: theme.textSub }}
                onClick={() => setIntroOpen((v) => !v)}
              >
                {(data.intro || curBook.intro || '').trim()}
              </p>
              {(data.intro || curBook.intro || '').length > 84 && (
                <button type="button" onClick={() => setIntroOpen((v) => !v)} className="mt-1 text-[13px] font-semibold" style={{ color: theme.accent }}>
                  {introOpen ? '收起' : '展开全部'}
                </button>
              )}
            </div>
          )}

          {/* 相似书推荐（同作者/同分类） */}
          {similar.length > 0 && (
            <div className="mt-3.5 rounded-3xl p-4 backdrop-blur-xl" style={glass}>
              <p className="text-[16px] font-bold" style={{ color: theme.textMain }}>
                看了本书的还在看
              </p>
              <div className="-mx-1 mt-2.5 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {similar.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => onSwitchSource({ name: b.name, author: b.author, bookUrl: '', sourceName: '', sourceUrl: '' })}
                    className="w-[86px] shrink-0 text-left active:scale-95"
                  >
                    <div
                      className="flex aspect-[3/4.2] w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl p-2"
                      style={{ backgroundImage: `linear-gradient(150deg, ${theme.gradFrom}55, ${theme.gradTo}99)` }}
                    >
                      <span className="line-clamp-3 text-center text-[12px] font-bold leading-tight text-white">
                        {b.name}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[12px] font-semibold" style={{ color: theme.textMain }}>
                      {b.name}
                    </p>
                    <p className="truncate text-[10px]" style={{ color: theme.textSub }}>
                      {b.reason}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部固定操作栏：加入书架 + 开始阅读 */}
      {data && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl"
          style={{ background: `${theme.pageBg}E6`, boxShadow: `inset 0 1px 0 ${theme.cardRing}` }}
        >
          <button
            type="button"
            onClick={() => void toggleShelf()}
            aria-label={inShelf ? '移出书架' : '加入书架'}
            className="flex h-[62px] w-[74px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl active:scale-95"
            style={{ background: 'rgba(120,128,140,0.12)', color: inShelf ? theme.accent : theme.textSub }}
          >
            {inShelf ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            <span className="text-[11px] font-medium">{inShelf ? '已在架' : '加入书架'}</span>
          </button>
          <button
            type="button"
            onClick={startReading}
            className="flex h-[62px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-bold text-white shadow-lg active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, boxShadow: `0 10px 28px ${theme.accent}55` }}
          >
            <BookOpen className="h-5 w-5" />
            {started ? `继续读 · 第${readIdx + 1}章` : '开始阅读'}
          </button>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-[60] flex justify-center px-6">
          <span className="rounded-full bg-black/75 px-4 py-2 text-center text-[13px] text-white backdrop-blur">{toast}</span>
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
