import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 阅读历史（历史 Tab）：所有打开读过的书（写入在 /api/reading/shelf 的 progress 里）
 * GET                          → { reads: [...] }（最近在前，最多 200 条）
 * POST { action:'remove', bookUrl }  从历史移除单本（本地书顺带删本地数据）
 *     { action:'removeMany', bookUrls } 多选批量移除
 *     { action:'clear' }             清空阅读历史
 *     { action:'toShelf', bookUrls } 批量加入书架（保留阅读进度 + 目录缓存）
 */
export async function GET() {
  const reads = await db.readHistory.findMany({
    orderBy: [{ lastReadAt: 'desc' }],
    take: 200,
  });
  return NextResponse.json({
    reads: reads.map((r) => ({
      id: r.id,
      name: r.name,
      author: r.author,
      coverUrl: r.coverUrl,
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      bookUrl: r.bookUrl,
      totalChapters: r.totalChapters,
      lastReadChapter: r.lastReadChapter,
      lastPage: r.lastPage,
      lastChapterTitle: r.lastChapterTitle,
      lastReadAt: r.lastReadAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || '');
  try {
    if (action === 'remove') {
      const bookUrl = String(body.bookUrl || '');
      // deleteMany 幂等：重复移除/不存在时不报错
      await db.readHistory.deleteMany({ where: { bookUrl } });
      // 本地书从历史移除 = 整本删除（本地书没有在线源，历史即唯一入口之外还有书架）
      if (bookUrl.startsWith('local:')) {
        const localId = bookUrl.slice('local:'.length);
        const inShelf = await db.shelfBook.findUnique({ where: { bookUrl } });
        if (!inShelf) {
          await db.localChapter.deleteMany({ where: { bookId: localId } }).catch(() => null);
          await db.localBook.deleteMany({ where: { id: localId } }).catch(() => null);
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'removeMany') {
      const urls = Array.isArray(body.bookUrls) ? (body.bookUrls as string[]).map(String) : [];
      if (urls.length) {
        await db.readHistory.deleteMany({ where: { bookUrl: { in: urls } } });
        for (const u of urls) {
          if (u.startsWith('local:')) {
            const localId = u.slice('local:'.length);
            const inShelf = await db.shelfBook.findUnique({ where: { bookUrl: u } });
            if (!inShelf) {
              await db.localChapter.deleteMany({ where: { bookId: localId } }).catch(() => null);
              await db.localBook.deleteMany({ where: { id: localId } }).catch(() => null);
            }
          }
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'clear') {
      await db.readHistory.deleteMany({});
      return NextResponse.json({ ok: true });
    }
    if (action === 'toShelf') {
      // 历史批量加入书架：保留进度/页码/章节标题 + 目录缓存（读过的书再点秒开）
      const urls = Array.isArray(body.bookUrls) ? (body.bookUrls as string[]).map(String) : [];
      let added = 0;
      for (const bookUrl of urls) {
        const h = await db.readHistory.findUnique({ where: { bookUrl } });
        if (!h) continue;
        let chapters: { title: string; url: string }[] = [];
        try {
          chapters = JSON.parse(h.chapters || '[]') as { title: string; url: string }[];
        } catch {
          chapters = [];
        }
        await db.shelfBook.upsert({
          where: { bookUrl },
          update: {
            name: h.name,
            author: h.author,
            coverUrl: h.coverUrl,
            sourceId: h.sourceId,
            sourceName: h.sourceName,
            ...(chapters.length ? { chapters: JSON.stringify(chapters) } : {}),
            totalChapters: h.totalChapters || chapters.length,
            lastChapterTitle: h.lastChapterTitle ?? undefined,
            lastReadChapter: h.lastReadChapter,
            lastPage: h.lastPage,
            lastReadAt: new Date(),
          },
          create: {
            name: h.name,
            author: h.author,
            coverUrl: h.coverUrl,
            sourceId: h.sourceId,
            sourceName: h.sourceName,
            bookUrl,
            chapters: JSON.stringify(chapters),
            totalChapters: h.totalChapters || chapters.length,
            lastChapterTitle: h.lastChapterTitle,
            lastReadChapter: h.lastReadChapter,
            lastPage: h.lastPage,
          },
        });
        added++;
      }
      return NextResponse.json({ ok: true, added });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
