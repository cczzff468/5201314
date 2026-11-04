import { NextResponse, type NextRequest } from 'next/server';
import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 淘宝历史订单 AI 生成接口（需求「淘宝美团全部界面上滑/下滑刷新生成走用户配置的 API 模型」）：
 * - 优先用「设置 › API 配置」里用户配置好的 OpenAI 兼容模型；未配置/失败 → 内置模型兜底；
 *   两级都失败返回 { ok:false }，前端走本地确定性生成器（tbGenHistoryOrders），永不空转；
 * - 商品 tag 强制落在本地卡通插画白名单内（图片与内容一致）；排除名单保证刷新/上滑出的都是新订单。
 */

interface TbOrderRaw {
  shopName?: unknown;
  itemTitle?: unknown;
  tag?: unknown;
  skuText?: unknown;
  price?: unknown;
  qty?: unknown;
  daysAgo?: unknown;
  canceled?: unknown;
}

const strOf = (v: unknown, def: string, max: number): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || def).slice(0, max);
};
const numOf = (v: unknown, def: number, lo: number, hi: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 与 goods-img.ts TB_GOODS 对齐的品类白名单（生成订单必有图） */
const TAGS = [
  'phone', 'earbuds', 'laptop', 'watch', 'tablet', 'camera', 'keyboard', 'powerbank', 'speaker', 'lock',
  'phone-stand', 'mouse', 'monitor', 'tv', 'drone', 'gamepad',
  'fridge', 'washer', 'fan', 'vacuum', 'microwave', 'rice-cooker', 'kettle', 'air-fryer', 'coffee-machine', 'humidifier', 'shaver', 'toothbrush', 'hairdryer',
  'tshirt', 'jeans', 'dress', 'jacket', 'hoodie', 'coat', 'shirt', 'hat', 'sneakers', 'shoes', 'slippers', 'backpack', 'suitcase', 'wallet', 'sunglasses', 'belt', 'scarf', 'socks', 'shorts',
  'lipstick', 'perfume', 'skincare', 'makeup', 'brush', 'face-mask',
  'sofa', 'bedding', 'lamp', 'mug', 'vase', 'pillow', 'desk', 'curtain', 'towel', 'storage', 'carpet', 'lunchbox', 'umbrella', 'water-bottle',
  'snacks', 'cookies', 'tea', 'fruit', 'books', 'pen', 'notebook', 'toy', 'blocks', 'toy-car', 'puzzle', 'guitar', 'basketball', 'yoga-mat', 'dumbbell', 'flower', 'gift',
];

const SYSTEM = `你是淘宝 App 的历史订单数据生成器。生成真实感的历史订单（过去已完成/已发货/少量已取消）。
严格输出 JSON 数组，每个元素字段：
- "shopName": 店铺名（≤12字，带"旗舰店/专营店/专卖店"等后缀）
- "itemTitle": 商品标题（≤30字，带品牌型号的电商风格标题，如"小米15 旗舰5G手机 曜金黑 16G+512G 全网通"）
- "tag": 品类词，只能取这个列表里的值：${TAGS.join('|')}（必须与商品一致：手机=phone、口红=lipstick、牛仔裤=jeans…）
- "skuText": 已选规格（≤20字，如"颜色分类：曜金黑；存储容量：16GB+512G"）
- "price": 单价（数字，符合品类价位）
- "qty": 数量（1~3 整数）
- "daysAgo": 距今天数（1~30 整数）
- "canceled": 是否已取消（约 8% 为 true）
要求：商品/店铺绝不能与排除名单重复；品类多样化（数码、服饰、美妆、家居、食品、图书都要出现）；不要输出任何 JSON 之外的文字。`;

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ ok: false, error: 'bad body' }, { status: 400 });
  const config = extractUpstreamConfig(body.config);
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === 'string').slice(0, 80) : [];
  const count = Math.min(8, Math.max(1, Math.round(numOf(body.count, 2, 1, 8))));
  const nonce = strOf(body.nonce, '', 24) || `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  const user = `生成 ${count} 条互不重复的淘宝历史订单。排除名单（商品标题命中即跳过）：${exclude.length ? exclude.join('、') : '（无）'}。随机口令：${nonce}。`;

  let items: TbOrderRaw[] | null = null;
  try {
    const { text } = await completeWithFallback(config, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ]);
    items = parseLooseJSON<TbOrderRaw[]>(text);
  } catch {
    items = null;
  }
  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ ok: false, error: '生成失败' }, { status: 200 });
  }

  const ex = new Set(exclude);
  const out: Record<string, unknown>[] = [];
  for (const raw of items) {
    const shopName = strOf(raw.shopName, '', 12);
    const itemTitle = strOf(raw.itemTitle, '', 30);
    if (!shopName || !itemTitle) continue;
    if (ex.has(itemTitle)) continue;
    ex.add(itemTitle);
    const tagRaw = strOf(raw.tag, '', 20).toLowerCase().replace(/[^a-z0-9-]/g, '');
    out.push({
      shopName,
      itemTitle,
      tag: (TAGS as string[]).includes(tagRaw) ? tagRaw : 'gift',
      skuText: strOf(raw.skuText, '', 20) || undefined,
      price: round2(numOf(raw.price, 59, 1, 99999)),
      qty: Math.min(3, Math.max(1, Math.round(numOf(raw.qty, 1, 1, 3)))),
      daysAgo: Math.round(numOf(raw.daysAgo, 3, 1, 30)),
      canceled: raw.canceled === true,
    });
    if (out.length >= count) break;
  }
  if (out.length === 0) return NextResponse.json({ ok: false, error: '无有效条目' }, { status: 200 });
  return NextResponse.json({ ok: true, items: out });
}
