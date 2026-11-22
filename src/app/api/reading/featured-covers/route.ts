import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { searchBooks, type LegadoSource } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 精选书封面服务端缓存：
 * GET /api/reading/featured-covers?names=书名A,书名B&fill=1&retry=书名C
 * ---------------------------------------------------------------------------
 * - 命中：FeaturedCover 表里的封面直接返回（永久缓存，全设备共享）
 * - 未命中 + fill=1：服务端并发搜书源（可用源优先），谁先返回「同名 + 带封面 + 封面实测可加载」
 *   的结果用谁（缓存前先抓一次图验证，杜绝死链入库），结果落库；
 *   整轮请求限时 ~9s（客户端轮询补齐，不强求一次全出）
 * - retry=书名：该书旧缓存先删再重搜（客户端图片加载失败时换一个封面地址）
 * 返回 { covers: { 书名: {url, sid} }, pending: 未取到的数量 }
 */

const norm = (s: string) => s.replace(/\s+/g, '');

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

/** 图片魔数嗅探：二进制头判断真图（JPEG/PNG/GIF/BMP/WEBP/AVIF），拒绝 HTML 防盗链页 */
function isImageBytes(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true; // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true; // AVIF/HEIC (ftyp)
  return false;
}

/** 封面地址实测：眞图才入库（content-type 优先，缺失时魔数嗅探；HTML 一律拒） */
async function verifyCoverUrl(url: string): Promise<boolean> {
  try {
    // 明显是网页地址的直接拒（不用浪费一次请求）
    if (/\.html?($|\?)/i.test(url) || /\/(txt|book|info|html)\/\d+\.html/i.test(url)) return false;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: new URL(url).origin + '/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength <= 512) return false;
    // 明确文本/HTML → 拒（防盗链占位页）
    if (type.startsWith('text/') || type.includes('html') || type.includes('json')) return false;
    // 明确图片 → 过
    if (type.startsWith('image/')) return true;
    // 无 content-type → 魔数嗅探（HTML 过不了）
    return isImageBytes(buf);
  } catch {
    return false;
  }
}

interface PoolEntry {
  legado: LegadoSource;
  id: string;
}

/**
 * 给一本书在源池里抢封面：并发试前几个源，第一个「同名 + 带封面 + 封面可加载」的结果胜出。
 * 拿到候选先实测封面地址，死链继续等下一个源（都失败返回 null）。
 */
function raceCover(name: string, pool: PoolEntry[], timeoutMs = 8000): Promise<{ url: string; sid: string } | null> {
  const cands = pool.slice(0, 7);
  if (!cands.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let pending = cands.length;
    const finish = (v: { url: string; sid: string } | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    for (const src of cands) {
      searchBooks(src.legado, name)
        .then(async (books) => {
          if (settled) return;
          // .html 结尾的一律是网页不是图，直接过滤掉
          const okCover = (u: string) => !/\.html?($|\?)/i.test(u);
          const hit =
            books.find((b) => norm(b.name) === norm(name) && b.coverUrl && okCover(b.coverUrl)) ||
            books.find((b) => b.coverUrl && okCover(b.coverUrl) && (norm(b.name).includes(norm(name)) || norm(name).includes(norm(b.name))));
          if (hit?.coverUrl) {
            // 实测封面地址可加载才采纳；死链 → 等其它源
            if (await verifyCoverUrl(hit.coverUrl)) finish({ url: hit.coverUrl, sid: src.id });
            else if (!settled && --pending <= 0) finish(null);
          } else if (--pending <= 0) finish(null);
        })
        .catch(() => {
          if (!settled && --pending <= 0) finish(null);
        });
    }
  });
}

/** 补齐失败退避：近期搜不到封面的书 90s 内不再浪费源请求（防止客户端 3s 轮询反复压榨死源） */
const fillFailedAt = new Map<string, number>();
const FAIL_BACKOFF_MS = 90_000;
/** 正在后台补齐的书名（客户端据此判断要不要继续轮询） */
const fillingNow = new Set<string>();

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const names = (sp.get('names') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  const fill = sp.get('fill') === '1';
  // retry：这些书名旧缓存先删再重搜（换封面地址）
  const retry = new Set(
    (sp.get('retry') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (!names.length) return NextResponse.json({ covers: {}, pending: 0 });

  // retry 的先删旧缓存（含已命中的）
  if (retry.size) {
    const del = names.filter((n) => retry.has(n));
    if (del.length) await db.featuredCover.deleteMany({ where: { name: { in: del } } }).catch(() => null);
  }

  // 已缓存的直接返回（秒回！补齐在后台异步跑，客户端下轮轮询拿到结果）
  const rows = await db.featuredCover.findMany({ where: { name: { in: names } } });
  const covers: Record<string, { url: string; sid: string }> = {};
  for (const r of rows) covers[r.name] = { url: r.coverUrl, sid: r.sourceId };

  // retry 的书名清除退避（用户手动重试允许立即重搜）
  for (const n of retry) fillFailedAt.delete(n);

  // 退避中的书不算 pending（客户端停止轮询，避免无限空转）
  const now = Date.now();
  const notCached = names.filter((n) => !covers[n]);
  const inflight = notCached.filter((n) => fillingNow.has(n));
  const backedOff = notCached.filter((n) => !fillingNow.has(n) && now - (fillFailedAt.get(n) || 0) <= FAIL_BACKOFF_MS);
  const todo = notCached.filter((n) => !fillingNow.has(n) && now - (fillFailedAt.get(n) || 0) > FAIL_BACKOFF_MS);
  if (!fill || !todo.length) {
    // inflight 的书下轮轮询会拿到；backedOff 的书短期内不会有结果，不计 pending
    return NextResponse.json({ covers, pending: inflight.length });
  }
  // 先登记「填充中」（同步完成，避免并发请求重复补齐），响应仍秒回
  for (const n of todo) fillingNow.add(n);

  // 源池：启用 + 可用优先（封面解析不嫌源多，前 24 个轮转着用）
  const poolRows = await db.bookSource.findMany({ where: { enabled: true } });
  poolRows.sort((a, b) => (a.checkStatus === 'ok' ? -1 : 0) - (b.checkStatus === 'ok' ? -1 : 0));
  const pool: PoolEntry[] = poolRows.slice(0, 24).map((r) => ({ legado: toLegado(r), id: r.id }));
  if (!pool.length) {
    for (const n of todo) fillingNow.delete(n);
    return NextResponse.json({ covers, pending: inflight.length + todo.length });
  }

  // 先把已缓存的结果立刻返回（不等补齐 —— 首屏封面秒出）
  const responseCovers = { ...covers };

  // 后台补齐（不 await：响应立即送达，补齐落库后客户端下轮轮询秒回拿到）
  void (async () => {
    const deadline = Date.now() + 9000;
    let cursor = 0;
    const worker = async () => {
      while (Date.now() < deadline) {
        const i = cursor++;
        if (i >= todo.length) return;
        const name = todo[i];
        // 源池轮转：每本书从不同起点开始，避免全压同一个源
        const rotated = [...pool.slice(i % pool.length), ...pool.slice(0, i % pool.length)];
        const got = await raceCover(name, rotated, Math.max(2500, deadline - Date.now()));
        if (got) {
          await db.featuredCover
            .upsert({ where: { name }, update: { coverUrl: got.url, sourceId: got.sid }, create: { name, coverUrl: got.url, sourceId: got.sid } })
            .catch(() => null);
        } else {
          fillFailedAt.set(name, Date.now());
        }
        fillingNow.delete(name);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    // 兜底：超时未处理到的书也清出 inflight（否则客户端会一直空轮询等它们）
    for (const n of todo) fillingNow.delete(n);
  })();

  return NextResponse.json({ covers: responseCovers, pending: inflight.length + todo.length });
}
