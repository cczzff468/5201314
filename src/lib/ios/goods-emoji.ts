/**
 * 商品图 emoji 样式（第六十四轮）：
 *
 * - GOODS_EMOJI：品类 tag → emoji 映射（淘宝/美团全品类 + 菜品 + 出行文旅；从
 *   tb-img.tsx 的兜底映射抽出共享，FoodImg/TbImg 的 emoji 样式与图挂兜底共用一份）；
 * - goodsEmojiOf：本地商品图路径（/goods/X.webp、/goods-sketch/X.webp）→ 品类 emoji；
 * - SKETCH_IMG_PREFIX：简笔画样式图目录（scripts/gen-sketch-goods.ts 产出，同名一一对应）。
 */

/** 简笔画线稿目录（与 /goods/ 同名文件，样式切换只换目录前缀） */
export const SKETCH_IMG_PREFIX = '/goods-sketch/';

/** 品类 tag → emoji（key 不含 tb-/mt- 前缀；菜品/出行 tag 与美团共享） */
export const GOODS_EMOJI: Record<string, string> = {
  // 数码
  phone: '📱', earbuds: '🎧', laptop: '💻', tablet: '📱', watch: '⌚', keyboard: '⌨️',
  speaker: '🔊', powerbank: '🔋', camera: '📷', lock: '🔒',
  'phone-stand': '📱', mouse: '🖱️', monitor: '🖥️', tv: '📺', drone: '🛸', gamepad: '🎮',
  // 家电
  fridge: '🧊', washer: '🧺', fan: '🌀', vacuum: '🧹', microwave: '🍲', 'rice-cooker': '🍚',
  kettle: '🫖', 'air-fryer': '🍟', 'coffee-machine': '☕', humidifier: '💧', shaver: '🪒',
  toothbrush: '🪥', hairdryer: '💨',
  // 服饰
  tshirt: '👕', jeans: '👖', dress: '👗', jacket: '🧥', hoodie: '🧥', coat: '🧥', shirt: '👔',
  hat: '🧢', sneakers: '👟', shoes: '👟', backpack: '🎒', belt: '🪢', scarf: '🧣', socks: '🧦',
  shorts: '🩳', suitcase: '🧳', wallet: '👛', sunglasses: '🕶️', slippers: '🩴',
  // 美妆
  lipstick: '💄', perfume: '🌸', skincare: '🧴', makeup: '💅', brush: '🖌️', 'face-mask': '🧖',
  // 家居
  sofa: '🛋️', bedding: '🛏️', lamp: '💡', mug: '☕', vase: '🏺', pillow: '🛏️', desk: '🪑',
  curtain: '🪟', towel: '🛁', storage: '📦', carpet: '🧶', lunchbox: '🍱',
  // 其他
  toy: '🧸', umbrella: '☂️', 'water-bottle': '🥤', snacks: '🍿', cookies: '🍪', tea: '🍵',
  books: '📚', book: '📚', fruit: '🍎', flower: '💐', gift: '🎁', kiosk: '🏧', temple: '⛩️',
  blocks: '🧱', 'toy-car': '🚗', puzzle: '🧩', pen: '🖊️', notebook: '📔', guitar: '🎸',
  basketball: '🏀', 'yoga-mat': '🧘', dumbbell: '🏋️', pet: '🐾',
  // 美团菜品（淘宝 AI 商品跨类复用）
  'milk-tea': '🧋', burger: '🍔', 'fried-chicken': '🍗', pizza: '🍕', hotpot: '🍲', noodles: '🍜',
  rice: '🍚', dessert: '🍰', 'ice-cream': '🍦', coffee: '☕', juice: '🧃', milk: '🥛', egg: '🍳',
  breakfast: '🍞', dumplings: '🥟', sushi: '🍣', barbecue: '🍢', 'chinese-food': '🥘', seafood: '🦀',
  beef: '🥩', salad: '🥗', soup: '🥣', cola: '🥤', medicine: '💊', store: '🛍️',
  // 出行/文旅（机票/火车票/酒店/电影演出订单图）
  flight: '✈️', train: '🚄', hotel: '🏨', movie: '🎬', plane: '✈️', cinema: '🎬',
  // 专属运营位图（第六十五轮：美团工作兼职 / 淘宝红包商品图样式卡）
  job: '🛵', hongbao: '🧧',
};

/** 本地商品图路径（/goods/X.webp 或 /goods-sketch/X.webp）→ 品类 emoji；非本地图返回 undefined */
export function goodsEmojiOf(src: string | undefined): string | undefined {
  const m = src?.match(/\/goods(?:-sketch)?\/([a-z0-9-]+)\.webp/i);
  if (!m) return undefined;
  if (m[1].startsWith('shop-')) return '🏪';
  return GOODS_EMOJI[m[1].replace(/^(tb|mt)-/, '')];
}

/** Emoji 样式的马卡龙底色（按 emoji 哈希取色，列表里多彩但不花哨） */
const EMOJI_PALETTES = [
  'from-[#FFE9E0] to-[#FFD9C8]', // 蜜桃
  'from-[#FFF3D6] to-[#FFE6B3]', // 奶油
  'from-[#E3F2E9] to-[#CDE8D8]', // 抹茶
  'from-[#E8EEFB] to-[#D8E2F8]', // 雾蓝
  'from-[#F6E8F6] to-[#EBD6EE]', // 香芋
];

export function emojiPaletteOf(emoji: string): string {
  let h = 0;
  for (const c of emoji) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return EMOJI_PALETTES[h % EMOJI_PALETTES.length];
}
