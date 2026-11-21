import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getChapter } from '@/lib/reading/engine';
import { toLegado } from '../sources/route';
import { genChapterSummary } from '@/lib/reading/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 章节正文（服务端代理抓取 + 双缓存）：
 * GET ?sourceId=&chapterUrl=&bookUrl=&index=&title=&refresh=1
 * - 本地书（sourceId=local / chapterUrl=local:...）：LocalChapter 秒回
 * - refresh=1：跳过缓存强制重抓（阅读器「刷新」按钮），抓完更新缓存
 * - ChapterCache（chapterUrl 唯一键）命中直接回
 * - 未命中抓取正文入库；若该章还没有 AI 摘要 → 后台静默生成（不阻塞本次响应，
 *   下次打开或聊天时已就绪——Token 危机解法：聊天只注入 100 字摘要）
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceId = sp.get('sourceId') || '';
  const chapterUrl = sp.get('chapterUrl') || '';
  const bookUrl = sp.get('bookUrl') || '';
  const index = parseInt(sp.get('index') || '0', 10) || 0;
  const title = sp.get('title') || '';
  const refresh = sp.get('refresh') === '1';
  if (!sourceId || !chapterUrl) return NextResponse.json({ error: '参数缺失' }, { status: 400 });

  // ① 本地书：chapterUrl = local:{bookId}:{idx}
  if (sourceId === 'local' || chapterUrl.startsWith('local:')) {
    const m = /^local:([^:]+):(\d+)$/.exec(chapterUrl);
    if (!m) return NextResponse.json({ error: '本地章节地址不合法' }, { status: 400 });
    const lc = await db.localChapter.findUnique({
      where: { bookId_idx: { bookId: m[1], idx: parseInt(m[2], 10) } },
    });
    if (!lc) return NextResponse.json({ error: '章节不存在' }, { status: 404 });
    return NextResponse.json({ title: lc.title, content: lc.content, summary: '', cached: true });
  }

  if (!refresh) {
    const cached = await db.chapterCache.findUnique({ where: { chapterUrl } });
    if (cached && cached.content.length > 200) {
      if (cached.bookUrl === bookUrl && !cached.summary) {
        void genChapterSummary({ bookUrl, chapterUrl, index, title, content: cached.content }).catch(() => null);
      }
      return NextResponse.json({
        title: cached.title || title,
        content: cached.content,
        summary: cached.summary || '',
        cached: true,
      });
    }
  }

  let row = await db.bookSource.findUnique({ where: { id: sourceId } });
  if (!row) {
    // 自愈：sourceId 失效 → 按 chapterUrl 前缀找同站点书源兜底
    const all = await db.bookSource.findMany();
    row =
      all
        .map((s) => ({ s, u: s.url.replace(/\/+$/, '/') }))
        .sort((a, b) => b.u.length - a.u.length)
        .find((x) => x.u !== 'http://' && x.u !== 'https://' && chapterUrl.startsWith(x.u))?.s || null;
    if (!row) return NextResponse.json({ error: '书源不存在' }, { status: 404 });
  }
  try {
    const ch = await getChapter(toLegado(row), chapterUrl);
    if (!ch.content || ch.content.length < 50) {
      return NextResponse.json({ error: '正文抓取失败（站点反爬或规则失效）' }, { status: 502 });
    }
    await db.chapterCache.upsert({
      where: { chapterUrl },
      update: { title: title || ch.title, content: ch.content, bookUrl, chapterIndex: index },
      create: { bookUrl, chapterIndex: index, chapterUrl, title: title || ch.title, content: ch.content },
    });
    // 后台静默生成 AI 摘要（翻章即触发，用户无感；失败静默）
    void genChapterSummary({ bookUrl, chapterUrl, index, title: title || ch.title, content: ch.content }).catch(
      () => null,
    );
    return NextResponse.json({ title: title || ch.title, content: ch.content, summary: '', cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 90) : '章节抓取失败' },
      { status: 502 },
    );
  }
}
