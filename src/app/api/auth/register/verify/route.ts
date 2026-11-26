/**
 * POST /api/auth/register/verify —— 邮箱验证码注册·第二步：回填验证码建号
 * body: { email, code, password, name? }
 * 成功后创建账号（默认 pending 待审核 + user 普通用户）并自动登录（永久会话）。
 * 白名单邮箱 / 系统尚无管理员（引导规则）→ 直接 admin+approved。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { consumeCode } from '@/lib/auth/code';
import { hashPassword, isAdminEmail, issueToken, SESSION_COOKIE, type SessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

const QQ_EMAIL_RE = /^[\w.+-]+@(qq|foxmail)\.com$/i;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { email, code, password, name } = body as { email?: unknown; code?: unknown; password?: unknown; name?: unknown };

  if (typeof email !== 'string' || !QQ_EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: '请输入正确的 QQ 邮箱（@qq.com）' }, { status: 400 });
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: '请输入 6 位数字验证码' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return NextResponse.json({ error: '密码长度需为 6~72 位' }, { status: 400 });
  }
  const displayName = typeof name === 'string' ? name.trim() : '';
  if (displayName && (displayName.length < 2 || displayName.length > 20)) {
    return NextResponse.json({ error: '用户名长度需为 2~20 位' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const exists = await db.authUser.findUnique({ where: { email: normalized } });
  if (exists) {
    return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 400 });
  }

  const ok = await consumeCode(normalized, code.trim(), 'register');
  if (!ok) {
    return NextResponse.json({ error: '验证码错误或已过期' }, { status: 400 });
  }

  // 权限判定：白名单 → admin；系统还没有任何管理员 → 引导规则（首个账号即管理员）
  const hasAdmin = await db.authUser.findFirst({ where: { role: 'admin' } });
  const isAdmin = isAdminEmail(normalized) || !hasAdmin;

  const user = await db.authUser.create({
    data: {
      email: normalized,
      name: displayName || null,
      password: hashPassword(password),
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'approved' : 'pending',
    },
  });

  const session: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'approved' ? 'approved' : 'pending',
    sessionTyp: 'password',
  };
  const { token, maxAge } = issueToken(user.id, 'password');
  const res = NextResponse.json({ user: session });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
