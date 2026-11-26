/**
 * GET /api/admin/invites —— 邀请码列表（仅管理员）
 * 返回 [{ id, code, used, usedBy, createdAt }]，按生成时间倒序。
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
  const invites = await db.inviteCode.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, code: true, used: true, usedBy: true, createdAt: true },
  });
  return NextResponse.json({ invites });
}
