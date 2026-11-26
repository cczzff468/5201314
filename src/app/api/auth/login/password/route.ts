/**
 * POST /api/auth/login/password —— 账号密码登录（永久有效）
 * body: { account, password }：account 可以是 QQ邮箱 或 用户名。
 * 待审核账号也允许登录（登录后由前端强制展示审核等待页）。
 * 白名单邮箱在此自动升为 admin+approved。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, issueToken, SESSION_COOKIE, type SessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { account, password } = body as { account?: unknown; password?: unknown };
  if (typeof account !== 'string' || !account.trim()) {
    return NextResponse.json({ error: '请输入邮箱或用户名' }, { status: 400 });
  }
  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: '请输入密码' }, { status: 400 });
  }

  const key = account.trim();
  const user = await db.authUser.findFirst({
    where: { OR: [{ email: key.toLowerCase() }, { name: key }] },
  });
  if (!user || !verifyPassword(password, user.password)) {
    // 用户不存在与密码错误统一话术（防账号枚举）
    return NextResponse.json({ error: '账号或密码不正确' }, { status: 401 });
  }

  const { token, maxAge } = issueToken(user.id, 'password');
  const session: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'approved' ? 'approved' : 'pending',
    sessionTyp: 'password',
  };
  const res = NextResponse.json({ user: session });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
