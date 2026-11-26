/**
 * POST /api/auth/login/send-code —— 邮箱验证码登录·第一步：向已注册邮箱发验证码
 * body: { email }：必须是已注册的账号 QQ 邮箱（含待审核账号）。
 * SMTP 未配置（机主未填授权码）时进入开发回显：验证码直接返回给前端显示。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createCode } from '@/lib/auth/code';
import { sendCodeOrDev } from '@/lib/auth/mailer';

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
    return NextResponse.json({ error: '请输入注册的 QQ 邮箱（@qq.com）' }, { status: 400 });
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
    const { dev } = await sendCodeOrDev(normalized, code, 'login');
    if (dev) {
      return NextResponse.json({
        ok: true,
        devCode: code,
        message: 'SMTP 未配置（开发模式）：验证码已直接显示，填入授权码后将改为邮件发送',
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '验证码邮件发送失败，请稍后重试';
    return NextResponse.json({ error: message }, { status: 503 });
  }
  return NextResponse.json({ ok: true, message: '验证码已发送，请查收邮件（10 分钟内有效）' });
}
