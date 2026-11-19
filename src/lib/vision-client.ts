'use client';

/**
 * 识图模型客户端（设置 › 识图模型）。
 *
 * 职责边界：识图模型只负责「看」——把用户在聊天里发送的图片转成一段文字描述；
 * 描述作为上下文交给聊天模型生成最终回复。识图模型不参与聊天，两个模型配置互相独立。
 *
 * 调用策略与聊天一致：优先走服务器代理 /api/vision（服务器转发到用户配置的接口，
 * 避开浏览器 CORS）；内网地址 / 服务器建议直连（directOnly）时回退浏览器直连。
 * 图片只以 data URL 内联传给用户自己配置的识图接口，不经过任何第三方图床/公网上传。
 *
 * v1.9.25 未配置识图模型（或识图模型失败）时：自动改用【聊天模型】直接看图——多模态
 * 请求发往聊天渠道（含备用渠道故障转移），聊天模型支持图片输入（gpt-4o / gemini /
 * qwen-vl / glm-4v 等）即可识图，无需单独配置识图模型；全部失败才按未识图处理。
 */

import type { VisionConfig } from '@/lib/ios/store';
import { directVisionDescribe, isPrivateApiUrl } from '@/lib/ios/direct-api';
import { currentApiChain } from '@/lib/api-fallback';

/** 识图 system 提示：客观、简洁、不寒暄，输出描述本身（服务端 /api/vision 用同一份文案）；
 *  多张图片时要求按「图N：」分行逐张描述（splitVisionDesc 按此格式拆分回写各图） */
export const VISION_SYSTEM_PROMPT =
  '你是聊天应用内置的图片识别助手。用户在聊天中发来图片，请用中文客观、简洁地描述图片内容（有什么人/物/场景/可见文字），不要寒暄、不要评论、只输出描述本身；单张图片 150 字以内。如果一次发来了多张图片，必须逐张分行描述：每行以「图1：」「图2：」等编号开头、按图片顺序排列，每行 80 字以内。如果消息附带了文字问题，请结合图片回答该问题。';

/**
 * 把一次识图返回的描述拆分到本回合的各张图片（多图识图 #25 修复）：
 * - 单张：原样返回；
 * - 多张：模型按「图N：」分行逐张描述时按行拆分（解析出的段数多于/少于图片数时合并/留空对齐）；
 *   模型没按编号输出时整段描述挂到第一张、其余留空（描述已覆盖全部图片，AI 上下文不丢信息）。
 * 返回数组长度恒等于 count，与本回合图片消息顺序一一对应。
 */
export function splitVisionDesc(desc: string, count: number): string[] {
  const full = desc.trim();
  if (count <= 1) return [full];
  const lines = full
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let cur = '';
  for (const line of lines) {
    const m = line.match(/^(?:图|第)\s*(\d+)\s*[：:、.．]\s*(.*)$/);
    if (m) {
      if (cur) parts.push(cur);
      cur = m[2].trim();
    } else {
      cur = cur ? `${cur} ${line}` : line; // 首行无编号：当作第一张（或整段描述）的开头
    }
  }
  if (cur) parts.push(cur);
  if (parts.length <= 1) return [full, ...Array.from({ length: count - 1 }, () => '')];
  if (parts.length === count) return parts;
  if (parts.length > count) {
    // 编号段比图片多（模型多拆了）：多余内容合并进最后一张
    const head = parts.slice(0, count - 1);
    head.push(parts.slice(count - 1).join('；'));
    return head;
  }
  // 编号段比图片少：后面几张留空（未覆盖的图走「[图片]」占位防编造规则）
  return [...parts, ...Array.from({ length: count - parts.length }, () => '')];
}

/** 识图请求：图片 data URL（仅接受 data:image/ 前缀）+ 用户随图附言（可空） */
export interface VisionRequest {
  images: string[];
  text: string;
}

/** 校验识图配置完整性（baseUrl + model 必填；apiKey 可空——反代/本地网关可能免 Key） */
export function visionConfigReady(cfg: VisionConfig): boolean {
  return Boolean(cfg.baseUrl.trim() && cfg.model.trim());
}

/** 过滤非法图片（只允许 data:image/ 内联数据；数量与体积由调用方在上传压缩阶段控制） */
function sanitizeImages(images: string[]): string[] {
  return images.filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
}

/**
 * 请求识图描述：返回描述文本（可能为空串 = 模型没产出，调用方按未识图处理）。
 * 失败抛 Error（友好文案，由调用方展示为系统提示；绝不把错误当角色台词）。
 */
/** 单渠道单次识图尝试：内网直连 / 代理 → directOnly 直连；失败抛【真实】错误（不掩盖） */
async function describeOnce(config: VisionConfig, images: string[], text: string): Promise<string> {
  // 内网/本机地址：云端服务器必然不可达 → 浏览器直连
  if (isPrivateApiUrl(config.baseUrl)) {
    return directVisionDescribe(config, images, text, VISION_SYSTEM_PROMPT);
  }
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, text, config }),
  });
  const data = (await res.json().catch(() => null)) as
    | { desc?: unknown; error?: unknown; directOnly?: unknown }
    | null;
  if (res.ok && data && typeof data.desc === 'string') return data.desc.trim();
  // 服务器建议直连（地区限制/网络不可达）→ 浏览器直连兜底
  if (data?.directOnly === true) {
    return directVisionDescribe(config, images, text, VISION_SYSTEM_PROMPT);
  }
  const msg = typeof data?.error === 'string' && data.error ? data.error : `识图请求失败（HTTP ${res.status}）`;
  throw new Error(msg);
}

export async function describeImages(config: VisionConfig, req: VisionRequest): Promise<string> {
  if (!visionConfigReady(config)) {
    throw new Error('还没有配置识图模型：请到「设置 › 识图模型」填写 API 地址与模型名');
  }
  const images = sanitizeImages(req.images);
  if (images.length === 0) return '';
  return describeOnce(config, images, req.text);
}

/**
 * 聊天模型直接识图（v1.9.25）：把聊天渠道链（主渠道 + 备用渠道）逐个当作识图渠道尝试——
 * 聊天模型支持图片输入即可看懂图，用户无需单独配置识图模型。全部失败抛最后一个错误。
 */
async function describeViaChatModel(req: VisionRequest): Promise<string> {
  const images = sanitizeImages(req.images);
  if (images.length === 0) return '';
  const chain = currentApiChain();
  let lastErr: unknown = null;
  for (const cfg of chain) {
    if (!cfg.baseUrl.trim() || !cfg.model.trim()) continue;
    try {
      return await describeOnce(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
        images,
        req.text,
      );
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('识图请求失败');
}

/**
 * 自动识图（第二十九轮「让 AI 知道图片长什么样」）：
 * 配置了识图模型 → 走用户模型；未配置或失败 → 自动降级【聊天模型】直接看图（v1.9.25，
 * 聊天渠道链逐个尝试，支持图片输入的聊天模型零配置即可识图）。
 * 相册自动描述 / 头像感知 / 聊天发图统一走这里。
 * 返回空串 = 没产出描述（调用方按未识图处理）；全部失败抛组合后的真实错误。
 */
export async function describeImagesAuto(config: VisionConfig, req: VisionRequest): Promise<string> {
  const images = sanitizeImages(req.images);
  if (images.length === 0) return '';
  let visionErr: unknown = null;
  if (visionConfigReady(config)) {
    try {
      return await describeImages(config, req);
    } catch (err) {
      // 专用识图模型失败：先记下真实原因，降级聊天模型直识再试（救回本轮描述）
      visionErr = err;
    }
  }
  // 未配置识图模型 / 识图模型失败：自动用聊天模型直接看图（渠道链逐个尝试；
  // 聊天模型支持图片输入即可，无需单独配置识图模型）
  try {
    return await describeViaChatModel(req);
  } catch (chatErr) {
    // 两路都失败：优先报专用识图模型的错误（更可定位），附聊天模型直识的失败原因
    if (visionErr) {
      const vm = visionErr instanceof Error && visionErr.message ? visionErr.message : '';
      const cm = chatErr instanceof Error && chatErr.message ? chatErr.message : '';
      throw new Error(vm && cm ? `${vm}；尝试用聊天模型直接识图也失败：${cm}` : vm || cm || '识图失败');
    }
    throw chatErr;
  }
}
