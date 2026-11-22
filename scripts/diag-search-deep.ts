/**
 * 搜索失败深挖：对「搜索无结果」的源改用 checkKeyWord / 备选关键词重试；
 * 仍失败的抓页面特征分类（JS挑战/Cloudflare/无bookList命中/编码…）。
 */
import { searchBooks, proxyFetch, parseUrlTpl, type LegadoSource } from '../src/lib/reading/engine';
import * as fs from 'node:fs';

const SRC = '/home/z/my-project/src/lib/reading/user-sources.json';
const diag = JSON.parse(fs.readFileSync('/tmp/diag-result.json', 'utf-8')) as {
  fails: { name: string; url: string; stage: string; err: string }[];
};
const all = JSON.parse(fs.readFileSync(SRC, 'utf-8')) as LegadoSource[];
const searchFails = diag.fails.filter((f) => f.stage === 'search');
console.log(`搜索失败源 ${searchFails.length} 个，深挖中...\n`);

const ALT_KEYS = ['遮天', '完美世界', '大主宰', '斗罗大陆'];

interface Rec {
  name: string;
  url: string;
  outcome: string;
  detail: string;
}
const recs: Rec[] = [];

const queue = [...searchFails];
const worker = async () => {
  while (queue.length) {
    const f = queue.shift()!;
    const source = all.find((s) => String(s.bookSourceName) === f.name);
    if (!source) continue;
    const keys = [source.ruleSearch?.checkKeyWord, '斗破苍穹', ...ALT_KEYS].filter(Boolean) as string[];
    let searched = false;
    for (const k of keys) {
      try {
        const books = await searchBooks(source, k);
        if (books.length) {
          recs.push({ name: f.name, url: source.bookSourceUrl, outcome: `✓ 换词成功(${k})`, detail: `${books.length}条` });
          searched = true;
          break;
        }
      } catch (e) {
        // 抛错继续换词
      }
    }
    if (!searched) {
      // 抓搜索页分析特征
      let detail = '';
      try {
        const kw = keys.find((k) => /[\u4e00-\u9fff]/.test(k)) || '剑';
        const p = parseUrlTpl(String(source.searchUrl), source.bookSourceUrl, { key: kw, page: '1' });
        const r = await proxyFetch(p.url, { method: p.method, headers: p.headers, body: p.body, charset: p.charset, timeoutMs: 10_000 });
        const t = r.text;
        const feats: string[] = [];
        if (/just a moment|cloudflare|cf-browser-verification/i.test(t)) feats.push('Cloudflare五秒盾');
        if (/window\.open\(.*_self/.test(t) && t.length < 1400) feats.push('JS挑战(未自动应答)');
        if (/验证码|captcha|点击验证|安全验证/.test(t)) feats.push('人机验证码');
        if (t.length < 500) feats.push(`超短页(${t.length})`);
        if (/charset=gb/i.test(r.contentType) || /gb/i.test(r.charset)) feats.push(`GBK(${r.charset})`);
        if (!feats.length) {
          // bookList 命中检测
          feats.push(`页面${t.length}字`);
        }
        detail = feats.join('|');
      } catch (e) {
        detail = `抓取失败: ${e instanceof Error ? e.message.slice(0, 60) : e}`;
      }
      recs.push({ name: f.name, url: source.bookSourceUrl, outcome: '✗ 仍无结果', detail });
    }
  }
};
await Promise.all(Array.from({ length: 14 }, worker));

const ok = recs.filter((r) => r.outcome.startsWith('✓'));
const bad = recs.filter((r) => !r.outcome.startsWith('✓'));
console.log(`\n===== 换词后可用 ${ok.length}，仍失败 ${bad.length} =====`);
console.log('\n--- 换词可用 ---');
for (const r of ok) console.log(`  ${r.name} ${r.outcome}`);
console.log('\n--- 仍失败(特征) ---');
// 按特征归类
const byFeat = new Map<string, Rec[]>();
for (const r of bad) {
  const feat = r.detail.split('|')[0];
  if (!byFeat.has(feat)) byFeat.set(feat, []);
  byFeat.get(feat)!.push(r);
}
for (const [feat, items] of [...byFeat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n[${items.length}] ${feat}`);
  for (const it of items.slice(0, 5)) console.log(`    ${it.name} | ${it.url} | ${it.detail}`);
}
fs.writeFileSync('/tmp/search-fail-deep.json', JSON.stringify(recs, null, 1), 'utf-8');
