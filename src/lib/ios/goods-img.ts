/**
 * 淘宝/美团本地卡通商品图（Task 58 引入链路，Task 59 修复落盘）：
 *
 * - 全站商品图/菜品图/门头图统一使用本地 kawaii 卡通插画（public/goods/*.webp，
 *   由 scripts/gen-goods-svg.ts 手绘 SVG 矢量插画经 sharp 栅格化产出，67 张全覆盖；
 *   风格：暖棕描边 + 腮红 + 粉彩底，零外部图库/外部 API 依赖）；
 * - mtGoodsImg：美团菜品/门头 tag → 本地图（TAG_RULES 命中的全量 tag + 长尾近似归并）；
 *   tbGoodsImg：淘宝商品 tag → 本地图（TB_PRODUCTS 全量 tag）；
 * - 同一 tag 固定同一张图（订单叫什么显示什么图，稳定不闪变）；s 变体参数保留兼容
 *   （商品详情多图同图展示）；未知 tag 走大类兜底，任何情况都有图可显示。
 */

/** 本地图路径 */
function g(file: string): string {
  return `/goods/${file}.webp`;
}

// ---------------- 美团：菜品 tag → 本地卡通图 ----------------

const MT_FOOD: Record<string, string> = {
  'milk-tea': g('mt-milk-tea'),
  tea: g('mt-tea'),
  burger: g('mt-burger'),
  'fried-chicken': g('mt-fried-chicken'),
  pizza: g('mt-pizza'),
  hotpot: g('mt-hotpot'),
  noodles: g('mt-noodles'),
  rice: g('mt-rice'),
  dessert: g('mt-dessert'),
  'ice-cream': g('mt-ice-cream'),
  coffee: g('mt-coffee'),
  juice: g('mt-juice'),
  fruit: g('mt-fruit'),
  breakfast: g('mt-breakfast'),
  dumplings: g('mt-dumplings'),
  sushi: g('mt-sushi'),
  barbecue: g('mt-barbecue'),
  'chinese-food': g('mt-chinese-food'),
  seafood: g('mt-seafood'),
  beef: g('mt-beef'),
  salad: g('mt-salad'),
  soup: g('mt-soup'),
  cola: g('mt-cola'),
  egg: g('mt-egg'),
  milk: g('mt-milk'),
  medicine: g('mt-medicine'),
  flower: g('mt-flower'),
  store: g('mt-store'),
  // 出行/文旅订单（机票/火车票/酒店/电影演出——订单图不再兑成菜品）
  flight: g('mt-flight'),
  train: g('mt-train'),
  hotel: g('mt-hotel'),
  movie: g('mt-movie'),
};

/** 美团长尾 tag 归并（TAG_RULES 兜底词 / AI 动态菜 → 近似品类图） */
const MT_FOOD_ALIAS: Record<string, string> = {
  // 出行/文旅长尾
  plane: 'flight',
  airplane: 'flight',
  jipiao: 'flight',
  highspeed: 'train',
  rail: 'train',
  huochepiao: 'train',
  homestay: 'hotel',
  minsu: 'hotel',
  jiudian: 'hotel',
  cinema: 'movie',
  dianying: 'movie',
  show: 'movie',
  ticket: 'movie',
  // 饮品
  milkshake: 'milk-tea',
  suanmeitang: 'juice',
  syrup: 'medicine',
  // 甜品烘焙
  'egg-tart': 'dessert',
  sundae: 'ice-cream',
  bread: 'breakfast',
  sandwich: 'breakfast',
  porridge: 'breakfast',
  // 蛋类
  eggs: 'egg',
  'quail-egg': 'egg',
  // 肉类
  pork: 'beef',
  lamb: 'beef',
  duck: 'beef',
  steak: 'beef',
  // 家常菜
  tofu: 'chinese-food',
  potato: 'chinese-food',
  // 粉面
  kuanfen: 'noodles',
  'suancai-noodle': 'noodles',
  // 水果
  cherry: 'fruit',
  kiwi: 'fruit',
  banana: 'fruit',
  mandarin: 'fruit',
  'fruit-mix': 'fruit',
  // 小吃
  fries: 'burger',
  chips: 'burger',
  spicy: 'hotpot',
  braised: 'hotpot',
  // 异域
  curry: 'rice',
  thai: 'rice',
  asian: 'rice',
  japanese: 'sushi',
  // 轻食日用
  gym: 'salad',
  sanitizer: 'medicine',
  bandage: 'medicine',
  mask: 'medicine',
  vitamin: 'medicine',
  pill: 'medicine',
  tissue: 'store',
};

/** 美团门头：品类 tag → 店面卡通图 */
const MT_STOREFRONT: Record<string, string> = {
  medicine: g('shop-pharmacy'),
  breakfast: g('shop-breakfast'),
  coffee: g('shop-coffee'),
  'milk-tea': g('shop-milktea'),
  tea: g('shop-milktea'),
  milkshake: g('shop-milktea'),
  dessert: g('shop-milktea'),
  'ice-cream': g('shop-milktea'),
  // 酒店/电影/休闲/未知频道门头
  hotel: g('mt-hotel'),
  movie: g('mt-movie'),
  dianying: g('mt-movie'),
  flight: g('mt-flight'),
  train: g('mt-train'),
  yiliao: g('shop-pharmacy'),
  maiyao: g('shop-pharmacy'),
};

/** 美团菜品/门头图（mtImg 代理）：kind='f' 菜品 / 'c' 门头 */
export function mtGoodsImg(tag: string, kind: 'f' | 'c' = 'f'): string {
  const t = (tag || '').toLowerCase();
  if (kind === 'c') {
    return MT_STOREFRONT[t] ?? MT_FOOD_ALIAS[t] ?? g('shop-food');
  }
  return MT_FOOD[t] ?? MT_FOOD_ALIAS[t] ?? g('mt-chinese-food');
}

// ---------------- 淘宝：商品 tag → 本地卡通图 ----------------

const TB_GOODS: Record<string, string> = {
  phone: g('tb-phone'),
  earbuds: g('tb-earbuds'),
  laptop: g('tb-laptop'),
  tablet: g('tb-tablet'),
  watch: g('tb-watch'),
  keyboard: g('tb-keyboard'),
  speaker: g('tb-speaker'),
  powerbank: g('tb-powerbank'),
  camera: g('tb-camera'),
  lock: g('tb-lock'),
  fridge: g('tb-fridge'),
  washer: g('tb-washer'),
  tshirt: g('tb-tshirt'),
  jeans: g('tb-jeans'),
  dress: g('tb-dress'),
  jacket: g('tb-jacket'),
  hoodie: g('tb-hoodie'),
  coat: g('tb-coat'),
  shirt: g('tb-shirt'),
  hat: g('tb-hat'),
  sneakers: g('tb-sneakers'),
  shoes: g('tb-sneakers'),
  backpack: g('tb-backpack'),
  gift: g('tb-gift'),
  kiosk: g('tb-kiosk'),
  temple: g('tb-temple'),
  lipstick: g('tb-lipstick'),
  perfume: g('tb-perfume'),
  skincare: g('tb-skincare'),
  makeup: g('tb-makeup'),
  sofa: g('tb-sofa'),
  bedding: g('tb-bedding'),
  lamp: g('tb-lamp'),
  mug: g('tb-mug'),
  vase: g('tb-vase'),
  pillow: g('tb-pillow'),
  desk: g('tb-desk'),
  toy: g('tb-toy'),
  umbrella: g('tb-umbrella'),
  'water-bottle': g('tb-water-bottle'),
  snacks: g('tb-snacks'),
  cookies: g('tb-cookies'),
  tea: g('tb-tea'),
  books: g('tb-books'),
  book: g('tb-books'),
  // Task 61 全品类扩展（42 张新插画，与 tb-product-gen.ts 品类目录 1:1 对齐）
  'phone-stand': g('tb-phone-stand'),
  mouse: g('tb-mouse'),
  monitor: g('tb-monitor'),
  tv: g('tb-tv'),
  drone: g('tb-drone'),
  gamepad: g('tb-gamepad'),
  fan: g('tb-fan'),
  microwave: g('tb-microwave'),
  'rice-cooker': g('tb-rice-cooker'),
  vacuum: g('tb-vacuum'),
  kettle: g('tb-kettle'),
  'air-fryer': g('tb-air-fryer'),
  'coffee-machine': g('tb-coffee-machine'),
  humidifier: g('tb-humidifier'),
  shaver: g('tb-shaver'),
  toothbrush: g('tb-toothbrush'),
  hairdryer: g('tb-hairdryer'),
  belt: g('tb-belt'),
  scarf: g('tb-scarf'),
  socks: g('tb-socks'),
  shorts: g('tb-shorts'),
  suitcase: g('tb-suitcase'),
  wallet: g('tb-wallet'),
  sunglasses: g('tb-sunglasses'),
  brush: g('tb-brush'),
  'face-mask': g('tb-face-mask'),
  curtain: g('tb-curtain'),
  towel: g('tb-towel'),
  storage: g('tb-storage'),
  carpet: g('tb-carpet'),
  slippers: g('tb-slippers'),
  blocks: g('tb-blocks'),
  'toy-car': g('tb-toy-car'),
  puzzle: g('tb-puzzle'),
  pen: g('tb-pen'),
  notebook: g('tb-notebook'),
  guitar: g('tb-guitar'),
  basketball: g('tb-basketball'),
  'yoga-mat': g('tb-yoga-mat'),
  dumbbell: g('tb-dumbbell'),
  lunchbox: g('tb-lunchbox'),
  pet: g('tb-pet'),
  // 与美团共享品类（首页食品频道/AI 商品跨类复用）
  fruit: g('mt-fruit'),
  flower: g('mt-flower'),
};

/** 淘宝长尾 tag 归并（AI 生成商品 tag → 近似品类图） */
const TB_GOODS_ALIAS: Record<string, string> = {
  // 数码
  phonecase: 'phone',
  'phone-case': 'phone',
  smartphone: 'phone',
  cellphone: 'phone',
  computer: 'laptop',
  headphones: 'earbuds',
  earphone: 'earbuds',
  charger: 'powerbank',
  mousepad: 'mouse',
  projector: 'monitor',
  'selfie-stick': 'phone-stand',
  tripod: 'phone-stand',
  soundbox: 'speaker',
  // 服饰
  clothes: 'tshirt',
  blouse: 'shirt',
  overcoat: 'coat',
  sweater: 'coat',
  pants: 'jeans',
  trousers: 'jeans',
  skirt: 'dress',
  cap: 'hat',
  beanie: 'hat',
  bag: 'backpack',
  handbag: 'backpack',
  luggage: 'suitcase',
  present: 'gift',
  'gift-box': 'gift',
  glasses: 'sunglasses',
  slipper: 'slippers',
  sock: 'socks',
  short: 'shorts',
  // 家居电器
  furniture: 'sofa',
  bed: 'bedding',
  'water-cup': 'mug',
  cup: 'mug',
  bottle: 'water-bottle',
  doorlock: 'lock',
  'smart-lock': 'lock',
  smartlock: 'lock',
  refrigerator: 'fridge',
  'washing-machine': 'washer',
  washingmachine: 'washer',
  appliance: 'fridge',
  television: 'tv',
  sweeper: 'vacuum',
  'vacuum-cleaner': 'vacuum',
  airfryer: 'air-fryer',
  coffeemaker: 'coffee-machine',
  espresso: 'coffee-machine',
  'facial-mask': 'face-mask',
  'face-mask-sheet': 'face-mask',
  // 玩具/运动
  toydoll: 'toy',
  'rc-car': 'toy-car',
  toycar: 'toy-car',
  lego: 'blocks',
  'building-blocks': 'blocks',
  football: 'basketball',
  soccer: 'basketball',
  dumbbells: 'dumbbell',
  // 文具
  stationery: 'pen',
  journal: 'notebook',
  // 美妆
  cosmetics: 'makeup',
  makeup2: 'makeup',
  // 食品
  food: 'snacks',
  snack: 'snacks',
  milk: 'mt-milk',
  'milk-tea': 'mt-milk-tea',
  burger: 'mt-burger',
  pizza: 'mt-pizza',
  hotpot: 'mt-hotpot',
  noodles: 'mt-noodles',
  rice: 'mt-rice',
  dessert: 'mt-dessert',
  'ice-cream': 'mt-ice-cream',
  coffee: 'mt-coffee',
  juice: 'mt-juice',
  breakfast: 'mt-breakfast',
  dumplings: 'mt-dumplings',
  sushi: 'mt-sushi',
  barbecue: 'mt-barbecue',
  'chinese-food': 'mt-chinese-food',
  seafood: 'mt-seafood',
  beef: 'mt-beef',
  salad: 'mt-salad',
  soup: 'mt-soup',
  cola: 'mt-cola',
  egg: 'mt-egg',
  medicine: 'mt-medicine',
  store: 'mt-store',
};

/** 淘宝商品/店铺门头图（tbImg 代理）：门头直接用对应商品图 */
export function tbGoodsImg(tag: string, kind: 'f' | 'c' = 'f'): string {
  const t = (tag || '').toLowerCase();
  void kind; // 淘宝店铺封面复用商品图（同 tag 同图）
  return TB_GOODS[t] ?? TB_GOODS_ALIAS[t] ?? g('tb-snacks');
}

/** 历史 /api/mt-img 链接迁移（Task 58 之前持久化的订单/购物车/收藏等存的是旧图链 URL）：
 *  解析 k/p 参数重映射到本地卡通图；非旧链原样返回 */
export function legacyImgUrl(src: string | undefined, ctx: 'mt' | 'tb'): string | undefined {
  if (!src || !src.startsWith('/api/mt-img?')) return src;
  try {
    const sp = new URLSearchParams(src.slice(src.indexOf('?') + 1));
    const k = sp.get('k') ?? '';
    const kind = sp.get('p') === 'c' ? 'c' : 'f';
    return ctx === 'mt' ? mtGoodsImg(k, kind) : tbGoodsImg(k, kind);
  } catch {
    return ctx === 'mt' ? g('mt-chinese-food') : g('tb-snacks');
  }
}
