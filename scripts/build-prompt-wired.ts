/**
 * 全量提示词库 · 接线清单生成器（v67）。
 *
 * 扫描 src/ 下所有 .ts/.tsx 源码里的 `lib:<key>` 字面量（key 形如 wechat-20、
 * taobao-2.1.1、meituan-3.1，与 public/prompt-library/*.json 中每条目目的
 * `key` 字段一一对应），汇总写入 public/prompt-library/wired.json。
 * 默认预设页内嵌的全量库分区读取该文件做「已接线 / 存档」徽章：
 * - 已接线：该条目已在源码中经 libPromptTextMulti/promptTextOf 接入运行时，
 *   用户编辑与开关即时生效；
 * - 存档：编辑与开关先保存到 prompt-entries:state，待后续接线自动生效。
 *
 * 运行：bun scripts/build-prompt-wired.ts（新增接线后重跑一次即可）。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'public', 'prompt-library', 'wired.json');

const wired = new Set<string>();

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/lib:([A-Za-z0-9][A-Za-z0-9.-]*)/g)) {
      wired.add(m[1]);
    }
  }
}

walk(SRC);
const sorted = [...wired].sort();
writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), wired: sorted })}\n`);
console.log(`wired.json 已生成：${sorted.length} 个已接线 key → ${OUT}`);
