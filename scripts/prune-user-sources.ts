/**
 * 失效书源清理（第五轮）：
 * user-sources.json 里的源按 DB 实测结果（checkStatus='ok'）裁剪——
 * 只保留实测可用的；失效的从 JSON 移除后，下次 sources API 播种（ensureSeeded）
 * 会把库里这些「已除名内置源」自动删除并自愈书架/历史引用。
 * 运行：bun scripts/prune-user-sources.ts
 */
import { db } from '@/lib/db';
import { normSourceUrl } from '@/lib/reading/builtin-sources';
import { writeFileSync } from 'node:fs';

async function main() {
  const rows = await db.bookSource.findMany({ where: { isBuiltin: true }, select: { url: true, checkStatus: true, name: true } });
  const okUrls = new Set(rows.filter((r) => r.checkStatus === 'ok').map((r) => normSourceUrl(r.url)));
  console.log(`DB 内置源 ${rows.length} 个，实测可用 ${okUrls.size} 个`);

  const all: Array<Record<string, unknown>> = JSON.parse(await Bun.file('src/lib/reading/user-sources.json').text());
  const keep = all.filter((s) => okUrls.has(normSourceUrl(String(s.bookSourceUrl || ''))));
  console.log(`user-sources.json：${all.length} → 保留 ${keep.length}（删除失效 ${all.length - keep.length}）`);
  if (keep.length === 0) {
    console.log('!! 没有任何可用源，中止（避免清空）');
    process.exit(1);
  }
  writeFileSync('src/lib/reading/user-sources.json', JSON.stringify(keep, null, 1));
  console.log('已写回 user-sources.json。下次访问 /api/reading/sources 时播种自动清理库内失效源。');
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
