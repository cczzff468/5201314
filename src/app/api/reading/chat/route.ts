import { NextRequest, NextResponse } from 'next/server';
import { companionChat } from '@/lib/reading/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * AI 陪读聊天：POST { bookUrl, book:{name,author,currentChapter,currentChapterTitle,totalChapters}, message, persona? }
 * 上下文注入策略见 src/lib/reading/ai.ts 头注释（只进摘要不进正文，Token 省流）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const bookUrl = String(body.bookUrl || '');
  const message = String(body.message || '').trim();
  const book = (body.book || {}) as Record<string, unknown>;
  if (!bookUrl || !message) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
  try {
    const reply = await companionChat({
      bookUrl,
      book: {
        name: String(book.name || '当前的书'),
        author: book.author ? String(book.author) : null,
        currentChapter: parseInt(String(book.currentChapter ?? '0'), 10) || 0,
        currentChapterTitle: String(book.currentChapterTitle || ''),
        totalChapters: parseInt(String(book.totalChapters ?? '0'), 10) || 0,
      },
      message,
      persona: body.persona ? String(body.persona) : undefined,
    });
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 90) : 'AI 伴读暂时不在，稍后再试' },
      { status: 500 },
    );
  }
}
