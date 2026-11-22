'use client';

/**
 * 阅读 App · 主壳
 * ---------------------------------------------------------------------------
 * 四 Tab（首页 / 书架 / 历史 / 我）+ 毛玻璃悬浮胶囊 TabBar（白色磨砂胶囊、选中项为
 * 主题色实心渐变胶囊包图标+文字）。搜索页 / 书籍详情 / 阅读器 / 书源管理为全屏子页
 * （push 栈式导航，返回键逐级退出）。阅读器独立接管全屏（沉浸模式，状态栏隐藏）。
 * 风格：玻璃毛玻璃（App 主题可切换，默认海洋蓝）；底层装饰性渐变光斑让所有
 * 毛玻璃卡片有真实的「透出感」；子页顶栏 iOS 规范：标题居中、返回键独立居左。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  SB_H,
  api,
  themeOf,
  type ReadHistoryItem,
  type SearchBookItem,
  type ShelfBookItem,
  type TocItem,
} from '@/components/apps/reading/shared';
import { HomeTab } from './HomeTab';
import { ShelfTab } from './ShelfTab';
import { HistoryTab } from './HistoryTab';
import { MeTab } from './MeTab';
import { SearchPage } from './SearchPage';
import { BookDetail } from './BookDetail';
import { ReaderView } from './ReaderView';
import { SourcesManager } from './SourcesManager';
import { ReadingHistory } from './ReadingHistory';
import { CategoryPage } from './CategoryPage';
import { RankingPage } from './RankingPage';

export type TabKey = 'home' | 'shelf' | 'history' | 'me';

/** 子页面（栈式导航） */
export type SubPage =
  | { kind: 'none' }
  | { kind: 'search'; keyword?: string; autoRun?: boolean }
  | { kind: 'detail'; sourceId: string; book: SearchBookItem }
  | {
      kind: 'reader';
      sourceId: string;
      bookUrl: string;
      name: string;
      author: string;
      coverUrl?: string;
      startIndex?: number;
      /** 章内页码（续读记忆） */
      startPage?: number;
    }
  | { kind: 'category'; category: string }
  | { kind: 'rank' }
  | { kind: 'sources' }
  | { kind: 'history' };

export default function ReadingApp() {
  const settings = useReading((s) => s.settings);
  const loadSettings = useReading((s) => s.loadSettings);
  const loadShelf = useReading((s) => s.loadShelf);
  const loadSources = useReading((s) => s.loadSources);
  const [tab, setTab] = useState<TabKey>('home');
  const [page, setPage] = useState<SubPage>({ kind: 'none' });
  const [history, setHistory] = useState<SubPage[]>([]);
  /** 导航方向（子页转场动画：push 右进 / pop 左回） */
  const [navDir, setNavDir] = useState<'push' | 'pop'>('push');
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  useEffect(() => {
    void loadSettings();
    void loadShelf();
    void loadSources(true);
  }, [loadSettings, loadShelf, loadSources]);

  const push = useCallback(
    (p: SubPage) => {
      setNavDir('push');
      setHistory((h) => [...h, page]);
      setPage(p);
    },
    [page],
  );
  const back = useCallback(() => {
    setNavDir('pop');
    setHistory((h) => {
      const prev = h[h.length - 1];
      setPage(prev ?? { kind: 'none' });
      return h.slice(0, -1);
    });
  }, []);

  // 阅读器全屏接管（沉浸模式：状态栏/灵动岛隐藏）
  if (page.kind === 'reader') {
    return <ReaderView page={page} onBack={back} />;
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{
        background: `linear-gradient(165deg, ${theme.gradFrom}30 0%, ${theme.pageBg} 42%, ${theme.pageBg} 70%, ${theme.gradTo}26 100%), ${theme.pageBg}`,
        ['--rd-accent' as string]: theme.accent,
        ['--rd-accent-soft' as string]: theme.accentSoft,
        color: theme.textMain,
      }}
    >
      {/* 子页转场动画（iOS push/pop：进=从右滑入带投影，退=从左回位） */}
      <style>{`
        @keyframes rd-push-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes rd-pop-in { from { transform: translateX(-26%); opacity: .55; } to { transform: translateX(0); opacity: 1; } }
        .rd-push-in { animation: rd-push-in .26s cubic-bezier(.32,.72,.34,1) both; will-change: transform; }
        .rd-pop-in { animation: rd-pop-in .24s cubic-bezier(.32,.72,.34,1) both; will-change: transform; }
        @media (prefers-reduced-motion: reduce) { .rd-push-in, .rd-pop-in { animation: none; } }
      `}</style>
      {/* 底层装饰光斑（毛玻璃透出感的来源；随主题换色；pan-none：光斑负偏移探出也不可被拖动） */}
      <div className="pointer-events-none absolute inset-0 pan-none" aria-hidden="true">
        <span
          className="absolute -top-24 -right-20 h-80 w-80 rounded-full opacity-80 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.gradFrom}88, transparent 68%)` }}
        />
        <span
          className="absolute top-1/4 -left-28 h-72 w-72 rounded-full opacity-70 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.gradTo}77, transparent 68%)` }}
        />
        <span
          className="absolute -bottom-28 right-1/4 h-80 w-80 rounded-full opacity-65 blur-3xl"
          style={{ background: `radial-gradient(circle, ${theme.gradFrom}55, transparent 70%)` }}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 子页/Tab 内容：push 左滑入 / pop 右滑回（iOS 转场；key 变化重播动画） */}
        <div
          key={`${page.kind}:${history.length}`}
          className={`h-full ${navDir === 'push' ? 'rd-push-in' : 'rd-pop-in'}`}
        >
        {page.kind === 'search' && <SearchPage page={page} onBack={back} onOpenBook={(book, sourceId) => push({ kind: 'detail', sourceId, book })} />}
        {page.kind === 'detail' && (
          <BookDetail
            page={page}
            onBack={() => {
              back();
              void loadShelf();
            }}
            onRead={(p) => push({ kind: 'reader', sourceId: p.sourceId, bookUrl: p.bookUrl, name: p.name, author: p.author, coverUrl: p.coverUrl, startIndex: p.startIndex, startPage: p.startPage })}
            onSwitchSource={(book) => push({ kind: 'search', keyword: book.name, autoRun: true })}
          />
        )}
        {page.kind === 'sources' && <SourcesManager onBack={back} />}
        {page.kind === 'history' && <ReadingHistory onBack={back} onOpenBook={(b) => openShelfBook(b, push)} />}
        {page.kind === 'category' && (
          <CategoryPage
            key={page.category}
            category={page.category}
            onBack={back}
            onOpenBook={(name) => push({ kind: 'search', keyword: name, autoRun: true })}
          />
        )}
        {page.kind === 'rank' && <RankingPage onBack={back} onOpenBook={(name) => push({ kind: 'search', keyword: name, autoRun: true })} />}
        {page.kind === 'none' && (
          <>
            {/* 首页自带滚动容器（支持下拉刷新 + 无限加载），其余 Tab 共用外层滚动 */}
            {tab === 'home' && (
              <HomeTab
                onSearch={(kw) => push({ kind: 'search', keyword: kw, autoRun: true })}
                onOpenCategory={(c) => push({ kind: 'category', category: c })}
                onOpenShelfBook={(b) => openHistoryBook(b, push)}
                onOpenRank={() => push({ kind: 'rank' })}
              />
            )}
            <div className={tab === 'home' ? 'hidden' : 'h-full overflow-y-auto overscroll-contain pb-[120px] pt-[54px]'}>
              {tab === 'shelf' && <ShelfTab onOpen={(b) => openShelfBook(b, push)} onSearchGlobal={() => push({ kind: 'search', autoRun: true })} />}
              {tab === 'history' && <HistoryTab onOpen={(b) => openHistoryBook(b, push)} />}
              {tab === 'me' && (
                <MeTab
                  onOpenSources={() => push({ kind: 'sources' })}
                  onOpenHistory={() => push({ kind: 'history' })}
                  onSearchBook={(name) => push({ kind: 'search', keyword: name, autoRun: true })}
                />
              )}
            </div>
          </>
        )}
        </div>
      </div>

      {/* 毛玻璃悬浮胶囊 TabBar（仅主页面显示；四 Tab：首页/书架/历史/我） */}
      {page.kind === 'none' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[max(14px,env(safe-area-inset-bottom))]">
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-full p-1.5 backdrop-blur-2xl"
            style={{
              background: theme.barBg,
              boxShadow: `inset 0 0 0 1px ${theme.cardRing}, 0 8px 30px rgba(0,0,0,0.10)`,
            }}
          >
            <TabBtn tab="home" cur={tab} setTab={setTab} theme={theme} icon="home" label="首页" />
            <TabBtn tab="shelf" cur={tab} setTab={setTab} theme={theme} icon="shelf" label="书架" />
            <TabBtn tab="history" cur={tab} setTab={setTab} theme={theme} icon="history" label="历史" />
            <TabBtn tab="me" cur={tab} setTab={setTab} theme={theme} icon="me" label="我" />
          </div>
        </div>
      )}
    </div>
  );
}

/** 从书架记录打开阅读器（续读到上次章节+页码） */
function openShelfBook(b: ShelfBookItem, push: (p: SubPage) => void) {
  void api
    .bookDetail(b.sourceId, b.bookUrl, b.name, b.author || '')
    .then((d) => {
      push({
        kind: 'reader',
        sourceId: b.sourceId,
        bookUrl: b.bookUrl,
        name: b.name,
        author: b.author || '',
        coverUrl: b.coverUrl || undefined,
        startIndex: b.lastReadChapter || d.lastReadChapter || 0,
        startPage: b.lastPage || 0,
      });
    })
    .catch(() =>
      push({
        kind: 'reader',
        sourceId: b.sourceId,
        bookUrl: b.bookUrl,
        name: b.name,
        author: b.author || '',
        coverUrl: b.coverUrl || undefined,
        startIndex: b.lastReadChapter || 0,
        startPage: b.lastPage || 0,
      }),
    );
}

/** 从历史记录打开阅读器（续读到上次章节+页码） */
function openHistoryBook(b: ReadHistoryItem, push: (p: SubPage) => void) {
  push({
    kind: 'reader',
    sourceId: b.sourceId,
    bookUrl: b.bookUrl,
    name: b.name,
    author: b.author || '',
    coverUrl: b.coverUrl || undefined,
    startIndex: b.lastReadChapter || 0,
    startPage: b.lastPage || 0,
  });
}

function TabBtn({
  tab,
  cur,
  setTab,
  theme,
  icon,
  label,
}: {
  tab: TabKey;
  cur: TabKey;
  setTab: (t: TabKey) => void;
  theme: ReturnType<typeof themeOf>;
  icon: 'home' | 'shelf' | 'history' | 'me';
  label: string;
}) {
  const active = tab === cur;
  const Ico =
    icon === 'home' ? TabHomeIcon : icon === 'shelf' ? TabShelfIcon : icon === 'history' ? TabHistoryIcon : TabMeIcon;
  return (
    <button
      type="button"
      onClick={() => setTab(tab)}
      aria-label={label}
      className="flex h-[52px] min-w-[76px] items-center justify-center gap-1 rounded-full transition-all active:scale-95"
      style={
        active
          ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff', boxShadow: `0 4px 16px ${theme.accent}55` }
          : { color: theme.textSub }
      }
    >
      <Ico />
      {active && <span className="text-[13px] font-semibold">{label}</span>}
    </button>
  );
}

import { House, BookMarked, History as HistoryIcon, CircleUserRound } from 'lucide-react';
function TabHomeIcon() {
  return <House className="h-[22px] w-[22px]" strokeWidth={2} />;
}
function TabShelfIcon() {
  return <BookMarked className="h-[22px] w-[22px]" strokeWidth={2} />;
}
function TabHistoryIcon() {
  return <HistoryIcon className="h-[22px] w-[22px]" strokeWidth={2} />;
}
function TabMeIcon() {
  return <CircleUserRound className="h-[22px] w-[22px]" strokeWidth={2} />;
}

/** 子页通用顶栏（透明悬浮在 App 渐变背景上，与页面颜色统一；iOS 规范：标题绝对居中、返回键独立居左、右槽居右） */
export function SubNavBar({
  title,
  onBack,
  right,
  theme,
  transparent,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  theme: ReturnType<typeof themeOf>;
  transparent?: boolean;
}) {
  return (
    <div
      className="sticky top-0 z-20 shrink-0 backdrop-blur-xl"
      style={{
        background: 'transparent',
        paddingTop: SB_H,
      }}
    >
      <div className="relative flex h-[52px] items-center px-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-90"
          style={{ color: theme.textMain }}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        {/* 标题绝对居中（不受左右按钮影响，iOS 导航栏规范） */}
        <span
          className="pointer-events-none absolute inset-x-14 text-center text-[17px] font-semibold"
          style={{ color: theme.textMain }}
        >
          <span className="inline-block max-w-full truncate align-middle">{title}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center">{right}</div>
      </div>
    </div>
  );
}

/** 类型再导出（阅读器换章用） */
export type { TocItem };
