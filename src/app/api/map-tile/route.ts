import { NextRequest, NextResponse } from 'next/server';

/**
 * 高德地图瓦片代理（情侣轨迹真实地图用）。
 *
 * 为什么走服务端代理：沙箱/预览环境对 tile.openstreetmap.org、carto 等海外瓦片不可达，
 * 但高德 webrd 瓦片（国内 CDN）可达（已验证 200）。浏览器统一请求本路由，
 * 服务端拉取高德栅格瓦片后回传，保证地图一定能渲染。
 *
 * 高德 Web 瓦片说明：
 * - URL: https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}
 * - style=8 = 路网 + 注记（标准街道图）；xyz 与 Google/Leaflet slippy 同 scheme（y 向下）。
 * - 瓦片按 GCJ-02 坐标索引，前端展示点位需做 WGS84→GCJ02 纠偏（见 couple-space.tsx）。
 *
 * 缓存：内存 LRU（默认上限 320 张 ≈ 15MB 内），命中直接回传，减少外网请求与延迟。
 */

const UPSTREAM_HOSTS = ['webrd01', 'webrd02', 'webrd03', 'webrd04'];
const CACHE_MAX = 320;
const cache = new Map<string, { buf: ArrayBuffer; ct: string; t: number }>();

function clampInt(v: string | null, min: number, max: number): number | null {
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const z = clampInt(sp.get('z'), 1, 18);
  const x = clampInt(sp.get('x'), 0, 2 ** 18);
  const y = clampInt(sp.get('y'), 0, 2 ** 18);
  if (z == null || x == null || y == null) {
    return NextResponse.json({ error: 'invalid z/x/y' }, { status: 400 });
  }
  if (x > 2 ** z - 1 || y > 2 ** z - 1) {
    return NextResponse.json({ error: 'tile out of range' }, { status: 400 });
  }

  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    hit.t = Date.now();
    return new NextResponse(hit.buf, {
      headers: { 'Content-Type': hit.ct, 'Cache-Control': 'public, max-age=86400' },
    });
  }

  // 四台瓦片服务器随机散列，分摊负载
  const host = UPSTREAM_HOSTS[(x + y) % UPSTREAM_HOSTS.length];
  const url = `https://${host}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://www.amap.com/' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    const ct = r.headers.get('content-type') ?? 'image/png';
    const buf = await r.arrayBuffer();
    if (cache.size >= CACHE_MAX) {
      // 淘汰最旧的一批（简单 LRU：按时间戳删到 80%）
      const entries = [...cache.entries()].sort((a, b) => a[1].t - b[1].t);
      for (let i = 0; i < Math.floor(CACHE_MAX * 0.2); i++) cache.delete(entries[i][0]);
    }
    cache.set(key, { buf, ct, t: Date.now() });
    return new NextResponse(buf, {
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return NextResponse.json({ error: 'tile fetch failed' }, { status: 504 });
  }
}
