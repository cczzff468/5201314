import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 书架管理：
 * GET  → { books: [...] }（最近在读在前）
 * POST { action:'add', book }        加入书架（upsert by bookUrl）
 *     { action:'progress', bookUrl, chapter, chapterTitle }  更新阅读进度
 *     { action:'remove', bookUrl }   移出书架
 *     { action:'updateToc', bookUrl, chapters, lastChapter }  刷新目录缓存（检查更新用）
 *     { action:'switchSource', name, author, book }  换源：按书名+作者找到书架记录，
 *         迁移到新书源（sourceId/sourceName/bookUrl/目录），保留阅读进度
 */
export async function GET() {
  const books = await db.shelfBook.findMany({
    orderBy: [{ lastReadAt: 'desc' }],
    take: 200,
  });
  return NextResponse.json({
    books: books.map((b) => ({
      id: b.id,
      name: b.name,
      author: b.author,
      coverUrl: b.coverUrl,
      intro: b.intro,
      sourceId: b.sourceId,
      sourceName: b.sourceName,
      bookUrl: b.bookUrl,
      totalChapters: b.totalChapters,
      lastChapterTitle: b.lastChapterTitle,
      lastReadChapter: b.lastReadChapter,
      lastReadAt: b.lastReadAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || '');
  try {
    if (action === 'add') {
      const b = (body.book || {}) as Record<string, unknown>;
      const bookUrl = String(b.bookUrl || '');
      if (!bookUrl) return NextResponse.json({ error: '缺少 bookUrl' }, { status: 400 });
      const chapters = Array.isArray(b.chapters) ? (b.chapters as { title: string; url: string }[]) : [];
      const row = await db.shelfBook.upsert({
        where: { bookUrl },
        update: {
          name: String(b.name || ''),
          author: b.author ? String(b.author) : null,
          coverUrl: b.coverUrl ? String(b.coverUrl) : null,
          intro: b.intro ? String(b.intro) : null,
          sourceId: String(b.sourceId || ''),
          sourceName: b.sourceName ? String(b.sourceName) : null,
          chapters: JSON.stringify(chapters),
          totalChapters: chapters.length,
          lastChapterTitle: chapters.length ? chapters[chapters.length - 1].title : null,
          lastReadAt: new Date(),
        },
        create: {
          name: String(b.name || '未命名'),
          author: b.author ? String(b.author) : null,
          coverUrl: b.coverUrl ? String(b.coverUrl) : null,
          intro: b.intro ? String(b.intro) : null,
          sourceId: String(b.sourceId || ''),
          sourceName: b.sourceName ? String(b.sourceName) : null,
          bookUrl,
          chapters: JSON.stringify(chapters),
          totalChapters: chapters.length,
          lastChapterTitle: chapters.length ? chapters[chapters.length - 1].title : null,
        },
      });
      return NextResponse.json({ id: row.id, ok: true });
    }
    if (action === 'progress') {
      const bookUrl = String(body.bookUrl || '');
      const chapter = parseInt(String(body.chapter ?? '0'), 10) || 0;
      const chapterTitle = body.chapterTitle ? String(body.chapterTitle) : null;
      const exist = await db.shelfBook.findUnique({ where: { bookUrl } });
      if (!exist) {
        // 不在书架的书直接读：自动入架（阅读器典型行为——读过的书进书架）
        const b = (body.book || {}) as Record<string, unknown>;
        if (typeof b.name === 'string' && b.name) {
          await db.shelfBook.create({
            data: {
              name: b.name,
              author: b.author ? String(b.author) : null,
              coverUrl: b.coverUrl ? String(b.coverUrl) : null,
              sourceId: String(b.sourceId || ''),
              sourceName: b.sourceName ? String(b.sourceName) : null,
              bookUrl,
              chapters: JSON.stringify(Array.isArray(b.chapters) ? b.chapters : []),
              totalChapters: Array.isArray(b.chapters) ? (b.chapters as unknown[]).length : 0,
              lastReadChapter: chapter,
              lastChapterTitle: chapterTitle,
            },
          });
        }
      } else {
        await db.shelfBook.update({
          where: { bookUrl },
          data: { lastReadChapter: chapter, lastChapterTitle: chapterTitle ?? undefined, lastReadAt: new Date() },
        });
      }
      // 里程碑记忆：每 100 章记一条（AI 陪读长期记忆素材）
      const shelf = await db.shelfBook.findUnique({ where: { bookUrl } });
      if (shelf) {
        const ch = shelf.lastReadChapter + 1;
        if (ch % 100 === 0) {
          await db.readingMemory.create({
            data: {
              bookUrl,
              kind: 'milestone',
              chapterIndex: shelf.lastReadChapter,
              content: `《${shelf.name}》读到了第${ch}章（${shelf.lastChapterTitle || ''}），全书共${shelf.totalChapters}章`,
            },
          });
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'remove') {
      await db.shelfBook.delete({ where: { bookUrl: String(body.bookUrl || '') } });
      return NextResponse.json({ ok: true });
    }
    if (action === 'updateToc') {
      const bookUrl = String(body.bookUrl || '');
      const chapters = Array.isArray(body.chapters) ? (body.chapters as { title: string; url: string }[]) : [];
      if (chapters.length) {
        await db.shelfBook.update({
          where: { bookUrl },
          data: {
            chapters: JSON.stringify(chapters),
            totalChapters: chapters.length,
            lastChapterTitle: chapters[chapters.length - 1].title,
          },
        });
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'switchSource') {
      // 书籍详情页「换源」：按书名+作者找到书架中的书，整体迁到新源（进度章节下标保留，
      // 阅读器打开时按章节标题映射回新目录；不在书架则普通入库）
      const name = String(body.name || '').trim();
      const author = body.author ? String(body.author).trim() : '';
      const b = (body.book || {}) as Record<string, unknown>;
      const newBookUrl = String(b.bookUrl || '');
      if (!name || !newBookUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
      const chapters = Array.isArray(b.chapters) ? (b.chapters as { title: string; url: string }[]) : [];
      const all = await db.shelfBook.findMany({ where: { name } });
      const target =
        all.find((x) => (x.author || '').trim() === author && x.bookUrl !== newBookUrl) || null;
      if (target) {
        // 旧记录换到新源；同名新源已存在记录则删除旧的避免重复
        await db.shelfBook.update({
          where: { id: target.id },
          data: {
            sourceId: String(b.sourceId || ''),
            sourceName: b.sourceName ? String(b.sourceName) : null,
            bookUrl: newBookUrl,
            coverUrl: b.coverUrl ? String(b.coverUrl) : target.coverUrl,
            chapters: JSON.stringify(chapters),
            totalChapters: chapters.length,
            lastChapterTitle: chapters.length ? chapters[chapters.length - 1].title : null,
            lastReadAt: new Date(),
          },
        });
      } else {
        await db.shelfBook.upsert({
          where: { bookUrl: newBookUrl },
          update: {
            sourceId: String(b.sourceId || ''),
            sourceName: b.sourceName ? String(b.sourceName) : null,
            chapters: JSON.stringify(chapters),
            totalChapters: chapters.length,
          },
          create: {
            name,
            author: author || null,
            coverUrl: b.coverUrl ? String(b.coverUrl) : null,
            intro: b.intro ? String(b.intro) : null,
            sourceId: String(b.sourceId || ''),
            sourceName: b.sourceName ? String(b.sourceName) : null,
            bookUrl: newBookUrl,
            chapters: JSON.stringify(chapters),
            totalChapters: chapters.length,
            lastChapterTitle: chapters.length ? chapters[chapters.length - 1].title : null,
          },
        });
      }
      // 清理可能残留的同名旧记录（不同 bookUrl）
      const dups = await db.shelfBook.findMany({ where: { name } });
      const keep = dups.find((x) => x.bookUrl === newBookUrl);
      if (keep && dups.length > 1) {
        await db.shelfBook.deleteMany({
          where: { name, id: { not: keep.id } },
        });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
