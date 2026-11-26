/**
 * POST /api/admin/approve —— 通过审核（仅管理员）
 * body: { userId }：将账号状态 pending → approved；用户刷新页面即可解锁全部功能。
 * 服务端强制校验管理员会话，普通用户无法自行通过审核。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const userId = (body as { userId?: unknown })?.userId;
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 });
  }
  const user = await db.authUser.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  if (user.status !== 'pending') {
    return NextResponse.json({ error: '该用户不是待审核状态' }, { status: 400 });
  }
  await db.authUser.update({ where: { id: userId }, data: { status: 'approved' } });
  return NextResponse.json({ ok: true });
}
