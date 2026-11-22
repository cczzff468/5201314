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

/** 封面地址实测：能取回 image/* 才算活链（超时 5s；GET 前 4KB 即可判活） */
async function verifyCoverUrl(url: string): Promise<boolean> {
  try {
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
    if (type && !type.startsWith('image/')) return false;
    // 读一小段确认不是防盗链占位 HTML（content-type 缺失时也走这步）
    const buf = await res.arrayBuffer();
    return buf.byteLength > 512;
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
  const cands = pool.slice(0, 5);
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
          const hit =
            books.find((b) => norm(b.name) === norm(name) && b.coverUrl) ||
            books.find((b) => b.coverUrl && (norm(b.name).includes(norm(name)) || norm(name).includes(norm(b.name))));
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

  // 已缓存的直接返回
  const rows = await db.featuredCover.findMany({ where: { name: { in: names } } });
  const covers: Record<string, { url: string; sid: string }> = {};
  for (const r of rows) covers[r.name] = { url: r.coverUrl, sid: r.sourceId };
  const missing = names.filter((n) => !covers[n]);
  if (!fill || !missing.length) {
    return NextResponse.json({ covers, pending: missing.length });
  }

  // 源池：启用 + 可用优先（封面解析不需要太多源，前 16 个够用）
  const poolRows = await db.bookSource.findMany({ where: { enabled: true } });
  poolRows.sort((a, b) => (a.checkStatus === 'ok' ? -1 : 0) - (b.checkStatus === 'ok' ? -1 : 0));
  const pool: PoolEntry[] = poolRows.slice(0, 16).map((r) => ({ legado: toLegado(r), id: r.id }));
  if (!pool.length) return NextResponse.json({ covers, pending: missing.length });

  // 限时补齐：9s 预算，6 本书并发；每本「源池轮转」分散压力
  const deadline = Date.now() + 9000;
  let cursor = 0;
  const worker = async () => {
    while (Date.now() < deadline) {
      const i = cursor++;
      if (i >= missing.length) return;
      const name = missing[i];
      // 源池轮转：每本书从不同起点开始，避免全压同一个源
      const rotated = [...pool.slice(i % pool.length), ...pool.slice(0, i % pool.length)];
      const got = await raceCover(name, rotated, Math.max(2500, deadline - Date.now()));
      if (got) {
        covers[name] = got;
        await db.featuredCover
          .upsert({ where: { name }, update: { coverUrl: got.url, sourceId: got.sid }, create: { name, coverUrl: got.url, sourceId: got.sid } })
          .catch(() => null);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

  const stillMissing = names.filter((n) => !covers[n]);
  return NextResponse.json({ covers, pending: stillMissing.length });
}
