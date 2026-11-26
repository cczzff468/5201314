/**
 * POST /api/auth/reset/verify —— 忘记密码·第二步：邮箱 + 验证码设置新密码
 * body: { email, code, newPassword }
 * 重置成功后：旧密码立即报废（哈希被替换，旧密码再也无法登录），
 * 下次用新密码登录；邮箱验证码登录不受影响。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { consumeCode } from '@/lib/auth/code';
import { hashPassword } from '@/lib/auth/server';

export const runtime = 'nodejs';

const QQ_EMAIL_RE = /^[\w.+-]+@(qq|foxmail)\.com$/i;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { email, code, newPassword } = body as { email?: unknown; code?: unknown; newPassword?: unknown };
  if (typeof email !== 'string' || !QQ_EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: '请输入注册的 QQ 邮箱（@qq.com）' }, { status: 400 });
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: '请输入 6 位数字验证码' }, { status: 400 });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 72) {
    return NextResponse.json({ error: '新密码长度需为 6~72 位' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  const user = await db.authUser.findUnique({ where: { email: normalized } });
  if (!user) {
    return NextResponse.json({ error: '该邮箱尚未注册' }, { status: 400 });
  }

  const ok = await consumeCode(normalized, code.trim(), 'reset');
  if (!ok) {
    return NextResponse.json({ error: '验证码错误或已过期' }, { status: 400 });
  }

  // 覆写密码哈希：旧密码即刻作废，只能用新密码登录
  await db.authUser.update({
    where: { id: user.id },
    data: { password: hashPassword(newPassword) },
  });

  return NextResponse.json({ ok: true, message: '密码已重置，旧密码已失效，请使用新密码登录' });
}
