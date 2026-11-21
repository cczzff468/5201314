import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { searchBooks, type LegadoSource } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 精选书封面服务端缓存：
 * GET /api/reading/featured-covers?names=书名A,书名B&fill=1
 * ---------------------------------------------------------------------------
 * - 命中：FeaturedCover 表里的封面直接返回（永久缓存，全设备共享）
 * - 未命中 + fill=1：服务端并发搜书源（可用源优先），谁先返回带封面的同名书用谁，
 *   结果落库；整轮请求限时 ~9s（客户端轮询补齐，不强求一次全出）
 * 返回 { covers: { 书名: {url, sid} }, pending: 未取到的数量 }
 */

const norm = (s: string) => s.replace(/\s+/g, '');

interface PoolEntry {
  legado: LegadoSource;
  id: string;
}

/** 给一本书在源池里抢封面：并发试前几个源，第一个「同名 + 带封面」的结果胜出 */
function raceCover(name: string, pool: PoolEntry[], timeoutMs = 8000): Promise<{ url: string; sid: string } | null> {
  const cands = pool.slice(0, 4);
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
        .then((books) => {
          if (settled) return;
          const hit =
            books.find((b) => norm(b.name) === norm(name) && b.coverUrl) ||
            books.find((b) => b.coverUrl && (norm(b.name).includes(norm(name)) || norm(name).includes(norm(b.name))));
          if (hit?.coverUrl) finish({ url: hit.coverUrl, sid: src.id });
          else if (--pending <= 0) finish(null);
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
  if (!names.length) return NextResponse.json({ covers: {}, pending: 0 });

  // 已缓存的直接返回
  const rows = await db.featuredCover.findMany({ where: { name: { in: names } } });
  const covers: Record<string, { url: string; sid: string }> = {};
  for (const r of rows) covers[r.name] = { url: r.coverUrl, sid: r.sourceId };
  const missing = names.filter((n) => !covers[n]);
  if (!fill || !missing.length) {
    return NextResponse.json({ covers, pending: missing.length });
  }

  // 源池：启用 + 可用优先（封面解析不需要太多源，前 12 个够用）
  const poolRows = await db.bookSource.findMany({ where: { enabled: true } });
  poolRows.sort((a, b) => (a.checkStatus === 'ok' ? -1 : 0) - (b.checkStatus === 'ok' ? -1 : 0));
  const pool: PoolEntry[] = poolRows.slice(0, 12).map((r) => ({ legado: toLegado(r), id: r.id }));
  if (!pool.length) return NextResponse.json({ covers, pending: missing.length });

  // 限时补齐：9s 预算，4 本书并发；每本「源池轮转」分散压力
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
  await Promise.all([worker(), worker(), worker(), worker()]);

  const stillMissing = names.filter((n) => !covers[n]);
  return NextResponse.json({ covers, pending: stillMissing.length });
}
