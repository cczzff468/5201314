import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 淘宝信息流 AI 生成接口：
 * - 优先用「设置 › API 配置」里用户配置好的 OpenAI 兼容模型（config 随请求体传入）；
 * - 未配置 / 上游失败 → 内置模型（z-ai-web-dev-sdk）兜底；
 * - 每次请求注入随机口令 + 排除名单（已展示内容），保证下拉刷新 / 上滑加载出来的都是新内容；
 * - 十一种 surface：home 首页瀑布流（rec/flash/subsidy/super88/fliggy/wear/follow 七种频道 tab）、
 *   video 短视频种草、subsidy 百亿补贴、seckill 秒杀、fliggy 飞猪酒店、movie 淘票票热映、
 *   me 我的淘宝猜你喜欢、standup 喜剧脱口秀演出、concert 演唱会、merch 电影周边、movieUp 即将上映；
 * - tag 强制落在品类白名单内（本地卡通图按品类词映射，图片与内容一致），生成数据仅展示用。
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

/** 信息流表面（search = 搜索结果页无限下滑 AI 生成） */
type TbSurface = 'home' | 'video' | 'subsidy' | 'seckill' | 'fliggy' | 'movie' | 'me' | 'standup' | 'concert' | 'merch' | 'movieUp' | 'coupon' | 'search';
const SURFACES: TbSurface[] = ['home', 'video', 'subsidy', 'seckill', 'fliggy', 'movie', 'me', 'standup', 'concert', 'merch', 'movieUp', 'coupon', 'search'];

interface GenerateArgs {
  surface: TbSurface;
  tab: string;
  count: number;
  exclude: string[];
  nonce: string;
  tagPool: readonly string[];
}

/** 生成结果条目（字段全部收窄后才会输出，未命中的可选字段不出现在 JSON 里） */
interface TbFeedItem {
  /** 商品标题/片名（video ≤20 字，movie ≤16 字，其余 ≤34 字） */
  title: string;
  /** 到手价（元，2 位小数） */
  price: number;
  /** 划线价（明显高于 price 才输出） */
  origPrice?: number;
  /** 销量件数 */
  sales?: number;
  /** 图片品类词（白名单内） */
  tag: string;
  /** 服务标签 ≤3 个 */
  tags?: string[];
  /** 角标：百亿补贴/国补/超级88/官方立减 */
  promo?: string;
  /** 榜单/销量文案 */
  foot?: string;
  /** 副标题文案 */
  sub?: string;
  /** 价格后缀（/180天最低、/5.9折） */
  unit?: string;
  /** 飞猪酒店：N+条点评 */
  reviews?: string;
  /** 秒杀：已抢百分比（30~90） */
  grabbed?: number;
  /** 秒杀/补贴：直降N元 */
  off?: string;
  /** 电影：制式（IMAX 2D / 2D / 3D） */
  badge?: string;
  /** 电影：主演/导演 */
  actors?: string;
  /** 演出：场馆名 */
  venue?: string;
  /** 演出：城市 */
  city?: string;
  /** 演出：档期文案（11.08 周六 19:30） */
  dateRange?: string;
  /** 演出/周边：已售文案 */
  hot?: string;
  /** 演唱会：艺人名（虚构） */
  artist?: string;
  /** 演唱会：巡演名 */
  tour?: string;
  /** 周边所属影片（XX官方周边） */
  from?: string;
  /** 周边品类（手办/玩偶/海报…） */
  kind?: string;
  /** 即将上映：想看人数（万人，1~60） */
  wantTo?: number;
  /** 领券中心：使用门槛（满 X 元可用，0 = 无门槛） */
  min?: number;
  /** 领券中心：适用范围（≤16 字，如 数码类目可用） */
  scope?: string;
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 名称哈希（同名词稳定同兜底选项，批内/批间仍有多样性） */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 名称哈希 → 数组取一（模型漏给字段时的稳定兜底池选值） */
function pickOf<T>(arr: readonly T[], seed: string): T {
  return arr[hashOf(seed) % arr.length];
}

// ---------------- tag 白名单（图片服务支持的品类词） ----------------

const TAG_WHITELIST = [
  'phone', 'earbuds', 'laptop', 'watch', 'tablet', 'camera', 'keyboard', 'powerbank', 'speaker', 'lock', 'fridge', 'washer',
  'phone-stand', 'mouse', 'monitor', 'tv', 'drone', 'gamepad', 'fan', 'vacuum', 'microwave', 'rice-cooker', 'kettle', 'air-fryer', 'coffee-machine', 'humidifier', 'shaver', 'toothbrush', 'hairdryer',
  'jacket', 'jeans', 'dress', 'hoodie', 'tshirt', 'sneakers', 'backpack', 'coat', 'shoes', 'hat', 'shirt', 'belt', 'scarf', 'socks', 'shorts', 'suitcase', 'wallet', 'sunglasses', 'slippers',
  'lipstick', 'perfume', 'skincare', 'makeup', 'brush', 'face-mask',
  'sofa', 'bedding', 'lamp', 'mug', 'vase', 'pillow', 'desk', 'curtain', 'towel', 'storage', 'carpet', 'lunchbox', 'umbrella', 'water-bottle',
  'snacks', 'fruit', 'tea', 'cookies', 'books', 'pen', 'notebook', 'toy', 'blocks', 'toy-car', 'puzzle', 'guitar', 'basketball', 'yoga-mat', 'dumbbell', 'pet', 'gift', 'temple',
] as const;

/** 常见近似词 → 白名单词映射（模型自造词/同义词时的收窄路径） */
const TAG_ALIASES: Record<string, string> = {
  // 数码
  cellphone: 'phone', smartphone: 'phone', mobile: 'phone', 'phone-case': 'phone',
  headphone: 'earbuds', headphones: 'earbuds', airpods: 'earbuds', bluetooth: 'earbuds',
  computer: 'laptop', notebook: 'laptop', pc: 'laptop',
  smartwatch: 'watch', 'smart-watch': 'watch', band: 'watch', bracelet: 'watch',
  pad: 'tablet', ipad: 'tablet', ereader: 'tablet', 'e-reader': 'tablet',
  dslr: 'camera', lens: 'camera', webcam: 'camera',
  mousepad: 'keyboard', charger: 'powerbank', cable: 'powerbank', battery: 'powerbank',
  audio: 'speaker', 'bluetooth-speaker': 'speaker', soundbar: 'speaker',
  tripod: 'phone-stand', 'selfie-stick': 'phone-stand', 'car-holder': 'phone-stand',
  fridge: 'fridge', refrigerator: 'fridge',
  washer: 'washer', 'washing-machine': 'washer', washingmachine: 'washer',
  lock: 'lock', doorlock: 'lock', 'smart-lock': 'lock', smartlock: 'lock',
  hoodie: 'hoodie',
  gift: 'gift', present: 'gift', 'gift-box': 'gift',
  temple: 'temple',
  'air-conditioner': 'fan', blender: 'kettle', 'juicer': 'air-fryer', appliance: 'fridge',
  earbuds2: 'earbuds', earphone: 'earbuds',
  // 服饰
  clothing: 'jacket', blazer: 'jacket', sweater: 'coat', outerwear: 'coat',
  trousers: 'jeans', pants: 'jeans', denim: 'jeans',
  skirt: 'dress', gown: 'dress', sundress: 'dress',
  sneaker: 'sneakers', 'running-shoes': 'sneakers',
  boots: 'shoes', sandals: 'shoes', slippers: 'slippers', sock: 'socks', stockings: 'socks',
  bag: 'backpack', handbag: 'backpack', luggage: 'suitcase', suitcase: 'suitcase', tote: 'backpack',
  cap: 'hat', beanie: 'hat',
  't-shirt': 'tshirt', blouse: 'shirt', top: 'shirt', underwear: 'shirt', glasses: 'sunglasses', eyeglasses: 'sunglasses',
  // 美妆
  cosmetics: 'makeup', foundation: 'makeup', eyeshadow: 'makeup', mascara: 'makeup',
  cream: 'skincare', serum: 'skincare', lotion: 'skincare', sunscreen: 'skincare', 'sunscreen-spray': 'skincare',
  fragrance: 'perfume', cologne: 'perfume', jewelry: 'perfume',
  lipstick: 'lipstick', lipgloss: 'lipstick', 'lip-glaze': 'lipstick',
  mask: 'face-mask', 'facial-mask': 'face-mask',
  // 家居
  furniture: 'sofa', chair: 'sofa', table: 'sofa', shelf: 'sofa',
  bed: 'bedding', blanket: 'bedding', quilt: 'bedding', pillow: 'pillow', towels: 'towel', hotel: 'bedding',
  light: 'lamp', chandelier: 'lamp', lightbulb: 'lamp',
  cup: 'mug', cups: 'mug', teapot: 'mug', 'milk-tea': 'mug',
  bottle: 'water-bottle', thermos: 'water-bottle', flask: 'water-bottle', drink: 'water-bottle', beverage: 'water-bottle', juice: 'water-bottle', milk: 'water-bottle',
  'storage-box': 'storage', organizer: 'storage', bin: 'storage',
  // 食品/其他
  food: 'snacks', snack: 'snacks', nuts: 'snacks', candy: 'snacks', biscuit: 'cookies', cookies: 'cookies', bread: 'snacks', cake: 'cookies',
  grocery: 'fruit', vegetable: 'fruit', vegetables: 'fruit', meat: 'snacks', seafood: 'snacks', egg: 'fruit', rice: 'rice-cooker',
  book: 'books', novel: 'books', textbook: 'books', stationery: 'pen', journal: 'notebook',
  plush: 'toy', doll: 'toy', figurine: 'toy', game: 'gamepad', lego: 'blocks', buildingblocks: 'blocks', 'rc-car': 'toy-car', pet: 'pet', 'pet-food': 'pet',
  travel: 'suitcase', outdoors: 'backpack', camping: 'backpack', sports: 'sneakers', fitness: 'dumbbell', yoga: 'yoga-mat',
};

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

/** 各表面允许的 tag 池：fliggy 酒店只能家居三件、movie/movieUp 统一 books、home 频道 wear 只能女装类、
 *  merch 周边只能可作周边图的品类、standup 用中文类型词（演出海报角标，非图片键） */
const TAG_POOL_FLIGGY = ['bedding', 'sofa', 'lamp'];
const TAG_POOL_MOVIE = ['books'];
const TAG_POOL_WEAR = ['jacket', 'jeans', 'dress', 'hoodie', 'tshirt', 'shirt', 'sneakers', 'shoes', 'hat', 'coat'];
const TAG_POOL_MERCH = ['toy', 'blocks', 'toy-car', 'puzzle', 'speaker', 'water-bottle', 'mug', 'lamp', 'backpack', 'hat', 'camera', 'keyboard', 'books', 'guitar'];
const TAG_POOL_STANDUP = ['脱口秀', '漫才', '开放麦', '舞台剧', '即兴喜剧'];
/** 领券中心：券图品类（常用大促品类，决定券卡配图） */
const TAG_POOL_COUPON = ['phone', 'earbuds', 'laptop', 'jacket', 'sneakers', 'sofa', 'bedding', 'mug', 'snacks', 'fruit', 'lipstick', 'skincare', 'books', 'toy', 'water-bottle', 'watch', 'tablet', 'suitcase', 'fridge', 'basketball'];

function tagPoolFor(surface: TbSurface, tab: string): readonly string[] {
  if (surface === 'fliggy') return TAG_POOL_FLIGGY;
  if (surface === 'movie' || surface === 'movieUp' || surface === 'concert') return TAG_POOL_MOVIE;
  if (surface === 'home' && tab === 'wear') return TAG_POOL_WEAR;
  if (surface === 'merch') return TAG_POOL_MERCH;
  if (surface === 'standup') return TAG_POOL_STANDUP;
  if (surface === 'coupon') return TAG_POOL_COUPON;
  return TAG_WHITELIST;
}

/** 中文类型词收窄（standup 专用：tag 是演出海报角标文案，不走图片白名单） */
function tagCnOf(raw: unknown, seed: string): string {
  if (typeof raw === 'string') {
    const t = raw.trim().slice(0, 6);
    if ((TAG_POOL_STANDUP as readonly string[]).includes(t)) return t;
  }
  return pickOf(TAG_POOL_STANDUP, seed);
}

/** tag 收窄：清洗 → 池内精确命中 → 近似词映射 → 前缀模糊 → 兜底（保证永远落在池内） */
function tagOfWhitelist(raw: unknown, pool: readonly string[]): string {
  const t = tagOf(raw);
  if (t) {
    if (pool.includes(t)) return t;
    const alias = TAG_ALIASES[t];
    if (alias && pool.includes(alias)) return alias;
    if (t.length >= 4) {
      const fuzzy = pool.find((w) => w.startsWith(t) || t.startsWith(w));
      if (fuzzy) return fuzzy;
    }
  }
  return pool[0];
}

// ---------------- 上游调用 ----------------

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

const PROMPT_BASE =
  '你是淘宝信息流数据引擎，负责生成逼真的电商展示数据。数值必须符合现实常识（价格与划线价自洽、销量与商品热度匹配）。只输出 JSON，不要输出任何解释、注释或 markdown 代码块。';

/** home 各频道 tab 的生成规则（tab 缺省/未知按综合推荐处理） */
const HOME_TAB_RULES: Record<string, string> = {
  rec: '综合推荐，类目不限（数码/服饰/家居/美妆/食品/图书皆可），同批类目尽量多样；3C 数码可用常见品牌与型号（如 iPhone 17、华为 Mate 70、小米15、三星 S25、iQOO Z9/Z10、vivo X200；口红可用迪奥/卡姿兰/兰蔻等品牌与唇釉/唇泥等质地）。',
  flash: '淘宝闪购频道：只生成零食/水果/饮料/日用百货快消商品，价格 1~59 元、销量偏高，promo 多填「超级88」。',
  subsidy: '家电数码国补频道：只生成大家电与数码商品（冰箱/洗衣机/电视/空调/手机/笔记本/平板/相机/智能门锁/显示器/风扇/吸尘器/微波炉/电饭煲等），promo 固定填「国补」，价格 399~6999；tag 必须与标题品类对位：冰箱填 fridge、洗衣机填 washer、电视填 tv、显示器填 monitor、风扇填 fan、吸尘器填 vacuum、微波炉填 microwave、电饭煲填 rice-cooker、空气炸锅填 air-fryer、咖啡机填 coffee-machine、智能门锁填 lock、手机填 phone、笔记本填 laptop、相机填 camera；3C 类可用常见品牌与型号（如 iPhone 17、华为 Mate 70、小米15、iQOO Z9、vivo X200 等）。',
  super88: '超级88低价爆款频道：只生成 9.9~49 元的零食/日百小件爆款，promo 固定填「超级88」，origPrice 填日常价。',
  fliggy: '旅行装备频道：只生成旅行箱包/户外装备商品，tag 从 backpack、shoes、coat、hat、water-bottle 中选。',
  wear: '女装穿搭频道：只生成女装/鞋帽商品，tag 只能从 jacket、jeans、dress、hoodie、tshirt、shirt、sneakers、shoes、hat、coat 中选，且与标题品类对位（卫衣填 hoodie、T恤填 tshirt、衬衫填 shirt）。',
  follow: '关注频道：综合推荐，类目不限，同批类目尽量多样。',
};

/** 各表面的任务描述（拼进 user prompt 首行） */
function surfaceTask(a: GenerateArgs): string {
  if (a.surface === 'home') return `淘宝首页双列瀑布流推荐商品。当前频道规则：${HOME_TAB_RULES[a.tab] ?? HOME_TAB_RULES.rec}`;
  if (a.surface === 'video')
    return '淘宝短视频种草流商品（用于视频流卡片）。title 必须像短视频口播文案——口语化、带情绪、有钩子（例：「吹爆这款平价耳机！学生党闭眼入」「被问爆的春秋外套来了」），不超过 20 字，禁止写成参数罗列式商品名；price 以 9.9~199 为主。';
  if (a.surface === 'subsidy')
    return '淘宝百亿补贴频道商品。promo 固定填「百亿补贴」；unit 填「/180天最低」「/5.9折」这类价格后缀文案；origPrice 填优惠前价格（明显高于 price）；foot 填「已售N万+」「回购榜第N名」等销量/榜单文案；sub 填「正品发货 假一赔十」这类保障文案。';
  if (a.surface === 'seckill')
    return '淘宝秒杀频道商品。price 便宜（1~99.9 元）；origPrice 填原价；grabbed 填已抢百分比（30~90 的整数）；off 填「直降N元」（N 为 origPrice−price 的整数）；foot 填已售文案。';
  if (a.surface === 'fliggy')
    return '飞猪酒店/民宿。title 是酒店名——「城市或商圈 + 自创品牌风格名 + 大酒店/民宿/度假酒店等后缀」，可带（XX店/万达广场店）分店后缀，同批城市尽量多样；price 是每晚价（69~699）；reviews 填「200+条点评」这类点评数文案；tag 只能从 sofa、bedding、lamp 中选。';
  if (a.surface === 'me')
    return '淘宝「我的」页猜你喜欢瀑布流。综合推荐，类目不限（数码/服饰/家居/美妆/食品/图书皆可），同批类目尽量多样，像真实首页推荐。';
  if (a.surface === 'standup')
    return '淘票票喜剧脱口秀频道演出。title 是原创虚构演出名（脱口秀专场/漫才专场/即兴喜剧/小剧场舞台剧/开放麦，严禁任何真实厂牌与演员名，格式参考「脱口秀专场·自创主题名」）；sub 填「自创厂牌名 · 阵容看点」文案；venue 填「城市 + 文化艺术中心/小剧场/大剧院/喜剧中心/Livehouse」；city 填二三线城市；dateRange 填「MM.DD 周X HH:MM」或「MM.DD 周X HH:MM / HH:MM」；price 填最低票价整数（80~380）；hot 填「已售N」销量文案。';
  if (a.surface === 'concert')
    return '淘票票演唱会频道演出。artist 填 2~4 字完全虚构的艺人名（严禁真实歌手）；tour 填自创巡演名（如「XX世界巡回演唱会」「XX巡回演唱会」）；city 填省会/二三线城市；venue 填「奥林匹克体育中心/市体育中心体育场/国际会展中心大剧院/文体中心体育馆」这类场馆；dateRange 填「MM.DD-MM.DD 周五六 19:00」或「MM.DD 周六 19:30」；price 填最低票价整数（180~1280）；hot 填「已售N万」文案。';
  if (a.surface === 'merch')
    return '淘票票周边商城商品。title 是电影官方周边（手办盲盒/玩偶/海报套装/黑胶唱片/主题水杯/模型，可引用同批自创片名但严禁真实IP）；from 填「《自创片名》官方周边/原声周边」；kind 从 手办/玩偶/海报/音乐/日用/模型/服饰 中选；price 19~599，origPrice 填日常价；hot 填「已售N」文案；tag 决定周边图片，必须从 toy/speaker/water-bottle/mug/lamp/backpack/hat/camera/keyboard 中选最贴切的。';
  if (a.surface === 'movieUp')
    return '淘票票即将上映新片。title 是原创虚构片名（严禁真实电影名）；badge 填 IMAX 2D / 2D / 3D / 重映 之一；actors 填「导演：虚构名 主演：虚构名」风格且不超过 20 字；sub 填一句看点文案；wantTo 填想看人数数值（单位万人，1~60 可带一位小数）；price 填预售价（38~120）；tag 统一填 books。';
  if (a.surface === 'coupon')
    return '淘宝领券中心优惠券（超级88领好券）。title 是券名——「品类/场景 + 券种」结构（券种从 加补券/消费券/立减券/神券/品类券 中选，品类从 数码/服饰/美妆/家居/食品/图书/超市/运动 等选，如「数码品类加补券」「超市神券」），不超过 12 字，同一批互不重复；price 是券面额（整数元，1~88，大额券可以 66/88）；min 是使用门槛（满 X 元可用，整数，一般是面额的 5~10 倍，无门槛填 0）；scope 填适用范围（不超过 10 字，如「数码类目可用」「全品类通用」）；tag 从白名单选券图品类。';
  if (a.surface === 'search')
    return `淘宝搜索结果页商品（用户搜索词：${a.tab}）。全部商品必须与搜索词品类强相关：手机/笔记本/平板要带品牌与型号（华为/小米/苹果/三星/vivo/iQOO Z9/Z10/iPhone 12~17 等），口红要带品牌（迪奥/卡姿兰/兰蔻等）+质地（唇釉/口红/唇泥/唇膏/唇蜜）+色号；价格与销量符合品类行情；同批商品互不重复且与排除名单不重复。`;
  return '淘票票热映电影。title 是原创虚构片名（禁止使用任何真实存在的电影名）；badge 填 IMAX 2D / 2D / 3D 之一；actors 填「导演：虚构名 主演：虚构名」风格且不超过 20 字；price 给 38~120；tag 统一填 books。';
}

/** 各表面的输出字段示例（仅示意格式，提示模型禁止照抄示例名） */
const ITEM_SCHEMA: Record<TbSurface, string> = {
  home: '{"title":"无线蓝牙耳机 半入耳式 超长续航","price":129,"origPrice":199,"sales":23000,"tag":"earbuds","tags":["退货宝","7天无理由","包邮"],"promo":"国补","foot":"已售2万+","sub":"官方旗舰 品质保障"}',
  video: '{"title":"吹爆这款平价耳机！学生党闭眼入","price":59.9,"origPrice":99,"sales":8600,"tag":"earbuds","tags":["包邮"],"sub":"真的会回购"}',
  subsidy: '{"title":"55英寸4K智能电视 全面屏","price":1599,"origPrice":2599,"sales":51000,"tag":"tablet","tags":["全国联保","一年换新"],"promo":"百亿补贴","foot":"已售3万+ 回购榜第2名","sub":"正品发货 假一赔十","unit":"/180天最低"}',
  seckill: '{"title":"整箱混装零食大礼包 30包","price":29.9,"origPrice":79,"sales":43000,"tag":"snacks","tags":["退货宝","包邮"],"grabbed":62,"off":"直降49元","foot":"已售7万+"}',
  fliggy: '{"title":"杭州西湖畔·云栖度假酒店（湖滨银泰in77店）","price":388,"origPrice":528,"tag":"bedding","tags":["含双早","免费取消","立即确认"],"reviews":"2000+条点评","sub":"近西湖步行5分钟"}',
  movie: '{"title":"星海迷航：黎明边界","price":58,"tag":"books","badge":"IMAX 2D","actors":"导演：陈未 主演：林远、苏晚","sub":"年度科幻巨制 震撼上映"}',
  me: '{"title":"极简风保温杯 500ml","price":39.9,"origPrice":69,"sales":12000,"tag":"mug","tags":["退货宝","包邮"],"promo":"官方立减","foot":"已售8000+","sub":"居家办公两相宜"}',
  standup: '{"title":"脱口秀专场·宇宙笑话指南","price":120,"sub":"平行喜剧厂牌 · 双人卡司盲盒","venue":"濮阳文化艺术中心小剧场","city":"濮阳","dateRange":"11.08 周六 19:30","hot":"已售653","tag":"脱口秀"}',
  concert: '{"artist":"林晚风","tour":"星野世界巡回演唱会","price":380,"city":"郑州","venue":"郑州奥林匹克体育中心","dateRange":"11.21-11.22 周五六 19:00","hot":"已售1.8万","tag":"books"}',
  merch: '{"title":"自创片名官方手办盲盒","price":69,"origPrice":99,"from":"《自创片名》官方周边","kind":"手办","hot":"已售1.2万","tag":"toy"}',
  movieUp: '{"title":"雾海灯塔","price":45,"tag":"books","badge":"IMAX 2D","actors":"导演：陈序 主演：江眠、白鹭","sub":"年度悬疑力作","wantTo":12.6}',
  coupon: '{"title":"数码品类加补券","price":15,"min":150,"scope":"数码类目可用","tag":"phone"}',
  search: '{"title":"华为 Mate 70 Pro 5G手机 曜金黑 16G+512G 全网通","price":6499,"origPrice":7999,"sales":12000,"tag":"phone","tags":["国补15%","分期免息","退货宝"],"promo":"国补","foot":"已售1万+","sub":"官方旗舰 品质保障"}',
};

function buildSystem(surface: TbSurface): string {
  if (surface === 'home') return `${PROMPT_BASE}当前是淘宝首页双列瀑布流。`;
  if (surface === 'video') return `${PROMPT_BASE}当前是淘宝短视频种草流，标题风格优先级高于参数完整性。`;
  if (surface === 'subsidy') return `${PROMPT_BASE}当前是淘宝百亿补贴频道，promo 与保障类字段必须完整。`;
  if (surface === 'seckill') return `${PROMPT_BASE}当前是淘宝秒杀频道，价格必须便宜且折扣要自洽。`;
  if (surface === 'fliggy') return `${PROMPT_BASE}当前是飞猪酒店民宿频道，酒店名要像真实OTA在售酒店。`;
  if (surface === 'me') return `${PROMPT_BASE}当前是淘宝「我的」页猜你喜欢瀑布流。`;
  if (surface === 'standup') return `${PROMPT_BASE}当前是淘票票喜剧脱口秀频道，演出名/厂牌/艺人必须完全虚构。`;
  if (surface === 'concert') return `${PROMPT_BASE}当前是淘票票演唱会频道，艺人名与巡演名必须完全虚构，严禁真实歌手。`;
  if (surface === 'merch') return `${PROMPT_BASE}当前是淘票票周边商城，周边必须挂在自创虚构影片下，严禁真实IP。`;
  if (surface === 'movieUp') return `${PROMPT_BASE}当前是淘票票即将上映频道，片名与演职人员必须完全虚构。`;
  if (surface === 'coupon') return `${PROMPT_BASE}当前是淘宝领券中心，券名必须像真实大促优惠券且同一批互不重复。`;
  if (surface === 'search') return `${PROMPT_BASE}当前是淘宝搜索结果页，商品必须与搜索词品类强相关且带品牌/型号/规格。`;
  return `${PROMPT_BASE}当前是淘票票热映电影频道，片名与演职人员必须完全虚构。`;
}

function buildUser(a: GenerateArgs): string {
  return [
    `生成 ${a.count} 条${surfaceTask(a)}`,
    `【本次口令】${a.nonce}`,
    `【生成条数】${a.count}`,
    `【排除名单（绝不能重复出现）】${a.exclude.slice(0, 60).join('、') || '无'}`,
    '口令要求：标题/店名/片名必须新颖独特、同一批内互不重复，禁止照抄知名品牌或真实影片原名。',
    `字段规范（示例仅示意格式，输出中禁止出现示例里的名称）：${ITEM_SCHEMA[a.surface]}`,
    `tag 必须从以下白名单中选最贴切的一个，禁止自造词：${a.tagPool.join('、')}。`,
    `全部简体中文（tag 除外），数值要合理逼真；输出尽量精炼，确保 ${a.count} 条全部完整输出。`,
    '请严格输出 JSON 数组，不要输出任何解释文字。',
  ].join('\n');
}

// ---------------- 数据塑形 ----------------

/** 各表面价格范围：[min, max, 模型漏给时的默认价] */
const PRICE_RANGE: Record<TbSurface, [number, number, number]> = {
  home: [0.01, 99999, 59],
  video: [5, 299, 39.9],
  subsidy: [9.9, 29999, 299],
  seckill: [1, 99.9, 19.9],
  fliggy: [69, 699, 288],
  movie: [38, 120, 58],
  me: [0.01, 99999, 59],
  standup: [80, 380, 120],
  concert: [180, 1280, 380],
  merch: [19, 599, 69],
  movieUp: [38, 120, 45],
  coupon: [1, 88, 15],
  search: [0.01, 99999, 59],
};

/** 各表面标题兜底（模型没给 title 时保证条目仍可用） */
const DEFAULT_TITLE: Record<TbSurface, string> = {
  home: '精选好物',
  video: '今日种草好物',
  subsidy: '百亿补贴好物',
  seckill: '限时秒杀好物',
  fliggy: '精选度假酒店',
  movie: '热映影片',
  me: '猜你喜欢好物',
  standup: '爆笑喜剧专场',
  concert: '巡回演唱会',
  merch: '官方授权周边',
  movieUp: '即将上映新片',
  coupon: '品类加补券',
  search: '搜索相关好物',
};

/** 模型漏给字段时的稳定兜底文案池（按标题哈希取值，同条目跨批次稳定） */
const SUBSIDY_UNITS = ['/180天最低', '/5.9折', '/90天保价', '/全网低价'] as const;
const SUBSIDY_FOOTS = ['已售1万+', '已售3万+', '已售8万+', '回购榜第1名', '回购榜第3名'] as const;
const SUBSIDY_SUBS = ['正品发货 假一赔十', '官方直营 顺丰包邮', '全国联保 两年质保', '假一赔四 极速退款'] as const;
const SECKILL_FOOTS = ['已售5000+', '已售9千+', '已售2万+', '已售5万+'] as const;
const MOVIE_BADGES = ['IMAX 2D', '2D', '3D'] as const;
const FLIGGY_REVIEWS = ['200+条点评', '500+条点评', '800+条点评', '1500+条点评', '3000+条点评'] as const;
/** standup 演出兜底池（模型漏给字段时按标题哈希稳定取值） */
const STANDUP_VENUES = ['濮阳文化艺术中心小剧场', '濮阳市工人文化宫大剧院', '濮阳万达广场喜剧中心', '郑州二七剧场Livehouse', '新乡平原文化艺术中心', '安阳市职工剧院'] as const;
const STANDUP_CITIES = ['濮阳', '郑州', '新乡', '安阳', '开封'] as const;
const STANDUP_DATES = ['11.08 周六 19:30', '11.09 周日 15:00 / 19:30', '11.14 周五 20:00', '11.15 周六 19:30', '11.21 周五 19:30 / 21:30', '11.22 周六 20:00'] as const;
const STANDUP_HOTS = ['已售653', '已售812', '已售1247', '已售2210', '已售986', '已售1534'] as const;
/** concert 演出兜底池 */
const CONCERT_ARTISTS = ['林晚风', '陆行舟', '许千帆', '季星野', '闻人夜', '岑月白'] as const;
const CONCERT_TOURS = ['星野世界巡回演唱会', '共鸣之旅巡回演唱会', '旷野之声巡回演唱会', '夜航西飞巡回演唱会', '夏日终曲巡回演唱会'] as const;
const CONCERT_CITIES = ['郑州', '洛阳', '武汉', '长沙', '西安', '成都'] as const;
const CONCERT_VENUES = ['奥林匹克体育中心', '市体育中心体育场', '国际会展中心大剧院', '文体中心体育馆', '城市音乐厅'] as const;
const CONCERT_DATES = ['11.21-11.22 周五六 19:00', '11.29 周六 19:30', '12.05-12.06 周五六 19:30', '12.12 周五 20:00', '12.19-12.20 周五六 19:00'] as const;
const CONCERT_HOTS = ['已售1.8万', '已售3.2万', '已售9600', '已售5.6万', '已售2.4万'] as const;
/** merch 周边兜底池 */
const MERCH_KINDS = ['手办', '玩偶', '海报', '音乐', '日用', '模型', '服饰'] as const;
const MERCH_HOTS = ['已售1.2万', '已售6411', '已售890', '已售3.4万', '已售2280'] as const;
const MERCH_FROMS = ['《群星闪耀时》官方周边', '《生如夏花》原声周边', '《雾海灯塔》电影周边', '《小猪流浪记》官方授权', '《夜航列车》剧集周边'] as const;
/** coupon 优惠券兜底池（模型漏给字段时按券名哈希稳定取值） */
const COUPON_SCOPES = ['数码类目可用', '服饰类目可用', '美妆类目可用', '家居类目可用', '食品类目可用', '全品类通用'] as const;

/** 可选字符串字段收窄：非空字符串截断，否则 undefined（输出 JSON 不带该键） */
function optStr(v: unknown, maxLen: number): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, maxLen) : undefined;
}

/** 服务标签收窄：字符串数组、每个 ≤8 字、最多 3 个 */
function tagsOf(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 8))
    .slice(0, 3);
  return out.length > 0 ? out : undefined;
}

/** 原始条目 → 输出条目（字段逐个收窄 + 频道不变量强制兜底） */
function coerceItem(raw: unknown, surface: TbSurface, tab: string): TbFeedItem {
  const rec: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const titleMax = surface === 'video' ? 20 : surface === 'movie' || surface === 'movieUp' ? 16 : surface === 'coupon' ? 12 : 34;
  const title = strOf(rec.title, DEFAULT_TITLE[surface], titleMax);
  const [lo, hi, def] = PRICE_RANGE[surface];
  const price = round2(num(rec.price, def, lo, hi));
  const item: TbFeedItem = { title, price, tag: tagOfWhitelist(rec.tag, tagPoolFor(surface, tab)) };

  // 划线价：仅当明显高于 price 才有意义；电影无划线价概念
  const origRaw = surface === 'movie' ? 0 : num(rec.origPrice, price * 2, 0, 99999);
  const origPrice = origRaw > price ? round2(origRaw) : undefined;
  if (origPrice !== undefined) item.origPrice = origPrice;

  // 销量只对商品类表面有意义（酒店看点评、电影看票房文案）
  if (surface === 'home' || surface === 'video' || surface === 'subsidy' || surface === 'seckill' || surface === 'me' || surface === 'search') {
    item.sales = intOf(rec.sales, 500 + Math.floor(Math.random() * 20000), 0, 1e8);
  }
  const tags = tagsOf(rec.tags);
  if (tags) item.tags = tags;

  const footRaw = optStr(rec.foot, 20);
  const subRaw = optStr(rec.sub, 24);

  if (surface === 'home' || surface === 'video' || surface === 'me' || surface === 'search') {
    const promo = optStr(rec.promo, 6);
    if (promo) item.promo = promo;
    if (footRaw) item.foot = footRaw;
    if (subRaw) item.sub = subRaw;
    if (surface === 'home') {
      // 频道角标兜底：国补/超级88/闪购频道模型漏给时按 tab 补齐
      const promoDefault = tab === 'subsidy' ? '国补' : tab === 'super88' || tab === 'flash' ? '超级88' : undefined;
      if (!promo && promoDefault) item.promo = promoDefault;
      const unit = optStr(rec.unit, 14);
      if (unit) item.unit = unit;
    }
  } else if (surface === 'subsidy') {
    item.promo = '百亿补贴'; // 频道固定角标
    item.foot = footRaw ?? pickOf(SUBSIDY_FOOTS, title);
    item.sub = subRaw ?? pickOf(SUBSIDY_SUBS, title);
    item.unit = optStr(rec.unit, 14) ?? pickOf(SUBSIDY_UNITS, title);
    if (origPrice !== undefined) item.off = optStr(rec.off, 12) ?? `直降${Math.max(1, Math.round(origPrice - price))}元`;
  } else if (surface === 'seckill') {
    item.grabbed = intOf(rec.grabbed, 30 + Math.floor(Math.random() * 61), 30, 90);
    item.foot = footRaw ?? pickOf(SECKILL_FOOTS, title);
    if (origPrice !== undefined) item.off = optStr(rec.off, 12) ?? `直降${Math.max(1, Math.round(origPrice - price))}元`;
    const promo = optStr(rec.promo, 6);
    if (promo) item.promo = promo;
  } else if (surface === 'fliggy') {
    item.reviews = optStr(rec.reviews, 12) ?? pickOf(FLIGGY_REVIEWS, title);
    if (subRaw) item.sub = subRaw;
  } else if (surface === 'standup') {
    // 喜剧脱口秀演出：中文类型角标 + 场馆/城市/档期/已售（模型漏给按标题哈希稳定兜底）
    item.tag = tagCnOf(rec.tag, title);
    item.venue = optStr(rec.venue, 24) ?? pickOf(STANDUP_VENUES, title);
    item.city = optStr(rec.city, 8) ?? pickOf(STANDUP_CITIES, title);
    item.dateRange = optStr(rec.dateRange, 28) ?? pickOf(STANDUP_DATES, title);
    item.hot = optStr(rec.hot, 12) ?? pickOf(STANDUP_HOTS, title);
    if (subRaw) item.sub = subRaw;
  } else if (surface === 'concert') {
    // 演唱会：艺人/巡演/城市/场馆/档期/最低价；title 缺省用「艺人·巡演」拼装（去重与排除名单都用它）
    const artist = optStr(rec.artist, 8) ?? pickOf(CONCERT_ARTISTS, title);
    const tour = optStr(rec.tour, 20) ?? pickOf(CONCERT_TOURS, title);
    item.artist = artist;
    item.tour = tour;
    if (item.title === DEFAULT_TITLE.concert) item.title = `${artist}·${tour}`;
    item.city = optStr(rec.city, 8) ?? pickOf(CONCERT_CITIES, title);
    item.venue = optStr(rec.venue, 24) ?? `${item.city}${pickOf(CONCERT_VENUES, title)}`;
    item.dateRange = optStr(rec.dateRange, 28) ?? pickOf(CONCERT_DATES, title);
    item.hot = optStr(rec.hot, 12) ?? pickOf(CONCERT_HOTS, title);
  } else if (surface === 'merch') {
    // 电影周边：所属影片/品类/已售
    item.from = optStr(rec.from, 30) ?? pickOf(MERCH_FROMS, title);
    item.kind = optStr(rec.kind, 6) ?? pickOf(MERCH_KINDS, title);
    item.hot = optStr(rec.hot, 12) ?? pickOf(MERCH_HOTS, title);
    if (subRaw) item.sub = subRaw;
  } else if (surface === 'movieUp') {
    // 即将上映：制式/演职/看点/想看人数（万人）
    item.badge = optStr(rec.badge, 10) ?? pickOf(MOVIE_BADGES, title);
    const actors = optStr(rec.actors, 20);
    if (actors) item.actors = actors;
    item.wantTo = round2(num(rec.wantTo, 3 + (hashOf(title) % 400) / 10, 1, 60));
    if (subRaw) item.sub = subRaw;
  } else if (surface === 'coupon') {
    // 优惠券：面额取整 + 门槛/适用范围（模型漏给按券名哈希稳定兑底）
    item.price = Math.max(1, Math.round(item.price));
    item.min = intOf(rec.min, Math.max(0, Math.round(item.price * 8 / 10) * 10), 0, 9999);
    item.scope = optStr(rec.scope, 10) ?? pickOf(COUPON_SCOPES, title);
  } else {
    // movie
    item.badge = optStr(rec.badge, 10) ?? pickOf(MOVIE_BADGES, title);
    const actors = optStr(rec.actors, 20);
    if (actors) item.actors = actors;
    if (subRaw) item.sub = subRaw;
  }
  return item;
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

  // surface 必须是十二种之一
  const surfaceRaw = typeof root.surface === 'string' ? root.surface : '';
  if (!(SURFACES as string[]).includes(surfaceRaw)) {
    return NextResponse.json(
      { ok: false, error: 'surface 必须是 home/video/subsidy/seckill/fliggy/movie/me/standup/concert/merch/movieUp/coupon 之一' },
      { status: 400 },
    );
  }
  const surface = surfaceRaw as TbSurface;

  // home 的频道 tab（非法值按综合推荐处理；非 home 表面不使用）
  const tabRaw = typeof root.tab === 'string' ? root.tab.trim() : '';
  const tab = tabRaw && HOME_TAB_RULES[tabRaw] ? tabRaw : 'rec';
  const count = intOf(root.count, 8, 3, 12);
  const exclude = (Array.isArray(root.exclude) ? root.exclude : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 80);
  const nonce =
    typeof root.nonce === 'string' && root.nonce.trim()
      ? root.nonce.trim().slice(0, 64)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // 用户配置（设置 › API 配置）：随请求体传入，不落盘；baseUrl 为空视为未配置；
  // 内置默认占位（api.openai.com + 空 key）也视为未配置——省去必然 401 的空等，刷新更快出内容
  let userCfg: FeedConfig | null = null;
  const rawCfg = root.config;
  if (typeof rawCfg === 'object' && rawCfg !== null) {
    const c = rawCfg as RawRec;
    if (typeof c.baseUrl === 'string' && c.baseUrl.trim()) {
      const baseUrl = c.baseUrl.trim();
      const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : '';
      if (!(apiKey === '' && /api\.openai\.com/i.test(baseUrl))) {
        userCfg = {
          baseUrl,
          apiKey,
          model: typeof c.model === 'string' && c.model.trim() ? c.model.trim() : 'gpt-4o-mini',
          temperature: num(c.temperature, 0.9, 0, 2),
          maxTokens: intOf(c.maxTokens, 8192, 256, 32768),
        };
      }
    }
  }

  const system = buildSystem(surface);
  const args: GenerateArgs = { surface, tab, count, exclude, nonce, tagPool: tagPoolFor(surface, tab) };

  // 单次生成：用户模型优先（config 缺失/解析为空/上游失败 → 内置模型兜底）
  let rawItems: RawRec[] = [];
  let source: 'user' | 'sdk' = 'sdk';
  const user = buildUser(args);
  try {
    if (userCfg) {
      try {
        const parsed = parseItems(await upstreamText(userCfg, system, user));
        if (parsed.length > 0) {
          rawItems = parsed;
          source = 'user';
        }
      } catch {
        // 用户模型失败 → 落内置模型兜底
      }
    }
    if (rawItems.length === 0) {
      rawItems = parseItems(await sdkText(system, user));
      // 内置模型偶发空/坏输出（典型：照抄排除名单里的名字 → 全部被过滤）→
      // 换口令重试一次，并明确「黑名单只是查重用，禁止照抄其中任何名字」
      if (rawItems.length === 0) {
        rawItems = parseItems(
          await sdkText(
            system,
            `${user}\n【重试要求】上一次输出无效（很可能照抄了排除名单里的名字而被全部过滤）。排除名单只是查重黑名单，输出中严禁出现其中任何一个名字或其近似变体；${count} 条必须全部为全新原创，与黑名单完全无关。`,
          ),
        );
      }
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `AI 生成失败：${err instanceof Error ? err.message : '未知错误'}` },
      { status: 200 },
    );
  }

  // 塑形 + 强制过滤：排除名单（模型可能不严格遵守）+ 同批标题去重 + 截断到 count
  const excludeSet = new Set(exclude);
  const seen = new Set<string>();
  const items: TbFeedItem[] = [];
  for (const raw of rawItems) {
    const item = coerceItem(raw, surface, tab);
    if (excludeSet.has(item.title) || seen.has(item.title)) continue;
    seen.add(item.title);
    items.push(item);
    if (items.length >= count) break;
  }

  // 一条有效数据都没有 → 交给前端本地兜底（同 mt-feed：200 + ok:false）
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: '模型未返回有效数据' }, { status: 200 });
  }

  return NextResponse.json({ ok: true, source, items });
}
