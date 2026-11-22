import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { genChapterSummary } from '@/lib/reading/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 手动触发/获取章节摘要：POST { chapterUrl }
 * - 已有摘要直接返回（{ summary }）
 * - 没有则同步生成（约 2~6s；正常流程翻章时已后台静默生成，这里是兜底）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const chapterUrl = String(body.chapterUrl || '');
  if (!chapterUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
  const cached = await db.chapterCache.findUnique({ where: { chapterUrl } });
  if (cached?.summary) return NextResponse.json({ summary: cached.summary });
  if (!cached || !cached.content) return NextResponse.json({ summary: '' });
  const summary = await genChapterSummary({
    bookUrl: cached.bookUrl,
    chapterUrl,
    index: cached.chapterIndex,
    title: cached.title,
    content: cached.content,
  });
  return NextResponse.json({ summary });
}
