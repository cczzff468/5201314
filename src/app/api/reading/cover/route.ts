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

/** 图片魔数嗅探（无 content-type 时判真图，拒绝 HTML 防盗链页） */
function isImageBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true; // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true; // AVIF/HEIC
  return false;
}

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
    let type = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    // 明确文本/HTML → 拒；无 content-type → 魔数嗅探（HTML 页伪装不了图片头）
    if (type.startsWith('text/') || type.includes('html') || type.includes('json')) {
      return NextResponse.json({ error: 'not image' }, { status: 415 });
    }
    if (!type.startsWith('image/')) {
      if (!isImageBytes(buf)) return NextResponse.json({ error: 'not image' }, { status: 415 });
      type = 'image/jpeg';
    }
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
