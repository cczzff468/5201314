'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronLeft,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Droplets,
  Gauge,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
// 注意：组件名以小写开头时 JSX 会当作 DOM 内置元素（TS 报 IntrinsicElements 错误），故别名为大写开头
import { IOSActionSheet } from '@/components/ios/ActionSheet';
import { localDB } from '@/lib/ios/db';
import { useUI } from '@/lib/ios/store';
import {
  FALLBACK_CITY,
  asCityPick,
  cityKeyOf,
  fetchWeather,
  publishWeatherSnap,
  readWeatherCache,
  resolveCityPick,
  searchCity,
  useWeatherSnapshot,
  weatherCodeInfo,
  type CityPick,
  type CitySearchResult,
  type WeatherData,
} from './weather-core';

// 轻量数据层对外再导出（锁屏等外部引用保持原路径兼容）
export { fetchWeather, searchCity, useWeatherSnapshot, weatherCodeInfo } from './weather-core';
export type { CitySearchResult, WeatherData } from './weather-core';

/**
 * 天气 App + 桌面天气小组件（iOS 15+ 原生天气风格：全屏蓝色渐变 + 白色文字 + 毛玻璃卡片）。
 * - 背景按天气状况 + 昼夜动态选择蓝色渐变（weatherGradient），浅色/深色模式均为蓝色系。
 * - 数据源：免费 Open-Meteo API（经本机 /api/weather 与 /api/weather/geocode 代理，无需 Key）。
 * - 天气 App 与小组件共用同一份 fetchWeather 数据源函数（模块级 Promise 缓存防止重复请求）。
 */

// 类型 / 天气码映射已拆至 ./weather-core（锁屏只需轻量数据层，避免千行 App UI 拖进首屏包）

// ==================== 背景渐变（天气状况 + 昼夜 → 蓝色系） ====================

type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'thunder';

function conditionOf(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code >= 1 && code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

const DAY_CLEAR = 'linear-gradient(180deg,#2E6FD8 0%,#5FA0EC 55%,#8FC3F4 100%)';
const NIGHT_CLEAR = 'linear-gradient(180deg,#0E1B3A 0%,#1D3060 55%,#3A5180 100%)';
const DAY_CLOUDY = 'linear-gradient(180deg,#3A70B8 0%,#6E9CCF 60%,#9FC2DE 100%)';
const NIGHT_CLOUDY = 'linear-gradient(180deg,#16233F 0%,#2C3F66 55%,#4C6288 100%)';

/** 天气状况 + 昼夜 → 全屏蓝色渐变 CSS（backgroundImage 值） */
export function weatherGradient(code: number, isNight: boolean): string {
  const cond = conditionOf(code);
  if (cond === 'clear') return isNight ? NIGHT_CLEAR : DAY_CLEAR;
  if (cond === 'cloudy') return isNight ? NIGHT_CLOUDY : DAY_CLOUDY;
  if (cond === 'rain') return 'linear-gradient(180deg,#2B4468 0%,#4A6890 55%,#7291B0 100%)';
  if (cond === 'snow') return 'linear-gradient(180deg,#5B7A96 0%,#8FA9C0 55%,#C3D3E2 100%)';
  if (cond === 'fog') return 'linear-gradient(180deg,#4A6484 0%,#7C93AC 60%,#A8B8C8 100%)';
  return 'linear-gradient(180deg,#1E2A45 0%,#37476E 55%,#5A6C96 100%)';
}

// 数据源（fetchWeather/searchCity）与 localStorage 缓存、城市解析已拆至 ./weather-core

// ==================== 格式化工具 ====================

function fmtTemp(t: number): string {
  return `${Math.round(t)}°`;
}

/** 每日预报行标签：第一项为"今天"，其余显示"周三"等 */
function weekdayLabel(dateStr: string, index: number): string {
  if (index === 0) return '今天';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(d);
}

/** ISO 本地时间（2024-05-01T05:12）→ HH:mm */
function fmtHourFromIso(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : '--:--';
}

const WIND_DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function windDirText(deg: number): string {
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return `${WIND_DIRS[idx] ?? '北'}风`;
}

/** 当前时刻是否为夜晚（sunrise~sunset 之外）。
 * 用天气数据中的城市本地当前时间（current.time）判断，
 * 避免浏览器时区与目标城市时区不一致（如查看异地城市）导致昼夜误判。 */
function isNightNow(data: WeatherData): boolean {
  const today = data.daily[0];
  const sunrise = today ? fmtHourFromIso(today.sunrise) : '';
  const sunset = today ? fmtHourFromIso(today.sunset) : '';
  if (!sunrise || !sunset || sunrise === '--:--' || sunset === '--:--') return false;
  const cur = fmtHourFromIso(data.current.time);
  if (!cur || cur === '--:--') return false;
  return cur < sunrise || cur > sunset;
}

// ==================== 桌面天气小组件 ====================

/**
 * 小型正方形天气小组件（152×152，主屏幕引用，点击行为由 HomeScreen 外层处理）。
 * 紧凑三行布局：上行 温度数字 + °C / 右 天气图标（晴黄色）；中行 天气名（单行省略，
 * 绝不逐字换行）；下行 今日温度范围 + 城市（半透明）。
 * 数据获取：① localStorage 缓存(<10min) ② 已选城市/定位 ③ 北京兜底。
 */
export function WeatherWidget() {
  // 用 useWeatherSnapshot 订阅模块级快照：天气 App 切换城市后 publishWeatherSnap 广播，
  // 本组件即时收到新城市天气（无需刷新网页）。挂载时若无快照，ensureWeatherLoaded 会后台拉取。
  const data = useWeatherSnapshot();
  const failed = data === null && (() => {
    // 失败判定：快照 null 且无任何缓存（含过期）时才算失败；有缓存则显示缓存
    return readWeatherCache(Number.POSITIVE_INFINITY) === null;
  })();
  // 兜底：快照 null 但有过期缓存时显示缓存（避免 widget 空白）
  const display = data ?? readWeatherCache(Number.POSITIVE_INFINITY);

  const isNight = display ? isNightNow(display) : false;
  const gradient = weatherGradient(display ? display.current.code : 0, isNight);
  const info = display ? weatherCodeInfo(display.current.code) : null;
  const today = display?.daily[0];
  const Icon = info?.Icon;

  return (
    <div
      className="mx-auto flex h-[152px] w-[152px] flex-col justify-between overflow-hidden rounded-[24px] p-3.5 text-white"
      style={{ backgroundImage: gradient }}
    >
      {/* #89：失败时显示明确"加载失败"占位（不再与缓存数据并存混淆） */}
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
          <CloudOff className="h-7 w-7 text-white/70" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[12px] font-medium leading-tight text-white/85">天气加载失败</span>
          <span className="text-[10px] leading-tight text-white/55">稍后自动重试</span>
        </div>
      ) : (
        <>
          {/* 上行：温度数字 + °C；右 天气图标（晴/局部多云显黄色） */}
          <div className="flex items-start justify-between">
            <span className="flex items-start gap-[2px]">
              <span className="text-[42px] font-semibold leading-[40px] tabular-nums">
                {display ? Math.round(display.current.temperature) : '--'}
              </span>
              <span className="text-[13px] font-medium leading-[14px]">°C</span>
            </span>
            {Icon ? (
              <Icon
                className={`h-[32px] w-[32px] shrink-0 ${display && display.current.code <= 2 ? 'text-[#F7D24B]' : ''}`}
                strokeWidth={1.6}
                aria-hidden="true"
              />
            ) : (
              <Cloud className="h-[32px] w-[32px] shrink-0 text-white/50" strokeWidth={1.6} aria-hidden="true" />
            )}
          </div>
          {/* 中行：天气名（单行省略，禁止逐字竖排换行） */}
          <span className="truncate text-[13px] font-medium leading-none text-white/90">
            {info ? info.label : '…'}
          </span>
          {/* 下行：今日温度范围 + 城市（半透明） */}
          <div className="flex items-end justify-between gap-1">
            <span className="text-[12px] leading-none tabular-nums">
              {today ? `${Math.round(today.min)}~${Math.round(today.max)}°` : '--~--°'}
            </span>
            <span className="shrink-0 truncate text-[12px] leading-none text-white/55">
              {display ? display.name || '当前位置' : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ==================== 天气 App ====================

function DetailCard({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[20px] bg-white/[0.10] p-3.5 ring-1 ring-white/[0.14] backdrop-blur-2xl">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-white/60">
        <Icon className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-light leading-tight">{value}</div>
      {sub && <div className="mt-1 text-[12px] leading-snug text-white/60">{sub}</div>}
    </div>
  );
}

/** 城市搜索覆盖层：防抖 400ms 搜索，点击结果切换城市并持久化（深色毛玻璃适配蓝色渐变底） */
function CitySearchPanel({ onClose, onPick }: { onClose: () => void; onPick: (pick: CityPick) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const timer = window.setTimeout(() => {
      if (!q) {
        setResults([]);
        setSearching(false);
        setMessage('');
        return;
      }
      const seq = ++seqRef.current;
      setSearching(true);
      searchCity(q)
        .then((list) => {
          if (seqRef.current !== seq) return;
          setResults(list);
          setMessage(list.length ? '' : '未找到相关城市');
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setResults([]);
          setMessage('搜索服务暂不可用，请稍后重试');
        })
        .finally(() => {
          if (seqRef.current !== seq) return;
          setSearching(false);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div role="dialog" aria-label="搜索城市" className="absolute inset-0 z-30 flex flex-col bg-black/40 backdrop-blur-2xl">
      {/* 搜索框 + 关闭 */}
      <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-[64px]">
        <div className="flex flex-1 items-center gap-2 rounded-[14px] bg-white/[0.10] px-3 py-2 ring-1 ring-white/[0.14] backdrop-blur-xl">
          <Search className="h-4 w-4 shrink-0 text-white/60" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索城市，如：北京 / Tokyo"
            aria-label="城市名称"
            autoFocus
            className="w-full bg-transparent text-[16px] text-white outline-none placeholder:text-white/45"
          />
        </div>
        <button onClick={onClose} className="p-2 text-white/80 transition-opacity active:opacity-50" aria-label="关闭搜索">
          <X className="h-5 w-5" />
        </button>
      </div>
      {/* 结果列表 */}
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-10">
        {searching && <p className="py-6 text-center text-[14px] text-white/60">搜索中…</p>}
        {!searching && message && <p className="py-6 text-center text-[14px] text-white/55">{message}</p>}
        {!searching &&
          results.map((r, i) => (
            <button
              key={`${r.latitude},${r.longitude},${i}`}
              onClick={() => onPick({ lat: r.latitude, lon: r.longitude, name: r.name, admin1: r.admin1 || undefined, admin2: r.admin2 || undefined, admin3: r.admin3 || undefined })}
              className="w-full rounded-[12px] px-3 py-2.5 text-left transition-colors active:bg-white/10"
            >
              <span className="block text-[16px] text-white">{r.name}</span>
              <span className="mt-0.5 block text-[12px] text-white/55">
                {[r.admin1, r.admin2, r.admin3].filter(Boolean).join(' · ') || r.country || '—'} · {r.latitude.toFixed(2)}°, {r.longitude.toFixed(2)}°
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

// ==================== 城市管理页 ====================

/**
 * 长按手势 hook（500ms 触发）：
 * - pointer 事件实现，移动超过 10px 或抬起/取消即中止计时；
 * - onContextMenu 拦截，防止移动端长按弹出系统菜单；
 * - 触发过长按后，紧随其后的 click 由 consumeFired() 吞掉，避免误触选城。
 */
function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载时清理未触发的计时器
  useEffect(() => cancelTimer, [cancelTimer]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      cancelTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onLongPress();
      }, 500);
      // 捕获指针：保证后续 move/up 事件始终送达当前元素
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 部分指针类型不支持捕获，忽略 */
      }
    },
    [onLongPress, cancelTimer]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (timerRef.current === null) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.hypot(dx, dy) > 10) cancelTimer();
    },
    [cancelTimer]
  );

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  /** 是否刚触发过长按（供 onClick 吞掉误触，读取后复位） */
  const consumeFired = useCallback(() => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancelTimer,
    onPointerCancel: cancelTimer,
    onContextMenu,
    consumeFired,
  };
}

/** 管理页城市卡片：天气渐变背景 + 左列城市名/概况 + 右列大温度（未加载时 bg-muted 占位）；长按弹出删除动作表 */
function ManagerCityCard({
  pick,
  data,
  onPick,
  onLongPress,
}: {
  pick: CityPick;
  data: WeatherData | undefined;
  onPick: (pick: CityPick) => void;
  onLongPress: (pick: CityPick) => void;
}) {
  const lp = useLongPress(() => onLongPress(pick));
  const gradient = data ? weatherGradient(data.current.code, isNightNow(data)) : '';
  const info = data ? weatherCodeInfo(data.current.code) : null;
  const today = data?.daily[0];

  return (
    <button
      type="button"
      onPointerDown={lp.onPointerDown}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
      onContextMenu={lp.onContextMenu}
      onClick={() => {
        if (lp.consumeFired()) return; // 长按触发过，吞掉本次 click
        onPick(pick);
      }}
      aria-label={`选择城市 ${pick.name}`}
      className={`relative flex min-h-[104px] select-none items-center justify-between overflow-hidden rounded-[24px] px-6 py-6 text-left shadow-md transition-colors [-webkit-touch-callout:none] ${
        data
          ? 'text-white ring-1 ring-white/25'
          : 'bg-white/60 text-foreground ring-1 ring-white/70 backdrop-blur-2xl dark:bg-white/[0.06] dark:ring-white/[0.09]'
      }`}
      style={data ? { backgroundImage: gradient } : undefined}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[24px] font-bold leading-tight">{pick.name}</span>
        <span className="mt-1.5 flex items-center gap-2 text-[13px] leading-none tabular-nums opacity-90">
          <span>{info ? info.label : '--'}</span>
          <span>{info && today ? `${Math.round(today.min)} ~ ${Math.round(today.max)}℃` : '-- ~ --℃'}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-start">
        <span className="text-[46px] font-light leading-none tracking-tight tabular-nums">
          {data ? Math.round(data.current.temperature) : '--'}
        </span>
        <span className="ml-0.5 mt-[3px] text-[15px] leading-none">℃</span>
      </span>
    </button>
  );
}

/**
 * 城市管理页（按用户截图：浅色页面 + 返回/标题/加号导航 + 圆角搜索胶囊 + 大圆角天气卡片流）。
 * - 城市列表持久化于 IndexedDB settings store（key='weatherCities'），首次为空时用北京播种写回；
 * - 打开时并行拉取每个城市天气（不阻塞渲染，先显示占位温度，单城落定即更新，allSettled 语义）；
 * - 点卡片选中该城市回主页；长按 500ms 弹出 iOS 底部动作表（删除城市，无需确认）。
 */
function CityManagerPage({
  current,
  onClose,
  onPick,
  onSwitchCurrent,
}: {
  current: CityPick | null;
  onClose: () => void;
  onPick: (pick: CityPick) => void;
  onSwitchCurrent: (pick: CityPick) => void;
}) {
  const [cities, setCities] = useState<CityPick[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** 长按中的城市（弹出删除动作表） */
  const [sheetCity, setSheetCity] = useState<CityPick | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [wxMap, setWxMap] = useState<Record<string, WeatherData>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  const persistCities = useCallback((list: CityPick[]) => {
    void localDB.put('settings', { key: 'weatherCities', value: list }).catch(() => undefined);
  }, []);

  /** 并行拉取城市天气：单城落定即更新（失败保持占位），allSettled 收口不阻塞 UI */
  const loadWeathers = useCallback((list: CityPick[]) => {
    const promises = list.map((c) =>
      fetchWeather(c.lat, c.lon, c.name)
        .then((d) => {
          if (!mountedRef.current) return;
          setWxMap((prev) => ({ ...prev, [cityKeyOf(c)]: d }));
        })
        .catch(() => {
          /* 拉取失败：保持占位温度 */
        })
    );
    void Promise.allSettled(promises);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 首次挂载：读 IndexedDB 城市列表；为空则用北京播种并写回；随后并行拉取天气
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list: CityPick[] = [];
      try {
        const rec = await localDB.get('settings', 'weatherCities');
        const raw: unknown = rec?.value;
        if (Array.isArray(raw)) {
          for (const item of raw as unknown[]) {
            const c = asCityPick(item);
            if (c) list.push(c);
          }
        }
      } catch {
        /* IndexedDB 不可用时使用默认城市 */
      }
      let seeded = false;
      if (list.length === 0) {
        list = [FALLBACK_CITY];
        seeded = true;
      }
      if (cancelled) return;
      setCities(list);
      setLoaded(true);
      if (seeded) persistCities(list);
      loadWeathers(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWeathers, persistCities]);

  // 搜索防抖 400ms
  useEffect(() => {
    const q = query.trim();
    const timer = window.setTimeout(() => {
      if (!q) {
        setResults([]);
        setSearching(false);
        setMessage('');
        return;
      }
      const seq = ++seqRef.current;
      setSearching(true);
      searchCity(q)
        .then((list) => {
          if (seqRef.current !== seq) return;
          setResults(list);
          setMessage(list.length ? '' : '未找到相关城市');
        })
        .catch(() => {
          if (seqRef.current !== seq) return;
          setResults([]);
          setMessage('搜索服务暂不可用，请稍后重试');
        })
        .finally(() => {
          if (seqRef.current !== seq) return;
          setSearching(false);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  /** 把搜索结果加入列表（按经纬度两位小数去重），并清空搜索框与结果 */
  const addCity = (r: CitySearchResult) => {
    const pick: CityPick = { lat: r.latitude, lon: r.longitude, name: r.name, admin1: r.admin1 || undefined, admin2: r.admin2 || undefined, admin3: r.admin3 || undefined };
    const key = cityKeyOf(pick);
    if (!cities.some((c) => cityKeyOf(c) === key)) {
      const next = [...cities, pick];
      setCities(next);
      persistCities(next);
      loadWeathers([pick]);
    }
    setQuery('');
    setResults([]);
    setSearching(false);
    setMessage('');
  };

  /** 删除城市（无需确认）；若删的是当前选中城市，自动切为列表第一个 */
  const removeCity = (index: number) => {
    const target = cities[index];
    if (!target) return;
    const next = cities.filter((_, i) => i !== index);
    setCities(next);
    persistCities(next);
    if (current && cityKeyOf(current) === cityKeyOf(target)) {
      const first = next[0];
      if (first) onSwitchCurrent(first);
    }
  };

  const emptyState = loaded && cities.length === 0 && !searching && results.length === 0 && query.trim() === '';

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-background text-foreground [text-shadow:none]">
      {/* 顶部导航：返回 + 标题 | 添加 */}
      <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-[54px]">
        <div className="flex items-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="返回天气"
            className="flex h-11 w-11 items-center justify-center transition-opacity active:opacity-50"
          >
            <ChevronLeft className="h-[24px] w-[24px]" strokeWidth={2.4} />
          </button>
          <h1 className="-ml-0.5 text-[24px] font-bold leading-none">城市管理</h1>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => searchInputRef.current?.focus()}
            aria-label="添加城市"
            className="flex h-11 w-11 items-center justify-center transition-opacity active:opacity-50"
          >
            <Plus className="h-[22px] w-[22px]" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* 毛玻璃胶囊搜索框 */}
      <div className="shrink-0 px-4 pb-2">
        <div className="flex h-10 items-center gap-2 rounded-full bg-white/60 px-3.5 ring-1 ring-white/70 backdrop-blur-xl dark:bg-white/[0.08] dark:ring-white/[0.1]">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索城市或景区"
            aria-label="搜索城市或景区"
            className="w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* 主体：搜索结果（位于卡片上方）+ 城市卡片流 */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col px-4 pb-8">
          {searching && <p className="py-4 text-center text-[13px] text-muted-foreground">搜索中…</p>}
          {!searching && message && <p className="py-4 text-center text-[13px] text-muted-foreground">{message}</p>}
          {!searching &&
            results.map((r, i) => (
              <button
                key={`${r.latitude},${r.longitude},${i}`}
                type="button"
                onClick={() => addCity(r)}
                className="w-full rounded-[12px] px-2 py-2.5 text-left transition-colors active:bg-muted"
              >
                <span className="block text-[16px] leading-tight text-foreground">{r.name}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {[r.admin1, r.admin2, r.admin3].filter(Boolean).join(' · ') || r.country || '—'}
                </span>
              </button>
            ))}

          {emptyState ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[14px] text-muted-foreground">暂无城市，点击右上角 + 添加</p>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {cities.map((c) => (
                <ManagerCityCard
                  key={cityKeyOf(c)}
                  pick={c}
                  data={wxMap[cityKeyOf(c)]}
                  onPick={onPick}
                  onLongPress={setSheetCity}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 长按城市卡的 iOS 动作表：删除（无需确认；按 cityKeyOf 找索引，避免闭包 index 失效） */}
      <IOSActionSheet
        open={sheetCity !== null}
        actions={
          sheetCity
            ? [
                {
                  label: '删除',
                  destructive: true,
                  onSelect: () => {
                    const idx = cities.findIndex((x) => cityKeyOf(x) === cityKeyOf(sheetCity));
                    if (idx >= 0) removeCity(idx);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSheetCity(null)}
      />
    </div>
  );
}

/**
 * 天气 App：全屏沉浸式蓝色渐变（按天气 + 昼夜动态选择，不随主题反转），文字永远白色。
 * 含当前天气 hero（96px 大温度）、24 小时横向预报、7 天预报（暖色区间条）、详情网格、
 * 搜索与刷新、左上角返回主屏幕 + 城市管理入口。
 */
export default function WeatherApp() {
  const closeApp = useUI((s) => s.closeApp);
  const [city, setCity] = useState<CityPick | null>(null);
  const [data, setData] = useState<WeatherData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async (pick: CityPick, force = false) => {
    const req = ++reqRef.current;
    setStatus('loading');
    try {
      const fresh = await fetchWeather(pick.lat, pick.lon, pick.name, force);
      if (reqRef.current !== req) return;
      // 用 publishWeatherSnap 统一写缓存+更新快照+广播，小组件即时收到新城市天气（无需刷新网页）
      publishWeatherSnap(fresh);
      setData(fresh);
      setStatus('ready');
    } catch (e) {
      if (reqRef.current !== req) return;
      setErrorMsg(e instanceof Error ? e.message : '天气加载失败');
      setStatus('error');
    }
  }, []);

  // 首次挂载：恢复上次选择的城市，无记录则定位 / 北京兜底
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pick = await resolveCityPick();
      if (cancelled) return;
      setCity(pick);
      await load(pick);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // #32：可见时每 10 分钟自动刷新一次（卸载或隐藏时清理；不可见时不发请求避免浪费）
  useEffect(() => {
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          const pick = city ?? FALLBACK_CITY;
          void load(pick).catch(() => undefined);
        }
      }, 10 * 60 * 1000);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') start();
      else if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [city, load]);

  const refresh = useCallback(() => {
    const pick = city ?? FALLBACK_CITY;
    setRefreshing(true);
    void load(pick, true).finally(() => setRefreshing(false));
  }, [city, load]);

  /** 统一的城市切换：写 IndexedDB + 拉取天气（不关闭任何浮层，供管理页删除兜底复用） */
  const switchCity = useCallback(
    (pick: CityPick) => {
      setCity(pick);
      void localDB
        .put('settings', { key: 'weatherCity', value: pick })
        .catch(() => undefined);
      void load(pick);
    },
    [load]
  );

  const pickCity = useCallback(
    (pick: CityPick) => {
      setSearchOpen(false);
      setManagerOpen(false);
      switchCity(pick);
    },
    [switchCity]
  );

  const isNight = data ? isNightNow(data) : false;
  const gradient = weatherGradient(data ? data.current.code : 0, isNight);
  const info = data ? weatherCodeInfo(data.current.code) : null;
  const today = data?.daily[0];
  const weekMin = data && data.daily.length ? Math.min(...data.daily.map((d) => d.min)) : 0;
  const weekMax = data && data.daily.length ? Math.max(...data.daily.map((d) => d.max)) : 1;
  const weekRange = Math.max(weekMax - weekMin, 1);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden text-white [text-shadow:0_1px_12px_rgba(23,49,89,0.22)]"
      style={{ backgroundImage: gradient }}
    >
      <main className="no-scrollbar flex-1 overflow-y-auto" aria-label="天气内容">
        <div className="px-5 pb-[40px] pt-[64px]">
          {/* 顶部城市栏：居中城市名 + 右上角搜索/刷新（用户需求：城市名下方不再显示省/市/县层级副标题） */}
          <header className="relative flex h-[48px] flex-col items-center justify-center">
            <h1 className="max-w-[190px] truncate text-[34px] font-normal leading-none">{city ? city.name : '天气'}</h1>
            {/* 左侧：返回主屏幕（底部横杠点击关闭已禁用，根界面需显式返回键）+ 城市管理入口 */}
            <div className="absolute inset-y-0 left-[-10px] flex items-center">
              <button
                onClick={closeApp}
                className="flex h-11 w-11 items-center justify-center transition-opacity active:opacity-50"
                aria-label="返回主屏幕"
              >
                <ChevronLeft className="h-[21px] w-[21px]" strokeWidth={2.2} />
              </button>
              <button
                onClick={() => setManagerOpen(true)}
                className="flex h-11 w-11 items-center justify-center transition-opacity active:opacity-50"
                aria-label="城市管理"
              >
                <Plus className="h-[21px] w-[21px]" strokeWidth={2.2} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-[-10px] flex items-center">
              <button onClick={() => setSearchOpen(true)} className="p-2.5 transition-opacity active:opacity-50" aria-label="搜索城市">
                <Search className="h-[21px] w-[21px]" strokeWidth={2.2} />
              </button>
              <button onClick={refresh} className="p-2.5 transition-opacity active:opacity-50" aria-label="刷新天气">
                <RefreshCw className={`h-[21px] w-[21px] ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2.2} />
              </button>
            </div>
          </header>

          {status === 'error' ? (
            /* 错误卡片 + 重试 */
            <div className="mt-16 flex flex-col items-center gap-4 rounded-[20px] bg-white/[0.10] p-8 text-center ring-1 ring-white/[0.14] backdrop-blur-2xl">
              <CloudOff className="h-10 w-10 text-white/70" aria-hidden="true" />
              <p className="text-[15px] text-white/85">{errorMsg || '天气加载失败'}</p>
              <button
                onClick={refresh}
                className="rounded-full bg-white/[0.10] px-5 py-2 text-[14px] shadow-sm ring-1 ring-white/[0.14] backdrop-blur-xl transition-colors active:bg-white/20"
              >
                重试
              </button>
            </div>
          ) : !data ? (
            /* 加载骨架 */
            <div className="flex flex-col items-center gap-4 pt-16" aria-label="加载中">
              <div className="h-14 w-14 animate-pulse rounded-full bg-white/15" />
              <p className="text-[15px] text-white/70">加载中…</p>
            </div>
          ) : (
            <>
              {/* 当前天气 hero：96px 大温度 + 天气描述 + 最高/最低 */}
              <section className="flex flex-col items-center pb-8 pt-7 text-center" aria-label="当前天气">
                <div className="text-[96px] font-thin leading-none tracking-[-0.02em] tabular-nums">
                  {fmtTemp(data.current.temperature)}
                </div>
                <div className="mt-3 text-[19px] text-white/90">{info?.label ?? '—'}</div>
                <div className="mt-1 text-[17px] text-white/80 tabular-nums">
                  最高 {fmtTemp(today ? today.max : data.current.temperature)} 最低{' '}
                  {fmtTemp(today ? today.min : data.current.temperature)}
                </div>
              </section>

              {/* 24 小时预报（横向滚动） */}
              <section aria-label="24小时预报" className="rounded-[20px] bg-white/[0.10] p-4 ring-1 ring-white/[0.14] backdrop-blur-2xl">
                <div className="no-scrollbar flex gap-[18px] overflow-x-auto">
                  {data.hourly.map((h, i) => {
                    const HourIcon = weatherCodeInfo(h.code).Icon;
                    return (
                      <div key={`${h.time}-${i}`} className="flex w-[44px] shrink-0 flex-col items-center gap-2.5">
                        <span className="whitespace-nowrap text-[13px] font-medium leading-none text-white/85">
                          {i === 0 ? '现在' : h.time}
                        </span>
                        <HourIcon className="h-[22px] w-[22px]" strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-[17px] font-medium leading-none tabular-nums">{fmtTemp(h.temp)}</span>
                        <span className="text-[11px] leading-none text-[#8ED0FF] tabular-nums">{h.pop > 0 ? `${h.pop}%` : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 7 天预报（今天加粗 + 暖色温度区间条） */}
              <section aria-label="7天预报" className="mt-3 rounded-[20px] bg-white/[0.10] px-4 ring-1 ring-white/[0.14] backdrop-blur-2xl">
                <ul className="divide-y divide-white/10">
                  {data.daily.map((d, i) => {
                    const DayIcon = weatherCodeInfo(d.code).Icon;
                    const left = ((d.min - weekMin) / weekRange) * 100;
                    const width = Math.max(((d.max - d.min) / weekRange) * 100, 8);
                    return (
                      <li key={`${d.date}-${i}`} className="flex items-center gap-3 py-[11px]">
                        <span className={`w-[44px] shrink-0 text-[17px] ${i === 0 ? 'font-semibold' : 'font-normal'}`}>
                          {weekdayLabel(d.date, i)}
                        </span>
                        <DayIcon className="h-[22px] w-[22px] shrink-0 text-white/95" strokeWidth={1.6} aria-hidden="true" />
                        <span className="w-[36px] shrink-0 text-right text-[17px] text-white/60 tabular-nums">{fmtTemp(d.min)}</span>
                        <span
                          className="relative mx-1 h-[4px] min-w-[56px] flex-1 overflow-hidden rounded-full bg-white/20"
                          aria-hidden="true"
                        >
                          <span
                            className="absolute inset-y-0 rounded-full bg-gradient-to-r from-yellow-300 to-orange-400"
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        </span>
                        <span className="w-[36px] shrink-0 text-[17px] tabular-nums">{fmtTemp(d.max)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* 详情卡片网格 */}
              <section aria-label="天气详情" className="mt-3 grid grid-cols-2 gap-3">
                <DetailCard icon={Thermometer} label="体感温度" value={fmtTemp(data.current.apparent)} />
                <DetailCard icon={Droplets} label="湿度" value={`${Math.round(data.current.humidity)}%`} />
                <DetailCard
                  icon={Wind}
                  label="风速"
                  value={`${Math.round(data.current.windSpeed)} 公里/时`}
                  sub={windDirText(data.current.windDirection)}
                />
                <DetailCard icon={Gauge} label="气压" value={`${Math.round(data.current.pressure)} hPa`} />
                <DetailCard icon={Sunrise} label="日出" value={fmtHourFromIso(today ? today.sunrise : '')} />
                <DetailCard icon={Sunset} label="日落" value={fmtHourFromIso(today ? today.sunset : '')} />
              </section>
            </>
          )}
        </div>
      </main>

      {/* 城市搜索覆盖层 */}
      {searchOpen && <CitySearchPanel onClose={() => setSearchOpen(false)} onPick={pickCity} />}

      {/* 城市管理覆盖层（浅色 token 页面） */}
      {managerOpen && (
        <CityManagerPage
          current={city}
          onClose={() => setManagerOpen(false)}
          onPick={pickCity}
          onSwitchCurrent={switchCity}
        />
      )}
    </div>
  );
}
