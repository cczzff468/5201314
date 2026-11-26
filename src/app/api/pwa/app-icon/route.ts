import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * App 图标选择同步（第三十一轮三选一 → 第三十八轮四选一 → 第三十九轮两选一）：
 * 设置 › 外观/APP 图标。第三十九轮删暗黑版/二次元版：合法值收敛 '1'|'2'，
 * 存量 '3'/'4' 记录读取时自动归一回 '1'（PWA manifest 不再指向已删除的 PNG）。
 * - POST { icon: '1'|'2' }：写入 AppConfig['appIcon']（upsert），
 *   /api/pwa/manifest 随后动态返回所选图标（PWA 安装/添加到主屏幕时生效）；
 * - GET：当前选择（供设置页初始化对齐）。
 */
export async function GET() {
  try {
    const rec = await db.appConfig.findUnique({ where: { key: 'appIcon' } });
    const icon = rec?.value === '2' ? rec.value : '1';
    return NextResponse.json({ ok: true, icon });
  } catch {
    return NextResponse.json({ ok: true, icon: '1' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { icon?: unknown };
    const icon = body.icon;
    if (icon !== '1' && icon !== '2') {
      return NextResponse.json({ ok: false, error: 'icon 必须是 1/2' }, { status: 400 });
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
