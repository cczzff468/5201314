'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleCheck, Flag, Info, Plus, X } from 'lucide-react';
import { localDB, genId, type ReminderRecord } from '@/lib/ios/db';
import { IOSNavBar } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

/**
 * 提醒事项 App：
 * - 未完成列表（createdAt 升序）+ 已完成折叠区（自动沉底）
 * - 行内圆圈完成切换（scale 过渡）+ Info 打开详情编辑底部 Sheet
 * - 底部圆角快速新建栏（Enter / 失焦非空即创建）
 * - #24：支持「不重复/每天/工作日/周末/自定义 weekday 多选」重复提醒；
 *   保存后 mount 时自动同步 dueDate 到下一个匹配 weekday（ReminderWatcher 只读不改、
 *   只看 dueDate+dueTime，重复语义由本 App 同步驱动）
 * - #25：挂载时静默请求 Notification 权限，全局到期通知由 ReminderWatcher 负责
 *   （src/components/ios/ReminderWatcher.tsx 只读；同一 IndexedDB 表）
 * 数据持久化于 IndexedDB reminders 表。
 */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** #24：重复预设选项 */
const REPEAT_PRESETS: { key: string; label: string; weekdays: number[] }[] = [
  { key: 'none', label: '不重复', weekdays: [] },
  { key: 'daily', label: '每天', weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { key: 'weekday', label: '工作日', weekdays: [1, 2, 3, 4, 5] },
  { key: 'weekend', label: '周末', weekdays: [0, 6] },
];
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** #24：给定起始日与 weekday 集合，返回下一个匹配的 YYYY-MM-DD（从 from 起始包含当天） */
function nextMatchingDate(from: Date, weekdays: number[]): string {
  if (weekdays.length === 0) return `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`;
  const set = new Set(weekdays);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    if (set.has(d.getDay())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`;
}

/** #24：重复提醒的简短描述（“每天”、“工作日”、“周一周三…”） */
function repeatLabel(r: ReminderRecord): string {
  if (!r.repeat || r.repeat.length === 0) return '';
  for (const p of REPEAT_PRESETS) {
    if (p.weekdays.length > 0 && p.weekdays.every((d) => r.repeat!.includes(d)) && r.repeat!.length === p.weekdays.length) {
      return p.label;
    }
  }
  return r.repeat.map((d) => `周${WEEKDAY_LABELS[d] ?? ''}`).join('');
}

/** 到期副标题：今天/过期红色，其他日期 muted；仅时间视为今天的提醒。
 *  #24：有 repeat 字段时显示重复描述（“每天 09:00” / “工作日” 等），不再逐天标红。 */
function dueInfo(r: ReminderRecord): { text: string; red: boolean } | null {
  const repLabel = repeatLabel(r);
  const today = todayKey();
  if (r.dueDate) {
    const timePart = r.dueTime ? ` ${r.dueTime}` : '';
    if (repLabel) {
      // 重复提醒：不逐天标红，仅提示重复语义 + 时间
      return { text: `${repLabel}${timePart}`, red: false };
    }
    if (r.dueDate === today) return { text: `今天${timePart}`, red: true };
    const parts = r.dueDate.split('-').map((v) => parseInt(v, 10));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return { text: `${parts[1]}月${parts[2]}日${timePart}`, red: r.dueDate < today };
    }
    return null;
  }
  if (r.dueTime) {
    const now = new Date();
    return { text: `今天 ${r.dueTime}`, red: r.dueTime < `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
  }
  return null;
}

/** 未完成在上（各自按 createdAt 升序） */
function sortReminders(list: ReminderRecord[]): ReminderRecord[] {
  return [...list].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.createdAt - b.createdAt;
  });
}

// ---------------- 行组件 ----------------

function CircleToggle({
  completed,
  onToggle,
  label,
}: {
  completed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className={`mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-200 active:scale-90 ${
        completed ? 'border-foreground bg-foreground' : 'border-muted-foreground/40 bg-transparent'
      }`}
    >
      <Check
        className={`h-3 w-3 text-background transition-transform duration-200 ${
          completed ? 'scale-100' : 'scale-0'
        }`}
        strokeWidth={3.5}
      />
    </button>
  );
}

function ReminderRow({
  r,
  onToggle,
  onInfo,
}: {
  r: ReminderRecord;
  onToggle: (r: ReminderRecord) => void;
  onInfo: (r: ReminderRecord) => void;
}) {
  const due = dueInfo(r);
  return (
    <div className="flex items-start gap-3 py-2.5 pl-4 pr-3">
      <CircleToggle
        completed={r.completed}
        onToggle={() => onToggle(r)}
        label={r.completed ? '标记为未完成' : '标记为完成'}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[17px] leading-snug ${
            r.completed ? 'text-muted-foreground line-through' : ''
          }`}
        >
          {r.title}
        </div>
        {due && (
          <div
            className={`mt-0.5 truncate text-[13px] leading-snug ${
              due.red ? 'text-[#FF453A]' : 'text-muted-foreground'
            }`}
          >
            {due.text}
          </div>
        )}
        {r.notes && <div className="mt-0.5 truncate text-[13px] leading-snug text-muted-foreground/70">{r.notes}</div>}
      </div>
      {r.flagged && !r.completed && (
        <Flag className="mt-1 h-3.5 w-3.5 shrink-0 fill-[#FF9F0A] text-[#FF9F0A]" strokeWidth={1.8} />
      )}
      <button
        type="button"
        onClick={() => onInfo(r)}
        aria-label="详细信息"
        className="shrink-0 self-center p-1 transition-opacity active:opacity-50"
      >
        <Info className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ---------------- 详情编辑 Sheet ----------------

function ReminderSheet({
  reminder,
  onClose,
  onSave,
  onDelete,
}: {
  reminder: ReminderRecord;
  onClose: () => void;
  onSave: (r: ReminderRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [title, setTitle] = useState(reminder.title);
  const [notes, setNotes] = useState(reminder.notes);
  const [dueDate, setDueDate] = useState(reminder.dueDate);
  const [dueTime, setDueTime] = useState(reminder.dueTime);
  const [flagged, setFlagged] = useState(reminder.flagged);
  // #24：重复 weekday 数组（0=周日..6=周六；[]/undefined=不重复）
  const [repeat, setRepeat] = useState<number[]>(reminder.repeat ?? []);
  const [customOpen, setCustomOpen] = useState(false);

  // 双 rAF 触发上滑动画（setState 在 rAF 回调内）
  useEffect(() => {
    let alive = true;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) setShown(true);
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const canSave = title.trim().length > 0;

  /** #24：选中预设或自定义时计算 repeat 数组 */
  const applyPreset = (weekdays: number[]) => setRepeat(weekdays);
  const toggleWeekday = (d: number) =>
    setRepeat((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const matchedPreset = REPEAT_PRESETS.find(
    (p) => p.weekdays.length === repeat.length && p.weekdays.every((d) => repeat.includes(d))
  );

  return (
    <div className="absolute inset-0 z-40">
      <button
        aria-label="关闭面板"
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`no-scrollbar absolute inset-x-0 bottom-0 max-h-[88%] overflow-y-auto rounded-t-[20px] border-t border-border/60 bg-background shadow-2xl transition-transform duration-300 ease-out ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="relative flex justify-center pt-2.5">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="absolute right-4 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/60 shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 pb-[34px] pt-4">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            aria-label="提醒标题"
            className="h-11 rounded-[14px] border-none bg-white/60 text-[17px] ring-1 ring-white/70 backdrop-blur-xl placeholder:text-muted-foreground/60 dark:bg-white/[0.08] dark:ring-white/[0.1]"
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="备注"
            aria-label="备注"
            className="min-h-[76px] rounded-[14px] border-none bg-white/60 text-[15px] ring-1 ring-white/70 backdrop-blur-xl placeholder:text-muted-foreground/60 dark:bg-white/[0.08] dark:ring-white/[0.1]"
          />
          <div className="flex gap-3">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="到期日期"
              className="h-11 min-w-0 flex-1 rounded-[14px] bg-white/60 px-3 text-[15px] text-foreground outline-none ring-1 ring-white/70 backdrop-blur-xl [color-scheme:light] dark:bg-white/[0.08] dark:ring-white/[0.1] dark:[color-scheme:dark]"
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              aria-label="到期时间"
              className="h-11 min-w-0 flex-1 rounded-[14px] bg-white/60 px-3 text-[15px] text-foreground outline-none ring-1 ring-white/70 backdrop-blur-xl [color-scheme:light] dark:bg-white/[0.08] dark:ring-white/[0.1] dark:[color-scheme:dark]"
            />
          </div>
          <div className="flex h-11 items-center justify-between rounded-[14px] bg-white/60 px-4 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
            <span className="text-[15px]">标记</span>
            <Switch checked={flagged} onCheckedChange={setFlagged} aria-label="标记提醒" />
          </div>
          {/* #24：重复选择——预设 4 项 + 自定义 weekday 多选 */}
          <div className="rounded-[14px] bg-white/60 px-4 py-3 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
            <div className="text-[15px]">重复</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {REPEAT_PRESETS.map((p) => {
                const active =
                  matchedPreset?.key === p.key ||
                  (p.key === 'none' && repeat.length === 0) ||
                  (p.key !== 'none' &&
                    p.weekdays.length === repeat.length &&
                    p.weekdays.every((d) => repeat.includes(d)));
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.weekdays)}
                    aria-pressed={active}
                    className={`rounded-full px-3.5 py-[7px] text-[13px] leading-none shadow-sm transition active:scale-[0.96] ${
                      active
                        ? 'bg-foreground font-medium text-background'
                        : 'bg-white/60 text-foreground/80 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                aria-pressed={customOpen}
                aria-label="自定义重复星期"
                className={`rounded-full px-3.5 py-[7px] text-[13px] leading-none shadow-sm transition active:scale-[0.96] ${
                  customOpen || (repeat.length > 0 && !matchedPreset)
                    ? 'bg-foreground font-medium text-background'
                    : 'bg-white/60 text-foreground/80 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]'
                }`}
              >
                自定义
              </button>
            </div>
            {(customOpen || (repeat.length > 0 && !matchedPreset)) && (
              <div className="mt-3 flex items-center gap-1.5">
                {WEEKDAY_LABELS.map((lbl, idx) => {
                  const on = repeat.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleWeekday(idx)}
                      aria-pressed={on}
                      aria-label={`周${lbl}`}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] shadow-sm transition active:scale-[0.96] ${
                        on
                          ? 'bg-foreground font-medium text-background'
                          : 'bg-white/60 text-foreground/70 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            )}
            {repeat.length > 0 && (
              <div className="mt-2 text-[12px] leading-snug text-muted-foreground">
                {matchedPreset ? matchedPreset.label : `每 ${repeat.map((d) => `周${WEEKDAY_LABELS[d] ?? ''}`).join('、')}`}
                {dueDate && ' · 保存后将自动同步到下一个匹配日'}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDelete(reminder.id)}
            className="h-11 rounded-[14px] bg-white/60 text-[17px] text-[#FF453A] ring-1 ring-white/70 backdrop-blur-xl transition-opacity active:opacity-60 dark:bg-white/[0.08] dark:ring-white/[0.1]"
          >
            删除提醒
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({ ...reminder, title: title.trim(), notes: notes.trim(), dueDate, dueTime, flagged, repeat })
            }
            className="mt-1 h-11 rounded-full bg-foreground text-[17px] font-medium text-background transition-opacity active:opacity-80 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 主应用 ----------------

export default function RemindersApp() {
  const [loaded, setLoaded] = useState(false);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [editing, setEditing] = useState<ReminderRecord | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 初次加载（await 之后再 setState）+ #24 同步重复提醒的 dueDate 到下一个匹配 weekday +
  // #25 静默请求 Notification 权限（全局到期通知由 ReminderWatcher 负责）
  useEffect(() => {
    let alive = true;
    void (async () => {
      // #25：静默请求通知权限（不阻塞；用户未授权时 ReminderWatcher 仍可用应用内横幅）
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => undefined);
        }
      } catch {
        /* 权限 API 不可用 */
      }
      try {
        const all = await localDB.getAll('reminders');
        // #24：对启用了 repeat 且未完成的提醒，若 dueDate 已过期或不在 repeat weekday 上，
        // 同步 dueDate 到「今天/未来最近匹配 weekday」——ReminderWatcher 仅看 dueDate+dueTime，
        // 由本同步保证下一次触发对齐 weekday 语义
        const today = new Date();
        const todayStr = todayKey();
        let mutated = false;
        const synced = all.map((r) => {
          if (!r.repeat || r.repeat.length === 0 || r.completed || !r.dueDate) return r;
          // dueDate 已是未来且匹配 weekday → 不动；否则同步到下一个匹配日
          if (r.dueDate >= todayStr && r.repeat.includes(new Date(r.dueDate).getDay())) return r;
          const next = nextMatchingDate(today, r.repeat);
          if (next !== r.dueDate) {
            mutated = true;
            return { ...r, dueDate: next };
          }
          return r;
        });
        if (mutated) {
          await Promise.all(
            synced
              .filter((r, i) => r !== all[i])
              .map((r) => localDB.put('reminders', r).catch(() => undefined))
          );
        }
        if (alive) setReminders(sortReminders(synced));
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // #25：本应用可见时（document.visible）的本地到期通知触发——ReminderWatcher 仅在 document.hidden
  // 时发系统级 Notification，可见时只发横幅；为满足「到期时 new Notification('提醒', ...)」要求，
  // 本应用打开时每 10s 轮询，命中到期即发 Notification（与 ReminderWatcher 的 localStorage 防重键
  // 'ios-reminder-fired' 共享，避免重复触发）；权限未授予/熄屏/不可见时跳过。
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const FIRED_KEY = 'ios-reminder-fired';
    const firedSet = new Set<string>();
    try {
      const raw = window.localStorage.getItem(FIRED_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        for (const k of Object.keys(obj)) firedSet.add(k);
      }
    } catch {
      /* 无标记/解析失败视为空 */
    }
    const markFired = (key: string) => {
      firedSet.add(key);
      try {
        const obj: Record<string, number> = {};
        for (const k of firedSet) obj[k] = Date.now();
        window.localStorage.setItem(FIRED_KEY, JSON.stringify(obj));
      } catch {
        /* 存储不可用：本次会话内存防重仍生效 */
      }
    };
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      if (Notification.permission !== 'granted') return;
      const now = Date.now();
      for (const r of reminders) {
        if (r.completed) continue;
        let due: number | null = null;
        if (r.dueDate) {
          const [y, mo, d] = r.dueDate.split('-').map((v) => parseInt(v, 10));
          const [h, mi] = (r.dueTime || '09:00').split(':').map((v) => parseInt(v, 10));
          if ([y, mo, d, h, mi].every((v) => Number.isFinite(v))) {
            due = new Date(y, mo - 1, d, h, mi).getTime();
          }
        } else if (r.dueTime) {
          const n = new Date();
          due = new Date(n.getFullYear(), n.getMonth(), n.getDate(), parseInt(r.dueTime.slice(0, 2), 10), parseInt(r.dueTime.slice(3, 5), 10)).getTime();
        }
        if (due === null || due > now || now - due > 2 * 60_000) continue;
        const key = `rw:r:${r.id}:${Math.floor(due / 60000)}`;
        if (firedSet.has(key)) continue;
        try {
          new Notification('提醒', { body: r.title, tag: key });
          markFired(key);
        } catch {
          /* 构造失败静默 */
        }
      }
    };
    void check();
    const iv = window.setInterval(check, 10_000);
    return () => window.clearInterval(iv);
  }, [reminders]);

  const pending = reminders.filter((r) => !r.completed);
  const completed = reminders.filter((r) => r.completed);

  function createFromDraft() {
    const title = draft.trim();
    if (!title) return;
    const rec: ReminderRecord = {
      id: genId(),
      title,
      notes: '',
      completed: false,
      flagged: false,
      dueDate: '',
      dueTime: '',
      createdAt: Date.now(),
      completedAt: null,
    };
    setDraft('');
    setReminders((prev) => sortReminders([...prev, rec]));
    void localDB.put('reminders', rec).catch(() => undefined);
  }

  function toggleDone(r: ReminderRecord) {
    const updated: ReminderRecord = {
      ...r,
      completed: !r.completed,
      completedAt: !r.completed ? Date.now() : null,
    };
    setReminders((prev) => sortReminders(prev.map((x) => (x.id === r.id ? updated : x))));
    void localDB.put('reminders', updated).catch(() => undefined);
  }

  function saveFromSheet(rec: ReminderRecord) {
    setReminders((prev) => sortReminders(prev.map((x) => (x.id === rec.id ? rec : x))));
    void localDB.put('reminders', rec).catch(() => undefined);
    setEditing(null);
  }

  function deleteFromSheet(id: string) {
    setReminders((prev) => prev.filter((x) => x.id !== id));
    void localDB.delete('reminders', id).catch(() => undefined);
    setEditing(null);
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="提醒事项" left={<BackToHome className="static!" />} />

        {reminders.length > 0 && (
          <div className="px-5 pb-1 pt-0.5 text-[13px] text-muted-foreground">{pending.length} 项未完成</div>
        )}

        <div className="px-4 pb-[124px] pt-1">
          {loaded && reminders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-24 text-muted-foreground">
              <CircleCheck className="h-14 w-14 opacity-40" strokeWidth={1.1} />
              <div className="text-[17px] font-medium text-foreground/70">没有提醒事项</div>
            </div>
          ) : (
            reminders.length > 0 && (
              <div className="divide-y divide-border/60 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
                {pending.map((r) => (
                  <ReminderRow key={r.id} r={r} onToggle={toggleDone} onInfo={setEditing} />
                ))}

                {completed.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="flex w-full items-center gap-1 px-4 py-2.5 text-left"
                      aria-expanded={showCompleted}
                    >
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                          showCompleted ? 'rotate-90' : ''
                        }`}
                        strokeWidth={2.2}
                      />
                      <span className="text-[17px] font-medium text-muted-foreground">已完成</span>
                      <span className="ml-auto text-[13px] text-muted-foreground">{completed.length}</span>
                    </button>
                    {showCompleted &&
                      completed.map((r) => <ReminderRow key={r.id} r={r} onToggle={toggleDone} onInfo={setEditing} />)}
                  </>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* 底部快速新建栏（避开 28px Home 热区） */}
      <div className="absolute inset-x-4 bottom-[34px] z-30">
        <div className="flex items-center gap-3 rounded-full bg-white/60 px-4 py-3 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <Plus className="h-6 w-6 shrink-0 text-muted-foreground/70" strokeWidth={2} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                createFromDraft();
              }
            }}
            onBlur={() => createFromDraft()}
            placeholder="新提醒"
            aria-label="新提醒"
            className="h-6 w-full bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {editing && (
        <ReminderSheet
          key={editing.id}
          reminder={editing}
          onClose={() => setEditing(null)}
          onSave={saveFromSheet}
          onDelete={deleteFromSheet}
        />
      )}
    </div>
  );
}
