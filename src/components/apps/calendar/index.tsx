'use client';

/**
 * 日历 App（Task 16-d 小米化重构，对照小米日历截图）。
 *
 * 主页路由：month（月）/ year（年）/ week（周）/ day（日）/ agenda（日程），
 * 由公共头部「默认视图」下拉与五视图切换胶囊互相切换；
 * 二级页：search（搜索）/ form（新建编辑）/ detail（详情）/
 * color|repeat|alert（表单选择）/ linkNotes（关联备忘录）/ pickDate|pickTime（日期时间）。
 *
 * 数据：IndexedDB events / notes 表（src/lib/ios/db.ts），旧数据完全兼容；
 * 日程↔备忘录联动字段：NoteRecord.linkedEventId / linkDate（与备忘录 App 约定）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localDB, genId, type CalendarEventRecord, type NoteRecord } from '@/lib/ios/db';
import {
  BG,
  blankDraft,
  dateToKey,
  draftFromEvent,
  draftToRecord,
  formatDayLong,
  keyToParts,
  normalizeEvent,
  noteLinkedToEvent,
  noteRelatesToEvent,
  occursOn,
  pad2,
  sortEvents,
  type EventDraft,
  type NormalizedEvent,
} from './shared';
import { MonthView } from './month-view';
import { YearView } from './year-view';
import { WeekDayView } from './week-day-view';
import { AgendaView } from './agenda-view';
import { EventForm } from './event-form';
import { EventDetail } from './event-detail';
import { AlertPickerPage, ColorPickerPage, RepeatPickerPage } from './option-pickers';
import { LinkNotesPage } from './link-notes';
import { SearchView } from './search-view';
import { DatePickerPage, TimePickerPage } from './datetime-pickers';
import type { MainView } from './chrome';

type Page =
  | 'month'
  | 'year'
  | 'week'
  | 'day'
  | 'agenda'
  | 'search'
  | 'form'
  | 'detail'
  | 'color'
  | 'repeat'
  | 'alert'
  | 'linkNotes'
  | 'pickDate'
  | 'pickTime';

/** 五个主页视图（胶囊/下拉可直达） */
const HOME_VIEWS: Page[] = ['month', 'year', 'week', 'day', 'agenda'];

type DateTarget = 'date' | 'endDate';
type TimeTarget = 'start' | 'end';

/**
 * 深色模式变量覆盖（Task 31-a）：html.dark 时在本 App 根节点注入 --cal-* 深色值，
 * shared.tsx / chrome.tsx / event-form.tsx 等的颜色常量经 var(--) 引用自动切换;
 * 浅色时这些类不生效，各常量回退到原浅色值（视觉零变化）。
 */
const CAL_DARK_VARS =
  'dark:[--cal-bg:#18181B] dark:[--cal-card:#27272A] dark:[--cal-text:#F4F4F5] dark:[--cal-text-2:#A1A1AA] dark:[--cal-text-3:#71717A] ' +
  'dark:[--cal-divider:rgba(255,255,255,0.09)] dark:[--cal-accent-soft:rgba(229,73,60,0.18)] dark:[--cal-gold-soft:rgba(199,154,59,0.22)] dark:[--cal-mi-blue:#6E9EFC] ' +
  'dark:[--cal-form-bg:#18181B] dark:[--cal-seg-track:#26262B] dark:[--cal-seg-active:#3F3F46] ' +
  'dark:[--cal-fill-soft:rgba(255,255,255,0.08)] dark:[--cal-fill-med:rgba(255,255,255,0.22)] dark:[--cal-wheel-near:rgba(255,255,255,0.45)] dark:[--cal-wheel-far:rgba(255,255,255,0.20)]';

export default function CalendarApp() {
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);

  // 路由（dir：1 前进 / -1 返回，用于轻转场）
  const [page, setPage] = useState<Page>('month');
  const [dir, setDir] = useState(1);
  const navigate = useCallback((to: Page, direction = 1) => {
    setDir(direction);
    setPage(to);
  }, []);

  // 月历状态
  const now = new Date();
  const [viewYM, setViewYM] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedKey, setSelectedKey] = useState(() => dateToKey(new Date()));

  // 表单 / 详情 / 二级页状态
  const [draft, setDraft] = useState<EventDraft>(() => blankDraft(''));
  const [formError, setFormError] = useState('');
  const [isEdit, setIsEdit] = useState(false);
  /** 表单返回目标（新建来源的主页视图） */
  const [formFrom, setFormFrom] = useState<Page>('month');
  /** 详情返回目标（主页视图或搜索页） */
  const [detailFrom, setDetailFrom] = useState<Page>('month');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dateTarget, setDateTarget] = useState<DateTarget>('date');
  const [timeTarget, setTimeTarget] = useState<TimeTarget>('start');

  // 轻提示
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 1800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  // ---------------- 数据加载 ----------------

  const reload = useCallback(async () => {
    try {
      const [evs, ns] = await Promise.all([localDB.getAll('events'), localDB.getAll('notes')]);
      setEvents(evs);
      setNotes(ns);
    } catch {
      /* IndexedDB 不可用时保持空列表 */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  const eventsN = useMemo(() => events.map(normalizeEvent), [events]);

  const detailEv = useMemo(
    () => (detailId ? (eventsN.find((e) => e.id === detailId) ?? null) : null),
    [eventsN, detailId]
  );

  /** 详情页当日备忘录：强关联或同日（剔除回收站） */
  const detailNotes = useMemo(() => {
    if (!detailEv) return [];
    return notes
      .filter((n) => !n.deletedAt && noteRelatesToEvent(n, detailEv))
      .sort((a, b) => {
        const la = noteLinkedToEvent(a, detailEv) ? 1 : 0;
        const lb = noteLinkedToEvent(b, detailEv) ? 1 : 0;
        if (la !== lb) return lb - la;
        return b.updatedAt - a.updatedAt;
      });
  }, [notes, detailEv]);

  // ---------------- 视图切换 / 日期定位 ----------------

  /** 选中某日并联动月历年月（各主页共用） */
  const gotoKey = useCallback((key: string) => {
    setSelectedKey(key);
    const [ys, ms] = key.split('-').map((v) => parseInt(v, 10));
    if (ys && ms) setViewYM({ y: ys, m: ms - 1 });
  }, []);

  /** 平移选中日（周视图 ±7 / 日视图 ±1） */
  const shiftDays = useCallback(
    (delta: number) => {
      const { y, m, d } = keyToParts(selectedKey);
      gotoKey(dateToKey(new Date(y, m, d + delta)));
    },
    [gotoKey, selectedKey]
  );

  const shiftMonth = useCallback((delta: number) => {
    setViewYM((v) => {
      const t = v.y * 12 + v.m + delta;
      return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    });
  }, []);

  /** 回今天（保持当前主页视图） */
  const goToday = useCallback(() => {
    gotoKey(dateToKey(new Date()));
  }, [gotoKey]);

  /** 胶囊 / 默认视图下拉切换主页视图 */
  const switchView = useCallback(
    (v: MainView) => {
      navigate(v, 1);
    },
    [navigate]
  );

  const openEvent = useCallback(
    (ev: NormalizedEvent, from: Page = 'month') => {
      setDetailFrom(from);
      setDetailId(ev.id);
      navigate('detail');
    },
    [navigate]
  );

  // ---------------- 表单动作 ----------------

  /** 新建日程：可带日期与起始小时（时间网格空白格落点） */
  const openNewForm = useCallback(
    (date?: string, startHour?: number) => {
      setIsEdit(false);
      setFormError('');
      const d = blankDraft(date ?? selectedKey);
      if (typeof startHour === 'number') {
        d.start = `${pad2(startHour)}:00`;
        d.end = `${pad2((startHour + 1) % 24)}:00`;
      }
      setFormFrom(HOME_VIEWS.includes(page) ? page : 'month');
      setDraft(d);
      navigate('form');
    },
    [navigate, page, selectedKey]
  );

  const openEditForm = useCallback(
    (ev: NormalizedEvent) => {
      setIsEdit(true);
      setFormError('');
      setFormFrom(HOME_VIEWS.includes(page) ? page : 'month');
      setDraft(draftFromEvent(ev));
      navigate('form');
    },
    [navigate, page]
  );

  /** 草稿修补：跨天字段联动（开始日 > 结束日自动对齐） */
  const patchDraft = useCallback((p: Partial<EventDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (next.endDate < next.date) next.endDate = next.date;
      return next;
    });
    setFormError('');
  }, []);

  const cancelForm = useCallback(() => {
    navigate(isEdit ? 'detail' : formFrom, -1);
  }, [formFrom, isEdit, navigate]);

  const saveForm = useCallback(() => {
    if (!draft.title.trim()) {
      setFormError('请先填写日程标题');
      return;
    }
    if (!draft.allDay && draft.date === draft.endDate && draft.end <= draft.start) {
      setFormError('结束时间需晚于开始时间');
      return;
    }
    const rec = draftToRecord(draft, draft.id ?? genId());
    void (async () => {
      try {
        await localDB.put('events', rec);
      } catch {
        /* 忽略保存异常 */
      }
      await reload();
      const [ys, ms] = rec.date.split('-').map((v) => parseInt(v, 10));
      if (ys && ms) setViewYM({ y: ys, m: ms - 1 });
      setSelectedKey(rec.date);
      if (isEdit) {
        setDetailId(rec.id);
        navigate('detail', -1);
        toast('日程已更新');
      } else {
        navigate(formFrom, -1);
        toast('已添加日程');
      }
    })();
  }, [draft, formFrom, isEdit, navigate, reload, toast]);

  // ---------------- 详情动作 ----------------

  const deleteEvent = useCallback(() => {
    if (!detailEv) return;
    const evId = detailEv.id;
    void (async () => {
      try {
        await localDB.delete('events', evId);
        // 只清备忘录的关联字段，保留笔记本体与 linkDate 日期关联
        const linked = notes.filter((n) => n.linkedEventId === evId);
        await Promise.all(
          linked.map((n) => {
            const rest: NoteRecord = { ...n };
            delete rest.linkedEventId;
            return localDB.put('notes', rest);
          })
        );
      } catch {
        /* 忽略删除异常 */
      }
      await reload();
      navigate(detailFrom, -1);
      toast('日程已删除，备忘录已保留');
    })();
  }, [detailEv, detailFrom, navigate, notes, reload, toast]);

  const createLinkedNote = useCallback(() => {
    if (!detailEv) return;
    const ev = detailEv;
    const rec: NoteRecord = {
      id: genId(),
      title: ev.title || '当日备忘录',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      linkedEventId: ev.id,
      linkDate: ev.date,
    };
    void (async () => {
      try {
        await localDB.put('notes', rec);
      } catch {
        /* 忽略写入异常 */
      }
      await reload();
      toast('已新建当日备忘录');
    })();
  }, [detailEv, reload, toast]);

  /** 关联/换选备忘录：单选；换选时旧条目只清 linkedEventId（保留 linkDate 日期关联） */
  const linkNote = useCallback(
    (noteId: string | null) => {
      if (!detailEv) return;
      const ev = detailEv;
      void (async () => {
        try {
          const old = notes.find((n) => n.linkedEventId === ev.id);
          if (old && old.id !== noteId) {
            const rest: NoteRecord = { ...old };
            delete rest.linkedEventId;
            await localDB.put('notes', rest);
          }
          if (noteId) {
            const target = notes.find((n) => n.id === noteId);
            if (target) await localDB.put('notes', { ...target, linkedEventId: ev.id, linkDate: ev.date });
          }
        } catch {
          /* 忽略写入异常 */
        }
        await reload();
      })();
    },
    [detailEv, notes, reload]
  );

  // ---------------- 渲染 ----------------

  if (!loaded) {
    return <div className={`h-full w-full ${CAL_DARK_VARS}`} style={{ backgroundColor: BG }} />;
  }

  const animClass = dir >= 0 ? 'animate-in fade-in slide-in-from-right-2 duration-200' : 'animate-in fade-in slide-in-from-left-2 duration-200';

  return (
    <div className={`relative h-full w-full overflow-hidden ${CAL_DARK_VARS}`} style={{ backgroundColor: BG }}>
      <div key={page} className={`h-full ${animClass}`}>
        {page === 'month' && (
          <MonthView
            events={eventsN}
            viewYM={viewYM}
            selectedKey={selectedKey}
            onSelectKey={gotoKey}
            onShiftMonth={shiftMonth}
            onSwitchView={switchView}
            onOpenSearch={() => navigate('search')}
            onToday={goToday}
            onNew={() => openNewForm()}
            onOpenEvent={(ev) => openEvent(ev, 'month')}
          />
        )}

        {page === 'year' && (
          <YearView
            y={viewYM.y}
            onShiftYear={(delta) => setViewYM((v) => ({ y: v.y + delta, m: v.m }))}
            onGotoMonth={(y, m) => {
              setViewYM({ y, m });
              navigate('month');
            }}
            onSwitchView={switchView}
            onOpenSearch={() => navigate('search')}
            onToday={goToday}
            onNew={() => openNewForm()}
          />
        )}

        {(page === 'week' || page === 'day') && (
          <WeekDayView
            mode={page === 'week' ? 'week' : 'day'}
            events={eventsN}
            viewYM={viewYM}
            selectedKey={selectedKey}
            onSelectKey={gotoKey}
            onShiftDays={shiftDays}
            onSwitchView={switchView}
            onOpenSearch={() => navigate('search')}
            onToday={goToday}
            onNew={(date, hour) => openNewForm(date, hour)}
            onOpenEvent={(ev) => openEvent(ev, page)}
          />
        )}

        {page === 'agenda' && (
          <AgendaView
            events={eventsN}
            viewYM={viewYM}
            selectedKey={selectedKey}
            onSwitchView={switchView}
            onOpenSearch={() => navigate('search')}
            onToday={goToday}
            onNew={() => openNewForm()}
            onOpenEvent={(ev) => openEvent(ev, 'agenda')}
          />
        )}

        {page === 'search' && (
          <SearchView events={eventsN} onCancel={() => navigate('month', -1)} onOpenEvent={(ev) => openEvent(ev, 'search')} />
        )}

        {page === 'form' && (
          <EventForm
            draft={draft}
            error={formError}
            isEdit={isEdit}
            onPatch={patchDraft}
            onCancel={cancelForm}
            onAdd={saveForm}
            onOpenRepeat={() => navigate('repeat')}
            onOpenAlert={() => navigate('alert')}
            onOpenColor={() => navigate('color')}
            onPickDate={(t) => {
              setDateTarget(t);
              navigate('pickDate');
            }}
            onPickTime={(t) => {
              setTimeTarget(t);
              navigate('pickTime');
            }}
          />
        )}

        {page === 'detail' && detailEv && (
          <EventDetail
            ev={detailEv}
            notes={detailNotes}
            onClose={() => navigate(detailFrom, -1)}
            onEdit={() => openEditForm(detailEv)}
            onDelete={deleteEvent}
            onCreateNote={createLinkedNote}
            onOpenLink={() => navigate('linkNotes')}
            onOpenNote={() => {
              /* 跳备忘录 App（ios 壳 openApp） */
              void import('@/lib/ios/store').then(({ useUI }) => useUI.getState().openApp('notes'));
            }}
          />
        )}

        {page === 'color' && (
          <ColorPickerPage
            value={draft.color}
            eventTitle={draft.title}
            onPick={(key) => {
              patchDraft({ color: key });
              navigate('form', -1);
            }}
            onBack={() => navigate('form', -1)}
          />
        )}

        {page === 'repeat' && (
          <RepeatPickerPage
            value={draft.repeatRule}
            onPick={(key) => {
              patchDraft({ repeatRule: key });
              navigate('form', -1);
            }}
            onBack={() => navigate('form', -1)}
          />
        )}

        {page === 'alert' && (
          <AlertPickerPage
            value={draft.alert}
            onPick={(key) => {
              patchDraft({ alert: key });
              navigate('form', -1);
            }}
            onBack={() => navigate('form', -1)}
          />
        )}

        {page === 'linkNotes' && detailEv && (
          <LinkNotesPage
            ev={detailEv}
            notes={notes.filter((n) => !n.deletedAt)}
            onBack={() => navigate('detail', -1)}
            onLink={linkNote}
            onCreateNote={createLinkedNote}
          />
        )}

        {page === 'pickDate' && (
          <DatePickerPage
            value={dateTarget === 'date' ? draft.date : draft.endDate}
            title={dateTarget === 'date' ? '开始日期' : '结束日期'}
            onDone={(key) => {
              patchDraft(dateTarget === 'date' ? { date: key } : { endDate: key });
              navigate('form', -1);
            }}
            onBack={() => navigate('form', -1)}
          />
        )}

        {page === 'pickTime' && (
          <TimePickerPage
            value={timeTarget === 'start' ? draft.start : draft.end}
            title={timeTarget === 'start' ? '开始时间' : '结束时间'}
            dateLabel={formatDayLong(draft.date)}
            onDone={(v) => {
              patchDraft(timeTarget === 'start' ? { start: v } : { end: v });
              navigate('form', -1);
            }}
            onBack={() => navigate('form', -1)}
          />
        )}
      </div>

      {/* 轻提示 */}
      {toastMsg && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 rounded-full px-4 py-2 text-[13px] duration-200 dark:bg-zinc-700/90!"
          style={{ backgroundColor: 'rgba(41,36,31,0.82)', color: '#FFFFFF' }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

/** 导出供潜在测试/排查使用（保持与旧版一致的排序口径） */
export { sortEvents, occursOn };
