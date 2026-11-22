/**
 * 淘宝 App 种子数据（商品/店铺/分类/评价/热门搜索）：
 * - 与 meituan-data.ts 同架构：纯前端静态数据，商品 id 稳定（购物车/订单/收藏/足迹跨重启引用）；
 * - 商品图统一走本地 kawaii 卡通插画（goods-img.ts，Task 58 预生成本地图，不再请求外部图库）；
 * - 商品多图同图展示（s 变体参数保留兼容）；SKU 按类目模板（颜色分类/尺码/版本）。
 */

import { tbGoodsImg } from '@/lib/ios/goods-img';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import type { OrderCustomMeta } from '@/lib/ios/order-custom';

/** 内容匹配图地址（本地卡通图，Task 58）：k=品类词 w/h=尺寸 s=变体 p=f 商品图 / c 门头图（参数保留兼容） */
export function tbImg(tag: string, w = 600, h = 600, s = 0, kind: 'f' | 'c' = 'f'): string {
  void w;
  void h;
  void s;
  return tbGoodsImg(tag, kind);
}

/** 口红质地 × 色号（用户指定，购买弹窗可选；tb-product-gen 生成器共用） */
export const TB_LIP_KINDS = ['唇釉', '口红', '唇泥', '唇膏', '唇蜜'];
export const TB_LIP_COLORS = [
  '蜜桃粉', '樱桃粉', '玫瑰粉', '粉杏色', '裸粉色', '南瓜色', '胡萝卜色', '脏橘色', '肉桂奶茶', '烂番茄', '草莓红',
  '火龙果色', '玫红色', '浅紫色', '浆果梅子色', '奶咖色', '枫叶红', '红棕色', '山楂红', '红茶色', '枣泥红',
];

/** 淘宝主品牌色 */
export const TB_ORANGE = '#FF5000';

// ---------------- 客服头像（第四十轮：牛马打工人表情包，消息页会话/客服聊天页通用） ----------------

/** 5 张客服头像（用户指定：朱队友/牛马/陈遵旨/李来做/刘不住） */
const TB_KEFU_AVATARS = ['/kefu-1.png', '/kefu-2.png', '/kefu-3.png', '/kefu-4.png', '/kefu-5.png'];

/** 店铺 → 客服头像稳定映射（同一店铺永远同一张；key=shopId 或会话名兜底） */
export function tbKefuAvatarOf(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TB_KEFU_AVATARS[h % TB_KEFU_AVATARS.length];
}

// ---------------- 分类 ----------------

export type TbCatId = 'digital' | 'fashion' | 'home' | 'beauty' | 'food' | 'book';

export interface TbCat {
  id: TbCatId;
  name: string;
  tag: string; // 图链品类词
}

export const TB_CATS: TbCat[] = [
  { id: 'digital', name: '数码', tag: 'phone' },
  { id: 'fashion', name: '服饰', tag: 'jacket' },
  { id: 'home', name: '家居', tag: 'sofa' },
  { id: 'beauty', name: '美妆', tag: 'lipstick' },
  { id: 'food', name: '食品', tag: 'snacks' },
  { id: 'book', name: '图书', tag: 'books' },
];

// ---------------- 店铺 ----------------

export interface TbShop {
  id: string;
  name: string;
  /** 天猫标记（红色「天猫」角标） */
  tmall: boolean;
  rating: number;
  /** 粉丝数展示文案 */
  fans: string;
  /** 门头图 tag */
  tag: string;
  /** 店铺简介（商品流不展示，店铺卡用） */
  desc?: string;
}

export const TB_SHOPS: TbShop[] = [
  { id: 's-erye', name: '尔野数码专营店', tmall: true, rating: 4.9, fans: '6.6万', tag: 'phone', desc: '数码官方授权，全国联保' },
  { id: 's-guohuo', name: '官方国货甄选', tmall: true, rating: 4.9, fans: '497万', tag: 'earbuds', desc: '国货好物，官方直营' },
  { id: 's-keke', name: '柯柯数码', tmall: false, rating: 4.8, fans: '3.2万', tag: 'laptop', desc: '原装正品，假一赔四' },
  { id: 's-zhiyi', name: '知意生活馆', tmall: true, rating: 4.8, fans: '12万', tag: 'sofa', desc: '居家好物，品质生活' },
  { id: 's-yichu', name: '衣橱日记旗舰店', tmall: true, rating: 4.7, fans: '88万', tag: 'jacket', desc: '韩版女装，源头工厂' },
  { id: 's-chaobu', name: '潮步运动户外', tmall: false, rating: 4.8, fans: '21万', tag: 'sneakers', desc: '运动装备，全力以富' },
  { id: 's-yanxuan', name: '超值严选购', tmall: true, rating: 4.9, fans: '206万', tag: 'mug', desc: '严选好货，超值到家' },
  { id: 's-meizhuang', name: '花知晓美妆', tmall: true, rating: 4.9, fans: '156万', tag: 'lipstick', desc: '官方正品，专柜同款' },
  { id: 's-lingshi', name: '馋嘴零食铺子', tmall: false, rating: 4.7, fans: '9.8万', tag: 'snacks', desc: '零食大礼包，一件包邮' },
  { id: 's-bowen', name: '博文图书专营店', tmall: true, rating: 4.9, fans: '45万', tag: 'books', desc: '正版图书，闪电发货' },
  { id: 's-shengxian', name: '鲜果乐园', tmall: false, rating: 4.6, fans: '7.6万', tag: 'fruit', desc: '产地直发，坏果包赔' },
  { id: 's-jujia', name: '暖居家居生活', tmall: true, rating: 4.8, fans: '33万', tag: 'bedding', desc: '床上四件套，A类母婴级' },
  { id: 's-digital2', name: '慧聪通讯', tmall: false, rating: 4.7, fans: '1.8万', tag: 'watch', desc: '智能穿戴，一年换新' },
  { id: 's-muying', name: '萌趣玩具屋', tmall: false, rating: 4.8, fans: '15万', tag: 'toy', desc: '安抚玩偶，送礼佳品' },
];

export const shopById = (id: string): TbShop => CUSTOM_SHOPS.get(id) ?? TB_SHOPS.find((s) => s.id === id) ?? TB_SHOPS[0];

/** 无同 tag 店铺的品类 tag → 归类店铺（修「买衣服显示零食铺子」：
 *  AI 商品 tag（如 hoodie/dress）没有同名店铺时，旧逻辑按哈希随机挂店 → 卫衣挂进零食铺；
 *  现按品类就近归类，任何 tag 都不会再挂进毫不相干的店） */
const TB_TAG_SHOP_FALLBACK: Record<string, string> = {
  // 服饰/穿戴 → 衣橱日记旗舰店
  hoodie: 's-yichu', dress: 's-yichu', shirt: 's-yichu', tshirt: 's-yichu', jeans: 's-yichu',
  coat: 's-yichu', hat: 's-yichu', scarf: 's-yichu', socks: 's-yichu', shorts: 's-yichu', belt: 's-yichu',
  // 鞋包/运动户外 → 潮步运动户外 / 超值严选购
  backpack: 's-chaobu', sunglasses: 's-chaobu', 'yoga-mat': 's-chaobu', basketball: 's-chaobu', dumbbell: 's-chaobu',
  suitcase: 's-yanxuan', wallet: 's-yanxuan', umbrella: 's-yanxuan',
  // 美妆 → 花知晓美妆
  perfume: 's-meizhuang', skincare: 's-meizhuang', makeup: 's-meizhuang', brush: 's-meizhuang', 'face-mask': 's-meizhuang',
  // 食品茶饮 → 馋嘴零食铺子；生鲜鲜花 → 鲜果乐园
  cookies: 's-lingshi', tea: 's-lingshi', flower: 's-shengxian',
  // 图书文具 → 博文图书专营店
  pen: 's-bowen', notebook: 's-bowen',
  // 母婴玩具 → 萌趣玩具屋
  'toy-car': 's-muying', blocks: 's-muying', puzzle: 's-muying', gift: 's-muying',
  // 数码 → 尔野数码 / 柯柯数码 / 慧聪通讯 / 官方国货甄选
  tablet: 's-erye', powerbank: 's-erye', lock: 's-erye', 'phone-stand': 's-erye', tv: 's-erye',
  camera: 's-keke', keyboard: 's-keke', mouse: 's-keke', monitor: 's-keke', drone: 's-keke', gamepad: 's-keke',
  speaker: 's-guohuo',
  // 家居家纺 → 知意生活馆 / 暖居家居生活 / 超值严选购
  curtain: 's-jujia', pillow: 's-jujia', towel: 's-jujia', carpet: 's-jujia',
  vase: 's-zhiyi', storage: 's-yanxuan', lamp: 's-yanxuan', desk: 's-yanxuan', lunchbox: 's-yanxuan', toothbrush: 's-yanxuan',
  // 家电/杂货 → 超值严选购（百货，卖什么都成立）
  'air-fryer': 's-yanxuan', 'coffee-machine': 's-yanxuan', fan: 's-yanxuan', hairdryer: 's-yanxuan',
  humidifier: 's-yanxuan', kettle: 's-yanxuan', microwave: 's-yanxuan', 'rice-cooker': 's-yanxuan',
  shaver: 's-yanxuan', vacuum: 's-yanxuan', fridge: 's-yanxuan', washer: 's-yanxuan', guitar: 's-yanxuan',
};

/** tag → 店铺 id：同 tag 店铺优先 → 归类兜底 → 未收录 tag 按种子轮转（确定性，不随机漂移） */
export function tbShopIdForTag(tag: string, seed = 0): string {
  const hit = TB_SHOPS.find((s) => s.tag === tag);
  if (hit) return hit.id;
  const fb = TB_TAG_SHOP_FALLBACK[tag];
  if (fb) return fb;
  return TB_SHOPS[seed % TB_SHOPS.length]?.id ?? TB_SHOPS[0].id;
}

// ---------------- SKU ----------------

export interface TbSkuGroup {
  /** 组名（颜色分类 / 尺码 / 版本 / 规格） */
  name: string;
  options: { label: string; img?: string; soldOut?: boolean; priceDelta?: number }[];
}

/** 服饰尺码模板 */
const CLOTH_SIZE: TbSkuGroup = {
  name: '尺码',
  options: [
    { label: 'S' },
    { label: 'M' },
    { label: 'L' },
    { label: 'XL' },
    { label: '2XL', priceDelta: 5 },
  ],
};

// ---------------- 评价 ----------------

export interface TbReviewSeed {
  user: string;
  rating: number;
  content: string;
  /** 相对获得时刻的天数偏移（生成时取负） */
  daysAgo: number;
  /** 评价规格文本 */
  sku?: string;
  /** 商家回复（部分带） */
  reply?: string;
}

const REVIEW_POOL: TbReviewSeed[] = [
  { user: 't**6', rating: 5, content: '质量非常好，做工很精细，和图片描述完全一致，物流也很快，第二天就到了，包装很严实，五星好评！', daysAgo: 3, sku: '颜色分类：官方标配' },
  { user: '小**鱼', rating: 5, content: '第二次回购了，家里人都说好用，客服态度也很好，有问必答，值得推荐给身边的朋友。', daysAgo: 5, sku: '颜色分类：星空黑' },
  { user: 'w**n', rating: 4, content: '整体不错，性价比很高，就是发货稍微慢了一点，不过东西本身没得挑。', daysAgo: 7 },
  { user: '橙**子', rating: 5, content: '收到货迫不及待打开，比想象中还要好，质感很棒，颜值超高，太喜欢了！', daysAgo: 2, reply: '感谢亲的认可，欢迎下次光临~' },
  { user: 'm**k', rating: 5, content: '快递小哥很给力，包装一层又一层的，商品完好无损，用了一周才来评价，确实好用。', daysAgo: 9, sku: '尺码：L' },
  { user: '豆**芽', rating: 4, content: '东西是好的，就是颜色和图片稍微有一点点色差，能接受，总体满意。', daysAgo: 4 },
  { user: '风**起', rating: 5, content: '老客户了，一直在这家买，品质稳定，售后也省心，退货宝用了一次秒到账。', daysAgo: 12, reply: '感谢老顾客的支持，我们会继续努力！' },
  { user: 'k**y', rating: 5, content: '完全超出预期，朋友看了都说好，问我在哪买的，已经推荐给三个同事了哈哈。', daysAgo: 6 },
  { user: '一**风', rating: 3, content: '中规中矩吧，这个价位还算可以，有一点点小瑕疵不影响使用。', daysAgo: 8 },
  { user: '糖**果', rating: 5, content: '送人很有面子，礼盒包装很精美，对方特别喜欢，下次还来。', daysAgo: 10, sku: '规格：礼盒装' },
];

/** 按商品确定性取 3 条评价（不同商品不同组合） */
export function tbReviewsOf(pid: string): TbReviewSeed[] {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0;
  const out: TbReviewSeed[] = [];
  for (let i = 0; i < 3; i++) out.push(REVIEW_POOL[(h + i * 3) % REVIEW_POOL.length]);
  return out;
}

// ---------------- 商品 ----------------

export interface TbProduct {
  id: string;
  title: string;
  /** 现价 */
  price: number;
  /** 原价（划线价；缺省不显示） */
  originPrice?: number;
  /** 销量（展示「已售N+」） */
  sales: number;
  shopId: string;
  cat: TbCatId;
  /** 主图品类词（多图 = 同 tag 不同变体） */
  tag: string;
  /** 运费：0 = 包邮 */
  freight: number;
  /** 服务标签（退货宝/假一赔四…） */
  tags: string[];
  skus: TbSkuGroup[];
  /** 活动角标（超级88/百亿补贴） */
  promo?: string;
  /** 领券立减金额（下单可用优惠券演示） */
  coupon?: { amount: number; min: number };
  /** 自有主图（自建商品上传/AI 生成图 dataURL；缺省走 tag 品类图） */
  img?: string;
  /** 自建商品元数据（创建订单=创建商品：类型/优惠券名/规格选项组，下单时随订单快照） */
  custom?: OrderCustomMeta;
}

/** 颜色组（带商品图缩略） */
function colorGroup(tag: string, names: string[], soldOutIdx: number[] = []): TbSkuGroup {
  return {
    name: '颜色分类',
    options: names.map((n, i) => ({
      label: n,
      img: tbImg(tag, 120, 120, i % 4),
      soldOut: soldOutIdx.includes(i),
    })),
  };
}

function P(
  id: string,
  title: string,
  price: number,
  originPrice: number,
  sales: number,
  shopId: string,
  cat: TbCatId,
  tag: string,
  tags: string[],
  skus: TbSkuGroup[],
  extra: Partial<TbProduct> = {}
): TbProduct {
  return { id, title, price, originPrice, sales, shopId, cat, tag, freight: 0, tags, skus, ...extra };
}

export const TB_PRODUCTS: TbProduct[] = [
  // ---- 数码 ----
  P('p-earbuds-1', '【双主机降噪】真无线蓝牙耳机 超长续航 智能APP操作 杜比全景空间音效', 129, 199, 23000, 's-guohuo', 'digital', 'earbuds', ['退货宝', '30H复合续航', 'ENC通话降噪'], [
    colorGroup('earbuds', ['云雾白', '星空黑', '沧雾蓝', '樱花粉'], [3]),
    { name: '版本', options: [{ label: '标准版' }, { label: '旗舰版', priceDelta: 70 }] },
  ], { promo: '百亿补贴' }),
  P('p-phone-1', 'Apple/苹果 iPhone 13 国行原装正品 全网通5G 双卡双待 手机 99新', 1999, 2999, 8200, 's-keke', 'digital', 'phone', ['假一赔四', '7天无理由', '极速退款'], [
    colorGroup('phone', ['午夜色', '星光色', '蓝色', '红色'], []),
    // 用户指定手机型号规格：4/6+16G，12/16+128G，8/12+256G，12+512G，16+1TB
    { name: '存储容量', options: [
      { label: '4GB+16GB' },
      { label: '6GB+16GB', priceDelta: 100 },
      { label: '12GB+128GB', priceDelta: 300 },
      { label: '16GB+128GB', priceDelta: 400 },
      { label: '8GB+256GB', priceDelta: 500 },
      { label: '12GB+256GB', priceDelta: 600 },
      { label: '12GB+512GB', priceDelta: 1000 },
      { label: '16GB+1TB', priceDelta: 1500 },
    ] },
    { name: '网络类型', options: [{ label: '5G全网通' }] },
    { name: '套餐类型', options: [{ label: '官方标配' }] },
    { name: '版本类型', options: [{ label: '中国大陆' }] },
    { name: '发货方式', options: [{ label: '仓库直发' }] },
  ]),
  P('p-phone-2', '旗舰5G智能手机 2亿像素 第二代骁龙8 120Hz高刷屏 5500mAh超长续航', 3999, 4299, 1100, 's-erye', 'digital', 'phone', ['国补15%', '分期免息', '退货宝'], [
    colorGroup('phone', ['曜金黑', '冰晶蓝', '流光银'], []),
    // 用户指定手机型号规格：4/6+16G，12/16+128G，8/12+256G，12+512G，16+1TB
    { name: '存储容量', options: [
      { label: '4GB+16GB' },
      { label: '6GB+16GB', priceDelta: 100 },
      { label: '12GB+128GB', priceDelta: 300 },
      { label: '16GB+128GB', priceDelta: 400 },
      { label: '8GB+256GB', priceDelta: 500 },
      { label: '12GB+256GB', priceDelta: 600 },
      { label: '12GB+512GB', priceDelta: 1000 },
      { label: '16GB+1TB', priceDelta: 1500 },
    ] },
    { name: '网络类型', options: [{ label: '5G全网通' }] },
    { name: '套餐类型', options: [{ label: '官方标配' }, { label: '套餐一（壳膜+充电器）', priceDelta: 59 }] },
    { name: '版本类型', options: [{ label: '中国大陆' }] },
    { name: '发货方式', options: [{ label: '仓库直发' }] },
  ], { promo: '国补' }),
  P('p-laptop-1', '轻薄笔记本电脑 14英寸2.8K 高色域 办公学生学习本 背光键盘 长续航', 4599, 5299, 3400, 's-keke', 'digital', 'laptop', ['退货宝', '全国联保', '分期免息'], [
    colorGroup('laptop', ['银色', '深空灰'], []),
    { name: '配置', options: [{ label: '16G+512G' }, { label: '32G+1T', priceDelta: 600 }] },
    { name: '网络类型', options: [{ label: '5G全网通' }] },
    { name: '套餐类型', options: [{ label: '官方标配' }] },
    { name: '版本类型', options: [{ label: '中国大陆' }] },
    { name: '发货方式', options: [{ label: '仓库直发' }] },
  ]),
  P('p-watch-1', '智能手表 运动血氧心率监测 语音蓝牙通话 超长续航 适用多机型', 299, 399, 15000, 's-digital2', 'digital', 'watch', ['退货宝', '一年换新'], [
    colorGroup('watch', ['曜石黑', '流沙金', '樱花粉'], []),
    { name: '表带', options: [{ label: '硅胶带' }, { label: '真皮带', priceDelta: 30 }] },
  ]),
  P('p-keyboard-1', '机械键盘 98配列 三模连接 RGB背光 热插拔轴体 游戏办公', 199, 269, 8900, 's-erye', 'digital', 'keyboard', ['退货宝', '包邮'], [
    { name: '轴体', options: [{ label: '红轴' }, { label: '茶轴' }, { label: '青轴' }] },
    colorGroup('keyboard', ['黑色', '白色'], []),
  ]),
  P('p-speaker-1', '便携蓝牙音箱 重低音炮 户外防水迷你音响 超长续航', 89, 129, 32000, 's-guohuo', 'digital', 'speaker', ['退货宝', 'IPX7防水'], [
    colorGroup('speaker', ['黑色', '军绿', '橙色'], [2]),
  ], { promo: '超级88' }),
  P('p-powerbank-1', '充电宝20000毫安大容量 22.5W超级快充 自带线 乘机可带', 69, 99, 56000, 's-guohuo', 'digital', 'powerbank', ['退货宝', '顺丰包邮'], [
    colorGroup('powerbank', ['黑色', '白色'], []),
  ]),
  P('p-tablet-1', '平板电脑 11英寸2.5K 120Hz 学习办公娱乐 影音大屏 8扬声器', 1899, 2199, 4200, 's-erye', 'digital', 'tablet', ['退货宝', '分期免息'], [
    colorGroup('tablet', ['深空灰', '银色'], []),
    { name: '版本', options: [{ label: '8G+128G' }, { label: '8G+256G', priceDelta: 200 }] },
    { name: '网络类型', options: [{ label: '5G全网通' }] },
    { name: '套餐类型', options: [{ label: '官方标配' }] },
    { name: '版本类型', options: [{ label: '中国大陆' }] },
    { name: '发货方式', options: [{ label: '仓库直发' }] },
  ]),

  // ---- 服饰 ----
  P('p-coat-1', '韩版风衣外套女2026春秋新款小个子中长款学院风jk制服外套冲锋衣', 59.8, 68, 400, 's-yichu', 'fashion', 'jacket', ['退货宝', '近30天低价', '7天无理由'], [
    colorGroup('jacket', ['A158蓝色风衣', 'A158黑色风衣', '158蓝色风衣', '158黑色风衣'], [2, 3]),
    CLOTH_SIZE,
  ], { promo: '超级88', coupon: { amount: 8, min: 50 } }),
  P('p-dress-1', '法式碎花连衣裙女夏季新款收腰显瘦气质吊带长裙度假沙滩裙', 89, 139, 12000, 's-yichu', 'fashion', 'dress', ['退货宝', '7天无理由'], [
    colorGroup('dress', ['碎花蓝', '奶油白', '复古绿'], [2]),
    CLOTH_SIZE,
  ]),
  P('p-sneakers-1', '百搭小白鞋女春秋新款厚底增高透气板鞋 潮流休闲运动鞋', 79, 119, 45000, 's-chaobu', 'fashion', 'sneakers', ['退货宝', '运费险'], [
    colorGroup('sneakers', ['白色', '米白', '黑色'], []),
    { name: '尺码', options: [{ label: '36' }, { label: '37' }, { label: '38' }, { label: '39' }, { label: '40' }] },
  ], { promo: '百亿补贴' }),
  P('p-tshirt-1', '纯棉短袖T恤女2026新款宽松白色上衣 简约百搭打底衫 100%纯棉', 29.9, 49, 88000, 's-yichu', 'fashion', 'tshirt', ['退货宝', '面料A类'], [
    colorGroup('tshirt', ['白色', '黑色', '燕麦色', '雾霾蓝'], []),
    CLOTH_SIZE,
  ]),
  P('p-hoodie-1', '连帽卫衣女春秋薄款宽松慵懒风外套 无帽 经典ins潮牌上衣', 69, 99, 21000, 's-yichu', 'fashion', 'hoodie', ['退货宝', '7天无理由'], [
    colorGroup('hoodie', ['灰色', '黑色', '奶杏色'], []),
    CLOTH_SIZE,
  ]),
  P('p-jeans-1', '直筒牛仔裤女2026春秋高腰显瘦垂感阔腿裤 显瘦神裤长裤', 99, 159, 9600, 's-yichu', 'fashion', 'jeans', ['退货宝', '免费改长'], [
    colorGroup('jeans', ['浅蓝', '深蓝', '烟灰'], []),
    CLOTH_SIZE,
  ]),
  P('p-backpack-1', '双肩包女韩版时尚百搭书包 学生通勤大容量旅行背包 轻便百搭', 49, 89, 17000, 's-yanxuan', 'fashion', 'backpack', ['退货宝', '顺丰包邮'], [
    colorGroup('backpack', ['樱花粉', '经典黑', '雾霾蓝'], [1]),
  ]),

  // ---- 家居 ----
  P('p-sofa-1', '布艺沙发小户型客厅双人三人位 现代简约奶油风整装沙发 免洗科技布', 1299, 1899, 2300, 's-zhiyi', 'home', 'sofa', ['送货入户', '质保三年'], [
    colorGroup('sofa', ['奶油白', '雾霾灰', '燕麦色'], []),
    { name: '规格', options: [{ label: '双人位' }, { label: '三人位', priceDelta: 400 }] },
  ]),
  P('p-bedding-1', '60支长绒棉四件套100s全棉床品套件 卧室裸睡床单被套 A类母婴级', 199, 329, 7800, 's-jujia', 'home', 'bedding', ['退货宝', 'A类母婴级'], [
    colorGroup('bedding', ['云朵白', '雾霾蓝', '豆沙粉'], []),
    { name: '尺寸', options: [{ label: '1.5m床' }, { label: '1.8m床', priceDelta: 30 }] },
  ], { promo: '超级88' }),
  P('p-lamp-1', '落地灯客厅卧室床头立式台灯 现代简约遥控调光 奶油风ins北欧', 159, 229, 5400, 's-yanxuan', 'home', 'lamp', ['退货宝', '三年质保'], [
    colorGroup('lamp', ['奶油白', '胡桃木色'], []),
  ]),
  P('p-mug-1', '马克杯带盖勺陶瓷咖啡杯情侣水杯 高颜值ins办公室牛奶杯 礼盒装', 25.9, 39.9, 66000, 's-yanxuan', 'home', 'mug', ['退货宝', '破损包赔'], [
    colorGroup('mug', ['奶白', '雾霾蓝', '樱花粉', '石墨黑'], []),
    { name: '规格', options: [{ label: '单杯' }, { label: '礼盒装', priceDelta: 10 }] },
  ]),
  P('p-vase-1', '插花干花花瓶摆件客厅电视柜轻奢玻璃花瓶 北欧透明水培百合', 39.9, 69, 12000, 's-zhiyi', 'home', 'vase', ['退货宝', '破损包赔'], [
    { name: '规格', options: [{ label: '透明款' }, { label: '琥珀色' }, { label: '烟灰色' }] },
  ]),
  P('p-pillow-1', '抱枕靠垫沙发靠背床头大靠背 汽车腰靠办公室护腰枕 芯可拆洗', 19.9, 35, 34000, 's-yanxuan', 'home', 'pillow', ['退货宝', '可拆洗'], [
    colorGroup('pillow', ['奶白', '焦糖色', '墨绿'], []),
    { name: '尺寸', options: [{ label: '45x45cm' }, { label: '60x60cm', priceDelta: 8 }] },
  ]),
  P('p-desk-1', '电脑桌书桌简约家用学生写字台 卧室学习桌办公桌 稳固不加晃', 129, 199, 8900, 's-zhiyi', 'home', 'desk', ['送装一体', '三年质保'], [
    { name: '尺寸', options: [{ label: '80cm' }, { label: '100cm', priceDelta: 30 }, { label: '120cm', priceDelta: 60 }] },
    colorGroup('desk', ['原木色', '白色', '黑色'], []),
  ]),

  // ---- 美妆 ----
  P('p-lipstick-1', '口红套装正品大牌丝绒雾面哑光小众品牌 持久不脱色 送礼盒生日礼物', 79, 129, 27000, 's-meizhuang', 'beauty', 'lipstick', ['退货宝', '专柜同款', '破损包赔'], [
    // 质地是口红类型本身（标题已带：唇釉/口红/唇泥/唇膏/唇蜜），不进购买弹窗；弹窗只选色号/规格
    { name: '色号', options: TB_LIP_COLORS.map((c, i) => ({ label: c, img: tbImg('lipstick', 120, 120, i % 4) })) },
    { name: '规格', options: [{ label: '单支装' }, { label: '三支礼盒', priceDelta: 89 }] },
  ], { promo: '百亿补贴' }),
  P('p-perfume-1', '香水女士持久淡香清新自然 网红小众香氛 学生党口袋香水50ml', 59, 99, 41000, 's-meizhuang', 'beauty', 'perfume', ['退货宝', '官方正品'], [
    { name: '香型', options: [{ label: '蓝风铃' }, { label: '鼠尾草' }, { label: '白桃乌龙' }] },
  ]),
  P('p-skincare-1', '面霜保湿补水修护屏障 官方旗舰店正品 女学生秋冬滋润乳液50g', 99, 159, 18000, 's-meizhuang', 'beauty', 'skincare', ['退货宝', '专柜同款'], [
    { name: '规格', options: [{ label: '50g' }, { label: '50g+15g套装', priceDelta: 40 }] },
  ]),
  P('p-makeup-1', '新款12色眼影盘哑光珠光大地色 一盘搞定眼妆 修容修容高光彩妆盘', 39.9, 69, 53000, 's-meizhuang', 'beauty', 'makeup', ['退货宝', '飞粉包退'], [
    { name: '色号', options: [{ label: '海棠粉棕' }, { label: '焦糖南瓜' }, { label: '大地通勤' }] },
  ], { promo: '超级88', coupon: { amount: 5, min: 30 } }),

  // ---- 食品 ----
  P('p-snacks-1', '零食大礼包整箱组合一箱 好吃的网红小吃货零食超大混装 30包送女友', 39.9, 69.9, 92000, 's-lingshi', 'food', 'snacks', ['退货宝', '一件包邮'], [
    { name: '规格', options: [{ label: '30包装' }, { label: '60包装', priceDelta: 30 }] },
  ], { promo: '百亿补贴' }),
  P('p-cookies-1', '曲奇饼干礼盒装丹麦风味手工牛轧糖 奶香酥脆下午茶点心 办公室零食', 29.9, 49.9, 38000, 's-lingshi', 'food', 'cookies', ['退货宝', '新鲜日期'], [
    { name: '口味', options: [{ label: '黄油原味' }, { label: '巧克力味' }, { label: '抹茶味' }] },
  ]),
  P('p-fruit-1', '新鲜水果当季现摘大礼包5斤装 草莓芒果奇异果组合 坏果包赔', 49.9, 89.9, 26000, 's-shengxian', 'food', 'fruit', ['坏果包赔', '48h发货'], [
    { name: '规格', options: [{ label: '5斤混装' }, { label: '9斤全家福', priceDelta: 30 }] },
  ]),
  P('p-tea-1', '茶叶礼盒装大红袍肉桂乌龙茶 高档送礼长辈商务茶礼罐装 买一送一', 99, 199, 14000, 's-lingshi', 'food', 'tea', ['退货宝', '送礼佳品'], [
    { name: '规格', options: [{ label: '尊享装' }, { label: '典藏礼盒', priceDelta: 100 }] },
  ]),

  // ---- 图书 ----
  P('p-books-1', '活着+人生+平凡的世界全三册 茅盾文学奖正版书籍 经典文学小说畅销书', 59, 108, 63000, 's-bowen', 'book', 'books', ['退货宝', '正版保证'], [
    { name: '装帧', options: [{ label: '平装' }, { label: '精装典藏', priceDelta: 30 }] },
  ]),
  P('p-book-1', '儿童绘本3-6岁幼儿园故事书 全套20册睡前故事 亲子早教启蒙读物', 39.9, 79, 29000, 's-bowen', 'book', 'book', ['退货宝', '正版保证'], [
    { name: '套装', options: [{ label: '20册装' }, { label: '40册装', priceDelta: 35 }] },
  ]),
  P('p-books-2', '2026新版高考五年三年高考模拟 高中总复习教辅 知识点大全全套', 89, 158, 15000, 's-bowen', 'book', 'books', ['退货宝', '正版保证'], [
    { name: '科目', options: [{ label: '数学' }, { label: '英语' }, { label: '语文' }, { label: '全套六科', priceDelta: 300 }] },
  ]),
  P('p-toy-1', '安抚玩偶毛绒玩具女生睡觉抱枕 可爱兔子公仔娃娃生日礼物送女友', 35, 69, 33000, 's-muying', 'home', 'toy', ['退货宝', 'A类面料'], [
    colorGroup('toy', ['奶油兔', '粉粉猪', '抱抱熊'], []),
    { name: '尺寸', options: [{ label: '40cm' }, { label: '60cm', priceDelta: 20 }] },
  ], { promo: '超级88' }),
  P('p-umbrella-1', '雨伞全自动折叠大号双人加固防风 防晒太阳伞女晴雨两用黑胶', 29.9, 59, 77000, 's-yanxuan', 'home', 'umbrella', ['退货宝', '抗强风'], [
    colorGroup('umbrella', ['云朵白', '雾霭蓝', '樱花粉', '经典黑'], []),
  ]),
  P('p-bottle-1', '保温杯316不锈钢大容量水杯 男女学生便携茶水分离杯子 高颜值', 49, 89, 61000, 's-yanxuan', 'home', 'water-bottle', ['退货宝', '316不锈钢'], [
    colorGroup('water-bottle', ['奶油白', '雾霾蓝', '咖啡色'], []),
    { name: '容量', options: [{ label: '500ml' }, { label: '800ml', priceDelta: 10 }] },
  ]),
];

/** 应用商品图覆盖（productById 读取兜底：注册表对象被重建后生成图依然生效） */
function applyImgOverride(p: TbProduct): TbProduct {
  const ov = productImgMap()[p.id];
  return ov && p.img !== ov ? { ...p, img: ov } : p;
};

export const productById = (id: string): TbProduct | undefined => {
  // 自建商品（创建订单=创建商品）：优先命中，不走 AI 商品同 tag 归店自愈（自建店不参与品类归店）
  const custom = CUSTOM_PRODUCTS.get(id);
  if (custom) return applyImgOverride(custom);
  const ai = AI_PRODUCTS.get(id);
  if (ai) {
    // 存量自愈（修「买衣服显示零食铺子」）：旧版 AI 商品 tag 无同 tag 店铺时按哈希随机挂店，
    // 这里在读取时纠正为品类归类店铺并回写注册表（一次性收敛，无需迁移脚本）
    const curOk = TB_SHOPS.find((s) => s.id === ai.shopId)?.tag === ai.tag;
    if (!curOk) {
      const want = tbShopIdForTag(ai.tag);
      if (want !== ai.shopId) {
        const fixed = { ...ai, shopId: want };
        AI_PRODUCTS.set(id, fixed);
        return fixed;
      }
    }
    return applyImgOverride(ai);
  }
  const seed = TB_PRODUCTS.find((p) => p.id === id);
  return seed ? applyImgOverride(seed) : undefined;
};

// ---------------- 商品图生成覆盖（第三十七轮：商品详情页点图可生成，自建+原有商品通用） ----------------
// 生成结果：mutate 内存对象（预置/AI/自建统一即时生效）+ 全局 kv 持久化（防刷新丢失）；
// productById 读取时兜底应用 override（注册表对象被重建后依然正确）。

const PRODUCT_IMG_KEY = 'tb-product-imgs';
let productImgCache: Record<string, string> | null = null;

function productImgMap(): Record<string, string> {
  if (!productImgCache) {
    try {
      const v = kvGet(PRODUCT_IMG_KEY) as Record<string, string> | null;
      productImgCache = v && typeof v === 'object' ? v : {};
    } catch {
      productImgCache = {};
    }
  }
  return productImgCache;
}

/** 读商品图覆盖（礼物弹窗/草稿卡等快照渲染点实时升级真图用；无覆盖返回 null） */
export function tbProductImgOverride(pid: string): string | null {
  const ov = productImgMap()[pid];
  return typeof ov === 'string' && ov.startsWith('data:image/') ? ov : null;
}

/** 写商品图覆盖（商品详情页点击图片生成成功后调用；mutate + 持久化，所有渲染点即时生效） */
export function tbSetProductImg(pid: string, src: string): void {
  const map = productImgMap();
  map[pid] = src;
  productImgCache = map;
  const custom = CUSTOM_PRODUCTS.get(pid);
  if (custom) custom.img = src;
  const ai = AI_PRODUCTS.get(pid);
  if (ai) ai.img = src;
  const seed = TB_PRODUCTS.find((p) => p.id === pid);
  if (seed) seed.img = src;
  try {
    kvSet(PRODUCT_IMG_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 启动恢复：把已持久化的商品图覆盖写回内存商品对象（App 登录/恢复时调用一次） */
export function tbApplyProductImgOverrides(): void {
  const map = productImgMap();
  for (const [pid, src] of Object.entries(map)) {
    const custom = CUSTOM_PRODUCTS.get(pid);
    if (custom) {
      custom.img = src;
      continue;
    }
    const ai = AI_PRODUCTS.get(pid);
    if (ai) {
      ai.img = src;
      continue;
    }
    const seed = TB_PRODUCTS.find((p) => p.id === pid);
    if (seed) seed.img = src;
  }
}

/** 删除商品图覆盖（自建商品删除时调用：商品没了覆盖不再有意义，防 kv 无限膨胀） */
export function tbDeleteProductImg(pid: string): void {
  const map = productImgMap();
  if (!(pid in map)) return;
  delete map[pid];
  productImgCache = map;
  try {
    kvSet(PRODUCT_IMG_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

// ---------------- AI 生成商品注册表（刷新更新内容动态注入，持久化到 IndexedDB 后启动恢复） ----------------
// AI 生成的商品在运行时注册进这里：商品详情/SKU/购物车/下单等既有链路通过 productById /
// tbSearchPool 无感命中，不改任何调用方；注册表内容随 tb-ai-products:<uid> 持久化，刷新页面后恢复。
const AI_PRODUCTS = new Map<string, TbProduct>();

/** 注册 AI 生成的商品（同 id 覆盖） */
export function tbRegisterAiProduct(p: TbProduct): void {
  AI_PRODUCTS.set(p.id, p);
}

/** 批量注册（启动恢复 / AI 批次落地） */
export function tbRegisterAiProducts(list: TbProduct[]): void {
  for (const p of list) AI_PRODUCTS.set(p.id, p);
}

/** 全部 AI 商品（持久化回写用） */
export function tbAiProductsAll(): TbProduct[] {
  return [...AI_PRODUCTS.values()];
}

// ---------------- 自建商品注册表（第三十六轮：创建订单=创建商品） ----------------
// 「创建订单」保存的是商品（不是订单）：注册进这里后，商品详情/SKU/购物车/结算/下单等既有链路
// 通过 productById / shopById 无感命中，不改任何调用方；持久化按 tb uid 隔离（taobao-store）。

const CUSTOM_PRODUCTS = new Map<string, TbProduct>();
const CUSTOM_SHOPS = new Map<string, TbShop>();

/** 注册自建商品 + 其自建店铺（同 id 覆盖） */
export function tbRegisterCustomProduct(p: TbProduct, shop: TbShop): void {
  if (!p.id.startsWith('tbc-')) return;
  CUSTOM_PRODUCTS.set(p.id, p);
  if (shop.id.startsWith('tbc-s-')) CUSTOM_SHOPS.set(shop.id, shop);
}

/** 批量注册（进 App 恢复用） */
export function tbRegisterCustomProducts(list: { p: TbProduct; shop: TbShop }[]): void {
  for (const e of list) tbRegisterCustomProduct(e.p, e.shop);
}

/** 注销单个自建商品（删除商品时调用，连同其自建店铺） */
export function tbUnregisterCustomProduct(id: string): void {
  const p = CUSTOM_PRODUCTS.get(id);
  CUSTOM_PRODUCTS.delete(id);
  if (p) CUSTOM_SHOPS.delete(p.shopId);
}

/** 全部自建商品 + 店铺（首页「我的商品」区展示 / 持久化回写用） */
export function tbCustomProductsAll(): { p: TbProduct; shop: TbShop }[] {
  return [...CUSTOM_PRODUCTS.values()].map((p) => ({ p, shop: CUSTOM_SHOPS.get(p.shopId) ?? shopById(p.shopId) }));
}

// ---------------- 店铺头像/背景（第三十七轮：所有店铺统一品牌） ----------------
// 头像 = 「该用户正在营业」印章图，背景 = 「欢迎光临」手绘图——预置/AI 生成/自建店铺全部生效；
// 商品详情页里点头像可用「设置 › 图像生成」的模型生成新头像（覆盖存储，全局 kv）。

export const TB_SHOP_AVATAR = '/shop-avatar.png';
export const TB_SHOP_BG = '/shop-bg.png';

const SHOP_AVATAR_KEY = 'tb-shop-avatars';
let shopAvatarCache: Record<string, string> | null = null;

function shopAvatarMap(): Record<string, string> {
  if (!shopAvatarCache) {
    try {
      const v = kvGet(SHOP_AVATAR_KEY) as Record<string, string> | null;
      shopAvatarCache = v && typeof v === 'object' ? v : {};
    } catch {
      shopAvatarCache = {};
    }
  }
  return shopAvatarCache;
}

/** 店铺头像（生成覆盖优先，缺省统一「正在营业」印章） */
export function tbShopAvatarOf(shopId: string): string {
  return shopAvatarMap()[shopId] ?? TB_SHOP_AVATAR;
}

/** 写店铺头像覆盖（商品详情页点头像生成后调用；运行时缓存 + kv 持久化） */
export function tbSetShopAvatar(shopId: string, src: string): void {
  const map = shopAvatarMap();
  map[shopId] = src;
  shopAvatarCache = map;
  try {
    kvSet(SHOP_AVATAR_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 搜索池（自建商品 + AI 动态注册 + 种子），搜索/猜你喜欢可用 */
export function tbSearchPool(): TbProduct[] {
  return [...CUSTOM_PRODUCTS.values(), ...AI_PRODUCTS.values(), ...TB_PRODUCTS];
}

// ---------------- 搜索 ----------------

export const TB_HOT_SEARCHES: string[] = [
  '蓝牙耳机',
  '秋季外套',
  ' iPhone',
  '手机壳',
  '连衣裙',
  '四件套',
  '零食大礼包',
  '小白鞋',
  '保温杯',
  '眼影盘',
  '机械键盘',
  '香水',
];

/** 销量展示（已售 2.3万+ / 已售 400+） */
export function tbSalesText(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万+`;
  if (n >= 1000) return `${Math.floor(n / 1000)}000+`;
  return `${n}+`;
}

/** 搜索打分：标题/店铺/分类命中（与美团 searchScore 同思路） */
export function tbSearchScore(p: TbProduct, kw: string): number {
  const k = kw.trim().toLowerCase();
  if (!k) return 1;
  let s = 0;
  const title = p.title.toLowerCase();
  const shop = shopById(p.shopId).name.toLowerCase();
  const cat = TB_CATS.find((c) => c.id === p.cat)?.name ?? '';
  if (title.includes(k)) s += title.startsWith(k) ? 60 : 40;
  if (shop.includes(k)) s += 30;
  if (cat.includes(k)) s += 20;
  // 分词宽松匹配（两字以上词组逐个命中）
  if (k.length >= 2) {
    for (let i = 0; i + 2 <= k.length; i++) {
      if (title.includes(k.slice(i, i + 2))) s += 6;
    }
  }
  // 中文同义扩展（耳机↔蓝牙耳机等由分词覆盖；单字命中弱分）
  return s;
}
