import { NextRequest } from 'next/server';

/**
 * AI 网络搜索工具后端（「AI 系统感知工具包 + AI 专属分屏浏览器」配套）。
 *
 * 供 AI 的 searchWeb / webSearch Function Calling 工具调用（经 phone-tools executor →
 * web-tools toolSearchWeb），也可被分屏浏览器搜索框复用。
 *
 * 实现：服务端 z-ai-web-dev-sdk web_search（SDK 只在服务端使用，客户端零引入——
 * 与 reading/ai-light.ts 同款动态 import + 客户端缓存的范式）。
 *
 * 防护：内存 60s 结果缓存（同词重复搜直接命中）+ 每分钟 20 次限流（与旧 /api/search 同口径）。
 */

interface ZAIFunctionsClient {
  functions: {
    invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  };
}

let zaiCache: ZAIFunctionsClient | null = null;
async function getZai(): Promise<ZAIFunctionsClient> {
  if (zaiCache) return zaiCache;
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  zaiCache = (await ZAI.create()) as unknown as ZAIFunctionsClient;
  return zaiCache;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  siteName: string;
}

/* ---------------- 限流 + 缓存（模块级内存，dev 常驻） ---------------- */

const RATE_LIMIT = 20; // 次/分钟
const rateWindow: number[] = [];

const CACHE_TTL = 60_000; // 60s
const cache = new Map<string, { at: number; hits: WebSearchHit[] }>();

function rateLimited(): boolean {
  const now = Date.now();
  while (rateWindow.length > 0 && now - rateWindow[0] > 60_000) rateWindow.shift();
  if (rateWindow.length >= RATE_LIMIT) return true;
  rateWindow.push(now);
  return false;
}

function sanitizeHits(raw: unknown): WebSearchHit[] {
  if (!Array.isArray(raw)) return [];
  const out: WebSearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url : '';
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      title: (typeof r.name === 'string' ? r.name : '').trim().slice(0, 200) || '(无标题)',
      url,
      snippet: (typeof r.snippet === 'string' ? r.snippet : '').trim().slice(0, 400),
      siteName: (typeof r.host_name === 'string' ? r.host_name : '').trim().slice(0, 80),
    });
    if (out.length >= 10) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const num = Math.min(Math.max(Number(req.nextUrl.searchParams.get('num')) || 8, 1), 10);
  if (!q) {
    return Response.json({ ok: false, error: '缺少 q 参数' }, { status: 400 });
  }
  if (rateLimited()) {
    return Response.json({ ok: false, error: '搜索太频繁了，稍等一分钟再试' }, { status: 429 });
  }

  const key = `${q}::${num}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return Response.json({ ok: true, cached: true, hits: hit.hits });
  }

  try {
    const zai = await getZai();
    const raw = await zai.functions.invoke('web_search', { query: q, num });
    const hits = sanitizeHits(raw);
    if (hits.length === 0) {
      return Response.json({ ok: false, error: `没有搜到「${q}」的相关结果` });
    }
    cache.set(key, { at: Date.now(), hits });
    return Response.json({ ok: true, hits });
  } catch (e) {
    return Response.json(
      { ok: false, error: `搜索失败：${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}` },
      { status: 502 },
    );
  }
}
