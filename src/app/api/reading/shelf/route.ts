import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 书架管理（按书源区分，bookUrl 为源内唯一键）：
 * GET  → { books: [...] }（最近在读在前，含 customGroup / lastPage）
 * POST { action:'add', book }        加入书架（upsert by bookUrl；仅点击「加入书架」才走这里）
 *     { action:'progress', bookUrl, chapter, page, chapterTitle }  更新阅读进度
 *         —— 只更新已在书架的书（不再自动入架）；同时把进度写入 ReadHistory（历史 Tab）
 *     { action:'remove', bookUrls }  移出书架（单本/多本；历史记录不受影响）
 *     { action:'setGroup', bookUrls, group }  转移分组（group=null 表示未分组）
 *     { action:'updateToc', bookUrl, chapters, lastChapter }  刷新目录缓存（检查更新用）
 *     { action:'switchSource', name, author, book }  换源：按书名+作者找到书架记录，
 *         迁移到新书源（sourceId/sourceName/bookUrl/目录），保留阅读进度
 */

interface TocChapter {
  title: string;
  url: string;
}

/** 进度写入阅读历史（ReadHistory；打开读过的书都记录，独立于书架） */
async function upsertHistory(p: {
  bookUrl: string;
  name: string;
  author?: string | null;
  coverUrl?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  totalChapters?: number;
  chapter: number;
  page?: number;
  chapterTitle?: string | null;
}) {
  if (!p.bookUrl || !p.name) return;
  await db.readHistory.upsert({
    where: { bookUrl: p.bookUrl },
    update: {
      lastReadChapter: p.chapter,
      lastPage: p.page ?? 0,
      lastChapterTitle: p.chapterTitle ?? undefined,
      lastReadAt: new Date(),
      totalChapters: p.totalChapters ?? undefined,
      coverUrl: p.coverUrl ?? undefined,
      sourceId: p.sourceId ?? undefined,
      sourceName: p.sourceName ?? undefined,
    },
    create: {
      name: p.name,
      author: p.author || null,
      coverUrl: p.coverUrl || null,
      sourceId: p.sourceId || '',
      sourceName: p.sourceName || null,
      bookUrl: p.bookUrl,
      totalChapters: p.totalChapters || 0,
      lastReadChapter: p.chapter,
      lastPage: p.page ?? 0,
      lastChapterTitle: p.chapterTitle || null,
    },
  }).catch(() => null);
}

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
      customGroup: b.customGroup,
      totalChapters: b.totalChapters,
      lastChapterTitle: b.lastChapterTitle,
      lastReadChapter: b.lastReadChapter,
      lastPage: b.lastPage,
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
      const chapters = Array.isArray(b.chapters) ? (b.chapters as TocChapter[]) : [];
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
      // 可选进度/统计字段（从历史「加入书架」时带上，保留阅读进度）
      const progress = {
        ...(num(b.lastReadChapter) !== undefined ? { lastReadChapter: num(b.lastReadChapter) as number } : {}),
        ...(num(b.lastPage) !== undefined ? { lastPage: num(b.lastPage) as number } : {}),
        ...(b.lastChapterTitle ? { lastChapterTitle: String(b.lastChapterTitle) } : {}),
        ...(num(b.totalChapters) !== undefined ? { totalChapters: num(b.totalChapters) as number } : {}),
        ...(b.customGroup ? { customGroup: String(b.customGroup).slice(0, 20) } : {}),
      };
      const row = await db.shelfBook.upsert({
        where: { bookUrl },
        update: {
          name: String(b.name || ''),
          author: b.author ? String(b.author) : null,
          coverUrl: b.coverUrl ? String(b.coverUrl) : null,
          intro: b.intro ? String(b.intro) : null,
          sourceId: String(b.sourceId || ''),
          sourceName: b.sourceName ? String(b.sourceName) : null,
          ...(chapters.length ? { chapters: JSON.stringify(chapters), totalChapters: chapters.length } : {}),
          ...(chapters.length ? { lastChapterTitle: chapters[chapters.length - 1].title } : {}),
          ...progress,
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
          customGroup: b.customGroup ? String(b.customGroup) : null,
          chapters: JSON.stringify(chapters),
          totalChapters: chapters.length,
          lastChapterTitle: chapters.length ? chapters[chapters.length - 1].title : null,
          ...progress,
        },
      });
      return NextResponse.json({ id: row.id, ok: true });
    }
    if (action === 'progress') {
      const bookUrl = String(body.bookUrl || '');
      const chapter = parseInt(String(body.chapter ?? '0'), 10) || 0;
      const page = parseInt(String(body.page ?? '0'), 10) || 0;
      const chapterTitle = body.chapterTitle ? String(body.chapterTitle) : null;
      const b = (body.book || {}) as Record<string, unknown>;
      // ① 书架：只在已在架时更新进度（点击「加入书架」才入架——不再自动入架）
      const exist = await db.shelfBook.findUnique({ where: { bookUrl } });
      if (exist) {
        await db.shelfBook.update({
          where: { bookUrl },
          data: {
            lastReadChapter: chapter,
            lastPage: page,
            lastChapterTitle: chapterTitle ?? undefined,
            lastReadAt: new Date(),
          },
        });
        // 里程碑记忆：每 100 章记一条（AI 陪读长期记忆素材）
        const ch = chapter + 1;
        if (ch % 100 === 0) {
          await db.readingMemory.create({
            data: {
              bookUrl,
              kind: 'milestone',
              chapterIndex: chapter,
              content: `《${exist.name}》读到了第${ch}章（${chapterTitle || ''}），全书共${exist.totalChapters}章`,
            },
          }).catch(() => null);
        }
      }
      // ② 阅读历史：只要读过就记录（历史 Tab 展示；与书架独立）
      if (typeof b.name === 'string' && b.name) {
        await upsertHistory({
          bookUrl,
          name: b.name,
          author: b.author ? String(b.author) : null,
          coverUrl: b.coverUrl ? String(b.coverUrl) : null,
          sourceId: b.sourceId ? String(b.sourceId) : null,
          sourceName: b.sourceName ? String(b.sourceName) : null,
          totalChapters:
            typeof b.totalChapters === 'number'
              ? b.totalChapters
              : Array.isArray(b.chapters)
                ? (b.chapters as unknown[]).length
                : undefined,
          chapter,
          page,
          chapterTitle,
        });
      }
      return NextResponse.json({ ok: true, inShelf: !!exist });
    }
    if (action === 'remove') {
      // 单本（bookUrl）或多本（bookUrls[]）
      const urls = Array.isArray(body.bookUrls)
        ? (body.bookUrls as string[]).map(String)
        : body.bookUrl
          ? [String(body.bookUrl)]
          : [];
      if (urls.length) await db.shelfBook.deleteMany({ where: { bookUrl: { in: urls } } });
      // 本地书：顺带删本地数据（LocalBook/LocalChapter）
      for (const u of urls) {
        if (u.startsWith('local:')) {
          const localId = u.slice('local:'.length);
          await db.localChapter.deleteMany({ where: { bookId: localId } }).catch(() => null);
          await db.localBook.deleteMany({ where: { id: localId } }).catch(() => null);
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'setGroup') {
      const urls = Array.isArray(body.bookUrls) ? (body.bookUrls as string[]).map(String) : [];
      const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim().slice(0, 20) : null;
      if (urls.length) {
        await db.shelfBook.updateMany({
          where: { bookUrl: { in: urls } },
          data: { customGroup: group },
        });
      }
      return NextResponse.json({ ok: true });
    }
    if (action === 'updateToc') {
      const bookUrl = String(body.bookUrl || '');
      const chapters = Array.isArray(body.chapters) ? (body.chapters as TocChapter[]) : [];
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
      const chapters = Array.isArray(b.chapters) ? (b.chapters as TocChapter[]) : [];
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
      // 阅读历史也迁移到新源（同书换源后历史指向新源）
      await upsertHistory({
        bookUrl: newBookUrl,
        name,
        author,
        coverUrl: b.coverUrl ? String(b.coverUrl) : null,
        sourceId: String(b.sourceId || ''),
        sourceName: b.sourceName ? String(b.sourceName) : null,
        totalChapters: chapters.length,
        chapter: 0,
        page: 0,
      }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
