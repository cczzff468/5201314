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
 * - .N:M:S 区间下标（含两端，负数倒着数，start>end 反向取；td.0:5:3 = 第0/3个）
 * - !N:M 排除下标（tr!0 = 全部 tr 去掉表头行）
 * - text.关键字 内容选择器（text.下一页@href：找含「下一页」的最深层元素取链接）
 * - %% 依次取数（多列表交替合并）
 * - <js>...</js> / @js: 段直接跳过（沙箱不执行 JS；多数纯 CSS 源不受影响）
 *
 * 网络层：
 * - 全部服务端代理抓取（防 CORS / 防盗链：按站点补 Referer + 移动 UA）
 * - 与 Legado(okhttp) 同款宽松证书策略：书源站点证书普遍过期/自签，一律信任
 *  （阅读App默认信任所有证书——这是「源在阅读App可用、在我们站无效」的主因之一）
 * - 自动编码探测（charset 参数 > Content-Type > meta 探测 > GB18030 兜底）
 * - GBK 搜索词百分号编码（iconv-lite），POST body 同样按站点编码
 * - 超时 12s、最多 3 次重定向、失败抛中文错误
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import iconv from 'iconv-lite';
import dns from 'node:dns';
import { Agent as UndiciAgent } from 'undici';
import { runLegadoJs, runLegadoJsSync, type HttpReq, type HttpResp } from './js-sandbox';

// 容器/沙箱网络常无 IPv6 出口，而不少笔趣阁站解析出 AAAA 记录——
// fetch（undici）会优先尝试 IPv6 → ENETUNREACH/ETIMEDOUT。全局 IPv4 优先。
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* 老版本 Node 无此 API，忽略 */
}

/** 宽松证书 dispatcher：笔趣阁类小站证书普遍过期/自签（阅读App/okhttp 默认信任所有
 *  证书，Node 严格校验会抛 certificate has expired → 源全部失效）。仅书源抓取使用。 */
const INSECURE_AGENT = new UndiciAgent({ connect: { rejectUnauthorized: false } });

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
  [k: string]: unknown;
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
  [k: string]: unknown;
}
export interface RuleToc {
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  isVip?: string;
  isVolume?: string;
  nextTocUrl?: string;
  [k: string]: unknown;
}
export interface RuleContent {
  content?: string;
  nextContentUrl?: string;
  replaceRegex?: string;
  webJs?: string;
  sourceRegex?: string;
  [k: string]: unknown;
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
  // 头值消毒：书源 URL 常带 #表情锚点（如 https://x.cc#🎃）——非 ASCII 头值会让
  // Node fetch 直接抛 ByteString 异常。去掉 # 之后的部分 + 非可见 ASCII 字符。
  for (const k of Object.keys(h)) {
    h[k] = h[k].split('#')[0].replace(/[^\x20-\x7E]/g, '');
    if (!h[k]) delete h[k];
  }
  return h;
}

function decodeBody(buf: ArrayBuffer, charset?: string, contentType?: string): { text: string; charset: string } {
  const bytes = Buffer.from(buf);
  let cs = (charset || '').trim().toLowerCase();
  if (!cs && contentType) {
    const m = /charset=([\w-]+)/i.exec(contentType);
    if (m) cs = m[1].toLowerCase();
  }
  // 无任何声明时嗅探 <meta charset=gb2312">（晋江等老站 Content-Type 不带 charset，
  // 直接按 UTF-8 解会整页乱码）
  if (!cs) {
    const head = bytes.subarray(0, 1024).toString('latin1');
    const m = /charset\s*=\s*["']?\s*(gb2312|gbk|gb18030|big5|utf-8)/i.exec(head);
    if (m) cs = m[1].toLowerCase();
  }
  if (!cs || cs === 'utf8') cs = 'utf-8';
  if (!['utf-8', 'gbk', 'gb2312', 'gb18030', 'big5', 'utf-16'].includes(cs)) cs = 'utf-8';
  if (cs === 'gb2312') cs = 'gb18030'; // gb2312 字库太小，生僻字会抛错
  try {
    return { text: iconv.decode(bytes, cs as 'utf-8'), charset: cs };
  } catch {
    return { text: Buffer.from(buf).toString('utf-8'), charset: 'utf-8' };
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
  /** 本次响应实际使用的解码字符集（GBK 自动重试判断用） */
  charset: string;
  /** 响应头（小写键） */
  headers: Record<string, string>;
  /** HTTP 状态码（网络层失败时为 0） */
  status: number;
}

/** JS 挑战页检测（飞卢等站反爬）：极短页面 + window.open(_self) + cookie 赋值
 *  （cookie 赋值可能是混淆形式：window[_$x[0]].cookie="..."，document 藏在变量里） */
function isJsChallenge(t: string): boolean {
  return (
    t.length < 1400 &&
    /window\.open\([^)]*,\s*['"]_self['"]\)/.test(t) &&
    /\.cookie\s*=\s*["'][^"']+["']/.test(t)
  );
}
/** 从挑战页提取 cookie 值（「C3VK=xxx; path=/; max-age=300」→「C3VK=xxx」，路径/时效属性剔除） */
function challengeCookie(t: string): string {
  const raw = t.match(/\.cookie\s*=\s*["']([^"']+)["']/)?.[1] || '';
  return raw
    .split(';')
    .map((s) => s.trim())
    .find((s) => s && !/^(path|max-age|expires|domain|secure|samesite|httponly)/i.test(s)) || '';
}

/** 服务端代理抓取（阅读 App 全部出站都走这里：解决 CORS + 防盗链 Referer）
 *  - 瞬时网络错误（ETIMEDOUT/ECONNRESET/DNS 抖动等）自动重试 1 次——
 *    笔趣阁类小站出口不稳定，单次失败率不低，重试能把可用源明显拉起来
 *  - JS 挑战页（window.open(_self)+document.cookie）：自动提取挑战 cookie 应答重试
 *    （飞卢等站的标准反爬，浏览器执行 JS 后放行；服务端模拟该应答）
 *  - 反爬重定向循环（检测到浏览器 UA/Referer 就无限 302）：剥掉全部
 *    请求头裸请求重试一次（服务器对非浏览器客户端放行，Legado 的 okhttp UA 同理） */
export async function proxyFetch(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  // URL 里的非 ASCII 字符（JS 脚本拼出的中文搜索词等）→ 百分号编码
  // （阅读App 的 okhttp 自动做这件事；Bun/Node fetch 遇到裸中文直接报 Invalid URL）
  if (/[^\x00-\x7F]/.test(url)) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/[^\x00-\x7F]+/g, (s) => encodeURIComponent(s));
      u.search = u.search.replace(/[^\x00-\x7F]+/g, (s) => encodeURIComponent(s));
      url = u.toString();
    } catch {
      url = url.replace(/[^\x00-\x7F]+/g, (s) => encodeURIComponent(s));
    }
  }
  const attempt = async (bare = false): Promise<FetchResult> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
    try {
      // 头值消毒：书源自定义 header 可能带非 ASCII（emoji 锚点等）——HTTP 头只允许可见 ASCII
      const headers: Record<string, string> = {};
      if (!bare) {
        for (const [k, v] of Object.entries(opts.headers || {})) {
          const val = String(v).split('#')[0].replace(/[^\x20-\x7E]/g, '');
          if (val) headers[k] = val;
        }
      }
      const doFetch = (extra?: Record<string, string>) =>
        fetch(url, {
          method: opts.method || 'GET',
          headers: { ...headers, ...(extra || {}) },
          body: opts.body,
          redirect: 'follow',
          signal: ctrl.signal,
          cache: 'no-store',
          // 宽松证书（过期/自签一律放行，与阅读App一致）：
          // - Node 运行时：undici dispatcher 生效
          // - Bun 运行时（本站 dev/prod 均为 Bun）：fetch 原生支持 tls 选项
          dispatcher: INSECURE_AGENT,
          tls: { rejectUnauthorized: false },
        } as RequestInit);
      let res = await doFetch();
      let contentType = res.headers.get('content-type') || '';
      let d = decodeBody(await res.arrayBuffer(), opts.charset, contentType);
      let text = d.text;
      let usedCharset = d.charset;
      // JS 挑战页 → 提取 cookie 应答重试一次（浏览器执行 JS 的等效行为）
      if (isJsChallenge(text)) {
        const ck = challengeCookie(text);
        if (ck) {
          try {
            const res2 = await doFetch({ Cookie: ck });
            const d2 = decodeBody(await res2.arrayBuffer(), opts.charset, res2.headers.get('content-type') || contentType);
            if (d2.text.length > text.length) {
              res = res2;
              text = d2.text;
              usedCharset = d2.charset;
              contentType = res2.headers.get('content-type') || contentType;
            }
          } catch {
            /* 应答失败保留原响应 */
          }
        }
      }
      if (!res.ok && res.status >= 400) {
        // 403/412 等反爬页面也可能带可用内容，不直接抛错；仅 >=500 视为失败
        if (res.status >= 500) throw new Error(`站点返回 ${res.status}`);
      }
      const respHeaders: Record<string, string> = {};
      try {
        for (const [k, v] of (res.headers as unknown as Iterable<[string, string]>)) {
          respHeaders[k.toLowerCase()] = v;
        }
      } catch {
        /* headers 遍历失败不影响主流程 */
      }
      return { text, finalUrl: res.url || url, contentType, charset: usedCharset, headers: respHeaders, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (e) {
    // 反爬重定向循环 → 裸头重试（无 UA/Referer/Accept，服务器放行非浏览器客户端）
    const redirectLoop =
      e instanceof Error &&
      /redirect count exceeded/i.test(`${e.message} ${(e as Error & { cause?: { message?: string } }).cause?.message || ''}`);
    if (redirectLoop) {
      try {
        return await attempt(true);
      } catch {
        /* 裸重试也失败 → 走常规重试/抛错 */
      }
    }
    const transient =
      e instanceof Error &&
      (e.message === 'fetch failed' ||
        e.message.includes('aborted') ||
        /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|socket hang up|socket connection was closed|connection closed/i.test(
          `${e.message} ${(e as Error & { cause?: { code?: string } }).cause?.code || ''} ${(e as Error & { cause?: { message?: string } }).cause?.message || ''}`,
        ));
    if (!transient) throw e;
    await new Promise((r) => setTimeout(r, 900));
    return attempt();
  }
}

// ---------------------------------------------------------------------------
// 规则求值上下文
// ---------------------------------------------------------------------------

type Ctx =
  | { kind: 'html'; $: CheerioAPI; el?: AnyNode; pageUrl: string; source?: LegadoSource }
  | { kind: 'json'; data: unknown; pageUrl: string; source?: LegadoSource }
  | { kind: 'regex'; groups: string[]; full: string; pageUrl: string; source?: LegadoSource };

function newHtmlCtx(html: string, pageUrl: string, source?: LegadoSource): Ctx {
  const $ = cheerio.load(html);
  return { kind: 'html', $, pageUrl, source };
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
  type: 'class' | 'id' | 'tag' | 'text' | 'final' | 'index' | 'children' | 'css';
  value: string;
  index?: number;
  /** Legado 区间下标 [start:end:step]（含两端；负数倒着数；start>end 反向取） */
  range?: [number | undefined, number | undefined, number | undefined];
  /** Legado 排除下标（tr!0 = 去掉第0个；可多个冒号分隔） */
  exclude?: number[];
}

type SegPos = Pick<Seg, 'index' | 'range' | 'exclude'>;

/** Legado 位置段解析：`N`（单下标）| `N:M[:S]`（区间）| `!E1:E2`（排除）| 组合 `N!E`
 *  返回 null = 不是位置语法（是名字的一部分，如 CSS 类名） */
function parsePosition(p: string): SegPos | null {
  if (!p) return {};
  let rest = p;
  let exclude: number[] | undefined;
  const bang = rest.indexOf('!');
  if (bang >= 0) {
    exclude = rest
      .slice(bang + 1)
      .split(':')
      .map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
    rest = rest.slice(0, bang);
  }
  const pos: SegPos = {};
  if (exclude?.length) pos.exclude = exclude;
  if (!rest) return pos;
  if (/^-?\d+$/.test(rest)) {
    pos.index = parseInt(rest, 10);
    return pos;
  }
  // 区间 start:end:step（start 可省略=0；end 可省略=-1 即末尾）
  const m = /^(-?\d+)?:(-?\d+)?(?::(-?\d+)?)?$/.exec(rest);
  if (m) {
    pos.range = [
      m[1] !== undefined ? parseInt(m[1], 10) : 0,
      m[2] !== undefined ? parseInt(m[2], 10) : -1,
      m[3] !== undefined ? parseInt(m[3], 10) : 1,
    ];
    return pos;
  }
  return null; // 不是位置语法（可能只是名字的一部分）
}

/** 尾部方括号位置语法：li[0:19] / a[2] / div[-1] / li[!0]（CSS 属性选择器 [href] 不受影响）
 *  Legado 与 .N 下标语法等价的另一种写法 */
function splitBracket(name: string): { name: string; pos: SegPos | null } {
  const m = /^(.*?)\[\s*(-?[\d!:.]+)\s*\]\s*$/.exec(name);
  if (!m || !m[1] || !m[2]) return { name, pos: null };
  const pos = parsePosition(m[2]);
  if (!pos) return { name, pos: null };
  if (pos.index === undefined && !pos.range && !pos.exclude?.length) return { name, pos: null };
  return { name: m[1], pos };
}

/** Legado 区间取元素：[start:end:step] 含两端；负数倒着数；start>end 反向取（[-1:0] 列表反向） */
function pickRange<T>(arr: T[], r: [number | undefined, number | undefined, number | undefined]): T[] {
  const L = arr.length;
  if (!L) return [];
  const s0 = r[0] ?? 0;
  const e0 = r[1] ?? -1;
  const s = s0 < 0 ? Math.max(0, s0 + L) : s0;
  const e = e0 < 0 ? e0 + L : Math.min(e0, L - 1);
  const step = Math.abs(r[2] ?? 1) || 1;
  const out: T[] = [];
  if (s <= e) {
    for (let i = s; i <= Math.min(e, L - 1); i += step) out.push(arr[i]);
  } else {
    for (let i = Math.min(s, L - 1); i >= Math.max(0, e); i -= step) out.push(arr[i]);
  }
  return out;
}

/** 元素集应用位置：先排除（!）→ 区间（:）→ 单下标（.N） */
function applyPosition<T>(list: T[], seg: SegPos): T[] {
  let out = list;
  if (seg.exclude?.length) {
    const L = list.length;
    const skip = new Set<number>();
    for (const e of seg.exclude) skip.add(e < 0 ? e + L : e);
    out = out.filter((_, i) => !skip.has(i));
  }
  if (seg.range) {
    out = pickRange(out, seg.range);
  } else if (seg.index !== undefined) {
    const i = seg.index;
    out = i < 0 ? (i === -1 ? out.slice(-1) : out.slice(i)) : out.slice(i, i + 1);
  }
  return out;
}

function parseChain(part: string): Seg[] {
  const raw = part.split('@').filter(Boolean);
  const segs: Seg[] = [];
  for (const r of raw) {
    // text.关键字：按文本内容选元素（text.下一页@href）
    if (r.startsWith('text.')) {
      const tm = /^text\.(.+?)(?:\.(-?\d+))?$/.exec(r);
      if (tm && tm[1]) {
        segs.push({ type: 'text', value: tm[1], index: tm[2] !== undefined ? parseInt(tm[2], 10) : undefined });
        continue;
      }
    }
    const m = /^(class|id|tag|children)\.(.+)$/.exec(r);
    if (m) {
      if (m[1] === 'children') {
        // children 可带位置：children.0 / children.0:2
        const pos = parsePosition(m[2]);
        segs.push({ type: 'children', value: '', ...(pos || {}) });
        continue;
      }
      // 名字与位置拆分：最后一个 . 段若能被位置语法解析 → 位置；否则并入名字（类名含点）
      let name = m[2];
      let pos: SegPos | null = null;
      const lastDot = m[2].lastIndexOf('.');
      if (lastDot >= 0) {
        const p2 = parsePosition(m[2].slice(lastDot + 1));
        if (p2) {
          pos = p2;
          name = m[2].slice(0, lastDot);
        }
      }
      if (!pos) {
        // 方括号位置：tag.li[0:19] / class.x[2]
        const br = splitBracket(name);
        if (br.pos) {
          pos = br.pos;
          name = br.name;
        }
      }
      if (!pos) {
        // 排除直接跟在名字后：tag.li!0 / class.x!0:2
        const bang = m[2].indexOf('!');
        if (bang >= 0) {
          const p3 = parsePosition(m[2].slice(bang));
          if (p3) {
            pos = p3;
            name = m[2].slice(0, bang);
          }
        }
      }
      segs.push({ type: m[1] as Seg['type'], value: name, ...(pos || {}) });
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
    // Legado 简写：.name / .name.N / .name.0:2 / .name!0 / .name[0:19]
    if (r.startsWith('.') && r.length > 1) {
      const rest = r.slice(1);
      let name = rest;
      let pos: SegPos | null = null;
      const lastDot = rest.lastIndexOf('.');
      if (lastDot >= 0) {
        const p2 = parsePosition(rest.slice(lastDot + 1));
        if (p2) {
          pos = p2;
          name = rest.slice(0, lastDot);
        }
      }
      if (!pos) {
        const br = splitBracket(name);
        if (br.pos) {
          pos = br.pos;
          name = br.name;
        }
      }
      if (!pos) {
        const bang = rest.indexOf('!');
        if (bang >= 0) {
          const p3 = parsePosition(rest.slice(bang));
          if (p3) {
            pos = p3;
            name = rest.slice(0, bang);
          }
        }
      }
      if (pos && name) {
        segs.push({ type: 'class', value: name, ...pos });
        continue;
      }
      // 位置不合法 → 整段按 CSS 处理（如 .panel-body > div）
    }
    // Legado 简写：裸标签 + 可选位置（td / td.0 / td.0:5:3 / td!0）；
    // 位置不合法时整段按 CSS 处理（如 div.panel > a）
    const bt = /^([A-Za-z][\w-]*?)(?:[.!](.+))?$/.exec(r);
    if (bt && bt[1]) {
      const posRaw = bt[2] || '';
      const pos = posRaw ? parsePosition(posRaw) : {};
      if (pos) {
        segs.push({ type: 'tag', value: bt[1], ...pos });
        continue;
      }
    }
    // 裸标签方括号位置：td[0:19] / li[-1]（CSS 属性选择器 [href] 不命中位置语法 → 走 CSS）
    if (/\[[\d!:.]+\]\s*$/.test(r)) {
      const br = splitBracket(r);
      if (br.pos) {
        segs.push({ type: 'tag', value: br.name, ...br.pos });
        continue;
      }
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
  // 区间/排除语法显式选择了多个元素 → 终结操作把多个值拼接（td.0:5:3@text = 两个 td 的文本合并）
  const multiSel = segs.some((s) => s.range !== undefined || (s.exclude?.length ?? 0) > 0);
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
      let kids = nodes.flatMap((n) => $(n).children().toArray());
      if (seg.index !== undefined || seg.range || seg.exclude?.length) kids = applyPosition(kids, seg);
      nodes = kids;
      scoped = true;
      continue;
    }
    if (seg.type === 'text') {
      // 按文本内容选择：找包含文本的最深层元素（text.下一页@href：下一页链接）
      const pool = nodes.length
        ? nodes.flatMap((n) => $(n).find('*').addBack().toArray())
        : $('*').toArray();
      const hits = pool.filter((n) => $(n).text().includes(seg.value));
      // 只留最深层命中（父容器包含文本但真正载体是子元素）
      const deepest =
        hits.length > 1 ? hits.filter((n) => !hits.some((h) => h !== n && isDescendant(n, h))) : hits;
      nodes = applyPosition(deepest, seg);
      scoped = true;
      if (!nodes.length && !asList) return [];
      continue;
    }
    let sel: string;
    if (seg.type === 'class') {
      // class 名可能含点号（.s2.3 之类罕见）：先按整名查，查不到再按最后一段当下标
      // 类名含空格（Legado "class.c wrap" = 同时匹配 c 和 wrap 两个类）→ CSS AND 选择器 .c.wrap
      sel = /\s/.test(seg.value) ? '.' + seg.value.trim().split(/\s+/).join('.') : `.${seg.value}`;
    } else if (seg.type === 'id') sel = `#${seg.value}`;
    else if (seg.type === 'tag') sel = seg.value;
    else sel = seg.value; // css
    // 链式作用域：首段在 ctx.el 范围（或全局），后续段都在「上一步结果」内查找
    // （Legado 语义：class.a@tag.b@text 的 tag.b 是 class.a 命中元素里的 b，不是全页的 b）
    let found: AnyNode[];
    try {
      if (scoped) {
        found = nodes.flatMap((n) => $(n).find(sel).addBack(sel).toArray());
      } else if (el) {
        found = scopeSel($, el, sel).toArray();
      } else {
        found = $(sel).toArray();
      }
    } catch {
      // 非法 CSS 选择器（源里混入正则式规则等）：Legado 行为是取空不抛错，单条规则
      // 失效不该把整个源的搜索结果拖死
      found = [];
    }
    if (seg.type === 'id') found = found.slice(0, 1);
    found = applyPosition(found, seg);
    nodes = found;
    scoped = true;
    if (!nodes.length && !asList) return [];
  }
  if (!out.length && nodes.length && !segs.some((s) => s.type === 'final')) {
    // 链没写终结操作：默认取 text
    for (const n of nodes) out.push($(n).text().trim());
  }
  if (multiSel && !asList && out.length > 1) return [out.filter(Boolean).join(' ')];
  return out;
}

/** domhandler 祖孙判断（text. 选择器最深层过滤用） */
function isDescendant(anc: AnyNode, node: AnyNode): boolean {
  let cur: AnyNode | null = node;
  while (cur) {
    if (cur === anc) return true;
    cur = (cur as unknown as { parent?: AnyNode | null }).parent ?? null;
  }
  return false;
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

/** 拆出规则里的 JS 部分：<js>...</js> / @js:尾巴（返回静态主段 + JS 代码） */
function extractJs(rule: string): { main: string; js: string } {
  const jsTag = rule.indexOf('<js>');
  const atJs = rule.search(/@js:/i);
  let cut = -1;
  if (jsTag >= 0 && (atJs < 0 || jsTag <= atJs)) cut = jsTag;
  else if (atJs >= 0) cut = atJs;
  if (cut < 0) return { main: rule, js: '' };
  const main = rule.slice(0, cut).trim();
  let js = rule.slice(cut);
  if (js.startsWith('<js>')) {
    const end = js.indexOf('</js>');
    js = end >= 0 ? js.slice(5, end) : js.slice(4);
  } else {
    js = js.replace(/^@js:/i, '');
  }
  return { main, js };
}

/** 规则 JS 执行（同步沙箱；result=静态部分求值结果，src=当前页源码）
 *  java.getString('$.gid') 等规则求值 API 通过 ruleEval 回调对当前 ctx 求值 */
function runRuleJs(ctx: Ctx, code: string, result: string): string {
  const source = ctx.source;
  if (!source || !code.trim()) return result;
  const src =
    ctx.kind === 'html' ? ctx.$.html() : ctx.kind === 'json' ? JSON.stringify(ctx.data ?? null) : ctx.full;
  try {
    return runLegadoJsSync(code, {
      sourceUrl: source.bookSourceUrl || '',
      sourceDef: source as unknown as Record<string, unknown>,
      jsLib: typeof (source as { jsLib?: unknown }).jsLib === 'string' ? (source as { jsLib?: string }).jsLib : undefined,
      html: src,
      baseUrl: ctx.pageUrl,
      globals: { result, src, baseUrl: ctx.pageUrl, url: ctx.pageUrl, title: '' },
      ruleEval: (rule: string): string => {
        try {
          return evalRule(ctx, rule);
        } catch {
          return '';
        }
      },
      timeoutMs: 2500,
    });
  } catch {
    return '';
  }
}

/** 求值单条字符串规则（自动识别 html/json 上下文；joinAll=true 时多元素命中拼接为多行） */
export function evalRule(ctx: Ctx, rule: string | undefined, joinAll = false): string {
  if (!rule) return '';
  const { main: raw, js } = extractJs(rule);
  const parts = splitOr(raw);
  let out = '';
  for (const p of parts) {
    const [main, regex, replacement] = splitRegex(p);
    let val = evalSingle(ctx, main, joinAll);
    if (val) {
      val = applyRegex(val, regex, replacement);
      if (val.trim()) {
        out = val.trim();
        break;
      }
    }
  }
  // 规则尾部 JS：以静态结果为输入变换（Legado 语义）；纯 JS 规则直接求值
  if (js) {
    let jsOut = runRuleJs(ctx, js, out);
    // JS 拼出的 URL 里可能残留 {{$._id}} 类模板（淘小说/猪猪小说 API 源）→ 对当前 JSON 数据求值
    if (jsOut.includes('{{') && ctx.kind === 'json') {
      jsOut = evalTemplateJson(ctx.data, jsOut);
    }
    if (jsOut.trim()) return jsOut.trim();
    if (!out) return '';
  }
  return out;
}

function evalSingle(ctx: Ctx, rule: string, joinAll = false): string {
  if (!rule) return '';
  let r = rule.trim();
  // 正则组上下文：$2$3 / https://x/$1 —— 捕获组替换（若夏网 :正则 列表项）
  if (ctx.kind === 'regex') {
    if (/\$\d/.test(r)) {
      return r.replace(/\$(\d+)/g, (_m, n: string) => ctx.groups[Number(n)] ?? '');
    }
    return ctx.full;
  }
  // @json: 前缀（大小写不敏感）：JSONPath 规则（若夏网等）
  if (/^@json:/i.test(r)) {
    r = r.slice(6).trim();
    if (ctx.kind === 'json') return jsonScalar(jsonPathAll(ctx.data, r.startsWith('$') ? r : '$.' + r)[0]);
    return '';
  }
  // {{@@rule}} / {{@rule}} 子规则模板（奇异网 intro 等）：内层规则对当前 ctx 求值后回填
  if (r.includes('{{@')) {
    const expanded = r.replace(/\{\{(@+)([^{}]+)\}\}/g, (_m, _ats: string, inner: string) =>
      evalRule(ctx, inner.trim(), joinAll),
    );
    if (expanded !== r) return evalSingle(ctx, expanded, joinAll);
  }
  // %% 依次取数（多列表交替合并：列表1首项、列表2首项、列表1次项…）
  if (r.includes('%%')) {
    const lists = r.split('%%').map((x) => evalSingle(ctx, x, true));
    const rows = lists.map((l) => l.split('\n'));
    const out: string[] = [];
    for (let i = 0; ; i++) {
      let added = false;
      for (const row of rows) {
        if (row[i]) {
          out.push(row[i]);
          added = true;
        }
      }
      if (!added) break;
    }
    return out.join('\n');
  }
  // && 顺序拼接
  if (r.includes('&&') && !r.startsWith('@css:')) {
    return r
      .split('&&')
      .map((x) => evalSingle(ctx, x, joinAll))
      .filter(Boolean)
      .join(' ');
  }
  // JSON 上下文
  if (ctx.kind === 'json') {
    if (r.startsWith('$')) return jsonScalar(jsonPathAll(ctx.data, r)[0]);
    // 整串模板（如 https://xx.com/onebook.php?novelid={{$.novelid}}）——晋江 API 源；
    // 部分源 URL 选项里写单括号 {$.field}（纵横 bookUrl）→ 归一成双括号再求值
    if (r.includes('{{')) return evalTemplateJson(ctx.data, r);
    if (/^https?:\/\//.test(r) && /\{\$/.test(r)) {
      return evalTemplateJson(ctx.data, r.replace(/\{(\$[\w.[\]]*)\}/g, '{{$1}}'));
    }
    // 无前缀路径（authorName 直取；data.books 嵌套路径补 $. 再试）
    const direct = jsonScalar((ctx.data as Record<string, unknown>)?.[r]);
    if (direct) return direct;
    if (r.includes('.')) return jsonScalar(jsonPathAll(ctx.data, '$.' + r)[0]);
    return '';
  }
  // HTML 上下文
  if (r.startsWith('$')) {
    // HTML 页面但规则是 JSONPath（少见）：正文 JSON 直接全局解析
    return '';
  }
  if (r.startsWith('{{') && r.endsWith('}}') && ctx.source) {
    // 纯 {{js}} 表达式规则：沙箱同步求值
    return runRuleJs(ctx, r.slice(2, -2), '');
  }
  if (r.startsWith('{{')) return '';
  if (r.startsWith('@css:')) {
    const segs = parseChain(r.slice(5));
    const parts = applyChain(ctx, segs, false);
    return joinAll ? parts.filter(Boolean).join('\n') : parts[0] || '';
  }
  if (r.startsWith('//')) return evalXPathLite(ctx, r);
  const segs = parseChain(r);
  const parts = applyChain(ctx, segs, false);
  return joinAll ? parts.filter(Boolean).join('\n') : parts[0] || '';
}

/** 轻量 XPath：//meta/@content、//tag/@attr 与 //a//b/@attr 链式 */
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
  // //a//b/@attr 链式（//div[@id="x"]//a/@href）
  const chain = /^\/\/(.+?)\/@(\w+)$/.exec(xp);
  if (chain && chain[1].includes('//')) {
    const sel = xpathChainCss(chain[1]);
    if (sel) {
      const n = (el ? $(el).find(sel).addBack(sel) : $(sel)).first();
      return n.attr(chain[2]) || n.text().trim();
    }
  }
  return '';
}

function evalTemplateJson(data: unknown, tpl: string): string {
  return tpl.replace(/\{\{\$?\.?([\w.[\]*$]+)\}\}/g, (_, path: string) => {
    if (/^\.\./.test(path)) return jsonScalar(jsonPathAll(data, '$' + path)[0]);
    return jsonScalar(jsonPathAll(data, '$.' + path)[0]);
  });
}

/** XPath 链 → CSS：//*[@id="x"]//tr → [id="x"] tr（支持 //a//b//c 多级、单双引号） */
function xpathChainCss(xp: string): string | null {
  const segs = xp.split('//').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return null;
  const css: string[] = [];
  for (const s of segs) {
    const m = /^([A-Za-z][\w-]*|\*)?(?:\[@([\w-]+)(?:=['"]([^'"]*)['"])?\])?$/.exec(s);
    if (!m) return null;
    const tag = m[1] || '*';
    const attrName = m[2];
    const attrVal = m[3];
    let sel = tag === '*' ? '' : tag;
    if (attrName) sel += attrVal !== undefined ? `[${attrName}="${attrVal}"]` : `[${attrName}]`;
    if (!sel) return null;
    css.push(sel);
  }
  return css.join(' ');
}

/** 列表规则：返回一组子上下文（html=元素 / json=对象 / regex=捕获组）。
 *  前缀：`-` 倒序（阳光中文网等目录倒序站）；`+` 追加（按正常处理）；
 *  `:regex` 正则列表（若夏网：每个匹配 → 捕获组上下文，子规则用 $N 引用） */
export function evalList(ctx: Ctx, rule: string | undefined): Ctx[] {
  if (!rule) return [];
  let raw = stripJs(rule);
  // 列表前缀：- 倒序 / + 追加（均剥离后正常求值）
  let reverse = false;
  while (/^[-+]/.test(raw.trim())) {
    if (raw.trim().startsWith('-')) reverse = !reverse;
    raw = raw.trim().slice(1).trim();
  }
  const [main0, regex, replacement] = splitRegex(raw);
  // @json: 前缀：JSONPath 列表规则
  const main = main0.replace(/^@json:/i, '').trim() || main0;
  // :regex 正则列表规则：(?s) 等内联旗标 → JS flags；每个匹配 → groups 上下文
  if (main.startsWith(':')) {
    let pat = main.slice(1);
    let flags = 'g';
    const inline = /^\(\?([simu]+)\)/.exec(pat);
    if (inline) {
      pat = pat.slice(inline[0].length);
      flags += inline[1].replace('u', '');
    }
    try {
      const re = new RegExp(pat, flags);
      const text = ctx.kind === 'html' ? ctx.$.html() : ctx.kind === 'json' ? JSON.stringify(ctx.data) : ctx.full;
      const items: Ctx[] = [];
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard < 4000) {
        items.push({ kind: 'regex', groups: m.slice() as string[], full: m[0], pageUrl: ctx.pageUrl, source: ctx.source });
        if (m.index === re.lastIndex) re.lastIndex++;
        guard++;
      }
      return reverse ? items.reverse() : items;
    } catch {
      return [];
    }
  }
  const pick = (list: Ctx[]): Ctx[] => {
    if (!regex) return list;
    return list.filter((c) => evalRule(c, `text##${regex}##${replacement}`) !== '' || c.kind === 'json' || c.kind === 'regex');
  };
  const post = (list: Ctx[]): Ctx[] => (reverse ? list.reverse() : list);
  if (ctx.kind === 'json') {
    // Legado 语义：JSON 规则可省略 $. 前缀（data.datas.list 等同 $.data.datas.list）
    let vals = main.startsWith('$') ? jsonPathAll(ctx.data, main) : jsonPathAll(ctx.data, '$.' + main);
    // Legado $.data 语义：结果为单个数组 → 展开其元素为列表项（晋江 API 源）
    if (vals.length === 1 && Array.isArray(vals[0])) vals = vals[0] as unknown[];
    return post(pick(vals.map((v) => ({ kind: 'json', data: v, pageUrl: ctx.pageUrl, source: ctx.source }) as Ctx)));
  }
  // html：先按 || 逐路尝试（regex 上下文没有页面 DOM，仅支持 : 子规则，已在上面返回）
  if (ctx.kind === 'regex') return [];
  for (const part of splitOr(main)) {
    const [p, ,] = splitRegex(part);
    let segs: Seg[];
    if (p.startsWith('@css:')) segs = parseChain(p.slice(5));
    else segs = parseChain(p);
    if (p.startsWith('//')) {
      // XPath 列表：//tag[@class='x'] / //*[@id="x"]//tr 多级链
      const sel = xpathChainCss(p);
      if (sel) {
        let els: AnyNode[];
        try {
          els = (ctx.el ? ctx.$(ctx.el).find(sel).addBack(sel) : ctx.$(sel)).toArray();
        } catch {
          els = [];
        }
        if (els.length) return post(pick(els.map((e) => ({ kind: 'html', $: ctx.$, el: e, pageUrl: ctx.pageUrl, source: ctx.source }) as Ctx)));
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
    // 逐段下钻：中间段命中「全部元素」都作为后续搜索范围（Legado 语义：flatMap），
    // 不是只取第一个（酷书阁 .col-md-6@dl：17 个 dl 分布在 18 个 .col-md-6 里）
    let scopeEls: AnyNode[] | null = ctx.el ? [ctx.el] : null;
    for (const seg of segs) {
      if (seg.type === 'final') break;
      const sel =
        seg.type === 'class' ? `.${seg.value}` : seg.type === 'id' ? `#${seg.value}` : seg.type === 'tag' ? seg.value : seg.value;
      let found: AnyNode[];
      try {
        if (scopeEls === null) found = ctx.$(sel).toArray();
        else found = scopeEls.flatMap((n) => ctx.$(n).find(sel).addBack(sel).toArray());
      } catch {
        found = []; // 非法选择器：取空不抛错（与 Legado 一致）
      }
      found = applyPosition(found, seg);
      if (!found.length) {
        scopeEls = [];
        break;
      }
      scopeEls = found;
    }
    if (listSel) {
      let els: AnyNode[];
      try {
        if (scopeEls === null) els = ctx.$(listSel).toArray();
        else els = scopeEls.flatMap((n) => ctx.$(n).find(listSel).addBack(listSel).toArray());
      } catch {
        els = []; // 非法选择器：取空不抛错（与 Legado 一致）
      }
      // 末段位置应用（tr!0 = 全部 tr 去掉表头行；tr.0:10:2 = 区间取）
      els = applyPosition(els, last);
      if (els.length) return post(pick(els.map((e) => ({ kind: 'html', $: ctx.$, el: e, pageUrl: ctx.pageUrl, source: ctx.source }) as Ctx)));
    } else if (scopeEls && scopeEls.length) {
      return post(pick(scopeEls.map((e) => ({ kind: 'html', $: ctx.$, el: e, pageUrl: ctx.pageUrl, source: ctx.source }) as Ctx)));
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

/**
 * 求值 URL 模板里的 {{...}} 内置 JS 表达式（不执行任意 JS，只识别 Legado 常见模式）。
 * 真实阅读 App 里这些表达式几乎都「返回站点根 URL」：
 * - cookie.removeCookie(source.getKey()) / source.key / baseUrl / host
 * - java.connect(source.getKey()).raw().request().url()（跟随重定向后的根地址）
 * - source.getVariable() ? ... : source.getKey()（变量未设时回退根地址）
 * 其余数值/编码类：page-1 / Date.now() / encodeURI(key) / java.put('x',key)。
 * 返回 null = 无法识别（保留原样）。
 */
function evalUrlExpr(
  expr: string,
  sourceUrl: string,
  vars: Record<string, string>,
  charset?: string,
): string | null {
  const e = expr.trim();
  // —— 站点根 URL 类（返回 bookSourceUrl 去掉 # 锚点；拼接后统一去重斜杠） ——
  if (
    /cookie\.removeCookie|source\.getVariable|source\.getKey|source\.key\b|baseUrl|host\b|java\.connect|getKey\(\)/.test(e) ||
    /^url\s*=/.test(e) ||
    /^String\(/.test(e)
  ) {
    return sourceUrl.split('#')[0];
  }
  // —— page 算术：page-1 / page+2 / (page-1)*12 ——
  if (/^[-+*/()\d\s]*\bpage\b[-+*/()\d\s]*$/.test(e) || /^(\([^)]*\))?page\s*([+-])\s*(\d+)$/.test(e)) {
    const page = parseInt(vars.page || '1', 10) || 1;
    const arith = e.replace(/\bpage\b/g, String(page));
    if (/^[-+*/()\d\s]+$/.test(arith)) {
      try {
        // 白名单校验后的纯算术表达式（仅数字与四则运算符），安全求值
         
        const val = Function(`"use strict"; return (${arith});`)() as number;
        if (Number.isFinite(val)) return String(Math.max(0, Math.round(val)));
      } catch {
        /* 非法算式回退 */
      }
    }
    const pm = /^page\s*([+-])\s*(\d+)$/.exec(e);
    if (pm) {
      const n = parseInt(pm[2], 10);
      return String(pm[1] === '-' ? Math.max(0, page - n) : page + n);
    }
  }
  // —— 时间戳 ——
  if (/Date\.now|new Date|getTime/.test(e)) return String(Date.now());
  // —— 搜索词编码类 ——
  if (/encodeURI|encodeURIComponent|java\.encodeUri|base64/i.test(e)) {
    return gbkUrlEncode(vars.key || '', charset);
  }
  // —— java.put('x', key)：存值并返回 key 本身 ——
  if (/java\.put/.test(e)) return gbkUrlEncode(vars.key || '', charset);
  return null;
}

/** URL 规范化：去空白、拼接后的双斜杠去重（保留协议 //；查询串里的 // 不动） */
function normalizeUrl(u: string): string {
  let s = u.replace(/\s+/g, '');
  // 表达式拼接后可能内嵌第二个绝对地址（{{baseUrl}} http://xxx/...）→ 取最后一个绝对 URL
  const urls = s.match(/https?:\/\/[^\s,]+/g);
  if (urls && urls.length > 1) s = urls[urls.length - 1];
  const m = /^(https?:\/\/)([^?]*)(\?.*)?$/.exec(s);
  if (m) s = m[1] + m[2].replace(/([^/])\/+\//g, '$1/').replace(/\/\/+/g, '/') + (m[3] || '');
  return s;
}

export function parseUrlTpl(
  tpl: string,
  sourceUrl: string,
  vars: Record<string, string>,
  /** GBK 自动重试：无 charset 声明的源强制按此编码发送关键词 */
  forceCharset?: string,
): ParsedUrl {
  let urlPart = stripJs(tpl).trim();
  const opts: { method?: string; body?: string; charset?: string; headers?: Record<string, string> } = {};
  // 尾部 ,{...} 选项（Legado 标准带逗号格式）
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
  // 尾部 {...} 选项（无逗号格式：`url{"charset":"UTF-8"}`，Legado 同样支持；
  // 天下书盟等源用这种写法。只匹配「{ 后是白字符+引号」的完整 JSON 块，避免误伤 URL 参数）
  if (!opts.method && !opts.body && !opts.charset && !opts.headers) {
    const m = /\{\s*[\r\n]*\s*"[\s\S]*\}\s*$/.exec(urlPart);
    if (m && m.index > 0) {
      try {
        const o = JSON.parse(m[0]) as Record<string, unknown>;
        if (o && typeof o === 'object' && (o.method || o.body || o.charset || o.headers)) {
          if (typeof o.method === 'string') opts.method = o.method.toUpperCase();
          if (typeof o.body === 'string') opts.body = o.body;
          if (typeof o.charset === 'string') opts.charset = o.charset;
          if (o.headers && typeof o.headers === 'object') opts.headers = o.headers as Record<string, string>;
          urlPart = urlPart.slice(0, m.index).trim();
        }
      } catch {
        /* 非 JSON 选项，当作普通 URL */
      }
    }
  }
  // 变量替换（key 按 charset 百分号编码；未声明编码的源可用 forceCharset 强制 GBK）
  const keyCharset = opts.charset || forceCharset;
  urlPart = urlPart.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (k === 'key' || k === 'page' || vars[k] !== undefined) {
      const v = vars[k] ?? '';
      if (k === 'key') return gbkUrlEncode(v, keyCharset);
      return encodeURIComponent(v);
    }
    return m;
  });
  // Legado {{...}} JS 表达式（cookie.removeCookie(source.getKey()) 等常见模式 → 求值）
  urlPart = urlPart.replace(/\{\{([^{}]+)\}\}/g, (m, expr: string) => {
    const v = evalUrlExpr(expr, sourceUrl, vars, opts.charset);
    return v == null ? m : v;
  });
  // 拼接后规范化：去空白、双斜杠去重（{{baseUrl}}/search/ → .../search/）
  urlPart = normalizeUrl(urlPart);
  if (opts.body) {
    opts.body = opts.body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
      const v = vars[k] ?? '';
      if (k === 'key') return gbkUrlEncode(v, keyCharset);
      return encodeURIComponent(v);
    });
    opts.body = opts.body.replace(/\{\{([^{}]+)\}\}/g, (m, expr: string) => {
      const v = evalUrlExpr(expr, sourceUrl, vars, keyCharset);
      return v == null ? m : v;
    });
    // 声明了非 UTF-8 编码的源：body 里残留的非 ASCII 字面字符（如爱看源硬编码的
    // checkKeyWord）也按站点编码百分号转码——与阅读App okhttp 的 body.toByteArray(charset) 等价
    if (keyCharset && !/utf-?8/i.test(keyCharset)) {
      opts.body = opts.body.replace(/[^\x00-\x7F]+/g, (s) => gbkUrlEncode(s, keyCharset));
    }
  }
  // URL 同理：非 UTF-8 源的查询串里残留中文按站点编码转码
  if (keyCharset && !/utf-?8/i.test(keyCharset) && /[^\x00-\x7F]/.test(urlPart)) {
    urlPart = urlPart.replace(/[^\x00-\x7F]+/g, (s) => gbkUrlEncode(s, keyCharset));
  }
  return {
    url: resolveUrl(urlPart, sourceUrl),
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    body: opts.body,
    charset: opts.charset || forceCharset,
    headers: opts.headers,
  };
}

/** 宽松 JSON 解析：{'webView': true} / {webView:true} / {"a"="b"} → 标准化后解析
 *  Legado 的选项尾经常写得不规范（单引号/未引号键/等号），严格 JSON.parse 会失败 */
function lenientJsonParse(s: string): Record<string, unknown> | null {
  let t = s.trim().replace(/^[,{\s]+/, '{').trim();
  if (!t.startsWith('{')) return null;
  t = t
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/'/g, '"');
  // 未引号键：{webView: → {"webView":（含 = 当 : 用）
  t = t.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*[:=]/g, '$1"$2":');
  // 未引号字符串值：: true / : no-wrap → :"true"（真常量除外——JSON 本来就支持）
  t = t.replace(/:\s*([A-Za-z_][\w.+-]*)\s*([,}\]])/g, (_m, v: string, tail: string) =>
    /^(true|false|null|\d+)$/i.test(v) ? `:${v}${tail}` : `:"${v}"${tail}`,
  );
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    return null;
  } catch {
    return null;
  }
}

/** 拆掉 URL 尾部 Legado 选项（可能 URL 编码 %7B%7D / 单引号 / 未引号键）。
 *  返回干净 URL + 选项（解析失败但尾巴形如 ,{...} 时也剥掉——Legado 同样先拆再解析） */
export function splitUrlOptions(raw: string): { url: string; opts: Record<string, unknown> | null } {
  let u = raw.trim();
  if (!u) return { url: u, opts: null };
  const trySplit = (s: string): { url: string; opts: Record<string, unknown> } | null => {
    let at = Math.max(s.lastIndexOf(',{'), s.toUpperCase().lastIndexOf(',%7B'));
    if (at < 0) return null;
    const head = s.slice(0, at).trim();
    let tail = s.slice(at + 1);
    if (/^%7B/i.test(tail)) {
      try {
        tail = decodeURIComponent(tail);
      } catch {
        /* 保留原样 */
      }
    }
    if (!head || !tail.trim().startsWith('{')) return null;
    const o = lenientJsonParse(tail);
    if (!o) return null;
    return { url: head, opts: o };
  };
  // 直接拆（明文 ,{ 或编码 ,%7B）
  const r1 = trySplit(u);
  if (r1) return r1;
  // 整体 URL 解码后重试（%2C 逗号等全编码形态）
  try {
    const dec = decodeURIComponent(u);
    if (dec !== u) {
      const r2 = trySplit(dec);
      if (r2) return r2;
    }
  } catch {
    /* ignore */
  }
  // 尾巴像 ,{...} 但 JSON 解析失败 → 仍剥掉（平衡花括号检查，防误伤正常 URL）
  const m = /,\s*(?:%7B|\{)[\s\S]*$/.exec(u);
  if (m && m.index > 0) {
    const tail = u.slice(m.index + 1).trim();
    const dec = /^%7B/i.test(tail) ? ((): string => { try { return decodeURIComponent(tail); } catch { return tail; } })() : tail;
    const open = (dec.match(/\{/g) || []).length;
    const close = (dec.match(/\}/g) || []).length;
    const sq = (dec.match(/"/g) || []).length;
    if (open === 1 && close === 1 && sq % 2 === 0) {
      return { url: u.slice(0, m.index).trim(), opts: null };
    }
  }
  return { url: u, opts: null };
}

async function fetchCtx(
  source: LegadoSource,
  p: ParsedUrl,
): Promise<{ ctx: Ctx; finalUrl: string; charset: string }> {
  // 规则里带出的 URL 可能自带尾部 ,{"method":"POST",...} 选项（如纵横 bookUrl 直指 POST API）；
  // 宽松解析（单引号/未引号键/URL 编码 %7B%7D 都支持——猫九小说 chapterUrl 带 webView 选项）
  let { url, method, body, charset } = p;
  const headers = { ...sourceHeaders(source, url), ...(p.headers || {}) };
  const split = splitUrlOptions(url);
  if (split.opts && (split.opts.method || split.opts.body || split.opts.headers || split.opts.charset)) {
    const o = split.opts;
    if (typeof o.method === 'string') method = o.method.toUpperCase();
    if (typeof o.body === 'string') body = o.body;
    if (typeof o.charset === 'string') charset = o.charset;
    if (o.headers && typeof o.headers === 'object') {
      for (const [k, v] of Object.entries(o.headers as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k] = v;
      }
    }
    url = normalizeUrl(split.url);
  } else if (split.url !== url) {
    url = normalizeUrl(split.url);
  }
  // 书源可自定义超时（慢站如 52书库 10-15s；默认 12s）
  const srcTimeout = typeof source.timeoutMs === 'number' && source.timeoutMs > 0 ? source.timeoutMs : undefined;
  // POST body 默认表单编码（Node fetch 不设 Content-Type 时会发 text/plain，
  // 多数笔趣阁的 PHP 搜索接口解析不出参数 → 空结果页）
  if (
    (method === 'POST' || method === 'PUT') &&
    body &&
    !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
  ) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await proxyFetch(url, {
    method,
    headers,
    body,
    charset,
    ...(srcTimeout ? { timeoutMs: srcTimeout } : {}),
  });
  const trimmed = res.text.trimStart();
  let ctx: Ctx;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      ctx = { kind: 'json', data: JSON.parse(trimmed), pageUrl: res.finalUrl, source };
    } catch {
      ctx = newHtmlCtx(res.text, res.finalUrl, source);
    }
  } else {
    ctx = newHtmlCtx(res.text, res.finalUrl, source);
  }
  return { ctx, finalUrl: res.finalUrl, charset: res.charset };
}

// ---------------------------------------------------------------------------
// 业务流程：搜索 / 详情 / 目录 / 正文
// ---------------------------------------------------------------------------

/** 沙箱 HTTP 执行器：脚本里的 java.ajax/connect 等最终走这里（服务端代理 + 宽松证书） */
function sandboxHttp(source: LegadoSource) {
  return async (req: HttpReq): Promise<HttpResp> => {
    const headers = { ...sourceHeaders(source, req.url), ...(req.headers || {}) };
    const res = await proxyFetch(req.url, { method: req.method, headers, body: req.body, charset: req.charset });
    return { body: res.text, finalUrl: res.finalUrl, headers: res.headers, status: res.status };
  };
}

/** URL 模板异步展开：@js: 纯脚本 / 内嵌 <js> / 未识别 {{expr}} → JS 沙箱求值后回退同步解析 */
async function resolveUrlTplAsync(
  source: LegadoSource,
  tpl: string,
  vars: Record<string, string>,
  forceCharset?: string,
): Promise<ParsedUrl> {
  const t = String(tpl || '');
  const sourceDef = source as unknown as Record<string, unknown>;
  const jsLib = typeof sourceDef.jsLib === 'string' ? sourceDef.jsLib : undefined;
  const jsOpts = () => ({
    sourceUrl: source.bookSourceUrl,
    sourceDef,
    jsLib,
    baseUrl: source.bookSourceUrl,
    globals: { ...vars } as Record<string, unknown>,
    http: sandboxHttp(source),
    timeoutMs: 9000,
    maxReruns: 12,
  });
  try {
    // ① 纯 @js: 脚本：返回值即 URL（可带 ,{...} 选项）——雨鹿/七猫/书城网包等
    if (/^\s*@js:/i.test(t)) {
      const out = await runLegadoJs(t.replace(/^\s*@js:/i, ''), jsOpts());
      if (out.trim()) return parseUrlTpl(out, source.bookSourceUrl, vars, forceCharset);
      return { url: '', method: 'GET' };
    }
    // ② 内嵌 <js>...</js>：求值后回填模板
    let expanded = t;
    if (t.includes('<js>')) {
      const blocks = [...t.matchAll(/<js>([\s\S]*?)<\/js>/g)];
      for (const b of blocks) {
        try {
          const val = await runLegadoJs(b[1], jsOpts());
          expanded = expanded.replace(b[0], val);
        } catch {
          expanded = expanded.replace(b[0], '');
        }
      }
    }
    // ③ 同步解析；残留未识别 {{expr}}（同步模式匹配不到）→ 沙箱逐个求值后重解析
    const pre = parseUrlTpl(expanded, source.bookSourceUrl, vars, forceCharset);
    if (/\{\{[^{}]+\}\}/.test(pre.url)) {
      const parts: string[] = [];
      let lastIdx = 0;
      for (const m of expanded.matchAll(/\{\{([^{}]+)\}\}/g)) {
        parts.push(expanded.slice(lastIdx, m.index));
        const known = evalUrlExpr(m[1], source.bookSourceUrl, vars, pre.charset);
        if (known != null) {
          parts.push(known);
        } else {
          try {
            parts.push(await runLegadoJs(`return (${m[1]});`, jsOpts()));
          } catch {
            parts.push(m[0]);
          }
        }
        lastIdx = (m.index || 0) + m[0].length;
      }
      parts.push(expanded.slice(lastIdx));
      return parseUrlTpl(parts.join(''), source.bookSourceUrl, vars, forceCharset);
    }
    return pre;
  } catch {
    // JS 求值失败 → 回退同步解析（静态部分仍然可用）
    return parseUrlTpl(t, source.bookSourceUrl, vars, forceCharset);
  }
}

export async function searchBooks(source: LegadoSource, key: string): Promise<SearchBook[]> {
  if (!source.searchUrl) return [];
  const rs = source.ruleSearch || {};
  const p = await resolveUrlTplAsync(source, source.searchUrl, { key, page: '1' });
  let r = await fetchCtx(source, p);
  let list = evalList(r.ctx, rs.bookList);
  // —— GBK 自动重试：站点实际是 GBK 编码但源没声明 charset → 搜索词按 UTF-8 发出
  //    去搜不到（空结果）。阅读App有站点字符集缓存所以天然正确；这里在「0 结果且
  //    响应为 GBK 系」时换 GBK 编码重搜一次（77读书网/中华典藏等老站）。 ——
  if (
    !list.length &&
    !p.charset &&
    /gb/i.test(r.charset) &&
    /[\u4e00-\u9fff]/.test(key)
  ) {
    try {
      const p2 = await resolveUrlTplAsync(source, source.searchUrl, { key, page: '1' }, 'gbk');
      const r2 = await fetchCtx(source, p2);
      const list2 = evalList(r2.ctx, rs.bookList);
      if (list2.length) {
        r = r2;
        list = list2;
      }
    } catch {
      /* GBK 重试失败保留原空结果 */
    }
  }
  const ctx = r.ctx;
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
    // kind 清洗：时间戳/日期段（如「1597757169,连载」「19-04-02,连载」）不进标签
    const rawKind = evalRule(item, rs.kind);
    const kind =
      rawKind && !/^\d+$/.test(rawKind.trim())
        ? rawKind
            .split(/[,，、;；\s]+/)
            .filter((x) => x && !/^\d{4,}$/.test(x) && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(x))
            .slice(0, 4)
            .join(',') || undefined
        : undefined;
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
          kind,
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
      kind,
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
  // 简介常为多个 <p> → 拼接
  const intro = evalRule(ctx, rb.intro, true).slice(0, 600);
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

/** 轻量简介抓取（搜索结果列表补简介用：单次详情页请求，不抓目录） */
export async function getBookIntro(source: LegadoSource, bookUrl: string): Promise<string> {
  const { ctx } = await fetchCtx(source, { url: bookUrl, method: 'GET' });
  return evalRule(ctx, source.ruleBookInfo?.intro, true).slice(0, 300);
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

/** 整行恰好等于这些 UI 词 → 噪声（晋江等站的正文容器里混着收藏/投诉面板文字；
 *  只删「整行就是这个词」的行，绝不影响正文里出现的同词） */
const NOISE_LINE_EXACT = new Set([
  '其他', '新增', '取消', '投诉', '请稍候', '插入书签', '作者有话说', '显示所有文的作话',
  '文章收藏', '为收藏文章分类', '定制收藏类别', '查看收藏列表', '投诉色情有害',
  '投诉涉未成年有害', '投诉数据造假', '添加书签', '推荐给朋友', '书评', '展开更多回复',
]);

/** 常见反防盗/广告行（内置兜底，书源 replaceRegex 之外再过一道） */
const NOISE_RE =
  /(笔趣阁|全本小说网|飘天文学|起点中文|棉花糖|顶点小说|八一中文|言情后花园|书客吧|最快更新|最新章节|首发域名|请记住|一秒记住|章节错误|举报|加入书签|求收藏|求推荐票|求月票|百度搜索|谷歌搜索|【?看书领红包?】|关注.{0,12}(公众号|现金红包)|更多精彩|手打吧|人工推荐|client\.qq\.com|m\.qq\.com.{0,20}(read|book)|\(本章完\))/;

export async function getChapter(
  source: LegadoSource,
  chapterUrl: string,
): Promise<{ title: string; content: string; nextUrl?: string }> {
  const { ctx, finalUrl } = await fetchCtx(source, { url: chapterUrl, method: 'GET' });
  const rc = source.ruleContent || {};
  // 正文规则常匹配多个元素（如 #text>p@textNodes）→ 全部拼接为段落
  const raw = evalRule(ctx, rc.content, true);
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
    // 整行都是噪声（很短且命中词库，或恰好是 UI 词）
    if (NOISE_LINE_EXACT.has(t) || (t.length <= 60 && NOISE_RE.test(t))) continue;
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
