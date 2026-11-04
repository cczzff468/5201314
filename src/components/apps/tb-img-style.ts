'use client';

/**
 * 淘宝全站图片样式（「我的淘宝 → 图片样式」菜单三选一；用户口径：与美团同款——
 * 真实图片 / AI 生成 / 默认图片三选一，作用于商品图、店铺门头、领券中心等全部内容匹配图）：
 *
 * 1. real    —— 真实图片：现有 /api/mt-img 真实图库链（Wikimedia Commons 实景池等真实照片，
 *               v12 已注册数码/服饰/家居/美妆/图书品类），默认样式，URL 原样不改写；
 * 2. ai      —— AI 生成：用「设置 → 图像生成」配置的生图 API 按品类关键词（k=）现场生成；
 *               每个品类 tag 一张（f 商品图 / c 门头图各一槽），生成中先显示默认插画，好了自动替换；
 * 3. default —— 默认图片：/api/mt-img?...&d=1 服务端本地算法插画直出（分类配色 + 品类字形），离线秒出。
 *
 * 持久化口径与美团 mt-img-style 同构：样式小开关存 localStorage（同步首帧读），AI 图 dataURL 存
 * kv（中大容量，内存缓存同步读 + 写穿 IndexedDB，全局一份）。TbImg（tb-img.tsx）统一消费：
 * 仅识别 /api/mt-img 链接做改写，用户上传 dataURL 等自定义图任何样式下都原样显示。
 * 与美团独立：两边各选各的，互不影响。
 */

import { kvDelByPrefix, kvGet, kvSet } from '@/lib/ios/idb-kv';
import { compressImageSrc, generateFreePhoto } from '@/lib/imggen';
import type { ImgGenConfig } from '@/lib/ios/store';

export type TbImgStyle = 'real' | 'ai' | 'default';

const TB_IMG_STYLE_KEY = 'tb-img-style';

// ---------------- 样式读写 + 订阅（useSyncExternalStore 口径：版本号 + listeners） ----------------

let styleVer = 0;
const styleListeners = new Set<() => void>();

/** 读当前全站图片样式（无 / 非法存档回退 real=真实图库，保持既有观感） */
export function tbGetImgStyle(): TbImgStyle {
  try {
    const v = localStorage.getItem(TB_IMG_STYLE_KEY);
    return v === 'ai' || v === 'default' ? v : 'real';
  } catch {
    return 'real';
  }
}

/** 写样式并全站广播（所有挂载中的 TbImg 立即换源重渲染） */
export function tbSetImgStyle(style: TbImgStyle): void {
  try {
    localStorage.setItem(TB_IMG_STYLE_KEY, style);
  } catch {
    /* 隐私模式忽略 */
  }
  styleVer++;
  styleListeners.forEach((fn) => fn());
}

export function subscribeTbImgStyle(fn: () => void): () => void {
  styleListeners.add(fn);
  return () => {
    styleListeners.delete(fn);
  };
}

export function tbImgStyleVersion(): number {
  return styleVer;
}

// ---------------- AI 生成图缓存（品类 tag | 图类 kind 一槽一张，kv 持久化） ----------------

const aiKeyOf = (tag: string, kind: 'f' | 'c') => `tb-ai-img:${tag}|${kind}`;

let aiVer = 0;
const aiListeners = new Set<() => void>();
const bumpAi = (): void => {
  aiVer++;
  aiListeners.forEach((fn) => fn());
};

export function subscribeTbAiImg(fn: () => void): () => void {
  aiListeners.add(fn);
  return () => {
    aiListeners.delete(fn);
  };
}

export function tbAiImgVersion(): number {
  return aiVer;
}

/** 读 AI 图（同步；无 / 坏数据 = 空串，展示端回退默认插画） */
export function tbGetAiImg(tag: string, kind: 'f' | 'c'): string {
  const v = kvGet(aiKeyOf(tag, kind)) as unknown;
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

/** 写 AI 图并广播（src 为空串删除槽位） */
export function tbSetAiImg(tag: string, kind: 'f' | 'c', src: string): void {
  if (src) kvSet(aiKeyOf(tag, kind), src);
  bumpAi();
}

/** 清空全部 AI 图（弹层「重新生成」入口用，清完下一次挂载自动重新排队） */
export function tbClearAiImgs(): void {
  kvDelByPrefix('tb-ai-img:');
  bumpAi();
}

// ---------------- AI 提示词（品类词 → 中文画面描述；未收录用 tag 原词转空格） ----------------
// 覆盖 /api/tb-feed TAG_WHITELIST 全量 + taobao.tsx/channels 直配 tag（gift/kiosk/temple/fridge 等）

const TAG_ZH: Record<string, string> = {
  // 数码
  phone: '智能手机',
  earbuds: '真无线蓝牙耳机',
  laptop: '轻薄笔记本电脑',
  tablet: '平板电脑',
  watch: '智能手表',
  camera: '微单相机',
  keyboard: '机械键盘',
  powerbank: '充电宝',
  speaker: '蓝牙音箱',
  lock: '智能门锁',
  fridge: '家用冰箱',
  washer: '滚筒洗衣机',
  // 服饰
  jacket: '休闲夹克外套',
  jeans: '牛仔裤',
  dress: '连衣裙',
  hoodie: '连帽卫衣',
  tshirt: '休闲T恤',
  sneakers: '运动鞋',
  shoes: '皮鞋',
  backpack: '双肩背包',
  coat: '毛呢大衣',
  hat: '棒球帽',
  shirt: '白衬衫',
  // 美妆
  lipstick: '口红唇膏',
  perfume: '香水瓶',
  skincare: '护肤品套装',
  makeup: '彩妆化妆品',
  // 家居
  sofa: '布艺沙发',
  bedding: '床上四件套',
  lamp: '台灯',
  mug: '陶瓷马克杯',
  'water-bottle': '保温杯',
  // 食品/图书/其他
  snacks: '零食大礼包',
  fruit: '新鲜水果',
  tea: '茶叶茶罐',
  food: '美食',
  books: '图书书堆',
  toy: '毛绒玩具',
  gift: '精美礼盒',
  kiosk: '智能自助终端机',
  temple: '中式古建筑风景',
};

/** AI 生成最终提示词（商品图 / 门头图两种口径；要求无文字防乱码招牌、无水印） */
export function tbImgPrompt(tag: string, kind: 'f' | 'c'): string {
  const zh = TAG_ZH[tag] ?? tag.replace(/-/g, ' ');
  if (kind === 'c') {
    return `${zh}品牌专卖店门头外观，明亮温馨的街边门店实景，玻璃橱窗暖光，实景照片风格，招牌上没有任何文字，画面干净无水印，高质量`;
  }
  return `${zh}商品商业摄影，电商主图风格，纯色背景，产品居中，光线明亮柔和，细节清晰，画面干净无任何文字无水印，高质量`;
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
export function tbEnqueueAiImg(tag: string, kind: 'f' | 'c', cfg: ImgGenConfig): void {
  const key = `${tag}|${kind}`;
  if (tbGetAiImg(tag, kind) || aiBusy.has(key)) return;
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
    genAiImg(job)
      .then((src) => {
        if (src) tbSetAiImg(job.tag, job.kind, src);
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
async function genAiImg(job: AiJob): Promise<string> {
  const raw = await generateFreePhoto(job.cfg, tbImgPrompt(job.tag, job.kind));
  return compressImageSrc(raw, 512, 0.82);
}
