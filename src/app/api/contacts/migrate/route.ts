import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/contacts/migrate：旧数据一次性迁出（只读）。
 * 联系人已改为浏览器 IndexedDB 本地存储，服务端不再保管：
 * 把「请求方浏览器工作区」的联系人 + 全局微信背景图返回给浏览器，
 * 浏览器全部落库成功后调 /api/contacts/migrate/done 通知服务端清空（先搬后删）。
 * 无本迁移需求后（所有浏览器均已迁移）本路由自然失效，可在后续清理中连同模型一起删除。
 */

/** 工作区 ID：请求头 X-Workspace-Id（浏览器各自持有）；无头时回落 'default'（兼容旧存量） */
function wsOf(req: NextRequest): string {
  const raw = req.headers.get('x-workspace-id')?.trim();
  return raw && raw.length > 0 && raw.length <= 64 ? raw : 'default';
}

export async function POST(req: NextRequest) {
  try {
    const workspaceId = wsOf(req);
    const contacts = await db.contact.findMany({ where: { workspaceId } });
    const bgRows = await db.wxBackground.findMany();
    const backgrounds: Record<string, string> = {};
    for (const row of bgRows) {
      if (typeof row.data === 'string' && row.data.startsWith('data:image/')) {
        backgrounds[row.key] = row.data;
      }
    }
    // #98 移除 console.log 调试残留（保留下方 console.error 错误日志用于诊断）
    return NextResponse.json({ ok: true, contacts, backgrounds });
  } catch (err) {
    console.error('[contacts:migrate]', err);
    return NextResponse.json({ ok: false, error: '读取迁移数据失败' }, { status: 500 });
  }
}
