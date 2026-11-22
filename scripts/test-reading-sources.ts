/**
 * 内置书源实测脚本：从本地书源集合文件提取候选源，跑「搜索→详情→目录→正文」全链路，
 * 产出可用源清单（写入 src/lib/reading/builtin-sources.json）。
 * 用法：bun scripts/test-reading-sources.ts
 */
import { searchBooks, getBookInfo, getChapter, type LegadoSource } from '../src/lib/reading/engine';
import * as fs from 'node:fs';

const WORK = '/home/z/booksrc-work';
const COLLECTIONS: { file: string; label: string }[] = [
  { file: 'aoaostar_b.json', label: '破冰' },
  { file: 'aoaostar_a.json', label: 'XIU2' },
  { file: 'aoaostar_c.json', label: '关耳女频' },
  { file: 'liufuyou_yck.json', label: 'YCK' },
  { file: 'liufuyou_yiove.json', label: 'Yiove' },
  { file: 'tickmao_full.json', label: 'tickmao' },
  { file: 'entr0pia.json', label: 'entr0pia' },
];

const KEY = '斗破苍穹';

interface PassItem {
  source: LegadoSource;
  from: string;
  ms: number;
  chapters: number;
  contentLen: number;
  sample: string;
}

async function main() {
  const all: { source: LegadoSource; from: string }[] = [];
  for (const c of COLLECTIONS) {
    const path = `${WORK}/${c.file}`;
    if (!fs.existsSync(path)) continue;
    const arr = JSON.parse(fs.readFileSync(path, 'utf-8')) as LegadoSource[];
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s?.bookSourceUrl || !s?.searchUrl) continue;
      const su = String(s.bookSourceUrl);
      if (!/^https?:\/\//i.test(su)) continue;
      // 跳过明显要 JS 的（searchUrl 以 @js: 开头）
      if (String(s.searchUrl).trim().startsWith('@js:')) continue;
      all.push({ source: s, from: c.label });
    }
  }
  // 按域名去重（同站多镜像只留一个：保留 collections 顺序里最先出现的）
  const seenDomain = new Set<string>();
  const uniq = all.filter((x) => {
    try {
      const host = new URL(String(x.source.bookSourceUrl)).hostname.replace(/^www\.|^wap\./, '');
      if (seenDomain.has(host)) return false;
      seenDomain.add(host);
      return true;
    } catch {
      return false;
    }
  });
  console.log(`候选源 ${uniq.length} 个（去重后），开始全链路测试（关键词「${KEY}」）...\n`);

  const pass: PassItem[] = [];
  const fail: { name: string; url: string; stage: string; err: string }[] = [];
  const queue = [...uniq];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const { source, from } = item;
      const t0 = Date.now();
      try {
        const books = await searchBooks(source, KEY);
        if (!books.length) throw new Error('搜索无结果');
        const b = books[0];
        const info = await getBookInfo(source, b.bookUrl);
        if (!info.chapters.length) throw new Error('目录为空');
        // 取中间一章（跳过 VIP/公告章节：取第 30 章左右）
        const idx = Math.min(30, info.chapters.length - 1);
        const ch = info.chapters[idx];
        const content = await getChapter(source, ch.url);
        if (content.content.length < 300) throw new Error(`正文过短(${content.content.length})`);
        const ms = Date.now() - t0;
        pass.push({
          source,
          from,
          ms,
          chapters: info.chapters.length,
          contentLen: content.content.length,
          sample: content.content.slice(0, 60).replace(/\n/g, ' '),
        });
        console.log(`  ✓ [${from}] ${source.bookSourceName} ${ms}ms 目录${info.chapters.length}章 正文${content.content.length}字`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fail.push({
          name: String(source.bookSourceName || ''),
          url: String(source.bookSourceUrl || ''),
          stage: 'search/toc/content',
          err: msg.slice(0, 90),
        });
        console.log(`  ✗ [${from}] ${source.bookSourceName} — ${msg.slice(0, 90)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));

  // 按内容长度+速度排序取前 40
  pass.sort((a, b) => b.contentLen + b.chapters * 50 - (a.contentLen + a.chapters * 50));
  const winners = pass.slice(0, 44);
  const out = winners.map((w) => ({ ...w.source, __from: w.from, __ms: w.ms, __chapters: w.chapters, __contentLen: w.contentLen }));
  fs.writeFileSync(`${WORK}/builtin-sources-verified.json`, JSON.stringify(out, null, 1), 'utf-8');
  console.log(`\n===== 结果：通过 ${pass.length} / 失败 ${fail.length}；精选 ${winners.length} 个写入 builtin-sources-verified.json =====`);
  for (const w of winners) {
    console.log(`  [${w.from}] ${w.source.bookSourceName} | ${w.source.bookSourceUrl} | ${w.chapters}章 ${w.contentLen}字 ${w.ms}ms`);
  }
  fs.writeFileSync(`${WORK}/fail-report.json`, JSON.stringify(fail, null, 1), 'utf-8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
