import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { searchBooks } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 聚合搜索单源接口（客户端逐源并发调用，天然支持暂停/继续与增量渲染）：
 * POST { keyword, sourceId }
 * 返回 { books: SearchBook[] } 或 { error }（单源失败不影响整体）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { keyword?: string; sourceId?: string };
  const keyword = (body.keyword || '').trim().slice(0, 40);
  if (!keyword) return NextResponse.json({ error: '关键词为空' }, { status: 400 });
  const sourceId = String(body.sourceId || '');
  const row = await db.bookSource.findUnique({ where: { id: sourceId } });
  if (!row) return NextResponse.json({ error: '书源不存在' }, { status: 404 });
  try {
    const t0 = Date.now();
    const books = await searchBooks(toLegado(row), keyword);
    return NextResponse.json({
      books: books.slice(0, 20).map((b) => ({ ...b, sourceId })),
      ms: Date.now() - t0,
      sourceName: row.name,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 80) : '搜索失败', sourceName: row.name },
      { status: 200 },
    );
  }
}
