/**
 * GET /api/auth/me —— 当前会话账号信息
 * 200 { user }: 已登录（含 pending 待审核账号；前端据此分流登录页/等待页/主界面）
 * 401: 未登录。白名单邮箱在此自动升为 admin+approved。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ user });
}
