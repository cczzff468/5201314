/**
 * 淘宝客服 AI（第十六轮「开发淘宝消息界面 + AI 提示词规则」+ 多条连发改造）：
 * - 每个店铺一位专属客服（昵称稳定派生），回复走 /api/chat：
 *   「设置 › API 配置」用户配置的 OpenAI 兼容模型优先 → 内置模型（forceSdk）兜底；
 * - 单次请求失败自动重试：总共最多 3 次尝试（初次 + 2 次重试，间隔 1.2s），全部失败返回 null
 *   —— 不再有本地规则兜底/占位文字，由聊天页在触发消息上打红色 ! 徽标（点击重新生成）；
 * - 提示词规则：亲切淘宝客服人设 + 店铺资料 + 在售商品目录 + 买家订单上下文 +
 *   服务守则（称呼/连发多条短消息 1~10 条/发货/售后/物流/尺码/优惠/红线/推荐标记 [商品:ID]）；
 * - 回复按行拆成多条短消息（parseSellerReply → lines），[商品:pid] 标记提取出来由聊天页转成商品卡片。
 */
import { useSettings } from './store';
import { splitReplySegments } from '@/lib/reply-count';
import { tbSearchPool, productById, type TbProduct, type TbShop } from './taobao-data';
import { tbLoadOrders, type TbOrder } from './taobao-store';

// ---------------- 客服昵称（同店铺稳定，不同店铺不同：月月/小雨…对照用户截图） ----------------

const AGENT_NAMES = ['月月', '小雨', '安安', '桃子', '晚晚', '糖果', '暖暖', '乐乐', '星野', '苗苗'];

export function tbSellerName(shopId: string): string {
  let h = 0;
  for (let i = 0; i < shopId.length; i++) h = (h * 31 + shopId.charCodeAt(i)) >>> 0;
  return AGENT_NAMES[h % AGENT_NAMES.length];
}

// ---------------- 上下文 ----------------

export interface TbSellerCtx {
  shop: TbShop;
  /** 正在咨询的商品（从商品页「客服」进入时带入） */
  product?: TbProduct | null;
  /** 正在咨询的订单（从订单/物流页「客服」进入时带入） */
  order?: TbOrder | null;
  /** 买家昵称 */
  custName: string;
}

function orderStatusText(o: TbOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '待付款';
    case 'pendingDeliver':
      return '待发货（付款后 48 小时内发出）';
    case 'shipped':
      return `待收货（${o.track?.[o.track.length - 1]?.text ?? '运输中'}）`;
    case 'completed':
      return '已完成';
    case 'cancelled':
      return o.refund ? `已退款（¥${o.refund.amount.toFixed(2)} 原路退回）` : '已取消';
    default:
      return o.status;
  }
}

/** 店铺在售商品目录（种子 + AI 注册；本店优先，不足补热卖） */
function shopCatalog(shop: TbShop): TbProduct[] {
  const all = tbSearchPool();
  const own = all.filter((p) => p.shopId === shop.id);
  return own.length >= 6 ? own.slice(0, 8) : [...own, ...all.filter((p) => p.shopId !== shop.id)].slice(0, 8);
}

/** 拼商品行：ID | 标题 | ¥价格 */
function productLine(p: TbProduct): string {
  return `- ${p.id} | ${p.title.slice(0, 40)} | ¥${p.price}`;
}

/**
 * AI 提示词规则（客服人设 + 服务守则 + 上下文）。
 * 规则要点（对照真实淘宝客服话术）：
 * 1 称呼「亲」+ 连发多条短消息（1~10 条、一行一条、每条 ≤25 字左右）；2 只聊本店商品/订单/售后；
 * 3 发货 48h（预售 30 天）；4 售后按店铺口径；5 不编物流单号；6 尺码给确定建议；7 不虚构折扣；
 * 8 红线（不承诺功效/不引导线下/不索验证码）；9 推荐商品输出 [商品:ID]（可放在某行末尾）；
 * 10 退款安抚+原路退回口径；11 纯文本简体中文（多行即多条消息）。
 */
export function buildSellerSystemPrompt(ctx: TbSellerCtx): string {
  const { shop, product, order, custName } = ctx;
  const agent = tbSellerName(shop.id);
  const catalog = shopCatalog(shop)
    .map(productLine)
    .join('\n');
  const lines: string[] = [
    `你是淘宝店铺「${shop.name}」的资深客服「${agent}」（店铺体验分 ${shop.rating} 分，${shop.tmall ? '天猫店' : '淘宝企业店'}，店铺简介：${shop.desc ?? '好物甄选'}）。`,
    `你正在和买家「${custName}」用淘宝旺信聊天。`,
    '',
    '【沟通规则（必须遵守）】',
    '1. 称呼买家「亲」，语气亲切热情、口语化；你会连发多条淘宝客服短消息：最少 1 条、最多 10 条，按问题复杂度自然决定条数；每条独立成行（一行一条），每条不超过 25 字左右，语气像真实客服打字（亲~口吻保留）。',
    '2. 只聊与本店商品、订单、售后、物流有关的话题；无关话题礼貌拉回：「亲，咱们聊聊宝贝和订单的事哦~」。',
    '3. 发货时间：现货 48 小时内发出；预售/定制款 30 天内发货；买家催发货就安抚并说会优先安排。',
    '4. 售后：本店支持质量问题包退换；7 天无理由、退货宝等以商品服务标签为准，不夸大承诺。',
    '5. 物流：绝不编造具体快递单号；让买家点「查看物流」或稍等，说系统会自动推送轨迹。',
    '6. 尺码/规格咨询：买家给身高体重时要给出确定的推荐（衣服给码数 S/M/L，鞋子给码数，家具给尺寸），语气笃定不模棱两可。',
    '7. 价格优惠：不虚构折扣；可以提示「领店铺券」「满减活动」引导下单。',
    '8. 红线：不承诺任何医疗/保健功效；不引导线下交易或加联系方式；不索要密码、验证码。',
    '9. 推荐商品时：[商品:商品ID] 标记可放在合适的某一行末尾，系统会把标记行转成商品卡片；只能推荐下方「在售商品目录」里给出的 ID，一次最多 1 个。',
    '10. 退款/售后诉求：先安抚（亲别着急~），说明退款原路退回、1~3 个工作日到账，并引导在订单页申请。',
    '11. 全程简体中文纯文本：不用 markdown、不用表情符号代码；多条消息就是多行文本，一行一条。',
    '12. 买家发的纯字母缩写（wyxn、xswl、yyds 这类）按拼音首字母逐字拆解理解（wyxn=我也想你、xswl=笑死我了），不确定就礼貌问一句，绝不瞎猜错意思。',
    '',
    '【在售商品目录】（推荐时输出 [商品:ID]，仅限以下 ID）',
    catalog,
  ];
  if (product) {
    lines.push(
      '',
      '【买家正在咨询的商品】',
      productLine(product),
      `- 服务标签：${product.tags.join('、') || '无'}；销量：已售${product.sales}+`,
      product.skus.length > 0
        ? `- 规格：${product.skus.map((g) => `${g.name}（${g.options.map((o) => o.label).slice(0, 4).join('/')}）`).join('；')}`
        : '',
    );
  }
  if (order) {
    lines.push(
      '',
      '【买家正在咨询的订单】',
      `- 订单号 ${order.id}｜状态：${orderStatusText(order)}｜实付 ¥${order.total.toFixed(2)}`,
      `- 商品：${order.items.map((i) => `${i.title.slice(0, 20)}×${i.qty}`).join('、')}`,
      order.createdAt ? `- 下单时间：${new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}` : '',
    );
  }
  return lines.filter((l) => l !== undefined).join('\n');
}

/** 历史消息（只取文本，卡片转占位描述） */
export interface TbSellerHistoryMsg {
  role: 'user' | 'bot';
  text?: string;
  card?: { type: 'product'; pid: string } | { type: 'order'; orderId: string };
}

function historyToApiMessages(history: TbSellerHistoryMsg[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of history.slice(-8)) {
    if (m.card && !m.text) {
      const label = m.card.type === 'product' ? `（发了商品卡：${productById(m.card.pid)?.title ?? m.card.pid}）` : '（发了订单卡）';
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: label });
    } else if (m.text?.trim()) {
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    }
  }
  return out;
}

/**
 * 从回复中拆出 [商品:pid] 标记，并把正文切成多条短消息：
 * - 标记剥除（最多收录 2 个真实存在的 pid），标记本身不进气泡；
 * - 正文不再折叠换行：用 splitReplySegments 多条模式稳定切分（换行 + 句末标点为界，
 *   AI 把多句挤进一行时也能按句切开；连续重复段去重），最多取 10 条（提示词约定 1~10 条）；
 * - 返回 { lines, pids }：文本多条由调用方逐条落库，商品卡按 pids 追加在文本之后。
 */
export function parseSellerReply(text: string): { lines: string[]; pids: string[] } {
  const pids: string[] = [];
  const cleaned = text.replace(/\s*\[商品[:：]\s*([a-zA-Z0-9-]+)\s*\]/g, (_m, pid: string) => {
    if (pids.length < 2 && productById(pid)) pids.push(pid);
    return '';
  });
  const lines = splitReplySegments(cleaned, true)
    .filter((s) => s.length > 0)
    .slice(0, 10);
  return { lines, pids };
}

/**
 * 客服回复：单次尝试 = 用户配置模型 → 失败/空回复再试内置模型（forceSdk）；
 * 失败（fetch 失败/非 ok/空文本）自动重试：总共最多 3 次尝试（初次 + 2 次重试，间隔 1.2s），
 * 全部失败返回 null —— 不落任何模板兜底，由聊天页给触发消息打红色 ! 徽标（点击重新生成）。
 * /api/chat 非流式文本返回（与 friend-state/cross-app-reach 同模式）。
 */
export async function tbSellerReply(userText: string, history: TbSellerHistoryMsg[], ctx: TbSellerCtx): Promise<string | null> {
  const apiMsgs = [
    { role: 'system' as const, content: buildSellerSystemPrompt(ctx) },
    ...historyToApiMessages(history),
    { role: 'user' as const, content: userText || '（买家发来一个表情）' },
  ];
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMsgs, ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  // 单次尝试：用户配置模型 → 空回复/异常再试内置模型（forceSdk）
  const attempt = async (): Promise<string> => {
    try {
      const raw = await call({ config: useSettings.getState().apiConfig });
      if (raw.trim()) return raw;
    } catch {
      // 用户配置模型失败 → 落到内置模型重试
    }
    try {
      return await call({ forceSdk: true });
    } catch {
      return '';
    }
  };
  const MAX_ATTEMPTS = 3; // 初次 + 2 次重试
  const RETRY_DELAY_MS = 1_200;
  let raw = '';
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    raw = await attempt();
    if (raw.trim()) break;
    if (i < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  const cleaned = raw.replace(/^"|"$/g, '').trim();
  return cleaned || null;
}
