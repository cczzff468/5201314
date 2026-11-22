import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/contacts/migrate/done：迁出完成回执（服务端清空，数据不留）。
 * 浏览器把工作区联系人与微信背景图**全部写入本地 IndexedDB 成功后**才调用；
 * 服务端此时删除该工作区的全部联系人与全局背景图。
 * 呼叫失败浏览器不写迁移标记 → 下次启动重新迁移（数据仍在，先搬后删不丢）。
 */

/** 工作区 ID：请求头 X-Workspace-Id（浏览器各自持有）；无头时回落 'default' */
function wsOf(req: NextRequest): string {
  const raw = req.headers.get('x-workspace-id')?.trim();
  return raw && raw.length > 0 && raw.length <= 64 ? raw : 'default';
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = wsOf(req);
    const contacts = await db.contact.deleteMany({ where: { workspaceId } });
    // 背景图无工作区归属（全局两键）：首个完成迁移的浏览器带走并清空（后迁移的浏览器用默认背景）
    const backgrounds = await db.wxBackground.deleteMany();
    // #99 移除 console.log 调试残留（保留下方 console.error 错误日志用于诊断）
    return NextResponse.json({ ok: true, purgedContacts: contacts.count, purgedBg: backgrounds.count });
  } catch (err) {
    console.error('[contacts:migrate-done]', err);
    return NextResponse.json({ ok: false, error: '清理服务端旧数据失败' }, { status: 500 });
  }
}
