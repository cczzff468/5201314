import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/weather/geocode?q=北京
 * 免费 Open-Meteo Geocoding API 代理（无需 API Key），服务端内存缓存 10 分钟。
 */

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 120;

interface CitySearchResult {
  name: string;
  country: string;
  admin1: string;
  /** 省内下一级行政区（地级市/州/盟），open-meteo admin2 字段 */
  admin2?: string;
  /** 县/区/县级市，open-meteo admin3 字段（部分结果才有） */
  admin3?: string;
  latitude: number;
  longitude: number;
}

interface CacheEntry {
  data: { results: CitySearchResult[] };
  ts: number;
}

/** 模块级内存缓存：key = 查询词小写 */
const cache = new Map<string, CacheEntry>();

// ---------------- 上游请求（node:https 强制 IPv4） ----------------

/**
 * geocoding-api.open-meteo.com 含 AAAA 记录，沙箱内 undici（全局 fetch）会因
 * IPv6 不可达 + Happy-Eyeballs 回退缺陷而超时，这里用 node:https 强制 IPv4 保证连通。
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

function setCache(key: string, data: { results: CitySearchResult[] }): void {
  // 简单容量控制：超出上限时淘汰最早写入的条目
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q || q.length > 50) {
    return NextResponse.json({ error: '参数无效：q 需为 1~50 个字符' }, { status: 400 });
  }

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return NextResponse.json(hit.data);
  }

  const url = `${GEO_URL}?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`;

  try {
    const raw = (await fetchJsonHttps(url, 10_000)) as {
      results?: { name?: string; country?: string; admin1?: string; admin2?: string; admin3?: string; latitude?: number; longitude?: number }[];
    };
    const results: CitySearchResult[] = (raw.results ?? []).map((r) => ({
      name: typeof r.name === 'string' ? r.name : '',
      country: typeof r.country === 'string' ? r.country : '',
      admin1: typeof r.admin1 === 'string' ? r.admin1 : '',
      admin2: typeof r.admin2 === 'string' && r.admin2 ? r.admin2 : undefined,
      admin3: typeof r.admin3 === 'string' && r.admin3 ? r.admin3 : undefined,
      latitude: typeof r.latitude === 'number' && Number.isFinite(r.latitude) ? r.latitude : 0,
      longitude: typeof r.longitude === 'number' && Number.isFinite(r.longitude) ? r.longitude : 0,
    }));
    const payload = { results };
    setCache(key, payload);
    return NextResponse.json(payload);
  } catch {
    // 上游不可达回退过期缓存（#31）：沙箱/断网环境下 geocoding 上游常被回收，
    // 直接返 502 会让城市搜索长期空白；命中过期缓存条目时优先返回 + stale 标记，
    // 502 仅在「无任何缓存」时使用——下游可继续展示旧数据并提示已脱机。
    const stale = hit;
    if (stale) {
      return NextResponse.json({ ...stale.data, stale: true });
    }
    return NextResponse.json({ error: '城市搜索服务暂时不可用' }, { status: 502 });
  }
}
