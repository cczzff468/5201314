import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/weather/reverse?lat=39.9&lon=116.4
 * 反向地理编码：经纬度 → 城市/县城名（定位后不再显示「当前位置」，改为真实城市县名）。
 * 上游用 BigDataCloud Client Reverse Geocoding（免费、无需 API Key、支持中文 locale）。
 * 返回 { name, admin1, admin2, admin3, country } 或 502（上游不可达时）。
 */

const REVERSE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const CACHE_TTL = 30 * 60 * 1000; // 30min（经纬度反查结果稳定，缓存可长）
const CACHE_MAX = 120;

interface ReverseResult {
  /** 最具代表性的显示名（优先县/区，其次市，其次省） */
  name: string;
  /** 省/直辖市 */
  admin1: string;
  /** 地级市/州/盟 */
  admin2: string;
  /** 县/区/县级市 */
  admin3: string;
  /** 国家 */
  country: string;
}

interface CacheEntry {
  data: ReverseResult;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

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

function setCache(key: string, data: ReverseResult): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

export async function GET(request: NextRequest) {
  const latStr = request.nextUrl.searchParams.get('lat');
  const lonStr = request.nextUrl.searchParams.get('lon');
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: '参数无效：lat/lon 需为合法经纬度' }, { status: 400 });
  }

  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return NextResponse.json(hit.data);
  }

  // BigDataCloud 反查：返回 principalSubdivision(省/admin1)、city(地级市/admin2)、
  // locality(县区/admin3)、countryName；localityInfo.administrative 更详细但上面四字段已够用
  const url = `${REVERSE_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;

  try {
    const raw = (await fetchJsonHttps(url, 10_000)) as {
      locality?: string;
      principalSubdivision?: string;
      city?: string;
      countryName?: string;
    };
    const admin1 = typeof raw.principalSubdivision === 'string' ? raw.principalSubdivision : '';
    const admin2 = typeof raw.city === 'string' ? raw.city : '';
    const admin3 = typeof raw.locality === 'string' ? raw.locality : '';
    const country = typeof raw.countryName === 'string' ? raw.countryName : '';
    // name 优先级：县/区 → 市 → 省（显示最具体的本地名）
    const name = admin3 || admin2 || admin1 || '';
    if (!name) throw new Error('反查无结果');
    const result: ReverseResult = { name, admin1, admin2, admin3, country };
    setCache(key, result);
    return NextResponse.json(result);
  } catch {
    // 上游不可达回退过期缓存（#31 同款策略）
    if (hit) {
      return NextResponse.json({ ...hit.data, stale: true });
    }
    return NextResponse.json({ error: '反向地理编码服务暂时不可用' }, { status: 502 });
  }
}
