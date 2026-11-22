import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 书籍封面代理：GET /api/reading/cover?u=<封面URL>&sid=<书源id>
 * ---------------------------------------------------------------------------
 * 笔趣阁等免费站点的封面普遍有防盗链（校验 Referer/UA），前端 <img> 直连会 403
 * 或被换成防盗链占位图。本路由在服务端按封面所在域名伪装 Referer + 浏览器 UA 抓图，
 * 二进制透传给前端（Content-Type 保留，长缓存），彻底绕开跨域/防盗链。
 */
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const u = sp.get('u') || '';
  const sid = sp.get('sid') || '';
  if (!/^https?:\/\//i.test(u)) return NextResponse.json({ error: 'bad url' }, { status: 400 });

  let referer: string | undefined;
  try {
    referer = new URL(u).origin + '/';
  } catch {
    referer = undefined;
  }
  // 书源可能自定义了 header（含 Referer/Cookie），优先用书源配置
  try {
    if (sid) {
      const row = await db.bookSource.findUnique({ where: { id: sid } });
      const headerRaw = row ? (JSON.parse(row.config || '{}') as { header?: string | Record<string, string> }).header : null;
      if (headerRaw) {
        const headers =
          typeof headerRaw === 'string'
            ? (JSON.parse(headerRaw || '{}') as Record<string, string>)
            : headerRaw;
        if (headers.Referer) referer = headers.Referer;
      }
    }
  } catch {
    /* 书源头解析失败，用默认 referer */
  }

  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return NextResponse.json({ error: 'not image' }, { status: 415 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
}
