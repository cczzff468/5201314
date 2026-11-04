'use client';

/**
 * 页面 9：搜索日程。
 * 大标题「搜索日程」+ 右上取消；搜索框自动聚焦（标题/地点/备注）；
 * 结果按日期分组，行样式同主页日程列表（色条 + 标题 + 时间 + 地点）。
 */

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  FILL_MED,
  FILL_SOFT,
  TEXT,
  TEXT_2,
  TEXT_3,
  EventRow,
  formatDayShort,
  htmlToPlain,
  sortEvents,
  type NormalizedEvent,
} from './shared';
import { Card } from './widgets';

export function SearchView({
  events,
  onCancel,
  onOpenEvent,
}: {
  events: NormalizedEvent[];
  onCancel: () => void;
  onOpenEvent: (ev: NormalizedEvent) => void;
}) {
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return [] as { date: string; list: NormalizedEvent[] }[];
    const hits = events.filter((ev) => {
      if (ev.title.toLowerCase().includes(kw)) return true;
      if (ev.nLocation.toLowerCase().includes(kw)) return true;
      if (ev.note.toLowerCase().includes(kw)) return true;
      if (htmlToPlain(ev.note).toLowerCase().includes(kw)) return true;
      return false;
    });
    const byDate = new Map<string, NormalizedEvent[]>();
    for (const ev of sortEvents(hits)) {
      const list = byDate.get(ev.date);
      if (list) list.push(ev);
      else byDate.set(ev.date, [ev]);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, list]) => ({ date, list }));
  }, [events, q]);

  return (
    <div className="flex h-full flex-col pt-[54px]">
      {/* 大标题 + 取消 */}
      <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-1">
        <h1 className="text-[28px] font-bold leading-none tracking-tight" style={{ color: TEXT }}>
          搜索日程
        </h1>
        <button
          type="button"
          onClick={onCancel}
          className="text-[16px] transition-opacity active:opacity-50"
          style={{ color: TEXT_2 }}
        >
          取消
        </button>
      </div>

      {/* 搜索框 */}
      <div className="shrink-0 px-4 pb-1 pt-3">
        <div
          className="flex h-10 items-center gap-2 rounded-[12px] px-3"
          style={{ backgroundColor: FILL_SOFT }}
        >
          <Search className="h-[17px] w-[17px] shrink-0" style={{ color: TEXT_3 }} strokeWidth={2.2} />
          <input
            autoFocus
            data-testid="cal-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索日程"
            aria-label="搜索日程"
            className="h-full w-full bg-transparent text-[15px] outline-none"
            style={{ color: TEXT }}
          />
          {q && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQ('')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: FILL_MED }}
            >
              <X className="h-3 w-3" style={{ color: '#FFFFFF' }} strokeWidth={3} />
            </button>
          )}
        </div>
        <div className="px-1 pt-1.5 text-[12px]" style={{ color: TEXT_3 }}>
          所有日历 · 标题、地点或备注
        </div>
      </div>

      {/* 结果列表 */}
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2">
        {groups.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-[13px]" style={{ color: TEXT_3 }}>
            {q ? '没有找到相关日程' : '输入关键词搜索日程'}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.date} className="mb-3">
              <div className="px-1 pb-1.5 text-[13px]" style={{ color: TEXT_2 }}>
                {formatDayShort(g.date)}
              </div>
              <Card>
                <div className="divide-y" style={{ borderColor: 'rgba(41,36,31,0.05)' }}>
                  {g.list.map((ev) => (
                    <EventRow key={`${g.date}-${ev.id}`} ev={ev} onClick={() => onOpenEvent(ev)} showDate />
                  ))}
                </div>
              </Card>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
