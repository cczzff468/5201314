'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  AlarmClock,
  Bell,
  ChevronDown,
  ChevronUp,
  Globe,
  Hourglass,
  Plus,
  Search,
  Timer,
} from 'lucide-react';
// 注意：组件名以小写开头时 JSX 会当作 DOM 内置元素（TS 报 IntrinsicElements 错误），故别名为大写开头
import { IOSActionSheet } from '@/components/ios/ActionSheet';
import { IOSNavBar } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { useLongPress } from '@/hooks/use-long-press';
import { useUI } from '@/lib/ios/store';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { genId, localDB, type AlarmRecord, type WorldCityRecord } from '@/lib/ios/db';

// ================= 工具 =================

const pad2 = (n: number): string => String(n).padStart(2, '0');

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function todayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 每个时区缓存一个 HH:mm:ss 格式化器 */
const timeFmtCache = new Map<string, Intl.DateTimeFormat>();
function timeFmt(tz: string): Intl.DateTimeFormat {
  let f = timeFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    timeFmtCache.set(tz, f);
  }
  return f;
}

/** 每个时区缓存一个 日期+时分 格式化器（用于计算时差/昨天今天） */
const metaFmtCache = new Map<string, Intl.DateTimeFormat>();
function metaFmt(tz: string): Intl.DateTimeFormat {
  let f = metaFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    metaFmtCache.set(tz, f);
  }
  return f;
}

function tzParts(tz: string, date: Date): { ymd: string; h: number; m: number } {
  const parts = metaFmt(tz).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    h: parseInt(get('hour'), 10) % 24,
    m: parseInt(get('minute'), 10),
  };
}

/** 世界时钟副标题："今天，+N小时" */
function offsetLabel(tz: string, now: Date): string {
  const p = tzParts(tz, now);
  const localYmd = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const day = p.ymd === localYmd ? '今天' : p.ymd < localYmd ? '昨天' : '明天';
  let diff = p.h * 60 + p.m - (now.getHours() * 60 + now.getMinutes());
  if (diff > 720) diff -= 1440;
  else if (diff <= -720) diff += 1440;
  const sign = diff < 0 ? '-' : '+';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${day}，${sign}${h}小时${m > 0 ? `${m}分` : ''}`;
}

function createAudioContext(): AudioContext | null {
  try {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

function beepOnce(ctx: AudioContext, at: number, freq: number, dur: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.22, at + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** 计时器到点：880Hz 三连响 */
function playTripleBeep(): void {
  const ctx = createAudioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < 3; i += 1) beepOnce(ctx, t0 + i * 0.4, 880, 0.3);
  window.setTimeout(() => void ctx.close().catch(() => undefined), 1600);
}

// ================= 底部 Sheet =================

function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [shown, setShown] = useState(false);
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
  return (
    <div className="absolute inset-0 z-40">
      <button
        aria-label="关闭面板"
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-x-0 bottom-0 rounded-t-[20px] border-t border-border/60 bg-background/85 shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-out ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// ================= 世界时钟 =================

/** 星期字符映射：getDay() 0=日 */
const WEEKDAY_CHARS = '日一二三四五六';

/**
 * SVG 指针式表盘（黑白灰 + iOS 橙秒针，深浅色随主题 token 自适应）。
 * - detailed=true：英雄时钟——60 刻度（12 主 48 次）、粗短时针/分针、细长橙秒针
 * - detailed=false：城市行 26px 迷你时钟——仅 12 个主刻度，指针加粗保证小尺寸可读
 * 指针用 currentColor（svg 容器 text-foreground），刻度用 text-muted-foreground + opacity 区分主次。
 */
function AnalogClockFace({
  h,
  m,
  s,
  size,
  detailed = false,
}: {
  h: number;
  m: number;
  s: number;
  size: number;
  detailed?: boolean;
}) {
  const hourAngle = ((h % 12) + m / 60) * 30;
  const minuteAngle = (m + s / 60) * 6;
  const secondAngle = s * 6;

  const ticks: ReactNode[] = [];
  if (detailed) {
    for (let i = 0; i < 60; i += 1) {
      const major = i % 5 === 0;
      ticks.push(
        <line
          key={i}
          x1={50}
          y1={6.5}
          x2={50}
          y2={major ? 13 : 10.5}
          stroke="currentColor"
          strokeWidth={major ? 2.4 : 1.1}
          strokeLinecap="round"
          transform={`rotate(${i * 6} 50 50)`}
          className="text-muted-foreground"
          opacity={major ? 0.9 : 0.4}
        />
      );
    }
  } else {
    for (let i = 0; i < 12; i += 1) {
      ticks.push(
        <line
          key={i}
          x1={50}
          y1={7}
          x2={50}
          y2={11}
          stroke="currentColor"
          strokeWidth={2.8}
          strokeLinecap="round"
          transform={`rotate(${i * 30} 50 50)`}
          className="text-muted-foreground"
          opacity={0.5}
        />
      );
    }
  }

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="text-foreground"
      role="img"
      aria-label={`${pad2(h)}:${pad2(m)}:${pad2(s)}`}
    >
      {/* 表盘底色 + 边框（仅英雄时钟） */}
      {detailed && <circle cx={50} cy={50} r={48.5} className="fill-muted/40 stroke-border" strokeWidth={1} />}
      {ticks}
      {/* 时针：粗短 */}
      <line
        x1={50}
        y1={detailed ? 53 : 52}
        x2={50}
        y2={detailed ? 28 : 30}
        stroke="currentColor"
        strokeWidth={detailed ? 5 : 7}
        strokeLinecap="round"
        transform={`rotate(${hourAngle} 50 50)`}
      />
      {/* 分针 */}
      <line
        x1={50}
        y1={detailed ? 54 : 53}
        x2={50}
        y2={detailed ? 20 : 23}
        stroke="currentColor"
        strokeWidth={detailed ? 3.5 : 5}
        strokeLinecap="round"
        transform={`rotate(${minuteAngle} 50 50)`}
      />
      {/* 秒针：iOS 橙，细长 */}
      <line
        x1={50}
        y1={detailed ? 56 : 54}
        x2={50}
        y2={detailed ? 16 : 21}
        stroke="#FF9F0A"
        strokeWidth={detailed ? 1.5 : 2}
        strokeLinecap="round"
        transform={`rotate(${secondAngle} 50 50)`}
      />
      {/* 中心圆点 */}
      {detailed ? (
        <>
          <circle cx={50} cy={50} r={2.6} fill="currentColor" />
          <circle cx={50} cy={50} r={1.1} fill="#FF9F0A" />
        </>
      ) : (
        <circle cx={50} cy={50} r={2.2} fill="currentColor" />
      )}
    </svg>
  );
}

function CityRow({
  city,
  now,
  onLongPress,
}: {
  city: WorldCityRecord;
  now: Date;
  onLongPress: (city: WorldCityRecord) => void;
}) {
  const full = timeFmt(city.timezone).format(now).replace(/^24:/, '00:');
  const hm = full.slice(0, 5);
  const ss = full.slice(6, 8);
  // 迷你表盘的时分秒直接从格式化字符串解析，与右侧数字时间严格同步跳动
  const clockH = parseInt(full.slice(0, 2), 10);
  const clockM = parseInt(full.slice(3, 5), 10);
  const clockS = parseInt(full.slice(6, 8), 10);
  const off = offsetLabel(city.timezone, now);
  // 长按城市行 → 弹出 iOS 底部动作表（删除城市）
  const rowLongPress = useLongPress(() => onLongPress(city));
  return (
    <div
      {...rowLongPress}
      className="flex select-none items-center gap-3 py-[15px] pl-5 pr-4"
    >
      {/* 左：城市名 + 时差胶囊 */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-[7px]">
        <div className="max-w-full truncate text-[20px] font-medium leading-tight">{city.name}</div>
        <span className="max-w-[170px] truncate rounded-full bg-white/60 px-2.5 py-[3px] text-[11px] font-medium leading-none text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
          {off}
        </span>
      </div>
      {/* 右：迷你表盘 + 大时间 + 小秒，iOS 世界时钟同款排版 */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/50 ring-1 ring-white/60 backdrop-blur-sm dark:bg-white/[0.05] dark:ring-white/[0.08]">
        <AnalogClockFace h={clockH} m={clockM} s={clockS} size={26} />
      </div>
      <div className="flex shrink-0 items-baseline gap-1">
        <span className="text-[38px] font-light leading-none tracking-tight tabular-nums">{hm}</span>
        <span className="w-[22px] text-[15px] font-light leading-none tabular-nums text-muted-foreground">{ss}</span>
      </div>
    </div>
  );
}

const FALLBACK_ZONES: string[] = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York'];

function CityAddSheet({
  existing,
  onAdd,
  onClose,
}: {
  existing: WorldCityRecord[];
  onAdd: (tz: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const zones = useMemo<string[]>(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return FALLBACK_ZONES;
    }
  }, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? zones.filter((z) => z.toLowerCase().includes(s)) : zones;
    return base.slice(0, 80);
  }, [q, zones]);

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex h-[430px] flex-col px-5 pb-4 pt-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索时区"
              className="h-10 rounded-[14px] bg-white/60 pl-9 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]"
            />
          </div>
          <button onClick={onClose} className="text-[17px] text-foreground transition-opacity active:opacity-50">
            取消
          </button>
        </div>
        <div className="thin-scrollbar mt-3 flex-1 overflow-y-auto">
          {filtered.map((z) => {
            const added = existing.some((c) => c.timezone === z);
            return (
              <button
                key={z}
                disabled={added}
                onClick={() => onAdd(z)}
                className="flex w-full items-center justify-between gap-3 rounded-[8px] px-1 py-2.5 text-left transition-colors active:bg-muted disabled:opacity-40"
              >
                <span className="shrink-0 text-[16px]">{z.split('/').pop()?.replace(/_/g, ' ') ?? z}</span>
                <span className="truncate text-[12px] text-muted-foreground">{z}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-[14px] text-muted-foreground">没有匹配的时区</div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function WorldClockView({
  addOpen,
  onAddOpenChange,
}: {
  addOpen: boolean;
  onAddOpenChange: (v: boolean) => void;
}) {
  const [cities, setCities] = useState<WorldCityRecord[]>([]);
  const [now, setNow] = useState(() => new Date());
  /** 长按中的城市（弹出删除动作表） */
  const [sheetCity, setSheetCity] = useState<WorldCityRecord | null>(null);

  // 每秒 tick
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  // 首次加载：为空时写入默认城市
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let list = await localDB.getAll('cities');
        if (list.length === 0) {
          const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          const defaults: WorldCityRecord[] = [
            { id: genId(), name: '本地', timezone: localTz },
            { id: genId(), name: '北京', timezone: 'Asia/Shanghai' },
            { id: genId(), name: '纽约', timezone: 'America/New_York' },
            { id: genId(), name: '伦敦', timezone: 'Europe/London' },
            { id: genId(), name: '东京', timezone: 'Asia/Tokyo' },
          ];
          await Promise.all(defaults.map((c) => localDB.put('cities', c)));
          list = defaults;
        }
        if (alive) setCities(list.slice().sort((a, b) => a.id.localeCompare(b.id)));
      } catch {
        /* IndexedDB 不可用时静默 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const addCity = (tz: string) => {
    if (cities.some((c) => c.timezone === tz)) return;
    const rec: WorldCityRecord = {
      id: genId(),
      name: tz.split('/').pop()?.replace(/_/g, ' ') ?? tz,
      timezone: tz,
    };
    setCities((prev) => [...prev, rec]);
    void localDB.put('cities', rec);
    onAddOpenChange(false);
  };

  const removeCity = (id: string) => {
    setCities((prev) => prev.filter((c) => c.id !== id));
    void localDB.delete('cities', id);
  };

  // 英雄时钟：本地时间（复用每秒 tick 的 now）
  const localH = now.getHours();
  const localM = now.getMinutes();
  const localS = now.getSeconds();
  const localDateLabel = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAY_CHARS.charAt(now.getDay())}`;

  return (
    <div className="relative flex h-full flex-col">
      <div className="thin-scrollbar flex-1 overflow-y-auto pb-16">
        {/* 英雄时钟：指针表盘 + 大数字本地时间 */}
        <div className="mx-4 mt-2 mb-3 overflow-hidden rounded-[20px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
          <div className="flex flex-col items-center px-4 pb-6 pt-7">
            <AnalogClockFace h={localH} m={localM} s={localS} size={176} detailed />
            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-[38px] font-light leading-none tracking-tight tabular-nums">
                {`${pad2(localH)}:${pad2(localM)}`}
              </span>
              <span className="w-[26px] text-[20px] font-light leading-none tabular-nums text-muted-foreground">
                {pad2(localS)}
              </span>
            </div>
            <div className="mt-2.5 text-[13px] leading-none text-muted-foreground">{localDateLabel}</div>
          </div>
        </div>
        {cities.length === 0 ? (
          <div className="pt-16 text-center text-[14px] text-muted-foreground">正在加载世界时钟…</div>
        ) : (
          <div className="mx-4 mt-1 divide-y divide-border/40 overflow-hidden rounded-[16px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {cities.map((c) => (
              <CityRow key={c.id} city={c} now={now} onLongPress={setSheetCity} />
            ))}
          </div>
        )}
      </div>
      {addOpen && <CityAddSheet existing={cities} onAdd={addCity} onClose={() => onAddOpenChange(false)} />}
      {/* 长按城市行的 iOS 动作表：删除（无需 confirm） */}
      <IOSActionSheet
        open={sheetCity !== null}
        actions={
          sheetCity
            ? [{ label: '删除', destructive: true, onSelect: () => removeCity(sheetCity.id) }]
            : []
        }
        onCancel={() => setSheetCity(null)}
      />
    </div>
  );
}

// ================= 闹钟 =================

const DAY_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABEL: Record<number, string> = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };

function repeatText(rep: number[]): string {
  if (rep.length === 0) return '一次';
  if (rep.length === 7) return '每天';
  return DAY_ORDER.filter((d) => rep.includes(d))
    .map((d) => `周${DAY_LABEL[d]}`)
    .join(' ');
}

function sortAlarms(list: AlarmRecord[]): AlarmRecord[] {
  return list.slice().sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.createdAt - b.createdAt));
}

function AlarmEditorSheet({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: AlarmRecord | null;
  onClose: () => void;
  onSave: (rec: AlarmRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [time, setTime] = useState(initial?.time ?? '07:00');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [repeat, setRepeat] = useState<number[]>(initial?.repeat ?? []);

  const toggleDay = (d: number) =>
    setRepeat((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = () => {
    onSave({
      id: initial?.id ?? genId(),
      time: time || '07:00',
      label: label.trim(),
      enabled: initial?.enabled ?? true,
      repeat: DAY_ORDER.filter((d) => repeat.includes(d)),
      createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <BottomSheet onClose={onClose}>
      <div className="px-5 pb-6 pt-4">
        <div className="relative text-center text-[17px] font-semibold">
          {initial ? '编辑闹钟' : '添加闹钟'}
          <button
            onClick={onClose}
            className="absolute right-0 top-1/2 -translate-y-1/2 text-[15px] font-normal text-muted-foreground transition-opacity active:opacity-50"
          >
            取消
          </button>
        </div>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="闹钟时间"
          className="mt-4 h-14 w-full rounded-[14px] bg-white/60 px-4 text-[26px] font-light tabular-nums outline-none ring-1 ring-white/70 backdrop-blur-xl [color-scheme:light] dark:bg-white/[0.08] dark:ring-white/[0.1] dark:[color-scheme:dark]"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="标签"
          className="mt-3 h-11 rounded-[14px] bg-white/60 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]"
        />
        <div className="mt-4 text-[13px] text-muted-foreground">重复</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAY_ORDER.map((d) => {
            const on = repeat.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                aria-pressed={on}
                className={`h-9 min-w-9 rounded-full px-3 text-[14px] transition-colors ${
                  on
                    ? 'bg-foreground text-background'
                    : 'bg-white/60 text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl active:bg-white/80 dark:bg-white/[0.08] dark:ring-white/[0.1] dark:active:bg-white/[0.14]'
                }`}
              >
                {DAY_LABEL[d]}
              </button>
            );
          })}
        </div>
        <button
          onClick={save}
          className="mt-5 h-12 w-full rounded-[14px] bg-foreground text-[17px] font-semibold text-background transition-opacity active:opacity-70"
        >
          保存
        </button>
        {initial && (
          <button
            onClick={() => onDelete(initial.id)}
            className="mt-2 h-11 w-full text-[17px] text-[#FF453A] transition-opacity active:opacity-60"
          >
            删除闹钟
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

function AlarmsView({
  editor,
  setEditor,
}: {
  editor: AlarmRecord | 'new' | null;
  setEditor: (v: AlarmRecord | 'new' | null) => void;
}) {
  const [alarms, setAlarms] = useState<AlarmRecord[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await localDB.getAll('alarms');
        if (alive) setAlarms(sortAlarms(list));
      } catch {
        /* IndexedDB 不可用时静默 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (a: AlarmRecord) => {
    const next = { ...a, enabled: !a.enabled };
    setAlarms((prev) => (prev ? prev.map((x) => (x.id === a.id ? next : x)) : prev));
    void localDB.put('alarms', next);
  };

  const save = (rec: AlarmRecord) => {
    setAlarms((prev) => sortAlarms([...(prev ?? []).filter((x) => x.id !== rec.id), rec]));
    void localDB.put('alarms', rec);
    setEditor(null);
  };

  const remove = (id: string) => {
    setAlarms((prev) => prev?.filter((x) => x.id !== id) ?? prev);
    void localDB.delete('alarms', id);
    setEditor(null);
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="thin-scrollbar flex-1 overflow-y-auto pb-16">
        {alarms === null ? (
          <div className="pt-16 text-center text-[14px] text-muted-foreground">正在加载闹钟…</div>
        ) : alarms.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-muted-foreground">
            <AlarmClock className="h-10 w-10" strokeWidth={1.2} />
            <div className="text-[15px]">暂无闹钟</div>
            <div className="text-[13px]">点击右上角 + 新建</div>
          </div>
        ) : (
          <div className="mx-4 mt-1 divide-y divide-border/40 overflow-hidden rounded-[16px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {alarms.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-[18px] pl-5 pr-4">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditor(a)}>
                  <div
                    className={`text-[44px] font-light leading-none tracking-tight tabular-nums ${
                      a.enabled ? '' : 'opacity-40'
                    }`}
                  >
                    {a.time}
                  </div>
                  <div
                    className={`mt-2 truncate text-[14px] leading-snug text-muted-foreground ${
                      a.enabled ? '' : 'opacity-40'
                    }`}
                  >
                    {[a.label, repeatText(a.repeat)].filter(Boolean).join('，') || '闹钟'}
                  </div>
                </button>
                <Switch checked={a.enabled} onCheckedChange={() => toggle(a)} aria-label={`开关闹钟 ${a.time}`} />
              </div>
            ))}
          </div>
        )}
      </div>
      {editor !== null && (
        <AlarmEditorSheet
          key={editor === 'new' ? 'new' : editor.id}
          initial={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}

// ================= 秒表（模块级引擎，切 tab 不停表） =================

interface StopwatchState {
  elapsed: number;
  running: boolean;
  laps: number[];
}

const useStopwatch = create<StopwatchState>()(() => ({ elapsed: 0, running: false, laps: [] }));

const swEngine = { base: 0, iv: null as number | null };

function swStart(): void {
  if (swEngine.iv !== null) return;
  swEngine.base = performance.now() - useStopwatch.getState().elapsed;
  useStopwatch.setState({ running: true });
  swEngine.iv = window.setInterval(
    () => useStopwatch.setState({ elapsed: performance.now() - swEngine.base }),
    33
  );
}

function swStop(): void {
  if (swEngine.iv === null) return;
  window.clearInterval(swEngine.iv);
  swEngine.iv = null;
  useStopwatch.setState({ running: false, elapsed: performance.now() - swEngine.base });
}

function swLap(): void {
  useStopwatch.setState((s) => ({ laps: [...s.laps, performance.now() - swEngine.base] }));
}

function swReset(): void {
  if (swEngine.iv !== null) {
    window.clearInterval(swEngine.iv);
    swEngine.iv = null;
  }
  useStopwatch.setState({ elapsed: 0, running: false, laps: [] });
}

/** "MM:SS.cc" */
function fmtStopwatch(ms: number): string {
  const t = Math.max(0, ms);
  return `${pad2(Math.floor(t / 60000))}:${pad2(Math.floor(t / 1000) % 60)}.${pad2(Math.floor(t / 10) % 100)}`;
}

/** 秒表主段 "MM:SS"（百分秒单独小号渲染） */
function fmtStopwatchMain(ms: number): string {
  const t = Math.max(0, ms);
  return `${pad2(Math.floor(t / 60000))}:${pad2(Math.floor(t / 1000) % 60)}`;
}

/** 秒表百分秒两位 "cc" */
function swCents(ms: number): string {
  return pad2(Math.floor(Math.max(0, ms) / 10) % 100);
}

/** 表盘环：半径与周长（秒进度圈） */
const SW_RING_R = 88;
const SW_RING_C = 2 * Math.PI * SW_RING_R;

function StopwatchView() {
  const { elapsed, running, laps } = useStopwatch();

  const lapTimes = laps.map((t, i) => t - (i > 0 ? laps[i - 1] : 0));
  const fastest = lapTimes.length >= 2 ? Math.min(...lapTimes) : -1;
  const slowest = lapTimes.length >= 2 ? Math.max(...lapTimes) : -1;
  const rows = lapTimes.map((t, i) => ({ n: i + 1, lap: t, total: laps[i] })).reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col items-center px-6 pb-3 pt-4">
        {/* 秒进度表盘环（Apple Watch 同款）：一圈 = 60 秒，随百分秒平滑走动 */}
        <div className="relative flex h-[184px] w-[184px] items-center justify-center">
          <svg viewBox="0 0 184 184" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="92" cy="92" r={SW_RING_R} fill="none" strokeWidth={4} className="stroke-border" />
            <circle
              cx="92"
              cy="92"
              r={SW_RING_R}
              fill="none"
              strokeWidth={4}
              strokeLinecap="round"
              className="stroke-foreground/70 transition-[stroke-dashoffset] duration-100 ease-linear"
              strokeDasharray={SW_RING_C}
              strokeDashoffset={SW_RING_C * (1 - (elapsed % 60000) / 60000)}
            />
          </svg>
          {/* 秒表主数字：分:秒大号 + 百分秒小号基线对齐（iOS 同款） */}
          <div className="flex items-baseline">
            <span className="text-[44px] font-thin leading-none tabular-nums">{fmtStopwatchMain(elapsed)}</span>
            <span className="w-[40px] text-[22px] font-thin leading-none tabular-nums text-muted-foreground">
              .{swCents(elapsed)}
            </span>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between self-stretch px-4">
          <button
            onClick={running ? swLap : swReset}
            disabled={!running && elapsed === 0}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white/60 text-[17px] text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition duration-150 active:scale-[0.92] disabled:opacity-40 dark:bg-white/[0.08] dark:ring-white/[0.1]"
          >
            {running ? '计次' : '复位'}
          </button>
          <button
            onClick={running ? swStop : swStart}
            className={`flex h-20 w-20 items-center justify-center rounded-full text-[17px] shadow-sm backdrop-blur-xl transition duration-150 active:scale-[0.92] ${
              running
                ? 'bg-[#FF453A]/15 text-[#FF453A] ring-1 ring-[#FF453A]/35 dark:bg-[#FF453A]/25'
                : 'bg-[#30D158]/15 text-[#30D158] ring-1 ring-[#30D158]/35 dark:bg-[#30D158]/25'
            }`}
          >
            {running ? '停止' : '启动'}
          </button>
        </div>
      </div>
      <div className="thin-scrollbar flex-1 overflow-y-auto px-4 pb-8">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-7 text-muted-foreground">
            <Timer className="h-6 w-6 opacity-50" aria-hidden="true" />
            <span className="text-[14px]">计次将显示在这里</span>
          </div>
        ) : (
          <div className="divide-y divide-border/40 overflow-hidden rounded-[16px] bg-white/60 shadow-[0_8px_28px_rgba(17,24,39,0.07)] ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]">
            {rows.map((r) => (
              <div key={r.n} className="flex min-h-[44px] items-center gap-2 px-4 py-2.5">
                <span className="w-12 shrink-0 text-[15px] text-muted-foreground">圈 {r.n}</span>
                {r.lap === fastest && (
                  <span className="rounded-full bg-[#30D158]/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[#30D158]">最快</span>
                )}
                {r.lap === slowest && (
                  <span className="rounded-full bg-[#FF453A]/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[#FF453A]">最慢</span>
                )}
                <span
                  className={`flex-1 text-right text-[17px] tabular-nums ${
                    r.lap === fastest ? 'text-[#30D158]' : r.lap === slowest ? 'text-[#FF453A]' : ''
                  }`}
                >
                  {fmtStopwatch(r.lap)}
                </span>
                <span className="w-24 shrink-0 text-right text-[15px] tabular-nums text-muted-foreground">
                  {fmtStopwatch(r.total)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ================= 计时器（模块级引擎，切 tab 不停表） =================

type TimerPhase = 'idle' | 'running' | 'paused' | 'done';

interface TimerState {
  phase: TimerPhase;
  /** 剩余毫秒 */
  remaining: number;
  total: number;
  pickH: number;
  pickM: number;
  pickS: number;
}

const useTimerStore = create<TimerState>()(() => ({
  phase: 'idle',
  remaining: 0,
  total: 0,
  pickH: 0,
  pickM: 5,
  pickS: 0,
}));

const timerEngine = { target: 0, iv: null as number | null };

const RING_R = 110;
const RING_C = 2 * Math.PI * RING_R;

function fmtHMS(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
}

function timerClearIv(): void {
  if (timerEngine.iv !== null) {
    window.clearInterval(timerEngine.iv);
    timerEngine.iv = null;
  }
}

function timerTick(): void {
  const rem = timerEngine.target - Date.now();
  if (rem <= 0) {
    timerFinish();
    return;
  }
  useTimerStore.setState({ remaining: rem });
}

function timerFinish(): void {
  timerClearIv();
  useTimerStore.setState({ phase: 'done', remaining: 0 });
  playTripleBeep();
  try {
    navigator.vibrate?.([400, 200, 400]);
  } catch {
    /* 震动不可用 */
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('计时结束', { body: '设定的时间已到' });
    }
  } catch {
    /* 通知不可用 */
  }
}

function timerStart(): void {
  const { pickH, pickM, pickS } = useTimerStore.getState();
  const total = ((pickH * 60 + pickM) * 60 + pickS) * 1000;
  if (total <= 0) return;
  timerClearIv();
  timerEngine.target = Date.now() + total;
  useTimerStore.setState({ phase: 'running', remaining: total, total });
  timerEngine.iv = window.setInterval(timerTick, 200);
}

function timerPause(): void {
  if (useTimerStore.getState().phase !== 'running') return;
  timerClearIv();
  useTimerStore.setState({ phase: 'paused', remaining: Math.max(0, timerEngine.target - Date.now()) });
}

function timerResume(): void {
  const st = useTimerStore.getState();
  if (st.phase !== 'paused') return;
  timerClearIv();
  timerEngine.target = Date.now() + st.remaining;
  useTimerStore.setState({ phase: 'running' });
  timerEngine.iv = window.setInterval(timerTick, 200);
}

function timerCancel(): void {
  timerClearIv();
  useTimerStore.setState({ phase: 'idle', remaining: 0, total: 0 });
}

function Stepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-[84px] flex-col items-center gap-2">
      <button
        aria-label={`加${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-10 w-full items-center justify-center rounded-[14px] bg-white/60 text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl transition-colors active:bg-white/80 dark:bg-white/[0.08] dark:ring-white/[0.1] dark:active:bg-white/[0.14]"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
      <div className="flex h-16 w-full items-center justify-center text-[44px] font-light tabular-nums">
        {pad2(value)}
      </div>
      <button
        aria-label={`减${label}`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-10 w-full items-center justify-center rounded-[14px] bg-white/60 text-muted-foreground ring-1 ring-white/70 backdrop-blur-xl transition-colors active:bg-white/80 dark:bg-white/[0.08] dark:ring-white/[0.1] dark:active:bg-white/[0.14]"
      >
        <ChevronDown className="h-5 w-5" />
      </button>
      <div className="text-[13px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TimerView() {
  const { phase, remaining, total, pickH, pickM, pickS } = useTimerStore();
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;

  return (
    <div className="relative flex h-full flex-col">
      {phase === 'idle' ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex items-start gap-5">
            <Stepper label="时" value={pickH} max={23} onChange={(v) => useTimerStore.setState({ pickH: v })} />
            <Stepper label="分" value={pickM} max={59} onChange={(v) => useTimerStore.setState({ pickM: v })} />
            <Stepper label="秒" value={pickS} max={59} onChange={(v) => useTimerStore.setState({ pickS: v })} />
          </div>
          <button
            onClick={timerStart}
            className="mt-12 flex h-20 w-20 items-center justify-center rounded-full bg-[#30D158]/15 text-[17px] text-[#30D158] ring-1 ring-[#30D158]/35 backdrop-blur-xl transition duration-150 active:scale-[0.92] dark:bg-[#30D158]/25"
          >
            启动
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="relative h-[244px] w-[244px]">
            <svg viewBox="0 0 244 244" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="122" cy="122" r={RING_R} fill="none" strokeWidth={8} className="stroke-muted" />
              <circle
                cx="122"
                cy="122"
                r={RING_R}
                fill="none"
                strokeWidth={8}
                strokeLinecap="round"
                className="stroke-foreground transition-[stroke-dashoffset] duration-200 ease-linear"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - frac)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[46px] font-thin leading-none tabular-nums">{fmtHMS(remaining)}</div>
              {phase === 'paused' && <div className="mt-2 text-[13px] text-muted-foreground">已暂停</div>}
            </div>
          </div>
          <div className="mt-12 flex w-full items-center justify-between px-12">
            <button
              onClick={phase === 'running' ? timerPause : timerResume}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white/60 text-[17px] text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition duration-150 active:scale-[0.92] dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              {phase === 'running' ? '暂停' : '继续'}
            </button>
            <button
              onClick={timerCancel}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white/60 text-[17px] text-[#FF453A] shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition duration-150 active:scale-[0.92] dark:bg-white/[0.08] dark:ring-white/[0.1]"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {/* 计时完成覆盖层已提升到 ClockApp 外壳级渲染（任意 tab 可见），见 ClockApp 内 timerDone 分支 */}
    </div>
  );
}

// ================= App 外壳 =================

/** 黑白灰单色 tab：激活态 text-foreground，未激活 text-muted-foreground */
const TABS = [
  { label: '世界时钟', icon: Globe },
  { label: '闹钟', icon: AlarmClock },
  { label: '秒表', icon: Timer },
  { label: '计时器', icon: Hourglass },
] as const;

function TabBar({ tab, onChange }: { tab: number; onChange: (t: number) => void }) {
  return (
    <nav
      aria-label="时钟分区"
      className="z-50 h-[80px] shrink-0 border-t border-white/70 bg-white/60 pb-[28px] shadow-[0_-4px_24px_rgba(17,24,39,0.06)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-black/50"
    >
      <div className="flex h-full items-stretch">
        {TABS.map((t, i) => {
          const active = i === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              onClick={() => onChange(i)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${
                active ? 'text-foreground' : 'text-muted-foreground active:opacity-60'
              }`}
            >
              <Icon className="h-6 w-6" fill={active ? 'currentColor' : 'none'} strokeWidth={active ? 1.5 : 1.8} />
              <span className="text-[11px] leading-none">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** 时钟 App：世界时钟 / 闹钟 / 秒表 / 计时器 */
export default function ClockApp() {
  const [tab, setTab] = useState(0);
  const [cityAddOpen, setCityAddOpen] = useState(false);
  const [alarmEditor, setAlarmEditor] = useState<AlarmRecord | 'new' | null>(null);
  // 计时完成覆盖层提升到 App 外壳级渲染（原在 TimerView 内，切 tab 即不可见）：
  // done 态存于模块级 useTimerStore，到点瞬间人在世界时钟/闹钟/秒表任一 tab 都能立即看到；
  // 提示音/震动/系统通知仍由模块级引擎 timerFinish 触发（既有铃声播放路径，引擎零改动）
  const timerDone = useTimerStore((s) => s.phase === 'done');

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <IOSNavBar
        title={TABS[tab].label}
        inline
        className="shrink-0"
        left={<BackToHome className="static!" />}
        right={
          tab === 0 || tab === 1 ? (
            <button
              aria-label={tab === 0 ? '添加城市' : '添加闹钟'}
              onClick={() => (tab === 0 ? setCityAddOpen(true) : setAlarmEditor('new'))}
              className="text-foreground transition-opacity active:opacity-50"
            >
              <Plus className="h-6 w-6" />
            </button>
          ) : undefined
        }
      />
      <div className="relative flex-1 overflow-hidden">
        {tab === 0 && <WorldClockView addOpen={cityAddOpen} onAddOpenChange={setCityAddOpen} />}
        {tab === 1 && <AlarmsView editor={alarmEditor} setEditor={setAlarmEditor} />}
        {tab === 2 && <StopwatchView />}
        {tab === 3 && <TimerView />}
      </div>
      <TabBar tab={tab} onChange={setTab} />
      {/* 计时完成全屏覆盖层：盖过导航栏/内容/TabBar（z-60 > TabBar z-50），样式沿用原 done 分支语言，
          点「好」timerCancel 复位；App 被退出时随窗口卸载（引擎与 done 态保留，重开即见） */}
      {timerDone && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-background/95 backdrop-blur-sm">
          <Bell className="h-14 w-14 text-[#FF9F0A]" strokeWidth={1.5} />
          <div className="text-[26px] font-semibold">计时完成</div>
          <button
            onClick={timerCancel}
            className="rounded-full bg-white/60 px-10 py-3 text-[17px] text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.96] dark:bg-white/[0.08] dark:ring-white/[0.1]"
          >
            好
          </button>
        </div>
      )}
    </div>
  );
}

// ================= 全局闹钟监听（PhoneShell 挂载） =================

/** 模块级防重集合：`${闹钟id}:${YYYY-MM-DD}` */
const firedKeys = new Set<string>();

/** #66: firedKeys 过期天数（按 key 末尾 YYYY-MM-DD 比较，7 天前的清理掉，避免长期内存增长） */
const firedKeyExpireDays = 7;

/** #66: 清理 firedKeys 中超过 firedKeyExpireDays 天的条目（key 格式 `${id}:${YYYY-MM-DD}`） */
function pruneFiredKeys(): void {
  const cutoff = new Date(Date.now() - firedKeyExpireDays * 24 * 60 * 60 * 1000);
  const cutoffStr = `${cutoff.getFullYear()}-${pad2(cutoff.getMonth() + 1)}-${pad2(cutoff.getDate())}`;
  for (const key of Array.from(firedKeys)) {
    const sep = key.lastIndexOf(':');
    if (sep < 0) continue;
    const ymd = key.slice(sep + 1);
    if (ymd < cutoffStr) firedKeys.delete(key);
  }
}

/** #67: 同分钟内多只闹钟排队续响（首只 beginRing，rest 压入此队列；stop/auto-stop 时 shift 续响） */
let pendingRingers: AlarmRecord[] = [];

/** 贪睡间隔：iOS 标准 9 分钟 */
const SNOOZE_MS = 9 * 60_000;
/** 响铃自动停止时长：iOS 真机响铃约 15 分钟后自动停铃，演示环境按 60 秒收敛（全屏覆盖层
 *  长时间占位扰人）。自动停按「未确认」处理——常规闹钟的防重键已在触发时写入 firedKeys，
 *  贪睡则出队即清理，均不会二次触发，仅停铃并收起响铃层 */
const RING_AUTO_STOP_MS = 60_000;

/** 稍后提醒队列（纯内存，不落盘）：点「稍后提醒」生成 now+9min 的一次性临时闹钟，
 *  不写入用户闹钟列表（IndexedDB alarms 零 schema 侵入、列表零污染），到点由 AlarmWatcher
 *  轮询触发、出队即清理（「标记 done」的最小实现）。页面刷新会丢失未到点的贪睡——演示环境可接受 */
const snoozeQueue: { at: number; alarm: AlarmRecord }[] = [];

function RingOverlay({
  alarm,
  onStop,
  onSnooze,
}: {
  alarm: AlarmRecord;
  onStop: () => void;
  onSnooze: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(iv);
  }, []);
  return (
    <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-background text-foreground dark:bg-black/95 dark:text-white">
      <Bell className="h-20 w-20 animate-pulse text-[#FF9F0A]" strokeWidth={1.5} />
      <div className="text-5xl font-thin tabular-nums">
        {`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`}
      </div>
      <div className="text-lg text-foreground/85 dark:text-white/85">{alarm.label || '闹钟'}</div>
      <div className="text-[15px] text-muted-foreground dark:text-white/50">{alarm.time}</div>
      {/* iOS 同款双按钮并排：「稍后提醒」次按钮（+9 分钟再响），「停止」主按钮（填充色更重） */}
      <div className="flex items-center gap-8">
        <button
          onClick={onSnooze}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-white/60 text-[17px] text-foreground shadow-sm ring-1 ring-white/70 backdrop-blur-xl transition active:scale-[0.95] dark:bg-white/[0.08] dark:ring-white/[0.1]"
        >
          稍后提醒
        </button>
        <button
          onClick={onStop}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-foreground text-[17px] font-medium text-background transition active:scale-[0.95]"
        >
          停止
        </button>
      </div>
    </div>
  );
}

/** 全局闹钟监听：每 5 秒轮询 IndexedDB，命中即全屏响铃（App 未打开也能触发）；
 *  稍后提醒队列（内存）同轮询检查。响铃持续 60s 无人确认则自动停铃收层（不重复响） */
export function AlarmWatcher() {
  const [ringing, setRinging] = useState<AlarmRecord | null>(null);
  const teardownRef = useRef<() => void>(() => undefined);
  /** 当前响铃态的同步镜像：供 5s 轮询闭包读取（响铃中不叠加触发新的响铃，防双响/音频循环泄漏） */
  const ringingRef = useRef<AlarmRecord | null>(null);
  /** #67: 暴露 beginRing 给 stop()/auto-stop，stop 时若 pendingRingers 非空则 shift 续响下一只 */
  const beginRingRef = useRef<((a: AlarmRecord) => void) | null>(null);

  useEffect(() => {
    let beepIv: number | null = null;
    let vibIv: number | null = null;
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let flip = false;

    const teardown = () => {
      if (beepIv !== null) {
        window.clearInterval(beepIv);
        beepIv = null;
      }
      if (vibIv !== null) {
        window.clearInterval(vibIv);
        vibIv = null;
      }
      if (osc) {
        try {
          osc.stop();
        } catch {
          /* 已停止 */
        }
        osc = null;
      }
      if (gain) {
        try {
          gain.disconnect();
        } catch {
          /* 已断开 */
        }
        gain = null;
      }
      if (ctx) {
        void ctx.close().catch(() => undefined);
        ctx = null;
      }
      try {
        navigator.vibrate?.(0);
      } catch {
        /* 震动不可用 */
      }
    };

    const beginRing = (alarm: AlarmRecord) => {
      ringingRef.current = alarm; // 轮询闭包可读的响铃态镜像（stop 时清空）
      setRinging(alarm);
      // 蜂鸣循环：880/660Hz 交替
      try {
        ctx = createAudioContext();
        if (ctx) {
          void ctx.resume().catch(() => undefined);
          gain = ctx.createGain();
          gain.gain.value = 0.06;
          gain.connect(ctx.destination);
          osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 880;
          osc.connect(gain);
          osc.start();
          beepIv = window.setInterval(() => {
            flip = !flip;
            if (osc) osc.frequency.value = flip ? 660 : 880;
          }, 400);
        }
      } catch {
        /* 音频不可用时静默 */
      }
      // 震动循环
      try {
        if ('vibrate' in navigator) {
          navigator.vibrate([500, 300]);
          vibIv = window.setInterval(() => navigator.vibrate([500, 300]), 900);
        }
      } catch {
        /* 震动不可用时静默 */
      }
      // 系统通知
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`闹钟 · ${alarm.label || '闹钟'}`, { body: alarm.time });
        }
      } catch {
        /* 通知不可用时静默 */
      }
    };
    beginRingRef.current = beginRing;

    const check = async () => {
      // 稍后提醒（内存队列）优先：到点即响、出队即清理（响铃后自动删除，不会二次触发）；
      // 响铃中不叠加；本轮触发过贪睡则直接返回，常规闹钟留待下一轮 5s 轮询（防双响）
      const nowMs = Date.now();
      if (ringingRef.current === null) {
        const idx = snoozeQueue.findIndex((s) => nowMs >= s.at);
        if (idx >= 0) {
          const [s] = snoozeQueue.splice(idx, 1);
          beginRing(s.alarm);
          pruneFiredKeys();
          return;
        }
      }
      try {
        const alarms = await localDB.getAll('alarms');
        const now = new Date();
        const t = hhmm(now);
        const day = now.getDay();
        const tk = todayKey(now);
        if (ringingRef.current === null) {
          // #67: 收集同分钟内所有命中闹钟，首只 beginRing，rest 压入 pendingRingers 续响
          const matched: AlarmRecord[] = [];
          for (const a of alarms) {
            if (!a.enabled || a.time !== t) continue;
            // repeat 为空 = 仅一次（当日首次）；否则需包含今天
            if (a.repeat.length > 0 && !a.repeat.includes(day)) continue;
            const key = `${a.id}:${tk}`;
            if (firedKeys.has(key)) continue;
            firedKeys.add(key);
            // #20: 一次性闹钟（repeat 为空数组）触发后自动禁用，第二天不再响
            if (a.repeat.length === 0) {
              void localDB.put('alarms', { ...a, enabled: false });
            }
            matched.push(a);
          }
          if (matched.length > 0) {
            const [first, ...rest] = matched;
            pendingRingers = rest;
            beginRing(first);
          }
        }
      } catch {
        /* IndexedDB 不可用时静默 */
      }
      // #66: 每轮 check 末尾清理过期 firedKeys（7 天前）
      pruneFiredKeys();
    };

    const iv = window.setInterval(() => void check(), 5000);
    void check();
    teardownRef.current = teardown;

    return () => {
      window.clearInterval(iv);
      teardown();
    };
  }, []);

  const stop = useCallback(() => {
    teardownRef.current();
    ringingRef.current = null;
    // #67: 同分钟内多只闹钟，停掉当前后续响队列里下一只；队列空才收起覆盖层
    const nextAlarm = pendingRingers.shift();
    if (nextAlarm) {
      beginRingRef.current?.(nextAlarm);
      return;
    }
    setRinging(null);
  }, []);

  // 稍后提醒：生成「当前时间 +9 分钟」的一次性临时闹钟（内存 snoozeQueue，不进用户闹钟列表），
  // 随后与「停止」同一收尾路径停铃收层；到点由上方轮询触发、出队即清理，可连续贪睡
  const snooze = useCallback((alarm: AlarmRecord) => {
    const fireAt = new Date(Date.now() + SNOOZE_MS);
    snoozeQueue.push({
      at: fireAt.getTime(),
      alarm: {
        id: `snooze-${Date.now()}`,
        time: hhmm(fireAt),
        label: alarm.label ? `${alarm.label}（稍后提醒）` : '稍后提醒',
        enabled: true,
        repeat: [],
        createdAt: Date.now(),
      },
    });
    stop();
  }, [stop]);

  // 响铃自动停止（iOS 真机约 15 分钟自动停铃，演示环境按 60 秒收敛，见 RING_AUTO_STOP_MS）：
  // 「未确认」不重复响——防重键已在触发时登记（贪睡则出队即清理），仅停铃并收起全屏覆盖层；
  // ringing 被替换时定时器重挂，手动停止时随 ringing 置空自动清除
  useEffect(() => {
    if (!ringing) return;
    const t = window.setTimeout(stop, RING_AUTO_STOP_MS);
    return () => window.clearTimeout(t);
  }, [ringing, stop]);

  // 响铃弹层为全屏背景色覆盖层：同步到全局 store，状态栏/横杠前景随主题变色
  useEffect(() => {
    useUI.getState().setAlarmRinging(ringing !== null);
  }, [ringing]);

  return (
    <>
      {ringing && (
        <RingOverlay
          alarm={ringing}
          onStop={stop}
          onSnooze={() => {
            if (ringing) snooze(ringing);
          }}
        />
      )}
    </>
  );
}
