import { NextRequest, NextResponse } from 'next/server';
import { mtFoodTagOf, mtImg, MT_CATS, type MtDeal, type MtDealPackage, type MtDealMenu, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团信息流 AI 生成接口：
 * - 优先用「设置 › API 配置」里用户配置好的 OpenAI 兼容模型（config 随请求体传入）；
 * - 未配置 / 上游失败 → 内置模型（z-ai-web-dev-sdk）兜底；
 * - 每次请求注入随机口令 + 排除名单（已展示内容），保证下拉刷新 / 上滑加载出来的都是新内容；
 * - 图片走本地 kawaii 卡通插画（goods-img.ts 按品类映射，图片与内容一致），生成数据仅展示用。
 */

// ---------------- 类型 ----------------

interface FeedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

type RawRec = Record<string, unknown>;

interface GenerateArgs {
  topic: string;
  mode: 'mixed' | 'merchant' | 'deal';
  count: number;
  exclude: string[];
  nonce: string;
}

// ---------------- 工具 ----------------

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? clampN(n, lo, hi) : def;
}

function intOf(v: unknown, def: number, lo: number, hi: number): number {
  return Math.round(num(v, def, lo, hi));
}

function strOf(v: unknown, def: string, maxLen = 40): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || def).slice(0, maxLen);
}

/** 名称哈希 → 图变体序号（同名词同图，5 个变体轮换增加多样性） */
function imgVariant(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 5;
}

/** tag 清洗（模型可能返回任意字符串）：小写、仅留 a-z0-9- */
function tagOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return t || null;
}

/** 内容匹配图：菜名词典 → 模型 tag → 通用 food（保证图片与内容一致） */
function dishTagOf(name: string, modelTag: string | null): string {
  return mtFoodTagOf(name) ?? modelTag ?? 'food';
}

/** baseUrl 归一化候选：完整端点 / /v1 结尾 / 裸域名（与 /api/chat 同策略） */
function buildCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

// ---------------- 上游调用 ----------------

/** 用户配置的 OpenAI 兼容接口（非流式，带 400 换参重试 + SSE 文本兜底解析） */
async function upstreamText(cfg: FeedConfig, system: string, user: string): Promise<string> {
  const candidates = buildCandidates(cfg.baseUrl);
  let useMaxCompletion = false;
  let temperature: number | undefined = cfg.temperature;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response | undefined;
    for (const endpoint of candidates) {
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            stream: false,
            ...(temperature === undefined ? {} : { temperature }),
            ...(useMaxCompletion ? { max_completion_tokens: cfg.maxTokens } : { max_tokens: cfg.maxTokens }),
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) continue;
        break;
      } catch (err) {
        lastErr = err;
        res = undefined;
      }
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error('上游接口连接失败');
    if (res.status === 400) {
      const msg = (await res.text().catch(() => '')).slice(0, 300);
      if (!useMaxCompletion && /max_completion_tokens/i.test(msg)) {
        useMaxCompletion = true;
        continue;
      }
      if (temperature !== undefined && /temperature/i.test(msg)) {
        temperature = undefined;
        continue;
      }
      throw new Error(`上游 400：${msg || '参数被拒绝'}`);
    }
    if (!res.ok) throw new Error(`上游接口返回 ${res.status}`);

    const raw = (await res.text()).trim();
    if (!raw) throw new Error('上游接口返回空响应');

    // 个别网关用 200 + SSE 文本返回
    if (raw.startsWith('data:')) {
      let acc = '';
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
        try {
          const chunk: unknown = JSON.parse(t.slice(5).trim());
          const c = (chunk as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> })
            .choices?.[0];
          const content = c?.message?.content ?? c?.delta?.content;
          if (typeof content === 'string') acc += content;
        } catch {
          // 忽略无法解析的行
        }
      }
      if (acc.trim()) return acc;
    }
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const payload: unknown = JSON.parse(raw);
        const c = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
        if (typeof c === 'string' && c.trim()) return c;
        if (typeof payload === 'object' && payload !== null) {
          const direct =
            (payload as { content?: unknown; response?: unknown }).content ??
            (payload as { response?: unknown }).response;
          if (typeof direct === 'string' && direct.trim()) return direct;
        }
      } catch {
        // 非 JSON，按纯文本返回
      }
    }
    return raw;
  }
  throw new Error('上游接口重试次数用尽');
}

/** 内置模型兜底（z-ai-web-dev-sdk，仅后端）；429 限流自动退避重试 */
async function sdkText(system: string, user: string): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      });
      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) throw new Error('内置模型返回空内容');
      return text;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/429|Too many requests/i.test(msg) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('内置模型请求失败');
}

// ---------------- 输出解析 ----------------

/** 逐对象容错扫描：string-aware 括号配对，逐个提取完整 {} 解析。
 *  模型长输出可能被截断或中间出现坏字节（整体 JSON.parse 失败），逐对象提取能救回大部分数据。 */
function extractObjects(raw: string): RawRec[] {
  const t = raw.replace(/\uFFFD/g, '');
  const objs: RawRec[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const v: unknown = JSON.parse(t.slice(start, i + 1));
          if (typeof v === 'object' && v !== null) objs.push(v as RawRec);
        } catch {
          // 跳过坏对象
        }
        start = -1;
      }
    }
  }
  return objs;
}

/** 从模型输出提取数据项：先试整体 JSON（含 markdown 剥壳），失败 → 逐对象容错扫描 */
function parseItems(raw: string): RawRec[] {
  const t = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const s = t.indexOf('[');
  const e = t.lastIndexOf(']');
  if (s !== -1 && e > s) {
    try {
      const v: unknown = JSON.parse(t.slice(s, e + 1));
      if (Array.isArray(v)) return v.filter((x): x is RawRec => typeof x === 'object' && x !== null);
    } catch {
      // 落入逐对象扫描
    }
  }
  return extractObjects(t);
}

// ---------------- 提示词 ----------------

function buildSystem(): string {
  return '你是美团信息流数据引擎，负责生成逼真的本地生活商家与团购数据。数值必须符合现实常识（评分 3.8~5.0、价格与折扣自洽、距离 0.3~8 公里）。只输出 JSON，不要输出任何解释、注释或 markdown 代码块。';
}
function buildUser(a: GenerateArgs): string {
  // schema：商家菜单分节（招牌菜/小吃甜品/饮品）以装下 8~10 个菜品
  const merchantSchema =
    '{"kind":"merchant","name":"老灶火锅·望京店","emoji":"🍲","tag":"hotpot","rating":4.8,"monthSale":3200,"minOrder":20,"deliveryFee":2,"distanceKm":1.5,"deals":["满30减5"],"addr":"望京街道湖光中街1号","menu":[{"sec":"招牌菜","items":[{"name":"招牌毛肚","price":38},{"name":"鲜切牛肉","price":45},{"name":"手打虾滑","price":32}]},{"sec":"小吃甜品","items":[{"name":"红糖糍粑","price":12}]},{"sec":"饮品","items":[{"name":"酸梅汤","price":6}]}]}';
  const dealSchema =
    '{"kind":"deal","title":"双人烤肉超值套餐","emoji":"🍖","tag":"bbq","price":88,"origPrice":168,"sold":"已售1.2万+","praise":"96%好评","tips":"到店吃","distanceKm":2.1,"merchantName":"炭一烤肉·望京店","packages":[{"name":"A套餐·经典双人餐","price":88,"items":["经典烤肉拼盘","时蔬拼盘","饮品2杯"]},{"name":"B套餐·豪华双人餐","price":118,"items":["豪华烤肉拼盘","海鲜拼盘","主食2份","饮品2杯"]}],"menu":[{"sec":"烤肉 3选1","items":[{"name":"经典烤肉拼盘","price":168},{"name":"时蔬拼盘","price":98},{"name":"海鲜拼盘","price":198}]},{"sec":"固选","items":[{"name":"饮品2杯","price":20}]}]}';

  const kindRule =
    a.mode === 'merchant'
      ? '每条都是 kind="merchant" 的商家。'
      : a.mode === 'deal'
        ? '每条都是 kind="deal" 的团购（必须带 merchantName）。'
        : '在数组最前面加 1 条 {"kind":"list","title":"<新颖主题名，5~8字，如「深秋寻味6折起」>"}；其余条目中商家（kind="merchant"）与团购（kind="deal"，必须带 merchantName）数量大致各半。';

  return [
    `生成 ${a.count} 条美团「${a.topic}」信息流数据。${kindRule}`,
    `本次随机口令「${a.nonce}」：商家名、套餐名必须新颖独特（可自创小店品牌+品类/分店后缀，如「巷口葱油饼·五道口店」风格），禁止照抄知名连锁品牌原名。`,
    a.topic.includes('看病买药')
      ? '本频道是药房/药店：商家名 = 自创前缀 + 业态后缀。前缀从「益丰堂/百信/仁安/济民/同泽/安康/惠民/德信/民泰/众康/泰安/华康/保生/杏林/回春/百草/康本/顺安/泽民/正德」等中挑选并自由组合，同一批内前缀不得重复，禁止整批都用「康宁」或都用同一前缀；后缀在大药房/医药/药店/健康药房/医药商场中变化，可带分店名（如·建设路店）。商家与菜品的 tag 一律填 medicine（口罩类菜品可填 mask、创可贴 bandage、维生素/保健品 vitamin），菜单分节改为「感冒发烧/肠胃用药/保健养生/医疗器械」等药字号分节。'
      : '',
    a.topic.includes('闪购超市便利')
      ? '本频道是闪购（30~60 分钟即时配送）：商家都是 便利店/超市/水果店/鲜花店/零食仓/日用百货仓/药房闪购店，同一批业态尽量多样不重复，店名自创（可带·分店后缀）；菜品 = 可即时配送的商品（零食饮料/速食/日用/纸巾/水果果切/鲜花花束/应急药品），商品名口语化（如「冰镇可乐 500ml」「抽纸 3 层 8 包」）；tag 按商品填（饮料 cola、零食/日用/百货 store、水果 fruit、鲜花 flower、药品 medicine），分节名用「热销推荐/零食饮料/日用清洁/应急药品」等闪购分节；价格 2~69 元，monthSale 100~30000。'
      : '',
    a.exclude.length > 0
      ? `以下名称已展示过，禁止再出现（商家名与套餐名都不得重复）：\n${a.exclude.join('、')}`
      : '无排除名单。',
    '字段规范（示例名称仅示意格式，输出中禁止出现「老灶火锅」「炭一烤肉」等示例名）：',
    `merchant = ${merchantSchema}`,
    `deal = ${dealSchema}`,
    `要求：rating 3.8~5.0；monthSale 50~90000 整数；price 与 origPrice 自洽（origPrice 更高，折扣约 3~8 折）；distanceKm 0.3~8 一位小数；deals 为 0~2 个优惠文案；merchant 的 menu 分「招牌菜/小吃甜品/饮品」2~3 个 sec、共 10~14 个菜品（招牌菜 6~8 个+小吃甜品 2~4 个+饮品 2 个，items 只含 name/price）；tag 必须从以下白名单中选最贴切的一个，禁止自造词：hotpot、barbecue、bbq、chinese-food、stir-fry、japanese、sushi、thai、asian、curry、kimchi、pizza、burger、fried-chicken、fast-food、milk-tea、coffee、tea、juice、dessert、ice-cream、seafood、steak、beef、pork、duck、lamb、salad、sandwich、bread、dumplings、porridge、soup、noodles、rice、rice-bowl、breakfast、fruit、braised、spicy、store、flower、medicine、food；deal 的 packages 为 2~3 个可选套餐（name 以 A套餐/B套餐开头且简短、price 递增、每个含 3~6 个 items 短语）；deal 的 menu 用「XX N选1」分节（如「烤肉 3选1」，供用户购买时选择，另加 1 个「固选」节）。全部简体中文（tag 除外），数据要合理逼真。输出尽量精炼，确保 ${a.count} 条全部输出完整。`,
    '只输出一个 JSON 数组，不要 markdown 代码块，不要解释。',
  ].filter(Boolean).join('\n');
}

// ---------------- 数据塑形 ----------------

/** 兜底菜单库：模型菜单缺失/过少时按商家 tag 分组补齐，保证每店 7~15 个菜 */
type FallbackMenu = { sec: string; items: [string, number][] }[];
const FALLBACK_MENUS: Record<string, FallbackMenu> = {
  chinese: [
    { sec: '招牌菜', items: [['红烧狮子头', 32], ['宫保鸡丁', 26], ['糖醋排骨', 38], ['鱼香肉丝', 24], ['清蒸鲈鱼', 48], ['辣子鸡丁', 36], ['番茄牛腩', 42]] },
    { sec: '小吃主食', items: [['手工水饺', 12], ['葱油饼', 8], ['扬州炒饭', 16], ['鲜肉小笼包', 13]] },
    { sec: '饮品', items: [['鲜榨橙汁', 9], ['酸梅汤', 6], ['绿豆沙', 7]] },
  ],
  hotpot: [
    { sec: '招牌菜', items: [['招牌毛肚', 38], ['鲜切牛肉', 45], ['手打虾滑', 32], ['蜜汁烤翅', 18], ['香辣烤鱼', 58], ['雪花肥牛', 52], ['烤羊肉串', 6]] },
    { sec: '小吃甜品', items: [['红糖糍粑', 12], ['烤茄子', 10], ['烤韭菜', 8], ['蒜蓉扇贝', 15]] },
    { sec: '饮品', items: [['冰镇酸梅汤', 6], ['王老吉', 5]] },
  ],
  sushi: [
    { sec: '招牌菜', items: [['三文鱼刺身', 48], ['炙烤寿司拼盘', 39], ['鳗鱼饭', 36], ['天妇罗大虾', 28], ['金枪鱼手卷', 22], ['海鲜乌冬面', 30], ['咖喱猪排饭', 34]] },
    { sec: '小吃甜品', items: [['抹茶大福', 12], ['玉子烧', 10], ['章鱼小丸子', 15], ['海苔便当卷', 14]] },
    { sec: '饮品', items: [['玄米茶', 8], ['可尔必思', 9], ['朝日生啤', 15]] },
  ],
  western: [
    { sec: '招牌菜', items: [['经典玛格丽特披萨', 39], ['芝士牛肉堡', 22], ['香辣炸鸡桶', 45], ['黑椒牛排', 68], ['火腿三明治', 18], ['凯撒鸡肉沙拉', 26], ['蒜香法棍', 12]] },
    { sec: '小吃甜品', items: [['经典薯条', 10], ['洋葱圈', 12], ['鸡米花', 14], ['提拉米苏', 16]] },
    { sec: '饮品', items: [['美式咖啡', 12], ['柠檬气泡水', 10], ['可口可乐', 4]] },
  ],
  drinks: [
    { sec: '招牌饮品', items: [['厚芋泥波波奶茶', 15], ['生椰拿铁', 18], ['杨枝甘露', 16], ['珍珠奶茶', 10], ['芒果冰沙', 13], ['茉莉奶绿', 11], ['抹茶星冰乐', 22]] },
    { sec: '甜品小食', items: [['葡式蛋挞', 6], ['巴斯克蛋糕', 18], ['雪顶泡芙', 9], ['芋圆烧仙草', 14]] },
  ],
  store: [
    { sec: '热销推荐', items: [['冰镇可乐 500ml', 3], ['农夫山泉 550ml', 2], ['抽纸 3层8包', 12], ['乐事薯片 135g', 6], ['奥利奥家庭装', 10], ['士力架 4连包', 9], ['垃圾袋 45只装', 8]] },
    { sec: '水果鲜食', items: [['海南香蕉 1把', 6], ['红富士苹果 4个', 12], ['海苔饭团', 5], ['金枪鱼三明治', 9]] },
  ],
};

/** 白名单 tag → 兜底菜单分组（未命中的落 chinese 通用组） */
const MENU_GROUP_OF_TAG: Record<string, string> = {
  'chinese-food': 'chinese', 'stir-fry': 'chinese', braised: 'chinese', spicy: 'chinese',
  rice: 'chinese', 'rice-bowl': 'chinese', breakfast: 'chinese', dumplings: 'chinese',
  porridge: 'chinese', soup: 'chinese', noodles: 'chinese', food: 'chinese', asian: 'chinese', pork: 'chinese',
  hotpot: 'hotpot', barbecue: 'hotpot', bbq: 'hotpot', kimchi: 'hotpot', duck: 'hotpot', lamb: 'hotpot', beef: 'hotpot',
  japanese: 'sushi', sushi: 'sushi', seafood: 'sushi', thai: 'sushi', curry: 'sushi',
  pizza: 'western', burger: 'western', 'fried-chicken': 'western', 'fast-food': 'western',
  steak: 'western', sandwich: 'western', bread: 'western', salad: 'western',
  'milk-tea': 'drinks', coffee: 'drinks', tea: 'drinks', juice: 'drinks', dessert: 'drinks', 'ice-cream': 'drinks',
  store: 'store', flower: 'store', medicine: 'store', fruit: 'store',
};

/** 取商家对应的兜底菜单组（未知 tag 落中餐组） */
function fallbackMenuFor(fallbackTag: string | null): FallbackMenu {
  const key = (fallbackTag && MENU_GROUP_OF_TAG[fallbackTag]) || 'chinese';
  return FALLBACK_MENUS[key] ?? FALLBACK_MENUS.chinese;
}

function coerceDish(merchantName: string, idx: number, raw: unknown, fallbackTag: string | null): MtDish {
  // 模型可能把菜品返回为字符串（"毛肚"）而非对象：统一收窄
  const rec: RawRec =
    typeof raw === 'string'
      ? { name: raw }
      : typeof raw === 'object' && raw !== null
        ? (raw as RawRec)
        : {};
  const name = strOf(rec.name, `招牌菜${idx + 1}`, 24);
  // 内容匹配图：菜名词典 → 商家 tag → food；同名词同图（稳定可缓存）
  const tag = dishTagOf(name, fallbackTag);
  return {
    id: `ai-${merchantName}-${idx}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    price: num(rec.price, 12 + idx * 3, 0.5, 999),
    emoji: strOf(rec.emoji, '🍽️', 4),
    img: mtImg(tag, 400, 400, imgVariant(`${merchantName}-${name}`), 'f'),
    monthSale: intOf(rec.monthSale, 800 + Math.floor(Math.random() * 9000), 20, 999999),
  };
}

/** 商家菜单塑形：优先「分节」结构（招牌菜/小吃甜品/饮品），兼容旧版扁平菜品数组；
 *  模型返回缺失/过少时按商家 tag 从兜底菜单库补齐，保证 7~15 个菜 */
function coerceMenuSections(merchantName: string, rawMenu: unknown, fallbackTag: string | null): { cat: string; dishes: MtDish[] }[] {
  const arr = Array.isArray(rawMenu) ? rawMenu : [];
  const out: { cat: string; dishes: MtDish[] }[] = [];
  const first: RawRec | null = arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null ? (arr[0] as RawRec) : null;
  if (first && Array.isArray(first.items)) {
    // 新结构：[{sec:'招牌菜', items:[{name,price}]}, ...]
    for (const sec of arr.slice(0, 4)) {
      const s: RawRec = typeof sec === 'object' && sec !== null ? (sec as RawRec) : {};
      const dishes = (Array.isArray(s.items) ? s.items : []).slice(0, 6).map((d, i) => coerceDish(merchantName, i, d, fallbackTag));
      if (dishes.length > 0) out.push({ cat: strOf(s.sec, '推荐', 12), dishes });
    }
  } else {
    // 旧结构：扁平菜品数组/字符串
    const dishes = arr.slice(0, 10).map((d, i) => coerceDish(merchantName, i, d, fallbackTag));
    if (dishes.length > 0) out.push({ cat: '推荐', dishes });
  }
  // 补齐：菜单总数 < 7（模型漏返/字段错乱）→ 按商家 tag 从兜底库取菜补入，目标 7~12 个
  let total = out.reduce((n, s) => n + s.dishes.length, 0);
  if (total < 7) {
    const group = fallbackMenuFor(fallbackTag);
    const target = 7 + (imgVariant(`menu-${merchantName}`) % 6);
    const seen = new Set(out.flatMap((s) => s.dishes.map((d) => d.name)));
    outer: for (const pSec of group) {
      for (const [name, price] of pSec.items) {
        if (total >= target || total >= 15) break outer;
        if (seen.has(name)) continue;
        seen.add(name);
        let sec = out.find((s) => s.cat === pSec.sec);
        if (!sec) {
          sec = { cat: pSec.sec, dishes: [] };
          out.push(sec);
        }
        sec.dishes.push(coerceDish(merchantName, total, { name, price }, fallbackTag));
        total++;
      }
    }
  }
  return out;
}

function buildMerchant(id: string, raw: unknown, filter: string | null): MtMerchant {
  const rec: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const name = strOf(rec.name, '宝藏好店', 24);
  const tag = tagOf(rec.tag) ?? mtFoodTagOf(name) ?? 'food';
  const deals = (Array.isArray(rec.deals) ? rec.deals : [])
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .slice(0, 2);
  return {
    id,
    name,
    emoji: strOf(rec.emoji, '🏪', 4),
    cover: mtImg(tag, 480, 360, imgVariant(name), 'c'),
    cats: filter && filter !== 'tuangou' ? [filter] : ['meishi'],
    rating: Math.round(num(rec.rating, 4.7, 3.5, 5) * 10) / 10,
    monthSale: intOf(rec.monthSale, 1200 + Math.floor(Math.random() * 6000), 10, 999999),
    minOrder: intOf(rec.minOrder, 20, 0, 99),
    deliveryFee: Math.round(num(rec.deliveryFee, 2, 0, 9) * 10) / 10,
    distanceKm: Math.round(num(rec.distanceKm, 1.5, 0.2, 9.9) * 10) / 10,
    deliveryMin: intOf(rec.deliveryMin, 35, 15, 90),
    notice: typeof rec.notice === 'string' && rec.notice.trim() ? rec.notice.trim().slice(0, 40) : undefined,
    deals: deals.length > 0 ? deals : ['新客立减'],
    hours: strOf(rec.hours, '09:00-22:00', 24),
    addr: strOf(rec.addr, '望京街道湖光中街1号', 40),
    sections: coerceMenuSections(name, rec.menu, tag),
    reviews: [],
  };
}

/** 可选套餐收窄（购买弹窗单选用）：名称必填、价格>0、items 转短文案 */
function coercePackages(raw: unknown): MtDealPackage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MtDealPackage[] = [];
  for (const p of raw.slice(0, 4)) {
    const r: RawRec = typeof p === 'object' && p !== null ? (p as RawRec) : {};
    const name = strOf(r.name, '', 18);
    const price = num(r.price, 0, 0.5, 9999);
    if (!name || price <= 0) continue;
    const items = (Array.isArray(r.items) ? r.items : [])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, 8)
      .map((x) => x.trim().slice(0, 20));
    const orig = num(r.origPrice, 0, 0.5, 99999);
    out.push({
      name,
      price: Math.round(price * 10) / 10,
      origPrice: orig > price ? Math.round(orig * 10) / 10 : undefined,
      items: items.length > 0 ? items : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

function coerceDealMenu(rawMenu: unknown): MtDealMenu[] {
  if (!Array.isArray(rawMenu) || rawMenu.length === 0) {
    return [{ sec: '套餐内容', items: [{ name: '套餐详情见门店', price: 0 }] }];
  }
  const out: MtDealMenu[] = [];
  for (const sec of rawMenu.slice(0, 5)) {
    const s: RawRec = typeof sec === 'object' && sec !== null ? (sec as RawRec) : {};
    const itemsRaw = Array.isArray(s.items) ? s.items : [];
    const items = itemsRaw.slice(0, 10).map((it) => {
      const r: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
      return { name: strOf(r.name, '套餐项目', 24), price: num(r.price, 0, 0, 9999) };
    });
    out.push({
      sec: strOf(s.sec, '套餐内容', 16),
      items: items.length > 0 ? items : [{ name: '套餐详情见门店', price: 0 }],
    });
  }
  return out;
}

function buildDeal(id: string, raw: unknown, merchantId: string): MtDeal {
  const rec: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const title = strOf(rec.title, '超值双人套餐', 30);
  const price = num(rec.price, 29.9, 0.5, 9999);
  let origPrice = num(rec.origPrice, price * 2, 0.5, 99999);
  if (origPrice < price * 1.15) origPrice = Math.round(price * 2 * 10) / 10;
  const discount =
    typeof rec.discount === 'string' && rec.discount.trim()
      ? rec.discount.trim().slice(0, 8)
      : `${Math.round((price / origPrice) * 100) / 10}折`;
  const packages = coercePackages(rec.packages);
  // 默认套餐内容：模型给了 menu 用 menu；否则用第一个套餐的 items 兼容详情页展示
  const menu: MtDealMenu[] =
    Array.isArray(rec.menu) && rec.menu.length > 0
      ? coerceDealMenu(rec.menu)
      : packages && packages[0]?.items
        ? [{ sec: '套餐内容', items: packages[0].items.map((n) => ({ name: n, price: 0 })) }]
        : coerceDealMenu(rec.menu);
  const tag = mtFoodTagOf(title) ?? tagOf(rec.tag) ?? 'food';
  return {
    id,
    merchantId,
    title,
    img: mtImg(tag, 480, 360, imgVariant(title), 'f'),
    emoji: strOf(rec.emoji, '🍱', 4),
    price: Math.round(price * 10) / 10,
    origPrice: Math.round(origPrice * 10) / 10,
    discount,
    sold:
      typeof rec.sold === 'string' && rec.sold.trim()
        ? rec.sold.trim().slice(0, 16)
        : `已售${500 + Math.floor(Math.random() * 9000)}+`,
    praise:
      typeof rec.praise === 'string' && /\d+%/.test(rec.praise)
        ? rec.praise.trim().slice(0, 10)
        : `${88 + Math.floor(Math.random() * 12)}%好评`,
    tips: strOf(rec.tips, '到店吃', 6),
    distanceKm: Math.round(num(rec.distanceKm, 1.5, 0.2, 9.9) * 10) / 10,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，请注意周末、节假日是否可用',
    packages,
    menu,
    storeTags: ['随时退', '免预约', '过期自动退'],
  };
}

// ---------------- 路由入口 ----------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root: RawRec = typeof body === 'object' && body !== null ? (body as RawRec) : {};

  // filter：null=推荐混合 / 'tuangou'=团购频道 / 分类 id
  const filter = typeof root.filter === 'string' && root.filter.trim() ? root.filter.trim() : null;
  const catName = MT_CATS.find((c) => c.id === filter)?.name;
  const topic =
    filter === 'tuangou'
      ? '到店团购'
      : filter === 'shangou'
        ? '闪购超市便利'
        : catName
          ? `${catName}频道`
          : '综合推荐（外卖商家+到店团购混合）';
  const mode: GenerateArgs['mode'] = filter === 'tuangou' || filter === 'shangou' ? 'merchant' : catName ? 'merchant' : 'mixed';
  const count = intOf(root.count, 16, 8, 20);
  const exclude = (Array.isArray(root.exclude) ? root.exclude : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 80);
  const NONCE_A = `${Date.now().toString(36)}a${Math.random().toString(36).slice(2, 6)}`;
  const NONCE_B = `${Date.now().toString(36)}b${Math.random().toString(36).slice(2, 6)}`;

  // 用户配置（设置 › API 配置）：随请求体传入，不落盘
  let userCfg: FeedConfig | null = null;
  const rawCfg = root.config;
  if (typeof rawCfg === 'object' && rawCfg !== null) {
    const c = rawCfg as RawRec;
    if (typeof c.baseUrl === 'string' && c.baseUrl.trim()) {
      userCfg = {
        baseUrl: c.baseUrl.trim(),
        apiKey: typeof c.apiKey === 'string' ? c.apiKey.trim() : '',
        model: typeof c.model === 'string' && c.model.trim() ? c.model.trim() : 'gpt-4o-mini',
        temperature: num(c.temperature, 0.9, 0, 2),
        maxTokens: intOf(c.maxTokens, 8192, 256, 32768),
      };
    }
  }

  const system = buildSystem();

  /** 单次生成：用户模型优先，失败落内置模型；返回解析出的数据项 */
  const generateOnce = async (nonce: string, n: number): Promise<{ items: RawRec[]; source: 'user' | 'sdk' }> => {
    const user = buildUser({ topic, mode, count: n, exclude, nonce });
    try {
      if (userCfg) {
        return { items: parseItems(await upstreamText(userCfg, system, user)), source: 'user' };
      }
      return { items: parseItems(await sdkText(system, user)), source: 'sdk' };
    } catch {
      // 用户模型失败 → 内置模型兜底
      return { items: parseItems(await sdkText(system, user)), source: 'sdk' };
    }
  };

  // 并发两批生成（每批 ~count/2）：绕开单次输出上限，凑足 15~20 条；一批失败用另一批兜底
  const half = Math.max(8, Math.ceil(count / 2));
  const [batchA, batchB] = await Promise.all([
    generateOnce(NONCE_A, half).catch(() => ({ items: [] as RawRec[], source: 'sdk' as const })),
    generateOnce(NONCE_B, count - half).catch(() => ({ items: [] as RawRec[], source: 'sdk' as const })),
  ]);
  const allItems = [...batchA.items, ...batchB.items];
  const source: 'user' | 'sdk' = batchA.source === 'user' || batchB.source === 'user' ? 'user' : 'sdk';

  if (allItems.length === 0) {
    return NextResponse.json({ ok: false, error: 'AI 生成失败：两次生成均未返回有效数据' }, { status: 200 });
  }

  // 特价团聚合卡主题（mixed 模式：kind="list" 条目）
  let listTitle: string | null = null;
  for (const it of allItems) {
    const rec: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
    if (rec.kind === 'list' && typeof rec.title === 'string' && rec.title.trim()) {
      listTitle = rec.title.trim().slice(0, 14);
      break;
    }
  }

  const items = allItems;
  const ts = Date.now().toString(36);
  const merchants: MtMerchant[] = [];
  const deals: MtDeal[] = [];
  const merchantByName = new Map<string, MtMerchant>();
  const excludeSet = new Set(exclude); // 模型可能不严格遵守排除名单：塑形层强制过滤，保证追加内容不与上方重复
  let seq = 0;

  // 先建商家（deal.merchantName 关联用）
  for (const it of items) {
    const rec: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
    if (rec.kind !== 'merchant' || merchants.length >= 20) continue;
    const m = buildMerchant(`ai-m-${ts}-${seq++}`, rec, filter);
    if (merchantByName.has(m.name) || excludeSet.has(m.name)) continue;
    merchants.push(m);
    merchantByName.set(m.name, m);
  }

  // 再建团购，并保证每单都挂到有效商家
  const dealTitles = new Set<string>();
  for (const it of items) {
    const rec: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
    if (rec.kind !== 'deal' || deals.length >= 20) continue;
    const title = strOf(rec.title, '超值双人套餐', 30);
    if (dealTitles.has(title) || excludeSet.has(title)) continue; // 两批并发可能撞名/已展示过：按标题去重
    dealTitles.add(title);
    const merchantName = typeof rec.merchantName === 'string' ? rec.merchantName.trim() : '';
    let host = merchantName ? merchantByName.get(merchantName) : undefined;
    if (!host) {
      const name = merchantName || `精选好店·${['望京', '国贸', '五道口', '中关村'][seq % 4]}店`;
      const existing = merchantByName.get(name);
      if (existing) {
        host = existing;
      } else {
        const id = `ai-m-${ts}-${seq++}`;
        host = buildMerchant(id, { name, kind: 'merchant' }, filter);
        merchants.push(host);
        merchantByName.set(name, host);
      }
    }
    const id = `ai-d-${ts}-${deals.length}`;
    deals.push(buildDeal(id, rec, host ? host.id : merchants[0]?.id ?? id));
  }

  // 该频道一样都没有 → 交给前端本地兜底
  if (merchants.length === 0 && deals.length === 0) {
    return NextResponse.json({ ok: false, error: '模型未返回有效数据' }, { status: 200 });
  }

  return NextResponse.json({ ok: true, source, merchants, deals, listTitle });
}
