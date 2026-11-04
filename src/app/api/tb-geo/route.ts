/**
 * 淘宝添加地址·真实地址服务（OpenStreetMap Nominatim 服务端代理）：
 * - GET /api/tb-geo?lat=&lon=  → 逆地理编码：经纬度 → 真实中文地址（省/市/区县/街道乡镇/道路）
 * - GET /api/tb-geo?q=关键词    → 正向搜索：关键词 → 候选地点列表（用于「搜索地址更快填写」）
 * 说明：Nominatim 要求携带 User-Agent 且限速（≤1 req/s），故统一走服务端 + 内存缓存
 * （逆编码按经纬度 4 位小数缓存，同位置重复进入零请求；搜索按关键词 60s 内复用）。
 */
export const runtime = 'nodejs';

const UA = 'taobao-demo-map/1.0 (in-app address picker demo)';

const revCache = new Map<string, { at: number; data: unknown }>();
const searchCache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60_000;

function prune(m: Map<string, { at: number; data: unknown }>): void {
  const now = Date.now();
  for (const [k, v] of m) if (now - v.at > TTL) m.delete(k);
}

interface NominatimAddress {
  state?: string;
  city?: string;
  town?: string;
  county?: string;
  suburb?: string;
  city_district?: string;
  township?: string;
  village?: string;
  neighbourhood?: string;
  road?: string;
  [k: string]: string | undefined;
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') ?? '').trim();
  const lat = Number.parseFloat(sp.get('lat') ?? '');
  const lon = Number.parseFloat(sp.get('lon') ?? '');
  const commonHeaders = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5' };
  /** display_name 片段清洗：去掉国家名/纯数字（邮编），保留中文地名链（小→大） */
  const cnParts = (display: string): string[] =>
    display
      .split(',')
      .map((s) => s.trim())
      .filter((p) => p.length > 0 && !/^\d+$/.test(p) && p !== '中国');

  try {
    // 正向搜索（关键词 → 候选地点）
    if (q) {
      prune(searchCache);
      const hit = searchCache.get(q);
      if (hit) return Response.json(hit.data);
      const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=zh-CN&countrycodes=cn&q=${encodeURIComponent(q)}`;
      const res = await fetch(u, { headers: commonHeaders, signal: AbortSignal.timeout(7000) });
      if (!res.ok) return Response.json({ error: 'search failed' }, { status: 502 });
      const arr = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      const data = arr.map((r) => {
        const cn = cnParts(r.display_name); // [村/小区, 街道, 区, 市, 省]
        return {
          label: cn.slice(0, 4).reverse().join(''), // 省+市+区县+街道（选中后作「所在地区」）
          tail: cn[0] ?? '', // 最小地名（村/小区/门牌，填详细地址）
          full: r.display_name,
          lat: Number.parseFloat(r.lat),
          lon: Number.parseFloat(r.lon),
        };
      });
      searchCache.set(q, { at: Date.now(), data });
      return Response.json(data);
    }

    // 逆地理编码（经纬度 → 真实地址）
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      prune(revCache);
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      const hit = revCache.get(key);
      if (hit) return Response.json(hit.data);
      const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=zh-CN`;
      const res = await fetch(u, { headers: commonHeaders, signal: AbortSignal.timeout(7000) });
      if (!res.ok) return Response.json({ error: 'reverse failed' }, { status: 502 });
      const j = (await res.json()) as { display_name?: string; address?: NominatimAddress };
      const a = j.address ?? {};
      const cn = cnParts(j.display_name ?? '');
      // 完整区域链（省+市+区县+街道乡镇+村/社区，最多 5 级）——需求：省市村地址全部展示
      const region = cn.slice(0, 5).reverse().join('');
      const data = {
        formatted: j.display_name ?? '',
        region,
        road: a.road ?? '',
        village: cn[0] ?? '',
        lat,
        lon,
      };
      revCache.set(key, { at: Date.now(), data });
      return Response.json(data);
    }

    return Response.json({ error: 'missing params' }, { status: 400 });
  } catch {
    return Response.json({ error: 'geo service unavailable' }, { status: 502 });
  }
}
