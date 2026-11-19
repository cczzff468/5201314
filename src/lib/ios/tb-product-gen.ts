/**
 * 淘宝本地商品生成器（Task 61）：
 * - 「把全部东西的图片都做出来」的数据侧保障：全品类目录（数码/家电/服饰/美妆/家居/玩具/运动/文具…）
 *   与 public/goods 卡通图 1:1 对齐——生成器只会产出有专属图片的品类，订单/信息流/搜索任何
 *   商品都必定有图，不缺图不显示；
 * - 3C 按用户要求带真实品牌+型号组合：华为/小米/苹果/三星/vivo/iQOO（Z9/Z10）/OPPO/荣耀、
 *   iPhone 12~17、MateBook、iPad……；口红带品牌（迪奥/卡姿兰/兰蔻/圣罗兰…）×质地（唇釉/口红/
 *   唇泥/唇膏/唇蜜）×21 个色号（蜜桃粉~枣泥红），质地/色号进购买弹窗（SKU 面板）；
 * - 确定性生成（同 seed 同结果）：信息流分页溢出/刷新兜底/搜索无限下滑跨重启可复现；
 * - 领券中心组合式无限出券（品类 × 券种 × 面额），替代固定 16 张循环池——刷新必出不同券；
 * - 关键词 → 品类映射（搜索「手机支架」「口红」「牛仔裤」…直接生成对应品类商品）。
 */
import {
  TB_LIP_KINDS,
  TB_LIP_COLORS,
  tbImg,
  tbShopIdForTag,
  type TbCatId,
  type TbProduct,
  type TbSkuGroup,
} from './taobao-data';

// ---------------- 确定性随机 ----------------

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** mulberry32：seed → 确定性伪随机序列 */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(arr: readonly T[], r: () => number): T => arr[Math.floor(r() * arr.length) % arr.length];

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- 通用色板 / 尺码 ----------------

const COLORS_TECH = ['曜金黑', '冰晶蓝', '流光银', '午夜色', '星光色', '樱花粉'];
const COLORS_SOFT = ['云雾白', '优雅黑', '雾霾蓝', '樱花粉', '奶杏色', '抹茶绿'];
const COLORS_WARM = ['奶油白', '雾霾蓝', '焦糖色', '抹茶绿', '樱花粉'];
const CLOTH_SIZE: TbSkuGroup = {
  name: '尺码',
  options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }, { label: '2XL', priceDelta: 5 }],
};
const SHOE_SIZE: TbSkuGroup = {
  name: '尺码',
  options: [{ label: '36' }, { label: '37' }, { label: '38' }, { label: '39' }, { label: '40' }, { label: '41' }, { label: '42' }, { label: '43' }],
};

/** 颜色分类组（缩略图用同品类图不同变体） */
function colorGroup(tag: string, names: string[]): TbSkuGroup {
  return { name: '颜色分类', options: names.map((n, i) => ({ label: n, img: tbImg(tag, 120, 120, i % 4) })) };
}

// ---------------- 口红：品牌 × 质地 × 21 色号（质地是商品类型进标题；弹窗只选色号） ----------------

export const LIP_BRANDS = ['迪奥', '卡姿兰', '兰蔻', '圣罗兰', '纪梵希', '香奈儿', '阿玛尼', '花知晓', '完美日记', '花西子', '橘朵', '毛戈平'];
const LIP_KINDS = TB_LIP_KINDS;
const LIP_COLORS = TB_LIP_COLORS;

// ---------------- 手机存储容量（用户指定档位） ----------------

const PHONE_STORAGE: Array<[string, number]> = [
  ['4GB+16GB', 0],
  ['6GB+16GB', 100],
  ['12GB+128GB', 300],
  ['16GB+128GB', 400],
  ['8GB+256GB', 500],
  ['12GB+256GB', 600],
  ['12GB+512GB', 1000],
  ['16GB+1TB', 1500],
];

// ---------------- 3C 品牌型号库 ----------------

const PHONE_BRANDS: Array<[string, string[], number]> = [
  ['Apple/苹果', ['iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15', 'iPhone 16', 'iPhone 16 Pro', 'iPhone 17', 'iPhone 17 Pro'], 4399],
  ['华为', ['Mate 60', 'Mate 70', 'Mate 70 Pro', 'Pura 70', 'nova 13', 'nova 12 活力版'], 3299],
  ['小米', ['小米15', '小米15 Ultra', '小米14', 'Redmi K80', 'Redmi Note 14 Pro', 'Redmi Turbo 4'], 2199],
  ['三星', ['Galaxy S25', 'Galaxy S24', 'Galaxy Z Flip6', 'Galaxy A55'], 3599],
  ['vivo', ['X200', 'X100s', 'S20', 'Y300'], 2699],
  ['iQOO', ['Z9', 'Z10', '13', 'Neo 10'], 1899],
  ['OPPO', ['Reno13', 'Find X8'], 2499],
  ['一加', ['Ace 5', 'Ace 3 Pro'], 2899],
  ['真我', ['GT7 Pro', '13 Pro+', 'Neo 7'], 1899],
  ['荣耀', ['Magic7', '100', 'X60 Pro', 'Play 9T'], 1799],
];

const LAPTOP_BRANDS: Array<[string, string[], number]> = [
  ['联想', ['小新16', '拯救者Y7000P', 'ThinkBook 14+', '拯救者R9000P'], 4499],
  ['华为', ['MateBook D14', 'MateBook 14', 'MateBook X Pro'], 4899],
  ['Apple/苹果', ['MacBook Air 13', 'MacBook Pro 14'], 7999],
  ['小米', ['RedmiBook Pro 14', 'RedmiBook 16'], 3299],
  ['华硕', ['天选5 Pro', '灵耀14', 'a豆14'], 4599],
  ['戴尔', ['灵越14 Pro', '游匣G15'], 4999],
  ['惠普', ['星Book Pro 14', '暗影精灵10'], 4699],
];

const TABLET_BRANDS: Array<[string, string[], number]> = [
  ['Apple/苹果', ['iPad 10', 'iPad Air 6', 'iPad Pro 11'], 2599],
  ['华为', ['MatePad 11.5S', 'MatePad Pro 13.2', 'MatePad SE'], 1699],
  ['小米', ['平板7 Pro', 'Redmi Pad Pro'], 1599],
  ['荣耀', ['平板9', 'MagicPad2'], 1399],
  ['vivo', ['Pad3 Pro'], 2199],
  ['iQOO', ['Pad2 Pro'], 2299],
];

const BUDGET_BRANDS = ['倍思', '绿联', '闪魔', '亿色', '品胜', '毕亚兹', '摩米士', '图拉斯', '罗马仕', '紫米'];
const AUDIO_BRANDS = ['漫步者', '小米', '华为', 'OPPO', 'vivo', 'iQOO', '荣耀', '倍思', 'QCY', '联想'];
const APP_BRANDS = ['美的', '海尔', '格力', '小米', '海信', '容声', '奥克斯', 'TCL', '九阳', '苏泊尔', '小熊', '松下'];
const FASHION_BRANDS = ['优衣库', '太平鸟', '森马', '海澜之家', 'UR', 'ONLY', '波司登', '李宁', '安踏', '真维斯', '韩都衣舍', '绫致'];
const SHOE_BRANDS = ['回力', '李宁', '安踏', '特步', '鸿星尔克', '361°', '匹克', '足力健', '红蜻蜓', '百丽'];
const BEAUTY_BRANDS = ['花知晓', '完美日记', '花西子', '橘朵', '卡姿兰', '珀莱雅', '自然堂', '百雀羚', '薇诺娜', '韩束'];
const HOME_BRANDS = ['林氏家居', '源氏木语', '全友家居', '网易严选', '南极人', '水星家纺', '罗莱', '富安娜', '洁丽雅', '大白兔优品'];
const FOOD_BRANDS = ['三只松鼠', '良品铺子', '百草味', '来伊份', '卫龙', '旺旺', '奥利奥', '乐事', '徐福记', '稻香村'];

// ---------------- 品类目录（tag 必须与 public/goods 图 1:1，生成器只出有图的品类） ----------------

interface GenCat {
  tag: string;
  cat: TbCatId;
  /** 搜索关键词（命中即生成该品类） */
  kws: RegExp;
  /** 标题构造：r=确定性随机 */
  title: (r: () => number) => string;
  /** 价格区间 */
  price: [number, number];
  /** SKU 组（购买弹窗） */
  sku: (r: () => number) => TbSkuGroup[];
  /** 挂载店铺 id 候选（空 = 按 tag 归类匹配店铺，否则全店轮转） */
  shops?: string[];
  /** 补充搜索同义词 */
  extraKws?: RegExp;
}

function skuOf(...groups: TbSkuGroup[]): TbSkuGroup[] {
  return groups;
}

const GEN_CATS: GenCat[] = [
  // ================= 数码 =================
  {
    tag: 'phone',
    cat: 'digital',
    kws: /手机(?!支架)|电话|iphone|苹果|iqoo|oppo|vivo手机|三星手机|华为手机|小米手机|荣耀手机/i,
    title: (r) => {
      const [brand, models] = pick(PHONE_BRANDS, r);
      const model = pick(models, r);
      const color = pick(COLORS_TECH, r);
      return `${brand} ${model} ${pick(['全新国行', '官方正品', '旗舰新品'], r)} ${color} 全网通5G手机 ${pick(['拍照旗舰', '长续航', '电竞游戏', '轻薄手感'], r)}`;
    },
    price: [1099, 8999],
    sku: (r) => skuOf(
      colorGroup('phone', COLORS_TECH),
      { name: '存储容量', options: PHONE_STORAGE.map(([label, delta]) => ({ label, priceDelta: delta || undefined })) },
      { name: '网络类型', options: [{ label: '5G全网通' }] },
      { name: '套餐类型', options: [{ label: '官方标配' }, { label: '套餐一（壳膜+充电器）', priceDelta: 59 }] },
      { name: '版本类型', options: [{ label: '中国大陆' }] },
      { name: '发货方式', options: [{ label: '仓库直发' }] },
    ),
    shops: ['s-erye', 's-keke', 's-digital2', 's-guohuo'],
  },
  {
    tag: 'laptop',
    cat: 'digital',
    kws: /笔记本(?!电脑桌)|电脑(?!桌)|macbook|游戏本|商务本/i,
    title: (r) => {
      const [brand, models] = pick(LAPTOP_BRANDS, r);
      const ram = pick(['16G', '24G', '32G'], r);
      const ssd = pick(['512G', '1T'], r);
      return `${brand} ${pick(models, r)} ${pick(['2026新款', '轻薄本', '高性能标压'], r)} ${ram}+${ssd} ${pick(['2.8K高色域屏', '背光键盘', '金属机身', '长续航办公'], r)} 笔记本电脑`;
    },
    price: [3299, 9999],
    sku: () => skuOf(
      colorGroup('laptop', ['银色', '深空灰', '星光色']),
      { name: '配置', options: [{ label: '16G+512G' }, { label: '32G+1T', priceDelta: 600 }] },
      { name: '网络类型', options: [{ label: '5G全网通' }] },
      { name: '套餐类型', options: [{ label: '官方标配' }] },
      { name: '版本类型', options: [{ label: '中国大陆' }] },
      { name: '发货方式', options: [{ label: '仓库直发' }] },
    ),
    shops: ['s-keke', 's-erye'],
  },
  {
    tag: 'tablet',
    cat: 'digital',
    kws: /平板|ipad|matepad/i,
    title: (r) => {
      const [brand, models] = pick(TABLET_BRANDS, r);
      const inch = pick(['11', '11.5', '12.4', '13.2'], r);
      return `${brand} ${pick(models, r)} ${inch}英寸${pick(['2.5K', '120Hz高刷', '2.8K'], r)} 平板电脑 ${pick(['学习办公', '网课娱乐', '影音大屏'], r)}`;
    },
    price: [1099, 7999],
    sku: () => skuOf(
      colorGroup('tablet', ['深空灰', '银色', '星光色']),
      { name: '版本', options: [{ label: '8G+128G' }, { label: '8G+256G', priceDelta: 200 }] },
      { name: '网络类型', options: [{ label: '5G全网通' }] },
      { name: '套餐类型', options: [{ label: '官方标配' }] },
      { name: '版本类型', options: [{ label: '中国大陆' }] },
      { name: '发货方式', options: [{ label: '仓库直发' }] },
    ),
    shops: ['s-erye', 's-keke'],
  },
  {
    tag: 'earbuds',
    cat: 'digital',
    kws: /耳机|airpods|降噪/i,
    title: (r) => `${pick(AUDIO_BRANDS, r)} 真无线蓝牙耳机 ${pick(['主动降噪', '半入耳佩戴', '入耳式'], r)} ${pick(['超长续航', '杜比全景声', '低延迟游戏'], r)}`,
    price: [99, 1299],
    sku: () => skuOf(colorGroup('earbuds', COLORS_SOFT), { name: '版本', options: [{ label: '标准版' }, { label: '旗舰版', priceDelta: 70 }] }),
    shops: ['s-guohuo', 's-erye'],
  },
  {
    tag: 'watch',
    cat: 'digital',
    kws: /手表|手环|watch/i,
    title: (r) => `${pick(AUDIO_BRANDS, r)} 智能手表 ${pick(['运动血氧心率监测', '蓝牙通话', 'eSIM独立通信'], r)} ${pick(['超长续航', 'NFC门禁', '大屏高清'], r)}`,
    price: [159, 2999],
    sku: () => skuOf(colorGroup('watch', ['曜石黑', '流沙金', '樱花粉']), { name: '表带', options: [{ label: '硅胶带' }, { label: '真皮带', priceDelta: 30 }] }),
    shops: ['s-digital2', 's-erye'],
  },
  {
    tag: 'camera',
    cat: 'digital',
    kws: /相机|微单|单反|摄影/i,
    title: (r) => `${pick(['佳能', '索尼', '富士', '尼康', '松下'], r)} ${pick(['微单相机', '数码相机', '复古CCD相机'], r)} ${pick(['4K视频', 'vlog入门', '学生入门款'], r)} ${pick(['翻转屏', '防抖', '变焦套机'], r)}`,
    price: [899, 9999],
    sku: () => skuOf({ name: '套装', options: [{ label: '单机' }, { label: '16-50套机', priceDelta: 400 }, { label: '18-55套机+内存卡', priceDelta: 620 }] }),
    shops: ['s-erye', 's-keke'],
  },
  {
    tag: 'keyboard',
    cat: 'digital',
    kws: /键盘|机械键盘/i,
    title: (r) => `${pick(['罗技', '雷蛇', '达尔优', '腹灵', 'VGN', 'AKKO'], r)} 机械键盘 ${pick(['98配列', '87配列', '75配列'], r)} ${pick(['三模连接', '有线单模'], r)} ${pick(['RGB背光', '热插拔轴体'], r)} ${pick(['红轴', '茶轴', '青轴'], r)}轴`,
    price: [99, 899],
    sku: () => skuOf({ name: '轴体', options: [{ label: '红轴' }, { label: '茶轴' }, { label: '青轴' }, { label: '佳达隆黄轴', priceDelta: 20 }] }, colorGroup('keyboard', ['黑色', '白色', '奶油黄'])),
    shops: ['s-erye'],
  },
  {
    tag: 'mouse',
    cat: 'digital',
    kws: /鼠标/i,
    title: (r) => `${pick(['罗技', '雷蛇', '英菲克', '达尔优', '双飞燕'], r)} 无线鼠标 ${pick(['静音办公', '电竞游戏', '轻量化'], r)} ${pick(['可充电', '蓝牙双模', '2.4G无线'], r)}`,
    price: [29.9, 499],
    sku: () => skuOf(colorGroup('mouse', COLORS_SOFT)),
    shops: ['s-erye'],
  },
  {
    tag: 'monitor',
    cat: 'digital',
    kws: /显示器|屏幕/i,
    title: (r) => `${pick(['AOC', '戴尔', '小米', 'HKC', '飞利浦', '泰坦军团'], r)} 显示器 ${pick(['24', '27', '31.5'], r)}英寸 ${pick(['2K', '4K', '1080P'], r)} ${pick(['165Hz', '180Hz', '100Hz'], r)} ${pick(['IPS全面屏', '电竞高刷', '护眼低蓝光'], r)}`,
    price: [499, 3999],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '24英寸' }, { label: '27英寸', priceDelta: 250 }, { label: '31.5英寸', priceDelta: 560 }] }),
    shops: ['s-erye', 's-keke'],
  },
  {
    tag: 'tv',
    cat: 'digital',
    kws: /电视|tv|大屏/i,
    title: (r) => `${pick(APP_BRANDS, r)} 电视 ${pick(['55', '65', '75'], r)}英寸 ${pick(['4K超高清', '巨幕影院', '全面屏'], r)} 智能液晶平板电视`,
    price: [1099, 8999],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '55英寸' }, { label: '65英寸', priceDelta: 400 }, { label: '75英寸', priceDelta: 1100 }] }),
    shops: ['s-erye', 's-guohuo'],
  },
  {
    tag: 'speaker',
    cat: 'digital',
    kws: /音箱|音响|喇叭/i,
    title: (r) => `${pick(AUDIO_BRANDS, r)} 蓝牙音箱 ${pick(['重低音炮', '便携迷你', '户外防水'], r)} ${pick(['超长续航', '桌面电脑音箱', '家用户外'], r)}`,
    price: [59, 999],
    sku: () => skuOf(colorGroup('speaker', ['黑色', '军绿', '橙色', '奶白'])),
    shops: ['s-guohuo'],
  },
  {
    tag: 'powerbank',
    cat: 'digital',
    kws: /充电宝|电源|快充|数据线|充电线/i,
    title: (r) => `${pick(BUDGET_BRANDS, r)} 充电宝 ${pick(['10000', '20000', '30000'], r)}毫安 ${pick(['22.5W', '66W', '120W'], r)}超级快充 ${pick(['自带线', '乘机可带', '数显电量'], r)}`,
    price: [39.9, 299],
    sku: () => skuOf(colorGroup('powerbank', ['黑色', '白色'])),
    shops: ['s-guohuo', 's-erye'],
  },
  {
    tag: 'phone-stand',
    cat: 'digital',
    kws: /支架|懒人支架|支撑架|手机座/i,
    title: (r) => `${pick(BUDGET_BRANDS, r)} 手机支架 ${pick(['桌面懒人支架', '床上折叠支架', '车载出风口支架'], r)} ${pick(['可折叠多档调节', '全金属稳固', '360°旋转'], r)} ${pick(['通用平板手机', '追剧直播神器'], r)}`,
    price: [9.9, 79],
    sku: () => skuOf(colorGroup('phone-stand', ['深空灰', '樱花粉', '星空银'])),
    shops: ['s-yanxuan', 's-erye'],
  },
  {
    tag: 'gamepad',
    cat: 'digital',
    kws: /手柄|游戏手柄|switch/i,
    title: (r) => `${pick(['北通', '飞智', '莱仕达', '盖世小鸡'], r)} 游戏手柄 ${pick(['无线蓝牙', 'PC电脑手机通用', '霍尔摇杆'], r)} ${pick([' Steam安卓iOS', '双震动马达'], r)}`,
    price: [89, 599],
    sku: () => skuOf(colorGroup('gamepad', ['黑色', '白色', '透明紫'])),
    shops: ['s-erye'],
  },
  {
    tag: 'drone',
    cat: 'digital',
    kws: /无人机|航拍|飞行器/i,
    title: (r) => `${pick(['大疆', '道通', '哈博森', '司马'], r)} 无人机 ${pick(['4K高清航拍', 'GPS智能返航', '光流定位'], r)} ${pick(['遥控飞机', '折叠便携', '长续航'], r)}`,
    price: [299, 8999],
    sku: () => skuOf({ name: '版本', options: [{ label: '标准版' }, { label: '畅飞套装（三电池+收纳包）', priceDelta: 200 }] }),
    shops: ['s-erye', 's-keke'],
  },
  {
    tag: 'lock',
    cat: 'digital',
    kws: /门锁|指纹锁|智能锁/i,
    title: (r) => `${pick(['德施曼', '凯迪仕', '小米', '华为智选', '鹿客'], r)} 智能门锁 ${pick(['指纹锁', '人脸识别', '指静脉'], r)} ${pick(['全自动', '防窥视猫眼', '远程告警'], r)}`,
    price: [699, 4999],
    sku: () => skuOf(colorGroup('lock', ['深空灰', '曜石黑', '香槟金'])),
    shops: ['s-erye', 's-guohuo'],
  },
  // ================= 家电 =================
  {
    tag: 'fridge',
    cat: 'home',
    kws: /冰箱|冰柜/i,
    title: (r) => `${pick(APP_BRANDS, r)} 冰箱 ${pick(['对开门', '十字四门', '三门', '双门'], r)} ${pick(['风冷无霜', '变频节能', '一级能效'], r)} ${pick(['501升大容量', '466升', '小型租房款'], r)}`,
    price: [899, 6999],
    sku: () => skuOf({ name: '门数规格', options: [{ label: '双门' }, { label: '三门', priceDelta: 200 }, { label: '对开门', priceDelta: 400 }] }, colorGroup('fridge', ['流光银', '曜金黑', '云雾白'])),
    shops: ['s-guohuo', 's-yanxuan'],
  },
  {
    tag: 'washer',
    cat: 'home',
    kws: /洗衣机|烘干机/i,
    title: (r) => `${pick(APP_BRANDS, r)} 洗衣机 ${pick(['8', '10', '12'], r)}公斤 ${pick(['滚筒全自动', '洗烘一体', '波轮大容量'], r)} ${pick(['变频节能', '除菌洗', '直驱静音'], r)}`,
    price: [799, 5999],
    sku: () => skuOf({ name: '容量', options: [{ label: '8公斤' }, { label: '10公斤', priceDelta: 150 }, { label: '12公斤', priceDelta: 300 }] }),
    shops: ['s-guohuo', 's-yanxuan'],
  },
  {
    tag: 'fan',
    cat: 'home',
    kws: /风扇|落地扇|空气循环/i,
    title: (r) => `${pick(APP_BRANDS, r)} 电风扇 ${pick(['落地扇', '塔扇', '空气循环扇'], r)} ${pick(['静音节能', '遥控定时', '7叶柔风'], r)} ${pick(['家用卧室', '办公台立两用'], r)}`,
    price: [79, 699],
    sku: () => skuOf(colorGroup('fan', ['云雾白', '奶油白', '墨绿'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'vacuum',
    cat: 'home',
    kws: /吸尘器|清洁机/i,
    title: (r) => `${pick(['戴森', '小米', '追觅', '石头', '美的'], r)} 吸尘器 ${pick(['家用大吸力', '无线手持', '洗地机三合一'], r)} ${pick(['除螨车载两用', '拖吸一体', '轻量随手吸'], r)}`,
    price: [199, 4999],
    sku: () => skuOf({ name: '版本', options: [{ label: '标准版' }, { label: '旗舰版（+除螨刷头）', priceDelta: 80 }] }),
    shops: ['s-yanxuan', 's-guohuo'],
  },
  {
    tag: 'microwave',
    cat: 'home',
    kws: /微波炉|微烤一体/i,
    title: (r) => `${pick(APP_BRANDS, r)} 微波炉 ${pick(['20升家用', '微烤一体机', '平板加热'], r)} ${pick(['智能菜单', '速热解冻', '转盘均匀加热'], r)}`,
    price: [199, 1299],
    sku: () => skuOf(colorGroup('microwave', ['云雾白', '曜石黑'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'rice-cooker',
    cat: 'home',
    kws: /电饭煲|电饭锅/i,
    title: (r) => `${pick(['美的', '苏泊尔', '九阳', '小米', '小熊'], r)} 电饭煲 ${pick(['3', '4', '5'], r)}升 ${pick(['智能预约', '柴火饭内胆', 'IH电磁加热'], r)} 家用${pick(['多功能', '大容量', '低糖'], r)}`,
    price: [99, 899],
    sku: () => skuOf({ name: '容量', options: [{ label: '3L' }, { label: '4L', priceDelta: 40 }, { label: '5L', priceDelta: 80 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'kettle',
    cat: 'home',
    kws: /水壶|烧水壶|电热水壶/i,
    title: (r) => `${pick(['美的', '苏泊尔', '九阳', '小米', '荣事达'], r)} 电热水壶 ${pick(['1.5', '1.8'], r)}升 ${pick(['304不锈钢', '双层防烫', '快速烧开'], r)} ${pick(['自动断电', '大口径易清洗'], r)}`,
    price: [39.9, 299],
    sku: () => skuOf(colorGroup('kettle', ['奶油白', '云雾白', '墨绿'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'air-fryer',
    cat: 'home',
    kws: /空气炸锅|炸锅/i,
    title: (r) => `${pick(['美的', '九阳', '小熊', '苏泊尔', '小米'], r)} 空气炸锅 ${pick(['4.5', '6', '8'], r)}升 ${pick(['大容量全自动', '智能触屏', '可视免翻面'], r)} ${pick(['无油低脂', '家用烘焙'], r)}`,
    price: [129, 999],
    sku: () => skuOf({ name: '容量', options: [{ label: '4.5L' }, { label: '6L', priceDelta: 60 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'coffee-machine',
    cat: 'home',
    kws: /咖啡机/i,
    title: (r) => `${pick(['德龙', '百胜图', '柏翠', '马克西姆', '小米'], r)} 咖啡机 ${pick(['意式半自动', '全自动研磨一体', '胶囊咖啡机'], r)} ${pick(['家用办公室', '商用', '入门款'], r)}`,
    price: [399, 5999],
    sku: () => skuOf(colorGroup('coffee-machine', ['奶油白', '曜石黑', '复古绿'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'humidifier',
    cat: 'home',
    kws: /加湿器|香薰机/i,
    title: (r) => `${pick(['小米', '小熊', '美的', '亚都', '德尔玛'], r)} 加湿器 ${pick(['卧室静音', '大容量上加水', '无雾冷蒸发'], r)} ${pick(['香薰氛围灯', '智能恒湿', '除菌净化'], r)}`,
    price: [69, 699],
    sku: () => skuOf({ name: '容量', options: [{ label: '3L' }, { label: '5L', priceDelta: 30 }] }, colorGroup('humidifier', ['奶油白', '云雾白'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'shaver',
    cat: 'home',
    kws: /剃须刀|刮胡刀/i,
    title: (r) => `${pick(['飞科', '飞利浦', '博锐', '超人', '小米'], r)} 剃须刀 电动 ${pick(['全身水洗', '往复式三刀头', '旋转式三刀头'], r)} ${pick(['智能防夹须', '男士便携', '剃鬓角一体'], r)}`,
    price: [59, 999],
    sku: () => skuOf({ name: '刀头', options: [{ label: '三刀头' }, { label: '五刀头', priceDelta: 40 }] }),
    shops: ['s-yanxuan', 's-guohuo'],
  },
  {
    tag: 'toothbrush',
    cat: 'home',
    kws: /牙刷/i,
    title: (r) => `${pick(['飞利浦', '欧乐B', 'usmile', '舒客', '素士'], r)} 电动牙刷 ${pick(['声波震动', '软毛护龈', '深度清洁'], r)} ${pick(['成人款', '学生党套装', '情侣款'], r)}`,
    price: [49, 599],
    sku: () => skuOf(colorGroup('toothbrush', ['云雾白', '樱花粉', '雾霾蓝']), { name: '数量', options: [{ label: '单支装' }, { label: '两支装', priceDelta: 35 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'hairdryer',
    cat: 'home',
    kws: /吹风机|风筒/i,
    title: (r) => `${pick(['戴森', '飞利浦', '松下', '小米', '追觅'], r)} 吹风机 ${pick(['大功率速干', '负离子护发', '高速无叶'], r)} ${pick(['冷热风', '水离子养发', '恒温不伤发'], r)}`,
    price: [79, 2999],
    sku: () => skuOf(colorGroup('hairdryer', ['云雾白', '樱花粉', '紫灰'])),
    shops: ['s-yanxuan'],
  },
  // ================= 服饰 =================
  {
    tag: 'tshirt',
    cat: 'fashion',
    kws: /t恤|短袖|体恤|打底衫/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} 纯棉短袖T恤 ${pick(['2026新款', '重磅纯棉', '冰丝凉感'], r)} ${pick(['宽松百搭', '简约纯色', '潮牌印花'], r)}`,
    price: [19.9, 199],
    sku: () => skuOf(colorGroup('tshirt', ['白色', '黑色', '燕麦色', '雾霾蓝']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'jeans',
    cat: 'fashion',
    kws: /牛仔裤|裤子|长裤|阔腿裤|工装裤|哈伦裤|直筒裤|老爹裤/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} ${pick(['直筒牛仔裤', '阔腿裤', '老爹裤', '工装裤'], r)} ${pick(['高腰显瘦垂感', '宽松直筒', '烟灰色做旧'], r)} 长裤`,
    price: [59, 399],
    sku: () => skuOf(colorGroup('jeans', ['浅蓝', '深蓝', '烟灰', '黑色']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'dress',
    cat: 'fashion',
    kws: /连衣裙|裙|长裙/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} 连衣裙 ${pick(['法式碎花', '收腰显瘦', '气质通勤'], r)} ${pick(['夏季新款', '度假沙滩裙', '吊带长裙'], r)}`,
    price: [69, 599],
    sku: () => skuOf(colorGroup('dress', ['碎花蓝', '奶油白', '复古绿']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'jacket',
    cat: 'fashion',
    kws: /风衣|外套|夹克|冲锋衣/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} ${pick(['韩版风衣外套', '工装夹克', '飞行员夹克', '冲锋衣'], r)} ${pick(['春秋新款', '学院风', '机能防风'], r)}`,
    price: [49, 899],
    sku: () => skuOf(colorGroup('jacket', ['蓝色风衣', '黑色风衣', '卡其色', '军绿']), CLOTH_SIZE),
    shops: ['s-yichu', 's-chaobu'],
  },
  {
    tag: 'hoodie',
    cat: 'fashion',
    kws: /卫衣/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} ${pick(['连帽卫衣', '圆领卫衣'], r)} ${pick(['春秋薄款', '加绒加厚'], r)} 宽松慵懒风 ${pick(['ins潮牌', '印花上衣'], r)}`,
    price: [39.9, 399],
    sku: () => skuOf(colorGroup('hoodie', ['灰色', '黑色', '奶杏色']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'coat',
    cat: 'fashion',
    kws: /大衣|呢子/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} ${pick(['毛呢大衣', '双面呢大衣'], r)} ${pick(['2026冬季新款', '加厚保暖'], r)} 中长款 ${pick(['赫本风', '通勤气质'], r)}`,
    price: [199, 1999],
    sku: () => skuOf(colorGroup('coat', ['驼色', '雾霾蓝', '黑色']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'shirt',
    cat: 'fashion',
    kws: /衬衫/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} 衬衫 ${pick(['设计感小众', '法式复古', '白衬衫通勤'], r)} ${pick(['长袖', '短袖'], r)} 上衣`,
    price: [39.9, 399],
    sku: () => skuOf(colorGroup('shirt', ['云雾白', '浅蓝条纹', '奶茶色']), CLOTH_SIZE),
    shops: ['s-yichu'],
  },
  {
    tag: 'hat',
    cat: 'fashion',
    kws: /帽子|棒球帽|鸭舌帽|渔夫帽/i,
    title: (r) => `${pick(['MLB风', '卡蒙', '菲尔南多', 'C冠', '歌瑞凯'], r)} ${pick(['棒球帽', '渔夫帽', '贝雷帽'], r)} ${pick(['潮流遮阳', '大头围', '防晒透气'], r)} 男女通用`,
    price: [19.9, 199],
    sku: () => skuOf(colorGroup('hat', ['黑色', '米白', '雾霾蓝', '樱花粉'])),
    shops: ['s-yichu'],
  },
  {
    tag: 'shoes',
    cat: 'fashion',
    kws: /跑鞋|篮球鞋|皮鞋|靴|乐福鞋/i,
    title: (r) => `${pick(SHOE_BRANDS, r)} ${pick(['轻便跑鞋', '缓震运动鞋', '马丁靴', '乐福鞋'], r)} ${pick(['透气网面', '软底舒适', '加绒保暖'], r)}`,
    price: [69, 999],
    sku: () => skuOf(colorGroup('shoes', ['黑色', '米白', '灰绿']), SHOE_SIZE),
    shops: ['s-chaobu'],
  },
  {
    tag: 'sneakers',
    cat: 'fashion',
    kws: /小白鞋|运动鞋|球鞋|板鞋|鞋/i,
    title: (r) => `${pick(SHOE_BRANDS, r)} ${pick(['百搭小白鞋', '缓震跑鞋', '增高板鞋', '复古德训鞋'], r)} ${pick(['透气', '轻便', '耐磨防滑'], r)} 休闲运动鞋`,
    price: [59, 899],
    sku: () => skuOf(colorGroup('sneakers', ['白色', '米白', '黑色', '灰紫']), SHOE_SIZE),
    shops: ['s-chaobu'],
  },
  {
    tag: 'slippers',
    cat: 'fashion',
    kws: /拖鞋/i,
    title: (r) => `${pick(['回力', '足力健', '朴西', '炫迈'], r)} 拖鞋 ${pick(['居家室内防滑', '踩屎感厚底', '四季通用'], r)} ${pick(['男女同款', '浴室防摔'], r)}`,
    price: [9.9, 99],
    sku: () => skuOf(colorGroup('slippers', ['奶油白', '雾霾蓝', '樱花粉']), SHOE_SIZE),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'backpack',
    cat: 'fashion',
    kws: /双肩包|书包|背包/i,
    title: (r) => `${pick(['小米', '耐风', '卡拉羊', '阿迪风', '第九城'], r)} 双肩包 ${pick(['大容量学生书包', '通勤电脑包', '旅行轻便背包'], r)} ${pick(['韩版时尚', '防泼水面料', '多隔层'], r)}`,
    price: [39.9, 499],
    sku: () => skuOf(colorGroup('backpack', ['樱花粉', '经典黑', '雾霾蓝', '灰绿'])),
    shops: ['s-yanxuan', 's-chaobu'],
  },
  {
    tag: 'suitcase',
    cat: 'fashion',
    kws: /行李箱|拉杆箱|旅行箱/i,
    title: (r) => `${pick(['不莱玫', '小米', '90分', '外交官', '爱华仕'], r)} 行李箱 ${pick(['20', '24', '28'], r)}英寸 ${pick(['万向轮', '静音轮'], r)} 密码拉杆箱 ${pick(['铝框坚固', 'PC耐磨', '登机轻便'], r)}`,
    price: [129, 1299],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '20英寸（登机）' }, { label: '24英寸', priceDelta: 80 }, { label: '28英寸', priceDelta: 160 }] }, colorGroup('suitcase', ['云雾白', '雾霾蓝', '奶油黄'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'wallet',
    cat: 'fashion',
    kws: /钱包|卡包/i,
    title: (r) => `${pick(['红谷', '金利来', '稻草人', '啄木鸟'], r)} 钱包 ${pick(['短款真皮', '长款头层牛皮', '卡包一体'], r)} ${pick(['男士商务', '女士精致', '简约百搭'], r)}`,
    price: [29.9, 399],
    sku: () => skuOf(colorGroup('wallet', ['焦糖色', '黑色', '酒红'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'sunglasses',
    cat: 'fashion',
    kws: /墨镜|太阳镜|眼镜/i,
    title: (r) => `${pick(['暴龙', '帕森', '海伦凯勒', '雷朋风'], r)} 墨镜 太阳镜 ${pick(['防紫外线', '偏光驾驶镜', '复古大框'], r)} ${pick(['男女同款', '开车必备'], r)}`,
    price: [49, 999],
    sku: () => skuOf(colorGroup('sunglasses', ['曜石黑', '茶色', '渐变灰'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'belt',
    cat: 'fashion',
    kws: /腰带|皮带/i,
    title: (r) => `${pick(['七匹狼', '金利来', '皮尔卡丹', '稻草人'], r)} 腰带 皮带 ${pick(['男士自动扣', '头层牛皮', '休闲针扣'], r)} ${pick(['商务百搭', '年轻人简约'], r)}`,
    price: [29.9, 299],
    sku: () => skuOf(colorGroup('belt', ['黑色', '棕色', '深咖'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'scarf',
    cat: 'fashion',
    kws: /围巾|围脖|披肩/i,
    title: (r) => `${pick(['上海故事', '恒源祥', '万事利', '凌克'], r)} 围巾 ${pick(['秋冬加厚保暖', '羊毛混纺', '羊绒触感'], r)} ${pick(['情侣款', '妈妈款', '百搭纯色'], r)}`,
    price: [29.9, 299],
    sku: () => skuOf(colorGroup('scarf', ['雾粉', '燕麦', '雾霾蓝', '酒红'])),
    shops: ['s-yichu'],
  },
  {
    tag: 'socks',
    cat: 'fashion',
    kws: /袜子/i,
    title: (r) => `${pick(['南极人', '浪莎', '猫人', '俞兆林'], r)} 袜子 ${pick(['秋冬加绒保暖', '纯棉中筒', '隐形船袜'], r)} ${pick(['5双装', '10双装', '男女同款'], r)}`,
    price: [19.9, 99],
    sku: () => skuOf({ name: '规格', options: [{ label: '5双装' }, { label: '10双装', priceDelta: 18 }] }, colorGroup('socks', ['黑色', '白色', '灰条'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'shorts',
    cat: 'fashion',
    kws: /短裤|五分裤|七分裤/i,
    title: (r) => `${pick(FASHION_BRANDS, r)} 短裤 ${pick(['夏季薄款', '冰丝速干', '宽松休闲'], r)} ${pick(['五分裤', '运动短裤'], r)} 男女同款`,
    price: [29.9, 199],
    sku: () => skuOf(colorGroup('shorts', ['黑色', '灰绿', '卡其']), CLOTH_SIZE),
    shops: ['s-chaobu', 's-yichu'],
  },
  // ================= 美妆 =================
  {
    tag: 'lipstick',
    cat: 'beauty',
    kws: /口红|唇釉|唇泥|唇膏|唇蜜/i,
    title: (r) => `${pick(LIP_BRANDS, r)} ${pick(LIP_KINDS, r)} ${pick(LIP_COLORS, r)} ${pick(['丝绒雾面哑光', '镜面水光', '滋润不拔干'], r)} ${pick(['持久不易脱色', '小众大牌平替', '送礼礼盒装'], r)}`,
    price: [39, 499],
    sku: (r) => skuOf(
      // 质地是口红类型本身（标题已带唇釉/口红/唇泥/唇膏/唇蜜），不进购买弹窗；弹窗只选色号
      { name: '色号', options: LIP_COLORS.map((c, i) => ({ label: c, img: tbImg('lipstick', 120, 120, i % 4) })) },
      { name: '规格', options: [{ label: '单支装' }, { label: '三支礼盒', priceDelta: 89 }] },
    ),
    shops: ['s-meizhuang'],
  },
  {
    tag: 'perfume',
    cat: 'beauty',
    kws: /香水|香氛/i,
    title: (r) => `${pick(BEAUTY_BRANDS, r)} 香水 ${pick(['持久淡香', '清新自然', '木质馥奇'], r)} ${pick(['50ml', '30ml'], r)} ${pick(['网红小众', '学生党口袋香'], r)}`,
    price: [39, 699],
    sku: () => skuOf({ name: '香型', options: [{ label: '蓝风铃' }, { label: '鼠尾草' }, { label: '白桃乌龙' }, { label: '英国梨', priceDelta: 30 }] }),
    shops: ['s-meizhuang'],
  },
  {
    tag: 'skincare',
    cat: 'beauty',
    kws: /面霜|乳液|精华|水乳|护肤|防晒/i,
    title: (r) => `${pick(BEAUTY_BRANDS, r)} ${pick(['面霜', '水乳套装', '精华液', '防晒霜'], r)} ${pick(['保湿补水修护屏障', '紧致抗皱', '控油舒缓'], r)} 官方旗舰店正品`,
    price: [59, 999],
    sku: () => skuOf({ name: '规格', options: [{ label: '50g' }, { label: '50g+15g套装', priceDelta: 40 }] }),
    shops: ['s-meizhuang'],
  },
  {
    tag: 'makeup',
    cat: 'beauty',
    kws: /眼影|粉底|腮红|彩妆|化妆|修容/i,
    title: (r) => `${pick(BEAUTY_BRANDS, r)} ${pick(['12色眼影盘', '九色眼影盘', '腮红高光一体盘'], r)} ${pick(['哑光珠光大地色', '奶咖温柔色', '蜜桃奶杏色'], r)} 一盘搞定眼妆`,
    price: [29.9, 299],
    sku: () => skuOf({ name: '色号', options: [{ label: '海棠粉棕' }, { label: '焦糖南瓜' }, { label: '大地通勤' }] }),
    shops: ['s-meizhuang'],
  },
  {
    tag: 'brush',
    cat: 'beauty',
    kws: /化妆刷|刷具|粉底刷/i,
    title: (r) => `${pick(['魅丝蔻', '受受狼', '艾诺琪', '琴制'], r)} 化妆刷套装 ${pick(['8支装', '12支装'], r)} ${pick(['超柔软纤维毛', '眼部细节刷'], r)} ${pick(['新手全套', '便携收纳桶装'], r)}`,
    price: [29.9, 199],
    sku: () => skuOf({ name: '规格', options: [{ label: '8支装' }, { label: '12支装', priceDelta: 20 }] }, colorGroup('brush', ['奶白', '樱花粉', '雾霾蓝'])),
    shops: ['s-meizhuang'],
  },
  {
    tag: 'face-mask',
    cat: 'beauty',
    kws: /面膜/i,
    title: (r) => `${pick(BEAUTY_BRANDS, r)} 面膜 ${pick(['玻尿酸补水', '胶原蛋白紧致', '积雪草舒缓'], r)} ${pick(['10片装', '20片装'], r)} 涂抹式贴片面膜`,
    price: [29.9, 199],
    sku: () => skuOf({ name: '规格', options: [{ label: '10片装' }, { label: '20片装', priceDelta: 25 }] }),
    shops: ['s-meizhuang'],
  },
  // ================= 家居日用 =================
  {
    tag: 'sofa',
    cat: 'home',
    kws: /沙发/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 布艺沙发 ${pick(['小户型双人三人位', '奶油风整装', '科技布免洗'], r)} 现代简约客厅`,
    price: [899, 5999],
    sku: () => skuOf(colorGroup('sofa', ['奶油白', '雾霾灰', '燕麦色']), { name: '规格', options: [{ label: '双人位' }, { label: '三人位', priceDelta: 400 }] }),
    shops: ['s-zhiyi'],
  },
  {
    tag: 'bedding',
    cat: 'home',
    kws: /四件套|床品|被套|床单|被子/i,
    title: (r) => `${pick(HOME_BRANDS, r)} ${pick(['60支长绒棉四件套', '100s全棉床品套件', '水洗棉四件套'], r)} ${pick(['A类母婴级', '裸睡级亲肤', '抗菌'], r)}`,
    price: [99, 999],
    sku: () => skuOf(colorGroup('bedding', ['云朵白', '雾霾蓝', '豆沙粉']), { name: '尺寸', options: [{ label: '1.5m床' }, { label: '1.8m床', priceDelta: 30 }] }),
    shops: ['s-jujia'],
  },
  {
    tag: 'lamp',
    cat: 'home',
    kws: /落地灯|台灯|灯/i,
    title: (r) => `${pick(HOME_BRANDS, r)} ${pick(['落地灯', '床头台灯'], r)} ${pick(['客厅卧室立式', '奶油风ins北欧', '遥控调光'], r)} ${pick(['护眼阅读', '氛围暖光'], r)}`,
    price: [59, 599],
    sku: () => skuOf(colorGroup('lamp', ['奶油白', '胡桃木色'])),
    shops: ['s-yanxuan', 's-zhiyi'],
  },
  {
    tag: 'mug',
    cat: 'home',
    kws: /马克杯|杯子|水杯|茶杯/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 马克杯 ${pick(['带盖勺陶瓷咖啡杯', '高颜值ins情侣水杯', '办公室牛奶杯'], r)} ${pick(['礼盒装', '大容量450ml'], r)}`,
    price: [9.9, 99],
    sku: () => skuOf(colorGroup('mug', ['奶白', '雾霾蓝', '樱花粉', '石墨黑']), { name: '规格', options: [{ label: '单杯' }, { label: '礼盒装', priceDelta: 10 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'vase',
    cat: 'home',
    kws: /花瓶/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 花瓶 ${pick(['插花干花摆件', '轻奢玻璃花瓶', '北欧透明水培'], r)} 客厅电视柜装饰`,
    price: [19.9, 199],
    sku: () => skuOf({ name: '规格', options: [{ label: '透明款' }, { label: '琥珀色' }, { label: '烟灰色' }] }),
    shops: ['s-zhiyi'],
  },
  {
    tag: 'pillow',
    cat: 'home',
    kws: /抱枕|靠垫|枕头/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 抱枕靠垫 ${pick(['沙发靠背', '床头大靠背', '办公室护腰枕'], r)} 芯可拆洗`,
    price: [9.9, 99],
    sku: () => skuOf(colorGroup('pillow', ['奶白', '焦糖色', '墨绿']), { name: '尺寸', options: [{ label: '45x45cm' }, { label: '60x60cm', priceDelta: 8 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'desk',
    cat: 'home',
    kws: /书桌|电脑桌|桌子|办公桌/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 电脑桌书桌 ${pick(['简约家用', '学生写字台', '卧室学习桌'], r)} ${pick(['稳固不晃', '带书架', '升降可调节'], r)}`,
    price: [99, 999],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '80cm' }, { label: '100cm', priceDelta: 30 }, { label: '120cm', priceDelta: 60 }] }, colorGroup('desk', ['原木色', '白色', '黑色'])),
    shops: ['s-zhiyi'],
  },
  {
    tag: 'curtain',
    cat: 'home',
    kws: /窗帘/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 窗帘 ${pick(['遮光卧室客厅', '免打孔安装', '雪尼尔加厚'], r)} ${pick(['隔热防晒', '静音滑轨'], r)}`,
    price: [49, 499],
    sku: () => skuOf({ name: '宽度', options: [{ label: '2m宽' }, { label: '3m宽', priceDelta: 50 }] }, colorGroup('curtain', ['奶油白', '雾霾蓝', '豆沙绿'])),
    shops: ['s-jujia'],
  },
  {
    tag: 'towel',
    cat: 'home',
    kws: /毛巾|浴巾|纸巾|洗脸巾/i,
    title: (r) => `${pick(['洁丽雅', '金号', '内野', '三利'], r)} 毛巾 ${pick(['3条装', '家用浴巾'], r)} ${pick(['纯棉吸水', '抗菌A类'], r)} 成人洗脸`,
    price: [19.9, 99],
    sku: () => skuOf({ name: '规格', options: [{ label: '3条装' }, { label: '5条装', priceDelta: 15 }] }, colorGroup('towel', ['云朵白', '雾霾蓝', '豆沙粉'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'storage',
    cat: 'home',
    kws: /收纳箱|收纳盒|收纳/i,
    title: (r) => `${pick(['茶花', '天马', '百露', '禧天龙'], r)} 收纳箱 ${pick(['特大号有盖', '衣物玩具整理箱', '抽屉式收纳柜'], r)} ${pick(['加厚承重', '透明可视'], r)}`,
    price: [19.9, 199],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '中号' }, { label: '大号', priceDelta: 20 }, { label: '特大号', priceDelta: 45 }] }, colorGroup('storage', ['云雾白', '雾霾蓝', '奶杏'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'carpet',
    cat: 'home',
    kws: /地毯|地垫|爬行垫/i,
    title: (r) => `${pick(HOME_BRANDS, r)} 地毯 ${pick(['客厅茶几垫', '卧室床边毯', '丝圈防滑垫'], r)} ${pick(['免洗易打理', '加厚脚感'], r)}`,
    price: [39.9, 399],
    sku: () => skuOf({ name: '尺寸', options: [{ label: '1.6x2.3m' }, { label: '2x3m', priceDelta: 80 }] }, colorGroup('carpet', ['奶油白', '雾灰', '豆沙绿'])),
    shops: ['s-jujia'],
  },
  {
    tag: 'lunchbox',
    cat: 'home',
    kws: /饭盒|便当盒|保温桶/i,
    title: (r) => `${pick(['苏泊尔', '乐扣乐扣', '小熊', '物生物'], r)} 保温饭盒 ${pick(['双层', '三层'], r)} ${pick(['316不锈钢', '上班族便携', '学生带盖'], r)}`,
    price: [29.9, 199],
    sku: () => skuOf({ name: '层数', options: [{ label: '双层' }, { label: '三层', priceDelta: 15 }] }, colorGroup('lunchbox', ['奶油白', '雾霾蓝', '樱花粉'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'umbrella',
    cat: 'home',
    kws: /雨伞|太阳伞|晴雨伞/i,
    title: (r) => `${pick(['天堂', '蕉下风', '菲诺', '美度'], r)} 雨伞 ${pick(['全自动折叠', '加固防风'], r)} ${pick(['防晒太阳伞黑胶', '晴雨两用', '大号双人'], r)}`,
    price: [19.9, 199],
    sku: () => skuOf(colorGroup('umbrella', ['云朵白', '雾霭蓝', '樱花粉', '经典黑'])),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'water-bottle',
    cat: 'home',
    kws: /保温杯|保温瓶|水瓶|水壶/i,
    title: (r) => `${pick(['希诺', '哈尔斯', '象普', '小米'], r)} 保温杯 ${pick(['316不锈钢', '大容量茶水分离', '男女学生便携'], r)} 高颜值水杯`,
    price: [29.9, 299],
    sku: () => skuOf(colorGroup('water-bottle', ['奶油白', '雾霾蓝', '咖啡色']), { name: '容量', options: [{ label: '500ml' }, { label: '800ml', priceDelta: 10 }] }),
    shops: ['s-yanxuan'],
  },
  // ================= 食品 =================
  {
    tag: 'snacks',
    cat: 'food',
    kws: /零食|大礼包|小吃|网红零/i,
    title: (r) => `${pick(FOOD_BRANDS, r)} 零食大礼包 ${pick(['整箱混装30包', '网红小吃一箱', '超大混装'], r)} 送女友`,
    price: [19.9, 99.9],
    sku: () => skuOf({ name: '规格', options: [{ label: '30包装' }, { label: '60包装', priceDelta: 30 }] }),
    shops: ['s-lingshi'],
  },
  {
    tag: 'cookies',
    cat: 'food',
    kws: /曲奇|饼干|糕点|牛轧糖/i,
    title: (r) => `${pick(FOOD_BRANDS, r)} 曲奇饼干 ${pick(['礼盒装', '丹麦风味', '手工现烤'], r)} ${pick(['奶香酥脆', '下午茶点心'], r)}`,
    price: [19.9, 99],
    sku: () => skuOf({ name: '口味', options: [{ label: '黄油原味' }, { label: '巧克力味' }, { label: '抹茶味' }] }),
    shops: ['s-lingshi'],
  },
  {
    tag: 'tea',
    cat: 'food',
    kws: /茶叶|红茶|绿茶|普洱|乌龙|白茶/i,
    title: (r) => `${pick(['八马', '小罐茶风', '艺福堂', '卢正浩'], r)} 茶叶礼盒 ${pick(['大红袍肉桂乌龙茶', '金骏眉红茶', '安吉白茶'], r)} 高档送礼罐装`,
    price: [49, 999],
    sku: () => skuOf({ name: '规格', options: [{ label: '尊享装' }, { label: '典藏礼盒', priceDelta: 100 }] }),
    shops: ['s-lingshi'],
  },
  {
    tag: 'fruit',
    cat: 'food',
    kws: /水果|芒果|草莓|橙子|奇异果|榴莲/i,
    title: (r) => `${pick(['鲜果乐园', '百果园风', '都乐', '佳农'], r)} 新鲜水果 当季现摘 ${pick(['大礼包5斤装', '整箱9斤', '现摘现发'], r)} 坏果包赔`,
    price: [19.9, 199],
    sku: () => skuOf({ name: '规格', options: [{ label: '5斤混装' }, { label: '9斤全家福', priceDelta: 30 }] }),
    shops: ['s-shengxian'],
  },
  // ================= 图书/文具 =================
  {
    tag: 'books',
    cat: 'book',
    kws: /书|小说|教辅|绘本|教材|名著/i,
    title: (r) => `${pick(['人民文学', '中信出版', '磨铁', '果麦'], r)} ${pick(['活着+人生+平凡的世界全三册', '经典文学小说畅销书', '儿童绘本全套20册'], r)} 正版书籍`,
    price: [19.9, 199],
    sku: () => skuOf({ name: '装帧', options: [{ label: '平装' }, { label: '精装典藏', priceDelta: 30 }] }),
    shops: ['s-bowen'],
  },
  {
    tag: 'pen',
    cat: 'book',
    kws: /钢笔|圆珠笔|铅笔|文具/i,
    title: (r) => `${pick(['英雄', '凌美', '百乐', '晨光'], r)} 钢笔 ${pick(['学生练字', '礼盒装', '墨水两用'], r)} ${pick(['EF尖顺滑', '金属笔杆'], r)}`,
    price: [9.9, 199],
    sku: () => skuOf(colorGroup('pen', ['曜石黑', '雾蓝', '金属银']), { name: '规格', options: [{ label: '钢笔单支' }, { label: '礼盒装（+墨水）', priceDelta: 20 }] }),
    shops: ['s-bowen', 's-yanxuan'],
  },
  {
    tag: 'notebook',
    cat: 'book',
    kws: /记事本|日记本|手账/i,
    title: (r) => `${pick(['晨光', '得力', '国誉', 'Kinbor'], r)} 笔记本 ${pick(['A5加厚', 'B5方格', '手账本'], r)} 学生日记本文具`,
    price: [9.9, 99],
    sku: () => skuOf({ name: '规格', options: [{ label: 'A5' }, { label: 'B5', priceDelta: 10 }] }, colorGroup('notebook', ['奶白', '雾霾蓝', '樱花粉'])),
    shops: ['s-bowen', 's-yanxuan'],
  },
  // ================= 玩具/运动 =================
  {
    tag: 'toy',
    cat: 'home',
    kws: /毛绒|玩偶|娃娃|公仔|玩(具|偶)(?!车)/i,
    title: (r) => `${pick(['萌趣', '迪士尼风', 'jellycat风', '乐萌'], r)} 安抚玩偶毛绒玩具 ${pick(['睡觉抱枕', '可爱兔子公仔', '大号抱着超软'], r)} 生日礼物`,
    price: [19.9, 299],
    sku: () => skuOf(colorGroup('toy', ['奶油兔', '粉粉猪', '抱抱熊']), { name: '尺寸', options: [{ label: '40cm' }, { label: '60cm', priceDelta: 20 }] }),
    shops: ['s-muying'],
  },
  {
    tag: 'blocks',
    cat: 'home',
    kws: /积木|乐高|拼装/i,
    title: (r) => `${pick(['布鲁可', '启蒙', '万格', '森宝'], r)} 积木拼装玩具 ${pick(['1000颗粒', '街景系列', '军事系列'], r)} 儿童益智${pick(['生日礼物', '拼装模型'], r)}`,
    price: [39.9, 599],
    sku: () => skuOf({ name: '款式', options: [{ label: '基础款' }, { label: '旗舰款', priceDelta: 60 }] }),
    shops: ['s-muying'],
  },
  {
    tag: 'toy-car',
    cat: 'home',
    kws: /玩具车|遥控车|赛车|挖掘机/i,
    title: (r) => `${pick(['风火轮', '奥迪双钻', '星辉', '活石'], r)} 遥控玩具车 ${pick(['越野赛车', '漂移跑车', '合金挖掘机'], r)} ${pick(['充电电动', '儿童节礼物'], r)}`,
    price: [39.9, 399],
    sku: () => skuOf(colorGroup('toy-car', ['炫酷红', '曜石黑', '金属蓝'])),
    shops: ['s-muying'],
  },
  {
    tag: 'puzzle',
    cat: 'home',
    kws: /拼图/i,
    title: (r) => `${pick(['3D-JP', '_toi图益', '弥鹿', '美乐'], r)} 拼图 ${pick(['500片', '1000片'], r)} ${pick(['成人减压', '儿童益智', '风景艺术画'], r)}`,
    price: [19.9, 199],
    sku: () => skuOf({ name: '片数', options: [{ label: '500片' }, { label: '1000片', priceDelta: 25 }] }),
    shops: ['s-muying'],
  },
  {
    tag: 'guitar',
    cat: 'home',
    kws: /吉他|尤克里里/i,
    title: (r) => `${pick(['雅马哈', '拿火', '卡马', '恩雅'], r)} 吉他 ${pick(['41寸单板民谣', '38寸初学入门', '尤克里里23寸'], r)} ${pick(['新手套装', '电箱款'], r)}`,
    price: [99, 2999],
    sku: () => skuOf(colorGroup('guitar', ['原木色', '雾蓝', '复古黑']), { name: '尺寸', options: [{ label: '38寸' }, { label: '41寸', priceDelta: 80 }] }),
    shops: ['s-yanxuan'],
  },
  {
    tag: 'basketball',
    cat: 'home',
    kws: /篮球|足球|排球/i,
    title: (r) => `${pick(['斯伯丁风', '李宁', 'Wilson风', '火车头'], r)} 篮球 ${pick(['7号成人', '5号青少年'], r)} ${pick(['耐磨防滑', '吸湿PU', '室内外通用'], r)}`,
    price: [39.9, 299],
    sku: () => skuOf({ name: '规格', options: [{ label: '5号球' }, { label: '7号球', priceDelta: 15 }] }),
    shops: ['s-chaobu'],
  },
  {
    tag: 'yoga-mat',
    cat: 'home',
    kws: /瑜伽垫|瑜伽/i,
    title: (r) => `${pick(['李宁', 'Keep风', '奥义', '哈他'], r)} 瑜伽垫 ${pick(['加厚防滑', 'TPE环保', '家用运动垫'], r)} ${pick(['便携可卷', '加宽80cm'], r)}`,
    price: [29.9, 199],
    sku: () => skuOf({ name: '厚度', options: [{ label: '8mm' }, { label: '12mm', priceDelta: 15 }] }, colorGroup('yoga-mat', ['雾霾蓝', '豆沙粉', '抹茶绿'])),
    shops: ['s-chaobu'],
  },
  {
    tag: 'dumbbell',
    cat: 'home',
    kws: /哑铃|健身|杠铃/i,
    title: (r) => `${pick(['李宁', '海德', '多德士', '斯伯丁风'], r)} 哑铃 ${pick(['男士健身', '家用包胶', '可调节拆卸'], r)} ${pick(['一对装', '10-20kg套装'], r)}`,
    price: [39.9, 599],
    sku: () => skuOf({ name: '重量', options: [{ label: '10kg' }, { label: '15kg', priceDelta: 40 }, { label: '20kg', priceDelta: 90 }] }),
    shops: ['s-chaobu'],
  },
  {
    tag: 'flower',
    cat: 'food',
    kws: /鲜花|花束|玫瑰|康乃馨/i,
    title: (r) => `${pick(['花加', '花点时间', '玫瑰半岛', ' bloom风'], r)} 鲜花束 ${pick(['保鲜花礼盒', '碎冰蓝玫瑰', '向日葵花束'], r)} 节日送礼`,
    price: [29.9, 299],
    sku: () => skuOf({ name: '规格', options: [{ label: '9朵' }, { label: '19朵', priceDelta: 30 }, { label: '33朵', priceDelta: 80 }] }),
    shops: ['s-shengxian'],
  },
  {
    tag: 'gift',
    cat: 'home',
    kws: /礼品|礼物|礼盒|伴手礼/i,
    title: (r) => `${pick(['礼语', '诺言礼', '礼意久久', '吉礼'], r)} 礼盒 ${pick(['生日礼物女生', '伴手礼高级感', '节日礼盒装'], r)} ${pick(['精致包装', '送礼佳品'], r)}`,
    price: [29.9, 399],
    sku: () => skuOf({ name: '款式', options: [{ label: '经典款' }, { label: '豪华款', priceDelta: 50 }] }, colorGroup('gift', ['樱花粉', '雾霾蓝', '奶油白'])),
    shops: ['s-muying', 's-yanxuan'],
  },
];

// ---------------- 生成核心 ----------------

export interface TbGenOpts {
  /** 限定品类 tag（搜索/频道过滤）；不传 = 全品类轮转 */
  tags?: string[];
  /** id 前缀（默认 gen；信息流溢出/搜索批次用不同前缀防覆盖） */
  idPrefix?: string;
  /** 排除标题（同批/跨批查重） */
  excludeTitles?: string[];
  /** 附加活动角标（超级88/国补） */
  promo?: string;
}

/** 确定性生成 count 个商品：同 seed 同结果，标题全批去重（跨批靠 excludeTitles） */
export function tbGenProducts(seed: number, count: number, opts: TbGenOpts = {}): TbProduct[] {
  const prefix = opts.idPrefix ?? 'gen';
  const cats = opts.tags && opts.tags.length > 0 ? GEN_CATS.filter((c) => opts.tags!.includes(c.tag)) : GEN_CATS;
  const pool = cats.length > 0 ? cats : GEN_CATS;
  const ex = new Set(opts.excludeTitles ?? []);
  const out: TbProduct[] = [];
  let attempts = 0;
  let i = 0;
  while (out.length < count && attempts < count * 60) {
    attempts++;
    const r = rngFrom((hashStr(`${prefix}`) ^ (seed * 2654435761)) + i * 97);
    i++;
    const cat = pool[i % pool.length];
    const title = cat.title(r);
    if (ex.has(title)) continue;
    ex.add(title);
    const [lo, hi] = cat.price;
    const price = round2(lo + r() * (hi - lo));
    const shopHit = cat.shops && cat.shops.length > 0 ? cat.shops[Math.floor(r() * cat.shops.length) % cat.shops.length] : '';
    const shopId = shopHit || tbShopIdForTag(cat.tag);
    const product: TbProduct = {
      id: `${prefix}-${i}`,
      title,
      price,
      originPrice: r() < 0.55 ? round2(price * (1.25 + r() * 0.6)) : undefined,
      sales: Math.floor(300 + r() * 68000),
      shopId,
      cat: cat.cat,
      tag: cat.tag,
      freight: 0,
      tags: [pick(['退货宝', '7天无理由', '包邮', '运费险'], r), pick(['正品保证', '闪电发货', '假一赔四'], r)],
      skus: cat.sku(r),
      ...(opts.promo ? { promo: opts.promo } : {}),
    };
    out.push(product);
  }
  return out;
}

// ---------------- 关键词 → 品类 ----------------

/** 搜索词 → 最贴切品类 tag（未命中返回 null，调用方走通用模式） */
export function tbKwTagOf(kw: string): string | null {
  const k = kw.trim();
  if (!k) return null;
  for (const c of GEN_CATS) {
    if (c.kws.test(k)) return c.tag;
  }
  // 品类中文名兜底（数码/服饰/美妆/家居…）
  if (/数码|电子/.test(k)) return 'phone';
  if (/女装|衣服|穿搭/.test(k)) return 'tshirt';
  if (/美妆|化妆品/.test(k)) return 'makeup';
  if (/家居|家纺/.test(k)) return 'bedding';
  return null;
}

/** 领券中心/首页频道 tag 池（生成器支持的品类） */
export function tbGenAllTags(): string[] {
  return GEN_CATS.map((c) => c.tag);
}

// ---------------- 领券中心组合式无限出券 ----------------

const CC_CATS: Array<[string, string]> = [
  ['数码', 'phone'], ['手机', 'phone'], ['电脑', 'laptop'], ['平板', 'tablet'], ['耳机', 'earbuds'],
  ['家电', 'fridge'], ['冰箱', 'fridge'], ['洗衣机', 'washer'], ['电视', 'tv'], ['显示器', 'monitor'],
  ['服饰', 'jacket'], ['女装', 'dress'], ['男装', 'shirt'], ['童装', 'hoodie'], ['鞋靴', 'sneakers'],
  ['美妆', 'lipstick'], ['护肤', 'skincare'], ['彩妆', 'makeup'], ['香水', 'perfume'], ['面膜', 'face-mask'],
  ['家居', 'sofa'], ['家纺', 'bedding'], ['厨房', 'rice-cooker'], ['办公', 'desk'], ['灯饰', 'lamp'],
  ['食品', 'snacks'], ['零食', 'cookies'], ['生鲜', 'fruit'], ['茶饮', 'tea'], ['图书', 'books'],
  ['文具', 'notebook'], ['运动', 'sneakers'], ['户外', 'backpack'], ['母婴', 'toy'], ['玩具', 'toy-car'],
  ['手表', 'watch'], ['箱包', 'suitcase'], ['超市', 'water-bottle'], ['宠物', 'toy'], ['生活', 'storage'],
];
const CC_KINDS = ['加补券', '消费券', '立减券', '神券', '品类券', '专享券', '特惠券', '满减券', '补贴券', '红包券'];
const CC_AMOUNTS = [5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50, 66, 88];

export interface TbGenCoupon {
  name: string;
  amount: number;
  min: number;
  scope: string;
  tag: string;
}

/** 第 batch 批本地券（组合式无限出券：品类 × 券种 × 面额，确定性且跨批不重名） */
export function tbGenCoupons(batch: number, exclude: string[]): TbGenCoupon[] {
  const ex = new Set(exclude);
  const total = CC_CATS.length * CC_KINDS.length;
  const out: TbGenCoupon[] = [];
  let n = 0;
  let attempts = 0;
  while (out.length < 6 && attempts < total * 2) {
    attempts++;
    n++;
    const r = rngFrom(hashStr(`tb-coupon-${batch}`) + n * 131);
    const [cat, tag] = CC_CATS[Math.floor(r() * CC_CATS.length) % CC_CATS.length];
    const kind = CC_KINDS[Math.floor(r() * CC_KINDS.length) % CC_KINDS.length];
    const name = `${cat}${kind}`;
    if (ex.has(name)) continue;
    const amount = CC_AMOUNTS[Math.floor(r() * CC_AMOUNTS.length) % CC_AMOUNTS.length];
    const minRaw = Math.round(amount * (5 + Math.floor(r() * 6)));
    out.push({
      name,
      amount,
      min: minRaw < 20 ? 0 : minRaw,
      scope: `${cat}类目可用`,
      tag,
    });
    ex.add(name);
  }
  return out;
}

/** 购买弹窗 SKU（按品类模板）——tb-ai-store 的 AI 商品与种子口红共用 */
export function tbSkuForTag(tag: string, price: number): TbSkuGroup[] {
  const cat = GEN_CATS.find((c) => c.tag === tag);
  if (cat) return cat.sku(rngFrom(hashStr(tag)));
  // 未收录品类：通用规格（颜色 + 标配/升级款）
  return [
    colorGroup(tag, COLORS_SOFT),
    { name: '规格', options: [{ label: '官方标配' }, { label: '升级款', priceDelta: Math.max(10, Math.round(price * 0.15)) }] },
  ];
}
