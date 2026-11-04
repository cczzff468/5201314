/**
 * 美团 App 种子数据（商家/菜单/评价/分类入口）：
 * - 纯前端静态数据，对齐真机演示口径（评分/月售/起送/配送费/距离/满减）；
 * - 菜品图/门头图统一走本地 kawaii 卡通插画（goods-img.ts，Task 58 预生成本地图，不再请求外部图库）；
 * - 商家与菜品 id 稳定（购物车/订单跨重启引用）。
 */

import { mtGoodsImg } from '@/lib/ios/goods-img';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import type { OrderCustomMeta } from '@/lib/ios/order-custom';

/** 内容匹配图地址（本地卡通图，Task 58）：
 *  - k=英文品类词（hotpot/pizza/milk-tea…），goods-img 映射到 public/goods 预生成 kawaii 插画；
 *  - s=变体序号 / w/h=尺寸参数保留兼容调用方（同 tag 固定同图，变体同图展示）；
 *  - p=f 菜品图 / c 门头图 */
export function mtImg(tag: string, w = 480, h = 360, s = 0, kind: 'f' | 'c' = 'f'): string {
  void w;
  void h;
  void s;
  return mtGoodsImg(tag, kind);
}

/** 中文名 → 英文品类词词典（AI 未返回 tag 时兜底，保证图片与内容匹配） */
const TAG_RULES: [RegExp, string][] = [
  [/火锅|麻辣烫|麻辣拌|冒菜|香锅/, 'hotpot'],
  [/奶茶|奶绿|芋泥|波霸|珍珠/, 'milk-tea'],
  [/可乐|汽水|雪碧|苏打|气泡水/, 'cola'],
  [/咖啡|拿铁|美式|摩卡/, 'coffee'],
  [/柠檬茶|红茶|绿茶|乌龙|花茶|茶/, 'tea'],
  [/果汁|鲜榨|椰汁|酸奶|柠檬水|酸梅汤|饮/, 'juice'],
  [/咖喱/, 'curry'],
  [/泰式|泰国|冬阴功|菠萝饭|青柠蒸鱼/, 'thai'],
  [/东南亚|越南|新加坡|马来西亚|印尼|南洋/, 'asian'],
  [/和风|日式|居酒屋|天妇罗|寿喜烧|味噌|丼物|日料/, 'japanese'],
  [/比萨|披萨/, 'pizza'],
  [/汉堡/, 'burger'],
  [/寿司|刺身|三文鱼|鳗鱼/, 'sushi'],
  [/烧烤|烤肉|烤鱼|串串|烤/, 'barbecue'],
  [/韩式|韩国|部队锅|年糕火锅/, 'barbecue'],
  [/炸鸡|鸡排|鸡翅|烧鸡|口水鸡|鸡肉/, 'fried-chicken'],
  [/港式|粤菜|广东|茶餐厅|烧腊|潮汕|闽南|福建|客家/, 'chinese-food'],
  [/饺子|包子|馄饨|云吞|烧麦|生煎|锅贴|点心|馒头/, 'dumplings'],
  [/蛋糕|慕斯|提拉米苏|千层|泡芙|蛋挞|甜品|甜点|布丁|圣代|冰激凌|冰淇淋|雪糕|雪媚娘/, 'dessert'],
  [/海鲜|虾|蟹|鲍鱼|生蚝|扇贝|鱼/, 'seafood'],
  [/牛排|西冷|菲力/, 'steak'],
  [/牛肉|肥牛|牛腩|毛肚/, 'beef'],
  [/羊肉|羊蝎子/, 'lamb'],
  [/烤鸭|鸭脖|鸭血|鸭/, 'duck'],
  [/排骨|红烧肉|猪肉|回锅肉|腊肉|卤肉|午餐肉/, 'pork'],
  [/沙拉|轻食|蔬菜/, 'salad'],
  [/三明治|帕尼尼|贝果/, 'sandwich'],
  [/面包|欧包|吐司|可颂/, 'bread'],
  [/粥|稀饭/, 'porridge'],
  [/汤|煲/, 'soup'],
  [/米线|米粉|河粉|螺蛳粉|宽粉|粉/, 'noodles'],
  [/面|拌面|拉面|刀削/, 'noodles'],
  [/饭|盖浇|煲仔|拌饭|炒饭/, 'rice'],
  [/早餐|豆浆|油条|煎饼/, 'breakfast'],
  [/水果|鲜果|果切|果盘|草莓|芒果|西瓜|橙子|奇异果|猕猴桃|车厘子|葡萄|哈密瓜/, 'fruit'],
  [/卤味|卤/, 'braised'],
  [/麻辣/, 'spicy'],
  [/口罩|mask/i, 'mask'],
  [/创可贴|绷带|bandage/i, 'bandage'],
  [/维生素|维C|钙片|鱼油|保健品|泡腾片/, 'vitamin'],
  [/洗手液|消毒|酒精|棉签|棉球/, 'sanitizer'],
  [/滴眼液|滴鼻|滴耳|眼药水|泪液|口服液|糖浆|合剂|喷雾|气雾/, 'syrup'],
  [/含片|含漱|颗粒|冲剂|分散片|缓释片|泡腾|丸$|栓|乳膏|凝胶/, 'pill'],
  [/鲜花|花束|玫瑰|百合|康乃馨|向日葵|花店/, 'flower'],
  [/健身|哑铃|瑜伽|跑步|运动/, 'gym'],
  [/药|感冒|板蓝根|连花|胶囊|片剂|软膏|消毒液|碘伏/, 'medicine'],
  [/便利|超市|日用|纸巾/, 'store'],
];

/** 菜名/店名 → 英文品类词（无命中返回 null，由调用方回退商家品类或通用 food） */
export function mtFoodTagOf(name: string): string | null {
  for (const [re, tag] of TAG_RULES) if (re.test(name)) return tag;
  return null;
}

/** 图片槽位（内容匹配图：按关键词生成，同 key 稳定同图 → 可缓存） */
export const MT_IMG: Record<string, string> = {
  burger: mtImg('burger'),
  milktea: mtImg('milk-tea'),
  chicken: mtImg('fried-chicken'),
  malatang: mtImg('hotpot'),
  hotpot: mtImg('hotpot'),
  fruit: mtImg('fruit'),
  store: mtImg('store'),
  pharmacy: mtImg('medicine'),
  rice: mtImg('rice'),
  noodle: mtImg('noodles'),
  pizza: mtImg('pizza'),
  breakfast: mtImg('breakfast'),
  // 菜品补图（按关键词内容匹配；加载失败时 UI 逐级兜底显示灰色占位）
  'cucumber-salad': mtImg('salad'),
  'braised-egg': mtImg('egg'),
  'soymilk': mtImg('soymilk'),
  'suancai-noodle': mtImg('noodles'),
  'egg-tart': mtImg('egg-tart'),
  'cola': mtImg('cola'),
  'sundae': mtImg('sundae'),
  'icecream': mtImg('ice-cream'),
  'milkshake': mtImg('milkshake'),
  'beefroll': mtImg('beef'),
  'kuanfen': mtImg('noodles'),
  'quail-egg': mtImg('quail-egg'),
  'luncheon-meat': mtImg('pork'),
  'suanmeitang': mtImg('juice'),
  'mandarin': mtImg('mandarin'),
  'cherry': mtImg('cherry'),
  'kiwi': mtImg('kiwi'),
  'fruit-mix': mtImg('fruit'),
  'banana': mtImg('banana'),
  'milk': mtImg('milk'),
  'chips': mtImg('fries'),
  'latiao': mtImg('spicy'),
  'tissue': mtImg('tissue'),
  'eggs': mtImg('eggs'),
  'huoxiang': mtImg('medicine'),
  'mask': mtImg('mask'),
  'bandaid': mtImg('bandage'),
  'vitamin-c': mtImg('vitamin'),
  'durian-pizza': mtImg('pizza'),
  'shrimp': mtImg('shrimp'),
  'tomato-rice': mtImg('rice'),
  'potato-rice': mtImg('rice'),
  'seaweed-soup': mtImg('soup'),
  'maodu': mtImg('hotpot'),
  'xiahua': mtImg('hotpot'),
  'potato-slice': mtImg('potato'),
  'frozen-tofu': mtImg('tofu'),
  'youtiao': mtImg('youtiao'),
};

function img(key: string): string | undefined {
  const v = MT_IMG[key];
  return v && v.length > 0 ? v : undefined;
}

/** 菜品优惠券（每道菜一张；满 min 减 amount，min=0 无门槛，下单自动抵扣） */
export interface MtDishCouponDef {
  /** 券名（如 珍珠奶茶专享券） */
  name: string;
  /** 减免金额（减） */
  amount: number;
  /** 使用门槛（满，0 = 无门槛） */
  min: number;
}

export interface MtDish {
  id: string;
  name: string;
  price: number;
  /** 原价（划线价，可选） */
  origPrice?: number;
  emoji: string;
  img?: string;
  desc?: string;
  monthSale: number;
  /** 招牌菜（菜单角标） */
  sig?: boolean;
  /** 规格组（点 + 弹出规格选择弹窗：奶茶=规格/温度/小料/糖度，食物=小料配菜） */
  specs?: MtDishSpec[];
  /** 菜品优惠券：下单含此菜且达门槛自动抵扣（每菜每单限一次） */
  coupon?: MtDishCouponDef;
  /** 售罄/在售开关（true = 已售罄：买家端置灰不可加购，AI 代点/请客自动避开） */
  soldOut?: boolean;
  /** 自建商品元数据（创建订单=创建商品：类型/优惠券名/规格选项组，下单时随订单快照） */
  custom?: OrderCustomMeta;
}

/** 规格选项（price 为加价，如小料 ¥1） */
export interface MtSpecOption {
  label: string;
  price?: number;
}

/** 规格组：单选（默认选第一项）或多选（multi，最多 max 份） */
export interface MtDishSpec {
  /** 组名：规格 / 温度 / 小料 / 糖度 / 小料配菜 / 辣度… */
  name: string;
  /** 多选（默认单选必选） */
  multi?: boolean;
  /** 多选最多可选份数 */
  max?: number;
  options: MtSpecOption[];
}

/** 奶茶饮品通用规格（对齐真机截图：规格/温度/小料（最多可选1份）/糖度） */
function teaSpecs(): MtDishSpec[] {
  return [
    { name: '规格', options: [{ label: '大杯' }, { label: '中杯', price: -1 }] },
    { name: '温度', options: [{ label: '正常冰' }, { label: '少冰' }, { label: '多冰' }, { label: '常温' }, { label: '温热' }, { label: '热' }] },
    {
      name: '小料',
      multi: true,
      max: 1,
      options: [
        { label: '珍珠', price: 1 },
        { label: '奶冻', price: 1 },
        { label: '爆爆珠', price: 1 },
        { label: '椰果', price: 1 },
        { label: '原味果冻', price: 1 },
        { label: '脆啵啵', price: 1 },
      ],
    },
    { name: '糖度', options: [{ label: '正常糖' }, { label: '七分糖' }, { label: '不额外加糖' }, { label: '五分糖' }, { label: '三分糖' }] },
  ];
}

/** 食物小料/配菜通用规格（多选加价） */
function foodSides(opts: { name: string; price: number }[], max = 2, groupName = '小料配菜'): MtDishSpec[] {
  return [{ name: groupName, multi: true, max, options: opts.map((o) => ({ label: o.name, price: o.price })) }];
}

/** 规格工厂再导出（团购购买弹窗内嵌规格/小料选择用） */
export const mtTeaSpecs = teaSpecs;
export const mtFoodSides = foodSides;

export interface MtReview {
  user: string;
  rating: number;
  content: string;
  time: string;
  /** 点赞的评价标签（好评/口味赞/包装好…） */
  tags?: string[];
}

export interface MtMerchant {
  id: string;
  name: string;
  emoji: string;
  /** 门头图（封面，可选） */
  cover?: string;
  /** 覆盖的分类（首页分类入口过滤用） */
  cats: string[];
  rating: number;
  monthSale: number;
  minOrder: number;
  deliveryFee: number;
  distanceKm: number;
  deliveryMin: number;
  notice?: string;
  deals: string[];
  hours: string;
  addr: string;
  /** 菜单分区 */
  sections: { cat: string; dishes: MtDish[] }[];
  reviews: MtReview[];
  /** 商家入驻：本账号自己开的店（首页「我的小店」角标 / 详情页店铺券条） */
  mine?: boolean;
  /** 商家入驻：店铺优惠券（详情页可领，领取后进「红包卡券」结算可用） */
  coupons?: MtShopCouponDef[];
  /** 商家入驻：营业状态（缺省 open；closed = 已打烊，首页不露出、详情页暂停接单） */
  mtStatus?: 'open' | 'closed';
}

/** 商家入驻：店铺优惠券定义（满 min 减 amount，店主自建） */
export interface MtShopCouponDef {
  id: string;
  /** 券名（店铺满减券 / 新客立减券…） */
  name: string;
  /** 减免金额（减） */
  amount: number;
  /** 使用门槛（满） */
  min: number;
}

/** 按名称自动配 emoji（商家入驻：店名/菜名无图时的兜底图），与 mtCountUnit 同风格关键词表 */
const MT_EMOJI_RULES: [RegExp, string][] = [
  [/奶茶|奶绿|奶昔|波霸|芝士茶|水果茶/, '🧋'],
  [/咖啡|拿铁|美式|生椰/, '☕'],
  [/柠檬|果茶|果汁|杨枝甘露|西柚|橙汁/, '🍋'],
  [/可乐|雪碧|汽水|气泡水|苏打/, '🥤'],
  [/汉堡|堡$/, '🍔'],
  [/披萨|比萨/, '🍕'],
  [/薯条|鸡米花|洋葱圈/, '🍟'],
  [/炸鸡|鸡排|鸡翅|鸡腿|鸡块/, '🍗'],
  [/蛋糕|慕斯|泡茨|泡芙|甜点|舒芙蕾|提拉米苏/, '🍰'],
  [/麻辣烫|冒菜|麻辣香锅|火锅/, '🍲'],
  [/粥|包|烧麦|豆浆|油条|煎饼|早茶/, '🥣'],
  [/面|米线|粉丝|螺蛳粉/, '🍜'],
  [/饭|煲仔|盖浇|卤肉|咖喱/, '🍛'],
  [/串|烧烤|烤串|烤肉/, '🍢'],
  [/寿司|刺身|日料/, '🍣'],
  [/水果|草莓|西瓜|芒果|葡萄|橙子|奇异果/, '🍉'],
  [/沙拉|轻食|鸡胸|牛油果/, '🥗'],
  [/饺子|馄饨|云吞/, '🥟'],
  [/龙虾|蟹|虾滑|海鲜/, '🦐'],
  [/牛排|牛肉/, '🥩'],
  [/面包|吐司|三明治|贝果|可颂/, '🥪'],
  [/玉米|红薯|紫薯/, '🌽'],
];

export function mtAutoEmoji(name: string): string {
  const n = name.trim();
  if (!n) return '🍽️';
  for (const [re, e] of MT_EMOJI_RULES) {
    if (re.test(n)) return e;
  }
  return '🍽️';
}

/** 商家筛选分类（分类宫格映射到商家池用） */
export const MT_CATS: { id: string; name: string }[] = [
  { id: 'waimai', name: '外卖' },
  { id: 'meishi', name: '美食' },
  { id: 'chaoshi', name: '超市便利' },
  { id: 'shuiguo', name: '水果' },
  { id: 'maiyao', name: '看病买药' },
  { id: 'yinyin', name: '甜点饮品' },
  { id: 'hamburg', name: '汉堡披萨' },
  { id: 'mala', name: '麻辣烫' },
  { id: 'zaocan', name: '早餐' },
];

/** 首页分类宫格（两页 15 项，对齐真机布局）；用户指定首屏顺序：
 *  外卖、团购、美食、看病买药、休闲玩乐、酒店旅行、电影演出，其余频道依次后移。
 *  icon 为 UI 层 Lucide 线条图标 key（GRID_ICONS 映射）。 */
export interface MtGridCat {
  id: string;
  name: string;
  icon: string;
  /** 商家筛选分类 id；'hotel'/'xiuxian'/'dianying' = 频道页（点击进频道）；其余 null = 演示占位提示 */
  filter?: string | null;
}
export const MT_HOME_GRID: MtGridCat[][] = [
  [
    // 第三十九轮：按需求删除「外卖」宫格项
    { id: 'tuangou', name: '团购', icon: 'Ticket', filter: 'tuangou' },
    { id: 'meishi', name: '美食', icon: 'Utensils', filter: 'meishi' },
    { id: 'yao', name: '看病买药', icon: 'Cross', filter: 'maiyao' },
    { id: 'xiuxian', name: '休闲玩乐', icon: 'Gamepad2', filter: 'xiuxian' },
    { id: 'hotel', name: '酒店旅行', icon: 'Building', filter: 'hotel' },
    { id: 'dianying', name: '电影演出', icon: 'Clapperboard', filter: 'dianying' },
    { id: 'shangou', name: '闪购', icon: 'Zap', filter: 'shangou' },
    { id: 'jipiao', name: '机票火车票', icon: 'Plane', filter: 'travel' },
    { id: 'create', name: '创建商品', icon: 'PackagePlus', filter: 'create' },
    { id: 'manage', name: '管理商品', icon: 'PackageSearch', filter: 'manage' },
  ],
  [
    { id: 'paotui', name: '跑腿', icon: 'Rabbit', filter: null },
    { id: 'liren', name: '丽人美发', icon: 'Scissors', filter: null },
    { id: 'yiliao', name: '医疗牙科', icon: 'Stethoscope', filter: null },
    { id: 'xiaoshuo', name: '免费小说', icon: 'BookOpen', filter: null },
    { id: 'more', name: '更多服务', icon: 'LayoutGrid', filter: null },
  ],
];

// ---------------- 特价团（团购）数据：首页瀑布流 + 团购详情页 + 确认订单页 ----------------

export interface MtDealMenu {
  sec: string;
  items: { name: string; price: number }[];
}

export interface MtDeal {
  id: string;
  merchantId: string;
  /** 套餐标题（如 爆款单人四件套TG1548） */
  title: string;
  img?: string;
  emoji: string;
  /** 团购价（直接购买） */
  price: number;
  /** 原价（划线价 = 商品总价） */
  origPrice: number;
  /** 折扣角标（4.1折） */
  discount: string;
  /** 销量文案（已售58万+） */
  sold: string;
  praise: string;
  /** 履约方式（秒提 / 到店吃） */
  tips: string;
  distanceKm: number;
  /** 可用时间文案（周一至周日可用） */
  usable: string;
  /** 过期提醒 */
  notice: string;
  /** 拼团价（可选，低于直接购买价） */
  groupPrice?: number;
  /** 规格组（购买弹窗内选规格/小料，奶茶=规格/温度/小料/糖度，食物=小料配菜；加价计入实付） */
  specs?: MtDishSpec[];
  /** 可选套餐（购买弹窗内单选，选中后价格/内容联动；2 个以上才出选择器） */
  packages?: MtDealPackage[];
  /** 团购详情（套餐内容清单） */
  menu: MtDealMenu[];
  storeTags: string[];
}

/** 可选套餐（购买弹窗内单选：名称/价格/包含内容） */
export interface MtDealPackage {
  name: string;
  price: number;
  /** 原价（划线价，可选） */
  origPrice?: number;
  /** 套餐包含内容（简短文案清单） */
  items?: string[];
}

const D = (d: MtDeal): MtDeal => d;

export const MT_DEALS: MtDeal[] = [
  D({
    id: 'd-tast-set',
    merchantId: 'm-tasiting',
    title: '爆款单人四件套TG1548',
    img: img('burger'),
    emoji: '🍔',
    price: 13.9,
    origPrice: 34,
    discount: '4.1折',
    sold: '已售58万+',
    praise: '94%好评',
    tips: '秒提',
    distanceKm: 1.2,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，请注意周末、节假日是否可用',
    groupPrice: 11.9,
    packages: [
      { name: 'A套餐·经典四件套', price: 13.9, origPrice: 34, items: ['主食 2选1', '小食 2选1', '冰镇可口可乐（中杯）'] },
      { name: 'B套餐·超值五件套', price: 19.9, origPrice: 46, items: ['主食 2选1', '黄金鸡块（5块）', '香辣鸡翅（2块）', '可口可乐（中杯）'] },
    ],
    specs: foodSides([{ name: '薯条（小份）', price: 3 }, { name: '香辣鸡翅1块', price: 5 }, { name: '可口可乐（中杯）', price: 2 }, { name: '葡式蛋挞', price: 2 }]),
    menu: [
      { sec: '主食 2选1', items: [{ name: '香辣鸡腿中国汉堡', price: 12 }, { name: '藤椒鸡腿中国汉堡', price: 12 }] },
      { sec: '小食 2选1', items: [{ name: '黄金鸡块（5块）', price: 9.9 }, { name: '香辣鸡翅（2块）', price: 10.5 }] },
      { sec: '固选', items: [{ name: '冰镇可口可乐（中杯）', price: 4 }] },
    ],
    storeTags: ['金冠好店', '不可吸烟', '有Wi-Fi', '不可带宠物'],
  }),
  D({
    id: 'd-mixue-hyn',
    merchantId: 'm-mixue',
    title: '厚芋泥奶茶 经典芋泥 3杯',
    img: img('milktea'),
    emoji: '🧋',
    price: 21.6,
    origPrice: 31.5,
    discount: '6.9折',
    sold: '已售20万+',
    praise: '95%好评',
    tips: '秒提',
    distanceKm: 0.8,
    usable: '周一至周日可用',
    notice: '本单将于30天后过期，免预约随时可用',
    groupPrice: 19.6,
    packages: [
      { name: 'A套餐·经典芋泥3杯', price: 21.6, origPrice: 31.5, items: ['厚芋泥奶茶（中杯）×3'] },
      { name: 'B套餐·芋泥奶绿5杯', price: 32.9, origPrice: 52.5, items: ['厚芋泥奶茶（中杯）×2', '茉莉奶绿（中杯）×3'] },
    ],
    specs: teaSpecs(),
    menu: [{ sec: '内含券 3杯', items: [{ name: '厚芋泥奶茶（中杯）', price: 10.5 }, { name: '厚芋泥奶茶（中杯）', price: 10.5 }, { name: '厚芋泥奶茶（中杯）', price: 10.5 }] }],
    storeTags: ['免预约', '随时退'],
  }),
  D({
    id: 'd-mixue-mjlv',
    merchantId: 'm-mixue',
    title: '茉莉奶绿（特价团购）3杯',
    img: img('milktea'),
    emoji: '🍵',
    price: 13.3,
    origPrice: 19.5,
    discount: '6.8折',
    sold: '半年售10万+',
    praise: '93%好评',
    tips: '秒提',
    distanceKm: 0.8,
    usable: '周一至周日可用',
    notice: '本单将于30天后过期，免预约随时可用',
    specs: teaSpecs(),
    menu: [{ sec: '内含券 3杯', items: [{ name: '茉莉奶绿（中杯）', price: 6.5 }, { name: '茉莉奶绿（中杯）', price: 6.5 }, { name: '茉莉奶绿（中杯）', price: 6.5 }] }],
    storeTags: ['免预约', '随时退'],
  }),
  D({
    id: 'd-ygf-set',
    merchantId: 'm-yangguofu',
    title: '麻辣烫单人套餐（番茄微辣）',
    img: img('malatang'),
    emoji: '🍲',
    price: 15.8,
    origPrice: 25,
    discount: '6.3折',
    sold: '已售8万+',
    praise: '92%好评',
    tips: '到店吃',
    distanceKm: 1.5,
    usable: '周一至周五可用',
    notice: '本单将于14天后过期，法定节假日不可用',
    groupPrice: 13.9,
    specs: foodSides([{ name: '宽粉', price: 2 }, { name: '鹌鹑蛋（5个）', price: 3 }, { name: '午餐肉', price: 4 }, { name: '肥牛卷', price: 6 }], 3, '加料'),
    menu: [
      { sec: '主食', items: [{ name: '番茄麻辣烫（微辣）', price: 16.8 }] },
      { sec: '小食', items: [{ name: '宽粉', price: 2 }, { name: '鹌鹑蛋（5个）', price: 3 }] },
      { sec: '饮品', items: [{ name: '酸梅汤（中杯）', price: 5 }] },
    ],
    storeTags: ['金冠好店', '免费Wi-Fi', '可停车'],
  }),
  D({
    id: 'd-zb-pizza',
    merchantId: 'm-pizza',
    title: '9寸金牌比萨 4选1',
    img: img('pizza'),
    emoji: '🍕',
    price: 19.9,
    origPrice: 36,
    discount: '5.5折',
    sold: '已售15万+',
    praise: '94%好评',
    tips: '秒提',
    distanceKm: 2.1,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，随时退·过期自动退',
    groupPrice: 17.9,
    packages: [
      { name: 'A套餐·比萨单人餐', price: 19.9, origPrice: 36, items: ['9寸比萨 4选1', '柠檬红茶（中杯）'] },
      { name: 'B套餐·比萨双享餐', price: 35.9, origPrice: 68, items: ['9寸比萨 4选1×2', '蒜香鸡翅2只', '柠檬红茶（中杯）×2'] },
    ],
    specs: foodSides([{ name: '薯条（小份）', price: 3 }, { name: '蒜香鸡翅2只', price: 7 }, { name: '可乐 1 罐', price: 3 }]),
    menu: [
      { sec: '比萨 4选1', items: [{ name: '超级至尊比萨', price: 36 }, { name: '夏威夷比萨', price: 32 }, { name: '肉香四溢比萨', price: 35 }, { name: '田园风光比萨', price: 28 }] },
      { sec: '固选', items: [{ name: '柠檬红茶（中杯）', price: 6 }] },
    ],
    storeTags: ['金冠好店', '有Wi-Fi'],
  }),
  D({
    id: 'd-fruit-3x1',
    merchantId: 'm-fruit',
    title: '应季鲜果拼盘 3选1',
    img: img('fruit'),
    emoji: '🍓',
    price: 9.9,
    origPrice: 19.9,
    discount: '5折',
    sold: '已售5万+',
    praise: '96%好评',
    tips: '秒提',
    distanceKm: 0.6,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，鲜果当日切配',
    menu: [
      { sec: '鲜果 3选1', items: [{ name: '当季草莓盒（300g）', price: 19.9 }, { name: '海南金菠萝（1个）', price: 12.9 }, { name: '新疆西梅（500g）', price: 19.9 }] },
    ],
    storeTags: ['新鲜直达', '坏果包赔'],
  }),
  D({
    id: 'd-bf-2r',
    merchantId: 'm-breakfast',
    title: '豆浆油条元气早餐 2人份',
    img: img('breakfast'),
    emoji: '🥟',
    price: 6.9,
    origPrice: 12,
    discount: '5.8折',
    sold: '已售12万+',
    praise: '95%好评',
    tips: '到店吃',
    distanceKm: 0.9,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，仅限早餐时段（6:00-10:30）',
    groupPrice: 5.9,
    menu: [
      { sec: '套餐内容', items: [{ name: '现磨豆浆（大杯）×2', price: 4 }, { name: '现炸油条×2', price: 4 }, { name: '鲜肉小笼包（4只）', price: 4 }] },
    ],
    storeTags: ['免预约', '清晨现做'],
  }),
];

/** 首页「特价团聚合卡」（右侧列表位，展示 2 条券） */
export const MT_HOME_LIST: { title: string; badge: string; dealIds: string[] } = {
  title: '十一寻味5折起',
  badge: '特价团',
  dealIds: ['d-mixue-hyn', 'd-zb-pizza'],
};

const R = (user: string, rating: number, content: string, time: string, tags?: string[]): MtReview => ({ user, rating, content, time, tags });

export const MT_MERCHANTS: MtMerchant[] = [
  {
    id: 'm-tasiting',
    name: '塔斯汀中国汉堡（解放南路店）',
    emoji: '🍔',
    cover: img('burger'),
    cats: ['hamburg', 'waimai'],
    rating: 4.8,
    monthSale: 12000,
    minOrder: 20,
    deliveryFee: 2.5,
    distanceKm: 1.2,
    deliveryMin: 35,
    notice: '爆款单人四件套回归，周一至周日可用，过期自动退',
    deals: ['满30减8', '新客立减3'],
    hours: '10:30-22:00',
    addr: '解放大道与民生街向南15米路东',
    sections: [
      {
        cat: '招牌套餐',
        dishes: [
          {
            id: 'ta-set',
            name: '爆款单人四件套',
            price: 13.9,
            origPrice: 34,
            emoji: '🍔',
            img: img('burger'),
            desc: '汉堡2选1+小食2选1+固选可乐，任选搭配',
            monthSale: 580000,
            sig: true,
            specs: foodSides([{ name: '升级大薯条', price: 3 }, { name: '鸡米花', price: 5 }, { name: '葡式蛋挞', price: 2 }]),
          },
          { id: 'ta-set2', name: '炙香鸡肉串（买1送1）', price: 8.9, origPrice: 17.8, emoji: '🍖', img: img('chicken'), desc: '炙香入味，串串满足', monthSale: 12000 },
        ],
      },
      {
        cat: '中国汉堡',
        dishes: [
          { id: 'ta-b1', name: '香辣鸡腿中国汉堡', price: 12, emoji: '🍔', img: img('burger'), desc: '现烤堡胚，香辣多汁', monthSale: 8900, sig: true, specs: foodSides([{ name: '薯条（小份）', price: 3 }, { name: '香辣鸡翅1块', price: 5 }, { name: '可口可乐', price: 2 }, { name: '葡式蛋挞', price: 2 }]) },
          { id: 'ta-b2', name: '藤椒鸡腿中国汉堡', price: 12, emoji: '🍔', img: img('burger'), desc: '藤椒微麻，回味十足', monthSale: 6600, specs: foodSides([{ name: '薯条（小份）', price: 3 }, { name: '香辣鸡翅1块', price: 5 }, { name: '可口可乐', price: 2 }]) },
          { id: 'ta-b3', name: '培根煎蛋中国汉堡', price: 13, emoji: '🍳', img: img('burger'), desc: '培根+煎蛋，早餐也能吃', monthSale: 4300, specs: foodSides([{ name: '豆浆（热）', price: 2 }, { name: '可口可乐', price: 2 }]) },
          { id: 'ta-b4', name: '黄金香酥鸡柳堡', price: 14, emoji: '🍔', img: img('chicken'), desc: '整块鸡柳，外酥里嫩', monthSale: 3900, specs: foodSides([{ name: '薯条（小份）', price: 3 }, { name: '鸡米花', price: 5 }]) },
        ],
      },
      {
        cat: '小食甜品',
        dishes: [
          { id: 'ta-s1', name: '黄金鸡块（5块）', price: 9.9, emoji: '🍗', img: img('chicken'), monthSale: 5200 },
          { id: 'ta-s2', name: '葡式蛋挞（2只）', price: 5.5, emoji: '🥧', img: img('egg-tart'), monthSale: 3100 },
          { id: 'ta-s3', name: '香辣鸡翅（2块）', price: 10.5, emoji: '🍗', img: img('chicken'), monthSale: 4700 },
        ],
      },
      { cat: '饮品', dishes: [{ id: 'ta-d1', name: '冰镇可口可乐', price: 4, emoji: '🥤', img: img('cola'), monthSale: 9800 }] },
    ],
    reviews: [
      R('爱吃汉堡的 leo', 5, '四件套太划算了，汉堡现烤的很香，配送也快，包装完好！', '今天 12:32', ['味道赞', '包装好']),
      R('小柚子', 4.5, '鸡柳堡很酥，可乐冰块多，就是中午高峰送得慢了点。', '昨天 13:05', ['味道赞']),
      R('濮阳小王', 5, '回购 N 次，藤椒堡yyds，满30减8凑单无压力。', '2天前', ['回头客']),
    ],
  },
  {
    id: 'm-mixue',
    name: '蜜雪冰城（城关老街店）',
    emoji: '🧋',
    cover: img('milktea'),
    cats: ['yinyin', 'waimai'],
    rating: 4.9,
    monthSale: 20000,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.6,
    deliveryMin: 25,
    notice: '第二杯半价进行中，冰量糖量可备注',
    deals: ['满10减2', '新客立减3'],
    hours: '09:00-23:00',
    addr: '老街村商业街 18 号',
    sections: [
      {
        cat: '奶茶',
        dishes: [
          { id: 'mx-1', name: '【热销】珍珠奶茶大杯（冷/热）', price: 4.89, origPrice: 9, emoji: '🧋', img: img('milktea'), desc: '经典款，珍珠软糯', monthSale: 99000, sig: true, specs: teaSpecs() },
          { id: 'mx-2', name: '厚芋泥奶茶', price: 4.99, origPrice: 10, emoji: '🍠', img: img('milktea'), desc: '芋泥厚厚一层', monthSale: 66000, specs: teaSpecs() },
          { id: 'mx-3', name: '茉莉奶绿', price: 6.6, emoji: '🍵', img: img('milktea'), monthSale: 33000, specs: teaSpecs() },
        ],
      },
      {
        cat: '柠水冰品',
        dishes: [
          {
            id: 'mx-4',
            name: '冰鲜柠檬水',
            price: 4,
            emoji: '🍋',
            monthSale: 150000,
            sig: true,
            specs: [
              { name: '温度', options: [{ label: '正常冰' }, { label: '少冰' }, { label: '多冰' }, { label: '常温' }] },
              { name: '糖度', options: [{ label: '正常糖' }, { label: '七分糖' }, { label: '不额外加糖' }, { label: '五分糖' }] },
            ],
          },
          { id: 'mx-5', name: '黑糖珍珠大圣代', price: 6.5, emoji: '🍦', img: img('sundae'), monthSale: 28000 },
          { id: 'mx-6', name: '新鲜冰淇淋', price: 3, emoji: '🍨', img: img('icecream'), monthSale: 88000 },
          { id: 'mx-7', name: '摇摇奶昔（草莓）', price: 8, emoji: '🥛', img: img('milkshake'), monthSale: 21000, specs: [{ name: '糖度', options: [{ label: '正常糖' }, { label: '七分糖' }, { label: '不额外加糖' }] }] },
        ],
      },
    ],
    reviews: [
      R('奶茶续命中', 5, '柠檬水永远的神，4块钱快乐一整天。', '今天 15:40', ['性价比高']),
      R('甜甜圈不甜', 4.5, '芋泥奶茶半糖刚好，第二杯半价和朋友拼的。', '昨天 16:22', ['回头客']),
    ],
  },
  {
    id: 'm-yangguofu',
    name: '杨国福麻辣烫（濮阳旗舰店）',
    emoji: '🍲',
    cover: img('malatang'),
    cats: ['mala', 'meishi', 'waimai'],
    rating: 4.7,
    monthSale: 8000,
    minOrder: 20,
    deliveryFee: 3,
    distanceKm: 1.8,
    deliveryMin: 40,
    notice: '汤底可免费续，辣度分微辣/中辣/特辣',
    deals: ['满25减4', '满40减7'],
    hours: '10:00-22:30',
    addr: '红旗路与建设路交叉口南 50 米',
    sections: [
      {
        cat: '招牌麻辣烫',
        dishes: [
          { id: 'yg-1', name: '番茄麻辣烫（微辣）', price: 16.8, emoji: '🍅', img: img('malatang'), desc: '番茄汤底+经典配菜', monthSale: 32000, sig: true, specs: foodSides([{ name: '宽粉', price: 2 }, { name: '蟌鹑蛋（5个）', price: 3 }, { name: '午餐肉', price: 4 }, { name: '肥牛卷', price: 6 }], 3, '加料') },
          { id: 'yg-2', name: '骨汤麻辣烫（不辣）', price: 15.8, emoji: '🥣', img: img('malatang'), monthSale: 26000, specs: foodSides([{ name: '宽粉', price: 2 }, { name: '蟌鹑蛋（5个）', price: 3 }, { name: '午餐肉', price: 4 }], 3, '加料') },
          { id: 'yg-3', name: '金汤肥牛麻辣烫', price: 21.8, emoji: '🌶️', img: img('malatang'), monthSale: 15000, specs: foodSides([{ name: '宽粉', price: 2 }, { name: '金针菇', price: 2 }, { name: '肥牛卷加量', price: 6 }], 3, '加料') },
        ],
      },
      {
        cat: '加料',
        dishes: [
          { id: 'yg-4', name: '肥牛卷', price: 6, emoji: '🥩', img: img('beefroll'), monthSale: 19000 },
          { id: 'yg-5', name: '宽粉', price: 2, emoji: '🍜', img: img('kuanfen'), monthSale: 24000 },
          { id: 'yg-6', name: '鹌鹑蛋（5个）', price: 3, emoji: '🥚', img: img('quail-egg'), monthSale: 12000 },
          { id: 'yg-7', name: '午餐肉', price: 4, emoji: '🥓', img: img('luncheon-meat'), monthSale: 9800 },
          { id: 'yg-8', name: '酸梅汤', price: 5, emoji: '🧃', img: img('suanmeitang'), monthSale: 8600 },
        ],
      },
    ],
    reviews: [
      R('无辣不欢', 5, '金汤肥牛yyds，加了宽粉和肥牛，汤都喝完了。', '今天 18:44', ['味道赞', '分量足']),
      R('小城食客', 4, '送来还是热的，微辣刚好，包装没洒。', '昨天 19:10', ['包装好']),
      R('阿豪', 4.5, '满40减7很划算，两个人吃到撑。', '3天前', ['回头客']),
    ],
  },
  {
    id: 'm-noodle',
    name: '老王家牛肉面（中心店）',
    emoji: '🍜',
    cover: img('noodle'),
    cats: ['meishi', 'waimai'],
    rating: 4.6,
    monthSale: 3500,
    minOrder: 15,
    deliveryFee: 2,
    distanceKm: 0.9,
    deliveryMin: 30,
    notice: '手工现拉，汤底每日现熬',
    deals: ['满20减3'],
    hours: '07:00-21:00',
    addr: '中心广场东侧美食街 6 号',
    sections: [
      {
        cat: '招牌面',
        dishes: [
          { id: 'nd-1', name: '红烧牛肉面', price: 13.8, emoji: '🍜', img: img('noodle'), desc: '牛腱肉大块，汤浓味香', monthSale: 21000, sig: true, specs: [{ name: '面型', options: [{ label: '细面' }, { label: '宽面' }, { label: '刀削面' }] }, foodSides([{ name: '卤蛋', price: 2 }, { name: '涮肥牛', price: 6 }, { name: '青菜', price: 1.5 }], 2, '小料配菜')[0]] },
          { id: 'nd-2', name: '牛肉拌面', price: 14.8, emoji: '🍝', img: img('noodle'), monthSale: 13000, specs: [{ name: '面型', options: [{ label: '细面' }, { label: '宽面' }] }, foodSides([{ name: '卤蛋', price: 2 }, { name: '面筋', price: 2 }], 2, '小料配菜')[0]] },
          { id: 'nd-3', name: '酸菜肉丝面', price: 11.8, emoji: '🍲', img: img('suancai-noodle'), monthSale: 8600, specs: [{ name: '面型', options: [{ label: '细面' }, { label: '宽面' }] }] },
        ],
      },
      {
        cat: '小菜饮品',
        dishes: [
          { id: 'nd-4', name: '凉拌黄瓜', price: 6, emoji: '🥒', img: img('cucumber-salad'), monthSale: 5400 },
          { id: 'nd-5', name: '卤蛋', price: 2, emoji: '🥚', img: img('braised-egg'), monthSale: 8800 },
          { id: 'nd-6', name: '现磨豆浆', price: 4, emoji: '🥛', img: img('soymilk'), monthSale: 6200 },
        ],
      },
    ],
    reviews: [R('面馆常客', 4.5, '牛肉给得实在，汤头很正，配送准时。', '昨天 12:15', ['分量足']), R('小周', 4.5, '拌面香，加个卤蛋完美。', '2天前')],
  },
  {
    id: 'm-fruit',
    name: '鲜丰水果（中心广场店）',
    emoji: '🍓',
    cover: img('fruit'),
    cats: ['shuiguo', 'chaoshi'],
    rating: 4.8,
    monthSale: 5000,
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: 1.5,
    deliveryMin: 45,
    notice: '坏果包赔，现切现送',
    deals: ['满30减5'],
    hours: '08:00-22:00',
    addr: '中心广场北路 22 号',
    sections: [
      {
        cat: '时令鲜果',
        dishes: [
          { id: 'fr-1', name: '当季草莓盒 250g', price: 12.9, emoji: '🍓', img: img('fruit'), monthSale: 8600, sig: true },
          { id: 'fr-2', name: '沙糖桔 2 斤装', price: 9.9, emoji: '🍊', img: img('mandarin'), monthSale: 12000 },
          { id: 'fr-3', name: '车厘子 JJ 250g', price: 29.9, origPrice: 39.9, emoji: '🍒', img: img('cherry'), monthSale: 4300 },
          { id: 'fr-4', name: '猕猴桃 6 个装', price: 12.8, emoji: '🥝', img: img('kiwi'), monthSale: 6100 },
        ],
      },
      {
        cat: '鲜切果盒',
        dishes: [
          { id: 'fr-5', name: '现切西瓜盒 500g', price: 8.8, emoji: '🍉', img: img('fruit'), monthSale: 9800 },
          { id: 'fr-6', name: '混合水果捞', price: 15.8, emoji: '🍇', img: img('fruit-mix'), monthSale: 5200 },
          { id: 'fr-7', name: '进口香蕉 1 把', price: 6.9, emoji: '🍌', img: img('banana'), monthSale: 7700 },
        ],
      },
    ],
    reviews: [R('果粉小刘', 5, '草莓很甜没有坏果，现切西瓜冰镇过。', '今天 10:20', ['新鲜', '坏果包赔']), R('lemon', 4.5, '车厘子个头大，比超市划算。', '昨天 20:02')],
  },
  {
    id: 'm-store',
    name: '惠民优选超市（老街店）',
    emoji: '🛒',
    cover: img('store'),
    cats: ['chaoshi', 'shuiguo'],
    rating: 4.5,
    monthSale: 9000,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.8,
    deliveryMin: 40,
    notice: '24 小时营业，急送必备',
    deals: ['满39减6'],
    hours: '00:00-24:00',
    addr: '老街村退役军人服务站旁',
    sections: [
      {
        cat: '饮品乳品',
        dishes: [
          { id: 'st-1', name: '农夫山泉 550ml×12', price: 16.8, emoji: '💧', img: img('store'), monthSale: 15000, sig: true },
          { id: 'st-2', name: '可口可乐 330ml×6', price: 12, emoji: '🥤', img: img('cola'), monthSale: 11000 },
          { id: 'st-3', name: '纯牛奶 250ml×12', price: 39.9, emoji: '🥛', img: img('milk'), monthSale: 6600 },
        ],
      },
      {
        cat: '零食日用',
        dishes: [
          { id: 'st-4', name: '乐事薯片原味', price: 6.5, emoji: '🥔', img: img('chips'), monthSale: 9900 },
          { id: 'st-5', name: '卫龙辣条大面筋', price: 5.5, emoji: '🌶️', img: img('latiao'), monthSale: 8800 },
          { id: 'st-6', name: '抽纸 8 包整箱', price: 19.9, emoji: '🧻', img: img('tissue'), monthSale: 7200 },
          { id: 'st-7', name: '鲜鸡蛋 30 枚', price: 25.9, emoji: '🥚', img: img('eggs'), monthSale: 5300 },
        ],
      },
    ],
    reviews: [R('夜猫子', 4.5, '半夜点水也送，救急神器。', '昨天 23:40', ['配送快']), R('家庭主妇日常', 4, '鸡蛋完整没碎，价格实惠。', '2天前')],
  },
  {
    id: 'm-pharmacy',
    name: '仁安大药房（解放路店）',
    emoji: '💊',
    cover: img('pharmacy'),
    cats: ['maiyao'],
    rating: 4.9,
    monthSale: 2000,
    minOrder: 0,
    deliveryFee: 3,
    distanceKm: 2.2,
    deliveryMin: 50,
    notice: '执业药师在线咨询，夜间急送',
    deals: ['满99减10'],
    hours: '08:00-22:00',
    addr: '解放路 118 号',
    sections: [
      {
        cat: '感冒发烧',
        dishes: [
          { id: 'ph-1', name: '感冒灵颗粒 10 袋', price: 16.5, emoji: '💊', img: img('pharmacy'), monthSale: 3200, sig: true },
          { id: 'ph-2', name: '布洛芬缓释胶囊 24 粒', price: 19.8, emoji: '💊', img: img('pharmacy'), monthSale: 2600 },
        ],
      },
      {
        cat: '常备保健',
        dishes: [
          { id: 'ph-3', name: '藿香正气水 10 支', price: 12.8, emoji: '🧴', img: img('huoxiang'), monthSale: 1800 },
          { id: 'ph-4', name: '医用外科口罩 50 只', price: 15.9, emoji: '😷', img: img('mask'), monthSale: 4400 },
          { id: 'ph-5', name: '创可贴 100 片装', price: 9.9, emoji: '🩹', img: img('bandaid'), monthSale: 2100 },
          { id: 'ph-6', name: '维生素 C 咀嚼片', price: 29.9, emoji: '🍊', img: img('vitamin-c'), monthSale: 1500 },
        ],
      },
    ],
    reviews: [R('宝妈小赵', 5, '孩子半夜发烧，30分钟送到，救急！', '今天 02:15', ['配送快', '夜间送']), R('健身达人', 4.5, '维C正品，药师还电话确认了用法。', '昨天 11:30', ['服务好'])],
  },
  {
    id: 'm-pizza',
    name: '尊宝比萨（濮阳店）',
    emoji: '🍕',
    cover: img('pizza'),
    cats: ['hamburg', 'meishi'],
    rating: 4.7,
    monthSale: 6000,
    minOrder: 39,
    deliveryFee: 4,
    distanceKm: 2.6,
    deliveryMin: 50,
    notice: '现拍现烤，9寸两人食刚好',
    deals: ['满59减12'],
    hours: '10:00-22:00',
    addr: '濮上中路 66 号',
    sections: [
      {
        cat: '比萨',
        dishes: [
          { id: 'pz-1', name: '经典夏威夷比萨 9 寸', price: 35.9, emoji: '🍕', img: img('pizza'), desc: '菠萝+火腿，咸甜经典', monthSale: 14000, sig: true, specs: [{ name: '饼底', options: [{ label: '经典手拍' }, { label: '芝士心卷边', price: 4 }] }, foodSides([{ name: '薯条（小份）', price: 3 }, { name: '蒜香鸡翅2只', price: 7 }, { name: '可乐 1 罐', price: 3 }], 2, '小料配菜')[0]] },
          { id: 'pz-2', name: '意式肉酱比萨 9 寸', price: 39.9, emoji: '🍕', img: img('pizza'), monthSale: 9900, specs: [{ name: '饼底', options: [{ label: '经典手拍' }, { label: '芝士心卷边', price: 4 }] }] },
          { id: 'pz-3', name: '榴莲比萨 9 寸', price: 49.9, emoji: '🍕', img: img('durian-pizza'), monthSale: 7700, sig: true, specs: [{ name: '饼底', options: [{ label: '经典手拍' }, { label: '芝士心卷边', price: 4 }] }] },
        ],
      },
      {
        cat: '小食饮品',
        dishes: [
          { id: 'pz-4', name: '蒜香鸡翅 6 只', price: 19.9, emoji: '🍗', img: img('chicken'), monthSale: 6600 },
          { id: 'pz-5', name: '黄金蝴蝶虾', price: 22, emoji: '🦐', img: img('shrimp'), monthSale: 4300 },
          { id: 'pz-6', name: '可乐 3 罐', price: 9.9, emoji: '🥤', img: img('cola'), monthSale: 8800 },
        ],
      },
    ],
    reviews: [R('披萨控', 5, '榴莲比萨料超足，拉丝绝了。', '昨天 19:30', ['味道赞', '分量足']), R('周末家庭日', 4.5, '满59减12，两个比萨才50块。', '3天前', ['回头客'])],
  },
  {
    id: 'm-rice',
    name: '川湘人家·盖浇饭（红旗路店）',
    emoji: '🍚',
    cover: img('rice'),
    cats: ['meishi', 'waimai'],
    rating: 4.6,
    monthSale: 4200,
    minOrder: 18,
    deliveryFee: 2,
    distanceKm: 1.1,
    deliveryMin: 35,
    notice: '小炒现做，米饭免费加',
    deals: ['满25减4', '满35减6'],
    hours: '10:30-21:30',
    addr: '红旗路 33 号附 2',
    sections: [
      {
        cat: '招牌盖浇饭',
        dishes: [
          { id: 'rc-1', name: '鱼香肉丝盖浇饭', price: 15.8, emoji: '🍛', img: img('rice'), monthSale: 18000, sig: true, specs: foodSides([{ name: '卤蛋', price: 2 }, { name: '紫菜蛋花汤', price: 3 }, { name: '可乐 1 罐', price: 3 }]) },
          { id: 'rc-2', name: '宫保鸡丁盖浇饭', price: 16.8, emoji: '🍛', img: img('rice'), monthSale: 15000, specs: foodSides([{ name: '卤蛋', price: 2 }, { name: '可乐 1 罐', price: 3 }]) },
          { id: 'rc-3', name: '红烧肉盖浇饭', price: 19.8, emoji: '🍖', img: img('rice'), monthSale: 12000, sig: true, specs: foodSides([{ name: '卤蛋', price: 2 }, { name: '青菜', price: 1.5 }]) },
          { id: 'rc-4', name: '番茄鸡蛋盖浇饭', price: 13.8, emoji: '🍅', img: img('tomato-rice'), monthSale: 9900 },
          { id: 'rc-5', name: '酸辣土豆丝盖浇饭', price: 12.8, emoji: '🥔', img: img('potato-rice'), monthSale: 8600 },
        ],
      },
      { cat: '汤羹', dishes: [{ id: 'rc-6', name: '紫菜蛋花汤', price: 4, emoji: '🥣', img: img('seaweed-soup'), monthSale: 6600 }] },
    ],
    reviews: [R('打工人午餐', 4.5, '鱼香肉丝下饭，米饭给了双份。', '今天 12:40', ['分量足']), R('湘妹子', 4.5, '红烧肉软烂入味，满35减6划算。', '昨天 18:55', ['回头客'])],
  },
  {
    id: 'm-hotpot',
    name: '鲜货火锅串串（怡景花园店）',
    emoji: '🍲',
    cover: img('hotpot'),
    cats: ['meishi', 'mala'],
    rating: 4.8,
    monthSale: 3000,
    minOrder: 59,
    deliveryFee: 5,
    distanceKm: 3.1,
    deliveryMin: 60,
    notice: '锅底+食材全套配齐，到家开火即食',
    deals: ['满99减15'],
    hours: '11:00-23:00',
    addr: '怡景花园西区商业街 8 号',
    sections: [
      {
        cat: '锅底',
        dishes: [
          { id: 'hp-1', name: '鸳鸯锅底（微辣/菌汤）', price: 29.8, emoji: '🍲', img: img('hotpot'), monthSale: 8600, sig: true, specs: foodSides([{ name: '精品肥牛卷', price: 26.8 }, { name: '鲜毛肚', price: 22.8 }, { name: '宽粉', price: 4.8 }], 3, '加菜') },
          { id: 'hp-2', name: '重庆牛油红锅', price: 26.8, emoji: '🌶️', img: img('hotpot'), monthSale: 6600, specs: [{ name: '辣度', options: [{ label: '微辣' }, { label: '中辣' }, { label: '特辣' }] }, foodSides([{ name: '精品肥牛卷', price: 26.8 }, { name: '鲜毛肚', price: 22.8 }], 3, '加菜')[0]] },
        ],
      },
      {
        cat: '涮品',
        dishes: [
          { id: 'hp-3', name: '精品肥牛卷', price: 26.8, emoji: '🥩', img: img('beefroll'), monthSale: 9900 },
          { id: 'hp-4', name: '鲜毛肚', price: 22.8, emoji: '🍖', img: img('maodu'), monthSale: 7700, sig: true },
          { id: 'hp-5', name: '手打虾滑', price: 19.8, emoji: '🦐', img: img('xiahua'), monthSale: 6600 },
          { id: 'hp-6', name: '土豆片', price: 4.8, emoji: '🥔', img: img('potato-slice'), monthSale: 5200 },
          { id: 'hp-7', name: '宽粉', price: 4.8, emoji: '🍜', img: img('kuanfen'), monthSale: 6100 },
          { id: 'hp-8', name: '冻豆腐', price: 5.8, emoji: '🧊', img: img('frozen-tofu'), monthSale: 4300 },
          { id: 'hp-9', name: '唯怡豆奶 9 罐', price: 6, emoji: '🥛', img: img('soymilk'), monthSale: 3800 },
        ],
      },
    ],
    reviews: [R('火锅之夜', 5, '套餐齐全，连电磁炉都带了，满意！', '昨天 20:10', ['分量足', '包装好']), R('深夜食堂', 4.5, '毛肚脆嫩，红锅够味。', '2天前', ['味道赞'])],
  },
  {
    id: 'm-breakfast',
    name: '一品粥·早点铺（南门店）',
    emoji: '🥟',
    cover: img('breakfast'),
    cats: ['zaocan', 'meishi'],
    rating: 4.7,
    monthSale: 2600,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.7,
    deliveryMin: 25,
    notice: '上午 10 点前下单立减 2 元',
    deals: ['满12减2'],
    hours: '05:30-10:30',
    addr: '南门早市街 3 号',
    sections: [
      {
        cat: '粥品汤点',
        dishes: [
          { id: 'bf-1', name: '皮蛋瘦肉粥', price: 7.8, emoji: '🥣', img: img('breakfast'), monthSale: 9900, sig: true },
          { id: 'bf-2', name: '鲜肉馄饨（10个）', price: 9.8, emoji: '🥟', img: img('breakfast'), monthSale: 7700 },
        ],
      },
      {
        cat: '面点炸物',
        dishes: [
          { id: 'bf-3', name: '小笼包（6个）', price: 8.8, emoji: '🥟', img: img('breakfast'), monthSale: 8800 },
          { id: 'bf-4', name: '现炸油条', price: 3, emoji: '🥖', img: img('youtiao'), monthSale: 11000 },
          { id: 'bf-5', name: '茶叶蛋', price: 2, emoji: '🥚', img: img('braised-egg'), monthSale: 9600 },
          { id: 'bf-6', name: '现磨豆浆', price: 2.5, emoji: '🥛', img: img('soymilk'), monthSale: 12000 },
        ],
      },
    ],
    reviews: [R('早起打工人', 5, '油条配豆浆，上班路上的灵魂。', '今天 07:50', ['配送快']), R('粥粥', 4.5, '瘦肉粥料多，小笼包皮薄。', '昨天 08:15', ['味道赞'])],
  },
  // ---- 看病买药种子池扩充（AI 限流兜底时保证药店名称/数据各不相同，不再全是同一家） ----
  {
    id: 'm-ph-yifeng',
    name: '益丰堂大药房（建设路店）',
    emoji: '💊',
    cover: mtImg('medicine', 480, 360, 1, 'c'),
    cats: ['maiyao'],
    rating: 4.8,
    monthSale: 5600,
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: 0.9,
    deliveryMin: 40,
    notice: '执业药师在线，24 小时应急送药',
    deals: ['满88减12'],
    hours: '08:00-23:00',
    addr: '建设路 56 号',
    sections: [
      {
        cat: '感冒发烧',
        dishes: [
          { id: 'ph2-1', name: '复方感冒灵颗粒 9 袋', price: 14.8, emoji: '💊', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 4100, sig: true },
          { id: 'ph2-2', name: '对乙酰氨基酚片 16 片', price: 11.5, emoji: '💊', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 2900 },
          { id: 'ph2-3', name: '连花清瘟胶囊 24 粒', price: 21.9, emoji: '💊', img: mtImg('medicine', 400, 400, 3, 'f'), monthSale: 3300 },
        ],
      },
      {
        cat: '常备保健',
        dishes: [
          { id: 'ph2-4', name: '医用退热贴 4 贴装', price: 12.9, emoji: '🩹', img: img('bandaid'), monthSale: 1900 },
          { id: 'ph2-5', name: '维生素 D 钙软胶囊', price: 39.9, emoji: '🍊', img: img('vitamin-c'), monthSale: 1500 },
          { id: 'ph2-6', name: '一次性医用口罩 100 只', price: 24.9, emoji: '😷', img: img('mask'), monthSale: 5200 },
        ],
      },
    ],
    reviews: [R('夜班护士', 5, '凌晨两点买退烧药，25 分钟送到。', '今天 02:30', ['夜间送', '配送快']), R('老张头', 4.5, '药师打电话叮嘱用量，很负责。', '昨天 09:10', ['服务好'])],
  },
  {
    id: 'm-ph-baixin',
    name: '百信医药连锁（朝阳路店）',
    emoji: '🏥',
    cover: mtImg('medicine', 480, 360, 2, 'c'),
    cats: ['maiyao'],
    rating: 4.6,
    monthSale: 3100,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 1.4,
    deliveryMin: 35,
    notice: '医保定点，慢性病用药齐全',
    deals: ['满59减6', '满129减16'],
    hours: '07:30-22:30',
    addr: '朝阳路 210 号',
    sections: [
      {
        cat: '肠胃用药',
        dishes: [
          { id: 'ph3-1', name: '健胃消食片 64 片', price: 13.6, emoji: '💊', img: mtImg('medicine', 400, 400, 4, 'f'), monthSale: 3600, sig: true },
          { id: 'ph3-2', name: '蒙脱石散 10 袋', price: 16.8, emoji: '💊', img: mtImg('medicine', 400, 400, 5, 'f'), monthSale: 2200 },
          { id: 'ph3-3', name: '奥美拉唑肠溶胶囊 20 粒', price: 19.5, emoji: '💊', img: mtImg('medicine', 400, 400, 6, 'f'), monthSale: 1700 },
        ],
      },
      {
        cat: '皮肤护理',
        dishes: [
          { id: 'ph3-4', name: '红霉素软膏 10g', price: 6.5, emoji: '🧴', img: mtImg('medicine', 400, 400, 7, 'f'), monthSale: 2600 },
          { id: 'ph3-5', name: '碘伏消毒液 500ml', price: 9.9, emoji: '🧴', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 1400 },
          { id: 'ph3-6', name: '防水创可贴 60 片', price: 10.9, emoji: '🩹', img: img('bandaid'), monthSale: 3100 },
        ],
      },
    ],
    reviews: [R('宝妈小周', 5, '宝宝退热贴到得快，包装密封好。', '昨天 15:40', ['配送快']), R('跑步达人', 4, '碘伏创可贴常备，性价比高。', '2天前')],
  },
  {
    id: 'm-ph-jimin',
    name: '济民健康药房（文化路店）',
    emoji: '💊',
    cover: mtImg('medicine', 480, 360, 3, 'c'),
    cats: ['maiyao'],
    rating: 4.9,
    monthSale: 4200,
    minOrder: 18,
    deliveryFee: 2.5,
    distanceKm: 2.8,
    deliveryMin: 55,
    notice: '执业药师在线咨询，正品保障',
    deals: ['满99减15'],
    hours: '08:30-22:00',
    addr: '文化路 88 号附 1',
    sections: [
      {
        cat: '慢病用药',
        dishes: [
          { id: 'ph4-1', name: '苯磺酸氨氯地平片 28 片', price: 25.9, emoji: '💊', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 1800, sig: true },
          { id: 'ph4-2', name: '二甲双胍缓释片 30 片', price: 21.5, emoji: '💊', img: mtImg('medicine', 400, 400, 3, 'f'), monthSale: 1600 },
        ],
      },
      {
        cat: '医疗器械',
        dishes: [
          { id: 'ph4-3', name: '电子血压计 臂式', price: 129, emoji: '🩺', img: mtImg('medicine', 400, 400, 4, 'f'), monthSale: 920 },
          { id: 'ph4-4', name: '红外体温计 额温枪', price: 89, emoji: '🌡️', img: mtImg('medicine', 400, 400, 5, 'f'), monthSale: 1100 },
          { id: 'ph4-5', name: '血糖试纸 50 片装', price: 59.9, emoji: '🩸', img: mtImg('medicine', 400, 400, 6, 'f'), monthSale: 780 },
        ],
      },
    ],
    reviews: [R('孝顺儿子', 5, '给老爸买血压计，药师教了怎么用。', '昨天 11:20', ['服务好']), R('慢病管理', 4.5, '降压药每次都在这家买，正品放心。', '3天前', ['回头客'])],
  },
  {
    id: 'm-ph-tongze',
    name: '同泽大药房（人民路店）',
    emoji: '🏥',
    cover: mtImg('medicine', 480, 360, 4, 'c'),
    cats: ['maiyao'],
    rating: 4.5,
    monthSale: 1800,
    minOrder: 0,
    deliveryFee: 0,
    distanceKm: 0.6,
    deliveryMin: 30,
    notice: '免配送费，最近药房 28 分钟达',
    deals: ['新客立减3元'],
    hours: '00:00-24:00',
    addr: '人民路 19 号',
    sections: [
      {
        cat: '急用常备',
        dishes: [
          { id: 'ph5-1', name: '藿香正气水 10 支', price: 12.8, emoji: '🧴', img: img('huoxiang'), monthSale: 2100, sig: true },
          { id: 'ph5-2', name: '开塞露 20ml×2', price: 5.5, emoji: '💊', img: mtImg('medicine', 400, 400, 7, 'f'), monthSale: 1300 },
          { id: 'ph5-3', name: '晕车贴 6 片装', price: 14.9, emoji: '🩹', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 860 },
        ],
      },
      {
        cat: '营养保健',
        dishes: [
          { id: 'ph5-4', name: '蛋白粉 450g 罐装', price: 128, emoji: '🥛', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 420 },
          { id: 'ph5-5', name: '复合维生素 60 片', price: 79, emoji: '🍊', img: img('vitamin-c'), monthSale: 640 },
        ],
      },
    ],
    reviews: [R('附近居民', 4.5, '免配送费还这么快，半夜买药全靠它。', '今天 01:10', ['夜间送', '配送快']), R('出差党', 4, '晕车贴救命，客服还提醒了用法。', '昨天 08:30')],
  },
  {
    id: 'm-ph-huimin',
    name: '惠民医药商场（东风路店）',
    emoji: '🏬',
    cover: mtImg('medicine', 480, 360, 5, 'c'),
    cats: ['maiyao'],
    rating: 4.7,
    monthSale: 6500,
    minOrder: 0,
    deliveryFee: 3,
    distanceKm: 3.5,
    deliveryMin: 60,
    notice: '医药商场式大卖场，品类两万+',
    deals: ['满199减25', '满399减60'],
    hours: '08:00-22:00',
    addr: '东风路 321 号',
    sections: [
      {
        cat: '家庭药箱',
        dishes: [
          { id: 'ph6-1', name: '家庭急救药箱套装', price: 99, emoji: '🧰', img: mtImg('medicine', 400, 400, 3, 'f'), monthSale: 720, sig: true },
          { id: 'ph6-2', name: '酒精棉片 100 片', price: 8.9, emoji: '🩹', img: mtImg('medicine', 400, 400, 4, 'f'), monthSale: 2800 },
          { id: 'ph6-3', name: '纱布绷带套装', price: 15.9, emoji: '🩹', img: mtImg('medicine', 400, 400, 5, 'f'), monthSale: 980 },
        ],
      },
      {
        cat: '滋补养生',
        dishes: [
          { id: 'ph6-4', name: '枸杞子 250g 特级', price: 32.9, emoji: '🔴', img: mtImg('medicine', 400, 400, 6, 'f'), monthSale: 1600 },
          { id: 'ph6-5', name: '红枣夹核桃 500g', price: 45.9, emoji: '🥜', img: mtImg('medicine', 400, 400, 7, 'f'), monthSale: 1100 },
          { id: 'ph6-6', name: '金银花茶 40g', price: 19.9, emoji: '🍵', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 890 },
        ],
      },
    ],
    reviews: [R('囤货妈妈', 5, '满199减25，一次把药箱配齐了。', '昨天 16:50', ['分量足', '划算']), R('养生青年', 4.5, '枸杞很饱满，无硫熏。', '2天前', ['回头客'])],
  },
  {
    id: 'm-ph-xinglin',
    name: '杏林大药房（学院路店）',
    emoji: '💊',
    cover: mtImg('medicine', 480, 360, 6, 'c'),
    cats: ['maiyao'],
    rating: 4.4,
    monthSale: 990,
    minOrder: 0,
    deliveryFee: 1,
    distanceKm: 1.1,
    deliveryMin: 32,
    notice: '学生认证立减，期末应急必备',
    deals: ['满39减4'],
    hours: '09:00-21:30',
    addr: '学院路 8 号',
    sections: [
      {
        cat: '学生常备',
        dishes: [
          { id: 'ph7-1', name: '感冒清热颗粒 12 袋', price: 12.5, emoji: '💊', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 1100, sig: true },
          { id: 'ph7-2', name: '西瓜霜含片 24 片', price: 9.8, emoji: '💊', img: mtImg('medicine', 400, 400, 3, 'f'), monthSale: 1500 },
          { id: 'ph7-3', name: '眼药水 10ml 人工泪液', price: 26.9, emoji: '💧', img: mtImg('medicine', 400, 400, 4, 'f'), monthSale: 1300 },
        ],
      },
      {
        cat: '个护清洁',
        dishes: [
          { id: 'ph7-4', name: '免洗洗手液 500ml', price: 12.9, emoji: '🧴', img: mtImg('medicine', 400, 400, 5, 'f'), monthSale: 900 },
          { id: 'ph7-5', name: '酒精喷雾 100ml', price: 9.9, emoji: '🧴', img: mtImg('medicine', 400, 400, 6, 'f'), monthSale: 760 },
        ],
      },
    ],
    reviews: [R('考研人', 4.5, '熬夜上火，含片眼药水一起下单。', '昨天 23:20', ['配送快']), R('大学生小林', 4, '学生认证减了 3 块，划算。', '3天前')],
  },
  {
    id: 'm-ph-huichun',
    name: '回春堂药房（老城十字街店）',
    emoji: '🌿',
    cover: mtImg('medicine', 480, 360, 7, 'c'),
    cats: ['maiyao'],
    rating: 4.8,
    monthSale: 2400,
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: 1.8,
    deliveryMin: 45,
    notice: '中药饮片代煎，坐堂中医问诊',
    deals: ['满79减8'],
    hours: '08:30-20:30',
    addr: '老城十字街 42 号',
    sections: [
      {
        cat: '中药饮片',
        dishes: [
          { id: 'ph8-1', name: '黄芪 100g 甘肃岷县', price: 23.9, emoji: '🌿', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 820, sig: true },
          { id: 'ph8-2', name: '当归片 100g', price: 28.9, emoji: '🌿', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 610 },
          { id: 'ph8-3', name: '酸枣仁 150g', price: 39.9, emoji: '🌿', img: mtImg('medicine', 400, 400, 3, 'f'), monthSale: 450 },
        ],
      },
      {
        cat: '代煎汤剂',
        dishes: [
          { id: 'ph8-4', name: '祛湿茶 7 袋装', price: 36, emoji: '🍵', img: mtImg('medicine', 400, 400, 4, 'f'), monthSale: 990 },
          { id: 'ph8-5', name: '秋梨膏 1 瓶', price: 45, emoji: '🍯', img: mtImg('medicine', 400, 400, 5, 'f'), monthSale: 380 },
          { id: 'ph8-6', name: '足浴包 10 袋', price: 25.9, emoji: '🦶', img: mtImg('medicine', 400, 400, 6, 'f'), monthSale: 720 },
        ],
      },
    ],
    reviews: [R('养生阿姨', 5, '代煎好的汤剂温热送达，太方便。', '昨天 10:05', ['服务好']), R('程序员养生', 4.5, '祛湿茶喝了两周，有效果。', '2天前', ['回头客'])],
  },
  {
    id: 'm-ph-taikang',
    name: '泰安康医药（新华路店）',
    emoji: '🏥',
    cover: mtImg('medicine', 480, 360, 8, 'c'),
    cats: ['maiyao'],
    rating: 4.3,
    monthSale: 760,
    minOrder: 15,
    deliveryFee: 1.5,
    distanceKm: 2.4,
    deliveryMin: 50,
    notice: '夜间值班药房，22 点后照常接单',
    deals: ['夜间送药'],
    hours: '00:00-24:00',
    addr: '新华路 156 号',
    sections: [
      {
        cat: '夜间应急',
        dishes: [
          { id: 'ph9-1', name: '布洛芬混悬液 儿童用', price: 26.9, emoji: '💊', img: mtImg('medicine', 400, 400, 7, 'f'), monthSale: 640, sig: true },
          { id: 'ph9-2', name: '体温计 水银家用', price: 8.5, emoji: '🌡️', img: mtImg('medicine', 400, 400, 1, 'f'), monthSale: 520 },
          { id: 'ph9-3', name: '口服补液盐 Ⅲ', price: 15.9, emoji: '💊', img: mtImg('medicine', 400, 400, 2, 'f'), monthSale: 380 },
        ],
      },
      {
        cat: '母婴用品',
        dishes: [
          { id: 'ph9-4', name: '婴儿护脐贴 10 片', price: 16.9, emoji: '🩹', img: img('bandaid'), monthSale: 260 },
          { id: 'ph9-5', name: '婴幼儿退热贴 6 贴', price: 18.9, emoji: '🩹', img: img('bandaid'), monthSale: 410 },
        ],
      },
    ],
    reviews: [R('新手爸爸', 4.5, '孩子半夜发烧，混悬液 40 分钟到。', '今天 03:05', ['夜间送', '配送快']), R('宝妈圈推荐', 4, '夜里能送药的店不多了，收藏了。', '昨天 21:40')],
  },
  // ---- 甜点饮品 / 早餐种子池扩充（同因：分类池过薄时兜底重复） ----
  {
    id: 'm-sweet',
    name: '甜屿·手作甜品（万象城店）',
    emoji: '🍰',
    cover: mtImg('dessert', 480, 360, 1, 'c'),
    cats: ['yinyin', 'meishi'],
    rating: 4.8,
    monthSale: 3800,
    minOrder: 0,
    deliveryFee: 2.5,
    distanceKm: 1.9,
    deliveryMin: 40,
    notice: '每日现烤，售完即止',
    deals: ['满49减8'],
    hours: '10:00-22:00',
    addr: '万象城 L3 层 302',
    sections: [
      {
        cat: '现烤甜品',
        dishes: [
          { id: 'sw-1', name: '巴斯克焦香芝士 6 寸', price: 46, emoji: '🍰', img: mtImg('dessert', 400, 400, 1, 'f'), monthSale: 2100, sig: true },
          { id: 'sw-2', name: '芋泥麻薯盒子 350g', price: 22.9, emoji: '🍮', img: mtImg('dessert', 400, 400, 2, 'f'), monthSale: 2600 },
          { id: 'sw-3', name: '杨枝甘露杯', price: 16.9, emoji: '🍧', img: mtImg('dessert', 400, 400, 3, 'f'), monthSale: 3100 },
        ],
      },
      {
        cat: '小蛋糕',
        dishes: [
          { id: 'sw-4', name: '提拉米苏 2 件装', price: 29.9, emoji: '🍰', img: mtImg('dessert', 400, 400, 4, 'f'), monthSale: 1700 },
          { id: 'sw-5', name: '半熟芝士挞 4 枚', price: 25.9, emoji: '🥧', img: img('egg-tart'), monthSale: 1400 },
        ],
      },
    ],
    reviews: [R('甜品脑袋', 5, '巴斯克一开盒就香，芝士味很浓。', '昨天 14:20', ['味道赞']), R('下午茶搭子', 4.5, '杨枝甘露料足，芒果很甜。', '2天前', ['回头客'])],
  },
  {
    id: 'm-coffee',
    name: '拾光咖啡·鲜萃（文创园店）',
    emoji: '☕',
    cover: mtImg('coffee', 480, 360, 1, 'c'),
    cats: ['yinyin'],
    rating: 4.7,
    monthSale: 2600,
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: 2.3,
    deliveryMin: 38,
    notice: '自家烘焙豆，每周三更新豆单',
    deals: ['双杯立减6'],
    hours: '08:00-20:00',
    addr: '文创园 A 区 12 号',
    sections: [
      {
        cat: '经典咖啡',
        dishes: [
          { id: 'cf-1', name: '燕麦拿铁（大杯）', price: 22, emoji: '☕', img: mtImg('coffee', 400, 400, 1, 'f'), monthSale: 2900, sig: true },
          { id: 'cf-2', name: '冰美式（大杯）', price: 16.9, emoji: '🧊', img: mtImg('coffee', 400, 400, 2, 'f'), monthSale: 3300 },
          { id: 'cf-3', name: '生椰dirty', price: 25, emoji: '🥥', img: mtImg('coffee', 400, 400, 3, 'f'), monthSale: 1800 },
        ],
      },
      {
        cat: '轻食简餐',
        dishes: [
          { id: 'cf-4', name: '芝士培根可颂', price: 18.9, emoji: '🥐', img: img('sandwich'), monthSale: 990 },
          { id: 'cf-5', name: '凯撒鸡肉沙拉', price: 26.9, emoji: '🥗', img: img('salad'), monthSale: 760 },
        ],
      },
    ],
    reviews: [R('咖啡续命', 5, '冰美式浓度够，下午不打瞌睡。', '昨天 13:10', ['味道赞']), R('园区上班族', 4.5, '可颂酥脆，配拿铁刚好。', '3天前')],
  },
  {
    id: 'm-zaojiang',
    name: '老磨坊·豆浆油条（早市东街店）',
    emoji: '🥛',
    cover: mtImg('breakfast', 480, 360, 2, 'c'),
    cats: ['zaocan', 'meishi'],
    rating: 4.6,
    monthSale: 4100,
    minOrder: 0,
    deliveryFee: 1,
    distanceKm: 0.9,
    deliveryMin: 25,
    notice: '现磨现炸，早上 6 点开炉',
    deals: ['满15减3'],
    hours: '06:00-10:30',
    addr: '早市东街 15 号',
    sections: [
      {
        cat: '现炸现磨',
        dishes: [
          { id: 'zj-1', name: '现磨浓豆浆（大杯）', price: 3, emoji: '🥛', img: img('soymilk'), monthSale: 6200, sig: true },
          { id: 'zj-2', name: '老面油条 2 根', price: 5, emoji: '🥖', img: img('youtiao'), monthSale: 5800 },
          { id: 'zj-3', name: '现烙鸡蛋饼', price: 7.5, emoji: '🥞', img: mtImg('breakfast', 400, 400, 1, 'f'), monthSale: 3600 },
        ],
      },
      {
        cat: '早点套餐',
        dishes: [
          { id: 'zj-4', name: '豆浆+油条+茶叶蛋', price: 9.9, emoji: '🥣', img: mtImg('breakfast', 400, 400, 2, 'f'), monthSale: 4400 },
          { id: 'zj-5', name: '豆腐脑（咸/甜）', price: 5.5, emoji: '🍲', img: mtImg('breakfast', 400, 400, 3, 'f'), monthSale: 2900 },
        ],
      },
    ],
    reviews: [R('早八人', 5, '油条酥脆，豆浆浓，9 块9吃到撑。', '今天 07:30', ['分量足']), R('遛弯大爷', 4.5, '豆腐脑卤子香，天天来。', '昨天 06:50', ['回头客'])],
  },
  {
    id: 'm-zhoupu',
    name: '三姐妹粥铺·现烙盒子（南关早市店）',
    emoji: '🥣',
    cover: mtImg('breakfast', 480, 360, 3, 'c'),
    cats: ['zaocan'],
    rating: 4.5,
    monthSale: 1900,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 1.6,
    deliveryMin: 30,
    notice: '砂锅现熬粥，韭菜盒子现烙',
    deals: ['满20减4'],
    hours: '05:30-11:00',
    addr: '南关早市 27 号',
    sections: [
      {
        cat: '砂锅现熬',
        dishes: [
          { id: 'zp-1', name: '南瓜小米粥（砂锅）', price: 6.9, emoji: '🥣', img: mtImg('breakfast', 400, 400, 4, 'f'), monthSale: 2100, sig: true },
          { id: 'zp-2', name: '皮蛋瘦肉粥（砂锅）', price: 9.9, emoji: '🥣', img: mtImg('breakfast', 400, 400, 5, 'f'), monthSale: 1800 },
        ],
      },
      {
        cat: '现烙盒子',
        dishes: [
          { id: 'zp-3', name: '韭菜鸡蛋盒子 2 个', price: 10, emoji: '🥟', img: mtImg('breakfast', 400, 400, 6, 'f'), monthSale: 1600 },
          { id: 'zp-4', name: '酱香饼 一角', price: 4.5, emoji: '🫓', img: mtImg('breakfast', 400, 400, 7, 'f'), monthSale: 1300 },
          { id: 'zp-5', name: '茶叶蛋 2 枚', price: 4, emoji: '🥚', img: img('braised-egg'), monthSale: 2000 },
        ],
      },
    ],
    reviews: [R('南关老街坊', 5, '小米粥熬得米油都出来了。', '昨天 07:10', ['味道赞']), R('晨跑党', 4, '韭菜盒子现烙的，趁热吃最佳。', '2天前')],
  },
];

// ================================ AI 生成内容注册表（信息流动态注入，仅展示用） ================================
// AI 生成的商家/团购在运行时注册进这里：详情页/购买弹窗/购物车等既有链路通过
// mtMerchantOf / mtDealOf 无感命中，不改任何调用方；刷新后清空（内容本来就是每次重新生成的）
const AI_MERCHANTS = new Map<string, MtMerchant>();
const AI_DEALS = new Map<string, MtDeal>();

/** 注册 AI 生成的商家（同 id 覆盖；第十三轮起 AI 自主入驻的店也走这里，随 mt-ai-registry 持久化，刷新恢复） */
export function mtRegisterAiMerchant(m: MtMerchant): void {
  AI_MERCHANTS.set(m.id, m);
  try {
    mtPersistAiRegistry();
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 商家入驻：批量注册当前账号的自有店铺（App 启动恢复 / 保存后即时生效，同 id 覆盖） */
export function mtRegisterMyMerchants(list: MtMerchant[]): void {
  for (const m of list) {
    if (m.id.startsWith('my-shop-')) AI_MERCHANTS.set(m.id, m);
  }
}

/** 商家入驻：注销单个自有店铺（删除店铺时调用） */
export function mtUnregisterMerchant(id: string): void {
  if (id.startsWith('my-shop-')) AI_MERCHANTS.delete(id);
}

/** 商家入驻：注销全部自有店铺（退出登录/切换账号时调用，防止跨账号残留搜索池） */
export function mtUnregisterMyMerchants(): void {
  for (const id of [...AI_MERCHANTS.keys()]) {
    if (id.startsWith('my-shop-')) AI_MERCHANTS.delete(id);
  }
}

/** 注册 AI 生成的团购（同 id 覆盖） */
export function mtRegisterAiDeal(d: MtDeal): void {
  AI_DEALS.set(d.id, d);
}

// ---------------- 自建商品注册表（第三十六轮：创建订单=创建商品，mtc-shop-* 商家 + 单菜品） ----------------
// 「创建订单」保存的是商品（不是订单）：商品以 mtc-shop-* 自建商家的形式注册进运行时注册表，
// 商家页/购物车/结算/下单等既有链路通过 mtMerchantOf / mtFindDish 无感命中，不改任何调用方；
// 持久化按账号隔离（mt-custom-shops:<uid>，meituan-store），进 App 恢复注册。

/** 注册自建商品商家（同 id 覆盖） */
export function mtRegisterCustomMerchant(m: MtMerchant): void {
  if (m.id.startsWith('mtc-shop-')) AI_MERCHANTS.set(m.id, m);
}

/** 批量注册自建商品商家（进 App 恢复用） */
export function mtRegisterCustomMerchants(list: MtMerchant[]): void {
  for (const m of list) mtRegisterCustomMerchant(m);
}

/** 注销单个自建商品商家（删除商品时调用） */
export function mtUnregisterCustomMerchant(id: string): void {
  if (id.startsWith('mtc-')) AI_MERCHANTS.delete(id);
}

/** 全部自建商品商家（首页「我的商品」区展示用） */
export function mtCustomMerchantsAll(): MtMerchant[] {
  return [...AI_MERCHANTS.values()].filter((m) => m.id.startsWith('mtc-shop-'));
}

// ---------------- 店铺头像/背景（第三十七轮：所有店铺统一品牌） ----------------
// 头像 = 「该用户正在营业」印章图，背景 = 「欢迎光临」手绘图——预置/AI 生成/自建店铺全部生效；
// 商品详情(商家页)里点头像可用「设置 › 图像生成」的模型生成新头像（覆盖存储，全局 kv）。

export const MT_SHOP_AVATAR = '/shop-avatar.png';
export const MT_SHOP_BG = '/shop-bg.png';

const SHOP_AVATAR_KEY = 'mt-shop-avatars';
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
export function mtShopAvatarOf(merchantId: string): string {
  return shopAvatarMap()[merchantId] ?? MT_SHOP_AVATAR;
}

/** 写店铺头像覆盖（商家页点头像生成后调用；运行时缓存 + kv 持久化） */
export function mtSetShopAvatar(merchantId: string, src: string): void {
  const map = shopAvatarMap();
  map[merchantId] = src;
  shopAvatarCache = map;
  try {
    kvSet(SHOP_AVATAR_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

// ---------------- 商品图生成覆盖（第三十七轮：商品详情界面点图可生成，自建+原有商品通用） ----------------
// 生成结果：mutate 内存菜品对象（预置/AI/自建统一即时生效）+ 全局 kv 持久化（防刷新丢失）；
// App 启动/登录恢复时调 mtApplyProductImgOverrides() 把覆盖写回内存对象。

const PRODUCT_IMG_KEY = 'mt-product-imgs';
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

/** 在全部商家（AI 注册表 + 预置种子）+ AI 自主补菜注册表里找到菜品并改图。
 *  AI 补菜（mt-ai-dish-registry）必须覆盖：否则给补菜生成的图只在当次会话生效，
 *  刷新后补菜对象由注册表重建、图丢失（生成的图片必须永久保存，除非重新生成）。 */
function mutateDishImg(dishId: string, src: string): boolean {
  for (const m of AI_MERCHANTS.values()) {
    for (const sec of m.sections) {
      const d = sec.dishes.find((x) => x.id === dishId);
      if (d) {
        d.img = src;
        return true;
      }
    }
  }
  for (const m of MT_MERCHANTS) {
    for (const sec of m.sections) {
      const d = sec.dishes.find((x) => x.id === dishId);
      if (d) {
        d.img = src;
        return true;
      }
    }
  }
  for (const arr of ensureAiDishRegistry().values()) {
    const d = arr.find((x) => x.id === dishId);
    if (d) {
      d.img = src;
      return true;
    }
  }
  return false;
}

/** 读商品图覆盖（美团代点草稿卡等快照渲染点实时升级真图用；无覆盖返回 null） */
export function mtProductImgOverride(dishId: string): string | null {
  const ov = productImgMap()[dishId];
  return typeof ov === 'string' && ov.startsWith('data:image/') ? ov : null;
}

/** 写商品图覆盖（商品详情界面点击图片生成成功后调用；mutate + 持久化，所有渲染点即时生效） */
export function mtSetProductImg(dishId: string, src: string): void {
  const map = productImgMap();
  map[dishId] = src;
  productImgCache = map;
  mutateDishImg(dishId, src);
  try {
    kvSet(PRODUCT_IMG_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 团购图同理：在 AI 团购注册表 + 预置团购里找到并改图（生成的图必须永久保存，除非重新生成） */
function mutateDealImg(dealId: string, src: string): void {
  const ai = AI_DEALS.get(dealId);
  if (ai) {
    ai.img = src;
    return;
  }
  const seed = MT_DEALS.find((d) => d.id === dealId);
  if (seed) seed.img = src;
}

/** 写团购图覆盖（团购详情页点图生成成功后调用；mutate + 持久化，与菜品覆盖共用同一张 kv 表，id 不冲突） */
export function mtSetDealImg(dealId: string, src: string): void {
  const map = productImgMap();
  map[dealId] = src;
  productImgCache = map;
  mutateDealImg(dealId, src);
  try {
    kvSet(PRODUCT_IMG_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 启动恢复：把已持久化的商品图覆盖写回内存菜品对象（App 登录/恢复时调用一次） */
export function mtApplyProductImgOverrides(): void {
  const map = productImgMap();
  for (const [dishId, src] of Object.entries(map)) {
    if (!mutateDishImg(dishId, src)) mutateDealImg(dishId, src);
  }
}

/** 删除商品图覆盖（自建商品删除时调用：商品没了覆盖不再有意义，防 kv 无限膨胀） */
export function mtDeleteProductImg(dishId: string): void {
  const map = productImgMap();
  if (!(dishId in map)) return;
  delete map[dishId];
  productImgCache = map;
  try {
    kvSet(PRODUCT_IMG_KEY, map);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 按 id 查商家（AI 生成优先，种子数据兜底） */
export function mtMerchantOf(id: string): MtMerchant | undefined {
  return AI_MERCHANTS.get(id) ?? MT_MERCHANTS.find((m) => m.id === id);
}

/** 全量商家（种子 + AI 动态注册），搜索池用 */
export function mtAllMerchants(): MtMerchant[] {
  return [...AI_MERCHANTS.values(), ...MT_MERCHANTS];
}

/** 按 id 查团购（AI 生成优先，种子数据兜底） */
export function mtDealOf(id: string): MtDeal | undefined {
  return AI_DEALS.get(id) ?? MT_DEALS.find((d) => d.id === id);
}

// ---------------- AI 生成内容持久化（Task 46：美团点开不刷新，缓存上次刷新的内容） ----------------
// 旧口径：AI 商家/团购仅运行时注册表，页面刷新即丢 → 每次进 App 都重新生成骨架。
// 新口径：注册表全量持久化 kv（全局一份，不含 my-shop-* 自有店铺——那套已有独立持久化），
// 首页信息流存条目引用（id），恢复时经 mtMerchantOf/mtDealOf 解析，任何既有链路无感命中。

const AI_REGISTRY_KEY = 'mt-ai-registry';
const AI_REGISTRY_CAP = 60;

let aiRegistryRestored = false;

/** 恢复 AI 商家/团购注册表（幂等；PhoneShell 开机门控后 kvGet 同步可读） */
export function mtRestoreAiRegistry(): void {
  if (aiRegistryRestored) return;
  aiRegistryRestored = true;
  try {
    const v = kvGet(AI_REGISTRY_KEY) as { merchants?: unknown; deals?: unknown } | null;
    if (!v) return;
    if (Array.isArray(v.merchants)) {
      for (const m of v.merchants) {
        if (m && typeof m === 'object' && typeof (m as MtMerchant).id === 'string' && typeof (m as MtMerchant).name === 'string' && Array.isArray((m as MtMerchant).sections)) {
          AI_MERCHANTS.set((m as MtMerchant).id, m as MtMerchant);
        }
      }
    }
    if (Array.isArray(v.deals)) {
      for (const d of v.deals) {
        if (d && typeof d === 'object' && typeof (d as MtDeal).id === 'string' && typeof (d as MtDeal).title === 'string') {
          AI_DEALS.set((d as MtDeal).id, d as MtDeal);
        }
      }
    }
  } catch {
    /* 坏数据忽略：走重新生成路径 */
  }
}

/** 持久化 AI 商家/团购注册表（封顶淘汰最旧；my-shop-* 自有店铺 / mtc-* 自建商品不在此存——各自有独立持久化） */
export function mtPersistAiRegistry(): void {
  try {
    const merchants = [...AI_MERCHANTS.values()].filter((m) => !m.id.startsWith('my-shop-') && !m.id.startsWith('mtc-shop-')).slice(-AI_REGISTRY_CAP);
    const deals = [...AI_DEALS.values()].slice(-AI_REGISTRY_CAP);
    kvSet(AI_REGISTRY_KEY, { merchants, deals });
  } catch {
    /* 存储不可用忽略 */
  }
}

/** 菜品全局索引（搜索用；含 AI 注册表 → 商家入驻的菜品也能搜到） */
export function mtFindDish(id: string): { merchant: MtMerchant; dish: MtDish } | undefined {
  for (const m of mtAllMerchants()) {
    for (const sec of m.sections) {
      const d = sec.dishes.find((x) => x.id === id);
      if (d) return { merchant: m, dish: d };
    }
  }
  return undefined;
}

/** 菜单所有菜（购物车金额计算用；含 AI 自主补的菜） */
export function mtDishesOf(m: MtMerchant): MtDish[] {
  return [...m.sections.flatMap((s) => s.dishes), ...mtAiDishesOf(m.id)];
}

// ---------------- AI 自主补菜注册表（Task 26：AI 代点/请客/自己点时菜单没有的菜自动创建） ----------------
// 与 AI 商家注册表同款：Map + kv 持久化（'mt-ai-dish-registry'，{ merchantId: dishes[] }）；
// 消费方 mtDishesOf 合并返回（代点解析/购物车金额计算/AI 推荐自动看见 AI 补的菜，下单链路零改动）。

const AI_DISH_REGISTRY_KEY = 'mt-ai-dish-registry';
const AI_DISH_PER_MERCHANT_CAP = 80;
const AI_DISH_MERCHANT_CAP = 40;

let aiDishRegistry: Map<string, MtDish[]> | null = null;

/** 惰性恢复（幂等）：kvGet 开机门控后同步可读，聊天里 AI 代点不经过美团 App 也能拿到 */
function ensureAiDishRegistry(): Map<string, MtDish[]> {
  if (aiDishRegistry) return aiDishRegistry;
  aiDishRegistry = new Map();
  try {
    const v = kvGet(AI_DISH_REGISTRY_KEY) as Record<string, unknown> | null;
    if (v && typeof v === 'object') {
      for (const [mid, dishes] of Object.entries(v)) {
        if (!Array.isArray(dishes)) continue;
        const ok = (dishes as unknown[]).filter(
          (d): d is MtDish => Boolean(d) && typeof (d as MtDish).id === 'string' && typeof (d as MtDish).name === 'string' && typeof (d as MtDish).price === 'number',
        );
        if (ok.length > 0) aiDishRegistry.set(mid, ok);
      }
    }
  } catch {
    /* 坏数据忽略 */
  }
  return aiDishRegistry;
}

/** 注册 AI 补的菜（同名幂等；持久化；商家数封顶 LRU 淘汰最旧） */
export function mtRegisterAiDish(merchantId: string, dish: MtDish): void {
  const reg = ensureAiDishRegistry();
  const arr = reg.get(merchantId) ?? [];
  if (arr.some((d) => d.name === dish.name)) return;
  arr.push(dish);
  reg.delete(merchantId); // 重插尾部 = LRU
  reg.set(merchantId, arr);
  while (reg.size > AI_DISH_MERCHANT_CAP) {
    const oldest = reg.keys().next().value;
    if (oldest === undefined) break;
    reg.delete(oldest);
  }
  try {
    const obj: Record<string, MtDish[]> = {};
    for (const [k, v] of reg) obj[k] = v.slice(-AI_DISH_PER_MERCHANT_CAP);
    kvSet(AI_DISH_REGISTRY_KEY, obj);
  } catch {
    /* 存储不可用忽略 */
  }
}

/** AI 补的菜（商家维度） */
export function mtAiDishesOf(merchantId: string): MtDish[] {
  return ensureAiDishRegistry().get(merchantId) ?? [];
}

// ================================ 优惠券（我的券）种子数据 ================================

/** 券类型：外卖 / 到店（美食）/ 酒店民宿 / 闪购 */
export type MtCouponType = 'waimai' | 'daodian' | 'hotel' | 'shangou';

export interface MtCouponSeed {
  /** 券名（外卖夜宵神券） */
  name: string;
  type: MtCouponType;
  /** 神券角标（橙红渐变） */
  god: boolean;
  /** 面额（30元） */
  amount: number;
  /** 门槛（满60可用） */
  min: number;
  /** 相对获得时刻的过期偏移（毫秒）；倒计时类券用短偏移 */
  ttl: number;
}

const DAY = 86_400_000;

/** 首次进入「我的券」播种（对齐真机截图1：外卖神券×2 + 新客到店×2 + 酒店民宿×2） */
export const MT_COUPON_SEED: MtCouponSeed[] = [
  { name: '外卖夜宵神券', type: 'waimai', god: true, amount: 30, min: 60, ttl: 2 * DAY - 60_000 },
  { name: '外卖大额神券', type: 'waimai', god: true, amount: 24, min: 68, ttl: 2 * 3600_000 + 45 * 60_000 + 7_000 },
  { name: '【新客专享】玩乐变美通用券', type: 'daodian', god: true, amount: 7, min: 10, ttl: 7 * DAY },
  { name: '【娱乐专享】境外酒店100元券', type: 'hotel', god: false, amount: 100, min: 10000, ttl: 7 * DAY },
  { name: '【娱乐专享】境外酒店100元券', type: 'hotel', god: false, amount: 100, min: 3333, ttl: 7 * DAY },
  { name: '【新客专享】玩乐变美通用券', type: 'daodian', god: true, amount: 6, min: 10, ttl: 7 * DAY },
  { name: '外卖满减券', type: 'waimai', god: false, amount: 5, min: 20, ttl: 5 * DAY },
  { name: '到店立减券', type: 'daodian', god: false, amount: 3, min: 10, ttl: 5 * DAY },
];

/** 「一键领取/领神券」发放的 3 张会员神券（可重复触发则跳过同名单） */
export const MT_GOD_CLAIMS: MtCouponSeed[] = [
  { name: '外卖大额神券', type: 'waimai', god: true, amount: 12, min: 50, ttl: 3 * DAY },
  { name: '堂食膨胀神券', type: 'daodian', god: true, amount: 11, min: 30, ttl: 3 * DAY },
  { name: '堂食神券', type: 'daodian', god: true, amount: 7, min: 15, ttl: 3 * DAY },
];

/** 券类型角标文案 */
export const MT_COUPON_TYPE_LABEL: Record<MtCouponType, string> = {
  waimai: '外卖',
  daodian: '到店',
  hotel: '酒店/民宿',
  shangou: '闪购',
};
