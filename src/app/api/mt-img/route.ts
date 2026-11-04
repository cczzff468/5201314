import { execFile } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团内容匹配图（v10，Foodiesfeed + TheMealDB + Wikimedia Commons + LLM搜索词 四级图库链；解决图片不符/不好看问题）：
 * - ① Foodiesfeed（CC0 可商用免署名）：tag → 图库分类关键词搜索（按关键词取图，不随机），
 *     每分类缓存一次搜索结果（~50 张直链，TTL 6h，按需请求不大规模抓取），per-分类轮换指针：
 *     同分类每次刷新可换图、不重复太频繁，且永远同分类（图片与内容一致）；
 *     图片流式经 sharp 按展示尺寸 cover 裁剪压缩为 webp（不落盘、不转存，只内存流转）；
 * - ①.5 TheMealDB（免 key 免注册）：Foodiesfeed 失败时的菜品实景兜底池（真实菜品照片）；
 * - ② Wikimedia Commons（免 key 免费图库）：奶茶等 Foodiesfeed 缺失品类（milk-tea 池全是茶/咖啡，
 *     无真珍珠奶茶）+ 酒店/电玩/KTV/药房/口罩/保健品等非食物实景（Foodiesfeed 为纯美食图库）走 Commons 关键词搜索；
 *     奶茶等 COMMONS_FIRST 品类优先级高于 Foodiesfeed，其余食物 tag 在 FF/MealDB 失败后兑底；
 * - ③ Pixabay / Pexels（免费商用）：仅当环境变量 PIXABAY_KEY / PEXELS_KEY 配置时启用，
 *     同样关键词搜索 + 轮换；未配置自动跳过；
 * - ⑤ LLM 搜索词：完全未知的品类 tag 由内置模型译成英文 Commons 搜索短语（按 tag 缓存 6h，
 *     一次性开销）——仍然「按关键词搜真实图库」，不引入 AI 生图；
 * - ④ 默认图（本地算法图兜底）：按分类配色渐变 + 分类 emoji 的 SVG，服务端直出，
 *     永远 200 —— 保证任何情况下都有图可显示；
 * - 浏览器强缓存（15min，与字节缓存同步）：命中秒出，过期自动换图；
 * - 并发队列（同时最多 4 个取图任务）：避免信息流 burst 打爆图库。
 * - 注：Foodiesfeed 与 Wikimedia 对 Node fetch 均按 TLS 指纹拦截（403），搜索与下载统一走 curl 子进程。
 */

// ---------------- 参数 ----------------

const MAX_CACHE = 300; // 图片字节缓存上限（张）
const IMG_TTL = 15 * 60_000; // 图片缓存 15min：期内稳定秒出，过期轮换新图（每次刷新可换）
const LIST_TTL = 6 * 3600_000; // 分类图片列表缓存 6h（每分类只搜索一次）
const LIST_NEG_TTL = 60_000; // 搜索失败负缓存 60s（防止每张图都重试打图库）
const MIN_POOL = 3; // 搜索结果少于 3 张视为无有效分类 → 走下一级
const MAX_CONCURRENCY = 4;

const FF_BASE = 'https://www.foodiesfeed.com/zh/s/';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FF_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function intOf(v: string | null, def: number, lo: number, hi: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

/** tag 清洗：小写、仅留 a-z0-9-，空回退 food */
function tagOf(raw: string | null): string {
  const t = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return t || 'food';
}

// ---------------- tag → 图库关键词映射（按分类搜图，不随机） ----------------

/** Foodiesfeed 搜索词映射：tag 实测命中（2026-02）：括号内为该词命中张数 */
const FF_SEARCH: Record<string, string> = {
  hotpot: 'hot-pot', // 24
  'milk-tea': 'milk-tea', // 49
  'bubble-tea': 'milk-tea',
  cola: 'drink', // 49
  coffee: 'coffee', // 51
  tea: 'tea', // 50
  juice: 'juice', // 48
  soymilk: 'drink',
  milkshake: 'drink',
  pizza: 'pizza', // 51
  burger: 'burger', // 49
  sushi: 'sushi', // 50
  barbecue: 'barbecue', // 49
  lamb: 'barbecue', // lamb 仅 3 张 → 并入烤肉分类池
  'fried-chicken': 'fried-chicken', // 50
  dumplings: 'dumplings', // 49
  dessert: 'dessert', // 50
  'egg-tart': 'dessert',
  sundae: 'ice-cream', // 49
  'ice-cream': 'ice-cream',
  seafood: 'seafood', // 49
  steak: 'steak', // 49
  beef: 'beef', // 49
  pork: 'pork', // 48
  duck: 'roast-duck', // 32
  salad: 'salad', // 49
  sandwich: 'sandwich', // 49
  bread: 'bread', // 49
  porridge: 'breakfast', // porridge 仅 1 张 → 并入早餐分类池
  soup: 'soup', // 49
  noodles: 'noodles', // 49
  rice: 'rice', // 49
  breakfast: 'breakfast', // 50
  fruit: 'fruit', // 49
  banana: 'banana', // 49
  cherry: 'cherries', // 49
  mandarin: 'mandarin', // 5
  kiwi: 'kiwi', // 32
  braised: 'braised', // 16
  spicy: 'spicy', // 50
  egg: 'eggs', // 49
  'quail-egg': 'eggs',
  milk: 'milk', // 49
  fries: 'fries', // 50
  store: 'store', // 34（便利店零食饮料）
  'chinese-food': 'chinese-food', // 26
  'hot-pot': 'hot-pot',
  'fast-food': 'fast-food',
  food: 'food', // 49（通用食物兑底池，v5 已去水果/生鲜图）
  japanese: 'japanese', // 50（日料通用，v5 实测）
  thai: 'thai', // 12（泰国菜，v5 实测）
  asian: 'asian', // 49（亚洲/东南亚菜兑底，v5 实测）
  curry: 'curry', // 30
  kimchi: 'kimchi', // 30（韩式泡菜/韩餐）
  'rice-bowl': 'rice-bowl', // 49（盖饭/井物）
  'stir-fry': 'stir-fry', // 50（小炒/炒菜）
  'noodle-soup': 'noodle-soup', // 49（汤面/河粉）
};

/** Wikimedia Commons 搜索词映射（免 key 免费图库，实景照片）。
 *  覆盖两类：① Foodiesfeed 没有真图池的品类（奶茶→bubble tea，FF 的 milk-tea 池全是茶/咖啡/拿铁）；
 *  ② 非食物品类（酒店/影院/KTV/电玩等，FF 是纯美食图库搜不到）。 */
const COMMONS_SEARCH: Record<string, string> = {
  'milk-tea': 'bubble tea', // 30+（真珍珠奶茶，修复「奶茶不是茶」）
  'bubble-tea': 'bubble tea',
  boba: 'bubble tea',
  hotel: 'hotel room interior', // 酒店客房实景
  'hotel-room': 'hotel room',
  resort: 'resort hotel',
  minsu: 'homestay bedroom', // 民宿
  cinema: 'cinema auditorium',
  movie: 'cinema auditorium',
  ktv: 'karaoke room',
  karaoke: 'karaoke',
  arcade: 'arcade game machines', // 电玩城
  esports: 'esports arena',
  escape: 'escape room game', // 密室逃脱
  spa: 'spa massage', // 洗浴按摩
  pool: 'swimming pool indoor', // 游泳健身
  mahjong: 'mahjong', // 棋牌
  billiards: 'billiards', // 台球
  boardgame: 'board game', // 桌游
  scenic: 'china scenic mountain', // 景区
  park: 'amusement park', // 游乐场
  fun: 'entertainment center', // 休闲玩乐通用
  medicine: 'pharmacy interior', // 药房实景（FF 无药房池，v7 起走 Commons）
  mask: 'surgical mask', // 医用口罩商品图（v10）
  bandage: 'adhesive bandage', // 创可贴/绷带商品图（v10）
  vitamin: 'dietary supplement', // 维生素/保健品商品图（v10）
  pill: 'pill tablets blister pack', // 药片/胶囊/颗粒特写（v11 细分）
  syrup: 'medicine syrup bottle', // 口服液/滴剂/糖浆类药品（v11 细分）
  sanitizer: 'hand sanitizer gel', // 洗手液/消毒用品（v11）
  flower: 'flower bouquet shop', // 鲜花花束/花店（v11，闪购）
  supermarket: 'supermarket aisle', // 超市货架/卖场（v11，闪购）
  gym: 'gym fitness equipment', // 健身房器材（v11，休闲玩乐细分）
  plane: 'airplane cabin window', // 机票订单图（v11）
  train: 'high speed train china', // 火车票订单图（v11）
  // 淘宝 App 商品图品类（v12：电商非食物商品，Commons 优先，绝不落 FF 食物池）
  phone: 'smartphone',
  earbuds: 'wireless earbuds',
  headphones: 'headphones',
  laptop: 'laptop computer',
  keyboard: 'computer keyboard',
  camera: 'digital camera',
  watch: 'wristwatch',
  tablet: 'tablet computer',
  monitor: 'computer monitor',
  speaker: 'loudspeaker audio',
  powerbank: 'power bank charger',
  drone: 'drone quadcopter',
  sneakers: 'sneakers shoes',
  jacket: 'jacket coat fashion',
  dress: 'dress fashion',
  tshirt: 't-shirt clothing',
  backpack: 'backpack bag',
  hoodie: 'hoodie sweatshirt',
  jeans: 'jeans denim',
  coat: 'overcoat fashion',
  lipstick: 'lipstick cosmetics',
  perfume: 'perfume bottle',
  skincare: 'face cream cosmetics',
  makeup: 'makeup cosmetics palette',
  sofa: 'sofa furniture',
  lamp: 'table lamp',
  bedding: 'bed linens',
  mug: 'coffee mug cup',
  vase: 'vase',
  pillow: 'throw pillow cushion',
  desk: 'office desk furniture',
  books: 'stack of books',
  book: 'book reading',
  snacks: 'snack food package',
  cookies: 'cookies biscuits',
  umbrella: 'umbrella',
  'water-bottle': 'water bottle',
  toy: 'plush toy stuffed',
};

/** Commons 优先的 tag（其余 tag 在 FF/stock 失败后用 Commons 同词兑底） */
const COMMONS_FIRST = new Set(Object.keys(COMMONS_SEARCH));

/** Commons 文件标题黑名单：图表/地图/徽标等非照片结果剔除；Wellcome/Fortepan 为黑白历史藏品图，观感不符现代店铺 */
const COMMONS_TITLE_EXCLUDE = /diagram|map|logo|plan|scheme|drawing|chart|graph|coat[-_ ]of[-_ ]arms|flag[-_ ]of|seal[-_ ]of|icon|screenshot|wellcome|fortepan/i;

/** Commons 标题白名单（按搜索词）：搜索结果混入无关图时精准过滤（奶茶池剔联名杯垫/政客照，药房池剔建筑院落） */
const COMMONS_REQUIRE: Record<string, RegExp> = {
  'bubble tea': /bubble|boba|tapioca|pearl|タピオカ|trân[ _-]?châu|milk[ _-]?tea/i,
  'pharmacy interior': /pharmac|apothe|lékárna|patika|drugstore|chemist/i,
  'surgical mask': /mask|respirator/i,
  'adhesive bandage': /bandage|pflaster|plaster|band[ _-]?aid/i,
  'dietary supplement': /supplement|vitamin|tablet|capsule|pill/i,
  'spa massage': /spa|massage|sauna|wellness|bath|bathing/i,
  'pill tablets blister pack': /pill|tablet|capsule|blister|medic/i,
  'medicine syrup bottle': /syrup|syrups|bottle|liquid|dropper|medicine|pharmac/i,
  'hand sanitizer gel': /sanitizer|soap|gel|disinfect|antiseptic/i,
  'flower bouquet shop': /flower|bouquet|florist|roses|bloom/i,
  'supermarket aisle': /supermarket|grocery|aisle|shelf|hypermarket/i,
  'gym fitness equipment': /gym|fitness|dumbbell|treadmill|weightlift|sport/i,
  'airplane cabin window': /airplane|aircraft|wing|aviation|flight|cabin/i,
  'high speed train china': /train|railway|high[-_ ]?speed|crh|bullet/i,
};

/** Commons 标题黑名单（按搜索词，可叠加）：药房池剔除博物馆/历史复原老照片
 *  （Sweny's 都柏林 19 世纪老药房 / Brening 不来梅博物馆复原药房 / Victorian 等 —— 观感是「古董店」不是现代药店） */
const COMMONS_EXCLUDE: Record<string, RegExp> = {
  'pharmacy interior': /sweny|brening|victorian|museum|heritage|joyce|historic|antique|vintage|19\d\d|18\d\d/i,
  // 比利时小镇 Spa（Thermes de Spa）系列：山丘/缆车/城镇外景，与洗浴按摩业态无关（v11）
  'spa massage': /thermes[ _-]?de[ _-]?spa|colline|annette|lubin|cable|seilbahn|tramway|funicular/i,
};

/** AI/图库tag 同义词收敛：模型自由发挥的菜系词 → 图库实际有效的分类词。
 *  未知 tag 一律落 'food'（比透传到无关词的搜索结果更贴内容）。 */
const TAG_SYNONYMS: Record<string, string> = {
  japanese: 'japanese', 'japanese-food': 'japanese', 'japanese-cuisine': 'japanese', washoku: 'japanese',
  japan: 'japanese', sashimi: 'sushi', ramen: 'noodles',
  'thai-food': 'thai', thailand: 'thai', 'tom-yum': 'thai', 'pad-thai': 'thai', tomyum: 'thai',
  vietnamese: 'asian', 'south-east-asian': 'asian', southeast: 'asian', singapore: 'asian',
  malaysian: 'asian', indonesian: 'asian',
  'hong-kong': 'chinese-food', hongkong: 'chinese-food', canton: 'chinese-food', cantonese: 'chinese-food',
  chinese: 'chinese-food', 'chinese-food': 'chinese-food', 'chinese-restaurant': 'chinese-food',
  chaoshan: 'chinese-food', teochew: 'chinese-food',
  korean: 'barbecue', 'korean-bbq': 'barbecue', kbbq: 'barbecue', 'south-korean': 'barbecue', korea: 'barbecue',
  bbq: 'barbecue', grill: 'barbecue', skewer: 'barbecue', chuanr: 'barbecue',
  sichuan: 'spicy', szechuan: 'spicy', mala: 'spicy', spicy: 'spicy', hunan: 'spicy',
  dimsum: 'dumplings', 'dim-sum': 'dumplings', dim: 'dumplings',
  shabu: 'hotpot', malatang: 'hotpot', huo: 'hotpot',
  boba: 'milk-tea', bubble: 'milk-tea', pearl: 'milk-tea',
  beverage: 'drink', drinks: 'drink', softdrink: 'drink',
  american: 'burger', fastfood: 'fast-food', western: 'steak',
  italian: 'pizza', pasta: 'noodles', spaghetti: 'noodles',
  stirfry: 'stir-fry', 'stir-fried': 'stir-fry', saute: 'stir-fry', wok: 'stir-fry',
  donburi: 'rice-bowl',
  'japanese-curry': 'curry', 'green-curry': 'curry', massaman: 'curry',
  bakery: 'bread', bakes: 'bread', cake: 'dessert', pastry: 'dessert',
  hotpot: 'hot-pot', 'hot-pot': 'hot-pot',
  veg: 'salad', vegan: 'salad', vegetarian: 'salad',
  tablets: 'pill', capsule: 'pill', capsules: 'pill', medication: 'pill', drug: 'pill', drugs: 'pill', granule: 'pill', granules: 'pill',
  'liquid-medicine': 'syrup', eyedrop: 'syrup', eyedrops: 'syrup', spray: 'syrup', cough: 'syrup',
  disinfect: 'sanitizer', 'hand-wash': 'sanitizer', toiletries: 'sanitizer',
  bouquet: 'flower', florist: 'flower', roses: 'flower',
  grocery: 'supermarket', hypermarket: 'supermarket', 'convenience-store': 'supermarket',
  fitness: 'gym', workout: 'gym',
};

/** 基础黑名单（v6 实测，所有池适用）：水果/生鲜摊位/咖啡茶饮乱入（hot-pot 池混入 steaming-hot-coffee、
 *  milk-tea 池混入 latte/coffee-reading）/生食材/节日场景。搜索词与黑名单重叠的池（咖啡池搜 coffee、
 *  水果池搜 fruit、奶茶池等）在 filterPool 里跳过对应词。 */
const FF_POOL_EXCLUDE =
  /disco|neon|abstract|rainbow|flower|floral|forest|landscape|mountain|beach|sunset|sunrise|animal|dog|cat|bird|building|portrait|nature|festival|strawberr|peach|nectarin|watermelon|grape|melon|banana|mango|pomegranate|pineapple|papaya|lychee|dragonfruit|apple|berries|berry|fruit|crate|stall|market|produce|ingredient|vegetable|tomato|eggplant|sweet-potato|seeds|[/_-]nuts?[/_-]|[/_-]peas[/_-]|[/_-]corn[/_-]|christmas|halloween|coffee|cappuccino|espresso|barista|flatwhite|macchiato|kettle|clean-pan|boiling-egg|pouring|meeting/;

/** 场景图黑名单（仅通用池适用）：人物聚餐/出镜类。具体菜系池（如 hot-pot 的家庭聚餐图）是自然门头图，不剔除 */
const FF_SCENE_EXCLUDE = /family|friends|people|dinner-with/;

/** 通用池：内容宽泛最易被场景图污染，应用全部黑名单 */
const FF_SCENE_POOLS = new Set([
  'food', 'asian', 'japanese', 'thai', 'chinese-food', 'stir-fry', 'rice-bowl', 'noodle-soup', 'curry', 'kimchi', 'fast-food', 'store',
]);

/** 搜索词本身与基础黑名单重叠的池（咖啡池搜 coffee、水果池搜 fruit、茶/果汁/冰淇淋池同理），整体跳过过滤。
 *  注意 milk-tea 不跳过：其搜索结果混入大量咖啡图，对奶茶品牌属于内容不符，需要按黑名单剔除。 */
const FF_FILTER_SKIP = /^(fruit|banana|cherry|cherries|mandarin|kiwi|strawberr|coffee|tea|juice|drink|milk$|ice-cream)/;

function filterPool(urls: string[], kw: string): string[] {
  if (FF_FILTER_SKIP.test(kw)) return urls;
  const low = urls.map((u) => u.toLowerCase());
  const base = urls.filter((_, i) => !FF_POOL_EXCLUDE.test(low[i]));
  if (!FF_SCENE_POOLS.has(kw)) return base;
  return base.filter((u) => !FF_SCENE_EXCLUDE.test(u.toLowerCase()));
}

/** tag → Foodiesfeed 搜索词：映射表 → 同义词链 → 未知落 food（防 AI 自造词搜出无关图） */
function ffKeywordOf(tag: string): string {
  let t = tag;
  for (let i = 0; i < 3; i++) {
    const direct = FF_SEARCH[t];
    if (direct !== undefined) return direct;
    const syn = TAG_SYNONYMS[t];
    if (syn === undefined) break;
    t = syn;
  }
  return FF_SEARCH.food;
}

/** 默认图分类配色 + emoji（本地算法图兜底：保证任何情况都有图） */
const DEFAULT_ART: Record<string, { bg: [string, string]; emoji: string }> = {
  hotpot: { bg: ['#E0452B', '#8C1D13'], emoji: '🍲' },
  'milk-tea': { bg: ['#C98A5B', '#7A4A28'], emoji: '🧋' },
  'bubble-tea': { bg: ['#C98A5B', '#7A4A28'], emoji: '🧋' },
  coffee: { bg: ['#8A6248', '#4B3226'], emoji: '☕' },
  tea: { bg: ['#7FA85C', '#43602F'], emoji: '🍵' },
  juice: { bg: ['#F2A93B', '#D9772B'], emoji: '🧃' },
  soymilk: { bg: ['#EAD9BC', '#B99B6B'], emoji: '🥛' },
  milkshake: { bg: ['#E8B4C8', '#B26E8D'], emoji: '🥤' },
  milk: { bg: ['#F2EEE6', '#C9BFAE'], emoji: '🥛' },
  cola: { bg: ['#5A4636', '#2B2018'], emoji: '🥤' },
  pizza: { bg: ['#E0862B', '#9C4A14'], emoji: '🍕' },
  burger: { bg: ['#E0A02B', '#9C6414'], emoji: '🍔' },
  fries: { bg: ['#EFC94C', '#C99A2E'], emoji: '🍟' },
  sushi: { bg: ['#3E7C8C', '#1F4A55'], emoji: '🍣' },
  barbecue: { bg: ['#B8432B', '#6E1F12'], emoji: '🍢' },
  lamb: { bg: ['#B8432B', '#6E1F12'], emoji: '🍖' },
  'fried-chicken': { bg: ['#D98E2B', '#8C5214'], emoji: '🍗' },
  dumplings: { bg: ['#E8E2D4', '#A89F8A'], emoji: '🥟' },
  dessert: { bg: ['#E8A4B8', '#B25F7A'], emoji: '🍰' },
  'ice-cream': { bg: ['#F0C8D8', '#C2879F'], emoji: '🍨' },
  sundae: { bg: ['#F0C8D8', '#C2879F'], emoji: '🍨' },
  seafood: { bg: ['#E8735A', '#94382A'], emoji: '🦐' },
  steak: { bg: ['#8C4A3B', '#4A241C'], emoji: '🥩' },
  beef: { bg: ['#8C5A3B', '#4A2E1C'], emoji: '🥩' },
  pork: { bg: ['#D98A6B', '#8C4A32'], emoji: '🍖' },
  duck: { bg: ['#C9744A', '#7A3E22'], emoji: '🦆' },
  salad: { bg: ['#8CB85C', '#4A6B2B'], emoji: '🥗' },
  sandwich: { bg: ['#E8C87A', '#A8873B'], emoji: '🥪' },
  bread: { bg: ['#D9A86B', '#8C6532'], emoji: '🍞' },
  porridge: { bg: ['#EFE9DC', '#B5AB93'], emoji: '🥣' },
  soup: { bg: ['#E8B85C', '#9C7428'], emoji: '🍜' },
  noodles: { bg: ['#E8C06B', '#9C7A28'], emoji: '🍜' },
  rice: { bg: ['#F0EDE4', '#B8B2A2'], emoji: '🍚' },
  breakfast: { bg: ['#F2C94C', '#C9922E'], emoji: '🍳' },
  fruit: { bg: ['#F27B5C', '#B23A28'], emoji: '🍓' },
  banana: { bg: ['#F2D95C', '#C9A828'], emoji: '🍌' },
  cherry: { bg: ['#D94A5A', '#8C1F2E'], emoji: '🍒' },
  mandarin: { bg: ['#F2A93B', '#C97728'], emoji: '🍊' },
  kiwi: { bg: ['#8CB85C', '#4A6B2B'], emoji: '🥝' },
  braised: { bg: ['#8C5A3B', '#4A2E1C'], emoji: '🍖' },
  spicy: { bg: ['#D9452B', '#8C1F14'], emoji: '🌶️' },
  store: { bg: ['#5CA86B', '#2E6B3B'], emoji: '🛒' },
  medicine: { bg: ['#7AA8C9', '#3B6B8C'], emoji: '💊' },
  mask: { bg: ['#8FB8D8', '#4A7A9C'], emoji: '😷' },
  bandage: { bg: ['#E8C9A8', '#B08858'], emoji: '🩹' },
  vitamin: { bg: ['#F2C94C', '#C9822E'], emoji: '💊' },
  hotel: { bg: ['#6FA8DC', '#2E5C8C'], emoji: '🏨' },
  'hotel-room': { bg: ['#6FA8DC', '#2E5C8C'], emoji: '🛏️' },
  resort: { bg: ['#5CB8B0', '#2A6B66'], emoji: '🏝️' },
  minsu: { bg: ['#C9A87A', '#8C6B3B'], emoji: '🏡' },
  cinema: { bg: ['#5A4A6B', '#2B2038'], emoji: '🎬' },
  movie: { bg: ['#5A4A6B', '#2B2038'], emoji: '🎬' },
  ktv: { bg: ['#E86B9E', '#8C2B5A'], emoji: '🎤' },
  karaoke: { bg: ['#E86B9E', '#8C2B5A'], emoji: '🎤' },
  arcade: { bg: ['#8B5CF6', '#4A2B8C'], emoji: '🕹️' },
  esports: { bg: ['#5C6BC0', '#283593'], emoji: '🎮' },
  escape: { bg: ['#4A5568', '#1A202C'], emoji: '🔐' },
  spa: { bg: ['#C98A9E', '#7A3B52'], emoji: '♨️' },
  pool: { bg: ['#4AbedC', '#1A5A8C'], emoji: '🏊' },
  mahjong: { bg: ['#C9B86B', '#7A6B28'], emoji: '🀄' },
  billiards: { bg: ['#2E7D4F', '#143D26'], emoji: '🎱' },
  boardgame: { bg: ['#C98A5B', '#7A4A28'], emoji: '🎲' },
  scenic: { bg: ['#5CA86B', '#2E6B3B'], emoji: '🏞️' },
  park: { bg: ['#E8A45C', '#9C5F28'], emoji: '🎡' },
  fun: { bg: ['#B86BC9', '#6B2A7A'], emoji: '🎪' },
  food: { bg: ['#F2C94C', '#C9822E'], emoji: '🍽️' },
};
const DEFAULT_FALLBACK = DEFAULT_ART.food;

/** 本地默认图 SVG：分类配色渐变 + emoji（浏览器原生渲染，<1KB，永远可显示） */
function defaultArtSvg(tag: string, w: number, h: number): NextResponse {
  const art = DEFAULT_ART[tag] ?? DEFAULT_FALLBACK;
  const id = `g${Math.abs(hashStr(tag + w + h)) % 100000}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${art.bg[0]}"/><stop offset="1" stop-color="${art.bg[1]}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id})"/>` +
    `<circle cx="${w * 0.82}" cy="${h * 0.16}" r="${Math.min(w, h) * 0.28}" fill="#ffffff" opacity="0.08"/>` +
    `<circle cx="${w * 0.12}" cy="${h * 0.9}" r="${Math.min(w, h) * 0.22}" fill="#000000" opacity="0.06"/>` +
    `<text x="50%" y="52%" font-size="${Math.round(Math.min(w, h) * 0.42)}" text-anchor="middle" dominant-baseline="central" opacity="0.92">${art.emoji}</text>` +
    `</svg>`;
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------- 缓存 + 并发队列 ----------------

interface CacheEntry {
  buf: Buffer;
  at: number;
}
const imgCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GenResult>>();
const ffLists = new Map<string, { urls: string[]; at: number; failedAt?: number }>();
const pxLists = new Map<string, { urls: string[]; at: number; failedAt?: number }>();
/** per-分类轮换指针：同分类顺序取图（不重复太频繁），进程启动带随机初值（跨重启换图） */
const cursor = new Map<string, number>();
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
  if (w) w(); // 槽位直接移交，active 不变
  else active--;
}

function cacheSet(key: string, buf: Buffer): void {
  imgCache.set(key, { buf, at: Date.now() });
  if (imgCache.size > MAX_CACHE) {
    const evict = Math.ceil(MAX_CACHE / 6);
    let i = 0;
    for (const k of imgCache.keys()) {
      imgCache.delete(k);
      if (++i >= evict) break;
    }
  }
}

function cacheGet(key: string): Buffer | null {
  const e = imgCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > IMG_TTL) {
    imgCache.delete(key); // 过期：下次请求轮换一张新图（每次刷新可换）
    return null;
  }
  return e.buf;
}

/** 分类池轮换取图：顺序推进指针（同分类换图、不重复太频繁） */
function pickFrom(list: string[], poolKey: string): string | null {
  if (list.length === 0) return null;
  let c = cursor.get(poolKey);
  if (c === undefined) c = Math.floor(Math.random() * list.length);
  const url = list[c % list.length];
  cursor.set(poolKey, (c + 1) % list.length);
  return url;
}

// ---------------- ① Foodiesfeed（CC0） ----------------

/** 从 Foodiesfeed 搜索结果页解析图片直链列表（RSC payload 里的转义斜杠先归一） */
function parseFfUrls(html: string): string[] {
  const t = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const set = new Set<string>();
  const re = /https:\/\/pub-[a-z0-9]+\.r2\.dev\/[a-z]+\/thumbnails\/[a-zA-Z0-9/_.-]+\.webp/g;
  for (const m of t.matchAll(re)) set.add(m[0]);
  return [...set];
}

/** Node fetch 的 TLS 指纹被 Cloudflare 拦（403 挑战页），但 curl 指纹可通过 ——
 *  搜索页用 curl 子进程（每分类 6h 仅一次），图片下载走 Node fetch（R2 直链不拦）。 */
function curlText(url: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sL', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', FF_UA, '-H', 'Accept: text/html,*/*', url],
      { timeout: timeoutMs + 2_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout.toString('utf8'));
      },
    );
  });
}

/** curl 下载二进制（图库对 Node fetch 按 TLS 指纹拦截，图片下载同样走 curl 子进程）。
 *  魔数校验：Wikimedia 偶尔对高频请求返回 200+HTML 错误页，非图片字节直接拒绝走下一张。 */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 500) return false;
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return true;
  return false;
}

function curlBytes(url: string, timeoutMs = 15_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sL', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', FF_UA, url],
      { timeout: timeoutMs + 2_000, maxBuffer: 24 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const buf = stdout;
        if (!looksLikeImage(buf)) {
          reject(new Error(`curl 非图片响应（${buf ? buf.byteLength : 0}B）`));
          return;
        }
        resolve(buf);
      },
    );
  });
}

async function ffSearchUrls(kw: string): Promise<string[]> {
  const rec = ffLists.get(kw);
  const now = Date.now();
  if (rec) {
    if (rec.urls.length >= MIN_POOL && now - rec.at < LIST_TTL) return rec.urls;
    if (rec.failedAt && now - rec.failedAt < LIST_NEG_TTL) return []; // 刚失败过：60s 内不再打图库
  }
  let urls: string[] = [];
  try {
    // curl 指纹优先（Node fetch 被 CF 拦）；curl 不可用再试 Node fetch 兑底
    let html: string;
    try {
      html = await curlText(`${FF_BASE}${encodeURIComponent(kw)}`);
    } catch {
      const res = await fetch(`${FF_BASE}${encodeURIComponent(kw)}`, {
        signal: AbortSignal.timeout(12_000),
        headers: { 'User-Agent': FF_UA, Accept: 'text/html,*/*' },
      });
      if (!res.ok) throw new Error(`foodiesfeed ${res.status}`);
      html = await res.text();
    }
    urls = parseFfUrls(html);
    urls = filterPool(urls, kw);
    if (urls.length < MIN_POOL) throw new Error(`foodiesfeed 命中不足（${urls.length}）`);
    ffLists.set(kw, { urls, at: now });
    return urls;
  } catch {
    ffLists.set(kw, { urls: rec?.urls ?? [], at: rec?.at ?? 0, failedAt: now });
    return rec?.urls ?? [];
  }
}

// ---------------- ② Wikimedia Commons（免 key，奶茶/酒店/娱乐实景） ----------------

const cmLists = new Map<string, { urls: string[]; at: number; failedAt?: number }>();

/** Commons 搜索：返回缩略图直链（thumburl 带 utm 参数已剥除，可直接下载） */
async function commonsSearchUrls(q: string): Promise<string[]> {
  const rec = cmLists.get(q);
  const now = Date.now();
  if (rec) {
    if (rec.urls.length >= MIN_POOL && now - rec.at < LIST_TTL) return rec.urls;
    if (rec.failedAt && now - rec.failedAt < LIST_NEG_TTL) return [];
  }
  try {
    const api = `${COMMONS_API}?action=query&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&gsrlimit=40&gsrnamespace=6&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=1200&format=json`;
    const raw = await curlText(api);
    const j = JSON.parse(raw) as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; mime?: string }> }> };
    };
    const urls: string[] = [];
    const seen = new Set<string>();
    const requireRe = COMMONS_REQUIRE[q];
    const excludeRe = COMMONS_EXCLUDE[q];
    for (const page of Object.values(j.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const thumb = info?.thumburl?.split('?')[0];
      if (!thumb || seen.has(thumb)) continue;
      if (!/^image\/(jpeg|png|webp)$/.test(info?.mime ?? '')) continue;
      if (COMMONS_TITLE_EXCLUDE.test(page.title ?? '')) continue;
      if (requireRe && !requireRe.test(page.title ?? '')) continue;
      if (excludeRe && excludeRe.test(page.title ?? '')) continue;
      seen.add(thumb);
      urls.push(thumb);
    }
    if (urls.length < MIN_POOL) throw new Error(`commons 命中不足（${urls.length}）`);
    cmLists.set(q, { urls, at: now });
    return urls;
  } catch {
    cmLists.set(q, { urls: rec?.urls ?? [], at: rec?.at ?? 0, failedAt: now });
    return rec?.urls ?? [];
  }
}

// ---------------- ②.5 TheMealDB（免 key 菜品实景：Foodiesfeed 失败时的食物兜底池） ----------------

const mdbLists = new Map<string, { urls: string[]; at: number; failedAt?: number }>();

/** TheMealDB 免费接口（开发测试 key=1，无需注册）：按英文菜名搜真实菜品照片直链。
 *  只在 FF 搜索词（食物域）失败后启用；非食物词搜不到自动负缓存跳过。 */
async function mealdbSearchUrls(kw: string): Promise<string[]> {
  const rec = mdbLists.get(kw);
  const now = Date.now();
  if (rec) {
    if (rec.urls.length >= MIN_POOL && now - rec.at < LIST_TTL) return rec.urls;
    if (rec.failedAt && now - rec.failedAt < LIST_NEG_TTL) return [];
  }
  try {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(kw.replace(/-/g, ' '))}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`themealdb ${res.status}`);
    const j: unknown = await res.json();
    const meals = (j as { meals?: Array<{ strMealThumb?: string }> | null }).meals ?? [];
    const urls = meals
      .map((m) => (m.strMealThumb ?? '').trim())
      .filter((u) => /^https:\/\/www\.themealdb\.com\/images\/media\/meals\/[a-z0-9]+\.jpg$/.test(u));
    if (urls.length < MIN_POOL) throw new Error(`themealdb 命中不足（${urls.length}）`);
    mdbLists.set(kw, { urls, at: now });
    return urls;
  } catch {
    mdbLists.set(kw, { urls: rec?.urls ?? [], at: rec?.at ?? 0, failedAt: now });
    return rec?.urls ?? [];
  }
}

// ---------------- ③ Pixabay / Pexels（配置 key 才启用） ----------------

const PIXABAY_KEY = process.env.PIXABAY_KEY ?? '';
const PEXELS_KEY = process.env.PEXELS_KEY ?? '';
async function stockSearchUrls(kw: string): Promise<string[]> {
  const rec = pxLists.get(kw);
  const now = Date.now();
  if (rec) {
    if (rec.urls.length >= MIN_POOL && now - rec.at < LIST_TTL) return rec.urls;
    if (rec.failedAt && now - rec.failedAt < LIST_NEG_TTL) return [];
  }
  const q = kw.replace(/-/g, ' ');
  const urls: string[] = [];
  try {
    if (PIXABAY_KEY) {
      const res = await fetch(
        `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(q)}&image_type=photo&category=food&per_page=20&safesearch=true`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const j: unknown = await res.json();
        const hits = (j as { hits?: Array<{ largeImageURL?: string; webformatURL?: string }> }).hits ?? [];
        for (const h of hits) {
          const u = h.largeImageURL ?? h.webformatURL;
          if (u) urls.push(u);
        }
      }
    } else if (PEXELS_KEY) {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=20`, {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: PEXELS_KEY },
      });
      if (res.ok) {
        const j: unknown = await res.json();
        const photos = (j as { photos?: Array<{ src?: { large?: string; large2x?: string } }> }).photos ?? [];
        for (const p of photos) {
          const u = p.src?.large ?? p.src?.large2x;
          if (u) urls.push(u);
        }
      }
    }
  } catch {
    // 图库失败 → 负缓存后走默认图
  }
  if (urls.length >= MIN_POOL) {
    pxLists.set(kw, { urls, at: now });
    return urls;
  }
  pxLists.set(kw, { urls: rec?.urls ?? [], at: rec?.at ?? 0, failedAt: now });
  return rec?.urls ?? [];
}

// ---------------- ⑤ LLM 搜索词（未知品类：内置模型译英文短语 → Commons 实景，免 AI 生图） ----------------

const LLM_TAG_TTL = 6 * 3600_000;
const llmTagCache = new Map<string, { q: string | null; at: number }>();
const llmTagInflight = new Map<string, Promise<string | null>>();

/** 内置模型把任意品类词（如「flower-shop」「3c」）译成 Wikimedia Commons 英文搜索短语（1~4 个英文词）。
 *  结果按 tag 缓存 6h；同一 tag 并发去重；失败返回 null（落默认图）。 */
async function llmCommonsQuery(tag: string): Promise<string | null> {
  const hit = llmTagCache.get(tag);
  if (hit && Date.now() - hit.at < LLM_TAG_TTL) return hit.q;
  const running = llmTagInflight.get(tag);
  if (running) return running;
  const task = (async (): Promise<string | null> => {
    try {
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'assistant',
            content:
              'You translate commerce/scene category words into short English image-search phrases for Wikimedia Commons photo search. Reply with ONLY the phrase: 1-4 plain English words, lowercase, no punctuation, no explanation. Prefer concrete everyday visual scenes over abstract concepts.',
          },
          { role: 'user', content: tag.replace(/-+/g, ' ').slice(0, 30) },
        ],
        thinking: { type: 'disabled' },
      });
      const raw = (completion.choices[0]?.message?.content ?? '')
        .toLowerCase()
        .replace(/[^a-z ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const q = /^[a-z]{2,}( [a-z]{2,}){0,3}$/.test(raw) ? raw : null;
      llmTagCache.set(tag, { q, at: Date.now() });
      return q;
    } catch {
      llmTagCache.set(tag, { q: null, at: Date.now() }); // 负缓存：同一 tag 6h 内不再重试打模型
      return null;
    } finally {
      llmTagInflight.delete(tag);
    }
  })();
  llmTagInflight.set(tag, task);
  return task;
}

// ---------------- sharp 按展示尺寸裁剪压缩（内存流转，不落盘） ----------------

interface SharpLike {
  (buf: Buffer): {
    resize: (w: number, h: number, o: { fit: string; position?: number }) => {
      webp: (o: { quality: number }) => { toBuffer: () => Promise<Buffer> };
    };
  };
  strategy?: { attention?: number };
}
let sharpFn: SharpLike | null | undefined;
async function getSharp(): Promise<SharpLike | null> {
  if (sharpFn !== undefined) return sharpFn;
  try {
    const m = await import('sharp');
    sharpFn = (m.default ?? (m as unknown as SharpLike)) as unknown as SharpLike;
  } catch {
    sharpFn = null; // 无 sharp：原样转发（webp 已是 1200 宽，展示端 object-cover 裁剪）
  }
  return sharpFn;
}

async function shrink(buf: Buffer, w: number, h: number): Promise<Buffer> {
  const sharp = await getSharp();
  if (!sharp) return buf;
  try {
    // attention：裁剪聚焦主体（食物特写居中效果更好）；旧版无 strategy 时退回 centre
    const opt = sharp.strategy?.attention !== undefined ? { fit: 'cover', position: sharp.strategy.attention } : { fit: 'cover' };
    // 必须显式 toBuffer()：.webp() 只返回 Sharp thenable，直接 await 拿到的不是 Buffer
    const out = await sharp(buf)
      .resize(w, h, opt)
      .webp({ quality: 78 })
      .toBuffer();
    return Buffer.isBuffer(out) && out.byteLength > 100 ? out : buf;
  } catch {
    return buf; // 坏图/格式异常：原样返回
  }
}

// ---------------- 取图链 ----------------

type GenResult = { buf: Buffer };

/** Commons 取图：搜索池轮换，单张下载失败自动换池内下一张（最多试 3 张） */
async function tryCommons(q: string, w: number, h: number): Promise<Buffer | null> {
  const urls = await commonsSearchUrls(q);
  if (urls.length < MIN_POOL) return null;
  let c = cursor.get(`cm:${q}`);
  if (c === undefined) c = Math.floor(Math.random() * urls.length);
  cursor.set(`cm:${q}`, (c + 3) % urls.length);
  for (let i = 0; i < 3; i++) {
    const pick = urls[(c + i) % urls.length];
    try {
      const raw = await curlBytes(pick);
      const out = await shrink(raw, w, h);
      if (Buffer.isBuffer(out) && out.byteLength > 500) return out;
    } catch {
      // 单张失败（429/HTML错误页/坏图）→ 换池内下一张
    }
  }
  return null;
}

async function genBytes(tag: string, w: number, h: number): Promise<GenResult> {
  // FF/stock 只对「有 FF 映射」的 tag 生效：酒店/电玩/KTV 等非食物 tag 绝不落食物池（宁走默认图）
  const ffMapped = FF_SEARCH[tag] !== undefined || TAG_SYNONYMS[tag] !== undefined;
  const kw = ffKeywordOf(tag);
  const commonsQ = COMMONS_SEARCH[tag] ?? null;
  const commonsFirst = COMMONS_FIRST.has(tag);

  // ① Commons 优先类（奶茶/酒店/影院/娱乐等）：真品类池直取
  if (commonsFirst && commonsQ) {
    const buf = await tryCommons(commonsQ, w, h);
    if (buf) return { buf };
  }

  // ② Foodiesfeed（CC0，按分类关键词搜索 + 轮换）
  if (ffMapped) {
    const urls = await ffSearchUrls(kw);
    if (urls.length >= MIN_POOL) {
      const pick = pickFrom(urls, `ff:${kw}`);
      if (pick) {
        try {
          const raw = await curlBytes(pick);
          const out = await shrink(raw, w, h);
          if (Buffer.isBuffer(out) && out.byteLength > 500) return { buf: out };
        } catch {
          // 单张失败 → 走下一级
        }
      }
    }
  }

  // ②.5 TheMealDB（免 key 菜品实景：FF 池不可用时的食物兜底）
  if (ffMapped) {
    const urls = await mealdbSearchUrls(kw);
    if (urls.length >= MIN_POOL) {
      const pick = pickFrom(urls, `mdb:${kw}`);
      if (pick) {
        try {
          const raw = await curlBytes(pick);
          const out = await shrink(raw, w, h);
          if (Buffer.isBuffer(out) && out.byteLength > 500) return { buf: out };
        } catch {
          // 单张失败 → 走下一级
        }
      }
    }
  }

  // ③ Pixabay / Pexels（环境变量配置 key 才启用；未配置跳过）
  if (ffMapped && (PIXABAY_KEY || PEXELS_KEY)) {
    const urls = await stockSearchUrls(kw);
    if (urls.length >= MIN_POOL) {
      const pick = pickFrom(urls, `px:${kw}`);
      if (pick) {
        try {
          const raw = await curlBytes(pick);
          const out = await shrink(raw, w, h);
          if (Buffer.isBuffer(out) && out.byteLength > 500) return { buf: out };
        } catch {
          // 单张失败 → 走下一级
        }
      }
    }
  }

  // ③.5 Commons 兑底（食物类 tag FF/stock 都失败时，用同词在 Commons 搜实景）
  if (!commonsFirst && commonsQ) {
    const buf = await tryCommons(commonsQ, w, h);
    if (buf) return { buf };
  }

  // ⑤ 未知品类（无任何映射）：内置模型译英文搜索短语 → Commons 实景（一次性开销，按 tag 缓存 6h）
  if (!commonsQ) {
    const q = await llmCommonsQuery(tag);
    if (q) {
      const buf = await tryCommons(q, w, h);
      if (buf) return { buf };
    }
  }

  // ④ 默认图（本地算法图：分类配色 + emoji SVG，永远成功）
  throw new Error('fall-to-default');
}

// ---------------- 高频 tag 预热（每次图片请求后后台预取热词池，滑到对应卡片时命中字节缓存秒出） ----------------

const WARM_TAGS = [
  'food', 'store', 'milk-tea', 'bubble-tea', 'pizza', 'burger', 'coffee', 'fruit', 'medicine', 'hotel',
  'noodles', 'hot-pot', 'dessert', 'rice', 'spicy', 'supermarket', 'flower', 'pill', 'syrup', 'breakfast',
];
let warmPos = 0;

function warmNext(): void {
  const t = WARM_TAGS[warmPos % WARM_TAGS.length];
  const key = `${t}|480x360|0|v10`;
  warmPos++;
  if (cacheGet(key) || inflight.has(key)) return;
  const p = acquire()
    .then(() => genBytes(t, 480, 360))
    .finally(release);
  inflight.set(key, p);
  p.catch(() => undefined).finally(() => inflight.delete(key));
}

// ---------------- 路由 ----------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tag = tagOf(sp.get('k'));
  const w = intOf(sp.get('w'), 400, 100, 800);
  const h = intOf(sp.get('h'), 400, 100, 800);
  const s = intOf(sp.get('s'), 0, 0, 999);
  // d=1：强制默认图（本地算法插画直出，跳过图库链与缓存）——「我的→图片样式=默认图片」模式由前端改写 URL 使用
  if (sp.get('d') === '1') return defaultArtSvg(tag, w, h);
  // v=链路版本：升级后浏览器旧缓存自然失效（URL 变了）
  const key = `${tag}|${w}x${h}|${s}|v10`;

  const hit = cacheGet(key);
  if (hit) {
    try {
      return webp(hit);
    } catch {
      imgCache.delete(key); // 缓存条目异常：剔除后重新取图
    }
  }

  // 同 key 并发去重：进行中的任务直接等它（信息流 burst 同图只取一次）
  const running = inflight.get(key);
  if (running) {
    try {
      return webp((await running).buf);
    } catch {
      return defaultArtSvg(tag, w, h);
    }
  }

  const t = acquire()
    .then(() => genBytes(tag, w, h))
    .finally(release);
  inflight.set(key, t);
  // 先挂 catch 防 unhandledRejection，再异步清理 inflight
  t.catch(() => undefined).finally(() => inflight.delete(key));

  try {
    const r = await t;
    cacheSet(key, r.buf);
    // 预热：本次请求完成后后台预取 2 个高频 tag（借用并发队列，不抢用户请求）
    setTimeout(() => {
      try {
        warmNext();
        warmNext();
      } catch {
        /* 预热失败不影响主链路 */
      }
    }, 200);
    return webp(r.buf);
  } catch {
    return defaultArtSvg(tag, w, h); // 兜底：任何情况都有图
  }
}

function webp(buf: Buffer): NextResponse {
  // Buffer.from 拷贝：Next.js 会 wrap 成 stream 消费，直接复用同一 Buffer 二次响应时报 disturbed/locked
  return new NextResponse(Buffer.from(buf) as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/webp',
      // 15min 强缓存（与字节缓存同步）：期内稳定秒出，过期自动换图
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600',
    },
  });
}
