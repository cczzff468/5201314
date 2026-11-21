import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 阅读历史（历史 Tab）：所有打开读过的书（写入在 /api/reading/shelf 的 progress 里）
 * GET                → { reads: [...] }（最近在前，最多 200 条）
 * POST { action:'remove', bookUrl }  从历史移除单本
 *     { action:'clear' }             清空阅读历史
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
      // deleteMany 幂等：重复移除/不存在时不报错
      await db.readHistory.deleteMany({ where: { bookUrl: String(body.bookUrl || '') } });
      return NextResponse.json({ ok: true });
    }
    if (action === 'clear') {
      await db.readHistory.deleteMany({});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
