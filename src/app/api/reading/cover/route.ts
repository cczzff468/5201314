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

/* ---------------------------------------------------------------------------
 * 进程内封面字节缓存（第七轮「封面太慢」）：
 * 同一封面地址的多组件/多设备重复请求直接内存回拷（毫秒级），不再重复回源。
 * 上限 300 张 / 单张 6 小时（防盗链封面地址基本不变，过期重拉即可）。
 * ------------------------------------------------------------------------- */
const MEM_CACHE_MAX = 300;
const MEM_CACHE_TTL = 6 * 60 * 60 * 1000;
const memCache = new Map<string, { buf: ArrayBuffer; type: string; at: number }>();

function cacheGet(key: string): { buf: ArrayBuffer; type: string } | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_CACHE_TTL) {
    memCache.delete(key);
    return null;
  }
  return { buf: hit.buf, type: hit.type };
}

function cacheSet(key: string, buf: ArrayBuffer, type: string) {
  if (buf.byteLength > 2 * 1024 * 1024) return; // 超大图不缓存（省内存）
  memCache.set(key, { buf, type, at: Date.now() });
  if (memCache.size > MEM_CACHE_MAX) {
    // 淘汰最旧的一半（插入序即最旧在前）
    const drop = memCache.size - Math.floor(MEM_CACHE_MAX / 2);
    let i = 0;
    for (const k of memCache.keys()) {
      if (i++ >= drop) break;
      memCache.delete(k);
    }
  }
}

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
    // 进程内缓存命中：毫秒级回拷，不回源（第七轮封面提速）
    const cached = cacheGet(u);
    if (cached) {
      return new NextResponse(cached.buf, {
        status: 200,
        headers: {
          'Content-Type': cached.type,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }
    const res = await fetch(u, {
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
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
    cacheSet(u, buf, type);
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
