import { NextRequest, NextResponse } from 'next/server';
import { mtImg } from '@/lib/ios/meituan-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团「酒店旅行 / 休闲玩乐 / 电影演出」频道 AI 生成接口（与 /api/mt-feed 同模式）：
 * - kind = 'fun' 休闲玩乐门店（电玩城/KTV/密室…带团购套餐）；'hotel' 酒店列表（带房型可预订）；
 *   'movie' 影片（正在热映/即将上映，购票下单）；
 * - 优先用户配置模型（设置 › API 配置，config 随请求体传入），失败落内置模型；
 * - 两次生成均失败 → 返回内置种子数据（ok:true seed:true），频道永远可用；
 * - 图片走本地 kawaii 卡通插画（goods-img.ts 按品类映射；门头/房型图与门店同品类）；
 * - 生成数据仅展示用，不影响真实订单和支付。
 */

// ---------------- 类型（客户端 import type 复用） ----------------

export interface FunDeal {
  id: string;
  title: string;
  sub: string;
  price: number;
  origPrice: number;
  discount: string;
  unit?: string;
  sold: string;
}

export interface FunVenue {
  id: string;
  name: string;
  emoji: string;
  category: string;
  tag: string;
  rating: number;
  reviewCount: number;
  pricePer: number;
  rank?: string;
  openState: string;
  openHours: string;
  tags: string[];
  addr: string;
  distanceKm: number;
  cover?: string;
  deals: FunDeal[];
  reviews: { name: string; rating: number; text: string; date: string }[];
}

export interface FunRoom {
  id: string;
  name: string;
  bed: string;
  size: string;
  floor: string;
  window: string;
  smoking: string;
  capacity: number;
  breakfast: string;
  price: number;
  origPrice?: number;
  img?: string;
}

export interface FunHotel {
  id: string;
  name: string;
  emoji: string;
  level: string;
  rating: number;
  quote: string;
  tags: string[];
  addr: string;
  distanceKm: number;
  minutes: number;
  priceFrom: number;
  promo?: string;
  img?: string;
  rooms: FunRoom[];
}

export interface FunMovie {
  id: string;
  title: string;
  en: string;
  quote: string;
  genres: string;
  ver: string[];
  release: string;
  duration: string;
  wantSee: number;
  summary: string;
  status: 'now' | 'soon';
  director: string;
  actors: string[];
  staff: number;
}

// ---------------- 工具 ----------------

type RawRec = Record<string, unknown>;

interface FeedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? clampN(n, lo, hi) : def;
}

function intOf2(v: unknown, def: number, lo: number, hi: number): number {
  return Math.round(num(v, def, lo, hi));
}

function strOf(v: unknown, def: string, maxLen = 40): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || def).slice(0, maxLen);
}

function strArr(v: unknown, max: number, maxLen = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((x) => x.trim().slice(0, maxLen));
}

function imgVariant(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 5;
}

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

/** baseUrl 归一化候选（与 /api/mt-feed 同策略） */
function buildCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

// ---------------- 上游调用（与 /api/mt-feed 同实现） ----------------

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
    if (raw.startsWith('data:')) {
      let acc = '';
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
        try {
          const chunk: unknown = JSON.parse(t.slice(5).trim());
          const c = (chunk as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> }).choices?.[0];
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
      } catch {
        // 非 JSON，按纯文本返回
      }
    }
    return raw;
  }
  throw new Error('上游接口重试次数用尽');
}

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

// ---------------- 输出解析（与 /api/mt-feed 同实现） ----------------

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

const FUN_TAGS = 'arcade、ktv、escape、spa、pool、scenic、park、mahjong、billiards、boardgame、esports、fun';
const HOTEL_TAGS = 'hotel、minsu、resort';

function buildSystem(): string {
  return '你是美团本地生活数据引擎，负责生成逼真的休闲玩乐/酒店/影院数据。数值必须符合现实常识（评分 3.6~5.0、价格与原价自洽、距离 0.3~30 公里）。只输出 JSON，不要输出任何解释、注释或 markdown 代码块。';
}

function buildUser(kind: 'fun' | 'hotel' | 'movie', topic: string, count: number, exclude: string[], nonce: string): string {
  if (kind === 'fun') {
    return [
      `生成 ${count} 条美团「休闲玩乐」频道门店数据（主题：${topic}）。每条格式：`,
      '{"kind":"venue","name":"潮玩电玩城·文留店","emoji":"🕹️","category":"电玩城","tag":"arcade","rating":4.5,"reviewCount":293,"pricePer":19,"rank":"濮阳县娃娃屋人气榜第3名","openState":"营业中","openHours":"09:00-22:00","tags":["免费停车","可订包间"],"addr":"文留镇盛庄眼科南侧130米","distanceKm":2.4,"deals":[{"title":"58枚游戏币丨『超值限购』58枚币","sub":"免预约","price":9.9,"origPrice":19.9,"discount":"5折","unit":"¥0.18/币","sold":"21小时前有人购买"},{"title":"88枚游戏币丨【超值特惠】88枚","sub":"免预约","price":19.9,"origPrice":56,"discount":"3.6折","unit":"¥0.23/币","sold":"年售300+"},{"title":"159枚游戏币丨299得399币","sub":"免预约","price":29.9,"origPrice":99,"discount":"3折","unit":"¥0.19/币","sold":"年售1000+"}],"reviews":[{"name":"小鱼儿","rating":5,"text":"娃娃机出率高，孩子玩得很开心。","date":"3天前"}]}',
      `要求：category 在 电玩城/KTV/密室逃脱/洗浴按摩/游泳健身/景区/游乐场/棋牌/台球/桌游 中选；tag 必须从白名单选最贴切的一个（${FUN_TAGS}），禁止自造词；rating 3.6~5.0；reviewCount 30~3000；pricePer 9~199；deals 恰好 3 条且价格递增、折扣 3~8 折自洽（unit 是「¥x.xx/单位」格式，无合适单位可省略）；reviews 1~2 条；门店名新颖独特（自创品牌+分店后缀），本次随机口令「${nonce}」。`,
      exclude.length > 0 ? `以下名称已展示过，禁止再出现：\n${exclude.join('、')}` : '无排除名单。',
      '全部简体中文（tag 除外）。只输出一个 JSON 数组，不要 markdown 代码块。',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (kind === 'hotel') {
    return [
      `生成 ${count} 条美团「酒店旅行」频道酒店数据（主题：${topic}）。每条格式：`,
      '{"kind":"hotel","name":"徐镇家德家宾馆","emoji":"🏨","level":"经济型","tag":"hotel","rating":4.5,"quote":"院内超大停车","tags":["住就送·35元券包","即时确认","免费停车"],"addr":"文留镇晓明路8号","distanceKm":3.1,"minutes":8,"priceFrom":98,"promo":"国庆大促","rooms":[{"name":"舒适大床房[智能语音客控]","bed":"1张大床1.8米","size":"15-20㎡","floor":"3层","window":"有窗/可开窗","smoking":"禁烟","capacity":2,"breakfast":"无早餐","price":98,"origPrice":128},{"name":"标准双床房[含早]","bed":"2张单人床1.2米","size":"18-24㎡","floor":"2层","window":"有窗","smoking":"禁烟","capacity":2,"breakfast":"含双早","price":118,"origPrice":158},{"name":"豪华家庭房","bed":"1张大床2米","size":"25-30㎡","floor":"4层","window":"有窗/可开窗","smoking":"可吸烟","capacity":3,"breakfast":"含双早","price":158,"origPrice":218}]}',
      `要求：level 在 经济型/舒适型/高档型/民宿 中选（民宿主题 level=民宿）；tag 白名单（${HOTEL_TAGS}，民宿用 minsu、度假村用 resort，其余 hotel）；rating 3.6~5.0；quote 4~10字住客短评；priceFrom 与最便宜房型价格一致；rooms 恰好 3 间、价格递增（price 80~600）；distanceKm 0.5~30 一位小数；minutes = 车程分钟数；酒店名新颖独特（自创品牌+地名，禁止照抄连锁品牌原名），本次随机口令「${nonce}」。`,
      exclude.length > 0 ? `以下名称已展示过，禁止再出现：\n${exclude.join('、')}` : '无排除名单。',
      '全部简体中文（tag 除外）。只输出一个 JSON 数组，不要 markdown 代码块。',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `生成 ${count} 条美团「电影演出」频道影片数据（正在热映约七成、即将上映约三成）。每条格式：`,
    '{"kind":"movie","title":"重生2","en":"GO FOR BROKE 2","quote":"「女杀神」复仇反杀爽爆了！","genres":"犯罪 动作","ver":["CGS 中国巨幕","CINITY 2D"],"release":"2026.10.03 09:00中国大陆上映","duration":"136分钟","wantSee":64233,"summary":"母亲复仇爽感爆棚，解气解压！女杀神绝地反杀气场全开，观感超刺激。","status":"now","director":"马浴柯","actors":["张家辉","阮经天","王大陆"],"staff":62}',
    `要求：片名/演员全部自创（禁止使用真实热映影片与真实明星原名，用常见姓氏+两三字名的自然组合）；quote 为 8~16 字吸睛短评；genres 在「犯罪 动作/喜剧 奇幻/科幻 冒险/爱情 剧情/动画 家庭/悬疑 惊悚/战争 历史」中组合；ver 1~2 个（CGS 中国巨幕/CINITY 2D/IMAX/杜比视界）；release 用「YYYY.MM.DD HH:mm中国大陆上映」格式（热映为过去7天内、待映为未来2~30天）；wantSee 热映 20000~200000、待映 3000~80000；summary 20~40 字；staff 40~120；本次随机口令「${nonce}」。`,
    exclude.length > 0 ? `以下片名已展示过，禁止再出现：\n${exclude.join('、')}` : '无排除名单。',
    '全部简体中文（en 除外）。只输出一个 JSON 数组，不要 markdown 代码块。',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------- 数据塑形 ----------------

const ts = () => Date.now().toString(36);
const rnd = () => Math.floor(Math.random() * 1e6).toString(36);

function coerceDeal(idx: number, raw: unknown): FunDeal {
  const r: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const price = Math.round(num(r.price, 19.9, 0.5, 9999) * 10) / 10;
  let origPrice = Math.round(num(r.origPrice, price * 2, 0.5, 99999) * 10) / 10;
  if (origPrice < price * 1.15) origPrice = Math.round(price * 2 * 10) / 10;
  return {
    id: `fun-d-${ts()}-${idx}-${rnd()}`,
    title: strOf(r.title, '超值团购套餐', 36),
    sub: strOf(r.sub, '免预约', 8),
    price,
    origPrice,
    discount: strOf(r.discount, `${Math.round((price / origPrice) * 100) / 10}折`, 8),
    unit: typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim().slice(0, 12) : undefined,
    sold: strOf(r.sold, `${500 + Math.floor(Math.random() * 9000)}+人购买`, 16),
  };
}

function coerceVenue(id: string, raw: unknown): FunVenue {
  const r: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const name = strOf(r.name, '潮玩电玩城', 24);
  const tag = tagOf(r.tag) ?? 'fun';
  const deals = (Array.isArray(r.deals) ? r.deals : []).slice(0, 4).map((d, i) => coerceDeal(i, d));
  const reviews = (Array.isArray(r.reviews) ? r.reviews : []).slice(0, 3).map((x, i) => {
    const rr: RawRec = typeof x === 'object' && x !== null ? (x as RawRec) : {};
    return {
      name: strOf(rr.name, ['玩乐达人', '小红帽', '夜游神'][i % 3], 12),
      rating: Math.round(num(rr.rating, 4.5, 3, 5) * 10) / 10,
      text: strOf(rr.text, '体验不错，还会再来。', 60),
      date: strOf(rr.date, '3天前', 10),
    };
  });
  const tags = strArr(r.tags, 2, 8);
  return {
    id,
    name,
    emoji: strOf(r.emoji, '🕹️', 4),
    category: strOf(r.category, '休闲玩乐', 6),
    tag,
    rating: Math.round(num(r.rating, 4.5, 3.5, 5) * 10) / 10,
    reviewCount: intOf2(r.reviewCount, 100 + Math.floor(Math.random() * 900), 10, 99999),
    pricePer: intOf2(r.pricePer, 19 + Math.floor(Math.random() * 80), 9, 999),
    rank: typeof r.rank === 'string' && r.rank.trim() ? r.rank.trim().slice(0, 24) : undefined,
    openState: strOf(r.openState, '营业中', 6),
    openHours: strOf(r.openHours, '09:00-22:00', 20),
    tags: tags.length > 0 ? tags : ['免预约'],
    addr: strOf(r.addr, '望京街道湖光中街1号', 40),
    distanceKm: Math.round(num(r.distanceKm, 2.4, 0.3, 30) * 10) / 10,
    cover: mtImg(tag, 480, 360, imgVariant(name), 'c'),
    deals,
    reviews,
  };
}

function coerceRoom(hotelName: string, idx: number, raw: unknown, tag: string): FunRoom {
  const r: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const price = Math.round(num(r.price, 128 + idx * 30, 50, 9999) * 10) / 10;
  let origPrice = Math.round(num(r.origPrice, price * 1.35, 0, 99999) * 10) / 10;
  if (origPrice < price * 1.1) origPrice = Math.round(price * 1.35 * 10) / 10;
  return {
    id: `fun-r-${ts()}-${idx}-${rnd()}`,
    name: strOf(r.name, `${['舒适大床房', '标准双床房', '豪华家庭房'][idx % 3]}[智能语音客控]`, 28),
    bed: strOf(r.bed, ['1张大床1.8米', '2张单人床1.2米', '1张大床2米'][idx % 3], 20),
    size: strOf(r.size, ['15-20㎡', '18-24㎡', '25-30㎡'][idx % 3], 12),
    floor: strOf(r.floor, `${3 + idx}层`, 8),
    window: strOf(r.window, '有窗/可开窗', 12),
    smoking: strOf(r.smoking, '禁烟', 6),
    capacity: intOf2(r.capacity, 2, 1, 6),
    breakfast: strOf(r.breakfast, '无早餐', 8),
    price,
    origPrice: Math.round(origPrice * 10) / 10,
    img: mtImg(tag, 640, 400, imgVariant(`${hotelName}-${idx}`), 'c'),
  };
}

function coerceHotel(id: string, raw: unknown, minsu: boolean): FunHotel {
  const r: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const name = strOf(r.name, '徐镇家德家宾馆', 24);
  const tag = tagOf(r.tag) ?? (minsu ? 'minsu' : 'hotel');
  const roomsRaw = Array.isArray(r.rooms) ? r.rooms : [];
  const rooms = (roomsRaw.length > 0 ? roomsRaw : [{}, {}, {}]).slice(0, 4).map((x, i) => coerceRoom(name, i, x, tag));
  const priceFrom = Math.round(num(r.priceFrom, rooms[0]?.price ?? 98, 50, 9999) * 10) / 10;
  const tags = strArr(r.tags, 3, 12);
  return {
    id,
    name,
    emoji: strOf(r.emoji, '🏨', 4),
    level: strOf(r.level, minsu ? '民宿' : '经济型', 6),
    rating: Math.round(num(r.rating, 4.5, 3.5, 5) * 10) / 10,
    quote: strOf(r.quote, '院内超大停车', 12),
    tags: tags.length > 0 ? tags : ['住就送·35元券包', '即时确认'],
    addr: strOf(r.addr, '濮阳县晓明路8号', 40),
    distanceKm: Math.round(num(r.distanceKm, 3.1, 0.3, 30) * 10) / 10,
    minutes: intOf2(r.minutes, 8, 2, 120),
    priceFrom,
    promo: typeof r.promo === 'string' && r.promo.trim() ? r.promo.trim().slice(0, 8) : undefined,
    img: mtImg(tag, 480, 360, imgVariant(name), 'c'),
    rooms,
  };
}

function coerceMovie(id: string, raw: unknown): FunMovie {
  const r: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const status = r.status === 'soon' ? 'soon' : 'now';
  const actors = strArr(r.actors, 4, 10);
  const ver = strArr(r.ver, 2, 12);
  return {
    id,
    title: strOf(r.title, '无名之火', 20),
    en: strOf(r.en, 'UNKNOWN FIRE', 30),
    quote: strOf(r.quote, '口碑新作，燃爽来袭！', 20),
    genres: strOf(r.genres, '犯罪 动作', 14),
    ver: ver.length > 0 ? ver : ['CINITY 2D'],
    release: strOf(r.release, '2026.10.03 09:00中国大陆上映', 30),
    duration: strOf(r.duration, '120分钟', 10),
    wantSee: intOf2(r.wantSee, 20000 + Math.floor(Math.random() * 80000), 500, 9999999),
    summary: strOf(r.summary, '剧情紧凑，视效震撼，值得一观。', 80),
    status,
    director: strOf(r.director, '陈亦川', 12),
    actors: actors.length > 0 ? actors : ['周正阳', '林晚晴', '许志远'],
    staff: intOf2(r.staff, 62, 20, 300),
  };
}

// ---------------- 种子兜底（LLM 两次均失败时保证频道可用） ----------------

function seedVenues(): FunVenue[] {
  const mk = (
    idx: number,
    name: string,
    emoji: string,
    category: string,
    tag: string,
    rating: number,
    reviewCount: number,
    pricePer: number,
    rank: string | undefined,
    hours: string,
    tags: string[],
    addr: string,
    distanceKm: number,
    deals: [string, number, number, string][],
  ): FunVenue => ({
    id: `fun-v-seed-${idx}`,
    name,
    emoji,
    category,
    tag,
    rating,
    reviewCount,
    pricePer,
    rank,
    openState: '营业中',
    openHours: hours,
    tags,
    addr,
    distanceKm,
    cover: mtImg(tag, 480, 360, idx % 5, 'c'),
    deals: deals.map(([title, price, orig, sold], i) => ({
      id: `fun-d-seed-${idx}-${i}`,
      title,
      sub: '免预约',
      price,
      origPrice: orig,
      discount: `${Math.round((price / orig) * 100) / 10}折`,
      sold,
    })),
    reviews: [
      { name: '玩乐达人', rating: 4.5, text: '环境不错，服务热情，值得一来。', date: '3天前' },
      { name: '小红帽', rating: 5, text: '性价比很高，下次还来。', date: '昨天' },
    ],
  });
  return [
    mk(0, '潮玩电玩城·文留店', '🕹️', '电玩城', 'arcade', 4.5, 293, 19, '濮阳县娃娃屋人气榜第3名', '09:00-22:00', ['免费停车'], '文留镇盛庄眼科南侧130米', 2.4, [['58枚游戏币丨『超值限购』58枚币', 9.9, 19.9, '21小时前有人购买'], ['88枚游戏币丨【超值特惠】88枚', 19.9, 56, '年售300+'], ['159枚游戏币丨299得399币', 29.9, 99, '年售1000+']]),
    mk(1, '星悦KTV·旗舰店', '🎤', 'KTV', 'ktv', 4.6, 512, 39, '濮阳县量贩式人气榜第1名', '10:00-02:00', ['可订包间', '免费停车'], '红旗路与建设路交叉口东80米', 1.8, [['下午场小包3小时', 39.9, 128, '2小时前有人购买'], ['黄金场中包3小时+果盘', 79.9, 218, '年售800+'], ['通宵大包畅唱+啤酒6瓶', 129, 388, '年售500+']]),
    mk(2, '迷域沉浸式密室', '🔐', '密室逃脱', 'escape', 4.8, 176, 68, '濮阳县密室人气榜第2名', '10:00-22:30', ['可停车'], '建设路小学对面二楼', 3.2, [['恐怖主题单人票', 68, 98, '1小时前有人购买'], ['古风主题双人票', 118, 196, '年售400+'], ['包场6人畅玩3主题', 358, 588, '年售200+']]),
    mk(3, '汤泉良子·洗浴会馆', '♨️', '洗浴按摩', 'spa', 4.4, 823, 79, '濮阳县洗浴人气榜第1名', '全天营业', ['含自助餐', '免费停车'], '濮上路中段路西', 4.6, [['单人洗浴门票', 49.9, 88, '30分钟前有人购买'], ['洗浴+搓背+自助餐', 99, 178, '年售2000+'], ['亲子一大一小套票', 139, 258, '年售600+']]),
    mk(4, '蓝鲸游泳健身中心', '🏊', '游泳健身', 'pool', 4.3, 341, 29, undefined, '06:30-22:00', ['恒温泳池'], '挥公大道与富强路交叉口', 5.1, [['单次游泳票', 29.9, 58, '昨天有人购买'], ['10次通用卡', 268, 480, '年售900+'], ['泳私教体验课1节', 99, 299, '年售300+']]),
    mk(5, '金港桌球会馆', '🎱', '台球', 'billiards', 4.7, 158, 25, '濮阳县台球人气榜第4名', '10:00-24:00', ['免费停车'], '国庆路东段路南', 2.9, [['休闲畅打2小时', 25, 48, '3小时前有人购买'], ['午夜畅打4小时', 45, 96, '年售700+'], ['会员储值300送100', 300, 400, '年售200+']]),
  ];
}

function seedHotels(minsu: boolean): FunHotel[] {
  const mk = (
    idx: number,
    name: string,
    level: string,
    tag: string,
    rating: number,
    quote: string,
    tags: string[],
    addr: string,
    distanceKm: number,
    minutes: number,
    promo: string | undefined,
    rooms: [string, string, number, number, string][],
  ): FunHotel => ({
    id: `fun-h-seed-${idx}`,
    name,
    emoji: '🏨',
    level,
    rating,
    quote,
    tags,
    addr,
    distanceKm,
    minutes,
    priceFrom: rooms[0][2],
    promo,
    img: mtImg(tag, 480, 360, idx % 5, 'c'),
    rooms: rooms.map(([rn, bed, price, orig, breakfast], i) => ({
      id: `fun-r-seed-${idx}-${i}`,
      name: rn,
      bed,
      size: ['15-20㎡', '18-24㎡', '25-32㎡'][i % 3],
      floor: `${2 + i}层`,
      window: i === 0 ? '有窗/可开窗' : '有窗',
      smoking: '禁烟',
      capacity: i === 2 ? 3 : 2,
      breakfast,
      price,
      origPrice: orig,
      img: mtImg(tag, 640, 400, (idx + i) % 5, 'c'),
    })),
  });
  if (minsu) {
    return [
      mk(0, '南山小院·精品民宿', '民宿', 'minsu', 4.9, '院子超大超出片', ['含双早', '免费停车', '可携宠物'], '濮上生态园区内', 6.8, 16, '国庆大促', [['观景大床房', '1张1.8米大床', 268, 358, '含双早'], ['亲子家庭房', '1张1.5米+1张1.2米', 328, 428, '含双早'], ['整院独栋4居室', '4张床可住8人', 899, 1280, '含早餐']]),
      mk(1, '湖畔星语民宿', '民宿', 'minsu', 4.7, '湖景房日落绝美', ['含早餐', '大屏投影'], '龙湖东岸北侧300米', 9.2, 22, undefined, [['湖景大床房', '1张1.8米大床', 238, 318, '含双早'], ['星空圆床房', '1张2米圆床', 288, 388, '含双早'], ['湖景双床房', '2张1.2米床', 258, 338, '含双早']]),
    ];
  }
  return [
    mk(0, '徐镇家德家宾馆', '经济型', 'hotel', 4.5, '院内超大停车', ['住就送·35元券包', '即时确认'], '文留镇晓明路8号', 3.1, 8, '国庆大促', [['舒适大床房[智能语音客控]', '1张大床1.8米', 98, 128, '无早餐'], ['标准双床房[含早]', '2张单人床1.2米', 118, 158, '含双早'], ['豪华家庭房', '1张大床2米', 158, 218, '含双早']]),
    mk(1, '艾尚城市客栈旅店', '经济型', 'hotel', 4.0, '店里空间非常大', ['住就送·35元券包', '不满意退', '停车场'], '濮阳县国庆路112号', 28.9, 44, '国庆大促', [['商务大床房', '1张1.8米大床', 65, 89, '无早餐'], ['标准双床房', '2张1.2米床', 78, 108, '无早餐'], ['商务套房', '1张2米大床', 128, 178, '含双早']]),
    mk(2, '濮阳·帝丘丨金季酒店', '舒适型', 'hotel', 5.0, '在十字路口北边三十米', ['住就送·35元券包', '新开业/装修', '有影音房'], '帝丘路与中原路交叉口北30米', 30, 48, '普通9折', [['影音大床房', '1张2米大床', 132, 189, '无早餐'], ['亲子双床房', '2张1.2米床', 158, 218, '含双早'], ['影音套房', '1张2米大床+投影', 199, 288, '含双早']]),
  ];
}

function seedMovies(): FunMovie[] {
  const mk = (idx: number, title: string, en: string, quote: string, genres: string, ver: string[], release: string, duration: string, wantSee: number, summary: string, status: 'now' | 'soon'): FunMovie => ({
    id: `fun-m-seed-${idx}`,
    title,
    en,
    quote,
    genres,
    ver,
    release,
    duration,
    wantSee,
    summary,
    status,
    director: ['陈亦川', '刘星河', '赵千帆', '沈南枝', '顾长风', '孟繁星'][idx % 6],
    actors: [['周正阳', '林晚晴', '许志远'], ['苏念安', '陆知行', '叶栖桐'], ['秦慕白', '沈星回', '韩青芜'], ['魏无涯', '江疏影', '钟离野'], ['方鹤鸣', '姚芊羽', '程亦治'], ['唐九洲', '温以凡', '祁醉']][idx % 6],
    staff: 46 + idx * 7,
  });
  return [
    mk(0, '孤注一掷2', 'GO FOR BROKE 2', '「女杀神」复仇反杀爽爆了！', '犯罪 动作', ['CGS 中国巨幕', 'CINITY 2D'], '2026.10.03 09:00中国大陆上映', '136分钟', 64233, '母亲复仇爽感爆棚，解气解压！女杀神绝地反杀气场全开，观感超刺激。', 'now'),
    mk(1, '星际快递员', 'STAR COURIER', '跨越星海的约定，笑中带泪', '科幻 冒险', ['IMAX', 'CINITY 2D'], '2026.10.01 10:00中国大陆上映', '142分钟', 128530, '小人物搭载星际货船，意外卷入拯救两个文明的宏大冒险。', 'now'),
    mk(2, '胡同里的夏天', 'SUMMER IN HUTONG', '京味温情，笑泪交织', '喜剧 剧情', ['CINITY 2D'], '2026.10.05 14:00中国大陆上映', '108分钟', 31206, '胡同拆迁前的最后一个夏天，老街坊们用一场晚会留住记忆。', 'now'),
    mk(3, '深海回响', 'ECHO OF THE DEEP', '潜入未知深渊，直面恐惧', '悬疑 惊悚', ['CGS 中国巨幕'], '2026.09.28 18:00中国大陆上映', '121分钟', 45877, '深海科考队收到失踪潜艇信号，返回却带回了不该带的东西。', 'now'),
    mk(4, '雪国列车2046', 'SNOW EXPRESS 2046', '末世列车，人人都是变量', '科幻 战争', ['IMAX', '杜比视界'], '2026.11.11 09:00中国大陆上映', '155分钟', 66320, '永动列车碾过冰原，末节车厢的少年决定改写列车法则。', 'soon'),
    mk(5, '小城琴声', 'VIOLIN IN TOWN', '一把琴，两代人，一座城', '爱情 剧情', ['CINITY 2D'], '2026.11.20 10:00中国大陆上映', '112分钟', 8922, '制琴师与音乐学院学生的相遇，让小城重新听见自己的声音。', 'soon'),
  ];
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

  const kind = root.kind === 'fun' || root.kind === 'hotel' || root.kind === 'movie' ? root.kind : 'fun';
  const topic = typeof root.topic === 'string' && root.topic.trim() ? root.topic.trim().slice(0, 16) : kind === 'hotel' ? '附近酒店' : kind === 'movie' ? '热映影片' : '全部门店';
  const minsu = topic.includes('民宿');
  const count = intOf2(root.count, 8, 4, 12);
  const exclude = (Array.isArray(root.exclude) ? root.exclude : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 60);

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
        maxTokens: intOf2(c.maxTokens, 8192, 256, 32768),
      };
    }
  }

  const system = buildSystem();
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const user = buildUser(kind, topic, count, exclude, nonce);

  const generate = async (): Promise<RawRec[] | null> => {
    try {
      if (userCfg) {
        const items = parseItems(await upstreamText(userCfg, system, user));
        if (items.length > 0) return items;
      }
    } catch {
      // 用户模型失败 → 内置模型兑底
    }
    try {
      const items = parseItems(await sdkText(system, user));
      return items.length > 0 ? items : null;
    } catch {
      return null;
    }
  };

  const items = (await generate()) ?? [];
  const excludeSet = new Set(exclude);
  const nameKey = (r: RawRec): string => strOf(r.name ?? r.title, '', 24);

  if (kind === 'fun') {
    const venues: FunVenue[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const name = nameKey(it);
      if (!name || seen.has(name) || excludeSet.has(name)) continue;
      seen.add(name);
      venues.push(coerceVenue(`fun-v-${ts()}-${venues.length}`, it));
      if (venues.length >= count) break;
    }
    if (venues.length === 0) return NextResponse.json({ ok: true, seed: true, venues: seedVenues() });
    return NextResponse.json({ ok: true, venues });
  }

  if (kind === 'hotel') {
    const hotels: FunHotel[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const name = nameKey(it);
      if (!name || seen.has(name) || excludeSet.has(name)) continue;
      seen.add(name);
      hotels.push(coerceHotel(`fun-h-${ts()}-${hotels.length}`, it, minsu));
      if (hotels.length >= count) break;
    }
    if (hotels.length === 0) return NextResponse.json({ ok: true, seed: true, hotels: seedHotels(minsu) });
    return NextResponse.json({ ok: true, hotels });
  }

  const movies: FunMovie[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const r: RawRec = typeof it === 'object' && it !== null ? it : {};
    const title = strOf(r.title, '', 20);
    if (!title || seen.has(title) || excludeSet.has(title)) continue;
    seen.add(title);
    movies.push(coerceMovie(`fun-m-${ts()}-${movies.length}`, r));
    if (movies.length >= count) break;
  }
  if (movies.length === 0) return NextResponse.json({ ok: true, seed: true, movies: seedMovies() });
  return NextResponse.json({ ok: true, movies });
}
