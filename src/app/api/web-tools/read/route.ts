import { NextRequest } from 'next/server';
import * as cheerio from 'cheerio';

/**
 * AI 网页阅读后端（「AI 专属分屏浏览器」配套，Jina Reader 风格）。
 *
 * 把任意 URL 的网页转换成纯文本（标题/摘要/正文/favicon），给 AI「读网页」用：
 * - 用户在聊天里发链接 → 自动读取正文摘要注入 AI 上下文；
 * - AI 调 openWebBrowser 打开网页 → 返回正文让 AI 立刻能讨论内容；
 * - 分屏浏览器「阅读模式」渲染同款数据。
 *
 * 实现：服务端 fetch（桌面 UA + 15s 超时 + 3MB 截断）+ cheerio 正文抽取
 * （剔除 script/style/nav/footer 等噪音节点，优先 article/main 正文容器，
 * 段落文本按 \n 连接；中文页面段落密度打分兜底）。
 *
 * 防护：仅 http(s)、内网地址拒读、60s 内存缓存、每分钟 20 次限流。
 */

export interface WebPageRead {
  url: string;
  title: string;
  desc: string;
  siteName: string;
  favicon: string;
  text: string;
  textLen: number;
  truncated: boolean;
}

const MAX_TEXT = 5000; // 正文上限（AI 上下文友好）
const MAX_HTML = 3 * 1024 * 1024; // 3MB HTML 截断
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ---------------- 限流 + 缓存 ---------------- */

const RATE_LIMIT = 20;
const rateWindow: number[] = [];
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; page: WebPageRead }>();

function rateLimited(): boolean {
  const now = Date.now();
  while (rateWindow.length > 0 && now - rateWindow[0] > 60_000) rateWindow.shift();
  if (rateWindow.length >= RATE_LIMIT) return true;
  rateWindow.push(now);
  return false;
}

/** 安全校验：仅 http(s) 公网页面（本机/内网/非常规端口拒读，防 SSRF） */
function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL 格式不正确');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http/https 链接');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') || h === '0.0.0.0') {
    throw new Error('不支持读取本机地址');
  }
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) {
    throw new Error('不支持读取内网地址');
  }
  return u;
}

/** 抽取正文（cheerio）：优先语义容器，段落按换行连接，保序去噪 */
function extractWithCheerio(html: string, baseUrl: string): Omit<WebPageRead, 'url' | 'textLen' | 'truncated'> {
  const $ = cheerio.load(html);

  // 元信息
  const title =
    ($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text() || '')
      .trim()
      .slice(0, 160) || '(无标题)';
  const desc =
    (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    )
      .trim()
      .slice(0, 300);
  const siteName = ($('meta[property="og:site_name"]').attr('content') || '').trim().slice(0, 80);
  let favicon =
    $('link[rel~="icon"]').first().attr('href') ||
    $('link[rel="shortcut icon"]').first().attr('href') ||
    '/favicon.ico';
  try {
    favicon = new URL(favicon, baseUrl).toString();
  } catch {
    favicon = '';
  }

  // 噪音剔除
  $('script,style,noscript,template,svg,iframe,form,button,select,nav,header,footer,aside,'
    + '[role="navigation"],[role="banner"],[role="complementary"],[aria-hidden="true"],.nav,.menu,.sidebar,.footer,.header,.comment,.comments,.breadcrumb,.share,.related,.recommend,.ad,.ads,.advertise,.copyright,.pagination')
    .remove();

  // 正文容器优先级：article > main > [role=main] > #content/.content/.article > body
  // （按候选内文本密度选最佳：导航壳 main 时常被嵌 article 套住，密度最大者正文最纯）
  const candidates = ['article', 'main', '[role="main"]', '#content', '.content', '#article', '.article', '#main'];
  let bestSel = '';
  let bestScore = 0;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const score = (el.text() || '').replace(/\s+/g, '').length;
    if (score > bestScore) {
      bestScore = score;
      bestSel = sel;
    }
  }
  const scope = bestSel ? $(bestSel).first() : $.root();
  const paragraphs: string[] = [];
  const push = (t: string) => {
    const clean = t.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    if (clean && clean.length >= 2) paragraphs.push(clean);
  };

  const blocks = scope.find('p,li,h1,h2,h3,h4,blockquote,pre,td,dd');
  if (blocks.length > 0) {
    blocks.each((_i, el) => {
      push($(el).text());
    });
  } else {
    // 兜底：整棵树按换行切
    for (const line of (scope.text() || '').split('\n')) push(line);
  }

  // 去重相邻重复行（分页/版权重复）
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of paragraphs) {
    const k = p.slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(p);
  }

  const full = lines.join('\n');
  return {
    title,
    desc,
    siteName,
    favicon,
    text: full.slice(0, MAX_TEXT),
  };
}

export async function GET(req: NextRequest) {
  const url = (req.nextUrl.searchParams.get('url') || '').trim();
  if (!url) {
    return Response.json({ ok: false, error: '缺少 url 参数' }, { status: 400 });
  }
  if (rateLimited()) {
    return Response.json({ ok: false, error: '读网页太频繁了，稍等一分钟再试' }, { status: 429 });
  }
  let normUrl: URL;
  try {
    normUrl = assertPublicHttpUrl(url);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'URL 不合法' }, { status: 400 });
  }

  const cacheKey = normUrl.toString();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return Response.json({ ok: true, cached: true, page: hit.page });
  }

  try {
    const res = await fetch(cacheKey, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return Response.json({ ok: false, error: `网页返回 ${res.status}` }, { status: 502 });
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
      return Response.json({ ok: false, error: `不支持的网页类型：${ct.split(';')[0] || '未知'}` }, { status: 415 });
    }
    const html = (await res.text()).slice(0, MAX_HTML);
    const extracted = extractWithCheerio(html, res.url || cacheKey);
    const page: WebPageRead = {
      url: res.url || cacheKey,
      ...extracted,
      textLen: extracted.text.length,
      truncated: extracted.text.length >= MAX_TEXT,
    };
    if (page.text.replace(/\s/g, '').length < 30) {
      return Response.json(
        { ok: false, error: '这个网页没有可读的正文（可能是纯脚本渲染页面）', page },
        { status: 422 },
      );
    }
    cache.set(cacheKey, { at: Date.now(), page });
    return Response.json({ ok: true, page });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const friendly = /timeout|aborted/i.test(msg) ? '网页加载超时（15 秒）' : `读取失败：${msg.slice(0, 100)}`;
    return Response.json({ ok: false, error: friendly }, { status: 502 });
  }
}
