import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 读书记忆/历史：GET ?bookUrl=（单书记忆） 或无参（全量里程碑 + 摘要流）
 * POST { action:'clear', bookUrl? , kind? }  清记忆（bookUrl 空=全部）
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bookUrl = sp.get('bookUrl');
  if (bookUrl) {
    const rows = await db.readingMemory.findMany({
      where: { bookUrl },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({
      memories: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        role: r.role,
        chapterIndex: r.chapterIndex,
        content: r.content,
        createdAt: r.createdAt,
      })),
    });
  }
  const milestones = await db.readingMemory.findMany({
    where: { kind: 'milestone' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const books = await db.shelfBook.findMany({ orderBy: [{ lastReadAt: 'desc' }], take: 50 });
  return NextResponse.json({
    milestones: milestones.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt })),
    books: books.map((b) => ({
      name: b.name,
      author: b.author,
      totalChapters: b.totalChapters,
      readChapters: b.lastReadChapter + 1,
      lastReadAt: b.lastReadAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.action || '') !== 'clear') return NextResponse.json({ error: '未知操作' }, { status: 400 });
  const bookUrl = body.bookUrl ? String(body.bookUrl) : undefined;
  const kind = body.kind ? String(body.kind) : undefined;
  await db.readingMemory.deleteMany({ where: { ...(bookUrl ? { bookUrl } : {}), ...(kind ? { kind } : {}) } });
  return NextResponse.json({ ok: true });
}
