/**
 * POST /api/auth/register/invite —— 邀请码注册（免审核，直接 approved）
 * body: { inviteCode, name, password }
 * 邀请码单次使用（注册成功即作废并记录使用者）；用户名全局唯一（不能与他人邮箱/用户名撞车）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, issueToken, SESSION_COOKIE, toSessionUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const { inviteCode, name, password } = body as { inviteCode?: unknown; name?: unknown; password?: unknown };

  if (typeof inviteCode !== 'string' || !/^COVE-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/i.test(inviteCode.trim())) {
    return NextResponse.json({ error: '邀请码格式不正确（COVE-xxxx-xxxx）' }, { status: 400 });
  }
  const displayName = typeof name === 'string' ? name.trim() : '';
  if (displayName.length < 2 || displayName.length > 20) {
    return NextResponse.json({ error: '请输入 2~20 位的用户名' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return NextResponse.json({ error: '密码长度需为 6~72 位' }, { status: 400 });
  }

  // 大小写不敏感查找（生成时随机大小写，用户输入随意大小写均可；SQLite lower() 对 ASCII 安全）
  const codeInput = inviteCode.trim();
  const hit = await db.$queryRaw<Array<{ id: string; used: number }>>`
    SELECT id, used FROM InviteCode WHERE lower(code) = lower(${codeInput}) LIMIT 1
  `;
  const invite = hit[0]
    ? await db.inviteCode.findUnique({ where: { id: hit[0].id } })
    : null;
  if (!invite || invite.used) {
    return NextResponse.json({ error: '邀请码无效或已被使用' }, { status: 400 });
  }

  // 用户名唯一性：不能与任何已有用户名/邮箱相同（登录时二者都可作为账号输入）
  const lower = displayName.toLowerCase();
  const clash = await db.authUser.findFirst({
    where: { OR: [{ name: displayName }, { email: lower }] },
  });
  if (clash) {
    return NextResponse.json({ error: '该用户名已被使用，请换一个' }, { status: 400 });
  }

  // 邀请码注册一律 user+approved（管理员只能由超管在用户管理里设置）
  const user = await db.$transaction(async (tx) => {
    await tx.inviteCode.update({
      where: { id: invite.id },
      data: { used: true, usedBy: displayName, usedAt: new Date() },
    });
    return tx.authUser.create({
      data: {
        email: null,
        name: displayName,
        password: hashPassword(password),
        role: 'user',
        status: 'approved',
      },
    });
  });

  const { token, maxAge } = issueToken(user.id, 'password');
  const res = NextResponse.json({ user: toSessionUser(user, 'password') });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge });
  return res;
}
