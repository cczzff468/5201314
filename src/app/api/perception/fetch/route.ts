import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * 感知数据代理（ActivityWatch / 屏幕串流地址 → 云端服务器代取 + CORS 放行）：
 *
 * 浏览器直连用户手机上的服务会被 CORS 拦（aw-server 默认只放行 localhost origin），
 * 本路由由服务器代取并加 Access-Control-Allow-Origin: * —— 适用于「内网穿透/公网可达」
 * 的地址。对 MJPEG 流（multipart/x-mixed-replace）服务端读字节流切出第一张完整 JPEG 帧
 * 即返回（避免无限流挂死）；其余类型（JSON/单帧图）原样透传，3MB 上限。
 */

const TIMEOUT_MS = 5000;
const MAX_PASSTHROUGH = 3 * 1024 * 1024;
const MAX_STREAM_SCAN = 6 * 1024 * 1024;

/** 在已累积字节里找第一张完整 JPEG（SOI FFD8 → EOI FFD9） */
function cutJpeg(buf: Uint8Array): { start: number; end: number } | null {
  const soi = buf.findIndex((b, i) => b === 0xff && buf[i + 1] === 0xd8);
  if (soi < 0) return null;
  for (let i = soi + 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return { start: soi, end: i + 2 };
  }
  return null;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'url 参数无效' }, { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: '仅支持 http/https 地址' }, { status: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target.toString(), {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'image/jpeg, image/*, application/json, text/*, */*' },
    });
    const ctype = (upstream.headers.get('content-type') || '').toLowerCase();

    // MJPEG 流：服务端切出第一帧 JPEG 即返回
    if (ctype.includes('multipart') || ctype.includes('x-mixed-replace')) {
      if (!upstream.body) {
        return NextResponse.json({ error: '上游无响应体' }, { status: 502 });
      }
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        total += value.length;
        const merged = concat(chunks, total);
        const frame = cutJpeg(merged);
        if (frame) {
          void reader.cancel().catch(() => undefined);
          const slice = merged.slice(frame.start, frame.end);
          return new NextResponse(slice, {
            status: 200,
            headers: {
              'content-type': 'image/jpeg',
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
            },
          });
        }
        if (total > MAX_STREAM_SCAN) {
          void reader.cancel().catch(() => undefined);
          return NextResponse.json({ error: '流中未找到 JPEG 帧' }, { status: 502 });
        }
      }
      return NextResponse.json({ error: '流结束但未找到 JPEG 帧' }, { status: 502 });
    }

    // 其余（JSON / 单帧图 / 文本）：原样透传 + CORS 放行
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_PASSTHROUGH) {
      return NextResponse.json({ error: '响应过大' }, { status: 502 });
    }
    return new NextResponse(buf, {
      status: upstream.status,
      headers: {
        'content-type': ctype || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: '无法访问目标地址（超时或网络不可达）' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
