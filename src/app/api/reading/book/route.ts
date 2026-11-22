import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBookInfo } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 书籍详情+目录：GET ?sourceId=&bookUrl=&name=&author=
 * - 本地书（sourceId=local）：LocalBook + LocalChapter 目录，秒回
 * - 若书已在书架：直接返回书架缓存的目录（秒开），并顺带返回进度（章节+页码）；
 *   书架目录为空时实时抓一次并回写书架（下次秒开）
 * - 不在书架：优先用阅读历史缓存的目录（读过的书再点秒开）；没有才实时抓，
 *   抓完把目录写进历史缓存
 * 返回 { name, author, coverUrl, intro, lastChapter, chapters:[{title,url}], total, inShelf, lastReadChapter, lastPage }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceId = sp.get('sourceId') || '';
  const bookUrl = sp.get('bookUrl') || '';
  if (!sourceId || !bookUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });

  // ① 本地导入书：直接查本地表
  if (sourceId === 'local' || bookUrl.startsWith('local:')) {
    const localId = bookUrl.startsWith('local:') ? bookUrl.slice('local:'.length) : bookUrl;
    const lb = await db.localBook.findUnique({ where: { id: localId } });
    if (!lb) return NextResponse.json({ error: '本地书籍不存在' }, { status: 404 });
    const chapters = await db.localChapter.findMany({
      where: { bookId: lb.id },
      orderBy: { idx: 'asc' },
      select: { idx: true, title: true },
    });
    const shelf = await db.shelfBook.findUnique({ where: { bookUrl } });
    const hist = await db.readHistory.findUnique({ where: { bookUrl } });
    return NextResponse.json({
      name: lb.name,
      author: lb.author,
      coverUrl: lb.coverUrl,
      intro: lb.intro,
      lastChapter: chapters.length ? chapters[chapters.length - 1].title : null,
      chapters: chapters.map((c) => ({ title: c.title, url: `local:${lb.id}:${c.idx}` })),
      total: chapters.length,
      inShelf: !!shelf,
      lastReadChapter: shelf?.lastReadChapter ?? hist?.lastReadChapter ?? 0,
      lastPage: shelf?.lastPage ?? hist?.lastPage ?? 0,
    });
  }

  let row = await db.bookSource.findUnique({ where: { id: sourceId } });
  if (!row) {
    // 自愈：sourceId 失效（如书源重建）→ 按 bookUrl 前缀找同站点书源兜底
    const all = await db.bookSource.findMany();
    row =
      all
        .map((s) => ({ s, u: s.url.replace(/\/+$/, '/') }))
        .sort((a, b) => b.u.length - a.u.length)
        .find((x) => x.u !== 'http://' && x.u !== 'https://' && bookUrl.startsWith(x.u))?.s || null;
    if (!row) return NextResponse.json({ error: '书源不存在' }, { status: 404 });
  }

  const shelf = await db.shelfBook.findUnique({ where: { bookUrl } });
  const hist = await db.readHistory.findUnique({ where: { bookUrl } });
  /** 封面回填：缓存记录没有封面时后台从书源拉一次（书源有封面就用那个封面） */
  const backfillCover = async (coverUrl: string | null | undefined) => {
    if (coverUrl) return;
    try {
      const info = await getBookInfo(toLegado(row), bookUrl);
      if (info.coverUrl) {
        await db.shelfBook.update({ where: { bookUrl }, data: { coverUrl: info.coverUrl } }).catch(() => null);
        await db.readHistory.update({ where: { bookUrl }, data: { coverUrl: info.coverUrl } }).catch(() => null);
      }
    } catch {
      /* 拉不到就算了，客户端还有跨源封面兜底 */
    }
  };
  try {
    // ② 书架缓存目录（秒开）
    if (shelf && shelf.chapters !== '[]' && shelf.totalChapters > 0) {
      void backfillCover(shelf.coverUrl);
      return NextResponse.json({
        name: shelf.name,
        author: shelf.author,
        coverUrl: shelf.coverUrl,
        intro: shelf.intro,
        lastChapter: shelf.lastChapterTitle,
        chapters: JSON.parse(shelf.chapters) as { title: string; url: string }[],
        total: shelf.totalChapters,
        inShelf: true,
        shelfId: shelf.id,
        lastReadChapter: shelf.lastReadChapter,
        lastPage: shelf.lastPage,
      });
    }
    const fbName = sp.get('name') || '';
    const fbAuthor = sp.get('author') || '';
    // ③ 历史缓存目录（不在书架但读过的书，秒开）
    if (hist && hist.chapters && hist.chapters !== '[]' && hist.totalChapters > 0) {
      void backfillCover(hist.coverUrl);
      return NextResponse.json({
        name: hist.name || fbName,
        author: hist.author || fbAuthor,
        coverUrl: hist.coverUrl,
        intro: '',
        lastChapter: hist.lastChapterTitle,
        chapters: JSON.parse(hist.chapters) as { title: string; url: string }[],
        total: hist.totalChapters,
        inShelf: false,
        lastReadChapter: hist.lastReadChapter,
        lastPage: hist.lastPage,
      });
    }
    const info = await getBookInfo(toLegado(row), bookUrl);
    // 书名/作者兜底：详情页规则可能取不到（txtshuku 系），用搜索结果带来的名字补
    const tocJson = JSON.stringify(info.chapters);
    // 回写缓存：书架目录为空 → 补进书架；历史 → 补目录（下次秒开）；
    // 记录里没有封面而书源有 → 一并回填（书源有封面就用那个封面）
    if (shelf && info.chapters.length) {
      await db.shelfBook
        .update({
          where: { bookUrl },
          data: {
            chapters: tocJson,
            totalChapters: info.chapters.length,
            lastChapterTitle: info.chapters[info.chapters.length - 1].title,
            ...(info.coverUrl && !shelf.coverUrl ? { coverUrl: info.coverUrl } : {}),
          },
        })
        .catch(() => null);
    }
    if (hist && info.chapters.length) {
      await db.readHistory
        .update({
          where: { bookUrl },
          data: {
            chapters: tocJson,
            totalChapters: info.chapters.length,
            lastChapterTitle: info.chapters[info.chapters.length - 1].title,
            ...(info.coverUrl && !hist.coverUrl ? { coverUrl: info.coverUrl } : {}),
          },
        })
        .catch(() => null);
    }
    // 阅读历史里的进度（不在书架也能续读；按同 bookUrl 或同名匹配）
    let lastReadChapter = 0;
    let lastPage = 0;
    if (hist) {
      lastReadChapter = hist.lastReadChapter;
      lastPage = hist.lastPage;
    } else if (fbName) {
      const byName = await db.readHistory.findFirst({ where: { name: fbName } });
      if (byName) {
        lastReadChapter = byName.lastReadChapter;
        lastPage = byName.lastPage;
      }
    }
    return NextResponse.json({
      name: info.name || fbName,
      author: info.author || fbAuthor,
      coverUrl: info.coverUrl,
      intro: info.intro,
      lastChapter: info.lastChapter,
      chapters: info.chapters,
      total: info.totalChapters,
      inShelf: !!shelf,
      lastReadChapter,
      lastPage,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 90) : '获取书籍信息失败' },
      { status: 500 },
    );
  }
}
