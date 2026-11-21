'use client';

/**
 * 阅读 App · 主壳
 * ---------------------------------------------------------------------------
 * 三 Tab（首页 / 书架 / 我）+ 毛玻璃悬浮胶囊 TabBar（白色磨砂胶囊、选中项为
 * 主题色实心渐变胶囊包图标+文字）。搜索页 / 书籍详情 / 阅读器为全屏子页
 * （push 栈式导航，返回键逐级退出）。
 * 风格：蓝色玻璃毛玻璃（App 主题可切换，默认海洋蓝）；底层装饰性渐变光斑
 * 让所有毛玻璃卡片有真实的「透出感」；所有子页顶栏预留状态栏高度（SB_H）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import {
  SB_H,
  api,
  themeOf,
  type SearchBookItem,
  type ShelfBookItem,
  type TocItem,
} from '@/components/apps/reading/shared';
import { HomeTab } from './HomeTab';
import { ShelfTab } from './ShelfTab';
import { MeTab } from './MeTab';
import { SearchPage } from './SearchPage';
import { BookDetail } from './BookDetail';
import { ReaderView } from './ReaderView';
import { SourcesManager } from './SourcesManager';
import { ReadingHistory } from './ReadingHistory';

export type TabKey = 'home' | 'shelf' | 'me';

/** 子页面（栈式导航） */
export type SubPage =
  | { kind: 'none' }
  | { kind: 'search'; keyword?: string; autoRun?: boolean }
  | { kind: 'detail'; sourceId: string; book: SearchBookItem }
  | { kind: 'reader'; sourceId: string; bookUrl: string; name: string; author: string; coverUrl?: string; startIndex?: number }
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
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);

  useEffect(() => {
    void loadSettings();
    void loadShelf();
    void loadSources(true);
  }, [loadSettings, loadShelf, loadSources]);

  const push = useCallback(
    (p: SubPage) => {
      setHistory((h) => [...h, page]);
      setPage(p);
    },
    [page],
  );
  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      setPage(prev ?? { kind: 'none' });
      return h.slice(0, -1);
    });
  }, []);

  // 子页全屏覆盖（阅读器自己管顶栏，其他子页带返回键）
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
      {/* 底层装饰光斑（毛玻璃透出感的来源；随主题换色） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
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
        {page.kind === 'search' && <SearchPage page={page} onBack={back} onOpenBook={(book, sourceId) => push({ kind: 'detail', sourceId, book })} />}
        {page.kind === 'detail' && (
          <BookDetail
            page={page}
            onBack={() => {
              back();
              void loadShelf();
            }}
            onRead={(p) => push({ kind: 'reader', sourceId: p.sourceId, bookUrl: p.bookUrl, name: p.name, author: p.author, coverUrl: p.coverUrl, startIndex: p.startIndex })}
            onSwitchSource={(book) => push({ kind: 'search', keyword: book.name, autoRun: true })}
          />
        )}
        {page.kind === 'sources' && <SourcesManager onBack={back} />}
        {page.kind === 'history' && <ReadingHistory onBack={back} onOpenBook={(b) => openShelfBook(b, push)} />}
        {page.kind === 'none' && (
          <div className="h-full overflow-y-auto overscroll-contain pb-[120px] pt-[54px]">
            {tab === 'home' && <HomeTab onSearch={(kw) => push({ kind: 'search', keyword: kw, autoRun: true })} onOpenShelfBook={(b) => openShelfBook(b, push)} />}
            {tab === 'shelf' && <ShelfTab onOpen={(b) => openShelfBook(b, push)} onSearch={() => push({ kind: 'search', autoRun: true })} />}
            {tab === 'me' && <MeTab onOpenSources={() => push({ kind: 'sources' })} onOpenHistory={() => push({ kind: 'history' })} />}
          </div>
        )}
      </div>

      {/* 毛玻璃悬浮胶囊 TabBar（仅主页面显示） */}
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
            <TabBtn tab="me" cur={tab} setTab={setTab} theme={theme} icon="me" label="我" />
          </div>
        </div>
      )}
    </div>
  );
}

/** 从书架记录打开阅读器 */
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
        startIndex: d.lastReadChapter || 0,
      });
    })
    .catch(() => null);
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
  icon: 'home' | 'shelf' | 'me';
  label: string;
}) {
  const active = tab === cur;
  const Ico =
    icon === 'home' ? TabHomeIcon : icon === 'shelf' ? TabShelfIcon : TabMeIcon;
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

import { House, BookMarked, CircleUserRound } from 'lucide-react';
function TabHomeIcon() {
  return <House className="h-[22px] w-[22px]" strokeWidth={2} />;
}
function TabShelfIcon() {
  return <BookMarked className="h-[22px] w-[22px]" strokeWidth={2} />;
}
function TabMeIcon() {
  return <CircleUserRound className="h-[22px] w-[22px]" strokeWidth={2} />;
}

/** 子页通用顶栏（毛玻璃 + 返回键；预留状态栏高度，不再被遮挡） */
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
      className="sticky top-0 z-20 shrink-0 backdrop-blur-2xl"
      style={{
        background: transparent ? 'transparent' : theme.barBg,
        paddingTop: SB_H,
        boxShadow: transparent ? undefined : `inset 0 -1px 0 ${theme.cardRing}`,
      }}
    >
      <div className="flex h-[52px] items-center px-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full active:scale-90"
          style={{ color: theme.textMain }}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="ml-1 min-w-0 flex-1 truncate text-[17px] font-semibold" style={{ color: theme.textMain }}>
          {title}
        </span>
        {right}
      </div>
    </div>
  );
}

/** 类型再导出（阅读器换章用） */
export type { TocItem };
