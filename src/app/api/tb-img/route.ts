import { execFile } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 淘宝真实商品图直链服务（按分类精准匹配，Task 50）：
 *
 * 需求口径：① 优先 Pexels 直链 → 次选 Openverse / Wikimedia Commons → 食品类可用 Foodiesfeed；
 * ② 每个分类固定一组英文搜索关键词，按关键词搜索取图、绝不跨分类随机；
 * ③ 每次刷新（r=1）可以换图但必须同分类（池内轮换 + 去重追加新搜索结果）；
 * ④ 不转存图片：只返回图库直链（浏览器直接热链），不下载/不代理/不落盘字节；
 * ⑤ 保留版权信息：每张图带 author/license/来源页（foreign landing URL），前端 img title 展示；
 * ⑥ 不大量抓取：每分类搜索列表缓存 6h + 失败负缓存 60s + 全链并发限流，图库请求极少。
 *
 * 图源链（按用户优先级）：
 * - ① Pexels：需要 API key（pexels.com/api 免费注册，配置环境变量 PEXELS_KEY 即启用）——
 *   官方条款允许热链其 CDN；未配置自动跳过。沙箱/演示环境默认无 key。
 * - ② Openverse（免 key 匿名 API）：两段搜索——先 source=stocksnap（CC0 专业图库，
 *   电商商品图质感最接近 Pexels），再全源 license_type=commercial（Flickr 等可商用图）。
 * - ③ Wikimedia Commons（免 key）：filetype:bitmap 关键词搜索（mt-img v12 同款管线，标题黑名单过滤）。
 * - ④ Foodiesfeed（免 key CC0 美食图库）：仅食品类 tag，Commons 之后兜底。
 * - ⑤ 服务端 last-good 池：网络全挂时返回池内轮换图（cached:true）——「API 请求失败时用缓存兜底」；
 *   池也没有 → ok:false（前端保留旧图不打断页面）。
 *
 * 直链热链校验：候选图统一 curl HEAD 验证（200 + image/*）才返回，防死链/防盗链图混入。
 */

// ---------------- 参数 ----------------

const LIST_TTL = 6 * 3600_000; // 每分类每图源的搜索列表缓存（按需请求的关键：6h 内同词不重搜）
const LIST_NEG_TTL = 60_000; // 搜索失败负缓存 60s
const POOL_TTL = 24 * 3600_000; // per-tag last-good 池 TTL（兜底用）
const POOL_CAP = 30; // per-tag 池上限
const HEAD_TIMEOUT_MS = 7_000; // 直链热链校验超时
const STEP_TIMEOUT_MS = 8_000; // 单图源搜索超时
const TOTAL_BUDGET_MS = 12_000; // 整请求预算（超时直接走池兜底）
const MAX_CONCURRENCY = 3; // 图库网络请求并发上限（不大量抓取）
const MIN_POOL = 2;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const PEXELS_KEY = process.env.PEXELS_KEY ?? '';

// ---------------- tag → 分类 + 英文搜索词（按关键词精准匹配，不随机） ----------------
// 分类口径与用户需求一致：数码（手机/耳机/电脑/相机）、服饰（衣服/鞋/包/帽子）、
// 家居（家具/餐具/床品）、美妆（口红/面膜/香水）、食品（零食/饮料/水果）、图书（书/杂志/文具）

interface TagMeta {
  cat: string;
  en: string;
  food?: boolean;
}

const TB_KEYWORDS: Record<string, TagMeta> = {
  // 数码
  phone: { cat: '数码', en: 'smartphone' },
  earbuds: { cat: '数码', en: 'wireless earbuds' },
  headphones: { cat: '数码', en: 'headphones' },
  laptop: { cat: '数码', en: 'laptop computer' },
  camera: { cat: '数码', en: 'digital camera' },
  watch: { cat: '数码', en: 'smartwatch' },
  tablet: { cat: '数码', en: 'tablet computer' },
  keyboard: { cat: '数码', en: 'mechanical keyboard' },
  powerbank: { cat: '数码', en: 'power bank charger' },
  speaker: { cat: '数码', en: 'bluetooth speaker' },
  monitor: { cat: '数码', en: 'computer monitor' },
  drone: { cat: '数码', en: 'drone quadcopter' },
  // 服饰
  jacket: { cat: '服饰', en: 'jacket coat' },
  jeans: { cat: '服饰', en: 'jeans denim' },
  dress: { cat: '服饰', en: 'dress fashion' },
  sneakers: { cat: '服饰', en: 'sneakers shoes' },
  shoes: { cat: '服饰', en: 'leather shoes' },
  hat: { cat: '服饰', en: 'cap hat' },
  shirt: { cat: '服饰', en: 'white shirt' },
  coat: { cat: '服饰', en: 'winter coat' },
  tshirt: { cat: '服饰', en: 't-shirt clothing' },
  hoodie: { cat: '服饰', en: 'hoodie sweatshirt' },
  backpack: { cat: '服饰', en: 'backpack bag' },
  // 家居
  sofa: { cat: '家居', en: 'sofa furniture' },
  lamp: { cat: '家居', en: 'table lamp' },
  bedding: { cat: '家居', en: 'bed linen bedroom' },
  mug: { cat: '家居', en: 'ceramic mug' },
  'water-bottle': { cat: '家居', en: 'water bottle' },
  fridge: { cat: '家居', en: 'refrigerator kitchen' },
  vase: { cat: '家居', en: 'vase flowers' },
  pillow: { cat: '家居', en: 'cushion pillow' },
  desk: { cat: '家居', en: 'wooden desk' },
  // 美妆
  lipstick: { cat: '美妆', en: 'lipstick makeup' },
  skincare: { cat: '美妆', en: 'skincare cosmetics' },
  makeup: { cat: '美妆', en: 'makeup cosmetics' },
  perfume: { cat: '美妆', en: 'perfume bottle' },
  // 食品（可用 Foodiesfeed）
  snacks: { cat: '食品', en: 'snack food', food: true },
  fruit: { cat: '食品', en: 'fresh fruit', food: true },
  tea: { cat: '食品', en: 'tea cup', food: true },
  food: { cat: '食品', en: 'delicious food', food: true },
  // 图书/文创
  books: { cat: '图书', en: 'stack of books' },
  book: { cat: '图书', en: 'book reading' },
  magazine: { cat: '图书', en: 'magazine cover' },
  stationery: { cat: '图书', en: 'stationery pens' },
  toy: { cat: '图书', en: 'plush toy' },
  gift: { cat: '图书', en: 'gift box' },
  // 其他（拍报机/门店/景点等低频 tag）
  kiosk: { cat: '其他', en: 'self service kiosk' },
  temple: { cat: '其他', en: 'chinese temple' },
  store: { cat: '其他', en: 'supermarket shelves' },
  movie: { cat: '其他', en: 'cinema auditorium' },
  umbrella: { cat: '其他', en: 'umbrella' },
  cookies: { cat: '食品', en: 'cookies biscuits', food: true },
};

/** 未知 tag 兜底：raw 词转空格当英文搜索短语（Openverse/Commons 对自由词容错良好） */
function metaOf(tag: string): TagMeta {
  const hit = TB_KEYWORDS[tag];
  if (hit) return hit;
  return { cat: '其他', en: tag.replace(/-+/g, ' ').slice(0, 40) };
}

// ---------------- 基础工具 ----------------

interface ImgItem {
  url: string;
  source: string;
  author: string;
  license: string;
  sourceUrl: string;
}

function tagOf(raw: string | null): string {
  const t = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return t || 'food';
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function curlText(url: string, timeoutMs = STEP_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sL', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA, '-H', 'Accept: application/json,text/html,*/*', url],
      { timeout: timeoutMs + 2_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.toString('utf8'));
      },
    );
  });
}

/** 直链热链校验：HEAD（-I 带 -L）须 200 且 content-type image/*（防死链/防盗链图/HTML 错误页） */
function curlHeadOk(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['-sIL', '--max-time', String(Math.ceil(HEAD_TIMEOUT_MS / 1000)), '-A', UA, '-o', '/dev/null', '-w', '%{http_code} %{content_type}', url],
      { timeout: HEAD_TIMEOUT_MS + 2_000, maxBuffer: 64 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const m = stdout.toString('utf8').trim().split('\n').pop() ?? '';
        const [code, ...ct] = m.split(' ');
        resolve(code === '200' && ct.join(' ').toLowerCase().startsWith('image/'));
      },
    );
  });
}

// ---------------- 缓存 + 并发限流 ----------------

const ovLists = new Map<string, { items: ImgItem[]; at: number; failedAt?: number }>();
const cmLists = new Map<string, { items: ImgItem[]; at: number; failedAt?: number }>();
const ffLists = new Map<string, { items: ImgItem[]; at: number; failedAt?: number }>();
const pxLists = new Map<string, { items: ImgItem[]; at: number; failedAt?: number }>();
/** per-tag last-good 池（网络全挂时的缓存兜底） */
const poolByTag = new Map<string, { items: ImgItem[]; at: number }>();
const negByTag = new Map<string, number>();
const cursor = new Map<string, number>();
const inflight = new Map<string, Promise<ImgItem[]>>();

let active = 0;
const waiters: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const w = waiters.shift();
  if (w) w(); // 槽位直接移交
  else active--;
}

type ListCache = Map<string, { items: ImgItem[]; at: number; failedAt?: number }>;

function listGet(cache: ListCache, key: string): { items: ImgItem[]; failed: boolean } {
  const rec = cache.get(key);
  const now = Date.now();
  if (rec) {
    if (rec.items.length >= MIN_POOL && now - rec.at < LIST_TTL) return { items: rec.items, failed: false };
    if (rec.failedAt && now - rec.failedAt < LIST_NEG_TTL) return { items: rec.items, failed: true };
  }
  return { items: rec?.items ?? [], failed: false };
}

function listSet(cache: ListCache, key: string, items: ImgItem[]): void {
  if (items.length >= MIN_POOL) cache.set(key, { items, at: Date.now() });
  else cache.set(key, { items: cache.get(key)?.items ?? [], at: cache.get(key)?.at ?? 0, failedAt: Date.now() });
}

// ---------------- ① Pexels（配置 PEXELS_KEY 才启用；免费注册，官方允许热链） ----------------

async function pexelsList(kw: string): Promise<ImgItem[]> {
  if (!PEXELS_KEY) return [];
  const { items, failed } = listGet(pxLists, kw);
  if (items.length >= MIN_POOL || failed) return items;
  try {
    const raw = await curlText(`https://api.pexels.com/v1/search?query=${encodeURIComponent(kw)}&per_page=15&orientation=landscape`, 8_000);
    const j = JSON.parse(raw) as { photos?: Array<{ src?: { large?: string }; photographer?: string; url?: string }> };
    const items: ImgItem[] = [];
    for (const p of j.photos ?? []) {
      const u = p.src?.large;
      if (!u || !u.startsWith('https://images.pexels.com/')) continue;
      items.push({
        url: u,
        source: 'Pexels',
        author: p.photographer?.trim() || 'Pexels',
        license: 'Pexels License（免费商用，无需署名）',
        sourceUrl: p.url || `https://www.pexels.com/search/${encodeURIComponent(kw)}/`,
      });
    }
    listSet(pxLists, kw, items);
    return items;
  } catch {
    listSet(pxLists, kw, []);
    return [];
  }
}

// ---------------- ② Openverse（免 key 匿名 API；带作者/许可/来源页） ----------------

const OV_ACCEPT =
  /^https:\/\/(cdn\.stocksnap\.io\/|live\.staticflickr\.com\/|images\.rawpixel\.com\/|upload\.wikimedia\.org\/|[^"']*\/)[^"']+\.(jpe?g|png|webp)(\?|$)/i;

function ovLicense(lic: string): string {
  const l = lic.toLowerCase();
  if (l === 'cc0' || l === 'cc0 1.0') return 'CC0（免费商用免署名）';
  if (l === 'pdm') return '公有领域（Public Domain Mark）';
  const m = l.match(/^(by(?:-sa|-nc|-nd|-nc-sa|-nc-nd)?)$/);
  if (m) return `CC ${m[1].toUpperCase()}`;
  return lic ? `CC ${lic.toUpperCase()}` : 'CC（见来源页）';
}

async function openverseList(kw: string, extraQ: string): Promise<ImgItem[]> {
  const cacheKey = `${extraQ}|${kw}`;
  const { items, failed } = listGet(ovLists, cacheKey);
  if (items.length >= MIN_POOL || failed) return items;
  try {
    const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(kw)}&page_size=20&format=json${extraQ}`;
    const raw = await curlText(api);
    const j = JSON.parse(raw) as {
      results?: Array<{ url?: string; creator?: string; license?: string; foreign_landing_url?: string; provider?: string }>;
    };
    const items: ImgItem[] = [];
    for (const r of j.results ?? []) {
      const u = (r.url ?? '').trim();
      if (!u.startsWith('https://') || u.length > 700) continue;
      if (!OV_ACCEPT.test(u)) continue;
      if (/\.svg(\?|$)/i.test(u)) continue;
      const prov = (r.provider ?? '').toLowerCase();
      items.push({
        url: u,
        source: prov === 'stocksnap' ? 'StockSnap' : prov === 'flickr' ? 'Flickr（经 Openverse）' : prov ? `${prov}（经 Openverse）` : 'Openverse',
        author: (r.creator ?? '').trim().slice(0, 60) || 'Openverse 社区',
        license: ovLicense(r.license ?? ''),
        sourceUrl: r.foreign_landing_url || 'https://openverse.org',
      });
    }
    listSet(ovLists, cacheKey, items);
    return items;
  } catch {
    listSet(ovLists, cacheKey, []);
    return [];
  }
}

async function openverseAll(kw: string): Promise<ImgItem[]> {
  // 单段通用查询（可商用图源：Flickr 等）；StockSnap/Rawpixel 经实测 CDN 拒绝热链（服务端+浏览器双 403），
  // 由 verifyPick 的同源失败跳过机制自然过滤，不作优先段浪费时间
  return openverseList(kw, '&license_type=commercial');
}

/** 候选排序：按 host 分组交错（单一废源不会吞光校验名额），且已知拒热链的 host 沉底 */
const HOTLINK_HOST_DOWN = /cdn\.stocksnap\.io|images\.rawpixel\.com/i;

function interleaveByHost(items: ImgItem[]): ImgItem[] {
  const good: ImgItem[] = [];
  const down: ImgItem[] = [];
  for (const it of items) (HOTLINK_HOST_DOWN.test(it.url) ? down : good).push(it);
  const byHost = new Map<string, ImgItem[]>();
  for (const it of good) {
    const host = it.url.split('/')[2] ?? it.url;
    const arr = byHost.get(host) ?? [];
    arr.push(it);
    byHost.set(host, arr);
  }
  const out: ImgItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const arr of byHost.values()) {
      const it = arr.shift();
      if (it) {
        out.push(it);
        added = true;
      }
    }
  }
  return [...out, ...down];
}

// ---------------- ③ Wikimedia Commons（免 key；标题黑名单过滤 + extmetadata 版权） ----------------

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_TITLE_EXCLUDE = /diagram|map|logo|plan|scheme|drawing|chart|graph|coat[-_ ]of[-_ ]arms|flag[-_ ]of|seal[-_ ]of|icon|screenshot|wellcome|fortepan/i;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, ' ')
    .trim()
    .slice(0, 60);
}

async function commonsList(kw: string): Promise<ImgItem[]> {
  const { items, failed } = listGet(cmLists, kw);
  if (items.length >= MIN_POOL || failed) return items;
  try {
    const api = `${COMMONS_API}?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${kw}`)}&gsrlimit=40&gsrnamespace=6&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiurlwidth=1200&format=json`;
    const raw = await curlText(api);
    const j = JSON.parse(raw) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              thumburl?: string;
              mime?: string;
              descriptionurl?: string;
              extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
            }>;
          }
        >;
      };
    };
    const items: ImgItem[] = [];
    const seen = new Set<string>();
    for (const page of Object.values(j.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const thumb = info?.thumburl?.split('?')[0];
      if (!thumb || seen.has(thumb)) continue;
      if (!/^image\/(jpeg|png|webp)$/.test(info?.mime ?? '')) continue;
      if (COMMONS_TITLE_EXCLUDE.test(page.title ?? '')) continue;
      seen.add(thumb);
      const meta = info?.extmetadata ?? {};
      items.push({
        url: thumb,
        source: 'Wikimedia Commons',
        author: stripHtml(meta.Artist?.value ?? '') || 'Wikimedia Commons',
        license: stripHtml(meta.LicenseShortName?.value ?? '') || 'CC（见来源页）',
        sourceUrl: info?.descriptionurl || 'https://commons.wikimedia.org',
      });
    }
    listSet(cmLists, kw, items);
    return items;
  } catch {
    listSet(cmLists, kw, []);
    return [];
  }
}

// ---------------- ④ Foodiesfeed（免 key CC0 美食图库；仅食品 tag） ----------------

const FF_BASE = 'https://www.foodiesfeed.com/zh/s/';

function parseFfUrls(html: string): string[] {
  const t = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const set = new Set<string>();
  const re = /https:\/\/pub-[a-z0-9]+\.r2\.dev\/[a-z]+\/thumbnails\/[a-zA-Z0-9/_.-]+\.webp/g;
  for (const m of t.matchAll(re)) set.add(m[0]);
  return [...set];
}

async function foodiesfeedList(kw: string): Promise<ImgItem[]> {
  const { items, failed } = listGet(ffLists, kw);
  if (items.length >= MIN_POOL || failed) return items;
  try {
    const html = await curlText(`${FF_BASE}${encodeURIComponent(kw)}`);
    const items: ImgItem[] = parseFfUrls(html)
      .slice(0, 30)
      .map((u) => ({
        url: u,
        source: 'Foodiesfeed',
        author: 'Foodiesfeed 摄影师',
        license: 'CC0（免费商用免署名）',
        sourceUrl: 'https://www.foodiesfeed.com',
      }));
    listSet(ffLists, kw, items);
    return items;
  } catch {
    listSet(ffLists, kw, []);
    return [];
  }
}

// ---------------- 取图链：Pexels → Openverse → Commons → (食品) Foodiesfeed ----------------

async function sourceLists(meta: TagMeta): Promise<ImgItem[]> {
  const kw = meta.en;
  const pexels = await pexelsList(kw);
  const [ov, cm] = await Promise.all([openverseAll(kw), commonsList(kw)]);
  const merged = [...pexels, ...ov, ...cm];
  if (meta.food) {
    const ff = await foodiesfeedList(kw);
    merged.push(...ff);
  }
  return merged;
}

/** 池内轮换取 n 张（缓存兜底时也保证换图同分类） */
function rotateFrom(items: ImgItem[], tag: string, n: number): ImgItem[] {
  if (items.length === 0) return [];
  let c = cursor.get(tag);
  if (c === undefined) c = hashStr(tag) % items.length;
  cursor.set(tag, (c + n) % items.length);
  return Array.from({ length: Math.min(n, items.length) }, (_, i) => items[(c + i) % items.length]);
}

/** 从候选池选出 n 张「热链校验通过」的直链：同 host 连续 3 次校验失败则跳过该 host 剩余候选
 *  （防单一废源吞光名额），总名额 n*6+4，受总预算约束 */
async function verifyPick(candidates: ImgItem[], n: number, deadline: number, excludeUrls: Set<string>): Promise<ImgItem[]> {
  const out: ImgItem[] = [];
  const hostFails = new Map<string, number>();
  let tries = 0;
  const cap = n * 6 + 4;
  for (const it of candidates) {
    if (out.length >= n || tries >= cap || Date.now() > deadline) break;
    if (excludeUrls.has(it.url)) continue;
    const host = it.url.split('/')[2] ?? it.url;
    if ((hostFails.get(host) ?? 0) >= 3) continue;
    tries++;
    if (await curlHeadOk(it.url)) {
      hostFails.delete(host);
      excludeUrls.add(it.url);
      out.push(it);
    } else {
      hostFails.set(host, (hostFails.get(host) ?? 0) + 1);
    }
  }
  return out;
}

async function fetchItems(tag: string, n: number, deadline: number): Promise<ImgItem[]> {
  const meta = metaOf(tag);
  const pool = poolByTag.get(tag);
  const excludeUrls = new Set((pool?.items ?? []).map((i) => i.url));
  const lists = await sourceLists(meta);
  if (lists.length === 0) return [];
  return verifyPick(interleaveByHost(lists), n, deadline, excludeUrls);
}

// ---------------- 路由 ----------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tag = tagOf(sp.get('k'));
  const refresh = sp.get('r') === '1';
  const n = refresh ? 3 : 2;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const key = `${tag}|${refresh ? 1 : 0}`;

  const now0 = Date.now();
  const pool0 = poolByTag.get(tag);
  const poolItems0 = pool0 && now0 - pool0.at < POOL_TTL ? pool0.items : (pool0?.items ?? []);
  // 刚失败过（60s 负缓存）：不再打图库，池内轮换兑底 / 明确 ok:false
  const neg = negByTag.get(tag);
  if (neg && now0 - neg < LIST_NEG_TTL) {
    if (poolItems0.length > 0) {
      return NextResponse.json({ ok: true, tag, items: rotateFrom(poolItems0, tag, n), cached: true });
    }
    return NextResponse.json({ ok: false, tag, items: [] });
  }

  // 同请求并发去重（同 tag 同模式的 burst 只打一次图库）
  const running = inflight.get(key);
  if (running) {
    try {
      const items = await running;
      return NextResponse.json({ ok: items.length > 0, tag, items });
    } catch {
      return NextResponse.json({ ok: false, tag, items: [] });
    }
  }

  const task = acquire()
    .then(() => fetchItems(tag, n, deadline))
    .finally(release);
  inflight.set(key, task);
  task.catch(() => undefined).finally(() => inflight.delete(key));

  let fresh: ImgItem[] = [];
  try {
    fresh = await task;
  } catch {
    fresh = [];
  }

  const now = Date.now();
  const pool = poolByTag.get(tag);
  const poolItems = pool && now - pool.at < POOL_TTL ? pool.items : (pool?.items ?? []);

  if (fresh.length > 0) {
    // 新图入池（新在前），旧图保留（兜底深度）
    poolByTag.set(tag, { items: [...fresh, ...poolItems].slice(0, POOL_CAP), at: now });
    negByTag.delete(tag);
    return NextResponse.json({ ok: true, tag, items: fresh });
  }

  // 网络全挂 → 服务端缓存兜底：池内轮换（同分类换图）
  if (poolItems.length > 0) {
    const items = rotateFrom(poolItems, tag, n);
    return NextResponse.json({ ok: true, tag, items, cached: true });
  }

  negByTag.set(tag, now);
  return NextResponse.json({ ok: false, tag, items: [] });
}
