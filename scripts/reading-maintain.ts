/**
 * 一次性维护脚本（第五轮）：
 * 1. 删除失效书源（checkStatus='fail' 且非内置——用户导入的好源全保留）
 * 2. 精选封面全量预热：校验已有 FeaturedCover 缓存（死链删掉重搜）+ 补齐缺失书名
 *    （走 dev server 的 /api/reading/featured-covers，封面入库前经过实测验证）
 * 运行：bun scripts/reading-maintain.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';

async function main() {
  // ---------- 1. 删除失效书源 ----------
  const failEnabled = await db.bookSource.count({ where: { checkStatus: 'fail', enabled: true, isBuiltin: false } });
  const failDisabled = await db.bookSource.count({ where: { checkStatus: 'fail', enabled: false, isBuiltin: false } });
  console.log(`[sources] 失效且启用: ${failEnabled}，失效且停用: ${failDisabled}`);
  const del = await db.bookSource.deleteMany({ where: { checkStatus: 'fail', isBuiltin: false } });
  console.log(`[sources] 已删除失效书源 ${del.count} 个`);
  const after = await db.bookSource.groupBy({ by: ['checkStatus'], _count: true });
  console.log('[sources] 清理后:', JSON.stringify(after));

  // ---------- 2. 精选书单全部书名（从 shared.tsx 抽取 FEATURED） ----------
  const sharedSrc = await Bun.file('src/components/apps/reading/shared.tsx').text();
  const featuredBlock = sharedSrc.slice(sharedSrc.indexOf('const FEATURED'), sharedSrc.indexOf('export const HOT_SEARCHES'));
  const names = [...new Set([...featuredBlock.matchAll(/\{ name: '([^']+)', author:/g)].map((m) => m[1]))];
  console.log(`[covers] 精选书共 ${names.length} 本`);

  // 已缓存但死链的：删掉（后续 fill 会重新搜+验证）
  const rows = await db.featuredCover.findMany();
  let dead = 0;
  for (const r of rows) {
    const ok = await verify(r.coverUrl);
    if (!ok) {
      dead++;
      await db.featuredCover.delete({ where: { name: r.name } }).catch(() => null);
      console.log(`[covers] 死链删除: ${r.name}`);
    }
  }
  console.log(`[covers] 已有缓存 ${rows.length} 条，其中死链 ${dead} 条已删`);

  // ---------- 3. 缺失书名批量补齐（走 API：入库前实测验证） ----------
  const cached = new Set((await db.featuredCover.findMany()).map((r) => r.name));
  let missing = names.filter((n) => !cached.has(n));
  console.log(`[covers] 待补齐 ${missing.length} 本`);
  const t0 = Date.now();
  let round = 0;
  while (missing.length && round < 40) {
    round++;
    const batch = missing.slice(0, 24);
    const chunks = [batch.slice(0, 12), batch.slice(12)].filter((c) => c.length);
    await Promise.all(
      chunks.map((c) =>
        fetch(`${BASE}/api/reading/featured-covers?names=${encodeURIComponent(c.join(','))}&fill=1`)
          .then((r) => r.json())
          .catch(() => null),
      ),
    );
    const now = new Set((await db.featuredCover.findMany()).map((r) => r.name));
    const before = missing.length;
    missing = missing.filter((n) => !now.has(n));
    console.log(`[covers] 第${round}轮：新增 ${before - missing.length}，剩余 ${missing.length}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  }
  const finalCount = await db.featuredCover.count();
  console.log(`[covers] 完成：FeaturedCover 共 ${finalCount} 条 / ${names.length} 本（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  if (missing.length) console.log('[covers] 未取到:', missing.join('、'));
  await db.$disconnect();
}

async function verify(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        Referer: new URL(url).origin + '/',
        Accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (type && !type.startsWith('image/')) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 512;
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
