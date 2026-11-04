/**
 * AI 自创商品真图自动生成（第十四轮用户反馈：AI 自创商品用真图，走「设置 → 图像生成」）：
 * - 之前 AI 自主创建的淘宝宝贝/美团菜品/店铺门头只有本地卡通图（按名字配品类图）；
 *   本模块在创建瞬间自动生成写实商品图：优先「设置 › 图像生成」配置的模型（与手动
 *   「生成商品图片」弹层同一管线 generateFreePhoto），未配置任何模型时兜底走内置
 *   服务端生图（/api/ai-product-img，z-ai SDK）——开箱即真图；
 * - 生成成功写入既有图片覆盖管线（tbSetProductImg / mtSetProductImg / 门头 mutate+persist，
 *   全部自动持久化），全 App 渲染点即时生效；并广播 AI_PRODUCT_IMG_EVENT 让打开中的
 *   界面（淘宝/美团/微信聊天卡片）立即刷新成真图；
 * - 未配置模型且服务端兜底也失败 → 静默保持卡通图，绝不阻塞下单/送礼主链路；
 * - 同名商品只生成一次（跨回合重复创建不重复烧图）；并发上限 2，排队执行。
 */

import { compressImageSrc, generateFreePhoto, imgGenConfigReady } from '@/lib/imggen';
import { useSettings, type ImgGenConfig } from '@/lib/ios/store';
import { tbProductImgOverride, tbSetProductImg } from '@/lib/ios/taobao-data';
import { mtMerchantOf, mtProductImgOverride, mtRegisterAiMerchant, mtSetProductImg } from '@/lib/ios/meituan-data';

/** 真图生成完成广播事件（detail: { kind, id }）；打开中的界面监听后轻量重渲染 */
export const AI_PRODUCT_IMG_EVENT = 'ai-product-img-ready';

export type AiProductImgKind = 'tb' | 'mt-dish' | 'mt-cover';

// ---------------- 提示词（按载体分别定调，写实电商/美食/门头摄影） ----------------

function buildPrompt(kind: AiProductImgKind, name: string): string {
  if (kind === 'tb') {
    return `电商商品白底主图实拍：${name}，单一商品居中构图，纯净浅灰白背景，柔和影棚灯光，质感细节清晰，高清写实商品摄影，无文字无水印无人物`;
  }
  if (kind === 'mt-dish') {
    return `外卖美食实拍照片：一份${name}，盛在干净的白瓷盘或餐盒里，色泽诱人热气腾腾，木质餐桌背景，自然光俯拍视角，高清写实美食摄影，无文字无水印`;
  }
  return `街边温馨小店门头实拍照片：暖色灯箱招牌的小店外观，招牌上文字柔和虚化不可辨认，白天自然光，干净整洁，高清写实街景摄影，无水印`;
}

// ---------------- 模型选择：设置›图像生成 当前配置/预设优先，无配置走内置服务端兜底 ----------------

function pickUserCfg(): (ImgGenConfig & { mode?: 'proxy' | 'direct' }) | null {
  try {
    const s = useSettings.getState();
    if (s.imgGenConfig.enabled && imgGenConfigReady(s.imgGenConfig)) return s.imgGenConfig;
    for (const p of s.imgGenPresets) {
      if (imgGenConfigReady(p.config)) return p.config;
    }
  } catch {
    /* 设置未就绪按未配置 */
  }
  return null;
}

async function generateOne(cfg: (ImgGenConfig & { mode?: 'proxy' | 'direct' }) | null, prompt: string): Promise<string> {
  if (cfg) return generateFreePhoto(cfg, prompt); // 用户模型管线（内部已压缩 1024px）
  // 内置兜底：服务端 z-ai SDK 文生图 → 客户端压缩到 640px 落库（控制 kv 体积）
  const res = await fetch('/api/ai-product-img', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const j = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
  if (!res.ok || !j?.src) throw new Error(j?.error || `生图请求失败（HTTP ${res.status}）`);
  return compressImageSrc(j.src, 640, 0.85);
}

// ---------------- 并发控制（上限 2，排队执行） + 同名去重 ----------------

const firedNames = new Set<string>();
const pending: Array<() => Promise<void>> = [];
let running = 0;

function pump(): void {
  while (running < 2 && pending.length > 0) {
    const job = pending.shift();
    if (!job) break;
    running += 1;
    void job()
      .catch(() => undefined)
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

// ---------------- 应用落库（复用既有覆盖管线，全部自动持久化） ----------------

/** AI 单内 tb 订单快照图同步刷新（订单 items[].img 是下单瞬间的快照，真图到了要补上） */
function patchTbOrderItemImgs(pid: string, src: string): void {
  try {
    void (async () => {
      const { tbGetSession, tbUidOf, tbLoadOrders, tbSaveOrders } = await import('@/lib/ios/taobao-store');
      const s = tbGetSession();
      if (!s) return;
      const uid = tbUidOf(s);
      const list = tbLoadOrders(uid);
      let changed = false;
      for (const o of list) {
        for (let i = 0; i < o.items.length; i++) {
          if (o.items[i].pid === pid && o.items[i].img !== src) {
            o.items[i] = { ...o.items[i], img: src };
            changed = true;
          }
        }
      }
      if (changed) tbSaveOrders(uid, list);
    })();
  } catch {
    /* 订单快照刷新失败不影响商品图 */
  }
}

function applyImg(kind: AiProductImgKind, id: string, src: string): void {
  if (kind === 'tb') {
    tbSetProductImg(id, src);
    patchTbOrderItemImgs(id, src);
    return;
  }
  if (kind === 'mt-dish') {
    mtSetProductImg(id, src);
    return;
  }
  // mt-cover：门头覆盖到 AI 店铺对象并重注册（随 mt-ai-registry 持久化）
  const m = mtMerchantOf(id);
  if (m) {
    m.cover = src;
    mtRegisterAiMerchant(m);
  }
}

// ---------------- 入口：创建后 fire-and-forget 调用 ----------------

/**
 * AI 自创商品真图生成（fire-and-forget，绝不抛错）：
 * - 同名只生成一次（跨回合重复创建不重复烧图）；已有真图覆盖的直接跳过；
 * - 成功 → 覆盖管线落库 + 广播 AI_PRODUCT_IMG_EVENT（打开中的界面即时换真图）；
 * - 失败 → 静默保持本地卡通图。
 */
export function fireAiProductImg(kind: AiProductImgKind, id: string, name: string): void {
  const cleanName = name.trim().slice(0, 40);
  if (!id || cleanName.length < 2) return;
  const dedupKey = `${kind}:${cleanName}`;
  if (firedNames.has(dedupKey)) return;
  // 已有真图覆盖（历史生成过）→ 不再重生成
  try {
    const hasOverride =
      (kind === 'tb' && Boolean(tbProductImgOverride(id))) ||
      (kind === 'mt-dish' && Boolean(mtProductImgOverride(id))) ||
      (kind === 'mt-cover' && Boolean(mtMerchantOf(id)?.cover));
    if (hasOverride) return;
  } catch {
    /* 读取失败按无覆盖继续 */
  }
  firedNames.add(dedupKey);
  const job = async (): Promise<void> => {
    const prompt = buildPrompt(kind, cleanName);
    const src = await generateOne(pickUserCfg(), prompt);
    if (!src.startsWith('data:image/')) throw new Error('生图返回不是有效图片');
    applyImg(kind, id, src);
    try {
      window.dispatchEvent(new CustomEvent(AI_PRODUCT_IMG_EVENT, { detail: { kind, id } }));
    } catch {
      /* 事件失败不影响落库结果 */
    }
  };
  pending.push(job);
  pump();
}
