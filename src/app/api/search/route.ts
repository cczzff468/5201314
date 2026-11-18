import { NextRequest, NextResponse } from 'next/server';

// #46（三轮审计）：q 限长 + 简单节流——q 原样透传搜索，无限长/高频会被滥用烧搜索配额。
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
 * 微信搜索页「网络结果」后端。
 * v82：内置 z-ai web_search 兜底已移除——该能力依赖沙箱专属 SDK，无用户可配置的替代通道，
 * 现直接返回 501 与说明（前端显示「网络搜索不可用」态，本地聊天记录/联系人搜索不受影响）。
 * 返回 { results: [...] }（恒为空数组，保持前端解析兼容）。
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, MAX_Q_LENGTH);
  const num = Math.min(Math.max(Number(req.nextUrl.searchParams.get('num')) || 6, 1), 10);

  if (!q) return NextResponse.json({ results: [] });
  if (searchRateLimited()) return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });

  return NextResponse.json(
    { results: [], error: '网络搜索已下线（内置搜索服务已移除）；聊天记录与联系人搜索不受影响' },
    { status: 501 }
  );
}
