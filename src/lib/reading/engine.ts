/**
 * 阅读 App · Legado(阅读3.0) 书源规则引擎（服务端专用）
 * ---------------------------------------------------------------------------
 * 设计目标：覆盖主流笔趣阁类站点的 CSS 链规则 + JSON API 规则，让内置精选源与
 * 用户导入的公开书源（无需 JS 的那部分）都能跑通「搜索 → 详情 → 目录 → 正文」。
 *
 * 支持的规则语法子集：
 * - class.NAME / id.NAME / tag.NAME 链式（@ 分隔，段内 .N 取下标，.-1 取末个）
 * - 终结操作：text / textNodes / html / href / src / content / all / alt / title / value / ownText
 * - @css: 前缀（标准 CSS 选择器，多段 @ 分隔，最后一段可为终结操作）
 * - //xpath：轻量 XPath（og:meta 与常用 //tag/@attr 形态，覆盖书籍详情页 meta 标签）
 * - $. / $.. JSONPath（$.a.b / $..books[*] / [0]，API 源）
 * - {{$.field}} / {{field}} 模板（JSON 上下文取值拼接）
 * - || 多路回退（先到先得）、&& 顺序拼接
 * - ##正则##替换 后处理（##a|b = 删除匹配；不写替换=删除）
 * - <js>...</js> / @js: 段直接跳过（沙箱不执行 JS；多数纯 CSS 源不受影响）
 *
 * 网络层：
 * - 全部服务端代理抓取（防 CORS / 防盗链：按站点补 Referer + 移动 UA）
 * - 自动编码探测（charset 参数 > Content-Type > meta 探测 > GB18030 兜底）
 * - GBK 搜索词百分号编码（iconv-lite），POST body 同样按站点编码
 * - 超时 12s、最多 3 次重定向、失败抛中文错误
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI, AnyNode } from 'cheerio';
import iconv from 'iconv-lite';


/** 作者名清洗：去掉「作者：/著」等前后缀 */
function cleanAuthor(a: string): string {
  return a
    .replace(/^(作者|著|文)\s*[:：]?\s*/, '')
    .replace(/\/\s*著$/, '')
    .replace(/\s*著$/, '')
    .trim();
}

/** 标题里的中文数字 → 数值（「一千五百九十三」→1593；纯数字直接转） */
function cnNum(raw: string): number | null {
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (!/[零一二两三四五六七八九十百千万]/.test(raw)) return null;
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let num = 0;
  for (const ch of raw) {
    if (ch in digits) num = digits[ch];
    else if (ch in units) {
      const u = units[ch];
      if (u === 10000) {
        total = (total + section + num) * 10000;
        section = 0;
      } else {
        section += (num || 1) * u;
      }
      num = 0;
    } else return null;
  }
  return total + section + num;
}

/** 章节序号（标题「第三十九章 仪式」→39；无序号返回 null） */
function chapterNo(title: string): number | null {
  const m = /第\s*([\d零一二两三四五六七八九十百千万]+)\s*[章节卷回部]/.exec(title);
  if (!m) return null;
  return cnNum(m[1]);
}

/** 目录倒序检测：前 1/3 序号中位数明显大于后 1/3 → 站点按最新在前排序，翻回来 */
function fixReversedToc(chapters: TocChapter[]): TocChapter[] {
  const pairs = chapters
    .map((c) => chapterNo(c.title))
    .filter((n): n is number => n != null);
  if (pairs.length < 20) return chapters;
  // 守卫：已从第 1/2/3 章开头 = 正序，永不翻转（防尾部最新块误判）
  const headNums = pairs.slice(0, 5).filter((n) => n <= 3);
  if (headNums.length >= 2) return chapters;
  // 四分位中位数趋势：整体单调递减 → 倒序站；混合形态（头最新块/尾最新块）不翻转，
  // 交给 extractMainToc 裁剪
  const q = (lo: number, hi: number) => {
    const seg = pairs.slice(Math.floor(pairs.length * lo), Math.floor(pairs.length * hi));
    if (!seg.length) return 0;
    const sorted = seg.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const q1 = q(0, 0.25);
  const q2 = q(0.25, 0.5);
  const q3 = q(0.5, 0.75);
  const q4 = q(0.75, 1);
  const ascTrend = q2 - q1 + (q3 - q2) + (q4 - q3);
  const descTrend = q1 - q2 + (q2 - q3) + (q3 - q4);
  if (descTrend > Math.max(ascTrend * 1.5, 0) + 100) return [...chapters].reverse();
  return chapters;
}

/**
 * 主目录提取：剥离「最新章节块（头部倒序）」「尾部推荐/续作块」，保留主列表。
 * 算法：带容差的最长非递减 run——序号小幅回退（≤50，站点自身乱序）不断链，
 * 大幅回退（如跳回第1章）才算断点；主 run 需 ≥50% 或 ≥400 项才采纳。
 */
function extractMainToc(chapters: TocChapter[]): TocChapter[] {
  const n = chapters.length;
  if (n < 24) return chapters;
  const nums = chapters.map((c) => chapterNo(c.title));
  const nonNull = nums.filter((x): x is number => x != null);
  if (nonNull.length < n * 0.5) return chapters;
  const TOL = 50;
  // 长列表里「第X部总结」类小序号项（1~9）视同无序号：不打断主 run
  // （诡秘之主列表每个部末尾的 总结/请假 章节序号是 2~7，会人为把主列表切碎）
  const skipSmall = nonNull.length > 50;
  const eff = (v: number | null) => (v == null || (skipSmall && v <= 9) ? null : v);
  let best = { start: 0, len: 0 };
  let i = 0;
  while (i < n) {
    let last = -Infinity;
    let j = i;
    while (j < n) {
      const v = eff(nums[j]);
      if (v != null) {
        if (v < last - TOL) break; // 大幅回退=新块开始
        if (v > last) last = v; // 小回退不更新基线
      }
      j++;
    }
    if (j - i > best.len) best = { start: i, len: j - i };
    if (j >= n) break;
    i = nums[j] != null ? j : j + 1;
  }
  if (best.len < n && (best.len >= n * 0.5 || best.len >= 400)) {
    return chapters.slice(best.start, best.start + best.len);
  }
  return chapters;
}

export interface RuleSearch {
  bookList?: string;
  name?: string;
  author?: string;
  bookUrl?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  checkKeyWord?: string;
  wordCount?: string;
}
export interface RuleBookInfo {
  name?: string;
  author?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  tocUrl?: string;
  wordCount?: string;
  canReName?: string;
}
export interface RuleToc {
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  isVip?: string;
  isVolume?: string;
  nextTocUrl?: string;
}
export interface RuleContent {
  content?: string;
  nextContentUrl?: string;
  replaceRegex?: string;
  webJs?: string;
  sourceRegex?: string;
}
export interface LegadoSource {
  bookSourceName: string;
  bookSourceUrl: string;
  bookSourceGroup?: string;
  enabled?: boolean;
  header?: Record<string, string> | string;
  searchUrl?: string;
  exploreUrl?: string;
  ruleSearch?: RuleSearch;
  ruleExplore?: RuleSearch;
  ruleBookInfo?: RuleBookInfo;
  ruleToc?: RuleToc;
  ruleContent?: RuleContent;
  [k: string]: unknown;
}

export interface SearchBook {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  sourceName: string;
  sourceUrl: string;
}
export interface TocChapter {
  title: string;
  url: string;
  isVip?: boolean;
}
export interface BookInfoResult extends SearchBook {
  tocUrl: string;
  chapters: TocChapter[];
  totalChapters: number;
}

// ---------------------------------------------------------------------------
// 网络层
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function sourceHeaders(source: LegadoSource, pageUrl?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  try {
    let raw = source.header;
    if (typeof raw === 'string' && raw.trim()) {
      raw = JSON.parse(raw) as Record<string, string>;
    }
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) {
        if (typeof v === 'string') h[k] = v;
      }
    }
  } catch {
    /* header 解析失败忽略 */
  }
  const base = source.bookSourceUrl;
  if (!h['Referer'] && base) {
    try {
      h['Referer'] = new URL(base).origin + '/';
    } catch {
      /* ignore */
    }
  }
  if (pageUrl) {
    try {
      h['Referer'] = new URL(pageUrl).origin + '/';
    } catch {
      /* ignore */
    }
  }
  return h;
}

function decodeBody(buf: ArrayBuffer, charset?: string, contentType?: string): string {
  const bytes = Buffer.from(buf);
  let cs = (charset || '').trim().toLowerCase();
  if (!cs && contentType) {
    const m = /charset=([\w-]+)/i.exec(contentType);
    if (m) cs = m[1].toLowerCase();
  }
  if (!cs || cs === 'utf8') cs = 'utf-8';
  if (!['utf-8', 'gbk', 'gb2312', 'gb18030', 'big5', 'utf-16'].includes(cs)) cs = 'utf-8';
  try {
    return iconv.decode(bytes, cs as 'utf-8');
  } catch {
    return Buffer.from(buf).toString('utf-8');
  }
}

export interface FetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  charset?: string;
  timeoutMs?: number;
}
export interface FetchResult {
  text: string;
  finalUrl: string;
  contentType: string;
}

/** 服务端代理抓取（阅读 App 全部出站都走这里：解决 CORS + 防盗链 Referer） */
export async function proxyFetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    // html/json 以外的类型（图片等）原样二进制读（封面探测用不到，防卡死）
    const text = decodeBody(await res.arrayBuffer(), opts.charset, contentType);
    if (!res.ok && res.status >= 400) {
      // 403/412 等反爬页面也可能带可用内容，不直接抛错；仅 >=500 视为失败
      if (res.status >= 500) throw new Error(`站点返回 ${res.status}`);
    }
    return { text, finalUrl: res.url || url, contentType };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 规则求值上下文
// ---------------------------------------------------------------------------

type Ctx =
  | { kind: 'html'; $: CheerioAPI; el?: AnyNode; pageUrl: string }
  | { kind: 'json'; data: unknown; pageUrl: string };

function newHtmlCtx(html: string, pageUrl: string): Ctx {
  const $ = cheerio.load(html);
  return { kind: 'html', $, pageUrl };
}

// —— JSONPath 轻量实现：$.a.b / $..name / [n] / [*] ——
function jsonPathAll(root: unknown, path: string): unknown[] {
  const p = path.replace(/^\$\.?/, '');
  if (!p) return [root];
  const segs = p.replace(/\[(\d+|\*)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown[] = [root];
  let deep = false;
  for (const seg of segs) {
    if (seg === '') {
      deep = true;
      continue;
    }
    const next: unknown[] = [];
    const expand = (node: unknown) => {
      if (node && typeof node === 'object') {
        if (seg === '*') next.push(...(Array.isArray(node) ? node : Object.values(node)));
        else if (Array.isArray(node)) next.push(...node);
        else next.push((node as Record<string, unknown>)[seg]);
      }
    };
    if (deep) {
      // $..name：递归收集
      const walk = (node: unknown) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') {
          expand(node);
          Object.values(node as Record<string, unknown>).forEach(walk);
        }
      };
      walk(cur.length ? cur : [root]);
      deep = false;
    } else {
      cur.forEach(expand);
    }
    cur = next.filter((v) => v !== undefined);
  }
  return cur;
}

function jsonScalar(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return '';
  return String(v);
}

// —— Legado 链式规则（class./id./tag./终结操作）——
const FINAL_OPS = new Set([
  'text',
  'textNodes',
  'ownText',
  'html',
  'href',
  'src',
  'content',
  'all',
  'alt',
  'title',
  'value',
  'data',
]);

interface Seg {
  type: 'class' | 'id' | 'tag' | 'final' | 'index' | 'children' | 'css';
  value: string;
  index?: number;
}

function parseChain(part: string): Seg[] {
  const raw = part.split('@').filter(Boolean);
  const segs: Seg[] = [];
  for (const r of raw) {
    const m = /^(class|id|tag|children)\.(.+)$/.exec(r);
    if (m) {
      let name = m[2];
      let index: number | undefined;
      // 末尾 .N / .-1 视为下标
      const im = /^(.*)\.(-?\d+)$/.exec(name);
      if (im && !FINAL_OPS.has(name)) {
        name = im[1];
        index = parseInt(im[2], 10);
      }
      segs.push({ type: m[1] as Seg['type'], value: name, index });
      continue;
    }
    if (FINAL_OPS.has(r)) {
      segs.push({ type: 'final', value: r });
      continue;
    }
    if (/^-?\d+$/.test(r)) {
      segs.push({ type: 'index', value: r, index: parseInt(r, 10) });
      continue;
    }
    segs.push({ type: 'css', value: r });
  }
  return segs;
}

function scopeSel($: CheerioAPI, el: AnyNode | undefined, sel: string) {
  return el ? $(el).find(sel).addBack(sel) : $(sel);
}

function applyChain(ctx: Extract<Ctx, { kind: 'html' }>, segs: Seg[], asList: boolean): string[] {
  const { $, el } = ctx;
  let nodes: AnyNode[] = el ? [el] : [];
  let scoped = false;
  const out: string[] = [];
  for (const seg of segs) {
    if (seg.type === 'final') {
      for (const n of nodes) {
        const c = $(n);
        switch (seg.value) {
          case 'text':
            out.push(c.text().trim());
            break;
          case 'ownText':
            out.push(
              c
                .contents()
                .filter((_, x) => x.type === 'text')
                .text()
                .trim(),
            );
            break;
          case 'textNodes':
            out.push(
              c
                .contents()
                .filter((_, x) => x.type === 'text')
                .map((_, x) => $(x).text().trim())
                .get()
                .join(' ')
                .trim(),
            );
            break;
          case 'html':
            out.push(c.html() || '');
            break;
          case 'all':
            out.push(
              $.html(c[0] as AnyNode) ||
                (c[0] as unknown as { attribs?: Record<string, string> })?.attribs?.href ||
                '',
            );
            break;
          default:
            out.push(c.attr(seg.value) || '');
        }
      }
      nodes = [];
      continue;
    }
    if (seg.type === 'index') {
      const i = seg.index ?? 0;
      nodes = i < 0 ? (i === -1 ? nodes.slice(-1) : nodes.slice(i)) : nodes.slice(i, i + 1);
      continue;
    }
    if (seg.type === 'children') {
      nodes = nodes.flatMap((n) => $(n).children().toArray());
      continue;
    }
    let sel: string;
    if (seg.type === 'class') {
      // class 名可能含点号（.s2.3 之类罕见）：先按整名查，查不到再按最后一段当下标
      sel = `.${seg.value}`;
    } else if (seg.type === 'id') sel = `#${seg.value}`;
    else if (seg.type === 'tag') sel = seg.value;
    else sel = seg.value; // css
    let found = scoped || el ? scopeSel($, el && !scoped ? el : undefined, sel).toArray() : $(sel).toArray();
    if (seg.type === 'id') found = found.slice(0, 1);
    if (seg.index !== undefined) {
      found = seg.index < 0 ? found.slice(seg.index) : found.slice(seg.index, seg.index + 1);
    }
    nodes = found;
    scoped = true;
    if (!nodes.length && !asList) return [];
  }
  if (!out.length && nodes.length && !segs.some((s) => s.type === 'final')) {
    // 链没写终结操作：默认取 text
    for (const n of nodes) out.push($(n).text().trim());
  }
  return out;
}

/** 拆掉规则里的 <js>...</js> 与 @js: 尾巴（不执行，取其前的静态部分） */
function stripJs(rule: string): string {
  let r = rule;
  const jsTag = r.indexOf('<js>');
  if (jsTag >= 0) r = r.slice(0, jsTag);
  const atJs = r.indexOf('@js:');
  if (atJs >= 0) r = r.slice(0, atJs);
  return r.trim();
}

/** 切出 ##正则##替换 后缀：返回 [主规则, 正则, 替换] */
function splitRegex(rule: string): [string, string, string] {
  const i = rule.indexOf('##');
  if (i < 0) return [rule, '', ''];
  const rest = rule.slice(i + 2);
  const j = rest.indexOf('##');
  if (j >= 0) return [rule.slice(0, i), rest.slice(0, j), rest.slice(j + 2)];
  return [rule.slice(0, i), rest, ''];
}

function applyRegex(val: string, regex: string, replacement: string): string {
  if (!regex) return val;
  try {
    const re = new RegExp(regex, 'g');
    return val.replace(re, replacement);
  } catch {
    return val;
  }
}

/** 顶层 || 切分（## 内的 || 不参与） */
function splitOr(rule: string): string[] {
  const i = rule.indexOf('##');
  if (i >= 0) {
    const head = rule.slice(0, i);
    const tail = rule.slice(i);
    return splitOr(head).map((p, idx) => (idx === 0 ? p + tail : p));
  }
  return rule.split('||');
}

function resolveUrl(u: string, base: string): string {
  if (!u) return u;
  const t = u.trim();
  if (/^https?:\/\//i.test(t)) return t;
  try {
    return new URL(t, base).toString();
  } catch {
    return t;
  }
}

/** 求值单条字符串规则（自动识别 html/json 上下文） */
export function evalRule(ctx: Ctx, rule: string | undefined): string {
  if (!rule) return '';
  const raw = stripJs(rule);
  const parts = splitOr(raw);
  for (const p of parts) {
    const [main, regex, replacement] = splitRegex(p);
    let val = evalSingle(ctx, main);
    if (val) {
      val = applyRegex(val, regex, replacement);
      if (val.trim()) return val.trim();
    }
  }
  return '';
}

function evalSingle(ctx: Ctx, rule: string): string {
  if (!rule) return '';
  const r = rule.trim();
  // && 顺序拼接
  if (r.includes('&&') && !r.startsWith('@css:')) {
    return r
      .split('&&')
      .map((x) => evalSingle(ctx, x))
      .filter(Boolean)
      .join(' ');
  }
  // JSON 上下文
  if (ctx.kind === 'json') {
    if (r.startsWith('$')) return jsonScalar(jsonPathAll(ctx.data, r)[0]);
    if (r.startsWith('{{')) return evalTemplateJson(ctx.data, r);
    return jsonScalar((ctx.data as Record<string, unknown>)?.[r]);
  }
  // HTML 上下文
  if (r.startsWith('$')) {
    // HTML 页面但规则是 JSONPath（少见）：正文 JSON 直接全局解析
    return '';
  }
  if (r.startsWith('{{')) return '';
  if (r.startsWith('@css:')) {
    const segs = parseChain(r.slice(5));
    return applyChain(ctx, segs, false)[0] || '';
  }
  if (r.startsWith('//')) return evalXPathLite(ctx, r);
  const segs = parseChain(r);
  return applyChain(ctx, segs, false)[0] || '';
}

/** 轻量 XPath：//meta[@property='og:xxx']/@content 与 //tag/@attr 两种形态 */
function evalXPathLite(ctx: Extract<Ctx, { kind: 'html' }>, xp: string): string {
  const { $, el } = ctx;
  const meta = /\/\/meta\[@(property|name)='([^']+)'(?:\s+and\s+@(property|name)='([^']+)')?\]\/@(\w+)/.exec(xp);
  if (meta) {
    const attr = meta[2] || meta[4];
    const target = meta[5];
    const nodes = (el ? $(el).find('meta').addBack('meta') : $('meta')).toArray();
    for (const n of nodes) {
      const c = $(n);
      if (c.attr('property') === attr || c.attr('name') === attr) {
        return c.attr(target) || '';
      }
    }
    return '';
  }
  const simple = /^\/\/([\w-]+)(?:\[@([\w-]+)='([^']+)'\])?\/@(\w+)$/.exec(xp);
  if (simple) {
    const [, tag, attrName, attrVal, target] = simple;
    let sel = tag;
    if (attrName) sel += `[${attrName}="${attrVal}"]`;
    const n = (el ? $(el).find(sel) : $(sel)).first();
    return n.attr(target) || n.text().trim();
  }
  return '';
}

function evalTemplateJson(data: unknown, tpl: string): string {
  return tpl.replace(/\{\{\$?\.?([\w.[\]*$]+)\}\}/g, (_, path: string) => {
    if (/^\.\./.test(path)) return jsonScalar(jsonPathAll(data, '$' + path)[0]);
    return jsonScalar(jsonPathAll(data, '$.' + path)[0]);
  });
}

/** 列表规则：返回一组子上下文（html=元素 / json=对象） */
export function evalList(ctx: Ctx, rule: string | undefined): Ctx[] {
  if (!rule) return [];
  const raw = stripJs(rule);
  const [main, regex, replacement] = splitRegex(raw);
  const pick = (list: Ctx[]): Ctx[] => {
    if (!regex) return list;
    return list.filter((c) => evalRule(c, `text##${regex}##${replacement}`) !== '' || c.kind === 'json');
  };
  if (ctx.kind === 'json') {
    const vals = main.startsWith('$') ? jsonPathAll(ctx.data, main) : [];
    return pick(vals.map((v) => ({ kind: 'json', data: v, pageUrl: ctx.pageUrl }) as Ctx));
  }
  // html：先按 || 逐路尝试
  for (const part of splitOr(main)) {
    const [p, ,] = splitRegex(part);
    let segs: Seg[];
    if (p.startsWith('@css:')) segs = parseChain(p.slice(5));
    else segs = parseChain(p);
    if (p.startsWith('//')) {
      // XPath 列表：仅支持 //tag[@class='x'] 收集元素
      const m = /^\/\/([\w-]+)(?:\[@([\w-]+)='([^']+)'\])?$/.exec(p);
      if (m) {
        const [, tag, an, av] = m;
        const sel = an ? `${tag}[${an}="${av}"]` : tag;
        const els = (ctx.el ? ctx.$.find(sel) : ctx.$(sel)).toArray();
        if (els.length) return pick(els.map((e) => ({ kind: 'html', $: ctx.$, el: e, pageUrl: ctx.pageUrl }) as Ctx));
      }
      continue;
    }
    // 去掉终结段，最后一段作为集合选择器
    const last = segs[segs.length - 1];
    let listSel: string;
    if (last && (last.type === 'class' || last.type === 'id' || last.type === 'tag' || last.type === 'css')) {
      segs = segs.slice(0, -1);
      listSel =
        last.type === 'class' ? `.${last.value}` : last.type === 'id' ? `#${last.value}` : last.value;
    } else if (last && last.type === 'final') {
      listSel = '';
    } else listSel = '';
    // 先逐段下钻到倒数第二段
    let scopeEl: AnyNode | undefined = ctx.el;
    for (const seg of segs) {
      if (seg.type === 'final') break;
      const sel =
        seg.type === 'class' ? `.${seg.value}` : seg.type === 'id' ? `#${seg.value}` : seg.type === 'tag' ? seg.value : seg.value;
      const found = scopeSel(ctx.$, scopeEl, sel).toArray();
      if (seg.index !== undefined) {
        const f2 = seg.index < 0 ? found.slice(seg.index) : found.slice(seg.index, seg.index + 1);
        scopeEl = f2[0];
      } else scopeEl = found[0];
      if (!scopeEl) break;
    }
    if (listSel) {
      const els = scopeSel(ctx.$, scopeEl, listSel).toArray();
      if (els.length) return pick(els.map((e) => ({ kind: 'html', $: ctx.$, el: e, pageUrl: ctx.pageUrl }) as Ctx));
    } else if (scopeEl) {
      return pick([{ kind: 'html', $: ctx.$, el: scopeEl, pageUrl: ctx.pageUrl }]);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// URL 解析（searchUrl / exploreUrl：{{key}}/{{page}} + 尾部 JSON 选项）
// ---------------------------------------------------------------------------

export interface ParsedUrl {
  url: string;
  method: string;
  body?: string;
  charset?: string;
  headers?: Record<string, string>;
}

function gbkUrlEncode(s: string, charset?: string): string {
  const cs = (charset || 'utf-8').toLowerCase();
  if (cs === 'utf-8' || cs === 'utf8') return encodeURIComponent(s);
  try {
    const buf = iconv.encode(s, cs as 'gbk');
    let out = '';
    for (const b of buf) {
      const ch = String.fromCharCode(b);
      out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
  } catch {
    return encodeURIComponent(s);
  }
}

export function parseUrlTpl(
  tpl: string,
  sourceUrl: string,
  vars: Record<string, string>,
): ParsedUrl {
  let urlPart = stripJs(tpl).trim();
  const opts: { method?: string; body?: string; charset?: string; headers?: Record<string, string> } = {};
  // 尾部 ,{...} 选项
  const braceAt = urlPart.lastIndexOf(',{');
  if (braceAt >= 0) {
    try {
      const o = JSON.parse(urlPart.slice(braceAt + 1)) as Record<string, unknown>;
      if (o && typeof o === 'object') {
        if (typeof o.method === 'string') opts.method = o.method.toUpperCase();
        if (typeof o.body === 'string') opts.body = o.body;
        if (typeof o.charset === 'string') opts.charset = o.charset;
        if (o.headers && typeof o.headers === 'object') opts.headers = o.headers as Record<string, string>;
        urlPart = urlPart.slice(0, braceAt).trim();
      }
    } catch {
      /* 选项解析失败当作普通 URL */
    }
  }
  // 变量替换（key 按 charset 百分号编码）
  urlPart = urlPart.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (k === 'key' || k === 'page' || vars[k] !== undefined) {
      const v = vars[k] ?? '';
      if (k === 'key') return gbkUrlEncode(v, opts.charset);
      return encodeURIComponent(v);
    }
    return m;
  });
  if (opts.body) {
    opts.body = opts.body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
      const v = vars[k] ?? '';
      if (k === 'key') return gbkUrlEncode(v, opts.charset);
      return encodeURIComponent(v);
    });
  }
  return {
    url: resolveUrl(urlPart, sourceUrl),
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    body: opts.body,
    charset: opts.charset,
    headers: opts.headers,
  };
}

async function fetchCtx(source: LegadoSource, p: ParsedUrl): Promise<{ ctx: Ctx; finalUrl: string }> {
  const headers = { ...sourceHeaders(source, p.url), ...(p.headers || {}) };
  const res = await proxyFetch(p.url, {
    method: p.method,
    headers,
    body: p.body,
    charset: p.charset,
  });
  const trimmed = res.text.trimStart();
  let ctx: Ctx;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      ctx = { kind: 'json', data: JSON.parse(trimmed), pageUrl: res.finalUrl };
    } catch {
      ctx = newHtmlCtx(res.text, res.finalUrl);
    }
  } else {
    ctx = newHtmlCtx(res.text, res.finalUrl);
  }
  return { ctx, finalUrl: res.finalUrl };
}

// ---------------------------------------------------------------------------
// 业务流程：搜索 / 详情 / 目录 / 正文
// ---------------------------------------------------------------------------

export async function searchBooks(source: LegadoSource, key: string): Promise<SearchBook[]> {
  if (!source.searchUrl) return [];
  const p = parseUrlTpl(source.searchUrl, source.bookSourceUrl, { key, page: '1' });
  const { ctx } = await fetchCtx(source, p);
  const rs = source.ruleSearch || {};
  const list = evalList(ctx, rs.bookList);
  const out: SearchBook[] = [];
  const cleanName = (n: string) =>
    n
      .replace(/(搜索结果|搜索|的结果|结果)$/g, '')
      .replace(/^《|》$/g, '')
      .replace(/[_\-—|·]+\s*(作者|著)\s*[:：].*$/, '')
      .trim();
  for (const item of list.slice(0, 30)) {
    const name = cleanName(evalRule(item, rs.name));
    let bookUrl = evalRule(item, rs.bookUrl);
    if (!name || !bookUrl) continue;
    bookUrl = resolveUrl(bookUrl, item.pageUrl || p.url);
    // name 里可能带作者（"书名：作者"）常见于笔趣阁搜索页
    let author = cleanAuthor(evalRule(item, rs.author));
    let intro = evalRule(item, rs.intro);
    if (!author && name.includes('：')) {
      const [n, a] = name.split('：');
      if (n && a) {
        out.push({
          name: n.trim(),
          author: cleanAuthor(a),
          bookUrl,
          coverUrl: resolveUrl(evalRule(item, rs.coverUrl), item.pageUrl || p.url) || undefined,
          intro: intro || undefined,
          kind: evalRule(item, rs.kind) || undefined,
          lastChapter: evalRule(item, rs.lastChapter) || undefined,
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
        });
        continue;
      }
    }
    out.push({
      name: name.trim(),
      author: cleanAuthor(author),
      bookUrl,
      coverUrl: resolveUrl(evalRule(item, rs.coverUrl), item.pageUrl || p.url) || undefined,
      intro: intro || undefined,
      kind: evalRule(item, rs.kind) || undefined,
      lastChapter: evalRule(item, rs.lastChapter) || undefined,
      sourceName: source.bookSourceName,
      sourceUrl: source.bookSourceUrl,
    });
  }
  return out;
}

export async function getBookInfo(
  source: LegadoSource,
  bookUrl: string,
): Promise<BookInfoResult> {
  const { ctx } = await fetchCtx(source, { url: bookUrl, method: 'GET' });
  const rb = source.ruleBookInfo || {};
  const name = evalRule(ctx, rb.name) || '';
  const author = cleanAuthor(evalRule(ctx, rb.author));
  const coverUrl = resolveUrl(evalRule(ctx, rb.coverUrl), bookUrl);
  const intro = evalRule(ctx, rb.intro);
  const lastChapter = evalRule(ctx, rb.lastChapter);
  let tocUrl = resolveUrl(evalRule(ctx, rb.tocUrl), bookUrl) || bookUrl;
  // 目录页可能就是详情页（常见笔趣阁：bookUrl 即目录页）
  const chapters = await getTocFrom(source, tocUrl, ctx);
  return {
    name,
    author,
    bookUrl,
    coverUrl,
    intro,
    lastChapter,
    tocUrl,
    chapters: chapters.chapters,
    totalChapters: chapters.chapters.length,
    sourceName: source.bookSourceName,
    sourceUrl: source.bookSourceUrl,
  };
}

async function getTocFrom(source: LegadoSource, tocUrl: string, infoCtx?: Ctx) {
  const rt = source.ruleToc || {};
  let ctx = infoCtx;
  let finalUrl = tocUrl;
  if (!ctx || (ctx.pageUrl !== tocUrl && tocUrl)) {
    const r = await fetchCtx(source, { url: tocUrl, method: 'GET' });
    ctx = r.ctx;
    finalUrl = r.finalUrl;
  }
  const chapters: TocChapter[] = [];
  const seen = new Set<string>();
  let list = evalList(ctx, rt.chapterList);
  for (const item of list) {
    const title = evalRule(item, rt.chapterName) || evalRule(item, 'text');
    let url = evalRule(item, rt.chapterUrl) || evalRule(item, 'href');
    if (!title || !url) continue;
    url = resolveUrl(url, item.pageUrl || finalUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    chapters.push({ title: title.trim(), url, isVip: evalRule(item, rt.isVip) ? true : undefined });
  }
  // 目录翻页（nextTocUrl，最多 20 页防失控）
  let next = evalRule(ctx, rt.nextTocUrl);
  let guard = 0;
  while (next && guard < 20) {
    const nu = resolveUrl(next, finalUrl);
    if (seen.has(nu)) break;
    try {
      const r = await fetchCtx(source, { url: nu, method: 'GET' });
      const nextList = evalList(r.ctx, rt.chapterList);
      for (const item of nextList) {
        const title = evalRule(item, rt.chapterName) || evalRule(item, 'text');
        let url = evalRule(item, rt.chapterUrl) || evalRule(item, 'href');
        if (!title || !url) continue;
        url = resolveUrl(url, item.pageUrl || r.finalUrl);
        if (seen.has(url)) continue;
        seen.add(url);
        chapters.push({ title: title.trim(), url });
      }
      finalUrl = r.finalUrl;
      next = evalRule(r.ctx, rt.nextTocUrl);
    } catch {
      break;
    }
    guard++;
  }
  const fixed = extractMainToc(fixReversedToc(chapters));
  return { chapters: fixed };
}

export async function getToc(source: LegadoSource, tocUrl: string) {
  return getTocFrom(source, tocUrl);
}

/** HTML 片段 → 纯文本（段落感保留：块级换行/br换行/实体解码） */
export function htmlToText(html: string): string {
  if (!html) return '';
  let h = html;
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|h\d|li|blockquote)>/gi, '\n');
  h = h.replace(/<(p|div|h\d)[^>]*>/gi, '\n');
  // 剩余标签清除（script/style 整段删）
  h = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<[^>]+>/g, '');
  // 实体解码（走 cheerio 保证准确）
  const $ = cheerio.load(`<div id="d">${h}</div>`);
  let text = $('#d').text();
  // 规整空白
  text = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/** 常见反防盗/广告行（内置兜底，书源 replaceRegex 之外再过一道） */
const NOISE_RE =
  /(笔趣阁|全本小说网|飘天文学|起点中文|棉花糖|顶点小说|八一中文|言情后花园|书客吧|最快更新|最新章节|首发域名|请记住|一秒记住|章节错误|举报|加入书签|求收藏|求推荐票|求月票|百度搜索|谷歌搜索|【?看书领红包?】|关注.{0,12}(公众号|现金红包)|更多精彩|手打吧|人工推荐|client\.qq\.com|m\.qq\.com.{0,20}(read|book)|\(本章完\))/;

export async function getChapter(
  source: LegadoSource,
  chapterUrl: string,
): Promise<{ title: string; content: string; nextUrl?: string }> {
  const { ctx, finalUrl } = await fetchCtx(source, { url: chapterUrl, method: 'GET' });
  const rc = source.ruleContent || {};
  const raw = evalRule(ctx, rc.content);
  let text = htmlToText(raw)
    .replace(/\*{1,3}/g, '')
    .replace(/[ \t]{2,}/g, ' ');
  // 书源替换规则
  if (rc.replaceRegex) {
    const [, regex, replacement] = splitRegex('x' + rc.replaceRegex);
    const rr = rc.replaceRegex.replace(/^#*/, '');
    const sp = rr.split('##');
    if (sp.length >= 2) text = applyRegex(text, sp[0], sp[1]);
    else text = applyRegex(text, rr, '');
  }
  // 句内噪声清洗：网址/域名/首发域名宣传句（混在正文段落里的也清掉）
  text = text
    .replace(/https?:\/\/[^\s，。；、]+/g, '')
    .replace(/请记住[^。！？]{0,40}[。！？]?/g, '')
    .replace(/(首发域名|手机版阅读网址|最新章节|无弹窗|全文阅读|小说网址)[^。！？]{0,50}[。！？]?/g, '')
    .replace(/[\w-]+\.(com|net|cc|org|la|info|me|cn|xyz|top)(\/[^\s，。；、]*)?/g, '')
    .replace(/[ \t]{2,}/g, ' ');
  // 噪声行过滤
  const lines = text.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (cleaned.length && cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    // 整行都是噪声（很短且命中词库）
    if (t.length <= 60 && NOISE_RE.test(t)) continue;
    cleaned.push(t);
  }
  text = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // 正文内标题去重（正文第一行常与章节标题重复）
  const title = (ctx.kind === 'html' ? evalRule(ctx, '//h1/@text') : '') || '';
  if (title && text.startsWith(title.trim())) text = text.slice(title.trim().length).trim();
  const nextUrl0 = resolveUrl(evalRule(ctx, rc.nextContentUrl), finalUrl) || undefined;
  // 正文太短且站点提供下一页 → 自动跟随拼接（Legado 同款策略，最多 3 页）
  let full = text;
  let next = nextUrl0;
  let pages = 1;
  while (full.length < 1500 && next && pages < 3) {
    try {
      const r2 = await fetchCtx(source, { url: next, method: 'GET' });
      const seg = htmlToText(evalRule(r2.ctx, rc.content));
      if (!seg.trim() || seg.trim() === full.trim()) break;
      full = full + '\n' + seg;
      next = resolveUrl(evalRule(r2.ctx, rc.nextContentUrl), r2.finalUrl) || undefined;
      pages++;
    } catch {
      break;
    }
  }
  text = full.replace(/\n{3,}/g, '\n\n').trim();
  return { title, content: text, nextUrl: nextUrl0 };
}

/** 书源健康检查：搜一个常见词，能出结果即 ok */
export async function checkSource(source: LegadoSource, key = '剑'): Promise<boolean> {
  try {
    const rs = await searchBooks(source, source.ruleSearch?.checkKeyWord || key);
    return rs.length > 0;
  } catch {
    return false;
  }
}
