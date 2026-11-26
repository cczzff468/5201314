/**
 * POST /api/auth/register/verify —— 邮箱验证码注册·第二步：回填验证码建号
 * body: { email, code, password, name }
 * 机主第 44 轮表单规格：用户名必填（2~20 位，与既有用户名/邮箱不撞车）。
 * 成功后创建账号（pending 待审核 + user 普通用户）并自动登录（永久会话）。
 * env ADMIN_QQ_EMAILS 白名单邮箱 → admin+approved；超管邮箱永远走 ensure 占位无法到达此处。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { consumeCode } from '@/lib/auth/code';
import { hashPassword, isAdminEmail, ensureSuperAdmin, issueToken, SESSION_COOKIE, toSessionUser } from '@/lib/auth/server';

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

  const displayName = typeof name === 'string' ? name.trim() : '';
  if (!displayName || displayName.length < 2 || displayName.length > 20) {
    return NextResponse.json({ error: '请输入 2~20 位的用户名' }, { status: 400 });
  }
  if (typeof email !== 'string' || !QQ_EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: '请输入正确的 QQ 邮箱（@qq.com）' }, { status: 400 });
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: '请输入 6 位数字验证码' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return NextResponse.json({ error: '密码长度需为 6~72 位' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  await ensureSuperAdmin();

  const exists = await db.authUser.findUnique({ where: { email: normalized } });
  if (exists) {
    return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 400 });
  }

  // 用户名唯一：不能与任何已有用户名/邮箱撞车（登录时二者都可作为账号输入）
  const clash = await db.authUser.findFirst({
    where: { OR: [{ name: displayName }, { email: displayName.toLowerCase() }] },
  });
  if (clash) {
    return NextResponse.json({ error: '该用户名已被使用，请换一个' }, { status: 400 });
  }

  const ok = await consumeCode(normalized, code.trim(), 'register');
  if (!ok) {
    return NextResponse.json({ error: '验证码错误或已过期' }, { status: 400 });
  }

  // env 白名单邮箱 → admin+approved；其余一律 user+pending（管理员由超管在用户管理里设置）
  const isAdmin = isAdminEmail(normalized);

  const user = await db.authUser.create({
    data: {
      email: normalized,
      name: displayName,
      password: hashPassword(password),
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'approved' : 'pending',
    },
  });

  const { token, maxAge } = issueToken(user.id, 'password');
  const res = NextResponse.json({ user: toSessionUser(user, 'password') });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
