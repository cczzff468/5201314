/**
 * POST /api/auth/login/send-code —— 邮箱验证码登录·第一步：向已注册邮箱发验证码
 * body: { email }：必须是已注册的账号邮箱（含待审核账号）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createCode } from '@/lib/auth/code';
import { sendVerifyCodeEmail } from '@/lib/auth/mailer';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const email = (body as { email?: unknown })?.email;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: '请输入正确的邮箱地址' }, { status: 400 });
  }
  const normalized = email.trim().toLowerCase();

  const user = await db.authUser.findUnique({ where: { email: normalized } });
  if (!user) {
    return NextResponse.json({ error: '该邮箱尚未注册' }, { status: 400 });
  }

  const code = await createCode(normalized, 'login');
  if (!code) {
    return NextResponse.json({ error: '发送太频繁，请 60 秒后再试' }, { status: 429 });
  }

  try {
    await sendVerifyCodeEmail(normalized, code, 'login');
  } catch (e) {
    const message = e instanceof Error ? e.message : '验证码邮件发送失败，请稍后重试';
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, message: '验证码已发送，请查收邮件（10 分钟内有效）' });
}
