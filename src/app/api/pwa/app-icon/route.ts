import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * App 图标选择同步（第三十一轮）：设置 › APP 图标 三选一。
 * - POST { icon: '1'|'2'|'3' }：写入 AppConfig['appIcon']（upsert），
 *   /api/pwa/manifest 随后动态返回所选图标（PWA 安装/添加到主屏幕时生效）；
 * - GET：当前选择（供设置页初始化对齐）。
 */
export async function GET() {
  try {
    const rec = await db.appConfig.findUnique({ where: { key: 'appIcon' } });
    const icon = rec?.value === '2' || rec?.value === '3' ? rec.value : '1';
    return NextResponse.json({ ok: true, icon });
  } catch {
    return NextResponse.json({ ok: true, icon: '1' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { icon?: unknown };
    const icon = body.icon;
    if (icon !== '1' && icon !== '2' && icon !== '3') {
      return NextResponse.json({ ok: false, error: 'icon 必须是 1/2/3' }, { status: 400 });
    }
    await db.appConfig.upsert({
      where: { key: 'appIcon' },
      update: { value: icon },
      create: { key: 'appIcon', value: icon },
    });
    return NextResponse.json({ ok: true, icon });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
