'use client';

/**
 * 排行榜页（子页）：热搜榜 / 完结榜 / 各分类榜。
 * - 数据：内置精选书单（热搜榜=热门分类；完结榜=全分类完结书跨类交错；分类榜=对应分类前 20）
 * - 榜单行：名次徽章（1~3 主题渐变）+ 真实封面（服务端缓存）+ 书名/作者/分类标签/完结状态
 * - 点击书籍 → 聚合搜索直达；顶部胶囊行切换榜单
 */
import { useMemo, useState } from 'react';
import { Crown, Flame, Trophy } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { FEATURED, coverPaletteOf, themeOf, useFeaturedCovers, type FeaturedBook } from './shared';
import { SubNavBar } from './ReadingApp';

/** 完结榜：全分类完结书确定性交错排序（同分类不连排，榜单更均衡） */
function completedRanking(): FeaturedBook[] {
  const pools = Object.values(FEATURED)
    .map((list) => list.filter((b) => b.done !== 0))
    .filter((l) => l.length);
  const out: FeaturedBook[] = [];
  let i = 0;
  while (out.length < 40) {
    let added = false;
    for (const p of pools) {
      if (p[i]) {
        out.push(p[i]);
        added = true;
        if (out.length >= 40) break;
      }
    }
    if (!added) break;
    i++;
  }
  return out;
}

export function RankingPage({
  onBack,
  onOpenBook,
}: {
  onBack: () => void;
  onOpenBook: (name: string, author: string) => void;
}) {
  const settings = useReading((s) => s.settings);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  /** 当前榜单 key：hot=热搜榜 done=完结榜 其余=分类名+'榜' */
  const [board, setBoard] = useState<'hot' | 'done' | string>('hot');
  const [coverFails, setCoverFails] = useState<Set<string>>(new Set());

  const boards = useMemo(
    () => [
      { key: 'hot', label: '热搜榜', icon: <Flame className="h-3.5 w-3.5" style={{ color: '#F0713A' }} /> },
      { key: 'done', label: '完结榜', icon: <Trophy className="h-3.5 w-3.5" style={{ color: '#E0A13A' }} /> },
      ...Object.keys(FEATURED)
        .filter((c) => c !== '热门')
        .map((c) => ({ key: `cat:${c}`, label: `${c}榜`, icon: <Crown className="h-3.5 w-3.5" style={{ color: theme.textSub }} /> })),
    ],
    [theme.textSub],
  );

  const list = useMemo<FeaturedBook[]>(() => {
    if (board === 'hot') return (FEATURED['热门'] || []).slice(0, 30);
    if (board === 'done') return completedRanking();
    if (board.startsWith('cat:')) return (FEATURED[board.slice(4)] || []).slice(0, 20);
    return [];
  }, [board]);

  const { covers, retry: retryCover } = useFeaturedCovers(useMemo(() => list.map((b) => b.name), [list]));
  const glass = { background: theme.cardBg, boxShadow: 'inset 0 0 0 1px ' + theme.cardRing } as const;

  const onCoverError = (name: string, url: string) => {
    setCoverFails((s) => new Set(s).add(url));
    retryCover(name);
  };

  return (
    <div className="flex h-full flex-col">
      <SubNavBar title="排行榜" onBack={onBack} theme={theme} />
      {/* 榜单切换胶囊行 */}
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {boards.map((b) => {
          const on = board === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setBoard(b.key)}
              aria-pressed={on}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium backdrop-blur-xl transition-all active:scale-95"
              style={
                on
                  ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff', boxShadow: `0 4px 14px ${theme.accent}44` }
                  : { ...glass, color: theme.textMain }
              }
            >
              {b.icon}
              {b.label}
            </button>
          );
        })}
      </div>

      {/* 榜单列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10">
        {list.length === 0 ? (
          <p className="mt-8 text-center text-[13px]" style={{ color: theme.textSub }}>
            该榜单暂无书籍
          </p>
        ) : (
          list.map((b, i) => {
            const raw = covers[b.name];
            const url = raw && !coverFails.has(raw) ? raw : null;
            const pal = coverPaletteOf(b.name);
            const top3 = i < 3;
            return (
              <button
                key={`${b.name}:${i}`}
                type="button"
                onClick={() => onOpenBook(b.name, b.author)}
                className="mb-2 flex w-full items-center gap-3 rounded-2xl p-2.5 text-left backdrop-blur-xl active:scale-[0.99]"
                style={glass}
              >
                {/* 名次 */}
                <span
                  className="flex h-7 w-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold tabular-nums"
                  style={
                    top3
                      ? { background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})`, color: '#fff', boxShadow: `0 3px 10px ${theme.accent}40` }
                      : { background: 'rgba(0,0,0,0.05)', color: theme.textSub }
                  }
                  aria-label={`第${i + 1}名`}
                >
                  {i + 1}
                </span>
                {/* 封面 */}
                <div className="h-[68px] w-[51px] shrink-0 overflow-hidden rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.12)] ring-1 ring-black/5">
                  {url ? (
                    <img
                      src={url}
                      alt={`${b.name} 封面`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => onCoverError(b.name, url)}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5"
                      style={{ backgroundImage: `linear-gradient(150deg, ${pal[0]}, ${pal[1]})` }}
                    >
                      <span className="line-clamp-3 text-center text-[10px] font-bold leading-tight text-white">{b.name}</span>
                    </div>
                  )}
                </div>
                {/* 信息 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 shrink truncate text-[15px] font-bold" style={{ color: theme.textMain }}>
                      {b.name}
                    </span>
                    <span
                      className="shrink-0 whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: theme.accentSoft, color: theme.accent }}
                    >
                      {b.tag}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px]" style={{ color: theme.textSub }}>
                    {b.author}
                    <span className="ml-1.5" style={{ color: b.done === 0 ? '#E0A13A' : '#3FA66A' }}>
                      · {b.done === 0 ? '连载中' : '已完结'}
                    </span>
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
