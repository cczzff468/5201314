/**
 * 用户书源诊断脚本：测试 user-sources.json 全部源「搜索→目录→正文」，
 * 按失败阶段+错误分类，找出引擎兼容性缺口（用户说这些源在阅读App里全部可用）。
 * 用法：bun scripts/diag-user-sources.ts
 */
import { searchBooks, getBookInfo, getChapter, type LegadoSource } from '../src/lib/reading/engine';
import * as fs from 'node:fs';

const SRC = '/home/z/my-project/src/lib/reading/user-sources.json';
const OUT = '/tmp/diag-result.json';
const KEY = process.env.DKEY || '斗破苍穹';

async function main() {
  const all = JSON.parse(fs.readFileSync(SRC, 'utf-8')) as LegadoSource[];
  console.log(`共 ${all.length} 源，关键词「${KEY}」，开始诊断...\n`);

  interface Diag {
    name: string;
    url: string;
    stage: string; // search / toc / content
    err: string;
    ms: number;
  }
  const results: { ok: boolean; name: string; url: string; ms: number; chapters?: number; contentLen?: number }[] = [];
  const fails: Diag[] = [];

  const queue = [...all];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const source = queue.shift()!;
      const t0 = Date.now();
      const name = String(source.bookSourceName || '');
      const url = String(source.bookSourceUrl || '');
      try {
        const books = await searchBooks(source, KEY);
        if (!books.length) throw new Error('搜索无结果');
        const b = books[0];
        try {
          const info = await getBookInfo(source, b.bookUrl);
          if (!info.chapters.length) throw new Error('目录为空');
          const idx = Math.min(30, info.chapters.length - 1);
          const ch = info.chapters[idx];
          const content = await getChapter(source, ch.url);
          if (content.content.length < 300) throw new Error(`正文过短(${content.content.length})`);
          results.push({ ok: true, name, url, ms: Date.now() - t0, chapters: info.chapters.length, contentLen: content.content.length });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          fails.push({ name, url, stage: 'toc/content', err: msg.slice(0, 140), ms: Date.now() - t0 });
          results.push({ ok: false, name, url, ms: Date.now() - t0 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fails.push({ name, url, stage: 'search', err: msg.slice(0, 140), ms: Date.now() - t0 });
        results.push({ ok: false, name, url, ms: Date.now() - t0 });
      }
      done++;
      if (done % 25 === 0) console.log(`  进度 ${done}/${all.length}（通过 ${results.filter((r) => r.ok).length}）`);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n===== 全链路通过 ${okCount} / ${all.length} =====`);

  // 失败分类
  const byPattern = new Map<string, { count: number; items: Diag[] }>();
  const categorize = (stage: string, err: string): string => {
    const e = err.toLowerCase();
    if (stage === 'search') {
      if (err === '搜索无结果') return '搜索无结果（规则解析失败或站点反爬）';
      if (/redirect count exceeded/i.test(e)) return '重定向循环';
      if (/certificate/i.test(e)) return 'SSL证书错误';
      if (/timeout|aborted|etimedout/i.test(e)) return '超时';
      if (/enotfound|eai_again|getaddrinfo/i.test(e)) return 'DNS解析失败';
      if (/econnrefused|econnreset|ehostunreach|enetunreach|epipe|socket hang up/i.test(e)) return '连接失败/重置';
      if (/fetch failed/i.test(e)) return 'fetch failed(其他网络)';
      return `搜索其他错误`;
    }
    if (/目录为空/.test(err)) return '目录为空（chapterList 规则不匹配）';
    if (/正文过短/.test(err)) return '正文过短（content 规则不匹配）';
    if (/redirect count exceeded/i.test(e)) return '重定向循环(目录/正文)';
    if (/timeout|aborted|etimedout/i.test(e)) return '超时(目录/正文)';
    return '目录/正文其他错误';
  };
  for (const f of fails) {
    const cat = categorize(f.stage, f.err);
    if (!byPattern.has(cat)) byPattern.set(cat, { count: 0, items: [] });
    const p = byPattern.get(cat)!;
    p.count++;
    if (p.items.length < 6) p.items.push(f);
  }
  console.log('\n----- 失败分类 -----');
  const sorted = [...byPattern.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cat, { count, items }] of sorted) {
    console.log(`\n[${count}] ${cat}`);
    for (const it of items) console.log(`    ${it.name} | ${it.url} | ${it.stage} | ${it.err}`);
  }
  fs.writeFileSync(
    OUT,
    JSON.stringify({ total: all.length, ok: okCount, fails, results: results.map((r) => ({ ...r, ms: undefined })) }, null, 1),
    'utf-8',
  );
  console.log(`\n详情已写入 ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
