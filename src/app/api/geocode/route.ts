import { NextRequest, NextResponse } from 'next/server';

/**
 * 地理编码代理（情侣轨迹真实地图用）：地址/城市名 → WGS84 经纬度。
 *
 * 上游用 Open-Meteo Geocoding（免费无 Key，沙箱已验证可达；Nominatim/Photon 均不可达）。
 * 支持中文城市名（language=zh），返回前 8 个候选（名称 + 省份/国家消歧）。
 * 上游偶发返回空结果（限流），带 4 次退避重试 + 5 分钟内存缓存。
 *
 * 响应：{ results: [{ name, lat, lng, label }] }；无结果时 results 为空数组。
 */

const geoCache = new Map<string, { results: { name: string; lat: number; lng: number; label: string }[]; t: number }>();

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ results: [] });
  if (q.length > 40) return NextResponse.json({ error: 'query too long' }, { status: 400 });

  const cacheKey = q.toLowerCase();
  const hit = geoCache.get(cacheKey);
  if (hit && Date.now() - hit.t < 5 * 60_000) {
    return NextResponse.json({ results: hit.results });
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`;
  // 上游偶发返回空 results（限流/边缘抖动），重试 4 次（退避 0.4/0.9/1.6/2.5s）
  const backoff = [400, 900, 1600, 2500];
  for (let attempt = 0; attempt < backoff.length; attempt++) {
    if (attempt > 0) await new Promise((res) => setTimeout(res, backoff[attempt]));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = r.ok
        ? ((await r.json()) as { results?: { name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string }[] })
        : {};
      const seen = new Set<string>();
      const results = (data.results ?? [])
        .filter((it) => typeof it.latitude === 'number' && typeof it.longitude === 'number')
        .map((it) => {
          const name = (it.name ?? '').trim() || q;
          const parts = [it.admin1?.trim(), it.country?.trim()].filter((x) => x && x !== name);
          const label = [name, ...new Set(parts)].join(' · ');
          return { name, lat: it.latitude as number, lng: it.longitude as number, label };
        })
        .filter((it) => {
          const k = `${it.name}|${it.lat.toFixed(2)}|${it.lng.toFixed(2)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, 8);
      if (results.length > 0) {
        geoCache.set(cacheKey, { results, t: Date.now() });
        return NextResponse.json({ results });
      }
      if (attempt === backoff.length - 1) return NextResponse.json({ results: [] });
    } catch {
      /* 单次失败继续重试 */
    }
  }
  return NextResponse.json({ results: [] });
}
