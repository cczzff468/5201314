'use client';

/**
 * 主页：日程视图（Task 16-d 小米化）。
 * 公共头部 + 胶囊（选中「日程」）；从选中日期起向后 90 天按日分组：
 * 日期头「10月26日 周一」+ 农历红/灰小字，下面 Card 内 EventRow 列表；无日程日期跳过；
 * 整段为空显示居中灰字「暂无日程」；右下角红色 FAB 新建。
 */

import { useMemo } from 'react';
import {
  ACCENT,
  EventRow,
  TEXT,
  TEXT_2,
  TEXT_3,
  dateToKey,
  keyToParts,
  lunarBadge,
  keyToDate,
  sortEvents,
  todayKey,
  weekdayCNFull,
  type NormalizedEvent,
} from './shared';
import { Card } from './widgets';
import { CalChrome, CalFab, type MainView } from './chrome';

export function AgendaView({
  events,
  viewYM,
  selectedKey,
  onSwitchView,
  onOpenSearch,
  onToday,
  onNew,
  onOpenEvent,
}: {
  events: NormalizedEvent[];
  viewYM: { y: number; m: number };
  selectedKey: string;
  onSwitchView: (v: MainView) => void;
  onOpenSearch: () => void;
  onToday: () => void;
  onNew: () => void;
  onOpenEvent: (ev: NormalizedEvent) => void;
}) {
  // 从选中日期起向后看 90 天，按日分组（无日程日期跳过）
  const groups = useMemo(() => {
    const start = keyToDate(selectedKey);
    const out: { key: string; list: NormalizedEvent[] }[] = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateToKey(d);
      const list = sortEvents(events.filter((ev) => occursOnOf(ev, key)));
      if (list.length > 0) out.push({ key, list });
    }
    return out;
  }, [events, selectedKey]);

  return (
    <div className="relative flex h-full flex-col pt-[54px]">
      <CalChrome
        view="agenda"
        y={viewYM.y}
        m={viewYM.m}
        onSwitchView={onSwitchView}
        onOpenSearch={onOpenSearch}
        onToday={onToday}
        onNew={onNew}
      />

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-2.5">
        {groups.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-[14px]" style={{ color: TEXT_3 }}>
            暂无日程
          </div>
        ) : (
          groups.map((g) => {
            const { m, d } = keyToParts(g.key);
            const badge = lunarBadge(keyToDate(g.key));
            return (
              <div key={g.key} className="mb-3">
                <div className="flex items-baseline gap-2 px-1 pb-1.5">
                  <span className="text-[16px] font-bold leading-tight" style={{ color: TEXT }}>
                    {m + 1}月{d}日 {weekdayCNFull(g.key)}
                  </span>
                  <span className="text-[11px] leading-tight" style={{ color: badge.festival ? ACCENT : TEXT_2 }}>
                    {badge.text}
                  </span>
                </div>
                <Card>
                  <div className="divide-y" style={{ borderColor: 'rgba(41,36,31,0.05)' }}>
                    {g.list.map((ev) => (
                      <EventRow key={ev.id} ev={ev} onClick={() => onOpenEvent(ev)} />
                    ))}
                  </div>
                </Card>
              </div>
            );
          })
        )}
      </div>

      <CalFab onClick={onNew} />
    </div>
  );
}

/** occursOn 本文件轻量版（与 shared.occursOn 同口径） */
function occursOnOf(ev: NormalizedEvent, key: string): boolean {
  if (key >= ev.date && key <= ev.nEndDate) return true;
  if (key < ev.date) return false;
  const d = keyToDate(key);
  const s = keyToDate(ev.date);
  if (ev.repeatRule === 'daily') return true;
  if (ev.repeatRule === 'weekly') return d.getDay() === s.getDay();
  if (ev.repeatRule === 'monthly') return d.getDate() === s.getDate();
  if (ev.repeatRule === 'yearly') return d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
  if (!ev.repeatRule && (ev.repeat?.length ?? 0) > 0) return (ev.repeat ?? []).includes(d.getDay());
  return false;
}
