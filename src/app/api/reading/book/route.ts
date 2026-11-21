import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBookInfo } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 书籍详情+目录：GET ?sourceId=&bookUrl=&name=&author=
 * - 若书已在书架：直接返回书架缓存的目录（秒开），并顺带返回进度（章节+页码）
 * - 否则优先用阅读历史里的进度（续读不丢），再实时抓详情页 + 目录（含翻页目录拼接）
 * 返回 { name, author, coverUrl, intro, lastChapter, chapters:[{title,url}], total, inShelf, lastReadChapter, lastPage }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceId = sp.get('sourceId') || '';
  const bookUrl = sp.get('bookUrl') || '';
  if (!sourceId || !bookUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
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
  try {
    if (shelf && shelf.chapters !== '[]' && shelf.totalChapters > 0) {
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
    const info = await getBookInfo(toLegado(row), bookUrl);
    // 书名/作者兜底：详情页规则可能取不到（txtshuku 系），用搜索结果带来的名字补
    const fbName = sp.get('name') || '';
    const fbAuthor = sp.get('author') || '';
    // 阅读历史里的进度（不在书架也能续读；按同 bookUrl 或同名匹配）
    let lastReadChapter = 0;
    let lastPage = 0;
    const hist = await db.readHistory.findFirst({ where: { bookUrl } });
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
      inShelf: false,
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
