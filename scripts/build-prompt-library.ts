/**
 * 全量提示词库构建脚本：把 prompts/ 下 4 份提取文档解析成结构化 JSON，
 * 输出到 public/prompt-library/（每 App 一个 JSON + index.json），供设置·全量提示词库页懒加载。
 *
 * 解析规则（对 4 份文档统一适用）：
 * - 围栏感知：``` 代码块内的 #/##/### 不当作标题；
 * - H1（# 一、xxx）= 分类；H2/H3（## N. / ### N-N.）= 条目；
 * - 条目元信息：- **文件+行号/所在文件** / - **触发场景** / - **角色**；
 * - 条目原文：围栏代码块（多块用 ———— 分隔）；无代码块时回退为正文（去元信息行，保留表格）。
 * - 淘宝/美团文档的四、五、九、附 章节与微信/QQ 文档重复（微信/QQ 里买东西全文在微信/QQ 分组），跳过；
 *   8.4 与第十章为表格条目，按行拆分并按文件归属分到淘宝/美团。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'prompts');
const OUT = join(ROOT, 'public', 'prompt-library');

interface LibEntry {
  n: string;
  title: string;
  file: string;
  trigger: string;
  role: string;
  text: string;
}
interface LibCategory {
  name: string;
  entries: LibEntry[];
}
interface LibApp {
  id: string;
  name: string;
  desc: string;
  count: number;
  categories: LibCategory[];
}

/** 去掉分类标题里的中文序号前缀和「—— N 条」尾缀 */
function cleanCategoryName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^[一二三四五六七八九十A-Z]+、\s*/, '');
  s = s.replace(/\s*——?\s*\d+\s*条(\s*\+\s*\d+\s*组?)?\s*$/, '');
  return s.trim();
}

/** 去掉条目标题里的编号前缀（## 12. / ### 47-3. / ## 5A.） */
function cleanEntryTitle(raw: string): { n: string; title: string } {
  let s = raw.trim();
  const m = s.match(/^(\d+(?:[.\-]\d+)*[A-Za-z]?)[.、\s]\s*(.+)$/);
  if (m) return { n: m[1], title: m[2].trim() };
  return { n: '', title: s };
}

interface RawEntry {
  headingLevel: number;
  titleRaw: string;
  bodyLines: string[];
}

interface RawCategory {
  nameRaw: string;
  entries: RawEntry[];
  /** 分类直属正文（无条目的分类，如第十章的表格） */
  bodyLines: string[];
}

/** 围栏感知地切分文档：H1=分类，H2/H3=条目 */
function splitDoc(md: string): { title: string; categories: RawCategory[] } {
  const lines = md.split('\n');
  const categories: RawCategory[] = [];
  let currentCat: RawCategory | null = null;
  let currentEntry: RawEntry | null = null;
  let inFence = false;
  let docTitle = '';

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      // 围栏行本身归入当前条目/分类正文
      if (currentEntry) currentEntry.bodyLines.push(line);
      else if (currentCat) currentCat.bodyLines.push(line);
      continue;
    }
    if (!inFence) {
      const h1 = line.match(/^# (.+)$/);
      const h23 = line.match(/^(##|###) (.+)$/);
      if (h1) {
        const name = h1[1].trim();
        // 文档首行标题 / 目录索引之后才是正文分类
        if (!docTitle) {
          docTitle = name;
          continue;
        }
        currentEntry = null;
        currentCat = { nameRaw: name, entries: [], bodyLines: [] };
        categories.push(currentCat);
        continue;
      }
      if (h23 && currentCat) {
        currentEntry = { headingLevel: h23[1].length, titleRaw: h23[2].trim(), bodyLines: [] };
        currentCat.entries.push(currentEntry);
        continue;
      }
    }
    if (currentEntry) currentEntry.bodyLines.push(line);
    else if (currentCat) currentCat.bodyLines.push(line);
  }
  return { title: docTitle, categories };
}

/** 从条目正文提取元信息与原文 */
function parseEntry(e: RawEntry): LibEntry {
  const { n, title } = cleanEntryTitle(e.titleRaw);
  let file = '';
  let trigger = '';
  let role = '';
  const blocks: string[] = [];
  const otherBullets: string[] = [];
  const plainLines: string[] = [];
  let inFence = false;
  let buf: string[] = [];

  for (const line of e.bodyLines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        blocks.push(buf.join('\n').trim());
        buf = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    const meta = line.match(/^\s*-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/);
    if (meta) {
      const key = meta[1].trim();
      const val = meta[2].trim().replace(/^`|`$/g, '');
      if (key.startsWith('文件') || key.startsWith('所在文件')) file = val;
      else if (key.startsWith('触发场景')) trigger = val;
      else if (key === '角色') role = val;
      else otherBullets.push(`${key}：${val}`);
      continue;
    }
    // 子条目的括号源注：如（mt-ai-engage.ts 532–546 buildCatalogBlock；……）
    if (!file) {
      const paren = line.match(/^[（(](.*\.(?:ts|tsx)[^）)]*)[）)]\s*$/);
      if (paren) {
        file = paren[1].trim();
        continue;
      }
    }
    plainLines.push(line);
  }
  plainLines.pop(); // 条目末尾的空行
  let text = '';
  if (blocks.length > 0) text = blocks.filter((b) => b.length > 0).join('\n\n————\n\n');
  else {
    // 无代码块：回退用正文（保留表格与说明），去掉纯空尾
    const body = plainLines.join('\n').trim();
    const notes = otherBullets.join('\n');
    text = [body, notes].filter(Boolean).join('\n\n') || '（说明性条目，无独立提示词原文）';
  }
  return { n, title, file, trigger, role, text };
}

/** 解析 markdown 表格 → 行数组（跳过表头与分隔行） */
function tableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|\s*[-:]/.test(t)) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells.every((c) => /^[-:]*$/.test(c))) continue;
    // 表头行：首列为 # 或包含「所在文件/函数/触发场景」等列名
    if (cells[0] === '#' || cells.some((c) => /^(所在文件|函数|提示词原文|模板原文|行号)$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function catEntries(cat: RawCategory): LibEntry[] {
  // 父级标题修复：H2 条目紧跟 H3 子条目且自身无代码块（纯分组标题，如「2.1 体系」「5B 组装块」）→ 跳过
  const kept = cat.entries.filter((e, i) => {
    const next = cat.entries[i + 1];
    if (e.headingLevel === 2 && next && next.headingLevel === 3 && !e.bodyLines.some((l) => /^\s*```/.test(l))) {
      return false;
    }
    return true;
  });
  return kept.map(parseEntry);
}

// ---------------- 各文档 → App 映射 ----------------

function buildWechat(): LibApp {
  const md = readFileSync(join(SRC, 'wechat-prompts.md'), 'utf-8');
  const { categories } = splitDoc(md);
  const cats: LibCategory[] = [];
  for (const c of categories) {
    const entries = catEntries(c);
    if (entries.length > 0) cats.push({ name: cleanCategoryName(c.nameRaw), entries });
  }
  const count = cats.reduce((s, c) => s + c.entries.length, 0);
  return { id: 'wechat', name: '微信', desc: '单聊 / 群聊 / 好友关系 / 微信里买东西（美团·淘宝联动）', count, categories: cats };
}

function buildQq(): LibApp {
  const md = readFileSync(join(SRC, 'qq-prompts.md'), 'utf-8');
  const { categories } = splitDoc(md);
  const cats: LibCategory[] = [];
  for (const c of categories) {
    const entries = catEntries(c);
    if (entries.length > 0) cats.push({ name: cleanCategoryName(c.nameRaw), entries });
  }
  const count = cats.reduce((s, c) => s + c.entries.length, 0);
  return { id: 'qq', name: 'QQ', desc: '单聊 / 群聊 / QQ空间 / 好友申请 / QQ里买东西', count, categories: cats };
}

/** 淘宝/美团文档：按章节分派到两个 App；四/五/九/附跳过（与微信/QQ 分组重复）；8.4 与十章表格按行拆分 */
function buildTbMt(): { taobao: LibApp; meituan: LibApp } {
  const md = readFileSync(join(SRC, 'taobao-meituan-prompts.md'), 'utf-8');
  const { categories } = splitDoc(md);
  const tbCats = new Map<string, LibEntry[]>();
  const mtCats = new Map<string, LibEntry[]>();
  const push = (m: Map<string, LibEntry[]>, cat: string, e: LibEntry) => {
    const arr = m.get(cat) ?? [];
    arr.push(e);
    m.set(cat, arr);
  };

  for (const c of categories) {
    const nameRaw = c.nameRaw;
    const num = nameRaw.match(/^[一二三四五六七八九十]+、/)?.[0] ?? '';
    if (num === '四、' || num === '五、') continue; // 微信/QQ 里买东西 → 已在微信/QQ 分组全文收录
    if (num === '九、') continue; // chat-rich 动作规则 → 与微信分组「处理对方发来的红包/转账/亲属卡/礼物」同文
    if (nameRaw.startsWith('附')) continue; // 非 LLM 兜底口径

    if (num === '一、') {
      for (const e of catEntries(c)) push(tbCats, '淘宝 AI 客服', e);
    } else if (num === '二、') {
      for (const e of catEntries(c)) push(tbCats, '淘宝生成规则（信息流 / 订单）', e);
    } else if (num === '三、') {
      for (const e of catEntries(c)) push(mtCats, '美团生成规则（信息流 / 订单 / 频道）', e);
    } else if (num === '六、') {
      for (const e of catEntries(c)) push(/美团/.test(e.title) ? mtCats : tbCats, '代付 / 取件独立决策', e);
    } else if (num === '七、') {
      for (const e of catEntries(c)) push(/美团/.test(e.title) ? mtCats : tbCats, '跨 App 事件联动情境', e);
    } else if (num === '八、') {
      for (const raw of c.entries) {
        if (/^8\.4/.test(raw.titleRaw)) {
          // 8.4 initialPrompt 表格：一行一处 → 按文件归属拆
          const rows = tableRows(raw.bodyLines);
          for (const r of rows) {
            if (r.length < 5) continue;
            const [no, f, ln, scene, promptText] = r;
            const isTb = /taobao|tb-/.test(f);
            push(isTb ? tbCats : mtCats, '图片生成默认提示词（initialPrompt）', {
              n: no,
              title: scene.replace(/[（(].*?[)）]/g, '').trim() || scene,
              file: `${f.replace(/`/g, '')} ${ln}`,
              trigger: scene,
              role: '',
              text: promptText.replace(/`/g, ''),
            });
          }
        } else {
          const e = parseEntry(raw);
          const isMt = /^8\.3/.test(raw.titleRaw);
          push(isMt ? mtCats : tbCats, '商品图 / 门头图生成', e);
        }
      }
    } else if (num === '十、') {
      // 卡片历史序列化模板表：一行一个函数模板
      const rows = tableRows(c.bodyLines);
      for (const r of rows) {
        if (r.length < 4) continue;
        const [no, fn, loc, tpl] = r;
        const isTb = fn.startsWith('`tb') || fn.startsWith('tb');
        push(isTb ? tbCats : mtCats, 'AI 可读卡片历史序列化模板', {
          n: no,
          title: fn.replace(/`/g, ''),
          file: loc.replace(/`/g, ''),
          trigger: '聊天中的购物卡片 → 每轮 LLM 历史消息文本',
          role: '',
          text: tpl.replace(/`/g, '').replace(/；/g, '；\n'),
        });
      }
    }
  }

  const mk = (id: string, name: string, desc: string, m: Map<string, LibEntry[]>): LibApp => {
    const categories = [...m.entries()].map(([name2, entries]) => ({ name: name2, entries }));
    const count = categories.reduce((s, c) => s + c.entries.length, 0);
    return { id, name, desc, count, categories };
  };
  return {
    taobao: mk('taobao', '淘宝', 'AI 客服（旺信）/ 商品·信息流·订单生成规则 / 图片生成', tbCats),
    meituan: mk('meituan', '美团', '商家·订单·频道生成规则 / 代付决策 / 图片生成', mtCats),
  };
}

/** 其他模块文档：按 H1 章节分派到各 App；附录A跳过（群聊规则已在微信/QQ 分组），附录B归论坛 */
function buildOthers(): LibApp[] {
  const md = readFileSync(join(SRC, 'system-other-prompts.md'), 'utf-8');
  const { categories } = splitDoc(md);
  const appMap = new Map<string, LibApp>();

  const ensure = (id: string, name: string, desc: string): LibApp => {
    let a = appMap.get(id);
    if (!a) {
      a = { id, name, desc, count: 0, categories: [] };
      appMap.set(id, a);
    }
    return a;
  };

  for (const c of categories) {
    const nameRaw = c.nameRaw;
    const num = nameRaw.match(/^[一二三四五六七八九十]+、/)?.[0] ?? '';
    const entries = catEntries(c);
    if (entries.length === 0) continue;

    if (num === '一、') {
      const app = ensure('global', '全局通用', '所有聊天链路共享的核心人设（七要素）与角色状态卡');
      app.categories.push({ name: '核心角色（七要素人设）', entries });
    } else if (num === '二、') {
      const app = ensure('phone', '电话', '语音 / 视频通话（接听决策·对话·主动来电）');
      app.categories.push({ name: cleanCategoryName(nameRaw), entries });
    } else if (num === '三、') {
      const app = ensure('chat', '信息', '短信 App（iMessage 风格）');
      app.categories.push({ name: '信息 App 规则', entries });
    } else if (num === '四、') {
      const app = ensure('moments', '朋友圈 / QQ空间', '发帖 / 评论 / 回复 / 转发生成');
      app.categories.push({ name: '动态与互动生成', entries });
    } else if (num === '五、') {
      const app = ensure('forum', 'X 论坛', '帖子 / 评论 / 楼中楼 / 私信 / NPC 生成');
      app.categories.push({ name: '论坛生成与互动', entries });
    } else if (num === '六、') {
      const app = ensure('couple', '情侣空间 · 小家', '留言板 / 问答 / 恋爱考试 / 情书 / 小屋行为');
      app.categories.push({ name: '情侣空间与小家', entries });
    } else if (num === '七、') {
      const app = ensure('offline', '线下见面', '见面剧情生成（六态推进 / 文风）');
      app.categories.push({ name: '线下见面剧情', entries });
    } else if (num === '八、') {
      const app = ensure('memory', '记忆系统', '记忆提取 / 总结 / 用户画像 / 小号认出');
      app.categories.push({ name: '记忆提取与召回', entries });
    } else if (num === '九、') {
      const app = ensure('worldbook', '世界书', '世界设定注入与锚点');
      app.categories.push({ name: '世界书', entries });
    } else if (num === '十、') {
      const app = ensure('music', '音乐', '一起听 / 点播 / 推荐');
      app.categories.push({ name: '音乐情境', entries });
    } else if (num === '十一、') {
      const app = ensure('behavior', '情绪与行为逻辑', '回复条数 / 深度思考 / 主动消息 / 焦虑 / 作息 / 时间感知');
      app.categories.push({ name: '情绪与行为', entries });
    } else if (num === '十二、') {
      const app = ensure('global', '全局通用', '所有聊天链路共享的核心人设（七要素）与角色状态卡');
      app.categories.push({ name: '角色状态卡', entries });
    } else if (num === '十三、') {
      const app = ensure('vision', '视觉与头像', '头像近况 / 发图能力 / 识图 / 贴纸');
      app.categories.push({ name: '视觉与头像', entries });
    } else if (num === '十四、') {
      const app = ensure('crossapp', '跨应用与关系', '跨 App 找人 / 好友申请 / 拉黑 / 退群 / 分支');
      app.categories.push({ name: '跨应用与关系', entries });
    } else if (num === '十五、') {
      const app = ensure('tools', '其他工具', '翻译 / 识图 API 等辅助链路');
      app.categories.push({ name: '其他工具', entries });
    } else if (nameRaw.startsWith('附录 B')) {
      const app = ensure('forum', 'X 论坛', '帖子 / 评论 / 楼中楼 / 私信 / NPC 生成');
      app.categories.push({ name: '内置世界观背景数据', entries });
    }
    // 附录 A（群聊社交/群管理）跳过：与微信/QQ 分组群聊类同文
  }

  for (const a of appMap.values()) a.count = a.categories.reduce((s, c) => s + c.entries.length, 0);
  return [...appMap.values()];
}

// ---------------- 主流程 ----------------

function main() {
  mkdirSync(OUT, { recursive: true });

  const wechat = buildWechat();
  const qq = buildQq();
  const { taobao, meituan } = buildTbMt();
  const others = buildOthers();

  const order = ['chat', 'phone', 'moments', 'forum', 'couple', 'offline', 'music', 'memory', 'worldbook', 'behavior', 'vision', 'crossapp', 'global', 'tools'];
  const othersSorted = others.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const apps = [wechat, qq, ...othersSorted.filter((a) => a.id === 'chat'), taobao, meituan, ...othersSorted.filter((a) => a.id !== 'chat')];

  let total = 0;
  for (const app of apps) {
    writeFileSync(join(OUT, `${app.id}.json`), JSON.stringify(app), 'utf-8');
    total += app.count;
    console.log(`✔ ${app.id}.json — ${app.name} ${app.count} 条（${app.categories.map((c) => `${c.name} ${c.entries.length}`).join(' / ')}）`);
  }
  const index = {
    total,
    generatedAt: new Date().toISOString(),
    apps: apps.map((a) => ({ id: a.id, name: a.name, desc: a.desc, count: a.count })),
  };
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index), 'utf-8');
  console.log(`\n共 ${apps.length} 个 App 分组、${total} 条提示词 → public/prompt-library/`);
}

main();
