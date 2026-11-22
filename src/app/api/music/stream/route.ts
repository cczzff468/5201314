import { NextRequest } from 'next/server';

/**
 * 音乐媒体流代理 —— 解决两个问题：
 * 1. 网易云音频直链默认 http://，在 https 预览环境下会被浏览器混合内容策略拦截；
 *    封面部分 http 图同理。统一走本路由（同源）即可。
 * 2. 部分直链带防盗链，代理侧按目标域补对应 Referer。
 *
 * 支持 Range 透传（拖动进度条依赖 206）。
 * 白名单放行（防 SSRF）：
 *   - 网易：*.music.126.net / *.126.net / *.netease.com（含 pyncmd 解灰镜像）
 *   - 解灰（UNM）音源：*.kuwo.cn（kuwo/bodian）、*.kugou.com + *.kgimg.com（酷狗图片 CDN：
 *     imge.kgimg.com 专辑封面 / c1.kgimg.com 歌单封面）、*.migu.cn / *.miguvideo.com（咪咕）、
 *     *.qq.com / *.qqmusic.qq.com（QQ 音乐 CDN 与 qpic 封面）、y.gtimg.cn（QQ 专辑封面）
 */

export const runtime = 'nodejs';

function allowed(u: URL): boolean {
  const h = u.hostname;
  return (
    h.endsWith('.music.126.net') ||
    h.endsWith('.126.net') ||
    h.endsWith('.netease.com') ||
    h.endsWith('.kuwo.cn') ||
    h.endsWith('.kugou.com') ||
    h.endsWith('.kgimg.com') ||
    h.endsWith('gtimg.cn') ||
    h.endsWith('.migu.cn') ||
    h.endsWith('.miguvideo.com') ||
    h.endsWith('.qq.com') ||
    // QQ 音乐推荐歌单封面（cover_url_medium）域名 p.qpic.cn（不带 Referer 也可访，但需过白名单）
    h.endsWith('.qpic.cn')
  );
}

/** 按目标域补防盗链 Referer（UNM 各音源 CDN 校验口径不一） */
function refererFor(host: string): string | undefined {
  if (host.endsWith('.126.net') || host.endsWith('.netease.com')) return 'https://music.163.com/';
  if (host.endsWith('.kuwo.cn')) return 'http://www.kuwo.cn/';
  if (host.endsWith('.kugou.com') || host.endsWith('.kgimg.com')) return 'http://www.kugou.com/';
  if (host.endsWith('gtimg.cn')) return 'https://y.qq.com/';
  if (host.endsWith('.migu.cn') || host.endsWith('.miguvideo.com')) return 'https://music.migu.cn/';
  if (host.endsWith('.qq.com') || host.endsWith('.qpic.cn')) return 'https://y.qq.com/';
  return undefined;
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
    const ref = refererFor(u.hostname);
    const up = await fetch(u.toString(), {
      headers: {
        ...(range ? { Range: range } : {}),
        ...(ref ? { Referer: ref } : {}),
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
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
