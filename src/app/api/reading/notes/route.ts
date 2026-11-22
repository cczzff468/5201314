import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET：某本书的全部批注（书签 + 划线） ?bookUrl=xxx */
export async function GET(req: NextRequest) {
  const bookUrl = req.nextUrl.searchParams.get('bookUrl') || '';
  if (!bookUrl) return NextResponse.json({ notes: [] });
  const rows = await db.readerNote.findMany({
    where: { bookUrl },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({
    notes: rows.map((r) => ({
      id: r.id,
      bookUrl: r.bookUrl,
      name: r.name,
      kind: r.kind,
      chapterIndex: r.chapterIndex,
      chapterTitle: r.chapterTitle,
      pageIndex: r.pageIndex,
      paraIndex: r.paraIndex,
      startOff: r.startOff,
      endOff: r.endOff,
      text: r.text,
      style: r.style,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

/**
 * POST 动作：
 * - { action:'add', note }                       新增书签/划线
 * - { action:'remove', id }                      删除
 * - { action:'updateNote', id, note, style? }    补充/修改笔记（可顺带改样式）
 * - { action:'migrate', from, to }               换源：批注整体迁移到新 bookUrl
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || '');
  try {
    if (action === 'add') {
      const n = (body.note || {}) as Record<string, unknown>;
      const bookUrl = String(n.bookUrl || '');
      const name = String(n.name || '');
      const kind = n.kind === 'highlight' ? 'highlight' : 'bookmark';
      if (!bookUrl || !name) return NextResponse.json({ error: '参数缺失' }, { status: 400 });
      const row = await db.readerNote.create({
        data: {
          bookUrl,
          name,
          kind,
          chapterIndex: Math.max(0, Number(n.chapterIndex) || 0),
          chapterTitle: n.chapterTitle ? String(n.chapterTitle).slice(0, 80) : null,
          pageIndex: Math.max(0, Number(n.pageIndex) || 0),
          paraIndex: Number.isFinite(Number(n.paraIndex)) ? Number(n.paraIndex) : -1,
          startOff: Math.max(0, Number(n.startOff) || 0),
          endOff: Math.max(0, Number(n.endOff) || 0),
          text: String(n.text || '').slice(0, 600),
          style: n.style ? String(n.style).slice(0, 10) : null,
          note: n.note ? String(n.note).slice(0, 500) : null,
        },
      });
      return NextResponse.json({ id: row.id });
    }
    if (action === 'remove') {
      await db.readerNote.delete({ where: { id: String(body.id || '') } }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    if (action === 'updateNote') {
      const data: { note?: string; style?: string } = {};
      if (typeof body.note === 'string') data.note = body.note.slice(0, 500);
      if (typeof body.style === 'string') data.style = body.style.slice(0, 10);
      await db.readerNote
        .update({ where: { id: String(body.id || '') }, data })
        .catch(() => null);
      return NextResponse.json({ ok: true });
    }
    if (action === 'migrate') {
      const from = String(body.from || '');
      const to = String(body.to || '');
      if (!from || !to || from === to) return NextResponse.json({ ok: true });
      const r = await db.readerNote.updateMany({ where: { bookUrl: from }, data: { bookUrl: to } });
      return NextResponse.json({ ok: true, moved: r.count });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '操作失败' }, { status: 500 });
  }
}
