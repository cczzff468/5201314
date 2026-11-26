/**
 * POST /api/admin/role —— 设/撤管理员（仅超级管理员）
 * body: { userId, role: 'admin' | 'user' }
 * 规则（机主第 44 轮定夺）：
 * - 只有超管能设管理员；普通管理员调此接口 403（管理员不可以设管理员）
 * - 目标是 super_admin → 拒绝（超管写死，任何人不可动）
 * - role 只接受 'admin' | 'user'（不能把人提成超管）
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSuperAdminUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const superAdmin = await getSuperAdminUser(req);
  if (!superAdmin) {
    return NextResponse.json({ error: '仅超级管理员可设置管理员' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { userId, role } = body as { userId?: unknown; role?: unknown };
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 });
  }
  if (role !== 'admin' && role !== 'user') {
    return NextResponse.json({ error: '角色只能是 admin 或 user' }, { status: 400 });
  }

  const target = await db.authUser.findUnique({ where: { id: userId } });
  if (!target) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  if (target.role === 'super_admin') {
    return NextResponse.json({ error: '超级管理员不可变更' }, { status: 400 });
  }
  if (target.role === role) {
    return NextResponse.json({ error: role === 'admin' ? '该用户已是管理员' : '该用户已是普通用户' }, { status: 400 });
  }

  await db.authUser.update({ where: { id: target.id }, data: { role } });
  return NextResponse.json({ ok: true, message: role === 'admin' ? '已设为管理员' : '已取消管理员' });
}
