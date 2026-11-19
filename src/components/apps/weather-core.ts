'use client';

import { useSyncExternalStore } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { localDB } from '@/lib/ios/db';

/**
 * 天气数据层（轻量模块）：类型 / 天气码映射 / 请求与缓存 / 快照 Hook。
 * 从 weather.tsx 拆出的原因：锁屏小组件只需要这一小部分，
 * 若直接引 weather.tsx 会把整个天气 App UI（千行级）拖进首屏包。
 * 天气 App 与桌面小组件（weather.tsx）也从本模块导入同一份数据源。
 */

// ==================== 类型 ====================

export interface WeatherData {
  name: string;
  current: {
    time: string;
    temperature: number;
    apparent: number;
    humidity: number;
    code: number;
    windSpeed: number;
    windDirection: number;
    pressure: number;
  };
  hourly: { time: string; temp: number; code: number; pop: number }[];
  daily: { date: string; code: number; max: number; min: number; sunrise: string; sunset: string }[];
}

export interface CitySearchResult {
  name: string;
  country: string;
  admin1: string;
  /** 地级市/州/盟（open-meteo admin2） */
  admin2?: string;
  /** 县/区/县级市（open-meteo admin3） */
  admin3?: string;
  latitude: number;
  longitude: number;
}

export interface CityPick {
  lat: number;
  lon: number;
  /** 显示名（城市/县城名，定位后经 reverse geocode 反查，不再显示「当前位置」） */
  name: string;
  /** 省/直辖市（可选，搜索结果携带） */
  admin1?: string;
  /** 地级市/州/盟（可选） */
  admin2?: string;
  /** 县/区/县级市（可选） */
  admin3?: string;
}

export const FALLBACK_CITY: CityPick = { lat: 39.9042, lon: 116.4074, name: '北京' };

/** 城市去重/天气缓存键：经纬度保留两位小数 */
export function cityKeyOf(c: CityPick): string {
  return `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
}

// ==================== 天气码映射 ====================

/** Open-Meteo WMO 天气码 → 中文描述 + lucide 图标 */
export function weatherCodeInfo(code: number): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: '晴', Icon: Sun };
  if (code === 1 || code === 2) return { label: '局部多云', Icon: CloudSun };
  if (code === 3) return { label: '多云', Icon: Cloud };
  if (code === 45 || code === 48) return { label: '雾', Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: '毛毛雨', Icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { label: '雨', Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: '雪', Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: '阵雨', Icon: CloudRainWind };
  if (code === 85 || code === 86) return { label: '阵雪', Icon: CloudSnow };
  if (code >= 95 && code <= 99) return { label: '雷雨', Icon: CloudLightning };
  return { label: '多云', Icon: Cloud };
}

// ==================== 数据源（App 与 Widget 共用） ====================

let sharedKey = '';
let sharedPromise: Promise<WeatherData> | null = null;

/** 获取天气数据（同坐标的并发请求共享同一个 Promise） */
export function fetchWeather(lat: number, lon: number, name: string, force = false): Promise<WeatherData> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (!force && sharedPromise && sharedKey === key) return sharedPromise;

  const url = `/api/weather?lat=${lat}&lon=${lon}&name=${encodeURIComponent(name)}`;
  const promise = fetch(url).then(async (res) => {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(body?.error || '天气服务暂时不可用');
    const data = body as unknown as WeatherData;
    if (!data || typeof data !== 'object' || !data.current || !Array.isArray(data.daily)) {
      throw new Error('天气数据异常');
    }
    return data;
  });

  sharedKey = key;
  sharedPromise = promise;
  // 请求失败后清空共享缓存，允许下次重试
  void promise.catch(() => {
    if (sharedKey === key && sharedPromise === promise) {
      sharedKey = '';
      sharedPromise = null;
    }
  });
  return promise;
}

/** 搜索城市（Open-Meteo Geocoding 代理） */
export async function searchCity(query: string): Promise<CitySearchResult[]> {
  const res = await fetch(`/api/weather/geocode?q=${encodeURIComponent(query)}`);
  const body = (await res.json().catch(() => null)) as { results?: CitySearchResult[]; error?: string } | null;
  if (!res.ok) throw new Error(body?.error || '搜索服务暂不可用');
  return body?.results ?? [];
}

// ---------------- localStorage 缓存（小组件快速显示） ----------------

const LS_WEATHER_KEY = 'ios-weather-cache-v1';

function isWeatherData(v: unknown): v is WeatherData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Partial<WeatherData>;
  return (
    typeof o.current === 'object' &&
    o.current !== null &&
    Array.isArray(o.hourly) &&
    Array.isArray(o.daily)
  );
}

export function readWeatherCache(maxAgeMs: number): WeatherData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_WEATHER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: unknown; ts?: number };
    if (!parsed || typeof parsed.ts !== 'number' || !isWeatherData(parsed.data)) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeWeatherCache(data: WeatherData): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_WEATHER_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* 存储失败可忽略 */
  }
}

// ---------------- 城市解析：已选城市 → 定位 → 北京兜底 ----------------

export function asCityPick(v: unknown): CityPick | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lat === 'number' && Number.isFinite(o.lat) && typeof o.lon === 'number' && Number.isFinite(o.lon) && typeof o.name === 'string') {
    return {
      lat: o.lat,
      lon: o.lon,
      name: o.name,
      admin1: typeof o.admin1 === 'string' && o.admin1 ? o.admin1 : undefined,
      admin2: typeof o.admin2 === 'string' && o.admin2 ? o.admin2 : undefined,
      admin3: typeof o.admin3 === 'string' && o.admin3 ? o.admin3 : undefined,
    };
  }
  return null;
}

function getPosition(timeoutMs = 5000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation 不可用'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: timeoutMs,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

/** 反向地理编码：经纬度 → 城市/县城名（调 /api/weather/reverse 代理 BigDataCloud）。
 *  失败时返回 null，调用方兜底「当前位置」或 FALLBACK_CITY。 */
async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; admin1?: string; admin2?: string; admin3?: string } | null> {
  try {
    const res = await fetch(`/api/weather/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string; admin1?: string; admin2?: string; admin3?: string };
    if (typeof data.name === 'string' && data.name) {
      return {
        name: data.name,
        admin1: data.admin1 || undefined,
        admin2: data.admin2 || undefined,
        admin3: data.admin3 || undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 依次尝试：IndexedDB 中用户选择过的城市 → 浏览器定位（反查城市县名） → 北京兜底（定位失败静默） */
export async function resolveCityPick(): Promise<CityPick> {
  try {
    const rec = await localDB.get('settings', 'weatherCity');
    const pick = asCityPick(rec?.value);
    if (pick) return pick;
  } catch {
    /* IndexedDB 不可用时忽略 */
  }
  try {
    const pos = await getPosition(5000);
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    // 定位后反查城市县名（不再显示「当前位置」），反查失败才兜底「当前位置」
    const rev = await reverseGeocode(lat, lon);
    if (rev) {
      return { lat, lon, name: rev.name, admin1: rev.admin1, admin2: rev.admin2, admin3: rev.admin3 };
    }
    return { lat, lon, name: '当前位置' };
  } catch {
    /* 定位失败静默，走兜底城市 */
  }
  return FALLBACK_CITY;
}

// ==================== 天气快照（锁屏小组件用） ====================

let weatherSnap: WeatherData | null = null;
let weatherSnapRead = false;
let weatherFetchStarted = false;
const weatherListeners = new Set<() => void>();

function readWeatherSnapOnce(): WeatherData | null {
  if (!weatherSnapRead) {
    weatherSnapRead = true;
    weatherSnap = readWeatherCache(10 * 60 * 1000);
  }
  return weatherSnap;
}

function emitWeather(): void {
  for (const listener of weatherListeners) listener();
}

/** 写缓存 + 更新模块级快照 + 广播给所有小组件订阅者（即时刷新，无需刷新网页）。
 *  天气 App 的 load()/switchCity()/ensureWeatherLoaded() 成功后调此函数，
 *  HomeScreen/LockScreen 的小组件通过 useWeatherSnapshot 订阅，立即收到新城市天气。 */
export function publishWeatherSnap(data: WeatherData): void {
  writeWeatherCache(data);
  weatherSnap = data;
  weatherSnapRead = true;
  emitWeather();
}

/** 无缓存时后台拉取一次（已选城市→定位→北京兜底），成功写缓存并广播；失败回退过期缓存 */
function ensureWeatherLoaded(): void {
  if (weatherFetchStarted) return;
  weatherFetchStarted = true;
  if (readWeatherSnapOnce() !== null) return;
  void (async () => {
    try {
      const pick = await resolveCityPick();
      const fresh = await fetchWeather(pick.lat, pick.lon, pick.name);
      publishWeatherSnap(fresh); // 统一走 publishWeatherSnap（写缓存+更新快照+广播）
    } catch {
      const stale = readWeatherCache(Number.POSITIVE_INFINITY);
      if (stale) {
        weatherSnap = stale;
        emitWeather();
      } else {
        weatherFetchStarted = false; // 允许下次订阅时重试
      }
    }
  })();
}

function subscribeWeather(onChange: () => void): () => void {
  weatherListeners.add(onChange);
  ensureWeatherLoaded();
  return () => {
    weatherListeners.delete(onChange);
  };
}

function getWeatherSnapshot(): WeatherData | null {
  return readWeatherSnapOnce();
}

function getWeatherServerSnapshot(): WeatherData | null {
  return null;
}

/**
 * 轻量天气快照（锁屏小组件用）：useSyncExternalStore 订阅模块级状态。
 * hydration 期间与 SSR 一致（null），随后同步切到缓存值，无水合警告；
 * 无缓存时后台拉取，与天气 App 共享 fetchWeather 去重与 localStorage 缓存。
 */
export function useWeatherSnapshot(): WeatherData | null {
  return useSyncExternalStore(subscribeWeather, getWeatherSnapshot, getWeatherServerSnapshot);
}
