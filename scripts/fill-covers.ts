/**
 * 精选封面补齐（仅缺失；走 dev server API，入库前实测验证）
 * 用法：bun scripts/fill-covers.ts [最大轮数]
 */
import { db } from '@/lib/db';

const BASE = 'http://localhost:3000';

async function main() {
  const maxRounds = Number(process.argv[2] || 30);
  const sharedSrc = await Bun.file('src/components/apps/reading/shared.tsx').text();
  const featuredBlock = sharedSrc.slice(sharedSrc.indexOf('const FEATURED'), sharedSrc.indexOf('export const HOT_SEARCHES'));
  const names = [...new Set([...featuredBlock.matchAll(/\{ name: '([^']+)', author:/g)].map((m) => m[1]))];
  const cached = new Set((await db.featuredCover.findMany()).map((r) => r.name));
  let missing = names.filter((n) => !cached.has(n));
  console.log(`[fill] 精选 ${names.length} 本，已缓存 ${cached.size}，待补 ${missing.length}`);
  const t0 = Date.now();
  for (let round = 1; round <= maxRounds && missing.length; round++) {
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
    console.log(`[fill] 第${round}轮：+${before - missing.length}，剩 ${missing.length}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  }
  const finalCount = await db.featuredCover.count();
  console.log(`[fill] 现有缓存 ${finalCount} / ${names.length}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
