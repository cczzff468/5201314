import { NextRequest, NextResponse } from 'next/server';

/**
 * 表情图片防盗链代理（GET /api/sticker-image?u=<编码后的原图 URL>）
 *
 * 为什么需要：搜索结果里的图片直链（itc.cn / qhimgs1.com / img.wxcha.com / sinaimg.cn 等）普遍校验
 * Referer，聊天消息气泡直接 <img src=外域> 会裂图——统一经本代理带正确 Referer 转发。
 *
 * 安全（Task 27 修订）：网上表情搜索的图片域名长尾极大（每换一个搜索源就是一批新域），
 * 域名白名单会 continual 403；改为「行为白名单」——
 *  1. 拦内网/危险地址（localhost/127./10./192.168./172.16-31/169.254/0./::1/fc00/fe80 等）不变；
 *  2. 放宽公网域，但响应必须是图片（Content-Type image/* 或 URL 以图片扩展名结尾），否则 403——
 *     代理不能被当通用网页/文件代理用；
 *  3. 已知防盗链域继续带伪造 Referer（见 REFERER_RULES），未知域带同源 Referer 兜底。
 * 缓存：不落盘不驻内存，流式转发；浏览器侧 Cache-Control 86400s 自行缓存。
 */

export const runtime = 'nodejs';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/** 域名后缀白名单（带点精确后缀匹配）+ 对应伪造 Referer（来源站 = 图片实际所属站点） */
const REFERER_RULES: [RegExp, string][] = [
  [/(\.|^)soutula\.com$/i, 'https://fabiaoqing.com/'],
  [/(\.|^)sinaimg\.cn$/i, 'https://weibo.com/'],
  [/(\.|^)hdslb\.com$/i, 'https://www.bilibili.com/'],
  [/(\.|^)gtimg\.com$/i, 'https://qq.com/'],
  [/(\.|^)alicdn\.com$/i, 'https://www.taobao.com/'],
  [/(\.|^)byteimg\.com$/i, 'https://www.douyin.com/'],
  [/(\.|^)douyinpic\.com$/i, 'https://www.douyin.com/'],
  [/(\.|^)360buyimg\.com$/i, 'https://www.jd.com/'],
  // 360 图片源高频结果 CDN（奇虎 qhimgs / 搜狐 itc/sohucs）
  [/(\.|^)qhimgs\d*\.com$/i, 'https://image.so.com/'],
  [/(\.|^)qhimg\.com$/i, 'https://image.so.com/'],
  [/(\.|^)qhres\d*\.com$/i, 'https://image.so.com/'],
  [/(\.|^)itc\.cn$/i, 'https://www.sohu.com/'],
  [/(\.|^)sohucs\.com$/i, 'https://www.sohu.com/'],
  [/(\.|^)sohu\.com$/i, 'https://www.sohu.com/'],
  // 表情站/图床（微信表情党、堆糖、斗图站等）
  [/(\.|^)wxcha\.com$/i, 'https://www.wxcha.com/'],
  [/(\.|^)duitang\.com$/i, 'https://www.duitang.com/'],
  [/(\.|^)bq233\.com$/i, 'https://www.dbbqb.com/'],
  [/(\.|^)72qq\.com$/i, 'https://www.72qq.com/'],
  [/(\.|^)5577\.com$/i, 'https://www.5577.com/'],
];

/** 图片扩展名（响应缺 image/* Content-Type 时的兜底判定） */
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif|apng)([?#]|$)/i;

function refererFor(host: string, url: URL): string {
  for (const [re, ref] of REFERER_RULES) if (re.test(host)) return ref;
  // 未知域：带同源 Referer 兜底（部分 CDN 校验「必须带本站 Referer」）
  return `${url.protocol}//${url.hostname}/`;
}

/** 内网/危险地址拦截 */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1|f[cd]|fe80)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw) return NextResponse.json({ error: 'missing u' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(decodeURIComponent(raw));
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400 });
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return NextResponse.json({ error: 'bad protocol' }, { status: 400 });
  }
  const host = target.hostname;
  if (isBlockedHost(host)) return NextResponse.json({ error: 'blocked host' }, { status: 403 });

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: refererFor(host, target),
      },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }
    // 行为白名单：只代理图片（Content-Type 或扩展名任一命中），其余一律 403
    const ctype = (upstream.headers.get('content-type') ?? '').toLowerCase();
    if (!ctype.startsWith('image/') && !IMG_EXT_RE.test(target.pathname)) {
      return NextResponse.json({ error: 'not an image' }, { status: 403 });
    }
    const headers = new Headers();
    headers.set('Content-Type', ctype || 'image/jpeg');
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
}
