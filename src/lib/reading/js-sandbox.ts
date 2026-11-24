/**
 * 阅读 App · Legado(阅读3.0) JS 沙箱
 * ---------------------------------------------------------------------------
 * 用户合集里 212/388 个源在规则或 URL 里带 JS（@js: / <js>...</js> / {{...}}），
 * 阅读 App 用 Rhino 真实执行；这里用 node:vm 模拟同款运行环境：
 *
 * - java.* API 子集：md5/base64/HMAC/AES/DES、ajax/getString/get/post/connect(HTTP)、
 *   put/get 变量、getCookie、t2s/s2t、timeFormat、getElement(s)(cheerio)、log/toast(noop)
 * - cookie.getCookie/setCookie/removeCookie（进程内 cookie jar，按 host 隔离）
 * - source.getKey()/getVariable()/setVariable()（进程内变量）
 * - org.jsoup.Jsoup.parse(html).select(...)（cheerio 仿真链）
 * - jsLib 预载（源自带 JS 库，雨鹿 39KB 协议库等）
 *
 * 异步 HTTP 桥（java.ajax 等在 Legado 是同步调用）：
 * - 备忘重跑法：脚本遇到未缓存的 HTTP 调用 → 抛 PendingHttp 中断 → 驱动层真实请求
 *   → 写入备忘 → 整段脚本重跑（确定性脚本会命中缓存继续往下走），上限 14 轮。
 * - 同步模式（规则 JS）：不注入 HTTP，遇即抛不支持（规则 JS 99% 是纯字符串变换）。
 */
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import iconv from 'iconv-lite';
import { convertLang } from './lang-convert';

export interface HttpReq {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  charset?: string;
}
export interface HttpResp {
  body: string;
  finalUrl: string;
  headers: Record<string, string>;
  status: number;
}

/** 中断信号：脚本要发 HTTP（驱动层应真实请求后重跑） */
class PendingHttp extends Error {
  constructor(public req: HttpReq) {
    super('__PENDING_HTTP__');
  }
}

// ---- 进程内共享状态（按书源 URL 隔离；阅读 App 同为进程内缓存） ----
const sourceVars = new Map<string, Map<string, unknown>>();
const sourceVarStore = (url: string): Map<string, unknown> => {
  let m = sourceVars.get(url);
  if (!m) {
    m = new Map();
    sourceVars.set(url, m);
  }
  return m;
};
const cookieJar = new Map<string, Map<string, string>>();
const cookieStore = (url: string): Map<string, string> => {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }
  let m = cookieJar.get(host);
  if (!m) {
    m = new Map();
    cookieJar.set(host, m);
  }
  return m;
};

/** 稳定 androidId / udid（进程级） */
const ANDROID_ID = crypto.randomBytes(8).toString('hex');

// ---------------------------------------------------------------------------
// jsoup 仿真（org.jsoup.Jsoup.parse(html).select(sel) 链式调用）
// ---------------------------------------------------------------------------

class JsoupEls {
  $: CheerioAPI;
  nodes: AnyNode[];
  isDoc: boolean;
  constructor($: CheerioAPI, nodes: AnyNode[], isDoc = false) {
    this.$ = $;
    this.nodes = nodes;
    this.isDoc = isDoc;
  }
  private wrap(nodes: AnyNode[]): JsoupEls {
    return new JsoupEls(this.$, nodes);
  }
  select(sel: string): JsoupEls {
    const out: AnyNode[] = [];
    try {
      if (this.isDoc) out.push(...this.$(sel).toArray());
      else for (const n of this.nodes) out.push(...this.$(n).find(sel).toArray());
    } catch {
      /* 非法选择器返回空 */
    }
    return this.wrap(out);
  }
  attr(name: string): string {
    if (!this.nodes.length) return '';
    return this.$(this.nodes[0]).attr(name) || '';
  }
  text(): string {
    return this.nodes.map((n) => this.$(n).text()).join(' ').trim();
  }
  ownText(): string {
    return this.nodes.map((n) => this.$(n).contents().filter((_, x) => x.type === 'text').text()).join(' ');
  }
  html(): string {
    return this.nodes.map((n) => this.$(n).html() || '').join('\n');
  }
  outerHtml(): string {
    return this.nodes.map((n) => this.$.html(n)).join('\n');
  }
  first(): JsoupEls {
    return this.wrap(this.nodes.slice(0, 1));
  }
  last(): JsoupEls {
    return this.wrap(this.nodes.slice(-1));
  }
  get(i: number): JsoupEls {
    return this.wrap(this.nodes.slice(i, i + 1));
  }
  eq(i: number): JsoupEls {
    const n = i < 0 ? this.nodes.length + i : i;
    return this.wrap(this.nodes.slice(n, n + 1));
  }
  size(): number {
    return this.nodes.length;
  }
  each(fn: (el: unknown, i: number) => unknown): JsoupEls {
    this.nodes.forEach((n, i) => fn(this.wrap([n]), i));
    return this;
  }
  toArray(): JsoupEls[] {
    return this.nodes.map((n) => this.wrap([n]));
  }
}

// ---------------------------------------------------------------------------
// java.* API 构建
// ---------------------------------------------------------------------------

interface ApiCtx {
  sourceUrl: string;
  /** HTTP 备忘（method|url|body → 响应 | 'FAIL'）；驱动层跨重跑保留 */
  httpMemo: Map<string, HttpResp | 'FAIL'>;
  /** 脚本「想要」的 HTTP 请求（即使 PendingHttp 被脚本自己的 try/catch 吞掉也记录） */
  wanted: Map<string, HttpReq>;
  /** 当前页（java.getElement/setContent 用） */
  $?: CheerioAPI;
  baseUrl?: string;
  /** 源定义（source.getKey 等） */
  sourceDef: Record<string, unknown>;
  /** 规则求值器（规则 JS 上下文注入）：java.getString('$.gid') 等对当前数据求规则 */
  ruleEval?: (rule: string) => string;
}

function md5(s: string): string {
  return crypto.createHash('md5').update(s, 'utf-8').digest('hex');
}

/** 简易对称加解密（AES/DES，CBC/ECB，Base64）——覆盖合集源常用姿势 */
function symCrypto(algorithm: string, key: string, iv?: string): { encrypt: (s: string) => string; decrypt: (s: string) => string } {
  const up = (algorithm || '').toUpperCase();
  const enc = (s: string, dec: boolean): string => {
    try {
      const keyBytes = Buffer.from(key, 'utf-8');
      let cipherAlg: string;
      if (up.startsWith('3DES')) cipherAlg = 'des-ede3-cbc';
      else if (up.startsWith('DES')) cipherAlg = 'des-cbc';
      else cipherAlg = keyBytes.length === 32 ? 'aes-256-cbc' : keyBytes.length === 24 ? 'aes-192-cbc' : 'aes-128-cbc';
      const useEcb = up.includes('ECB');
      const ivB = useEcb ? (null as Buffer | null) : iv ? Buffer.from(iv, 'utf-8') : Buffer.alloc(16, 0);
      const finalAlg = useEcb ? cipherAlg.replace('-cbc', '-ecb') : cipherAlg;
      if (dec) {
        const d = ivB
          ? crypto.createDecipheriv(finalAlg, keyBytes, ivB)
          : crypto.createDecipheriv(finalAlg, keyBytes, null as unknown as Buffer);
        return Buffer.concat([d.update(Buffer.from(s, 'base64')), d.final()]).toString('utf-8');
      }
      const c = ivB
        ? crypto.createCipheriv(finalAlg, keyBytes, ivB)
        : crypto.createCipheriv(finalAlg, keyBytes, null as unknown as Buffer);
      return Buffer.concat([c.update(Buffer.from(s, 'utf-8')), c.final()]).toString('base64');
    } catch {
      return '';
    }
  };
  return { encrypt: (s: string) => enc(s, false), decrypt: (s: string) => enc(s, true) };
}

const memoKey = (req: HttpReq): string => `${req.method || 'GET'}|${req.url}|${req.body || ''}`;

/** 同步 HTTP 调用：命中备忘返回 body（失败标记抛普通错误让脚本自己降级）；
 *  未命中记录到 wanted 并抛 PendingHttp（驱动层请求后重跑）。
 *  wanted 记录不可省：雨鹿等 jsLib 自带 try/catch 会吞掉 PendingHttp 继续尝试下一个域名，
 *  驱动层靠 wanted 集合发现「被吞掉的需求」照样取回并重跑 */
function httpCall(api: ApiCtx, req: HttpReq): string {
  const key = memoKey(req);
  const hit = api.httpMemo.get(key);
  if (hit === 'FAIL') throw new Error(`ajax 失败: ${req.url.slice(0, 80)}`);
  if (hit) return hit.body;
  api.wanted.set(key, req);
  throw new PendingHttp(req);
}

interface ConnResp {
  url: () => string;
  body: () => string;
  header: (k: string) => string;
  headers: () => Record<string, string>;
  statusCode: () => number;
}

/** java.connect(url) 链式仿真：.raw().request().url() / .get().body() 等 */
function makeConnection(api: ApiCtx, url: string): Record<string, unknown> {
  const req: HttpReq = { url, method: 'GET' };
  const build = (): { request: ConnResp; response: ConnResp; url: () => string; body: () => string; header: (k: string) => string; headers: () => Record<string, string> } => {
    const key = memoKey(req);
    if (!api.httpMemo.has(key)) {
      api.wanted.set(key, req);
      throw new PendingHttp(req);
    }
    const hit = api.httpMemo.get(key);
    if (hit === 'FAIL' || hit === undefined) throw new Error(`connect 失败: ${req.url.slice(0, 80)}`);
    const r: HttpResp = hit;
    const resp: ConnResp = {
      url: () => r.finalUrl,
      body: () => r.body,
      header: (k: string) => r.headers[k] || '',
      headers: () => r.headers,
      statusCode: () => r.status,
    };
    return { request: resp, response: resp, url: () => r.finalUrl, body: () => r.body, header: resp.header, headers: resp.headers };
  };
  const chain: Record<string, unknown> = {
    raw: () => chain,
    url: (u?: unknown) => {
      if (u !== undefined) {
        req.url = String(u);
        return chain;
      }
      return build().url();
    },
    method: (m: unknown) => {
      req.method = String(m).toUpperCase();
      return chain;
    },
    header: (k: unknown, v: unknown) => {
      req.headers = { ...(req.headers || {}), [String(k)]: String(v) };
      return chain;
    },
    headers: (h: Record<string, string>) => {
      req.headers = { ...(req.headers || {}), ...h };
      return chain;
    },
    data: (k: unknown, v: unknown) => {
      req.body = req.body ? `${req.body}&${k}=${v}` : `${k}=${v}`;
      return chain;
    },
    body: (b?: unknown) => {
      if (b !== undefined) {
        req.body = String(b);
        return chain;
      }
      return build().body();
    },
    get: () => {
      req.method = 'GET';
      return build().request;
    },
    post: () => {
      req.method = 'POST';
      return build().request;
    },
    request: () => build().request,
    execute: () => build().request,
    response: () => build().response,
  };
  return chain;
}

function makeJavaApi(api: ApiCtx): Record<string, unknown> {
  const normUrl = (u: unknown): string => {
    const t = String(u || '').trim();
    if (/^https?:\/\//i.test(t)) return t;
    try {
      return new URL(t, api.baseUrl || api.sourceUrl).toString();
    } catch {
      return t;
    }
  };
  return {
    // —— 日志/UI（noop）——
    log: (...a: unknown[]) => console.log('[legado-js]', ...a),
    toast: () => {},
    longToast: () => {},
    debug: () => {},
    // —— 编码/哈希 ——
    md5Encode: (s: unknown) => md5(String(s ?? '')),
    md5Encode16: (s: unknown) => md5(String(s ?? '')).substring(8, 24),
    base64Encode: (s: unknown) => Buffer.from(String(s ?? ''), 'utf-8').toString('base64'),
    base64Decode: (s: unknown) => Buffer.from(String(s ?? ''), 'base64').toString('utf-8'),
    base64DecodeToString: (s: unknown) => Buffer.from(String(s ?? ''), 'base64').toString('utf-8'),
    base64DecodeToByteArray: (s: unknown) => Array.from(Buffer.from(String(s ?? ''), 'base64')),
    aesBase64DecodeToString: (key: unknown, s: unknown) => symCrypto('AES', String(key)).decrypt(String(s ?? '')),
    desEncodeToBase64String: (key: unknown, s: unknown) => symCrypto('DES', String(key)).encrypt(String(s ?? '')),
    HMacHex: (alg: unknown, key: unknown, data: unknown) => {
      try {
        const a = /sha256/i.test(String(alg)) ? 'sha256' : /sha1/i.test(String(alg)) ? 'sha1' : 'md5';
        return crypto.createHmac(a, String(key)).update(String(data ?? ''), 'utf-8').digest('hex');
      } catch {
        return '';
      }
    },
    createSymmetricCrypto: (algorithm: unknown, key: unknown, iv?: unknown) => symCrypto(String(algorithm), String(key), iv ? String(iv) : undefined),
    createAsymmetricCrypto: () => ({ encrypt: (s: string) => s, decrypt: (s: string) => s }),
    hexDecodeToString: (h: unknown) => {
      try {
        return Buffer.from(String(h ?? ''), 'hex').toString('utf-8');
      } catch {
        return '';
      }
    },
    strToBytes: (s: unknown) => Array.from(Buffer.from(String(s ?? ''), 'utf-8')),
    bytesToStr: (b: number[] | Uint8Array) => Buffer.from(b as number[]).toString('utf-8'),
    randomUUID: () => crypto.randomUUID(),
    random: (n: unknown) => Math.random().toString(36).slice(2, 2 + Number(n || 8)),
    randomInt: (min: unknown, max: unknown) => Math.floor(Math.random() * (Number(max) - Number(min) + 1)) + Number(min),
    // —— 文本 ——
    t2s: (s: unknown) => convertLang(String(s ?? ''), 't2s'),
    s2t: (s: unknown) => convertLang(String(s ?? ''), 's2t'),
    timeFormat: (ts?: unknown) => {
      const d = ts ? new Date(Number(ts)) : new Date();
      const p = (x: number) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    toNumChapter: (s: unknown) => {
      const m = /第\s*([\d零一二两三四五六七八九十百千万]+)\s*[章节卷回部]/.exec(String(s || ''));
      if (!m) return '';
      const raw = m[1];
      if (/^\d+$/.test(raw)) return raw;
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
          } else section += (num || 1) * u;
          num = 0;
        }
      }
      return String(total + section + num);
    },
    encodeURI: (s: unknown) => encodeURI(String(s ?? '')),
    encodeUri: (s: unknown) => encodeURI(String(s ?? '')),
    encodeURIComponent: (s: unknown) => encodeURIComponent(String(s ?? '')),
    urlEncode: (s: unknown, charset?: unknown) => {
      const cs = (charset ? String(charset) : 'utf-8').toLowerCase();
      if (cs === 'utf-8' || cs === 'utf8') return encodeURIComponent(String(s ?? ''));
      try {
        const buf = iconv.encode(String(s ?? ''), cs as 'gbk');
        let out = '';
        for (const b of buf) {
          const ch = String.fromCharCode(b);
          out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0');
        }
        return out;
      } catch {
        return encodeURIComponent(String(s ?? ''));
      }
    },
    // —— 变量 ——
    put: (k: unknown, v: unknown) => {
      sourceVarStore(api.sourceUrl).set(String(k), v);
      return v;
    },
    // —— Cookie ——
    getCookie: (url: unknown, name?: unknown) => {
      const store = cookieStore(String(url));
      if (name !== undefined) return store.get(String(name)) || '';
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    setCookie: (url: unknown, k: unknown, v?: unknown) => {
      const store = cookieStore(String(url));
      if (v !== undefined) store.set(String(k), String(v));
      else {
        const kv = String(k).split('=');
        if (kv.length >= 2) store.set(kv[0].trim(), kv.slice(1).join('=').split(';')[0].trim());
      }
      return true;
    },
    removeCookie: (url: unknown) => {
      cookieStore(String(url)).clear();
      return String(url);
    },
    // —— HTTP ——
    ajax: (urlOrOpts: unknown, headers?: Record<string, string>, body?: string) => {
      let req: HttpReq;
      if (urlOrOpts && typeof urlOrOpts === 'object') {
        const o = urlOrOpts as { url: string; method?: string; body?: string; headers?: Record<string, string>; charset?: string };
        req = { url: normUrl(o.url), method: (o.method || 'GET').toUpperCase(), headers: o.headers, body: o.body, charset: o.charset };
      } else {
        req = { url: normUrl(urlOrOpts), method: body ? 'POST' : 'GET', headers, body };
      }
      return httpCall(api, req);
    },
    getString: (rule: unknown) => {
      // 规则上下文：java.getString('$.gid') = 对当前数据求规则（AnalyzeRule 扩展，非 HTTP）
      if (api.ruleEval) {
        try {
          return api.ruleEval(String(rule ?? ''));
        } catch {
          return '';
        }
      }
      return '';
    },
    getStringList: (rule: unknown): string[] => {
      if (api.ruleEval) {
        try {
          return api.ruleEval(String(rule ?? ''))
            .split('\n')
            .filter(Boolean);
        } catch {
          return [];
        }
      }
      return [];
    },
    // —— HTTP（get 单参非 URL = 变量表取值：Legado 方法重载，按参数个数分派）——
    get: (a: unknown, b?: Record<string, string>) => {
      if (b === undefined && typeof a === 'string' && !/^https?:\/\//i.test(a.trim())) {
        return sourceVarStore(api.sourceUrl).get(a);
      }
      return httpCall(api, { url: normUrl(a), headers: b });
    },
    getStrResponse: (url: unknown, headers?: Record<string, string>) => {
      const req: HttpReq = { url: normUrl(url), headers };
      httpCall(api, req); // 未命中会抛 PendingHttp / 失败抛普通错
      const r = api.httpMemo.get(memoKey(req)) as HttpResp;
      return {
        body: () => r.body,
        url: () => r.finalUrl,
        header: (k: string) => r.headers[k] || '',
        headers: () => r.headers,
        statusCode: () => r.status,
      };
    },
    post: (url: unknown, body?: string, headers?: Record<string, string>) =>
      httpCall(api, { url: normUrl(url), method: 'POST', body: body || '', headers }),
    connect: (url: unknown) => makeConnection(api, normUrl(url)),
    // —— 当前页 DOM ——
    getElements: (sel: unknown) => {
      if (!api.$) return [];
      try {
        return new JsoupEls(api.$, api.$(String(sel)).toArray()).toArray();
      } catch {
        return [];
      }
    },
    getElement: (sel: unknown) => {
      if (!api.$) return null;
      try {
        const n = api.$(String(sel)).first().toArray();
        return n.length ? new JsoupEls(api.$, n) : null;
      } catch {
        return null;
      }
    },
    setContent: (html: unknown) => {
      try {
        api.$ = cheerio.load(String(html ?? ''));
      } catch {
        /* ignore */
      }
      return true;
    },
    // —— 环境 ——
    androidId: () => ANDROID_ID,
    getAndroidId: () => ANDROID_ID,
    udid: () => ANDROID_ID,
    lang: () => 'zh',
    isNotBlank: (s: unknown) => String(s ?? '').trim() !== '',
    isEmpty: (s: unknown) => String(s ?? '').trim() === '',
    // —— 不支持（浏览器类）——
    webView: () => {
      throw new Error('java.webView 不支持（服务端无浏览器）');
    },
    startBrowser: () => {
      throw new Error('java.startBrowser 不支持');
    },
    startBrowserAwait: () => {
      throw new Error('java.startBrowserAwait 不支持');
    },
  };
}

// ---------------------------------------------------------------------------
// 驱动层
// ---------------------------------------------------------------------------

export interface JsRunOpts {
  sourceUrl: string;
  sourceDef?: Record<string, unknown>;
  jsLib?: string;
  /** 变量环境（key/page/result/src/baseUrl/title 等） */
  globals?: Record<string, unknown>;
  /** 当前页 HTML（src/java.setContent 用） */
  html?: string;
  baseUrl?: string;
  /** 规则求值器（规则 JS 上下文）：java.getString('$.x') 对当前数据求规则 */
  ruleEval?: (rule: string) => string;
  /** HTTP 执行器；不传 = 纯同步模式（规则 JS） */
  http?: (req: HttpReq) => Promise<HttpResp>;
  timeoutMs?: number;
  maxReruns?: number;
}

function buildSandbox(api: ApiCtx, opts: JsRunOpts): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    java: makeJavaApi(api),
    cookie: {
      getCookie: (url: unknown, name?: unknown) => {
        const store = cookieStore(String(url));
        if (name !== undefined) return store.get(String(name)) || '';
        return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      },
      setCookie: (url: unknown, k: unknown, v?: unknown) => {
        const store = cookieStore(String(url));
        if (v !== undefined) store.set(String(k), String(v));
        else {
          const kv = String(k).split('=');
          if (kv.length >= 2) store.set(kv[0].trim(), kv.slice(1).join('=').split(';')[0].trim());
        }
        return true;
      },
      removeCookie: (url: unknown) => {
        cookieStore(String(url)).clear();
        return String(url);
      },
    },
    source: {
      getKey: () => String(api.sourceDef.bookSourceUrl || api.sourceUrl || '').split('#')[0],
      getVariable: () => sourceVarStore(api.sourceUrl).get('__variable__') ?? '',
      setVariable: (v: unknown) => {
        sourceVarStore(api.sourceUrl).set('__variable__', v);
        return true;
      },
      getVariableInfo: () => sourceVarStore(api.sourceUrl).get('__variable__') ?? '',
      getLoginHeaderMap: () => ({}),
      getLoginHeader: () => '',
      putLoginHeader: () => true,
      bookSourceUrl: String(api.sourceDef.bookSourceUrl || api.sourceUrl || ''),
      bookSourceName: String(api.sourceDef.bookSourceName || ''),
      bookSourceGroup: String(api.sourceDef.bookSourceGroup || ''),
      bookSourceComment: String(api.sourceDef.bookSourceComment || ''),
      loginUrl: String(api.sourceDef.loginUrl || ''),
      header: String(api.sourceDef.header || ''),
    },
    org: { jsoup: { Jsoup: { parse: (html: unknown) => new JsoupEls(cheerio.load(String(html ?? '')), [], true) } } },
    ...opts.globals,
  };
  return sandbox;
}

function coerceResult(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

/** 驱动层执行一轮：取回脚本「想要但还没取」的 HTTP（每轮最多 4 个，失败记 FAIL） */
async function fetchWanted(api: ApiCtx, http: (req: HttpReq) => Promise<HttpResp>, limit = 4): Promise<number> {
  const unfetched: [string, HttpReq][] = [];
  for (const [k, req] of api.wanted) {
    if (!api.httpMemo.has(k)) unfetched.push([k, req]);
    if (unfetched.length >= limit) break;
  }
  if (!unfetched.length) return 0;
  await Promise.all(
    unfetched.map(async ([k, req]) => {
      try {
        const resp = await http(req);
        api.httpMemo.set(k, resp);
      } catch {
        api.httpMemo.set(k, 'FAIL'); // 失败标记：脚本重跑时会拿到普通错误 → 自己降级（换域名等）
      }
    }),
  );
  return unfetched.length;
}

/** 跑一段 Legado JS；脚本里的 HTTP 调用由 http 执行器代跑（备忘重跑法 + 被吞请求回收） */
export async function runLegadoJs(code: string, opts: JsRunOpts): Promise<string> {
  const api: ApiCtx = {
    sourceUrl: opts.sourceUrl,
    httpMemo: new Map(),
    wanted: new Map(),
    baseUrl: opts.baseUrl,
    $: opts.html ? cheerio.load(opts.html) : undefined,
    sourceDef: opts.sourceDef || {},
    ruleEval: opts.ruleEval,
  };
  const full = [opts.jsLib ? String(opts.jsLib) : '', code].filter(Boolean).join('\n;\n');
  const maxReruns = opts.maxReruns ?? 16;
  for (let i = 0; i <= maxReruns; i++) {
    try {
      const sandbox = buildSandbox(api, opts);
      vm.createContext(sandbox);
      const val = vm.runInContext(full, sandbox as vm.Context, { timeout: opts.timeoutMs ?? 6000 });
      // 脚本正常跑完但 wanted 里还有未取的请求（脚本自带 try/catch 吞掉了 PendingHttp，
      // 如雨鹿 jsLib 逐域名试探）→ 取回后重跑，脚本会命中备忘继续往下
      if (opts.http && i < maxReruns) {
        const fetched = await fetchWanted(api, opts.http);
        if (fetched > 0) continue;
      }
      if (val === undefined || val === null) return coerceResult(sandbox.result);
      return coerceResult(val);
    } catch (e) {
      if (e instanceof PendingHttp && opts.http) {
        await fetchWanted(api, opts.http, 1);
        continue;
      }
      throw e;
    }
  }
  throw new Error('JS 沙箱重跑超限（HTTP 调用过多或脚本非确定性）');
}

/** 同步执行（规则 JS 用；遇 HTTP 调用直接抛错放弃该规则） */
export function runLegadoJsSync(code: string, opts: JsRunOpts): string {
  const api: ApiCtx = {
    sourceUrl: opts.sourceUrl,
    httpMemo: new Map(),
    wanted: new Map(),
    baseUrl: opts.baseUrl,
    $: opts.html ? cheerio.load(opts.html) : undefined,
    sourceDef: opts.sourceDef || {},
    ruleEval: opts.ruleEval,
  };
  const full = [opts.jsLib ? String(opts.jsLib) : '', code].filter(Boolean).join('\n;\n');
  const sandbox = buildSandbox(api, opts);
  vm.createContext(sandbox);
  const val = vm.runInContext(full, sandbox as vm.Context, { timeout: opts.timeoutMs ?? 3000 });
  if (val === undefined || val === null) return coerceResult(sandbox.result);
  return coerceResult(val);
}
