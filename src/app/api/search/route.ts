import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

// #46（三轮审计）：q 限长 + 简单节流——q 原样透传 web_search，无限长/高频会被滥用烧搜索配额。
const MAX_Q_LENGTH = 200;
const SEARCH_RATE_LIMIT = 20; // 全局每窗口最大次数
const SEARCH_RATE_WINDOW_MS = 60_000;
const searchHitTimes: number[] = [];

function searchRateLimited(): boolean {
  const now = Date.now();
  while (searchHitTimes.length && now - searchHitTimes[0] > SEARCH_RATE_WINDOW_MS) searchHitTimes.shift();
  if (searchHitTimes.length >= SEARCH_RATE_LIMIT) return true;
  searchHitTimes.push(now);
  return false;
}

/**
 * GET /api/search?q=<关键词>&num=<条数>
 * 微信搜索页「网络结果」后端：z-ai web_search 透传（SDK 只能在服务端使用）。
 * 返回 { results: [{ name, url, snippet, host_name, date, favicon }] }
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, MAX_Q_LENGTH);
  const num = Math.min(Math.max(Number(req.nextUrl.searchParams.get('num')) || 6, 1), 10);

  if (!q) return NextResponse.json({ results: [] });
  if (searchRateLimited()) return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });

  try {
    const zai = await ZAI.create();
    const raw = (await zai.functions.invoke('web_search', { query: q, num })) as unknown;

    if (!Array.isArray(raw)) {
      return NextResponse.json({ results: [] });
    }

    const results = raw
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .map((r) => ({
        name: typeof r.name === 'string' ? r.name : '',
        url: typeof r.url === 'string' ? r.url : '',
        snippet: typeof r.snippet === 'string' ? r.snippet : '',
        host_name: typeof r.host_name === 'string' ? r.host_name : '',
        date: typeof r.date === 'string' ? r.date : '',
        favicon: typeof r.favicon === 'string' ? r.favicon : '',
      }))
      .filter((r) => r.url && /^https?:\/\//i.test(r.url))
      .slice(0, num);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: '网络搜索失败' }, { status: 500 });
  }
}
