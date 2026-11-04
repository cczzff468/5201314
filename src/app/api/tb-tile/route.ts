/**
 * 淘宝添加地址·真实地图瓦片代理：
 * GET /api/tb-tile?z=15&x=&y= → OpenStreetMap 栅格瓦片（服务端转发 + 内存缓存）。
 * 走服务端代理的原因：①统一带 User-Agent（OSM 瓦片使用政策要求）；②受限网络环境客户端直连不稳定；
 * ③内存 LRU 缓存降低外网请求频次（3×3 视口每次仅 9 张，命中后零请求）。
 */
export const runtime = 'nodejs';

const cache = new Map<string, { buf: Uint8Array; type: string; at: number }>();
const MAX_ENTRIES = 360;

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const z = Math.min(19, Math.max(2, Number.parseInt(sp.get('z') ?? '15', 10) || 15));
  const x = Number.parseInt(sp.get('x') ?? '', 10);
  const y = Number.parseInt(sp.get('y') ?? '', 10);
  const n = 2 ** z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return new Response('bad tile coords', { status: 400 });
  }
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    hit.at = Date.now();
    return new Response(hit.buf.buffer as ArrayBuffer, { headers: { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' } });
  }
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': 'taobao-demo-map/1.0 (in-app address picker demo)', Referer: 'https://www.openstreetmap.org/' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return new Response('tile upstream error', { status: 502 });
    const type = res.headers.get('content-type') ?? 'image/png';
    const ab = await res.arrayBuffer();
    if (cache.size >= MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, MAX_ENTRIES / 3);
      for (const [k] of oldest) cache.delete(k);
    }
    cache.set(key, { buf: new Uint8Array(ab), type, at: Date.now() });
    return new Response(ab, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return new Response('tile fetch failed', { status: 502 });
  }
}
