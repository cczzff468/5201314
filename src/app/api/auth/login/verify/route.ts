/**
 * POST /api/auth/login/verify —— 邮箱验证码登录·第二步：回填验证码（临时会话 24 小时）
 * body: { email, code }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { consumeCode } from '@/lib/auth/code';
import { issueToken, SESSION_COOKIE, type SessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { email, code } = body as { email?: unknown; code?: unknown };
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: '请输入正确的邮箱地址' }, { status: 400 });
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: '请输入 6 位数字验证码' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const ok = await consumeCode(normalized, code.trim(), 'login');
  if (!ok) {
    return NextResponse.json({ error: '验证码错误或已过期' }, { status: 400 });
  }

  const user = await db.authUser.findUnique({ where: { email: normalized } });
  if (!user) {
    return NextResponse.json({ error: '该邮箱尚未注册' }, { status: 400 });
  }

  const { token, maxAge } = issueToken(user.id, 'email');
  const session: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'approved' ? 'approved' : 'pending',
    sessionTyp: 'email',
  };
  const res = NextResponse.json({ user: session });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
