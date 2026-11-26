import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * App 图标选择同步（第三十一轮三选一 → 第三十八轮四选一 → 第三十九轮两选一 →
 * 第四十轮：机主新增两款四选一——1 云朵C / 2 弧C微笑 / 3 情书字标 / 4 小词灵（默认））：
 * 设置 › 外观/APP 图标。
 * - POST { icon: '1'|'2'|'3'|'4' }：写入 AppConfig['appIcon']（upsert），
 *   /api/pwa/manifest 随后动态返回所选图标（PWA 安装/添加到主屏幕时生效）；
 * - GET：当前选择（供设置页初始化对齐）。
 */
export async function GET() {
  try {
    const rec = await db.appConfig.findUnique({ where: { key: 'appIcon' } });
    const icon =
      rec?.value === '1' || rec?.value === '2' || rec?.value === '3' || rec?.value === '4'
        ? rec.value
        : '4';
    return NextResponse.json({ ok: true, icon });
  } catch {
    return NextResponse.json({ ok: true, icon: '4' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { icon?: unknown };
    const icon = body.icon;
    if (icon !== '1' && icon !== '2' && icon !== '3' && icon !== '4') {
      return NextResponse.json({ ok: false, error: 'icon 必须是 1/2/3/4' }, { status: 400 });
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
