/**
 * POST /api/auth/login/password —— 账号密码登录（永久有效）
 * body: { account, password }：account 可以是 QQ邮箱 或 用户名（邮箱精确匹配优先）。
 * 待审核账号也允许登录（登录后由前端强制展示审核等待页）。
 * 进门先 ensureSuperAdmin：机主账号永远在位（3024996594@qq.com / 20060620 / 初始密码见代码）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  ensureSuperAdmin,
  verifyPassword,
  issueToken,
  SESSION_COOKIE,
  toSessionUser,
} from '@/lib/auth/server';

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

  await ensureSuperAdmin();

  // 邮箱优先（唯一索引精确匹配），再按用户名匹配——避免用户名与邮箱字符串歧义
  const key = account.trim();
  const user =
    (await db.authUser.findUnique({ where: { email: key.toLowerCase() } })) ??
    (await db.authUser.findFirst({ where: { name: key } }));
  if (!user || !verifyPassword(password, user.password)) {
    // 用户不存在与密码错误统一话术（防账号枚举）
    return NextResponse.json({ error: '账号或密码不正确' }, { status: 401 });
  }

  const { token, maxAge } = issueToken(user.id, 'password');
  const res = NextResponse.json({ user: toSessionUser(user, 'password') });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
