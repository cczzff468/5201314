import { NextRequest } from 'next/server';

/**
 * 音乐媒体流代理 —— 解决两个问题：
 * 1. 网易云音频直链默认 http://，在 https 预览环境下会被浏览器混合内容策略拦截；
 *    封面部分 http 图同理。统一走本路由（同源）即可。
 * 2. 部分直链带防盗链，代理侧补 Referer。
 *
 * 支持 Range 透传（拖动进度条依赖 206）。
 * 白名单仅放行 *.music.126.net / *.126.net / *.netease.com（防 SSRF）。
 */

export const runtime = 'nodejs';

function allowed(u: URL): boolean {
  const h = u.hostname;
  return h.endsWith('.music.126.net') || h.endsWith('.126.net') || h.endsWith('.netease.com');
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? '';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || !allowed(u)) {
    return new Response('host not allowed', { status: 403 });
  }
  const range = req.headers.get('range');
  try {
    const up = await fetch(u.toString(), {
      headers: {
        ...(range ? { Range: range } : {}),
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const headers = new Headers();
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(k);
      if (v) headers.set(k, v);
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'public, max-age=3600');
    return new Response(up.body, { status: up.status, headers });
  } catch (e) {
    return new Response(`upstream error: ${(e as Error).message}`, { status: 502 });
  }
}
