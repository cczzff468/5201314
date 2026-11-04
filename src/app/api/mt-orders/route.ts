import { NextResponse, type NextRequest } from 'next/server';
import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团历史订单 AI 生成接口（需求「只要有订单的地方就能上滑刷新生成，下滑无限生成」）：
 * - 优先用「设置 › API 配置」里用户配置好的 OpenAI 兼容模型；未配置/失败 → 内置模型兜底；
 *   两级都失败返回 { ok:false }，前端走本地确定性生成器（mtGenHistoryOrders），永不空转；
 * - 频道覆盖：外卖/闪购/团购/机票/火车票/酒店/电影演出/休闲玩乐；排除名单保证下拉/上滑出的都是新订单；
 * - 图片由前端按 channel 映射本地卡通插画（mtImg），与内容一致。
 */

interface MtOrderRaw {
  merchantName?: unknown;
  kind?: unknown;
  channel?: unknown;
  itemName?: unknown;
  price?: unknown;
  qty?: unknown;
  total?: unknown;
  spec?: unknown;
  daysAgo?: unknown;
  canceled?: unknown;
}

const KINDS = new Set(['waimai', 'tuangou', 'flight', 'train']);
const CHANNELS = new Set(['waimai', 'shangou', 'tuangou', 'hotel', 'movie', 'fun', 'flight', 'train']);

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

const SYSTEM = `你是美团 App 的历史订单数据生成器。根据要求生成真实感的历史订单列表（全部是过去已完成/少量已取消的订单）。
严格输出 JSON 数组，每个元素字段：
- "merchantName": 商家名（≤16字，带分店名，如"亚朵酒店（市中心店）"/"万达影城（IMAX店）"/"永辉超市（万达店）"/"美团机票"/"美团火车票"/真实外卖店名）
- "channel": 频道，只能取 "waimai"|"shangou"|"tuangou"|"hotel"|"movie"|"fun"|"flight"|"train"
- "kind": 履约类型，只能取 "waimai"|"tuangou"|"flight"|"train"（酒店/电影/玩乐用 tuangou，闪购用 waimai）
- "itemName": 商品名（≤24字，与商家频道一致：酒店是房型、电影是影票、机票是"南航CZ6789 北京→上海 经济舱"格式、火车票是"G101次 北京南→上海虹桥 二等座"格式、闪购是超市商品）
- "price": 单价（数字，符合频道价位：闪购 5~50、外卖 15~80、团购 39~168、酒店 159~529、电影 35~99、机票 400~1500、火车票 60~950）
- "qty": 数量（1~3 整数）
- "total": 实付总价（数字，≈price×qty）
- "spec": 规格短句（≤16字，如"已离店 · 在线选房"/"已过场次 · 凭码入场"/"极速送 · 30分钟达"）
- "daysAgo": 距今天数（1~30 整数）
- "canceled": 是否已取消（约 8% 为 true）
要求：商家名/商品名绝不能与排除名单重复；频道多样化（外卖、闪购、团购、机票、火车票、酒店、电影演出都要出现）；不要输出任何 JSON 之外的文字。`;

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ ok: false, error: 'bad body' }, { status: 400 });
  const config = extractUpstreamConfig(body.config);
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === 'string').slice(0, 80) : [];
  const count = Math.min(8, Math.max(1, Math.round(numOf(body.count, 3, 1, 8))));
  const nonce = strOf(body.nonce, '', 24) || `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  const user = `生成 ${count} 条互不重复的美团历史订单。排除名单（商家名或商品名命中即跳过）：${exclude.length ? exclude.join('、') : '（无）'}。随机口令：${nonce}。`;

  let items: MtOrderRaw[] | null = null;
  try {
    const { text } = await completeWithFallback(config, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ]);
    items = parseLooseJSON<MtOrderRaw[]>(text);
  } catch {
    items = null;
  }
  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ ok: false, error: '生成失败' }, { status: 200 });
  }

  const ex = new Set(exclude);
  const out: Record<string, unknown>[] = [];
  for (const raw of items) {
    const merchantName = strOf(raw.merchantName, '', 16);
    const itemName = strOf(raw.itemName, '', 24);
    if (!merchantName || !itemName) continue;
    const key = `${merchantName}|${itemName}`;
    if (ex.has(key)) continue;
    ex.add(key);
    const kindRaw = typeof raw.kind === 'string' && KINDS.has(raw.kind) ? raw.kind : 'waimai';
    const channelRaw = typeof raw.channel === 'string' && CHANNELS.has(raw.channel) ? raw.channel : kindRaw;
    const price = round2(numOf(raw.price, 29.9, 0.5, 9999));
    const qty = Math.min(3, Math.max(1, Math.round(numOf(raw.qty, 1, 1, 3))));
    const total = round2(numOf(raw.total, price * qty, 0.5, 99999));
    out.push({
      merchantName,
      itemName,
      kind: kindRaw,
      channel: channelRaw,
      price,
      qty,
      total,
      spec: strOf(raw.spec, '', 16) || undefined,
      daysAgo: Math.round(numOf(raw.daysAgo, 3, 1, 30)),
      canceled: raw.canceled === true,
    });
    if (out.length >= count) break;
  }
  if (out.length === 0) return NextResponse.json({ ok: false, error: '无有效条目' }, { status: 200 });
  return NextResponse.json({ ok: true, items: out });
}
