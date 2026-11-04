import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/weather?lat=39.9&lon=116.4&name=北京
 * 免费 Open-Meteo Forecast API 代理（无需 API Key），服务端内存缓存 10 分钟。
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 120;

interface CacheEntry {
  data: WeatherResponse;
  ts: number;
}

/** 模块级内存缓存：key = "lat,lon"（保留两位小数） */
const cache = new Map<string, CacheEntry>();

// ---------------- 上游请求（node:https 强制 IPv4） ----------------

/**
 * 部分运行环境下 undici（全局 fetch）对含 AAAA 记录的主机会因 IPv6 不可达 +
 * Happy-Eyeballs 回退缺陷而超时，这里用 node:https 强制 IPv4 保证连通。
 */
function fetchJsonHttps(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { family: 4, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`upstream ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('upstream 返回非 JSON'));
        }
      });
    });
    req.on('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

// ---------------- 上游原始结构 ----------------

interface OpenMeteoCurrent {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  pressure_msl: number;
}

interface OpenMeteoForecast {
  current?: OpenMeteoCurrent;
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    weather_code: (number | null)[];
    precipitation_probability: (number | null)[];
  };
  daily?: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    sunrise: string[];
    sunset: string[];
  };
}

// ---------------- 对外返回结构 ----------------

export interface WeatherResponse {
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

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function setCache(key: string, data: WeatherResponse): void {
  // 简单容量控制：超出上限时淘汰最早写入的条目
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  const name = (params.get('name') ?? '').slice(0, 40);

  // 参数校验
  if (
    params.get('lat') === null ||
    params.get('lon') === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return NextResponse.json(
      { error: '参数无效：lat 需为 -90~90 的数字，lon 需为 -180~180 的数字' },
      { status: 400 }
    );
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return NextResponse.json(hit.data);
  }

  const url =
    `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl,wind_direction_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
    '&timezone=auto&forecast_days=8';

  try {
    const raw = (await fetchJsonHttps(url, 10_000)) as OpenMeteoForecast;
    const cur = raw.current;
    if (!cur) throw new Error('missing current');

    // hourly：从当前小时起 24 条（current.time 形如 2024-05-01T13:30，取前 13 位对齐小时）
    const hourKey = cur.time.slice(0, 13);
    const times = raw.hourly?.time ?? [];
    let start = times.findIndex((t) => t.slice(0, 13) === hourKey);
    if (start < 0) start = 0;
    const hourly: WeatherResponse['hourly'] = [];
    for (let i = start; i < Math.min(start + 24, times.length); i++) {
      hourly.push({
        time: (times[i] ?? '').slice(11, 16),
        temp: Math.round(num(raw.hourly?.temperature_2m?.[i])),
        code: num(raw.hourly?.weather_code?.[i]),
        pop: Math.round(num(raw.hourly?.precipitation_probability?.[i])),
      });
    }

    // daily：7 天
    const dTimes = raw.daily?.time ?? [];
    const daily: WeatherResponse['daily'] = [];
    for (let i = 0; i < Math.min(7, dTimes.length); i++) {
      daily.push({
        date: dTimes[i] ?? '',
        code: num(raw.daily?.weather_code?.[i]),
        max: Math.round(num(raw.daily?.temperature_2m_max?.[i])),
        min: Math.round(num(raw.daily?.temperature_2m_min?.[i])),
        sunrise: raw.daily?.sunrise?.[i] ?? '',
        sunset: raw.daily?.sunset?.[i] ?? '',
      });
    }

    const payload: WeatherResponse = {
      name,
      current: {
        time: cur.time,
        temperature: Math.round(num(cur.temperature_2m)),
        apparent: Math.round(num(cur.apparent_temperature)),
        humidity: Math.round(num(cur.relative_humidity_2m)),
        code: num(cur.weather_code),
        windSpeed: num(cur.wind_speed_10m),
        windDirection: num(cur.wind_direction_10m),
        pressure: num(cur.pressure_msl),
      },
      hourly,
      daily,
    };

    setCache(key, payload);
    return NextResponse.json(payload);
  } catch {
    // 上游不可达回退过期缓存（#31）：沙箱/断网环境下 open-meteo 经常被回收，
    // 直接返 502 会让天气小组件长期空白；命中过期缓存条目时优先返回 + stale 标记，
    // 502 仅在「无任何缓存」时使用——下游可继续展示旧数据并提示已脱机。
    const stale = hit;
    if (stale) {
      return NextResponse.json({ ...stale.data, stale: true });
    }
    return NextResponse.json({ error: '天气服务暂时不可用' }, { status: 502 });
  }
}
