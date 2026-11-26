/**
 * GET /api/admin/pending —— 待审核用户列表（仅管理员；普通用户 403 完全不可见）
 * 返回 [{ id, email, name, createdAt }]，按注册时间正序。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }
  const pending = await db.authUser.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return NextResponse.json({ users: pending });
}
