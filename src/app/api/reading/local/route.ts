import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from '@/lib/db';
import { parseEpubBook, parseTxtBook } from '@/lib/reading/local-parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 本地书籍导入（txt / epub，从手机上传）：
 * GET    ?bookId=xxx&idx=3（或 ?bookUrl=local:xxx&idx=3）→ { title, content } 读本地章节正文
 * POST   multipart FormData（file 字段，≤ 20MB）→ 解析入库 LocalBook + LocalChapter，
 *        并自动加入书架（ShelfBook，bookUrl = local:{id}，章节 url = local:{id}:{idx}）
 * DELETE ?bookUrl=local:xxx → 删除本地章节 / 本地书 / 书架记录（顺带清理封面文件）
 */

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idx = parseInt(sp.get('idx') || '', 10);
  let bookId = sp.get('bookId') || '';
  const bookUrl = sp.get('bookUrl') || '';
  if (!bookId && bookUrl.startsWith('local:')) bookId = bookUrl.slice('local:'.length);
  if (!bookId || Number.isNaN(idx)) {
    return NextResponse.json({ error: '参数缺失' }, { status: 400 });
  }
  try {
    const ch = await db.localChapter.findUnique({ where: { bookId_idx: { bookId, idx } } });
    if (!ch) return NextResponse.json({ error: '章节不存在' }, { status: 404 });
    return NextResponse.json({ title: ch.title, content: ch.content });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '读取失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // ① 取文件 + 校验
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: '缺少文件（file 字段）' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '文件太大（上限 20MB）' }, { status: 400 });
    }
    const ext = path.extname(file.name).toLowerCase();
    if (ext !== '.txt' && ext !== '.epub') {
      return NextResponse.json({ error: '仅支持 txt / epub 文件' }, { status: 400 });
    }

    // ② 解析
    const buf = Buffer.from(await file.arrayBuffer());
    const book = ext === '.txt' ? parseTxtBook(buf, file.name) : parseEpubBook(buf, file.name);
    if (book.chapters.length === 0) {
      return NextResponse.json({ error: '解析失败：没有读到内容' }, { status: 400 });
    }
    const name = book.name.trim() || '本地书籍';

    // ③ 本地书入库（封面落盘 public/reading-covers/{id}.{ext}）
    const localBook = await db.localBook.create({
      data: {
        name,
        author: book.author,
        intro: book.intro,
        totalChapters: book.chapters.length,
        fileName: file.name,
      },
    });
    let coverUrl: string | null = null;
    if (book.coverBuf && book.coverExt) {
      try {
        const dir = path.join(process.cwd(), 'public', 'reading-covers');
        await fs.mkdir(dir, { recursive: true });
        const fileName = `${localBook.id}.${book.coverExt}`;
        await fs.writeFile(path.join(dir, fileName), book.coverBuf);
        coverUrl = `/reading-covers/${fileName}`;
        await db.localBook.update({ where: { id: localBook.id }, data: { coverUrl } });
      } catch {
        coverUrl = null; // 封面写盘失败不影响导入
      }
    }

    // ④ 章节正文分批入库（id = {bookId}:{idx}）
    const rows = book.chapters.map((c, i) => ({
      id: `${localBook.id}:${i}`,
      bookId: localBook.id,
      idx: i,
      title: c.title || `第${i + 1}章`,
      content: c.content,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      await db.localChapter.createMany({ data: rows.slice(i, i + 100) });
    }

    // ⑤ 自动加入书架（bookUrl = local:{id}，目录缓存 JSON）
    await db.shelfBook.create({
      data: {
        name,
        author: book.author,
        coverUrl,
        intro: book.intro,
        sourceId: 'local',
        sourceName: '本地导入',
        bookUrl: `local:${localBook.id}`,
        chapters: JSON.stringify(
          book.chapters.map((c, i) => ({ title: c.title, url: `local:${localBook.id}:${i}` })),
        ),
        totalChapters: book.chapters.length,
        lastChapterTitle: book.chapters[book.chapters.length - 1].title,
        lastReadAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, id: localBook.id, name, chapters: book.chapters.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '导入失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bookUrl = sp.get('bookUrl') || '';
  if (!bookUrl.startsWith('local:')) {
    return NextResponse.json({ error: '参数缺失' }, { status: 400 });
  }
  const bookId = bookUrl.slice('local:'.length);
  try {
    await db.localChapter.deleteMany({ where: { bookId } });
    const local = await db.localBook.findUnique({ where: { id: bookId } });
    if (local?.coverUrl?.startsWith('/reading-covers/')) {
      // 尽力清理封面文件（失败不影响删除）
      await fs
        .unlink(path.join(process.cwd(), 'public', local.coverUrl))
        .catch(() => null);
    }
    await db.localBook.deleteMany({ where: { id: bookId } });
    await db.shelfBook.deleteMany({ where: { bookUrl } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '删除失败' }, { status: 500 });
  }
}
