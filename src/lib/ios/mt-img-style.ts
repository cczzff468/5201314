'use client';

/**
 * 美团全站图片样式（「我的 → 图片样式」菜单三选一；用户口径：作用于订单、店铺门头、菜品等
 * 全部内容匹配图——不是公益图，公益格子已按需求改造为本菜单入口）：
 *
 * 1. real    —— 真实图片：现有 /api/mt-img 真实图库链（Foodiesfeed / TheMealDB / Wikimedia
 *               Commons 等网站真实照片），默认样式，URL 原样不改写；
 * 2. ai      —— AI 生成：用「设置 → 图像生成」配置的生图 API 按品类关键词（k=）现场生成；
 *               每个品类 tag 一张（f 菜品 / c 门头各一槽），生成中先显示默认插画，好了自动替换；
 * 3. default —— 默认图片：/api/mt-img?...&d=1 本地算法插画直出（分类配色 + emoji SVG）。
 *
 * 持久化口径与 mt-rider 同构：样式小开关存 localStorage（同步首帧读），AI 图 dataURL 存 kv
 * （中大容量，内存缓存同步读 + 写穿 IndexedDB，按账号隔离）。FoodImg（mt-food-img.tsx）统一
 * 消费：仅识别 /api/mt-img 链接做改写，用户上传 dataURL 等自定义图任何样式下都原样显示。
 */

import { kvDelByPrefix, kvGet, kvSet } from '@/lib/ios/idb-kv';
import { compressImageSrc, generateFreePhoto } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';

export type MtFoodStyle = 'real' | 'ai' | 'default';

const MT_FOOD_STYLE_KEY = 'mt-food-img-style';

// ---------------- 样式读写 + 订阅（useSyncExternalStore 口径：版本号 + listeners） ----------------

let styleVer = 0;
const styleListeners = new Set<() => void>();

/** 读当前全站图片样式（无 / 非法存档回退 real=真实图库，保持既有观感） */
export function mtGetFoodStyle(): MtFoodStyle {
  try {
    const v = localStorage.getItem(MT_FOOD_STYLE_KEY);
    return v === 'ai' || v === 'default' ? v : 'real';
  } catch {
    return 'real';
  }
}

/** 写样式并全站广播（所有挂载中的 FoodImg 立即换源重渲染） */
export function mtSetFoodStyle(style: MtFoodStyle): void {
  try {
    localStorage.setItem(MT_FOOD_STYLE_KEY, style);
  } catch {
    /* 隐私模式忽略 */
  }
  styleVer++;
  styleListeners.forEach((fn) => fn());
}

export function subscribeFoodStyle(fn: () => void): () => void {
  styleListeners.add(fn);
  return () => {
    styleListeners.delete(fn);
  };
}

export function foodStyleVersion(): number {
  return styleVer;
}

// ---------------- AI 生成图缓存（品类 tag | 图类 kind 一槽一张，kv 持久化） ----------------

const aiKeyOf = (tag: string, kind: 'f' | 'c') => `mt-ai-food:${tag}|${kind}`;

let aiVer = 0;
const aiListeners = new Set<() => void>();
const bumpAi = (): void => {
  aiVer++;
  aiListeners.forEach((fn) => fn());
};

export function subscribeAiFood(fn: () => void): () => void {
  aiListeners.add(fn);
  return () => {
    aiListeners.delete(fn);
  };
}

export function aiFoodVersion(): number {
  return aiVer;
}

/** 读 AI 图（同步；无 / 坏数据 = 空串，展示端回退默认插画） */
export function mtGetAiFood(tag: string, kind: 'f' | 'c'): string {
  const v = kvGet(aiKeyOf(tag, kind)) as unknown;
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

/** 写 AI 图并广播（src 为空串删除槽位） */
export function mtSetAiFood(tag: string, kind: 'f' | 'c', src: string): void {
  if (src) kvSet(aiKeyOf(tag, kind), src);
  bumpAi();
}

/** 清空全部 AI 图（跨账号前缀清扫；弹层「重新生成」入口用，清完下一次挂载自动重新排队） */
export function mtClearAiFoods(): void {
  kvDelByPrefix('mt-ai-food:');
  bumpAi();
}

// ---------------- AI 提示词（品类词 → 中文画面描述；未收录用 tag 原词） ----------------

const TAG_ZH: Record<string, string> = {
  food: '丰盛美食',
  'fast-food': '快餐套餐',
  store: '便利店货架零食饮料',
  'milk-tea': '珍珠奶茶',
  'bubble-tea': '珍珠奶茶',
  boba: '珍珠奶茶',
  hotpot: '麻辣火锅',
  'hot-pot': '麻辣火锅',
  cola: '冰镇可乐气泡饮',
  coffee: '咖啡拿铁',
  tea: '清茶茶饮',
  juice: '鲜榨果汁',
  soymilk: '热豆浆',
  milkshake: '奶昔',
  pizza: '披萨',
  burger: '汉堡',
  sushi: '寿司刺身',
  barbecue: '炭火烤串',
  lamb: '烤羊肉串',
  'fried-chicken': '金黄炸鸡',
  dumplings: '饺子',
  dessert: '精致甜品蛋糕',
  'egg-tart': '葡式蛋挞',
  sundae: '冰淇淋圣代',
  'ice-cream': '冰淇淋',
  seafood: '海鲜大餐',
  steak: '牛排',
  beef: '炖牛肉',
  pork: '红烧肉',
  duck: '烤鸭',
  salad: '蔬菜沙拉',
  sandwich: '三明治',
  bread: '面包欧包',
  porridge: '热粥',
  soup: '热汤',
  noodles: '汤面',
  rice: '白米饭',
  breakfast: '丰盛早餐',
  fruit: '新鲜水果',
  banana: '香蕉',
  cherry: '樱桃',
  mandarin: '橘子',
  kiwi: '猕猴桃',
  braised: '红烧菜肴',
  spicy: '香辣菜肴',
  egg: '煎蛋',
  'quail-egg': '鹌鹑蛋',
  milk: '牛奶',
  fries: '薯条',
  'chinese-food': '中式家常菜',
  japanese: '日式料理',
  thai: '泰式料理',
  asian: '亚洲风味菜',
  curry: '咖喱饭',
  kimchi: '韩式泡菜',
  'rice-bowl': '盖浇饭',
  'stir-fry': '家常小炒',
  'noodle-soup': '汤粉',
  hotel: '酒店客房',
  'hotel-room': '酒店客房',
  resort: '度假酒店',
  cinema: '电影院',
  flower: '花束',
  medicine: '药品药盒',
  supermarket: '超市货架',
};

/** AI 生成最终提示词（菜品图 / 门头图两种口径；要求无文字防乱码招牌、无水印） */
export function mtFoodPrompt(tag: string, kind: 'f' | 'c'): string {
  const zh = TAG_ZH[tag] ?? tag.replace(/-/g, ' ');
  if (kind === 'c') {
    return `${zh}餐厅门头外观，明亮温馨的街边小店实景，玻璃橱窗暖光，实景照片风格，招牌上没有任何文字，画面干净无水印，高质量`;
  }
  return `${zh}，专业美食摄影特写，摆盘精致，暖色调光线，食欲感十足，浅景深，画面干净无任何文字无水印，高质量`;
}

// ---------------- 生成队列（并发 2；同 key 去重；burst 挂载时排队逐张出图） ----------------

interface AiJob {
  tag: string;
  kind: 'f' | 'c';
  cfg: ImgGenConfig;
}

const MAX_AI_CONCURRENT = 2;
const aiQueue: AiJob[] = [];
const aiBusy = new Set<string>(); // 生成中 + 排队中的 key（去重防重复入队）
let aiActive = 0;

/** 入队生成一张品类 AI 图（已缓存 / 已在队 / 已在生成时静默跳过；未配置 API 由调用方过滤） */
export function mtEnqueueAiFood(tag: string, kind: 'f' | 'c', cfg: ImgGenConfig): void {
  const key = `${tag}|${kind}`;
  if (mtGetAiFood(tag, kind) || aiBusy.has(key)) return;
  aiBusy.add(key);
  aiQueue.push({ tag, kind, cfg });
  pumpAi();
}

function pumpAi(): void {
  while (aiActive < MAX_AI_CONCURRENT && aiQueue.length > 0) {
    const job = aiQueue.shift();
    if (!job) break;
    const key = `${job.tag}|${job.kind}`;
    aiActive++;
    genAiFood(job)
      .then((src) => {
        if (src) mtSetAiFood(job.tag, job.kind, src);
      })
      .catch(() => {
        /* 失败静默：展示端继续默认插画兜底 */
      })
      .finally(() => {
        aiBusy.delete(key); // 成功后缓存已存在、失败则允许重挂载重试，两条路都释放去重槽
        aiActive--;
        pumpAi();
      });
  }
}

/** 生成一张：生图 API → dataURL → 压缩到 512px（缩略图够用，控制 kv 体积） */
async function genAiFood(job: AiJob): Promise<string> {
  const raw = await generateFreePhoto(job.cfg, mtFoodPrompt(job.tag, job.kind));
  return compressImageSrc(raw, 512, 0.82);
}
