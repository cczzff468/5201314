/**
 * POST /api/auth/logout —— 退出登录（清会话 Cookie；账号仍在服务端，随时可再登录）
 */

import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
