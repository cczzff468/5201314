/**
 * GET /api/admin/users —— 全部账号列表（仅超级管理员；普通管理员 403）
 * 返回 [{ id, email, name, role, status, createdAt }]，按注册时间正序。
 * 机主定夺：用户管理（设/撤管理员）只有超管能看，管理员不可以设管理员。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSuperAdminUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const superAdmin = await getSuperAdminUser(req);
  if (!superAdmin) {
    return NextResponse.json({ error: '仅超级管理员可管理用户' }, { status: 403 });
  }
  const users = await db.authUser.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
  });
  return NextResponse.json({ users });
}
