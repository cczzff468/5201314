'use client';

/**
 * 书架 Tab：大标题 + 圆形操作钮 + 分组胶囊 + 3列网格书籍卡（封面/未读角标/进度）
 */
import { useMemo, useState } from 'react';
import { Search, EllipsisVertical, Plus, Trash2 } from 'lucide-react';
import { useReading } from '@/lib/reading/store';
import { CoverPlaceholder, themeOf, type ShelfBookItem } from './shared';

export function ShelfTab({
  onOpen,
  onSearch,
}: {
  onOpen: (b: ShelfBookItem) => void;
  onSearch: () => void;
}) {
  const settings = useReading((s) => s.settings);
  const shelf = useReading((s) => s.shelf);
  const removeFromShelf = useReading((s) => s.removeFromShelf);
  const theme = useMemo(() => themeOf(settings.appTheme), [settings.appTheme]);
  const [manage, setManage] = useState(false);
  const [group, setGroup] = useState('全部');

  const groups = useMemo(() => ['全部', ...new Set(shelf.map((b) => b.sourceName || '未知'))], [shelf]);
  const list = group === '全部' ? shelf : shelf.filter((b) => (b.sourceName || '未知') === group);

  return (
    <div className="px-4">
      <div className="flex items-end justify-between">
        <h1 className="text-[30px] font-bold leading-tight" style={{ color: theme.textMain }}>
          书架
        </h1>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onSearch}
            aria-label="搜索"
            className="flex h-11 w-11 items-center justify-center rounded-full ring-1 backdrop-blur-xl active:scale-90"
            style={{ background: theme.cardBg, color: theme.textMain, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            <Search className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => setManage((m) => !m)}
            aria-label="管理"
            className="flex h-11 w-11 items-center justify-center rounded-full ring-1 backdrop-blur-xl active:scale-90"
            style={{ background: theme.cardBg, color: theme.textMain, ['--tw-ring-color' as string]: theme.cardRing }}
          >
            <EllipsisVertical className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* 分组胶囊 */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className="h-8 shrink-0 rounded-full px-4 text-[13px] font-medium ring-1 backdrop-blur-xl active:scale-95"
            style={{
              background: g === group ? theme.accent : theme.cardBg,
              color: g === group ? '#fff' : theme.textMain,
              ['--tw-ring-color' as string]: theme.cardRing,
            }}
          >
            {g}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="mt-24 flex flex-col items-center gap-4">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ background: theme.accentSoft, color: theme.accent }}
          >
            <Plus className="h-9 w-9" strokeWidth={2} />
          </div>
          <p className="text-[15px]" style={{ color: theme.textSub }}>
            书架空空的，去找几本书吧
          </p>
          <button
            type="button"
            onClick={onSearch}
            className="rounded-full px-6 py-2.5 text-[14px] font-semibold text-white shadow-lg active:scale-95"
            style={{ background: theme.accent, boxShadow: `0 6px 20px ${theme.accent}55` }}
          >
            去找书
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5">
          {list.map((b) => {
            const unread = Math.max(0, b.totalChapters - b.lastReadChapter - 1);
            return (
              <div key={b.bookUrl} className="relative">
                <button type="button" onClick={() => onOpen(b)} className="w-full text-left active:scale-95">
                  <div className="relative aspect-[3/4.2] w-full overflow-hidden rounded-xl shadow-[0_4px_14px_rgba(0,0,0,0.10)] ring-1 ring-black/5">
                    {b.coverUrl ? (
                          <img src={b.coverUrl} alt={b.name} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <CoverPlaceholder name={b.name} className="h-full w-full" radius="rounded-none" />
                    )}
                    {unread > 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white">
                        {unread}章未读
                      </span>
                    )}
                    {manage && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`移除 ${b.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeFromShelf(b.bookUrl);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && void removeFromShelf(b.bookUrl)}
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur"
                      >
                        <Trash2 className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[13px] font-semibold" style={{ color: theme.textMain }}>
                    {b.name}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: theme.textSub }}>
                    {b.lastReadChapter + 1}/{b.totalChapters}章
                  </p>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
