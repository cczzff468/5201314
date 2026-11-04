import { NextRequest, NextResponse } from 'next/server';

/**
 * 网上表情包搜索 API（GET /api/sticker-search?q=关键词）——微信/QQ 表情面板「表情搜索」弹窗后端
 *
 * 数据源（Task 27 重选：双源并发，谁回用谁、都回则合并）：
 *  - 360 图片 image.so.com /j 接口（主源：JSON 直出、海外/国内都快 ~0.6s、量大稳定；查询自动拼「表情包」聚焦斗图内容）
 *  - 发表情 fabiaoqing.com 搜索页爬虫（副源：中文斗图内容最对味，但海外服务器经常超时——只给 1.5s 短预算，
 *    回得来就参与合并、回不来不拖慢主源；国内部署时它通常 <1s 优先出图）
 *  - （已弃用 Bing 图片：async 接口对无 Cookie 环境/高频返回空壳与空响应，反爬升级后不可靠）
 *
 * 缓存：Prisma SQLite（StickerSearchCache 表）24h 过期——同一关键词命中免出站；
 * 双源全挂时降级返回过期缓存（stale 标记），再挂才报错。
 *
 * 返回 { ok, items: [{ thumb, image }], source, cached? }；thumb 用于网格展示，image 用于发送（已包代理路径防防盗链）。
 */

import { db } from '@/lib/db';

export const runtime = 'nodejs';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 360 主源预算（实测 ~0.6s，留足余量） */
const SO_360_TIMEOUT_MS = 4_500;
/** 发表情海外常态超时：只给短预算，回不来不拖慢响应（国内部署它反而快） */
const FBQ_TIMEOUT_MS = 1_500;
const MAX_ITEMS = 60;

interface StickerHit {
  /** 网格缩略图（可直接 <img> 加载） */
  thumb: string;
  /** 发送用原图（已包 /api/sticker-image 代理） */
  image: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 原始 URL → 代理路径（防防盗链 + 隐藏外域） */
function proxied(raw: string): string {
  return `/api/sticker-image?u=${encodeURIComponent(raw)}`;
}

// ---------------- 源 1（主）：360 图片 image.so.com /j JSON 接口 ----------------

interface So360Item {
  img?: string;
  thumb?: string;
  _thumb?: string;
  imgkey?: string;
  id?: string;
  width?: number;
  height?: number;
}

async function fetchSo360(q: string): Promise<StickerHit[]> {
  const url = `https://image.so.com/j?q=${encodeURIComponent(`${q} 表情包`)}&src=srp&correct=&pn=${MAX_ITEMS}&sn=0`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://image.so.com/',
    },
    signal: AbortSignal.timeout(SO_360_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`so360 HTTP ${res.status}`);
  const data = (await res.json()) as { list?: So360Item[] };
  const list = Array.isArray(data.list) ? data.list : [];
  const hits: StickerHit[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const raw = it.img;
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (/\.(svg|ico)(\?|$)/i.test(raw)) continue;
    // 图片太小（<100px 宽）多半是站点图标/分割线，跳过
    if (typeof it.width === 'number' && it.width > 0 && it.width < 100) continue;
    const key = it.imgkey || it.id || raw.replace(/^https?:/i, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const thumbRaw = it._thumb || it.thumb;
    hits.push({
      thumb: thumbRaw && /^https?:\/\//i.test(thumbRaw) ? proxied(thumbRaw) : proxied(raw),
      image: proxied(raw),
    });
    if (hits.length >= MAX_ITEMS) break;
  }
  if (hits.length === 0) throw new Error('so360 解析为空');
  return hits;
}

// ---------------- 源 2（副）：发表情 fabiaoqing.com（搜索页 HTML 宽容解析） ----------------

async function fetchFabiaoqing(q: string): Promise<StickerHit[]> {
  const url = `https://fabiaoqing.com/search/search/keyword/${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(FBQ_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`fabiaoqing HTTP ${res.status}`);
  const html = await res.text();
  const hits: StickerHit[] = [];
  const seen = new Set<string>();
  // 宽容解析：<img> 的 data-original / data-gif / src 提取静态图片直链（搜索页结构：div.tagbqppdiv > img）
  const imgRe = /<img\b[^>]*>/gi;
  const attrRe = /(?:data-original|data-gif|src)=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["']/i;
  for (const tag of html.match(imgRe) ?? []) {
    const m = attrRe.exec(tag);
    if (!m) continue;
    let u = m[1];
    if (u.startsWith('//')) u = `https:${u}`;
    if (!/^https?:\/\//.test(u)) continue;
    // 过滤站点小图：logo/头像/图标类命名
    if (/logo|icon|avatar|\.svg/i.test(u)) continue;
    const key = u.replace(/^https?:/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ thumb: proxied(u), image: proxied(u) });
    if (hits.length >= MAX_ITEMS) break;
  }
  if (hits.length === 0) throw new Error('fabiaoqing 解析为空');
  return hits;
}

// ---------------- 路由 ----------------

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 30);
  if (!q) return NextResponse.json({ ok: false, error: '缺少搜索词' }, { status: 400 });

  // 1) 缓存命中（24h 内）
  try {
    const row = await db.stickerSearchCache.findUnique({ where: { keyword: q } });
    if (row && Date.now() - row.updatedAt.getTime() < CACHE_TTL_MS) {
      const items = JSON.parse(row.items) as StickerHit[];
      if (Array.isArray(items) && items.length > 0) {
        return NextResponse.json({ ok: true, items, source: row.source, cached: true });
      }
    }
  } catch {
    /* 缓存读写失败不阻塞搜索 */
  }

  // 2) 双源并发竞速（发表情只给短预算，超时不拖慢 360 主源）
  const results = await Promise.allSettled([fetchSo360(q), fetchFabiaoqing(q)]);
  const so360 = results[0].status === 'fulfilled' ? results[0].value : null;
  const fbq = results[1].status === 'fulfilled' ? results[1].value : null;

  let items: StickerHit[] = [];
  let source = '';
  if (fbq && so360) {
    // 合并去重：发表情斗图内容在前、360 补足（原图维度去重）
    const seen = new Set<string>();
    items = [...fbq, ...so360].filter((h) => {
      const key = h.image.replace(/^\/api\/sticker-image\?u=/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    source = 'both';
  } else if (fbq) {
    items = fbq;
    source = 'fabiaoqing';
  } else if (so360) {
    items = so360;
    source = 'so360';
  }

  // 3) 全挂 → 过期缓存兜底
  if (items.length === 0) {
    try {
      const row = await db.stickerSearchCache.findUnique({ where: { keyword: q } });
      if (row) {
        const stale = JSON.parse(row.items) as StickerHit[];
        if (Array.isArray(stale) && stale.length > 0) {
          return NextResponse.json({ ok: true, items: stale, source: row.source, cached: true, stale: true });
        }
      }
    } catch {
      /* 继续报错 */
    }
    return NextResponse.json({ ok: false, error: '搜索失败，换个词试试' }, { status: 502 });
  }

  // 4) 写缓存（失败不阻塞）
  const sliced = items.slice(0, MAX_ITEMS);
  try {
    await db.stickerSearchCache.upsert({
      where: { keyword: q },
      update: { items: JSON.stringify(sliced), source },
      create: { keyword: q, items: JSON.stringify(sliced), source },
    });
  } catch {
    /* 忽略 */
  }

  return NextResponse.json({ ok: true, items: sliced, source });
}
