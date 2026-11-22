import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 阅读时长统计（单行单例，秒）：
 * GET  → { seconds } 当前累计
 * POST { seconds } → 追加（阅读器每 15s 上报一次，页面不可见时前端不上报）
 */
export async function GET() {
  const row = await db.readStat.findUnique({ where: { id: 'singleton' } });
  return NextResponse.json({ seconds: row?.readSeconds || 0 });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { seconds?: unknown };
  const n = typeof body.seconds === 'number' ? Math.floor(body.seconds) : parseInt(String(body.seconds || ''), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 600) {
    return NextResponse.json({ error: 'seconds 非法（1-600）' }, { status: 400 });
  }
  await db.readStat.upsert({
    where: { id: 'singleton' },
    update: { readSeconds: { increment: n } },
    create: { id: 'singleton', readSeconds: n },
  });
  const row = await db.readStat.findUnique({ where: { id: 'singleton' } });
  return NextResponse.json({ ok: true, seconds: row?.readSeconds || 0 });
}
