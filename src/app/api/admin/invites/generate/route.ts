/**
 * POST /api/admin/invites/generate —— 批量生成邀请码（仅管理员）
 * body: { count }（1~50）：格式 COVE-xxxx-xxxx（随机大小写字母+数字，库内查重）。
 * 手动授权模式：管理员复制后私发给指定用户。
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateInviteCodes } from '@/lib/auth/code';
import { getAdminUser } from '@/lib/auth/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const raw = (body as { count?: unknown })?.count;
  const count = typeof raw === 'number' ? Math.floor(raw) : Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return NextResponse.json({ error: '数量需为 1~50 的整数' }, { status: 400 });
  }
  const codes = await generateInviteCodes(count);
  return NextResponse.json({ codes });
}
