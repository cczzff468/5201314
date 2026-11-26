/**
 * POST /api/auth/register/send-code —— 邮箱验证码注册·第一步：发验证码
 * body: { email }
 * 规则：QQ邮箱（@qq.com / @foxmail.com）、未注册过、60 秒内不重发；
 * 验证码 6 位、10 分钟有效（单次使用）。SMTP 未配置时返回 503 并提示改用邀请码注册。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createCode } from '@/lib/auth/code';
import { sendVerifyCodeEmail } from '@/lib/auth/mailer';

export const runtime = 'nodejs';

const QQ_EMAIL_RE = /^[\w.+-]+@(qq|foxmail)\.com$/i;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const email = (body as { email?: unknown })?.email;
  if (typeof email !== 'string' || !QQ_EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: '请输入正确的 QQ 邮箱（@qq.com）' }, { status: 400 });
  }
  const normalized = email.trim().toLowerCase();

  const exists = await db.authUser.findUnique({ where: { email: normalized } });
  if (exists) {
    return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 400 });
  }

  const code = await createCode(normalized, 'register');
  if (!code) {
    return NextResponse.json({ error: '发送太频繁，请 60 秒后再试' }, { status: 429 });
  }

  try {
    await sendVerifyCodeEmail(normalized, code, 'register');
  } catch (e) {
    const message = e instanceof Error ? e.message : '验证码邮件发送失败，请稍后重试';
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, message: '验证码已发送，请查收邮件（10 分钟内有效）' });
}
