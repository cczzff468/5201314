import { NextRequest } from 'next/server';

/**
 * 酷狗音乐 API 代理（多通道，自动故障切换）—— 与 ncm/qq 代理同模式：
 *   /api/music/kugou/<path>?<query>  →  按链序尝试上游，仅对「连接级失败」自动降级：
 *
 *   ① KUGOU_API_UPSTREAM（环境变量，若显式设置则最优先）
 *   ② http://localhost:3012（沙箱实例 mini-services/kugou-api：
 *      MakcRe/KuGouMusicApi v1.6.3 vendor，netease 风格 API：
 *      login/qr/key + create + check、login/cellphone、search、song/url、
 *      user/playlist、playlist/detail、recommend/songs 等）
 *   ③ KUGOU_API_FALLBACK（云端兜底，默认指向部署在 Vercel 的实例）
 *
 * 切换规则与 ncm 代理一致；x-kg-upstream 响应头标识当前实例；本机失联记忆 60s。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCAL = 'http://localhost:3012';
const CLOUD_FALLBACK = process.env.KUGOU_API_FALLBACK?.trim() || 'https://kugou-music-api.vercel.app';
const EXPLICIT = process.env.KUGOU_API_UPSTREAM?.trim() || '';

const CHAIN: { base: string; tag: string; timeoutMs: number }[] = EXPLICIT
  ? [
      { base: EXPLICIT, tag: 'explicit', timeoutMs: 25_000 },
      { base: CLOUD_FALLBACK, tag: 'cloud', timeoutMs: 25_000 },
    ]
  : [
      { base: LOCAL, tag: 'local', timeoutMs: 8_000 },
      { base: CLOUD_FALLBACK, tag: 'cloud', timeoutMs: 25_000 },
    ];

let localDownUntil = 0;

async function tryUpstream(
  base: string,
  target: string,
  method: string,
  contentType: string,
  body: string | undefined,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(`${base}/${target}`, {
      method,
      headers: { 'Content-Type': contentType },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

async function proxy(req: NextRequest, path: string[]) {
  const url = new URL(req.url);
  const target = `${path.map(encodeURIComponent).join('/')}${url.search}`;
  const method = req.method;
  const contentType = req.headers.get('content-type') ?? 'application/json';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();

  const tried: string[] = [];
  for (const up of CHAIN) {
    if (up.tag === 'local' && Date.now() < localDownUntil) {
      tried.push(`${up.tag}(跳过,失联记忆中)`);
      continue;
    }
    const res = await tryUpstream(up.base, target, method, contentType, body, up.timeoutMs);
    if (res) {
      const headers = new Headers();
      headers.set('content-type', res.headers.get('content-type') ?? 'application/json; charset=utf-8');
      headers.set('cache-control', 'no-store');
      headers.set('x-kg-upstream', up.tag);
      return new Response(res.body, { status: res.status, headers });
    }
    tried.push(up.tag);
    if (up.tag === 'local') localDownUntil = Date.now() + 60_000;
  }

  return new Response(
    JSON.stringify({
      code: -2,
      errMsg: `酷狗音乐 API 全通道不可达（已尝试: ${tried.join(' → ')}；云端兜底 ${CLOUD_FALLBACK}）。`,
    }),
    { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
